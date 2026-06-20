/**
 * flow-derive — M1 切片 B1：initial 模块的 phase 派生引擎。
 *
 * 把硬编码的 PHASE_KEYS / PHASE_SUBPATHS / SCENARIO_PHASES / SKIP_PHASE_MAP 改为从 **builtin**
 * initial flow（spec/flow/initial.yaml）派生，再经 code 侧 node-id→phase-key 映射产出与现状
 * 逐字节一致的 phase_progress / 顶层 phases[] / current_phase。
 *
 * 规则（见 docs/orchestratable-flow-design.md、spec/flow-spec.md §12，与 status.ts 原逻辑 1:1）：
 * - 只用 builtin flow，**不应用项目 overlay**（overlay 驱动留后续切片）。
 * - 两套 legacy done 语义由消费端决定：顶层 phases[] = any-present、per-module = all-present（场景覆盖）。
 * - 场景文件保留 legacy `includes()` 子串匹配（非 glob）。
 *
 * 切片 B2：新增 `detectProposalStepViaFlow`——launched 模块的 ProposalStep 改由 builtin
 * launched flow 派生。launched.yaml 提供节点序列与 done_when/fail_when 的 marker/section 名；
 * marker 非对称优先级与提案级部署决策（resolveProposalDeploymentDecision）作为引擎规则保留，
 * 逐分支镜像旧 detectProposalStep（1:1 不改行为）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAdoptedBootstrap } from './project-yaml.js';
import { loadBuiltinFlow, FlowError } from './flow.js';
import { listFiles } from './list-files.js';
import {
  resolveProposalDeploymentDecision,
  getDeploySectionSummary,
  parseTaskSections,
  isProposalTemplateFilled,
  isTasksTemplateFilled,
  countMergeableDeltaFiles,
  allTasksChecked,
  hasSmokeCasesForProposal,
} from './proposal-lifecycle.js';
import type { ProposalStep } from './proposal-lifecycle.js';
import type { ModuleInfo, PhaseProgressItem } from '../commands/status.js';

/** node id → 原 PHASE_KEYS（13 个 1:1）。维护在 code 侧以保持 spec/flow/*.yaml 纯净。 */
export const NODE_TO_PHASE_KEY: Record<string, string> = {
  'prd': 'phase.1',
  'product-design': 'phase.2',
  'architecture': 'phase.3-0',
  'scenario-modeling': 'phase.3-1',
  'api-design': 'phase.3-2-api',
  'db-design': 'phase.3-2-db',
  'deployment-design': 'phase.3-3-deployment',
  'test-cases': 'phase.3-4a',
  'orchestration-test': 'phase.3-4b',
  'code': 'phase.3-5',
  'verify': 'phase.3-6',
  'deploy': 'phase.3-7-deploy',
  'smoke': 'phase.3-8-smoke',
};

const BOOTSTRAP_WHEN = 'bootstrap != adopted';

export interface FlowPhasePlanItem {
  phaseKey: string;
  subpath: string;        // node.produces，已去除末尾斜杠（== 原 PHASE_SUBPATHS[i]）
  isScenario: boolean;    // node.for_each 存在
  whenExpr: string | null;
  nodeId: string;
}

/** 从 builtin initial flow 构建有序 phase plan（顺序 == 原 PHASE_KEYS）。 */
export function buildInitialPhasePlan(): FlowPhasePlanItem[] {
  const flow = loadBuiltinFlow('initial');
  const items: FlowPhasePlanItem[] = [];
  for (const sub of flow.subflows) {
    for (const node of sub.nodes) {
      const phaseKey = NODE_TO_PHASE_KEY[node.id];
      if (!phaseKey) continue;
      const produces = node.produces ?? '';
      // fan-out 节点的 produces 是文件模式（含 {scenario}），扫描路径取其目录；
      // 其余为目录（去末尾斜杠）或报告文件路径（原样，listFiles 支持文件）。
      const subpath = node.for_each
        ? produces.slice(0, produces.lastIndexOf('/'))
        : produces.replace(/\/+$/, '');
      items.push({
        phaseKey,
        subpath,
        isScenario: Boolean(node.for_each),
        whenExpr: node.when ?? null,
        nodeId: node.id,
      });
    }
  }
  return items;
}

