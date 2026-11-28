/**
 * 验收期间的只读 git 执行入口（功能规格 §2.111.2，verify-git-local-only）。
 *
 * `openlogos verify` 自己启动的 git 子进程都经这里执行，三项约束只在这一处实现：
 *   1. 不连接远端、不取回对象：传输协议白名单置空（`GIT_ALLOW_PROTOCOL=`），并设置 `GIT_NO_LAZY_FETCH=1`。
 *      识别该开关的 Git（2.45 起）缺对象时直接失败；不识别的 Git 可能启动一个 fetch 子进程，但在建立传输之前被白名单拒绝。
 *   2. 不弹出凭据或终端提示：`GIT_TERMINAL_PROMPT=0`。
 *   3. 有时限：每次调用单独计时，超过即以 SIGKILL 终止子进程并返回 `timedOut`——返回时该子进程已退出。
 *
 * 本模块是叶子模块，只依赖 node 内置。时限没有用户配置项；下面三个接缝只在 `NODE_ENV=test` 下生效。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** 没有既有时限的调用的缺省时限。 */
export const GIT_READONLY_DEFAULT_TIMEOUT_MS = 60_000;

/** 说明文字：因本地缺少对象而失败（§2.111.4）。 */
export const GIT_LOCAL_OBJECT_MISSING_NOTE = '本地缺少对象，验收不从远端取回';

/** 测试接缝（仅 `NODE_ENV=test`）：覆盖时限，用约 1 秒驱动真实的超时终止。 */
export const TEST_TIMEOUT_OVERRIDE_ENV = 'OPENLOGOS_TEST_GIT_READONLY_TIMEOUT_MS';
/** 测试接缝（仅 `NODE_ENV=test`）：JSON 字符串数组，参数（空格连接）包含其中任一项的调用直接返回超时结果，不启动子进程。 */
export const TEST_TIMEOUT_INJECT_ENV = 'OPENLOGOS_TEST_GIT_READONLY_TIMEOUT_MATCH';
/**
 * 测试接缝（仅 `NODE_ENV=test`）：JSON 字符串数组 `[命令, ...前置参数]`，代替 `git` 作为被启动的程序（git 的参数接在其后）。
 * 用于让一个记录型程序先记下自己实际收到的环境变量再转交真实的 git——这种拦截不依赖 PATH 查找与可执行脚本，
 * 在 Windows 上同样可用。
 */
export const TEST_COMMAND_ENV = 'OPENLOGOS_TEST_GIT_READONLY_COMMAND';
/** 测试接缝（仅 `NODE_ENV=test`）：文件路径；每次调用追加一行 `{ args, timeout_ms }`，用于断言各调用实际使用的时限。 */
export const TEST_TRACE_ENV = 'OPENLOGOS_TEST_GIT_READONLY_TRACE';
/** 测试接缝（仅 `NODE_ENV=test`）：值为 `off` 时不设置 `GIT_NO_LAZY_FETCH`，只保留置空的协议白名单（模拟不识别该开关的 Git）。 */
export const TEST_LAZY_SWITCH_ENV = 'OPENLOGOS_TEST_GIT_READONLY_LAZY_SWITCH';

export interface GitReadonlyOptions {
  /** 本次调用的时限；缺省 60 秒。已有时限的调用方传入自己的值。 */
  timeoutMs?: number;
  maxBuffer?: number;
}

export interface GitReadonlyResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: unknown;
  /** 超过时限被终止（或经测试接缝注入）。 */
  timedOut: boolean;
  /** 本次调用实际使用的时限（毫秒）。 */
  timeoutMs: number;
  /** 失败且 stderr 表明本地读不到对象（缺对象且未取回）。 */
  missingObject: boolean;
}

export interface GitReadonlyBufferResult extends Omit<GitReadonlyResult, 'stdout'> { stdout: Buffer }

const inTest = (): boolean => process.env.NODE_ENV === 'test';

/** 三项约束对应的环境变量；`LC_ALL=C` 只为让 stderr 的诊断文字稳定可识别。 */
export function gitReadonlyEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, GIT_ALLOW_PROTOCOL: '', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' };
  if (inTest() && base[TEST_LAZY_SWITCH_ENV] === 'off') delete env.GIT_NO_LAZY_FETCH;
  else env.GIT_NO_LAZY_FETCH = '1';
  return env;
}

function effectiveTimeout(requested: number | undefined): number {
  if (inTest()) {
    const override = Number(process.env[TEST_TIMEOUT_OVERRIDE_ENV]);
    if (Number.isFinite(override) && override > 0) return override;
  }
  return requested !== undefined && Number.isFinite(requested) && requested > 0 ? requested : GIT_READONLY_DEFAULT_TIMEOUT_MS;
}

/** 被启动的程序：缺省 `git`；测试接缝可换成记录型程序。 */
function gitCommand(): string[] {
  if (inTest()) {
    try {
      const parsed = JSON.parse(process.env[TEST_COMMAND_ENV] ?? 'null') as unknown;
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(item => typeof item === 'string' && item.length > 0)) return parsed as string[];
    } catch { /* 取值非法时用缺省 */ }
  }
  return ['git'];
}

