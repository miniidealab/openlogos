import { authorityScan, scanHeadingRecords, stripInlineCode } from './markdown-scan.js';

/**
 * Delta 物质控制段的 op 集合。
 *
 * `RENAMED`（第五个 op）是**唯一**能改写标题行、也是唯一能作用于文档级 H1 的 op：
 * `ADDED` 顶层块恒发 level 2、`MODIFIED` 的标题行取自被锚定章节的原标题、`REMOVED` 是整节删除。
 * 规范：`spec/change-management.md`「Delta `RENAMED` op：章节标题更名」；架构 §五十。
 */
export type DeltaBlockOp = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'REMOVED-ITEMS' | 'RENAMED';

export interface DeltaBlock {
  op: DeltaBlockOp;
  /** 规范化锚（`stripInlineCode` 后）——**只用于定位**：锚匹配、序数解析、多写者判重。 */
  anchor: string;
  /**
   * 原始锚文本（逐字保留行内代码与反引号）——**只用于产出**：`ADDED` 发射的新章节标题。
   *
   * 两者分离是架构 §五十一「规范化形式不得充当产出内容」的落地：`stripInlineCode` 是**整段删除**
   * 行内代码而非脱反引号，把它的结果拿去当标题会让 `` `x` `` 段落在落盘时消失（已静默发生两次）。
   */
  rawAnchor: string;
  markerLine: number;
  lines: string[];
}

export interface ResolvedSectionAnchor {
  line: number;
  endLine: number;
  level: number;
  /** **规范化**标题文本（`stripInlineCode` 后）——锚定位视图，匹配与 path 身份均取它。 */
  text: string;
  /**
   * **原始**标题文本（去 `#` 与首尾空白，行内代码逐字保留）——无损身份视图。
   *
   * 与 `text` 来自**同一次**扫描（`scanHeadingRecords`），行号与层级一一对应。需要无损身份的
   * 消费方（如 L8 条目守恒的场景表辖属路径）取它，**不得**改取 `text`：`stripInlineCode` 整段
   * 删除行内代码，辖属标题会坍缩、守恒门被绕过（C05）。
   */
  rawText: string;
  path: string[];
  start: number;
  end: number;
  headingEnd: number;
  /** 标题行**原始字节**（含 `#` 前缀）——只供标题保真检查，不与规范化管道合流。 */
  rawHeading: string;
}

export interface SectionAnchorResolution {
  status: 'ok' | 'not_found' | 'ambiguous';
  hit?: ResolvedSectionAnchor;
  candidates: ResolvedSectionAnchor[];
}

export interface MaterialOutcomeVerification {
  ok: boolean;
  identities: Array<{
    op: Exclude<DeltaBlockOp, 'REMOVED-ITEMS'>;
    anchor: string;
    before: ResolvedSectionAnchor | null;
    final: ResolvedSectionAnchor | null;
  }>;
  error?: string;
}

interface LineRecord { raw: string; start: number; contentEnd: number; end: number }

function splitLines(source: string): LineRecord[] {
  const records: LineRecord[] = [];
  let start = 0;
  for (let i = 0; i <= source.length; i++) {
    if (i !== source.length && source[i] !== '\n') continue;
    const contentEnd = i > start && source[i - 1] === '\r' ? i - 1 : i;
    records.push({ raw: source.slice(start, contentEnd), start, contentEnd, end: i < source.length ? i + 1 : i });
    start = i + 1;
  }
  return records;
}

