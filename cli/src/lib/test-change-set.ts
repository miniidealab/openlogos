import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { authorityScan, isTableDelimiterRow, tableRowCells } from './markdown-scan.js';
import { classifyProposalDeltas } from './delta-classify.js';
import { SPEC_MERGED_MARKER } from './proposal-markers.js';
import { isAcceptedTestId, isTestId, stripFirstCellManualMarker } from './test-id.js';

export const TEST_CHANGE_SET_SCHEMA = 'openlogos/test-change-set@1' as const;
export const TEST_CHANGE_SET_SOURCE = 'semantic-before-after-diff' as const;

const HASH_RE = /^[0-9a-f]{64}$/;
const PREFIXED_HASH_RE = /^sha256:[0-9a-f]{64}$/;

const TOP_KEYS = ['schema', 'change', 'module', 'source', 'changed_test_ids', 'removed_test_ids', 'targets', 'sha256'];
const TARGET_KEYS = ['target_path', 'before_sha256', 'after_sha256'];

export interface TestChangeSetTarget {
  target_path: string;
  before_sha256: string | null;
  after_sha256: string;
}

export interface TestChangeSetV1 {
  schema: typeof TEST_CHANGE_SET_SCHEMA;
  change: string;
  module: string;
  source: typeof TEST_CHANGE_SET_SOURCE;
  changed_test_ids: string[];
  removed_test_ids: string[];
  targets: TestChangeSetTarget[];
  sha256: `sha256:${string}`;
}

export interface TestChangeSetInputTarget {
  targetPath: string;
  beforeBytes: Buffer | null;
  afterBytes: Buffer;
}

export interface TestDefinitionRecord {
  target_path: string;
  column_identity: string[];
  cell_semantics: string[];
}

export type TestChangeSetBuildErrorCode =
  | 'test-change-set-invalid-utf8'
  | 'test-change-set-ambiguous-table'
  | 'test-change-set-duplicate-id'
  | 'test-change-set-target-duplicate'
  | 'test-change-set-overlap';

/**
 * preflight 归因只读取结构化事实，禁止从 message 反向解析 target path。
 * targetPaths 始终去重并按 ASCII 排序，便于跨进程稳定重放。
 */
export class TestChangeSetBuildError extends Error {
  public readonly targetPaths: string[];

  constructor(
    public readonly code: TestChangeSetBuildErrorCode,
    message: string,
    targetPaths: string[],
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'TestChangeSetBuildError';
    this.targetPaths = asciiSort(targetPaths);
  }
}

export type TestChangeSetReadResult =
  | { valid: true; value: TestChangeSetV1 }
  | { valid: false; code: string; message: string; path: string };

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function asciiSort(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function exactOrderedKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function strictUtf8(bytes: Buffer, targetPath: string): string {
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new TestChangeSetBuildError(
      'test-change-set-invalid-utf8',
      `test-change-set-invalid-utf8：${targetPath}`,
      [targetPath],
    );
  }
  return text.replace(/\r\n?/g, '\n');
}

/** 只移除外围空白；内部空白、转义与 inline-code 内容均属于语义。 */
function canonicalCell(cell: string): string {
  return cell.trim();
}

