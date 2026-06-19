import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { readLocale, t, PHASE_KEYS, SUGGEST_KEYS } from '../i18n.js';
import { buildInitialPhasePlan, deriveModulePhaseProgressViaFlow, flowExplicitSkipPhaseKeys } from '../lib/flow-derive.js';
import { listFiles } from '../lib/list-files.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { readProjectYaml, isAdoptedBootstrap } from '../lib/project-yaml.js';
import type { BootstrapMode, YamlDiagnostics } from '../lib/project-yaml.js';

export type ProposalStep =
  | 'writing'
  | 'delta-writing'
  | 'ready-to-merge'
  | 'merge-generated'
  | 'coding'
  | 'ready-to-verify'
  | 'verify-passed'
  | 'verify-failed'
  | 'ready-to-deploy'
  | 'deploy-done'
  | 'ready-to-smoke'
  | 'smoke-passed'
  | 'smoke-failed'
  | 'implementing'
  | 'in-progress';

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

export type DeploymentDecisionSource = 'proposal' | 'tasks' | 'module-default' | 'legacy-fallback';

export interface ProposalDeploymentDecision {
  deployment_required: boolean | null;
  smoke_required: boolean | null;
  deployment_reason: string | null;
  deployment_decision_source: DeploymentDecisionSource;
  deployment_decision_conflict: boolean;
  deployment_decision_conflict_reason: string | null;
  deployment_warnings: string[];
}

export type DeploymentProgressStatus = 'pending' | 'done' | 'empty' | 'unavailable';

export interface DeploymentProgress {
  checked: number;
  total: number;
  percent: number;
  status: DeploymentProgressStatus;
  label: string;
}

