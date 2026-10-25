/**
 * S11 多模块 initial 模块报告阶段派生（module-scoped-phase-reports，功能规格 §2.99.3、§2.99.4，
 * spec/flow-spec.md §9）。夹具 MR：core（launched）+ team（initial），team 的 phase.3-0～3-5 产物齐全。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd } from './helpers.js';
import { collectStatusData, deriveModulePhaseProgress, type ModuleInfo } from '../src/commands/status.js';
import { buildInitialPhasePlan, deriveModulePhaseProgressViaFlow } from '../src/lib/flow-derive.js';
import { deriveOverlayView } from '../src/lib/flow-overlay-derive.js';
import { isModuleReportComplete } from '../src/lib/module-phase-report.js';
import { next } from '../src/commands/next.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const VERIFY = 'logos/resources/verify';
const SCENARIOS = [{ id: 'S60' }];
const team = (over: Partial<ModuleInfo> = {}): ModuleInfo =>
  ({ id: 'team', name: 'Team', lifecycle: 'initial', bootstrap: 'normal', skip_phases: [], ...over });

function writeAt(root: string, rel: string, content = 'x') {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

function projectYaml(root: string, opts: { singleModule?: boolean; teamExtra?: string } = {}) {
  const y = opts.singleModule
    ? 'modules:\n  - id: core\n    name: Core\n    lifecycle: initial\nscenarios:\n  - id: S60\n    name: s\n    module: core\n'
    : 'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n'
      + `  - id: team\n    name: Team\n    lifecycle: initial\n${opts.teamExtra ?? ''}`
      + 'scenarios:\n  - id: S60\n    name: s\n    module: team\n';
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), y);
}

/** 为模块写 phase.3-0～3-5 全部产物（upTo 之前的阶段；upTo 为 null 表示全部）。 */
function writeArtifacts(root: string, moduleId: string, upTo: string | null = null) {
  for (const item of buildInitialPhasePlan()) {
    if (item.phaseKey === upTo) break;
    if (['phase.3-6', 'phase.3-7-deploy', 'phase.3-8-smoke'].includes(item.phaseKey)) continue;
    if (item.phaseKey === 'phase.3-1') writeAt(root, `${item.subpath}/${moduleId}-S60-x.md`);
    else if (item.phaseKey === 'phase.3-4a') writeAt(root, `${item.subpath}/${moduleId}-S60-test-cases.md`);
    else writeAt(root, `${item.subpath}/${moduleId}-x.md`);
  }
}

function summaryReport(title: string, gateLabel: string, gate: string, moduleId: string | null, extra = ''): string {
  const moduleRow = moduleId === null ? '' : `| Module | ${moduleId} |\n`;
  return `# ${title}\n\n> Generated\n\n## Summary\n\n| Metric | Value |\n|--------|-------|\n${moduleRow}`
    + `| Defined cases | 2 |\n| **${gateLabel}** | **${gate}** |\n\n${extra}`;
}
const acceptance = (gate = 'PASS', moduleId: string | null = 'team', extra = '') =>
  summaryReport('Acceptance Report', 'Gate 3.5', gate, moduleId, extra);
const smoke = (gate = 'PASS', moduleId: string | null = 'team', extra = '') =>
  summaryReport('Smoke Report', 'Gate 3.8', gate, moduleId, extra);
const DEPLOY = '# Deployment Report\n\n## Deployment 2026-10-25 → team-prod\n\n- deploy_id: d1\n';

function writeTeamReports(root: string, which: { acceptance?: boolean; deployment?: boolean; smoke?: boolean }) {
  if (which.acceptance) writeAt(root, `${VERIFY}/team-acceptance-report.md`, acceptance());
  if (which.deployment) writeAt(root, `${VERIFY}/team-deployment-report.md`, DEPLOY);
  if (which.smoke) writeAt(root, `${VERIFY}/team-smoke-report.md`, smoke());
}
function writeSharedReports(root: string) {
  writeAt(root, `${VERIFY}/acceptance-report.md`, acceptance('PASS', null));
  writeAt(root, `${VERIFY}/deployment-report.md`, DEPLOY);
  writeAt(root, `${VERIFY}/smoke-report.md`, smoke('PASS', null));
}

