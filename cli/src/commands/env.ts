/**
 * env — environment-registry（S41）：`openlogos env list | show | check` 只读查询命令。
 *
 * 规范源：spec/environments.md §2、§3、§5.4、§7；spec/cli-json-output.md「`openlogos env list|show|check --format json`」；
 * 功能规格 §2.93.6。三个命令只读、不要求活跃提案；只有 `env check --probe` 发起网络请求。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readLocale, t } from '../i18n.js';
import type { Locale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope } from '../lib/json-output.js';
import type { OutputFormat } from '../lib/json-output.js';
import { readProjectYaml } from '../lib/project-yaml.js';
import { ghUnavailableReason } from '../lib/deploy-ci.js';
import {
  ENV_HISTORY_LIMIT, ENV_REGISTRY_REL, buildEnvView, isDeployExecutionEnabled, loadEnvironmentRegistry, projectHistoryRecord,
  readDeploymentLedger, resolveEnvironment,
} from '../lib/environments.js';
import type { EnvView, EnvironmentDef, LedgerSnapshot, RegistryIssue } from '../lib/environments.js';

/** 探测超时（spec/environments.md §7.2）。 */
export const ENV_PROBE_TIMEOUT_MS = 5000;
const VERSION_EXCERPT_LIMIT = 200;

interface IssueOut {
  code: string;
  message: string;
  environment?: string;
  field?: string;
  value?: string;
  module?: string;
  name?: string;
  kind?: 'health' | 'version';
  url?: string;
}

interface ProbeOut {
  environment: string;
  kind: 'health' | 'version';
  url: string;
  status: number | null;
  ok: boolean;
  duration_ms: number;
  error: string | null;
  body_excerpt?: string;
}

function issueMessage(locale: Locale, issue: RegistryIssue): string {
  // 顶层字段（如 proposal_default_env，spec/environments.md §13.2）没有所属环境，使用不带环境名的文案
  const key = issue.code === 'ENV_FIELD_INVALID' && issue.environment === undefined ? 'env.issue.ENV_FIELD_INVALID_TOP' : `env.issue.${issue.code}`;
  const where = issue.environment ? ` (${issue.environment})` : '';
  return t(locale, key, {
    environment: issue.environment ?? '', field: issue.field ?? '', value: issue.value ?? '', reason: issue.reason, where,
  });
}

function toIssueOut(locale: Locale, issue: RegistryIssue): IssueOut {
  const out: IssueOut = { code: issue.code, message: issueMessage(locale, issue) };
  if (issue.environment !== undefined) out.environment = issue.environment;
  if (issue.field !== undefined) out.field = issue.field;
  if (issue.value !== undefined) out.value = issue.value;
  return out;
}

