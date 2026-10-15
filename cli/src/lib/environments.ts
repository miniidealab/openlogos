/**
 * 环境登记表与本机部署账本（environment-registry，S41）。
 *
 * 规范源：spec/environments.md（登记表 §2、--env 解析 §3、账本 §5、视图 §7、错误码 §8）；
 * 功能规格 §2.93；架构「五十三、环境登记表与部署账本」。
 *
 * 本模块只读：加载并校验 `logos/environments.yaml`（含 environment-deploy 的 `deploy` 字段，§11.2）、解析 `--env`、
 * 顺序流式读取 `logos/.openlogos-runtime/deployments.jsonl` 并投影环境视图。账本写入由 deploy-done / smoke / deploy 负责。
 */
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const ENV_REGISTRY_REL = 'logos/environments.yaml';
export const DEPLOY_LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
/** 每个环境保留的历史条数（spec/environments.md §5.4）。 */
export const ENV_HISTORY_LIMIT = 20;

export const ENV_TIERS = ['dev', 'test', 'staging', 'prod'] as const;
export type EnvTier = (typeof ENV_TIERS)[number];

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SECRET_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const TOP_FIELDS = new Set(['schema_version', 'environments']);
const ENV_FIELDS = new Set(['id', 'name', 'tier', 'aliases', 'description', 'health', 'version', 'secrets', 'deploy', 'promote_from', 'require_approval']);
/** 晋级与审批门禁字段（spec/environments.md §12.1，environment-promotion-approval）。 */
const GATE_FIELDS = ['promote_from', 'require_approval'] as const;

// ───────────────────────────── deploy 配置（spec/environments.md §11.2） ─────────────────────────────

export const DEPLOY_MODES = ['script', 'ci', 'agent'] as const;
export type DeployMode = (typeof DEPLOY_MODES)[number];
export const DEPLOY_TIMEOUT_DEFAULT_SEC = 1800;
export const DEPLOY_TIMEOUT_MAX_SEC = 7200;
export const DEPLOY_POLL_INTERVAL_DEFAULT_SEC = 10;
/** args / inputs 中允许的占位符。 */
export const DEPLOY_PLACEHOLDERS = ['env', 'ref', 'ref_short', 'deploy_id'] as const;
/** 承载可执行命令的字段一律拒绝（决策 D13：登记表免立案可改，不得承载命令）。 */
const DEPLOY_COMMAND_FIELDS = new Set(['run', 'command', 'commands', 'cmd', 'shell', 'exec']);
const DEPLOY_FIELDS_BY_MODE: Record<DeployMode, Set<string>> = {
  script: new Set(['mode', 'script', 'args', 'workdir', 'timeout_sec']),
  ci: new Set(['mode', 'provider', 'workflow', 'workflow_ref', 'inputs', 'timeout_sec', 'poll_interval_sec', 'trigger_script', 'status_script']),
  agent: new Set(['mode', 'plan_section']),
};

export interface DeployConfig {
  mode: DeployMode;
  script: string | null;
  args: string[];
  workdir: 'worktree' | 'in-place';
  timeout_sec: number;
  provider: 'github-actions' | 'script' | null;
  workflow: string | null;
  workflow_ref: string | null;
  inputs: Record<string, string>;
  poll_interval_sec: number;
  trigger_script: string | null;
  status_script: string | null;
  plan_section: string | null;
}

/** 仓库相对路径：非空、非绝对、不含盘符与反斜杠、不含 . / .. / 空段。 */
export function isRepoRelativePath(v: unknown): v is string {
  if (typeof v !== 'string' || v.trim() === '' || v !== v.trim()) return false;
  if (v.startsWith('/') || /^[A-Za-z]:/.test(v) || v.includes('\\')) return false;
  return v.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');
}

/** 占位符合法性：只允许 {env} {ref} {ref_short} {deploy_id}；返回首个非法占位符或 null。 */
function unknownPlaceholder(value: string): string | null {
  for (const m of value.matchAll(/\{([^{}]*)\}/g)) {
    if (!(DEPLOY_PLACEHOLDERS as readonly string[]).includes(m[1])) return m[0];
  }
  return null;
}

const isPositiveInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/**
 * 校验环境项的 deploy 字段（spec/environments.md §2.2、§11.2）。非法项写入 errors（field 形如 deploy.script），
 * 未知或不适用于该方式的子字段写入 warnings；合法时返回规范化配置。
 */
