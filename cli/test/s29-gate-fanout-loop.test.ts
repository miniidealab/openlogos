/**
 * S29 — M2 预留收尾（loop 退出 gate 可放行 / fan-out 阈值 / loop 内整组收敛）。
 * 复用 S22/S25/S27 临时项目 overlay 模式（makeTempRoot + scaffoldProject + 写 logos/flow/<lifecycle>.yaml）。
 * A：overlay set-loop exhausted_gate.skippable → loop_state.exhausted_skippable（仅写时输出）+ next --auto 放行/阻塞。
 * B：fan-out 节点 coverage_threshold（仅 done_when:all_present 合法；fail loud）+ covered/total>=阈值 判 done。
 * C：loop 内 fan-out 整组收敛（收敛裁判=测试绿，与 fan-out 覆盖无关）。
 * 不改 spec/flow/*.yaml、真实 logos/flow/、golden-baseline fixture。含 OpenLogos reporter（用例名带 UT/ST-S29-*）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd } from './helpers.js';
import { next } from '../src/commands/next.js';
import { status } from '../src/commands/status.js';
import { loadFlow, FlowError } from '../src/lib/flow.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempProject(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  cleanups.push(cleanup);
  return root;
}
function writeOverlay(root: string, lifecycle: string, yaml: string) {
  mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
  writeFileSync(join(root, 'logos', 'flow', `${lifecycle}.yaml`), yaml);
}
type Row = { iter: number; node: string; result: 'pass' | 'fail'; module: string; timestamp: string };
function row(iter: number, result: 'pass' | 'fail', module = 'core'): Row {
  return { iter, node: 'verify', result, module, timestamp: '2026-06-20T00:00:00Z' };
}
function writeLedger(path: string, rows: Row[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
function setSingleModule(root: string, lifecycle: 'initial' | 'launched', id = 'core') {
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    `project:\n  name: "t"\nmodules:\n  - id: ${id}\n    name: ${id}\n    lifecycle: ${lifecycle}\n`);
}
/** 写带 N 个场景的 initial 单模块 yaml（供 B 覆盖阈值用）。 */
function setInitialWithScenarios(root: string, n: number, id = 'core') {
  const scen = Array.from({ length: n }, (_, i) => {
    const sid = `S${String(i + 1).padStart(2, '0')}`;
    return `  - id: ${sid}\n    name: ${sid}\n    module: ${id}`;
  }).join('\n');
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    `project:\n  name: "t"\nscenario_counter:\n  next_id: ${n + 1}\nmodules:\n  - id: ${id}\n    name: ${id}\n    lifecycle: initial\nscenarios:\n${scen}\n`);
}
/** 在场景时序目录写 k 个 core-Sxx 时序文件（控制 phase.3-1 covered 数）。 */
function writeScenarioFiles(root: string, k: number, id = 'core') {
  const dir = join(root, 'logos', 'resources', 'prd', '3-technical-plan', '2-scenario-implementation');
  mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= k; i++) {
    const sid = `S${String(i).padStart(2, '0')}`;
    writeFileSync(join(dir, `${id}-${sid}-demo.md`), `# ${sid}\n`);
  }
}
function setupLaunchedProposal(root: string, slug = 'feat'): string {
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯代码',
    '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '概述。'].join('\n');
  writeFileSync(join(dir, 'proposal.md'), proposal);
  writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] 实现 x\n');
  return dir;
}
function runStatusJson(root: string): any {
  const restore = mockCwd(root); const cap = captureConsole();
  try { status('json'); } finally { cap.restore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}
async function runNextJson(root: string, auto = false): Promise<any> {
  const restore = mockCwd(root); const cap = captureConsole();
  try { await next('json', undefined, auto); } finally { cap.restore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}
function overlaySetLoop(lifecycle: string, body: string): string {
  return [`extends: builtin:${lifecycle}@v1`, 'overlay:', '  - op: set-loop', '    subflow: implement', `    set: ${body}`].join('\n');
}
function loadResolved(root: string, lifecycle: 'initial' | 'launched') {
  return loadFlow(root, { lifecycle, resolved: true }).flow;
}
function findNode(flow: any, id: string): any {
  for (const s of flow.subflows) for (const n of s.nodes) if (n.id === id) return n;
  return null;
}
/** 在 status JSON 中跨 legacy 顶层 + modules[] 找 overlay-add 节点状态（done 在 overlay_nodes，active/pending 多为 current_node）。 */
function findOverlayNode(data: any, id: string): any {
  const pools = [data.overlay_nodes, data.modules?.[0]?.overlay_nodes].filter(Boolean);
  for (const p of pools) { const n = p.find((x: any) => x.id === id); if (n) return n; }
  for (const cn of [data.current_node, data.modules?.[0]?.current_node]) if (cn?.id === id) return cn;
  return null;
}

// ── A · loop 退出 gate skippable 可 overlay 覆盖 ──
describe('S29-A — exhausted_gate.skippable overlay 覆盖 + loop_state.exhausted_skippable', () => {
  it('UT-S29-01: set-loop 接受 exhausted_gate.skippable', () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, exhausted_gate: { skippable: true } }'));
    const sub = loadResolved(root, 'launched').subflows.find((s: any) => s.id === 'implement');
    expect(sub.loop.exhausted_gate).toEqual({ skippable: true });
  });
  it('UT-S29-02: 未写 exhausted_gate → resolved 不物化、loop_state 省略字段（默认 false 仅消费语义）', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3 }'));
    const sub = loadResolved(root, 'launched').subflows.find((s: any) => s.id === 'implement');
    expect(sub.loop.exhausted_gate).toBeUndefined(); // 不物化 {skippable:false}
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail'), row(3, 'fail')]);
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state).toMatchObject({ escalated: true });
    expect('exhausted_skippable' in data.modules[0].loop_state).toBe(false); // 省略键
  });
  it('UT-S29-03: exhausted_gate 含未知 key → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, exhausted_gate: { skippable: true, foo: 1 } }'));
    expect(() => loadResolved(root, 'launched')).toThrow(FlowError);
    try { loadResolved(root, 'launched'); } catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('UT-S29-04: exhausted_gate.skippable 非布尔 → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, exhausted_gate: { skippable: "yes" } }'));
    try { loadResolved(root, 'launched'); expect.fail('应抛错'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('UT-S29-05: set 顶层未知 key 仍 FLOW_SCHEMA_INVALID（白名单 max_iters/until/exhausted_gate）', () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, bar: 1 }'));
    try { loadResolved(root, 'launched'); expect.fail('应抛错'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('UT-S29-22: exhausted_gate:{}（缺 skippable）→ FLOW_SCHEMA_INVALID（skippable 必填）', () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, exhausted_gate: {} }'));
    try { loadResolved(root, 'launched'); expect.fail('应抛错（缺 skippable）'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('UT-S29-23: exhausted_gate:null → FLOW_SCHEMA_INVALID（显式 null 也 fail loud）', () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, exhausted_gate: null }'));
    try { loadResolved(root, 'launched'); expect.fail('应抛错（null）'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('UT-S29-06: 写了 exhausted_gate.skippable:true → loop_state.exhausted_skippable:true', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, exhausted_gate: { skippable: true } }'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail'), row(3, 'fail')]);
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state.exhausted_skippable).toBe(true);
  });
  it('UT-S29-07: 激活 loop 但不写 exhausted_gate → loop_state 不含 exhausted_skippable 键', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3 }'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]);
    const data = await runNextJson(root);
    expect('exhausted_skippable' in data.modules[0].loop_state).toBe(false);
  });
  it('UT-S29-08: 未激活 loop（builtin initial max_iters:1）→ loop_state 整体省略', async () => {
    // change-flow-redesign：builtin launched 默认激活切片循环，故"未激活"只剩 builtin initial（无 loop）。
    const root = tempProject(); setSingleModule(root, 'initial');
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state).toBeUndefined();
  });

  it('ST-S29-01: skippable:true + escalated + --auto → 放行（gate_auto_passed:true + 写 GATE_AUTO_PASSED）', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, exhausted_gate: { skippable: true } }'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail'), row(3, 'fail')]);
    const data = await runNextJson(root, true);
    expect(data.gate_id).toBe('gate:implement:loop-exhausted');
    expect(data.skippable).toBe(true);
    expect(data.gate_auto_passed).toBe(true);
    expect(data.modules[0].loop_state.exhausted_skippable).toBe(true);
    expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(true);
    const audit = readFileSync(join(dir, 'GATE_AUTO_PASSED'), 'utf8');
    expect(audit).toContain('gate:implement:loop-exhausted');
  });
  it('ST-S29-02: 默认（未写 exhausted_gate）+ escalated + --auto → 仍阻塞、不写审计、loop_state 无 exhausted_skippable', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3 }'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail'), row(3, 'fail')]);
    const data = await runNextJson(root, true);
    expect(data.gate_id).toBe('gate:implement:loop-exhausted');
    expect(data.skippable).toBe(false);
    expect(data.gate_auto_passed).toBe(false);
    expect('exhausted_skippable' in data.modules[0].loop_state).toBe(false);
    expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(false);
  });
  it('ST-S29-03: skippable:true 但未达上限（iteration<max）+ --auto → 不放行', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, exhausted_gate: { skippable: true } }'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]); // iteration=1 < 3 → 未 escalated
    const data = await runNextJson(root, true);
    expect(data.gate_auto_passed).toBe(false);
    expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(false);
  });
  it('ST-S29-04: 默认 next（无 --auto）忽略 GATE_AUTO_PASSED、仍展示达上限阻塞', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3, exhausted_gate: { skippable: true } }'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail'), row(3, 'fail')]);
    writeFileSync(join(dir, 'GATE_AUTO_PASSED'), JSON.stringify({ gate_id: 'gate:implement:loop-exhausted', proposal_step: 'x', timestamp: 't' }) + '\n');
    const data = await runNextJson(root, false);
    expect(data.action).toContain('升级人类确认');
  });
  it('ST-S29-08: 卡在未完成 overlay 节点（before verify, active）+ escalated + skippable:true + --auto → R2 优先：不放行、不写审计', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 3, exhausted_gate: { skippable: true } }',
      '  - op: add', '    before: verify', '    node: { id: precheck, name: 预检, done_when: "marker:NEVERDONE" }'].join('\n'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail'), row(3, 'fail')]); // escalated
    const data = await runNextJson(root, true);
    const cur = data.current_node ?? data.modules?.[0]?.current_node;
    expect(cur?.id).toBe('precheck');         // 仍卡在未完成 overlay 节点
    expect(cur?.state).toBe('active');
    expect(data.gate_auto_passed).toBe(false); // gate 未到达 → 不放行
    expect(data.gate_id ?? null).toBeNull();
    expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(false); // 不写审计
  });
});