function fixture(opts: { upTo?: string | null; teamExtra?: string } = {}): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  cleanups.push(cleanup);
  projectYaml(root, { teamExtra: opts.teamExtra });
  writeArtifacts(root, 'team', opts.upTo ?? null);
  return root;
}

const derive = (root: string, m: ModuleInfo = team()) => deriveModulePhaseProgressViaFlow(root, m, SCENARIOS, true);
const teamStatus = (root: string) => collectStatusData(root).modules!.find(m => m.id === 'team')!;

describe('S11 多模块 initial 模块报告阶段派生（module-scoped-phase-reports）', () => {
  it('UT-S11-101: 报告判定共享函数——「模块」行须为目标模块、只读 Gate 行、部署须为非空普通文件', () => {
    const root = fixture();
    const judge = (phase: 'acceptance' | 'smoke', content: string | 'dir' | null) => {
      const rel = `${VERIFY}/team-${phase}-report.md`;
      const full = join(root, rel);
      if (content === 'dir') mkdirSync(full, { recursive: true });
      else if (content !== null) writeAt(root, rel, content);
      const r = isModuleReportComplete(root, 'team', phase);
      cleanupPath(full);
      return r;
    };
    for (const [phase, make] of [['acceptance', acceptance], ['smoke', smoke]] as const) {
      expect(judge(phase, make('PASS'))).toBe(true);
      expect(judge(phase, make('FAIL'))).toBe(false);
      expect(judge(phase, null)).toBe(false);
      expect(judge(phase, '# Report\n\nno summary\n')).toBe(false);
      expect(judge(phase, make('FAIL', 'team', '## Failed Cases\n\n- UT-X: expected PASS\n'))).toBe(false);
      expect(judge(phase, '# Report\n\n## Summary\n\n| Metric | Value |\n|---|---|\n| Module | team |\n\n**PASS**\n')).toBe(false);
      expect(judge(phase, make('PASS', null))).toBe(false); // 共用报告格式：缺「模块」行
      expect(judge(phase, make('PASS', 'core'))).toBe(false); // 属于另一模块
      expect(judge(phase, 'dir')).toBe(false);
    }
    const dep = (content: string | 'dir' | null) => {
      const rel = `${VERIFY}/team-deployment-report.md`;
      const full = join(root, rel);
      if (content === 'dir') mkdirSync(full, { recursive: true });
      else if (content !== null) writeAt(root, rel, content);
      const r = isModuleReportComplete(root, 'team', 'deployment');
      cleanupPath(full);
      return r;
    };
    expect(dep(DEPLOY)).toBe(true);
    expect(dep('dir')).toBe(false);
    expect(dep('')).toBe(false);
    expect(dep(null)).toBe(false);
  });

  it('UT-S11-102: 共用验收报告不计入模块', () => {
    const root = fixture();
    writeAt(root, `${VERIFY}/acceptance-report.md`, acceptance('PASS', null));
    const { progress, currentPhase } = derive(root);
    expect(progress['phase.3-6'].done).toBe(false);
    expect(currentPhase).toBe('phase.3-6');
  });

  it('UT-S11-103: 其他模块的部署 / 冒烟报告不计入', () => {
    const root = fixture();
    writeTeamReports(root, { acceptance: true });
    writeSharedReports(root);
    writeAt(root, `${VERIFY}/core-deployment-report.md`, DEPLOY);
    writeAt(root, `${VERIFY}/core-smoke-report.md`, smoke('PASS', 'core'));
    const { progress, currentPhase } = derive(root);
    expect(progress['phase.3-6'].done).toBe(true);
    expect(progress['phase.3-7-deploy'].done).toBe(false);
    expect(progress['phase.3-8-smoke'].done).toBe(false);
    expect(currentPhase).toBe('phase.3-7-deploy');
  });

  it('UT-S11-104: 模块报告 Gate FAIL 不算完成', () => {
    const root = fixture();
    writeAt(root, `${VERIFY}/team-acceptance-report.md`, acceptance('FAIL', 'team', '- UT-X: expected PASS\n'));
    expect(derive(root).currentPhase).toBe('phase.3-6');

    writeTeamReports(root, { acceptance: true, deployment: true });
    writeAt(root, `${VERIFY}/team-smoke-report.md`, smoke('FAIL', 'team', '- SMOKE-x: PASS expected\n'));
    const { progress, currentPhase } = derive(root);
    expect(progress['phase.3-8-smoke'].done).toBe(false);
    expect(currentPhase).toBe('phase.3-8-smoke');
  });

  it('UT-S11-105: 报告阶段不作 fallback-skip 锚点，前沿门生效', () => {
    const root = fixture({ upTo: 'phase.3-1' }); // 只完成 phase.1～3-0
    writeTeamReports(root, { acceptance: true, deployment: true, smoke: true });
    const { progress, currentPhase } = derive(root);
    for (const k of ['phase.3-1', 'phase.3-2-api', 'phase.3-2-db', 'phase.3-4a', 'phase.3-5']) {
      expect(progress[k].skipped).toBe(false);
    }
    for (const k of ['phase.3-6', 'phase.3-7-deploy', 'phase.3-8-smoke']) expect(progress[k].done).toBe(false);
    expect(currentPhase).toBe('phase.3-1');
  });

  it('UT-S11-106: 按顺序推进', () => {
    const root = fixture();
    writeTeamReports(root, { deployment: true, smoke: true }); // 只差验收：后两个阶段不判 done
    let r = derive(root);
    expect(r.currentPhase).toBe('phase.3-6');
    expect(r.progress['phase.3-7-deploy'].done).toBe(false);
    expect(r.progress['phase.3-8-smoke'].done).toBe(false);

    const root2 = fixture();
    writeTeamReports(root2, { acceptance: true });
    expect(derive(root2).currentPhase).toBe('phase.3-7-deploy');
    writeTeamReports(root2, { deployment: true });
    expect(derive(root2).currentPhase).toBe('phase.3-8-smoke');
    writeTeamReports(root2, { smoke: true });
    r = derive(root2);
    expect(r.currentPhase).toBeNull();
  });

  it('UT-S11-107: when 跳过的阶段算作已跳过', () => {
    const root = fixture();
    writeTeamReports(root, { acceptance: true });
    const { progress, currentPhase } = derive(root, team({ deployment_required: false }));
    expect(progress['phase.3-7-deploy'].skipped).toBe(true);
    expect(progress['phase.3-8-smoke'].skipped).toBe(true);
    expect(progress['phase.3-6'].done).toBe(true);
    expect(currentPhase).toBeNull();
  });

  it('UT-S11-108: overlay 派生同一判据（内置报告谓词按模块报告；自定义 file: 与改写谓词不受影响）', () => {
    const overlay = (root: string, lines: string[]) => {
      mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
      writeFileSync(join(root, 'logos', 'flow', 'initial.yaml'), ['extends: builtin:initial@v1', 'overlay:', ...lines].join('\n'));
    };
    const TAIL = ['  - op: add', '    after: smoke', '    node: { id: tail, name: 收尾, done_when: "file:logos/resources/TAIL" }'];
    const view = (root: string) => deriveOverlayView(root, team(), SCENARIOS, null, true)!;

    // A：只有共用报告 → 停在内置 verify，未到达 tail
    const a = fixture();
    writeSharedReports(a);
    overlay(a, TAIL);
    expect(view(a).current_node).toBeNull();
    expect(view(a).overlay_nodes).toEqual([]);

    // B：team 模块报告齐全 → 三个内置报告节点完成，前沿到 tail；与 phase 派生一致
    const b = fixture();
    writeTeamReports(b, { acceptance: true, deployment: true, smoke: true });
    overlay(b, TAIL);
    expect(view(b).current_node?.id).toBe('tail');
    expect(derive(b).currentPhase).toBeNull();

    // C：自定义 file: 谓词仍按「文件存在」
    const c = fixture();
    writeTeamReports(c, { acceptance: true, deployment: true, smoke: true });
    writeAt(c, `${VERIFY}/custom.md`, '');
    overlay(c, ['  - op: add', '    after: smoke', '    node: { id: custom, name: 自定义, done_when: "file:logos/resources/verify/custom.md" }',
      '  - op: add', '    after: custom', '    node: { id: tail, name: 收尾, done_when: "file:logos/resources/TAIL" }']);
    const vc = view(c);
    expect(vc.overlay_nodes.find(n => n.id === 'custom')?.state).toBe('done');
    expect(vc.current_node?.id).toBe('tail');

    // D：overlay 改写 verify 的 done_when → 按改写后的谓词求值，不套用模块报告判定
    const d = fixture();
    writeTeamReports(d, { deployment: true, smoke: true });
    writeAt(d, `${VERIFY}/team-custom.md`, '');
    overlay(d, ['  - op: modify', '    target: verify', '    set: { done_when: "file:logos/resources/verify/team-custom.md" }', ...TAIL]);
    expect(view(d).current_node?.id).toBe('tail');
    // code-r1 F4：phase 派生与 overlay 同一判据——自定义条件满足、模块验收报告不存在时 phase.3-6 同样完成
    const dp = derive(d);
    expect(dp.progress['phase.3-6'].done).toBe(true);
    expect(dp.currentPhase).toBeNull();

    // D'：反向——模块验收报告 PASS 但改写后的自定义条件不满足，两侧都不得判 phase.3-6 完成
    const d2 = fixture();
    writeTeamReports(d2, { acceptance: true, deployment: true, smoke: true });
    overlay(d2, ['  - op: modify', '    target: verify', '    set: { done_when: "file:logos/resources/verify/team-custom.md" }', ...TAIL]);
    expect(view(d2).current_node).toBeNull(); // 停在内置 verify
    const d2p = derive(d2);
    expect(d2p.progress['phase.3-6'].done).toBe(false);
    expect(d2p.currentPhase).toBe('phase.3-6');
    expect(d2p.progress['phase.3-7-deploy'].done).toBe(false); // 前沿门照常施加
  });

  it('UT-S11-109: 旧派生等价矩阵扩充（ViaFlow == legacy）', () => {
    const variants: Array<{ setup: (root: string) => void; mod?: ModuleInfo; upTo?: string }> = [
      { setup: r => writeAt(r, `${VERIFY}/acceptance-report.md`, acceptance('PASS', null)) },
      { setup: r => { writeTeamReports(r, { acceptance: true }); writeSharedReports(r); writeAt(r, `${VERIFY}/core-deployment-report.md`, DEPLOY); } },
      { setup: r => writeAt(r, `${VERIFY}/team-acceptance-report.md`, acceptance('FAIL')) },
      { setup: r => writeTeamReports(r, { acceptance: true, deployment: true, smoke: true }), upTo: 'phase.3-1' },
      { setup: r => writeTeamReports(r, { deployment: true, smoke: true }) },
      { setup: r => writeTeamReports(r, { acceptance: true, deployment: true, smoke: true }) },
      { setup: r => writeTeamReports(r, { acceptance: true }), mod: team({ deployment_required: false }) },
    ];
    for (const v of variants) {
      const root = fixture({ upTo: v.upTo ?? null });
      v.setup(root);
      const m = v.mod ?? team();
      expect(deriveModulePhaseProgressViaFlow(root, m, SCENARIOS, true)).toEqual(deriveModulePhaseProgress(root, m, SCENARIOS, true));
    }
  });

  it('UT-S11-110: 单模块、launched 模块与顶层 phases[] 零回归', () => {
    const { root, cleanup } = makeTempRoot();
    scaffoldProject(root);
    cleanups.push(cleanup);
    projectYaml(root, { singleModule: true });
    writeArtifacts(root, 'core');
    writeAt(root, `${VERIFY}/acceptance-report.md`, acceptance('FAIL', null));
    const core: ModuleInfo = { id: 'core', name: 'Core', lifecycle: 'initial', bootstrap: 'normal', skip_phases: [] };
    const single = deriveModulePhaseProgressViaFlow(root, core, SCENARIOS, false);
    expect(single.progress['phase.3-6'].done).toBe(true); // 单模块「文件存在即完成」不变
    expect(single).toEqual(deriveModulePhaseProgress(root, core, SCENARIOS, false));

    const mr = fixture();
    writeAt(mr, `${VERIFY}/acceptance-report.md`, acceptance('PASS', null));
    const data = collectStatusData(mr);
    expect(data.phases.find(p => p.key === 'phase.3-6')!.done).toBe(true); // 顶层视图仍扫共用报告
    const coreItem = data.modules!.find(m => m.id === 'core')!;
    expect(coreItem.lifecycle).toBe('launched');
    expect(coreItem.phase_progress).toBeNull(); // launched 模块看提案标记，不做 phase 派生
  });
});

