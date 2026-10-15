/**
 * `openlogos deploy`（spec/environments.md §11；来源变更 environment-deploy，场景 S42）。
 *
 * 本文件实现：参数分流、部署操作前置（零执行零写入）、script / ci / agent 方式的版本通道 / 提案通道 / 回滚、
 * 环境本地锁与未决记录、--complete / --reconcile / --abandon、部署日志与密钥遮盖、账本扩展记录、
 * 提案通道的部署报告与经 deploy-done 写入函数落标。
 */
import {
  appendFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { readLocale, t, type Locale } from '../i18n.js';
import { makeEnvelope, makeErrorEnvelope, type OutputFormat } from '../lib/json-output.js';
import { detectProposalStepViaFlow, type CmdGateEval } from '../lib/flow-derive.js';
import { FlowError } from '../lib/flow.js';
import {
  DEPLOY_LOCKS_REL, DEPLOY_PENDING_REL, ENV_REGISTRY_REL, isGatedEnvironment, loadEnvironmentRegistry, pidAlive, previousRefOf,
  readDeploymentLedger, resolveEnvironment,
  type DeployConfig, type DeployLedgerRecord, type DeployMode, type EnvironmentDef,
} from '../lib/environments.js';
import { appendLedgerLine } from '../lib/deployment-ledger.js';
import { runDeployScript, makeSecretMasker } from '../lib/deploy-runner.js';
import { removeTree } from '../lib/fs-remove.js';
import {
  checkDispatchRef, dispatchWorkflow, downloadDeployResult, evaluateEvidence, ghUnavailableReason, parseStatusOutput,
  parseTriggerOutput, viewRun, workflowMissingReason, type RefEvidence, type RunState,
} from '../lib/deploy-ci.js';
import {
  DEPLOYMENT_REPORT_PATH, observeWorkspace, preflightProposalDeploy, readActiveProposalGuard, resolveModuleDefaults,
  writeDeployCompletion, type ActiveProposalGuard, type DeployCompletionInput, type DeployCompletionResult,
} from './deploy-done.js';

export const DEPLOY_LOGS_REL = 'logos/.openlogos-runtime/deploy-logs';
export const DEPLOY_WORK_REL = 'logos/.openlogos-runtime/deploy-work';

export interface DeployCliOptions {
  env?: string;
  ref?: string;
  rollback?: boolean;
  channel?: string;
  dryRun?: boolean;
  complete?: string;
  result?: string;
  abandon?: string;
  reconcile?: boolean;
  /** `--force-promote "<理由>"`：留痕越过晋级检查（environment-promotion-approval，§12.3）。 */
  forcePromote?: string;
  /** 出现但缺值的参数名（如 `--env` 在末尾），按 DEPLOY_ARGS_CONFLICT 拒绝。 */
  missingValue?: string[];
}

/** 测试注入点：模拟写入失败（UT-S42-15）。生产路径不传。 */
export interface DeployHooks {
  completion?: (input: DeployCompletionInput) => DeployCompletionResult;
  appendLedger?: (root: string, line: string) => void;
  /** 部署操作在占用检查之后、获取环境锁之前（用于构造确定的并发交接窗口，UT-S42-12）。 */
  beforeAcquire?: () => void;
  /** --reconcile 查询远程之后、提交结论之前（用于构造迟到查询，UT-S42-13）。 */
  afterRemoteQuery?: () => void;
  /** 获取环境锁时观察到遗留锁之后、回收之前（用于构造两个回收者的确定交错，UT-S42-12）。 */
  afterStaleLockObserved?: () => void;
}

type Channel = 'proposal' | 'version';

interface Holder {
  deploy_id: string | null;
  mode: DeployMode | null;
  started_at: string | null;
  pid: number | null;
  run_id: string | null;
  run_url: string | null;
  unresolved: boolean;
}

/** JSON 输出中的 ci 对象（spec/cli-json-output.md「deploy 成功输出」）。 */
interface CiInfo {
  provider: 'github-actions' | 'script';
  run_id: string | null;
  run_url: string | null;
  conclusion: string | null;
  reported_ref: string | null;
}

type Warning = Record<string, string | null>;

interface FailureDetails {
  deploy_id: string;
  environment: string;
  channel: Channel;
  mode: DeployMode;
  ref_requested: string;
  exit_code: number | null;
  timed_out: boolean;
  failure_reason: DeployLedgerRecord['failure_reason'];
  ci: CiInfo | null;
  log_path: string;
  output_tail: string;
  ledger_written: boolean;
  deployed: boolean;
  unwritten_record: string | null;
}

class DeployExit extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

function fail(locale: Locale, code: string, key: string, vars?: Record<string, string>, details?: Record<string, unknown>): never {
  throw new DeployExit(code, t(locale, key, vars), details);
}

function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

function resolveCommit(cwd: string, rev: string): string | null {
  // 拒绝空值与以 - 开头的值（不让版本写法被 git 当作选项解析）
  if (rev.trim() === '' || rev.startsWith('-')) return null;
  const r = git(cwd, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  return r.ok && /^[0-9a-f]{40}$/.test(r.stdout) ? r.stdout : null;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** 未决记录形成的占用（§11.8）：存在即占用，不随本地进程退出解除。 */
function pendingHolder(root: string, envId: string): Holder | null {
  const pendingPath = join(root, DEPLOY_PENDING_REL, `${envId}.json`);
  if (!existsSync(pendingPath)) return null;
  const p = readJson(pendingPath) ?? {};
  return {
    deploy_id: str(p.deploy_id), mode: str(p.mode) as DeployMode | null, started_at: str(p.started_at),
    pid: typeof p.pid === 'number' ? p.pid : null, run_id: str(p.run_id), run_url: str(p.run_url), unresolved: true,
  };
}

/** 刚创建、内容尚未可读的锁文件在此时长内视为被持有（避免把正在写入的锁当遗留锁回收）。 */
const LOCK_FRESH_MS = 5000;

/** 本地锁形成的占用：持有进程存活时占用；内容不可读但刚创建的锁同样视为占用。 */
function lockHolder(root: string, envId: string): Holder | null {
  return observeLock(join(root, DEPLOY_LOCKS_REL, `${envId}.lock`))?.holder ?? null;
}

/** 环境占用（§11.8）：未决记录恒占用；本地锁只在持有进程存活时占用。 */
function readHolder(root: string, envId: string): Holder | null {
  return pendingHolder(root, envId) ?? lockHolder(root, envId);
}

function inProgress(locale: Locale, envId: string, holder: Holder): never {
  fail(locale, 'DEPLOY_IN_PROGRESS', 'deploy.error.inProgress', {
    environment: envId, deployId: holder.deploy_id ?? '?', mode: holder.mode ?? '?', startedAt: holder.started_at ?? '?',
  }, { holder });
}

interface EnvLock {
  path: string;
  token: string;
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** 一次对锁文件的观察：同一时刻读取的 inode、mtime 与原始内容构成该锁实例的身份。 */
interface LockObservation {
  identity: string;
  holder: Holder | null;
}

/** 观察锁文件；不存在返回 null。持有进程存活、或内容尚不可读但刚创建的锁视为被持有。 */
function observeLock(lockPath: string): LockObservation | null {
  let raw: string;
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(lockPath);
    raw = readFileSync(lockPath, 'utf-8');
  } catch {
    return null;
  }
  const identity = `${st.ino}:${st.mtimeMs}:${createHash('sha256').update(raw).digest('hex')}`;
  let lock: Record<string, unknown> | null = null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) lock = v as Record<string, unknown>;
  } catch { /* 内容不可读 */ }
  if (lock && pidAlive(lock.pid)) {
    return {
      identity,
      holder: {
        deploy_id: str(lock.deploy_id), mode: str(lock.mode) as DeployMode | null, started_at: str(lock.started_at),
        pid: lock.pid as number, run_id: null, run_url: null, unresolved: false,
      },
    };
  }
  if (!lock && Date.now() - st.mtimeMs < LOCK_FRESH_MS) {
    return { identity, holder: { deploy_id: null, mode: null, started_at: null, pid: null, run_id: null, run_url: null, unresolved: false } };
  }
  return { identity, holder: null };
}

/**
 * 原子发布一个独占文件（review code-r3 F2）：先把完整内容写入同目录的临时文件，再以 link 发布到目标路径——
 * link 在目标已存在时以 EEXIST 失败、绝不覆盖；发布成功的一刻目标即带完整内容，其他进程不会读到空的或写了一半的
 * 闸门 / 锁。文件系统不支持硬链接时退回独占创建后写入，此时读方对不完整内容一律按「持有者未知」保守处理。
 */
export function publishExclusive(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, { flag: 'wx' });
  try {
    linkSync(tmp, path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || !['EPERM', 'ENOTSUP', 'ENOSYS', 'EOPNOTSUPP', 'EXDEV'].includes(code ?? '')) throw error;
    writeFileSync(path, content, { flag: 'wx' });
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** 某份遗留锁实例的第 generation 代回收闸门路径（按观察到的锁实例身份命名）。 */
function reclaimGatePath(lockPath: string, observed: LockObservation, generation: number): string {
  const tag = createHash('sha256').update(observed.identity).digest('hex').slice(0, 16);
  return `${lockPath}.reclaim-${tag}-${generation}`;
}

/** 测试用：当前锁文件实例的第 generation 代回收闸门路径；锁文件不存在时为 null。 */
export function staleLockGatePath(lockPath: string, generation = 0): string | null {
  const observed = observeLock(lockPath);
  return observed ? reclaimGatePath(lockPath, observed, generation) : null;
}

/**
 * 回收遗留锁（review code-r2 F2、code-r3 F2）：识别、移除与随后的所有权取得必须对所有回收者互斥，否则 A 依据旧观察删除时，
 * 路径上可能已经是 B 刚回收并创建的活锁。协议：
 * - 回收闸门按「被回收的那份遗留锁实例」命名（inode + mtime + 内容摘要），以 publishExclusive 原子发布带完整持有者
 *   身份的闸门取得；同一实例的回收者由此串行；
 * - 取得闸门后重新观察锁文件，身份仍与当初观察到的遗留锁一致才删除；否则（已被他人回收、路径上已是新锁）不做任何删除；
 * - 遗留锁的持有进程已退出，它不会再释放；新锁只能在路径不存在时以独占发布出现，而删除该遗留锁实例的只有闸门持有者，
 *   因此「身份一致」与「删除」之间不会冒出活锁；
 * - 只有读到完整持有者身份且确认该进程已退出的闸门，才改用下一代闸门（-1、-2…）继续，残留闸门不删除、不存在破锁竞争；
 *   读不到完整持有者身份（空、不完整或无法解析）的闸门一律视为被占用，绝不跨代（code-r3 F2）。
 * 返回 'busy' 表示另一进程正在（或可能正在）回收该实例，调用方稍后重试或明确拒绝。
 */
function reclaimStaleLock(lockPath: string, observed: LockObservation): 'done' | 'busy' {
  for (let generation = 0; generation < 64; generation++) {
    const gate = reclaimGatePath(lockPath, observed, generation);
    try {
      publishExclusive(gate, `${JSON.stringify({ pid: process.pid, token: randomUUID() })}\n`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = readJson(gate);
      const pid = owner?.pid;
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return 'busy'; // 持有者身份未知：保守等待
      if (pidAlive(pid)) return 'busy';
      continue; // 已确认上一代闸门的持有者退出：不删除它，改用下一代闸门
    }
    try {
      const now = observeLock(lockPath);
      if (now && now.identity === observed.identity && now.holder === null) rmSync(lockPath, { force: true });
    } finally {
      // 此刻被观察的遗留锁实例已不在路径上（被本次删除或早已被替换），之后任何该实例的闸门持有者都只会看到身份不一致
      rmSync(gate, { force: true });
    }
    return 'done';
  }
  throw new Error(`cannot reclaim ${lockPath}`);
}

/**
 * 环境互斥（§11.8，review code-r1 F2、code-r2 F2、code-r3 F2）：原子发布本地锁；持有进程已不存在的遗留锁经 reclaimStaleLock
 * 的互斥协议回收后重试，绝不删除他人的活锁。
 * 未决记录的创建、替换与删除都只在持有该锁时进行；部署操作持锁后**复核未决记录**——检查与登记之间若有其他
 * 启动者登记了未决记录，释放锁并以 DEPLOY_IN_PROGRESS 结束，绝不覆盖已存在的未决身份。
 * 未决记录操作（allowPending）正是处理该占用，不做复核；waitMs 内等待其他进程释放锁。
 */
function acquireLock(
  root: string, envId: string, deployId: string, mode: DeployMode, startedAt: string, locale: Locale,
  opts: { allowPending?: boolean; waitMs?: number; afterStaleLockObserved?: () => void } = {},
): EnvLock {
  const lockPath = join(root, DEPLOY_LOCKS_REL, `${envId}.lock`);
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = randomUUID();
  const body = `${JSON.stringify({ pid: process.pid, deploy_id: deployId, mode, started_at: startedAt, token })}\n`;
  const deadline = Date.now() + (opts.waitMs ?? 0);
  // 另一进程正在回收遗留锁时的短暂等待上限（回收临界区只含几次文件操作）
  const reclaimDeadline = Date.now() + 2000;
  for (let attempts = 0; ; attempts++) {
    if (attempts > 1000) throw new Error(`cannot acquire ${lockPath}`);
    try {
      publishExclusive(lockPath, body); // 原子发布：锁一出现即带完整持有者身份
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const observed = observeLock(lockPath);
      if (!observed) continue; // 刚被释放或回收
      if (observed.holder) {
        if (Date.now() < deadline) { sleepSync(100); continue; }
        inProgress(locale, envId, observed.holder);
      }
      opts.afterStaleLockObserved?.();
      if (reclaimStaleLock(lockPath, observed) === 'busy') {
        if (Date.now() > Math.max(deadline, reclaimDeadline)) {
          inProgress(locale, envId, { deploy_id: null, mode: null, started_at: null, pid: null, run_id: null, run_url: null, unresolved: false });
        }
        sleepSync(20);
      }
      continue;
    }
    const lock = { path: lockPath, token };
    if (!opts.allowPending) {
      const pending = pendingHolder(root, envId);
      if (pending) {
        releaseLock(lock);
        inProgress(locale, envId, pending);
      }
    }
    return lock;
  }
}

function releaseLock(lock: EnvLock): void {
  try {
    if (readJson(lock.path)?.token === lock.token) rmSync(lock.path, { force: true });
  } catch { /* 释放失败不影响结论；持有进程退出后锁可被回收 */ }
}

function expandArgs(args: string[], vars: { env: string; ref: string; deployId: string | null }): string[] {
  return args.map(a => expandValue(a, vars));
}

function expandValue(a: string, vars: { env: string; ref: string; deployId: string | null }): string {
  return (a.replace(/\{(env|ref|ref_short|deploy_id)\}/g, (m, name: string) => {
    if (name === 'env') return vars.env;
    if (name === 'ref') return vars.ref;
    if (name === 'ref_short') return vars.ref.slice(0, 12);
    return vars.deployId ?? m; // dry-run 没有 deploy_id，保留占位符原样展示
  }));
}

function expandInputs(inputs: Record<string, string>, vars: { env: string; ref: string; deployId: string | null }): Record<string, string> {
  return Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, expandValue(v, vars)]));
}

