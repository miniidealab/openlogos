/**
 * knowledge-direct-intake — 企业知识录入的排他边界与读取快照（功能规格 §2.103.4「事务」第 0 / 5 / 6 / 7 条）。
 *
 * - 写入方（`knowledge apply` / `index` / `--recover`、merge 写知识目标）在 {@link KNOWLEDGE_LOCK_FILE} 排他锁内
 *   完成「恢复 → 读取前态 → 校验 → 提交」；锁被存活进程持有时等待（默认至多 30 秒），仍忙即报忙、不做任何恢复或写入。
 * - 读取方（check / list / show / refs / change-lint L10 / status / next 的知识提示）在同一把锁的读锁区间内完成全部
 *   知识读取：一次读取要么完全在某次提交之前、要么完全在其之后；区间内发现未完成事务日志则拒绝、不恢复。
 *
 * 锁复用 baseline-seed 提交锁原语（link 原子发布持有者身份、存活持有者不抢占、死进程经 marker 仲裁回收），
 * 读锁区间复用其有界退避重试；同进程已持锁时直接复用同一临界区（merge 准入内的 change-lint）。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  acquireLockAt,
  acquireReadLockWithRetryAt,
  lockHeldByCurrentProcessAt,
  releaseLockAt,
} from './baseline-seed-txn.js';
import { BASELINE_CLOSURE_APPLY_JOURNAL } from './baseline-apply.js';

/** 录入事务存储目录（项目根相对，运行态、不入版本控制）。 */
export const KNOWLEDGE_TXN_DIR = 'logos/.openlogos-runtime/knowledge-apply';
/** 项目级排他锁文件（项目根相对）。 */
export const KNOWLEDGE_LOCK_FILE = 'logos/.openlogos-runtime/knowledge-apply.lock';
const LOCK_KEY = 'knowledge-apply';

export function knowledgeTxnDirAbs(root: string): string {
  return join(root, ...KNOWLEDGE_TXN_DIR.split('/'));
}

function lockAbs(root: string): string {
  return join(root, ...KNOWLEDGE_LOCK_FILE.split('/'));
}

/** 事务存储目录中是否留有未完成的事务日志（进程中断或回滚失败后遗留）。 */
export function knowledgeTxnIncomplete(root: string): boolean {
  return existsSync(join(knowledgeTxnDirAbs(root), BASELINE_CLOSURE_APPLY_JOURNAL));
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export type KnowledgeLockOutcome<T> = { ok: true; value: T; incomplete?: boolean } | { ok: false; reason: 'busy' | 'incomplete' };

/**
 * 写入方排他区间：取锁（存活持有者占锁时每 200 毫秒重试，至多 `OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS`，默认 30000），
 * 持有到 fn 结束。同进程已持锁时直接执行 fn。
 */
export function withKnowledgeWriteLock<T>(root: string, fn: () => T): KnowledgeLockOutcome<T> {
  const path = lockAbs(root);
  if (lockHeldByCurrentProcessAt(path, LOCK_KEY)) return { ok: true, value: fn() };
  mkdirSync(join(root, 'logos', '.openlogos-runtime'), { recursive: true });
  const deadline = Date.now() + envMs('OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS', 30_000);
  for (;;) {
    if (acquireLockAt(path, LOCK_KEY)) break;
    if (Date.now() >= deadline) return { ok: false, reason: 'busy' };
    sleepSync(200);
  }
  try {
    return { ok: true, value: fn() };
  } finally {
    releaseLockAt(path, LOCK_KEY);
  }
}

/**
 * 读锁区间：以有界退避取同一把锁（预算 `OPENLOGOS_KNOWLEDGE_READ_LOCK_BUDGET_MS`，默认 2000），在区间内执行 fn。
 * 区间内发现未完成事务日志 → `incomplete`（不恢复）；预算内取不到锁 → `busy`。同进程已持锁时直接执行 fn
 * （调用方自己负责事务状态，如 merge 在持锁后才做准入）。
 */
export function withKnowledgeReadLock<T>(root: string, fn: () => T, opts: { runWhenIncomplete?: boolean } = {}): KnowledgeLockOutcome<T> {
  const path = lockAbs(root);
  // runWhenIncomplete（knowledge check，code-r1 F4）：发现未完成事务时仍在**同一读锁区间内**执行 fn 并标记 incomplete，
  // 诊断快照不在锁外取得；其余读取方遇未完成事务直接拒绝。
  const inLock = (): KnowledgeLockOutcome<T> => {
    const incomplete = knowledgeTxnIncomplete(root);
    if (incomplete && !opts.runWhenIncomplete) return { ok: false, reason: 'incomplete' };
    return incomplete ? { ok: true, value: fn(), incomplete: true } : { ok: true, value: fn() };
  };
  if (lockHeldByCurrentProcessAt(path, LOCK_KEY)) return inLock();
  try {
    mkdirSync(join(root, 'logos', '.openlogos-runtime'), { recursive: true });
  } catch {
    // 只读环境：无法建锁目录时无法与写入方互斥；此时也不存在写入方（写入同样需要该目录）。
    return inLock();
  }
  const budget = envMs('OPENLOGOS_KNOWLEDGE_READ_LOCK_BUDGET_MS', 2000);
  if (!acquireReadLockWithRetryAt(path, LOCK_KEY, { budgetMs: budget })) return { ok: false, reason: 'busy' };
  try {
    return inLock();
  } finally {
    releaseLockAt(path, LOCK_KEY);
  }
}

/** 测试屏障（仅 NODE_ENV=test）：读锁区间内停住，验证读取与提交 / 恢复互斥（UT-S45-43、UT-S45-38）。 */
export function testReadBarrier(): void {
  if (process.env.NODE_ENV !== 'test') return;
  const barrier = process.env.OPENLOGOS_TEST_KNOWLEDGE_READ_BARRIER;
  if (!barrier) return;
  writeFileSync(`${barrier}.reached`, String(process.pid));
  const deadline = Date.now() + 120_000;
  while (!existsSync(`${barrier}.release`) && Date.now() < deadline) sleepSync(50);
}

/**
 * 进程级持锁（merge 写入知识目标，§2.103.4 第 7 条）：取得后持有到进程退出。merge 的失败路径以 process.exit 结束，
 * 因此在 `exit` 事件中释放；进程被杀时遗留的锁由下一个取锁者按「持有者已死」回收。
 */
export function holdKnowledgeLockForProcess(root: string): 'held' | 'busy' {
  const path = lockAbs(root);
  if (lockHeldByCurrentProcessAt(path, LOCK_KEY)) return 'held';
  mkdirSync(join(root, 'logos', '.openlogos-runtime'), { recursive: true });
  const deadline = Date.now() + envMs('OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS', 30_000);
  for (;;) {
    if (acquireLockAt(path, LOCK_KEY)) break;
    if (Date.now() >= deadline) return 'busy';
    sleepSync(200);
  }
  process.once('exit', () => { try { releaseLockAt(path, LOCK_KEY); } catch { /* 遗留锁按死进程回收 */ } });
  return 'held';
}

export function incompleteMessage(reason: 'busy' | 'incomplete'): string {
  return reason === 'busy'
    ? '另一个录入正在进行，请稍后重试'
    : '上一次录入被中断，请运行 openlogos knowledge apply --recover';
}
