import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t, PHASE_KEYS, SUGGEST_KEYS } from '../i18n.js';
import { buildInitialPhasePlan, deriveModulePhaseProgressViaFlow, flowExplicitSkipPhaseKeys, detectProposalStepViaFlow } from '../lib/flow-derive.js';
import { deriveOverlayView } from '../lib/flow-overlay-derive.js';
import type { OverlayNode, CurrentNode, OverlayView, CmdEval } from '../lib/flow-overlay-derive.js';
import { deriveLoopState, isLoopBlocking } from '../lib/flow-loop-derive.js';
import type { LoopState } from '../lib/flow-loop-derive.js';
import { FlowError } from '../lib/flow.js';
import { listFiles } from '../lib/list-files.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { readProjectYaml, isAdoptedBootstrap } from '../lib/project-yaml.js';
import type { BootstrapMode, YamlDiagnostics } from '../lib/project-yaml.js';
// proposal-lifecycle 函数簇已下沉到 ../lib/proposal-lifecycle.js（断开与 flow-derive.ts 的运行时循环依赖）。
import {
  countTasks,
  countMergeableDeltaFiles,
  parseTaskSections,
  extractTaskSectionItems,
  readTaskSectionItems,
  getDeployTasks,
  parseProposalDeploymentDecision,
  resolveDeploymentProgress,
  resolveDeploymentDocument,
  resolveProposalDeploymentDecision,
  detectProposalStep,
} from '../lib/proposal-lifecycle.js';
import type {
  ProposalStep,
  DeploymentDecisionSource,
  ProposalDeploymentDecision,
  DeploymentProgressStatus,
  DeploymentProgress,
  DeploymentDocument,
  TaskItem,
} from '../lib/proposal-lifecycle.js';

// re-export 保持对外接口与测试 import 路径不变。
export {
  parseTaskSections,
  extractTaskSectionItems,
  readTaskSectionItems,
  getDeployTasks,
  parseProposalDeploymentDecision,
  resolveDeploymentProgress,
  resolveDeploymentDocument,
  resolveProposalDeploymentDecision,
  detectProposalStep,
};
export type {
  ProposalStep,
  DeploymentDecisionSource,
  ProposalDeploymentDecision,
  DeploymentProgressStatus,
  DeploymentProgress,
  DeploymentDocument,
  TaskItem,
};

interface PhaseStatus {
  key: string;
  label: string;
  path: string;
  done: boolean;
  skipped: boolean;
  files: string[];
}

interface ProposalInfo {
  name: string;
  hasProposal: boolean;
  hasTasks: boolean;
  deltaCount: number;
}

export interface ModuleInfo {
  id: string;
  name: string;
  lifecycle: 'initial' | 'launched';
  bootstrap?: BootstrapMode;
  skip_phases?: string[];
  deployment_required?: boolean;
  smoke_required?: boolean;
}

interface ScenarioCoverage {
  total: number;
  covered: number;
  missing: string[];
}

export interface PhaseProgressItem {
  done: boolean;
  skipped: boolean;
  skip_reason?: string;
  scenario_coverage?: ScenarioCoverage;
}

export interface ModuleStatusItem {
  id: string;
  name: string;
  lifecycle: 'initial' | 'launched';
  bootstrap?: BootstrapMode;
  current_phase: string | null;
  current_phase_label: string | null;
  phase_progress: Record<string, PhaseProgressItem> | null;
  active_change: {
    slug: string;
    proposal_step: ProposalStep;
    proposal_step_label: string;
    has_proposal: boolean;
    has_tasks: boolean;
    tasks_checked: number;
    tasks_total: number;
    delta_count: number;
    deployment_required: boolean | null;
    smoke_required: boolean | null;
    deployment_reason: string | null;
    deployment_decision_source: DeploymentDecisionSource;
    deployment_decision_conflict: boolean;
    deployment_decision_conflict_reason: string | null;
    deployment_progress: DeploymentProgress;
    deployment_document: DeploymentDocument;
    deployment_warnings?: string[];
    deploy_tasks?: TaskItem[];
  } | null;
  suggestion: string;
  // M2 切片 1a：overlay 驱动派生（仅存在已到达 overlay-added 节点 / 当前为 overlay-added 时输出）
  overlay_nodes?: OverlayNode[];
  current_node?: CurrentNode;
  // M2 切片 2：loop 真迭代派生（仅 overlay set-loop 激活、非 initial 多模块时输出）
  loop_state?: LoopState;
}

export interface StatusData {
  phases: Array<{ key: string; label: string; done: boolean; skipped: boolean; files: string[] }>;
  modules?: ModuleStatusItem[];
  active_proposals: Array<{
    name: string;
    has_proposal: boolean;
    has_tasks: boolean;
    delta_count: number;
  }>;
  current_phase: string | null;
  suggestion: string;
  all_done: boolean;
  lifecycle: string;
  locale: string;
  source_roots: { src: string[]; test: string[] } | null;
  active_change: string | null;
  proposal_step: ProposalStep | null;
  yaml_diagnostics: YamlDiagnostics | null;
  // M2 切片 1a：legacy 无 modules[] 项目的 overlay 顶层回退（有 modules[] 时挂 modules[] 下）
  overlay_nodes?: OverlayNode[];
  current_node?: CurrentNode;
  // M2 切片 2：loop 真迭代派生顶层回退（legacy 无 modules[] 时）
  loop_state?: LoopState;
}

// Phase paths indexed by PHASE_KEYS order
const PHASE_SUBPATHS = [
  'logos/resources/prd/1-product-requirements',
  'logos/resources/prd/2-product-design',
  'logos/resources/prd/3-technical-plan/1-architecture',
  'logos/resources/prd/3-technical-plan/2-scenario-implementation',
  'logos/resources/api',
  'logos/resources/database',
  'logos/resources/prd/3-technical-plan/3-deployment',
  'logos/resources/test',
  'logos/resources/scenario',
  'logos/resources/implementation',
  'logos/resources/verify/acceptance-report.md',
  'logos/resources/verify/deployment-report.md',
  'logos/resources/verify/smoke-report.md',
];

// Phases that require per-scenario file coverage
const SCENARIO_PHASES = new Set(['phase.3-1', 'phase.3-4a']);

const NON_FALLBACK_SKIP_PHASES = new Set([
  'phase.3-3-deployment',
  'phase.3-7-deploy',
  'phase.3-8-smoke',
]);

