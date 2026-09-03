/**
 * 测试切片事务（`openlogos/test-slice-transaction@1`）。
 *
 * 把 `TEST_SLICE_MANIFEST.json` 与 `tasks.md` 的 `## [code]` 段从「Agent 直接写出的文件」
 * 变为「OpenLogos 事务的产物」。Agent 只能向 content slot 提交内容；正式产物、receipt 与
 * marker 一律由本模块写入（根规范 `spec/test-slice-manifest.md` §2.1、架构 §四十三.1）。
 *
 * 形状与状态机沿用已闭环的 `openlogos/merge-transaction@1`，不另发明。
 *
 * ## 为什么必须是事务
 *
 * manifest 的 `task_fingerprint` 是对 `tasks.md` 的 `[code]` 段求得的指纹。二者由同一 Agent
 * 分两次写出时存在漂移窗口——先写其一后写其二，或写完 A 又调整 A。此前规格用文字要求「同一轮
 * 规划中共同收敛」，并设了一道 `change-lint` 硬门，但那道门由**被检查者自己**运行。
 *
 * 本模块提供的是构造保证：两个产物在同一次 `apply` 中写出，任一失败整体回滚；`task_fingerprint`
 * 依**刚写出的** `tasks.md` 计算，写入者与指纹计算者是同一方、同一时刻（架构 §四十三.2）。
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractCodeSectionRaw, replaceCodeSectionBody } from './proposal-lifecycle.js';
import {
  TEST_SLICE_MANIFEST, computeSpecFingerprint, computeTaskFingerprint,
  deriveSliceVerificationState, extractChangedTestIds, writeTestSliceManifestAtomic,
  type TestSliceManifestSlice, type TestSliceManifestV1, type TestSliceViolation,
} from './test-slice-manifest.js';

export const TEST_SLICE_TRANSACTION_SCHEMA = 'openlogos/test-slice-transaction@1' as const;
export const TEST_SLICE_TRANSACTION_FILE = 'TEST_SLICE_TRANSACTION.json';

export type TestSliceTransactionPhase =
  'collecting' | 'ready' | 'sealed' | 'applying' | 'completed' | 'failed';
export type TestSliceTransactionAction =
  'submit_content' | 'seal' | 'apply' | 'recover' | 'abort';
export type TestSliceTransactionOrigin = 'initial-plan' | 'manifest-recovery';

/** 两个 content slot：切片划分的**理由**与切片的**机器归属**，判据不同故分开提交。 */
export const SLOT_CODESECTION = 'slot_codesection' as const;
export const SLOT_SLICES = 'slot_slices' as const;
export type TestSliceSlotId = typeof SLOT_CODESECTION | typeof SLOT_SLICES;

export interface TestSliceContentSlot {
  slot_id: TestSliceSlotId;
  content_sha256: string | null;
  sealed_sha256: string | null;
}

export interface TestSliceTransactionReceipt {
  transaction_id: string;
  completed_at: string;
  seal_sha256: string;
  artifacts: Array<{ path: string; sha256: string }>;
}

export interface TestSliceTransactionProjection {
  schema: typeof TEST_SLICE_TRANSACTION_SCHEMA;
  transaction_id: string;
  slug: string;
  module: string;
  phase: TestSliceTransactionPhase;
  origin: TestSliceTransactionOrigin;
  classification: string | null;
  retryable: boolean;
  allowed_actions: TestSliceTransactionAction[];
  next_action: TestSliceTransactionAction | null;
  spec_fingerprint: string | null;
  changed_test_ids_sha256: string | null;
  content_slots: { required: number; submitted: number; missing_slot_ids: TestSliceSlotId[] };
  violations: TestSliceViolation[];
  receipt: TestSliceTransactionReceipt | null;
  schema_sha256: string;
  contract_sha256: string;
}

interface StoredSliceTransaction {
  schema: typeof TEST_SLICE_TRANSACTION_SCHEMA;
  transaction_id: string;
  slug: string;
  module: string;
  phase: TestSliceTransactionPhase;
  origin: TestSliceTransactionOrigin;
  classification: string | null;
  spec_fingerprint: string | null;
  changed_test_ids_sha256: string | null;
  schema_sha256: string;
  contract_sha256: string;
  seal_sha256: string | null;
  slots: TestSliceContentSlot[];
  staged: Partial<Record<TestSliceSlotId, string>>;
  receipt: TestSliceTransactionReceipt | null;
  /** apply 自校验判非法时留存的 validator 结论；原样保真，不压缩为摘要。 */
  violations: TestSliceViolation[];
  aborted_at: string | null;
  created_at: string;
  updated_at: string;
}

