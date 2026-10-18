import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSandboxConfig, type NormalizedSandboxConfig } from './sandbox.js';

export const DEFAULT_VERIFY_RESULT_PATH = 'logos/resources/verify/test-results.jsonl';
export const DEFAULT_VERIFY_MERGE_STRATEGY = 'last-write-wins';
export const DEFAULT_SANDBOX_MODE = 'auto';
export const DEFAULT_SANDBOX_DENY_WORKSPACE_WRITE = true;

export interface VerifyConfig {
  result_path?: string;
  pre_run_command?: string;
  test_command?: string;
  regression_command?: string;
  incremental_command?: string;
  regression_result_path?: string;
  incremental_result_path?: string;
  merge_results?: string;
  sandbox_mode?: 'off' | 'auto' | 'always';
  sandbox_root?: string;
  sandbox_deny_workspace_write?: boolean;
  /** module-scoped-verify（§2.96.1）：模块级测试命令，三字段与项目级同语义。 */
  modules?: Record<string, { pre_run_command?: string; regression_command?: string; incremental_command?: string }>;
}

/** 一个模块的命令组（三字段均缺省 = 未配置模块级命令）。 */
export interface ModuleCommandConfig {
  preRunCommand?: string;
  regressionCommand?: string;
  incrementalCommand?: string;
}

export interface NormalizedVerifyConfig {
  resultPath: string;
  preRunCommand?: string;
  regressionCommand?: string;
  incrementalCommand?: string;
  regressionResultPath?: string;
  incrementalResultPath?: string;
  mergeStrategy: 'last-write-wins';
  sandbox: NormalizedSandboxConfig;
  /**
   * module-scoped-verify：`verify.modules.<id>` 中至少配置了一个命令字段的模块。
   * 只在模块范围已启用（或 --all）时被消费；未启用时 verify 完全不读取它。
   */
  moduleCommands: Record<string, ModuleCommandConfig>;
  /** `verify.modules` 的全部键（含未配置任何命令字段的项），用于未登记模块 id 的警告。 */
  moduleCommandIds: string[];
}