// listFiles 已下沉到 ../lib/list-files.js（断开与 flow-derive.ts 的运行时循环依赖）；re-export 保持对外接口不变。
export { listFiles };

// skip_phases value → PHASE_KEY mapping
const SKIP_PHASE_MAP: Record<string, string> = {
  api:      'phase.3-2-api',
  database: 'phase.3-2-db',
  scenario: 'phase.3-4b',
};

function deriveExplicitSkipPhaseKeys(mod: ModuleInfo): Set<string> {
  const explicitSkip = new Set((mod.skip_phases ?? []).map(s => SKIP_PHASE_MAP[s]).filter(Boolean));
  if ((mod.skip_phases ?? []).includes('deployment') || mod.deployment_required === false) {
    explicitSkip.add('phase.3-7-deploy');
    explicitSkip.add('phase.3-8-smoke');
  } else if (mod.smoke_required === false) {
    explicitSkip.add('phase.3-8-smoke');
  }
  return explicitSkip;
}

// 保留旧硬编码派生，供 B1 测试期「新派生==旧逻辑」并跑等价断言对照（不再用于生产路径）。
export function deriveModulePhaseProgress(
  root: string,
  mod: ModuleInfo,
  scenarios: Array<{ id: string }>,
  isMultiModule: boolean = false,
): { progress: Record<string, PhaseProgressItem>; currentPhase: string | null } {
  const progress: Record<string, PhaseProgressItem> = {};
  const isBootstrapAdopted = isAdoptedBootstrap(mod.bootstrap);

  // Build set of phase keys to skip from explicit skip_phases declaration
  const explicitSkip = deriveExplicitSkipPhaseKeys(mod);

  for (let i = 0; i < PHASE_KEYS.length; i++) {
    const key = PHASE_KEYS[i];
    const dir = join(root, PHASE_SUBPATHS[i]);

    if (isBootstrapAdopted && (key === 'phase.1' || key === 'phase.2' || key === 'phase.3-0')) {
      progress[key] = { done: false, skipped: true, skip_reason: 'bootstrap-adopted' };
      continue;
    }

    // Explicitly skipped via skip_phases
    if (explicitSkip.has(key)) {
      progress[key] = { done: false, skipped: true };
      continue;
    }

    if (SCENARIO_PHASES.has(key)) {
      // Per-scenario coverage check
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
      // In multi-module projects, only count files with the module's prefix.
      // In single-module projects, any file in the directory counts (backward compat).
      const allFiles = listFiles(dir);
      const files = isMultiModule
        ? allFiles.filter(f => (f.split('/').pop() ?? f).startsWith(`${mod.id}-`))
        : allFiles;
      progress[key] = { done: files.length > 0, skipped: false };
    }
  }

  // Fallback: mark skipped for empty phases that appear before a done phase
  // (handles projects without skip_phases declared — backward compatibility)
  const keys = PHASE_KEYS;
  const lastDoneIdx = keys.reduce((acc, k, i) => (progress[k].done ? i : acc), -1);
  for (let i = 0; i < lastDoneIdx; i++) {
    if (!progress[keys[i]].done && !NON_FALLBACK_SKIP_PHASES.has(keys[i])) progress[keys[i]].skipped = true;
  }

  const currentPhase = keys.find(k => !progress[k].done && !progress[k].skipped) ?? null;
  return { progress, currentPhase };
}