export interface DeploymentDocument {
  path: string;
  name: 'tasks.md';
  exists: boolean;
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

const MERGE_SUPPORTED_DELTA_DIRS = ['prd', 'api', 'database', 'scenario', 'test', 'spec', 'skills'] as const;

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

const DEPLOYMENT_BOOLEAN_TEMPLATE_FIELDS = [
  '是否需要部署',
  '是否涉及数据迁移',
  '是否需要回滚预案',
  '是否需要 smoke',
];

const DEPLOYMENT_FIELD_PLACEHOLDERS: Record<string, string> = {
  部署原因: '[说明为什么需要或不需要部署]',
  影响环境: '[本地 / 测试 / 预发 / 生产 / 无]',
};

function isTemplateBooleanChoice(value: string | null): boolean {
  return value !== null && /^是\s*\/\s*否$/.test(value.trim());
}

function isDeploymentSectionTemplateFilled(content: string): boolean {
  const section = extractMarkdownSection(content, '部署影响');
  if (!section) return true;

  for (const label of DEPLOYMENT_BOOLEAN_TEMPLATE_FIELDS) {
    if (isTemplateBooleanChoice(parseChineseField(section, label))) {
      return false;
    }
  }

  for (const [label, placeholder] of Object.entries(DEPLOYMENT_FIELD_PLACEHOLDERS)) {
    if (parseChineseField(section, label) === placeholder) {
      return false;
    }
  }

  return true;
}

function isProposalTemplateFilled(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;
  return normalized.includes('## 变更原因')
    && normalized.includes('## 变更类型')
    && normalized.includes('## 变更范围')
    && normalized.includes('## 变更概述')
    && !normalized.includes('[为什么要做这个变更？')
    && !normalized.includes('[需求级 / 设计级 / 接口级 / 代码级]')
    && !normalized.includes('[列表]')
    && !normalized.includes('[用 1-3 段话概述具体改什么]')
    && isDeploymentSectionTemplateFilled(normalized);
}

function isTasksTemplateFilled(content: string): boolean {
  const normalized = content.trim();
  if (!normalized) return false;
  const placeholderLines = [
    '- [ ] 更新需求文档的场景和验收条件',
    '- [ ] 更新产品设计文档的功能规格',
    '- [ ] 更新原型',
    '- [ ] 更新场景时序图',
    '- [ ] 更新 API YAML',
    '- [ ] 更新 DB DDL',
    '- [ ] 更新 API 编排测试用例',
    '- [ ] 实现代码变更',
    '- [ ] Update requirements scenarios and acceptance criteria',
    '- [ ] Update product design feature specs',
    '- [ ] Update prototypes',
    '- [ ] Update scenario sequence diagrams',
    '- [ ] Update API YAML',
    '- [ ] Update DB DDL',
    '- [ ] Update API orchestration test cases',
    '- [ ] Implement code changes',
  ];
  const lines = new Set(normalized.split(/\r?\n/).map(line => line.trim()));
  return !placeholderLines.some(line => lines.has(line));
}

function countMergeableDeltaFiles(proposalDir: string): number {
  let count = 0;
  for (const category of MERGE_SUPPORTED_DELTA_DIRS) {
    count += listFiles(join(proposalDir, 'deltas', category)).length;
  }
  return count;
}

function countTasks(content: string): { checked: number; total: number } {
  const checked = (content.match(/^- \[x\]/gim) ?? []).length;
  const unchecked = (content.match(/^- \[ \]/gm) ?? []).length;
  return { checked, total: checked + unchecked };
}

function allTasksChecked(content: string): boolean {
  const { checked, total } = countTasks(content);
  return total > 0 && checked === total;
}

/**
 * 解析 tasks.md 中的结构化 section。
 * 识别 `## [tag] ...` 格式的 section 标题，返回每个 tag 对应的 checked/total。
 * 若文件中没有任何 `## [tag]` 标记，返回 null（表示旧格式，降级为全局判断）。
 */
export interface TaskItem {
  checked: boolean;
  text: string;
}

export function parseTaskSections(content: string): Record<string, { checked: number; total: number }> | null {
  const lines = content.split(/\r?\n/);
  const sectionPattern = /^## \[([a-z][a-z0-9-]*)\]/i;
  let currentTag: string | null = null;
  let hasAnyTag = false;
  const sections: Record<string, { checked: number; total: number }> = {};

  for (const line of lines) {
    const match = line.match(sectionPattern);
    if (match) {
      currentTag = match[1].toLowerCase();
      hasAnyTag = true;
      if (!sections[currentTag]) {
        sections[currentTag] = { checked: 0, total: 0 };
      }
    } else if (currentTag) {
      if (/^- \[x\]/i.test(line)) {
        sections[currentTag].checked++;
        sections[currentTag].total++;
      } else if (/^- \[ \]/.test(line)) {
        sections[currentTag].total++;
      }
    }
  }

  return hasAnyTag ? sections : null;
}

export function extractTaskSectionItems(content: string, tag: string): TaskItem[] {
  const items: TaskItem[] = [];
  const lines = content.split(/\r?\n/);
  const sectionPattern = /^## \[([a-z][a-z0-9-]*)\]/i;
  let inSection = false;

  for (const line of lines) {
    const sectionMatch = line.match(sectionPattern);
    if (sectionMatch) {
      inSection = sectionMatch[1].toLowerCase() === tag.toLowerCase();
      continue;
    }
    if (!inSection) continue;

    const itemMatch = line.match(/^- \[([ x])\] (.+)$/i);
    if (itemMatch) {
      items.push({
        checked: itemMatch[1].toLowerCase() === 'x',
        text: itemMatch[2].trim(),
      });
    }
  }

  return items;
}

export function readTaskSectionItems(proposalDir: string, tag: string): TaskItem[] {
  const tasksPath = join(proposalDir, 'tasks.md');
  if (!existsSync(tasksPath)) return [];
  return extractTaskSectionItems(readFileSync(tasksPath, 'utf-8'), tag);
}

export function getDeployTasks(proposalDir: string): TaskItem[] {
  return readTaskSectionItems(proposalDir, 'deploy');
}

function extractMarkdownSection(content: string, heading: string): string | null {
  const lines = content.split(/\r?\n/);
  const startIndex = lines.findIndex(line => line.trim() === `## ${heading}`);
  if (startIndex < 0) return null;

  const sectionLines: string[] = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) break;
    sectionLines.push(lines[i]);
  }
  return sectionLines.join('\n');
}