export class TestSliceTransactionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** 仅 apply 自校验失败时非空：validator 的原始结论，供投影原样带出。 */
    public readonly violations: TestSliceViolation[] = [],
  ) { super(message); }
}

const digest = (bytes: Buffer | string): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const filePath = (proposalDir: string): string => join(proposalDir, TEST_SLICE_TRANSACTION_FILE);

function requiredSlots(origin: TestSliceTransactionOrigin): TestSliceSlotId[] {
  // manifest-recovery 只重写 manifest——切片划分本身没问题，`[code]` 段冻结（功能规格 §2.53.6）。
  return origin === 'manifest-recovery' ? [SLOT_SLICES] : [SLOT_CODESECTION, SLOT_SLICES];
}

/** phase → 允许动作。与 merge 事务同构：failed 为终态，仅 recovery_required 时可 recover。 */
function allowedActions(tx: StoredSliceTransaction): TestSliceTransactionAction[] {
  switch (tx.phase) {
    case 'collecting': return ['submit_content', 'abort'];
    case 'ready': return ['seal', 'submit_content', 'abort'];
    case 'sealed': return ['apply', 'abort'];
    case 'applying': return ['recover', 'abort'];
    case 'completed': return [];
    // failed + recovery_required 的出路是「修正 slot 后重走 seal/apply」（S32 异常与边界）。
    // 不列 recover：命令面尚未开放该动作，把它写进 allowed_actions 会让投影与事实不符
    // ——用户照着做每次都被拒（功能规格 §2.53.6.2）。
    case 'failed': return tx.classification === 'recovery_required' ? ['submit_content', 'abort'] : [];
  }
}

function readStored(proposalDir: string): StoredSliceTransaction {
  const path = filePath(proposalDir);
  if (!existsSync(path)) throw new TestSliceTransactionError('transaction_missing', '当前提案没有切片事务');
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as StoredSliceTransaction;
  } catch (error) {
    throw new TestSliceTransactionError('artifact_unreadable',
      `切片事务文件无法严格解析：${error instanceof Error ? error.message : String(error)}`);
  }
}

function writeStored(proposalDir: string, tx: StoredSliceTransaction): void {
  const path = filePath(proposalDir);
  const tmp = `${path}.tmp-${randomUUID()}`;
  writeFileSync(tmp, `${JSON.stringify(tx, null, 2)}\n`);
  renameSync(tmp, path);
}

export function projectTestSliceTransaction(tx: StoredSliceTransaction): TestSliceTransactionProjection {
  const required = requiredSlots(tx.origin);
  const submitted = tx.slots.filter(slot => slot.content_sha256 !== null).map(slot => slot.slot_id);
  const actions = allowedActions(tx);
  return {
    schema: tx.schema,
    transaction_id: tx.transaction_id,
    slug: tx.slug,
    module: tx.module,
    phase: tx.phase,
    origin: tx.origin,
    classification: tx.classification,
    retryable: tx.classification === 'recovery_required',
    allowed_actions: actions,
    next_action: actions[0] ?? null,
    spec_fingerprint: tx.spec_fingerprint,
    changed_test_ids_sha256: tx.changed_test_ids_sha256,
    content_slots: {
      required: required.length,
      submitted: submitted.length,
      missing_slot_ids: required.filter(slot => !submitted.includes(slot)),
    },
    violations: tx.violations ?? [],
    receipt: tx.receipt,
    schema_sha256: tx.schema_sha256,
    contract_sha256: tx.contract_sha256,
  };
}

/**
 * 契约资产解析：`spec/` 随 CLI 包分发，**不在用户项目里**——必须从模块自身位置上溯，
 * 与 merge 事务的 `bundledContractPath` 同法。缺失时 fail closed，不以空串冒充。
 */
function bundledContractPath(relativePath: string): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, '..', '..', ...relativePath.split('/')),
    join(moduleDir, '..', '..', '..', ...relativePath.split('/')),
  ];
  const resolved = candidates.find(candidate => existsSync(candidate));
  if (!resolved) {
    throw new TestSliceTransactionError('unsupported_contract',
      `安装态缺少 test slice transaction 契约资产：${relativePath}`);
  }
  return resolved;
}