// ── B · fan-out coverage_threshold ──
describe('S29-B — fan-out coverage_threshold', () => {
  it('UT-S29-09: coverage_threshold 合法解析（modify all_present fan-out 节点）', () => {
    const root = tempProject(); setSingleModule(root, 'initial');
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: 0.9 }'].join('\n'));
    const node = findNode(loadResolved(root, 'initial'), 'scenario-modeling');
    expect(node.coverage_threshold).toBe(0.9);
  });
  it('UT-S29-10: coverage_threshold 越界 → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject(); setSingleModule(root, 'initial');
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: 1.5 }'].join('\n'));
    try { loadResolved(root, 'initial'); expect.fail('应抛错'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('UT-S29-11: coverage_threshold 非数 → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject(); setSingleModule(root, 'initial');
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: "high" }'].join('\n'));
    try { loadResolved(root, 'initial'); expect.fail('应抛错'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('UT-S29-19: coverage_threshold 设在合法非 all_present 谓词节点 → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject(); setSingleModule(root, 'initial');
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: add',
      '    after: scenario-modeling', '    node: { id: extra, name: 额外, done_when: "marker:VERIFY_PASS", coverage_threshold: 0.9 }'].join('\n'));
    try { loadResolved(root, 'initial'); expect.fail('应抛错'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('UT-S29-20: coverage_threshold 设在无 for_each（非 fan-out）节点 → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject(); setSingleModule(root, 'initial');
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: add',
      '    after: scenario-modeling', '    node: { id: extra2, name: 额外2, done_when: all_present, coverage_threshold: 0.9 }'].join('\n'));
    try { loadResolved(root, 'initial'); expect.fail('应抛错（无 for_each）'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('UT-S29-21: coverage_threshold 设在 all_present+for_each 但 produces 为空 → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject(); setSingleModule(root, 'initial');
    // modify 把 builtin fan-out 节点的 produces 改空 + 设阈值 → 防止派生扫描空路径误判覆盖率
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: 0.9, produces: "" }'].join('\n'));
    try { loadResolved(root, 'initial'); expect.fail('应抛错（produces 空）'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
  it('ST-S29-05: 阈值达标（9/10=90% ≥ 0.9）→ phase.3-1 done:true', () => {
    const root = tempProject(); setInitialWithScenarios(root, 10); writeScenarioFiles(root, 9);
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: 0.9 }'].join('\n'));
    const data = runStatusJson(root);
    const pp = data.modules[0].phase_progress['phase.3-1'];
    expect(pp.scenario_coverage).toMatchObject({ total: 10, covered: 9 });
    expect(pp.done).toBe(true);
  });
  it('ST-S29-06: 阈值未达（8/10=80% < 0.9）→ phase.3-1 done:false', () => {
    const root = tempProject(); setInitialWithScenarios(root, 10); writeScenarioFiles(root, 8);
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: 0.9 }'].join('\n'));
    const data = runStatusJson(root);
    const pp = data.modules[0].phase_progress['phase.3-1'];
    expect(pp.scenario_coverage).toMatchObject({ total: 10, covered: 8 });
    expect(pp.done).toBe(false);
  });
  it('UT-S29-12: 阈值恰好达标（边界 covered/total == 阈值）→ done:true', () => {
    const root = tempProject(); setInitialWithScenarios(root, 4); writeScenarioFiles(root, 2); // 2/4 = 0.5
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: 0.5 }'].join('\n'));
    expect(runStatusJson(root).modules[0].phase_progress['phase.3-1'].done).toBe(true);
  });
  it('UT-S29-13: 阈值未达（covered/total < 阈值）→ done:false', () => {
    const root = tempProject(); setInitialWithScenarios(root, 4); writeScenarioFiles(root, 1); // 1/4 = 0.25 < 0.5
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: 0.5 }'].join('\n'));
    expect(runStatusJson(root).modules[0].phase_progress['phase.3-1'].done).toBe(false);
  });
  it('UT-S29-16: 覆盖度对象结构不变（仅 total/covered/missing，status 不新增 coverage_threshold 字段）', () => {
    const root = tempProject(); setInitialWithScenarios(root, 10); writeScenarioFiles(root, 9);
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: 0.9 }'].join('\n'));
    const pp = runStatusJson(root).modules[0].phase_progress['phase.3-1'];
    expect(Object.keys(pp.scenario_coverage).sort()).toEqual(['covered', 'missing', 'total']);
    expect('coverage_threshold' in pp).toBe(false); // status 不挂阈值字段
  });
  it('UT-S29-24: overlay-add fan-out 节点阈值达标（1/2=50% ≥ 0.5）→ done（阈值在 overlay-add 路径生效）', () => {
    const root = tempProject(); setInitialWithScenarios(root, 2);
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: add', '    before: prd',
      '    node: { id: fo, name: 扇出, for_each: scenarios, produces: "logos/resources/scenario/{module}-{scenario}.md", done_when: all_present, coverage_threshold: 0.5 }'].join('\n'));
    const scenDir = join(root, 'logos', 'resources', 'scenario'); mkdirSync(scenDir, { recursive: true });
    writeFileSync(join(scenDir, 'core-S01.md'), '# S01\n'); // covered 1/2
    expect(findOverlayNode(runStatusJson(root), 'fo')?.state).toBe('done');
  });
  it('UT-S29-25: overlay-add fan-out 节点未达阈值（0/2 < 0.5）→ 未 done（active）', () => {
    const root = tempProject(); setInitialWithScenarios(root, 2);
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: add', '    before: prd',
      '    node: { id: fo, name: 扇出, for_each: scenarios, produces: "logos/resources/scenario/{module}-{scenario}.md", done_when: all_present, coverage_threshold: 0.5 }'].join('\n'));
    expect(findOverlayNode(runStatusJson(root), 'fo')?.state).toBe('active');
  });
  it('UT-S29-14: 缺省（不写 coverage_threshold）等价 all_present（9/10 → 未 done）', () => {
    const root = tempProject(); setInitialWithScenarios(root, 10); writeScenarioFiles(root, 9);
    const data = runStatusJson(root);
    const pp = data.modules[0].phase_progress['phase.3-1'];
    expect(pp.done).toBe(false); // all_present 需 100%
  });
  it('UT-S29-15: total==0 + 阈值 → 维持现状（未 done）', () => {
    const root = tempProject(); setInitialWithScenarios(root, 0);
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: modify',
      '    target: scenario-modeling', '    set: { coverage_threshold: 0.5 }'].join('\n'));
    const data = runStatusJson(root);
    expect(data.modules[0].phase_progress['phase.3-1'].done).toBe(false);
  });
});