function validateDeployConfig(
  raw: unknown, label: string, errors: RegistryIssue[], warnings: RegistryIssue[],
): DeployConfig | null {
  const bad = (field: string, reason: string) => errors.push({ code: 'ENV_FIELD_INVALID', environment: label, field: `deploy.${field}`, reason });
  if (!isRecord(raw)) {
    errors.push({ code: 'ENV_FIELD_INVALID', environment: label, field: 'deploy', reason: 'deploy must be a mapping' });
    return null;
  }
  const before = errors.length;
  for (const key of Object.keys(raw)) {
    if (DEPLOY_COMMAND_FIELDS.has(key)) bad(key, 'deploy must not carry executable commands; reference a script or CI workflow in the repository instead (D13)');
  }
  const mode = raw.mode;
  if (typeof mode !== 'string' || !(DEPLOY_MODES as readonly string[]).includes(mode)) {
    bad('mode', `mode is required and must be one of ${DEPLOY_MODES.join(' | ')}`);
    return null;
  }
  const allowed = DEPLOY_FIELDS_BY_MODE[mode as DeployMode];
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key) && !DEPLOY_COMMAND_FIELDS.has(key)) {
      warnings.push({ code: 'ENV_UNKNOWN_FIELD', environment: label, field: `deploy.${key}`, reason: `unknown deploy field for mode ${mode}` });
    }
  }
  const timeout = raw.timeout_sec ?? DEPLOY_TIMEOUT_DEFAULT_SEC;
  if ((mode === 'script' || mode === 'ci') && (!isPositiveInt(timeout) || timeout > DEPLOY_TIMEOUT_MAX_SEC)) {
    bad('timeout_sec', `timeout_sec must be an integer between 1 and ${DEPLOY_TIMEOUT_MAX_SEC}`);
  }
  const config: DeployConfig = {
    mode: mode as DeployMode, script: null, args: [], workdir: 'worktree', timeout_sec: isPositiveInt(timeout) ? timeout : DEPLOY_TIMEOUT_DEFAULT_SEC,
    provider: null, workflow: null, workflow_ref: null, inputs: {}, poll_interval_sec: DEPLOY_POLL_INTERVAL_DEFAULT_SEC,
    trigger_script: null, status_script: null, plan_section: null,
  };
  if (mode === 'script') {
    if (!isRepoRelativePath(raw.script)) bad('script', 'script must be a repository-relative path without . or .. segments');
    else config.script = raw.script;
    const args = raw.args ?? [];
    if (!Array.isArray(args) || args.some(a => typeof a !== 'string')) {
      bad('args', 'args must be an array of strings');
    } else {
      const unknown = (args as string[]).map(unknownPlaceholder).find(x => x !== null);
      if (unknown) bad('args', `unknown placeholder ${unknown}; allowed: ${DEPLOY_PLACEHOLDERS.map(p => `{${p}}`).join(' ')}`);
      else config.args = args as string[];
    }
    const workdir = raw.workdir ?? 'worktree';
    if (workdir !== 'worktree' && workdir !== 'in-place') bad('workdir', 'workdir must be worktree | in-place');
    else config.workdir = workdir;
  } else if (mode === 'ci') {
    const provider = raw.provider;
    if (provider !== 'github-actions' && provider !== 'script') {
      bad('provider', 'provider is required and must be github-actions | script');
    } else {
      config.provider = provider;
      if (provider === 'github-actions') {
        if (typeof raw.workflow !== 'string' || raw.workflow.trim() === '' || raw.workflow.includes('/') || raw.workflow.includes('\\')) {
          bad('workflow', 'workflow is required: a file name under .github/workflows');
        } else {
          config.workflow = raw.workflow;
        }
        if (raw.workflow_ref !== undefined && raw.workflow_ref !== null) {
          if (typeof raw.workflow_ref !== 'string' || raw.workflow_ref.trim() === '') bad('workflow_ref', 'workflow_ref must be a non-empty branch or tag name');
          else config.workflow_ref = raw.workflow_ref;
        }
        const inputs = raw.inputs ?? {};
        if (!isRecord(inputs) || Object.values(inputs).some(v => typeof v !== 'string')) {
          bad('inputs', 'inputs must be a mapping of strings');
        } else {
          const unknown = Object.values(inputs as Record<string, string>).map(unknownPlaceholder).find(x => x !== null);
          if (unknown) bad('inputs', `unknown placeholder ${unknown}; allowed: ${DEPLOY_PLACEHOLDERS.map(p => `{${p}}`).join(' ')}`);
          else config.inputs = inputs as Record<string, string>;
        }
      } else {
        for (const field of ['trigger_script', 'status_script'] as const) {
          if (!isRepoRelativePath(raw[field])) bad(field, `${field} must be a repository-relative path without . or .. segments`);
          else config[field] = raw[field] as string;
        }
      }
    }
    const poll = raw.poll_interval_sec ?? DEPLOY_POLL_INTERVAL_DEFAULT_SEC;
    if (!isPositiveInt(poll)) bad('poll_interval_sec', 'poll_interval_sec must be a positive integer');
    else config.poll_interval_sec = poll;
  } else {
    if (typeof raw.plan_section !== 'string' || raw.plan_section.trim() === '') bad('plan_section', 'plan_section is required for agent mode');
    else config.plan_section = raw.plan_section;
  }
  return errors.length === before ? config : null;
}

export interface EnvironmentDef {
  id: string;
  name: string;
  tier: EnvTier;
  aliases: string[];
  description: string | null;
  health: string | null;
  version: string | null;
  secrets: string[];
  /** 部署执行配置（environment-deploy）；未配置时不出现该属性，既有结构不变。 */
  deploy?: DeployConfig;
  /**
   * 晋级与审批门禁（environment-promotion-approval，§12.1）：条目写有 promote_from 或 require_approval
   * （含 require_approval: false）时才出现 gate 属性，未写时既有结构不变。
   */
  gate?: { promote_from: string | null; require_approval: boolean };
}

/** 受门环境（spec/environments.md §12.1）：配置了 promote_from，或 require_approval 为 true。 */
export function isGatedEnvironment(env: EnvironmentDef): boolean {
  return env.gate !== undefined && (env.gate.promote_from !== null || env.gate.require_approval);
}

/** 登记表校验问题：code 为稳定错误码，params 供文案插值，environment / field / value 供机器定位。 */
export interface RegistryIssue {
  code: 'ENV_REGISTRY_INVALID' | 'ENV_FIELD_INVALID' | 'ENV_DUPLICATE_ID_OR_ALIAS' | 'ENV_UNKNOWN_FIELD';
  reason: string;
  environment?: string;
  field?: string;
  value?: string;
}

