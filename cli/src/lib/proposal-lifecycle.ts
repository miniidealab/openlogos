import { existsSync, readFileSync, writeFileSync, appendFileSync, linkSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { parseStrictTimestampMs } from './timestamp.js';
// 循环导入（安全性见 detectProposalStep 注释）：仅函数声明跨界调用、无顶层跨界求值。
import { detectMintedStepViaFlow } from './flow-derive.js';

import { join } from 'node:path';
import { listFiles } from './list-files.js';
// ModuleInfo 仅作类型使用，type-only 引入不构成运行时循环依赖。
import type { ModuleInfo } from '../commands/status.js';

export type ProposalStep =
  | 'writing'
  | 'ready-to-delta'
  | 'delta-writing'
  | 'ready-to-merge'
  | 'merge-generated'
  | 'spec-complete-required'
  | 'test-id-required'
  | 'ready-to-implement'
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

export interface CodePlanningDiagnostic {
  reason: 'tasks-code-section-missing' | 'slices-not-planned';
  tasksPath: string;
  remediation: string;
}

export type ProposalBlockReason =
  | 'no_delta_spec_marker_missing'
  | 'code_change_requires_real_test_ids';

export type TasksExecutionScope = 'delta' | 'deploy' | 'code' | 'none';

export interface PlanState {
  plan_ready: boolean;
  plan_gate_pending: boolean;
  plan_approved: boolean;
  tasks_template_filled: boolean;
  tasks_execution_done: number;
  tasks_execution_total: number;
  tasks_execution_scope: TasksExecutionScope;
  diagnostic?: string;
}

const MERGE_SUPPORTED_DELTA_DIRS = ['prd', 'api', 'database', 'scenario', 'test', 'spec', 'skills'] as const;
export const PLAN_APPROVED_MARKER = 'PLAN_APPROVED';
// split-slice-planner-stage：slice-exit 门被 --auto 消费后的状态源（类比 PLAN_APPROVED）。
export const SLICES_APPROVED_MARKER = 'SLICES_APPROVED';

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

/**
 * split-slice-planner-stage / fix-next-node-slice-exit-frontier：
 * `[code]` section 是否已脱模板（== flow `tasks_code_filled` 谓词）——slice-planner 已写出真实切片清单。
 * 判据：`## [code]` section 含 ≥1 个 checkbox 条目，且其文本非模板占位（`[切片清单占位]` / `实现代码变更` / `Implement code changes`）。
 * 供 `resolveNextNode` 对 `ready-to-implement` 前沿二分（未脱模板 → `plan-slices` 节点；已脱模板 → `slice-exit` 门）。
 */
const CODE_SECTION_PLACEHOLDERS = new Set([
  '[切片清单占位]',
  '实现代码变更',
  'Implement code changes',
]);

export function isTasksCodeFilled(content: string): boolean {
  return extractTaskSectionItems(content, 'code')
    .some(item => item.text.trim() !== '' && !CODE_SECTION_PLACEHOLDERS.has(item.text.trim()));
}

const TEST_CASE_ID_PATTERN = /\b(?:UT|ST|SMOKE)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*\b/;

function hasTestDeltaSignal(proposalDir: string, tasksContent: string): boolean {
  if (/\bdeltas\/test\//.test(tasksContent) && TEST_CASE_ID_PATTERN.test(tasksContent)) {
    return true;
  }

  for (const file of listFiles(join(proposalDir, 'deltas', 'test'))) {
    const fullPath = join(proposalDir, 'deltas', 'test', file);
    try {
      if (TEST_CASE_ID_PATTERN.test(readFileSync(fullPath, 'utf-8'))) {
        return true;
      }
    } catch {
      // 忽略不可读文件；listFiles 已过滤普通文件，此处只兜底竞态。
    }
  }
  return false;
}

function proposalDeclaresCodeRequired(content: string): boolean {
  return /(?:代码级|code-level|code\s+level|业务代码|实现代码|代码实现|runner|reporter)/i.test(content);
}

function proposalDeclaresNoCode(content: string): boolean {
  return /(?:无需代码|无代码|纯文档|不涉及代码|no\s+code|docs-only|documentation-only)/i.test(content);
}

export function isCodeRequiredForProposal(
  proposalDir: string,
  tasksContent?: string,
  sections?: Record<string, { checked: number; total: number }> | null,
): boolean {
  const taskText = tasksContent ?? (existsSync(join(proposalDir, 'tasks.md'))
    ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '');
  const parsedSections = sections ?? parseTaskSections(taskText);
  if (parsedSections?.code) return true;

  const proposalContent = existsSync(join(proposalDir, 'proposal.md'))
    ? readFileSync(join(proposalDir, 'proposal.md'), 'utf-8') : '';

  const testDeltaRequiresCode = hasTestDeltaSignal(proposalDir, taskText);
  if (testDeltaRequiresCode) return true;
  if (proposalDeclaresNoCode(proposalContent)) return false;
  return proposalDeclaresCodeRequired(proposalContent);
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

export function hasRealTestIdsForProposal(proposalDir: string, tasksContent?: string): boolean {
  const taskText = tasksContent ?? readIfExists(join(proposalDir, 'tasks.md'));
  if (TEST_CASE_ID_PATTERN.test(taskText)) return true;

  const proposalContent = readIfExists(join(proposalDir, 'proposal.md'));
  if (TEST_CASE_ID_PATTERN.test(proposalContent)) return true;

  for (const file of listFiles(join(proposalDir, 'deltas', 'test'))) {
    const fullPath = join(proposalDir, 'deltas', 'test', file);
    try {
      if (TEST_CASE_ID_PATTERN.test(readFileSync(fullPath, 'utf-8'))) return true;
    } catch {
      // 忽略不可读文件；listFiles 已过滤普通文件，此处只兜底竞态。
    }
  }

  return false;
}

export function getProposalStepReason(
  proposalDir: string,
  step?: ProposalStep,
  tasksContent?: string,
): ProposalBlockReason | null {
  const taskText = tasksContent ?? readIfExists(join(proposalDir, 'tasks.md'));
  const sections = parseTaskSections(taskText);
  const codeRequired = isCodeRequiredForProposal(proposalDir, taskText, sections);
  const currentStep = step ?? detectProposalStep(proposalDir);

  if (currentStep === 'spec-complete-required' && codeRequired && !hasSpecCompleteMarker(proposalDir)) {
    return 'no_delta_spec_marker_missing';
  }
  if (currentStep === 'test-id-required' && codeRequired && hasSpecCompleteMarker(proposalDir)
    && !hasRealTestIdsForProposal(proposalDir, taskText)) {
    return 'code_change_requires_real_test_ids';
  }
  return null;
}

export function getCodePlanningDiagnostic(proposalDir: string, tasksContent?: string): CodePlanningDiagnostic | null {
  const taskText = tasksContent ?? (existsSync(join(proposalDir, 'tasks.md'))
    ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '');
  const sections = parseTaskSections(taskText);
  if (!isCodeRequiredForProposal(proposalDir, taskText, sections)) return null;

  const code = sections?.code;
  const slug = proposalDir.split(/[\\/]/).filter(Boolean).pop() ?? '<slug>';
  const tasksPath = `logos/changes/${slug}/tasks.md`;
  if (!code) {
    return {
      reason: 'tasks-code-section-missing',
      tasksPath,
      remediation: '补空 ## [code] section 后重新进入 plan-slices，或由 slice-planner 创建 section',
    };
  }
  if (!isTasksCodeFilled(taskText)) {
    return {
      reason: 'slices-not-planned',
      tasksPath,
      remediation: '由 slice-planner 基于已合并规格和真实 UT/ST ID 写入 [code] 切片',
    };
  }
  return null;
}

export function isCodeRequiredButUnplanned(proposalDir: string, tasksContent?: string): boolean {
  const taskText = tasksContent ?? (existsSync(join(proposalDir, 'tasks.md'))
    ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '');
  return isCodeRequiredForProposal(proposalDir, taskText) && !isTasksCodeFilled(taskText);
}

/** enforce-slice-stage-ordering：auto-reset 时把 `## [code]` 重置成的纯代码模板占位（等价 change-writer 纯代码模板）。 */
const CODE_SECTION_RESET_PLACEHOLDER: Record<string, string> = {
  zh: '- [ ] 实现代码变更',
  en: '- [ ] Implement code changes',
};

/** 提取 tasks.md 中 `## [code]` section 的原始文本（标题到下一个 `## ` 前），用于 auto-reset 备份。 */
function extractCodeSectionRaw(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  for (const line of lines) {
    if (/^## \[code\]/i.test(line)) { inCode = true; out.push(line); continue; }
    if (inCode) {
      if (/^## /.test(line)) break;
      out.push(line);
    }
  }
  return out.join('\n').trimEnd();
}

/** 把 `## [code]` section body 重置为纯代码模板占位（保留 `## [code]` 标题行）。 */
function replaceCodeSectionBody(content: string, placeholder: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  for (const line of lines) {
    if (/^## \[code\]/i.test(line)) {
      out.push(line, '', placeholder);
      inCode = true;
      continue;
    }
    if (inCode) {
      if (/^## /.test(line)) { inCode = false; out.push('', line); }
      continue; // 丢弃 [code] 旧 body
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * enforce-slice-stage-ordering：auto-reset 提前填充的 `[code]` section（§12.7）。
 * 仅当 `[code]` 已 `tasks_code_filled`（提前填充）时，重置为纯代码模板占位并把旧内容备份到提案目录 `CODE_AUTORESET`。
 * 幂等：`[code]` 已占位（未 `tasks_code_filled`）时不清理、不备份，返回 false。
 * ⚠️ 只在有副作用命令（`openlogos merge`）中调用；**绝不**在 `status`/`flow-derive` 被动派生路径调用（A 被动派生只读）。
 */
export function resetCodeSection(proposalDir: string, trigger: string, locale = 'zh'): boolean {
  const tasksPath = join(proposalDir, 'tasks.md');
  if (!existsSync(tasksPath)) return false;
  const content = readFileSync(tasksPath, 'utf-8');
  if (!isTasksCodeFilled(content)) return false; // 幂等：已占位不动
  const oldCode = extractCodeSectionRaw(content);
  const placeholder = CODE_SECTION_RESET_PLACEHOLDER[locale] ?? CODE_SECTION_RESET_PLACEHOLDER.zh;
  writeFileSync(tasksPath, replaceCodeSectionBody(content, placeholder));
  const backup = JSON.stringify({ ts: new Date().toISOString(), trigger, old_code: oldCode });
  appendFileSync(join(proposalDir, 'CODE_AUTORESET'), backup + '\n');
  return true;
}

export function countMergeableDeltaFiles(proposalDir: string): number {
  let count = 0;
  for (const category of MERGE_SUPPORTED_DELTA_DIRS) {
    count += listFiles(join(proposalDir, 'deltas', category)).length;
  }
  return count;
}

export function hasSpecCompleteMarker(proposalDir: string): boolean {
  return existsSync(join(proposalDir, 'SPEC_MERGED')) || existsSync(join(proposalDir, 'MERGED'));
}

// ── contract-self-description 切片1：facts 权威事实块 + 结构化 SLICES_APPROVED ──

export interface ProposalFacts {
  spec_complete: boolean;
  slices_planned: boolean;
  slices_approved: boolean;
  code_required: boolean;
  has_delta_tasks: boolean;
  verify_pass: boolean;
}

/**
 * CLI 权威计算的确定性事实块（spec/cli-json-output.md §3.3「facts 权威事实块」）。
 * loop_state 激活判据（flow-loop-derive）与本函数是**同一份计算**——单一事实源，禁止第二处实现。
 */
export function deriveProposalFacts(proposalDir: string, tasksContent?: string): ProposalFacts {
  const taskText = tasksContent ?? (existsSync(join(proposalDir, 'tasks.md'))
    ? readFileSync(join(proposalDir, 'tasks.md'), 'utf-8') : '');
  const sections = parseTaskSections(taskText);
  return {
    spec_complete: hasSpecCompleteMarker(proposalDir),
    slices_planned: isTasksCodeFilled(taskText),
    slices_approved: existsSync(join(proposalDir, SLICES_APPROVED_MARKER)),
    code_required: isCodeRequiredForProposal(proposalDir, taskText, sections),
    has_delta_tasks: (sections?.delta?.total ?? 0) > 0,
    verify_pass: existsSync(join(proposalDir, 'VERIFY_PASS')),
  };
}

/**
 * 结构化 SLICES_APPROVED marker（spec/flow-spec.md §12.5(3)）：消费 slice-exit 时原子写入一次
 * JSON 单行 `{"schema":"openlogos/slices-approved@1","approved_at":"<ISO 8601>"}`；
 * 已存在**不重写**（重复 `next --auto` 不刷新 approved_at）。
 */
export function writeSlicesApprovedMarker(proposalDir: string): void {
  const path = join(proposalDir, SLICES_APPROVED_MARKER);
  if (existsSync(path)) return; // 快路径：已存在不重写（approved_at 一次写定）
  // code review F2：原子独占发布——先写完整内容到临时文件，再 linkSync 单赢发布：
  // 并发竞争时后到者 EEXIST（保留先赢内容、不覆盖不刷新）；崩溃只可能留下 tmp 残件，
  // 目标路径要么不存在、要么是完整单行 JSON（绝无半内容）。
  const tmp = join(proposalDir, `.${SLICES_APPROVED_MARKER}.tmp-${randomUUID()}`);
  const line = JSON.stringify({ schema: 'openlogos/slices-approved@1', approved_at: new Date().toISOString() });
  writeFileSync(tmp, line + '\n');
  try {
    linkSync(tmp, path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; // EEXIST = 并发先赢，静默保留
  } finally {
    try { unlinkSync(tmp); } catch { /* tmp 清理尽力而为 */ }
  }
}

/**
 * 读结构化 SLICES_APPROVED 的 approved_at（loop_state.activated_at 的持久时间源）。
 * 旧格式空文件 / 非法 JSON → null（存在性仍表示「切片门已消费」，仅时间戳缺失）。
 */
export function readSlicesApprovedAt(proposalDir: string): string | null {
  const path = join(proposalDir, SLICES_APPROVED_MARKER);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { schema?: unknown; approved_at?: unknown };
    // code review F6：读取端校验——schema 常量与严格 RFC 3339 时间格式；任一无效 → 按「无时间戳」省略
    // （存在性仍是「切片门已消费」的权威事实，损坏 marker 不得把坏时间原样发布进 loop_state.activated_at）。
    if (parsed.schema !== 'openlogos/slices-approved@1') return null;
    if (typeof parsed.approved_at !== 'string' || parseStrictTimestampMs(parsed.approved_at) == null) return null;
    return parsed.approved_at;
  } catch {
    return null;
  }
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

function resolveTasksExecution(
  sections: Record<string, { checked: number; total: number }> | null,
): { done: number; total: number; scope: TasksExecutionScope } {
  for (const scope of ['delta', 'deploy', 'code'] as const) {
    if (sections?.[scope]) {
      return {
        done: sections[scope].checked,
        total: sections[scope].total,
        scope,
      };
    }
  }
  return { done: 0, total: 0, scope: 'none' };
}

export function derivePlanState(
  proposalDir: string,
  step: ProposalStep,
  deploymentDecision: Pick<ProposalDeploymentDecision, 'deployment_decision_conflict' | 'deployment_decision_conflict_reason'>,
  tasksContent?: string,
): PlanState {
  const proposalPath = join(proposalDir, 'proposal.md');
  const tasksPath = join(proposalDir, 'tasks.md');
  const proposalContent = existsSync(proposalPath) ? readFileSync(proposalPath, 'utf-8') : '';
  const taskText = tasksContent ?? (existsSync(tasksPath) ? readFileSync(tasksPath, 'utf-8') : '');
  const sections = parseTaskSections(taskText);
  const execution = resolveTasksExecution(sections);
  const proposalFilled = isProposalTemplateFilled(proposalContent);
  const tasksTemplateFilled = isTasksTemplateFilled(taskText) && sections !== null;
  const planApproved = existsSync(join(proposalDir, PLAN_APPROVED_MARKER))
    || (step !== 'writing' && step !== 'ready-to-delta');
  const conflict = deploymentDecision.deployment_decision_conflict;
  const planReady = proposalFilled && tasksTemplateFilled && !conflict;
  const planGatePending = step === 'ready-to-delta' && !planApproved && planReady;

  let diagnostic: string | undefined;
  if (conflict) {
    diagnostic = deploymentDecision.deployment_decision_conflict_reason
      ?? 'proposal.md 与 tasks.md 存在 plan 层冲突，请先修正后再继续。';
  } else if (!proposalFilled || !tasksTemplateFilled) {
    diagnostic = 'proposal/tasks 尚未完成脱模板，不能进入 plan gate。';
  } else if (planGatePending) {
    diagnostic = 'proposal/tasks 已完成，等待 plan-exit 批准或 next --auto 消费；checkbox 表示后续执行进度。';
  } else if (planApproved) {
    diagnostic = 'plan gate 已消费或前沿已离开 ready-to-delta，按当前执行前沿继续推进。';
  }

  return {
    plan_ready: planReady,
    plan_gate_pending: planGatePending,
    plan_approved: planApproved,
    tasks_template_filled: tasksTemplateFilled,
    tasks_execution_done: execution.done,
    tasks_execution_total: execution.total,
    tasks_execution_scope: execution.scope,
    ...(diagnostic ? { diagnostic } : {}),
  };
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
  // code review r3-F5（C1 收敛为一）+ smoke-repair（SMOKE-core-48）：镜像判定树已删除——唯一权威检测器
  // = flow-derive.detectMintedStepViaFlow（同一棵判定树、同一注册表铸造出口），**静态循环导入直连**。
  // 此前的运行时 delegate 注册在「入口只加载本模块、不加载 flow-derive」时（如 baseline-seed commit）
  // 未注册即抛错，炸出错误信封（SMOKE-core-48 回归）。ESM 循环安全依据：两模块顶层互不求值对方
  // 非函数绑定，函数声明跨循环 hoisted，本调用发生在两模块均已求值之后。
  return detectMintedStepViaFlow(proposalDir, moduleDefaults).proposal_step;
}
