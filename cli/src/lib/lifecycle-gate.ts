/**
 * 生命周期命令的上游事实读取与 fail-closed 前置判定（D12）。
 *
 * 20260907 事故：执行 Agent 漏跑 `openlogos deploy-done` 导致 `DEPLOY_DONE` 缺失，
 * 而 smoke / archive 均不设防、派生沉默停滞，单点遗漏被放大为长期僵死状态。
 * 本模块把「命令自身 fail-closed 校验其上游事实标记」收敛为单一只读事实源，
 * 供 smoke（§2.67.1）、archive（§2.67.2）与 status/next 对账投影（§2.67.3）共用。
 *
 * 只读不变量：本模块只读取磁盘事实，绝不写入任何 marker——尤其绝不补写 `DEPLOY_DONE`
 * （auto-heal 会绕过半自动模式下 deploy-done 的人类确认点语义）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTaskSections, resolveProposalDeploymentDecision } from './proposal-lifecycle.js';
import { VERIFY_PASS_MARKER } from './proposal-markers.js';
import { readProjectYaml } from './project-yaml.js';
// ModuleInfo 仅作类型使用，type-only 引入不构成运行时循环依赖。
import type { ModuleInfo } from '../commands/status.js';

export const DEPLOY_DONE_MARKER = 'DEPLOY_DONE';
export const SMOKE_PASS_MARKER = 'SMOKE_PASS';
export const SMOKE_FAIL_MARKER = 'SMOKE_FAIL';
export const VERIFY_FAIL_MARKER = 'VERIFY_FAIL';

export interface LifecycleFacts {
  slug: string;
  proposalDir: string;
  moduleId: string | null;
  deploymentRequired: boolean | null;
  smokeRequired: boolean | null;
  deploymentDecisionConflict: boolean;
  deploymentDecisionConflictReason: string | null;
  verifyPass: boolean;
  verifyFail: boolean;
  deployDone: boolean;
  smokePass: boolean;
  smokeFail: boolean;
  /** `[deploy]` section 总条目数；section 缺失时为 0。 */
  deployTasksTotal: number;
  deployTasksChecked: number;
  /** 非空 `[deploy]` section 且条目全部勾选。 */
  deployTasksAllChecked: boolean;
}

export interface LifecycleGateRejection {
  code: string;
  message: string;
}

/** §2.67.3 只读对账投影：证据枚举按固定顺序去重输出，保证同一磁盘事实下稳定可 golden。 */
export type StateInconsistencyEvidence =
  | 'smoke_pass_marker_present'
  | 'smoke_fail_marker_present'
  | 'deploy_tasks_all_checked';

export interface StateInconsistency {
  kind: 'deploy_done_missing_with_downstream_evidence';
  evidence: StateInconsistencyEvidence[];
  remediation: string;
}

/** 只读文件事实入口；archive 等命令可注入自身 fs 抽象，默认走 node fs。 */
export interface LifecycleFactsIO {
  exists(path: string): boolean;
  readText(path: string): string;
}

const nodeLifecycleIO: LifecycleFactsIO = {
  exists: path => existsSync(path),
  readText: path => readFileSync(path, 'utf-8'),
};

function readActiveGuardSlug(root: string, io: LifecycleFactsIO): { slug: string; moduleId: string | null } | null {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (!io.exists(guardPath)) return null;
  try {
    const guard = JSON.parse(io.readText(guardPath));
    const slug = typeof guard.activeChange === 'string' ? guard.activeChange.trim() : '';
    if (!slug) return null;
    const moduleId = typeof guard.module === 'string' && guard.module.trim() ? guard.module.trim() : null;
    return { slug, moduleId };
  } catch {
    return null;
  }
}

/** 与 deploy-done 的 resolveModuleDefaults 同口径：module gates 优先于 module 自身声明。 */
function moduleDefaultsOf(root: string, moduleId: string | null): Pick<ModuleInfo, 'deployment_required' | 'smoke_required'> {
  const project = readProjectYaml(root).data;
  const modules = project?.modules ?? [];
  const selected = moduleId
    ? modules.find(mod => mod.id === moduleId)
    : modules.length === 1 ? modules[0] : undefined;
  const gates = selected ? project?.deployment_gates?.[selected.id] : undefined;
  return {
    deployment_required: typeof gates?.deployment_required === 'boolean'
      ? gates.deployment_required
      : selected?.deployment_required,
    smoke_required: typeof gates?.smoke_required === 'boolean'
      ? gates.smoke_required
      : selected?.smoke_required,
  };
}

/** 读取活跃提案的全部生命周期事实；无活跃提案或提案目录缺失时返回 null（既有命令行为不变）。 */
export function readLifecycleFacts(root: string, io: LifecycleFactsIO = nodeLifecycleIO): LifecycleFacts | null {
  const active = readActiveGuardSlug(root, io);
  if (!active) return null;
  return readLifecycleFactsAt(root, active.slug, active.moduleId, io);
}

/**
 * 读取**指定** slug 的生命周期事实。archive 接受 slug 实参，被归档的提案不必是 guard
 * 当前活跃提案，故链条校验必须以该 slug 的提案目录为准，而非 guard 指向的提案。
 */