export type RegistryLoad =
  | { state: 'absent' }
  /** 无法加载：YAML 语法错误、顶层不是映射、schema_version 不为 1、environments 不是数组。 */
  | { state: 'unloadable'; error: RegistryIssue }
  /** 已加载：errors 为空才可用于 deploy-done / smoke / list / show；check 逐条报告。 */
  | { state: 'loaded'; environments: EnvironmentDef[]; errors: RegistryIssue[]; warnings: RegistryIssue[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string' || !/^https?:\/\//i.test(v)) return false;
  try { new URL(v); return true; } catch { return false; }
}

/** 加载并校验登记表（spec/environments.md §2）。文件不存在返回 absent。 */
export function loadEnvironmentRegistry(root: string): RegistryLoad {
  const file = join(root, ENV_REGISTRY_REL);
  if (!existsSync(file)) return { state: 'absent' };
  let doc: unknown;
  let text: string;
  try {
    text = readFileSync(file, 'utf-8');
    doc = parseYaml(text);
  } catch (error) {
    return { state: 'unloadable', error: { code: 'ENV_REGISTRY_INVALID', reason: `yaml: ${(error as Error).message.split('\n')[0]}` } };
  }
  if (!isRecord(doc)) {
    return { state: 'unloadable', error: { code: 'ENV_REGISTRY_INVALID', reason: 'top-level must be a mapping' } };
  }
  if (doc.schema_version !== 1) {
    return { state: 'unloadable', error: { code: 'ENV_REGISTRY_INVALID', field: 'schema_version', reason: 'schema_version must be 1' } };
  }
  if (!Array.isArray(doc.environments)) {
    return { state: 'unloadable', error: { code: 'ENV_REGISTRY_INVALID', field: 'environments', reason: 'environments must be an array' } };
  }

  const errors: RegistryIssue[] = [];
  const warnings: RegistryIssue[] = [];
  for (const key of Object.keys(doc)) {
    if (!TOP_FIELDS.has(key)) warnings.push({ code: 'ENV_UNKNOWN_FIELD', field: key, reason: 'unknown top-level field' });
  }

  const environments: EnvironmentDef[] = [];
  doc.environments.forEach((raw, index) => {
    const label = isRecord(raw) && typeof raw.id === 'string' && raw.id !== '' ? raw.id : `#${index}`;
    const bad = (field: string, reason: string) => errors.push({ code: 'ENV_FIELD_INVALID', environment: label, field, reason });
    if (!isRecord(raw)) { bad('(item)', 'environment entry must be a mapping'); return; }
    for (const key of Object.keys(raw)) {
      if (!ENV_FIELDS.has(key)) warnings.push({ code: 'ENV_UNKNOWN_FIELD', environment: label, field: key, reason: 'unknown environment field' });
    }
    const before = errors.length;
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) bad('id', 'id must match ^[a-z0-9][a-z0-9-]*$');
    if (typeof raw.name !== 'string' || raw.name.trim() === '') bad('name', 'name is required');
    if (typeof raw.tier !== 'string' || !(ENV_TIERS as readonly string[]).includes(raw.tier)) bad('tier', `tier must be one of ${ENV_TIERS.join(' | ')}`);
    const aliases = raw.aliases ?? [];
    if (!Array.isArray(aliases) || aliases.some(a => typeof a !== 'string' || a.trim() === '')) bad('aliases', 'aliases must be an array of non-empty strings');
    if (raw.description !== undefined && raw.description !== null && typeof raw.description !== 'string') bad('description', 'description must be a string');
    for (const field of ['health', 'version'] as const) {
      if (raw[field] !== undefined && raw[field] !== null && !isHttpUrl(raw[field])) bad(field, `${field} must be an http(s) URL`);
    }
    const secrets = raw.secrets ?? [];
    if (!Array.isArray(secrets) || secrets.some(s => typeof s !== 'string' || !SECRET_RE.test(s))) bad('secrets', 'secrets must be environment variable names (^[A-Za-z_][A-Za-z0-9_]*$)');
    const deploy = raw.deploy === undefined || raw.deploy === null ? null : validateDeployConfig(raw.deploy, label, errors, warnings);
    const gate = validateGateFields(raw, text, raw.deploy !== undefined && raw.deploy !== null, bad);
    if (errors.length !== before) return;
    environments.push({
      id: raw.id as string,
      name: raw.name as string,
      tier: raw.tier as EnvTier,
      aliases: aliases as string[],
      description: typeof raw.description === 'string' ? raw.description : null,
      health: typeof raw.health === 'string' ? raw.health : null,
      version: typeof raw.version === 'string' ? raw.version : null,
      secrets: secrets as string[],
      ...(deploy ? { deploy } : {}),
      ...(gate ? { gate } : {}),
    });
  });
  validateGateReferences(environments, errors);

  // id 与 alias 不区分大小写全局唯一
  const seen = new Map<string, string>();
  for (const env of environments) {
    for (const [field, value] of [['id', env.id] as const, ...env.aliases.map(a => ['aliases', a] as const)]) {
      const key = value.toLowerCase();
      const owner = seen.get(key);
      if (owner !== undefined) {
        errors.push({ code: 'ENV_DUPLICATE_ID_OR_ALIAS', environment: env.id, field, value, reason: `"${value}" conflicts with ${owner}` });
      } else {
        seen.set(key, `${env.id}.${field}`);
      }
    }
  }
  return { state: 'loaded', environments, errors, warnings };
}

/**
 * 门禁字段校验（spec/environments.md §12.1）：类型、只在配置了 deploy 的环境上合法、须以普通键名书写
 * （解析出门禁字段而登记表原文不含字段名字面量即非法，review delta-r1 F2）。条目未写两个字段时返回 null。
 */
function validateGateFields(
  raw: Record<string, unknown>, text: string, deployConfigured: boolean, bad: (field: string, reason: string) => void,
): EnvironmentDef['gate'] | null {
  const present = GATE_FIELDS.filter(field => has(raw, field));
  if (present.length === 0) return null;
  for (const field of present) {
    if (!text.includes(field)) bad(field, `${field} must be written as a plain key; escaped or continued key spellings are rejected`);
    if (!deployConfigured) bad(field, `${field} is only allowed on environments that configure deploy`);
  }
  if (has(raw, 'promote_from') && (typeof raw.promote_from !== 'string' || raw.promote_from.trim() === '')) {
    bad('promote_from', 'promote_from must be the id of another registered environment');
  }
  if (has(raw, 'require_approval') && typeof raw.require_approval !== 'boolean') bad('require_approval', 'require_approval must be a boolean');
  return {
    promote_from: typeof raw.promote_from === 'string' ? raw.promote_from : null,
    require_approval: raw.require_approval === true,
  };
}

