/**
 * S46 人工结果记录、smoke 人工阶段与归档核对（smoke-manual-acceptance，切片 slice-03-accept-gate-waiting-archive）。
 *
 * 覆盖 UT-S46-12～UT-S46-24、UT-S46-29～UT-S46-37、ST-S46-01～ST-S46-12、UT-S19-135～UT-S19-137、ST-S19-41，
 * 对应功能规格 §2.107.5～§2.107.8、spec/environments.md §15.5～§15.8、场景 S46 EX-46.1～EX-46.20、S19 EX-19.29。
 * 全部用例在一次性 git 项目中构造（S1 夹具 + prod 开启人工验收）；交错执行用进程内调用与测试接缝构造。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { captureConsole, mockCwd, mockProcessExit, takeExitCode } from './helpers.js';
import { smoke } from '../src/commands/smoke.js';
import { accept } from '../src/commands/accept.js';
import { manualResultsOf, readDeploymentLedger, manualBaselineOf } from '../src/lib/environments.js';
import { CLI_DIST } from './s19-module-env-fixtures.js';
import {
  LEDGER_REL, PROPOSAL_DIR, S01_SPEC, ST05, ST08, SMOKE_SPEC, acceptJson, appendLedger, archiveRun, cli, deployDone, git, head,
  ledgerDeploy, ledgerManual, ledgerRows, manualProject, markers, nextJson, put, smokeJson,
} from './s46-manual-fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const ledgerBytes = (root: string) => (existsSync(join(root, LEDGER_REL)) ? readFileSync(join(root, LEDGER_REL), 'utf-8') : '');
const lastSmoke = (root: string) => ledgerRows(root).filter(r => r.kind === 'smoke').pop();

/** 进程内执行（用于测试接缝）：返回 stdout / stderr 最后一个 JSON envelope 与退出码。 */
async function inProcess(root: string, fn: () => unknown | Promise<unknown>): Promise<{ exit: number | undefined; out: any; err: any }> {
  const restore = mockCwd(root);
  const con = captureConsole();
  const exitSpy = mockProcessExit();
  let exitArg: number | undefined;
  try { await fn(); } catch { /* process.exit 桩抛出 */ } finally {
    const call = exitSpy.mock.calls[0];
    if (call) exitArg = Number(call[0] ?? 0);
    con.restore(); exitSpy.mockRestore(); restore();
  }
  const pending = takeExitCode();
  const last = (lines: string[]) => { for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch { /* skip */ } } return null; };
  return { exit: exitArg ?? (pending === undefined || pending === null ? undefined : Number(pending)), out: last(con.logs), err: last(con.errors ?? []) };
}

/** 进入 PENDING：提案通道部署 prod 并跑一次 smoke。 */
function pendingProposal(opts: Parameters<typeof manualProject>[1] = {}) {
  const root = manualProject(cleanups, opts);
  const d = deployDone(root);
  const s = smokeJson(root);
  return { root, d, s };
}

/** 版本通道：无活跃提案，prod 部署为 HEAD（夹具账本写入）。 */
function versionProject(opts: Parameters<typeof manualProject>[1] = {}, deployId = 'd1') {
  const root = manualProject(cleanups, { ...opts, proposal: false });
  ledgerDeploy(root, 'prod', deployId, head(root));
  return root;
}

