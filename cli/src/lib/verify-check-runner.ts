#!/usr/bin/env node
/**
 * verify 环境预检的检查命令限时执行器（verify-self-sufficient-cases，功能规格 §2.106.4）。
 *
 * 用法：node verify-check-runner.js <timeoutMs> <command>
 * - 检查命令在独立进程组中以 shell 执行，输出经管道转发给上层执行器（上层只截获、不写入诊断与报告）；
 * - 正常结束时以检查命令自身的退出码退出（被信号终止时为 1）；
 * - 超时：截止时间覆盖进程退出与输出管道关闭；到点终止整个进程组，以 124 退出（与 GNU timeout 同一约定），上层据此报「超时」。
 *
 * 由 runSandboxedCommand 调起，因此与预跑命令处于同一沙箱、同一工作目录与同一模块环境中。
 */
import { spawn, spawnSync } from 'node:child_process';

const TIMEOUT_EXIT_CODE = 124;

function killGroup(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { /* 进程组已不存在 */ }
}

function main(): void {
  const [timeoutArg, command] = process.argv.slice(2);
  const timeoutMs = Number(timeoutArg);
  if (!command || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    process.stderr.write('usage: verify-check-runner <timeoutMs> <command>\n');
    process.exit(2);
  }
  // 评审 code-r1 F3：时限覆盖整个检查调用及输出管道的收尾。输出经管道转发，只有子进程退出且其 stdout / stderr
  // 都已关闭（含仍持有管道的后台后代进程退出）才算结束；截止时间一到即终止整个进程组并以 124 退出。
  const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let finished = false;
  const finish = (code: number) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    process.exit(code);
  };
  const timer = setTimeout(() => {
    if (child.pid !== undefined) killGroup(child.pid);
    child.stdout?.destroy();
    child.stderr?.destroy();
    finish(TIMEOUT_EXIT_CODE);
  }, timeoutMs);
  child.stdout?.pipe(process.stdout);
  child.stderr?.pipe(process.stderr);
  child.on('error', () => finish(1));
  // close：进程已退出且全部 stdio 流已关闭
  child.on('close', (code) => {
    // shell 先退出时可能留下不持有管道的后代：一并终止，检查命令不得在预检之后继续运行
    if (child.pid !== undefined) killGroup(child.pid);
    finish(typeof code === 'number' ? code : 1);
  });
}

main();