/** promote_from 引用校验（§12.1）：必须等于另一个环境的 id（不接受 alias）、不得指向自身、不得成环（环上每个环境各报一条）。 */
function validateGateReferences(environments: EnvironmentDef[], errors: RegistryIssue[]): void {
  const byId = new Map(environments.map(e => [e.id, e]));
  const bad = (env: EnvironmentDef, reason: string) => errors.push({
    code: 'ENV_FIELD_INVALID', environment: env.id, field: 'promote_from', value: env.gate?.promote_from ?? undefined, reason,
  });
  for (const env of environments) {
    const from = env.gate?.promote_from ?? null;
    if (from === null) continue;
    if (from === env.id) { bad(env, 'promote_from must not point to the environment itself'); continue; }
    if (!byId.has(from)) {
      const aliasOwner = environments.find(e => e.aliases.some(a => a.toLowerCase() === from.toLowerCase()) || e.id.toLowerCase() === from.toLowerCase());
      bad(env, aliasOwner
        ? `promote_from must be an environment id, not an alias or differently-cased id (did you mean ${aliasOwner.id}?)`
        : `promote_from references unregistered environment "${from}"`);
      continue;
    }
    // 沿 promote_from 前进：回到出发环境即成环；遇到已访问的其他环境则停止（出发环境不在该环上）
    const visited = new Set([env.id]);
    let cursor = byId.get(from);
    while (cursor) {
      const next = cursor.gate?.promote_from ?? null;
      if (next === null) break;
      if (next === env.id) { bad(env, 'promote_from chain forms a cycle'); break; }
      if (visited.has(next) || next === cursor.id) break;
      visited.add(cursor.id);
      cursor = byId.get(next);
    }
  }
}

export type EnvResolution = { ok: true; id: string } | { ok: false; available: string[] };

/** --env 解析（spec/environments.md §3）：先按 id、再按 alias，均不区分大小写。 */
export function resolveEnvironment(environments: EnvironmentDef[], input: string): EnvResolution {
  const needle = input.trim().toLowerCase();
  const byId = environments.find(e => e.id.toLowerCase() === needle);
  if (byId && needle !== '') return { ok: true, id: byId.id };
  const byAlias = environments.find(e => e.aliases.some(a => a.toLowerCase() === needle));
  if (byAlias && needle !== '') return { ok: true, id: byAlias.id };
  return { ok: false, available: environments.map(e => e.id) };
}

// ───────────────────────────── 账本 ─────────────────────────────

export type EnvEvidence = 'declared' | 'missing' | 'mismatch';

export const DEPLOY_CHANNELS = ['proposal', 'version'] as const;
export const DEPLOY_RESULTS = ['done', 'failed', 'unknown'] as const;
export const DEPLOY_FAILURE_REASONS = [
  'exit-code', 'timeout', 'ci-failure', 'ci-run-id-missing', 'ci-observe-timeout', 'agent-reported', 'abandoned',
] as const;

/**
 * deploy 记录（spec/environments.md §5.2）。deploy-done 写出的旧形态记录只有前十个字段（result 恒为 done，
 * 无 channel）；openlogos deploy 写出的记录另含 channel 起的扩展字段（environment-deploy，决策 C06）。
 */
export interface DeployLedgerRecord {
  kind: 'deploy';
  environment: string;
  slug: string | null;
  recorded_at: string;
  observed_head: string | null;
  observed_dirty: boolean | null;
  deploy_id: string;
  ref: string | null;
  ref_source: 'explicit' | 'ci-reported' | 'unknown';
  result: (typeof DEPLOY_RESULTS)[number];
  channel?: (typeof DEPLOY_CHANNELS)[number];
  mode?: DeployMode;
  ref_input?: string;
  ref_requested?: string;
  rollback?: boolean;
  rollback_from?: string | null;
  duration_ms?: number | null;
  ci_run_id?: string | null;
  ci_run_url?: string | null;
  ci_reported_ref?: string | null;
  failure_reason?: (typeof DEPLOY_FAILURE_REASONS)[number] | null;
  log_path?: string | null;
  reconciled?: boolean;
  /** 受门环境的 deploy 记录另含（environment-promotion-approval，§5.2）；未配置门的环境不含。 */
  approval_id?: string | null;
  promoted_from?: string | null;
  promotion_override_reason?: string | null;
}

export interface SmokeLedgerRecord {
  kind: 'smoke';
  environment: string;
  /** 无活跃提案时（部署执行已启用）为 null（environment-deploy，决策 C15）。 */
  slug: string | null;
  recorded_at: string;
  observed_head: string | null;
  observed_dirty: boolean | null;
  deploy_id: string | null;
  ref: string | null;
  result: 'pass' | 'fail';
  env_evidence: EnvEvidence;
  fresh_results: boolean;
  deploy_env_confirmed: boolean;
  verified: boolean;
}

/** approval 记录（spec/environments.md §5.2，environment-promotion-approval 决策 C07）。 */
export interface ApprovalLedgerRecord {
  kind: 'approval';
  environment: string;
  slug: string | null;
  recorded_at: string;
  observed_head: string | null;
  observed_dirty: boolean | null;
  approval_id: string;
  ref: string;
  ref_input: string;
  approver: string | null;
  note: string | null;
}

export type LedgerRecord = DeployLedgerRecord | SmokeLedgerRecord | ApprovalLedgerRecord;

