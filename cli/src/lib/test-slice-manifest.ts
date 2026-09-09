import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, posix, relative, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { readTestChangeSet } from './test-change-set.js';
import { VERIFY_PASS_MARKER, hasSpecCompleteMarker } from './proposal-markers.js';
import { TABLE_TEST_ID_RE, testIdScanRe } from './test-id.js';

export const TEST_SLICE_MANIFEST = 'TEST_SLICE_MANIFEST.json';
export const SLICE_CHECKPOINTS = 'SLICE_CHECKPOINTS.jsonl';
export const TEST_SLICE_SCHEMA = 'openlogos/test-slice-manifest@1';
/** 新写入一律 `@2`（根规范 spec/test-slice-manifest.md §6.1、功能规格 §2.77.3）。 */
export const SLICE_CHECKPOINT_SCHEMA = 'openlogos/slice-checkpoint@2';
/** 存量账本行的旧 schema：其 `manifest_sha256` 是 manifest **整份文件字节**的哈希。 */
export const SLICE_CHECKPOINT_SCHEMA_V1 = 'openlogos/slice-checkpoint@1';
const SLICE_CHECKPOINT_SCHEMA_RE = /^openlogos\/slice-checkpoint@\d+$/;

const HASH_RE = /^sha256:[0-9a-f]{64}$/;
const SLICE_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

export interface TestSliceManifestSlice {
  slice_id: string;
  task_text: string;
  owned_test_ids: string[];
  runner_selectors: string[];
  spec_targets: string[];
  [key: string]: unknown;
}

export interface TestSliceManifestV1 {
  schema: typeof TEST_SLICE_SCHEMA;
  change: string;
  module: string;
  task_fingerprint: string;
  spec_fingerprint: string;
  generated_at: string;
  slices: TestSliceManifestSlice[];
  [key: string]: unknown;
}

export type TestSliceManifestStatus = 'valid' | 'missing' | 'invalid' | 'stale' | 'unsupported';
export type SliceVerifyMode = 'slice-checkpoint' | 'final';

export interface TestSliceViolation {
  code: string;
  path: string;
  message: string;
  fix_hint: string;
}

export interface SliceManifestSummary {
  status: TestSliceManifestStatus;
  path: string;
  schema: string | null;
  task_fingerprint: string | null;
  spec_fingerprint: string | null;
  /**
   * manifest 整份文件字节的哈希——**纯审计观察面**。
   *
   * 自 checkpoint `@2` 起它不再是采信判据（§6.1）：`@2` 行比对的是判定实质身份，只有存量
   * `@1` 行仍按本字段匹配。身份**不进入本对象**——`sliceManifestSummary` 是 1.1.0 已发布
   * 契约（`spec/schema/*.schema.json`，`additionalProperties: false`），加字段即破坏合同，
   * 而 §2.77.4 的零回归边界要求命令输出逐条不变。
   */
  sha256: string | null;
}

export interface SliceCheckpointSummary {
  final: boolean;
  result: 'PASS' | 'FAIL' | null;
  confirmed_slice_ids: string[];
}

export interface SliceVerificationState {
  manifest_status: TestSliceManifestStatus;
  verify_mode: SliceVerifyMode | null;
  attempted_slice_id: string | null;
  confirmed_slice_ids: string[];
  eligible_test_ids: string[];
  pending_test_ids: string[];
  reason?: string;
  human_action_required?: boolean;
  violations?: TestSliceViolation[];
  test_change_set?: {
    status: 'valid' | 'invalid';
    schema: string | null;
    sha256: string | null;
    changed_test_ids: string[];
    removed_test_ids: string[];
  };
  manifest: SliceManifestSummary;
  checkpoint: SliceCheckpointSummary;
  manifest_data?: TestSliceManifestV1;
}

interface CodeTask {
  text: string;
  checked: boolean;
  children: Array<{ text: string; checked: boolean }>;
}

