/**
 * S45 enterprise-knowledge-base — 有效知识视图（功能规格 §2.102，架构「五十七」57.2～57.4）。
 *
 * 本模块只做**读与判定**：解析知识条目（H1 / 元数据 / 规则表）、给出 §2.102.3 的结构有效性结论、
 * 构建按 KXX 索引的视图、解析场景「适用业务约束」引用、检测重号。不写任何文件。
 *
 * 合成前态的选择（未合并 / 待应用修正 / 已合并不重放）由调用方（change-lint）按既有 `priorStateOf`
 * 阶段判定提供；本模块的 {@link candidateMarkdownAfter} 只负责「给定前态与 delta 求候选后态」，
 * 复用合并期同一合成器（章节路由 `composeOpenLogosMarkdown`、Markdown 整文件 `validateAndStripNonMarkdownDelta`），
 * 保证校验出的后态与 merge 实际写入一致。
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { classifyCanonicalTargetCategory, classifyDeltaRoute, contained, existingPathContained } from './canonical-target.js';
import { composeOpenLogosMarkdown } from './markdown-section-authority.js';
import { validateAndStripNonMarkdownDelta } from './non-markdown-delta.js';
import { firstLineOf } from './whole-file-marker.js';
import { authorityScan, isTableDelimiterRow, tableRowCells } from './markdown-scan.js';

export const KNOWLEDGE_DIR = 'logos/resources/knowledge';
export const KNOWLEDGE_SOURCE_DIR = 'logos/resources/reference/knowledge';
export const SCENARIO_DIR = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
export const CONSTRAINT_SECTION_TITLE = '适用业务约束';

export const KNOWLEDGE_TYPES = ['rule', 'term', 'external-system', 'compliance', 'process'] as const;
export const KNOWLEDGE_SCOPES = ['global', 'module'] as const;
export const KNOWLEDGE_STATUSES = ['active', 'deprecated'] as const;
export type KnowledgeStatus = typeof KNOWLEDGE_STATUSES[number];

export interface KnowledgeRule {
  id: string;
  /** 「状态」列原值（缺列时为 null）。 */
  status: string | null;
  /** 该规则行原文（冻结比较用）。 */
  rowText: string;
  /** 1 起算的行号。 */
  line: number;
}

export interface KnowledgeMeta {
  type?: unknown;
  scope?: unknown;
  module?: unknown;
  tags?: unknown;
  status?: unknown;
  source?: unknown;
}

export interface KnowledgeEntry {
  /** 项目根相对路径。 */
  path: string;
  /** 文件名中的 KXX；文件名不含 KXX 时为 null（不进入视图）。 */
  id: string | null;
  /** §2.102.3 六条判据全部满足。 */
  valid: boolean;
  /** 不满足的判据（人读描述，按判据序）。 */
  problems: string[];
  title: string | null;
  meta: KnowledgeMeta | null;
  status: KnowledgeStatus | null;
  rules: KnowledgeRule[];
}

/** KXX 提取（宽松，供重号诊断与占号）：模块前缀可缺省。**提取成功不等于命名有效**。 */
const FILE_ID_RE = /^(?:[a-z][a-z0-9-]*?-)?(K\d+)-[^/]+\.md$/;
/** 规范文件名（code-r2 F2）：`<module>-KXX-<slug>.md`，模块前缀必填（小写字母开头的 kebab-case）、slug 非空。 */
const CANONICAL_FILE_RE = /^[a-z][a-z0-9-]*-(K\d+)-[^/]+\.md$/;
const RULE_ID_RE = /^K\d+-R\d+$/;
const REF_RE = /^(K\d+)(?:-(R\d+))?$/;

/**
 * 知识条目是否为规范目标：`logos/resources/knowledge/` 顶层的 `<module>-KXX-<slug>.md`（模块前缀必填）。
 * 准入（change-lint L10）与落盘视图的有效性判定共用本函数。
 */
export function isCanonicalKnowledgePath(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return posix.dirname(p) === KNOWLEDGE_DIR && CANONICAL_FILE_RE.test(posix.basename(p));
}

