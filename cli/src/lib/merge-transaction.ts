import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify } from 'yaml';
import {
  parseBaselineClosurePlan, validateAndStripNonMarkdownDelta,
  type BaselineClosureTarget,
} from './baseline-closure.js';
import {
  applyBaselineClosureBatch, recoverBaselineClosureApply,
  BASELINE_CLOSURE_APPLY_JOURNAL, type BaselineClosureApplyInput,
} from './baseline-apply.js';
import {
  buildTestChangeSet, TestChangeSetBuildError,
  type TestChangeSetInputTarget, type TestChangeSetV1,
} from './test-change-set.js';
import {
  assertMergeTransactionSemantics, computeMergeReceiptSha256,
  mergeSha256,
} from './merge-transaction-semantic.js';

export const MERGE_TRANSACTION_SCHEMA = 'openlogos/merge-transaction@1' as const;
export const MERGE_PREFLIGHT_SCHEMA = 'openlogos/merge-preflight@1' as const;
export const MERGE_TRANSACTION_FILE = 'MERGE_TRANSACTION.json';
export const MERGE_TRANSACTION_SCHEMA_PATH = 'spec/schema/merge-transaction.schema.json';
const CONTRACT_PATH = 'spec/cli-json-output.md';
const SLOT_LIMIT_BYTES = 20 * 1024 * 1024;

function bundledContractPath(relativePath: string): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, '..', '..', ...relativePath.split('/')),
    join(moduleDir, '..', '..', '..', ...relativePath.split('/')),
  ];
  const resolved = candidates.find(candidate => existsSync(candidate));
  if (!resolved) {
    throw new MergeTransactionError(
      'unsupported_contract',
      `安装态缺少 merge transaction 契约资产：${relativePath}`,
      false,
    );
  }
  return resolved;
}

export type MergeTransactionPhase = 'collecting' | 'ready' | 'sealed' | 'applying' | 'completed' | 'failed';
export type MergeTransactionAction = 'submit_content' | 'seal' | 'apply' | 'recover' | 'abort';
export type MergeTransactionClassification =
  | 'invalid_phase' | 'action_not_allowed' | 'content_slot_missing' | 'slot_identity_mismatch'
  | 'source_hash_mismatch' | 'before_hash_mismatch' | 'target_set_mismatch' | 'seal_mismatch'
  | 'apply_conflict' | 'receipt_mismatch' | 'legacy_manifest_rejected' | 'unsupported_contract'
  | 'recovery_required' | 'internal_failure' | 'aborted';

export const MERGE_TRANSACTION_ACTION_COMMANDS: Readonly<Record<MergeTransactionAction, string>> = Object.freeze({
  submit_content: 'submit-content',
  seal: 'seal',
  apply: 'apply',
  recover: 'recover',
  abort: 'abort',
});

export function mergeTransactionCommandForAction(action: string): string | null {
  return Object.prototype.hasOwnProperty.call(MERGE_TRANSACTION_ACTION_COMMANDS, action)
    ? MERGE_TRANSACTION_ACTION_COMMANDS[action as MergeTransactionAction]
    : null;
}

interface StoredTarget {
  slot_id: string;
  delta_path: string;
  target_path: string;
  mode: 'CREATE' | 'MODIFY';
  category: string;
  producer: 'agent' | 'openlogos';
  source_sha256: string;
  before_sha256: string | null;
  content_sha256: string | null;
  sealed_sha256: string | null;
}

export interface MergePreflightTarget {
  path: string;
  mode: 'CREATE' | 'MODIFY';
  producer: 'agent' | 'openlogos';
  before_sha256: string | null;
  final_sha256: string;
}

export interface MergePreflightView {
  schema: typeof MERGE_PREFLIGHT_SCHEMA;
  transaction_id: string;
  plan_sha256: string;
  target_set_sha256: string;
  targets: MergePreflightTarget[];
  test_change_set_sha256: string;
  final_target_paths: string[];
  sha256: string;
}

export interface MergePreflightErrorFact {
  code: string;
  target_paths: string[];
  producer: 'agent' | 'openlogos' | 'mixed' | 'unknown';
  retryable: boolean;
}

export interface MergeTransactionPathHash {
  path: string;
  sha256: string;
}

export interface MergeContentSlotDescriptor {
  slot_id: string;
  target_ref: string;
  staging_path: string;
  required: true;
  content_encoding: 'utf8-raw';
  max_bytes: number;
  write_protocol: 'atomic-rename';
  submitted_sha256: string | null;
}

export interface MergeTransactionReceipt {
  transaction_id: string;
  seal_sha256: string;
  target_set_sha256: string;
  closure_sha256: string;
  target_count: number;
  plan_sha256: string;
  change: string;
  module: string;
  changed_paths: string[];
  created_paths: string[];
  final_hashes: MergeTransactionPathHash[];
  metadata_summaries: Array<Record<string, unknown>>;
  test_change_set: Record<string, unknown> | null;
  spec_merged: { path: string };
  commit_paths: string[];
  receipt_sha256: string;
  completed_at: string;
}