interface SliceCheckpointRow {
  /** 账本 append-only 且允许多版本共存（§6.2），故此处是行**自身**记录的 schema。 */
  schema: string;
  slice_id: string;
  manifest_sha256: string;
  result: 'PASS' | 'FAIL';
  eligible_test_ids_sha256: string;
  timestamp: string;
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function prefixedSha256(bytes: string | Buffer): string {
  return `sha256:${sha256(bytes)}`;
}

/**
 * 规范化 JSON：对象键递归字典序、数组**保序**。
 *
 * 键序规范化让「同一份判定实质换个书写顺序」得到同一身份；数组保序则是刻意的——
 * `slices` 的顺序就是切片划分的一部分（§6.1），两片对调即是另一份划分。
 */
function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * manifest 的**判定实质身份**（根规范 §6.1、功能规格 §2.77.1）。
 *
 * 对 `schema` / `change` / `module` / `slices`（逐字段、保序）/ `task_fingerprint` /
 * `spec_fingerprint` 求规范化 JSON 的 SHA-256，**排除 `generated_at`**。
 *
 * 排除不是实现口味：`generated_at` 是纯写盘时刻，两次调用相差毫秒即不同，而这种不同不携带
 * 任何关于「划分或其依赖是否改变」的信息，故不得进入流程分支的条件
 * （`spec/cli-json-output.md`「指纹语义（降级为观察）」）。此前以 manifest 整份**文件字节**
 * 作身份，正是让这个时间戳事实上决定了 checkpoint 采信——恢复重跑必然作废整本账本。
 */
export function computeSliceManifestIdentity(manifest: {
  schema: string;
  change: string;
  module: string;
  task_fingerprint: string;
  spec_fingerprint: string;
  slices: ReadonlyArray<Record<string, unknown>>;
}): string {
  return prefixedSha256(Buffer.from(canonicalJson({
    schema: manifest.schema,
    change: manifest.change,
    module: manifest.module,
    slices: manifest.slices,
    task_fingerprint: manifest.task_fingerprint,
    spec_fingerprint: manifest.spec_fingerprint,
  }), 'utf8'));
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function uniqSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStrictJson(path: string): unknown {
  const source = readFileSync(path, 'utf8');
  const document = parseDocument(source, { uniqueKeys: true, strict: true, prettyErrors: false });
  if (document.errors.length > 0) {
    throw new Error(document.errors.map(error => error.message).join('；'));
  }
  return JSON.parse(source) as unknown;
}

function parseCodeTasks(content: string): CodeTask[] {
  const tasks: CodeTask[] = [];
  let inCode = false;
  let current: CodeTask | null = null;
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const section = /^## \[([a-z][a-z0-9-]*)\]/i.exec(line);
    if (section) {
      inCode = section[1].toLowerCase() === 'code';
      current = null;
      continue;
    }
    if (!inCode) continue;
    const parent = /^- \[([ x])\]\s+(.+)$/i.exec(line);
    if (parent) {
      current = { text: normalizeText(parent[2]), checked: parent[1].toLowerCase() === 'x', children: [] };
      tasks.push(current);
      continue;
    }
    const child = /^\s+- \[([ x])\]\s+(.+)$/i.exec(line);
    if (child && current) {
      current.children.push({ text: normalizeText(child[2]), checked: child[1].toLowerCase() === 'x' });
    }
  }
  return tasks;
}

export function computeTaskFingerprint(tasksContent: string): string {
  const model = parseCodeTasks(tasksContent).map(task => ({
    task_text: task.text,
    children: task.children.map(child => child.text),
  }));
  return prefixedSha256(Buffer.from(JSON.stringify(model), 'utf8'));
}

export function computeSpecFingerprint(root: string, targets: string[]): string {
  const hash = createHash('sha256');
  for (const target of uniqSorted(targets)) {
    const content = readFileSync(join(root, ...target.split('/')), 'utf8').replace(/\r\n/g, '\n');
    hash.update(Buffer.from(`${target}\0${content}\0`, 'utf8'));
  }
  return `sha256:${hash.digest('hex')}`;
}

function safeProjectPath(root: string, raw: string): string | null {
  if (!raw || raw.includes('\0') || raw.includes('\n') || raw.includes('\r') || raw.startsWith('/')) return null;
  const normalized = posix.normalize(raw.replace(/\\/g, '/')).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.split('/').includes('..')) return null;
  const absolute = resolve(root, ...normalized.split('/'));
  const rel = relative(resolve(root), absolute);
  if (rel.startsWith('..') || rel.split(sep).includes('..')) return null;
  if (existsSync(absolute)) {
    const realRoot = realpathSync(root);
    const realTarget = realpathSync(absolute);
    const realRel = relative(realRoot, realTarget);
    if (realRel.startsWith('..') || realRel.split(sep).includes('..')) return null;
  }
  return normalized;
}