function cleanupPath(full: string) {
  rmSync(full, { recursive: true, force: true }); // 清除单次判定写下的样本，使同一夹具可复用
}

describe('S11 多模块 initial 模块报告阶段端到端（module-scoped-phase-reports）', () => {
  it('ST-S11-53: runlogos 形态——共用报告存在时停在 3-6，模块报告写入后依次推进', () => {
    const root = fixture();
    writeSharedReports(root);
    const coreBefore = JSON.stringify(collectStatusData(root).modules!.find(m => m.id === 'core'));
    expect(teamStatus(root).current_phase).toBe('phase.3-6');
    writeTeamReports(root, { acceptance: true });
    expect(teamStatus(root).current_phase).toBe('phase.3-7-deploy');
    writeTeamReports(root, { deployment: true });
    expect(teamStatus(root).current_phase).toBe('phase.3-8-smoke');
    writeTeamReports(root, { smoke: true });
    const done = teamStatus(root);
    expect(done.current_phase).toBeNull();
    expect(Object.values(done.phase_progress!).every(p => p.done || p.skipped)).toBe(true);
    expect(JSON.stringify(collectStatusData(root).modules!.find(m => m.id === 'core'))).toBe(coreBefore);
  });

  it('ST-S11-54: 前沿门端到端与 next 一致', () => {
    const teamNext = (root: string) => {
      const restore = mockCwd(root);
      const cap = captureConsole();
      try { next('json'); } finally { cap.restore(); restore(); }
      const mods = JSON.parse(cap.logs[0]).data.modules as Array<{ id: string; action: string; command: string | null }>;
      return mods.find(m => m.id === 'team')!;
    };
    const root = fixture({ upTo: 'phase.3-1' });
    writeTeamReports(root, { acceptance: true });
    const early = teamStatus(root);
    expect(early.current_phase).toBe('phase.3-1');
    expect(early.phase_progress!['phase.3-6'].done).toBe(false);
    expect(early.phase_progress!['phase.3-2-api'].skipped).toBe(false);
    const nEarly = teamNext(root);
    expect(nEarly.action).toMatch(/sequence diagram/i); // phase.3-1 的建议，不跳到 verify 之后
    expect(`${nEarly.action} ${nEarly.command ?? ''}`).not.toMatch(/openlogos (verify|smoke)|deploy/i);

    writeArtifacts(root, 'team');
    const later = teamStatus(root);
    expect(later.current_phase).toBe('phase.3-7-deploy');
    const nLater = teamNext(root);
    expect(`${nLater.action} ${nLater.command ?? ''}`).not.toMatch(/openlogos verify/i); // 不再提示 team 运行 verify
    expect(nLater.action).not.toBe(nEarly.action);
  });
});