/** 围栏感知的 Delta 控制块解析器；声明块保留在结果中，但不构成物质写操作。 */
export function parseDeltaBlocks(deltaContent: string): DeltaBlock[] {
  const lines = deltaContent.split(/\r?\n/);
  const scan = authorityScan(lines);
  const blocks: DeltaBlock[] = [];
  let current: DeltaBlock | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = scan.masked[i] ? '' : scan.text[i].trim();
    // 注意顺序：REMOVED-ITEMS 必须先于 REMOVED 判别（\b 在 `REMOVED-` 处成立，否则被误吞为 REMOVED）。
    const marker = /^##\s+(REMOVED-ITEMS|ADDED|MODIFIED|REMOVED|RENAMED)\b\s*(?:[—-]\s*(.+))?$/.exec(trimmed);
    if (marker) {
      if (current) blocks.push(current);
      const rawAnchor = marker[2] ?? '';
      current = {
        op: marker[1] as DeltaBlockOp,
        anchor: stripInlineCode(rawAnchor).trim() || rawAnchor.trim(),
        rawAnchor: rawAnchor.trim(),
        markerLine: i,
        lines: [],
      };
      continue;
    }
    if (current) current.lines.push(lines[i]);
  }
  if (current) blocks.push(current);
  return blocks;
}

/**
 * 一次 fence-aware 扫描产生真实 ATX heading tree 与确定性字符范围。
 *
 * 标题识别与两个文本视图取自共享单点 `scanHeadingRecords`——本文件**不自建第二份扫描**。
 * 本结构的 `text` 是锚定位视图（规范化），`rawText` 是无损身份视图，`rawHeading` 是保真视图。
 */
export function parseMarkdownHeadings(content: string): ResolvedSectionAnchor[] {
  const records = splitLines(content);
  const lines = records.map(record => record.raw);
  const scan = authorityScan(lines);
  const headings: ResolvedSectionAnchor[] = [];
  const stack: ResolvedSectionAnchor[] = [];
  for (const record of scanHeadingRecords(lines, scan.masked, scan.text)) {
    const i = record.line;
    const level = record.level;
    const text = record.normalizedText;
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    const heading: ResolvedSectionAnchor = {
      line: i,
      endLine: records.length,
      level,
      text,
      rawText: record.rawText,
      path: [...stack.map(item => item.text), text],
      start: records[i].start,
      end: content.length,
      headingEnd: records[i].contentEnd,
      rawHeading: content.slice(records[i].start, records[i].contentEnd),
    };
    headings.push(heading);
    stack.push(heading);
  }
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i];
    const next = headings.slice(i + 1).find(item => item.level <= current.level);
    if (next) {
      current.end = next.start;
      current.endLine = next.line;
    }
  }
  return headings;
}

/** 锚是否携带序数后缀（§2.72.1）；携带时其后置条件按候选计数判定而非「不再存在」。 */
export function anchorHasOrdinal(anchor: string): boolean {
  const m = /^(.*?)\s*\[(\d+)\]$/.exec(anchor.trim());
  return m !== null && Number(m[2]) >= 1;
}

/** 去掉序数后缀后的裸锚，用于统计同名候选数。 */
function bareAnchor(anchor: string): string {
  const m = /^(.*?)\s*\[(\d+)\]$/.exec(anchor.trim());
  return m !== null && Number(m[2]) >= 1 ? m[1] : anchor;
}

/**
 * 章节锚解析：标题路径按真实祖先链匹配；0/多命中均 fail-closed。
 *
 * 功能规格 §2.72：支持**可选**序数后缀 `[n]`，在同名候选中按文档序选第 n 处（1 基）。
 * 不带后缀时行为逐字节不变——重复标题此前使章节永久不可寻址，序数是其唯一出路。
 */