/** 知识条目文件名中的 KXX（`core-K03-refund.md` → `K03`；宽松提取，模块前缀可缺省）；不含 KXX 时为 null。 */
export function parseKnowledgeFileId(path: string): string | null {
  const base = posix.basename(path.replace(/\\/g, '/'));
  const m = FILE_ID_RE.exec(base);
  return m ? m[1] : null;
}

/**
 * 一行 Markdown：`text` 为原始行（冻结比较与元数据 YAML 读取用），`view` 为权威结构视图
 * （行内已闭合 HTML 注释已剥除），`inFence` 为结构掩码（围栏 / HTML 注释 / 缩进代码，code-r2 F3）。
 */
interface MdLine { text: string; view: string; line: number; inFence: boolean }

/** 复用 markdown-scan 的权威结构扫描：注释内的标题、表格与正文不参与结构识别。 */
function scanLines(content: string): MdLine[] {
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
  const scan = authorityScan(lines);
  return lines.map((raw, i) => ({ text: raw, view: scan.text[i], line: i + 1, inFence: scan.masked[i] }));
}

function headingOf(l: MdLine): { level: number; title: string } | null {
  if (l.inFence) return null;
  const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l.view);
  return m ? { level: m[1].length, title: m[2].trim() } : null;
}

/** 返回标题为 `title` 的第一个章节（不含标题行）的行；无该章节时为 null。 */
function sectionLines(lines: MdLine[], title: string, minLevel = 2): MdLine[] | null {
  for (let i = 0; i < lines.length; i++) {
    const h = headingOf(lines[i]);
    if (!h || h.level < minLevel || h.title !== title) continue;
    const body: MdLine[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const hj = headingOf(lines[j]);
      if (hj && hj.level <= h.level) break;
      body.push(lines[j]);
    }
    return body;
  }
  return null;
}

/** 表格行判定：围栏外、含 `|` 的行。单元格切分复用 markdown-scan 的 GFM 语义（`\|` 转义与 code span 内管道不分隔）。 */
const isTableLine = (l: MdLine) => !l.inFence && l.view.includes('|');

interface ParsedTable {
  header: string[];
  /** 表头下一行是否为合法分隔行（`|---|---|`，列数与表头一致）。 */
  delimiterOk: boolean;
  rows: Array<{ cells: string[]; text: string; line: number; columnMismatch: boolean }>;
}

/**
 * CommonMark HTML 块类型 6 的块级标签名（类型 7 的任意标签、自动链接 `<https://…>` 与行内标签如 `<span>`
 * 不能打断段落 / 表格续行，code-r5 F3）。
 */
const HTML_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup',
  'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame',
  'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link',
  'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section',
  'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
]);

/**
 * 该行是否开始一个**能打断表格**的 HTML 块（CommonMark 类型 1～6）：`<script|pre|style|textarea`、`<!--`、`<?`、
 * `<!X`、`<![CDATA[`，以及块级标签名（`<div>`、`</table>` 等）。类型 7（任意行内标签）与自动链接不打断，
 * 这类行仍是表格数据行，交给列数 / ID / 正文校验。
 */
function startsInterruptingHtmlBlock(view: string): boolean {
  const t = view.replace(/^ {0,3}/, '');
  if (!t.startsWith('<')) return false;
  if (/^<(?:script|pre|style|textarea)(?:\s|>|$)/i.test(t)) return true;  // 类型 1
  if (t.startsWith('<!--') || t.startsWith('<?') || /^<![A-Za-z]/.test(t) || t.startsWith('<![CDATA[')) return true; // 类型 2～5
  const m = /^<\/?([A-Za-z][A-Za-z0-9]*)(?:\s|\/?>|$)/.exec(t);              // 类型 6
  return m !== null && HTML_BLOCK_TAGS.has(m[1].toLowerCase());
}

/**
 * 该行是否开始一个新的块级结构（GFM：表格在此处结束，code-r4 F3）——ATX 标题、引用块、列表项（`-` / `+` / `*` /
 * `1.` / `1)`）、分隔线（`***` / `---` / `___`）、能打断表格的 HTML 块（CommonMark 类型 1～6）与围栏起始。围栏与 HTML 注释另由结构掩码处理，这里也一并识别。
 */
