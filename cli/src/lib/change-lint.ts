/**
 * S35 change-lint —— 提案计划产物左移硬检查的共享判据层（change-lint-shift-left）。
 *
 * 定位：`openlogos change-lint` 是既有共享判据函数的**打包调用层**（架构 §二十三）。
 * 不变量：严禁第二份判据——L1/L2/L3/L5 直接复用 proposal-lifecycle.ts 的既有导出；
 * L4（validateMarkdownDelta，fence-aware）在本文件单点实现并由 merge.ts 打包调用；
 * L6 与路径枚举归共享分类器 delta-classify.ts（merge 的 scanDeltas 为其投影）；
 * L7 复用 check-ui-prototype 的纯 evaluator。
 * 只读：本文件所有函数不写任何项目文件 / marker / 哈希清单。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseTaskSections,
  isCodeRequiredForProposal,
  resolveProposalDeploymentDecision,
  evaluateTestIdEvidence,
  extractStructuredTestIds,
} from './proposal-lifecycle.js';
import { authorityScan, stripInlineCode, isTableDelimiterRow, tableRowCells } from './markdown-scan.js';
import {
  DELTA_TO_RESOURCE, classifyProposalDeltas, DeltaScanUnreadableError,
  type DeltaEntryClassification, type MergeDisposition, type LintValidity,
} from './delta-classify.js';
import { analyzeUiDeclarationStructure, isGuiProductType } from './ui-first.js';
import { readProjectYaml } from './project-yaml.js';
import { evaluateUiPrototype } from '../commands/check-ui-prototype.js';

// 单一事实源转发：分类器与类别映射归 delta-classify.ts；既有消费方（merge/tests）从本模块继续可见。
export { DELTA_TO_RESOURCE, classifyProposalDeltas, DeltaScanUnreadableError };
export type { DeltaEntryClassification, MergeDisposition, LintValidity };

// ── violation code 闭合注册表（26 码，spec/cli-json-output.md §3.15 为契约唯一枚举源）──

export const CHANGE_LINT_VIOLATION_CODES = [
  // L1–L6（7 码）
  'tasks_sections_unparsable',
  'tasks_code_header_missing',
  'code_change_requires_real_test_ids',
  'delta_missing_section_marker',
  'delta_template_skeleton',
  'deployment_decision_conflict',
  'delta_path_invalid',
  // L7 既有 checker 13 码
  'design_system_mode_invalid',
  'no_pages_declared',
  'prototype_path_traversal',
  'prototype_basename_invalid',
  'prototype_basename_duplicate',
  'prototype_missing',
  'prototype_extra',
  'prototype_empty',
  'design_system_missing',
  'design_system_invalid',
  'design_system_empty',
  'fallback_reason_missing',
  'fallback_token_forged',
  // L7 新增结构 3 码
  'ui_declaration_missing',
  'ui_declaration_unparsable',
  'ui_impact_not_boolean',
  // L8 S37 守恒 3 码（merge-conservation-archive-audit）
  'delta_implicit_id_removal',
  'delta_removed_unknown_id',
  'delta_section_anchor_unresolvable',
] as const;

export type ChangeLintViolationCode = typeof CHANGE_LINT_VIOLATION_CODES[number];

/** 仅 L2/L3/L5 三处语义真实重合携带可选 flow_reason（序列化类型恒为 string）。 */
const FLOW_REASON_MAP: Partial<Record<ChangeLintViolationCode, string>> = {
  tasks_code_header_missing: 'tasks-code-section-missing',
  code_change_requires_real_test_ids: 'code_change_requires_real_test_ids',
  deployment_decision_conflict: 'deployment_decision_conflict',
};

export interface ChangeLintViolation {
  code: ChangeLintViolationCode;
  /** 相对项目根路径。 */
  path: string;
  message: string;
  fix_hint: string;
  flow_reason?: string;
}

// ── L4：validateMarkdownDelta（前置重构②，fence-aware——F4 修正）──

export const SECTION_MARKER_RE = /^##\s+(ADDED|MODIFIED|REMOVED)\b/m;

/**
 * 权威模板占位字面量唯一常量表：覆盖两个权威模板
 * （spec/change-management.md 的 `[新增内容标题]` 系 + 根 Skill change-writer 的 `[新增章节标题]` 系）
 * × ADDED/MODIFIED/REMOVED 全部标题与正文占位变体。
 */
const TEMPLATE_PLACEHOLDER_TITLES = new Set([
  '[新增内容标题]', '[修改内容标题]', '[删除内容标题]',
  '[新增章节标题]', '[修改章节标题]', '[删除章节标题]',
  '[被删条目所在章节锚]',
]);
const TEMPLATE_PLACEHOLDER_BODY_LINES = new Set([
  '[新增的完整内容]',
  '[修改后的完整内容，替换主文档中同名章节]',
  '[说明删除原因]',
  '[修改后的完整内容，merge 时替换主文档中同名章节]',
  '[说明删除原因，merge 时删除主文档中同名章节]',
  '[说明删除原因；删除锚定章节全节，建议同时列出该节 ID 供审计]',
  '[说明删除原因，merge 时删除主文档中同名章节；建议列出该节 ID 供审计]',
  '[纯声明性标记：逐行点名被删 ID（- <ID> — <删除原因>）；merge 不据其执行编辑]',
  '[纯声明性标记，merge 不据其执行编辑：逐行点名被删 ID]',
]);

export interface MarkdownDeltaValidation {
  missingSectionMarker: boolean;
  templateSkeleton: boolean;
  /** 命中的占位行/占位标题（供 message 定位）。 */
  skeletonHits: string[];
}

/**
 * `.md` delta 结构校验（结构规则而非全文词表，**同一份 fence-aware 扫描**同时判两结论——F4）：
 * - missingSectionMarker：围栏外无任何 ADDED/MODIFIED/REMOVED **物质变更**段标记（围栏内示例不算权威标记）。
 *   S37：`REMOVED-ITEMS` 是合法段标记但**纯声明性**（无物质变更载体）——仅含 REMOVED-ITEMS 的 delta 仍判缺物质标记；
 * - templateSkeleton：围栏外 (a) marker 标题本身是占位标题，或 (b) 存在任一独占一行的权威模板
 *   占位符行——不要求正文全部由占位构成，真实内容与残留占位行混合的部分模板同样命中；
 *   行内代码、代码围栏中的引用不得命中。
 */