interface WhenContext {
  api_enabled: boolean;
  db_enabled: boolean;
  scenario_enabled: boolean;
  deployment_required: boolean;
  smoke_required: boolean;
}

function whenContext(mod: ModuleInfo): WhenContext {
  const skip = mod.skip_phases ?? [];
  const deployment_required = mod.deployment_required !== false && !skip.includes('deployment');
  return {
    api_enabled: !skip.includes('api'),
    db_enabled: !skip.includes('database'),
    scenario_enabled: !skip.includes('scenario'),
    deployment_required,
    smoke_required: deployment_required && mod.smoke_required !== false,
  };
}

/**
 * 求值 node.when。支持最小表达式集：`flag` / `not flag` / `bootstrap != adopted`。
 * 返回 true = 节点参与流程；false = 该节点被跳过。
 */
function evalWhen(expr: string, mod: ModuleInfo, ctx: WhenContext): boolean {
  const e = expr.trim();
  if (e === BOOTSTRAP_WHEN) return !isAdoptedBootstrap(mod.bootstrap);
  if (e.startsWith('not ')) {
    const flag = e.slice(4).trim() as keyof WhenContext;
    return !ctx[flag];
  }
  return Boolean(ctx[e as keyof WhenContext]);
}

/**
 * 复现 deriveExplicitSkipPhaseKeys：返回因显式 `when`（非 bootstrap）为假而跳过的 phase key 集合。
 * 用于多模块全局 skip 交集。
 */
export function flowExplicitSkipPhaseKeys(
  mod: ModuleInfo,
  plan: FlowPhasePlanItem[] = buildInitialPhasePlan(),
): Set<string> {
  const ctx = whenContext(mod);
  const skip = new Set<string>();
  for (const item of plan) {
    if (!item.whenExpr || item.whenExpr === BOOTSTRAP_WHEN) continue;
    if (!evalWhen(item.whenExpr, mod, ctx)) skip.add(item.phaseKey);
  }
  return skip;
}

/**
 * 复现 deriveModulePhaseProgress：per-module 派生（场景阶段 all-present 覆盖度）。
 * 与 status.ts 原算法 1:1（仅数据来源改为 builtin flow plan）。
 */