function parseChineseBoolean(section: string, label: string): boolean | null {
  const value = parseChineseField(section, label);
  if (value === '是') return true;
  if (value === '否') return false;
  return null;
}

function parseChineseField(section: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = section.match(new RegExp(`^-\\s*${escapedLabel}\\s*[：:]\\s*(.+)$`, 'm'))?.[1]?.trim();
  return value ? value : null;
}

export function parseProposalDeploymentDecision(content: string): Pick<
  ProposalDeploymentDecision,
  'deployment_required' | 'smoke_required' | 'deployment_reason'
> | null {
  const section = extractMarkdownSection(content, '部署影响');
  if (!section) return null;

  const deploymentRequired = parseChineseBoolean(section, '是否需要部署');
  const smokeRequired = parseChineseBoolean(section, '是否需要 smoke');
  const deploymentReasonValue = parseChineseField(section, '部署原因');
  const deploymentReason = deploymentReasonValue === DEPLOYMENT_FIELD_PLACEHOLDERS['部署原因']
    ? null
    : deploymentReasonValue;

  if (deploymentRequired === null && smokeRequired === null && deploymentReason === null) {
    return null;
  }

  return {
    deployment_required: deploymentRequired,
    smoke_required: smokeRequired,
    deployment_reason: deploymentReason,
  };
}

function getTaskSectionSummary(
  tasksContent: string,
  tag: string,
): { summary: { checked: number; total: number } | null; present: boolean } {
  const sections = parseTaskSections(tasksContent);
  const present = sections !== null && Object.prototype.hasOwnProperty.call(sections, tag);
  return {
    summary: getSectionSummary(sections, tag),
    present,
  };
}

function getDeploySectionSummary(tasksContent: string): { checked: number; total: number } | null {
  return getTaskSectionSummary(tasksContent, 'deploy').summary;
}

function deploymentConflictWarning(deploymentRequired: boolean, hasDeploySection: boolean): string | null {
  if (!deploymentRequired && hasDeploySection) {
    return '部署决策冲突：proposal.md 声明无需部署，但 tasks.md 存在 [deploy] section。请先修正 proposal / tasks。';
  }
  if (deploymentRequired && !hasDeploySection) {
    return '部署决策冲突：proposal.md 声明需要部署，但 tasks.md 缺少 [deploy] section。请先修正 proposal / tasks。';
  }
  return null;
}

export function resolveDeploymentProgress(proposalDir: string): DeploymentProgress {
  const tasksPath = join(proposalDir, 'tasks.md');
  if (!existsSync(tasksPath)) {
    return {
      checked: 0,
      total: 0,
      percent: 0,
      status: 'unavailable',
      label: '0/0',
    };
  }

  let tasksContent: string;
  try {
    tasksContent = readFileSync(tasksPath, 'utf-8');
  } catch {
    return {
      checked: 0,
      total: 0,
      percent: 0,
      status: 'unavailable',
      label: '0/0',
    };
  }

  const { summary, present } = getTaskSectionSummary(tasksContent, 'deploy');
  if (!present) {
    return {
      checked: 0,
      total: 0,
      percent: 0,
      status: 'unavailable',
      label: '0/0',
    };
  }

  if (!summary || summary.total === 0) {
    return {
      checked: 0,
      total: 0,
      percent: 0,
      status: 'empty',
      label: '0/0',
    };
  }

  const checked = summary.checked;
  const total = summary.total;
  return {
    checked,
    total,
    percent: Math.round((checked / total) * 100),
    status: checked >= total ? 'done' : 'pending',
    label: `${checked}/${total}`,
  };
}

