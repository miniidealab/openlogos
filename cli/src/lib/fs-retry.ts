/**
 * Windows 瞬时文件锁下的 rename 有界重试（架构 §五十二 52.3）。
 *
 * - 只覆盖 rename：Node 对 `renameSync` 没有内置重试；递归删除走 Node 内置 `maxRetries`，不在此处。
 * - 只在 win32 生效，且错误码判据复用 archive-watch 的既有实现（EPERM / EACCES / EBUSY），不另写一份。
 * - 有界：退避总和约 1 秒；用尽后原样抛出最后一次错误，调用方既有回滚路径不变。
 * - 非瞬时错误（如 ENOENT）或非 win32 平台：不重试，立即抛出（POSIX 行为零变化）。
 */
import { renameSync } from 'node:fs';
import { isWindowsArchiveBusyError } from './archive-watch.js';

/** 与 archive-watch 同一导出实现（单一判据，UT-S39-91 断言引用相等）。 */
export const isTransientWindowsFsError = isWindowsArchiveBusyError;

/** 逐次退避（毫秒），总和 1000。 */
export const WINDOWS_RENAME_RETRY_DELAYS_MS: readonly number[] = [10, 20, 40, 80, 160, 250, 440];

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function renameWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      if (process.platform !== 'win32'
        || !isTransientWindowsFsError(error)
        || attempt >= WINDOWS_RENAME_RETRY_DELAYS_MS.length) throw error;
      sleepSync(WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
}