function buildModuleStatusItem(
  root: string,
  mod: ModuleInfo,
  scenarios: Array<{ id: string }>,
  locale: string,
  guardActiveChange: string | null,
  guardModule: string | null,
  isMultiModule: boolean = false,
  cmdEval?: CmdEval,
): ModuleStatusItem {
  if (mod.lifecycle === 'launched') {
    let activeChange: ModuleStatusItem['active_change'] = null;

    if (guardActiveChange && guardModule === mod.id) {
      const proposalDir = join(root, 'logos', 'changes', guardActiveChange);
      const deploymentDecision = existsSync(proposalDir)
        ? resolveProposalDeploymentDecision(proposalDir, mod)
        : {
            deployment_required: null,
            smoke_required: null,
            deployment_reason: null,
            deployment_decision_source: 'legacy-fallback' as const,
            deployment_decision_conflict: false,
            deployment_decision_conflict_reason: null,
            deployment_warnings: [],
          };
      const deploymentProgress = resolveDeploymentProgress(proposalDir);
      const deploymentDocument = resolveDeploymentDocument(root, guardActiveChange);
      const step = existsSync(proposalDir) ? detectProposalStepViaFlow(proposalDir, mod) : 'writing';
      const stepLabel = t(locale as Parameters<typeof t>[0], `status.proposalStep.${step}`);
      const hasProposal = existsSync(join(proposalDir, 'proposal.md'));
      const hasTasksFile = existsSync(join(proposalDir, 'tasks.md'));
      const tasksContent = hasTasksFile ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
      const { checked, total } = countTasks(tasksContent);
      const deltaCount = countMergeableDeltaFiles(proposalDir);
      const deployTasks = getDeployTasks(proposalDir);

      activeChange = {
        slug: guardActiveChange,
        proposal_step: step,
        proposal_step_label: stepLabel,
        has_proposal: hasProposal,
        has_tasks: hasTasksFile,
        tasks_checked: checked,
        tasks_total: total,
        delta_count: deltaCount,
        deployment_required: deploymentDecision.deployment_required,
        smoke_required: deploymentDecision.smoke_required,
        deployment_reason: deploymentDecision.deployment_reason,
        deployment_decision_source: deploymentDecision.deployment_decision_source,
        deployment_decision_conflict: deploymentDecision.deployment_decision_conflict,
        deployment_decision_conflict_reason: deploymentDecision.deployment_decision_conflict_reason,
        deployment_progress: deploymentProgress,
        deployment_document: deploymentDocument,
        ...(deploymentDecision.deployment_warnings.length > 0
          ? { deployment_warnings: deploymentDecision.deployment_warnings }
          : {}),
        ...(deployTasks.length > 0 ? { deploy_tasks: deployTasks } : {}),
      };
    }

    // M2 切片 2：loop 真迭代派生（launched 用提案目录账本）。**必须在 suggestion 计算之前**完成 step 回拉，
    // 否则旧 VERIFY_PASS 生成的「验收通过，可 archive」建议会残留（F1 文案不一致）。
    const launchedProposalDir = guardActiveChange && guardModule === mod.id
      ? join(root, 'logos', 'changes', guardActiveChange) : null;
    const loopState = deriveLoopState(root, mod, launchedProposalDir, isMultiModule);
    if (activeChange) {
      const gatedStep = gateLaunchedStepForLoop(activeChange.proposal_step, loopState);
      if (gatedStep && gatedStep !== activeChange.proposal_step) {
        activeChange.proposal_step = gatedStep;
        activeChange.proposal_step_label = t(locale as Parameters<typeof t>[0], `status.proposalStep.${gatedStep}`);
      }
    }

    let suggestion: string;
    if (activeChange) {
      if (activeChange.deployment_decision_conflict) {
        suggestion = locale === 'zh'
          ? '部署决策冲突，请先修正 proposal.md 与 tasks.md 后再继续。'
          : 'Deployment decision conflict — fix proposal.md and tasks.md before continuing.';
      } else if (activeChange.proposal_step === 'ready-to-merge') {
        suggestion = locale === 'zh'
          ? `明确授权执行 openlogos merge ${activeChange.slug}`
          : `Explicitly request: openlogos merge ${activeChange.slug}`;
      } else if (activeChange.proposal_step === 'merge-generated') {
        suggestion = locale === 'zh'
          ? `让 AI 读取 logos/changes/${activeChange.slug}/MERGE_PROMPT.md 并执行规格合并；完成后写入 SPEC_MERGED`
          : `Ask AI to read logos/changes/${activeChange.slug}/MERGE_PROMPT.md and merge specs; write SPEC_MERGED when done`;
      } else if (activeChange.proposal_step === 'coding') {
        suggestion = locale === 'zh'
          ? `按已合并规格实现代码，完成后勾选 [code] section 所有任务`
          : `Implement code from merged specs, then check off all [code] section tasks`;
      } else if (activeChange.proposal_step === 'ready-to-verify') {
        suggestion = locale === 'zh'
          ? `代码已完成，明确授权执行 openlogos verify`
          : `Code is done — explicitly request: openlogos verify`;
      } else if (activeChange.proposal_step === 'verify-passed') {
        suggestion = locale === 'zh'
          ? `验收通过，明确授权执行 openlogos archive ${activeChange.slug}`
          : `Verification passed — explicitly request: openlogos archive ${activeChange.slug}`;
      } else if (activeChange.proposal_step === 'ready-to-deploy') {
        suggestion = locale === 'zh'
          ? `验收通过且存在部署任务。部署是人类确认点，请明确授权 AI 按部署方案执行部署`
          : `Verification passed with deployment tasks. Deployment is a human confirmation point — explicitly authorize AI to deploy from the deployment plan`;
      } else if (activeChange.proposal_step === 'deploy-done') {
        suggestion = locale === 'zh'
          ? `部署已完成。若无需 smoke，可明确授权执行 openlogos archive ${activeChange.slug}`
          : `Deployment is done. If smoke is not required, explicitly request: openlogos archive ${activeChange.slug}`;
      } else if (activeChange.proposal_step === 'ready-to-smoke') {
        suggestion = locale === 'zh'
          ? `部署已完成，明确授权执行 openlogos smoke`
          : `Deployment is done — explicitly request: openlogos smoke`;
      } else if (activeChange.proposal_step === 'smoke-passed') {
        suggestion = locale === 'zh'
          ? `部署冒烟测试通过，明确授权执行 openlogos archive ${activeChange.slug}`
          : `Smoke passed — explicitly request: openlogos archive ${activeChange.slug}`;
      } else if (activeChange.proposal_step === 'smoke-failed') {
        suggestion = locale === 'zh'
          ? `部署冒烟测试未通过，修复部署环境或 smoke 问题后重新运行 openlogos smoke`
          : `Smoke failed — fix the deployment environment or smoke checks, then run openlogos smoke again`;
      } else if (activeChange.proposal_step === 'verify-failed') {
        suggestion = locale === 'zh'
          ? `验收未通过，修复问题后重新运行 openlogos verify`
          : `Verification failed — fix the issues and run openlogos verify again`;
      } else if (activeChange.proposal_step === 'delta-writing' || activeChange.proposal_step === 'implementing' || activeChange.proposal_step === 'in-progress') {
        suggestion = locale === 'zh'
          ? `继续为 ${activeChange.slug} 产出 delta 文件，完成后明确授权执行 openlogos merge ${activeChange.slug}`
          : `Continue writing delta files for ${activeChange.slug}, then explicitly request: openlogos merge ${activeChange.slug}`;
      } else {
        suggestion = locale === 'zh'
          ? `继续完善 ${activeChange.slug}`
          : `Continue working on ${activeChange.slug}`;
      }
    } else if (guardActiveChange && guardModule !== mod.id) {
      suggestion = locale === 'zh'
        ? `当前提案 ${guardActiveChange}（归属 ${guardModule ?? '?'}）未完成，请先完成后再为此模块创建新提案`
        : `Active proposal ${guardActiveChange} (module: ${guardModule ?? '?'}) is in progress — finish it before creating a new proposal for this module`;
    } else {
      suggestion = isAdoptedBootstrap(mod.bootstrap)
        ? (locale === 'zh'
            ? '先补充项目基线文档（openlogos change add-baseline-docs）'
            : 'Fill in baseline docs first (openlogos change add-baseline-docs)')
        : (locale === 'zh'
            ? '运行 openlogos change <slug> 创建新提案'
            : 'Run openlogos change <slug> to create a new change proposal');
    }

    const loopHalt = loopHaltSubflow(loopState);
    const overlay = deriveOverlayView(root, mod, scenarios, launchedProposalDir, isMultiModule, cmdEval, loopHalt);
    if (overlay && activeChange && overlay.proposal_step_override) {
      // 当前节点为 overlay-added → proposal_step 回退到前序最近 builtin step（合法枚举）
      activeChange.proposal_step = overlay.proposal_step_override as ProposalStep;
      activeChange.proposal_step_label = t(locale as Parameters<typeof t>[0], `status.proposalStep.${overlay.proposal_step_override}`);
    }
    if (overlay && overlay.current_node) {
      // Review F3：当前卡在未完成 overlay 节点 → suggestion 指向该节点，不再提示后续 builtin gate/merge/verify
      const cn = overlay.current_node;
      suggestion = locale === 'zh'
        ? `先完成 overlay 节点「${cn.name}」（${cn.id}）${cn.state === 'failed' ? '（失败，需修复）' : ''}；其完成判定见 flow 后再继续。`
        : `Finish overlay node "${cn.name}" (${cn.id})${cn.state === 'failed' ? ' (failed — fix it)' : ''} before continuing.`;
    }

    // 仅当前沿已到 verify（ready-to-verify / verify-failed）才进入 loop 阻塞语义，不抢占前序停顿点（F1）
    const launchedAtVerify = activeChange?.proposal_step === 'ready-to-verify' || activeChange?.proposal_step === 'verify-failed';
    if (isLoopBlocking(loopState, launchedAtVerify) && loopState) {
      suggestion = loopState.escalated
        ? (locale === 'zh'
            ? `loop 已达迭代上限 ${loopState.max_iters} 轮仍未绿 → 升级人类确认（继续迭代 / 调整 / 放弃）。`
            : `Loop hit max_iters=${loopState.max_iters} without green — human decision needed (continue / adjust / abandon).`)
        : (locale === 'zh'
            ? `loop 第 ${loopState.iteration}/${loopState.max_iters} 轮未绿 → 修复后重跑 openlogos verify（继续迭代）。`
            : `Loop round ${loopState.iteration}/${loopState.max_iters} not green — fix and rerun openlogos verify.`);
    }

    return {
      id: mod.id,
      name: mod.name,
      lifecycle: 'launched',
      bootstrap: mod.bootstrap,
      current_phase: null,
      current_phase_label: null,
      phase_progress: null,
      active_change: activeChange,
      suggestion,
      ...(overlay && overlay.overlay_nodes.length > 0 ? { overlay_nodes: overlay.overlay_nodes } : {}),
      ...(overlay && overlay.current_node ? { current_node: overlay.current_node } : {}),
      ...(loopState ? { loop_state: loopState } : {}),
    };
  }

  // initial lifecycle —— B1：改用 builtin flow 派生（1:1 不改行为）
  const derived = deriveModulePhaseProgressViaFlow(root, mod, scenarios, isMultiModule);
  // M2 切片 2（R8）：loop 激活且未收敛 → verify(phase.3-6) 不得 done、current 钉在 3-6，不推进到 deploy/launch
  const loopState = deriveLoopState(root, mod, null, isMultiModule);
  const gated = gateInitialPhasesForLoop(derived.progress, derived.currentPhase, loopState);
  const progress = gated.progress;
  const currentPhase = gated.currentPhase;
  const currentPhaseLabel = currentPhase ? t(locale as Parameters<typeof t>[0], currentPhase) : null;

  let suggestion: string;
  if (!currentPhase) {
    suggestion = locale === 'zh' ? '所有阶段已完成' : 'All phases complete';
  } else if (
    isAdoptedBootstrap(mod.bootstrap)
    && (currentPhase === 'phase.1' || currentPhase === 'phase.2' || currentPhase === 'phase.3-0')
  ) {
    suggestion = locale === 'zh'
      ? '文档基线已跳过（存量项目接入）'
      : 'Documentation baseline skipped (adopted access mode)';
  } else {
    const suggestKey = SUGGEST_KEYS[currentPhase];
    suggestion = suggestKey
      ? t(locale as Parameters<typeof t>[0], suggestKey)
      : (locale === 'zh' ? '继续推进当前阶段' : 'Continue current phase');
  }

  const overlay = deriveOverlayView(root, mod, scenarios, null, isMultiModule, cmdEval, loopHaltSubflow(loopState));
  if (overlay && overlay.current_node) {
    const cn = overlay.current_node;
    suggestion = locale === 'zh'
      ? `先完成 overlay 节点「${cn.name}」（${cn.id}）${cn.state === 'failed' ? '（失败，需修复）' : ''}后再继续。`
      : `Finish overlay node "${cn.name}" (${cn.id})${cn.state === 'failed' ? ' (failed — fix it)' : ''} before continuing.`;
  }

  // 仅当前沿已到 verify(phase.3-6) 才进入 loop 阻塞语义（按 pre-gate 当前阶段判断，F1）
  const vIdx = (PHASE_KEYS as readonly string[]).indexOf('phase.3-6');
  const initialAtVerify = derived.currentPhase === null
    || (PHASE_KEYS as readonly string[]).indexOf(derived.currentPhase) >= vIdx;
  if (isLoopBlocking(loopState, initialAtVerify) && loopState) {
    suggestion = loopState.escalated
      ? (locale === 'zh'
          ? `loop 已达迭代上限 ${loopState.max_iters} 轮仍未绿 → 升级人类确认（继续迭代 / 调整 / 放弃）。`
          : `Loop hit max_iters=${loopState.max_iters} without green — human decision needed.`)
      : (locale === 'zh'
          ? `loop 第 ${loopState.iteration}/${loopState.max_iters} 轮未绿 → 修复后重跑 openlogos verify（继续迭代）。`
          : `Loop round ${loopState.iteration}/${loopState.max_iters} not green — fix and rerun openlogos verify.`);
  }

  return {
    id: mod.id,
    name: mod.name,
    lifecycle: 'initial',
    bootstrap: mod.bootstrap,
    current_phase: currentPhase,
    current_phase_label: currentPhaseLabel,
    phase_progress: progress,
    active_change: null,
    suggestion,
    ...(overlay && overlay.overlay_nodes.length > 0 ? { overlay_nodes: overlay.overlay_nodes } : {}),
    ...(overlay && overlay.current_node ? { current_node: overlay.current_node } : {}),
    ...(loopState ? { loop_state: loopState } : {}),
  };
}