interface StoredTransaction {
  schema: typeof MERGE_TRANSACTION_SCHEMA;
  transaction_id: string;
  slug: string;
  module: string;
  phase: MergeTransactionPhase;
  classification: MergeTransactionClassification | null;
  plan_sha256: string;
  target_set_sha256: string;
  schema_sha256: string;
  contract_sha256: string;
  seal_sha256: string | null;
  /** 0.14.1 sealed 事务没有该内部字段，读取时必须兼容缺席。 */
  preflight?: MergePreflightView | null;
  targets: StoredTarget[];
  receipt: MergeTransactionReceipt | null;
  artifact_hashes?: MergeTransactionPathHash[];
  aborted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MergeTransactionProjection {
  schema: typeof MERGE_TRANSACTION_SCHEMA;
  transaction_id: string;
  slug: string;
  phase: MergeTransactionPhase;
  classification: MergeTransactionClassification | null;
  allowed_actions: MergeTransactionAction[];
  next_action: MergeTransactionAction | null;
  target_set_sha256: string;
  seal_sha256: string | null;
  schema_sha256: string;
  contract_sha256: string;
  content_slots: {
    required: number;
    submitted: number;
    missing_slot_ids: string[];
    items: MergeContentSlotDescriptor[];
  };
  receipt: MergeTransactionReceipt | null;
  artifact_hashes: MergeTransactionPathHash[];
  aborted_at: string | null;
}

export interface MergeTransactionPlanTarget {
  slot_id: string;
  target_ref: string;
  delta_path: string;
  target_path: string;
  mode: 'CREATE' | 'MODIFY';
  producer: 'agent' | 'openlogos';
  staging_path: string | null;
}

export class MergeTransactionError extends Error {
  constructor(
    public readonly classification: MergeTransactionClassification,
    message: string,
    public readonly retryable: boolean,
    public readonly transaction?: MergeTransactionProjection,
  ) { super(message); }
}

function digest(bytes: string | Buffer): string {
  return mergeSha256(bytes);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function plainHash(value: string): string { return value.replace(/^sha256:/, ''); }

function fsyncFile(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function atomicWrite(path: string, bytes: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${path.split('/').pop()}.${process.pid}.tmp`);
  writeFileSync(temp, bytes);
  fsyncFile(temp);
  renameSync(temp, path);
  fsyncFile(path);
}

function transactionPath(proposalDir: string): string { return join(proposalDir, MERGE_TRANSACTION_FILE); }

function slotPath(proposalDir: string, tx: StoredTransaction, slotId: string): string {
  return join(proposalDir, 'merge-content', tx.transaction_id, `${slotId}.content`);
}

function projectRoot(proposalDir: string): string {
  return resolve(proposalDir, '..', '..', '..');
}

function stagingPath(proposalDir: string, tx: StoredTransaction, slotId: string): string {
  return join(proposalDir, 'merge-staging', tx.transaction_id, slotId, 'content');
}

function relativeProjectPath(proposalDir: string, path: string): string {
  return relative(projectRoot(proposalDir), path).replace(/\\/g, '/');
}

function targetRef(tx: StoredTransaction, slotId: string): string {
  return `target_${plainHash(digest(`${tx.target_set_sha256}:${slotId}`)).slice(0, 20)}`;
}

function ensureContained(path: string, base: string): void {
  let cursor = existsSync(path) ? path : dirname(path);
  while (!existsSync(cursor)) cursor = dirname(cursor);
  const realBase = realpathSync(base);
  const realCursor = realpathSync(cursor);
  if (realCursor !== realBase && !realCursor.startsWith(`${realBase}${sep}`)) {
    throw new MergeTransactionError('slot_identity_mismatch', 'content slot 路径越界', false);
  }
}

function readStored(proposalDir: string): StoredTransaction {
  const path = transactionPath(proposalDir);
  if (!existsSync(path)) throw new MergeTransactionError('invalid_phase', 'merge transaction 尚未创建', true);
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch {
    throw new MergeTransactionError('internal_failure', 'MERGE_TRANSACTION.json 无法解析', false);
  }
  const tx = value as StoredTransaction;
  if (!tx || tx.schema !== MERGE_TRANSACTION_SCHEMA || !Array.isArray(tx.targets)
    || typeof tx.transaction_id !== 'string' || typeof tx.slug !== 'string') {
    throw new MergeTransactionError('unsupported_contract', '不支持的 merge transaction 契约', false);
  }
  return tx;
}

function writeStored(proposalDir: string, tx: StoredTransaction): void {
  atomicWrite(transactionPath(proposalDir), `${JSON.stringify(tx, null, 2)}\n`);
}

function allowed(tx: StoredTransaction): MergeTransactionAction[] {
  if (tx.phase === 'collecting') return ['submit_content', 'abort'];
  if (tx.phase === 'ready') return ['seal', 'abort'];
  if (tx.phase === 'sealed') return ['apply', 'abort'];
  if (tx.phase === 'applying') return ['recover'];
  if (tx.phase === 'failed') return tx.classification === 'recovery_required' ? ['recover'] : [];
  return [];
}

export function projectMergeTransaction(tx: StoredTransaction, proposalDir: string): MergeTransactionProjection {
  const agentTargets = tx.targets.filter(target => target.producer === 'agent')
    .sort((a, b) => a.slot_id.localeCompare(b.slot_id));
  const missing = agentTargets.filter(target => target.content_sha256 === null).map(target => target.slot_id);
  const actions = allowed(tx);
  const projection: MergeTransactionProjection = {
    schema: MERGE_TRANSACTION_SCHEMA,
    transaction_id: tx.transaction_id,
    slug: tx.slug,
    phase: tx.phase,
    classification: tx.classification,
    allowed_actions: actions,
    next_action: actions[0] ?? null,
    target_set_sha256: tx.target_set_sha256,
    seal_sha256: tx.seal_sha256,
    schema_sha256: tx.schema_sha256,
    contract_sha256: tx.contract_sha256,
    content_slots: {
      required: agentTargets.length,
      submitted: agentTargets.length - missing.length,
      missing_slot_ids: missing,
      items: agentTargets.map(target => ({
        slot_id: target.slot_id,
        target_ref: targetRef(tx, target.slot_id),
        staging_path: relativeProjectPath(proposalDir, stagingPath(proposalDir, tx, target.slot_id)),
        required: true,
        content_encoding: 'utf8-raw',
        max_bytes: SLOT_LIMIT_BYTES,
        write_protocol: 'atomic-rename',
        submitted_sha256: target.content_sha256,
      })),
    },
    receipt: tx.receipt,
    artifact_hashes: tx.artifact_hashes ?? [],
    aborted_at: tx.aborted_at ?? null,
  };
  assertMergeTransactionSemantics(projection);
  return projection;
}

export function listMergeTransactionPlanTargets(proposalDir: string): MergeTransactionPlanTarget[] {
  const tx = readStored(proposalDir);
  return tx.targets.map(target => ({
    slot_id: target.slot_id,
    target_ref: targetRef(tx, target.slot_id),
    delta_path: target.delta_path,
    target_path: target.target_path,
    mode: target.mode,
    producer: target.producer,
    staging_path: target.producer === 'agent'
      ? relativeProjectPath(proposalDir, stagingPath(proposalDir, tx, target.slot_id))
      : null,
  }));
}

function moduleFromGuard(root: string, slug: string): string {
  try {
    const guard = JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf8')) as Record<string, unknown>;
    if (guard.activeChange !== slug) throw new Error('guard mismatch');
    return typeof guard.module === 'string' && guard.module ? guard.module : 'core';
  } catch { throw new MergeTransactionError('target_set_mismatch', 'active guard 与 transaction slug 不一致', false); }
}

function producer(target: BaselineClosureTarget): 'agent' | 'openlogos' {
  const path = target.targetPath ?? '';
  return path.endsWith('.md') && !path.startsWith('spec/') && !path.startsWith('skills/')
    ? 'agent' : 'openlogos';
}

function currentHash(path: string): string | null {
  if (!existsSync(path)) return null;
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink()) throw new MergeTransactionError('before_hash_mismatch', `目标不是普通文件：${path}`, false);
  return digest(readFileSync(path));
}

function planTargets(root: string, proposalDir: string, slug: string): { module: string; targets: StoredTarget[]; planHash: string } {
  const proposalPath = join(proposalDir, 'proposal.md');
  const parsed = parseBaselineClosurePlan(root, proposalDir, readFileSync(proposalPath, 'utf8'), relative(root, proposalPath));
  if (!parsed.plan && parsed.violations.length === 0) return { module: moduleFromGuard(root, slug), targets: [], planHash: digest(canonical({ change: slug, module: moduleFromGuard(root, slug), contract: MERGE_TRANSACTION_SCHEMA, targets: [] })) };
  if (!parsed.plan || parsed.violations.length > 0) {
    throw new MergeTransactionError('target_set_mismatch', `baseline closure 计划无效：${parsed.violations[0]?.message ?? '缺少计划'}`, false);
  }
  const module = moduleFromGuard(root, slug);
  const raw = parsed.plan.targets.filter((target): target is BaselineClosureTarget & { deltaPath: string; targetPath: string; mode: 'CREATE' | 'MODIFY' } =>
    target.deltaPath !== null && target.targetPath !== null && (target.mode === 'CREATE' || target.mode === 'MODIFY'));
  const identities = raw.map(target => {
    const deltaAbs = join(proposalDir, ...target.deltaPath.split('/'));
    const targetAbs = join(root, ...target.targetPath.split('/'));
    const before = currentHash(targetAbs);
    if ((target.mode === 'CREATE' && before !== null) || (target.mode === 'MODIFY' && before === null)) {
      throw new MergeTransactionError('before_hash_mismatch', `${target.mode} 与目标事实不一致：${target.targetPath}`, false);
    }
    return {
      delta_path: target.deltaPath, target_path: target.targetPath, mode: target.mode,
      category: target.category, producer: producer(target), source_sha256: digest(readFileSync(deltaAbs)), before_sha256: before,
    };
  }).sort((a, b) => a.target_path < b.target_path ? -1 : a.target_path > b.target_path ? 1 : 0);
  const planHash = digest(canonical({ change: slug, module, contract: MERGE_TRANSACTION_SCHEMA, targets: identities }));
  const targets: StoredTarget[] = identities.map((item, index) => ({
    slot_id: `slot_${plainHash(digest(`${planHash}:${index}:${item.target_path}`)).slice(0, 20)}`,
    ...item, content_sha256: null, sealed_sha256: null,
  }));
  return { module, targets, planHash };
}

export function createMergeTransaction(root: string, proposalDir: string, slug: string): MergeTransactionProjection {
  if (existsSync(transactionPath(proposalDir))) return projectMergeTransaction(readStored(proposalDir), proposalDir);
  const planned = planTargets(root, proposalDir, slug);
  const targetSet = digest(canonical(planned.targets.map(({ content_sha256: _c, sealed_sha256: _s, ...target }) => target)));
  const id = `mtx_${plainHash(digest(`${planned.planHash}:${targetSet}`)).slice(0, 24)}`;
  const now = new Date().toISOString();
  const schemaPath = bundledContractPath(MERGE_TRANSACTION_SCHEMA_PATH);
  const contractPath = bundledContractPath(CONTRACT_PATH);
  const tx: StoredTransaction = {
    schema: MERGE_TRANSACTION_SCHEMA, transaction_id: id, slug, module: planned.module,
    phase: planned.targets.some(target => target.producer === 'agent') ? 'collecting' : 'ready', classification: null,
    plan_sha256: planned.planHash, target_set_sha256: targetSet,
    schema_sha256: digest(readFileSync(schemaPath)), contract_sha256: digest(readFileSync(contractPath)),
    seal_sha256: null, preflight: null, targets: planned.targets, receipt: null, artifact_hashes: [], aborted_at: null,
    created_at: now, updated_at: now,
  };
  writeStored(proposalDir, tx);
  return projectMergeTransaction(tx, proposalDir);
}

export function readMergeTransaction(proposalDir: string): MergeTransactionProjection {
  return projectMergeTransaction(readStored(proposalDir), proposalDir);
}

export function readMergeTransactionIfPresent(proposalDir: string): MergeTransactionProjection | null {
  return existsSync(transactionPath(proposalDir)) ? readMergeTransaction(proposalDir) : null;
}

export function submitMergeContent(
  proposalDir: string, slotId: string, submittedFilePath: string,
): MergeTransactionProjection {
  const tx = readStored(proposalDir);
  if (!['collecting', 'ready'].includes(tx.phase)) throw new MergeTransactionError('action_not_allowed', '当前 phase 禁止提交 content', false, projectMergeTransaction(tx, proposalDir));
  const target = tx.targets.find(item => item.slot_id === slotId && item.producer === 'agent');
  if (!target) throw new MergeTransactionError('slot_identity_mismatch', `未声明的 slot：${slotId}`, false, projectMergeTransaction(tx, proposalDir));
  const declared = stagingPath(proposalDir, tx, slotId);
  ensureContained(declared, proposalDir);
  const submitted = resolve(submittedFilePath);
  if (!existsSync(declared) || !existsSync(submitted)
    || !lstatSync(declared).isFile() || lstatSync(declared).isSymbolicLink()
    || !lstatSync(submitted).isFile() || lstatSync(submitted).isSymbolicLink()) {
    throw new MergeTransactionError('slot_identity_mismatch', '声明 staging_path 必须是现存普通文件且不得为符号链接', true, projectMergeTransaction(tx, proposalDir));
  }
  if (realpathSync(submitted) !== realpathSync(declared)) {
    throw new MergeTransactionError('slot_identity_mismatch', 'submit-content --file 必须与声明 staging_path 完全相同', true, projectMergeTransaction(tx, proposalDir));
  }
  const bytes = readFileSync(submitted);
  if (bytes.length === 0 || bytes.length > SLOT_LIMIT_BYTES) throw new MergeTransactionError('slot_identity_mismatch', 'content slot 为空或超过 20 MiB', true, projectMergeTransaction(tx, proposalDir));
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new MergeTransactionError('slot_identity_mismatch', 'content slot 不是合法 UTF-8', true, projectMergeTransaction(tx, proposalDir));
  if (/^##\s+(?:REMOVED-ITEMS|ADDED|MODIFIED|REMOVED)\b/m.test(text)) {
    throw new MergeTransactionError('slot_identity_mismatch', 'content slot 含 Delta 控制 marker', true, projectMergeTransaction(tx, proposalDir));
  }
  const path = slotPath(proposalDir, tx, slotId);
  ensureContained(path, proposalDir);
  atomicWrite(path, bytes);
  target.content_sha256 = digest(bytes);
  tx.phase = tx.targets.filter(item => item.producer === 'agent').every(item => item.content_sha256 !== null) ? 'ready' : 'collecting';
  tx.classification = null;
  tx.updated_at = new Date().toISOString();
  writeStored(proposalDir, tx);
  return projectMergeTransaction(tx, proposalDir);
}

function validateFrozenIdentity(root: string, proposalDir: string, tx: StoredTransaction): void {
  for (const target of tx.targets) {
    if (digest(readFileSync(join(proposalDir, ...target.delta_path.split('/')))) !== target.source_sha256) {
      throw new MergeTransactionError('source_hash_mismatch', `Delta 已漂移：${target.delta_path}`, false, projectMergeTransaction(tx, proposalDir));
    }
    if (currentHash(join(root, ...target.target_path.split('/'))) !== target.before_sha256) {
      throw new MergeTransactionError('before_hash_mismatch', `正式目标已漂移：${target.target_path}`, false, projectMergeTransaction(tx, proposalDir));
    }
  }
}

function parseDeltaSections(delta: string): Array<{ op: 'ADDED' | 'MODIFIED' | 'REMOVED'; title: string; body: string }> {
  const matches = [...delta.matchAll(/^## (ADDED|MODIFIED|REMOVED) — (.+)$/gm)];
  return matches.map((match, index) => ({
    op: match[1] as 'ADDED' | 'MODIFIED' | 'REMOVED', title: match[2].trim(),
    body: delta.slice((match.index ?? 0) + match[0].length).replace(/^\r?\n/, '').slice(0,
      index + 1 < matches.length ? (matches[index + 1].index ?? delta.length) - ((match.index ?? 0) + match[0].length) : undefined).trimEnd(),
  }));
}

function applyMarkdownDelta(before: string, delta: string, mode: 'CREATE' | 'MODIFY'): Buffer {
  const sections = parseDeltaSections(delta);
  if (sections.length === 0) throw new MergeTransactionError('slot_identity_mismatch', 'Markdown Delta 缺少控制段', true);
  let output = mode === 'CREATE' ? '' : before.replace(/\s+$/, '');
  for (const section of sections) {
    const heading = `## ${section.title}`;
    const replacement = `${heading}${section.body ? `\n\n${section.body}` : ''}`;
    const escaped = section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^## ${escaped}\\s*$[\\s\\S]*?(?=^#{1,2} |\\s*$)`, 'm');
    if (section.op === 'ADDED') {
      if (new RegExp(`^## ${escaped}\\s*$`, 'm').test(output)) throw new MergeTransactionError('slot_identity_mismatch', `ADDED 章节已存在：${section.title}`, true);
      output = `${output}${output ? '\n\n' : ''}${replacement}`;
    } else if (section.op === 'MODIFIED') {
      if (!re.test(output)) throw new MergeTransactionError('slot_identity_mismatch', `MODIFIED 章节不存在：${section.title}`, true);
      output = output.replace(re, replacement);
    } else {
      if (!re.test(output)) throw new MergeTransactionError('slot_identity_mismatch', `REMOVED 章节不存在：${section.title}`, true);
      output = output.replace(re, '').replace(/\n{3,}/g, '\n\n').trimEnd();
    }
  }
  return Buffer.from(`${output}\n`, 'utf8');
}

function coreContent(root: string, proposalDir: string, target: StoredTarget): Buffer {
  const delta = readFileSync(join(proposalDir, ...target.delta_path.split('/')));
  const targetAbs = join(root, ...target.target_path.split('/'));
  if (/\.(?:html|css|svg)$/i.test(target.target_path)) return Buffer.from(delta);
  if (target.target_path.endsWith('.md')) {
    return applyMarkdownDelta(target.mode === 'MODIFY' ? readFileSync(targetAbs, 'utf8') : '', delta.toString('utf8'), target.mode);
  }
  const checked = validateAndStripNonMarkdownDelta(delta.toString('utf8'), target.mode, target.target_path, { root });
  if (!checked.ok || checked.payload === undefined) throw new MergeTransactionError('slot_identity_mismatch', checked.message ?? 'non-Markdown Delta 无效', true);
  return Buffer.from(checked.payload, 'utf8');
}

function contentFor(root: string, proposalDir: string, tx: StoredTransaction, target: StoredTarget): Buffer {
  if (target.producer === 'openlogos') return coreContent(root, proposalDir, target);
  const path = slotPath(proposalDir, tx, target.slot_id);
  ensureContained(path, proposalDir);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) throw new MergeTransactionError('content_slot_missing', `缺少 slot：${target.slot_id}`, true, projectMergeTransaction(tx, proposalDir));
  const bytes = readFileSync(path);
  if (digest(bytes) !== target.content_sha256) throw new MergeTransactionError('slot_identity_mismatch', `slot hash 漂移：${target.slot_id}`, true, projectMergeTransaction(tx, proposalDir));
  return bytes;
}

function validateAgentSemantics(root: string, proposalDir: string, target: StoredTarget, finalBytes: Buffer): void {
  const delta = readFileSync(join(proposalDir, ...target.delta_path.split('/')), 'utf8');
  const final = finalBytes.toString('utf8');
  const before = target.mode === 'MODIFY' ? readFileSync(join(root, ...target.target_path.split('/')), 'utf8') : '';
  for (const section of parseDeltaSections(delta)) {
    const escaped = section.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const heading = new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'm');
    if (section.op === 'ADDED' && (!heading.test(final) || heading.test(before))) {
      throw new MergeTransactionError('slot_identity_mismatch', `ADDED 章节没有形成唯一新增结果：${section.title}`, true);
    }
    if (section.op === 'MODIFIED' && (!heading.test(final) || !heading.test(before))) {
      throw new MergeTransactionError('slot_identity_mismatch', `MODIFIED 章节身份不守恒：${section.title}`, true);
    }
    if (section.op === 'REMOVED' && heading.test(final)) {
      throw new MergeTransactionError('slot_identity_mismatch', `REMOVED 章节仍存在：${section.title}`, true);
    }
  }
}

