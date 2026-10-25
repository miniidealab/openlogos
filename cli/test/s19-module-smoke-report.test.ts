/**
 * S19 多模块项目模块冒烟报告与报告保留路径（module-scoped-phase-reports，功能规格 §2.99.2、§2.99.6、§2.99.9，
 * spec/test-results.md「多模块项目的模块验收报告与模块冒烟报告」、spec/environments.md §14.9）。
 *
 * 夹具沿用 test/s19-module-env-fixtures.ts：MM（core launched、team initial 声明 team-prod、smoke.modules.team.command 已配置）、
 * M0（未启用按模块区分）、S1（单模块）。CLI 用例走真实 dist 入口（global-setup 已构建）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { PROPOSAL_REL, buildEnvProject, callsLogPath, dataOf, errorOf, git, runCli, snapshot, type EnvFixtureOptions, type EnvKind } from './s19-module-env-fixtures.js';
import { smokeReportAllowPaths } from '../src/commands/smoke.js';
import { isModuleReportComplete, readSummaryRows } from '../src/lib/module-phase-report.js';
import { collectStatusData } from '../src/commands/status.js';
import { buildInitialPhasePlan } from '../src/lib/flow-derive.js';

vi.setConfig({ testTimeout: 120_000 });

const VERIFY = 'logos/resources/verify';
const TEAM_SMOKE = `${VERIFY}/team-smoke-report.md`;
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function fixture(kind: EnvKind, opts: EnvFixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-msr-'));
  cleanups.push(() => { rmSync(root, { recursive: true, force: true }); rmSync(callsLogPath(root), { force: true }); });
  return buildEnvProject(root, kind, opts);
}
function put(root: string, rel: string, content: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function setConfig(root: string, mutate: (c: any) => void) {
  const p = join(root, 'logos/logos.config.json');
  const c = JSON.parse(readFileSync(p, 'utf-8'));
  mutate(c);
  writeFileSync(p, `${JSON.stringify(c, null, 2)}\n`);
}
const head = (root: string) => git(root, ['rev-parse', 'HEAD']);
const report = (root: string, m: string) => {
  const p = join(root, VERIFY, `${m}-smoke-report.md`);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
};
const rows = (root: string, m: string) => readSummaryRows(report(root, m) ?? '');
const deployTeam = (root: string) => {
  const r = runCli(root, ['deploy', '--env', 'team-prod', '--ref', head(root), '--format', 'json']);
  expect(r.status, r.stderr).toBe(0);
};
/** 版本通道部署 team-prod 后删除其模块部署报告，构造「team 未完成部署凭据」的前提。 */
const deployTeamWithoutReport = (root: string) => {
  const r = runCli(root, ['deploy', '--env', 'team-prod', '--ref', git(root, ['rev-parse', 'HEAD']), '--format', 'json']);
  expect(r.status, r.stderr).toBe(0);
  rmSync(join(root, VERIFY, 'team-deployment-report.md'), { force: true });
};
const moduleReports = (root: string) => ['core', 'team', 'portal'].filter(m => report(root, m) !== null);
const ACCEPT = '# Acceptance Report\n\n## Summary\n\n| Metric | Value |\n|--------|-------|\n| Module | team |\n| **Gate 3.5** | **PASS** |\n';
const DEPLOYED = '# Deployment Report\n\n## Deployment x → team-prod\n\n- deploy_id: d1\n';

/** 为 team 补齐 phase.3-0～3-5 产物与场景登记，并写入 Gate PASS 的模块验收报告。 */
function prepareTeamPhases(root: string) {
  const yamlPath = join(root, 'logos/logos-project.yaml');
  const y = parseYaml(readFileSync(yamlPath, 'utf-8'));
  y.scenarios = [{ id: 'S60', name: 't', module: 'team' }];
  writeFileSync(yamlPath, stringifyYaml(y, { lineWidth: 0 }));
  for (const item of buildInitialPhasePlan()) {
    if (['phase.3-6', 'phase.3-7-deploy', 'phase.3-8-smoke'].includes(item.phaseKey)) continue;
    if (item.phaseKey === 'phase.3-1') put(root, `${item.subpath}/team-S60-x.md`, 'x');
    else if (item.phaseKey === 'phase.3-4a') put(root, `${item.subpath}/team-S60-test-cases.md`, '| ID | d |\n|---|---|\n| UT-S60-01 | x |\n');
    else put(root, `${item.subpath}/team-x.md`, 'x');
  }
  put(root, `${VERIFY}/team-acceptance-report.md`, ACCEPT);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'team phases']);
}
const teamProgress = (root: string) => collectStatusData(root).modules!.find(m => m.id === 'team')!.phase_progress!;