/** verified 判据（spec/environments.md §5.3）：五个条件同时满足才为 true。 */
export function computeVerified(r: {
  result: string; env_evidence: string; fresh_results: boolean; deploy_env_confirmed: boolean; ref: string | null;
}): boolean {
  return r.result === 'pass' && r.env_evidence === 'declared' && r.fresh_results === true
    && r.deploy_env_confirmed === true && r.ref !== null;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isRefOrNull = (v: unknown): boolean => v === null || (typeof v === 'string' && COMMIT_RE.test(v));
const isBoolOrNull = (v: unknown): boolean => v === null || typeof v === 'boolean';
const has = (o: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);
const isStringOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const optional = (o: Record<string, unknown>, key: string, ok: (v: unknown) => boolean): boolean => !has(o, key) || ok(o[key]);

/** deploy 记录的扩展字段校验（spec/environments.md §5.2、§5.4）：带 channel 即为 openlogos deploy 写出的记录。 */
function validDeployExtension(o: Record<string, unknown>): boolean {
  if (!(DEPLOY_CHANNELS as readonly unknown[]).includes(o.channel)) return false;
  if (!(DEPLOY_MODES as readonly unknown[]).includes(o.mode)) return false;
  if (typeof o.ref_requested !== 'string' || !COMMIT_RE.test(o.ref_requested)) return false;
  if (o.slug === null && o.channel !== 'version') return false;
  return optional(o, 'ref_input', v => typeof v === 'string')
    && optional(o, 'rollback', v => typeof v === 'boolean')
    && optional(o, 'rollback_from', isRefOrNull)
    && optional(o, 'duration_ms', v => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0))
    && optional(o, 'ci_run_id', isStringOrNull)
    && optional(o, 'ci_run_url', isStringOrNull)
    && optional(o, 'ci_reported_ref', isStringOrNull)
    && optional(o, 'failure_reason', v => v === null || (DEPLOY_FAILURE_REASONS as readonly unknown[]).includes(v))
    && optional(o, 'log_path', isStringOrNull)
    && optional(o, 'reconciled', v => typeof v === 'boolean');
}

/**
 * 逐行校验（spec/environments.md §5.4）：按 kind 校验必需字段、类型、枚举与 verified 一致性。
 * 合法返回记录，否则返回 null（调用方计入 corrupt_lines，不更新状态）。未知额外字段保留兼容。
 */
export function validateLedgerRecord(value: unknown): LedgerRecord | null {
  if (!isRecord(value)) return null;
  const o = value;
  if (o.kind !== 'deploy' && o.kind !== 'smoke' && o.kind !== 'approval') return null;
  if (!isNonEmptyString(o.environment) || !(o.slug === null || isNonEmptyString(o.slug)) || typeof o.recorded_at !== 'string') return null;
  if (!has(o, 'observed_head') || !isRefOrNull(o.observed_head)) return null;
  if (!has(o, 'observed_dirty') || !isBoolOrNull(o.observed_dirty)) return null;
  if (o.kind === 'approval') {
    // environment-promotion-approval：ref 必须是 40 位 commit（不可为 null）
    if (!isNonEmptyString(o.approval_id) || typeof o.ref !== 'string' || !COMMIT_RE.test(o.ref)) return null;
    if (typeof o.ref_input !== 'string' || !has(o, 'approver') || !isStringOrNull(o.approver) || !has(o, 'note') || !isStringOrNull(o.note)) return null;
    return o as unknown as ApprovalLedgerRecord;
  }
  if (!has(o, 'ref') || !isRefOrNull(o.ref)) return null;
  if (o.kind === 'deploy') {
    if (!isNonEmptyString(o.deploy_id)) return null;
    // 受门环境的可选字段（§5.4）：出现时为字符串或 null
    if (!['approval_id', 'promoted_from', 'promotion_override_reason'].every(k => optional(o, k, isStringOrNull))) return null;
    if (has(o, 'channel')) {
      // openlogos deploy 写出的扩展记录（environment-deploy）
      if (!(DEPLOY_RESULTS as readonly unknown[]).includes(o.result)) return null;
      if (o.ref_source !== 'explicit' && o.ref_source !== 'ci-reported' && o.ref_source !== 'unknown') return null;
      if ((o.ref_source !== 'unknown') !== (o.ref !== null)) return null;
      if (!validDeployExtension(o)) return null;
      return o as unknown as DeployLedgerRecord;
    }
    // deploy-done 写出的旧形态记录：result 恒为 done，slug 非空
    if (o.slug === null || o.result !== 'done') return null;
    if (o.ref_source !== 'explicit' && o.ref_source !== 'unknown') return null;
    if ((o.ref_source === 'explicit') !== (o.ref !== null)) return null;
    return o as unknown as DeployLedgerRecord;
  }
  if (!has(o, 'deploy_id') || !(o.deploy_id === null || isNonEmptyString(o.deploy_id))) return null;
  if (o.result !== 'pass' && o.result !== 'fail') return null;
  if (o.env_evidence !== 'declared' && o.env_evidence !== 'missing' && o.env_evidence !== 'mismatch') return null;
  if (typeof o.fresh_results !== 'boolean' || typeof o.deploy_env_confirmed !== 'boolean' || typeof o.verified !== 'boolean') return null;
  if (o.verified !== computeVerified(o as unknown as SmokeLedgerRecord)) return null;
  return o as unknown as SmokeLedgerRecord;
}

export interface EnvLedgerState {
  lastDeploy: DeployLedgerRecord | null;
  lastSmoke: SmokeLedgerRecord | null;
  /** 新到旧，最多 ENV_HISTORY_LIMIT 条。 */
  history: LedgerRecord[];
  /** 最近一条 result=done 的 deploy 记录的 ref（null 表示未确认或从未成功部署）；hasDone 区分二者。 */
  currentRef: string | null;
  hasDone: boolean;
  /** 在当前成功记录之前的成功记录中：最近一个非 null ref（a1）与最近一个不等于 a1 的非 null ref（a2）。 */
  priorRef1: string | null;
  priorRef2: string | null;
  /** 未使用的审批（§5.4），按记录顺序；使用为单向事实，一经使用即移出。 */
  openApprovals: ApprovalLedgerRecord[];
  /** 该环境 verified=true 的 smoke 记录的 ref 集合（下游晋级检查的依据，§12.3）。 */
  verifiedRefs: Set<string>;
  /** 晋级候选：最近一条 verified=true smoke 记录的 ref。 */
  candidateRef: string | null;
}