/**
 * R8：loop 激活且未收敛时，把 initial 的 verify(phase.3-6) 钉为未完成、当前阶段拉回 3-6，
 * 阻止因 acceptance-report.md 存在（FAIL 也写）而误推进到 deploy/smoke/launch。
 * 未激活 / 已收敛 → 原样返回（golden 零漂移）。
 */
function gateInitialPhasesForLoop(
  progress: Record<string, PhaseProgressItem>,
  currentPhase: string | null,
  loopState: LoopState | null,
): { progress: Record<string, PhaseProgressItem>; currentPhase: string | null } {
  if (!loopState || loopState.converged) return { progress, currentPhase }; // 出环用 converged 裁决（含 iteration=0 + 旧 report）
  const VERIFY = 'phase.3-6';
  const next = { ...progress };
  if (next[VERIFY]) next[VERIFY] = { ...next[VERIFY], done: false };
  const keys = PHASE_KEYS as readonly string[];
  const verifyIdx = keys.indexOf(VERIFY);
  const curIdx = currentPhase ? keys.indexOf(currentPhase) : Number.MAX_SAFE_INTEGER;
  // 仅在当前已推过 verify（或全完成）时拉回；若仍在 code(3-5) 之前则保持
  const newCurrent = (curIdx > verifyIdx) ? VERIFY : currentPhase;
  return { progress: next, currentPhase: newCurrent };
}

