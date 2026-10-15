/**
 * 部署脚本执行器（spec/environments.md §11.3、§11.7；来源变更 environment-deploy）。
 *
 * - 以参数数组直接执行、不经 shell；子进程放入独立进程组（POSIX detached），超时终止整个进程树；
 * - 捕获的输出按行遮盖已声明密钥的值（长度 < 4 的值不替换）后写入部署日志，文本模式同时实时回显；
 * - 返回退出码、是否超时、耗时与输出尾部（末尾 80 行或 8 KiB，取先到者）。
 */
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const OUTPUT_TAIL_MAX_LINES = 80;
export const OUTPUT_TAIL_MAX_BYTES = 8 * 1024;
/** 子进程退出后等待输出管道关闭的上限：脚本遗留的后台进程持有管道时不无限等待。 */
const PIPE_DRAIN_GRACE_MS = 2000;
/** 单行缓冲上限：超长且无换行的输出按块冲刷，避免无界内存。 */
const LINE_BUFFER_MAX = 64 * 1024;

export interface DeployScriptRun {
  /** 可执行文件的绝对路径。 */
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** 部署日志的绝对路径（目录不存在时创建）。 */
  logPath: string;
  /** 需要遮盖的密钥值（调用方传入已声明 secrets 在进程环境中的值）。 */
  secretValues: string[];
  /** 文本模式实时回显到终端；JSON 模式为 false（stdout 只能有 JSON）。 */
  echo: boolean;
}

export interface DeployScriptResult {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  /** 已遮盖的输出尾部。 */
  outputTail: string;
  /** 子进程无法启动时的原因（如 EACCES）；否则 null。 */
  spawnError: string | null;
  /** stdout 最后一个非空行（未遮盖原文，供 CI 适配脚本的 JSON 协议解析；不写入日志之外的任何地方）。 */
  lastStdoutLine: string | null;
}

/** 遮盖密钥值：长度不足 4 的值不替换；长值优先，避免短值先替换破坏长值。 */
export function makeSecretMasker(values: string[]): (text: string) => string {
  const secrets = [...new Set(values.filter(v => v.length >= 4))].sort((a, b) => b.length - a.length);
  if (secrets.length === 0) return text => text;
  return text => secrets.reduce((acc, s) => acc.split(s).join('***'), text);
}

/** 输出尾部：先取末尾 80 行，再截到 8 KiB 以内（按字节，从行首对齐）。 */
export function tailOf(lines: string[]): string {
  let text = lines.slice(-OUTPUT_TAIL_MAX_LINES).join('\n');
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length > OUTPUT_TAIL_MAX_BYTES) {
    text = buf.subarray(buf.length - OUTPUT_TAIL_MAX_BYTES).toString('utf-8').replace(/^�+/, '');
  }
  return text;
}