describe('S46 accept 命令（smoke-manual-acceptance）', () => {
  it('UT-S46-12: accept 参数校验', () => {
    const root = versionProject();
    const before = ledgerBytes(root);
    const cases: Array<[string[], string]> = [
      [['--case', 'ST-S01-05', '--result', 'pass'], 'ACCEPT_ARGS_INVALID'],
      [['--deploy', 'd1', '--result', 'pass'], 'ACCEPT_ARGS_INVALID'],
      [['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'maybe'], 'ACCEPT_ARGS_INVALID'],
      [['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'fail'], 'ACCEPT_NOTE_REQUIRED'],
      [['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'fail', '--note', '  '], 'ACCEPT_NOTE_REQUIRED'],
    ];
    for (const [args, code] of cases) {
      const r = acceptJson(root, args);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.err.error.code, args.join(' ')).toBe(code);
    }
    expect(ledgerBytes(root)).toBe(before);
  });

  it('UT-S46-13: accept 前置：未开启与无部署', () => {
    const root = versionProject();
    const r1 = cli(root, ['accept', '--env', 'test', '--deploy', 'x', '--case', 'ST-S01-05', '--result', 'pass', '--format', 'json']);
    expect(r1.err.error.code).toBe('ACCEPT_NOT_ENABLED');
    const noDeploy = manualProject(cleanups, { proposal: false });
    const r2 = acceptJson(noDeploy, ['--deploy', 'x', '--case', 'ST-S01-05', '--result', 'pass']);
    expect(r2.err.error.code).toBe('ACCEPT_NO_DEPLOYMENT');
    expect(existsSync(join(noDeploy, LEDGER_REL))).toBe(false);
  });

  it('UT-S46-14: accept 前置：登记表缺失或非法', () => {
    const root = versionProject();
    const before = ledgerBytes(root);
    rmSync(join(root, 'logos/environments.yaml'));
    expect(acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'pass']).err.error.code).toBe('ENV_REGISTRY_NOT_FOUND');
    put(root, 'logos/environments.yaml', 'schema_version: 1\nenvironments:\n  - id: prod\n    name: Production\n    tier: prod\n    manual_acceptance:\n      enabled: "yes"\n');
    expect(acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'pass']).err.error.code).toBe('ENV_REGISTRY_INVALID');
    expect(ledgerBytes(root)).toBe(before);
  });

  it('UT-S46-15: accept 部署已更换（同一提交的两次部署）', () => {
    const root = versionProject({}, 'd1');
    ledgerDeploy(root, 'prod', 'd2', head(root));
    const before = ledgerBytes(root);
    const r = acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'pass']);
    expect(r.err.error.code).toBe('ACCEPT_DEPLOY_CHANGED');
    expect(r.err.error.details).toMatchObject({ expected: 'd1', current: 'd2' });
    expect(ledgerBytes(root)).toBe(before);
  });

  it('UT-S46-16: accept 部署身份在锁内核对', async () => {
    const root = versionProject({}, 'd1');
    const r = await inProcess(root, () => accept('json', { env: 'prod', deploy: 'd1', cases: ['ST-S01-05'], result: 'pass' }, {
      beforeLedgerLock: () => ledgerDeploy(root, 'prod', 'd2', head(root)),
    }));
    expect(r.exit).toBe(1);
    expect(r.err.error.code).toBe('ACCEPT_DEPLOY_CHANGED');
    const rows = ledgerRows(root);
    expect(rows.map(x => `${x.kind}:${x.deploy_id}`)).toEqual(['deploy:d1', 'deploy:d2']);
  });

  it('UT-S46-17: accept 用例不在清单整批零写入', () => {
    const root = versionProject();
    const before = ledgerBytes(root);
    const r = acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05,UT-S01-99', '--result', 'pass']);
    expect(r.err.error.code).toBe('ACCEPT_CASE_NOT_PENDING');
    expect(r.err.error.details.not_pending).toEqual(['UT-S01-99']);
    expect(ledgerBytes(root)).toBe(before);
  });

  it('UT-S46-18: accept 清单无法确定', () => {
    const root = manualProject(cleanups, { proposal: false });
    ledgerDeploy(root, 'prod', 'd1', null);
    const before = ledgerBytes(root);
    const r = acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'pass']);
    expect(r.err.error.code).toBe('ACCEPT_CASE_NOT_PENDING');
    expect(r.err.error.details.reason).toBe('scope_unresolved');
    expect(ledgerBytes(root)).toBe(before);
  });

  it('UT-S46-19: accept 写入 manual 行与证据警告', () => {
    const root = versionProject();
    const r = acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--case', 'SMOKE-core-901', '--result', 'fail', '--note', '首启白屏', '--evidence', 'shots/a.png']);
    expect(r.status, r.stderr).toBe(0);
    const manual = ledgerRows(root).filter(x => x.kind === 'manual');
    expect(manual.map(x => x.case_id)).toEqual(['ST-S01-05', 'SMOKE-core-901']);
    for (const m of manual) {
      expect(m).toMatchObject({ deploy_id: 'd1', ref: head(root), result: 'fail', note: '首启白屏', evidence: ['shots/a.png'] });
      expect('recorder' in m).toBe(true);
    }
    expect(r.out.data.warnings).toEqual([{ code: 'accept_evidence_missing', path: 'shots/a.png' }]);
  });

  it('UT-S46-20: 同一用例重复记录以最后一条为准', () => {
    const root = versionProject();
    expect(acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'fail', '--note', '先失败']).status).toBe(0);
    expect(acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'pass']).status).toBe(0);
    const results = manualResultsOf(readDeploymentLedger(root).byEnvironment.get('prod'), 'd1');
    expect(results.get('ST-S01-05')?.result).toBe('pass');
    expect(ledgerRows(root).filter(x => x.kind === 'manual')).toHaveLength(2);
  });

  it('UT-S46-21: accept 并发只按锁串行', async () => {
    const root = versionProject();
    const run = (caseId: string) => new Promise<number>(res => {
      const p = spawn(process.execPath, [CLI_DIST, 'accept', '--env', 'prod', '--deploy', 'd1', '--case', caseId, '--result', 'pass', '--format', 'json'], { cwd: root });
      p.on('exit', code => res(code ?? 1));
    });
    const codes = await Promise.all([run('ST-S01-05'), run('SMOKE-core-901')]);
    expect(codes).toEqual([0, 0]);
    const snap = readDeploymentLedger(root);
    expect(snap.corruptLines).toBe(0);
    expect(ledgerRows(root).filter(x => x.kind === 'manual').map(x => x.case_id).sort()).toEqual(['SMOKE-core-901', 'ST-S01-05']);
  }, 60_000);

  it('UT-S46-30: accept JSON 契约', () => {
    const root = versionProject();
    const r = acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'pass']);
    expect(Object.keys(r.out.data).sort()).toEqual(['deploy_id', 'environment', 'expired_pass', 'recorded', 'recorder', 'ref', 'remaining', 'warnings']);
    expect(r.out.data).toMatchObject({ environment: 'prod', deploy_id: 'd1', recorded: [{ case_id: 'ST-S01-05', result: 'pass' }], remaining: ['SMOKE-core-901'], expired_pass: false, warnings: [] });
  });

  it('UT-S46-31: 通过后 accept 删除 SMOKE_PASS', () => {
    const { root, d } = pendingProposal({ prodManual: '{enabled: true, regression: [SMOKE-core-901]}' });
    expect(acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05,SMOKE-core-901', '--result', 'pass']).status).toBe(0);
    expect(smokeJson(root).status).toBe(0);
    expect(markers(root)).toEqual(['SMOKE_PASS']);
    const r = acceptJson(root, ['--deploy', d, '--case', 'SMOKE-core-901', '--result', 'fail', '--note', '回归失败']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.out.data.expired_pass).toBe(true);
    expect(markers(root)).toEqual([]);
    expect(ledgerRows(root).pop()).toMatchObject({ kind: 'manual', case_id: 'SMOKE-core-901', result: 'fail' });
  });

  it('UT-S46-32: 删除 SMOKE_PASS 失败时撤销账本行', async () => {
    const { root, d } = pendingProposal();
    acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05,SMOKE-core-901', '--result', 'pass']);
    smokeJson(root);
    const before = ledgerBytes(root);
    const r = await inProcess(root, () => accept('json', { env: 'prod', deploy: d, cases: ['ST-S01-05'], result: 'fail', note: '更正' }, {
      removeMarker: () => { throw new Error('EPERM: injected'); },
    }));
    expect(r.exit).toBe(1);
    expect(r.err.error.code).toBe('ACCEPT_LEDGER_WRITE_FAILED');
    expect(ledgerBytes(root)).toBe(before);
    expect(markers(root)).toEqual(['SMOKE_PASS']);
  });
});

