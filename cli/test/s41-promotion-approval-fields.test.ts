/**
 * environment-promotion-approval 切片 1：登记表门禁字段校验与审批账本视图（S41）。
 *
 * 覆盖 UT-S41-16～UT-S41-19、ST-S41-05（logos/resources/test/core-S41-test-cases.md）。
 * 规范源：spec/environments.md §2.2、§5.2、§5.4、§7.1、§12.1、§12.8，决策 C07、C08，review delta-r1 F1 / F2。
 * 审批与 smoke 记录由测试直接写入账本构造（本片不新增任何账本写入方）；UT 以进程内调用驱动，
 * UT-S41-19 与 ST-S41-05 走真实 CLI 入口 cli/dist/index.js。全部在一次性临时项目中构造。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { captureConsole, makeTempRoot, scaffoldProject, takeExitCode } from './helpers.js';
import {
  DEPLOY_LEDGER_REL, ENV_REGISTRY_REL, buildEnvView, isDeployExecutionEnabled, isGatedEnvironment, loadEnvironmentRegistry,
  readDeploymentLedger,
} from '../src/lib/environments.js';
import { envCheck, envShow } from '../src/commands/env.js';
// @ts-expect-error 夹具为 ESM .mjs（与基线生成脚本共用），无类型声明
import { observeGateFixtures } from './golden/s41-gate-zero-regression-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const REPO = resolve(HERE, '../..');
const BASELINE = join(HERE, 'golden', 's41-gate-zero-regression-baseline.json');
const R0 = '0'.repeat(40);
const X = 'a'.repeat(40);
const Y = 'b'.repeat(40);
const GATE_KEYS = ['promote_from', 'require_approval', 'open_approvals', 'promotion'];

let root: string;
let cleanup: () => void;

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  scaffoldProject(root, { locale: 'en' });
});
afterEach(() => cleanup());

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

/** 登记表：test（无 deploy）、staging、prod（均配置 deploy）；extra 为各环境追加的 YAML 行（缩进 4）。 */
function registry(extra: { test?: string[]; staging?: string[]; prod?: string[] } = {}): void {
  const lines = (xs: string[] = []) => xs.map(l => `    ${l}\n`).join('');
  put(ENV_REGISTRY_REL, `schema_version: 1
environments:
  - id: test
    name: Test
    tier: test
${lines(extra.test)}  - id: staging
    name: Staging
    tier: staging
    aliases: [预发]
    deploy: {mode: script, script: deploy/staging.sh}
${lines(extra.staging)}  - id: prod
    name: Production
    tier: prod
    aliases: [生产]
    deploy: {mode: script, script: deploy/prod.sh}
${lines(extra.prod)}`);
}

