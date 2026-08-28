import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { parseDocument, stringify } from 'yaml';
import {
  parseBaselineClosurePlan, validateAndStripNonMarkdownDelta,
  type BaselineClosureTarget,
} from './baseline-closure.js';
import {
  applyBaselineClosureBatch, recoverBaselineClosureApply,
  type BaselineClosureApplyInput,
} from './baseline-apply.js';
import { buildTestChangeSet, type TestChangeSetInputTarget } from './test-change-set.js';

export const MERGE_TRANSACTION_SCHEMA = 'openlogos/merge-transaction@1' as const;
export const MERGE_TRANSACTION_FILE = 'MERGE_TRANSACTION.json';
export const MERGE_TRANSACTION_SCHEMA_PATH = 'spec/schema/merge-transaction.schema.json';
const CONTRACT_PATH = 'spec/cli-json-output.md';
const SLOT_LIMIT_BYTES = 20 * 1024 * 1024;

export type MergeTransactionPhase = 'collecting' | 'ready' | 'sealed' | 'applying' | 'completed' | 'failed';
export type MergeTransactionAction = 'submit_content' | 'seal' | 'apply' | 'recover' | 'abort';
export type MergeTransactionClassification =
  | 'invalid_phase' | 'action_not_allowed' | 'content_slot_missing' | 'slot_identity_mismatch'
  | 'source_hash_mismatch' | 'before_hash_mismatch' | 'target_set_mismatch' | 'seal_mismatch'
  | 'apply_conflict' | 'receipt_mismatch' | 'legacy_manifest_rejected' | 'unsupported_contract'
  | 'recovery_required' | 'internal_failure';

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

export interface MergeTransactionReceipt {
  transaction_id: string;
  seal_sha256: string;
  target_set_sha256: string;
  closure_sha256: string;
  receipt_sha256: string;
  target_count: number;
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
  targets: StoredTarget[];
  receipt: MergeTransactionReceipt | null;
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
  content_slots: { required: number; submitted: number; missing_slot_ids: string[] };
  targets: Array<Pick<StoredTarget, 'slot_id' | 'delta_path' | 'target_path' | 'mode' | 'source_sha256' | 'before_sha256' | 'content_sha256'>>;
  receipt: MergeTransactionReceipt | null;
  created_at: string;
  updated_at: string;
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
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
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
  if (tx.phase === 'failed') return tx.classification === 'recovery_required' ? ['recover'] : ['abort'];
  return [];
}

export function projectMergeTransaction(tx: StoredTransaction): MergeTransactionProjection {
  const agentTargets = tx.targets.filter(target => target.producer === 'agent');
  const missing = agentTargets.filter(target => target.content_sha256 === null).map(target => target.slot_id);
  const actions = allowed(tx);
  return {
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
    content_slots: { required: agentTargets.length, submitted: agentTargets.length - missing.length, missing_slot_ids: missing },
    targets: tx.targets.map(({ slot_id, delta_path, target_path, mode, source_sha256, before_sha256, content_sha256 }) => ({
      slot_id, delta_path, target_path, mode, source_sha256, before_sha256, content_sha256,
    })),
    receipt: tx.receipt,
    created_at: tx.created_at,
    updated_at: tx.updated_at,
  };
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
  if (existsSync(transactionPath(proposalDir))) return projectMergeTransaction(readStored(proposalDir));
  const planned = planTargets(root, proposalDir, slug);
  const targetSet = digest(canonical(planned.targets.map(({ content_sha256: _c, sealed_sha256: _s, ...target }) => target)));
  const id = `mtx_${plainHash(digest(`${planned.planHash}:${targetSet}`)).slice(0, 24)}`;
  const now = new Date().toISOString();
  const schemaPath = join(root, ...MERGE_TRANSACTION_SCHEMA_PATH.split('/'));
  const contractPath = join(root, ...CONTRACT_PATH.split('/'));
  const tx: StoredTransaction = {
    schema: MERGE_TRANSACTION_SCHEMA, transaction_id: id, slug, module: planned.module,
    phase: planned.targets.some(target => target.producer === 'agent') ? 'collecting' : 'ready', classification: null,
    plan_sha256: planned.planHash, target_set_sha256: targetSet,
    schema_sha256: digest(readFileSync(schemaPath)), contract_sha256: digest(readFileSync(contractPath)),
    seal_sha256: null, targets: planned.targets, receipt: null, created_at: now, updated_at: now,
  };
  writeStored(proposalDir, tx);
  return projectMergeTransaction(tx);
}

export function readMergeTransaction(proposalDir: string): MergeTransactionProjection {
  return projectMergeTransaction(readStored(proposalDir));
}

export function readMergeTransactionIfPresent(proposalDir: string): MergeTransactionProjection | null {
  return existsSync(transactionPath(proposalDir)) ? readMergeTransaction(proposalDir) : null;
}