function fail(command: string, format: OutputFormat, code: string, message: string): void {
  if (format === 'json') {
    console.error(JSON.stringify(makeErrorEnvelope(command, code, message)));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exitCode = 1;
}

type Loaded = { environments: EnvironmentDef[]; warnings: RegistryIssue[]; proposalDefaultEnv: string | null };

/**
 * 供 list / show 使用：登记表必须存在且合法。absent 时 list 返回 null 由调用方输出空视图；
 * 不合法时输出 ENV_REGISTRY_INVALID 并返回 undefined。
 */
function requireValidRegistry(
  root: string, command: string, format: OutputFormat, locale: Locale, allowAbsent: boolean,
): Loaded | null | undefined {
  const reg = loadEnvironmentRegistry(root);
  if (reg.state === 'absent') {
    if (allowAbsent) return null;
    fail(command, format, 'ENV_REGISTRY_NOT_FOUND', t(locale, 'env.error.registryNotFound', { path: ENV_REGISTRY_REL }));
    return undefined;
  }
  if (reg.state === 'unloadable') {
    fail(command, format, 'ENV_REGISTRY_INVALID', t(locale, 'env.error.registryInvalid', { path: ENV_REGISTRY_REL, reason: reg.error.reason }));
    return undefined;
  }
  if (reg.errors.length > 0) {
    const reason = reg.errors.map(e => issueMessage(locale, e)).join(' ');
    fail(command, format, 'ENV_REGISTRY_INVALID', t(locale, 'env.error.registryInvalid', { path: ENV_REGISTRY_REL, reason }));
    return undefined;
  }
  return { environments: reg.environments, warnings: reg.warnings, proposalDefaultEnv: reg.proposalDefaultEnv };
}

function ensureProject(root: string, command: string, format: OutputFormat, locale: Locale): boolean {
  if (existsSync(join(root, 'logos', 'logos.config.json'))) return true;
  fail(command, format, 'PROJECT_NOT_INITIALIZED', t(locale, 'env.error.projectNotInitialized'));
  return false;
}

const shortRef = (ref: string | null, locale: Locale) => (ref ? ref.slice(0, 12) : t(locale, 'env.view.unknownRef'));

function printView(view: EnvView & { aliases?: string[] }, locale: Locale, proposalDefault = false): void {
  // 提案默认部署环境标注（spec/environments.md §13.3）；未配置时文本输出逐字不变
  const mark = proposalDefault ? t(locale, 'env.view.proposalDefault') : '';
  console.log(`  ${view.id}  ${view.name}  [${view.tier}]${mark}`);
  if (view.aliases && view.aliases.length > 0) console.log(`      ${t(locale, 'env.view.aliases', { aliases: view.aliases.join(', ') })}`);
  console.log(`      ${t(locale, 'env.view.currentRef', { ref: view.last_deploy ? shortRef(view.current_ref, locale) : t(locale, 'env.view.never') })}`);
  if (view.last_deploy) {
    console.log(`      ${t(locale, 'env.view.lastDeploy', { time: view.last_deploy.recorded_at, slug: view.last_deploy.slug ?? view.last_deploy.channel ?? '-' })}`);
  }
  // 部署执行已启用时才有以下字段（spec/environments.md §7.1）；未启用时文本输出逐字不变
  if (view.previous_ref !== undefined && view.previous_ref !== null) {
    console.log(`      ${t(locale, 'env.view.previousRef', { ref: shortRef(view.previous_ref, locale) })}`);
  }
  if (view.deploy_in_progress) {
    console.log(`      ${t(locale, 'env.view.inProgress', { id: view.deploy_in_progress.deploy_id, mode: view.deploy_in_progress.mode ?? '-' })}`);
  }
  if (view.last_smoke) {
    const verified = t(locale, view.last_smoke.verified ? 'env.view.verified' : 'env.view.notVerified');
    console.log(`      ${t(locale, 'env.view.lastSmoke', { result: view.last_smoke.result, verified, time: view.last_smoke.recorded_at })}`);
  }
  // 晋级与审批字段只在条目写有 promote_from / require_approval 时出现（spec/environments.md §7.1）；未写时文本输出逐字不变
  if (view.promotion) {
    const candidate = view.promotion.candidate_ref ? shortRef(view.promotion.candidate_ref, locale) : t(locale, 'env.view.never');
    console.log(`      ${t(locale, 'env.view.promotion', { from: view.promotion.from, ref: candidate })}`);
  }
  if (view.require_approval !== undefined) {
    const key = view.require_approval ? 'env.view.approvalRequired' : 'env.view.approvalNotRequired';
    console.log(`      ${t(locale, key, { count: String(view.open_approvals?.length ?? 0) })}`);
    for (const a of view.open_approvals ?? []) {
      console.log(`        ${t(locale, 'env.view.openApproval', { id: a.approval_id, ref: shortRef(a.ref, locale), approver: a.approver ?? '-', time: a.recorded_at })}`);
    }
  }
}

function printLedgerCorrupt(ledger: LedgerSnapshot, locale: Locale): void {
  if (ledger.corruptLines > 0) console.log(`\n  ${t(locale, 'env.ledger.corrupt', { path: ledger.path, count: String(ledger.corruptLines) })}`);
}

const ledgerOut = (ledger: LedgerSnapshot) => ({ path: ledger.path, corrupt_lines: ledger.corruptLines });

/** `openlogos env list`（spec/environments.md §7.2）。 */
export function envList(format: OutputFormat = 'text', root: string = process.cwd()): void {
  const locale = readLocale(root);
  if (!ensureProject(root, 'env list', format, locale)) return;
  const loaded = requireValidRegistry(root, 'env list', format, locale, true);
  if (loaded === undefined) return;
  const ledger = readDeploymentLedger(root);
  const deployEnabled = isDeployExecutionEnabled(loaded?.environments ?? [], ledger);
  const environments = (loaded?.environments ?? []).map(env => ({ ...buildEnvView(env, ledger, { deployEnabled, root }), aliases: env.aliases }));
  const warnings = (loaded?.warnings ?? []).map(w => toIssueOut(locale, w));

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('env list', {
      registry_path: ENV_REGISTRY_REL,
      registry_present: loaded !== null,
      // 仅登记表配置了 proposal_default_env 时输出（spec/environments.md §13.3）；未配置时字段集逐字不变
      ...(loaded?.proposalDefaultEnv ? { proposal_default_env: loaded.proposalDefaultEnv } : {}),
      environments,
      ledger: ledgerOut(ledger),
      warnings,
    })));
    return;
  }
  if (loaded === null) {
    console.log(t(locale, 'env.list.absent', { path: ENV_REGISTRY_REL }));
    return;
  }
  console.log(`\n${t(locale, 'env.list.title', { path: ENV_REGISTRY_REL })}\n`);
  if (environments.length === 0) console.log(`  ${t(locale, 'env.list.empty')}`);
  for (const view of environments) printView(view, locale, view.id === loaded.proposalDefaultEnv);
  for (const w of warnings) console.log(`  ⚠ ${w.message}`);
  printLedgerCorrupt(ledger, locale);
}