export function readLifecycleFactsAt(
  root: string,
  slug: string,
  moduleId: string | null,
  io: LifecycleFactsIO = nodeLifecycleIO,
): LifecycleFacts | null {
  const proposalDir = join(root, 'logos', 'changes', slug);
  if (!io.exists(proposalDir)) return null;

  const decision = resolveProposalDeploymentDecision(proposalDir, moduleDefaultsOf(root, moduleId));

  let deployTasksTotal = 0;
  let deployTasksChecked = 0;
  const tasksPath = join(proposalDir, 'tasks.md');
  if (io.exists(tasksPath)) {
    const deploy = parseTaskSections(io.readText(tasksPath))?.deploy;
    if (deploy) {
      deployTasksTotal = deploy.total;
      deployTasksChecked = deploy.checked;
    }
  }

  const marker = (name: string) => io.exists(join(proposalDir, name));
  return {
    slug,
    proposalDir,
    moduleId,
    deploymentRequired: decision.deployment_required,
    smokeRequired: decision.smoke_required,
    deploymentDecisionConflict: decision.deployment_decision_conflict,
    deploymentDecisionConflictReason: decision.deployment_decision_conflict_reason,
    verifyPass: marker(VERIFY_PASS_MARKER),
    verifyFail: marker(VERIFY_FAIL_MARKER),
    deployDone: marker(DEPLOY_DONE_MARKER),
    smokePass: marker(SMOKE_PASS_MARKER),
    smokeFail: marker(SMOKE_FAIL_MARKER),
    deployTasksTotal,
    deployTasksChecked,
    deployTasksAllChecked: deployTasksTotal > 0 && deployTasksChecked === deployTasksTotal,
  };
}

/**
 * smoke 前置四项判定（§2.67.1）：顺序固定 ①→②→③→④，命中即停并只报第一个错误码。
 * 返回 null 表示放行；返回 rejection 时调用方必须零副作用退出。
 */
export function evaluateSmokePrecondition(
  facts: LifecycleFacts,
  message: (key: string, vars?: Record<string, string>) => string,
): LifecycleGateRejection | null {
  if (facts.smokeRequired !== true) {
    return { code: 'SMOKE_NOT_REQUIRED', message: message('smoke.gate.notRequired', { slug: facts.slug }) };
  }
  if (facts.deploymentDecisionConflict) {
    return {
      code: 'SMOKE_DEPLOY_DECISION_CONFLICT',
      message: message('smoke.gate.decisionConflict', { reason: facts.deploymentDecisionConflictReason ?? '' }),
    };
  }
  if (!facts.deployDone) {
    return { code: 'SMOKE_DEPLOY_NOT_DONE', message: message('smoke.gate.deployNotDone') };
  }
  if (!facts.deployTasksAllChecked) {
    return { code: 'SMOKE_DEPLOY_TASKS_INCOMPLETE', message: message('smoke.gate.deployTasksIncomplete') };
  }
  return null;
}

/**
 * archive 完成链条判定（§2.67.2）：顺序固定 ①→②→③，命中即停。
 * ① 全部提案要求 VERIFY_PASS 且无 VERIFY_FAIL；
 * ② 仅 deployment_required=true 的提案要求 DEPLOY_DONE——`SMOKE_PASS` 在场也不得反推部署完成；
 * ③ 仅需部署且需 smoke 的提案要求 SMOKE_PASS 且无 SMOKE_FAIL。
 * 返回 null 表示放行；返回 rejection 时调用方必须零副作用退出（不移动目录、不删 guard、不建握手）。
 */
export function evaluateArchiveChain(
  facts: LifecycleFacts,
  message: (key: string, vars?: Record<string, string>) => string,
): LifecycleGateRejection | null {
  if (!facts.verifyPass || facts.verifyFail) {
    return { code: 'ARCHIVE_VERIFY_NOT_PASSED', message: message('archive.gate.verifyNotPassed') };
  }
  if (facts.deploymentRequired === true && !facts.deployDone) {
    return { code: 'ARCHIVE_DEPLOY_NOT_DONE', message: message('archive.gate.deployNotDone') };
  }
  if (facts.deploymentRequired === true && facts.smokeRequired === true && (!facts.smokePass || facts.smokeFail)) {
    return { code: 'ARCHIVE_SMOKE_NOT_PASSED', message: message('archive.gate.smokeNotPassed') };
  }
  return null;
}

/**
 * §2.67.3 `state_inconsistency` 只读对账投影。
 *
 * 触发条件全部成立：活跃提案存在 ∧ 派生停在 `ready-to-deploy`（即 `DEPLOY_DONE` 缺失）
 * ∧ 至少一项矛盾的下游证据在场。一致状态返回 null——调用方据此**不输出该键**（不是输出 null），
 * 既有 status / next golden 逐字不变。
 *
 * 只读不变量：本函数只读取已采集的事实，不落盘、不缓存、不改 `proposal_step` 派生、
 * 不写任何 marker（尤其不补写 `DEPLOY_DONE`）——投影只点名，落标仍只能由 `openlogos deploy-done` 完成。
 */
export function deriveStateInconsistency(
  facts: LifecycleFacts | null,
  proposalStep: string | null | undefined,
): StateInconsistency | null {
  if (!facts || proposalStep !== 'ready-to-deploy' || facts.deployDone) return null;
  const evidence: StateInconsistencyEvidence[] = [];
  if (facts.smokePass) evidence.push('smoke_pass_marker_present');
  if (facts.smokeFail) evidence.push('smoke_fail_marker_present');
  if (facts.deployTasksAllChecked) evidence.push('deploy_tasks_all_checked');
  if (evidence.length === 0) return null;
  return {
    kind: 'deploy_done_missing_with_downstream_evidence',
    evidence,
    remediation: 'openlogos deploy-done',
  };
}