function extractTableTestIds(content: string): string[] {
  const ids: string[] = [];
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const match = TABLE_TEST_ID_RE.exec(line.trim());
    if (match) ids.push(match[1]);
  }
  return uniqSorted(ids);
}

function walkMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) result.push(full);
  }
  return result.sort();
}

export function extractDefinedVerificationIds(root: string): string[] {
  const ids = walkMarkdown(join(root, 'logos', 'resources', 'test'))
    .filter(path => !path.includes(`${sep}smoke${sep}`))
    .flatMap(path => extractTableTestIds(readFileSync(path, 'utf8')))
    .filter(id => id.startsWith('UT-') || id.startsWith('ST-'));
  return uniqSorted(ids);
}

export function extractChangedTestIds(proposalDir: string): string[] {
  const ids = walkMarkdown(join(proposalDir, 'deltas', 'test'))
    .flatMap(path => extractTableTestIds(readFileSync(path, 'utf8')));
  return uniqSorted(ids);
}

function violation(code: string, path: string, message: string, fixHint: string): TestSliceViolation {
  return { code, path, message, fix_hint: fixHint };
}

function sortViolations(items: TestSliceViolation[]): TestSliceViolation[] {
  return items.sort((a, b) => a.path.localeCompare(b.path)
    || a.code.localeCompare(b.code)
    || a.message.localeCompare(b.message));
}

function parseManifestShape(raw: unknown, violations: TestSliceViolation[]): TestSliceManifestV1 | null {
  const top = asRecord(raw);
  if (!top) {
    violations.push(violation('test-slice-manifest-invalid', '$', 'manifest 根必须是对象', '按 v1 schema 重建 manifest。'));
    return null;
  }
  if (top.schema !== TEST_SLICE_SCHEMA) return null;
  const strings = ['change', 'module', 'task_fingerprint', 'spec_fingerprint', 'generated_at'] as const;
  for (const key of strings) {
    if (typeof top[key] !== 'string' || String(top[key]).trim() === '') {
      violations.push(violation('test-slice-manifest-invalid', `$.${key}`, `${key} 必须为非空字符串`, '由 slice-planner 重建该字段。'));
    }
  }
  if (typeof top.task_fingerprint === 'string' && !HASH_RE.test(top.task_fingerprint)) {
    violations.push(violation('test-slice-manifest-invalid', '$.task_fingerprint', 'task_fingerprint 格式非法', '写入 sha256:<64-hex>。'));
  }
  if (typeof top.spec_fingerprint === 'string' && !HASH_RE.test(top.spec_fingerprint)) {
    violations.push(violation('test-slice-manifest-invalid', '$.spec_fingerprint', 'spec_fingerprint 格式非法', '写入 sha256:<64-hex>。'));
  }
  if (typeof top.generated_at === 'string' && Number.isNaN(Date.parse(top.generated_at))) {
    violations.push(violation('test-slice-manifest-invalid', '$.generated_at', 'generated_at 不是合法 ISO 8601 时间', '使用 new Date().toISOString()。'));
  }
  if (!Array.isArray(top.slices) || top.slices.length === 0) {
    violations.push(violation('test-slice-manifest-invalid', '$.slices', 'slices 必须是非空数组', '为每个顶层 [code] 切片生成一项。'));
    return null;
  }
  const slices: TestSliceManifestSlice[] = [];
  top.slices.forEach((item, index) => {
    const row = asRecord(item);
    const base = `$.slices[${index}]`;
    if (!row) {
      violations.push(violation('test-slice-manifest-invalid', base, 'slice 必须是对象', '重建该 slice。'));
      return;
    }
    const sliceId = typeof row.slice_id === 'string' ? row.slice_id : '';
    const taskText = typeof row.task_text === 'string' ? normalizeText(row.task_text) : '';
    if (!SLICE_ID_RE.test(sliceId)) {
      violations.push(violation('test-slice-manifest-invalid', `${base}.slice_id`, 'slice_id 格式非法', '使用 3-64 位小写字母、数字和连字符。'));
    }
    if (!taskText) violations.push(violation('test-slice-manifest-invalid', `${base}.task_text`, 'task_text 为空', '复制对应顶层 [code] task 文本。'));
    const arrayField = (key: string): string[] => {
      const value = row[key];
      if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== 'string' || !entry.trim())) {
        violations.push(violation('test-slice-manifest-invalid', `${base}.${key}`, `${key} 必须为非空字符串数组`, '由 slice-planner 重建该字段。'));
        return [];
      }
      if (new Set(value).size !== value.length) {
        violations.push(violation('test-slice-manifest-invalid', `${base}.${key}`, `${key} 含重复值`, '去重并稳定排序。'));
      }
      return value.map(entry => String(entry));
    };
    slices.push({
      ...row,
      slice_id: sliceId,
      task_text: taskText,
      owned_test_ids: arrayField('owned_test_ids'),
      runner_selectors: arrayField('runner_selectors'),
      spec_targets: arrayField('spec_targets'),
    } as TestSliceManifestSlice);
  });
  return {
    ...top,
    schema: TEST_SLICE_SCHEMA,
    change: String(top.change ?? ''),
    module: String(top.module ?? ''),
    task_fingerprint: String(top.task_fingerprint ?? ''),
    spec_fingerprint: String(top.spec_fingerprint ?? ''),
    generated_at: String(top.generated_at ?? ''),
    slices,
  } as TestSliceManifestV1;
}

