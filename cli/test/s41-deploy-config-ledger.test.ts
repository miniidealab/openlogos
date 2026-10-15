/**
 * environment-deploy 切片 1：登记表 deploy 配置校验与部署记录扩展视图（S41）。
 *
 * 覆盖 UT-S41-12～UT-S41-15、ST-S41-04（logos/resources/test/core-S41-test-cases.md「五、部署配置与部署记录扩展测试」）。
 * 规范源：spec/environments.md §1「部署执行已启用」、§2.2、§5.2、§5.4、§7.1、§11.2，决策 C06、C08、D13。
 * 扩展账本记录由测试直接写入构造（本片不新增任何账本写入方）；UT 以进程内调用驱动，ST 走真实 CLI 入口 cli/dist/index.js。
 * 全部在一次性临时项目中构造。结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { captureConsole, makeTempRoot, scaffoldProject, takeExitCode } from './helpers.js';
import {
  DEPLOY_LEDGER_REL, DEPLOY_LOCKS_REL, DEPLOY_PENDING_REL, ENV_REGISTRY_REL, buildEnvView, isDeployExecutionEnabled,
  loadEnvironmentRegistry, previousRefOf, readDeploymentLedger,
} from '../src/lib/environments.js';
import { envList, envShow } from '../src/commands/env.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const R0 = '0'.repeat(40);
const R1 = '1'.repeat(40);
const R2 = '2'.repeat(40);
const R3 = '3'.repeat(40);

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

/** 登记表：prod 的 deploy 段以缩进 6 的 YAML 文本给出；test 不配置 deploy。 */
function registryWithDeploy(deployYaml: string | null): void {
  const prod = deployYaml === null ? '' : `    deploy:\n${deployYaml.split('\n').filter(Boolean).map(l => `      ${l}`).join('\n')}\n`;
  put(ENV_REGISTRY_REL, `schema_version: 1
environments:
  - id: test
    name: Test
    tier: test
  - id: prod
    name: Production
    tier: prod
${prod}`);
}