function scanTestDefinitionCandidates(
  targetPath: string,
  bytes: Buffer,
  allowDuplicateIds: boolean,
  allowAmbiguousRows: boolean,
): Map<string, TestDefinitionRecord[]> {
  const text = strictUtf8(bytes, targetPath);
  const lines = text.split('\n');
  const scan = authorityScan(lines);
  const records = new Map<string, TestDefinitionRecord[]>();

  for (let index = 0; index + 1 < lines.length; index++) {
    if (scan.masked[index] || scan.masked[index + 1] || !isTableDelimiterRow(scan.text[index + 1])) continue;
    const headers = tableRowCells(scan.text[index]).map(canonicalCell);
    const delimiters = tableRowCells(scan.text[index + 1]);
    if (headers.length < 2 || headers.length !== delimiters.length || headers.some(item => item === '')) continue;
    if (new Set(headers).size !== headers.length && !allowAmbiguousRows) {
      throw new TestChangeSetBuildError(
        'test-change-set-ambiguous-table',
        `test-change-set-ambiguous-table：${targetPath}:${index + 1}`,
        [targetPath],
      );
    }

    let row = index + 2;
    while (row < lines.length && !scan.masked[row] && scan.text[row].trim() !== '') {
      const cells = tableRowCells(scan.text[row]).map(canonicalCell);
      // §2.37.3（fix-table-test-id-manual-marker）：首格 = 裸 ID + 可选 manual 标记；剥离后的
      // **裸 ID 为该行身份**。标记本身留在 cell_semantics（定义语义）——同 ID 标记增删/平台变化
      // 构成修改（进入 C），不产生新身份。此前带标记首格整行不被识别，manual ID 不进
      // changed_test_ids，切片归属对账在写入侧误报「owned_test_ids 含非本提案变更 ID」。
      // 完整接纳规则与表格行级读法同源（code-r1 F2）：占位尾段（UT-S99-xx 等，含带 manual 标记
      // 形态）在此同被拒绝——不得只在 change-lint 前移检查生效而在变更集被接纳。
      const candidate = stripFirstCellManualMarker(cells[0] ?? '');
      if (isAcceptedTestId(candidate)) {
        if (cells.length !== headers.length) {
          if (allowAmbiguousRows) {
            row++;
            continue;
          }
          throw new TestChangeSetBuildError(
            'test-change-set-ambiguous-table',
            `test-change-set-ambiguous-table：${targetPath}:${row + 1}`,
            [targetPath],
          );
        }
        const existing = records.get(candidate) ?? [];
        if (!allowDuplicateIds && existing.length > 0) {
          throw new TestChangeSetBuildError(
            'test-change-set-duplicate-id',
            `test-change-set-duplicate-id：${candidate}`,
            [targetPath],
          );
        }
        existing.push({
          target_path: targetPath,
          column_identity: headers,
          cell_semantics: cells,
        });
        records.set(candidate, existing);
      }
      row++;
    }
    index = row - 1;
  }
  return records;
}

export function scanTestDefinitions(targetPath: string, bytes: Buffer): Map<string, TestDefinitionRecord> {
  return new Map([...scanTestDefinitionCandidates(targetPath, bytes, false, false)]
    .map(([id, records]) => [id, records[0]]));
}

function collectBefore(targets: TestChangeSetInputTarget[]): Map<string, TestDefinitionRecord[]> {
  const all = new Map<string, TestDefinitionRecord[]>();
  for (const target of targets) {
    if (target.beforeBytes === null) continue;
    for (const [id, records] of scanTestDefinitionCandidates(target.targetPath, target.beforeBytes, true, true)) {
      all.set(id, [...(all.get(id) ?? []), ...records]);
    }
  }
  return all;
}

function collectAfter(targets: TestChangeSetInputTarget[]): Map<string, TestDefinitionRecord> {
  const all = new Map<string, TestDefinitionRecord>();
  for (const target of targets) {
    for (const [id, record] of scanTestDefinitions(target.targetPath, target.afterBytes)) {
      const previous = all.get(id);
      if (previous) {
        throw new TestChangeSetBuildError(
          'test-change-set-duplicate-id',
          `test-change-set-duplicate-id：after:${id}`,
          [previous.target_path, target.targetPath],
        );
      }
      all.set(id, record);
    }
  }
  return all;
}

function recordBytes(record: TestDefinitionRecord): string {
  return JSON.stringify({
    target_path: record.target_path,
    column_identity: record.column_identity,
    cell_semantics: record.cell_semantics,
  });
}

function hashPayload(value: Omit<TestChangeSetV1, 'sha256'>): `sha256:${string}` {
  return `sha256:${sha256(Buffer.from(JSON.stringify(value), 'utf8'))}`;
}

export interface TestChangeSetLineageStep {
  changed_test_ids: string[];
  removed_test_ids: string[];
}

/**
 * fix-reopen-test-change-set-forward-merge：把 reopen 归档祖先的 change set 按重开时序前滚合并进
 * 当前快照 diff——changed=(prev∖cur_removed)∪cur_changed、removed=(prev∖cur_changed)∪cur_removed。
 * targets 与 hash 保持当前事务快照；ancestors 为空时原样返回（无留痕提案逐字节不变）。
 * 纯函数，只做集合合并；lineage 的 IO 与身份校验归 merge-transaction 的核心 apply 路径。
 */
