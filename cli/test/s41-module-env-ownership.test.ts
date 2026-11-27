/**
 * module-scoped-env-smoke 切片2：环境按模块归属（spec/environments.md §2.3、§14.1～§14.4，功能规格 §2.98）。
 *
 * 用例 ID 与 logos/resources/test/core-S41-test-cases.md「按模块的环境归属」对齐（UT-S41-24～29、ST-S41-07）。
 * 夹具 S1 / M0 / MM 见 test/s19-module-env-fixtures.ts；零回归基准为修改前（0.16.9）CLI 的实测输出，
 * 入库于 test/fixtures/s19-module-env-baseline.json，不在测试内复述。结果由全局 OpenLogos reporter 写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { loadEnvironmentRegistry, resolveEnvironment } from '../src/lib/environments.js';
import type { EnvironmentDef } from '../src/lib/environments.js';
import {
  activeProposalModule, isModuleScopeEnabled, modulesOwning, resolveModuleEnvironments, resolveTargetModule,
} from '../src/lib/module-env-scope.js';
import {
  LEDGER_REL, MES_BASELINE_FILE, PROPOSAL_REL, SLUG, buildEnvProject, callsLogPath, dataOf, errorOf, readJson, runCli, snapshot,
  zeroRegressionRun, type CliRun, type EnvFixtureOptions, type EnvKind,
} from './s19-module-env-fixtures.js';
import { stripDefaultManualAcceptanceFromRun } from './manual-acceptance-golden.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function project(kind: EnvKind, opts: EnvFixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mes41-'));
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(callsLogPath(root), { force: true });
  });
  return buildEnvProject(root, kind, opts);
}

function registryOf(root: string): EnvironmentDef[] {
  const reg = loadEnvironmentRegistry(root);
  if (reg.state !== 'loaded') throw new Error(`registry ${reg.state}`);
  return reg.environments;
}

function editYaml(root: string, rel: string, edit: (doc: Record<string, unknown>) => void): void {
  const file = join(root, rel);
  const doc = parseYaml(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  edit(doc);
  writeFileSync(file, stringifyYaml(doc, { lineWidth: 0 }));
}

function editConfig(root: string, edit: (cfg: Record<string, any>) => void): void {
  const file = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, any>;
  edit(cfg);
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}

const baseline = () => readJson(MES_BASELINE_FILE) as { runs: Record<string, Record<string, CliRun>> };

describe('S41 按模块的环境归属（module-scoped-env-smoke 切片2）', () => {
  it('UT-S41-24: 启用判定先于解析——S1、M0、空数组未启用；MM、只配置 smoke.modules 启用', () => {
    expect(isModuleScopeEnabled(project('S1'))).toBe(false);
    expect(isModuleScopeEnabled(project('M0'))).toBe(false);
    expect(isModuleScopeEnabled(project('MM'))).toBe(true);

    const smokeOnly = project('M0');
    editConfig(smokeOnly, cfg => { cfg.smoke.modules = { team: { command: 'node scripts/smoke-team.js' } }; });
    expect(isModuleScopeEnabled(smokeOnly)).toBe(true);

    const emptyArray = project('M0');
    editYaml(emptyArray, 'logos/logos-project.yaml', doc => { doc.deployment_gates = { team: { environments: [] } }; });
    expect(isModuleScopeEnabled(emptyArray)).toBe(false);

    // 未启用时不读取登记表解析结果：登记表损坏（不可加载）不影响判定，也不抛错
    for (const root of [project('S1'), project('M0'), emptyArray]) {
      writeFileSync(join(root, 'logos/environments.yaml'), 'schema_version: [\n');
      expect(loadEnvironmentRegistry(root).state).toBe('unloadable');
      expect(isModuleScopeEnabled(root)).toBe(false);
    }
  }, 60_000);

  it('UT-S41-25: E(m) 解析——别名按 §3 解析；含未登记项为引用失效且不剔除；缺失与 [] 为未声明；共享环境两模块都归属', () => {
    const alias = project('MM', { teamEnvironments: ['team-production'] });
    const a = resolveModuleEnvironments(alias, registryOf(alias)).decls.get('team')!;
    expect(a).toEqual({ module: 'team', state: 'declared', environments: ['team-prod'], invalid_references: [] });

    const invalid = project('MM', { teamEnvironments: ['team-prod', 'team-production-old'] });
    const b = resolveModuleEnvironments(invalid, registryOf(invalid)).decls.get('team')!;
    expect(b.state).toBe('invalid');
    expect(b.invalid_references).toEqual(['team-production-old']);
    expect(b.environments).toEqual(['team-prod']);

    const missing = project('MM');
    editYaml(missing, 'logos/logos-project.yaml', doc => { doc.deployment_gates = { team: { smoke_required: true } }; });
    const c = resolveModuleEnvironments(missing, registryOf(missing)).decls.get('team')!;
    expect(c.state).toBe('undeclared');
    expect(resolveModuleEnvironments(missing, registryOf(missing)).decls.get('core')!.state).toBe('undeclared');

    const empty = project('MM', { teamEnvironments: [] });
    expect(resolveModuleEnvironments(empty, registryOf(empty)).decls.get('team')!.state).toBe('undeclared');

    const shared = project('MM', { coreEnvironments: ['team-prod'] });
    const map = resolveModuleEnvironments(shared, registryOf(shared));
    expect(modulesOwning(map, 'team-prod')).toEqual(['core', 'team']);
    expect(modulesOwning(map, 'prod')).toEqual([]);

    // 登记表不存在：全部视为未声明，不做引用校验
    expect(resolveModuleEnvironments(invalid, null).decls.get('team')!.state).toBe('undeclared');
  }, 60_000);

  it('UT-S41-26: 目标模块与部署上下文', () => {
    const root = project('MM');
    const envs = registryOf(root);
    const map = resolveModuleEnvironments(root, envs);
    const id = (input: string) => { const r = resolveEnvironment(envs, input); if (!r.ok) throw new Error(input); return r.id; };

    expect(id('TEAM-PRODUCTION')).toBe('team-prod');
    // core 提案 + team-prod → team、版本上下文
    for (const input of ['team-prod', 'TEAM-PRODUCTION']) {
      expect(resolveTargetModule(map, id(input), 'core')).toMatchObject({ mode: 'module', module: 'team', context: 'version', reasons: ['env'] });
    }
    // team 提案 + team-prod → team、提案上下文
    expect(resolveTargetModule(map, id('team-prod'), 'team')).toMatchObject({ mode: 'module', module: 'team', context: 'proposal' });
    // core 提案 + 不传 → core、提案上下文
    expect(resolveTargetModule(map, null, 'core')).toMatchObject({ mode: 'module', module: 'core', context: 'proposal', reasons: ['proposal'] });
    // 无提案 + 不传 → 不限定模块
    expect(resolveTargetModule(map, null, null)).toMatchObject({ mode: 'project', module: null, fallback: 'no_env_no_proposal' });
    // 无提案 + prod（不属于任何模块）→ 不限定模块
    expect(resolveTargetModule(map, id('prod'), null)).toMatchObject({ mode: 'project', module: null, fallback: 'env_unattributed' });
    // team 提案 + prod → 取提案模块（归属校验由命令报 ENV_MODULE_MISMATCH）
    expect(resolveTargetModule(map, id('prod'), 'team')).toMatchObject({ mode: 'module', module: 'team', context: 'proposal' });

    // 共享环境 + core 提案 → core、提案上下文；共享环境 + 无提案 → 不限定模块
    const shared = project('MM', { coreEnvironments: ['team-prod'] });
    const sharedMap = resolveModuleEnvironments(shared, registryOf(shared));
    expect(resolveTargetModule(sharedMap, 'team-prod', 'core')).toMatchObject({ mode: 'module', module: 'core', context: 'proposal' });
    expect(resolveTargetModule(sharedMap, 'team-prod', null)).toMatchObject({ mode: 'project', fallback: 'env_shared' });

    // 提案模块：proposal.md 头 → guard（resolveProposalModuleContext）
    const team = project('MM', { proposalModule: 'team' });
    expect(activeProposalModule(team, SLUG, join(team, PROPOSAL_REL), null)).toBe('team');
    expect(activeProposalModule(root, SLUG, join(root, PROPOSAL_REL), null)).toBe('core');
  }, 60_000);

  it('UT-S41-27: env list / show 的 modules；M0、S1 与零回归基准逐字节相同；env check 不变', () => {
    const mm = project('MM');
    const list = runCli(mm, ['env', 'list', '--format', 'json']);
    expect(list.status, list.stderr).toBe(0);
    const entries = dataOf<{ environments: Array<{ id: string; modules?: string[] }> }>(list).environments;
    expect(Object.fromEntries(entries.map(e => [e.id, e.modules]))).toEqual({ test: [], prod: [], 'team-prod': ['team'] });
    const show = runCli(mm, ['env', 'show', 'team-prod', '--format', 'json']);
    expect(show.status, show.stderr).toBe(0);
    expect(dataOf<{ environment: { modules?: string[] } }>(show).environment.modules).toEqual(['team']);
    const check = runCli(mm, ['env', 'check', '--format', 'json']);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).not.toContain('"modules"');
    // 文本模式：启用时附模块行
    expect(runCli(mm, ['env', 'show', 'team-prod']).stdout).toContain('Modules: team');

    const expected = baseline().runs;
    for (const kind of ['S1', 'M0'] as const) {
      const runs = zeroRegressionRun(project(kind));
      for (const step of ['env-list', 'env-show-test', 'env-check']) {
        expect(runs[step], `${kind} ${step}`).toEqual(expected[kind][step]);
        expect(runs[step].stdout, `${kind} ${step}`).not.toContain('"modules"');
      }
    }
  }, 180_000);

  it('UT-S41-28: 引用失效不降级——deploy-done / smoke / deploy 均 ENV_GATE_REFERENCE_UNKNOWN 零写入；core 不受影响；env check 仍报', () => {
    const broken: EnvFixtureOptions = { teamEnvironments: ['Team-Production'], teamProdAliases: [], teamProdRequireApproval: true };
    const root = project('MM', { ...broken, proposalModule: 'team' });
    const before = { proposal: snapshot(root, PROPOSAL_REL), ledger: snapshot(root, LEDGER_REL) };
    for (const args of [['deploy-done', '--env', 'team-prod'], ['smoke', '--env', 'team-prod'], ['deploy', '--env', 'team-prod']]) {
      const r = runCli(root, [...args, '--format', 'json']);
      expect(r.status, args[0]).toBe(1);
      const error = errorOf(r);
      expect(error.code, args[0]).toBe('ENV_GATE_REFERENCE_UNKNOWN');
      expect(error.details, args[0]).toEqual({ module: 'team', invalid_references: ['Team-Production'] });
    }
    expect(snapshot(root, PROPOSAL_REL)).toEqual(before.proposal);
    expect(snapshot(root, LEDGER_REL)).toEqual(before.ledger);
    expect(existsSync(join(root, PROPOSAL_REL, 'DEPLOY_DONE'))).toBe(false);
    expect(existsSync(callsLogPath(root))).toBe(false); // 部署脚本与 smoke runner 均未运行

    const check = runCli(root, ['env', 'check', '--format', 'json']);
    expect(check.status).toBe(1);
    expect(dataOf<{ errors: Array<{ code: string; module?: string }> }>(check).errors)
      .toContainEqual(expect.objectContaining({ code: 'ENV_GATE_REFERENCE_UNKNOWN', module: 'team' }));

    // core 活跃提案：team 的失效引用不影响 core 的 deploy-done
    const core = project('MM', broken);
    const done = runCli(core, ['deploy-done', '--format', 'json']);
    expect(done.status, done.stderr).toBe(0);
    expect(dataOf<{ environment: string | null }>(done).environment).toBeNull();
    expect(existsSync(join(core, PROPOSAL_REL, 'DEPLOY_DONE'))).toBe(true);
  }, 180_000);

  it('UT-S41-29: change-writer / deployment-designer 含多模块口径，sync 副本与根文件一致', () => {
    const cw = readFileSync(join(REPO, 'skills/change-writer/SKILL.md'), 'utf-8');
    const dd = readFileSync(join(REPO, 'skills/deployment-designer/SKILL.md'), 'utf-8');
    const cwRules = [
      '`proposal_default_env` 只在其环境条目的 `modules` 含提案模块',
      '提案模块没有声明任何环境（没有任何环境条目的 `modules` 含它）时，按「没有登记表」处理',
      '目标环境照旧询问',
    ];
    for (const rule of cwRules) expect(cw, `change-writer 含：${rule}`).toContain(rule);
    const ddRules = [
      '**多模块项目（module-scoped-env-smoke',
      '`deployment_gates.<module>.environments` 同时是「环境归属哪个模块」的唯一来源',
      '未声明环境的模块按「没有登记表」处理',
      '`ENV_GATE_REFERENCE_UNKNOWN`',
    ];
    for (const rule of ddRules) expect(dd, `deployment-designer 含：${rule}`).toContain(rule);

    const tmp = mkdtempSync(join(tmpdir(), 'ol-s41-mes-sync-zh-'));
    cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
    expect(spawnSync('git', ['init', '-q'], { cwd: tmp }).status).toBe(0);
    const init = runCli(tmp, ['init', '--locale', 'zh', '--ai-tool', 'other']);
    expect(init.status, init.stderr).toBe(0);
    const sync = runCli(tmp, ['sync']);
    expect(sync.status, sync.stderr).toBe(0);
    const copies = {
      cw: readFileSync(join(tmp, 'logos/skills/change-writer/SKILL.md'), 'utf-8'),
      dd: readFileSync(join(tmp, 'logos/skills/deployment-designer/SKILL.md'), 'utf-8'),
    };
    for (const rule of cwRules) expect(copies.cw, `change-writer 副本含：${rule}`).toContain(rule);
    for (const rule of ddRules) expect(copies.dd, `deployment-designer 副本含：${rule}`).toContain(rule);
    const paragraph = (text: string, marker: string) => text.split('\n').find(line => line.includes(marker));
    expect(paragraph(copies.cw, '多模块项目按模块区分')).toBe(paragraph(cw, '多模块项目按模块区分'));
    expect(paragraph(copies.dd, '多模块项目（module-scoped-env-smoke')).toBe(paragraph(dd, '多模块项目（module-scoped-env-smoke'));
  }, 120_000);

  it('ST-S41-07: 按模块环境归属端到端与未启用零回归', () => {
    // ① S1、M0：deploy-done / smoke / env list / env show 与零回归基准逐字节相同
    const expected = baseline().runs;
    for (const kind of ['S1', 'M0'] as const) {
      const runs = zeroRegressionRun(project(kind));
      for (const step of ['deploy-done', 'smoke', 'env-list', 'env-show-test']) {
        // smoke-manual-acceptance（§2.107.13）：剥离值为默认的 data.manual_acceptance 后逐字比对
        expect(stripDefaultManualAcceptanceFromRun(runs[step], `${kind} ${step}`), `${kind} ${step}`).toEqual(expected[kind][step]);
      }
    }

    // ② MM，core 活跃提案：deploy-done 与 smoke 不传 --env 均成功，DEPLOY_DONE.environment 为 null，未写部署账本
    const core = project('MM');
    const done = runCli(core, ['deploy-done', '--format', 'json']);
    expect(done.status, done.stderr).toBe(0);
    const marker = JSON.parse(readFileSync(join(core, PROPOSAL_REL, 'DEPLOY_DONE'), 'utf-8')) as { environment: string | null };
    expect(marker.environment).toBeNull();
    const smoke = runCli(core, ['smoke', '--format', 'json']);
    expect(smoke.status, smoke.stderr).toBe(0);
    expect(dataOf<{ gate: { result: string } }>(smoke).gate.result).toBe('PASS');
    expect(existsSync(join(core, LEDGER_REL))).toBe(false);

    // ③ MM，core 活跃提案：deploy-done --env team-prod → ENV_MODULE_MISMATCH，零写入
    const core2 = project('MM');
    const before2 = snapshot(core2, PROPOSAL_REL);
    const mismatch = runCli(core2, ['deploy-done', '--env', 'team-prod', '--format', 'json']);
    expect(mismatch.status).toBe(1);
    expect(errorOf(mismatch)).toMatchObject({
      code: 'ENV_MODULE_MISMATCH', details: { module: 'core', environment: 'team-prod', module_environments: [] },
    });
    expect(snapshot(core2, PROPOSAL_REL)).toEqual(before2);
    expect(existsSync(join(core2, LEDGER_REL))).toBe(false);

    // ④ MM，team 活跃提案：--env prod → ENV_MODULE_MISMATCH；不传 → ENV_REQUIRED；均零写入
    const team = project('MM', { proposalModule: 'team' });
    const before4 = snapshot(team, PROPOSAL_REL);
    const prod = runCli(team, ['deploy-done', '--env', 'prod', '--format', 'json']);
    expect(prod.status).toBe(1);
    expect(errorOf(prod)).toMatchObject({
      code: 'ENV_MODULE_MISMATCH', details: { module: 'team', environment: 'prod', module_environments: ['team-prod'] },
    });
    const none = runCli(team, ['deploy-done', '--format', 'json']);
    expect(none.status).toBe(1);
    expect(errorOf(none).code).toBe('ENV_REQUIRED');
    expect(snapshot(team, PROPOSAL_REL)).toEqual(before4);
    expect(existsSync(join(team, LEDGER_REL))).toBe(false);
  }, 300_000);
});