describe('S46 smoke 人工阶段（smoke-manual-acceptance）', () => {
  it('UT-S46-22: 人工阶段判定顺序', () => {
    // ① R 不可读
    const r1 = manualProject(cleanups, { proposal: false });
    ledgerDeploy(r1, 'prod', 'd1', 'c'.repeat(40));
    expect(smokeJson(r1).out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_scope_unresolved' });
    // ② regression 失效且有 fail 记录
    const r2 = versionProject({ prodManual: '{enabled: true, regression: [ST-S01-99]}' });
    ledgerManual(r2, 'prod', 'd1', 'ST-S01-05', 'fail', '白屏');
    expect(smokeJson(r2).out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_regression_unresolved' });
    // ③ 一条 fail
    const r3 = versionProject();
    ledgerManual(r3, 'prod', 'd1', 'ST-S01-05', 'fail', '白屏');
    expect(smokeJson(r3).out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_cases_failed' });
    // ④ 全部 pass
    const r4 = versionProject();
    ledgerManual(r4, 'prod', 'd1', 'ST-S01-05');
    ledgerManual(r4, 'prod', 'd1', 'SMOKE-core-901');
    expect(smokeJson(r4).out.data.gate).toEqual({ result: 'PASS', reason: null });
    // ⑤ P 为空（基线等于 R，无回归）
    const r5 = manualProject(cleanups, { proposal: false });
    ledgerDeploy(r5, 'prod', 'd0', head(r5));
    appendLedger(r5, { kind: 'smoke', environment: 'prod', slug: null, recorded_at: 'x', observed_head: null, observed_dirty: null, deploy_id: 'd0', ref: head(r5), result: 'pass', env_evidence: 'declared', fresh_results: true, deploy_env_confirmed: true, verified: true, manual_passed: true });
    ledgerDeploy(r5, 'prod', 'd1', head(r5));
    const s5 = smokeJson(r5);
    expect(s5.out.data.manual_acceptance.pending).toEqual([]);
    expect(s5.out.data.gate).toEqual({ result: 'PASS', reason: null });
    // ⑥ 一条未记录
    const r6 = versionProject();
    ledgerManual(r6, 'prod', 'd1', 'ST-S01-05');
    expect(smokeJson(r6).out.data.gate).toEqual({ result: 'PENDING', reason: 'manual_acceptance_pending' });
  });

  it('UT-S46-23: PENDING 落账内容', () => {
    const root = versionProject();
    ledgerManual(root, 'prod', 'd1', 'ST-S01-05');
    const r = smokeJson(root);
    expect(r.status).toBe(1);
    expect(r.out.data.gate.result).toBe('PENDING');
    expect(lastSmoke(root)).toMatchObject({ result: 'pending', verified: false, deploy_id: 'd1', manual_pending: ['SMOKE-core-901'] });
  });

  it('UT-S46-24: smoke 锁内复核采纳锁外判定之后的记录', async () => {
    const pendingToPass = versionProject();
    ledgerManual(pendingToPass, 'prod', 'd1', 'ST-S01-05');
    const r1 = await inProcess(pendingToPass, () => smoke('json', 'prod', { beforeLedgerLock: () => ledgerManual(pendingToPass, 'prod', 'd1', 'SMOKE-core-901') }));
    expect(r1.out.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(lastSmoke(pendingToPass)).toMatchObject({ result: 'pass', manual_passed: true });
    const passToFail = versionProject();
    ledgerManual(passToFail, 'prod', 'd1', 'ST-S01-05');
    ledgerManual(passToFail, 'prod', 'd1', 'SMOKE-core-901');
    const r2 = await inProcess(passToFail, () => smoke('json', 'prod', { beforeLedgerLock: () => ledgerManual(passToFail, 'prod', 'd1', 'ST-S01-05', 'fail', '白屏') }));
    expect(r2.out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_cases_failed' });
    expect(lastSmoke(passToFail)).toMatchObject({ result: 'fail' });

    // 评审 code-r1 F1：runner 启动后、人工清单读取前环境被部署为清单为空的 D2——D1 不得获得人工通过
    const replaced = manualProject(cleanups, { proposal: false });
    const sidecar = `${replaced}.d2.json`;
    cleanups.push(() => rmSync(sidecar, { force: true }));
    const runnerPath = join(replaced, 'scripts/smoke-project.js');
    writeFileSync(runnerPath, `{ const fs = require('fs'); const side = ${JSON.stringify(sidecar)};
if (fs.existsSync(side)) fs.appendFileSync(${JSON.stringify(LEDGER_REL)}, fs.readFileSync(side, 'utf8')); }
` + readFileSync(runnerPath, 'utf-8'));
    git(replaced, ['add', '-A']); git(replaced, ['commit', '-qm', 'runner deploys d2 mid-run']);
    const c1 = head(replaced);
    git(replaced, ['checkout', '-qb', 'no-manual']);
    put(replaced, S01_SPEC, '# core-S01\n\n| ID | 描述 |\n|---|---|\n');
    put(replaced, SMOKE_SPEC, readFileSync(join(replaced, SMOKE_SPEC), 'utf-8').split('\n').filter(l => !l.includes('[manual]')).join('\n'));
    git(replaced, ['add', '-A']); git(replaced, ['commit', '-qm', 'no manual cases']);
    const c0 = head(replaced);
    git(replaced, ['checkout', '-q', c1]);
    ledgerDeploy(replaced, 'prod', 'd1', c1);
    writeFileSync(sidecar, JSON.stringify({
      kind: 'deploy', environment: 'prod', slug: null, recorded_at: new Date().toISOString(), observed_head: null, observed_dirty: null,
      deploy_id: 'd2', ref: c0, ref_source: 'explicit', result: 'done', channel: 'version', mode: 'script', ref_requested: c0,
    }) + '\n');
    const r3 = smokeJson(replaced);
    expect(readDeploymentLedger(replaced).byEnvironment.get('prod')!.lastDeploy!.deploy_id).toBe('d2');
    expect(r3.out.data.gate.result).not.toBe('PASS');
    expect(r3.out.data.manual_acceptance.warnings.map((w: { code: string }) => w.code)).toContain('manual_deployment_replaced');
    // 评审 code-r2 F1：人工验收 JSON 与报告中的编号、提交、确认状态整组属于 D1；D2 只出现在警告中
    expect(r3.out.data.manual_acceptance).toMatchObject({ deploy_id: 'd1', ref: c1, deploy_confirmed: true });
    const report3 = readFileSync(join(replaced, r3.out.data.report_path), 'utf-8');
    expect(report3).toContain(`- 部署：d1（ref ${c1}）`);
    expect(report3).not.toContain(`d1（ref ${c0}）`);
    const replacedWarning = r3.out.data.manual_acceptance.warnings.find((w: { code: string }) => w.code === 'manual_deployment_replaced');
    expect(replacedWarning.message).toContain('d2');
    expect(replacedWarning.message).toContain(c0);
    expect(ledgerRows(replaced).filter(x => x.kind === 'smoke' && x.manual_passed === true)).toEqual([]);
    expect(ledgerRows(replaced).filter(x => x.kind === 'smoke' && x.result === 'pass')).toEqual([]);
    expect(manualBaselineOf(readDeploymentLedger(replaced).byEnvironment.get('prod'))).toBeNull();
  });

  it('UT-S46-29: smoke JSON 契约与 status.schema.json', () => {
    const keys = ['baseline_ref', 'deploy_confirmed', 'deploy_id', 'enabled', 'environment', 'failed', 'passed', 'pending', 'ref', 'regression_unresolved', 'remaining', 'unexecuted', 'warnings'];
    const enabled = versionProject();
    const on = smokeJson(enabled).out.data.manual_acceptance;
    expect(Object.keys(on).sort()).toEqual(keys);
    expect(on.unexecuted).toEqual([]);
    const disabled = versionProject();
    const off = smokeJson(disabled, 'test').out.data.manual_acceptance;
    expect(Object.keys(off).sort()).toEqual(keys);
    expect([off.pending, off.passed, off.failed, off.remaining]).toEqual([[], [], [], []]);
    const status = cli(enabled, ['status', '--format', 'json']);
    const schema = JSON.parse(readFileSync(resolve(HERE, '../../spec/schema/status.schema.json'), 'utf-8'));
    const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown } })({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    expect(validate(status.out.data), JSON.stringify((validate as { errors?: unknown }).errors)).toBe(true);
  });

  it('UT-S46-35: 版本通道 PENDING 只写账本', () => {
    const root = versionProject();
    const r = smokeJson(root);
    expect(r.out.data.gate.result).toBe('PENDING');
    expect(lastSmoke(root)).toMatchObject({ slug: null, result: 'pending' });
    expect(existsSync(PROPOSAL_DIR(root))).toBe(true);
    expect(markers(root)).toEqual([]);
    const show = cli(root, ['env', 'show', 'prod', '--format', 'json']).out.data;
    expect(show.manual_acceptance.waiting).toEqual({ deploy_id: 'd1', remaining: ['SMOKE-core-901', 'ST-S01-05'] });
  });

  it('UT-S46-36: 最近一次部署未确认时 accept 与 smoke 同口径', () => {
    const root = versionProject({}, 'd1');
    ledgerDeploy(root, 'prod', 'd2', null, 'unknown');
    const before = ledgerBytes(root);
    expect(acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'pass']).err.error.code).toBe('ACCEPT_DEPLOY_CHANGED');
    const r2 = acceptJson(root, ['--deploy', 'd2', '--case', 'ST-S01-05', '--result', 'pass']);
    expect(r2.err.error.code).toBe('ACCEPT_DEPLOYMENT_UNCONFIRMED');
    expect(r2.err.error.details.result).toBe('unknown');
    expect(ledgerBytes(root)).toBe(before);
    expect(smokeJson(root).out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_scope_unresolved' });
    // 对账补记 D2 为 done（同一 deploy_id 以最后一条为准）后：D1 清单仍被拒，D2 清单可记录
    ledgerDeploy(root, 'prod', 'd2', head(root), 'done');
    expect(acceptJson(root, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'pass']).err.error.code).toBe('ACCEPT_DEPLOY_CHANGED');
    expect(acceptJson(root, ['--deploy', 'd2', '--case', 'ST-S01-05', '--result', 'pass']).status).toBe(0);
  });

  it('UT-S46-37: 通过后普通用例可更正（无回归配置）', () => {
    const root = versionProject();
    ledgerManual(root, 'prod', 'd1', 'ST-S01-05');
    ledgerManual(root, 'prod', 'd1', 'SMOKE-core-901');
    expect(smokeJson(root).out.data.gate.result).toBe('PASS');
    const state = readDeploymentLedger(root).byEnvironment.get('prod');
    expect(manualBaselineOf(state)).toBeNull();
    expect(smokeJson(root).out.data.manual_acceptance.pending).toEqual(['SMOKE-core-901', 'ST-S01-05']);
    const r = acceptJson(root, ['--deploy', 'd1', '--case', 'SMOKE-core-901', '--result', 'fail', '--note', '白屏']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.out.data.expired_pass).toBe(true);
  });

  it('UT-S19-135: PENDING 清除旧标记的写入顺序', () => {
    const { root } = pendingProposal();
    // 先人为制造旧 SMOKE_FAIL，再跑 smoke 得到 PENDING
    writeFileSync(join(PROPOSAL_DIR(root), 'SMOKE_FAIL'), '');
    const r = smokeJson(root);
    expect(r.out.data.gate.result).toBe('PENDING');
    expect(markers(root)).toEqual([]);
    expect(lastSmoke(root).result).toBe('pending');
    expect(r.out.data.environment_evidence.markers_cleared).toEqual(['SMOKE_FAIL']);
  });

  it('UT-S19-136: PENDING 清除标记失败时恢复', async () => {
    const { root } = pendingProposal();
    writeFileSync(join(PROPOSAL_DIR(root), 'SMOKE_PASS'), '');
    const before = ledgerBytes(root);
    const r = await inProcess(root, () => smoke('json', 'prod', { writeIo: { removeMarker: () => { throw new Error('EPERM: injected'); } } }));
    expect(r.exit).toBe(1);
    expect(r.err.error.code).toBe('SMOKE_LEDGER_WRITE_FAILED');
    expect(markers(root)).toEqual(['SMOKE_PASS']);
    expect(ledgerBytes(root)).toBe(before);
  });

  it('UT-S19-137: 开启环境自动阶段 FAIL 时不进入人工阶段', () => {
    const root = manualProject(cleanups);
    put(root, 'tools/extra.jsonl', JSON.stringify({ id: 'SMOKE-core-02', status: 'fail', error: 'boom' }) + '\n');
    put(root, 'tools/project-ids.json', JSON.stringify(['SMOKE-core-01', 'SMOKE-shared-01']));
    git(root, ['add', '-A']); git(root, ['commit', '-qm', 'fail fixture']);
    deployDone(root);
    const r = smokeJson(root);
    expect(r.out.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.out.data.manual_acceptance.pending).toEqual(['SMOKE-core-901', 'ST-S01-05']);
    expect(lastSmoke(root).result).toBe('fail');
    expect(ledgerRows(root).some(x => x.result === 'pending')).toBe(false);
  });
});

describe('S46 归档核对（smoke-manual-acceptance）', () => {
  it('UT-S46-33: archive 以账本核对最近有效结论', () => {
    const { root, d } = pendingProposal();
    acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05,SMOKE-core-901', '--result', 'pass']);
    smokeJson(root);
    ledgerManual(root, 'prod', d, 'ST-S01-05', 'fail', '更正');
    expect(markers(root)).toEqual(['SMOKE_PASS']);
    const r = archiveRun(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ARCHIVE_SMOKE_NOT_PASSED');
    expect(r.stderr).toContain(`"reason":"smoke_pass_expired","environment":"prod","deploy_id":"${d}"`);
    expect(existsSync(PROPOSAL_DIR(root))).toBe(true);
  });

  it('UT-S46-34: archive 账本核对的适用范围', () => {
    // ① 未开启人工验收、D 无 manual 记录：判据不变，归档成功
    const off = manualProject(cleanups, { prodManual: null });
    deployDone(off);
    expect(smokeJson(off).status).toBe(0);
    expect(archiveRun(off).status).toBe(0);
    // ② 开启、D 无 manual 记录、P 为空、D 有自己的 manual_passed 记录：归档成功
    const empty = manualProject(cleanups, { manualRows: [], manualSmoke: [] });
    deployDone(empty);
    const s = smokeJson(empty);
    expect(s.out.data.gate.result).toBe('PASS');
    expect(lastSmoke(empty).manual_passed).toBe(true);
    expect(archiveRun(empty).status).toBe(0);
    // ③ 开启、D 无 manual 记录、SMOKE_PASS 在场但账本无 D 自己的通过记录：拒绝
    const forged = manualProject(cleanups);
    deployDone(forged);
    writeFileSync(join(PROPOSAL_DIR(forged), 'SMOKE_PASS'), '');
    const r = archiveRun(forged);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('smoke_pass_expired');
  });
});

describe('S46 场景（smoke-manual-acceptance）', () => {
  it('ST-S46-01: 开启 → 等待 → 记录 → 通过（提案通道，真实 CLI）', () => {
    const { root, d, s } = pendingProposal();
    expect(s.status).toBe(1);
    expect(s.out.data.gate.result).toBe('PENDING');
    const n = nextJson(root).out.data;
    expect(n.proposal_step).toBe('awaiting-manual-acceptance');
    expect(n.auto_execute).toBeFalsy();
    expect(n.command).toContain(`--deploy ${d}`);
    const a = acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05,SMOKE-core-901', '--result', 'pass']);
    expect(a.out.data.remaining).toEqual([]);
    const s2 = smokeJson(root);
    expect(s2.status).toBe(0);
    expect(markers(root)).toEqual(['SMOKE_PASS']);
    // 评审 code-r1 F3：人工用例只在中文路径规格中、未配置回归 ID、自动阶段通过——首次 smoke 必须 PENDING 并列出它
    const zh = manualProject(cleanups, { proposal: false, manualRows: [], manualSmoke: [] });
    git(zh, ['config', 'core.quotepath', 'true']);
    put(zh, 'logos/resources/test/中文模块/core-S09-测试用例.md', '# core-S09\n\n| ID | 描述 | 前置 | 操作 | 预期 |\n|---|---|---|---|---|\n| ST-S09-901 [manual] | 中文路径 | 实机 | 操作 | 正常 |\n');
    git(zh, ['add', '-A']); git(zh, ['commit', '-qm', 'zh path spec']);
    ledgerDeploy(zh, 'prod', 'd1', head(zh));
    const z = smokeJson(zh);
    expect(z.out.data.gate.result).toBe('PENDING');
    expect(z.out.data.manual_acceptance.pending).toEqual(['ST-S09-901']);
    expect(ledgerRows(zh).filter(x => x.kind === 'smoke' && x.manual_passed === true)).toEqual([]);
    expect(lastSmoke(root)).toMatchObject({ result: 'pass', manual_passed: true });
    expect(archiveRun(root).status).toBe(0);
  });

  it('ST-S46-02: 人工用例失败', () => {
    const { root, d } = pendingProposal();
    acceptJson(root, ['--deploy', d, '--case', 'SMOKE-core-901', '--result', 'fail', '--note', '首启白屏']);
    acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05', '--result', 'pass']);
    const r = smokeJson(root);
    expect(r.out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_cases_failed' });
    expect(markers(root)).toEqual(['SMOKE_FAIL']);
    const report = readFileSync(join(root, r.out.data.report_path), 'utf-8');
    expect(report).toContain('| SMOKE-core-901 | 首启白屏 |');
    expect(archiveRun(root).status).toBe(1);
  });

  it('ST-S46-03: 重新部署后旧结果作废', () => {
    const { root, d } = pendingProposal();
    acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05', '--result', 'pass']);
    const d2 = deployDone(root);
    expect(d2).not.toBe(d);
    const r = smokeJson(root).out.data.manual_acceptance;
    expect(r.pending).toContain('ST-S01-05');
    expect(r.remaining).toContain('ST-S01-05');
    expect(acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05', '--result', 'pass']).err.error.code).toBe('ACCEPT_DEPLOY_CHANGED');
  });

  it('ST-S46-04: 不部署提案的人工用例被累积', () => {
    const root = versionProject({}, 'd1');
    ledgerManual(root, 'prod', 'd1', 'ST-S01-05');
    ledgerManual(root, 'prod', 'd1', 'SMOKE-core-901');
    expect(smokeJson(root).out.data.gate.result).toBe('PASS');
    // 提案 A 新增 ST-S01-08 后归档、未部署（只合并进规格）；随后提案 B 部署
    put(root, S01_SPEC, `# core-S01\n\n| ID | 描述 | 前置 | 操作 | 预期 |\n|---|---|---|---|---|\n${ST05}\n${ST08}\n`);
    git(root, ['add', '-A']); git(root, ['commit', '-qm', 'proposal A merged (not deployed)']);
    put(root, 'README.md', 'proposal B\n');
    git(root, ['add', '-A']); git(root, ['commit', '-qm', 'proposal B']);
    ledgerDeploy(root, 'prod', 'd2', head(root));
    const ma = smokeJson(root).out.data.manual_acceptance;
    expect(ma.pending).toEqual(['ST-S01-08']);
  });

  it('ST-S46-05: 关闭环境只列出不阻断', () => {
    const root = manualProject(cleanups);
    deployDone(root, 'test');
    const r = smokeJson(root, 'test');
    expect(r.out.data.gate.result).toBe('PASS');
    expect(markers(root)).toEqual(['SMOKE_PASS']);
    expect(r.out.data.manual_acceptance.unexecuted).toEqual(['SMOKE-core-901', 'ST-S01-05']);
    expect(readFileSync(join(root, r.out.data.report_path), 'utf-8')).toContain('未执行的人工用例 2 条');
    expect(ledgerRows(root).some(x => x.result === 'pending')).toBe(false);

    // 评审 code-r1 F5：上次部署没有人工用例，本次部署 R 新增 X；从没有 X（也没有任何人工用例）的分支运行同一部署的 smoke
    const sw = manualProject(cleanups, { proposal: false, manualRows: [], manualSmoke: [] });
    const c0 = head(sw);
    ledgerDeploy(sw, 'test', 't0', c0);
    put(sw, S01_SPEC, `# core-S01\n\n| ID | 描述 | 前置 | 操作 | 预期 |\n|---|---|---|---|---|\n${ST05}\n`);
    git(sw, ['add', '-A']); git(sw, ['commit', '-qm', 'add X']);
    const c1 = head(sw);
    ledgerDeploy(sw, 'test', 't1', c1);
    for (const checkout of [c0, c1]) {
      git(sw, ['checkout', '-q', checkout]);
      const rr = smokeJson(sw, 'test');
      expect(rr.out.data.gate.result, checkout).toBe('PASS');
      expect(rr.out.data.manual_acceptance.unexecuted, checkout).toEqual(['ST-S01-05']);
      expect(readFileSync(join(sw, rr.out.data.report_path), 'utf-8'), checkout).toContain('未执行的人工用例 1 条');
    }

    // 评审 code-r2 F5：全人工项目（无 runner、无结果文件），上次部署没有人工用例，本次部署 R 只新增人工 SMOKE X；
    // 从没有 X 的上一提交运行同一部署的 smoke，不得在读取部署清单前以 NO_SMOKE_RESULTS 退出
    const mo = manualProject(cleanups, { proposal: false, manualOnly: true, manualRows: [], manualSmoke: [] });
    const m0 = head(mo);
    ledgerDeploy(mo, 'test', 'm0', m0);
    put(mo, SMOKE_SPEC, '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 [manual] | 实机确认 |\n');
    git(mo, ['add', '-A']); git(mo, ['commit', '-qm', 'add manual smoke X']);
    const m1 = head(mo);
    ledgerDeploy(mo, 'test', 'm1', m1);
    for (const checkout of [m0, m1]) {
      git(mo, ['checkout', '-q', checkout]);
      expect(existsSync(join(mo, 'logos/resources/verify/smoke-results.jsonl')), checkout).toBe(false);
      const rr = smokeJson(mo, 'test');
      expect(rr.err?.error?.code ?? null, `${checkout} ${rr.stderr}`).toBeNull();
      expect(rr.out.data.gate.result, checkout).toBe('PASS');
      expect(rr.out.data.manual_acceptance.unexecuted, checkout).toEqual(['SMOKE-core-901']);
      expect(readFileSync(join(mo, rr.out.data.report_path), 'utf-8'), checkout).toContain('未执行的人工用例 1 条');
    }

    // 评审 code-r3 F5：登记表各环境都不配置 deploy、部署只经真实 deploy-done 登记（账本行无 channel，部署执行未启用）；
    // 提案结束后（无活跃提案）从缺少 X 的上一提交运行同一部署的 smoke
    const dd = manualProject(cleanups, { manualOnly: true, manualRows: [], manualSmoke: [] });
    put(dd, 'logos/environments.yaml', 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test, aliases: [测试]}\n  - {id: prod, name: Production, tier: prod, aliases: [生产], manual_acceptance: {enabled: true}}\n');
    // 提案目录与 guard 不入库（模拟归档后提案不随提交切换出现），使跨提交检出不受提案标记影响
    put(dd, '.git/info/exclude', 'logos/changes/\nlogos/.openlogos-guard\n');
    git(dd, ['rm', '-r', '-q', '--cached', 'logos/changes', 'logos/.openlogos-guard']);
    git(dd, ['add', '-A']); git(dd, ['commit', '-qm', 'registry without deploy']);
    const d0 = head(dd);
    deployDone(dd, 'test');
    put(dd, SMOKE_SPEC, '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 [manual] | 实机确认 |\n');
    git(dd, ['add', '-A']); git(dd, ['commit', '-qm', 'add manual smoke X']);
    const d1 = head(dd);
    deployDone(dd, 'test');
    expect(ledgerRows(dd).filter(x => x.kind === 'deploy').every(x => x.channel === undefined)).toBe(true);
    rmSync(join(dd, 'logos/.openlogos-guard'), { force: true });
    rmSync(PROPOSAL_DIR(dd), { recursive: true, force: true });
    const ledgerBefore = ledgerRows(dd).length;
    for (const checkout of [d0, d1]) {
      git(dd, ['checkout', '-q', checkout]);
      expect(existsSync(join(dd, 'logos/resources/verify/smoke-results.jsonl')), checkout).toBe(false);
      const rr = smokeJson(dd, 'test');
      expect(rr.err?.error?.code ?? null, `${checkout} ${rr.stderr}`).toBeNull();
      expect(rr.out.data.gate.result, checkout).toBe('PASS');
      expect(rr.out.data.manual_acceptance.unexecuted, checkout).toEqual(['SMOKE-core-901']);
      expect(readFileSync(join(dd, rr.out.data.report_path), 'utf-8'), checkout).toContain('未执行的人工用例 1 条');
    }
    // 部署执行未启用、无活跃提案：smoke 不追加账本行（既有约束不变）
    expect(ledgerRows(dd).length).toBe(ledgerBefore);
  });

  it('ST-S46-06: 清单无法确定时不签发通过', () => {
    const root = manualProject(cleanups, { proposal: false });
    ledgerDeploy(root, 'prod', 'd1', null);
    // 工作区切到缺少 ST-S01-05 的分支
    git(root, ['checkout', '-qb', 'no-st05']);
    put(root, S01_SPEC, '# core-S01\n\n| ID | 描述 |\n|---|---|\n');
    git(root, ['add', '-A']); git(root, ['commit', '-qm', 'drop st05']);
    const r = smokeJson(root);
    expect(r.out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_scope_unresolved' });
    expect(manualBaselineOf(readDeploymentLedger(root).byEnvironment.get('prod'))).toBeNull();
    // 浅克隆夹具（R 不可读）结果相同
    const shallow = manualProject(cleanups, { proposal: false });
    ledgerDeploy(shallow, 'prod', 'd1', 'e'.repeat(40));
    expect(smokeJson(shallow).out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_scope_unresolved' });
  });

  it('ST-S46-07: 回归用例失效时不能通过', () => {
    const root = versionProject({ prodManual: '{enabled: true, regression: [SMOKE-core-901, ST-S01-99]}' });
    ledgerManual(root, 'prod', 'd1', 'SMOKE-core-901');
    ledgerManual(root, 'prod', 'd1', 'ST-S01-05');
    const r = smokeJson(root).out.data;
    expect(r.gate).toEqual({ result: 'FAIL', reason: 'manual_regression_unresolved' });
    expect(r.manual_acceptance.regression_unresolved).toEqual(['ST-S01-99']);
    const yaml = readFileSync(join(root, 'logos/environments.yaml'), 'utf-8').replace(', ST-S01-99]', ']');
    writeFileSync(join(root, 'logos/environments.yaml'), yaml);
    expect(smokeJson(root).out.data.gate.result).toBe('PASS');
  });

  it('ST-S46-08: 通过后更正为失败：顺序与交错两种执行', async () => {
    // 顺序
    const { root, d } = pendingProposal({ prodManual: '{enabled: true, regression: [SMOKE-core-901]}' });
    acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05,SMOKE-core-901', '--result', 'pass']);
    smokeJson(root);
    acceptJson(root, ['--deploy', d, '--case', 'SMOKE-core-901', '--result', 'fail', '--note', '回归失败']);
    let r = archiveRun(root);
    expect(r.stderr).toContain('ARCHIVE_SMOKE_NOT_PASSED');
    expect(nextJson(root).out.data.proposal_step).toBe('ready-to-smoke');
    // 交错：重跑暂停在 PASS 账本追加之后 → 失败更正 → 恢复写回 SMOKE_PASS → 直接 archive
    const p2 = pendingProposal({ prodManual: '{enabled: true, regression: [SMOKE-core-901]}' });
    acceptJson(p2.root, ['--deploy', p2.d, '--case', 'ST-S01-05,SMOKE-core-901', '--result', 'pass']);
    await inProcess(p2.root, () => smoke('json', 'prod', {
      afterLedgerAppend: () => ledgerManual(p2.root, 'prod', p2.d, 'SMOKE-core-901', 'fail', '回归失败'),
    }));
    expect(markers(p2.root)).toEqual(['SMOKE_PASS']);
    r = archiveRun(p2.root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('smoke_pass_expired');
    const n = nextJson(p2.root).out.data;
    expect(n.proposal_step).toBe('ready-to-smoke');
  });

  it('ST-S46-09: 多次重跑后从账本恢复等待状态（两种通道）', () => {
    // 提案通道
    const { root, d } = pendingProposal();
    acceptJson(root, ['--deploy', d, '--case', 'SMOKE-core-901', '--result', 'pass']);
    expect(smokeJson(root).out.data.gate.result).toBe('PENDING');
    expect(lastSmoke(root).manual_pending).toEqual(['ST-S01-05']);
    acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05', '--result', 'pass']);
    const n = nextJson(root).out.data;
    expect(n.proposal_step).toBe('awaiting-manual-acceptance');
    expect(n.manual_acceptance.remaining).toEqual([]);
    expect(n.command).toBe('openlogos smoke --env prod');
    // 版本通道
    const v = versionProject();
    acceptJson(v, ['--deploy', 'd1', '--case', 'SMOKE-core-901', '--result', 'pass']);
    smokeJson(v);
    expect(lastSmoke(v).manual_pending).toEqual(['ST-S01-05']);
    acceptJson(v, ['--deploy', 'd1', '--case', 'ST-S01-05', '--result', 'pass']);
    expect(cli(v, ['env', 'show', 'prod', '--format', 'json']).out.data.manual_acceptance.waiting).toEqual({ deploy_id: 'd1', remaining: [] });
  });

  it('ST-S46-10: 只有人工用例的项目', () => {
    const root = manualProject(cleanups, { manualOnly: true, manualRows: [] });
    const d = deployDone(root);
    const s1 = smokeJson(root);
    expect(s1.status).toBe(1);
    expect(s1.out.data.gate.result).toBe('PENDING');
    acceptJson(root, ['--deploy', d, '--case', 'SMOKE-core-901', '--result', 'pass']);
    const s2 = smokeJson(root);
    expect(s2.status, s2.stderr).toBe(0);
    expect(s2.out.data.gate.result).toBe('PASS');
    expect(lastSmoke(root)).toMatchObject({ result: 'pass', verified: false, manual_passed: true });
  });

  it('ST-S46-11: 重新部署后旧部署的 smoke 写回通过标记', async () => {
    const { root, d } = pendingProposal({ prodManual: '{enabled: true, regression: [SMOKE-core-901]}' });
    acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05,SMOKE-core-901', '--result', 'pass']);
    let d2 = '';
    await inProcess(root, () => smoke('json', 'prod', { afterLedgerAppend: () => { d2 = deployDone(root); } }));
    expect(d2).not.toBe('');
    expect(markers(root)).toEqual(['SMOKE_PASS']);
    const r = archiveRun(root);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('smoke_pass_expired');
    // D2 自己完成 smoke：X 重新等待，记录并重跑通过后归档成功
    const s = smokeJson(root);
    expect(s.out.data.gate.result).toBe('PENDING');
    expect(s.out.data.manual_acceptance.remaining).toContain('SMOKE-core-901');
    acceptJson(root, ['--deploy', d2, '--case', s.out.data.manual_acceptance.remaining.join(','), '--result', 'pass']);
    expect(smokeJson(root).status).toBe(0);
    expect(archiveRun(root).status).toBe(0);
  });

  it('ST-S46-12: 首次通过后更正普通用例（无回归配置，提案通道）', () => {
    const { root, d } = pendingProposal();
    acceptJson(root, ['--deploy', d, '--case', 'ST-S01-05,SMOKE-core-901', '--result', 'pass']);
    expect(smokeJson(root).status).toBe(0);
    const a = acceptJson(root, ['--deploy', d, '--case', 'SMOKE-core-901', '--result', 'fail', '--note', '白屏']);
    expect(a.status, a.stderr).toBe(0);
    expect(a.out.data.expired_pass).toBe(true);
    expect(markers(root)).toEqual([]);
    expect(archiveRun(root).stderr).toContain('ARCHIVE_SMOKE_NOT_PASSED');
    expect(smokeJson(root).out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_cases_failed' });
  });

  it('ST-S19-41: 真实 CLI：全人工项目走通等待、记录与重跑', () => {
    const root = manualProject(cleanups, { manualOnly: true, manualRows: [] });
    const d = deployDone(root);
    expect(existsSync(join(root, 'logos/resources/verify/smoke-results.jsonl'))).toBe(false);
    const s1 = smokeJson(root);
    expect(s1.out.data.gate.result).toBe('PENDING');
    expect(lastSmoke(root).result).toBe('pending');
    acceptJson(root, ['--deploy', d, '--case', 'SMOKE-core-901', '--result', 'pass']);
    const s2 = smokeJson(root);
    expect(s2.out.data.gate.result).toBe('PASS');
    expect(markers(root)).toEqual(['SMOKE_PASS']);
    expect(lastSmoke(root)).toMatchObject({ manual_passed: true, verified: false });
  });
});