/**
 * F3：loop 激活且未收敛时返回需 halt 的 subflow id，供 overlay 走查不越过 implement。
 * 出环用 `converged` 裁决（不要求 iteration≥1）——即便 acceptance-report.md/VERIFY_PASS 已存在，
 * 未收敛就不得让 verify 之后的 overlay-added 节点变 current。
 */
function loopHaltSubflow(loopState: LoopState | null): string | undefined {
  return loopState && !loopState.converged ? loopState.subflow_id : undefined;
}

/** launched 阶段对 loop 出环把关：loop 激活且未收敛时，把「verify 已 done 或更后」的 step 拉回 ready-to-verify。 */
const STEP_PAST_VERIFY = new Set<ProposalStep>([
  'verify-passed', 'ready-to-deploy', 'deploy-done', 'ready-to-smoke', 'smoke-passed', 'smoke-failed',
]);
function gateLaunchedStepForLoop(step: ProposalStep | null, loopState: LoopState | null): ProposalStep | null {
  if (!loopState || loopState.converged || !step) return step;
  return STEP_PAST_VERIFY.has(step) ? 'ready-to-verify' : step;
}

/** 项目级 loop_state（顶层 phases 把关 + legacy 顶层字段）：定位活跃/synth 模块后 deriveLoopState。 */
function computeProjectLoopState(
  root: string,
  rawModules: ModuleInfo[] | undefined,
  lifecycle: 'initial' | 'launched',
  activeChange: string | null,
  guardModule: string | null,
): LoopState | null {
  if (rawModules === undefined) {
    const synthMod: ModuleInfo = { id: 'core', name: 'core', lifecycle };
    const proposalDir = activeChange ? join(root, 'logos', 'changes', activeChange) : null;
    return deriveLoopState(root, synthMod, proposalDir, false);
  }
  const isMulti = rawModules.length > 1;
  const target = rawModules.find(m => m.id === guardModule) ?? (rawModules.length === 1 ? rawModules[0] : undefined);
  if (!target) return null;
  const proposalDir = activeChange && guardModule === target.id ? join(root, 'logos', 'changes', activeChange) : null;
  return deriveLoopState(root, target, proposalDir, isMulti);
}

/**
 * 为「当前活跃模块」重新派生 overlay 视图（next 的 cmd 求值路径专用）。
 *
 * 复用 collectStatusData 的模块/场景/proposalDir 解析，但允许传入 cmdEval：
 * - 不传 cmdEval（观察）→ 用于取 `pending_cmd`（待执行 cmd 节点）；
 * - 传 cmdEval（求值）→ next 执行命令后回灌结果，得到该节点 done/failed/active 的续推视图。
 *
 * 返回 null 表示无 overlay（golden 零漂移）或无法定位活跃模块。
 */
export function deriveActiveOverlay(
  root: string,
  filterModuleId?: string,
  cmdEval?: CmdEval,
): OverlayView | null {
  const projectYaml = readProjectYaml(root);
  // 必须与 collectStatusData 的模块解析对齐（含 deployment_required/smoke_required + deployment_gates 覆盖），
  // 否则 launched 的 deploy/smoke 区域 when 判定会用错默认值 → next 预派生与 status 看到的 current/pending 漂移。
  const rawModules: ModuleInfo[] | undefined = Array.isArray(projectYaml.data?.modules)
    ? projectYaml.data.modules.map(m => ({
        id: m.id,
        name: m.name,
        lifecycle: (m.lifecycle === 'launched' ? 'launched' : 'initial') as 'initial' | 'launched',
        bootstrap: m.bootstrap ?? 'normal',
        skip_phases: Array.isArray(m.skip_phases) ? m.skip_phases : [],
        deployment_required: typeof m.deployment_required === 'boolean' ? m.deployment_required : undefined,
        smoke_required: typeof m.smoke_required === 'boolean' ? m.smoke_required : undefined,
      }))
    : undefined;
  if (rawModules) {
    const deploymentGates = projectYaml.data?.deployment_gates ?? {};
    for (const mod of rawModules) {
      const gates = deploymentGates[mod.id];
      if (gates) {
        if (typeof gates.deployment_required === 'boolean') mod.deployment_required = gates.deployment_required;
        if (typeof gates.smoke_required === 'boolean') mod.smoke_required = gates.smoke_required;
      }
    }
  }
  const scenarios: Array<{ id: string; module?: string }> = Array.isArray(projectYaml.data?.scenarios)
    ? projectYaml.data.scenarios : [];

  // guard：定位活跃提案及其归属模块
  let activeChange: string | null = null;
  let guardModule: string | null = null;
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      activeChange = guard.activeChange || null;
      guardModule = guard.module || null;
    } catch { /* ignore */ }
  }

  // legacy（无 modules[]）→ synth core，顶层派生
  if (rawModules === undefined) {
    const lifecycle: 'initial' | 'launched' = activeChange ? 'launched' : 'initial';
    const synthMod: ModuleInfo = { id: 'core', name: 'core', lifecycle };
    const proposalDir = activeChange ? join(root, 'logos', 'changes', activeChange) : null;
    return deriveOverlayView(root, synthMod, scenarios, proposalDir, false, cmdEval,
      loopHaltSubflow(deriveLoopState(root, synthMod, proposalDir, false)));
  }

  const isMultiModule = rawModules.length > 1;
  // 目标模块：显式 filter > guard 归属模块 > 单模块兜底
  const target = filterModuleId
    ? rawModules.find(m => m.id === filterModuleId)
    : (rawModules.find(m => m.id === guardModule) ?? (rawModules.length === 1 ? rawModules[0] : undefined));
  if (!target) return null;

  const moduleScenarios = scenarios.filter(s => (s.module ?? 'core') === target.id);
  const proposalDir = activeChange && guardModule === target.id
    ? join(root, 'logos', 'changes', activeChange) : null;
  return deriveOverlayView(root, target, moduleScenarios, proposalDir, isMultiModule, cmdEval,
    loopHaltSubflow(deriveLoopState(root, target, proposalDir, isMultiModule)));
}

