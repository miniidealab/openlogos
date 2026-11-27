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
import { TEST_ID_ANCHORED_RE } from './test-id.js';

export const ENV_REGISTRY_REL = 'logos/environments.yaml';
export const DEPLOY_LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
/** 每个环境保留的历史条数（spec/environments.md §5.4）。 */
export const ENV_HISTORY_LIMIT = 20;

export const ENV_TIERS = ['dev', 'test', 'staging', 'prod'] as const;
export type EnvTier = (typeof ENV_TIERS)[number];

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SECRET_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const TOP_FIELDS = new Set(['schema_version', 'environments', 'proposal_default_env']);
/** 顶层「提案默认部署环境」字段（spec/environments.md §13，proposal-default-environment）。 */
export const PROPOSAL_DEFAULT_ENV_FIELD = 'proposal_default_env';
const ENV_FIELDS = new Set(['id', 'name', 'tier', 'aliases', 'description', 'health', 'version', 'secrets', 'deploy', 'promote_from', 'require_approval', 'manual_acceptance']);
/** 人工验收开关字段（smoke-manual-acceptance，spec/environments.md §15.2）。 */
export const MANUAL_ACCEPTANCE_FIELD = 'manual_acceptance';
const MANUAL_ACCEPTANCE_KEYS = new Set(['enabled', 'regression']);
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
  /**
   * 人工验收开关（smoke-manual-acceptance，§15.2）：条目写有 manual_acceptance 时才出现。不构成受门环境
   * （不影响 isGatedEnvironment、deploy-done 与审批）。
   */
  manualAcceptance?: { enabled: boolean; regression: string[] };
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
  | {
    state: 'loaded'; environments: EnvironmentDef[]; errors: RegistryIssue[]; warnings: RegistryIssue[];
    /** 顶层 proposal_default_env（§13）：未配置或非法时为 null；非法时 errors 中另有一条 ENV_FIELD_INVALID。 */
    proposalDefaultEnv: string | null;
  };

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
    const manualAcceptance = validateManualAcceptance(raw, text, label, bad, warnings);
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
      ...(manualAcceptance ? { manualAcceptance } : {}),
    });
  });
  validateGateReferences(environments, errors);
  const proposalDefaultEnv = validateProposalDefaultEnv(doc, doc.environments, errors);

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
  return { state: 'loaded', environments, errors, warnings, proposalDefaultEnv };
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

/**
 * 人工验收字段校验（smoke-manual-acceptance，spec/environments.md §15.2）：必须是对象，只认 enabled（布尔）与
 * regression（UT-/ST-/SMOKE- 前缀、首格 ID 格式合法、不重复的字符串数组）；其他键出 ENV_UNKNOWN_FIELD 警告；
 * 须以普通键名书写（与门禁字段同一规则）。条目未写该字段时返回 null。regression 指向的用例是否存在、是否为人工用例
 * 不在这里判定，由 smoke 在已部署版本上解析（§15.4）。
 */
function validateManualAcceptance(
  raw: Record<string, unknown>, text: string, label: string, bad: (field: string, reason: string) => void, warnings: RegistryIssue[],
): EnvironmentDef['manualAcceptance'] | null {
  if (!has(raw, MANUAL_ACCEPTANCE_FIELD)) return null;
  if (!text.includes(MANUAL_ACCEPTANCE_FIELD)) {
    bad(MANUAL_ACCEPTANCE_FIELD, `${MANUAL_ACCEPTANCE_FIELD} must be written as a plain key; escaped or continued key spellings are rejected`);
  }
  const value = raw[MANUAL_ACCEPTANCE_FIELD];
  if (!isRecord(value)) {
    bad(MANUAL_ACCEPTANCE_FIELD, `${MANUAL_ACCEPTANCE_FIELD} must be a mapping with optional enabled (boolean) and regression (array of case IDs)`);
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!MANUAL_ACCEPTANCE_KEYS.has(key)) {
      warnings.push({ code: 'ENV_UNKNOWN_FIELD', environment: label, field: `${MANUAL_ACCEPTANCE_FIELD}.${key}`, reason: 'unknown manual_acceptance field' });
    }
  }
  if (has(value, 'enabled') && typeof value.enabled !== 'boolean') bad(`${MANUAL_ACCEPTANCE_FIELD}.enabled`, 'enabled must be a boolean');
  const regression = value.regression ?? [];
  const validId = (v: unknown): v is string => typeof v === 'string' && /^(?:UT|ST|SMOKE)-/.test(v) && TEST_ID_ANCHORED_RE.test(v);
  if (!Array.isArray(regression)) {
    bad(`${MANUAL_ACCEPTANCE_FIELD}.regression`, 'regression must be an array of case IDs (UT-/ST-/SMOKE-)');
  } else {
    regression.forEach((id, i) => {
      if (!validId(id)) bad(`${MANUAL_ACCEPTANCE_FIELD}.regression[${i}]`, 'regression entries must be UT-/ST-/SMOKE- case IDs');
    });
    if (new Set(regression).size !== regression.length) bad(`${MANUAL_ACCEPTANCE_FIELD}.regression`, 'regression must not contain duplicate IDs');
  }
  return {
    enabled: value.enabled === true,
    regression: Array.isArray(regression) ? regression.filter(validId) : [],
  };
}

