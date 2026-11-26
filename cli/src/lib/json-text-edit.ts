/**
 * JSON 原文最小文本编辑（fix-claude-hook-windows-powershell-fallback，功能规格 §2.105.4「写回方式」）。
 *
 * 带位置信息的严格 JSON 解析器 + 少量编辑原语：替换节点、删除 / 插入数组元素、设置对象成员。
 * 每个原语只改动目标片段及必要的分隔符，其余字节（用户条目的 Unicode 转义、紧凑 / 展开格式、
 * 缩进、键顺序、换行风格）原样保留。新插入片段的缩进与换行风格取自相邻元素。
 */

export type JsonNode =
  | { kind: 'object'; start: number; end: number; members: JsonMember[] }
  | { kind: 'array'; start: number; end: number; items: JsonNode[] }
  | { kind: 'string' | 'number' | 'literal'; start: number; end: number };

export interface JsonMember {
  key: string;
  keyStart: number;
  keyEnd: number;
  value: JsonNode;
}

class JsonTextError extends Error {}

/** 严格解析 JSON 原文；不合法时抛错（与 JSON.parse 的接受集合一致）。 */
export function parseJsonText(text: string): JsonNode {
  JSON.parse(text); // 接受集合以 JSON.parse 为准；以下解析只负责定位
  let pos = 0;
  const ws = (): void => {
    while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t' || text[pos] === '\n' || text[pos] === '\r')) pos++;
  };
  const parseString = (): number => {
    const start = pos;
    pos++; // opening quote
    while (pos < text.length && text[pos] !== '"') pos += text[pos] === '\\' ? 2 : 1;
    if (pos >= text.length) throw new JsonTextError('unterminated string');
    pos++;
    return start;
  };
  const parseValue = (): JsonNode => {
    ws();
    const start = pos;
    const ch = text[pos];
    if (ch === '{') {
      pos++;
      const members: JsonMember[] = [];
      ws();
      if (text[pos] === '}') { pos++; return { kind: 'object', start, end: pos, members }; }
      for (;;) {
        ws();
        const keyStart = parseString();
        const keyEnd = pos;
        const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
        ws();
        pos++; // ':'
        const value = parseValue();
        members.push({ key, keyStart, keyEnd, value });
        ws();
        if (text[pos] === ',') { pos++; continue; }
        pos++; // '}'
        return { kind: 'object', start, end: pos, members };
      }
    }
    if (ch === '[') {
      pos++;
      const items: JsonNode[] = [];
      ws();
      if (text[pos] === ']') { pos++; return { kind: 'array', start, end: pos, items }; }
      for (;;) {
        items.push(parseValue());
        ws();
        if (text[pos] === ',') { pos++; continue; }
        pos++; // ']'
        return { kind: 'array', start, end: pos, items };
      }
    }
    if (ch === '"') { parseString(); return { kind: 'string', start, end: pos }; }
    while (pos < text.length && /[^\s,\]}]/.test(text[pos])) pos++;
    return { kind: /^[-0-9]/.test(text.slice(start, pos)) ? 'number' : 'literal', start, end: pos };
  };
  const root = parseValue();
  return root;
}

/** 节点的解析值。 */
export function nodeValue(text: string, node: JsonNode): unknown {
  return JSON.parse(text.slice(node.start, node.end));
}

/**
 * 对象成员查找：同名成员重复时取**最后一个**——与 JSON.parse 的生效语义一致（评审 code-r1 F1），
 * 查询与写回共用本函数，被遮盖的前序同名成员原文保留不动。
 */
export function memberOf(node: JsonNode, key: string): JsonMember | undefined {
  if (node.kind !== 'object') return undefined;
  for (let i = node.members.length - 1; i >= 0; i--) if (node.members[i].key === key) return node.members[i];
  return undefined;
}

/** 文件换行风格：出现 CRLF 即沿用 CRLF，否则 LF（评审 code-r1 F5）。 */
export function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** 文件既有缩进单位：取第一处“换行 + 空白 + 非空白”的空白；无法判定时为两个空格。 */
export function detectIndentUnit(text: string): string {
  const m = /\n([ \t]+)\S/.exec(text);
  return m ? m[1] : '  ';
}