export function deriveModulePhaseProgressViaFlow(
  root: string,
  mod: ModuleInfo,
  scenarios: Array<{ id: string }>,
  isMultiModule: boolean = false,
  plan: FlowPhasePlanItem[] = buildInitialPhasePlan(),
): { progress: Record<string, PhaseProgressItem>; currentPhase: string | null } {
  const progress: Record<string, PhaseProgressItem> = {};
  const ctx = whenContext(mod);

  for (const item of plan) {
    const key = item.phaseKey;
    const dir = join(root, item.subpath);

    // bootstrap-adopted：phase.1/2/3-0 的 when 为 `bootstrap != adopted`，adopted 时跳过并标 reason
    if (item.whenExpr === BOOTSTRAP_WHEN && isAdoptedBootstrap(mod.bootstrap)) {
      progress[key] = { done: false, skipped: true, skip_reason: 'bootstrap-adopted' };
      continue;
    }

    // 其余显式 when 为假 → 跳过（== deriveExplicitSkipPhaseKeys）
    if (item.whenExpr && item.whenExpr !== BOOTSTRAP_WHEN && !evalWhen(item.whenExpr, mod, ctx)) {
      progress[key] = { done: false, skipped: true };
      continue;
    }

    if (item.isScenario) {
      // 场景阶段：per-module 全覆盖才 done（legacy includes 子串匹配）
      const suffix = key === 'phase.3-1' ? '' : '-test-cases';
      const covered: string[] = [];
      const missing: string[] = [];
      for (const s of scenarios) {
        const pattern = `${mod.id}-${s.id}`;
        const files = listFiles(dir);
        const found = files.some(f => f.includes(pattern) && (suffix === '' || f.includes(suffix)));
        if (found) covered.push(s.id);
        else missing.push(s.id);
      }
      progress[key] = {
        done: missing.length === 0 && scenarios.length > 0,
        skipped: false,
        scenario_coverage: { total: scenarios.length, covered: covered.length, missing },
      };
    } else {
      // 非场景阶段：多模块按 {module}- 前缀过滤，单模块任意文件
      const allFiles = listFiles(dir);
      const files = isMultiModule
        ? allFiles.filter(f => (f.split('/').pop() ?? f).startsWith(`${mod.id}-`))
        : allFiles;
      progress[key] = { done: files.length > 0, skipped: false };
    }
  }

  // fallback-skip：已完成 phase 之前的空 phase 标 skipped（NON_FALLBACK 除外）
  const keys = plan.map(p => p.phaseKey);
  const lastDoneIdx = keys.reduce((acc, k, i) => (progress[k].done ? i : acc), -1);
  for (let i = 0; i < lastDoneIdx; i++) {
    if (!progress[keys[i]].done && !NON_FALLBACK_SKIP_PHASE_KEYS.has(keys[i])) progress[keys[i]].skipped = true;
  }

  const currentPhase = keys.find(k => !progress[k].done && !progress[k].skipped) ?? null;
  return { progress, currentPhase };
}

/** 与 status.ts NON_FALLBACK_SKIP_PHASES 对齐（免于 fallback-skip 的 phase）。 */
export const NON_FALLBACK_SKIP_PHASE_KEYS = new Set([
  'phase.3-3-deployment',
  'phase.3-7-deploy',
  'phase.3-8-smoke',
]);

// ── 切片 B2：launched 模块 ProposalStep 派生 ──

interface LaunchedMarkers {
  verifyFail: string;
  verifyPass: string;
  mergePrompt: string[];
  merged: string[];
  deployDone: string;
  smokeFail: string;
  smokePass: string;
}

function markerName(pred: string | null | undefined): string {
  if (!pred || !pred.startsWith('marker:')) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `launched flow 期望 marker: 谓词，实际为 ${pred}`);
  }
  return pred.slice('marker:'.length).trim();
}

function anyPresentList(pred: string | null | undefined): string[] {
  if (!pred || !pred.startsWith('any_present:')) {
    throw new FlowError('FLOW_SCHEMA_INVALID', `launched flow 期望 any_present: 谓词，实际为 ${pred}`);
  }
  const inner = pred.slice('any_present:'.length).trim().replace(/^\[|\]$/g, '');
  return inner.split(',').map(s => s.trim()).filter(Boolean);
}

/** 从 builtin launched flow 提取生命周期 marker/section 名（flow 声明，引擎据此判定）。 */
function extractLaunchedMarkers(): LaunchedMarkers {
  const flow = loadBuiltinFlow('launched');
  const byId: Record<string, { done_when?: string | null; fail_when?: string | null }> = {};
  for (const sub of flow.subflows) for (const n of sub.nodes) byId[n.id] = n;
  const need = (id: string) => {
    const n = byId[id];
    if (!n) throw new FlowError('FLOW_SCHEMA_INVALID', `launched flow 缺少节点 ${id}`);
    return n;
  };
  return {
    verifyFail: markerName(need('verify').fail_when),
    verifyPass: markerName(need('verify').done_when),
    mergePrompt: anyPresentList(need('generate-merge-prompt').done_when),
    merged: anyPresentList(need('apply-merge').done_when),
    deployDone: markerName(need('deploy').done_when),
    smokeFail: markerName(need('smoke').fail_when),
    smokePass: markerName(need('smoke').done_when),
  };
}