interface PreparedMergeClosure {
  preflight: MergePreflightView;
  targetBytes: Map<string, Buffer>;
  metadata: Buffer | null;
  testChangeSet: TestChangeSetV1;
}

class MergePreflightBuildError extends Error {
  constructor(public readonly fact: MergePreflightErrorFact, message: string) {
    super(message);
    this.name = 'MergePreflightBuildError';
  }
}

function producerForPaths(tx: StoredTransaction, targetPaths: string[]): MergePreflightErrorFact['producer'] {
  if (targetPaths.length === 0) return 'unknown';
  const producers = new Set<'agent' | 'openlogos'>();
  for (const path of targetPaths) {
    const matches = tx.targets.filter(target => target.target_path === path);
    if (matches.length !== 1) return 'unknown';
    producers.add(matches[0].producer);
  }
  if (producers.size !== 1) return 'mixed';
  return [...producers][0];
}

/**
 * 结构化 target path 到可修复 slot 的唯一映射。返回 null 表示 mixed/OpenLogos/unknown，
 * 调用方必须整体 fail-closed；错误 message 不参与输入。
 */
export function attributeMergePreflightError(
  targets: ReadonlyArray<Pick<StoredTarget, 'slot_id' | 'target_path' | 'producer'>>,
  fact: MergePreflightErrorFact,
): string[] | null {
  if (!fact.retryable || fact.producer !== 'agent' || fact.target_paths.length === 0) return null;
  const slots: string[] = [];
  for (const path of sortedUnique(fact.target_paths)) {
    const matches = targets.filter(target => target.target_path === path);
    if (matches.length !== 1 || matches[0].producer !== 'agent') return null;
    slots.push(matches[0].slot_id);
  }
  return sortedUnique(slots);
}

