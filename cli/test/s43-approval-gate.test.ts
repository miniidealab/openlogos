/**
 * environment-promotion-approval 切片 2：openlogos approve 与审批门（S43）。
 *
 * 覆盖 UT-S43-04、UT-S43-05、UT-S43-06、UT-S43-07、UT-S43-08、UT-S43-12、UT-S43-14（logos/resources/test/core-S43-test-cases.md）。
 * 规范源：spec/environments.md §5.4、§12.2、§12.4、§12.5；spec/cli-json-output.md「`openlogos approve --format json`」
 * 「deploy / deploy-done / env / status 晋级与审批增量」，决策 C02、C07，review delta-r1 F1。
 * 一次性 git 项目：staging 与 prod 配置 deploy（脚本只向一次性发布目录写文件），prod 配置 promote_from: staging 与
 * require_approval: true；staging 对 v1（X）、v2（Y）的 verified=true smoke 记录直接写入账本（本片不做晋级检查，
 * 上游均已验证）。确定性交错（UT-S43-07、UT-S43-08）以进程内注入点暂停一方、以真实 CLI 进程执行另一方。
 * ci 方式使用 provider: script 的仓库内触发 / 状态脚本（状态由发布目录中的标志文件驱动），不访问远程。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, takeExitCode } from './helpers.js';
import { DEPLOY_LEDGER_REL, DEPLOY_PENDING_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';
import { deploy, type DeployCliOptions, type DeployHooks } from '../src/commands/deploy.js';
import { approve, type ApproveCliOptions, type ApproveHooks } from '../src/commands/approve.js';
// @ts-expect-error 夹具为 ESM .mjs（与基线生成脚本共用），无类型声明
import { observeDeployGateFixtures } from './golden/s43-gate-zero-regression-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const BASELINE = join(HERE, 'golden', 's43-gate-zero-regression-baseline.json');

/** 部署脚本：发布目录中存在 fail 标志时以 3 退出，否则记录一次启动。 */
const SCRIPT = `#!/bin/sh
mkdir -p "$PUBLISH_DIR"
if [ -f "$PUBLISH_DIR/fail" ]; then echo "boom"; exit 3; fi
echo "start $OPENLOGOS_DEPLOY_ENV $OPENLOGOS_DEPLOY_ID" >> "$PUBLISH_DIR/starts.txt"
`;
const TRIGGER = `#!/bin/sh
mkdir -p "$PUBLISH_DIR"
echo "trigger $OPENLOGOS_DEPLOY_ID" >> "$PUBLISH_DIR/starts.txt"
echo '{"run_id":"77","url":"https://ci.example/77"}'
`;
/** 状态脚本：发布目录中存在 ci-done 标志时报告成功，否则一直运行中。 */
const STATUS = `#!/bin/sh
if [ -f "$PUBLISH_DIR/ci-done" ]; then echo "{\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\",\\"deployed_ref\\":\\"$OPENLOGOS_DEPLOY_REF\\"}"; else echo '{"status":"in_progress"}'; fi
`;

const SCRIPT_CFG = { mode: 'script', script: 'deploy/run.sh' };
const CI_CFG = { mode: 'ci', provider: 'script', trigger_script: 'ci/trigger.sh', status_script: 'ci/status.sh', timeout_sec: 2, poll_interval_sec: 1 };
const AGENT_CFG = { mode: 'agent', plan_section: '生产部署' };

let root: string;
let cleanup: () => void;
let work: string;
let X: string;
let Y: string;

const publish = () => join(work, 'publish');
const starts = (): string[] => (existsSync(join(publish(), 'starts.txt')) ? readFileSync(join(publish(), 'starts.txt'), 'utf-8').trim().split('\n') : []);

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** 登记表：test 无 deploy；staging 为 script；prod 按参数配置，默认带两个门禁字段。 */
function registry(prodDeploy: Record<string, unknown> = SCRIPT_CFG, prodGate: Record<string, unknown> = { promote_from: 'staging', require_approval: true }): void {
  put(ENV_REGISTRY_REL, stringifyYaml({
    schema_version: 1,
    environments: [
      { id: 'test', name: 'Test', tier: 'test' },
      { id: 'staging', name: 'Staging', tier: 'staging', deploy: SCRIPT_CFG },
      { id: 'prod', name: 'Production', tier: 'prod', aliases: ['生产'], deploy: prodDeploy, ...prodGate },
    ],
  }, { lineWidth: 0 }));
}