/** `openlogos env show <id|alias>`（spec/environments.md §7.2）。 */
export function envShow(input: string | undefined, format: OutputFormat = 'text', root: string = process.cwd()): void {
  const locale = readLocale(root);
  if (!ensureProject(root, 'env show', format, locale)) return;
  const loaded = requireValidRegistry(root, 'env show', format, locale, false);
  if (!loaded) return;
  const available = loaded.environments.map(e => e.id).join(', ');
  if (input === undefined || input.trim() === '') {
    fail('env show', format, 'ENV_UNKNOWN', t(locale, 'env.error.argRequired', { available }));
    return;
  }
  const resolved = resolveEnvironment(loaded.environments, input);
  if (!resolved.ok) {
    fail('env show', format, 'ENV_UNKNOWN', t(locale, 'env.error.unknown', { input, available }));
    return;
  }
  const env = loaded.environments.find(e => e.id === resolved.id)!;
  const ledger = readDeploymentLedger(root);
  const deployEnabled = isDeployExecutionEnabled(loaded.environments, ledger);
  const view = buildEnvView(env, ledger, { deployEnabled, root });
  const history = (ledger.byEnvironment.get(env.id)?.history ?? []).map(r => projectHistoryRecord(r, deployEnabled));
  const warnings = loaded.warnings.map(w => toIssueOut(locale, w));

  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('env show', {
      environment: {
        id: env.id, name: env.name, tier: env.tier, aliases: env.aliases, description: env.description,
        health: env.health, version: env.version, secrets: env.secrets,
        // 配置了 deploy 时输出经 §11.2 校验的配置（实际部署引用，不含命令与密钥值，spec/environments.md §13.3）；未配置时不输出该键
        ...(env.deploy ? { deploy: env.deploy } : {}),
      },
      current_ref: view.current_ref,
      ...(deployEnabled
        ? { previous_ref: view.previous_ref, deploy_mode: view.deploy_mode, deploy_in_progress: view.deploy_in_progress }
        : {}),
      last_deploy: view.last_deploy,
      last_smoke: view.last_smoke,
      ...(env.gate
        ? { promote_from: view.promote_from, require_approval: view.require_approval, open_approvals: view.open_approvals, promotion: view.promotion }
        : {}),
      history,
      ledger: ledgerOut(ledger),
      warnings,
    })));
    return;
  }
  console.log('');
  printView({ ...view, aliases: env.aliases }, locale);
  if (env.description) console.log(`      ${env.description}`);
  console.log(`\n  ${t(locale, 'env.show.history', { limit: String(ENV_HISTORY_LIMIT) })}`);
  for (const h of history) {
    const detail = h.kind === 'deploy'
      ? `ref=${shortRef(h.ref, locale)}`
      : h.kind === 'smoke'
        ? `${h.result} ref=${shortRef(h.ref, locale)} verified=${h.verified}`
        : `ref=${shortRef(h.ref, locale)} id=${h.approval_id} approver=${h.approver ?? '-'}`;
    console.log(`    ${h.recorded_at}  ${h.kind}  ${detail}  (${h.slug ?? (h.kind === 'deploy' ? h.channel ?? '-' : '-')})`);
  }
  for (const w of warnings) console.log(`  ⚠ ${w.message}`);
  printLedgerCorrupt(ledger, locale);
}