/**
 * 复现 detectProposalStep：launched 模块 ProposalStep 改由 builtin launched flow 派生。
 * marker/section 名来自 launched.yaml；分支优先级（VERIFY_FAIL 全局最先、SMOKE 仅在 deploy 完成子块内）
 * 与提案级部署决策（resolveProposalDeploymentDecision）为引擎规则，1:1 镜像旧逻辑。
 */
export function detectProposalStepViaFlow(
  proposalDir: string,
  moduleDefaults: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'> = {},
): ProposalStep {
  const m = extractLaunchedMarkers();
  const exists = (name: string) => existsSync(join(proposalDir, name));
  const anyExists = (names: string[]) => names.some(exists);
  const tasksContent = existsSync(join(proposalDir, 'tasks.md'))
    ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';

  // verify.fail_when（VERIFY_FAIL）—— 全局最先
  if (exists(m.verifyFail)) return 'verify-failed';

  // verify.done_when（VERIFY_PASS）—— 进入 deliver/deploy 子块
  if (exists(m.verifyPass)) {
    const deploy = getDeploySectionSummary(tasksContent);
    const hasDeployTasks = Boolean(deploy && deploy.total > 0);
    const deploymentDecision = resolveProposalDeploymentDecision(proposalDir, moduleDefaults);

    if (deploymentDecision.deployment_decision_conflict) return 'verify-passed';
    if (deploymentDecision.deployment_required !== true) return 'verify-passed';
    if (!hasDeployTasks) return 'ready-to-deploy';

    const deployDone = exists(m.deployDone);
    const deployTasksChecked = deploy!.checked === deploy!.total;
    if (!deployDone || !deployTasksChecked) return 'ready-to-deploy';

    // smoke.fail_when/done_when —— 仅在 deploy 完成子块内评估（非全局优先）
    if (exists(m.smokeFail)) return 'smoke-failed';
    if (exists(m.smokePass)) return 'smoke-passed';
    if (deploymentDecision.smoke_required === false) return 'deploy-done';
    if (deploymentDecision.smoke_required === true) return 'ready-to-smoke';
    if (hasSmokeCasesForProposal(proposalDir)) return 'ready-to-smoke';
    return 'deploy-done';
  }

  // apply-merge.done_when（SPEC_MERGED | MERGED）
  if (anyExists(m.merged)) {
    const sections = parseTaskSections(tasksContent);
    if (sections !== null) {
      const code = sections['code'];
      // section_complete legacy 语义：present-but-empty（total=0）不算完成
      if (!code || (code.total > 0 && code.checked === code.total)) return 'ready-to-verify';
      return 'coding';
    }
    return 'ready-to-verify';
  }

  // generate-merge-prompt.done_when（MERGE_PROMPT_GENERATED | MERGE_PROMPT.md）
  if (anyExists(m.mergePrompt)) return 'merge-generated';

  // write-proposal.done_when（proposal_package_filled = proposal.md + tasks.md 均脱模板）
  const proposalContent = existsSync(join(proposalDir, 'proposal.md'))
    ? readFileSync(join(proposalDir, 'proposal.md'), 'utf-8') : '';
  if (!isProposalTemplateFilled(proposalContent) || !isTasksTemplateFilled(tasksContent)) {
    return 'writing';
  }

  // write-delta.done_when（section_complete:delta）/ code（section_complete:code）
  const sections = parseTaskSections(tasksContent);
  if (sections !== null) {
    const delta = sections['delta'];
    const code = sections['code'];
    if (!delta) {
      // 无 [delta] section = 纯代码提案（区别于 present-but-empty 的 [delta]）
      if (!code || (code.total > 0 && code.checked === code.total)) return 'ready-to-verify';
      return 'coding';
    }
    if (delta.total > 0 && delta.checked === delta.total) return 'ready-to-merge';
    return 'delta-writing';
  }

  // 旧格式兜底
  const mergeableDeltaCount = countMergeableDeltaFiles(proposalDir);
  if (mergeableDeltaCount > 0 && allTasksChecked(tasksContent)) return 'ready-to-merge';
  return 'delta-writing';
}