function checkArgs(opts: DeployCliOptions, locale: Locale): void {
  const conflict = (key: string, vars?: Record<string, string>) =>
    fail(locale, 'DEPLOY_ARGS_CONFLICT', 'deploy.error.argsConflict', { detail: t(locale, key, vars) });
  if (opts.missingValue && opts.missingValue.length > 0) conflict('deploy.args.missingValue', { flag: opts.missingValue[0] });
  const pendingOps = [opts.complete !== undefined, opts.abandon !== undefined, opts.reconcile === true].filter(Boolean).length;
  if (pendingOps > 1) conflict('deploy.args.multiplePending');
  if (pendingOps === 1 && (opts.ref !== undefined || opts.rollback || opts.channel !== undefined || opts.dryRun)) {
    conflict('deploy.args.pendingWithDeployArgs');
  }
  if (opts.result !== undefined && opts.complete === undefined) conflict('deploy.args.resultWithoutComplete');
  if (opts.complete !== undefined && opts.result !== 'done' && opts.result !== 'failed') conflict('deploy.args.resultRequired');
  if (opts.ref !== undefined && opts.rollback) conflict('deploy.args.refAndRollback');
  if (opts.channel !== undefined && opts.channel !== 'proposal' && opts.channel !== 'version') {
    conflict('deploy.args.channelInvalid', { channel: opts.channel });
  }
  if (opts.rollback && opts.channel === 'proposal') conflict('deploy.args.rollbackProposal');
  if (opts.forcePromote !== undefined) {
    if (pendingOps > 0) conflict('deploy.args.forcePromoteWithPending');
    if (opts.rollback) conflict('deploy.args.forcePromoteWithRollback');
    if (opts.forcePromote.trim() === '') conflict('deploy.args.forcePromoteEmpty');
  }
}

function loadTarget(root: string, envInput: string | undefined, locale: Locale): { env: EnvironmentDef; all: EnvironmentDef[] } {
  const reg = loadEnvironmentRegistry(root);
  if (reg.state === 'absent') fail(locale, 'ENV_REGISTRY_NOT_FOUND', 'deploy.error.registryNotFound', { path: ENV_REGISTRY_REL });
  if (reg.state === 'unloadable' || reg.errors.length > 0) {
    const reason = reg.state === 'unloadable'
      ? reg.error.reason
      : reg.errors.map(e => `${e.environment ?? ''}.${e.field ?? ''}: ${e.reason}`).join('; ');
    fail(locale, 'ENV_REGISTRY_INVALID', 'deploy.error.registryInvalid', { path: ENV_REGISTRY_REL, reason });
  }
  const available = reg.environments.map(e => e.id).join(', ');
  if (envInput === undefined || envInput.trim() === '') fail(locale, 'ENV_REQUIRED', 'deploy.error.envRequired', { available });
  const resolved = resolveEnvironment(reg.environments, envInput);
  if (!resolved.ok) fail(locale, 'ENV_UNKNOWN', 'deploy.error.envUnknown', { input: envInput, available });
  return { env: reg.environments.find(e => e.id === resolved.id)!, all: reg.environments };
}

/**
 * 受门环境的审批与晋级字段（spec/environments.md §5.2、§12；environment-promotion-approval，决策 C07）：
 * 只在目标环境为受门环境时写入 deploy 记录、未决记录与 JSON 输出，取值可为 null；未配置门的环境不出现。
 */
interface GateFields {
  approval_id: string | null;
  promoted_from: string | null;
  promotion_override_reason: string | null;
}

/** 该环境、该 commit 最早的一份未使用审批（§12.4）；ledger 缺省时重读账本。 */
function openApprovalFor(root: string, envId: string, requested: string, ledger = readDeploymentLedger(root)): string | null {
  return ledger.byEnvironment.get(envId)?.openApprovals.find(a => a.ref === requested)?.approval_id ?? null;
}

/**
 * 晋级检查（§12.3）：上游环境（promote_from 所指）存在 verified=true 且 ref 等于请求 commit 的 smoke 记录。
 * 不要求该 commit 是上游当前版本，只校验直接上游。不满足时 DEPLOY_PROMOTION_UNVERIFIED。
 */
function checkPromotion(
  locale: Locale, envId: string, from: string, requested: string, ledger: ReturnType<typeof readDeploymentLedger>,
): void {
  const upstream = ledger.byEnvironment.get(from);
  if (upstream?.verifiedRefs.has(requested)) return;
  fail(locale, 'DEPLOY_PROMOTION_UNVERIFIED', 'deploy.error.promotionUnverified', { environment: envId, from, requested }, {
    environment: envId, promote_from: from, requested,
    upstream_current_ref: upstream?.hasDone ? upstream.currentRef : null,
    upstream_candidate_ref: upstream?.candidateRef ?? null,
  });
}