async function probe(env: EnvironmentDef, kind: 'health' | 'version', url: string): Promise<ProbeOut> {
  const started = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(ENV_PROBE_TIMEOUT_MS) });
    const out: ProbeOut = {
      environment: env.id, kind, url, status: res.status, ok: res.ok, duration_ms: Date.now() - started,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
    if (kind === 'version') {
      out.body_excerpt = (await res.text()).trim().slice(0, VERSION_EXCERPT_LIMIT);
    } else {
      await res.body?.cancel();
    }
    return out;
  } catch (error) {
    const e = error as Error;
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
    return {
      environment: env.id, kind, url, status: null, ok: false, duration_ms: Date.now() - started,
      error: timedOut ? `timeout after ${ENV_PROBE_TIMEOUT_MS}ms` : e.message,
    };
  }
}

/** `openlogos env check [<id|alias>] [--probe]`（spec/environments.md §7.2）。 */
export async function envCheck(
  input: string | undefined, options: { probe?: boolean } = {}, format: OutputFormat = 'text', root: string = process.cwd(),
): Promise<void> {
  const locale = readLocale(root);
  if (!ensureProject(root, 'env check', format, locale)) return;
  const reg = loadEnvironmentRegistry(root);
  if (reg.state === 'absent') {
    fail('env check', format, 'ENV_REGISTRY_NOT_FOUND', t(locale, 'env.error.registryNotFound', { path: ENV_REGISTRY_REL }));
    return;
  }
  if (reg.state === 'unloadable') {
    fail('env check', format, 'ENV_REGISTRY_INVALID', t(locale, 'env.error.registryInvalid', { path: ENV_REGISTRY_REL, reason: reg.error.reason }));
    return;
  }

  let scope: string | null = null;
  if (input !== undefined) {
    const resolved = resolveEnvironment(reg.environments, input);
    if (!resolved.ok) {
      fail('env check', format, 'ENV_UNKNOWN', t(locale, 'env.error.unknown', { input, available: resolved.available.join(', ') }));
      return;
    }
    scope = resolved.id;
  }

  const errors: IssueOut[] = reg.errors.map(e => toIssueOut(locale, e));
  const warnings: IssueOut[] = reg.warnings.map(w => toIssueOut(locale, w));

  // deployment_gates.<module>.environments 中的每一项都必须能解析到登记环境
  const gates = readProjectYaml(root).data?.deployment_gates ?? {};
  for (const [module, gate] of Object.entries(gates)) {
    for (const value of gate.environments ?? []) {
      if (!resolveEnvironment(reg.environments, value).ok) {
        errors.push({
          code: 'ENV_GATE_REFERENCE_UNKNOWN', module, value,
          message: t(locale, 'env.issue.ENV_GATE_REFERENCE_UNKNOWN', { module, value }),
        });
      }
    }
  }

  const inScope = reg.environments.filter(e => scope === null || e.id === scope);
  // 密钥：只报变量名与是否存在，永不读取或输出值
  const secrets = inScope.flatMap(env => env.secrets.map(name => ({ environment: env.id, name, present: process.env[name] !== undefined })));
  for (const s of secrets.filter(x => !x.present)) {
    errors.push({
      code: 'ENV_SECRET_MISSING', environment: s.environment, name: s.name,
      message: t(locale, 'env.issue.ENV_SECRET_MISSING', { environment: s.environment, name: s.name }),
    });
  }

  // ci（github-actions）方式的环境：报告 gh 是否可用且已登录（只报是否满足；environment-deploy，spec/cli-json-output.md）
  const ghEnvs = inScope.filter(env => env.deploy?.mode === 'ci' && env.deploy.provider === 'github-actions');
  if (ghEnvs.length > 0) {
    const reason = ghUnavailableReason(root);
    if (reason !== null) {
      for (const env of ghEnvs) {
        errors.push({
          code: 'DEPLOY_CI_UNAVAILABLE', environment: env.id,
          message: t(locale, 'env.issue.DEPLOY_CI_UNAVAILABLE', { environment: env.id, reason }),
        });
      }
    }
  }

  const probes: ProbeOut[] = [];
  if (options.probe) {
    const jobs: Array<Promise<ProbeOut>> = [];
    for (const env of inScope) {
      if (env.health) jobs.push(probe(env, 'health', env.health));
      if (env.version) jobs.push(probe(env, 'version', env.version));
    }
    probes.push(...await Promise.all(jobs));
    for (const p of probes.filter(x => !x.ok)) {
      errors.push({
        code: 'ENV_PROBE_FAILED', environment: p.environment, kind: p.kind, url: p.url,
        message: t(locale, 'env.issue.ENV_PROBE_FAILED', { environment: p.environment, kind: p.kind, url: p.url, detail: p.error ?? '' }),
      });
    }
  }

  const ok = errors.length === 0;
  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('env check', { scope, ok, errors, warnings, secrets, probes })));
  } else {
    console.log(`\n${t(locale, 'env.check.title', { path: ENV_REGISTRY_REL })}\n`);
    for (const e of errors) console.log(`  ✗ [${e.code}] ${e.message}`);
    for (const w of warnings) console.log(`  ⚠ [${w.code}] ${w.message}`);
    for (const s of secrets) {
      console.log(`  · ${t(locale, 'env.check.secret', { name: s.name, environment: s.environment, state: t(locale, s.present ? 'env.check.secretSet' : 'env.check.secretMissing') })}`);
    }
    for (const p of probes) {
      console.log(`  · ${t(locale, 'env.check.probe', { kind: p.kind, url: p.url, state: p.ok ? String(p.status) : (p.error ?? '') })}`);
    }
    console.log(`\n  ${ok ? t(locale, 'env.check.ok') : t(locale, 'env.check.problems', { count: String(errors.length) })}`);
  }
  if (!ok) process.exitCode = 1;
}

/** `openlogos env <sub>` 分派。 */
export async function envCommand(args: string[], format: OutputFormat): Promise<void> {
  const sub = args[0];
  const positional = args.slice(1).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--format');
  switch (sub) {
    case 'list': envList(format); break;
    case 'show': envShow(positional[0], format); break;
    case 'check': await envCheck(positional[0], { probe: args.includes('--probe') }, format); break;
    default: {
      const locale = readLocale(process.cwd());
      console.error(`Unknown env subcommand: ${sub ?? '(none)'}`);
      console.error(t(locale, 'env.usage'));
      process.exitCode = 1;
    }
  }
}