function ledger(lines: Array<Record<string, unknown> | string>): void {
  put(DEPLOY_LEDGER_REL, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

let seq = 0;
const at = () => `2026-10-15T00:00:${String(++seq % 60).padStart(2, '0')}.000Z`;

function approval(env: string, id: string, ref: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'approval', environment: env, slug: null, recorded_at: at(), observed_head: R0, observed_dirty: false,
    approval_id: id, ref, ref_input: 'v1', approver: 'Alice <alice@example.invalid>', note: null, ...extra,
  };
}

/** openlogos deploy 写出的扩展记录。 */
function deploy(env: string, id: string, result: 'done' | 'failed' | 'unknown', requested: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const ref = result === 'done' ? requested : null;
  return {
    kind: 'deploy', environment: env, slug: null, recorded_at: at(), observed_head: R0, observed_dirty: false,
    deploy_id: id, ref, ref_source: ref === null ? 'unknown' : 'explicit', result,
    channel: 'version', mode: 'script', ref_input: 'v1', ref_requested: requested, rollback: false, rollback_from: null,
    duration_ms: null, ci_run_id: null, ci_run_url: null, ci_reported_ref: null,
    failure_reason: result === 'failed' ? 'exit-code' : (result === 'unknown' ? 'ci-observe-timeout' : null),
    log_path: null, reconciled: false, ...extra,
  };
}

function smoke(env: string, ref: string, verified: boolean): Record<string, unknown> {
  return {
    kind: 'smoke', environment: env, slug: null, recorded_at: at(), observed_head: R0, observed_dirty: false,
    deploy_id: `d-${env}`, ref, result: 'pass', env_evidence: verified ? 'declared' : 'missing',
    fresh_results: true, deploy_env_confirmed: true, verified,
  };
}

function runJson(fn: () => void): any {
  const con = captureConsole();
  try {
    fn();
    return JSON.parse(con.logs[con.logs.length - 1]).data;
  } finally {
    con.restore();
    takeExitCode();
  }
}

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf-8', timeout: 60_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

async function statusSchemaValidator(): Promise<(data: unknown) => { ok: boolean; errors: string }> {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  const ajv = new Ajv2020({ strict: false, allowUnionTypes: true });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(readFileSync(join(REPO, 'spec', 'schema', 'status.schema.json'), 'utf-8')));
  return data => ({ ok: validate(data) as boolean, errors: JSON.stringify(validate.errors) });
}

/** 当前登记表与账本下某环境的 open_approvals 的 approval_id 序列。 */
function openIds(envId: string): string[] {
  const reg = loadEnvironmentRegistry(root);
  if (reg.state !== 'loaded') throw new Error('registry not loaded');
  const env = reg.environments.find(e => e.id === envId)!;
  const snap = readDeploymentLedger(root);
  return (buildEnvView(env, snap, { deployEnabled: isDeployExecutionEnabled(reg.environments, snap) }).open_approvals ?? []).map(a => a.approval_id);
}