function structuredPreflightError(tx: StoredTransaction, error: unknown): MergePreflightBuildError {
  if (error instanceof MergePreflightBuildError) return error;
  if (error instanceof TestChangeSetBuildError) {
    const producer = producerForPaths(tx, error.targetPaths);
    return new MergePreflightBuildError({
      code: error.code,
      target_paths: sortedUnique(error.targetPaths),
      producer,
      retryable: error.retryable && producer === 'agent',
    }, error.message);
  }
  return new MergePreflightBuildError({
    code: 'merge-preflight-internal',
    target_paths: [],
    producer: 'unknown',
    retryable: false,
  }, error instanceof Error ? error.message : String(error));
}

function computeSealSha256(tx: StoredTransaction, hashes: Array<{ slot_id: string; content_sha256: string }>, preflight?: MergePreflightView | null): string {
  return digest(canonical({
    transaction_id: tx.transaction_id,
    target_set_sha256: tx.target_set_sha256,
    hashes,
    ...(preflight ? { preflight_sha256: preflight.sha256 } : {}),
  }));
}

/** 纯只读构建；调用方只有在完整成功后才可写 transaction phase。 */
function buildMergePreflight(root: string, proposalDir: string, tx: StoredTransaction): PreparedMergeClosure {
  const targetBytes = new Map<string, Buffer>();
  const targets: MergePreflightTarget[] = [];
  const tests: TestChangeSetInputTarget[] = [];
  try {
    for (const target of tx.targets) {
      let bytes: Buffer;
      try {
        bytes = contentFor(root, proposalDir, tx, target);
        if (target.producer === 'agent') validateAgentSemantics(root, proposalDir, target, bytes);
      } catch (error) {
        const source = error instanceof Error ? error.message : String(error);
        throw new MergePreflightBuildError({
          code: error instanceof MergeTransactionError ? error.classification : 'merge-preflight-content-invalid',
          target_paths: [target.target_path],
          producer: target.producer,
          retryable: target.producer === 'agent',
        }, source);
      }
      targetBytes.set(target.target_path, bytes);
      targets.push({
        path: target.target_path,
        mode: target.mode,
        producer: target.producer,
        before_sha256: target.before_sha256,
        final_sha256: digest(bytes),
      });
      if (target.category === 'test' || target.target_path.startsWith('logos/resources/test/')) tests.push({
        targetPath: target.target_path,
        beforeBytes: target.mode === 'MODIFY' ? readFileSync(join(root, ...target.target_path.split('/'))) : null,
        afterBytes: bytes,
      });
    }
    const metadata = metadataBytes(root, tx);
    if (metadata) {
      const metadataPath = 'logos/logos-project.yaml';
      targets.push({
        path: metadataPath,
        mode: 'MODIFY',
        producer: 'openlogos',
        before_sha256: digest(readFileSync(join(root, ...metadataPath.split('/')))),
        final_sha256: digest(metadata),
      });
    }
    const testChangeSet = buildTestChangeSet({ change: tx.slug, module: tx.module, targets: tests });
    const sortedTargets = [...targets].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const base: Omit<MergePreflightView, 'sha256'> = {
      schema: MERGE_PREFLIGHT_SCHEMA,
      transaction_id: tx.transaction_id,
      plan_sha256: tx.plan_sha256,
      target_set_sha256: tx.target_set_sha256,
      targets: sortedTargets,
      test_change_set_sha256: testChangeSet.sha256,
      final_target_paths: sortedUnique(sortedTargets.map(target => target.path)),
    };
    return {
      preflight: { ...base, sha256: digest(canonical(base)) },
      targetBytes,
      metadata,
      testChangeSet,
    };
  } catch (error) {
    throw structuredPreflightError(tx, error);
  }
}

