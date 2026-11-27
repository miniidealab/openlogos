/**
 * proposal「验收标准」段的唯一解析入口（verify-self-sufficient-cases，功能规格 §2.106.8）。
 *
 * change-lint（格式检查）与 verify（环境要求对账，§2.106.5）消费同一个解析结果——
 * 条目集合只在这里算一次，两侧不得各写一套读法。
 *
 * 本段是**非 canonical 段**：不进 `PLAN_SECTION_REGISTRY`，缺段只产生警告，不影响 Plan Package 判定。
 */

export const ACCEPTANCE_SECTION_TITLES = ['验收标准', 'Acceptance Criteria'] as const;

export type AcceptanceFieldId = 'requirements' | 'platform' | 'human';

export const ACCEPTANCE_FIELDS: ReadonlyArray<{ id: AcceptanceFieldId; zh: string; en: string }> = [
  { id: 'requirements', zh: '自动验收环境要求', en: 'Automated verification requirements' },
  { id: 'platform', zh: '平台限定用例', en: 'Platform-limited cases' },
  { id: 'human', zh: '需要人参与的验收', en: 'Human-involved acceptance' },
];

export type AcceptanceEntryKind = 'env' | 'command' | 'check';

/** 环境要求条目：`env:<变量名>` / `command:<命令名>` / `check:<检查名>`。 */
export interface AcceptanceEntry {
  kind: AcceptanceEntryKind;
  name: string;
  /** 条目原文（不含反引号），如 `env:DB_URL`。 */
  raw: string;
}

export type AcceptanceProblemKind =
  | 'field_missing'
  | 'field_empty'
  | 'field_placeholder'
  | 'entry_invalid'
  | 'entries_missing';

export interface AcceptanceProblem {
  kind: AcceptanceProblemKind;
  field: AcceptanceFieldId;
  /** 字段名（按段内实际使用的语言给出）。 */
  label: string;
  /** proposal.md 中的 1 基行号；字段缺失时为段标题行。 */
  line: number;
  /** 非法条目原文（仅 entry_invalid）。 */
  entry?: string;
}

export interface AcceptanceFieldValue {
  line: number;
  value: string;
}

export interface AcceptanceCriteriaParse {
  present: boolean;
  /**
   * 段内是否出现过任一结构化字段名。早于本能力的提案常有自由格式的「## 验收标准」段（只列验收条目、
   * 不含三个字段）：这类旧式段按「未提供结构化验收标准」处理——change-lint 只出缺段提醒、verify 不对账，
   * 不把在途提案判为违规。出现任一字段名即视为结构化段，三字段规则全部生效。
   */
  structured: boolean;
  /** 段标题的 1 基行号；不在场时为 null。 */
  line: number | null;
  fields: Partial<Record<AcceptanceFieldId, AcceptanceFieldValue>>;
  /** 「自动验收环境要求」中的合法条目（去重、保持出现序）。 */
  entries: AcceptanceEntry[];
  problems: AcceptanceProblem[];
}

/** 条目名称规则与 `verify.requirements` 的 check 名称同源（§2.106.4）。 */
export const ACCEPTANCE_ENTRY_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ENTRY_KINDS: readonly AcceptanceEntryKind[] = ['env', 'command', 'check'];
/** 形如 `前缀:…` 的反引号片段才视为条目候选；路径、命令片段等不含前缀冒号的引用不参与判定。 */
const ENTRY_CANDIDATE_RE = /^([A-Za-z][A-Za-z0-9_-]*):(.*)$/s;
const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

