/**
 * 环境登记表与本机部署账本（environment-registry，S41）。
 *
 * 规范源：spec/environments.md（登记表 §2、--env 解析 §3、账本 §5、视图 §7、错误码 §8）；
 * 功能规格 §2.93；架构「五十三、环境登记表与部署账本」。
 *
 * 本模块只读：加载并校验 `logos/environments.yaml`、解析 `--env`、顺序流式读取
 * `logos/.openlogos-runtime/deployments.jsonl` 并投影环境视图。账本写入由 deploy-done / smoke 负责。
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
const ENV_FIELDS = new Set(['id', 'name', 'tier', 'aliases', 'description', 'health', 'version', 'secrets']);

export interface EnvironmentDef {
  id: string;
  name: string;
  tier: EnvTier;
  aliases: string[];
  description: string | null;
  health: string | null;
  version: string | null;
  secrets: string[];
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
  try {
    doc = parseYaml(readFileSync(file, 'utf-8'));
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
    });
  });

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

export interface DeployLedgerRecord {
  kind: 'deploy';
  environment: string;
  slug: string;
  recorded_at: string;
  observed_head: string | null;
  observed_dirty: boolean | null;
  deploy_id: string;
  ref: string | null;
  ref_source: 'explicit' | 'unknown';
  result: 'done';
}

export interface SmokeLedgerRecord {
  kind: 'smoke';
  environment: string;
  slug: string;
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

export type LedgerRecord = DeployLedgerRecord | SmokeLedgerRecord;

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

/**
 * 逐行校验（spec/environments.md §5.4）：按 kind 校验必需字段、类型、枚举与 verified 一致性。
 * 合法返回记录，否则返回 null（调用方计入 corrupt_lines，不更新状态）。未知额外字段保留兼容。
 */
export function validateLedgerRecord(value: unknown): LedgerRecord | null {
  if (!isRecord(value)) return null;
  const o = value;
  if (o.kind !== 'deploy' && o.kind !== 'smoke') return null;
  if (!isNonEmptyString(o.environment) || !isNonEmptyString(o.slug) || typeof o.recorded_at !== 'string') return null;
  if (!has(o, 'observed_head') || !isRefOrNull(o.observed_head)) return null;
  if (!has(o, 'observed_dirty') || !isBoolOrNull(o.observed_dirty)) return null;
  if (!has(o, 'ref') || !isRefOrNull(o.ref)) return null;
  if (o.kind === 'deploy') {
    if (!isNonEmptyString(o.deploy_id) || o.result !== 'done') return null;
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
}

export interface LedgerSnapshot {
  path: string;
  corruptLines: number;
  byEnvironment: Map<string, EnvLedgerState>;
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
  const snapshot: LedgerSnapshot = { path: DEPLOY_LEDGER_REL, corruptLines: 0, byEnvironment: new Map() };
  const file = join(root, DEPLOY_LEDGER_REL);
  if (!existsSync(file)) return snapshot;
  forEachLine(file, raw => {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') return;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { snapshot.corruptLines += 1; return; }
    const record = validateLedgerRecord(parsed);
    if (!record) { snapshot.corruptLines += 1; return; }
    let state = snapshot.byEnvironment.get(record.environment);
    if (!state) {
      state = { lastDeploy: null, lastSmoke: null, history: [] };
      snapshot.byEnvironment.set(record.environment, state);
    }
    if (record.kind === 'deploy') state.lastDeploy = record;
    else state.lastSmoke = record;
    state.history.unshift(record);
    if (state.history.length > ENV_HISTORY_LIMIT) state.history.length = ENV_HISTORY_LIMIT;
  });
  return snapshot;
}

// ───────────────────────────── 视图投影 ─────────────────────────────

export interface DeployRecordView {
  deploy_id: string;
  slug: string;
  ref: string | null;
  ref_source: 'explicit' | 'unknown';
  observed_head: string | null;
  observed_dirty: boolean | null;
  recorded_at: string;
}

export interface SmokeRecordView {
  deploy_id: string | null;
  slug: string;
  ref: string | null;
  result: 'pass' | 'fail';
  env_evidence: EnvEvidence;
  fresh_results: boolean;
  deploy_env_confirmed: boolean;
  verified: boolean;
  observed_head: string | null;
  recorded_at: string;
}

export interface EnvView {
  id: string;
  name: string;
  tier: EnvTier;
  current_ref: string | null;
  last_deploy: DeployRecordView | null;
  last_smoke: SmokeRecordView | null;
}

export function projectDeployRecord(r: DeployLedgerRecord): DeployRecordView {
  return {
    deploy_id: r.deploy_id, slug: r.slug, ref: r.ref, ref_source: r.ref_source,
    observed_head: r.observed_head, observed_dirty: r.observed_dirty, recorded_at: r.recorded_at,
  };
}

export function projectSmokeRecord(r: SmokeLedgerRecord): SmokeRecordView {
  return {
    deploy_id: r.deploy_id, slug: r.slug, ref: r.ref, result: r.result, env_evidence: r.env_evidence,
    fresh_results: r.fresh_results, deploy_env_confirmed: r.deploy_env_confirmed, verified: r.verified,
    observed_head: r.observed_head, recorded_at: r.recorded_at,
  };
}

export function projectHistoryRecord(r: LedgerRecord): ({ kind: 'deploy' } & DeployRecordView) | ({ kind: 'smoke' } & SmokeRecordView) {
  return r.kind === 'deploy'
    ? { kind: 'deploy', ...projectDeployRecord(r) }
    : { kind: 'smoke', ...projectSmokeRecord(r) };
}

/** 环境视图（spec/environments.md §7.1）：current_ref 取最近一次 deploy 记录的 ref。 */
export function buildEnvView(env: EnvironmentDef, ledger: LedgerSnapshot): EnvView {
  const state = ledger.byEnvironment.get(env.id);
  const lastDeploy = state?.lastDeploy ?? null;
  return {
    id: env.id,
    name: env.name,
    tier: env.tier,
    current_ref: lastDeploy ? lastDeploy.ref : null,
    last_deploy: lastDeploy ? projectDeployRecord(lastDeploy) : null,
    last_smoke: state?.lastSmoke ? projectSmokeRecord(state.lastSmoke) : null,
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
  return { environments: reg.environments.map(env => buildEnvView(env, ledger)), environment_ledger };
}