function hasApplyArtifacts(proposalDir: string): boolean {
  return [
    'MERGE_RECEIPT.json', 'SPEC_MERGED', BASELINE_CLOSURE_APPLY_JOURNAL,
    `${BASELINE_CLOSURE_APPLY_JOURNAL}.tmp`, '.baseline-closure-apply-txn',
  ].some(path => existsSync(join(proposalDir, path)));
}

function reopenForPreflightError(
  proposalDir: string,
  tx: StoredTransaction,
  error: MergePreflightBuildError,
): never {
  const fact = error.fact;
  const rejectedSlots = attributeMergePreflightError(tx.targets, fact);
  if (!rejectedSlots || !['ready', 'sealed'].includes(tx.phase) || hasApplyArtifacts(proposalDir)) {
    throw new MergeTransactionError('internal_failure', error.message, false, projectMergeTransaction(tx, proposalDir));
  }
  const rejectedTargets = rejectedSlots.map(slot => tx.targets.find(target => target.slot_id === slot)!);
  const faultAt = process.env.NODE_ENV === 'test' ? process.env.OPENLOGOS_TEST_MERGE_REOPEN_FAIL_AT : undefined;
  if (faultAt === 'before-rename') {
    throw new MergeTransactionError('internal_failure', 'test fault before reopen rename', true, projectMergeTransaction(tx, proposalDir));
  }
  tx.phase = 'collecting';
  tx.classification = 'slot_identity_mismatch';
  tx.seal_sha256 = null;
  tx.preflight = null;
  tx.preflight = null;
  for (const target of tx.targets) target.sealed_sha256 = null;
  for (const target of rejectedTargets) target.content_sha256 = null;
  tx.updated_at = new Date().toISOString();
  writeStored(proposalDir, tx);
  if (faultAt === 'after-rename') {
    throw new MergeTransactionError('slot_identity_mismatch', 'test fault after reopen rename', true, projectMergeTransaction(tx, proposalDir));
  }
  for (const target of rejectedTargets) {
    try { rmSync(slotPath(proposalDir, tx, target.slot_id), { force: true }); } catch { /* 状态已提交，清理尽力而为。 */ }
    try { rmSync(dirname(stagingPath(proposalDir, tx, target.slot_id)), { recursive: true, force: true }); } catch { /* 同上。 */ }
    if (faultAt === 'during-cleanup') {
      throw new MergeTransactionError('slot_identity_mismatch', 'test fault during reopen cleanup', true, projectMergeTransaction(tx, proposalDir));
    }
  }
  throw new MergeTransactionError(
    'slot_identity_mismatch', error.message, true, projectMergeTransaction(tx, proposalDir),
  );
}