export function forwardMergeTestChangeSets(
  current: TestChangeSetV1,
  ancestors: TestChangeSetLineageStep[],
): TestChangeSetV1 {
  if (ancestors.length === 0) return current;
  const changed = new Set<string>();
  const removed = new Set<string>();
  const steps: TestChangeSetLineageStep[] = [
    ...ancestors,
    { changed_test_ids: current.changed_test_ids, removed_test_ids: current.removed_test_ids },
  ];
  for (const step of steps) {
    for (const id of step.removed_test_ids) changed.delete(id);
    for (const id of step.changed_test_ids) removed.delete(id);
    for (const id of step.changed_test_ids) changed.add(id);
    for (const id of step.removed_test_ids) removed.add(id);
  }
  const payload: Omit<TestChangeSetV1, 'sha256'> = {
    schema: current.schema,
    change: current.change,
    module: current.module,
    source: current.source,
    changed_test_ids: asciiSort([...changed]),
    removed_test_ids: asciiSort([...removed]),
    targets: current.targets,
  };
  const overlap = payload.changed_test_ids.filter(id => payload.removed_test_ids.includes(id));
  if (overlap.length > 0) {
    throw new TestChangeSetBuildError(
      'test-change-set-overlap',
      `test-change-set-overlap：${overlap.join('、')}`,
      payload.targets.map(target => target.target_path),
      false,
    );
  }
  return { ...payload, sha256: hashPayload(payload) };
}

export function buildTestChangeSet(input: {
  change: string;
  module: string;
  targets: TestChangeSetInputTarget[];
}): TestChangeSetV1 {
  const sortedTargets = [...input.targets].sort((a, b) => a.targetPath < b.targetPath ? -1 : a.targetPath > b.targetPath ? 1 : 0);
  const targetPaths = sortedTargets.map(target => target.targetPath);
  if (new Set(targetPaths).size !== targetPaths.length) {
    const duplicates = targetPaths.filter((path, index) => targetPaths.indexOf(path) !== index);
    throw new TestChangeSetBuildError(
      'test-change-set-target-duplicate',
      'test-change-set-target-duplicate',
      duplicates,
      false,
    );
  }
  const before = collectBefore(sortedTargets);
  const after = collectAfter(sortedTargets);
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [id, record] of after) {
    const oldCandidates = before.get(id) ?? [];
    if (!oldCandidates.some(old => recordBytes(old) === recordBytes(record))) changed.push(id);
  }
  for (const id of before.keys()) if (!after.has(id)) removed.push(id);
  const payload: Omit<TestChangeSetV1, 'sha256'> = {
    schema: TEST_CHANGE_SET_SCHEMA,
    change: input.change,
    module: input.module,
    source: TEST_CHANGE_SET_SOURCE,
    changed_test_ids: asciiSort(changed),
    removed_test_ids: asciiSort(removed),
    targets: sortedTargets.map(target => ({
      target_path: target.targetPath,
      before_sha256: target.beforeBytes === null ? null : sha256(target.beforeBytes),
      after_sha256: sha256(target.afterBytes),
    })),
  };
  const overlap = payload.changed_test_ids.filter(id => payload.removed_test_ids.includes(id));
  if (overlap.length > 0) {
    throw new TestChangeSetBuildError(
      'test-change-set-overlap',
      `test-change-set-overlap：${overlap.join('、')}`,
      targetPaths,
      false,
    );
  }
  return { ...payload, sha256: hashPayload(payload) };
}

function invalid(code: string, message: string, path: string): TestChangeSetReadResult {
  return { valid: false, code, message, path };
}

