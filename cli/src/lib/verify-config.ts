import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeSandboxConfig, type NormalizedSandboxConfig } from './sandbox.js';
import { reservedPathCollisions } from './module-phase-report.js';

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
  /**
   * module-scoped-phase-reports（code-r1 F3 / code-r2 F3）：落在模块报告保留路径上、已改写的结果路径。
   * 结果路径改写到默认路径（回归 / 增量路径回落到结果路径），verify 在 pre_run.diagnostics 给出说明；不新增错误码。
   */
  reservedRedirects?: Array<{ config_key: string; path: string; fallback: string }>;
  /**
   * verify-flaky-rerun（功能规格 §2.108.2）：失败用例复跑配置。非法项按缺省值处理，`invalid` 列出被替换的字段路径，
   * 由 verify 输出警告 rerun_config_invalid（不改变门禁结论）。
   */
  rerunFailed?: NormalizedRerunFailedConfig;
  /**
   * layered-verification（功能规格 §2.109.2）：分层验收配置。非法项按缺省值处理，`invalid` 列出被替换的字段路径，
   * 由 verify 输出警告 layered_config_invalid（不改变门禁结论）。
   */
  layered?: NormalizedLayeredConfig;
}

export interface NormalizedLayeredConfig {
  enabled: boolean;
  mainPathMax: number;
  /** 生效的共享路径 glob：配置值替换缺省清单（可以为空数组）。 */
  sharedPaths: string[];
  /** 取值非法、已按缺省值处理的字段路径（如 `verify.layered.main_path_max`）。 */
  invalid: string[];
}

export const DEFAULT_LAYERED_ENABLED = false;
export const DEFAULT_LAYERED_MAIN_PATH_MAX = 50;
export const DEFAULT_LAYERED_SHARED_PATHS: readonly string[] = Object.freeze([
  '**/package.json', '**/package-lock.json', '**/pnpm-lock.yaml', '**/yarn.lock',
  '**/Cargo.toml', '**/Cargo.lock', '**/go.mod', '**/go.sum',
  '**/pyproject.toml', '**/requirements*.txt',
]);

/** glob 条目合法性与 modules[].paths 相同（§2.96.1）：非空字符串、不以 `/` 开头、不含 `..` 段。 */
function isValidSharedGlob(entry: unknown): entry is string {
  if (typeof entry !== 'string' || entry.trim() === '') return false;
  if (entry.startsWith('/')) return false;
  return !entry.split('/').some(seg => seg === '..');
}

/** 读取并归一化 `verify.layered`：整个对象可省略；非法项按缺省值处理并记录字段路径。 */
export function normalizeLayeredConfig(raw: unknown): NormalizedLayeredConfig {
  const out: NormalizedLayeredConfig = {
    enabled: DEFAULT_LAYERED_ENABLED, mainPathMax: DEFAULT_LAYERED_MAIN_PATH_MAX, sharedPaths: [...DEFAULT_LAYERED_SHARED_PATHS], invalid: [],
  };
  if (raw === undefined) return out;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    out.invalid.push('verify.layered');
    return out;
  }
  const record = raw as Record<string, unknown>;
  if (record.enabled !== undefined) {
    if (typeof record.enabled === 'boolean') out.enabled = record.enabled;
    else out.invalid.push('verify.layered.enabled');
  }
  if (record.main_path_max !== undefined) {
    if (typeof record.main_path_max === 'number' && Number.isInteger(record.main_path_max) && record.main_path_max > 0) out.mainPathMax = record.main_path_max;
    else out.invalid.push('verify.layered.main_path_max');
  }
  if (record.shared_paths !== undefined) {
    if (Array.isArray(record.shared_paths) && record.shared_paths.every(isValidSharedGlob)) out.sharedPaths = [...record.shared_paths];
    else out.invalid.push('verify.layered.shared_paths');
  }
  return out;
}

export interface NormalizedRerunFailedConfig {
  enabled: boolean;
  maxCases: number;
  /** 取值非法、已按缺省值处理的字段路径（如 `verify.rerun_failed.max_cases`）；合法或省略时为空数组。 */
  invalid: string[];
}

export const DEFAULT_RERUN_FAILED_ENABLED = true;
export const DEFAULT_RERUN_FAILED_MAX_CASES = 10;

