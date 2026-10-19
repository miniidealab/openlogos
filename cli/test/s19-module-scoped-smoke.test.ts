/**
 * module-scoped-env-smoke 切片3：smoke 按模块限定范围（spec/environments.md §14.3、§14.5、§14.6；spec/test-results.md
 * 「按模块限定 smoke 范围的运行约定」；spec/cli-json-output.md「smoke `scope`」）。
 *
 * 用例 ID 与 logos/resources/test/core-S19-test-cases.md「按模块限定 smoke」对齐（UT-S19-74～80、UT-S19-82、ST-S19-30）。
 * 夹具 S1 / M0 / MM 见 test/s19-module-env-fixtures.ts；零回归基准为修改前（0.16.9）CLI 的实测输出（含 smoke 报告），
 * 入库于 test/fixtures/s19-module-env-baseline.json。结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSmokeCoverage, extractChangedSmokeIds } from '../src/lib/smoke-coverage.js';
import { resolveSmokeCaseSet, smokeSpecModule } from '../src/lib/smoke-scope.js';
import {
  LEDGER_REL, MES_BASELINE_FILE, PROPOSAL_REL, SLUG, buildEnvProject, callsLogPath, dataOf, git, readJson, runCli, snapshot,
  zeroRegressionRun, type CliRun, type EnvFixtureOptions, type EnvKind,
} from './s19-module-env-fixtures.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MODULES = ['core', 'team'];
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function project(kind: EnvKind, opts: EnvFixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mes19-'));
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(callsLogPath(root), { force: true });
  });
  return buildEnvProject(root, kind, opts);
}

interface Smoke {
  environment: string | null;
  summary: { defined_count: number; executed_count: number };
  gate: { result: string; reason: string | null };
  changed_cases: string[];
  failed_cases: Array<{ id: string }>;
  uncovered_cases: string[];
  diagnostics: Array<{ code: string; module?: string }>;
  result_path: string;
  report_path: string;
  scope?: Record<string, unknown> & { out_of_scope_result_count: number };
  environment_evidence?: { deploy_id: string | null; ref: string | null; ledger_written: boolean };
}

function smokeRun(root: string, args: string[] = []): { run: CliRun; data: Smoke } {
  const run = runCli(root, ['smoke', ...args, '--format', 'json']);
  if (!run.stdout.trim()) throw new Error(`smoke ${args.join(' ')} 无输出：${run.stderr}`);
  return { run, data: dataOf<Smoke>(run) };
}

/** 本提案（ship-it）修改了某条 smoke 用例：写入 deltas/test/smoke 下的变更用例。 */
function changeCase(root: string, file: string, id: string): void {
  const dir = join(root, PROPOSAL_REL, 'deltas/test/smoke');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `## MODIFIED — 变更\n\n| ID | 描述 |\n|---|---|\n| ${id} | 已修改 |\n`);
}