/**
 * 顶层 proposal_default_env 校验（spec/environments.md §13.2）：缺省或 null 为未配置；配置时须为字符串且与某个环境 id
 * 完全相等（不接受 alias、不做大小写归一）。对所指环境的其他配置不加限制。引用按登记表原始条目的 id 判断，
 * 避免因所指环境自身另有字段错误而重复报「未登记」。非法时报一条不带 environment 的 ENV_FIELD_INVALID。
 */
function validateProposalDefaultEnv(doc: Record<string, unknown>, rawEnvironments: unknown[], errors: RegistryIssue[]): string | null {
  if (!has(doc, PROPOSAL_DEFAULT_ENV_FIELD)) return null;
  const value = doc[PROPOSAL_DEFAULT_ENV_FIELD];
  if (value === null) return null;
  const bad = (reason: string, shown?: string) => errors.push({
    code: 'ENV_FIELD_INVALID', field: PROPOSAL_DEFAULT_ENV_FIELD, ...(shown !== undefined ? { value: shown } : {}), reason,
  });
  if (typeof value !== 'string' || value.trim() === '') {
    bad('proposal_default_env must be the id of a registered environment');
    return null;
  }
  const ids = rawEnvironments
    .filter((raw): raw is Record<string, unknown> => isRecord(raw) && typeof raw.id === 'string')
    .map(raw => raw.id as string);
  if (ids.includes(value)) return value;
  const needle = value.trim().toLowerCase();
  const intended = rawEnvironments.find((raw): raw is Record<string, unknown> => isRecord(raw) && typeof raw.id === 'string' && (
    (raw.id as string).toLowerCase() === needle
    || (Array.isArray(raw.aliases) && raw.aliases.some(a => typeof a === 'string' && a.trim().toLowerCase() === needle))
  ));
  bad(intended
    ? `proposal_default_env must be an environment id, not an alias or differently-cased id (did you mean ${intended.id as string}?)`
    : `proposal_default_env references unregistered environment "${value}"`, value);
  return null;
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
  /** pending：等待人工验收（smoke-manual-acceptance，§15.6），此时 verified 恒为 false。 */
  result: 'pass' | 'fail' | 'pending';
  env_evidence: EnvEvidence;
  fresh_results: boolean;
  deploy_env_confirmed: boolean;
  verified: boolean;
  /** 人工阶段判定通过（§15.6）；只出现在开启人工验收的环境的 pass 记录上。 */
  manual_passed?: boolean;
  /** result=pending 时必有：锁内读取时 P(E, D) 中仍无该部署 manual 记录的用例 ID（§15.6）。 */
  manual_pending?: string[];
}

