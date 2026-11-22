/**
 * 结果路径运行锁（verification-history，功能规格 §2.104.6，spec/test-results.md「结果路径运行锁」）。
 *
 * - 锁集合：一次运行实际会截断或读取的全部有效结果路径，统一解析为真实路径（不存在的文件按最近已存在祖先解析后拼接）；
 * - 获取：首个截断或读取之前按真实路径排序一次性获取，全有或全无；任一路径被持有即抛 ResultPathBusyError，
 *   已获取的锁全部释放、不触碰任何结果文件；获取途中出现任何 I/O 异常同样先释放已获取的锁再抛出；
 * - 锁原语：复用 baseline-seed-txn 的按路径加锁（code-r1 F1）——完整持有者身份经临时文件 + link 原子发布（无空窗口），
 *   死进程锁的回收经独立 marker 仲裁、重读确认后原子替换，不会误删他人刚发布的活锁；
 * - 锁文件：`logos/.openlogos-runtime/result-locks/<sha256(真实路径)>.lock`；
 * - 释放：显式 release()（调用方在 finally 中调用）；进程退出时兜底释放本进程持有的锁。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { acquireLockAt, lockHeldByCurrentProcessAt, releaseLockAt } from './baseline-seed-txn.js';

export const RESULT_LOCK_DIR = 'logos/.openlogos-runtime/result-locks';

export class ResultPathBusyError extends Error {
  readonly code = 'RESULT_PATH_BUSY';
  /** 冲突的结果路径（项目根相对，正斜杠分隔，字典序）。 */
  readonly paths: string[];
  constructor(paths: string[]) {
    super(`Result path is in use by another verify / smoke run: ${paths.join(', ')}`);
    this.paths = paths;
  }
}

export interface ResultPathLockHandle {
  /** 已持有的结果路径（项目根相对）。 */
  readonly paths: string[];
  release(): void;
}

/** 把路径解析为真实路径：自身或祖先尚不存在时解析最近的已存在祖先再拼回剩余部分。 */
export function resolveRealPath(path: string): string {
  const rest: string[] = [];
  let cur = resolve(path);
  for (;;) {
    try { return join(realpathSync(cur), ...rest); } catch { /* 继续向上 */ }
    const parent = dirname(cur);
    if (parent === cur) return resolve(path);
    rest.unshift(basename(cur));
    cur = parent;
  }
}

function toRel(root: string, abs: string): string {
  return relative(resolveRealPath(root), abs).split(sep).join('/');
}

function lockFileOf(root: string, real: string): string {
  return join(root, RESULT_LOCK_DIR, `${createHash('sha256').update(real).digest('hex')}.lock`);
}

/** 进程内持有表：锁文件 → 释放函数（进程退出兜底）。锁原语的持有表以锁文件路径为键。 */
const held = new Set<string>();
let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => { for (const file of [...held]) releaseFile(file); });
}
function releaseFile(file: string): void {
  held.delete(file);
  try { releaseLockAt(file, file); } catch { /* 已不存在或已被回收 */ }
}

/**
 * 按真实路径排序一次性获取全部锁（全有或全无）。`relPaths` 为项目根相对或绝对路径，空值忽略、重复去重。
 * 冲突时释放已获取的锁并抛 ResultPathBusyError（paths 列出全部冲突路径）；其他异常同样先释放再抛出。
 */
export function acquireResultPathLocks(root: string, relPaths: Array<string | undefined | null>): ResultPathLockHandle {
  const realPaths = [...new Set(
    relPaths.filter((p): p is string => typeof p === 'string' && p.length > 0).map(p => resolveRealPath(resolve(root, p))),
  )].sort();
  installExitHook();
  const acquired: string[] = [];
  const conflicts: string[] = [];
  try {
    mkdirSync(join(root, RESULT_LOCK_DIR), { recursive: true });
    for (const real of realPaths) {
      const file = lockFileOf(root, real);
      // 本进程已持有（同一进程内的上一次调用尚未释放）同样视为冲突：verify / smoke 不可重入
      if (lockHeldByCurrentProcessAt(file, file) || !acquireLockAt(file, file)) {
        conflicts.push(toRel(root, real));
        continue;
      }
      acquired.push(file);
      held.add(file);
    }
  } catch (error) {
    for (const file of acquired) releaseFile(file);
    throw error;
  }
  if (conflicts.length > 0) {
    for (const file of acquired) releaseFile(file);
    throw new ResultPathBusyError(conflicts.sort());
  }
  const paths = realPaths.map(real => toRel(root, real));
  let released = false;
  return {
    paths,
    release() {
      if (released) return;
      released = true;
      for (const file of acquired) releaseFile(file);
    },
  };
}
