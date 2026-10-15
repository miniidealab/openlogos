/**
 * `openlogos approve`（spec/environments.md §12.2；来源变更 environment-promotion-approval，场景 S43）。
 *
 * 为要求审批的环境写入一条绑定精确 commit 的审批记录（kind=approval）。查重与追加在同一账本锁临界区内完成：
 * 已有该环境该 commit 的未使用审批时幂等返回（created=false），并发执行只写出一条。
 * 本命令是 guard 受限命令（§12.7）：AI 调用须经宿主原生审批；approver 只作展示，不作身份认证。
 */
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { readLocale, t, type Locale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope, type OutputFormat } from '../lib/json-output.js';
import {
  ENV_REGISTRY_REL, loadEnvironmentRegistry, readDeploymentLedger, resolveEnvironment, type ApprovalLedgerRecord,
} from '../lib/environments.js';
import { appendLedgerLineLocked, withLedgerLock } from '../lib/deployment-ledger.js';
import { observeWorkspace, readActiveProposalGuard } from './deploy-done.js';

export interface ApproveCliOptions {
  env?: string;
  ref?: string;
  note?: string;
}

/** 测试注入点：账本锁临界区之前（用于构造两个 approve 的确定交错，UT-S43-08）。生产路径不传。 */
export interface ApproveHooks {
  beforeLedgerLock?: () => void;
}

class ApproveExit extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

function fail(locale: Locale, code: string, key: string, vars?: Record<string, string>): never {
  throw new ApproveExit(code, t(locale, key, vars));
}

function git(cwd: string, args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim() };
}

function resolveCommit(cwd: string, rev: string): string | null {
  // 拒绝空值与以 - 开头的值（不让版本写法被 git 当作选项解析）
  if (rev.trim() === '' || rev.startsWith('-')) return null;
  const r = git(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return r.ok && /^[0-9a-f]{40}$/.test(r.stdout) ? r.stdout : null;
}

/** approver（§5.2）：git user.name 与 user.email 组合，取不到时为操作系统用户名，再取不到为 null。只作展示。 */
function approverOf(root: string): string | null {
  const name = git(root, ['config', 'user.name']).stdout;
  const email = git(root, ['config', 'user.email']).stdout;
  if (name && email) return `${name} <${email}>`;
  if (name) return name;
  if (email) return `<${email}>`;
  try {
    return userInfo().username || null;
  } catch {
    return null;
  }
}

interface ApproveData {
  environment: string;
  approval_id: string;
  created: boolean;
  ref: string;
  ref_input: string;
  approver: string | null;
  note: string | null;
  recorded_at: string;
}

export async function approve(format: OutputFormat, opts: ApproveCliOptions, hooks: ApproveHooks = {}): Promise<void> {
  const root = process.cwd();
  const locale = readLocale(root);
  try {
    output(format, locale, runApprove(root, locale, opts, hooks));
  } catch (error) {
    if (!(error instanceof ApproveExit)) throw error;
    if (format === 'json') {
      console.error(JSON.stringify(makeErrorEnvelope('approve', error.code, error.message)));
    } else {
      console.error(`Error: [${error.code}] ${error.message}`);
    }
    process.exit(1);
  }
}

function runApprove(root: string, locale: Locale, opts: ApproveCliOptions, hooks: ApproveHooks): ApproveData {
  // 前置（§12.2），任一失败零写入
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) fail(locale, 'PROJECT_NOT_INITIALIZED', 'approve.error.projectNotInitialized');
  const reg = loadEnvironmentRegistry(root);
  if (reg.state === 'absent') fail(locale, 'ENV_REGISTRY_NOT_FOUND', 'env.error.registryNotFound', { path: ENV_REGISTRY_REL });
  if (reg.state === 'unloadable' || reg.errors.length > 0) {
    const reason = reg.state === 'unloadable'
      ? reg.error.reason
      : reg.errors.map(e => `${e.environment ?? ''}.${e.field ?? ''}: ${e.reason}`).join('; ');
    fail(locale, 'ENV_REGISTRY_INVALID', 'deploy.error.registryInvalid', { path: ENV_REGISTRY_REL, reason });
  }
  const available = reg.environments.map(e => e.id).join(', ');
  if (opts.env === undefined || opts.env.trim() === '') fail(locale, 'ENV_REQUIRED', 'deploy.error.envRequired', { available });
  const resolved = resolveEnvironment(reg.environments, opts.env);
  if (!resolved.ok) fail(locale, 'ENV_UNKNOWN', 'deploy.error.envUnknown', { input: opts.env, available });
  const env = reg.environments.find(e => e.id === resolved.id)!;
  if (env.gate?.require_approval !== true) fail(locale, 'APPROVAL_NOT_REQUIRED', 'approve.error.notRequired', { environment: env.id });
  if (opts.ref === undefined) fail(locale, 'APPROVAL_REF_REQUIRED', 'approve.error.refRequired');
  const ref = resolveCommit(root, opts.ref);
  if (ref === null) fail(locale, 'ENV_REF_UNRESOLVED', 'deploy.error.refUnresolved', { ref: opts.ref });

  const slug = readActiveProposalGuard(root)?.slug ?? null;
  const observed = observeWorkspace(root);
  const approver = approverOf(root);
  hooks.beforeLedgerLock?.();
  try {
    // 账本锁临界区内重新扫描查重并追加（§12.2）：并发执行的多个 approve 只写出一条
    return withLedgerLock(root, () => {
      const existing = readDeploymentLedger(root).byEnvironment.get(env.id)?.openApprovals.find(a => a.ref === ref);
      if (existing) {
        return {
          environment: env.id, approval_id: existing.approval_id, created: false, ref, ref_input: existing.ref_input,
          approver: existing.approver, note: existing.note, recorded_at: existing.recorded_at,
        };
      }
      const record: ApprovalLedgerRecord = {
        kind: 'approval', environment: env.id, slug, recorded_at: new Date().toISOString(),
        observed_head: observed.head, observed_dirty: observed.dirty,
        approval_id: randomUUID(), ref, ref_input: opts.ref!, approver, note: opts.note ?? null,
      };
      appendLedgerLineLocked(root, `${JSON.stringify(record)}\n`);
      return {
        environment: env.id, approval_id: record.approval_id, created: true, ref, ref_input: record.ref_input,
        approver, note: record.note, recorded_at: record.recorded_at,
      };
    });
  } catch (error) {
    if (error instanceof ApproveExit) throw error;
    // 写入失败（含账本锁等待超时）：账本保持调用前字节（appendLedgerLineLocked 以临时文件 + 原子替换写入）
    fail(locale, 'APPROVAL_WRITE_FAILED', 'approve.error.writeFailed', { reason: (error as Error).message });
  }
}

function output(format: OutputFormat, locale: Locale, data: ApproveData): void {
  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('approve', data)));
    return;
  }
  console.log('');
  console.log(t(locale, data.created ? 'approve.text.created' : 'approve.text.existing', { environment: data.environment }));
  console.log(`  ${t(locale, 'approve.text.ref', { input: data.ref_input, ref: data.ref })}`);
  console.log(`  approval_id: ${data.approval_id}`);
  console.log(`  ${t(locale, 'approve.text.approver', { approver: data.approver ?? '-' })}`);
  if (data.note !== null) console.log(`  ${t(locale, 'approve.text.note', { note: data.note })}`);
  console.log('');
}
