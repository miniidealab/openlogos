import { closeSync, constants as fsConstants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { renameWithRetry } from './fs-retry.js';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { OutputFormat } from './json-output.js';
import { removeTree } from './fs-remove.js';
import {
  acquireGeneration, checkOldWriters, detectLivenessCapability, emptyReuseData, ensureProjectMeta, ensureRealDir, listAbandoned,
  projectDirInsideRoot, projectDirName, readCommandStartUptime, releaseGeneration, resolveCachePaths, RUN_TAG_ENV, syncWorkspace,
  type LivenessResult, type SandboxLease, type SandboxReuseData,
} from './sandbox-reuse.js';

export type SandboxMode = 'off' | 'auto' | 'always';
export type SandboxStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface NormalizedSandboxConfig {
  mode: SandboxMode;
  root: string;
  denyWorkspaceWrite: boolean;
  /** §2.91：`sandbox_reuse`（默认 true，读取时补）；仅在 mode 为 auto / always 时生效。 */
  reuse?: boolean;
  /** §2.91.5：`sandbox_cache_paths`（默认 []），工作区相对路径，合法性在执行时按白名单判定。 */
  cachePaths?: string[];
}

export interface SandboxData {
  mode: SandboxMode;
  root: string;
  isolated: boolean;
  workspace_write_denied: boolean;
  status: SandboxStatus;
  diagnostics: string[];
  suggestions: string[];
  /** 信息级说明通道（additive、可选）：仅承载不影响 status 的说明，如依赖目录豁免提示。 */
  infos?: string[];
  /** §2.91.8：沙箱复用状态（additive、可选）；sandbox_mode=off 时不出现。 */
  reuse?: SandboxReuseData;
}

export interface SandboxCommandResult {
  status: 'pass' | 'fail';
  exit_code?: number;
  duration_ms?: number;
  error?: string;
  /** 仅 `--format json`：命令 stdout / stderr 的有界尾部（功能规格 §2.7，决策 C02）。 */
  stdout_tail?: string;
  stderr_tail?: string;
}

/** 输出尾部上限：末尾最多 80 行且不超过 8 KiB（功能规格 §2.7）。 */
export const OUTPUT_TAIL_MAX_LINES = 80;
export const OUTPUT_TAIL_MAX_BYTES = 8 * 1024;
/** 截获时每条输出流在内存中只保留的末尾窗口：足够容纳 80 行 + ANSI，又不随命令输出量增长。 */
const OUTPUT_TAIL_READ_WINDOW = 1024 * 1024;

// CSI / OSC / 两字符转义序列（颜色、光标、标题等）。正则有意匹配 ESC / BEL 控制字符。
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[@-Z\\-_])/g;

/** 从 UTF-8 字节缓冲的起点跳过续字节，使截断落在完整字符边界。 */
function alignUtf8Start(buf: Buffer): Buffer {
  let i = 0;
  while (i < buf.length && i < 4 && (buf[i] & 0xc0) === 0x80) i++;
  return i > 0 ? buf.subarray(i) : buf;
}

/**
 * 有界输出尾部（纯函数，可单测）：去除 ANSI 控制序列后，先取末尾最多 80 行，再按字节截到不超过
 * 8 KiB，截断落在完整 UTF-8 字符边界。`headTruncated` 表示传入字节不是输出开头（已按窗口截取）。
 */
export function boundedOutputTail(bytes: Buffer, headTruncated = false): string {
  const start = headTruncated ? alignUtf8Start(bytes) : bytes;
  const text = start.toString('utf8').replace(ANSI_PATTERN, '');
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  let tail = lines.slice(-OUTPUT_TAIL_MAX_LINES).join('\n');
  const encoded = Buffer.from(tail, 'utf8');
  if (encoded.length > OUTPUT_TAIL_MAX_BYTES) {
    tail = alignUtf8Start(encoded.subarray(encoded.length - OUTPUT_TAIL_MAX_BYTES)).toString('utf8');
  }
  return tail;
}

/**
 * 截获助手（在独立 node 进程中执行）：以管道流式消费命令的 stdout / stderr，每条流只在内存中保留末尾
 * 窗口（超出即丢弃开头），命令结束后把退出码、信号与两段窗口一次性写回。输出全文既不落盘，也不进入
 * 父进程的 `maxBuffer`——父进程收到的始终是有界的窗口。
 */
const CAPTURE_HELPER = `
const { spawn } = require('node:child_process');
const WINDOW = Number(process.argv[1]);
const command = process.argv[2];
const sink = () => ({ chunks: [], size: 0, truncated: false });
function push(s, chunk) {
  s.chunks.push(chunk); s.size += chunk.length;
  while (s.size > WINDOW) {
    const over = s.size - WINDOW; const first = s.chunks[0];
    if (first.length <= over) { s.chunks.shift(); s.size -= first.length; }
    else { s.chunks[0] = Buffer.from(first.subarray(over)); s.size -= over; }
    s.truncated = true;
  }
}
const out = sink(); const err = sink(); let finished = false;
function finish(r) {
  if (finished) return; finished = true;
  process.stdout.write(JSON.stringify({ ...r,
    out: Buffer.concat(out.chunks).toString('base64'), outTruncated: out.truncated,
    err: Buffer.concat(err.chunks).toString('base64'), errTruncated: err.truncated }));
}
const detached = process.argv[3] === 'group';
let child;
try { child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'], detached }); }
catch (e) { finish({ status: null, signal: null, error: String((e && e.message) || e) }); }
if (child && detached) {
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { process.kill(-child.pid, sig); } catch {} });
}
if (child) {
  child.stdout.on('data', c => push(out, c));
  child.stderr.on('data', c => push(err, c));
  child.on('error', e => finish({ status: null, signal: null, error: String((e && e.message) || e) }));
  child.on('close', (status, signal) => finish({ status, signal, pgid: detached ? child.pid : null }));
}
`;

/**
 * 文本模式的进程组助手（§2.91.6「旧写入者存活检查」）：输出实时继承到终端，命令置于独立进程组，
 * 转发中断信号，结束后把退出码、信号与 pgid 写入报告文件。
 */