export function submitMergeContent(
  proposalDir: string, slotId: string, bytes: Buffer,
): MergeTransactionProjection {
  const tx = readStored(proposalDir);
  if (!['collecting', 'ready'].includes(tx.phase)) throw new MergeTransactionError('action_not_allowed', '当前 phase 禁止提交 content', false, projectMergeTransaction(tx));
  const target = tx.targets.find(item => item.slot_id === slotId && item.producer === 'agent');
  if (!target) throw new MergeTransactionError('slot_identity_mismatch', `未声明的 slot：${slotId}`, false, projectMergeTransaction(tx));
  if (bytes.length === 0 || bytes.length > SLOT_LIMIT_BYTES) throw new MergeTransactionError('slot_identity_mismatch', 'content slot 为空或超过 20 MiB', true, projectMergeTransaction(tx));
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new MergeTransactionError('slot_identity_mismatch', 'content slot 不是合法 UTF-8', true, projectMergeTransaction(tx));
  if (/^##\s+(?:REMOVED-ITEMS|ADDED|MODIFIED|REMOVED)\b/m.test(text)) {
    throw new MergeTransactionError('slot_identity_mismatch', 'content slot 含 Delta 控制 marker', true, projectMergeTransaction(tx));
  }
  const path = slotPath(proposalDir, tx, slotId);
  ensureContained(path, proposalDir);
  atomicWrite(path, bytes);
  target.content_sha256 = digest(bytes);
  tx.phase = tx.targets.filter(item => item.producer === 'agent').every(item => item.content_sha256 !== null) ? 'ready' : 'collecting';
  tx.classification = null;
  tx.updated_at = new Date().toISOString();
  writeStored(proposalDir, tx);
  return projectMergeTransaction(tx);
}