function startsNewBlock(view: string): boolean {
  return /^ {0,3}#{1,6}(\s|$)/.test(view)
    || /^ {0,3}>/.test(view)
    || /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:\s|$)/.test(view)
    || /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(view)
    || startsInterruptingHtmlBlock(view)
    || /^ {0,3}(?:`{3,}|~{3,})/.test(view);
}

/** 章节内第一张表（围栏外），按 GFM 语义切分（code-r1 F3：复用 tableRowCells / isTableDelimiterRow）。 */
function firstTable(body: MdLine[]): ParsedTable | null {
  let i = 0;
  while (i < body.length && !isTableLine(body[i])) i++;
  if (i >= body.length) return null;
  const header = tableRowCells(body[i].view);
  const delimiterLine = body[i + 1];
  const delimiterOk = delimiterLine !== undefined && isTableLine(delimiterLine)
    && isTableDelimiterRow(delimiterLine.view) && tableRowCells(delimiterLine.view).length === header.length;
  const rows: ParsedTable['rows'] = [];
  for (let j = i + 1; j < body.length; j++) {
    if (j === i + 1 && delimiterOk) continue;
    if (delimiterOk) {
      // code-r3 F3：表头与分隔行确认后按 GFM 表格边界读取数据行——不含竖线的续行仍是数据行（单列），交给列数与 ID 校验。
      // code-r4 F3：表格在空行、被遮蔽结构（围栏 / 注释 / 缩进代码）或任一新块级结构的起始行处结束（startsNewBlock）。
      const l = body[j];
      if (l.inFence || l.view.trim() === '' || startsNewBlock(l.view)) break;
    } else if (!isTableLine(body[j])) {
      break;
    }
    const cells = tableRowCells(body[j].view);
    rows.push({ cells, text: body[j].text, line: body[j].line, columnMismatch: cells.length !== header.length });
  }
  return { header, delimiterOk, rows };
}

function metaYaml(lines: MdLine[]): { ok: true; meta: KnowledgeMeta } | { ok: false; reason: string } {
  const body = sectionLines(lines, '元数据');
  if (body === null) return { ok: false, reason: '缺「元数据」节' };
  const start = body.findIndex(l => /^\s*```\s*ya?ml\s*$/i.test(l.text));
  if (start < 0) return { ok: false, reason: '「元数据」节缺 ```yaml 代码块' };
  const yamlLines: string[] = [];
  let closed = false;
  for (let k = start + 1; k < body.length; k++) {
    if (/^\s*```\s*$/.test(body[k].text)) { closed = true; break; }
    yamlLines.push(body[k].text);
  }
  if (!closed) return { ok: false, reason: '「元数据」YAML 代码块未闭合' };
  try {
    const parsed = parseYaml(yamlLines.join('\n'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: '「元数据」YAML 不是对象' };
    return { ok: true, meta: parsed as KnowledgeMeta };
  } catch {
    return { ok: false, reason: '「元数据」YAML 不可解析' };
  }
}

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * `source.path` 判定（§2.102.3 ⑤）：仓库相对、不含 `..`，规范化并解析真实路径（含 symlink）后落在
 * `logos/resources/reference/knowledge/` 内且为现存普通文件。归属判定复用 canonical-target 的
 * `existingPathContained` / `contained`。返回问题描述；合法时为 null。
 */
export function knowledgeSourcePathProblem(root: string, rawPath: string): string | null {
  const p = rawPath.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return `source.path「${rawPath}」不是仓库相对路径`;
  if (p.split('/').some(seg => seg === '..')) return `source.path「${rawPath}」含 ..`;
  const normalized = posix.normalize(p);
  if (!normalized.startsWith(`${KNOWLEDGE_SOURCE_DIR}/`)) return `source.path「${rawPath}」不在 ${KNOWLEDGE_SOURCE_DIR}/ 内`;
  const base = join(root, ...KNOWLEDGE_SOURCE_DIR.split('/'));
  const abs = join(root, ...normalized.split('/'));
  if (!existsSync(base) || !existsSync(abs)) return `source.path「${rawPath}」指向的文件不存在`;
  // code-r1 F5：先以仓库真实根为锚——原文目录（含其任一上级）解析真实路径后必须恰为仓库内约定位置，
  // 否则原文目录或其上级链接到仓库外时，「目标属于该根」的比较会在同一外部目录里成立，克隆者拿不到原文。
  let realBase: string;
  try {
    realBase = realpathSync(base);
    const expectedBase = join(realpathSync(root), ...KNOWLEDGE_SOURCE_DIR.split('/'));
    if (realBase !== expectedBase || !contained(realBase, realpathSync(root))) {
      return `source.path「${rawPath}」所在原文目录 ${KNOWLEDGE_SOURCE_DIR}/ 解析真实路径后不在仓库内约定位置`;
    }
  } catch {
    return `source.path「${rawPath}」无法解析`;
  }
  if (!existingPathContained(base, abs)) return `source.path「${rawPath}」解析真实路径后不在 ${KNOWLEDGE_SOURCE_DIR}/ 内`;
  try {
    const real = realpathSync(abs);
    if (!contained(real, realBase) || !statSync(real).isFile()) {
      return `source.path「${rawPath}」解析真实路径后不是 ${KNOWLEDGE_SOURCE_DIR}/ 内的普通文件`;
    }
  } catch {
    return `source.path「${rawPath}」无法解析`;
  }
  return null;
}

export interface ParseKnowledgeOptions {
  /** 校验 `source.path` 归属所需的项目根；不提供时跳过 source 文件存在性与归属（只校验形态）。 */
  root?: string;
}

/** 解析一个知识条目并给出 §2.102.3 的结构有效性结论。 */
export function parseKnowledgeEntry(path: string, content: string, opts: ParseKnowledgeOptions = {}): KnowledgeEntry {
  const id = parseKnowledgeFileId(path);
  const problems: string[] = [];
  const lines = scanLines(content);

  // ① H1 以文件名中的同一 KXX 开头
  const h1 = lines.map(headingOf).find(h => h !== null && h.level === 1) ?? null;
  const title = h1 ? h1.title : null;
  if (!id || !isCanonicalKnowledgePath(path)) problems.push('文件名不符合 <module>-KXX-<slug>.md');
  if (!title) problems.push('缺 H1 标题');
  else if (id && !new RegExp(`^${id}(?!\\d)`).test(title)) problems.push(`H1 未以 ${id} 开头`);

  // ② 元数据 YAML
  let meta: KnowledgeMeta | null = null;
  const m = metaYaml(lines);
  if (!m.ok) problems.push(m.reason);
  else meta = m.meta;

  let status: KnowledgeStatus | null = null;
  if (meta) {
    // ③ type / scope / status，scope=module 时 module
    if (!(KNOWLEDGE_TYPES as readonly unknown[]).includes(meta.type)) problems.push(`type 缺失或取值非法（合法：${KNOWLEDGE_TYPES.join(' / ')}）`);
    if (!(KNOWLEDGE_SCOPES as readonly unknown[]).includes(meta.scope)) problems.push('scope 缺失或取值非法（合法：global / module）');
    if (meta.scope === 'module' && !nonEmptyString(meta.module)) problems.push('scope=module 时 module 不能为空');
    if ((KNOWLEDGE_STATUSES as readonly unknown[]).includes(meta.status)) status = meta.status as KnowledgeStatus;
    else problems.push('status 缺失或取值非法（合法：active / deprecated）');
    // ④ tags
    if (!Array.isArray(meta.tags) || meta.tags.length === 0 || !meta.tags.every(nonEmptyString)) problems.push('tags 缺失或不是非空字符串列表');
    // ⑤ source
    if (!Array.isArray(meta.source) || meta.source.length === 0) {
      problems.push('source 缺失或为空');
    } else {
      meta.source.forEach((item, idx) => {
        const rec = item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null;
        if (!rec || !nonEmptyString(rec.path)) { problems.push(`source[${idx}] 缺 path`); return; }
        if (!nonEmptyString(rec.version)) problems.push(`source[${idx}] 缺 version`);
        if (opts.root !== undefined) {
          const pp = knowledgeSourcePathProblem(opts.root, rec.path);
          if (pp) problems.push(pp);
        } else {
          const p = rec.path.replace(/\\/g, '/');
          if (p.startsWith('/') || p.split('/').includes('..') || !posix.normalize(p).startsWith(`${KNOWLEDGE_SOURCE_DIR}/`)) {
            problems.push(`source.path「${rec.path}」不在 ${KNOWLEDGE_SOURCE_DIR}/ 内`);
          }
        }
      });
    }
  }

  // ⑥ 规则表
  const rules: KnowledgeRule[] = [];
  const rulesBody = sectionLines(lines, '规则');
  const table = rulesBody ? firstTable(rulesBody) : null;
  const isRuleType = meta?.type === 'rule';
  if (isRuleType && rulesBody !== null && !table) problems.push('「规则」节没有表格');
  if (table) {
    const statusCol = table.header.findIndex(h => h === '状态');
    const ruleCol = table.header.findIndex(h => h === '规则');
    if (isRuleType) {
      if (!table.delimiterOk) problems.push('规则表缺合法分隔行（表头下一行须为 |---| 形态且列数一致）');
      if (statusCol < 0) problems.push('规则表缺「状态」列');
      if (ruleCol < 0) problems.push('规则表缺「规则」列');
    }
    for (const row of table.rows) {
      const first = row.cells[0] ?? '';
      const rowStatus = statusCol >= 0 ? (row.cells[statusCol] ?? '') : null;
      const ownPrefixed = id !== null && RULE_ID_RE.test(first) && first.startsWith(`${id}-`);
      if (ownPrefixed) rules.push({ id: first, status: rowStatus, rowText: row.text, line: row.line });
      if (isRuleType) {
        if (row.columnMismatch) problems.push(`规则表第 ${row.line} 行列数 ${row.cells.length} 与表头 ${table.header.length} 不一致`);
        if (!ownPrefixed) problems.push(`规则表第 ${row.line} 行首列「${first}」不是本条目的 ${id ?? 'KXX'}-Rn`);
        else if (statusCol >= 0 && !(KNOWLEDGE_STATUSES as readonly string[]).includes(rowStatus ?? '')) problems.push(`规则 ${first} 的状态「${rowStatus}」不是 active / deprecated`);
        if (ownPrefixed && ruleCol >= 0 && (row.cells[ruleCol] ?? '').trim() === '') problems.push(`规则 ${first} 的规则正文为空`);
      }
    }
  }
  if (isRuleType && rules.length === 0 && !problems.some(p => p.startsWith('规则表第'))) problems.push('type=rule 但「规则」表没有规则行');

  return { path, id, valid: problems.length === 0, problems: [...new Set(problems)], title, meta, status, rules };
}

export interface KnowledgeView {
  entries: KnowledgeEntry[];
  byId: Map<string, KnowledgeEntry[]>;
}

export function buildKnowledgeView(entries: KnowledgeEntry[]): KnowledgeView {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const byId = new Map<string, KnowledgeEntry[]>();
  for (const e of sorted) {
    if (!e.id) continue;
    const list = byId.get(e.id) ?? [];
    list.push(e);
    byId.set(e.id, list);
  }
  return { entries: sorted, byId };
}

/** 读取磁盘上 `logos/resources/knowledge/` 下的条目原文（顶层 `.md`）。 */
export function readKnowledgeDir(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const dir = join(root, ...KNOWLEDGE_DIR.split('/'));
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue;
    const abs = join(dir, name);
    try {
      if (!statSync(abs).isFile()) continue;
      out.set(`${KNOWLEDGE_DIR}/${name}`, readFileSync(abs, 'utf-8'));
    } catch { /* 不可读条目不进视图 */ }
  }
  return out;
}

export interface DuplicateId {
  id: string;
  /** 涉及的条目路径（KXX 重号为两个以上文件；KXX-Rn 重号为同一文件）。 */
  paths: string[];
  /** KXX-Rn 重号时的行号。 */
  lines?: number[];
}

/** 视图中的全部重号：KXX 跨文件重复、同一条目内 KXX-Rn 重复。 */
export function findDuplicateIds(view: KnowledgeView): DuplicateId[] {
  const out: DuplicateId[] = [];
  for (const [id, list] of view.byId) {
    if (list.length > 1) out.push({ id, paths: list.map(e => e.path) });
  }
  for (const e of view.entries) {
    const seen = new Map<string, number[]>();
    for (const r of e.rules) seen.set(r.id, [...(seen.get(r.id) ?? []), r.line]);
    for (const [rid, lines] of seen) if (lines.length > 1) out.push({ id: rid, paths: [e.path, e.path], lines });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type KnowledgeResolution =
  | { kind: 'ok'; entry: KnowledgeEntry; rule: KnowledgeRule | null; deprecated: boolean }
  | { kind: 'unknown'; reason: 'missing' | 'invalid'; entryPath?: string }
  | { kind: 'duplicate'; id: string; paths: string[] };

/** 解析 `KXX` / `KXX-Rn` 引用（§2.102.7）：歧义返回 duplicate，结构无效返回 unknown(invalid)。 */
export function resolveKnowledgeReference(view: KnowledgeView, ref: string): KnowledgeResolution {
  const m = REF_RE.exec(ref);
  if (!m) return { kind: 'unknown', reason: 'missing' };
  const list = view.byId.get(m[1]) ?? [];
  if (list.length === 0) return { kind: 'unknown', reason: 'missing' };
  if (list.length > 1) return { kind: 'duplicate', id: m[1], paths: list.map(e => e.path) };
  const entry = list[0];
  if (!entry.valid) return { kind: 'unknown', reason: 'invalid', entryPath: entry.path };
  if (!m[2]) return { kind: 'ok', entry, rule: null, deprecated: entry.status === 'deprecated' };
  const rules = entry.rules.filter(r => r.id === ref);
  if (rules.length === 0) return { kind: 'unknown', reason: 'missing' };
  if (rules.length > 1) return { kind: 'duplicate', id: ref, paths: [entry.path, entry.path] };
  return { kind: 'ok', entry, rule: rules[0], deprecated: entry.status === 'deprecated' || rules[0].status === 'deprecated' };
}

export interface ConstraintReference { ref: string; line: number }

/** 场景文档是否含「适用业务约束」章节（围栏外标题）。 */
export function hasConstraintSection(content: string): boolean {
  return sectionLines(scanLines(content), CONSTRAINT_SECTION_TITLE) !== null;
}

/** 从场景文档「适用业务约束」章节表格首列提取引用（§2.102.7）；只认首列形如 KXX / KXX-Rn 的单元格。 */
export function extractConstraintReferences(content: string): ConstraintReference[] {
  const body = sectionLines(scanLines(content), CONSTRAINT_SECTION_TITLE);
  if (!body) return [];
  const table = firstTable(body);
  if (!table) return [];
  const out: ConstraintReference[] = [];
  for (const row of table.rows) {
    const first = (row.cells[0] ?? '').replace(/`/g, '').trim();
    if (REF_RE.test(first)) out.push({ ref: first, line: row.line });
  }
  return out;
}

/**
 * 给定前态与一份 delta，求 Markdown 目标的候选后态——与 merge 同一合成器：首行声明 Markdown 整文件封装
 * 且受理合法 → 剥离 payload；章节路由 → `composeOpenLogosMarkdown`。合成失败返回 null（失败归既有 L4 判据）。
 */
export function candidateMarkdownAfter(
  root: string,
  targetPath: string,
  deltaText: string,
  prior: { mode: 'CREATE' | 'MODIFY'; content: string | null },
): string | null {
  const route = classifyDeltaRoute({
    firstLine: firstLineOf(deltaText),
    targetPath,
    semanticCategory: classifyCanonicalTargetCategory(targetPath),
    mode: prior.mode,
  });
  try {
    if (route.kind === 'invalid-envelope') return null;
    if (route.kind === 'whole-file') {
      const checked = validateAndStripNonMarkdownDelta(deltaText, prior.mode, targetPath, { root });
      return checked.ok && typeof checked.payload === 'string' ? checked.payload : null;
    }
    return composeOpenLogosMarkdown(prior.content ?? '', deltaText, prior.mode);
  } catch {
    return null;
  }
}