function killTree(pid: number | undefined): void {
  if (pid == null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
    } else {
      try { process.kill(-pid, 'SIGKILL'); } // 整个进程组（detached 起的）
      catch { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
  } catch { /* best-effort */ }
}

/**
 * 跨行、跨数据块的流式密钥遮盖（review code-r1 F1）：已声明密钥可能含换行（如多行私钥），也可能被拆进两次 data 事件，
 * 因此遮盖必须先于分行，且只放出「不可能与后续数据拼成密钥」的前缀——保留末尾 最长密钥长度-1 个字符，
 * 并且切点不落在任何一处密钥出现的中间。原始片段在遮盖前不写日志、不回显。
 */
export function createStreamMasker(values: string[]): { push: (chunk: string) => string; end: () => string } {
  const secrets = [...new Set(values.filter(v => v.length >= 4))].sort((a, b) => b.length - a.length);
  const mask = makeSecretMasker(values);
  if (secrets.length === 0) return { push: chunk => chunk, end: () => '' };
  const hold = secrets[0].length - 1;
  let pending = '';
  return {
    push(chunk) {
      pending += chunk;
      let cut = pending.length - hold;
      if (cut <= 0) return '';
      for (let moved = true; moved;) {
        moved = false;
        for (const s of secrets) {
          // 跨越切点的出现：起点在 (cut - s.length, cut) 内
          for (let i = pending.indexOf(s, Math.max(0, cut - s.length + 1)); i !== -1 && i < cut; i = pending.indexOf(s, i + 1)) {
            if (i + s.length > cut) { cut = i; moved = true; break; }
          }
        }
      }
      const out = mask(pending.slice(0, cut));
      pending = pending.slice(cut);
      return out;
    },
    end() {
      const out = mask(pending);
      pending = '';
      return out;
    },
  };
}

/** 执行部署脚本。不抛错：启动失败以 spawnError 返回。 */
export function runDeployScript(run: DeployScriptRun): Promise<DeployScriptResult> {
  const mask = makeSecretMasker(run.secretValues);
  mkdirSync(dirname(run.logPath), { recursive: true });
  const logFd = openSync(run.logPath, 'a');
  const tailLines: string[] = [];
  const started = Date.now();

  // 已遮盖的行：写日志、进尾部、文本模式回显
  const emitLine = (line: string, stream: 'stdout' | 'stderr') => {
    writeSync(logFd, `${line}\n`);
    tailLines.push(line);
    if (tailLines.length > OUTPUT_TAIL_MAX_LINES) tailLines.shift();
    if (run.echo) (stream === 'stdout' ? process.stdout : process.stderr).write(`${line}\n`);
  };
  type Stream = 'stdout' | 'stderr';
  const decoders: Record<Stream, StringDecoder> = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  const maskers = { stdout: createStreamMasker(run.secretValues), stderr: createStreamMasker(run.secretValues) };
  const buffers: Record<Stream, string> = { stdout: '', stderr: '' };
  // stdout 最后一个非空行的原文只留在内存，供 CI 适配脚本的 JSON 协议解析
  let rawStdoutLine = '';
  let lastStdoutLine: string | null = null;
  const trackRaw = (text: string) => {
    rawStdoutLine += text;
    const parts = rawStdoutLine.split('\n');
    rawStdoutLine = parts.pop() ?? '';
    for (const p of parts) if (p.trim() !== '') lastStdoutLine = p.trim();
    if (rawStdoutLine.length > LINE_BUFFER_MAX) rawStdoutLine = rawStdoutLine.slice(-LINE_BUFFER_MAX);
  };
  const splitLines = (stream: Stream, maskedText: string) => {
    buffers[stream] += maskedText;
    let nl: number;
    while ((nl = buffers[stream].indexOf('\n')) !== -1) {
      emitLine(buffers[stream].slice(0, nl).replace(/\r$/, ''), stream);
      buffers[stream] = buffers[stream].slice(nl + 1);
    }
    // 超长无换行输出（已遮盖）：按块冲刷，避免无界内存
    if (buffers[stream].length > LINE_BUFFER_MAX) {
      emitLine(buffers[stream], stream);
      buffers[stream] = '';
    }
  };
  const onData = (stream: Stream) => (chunk: Buffer) => {
    const text = decoders[stream].write(chunk);
    if (stream === 'stdout') trackRaw(text);
    splitLines(stream, maskers[stream].push(text));
  };
  const flush = () => {
    for (const stream of ['stdout', 'stderr'] as const) {
      const rest = decoders[stream].end();
      if (stream === 'stdout') trackRaw(rest);
      splitLines(stream, maskers[stream].push(rest) + maskers[stream].end());
      if (buffers[stream] !== '') emitLine(buffers[stream], stream);
      buffers[stream] = '';
    }
    if (rawStdoutLine.trim() !== '') lastStdoutLine = rawStdoutLine.trim();
  };

  return new Promise(resolve => {
    let settled = false;
    let timedOut = false;
    const timers: { kill?: NodeJS.Timeout; drain?: NodeJS.Timeout } = {};
    const signalHandlers: Array<[NodeJS.Signals, () => void]> = [];

    const finish = (exitCode: number | null, spawnError: string | null) => {
      if (settled) return;
      settled = true;
      if (timers.kill) clearTimeout(timers.kill);
      if (timers.drain) clearTimeout(timers.drain);
      for (const [sig, h] of signalHandlers) process.removeListener(sig, h);
      flush();
      if (spawnError) emitLine(mask(spawnError), 'stderr');
      closeSync(logFd);
      resolve({ exitCode, timedOut, durationMs: Date.now() - started, outputTail: tailOf(tailLines), spawnError, lastStdoutLine });
    };

    let child;
    try {
      child = spawn(run.command, run.args, {
        cwd: run.cwd, env: run.env, shell: false, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      });
    } catch (error) {
      finish(null, (error as Error).message);
      return;
    }
    child.stdout?.on('data', onData('stdout'));
    child.stderr?.on('data', onData('stderr'));
    child.on('error', error => finish(null, error.message));

    let exitCode: number | null = null;
    child.on('exit', (code) => {
      exitCode = timedOut ? null : code;
      // 输出管道可能被遗留的后台进程持有：给有限时间读完剩余输出
      timers.drain = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish(exitCode, null);
      }, PIPE_DRAIN_GRACE_MS);
    });
    child.on('close', () => finish(exitCode, null));

    timers.kill = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, run.timeoutMs);

    // CLI 被中断时连同部署进程树一起终止（子进程在独立进程组中，不会收到终端信号）
    for (const sig of ['SIGINT', 'SIGTERM'] as NodeJS.Signals[]) {
      const h = () => {
        killTree(child.pid);
        process.exit(130);
      };
      signalHandlers.push([sig, h]);
      process.once(sig, h);
    }
  });
}