export function resolveDeploymentDocument(root: string, proposalSlug: string): DeploymentDocument {
  const relativePath = `logos/changes/${proposalSlug}/tasks.md`;
  return {
    path: relativePath,
    name: 'tasks.md',
    exists: existsSync(join(root, relativePath)),
  };
}

function readProposalDeploymentDecision(
  proposalDir: string,
): Pick<ProposalDeploymentDecision, 'deployment_required' | 'smoke_required' | 'deployment_reason'> | null {
  const proposalPath = join(proposalDir, 'proposal.md');
  if (!existsSync(proposalPath)) return null;
  return parseProposalDeploymentDecision(readFileSync(proposalPath, 'utf-8'));
}

export function resolveProposalDeploymentDecision(
  proposalDir: string,
  moduleDefaults: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'> = {},
): ProposalDeploymentDecision {
  const tasksPath = join(proposalDir, 'tasks.md');
  const tasksContent = existsSync(tasksPath) ? readFileSync(tasksPath, 'utf-8') : '';
  const { summary: deploySection, present: hasDeploySection } = getTaskSectionSummary(tasksContent, 'deploy');
  const hasDeployTasks = Boolean(deploySection && deploySection.total > 0);
  const proposalDecision = readProposalDeploymentDecision(proposalDir);

  if (proposalDecision && proposalDecision.deployment_required !== null) {
    const warning = deploymentConflictWarning(proposalDecision.deployment_required, hasDeploySection);
    return {
      deployment_required: proposalDecision.deployment_required,
      smoke_required: proposalDecision.smoke_required,
      deployment_reason: proposalDecision.deployment_reason,
      deployment_decision_source: 'proposal',
      deployment_decision_conflict: warning !== null,
      deployment_decision_conflict_reason: warning,
      deployment_warnings: warning ? [warning] : [],
    };
  }

  if (hasDeployTasks) {
    return {
      deployment_required: true,
      smoke_required: moduleDefaults.smoke_required ?? null,
      deployment_reason: '历史提案依据 tasks.md 的 [deploy] section 回退判断需要部署。',
      deployment_decision_source: 'tasks',
      deployment_decision_conflict: false,
      deployment_decision_conflict_reason: null,
      deployment_warnings: [],
    };
  }

  if (moduleDefaults.deployment_required === false || moduleDefaults.smoke_required === false) {
    return {
      deployment_required: moduleDefaults.deployment_required ?? null,
      smoke_required: moduleDefaults.smoke_required ?? null,
      deployment_reason: '历史提案缺少结构化部署影响，使用模块级默认部署门禁。',
      deployment_decision_source: 'module-default',
      deployment_decision_conflict: false,
      deployment_decision_conflict_reason: null,
      deployment_warnings: [],
    };
  }

    return {
      deployment_required: false,
      smoke_required: false,
      deployment_reason: '历史提案缺少结构化部署影响，依据无 [deploy] section 回退判断无需部署。',
      deployment_decision_source: 'legacy-fallback',
      deployment_decision_conflict: false,
      deployment_decision_conflict_reason: null,
      deployment_warnings: [],
    };
  }

function getSectionSummary(
  sections: Record<string, { checked: number; total: number }> | null,
  tag: string,
): { checked: number; total: number } | null {
  return sections?.[tag] ?? null;
}

function hasSmokeCasesForProposal(proposalDir: string): boolean {
  return listFiles(join(proposalDir, '..', '..', 'resources', 'test', 'smoke')).length > 0;
}

