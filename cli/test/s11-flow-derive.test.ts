/**
 * S11/S05 flow-derive（M1 切片 B1）——引擎 UT + 测试期「新派生==旧逻辑」并跑等价断言。
 *
 * 并跑断言仅存在于测试期：对兼容矩阵的每个 fixture，断言 deriveModulePhaseProgressViaFlow
 * 与旧 deriveModulePhaseProgress 输出相等，证明 builtin-flow 派生 1:1 不改行为。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd } from './helpers.js';
import { deriveModulePhaseProgress, collectStatusData, type ModuleInfo } from '../src/commands/status.js';
import {
  buildInitialPhasePlan,
  deriveModulePhaseProgressViaFlow,
  flowExplicitSkipPhaseKeys,
  NODE_TO_PHASE_KEY,
} from '../src/lib/flow-derive.js';
import { next } from '../src/commands/next.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  cleanups.push(cleanup);
  return root;
}

function writeFileAt(root: string, rel: string, content = 'x') {
  const full = join(root, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

function mod(over: Partial<ModuleInfo> = {}): ModuleInfo {
  return { id: 'core', name: 'Core', lifecycle: 'initial', bootstrap: 'normal', skip_phases: [], ...over };
}

const PHASE_KEYS_EXPECTED = [
  'phase.1', 'phase.2', 'phase.3-0', 'phase.3-1', 'phase.3-2-api', 'phase.3-2-db',
  'phase.3-3-deployment', 'phase.3-4a', 'phase.3-4b', 'phase.3-5', 'phase.3-6',
  'phase.3-7-deploy', 'phase.3-8-smoke',
];

describe('S11 flow-derive 引擎单元测试', () => {
  it('UT-S11-22 / UT-S11-23: buildInitialPhasePlan 产出 13 phase，顺序与 phase-key 映射与原 PHASE_KEYS 一致', () => {
    const plan = buildInitialPhasePlan();
    expect(plan.map(p => p.phaseKey)).toEqual(PHASE_KEYS_EXPECTED);
    expect(Object.values(NODE_TO_PHASE_KEY)).toEqual(PHASE_KEYS_EXPECTED);
  });

  it('UT-S11-24: fan-out 节点 subpath 取 produces 的目录；report 文件节点保留文件路径', () => {
    const plan = buildInitialPhasePlan();
    expect(plan.find(p => p.phaseKey === 'phase.3-1')!.subpath).toBe('logos/resources/prd/3-technical-plan/2-scenario-implementation');
    expect(plan.find(p => p.phaseKey === 'phase.3-4a')!.subpath).toBe('logos/resources/test');
    expect(plan.find(p => p.phaseKey === 'phase.3-6')!.subpath).toBe('logos/resources/verify/acceptance-report.md');
    expect(plan.find(p => p.phaseKey === 'phase.3-1')!.isScenario).toBe(true);
  });

  it('UT-S11-25 / UT-S11-26 / UT-S11-27: when 求值复现 explicit skip（api/db/scenario）', () => {
    expect([...flowExplicitSkipPhaseKeys(mod({ skip_phases: ['api'] }))]).toContain('phase.3-2-api');
    expect([...flowExplicitSkipPhaseKeys(mod({ skip_phases: ['database'] }))]).toContain('phase.3-2-db');
    expect([...flowExplicitSkipPhaseKeys(mod({ skip_phases: ['scenario'] }))]).toContain('phase.3-4b');
    expect([...flowExplicitSkipPhaseKeys(mod())]).toEqual([]); // normal 无显式 skip
  });

  it('UT-S11-28: deployment 双路径——skip_phases:[deployment] 与 deployment_required=false 均跳过 deploy+smoke', () => {
    for (const m of [mod({ skip_phases: ['deployment'] }), mod({ deployment_required: false })]) {
      const s = flowExplicitSkipPhaseKeys(m);
      expect(s.has('phase.3-7-deploy')).toBe(true);
      expect(s.has('phase.3-8-smoke')).toBe(true);
    }
  });

  it('UT-S11-29 / UT-S11-30: smoke_required=false 仅跳 smoke；未声明默认 true 不跳', () => {
    const noSmoke = flowExplicitSkipPhaseKeys(mod({ smoke_required: false }));
    expect(noSmoke.has('phase.3-8-smoke')).toBe(true);
    expect(noSmoke.has('phase.3-7-deploy')).toBe(false);
    expect(flowExplicitSkipPhaseKeys(mod()).has('phase.3-8-smoke')).toBe(false); // 未声明→true
  });

  it('UT-S11-31: bootstrap=adopted 跳过 prd/product-design/architecture 并标 skip_reason', () => {
    const root = tempRoot();
    const { progress } = deriveModulePhaseProgressViaFlow(root, mod({ bootstrap: 'adopted' }), []);
    for (const k of ['phase.1', 'phase.2', 'phase.3-0']) {
      expect(progress[k].skipped).toBe(true);
      expect(progress[k].skip_reason).toBe('bootstrap-adopted');
    }
  });

  it('UT-S11-32 / UT-S11-33: 场景阶段 all-present 覆盖度 + scenario_coverage 对象', () => {
    const root = tempRoot();
    writeFileAt(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-x.md');
    const { progress } = deriveModulePhaseProgressViaFlow(root, mod(), [{ id: 'S01' }, { id: 'S02' }]);
    const p = progress['phase.3-1'];
    expect(p.done).toBe(false); // 仅 S01 覆盖，S02 缺 → 未全覆盖
    expect(p.scenario_coverage).toEqual({ total: 2, covered: 1, missing: ['S02'] });
  });

  it('UT-S11-34: 非场景阶段顶层=扫整个目录 any-present（不按模块前缀）', () => {
    const root = tempRoot();
    writeFileAt(root, 'logos/resources/api/other-mod-file.md');
    writeFileSync(join(root, 'logos', 'logos-project.yaml'),
      'modules:\n  - id: core\n    name: Core\n    lifecycle: initial\n');
    const data = collectStatusData(root);
    expect(data.phases.find(p => p.key === 'phase.3-2-api')!.done).toBe(true);
  });

  it('UT-S11-35: 非场景阶段 per-module 多模块按 {module}- 前缀过滤', () => {
    const root = tempRoot();
    writeFileAt(root, 'logos/resources/api/admin-only.md');
    const { progress } = deriveModulePhaseProgressViaFlow(root, mod({ id: 'core' }), [], true);
    expect(progress['phase.3-2-api'].done).toBe(false); // 仅 admin- 前缀文件，core 不计
  });

  it('UT-S11-36: 标准零填充 ID 相邻不串台（S01 不被 core-S11 文件误判）', () => {
    const root = tempRoot();
    writeFileAt(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-x.md');
    const { progress } = deriveModulePhaseProgressViaFlow(root, mod(), [{ id: 'S01' }]);
    expect(progress['phase.3-1'].scenario_coverage!.covered).toBe(0); // S01 未被 core-S11 命中
  });

  it('UT-S11-37: 多模块全局 skip 交集——仅当所有 initial 模块都 skip 才置顶层 skipped', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'logos', 'logos-project.yaml'),
      'modules:\n  - id: core\n    name: Core\n    lifecycle: initial\n    skip_phases: [api]\n  - id: admin\n    name: Admin\n    lifecycle: initial\n');
    const data = collectStatusData(root);
    // admin 未 skip api → 交集不成立 → 顶层 phase.3-2-api 不被标 skipped
    expect(data.phases.find(p => p.key === 'phase.3-2-api')!.skipped).toBe(false);
  });

  it('UT-S11-38: fallback-skip——已完成 phase 之前的空 phase 自动 skipped（NON_FALLBACK 除外）', () => {
    const root = tempRoot();
    writeFileAt(root, 'logos/resources/implementation/m.md'); // phase.3-5 done
    const { progress } = deriveModulePhaseProgressViaFlow(root, mod(), []);
    expect(progress['phase.3-2-api'].skipped).toBe(true); // 在 3-5 之前的空 phase 被兜底跳过
    expect(progress['phase.3-3-deployment'].skipped).toBe(false); // NON_FALLBACK 除外
  });

  it('UT-S11-39: 非标准/合成 ID 保留 legacy includes() 子串命中（S1 命中 core-S11 文件）', () => {
    const root = tempRoot();
    writeFileAt(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-x.md');
    const { progress } = deriveModulePhaseProgressViaFlow(root, mod(), [{ id: 'S1' }]);
    expect(progress['phase.3-1'].scenario_coverage!.covered).toBe(1); // 旧子串行为如实保留
  });
});

// ── 兼容矩阵：测试期并跑断言 ViaFlow == legacy ──
interface MatrixCase {
  id: string;
  desc: string;
  mod: ModuleInfo;
  files: string[];
  scenarios: Array<{ id: string }>;
  multi: boolean;
}

const MATRIX: MatrixCase[] = [
  { id: 'ST-S11-18', desc: 'normal 空项目', mod: mod(), files: [], scenarios: [], multi: false },
  { id: 'ST-S11-19', desc: 'normal 部分产物', mod: mod(), files: ['logos/resources/prd/1-product-requirements/r.md', 'logos/resources/test/core-S01-test-cases.md'], scenarios: [{ id: 'S01' }], multi: false },
  { id: 'ST-S11-20', desc: 'adopted', mod: mod({ bootstrap: 'adopted' }), files: [], scenarios: [], multi: false },
  { id: 'ST-S11-21', desc: 'historical skipped', mod: mod({ bootstrap: 'skipped' }), files: [], scenarios: [], multi: false },
  { id: 'ST-S11-22', desc: '无 skip_phases fallback（靠后 phase 有文件）', mod: mod(), files: ['logos/resources/prd/1-product-requirements/r.md', 'logos/resources/test/core-S01-test-cases.md'], scenarios: [{ id: 'S01' }], multi: false },
  { id: 'ST-S11-23', desc: 'skip api', mod: mod({ skip_phases: ['api'] }), files: [], scenarios: [], multi: false },
  { id: 'ST-S11-24', desc: 'skip database', mod: mod({ skip_phases: ['database'] }), files: [], scenarios: [], multi: false },
  { id: 'ST-S11-25', desc: 'skip scenario', mod: mod({ skip_phases: ['scenario'] }), files: [], scenarios: [], multi: false },
  { id: 'ST-S11-26', desc: 'skip_phases:[deployment]', mod: mod({ skip_phases: ['deployment'] }), files: [], scenarios: [], multi: false },
  { id: 'ST-S11-27', desc: 'deployment_required=false', mod: mod({ deployment_required: false }), files: [], scenarios: [], multi: false },
  { id: 'ST-S11-28', desc: 'smoke_required=false', mod: mod({ smoke_required: false }), files: [], scenarios: [], multi: false },
  { id: 'ST-S11-29', desc: '多模块前缀过滤', mod: mod({ id: 'core' }), files: ['logos/resources/api/admin-x.md', 'logos/resources/prd/1-product-requirements/core-r.md'], scenarios: [], multi: true },
  { id: 'ST-S11-30', desc: 'partial 场景覆盖 + 相邻 ID', mod: mod(), files: ['logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S11-x.md'], scenarios: [{ id: 'S01' }, { id: 'S11' }], multi: false },
];

describe('S11 flow-derive 测试期并跑等价矩阵（ViaFlow == legacy）', () => {
  for (const c of MATRIX) {
    it(`${c.id}: ${c.desc} — ViaFlow 与旧逻辑逐字段相等`, () => {
      const root = tempRoot();
      for (const f of c.files) writeFileAt(root, f);
      const viaFlow = deriveModulePhaseProgressViaFlow(root, c.mod, c.scenarios, c.multi);
      const legacy = deriveModulePhaseProgress(root, c.mod, c.scenarios, c.multi);
      expect(viaFlow).toEqual(legacy);
    });
  }
});

// ── S05：next initial 路径消费 flow 派生的 current_phase ──
// current_phase 取自 collectStatusData（next 消费的源头，已 flow 派生）；action 取自 next 输出，
// 验证 next 能基于 flow 派生的 current_phase 正常给出建议。
function nextData(root: string): { action: string; current_phase: string | null } {
  const current_phase = collectStatusData(root).current_phase;
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  try { next('json'); } finally { cap.restore(); restoreCwd(); }
  const action = JSON.parse(cap.logs[0]).data.action as string;
  return { action, current_phase };
}

function writeModuleYaml(root: string, over: Partial<ModuleInfo> = {}) {
  const m = mod(over);
  let y = `modules:\n  - id: ${m.id}\n    name: ${m.name}\n    lifecycle: initial\n`;
  if (m.bootstrap && m.bootstrap !== 'normal') y += `    bootstrap: ${m.bootstrap}\n`;
  if (m.skip_phases && m.skip_phases.length) y += `    skip_phases: [${m.skip_phases.join(', ')}]\n`;
  if (m.deployment_required === false) y += `    deployment_required: false\n`;
  if (m.smoke_required === false) y += `    smoke_required: false\n`;
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), y);
}

describe('S05 next initial 路径 flow 派生等价', () => {
  it('UT-S05-20 / ST-S05-07: fresh initial → next 指向 phase.1 派生建议', () => {
    const root = tempRoot();
    writeModuleYaml(root);
    const d = nextData(root);
    expect(d.current_phase).toBe('phase.1');
    expect(d.action.length).toBeGreaterThan(0);
  });

  it('UT-S05-21 / ST-S05-08: adopted → next 跳过前三段指向首个未完成 phase', () => {
    const root = tempRoot();
    writeModuleYaml(root, { bootstrap: 'adopted' });
    const d = nextData(root);
    expect(['phase.1', 'phase.2', 'phase.3-0']).not.toContain(d.current_phase);
  });

  it('UT-S05-22 / ST-S05-09: skip_phases 影响 current_phase 后 next 一致', () => {
    const root = tempRoot();
    writeModuleYaml(root, { skip_phases: ['api', 'database', 'scenario'] });
    writeFileAt(root, 'logos/resources/prd/1-product-requirements/r.md');
    const d = nextData(root);
    expect(['phase.3-2-api', 'phase.3-2-db', 'phase.3-4b']).not.toContain(d.current_phase);
  });

  it('UT-S05-23 / ST-S05-10: 无 skip_phases 老项目 fallback 后 current_phase 不漂移', () => {
    const root = tempRoot();
    writeModuleYaml(root);
    writeFileAt(root, 'logos/resources/prd/1-product-requirements/r.md');
    writeFileAt(root, 'logos/resources/implementation/m.md'); // phase.3-5 done
    const d = nextData(root);
    expect(d.current_phase).not.toBe('phase.3-2-api'); // 被 fallback 跳过，不停在 api
  });

  it('UT-S05-24 / ST-S05-11: no-deploy 跳过 deploy/smoke 后 next 不停在 deploy', () => {
    const root = tempRoot();
    writeModuleYaml(root, { deployment_required: false });
    for (const f of ['1-product-requirements', '2-product-design', '3-technical-plan/1-architecture'])
      writeFileAt(root, `logos/resources/prd/${f}/x.md`);
    const d = nextData(root);
    expect(d.current_phase).not.toBe('phase.3-7-deploy');
    expect(d.current_phase).not.toBe('phase.3-8-smoke');
  });

  it('UT-S05-25 / ST-S05-12: no-smoke 保留 deploy 仅跳 smoke', () => {
    const root = tempRoot();
    writeModuleYaml(root, { smoke_required: false });
    const data = collectStatusData(root);
    const m = data.modules!.find(x => x.id === 'core')!;
    expect(m.phase_progress!['phase.3-8-smoke'].skipped).toBe(true);
    expect(m.phase_progress!['phase.3-7-deploy'].skipped).toBe(false);
  });
});
