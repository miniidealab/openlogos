import { authorityScan, stripInlineCode } from './markdown-scan.js';

export type DeltaBlockOp = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'REMOVED-ITEMS';

export interface DeltaBlock {
  op: DeltaBlockOp;
  anchor: string;
  markerLine: number;
  lines: string[];
}

export interface ResolvedSectionAnchor {
  line: number;
  endLine: number;
  level: number;
  text: string;
  path: string[];
  start: number;
  end: number;
  headingEnd: number;
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
    const marker = /^##\s+(REMOVED-ITEMS|ADDED|MODIFIED|REMOVED)\b\s*(?:[—-]\s*(.+))?$/.exec(trimmed);
    if (marker) {
      if (current) blocks.push(current);
      const rawAnchor = marker[2] ?? '';
      current = {
        op: marker[1] as DeltaBlockOp,
        anchor: stripInlineCode(rawAnchor).trim() || rawAnchor.trim(),
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

/** 一次 fence-aware 扫描产生真实 ATX heading tree 与确定性字符范围。 */
export function parseMarkdownHeadings(content: string): ResolvedSectionAnchor[] {
  const records = splitLines(content);
  const lines = records.map(record => record.raw);
  const scan = authorityScan(lines);
  const headings: ResolvedSectionAnchor[] = [];
  const stack: ResolvedSectionAnchor[] = [];
  for (let i = 0; i < records.length; i++) {
    if (scan.masked[i]) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(scan.text[i]);
    if (!match) continue;
    const level = match[1].length;
    const text = stripInlineCode(match[2]).trim();
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    const heading: ResolvedSectionAnchor = {
      line: i,
      endLine: records.length,
      level,
      text,
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

/** 标题路径按真实祖先链匹配；0/多命中均 fail-closed。 */
export function resolveSectionAnchor(
  headings: readonly ResolvedSectionAnchor[], anchor: string,
): SectionAnchorResolution {
  const segments = anchor.split(' > ').map(segment => stripInlineCode(segment).trim()).filter(Boolean);
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

function sameIdentity(a: ResolvedSectionAnchor, b: ResolvedSectionAnchor): boolean {
  return a.level === b.level && a.text === b.text && a.path.join('\u0000') === b.path.join('\u0000');
}

/** Agent slot 物质结果验证器；只读 before/final，不重写 Agent 字节。 */
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
  for (const block of blocks) {
    if (!block.anchor) return { ok: false, identities, error: `${block.op} 段缺少章节锚` };
    const writerKey = `${block.op === 'REMOVED' ? 'remove' : 'write'}\u0000${block.anchor}`;
    if (writers.has(writerKey)) return { ok: false, identities, error: `章节存在多个物质写者：${block.anchor}` };
    writers.add(writerKey);
    const before = resolveSectionAnchor(beforeHeadings, block.anchor);
    const final = resolveSectionAnchor(finalHeadings, block.anchor);
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
      continue;
    }
    if (block.op === 'REMOVED') {
      if (before.status !== 'ok' || final.status !== 'not_found') {
        return { ok: false, identities, error: `REMOVED 章节仍存在或原章节不唯一：${block.anchor}` };
      }
      continue;
    }
    if (before.status !== 'ok' || final.status !== 'ok' || !sameIdentity(before.hit!, final.hit!)) {
      return { ok: false, identities, error: `MODIFIED 章节身份不守恒：${block.anchor}` };
    }
    const expectedBody = bodyOf(block).trim();
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
    const body = bodyOf(block);
    const headings = parseMarkdownHeadings(output);
    const resolution = resolveSectionAnchor(headings, block.anchor);
    if (block.op === 'ADDED') {
      if (resolution.status !== 'not_found') throw new Error(`ADDED 章节已存在或不唯一：${block.anchor}`);
      const segments = block.anchor.split(' > ').map(item => stripInlineCode(item).trim()).filter(Boolean);
      const title = segments[segments.length - 1];
      let level = 2;
      let insertion = output.length;
      if (segments.length > 1) {
        const parent = resolveSectionAnchor(headings, segments.slice(0, -1).join(' > '));
        if (parent.status !== 'ok') throw new Error(`ADDED 父章节不存在或不唯一：${block.anchor}`);
        level = Math.min(parent.hit!.level + 1, 6);
        insertion = parent.hit!.end;
      }
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
    const nextStartsHeading = resolution.hit!.end < output.length;
    const replacement = `${resolution.hit!.rawHeading}${body ? `\n\n${body}` : ''}${nextStartsHeading ? '\n\n' : '\n'}`;
    output = spliceSection(output, resolution.hit!, replacement);
  }
  const verification = verifyAgentMaterialOutcome(deltaContent, mode === 'CREATE' ? '' : beforeContent, output);
  if (!verification.ok) throw new Error(verification.error ?? 'Markdown candidate 未通过共享章节权威重验');
  return output;
}
