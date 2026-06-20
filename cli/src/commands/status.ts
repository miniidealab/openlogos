import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t, PHASE_KEYS, SUGGEST_KEYS } from '../i18n.js';
import { buildInitialPhasePlan, deriveModulePhaseProgressViaFlow, flowExplicitSkipPhaseKeys, detectProposalStepViaFlow } from '../lib/flow-derive.js';
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
    };
  }

  // initial lifecycle —— B1：改用 builtin flow 派生（1:1 不改行为）
  const { progress, currentPhase } = deriveModulePhaseProgressViaFlow(root, mod, scenarios, isMultiModule);
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
  };
}

export function collectStatusData(root: string, filterModuleId?: string): StatusData {
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
  const phasePlan = buildInitialPhasePlan();

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
    skipped: globalSkipPhaseKeys.has(item.phaseKey), // pre-mark explicitly skipped phases
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

  const firstIncomplete = phases.find(p => !p.done && !p.skipped);
  const allDone = !firstIncomplete;

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
      return buildModuleStatusItem(root, m, moduleScenarios, locale, activeChange, guardModule, isMultiModule);
    });
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

  return {
    phases: phases.map(p => ({ key: p.key, label: p.label, done: p.done, skipped: p.skipped, files: p.files })),
    ...(modules !== undefined ? { modules } : {}),
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

  const data = collectStatusData(root, moduleId);

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
      console.log(`       💡 ${m.suggestion}`);
    }
    console.log('');
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