/** pos 所在行的行首空白。 */
function lineIndentAt(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/** 容器内首个元素前的空白含换行 → 展开格式。 */
function containerIsMultiline(text: string, node: JsonNode): boolean {
  const first = node.kind === 'array' ? node.items[0] : node.kind === 'object' ? node.members[0] : undefined;
  if (!first) return false;
  const firstStart = 'keyStart' in first ? first.keyStart : first.start;
  return text.slice(node.start + 1, firstStart).includes('\n');
}

/**
 * 按上下文序列化新值：展开格式下与 JSON.stringify(_, null, unit) 等价并带基准缩进与文件换行风格，紧凑格式下单行。
 * JSON 字符串字面量内不含原始换行，按 '\n' 切分只作用于结构换行。
 */
export function serializeValue(value: unknown, multiline: boolean, unit: string, baseIndent: string, eol = '\n'): string {
  if (!multiline) return JSON.stringify(value);
  return JSON.stringify(value, null, unit).split('\n').join(`${eol}${baseIndent}`);
}

/** 文件整体是否为展开格式（根容器跨行）。 */
function fileIsMultiline(text: string, root: JsonNode): boolean {
  return text.slice(root.start, root.end).includes('\n');
}

export function replaceNode(text: string, node: JsonNode, newText: string): string {
  return text.slice(0, node.start) + newText + text.slice(node.end);
}

/** 从 pos 起跳过空白后的逗号位置（不存在时抛错）。 */
function commaAfter(text: string, pos: number): number {
  const i = text.indexOf(',', pos);
  if (i < 0 || text.slice(pos, i).trim() !== '') throw new JsonTextError('comma not found');
  return i;
}

/**
 * 删除数组第 idx 个元素及其一个分隔逗号。删除区间只覆盖“被删元素自身的前导空白 + 元素 + 分隔逗号”
 * （末元素为“前一元素后的逗号 + 空白 + 元素”），其余元素——含下一元素的前导换行与缩进——字节不变（评审 code-r1 F3）。
 */
export function removeArrayItem(text: string, arr: JsonNode, idx: number): string {
  if (arr.kind !== 'array') throw new JsonTextError('not an array');
  const items = arr.items;
  if (items.length === 1) return text.slice(0, arr.start + 1) + text.slice(arr.end - 1);
  if (idx < items.length - 1) {
    const from = idx === 0 ? arr.start + 1 : commaAfter(text, items[idx - 1].end) + 1;
    const to = commaAfter(text, items[idx].end) + 1;
    return text.slice(0, from) + text.slice(to);
  }
  return text.slice(0, commaAfter(text, items[idx - 1].end)) + text.slice(items[idx].end);
}

/** 元素间分隔（含逗号）：已有两项以上取原文，否则按格式推断。 */
function itemSeparator(text: string, items: Array<{ start: number; end: number }>, multiline: boolean, indent: string): string {
  if (items.length >= 2) return text.slice(items[0].end, items[1].start);
  return multiline ? `,${detectEol(text)}${indent}` : ',';
}

/**
 * 在数组第 idx 位插入新值（idx === items.length 即追加）。新值按相邻元素的格式序列化。
 */
export function insertArrayItem(text: string, root: JsonNode, arr: JsonNode, idx: number, value: unknown): string {
  if (arr.kind !== 'array') throw new JsonTextError('not an array');
  const unit = detectIndentUnit(text);
  const items = arr.items;
  if (items.length === 0) {
    const multiline = fileIsMultiline(text, root);
    const parentIndent = lineIndentAt(text, arr.start);
    const eol = detectEol(text);
    const inner = serializeValue(value, multiline, unit, parentIndent + unit, eol);
    return replaceNode(text, arr, multiline ? `[${eol}${parentIndent}${unit}${inner}${eol}${parentIndent}]` : `[${inner}]`);
  }
  const multiline = containerIsMultiline(text, arr);
  const indent = multiline ? lineIndentAt(text, items[0].start) : '';
  const sep = itemSeparator(text, items, multiline, indent);
  const valueText = serializeValue(value, multiline, unit, indent, detectEol(text));
  if (idx >= items.length) {
    const last = items[items.length - 1];
    return text.slice(0, last.end) + sep + valueText + text.slice(last.end);
  }
  const at = items[idx].start;
  return text.slice(0, at) + valueText + sep + text.slice(at);
}

/** 设置对象成员：已存在则只替换其值，否则在对象末尾追加成员。 */
export function setObjectMember(text: string, root: JsonNode, obj: JsonNode, key: string, value: unknown): string {
  if (obj.kind !== 'object') throw new JsonTextError('not an object');
  const unit = detectIndentUnit(text);
  const eol = detectEol(text);
  const existing = memberOf(obj, key);
  if (existing) {
    const multiline = fileIsMultiline(text, root);
    const indent = lineIndentAt(text, existing.keyStart);
    return replaceNode(text, existing.value, serializeValue(value, multiline && typeof value === 'object' && value !== null, unit, indent, eol));
  }
  const members = obj.members;
  if (members.length === 0) {
    const multiline = fileIsMultiline(text, root);
    const parentIndent = lineIndentAt(text, obj.start);
    const indent = parentIndent + unit;
    const member = `${JSON.stringify(key)}${multiline ? ': ' : ':'}${serializeValue(value, multiline, unit, indent, eol)}`;
    return replaceNode(text, obj, multiline ? `{${eol}${indent}${member}${eol}${parentIndent}}` : `{${member}}`);
  }
  const multiline = containerIsMultiline(text, obj);
  const indent = multiline ? lineIndentAt(text, members[0].keyStart) : '';
  const spans = members.map(m => ({ start: m.keyStart, end: m.value.end }));
  const sep = itemSeparator(text, spans, multiline, indent);
  const first = members[0];
  const colon = text.slice(first.keyEnd, first.value.start);
  const keyText = JSON.stringify(key);
  const member = `${keyText}${/^\s*:\s*$/.test(colon) ? colon : ': '}${serializeValue(value, multiline, unit, indent, eol)}`;
  const last = members[members.length - 1];
  return text.slice(0, last.value.end) + sep + member + text.slice(last.value.end);
}

/** 以新值替换节点：原节点跨行则按展开格式序列化（基准缩进取原节点所在行），否则单行。 */
export function replaceWithValue(text: string, node: JsonNode, value: unknown): string {
  const multiline = text.slice(node.start, node.end).includes('\n');
  return replaceNode(text, node, serializeValue(value, multiline, detectIndentUnit(text), lineIndentAt(text, node.start), detectEol(text)));
}