export function validateMarkdownDelta(content: string): MarkdownDeltaValidation {
  const lines = content.split(/\r?\n/);
  const scan = authorityScan(lines);
  let hasMaterialMarker = false;
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (scan.masked[i]) continue; // 围栏/缩进代码/HTML 注释内的引用不构成权威结构、不得命中
    const trimmed = scan.text[i].trim();
    // 注意顺序：REMOVED-ITEMS 必须先于 REMOVED 判别（\b 在 `REMOVED-` 处成立，否则被误吞为 REMOVED）。
    const markerMatch = trimmed.match(/^##\s+(REMOVED-ITEMS|ADDED|MODIFIED|REMOVED)\b\s*(?:[—-]\s*(.+))?$/);
    if (markerMatch) {
      if (markerMatch[1] !== 'REMOVED-ITEMS') hasMaterialMarker = true;
      const title = stripInlineCode(markerMatch[2] ?? '').trim();
      if (TEMPLATE_PLACEHOLDER_TITLES.has(title)) hits.push((markerMatch[2] ?? '').trim());
      continue;
    }
    const body = stripInlineCode(trimmed).trim();
    if (TEMPLATE_PLACEHOLDER_BODY_LINES.has(body)) hits.push(trimmed);
  }
  return { missingSectionMarker: !hasMaterialMarker, templateSkeleton: hits.length > 0, skeletonHits: hits };
}

// ── L8：条目守恒判据（S37 merge-conservation-archive-audit，本文件单点实现、merge.ts 打包调用）──

/**
 * ID 模式注册表（S37）：守恒覆盖的 ID 类别唯一事实源——每类含 token 文法 + 结构化抽取位置双要素。
 * 测试 ID 的 token 判形复用 proposal-lifecycle 的权威 parser（结构位置 = 测试表 ID 首列，
 * 由 extractStructuredTestIds 承载）；本注册表只新增场景 ID 与节号两类。严禁在注册表外散落第二份 ID 正则。
 */
export const ID_PATTERN_REGISTRY = {
  /**
   * 场景 ID：`## SXX:` / `### SXX` 形态章节标题——SXX 后接冒号、空白或行尾均为合法结构位置
   * （契约 §2.33.3；真实语料含无冒号的 `### S01` 验收摘要标题）；`S999x` 等前缀伪命中仍拒绝。
   */
  scenarioHeading: /^(S\d+)(?=$|\s|[:：])/,
  /** 场景 ID：场景总览 / 场景地图表行首列单元格（整格恰为 SXX；表结构、表头 schema 与辖属上下文由抽取器把关）。 */
  scenarioRow: /^S\d+$/,
  /** 场景表首列表头语义（结构化归属，code-r1 F3）：首列表头须为「编号 / 场景编号」。 */
  scenarioTableHeader: /^(?:场景\s*)?编号$/,
  /** 场景表第二列表头 schema（code-r2 F3）：正式场景表第二列恒为「场景名称」——普通编号表（如「编号+说明」）不构成场景 ID 结构位置。 */
  scenarioTableSecondHeader: /^场景名称$/,
  /** 场景表辖属语义（code-r2 F3）：表的辖属标题链（块内最近祖先标题 + 章节锚上下文）须含场景总览 / 场景地图语义标题。 */
  scenarioSectionTitle: /场景总览|场景地图/,
  /**
   * 节号完整 token 文法（等价 `N(?:\.N)*(?:[A-Za-z]|\.[A-Za-z])?`）：多级数字 + 可选直接单字母后缀
   * 或末级点分单字母；完整 token 即 ID——`2.29.1` ≠ `2.29.2` ≠ `2.29`，`2.2b` ≠ `2.2c`，`2.19.A` ≠ `2.19.B`。
   * 结构位置 = 仅标题行首 token，版本号 / 散文小数天然排除。
   */
  sectionNumber: /^\d+(?:\.\d+)*(?:[A-Za-z]|\.[A-Za-z])?$/,
} as const;

interface DocHeading { line: number; level: number; text: string }