const extra = (root: string, rows: Array<{ id: string; status: string }>) =>
  writeFileSync(join(root, 'tools/extra.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

const calls = (root: string) => existsSync(callsLogPath(root))
  ? readFileSync(callsLogPath(root), 'utf-8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>).filter(c => 'runner' in c)
  : [];

const ledger = (root: string) => existsSync(join(root, LEDGER_REL))
  ? readFileSync(join(root, LEDGER_REL), 'utf-8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
  : [];

/** core 活跃提案下以版本通道部署 team-prod，返回账本中的 deploy 记录。 */
function versionDeployTeam(root: string): Record<string, unknown> {
  const head = git(root, ['rev-parse', 'HEAD']);
  const r = runCli(root, ['deploy', '--env', 'team-prod', '--ref', head, '--format', 'json']);
  expect(r.status, r.stderr).toBe(0);
  expect(dataOf<{ channel: string }>(r).channel).toBe('version');
  return ledger(root).filter(x => x.kind === 'deploy').at(-1)!;
}

/** 变体 P：team 活跃提案（提案上下文）已落标 team-prod，本提案修改了 core 用例 X。 */
function variantP(x = 'SMOKE-core-01'): string {
  const root = project('MM', { proposalModule: 'team' });
  changeCase(root, 'core-smoke-test-cases.md', x);
  const dd = runCli(root, ['deploy-done', '--env', 'team-prod', '--format', 'json']);
  expect(dd.status, dd.stderr).toBe(0);
  return root;
}

/** 不带登记表、只配置 smoke.modules 的启用变体（不限定模块的命令可在不传 --env 时运行）。 */
function noRegistry(root: string): void {
  rmSync(join(root, 'logos/environments.yaml'));
  const yaml = join(root, 'logos/logos-project.yaml');
  writeFileSync(yaml, readFileSync(yaml, 'utf-8').replace(/deployment_gates:[\s\S]*$/, ''));
}

describe('S19 smoke 按模块限定范围（module-scoped-env-smoke 切片3）', () => {
  it('UT-S19-74: 最终应覆盖集合 S——P 含变更用例 X；V 不读无关提案变更用例且不回退 guard；N 为全部用例', () => {
    expect(smokeSpecModule('team-smoke-test-cases.md', MODULES)).toBe('team');
    expect(smokeSpecModule('shared-smoke-test-cases.md', MODULES)).toBeNull();
    expect(smokeSpecModule('team-x-smoke.md', ['team', 'team-x'])).toBe('team-x'); // 最长匹配

    // P：team 提案（提案上下文）修改了 core 用例 X
    const p = variantP();
    const changedP = extractChangedSmokeIds(p, SLUG);
    expect(changedP).toEqual(['SMOKE-core-01']);
    expect(resolveSmokeCaseSet(p, MODULES, 'team', changedP).caseIds).toEqual(['SMOKE-core-01', 'SMOKE-shared-01', 'SMOKE-team-01']);
    const pRun = smokeRun(p, ['--env', 'team-prod']);
    expect(pRun.data.summary.defined_count).toBe(3);
    expect(pRun.data.changed_cases).toEqual(['SMOKE-core-01']);

    // V：core 提案修改了 core 用例 Y，无 team 提案；smoke --env team-prod 为版本上下文
    const v = project('MM');
    changeCase(v, 'core-smoke-test-cases.md', 'SMOKE-core-02');
    expect(extractChangedSmokeIds(v)).toEqual(['SMOKE-core-02']); // guard 回退会读到 Y……
    expect(checkSmokeCoverage(v, { versionContext: true }).changed_case_ids).toEqual([]); // ……版本上下文不读
    versionDeployTeam(v);
    const vRun = smokeRun(v, ['--env', 'team-prod']);
    expect(vRun.data.scope).toMatchObject({ module: 'team', context: 'version' });
    expect(vRun.data.changed_cases).toEqual([]);
    expect(vRun.data.summary.defined_count).toBe(2);
    expect(vRun.data.uncovered_cases).not.toContain('SMOKE-core-02');

    // N：无活跃提案、不传 --env → 不限定模块，全部用例
    const n = project('MM', { proposalModule: null });
    noRegistry(n);
    const nRun = smokeRun(n);
    expect(nRun.data.scope).toMatchObject({ mode: 'project', module: null, fallback_reason: { code: 'no_env_no_proposal' } });
    expect(nRun.data.summary.defined_count).toBe(4);
  }, 180_000);

  it('UT-S19-75: 未触达的其他模块结果忽略并计数；未定义 ID 照旧判定', () => {
    const root = variantP();
    appendFileSync(join(root, 'logos/resources/test/smoke/core-smoke-test-cases.md'), '| SMOKE-core-03 | c |\n');
    extra(root, [
      { id: 'SMOKE-core-01', status: 'pass' },
      { id: 'SMOKE-core-02', status: 'pass' }, { id: 'SMOKE-core-03', status: 'fail' },
      { id: 'SMOKE-undefined-09', status: 'pass' },
    ]);
    const { data } = smokeRun(root, ['--env', 'team-prod']);
    expect(data.scope?.out_of_scope_result_count).toBe(2);
    // 两条 core 结果不计入覆盖与门禁（SMOKE-core-03 的 fail 不阻断）；未定义 ID 保留计入 executed
    expect(data.failed_cases.map(f => f.id)).not.toContain('SMOKE-core-03');
    expect(data.summary.executed_count).toBe(4); // team-01、shared-01、X、未定义 ID
    expect(data.summary.defined_count).toBe(3);
    expect(data.gate.result).toBe('PASS');

    // code-r1 F1：范围外已定义结果也不参与环境证据——错误环境与缺环境字段的 core 行均被忽略，
    // 门禁保持 PASS、证据 declared、verified=true；范围内错误环境仍阻断（对照）
    const v = project('MM');
    versionDeployTeam(v);
    extra(v, [
      { id: 'SMOKE-core-01', status: 'pass', target_environment: 'local-macos' } as { id: string; status: string },
      { id: 'SMOKE-core-02', status: 'pass', target_environment: null } as unknown as { id: string; status: string },
    ]);
    const ignored = smokeRun(v, ['--env', 'team-prod']).data as Smoke & { environment_evidence: Record<string, unknown> };
    expect(ignored.scope?.out_of_scope_result_count).toBe(2);
    expect(ignored.gate).toEqual({ result: 'PASS', reason: null });
    expect(ignored.environment_evidence).toMatchObject({
      env_evidence: 'declared', mismatched_case_ids: [], missing_case_ids: [], verified: true, ledger_written: true,
    });
    expect(ledger(v).filter(x => x.kind === 'smoke').at(-1)).toMatchObject({ slug: null, env_evidence: 'declared', verified: true });

    const control = project('MM');
    versionDeployTeam(control);
    writeFileSync(join(control, 'tools/team-ids.json'), JSON.stringify(['SMOKE-team-01']));
    extra(control, [{ id: 'SMOKE-shared-01', status: 'pass', target_environment: 'local-macos' } as { id: string; status: string }]);
    const blocked = smokeRun(control, ['--env', 'team-prod']).data as Smoke & { environment_evidence: Record<string, unknown> };
    expect(blocked.gate).toEqual({ result: 'FAIL', reason: 'SMOKE_ENV_EVIDENCE_MISMATCH' });
    expect(blocked.environment_evidence).toMatchObject({ env_evidence: 'mismatch', mismatched_case_ids: ['SMOKE-shared-01'], verified: false });
  }, 180_000);

  it('UT-S19-76: 命令选择与注入——module command / 另写 result_path / 未配置回落项目级；不限定模块不注入', () => {
    // A：smoke.modules.team 只写 command
    const a = variantP();
    extra(a, [{ id: 'SMOKE-core-01', status: 'pass' }]);
    const ra = smokeRun(a, ['--env', 'team-prod']).data;
    expect(calls(a)).toEqual([expect.objectContaining({ runner: 'team', module: 'team', env: 'team-prod', result_path: 'logos/resources/verify/smoke-results.jsonl' })]);
    expect(ra.result_path).toBe('logos/resources/verify/smoke-results.jsonl');
    expect(ra.report_path).toBe('logos/resources/verify/smoke-report.md');
    expect(ra.scope?.command_source).toBe('module');

    // B：另写 result_path
    const b = variantP();
    extra(b, [{ id: 'SMOKE-core-01', status: 'pass' }]);
    const cfgB = JSON.parse(readFileSync(join(b, 'logos/logos.config.json'), 'utf-8'));
    cfgB.smoke.modules.team.result_path = 'logos/resources/verify/team-smoke-results.jsonl';
    writeFileSync(join(b, 'logos/logos.config.json'), JSON.stringify(cfgB, null, 2));
    const rb = smokeRun(b, ['--env', 'team-prod']).data;
    expect(rb.result_path).toBe('logos/resources/verify/team-smoke-results.jsonl');
    expect(calls(b)[0]).toMatchObject({ runner: 'team', result_path: 'logos/resources/verify/team-smoke-results.jsonl' });
    expect(readFileSync(join(b, rb.result_path), 'utf-8')).toContain('SMOKE-team-01');
    expect(rb.gate.result).toBe('PASS');

    // C：不配置 smoke.modules.team → 项目级命令，用例仍按 team 限定
    const c = variantP();
    const cfgC = JSON.parse(readFileSync(join(c, 'logos/logos.config.json'), 'utf-8'));
    delete cfgC.smoke.modules;
    writeFileSync(join(c, 'logos/logos.config.json'), JSON.stringify(cfgC, null, 2));
    const rc = smokeRun(c, ['--env', 'team-prod']).data;
    expect(calls(c)).toEqual([expect.objectContaining({ runner: 'project', module: 'team' })]);
    expect(rc.scope).toMatchObject({ module: 'team', command_source: 'project', out_of_scope_result_count: 1 }); // 未触达的 core-02
    expect(rc.summary.defined_count).toBe(3);

    // 不限定模块：不注入 OPENLOGOS_SMOKE_MODULE
    const n = project('MM', { proposalModule: null });
    noRegistry(n);
    smokeRun(n);
    expect(calls(n)).toEqual([expect.objectContaining({ runner: 'project', module: null })]);

    // 根 spec/logos.config.schema.json（code-targets 直接写入，不经 delta）可按 JSON 解析且含 smoke.modules
    const schema = JSON.parse(readFileSync(join(REPO, 'spec/logos.config.schema.json'), 'utf-8'));
    const modules = schema.properties.smoke.properties.modules;
    expect(modules.type).toBe('object');
    expect(Object.keys(modules.additionalProperties.properties).sort()).toEqual(['command', 'report_path', 'result_path']);
    expect(readFileSync(join(REPO, 'spec/logos.config.schema.json'))
      .equals(readFileSync(join(REPO, 'logos/changes/module-scoped-env-smoke/code-targets/spec/logos.config.schema.json')))).toBe(true);
  }, 180_000);

  it('UT-S19-77: smoke.modules 中未登记的模块 id 警告 smoke_module_unknown 并忽略，门禁不受影响', () => {
    const root = project('MM');
    const cfg = JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf-8'));
    cfg.smoke.modules.portal = { command: 'node scripts/does-not-exist.js' };
    writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify(cfg, null, 2));
    expect(runCli(root, ['deploy-done', '--format', 'json']).status).toBe(0);
    const { run, data } = smokeRun(root);
    expect(run.status, run.stderr).toBe(0);
    expect(data.diagnostics).toContainEqual(expect.objectContaining({ code: 'smoke_module_unknown', module: 'portal' }));
    expect(data.gate.result).toBe('PASS');
    expect(calls(root).map(c => c.runner)).toEqual(['project']);
  }, 120_000);

  it('UT-S19-78: 未声明环境的模块按无登记表；他模块环境按归属路由到其版本上下文（core 已落标不改变路由）', () => {
    const root = project('MM');
    expect(runCli(root, ['deploy-done', '--format', 'json']).status).toBe(0);
    const deploy = versionDeployTeam(root);
    // ① smoke（不传 --env）：照常执行项目级命令，无环境证据门禁，不写部署账本
    const one = smokeRun(root).data;
    expect(one.gate.result).toBe('PASS');
    expect(one.environment_evidence).toBeUndefined();
    expect(calls(root)).toEqual([expect.objectContaining({ runner: 'project', env: null })]);
    expect(ledger(root).filter(x => x.kind === 'smoke')).toEqual([]);
    // ② smoke --env team-prod：不报 ENV_MODULE_MISMATCH，执行 team 命令，版本上下文，身份取自账本
    const before = snapshot(root, PROPOSAL_REL);
    const { run, data } = smokeRun(root, ['--env', 'team-prod']);
    expect(run.status, run.stderr).toBe(0);
    expect(data.scope).toMatchObject({ mode: 'module', module: 'team', context: 'version' });
    expect(calls(root).at(-1)).toMatchObject({ runner: 'team', module: 'team', env: 'team-prod' });
    expect(data.environment_evidence).toMatchObject({ deploy_id: deploy.deploy_id, ref: deploy.ref });
    expect(snapshot(root, PROPOSAL_REL)).toEqual(before);
  }, 180_000);

  it('UT-S19-79: 版本上下文不读写提案标记——core 提案未部署时 team smoke 不报 SMOKE_DEPLOY_NOT_DONE', () => {
    const root = project('MM');
    const deploy = versionDeployTeam(root);
    const before = snapshot(root, PROPOSAL_REL);
    const { run, data } = smokeRun(root, ['--env', 'team-prod']);
    expect(run.status, run.stderr).toBe(0);
    expect(data.gate.result).toBe('PASS');
    expect(data.scope).toMatchObject({ module: 'team', context: 'version' });
    expect(calls(root)).toEqual([expect.objectContaining({ runner: 'team' })]);
    expect(data.environment_evidence).toMatchObject({ deploy_id: deploy.deploy_id, ref: deploy.ref, ledger_written: true });
    expect(ledger(root).filter(x => x.kind === 'smoke')).toEqual([expect.objectContaining({ environment: 'team-prod', slug: null })]);
    expect(snapshot(root, PROPOSAL_REL)).toEqual(before);
    for (const m of ['DEPLOY_DONE', 'SMOKE_PASS', 'SMOKE_FAIL']) expect(existsSync(join(root, PROPOSAL_REL, m)), m).toBe(false);
  }, 120_000);

  it('UT-S19-80: JSON scope 七字段与报告「范围」行；M0、S1 与零回归基准逐字节相同', () => {
    const root = project('MM');
    versionDeployTeam(root);
    const { data } = smokeRun(root, ['--env', 'team-prod']);
    expect(Object.keys(data.scope ?? {}).sort()).toEqual(
      ['command_source', 'context', 'fallback_reason', 'mode', 'module', 'out_of_scope_result_count', 'reasons'],
    );
    expect(data.scope).toEqual({
      mode: 'module', module: 'team', context: 'version', reasons: ['env'], fallback_reason: null,
      out_of_scope_result_count: 0, command_source: 'module',
    });
    const report = readFileSync(join(root, data.report_path), 'utf-8');
    expect(report).toMatch(/^\| 范围 \(Scope\) \| module team · version context · command: module · out-of-scope results: 0 \|$/m);

    const expected = (readJson(MES_BASELINE_FILE) as { runs: Record<string, Record<string, CliRun>> }).runs;
    for (const kind of ['S1', 'M0'] as const) {
      const runs = zeroRegressionRun(project(kind));
      for (const step of ['smoke', 'smoke-report']) expect(runs[step], `${kind} ${step}`).toEqual(expected[kind][step]);
      expect(runs.smoke.stdout).not.toContain('"scope"');
      expect(runs['smoke-report'].stdout).not.toContain('范围');
    }
  }, 240_000);

  it('UT-S19-82: 跨模块变更用例的结果保留并参与判定——pass 覆盖、fail 阻断、缺结果 uncovered', () => {
    const untouched = { id: 'SMOKE-core-02', status: 'pass' };
    const pass = variantP();
    extra(pass, [{ id: 'SMOKE-core-01', status: 'pass' }, untouched]);
    const a = smokeRun(pass, ['--env', 'team-prod']).data;
    expect(a.gate.result).toBe('PASS');
    expect(a.uncovered_cases).toEqual([]);
    expect(a.scope?.out_of_scope_result_count).toBe(1);

    const fail = variantP();
    extra(fail, [{ id: 'SMOKE-core-01', status: 'fail' }, untouched]);
    const b = smokeRun(fail, ['--env', 'team-prod']).data;
    expect(b.failed_cases.map(f => f.id)).toEqual(['SMOKE-core-01']);
    expect(b.gate.result).toBe('FAIL');
    expect(b.scope?.out_of_scope_result_count).toBe(1);

    const missing = variantP();
    extra(missing, [untouched]);
    const c = smokeRun(missing, ['--env', 'team-prod']).data;
    expect(c.uncovered_cases).toEqual(['SMOKE-core-01']);
    expect(c.gate.result).toBe('FAIL');
    expect(c.scope?.out_of_scope_result_count).toBe(1);
  }, 180_000);

  it('ST-S19-30: core 有活跃提案时 team 版本部署与 team smoke 完整链', () => {
    const root = project('MM');
    const before = snapshot(root, PROPOSAL_REL);
    // ① 版本通道部署
    const head = git(root, ['rev-parse', 'HEAD']);
    const dep = runCli(root, ['deploy', '--env', 'team-prod', '--ref', head, '--format', 'json']);
    expect(dep.status, dep.stderr).toBe(0);
    const depData = dataOf<{ channel: string; deploy_id: string }>(dep);
    expect(depData.channel).toBe('version');
    // ② team smoke：通过，只覆盖 team 与全局用例，版本上下文，身份取自 ① 的账本记录
    const { run, data } = smokeRun(root, ['--env', 'team-prod']);
    expect(run.status, run.stderr).toBe(0);
    expect(data.gate.result).toBe('PASS');
    expect(data.summary.defined_count).toBe(2);
    expect(data.scope).toMatchObject({ module: 'team', context: 'version' });
    expect(data.environment_evidence).toMatchObject({ deploy_id: depData.deploy_id, ref: head });
    expect(calls(root)).toEqual([expect.objectContaining({ runner: 'team', module: 'team' })]);
    // ③ core 提案仍为 ready-to-deploy，提案目录前后字节不变
    const status = dataOf<{ active_change: string; proposal_step: string }>(runCli(root, ['status', '--format', 'json']));
    expect(status).toMatchObject({ proposal_step: 'ready-to-deploy' });
    expect(snapshot(root, PROPOSAL_REL)).toEqual(before);
    for (const m of ['DEPLOY_DONE', 'SMOKE_PASS', 'SMOKE_FAIL']) expect(existsSync(join(root, PROPOSAL_REL, m)), m).toBe(false);
  }, 180_000);
});