function validateFrozenIdentity(root: string, proposalDir: string, tx: StoredTransaction): void {
  for (const target of tx.targets) {
    if (digest(readFileSync(join(proposalDir, ...target.delta_path.split('/')))) !== target.source_sha256) {
      throw new MergeTransactionError('source_hash_mismatch', `Delta 已漂移：${target.delta_path}`, false, projectMergeTransaction(tx));
    }
    if (currentHash(join(root, ...target.target_path.split('/'))) !== target.before_sha256) {
      throw new MergeTransactionError('before_hash_mismatch', `正式目标已漂移：${target.target_path}`, false, projectMergeTransaction(tx));
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
  if (!existsSync(path) || lstatSync(path).isSymbolicLink()) throw new MergeTransactionError('content_slot_missing', `缺少 slot：${target.slot_id}`, true, projectMergeTransaction(tx));
  const bytes = readFileSync(path);
  if (digest(bytes) !== target.content_sha256) throw new MergeTransactionError('slot_identity_mismatch', `slot hash 漂移：${target.slot_id}`, true, projectMergeTransaction(tx));
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

export function sealMergeTransaction(root: string, proposalDir: string): MergeTransactionProjection {
  const tx = readStored(proposalDir);
  if (tx.phase === 'sealed' || tx.phase === 'completed') return projectMergeTransaction(tx);
  if (tx.phase !== 'ready') throw new MergeTransactionError('content_slot_missing', 'content slot 尚未齐备', true, projectMergeTransaction(tx));
  validateFrozenIdentity(root, proposalDir, tx);
  const hashes = tx.targets.map(target => {
    const bytes = contentFor(root, proposalDir, tx, target);
    if (target.producer === 'agent') validateAgentSemantics(root, proposalDir, target, bytes);
    const hash = digest(bytes);
    target.content_sha256 = hash;
    target.sealed_sha256 = hash;
    return { slot_id: target.slot_id, content_sha256: hash };
  });
  tx.seal_sha256 = digest(canonical({ transaction_id: tx.transaction_id, target_set_sha256: tx.target_set_sha256, hashes }));
  tx.phase = 'sealed';
  tx.classification = null;
  tx.updated_at = new Date().toISOString();
  writeStored(proposalDir, tx);
  return projectMergeTransaction(tx);
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

function receiptFor(tx: StoredTransaction, closure: Array<{ target_path: string; sha256: string }>, completedAt: string): MergeTransactionReceipt {
  const base = {
    transaction_id: tx.transaction_id, seal_sha256: tx.seal_sha256!, target_set_sha256: tx.target_set_sha256,
    closure_sha256: digest(canonical(closure)), target_count: tx.targets.length, completed_at: completedAt,
  };
  return { ...base, receipt_sha256: digest(canonical(base)) };
}

export function applyMergeTransaction(root: string, proposalDir: string): MergeTransactionProjection {
  let tx = readStored(proposalDir);
  if (tx.phase === 'completed') return projectMergeTransaction(tx);
  if (tx.phase === 'applying') return recoverMergeTransaction(root, proposalDir);
  if (tx.phase !== 'sealed' || !tx.seal_sha256) throw new MergeTransactionError('action_not_allowed', 'transaction 尚未 sealed', false, projectMergeTransaction(tx));
  validateFrozenIdentity(root, proposalDir, tx);
  for (const target of tx.targets) if (digest(contentFor(root, proposalDir, tx, target)) !== target.sealed_sha256) {
    throw new MergeTransactionError('seal_mismatch', `sealed content 漂移：${target.target_path}`, false, projectMergeTransaction(tx));
  }
  tx.phase = 'applying'; tx.updated_at = new Date().toISOString(); writeStored(proposalDir, tx);
  const inputs: BaselineClosureApplyInput[] = [];
  const tests: TestChangeSetInputTarget[] = [];
  const closure: Array<{ target_path: string; sha256: string }> = [];
  for (const target of tx.targets) {
    const bytes = contentFor(root, proposalDir, tx, target);
    inputs.push({ kind: 'prepared', targetPath: target.target_path, mode: target.mode, bytes });
    closure.push({ target_path: target.target_path, sha256: digest(bytes) });
    if (target.category === 'test') tests.push({
      targetPath: target.target_path,
      beforeBytes: target.mode === 'MODIFY' ? readFileSync(join(root, ...target.target_path.split('/'))) : null,
      afterBytes: bytes,
    });
  }
  const metadata = metadataBytes(root, tx);
  if (metadata) {
    inputs.push({ kind: 'prepared', targetPath: 'logos/logos-project.yaml', mode: 'MODIFY', bytes: metadata });
    closure.push({ target_path: 'logos/logos-project.yaml', sha256: digest(metadata) });
  }
  const testChangeSet = buildTestChangeSet({ change: tx.slug, module: tx.module, targets: tests });
  const completedAt = new Date().toISOString();
  const receipt = receiptFor(tx, closure, completedAt);
  const receiptPath = relative(root, join(proposalDir, 'MERGE_RECEIPT.json')).replace(/\\/g, '/');
  const markerPath = relative(root, join(proposalDir, 'SPEC_MERGED')).replace(/\\/g, '/');
  const receiptBytes = Buffer.from(`${JSON.stringify({ schema: MERGE_TRANSACTION_SCHEMA, ...receipt, targets: closure, test_change_set: testChangeSet }, null, 2)}\n`);
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
    throw new MergeTransactionError('apply_conflict', result.error, true, projectMergeTransaction(tx));
  }
  tx = readStored(proposalDir); tx.phase = 'completed'; tx.classification = null; tx.receipt = receipt; tx.updated_at = completedAt; writeStored(proposalDir, tx);
  return projectMergeTransaction(tx);
}

export function recoverMergeTransaction(root: string, proposalDir: string): MergeTransactionProjection {
  const tx = readStored(proposalDir);
  if (tx.phase === 'completed') return projectMergeTransaction(tx);
  const markerPath = join(proposalDir, 'SPEC_MERGED');
  const receiptPath = join(proposalDir, 'MERGE_RECEIPT.json');
  if (existsSync(markerPath) && existsSync(receiptPath)) {
    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as Record<string, unknown>;
      const stored = JSON.parse(readFileSync(receiptPath, 'utf8')) as MergeTransactionReceipt;
      if (marker.transaction_id !== tx.transaction_id || stored.transaction_id !== tx.transaction_id || marker.receipt_sha256 !== stored.receipt_sha256) throw new Error('identity mismatch');
      tx.phase = 'completed'; tx.classification = null; tx.receipt = {
        transaction_id: stored.transaction_id, seal_sha256: stored.seal_sha256, target_set_sha256: stored.target_set_sha256,
        closure_sha256: stored.closure_sha256, receipt_sha256: stored.receipt_sha256,
        target_count: stored.target_count, completed_at: stored.completed_at,
      }; tx.updated_at = stored.completed_at; writeStored(proposalDir, tx); return projectMergeTransaction(tx);
    } catch { throw new MergeTransactionError('receipt_mismatch', 'completed receipt 与 marker 不一致', false, projectMergeTransaction(tx)); }
  }
  const recovered = recoverBaselineClosureApply(root, proposalDir);
  if (!recovered.ok) {
    tx.phase = 'failed'; tx.classification = 'recovery_required'; tx.updated_at = new Date().toISOString(); writeStored(proposalDir, tx);
    throw new MergeTransactionError('recovery_required', recovered.error, true, projectMergeTransaction(tx));
  }
  tx.phase = 'sealed'; tx.classification = null; tx.updated_at = new Date().toISOString(); writeStored(proposalDir, tx);
  return projectMergeTransaction(tx);
}

export function removeSubmittedContent(proposalDir: string, slotId: string): void {
  const tx = readStored(proposalDir);
  const path = slotPath(proposalDir, tx, slotId);
  if (existsSync(path)) unlinkSync(path);
}
