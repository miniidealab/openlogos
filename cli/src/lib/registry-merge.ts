/**
 * 登记表（logos/logos-project.yaml）的三方条目合并（spec/branch-sync.md §5；场景 S44）。
 *
 * 输入共同起点（O）、本分支（A）、主分支（B）三个版本的解析结果，输出合并结果或冲突清单。
 * 以共同起点为基准逐条比较，而不是对两边取并集：取并集无法表达删除，会把一边已经删除的条目从另一边拿回来。
 * 合并本身是纯函数；写回以本分支文档为底稿做结构化修改（`renderMergedRegistry`），保留其注释与排版。
 */
import { isMap, isSeq, parseDocument, parse as parseYaml, YAMLSeq, type Document } from 'yaml';

export type RegistryConflictKind = 'both-added-different' | 'both-modified' | 'delete-modify';

export interface RegistryConflict {
  /** 登记表顶层字段名 */
  field: string;
  /** 键控列表中的键；整字段冲突时为 null */
  key: string | null;
  kind: RegistryConflictKind;
}

export interface RegistryCounter {
  name: string;
  base: number | null;
  ours: number;
  theirs: number;
  merged: number;
  both_advanced: boolean;
}

/** 对本分支文档的一次结构化修改。 */
export type RegistryOp =
  | { type: 'list-replace'; field: string; keyName: string; key: string; value: unknown }
  | { type: 'list-delete'; field: string; keyName: string; key: string }
  | { type: 'list-append'; field: string; keyName: string; key: string; value: unknown }
  | { type: 'field-set'; field: string; value: unknown }
  | { type: 'field-delete'; field: string }
  | { type: 'counter-set'; field: string; value: number };

export interface RegistryMergeOutcome {
  /** 按 field、key 升序；非空时不得写回（全有或全无） */
  conflicts: RegistryConflict[];
  counters: RegistryCounter[];
  /** 相对本分支版本的修改；有冲突时为 [] */
  ops: RegistryOp[];
  /** 合并后的登记表值；有冲突时为 null */
  merged: Record<string, unknown> | null;
}

export type RegistryRecord = Record<string, unknown>;

/** 键控列表（§5.2）：顶层字段 → 键名。 */
export const KEYED_LISTS: Readonly<Record<string, string>> = Object.freeze({
  modules: 'id',
  features: 'id',
  scenarios: 'id',
  resource_index: 'path',
});

/** 计数器（§5.3）。 */
export const COUNTER_FIELDS: readonly string[] = Object.freeze(['scenario_counter', 'feature_counter', 'decision_counter']);

const isRecord = (v: unknown): v is RegistryRecord => v !== null && typeof v === 'object' && !Array.isArray(v);

/** 按解析后的值比较：映射的键顺序不影响相等，数组的元素顺序影响相等。 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  // Date 等标量对象（YAML 时间戳）按其 JSON 形态比较
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return false;
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const has = (r: RegistryRecord, k: string): boolean => Object.prototype.hasOwnProperty.call(r, k);

/**
 * 键控列表的形态是否符合预期（§5.1）：字段缺失或为 null 视为空列表；否则必须是数组，
 * 条目必须是带非空字符串键的映射，同一版本内键不得重复。
 */
export function registryShapeSupported(version: RegistryRecord): boolean {
  for (const [field, keyName] of Object.entries(KEYED_LISTS)) {
    const list = version[field];
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) return false;
    const seen = new Set<string>();
    for (const item of list) {
      if (!isRecord(item)) return false;
      const key = item[keyName];
      if (typeof key !== 'string' || key === '' || seen.has(key)) return false;
      seen.add(key);
    }
  }
  return true;
}

function listOf(version: RegistryRecord, field: string): RegistryRecord[] {
  const list = version[field];
  return Array.isArray(list) ? (list as RegistryRecord[]) : [];
}

const counterValue = (version: RegistryRecord, field: string): number | null => {
  const v = version[field];
  return isRecord(v) && Number.isInteger(v.next_id) ? (v.next_id as number) : null;
};