function stagingSmoke(ref: string): Record<string, unknown> {
  return {
    kind: 'smoke', environment: 'staging', slug: null, recorded_at: '2026-10-15T00:00:00.000Z', observed_head: ref, observed_dirty: false,
    deploy_id: `stg-${ref.slice(0, 6)}`, ref, result: 'pass', env_evidence: 'declared', fresh_results: true, deploy_env_confirmed: true, verified: true,
  };
}

function setup(prodDeploy: Record<string, unknown> = SCRIPT_CFG): void {
  scaffoldProject(root, { locale: 'en' });
  registry(prodDeploy);
  put('.gitignore', `logos/.openlogos-runtime/\n${ENV_REGISTRY_REL}\n`);
  git(['init', '-q']);
  git(['config', 'user.name', 'Alice']);
  git(['config', 'user.email', 'alice@example.invalid']);
  const commit = (label: string) => {
    put('deploy/run.sh', `${SCRIPT}# ${label}\n`);
    put('ci/trigger.sh', TRIGGER);
    put('ci/status.sh', STATUS);
    for (const f of ['deploy/run.sh', 'ci/trigger.sh', 'ci/status.sh']) chmodSync(join(root, f), 0o755);
    put('payload.txt', `${label}\n`);
    git(['add', '-A']);
    git(['commit', '-qm', label]);
    return git(['rev-parse', 'HEAD']);
  };
  X = commit('v1'); git(['tag', 'v1']);
  Y = commit('v2'); git(['tag', 'v2']);
  commit('head');
  // 上游 staging 已验证 X 与 Y（晋级检查由切片 3 实现；本片用例的上游均已验证）
  put(DEPLOY_LEDGER_REL, `${[stagingSmoke(X), stagingSmoke(Y)].map(r => JSON.stringify(r)).join('\n')}\n`);
}