export function resolveSectionAnchor(
  headings: readonly ResolvedSectionAnchor[], anchor: string,
): SectionAnchorResolution {
  // 序数只允许出现在锚末尾，且必须是 1 基正整数；其余形态一律按普通标题文本处理。
  const ordinalMatch = /^(.*?)\s*\[(\d+)\]$/.exec(anchor.trim());
  const ordinal = ordinalMatch && Number(ordinalMatch[2]) >= 1 ? Number(ordinalMatch[2]) : null;
  const bare = ordinal === null ? anchor : ordinalMatch![1];

  const segments = bare.split(' > ').map(segment => stripInlineCode(segment).trim()).filter(Boolean);
  if (segments.length === 0) return { status: 'not_found', candidates: [] };
  const target = segments[segments.length - 1];
  const candidates = headings.filter(heading => heading.text === target);
  const matched = candidates.filter(heading => {
    const ancestors = heading.path.slice(0, -1);
    let cursor = ancestors.length - 1;
    for (let i = segments.length - 2; i >= 0; i--) {
      while (cursor >= 0 && ancestors[cursor] !== segments[i]) cursor--;
      if (cursor < 0) return false;
      cursor--;
    }
    return true;
  });

  // 序数在**路径锚过滤之后**的同名候选集合内计数，与文档中其它标题无关。
  if (ordinal !== null) {
    if (ordinal > matched.length) {
      return { status: 'not_found', candidates: matched.length > 0 ? matched : candidates };
    }
    return { status: 'ok', hit: matched[ordinal - 1], candidates: matched };
  }

  if (matched.length === 1) return { status: 'ok', hit: matched[0], candidates: matched };
  return {
    status: matched.length === 0 ? 'not_found' : 'ambiguous',
    candidates: matched.length > 0 ? matched : candidates,
  };
}

