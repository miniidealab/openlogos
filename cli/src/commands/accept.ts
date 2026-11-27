/**
 * `openlogos accept`（spec/environments.md §15.5；来源变更 smoke-manual-acceptance，场景 S46）。
 *
 * 为开启人工验收的环境记录人工用例结果：每个用例追加一行 kind=manual 账本记录，绑定该环境当前部署。
 * 判定顺序（锁外预检与锁内复核相同）：身份 → 确认状态 → 清单可确定 → 清单成员；任一失败整批零写入。
 * 提案通道下使已有通过结论过期时删除 SMOKE_PASS（先账本后标记，失败撤销本次账本行）。
 * 本命令是 guard 受限命令：AI 调用须经宿主原生审批；recorder 只作展示，不作身份认证。
 */
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { readLocale, t, type Locale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope, type OutputFormat } from '../lib/json-output.js';
import {
  ENV_REGISTRY_REL, currentDeploymentOf, isExpiredPass, loadEnvironmentRegistry, manualResultsOf, readDeploymentLedger,
  resolveEnvironment, type EnvLedgerState, type EnvironmentDef, type ManualLedgerRecord,
} from '../lib/environments.js';
import { appendLedgerLineLocked, removeOwnLedgerLine, withLedgerLock } from '../lib/deployment-ledger.js';
import { computeManualAcceptanceScope } from '../lib/manual-acceptance.js';
import { readDeployDoneMarker } from '../lib/lifecycle-gate.js';
import { observeWorkspace, readActiveProposalGuard } from './deploy-done.js';

export interface AcceptCliOptions {
  env?: string;
  deploy?: string;
  cases?: string[];
  result?: string;
  note?: string;
  evidence?: string[];
}

/** 测试注入点（生产路径不传）：锁外预检之后、取账本锁之前；删除 SMOKE_PASS 的实现。 */
export interface AcceptHooks {
  beforeLedgerLock?: () => void;
  removeMarker?: (path: string) => void;
}

class AcceptExit extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

function fail(code: string, message: string, details?: Record<string, unknown>): never {
  throw new AcceptExit(code, message, details);
}

export interface AcceptData {
  environment: string;
  deploy_id: string;
  ref: string | null;
  recorded: Array<{ case_id: string; result: 'pass' | 'fail' }>;
  remaining: string[];
  expired_pass: boolean;
  recorder: string | null;
  warnings: Array<{ code: 'accept_evidence_missing'; path: string }>;
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return r.status === 0 ? (r.stdout ?? '').trim() : '';
}

/** recorder：取法同 approval 记录的 approver（git user.name / user.email，再取操作系统用户名）；只作展示。 */
function recorderOf(root: string): string | null {
  const name = git(root, ['config', 'user.name']);
  const email = git(root, ['config', 'user.email']);
  if (name && email) return `${name} <${email}>`;
  if (name) return name;
  if (email) return `<${email}>`;
  try { return userInfo().username || null; } catch { return null; }
}

export async function accept(format: OutputFormat, opts: AcceptCliOptions, hooks: AcceptHooks = {}): Promise<void> {
  const root = process.cwd();
  const locale = readLocale(root);
  try {
    output(format, locale, runAccept(root, locale, opts, hooks));
  } catch (error) {
    if (!(error instanceof AcceptExit)) throw error;
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope('accept', error.code, error.message, error.details ? { details: error.details } : undefined)));
    } else {
      console.error(`Error: [${error.code}] ${error.message}`);
    }
    process.exit(1);
  }
}

/**
 * 判定顺序（§15.5，评审 delta-r2 F4）：身份 → 确认状态 → 清单可确定 → 清单成员。
 * pending 为 null 时（锁外预检）计算 P；锁内复核传入锁外得到的 P（D 未变时清单不变）。
 */