export function validateTestChangeSet(
  root: string,
  raw: unknown,
  expected: { change: string; module: string; targetPaths?: string[] },
): TestChangeSetReadResult {
  const value = asRecord(raw);
  if (!value || !exactOrderedKeys(value, TOP_KEYS)) {
    return invalid('test-slice-change-set-shape', 'change set 顶层键必须严格且按 canonical 顺序排列', '$.test_change_set');
  }
  if (value.schema !== TEST_CHANGE_SET_SCHEMA) {
    return invalid('test-slice-change-set-schema', `不支持 change set schema：${String(value.schema)}`, '$.test_change_set.schema');
  }
  if (value.change !== expected.change || value.module !== expected.module || value.source !== TEST_CHANGE_SET_SOURCE) {
    return invalid('test-slice-change-set-identity', 'change/module/source 与当前提案身份不一致', '$.test_change_set');
  }
  if (!Array.isArray(value.changed_test_ids) || !Array.isArray(value.removed_test_ids) || !Array.isArray(value.targets)) {
    return invalid('test-slice-change-set-shape', 'C/R/targets 必须为数组', '$.test_change_set');
  }
  const changed = value.changed_test_ids;
  const removed = value.removed_test_ids;
  if ([...changed, ...removed].some(id => typeof id !== 'string' || !isTestId(id))) {
    return invalid('test-slice-change-set-test-id', 'C/R 含非法测试 ID', '$.test_change_set');
  }
  if (JSON.stringify(changed) !== JSON.stringify(asciiSort(changed as string[]))
    || JSON.stringify(removed) !== JSON.stringify(asciiSort(removed as string[]))
    || (changed as string[]).some(id => (removed as string[]).includes(id))) {
    return invalid('test-slice-change-set-order', 'C/R 必须 ASCII 排序、去重且不相交', '$.test_change_set');
  }
  const targets: TestChangeSetTarget[] = [];
  for (let index = 0; index < value.targets.length; index++) {
    const row = asRecord(value.targets[index]);
    if (!row || !exactOrderedKeys(row, TARGET_KEYS)
      || typeof row.target_path !== 'string'
      || !(row.before_sha256 === null || (typeof row.before_sha256 === 'string' && HASH_RE.test(row.before_sha256)))
      || typeof row.after_sha256 !== 'string' || !HASH_RE.test(row.after_sha256)) {
      return invalid('test-slice-change-set-target', 'target identity/hash 字段非法', `$.test_change_set.targets[${index}]`);
    }
    const path = join(root, ...row.target_path.split('/'));
    if (!existsSync(path) || sha256(readFileSync(path)) !== row.after_sha256) {
      return invalid('test-slice-change-set-target-hash', `正式 target 缺失或 after hash 漂移：${row.target_path}`, `$.test_change_set.targets[${index}]`);
    }
    targets.push(row as unknown as TestChangeSetTarget);
  }
  const targetPaths = targets.map(target => target.target_path);
  if (JSON.stringify(targetPaths) !== JSON.stringify(asciiSort(targetPaths))) {
    return invalid('test-slice-change-set-target-order', 'targets 必须按 ASCII 排序且去重', '$.test_change_set.targets');
  }
  if (expected.targetPaths && JSON.stringify(targetPaths) !== JSON.stringify(asciiSort(expected.targetPaths))) {
    return invalid('test-slice-change-set-target-identity', 'targets 与 baseline plan 的 test targets 不一致', '$.test_change_set.targets');
  }
  if (typeof value.sha256 !== 'string' || !PREFIXED_HASH_RE.test(value.sha256)) {
    return invalid('test-slice-change-set-hash', 'change set sha256 格式非法', '$.test_change_set.sha256');
  }
  const payload = {
    schema: TEST_CHANGE_SET_SCHEMA,
    change: value.change as string,
    module: value.module as string,
    source: TEST_CHANGE_SET_SOURCE,
    changed_test_ids: changed as string[],
    removed_test_ids: removed as string[],
    targets,
  };
  if (value.sha256 !== hashPayload(payload)) {
    return invalid('test-slice-change-set-hash', 'change set payload hash 不一致', '$.test_change_set.sha256');
  }
  return { valid: true, value: { ...payload, sha256: value.sha256 as `sha256:${string}` } };
}

export function readTestChangeSet(
  root: string,
  proposalDir: string,
  expected: { change: string; module: string; targetPaths?: string[] },
): TestChangeSetReadResult {
  const markerPath = join(proposalDir, SPEC_MERGED_MARKER);
  if (!existsSync(markerPath)) return invalid('test-slice-change-set-missing', `${SPEC_MERGED_MARKER} 不存在`, SPEC_MERGED_MARKER);
  let marker: unknown;
  try {
    const source = readFileSync(markerPath, 'utf8');
    const document = parseDocument(source, { uniqueKeys: true, strict: true, prettyErrors: false });
    if (document.errors.length > 0) throw new Error(document.errors.map(error => error.message).join('；'));
    marker = JSON.parse(source) as unknown;
  } catch (error) {
    return invalid('test-slice-change-set-marker', `${SPEC_MERGED_MARKER} 无法严格解析：${String(error)}`, SPEC_MERGED_MARKER);
  }
  const record = asRecord(marker);
  if (!record || !('test_change_set' in record)) {
    if (record?.type === 'no_delta_spec_complete'
      && !classifyProposalDeltas(proposalDir).some(entry => entry.mergeDisposition === 'mergeable')) {
      return { valid: true, value: buildTestChangeSet({
        change: expected.change,
        module: expected.module,
        targets: [],
      }) };
    }
    return invalid('test-slice-change-set-missing', 'SPEC_MERGED.test_change_set 缺失', '$.test_change_set');
  }
  return validateTestChangeSet(root, record.test_change_set, expected);
}