export interface LedgerSnapshot {
  path: string;
  corruptLines: number;
  byEnvironment: Map<string, EnvLedgerState>;
  /** 账本中存在 openlogos deploy 写出的记录（带 channel 字段）——「部署执行已启用」的判据之一（§1）。 */
  hasDeployExecutionRecords: boolean;
  /** 账本路径存在但无法读取（如被目录占据、权限不足）时的原因；此时按空账本投影，读取不崩溃（§5.4）。 */
  readError?: string;
}

/** 维护 current_ref / previous_ref（spec/environments.md §7.1）：每条成功 deploy 记录推进一次。 */
function advanceDone(state: EnvLedgerState, ref: string | null): void {
  if (state.hasDone && state.currentRef !== null && state.currentRef !== state.priorRef1) {
    state.priorRef2 = state.priorRef1;
    state.priorRef1 = state.currentRef;
  }
  state.currentRef = ref;
  state.hasDone = true;
}

/** previous_ref：当前成功记录之前、最近一个非 null 且不等于 current_ref 的成功版本。 */
export function previousRefOf(state: EnvLedgerState | undefined): string | null {
  if (!state) return null;
  return state.priorRef1 !== null && state.priorRef1 !== state.currentRef ? state.priorRef1 : state.priorRef2;
}

/** 按块读取文件并逐行回调（不把整个账本一次读入内存）。 */
function forEachLine(file: string, onLine: (line: string) => void): void {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    let carry = Buffer.alloc(0);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      let chunk = Buffer.concat([carry, buf.subarray(0, n)]);
      let nl: number;
      while ((nl = chunk.indexOf(0x0a)) !== -1) {
        onLine(chunk.subarray(0, nl).toString('utf-8'));
        chunk = chunk.subarray(nl + 1);
      }
      carry = Buffer.from(chunk);
    }
    if (carry.length > 0) onLine(carry.toString('utf-8'));
  } finally {
    closeSync(fd);
  }
}

/**
 * 顺序流式扫描完整账本（spec/environments.md §5.4）：不设全局行数窗口，按环境保留最近 deploy、
 * 最近 smoke 与最近 ENV_HISTORY_LIMIT 条历史；「最近」以追加顺序（行序）为准。
 */
export function readDeploymentLedger(root: string): LedgerSnapshot {
  const snapshot: LedgerSnapshot = { path: DEPLOY_LEDGER_REL, corruptLines: 0, byEnvironment: new Map(), hasDeployExecutionRecords: false };
  const file = join(root, DEPLOY_LEDGER_REL);
  if (!existsSync(file)) return snapshot;
  try {
    forEachLine(file, raw => {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') return;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { snapshot.corruptLines += 1; return; }
    const record = validateLedgerRecord(parsed);
    if (!record) { snapshot.corruptLines += 1; return; }
    let state = snapshot.byEnvironment.get(record.environment);
    if (!state) {
      state = {
        lastDeploy: null, lastSmoke: null, history: [], currentRef: null, hasDone: false, priorRef1: null, priorRef2: null,
        openApprovals: [], verifiedRefs: new Set(), candidateRef: null,
      };
      snapshot.byEnvironment.set(record.environment, state);
    }
    if (record.kind === 'deploy') {
      // 同一 deploy_id 的多条记录按行序以最后一条为准：last_deploy 恒为最后一行；只有 done 推进当前 / 上一版本
      state.lastDeploy = record;
      if (record.result === 'done') {
        advanceDone(state, record.ref);
        // 审批使用推导（§5.4、§12.4）：其后出现同环境、ref_requested 等于审批 ref 的 done 记录即已使用；
        // 单向事实，不按同一 deploy_id 取最后一条，之后的 unknown / abandoned 不撤销（review delta-r1 F1）
        const used = record.ref_requested;
        if (used !== undefined && state.openApprovals.length > 0) state.openApprovals = state.openApprovals.filter(a => a.ref !== used);
      }
      if (record.channel !== undefined) snapshot.hasDeployExecutionRecords = true;
    } else if (record.kind === 'smoke') {
      state.lastSmoke = record;
      if (record.verified && record.ref !== null) {
        state.verifiedRefs.add(record.ref);
        state.candidateRef = record.ref;
      }
    } else {
      // approval 记录进入历史，不进入 last_deploy / last_smoke，不影响 current_ref / previous_ref
      state.openApprovals.push(record);
    }
    state.history.unshift(record);
    if (state.history.length > ENV_HISTORY_LIMIT) state.history.length = ENV_HISTORY_LIMIT;
    });
  } catch (error) {
    // 读取不崩溃：无法读取的账本按空账本投影（写入方遇到同一路径时照常按写入失败处理）
    const e = error as NodeJS.ErrnoException;
    return {
      path: DEPLOY_LEDGER_REL, corruptLines: 0, byEnvironment: new Map(), hasDeployExecutionRecords: false,
      readError: `${e.code ?? 'EIO'}: ${e.message}`,
    };
  }
  return snapshot;
}

// ───────────────────────────── 视图投影 ─────────────────────────────

export interface DeployRecordView {
  deploy_id: string;
  slug: string | null;
  ref: string | null;
  ref_source: 'explicit' | 'ci-reported' | 'unknown';
  observed_head: string | null;
  observed_dirty: boolean | null;
  recorded_at: string;
  /** 以下字段只在部署执行已启用时输出（spec/environments.md §7.1）；旧形态记录为 done / proposal / null。 */
  result?: DeployLedgerRecord['result'];
  channel?: DeployLedgerRecord['channel'] | null;
  mode?: DeployMode | null;
  ref_requested?: string | null;
  failure_reason?: DeployLedgerRecord['failure_reason'] | null;
}