function cli(args: string[], env: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: 'utf-8', timeout: 120_000, env: { ...process.env, PUBLISH_DIR: publish(), ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function json(args: string[]): { status: number | null; data: any; error: any; stderr: string } {
  const r = cli([...args, '--format', 'json']);
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data; } catch { /* 失败路径无 stdout */ }
  try { error = JSON.parse(r.stderr).error; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, error, stderr: r.stderr };
}

/** 进程内调用（JSON 模式），用于注入确定的并发交错。 */
async function inProcess(run: () => Promise<void>): Promise<{ exit: number; data: any; error: any }> {
  const con = captureConsole();
  const restoreCwd = mockCwd(root);
  const exitSpy = mockProcessExit();
  const saved = process.env.PUBLISH_DIR;
  process.env.PUBLISH_DIR = publish();
  try {
    let exit: number;
    try {
      await run();
      exit = Number(takeExitCode() ?? 0);
    } catch (error) {
      const m = /^process\.exit\((\d+)\)$/.exec((error as Error).message);
      if (!m) throw error;
      takeExitCode();
      exit = Number(m[1]);
    }
    let data = null;
    let error = null;
    try { data = JSON.parse(con.logs[0]).data; } catch { /* 失败路径无 stdout */ }
    try { error = JSON.parse(con.errors[0]).error; } catch { /* 成功路径无 stderr envelope */ }
    return { exit, data, error };
  } finally {
    if (saved === undefined) delete process.env.PUBLISH_DIR; else process.env.PUBLISH_DIR = saved;
    exitSpy.mockRestore();
    restoreCwd();
    con.restore();
  }
}
const deployInProcess = (opts: DeployCliOptions, hooks: DeployHooks) => inProcess(() => deploy('json', opts, hooks));
const approveInProcess = (opts: ApproveCliOptions, hooks: ApproveHooks) => inProcess(() => approve('json', opts, hooks));

function ledger(): Array<Record<string, any>> {
  const p = join(root, DEPLOY_LEDGER_REL);
  return existsSync(p) ? readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}
const ledgerBytes = () => (existsSync(join(root, DEPLOY_LEDGER_REL)) ? readFileSync(join(root, DEPLOY_LEDGER_REL), 'utf-8') : null);
const approvals = () => ledger().filter(r => r.kind === 'approval');
const prodDeploys = () => ledger().filter(r => r.kind === 'deploy' && r.environment === 'prod');

function openApprovals(): Array<Record<string, any>> {
  const r = json(['env', 'show', 'prod']);
  expect(r.status, r.stderr).toBe(0);
  return r.data.open_approvals;
}

/** 项目全部文件（含运行态目录，不含 .git）的 SHA-256 清单。 */
function treeHash(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { out.push(`D ${p.slice(root.length)}`); walk(p); }
      else out.push(`F ${p.slice(root.length)} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
    }
  };
  walk(root);
  return out.join('\n');
}

/** 审批缺失：DEPLOY_APPROVAL_REQUIRED、零执行（发布目录无痕迹）、零写入（项目全部文件前后一致）。 */
function expectApprovalRequired(args: string[], requested: string): void {
  const before = treeHash();
  const startsBefore = starts().length;
  const r = json(['deploy', ...args]);
  expect(r.status, r.stderr).toBe(1);
  expect(r.error.code).toBe('DEPLOY_APPROVAL_REQUIRED');
  expect(r.error.details).toEqual({
    environment: 'prod', requested, approve_command: `openlogos approve --env prod --ref ${requested}`,
  });
  expect(starts().length, '部署脚本未运行').toBe(startsBefore);
  expect(treeHash(), '项目全部文件与运行态目录前后一致').toBe(before);
}

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  work = join(root, '..', `${root.split('/').pop()}-work`);
  mkdirSync(work, { recursive: true });
});
afterEach(() => {
  try { chmodSync(join(root, DEPLOY_PENDING_REL), 0o755); } catch { /* 目录不存在 */ }
  cleanup();
  rmSync(work, { recursive: true, force: true });
});

describe('S43 openlogos approve 与审批门 — 单元测试（environment-promotion-approval 切片 2）', () => {
  it('UT-S43-04: 审批缺失与审批后部署', () => {
    setup();
    // ① 未获审批：零执行零写入，给出可直接执行的 approve 命令
    expectApprovalRequired(['--env', 'prod', '--ref', 'v1'], X);

    // ② approve 写入一条审批
    const before = approvals().length;
    const a = json(['approve', '--env', 'prod', '--ref', 'v1', '--note', '发版窗口']);
    expect(a.status, a.stderr).toBe(0);
    expect(a.data).toMatchObject({ environment: 'prod', created: true, ref: X, ref_input: 'v1', note: '发版窗口', approver: 'Alice <alice@example.invalid>' });
    const rows = approvals();
    expect(rows.length).toBe(before + 1);
    expect(rows[rows.length - 1]).toMatchObject({
      kind: 'approval', environment: 'prod', slug: null, approval_id: a.data.approval_id, ref: X, ref_input: 'v1', note: '发版窗口',
    });

    // ③ 审批后部署成功，记录与输出携带所用审批
    const d = json(['deploy', '--env', 'prod', '--ref', 'v1']);
    expect(d.status, d.stderr).toBe(0);
    expect(d.data.status).toBe('done');
    expect(d.data.approval_id).toBe(a.data.approval_id);
    expect(d.data).toHaveProperty('promoted_from');
    expect(d.data).toHaveProperty('promotion_override_reason', null);
    const rec = prodDeploys().at(-1)!;
    expect(rec).toMatchObject({ result: 'done', ref_requested: X, approval_id: a.data.approval_id, promotion_override_reason: null });
    expect(starts().length).toBe(1);
  }, 120_000);

  it('UT-S43-05: 审批的使用、幂等与 commit 绑定', () => {
    setup();
    const A = json(['approve', '--env', 'prod', '--ref', 'v1']).data.approval_id;
    // ① 部署 X 成功后 A 已使用
    expect(json(['deploy', '--env', 'prod', '--ref', 'v1']).status).toBe(0);
    expect(openApprovals().map(o => o.approval_id)).not.toContain(A);
    // ② 再次部署同一版本重新要求审批
    expectApprovalRequired(['--env', 'prod', '--ref', 'v1'], X);
    // ③ 对 Y 的审批不放行 X
    const B = json(['approve', '--env', 'prod', '--ref', 'v2']);
    expect(B.data.created).toBe(true);
    expectApprovalRequired(['--env', 'prod', '--ref', 'v1'], X);
    expect(openApprovals().map(o => [o.approval_id, o.ref])).toEqual([[B.data.approval_id, Y]]);
    // ④ 对 X 连续两次 approve：幂等，账本只多一行
    const before = approvals().length;
    const first = json(['approve', '--env', 'prod', '--ref', 'v1']);
    const second = json(['approve', '--env', 'prod', '--ref', X]);
    expect(first.data.created).toBe(true);
    expect(second.data).toMatchObject({ created: false, approval_id: first.data.approval_id, recorded_at: first.data.recorded_at });
    expect(approvals().length).toBe(before + 1);
    // 别名解析同样命中同一份
    expect(json(['approve', '--env', '生产', '--ref', 'v1']).data).toMatchObject({ environment: 'prod', created: false, approval_id: first.data.approval_id });
  }, 120_000);

  it('UT-S43-06: 失败与结果未知不使用审批，成功使用不可撤销', () => {
    // ① script 以 3 退出：DEPLOY_FAILED，A 仍未使用；脚本改为成功后再次部署使用 A
    setup();
    const A = json(['approve', '--env', 'prod', '--ref', 'v1']).data.approval_id;
    mkdirSync(publish(), { recursive: true });
    writeFileSync(join(publish(), 'fail'), '');
    const f = json(['deploy', '--env', 'prod', '--ref', 'v1']);
    expect(f.status).toBe(1);
    expect(f.error.code).toBe('DEPLOY_FAILED');
    expect(prodDeploys().at(-1)).toMatchObject({ result: 'failed', approval_id: A });
    expect(openApprovals().map(o => o.approval_id)).toEqual([A]);
    rmSync(join(publish(), 'fail'));
    const ok = json(['deploy', '--env', 'prod', '--ref', 'v1']);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.data.approval_id).toBe(A);
    expect(openApprovals()).toEqual([]);
    cleanup();
    rmSync(work, { recursive: true, force: true });

    // ② ci 观察超时：DEPLOY_RESULT_UNKNOWN，A 未使用；--reconcile 补记 done 后 A 已使用
    ({ root, cleanup } = makeTempRoot());
    mkdirSync(work, { recursive: true });
    setup(CI_CFG);
    const A2 = json(['approve', '--env', 'prod', '--ref', 'v1']).data.approval_id;
    const u = json(['deploy', '--env', 'prod', '--ref', 'v1']);
    expect(u.status).toBe(1);
    expect(u.error.code).toBe('DEPLOY_RESULT_UNKNOWN');
    expect(prodDeploys().at(-1)).toMatchObject({ result: 'unknown', failure_reason: 'ci-observe-timeout', approval_id: A2 });
    expect(openApprovals().map(o => o.approval_id)).toEqual([A2]);
    writeFileSync(join(publish(), 'ci-done'), '');
    const rc = json(['deploy', '--env', 'prod', '--reconcile']);
    expect(rc.status, rc.stderr).toBe(0);
    expect(rc.data).toMatchObject({ status: 'reconciled', approval_id: A2 });
    expect(prodDeploys().at(-1)).toMatchObject({ result: 'done', reconciled: true, approval_id: A2 });
    expect(openApprovals()).toEqual([]);
    cleanup();
    rmSync(work, { recursive: true, force: true });

    // ③ agent：--complete --result done 落账后删除未决记录失败（未决记录保留），再 --abandon → A 仍为已使用
    ({ root, cleanup } = makeTempRoot());
    mkdirSync(work, { recursive: true });
    setup(AGENT_CFG);
    const A3 = json(['approve', '--env', 'prod', '--ref', 'v1']).data.approval_id;
    const aw = json(['deploy', '--env', 'prod', '--ref', 'v1']);
    expect(aw.status, aw.stderr).toBe(0);
    expect(aw.data).toMatchObject({ status: 'awaiting-agent', approval_id: A3 });
    const pendingDir = join(root, DEPLOY_PENDING_REL);
    expect(JSON.parse(readFileSync(join(pendingDir, 'prod.json'), 'utf-8')).approval_id).toBe(A3);
    chmodSync(pendingDir, 0o555); // 注入：删除未决记录失败
    const done = json(['deploy', '--env', 'prod', '--complete', aw.data.deploy_id, '--result', 'done']);
    chmodSync(pendingDir, 0o755);
    expect(done.status, done.stderr).toBe(0);
    expect(existsSync(join(pendingDir, 'prod.json')), '未决记录保留').toBe(true);
    expect(prodDeploys().at(-1)).toMatchObject({ result: 'done', mode: 'agent', approval_id: A3 });
    const ab = json(['deploy', '--env', 'prod', '--abandon', aw.data.deploy_id]);
    expect(ab.status, ab.stderr).toBe(0);
    expect(existsSync(join(pendingDir, 'prod.json')), '占用解除').toBe(false);
    expect(prodDeploys().at(-1)).toMatchObject({ deploy_id: aw.data.deploy_id, result: 'unknown', failure_reason: 'abandoned' });
    expect(openApprovals()).toEqual([]);
    expectApprovalRequired(['--env', 'prod', '--ref', 'v1'], X);
  }, 180_000);

  it('UT-S43-07: 并发部署不能共用同一审批', async () => {
    setup();
    const P = json(['approve', '--env', 'prod', '--ref', 'v1']).data.approval_id;
    let b: ReturnType<typeof json> | null = null;
    // 部署 A 通过锁外检查后在 beforeAcquire 暂停；期间以真实 CLI 完成部署 B（使用 P）
    const a = await deployInProcess({ env: 'prod', ref: 'v1' }, {
      beforeAcquire: () => { b = json(['deploy', '--env', 'prod', '--ref', 'v1']); },
    });
    expect(b!.status, b!.stderr).toBe(0);
    expect(b!.data.approval_id).toBe(P);
    expect(a.exit).toBe(1);
    expect(a.error.code).toBe('DEPLOY_APPROVAL_REQUIRED');
    expect(a.error.details.approve_command).toBe(`openlogos approve --env prod --ref ${X}`);
    expect(starts().length, '部署脚本只被 B 运行一次').toBe(1);
    const done = prodDeploys().filter(r => r.result === 'done');
    expect(done.map(r => [r.deploy_id, r.approval_id])).toEqual([[b!.data.deploy_id, P]]);
    expect(prodDeploys().length).toBe(1);
    expect(existsSync(join(root, 'logos/.openlogos-runtime/deploy-locks/prod.lock')), 'A 已释放环境锁').toBe(false);

    // agent 方式同样交错：A 不登记未决记录，未决记录只属于 B
    registry(AGENT_CFG);
    json(['approve', '--env', 'prod', '--ref', 'v2']);
    let bAgent: ReturnType<typeof json> | null = null;
    const aAgent = await deployInProcess({ env: 'prod', ref: 'v2' }, {
      beforeAcquire: () => { bAgent = json(['deploy', '--env', 'prod', '--ref', 'v2']); },
    });
    expect(bAgent!.status, bAgent!.stderr).toBe(0);
    expect(bAgent!.data.status).toBe('awaiting-agent');
    expect(aAgent.exit).toBe(1);
    expect(['DEPLOY_APPROVAL_REQUIRED', 'DEPLOY_IN_PROGRESS']).toContain(aAgent.error.code);
    const pending = JSON.parse(readFileSync(join(root, DEPLOY_PENDING_REL, 'prod.json'), 'utf-8'));
    expect(pending.deploy_id).toBe(bAgent!.data.deploy_id);
  }, 120_000);

  it('UT-S43-08: 并发 approve 只写一条', async () => {
    setup();
    const before = approvals().length;
    let b: ReturnType<typeof json> | null = null;
    // approve A 完成前置后在账本锁临界区之前暂停；期间以真实 CLI 完成 approve B，A 取锁后重扫查重
    const a = await approveInProcess({ env: 'prod', ref: 'v1' }, {
      beforeLedgerLock: () => { b = json(['approve', '--env', 'prod', '--ref', 'v1']); },
    });
    expect(b!.status, b!.stderr).toBe(0);
    expect(a.exit).toBe(0);
    expect(b!.data.created).toBe(true);
    expect(a.data.created).toBe(false);
    expect(a.data.approval_id).toBe(b!.data.approval_id);
    expect(approvals().length).toBe(before + 1);
  }, 120_000);

  it('UT-S43-12: approve 前置拒绝', () => {
    setup();
    const bytes = ledgerBytes();
    const expectReject = (args: string[], code: string) => {
      const r = json(['approve', ...args]);
      expect(r.status, `${code}: ${r.stderr}`).toBe(1);
      expect(r.error.code).toBe(code);
      expect(r.error).not.toHaveProperty('details');
      expect(ledgerBytes(), `${code}：账本字节不变`).toBe(bytes);
    };
    const registryText = readFileSync(join(root, ENV_REGISTRY_REL), 'utf-8');
    rmSync(join(root, ENV_REGISTRY_REL));
    expectReject(['--env', 'prod', '--ref', 'v1'], 'ENV_REGISTRY_NOT_FOUND');
    put(ENV_REGISTRY_REL, registryText.replace('promote_from: staging', 'promote_from: nosuch'));
    expectReject(['--env', 'prod', '--ref', 'v1'], 'ENV_REGISTRY_INVALID');
    put(ENV_REGISTRY_REL, registryText);
    expectReject(['--ref', 'v1'], 'ENV_REQUIRED');
    expectReject(['--env', 'nosuch', '--ref', 'v1'], 'ENV_UNKNOWN');
    expectReject(['--env', 'test', '--ref', 'v1'], 'APPROVAL_NOT_REQUIRED');
    expectReject(['--env', 'staging', '--ref', 'v1'], 'APPROVAL_NOT_REQUIRED');
    expectReject(['--env', 'prod', '--ref', 'nosuch'], 'ENV_REF_UNRESOLVED');
    expectReject(['--env', 'prod'], 'APPROVAL_REF_REQUIRED');

    // 中英文案：英文与中文 locale 各覆盖一个错误码
    expect(JSON.parse(cli(['approve', '--env', 'test', '--ref', 'v1', '--format', 'json']).stderr).error.message).toMatch(/does not require approval/);
    const config = JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf-8'));
    writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ ...config, locale: 'zh' }, null, 2));
    expect(JSON.parse(cli(['approve', '--env', 'test', '--ref', 'v1', '--format', 'json']).stderr).error.message).toMatch(/不要求审批/);
    expect(JSON.parse(cli(['deploy', '--env', 'prod', '--ref', 'v1', '--format', 'json']).stderr).error.message).toMatch(/要求审批/);
    expect(ledgerBytes()).toBe(bytes);
  }, 120_000);

  it('UT-S43-14: 未配置门禁零回归', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'));
    const current = observeDeployGateFixtures(CLI);
    const names = ['no-registry', 'registry-without-gates', 'deploy-enabled-without-gates'];
    expect(Object.keys(current)).toEqual(names);
    for (const name of names) {
      // 输出、退出码、账本字节与提案目录文件与引入本提案前（0.16.4）的基线逐字一致
      expect(current[name], `${name} 与引入前基线逐字一致`).toEqual(baseline[name]);
      const text = JSON.stringify(current[name]);
      for (const k of ['promote_from', 'require_approval', 'open_approvals', 'promotion', 'approval_id', 'promoted_from', 'promotion_override_reason']) {
        expect(text.includes(`\\"${k}\\"`) || text.includes(`"${k}"`), `${name} 不出现 ${k}`).toBe(false);
      }
    }
    // 版本通道 deploy 在已启用部署执行但无门的夹具上成功执行
    const deployStep = current['deploy-enabled-without-gates'].steps[0];
    expect(deployStep.args).toBe('deploy --env prod --ref HEAD --channel version --format json');
    expect(deployStep.exit).toBe(0);
    expect(deployStep.stdout.data.status).toBe('done');
  }, 300_000);
});
