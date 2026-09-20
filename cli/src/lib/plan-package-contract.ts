import { authorityScan } from './markdown-scan.js';

export const PLAN_PACKAGE_SCHEMA = 'openlogos/plan-package-evaluation@1' as const;
export const PLAN_PACKAGE_CONTRACT_VERSION = '1';
export const PLAN_PACKAGE_CLI_CONTRACT_VERSION = '1.3.0';

export const PLAN_SECTION_REGISTRY = {
  reason: { zh: '变更原因', en: 'Reason' },
  type: { zh: '变更类型', en: 'Change Type' },
  scope: { zh: '变更范围', en: 'Scope' },
  deployment: { zh: '部署影响', en: 'Deployment Impact' },
  summary: { zh: '变更概述', en: 'Summary' },
  clarification: { zh: '决策澄清', en: 'Decision Clarification' },
} as const;

export type PlanSectionId = keyof typeof PLAN_SECTION_REGISTRY;
export type PlanPackageIssueCode =
  | 'proposal_required_section_missing'
  | 'proposal_required_section_duplicate'
  | 'proposal_required_section_empty'
  | 'proposal_placeholder_remaining'
  | 'proposal_change_type_invalid'
  | 'proposal_deployment_fields_invalid'
  | 'tasks_template_remaining'
  | 'tasks_code_entry_before_spec_complete'
  | 'tasks_code_section_missing'
  | 'tasks_deployment_conflict';

export interface CompletionIssue {
  code: PlanPackageIssueCode;
  path: string;
  section_id?: PlanSectionId | 'code' | 'delta' | 'deploy';
  line?: number;
  actual?: string;
  expected?: string;
  message: string;
  fix_hint: string;
}

export interface PlanPackageEvaluation {
  schema: typeof PLAN_PACKAGE_SCHEMA;
  contract_version: string;
  ready: boolean;
  proposal: { filled: boolean; issues: CompletionIssue[] };
  tasks: {
    plan_filled: boolean;
    code_required: boolean;
    code_slices_filled: boolean;
    issues: CompletionIssue[];
  };
  issues: CompletionIssue[];
}

/** 提案中被 PLAN_SECTION_REGISTRY 认领的章节（名称曾为 AuthoritySection，与已删除的 L10 无关）。 */
interface PlanSection {
  id: PlanSectionId;
  title: string;
  line: number;
  content: string;
}

const SECTION_ORDER = Object.keys(PLAN_SECTION_REGISTRY) as PlanSectionId[];
const ISSUE_ORDER: PlanPackageIssueCode[] = [
  'proposal_required_section_missing', 'proposal_required_section_duplicate',
  'proposal_required_section_empty', 'proposal_placeholder_remaining',
  'proposal_change_type_invalid', 'proposal_deployment_fields_invalid',
  'tasks_template_remaining',
  'tasks_code_entry_before_spec_complete', 'tasks_code_section_missing',
  'tasks_deployment_conflict',
];

export function detectPlanLocale(content: string): 'zh' | 'en' {
  return /^##\s+(?:Reason|Change Type|Scope|Deployment Impact|Summary|Decision Clarification)\s*$/m.test(content)
    ? 'en' : 'zh';
}

function meaningfulSectionBody(content: string): string {
  return content.replace(/<!--[^]*?-->/g, '').trim();
}

function hasPlaceholder(content: string): boolean {
  return /\[(?:为什么要做这个变更|需求级\s*\/|列表|用\s*1-3\s*段话概述|Why is this change needed|Requirements\s*\/|list\]|Describe what will change)/i.test(content);
}

/**
 * 变更类型的四档分级。与方法论「变更传播规则」的类型名一一对应（部署级不在提案合法集合内，
 * 故不入本枚举——该偏差是既有的，见 S35 场景「异常与边界」）。
 */
export type ChangeTypeLevel = 'requirements' | 'design' | 'interface' | 'code';

/**
 * 变更类型的**唯一词表**（S35「判据双源与『严禁第二份判据』的落实方式」）。
 * `isValidChangeType`（合法性，既有语义）与 `resolveChangeType`（解析唯一类型，新增能力）
 * 都从这里拼装各自的正则——共享的是词表，不是正则；任何一方都不得内联自己的类型字面量。
 * 顺序即既有正则的交替顺序，改动会破坏 `proposal_change_type_invalid` 的零回归对照。
 */
const CHANGE_TYPE_LEXICON: Record<'zh' | 'en', Array<{ level: ChangeTypeLevel; pattern: string }>> = {
  zh: [
    { level: 'requirements', pattern: '需求级' },
    { level: 'design', pattern: '设计级' },
    { level: 'interface', pattern: '接口级' },
    { level: 'code', pattern: '代码级' },
  ],
  en: [
    { level: 'requirements', pattern: 'requirements?' },
    { level: 'design', pattern: 'design' },
    { level: 'interface', pattern: 'interface' },
    { level: 'code', pattern: 'code' },
  ],
};