function injectedTimeout(args: string[]): boolean {
  if (!inTest()) return false;
  const raw = process.env[TEST_TIMEOUT_INJECT_ENV];
  if (!raw) return false;
  try {
    const patterns = JSON.parse(raw) as unknown;
    if (!Array.isArray(patterns)) return false;
    const joined = args.join(' ');
    return patterns.some(p => typeof p === 'string' && p.length > 0 && joined.includes(p));
  } catch {
    return false;
  }
}

/** stderr 是否表明「本地缺少对象且没有取回」（禁用取回后的读失败，或传输被白名单拒绝）。 */
const MISSING_OBJECT_RE = /lazy fetching disabled|transport '[^']*' not allowed|unable to read [0-9a-f]{7,}|missing (?:blob|tree|commit|object)|could not fetch [0-9a-f]{7,} from promisor/i;

function run(root: string, args: string[], opts: GitReadonlyOptions): GitReadonlyBufferResult {
  const timeoutMs = effectiveTimeout(opts.timeoutMs);
  const empty = Buffer.alloc(0);
  if (inTest() && process.env[TEST_TRACE_ENV]) {
    // 记录调用方请求的时限（不受时限覆盖接缝影响），供测试断言「既有时限保留原值」
    try { appendFileSync(process.env[TEST_TRACE_ENV]!, `${JSON.stringify({ args, timeout_ms: opts.timeoutMs ?? GIT_READONLY_DEFAULT_TIMEOUT_MS })}\n`); } catch { /* 只是观测 */ }
  }
  if (injectedTimeout(args)) {
    return { status: null, stdout: empty, stderr: '', timedOut: true, timeoutMs, missingObject: false };
  }
  const [command, ...prefix] = gitCommand();
  const r = spawnSync(command, [...prefix, ...args], {
    cwd: root, encoding: 'buffer', env: gitReadonlyEnv(), stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
  });
  const stderr = r.stderr ? r.stderr.toString('utf8') : '';
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  const failed = timedOut || Boolean(r.error) || r.status !== 0;
  return {
    status: r.status, stdout: r.stdout ?? empty, stderr, error: r.error, timedOut, timeoutMs,
    missingObject: failed && !timedOut && MISSING_OBJECT_RE.test(stderr),
  };
}

/** 执行一个只读 git 调用，文本输出。 */
export function runGitReadonly(root: string, args: string[], opts: GitReadonlyOptions = {}): GitReadonlyResult {
  const r = run(root, args, opts);
  return { ...r, stdout: r.stdout.toString('utf8') };
}

/** 执行一个只读 git 调用，原始字节输出（读取 blob 内容用）。 */
export function runGitReadonlyBuffer(root: string, args: string[], opts: GitReadonlyOptions = {}): GitReadonlyBufferResult {
  return run(root, args, opts);
}

/**
 * 在同步回调执行期间把三项约束的环境变量放进当前进程环境，返回前恢复——供必须经既有读取函数（自行启动 git、
 * 继承进程环境）读取的调用方使用。时限由被调用的函数自己负责。
 */
export function withGitReadonlyEnv<T>(fn: () => T): T {
  const next = gitReadonlyEnv();
  const keys = ['GIT_ALLOW_PROTOCOL', 'GIT_NO_LAZY_FETCH', 'GIT_TERMINAL_PROMPT', 'LC_ALL'] as const;
  const saved = keys.map(key => [key, process.env[key]] as const);
  for (const key of keys) {
    if (next[key] === undefined) delete process.env[key];
    else process.env[key] = next[key];
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** 为验收历史读取提交号的时限（与 `verification-history.ts` 的既有读取相同）。 */
export const HISTORY_HEAD_TIMEOUT_MS = 10_000;
/** 为验收历史读取工作区状态的时限（同上）。 */
export const HISTORY_STATUS_TIMEOUT_MS = 30_000;

/**
 * 提案级验收写历史记录用的提交快照（§2.111.5）：与历史记录的缺省读取同样的两条命令、同样的时限与取值规则，
 * 只是经只读执行入口执行。非 git 项目或 git 不可用时为 `{ head: null, dirty: null }`。
 */
export function readCommitSnapshotReadonly(root: string): { head: string | null; dirty: boolean | null } {
  const head = runGitReadonly(root, ['rev-parse', 'HEAD'], { timeoutMs: HISTORY_HEAD_TIMEOUT_MS });
  if (head.error || head.status !== 0 || !head.stdout.trim()) return { head: null, dirty: null };
  const status = runGitReadonly(root, ['status', '--porcelain', '--untracked-files=no'], { timeoutMs: HISTORY_STATUS_TIMEOUT_MS });
  return { head: head.stdout.trim(), dirty: !status.error && status.status === 0 ? status.stdout.trim().length > 0 : null };
}

/** 失败说明的后缀（§2.111.4）：超时写明时限秒数；本地缺少对象写明不取回；其余为空。 */
export function gitFailureNote(r: Pick<GitReadonlyResult, 'timedOut' | 'timeoutMs' | 'missingObject'>): string {
  if (r.timedOut) return `超时，时限 ${Math.round(r.timeoutMs / 100) / 10} 秒`;
  if (r.missingObject) return GIT_LOCAL_OBJECT_MISSING_NOTE;
  return '';
}