export function sealMergeTransaction(root: string, proposalDir: string): MergeTransactionProjection {
  const tx = readStored(proposalDir);
  if (tx.phase === 'sealed' || tx.phase === 'completed') return projectMergeTransaction(tx, proposalDir);
  if (tx.phase !== 'ready') throw new MergeTransactionError('content_slot_missing', 'content slot 尚未齐备', true, projectMergeTransaction(tx, proposalDir));
  validateFrozenIdentity(root, proposalDir, tx);
  let prepared: PreparedMergeClosure;
  try { prepared = buildMergePreflight(root, proposalDir, tx); } catch (error) {
    return reopenForPreflightError(proposalDir, tx, structuredPreflightError(tx, error));
  }
  const hashes = tx.targets.map(target => {
    const hash = digest(prepared.targetBytes.get(target.target_path)!);
    target.content_sha256 = hash;
    target.sealed_sha256 = hash;
    return { slot_id: target.slot_id, content_sha256: hash };
  });
  tx.preflight = prepared.preflight;
  tx.seal_sha256 = computeSealSha256(tx, hashes, prepared.preflight);
  tx.phase = 'sealed';
  tx.classification = null;
  tx.updated_at = new Date().toISOString();
  writeStored(proposalDir, tx);
  return projectMergeTransaction(tx, proposalDir);
}

function metadataBytes(root: string, tx: StoredTransaction): Buffer | null {
  const created = tx.targets.filter(target => target.mode === 'CREATE');
  if (created.length === 0) return null;
  const path = join(root, 'logos', 'logos-project.yaml');
  const doc = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true, strict: true });
  const data = doc.toJS() as Record<string, unknown>;
  const index = Array.isArray(data.resource_index) ? data.resource_index as Array<Record<string, unknown>> : [];
  for (const target of created) {
    if (!index.some(item => item.path === target.target_path)) index.push({ path: target.target_path, desc: `${tx.slug} 创建的 ${target.category} 基线` });
  }
  data.resource_index = index;
  const decisions = created.map(target => /core-D(\d+)-/.exec(target.target_path)?.[1]).filter(Boolean).map(Number);
  if (decisions.length > 0) {
    const counter = (data.decision_counter && typeof data.decision_counter === 'object') ? data.decision_counter as Record<string, unknown> : {};
    counter.next_id = Math.max(Number(counter.next_id ?? 1), ...decisions.map(value => value + 1));
    data.decision_counter = counter;
  }
  const scenarios = created.map(target => /core-S(\d+)-/.exec(target.target_path)?.[1]).filter(Boolean).map(Number);
  if (scenarios.length > 0) {
    const counter = (data.scenario_counter && typeof data.scenario_counter === 'object') ? data.scenario_counter as Record<string, unknown> : {};
    counter.next_id = Math.max(Number(counter.next_id ?? 1), ...scenarios.map(value => value + 1));
    data.scenario_counter = counter;
  }
  return Buffer.from(stringify(data, { lineWidth: 0 }), 'utf8');
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function receiptFor(
  tx: StoredTransaction,
  closure: MergeTransactionPathHash[],
  testChangeSet: Record<string, unknown> | null,
  receiptPath: string,
  markerPath: string,
  completedAt: string,
): MergeTransactionReceipt {
  const targetModes = new Map(tx.targets.map(target => [target.target_path, target.mode]));
  const createdPaths = sortedUnique(closure.filter(item => targetModes.get(item.path) === 'CREATE').map(item => item.path));
  const changedPaths = sortedUnique(closure.filter(item => !createdPaths.includes(item.path)).map(item => item.path));
  const finalHashes = [...closure].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const metadataSummaries = finalHashes
    .filter(item => !targetModes.has(item.path))
    .map(item => ({ path: item.path, sha256: item.sha256 }));
  const base: Omit<MergeTransactionReceipt, 'receipt_sha256'> = {
    transaction_id: tx.transaction_id,
    seal_sha256: tx.seal_sha256!,
    target_set_sha256: tx.target_set_sha256,
    closure_sha256: digest(canonical(finalHashes)),
    target_count: tx.targets.length,
    plan_sha256: tx.plan_sha256,
    change: tx.slug,
    module: tx.module,
    changed_paths: changedPaths,
    created_paths: createdPaths,
    final_hashes: finalHashes,
    metadata_summaries: metadataSummaries,
    test_change_set: testChangeSet,
    spec_merged: { path: markerPath },
    commit_paths: sortedUnique([...finalHashes.map(item => item.path), receiptPath, markerPath]),
    completed_at: completedAt,
  };
  return { ...base, receipt_sha256: computeMergeReceiptSha256(base) };
}