describe('S41 晋级与审批门禁字段 — 单元测试（environment-promotion-approval）', () => {
  it('UT-S41-16: promote_from / require_approval 校验', async () => {
    const check = async (): Promise<{ exit: unknown; data: any }> => {
      const con = captureConsole();
      try { await envCheck(undefined, {}, 'json', root); } finally { con.restore(); }
      return { exit: takeExitCode(), data: JSON.parse(con.logs.join('\n')).data };
    };

    // ①⑩ 合法：无 error、无 ENV_UNKNOWN_FIELD
    const valid: Array<[string, Parameters<typeof registry>[0]]> = [
      ['①', { prod: ['promote_from: staging', 'require_approval: true'] }],
      ['⑩', { prod: ["'promote_from': staging"] }],
    ];
    for (const [label, extra] of valid) {
      registry(extra);
      const reg = loadEnvironmentRegistry(root);
      expect(reg.state, label).toBe('loaded');
      if (reg.state !== 'loaded') continue;
      expect(reg.errors, label).toEqual([]);
      expect(reg.warnings.filter(w => w.code === 'ENV_UNKNOWN_FIELD'), label).toEqual([]);
      const prod = reg.environments.find(e => e.id === 'prod')!;
      expect(prod.gate?.promote_from, label).toBe('staging');
      expect(isGatedEnvironment(prod), label).toBe(true);
      const r = await check();
      expect(r.exit, label).toBeUndefined();
      expect(r.data.errors, label).toEqual([]);
    }
    // 只写 require_approval: false 且未配置 promote_from 不是受门环境
    registry({ prod: ['require_approval: false'] });
    const off = loadEnvironmentRegistry(root);
    expect(off.state === 'loaded' && off.errors).toEqual([]);
    expect(off.state === 'loaded' && isGatedEnvironment(off.environments.find(e => e.id === 'prod')!)).toBe(false);

    // ②～⑨ 非法：ENV_FIELD_INVALID，登记表判为非法
    const invalid: Array<[string, Parameters<typeof registry>[0], Array<[string, string]>, RegExp?]> = [
      ['② 未登记', { prod: ['promote_from: stage'] }, [['prod', 'promote_from']], /unregistered/],
      ['③ alias 而非 id', { prod: ['promote_from: 生产'] }, [['prod', 'promote_from']], /not an alias/],
      ['④ 指向自身', { prod: ['promote_from: prod'] }, [['prod', 'promote_from']], /itself/],
      ['⑤ 成环', { staging: ['promote_from: prod'], prod: ['promote_from: staging'] }, [['staging', 'promote_from'], ['prod', 'promote_from']], /cycle/],
      ['⑥ 未配置 deploy', { test: ['require_approval: true'] }, [['test', 'require_approval']], /deploy/],
      ['⑦ 类型非法（字符串）', { prod: ['require_approval: "yes"'] }, [['prod', 'require_approval']], /boolean/],
      ['⑧ 类型非法（数字）', { prod: ['promote_from: 3'] }, [['prod', 'promote_from']]],
      ['⑨ 转义键', { prod: ['"require_\\u0061pproval": true'] }, [['prod', 'require_approval']], /plain key/],
    ];
    for (const [label, extra, expected, reason] of invalid) {
      registry(extra);
      if (label.startsWith('⑨')) {
        const text = readFileSync(join(root, ENV_REGISTRY_REL), 'utf-8');
        expect(text.includes('require_approval'), '原文不含字段名字面量').toBe(false);
      }
      const reg = loadEnvironmentRegistry(root);
      expect(reg.state, label).toBe('loaded');
      if (reg.state !== 'loaded') continue;
      const issues = reg.errors.filter(e => e.code === 'ENV_FIELD_INVALID');
      expect(issues.map(e => [e.environment, e.field]), label).toEqual(expected);
      expect(reg.errors.length, label).toBe(expected.length);
      if (reason) expect(issues.every(e => reason.test(e.reason)), `${label}: ${JSON.stringify(issues)}`).toBe(true);
      expect(reg.warnings.filter(w => w.code === 'ENV_UNKNOWN_FIELD'), label).toEqual([]);
      const r = await check();
      expect(r.exit, label).toBe(1);
      expect(r.data.errors.map((e: any) => [e.code, e.environment, e.field]), label).toEqual(expected.map(([env, field]) => ['ENV_FIELD_INVALID', env, field]));
      // 登记表非法 → list / show fail-closed
      const show = cli(['env', 'show', 'prod', '--format', 'json']);
      expect(show.status, label).toBe(1);
      expect(JSON.parse(show.stderr).error.code, label).toBe('ENV_REGISTRY_INVALID');
    }
  }, 120_000);

  it('UT-S41-17: approval 记录的校验与读取', () => {
    registry({ prod: ['require_approval: true'] });
    const d = deploy('prod', 'd-1', 'done', Y);
    const s = smoke('prod', Y, true);
    const valid = approval('prod', 'ap-1', X);
    const missingId = approval('prod', 'ap-3', X);
    delete missingId.approval_id;
    ledger([
      d, s,
      valid,
      approval('prod', 'ap-2', 'abcdef1'),
      missingId,
      approval('prod', 'ap-4', X, { approver: 42 }),
      approval('prod', 'ap-5', X, { reviewer: 'bob' }),
    ]);
    const snap = readDeploymentLedger(root);
    expect(snap.corruptLines).toBe(3);
    const state = snap.byEnvironment.get('prod')!;
    expect(state.openApprovals.map(a => a.approval_id)).toEqual(['ap-1', 'ap-5']);
    // 审批记录不进入 last_deploy / last_smoke，不影响 current_ref
    expect(state.lastDeploy?.deploy_id).toBe('d-1');
    expect(state.lastSmoke?.ref).toBe(Y);
    expect(state.currentRef).toBe(Y);

    const show = runJson(() => envShow('prod', 'json', root));
    expect(show.last_deploy.deploy_id).toBe('d-1');
    expect(show.last_smoke.ref).toBe(Y);
    expect(show.ledger.corrupt_lines).toBe(3);
    expect(show.history.map((h: any) => [h.kind, h.approval_id ?? h.deploy_id ?? h.ref])).toEqual([
      ['approval', 'ap-5'], ['approval', 'ap-1'], ['smoke', 'd-prod'], ['deploy', 'd-1'],
    ]);
    expect(show.history[1]).toEqual({
      kind: 'approval', approval_id: 'ap-1', slug: null, ref: X, ref_input: 'v1', approver: 'Alice <alice@example.invalid>', note: null,
      observed_head: R0, observed_dirty: false, recorded_at: valid.recorded_at,
    });
  });

  it('UT-S41-18: 审批使用推导', () => {
    registry({ prod: ['require_approval: true'] });
    const a1 = approval('prod', 'A1', X);
    const a2 = approval('prod', 'A2', Y, { note: '周末窗口' });
    const a3 = approval('prod', 'A3', X);
    const seqA = [
      a1,
      deploy('prod', 'D0', 'failed', X),
      deploy('prod', 'D1', 'unknown', X),
      a2,
      deploy('prod', 'D1', 'done', X, { reconciled: true }),
      a3,
    ];
    const expected = [['A1'], ['A1'], ['A1'], ['A1', 'A2'], ['A2'], ['A2', 'A3']];
    for (let i = 0; i < seqA.length; i++) {
      ledger(seqA.slice(0, i + 1));
      // failed / unknown 之后 A1 仍未使用；D1 补记为 done 后 A1 已使用；A2（对 Y）不因 X 的部署被使用
      expect(openIds('prod'), `前 ${i + 1} 行`).toEqual(expected[i]);
    }
    const show = runJson(() => envShow('prod', 'json', root));
    expect(show.open_approvals).toEqual([
      { approval_id: 'A2', ref: Y, approver: 'Alice <alice@example.invalid>', note: '周末窗口', recorded_at: a2.recorded_at },
      { approval_id: 'A3', ref: X, approver: 'Alice <alice@example.invalid>', note: null, recorded_at: a3.recorded_at },
    ]);

    // 另一序列：成功使用后 abandon 不撤销（单向事实，review delta-r1 F1）
    ledger([
      approval('prod', 'B1', X),
      deploy('prod', 'D2', 'done', X),
      deploy('prod', 'D2', 'unknown', X, { failure_reason: 'abandoned' }),
    ]);
    expect(openIds('prod')).toEqual([]);
    expect(readDeploymentLedger(root).corruptLines).toBe(0);
  });

  it('UT-S41-19: EnvView 新字段只在配置了门的环境上输出', async () => {
    registry({ prod: ['promote_from: staging', 'require_approval: true'] });
    ledger([
      smoke('staging', X, true),
      smoke('staging', Y, false),
      approval('prod', 'P1', X),
    ]);
    const list = cli(['env', 'list', '--format', 'json']);
    const show = cli(['env', 'show', 'prod', '--format', 'json']);
    const st = cli(['status', '--format', 'json']);
    for (const r of [list, show, st]) expect(r.status, r.stderr).toBe(0);
    const listData = JSON.parse(list.stdout).data;
    const showData = JSON.parse(show.stdout).data;
    const statusData = JSON.parse(st.stdout).data;

    const pick = (o: any) => Object.fromEntries(GATE_KEYS.map(k => [k, o[k]]));
    const listProd = listData.environments.find((e: any) => e.id === 'prod');
    const statusProd = statusData.environments.find((e: any) => e.id === 'prod');
    const expectedGate = {
      promote_from: 'staging',
      require_approval: true,
      open_approvals: [{ approval_id: 'P1', ref: X, approver: 'Alice <alice@example.invalid>', note: null, recorded_at: expect.any(String) }],
      promotion: { from: 'staging', candidate_ref: X }, // 只认 verified=true（Y 更晚但未验证）
    };
    expect(pick(listProd)).toEqual(expectedGate);
    expect(pick(showData)).toEqual(pick(listProd));
    expect(pick(statusProd)).toEqual(pick(listProd));

    // staging 只配置 deploy、test 无 deploy：不含四个字段
    for (const envs of [listData.environments, statusData.environments]) {
      for (const id of ['staging', 'test']) {
        const view = envs.find((e: any) => e.id === id);
        for (const k of GATE_KEYS) expect(view, `${id}.${k}`).not.toHaveProperty(k);
      }
    }
    const stagingShow = JSON.parse(cli(['env', 'show', 'staging', '--format', 'json']).stdout).data;
    for (const k of GATE_KEYS) expect(stagingShow).not.toHaveProperty(k);

    const v = (await statusSchemaValidator())(statusData);
    expect(v.ok, v.errors).toBe(true);

    // 文本输出：prod 显示晋级上游与未使用审批
    const text = cli(['env', 'show', 'prod']);
    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout).toContain('promotes from staging');
    expect(text.stdout).toContain('approval required; 1 open approval(s)');
    expect(text.stdout).toContain('approval P1');
  }, 120_000);
});

