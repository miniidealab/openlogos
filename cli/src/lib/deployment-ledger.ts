/**
 * 本机部署账本的写入侧（environment-registry，spec/environments.md §5）。
 *
 * 账本 `logos/.openlogos-runtime/deployments.jsonl` 有 deploy-done 与 smoke 两个 CLI writer，
 * 同一台机器上可能并发运行。所有写入（追加、失败补偿时移除本次记录）都在同一把短临界区锁内进行：
 * - 追加失败时只截掉锁内本次写出的残片；
 * - 补偿只按「本次追加的整行原文」定位并移除自己的记录，不按文件长度推断归属，
 *   其他 writer 在此期间成功追加的记录原样保留（code-r2 F2）。
 */
import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync,
  statSync, truncateSync, writeFileSync, writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { DEPLOY_LEDGER_REL } from './environments.js';

export const DEPLOY_LEDGER_LOCK_REL = `${DEPLOY_LEDGER_REL}.lock`;

export interface LedgerLockOptions {
  /** 等锁上限，超时抛错；默认 5 秒。 */
  timeoutMs?: number;
  /** 锁文件超过该时长未更新视为异常退出遗留，可回收；默认 30 秒（临界区只有毫秒级）。 */
  staleMs?: number;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** 在账本锁内执行 fn；锁以 O_EXCL 创建锁文件实现，结束后删除。 */
export function withLedgerLock<T>(root: string, fn: () => T, opts: LedgerLockOptions = {}): T {
  const lockPath = join(root, DEPLOY_LEDGER_LOCK_REL);
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const staleMs = opts.staleMs ?? 30_000;
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let fd: number;
  for (;;) {
    try {
      fd = openSync(lockPath, 'wx');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > staleMs) {
          rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue; // 锁刚被释放，立即重试
      }
      if (Date.now() >= deadline) {
        throw new Error(`deployment ledger is locked by another openlogos process (${DEPLOY_LEDGER_LOCK_REL})`);
      }
      sleepSync(20);
    }
  }
  try {
    writeSync(fd, String(process.pid));
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

/** 锁内追加一行（line 须以换行结尾）；追加失败时截掉本次残片后原样抛出。 */
export function appendLedgerLine(root: string, line: string, opts: LedgerLockOptions = {}): void {
  const ledgerPath = join(root, DEPLOY_LEDGER_REL);
  withLedgerLock(root, () => {
    const before = existsSync(ledgerPath) && statSync(ledgerPath).isFile() ? statSync(ledgerPath).size : null;
    try {
      appendFileSync(ledgerPath, line);
    } catch (error) {
      // 锁内超出追加前长度的字节只可能是本次写出的残片
      try {
        if (existsSync(ledgerPath) && statSync(ledgerPath).isFile()) {
          if (before === null) rmSync(ledgerPath, { force: true });
          else if (statSync(ledgerPath).size > before) truncateSync(ledgerPath, before);
        }
      } catch { /* 残片清理失败不掩盖原始错误 */ }
      throw error;
    }
  }, opts);
}

/**
 * 锁内移除本次追加的那一行（按整行原文匹配，deploy_id 保证唯一）；其他行原样保留。
 * 返回 removed / absent；同一原文出现多次无法确认归属时抛错，不改动账本。
 * removeIfEmpty：本次之前账本不存在且移除后为空时删除文件，回到执行前状态。
 */
export function removeOwnLedgerLine(
  root: string, line: string, removeIfEmpty: boolean, opts: LedgerLockOptions = {},
): 'removed' | 'absent' {
  const ledgerPath = join(root, DEPLOY_LEDGER_REL);
  return withLedgerLock(root, () => {
    if (!existsSync(ledgerPath)) return 'absent';
    const segments = readFileSync(ledgerPath, 'utf-8').split(/(?<=\n)/);
    const hits = segments.filter(segment => segment === line).length;
    if (hits === 0) return 'absent';
    if (hits > 1) throw new Error('own ledger record appears more than once; ownership cannot be confirmed, ledger left unchanged');
    const rest = segments.filter(segment => segment !== line).join('');
    if (rest === '' && removeIfEmpty) {
      rmSync(ledgerPath, { force: true });
    } else {
      const tmpPath = `${ledgerPath}.${process.pid}.tmp`;
      writeFileSync(tmpPath, rest);
      renameSync(tmpPath, ledgerPath);
    }
    return 'removed';
  }, opts);
}
