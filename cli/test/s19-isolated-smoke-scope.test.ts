/**
 * smoke-scope-isolated-modules：独立 smoke 模块的应覆盖集合（spec/environments.md §14.5；spec/test-results.md「应覆盖用例」；
 * 功能规格 §2.98.6；决策 C01、proposal-r1 F1、delta-r1 F1）。
 *
 * 用例 ID 与 logos/resources/test/core-S19-test-cases.md「S19 独立 smoke 模块的应覆盖集合测试」对齐（UT-S19-83～89、ST-S19-32）。
 * 夹具 RL（runlogos 形态）见 test/s19-module-env-fixtures.ts：core、team 前缀规格与两份不带前缀、ID 段不统一的 core 发布规格；
 * team 配置 smoke.modules.team.command（独立 smoke 模块），core 没有。结果由全局 OpenLogos reporter 写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolatedSmokeModules, resolveSmokeCaseSet } from '../src/lib/smoke-scope.js';
import {
  LEDGER_REL, PROPOSAL_REL, RL_RELEASE_SPECS, buildEnvProject, callsLogPath, dataOf, git, runCli, snapshot,
  type CliRun, type EnvFixtureOptions,
} from './s19-module-env-fixtures.js';

const OFFICIAL = RL_RELEASE_SPECS['official-release-package-1-0-4.md'];
const REBUILD = RL_RELEASE_SPECS['release-1-0-3-rebuild-5.md'];
const ALL = ['SMOKE-core-01', 'SMOKE-core-02', OFFICIAL, REBUILD, 'SMOKE-team-01'].sort();
const MODULES = ['core', 'team'];

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function rl(opts: EnvFixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-ssim-'));
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(callsLogPath(root), { force: true });
  });
  return buildEnvProject(root, 'RL', opts);
}

interface Smoke {
  summary: { defined_count: number; executed_count: number };
  gate: { result: string; reason: string | null };
  failed_cases: Array<{ id: string }>;
  uncovered_cases: string[];
  result_path: string;
  report_path: string;
  scope?: { reasons: string[]; command_source: string; out_of_scope_result_count: number; module: string | null };
}

function smokeRun(root: string, args: string[] = []): { run: CliRun; data: Smoke } {
  const run = runCli(root, ['smoke', ...args, '--format', 'json']);
  if (!run.stdout.trim()) throw new Error(`smoke ${args.join(' ')} 无输出：${run.stderr}`);
  return { run, data: dataOf<Smoke>(run) };
}

function editConfig(root: string, edit: (cfg: Record<string, any>) => void): void {
  const file = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, any>;
  edit(cfg);
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}

/** runner 变体：tools/<label>-ids.json 覆盖默认 ID 列表，tools/extra.jsonl 逐行追加结果。 */
const ids = (root: string, label: 'project' | 'team', list: string[]) => writeFileSync(join(root, `tools/${label}-ids.json`), JSON.stringify(list));
const extra = (root: string, rows: Array<{ id: string; status: string }>) =>
  writeFileSync(join(root, 'tools/extra.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

const calls = (root: string) => existsSync(callsLogPath(root))
  ? readFileSync(callsLogPath(root), 'utf-8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>).filter(c => 'runner' in c)
  : [];

function changeCase(root: string, file: string, id: string): void {
  const dir = join(root, PROPOSAL_REL, 'deltas/test/smoke');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, file), `## MODIFIED — 变更\n\n| ID | 描述 |\n|---|---|\n| ${id} | 已修改 |\n`);
}

function versionDeployTeam(root: string): void {
  const head = git(root, ['rev-parse', 'HEAD']);
  const r = runCli(root, ['deploy', '--env', 'team-prod', '--ref', head, '--format', 'json']);
  expect(r.status, r.stderr).toBe(0);
  expect(dataOf<{ channel: string }>(r).channel).toBe('version');
}

/** core 活跃提案落标（core 未声明环境：不传 --env）。 */
function coreDeployDone(root: string): void {
  const r = runCli(root, ['deploy-done', '--format', 'json']);
  expect(r.status, r.stderr).toBe(0);
}

describe('S19 独立 smoke 模块的应覆盖集合（smoke-scope-isolated-modules）', () => {
  it('UT-S19-83: 独立模块判定——只有有效非空 command 的已登记模块是独立模块', () => {
    const root = rl();
    const variants: Array<[string, Record<string, unknown>, string[]]> = [
      ['command', { team: { command: 'node scripts/smoke-team.js' } }, ['team']],
      ['空串 command', { team: { command: '' } }, []],
      ['空白 command', { team: { command: '   ' } }, []],
      ['只写 result_path', { team: { result_path: 'logos/resources/verify/team.jsonl' } }, []],
      ['只写 report_path', { team: { report_path: 'logos/resources/verify/team.md' } }, []],
      ['空对象', { team: {} }, []],
      ['未登记 portal', { portal: { command: 'node scripts/smoke-portal.js' } }, []],
    ];
    for (const [label, modules, expected] of variants) {
      editConfig(root, cfg => { cfg.smoke.modules = modules; });
      expect(isolatedSmokeModules(root), label).toEqual(expected);
    }
    // 未登记的 portal 另报 smoke_module_unknown（门禁不受影响），且不算独立模块
    coreDeployDone(root);
    const { data } = smokeRun(root);
    expect((data as unknown as { diagnostics: Array<{ code: string; module?: string }> }).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'smoke_module_unknown', module: 'portal' }));
    expect(data.scope?.reasons).not.toContain('isolated_module');
  }, 120_000);

  it('UT-S19-84: 独立模块不计入不带前缀的规格——team 版本上下文 smoke 不被发布 smoke 拖成 uncovered', () => {
    const root = rl();
    versionDeployTeam(root);
    const { run, data } = smokeRun(root, ['--env', 'team-prod']);
    expect(run.status, run.stderr).toBe(0);
    expect(data.summary.defined_count).toBe(1);
    expect(data.uncovered_cases).toEqual([]);
    expect(data.gate.result).toBe('PASS');
    expect(data.scope).toMatchObject({ module: 'team', command_source: 'module' });
    expect(data.scope?.reasons).toEqual(['env', 'isolated_module']);
    expect(resolveSmokeCaseSet(root, MODULES, 'team', [], ['team']).caseIds).toEqual(['SMOKE-team-01']);
  }, 120_000);

  it('UT-S19-85: 非独立模块计入不带前缀的规格——全 pass 通过、缺结果 uncovered、fail 阻断', () => {
    // ① 项目级 runner 写全部结果
    const one = rl();
    coreDeployDone(one);
    const a = smokeRun(one).data;
    expect(a.gate.result).toBe('PASS');
    expect(a.summary.defined_count).toBe(4); // core 前缀 2 + 不带前缀发布 2，不含 team
    expect(a.scope?.out_of_scope_result_count).toBe(1); // team-01
    expect(a.scope?.reasons).toEqual(['proposal']);
    expect(resolveSmokeCaseSet(one, MODULES, 'core', [], ['team']).caseIds).toEqual(['SMOKE-core-01', 'SMOKE-core-02', OFFICIAL, REBUILD].sort());

    // ② 不写 SMOKE-official104-01 → uncovered，门禁不通过
    const two = rl();
    coreDeployDone(two);
    ids(two, 'project', ALL.filter(id => id !== OFFICIAL));
    const b = smokeRun(two).data;
    expect(b.uncovered_cases).toEqual([OFFICIAL]);
    expect(b.gate.result).toBe('FAIL');
    expect(b.scope?.out_of_scope_result_count).toBe(1);

    // ③ SMOKE-official104-01 写为 fail → failed_cases，FAIL
    const three = rl();
    coreDeployDone(three);
    ids(three, 'project', ALL.filter(id => id !== OFFICIAL));
    extra(three, [{ id: OFFICIAL, status: 'fail' }]);
    const c = smokeRun(three).data;
    expect(c.failed_cases.map(f => f.id)).toEqual([OFFICIAL]);
    expect(c.gate.result).toBe('FAIL');
    expect(c.scope?.out_of_scope_result_count).toBe(1);
  }, 180_000);

  it('UT-S19-86: 只配置路径覆盖的模块不是独立模块（proposal-r1 F1）', () => {
    const variants: Array<[string, Record<string, string>]> = [
      // 多模块项目中 <id>-smoke-report.md 是模块报告保留路径（module-scoped-phase-reports §2.99.2），路径覆盖用非保留文件名
      ['只写 report_path', { report_path: 'logos/resources/verify/core-smoke-custom.md' }],
      ['只写 result_path', { result_path: 'logos/resources/verify/core-smoke-results.jsonl' }],
      ['空对象', {}],
    ];
    for (const [label, core] of variants) {
      const root = rl();
      editConfig(root, cfg => { cfg.smoke.modules.core = core; });
      coreDeployDone(root);
      ids(root, 'project', ALL.filter(id => id !== OFFICIAL));
      extra(root, [{ id: OFFICIAL, status: 'fail' }]);
      const { data } = smokeRun(root);
      expect(calls(root), label).toEqual([expect.objectContaining({ runner: 'project', module: 'core' })]);
      expect(data.scope?.command_source, label).toBe('project');
      expect(data.scope?.reasons, label).not.toContain('isolated_module');
      expect(data.summary.defined_count, label).toBe(4);
      expect(data.failed_cases.map(f => f.id), label).toEqual([OFFICIAL]);
      expect(data.gate.result, label).toBe('FAIL');
      expect(data.scope?.out_of_scope_result_count, label).toBe(1); // 只有 team-01，发布用例不计入
      if (core.report_path) {
        expect(data.report_path).toBe(core.report_path);
        expect(existsSync(join(root, core.report_path)), label).toBe(true);
      }
      if (core.result_path) {
        expect(data.result_path).toBe(core.result_path);
        expect(readFileSync(join(root, core.result_path), 'utf-8'), label).toContain(OFFICIAL);
      }
    }
  }, 240_000);

  it('UT-S19-87: 无独立模块时每个模块为全部规格（范围扩大、不缩小）', () => {
    for (const [label, modules] of [['不配置 smoke.modules', undefined], ['team 只写 report_path', { team: { report_path: 'logos/resources/verify/team.md' } }]] as const) {
      // team 版本上下文
      const team = rl();
      editConfig(team, cfg => { if (modules) cfg.smoke.modules = modules; else delete cfg.smoke.modules; });
      versionDeployTeam(team);
      const t = smokeRun(team, ['--env', 'team-prod']).data;
      expect(t.summary.defined_count, label).toBe(ALL.length);
      expect(t.scope?.out_of_scope_result_count, label).toBe(0);
      expect(t.gate.result, label).toBe('PASS');
      expect(t.scope?.reasons, label).not.toContain('isolated_module');
      // core 提案
      const core = rl();
      editConfig(core, cfg => { if (modules) cfg.smoke.modules = modules; else delete cfg.smoke.modules; });
      coreDeployDone(core);
      const c = smokeRun(core).data;
      expect(c.summary.defined_count, label).toBe(ALL.length);
      expect(c.gate.result, label).toBe('PASS');
    }
    expect(resolveSmokeCaseSet(rl(), MODULES, 'team', [], []).caseIds).toEqual(ALL);
  }, 240_000);

  it('UT-S19-88: 变更用例 C 跨独立模块照旧计入——pass 覆盖、fail 阻断、缺结果 uncovered', () => {
    const build = () => {
      const root = rl({ proposalModule: 'team' });
      changeCase(root, 'official-release-package-1-0-4.md', OFFICIAL);
      changeCase(root, 'core-smoke-test-cases.md', 'SMOKE-core-01');
      const dd = runCli(root, ['deploy-done', '--env', 'team-prod', '--format', 'json']);
      expect(dd.status, dd.stderr).toBe(0);
      return root;
    };
    const untouched = [{ id: REBUILD, status: 'pass' }, { id: 'SMOKE-core-02', status: 'pass' }];

    const pass = build();
    extra(pass, [{ id: OFFICIAL, status: 'pass' }, { id: 'SMOKE-core-01', status: 'pass' }, ...untouched]);
    const a = smokeRun(pass, ['--env', 'team-prod']).data;
    expect(a.summary.defined_count).toBe(3); // team-01 + 两条变更用例
    expect(a.gate.result).toBe('PASS');
    expect(a.scope?.out_of_scope_result_count).toBe(2);

    const fail = build();
    extra(fail, [{ id: OFFICIAL, status: 'fail' }, { id: 'SMOKE-core-01', status: 'fail' }, ...untouched]);
    const b = smokeRun(fail, ['--env', 'team-prod']).data;
    expect(b.failed_cases.map(f => f.id).sort()).toEqual(['SMOKE-core-01', OFFICIAL].sort());
    expect(b.gate.result).toBe('FAIL');
    expect(b.scope?.out_of_scope_result_count).toBe(2);

    const missing = build();
    extra(missing, untouched);
    const c = smokeRun(missing, ['--env', 'team-prod']).data;
    expect(c.uncovered_cases.sort()).toEqual(['SMOKE-core-01', OFFICIAL].sort());
    expect(c.gate.result).toBe('FAIL');
    expect(c.scope?.out_of_scope_result_count).toBe(2);
  }, 240_000);

  it('UT-S19-89: 多个独立模块互相扣除；前缀按已登记模块 id 最长匹配归属', () => {
    const root = rl();
    writeFileSync(join(root, 'logos/resources/test/smoke/portal-smoke-test-cases.md'), '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-portal-01 | p |\n');
    writeFileSync(join(root, 'logos/resources/test/smoke/team-x-smoke-test-cases.md'), '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-teamx-01 | x |\n');
    const modules = ['core', 'team', 'portal', 'team-x'];
    const isolated = ['team', 'portal'];
    expect(resolveSmokeCaseSet(root, modules, 'team', [], isolated).caseIds).toEqual(['SMOKE-team-01']);
    expect(resolveSmokeCaseSet(root, modules, 'portal', [], isolated).caseIds).toEqual(['SMOKE-portal-01']);
    // core：全部规格扣除 team- 与 portal- 前缀；team-x- 前缀归 team-x（非独立），不被当作 team 扣除
    expect(resolveSmokeCaseSet(root, modules, 'core', [], isolated).caseIds)
      .toEqual(['SMOKE-core-01', 'SMOKE-core-02', OFFICIAL, REBUILD, 'SMOKE-teamx-01'].sort());
    // team-x 独立时只认 team-x- 前缀
    expect(resolveSmokeCaseSet(root, modules, 'team-x', [], [...isolated, 'team-x']).caseIds).toEqual(['SMOKE-teamx-01']);
  }, 60_000);

  it('ST-S19-32: runlogos 形态端到端——独立 team 与非独立 core 各自 smoke', () => {
    const root = rl();
    const before = snapshot(root, PROPOSAL_REL);
    // ①② team 版本部署与 team smoke：只执行 team 命令、只覆盖 team 前缀用例，core 提案目录不变
    versionDeployTeam(root);
    const team = smokeRun(root, ['--env', 'team-prod']);
    expect(team.run.status, team.run.stderr).toBe(0);
    expect(team.data.gate.result).toBe('PASS');
    expect(team.data.summary.defined_count).toBe(1);
    expect(team.data.uncovered_cases).toEqual([]);
    expect(calls(root)).toEqual([expect.objectContaining({ runner: 'team', module: 'team' })]);
    expect(snapshot(root, PROPOSAL_REL)).toEqual(before);
    for (const m of ['DEPLOY_DONE', 'SMOKE_PASS', 'SMOKE_FAIL']) expect(existsSync(join(root, PROPOSAL_REL, m)), m).toBe(false);
    expect(readFileSync(join(root, LEDGER_REL), 'utf-8')).toContain('"kind":"smoke"');

    // ③ core 落标与 smoke：全部结果 → 通过且含两份发布用例；发布用例改为 fail → FAIL
    coreDeployDone(root);
    const first = smokeRun(root).data;
    expect(first.gate.result).toBe('PASS');
    expect(first.summary.defined_count).toBe(4);
    expect(first.scope?.out_of_scope_result_count).toBe(1);
    ids(root, 'project', ALL.filter(id => id !== OFFICIAL));
    extra(root, [{ id: OFFICIAL, status: 'fail' }]);
    const second = smokeRun(root).data;
    expect(second.gate.result).toBe('FAIL');
    expect(second.failed_cases.map(f => f.id)).toEqual([OFFICIAL]);
    expect(second.scope?.out_of_scope_result_count).toBe(1);
  }, 240_000);
});