/** 契约哈希来源：随包分发的公共规格文本。 */
function contractHashes(): { schema_sha256: string; contract_sha256: string } {
  return {
    schema_sha256: digest(readFileSync(bundledContractPath('spec/test-slice-manifest.md'))),
    contract_sha256: digest(readFileSync(bundledContractPath('spec/cli-json-output.md'))),
  };
}

export function readTestSliceTransactionIfPresent(proposalDir: string): TestSliceTransactionProjection | null {
  if (!existsSync(filePath(proposalDir))) return null;
  return projectTestSliceTransaction(readStored(proposalDir));
}

/** manifest 失效的三种态——恢复事务的唯一触发判据，来自 deriveSliceVerificationState。 */
const RECOVERY_REASONS = new Set([
  'test-slice-manifest-missing', 'test-slice-manifest-invalid', 'test-slice-manifest-stale',
]);

export function isManifestRecoveryReason(reason: string | null | undefined): boolean {
  return RECOVERY_REASONS.has(reason ?? '');
}

/**
 * 依 OpenLogos 自身的 manifest 判定结论创建恢复事务；无失效态则不创建（返回 null）。
 *
 * 消费方不再判断「这是不是一次恢复」，也不再自行推导可写作用域——两者都从事务投影读出
 * （功能规格 §2.53.6、架构 §四十三.1）。
 */
export function ensureManifestRecoveryTransaction(
  root: string, proposalDir: string, slug: string, module = 'core',
): TestSliceTransactionProjection | null {
  const existing = readTestSliceTransactionIfPresent(proposalDir);
  if (existing) return existing;                       // 单活跃事务，幂等
  const state = deriveSliceVerificationState(root, proposalDir);
  if (!state || state.human_action_required) return null;   // 人工门优先
  if (!isManifestRecoveryReason(state.reason)) return null;
  return createTestSliceTransaction(root, proposalDir, slug, { origin: 'manifest-recovery', module });
}

/** 创建事务；已存在则返回既有投影（单活跃事务，幂等）。 */
export function createTestSliceTransaction(
  _root: string, proposalDir: string, slug: string,
  options: { origin?: TestSliceTransactionOrigin; module?: string } = {},
): TestSliceTransactionProjection {
  const existing = readTestSliceTransactionIfPresent(proposalDir);
  if (existing) return existing;
  const origin = options.origin ?? 'initial-plan';
  const now = new Date().toISOString();
  const changed = extractChangedTestIds(proposalDir);
  const tx: StoredSliceTransaction = {
    schema: TEST_SLICE_TRANSACTION_SCHEMA,
    transaction_id: `stx_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    slug, module: options.module ?? 'core',
    phase: 'collecting', origin, classification: null,
    spec_fingerprint: null,
    changed_test_ids_sha256: digest(JSON.stringify([...changed].sort())),
    ...contractHashes(),
    seal_sha256: null,
    slots: requiredSlots(origin).map(slot => ({ slot_id: slot, content_sha256: null, sealed_sha256: null })),
    staged: {},
    receipt: null, violations: [], aborted_at: null, created_at: now, updated_at: now,
  };
  writeStored(proposalDir, tx);
  return projectTestSliceTransaction(tx);
}

function assertAllowed(tx: StoredSliceTransaction, action: TestSliceTransactionAction): void {
  if (!allowedActions(tx).includes(action)) {
    throw new TestSliceTransactionError('action_not_allowed',
      `动作 ${action} 不在当前 phase(${tx.phase}) 的 allowed_actions 内：[${allowedActions(tx).join(', ')}]`);
  }
}

/** `slot_slices` 的内容契约：切片数组，字段与 manifest 的 slices 对齐。 */
function parseSlicesSlot(raw: string): TestSliceManifestSlice[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch (error) {
    throw new TestSliceTransactionError('slot_content_invalid',
      `slot_slices 必须是合法 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  const rows = Array.isArray(value) ? value : (value as { slices?: unknown }).slices;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TestSliceTransactionError('slot_content_invalid', 'slot_slices 必须是非空切片数组');
  }
  return rows.map((row, index) => {
    const r = row as Record<string, unknown>;
    for (const key of ['slice_id', 'owned_test_ids', 'runner_selectors', 'spec_targets']) {
      if (r[key] === undefined) {
        throw new TestSliceTransactionError('slot_content_invalid', `slices[${index}] 缺字段 ${key}`);
      }
    }
    return r as unknown as TestSliceManifestSlice;
  });
}