/** §2.108.2：整个对象可省略；非对象、非布尔 enabled、非正整数 max_cases 均按缺省值处理并记录字段。 */
export function normalizeRerunFailedConfig(raw: unknown): NormalizedRerunFailedConfig {
  const out: NormalizedRerunFailedConfig = { enabled: DEFAULT_RERUN_FAILED_ENABLED, maxCases: DEFAULT_RERUN_FAILED_MAX_CASES, invalid: [] };
  if (raw === undefined) return out;
  const record = asRecord(raw);
  if (!record) {
    out.invalid.push('verify.rerun_failed');
    return out;
  }
  if (record.enabled !== undefined) {
    if (typeof record.enabled === 'boolean') out.enabled = record.enabled;
    else out.invalid.push('verify.rerun_failed.enabled');
  }
  if (record.max_cases !== undefined) {
    const value = record.max_cases;
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) out.maxCases = value;
    else out.invalid.push('verify.rerun_failed.max_cases');
  }
  return out;
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
    rerunFailed: normalizeRerunFailedConfig(verify.rerun_failed),
    layered: normalizeLayeredConfig(verify.layered),
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

/** 提案级的共用验收报告：发布级验收不得读写它（§2.109.11）。 */
export const SHARED_ACCEPTANCE_REPORT_PATH = 'logos/resources/verify/acceptance-report.md';

/**
 * 读取 verify 配置。`opts.release`（发布级验收，code-r2 F5）：结果路径另外不得落在共用验收报告上——
 * 与落在模块报告、发布级报告上同一处理（改写到默认路径并记录，配置了命令时由调用方阻止命令启动）。
 */
export function readVerifyConfig(root: string, opts: { release?: boolean } = {}): NormalizedVerifyConfig {
  const config = asRecord(readJsonFile(join(root, 'logos', 'logos.config.json')));
  const normalized = normalizeVerifyConfig(config?.verify);
  // 多模块项目中结果路径不得落在模块报告保留路径上（§2.99.2）：与 smoke 的报告路径同一处理——改写到默认路径
  const redirects: Array<{ config_key: string; path: string; fallback: string }> = [];
  for (const [key, path] of reservedPathCollisions(root, [
    ['verify.result_path', normalized.resultPath],
    ['verify.regression_result_path', normalized.regressionResultPath],
    ['verify.incremental_result_path', normalized.incrementalResultPath],
  ], opts.release ? [SHARED_ACCEPTANCE_REPORT_PATH] : [])) {
    if (key === 'verify.result_path') {
      normalized.resultPath = DEFAULT_VERIFY_RESULT_PATH;
      redirects.push({ config_key: key, path, fallback: DEFAULT_VERIFY_RESULT_PATH });
    } else {
      if (key === 'verify.regression_result_path') normalized.regressionResultPath = undefined;
      else normalized.incrementalResultPath = undefined;
      redirects.push({ config_key: key, path, fallback: 'verify.result_path' });
    }
  }
  if (redirects.length > 0) normalized.reservedRedirects = redirects;
  return normalized;
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

// ── slice-verify-efficient-mode：checkpoint 验收范围配置（功能规格 §2.101.2）──

export type SliceScopeSetting = 'auto' | 'baseline' | 'owned';
export const DEFAULT_SLICE_SCOPE: SliceScopeSetting = 'auto';
export const DEFAULT_SLICE_SCOPE_THRESHOLD = 1000;

export type SliceScopeConfig =
  | { ok: true; slice_scope: SliceScopeSetting; slice_scope_threshold: number }
  | { ok: false; key: 'verify.slice_scope' | 'verify.slice_scope_threshold'; value: unknown };

/**
 * 读取 `verify.slice_scope` / `verify.slice_scope_threshold`。缺省为 `auto` / `1000`；
 * 取值非法时返回 `ok:false` 点名配置项与取值——是否拒绝由调用方决定：只有 `slice plan`
 * 需要判定范围时才拒绝，沿用与账本恢复路径不读本配置（根规范 §2.3.2）。
 */
export function readSliceScopeConfig(root: string): SliceScopeConfig {
  const config = asRecord(readJsonFile(join(root, 'logos', 'logos.config.json')));
  const verify = asRecord(config?.verify) ?? {};
  const scope = verify.slice_scope;
  const threshold = verify.slice_scope_threshold;
  if (scope !== undefined && scope !== 'auto' && scope !== 'baseline' && scope !== 'owned') {
    return { ok: false, key: 'verify.slice_scope', value: scope };
  }
  if (threshold !== undefined && !(typeof threshold === 'number' && Number.isInteger(threshold) && threshold >= 1)) {
    return { ok: false, key: 'verify.slice_scope_threshold', value: threshold };
  }
  return {
    ok: true,
    slice_scope: (scope as SliceScopeSetting | undefined) ?? DEFAULT_SLICE_SCOPE,
    slice_scope_threshold: (threshold as number | undefined) ?? DEFAULT_SLICE_SCOPE_THRESHOLD,
  };
}