function ledger(lines: Array<Record<string, unknown> | string>): void {
  put(DEPLOY_LEDGER_REL, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

let seq = 0;
/** deploy-done 写出的旧形态记录。 */
function legacyDeploy(env: string, ref: string | null, id = `legacy-${++seq}`): Record<string, unknown> {
  return {
    kind: 'deploy', environment: env, slug: 'chg', recorded_at: '2026-10-15T00:00:00.000Z', observed_head: R0, observed_dirty: false,
    deploy_id: id, ref, ref_source: ref === null ? 'unknown' : 'explicit', result: 'done',
  };
}

/** openlogos deploy 写出的扩展记录。 */
function execDeploy(env: string, result: 'done' | 'failed' | 'unknown', ref: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'deploy', environment: env, slug: null, recorded_at: '2026-10-15T01:00:00.000Z', observed_head: R0, observed_dirty: false,
    deploy_id: `exec-${++seq}`, ref, ref_source: ref === null ? 'unknown' : 'explicit', result,
    channel: 'version', mode: 'script', ref_input: 'v1', ref_requested: ref ?? R3, rollback: false, rollback_from: null,
    duration_ms: 1200, ci_run_id: null, ci_run_url: null, ci_reported_ref: null,
    failure_reason: result === 'failed' ? 'exit-code' : (result === 'unknown' ? 'ci-observe-timeout' : null),
    log_path: 'logos/.openlogos-runtime/deploy-logs/x.log', reconciled: false,
    ...extra,
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

describe('S41 部署配置与部署记录扩展 — 单元测试（environment-deploy）', () => {
  it('UT-S41-12: 登记表 deploy 字段校验', () => {
    const valid: Array<[string, string]> = [
      ['① script', 'mode: script\nscript: deploy/prod.sh\nargs: ["{env}", "{ref}"]\ntimeout_sec: 600'],
      ['② ci github-actions', 'mode: ci\nprovider: github-actions\nworkflow: deploy.yml\nworkflow_ref: main\ninputs: { environment: "{env}", sha: "{ref_short}" }'],
      ['③ ci provider script', 'mode: ci\nprovider: script\ntrigger_script: deploy/ci-trigger.sh\nstatus_script: deploy/ci-status.sh'],
      ['④ agent', 'mode: agent\nplan_section: 生产环境部署'],
    ];
    for (const [label, yaml] of valid) {
      registryWithDeploy(yaml);
      const reg = loadEnvironmentRegistry(root);
      expect(reg.state, label).toBe('loaded');
      if (reg.state !== 'loaded') continue;
      expect(reg.errors, label).toEqual([]);
      expect(reg.warnings, label).toEqual([]);
      expect(reg.environments.find(e => e.id === 'prod')!.deploy, label).toBeDefined();
      expect(reg.environments.find(e => e.id === 'test')!.deploy, `${label} test 未配置`).toBeUndefined();
    }

    const invalid: Array<[string, string, string]> = [
      ['⑤ 缺 mode', 'script: deploy/prod.sh', 'deploy.mode'],
      ['⑥ mode: shell', 'mode: shell', 'deploy.mode'],
      ['⑦ 绝对路径', 'mode: script\nscript: /usr/local/bin/deploy.sh', 'deploy.script'],
      ['⑧ 含 ..', 'mode: script\nscript: deploy/../../outside.sh', 'deploy.script'],
      ['⑨ args 含数字', 'mode: script\nscript: deploy/prod.sh\nargs: ["{env}", 3]', 'deploy.args'],
      ['⑩ 未知占位符', 'mode: script\nscript: deploy/prod.sh\nargs: ["{token}"]', 'deploy.args'],
      ['⑪ timeout 超限', 'mode: script\nscript: deploy/prod.sh\ntimeout_sec: 9000', 'deploy.timeout_sec'],
      ['⑫ github-actions 缺 workflow', 'mode: ci\nprovider: github-actions', 'deploy.workflow'],
      ['⑬ agent 缺 plan_section', 'mode: agent', 'deploy.plan_section'],
      ['⑭ 命令字符串字段', 'mode: script\nscript: deploy/prod.sh\nrun: ./deploy.sh', 'deploy.run'],
    ];
    for (const [label, yaml, field] of invalid) {
      registryWithDeploy(yaml);
      const reg = loadEnvironmentRegistry(root);
      expect(reg.state, label).toBe('loaded');
      if (reg.state !== 'loaded') continue;
      expect(reg.errors.map(e => [e.code, e.environment, e.field]), label).toContainEqual(['ENV_FIELD_INVALID', 'prod', field]);
      expect(reg.environments.find(e => e.id === 'prod'), `${label} 非法环境不进入可用列表`).toBeUndefined();
    }

    // ⑮ 未知子字段只警告
    registryWithDeploy('mode: script\nscript: deploy/prod.sh\nowner: ops');
    const reg15 = loadEnvironmentRegistry(root);
    expect(reg15.state).toBe('loaded');
    if (reg15.state === 'loaded') {
      expect(reg15.errors).toEqual([]);
      expect(reg15.warnings.map(w => [w.code, w.field])).toEqual([['ENV_UNKNOWN_FIELD', 'deploy.owner']]);
    }

    // env check 以 JSON 点名非法字段（与加载器同一校验）
    registryWithDeploy('mode: script\nscript: deploy/prod.sh\nrun: ./deploy.sh');
    const r = cli(['env', 'check', '--format', 'json']);
    expect(r.status).toBe(1);
    const data = JSON.parse(r.stdout).data;
    expect(data.ok).toBe(false);
    expect(data.errors).toContainEqual(expect.objectContaining({ code: 'ENV_FIELD_INVALID', environment: 'prod', field: 'deploy.run' }));
  }, 120_000);

  it('UT-S41-13: 扩展 deploy 记录的校验与读取', () => {
    registryWithDeploy(null);
    const legacy = legacyDeploy('prod', R1, 'd-legacy');
    const version = execDeploy('prod', 'done', R2, { deploy_id: 'd-version' });
    const failed = execDeploy('prod', 'failed', null, { deploy_id: 'd-failed' });
    const unknown = execDeploy('prod', 'unknown', null, { deploy_id: 'd-ci', mode: 'ci', ci_run_id: '42', ci_run_url: 'https://ci/42' });
    const reconciled = execDeploy('prod', 'done', R3, {
      deploy_id: 'd-ci', mode: 'ci', ref_source: 'ci-reported', ci_run_id: '42', ci_run_url: 'https://ci/42', ci_reported_ref: R3, reconciled: true,
    });
    const badProposalNullSlug = execDeploy('prod', 'done', R2, { deploy_id: 'bad-6', channel: 'proposal', slug: null });
    const badCiReportedNullRef = execDeploy('prod', 'done', null, { deploy_id: 'bad-7', ref_source: 'ci-reported' });
    const badResult = execDeploy('prod', 'done', R2, { deploy_id: 'bad-8', result: 'pending' });
    ledger([legacy, version, failed, unknown, reconciled, badProposalNullSlug, badCiReportedNullRef, badResult]);

    const snap = readDeploymentLedger(root);
    expect(snap.corruptLines).toBe(3);
    expect(snap.hasDeployExecutionRecords).toBe(true);
    const state = snap.byEnvironment.get('prod')!;
    expect(state.lastDeploy?.deploy_id).toBe('d-ci');
    expect(state.lastDeploy?.reconciled).toBe(true);
    // 同一 deploy_id 以最后一条为准：d-ci 的结论是 reconciled 的 done
    expect(state.currentRef).toBe(R3);

    // env show：历史含 ①～⑤，① 读作 channel=proposal、mode=null，扩展字段齐全
    const show = runJson(() => envShow('prod', 'json', root));
    const deploys = show.history.filter((h: any) => h.kind === 'deploy');
    expect(deploys.map((h: any) => h.deploy_id)).toEqual(['d-ci', 'd-ci', 'd-failed', 'd-version', 'd-legacy']);
    const legacyView = deploys.find((h: any) => h.deploy_id === 'd-legacy');
    expect(legacyView).toMatchObject({ channel: 'proposal', mode: null, result: 'done', ref_requested: null, failure_reason: null });
    expect(deploys[0]).toMatchObject({ result: 'done', ref_source: 'ci-reported', ci_reported_ref: R3, reconciled: true, ci_run_id: '42' });
    expect(deploys.find((h: any) => h.deploy_id === 'd-failed')).toMatchObject({ result: 'failed', failure_reason: 'exit-code', ref: null });
  });

  it('UT-S41-14: current_ref 与 previous_ref 口径', () => {
    registryWithDeploy('mode: script\nscript: deploy/prod.sh');
    const env = () => {
      const reg = loadEnvironmentRegistry(root);
      if (reg.state !== 'loaded') throw new Error('registry');
      return reg.environments.find(e => e.id === 'prod')!;
    };
    const view = () => buildEnvView(env(), readDeploymentLedger(root), { deployEnabled: true, root });
    const base = [
      execDeploy('prod', 'done', R1),
      execDeploy('prod', 'done', R2),
      execDeploy('prod', 'failed', null),
      execDeploy('prod', 'done', R2),
      execDeploy('prod', 'unknown', null),
    ];
    ledger(base);
    expect(view()).toMatchObject({ current_ref: R2, previous_ref: R1 });

    // 成功但版本未确认：current_ref 为 null，不沿用更早版本；previous_ref 为 R2
    ledger([...base, execDeploy('prod', 'done', null)]);
    expect(view()).toMatchObject({ current_ref: null, previous_ref: R2 });

    // previous_ref 基于完整账本：R1、R2 成功后插入 1000 条 test 记录与 30 条 prod 失败记录
    const noise: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 1000; i++) noise.push(legacyDeploy('test', R0));
    for (let i = 0; i < 30; i++) noise.push(execDeploy('prod', 'failed', null));
    ledger([execDeploy('prod', 'done', R1), execDeploy('prod', 'done', R2), ...noise]);
    const snap = readDeploymentLedger(root);
    expect(snap.byEnvironment.get('prod')!.history.length).toBe(20);
    expect(previousRefOf(snap.byEnvironment.get('prod'))).toBe(R1);
    expect(view()).toMatchObject({ current_ref: R2, previous_ref: R1 });
  });

  it('UT-S41-15: 环境视图新增字段与 schema', async () => {
    registryWithDeploy('mode: script\nscript: deploy/prod.sh');
    ledger([execDeploy('prod', 'done', R1, { deploy_id: 'd1' }), execDeploy('prod', 'failed', null, { deploy_id: 'd2' })]);
    // prod：本机存活进程持有环境锁；test：未决记录（ci 已触发）
    put(`${DEPLOY_LOCKS_REL}/prod.lock`, JSON.stringify({ pid: process.pid, deploy_id: 'd-lock', mode: 'script', started_at: '2026-10-15T02:00:00.000Z' }));
    put(`${DEPLOY_PENDING_REL}/test.json`, JSON.stringify({
      deploy_id: 'd-pending', mode: 'ci', started_at: '2026-10-15T03:00:00.000Z', run_id: '77', run_url: 'https://ci/77',
    }));

    const list = runJson(() => envList('json', root));
    const prod = list.environments.find((e: any) => e.id === 'prod');
    const test = list.environments.find((e: any) => e.id === 'test');
    expect(prod.deploy_mode).toBe('script');
    expect(test.deploy_mode).toBeNull();
    expect(prod.deploy_in_progress).toEqual({
      deploy_id: 'd-lock', mode: 'script', started_at: '2026-10-15T02:00:00.000Z', run_id: null, run_url: null, unresolved: false,
    });
    expect(test.deploy_in_progress).toEqual({
      deploy_id: 'd-pending', mode: 'ci', started_at: '2026-10-15T03:00:00.000Z', run_id: '77', run_url: 'https://ci/77', unresolved: true,
    });
    expect(prod.last_deploy).toMatchObject({ result: 'failed', channel: 'version', mode: 'script', ref_requested: R3, failure_reason: 'exit-code' });
    expect(prod).toMatchObject({ current_ref: R1, previous_ref: null });

    // 持锁进程已不存在：本地锁视为遗留，不算进行中
    put(`${DEPLOY_LOCKS_REL}/prod.lock`, JSON.stringify({ pid: 2 ** 22 + 12345, deploy_id: 'd-stale', mode: 'script', started_at: null }));
    expect(runJson(() => envList('json', root)).environments.find((e: any) => e.id === 'prod').deploy_in_progress).toBeNull();
    put(`${DEPLOY_LOCKS_REL}/prod.lock`, JSON.stringify({ pid: process.pid, deploy_id: 'd-lock', mode: 'script', started_at: '2026-10-15T02:00:00.000Z' }));

    // env show 与 status 的同一环境视图字段一致
    const show = runJson(() => envShow('prod', 'json', root));
    for (const key of ['current_ref', 'previous_ref', 'deploy_mode', 'deploy_in_progress', 'last_deploy', 'last_smoke'] as const) {
      expect(show[key], `env show ${key}`).toEqual(prod[key]);
    }
    const st = cli(['status', '--format', 'json']);
    expect(st.status, st.stderr).toBe(0);
    const statusData = JSON.parse(st.stdout).data;
    const prodNoAliases = Object.fromEntries(Object.entries(prod).filter(([k]) => k !== 'aliases'));
    expect(statusData.environments.find((e: any) => e.id === 'prod')).toEqual(prodNoAliases);
    const validate = await statusSchemaValidator();
    const v = validate(statusData);
    expect(v.ok, v.errors).toBe(true);
    // 登记表非法时的 environment_registry_error 同样符合 schema
    registryWithDeploy('mode: script\nscript: /abs.sh');
    const bad = JSON.parse(cli(['status', '--format', 'json']).stdout).data;
    expect(bad.environments).toEqual([]);
    expect(bad.environment_registry_error.code).toBe('ENV_REGISTRY_INVALID');
    const vb = validate(bad);
    expect(vb.ok, vb.errors).toBe(true);

    // 对照：部署执行未启用（无 deploy 配置、账本只有 deploy-done 记录）时视图不出现部署执行字段
    registryWithDeploy(null);
    ledger([legacyDeploy('prod', R1)]);
    const legacyList = runJson(() => envList('json', root));
    const legacyProd = legacyList.environments.find((e: any) => e.id === 'prod');
    expect(Object.keys(legacyProd)).toEqual(['id', 'name', 'tier', 'current_ref', 'last_deploy', 'last_smoke', 'aliases']);
    expect(Object.keys(legacyProd.last_deploy)).toEqual(['deploy_id', 'slug', 'ref', 'ref_source', 'observed_head', 'observed_dirty', 'recorded_at']);
    const reg = loadEnvironmentRegistry(root);
    expect(reg.state === 'loaded' && isDeployExecutionEnabled(reg.environments, readDeploymentLedger(root))).toBe(false);
  }, 120_000);
});

/**
 * 0.16.3 账本读取的兼容夹具：冻结 environment-registry 发布时（HEAD 中 cli/src/lib/environments.ts 的
 * validateLedgerRecord）只认的字段集与规则，用来证明新形态记录在旧读取方下被计为坏行并跳过、不抛出。
 */
function legacy0163Accepts(o: any): boolean {
  const commitOrNull = (v: unknown) => v === null || (typeof v === 'string' && /^[0-9a-f]{40}$/.test(v));
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return false;
  if (o.kind !== 'deploy' && o.kind !== 'smoke') return false;
  if (typeof o.environment !== 'string' || o.environment === '' || typeof o.slug !== 'string' || o.slug === '' || typeof o.recorded_at !== 'string') return false;
  if (!('observed_head' in o) || !commitOrNull(o.observed_head)) return false;
  if (!('observed_dirty' in o) || !(o.observed_dirty === null || typeof o.observed_dirty === 'boolean')) return false;
  if (!('ref' in o) || !commitOrNull(o.ref)) return false;
  if (o.kind === 'deploy') {
    if (typeof o.deploy_id !== 'string' || o.deploy_id === '' || o.result !== 'done') return false;
    if (o.ref_source !== 'explicit' && o.ref_source !== 'unknown') return false;
    return (o.ref_source === 'explicit') === (o.ref !== null);
  }
  return true;
}

describe('S41 部署配置与部署记录扩展 — 场景测试（environment-deploy）', () => {
  it('ST-S41-04: 新旧记录混合账本的视图与 0.16.3 读取兼容', async () => {
    registryWithDeploy('mode: script\nscript: deploy/prod.sh');
    const lines = [
      legacyDeploy('prod', R1, 'd-legacy'),
      execDeploy('prod', 'done', R2, { deploy_id: 'd-v2' }),
      execDeploy('prod', 'failed', null, { deploy_id: 'd-fail' }),
      execDeploy('prod', 'unknown', null, { deploy_id: 'd-unknown', mode: 'ci' }),
    ];
    ledger(lines);

    // ① env show（真实 CLI）
    const show = cli(['env', 'show', 'prod', '--format', 'json']);
    expect(show.status, show.stderr).toBe(0);
    const s = JSON.parse(show.stdout).data;
    expect(s).toMatchObject({ current_ref: R2, previous_ref: R1, deploy_mode: 'script', deploy_in_progress: null });
    expect(s.last_deploy).toMatchObject({ deploy_id: 'd-unknown', result: 'unknown', channel: 'version', mode: 'ci' });
    expect(s.ledger.corrupt_lines).toBe(0);

    // ② status（真实 CLI），与 env show 口径一致且通过 schema
    const st = cli(['status', '--format', 'json']);
    expect(st.status, st.stderr).toBe(0);
    const data = JSON.parse(st.stdout).data;
    const prod = data.environments.find((e: any) => e.id === 'prod');
    expect(prod).toMatchObject({ current_ref: R2, previous_ref: R1, deploy_mode: 'script' });
    expect(prod.last_deploy).toEqual(s.last_deploy);
    const v = (await statusSchemaValidator())(data);
    expect(v.ok, v.errors).toBe(true);

    // ③ 0.16.3 读取方：新形态记录计入坏行并跳过，旧形态记录照常生效，不抛出
    const raw = readFileSync(join(root, DEPLOY_LEDGER_REL), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const accepted = raw.filter(legacy0163Accepts);
    expect(accepted.map(r => r.deploy_id)).toEqual(['d-legacy']);
    expect(raw.length - accepted.length).toBe(3);
    // 当前读取方对同一账本无坏行
    expect(readDeploymentLedger(root).corruptLines).toBe(0);
  }, 120_000);
});