/**
 * 三方条目合并（§5.2～§5.4）。调用方须先以 `registryShapeSupported` 确认三个版本的形态。
 */
export function mergeRegistry(base: RegistryRecord, ours: RegistryRecord, theirs: RegistryRecord): RegistryMergeOutcome {
  const conflicts: RegistryConflict[] = [];
  const counters: RegistryCounter[] = [];
  const ops: RegistryOp[] = [];

  // —— 键控列表（§5.2）——
  for (const [field, keyName] of Object.entries(KEYED_LISTS)) {
    const o = new Map(listOf(base, field).map(e => [e[keyName] as string, e]));
    const a = new Map(listOf(ours, field).map(e => [e[keyName] as string, e]));
    const b = new Map(listOf(theirs, field).map(e => [e[keyName] as string, e]));
    for (const key of new Set([...o.keys(), ...a.keys(), ...b.keys()])) {
      const eo = o.get(key);
      const ea = a.get(key);
      const eb = b.get(key);
      if (eo === undefined) {
        if (ea !== undefined && eb !== undefined && !deepEqual(ea, eb)) conflicts.push({ field, key, kind: 'both-added-different' });
        continue; // 只有本分支新增 / 两边新增相同：保留本分支条目；只有主分支新增在下方追加
      }
      const aChanged = ea === undefined || !deepEqual(ea, eo);
      const bChanged = eb === undefined || !deepEqual(eb, eo);
      if (!bChanged) continue; // 主分支没动：沿用本分支（保留 / 已修改 / 已删除）
      if (!aChanged) {
        // 只有主分支改动：取主分支（修改或删除）
        ops.push(eb === undefined ? { type: 'list-delete', field, keyName, key } : { type: 'list-replace', field, keyName, key, value: clone(eb) });
        continue;
      }
      if (ea === undefined && eb === undefined) continue; // 两边都删除
      if (ea === undefined || eb === undefined) { conflicts.push({ field, key, kind: 'delete-modify' }); continue; }
      if (!deepEqual(ea, eb)) conflicts.push({ field, key, kind: 'both-modified' });
    }
    // 主分支新增的条目按其在主分支中的相对顺序追加在列表末尾
    for (const eb of listOf(theirs, field)) {
      const key = eb[keyName] as string;
      if (!o.has(key) && !a.has(key)) ops.push({ type: 'list-append', field, keyName, key, value: clone(eb) });
    }
  }

  // —— 计数器（§5.3）与其余顶层字段（§5.4）——
  const handled = new Set(Object.keys(KEYED_LISTS));
  const fields = [...new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])].filter(f => !handled.has(f));
  for (const field of fields) {
    if (COUNTER_FIELDS.includes(field)) {
      const ca = counterValue(ours, field);
      const cb = counterValue(theirs, field);
      const co = counterValue(base, field);
      // 两边都是整数计数器、且共同起点没有该字段或同为整数计数器时取较大者；其余情形按整值规则
      if (ca !== null && cb !== null && (co !== null || !has(base, field))) {
        const merged = Math.max(ca, cb);
        counters.push({
          name: field, base: co, ours: ca, theirs: cb, merged,
          both_advanced: co === null ? true : ca > co && cb > co,
        });
        if (merged !== ca) ops.push({ type: 'counter-set', field, value: merged });
        continue;
      }
    }
    const inO = has(base, field);
    const inA = has(ours, field);
    const inB = has(theirs, field);
    const aChanged = inA !== inO || (inA && !deepEqual(ours[field], base[field]));
    const bChanged = inB !== inO || (inB && !deepEqual(theirs[field], base[field]));
    if (!bChanged) continue;
    if (!aChanged) {
      ops.push(inB ? { type: 'field-set', field, value: clone(theirs[field]) } : { type: 'field-delete', field });
      continue;
    }
    const same = inA === inB && (!inA || deepEqual(ours[field], theirs[field]));
    if (!same) conflicts.push({ field, key: null, kind: 'both-modified' });
  }

  conflicts.sort((x, y) => (x.field === y.field
    ? (x.key ?? '') < (y.key ?? '') ? -1 : (x.key ?? '') > (y.key ?? '') ? 1 : 0
    : x.field < y.field ? -1 : 1));
  if (conflicts.length > 0) return { conflicts, counters, ops: [], merged: null };
  return { conflicts, counters, ops, merged: applyOpsToValue(ours, ops) };
}