const GROUP_TEXT_HELPER = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const reportPath = process.argv[1];
const command = process.argv[2];
let child;
const done = (r) => { try { fs.writeFileSync(reportPath, JSON.stringify(r)); } catch {} };
try { child = spawn(command, { shell: true, stdio: 'inherit', detached: true }); }
catch (e) { done({ status: null, signal: null, error: String((e && e.message) || e), pgid: null }); process.exit(1); }
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { try { process.kill(-child.pid, sig); } catch {} });
child.on('error', e => { done({ status: null, signal: null, error: String((e && e.message) || e), pgid: child.pid }); });
child.on('exit', (status, signal) => { done({ status, signal, pgid: child.pid }); process.exit(status === null ? 1 : status); });
`;

interface CaptureReport {
  status: number | null;
  signal: string | null;
  pgid?: number | null;
  error?: string;
  out: string;
  outTruncated: boolean;
  err: string;
  errTruncated: boolean;
}

export interface SandboxExecutionResult {
  command: SandboxCommandResult;
  sandbox: SandboxData;
}

export interface RunSandboxedCommandOptions {
  root: string;
  command: string;
  format: OutputFormat;
  sandbox: NormalizedSandboxConfig;
  allowedWritePaths: string[];
  /** §2.91.7：`--fresh-sandbox`，成功获取锁后新建空的工作区世代。 */
  freshSandbox?: boolean;
}

export interface RuntimeWriteProtection {
  available: boolean;
  kind?: 'sandbox-exec' | 'bwrap';
  reason?: string;
}

/**
 * 历史版本 init / sync 固化进配置的默认根。它只在 darwin 上是有效临时目录；在其它平台上
 * 视为「未显式配置」，读取时按平台解析（架构 §五十二 52.6）。
 */
export const LEGACY_DEFAULT_SANDBOX_ROOT = '/private/tmp';

/**
 * 沙箱默认根按平台在**读取时**解析，不在生成配置时固化为某台机器的绝对路径：
 * darwin 为 /private/tmp（sandbox-exec profile 与 realpath 口径），其余为 os.tmpdir()。
 */
export function resolveDefaultSandboxRoot(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? LEGACY_DEFAULT_SANDBOX_ROOT : tmpdir();
}
const EXEMPT_DIR_NAME = 'node_modules';
export const DEPENDENCY_DIR_EXEMPT_INFO = '依赖目录 node_modules 为沙箱内一次性目录，不参与写入审计，不会回收到工作区。';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function commandExitCode(error: unknown): number | undefined {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

function commandErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error && error.message) return error.message.slice(0, 500);
  if (error !== undefined && error !== null) return String(error).slice(0, 500);
  return undefined;
}

function normalizeRelPath(path: string): string {
  return normalize(path).replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

/**
 * 依赖目录豁免匹配（精确路径段边界）：规范化并统一分隔符后，
 * 仅当至少一个完整路径段严格等于 `node_modules` 时命中；
 * 禁止子串 / 前缀 / 后缀匹配（`node_modules-cache`、`my-node_modules`、`node_modules.txt` 均不豁免）。
 */
export function isDependencyExemptPath(path: string): boolean {
  const normalized = normalizeRelPath(path);
  if (!normalized) return false;
  return normalized.split('/').some(segment => segment === EXEMPT_DIR_NAME);
}

interface AllowedWriteSet {
  allowed: Set<string>;
  violations: string[];
}

/**
 * 白名单路径校验：只接受严格的 workspace 相对路径。
 * 绝对路径、规范化后仍含 `..` 的越界路径一律判违规——既不参与审计放行，也不参与回收。
 */
function buildAllowedWriteSet(paths: string[]): AllowedWriteSet {
  const allowed = new Set<string>();
  const violations: string[] = [];
  for (const item of paths) {
    if (typeof item !== 'string' || item.trim().length === 0) continue;
    if (isAbsolute(item)) {
      violations.push(`白名单路径必须为 workspace 相对路径，拒绝绝对路径：${item}`);
      continue;
    }
    const normalized = normalizeRelPath(item);
    if (!normalized) continue;
    if (normalized.split('/').some(segment => segment === '..')) {
      violations.push(`白名单路径解析后越出 workspace，已拒绝：${item}`);
      continue;
    }
    allowed.add(normalized);
  }
  return { allowed, violations };
}

interface SnapshotResult {
  snapshots: Map<string, string>;
  sawDependencyDir: boolean;
}

function listFileSnapshots(root: string): SnapshotResult {
  const snapshots = new Map<string, string>();
  let sawDependencyDir = false;
  if (!existsSync(root)) return { snapshots, sawDependencyDir };

  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = normalizeRelPath(relative(root, fullPath));
      if (!rel) continue;
      const stats = lstatSync(fullPath);
      if (stats.isDirectory()) {
        // 依赖目录豁免：快照遍历直接跳过 node_modules（任意层级，完整段名相等）
        if (entry.name === EXEMPT_DIR_NAME) {
          sawDependencyDir = true;
          continue;
        }
        walk(fullPath);
        continue;
      }
      if (stats.isSymbolicLink()) {
        snapshots.set(rel, `l:${readlinkSync(fullPath)}`);
        continue;
      }
      snapshots.set(rel, `f:${stats.size}:${Math.floor(stats.mtimeMs)}`);
    }
  };

  walk(root);
  return { snapshots, sawDependencyDir };
}

function collectChangedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const changed = new Set<string>();
  for (const [path, signature] of before.entries()) {
    const next = after.get(path);
    if (next === undefined || next !== signature) changed.add(path);
  }
  for (const path of after.keys()) {
    if (!before.has(path)) changed.add(path);
  }
  return Array.from(changed).sort();
}

function isPathAllowed(path: string, allowed: Set<string>): boolean {
  if (allowed.has(path)) return true;
  for (const allow of allowed) {
    if (!allow) continue;
    if (path.startsWith(`${allow}/`)) return true;
  }
  return false;
}

function isWithin(root: string, target: string): boolean {
  const normalizedTarget = normalize(target);
  return normalizedTarget === root || normalizedTarget.startsWith(`${root}${sep}`);
}

/**
 * 白名单回收定点采集（加固版）：
 * - 源必须是沙箱副本内的普通文件（lstat 判定，symlink / 目录 / 特殊文件一律拒绝）；
 * - 源 realpath 必须 containment 于沙箱 workspace；
 * - 目标父链逐段 no-follow 校验，任一段为 symlink 即拒绝（防原 workspace 既有链接重定向）；
 * - 以临时文件 + 原子 rename 落盘。
 * 返回违规清单；违规路径不回收。
 */
function copyBackAllowedFiles(
  sandboxRoot: string,
  workspaceRoot: string,
  allowedPaths: Set<string>,
): string[] {
  const violations: string[] = [];
  let sandboxRealRoot: string;
  try {
    sandboxRealRoot = realpathSync(sandboxRoot);
  } catch {
    return violations;
  }

  for (const relPath of allowedPaths) {
    const src = join(sandboxRoot, relPath);
    let srcStats;
    try {
      srcStats = lstatSync(src);
    } catch {
      continue; // 沙箱内不存在：正常跳过
    }
    if (srcStats.isSymbolicLink()) {
      violations.push(`白名单结果路径在沙箱内是 symlink，拒绝回收：${relPath}`);
      continue;
    }
    if (!srcStats.isFile()) {
      violations.push(`白名单结果路径在沙箱内不是普通文件，拒绝回收：${relPath}`);
      continue;
    }
    try {
      const srcReal = realpathSync(src);
      if (!isWithin(sandboxRealRoot, srcReal)) {
        violations.push(`白名单结果路径解析目标越出沙箱，拒绝回收：${relPath}`);
        continue;
      }
    } catch {
      violations.push(`白名单结果路径无法解析，拒绝回收：${relPath}`);
      continue;
    }

    // 目标父链 no-follow containment：任一中间段是 symlink 即拒绝
    const segments = relPath.split('/');
    let parentChainSafe = true;
    let cursor = workspaceRoot;
    for (const segment of segments.slice(0, -1)) {
      cursor = join(cursor, segment);
      try {
        if (lstatSync(cursor).isSymbolicLink()) {
          violations.push(`回收目标父链含 symlink，拒绝回收：${relPath}`);
          parentChainSafe = false;
          break;
        }
      } catch {
        break; // 目标父目录尚不存在：后续 mkdirSync 创建真实目录，安全
      }
    }
    if (!parentChainSafe) continue;

    const dest = join(workspaceRoot, relPath);
    const destDir = dirname(dest);
    try {
      mkdirSync(destDir, { recursive: true });
    } catch (error) {
      violations.push(`白名单结果路径回收失败（${commandErrorMessage(error) ?? 'unknown'}）：${relPath}`);
      continue;
    }

    // 临时文件必须不可预测且以原子、排他、no-follow 方式创建：
    // 可预测名 + copyFileSync 会跟随预置在该叶节点的 symlink，把非白名单文件改写掉。
    // O_CREAT|O_EXCL 保证路径已存在（含 symlink）时直接失败，绝不跟随；EEXIST 时换随机名重试。
    let written = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3 && !written; attempt++) {
      const tmp = join(destDir, `.olcb-${randomBytes(8).toString('hex')}.tmp`);
      let fd: number | undefined;
      let created = false;
      try {
        const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY
          | ((fsConstants as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0);
        fd = openSync(tmp, flags, 0o644);
        created = true;
        writeSync(fd, readFileSync(src));
        closeSync(fd);
        fd = undefined;
        // Windows 瞬时文件锁有界重试（架构 §五十二 52.3）；外层循环仍只为 EEXIST 换名
        renameWithRetry(tmp, dest);
        written = true;
      } catch (error) {
        if (fd !== undefined) closeSync(fd);
        // 只清理本次确实由我们创建的临时文件；EEXIST 冲突对象归他人所有，绝不删除
        if (created && !written) rmSync(tmp, { force: true });
        lastError = error;
        if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') break;
      }
    }
    if (!written) {
      violations.push(`白名单结果路径回收失败（${commandErrorMessage(lastError) ?? 'unknown'}）：${relPath}`);
    }
  }
  return violations;
}

/**
 * 启动前 symlink containment 校验：沙箱 workspace 内可达的每个 symlink，
 * 其解析目标必须仍位于沙箱 workspace 内；返回逃逸链接的相对路径列表。
 */
function findEscapingSymlinks(root: string): string[] {
  const escaping: string[] = [];
  if (!existsSync(root)) return escaping;

  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const stats = lstatSync(fullPath);
      if (stats.isSymbolicLink()) {
        const literal = readlinkSync(fullPath);
        const literalTarget = isAbsolute(literal) ? normalize(literal) : resolve(dirname(fullPath), literal);
        if (!isWithin(root, literalTarget)) {
          escaping.push(normalizeRelPath(relative(root, fullPath)));
          continue;
        }
        try {
          const real = realpathSync(fullPath);
          if (!isWithin(realpathSync(root), real)) {
            escaping.push(normalizeRelPath(relative(root, fullPath)));
          }
        } catch {
          // 悬空链接：字面量目标已在沙箱内，按内部链接处理
        }
        continue;
      }
      if (stats.isDirectory()) walk(fullPath);
    }
  };

  walk(root);
  return escaping.sort();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function sbplQuote(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

let cachedWriteProtectionProbe: RuntimeWriteProtection | undefined;

/**
 * 运行期写保护能力探测（结果按进程缓存）：
 * - macOS: sandbox-exec（实际试跑一次探测，嵌套沙箱环境会自然探测为不可用）
 * - Linux: bubblewrap（bwrap）
 * - 其他平台 / 机制缺失：不可用，由调用方按能力分层处理
 * 设置 OPENLOGOS_SANDBOX_WRITE_PROTECTION=off 可强制视为不可用（测试与逃生口）。
 */
export function detectRuntimeWriteProtection(): RuntimeWriteProtection {
  if (process.env.OPENLOGOS_SANDBOX_WRITE_PROTECTION === 'off') {
    return { available: false, reason: 'OPENLOGOS_SANDBOX_WRITE_PROTECTION=off 已显式禁用运行期写保护' };
  }
  if (cachedWriteProtectionProbe) return cachedWriteProtectionProbe;

  let probe: RuntimeWriteProtection;
  if (process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec')) {
    try {
      execSync(`/usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true`, { stdio: 'ignore' });
      probe = { available: true, kind: 'sandbox-exec' };
    } catch {
      probe = { available: false, reason: 'sandbox-exec 探测失败（可能处于嵌套沙箱环境）' };
    }
  } else if (process.platform === 'linux') {
    try {
      execSync('bwrap --dev-bind / / /bin/true', { stdio: 'ignore' });
      probe = { available: true, kind: 'bwrap' };
    } catch {
      probe = { available: false, reason: 'bubblewrap（bwrap）不可用或无权限创建命名空间' };
    }
  } else {
    probe = { available: false, reason: `当前平台（${process.platform}）无受支持的 OS 级写保护机制` };
  }

  cachedWriteProtectionProbe = probe;
  return probe;
}

interface BuiltWriteProtection {
  probeCommand: string;
  wrap: (command: string) => string;
}

/**
 * 用最终生成的 profile / 绑定参数构造保护器，并提供精确预检命令：
 * 保护器建立失败必须与用户命令失败分开归因（能力分层，而非伪装成测试失败）。
 */
function buildWriteProtection(
  kind: 'sandbox-exec' | 'bwrap',
  protectedRoot: string,
  sandboxDir: string,
): BuiltWriteProtection {
  if (kind === 'sandbox-exec') {
    const profilePath = join(sandboxDir, 'write-protect.sb');
    const profile = `(version 1)\n(allow default)\n(deny file-write* (subpath "${sbplQuote(protectedRoot)}"))\n`;
    writeFileSync(profilePath, profile);
    return {
      probeCommand: `/usr/bin/sandbox-exec -f ${shellQuote(profilePath)} /usr/bin/true`,
      wrap: command => `/usr/bin/sandbox-exec -f ${shellQuote(profilePath)} /bin/sh -c ${shellQuote(command)}`,
    };
  }
  const bind = `bwrap --dev-bind / / --ro-bind ${shellQuote(protectedRoot)} ${shellQuote(protectedRoot)} --die-with-parent`;
  return {
    probeCommand: `${bind} /bin/true`,
    wrap: command => `${bind} /bin/sh -c ${shellQuote(command)}`,
  };
}

/**
 * JSON 模式的命令执行（功能规格 §2.7「预跑命令输出尾部」、场景 S13 EX-9.4「输出全文不落盘」）：
 * 经截获助手以管道流式消费 stdout / stderr，内存中只保留有界末尾窗口，子进程不会因输出过大被
 * `maxBuffer` 提前终止，退出码如实保留，输出全文不写入任何临时文件。此前用 `execSync` + `pipe`，
 * 输出被丢弃，超过默认 1 MiB 还会杀掉子进程。
 */
/** 复用模式下命令的进程组执行参数：注入运行标记，命令置于独立进程组以便事后探测旧写入者。 */
interface GroupExec { env: NodeJS.ProcessEnv; reportDir: string }
type GroupedCommandResult = SandboxCommandResult & { pgid?: number | null };

function executeCommandCapturing(cwd: string, command: string, group?: GroupExec): GroupedCommandResult {
  const start = Date.now();
  const helperArgs = ['-e', CAPTURE_HELPER, String(OUTPUT_TAIL_READ_WINDOW), command];
  if (group) helperArgs.push('group');
  const helper = spawnSync(process.execPath, helperArgs, {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 8 * OUTPUT_TAIL_READ_WINDOW,
    ...(group ? { env: group.env } : {}),
  });
  let report: CaptureReport | null = null;
  if (!helper.error) {
    try { report = JSON.parse(helper.stdout) as CaptureReport; } catch { report = null; }
  }
  const duration_ms = Date.now() - start;
  if (!report) {
    const reason = helper.error ? commandErrorMessage(helper.error) : `输出截获失败：${(helper.stderr || '').trim()}`;
    return { status: 'fail', duration_ms, error: `${reason ?? 'Command failed'}`.slice(0, 500), stdout_tail: '', stderr_tail: '' };
  }
  const stdout_tail = boundedOutputTail(Buffer.from(report.out, 'base64'), report.outTruncated);
  const stderr_tail = boundedOutputTail(Buffer.from(report.err, 'base64'), report.errTruncated);
  const pgid = group ? (report.pgid ?? null) : undefined;
  if (!report.error && report.status === 0) {
    return { status: 'pass', exit_code: 0, duration_ms, stdout_tail, stderr_tail, ...(group ? { pgid } : {}) };
  }
  const reason = report.error
    ? report.error
    : (report.signal ? `Command failed (signal ${report.signal}): ${command}` : `Command failed: ${command}`);
  return {
    status: 'fail',
    exit_code: typeof report.status === 'number' ? report.status : undefined,
    duration_ms,
    error: `${reason ?? 'Command failed'}${stderr_tail ? `\n${stderr_tail}` : ''}`.slice(0, 500),
    stdout_tail,
    stderr_tail,
    ...(group ? { pgid } : {}),
  };
}

function executeGroupedText(cwd: string, command: string, group: GroupExec): GroupedCommandResult {
  const start = Date.now();
  const reportPath = join(group.reportDir, `.olexec-${randomBytes(6).toString('hex')}.json`);
  const helper = spawnSync(process.execPath, ['-e', GROUP_TEXT_HELPER, reportPath, command], {
    cwd, stdio: 'inherit', env: group.env,
  });
  let report: { status: number | null; signal: string | null; error?: string; pgid: number | null } | null = null;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { report = null; }
  rmSync(reportPath, { force: true });
  const duration_ms = Date.now() - start;
  if (!report) {
    const reason = helper.error ? commandErrorMessage(helper.error) : 'Command failed';
    return { status: 'fail', exit_code: typeof helper.status === 'number' ? helper.status : undefined, duration_ms, error: reason, pgid: null };
  }
  if (!report.error && report.status === 0) return { status: 'pass', exit_code: 0, duration_ms, pgid: report.pgid };
  return {
    status: 'fail',
    exit_code: typeof report.status === 'number' ? report.status : undefined,
    duration_ms,
    error: (report.error ?? (report.signal ? `Command failed (signal ${report.signal}): ${command}` : `Command failed: ${command}`)).slice(0, 500),
    pgid: report.pgid,
  };
}

function executeCommand(cwd: string, command: string, format: OutputFormat, group?: GroupExec): GroupedCommandResult {
  if (group) return format === 'json' ? executeCommandCapturing(cwd, command, group) : executeGroupedText(cwd, command, group);
  if (format === 'json') return executeCommandCapturing(cwd, command);
  const start = Date.now();
  try {
    // 文本模式：输出实时打到终端，不截获（功能规格 §2.7）。
    execSync(command, { cwd, stdio: 'inherit' });
    return {
      status: 'pass',
      exit_code: 0,
      duration_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'fail',
      exit_code: commandExitCode(error),
      duration_ms: Date.now() - start,
      error: commandErrorMessage(error),
    };
  }
}

function makeUnsupportedSandboxResult(
  format: OutputFormat,
  root: string,
  command: string,
  config: NormalizedSandboxConfig,
  error: unknown,
): SandboxExecutionResult {
  const message = commandErrorMessage(error) ?? 'sandbox initialization failed';
  const diagnostics = [`无法启用沙箱：${message}`];
  if (config.mode === 'always') {
    return {
      command: {
        status: 'fail',
        error: `sandbox_mode=always requires isolation, but setup failed: ${message}`,
      },
      sandbox: {
        mode: config.mode,
        root: config.root,
        isolated: false,
        workspace_write_denied: config.denyWorkspaceWrite,
        status: 'fail',
        diagnostics,
        suggestions: ['检查 sandbox_root 是否可写，或修复当前运行环境的隔离能力。'],
      },
    };
  }

  const plain = executeCommand(root, command, format);
  return {
    command: plain,
    sandbox: {
      mode: config.mode,
      root: config.root,
      isolated: false,
      workspace_write_denied: config.denyWorkspaceWrite,
      status: 'warn',
      diagnostics,
      suggestions: ['当前按兼容模式执行。若需强制隔离，请将 sandbox_mode 设为 always。'],
    },
  };
}

export function normalizeSandboxConfig(
  raw: unknown,
  platform: NodeJS.Platform = process.platform,
): NormalizedSandboxConfig {
  const record = asRecord(raw) ?? {};
  const modeRaw = typeof record.sandbox_mode === 'string' ? record.sandbox_mode : 'off';
  const mode: SandboxMode = modeRaw === 'auto' || modeRaw === 'always' ? modeRaw : 'off';
  const configured = typeof record.sandbox_root === 'string' && record.sandbox_root.trim().length > 0
    ? record.sandbox_root
    : null;
  // 历史生成的 /private/tmp 在非 darwin 上视为未显式配置；其它用户显式值原样尊重。
  const root = configured === null || (configured === LEGACY_DEFAULT_SANDBOX_ROOT && platform !== 'darwin')
    ? resolveDefaultSandboxRoot(platform)
    : configured;
  const denyWorkspaceWrite = typeof record.sandbox_deny_workspace_write === 'boolean'
    ? record.sandbox_deny_workspace_write
    : true;
  // §2.91.2：默认值在读取时补齐，不回写配置
  const reuse = typeof record.sandbox_reuse === 'boolean' ? record.sandbox_reuse : true;
  const cachePaths = Array.isArray(record.sandbox_cache_paths)
    ? record.sandbox_cache_paths.map(item => (typeof item === 'string' ? item : String(item)))
    : [];
  return { mode, root, denyWorkspaceWrite, reuse, cachePaths };
}

export function buildInitialSandboxData(config: NormalizedSandboxConfig): SandboxData {
  return {
    mode: config.mode,
    root: config.root,
    isolated: false,
    workspace_write_denied: config.denyWorkspaceWrite,
    status: 'skipped',
    diagnostics: [],
    suggestions: [],
  };
}

export function runSandboxedCommand(options: RunSandboxedCommandOptions): SandboxExecutionResult {
  const { root, command, format, sandbox } = options;
  const normalizedRoot = resolve(root);

  if (sandbox.mode === 'off') {
    return {
      command: executeCommand(normalizedRoot, command, format),
      sandbox: {
        ...buildInitialSandboxData(sandbox),
      },
    };
  }

  // §2.91.9：sandbox_reuse=false 走一次性临时沙箱，行为逐字不变，仅附 reuse.disabled
  if (sandbox.reuse === false) {
    return withReuse(runOneOffSandbox(options, normalizedRoot), emptyReuseData('disabled', false));
  }
  return runReusableSandbox(options, normalizedRoot);
}

/** 解析沙箱根为绝对路径（相对值相对项目根解析）。 */
function resolveSandboxBase(normalizedRoot: string, sandbox: NormalizedSandboxConfig): string {
  let sandboxBase = sandbox.root;
  if (!sandboxBase || sandboxBase.trim().length === 0) {
    sandboxBase = resolveDefaultSandboxRoot();
  }
  return resolve(normalizedRoot, sandboxBase);
}

/** 一次性临时沙箱：每次 mkdtemp + 全量复制，执行后删除（引入复用前的行为）。 */
function runOneOffSandbox(options: RunSandboxedCommandOptions, normalizedRoot: string): SandboxExecutionResult {
  const { command, format, sandbox } = options;
  // sandbox_root 统一解析为绝对路径（相对值相对项目根解析），
  // 后续临时目录、containment 根、profile 路径与 cwd 全程只使用绝对路径
  const sandboxBase = resolveSandboxBase(normalizedRoot, sandbox);

  let sandboxDir = '';
  let sandboxProjectRoot = '';
  try {
    mkdirSync(sandboxBase, { recursive: true });
    sandboxDir = mkdtempSync(join(sandboxBase, 'openlogos-cli-sandbox-'));
    sandboxProjectRoot = join(sandboxDir, 'workspace');
    // symlink 隔离不变量（启动前）：保持链接目标字面量，禁止默认复制语义把相对链接改写为指向原 workspace 的绝对路径
    cpSync(normalizedRoot, sandboxProjectRoot, { recursive: true, verbatimSymlinks: true });
  } catch (error) {
    if (sandboxDir && existsSync(sandboxDir)) {
      removeTree(sandboxDir);
    }
    return makeUnsupportedSandboxResult(format, normalizedRoot, command, sandbox, error);
  }

  return runPreparedSandbox(options, normalizedRoot, sandboxDir, sandboxProjectRoot).result;
}

interface PreparedRun {
  result: SandboxExecutionResult;
  /** 命令是否实际在沙箱内执行（未执行时无旧写入者需检查）。 */
  commandRan: boolean;
  pgid: number | null;
}

/**
 * 沙箱目录已就绪后的共用流程：逃逸 symlink 扫描 → 运行期写保护 → 基线快照 → 执行 → 写入审计 → 白名单定点回收。
 * `group` 缺省为一次性沙箱（结束时删除 sandboxDir，行为与引入复用前逐字一致）；给出时为持久沙箱
 * （不删除目录，命令置于独立进程组并注入运行标记，由调用方做旧写入者存活检查与释放）。
 */
function runPreparedSandbox(
  options: RunSandboxedCommandOptions,
  normalizedRoot: string,
  sandboxDir: string,
  sandboxProjectRoot: string,
  group?: GroupExec,
): PreparedRun {
  const { command, format, sandbox, allowedWritePaths } = options;
  const persistent = Boolean(group);

  // 启动前 realpath containment 校验：逃逸链接按「无法隔离」处理，不进入依赖目录豁免
  const escapingLinks = findEscapingSymlinks(sandboxProjectRoot);
  if (escapingLinks.length > 0) {
    if (!persistent) removeTree(sandboxDir);
    const preview = escapingLinks.slice(0, 5).join(', ');
    const suffix = escapingLinks.length > 5 ? ' ...' : '';
    const diagnostics = [`沙箱副本存在解析目标逃逸沙箱的 symlink：${preview}${suffix}`];
    if (sandbox.mode === 'always') {
      return { commandRan: false, pgid: null, result: {
        command: {
          status: 'fail',
          error: `sandbox_mode=always requires isolation, but sandbox copy contains escaping symlinks: ${preview}${suffix}`,
        },
        sandbox: {
          mode: sandbox.mode,
          root: sandbox.root,
          isolated: false,
          workspace_write_denied: sandbox.denyWorkspaceWrite,
          status: 'fail',
          diagnostics,
          suggestions: ['修复或移除逃逸 symlink 后重试；内部相对链接应保持相对语义。'],
        },
      } };
    }
    const plain = executeCommand(normalizedRoot, command, format);
    return { commandRan: false, pgid: null, result: {
      command: plain,
      sandbox: {
        mode: sandbox.mode,
        root: sandbox.root,
        isolated: false,
        workspace_write_denied: sandbox.denyWorkspaceWrite,
        status: 'warn',
        diagnostics: [...diagnostics, '已降级为非隔离执行。'],
        suggestions: ['修复逃逸 symlink 以恢复隔离执行；若需强制隔离，请将 sandbox_mode 设为 always。'],
      },
    } };
  }

  // 运行期写保护（运行期不可逃逸不变量）：在写入发生前于文件系统层阻断对原 workspace 的写入，
  // 覆盖运行期新建 / 改写（retarget）的 symlink；机制不可用或保护器建立失败时按能力分层处理。
  let effectiveCommand = command;
  const preDiagnostics: string[] = [];
  const preSuggestions: string[] = [];
  let writeProtectionDegraded = false;
  if (sandbox.denyWorkspaceWrite) {
    const wp = detectRuntimeWriteProtection();
    let protectionFailure: string | null = null;
    if (wp.available && wp.kind) {
      let protectedRoot = normalizedRoot;
      try {
        protectedRoot = realpathSync(normalizedRoot);
      } catch {
        // 保底用 resolve 后路径
      }
      try {
        const protection = buildWriteProtection(wp.kind, protectedRoot, sandboxDir);
        // 用最终 profile / 绑定参数做精确预检：建立失败归因于保护器，而非用户命令
        execSync(protection.probeCommand, { stdio: 'ignore' });
        effectiveCommand = protection.wrap(command);
      } catch (error) {
        protectionFailure = `运行期写保护建立失败：${commandErrorMessage(error) ?? 'unknown'}`;
      }
    } else {
      protectionFailure = `无法启用运行期写保护：${wp.reason ?? 'unknown'}`;
    }

    if (protectionFailure) {
      if (sandbox.mode === 'always') {
        if (!persistent) removeTree(sandboxDir);
        return { commandRan: false, pgid: null, result: {
          command: {
            status: 'fail',
            error: `sandbox_mode=always requires runtime write protection, but it is unavailable: ${protectionFailure}`,
          },
          sandbox: {
            mode: sandbox.mode,
            root: sandbox.root,
            isolated: false,
            workspace_write_denied: sandbox.denyWorkspaceWrite,
            status: 'fail',
            diagnostics: [protectionFailure],
            suggestions: ['安装或启用 OS 级写保护机制（macOS sandbox-exec / Linux bubblewrap），或将 sandbox_mode 降为 auto。'],
          },
        } };
      }
      writeProtectionDegraded = true;
      preDiagnostics.push(`${protectionFailure}；运行期动态 symlink 逃逸不可阻断（残留风险）`);
      preSuggestions.push('当前按兼容策略继续。安装 OS 级写保护机制可消除该残留风险；如需强制阻断，请将 sandbox_mode 设为 always。');
    }
  }

  const baseline = listFileSnapshots(sandboxProjectRoot);
  const executed = executeCommand(sandboxProjectRoot, effectiveCommand, format, group);
  const pgid = executed.pgid ?? null;
  delete executed.pgid;
  const commandResult: SandboxCommandResult = executed;
  const afterRun = listFileSnapshots(sandboxProjectRoot);
  const changedPaths = collectChangedPaths(baseline.snapshots, afterRun.snapshots);
  const { allowed: allowedSet, violations: allowlistViolations } = buildAllowedWriteSet(allowedWritePaths);
  const unauthorizedWrites = sandbox.denyWorkspaceWrite
    ? changedPaths.filter(path => !isPathAllowed(path, allowedSet) && !isDependencyExemptPath(path))
    : [];

  // 审计已判 always 失败时不回收任何对象——原 workspace 保持零变化
  const skipCopyBack = sandbox.denyWorkspaceWrite && sandbox.mode === 'always' && unauthorizedWrites.length > 0;
  const copyBackViolations = skipCopyBack
    ? []
    : copyBackAllowedFiles(sandboxProjectRoot, normalizedRoot, allowedSet);

  const sandboxData: SandboxData = {
    mode: sandbox.mode,
    root: sandboxDir,
    isolated: true,
    workspace_write_denied: sandbox.denyWorkspaceWrite,
    status: writeProtectionDegraded ? 'warn' : 'pass',
    diagnostics: [...preDiagnostics],
    suggestions: [...preSuggestions],
  };

  // 依赖目录豁免可观测性：沙箱副本内存在任一命中完整段规则的目录（含嵌套 monorepo 形态、
  // 含运行期新建）即输出信息级说明；只进 infos，不影响 status、不进问题诊断
  if (sandbox.denyWorkspaceWrite && (baseline.sawDependencyDir || afterRun.sawDependencyDir)) {
    sandboxData.infos = [DEPENDENCY_DIR_EXEMPT_INFO];
  }

  if (unauthorizedWrites.length > 0) {
    const preview = unauthorizedWrites.slice(0, 5).join(', ');
    sandboxData.diagnostics.push(`检测到非白名单写入：${preview}${unauthorizedWrites.length > 5 ? ' ...' : ''}`);
    if (sandbox.mode === 'always') {
      sandboxData.status = 'fail';
      sandboxData.suggestions.push('仅允许写入结果文件白名单；请调整测试脚本输出目录。');
      commandResult.status = 'fail';
      if (!commandResult.error) {
        commandResult.error = 'sandbox_mode=always blocked non-whitelist writes';
      }
    } else {
      sandboxData.status = 'warn';
      sandboxData.suggestions.push('当前按兼容策略继续。若需强制阻断，请将 sandbox_mode 设为 always。');
    }
  }

  const recoveryViolations = [...allowlistViolations, ...copyBackViolations];
  if (recoveryViolations.length > 0) {
    const preview = recoveryViolations.slice(0, 5).join('；');
    sandboxData.diagnostics.push(`白名单回收校验未通过：${preview}${recoveryViolations.length > 5 ? ' ...' : ''}`);
    if (sandbox.mode === 'always') {
      sandboxData.status = 'fail';
      commandResult.status = 'fail';
      if (!commandResult.error) {
        commandResult.error = 'sandbox_mode=always rejected unsafe whitelist artifacts during copy-back';
      }
      sandboxData.suggestions.push('白名单结果路径必须是 workspace 相对路径下的普通文件；请检查配置与测试脚本产物。');
    } else if (sandboxData.status !== 'fail') {
      sandboxData.status = 'warn';
      sandboxData.suggestions.push('部分白名单结果路径未通过回收校验，本次未回收；请检查配置与测试脚本产物。');
    }
  }

  if (commandResult.status === 'fail' && sandboxData.status === 'pass') {
    sandboxData.diagnostics.push('命令在沙箱内执行失败，请检查 pre-run / smoke 命令输出。');
  }

  if (sandboxData.status === 'warn' && sandboxData.suggestions.length === 0) {
    sandboxData.suggestions.push('如需严格隔离，请将 sandbox_mode 设为 always。');
  }

  // 收尾清理失败降级为告警：测试已跑完、结论已得出，清理失败不得覆盖命令结果（架构 §五十二 52.6）。
  if (!persistent) {
    try {
      removeTree(sandboxDir);
    } catch (error) {
      sandboxData.diagnostics.push(`沙箱目录清理失败（${commandErrorMessage(error) ?? 'unknown'}）：${sandboxDir}`);
      if (sandboxData.status === 'pass') sandboxData.status = 'warn';
    }
  }
  return { commandRan: true, pgid, result: { command: commandResult, sandbox: sandboxData } };
}

function withReuse(result: SandboxExecutionResult, reuse: SandboxReuseData, info?: string): SandboxExecutionResult {
  result.sandbox.reuse = reuse;
  if (info) result.sandbox.infos = Array.from(new Set([...(result.sandbox.infos ?? []), info]));
  return result;
}

/** 一次性退回（busy-fallback / unsupported）：走一次性临时沙箱的全部既有行为，附 reuse 状态与信息级说明。 */
function fallbackOneOff(
  options: RunSandboxedCommandOptions,
  normalizedRoot: string,
  state: 'busy-fallback' | 'unsupported',
  dir: string | null,
  reason: string,
): SandboxExecutionResult {
  const label = state === 'busy-fallback' ? '持久沙箱被占用或无法确认' : '当前环境无法复用沙箱';
  return withReuse(
    runOneOffSandbox(options, normalizedRoot),
    emptyReuseData(state, true, dir),
    `沙箱复用：${state}（${label}：${reason}），本次退回一次性临时沙箱。`,
  );
}

function reuseSummary(reuse: SandboxReuseData): string {
  return `沙箱复用：${reuse.state}（世代 ${reuse.generation}；复制 ${reuse.copied}、删除 ${reuse.removed}、内容比较 ${reuse.content_compared}；同步 ${reuse.sync_ms} ms）`;
}

/**
 * 持久沙箱（功能规格 §2.91）：获取世代锁 → 建立目标世代 → 镜像同步 → 共用执行流程 →
 * 旧写入者存活检查 → 释放（released / tainted）。锁被占用 / 无法确认 / 环境不支持时退回一次性沙箱。
 */
function runReusableSandbox(options: RunSandboxedCommandOptions, normalizedRoot: string): SandboxExecutionResult {
  const { command, format, sandbox, allowedWritePaths } = options;

  const capability = detectLivenessCapability();
  if (!capability.available) {
    return fallbackOneOff(options, normalizedRoot, 'unsupported', null, capability.reason ?? 'unknown');
  }

  const sandboxBase = resolveSandboxBase(normalizedRoot, sandbox);
  let projectDir = '';
  try {
    mkdirSync(sandboxBase, { recursive: true });
    projectDir = join(sandboxBase, projectDirName(normalizedRoot));
    ensureRealDir(projectDir);
    if (projectDirInsideRoot(projectDir, normalizedRoot)) {
      throw new Error(`持久沙箱项目目录位于项目根之内：${projectDir}`);
    }
    ensureProjectMeta(projectDir, normalizedRoot);
  } catch (error) {
    return withReuse(
      makeUnsupportedSandboxResult(format, normalizedRoot, command, sandbox, error),
      emptyReuseData('unsupported', true, projectDir || null),
    );
  }

  let outcome;
  try {
    outcome = acquireGeneration(projectDir, options.freshSandbox === true);
  } catch (error) {
    return fallbackOneOff(options, normalizedRoot, 'busy-fallback', projectDir, commandErrorMessage(error) ?? 'unknown');
  }
  if (outcome.kind === 'busy') return fallbackOneOff(options, normalizedRoot, 'busy-fallback', projectDir, outcome.reason);
  if (outcome.kind === 'unsupported') return fallbackOneOff(options, normalizedRoot, 'unsupported', projectDir, outcome.reason);

  const lease: SandboxLease = outcome.lease;
  let state = lease.state;
  let pgid: number | null = null;
  let commandRan = false;
  let released = false;
  let commandStartedUptime: number | null = null;
  const release = (liveness: LivenessResult) => {
    if (released) return;
    released = true;
    releaseGeneration(lease, { pgid, liveness, commandStartedUptime });
  };

  try {
    // 目录操作只在锁记录发布成功之后进行（§2.91.6「先定目标、再发布」）
    if (lease.deleteAfterPublish) removeTree(join(projectDir, lease.deleteAfterPublish));
    // 世代目录 no-follow：被换成链接或非目录时只删除链接本身并按空世代全量同步，绝不进入其目标
    const wsStat = (() => { try { return lstatSync(lease.wsDir); } catch { return null; } })();
    if (state === 'reused' && !(wsStat && wsStat.isDirectory())) state = 'created';
    if (state !== 'reused' && wsStat) removeTree(lease.wsDir);
    ensureRealDir(lease.wsDir);
    // 写保护 profile 由执行器写在世代目录内：先删除可能被预置为链接的旧文件，避免写入跟随链接
    rmSync(join(lease.wsDir, 'write-protect.sb'), { force: true });

    const cache = resolveCachePaths(sandbox.cachePaths ?? [], allowedWritePaths);
    let stats;
    try {
      stats = syncWorkspace(normalizedRoot, lease.wsDir, cache.valid);
    } catch (error) {
      release({ ok: true });
      return withReuse(
        makeUnsupportedSandboxResult(format, normalizedRoot, command, sandbox, error),
        { ...emptyReuseData(state, true, projectDir), generation: lease.wsName },
      );
    }

    const group: GroupExec = { env: { ...process.env, [RUN_TAG_ENV]: lease.runTag }, reportDir: lease.wsDir };
    // §2.92.3：命令启动之前记录启动时刻（Linux），供存活检查排除早于命令启动的长寿进程
    commandStartedUptime = readCommandStartUptime();
    const prepared = runPreparedSandbox(options, normalizedRoot, lease.wsDir, join(lease.wsDir, 'workspace'), group);
    commandRan = prepared.commandRan;
    pgid = prepared.pgid;

    const liveness = commandRan ? checkOldWriters(pgid, lease.runTag, commandStartedUptime) : { ok: true };
    release(liveness);

    const reuse: SandboxReuseData = {
      enabled: true,
      state,
      dir: projectDir,
      generation: lease.wsName,
      copied: stats.copied,
      removed: stats.removed,
      content_compared: stats.content_compared,
      sync_ms: stats.sync_ms,
      abandoned: listAbandoned(projectDir, lease.wsName, null),
    };
    const result = prepared.result;
    if (cache.diagnostics.length > 0) {
      result.sandbox.diagnostics.push(...cache.diagnostics);
      if (result.sandbox.status === 'pass') result.sandbox.status = 'warn';
      result.sandbox.suggestions.push('修正 sandbox_cache_paths：只能声明工作区相对路径，且不得与结果文件路径重叠。');
    }
    const infos = [reuseSummary(reuse)];
    if (!liveness.ok) {
      infos.push(`本轮命令留下仍在运行的进程或无法确认其已退出（${liveness.reason ?? 'unknown'}），下次运行将新建工作区世代。`);
    }
    if (reuse.abandoned.length > 0) {
      infos.push(`存在被弃用的沙箱工作区世代，确认无进程使用后可手动删除：${reuse.abandoned.join('、')}`);
    }
    result.sandbox.reuse = reuse;
    result.sandbox.infos = Array.from(new Set([...(result.sandbox.infos ?? []), ...infos]));
    return result;
  } finally {
    if (!released) {
      // 异常路径：命令已执行则仍按存活检查结论释放；未执行则无旧写入者
      try {
        release(commandRan ? checkOldWriters(pgid, lease.runTag, commandStartedUptime) : { ok: true });
      } catch {
        // 释放失败：锁保持未释放，下次按「持有者已不存在」新建世代
      }
    }
  }
}
