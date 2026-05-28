import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
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

const DEFAULT_SANDBOX_ROOT = '/private/tmp';

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

function normalizeAllowedWriteSet(paths: string[]): Set<string> {
  const set = new Set<string>();
  for (const item of paths) {
    const normalized = normalizeRelPath(item);
    if (normalized) set.add(normalized);
  }
  return set;
}

function listFileSnapshots(root: string): Map<string, string> {
  const snapshots = new Map<string, string>();
  if (!existsSync(root)) return snapshots;

  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const rel = normalizeRelPath(relative(root, fullPath));
      if (!rel) continue;
      const stats = lstatSync(fullPath);
      if (stats.isDirectory()) {
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
  return snapshots;
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

function copyBackAllowedFiles(
  sandboxRoot: string,
  workspaceRoot: string,
  changedPaths: string[],
  allowedPaths: Set<string>,
): void {
  for (const relPath of changedPaths) {
    if (!isPathAllowed(relPath, allowedPaths)) continue;
    const src = join(sandboxRoot, relPath);
    const dest = join(workspaceRoot, relPath);
    if (!existsSync(src)) continue;
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true, force: true });
  }
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

  let sandboxBase = sandbox.root;
  if (!sandboxBase || sandboxBase.trim().length === 0) {
    sandboxBase = DEFAULT_SANDBOX_ROOT;
  }

  let sandboxDir = '';
  let sandboxProjectRoot = '';
  try {
    mkdirSync(sandboxBase, { recursive: true });
    sandboxDir = mkdtempSync(join(sandboxBase, 'openlogos-cli-sandbox-'));
    sandboxProjectRoot = join(sandboxDir, 'workspace');
    cpSync(normalizedRoot, sandboxProjectRoot, { recursive: true });
  } catch (error) {
    if (sandboxDir && existsSync(sandboxDir)) {
      rmSync(sandboxDir, { recursive: true, force: true });
    }
    return makeUnsupportedSandboxResult(format, normalizedRoot, command, sandbox, error);
  }

  const baseline = listFileSnapshots(sandboxProjectRoot);
  const commandResult = executeCommand(sandboxProjectRoot, command, format);
  const afterRun = listFileSnapshots(sandboxProjectRoot);
  const changedPaths = collectChangedPaths(baseline, afterRun);
  const allowedSet = normalizeAllowedWriteSet(allowedWritePaths);
  const unauthorizedWrites = sandbox.denyWorkspaceWrite
    ? changedPaths.filter(path => !isPathAllowed(path, allowedSet))
    : [];

  copyBackAllowedFiles(sandboxProjectRoot, normalizedRoot, changedPaths, allowedSet);

  const sandboxData: SandboxData = {
    mode: sandbox.mode,
    root: sandboxDir,
    isolated: true,
    workspace_write_denied: sandbox.denyWorkspaceWrite,
    status: 'pass',
    diagnostics: [],
    suggestions: [],
  };

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

  if (commandResult.status === 'fail' && sandboxData.status === 'pass') {
    sandboxData.diagnostics.push('命令在沙箱内执行失败，请检查 pre-run / smoke 命令输出。');
  }

  if (sandboxData.status === 'warn' && sandboxData.suggestions.length === 0) {
    sandboxData.suggestions.push('如需严格隔离，请将 sandbox_mode 设为 always。');
  }

  rmSync(sandboxDir, { recursive: true, force: true });
  return { command: commandResult, sandbox: sandboxData };
}
