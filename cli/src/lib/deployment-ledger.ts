/**
 * 本机部署账本的写入侧（environment-registry，spec/environments.md §5）。
 *
 * 账本 `logos/.openlogos-runtime/deployments.jsonl` 有 deploy-done 与 smoke 两个 CLI writer，
 * 同一台机器上可能并发运行。所有写入（追加、失败补偿时移除本次记录）都在同一把短临界区锁内进行：
 * - 追加以「原内容 + 本行」写临时文件后原子 rename 替换：失败时账本保持原字节，不产生残片（code-r2 F1）；
 * - 补偿只按「本次追加的整行原文」定位并移除自己的记录，不按文件长度推断归属，
 *   其他 writer 在此期间成功追加的记录原样保留（code-r2 F2）。
 */
import {
  accessSync, chmodSync, closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync,
  statSync, writeFileSync, writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { DEPLOY_LEDGER_REL } from './environments.js';

export const DEPLOY_LEDGER_LOCK_REL = `${DEPLOY_LEDGER_REL}.lock`;

/** 账本与锁文件的底层写入口；缺省为真实文件系统，测试据此注入临时文件写入中途失败、替换失败、清理失败与释放锁失败。 */
export interface LedgerFileIo {
  writeFile(path: string, data: Buffer): void;
  rename(from: string, to: string): void;
  remove(path: string): void;
  releaseLock(fd: number, lockPath: string): void;
}

const defaultLedgerFileIo: LedgerFileIo = {
  writeFile: (path, data) => writeFileSync(path, data),
  rename: (from, to) => renameSync(from, to),
  remove: path => rmSync(path, { force: true }),
  releaseLock: (fd, lockPath) => {
    try { closeSync(fd); } finally { rmSync(lockPath, { force: true }); }
  },
};

export interface LedgerLockOptions {
  /** 等锁上限，超时抛错；默认 5 秒。 */
  timeoutMs?: number;
  /** 锁文件超过该时长未更新视为异常退出遗留，可回收；默认 30 秒（临界区只有毫秒级）。 */
  staleMs?: number;
  /** 仅供测试注入：底层写入口（未给出的项用缺省实现）。 */
  io?: Partial<LedgerFileIo>;
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * 在账本锁内执行 fn；锁以 O_EXCL 创建锁文件实现，结束后删除。
 * 临界区的结果只由 fn 决定：fn 已完成的写入不因随后释放锁（关闭、删除锁文件）失败而被报告为失败，
 * 否则调用方会把「已写入」误判为「未写入」（code-r1 F1）。释放失败时遗留的锁文件按 staleMs 回收。
 */
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
  const io = { ...defaultLedgerFileIo, ...opts.io };
  try {
    writeSync(fd, String(process.pid));
    return fn();
  } finally {
    try { io.releaseLock(fd, lockPath); } catch { /* 释放失败不改变临界区结果，遗留锁按 staleMs 回收 */ }
  }
}

/**
 * 锁内追加一行（line 须以换行结尾）。抛错即保证账本保持调用前的字节，没有本次的行或残片：
 * - 账本非空且末行缺少换行时不追加、原样拒绝——否则本次记录会与末行粘连，既损坏末行、也无法按整行撤销（code-r1 F2）；
 * - 不在账本上就地追加：把「原内容 + 本行」写入临时文件，再原子 rename 替换账本。写临时文件中途失败、替换失败、
 *   临时文件清理失败都不触及账本本身，因此不存在需要事后截断、且截断可能再失败的残片（code-r2 F1）；
 * - 与就地追加同等的权限语义：账本不可写时拒绝（不得借 rename 绕过只读账本），新文件沿用原文件权限位。
 * 正常返回即本次记录已完整写入（释放锁失败不改变这一结论，见 withLedgerLock）。
 */
export function appendLedgerLine(root: string, line: string, opts: LedgerLockOptions = {}): void {
  withLedgerLock(root, () => appendLedgerLineLocked(root, line, opts), opts);
}

/**
 * appendLedgerLine 的临界区部分：调用方必须已持有账本锁（withLedgerLock）。供需要在同一临界区内
 * 「重新扫描账本 → 查重 → 追加」的写入方使用（openlogos approve，environment-promotion-approval §12.2）。
 */
export function appendLedgerLineLocked(root: string, line: string, opts: Pick<LedgerLockOptions, 'io'> = {}): void {
  const ledgerPath = join(root, DEPLOY_LEDGER_REL);
  const io = { ...defaultLedgerFileIo, ...opts.io };
  // 账本路径被目录等占据时 readFileSync 抛 EISDIR，此时尚未写入任何文件
  const current = existsSync(ledgerPath) ? readFileSync(ledgerPath) : null;
  if (current !== null && current.length > 0 && current[current.length - 1] !== 0x0a) {
    throw new Error(`deployment ledger does not end with a newline (${DEPLOY_LEDGER_REL}); add the missing trailing newline and retry, nothing was written`);
  }
  let mode: number | null = null;
  if (current !== null) {
    accessSync(ledgerPath, constants.W_OK);
    mode = statSync(ledgerPath).mode & 0o7777;
  }
  const tmpPath = `${ledgerPath}.${process.pid}.append.tmp`;
  try {
    io.writeFile(tmpPath, Buffer.concat([current ?? Buffer.alloc(0), Buffer.from(line)]));
    if (mode !== null) chmodSync(tmpPath, mode);
    io.rename(tmpPath, ledgerPath);
  } catch (error) {
    // 账本未被替换；临时文件残留只影响运行态目录的整洁，不影响账本内容
    try { io.remove(tmpPath); } catch { /* 见上 */ }
    throw error;
  }
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
    const content = readFileSync(ledgerPath, 'utf-8');
    const segments = content.split(/(?<=\n)/);
    const hits = segments.filter(segment => segment === line).length;
    if (hits === 0) {
      // 整行匹配不到但原文仍在：本次记录与相邻行粘连，不能确认已撤销（code-r1 F2）
      if (content.includes(line.replace(/\n$/, ''))) {
        throw new Error('own ledger record is fused with an adjacent line and cannot be removed without altering other records; ledger left unchanged');
      }
      return 'absent';
    }
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