export function submitTestSliceContent(
  proposalDir: string, slotId: string, contentPath: string,
): TestSliceTransactionProjection {
  const tx = readStored(proposalDir);
  assertAllowed(tx, 'submit_content');
  const slot = tx.slots.find(item => item.slot_id === slotId);
  if (!slot) {
    // 恢复事务下 slot_codesection 不在 required 中——`[code]` 段冻结，拒绝改写。
    throw new TestSliceTransactionError('slot_identity_mismatch',
      `未声明的 slot：${slotId}（当前 origin=${tx.origin} 只接受 ${requiredSlots(tx.origin).join('、')}）`);
  }
  if (!existsSync(contentPath)) {
    throw new TestSliceTransactionError('artifact_unreadable', `内容文件不存在：${contentPath}`);
  }
  const raw = readFileSync(contentPath, 'utf-8');
  if (raw.trim() === '') throw new TestSliceTransactionError('slot_content_invalid', `${slotId} 内容为空`);
  if (slotId === SLOT_SLICES) parseSlicesSlot(raw);
  slot.content_sha256 = digest(raw);
  tx.staged[slotId as TestSliceSlotId] = raw;
  const submitted = tx.slots.filter(item => item.content_sha256 !== null).length;
  tx.phase = submitted === requiredSlots(tx.origin).length ? 'ready' : 'collecting';
  tx.updated_at = new Date().toISOString();
  writeStored(proposalDir, tx);
  return projectTestSliceTransaction(tx);
}

export function sealTestSliceTransaction(proposalDir: string): TestSliceTransactionProjection {
  const tx = readStored(proposalDir);
  assertAllowed(tx, 'seal');
  const parts = requiredSlots(tx.origin).map(slot => `${slot}\0${tx.staged[slot] ?? ''}`);
  for (const slot of tx.slots) slot.sealed_sha256 = digest(tx.staged[slot.slot_id] ?? '');
  tx.seal_sha256 = digest(parts.join('\0'));
  tx.phase = 'sealed';
  tx.updated_at = new Date().toISOString();
  writeStored(proposalDir, tx);
  return projectTestSliceTransaction(tx);
}

export function abortTestSliceTransaction(proposalDir: string): TestSliceTransactionProjection {
  const tx = readStored(proposalDir);
  assertAllowed(tx, 'abort');
  tx.phase = 'failed';
  tx.classification = null;
  tx.aborted_at = new Date().toISOString();
  tx.updated_at = tx.aborted_at;
  tx.staged = {};
  writeStored(proposalDir, tx);
  return projectTestSliceTransaction(tx);
}

/**
 * 原子写出两产物。任一失败整体回滚——两产物同时存在或同时不存在（架构 §四十三.2）。
 *
 * `task_fingerprint` 依**刚写出的** `tasks.md` 计算：写入者与指纹计算者是同一方、同一时刻，
 * 漂移窗口从构造上消失。slot 中若携带指纹，一律不采信。
 */