export interface SmokeRecordView {
  deploy_id: string | null;
  slug: string | null;
  ref: string | null;
  result: 'pass' | 'fail';
  env_evidence: EnvEvidence;
  fresh_results: boolean;
  deploy_env_confirmed: boolean;
  verified: boolean;
  observed_head: string | null;
  recorded_at: string;
}

/** 该环境未结束的部署占用（spec/environments.md §11.8）。 */
export interface DeployInProgressView {
  deploy_id: string;
  mode: DeployMode | null;
  started_at: string | null;
  run_id: string | null;
  run_url: string | null;
  /** 未决记录（ci 已触发 / agent 待完成）为 true；本地锁为 false。 */
  unresolved: boolean;
}

export interface EnvView {
  id: string;
  name: string;
  tier: EnvTier;
  current_ref: string | null;
  /** 以下三个字段只在部署执行已启用时输出。 */
  previous_ref?: string | null;
  deploy_mode?: DeployMode | null;
  deploy_in_progress?: DeployInProgressView | null;
  last_deploy: DeployRecordView | null;
  last_smoke: SmokeRecordView | null;
  /** 以下四个字段只在该环境登记表条目写有 promote_from 或 require_approval 时输出（§7.1，决策 C08）。 */
  promote_from?: string | null;
  require_approval?: boolean;
  open_approvals?: ApprovalView[];
  promotion?: { from: string; candidate_ref: string | null } | null;
}

/** 未使用审批的视图项（spec/environments.md §7.1）。 */
export interface ApprovalView {
  approval_id: string;
  ref: string;
  approver: string | null;
  note: string | null;
  recorded_at: string;
}

/** env show 历史中的 approval 记录（§5.2 字段）。 */
export interface ApprovalRecordView extends ApprovalView {
  slug: string | null;
  ref_input: string;
  observed_head: string | null;
  observed_dirty: boolean | null;
}

/** 视图投影选项：部署执行已启用时输出部署执行字段；root 用于读取运行态目录的占用。 */
export interface EnvViewOptions {
  deployEnabled: boolean;
  root?: string;
}

export function projectDeployRecord(r: DeployLedgerRecord, deployEnabled = false): DeployRecordView {
  const base: DeployRecordView = {
    deploy_id: r.deploy_id, slug: r.slug, ref: r.ref, ref_source: r.ref_source,
    observed_head: r.observed_head, observed_dirty: r.observed_dirty, recorded_at: r.recorded_at,
  };
  if (!deployEnabled) return base;
  return {
    ...base,
    // deploy-done 写出的旧形态记录按提案通道、mode 为 null 读取（spec/environments.md §5.2）
    result: r.result, channel: r.channel ?? 'proposal', mode: r.mode ?? null,
    ref_requested: r.ref_requested ?? null, failure_reason: r.failure_reason ?? null,
  };
}

/** env show 历史中的 deploy 记录：启用时带全部扩展字段（spec/cli-json-output.md「env 与 status 部署视图字段」）。 */
function projectDeployHistory(r: DeployLedgerRecord, deployEnabled: boolean): DeployRecordView & Record<string, unknown> {
  const view = projectDeployRecord(r, deployEnabled) as DeployRecordView & Record<string, unknown>;
  if (!deployEnabled) return view;
  return {
    ...view,
    ref_input: r.ref_input ?? null, rollback: r.rollback ?? false, rollback_from: r.rollback_from ?? null,
    duration_ms: r.duration_ms ?? null, ci_run_id: r.ci_run_id ?? null, ci_run_url: r.ci_run_url ?? null,
    ci_reported_ref: r.ci_reported_ref ?? null, log_path: r.log_path ?? null, reconciled: r.reconciled ?? false,
    ...gateRecordFields(r),
  };
}

/** 受门环境的 deploy 记录可带审批与晋级字段（environment-promotion-approval）；未配置门的记录不含、输出不变。 */
function gateRecordFields(r: DeployLedgerRecord): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of ['approval_id', 'promoted_from', 'promotion_override_reason'] as const) {
    if (r[k] !== undefined) out[k] = r[k] ?? null;
  }
  return out;
}

export function projectSmokeRecord(r: SmokeLedgerRecord): SmokeRecordView {
  return {
    deploy_id: r.deploy_id, slug: r.slug, ref: r.ref, result: r.result, env_evidence: r.env_evidence,
    fresh_results: r.fresh_results, deploy_env_confirmed: r.deploy_env_confirmed, verified: r.verified,
    observed_head: r.observed_head, recorded_at: r.recorded_at,
  };
}

const projectApproval = (r: ApprovalLedgerRecord): ApprovalView => ({
  approval_id: r.approval_id, ref: r.ref, approver: r.approver, note: r.note, recorded_at: r.recorded_at,
});

export function projectHistoryRecord(
  r: LedgerRecord, deployEnabled = false,
): ({ kind: 'deploy' } & DeployRecordView) | ({ kind: 'smoke' } & SmokeRecordView) | ({ kind: 'approval' } & ApprovalRecordView) {
  if (r.kind === 'deploy') return { kind: 'deploy', ...projectDeployHistory(r, deployEnabled) };
  if (r.kind === 'smoke') return { kind: 'smoke', ...projectSmokeRecord(r) };
  return {
    kind: 'approval', approval_id: r.approval_id, slug: r.slug, ref: r.ref, ref_input: r.ref_input, approver: r.approver, note: r.note,
    observed_head: r.observed_head, observed_dirty: r.observed_dirty, recorded_at: r.recorded_at,
  };
}