describe('S41 晋级与审批门禁字段 — 场景测试（environment-promotion-approval）', () => {
  it('ST-S41-05: 未配置门禁零回归与 0.16.4 读取兼容', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf-8'));
    const current = observeGateFixtures(CLI);
    const unchanged = ['no-registry', 'registry-without-gates', 'deploy-enabled-without-gates'];
    expect(Object.keys(current)).toEqual([...unchanged, 'approval-ledger']);

    // ① 三种未配置门禁的夹具：输出、退出码、账本字节与提案目录文件与引入前基线逐字一致
    for (const name of unchanged) {
      expect(current[name], `${name} 与引入前基线逐字一致`).toEqual(baseline[name]);
      for (const step of current[name].steps) {
        const text = JSON.stringify(step.stdout ?? '');
        for (const k of GATE_KEYS) expect(text.includes(`"${k}"`), `${name} ${step.args} 不出现 ${k}`).toBe(false);
      }
    }
    expect(current['deploy-enabled-without-gates'].steps.every((s: any) => s.exit === 0)).toBe(true);

    // ② 0.16.4 读取方（基线由 0.16.4 CLI 实测）：审批记录计入 corrupt_lines 并跳过，不抛出，其余记录照常生效
    const old = baseline['approval-ledger'];
    expect(old.steps.map((s: any) => s.exit)).toEqual([0, 0, 0]);
    const [oldStatus, oldList, oldShow] = old.steps.map((s: any) => s.stdout.data);
    expect(oldStatus.environment_ledger.corrupt_lines).toBe(2);
    expect(oldList.ledger.corrupt_lines).toBe(2);
    expect(oldShow.ledger.corrupt_lines).toBe(2);
    expect(oldShow.history.map((h: any) => h.kind)).toEqual(['deploy']);
    expect(oldShow.last_deploy.deploy_id).toBe('d-exec-1');
    expect(oldList.environments.find((e: any) => e.id === 'staging').last_smoke.verified).toBe(true);

    // 当前读取方对同一账本：审批记录有效（进入历史），条目未写门禁字段故视图不出现四个新字段
    const now = current['approval-ledger'];
    const [nowStatus, nowList, nowShow] = now.steps.map((s: any) => s.stdout.data);
    expect(nowStatus.environment_ledger.corrupt_lines).toBe(0);
    expect(nowShow.history.map((h: any) => h.kind)).toEqual(['approval', 'approval', 'deploy']);
    for (const view of [...nowList.environments, ...nowStatus.environments]) {
      for (const k of GATE_KEYS) expect(view).not.toHaveProperty(k);
    }
    // 账本字节两侧一致（读取不改写账本）
    expect(now.ledger).toEqual(old.ledger);
  }, 300_000);
});