export function applyTestSliceTransaction(
  root: string, proposalDir: string,
): TestSliceTransactionProjection {
  const tx = readStored(proposalDir);
  assertAllowed(tx, 'apply');
  const tasksPath = join(proposalDir, 'tasks.md');
  const manifestPath = join(proposalDir, TEST_SLICE_MANIFEST);
  if (!existsSync(tasksPath)) {
    throw new TestSliceTransactionError('artifact_unreadable', '提案缺少 tasks.md');
  }
  // 前置：change set 不可信属于**上游** merge / spec-complete 的阻塞前沿，
  // 禁止伪装成 slice manifest 问题（spec/test-slice-manifest.md §9）。在写盘之前拦下——
  // 因此不产生半写态、也不需要回滚，且提示指向 merge 而非「修正 slot 内容」。
  const precondition = deriveSliceVerificationState(root, proposalDir);
  if (precondition?.test_change_set?.status === 'invalid') {
    throw new TestSliceTransactionError('change_set_unavailable',
      'apply 前置不满足：SPEC_MERGED.test_change_set 不可信。请回到 merge / spec-complete 修复，'
      + '不要改动 slot 内容——这不是切片划分的问题。',
      precondition.violations ?? []);
  }

  const tasksBefore = readFileSync(tasksPath, 'utf-8');
  const manifestExisted = existsSync(manifestPath);
  const manifestBefore = manifestExisted ? readFileSync(manifestPath, 'utf-8') : null;

  tx.phase = 'applying';
  tx.updated_at = new Date().toISOString();
  writeStored(proposalDir, tx);

  try {
    // ① tasks.md 的 [code] 整节替换；[delta] / [deploy] 段与 checkbox 状态字节恒等。
    let tasksAfter = tasksBefore;
    if (tx.origin === 'initial-plan') {
      const body = (tx.staged[SLOT_CODESECTION] ?? '').replace(/\s+$/, '');
      if (body === '') throw new TestSliceTransactionError('slot_content_invalid', 'slot_codesection 内容为空');
      tasksAfter = replaceCodeSectionBody(tasksBefore, body);
      writeFileSync(tasksPath, tasksAfter);
    }

    // ② 指纹自算——依刚写出的 tasks.md，而非 slot 提供的任何值。
    const slices = parseSlicesSlot(tx.staged[SLOT_SLICES] ?? '');
    const specTargets = [...new Set(slices.flatMap(slice => slice.spec_targets))].sort();
    const manifest: TestSliceManifestV1 = {
      schema: 'openlogos/test-slice-manifest@1',
      change: tx.slug, module: tx.module,
      task_fingerprint: computeTaskFingerprint(readFileSync(tasksPath, 'utf-8')),
      spec_fingerprint: computeSpecFingerprint(root, specTargets),
      generated_at: new Date().toISOString(),
      slices,
    };
    writeTestSliceManifestAtomic(manifestPath, manifest);

    // ③ 终态守门：用既有判定器复核刚写出的两产物。原子写入只保证两者同生共死，
    //    不保证它们合法——事务完全可以原子地写出一对互相一致但业务非法的产物
    //    然后宣告成功（架构 §四十三.2.1）。判非法即落入下方 catch，走与写盘异常
    //    完全相同的那一条回滚，不另写一份。
    const verdict = verifyAppliedManifest(root, proposalDir);
    if (verdict.status !== 'valid') {
      throw new TestSliceTransactionError('apply_verification_failed',
        `apply 写出的产物被判定器判为 ${verdict.status ?? 'unknown'}，已整体回滚：`
        + `${verdict.violations.length} 条违规。修正 slot 内容后重新提交。`,
        verdict.violations);
    }

    tx.spec_fingerprint = manifest.spec_fingerprint;
    tx.receipt = {
      transaction_id: tx.transaction_id,
      completed_at: new Date().toISOString(),
      seal_sha256: tx.seal_sha256 ?? '',
      artifacts: [
        { path: 'tasks.md', sha256: digest(readFileSync(tasksPath)) },
        { path: TEST_SLICE_MANIFEST, sha256: digest(readFileSync(manifestPath)) },
      ],
    };
    tx.phase = 'completed';
    tx.violations = [];
    tx.updated_at = tx.receipt.completed_at;
    writeStored(proposalDir, tx);
    return projectTestSliceTransaction(tx);
  } catch (error) {
    // 整体回滚：两产物恢复到 apply 前的状态，不留半写态。
    writeFileSync(tasksPath, tasksBefore);
    if (manifestBefore === null) rmSync(manifestPath, { force: true });
    else writeFileSync(manifestPath, manifestBefore);
    tx.phase = 'failed';
    tx.classification = 'recovery_required';
    // violations 原样留存并进入投影——压缩成单条摘要，消费方就无法定位到底是哪个
    // spec_targets 或哪个 task_text 不合格（spec/test-slice-manifest.md §2.2.1）。
    tx.violations = error instanceof TestSliceTransactionError ? error.violations : [];
    tx.updated_at = new Date().toISOString();
    writeStored(proposalDir, tx);
    throw error instanceof TestSliceTransactionError ? error
      : new TestSliceTransactionError('apply_failed',
        `apply 失败并已整体回滚：${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * apply 的终态守门人：用**既有**判定器复核刚写出的两产物，不新建第二套 validator。
 *
 * 此前本函数只回一个状态字符串，且**全仓零调用方**——复核器在场、注释写明用途，却没有任何
 * 执行路径经过它，于是「写盘成功即 completed」照旧成立（架构 §四十三.2.1）。现在它由
 * `applyTestSliceTransaction()` 在置 `completed` 前直接调用，并把 violations 一并返回，
 * 使失败投影能定位到具体的 `spec_targets` 或 `task_text`。
 */
export function verifyAppliedManifest(
  root: string, proposalDir: string,
): { status: string | null; violations: TestSliceViolation[] } {
  const state = deriveSliceVerificationState(root, proposalDir);
  return { status: state?.manifest_status ?? null, violations: state?.violations ?? [] };
}
