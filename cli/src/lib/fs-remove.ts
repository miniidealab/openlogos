/**
 * 递归删除的唯一入口（架构 §五十二 52.3）：直接使用 Node 内置 `maxRetries` / `retryDelay`，
 * 不自建删除重试循环。
 *
 * Node 在 recursive 模式下遇 EBUSY / EMFILE / ENFILE / ENOTEMPTY / EPERM 按线性退避重试
 * （第 n 次等待 n × retryDelay），用尽后抛出；不覆盖 EACCES——删除时的 EACCES 多为真实权限问题，
 * 不重试是正确行为。Windows 上杀毒软件 / 索引器 / IDE 监听短暂持有句柄时由此吸收。
 */
import { rmSync } from 'node:fs';

export const REMOVE_TREE_MAX_RETRIES = 5;
export const REMOVE_TREE_RETRY_DELAY_MS = 100;

export function removeTree(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: REMOVE_TREE_MAX_RETRIES,
    retryDelay: REMOVE_TREE_RETRY_DELAY_MS,
  });
}