/**
 * 部署执行已启用（spec/environments.md §1）：登记表中至少一个环境配置了 deploy，或账本中存在
 * openlogos deploy 写出的记录（带 channel）。未启用时 smoke / 视图行为与引入部署执行前逐字一致。
 */
export function isDeployExecutionEnabled(environments: EnvironmentDef[], ledger: LedgerSnapshot): boolean {
  return environments.some(e => e.deploy !== undefined) || ledger.hasDeployExecutionRecords;
}

export const DEPLOY_LOCKS_REL = 'logos/.openlogos-runtime/deploy-locks';
export const DEPLOY_PENDING_REL = 'logos/.openlogos-runtime/deploy-pending';

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

export function pidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const modeOrNull = (v: unknown): DeployMode | null => ((DEPLOY_MODES as readonly unknown[]).includes(v) ? v as DeployMode : null);

/**
 * 读取该环境的部署占用（spec/environments.md §11.8）：未决记录（deploy-pending/<env>.json）优先，
 * 不随本地进程退出解除；本地锁（deploy-locks/<env>.lock）只在持有进程仍存活时视为占用。
 */
export function readDeployInProgress(root: string, envId: string): DeployInProgressView | null {
  const pending = readJsonObject(join(root, DEPLOY_PENDING_REL, `${envId}.json`));
  if (pending && isNonEmptyString(pending.deploy_id)) {
    return {
      deploy_id: pending.deploy_id, mode: modeOrNull(pending.mode), started_at: strOrNull(pending.started_at),
      run_id: strOrNull(pending.run_id), run_url: strOrNull(pending.run_url), unresolved: true,
    };
  }
  const lock = readJsonObject(join(root, DEPLOY_LOCKS_REL, `${envId}.lock`));
  if (lock && isNonEmptyString(lock.deploy_id) && pidAlive(lock.pid)) {
    return {
      deploy_id: lock.deploy_id, mode: modeOrNull(lock.mode), started_at: strOrNull(lock.started_at),
      run_id: null, run_url: null, unresolved: false,
    };
  }
  return null;
}

/**
 * 环境视图（spec/environments.md §7.1）：current_ref 取最近一条成功 deploy 记录的 ref（成功但未确认为 null）；
 * 部署执行已启用时另输出 previous_ref、deploy_mode、deploy_in_progress 与 last_deploy 扩展字段。
 */
export function buildEnvView(env: EnvironmentDef, ledger: LedgerSnapshot, options: EnvViewOptions = { deployEnabled: false }): EnvView {
  const state = ledger.byEnvironment.get(env.id);
  const lastDeploy = state?.lastDeploy ?? null;
  const base = {
    id: env.id,
    name: env.name,
    tier: env.tier,
    current_ref: state?.hasDone ? state.currentRef : null,
  };
  const tail = {
    last_deploy: lastDeploy ? projectDeployRecord(lastDeploy, options.deployEnabled) : null,
    last_smoke: state?.lastSmoke ? projectSmokeRecord(state.lastSmoke) : null,
  };
  const gate = gateViewFields(env, ledger);
  if (!options.deployEnabled) return { ...base, ...tail, ...gate };
  return {
    ...base,
    previous_ref: previousRefOf(state),
    deploy_mode: env.deploy?.mode ?? null,
    deploy_in_progress: options.root ? readDeployInProgress(options.root, env.id) : null,
    ...tail,
    ...gate,
  };
}

/**
 * 晋级与审批视图字段（spec/environments.md §7.1，决策 C08）：只在条目写有 promote_from 或 require_approval 时输出；
 * promotion.candidate_ref 取上游环境最近一条 verified=true smoke 记录的 ref。
 */
function gateViewFields(env: EnvironmentDef, ledger: LedgerSnapshot): Pick<EnvView, 'promote_from' | 'require_approval' | 'open_approvals' | 'promotion'> {
  if (!env.gate) return {};
  const from = env.gate.promote_from;
  return {
    promote_from: from,
    require_approval: env.gate.require_approval,
    open_approvals: (ledger.byEnvironment.get(env.id)?.openApprovals ?? []).map(projectApproval),
    promotion: from === null ? null : { from, candidate_ref: ledger.byEnvironment.get(from)?.candidateRef ?? null },
  };
}

/**
 * status 环境视图字段（spec/environments.md §7.3，S11）：登记表不存在返回 null（不输出任何字段）；
 * 存在时输出 environments 与 environment_ledger，非法时 environments 为 [] 并附 environment_registry_error。
 * 与 env list / show 共用 loadEnvironmentRegistry、readDeploymentLedger、buildEnvView；全程不联网。
 */
export interface StatusEnvironmentFields {
  environments: EnvView[];
  environment_ledger: { path: string; corrupt_lines: number };
  environment_registry_error?: { code: 'ENV_REGISTRY_INVALID'; message: string };
}

export function collectStatusEnvironmentFields(root: string): StatusEnvironmentFields | null {
  const reg = loadEnvironmentRegistry(root);
  if (reg.state === 'absent') return null;
  const ledger = readDeploymentLedger(root);
  const environment_ledger = { path: ledger.path, corrupt_lines: ledger.corruptLines };
  if (reg.state === 'unloadable' || reg.errors.length > 0) {
    const reasons = reg.state === 'unloadable'
      ? [reg.error.reason]
      : reg.errors.map(e => `${e.environment ?? ''}.${e.field ?? ''}: ${e.reason}`);
    return {
      environments: [],
      environment_ledger,
      environment_registry_error: {
        code: 'ENV_REGISTRY_INVALID',
        message: `Environment registry ${ENV_REGISTRY_REL} is invalid: ${reasons.join('; ')}. Run \`openlogos env check\` for details.`,
      },
    };
  }
  const deployEnabled = isDeployExecutionEnabled(reg.environments, ledger);
  return { environments: reg.environments.map(env => buildEnvView(env, ledger, { deployEnabled, root })), environment_ledger };
}