function readCheckpointRows(proposalDir: string): SliceCheckpointRow[] {
  const path = join(proposalDir, SLICE_CHECKPOINTS);
  if (!existsSync(path)) return [];
  const rows: SliceCheckpointRow[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as SliceCheckpointRow;
      // 语法上接纳任何 `openlogos/slice-checkpoint@<major>` 行——账本 append-only 且允许
      // 多版本共存（§6.2），未知主版本由 checkpointBinding() 保守处置，而非在此丢弃。
      if (typeof row.schema === 'string' && SLICE_CHECKPOINT_SCHEMA_RE.test(row.schema)
        && typeof row.slice_id === 'string'
        && HASH_RE.test(row.manifest_sha256)
        && (row.result === 'PASS' || row.result === 'FAIL')
        && HASH_RE.test(row.eligible_test_ids_sha256)
        && typeof row.timestamp === 'string') rows.push(row);
    } catch {
      // 截断或非法行不采信为 checkpoint；保留原始账本供审计。
    }
  }
  return rows;
}

/**
 * 按**行自身的 schema** 决定 `manifest_sha256` 的比对对象（根规范 §6.2、功能规格 §2.77.3）。
 *
 * 未知主版本返回 null——保守不采信：该行不进入确认集合，也**不构成 violation、不中断**
 * validator（§8）。这与 manifest 自身的 `test-slice-manifest-unsupported`（整份产物不可解释，
 * 必须阻断）是两回事：跳过账本里的一行，不影响其余行的可解释性。
 */
function checkpointBinding(row: SliceCheckpointRow): 'identity' | 'file-bytes' | null {
  if (row.schema === SLICE_CHECKPOINT_SCHEMA) return 'identity';
  if (row.schema === SLICE_CHECKPOINT_SCHEMA_V1) return 'file-bytes';
  return null;
}

function emptyState(
  status: TestSliceManifestStatus,
  reason: string,
  summary: SliceManifestSummary,
  violations: TestSliceViolation[] = [],
): SliceVerificationState {
  return {
    manifest_status: status,
    verify_mode: null,
    attempted_slice_id: null,
    confirmed_slice_ids: [],
    eligible_test_ids: [],
    pending_test_ids: [],
    reason,
    ...(violations.length > 0 ? { violations: sortViolations(violations) } : {}),
    manifest: summary,
    checkpoint: { final: false, result: null, confirmed_slice_ids: [] },
  };
}

