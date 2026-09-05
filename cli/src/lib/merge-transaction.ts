import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify } from 'yaml';
import { VERSION } from './json-output.js';
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
import {
  composeOpenLogosMarkdown,
  verifyAgentMaterialOutcome,
} from './markdown-section-authority.js';
import { SPEC_MERGED_MARKER } from './proposal-markers.js';

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
export type MergeTransactionAction = 'submit_content' | 'seal' | 'apply' | 'recover' | 'abort' | 'reopen';
export type MergeTransactionClassification =
  | 'invalid_phase' | 'action_not_allowed' | 'content_slot_missing' | 'slot_identity_mismatch'
  | 'source_hash_mismatch' | 'before_hash_mismatch' | 'target_set_mismatch' | 'seal_mismatch'
  | 'apply_conflict' | 'receipt_mismatch' | 'legacy_manifest_rejected' | 'unsupported_contract'
  | 'recovery_required' | 'internal_failure' | 'aborted'
  | 'reopen_reason_required' | 'reopen_confirm_required';

export const MERGE_TRANSACTION_ACTION_COMMANDS: Readonly<Record<MergeTransactionAction, string>> = Object.freeze({
  submit_content: 'submit-content',
  seal: 'seal',
  apply: 'apply',
  recover: 'recover',
  abort: 'abort',
  reopen: 'reopen',
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

/**
 * 项目根定位：**按标记上溯**，不按固定深度。
 *
 * 旧实现是 `resolve(proposalDir, '../../..')`，隐含「提案目录恒为
 * `<root>/logos/changes/<slug>`」这一位置假设。归档提案位于
 * `<root>/logos/changes/archive/<时间戳>-<slug>`（深一层），固定深度上溯会把
 * `<root>/logos` 当成项目根，使 `staging_path` 等 project-relative 路径丢掉 `logos/` 前缀。
 *
 * 位置性猜测与内容性猜测同属影子源（架构 §三十九.1）：以 `logos/logos.config.json`
 * 这个真实标记为准，深度多少都不影响。找不到标记时退回旧行为，保证既有夹具零回归。
 */
function projectRoot(proposalDir: string): string {
  let current = resolve(proposalDir);
  for (let depth = 0; depth < 16; depth++) {
    if (existsSync(join(current, 'logos', 'logos.config.json'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
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

/**
 * 存量事务合同兼容门（fix-merge-flow-transaction-contract，D10 不变量③）：
 * 事务内记录的 schema/contract 摘要与当前 CLI 不一致时，一律 fail-closed 拒绝写动作；
 * status 只读投影不受限；abort 不拦——它正是 remediation 出路（abort 后重跑 merge 重开事务）。
 * 永不承诺就地迁移。
 */
function assertContractCompatible(tx: StoredTransaction, proposalDir: string): void {
  const currentSchema = digest(readFileSync(bundledContractPath(MERGE_TRANSACTION_SCHEMA_PATH)));
  const currentContract = digest(readFileSync(bundledContractPath(CONTRACT_PATH)));
  if (tx.schema_sha256 === currentSchema && tx.contract_sha256 === currentContract) return;
  throw new MergeTransactionError('unsupported_contract',
    `存量事务合同与当前 CLI 不一致（不支持就地迁移）：事务记录 schema=${tx.schema_sha256}、contract=${tx.contract_sha256}；`
    + `当前 CLI ${VERSION} schema=${currentSchema}、contract=${currentContract}。`
    + '处置：openlogos merge transaction abort 后重跑 openlogos merge <slug> 重开事务',
    false, projectMergeTransaction(tx, proposalDir));
}

function writeStored(proposalDir: string, tx: StoredTransaction): void {
  atomicWrite(transactionPath(proposalDir), `${JSON.stringify(tx, null, 2)}\n`);
}

function allowed(tx: StoredTransaction): MergeTransactionAction[] {
  if (tx.phase === 'collecting') return ['submit_content', 'abort'];
  if (tx.phase === 'ready') return ['seal', 'abort'];
  if (tx.phase === 'sealed') return ['apply', 'abort'];
  if (tx.phase === 'applying') return ['recover'];
  // 终态出路（0.14.17，功能规格 §2.58）：fatal failed 可 abort 后经归档让位重建；
  // completed 携带受控 reopen 出边（提案内二次 merge 通道）。终态不再是死局。
  if (tx.phase === 'failed') return tx.classification === 'recovery_required' ? ['recover'] : ['abort'];
  if (tx.phase === 'completed') return ['reopen'];
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

export const MERGE_REOPENS_FILE = 'MERGE_REOPENS.jsonl';

/**
 * 终态事务让位前先归档（§2.58.1，对齐切片侧 archiveTerminalTransaction）：
 * 「可归档历史」是字面意思——不占活跃名额，但 receipt 与哈希不销毁、仅供审计。
 */
function archiveMergeTerminalTransaction(proposalDir: string, transactionId: string): void {
  const source = transactionPath(proposalDir);
  if (!existsSync(source)) return;
  const dir = join(proposalDir, 'merge-transactions');
  mkdirSync(dir, { recursive: true });
  renameSync(source, join(dir, `${transactionId}.json`));
  const receipt = join(proposalDir, 'MERGE_RECEIPT.json');
  if (existsSync(receipt)) renameSync(receipt, join(dir, `${transactionId}.receipt.json`));
}

/**
 * completed 受控重开（0.14.17，功能规格 §2.58.3，架构 §四十五）：提案内二次 merge 通道。
 * 先行全量校验（零副作用的失败面），再按序执行「留痕 → 归档旧事务与 receipt →
 * （确认路径）作废 SPEC_MERGED → 按当前 delta 重新规划新 collecting 事务」；
 * 任一步失败回退已做步骤，整体不生效。下游产物不级联删除（指纹自然传导，C01）。
 */
export function reopenMergeTransaction(
  root: string, proposalDir: string, slug: string,
  options: { reason: string; confirmSpecMerged?: boolean },
): MergeTransactionProjection {
  const tx = readStored(proposalDir);
  assertContractCompatible(tx, proposalDir);
  if (tx.phase !== 'completed') {
    throw new MergeTransactionError('action_not_allowed',
      `phase=${tx.phase} 禁止 reopen（仅 completed 携带受控重开出边）`, false, projectMergeTransaction(tx, proposalDir));
  }
  const reason = (options.reason ?? '').trim();
  if (reason === '') {
    throw new MergeTransactionError('reopen_reason_required',
      'reopen 需要非空 --reason "<原因>"——留痕是二次 merge 的前置条件，不接受无原因重开', false,
      projectMergeTransaction(tx, proposalDir));
  }
  const markerPath = join(proposalDir, SPEC_MERGED_MARKER);
  let specMergedPresent = false;
  let markerBytes: Buffer | null = null;
  try {
    specMergedPresent = existsSync(markerPath);
    if (specMergedPresent) markerBytes = readFileSync(markerPath);
  } catch (error) {
    // marker 状态不可判定 → fail-closed，无任何写副作用（AC-MTXOUT-03）。
    throw new MergeTransactionError('internal_failure',
      `SPEC_MERGED 状态不可判定，拒绝重开：${error instanceof Error ? error.message : String(error)}`, false);
  }
  const confirmed = options.confirmSpecMerged === true;
  if (specMergedPresent && !confirmed) {
    throw new MergeTransactionError('reopen_confirm_required',
      '规格已合并（SPEC_MERGED 在场）。确认要作废已合并事实并重合并，请附 --confirm-spec-merged 重试；'
      + '重开将作废 SPEC_MERGED，下游产物经指纹失配自然收敛、不被级联删除', false,
      projectMergeTransaction(tx, proposalDir));
  }

  // ── 校验全部通过，按序执行；失败回退到全旧 ──
  const auditPath = join(proposalDir, MERGE_REOPENS_FILE);
  const auditBefore = existsSync(auditPath) ? readFileSync(auditPath) : null;
  const auditLine = `${JSON.stringify({
    schema: 'openlogos/merge-reopen@1',
    old_transaction_id: tx.transaction_id,
    reopened_at: new Date().toISOString(),
    reason,
    spec_merged_present: specMergedPresent,
    confirmed,
  })}\n`;
  const archivedTxPath = join(proposalDir, 'merge-transactions', `${tx.transaction_id}.json`);
  const archivedReceiptPath = join(proposalDir, 'merge-transactions', `${tx.transaction_id}.receipt.json`);
  const receiptPath = join(proposalDir, 'MERGE_RECEIPT.json');
  let auditWritten = false;
  let archived = false;
  let markerRemoved = false;
  try {
    writeFileSync(auditPath, auditBefore === null ? auditLine : Buffer.concat([auditBefore, Buffer.from(auditLine)]));
    auditWritten = true;
    archiveMergeTerminalTransaction(proposalDir, tx.transaction_id);
    archived = true;
    if (specMergedPresent && confirmed) {
      rmSync(markerPath, { force: true });
      markerRemoved = true;
    }
    return createMergeTransaction(root, proposalDir, slug);
  } catch (error) {
    // 整体不生效：逐步回退已做步骤，保持全旧态。
    try { if (markerRemoved && markerBytes !== null) writeFileSync(markerPath, markerBytes); } catch { /* 保守保留诊断 */ }
    try {
      if (archived) {
        renameSync(archivedTxPath, transactionPath(proposalDir));
        if (existsSync(archivedReceiptPath)) renameSync(archivedReceiptPath, receiptPath);
      }
    } catch { /* 保守保留诊断 */ }
    try {
      if (auditWritten) {
        if (auditBefore === null) rmSync(auditPath, { force: true });
        else writeFileSync(auditPath, auditBefore);
      }
    } catch { /* 保守保留诊断 */ }
    throw error;
  }
}

export function createMergeTransaction(root: string, proposalDir: string, slug: string): MergeTransactionProjection {
  if (existsSync(transactionPath(proposalDir))) {
    const existing = readStored(proposalDir);
    if (existing.phase === 'completed') {
      // §2.58.1：completed 受保护——已合并事实不得被静默重建，唯一入口是显式 reopen。
      throw new MergeTransactionError('action_not_allowed',
        'completed 合并事务在场：已合并事实不得被静默重建。若需提案内二次 merge，请执行 '
        + 'openlogos merge transaction reopen --reason "<原因>"（SPEC_MERGED 在场须附 --confirm-spec-merged）',
        false, projectMergeTransaction(existing, proposalDir));
    }
    if (existing.phase === 'failed') {
      // §2.58.1：终态（含 aborted / fatal 分类）不占活跃名额——归档让位后按当前 delta 重新规划。
      archiveMergeTerminalTransaction(proposalDir, existing.transaction_id);
    } else {
      return projectMergeTransaction(existing, proposalDir);
    }
  }
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
  assertContractCompatible(tx, proposalDir);
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

function coreContent(root: string, proposalDir: string, target: StoredTarget): Buffer {
  const delta = readFileSync(join(proposalDir, ...target.delta_path.split('/')));
  const targetAbs = join(root, ...target.target_path.split('/'));
  if (/\.(?:html|css|svg)$/i.test(target.target_path)) return Buffer.from(delta);
  if (target.target_path.endsWith('.md')) {
    try {
      return Buffer.from(composeOpenLogosMarkdown(
        target.mode === 'MODIFY' ? readFileSync(targetAbs, 'utf8') : '',
        delta.toString('utf8'),
        target.mode,
      ), 'utf8');
    } catch (error) {
      throw new MergeTransactionError(
        'slot_identity_mismatch',
        error instanceof Error ? error.message : String(error),
        true,
      );
    }
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

function verifyAgentContent(root: string, proposalDir: string, target: StoredTarget, finalBytes: Buffer): void {
  const delta = readFileSync(join(proposalDir, ...target.delta_path.split('/')), 'utf8');
  const final = finalBytes.toString('utf8');
  const before = target.mode === 'MODIFY' ? readFileSync(join(root, ...target.target_path.split('/')), 'utf8') : '';
  const result = verifyAgentMaterialOutcome(delta, before, final);
  if (!result.ok) {
    throw new MergeTransactionError('slot_identity_mismatch', result.error ?? 'Agent content 未通过共享章节权威验证', true);
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
        if (target.producer === 'agent') verifyAgentContent(root, proposalDir, target, bytes);
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
    'MERGE_RECEIPT.json', SPEC_MERGED_MARKER, BASELINE_CLOSURE_APPLY_JOURNAL,
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
  assertContractCompatible(tx, proposalDir);
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
  // 终态出路（§2.58.2）：fatal failed（非 recovery_required）允许 abort 转 aborted，
  // 随后由 createMergeTransaction 的归档让位路径重建；recovery_required 仍走 recover。
  const fatalFailed = tx.phase === 'failed' && tx.classification !== 'recovery_required';
  if (!['collecting', 'ready', 'sealed'].includes(tx.phase) && !fatalFailed) {
    throw new MergeTransactionError('action_not_allowed', `phase=${tx.phase} 禁止 abort`, false, projectMergeTransaction(tx, proposalDir));
  }
  if (existsSync(join(proposalDir, 'MERGE_RECEIPT.json')) || existsSync(join(proposalDir, SPEC_MERGED_MARKER))) {
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
  assertContractCompatible(tx, proposalDir);
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
  const markerPath = relative(root, join(proposalDir, SPEC_MERGED_MARKER)).replace(/\\/g, '/');
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
  const markerPath = join(proposalDir, SPEC_MERGED_MARKER);
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
      const { receipt_sha256: oldReceiptSha256, ...storedBase } = stored;
      void oldReceiptSha256;
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
