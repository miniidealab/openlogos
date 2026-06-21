/**
 * flow-cmd — M2 切片 1b：cmd: 谓词的命令求值器。
 *
 * 见 spec/flow-spec.md §9.2。**仅 next 路径调用**（status/watch 不执行、显示 pending）。
 * - shell 执行（`spawn(cmd, { shell: true, cwd: 项目根 })`）；信任委托宿主，不沙箱/不转义。
 * - 两级可配超时；超时尽力终止 shell 及其子进程树（POSIX 进程组 / Windows taskkill /T）。
 * - stdout/stderr 持续 drain 防阻塞、丢弃（≤64KiB 边界内；命令输出不进契约）。
 * - 命令不存在 = shell exit 127/9009（非 0，非 spawn 失败）；仅 child_process `'error'` 事件 → CmdSpawnError。
 */
import { spawn } from 'node:child_process';

export interface CmdRunResult {
  exitCode: number | null; // 超时为 null
  timedOut: boolean;
}

/** shell 进程本身无法启动（child_process `'error'` 事件）→ 上层转 FLOW_CMD_SPAWN_FAILED。 */
export class CmdSpawnError extends Error {
  constructor(public errno: string, public command: string) {
    super(`命令无法启动：${command}（${errno}）`);
    this.name = 'CmdSpawnError';
  }
}

export interface RunFlowCmdOpts {
  /** 仅内部测试用：注入 shell 路径（如不可执行路径以稳定触发 'error'）；默认 true。 */
  shell?: string | boolean;
}

function killTree(pid: number | undefined): void {
  if (pid == null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    } else {
      try { process.kill(-pid, 'SIGKILL'); } // 进程组（detached 起的）
      catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  } catch { /* best-effort */ }
}

/**
 * 执行 cmd 命令。exit 0 → done 信号；非 0 / 超时 → 未 done。shell 起不来 → reject(CmdSpawnError)。
 */
export function runFlowCmd(
  command: string,
  cwd: string,
  timeoutSec: number,
  opts: RunFlowCmdOpts = {},
): Promise<CmdRunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: opts.shell ?? true,
      cwd,
      detached: process.platform !== 'win32', // POSIX 进程组，便于超时杀子树
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let timedOut = false;
    let settled = false;
    // 持续 drain 防 pipe 写满阻塞子进程；命令输出不入契约，直接丢弃（≤64KiB 边界内）。
    child.stdout?.on('data', () => { /* drain & discard */ });
    child.stderr?.on('data', () => { /* drain & discard */ });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, Math.max(1, timeoutSec) * 1000);

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new CmdSpawnError(err.code ?? err.message, command));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: timedOut ? null : code, timedOut });
    });
  });
}