// ── C · loop 内整组收敛 + golden 零漂移 ──
describe('S29-C — loop 内整组收敛 / 零漂移', () => {
  it('UT-S29-17: loop 收敛裁判仍是测试绿（末轮 pass → converged，与 fan-out 无关）', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 3 }'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'pass')]);
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state).toMatchObject({ converged: true });
  });
  it('UT-S29-18: 不为单实例计 iteration（loop_state.iteration = 账本行数，整组）', async () => {
    const root = tempProject(); const dir = setupLaunchedProposal(root); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', overlaySetLoop('launched', '{ max_iters: 5 }'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail')]);
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state.iteration).toBe(2); // 整组轮次，无 per-instance 字段
    expect(Object.keys(data.modules[0].loop_state).sort()).toEqual(
      ['converged', 'escalated', 'iteration', 'max_iters', 'subflow_id', 'until'].sort());
  });
  it('ST-S29-07: 无任何 overlay（builtin initial）→ loop_state 省略、flow show 节点无 coverage_threshold（零漂移）', async () => {
    // change-flow-redesign：builtin launched 默认激活切片循环 → launched 下 loop_state 常驻；
    // "无 overlay → loop_state 省略"的零漂移只对 builtin initial（无 loop）成立。
    const root = tempProject(); setSingleModule(root, 'initial');
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state).toBeUndefined();
    // resolved 无 overlay：任何节点都不含 coverage_threshold 键（两生命周期均如此）
    for (const lc of ['initial', 'launched'] as const) {
      const flow = loadResolved(root, lc);
      for (const s of flow.subflows) for (const n of s.nodes) {
        expect('coverage_threshold' in n).toBe(false);
      }
    }
  });
});