/**
 * 合法性判据（既有语义，逐字节零回归）：正文里**出现过**任一类型词即判合法。
 * 它只回答「合法吗」，**不能**回答「声明的是哪一类」——`代码级（不涉及设计级或需求级变更）`
 * 与 `设计级 / 代码级` 都通过本检查。要拿唯一类型必须用 `resolveChangeType`。
 */
export function isValidChangeType(content: string, locale: 'zh' | 'en'): boolean {
  const alt = CHANGE_TYPE_LEXICON[locale].map(e => e.pattern).join('|');
  return locale === 'zh'
    ? new RegExp(`(?:${alt})`).test(content)
    : new RegExp(`(?:${alt})(?:\\s+level)?`, 'i').test(content);
}

/**
 * 声明类型解析（S35 新增能力，非既有正则的等价提取）：
 * ① 取「变更类型」章节正文的首个非空行作为声明主体；② 剥去全角（…）与半角(…)说明文字；
 * ③ 在剩余文本上全局匹配类型词；④ **恰好命中一个**才返回该类型，0 个或 ≥2 个返回 `null`。
 * `null` 是歧义信号，消费方一律静默（宁可漏报不误报）——注意歧义正文本身通过
 * `isValidChangeType`，**不会**触发 `proposal_change_type_invalid`，两条通道同时静默。
 */
/**
 * 剥去括号说明文字，**深度感知**：正则 `（[^）]*）` 只吃到第一个右括号，
 * `代码级（修复解析器（局部实现），不涉及需求级）` 会残留「，不涉及需求级）」而多出一个
 * 类型词，使解析退化为歧义 null（静默漏报）。故按深度逐字符扫描，全角 / 半角同等处理。
 * 未配对的右括号忽略；未闭合的左括号之后全部视作说明文字（保守吞掉 → 至多静默，不误报）。
 */
function stripParentheticals(line: string): string {
  let out = '';
  let depth = 0;
  for (const ch of line) {
    if (ch === '（' || ch === '(') { depth += 1; continue; }
    if (ch === '）' || ch === ')') { if (depth > 0) depth -= 1; continue; }
    if (depth === 0) out += ch;
  }
  return out;
}

export function resolveChangeType(content: string, locale: 'zh' | 'en'): ChangeTypeLevel | null {
  const firstLine = content.replace(/<!--[^]*?-->/g, '')
    .split('\n').map(line => line.trim()).find(line => line.length > 0);
  if (!firstLine) return null;
  // 说明文字里的类型词不参与解析：`代码级（不涉及设计级或需求级变更）` 必须解析为代码级。
  const stripped = stripParentheticals(firstLine);
  let hits = 0;
  let found: ChangeTypeLevel | null = null;
  for (const entry of CHANGE_TYPE_LEXICON[locale]) {
    const matches = stripped.match(new RegExp(entry.pattern, locale === 'en' ? 'gi' : 'g'));
    if (!matches) continue;
    hits += matches.length;
    found = entry.level;
  }
  return hits === 1 ? found : null;
}

/**
 * 从整份 proposal.md 解析声明的变更类型：定位「变更类型」canonical 章节后交给 `resolveChangeType`。
 * 章节缺失 / 为空 / 仍含模板占位 → `null`（那些形态由既有 canonical 判据覆盖，消费方不重复报）。
 */
export function resolveProposalChangeType(
  proposalContent: string,
  locale: 'zh' | 'en' = detectPlanLocale(proposalContent),
): ChangeTypeLevel | null {
  const section = scanSections(proposalContent).find(s => s.id === 'type');
  if (!section) return null;
  if (!meaningfulSectionBody(section.content) || hasPlaceholder(section.content)) return null;
  return resolveChangeType(section.content, locale);
}

function scanSections(content: string): PlanSection[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const scan = authorityScan(lines);
  const headings: Array<{ line: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (scan.masked[i]) continue;
    const match = /^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(scan.text[i]);
    if (match) headings.push({ line: i, title: match[1].trim() });
  }
  const result: PlanSection[] = [];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    const id = SECTION_ORDER.find(key => Object.values(PLAN_SECTION_REGISTRY[key]).some(title => title === heading.title));
    if (!id) continue;
    const end = headings[index + 1]?.line ?? lines.length;
    result.push({ id, title: heading.title, line: heading.line + 1, content: lines.slice(heading.line + 1, end).join('\n') });
  }
  return result;
}

function issue(code: PlanPackageIssueCode, path: string, message: string, fixHint: string, extra: Partial<CompletionIssue> = {}): CompletionIssue {
  return { code, path, message, fix_hint: fixHint, ...extra };
}