/** 把修改应用到本分支版本的值上，得到合并后的登记表值。 */
function applyOpsToValue(ours: RegistryRecord, ops: RegistryOp[]): RegistryRecord {
  const out = clone(ours);
  for (const op of ops) {
    switch (op.type) {
      case 'list-replace': {
        const list = out[op.field] as RegistryRecord[];
        list[list.findIndex(e => e[op.keyName] === op.key)] = clone(op.value) as RegistryRecord;
        break;
      }
      case 'list-delete': {
        const list = out[op.field] as RegistryRecord[];
        list.splice(list.findIndex(e => e[op.keyName] === op.key), 1);
        break;
      }
      case 'list-append': {
        if (!Array.isArray(out[op.field])) out[op.field] = [];
        (out[op.field] as unknown[]).push(clone(op.value));
        break;
      }
      case 'field-set': out[op.field] = clone(op.value); break;
      case 'field-delete': delete out[op.field]; break;
      case 'counter-set': (out[op.field] as RegistryRecord).next_id = op.value; break;
    }
  }
  return out;
}

function seqOf(doc: Document, field: string): YAMLSeq {
  let seq = doc.get(field, true);
  if (!isSeq(seq)) {
    // 字段缺失、空 block 或显式 null：新建序列挂在该键下
    seq = new YAMLSeq();
    doc.set(field, seq);
  }
  // `[]` 是 flow sequence，其后不能跟 block 条目——统一落成 block 形态
  (seq as YAMLSeq).flow = false;
  return seq as YAMLSeq;
}

function seqIndex(seq: YAMLSeq, keyName: string, key: string): number {
  return seq.items.findIndex(item => isMap(item) && item.get(keyName, false) === key);
}

/**
 * 以本分支版本的文档为底稿写回（§5.5）：被修改的条目在原位置替换，被删除的条目移除，
 * 主分支新增的条目追加在所属列表末尾。没有任何修改时原样返回本分支的文本。
 * 写回前自检：结果必须可解析且其值等于合并结果，否则抛错、不产出文本。
 */
export function renderMergedRegistry(oursText: string, outcome: RegistryMergeOutcome): string {
  if (outcome.merged === null) throw new Error('登记表存在条目冲突，不得写回');
  if (outcome.ops.length === 0) return oursText;
  const doc = parseDocument(oursText);
  for (const op of outcome.ops) {
    switch (op.type) {
      case 'list-replace': {
        const seq = seqOf(doc, op.field);
        seq.items[seqIndex(seq, op.keyName, op.key)] = doc.createNode(op.value);
        break;
      }
      case 'list-delete': {
        const seq = seqOf(doc, op.field);
        seq.items.splice(seqIndex(seq, op.keyName, op.key), 1);
        break;
      }
      case 'list-append': seqOf(doc, op.field).add(doc.createNode(op.value)); break;
      case 'field-set': doc.set(op.field, doc.createNode(op.value)); break;
      case 'field-delete': doc.delete(op.field); break;
      case 'counter-set': doc.setIn([op.field, 'next_id'], op.value); break;
    }
  }
  const text = doc.toString({ lineWidth: 0 });
  assertRenderedRegistry(text, outcome.merged);
  return text;
}

/** 写回前自检（§5.5）：可解析，且解析出的值等于合并结果。 */
export function assertRenderedRegistry(text: string, expected: RegistryRecord): void {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    throw new Error(`登记表合并结果自检失败，已放弃写入：${(error as Error).message}`);
  }
  if (!deepEqual(parsed, expected)) throw new Error('登记表合并结果自检失败，已放弃写入：写回文本与合并结果不一致');
}

/** 把登记表文本解析为映射；不可解析或不是映射时返回 null。 */
export function parseRegistry(text: string): RegistryRecord | null {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) return null;
  const value = doc.toJS() as unknown;
  return isRecord(value) ? value : null;
}