function bodyOf(block: DeltaBlock): string {
  const lines = [...block.lines];
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

/**
 * Delta 块内标题既可能已经按最终目标写成相对子标题，也可能沿用控制块
 * 下的 H3 起始层级。当最浅正文标题不深于真实目标时，整体下沉到目标
 * 下一层；已经更深的标题保持原级别。围栏内伪标题不参与重定位。
 */
function rebaseDeltaBodyHeadings(body: string, targetLevel: number): string {
  const headings = parseMarkdownHeadings(body).sort((left, right) => right.start - left.start);
  if (headings.length === 0) return body;
  const shallowest = Math.min(...headings.map(heading => heading.level));
  const shift = Math.max(0, targetLevel + 1 - shallowest);
  if (shift === 0) return body;
  let output = body;
  for (const heading of headings) {
    const level = heading.level + shift;
    if (level < 1 || level > 6) {
      throw new Error(`Delta 正文标题重定位超出 H1-H6：${heading.text}`);
    }
    const replacement = heading.rawHeading.replace(/^#{1,6}/, '#'.repeat(level));
    output = `${output.slice(0, heading.start)}${replacement}${output.slice(heading.headingEnd)}`;
  }
  return output;
}

function sameIdentity(a: ResolvedSectionAnchor, b: ResolvedSectionAnchor): boolean {
  return a.level === b.level && a.text === b.text && a.path.join('\u0000') === b.path.join('\u0000');
}

/**
 * 把标题段按更名映射改写——`RENAMED` 会改变**其子孙节的 path**，复验必须把这一改名
 * 折算进身份比较，否则「祖先被更名」会让同 delta 内其它块的身份守恒判定假性失败。
 */
function mapSegments(segments: string[], renames: Map<string, string>): string[] {
  return segments.map(seg => renames.get(seg) ?? seg);
}

/**
 * 映射锚文本（保留序数后缀 `[n]`，它不是标题的一部分）——**锚折算的唯一实现**。
 *
 * 导出供 `change-lint` 复用：此前该文件因本函数未导出而抄了一份逐字节相同的 `foldRenamedAnchor`，
 * 属「同一判据的第二份副本」。折算语义（按 ` > ` 分段、`[n]` 后缀不参与折算并原样保留）不变。
 */
export function mapAnchorText(anchor: string, renames: Map<string, string>): string {
  return anchor.split(' > ').map(part => {
    const ordinal = /^(.*?)(\s*\[\d+\])$/.exec(part);
    const base = (ordinal ? ordinal[1] : part).trim();
    return `${renames.get(base) ?? base}${ordinal ? ordinal[2] : ''}`;
  }).join(' > ');
}

/** 身份守恒比较：先把 before 侧按本 delta 的更名映射折算，再与 final 侧比对。 */
function sameIdentityAfterRenames(
  before: ResolvedSectionAnchor,
  final: ResolvedSectionAnchor,
  renames: Map<string, string>,
): boolean {
  if (renames.size === 0) return sameIdentity(before, final);
  return before.level === final.level
    && (renames.get(before.text) ?? before.text) === final.text
    && mapSegments(before.path, renames).join('\u0000') === final.path.join('\u0000');
}

/** Agent slot 物质结果验证器；只读 before/final，不重写 Agent 字节。 */
/**
 * 解析 `RENAMED` 块正文给出的新标题文本（规范：正文**恰好一行**，即新标题，不含 `#` 前缀）。
 *
 * 多行、空正文、或以 `#` 开头一律拒绝——RENAMED 只做一件事，块正文承载的信息量必须与之相称；
 * 放宽任何一条都会让它变成「能顺手改正文/改层级」的第二个 MODIFIED。
 */
export function parseRenamedTitle(block: DeltaBlock): { ok: true; title: string } | { ok: false; error: string } {
  const lines = block.lines.map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return { ok: false, error: `RENAMED 块正文为空：${block.anchor}（正文必须恰为一行新标题文本）` };
  if (lines.length > 1) {
    return { ok: false, error: `RENAMED 块正文有 ${lines.length} 行：${block.anchor}（正文必须恰为一行新标题文本，RENAMED 不携带正文）` };
  }
  const title = lines[0];
  if (title.startsWith('#')) {
    return { ok: false, error: `RENAMED 新标题不得带 # 前缀：${block.anchor}（层级沿用原标题，不由块正文指定）` };
  }
  return { ok: true, title };
}

/**
 * 本 delta 内 `RENAMED` 造成的双向标题映射——**唯一实现**，lint 与 merge 共用。
 *
 * - `renames`：旧标题 → 新标题（子孙节 path 折算用）。
 * - `reverse`：新标题 → 旧标题（合并**前**文档里解析新标题锚时折回重试用）。
 *
 * **非法 RENAMED 块一律 fail-closed 返回 `error`（C04）**，两侧处置统一为拒绝。此前 lint 侧
 * `continue` 跳过、merge 侧 `return false`——同一形态两个结论，等于 lint 放行一个 merge 必拒的
 * 形态，与「预检必先报」的承诺自相矛盾。该形态改前改后**都不可合并**，本次只把报错从合成阶段
 * 提前到预检阶段，可合并集合不变。
 *
 * 合法性判据复用既有 `parseRenamedTitle` 单点（正文恰一行、非空、不以 `#` 开头），不新建第三份。
 */
export function buildRenameMaps(
  blocks: readonly DeltaBlock[],
): { renames: Map<string, string>; reverse: Map<string, string>; error?: string } {
  const renames = new Map<string, string>();
  const reverse = new Map<string, string>();
  for (const block of blocks) {
    if (block.op !== 'RENAMED') continue;
    // 缺锚的 RENAMED 同样 fail-closed（code-r1 F1）：此前这里 `continue` 静默跳过，而守恒侧又
    // 把全部 RENAMED 块滤掉，于是「`## RENAMED` 无锚」成为一个绕过全部校验的准入入口。
    // 消息与 merge 主循环的既有措辞逐字一致，两侧结论与文案都不分叉。
    if (!block.anchor) return { renames, reverse, error: `${block.op} 段缺少章节锚` };
    const parsed = parseRenamedTitle(block);
    // 非法块不进映射表**且**整体拒绝：否则一个畸形 RENAMED 会为后续锚提供不该存在的折算，
    // 把该报的「锚不可解析」悄悄放行。
    if (!parsed.ok) return { renames, reverse, error: parsed.error };
    const oldTitle = block.anchor.split(' > ').pop()!.replace(/\s*\[\d+\]$/, '').trim();
    renames.set(oldTitle, parsed.title);
    reverse.set(parsed.title, oldTitle);
  }
  return { renames, reverse };
}

export function verifyAgentMaterialOutcome(
  deltaContent: string,
  beforeContent: string,
  finalContent: string,
): MaterialOutcomeVerification {
  const blocks = parseDeltaBlocks(deltaContent).filter(
    (block): block is DeltaBlock & { op: Exclude<DeltaBlockOp, 'REMOVED-ITEMS'> } => block.op !== 'REMOVED-ITEMS',
  );
  if (blocks.length === 0) return { ok: false, identities: [], error: 'Markdown Delta 缺少物质控制段' };
  const writers = new Set<string>();
  const beforeHeadings = parseMarkdownHeadings(beforeContent);
  const finalHeadings = parseMarkdownHeadings(finalContent);
  const identities: MaterialOutcomeVerification['identities'] = [];
  // 本 delta 的更名映射（旧标题 → 新标题）。RENAMED 改的是标题行，其子孙节的 path 随之变化，
  // 故所有块的 before/final 身份比较都必须先折算这张表——否则「祖先被更名」会误判为身份漂移。
  const maps = buildRenameMaps(blocks);
  if (maps.error) return { ok: false, identities, error: maps.error };
  const renames = maps.renames;
  const renameReverse = maps.reverse;
  for (const block of blocks) {
    if (!block.anchor) return { ok: false, identities, error: `${block.op} 段缺少章节锚` };
    const writerKey = `${block.op === 'REMOVED' ? 'remove' : 'write'}\u0000${block.anchor}`;
    // 多写者守卫防的是「两块写同一节」。带序数的 REMOVED 是例外：合成顺序作用于变动中的文档，
    // 同一序数锚的第 N 块删的是「删掉前 N-1 处之后剩下的第 1 处」，每次都是不同的物理章节。
    const sequentialOrdinalRemove = block.op === 'REMOVED' && anchorHasOrdinal(block.anchor);
    if (!sequentialOrdinalRemove) {
      if (writers.has(writerKey)) return { ok: false, identities, error: `章节存在多个物质写者：${block.anchor}` };
      writers.add(writerKey);
    }
    // 更名后的块以**新标题**为锚（规格「与既有 op 的组合」）；该锚在 before 中不存在，
    // 故解析失败时用反向映射折回旧标题再试一次。final 侧反之。
    let before = resolveSectionAnchor(beforeHeadings, block.anchor);
    if (before.status !== 'ok' && renameReverse.size > 0) {
      const folded = resolveSectionAnchor(beforeHeadings, mapAnchorText(block.anchor, renameReverse));
      if (folded.status === 'ok') before = folded;
    }
    let final = resolveSectionAnchor(finalHeadings, block.anchor);
    if (final.status !== 'ok' && renames.size > 0 && block.op !== 'RENAMED') {
      const folded = resolveSectionAnchor(finalHeadings, mapAnchorText(block.anchor, renames));
      if (folded.status === 'ok') final = folded;
    }
    identities.push({
      op: block.op,
      anchor: block.anchor,
      before: before.status === 'ok' ? before.hit! : null,
      final: final.status === 'ok' ? final.hit! : null,
    });
    if (block.op === 'ADDED') {
      if (before.status !== 'not_found' || final.status !== 'ok') {
        return { ok: false, identities, error: `ADDED 章节没有形成唯一新增结果：${block.anchor}` };
      }
      // 标题保真（架构 §五十一、`spec/change-management.md`「Delta op 的标题保真规则」）：
      // 落盘标题必须与 delta 写下的**原始锚末段**逐字相等。比较**不经** stripInlineCode——
      // 检查者与被检查者共用同一条规范化管道时检查恒真，那正是两次标题吞字静默通过的机制。
      // 注意取值来源：`final.hit.text` 是 `parseMarkdownHeadings` 剥离行内代码后的**规范化**文本，
      // 拿它来比对等于又一次让检查者与被检查者共用同一条管道。故从 `rawHeading` 取**落盘原始标题行**。
      const expectedTitle = block.rawAnchor.split(' > ').map(item => item.trim()).filter(Boolean).pop();
      const actualTitle = final.hit!.rawHeading.replace(/^#{1,6}\s*/, '').trim();
      if (expectedTitle && actualTitle !== expectedTitle) {
        return {
          ok: false, identities,
          error: `ADDED 落盘标题与 delta 不符：写下「${expectedTitle}」，落盘「${actualTitle}」`,
        };
      }
      continue;
    }
    if (block.op === 'RENAMED') {
      // 后置条件（规格「语义（只做一件事）」逐条对应）：
      //   ① 旧锚在 before 唯一命中；② 新标题在 final 唯一命中；
      //   ③ 层级不变、父链不变（位置不变的可判定投影）；④ 章节正文逐字节不变。
      const parsed = parseRenamedTitle(block);
      if (!parsed.ok) return { ok: false, identities, error: parsed.error };
      if (before.status !== 'ok') {
        return { ok: false, identities, error: `RENAMED 原章节不存在或不唯一：${block.anchor}` };
      }
      const renamedAnchor = [...mapSegments(before.hit!.path.slice(0, -1), renames), parsed.title].join(' > ');
      const renamed = resolveSectionAnchor(finalHeadings, renamedAnchor);
      if (renamed.status !== 'ok') {
        return { ok: false, identities, error: `RENAMED 新标题未形成唯一章节：${parsed.title}` };
      }
      if (renamed.hit!.level !== before.hit!.level) {
        return {
          ok: false, identities,
          error: `RENAMED 改变了标题层级：${block.anchor}（H${before.hit!.level} → H${renamed.hit!.level}）`,
        };
      }
      // 正文不变**由构造保证**而非在此比对：RENAMED 块不携带正文，合成器只替换标题行字节。
      // 此处不能比对 before/final 的整节正文——同一 delta 内的其它块（如对子节的 MODIFIED）
      // 可以合法地改动该节内部，那不是 RENAMED 干的。复验的职责是身份：标题已改、层级与父链不变。
      const beforeParents = mapSegments(before.hit!.path.slice(0, -1), renames).join('\u0000');
      if (renamed.hit!.path.slice(0, -1).join('\u0000') !== beforeParents) {
        return { ok: false, identities, error: `RENAMED 改变了章节父链：${block.anchor}` };
      }
      identities[identities.length - 1] = {
        ...identities[identities.length - 1],
        final: renamed.hit!,
      };
      continue;
    }
    if (block.op === 'REMOVED') {
      if (anchorHasOrdinal(block.anchor)) {
        // 序数锚下同名章节本就多处：后置条件是**候选数恰好减一**，而非「不再存在」。
        const bare = bareAnchor(block.anchor);
        const beforeCount = resolveSectionAnchor(beforeHeadings, bare).candidates.length;
        const finalCount = resolveSectionAnchor(finalHeadings, bare).candidates.length;
        // 后置条件是「候选数确实减少」而非「恰好减一」：同名标题可能**嵌套**（如 `## X` 内嵌 `### X`），
        // 删除外层必然带走内层，此时 2 → 0 是正确结果。删不掉才是缺陷。
        if (before.status !== 'ok' || finalCount >= beforeCount) {
          return { ok: false, identities, error: `REMOVED 序数章节未被删除：${block.anchor}（候选数 ${beforeCount} → ${finalCount}）` };
        }
        continue;
      }
      if (before.status !== 'ok' || final.status !== 'not_found') {
        return { ok: false, identities, error: `REMOVED 章节仍存在或原章节不唯一：${block.anchor}` };
      }
      continue;
    }
    if (before.status !== 'ok' || final.status !== 'ok'
      || !sameIdentityAfterRenames(before.hit!, final.hit!, renames)) {
      return { ok: false, identities, error: `MODIFIED 章节身份不守恒：${block.anchor}` };
    }
    let expectedBody: string;
    try {
      expectedBody = rebaseDeltaBodyHeadings(bodyOf(block), before.hit!.level).trim();
    } catch (error) {
      return { ok: false, identities, error: error instanceof Error ? error.message : String(error) };
    }
    if (expectedBody) {
      const actualSection = finalContent.slice(final.hit!.headingEnd, final.hit!.end).trim();
      if (!actualSection.includes(expectedBody)) {
        return { ok: false, identities, error: `MODIFIED 章节正文不完整：${block.anchor}` };
      }
    }
  }
  return { ok: true, identities };
}

function spliceSection(source: string, hit: ResolvedSectionAnchor, replacement: string): string {
  return `${source.slice(0, hit.start)}${replacement}${source.slice(hit.end)}`;
}

/** OpenLogos producer 的确定性 Markdown composer；REMOVED-ITEMS 只声明、不物化。 */
export function composeOpenLogosMarkdown(
  beforeContent: string,
  deltaContent: string,
  mode: 'CREATE' | 'MODIFY',
): string {
  const blocks = parseDeltaBlocks(deltaContent).filter(block => block.op !== 'REMOVED-ITEMS');
  if (blocks.length === 0) throw new Error('Markdown Delta 缺少物质控制段');
  let output = mode === 'CREATE' ? '' : beforeContent;
  for (const block of blocks) {
    if (!block.anchor) throw new Error(`${block.op} 段缺少章节锚`);
    const rawBody = bodyOf(block);
    const headings = parseMarkdownHeadings(output);
    const resolution = resolveSectionAnchor(headings, block.anchor);
    if (block.op === 'ADDED') {
      if (resolution.status !== 'not_found') throw new Error(`ADDED 章节已存在或不唯一：${block.anchor}`);
      // 定位用规范化锚（上方 resolution 已按 block.anchor 解析），**产出用原始锚**——
      // 两者分离见架构 §五十一；用剥离版当标题会把 `x` 段落吞掉（已静默发生两次）。
      const segments = block.anchor.split(' > ').map(item => stripInlineCode(item).trim()).filter(Boolean);
      const rawSegments = block.rawAnchor.split(' > ').map(item => item.trim()).filter(Boolean);
      const title = rawSegments[rawSegments.length - 1] ?? segments[segments.length - 1];
      let level = 2;
      let insertion = output.length;
      if (segments.length > 1) {
        const parent = resolveSectionAnchor(headings, segments.slice(0, -1).join(' > '));
        if (parent.status !== 'ok') throw new Error(`ADDED 父章节不存在或不唯一：${block.anchor}`);
        level = Math.min(parent.hit!.level + 1, 6);
        insertion = parent.hit!.end;
      }
      const body = rebaseDeltaBodyHeadings(rawBody, level);
      const prefix = insertion > 0 && !output.slice(0, insertion).endsWith('\n\n') ? '\n' : '';
      const suffix = insertion < output.length && !output.slice(insertion).startsWith('\n') ? '\n' : '';
      const section = `${'#'.repeat(level)} ${title}${body ? `\n\n${body}` : ''}\n`;
      output = `${output.slice(0, insertion)}${prefix}${section}${suffix}${output.slice(insertion)}`;
      continue;
    }
    if (resolution.status !== 'ok') throw new Error(`${block.op} 章节不存在或不唯一：${block.anchor}`);
    if (block.op === 'REMOVED') {
      output = spliceSection(output, resolution.hit!, '');
      continue;
    }
    if (block.op === 'RENAMED') {
      const parsed = parseRenamedTitle(block);
      if (!parsed.ok) throw new Error(parsed.error);
      const hit = resolution.hit!;
      // 只替换标题行：层级（# 数量）、正文、子章节与章节在文档中的位置全部不动。
      const heading = `${'#'.repeat(hit.level)} ${parsed.title}`;
      output = `${output.slice(0, hit.start)}${heading}${output.slice(hit.headingEnd)}`;
      continue;
    }
    const body = rebaseDeltaBodyHeadings(rawBody, resolution.hit!.level);
    const nextStartsHeading = resolution.hit!.end < output.length;
    const replacement = `${resolution.hit!.rawHeading}${body ? `\n\n${body}` : ''}${nextStartsHeading ? '\n\n' : '\n'}`;
    output = spliceSection(output, resolution.hit!, replacement);
  }
  const verification = verifyAgentMaterialOutcome(deltaContent, mode === 'CREATE' ? '' : beforeContent, output);
  if (!verification.ok) throw new Error(verification.error ?? 'Markdown candidate 未通过共享章节权威重验');
  return output;
}