export function collectStatusData(root: string, filterModuleId?: string, cmdEval?: CmdEval): StatusData {
  const configPath = join(root, 'logos', 'logos.config.json');
  const locale = readLocale(root);

  // ── Read YAML first so skip_phases is available before phase calculation ──
  let lifecycle: 'initial' | 'launched' = 'initial';
  let sourceRoots: { src: string[]; test: string[] } | null = null;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    sourceRoots = config.sourceRoots ?? null;
  } catch { /* ignore */ }

  let rawModules: ModuleInfo[] | undefined;
  let scenarios: Array<{ id: string; module?: string }> = [];
  let yamlDiagnostics: YamlDiagnostics | null = null;
  // Global skip: only skip a phase if ALL initial modules declare it in skip_phases
  // (intersection, not union — one module needing a phase is enough to keep it)
  const globalSkipPhaseKeys = new Set<string>();
  // B1：phase 计划改由 builtin flow 派生（顺序/路径/场景标记/skip 来源均来自 flow）
  const phasePlan = buildInitialPhasePlan(root);

  const projectYaml = readProjectYaml(root);
  yamlDiagnostics = projectYaml.yaml_diagnostics;
  if (Array.isArray(projectYaml.data?.modules)) {
    rawModules = projectYaml.data.modules.map(m => ({
      id: m.id,
      name: m.name,
      lifecycle: (m.lifecycle === 'launched' ? 'launched' : 'initial') as 'initial' | 'launched',
      bootstrap: m.bootstrap ?? 'normal',
      skip_phases: Array.isArray(m.skip_phases) ? m.skip_phases : [],
      deployment_required: typeof m.deployment_required === 'boolean'
        ? m.deployment_required
        : undefined,
      smoke_required: typeof m.smoke_required === 'boolean'
        ? m.smoke_required
        : undefined,
    }));
    const deploymentGates = projectYaml.data.deployment_gates ?? {};
    for (const mod of rawModules) {
      const gates = deploymentGates[mod.id];
      if (gates) {
        if (typeof gates.deployment_required === 'boolean') mod.deployment_required = gates.deployment_required;
        if (typeof gates.smoke_required === 'boolean') mod.smoke_required = gates.smoke_required;
      }
    }
    if (rawModules.some(m => m.lifecycle === 'launched')) {
      lifecycle = 'launched';
    }
    // Intersection: a phase key is globally skipped only if every initial module skips it
    const initialModules = rawModules.filter(m => m.lifecycle === 'initial');
    if (initialModules.length > 0) {
      for (const item of phasePlan) {
        if (initialModules.every(m => flowExplicitSkipPhaseKeys(m, phasePlan).has(item.phaseKey))) {
          globalSkipPhaseKeys.add(item.phaseKey);
        }
      }
    }
  }
  if (Array.isArray(projectYaml.data?.scenarios)) {
    scenarios = projectYaml.data.scenarios;
  }

  // ── Build top-level phases from flow plan, applying skip_phases ──
  const phases: PhaseStatus[] = phasePlan.map(item => ({
    key: item.phaseKey,
    label: t(locale, item.phaseKey),
    path: join(root, item.subpath),
    done: false,
    // 显式 when-skip 或 overlay op:skip（resolved flow 的 node.skipped）均标 skipped（Review F2）
    skipped: globalSkipPhaseKeys.has(item.phaseKey) || item.overlaySkipped === true,
    files: [],
  }));

  for (const phase of phases) {
    if (phase.skipped) continue; // don't scan explicitly skipped dirs
    phase.files = listFiles(phase.path);
    phase.done = phase.files.length > 0;
  }

  const bootstrapAdoptedModules = rawModules?.filter(m => isAdoptedBootstrap(m.bootstrap)) ?? [];
  if (bootstrapAdoptedModules.length > 0) {
    for (const phase of phases) {
      if (phase.key === 'phase.1' || phase.key === 'phase.2' || phase.key === 'phase.3-0') {
        phase.skipped = true;
        phase.done = false;
        phase.files = [];
      }
    }
  }

  // Fallback: also mark empty phases before the last done phase as skipped
  const lastDoneIdx = phases.reduce((acc, p, i) => (p.done ? i : acc), -1);
  for (let i = 0; i < lastDoneIdx; i++) {
    if (!phases[i].done && !NON_FALLBACK_SKIP_PHASES.has(phases[i].key)) phases[i].skipped = true;
  }

  // Collect active proposals
  const changesDir = join(root, 'logos', 'changes');
  const activeProposals: ProposalInfo[] = [];
  if (existsSync(changesDir)) {
    for (const entry of readdirSync(changesDir)) {
      if (entry === 'archive' || entry === '.gitkeep') continue;
      const entryPath = join(changesDir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      const hasProposal = existsSync(join(entryPath, 'proposal.md'));
      const hasTasks = existsSync(join(entryPath, 'tasks.md'));
      const deltaCount = existsSync(join(entryPath, 'deltas')) ? listFiles(join(entryPath, 'deltas')).length : 0;
      activeProposals.push({ name: entry, hasProposal, hasTasks, deltaCount });
    }
  }

  // Read guard
  let activeChange: string | null = null;
  let proposalStep: ProposalStep | null = null;
  let guardModule: string | null = null;
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (existsSync(guardPath)) {
    try {
      const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
      activeChange = guard.activeChange || null;
      guardModule = guard.module || null;
      if (activeChange) {
        const proposalDir = join(root, 'logos', 'changes', activeChange);
        const guardModuleDefaults = rawModules?.find(m => m.id === guardModule)
          ?? (rawModules?.length === 1 ? rawModules[0] : undefined);
        proposalStep = existsSync(proposalDir)
          ? detectProposalStepViaFlow(proposalDir, guardModuleDefaults)
          : 'writing';
      }
    } catch { /* ignore */ }
  }

  // M2 切片 2（R8）：loop 激活且未收敛 → 顶层 verify(phase.3-6) 不得 done（出环用 converged 裁决、不要求 iteration≥1），
  // 避免旧 acceptance-report.md 让 current_phase/all_done 误推进；同时把 launched step 拉回 ready-to-verify
  const projectLoopState = computeProjectLoopState(root, rawModules, lifecycle, activeChange, guardModule);
  if (projectLoopState && !projectLoopState.converged) {
    const vp = phases.find(p => p.key === 'phase.3-6');
    if (vp && vp.done) vp.done = false;
    proposalStep = gateLaunchedStepForLoop(proposalStep, projectLoopState);
  }

  const firstIncomplete = phases.find(p => !p.done && !p.skipped);
  const allDone = !firstIncomplete;

  // Build module status items
  let modules: ModuleStatusItem[] | undefined;
  if (rawModules !== undefined) {
    const isMultiModule = rawModules.length > 1;
    const filtered = filterModuleId
      ? rawModules.filter(m => m.id === filterModuleId)
      : rawModules;
    modules = filtered.map(m => {
      // Only pass scenarios that belong to this module (module field defaults to 'core')
      const moduleScenarios = scenarios.filter(s => (s.module ?? 'core') === m.id);
      return buildModuleStatusItem(root, m, moduleScenarios, locale, activeChange, guardModule, isMultiModule, cmdEval);
    });
    // M2 切片 1a（Review F3）：当前落在 overlay-added 节点时，活跃模块已对 proposal_step 做了回退，
    // 顶层 proposal_step 必须同步，否则 next 的 action/gate 仍按旧状态判断。
    const activeMod = modules.find(m => m.id === guardModule && m.active_change);
    if (activeMod?.current_node && activeMod.active_change) {
      proposalStep = activeMod.active_change.proposal_step;
    }
  }

  let suggestion: string;
  if (allDone) {
    suggestion = lifecycle === 'launched'
      ? (locale === 'zh'
          ? '运行 openlogos change <slug> 创建新提案'
          : 'Run openlogos change <slug> to create a new change proposal')
      : t(locale, 'launch.suggest');
  } else if (bootstrapAdoptedModules.length > 0 && !activeChange) {
    suggestion = locale === 'zh'
      ? '先补充项目基线文档（openlogos change add-baseline-docs）'
      : 'Fill in baseline docs first (openlogos change add-baseline-docs)';
  } else {
    const suggestKey = SUGGEST_KEYS[firstIncomplete!.key];
    suggestion = suggestKey ? t(locale, suggestKey) : t(locale, 'suggest.fallback');
  }

  // M2 切片 2：legacy loop 阻塞（前沿到 verify、跑过≥1 轮、未收敛）→ 顶层 suggestion 指向 loop（有 modules[] 时由 module 项承载，F1）
  const legacyAtVerify = !firstIncomplete
    || (PHASE_KEYS as readonly string[]).indexOf(firstIncomplete.key) >= (PHASE_KEYS as readonly string[]).indexOf('phase.3-6');
  if (rawModules === undefined && isLoopBlocking(projectLoopState, legacyAtVerify) && projectLoopState) {
    suggestion = projectLoopState.escalated
      ? (locale === 'zh'
          ? `loop 已达迭代上限 ${projectLoopState.max_iters} 轮仍未绿 → 升级人类确认（继续迭代 / 调整 / 放弃）。`
          : `Loop hit max_iters=${projectLoopState.max_iters} without green — human decision needed.`)
      : (locale === 'zh'
          ? `loop 第 ${projectLoopState.iteration}/${projectLoopState.max_iters} 轮未绿 → 修复后重跑 openlogos verify（继续迭代）。`
          : `Loop round ${projectLoopState.iteration}/${projectLoopState.max_iters} not green — fix and rerun openlogos verify.`);
  }

  // M2 切片 1a：legacy 无 modules[] 项目 → overlay 顶层回退（有 modules[] 时挂 module 项下，不在此处）
  let topOverlay: ReturnType<typeof deriveOverlayView> = null;
  if (rawModules === undefined) {
    const synthMod: ModuleInfo = { id: 'core', name: 'core', lifecycle };
    const proposalDir = activeChange ? join(root, 'logos', 'changes', activeChange) : null;
    topOverlay = deriveOverlayView(root, synthMod, scenarios, proposalDir, false, cmdEval, loopHaltSubflow(projectLoopState));
    if (topOverlay && topOverlay.proposal_step_override && proposalStep) {
      proposalStep = topOverlay.proposal_step_override as ProposalStep;
    }
  }

  return {
    phases: phases.map(p => ({ key: p.key, label: p.label, done: p.done, skipped: p.skipped, files: p.files })),
    ...(modules !== undefined ? { modules } : {}),
    ...(topOverlay && topOverlay.overlay_nodes.length > 0 ? { overlay_nodes: topOverlay.overlay_nodes } : {}),
    ...(topOverlay && topOverlay.current_node ? { current_node: topOverlay.current_node } : {}),
    // M2 切片 2：loop_state 顶层回退（仅 legacy 无 modules[]；有 modules[] 时挂 modules[].loop_state）
    ...(rawModules === undefined && projectLoopState ? { loop_state: projectLoopState } : {}),
    active_proposals: activeProposals.map(p => ({
      name: p.name,
      has_proposal: p.hasProposal,
      has_tasks: p.hasTasks,
      delta_count: p.deltaCount,
    })),
    current_phase: firstIncomplete ? firstIncomplete.key : null,
    suggestion,
    all_done: allDone,
    lifecycle,
    locale,
    source_roots: sourceRoots,
    active_change: activeChange,
    proposal_step: proposalStep,
    yaml_diagnostics: yamlDiagnostics,
  };
}