export interface VerifyPreRunBackfillResult {
  status: 'exists' | 'added' | 'todo';
  command?: string;
  mutated: boolean;
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function hasFile(root: string, relativePath: string): boolean {
  return existsSync(join(root, relativePath));
}

function hasAnyFile(root: string, relativePaths: string[]): boolean {
  return relativePaths.some(path => hasFile(root, path));
}

function hasDependency(pkg: Record<string, unknown>, name: string): boolean {
  const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  return sections.some(section => {
    const deps = asRecord(pkg[section]);
    return Boolean(deps && typeof deps[name] === 'string');
  });
}

function isUsefulTestScript(script: string): boolean {
  const normalized = script.toLowerCase();
  return !normalized.includes('no test specified')
    && !normalized.includes('exit 1')
    && normalized.trim().length > 0;
}

export function inferVerifyPreRunCommand(root: string): string | null {
  const pkg = asRecord(readJsonFile(join(root, 'package.json')));
  if (pkg) {
    const scripts = asRecord(pkg.scripts);
    const testScript = typeof scripts?.test === 'string' ? scripts.test : null;
    if (testScript && isUsefulTestScript(testScript)) return 'npm test';
    if (hasDependency(pkg, 'vitest') || hasAnyFile(root, ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cjs'])) {
      return 'npx vitest run';
    }
    if (hasDependency(pkg, 'jest') || hasAnyFile(root, ['jest.config.ts', 'jest.config.js', 'jest.config.mjs', 'jest.config.cjs'])) {
      return 'npx jest';
    }
  }

  const pyprojectPath = join(root, 'pyproject.toml');
  const pyproject = existsSync(pyprojectPath) ? readFileSync(pyprojectPath, 'utf-8').toLowerCase() : '';
  if (hasAnyFile(root, ['pytest.ini', 'tox.ini']) || pyproject.includes('pytest')) {
    return 'pytest';
  }

  if (hasFile(root, 'go.mod')) return 'go test ./...';
  if (hasFile(root, 'Cargo.toml')) return 'cargo test';

  return null;
}

export function normalizeVerifyConfig(rawVerify: unknown): NormalizedVerifyConfig {
  const verify = asRecord(rawVerify) ?? {};
  const mergeStrategy = verify.merge_results === DEFAULT_VERIFY_MERGE_STRATEGY
    ? DEFAULT_VERIFY_MERGE_STRATEGY
    : DEFAULT_VERIFY_MERGE_STRATEGY;
  return {
    resultPath: typeof verify.result_path === 'string' ? verify.result_path : DEFAULT_VERIFY_RESULT_PATH,
    preRunCommand: typeof verify.pre_run_command === 'string'
      ? verify.pre_run_command
      : typeof verify.test_command === 'string' ? verify.test_command : undefined,
    regressionCommand: typeof verify.regression_command === 'string' ? verify.regression_command : undefined,
    incrementalCommand: typeof verify.incremental_command === 'string' ? verify.incremental_command : undefined,
    regressionResultPath: typeof verify.regression_result_path === 'string' ? verify.regression_result_path : undefined,
    incrementalResultPath: typeof verify.incremental_result_path === 'string' ? verify.incremental_result_path : undefined,
    mergeStrategy,
    sandbox: normalizeSandboxConfig(verify),
    moduleCommands: normalizeModuleCommands(verify.modules),
    moduleCommandIds: Object.keys(asRecord(verify.modules) ?? {}),
  };
}

function normalizeModuleCommands(raw: unknown): Record<string, ModuleCommandConfig> {
  const record = asRecord(raw);
  const out: Record<string, ModuleCommandConfig> = {};
  if (!record) return out;
  for (const [id, value] of Object.entries(record)) {
    const entry = asRecord(value);
    if (!entry) continue;
    const cmd: ModuleCommandConfig = {};
    if (typeof entry.pre_run_command === 'string') cmd.preRunCommand = entry.pre_run_command;
    if (typeof entry.regression_command === 'string') cmd.regressionCommand = entry.regression_command;
    if (typeof entry.incremental_command === 'string') cmd.incrementalCommand = entry.incremental_command;
    if (cmd.preRunCommand || cmd.regressionCommand || cmd.incrementalCommand) out[id] = cmd;
  }
  return out;
}

export function readVerifyConfig(root: string): NormalizedVerifyConfig {
  const config = asRecord(readJsonFile(join(root, 'logos', 'logos.config.json')));
  return normalizeVerifyConfig(config?.verify);
}

export function hasVerifyPreRunConfig(rawVerify: unknown): boolean {
  const verify = normalizeVerifyConfig(rawVerify);
  return Boolean(verify.preRunCommand || verify.regressionCommand || verify.incrementalCommand);
}

function backfillSandboxDefaults(target: Record<string, unknown>): boolean {
  let changed = false;
  if (target.sandbox_mode === undefined) {
    target.sandbox_mode = DEFAULT_SANDBOX_MODE;
    changed = true;
  }
  // sandbox_root 不补入：默认根在读取时按平台解析（sandbox.ts resolveDefaultSandboxRoot），
  // 不把某台机器的临时目录固化进跨机配置（架构 §五十二 52.6）；已有值（含用户显式值）不改写。
  if (target.sandbox_deny_workspace_write === undefined) {
    target.sandbox_deny_workspace_write = DEFAULT_SANDBOX_DENY_WORKSPACE_WRITE;
    changed = true;
  }
  return changed;
}

export function backfillVerifyPreRunConfig(root: string, config: Record<string, unknown>): VerifyPreRunBackfillResult {
  const verify = asRecord(config.verify) ?? {};
  let mutated = false;
  if (!verify.result_path) {
    verify.result_path = DEFAULT_VERIFY_RESULT_PATH;
    mutated = true;
  }
  if (backfillSandboxDefaults(verify)) {
    mutated = true;
  }
  config.verify = verify;

  const smoke = asRecord(config.smoke) ?? {};
  if (backfillSandboxDefaults(smoke)) {
    mutated = true;
  }
  config.smoke = smoke;

  if (hasVerifyPreRunConfig(verify)) {
    return { status: 'exists', mutated };
  }

  const command = inferVerifyPreRunCommand(root);
  if (!command) return { status: 'todo', mutated };

  verify.pre_run_command = command;
  return { status: 'added', command, mutated: true };
}