/** fence-aware 标题扫描（复用 authorityScan 掩码；围栏 / 缩进代码 / 注释内的 `#` 行不构成标题）。 */
function scanHeadings(lines: string[], masked: boolean[], text: string[]): DocHeading[] {
  const out: DocHeading[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (masked[i]) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(text[i]);
    if (m) out.push({ line: i, level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/** 一段行文本的结构化 ID 抽取结果：flat = 无身份维度的类别；scenarioRows = 场景表行 ID → 表身份键集合。 */
interface RegistryIdExtraction {
  flat: Set<string>;
  /**
   * code-r3/r5 F3：场景表行 ID 携带**表身份键**——`<辖属子路径> <同子路径内表序号>`。
   * 辖属子路径 = 章节根以下的辖属标题链（`父 > 子` 连接；直接辖属为空串）；表序号 = 该子路径下
   * 合格场景表在文档序中的 0 基位次（code-r5 F3：同一子路径下多张合法场景表不再共享身份被 `Set` 坍缩，
   * 历史快照副本不能为正式表的删除背书）。
   */
  scenarioRows: Map<string, Set<string>>;
  /** code-r5 F3：辖属子路径 → 该子路径下合格场景表张数（用于违规消息中定位「第几张 / 共几张」）。 */
  scenarioTableCount: Map<string, number>;
}

const IDENTITY_SEP = '\u0000'; // NUL：标题源文本绝不含此字符，作 <子路径, 序号> 分隔符不与子路径内容冲突

/** 组装表身份键：`<子路径> <0 基表序号>`。 */
function makeTableIdentity(subPathKey: string, ordinal: number): string {
  return `${subPathKey}${IDENTITY_SEP}${ordinal}`;
}

/** 把表身份键解码为人读描述（供违规消息）。总张数 >1 时补「第 N 张 / 共 M 张」以消歧同路径多表。 */
function describeTableIdentity(identity: string, countBySubPath: Map<string, number>): string {
  const sep = identity.indexOf(IDENTITY_SEP);
  const subPathKey = sep >= 0 ? identity.slice(0, sep) : identity;
  const ordinal = sep >= 0 ? Number(identity.slice(sep + 1)) : 0;
  const total = countBySubPath.get(subPathKey) ?? 1;
  const base = subPathKey === '' ? '正式表·直接辖属' : `「${subPathKey}」`;
  return total > 1 ? `${base}·第 ${ordinal + 1} 张场景表（共 ${total} 张）` : base;
}

/**
 * 从一段行文本按注册表抽取结构化 ID（测试表 ID 首列 / 场景标题与场景表行首列 / 标题行节号）。
 * code-r1/r2/r3 F3：场景表行只采信同时满足身份绑定的**完整 GFM 表**数据行首格——
 * ① 结构：表头 + delimiter + 数据行、列数一致（孤立 pipe 行出局）；
 * ② schema：首列表头 ∈ {编号, 场景编号} **且第二列表头为「场景名称」**（「编号+说明」类普通编号表出局）；
 * ③ 辖属：辖属标题链（含 contextTitle）须含场景总览 / 场景地图语义标题（其他章节里的编号表出局）；
 * ④ **表身份键**（code-r3）：场景行 ID 不进 flat 集合，而是携带「章节根以下的辖属子路径」身份——
 *   守恒侧仅当既有 ID 与保留 ID **表身份相同**才认可保留，外层场景锚不再是后代子节克隆表的通行证
 *  （`### 历史引用` 下的双列克隆表身份为「历史引用」，与正式表身份 `''` 不同，无法背书删除）。
 * chunkRootIsFirstHeading：目标章节切片以章节标题开头时置 true——该标题是身份路径的根、不入子路径。
 */
function extractRegistryIds(lines: string[], contextTitle = '', chunkRootIsFirstHeading = false): RegistryIdExtraction {
  const flat = new Set<string>();
  const scenarioRows = new Map<string, Set<string>>();
  const scenarioTableCount = new Map<string, number>();
  const content = lines.join('\n');
  for (const id of extractStructuredTestIds(content)) flat.add(id);
  const scan = authorityScan(lines);
  const headings = scanHeadings(lines, scan.masked, scan.text);
  const rootHeading = chunkRootIsFirstHeading && headings.length > 0 ? headings[0] : null;
  for (const h of headings) {
    const sm = ID_PATTERN_REGISTRY.scenarioHeading.exec(h.text);
    if (sm) flat.add(sm[1]);
    const firstToken = h.text.split(/\s+/)[0] ?? '';
    if (ID_PATTERN_REGISTRY.sectionNumber.test(firstToken)) flat.add(firstToken);
  }
  /** 表起始行的辖属子路径（外→内，排除章节根标题）与语义链（含根与 contextTitle，供场景语义判定）。 */
  const governing = (tableLine: number): { subPath: string[]; semanticChain: string[] } => {
    const nearestUp: DocHeading[] = [];
    let level = Number.POSITIVE_INFINITY;
    for (let k = headings.length - 1; k >= 0; k--) {
      const h = headings[k];
      if (h.line < tableLine && h.level < level) { nearestUp.push(h); level = h.level; }
    }
    const subPath = nearestUp.filter(h => h !== rootHeading).map(h => h.text).reverse();
    const semanticChain = [...nearestUp.map(h => h.text)];
    if (rootHeading) semanticChain.push(rootHeading.text);
    if (contextTitle) semanticChain.push(contextTitle);
    return { subPath, semanticChain };
  };
  let i = 0;
  while (i < lines.length) {
    if (scan.masked[i] || !scan.text[i].includes('|')) { i++; continue; }
    let j = i;
    while (j < lines.length && !scan.masked[j] && scan.text[j].includes('|')) j++;
    const block = scan.text.slice(i, j);
    if (block.length >= 3 && isTableDelimiterRow(block[1])) {
      const header = tableRowCells(block[0]);
      const delimiter = tableRowCells(block[1]);
      const schemaOk = header.length >= 2 && header.length === delimiter.length
        && ID_PATTERN_REGISTRY.scenarioTableHeader.test(header[0])
        && ID_PATTERN_REGISTRY.scenarioTableSecondHeader.test(header[1]);
      const { subPath, semanticChain } = governing(i);
      const contextOk = semanticChain.some(t => ID_PATTERN_REGISTRY.scenarioSectionTitle.test(t));
      if (schemaOk && contextOk) {
        // code-r5 F3：同一辖属子路径下的多张合格场景表按文档序取 0 基位次，位次入表身份键——
        // 同路径双表（正式表 + 历史快照副本）不再共享同一身份被 `Set` 坍缩。
        const subPathKey = subPath.join(' > ');
        const ordinal = scenarioTableCount.get(subPathKey) ?? 0;
        scenarioTableCount.set(subPathKey, ordinal + 1);
        const identity = makeTableIdentity(subPathKey, ordinal);
        for (const row of block.slice(2)) {
          const first = (tableRowCells(row)[0] ?? '').trim();
          if (ID_PATTERN_REGISTRY.scenarioRow.test(first)) {
            const set = scenarioRows.get(first) ?? new Set<string>();
            set.add(identity);
            scenarioRows.set(first, set);
          }
        }
      }
    }
    i = j;
  }
  return { flat, scenarioRows, scenarioTableCount };
}

/** 抽取结果的全部 ID（flat ∪ 场景行键集）。 */
function allIdsOf(x: RegistryIdExtraction): Set<string> {
  const out = new Set<string>(x.flat);
  for (const id of x.scenarioRows.keys()) out.add(id);
  return out;
}

type DeltaBlockOp = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'REMOVED-ITEMS';
interface DeltaBlock { op: DeltaBlockOp; anchor: string; markerLine: number; lines: string[] }

/** fence-aware 解析 delta 段标记块（围栏内示例标记不构成块边界——与 L4 同口径；记录 marker 源行号供源位置排序）。 */
function parseDeltaBlocks(deltaContent: string): DeltaBlock[] {
  const lines = deltaContent.split(/\r?\n/);
  const scan = authorityScan(lines);
  const blocks: DeltaBlock[] = [];
  let cur: DeltaBlock | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = scan.masked[i] ? '' : scan.text[i].trim();
    const m = trimmed.match(/^##\s+(REMOVED-ITEMS|ADDED|MODIFIED|REMOVED)\b\s*(?:[—-]\s*(.+))?$/);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { op: m[1] as DeltaBlockOp, anchor: stripInlineCode(m[2] ?? '').trim() || (m[2] ?? '').trim(), markerLine: i, lines: [] };
      continue;
    }
    if (cur) cur.lines.push(lines[i]);
  }
  if (cur) blocks.push(cur);
  return blocks;
}

/**
 * 章节锚解析（S37，fail-closed）：单段锚仅当标题在目标文档唯一时合法；标题路径锚以 ` > ` 连接
 * 父级到目标级（各父段须按序命中候选的祖先链，允许跳级）。0 / ≥2 命中一律不可解析——
 * 禁止取第一个命中、禁止合并同名章节、禁止按 delta 内容反猜。
 */
function resolveSectionAnchor(headings: DocHeading[], anchor: string): { status: 'ok' | 'not_found' | 'ambiguous'; hit?: DocHeading; candidates: DocHeading[] } {
  const segments = anchor.split(' > ').map(s => stripInlineCode(s).trim()).filter(s => s.length > 0);
  if (segments.length === 0) return { status: 'not_found', candidates: [] };
  const targetText = segments[segments.length - 1];
  const parents = segments.slice(0, -1);
  const candidates = headings.filter(h => stripInlineCode(h.text).trim() === targetText);
  const matched = candidates.filter(h => {
    // 祖先链：从该标题向前收集 level 严格递减的最近祖先序列（nearest → root）。
    const ancestors: DocHeading[] = [];
    let level = h.level;
    for (let i = headings.indexOf(h) - 1; i >= 0; i--) {
      if (headings[i].level < level) { ancestors.push(headings[i]); level = headings[i].level; }
    }
    // parents（左=更高层级）须按 从右到左 的顺序在祖先链 nearest→root 中依次命中（允许跳级）。
    let ai = 0;
    for (let pi = parents.length - 1; pi >= 0; pi--) {
      let found = false;
      while (ai < ancestors.length) {
        if (stripInlineCode(ancestors[ai].text).trim() === parents[pi]) { found = true; ai++; break; }
        ai++;
      }
      if (!found) return false;
    }
    return true;
  });
  if (matched.length === 1) return { status: 'ok', hit: matched[0], candidates };
  return { status: matched.length === 0 ? 'not_found' : 'ambiguous', candidates: matched.length > 0 ? matched : candidates };
}

/** REMOVED-ITEMS 点名行固定语法：`- <ID> — <删除原因>`（仅散文提及不构成点名）。 */
const REMOVED_ITEMS_LINE_RE = /^-\s+(\S+)\s+—\s*\S/;

export interface DeltaConservationViolation {
  code: 'delta_implicit_id_removal' | 'delta_removed_unknown_id' | 'delta_section_anchor_unresolvable';
  anchor: string;
  message: string;
  fix_hint: string;
}

/**
 * S37 守恒判据纯函数（事前点数，lint L8 与 merge 消费点共享的唯一实现）：
 * 逐触及章节（MODIFIED / REMOVED / REMOVED-ITEMS 锚定）按结构化归属对账——
 * 锚定章节既有结构化 ID − 同锚 MODIFIED 新内容结构 ID − 同锚 REMOVED-ITEMS 点名 −（整节 REMOVED 全节 ID）
 * 必须为空。目标主文档不存在（targetContent === null，新文件）时无守恒义务。
 * 纯函数、无 IO、不抛未捕获异常（畸形输入产出空块列表，由 L4 先行拦截）。
 */
export function evaluateDeltaConservation(deltaContent: string, targetContent: string | null): DeltaConservationViolation[] {
  if (targetContent === null) return [];
  const blocks = parseDeltaBlocks(deltaContent);
  const material = blocks.filter(b => b.op !== 'ADDED');
  if (material.length === 0) return [];
  const anchored = material.filter(b => b.anchor);

  const targetLines = targetContent.split(/\r?\n/);
  const targetScan = authorityScan(targetLines);
  const headings = scanHeadings(targetLines, targetScan.masked, targetScan.text);

  // code-r2 F5：每条 violation 携带其**真实声明源行**（空锚/锚不可解析/多写者 = 相关 marker 行、
  // unknown = REMOVED-ITEMS 点名行、配对缺陷 = 声明块 marker 行、missing = 造成最终态缺失的 MODIFIED
  // marker 行），最终按 (源行, 生成序) 全局稳定排序——同锚声明跨越其他锚交错时仍是源位置序
  //（§3.15「同 path 按源位置出现序」），不按锚首现分组折叠。
  const entries: { line: number; ord: number; v: DeltaConservationViolation }[] = [];
  let ord = 0;
  const emit = (line: number, v: DeltaConservationViolation) => { entries.push({ line, ord: ord++, v }); };

  // 空锚物质变更/声明块（code-r1 F2）：fail-closed，不得过滤。
  for (const b of material) {
    if (b.anchor) continue;
    emit(b.markerLine, {
      code: 'delta_section_anchor_unresolvable',
      anchor: '',
      message: `第 ${b.markerLine + 1} 行 \`## ${b.op}\` 段标记缺章节锚——无法定位目标章节（fail-closed，不做任何猜测）`,
      fix_hint: '为段标记补章节锚：`## ' + b.op + ' — <目标章节标题>`；标题重复时用标题路径锚（`父级标题 > 目标标题`）',
    });
  }

  const anchors: string[] = [];
  for (const b of anchored) if (!anchors.includes(b.anchor)) anchors.push(b.anchor);
  for (const anchor of anchors) {
    const sameAnchor = anchored.filter(b => b.anchor === anchor);
    const groupLine = Math.min(...sameAnchor.map(b => b.markerLine));
    const resolution = resolveSectionAnchor(headings, anchor);
    if (resolution.status !== 'ok') {
      const detail = resolution.status === 'not_found'
        ? '未命中任何章节（not-found）'
        : `命中 ${resolution.candidates.length} 处（ambiguous）：行 ${resolution.candidates.map(c => c.line + 1).join('、')}`;
      emit(groupLine, {
        code: 'delta_section_anchor_unresolvable',
        anchor,
        message: `章节锚「${anchor}」在目标主文档${detail}`,
        fix_hint: '改用标题路径锚唯一定位（`父级标题 > 目标标题`，以 ` > ` 连接）；禁止依赖工具取第一个命中或合并同名章节',
      });
      continue;
    }
    const hit = resolution.hit!;
    const hitIndex = headings.indexOf(hit);
    let end = targetLines.length;
    for (let i = hitIndex + 1; i < headings.length; i++) {
      if (headings[i].level <= hit.level) { end = headings[i].line; break; }
    }
    const contextTitle = anchor.split(' > ').pop() ?? anchor;
    const existing = extractRegistryIds(targetLines.slice(hit.line, end), contextTitle, true);
    const existingAll = allIdsOf(existing);

    // code-r1 F1：同章节单写者规则（fail-closed）——merge-executor 逐块「替换同名章节」，
    // 最终落盘只由最后一块决定；多个同锚 MODIFIED 的并集不是可落盘状态，前块内容会被静默覆盖。
    const modifiedBlocks = sameAnchor.filter(b => b.op === 'MODIFIED');
    if (modifiedBlocks.length > 1) {
      emit(modifiedBlocks[0].markerLine, {
        code: 'delta_implicit_id_removal',
        anchor,
        message: `章节「${anchor}」存在 ${modifiedBlocks.length} 个 MODIFIED 写者（行 ${modifiedBlocks.map(b => b.markerLine + 1).join('、')}）——逐块替换语义下仅最后一块落盘，前块携带/新增的条目会被静默覆盖；每章节仅允许一个 MODIFIED 写者`,
        fix_hint: '把同一章节的全部变更合并进单个 MODIFIED 块（携带该章节最终态的整节全量内容）',
      });
      continue; // 冲突未解决前不再做该锚的集合对账（对账基准不成立）
    }
    const retained: RegistryIdExtraction = {
      flat: new Set<string>(), scenarioRows: new Map<string, Set<string>>(), scenarioTableCount: new Map<string, number>(),
    };
    for (const b of modifiedBlocks) {
      const r = extractRegistryIds(b.lines, contextTitle);
      for (const id of r.flat) retained.flat.add(id);
      for (const [id, idents] of r.scenarioRows) {
        const set = retained.scenarioRows.get(id) ?? new Set<string>();
        for (const k of idents) set.add(k);
        retained.scenarioRows.set(id, set);
      }
    }
    const named = new Set<string>();
    const removedItemsBlocks = sameAnchor.filter(b => b.op === 'REMOVED-ITEMS');
    for (const b of removedItemsBlocks) {
      for (let li = 0; li < b.lines.length; li++) {
        const m = REMOVED_ITEMS_LINE_RE.exec(b.lines[li].trim());
        if (!m) continue;
        const id = m[1];
        named.add(id);
        if (!existingAll.has(id)) {
          emit(b.markerLine + 1 + li, {
            code: 'delta_removed_unknown_id',
            anchor,
            message: `REMOVED-ITEMS 点名的 ${id} 不属于锚定章节「${anchor}」的既有结构化 ID 集合（拼写不存在或点名了别的章节的 ID）`,
            fix_hint: '核对 ID 拼写，或把点名行移到该 ID 原所在章节的 REMOVED-ITEMS 块（点名须归属 ID 原章节）',
          });
        }
      }
    }
    const hasModified = modifiedBlocks.length > 0;
    const wholeRemoved = sameAnchor.some(b => b.op === 'REMOVED');
    if (removedItemsBlocks.length > 0 && !hasModified && !wholeRemoved) {
      emit(removedItemsBlocks[0].markerLine, {
        code: 'delta_implicit_id_removal',
        anchor,
        message: `REMOVED-ITEMS —「${anchor}」缺少同锚 MODIFIED 配对块——点名无物质载体（部分删除的物质变更由 MODIFIED 整节替换完成）`,
        fix_hint: '补充同锚 `## MODIFIED — <章节锚>` 块并携带删除后剩余的整节全量内容',
      });
    }
    if (!wholeRemoved && hasModified) {
      // code-r4 F3：守恒单位 = (ID, 表身份)。既有 ID 的**每个**既有结构形态逐个要求在新内容的
      // **同一形态/同一表身份**中保留，或被同锚 REMOVED-ITEMS 显式点名——任一交集不再放行：
      // 目标预先同时含正式条目与历史副本时，仅保留历史副本不能背书正式条目的删除。
      for (const id of existingAll) {
        if (named.has(id)) continue;
        const emitMissing = (formDetail: string) => emit(modifiedBlocks[0].markerLine, {
          code: 'delta_implicit_id_removal',
          anchor,
          message: `MODIFIED —「${anchor}」将隐式删除该章节既有 ID：${id}${formDetail}（未在新内容同一结构位置保留、未被同锚 REMOVED-ITEMS 点名、未随整节 REMOVED 删除）`,
          fix_hint: '把该 ID 的条目补回同锚 MODIFIED 块的**同一结构位置/表身份**（携带整节全量内容），或新增同锚 REMOVED-ITEMS 块逐行点名（`- <ID> — <删除原因>`）',
        });
        if (existing.flat.has(id) && !retained.flat.has(id)) {
          emitMissing('');
        }
        const identities = existing.scenarioRows.get(id);
        if (identities) {
          const kept = retained.scenarioRows.get(id) ?? new Set<string>();
          for (const ident of identities) {
            if (!kept.has(ident)) {
              emitMissing(`（场景表身份：${describeTableIdentity(ident, existing.scenarioTableCount)}）`);
            }
          }
        }
      }
    }
  }
  return entries.sort((a, b) => a.line !== b.line ? a.line - b.line : a.ord - b.ord).map(e => e.v);
}

/**
 * 提案级跨文件单写者检查辅助（code-r1 F1）：返回本 delta 文件中锚唯一解析成功的 MODIFIED 块
 * 的目标章节键（目标文档内的章节起始行号）。lint 与 merge 用它对同一目标文件跨 delta 文件
 * 检出「同一章节多写者」——与 evaluateDeltaConservation 共享同一解析/锚定实现，严禁第二份判据。
 */
export function resolveModifiedSectionKeys(deltaContent: string, targetContent: string | null): number[] {
  if (targetContent === null) return [];
  const blocks = parseDeltaBlocks(deltaContent).filter(b => b.op === 'MODIFIED' && b.anchor);
  if (blocks.length === 0) return [];
  const targetLines = targetContent.split(/\r?\n/);
  const targetScan = authorityScan(targetLines);
  const headings = scanHeadings(targetLines, targetScan.masked, targetScan.text);
  const keys: number[] = [];
  for (const b of blocks) {
    const r = resolveSectionAnchor(headings, b.anchor);
    if (r.status === 'ok') keys.push(r.hit!.line);
  }
  return keys;
}

/** delta 相对路径（`deltas/<category>/<rest>`）→ 项目根相对目标路径；无法映射（unknown 类别 / 根级直放）→ null。 */
export function deltaTargetProjectPath(relativePath: string): string | null {
  const segs = relativePath.split('/');
  if (segs.length < 3 || segs[0] !== 'deltas') return null;
  const mapped = (DELTA_TO_RESOURCE as Record<string, string>)[segs[1]];
  if (!mapped) return null;
  return `${mapped}/${segs.slice(2).join('/')}`;
}

// ── 前置重构⑤：共享 proposal-context resolver（模块归属单一事实源）──

/**
 * 自 merge.ts 私有 readProposalModule 提取：读 proposal.md 头部 `> module: <id>`（持久事实源）。
 * F11：只认**围栏外**的头行——围栏内示例不构成权威 module 声明。
 */
export function readProposalModuleHeader(proposalDir: string): string | undefined {
  const p = join(proposalDir, 'proposal.md');
  if (!existsSync(p)) return undefined;
  try {
    const lines = readFileSync(p, 'utf-8').split(/\r?\n/);
    const scan = authorityScan(lines);
    for (let i = 0; i < lines.length; i++) {
      if (scan.masked[i]) continue; // r2 F11：围栏/缩进代码/HTML 注释内的示例头不构成权威 module 声明
      const m = /^>\s*module:\s*([a-z][a-z0-9-]*)\s*$/i.exec(scan.text[i].trim());
      if (m) return m[1];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function readGuardFile(root: string): { activeChange?: string; module?: string } | null {
  const guardPath = join(root, 'logos', '.openlogos-guard');
  if (!existsSync(guardPath)) return null;
  try {
    const g = JSON.parse(readFileSync(guardPath, 'utf-8'));
    return (g && typeof g === 'object') ? g : null;
  } catch { return null; }
}

export type ProposalModuleResolution =
  | { ok: true; moduleId: string; productType?: string; isGui: boolean }
  | { ok: false; detail: string };

/**
 * 模块归属解析（module-aware 判据的唯一权威，含 L7 与 merge 的 UI 门——F1）：
 * ① proposal.md 头 `> module:` 优先（持久事实源）；② 头缺失且 guard.activeChange==slug 才回退 guard.module；
 * ③ 冲突以头为准；④ 无法解析或模块不在 logos-project.yaml → fail-closed（module_unresolved，不得静默按非 GUI 跳过）。
 */
export function resolveProposalModuleContext(root: string, proposalDir: string, slug: string): ProposalModuleResolution {
  const header = readProposalModuleHeader(proposalDir);
  let moduleId = header;
  if (!moduleId) {
    const guard = readGuardFile(root);
    if (guard && guard.activeChange === slug && typeof guard.module === 'string' && guard.module) {
      moduleId = guard.module;
    }
  }
  if (!moduleId) {
    return { ok: false, detail: '无法解析提案所属模块（proposal.md 缺 "> module:" 头且 guard 不指向该提案）' };
  }
  const modules = readProjectYaml(root).data?.modules ?? [];
  const mod = modules.find(m => m.id === moduleId);
  if (!mod) {
    return { ok: false, detail: `提案声明模块 '${moduleId}' 不存在于 logos-project.yaml` };
  }
  return { ok: true, moduleId, productType: mod.product_type, isGui: isGuiProductType(mod.product_type) };
}

// ── 打包调用层：L1–L7 聚合（纯 evaluator，只读）──

export type ChangeLintOpErrorCode =
  | 'not_initialized'
  | 'no_active_proposal'
  | 'slug_not_found'
  | 'slug_invalid'
  | 'module_unresolved'
  | 'artifact_unreadable';

export type ChangeLintRunResult =
  | { ok: true; slug: string; violations: ChangeLintViolation[]; checks: { id: number; label: string; violations: number }[] }
  | { ok: false; errorCode: ChangeLintOpErrorCode; message: string };

/** 严格 slug 词法（spec §2.30；r2 F18）：不匹配者仅当历史目录实际存在时走只读兼容，否则 slug_invalid。 */
export const SLUG_STRICT_RE = /^[a-z0-9][a-z0-9-]*$/;

/** slug 词法硬拒绝：空值、路径分隔符、`.`、`..`、绝对路径（F8：显式 flag 缺值同拒）。 */
export function isDangerousSlug(slug: string): boolean {
  if (!slug) return true;
  if (slug === '.' || slug === '..') return true;
  if (/[\\/]/.test(slug)) return true;
  if (slug.startsWith('/') || /^[A-Za-z]:/.test(slug)) return true;
  return false;
}

interface CheckAcc {
  violations: ChangeLintViolation[];
  seq: Map<string, number>;
  order: Map<ChangeLintViolation, { check: number; seq: number }>;
}

function pushViolation(acc: CheckAcc, check: number, v: ChangeLintViolation): void {
  const flowReason = FLOW_REASON_MAP[v.code];
  const out: ChangeLintViolation = flowReason ? { ...v, flow_reason: flowReason } : v;
  const key = `${check}|${out.path}`;
  const seq = acc.seq.get(key) ?? 0;
  acc.seq.set(key, seq + 1);
  acc.order.set(out, { check, seq });
  acc.violations.push(out);
}

/**
 * 对提案目录运行 L1–L7 全部检查并按全序稳定排序返回。
 * 读取顺序（操作错误即终止红线由调用方 change-lint 命令实现）：
 * proposal.md（含 module resolver）→ tasks.md → deltas/**（含全量可读性探测——F7）。
 */
export function runChangeLint(root: string, proposalDir: string, slug: string): ChangeLintRunResult {
  let proposalContent = '';
  let tasksContent = '';
  const proposalPath = join(proposalDir, 'proposal.md');
  const tasksPath = join(proposalDir, 'tasks.md');
  try {
    if (existsSync(proposalPath)) proposalContent = readFileSync(proposalPath, 'utf-8');
  } catch {
    return { ok: false, errorCode: 'artifact_unreadable', message: `无法读取 logos/changes/${slug}/proposal.md` };
  }

  // 模块归属解析（module-aware 判据的唯一权威；proposal.md 步内、tasks.md 前）
  const moduleCtx = resolveProposalModuleContext(root, proposalDir, slug);
  if (!moduleCtx.ok) {
    return { ok: false, errorCode: 'module_unresolved', message: moduleCtx.detail };
  }

  try {
    if (existsSync(tasksPath)) tasksContent = readFileSync(tasksPath, 'utf-8');
  } catch {
    return { ok: false, errorCode: 'artifact_unreadable', message: `无法读取 logos/changes/${slug}/tasks.md` };
  }

  // deltas/**：共享分类器一次遍历（F2）；枚举/元数据 IO 错误与任一 mergeable 条目不可读 → artifact_unreadable（F7）
  const deltaEntries = classifyProposalDeltas(proposalDir);
  const ioBroken = deltaEntries.find(e => e.ioError);
  if (ioBroken) {
    return { ok: false, errorCode: 'artifact_unreadable', message: `logos/changes/${slug}/${ioBroken.relativePath}：${ioBroken.ioError}` };
  }
  // r2 F3 + r5 F7：内容探测范围 = 分类器标记的 contentProbeEligible 条目（本地普通文件 / 边界内
  // 目标为普通文件的 symlink），与 mergeDisposition/lintValidity 正交——reference/隐藏/unknown 等
  // 被 L6 忽略或判非法的**本地**文件同样探测（「delta 任一不可读 → artifact_unreadable」是操作级
  // 红线）；逃逸/断链 symlink、目录与非常规文件恒不解引用（不读提案边界外目标）。按分类器输出的
  // 稳定路径序探测，首个失败即终止（不再读取后序产物）。
  const deltaContents = new Map<string, string>();
  for (const entry of deltaEntries) {
    if (!entry.contentProbeEligible) continue;
    try {
      deltaContents.set(entry.relativePath, readFileSync(join(proposalDir, entry.relativePath), 'utf-8'));
    } catch {
      return { ok: false, errorCode: 'artifact_unreadable', message: `无法读取 logos/changes/${slug}/${entry.relativePath}` };
    }
  }

  const relTasks = `logos/changes/${slug}/tasks.md`;
  const relProposal = `logos/changes/${slug}/proposal.md`;
  const acc: CheckAcc = { violations: [], seq: new Map(), order: new Map() };

  const sections = parseTaskSections(tasksContent);
  const codeRequired = isCodeRequiredForProposal(proposalDir, tasksContent, sections);

  // L1：tasks.md 结构可解析（≥1 个 `## [tag]` 标题）
  if (sections === null) {
    pushViolation(acc, 1, {
      code: 'tasks_sections_unparsable',
      path: relTasks,
      message: 'tasks.md 无任何 `## [tag]` section 标题，结构不可解析',
      fix_hint: '按 tasks 结构化格式补 `## [delta]` / `## [code]` / `## [deploy]` section 标题（至少一个）',
    });
  }

  // L2：需代码的提案有 `## [code]` 标题（空段占位合法）
  if (codeRequired && sections !== null && !Object.prototype.hasOwnProperty.call(sections, 'code')) {
    pushViolation(acc, 2, {
      code: 'tasks_code_header_missing',
      path: relTasks,
      message: '需代码的提案缺少 ## [code] 标题',
      fix_hint: '在 tasks.md 保留空 `## [code] 代码实现` 标题（切片由 merge 后 slice-planner 填写）',
    });
  }

  // L3：分阶段测试证据模型（仅 code_required 提案）
  if (codeRequired) {
    const evidence = evaluateTestIdEvidence(proposalDir, tasksContent);
    for (const entry of evidence.reuse.entries) {
      if (entry.problem === null) continue;
      const problemLabel = entry.problem === 'syntax' ? '语法非法（每行须为 `- <ID> — <一句话用途>` 且 ID 满足闭合文法）'
        : entry.problem === 'duplicate' ? '重复的复用 ID'
          : 'ID 不存在于已合并 logos/resources/test/ 规格的结构化 ID 列';
      pushViolation(acc, 3, {
        code: 'code_change_requires_real_test_ids',
        path: relProposal,
        message: `复用测试 ID 声明第 ${evidence.reuse.entries.indexOf(entry) + 1} 项${problemLabel}：${entry.line}`,
        fix_hint: '修正该行为 `- <已存在的具体 ID> — <一句话用途>`，或删除该行；ID 须精确存在于已合并测试规格表格首列',
      });
    }
    if (!evidence.evidenceOk) {
      pushViolation(acc, 3, {
        code: 'code_change_requires_real_test_ids',
        path: relTasks,
        message: `需代码的提案在当前证据等级（${evidence.stage}）下无可采信的 UT/ST/SMOKE ID`,
        fix_hint: '在 tasks.md 的 [delta] 规划测试规格 delta（目标含 `deltas/test/`），或在 proposal.md 的「## 复用测试 ID」小节按固定语法列出已存在的具体 ID（如 UT-S09-02）',
      });
    }
  }

  // L4 / L6：仅对已存在 delta 文件
  for (const entry of deltaEntries) {
    const relPath = `logos/changes/${slug}/${entry.relativePath}`;
    if (entry.lintValidity === 'invalid') {
      pushViolation(acc, 6, {
        code: 'delta_path_invalid',
        path: relPath,
        message: `delta 路径非法：${entry.invalidReason ?? '未知原因'}`,
        fix_hint: '把 delta 移到合法类别目录（prd/api/database/scenario/test/spec/skills），并确保不经 symlink 逃逸提案目录',
      });
    }
    const isPrototypeAsset = entry.relativePath.includes('/2-product-design/2-page-design/') && entry.relativePath.endsWith('.html');
    if (entry.mergeDisposition === 'mergeable' && entry.lintValidity === 'valid' && entry.relativePath.endsWith('.md') && !isPrototypeAsset) {
      const v = validateMarkdownDelta(deltaContents.get(entry.relativePath) ?? '');
      if (v.missingSectionMarker) {
        pushViolation(acc, 4, {
          code: 'delta_missing_section_marker',
          path: relPath,
          message: '`.md` delta 缺少围栏外的 ADDED/MODIFIED/REMOVED 段标记（围栏内示例不算权威标记）',
          fix_hint: '为每个变更章节添加 `## ADDED — <标题>` / `## MODIFIED — <标题>` / `## REMOVED — <标题>` 标记',
        });
      }
      if (v.templateSkeleton) {
        pushViolation(acc, 4, {
          code: 'delta_template_skeleton',
          path: relPath,
          message: `delta 残留未替换的模板占位字面量：${v.skeletonHits[0]}${v.skeletonHits.length > 1 ? ` 等 ${v.skeletonHits.length} 处` : ''}`,
          fix_hint: '把模板占位字面量（如 `[新增章节标题]`、`[新增的完整内容]`）替换为真实内容——只要残留任一独占占位行即被 lint 与 merge 拒绝',
        });
      }
    }
  }

  // L5：部署决策一致性
  const deployment = resolveProposalDeploymentDecision(proposalDir);
  if (deployment.deployment_decision_conflict) {
    pushViolation(acc, 5, {
      code: 'deployment_decision_conflict',
      path: relProposal,
      message: deployment.deployment_decision_conflict_reason ?? 'proposal 部署声明与 tasks.md [deploy] section 冲突',
      fix_hint: '需要部署 → tasks.md 增加 [deploy] section；无需部署 → 删除 [deploy] section 或把 proposal.md 部署影响改为「否」',
    });
  }

  // L7：仅 GUI 项目（resolver 判定 product_type ∈ GUI）
  const guiActive = moduleCtx.isGui;
  if (guiActive) {
    const structure = analyzeUiDeclarationStructure(proposalContent);
    if (!structure.ok) {
      pushViolation(acc, 7, {
        code: structure.problem,
        path: relProposal,
        message: structure.detail,
        fix_hint: '在 proposal.md 写入「## UI/UX 变更声明」段（fenced YAML：ui_impact 布尔、design_system_mode、pages 清单）',
      });
    } else if (structure.ui_impact) {
      const outcome = evaluateUiPrototype(proposalDir);
      if (outcome.code !== 0) {
        const code = (CHANGE_LINT_VIOLATION_CODES as readonly string[]).includes(outcome.errorCode ?? '')
          ? outcome.errorCode as ChangeLintViolationCode
          : 'design_system_mode_invalid';
        pushViolation(acc, 7, {
          code,
          path: relProposal,
          message: outcome.reason,
          fix_hint: '按 ui-ux-first 可交付要求补齐：声明清单 == 产出文件（逐页非空）、design_system_mode 分档令牌规则',
        });
      }
    }
  }

  // L8：条目守恒（S37）——仅 mergeable+valid 的 `.md` 规格 delta（原型资产天然被 .md 过滤排除）；
  // 目标主文档不存在（全新文档）跳过；目标存在但不可读 → artifact_unreadable（操作级红线）。
  const sectionWriters = new Map<string, string[]>(); // `${targetRel}#${sectionLine}` → 写者 delta relPath 列表（code-r1 F1 跨文件单写者）
  for (const entry of deltaEntries) {
    if (!(entry.mergeDisposition === 'mergeable' && entry.lintValidity === 'valid' && entry.relativePath.endsWith('.md'))) continue;
    const targetRel = deltaTargetProjectPath(entry.relativePath);
    if (!targetRel) continue;
    const targetAbs = join(root, targetRel);
    if (!existsSync(targetAbs)) continue; // 新文件无守恒义务
    let targetContent: string;
    try {
      targetContent = readFileSync(targetAbs, 'utf-8');
    } catch {
      return { ok: false, errorCode: 'artifact_unreadable', message: `无法读取守恒目标主文档 ${targetRel}` };
    }
    const relPath = `logos/changes/${slug}/${entry.relativePath}`;
    const content = deltaContents.get(entry.relativePath) ?? '';
    for (const v of evaluateDeltaConservation(content, targetContent)) {
      pushViolation(acc, 8, { code: v.code, path: relPath, message: v.message, fix_hint: v.fix_hint });
    }
    for (const key of resolveModifiedSectionKeys(content, targetContent)) {
      const k = `${targetRel}#${key}`;
      sectionWriters.set(k, [...(sectionWriters.get(k) ?? []), relPath]);
    }
  }
  // code-r1 F1：跨 delta 文件的同一目标章节多写者 fail-closed——逐文件求值均相对合并前主文档，
  // 顺序应用时后一文件的整节替换会静默覆盖前一文件的写入；对每个涉事文件各报一条。
  for (const [k, writers] of sectionWriters) {
    if (writers.length < 2) continue;
    const [targetRel] = k.split('#');
    for (const relPath of writers) {
      pushViolation(acc, 8, {
        code: 'delta_implicit_id_removal',
        path: relPath,
        message: `目标 ${targetRel} 的同一章节被 ${writers.length} 个 delta 文件的 MODIFIED 写入（${writers.join('、')}）——顺序应用下后写覆盖前写；每章节仅允许一个 MODIFIED 写者`,
        fix_hint: '把该章节的全部变更合并进单个 delta 文件的单个 MODIFIED 块（携带最终态整节全量内容）',
      });
    }
  }

  // 全序稳定排序：①检查项 L1→L8；②path 字典序；③源位置出现序；④code；⑤message
  const sorted = [...acc.violations].sort((a, b) => {
    const oa = acc.order.get(a)!;
    const ob = acc.order.get(b)!;
    if (oa.check !== ob.check) return oa.check - ob.check;
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (oa.seq !== ob.seq) return oa.seq - ob.seq;
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });

  const mergeableCount = deltaEntries.filter(e => e.mergeDisposition === 'mergeable').length;
  const invalidCount = deltaEntries.filter(e => e.lintValidity === 'invalid').length;
  const mdDeltaCount = deltaEntries.filter(e => e.mergeDisposition === 'mergeable' && e.relativePath.endsWith('.md')).length;
  const countFor = (check: number) => sorted.filter(v => acc.order.get(v)!.check === check).length;

  const checks: { id: number; label: string; violations: number }[] = [
    { id: 1, label: 'tasks.md 结构可解析', violations: countFor(1) },
    { id: 2, label: '[code] 标题在场（空段占位合法）', violations: countFor(2) },
    { id: 3, label: '测试证据在场（分阶段证据模型）', violations: countFor(3) },
    { id: 4, label: `delta 段标记与脱模板（${mdDeltaCount} 个 .md delta）`, violations: countFor(4) },
    { id: 5, label: '部署决策一致', violations: countFor(5) },
    { id: 6, label: `delta 路径合法（${mergeableCount} mergeable / ${invalidCount} invalid）`, violations: countFor(6) },
    ...(guiActive ? [{ id: 7, label: 'UI 声明结构合法', violations: countFor(7) }] : []),
    { id: 8, label: '条目守恒（ID 隐式删除拦截）', violations: countFor(8) },
  ];

  return { ok: true, slug, violations: sorted, checks };
}