/** manifest 失效的三种态——需要重跑 `openlogos slice plan` 重建的唯一判据。 */
const RECOVERY_REASONS = new Set([
  'test-slice-manifest-missing', 'test-slice-manifest-invalid', 'test-slice-manifest-stale',
]);

export function isManifestRecoveryReason(reason: string | null | undefined): boolean {
  return RECOVERY_REASONS.has(reason ?? '');
}

export function shouldUseSliceVerification(proposalDir: string): boolean {
  if (existsSync(join(proposalDir, VERIFY_PASS_MARKER)) && !existsSync(join(proposalDir, TEST_SLICE_MANIFEST))) return false;
  if (!hasSpecCompleteMarker(proposalDir)) return false;
  const tasksPath = join(proposalDir, 'tasks.md');
  if (!existsSync(tasksPath)) return false;
  const tasks = parseCodeTasks(readFileSync(tasksPath, 'utf8'));
  // 只有 slice-planner 合法产出的切片才进入 v1：每个顶层切片都必须标注真实测试 ID。
  // 这同时保留历史“切片1/切片2”无 ID 任务的 legacy final 行为；该类文本不能据以
  // 确定性恢复 owned_test_ids，强行启用只会制造不可恢复歧义。
  return tasks.length >= 2 && tasks.every(task => (task.text.match(testIdScanRe()) ?? []).length > 0);
}

