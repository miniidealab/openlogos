import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listFiles } from './list-files.js';
// ModuleInfo 仅作类型使用，type-only 引入不构成运行时循环依赖。
import type { ModuleInfo } from '../commands/status.js';

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

export interface TaskItem {
  checked: boolean;
  text: string;
}

const MERGE_SUPPORTED_DELTA_DIRS = ['prd', 'api', 'database', 'scenario', 'test', 'spec', 'skills'] as const;

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

export function isDeploymentSectionTemplateFilled(content: string): boolean {
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

export function isProposalTemplateFilled(content: string): boolean {
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

export function isTasksTemplateFilled(content: string): boolean {
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

export function countMergeableDeltaFiles(proposalDir: string): number {
  let count = 0;
  for (const category of MERGE_SUPPORTED_DELTA_DIRS) {
    count += listFiles(join(proposalDir, 'deltas', category)).length;
  }
  return count;
}

export function countTasks(content: string): { checked: number; total: number } {
  const checked = (content.match(/^- \[x\]/gim) ?? []).length;
  const unchecked = (content.match(/^- \[ \]/gm) ?? []).length;
  return { checked, total: checked + unchecked };
}

export function allTasksChecked(content: string): boolean {
  const { checked, total } = countTasks(content);
  return total > 0 && checked === total;
}

/**
 * 解析 tasks.md 中的结构化 section。
 * 识别 `## [tag] ...` 格式的 section 标题，返回每个 tag 对应的 checked/total。
 * 若文件中没有任何 `## [tag]` 标记，返回 null（表示旧格式，降级为全局判断）。
 */
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

export function getDeploySectionSummary(tasksContent: string): { checked: number; total: number } | null {
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

export function hasSmokeCasesForProposal(proposalDir: string): boolean {
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
