/**
 * S14 多模块 initial 模块 launch 前置（module-scoped-phase-reports，功能规格 §2.99.3、§2.99.8）。
 * 夹具 ML：core（launched）+ team（initial、normal，需要部署与冒烟）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { launch } from '../src/commands/launch.js';
import { collectStatusData } from '../src/commands/status.js';

const VERIFY = 'logos/resources/verify';

const report = (title: string, gate: string, value: string, moduleId: string | null, extra = '') =>
  `# ${title}\n\n## Summary\n\n| Metric | Value |\n|--------|-------|\n${moduleId === null ? '' : `| Module | ${moduleId} |\n`}`
  + `| Defined cases | 1 |\n| **${gate}** | **${value}** |\n\n${extra}`;
const acceptance = (value = 'PASS', moduleId: string | null = 'team', extra = '') => report('Acceptance Report', 'Gate 3.5', value, moduleId, extra);
const smoke = (value = 'PASS', moduleId: string | null = 'team', extra = '') => report('Smoke Report', 'Gate 3.8', value, moduleId, extra);
const DEPLOY = '# Deployment Report\n\n## Deployment 2026-10-25 → team-prod\n\n- deploy_id: d1\n';

describe('S14 多模块 initial 模块的 launch 前置（module-scoped-phase-reports）', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  const at = (rel: string) => join(root, rel);
  const write = (rel: string, content: string) => { mkdirSync(join(at(rel), '..'), { recursive: true }); writeFileSync(at(rel), content); };
  const yaml = () => parseYaml(readFileSync(at('logos/logos-project.yaml'), 'utf-8'));
  const setModules = (teamExtra: Record<string, unknown> = {}) => writeFileSync(at('logos/logos-project.yaml'), stringifyYaml({
    modules: [
      { id: 'core', name: 'Core', lifecycle: 'launched' },
      { id: 'team', name: 'Team', lifecycle: 'initial', ...teamExtra },
    ],
  }));
  const writeTeam = (which: { acceptance?: string; deployment?: string; smoke?: string }) => {
    if (which.acceptance !== undefined) write(`${VERIFY}/team-acceptance-report.md`, which.acceptance);
    if (which.deployment !== undefined) write(`${VERIFY}/team-deployment-report.md`, which.deployment);
    if (which.smoke !== undefined) write(`${VERIFY}/team-smoke-report.md`, which.smoke);
  };
  const writeShared = (value = 'PASS') => {
    write(`${VERIFY}/acceptance-report.md`, acceptance(value, null));
    write(`${VERIFY}/deployment-report.md`, DEPLOY);
    write(`${VERIFY}/smoke-report.md`, smoke(value, null));
  };
  /** 执行 launch team，返回是否被拒（process.exit(1)）。 */
  const tryLaunch = (moduleId = 'team'): boolean => {
    try { launch(moduleId); return false; } catch (e) { if (/process\.exit\(1\)/.test(String(e))) return true; throw e; }
  };
  const expectRejectedNamed = (path: string) => {
    const before = readFileSync(at('logos/logos-project.yaml'), 'utf-8');
    expect(tryLaunch()).toBe(true);
    expect(con.errors.join('\n')).toContain(path);
    expect(readFileSync(at('logos/logos-project.yaml'), 'utf-8')).toBe(before);
    expect(existsSync(at('AGENTS.md'))).toBe(false); // AI 资产未写
    con.errors.length = 0;
  };

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'en' });
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
    setModules();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  it('UT-S14-22: 验收按模块报告 Gate 行判定', () => {
    writeShared();
    expectRejectedNamed(`${VERIFY}/team-acceptance-report.md`); // ① 只有共用报告
    writeTeam({ acceptance: acceptance('FAIL'), deployment: DEPLOY, smoke: smoke() });
    expectRejectedNamed(`${VERIFY}/team-acceptance-report.md`); // ② Gate FAIL
    writeTeam({ acceptance: '# Acceptance Report\n\n## Summary\n\n| Metric | Value |\n|---|---|\n| Module | team |\n\nPASS\n' });
    expectRejectedNamed(`${VERIFY}/team-acceptance-report.md`); // ③ 无 Gate 行
    expect(yaml().modules[1].lifecycle).toBe('initial');
  });

  it('UT-S14-23: 部署只认本模块部署报告', () => {
    writeShared();
    write(`${VERIFY}/core-deployment-report.md`, DEPLOY);
    writeTeam({ acceptance: acceptance(), smoke: smoke() });
    expectRejectedNamed(`${VERIFY}/team-deployment-report.md`);
  });

  it('UT-S14-24: 错误信息中的 PASS 不算通过', () => {
    writeTeam({ acceptance: acceptance(), deployment: DEPLOY, smoke: smoke('FAIL', 'team', '## Failed Cases\n\n- SMOKE-team-01: expected PASS\n') });
    expectRejectedNamed(`${VERIFY}/team-smoke-report.md`);
  });

  it('UT-S14-25: 不需要部署 / 冒烟时不检查对应模块报告', () => {
    setModules({ deployment_required: false });
    writeTeam({ acceptance: acceptance() });
    expect(tryLaunch()).toBe(false);
    expect(yaml().modules[1].lifecycle).toBe('launched');
  });

  it('UT-S14-26: 单模块项目判定不变', () => {
    writeFileSync(at('logos/logos-project.yaml'), stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }] }));
    // 缺共用验收报告 → 既有 launch.verifyRequired 原文
    expect(tryLaunch('core')).toBe(true);
    expect(con.errors.join('\n')).toContain('Module "core" cannot launch before `openlogos verify` passes and writes logos/resources/verify/acceptance-report.md.');
    con.errors.length = 0;
    // 只有共用报告（无任何模块报告）→ 成功
    writeShared();
    expect(tryLaunch('core')).toBe(false);
    expect(yaml().modules[0].lifecycle).toBe('launched');
  });

  it('UT-S14-27: 报告不属于本模块或不是合格文件时拒绝（delta-r1 F1、F2）', () => {
    writeTeam({ acceptance: acceptance(), deployment: DEPLOY, smoke: smoke('PASS', null) });
    expectRejectedNamed(`${VERIFY}/team-smoke-report.md`); // ① 缺「模块」行
    writeTeam({ smoke: smoke('PASS', 'core') });
    expectRejectedNamed(`${VERIFY}/team-smoke-report.md`); // ② 「模块」行为 core
    writeTeam({ smoke: smoke() });
    rmSync(at(`${VERIFY}/team-deployment-report.md`));
    mkdirSync(at(`${VERIFY}/team-deployment-report.md`));
    expectRejectedNamed(`${VERIFY}/team-deployment-report.md`); // ③ 同名目录
    rmSync(at(`${VERIFY}/team-deployment-report.md`), { recursive: true });
    writeTeam({ deployment: '' });
    expectRejectedNamed(`${VERIFY}/team-deployment-report.md`); // ④ 0 字节
  });

  it('ST-S14-27: 多模块 initial 模块凭模块报告 launch 成功', () => {
    write(`${VERIFY}/acceptance-report.md`, acceptance('FAIL', null)); // 共用报告 FAIL 不影响结论
    writeTeam({ acceptance: acceptance(), deployment: DEPLOY, smoke: smoke() });
    expect(tryLaunch()).toBe(false);
    expect(yaml().modules.find((m: { id: string }) => m.id === 'team').lifecycle).toBe('launched');
    expect(existsSync(at('AGENTS.md'))).toBe(true);
    const status = collectStatusData(root);
    expect(status.modules!.find(m => m.id === 'team')!.lifecycle).toBe('launched');
    expect(status.modules!.find(m => m.id === 'core')!.lifecycle).toBe('launched');
  });

  it('ST-S14-28: 只有共用报告时拒绝 launch', () => {
    writeShared();
    expectRejectedNamed(`${VERIFY}/team-acceptance-report.md`);
  });
});