export function deriveSliceVerificationState(
  root: string,
  proposalDir: string,
  expected?: { change?: string; module?: string },
): SliceVerificationState | null {
  if (!shouldUseSliceVerification(proposalDir)) return null;
  const manifestPath = join(proposalDir, TEST_SLICE_MANIFEST);
  const relManifest = relative(root, manifestPath).replace(/\\/g, '/');
  const changeSet = readTestChangeSet(root, proposalDir, {
    change: expected?.change ?? basename(proposalDir),
    module: expected?.module ?? 'core',
  });
  if (!changeSet.valid) {
    return {
      ...emptyState('invalid', 'test-slice-manifest-invalid', {
        status: existsSync(manifestPath) ? 'invalid' : 'missing', path: relManifest,
        schema: null, task_fingerprint: null, spec_fingerprint: null,
        sha256: existsSync(manifestPath) ? prefixedSha256(readFileSync(manifestPath)) : null,
      }, [violation(changeSet.code, changeSet.path, changeSet.message,
        '恢复可信 SPEC_MERGED.test_change_set；禁止从 Delta、Git 或 slice manifest 反推。')]),
      human_action_required: true,
      test_change_set: {
        status: 'invalid', schema: null, sha256: null, changed_test_ids: [], removed_test_ids: [],
      },
    };
  }
  const changeSetSummary = {
    status: 'valid' as const,
    schema: changeSet.value.schema,
    sha256: changeSet.value.sha256,
    changed_test_ids: changeSet.value.changed_test_ids,
    removed_test_ids: changeSet.value.removed_test_ids,
  };
  if (!existsSync(manifestPath)) {
    return { ...emptyState('missing', 'test-slice-manifest-missing', {
      status: 'missing', path: relManifest, schema: null,
      task_fingerprint: null, spec_fingerprint: null, sha256: null,
    }), human_action_required: false, test_change_set: changeSetSummary };
  }

  const bytes = readFileSync(manifestPath);
  const manifestSha = prefixedSha256(bytes);
  let raw: unknown;
  try {
    raw = readStrictJson(manifestPath);
  } catch (error) {
    return { ...emptyState('invalid', 'test-slice-manifest-invalid', {
      status: 'invalid', path: relManifest, schema: null,
      task_fingerprint: null, spec_fingerprint: null, sha256: manifestSha,
    }, [violation('test-slice-manifest-invalid', '$', `manifest 无法严格解析：${String(error)}`, '修复 JSON 或由 slice-planner 原子重建。')]),
    human_action_required: false, test_change_set: changeSetSummary };
  }
  const record = asRecord(raw);
  const schema = typeof record?.schema === 'string' ? record.schema : null;
  if (schema && schema !== TEST_SLICE_SCHEMA && /^openlogos\/test-slice-manifest@\d+$/.test(schema)) {
    return { ...emptyState('unsupported', 'test-slice-manifest-unsupported', {
      status: 'unsupported', path: relManifest, schema,
      task_fingerprint: typeof record?.task_fingerprint === 'string' ? record.task_fingerprint : null,
      spec_fingerprint: typeof record?.spec_fingerprint === 'string' ? record.spec_fingerprint : null,
      sha256: manifestSha,
    }, [violation('test-slice-manifest-unsupported', '$.schema', `不支持 manifest schema：${schema}`, '升级 OpenLogos 或由人工确认迁移策略；禁止自动覆盖。')]),
    human_action_required: true, test_change_set: changeSetSummary };
  }

  const violations: TestSliceViolation[] = [];
  const manifest = parseManifestShape(raw, violations);
  const summary: SliceManifestSummary = {
    status: 'invalid', path: relManifest, schema,
    task_fingerprint: typeof record?.task_fingerprint === 'string' ? record.task_fingerprint : null,
    spec_fingerprint: typeof record?.spec_fingerprint === 'string' ? record.spec_fingerprint : null,
    sha256: manifestSha,
  };
  if (!manifest) return {
    ...emptyState('invalid', 'test-slice-manifest-invalid', summary, violations),
    human_action_required: false,
    test_change_set: changeSetSummary,
  };

  const tasksContent = readFileSync(join(proposalDir, 'tasks.md'), 'utf8');
  const tasks = parseCodeTasks(tasksContent);
  if (expected?.change && manifest.change !== expected.change) {
    violations.push(violation('test-slice-manifest-invalid', '$.change', `change=${manifest.change} 与 ${expected.change} 不一致`, '按当前 guard slug 重建。'));
  }
  if (expected?.module && manifest.module !== expected.module) {
    violations.push(violation('test-slice-manifest-invalid', '$.module', `module=${manifest.module} 与 ${expected.module} 不一致`, '按当前 guard module 重建。'));
  }
  if (manifest.slices.length !== tasks.length) {
    violations.push(violation('test-slice-manifest-invalid', '$.slices', 'slices 数量与 [code] 顶层任务数不一致', '保留任务边界并重建 manifest。'));
  }
  manifest.slices.forEach((slice, index) => {
    if (tasks[index] && slice.task_text !== tasks[index].text) {
      violations.push(violation('test-slice-manifest-stale', `$.slices[${index}].task_text`, 'task_text 与对应 [code] task 不一致', '保留任务文本并重建 manifest/fingerprint。'));
    }
  });

  const sliceIds = manifest.slices.map(slice => slice.slice_id);
  for (const id of new Set(sliceIds)) {
    if (sliceIds.filter(item => item === id).length > 1) {
      violations.push(violation('test-slice-id-duplicate', '$.slices', `slice_id 重复：${id}`, '为每个顶层切片生成唯一稳定 ID。'));
    }
  }
  const owned = manifest.slices.flatMap(slice => slice.owned_test_ids);
  for (const id of new Set(owned)) {
    if (owned.filter(item => item === id).length > 1) {
      violations.push(violation('test-slice-test-id-duplicate', '$.slices', `测试 ID 多重归属：${id}`, '人工消歧后仅保留一个 owning slice。'));
    }
  }
  const changedIds = changeSet.value.changed_test_ids;
  for (const id of changedIds.filter(id => !owned.includes(id))) {
    violations.push(violation('test-slice-test-id-missing', '$.slices', `变更测试 ID 未归属：${id}`, '把该 ID 归入唯一能力切片。'));
  }
  for (const id of owned.filter(id => !changedIds.includes(id))) {
    violations.push(violation('test-slice-test-id-unknown', '$.slices', `owned_test_ids 含非本提案变更 ID：${id}`, '删除未知 ID 或补齐已合并测试规格。'));
  }

  const allSpecTargets = uniqSorted(manifest.slices.flatMap(slice => slice.spec_targets));
  const definitions = new Map<string, string[]>();
  for (const target of allSpecTargets) {
    const safe = safeProjectPath(root, target);
    if (!safe || !safe.startsWith('logos/resources/test/') || !existsSync(join(root, ...safe.split('/')))) {
      violations.push(violation('test-slice-manifest-invalid', '$.slices[].spec_targets', `非法或不存在的测试规格路径：${target}`, '使用项目根相对的已合并测试规格路径。'));
      continue;
    }
    for (const id of extractTableTestIds(readFileSync(join(root, ...safe.split('/')), 'utf8'))) {
      definitions.set(id, [...(definitions.get(id) ?? []), safe]);
    }
  }
  manifest.slices.forEach((slice, index) => {
    const selectors = new Set(slice.runner_selectors);
    for (const id of slice.owned_test_ids) {
      const paths = definitions.get(id) ?? [];
      if (paths.length !== 1 || !slice.spec_targets.includes(paths[0])) {
        violations.push(violation('test-slice-test-id-unknown', `$.slices[${index}].owned_test_ids`, `${id} 未在该 slice 的唯一 spec_target 中定义`, '修复 spec_targets 或 owned_test_ids。'));
      }
      if (!selectors.has(id)) {
        violations.push(violation('test-slice-manifest-invalid', `$.slices[${index}].runner_selectors`, `selector 未覆盖 owned ID：${id}`, '为该 ID 增加可执行 selector。'));
      }
    }
  });

  const actualTaskFingerprint = computeTaskFingerprint(tasksContent);
  let actualSpecFingerprint: string | null = null;
  try { actualSpecFingerprint = computeSpecFingerprint(root, allSpecTargets); } catch { /* 路径违规已报告 */ }
  if (manifest.task_fingerprint !== actualTaskFingerprint) {
    violations.push(violation('test-slice-manifest-stale', '$.task_fingerprint', 'task fingerprint 漂移', '保留 checkbox 与任务边界，重建 manifest。'));
  }
  if (actualSpecFingerprint && manifest.spec_fingerprint !== actualSpecFingerprint) {
    violations.push(violation('test-slice-manifest-stale', '$.spec_fingerprint', 'spec fingerprint 漂移', '从已合并测试规格重建 manifest。'));
  }

  if (violations.length > 0) {
    const ambiguous = violations.some(item => item.code === 'test-slice-test-id-duplicate');
    const stale = !ambiguous && violations.every(item => item.code === 'test-slice-manifest-stale');
    const reason = ambiguous ? 'test-slice-assignment-ambiguous'
      : stale ? 'test-slice-manifest-stale' : 'test-slice-manifest-invalid';
    return { ...emptyState(stale ? 'stale' : 'invalid', reason, {
      ...summary, status: stale ? 'stale' : 'invalid',
    }, violations), human_action_required: ambiguous, test_change_set: changeSetSummary };
  }

  // 采信条件按**行自身的 schema** 分派（§6.2）：`@2` 比判定实质身份、`@1` 比 manifest 整份
  // 文件字节哈希（旧规则逐字不变）、未知主版本保守不采信。身份不匹配的行保留审计，不参与集合。
  const manifestIdentity = computeSliceManifestIdentity(manifest);
  const confirmedSet = new Set(readCheckpointRows(proposalDir)
    .filter(row => row.result === 'PASS')
    .filter(row => {
      const binding = checkpointBinding(row);
      if (binding === 'identity') return row.manifest_sha256 === manifestIdentity;
      if (binding === 'file-bytes') return row.manifest_sha256 === manifestSha;
      return false;
    })
    .map(row => row.slice_id));
  const confirmed = manifest.slices.map(slice => slice.slice_id).filter(id => confirmedSet.has(id));
  const attempted = manifest.slices.find(slice => !confirmedSet.has(slice.slice_id)) ?? null;
  const defined = extractDefinedVerificationIds(root);
  const definedSet = new Set(defined);
  const changedVerificationIds = changedIds.filter(id => definedSet.has(id));
  const baseline = defined.filter(id => !changedVerificationIds.includes(id));
  const confirmedOwnedAll = manifest.slices
    .filter(slice => confirmedSet.has(slice.slice_id))
    .flatMap(slice => slice.owned_test_ids);
  const attemptedOwnedAll = attempted?.owned_test_ids ?? [];
  const confirmedOwned = confirmedOwnedAll.filter(id => definedSet.has(id));
  const attemptedOwned = attemptedOwnedAll.filter(id => definedSet.has(id));
  const eligible = uniqSorted([...baseline, ...confirmedOwned, ...attemptedOwned]);
  const pending = attempted
    ? changedIds.filter(id => !confirmedOwnedAll.includes(id) && !attemptedOwnedAll.includes(id)).sort()
    : [];
  const allTasksDone = tasks.length > 0 && tasks.every(task => task.checked && task.children.every(child => child.checked));
  if (!attempted && !allTasksDone) {
    return {
      ...emptyState('valid', 'slice-task-state-inconsistent', { ...summary, status: 'valid' }, [
        violation('slice-task-state-inconsistent', 'tasks.md#[code]', '全部 checkpoint 已通过但 [code] 任务未全部完成', '核对实际交付后勾选对应任务；禁止伪造 final。'),
      ]),
      confirmed_slice_ids: confirmed,
      eligible_test_ids: defined,
      manifest_data: manifest,
      checkpoint: { final: false, result: null, confirmed_slice_ids: confirmed },
      human_action_required: true,
      test_change_set: changeSetSummary,
    };
  }
  return {
    manifest_status: 'valid',
    verify_mode: attempted ? 'slice-checkpoint' : 'final',
    attempted_slice_id: attempted?.slice_id ?? null,
    confirmed_slice_ids: confirmed,
    eligible_test_ids: attempted ? eligible : defined,
    pending_test_ids: attempted ? pending : [],
    manifest: { ...summary, status: 'valid' },
    checkpoint: { final: !attempted, result: null, confirmed_slice_ids: confirmed },
    manifest_data: manifest,
    human_action_required: false,
    test_change_set: changeSetSummary,
  };
}