function approvalRequired(locale: Locale, envId: string, requested: string): never {
  const command = `openlogos approve --env ${envId} --ref ${requested}`;
  fail(locale, 'DEPLOY_APPROVAL_REQUIRED', 'deploy.error.approvalRequired', { environment: envId, requested, command }, {
    environment: envId, requested, approve_command: command,
  });
}

/**
 * 取得环境锁后、执行 / 触发 / 登记未决记录之前的复核（§12.5）：重读账本依次重新执行晋级检查（锁外检查已执行时）
 * 与审批检查。原审批已被其他部署使用时改选该 commit 的另一份未使用审批，没有则以 DEPLOY_APPROVAL_REQUIRED
 * 零执行结束；晋级同理（调用方的 finally 释放环境锁）。
 */
function recheckGate(root: string, locale: Locale, env: EnvironmentDef, requested: string, gate: GateFields | undefined): void {
  if (!gate) return;
  const ledger = readDeploymentLedger(root);
  if (gate.promoted_from !== null) checkPromotion(locale, env.id, gate.promoted_from, requested, ledger);
  if (env.gate?.require_approval !== true) return;
  const approvalId = openApprovalFor(root, env.id, requested, ledger);
  if (approvalId === null) approvalRequired(locale, env.id, requested);
  gate.approval_id = approvalId;
}

/** 默认通道：活跃提案处于 ready-to-deploy 时为提案通道，否则为版本通道（§11.5）。 */
function defaultChannel(root: string): Channel {
  const active = readActiveProposalGuard(root);
  if (!active || !existsSync(active.proposalDir)) return 'version';
  const step = detectProposalStepViaFlow(active.proposalDir, resolveModuleDefaults(root, active.moduleId));
  return step === 'ready-to-deploy' ? 'proposal' : 'version';
}

/** 请求 commit 树中的脚本：存在且带可执行位（§11.2，D13：只执行被 git 跟踪的脚本）。 */
function checkScriptInTree(repoRoot: string, commit: string, script: string, locale: Locale): void {
  const r = git(repoRoot, ['ls-tree', commit, '--', script]);
  const line = r.ok ? r.stdout.split('\n').find(l => l.endsWith(`\t${script}`)) : undefined;
  if (!line) fail(locale, 'DEPLOY_SCRIPT_MISSING', 'deploy.error.scriptMissing', { script, commit });
  const [mode, type] = line.split(/\s+/);
  if (type !== 'blob') fail(locale, 'DEPLOY_SCRIPT_MISSING', 'deploy.error.scriptMissing', { script, commit });
  if (mode !== '100755') fail(locale, 'DEPLOY_SCRIPT_NOT_EXECUTABLE', 'deploy.error.scriptNotExecutable', { script, commit });
}

function appendReportSection(root: string, locale: Locale, lines: string[]): void {
  const file = join(root, DEPLOYMENT_REPORT_PATH);
  mkdirSync(dirname(file), { recursive: true });
  let prefix = '';
  if (!existsSync(file)) {
    prefix = `${t(locale, 'deploy.report.title')}\n`;
  } else {
    const current = readFileSync(file, 'utf-8');
    prefix = current === '' || current.endsWith('\n') ? '' : '\n';
  }
  appendFileSync(file, `${prefix}\n${lines.join('\n')}\n`);
}

function emitError(format: OutputFormat, e: DeployExit): never {
  if (format === 'json') {
    console.error(JSON.stringify(makeErrorEnvelope('deploy', e.code, e.message, e.details ? { details: e.details } : undefined)));
  } else {
    console.error(`Error: [${e.code}] ${e.message}`);
  }
  process.exit(1);
}


export async function deploy(format: OutputFormat, opts: DeployCliOptions, hooks: DeployHooks = {}): Promise<void> {
  const root = process.cwd();
  const locale = readLocale(root);
  try {
    await runDeploy(root, locale, format, opts, hooks);
  } catch (error) {
    if (error instanceof DeployExit) emitError(format, error);
    if (error instanceof FlowError) emitError(format, new DeployExit(error.code, error.message));
    throw error;
  }
}

/** 一次部署（或补记）的结论。 */
interface Outcome {
  result: 'done' | 'failed' | 'unknown';
  ref: string | null;
  refSource: 'explicit' | 'ci-reported' | 'unknown';
  failureReason: DeployLedgerRecord['failure_reason'];
  /** 失败 / 未知时给人看的原因。 */
  reasonText: string;
  durationMs: number | null;
  exitCode: number | null;
  timedOut: boolean;
  outputTail: string;
  ci: CiInfo | null;
}

/** 写记录所需的部署身份：来自本次执行，或（--reconcile / --abandon）取自未决记录。 */
interface DeployIdentity {
  envId: string;
  deployId: string;
  channel: Channel;
  mode: DeployMode;
  slug: string | null;
  refInput: string;
  requested: string;
  rollback: boolean;
  rollbackFrom: string | null;
  logRel: string | null;
  /** 部署报告中「执行内容」一行。 */
  executed: string;
  /** 本次部署前的 current_ref（报告中的回滚点）。 */
  previousRef: string | null;
  observed: { head: string | null; dirty: boolean | null };
  /** 受门环境的审批与晋级字段；未配置门的环境为 undefined（记录与输出不含这三个字段）。 */
  gate?: GateFields;
}

interface FinishContext {
  root: string;
  locale: Locale;
  format: OutputFormat;
  hooks: DeployHooks;
  warnings: Warning[];
  /** 提案通道且其 slug 仍是活跃提案时用于追加报告与落标；否则 null（只写账本）。 */
  active: ActiveProposalGuard | null;
  moduleDefaults: Parameters<typeof detectProposalStepViaFlow>[1];
  cmdEval?: CmdGateEval;
  reconciled: boolean;
  /** ci 未决记录：终态记录写完后删除；结果未知或记录失败时保留（环境保持占用）。 */
  pendingPath: string | null;
  successStatus: 'done' | 'reconciled';
}

/** 未决记录（spec/environments.md §11.8）：deploy-pending/<env>.json。 */
interface PendingRecord {
  deploy_id: string;
  environment: string;
  mode: DeployMode;
  provider: 'github-actions' | 'script' | null;
  channel: Channel;
  slug: string | null;
  ref_input: string;
  ref_requested: string;
  rollback: boolean;
  rollback_from: string | null;
  started_at: string;
  pid: number;
  run_id: string | null;
  run_url: string | null;
  log_path: string | null;
  workflow: string | null;
  dispatch_ref: string | null;
  status_script: string | null;
  /** agent 方式：部署方案中对应章节的标题。 */
  plan_section: string | null;
  executed: string;
  previous_ref: string | null;
  /** 受门环境（environment-promotion-approval）：--complete / --reconcile / --abandon 写出的记录携带这些字段。 */
  approval_id?: string | null;
  promoted_from?: string | null;
  promotion_override_reason?: string | null;
}

const pendingFile = (root: string, envId: string) => join(root, DEPLOY_PENDING_REL, `${envId}.json`);

