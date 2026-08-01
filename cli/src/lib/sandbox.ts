import { closeSync, constants as fsConstants, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { OutputFormat } from './json-output.js';

export type SandboxMode = 'off' | 'auto' | 'always';
export type SandboxStatus = 'pass' | 'warn' | 'fail' | 'skipped';

export interface NormalizedSandboxConfig {
  mode: SandboxMode;
  root: string;
  denyWorkspaceWrite: boolean;
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
}

export interface SandboxCommandResult {
  status: 'pass' | 'fail';
  exit_code?: number;
  duration_ms?: number;
  error?: string;
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
}

export interface RuntimeWriteProtection {
  available: boolean;
  kind?: 'sandbox-exec' | 'bwrap';
  reason?: string;
}

const DEFAULT_SANDBOX_ROOT = '/private/tmp';
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
        renameSync(tmp, dest);
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

function executeCommand(cwd: string, command: string, format: OutputFormat): SandboxCommandResult {
  const start = Date.now();
  try {
    execSync(command, { cwd, stdio: format === 'json' ? 'pipe' : 'inherit' });
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

export function normalizeSandboxConfig(raw: unknown): NormalizedSandboxConfig {
  const record = asRecord(raw) ?? {};
  const modeRaw = typeof record.sandbox_mode === 'string' ? record.sandbox_mode : 'off';
  const mode: SandboxMode = modeRaw === 'auto' || modeRaw === 'always' ? modeRaw : 'off';
  const root = typeof record.sandbox_root === 'string' && record.sandbox_root.trim().length > 0
    ? record.sandbox_root
    : DEFAULT_SANDBOX_ROOT;
  const denyWorkspaceWrite = typeof record.sandbox_deny_workspace_write === 'boolean'
    ? record.sandbox_deny_workspace_write
    : true;
  return { mode, root, denyWorkspaceWrite };
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
  const { root, command, format, sandbox, allowedWritePaths } = options;
  const normalizedRoot = resolve(root);

  if (sandbox.mode === 'off') {
    return {
      command: executeCommand(normalizedRoot, command, format),
      sandbox: {
        ...buildInitialSandboxData(sandbox),
      },
    };
  }

  // sandbox_root 统一解析为绝对路径（相对值相对项目根解析），
  // 后续临时目录、containment 根、profile 路径与 cwd 全程只使用绝对路径
  let sandboxBase = sandbox.root;
  if (!sandboxBase || sandboxBase.trim().length === 0) {
    sandboxBase = DEFAULT_SANDBOX_ROOT;
  }
  sandboxBase = resolve(normalizedRoot, sandboxBase);

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
      rmSync(sandboxDir, { recursive: true, force: true });
    }
    return makeUnsupportedSandboxResult(format, normalizedRoot, command, sandbox, error);
  }

  // 启动前 realpath containment 校验：逃逸链接按「无法隔离」处理，不进入依赖目录豁免
  const escapingLinks = findEscapingSymlinks(sandboxProjectRoot);
  if (escapingLinks.length > 0) {
    rmSync(sandboxDir, { recursive: true, force: true });
    const preview = escapingLinks.slice(0, 5).join(', ');
    const suffix = escapingLinks.length > 5 ? ' ...' : '';
    const diagnostics = [`沙箱副本存在解析目标逃逸沙箱的 symlink：${preview}${suffix}`];
    if (sandbox.mode === 'always') {
      return {
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
      };
    }
    const plain = executeCommand(normalizedRoot, command, format);
    return {
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
    };
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
        rmSync(sandboxDir, { recursive: true, force: true });
        return {
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
        };
      }
      writeProtectionDegraded = true;
      preDiagnostics.push(`${protectionFailure}；运行期动态 symlink 逃逸不可阻断（残留风险）`);
      preSuggestions.push('当前按兼容策略继续。安装 OS 级写保护机制可消除该残留风险；如需强制阻断，请将 sandbox_mode 设为 always。');
    }
  }

  const baseline = listFileSnapshots(sandboxProjectRoot);
  const commandResult = executeCommand(sandboxProjectRoot, effectiveCommand, format);
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

  rmSync(sandboxDir, { recursive: true, force: true });
  return { command: commandResult, sandbox: sandboxData };
}