export function eligibleIdsFingerprint(ids: string[]): string {
  return prefixedSha256(Buffer.from(JSON.stringify(uniqSorted(ids)), 'utf8'));
}

export function appendSliceCheckpoint(
  proposalDir: string,
  state: SliceVerificationState,
  result: 'PASS' | 'FAIL',
  timestamp = new Date().toISOString(),
): boolean {
  if (state.manifest_status !== 'valid' || state.verify_mode !== 'slice-checkpoint'
    || !state.attempted_slice_id || !state.manifest_data) return false;
  const row: SliceCheckpointRow = {
    schema: SLICE_CHECKPOINT_SCHEMA,
    slice_id: state.attempted_slice_id,
    // 绑定判定实质身份，不是文件字节——恢复重跑重建 manifest 时该值不变（§6.1）。
    // 身份由 manifest_data 现算，而不是从已发布的 summary 里读：加字段会破坏 1.1.0 契约。
    manifest_sha256: computeSliceManifestIdentity(state.manifest_data),
    result,
    eligible_test_ids_sha256: eligibleIdsFingerprint(state.eligible_test_ids),
    timestamp,
  };
  if (result === 'PASS') {
    const duplicate = readCheckpointRows(proposalDir).some(existing =>
      existing.schema === row.schema
      && existing.slice_id === row.slice_id
      && existing.manifest_sha256 === row.manifest_sha256
      && existing.eligible_test_ids_sha256 === row.eligible_test_ids_sha256
      && existing.result === 'PASS');
    if (duplicate) return false;
  }
  const path = join(proposalDir, SLICE_CHECKPOINTS);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
  return true;
}

export function writeTestSliceManifestAtomic(path: string, manifest: TestSliceManifestV1): void {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const temp = `${path}.tmp`;
  const fd = openSync(temp, 'w');
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  // 写入侧只保证原子替换；完整 schema/归属校验由 deriveSliceVerificationState 完成。
  renameSync(temp, path);
}