function judge(
  root: string, locale: Locale, env: EnvironmentDef, state: EnvLedgerState | undefined, deployId: string, cases: string[], pending: string[] | null,
): { pending: string[]; ref: string | null } {
  const current = currentDeploymentOf(state);
  if (!current) fail('ACCEPT_NO_DEPLOYMENT', t(locale, 'accept.error.noDeployment', { environment: env.id }));
  if (current.deploy_id !== deployId) {
    fail('ACCEPT_DEPLOY_CHANGED', t(locale, 'accept.error.deployChanged', { environment: env.id, expected: deployId, current: current.deploy_id }),
      { environment: env.id, expected: deployId, current: current.deploy_id });
  }
  if (!current.confirmed) {
    fail('ACCEPT_DEPLOYMENT_UNCONFIRMED', t(locale, 'accept.error.unconfirmed', { environment: env.id, deploy: current.deploy_id, result: current.result }),
      { environment: env.id, deploy_id: current.deploy_id, result: current.result });
  }
  let list = pending;
  if (list === null) {
    const scope = computeManualAcceptanceScope(root, env, state);
    if (scope.scope_unresolved) {
      fail('ACCEPT_CASE_NOT_PENDING', t(locale, 'accept.error.scopeUnresolved', { environment: env.id }),
        { environment: env.id, deploy_id: deployId, not_pending: cases, reason: 'scope_unresolved' });
    }
    list = scope.pending;
  }
  const notPending = cases.filter(id => !list!.includes(id));
  if (notPending.length > 0) {
    fail('ACCEPT_CASE_NOT_PENDING', t(locale, 'accept.error.notPending', { environment: env.id, cases: notPending.join(', ') }),
      { environment: env.id, deploy_id: deployId, not_pending: notPending, reason: 'not_in_list' });
  }
  return { pending: list, ref: current.ref };
}