/** manual 记录（smoke-manual-acceptance，spec/environments.md §5.2、§15.5）：openlogos accept 逐用例写入。 */
export interface ManualLedgerRecord {
  kind: 'manual';
  environment: string;
  slug: string | null;
  recorded_at: string;
  observed_head: string | null;
  observed_dirty: boolean | null;
  deploy_id: string;
  ref: string | null;
  case_id: string;
  result: 'pass' | 'fail';
  note: string | null;
  evidence: string[];
  recorder: string | null;
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

export type LedgerRecord = DeployLedgerRecord | SmokeLedgerRecord | ApprovalLedgerRecord | ManualLedgerRecord;

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
  if (o.kind !== 'deploy' && o.kind !== 'smoke' && o.kind !== 'approval' && o.kind !== 'manual') return null;
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
  if (o.kind === 'manual') {
    // smoke-manual-acceptance（§5.4）：fail 必须带非空说明；evidence 为字符串数组
    if (!isNonEmptyString(o.deploy_id) || typeof o.case_id !== 'string' || !/^(?:UT|ST|SMOKE)-/.test(o.case_id) || !TEST_ID_ANCHORED_RE.test(o.case_id)) return null;
    if (o.result !== 'pass' && o.result !== 'fail') return null;
    if (!has(o, 'note') || !isStringOrNull(o.note)) return null;
    if (o.result === 'fail' && (typeof o.note !== 'string' || o.note.trim() === '')) return null;
    if (!Array.isArray(o.evidence) || o.evidence.some(e => typeof e !== 'string')) return null;
    if (!has(o, 'recorder') || !isStringOrNull(o.recorder)) return null;
    return o as unknown as ManualLedgerRecord;
  }
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
  if (o.result !== 'pass' && o.result !== 'fail' && o.result !== 'pending') return null;
  // smoke-manual-acceptance（§5.4）：pending 时 verified 恒为 false、manual_pending 为字符串数组；manual_passed 出现时为布尔
  if (o.result === 'pending' && (!Array.isArray(o.manual_pending) || o.manual_pending.some(id => typeof id !== 'string'))) return null;
  if (has(o, 'manual_pending') && (!Array.isArray(o.manual_pending) || o.manual_pending.some(id => typeof id !== 'string'))) return null;
  if (!optional(o, 'manual_passed', v => typeof v === 'boolean')) return null;
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
  /**
   * 人工验收推导（smoke-manual-acceptance，§5.4、§15.3、§15.7）：按行序 seq 记录 verified / manual_passed 的 smoke 记录、
   * 每个部署的 manual 记录与最近一条 smoke 记录；扫描结束后由 finalizeManualState 计算过期、verifiedRefs 与 candidateRef。
   */
  passRecords: Array<{ seq: number; record: SmokeLedgerRecord }>;
  manualByDeploy: Map<string, Array<{ seq: number; record: ManualLedgerRecord }>>;
  lastSmokeByDeploy: Map<string, { seq: number; record: SmokeLedgerRecord }>;
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
  let seq = 0;
  try {
    forEachLine(file, raw => {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') return;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { snapshot.corruptLines += 1; return; }
    const record = validateLedgerRecord(parsed);
    if (!record) { snapshot.corruptLines += 1; return; }
    seq += 1;
    let state = snapshot.byEnvironment.get(record.environment);
    if (!state) {
      state = {
        lastDeploy: null, lastSmoke: null, history: [], currentRef: null, hasDone: false, priorRef1: null, priorRef2: null,
        openApprovals: [], verifiedRefs: new Set(), candidateRef: null,
        passRecords: [], manualByDeploy: new Map(), lastSmokeByDeploy: new Map(),
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
      if (record.deploy_id !== null) state.lastSmokeByDeploy.set(record.deploy_id, { seq, record });
      if ((record.verified && record.ref !== null) || record.manual_passed === true) state.passRecords.push({ seq, record });
    } else if (record.kind === 'manual') {
      // manual 记录进入历史，不进入 last_deploy / last_smoke，不影响 current_ref / previous_ref（§5.4）
      const list = state.manualByDeploy.get(record.deploy_id) ?? [];
      list.push({ seq, record });
      state.manualByDeploy.set(record.deploy_id, list);
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
  for (const state of snapshot.byEnvironment.values()) finalizeManualState(state);
  return snapshot;
}

/** 该部署在 seq 之后是否出现过 manual 记录（通过记录过期判据，§15.3）。 */
function hasManualAfter(state: EnvLedgerState, deployId: string | null, seq: number): boolean {
  if (deployId === null) return false;
  return (state.manualByDeploy.get(deployId) ?? []).some(m => m.seq > seq);
}

/** 一条 smoke 记录是否为已过期的人工通过记录（§15.3）：manual_passed=true 且其后出现同一部署的 manual 记录。 */
export function isExpiredPass(state: EnvLedgerState, entry: { seq: number; record: SmokeLedgerRecord }): boolean {
  return entry.record.manual_passed === true && hasManualAfter(state, entry.record.deploy_id, entry.seq);
}

/**
 * 扫描结束后的推导：已验证 commit 集合与晋级候选只认未过期的 verified=true 记录（§5.4「人工验收推导」、§12.3）。
 * 未开启人工验收、没有 manual 记录的项目，结果与按行累加逐字一致（没有记录会过期）。
 */
function finalizeManualState(state: EnvLedgerState): void {
  state.verifiedRefs = new Set();
  state.candidateRef = null;
  for (const entry of state.passRecords) {
    if (!entry.record.verified || entry.record.ref === null || isExpiredPass(state, entry)) continue;
    state.verifiedRefs.add(entry.record.ref);
    state.candidateRef = entry.record.ref;
  }
}

/** 当前部署（§15.3）：环境最近一条 deploy 记录（任意 result，与 smoke 部署身份核对同一身份）。 */
export interface CurrentDeployment {
  deploy_id: string;
  ref: string | null;
  result: DeployLedgerRecord['result'];
  /** 最终 result=done。 */
  confirmed: boolean;
}

export function currentDeploymentOf(state: EnvLedgerState | undefined): CurrentDeployment | null {
  const d = state?.lastDeploy;
  if (!d) return null;
  return { deploy_id: d.deploy_id, ref: d.ref, result: d.result, confirmed: d.result === 'done' };
}

/**
 * 人工验收基线 B（§15.3）：deploy_id 不等于当前部署的部署中，最近一条未过期的 manual_passed=true smoke 记录的 ref。
 * 当前部署自己的通过记录不作为它的基线。返回 null 表示无基线。
 */
export function manualBaselineOf(state: EnvLedgerState | undefined): string | null {
  if (!state) return null;
  const current = state.lastDeploy?.deploy_id ?? null;
  for (let i = state.passRecords.length - 1; i >= 0; i--) {
    const entry = state.passRecords[i];
    if (entry.record.manual_passed !== true || entry.record.deploy_id === current) continue;
    if (isExpiredPass(state, entry)) continue;
    return entry.record.ref;
  }
  return null;
}

/** 某部署每个用例的最后一条 manual 记录（同一部署同一用例以文件中最后一条为准，§5.2）。 */
export function manualResultsOf(state: EnvLedgerState | undefined, deployId: string): Map<string, ManualLedgerRecord> {
  const out = new Map<string, ManualLedgerRecord>();
  for (const m of state?.manualByDeploy.get(deployId) ?? []) out.set(m.record.case_id, m.record);
  return out;
}

/**
 * 等待人工验收（§15.7）：当前部署最近一条 smoke 记录为 pending 时返回剩余清单 = manual_pending 减去其后该部署
 * manual 记录覆盖的用例；否则 null。只读账本、不读 git。
 */
export function waitingStateOf(state: EnvLedgerState | undefined): { deploy_id: string; remaining: string[] } | null {
  const current = state?.lastDeploy?.deploy_id;
  if (!state || !current) return null;
  const last = state.lastSmokeByDeploy.get(current);
  if (!last || last.record.result !== 'pending') return null;
  const covered = new Set((state.manualByDeploy.get(current) ?? []).filter(m => m.seq > last.seq).map(m => m.record.case_id));
  return { deploy_id: current, remaining: (last.record.manual_pending ?? []).filter(id => !covered.has(id)) };
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
  result: 'pass' | 'fail' | 'pending';
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
  /** 只在该环境登记表条目写有 manual_acceptance 时输出（smoke-manual-acceptance，§15.7）。 */
  manual_acceptance?: { enabled: boolean; regression: string[]; waiting: { deploy_id: string; remaining: string[] } | null };
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

export function projectSmokeRecord(r: SmokeLedgerRecord): SmokeRecordView & { manual_passed?: boolean; manual_pending?: string[] } {
  return {
    deploy_id: r.deploy_id, slug: r.slug, ref: r.ref, result: r.result, env_evidence: r.env_evidence,
    fresh_results: r.fresh_results, deploy_env_confirmed: r.deploy_env_confirmed, verified: r.verified,
    observed_head: r.observed_head, recorded_at: r.recorded_at,
    // smoke-manual-acceptance：可选字段只在记录带有时输出，未开启人工验收的记录投影逐字不变
    ...(r.manual_passed !== undefined ? { manual_passed: r.manual_passed } : {}),
    ...(r.manual_pending !== undefined ? { manual_pending: r.manual_pending } : {}),
  };
}

const projectApproval = (r: ApprovalLedgerRecord): ApprovalView => ({
  approval_id: r.approval_id, ref: r.ref, approver: r.approver, note: r.note, recorded_at: r.recorded_at,
});

export function projectHistoryRecord(
  r: LedgerRecord, deployEnabled = false,
): ({ kind: 'deploy' } & DeployRecordView) | ({ kind: 'smoke' } & SmokeRecordView) | ({ kind: 'approval' } & ApprovalRecordView)
  | ({ kind: 'manual' } & Omit<ManualLedgerRecord, 'kind' | 'environment'>) {
  if (r.kind === 'deploy') return { kind: 'deploy', ...projectDeployHistory(r, deployEnabled) };
  if (r.kind === 'smoke') return { kind: 'smoke', ...projectSmokeRecord(r) };
  if (r.kind === 'manual') {
    return {
      kind: 'manual', slug: r.slug, deploy_id: r.deploy_id, ref: r.ref, case_id: r.case_id, result: r.result, note: r.note,
      evidence: r.evidence, recorder: r.recorder, observed_head: r.observed_head, observed_dirty: r.observed_dirty, recorded_at: r.recorded_at,
    };
  }
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
  // smoke-manual-acceptance（§15.7）：只在条目写有 manual_acceptance 时输出，未配置的环境视图逐字不变
  const manual = env.manualAcceptance
    ? { manual_acceptance: { enabled: env.manualAcceptance.enabled, regression: env.manualAcceptance.regression, waiting: waitingStateOf(state) } }
    : {};
  if (!options.deployEnabled) return { ...base, ...tail, ...gate, ...manual };
  return {
    ...base,
    previous_ref: previousRefOf(state),
    deploy_mode: env.deploy?.mode ?? null,
    deploy_in_progress: options.root ? readDeployInProgress(options.root, env.id) : null,
    ...tail,
    ...gate,
    ...manual,
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
