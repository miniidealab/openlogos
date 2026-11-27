/**
 * S41 人工验收字段与账本 manual / pending 记录（smoke-manual-acceptance，切片 slice-02-registry-ledger-pending-list）。
 *
 * 覆盖 UT-S41-30～UT-S41-39、ST-S41-08，对应场景 S41「人工验收字段（smoke-manual-acceptance）」与 EX-41.25～EX-41.29，
 * 功能规格 §2.107.3、§2.107.7、§2.107.11，spec/environments.md §5.2、§5.4、§15.2。
 * 全部用例在一次性项目中构造；账本夹具逐行写入一次性项目，不读写本仓账本。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  buildEnvView, isGatedEnvironment, loadEnvironmentRegistry, readDeploymentLedger,
} from '../src/lib/environments.js';
import { buildEnvProject, runCli, dataOf, LEDGER_REL } from './s19-module-env-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = resolve(HERE, '../../spec/schema/status.schema.json');
const C1 = 'a'.repeat(40);
const C2 = 'b'.repeat(40);
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'ol-s41-ma-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

const REGISTRY_HEAD = 'schema_version: 1\nenvironments:\n';
function registry(root: string, envBlocks: string[]): void {
  put(root, 'logos/environments.yaml', REGISTRY_HEAD + envBlocks.join(''));
}
const PROD_MA = '  - id: prod\n    name: Production\n    tier: prod\n    manual_acceptance:\n      enabled: true\n      regression: [ST-S01-05, SMOKE-core-901]\n';
const TEST_PLAIN = '  - id: test\n    name: Test\n    tier: test\n';

const base = (env: string) => ({ environment: env, slug: null, recorded_at: '2026-11-27T00:00:00.000Z', observed_head: null, observed_dirty: null });
const deployRow = (env: string, id: string, ref: string | null, result = 'done') => ({
  kind: 'deploy', ...base(env), deploy_id: id, ref, ref_source: ref === null ? 'unknown' : 'explicit', result,
  channel: 'version', mode: 'script', ref_requested: ref ?? C1,
});
const smokeRow = (env: string, deployId: string, ref: string | null, extra: Record<string, unknown> = {}) => ({
  kind: 'smoke', ...base(env), deploy_id: deployId, ref, result: 'pass', env_evidence: 'declared', fresh_results: true,
  deploy_env_confirmed: true, verified: ref !== null, ...extra,
});
const manualRow = (env: string, deployId: string, caseId: string, result = 'pass', note: string | null = null) => ({
  kind: 'manual', ...base(env), deploy_id: deployId, ref: C1, case_id: caseId, result, note, evidence: [], recorder: null,
});
function ledger(root: string, rows: unknown[]): void {
  put(root, LEDGER_REL, rows.map(r => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
}

function loaded(root: string) {
  const reg = loadEnvironmentRegistry(root);
  if (reg.state !== 'loaded') throw new Error(`registry ${reg.state}`);
  return reg;
}

describe('S41 人工验收字段（smoke-manual-acceptance）— 单元测试', () => {
  it('UT-S41-30: 合法字段通过校验，EnvView 只在配置的环境上出现 manual_acceptance', () => {
    const root = tempRoot();
    registry(root, [TEST_PLAIN, PROD_MA]);
    const reg = loaded(root);
    expect(reg.errors).toEqual([]);
    expect(reg.warnings).toEqual([]);
    const prod = reg.environments.find(e => e.id === 'prod')!;
    const test = reg.environments.find(e => e.id === 'test')!;
    expect(prod.manualAcceptance).toEqual({ enabled: true, regression: ['ST-S01-05', 'SMOKE-core-901'] });
    expect(test.manualAcceptance).toBeUndefined();
    const snap = readDeploymentLedger(root);
    expect(buildEnvView(prod, snap).manual_acceptance).toEqual({ enabled: true, regression: ['ST-S01-05', 'SMOKE-core-901'], waiting: null });
    expect('manual_acceptance' in buildEnvView(test, snap)).toBe(false);
  });

  it('UT-S41-31: 结构非法按 ENV_FIELD_INVALID 拒绝，登记表按非法处理', () => {
    const cases: Array<[string, string]> = [
      ['    manual_acceptance:\n      enabled: "yes"\n', 'manual_acceptance.enabled'],
      ['    manual_acceptance:\n      regression: SMOKE-core-1\n', 'manual_acceptance.regression'],
      ['    manual_acceptance:\n      regression: [TODO-1]\n', 'manual_acceptance.regression[0]'],
      ['    manual_acceptance:\n      regression: [ST-S01-05, ST-S01-05]\n', 'manual_acceptance.regression'],
      ['    manual_acceptance: true\n', 'manual_acceptance'],
    ];
    for (const [block, field] of cases) {
      const root = tempRoot();
      registry(root, [`  - id: prod\n    name: Production\n    tier: prod\n${block}`]);
      const reg = loaded(root);
      expect(reg.errors.map(e => [e.code, e.field]), block).toContainEqual(['ENV_FIELD_INVALID', field]);
      expect(reg.environments.find(e => e.id === 'prod'), block).toBeUndefined();
    }
    // smoke 对非法登记表 fail-closed（ENV_REGISTRY_INVALID）
    const root = buildEnvProject(tempRoot(), 'S1');
    rmSync(join(root, 'logos/.openlogos-guard'));
    put(root, 'logos/environments.yaml', REGISTRY_HEAD + '  - id: test\n    name: Test\n    tier: test\n    manual_acceptance:\n      enabled: "yes"\n');
    const r = runCli(root, ['smoke', '--env', 'test', '--format', 'json']);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stderr.trim().split('\n').pop()!).error.code).toBe('ENV_REGISTRY_INVALID');
  });

  it('UT-S41-32: 未知子键只出 ENV_UNKNOWN_FIELD 警告', () => {
    const root = tempRoot();
    registry(root, ['  - id: prod\n    name: Production\n    tier: prod\n    manual_acceptance:\n      enabled: true\n      owner: qa\n']);
    const reg = loaded(root);
    expect(reg.errors).toEqual([]);
    expect(reg.warnings).toContainEqual(expect.objectContaining({ code: 'ENV_UNKNOWN_FIELD', environment: 'prod', field: 'manual_acceptance.owner' }));
    expect(reg.environments.find(e => e.id === 'prod')!.manualAcceptance).toEqual({ enabled: true, regression: [] });
  });

  it('UT-S41-33: 转义键写法按 ENV_FIELD_INVALID 拒绝', () => {
    const root = tempRoot();
    registry(root, ['  - id: prod\n    name: Production\n    tier: prod\n    "manual_\\u0061cceptance": {enabled: true}\n']);
    const reg = loaded(root);
    expect(reg.errors).toContainEqual(expect.objectContaining({ code: 'ENV_FIELD_INVALID', environment: 'prod', field: 'manual_acceptance' }));
  });

  it('UT-S41-34: 字段不构成受门环境，deploy-done 照常成功', () => {
    const root = tempRoot();
    registry(root, ['  - id: test\n    name: Test\n    tier: test\n    manual_acceptance: {enabled: true}\n']);
    const env = loaded(root).environments[0];
    expect(isGatedEnvironment(env)).toBe(false);
    const view = buildEnvView(env, readDeploymentLedger(root));
    for (const k of ['promote_from', 'require_approval', 'open_approvals', 'promotion']) expect(k in view).toBe(false);
    // 真实 CLI：未配置 deploy 的 test 写了 manual_acceptance，deploy-done --env test 照常成功（不报 DEPLOY_DONE_GATED_ENV）
    const project = buildEnvProject(tempRoot(), 'S1');
    const yaml = readFileSync(join(project, 'logos/environments.yaml'), 'utf-8')
      .replace('  - {id: test, name: Test, tier: test, aliases: [测试]}', '  - {id: test, name: Test, tier: test, aliases: [测试], manual_acceptance: {enabled: true}}');
    writeFileSync(join(project, 'logos/environments.yaml'), yaml);
    const r = runCli(project, ['deploy-done', '--env', 'test', '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain('DEPLOY_DONE_GATED_ENV');
  });

  it('UT-S41-35: 账本 manual 行逐行校验', () => {
    const root = tempRoot();
    registry(root, [PROD_MA]);
    ledger(root, [
      deployRow('prod', 'd1', C1),
      manualRow('prod', 'd1', 'ST-S01-05', 'pass'),
      manualRow('prod', 'd1', 'ST-S01-06', 'fail', ''),
      { ...manualRow('prod', 'd1', 'X-1'), case_id: 'X-1' },
      { ...manualRow('prod', 'd1', 'ST-S01-07'), evidence: 'a.png' },
    ]);
    const snap = readDeploymentLedger(root);
    expect(snap.corruptLines).toBe(3);
    const state = snap.byEnvironment.get('prod')!;
    expect(state.history.filter(h => h.kind === 'manual').map(h => (h as { case_id: string }).case_id)).toEqual(['ST-S01-05']);
    // manual 行不改变 last_deploy / current_ref / previous_ref
    expect(state.lastDeploy?.deploy_id).toBe('d1');
    expect(state.currentRef).toBe(C1);
    const view = buildEnvView(loaded(root).environments[0], snap, { deployEnabled: true });
    expect(view.current_ref).toBe(C1);
    expect(view.previous_ref).toBeNull();
  });

  it('UT-S41-36: 账本 pending 行逐行校验', () => {
    const root = tempRoot();
    registry(root, [PROD_MA]);
    ledger(root, [
      deployRow('prod', 'd1', C1),
      smokeRow('prod', 'd1', C1, { result: 'pending', verified: false, manual_pending: ['ST-S01-05'] }),
      smokeRow('prod', 'd1', C1, { result: 'pending', verified: true, manual_pending: ['ST-S01-05'] }),
      smokeRow('prod', 'd1', C1, { result: 'pending', verified: false }),
    ]);
    const snap = readDeploymentLedger(root);
    expect(snap.corruptLines).toBe(2);
    expect(snap.byEnvironment.get('prod')!.lastSmoke?.result).toBe('pending');
  });

  it('UT-S41-37: 旧读取方把 manual / pending 行计为坏行，新版读取为零坏行', () => {
    // 0.16.24 的校验判定表（逐字复刻其 kind 与 smoke result 的枚举检查）
    const legacyAccepts = (o: Record<string, unknown>) =>
      ['deploy', 'smoke', 'approval'].includes(o.kind as string) && (o.kind !== 'smoke' || ['pass', 'fail'].includes(o.result as string));
    const rows = [
      deployRow('prod', 'd1', C1),
      manualRow('prod', 'd1', 'ST-S01-05'),
      smokeRow('prod', 'd1', C1, { result: 'pending', verified: false, manual_pending: ['ST-S01-06'] }),
    ];
    expect(rows.filter(r => !legacyAccepts(r as Record<string, unknown>)).length).toBe(2);
    const root = tempRoot();
    registry(root, [PROD_MA]);
    ledger(root, rows);
    expect(readDeploymentLedger(root).corruptLines).toBe(0);
  });

  it('UT-S41-38: 过期通过记录不进入已验证集合与晋级候选', () => {
    const root = tempRoot();
    registry(root, ['  - id: staging\n    name: Staging\n    tier: staging\n    manual_acceptance: {enabled: true}\n']);
    ledger(root, [
      deployRow('staging', 'd0', C2),
      smokeRow('staging', 'd0', C2),
      deployRow('staging', 'd1', C1),
      smokeRow('staging', 'd1', C1, { manual_passed: true }),
      manualRow('staging', 'd1', 'ST-S01-05', 'fail', '白屏'),
    ]);
    const state = readDeploymentLedger(root).byEnvironment.get('staging')!;
    expect(state.verifiedRefs.has(C1)).toBe(false);
    expect(state.verifiedRefs.has(C2)).toBe(true);
    expect(state.candidateRef).toBe(C2);
  });

  it('UT-S41-39: status 中的 EnvView 与 env show 一致并通过 status.schema.json', () => {
    const root = buildEnvProject(tempRoot(), 'S1');
    const yaml = readFileSync(join(root, 'logos/environments.yaml'), 'utf-8')
      .replace('  - {id: prod, name: Production, tier: prod, aliases: [生产]}', '  - {id: prod, name: Production, tier: prod, aliases: [生产], manual_acceptance: {enabled: true}}');
    writeFileSync(join(root, 'logos/environments.yaml'), yaml);
    ledger(root, [
      deployRow('prod', 'd1', C1),
      smokeRow('prod', 'd1', C1, { result: 'pending', verified: false, manual_pending: ['ST-S01-05', 'SMOKE-core-901'] }),
      manualRow('prod', 'd1', 'ST-S01-05'),
    ]);
    const status = runCli(root, ['status', '--format', 'json']);
    expect(status.status, status.stderr).toBe(0);
    const statusData = dataOf<Record<string, any>>(status);
    const prodStatus = statusData.environments.find((e: any) => e.id === 'prod');
    expect(prodStatus.manual_acceptance).toEqual({ enabled: true, regression: [], waiting: { deploy_id: 'd1', remaining: ['SMOKE-core-901'] } });
    const show = dataOf<Record<string, any>>(runCli(root, ['env', 'show', 'prod', '--format', 'json']));
    expect(show.manual_acceptance).toEqual(prodStatus.manual_acceptance);
    const schema = JSON.parse(readFileSync(SCHEMA, 'utf-8'));
    const ajv = new (Ajv2020 as unknown as new (o: object) => { compile: (s: object) => ((d: unknown) => boolean) & { errors?: unknown } })({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    // 整份 status data 按 status.schema.json 校验（envView 含 manual_acceptance、smokeRecordView 含 pending）
    expect(validate(statusData), JSON.stringify((validate as { errors?: unknown }).errors)).toBe(true);
    expect(prodStatus.last_smoke.result).toBe('pending');
  });
});

describe('S41 人工验收字段（smoke-manual-acceptance）— 场景测试', () => {
  it('ST-S41-08: 真实 CLI：未配置字段的登记表零变化', () => {
    const root = buildEnvProject(tempRoot(), 'S1');
    ledger(root, [deployRow('test', 'd1', C1), smokeRow('test', 'd1', C1)]);
    const runs = {
      list: runCli(root, ['env', 'list', '--format', 'json']),
      show: runCli(root, ['env', 'show', 'test', '--format', 'json']),
      check: runCli(root, ['env', 'check', '--format', 'json']),
      status: runCli(root, ['status', '--format', 'json']),
    };
    for (const [name, run] of Object.entries(runs)) {
      expect(run.status, `${name}: ${run.stderr}`).toBe(0);
      expect(run.stdout, name).not.toContain('manual_acceptance');
      expect(run.stdout, name).not.toContain('manual_passed');
      expect(run.stdout, name).not.toContain('manual_pending');
    }
    const view = dataOf<Record<string, any>>(runs.list).environments.find((e: any) => e.id === 'test');
    expect(Object.keys(view).sort()).toEqual(['aliases', 'current_ref', 'deploy_in_progress', 'deploy_mode', 'id', 'last_deploy', 'last_smoke', 'name', 'previous_ref', 'tier']);
    expect(Object.keys(view.last_smoke).sort()).toEqual(['deploy_env_confirmed', 'deploy_id', 'env_evidence', 'fresh_results', 'observed_head', 'recorded_at', 'ref', 'result', 'slug', 'verified']);
    expect(dataOf<Record<string, any>>(runs.check).errors).toEqual([]);
  });
});