function isNoneValue(value: string): boolean {
  const v = value.trim();
  if (/^(无|none|n\/a)$/i.test(v)) return true;
  // 「无（说明）」「None (reason)」
  return /^(无|none)\s*[（(]/i.test(v);
}

function isPlaceholder(value: string): boolean {
  const v = value.trim();
  return v.startsWith('[') && v.endsWith(']');
}

function labelFor(field: AcceptanceFieldId, useEn: boolean): string {
  const def = ACCEPTANCE_FIELDS.find(f => f.id === field)!;
  return useEn ? def.en : def.zh;
}

/** 解析 proposal 全文中的「验收标准」段。 */
export function parseAcceptanceCriteria(content: string): AcceptanceCriteriaParse {
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let start = -1;
  let useEn = false;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = HEADING_RE.exec(line);
    if (!h) continue;
    const level = h[1].length;
    if (start < 0) {
      if (level === 2 && (ACCEPTANCE_SECTION_TITLES as readonly string[]).includes(h[2])) {
        start = i;
        useEn = h[2] === 'Acceptance Criteria';
      }
    } else if (level <= 2) {
      end = i;
      break;
    }
  }
  if (start < 0) return { present: false, structured: false, line: null, fields: {}, entries: [], problems: [] };

  const fields: Partial<Record<AcceptanceFieldId, AcceptanceFieldValue>> = {};
  let current: AcceptanceFieldId | null = null;
  inFence = false;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (FENCE_RE.test(line)) { inFence = !inFence; current = null; continue; }
    if (inFence) continue;
    const m = /^\s*[-*]\s*([^:：]+?)\s*[:：]\s*(.*)$/.exec(line);
    const def = m ? ACCEPTANCE_FIELDS.find(f => f.zh === m[1] || f.en === m[1]) : undefined;
    if (m && def) {
      if (!fields[def.id]) fields[def.id] = { line: i + 1, value: m[2].trim() };
      current = fields[def.id]!.line === i + 1 ? def.id : null;
      continue;
    }
    // 缩进续行并入当前字段
    if (current && /^\s{2,}\S/.test(line)) {
      const f = fields[current]!;
      f.value = f.value ? `${f.value} ${line.trim()}` : line.trim();
      continue;
    }
    if (line.trim() !== '') current = null;
  }

  // 评审 code-r1 F5（§2.106.8、AC-VERIFY-SELF-09）：段标题在场即按结构化段逐项校验——三个字段全部缺失（含删空字段、
  // 只剩自由文本）同样逐项报 field_missing，不再归入「旧式自由格式」只提醒的分支；缺段仅指标题本身不存在。
  const problems: AcceptanceProblem[] = [];
  const entries: AcceptanceEntry[] = [];
  for (const def of ACCEPTANCE_FIELDS) {
    const label = labelFor(def.id, useEn);
    const f = fields[def.id];
    if (!f) { problems.push({ kind: 'field_missing', field: def.id, label, line: start + 1 }); continue; }
    if (f.value === '') { problems.push({ kind: 'field_empty', field: def.id, label, line: f.line }); continue; }
    if (isPlaceholder(f.value)) { problems.push({ kind: 'field_placeholder', field: def.id, label, line: f.line }); continue; }
    if (def.id !== 'requirements' || isNoneValue(f.value)) continue;
    const seen = new Set<string>();
    let candidates = 0;
    for (const span of f.value.matchAll(/`([^`]*)`/g)) {
      const raw = span[1].trim();
      const cm = ENTRY_CANDIDATE_RE.exec(raw);
      if (!cm) continue;
      candidates++;
      const kind = cm[1] as AcceptanceEntryKind;
      const name = cm[2];
      if (!ENTRY_KINDS.includes(kind) || !ACCEPTANCE_ENTRY_NAME_RE.test(name)) {
        problems.push({ kind: 'entry_invalid', field: def.id, label, line: f.line, entry: raw });
        continue;
      }
      if (seen.has(raw)) continue;
      seen.add(raw);
      entries.push({ kind, name, raw });
    }
    if (candidates === 0) problems.push({ kind: 'entries_missing', field: def.id, label, line: f.line });
  }
  return { present: true, structured: true, line: start + 1, fields, entries, problems };
}

/** 供 change-lint 渲染单条问题的 message 与 fix_hint。 */
export function describeAcceptanceProblem(p: AcceptanceProblem, relPath: string): { message: string; fix_hint: string } {
  const where = `${relPath}:${p.line}`;
  const entryHint = '「自动验收环境要求」写「无」，或写一个及以上反引号条目：`env:<变量名>`、`command:<命令名>`、`check:<检查名>`（名称匹配 ^[A-Za-z0-9][A-Za-z0-9._-]*$），条目后可跟说明文字';
  switch (p.kind) {
    case 'field_missing':
      return { message: `${where} 验收标准段缺少字段「${p.label}」`, fix_hint: `在验收标准段补一行「- ${p.label}：…」；没有就写「无」` };
    case 'field_empty':
      return { message: `${where} 验收标准字段「${p.label}」为空`, fix_hint: `为「${p.label}」写明内容；没有就写「无」` };
    case 'field_placeholder':
      return { message: `${where} 验收标准字段「${p.label}」仍为脚手架占位文字`, fix_hint: `用真实内容替换方括号占位；没有就写「无」` };
    case 'entry_invalid':
      return { message: `${where} 验收标准「${p.label}」含非法条目 \`${p.entry}\``, fix_hint: entryHint };
    case 'entries_missing':
      return { message: `${where} 验收标准「${p.label}」写了内容却没有任何合法条目`, fix_hint: entryHint };
  }
}