describe('S19 多模块项目模块冒烟报告（module-scoped-phase-reports）', () => {
  it('UT-S19-90: 目标模块确定为 initial 模块时写模块冒烟报告', () => {
    const root = fixture('MM', { proposalModule: null });
    deployTeam(root);
    const r = runCli(root, ['smoke', '--env', 'team-prod', '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    const d = dataOf<any>(r);
    expect(d.scope).toMatchObject({ mode: 'module', module: 'team', context: 'version' });
    expect(rows(root, 'team').get('Module')).toBe('team');
    expect(rows(root, 'team').get('Defined cases')).toBe(String(d.summary.defined_count));
    expect(rows(root, 'team').get('Gate 3.8')).toBe('PASS');
    expect(existsSync(join(root, VERIFY, 'smoke-report.md'))).toBe(true);
    expect(JSON.stringify(d)).not.toContain('team-smoke-report');
  });

  it('UT-S19-91: 未启用按模块区分时为每个 initial 模块写', () => {
    const root = fixture('M0');
    const yamlPath = join(root, 'logos/logos-project.yaml');
    const y = parseYaml(readFileSync(yamlPath, 'utf-8'));
    y.modules.push({ id: 'portal', name: 'Portal', lifecycle: 'initial' });
    writeFileSync(yamlPath, stringifyYaml(y, { lineWidth: 0 }));
    expect(runCli(root, ['deploy-done', '--env', 'test', '--ref', head(root), '--format', 'json']).status).toBe(0);
    const r = runCli(root, ['smoke', '--env', 'test', '--format', 'json']);
    const d = dataOf<any>(r);
    expect(d.scope).toBeUndefined();
    expect(moduleReports(root)).toEqual(['team', 'portal']);
    for (const m of ['team', 'portal']) {
      expect(rows(root, m).get('Module')).toBe(m);
      expect(rows(root, m).get('Defined cases')).toBe(String(d.summary.defined_count));
      expect(rows(root, m).get('Gate 3.8')).toBe(d.gate.result);
    }
  });

  it('UT-S19-92: 已启用但回落项目级时不写', () => {
    const root = fixture('MM', { proposalModule: null });
    put(root, TEAM_SMOKE, 'OLD TEAM SMOKE\n');
    const before = statSync(join(root, TEAM_SMOKE)).mtimeMs;
    // 有登记表时不传 --env 会先以 ENV_REQUIRED 拒绝；改用不属于任何模块的 test 环境构造项目级回落
    const r = runCli(root, ['smoke', '--env', 'test', '--format', 'json']);
    expect(dataOf<any>(r).scope).toMatchObject({ mode: 'project', fallback_reason: { code: 'env_unattributed' } });
    expect(report(root, 'team')).toBe('OLD TEAM SMOKE\n');
    expect(statSync(join(root, TEAM_SMOKE)).mtimeMs).toBe(before);
  });

  it('UT-S19-93: launched 目标模块不写', () => {
    const root = fixture('MM');
    expect(runCli(root, ['deploy-done', '--format', 'json']).status).toBe(0);
    const r = runCli(root, ['smoke', '--format', 'json']);
    expect(dataOf<any>(r).scope).toMatchObject({ mode: 'module', module: 'core' });
    expect(moduleReports(root)).toEqual([]);
    expect(existsSync(join(root, PROPOSAL_REL, 'SMOKE_PASS')) || existsSync(join(root, PROPOSAL_REL, 'SMOKE_FAIL'))).toBe(true);
  });

  it('UT-S19-94: Gate FAIL 同样写，且只读 Gate 行判定', () => {
    const root = fixture('MM', { proposalModule: null });
    deployTeam(root);
    put(root, 'tools/team-ids.json', '[]');
    put(root, 'tools/extra.jsonl', `${JSON.stringify({ id: 'SMOKE-team-01', status: 'fail', error: 'expected PASS' })}\n`);
    const r = runCli(root, ['smoke', '--env', 'team-prod', '--format', 'json']);
    expect(dataOf<any>(r).gate.result).toBe('FAIL');
    expect(rows(root, 'team').get('Gate 3.8')).toBe('FAIL');
    expect(report(root, 'team')).toContain('expected PASS');
    expect(isModuleReportComplete(root, 'team', 'smoke')).toBe(false);
  });

  it('UT-S19-95: Gate 判定前被拒绝不写', () => {
    const mismatch = fixture('MM', { proposalModule: 'team' });
    expect(runCli(mismatch, ['deploy-done', '--env', 'team-prod', '--ref', head(mismatch), '--format', 'json']).status).toBe(0);
    const r1 = runCli(mismatch, ['smoke', '--env', 'prod', '--format', 'json']);
    expect(errorOf(r1).code).toBe('ENV_MODULE_MISMATCH');
    const invalid = fixture('MM', { proposalModule: null, teamEnvironments: ['team-prod', 'no-such-env'] });
    const r2 = runCli(invalid, ['smoke', '--env', 'team-prod', '--format', 'json']);
    expect(errorOf(r2).code).toBe('ENV_GATE_REFERENCE_UNKNOWN');
    // ③ 未登记的环境：环境解析阶段即拒绝（版本上下文缺部署记录时 smoke 仍会算出 Gate，不属于判定前拒绝）
    const noDeploy = fixture('MM', { proposalModule: null });
    const r3 = runCli(noDeploy, ['smoke', '--env', 'no-such-env', '--format', 'json']);
    expect(r3.status).not.toBe(0);
    expect(r3.stdout.trim()).toBe('');
    expect(errorOf(r3).code).toBe('ENV_UNKNOWN');
    for (const root of [mismatch, invalid, noDeploy]) expect(report(root, 'team')).toBeNull();
  });

  it('UT-S19-96: 写入白名单含模块冒烟报告', () => {
    const root = fixture('MM', { proposalModule: null });
    const allow = smokeReportAllowPaths(root, 'logos/resources/verify/smoke-results.jsonl', 'logos/resources/verify/smoke-report.md');
    expect(allow).toContain(TEAM_SMOKE);
    expect(allow).not.toContain(`${VERIFY}/core-smoke-report.md`);
    const single = fixture('S1');
    expect(smokeReportAllowPaths(single, 'r.jsonl', 'x.md').sort()).toEqual(['logos/resources/verify/smoke-report.md', 'r.jsonl', 'x.md'].sort());
  });

  it('UT-S19-97: 共用报告路径指向其他模块凭据时不越权（delta-r1 F1）', () => {
    for (const preset of [false, true]) {
      const root = fixture('MM');
      setConfig(root, c => { c.smoke.report_path = TEAM_SMOKE; });
      put(root, `${VERIFY}/team-acceptance-report.md`, ACCEPT);
      put(root, `${VERIFY}/team-deployment-report.md`, DEPLOYED);
      const legacy = '# Smoke Report\n\n## Summary\n\n| Metric | Value |\n|--------|-------|\n| **Gate 3.8** | **PASS** |\n';
      if (preset) put(root, TEAM_SMOKE, legacy);
      expect(runCli(root, ['deploy-done', '--format', 'json']).status).toBe(0);
      const r = runCli(root, ['smoke', '--format', 'json']);
      const d = dataOf<any>(r);
      expect(d.gate.result).toBe('PASS');
      expect(d.report_path).toBe('logos/resources/verify/smoke-report.md');
      expect(d.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'smoke_report_path_reserved', config_key: 'smoke.report_path', path: TEAM_SMOKE })]));
      expect(report(root, 'team')).toBe(preset ? legacy : null);
      expect(isModuleReportComplete(root, 'team', 'smoke')).toBe(false);
      const launch = runCli(root, ['launch', 'team']);
      expect(launch.status).toBe(1);
      expect(launch.stderr).toContain(TEAM_SMOKE);
    }
  });

  it('UT-S19-97（code-r1 F3 / code-r2 F3）: smoke 结果路径落在模块报告保留路径时改写到默认路径、不写保留路径、不新增错误码', () => {
    const target = `${VERIFY}/team-deployment-report.md`;
    for (const [key, mutate] of [
      ['smoke.result_path', (c: any) => { c.smoke.result_path = target; }],
      ['smoke.modules.team.result_path', (c: any) => { c.smoke.modules.team.result_path = target; }],
    ] as const) {
      const root = fixture('MM', { proposalModule: null });
      deployTeamWithoutReport(root);
      setConfig(root, mutate);
      const r = runCli(root, ['smoke', '--env', 'team-prod', '--format', 'json']);
      expect(r.stderr, key).toBe(''); // 不以错误信封退出（不新增错误码）
      const d = dataOf<any>(r);
      expect(d.result_path, key).toBe('logos/resources/verify/smoke-results.jsonl');
      expect(d.diagnostics, key).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'smoke_report_path_reserved', config_key: key, path: target })]));
      expect(d.gate.result, key).toBe('PASS'); // runner 按注入的 OPENLOGOS_SMOKE_RESULT_PATH 写到默认路径
      expect(existsSync(join(root, target)), key).toBe(false); // 零写入：CLI 未截断、未写入保留路径
      expect(isModuleReportComplete(root, 'team', 'deployment'), key).toBe(false); // 部署凭据不成立
      expect(rows(root, 'team').get('Module'), key).toBe('team'); // 正常写出的是 team 自己的模块冒烟报告
    }
  });

  it('UT-S19-98: 模块级 report_path 与本模块凭据同名时的写入次序', () => {
    const root = fixture('MM', { proposalModule: null });
    setConfig(root, c => { c.smoke.modules.team.report_path = TEAM_SMOKE; });
    deployTeam(root);
    const r = runCli(root, ['smoke', '--env', 'team-prod', '--format', 'json']);
    const d = dataOf<any>(r);
    expect(d.report_path).toBe('logos/resources/verify/smoke-report.md');
    expect(d.environment_evidence).toBeTruthy(); // 环境证据收尾已重写共用报告
    expect(d.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'smoke_report_path_reserved', config_key: 'smoke.modules.team.report_path' })]));
    expect(rows(root, 'team').get('Module')).toBe('team');
    expect(rows(root, 'team').get('Gate 3.8')).toBe(d.gate.result);
    expect(readFileSync(join(root, VERIFY, 'smoke-report.md'), 'utf-8')).not.toContain('| Module |');
  });

  it('UT-S19-99: 单模块项目不设保留路径', () => {
    const root = fixture('S1');
    setConfig(root, c => { c.smoke.report_path = `${VERIFY}/core-smoke-report.md`; });
    expect(runCli(root, ['deploy-done', '--env', 'test', '--ref', head(root), '--format', 'json']).status).toBe(0);
    const d = dataOf<any>(runCli(root, ['smoke', '--env', 'test', '--format', 'json']));
    expect(d.report_path).toBe(`${VERIFY}/core-smoke-report.md`);
    expect(d.diagnostics.map((x: any) => x.code)).not.toContain('smoke_report_path_reserved');
    expect(readFileSync(join(root, VERIFY, 'core-smoke-report.md'), 'utf-8')).not.toContain('| Module |');
  });
});

describe('S19 多模块项目模块冒烟报告端到端（module-scoped-phase-reports）', () => {
  it('ST-S19-33: 端到端——team 模块冒烟报告 PASS 后离开 3-8', () => {
    const root = fixture('MM');
    prepareTeamPhases(root);
    const proposalBefore = snapshot(root, PROPOSAL_REL);
    deployTeam(root);
    expect(existsSync(join(root, VERIFY, 'team-deployment-report.md'))).toBe(true);
    const r = runCli(root, ['smoke', '--env', 'team-prod', '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    expect(rows(root, 'team').get('Gate 3.8')).toBe('PASS');
    const p = teamProgress(root);
    expect(p['phase.3-7-deploy'].done).toBe(true);
    expect(p['phase.3-8-smoke'].done).toBe(true);
    expect(snapshot(root, PROPOSAL_REL)).toEqual(proposalBefore);
    expect(dataOf<any>(runCli(root, ['next', '--format', 'json'])).proposal_step).toBe('ready-to-deploy');
  });
});