function cleanupMergePrivateArtifacts(proposalDir: string, tx: StoredTransaction): void {
  for (const dir of [
    join(proposalDir, 'merge-content', tx.transaction_id),
    join(proposalDir, 'merge-staging', tx.transaction_id),
  ]) rmSync(dir, { recursive: true, force: true });
  rmSync(join(proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL), { force: true });
  rmSync(join(proposalDir, `${BASELINE_CLOSURE_APPLY_JOURNAL}.tmp`), { force: true });
  rmSync(join(proposalDir, '.baseline-closure-apply-txn'), { recursive: true, force: true });
}

export function abortMergeTransaction(proposalDir: string): MergeTransactionProjection {
  const tx = readStored(proposalDir);
  if (tx.phase === 'failed' && tx.classification === 'aborted') return projectMergeTransaction(tx, proposalDir);
  if (!['collecting', 'ready', 'sealed'].includes(tx.phase)) {
    throw new MergeTransactionError('action_not_allowed', `phase=${tx.phase} 禁止 abort`, false, projectMergeTransaction(tx, proposalDir));
  }
  if (existsSync(join(proposalDir, 'MERGE_RECEIPT.json')) || existsSync(join(proposalDir, 'SPEC_MERGED'))) {
    throw new MergeTransactionError('receipt_mismatch', 'abort 前发现正式 receipt/marker，拒绝破坏性清理', false, projectMergeTransaction(tx, proposalDir));
  }
  cleanupMergePrivateArtifacts(proposalDir, tx);
  const abortedAt = new Date().toISOString();
  tx.phase = 'failed';
  tx.classification = 'aborted';
  tx.seal_sha256 = null;
  tx.receipt = null;
  tx.artifact_hashes = [];
  tx.aborted_at = abortedAt;
  for (const target of tx.targets) {
    target.content_sha256 = null;
    target.sealed_sha256 = null;
  }
  tx.updated_at = abortedAt;
  const projection = projectMergeTransaction(tx, proposalDir);
  writeStored(proposalDir, tx);
  return projection;
}

export function applyMergeTransaction(root: string, proposalDir: string): MergeTransactionProjection {
  let tx = readStored(proposalDir);
  if (tx.phase === 'completed') return projectMergeTransaction(tx, proposalDir);
  if (tx.phase === 'applying') return recoverMergeTransaction(root, proposalDir);
  if (tx.phase !== 'sealed' || !tx.seal_sha256) throw new MergeTransactionError('action_not_allowed', 'transaction 尚未 sealed', false, projectMergeTransaction(tx, proposalDir));
  validateFrozenIdentity(root, proposalDir, tx);
  const sealedHashes = tx.targets.map(target => {
    const hash = digest(contentFor(root, proposalDir, tx, target));
    if (hash !== target.sealed_sha256) {
      throw new MergeTransactionError('seal_mismatch', `sealed content 漂移：${target.target_path}`, false, projectMergeTransaction(tx, proposalDir));
    }
    return { slot_id: target.slot_id, content_sha256: hash };
  });
  if (computeSealSha256(tx, sealedHashes, tx.preflight) !== tx.seal_sha256) {
    throw new MergeTransactionError('seal_mismatch', 'seal identity 漂移', false, projectMergeTransaction(tx, proposalDir));
  }
  let prepared: PreparedMergeClosure;
  try { prepared = buildMergePreflight(root, proposalDir, tx); } catch (error) {
    const structured = structuredPreflightError(tx, error);
    if (tx.preflight == null) return reopenForPreflightError(proposalDir, tx, structured);
    throw new MergeTransactionError('seal_mismatch', structured.message, false, projectMergeTransaction(tx, proposalDir));
  }
  if (tx.preflight && canonical(prepared.preflight) !== canonical(tx.preflight)) {
    throw new MergeTransactionError('seal_mismatch', 'sealed preflight identity 漂移', false, projectMergeTransaction(tx, proposalDir));
  }
  tx.phase = 'applying'; tx.updated_at = new Date().toISOString(); writeStored(proposalDir, tx);
  const inputs: BaselineClosureApplyInput[] = [];
  const closure: MergeTransactionPathHash[] = [];
  for (const target of tx.targets) {
    const bytes = prepared.targetBytes.get(target.target_path)!;
    inputs.push({ kind: 'prepared', targetPath: target.target_path, mode: target.mode, bytes });
    closure.push({ path: target.target_path, sha256: digest(bytes) });
  }
  const metadata = prepared.metadata;
  if (metadata) {
    inputs.push({ kind: 'prepared', targetPath: 'logos/logos-project.yaml', mode: 'MODIFY', bytes: metadata });
    closure.push({ path: 'logos/logos-project.yaml', sha256: digest(metadata) });
  }
  const testChangeSet = prepared.testChangeSet;
  const completedAt = new Date().toISOString();
  const receiptPath = relative(root, join(proposalDir, 'MERGE_RECEIPT.json')).replace(/\\/g, '/');
  const markerPath = relative(root, join(proposalDir, 'SPEC_MERGED')).replace(/\\/g, '/');
  const receipt = receiptFor(tx, closure, testChangeSet as unknown as Record<string, unknown>, receiptPath, markerPath, completedAt);
  const receiptBytes = Buffer.from(`${JSON.stringify({ schema: MERGE_TRANSACTION_SCHEMA, ...receipt }, null, 2)}\n`);
  const markerBytes = Buffer.from(`${JSON.stringify({
    type: 'merge_transaction_complete', transaction_id: tx.transaction_id, seal_sha256: tx.seal_sha256,
    receipt_sha256: receipt.receipt_sha256, completed_at: completedAt, test_change_set: testChangeSet,
  }, null, 2)}\n`);
  inputs.push({ kind: 'prepared', targetPath: receiptPath, mode: 'CREATE', bytes: receiptBytes });
  inputs.push({ kind: 'prepared', targetPath: markerPath, mode: 'CREATE', bytes: markerBytes });
  const failAfter = process.env.NODE_ENV === 'test' ? process.env.OPENLOGOS_TEST_MERGE_TX_FAIL_AFTER : undefined;
  const result = applyBaselineClosureBatch(root, proposalDir, inputs, {
    afterWrite(path) { if (failAfter === path) throw new Error(`test fault after ${path}`); },
    validateCommitted() { if (failAfter === 'post-read') throw new Error('test fault at post-read'); },
  });
  if (!result.ok) {
    tx = readStored(proposalDir); tx.phase = 'sealed'; tx.classification = 'apply_conflict'; tx.updated_at = new Date().toISOString(); writeStored(proposalDir, tx);
    throw new MergeTransactionError('apply_conflict', result.error, true, projectMergeTransaction(tx, proposalDir));
  }
  const artifactHashes = [receiptPath, markerPath]
    .sort()
    .map(path => ({ path, sha256: digest(readFileSync(join(root, ...path.split('/')))) }));
  tx = readStored(proposalDir);
  tx.phase = 'completed';
  tx.classification = null;
  tx.receipt = receipt;
  tx.artifact_hashes = artifactHashes;
  tx.aborted_at = null;
  tx.updated_at = completedAt;
  const projection = projectMergeTransaction(tx, proposalDir);
  writeStored(proposalDir, tx);
  cleanupMergePrivateArtifacts(proposalDir, tx);
  return projection;
}