function writePending(root: string, p: PendingRecord): void {
  const file = pendingFile(root, p.environment);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(p)}\n`);
}

/** 删除未决记录：只删除仍属于本次部署（deploy_id 相同）的记录，绝不删除已被替换的他人占用（F2）。 */
function removePending(path: string | null, deployId: string): void {
  if (path === null) return;
  try {
    if (readJson(path)?.deploy_id === deployId) rmSync(path, { force: true });
  } catch { /* 删除失败时环境保持占用，可用 --abandon 解除 */ }
}

const COMMIT_RE = /^[0-9a-f]{40}$/;

/** 读取并校验未决记录；无法识别时返回 null（按没有未决记录处理）。 */
function readPending(root: string, envId: string): PendingRecord | null {
  const o = readJson(pendingFile(root, envId));
  if (!o || typeof o.deploy_id !== 'string' || o.deploy_id === '') return null;
  const mode = (['script', 'ci', 'agent'] as const).find(m => m === o.mode) ?? null;
  if (mode === null || typeof o.ref_requested !== 'string' || !COMMIT_RE.test(o.ref_requested)) return null;
  const channel: Channel = o.channel === 'proposal' && typeof o.slug === 'string' ? 'proposal' : 'version';
  return {
    deploy_id: o.deploy_id, environment: envId, mode,
    provider: o.provider === 'github-actions' || o.provider === 'script' ? o.provider : null,
    channel, slug: channel === 'proposal' ? o.slug as string : null,
    ref_input: str(o.ref_input) ?? o.ref_requested, ref_requested: o.ref_requested,
    rollback: o.rollback === true, rollback_from: typeof o.rollback_from === 'string' && COMMIT_RE.test(o.rollback_from) ? o.rollback_from : null,
    started_at: str(o.started_at) ?? '', pid: typeof o.pid === 'number' ? o.pid : 0,
    run_id: str(o.run_id), run_url: str(o.run_url), log_path: str(o.log_path),
    workflow: str(o.workflow), dispatch_ref: str(o.dispatch_ref), status_script: str(o.status_script),
    plan_section: str(o.plan_section),
    executed: str(o.executed) ?? '-', previous_ref: str(o.previous_ref),
    ...(GATE_KEYS.some(k => k in o) ? Object.fromEntries(GATE_KEYS.map(k => [k, str(o[k])])) : {}),
  };
}

const GATE_KEYS = ['approval_id', 'promoted_from', 'promotion_override_reason'] as const;

/** 未决记录携带的受门字段（读取时三者任一出现即视为受门环境的未决记录）。 */
function pendingGate(p: PendingRecord): GateFields | undefined {
  if (!GATE_KEYS.some(k => k in p)) return undefined;
  return { approval_id: p.approval_id ?? null, promoted_from: p.promoted_from ?? null, promotion_override_reason: p.promotion_override_reason ?? null };
}

function gitTop(root: string, locale: Locale): string {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (!top.ok || top.stdout === '') fail(locale, 'DEPLOY_GIT_REQUIRED', 'deploy.error.gitRequired');
  return top.stdout;
}

/** ci 方式的可执行性检查（S42 Step 6）；返回 github-actions 的调度 ref。 */
function checkCi(repoRoot: string, config: DeployConfig, refInput: string, requested: string, locale: Locale): string | null {
  if (config.provider === 'github-actions') {
    const why = ghUnavailableReason(repoRoot) ?? workflowMissingReason(repoRoot, config.workflow!);
    if (why !== null) fail(locale, 'DEPLOY_CI_UNAVAILABLE', 'deploy.error.ciUnavailable', { reason: why });
    const d = checkDispatchRef(repoRoot, config.workflow_ref, refInput, requested);
    if (!d.ok) fail(locale, 'DEPLOY_CI_REF_NOT_DISPATCHABLE', 'deploy.error.ciRefNotDispatchable', { reason: d.reason });
    return d.ref;
  }
  checkScriptInTree(repoRoot, requested, config.trigger_script!, locale);
  checkScriptInTree(repoRoot, requested, config.status_script!, locale);
  return null;
}

function executedText(config: DeployConfig, dispatchRef: string | null): string {
  if (config.mode === 'script') {
    return `${config.script}${config.args.length > 0 ? ` ${config.args.join(' ')}` : ''}（workdir: ${config.workdir}）`;
  }
  if (config.mode === 'agent') return `agent: ${config.plan_section}`;
  if (config.provider === 'github-actions') return `github-actions ${config.workflow} @ ${dispatchRef}`;
  return `ci script: ${config.trigger_script} / ${config.status_script}`;
}

async function runDeploy(root: string, locale: Locale, format: OutputFormat, opts: DeployCliOptions, hooks: DeployHooks): Promise<void> {
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    fail(locale, 'PROJECT_NOT_INITIALIZED', 'deploy.error.projectNotInitialized');
  }
  checkArgs(opts, locale);
  const { env } = loadTarget(root, opts.env, locale);
  // --force-promote 只对配置了 promote_from 的环境有意义（§12.3）
  if (opts.forcePromote !== undefined && (env.gate?.promote_from ?? null) === null) {
    fail(locale, 'DEPLOY_ARGS_CONFLICT', 'deploy.error.argsConflict', { detail: t(locale, 'deploy.args.forcePromoteNotConfigured', { environment: env.id }) });
  }

  // 未决记录操作（§11.1）：先分流，不做占用检查、不判定通道、不接受新 --ref、不检查脚本与密钥
  if (opts.complete !== undefined || opts.abandon !== undefined || opts.reconcile) {
    await runPendingOperation(root, locale, format, opts, env, hooks);
    return;
  }

  // 部署操作前置（§11.1 顺序），任一失败零执行零写入
  const config: DeployConfig | undefined = env.deploy;
  if (!config) fail(locale, 'DEPLOY_NOT_CONFIGURED', 'deploy.error.notConfigured', { environment: env.id });
  const repoRoot = gitTop(root, locale);

  const holder = readHolder(root, env.id);
  if (holder) inProgress(locale, env.id, holder);

  const channel: Channel = opts.rollback ? 'version' : (opts.channel as Channel | undefined) ?? defaultChannel(root);
  let active: ActiveProposalGuard | null = null;
  let moduleDefaults: Parameters<typeof detectProposalStepViaFlow>[1] = {};
  let finishVerify: (() => Promise<{ passed: true; cmdEval?: CmdGateEval }>) | null = null;
  let verifyIsCmdGate = false;
  if (channel === 'proposal') {
    const pre = await preflightProposalDeploy(root, format, locale, { command: 'deploy', requireReport: false });
    active = pre.active;
    moduleDefaults = pre.moduleDefaults;
    finishVerify = pre.finishVerify;
    verifyIsCmdGate = pre.verifyIsCmdGate;
  }

  const ledger = readDeploymentLedger(root);
  const state = ledger.byEnvironment.get(env.id);
  const currentRef = state?.hasDone ? state.currentRef : null;
  let refInput: string;
  let requested: string;
  if (opts.rollback) {
    const target = previousRefOf(state);
    if (target === null) fail(locale, 'DEPLOY_ROLLBACK_TARGET_MISSING', 'deploy.error.rollbackTargetMissing', { environment: env.id });
    refInput = target;
    requested = target;
  } else {
    if (opts.ref === undefined && channel === 'version') fail(locale, 'DEPLOY_REF_REQUIRED', 'deploy.error.refRequired');
    refInput = opts.ref ?? 'HEAD';
    const commit = resolveCommit(root, refInput);
    if (commit === null) fail(locale, 'ENV_REF_UNRESOLVED', 'deploy.error.refUnresolved', { ref: refInput });
    requested = commit;
  }

  // 晋级检查与审批检查（§12.3～§12.5）：版本解析之后、密钥与脚本 / CI 检查之前依次执行。锁外检查只用于提前报错。
  // --rollback 不做晋级检查但仍做审批检查；--force-promote 留痕越过晋级检查
  let gate: GateFields | undefined;
  if (isGatedEnvironment(env)) {
    gate = { approval_id: null, promoted_from: null, promotion_override_reason: null };
    const from = env.gate!.promote_from;
    if (from !== null && !opts.rollback) {
      if (opts.forcePromote !== undefined) {
        gate.promotion_override_reason = opts.forcePromote;
      } else {
        checkPromotion(locale, env.id, from, requested, ledger);
        gate.promoted_from = from;
      }
    }
    if (env.gate!.require_approval) {
      gate.approval_id = openApprovalFor(root, env.id, requested, ledger) ?? approvalRequired(locale, env.id, requested);
    }
  }

  const missing = env.secrets.filter(name => process.env[name] === undefined);
  if (missing.length > 0) {
    fail(locale, 'DEPLOY_SECRETS_MISSING', 'deploy.error.secretsMissing', { environment: env.id, names: missing.join(', ') }, { missing });
  }

  // 按执行方式检查脚本与 CI 可用性（§11.3）
  let dispatchRef: string | null = null;
  if (config.mode === 'script') {
    checkScriptInTree(repoRoot, requested, config.script!, locale);
    if (config.workdir === 'in-place') {
      const head = git(repoRoot, ['rev-parse', 'HEAD']).stdout;
      // 工作区干净包含「没有未被忽略的未跟踪文件」（code-r1 F4）：in-place 在当前工作区执行，未跟踪内容也会被部署
      const dirty = git(repoRoot, ['status', '--porcelain', '--untracked-files=normal']).stdout !== '';
      if (head !== requested || dirty) {
        fail(locale, 'DEPLOY_WORKTREE_MISMATCH', 'deploy.error.worktreeMismatch', {
          head: head || '?', requested, dirty: dirty ? t(locale, 'deploy.word.yes') : t(locale, 'deploy.word.no'),
        });
      }
    }
  } else if (config.mode === 'ci') {
    dispatchRef = checkCi(repoRoot, config, refInput, requested, locale);
  }
  // dry-run 只读（§11.1，code-r1 F3）：cmd 判据的 verify 会执行命令、可能产生副作用，dry-run 不执行它，
  // 也不把它当作通过——以 VERIFY_NOT_PASSED 明确报告无法在只读约束下确认。marker verify 已在前置中只读判定。
  if (opts.dryRun && verifyIsCmdGate) fail(locale, 'VERIFY_NOT_PASSED', 'deploy.error.dryRunCmdVerify');
  const verifyResult = finishVerify && !opts.dryRun ? await finishVerify() : undefined; // cmd-gate verify 在全部纯读前置之后

  const rollbackFrom = opts.rollback ? currentRef : null;
  if (opts.dryRun) {
    const vars = { env: env.id, ref: requested, deployId: null };
    const data = baseData(env.id, null, channel, config.mode, refInput, requested, opts.rollback === true, rollbackFrom);
    data.status = 'dry-run';
    data.plan = config.mode === 'agent'
      ? agentPlan(root, config)
      : config.mode === 'script'
      ? {
        workdir: config.workdir, script: config.script, args: expandArgs(config.args, vars),
        workflow: null, dispatch_ref: null, inputs: null, timeout_sec: config.timeout_sec,
      }
      : {
        workdir: null, script: config.provider === 'script' ? config.trigger_script : null, args: [],
        workflow: config.workflow, dispatch_ref: dispatchRef,
        inputs: config.provider === 'github-actions' ? expandInputs(config.inputs, vars) : null, timeout_sec: config.timeout_sec,
      };
    if (gate) {
      // 受门环境：plan 给出将使用的审批与晋级依据（§12.5）；dry-run 不取锁、不复核、不使用审批
      data.plan = {
        ...data.plan,
        approval_id: gate.approval_id,
        promotion: gate.promoted_from !== null
          ? { from: gate.promoted_from, verified_ref: requested }
          : gate.promotion_override_reason !== null ? { override_reason: gate.promotion_override_reason } : null,
      };
    }
    output(format, locale, data);
    return;
  }

  // ── 执行 ──
  const deployId = randomUUID();
  const startedAt = new Date().toISOString();
  if (config.mode === 'agent') {
    // agent 两段式第一段（S42 Step 13）：登记未决记录并返回部署方案位置，不写账本；后续由 --complete / --abandon 处理
    hooks.beforeAcquire?.();
    const lockPath = acquireLock(root, env.id, deployId, 'agent', startedAt, locale);
    try {
      recheckGate(root, locale, env, requested, gate);
      writePending(root, {
        deploy_id: deployId, environment: env.id, mode: 'agent', provider: null, channel, slug: channel === 'proposal' ? active!.slug : null,
        ref_input: refInput, ref_requested: requested, rollback: opts.rollback === true, rollback_from: rollbackFrom,
        started_at: startedAt, pid: process.pid, run_id: null, run_url: null, log_path: null,
        workflow: null, dispatch_ref: null, status_script: null, plan_section: config.plan_section,
        executed: executedText(config, null), previous_ref: currentRef,
        ...gate,
      });
    } finally {
      releaseLock(lockPath);
    }
    const data = baseData(env.id, deployId, channel, 'agent', refInput, requested, opts.rollback === true, rollbackFrom);
    Object.assign(data, { status: 'awaiting-agent', plan: agentPlan(root, config), ...gate });
    output(format, locale, data);
    return;
  }
  const observed = observeWorkspace(root);
  hooks.beforeAcquire?.();
  const lockPath = acquireLock(root, env.id, deployId, config.mode, startedAt, locale, {
    afterStaleLockObserved: hooks.afterStaleLockObserved,
  });
  const logRel = `${DEPLOY_LOGS_REL}/${deployId}.log`;
  const warnings: Warning[] = [];
  const identity: DeployIdentity = {
    envId: env.id, deployId, channel, mode: config.mode, slug: channel === 'proposal' ? active!.slug : null,
    refInput, requested, rollback: opts.rollback === true, rollbackFrom, logRel,
    executed: executedText(config, dispatchRef), previousRef: currentRef, observed, gate,
  };
  // 本地锁覆盖执行与记录全程（§11.8），结论写完后释放；ci 结果未知时由未决记录继续占用
  try {
    recheckGate(root, locale, env, requested, gate);
    const exec: ExecuteInput = {
      root, repoRoot, env, config, requested, deployId, channel, logPath: join(root, logRel), echo: format !== 'json', warnings, locale,
    };
    let pendingPath: string | null = null;
    let outcome: Outcome;
    if (config.mode === 'script') {
      outcome = scriptOutcome(await executeScript(exec), config, requested, locale);
    } else {
      pendingPath = pendingFile(root, env.id);
      const pending: PendingRecord = {
        deploy_id: deployId, environment: env.id, mode: 'ci', provider: config.provider, channel, slug: identity.slug,
        ref_input: refInput, ref_requested: requested, rollback: identity.rollback, rollback_from: rollbackFrom,
        started_at: startedAt, pid: process.pid, run_id: null, run_url: null, log_path: logRel,
        workflow: config.workflow, dispatch_ref: dispatchRef, status_script: config.status_script, plan_section: null,
        executed: identity.executed, previous_ref: currentRef,
        ...gate,
      };
      outcome = await executeCi(exec, pending, dispatchRef);
    }
    finish({
      root, locale, format, hooks, warnings, active, moduleDefaults, cmdEval: verifyResult?.cmdEval,
      reconciled: false, pendingPath, successStatus: 'done',
    }, identity, outcome);
  } finally {
    releaseLock(lockPath);
  }
}

function scriptOutcome(
  run: { exitCode: number | null; timedOut: boolean; durationMs: number; outputTail: string; spawnError: string | null },
  config: DeployConfig, requested: string, locale: Locale,
): Outcome {
  const succeeded = run.spawnError === null && !run.timedOut && run.exitCode === 0;
  const reasonText = succeeded ? '' : run.spawnError !== null
    ? t(locale, 'deploy.failure.spawn', { reason: run.spawnError })
    : run.timedOut
      ? t(locale, 'deploy.failure.timeout', { sec: String(config.timeout_sec) })
      : t(locale, 'deploy.failure.exitCode', { code: String(run.exitCode) });
  return {
    result: succeeded ? 'done' : 'failed',
    ref: succeeded ? requested : null,
    refSource: succeeded ? 'explicit' : 'unknown',
    failureReason: succeeded ? null : run.timedOut ? 'timeout' : 'exit-code',
    reasonText, durationMs: run.durationMs, exitCode: run.timedOut ? null : run.exitCode, timedOut: run.timedOut,
    outputTail: run.outputTail, ci: null,
  };
}

function buildRecord(id: DeployIdentity, o: Outcome, reconciled: boolean): DeployLedgerRecord {
  return {
    kind: 'deploy',
    environment: id.envId,
    slug: id.slug,
    recorded_at: new Date().toISOString(),
    observed_head: id.observed.head,
    observed_dirty: id.observed.dirty,
    deploy_id: id.deployId,
    ref: o.ref,
    ref_source: o.refSource,
    result: o.result,
    channel: id.channel,
    mode: id.mode,
    ref_input: id.refInput,
    ref_requested: id.requested,
    rollback: id.rollback,
    rollback_from: id.rollbackFrom,
    duration_ms: o.durationMs,
    ci_run_id: o.ci?.run_id ?? null,
    ci_run_url: o.ci?.run_url ?? null,
    ci_reported_ref: o.ci?.reported_ref ?? null,
    failure_reason: o.failureReason,
    log_path: id.logRel,
    reconciled,
    ...id.gate,
  };
}

/**
 * 按结论写记录并输出（S42 Step 14～17、19）：
 * 提案通道（slug 仍为活跃提案）追加部署报告；成功时经 deploy-done 写入函数落标（DEPLOY_DONE 与账本同一 deploy_id）；
 * 其余只追加账本。终态写完后删除 ci 未决记录；结果未知或记录失败时保留，环境保持占用。
 */
function finish(ctx: FinishContext, id: DeployIdentity, o: Outcome): void {
  const { root, locale, warnings } = ctx;
  // 提交前复核未决身份（F2）：未决记录已不属于本次部署（被完成、放弃或替换）时不写任何事实
  if (ctx.pendingPath !== null && readJson(ctx.pendingPath)?.deploy_id !== id.deployId) {
    fail(locale, 'DEPLOY_PENDING_NOT_FOUND', 'deploy.error.pendingChanged', { environment: id.envId, deployId: id.deployId });
  }
  const record = buildRecord(id, o, ctx.reconciled);
  const line = `${JSON.stringify(record)}\n`;
  if (o.result === 'done' && o.ref === null) {
    const reported = o.ci?.reported_ref ?? null;
    warnings.push({
      code: 'DEPLOY_REF_UNCONFIRMED',
      message: t(locale, 'deploy.warning.refUnconfirmed', { requested: id.requested, reported: reported ?? 'null' }),
      requested: id.requested, reported,
    });
  }
  const data = baseData(id.envId, id.deployId, id.channel, id.mode, id.refInput, id.requested, id.rollback, id.rollbackFrom);
  Object.assign(data, {
    status: ctx.successStatus, ref: o.ref, ref_source: o.refSource, duration_ms: o.durationMs, log_path: id.logRel,
    output_tail: o.outputTail, ci: o.ci, warnings, ...id.gate,
  });

  const active = id.channel === 'proposal' ? ctx.active : null;
  let reportError: string | null = null;
  if (active && id.mode !== 'agent') { // agent 方式的部署报告由执行者撰写（§11.5），CLI 不追加
    // 按本次实际结果追加一节部署报告，不覆盖既有内容（§11.5）
    try {
      appendReportSection(root, locale, reportLines(locale, record, id, o));
    } catch (error) {
      reportError = (error as Error).message;
    }
  }
  if (o.result === 'done' && active) {
    if (reportError !== null) recordFailed(locale, record, o, line, reportError);
    const completion = (ctx.hooks.completion ?? writeDeployCompletion)({
      root, active, ledgerLine: line,
      // DEPLOY_DONE.ref_source 只有 explicit / unknown（§4.1）：有已确认版本即 explicit，账本记录保留 ci-reported
      marker: { deploy_id: id.deployId, environment: id.envId, ref: o.ref, ref_source: o.ref !== null ? 'explicit' : 'unknown', recorded_at: record.recorded_at },
    });
    if (!completion.ok) {
      const reason = completion.stage === 'snapshot' || completion.rollbackProblems.length === 0
        ? completion.reason
        : `${completion.reason}; ${t(locale, 'deploy.error.rollbackIncomplete', { problems: completion.rollbackProblems.join('; ') })}`;
      recordFailed(locale, record, o, line, reason);
    }
    removePending(ctx.pendingPath, id.deployId);
    const nextStep = detectProposalStepViaFlow(active.proposalDir, ctx.moduleDefaults, ctx.cmdEval);
    Object.assign(data, {
      ledger_written: completion.ledgerWritten,
      proposal: {
        slug: active.slug, marker_path: completion.markerPath, deploy_tasks_checked: completion.deployTasksChecked,
        deploy_tasks_total: completion.deployTasksTotal, cleared_smoke_markers: completion.clearedSmokeMarkers,
        deployment_report_path: DEPLOYMENT_REPORT_PATH, next_step: nextStep,
      },
    });
    output(ctx.format, locale, data);
    return;
  }

  // 版本通道、提案已不活跃的补记，或任意通道的失败 / 结果未知：只追加账本记录
  let ledgerError: string | null = null;
  try {
    (ctx.hooks.appendLedger ?? appendLedgerLine)(root, line);
  } catch (error) {
    ledgerError = (error as Error).message;
  }
  if (o.result !== 'done') {
    if (ledgerError === null && o.result === 'failed') removePending(ctx.pendingPath, id.deployId);
    const ledgerNote = ledgerError === null ? '' : ` ${t(locale, 'deploy.error.failedLedgerNotWritten', { reason: ledgerError })}`;
    const message = o.result === 'failed'
      ? t(locale, 'deploy.error.failed', { environment: id.envId, reason: o.reasonText, logPath: id.logRel ?? '-' })
      : t(locale, 'deploy.error.resultUnknown', { environment: id.envId, reason: o.reasonText, deployId: id.deployId });
    throw new DeployExit(o.result === 'failed' ? 'DEPLOY_FAILED' : 'DEPLOY_RESULT_UNKNOWN', `${message}${ledgerNote}`,
      { ...failureDetails(record, o, ledgerError === null), deployed: false, unwritten_record: null });
  }
  if (ledgerError !== null) recordFailed(locale, record, o, line, ledgerError);
  removePending(ctx.pendingPath, id.deployId);
  data.ledger_written = true;
  output(ctx.format, locale, data);
}

function failureDetails(record: DeployLedgerRecord, o: Outcome, ledgerWritten: boolean): Omit<FailureDetails, 'deployed' | 'unwritten_record'> {
  return {
    deploy_id: record.deploy_id, environment: record.environment, channel: record.channel!, mode: record.mode!,
    ref_requested: record.ref_requested!, exit_code: o.exitCode, timed_out: o.timedOut,
    failure_reason: record.failure_reason ?? null, ci: o.ci, log_path: record.log_path ?? '', output_tail: o.outputTail,
    ledger_written: ledgerWritten,
  };
}

/** 部署成功但记录失败（§11.5，C10）：details.deployed=true，给出未能写入的记录原文。 */
function recordFailed(locale: Locale, record: DeployLedgerRecord, o: Outcome, line: string, reason: string): never {
  throw new DeployExit('DEPLOY_RECORD_FAILED', t(locale, 'deploy.error.recordFailed', {
    deployId: record.deploy_id, ref: record.ref ?? record.ref_requested ?? '?', reason, environment: record.environment,
  }), {
    ...failureDetails(record, o, false), ref: record.ref, deployed: true, unwritten_record: line.trimEnd(),
  });
}

interface ExecuteInput {
  root: string;
  repoRoot: string;
  env: EnvironmentDef;
  config: DeployConfig;
  requested: string;
  deployId: string;
  channel: Channel;
  logPath: string;
  echo: boolean;
  warnings: Warning[];
  locale: Locale;
}

function deployEnv(env: EnvironmentDef, requested: string, deployId: string, channel: Channel): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENLOGOS_DEPLOY_ENV: env.id,
    OPENLOGOS_DEPLOY_REF: requested,
    OPENLOGOS_DEPLOY_ID: deployId,
    OPENLOGOS_DEPLOY_CHANNEL: channel,
  };
}

const secretValuesOf = (env: EnvironmentDef) => env.secrets.map(n => process.env[n]).filter((v): v is string => typeof v === 'string');

/**
 * 在请求 commit 的隔离工作树中执行 fn，结束后移除工作树（失败只警告，§11.3）。
 * 工作树创建失败时返回 { error }，不执行 fn。
 */
async function withWorktree<T>(
  input: Pick<ExecuteInput, 'root' | 'repoRoot' | 'warnings' | 'locale'>, name: string, commit: string, fn: (dir: string) => Promise<T>,
): Promise<{ value: T } | { error: string }> {
  const { root, repoRoot, warnings, locale } = input;
  const workPath = join(root, DEPLOY_WORK_REL, name);
  mkdirSync(dirname(workPath), { recursive: true });
  const add = git(repoRoot, ['worktree', 'add', '--detach', workPath, commit]);
  if (!add.ok) return { error: add.stderr };
  try {
    return { value: await fn(workPath) };
  } finally {
    const removed = git(repoRoot, ['worktree', 'remove', '--force', workPath]);
    if (!removed.ok || existsSync(workPath)) {
      try { removeTree(workPath); } catch { /* 下面如实告警 */ }
      git(repoRoot, ['worktree', 'prune']);
      if (existsSync(workPath) || !removed.ok) {
        warnings.push({
          code: 'DEPLOY_WORKTREE_CLEANUP_FAILED',
          message: t(locale, 'deploy.warning.worktreeCleanupFailed', { path: relative(root, workPath), reason: removed.stderr || '-' }),
        });
      }
    }
  }
}

/** 部署日志写入器：遮盖已声明密钥后追加到日志，文本模式同时回显。 */
function logWriter(logPath: string, secretValues: string[], echo: boolean): (line: string) => void {
  const mask = makeSecretMasker(secretValues);
  mkdirSync(dirname(logPath), { recursive: true });
  return line => {
    const masked = mask(line);
    appendFileSync(logPath, `${masked}\n`);
    if (echo) console.log(masked);
  };
}

async function executeScript(input: ExecuteInput) {
  const { repoRoot, env, config, requested, deployId, channel, logPath, echo, locale } = input;
  const script = config.script!;
  const secretValues = secretValuesOf(env);
  const childEnv = deployEnv(env, requested, deployId, channel);
  const args = expandArgs(config.args, { env: env.id, ref: requested, deployId });
  const timeoutMs = config.timeout_sec * 1000;

  if (config.workdir === 'in-place') {
    return runDeployScript({ command: join(repoRoot, script), args, cwd: repoRoot, env: childEnv, timeoutMs, logPath, secretValues, echo });
  }
  const r = await withWorktree(input, deployId, requested, dir =>
    runDeployScript({ command: join(dir, script), args, cwd: dir, env: childEnv, timeoutMs, logPath, secretValues, echo }));
  if ('value' in r) return r.value;
  const message = t(locale, 'deploy.failure.worktree', { reason: r.error });
  logWriter(logPath, secretValues, false)(message);
  return { exitCode: null, timedOut: false, durationMs: 0, outputTail: makeSecretMasker(secretValues)(message), spawnError: message, lastStdoutLine: null };
}

/** ci 运行的查询与版本证据（两种 provider 共用同一回报合同，§11.4）。 */
interface CiDriver {
  provider: 'github-actions' | 'script';
  query: (runId: string, remainingMs: number) => Promise<RunState | null>;
  evidence: (runId: string, state: RunState) => RefEvidence;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function githubDriver(repoRoot: string, requested: string): CiDriver {
  return {
    provider: 'github-actions',
    query: async runId => viewRun(repoRoot, runId),
    evidence: runId => evaluateEvidence(downloadDeployResult(repoRoot, runId).reported, requested),
  };
}

function scriptDriver(dir: string, statusScript: string, childEnv: NodeJS.ProcessEnv, logPath: string, secretValues: string[], echo: boolean, requested: string): CiDriver {
  return {
    provider: 'script',
    query: async (runId, remainingMs) => {
      const r = await runDeployScript({
        command: join(dir, statusScript), args: [runId], cwd: dir, env: childEnv,
        timeoutMs: Math.max(1000, Math.min(60_000, remainingMs)), logPath, secretValues, echo,
      });
      return r.exitCode === 0 ? parseStatusOutput(r.lastStdoutLine) : null;
    },
    evidence: (_runId, state) => evaluateEvidence(state.deployedRef, requested),
  };
}

/** 运行已完成：success 记 done（版本按回报判定），其余结论记 failed（ci-failure）。 */
function completedOutcome(
  driver: CiDriver, runId: string, runUrl: string | null, state: RunState, durationMs: number | null, tail: string, locale: Locale,
): Outcome {
  const ci: CiInfo = { provider: driver.provider, run_id: runId, run_url: state.url ?? runUrl, conclusion: state.conclusion, reported_ref: null };
  if (state.conclusion === 'success') {
    const ev = driver.evidence(runId, state);
    ci.reported_ref = ev.reportedRaw;
    return {
      result: 'done', ref: ev.ref, refSource: ev.refSource, failureReason: null, reasonText: '',
      durationMs, exitCode: null, timedOut: false, outputTail: tail, ci,
    };
  }
  return {
    result: 'failed', ref: null, refSource: 'unknown', failureReason: 'ci-failure',
    reasonText: t(locale, 'deploy.failure.ciConclusion', { conclusion: state.conclusion ?? 'null' }),
    durationMs, exitCode: null, timedOut: false, outputTail: tail, ci,
  };
}

/**
 * ci 方式执行（S42 Step 10、12）：触发前写未决记录 → 触发并取得运行身份（缺失记 unknown）→ 补写 run_id →
 * 按 run_id 轮询到完成或 timeout_sec 到期（超时记 unknown）→ 成功后读取运行回报判定版本。
 */
async function executeCi(input: ExecuteInput, pending: PendingRecord, dispatchRef: string | null): Promise<Outcome> {
  const { root, repoRoot, env, config, requested, deployId, channel, logPath, echo, locale } = input;
  const secretValues = secretValuesOf(env);
  const tail: string[] = [];
  const write = logWriter(logPath, secretValues, echo);
  const mask = makeSecretMasker(secretValues);
  const log = (line: string) => { write(line); tail.push(mask(line)); };
  const tailText = () => tail.slice(-80).join('\n');
  const started = Date.now();
  const deadline = started + config.timeout_sec * 1000;
  const pollMs = config.poll_interval_sec * 1000;
  const childEnv = deployEnv(env, requested, deployId, channel);
  writePending(root, pending); // 发出触发请求之前写未决记录（§11.8）

  const unknown = (reason: 'ci-run-id-missing' | 'ci-observe-timeout', reasonText: string, runId: string | null, runUrl: string | null): Outcome => ({
    result: 'unknown', ref: null, refSource: 'unknown', failureReason: reason, reasonText,
    durationMs: Date.now() - started, exitCode: null, timedOut: reason === 'ci-observe-timeout', outputTail: tailText(),
    ci: { provider: config.provider!, run_id: runId, run_url: runUrl, conclusion: null, reported_ref: null },
  });

  const observe = async (driver: CiDriver, runId: string, runUrl: string | null): Promise<Outcome> => {
    for (;;) {
      const state = await driver.query(runId, deadline - Date.now());
      log(`[openlogos] run ${runId}: ${state ? `${state.status ?? '?'}${state.conclusion ? ` / ${state.conclusion}` : ''}` : 'query failed'}`);
      if (state?.status === 'completed') {
        const o = completedOutcome(driver, runId, runUrl, state, Date.now() - started, '', locale);
        log(`[openlogos] reported deployed_ref: ${o.ci?.reported_ref ?? 'null'}`);
        return { ...o, outputTail: tailText() };
      }
      if (Date.now() + pollMs > deadline) {
        return unknown('ci-observe-timeout', t(locale, 'deploy.failure.ciObserveTimeout', { sec: String(config.timeout_sec), runId }), runId, runUrl);
      }
      await sleep(pollMs);
    }
  };

  const recordRun = (runId: string, runUrl: string | null) => {
    pending.run_id = runId;
    pending.run_url = runUrl;
    writePending(root, pending); // 取得 run_id 后补写；此后占用以未决记录为准
  };

  if (config.provider === 'github-actions') {
    const inputs = expandInputs(config.inputs, { env: env.id, ref: requested, deployId });
    log(`[openlogos] dispatch ${config.workflow} @ ${dispatchRef}`);
    const d = dispatchWorkflow(repoRoot, config.workflow!, dispatchRef!, inputs);
    if (d.runId === null) {
      log(`[openlogos] no run identity in dispatch response${d.error ? `: ${d.error}` : ''}`);
      return unknown('ci-run-id-missing', t(locale, 'deploy.failure.ciRunIdMissing'), null, d.runUrl);
    }
    log(`[openlogos] run_id ${d.runId} ${d.runUrl ?? ''}`.trimEnd());
    recordRun(d.runId, d.runUrl);
    return observe(githubDriver(repoRoot, requested), d.runId, d.runUrl);
  }

  // provider: script：在请求 commit 的隔离工作树中运行触发 / 状态脚本
  const r = await withWorktree(input, deployId, requested, async dir => {
    const trigger = await runDeployScript({
      command: join(dir, config.trigger_script!), args: [], cwd: dir, env: childEnv,
      timeoutMs: Math.max(1000, deadline - Date.now()), logPath, secretValues, echo,
    });
    const { runId, runUrl } = parseTriggerOutput(trigger.lastStdoutLine);
    if (runId === null) {
      log('[openlogos] trigger_script did not report run_id');
      return unknown('ci-run-id-missing', t(locale, 'deploy.failure.ciRunIdMissing'), null, runUrl);
    }
    log(`[openlogos] run_id ${runId} ${runUrl ?? ''}`.trimEnd());
    recordRun(runId, runUrl);
    return observe(scriptDriver(dir, config.status_script!, childEnv, logPath, secretValues, echo, requested), runId, runUrl);
  });
  if ('value' in r) return r.value;
  // 工作树创建失败：触发脚本未运行，不可能已触发
  log(t(locale, 'deploy.failure.worktree', { reason: r.error }));
  return {
    result: 'failed', ref: null, refSource: 'unknown', failureReason: 'ci-failure',
    reasonText: t(locale, 'deploy.failure.worktree', { reason: r.error }), durationMs: Date.now() - started,
    exitCode: null, timedOut: false, outputTail: tailText(),
    ci: { provider: 'script', run_id: null, run_url: null, conclusion: null, reported_ref: null },
  };
}

/** 未决记录操作等待其他进程释放环境锁的上限。 */
const PENDING_LOCK_WAIT_MS = 3000;

/**
 * 未决记录操作（§11.1、S42 Step 18 / 19）：取自未决记录，不受未决占用拦截、不需要 --ref、无活跃提案可用。
 * 读取、核对与提交都在环境锁内进行（review code-r1 F2）：持锁后重新读取未决记录并核对 deploy_id，
 * 等待期间若已被完成、放弃或替换则不做任何写入；--reconcile 的远程查询同样在锁内，迟到的查询不会提交到已替换的占用上。
 */
async function runPendingOperation(
  root: string, locale: Locale, format: OutputFormat, opts: DeployCliOptions, env: EnvironmentDef, hooks: DeployHooks,
): Promise<void> {
  const first = readPending(root, env.id);
  const wanted = opts.complete ?? opts.abandon;
  if (!first || (wanted !== undefined && first.deploy_id !== wanted)) {
    fail(locale, 'DEPLOY_PENDING_NOT_FOUND', 'deploy.error.pendingNotFound', { environment: env.id, deployId: wanted ?? '-' });
  }
  const lock = acquireLock(root, env.id, first.deploy_id, first.mode, new Date().toISOString(), locale, {
    allowPending: true, waitMs: PENDING_LOCK_WAIT_MS,
  });
  try {
    const pending = readPending(root, env.id);
    if (!pending || pending.deploy_id !== first.deploy_id) {
      fail(locale, 'DEPLOY_PENDING_NOT_FOUND', 'deploy.error.pendingChanged', { environment: env.id, deployId: first.deploy_id });
    }
    await runPendingOperationLocked(root, locale, format, opts, env, hooks, pending);
  } finally {
    releaseLock(lock);
  }
}

async function runPendingOperationLocked(
  root: string, locale: Locale, format: OutputFormat, opts: DeployCliOptions, env: EnvironmentDef, hooks: DeployHooks,
  pending: PendingRecord,
): Promise<void> {
  const identity: DeployIdentity = {
    envId: env.id, deployId: pending.deploy_id, channel: pending.channel, mode: pending.mode, slug: pending.slug,
    refInput: pending.ref_input, requested: pending.ref_requested, rollback: pending.rollback, rollbackFrom: pending.rollback_from,
    logRel: pending.log_path, executed: pending.executed, previousRef: pending.previous_ref, observed: observeWorkspace(root),
    gate: pendingGate(pending),
  };
  const ci = (conclusion: string | null): CiInfo | null => (pending.mode === 'ci'
    ? { provider: pending.provider ?? 'github-actions', run_id: pending.run_id, run_url: pending.run_url, conclusion, reported_ref: null }
    : null);
  const pendingPath = pendingFile(root, env.id);

  if (opts.complete !== undefined) {
    await completeAgent(root, locale, format, opts.result as 'done' | 'failed', env, pending, identity, hooks, pendingPath);
    return;
  }

  if (opts.abandon !== undefined) {
    // 放弃：任何方式都可，不访问远程；追加 result=unknown、failure_reason=abandoned 的记录并删除未决记录
    const record = buildRecord(identity, {
      result: 'unknown', ref: null, refSource: 'unknown', failureReason: 'abandoned', reasonText: '',
      durationMs: null, exitCode: null, timedOut: false, outputTail: '', ci: ci(null),
    }, false);
    const line = `${JSON.stringify(record)}\n`;
    try {
      (hooks.appendLedger ?? appendLedgerLine)(root, line);
    } catch (error) {
      throw new DeployExit('DEPLOY_RECORD_FAILED', t(locale, 'deploy.error.abandonRecordFailed', {
        environment: env.id, deployId: pending.deploy_id, reason: (error as Error).message,
      }), { deploy_id: pending.deploy_id, environment: env.id, ledger_written: false, deployed: false, unwritten_record: line.trimEnd() });
    }
    removePending(pendingPath, pending.deploy_id);
    const data = baseData(env.id, pending.deploy_id, pending.channel, pending.mode, pending.ref_input, pending.ref_requested, pending.rollback, pending.rollback_from);
    Object.assign(data, { status: 'abandoned', log_path: pending.log_path, ledger_written: true, ci: ci(null), ...identity.gate });
    output(format, locale, data);
    return;
  }

  // --reconcile：记录方式须为 ci
  if (pending.mode !== 'ci' || pending.provider === null) {
    fail(locale, 'DEPLOY_PENDING_NOT_FOUND', 'deploy.error.pendingNotCi', { environment: env.id, mode: pending.mode });
  }
  if (pending.run_id === null) {
    // 没有运行身份：无法查询，保持占用，只能由 --abandon 解除
    fail(locale, 'DEPLOY_RESULT_UNKNOWN', 'deploy.error.reconcileNoRunId', { environment: env.id, deployId: pending.deploy_id }, {
      deploy_id: pending.deploy_id, environment: env.id, channel: pending.channel, mode: pending.mode, ref_requested: pending.ref_requested,
      exit_code: null, timed_out: false, failure_reason: 'ci-run-id-missing', ci: ci(null), log_path: pending.log_path,
      output_tail: '', ledger_written: false, deployed: false, unwritten_record: null,
    });
  }
  const repoRoot = gitTop(root, locale);
  const runId = pending.run_id;
  const logPath = join(root, pending.log_path ?? `${DEPLOY_LOGS_REL}/${pending.deploy_id}.log`);
  const secretValues = secretValuesOf(env);
  const warnings: Warning[] = [];

  const settle = async (driver: CiDriver): Promise<Outcome | null> => {
    const state = await driver.query(runId, 60_000);
    if (state === null) {
      fail(locale, 'DEPLOY_CI_UNAVAILABLE', 'deploy.error.ciQueryFailed', { runId });
    }
    logWriter(logPath, secretValues, false)(`[openlogos] reconcile run ${runId}: ${state.status ?? '?'}${state.conclusion ? ` / ${state.conclusion}` : ''}`);
    return state.status === 'completed' ? completedOutcome(driver, runId, pending.run_url, state, null, '', locale) : null;
  };

  let outcome: Outcome | null;
  if (pending.provider === 'github-actions') {
    const why = ghUnavailableReason(repoRoot);
    if (why !== null) fail(locale, 'DEPLOY_CI_UNAVAILABLE', 'deploy.error.ciUnavailable', { reason: why });
    outcome = await settle(githubDriver(repoRoot, pending.ref_requested));
  } else {
    const statusScript = pending.status_script ?? env.deploy?.status_script ?? null;
    if (statusScript === null) fail(locale, 'DEPLOY_SCRIPT_MISSING', 'deploy.error.scriptMissing', { script: 'status_script', commit: pending.ref_requested });
    checkScriptInTree(repoRoot, pending.ref_requested, statusScript, locale);
    const childEnv = deployEnv(env, pending.ref_requested, pending.deploy_id, pending.channel);
    const r = await withWorktree({ root, repoRoot, warnings, locale }, `${pending.deploy_id}-reconcile-${Date.now()}`, pending.ref_requested,
      dir => settle(scriptDriver(dir, statusScript, childEnv, logPath, secretValues, false, pending.ref_requested)));
    if (!('value' in r)) fail(locale, 'DEPLOY_CI_UNAVAILABLE', 'deploy.error.ciQueryFailed', { runId: `${runId} (${r.error})` });
    outcome = r.value;
  }
  hooks.afterRemoteQuery?.();

  if (outcome === null) {
    // 远程仍在运行：保持占用，账本无新增
    const data = baseData(env.id, pending.deploy_id, pending.channel, pending.mode, pending.ref_input, pending.ref_requested, pending.rollback, pending.rollback_from);
    Object.assign(data, { status: 'still-running', log_path: pending.log_path, ci: ci(null), warnings });
    output(format, locale, data);
    return;
  }

  // 提案通道的记录在其 slug 仍是活跃提案时落标，否则只追加账本
  let active: ActiveProposalGuard | null = null;
  if (pending.channel === 'proposal') {
    const guard = readActiveProposalGuard(root);
    if (guard && guard.slug === pending.slug && existsSync(guard.proposalDir)) active = guard;
  }
  finish({
    root, locale, format, hooks, warnings, active,
    moduleDefaults: active ? resolveModuleDefaults(root, active.moduleId) : {},
    reconciled: true, pendingPath, successStatus: 'reconciled',
  }, identity, outcome);
}

export const DEPLOYMENT_PLAN_DIR = 'logos/resources/prd/3-technical-plan/3-deployment';

/** agent 方式的部署方案位置：部署方案目录中含该章节标题的文档；找不到时给出部署方案目录。 */
function agentPlan(root: string, config: DeployConfig): { plan_path: string; plan_section: string | null } {
  const section = config.plan_section;
  const dir = join(root, DEPLOYMENT_PLAN_DIR);
  const files: string[] = [];
  const walk = (d: string) => {
    let names: string[] = [];
    try { names = readdirSync(d).sort(); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      try {
        if (statSync(p).isDirectory()) walk(p);
        else if (n.endsWith('.md')) files.push(p);
      } catch { /* 跳过无法读取的条目 */ }
    }
  };
  walk(dir);
  if (section !== null) {
    for (const f of files) {
      try {
        const hit = readFileSync(f, 'utf-8').split('\n').some(l => /^#{1,6}\s/.test(l) && l.replace(/^#{1,6}\s+/, '').trim() === section.trim());
        if (hit) return { plan_path: relative(root, f).split('\\').join('/'), plan_section: section };
      } catch { /* 跳过无法读取的文件 */ }
    }
  }
  return { plan_path: `${DEPLOYMENT_PLAN_DIR}/`, plan_section: section };
}

/**
 * agent 两段式第二段（S42 Step 18）：`--complete <deploy_id> --result done|failed`。
 * done：写入 mode=agent、ref=ref_requested、ref_source=explicit 的记录；提案通道要求其 slug 仍是活跃提案且部署报告已存在，
 * 再经 deploy-done 写入函数落标。failed：只追加 result=failed、failure_reason=agent-reported 的记录。完成后删除未决记录。
 */
async function completeAgent(
  root: string, locale: Locale, format: OutputFormat, result: 'done' | 'failed', env: EnvironmentDef, pending: PendingRecord,
  identity: DeployIdentity, hooks: DeployHooks, pendingPath: string,
): Promise<void> {
  if (pending.mode !== 'agent') {
    fail(locale, 'DEPLOY_PENDING_NOT_FOUND', 'deploy.error.pendingNotAgent', { environment: env.id, mode: pending.mode });
  }
  let active: ActiveProposalGuard | null = null;
  if (result === 'done' && pending.channel === 'proposal') {
    const guard = readActiveProposalGuard(root);
    if (!guard) fail(locale, 'NO_ACTIVE_CHANGE', 'deployDone.error.noActiveChange');
    if (guard.slug !== pending.slug || !existsSync(guard.proposalDir)) {
      fail(locale, 'CHANGE_NOT_FOUND', 'deployDone.error.changeNotFound', { slug: pending.slug ?? '-' });
    }
    if (!existsSync(join(root, DEPLOYMENT_REPORT_PATH))) {
      fail(locale, 'DEPLOYMENT_REPORT_MISSING', 'deployDone.error.deploymentReportMissing', { path: DEPLOYMENT_REPORT_PATH });
    }
    active = guard;
  }
  const outcome: Outcome = result === 'done'
    ? {
      result: 'done', ref: pending.ref_requested, refSource: 'explicit', failureReason: null, reasonText: '',
      durationMs: null, exitCode: null, timedOut: false, outputTail: '', ci: null,
    }
    : {
      result: 'failed', ref: null, refSource: 'unknown', failureReason: 'agent-reported',
      reasonText: t(locale, 'deploy.failure.agentReported'), durationMs: null, exitCode: null, timedOut: false, outputTail: '', ci: null,
    };
  finish({
    root, locale, format, hooks, warnings: [], active,
    moduleDefaults: active ? resolveModuleDefaults(root, active.moduleId) : {},
    reconciled: false, pendingPath, successStatus: 'done',
  }, identity, outcome);
}

function reportLines(locale: Locale, r: DeployLedgerRecord, id: DeployIdentity, o: Outcome): string[] {
  const none = t(locale, 'deploy.report.none');
  const result = r.result === 'done'
    ? 'done'
    : `${r.result}（${r.failure_reason}${r.failure_reason === 'exit-code' && o.exitCode !== null ? ` ${o.exitCode}` : ''}）`;
  return [
    t(locale, 'deploy.report.section', { time: r.recorded_at, environment: r.environment }),
    '',
    `- ${t(locale, 'deploy.report.environment')}: ${r.environment}`,
    `- ${t(locale, 'deploy.report.channel')}: ${r.channel} / ${r.mode}`,
    `- deploy_id: ${r.deploy_id}`,
    `- ref_requested: ${r.ref_requested}（${r.ref_input}）`,
    `- ref: ${r.ref ?? t(locale, 'deploy.report.unconfirmed')}`,
    `- ${t(locale, 'deploy.report.script')}: ${id.executed}`,
    ...(o.ci ? [`- run: ${o.ci.run_id ?? none}${o.ci.run_url ? ` ${o.ci.run_url}` : ''}`] : []),
    `- ${t(locale, 'deploy.report.duration')}: ${r.duration_ms ?? 0} ms`,
    `- ${t(locale, 'deploy.report.result')}: ${result}`,
    `- log_path: ${r.log_path ?? none}`,
    `- previous_ref: ${id.previousRef ?? none}`,
  ];
}

interface DeployData {
  status: string;
  environment: string;
  deploy_id: string | null;
  channel: Channel;
  mode: DeployMode;
  ref_input: string;
  ref_requested: string;
  ref: string | null;
  ref_source: 'explicit' | 'ci-reported' | 'unknown';
  rollback: boolean;
  rollback_from: string | null;
  duration_ms: number | null;
  ci: CiInfo | null;
  log_path: string | null;
  output_tail: string | null;
  ledger_written: boolean;
  proposal: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  warnings: Warning[];
}

function baseData(
  environment: string, deployId: string | null, channel: Channel, mode: DeployMode, refInput: string, requested: string,
  rollback: boolean, rollbackFrom: string | null,
): DeployData {
  return {
    status: 'done', environment, deploy_id: deployId, channel, mode, ref_input: refInput, ref_requested: requested,
    ref: null, ref_source: 'unknown', rollback, rollback_from: rollbackFrom, duration_ms: null, ci: null,
    log_path: null, output_tail: null, ledger_written: false, proposal: null, plan: null, warnings: [],
  };
}

const STATUS_TITLE: Record<string, string> = {
  'dry-run': 'deploy.text.dryRun',
  'awaiting-agent': 'deploy.text.awaitingAgent',
  done: 'deploy.text.done',
  reconciled: 'deploy.text.reconciled',
  'still-running': 'deploy.text.stillRunning',
  abandoned: 'deploy.text.abandoned',
};

function output(format: OutputFormat, locale: Locale, data: DeployData): void {
  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('deploy', data)));
    return;
  }
  console.log('');
  console.log(t(locale, STATUS_TITLE[data.status] ?? 'deploy.text.done', { environment: data.environment, deployId: data.deploy_id ?? '-' }));
  console.log(`  ${t(locale, 'deploy.text.channel', { channel: data.channel, mode: data.mode })}`);
  console.log(`  ${t(locale, 'deploy.text.requested', { input: data.ref_input, requested: data.ref_requested })}`);
  if (data.status === 'done' || data.status === 'reconciled') {
    console.log(`  ${t(locale, 'deploy.text.ref', { ref: data.ref ?? t(locale, 'deploy.report.unconfirmed') })}`);
  }
  if (data.rollback) console.log(`  ${t(locale, 'deploy.text.rollback', { from: data.rollback_from ?? '-' })}`);
  const gate = data as DeployData & Partial<GateFields>;
  if (gate.promoted_from) console.log(`  ${t(locale, 'deploy.text.promotedFrom', { from: gate.promoted_from })}`);
  if (gate.promotion_override_reason) console.log(`  ${t(locale, 'deploy.text.promotionOverride', { reason: gate.promotion_override_reason })}`);
  if (gate.approval_id) console.log(`  ${t(locale, 'deploy.text.approval', { id: gate.approval_id })}`);
  if (data.plan) {
    if (data.plan.plan_path !== undefined) {
      console.log(`  ${t(locale, 'deploy.text.planAgent', { path: String(data.plan.plan_path), section: String(data.plan.plan_section ?? '-') })}`);
      if (data.status === 'awaiting-agent') {
        console.log(`  ${t(locale, 'deploy.text.completeHint', { environment: data.environment, deployId: data.deploy_id ?? '-' })}`);
      }
    } else if (data.plan.workflow) {
      console.log(`  ${t(locale, 'deploy.text.planWorkflow', { workflow: String(data.plan.workflow), ref: String(data.plan.dispatch_ref) })}`);
    } else {
      const args = Array.isArray(data.plan.args) ? (data.plan.args as string[]).join(' ') : '';
      console.log(`  ${t(locale, 'deploy.text.plan', { script: String(data.plan.script), args, workdir: String(data.plan.workdir ?? '-') })}`);
    }
  }
  if (data.ci?.run_id) console.log(`  ${t(locale, 'deploy.text.run', { runId: data.ci.run_id, url: data.ci.run_url ?? '' })}`);
  if (data.log_path) console.log(`  ${t(locale, 'deploy.text.log', { path: data.log_path })}`);
  if (data.proposal) {
    console.log(`  ${t(locale, 'deploy.text.proposal', {
      slug: String(data.proposal.slug), checked: String(data.proposal.deploy_tasks_checked), total: String(data.proposal.deploy_tasks_total),
    })}`);
  }
  for (const w of data.warnings) console.log(`  ⚠ [${w.code}] ${w.message}`);
  console.log('');
}