export function status(format: OutputFormat = 'text', moduleId?: string) {
  const root = process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!existsSync(configPath)) {
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope(
        'status', 'PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.',
      )));
      process.exit(1);
    }
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  // Validate --module if provided
  if (moduleId) {
    const projectYaml = readProjectYaml(root);
    const mods = projectYaml.data?.modules ?? [];
    if (!mods.find(m => m.id === moduleId)) {
      console.error(`Error: Module '${moduleId}' not found in logos-project.yaml.`);
      if (projectYaml.yaml_diagnostics) {
        console.error(`YAML diagnostics: ${projectYaml.yaml_diagnostics.messages.join('; ')}`);
      }
      console.error('Run `openlogos module list` to see available modules.');
      process.exit(1);
    }
  }

  let data: StatusData;
  try {
    data = collectStatusData(root, moduleId);
  } catch (e) {
    if (e instanceof FlowError) {
      if (format === 'json') {
        console.error(JSON.stringify(makeErrorEnvelope('status', e.code, e.message)));
      } else {
        console.error(`✖ flow 配置错误（${e.code}）：${e.message}`);
      }
      process.exit(1);
    }
    throw e;
  }

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('status', data)));
    return;
  }

  const locale = readLocale(root);
  const LINE = '─'.repeat(50);

  if (!moduleId) {
    console.log('\n📊 OpenLogos Project Status\n');
    console.log(LINE);

    const hasAdoptedModule = data.modules?.some(m => isAdoptedBootstrap(m.bootstrap)) ?? false;
    for (const phase of data.phases) {
      if (phase.skipped) {
        if (hasAdoptedModule && (phase.key === 'phase.1' || phase.key === 'phase.2' || phase.key === 'phase.3-0')) {
          const reason = locale === 'zh'
            ? '文档基线已跳过（存量项目接入）'
            : 'Documentation baseline skipped (adopted access mode)';
          console.log(`⏭️  ${phase.label} — ${reason}`);
        }
        continue;
      }
      const icon = phase.done ? '✅' : '🔲';
      console.log(`${icon}  ${phase.label}`);
      if (phase.done) {
        for (const f of phase.files) console.log(`     └─ ${f}`);
      }
    }
    console.log(LINE);
  }

  // Show modules
  if (data.modules && data.modules.length > 0) {
    if (!moduleId) console.log(`\n🧩 ${t(locale, 'status.modules')}`);
    for (const m of data.modules) {
      if (m.lifecycle === 'launched') {
        const ac = m.active_change;
        if (ac) {
          console.log(`  🔄  ${m.id} (${m.name})  [launched]`);
          console.log(`       ${t(locale, 'status.activeChange')}: ${ac.slug}  →  ${ac.proposal_step_label}`);
          console.log(`       tasks: ${ac.tasks_checked}/${ac.tasks_total}  deltas: ${ac.delta_count}`);
          console.log(`       deployment: ${ac.deployment_progress.status} ${ac.deployment_progress.label} (${ac.deployment_progress.percent}%)`);
          console.log(`       document: ${ac.deployment_document.name} → ${ac.deployment_document.path}${ac.deployment_document.exists ? '' : ' (missing)'}`);
          if (ac.deployment_warnings) {
            for (const warning of ac.deployment_warnings) {
              console.log(`       ⚠ ${warning}`);
            }
          }
          if (ac.deploy_tasks && ac.deploy_tasks.length > 0) {
            console.log(`       ${t(locale, 'status.deployTasks')}:`);
            for (const task of ac.deploy_tasks) {
              const taskIcon = task.checked ? '✓' : ' ';
              console.log(`         - [${taskIcon}] ${task.text}`);
            }
          }
        } else {
          const blocked = data.active_change && data.active_change !== null;
          const icon = blocked ? '⏸️ ' : '✅';
          console.log(`  ${icon}  ${m.id} (${m.name})  [launched]`);
        }
      } else {
        const phase = m.current_phase ? ` → ${m.current_phase_label}` : ' → 全部完成';
        console.log(`  🔄  ${m.id} (${m.name})  [initial${phase}]`);
        if (m.phase_progress && m.current_phase) {
          const cp = m.phase_progress[m.current_phase];
          if (cp?.scenario_coverage && cp.scenario_coverage.missing.length > 0) {
            console.log(`       缺少场景: ${cp.scenario_coverage.missing.join(', ')}`);
          }
        }
      }
      if (m.overlay_nodes && m.overlay_nodes.length > 0) {
        console.log(`       🧩 ${locale === 'zh' ? 'Overlay 节点' : 'Overlay nodes'}`);
        for (const on of m.overlay_nodes) {
          console.log(`         ▶ ${on.id} (${on.name}) · ${on.state} · subflow=${on.subflow_id} · #${on.node_index}`);
        }
      }
      console.log(`       💡 ${m.suggestion}`);
    }
    console.log('');
  }

  // legacy 无 modules[] 项目的 overlay 顶层渲染
  if (data.overlay_nodes && data.overlay_nodes.length > 0) {
    console.log(`\n🧩 ${locale === 'zh' ? 'Overlay 节点' : 'Overlay nodes'}`);
    for (const on of data.overlay_nodes) {
      console.log(`  ▶ ${on.id} (${on.name}) · ${on.state} · subflow=${on.subflow_id} · #${on.node_index}`);
    }
  }

  if (!moduleId) {
    if (data.source_roots) {
      console.log(`\n📂 Source roots: src=[${data.source_roots.src.join(', ')}] test=[${data.source_roots.test.join(', ')}]`);
    }

    if (data.active_change) {
      const stepLabel = t(locale, `status.proposalStep.${data.proposal_step ?? 'writing'}`);
      console.log(`\n🔒 ${t(locale, 'status.activeChange')}: ${data.active_change}`);
      console.log(`   ${t(locale, 'status.proposalStepLabel')}: ${stepLabel}`);
      console.log(LINE);
    } else if (data.active_proposals.length > 0) {
      console.log(`\n📝 ${t(locale, 'status.activeProposals')}`);
      for (const p of data.active_proposals) {
        const parts = [
          p.has_proposal ? 'proposal.md ✓' : 'proposal.md ✗',
          p.has_tasks ? 'tasks.md ✓' : 'tasks.md ✗',
          `deltas: ${p.delta_count} files`,
        ];
        console.log(`     └─ ${p.name} (${parts.join(' | ')})`);
      }
      console.log(LINE);
    }

    if (data.all_done) {
      console.log(`\n🎉 ${t(locale, 'status.allDone')}`);
      if (data.lifecycle === 'initial') {
        console.log(`   → ${t(locale, 'launch.suggest')}`);
        console.log(t(locale, 'status.allDoneHint') + '\n');
      } else {
        console.log('');
      }
    } else {
      const firstIncomplete = data.phases.find(p => !p.done && !p.skipped)!;
      console.log(`\n💡 ${t(locale, 'status.suggestNext', { label: firstIncomplete.label })}`);
      console.log(`   → ${data.suggestion}\n`);
    }
  }
}