function runAccept(root: string, locale: Locale, opts: AcceptCliOptions, hooks: AcceptHooks): AcceptData {
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) fail('PROJECT_NOT_INITIALIZED', t(locale, 'approve.error.projectNotInitialized'));
  const reg = loadEnvironmentRegistry(root);
  if (reg.state === 'absent') fail('ENV_REGISTRY_NOT_FOUND', t(locale, 'env.error.registryNotFound', { path: ENV_REGISTRY_REL }));
  if (reg.state === 'unloadable' || reg.errors.length > 0) {
    const reason = reg.state === 'unloadable'
      ? reg.error.reason
      : reg.errors.map(e => `${e.environment ?? ''}.${e.field ?? ''}: ${e.reason}`).join('; ');
    fail('ENV_REGISTRY_INVALID', t(locale, 'deploy.error.registryInvalid', { path: ENV_REGISTRY_REL, reason }));
  }
  const available = reg.environments.map(e => e.id).join(', ');
  if (opts.env === undefined || opts.env.trim() === '') fail('ENV_REQUIRED', t(locale, 'deploy.error.envRequired', { available }));
  const resolved = resolveEnvironment(reg.environments, opts.env);
  if (!resolved.ok) fail('ENV_UNKNOWN', t(locale, 'deploy.error.envUnknown', { input: opts.env, available }));
  const env = reg.environments.find(e => e.id === resolved.id)!;

  const cases = Array.from(new Set((opts.cases ?? []).flatMap(c => c.split(',')).map(c => c.trim()).filter(Boolean)));
  if (!opts.deploy || opts.deploy.trim() === '') fail('ACCEPT_ARGS_INVALID', t(locale, 'accept.error.args', { what: '--deploy' }));
  if (cases.length === 0) fail('ACCEPT_ARGS_INVALID', t(locale, 'accept.error.args', { what: '--case' }));
  if (opts.result !== 'pass' && opts.result !== 'fail') fail('ACCEPT_ARGS_INVALID', t(locale, 'accept.error.args', { what: '--result pass|fail' }));
  const result = opts.result;
  const note = opts.note !== undefined && opts.note.trim() !== '' ? opts.note : null;
  if (result === 'fail' && note === null) fail('ACCEPT_NOTE_REQUIRED', t(locale, 'accept.error.noteRequired'));
  if (env.manualAcceptance?.enabled !== true) fail('ACCEPT_NOT_ENABLED', t(locale, 'accept.error.notEnabled', { environment: env.id }));
  const deployId = opts.deploy.trim();

  // 锁外预检（只用于提前报错）
  const pre = judge(root, locale, env, readDeploymentLedger(root).byEnvironment.get(env.id), deployId, cases, null);

  const evidence = opts.evidence ?? [];
  const warnings: AcceptData['warnings'] = evidence
    .filter(p => !existsSync(isAbsolute(p) ? p : join(root, p)))
    .map(p => ({ code: 'accept_evidence_missing' as const, path: p }));
  const slug = readActiveProposalGuard(root)?.slug ?? null;
  const observed = observeWorkspace(root);
  const recorder = recorderOf(root);

  hooks.beforeLedgerLock?.();
  let lines: string[] = [];
  let expiredPass = false;
  let ref: string | null = pre.ref;
  try {
    withLedgerLock(root, () => {
      // 锁内复核（同一顺序）：确认 D 仍是当前部署且已确认、用例仍在清单中，之后追加
      const state = readDeploymentLedger(root).byEnvironment.get(env.id);
      ref = judge(root, locale, env, state, deployId, cases, pre.pending).ref;
      expiredPass = (state?.passRecords ?? []).some(entry => entry.record.deploy_id === deployId
        && entry.record.manual_passed === true && !isExpiredPass(state!, entry));
      const recordedAt = new Date().toISOString();
      lines = cases.map(caseId => {
        const record: ManualLedgerRecord = {
          kind: 'manual', environment: env.id, slug, recorded_at: recordedAt,
          observed_head: observed.head, observed_dirty: observed.dirty,
          deploy_id: deployId, ref, case_id: caseId, result, note, evidence, recorder,
        };
        return `${JSON.stringify(record)}\n`;
      });
      // 整批一次追加：要么全部写入、要么零写入
      appendLedgerLineLocked(root, lines.join(''));
    });
  } catch (error) {
    if (error instanceof AcceptExit) throw error;
    fail('ACCEPT_LEDGER_WRITE_FAILED', t(locale, 'accept.error.writeFailed', { reason: (error as Error).message }));
  }

  // 提案通道（§15.5）：活跃提案 DEPLOY_DONE 的 deploy_id 等于 D 且 SMOKE_PASS 在场时删除 SMOKE_PASS（先账本后标记）
  if (slug !== null) {
    const proposalDir = join(root, 'logos', 'changes', slug);
    const marker = readDeployDoneMarker(proposalDir);
    const passPath = join(proposalDir, 'SMOKE_PASS');
    if (marker.kind === 'valid' && marker.marker.deploy_id === deployId && existsSync(passPath)) {
      try {
        (hooks.removeMarker ?? (path => rmSync(path, { force: true })))(passPath);
      } catch (error) {
        const problems: string[] = [];
        for (const line of lines) {
          try { removeOwnLedgerLine(root, line, false); } catch (e) { problems.push((e as Error).message); }
        }
        fail('ACCEPT_LEDGER_WRITE_FAILED', t(locale, 'accept.error.markerFailed', {
          reason: (error as Error).message, rollback: problems.length === 0 ? 'complete' : problems.join('; '),
        }));
      }
    }
  }

  const after = manualResultsOf(readDeploymentLedger(root).byEnvironment.get(env.id), deployId);
  return {
    environment: env.id,
    deploy_id: deployId,
    ref,
    recorded: cases.map(case_id => ({ case_id, result })),
    remaining: pre.pending.filter(id => !after.has(id)),
    expired_pass: expiredPass,
    recorder,
    warnings,
  };
}

function output(format: OutputFormat, locale: Locale, data: AcceptData): void {
  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('accept', data)));
    return;
  }
  console.log('');
  console.log(t(locale, 'accept.text.recorded', { environment: data.environment, deploy: data.deploy_id, count: String(data.recorded.length) }));
  for (const r of data.recorded) console.log(`  ${r.case_id}: ${r.result}`);
  console.log(`  ${t(locale, 'accept.text.remaining', { count: String(data.remaining.length), cases: data.remaining.join(', ') || '-' })}`);
  if (data.expired_pass) console.log(`  ${t(locale, 'accept.text.expiredPass')}`);
  for (const w of data.warnings) console.log(`  ⚠ ${t(locale, 'accept.text.evidenceMissing', { path: w.path })}`);
  console.log('');
}