export function detectProposalStep(
  proposalDir: string,
  moduleDefaults: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'> = {},
): ProposalStep {
  if (existsSync(join(proposalDir, 'VERIFY_FAIL'))) {
    return 'verify-failed';
  }
  if (existsSync(join(proposalDir, 'VERIFY_PASS'))) {
    const tasksContent = existsSync(join(proposalDir, 'tasks.md'))
      ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
    const deploy = getDeploySectionSummary(tasksContent);
    const hasDeployTasks = Boolean(deploy && deploy.total > 0);
    const deploymentDecision = resolveProposalDeploymentDecision(proposalDir, moduleDefaults);

    if (deploymentDecision.deployment_decision_conflict) {
      return 'verify-passed';
    }

    if (deploymentDecision.deployment_required !== true) {
      return 'verify-passed';
    }

    if (!hasDeployTasks) {
      return 'ready-to-deploy';
    }

    const deployDone = existsSync(join(proposalDir, 'DEPLOY_DONE'));
    const deployTasksChecked = deploy!.checked === deploy!.total;
    if (!deployDone || !deployTasksChecked) {
      return 'ready-to-deploy';
    }

    if (existsSync(join(proposalDir, 'SMOKE_FAIL'))) {
      return 'smoke-failed';
    }
    if (existsSync(join(proposalDir, 'SMOKE_PASS'))) {
      return 'smoke-passed';
    }
    if (deploymentDecision.smoke_required === false) {
      return 'deploy-done';
    }
    if (deploymentDecision.smoke_required === true) {
      return 'ready-to-smoke';
    }
    if (hasSmokeCasesForProposal(proposalDir)) {
      return 'ready-to-smoke';
    }
    return 'deploy-done';
  }
  if (existsSync(join(proposalDir, 'SPEC_MERGED')) || existsSync(join(proposalDir, 'MERGED'))) {
    // 规格已合并，判断 [code] section 是否全部完成
    const tasksContent = existsSync(join(proposalDir, 'tasks.md'))
      ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
    const sections = parseTaskSections(tasksContent);
    if (sections !== null) {
      const code = sections['code'];
      if (!code || (code.total > 0 && code.checked === code.total)) {
        // 无 [code] section 或 [code] 全勾 → 可以 verify
        return 'ready-to-verify';
      }
      return 'coding';
    }
    // 旧格式：无 section 标记，直接进入 ready-to-verify
    return 'ready-to-verify';
  }
  if (existsSync(join(proposalDir, 'MERGE_PROMPT_GENERATED')) || existsSync(join(proposalDir, 'MERGE_PROMPT.md'))) {
    return 'merge-generated';
  }
  const proposalContent = existsSync(join(proposalDir, 'proposal.md'))
    ? readFileSync(join(proposalDir, 'proposal.md'), 'utf-8') : '';
  const tasksContent = existsSync(join(proposalDir, 'tasks.md'))
    ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '';
  const mergeableDeltaCount = countMergeableDeltaFiles(proposalDir);

  if (!isProposalTemplateFilled(proposalContent) || !isTasksTemplateFilled(tasksContent)) {
    return 'writing';
  }

  // 结构化 section 判断
  const sections = parseTaskSections(tasksContent);
  if (sections !== null) {
    const delta = sections['delta'];
    const code = sections['code'];

    // 纯代码提案（新格式无 [delta] section）：完全跳过 merge 阶段
    if (!delta) {
      if (!code || (code.total > 0 && code.checked === code.total)) {
        return 'ready-to-verify';
      }
      return 'coding';
    }

    // 有 [delta] section：按 delta 勾选状态判断
    if (delta.total > 0 && delta.checked === delta.total) {
      return 'ready-to-merge';
    }
    return 'delta-writing';
  }

  // 旧格式降级：全局判断（向后兼容）
  if (mergeableDeltaCount > 0 && allTasksChecked(tasksContent)) {
    return 'ready-to-merge';
  }
  return 'delta-writing';
}

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
      const step = existsSync(proposalDir) ? detectProposalStep(proposalDir, mod) : 'writing';
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
          ? detectProposalStep(proposalDir, guardModuleDefaults)
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