export function recoverMergeTransaction(root: string, proposalDir: string): MergeTransactionProjection {
  const tx = readStored(proposalDir);
  if (tx.phase === 'completed') return projectMergeTransaction(tx, proposalDir);
  const markerPath = join(proposalDir, 'SPEC_MERGED');
  const receiptPath = join(proposalDir, 'MERGE_RECEIPT.json');
  if (existsSync(markerPath) && existsSync(receiptPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
      const envelope = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
      const { schema, ...receiptPayload } = envelope;
      if (schema !== MERGE_TRANSACTION_SCHEMA) throw new Error('receipt schema mismatch');
      const stored = receiptPayload as unknown as MergeTransactionReceipt;
      if (marker.transaction_id !== tx.transaction_id || stored.transaction_id !== tx.transaction_id
        || marker.receipt_sha256 !== stored.receipt_sha256
        || computeMergeReceiptSha256(stored) !== stored.receipt_sha256) throw new Error('identity mismatch');

      const finalPaths = stored.final_hashes.map(item => item.path);
      const payloadPaths = sortedUnique([...stored.changed_paths, ...stored.created_paths]);
      if (new Set(finalPaths).size !== finalPaths.length
        || canonical(sortedUnique(finalPaths)) !== canonical(payloadPaths)) throw new Error('receipt payload mismatch');
      const normalizedFinalHashes = [...stored.final_hashes]
        .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      const normalizedMetadata = [...stored.metadata_summaries]
        .sort((a, b) => String(a.path) < String(b.path) ? -1 : String(a.path) > String(b.path) ? 1 : 0);
      const { receipt_sha256: _oldReceiptSha256, ...storedBase } = stored;
      const normalizedBase: Omit<MergeTransactionReceipt, 'receipt_sha256'> = {
        ...storedBase,
        closure_sha256: digest(canonical(normalizedFinalHashes)),
        final_hashes: normalizedFinalHashes,
        metadata_summaries: normalizedMetadata,
      };
      const normalizedReceipt: MergeTransactionReceipt = {
        ...normalizedBase,
        receipt_sha256: computeMergeReceiptSha256(normalizedBase),
      };
      const normalizedMarker = { ...marker, receipt_sha256: normalizedReceipt.receipt_sha256 };
      const normalizedReceiptBytes = Buffer.from(`${JSON.stringify({ schema: MERGE_TRANSACTION_SCHEMA, ...normalizedReceipt }, null, 2)}\n`);
      const normalizedMarkerBytes = Buffer.from(`${JSON.stringify(normalizedMarker, null, 2)}\n`);
      const receiptRelative = relative(root, receiptPath).replace(/\\/g, '/');
      const markerRelative = relative(root, markerPath).replace(/\\/g, '/');
      const artifactHashes = [
        { path: receiptRelative, sha256: digest(normalizedReceiptBytes) },
        { path: markerRelative, sha256: digest(normalizedMarkerBytes) },
      ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      tx.phase = 'completed';
      tx.classification = null;
      tx.receipt = normalizedReceipt;
      tx.artifact_hashes = artifactHashes;
      tx.aborted_at = null;
      tx.updated_at = normalizedReceipt.completed_at;
      const projection = projectMergeTransaction(tx, proposalDir);
      if (!readFileSync(receiptPath).equals(normalizedReceiptBytes)
        || !readFileSync(markerPath).equals(normalizedMarkerBytes)) {
        const repaired = applyBaselineClosureBatch(root, proposalDir, [
          { kind: 'prepared', targetPath: receiptRelative, mode: 'MODIFY', bytes: normalizedReceiptBytes },
          { kind: 'prepared', targetPath: markerRelative, mode: 'MODIFY', bytes: normalizedMarkerBytes },
        ]);
        if (!repaired.ok) throw new Error(`receipt normalization failed: ${repaired.error}`);
      }
      writeStored(proposalDir, tx);
      cleanupMergePrivateArtifacts(proposalDir, tx);
      return projection;
    } catch { throw new MergeTransactionError('receipt_mismatch', 'completed receipt 与 marker 不一致', false, projectMergeTransaction(tx, proposalDir)); }
  }
  const recovered = recoverBaselineClosureApply(root, proposalDir);
  if (!recovered.ok) {
    tx.phase = 'failed'; tx.classification = 'recovery_required'; tx.updated_at = new Date().toISOString(); writeStored(proposalDir, tx);
    throw new MergeTransactionError('recovery_required', recovered.error, true, projectMergeTransaction(tx, proposalDir));
  }
  tx.phase = 'sealed'; tx.classification = null; tx.updated_at = new Date().toISOString(); writeStored(proposalDir, tx);
  return projectMergeTransaction(tx, proposalDir);
}

export function removeSubmittedContent(proposalDir: string, slotId: string): void {
  const tx = readStored(proposalDir);
  const path = slotPath(proposalDir, tx, slotId);
  if (existsSync(path)) unlinkSync(path);
}
