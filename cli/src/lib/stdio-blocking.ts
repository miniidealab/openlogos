/**
 * CLI 退出时管道输出完整排空（场景 S16「CLI 入口统一设置阻塞写」EX-2.7 / EX-2.8）。
 *
 * - `ensureBlockingStdio()`：入口最先调用。stdout / stderr 为管道或 socket 时，Node 在 POSIX 上异步写出，
 *   「写出后立即 `process.exit`」会丢弃未排空的尾部（Node spawn 的 socketpair 在 macOS 下 8192 字节即截断）。
 *   对非 TTY 且支持 `setBlocking` 的句柄设阻塞写后，写出调用返回时数据已交给内核，任何退出点都完整。
 * - `withAsyncStdio(fn)` / `enterAsyncStdio()`：同步写阻塞期间事件循环停转，计时器与信号回调都要等写入返回。
 *   输出期间依赖计时器或信号处理的运行期区间（部署执行、watch 常驻期）在区间内切回异步写；
 *   区间可嵌套，按活动深度计数，只有最外层结束时才在事件循环可响应的状态下排空并恢复阻塞。
 *
 * `OPENLOGOS_STDIO_TRACE=<文件>` 时把状态迁移逐行追加到该文件，供测试观测（不影响输出）。
 */
import { appendFileSync } from 'node:fs';

interface BlockingHandle {
  setBlocking(blocking: boolean): number | void;
}

/** 可被设阻塞的输出流（process.stdout / process.stderr 或测试桩）。 */
export interface StdioStream {
  isTTY?: boolean;
  destroyed?: boolean;
  writableLength?: number;
  _handle?: unknown;
  write(chunk: string, cb?: (err?: Error | null) => void): boolean;
}

let tracked: Array<{ stream: StdioStream; handle: BlockingHandle }> = [];
let depth = 0;
/** 异步代次：每次深度 0→1 递增。排空完成者仅在代次未变时恢复阻塞——期间有新区间进入（即使已结束）则本次恢复作废。 */
let generation = 0;

/** 追加一条观测事件（仅 OPENLOGOS_STDIO_TRACE 设置时生效；供常驻区间报告就绪等时点）。 */
export function traceStdioEvent(event: string): void {
  trace(event);
}

function trace(event: string): void {
  const file = process.env.OPENLOGOS_STDIO_TRACE;
  if (!file) return;
  try { appendFileSync(file, `${Date.now()} ${event} depth=${depth}\n`); } catch { /* 观测失败不影响命令 */ }
}

function setAll(blocking: boolean): void {
  for (const { handle } of tracked) {
    try { handle.setBlocking(blocking); } catch { /* 切换失败保持原状 */ }
  }
  trace(blocking ? 'blocking' : 'async');
}

/** 入口调用：非 TTY 且存在 setBlocking 的句柄设阻塞，并记录被设置的句柄；任何异常吞掉。 */
export function ensureBlockingStdio(streams: StdioStream[] = [process.stdout, process.stderr]): void {
  for (const stream of streams) {
    try {
      if (!stream || stream.isTTY) continue;
      if (tracked.some(t => t.stream === stream)) continue;
      const handle = stream._handle as Partial<BlockingHandle> | undefined;
      if (!handle || typeof handle.setBlocking !== 'function') continue;
      const rc = handle.setBlocking(true);
      if (typeof rc === 'number' && rc !== 0) continue;
      tracked.push({ stream, handle: handle as BlockingHandle });
    } catch { /* 不支持的平台保持原状，不引入新失败点 */ }
  }
  if (tracked.length > 0) trace('blocking-set');
}

/** 等待流中已排队的写入全部完成（事件循环照常运转）。 */
function drained(stream: StdioStream): Promise<void> {
  if (stream.destroyed || !stream.writableLength) return Promise.resolve();
  return new Promise(resolve => {
    try {
      stream.write('', () => resolve());
    } catch {
      resolve();
    }
  });
}

/**
 * 进入运行期异步区间，返回释放函数（幂等）。深度 0→1 时递增代次并把记录的句柄切为非阻塞；
 * 释放时深度仍 >0 直接返回（不排空、不恢复）；深度归 0 时排空，排空后深度仍为 0 且代次未变才恢复阻塞。
 * 排空期间有新区间进入即令本次恢复资格失效，由后进入区间以自己的排空屏障覆盖其新增写入后再恢复。
 */
export function enterAsyncStdio(): () => Promise<void> {
  depth++;
  trace('enter');
  if (depth === 1) {
    generation++;
    setAll(false);
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    depth--;
    trace('exit');
    if (depth > 0) return;
    const myGeneration = generation;
    trace('drain-start');
    await Promise.all(tracked.map(t => drained(t.stream)));
    if (depth === 0 && generation === myGeneration) setAll(true);
    else trace('restore-skipped');
  };
}

/** 在运行期异步区间内执行 fn；结束（含抛错）后按深度计数释放。 */
export async function withAsyncStdio<T>(fn: () => T | Promise<T>): Promise<T> {
  const release = enterAsyncStdio();
  try {
    return await fn();
  } finally {
    await release();
  }
}

/** 当前活动异步区间深度（测试观测用）。 */
export function asyncStdioDepth(): number {
  return depth;
}

/** 清空记录的句柄与深度（仅测试用）。 */
export function resetStdioBlockingForTest(): void {
  tracked = [];
  depth = 0;
  generation = 0;
}