function deploymentFieldsValid(content: string, locale: 'zh' | 'en'): boolean {
  const fields = locale === 'zh'
    ? ['是否需要部署', '部署原因', '影响环境', '是否涉及数据迁移', '是否需要回滚预案', '是否需要 smoke']
    : ['Deployment required', 'Deployment reason', 'Affected environments', 'Data migration involved', 'Rollback plan required', 'Smoke required'];
  const values = new Map<string, string[]>();
  for (const field of fields) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    values.set(field, [...content.matchAll(new RegExp(`^-\\s*${escaped}\\s*[:：]\\s*(.*)$`, 'gmi'))].map(row => row[1].trim()));
  }
  if (fields.some(field => values.get(field)?.length !== 1 || !values.get(field)?.[0])) return false;
  const booleanFields = [fields[0], fields[3], fields[4], fields[5]];
  return booleanFields.every(field => locale === 'zh'
    ? /^(?:是|否)(?:$|\s*[(（；;])/.test(values.get(field)![0])
    : /^(?:yes|no)(?:$|\s*[(;])/i.test(values.get(field)![0]));
}

export function evaluateProposalStructure(content: string, path = 'proposal.md', locale: 'zh' | 'en' = detectPlanLocale(content)): CompletionIssue[] {
  const sections = scanSections(content);
  const issues: CompletionIssue[] = [];
  for (const id of SECTION_ORDER) {
    const expected = PLAN_SECTION_REGISTRY[id][locale];
    const found = sections.filter(section => section.id === id && section.title === expected);
    if (found.length === 0) {
      issues.push(issue('proposal_required_section_missing', path, `缺少 canonical 章节：${expected}`, `补充且仅保留一个 \`## ${expected}\` 章节。`, { section_id: id, expected }));
      continue;
    }
    if (found.length > 1) {
      issues.push(issue('proposal_required_section_duplicate', path, `canonical 章节重复：${expected}`, `合并重复内容，仅保留一个 \`## ${expected}\`。`, { section_id: id, line: found[1].line, actual: String(found.length), expected: '1' }));
      continue;
    }
    const section = found[0];
    const body = meaningfulSectionBody(section.content);
    if (!body) {
      issues.push(issue('proposal_required_section_empty', path, `canonical 章节为空：${expected}`, `在 \`## ${expected}\` 下填入真实内容。`, { section_id: id, line: section.line, expected }));
    } else if (hasPlaceholder(section.content)) {
      issues.push(issue('proposal_placeholder_remaining', path, `canonical 章节仍含模板占位：${expected}`, '用真实提案内容替换方括号占位文本。', { section_id: id, line: section.line, actual: body.slice(0, 160), expected: '无占位符的真实内容' }));
    }
  }
  const typeSection = sections.find(section => section.id === 'type');
  if (typeSection && meaningfulSectionBody(typeSection.content) && !hasPlaceholder(typeSection.content)) {
    // 判据提取为共享导出（S35）：语义与此前内联正则逐字节相同，change-lint 消费同一词表而非照抄正则。
    const valid = isValidChangeType(typeSection.content, locale);
    if (!valid) issues.push(issue('proposal_change_type_invalid', path, '变更类型不在允许集合中。', '使用需求级/设计级/接口级/代码级（或英文等价值）。', { section_id: 'type', line: typeSection.line, actual: meaningfulSectionBody(typeSection.content), expected: 'requirements|design|interface|code' }));
  }
  const deployment = sections.find(section => section.id === 'deployment');
  if (deployment && meaningfulSectionBody(deployment.content) && !hasPlaceholder(deployment.content) && !deploymentFieldsValid(deployment.content, locale)) {
    issues.push(issue('proposal_deployment_fields_invalid', path, '部署影响字段缺失、重复或布尔值非法。', '按 canonical scaffold 补齐六个部署字段，布尔值使用是/否或 yes/no。', { section_id: 'deployment', line: deployment.line, expected: '六个唯一且合法的部署字段' }));
  }
  return sortCompletionIssues(issues);
}

export function sortCompletionIssues(issues: CompletionIssue[]): CompletionIssue[] {
  const unique = new Map<string, CompletionIssue>();
  for (const item of issues) {
    const key = [item.code, item.path, item.section_id ?? '', item.line ?? 0, item.actual ?? '', item.expected ?? ''].join('\0');
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()].sort((left, right) => ISSUE_ORDER.indexOf(left.code) - ISSUE_ORDER.indexOf(right.code)
    || left.path.localeCompare(right.path) || (left.line ?? 0) - (right.line ?? 0)
    || (left.section_id ?? '').localeCompare(right.section_id ?? '') || left.code.localeCompare(right.code));
}
