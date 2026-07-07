/**
 * S32 — 切片规划环节（split-slice-planner-stage）。
 *
 * merge 之后、implement 之前，新增独立 slice 子流程（节点 plan-slices，skill: slice-planner）
 * 把已合并规格拆成良构 [code] 切片，出口 slice-exit 门 + ready-to-implement 驻留态。
 * 用例 ID 与 logos/resources/test/core-S32-test-cases.md 对齐（UT-S32-01..09 / ST-S32-01..04 + EX）。
 * 参照 test/s31-code-slice-loop.test.ts 的 setup helper 与断言风格；含 OpenLogos reporter（用例名带编号）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { detectProposalStep } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import { status } from '../src/commands/status.js';
import { merge } from '../src/commands/merge.js';
import { isTasksCodeFilled } from '../src/lib/proposal-lifecycle.js';
import { loadBuiltinFlow } from '../src/lib/flow.js';
import { deriveAutomationDiagnostic } from '../src/lib/automation-diagnostic.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function filled(): string {
  return filledWithOverview('概述。覆盖 UT-S32-04、UT-S32-21、ST-S32-EX-1、ST-S32-EX-6。');
}

function filledWithoutTestIds(): string {
  return filledWithOverview('概述。');
}

function filledWithOverview(overview: string): string {
  return [
    '# 变更提案：feat', '', '## 变更原因', '需要新能力。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01', '', '## 部署影响',
    '- 是否需要部署：否', '- 部署原因：纯文档', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', overview,
  ].join('\n');
}

function codeRequiredProposal(): string {
  return filled()
    .replace('## 变更类型\n设计级', '## 变更类型\n代码级修复')
    .replace('## 变更概述\n概述。', '## 变更概述\n需要 CLI 状态派生代码与自动化测试实现。');
}

/** 建带 guard 的 launched 命令级 fixture（活跃提案 = filled proposal + 指定 tasks/markers）。 */
function setupCmd(tasks: string, markers: string[] = [], slug = 'feat', proposal = filled()): { root: string; dir: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }, { lineWidth: 0 }));
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-06-20T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(join(dir, 'deltas', 'spec'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), proposal);
  writeFileSync(join(dir, 'tasks.md'), tasks);
  for (const mk of markers) writeFileSync(join(dir, mk), '');
  return { root, dir };
}

function writeTestDelta(dir: string, ids: string[] = ['UT-S32-19', 'ST-S32-07']): void {
  mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
  writeFileSync(join(dir, 'deltas', 'test', 'core-S32-test-cases.md'), ids.map(id => `| ${id} | 新增回归 |`).join('\n'));
}
async function nextJson(root: string, auto = false): Promise<Record<string, any>> {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  try { await next('json', undefined, auto); } finally { cap.restore(); ex.mockRestore(); restore(); }
  return JSON.parse(cap.logs[cap.logs.length - 1]).data;
}
function statusJson(root: string): Record<string, any> {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  try { status('json'); } finally { cap.restore(); ex.mockRestore(); restore(); }
  return JSON.parse(cap.logs[cap.logs.length - 1]).data;
}
function auditLines(dir: string): string[] {
  const p = join(dir, 'GATE_AUTO_PASSED');
  return existsSync(p) ? readFileSync(p, 'utf-8').split('\n').filter(Boolean) : [];
}
function writeNoDeltaMarker(dir: string): void {
  writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
    type: 'no_delta_spec_complete',
    reason: 'pure-code proposal has no spec delta',
    completed_at: '2026-06-20T00:00:00.000Z',
  }, null, 2));
}
function expectPlanSlicesNotAutoPassed(d: Record<string, any>, dir: string): void {
  expect(d.proposal_step).toBe('ready-to-implement');
  expect(d.gate_id).not.toBe('slice-exit');
  expect(d.gate_auto_passed).toBe(false);
  expect(d.modules[0].next_node?.id).toBe('plan-slices');
  expect(d.modules[0].next_node?.gate_id).toBeUndefined();
  expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(false);
  expect(auditLines(dir).filter(l => JSON.parse(l).gate_id === 'slice-exit')).toHaveLength(0);
}

// tasks 片段
const DELTA_DONE_CODE_TEMPLATE = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] [切片清单占位]';
const DELTA_DONE_CODE_SLICES = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片1\n- [ ] 切片2';
const PURE_DELTA = '# 任务\n\n## [delta] 规格变更\n- [x] d';
// fix-nodelta-proposal-routing：纯代码提案（无 [delta]，含空/切片 [code]）
const PURE_CODE_TEMPLATE = '# 任务\n\n## [code] 代码实现\n- [ ] [切片清单占位]';
const PURE_CODE_SLICES = '# 任务\n\n## [code] 代码实现\n- [ ] 切片1\n- [ ] 切片2';

// ── 一、slice 子流程 / write-tasks 结构定义（builtin flow 直测）──
describe('S32 — slice 子流程与 write-tasks 结构', () => {
  const flow = loadBuiltinFlow('launched');
  const sub = Object.fromEntries(flow.subflows.map(s => [s.id, s]));
  const byId = Object.fromEntries(flow.subflows.flatMap(s => s.nodes.map(n => [n.id, n])));

  it('UT-S32-01: builtin launched 含 slice 子流程定义（plan-slices / slice-planner / skippable:true / when:code_required，位于 merge 与 implement 之间）', () => {
    expect(sub['slice']).toBeDefined();
    expect(sub['slice'].when).toBe('code_required');
    expect(sub['slice'].gate).toMatchObject({ type: 'human', skippable: true });
    const planSlices = sub['slice'].nodes.find(n => n.id === 'plan-slices')!;
    expect(planSlices).toMatchObject({ skill: 'slice-planner', done_when: 'tasks_code_filled', produces: 'tasks.md' });
    // 位置：merge 与 implement 之间
    const order = flow.subflows.map(s => s.id);
    expect(order.indexOf('slice')).toBeGreaterThan(order.indexOf('merge'));
    expect(order.indexOf('slice')).toBeLessThan(order.indexOf('implement'));
  });

  it('UT-S32-02: plan 段 write-tasks done_when 改为 tasks_delta_filled（不再 section_complete:code）', () => {
    expect(byId['write-tasks'].done_when).toBe('tasks_delta_filled');
    expect(byId['write-tasks'].done_when).not.toBe('section_complete:code');
  });
});

// ── 二、merge 后派生进入 slice 子流程 ──
describe('S32 — merge 后切片派生', () => {
  it('UT-S32-03: write-tasks 只看 [delta]/[deploy] 脱模板 → 不因 [code] 缺失卡在 plan', async () => {
    // [delta] 已脱模板（全勾）、无 [code] section、未 merge → 越过 plan 进入 spec/merge（ready-to-merge），不卡 plan
    const { root, dir } = setupCmd(PURE_DELTA);
    expect(detectProposalStep(dir)).toBe('ready-to-merge');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-merge');
    expect(m.next_node?.id).toBe('generate-merge-prompt');
  });

  it('UT-S32-04: merge 后 code_required 真（[code] 仍为模板）→ ready-to-implement / next_node=plan-slices', async () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_TEMPLATE, ['SPEC_MERGED']);
    expect(detectProposalStep(dir)).toBe('ready-to-implement');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-implement');
    expect(m.next_node?.id).toBe('plan-slices');
    expect(m.next_node?.skill).toBe('slice-planner');
    expect(m.next_node?.id).not.toBe('code'); // 不直接进入 code
    // fix-next-node-slice-exit-frontier（R8）：[code] 仍为模板（未脱模板）→ plan-slices 未完成、前沿是节点、**不带** gate_id
    expect(m.next_node?.gate_id).toBeUndefined();
  });

  it('UT-S32-05: plan-slices 完成判定 = [code] 脱模板 → 停在 slice-exit 门（默认 next 即回显 next_node.gate_id）', async () => {
    // [code] 已脱模板（切片写出、未勾）、SLICES_APPROVED 不存在 → ready-to-implement，停 slice-exit 门等批准（不进入 coding）。
    const { root, dir } = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED']);
    expect(detectProposalStep(dir)).toBe('ready-to-implement');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-implement');
    expect(m.next_node?.id).toBe('plan-slices');
    // fix-next-node-slice-exit-frontier（R8）：默认 next（半自动/手动，无 --auto）即在 next_node 上回显 gate_id=slice-exit——
    // 前沿在门上、宿主不得重派 slice-planner（修复半自动 driver 恒得 plan-slices 无门信号→重派死循环的根因）。
    expect(m.next_node?.gate_id).toBe('slice-exit');
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(false);
    // --auto 下顶层 gate = slice-exit、skippable:true（停门待批准的归属门；与 next_node.gate_id 语义不同，但同指 slice-exit）
    const auto = await nextJson(root, true);
    expect(auto.gate_id).toBe('slice-exit');
    expect(auto.skippable).toBe(true);
  });

  it('UT-S32-06: ready-to-implement 步骤标签「切片待批准」（merge-generated 与 coding 之间）', () => {
    const { root } = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED']);
    const ac = statusJson(root).modules[0].active_change;
    expect(ac.proposal_step).toBe('ready-to-implement');
    expect(ac.proposal_step_label).toContain('切片待批准');
  });
});

// ── 三、slice-exit --auto 放行 + 幂等 + when:code_required 跳过 ──
describe('S32 — slice-exit auto 放行与跳过', () => {
  it('UT-S32-07: slice-exit + --auto 放行写审计 + SLICES_APPROVED → 派生 coding / next_node=code', async () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED']);
    const d = await nextJson(root, true);
    expect(d.gate_id).toBe('slice-exit');
    expect(d.gate_auto_passed).toBe(true);
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(true);
    const lines = auditLines(dir);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ gate_id: 'slice-exit', proposal_step: 'ready-to-implement' });
    expect(JSON.parse(lines[0]).timestamp).toBeTruthy();
    expect(d.proposal_step).toBe('coding');
    expect(d.modules[0].next_node?.id).toBe('code');
  });

  it('UT-S32-08: slice-exit auto 放行幂等（重复不重复追加/不重复写 marker）', async () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED']);
    await nextJson(root, true);
    const d = await nextJson(root, true);
    expect(d.proposal_step).toBe('coding');
    expect(d.modules[0].next_node?.id).toBe('code');
    expect(auditLines(dir).filter(l => JSON.parse(l).gate_id === 'slice-exit')).toHaveLength(1);
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(true);
  });

  it('UT-S32-09: when:code_required 假（纯文档提案）整段跳过 slice → 不进入 ready-to-implement', async () => {
    // 纯 [delta] 提案（无 [code] 产出）merge 完成 → code_required=false，slice 整段跳过，按 implement 空 [code] 退化推进。
    const { root, dir } = setupCmd(PURE_DELTA, ['SPEC_MERGED']);
    expect(detectProposalStep(dir)).not.toBe('ready-to-implement');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).not.toBe('ready-to-implement');
    expect(m.next_node?.id).not.toBe('plan-slices');
    expect(m.proposal_step).toBe('ready-to-verify'); // 无 [code] → 直接可 verify（退化路径）
  });

  it('UT-S32-13: next --auto 在 [code] 未脱模板时不得空过 plan-slices', async () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_TEMPLATE, ['SPEC_MERGED']);
    const d = await nextJson(root, true);
    expectPlanSlicesNotAutoPassed(d, dir);
  });

  it('UT-S32-14: 纯代码提案缺 SPEC_MERGED 时 next --auto 不得派 plan-slices', async () => {
    const { root, dir } = setupCmd(PURE_CODE_TEMPLATE);
    const d = await nextJson(root, true);
    expect(d.proposal_step).toBe('spec-complete-required');
    expect(d.gate_auto_passed).toBe(false);
    expect(d.modules[0].next_node?.id).not.toBe('plan-slices');
    expect(d.modules[0].next_node?.id).not.toBe('code');
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(false);
  });
});

// ── 四、场景测试 ──
describe('S32 — 场景测试', () => {
  it('ST-S32-01: merge 后切片规划端到端至 slice-exit 放行进 coding', async () => {
    // 1) merge 就绪、[code] 仍模板 → ready-to-implement、next_node=plan-slices（未脱模板、不带 gate_id）
    const tpl = setupCmd(DELTA_DONE_CODE_TEMPLATE, ['SPEC_MERGED']);
    const m1 = (await nextJson(tpl.root)).modules[0];
    expect(m1.proposal_step).toBe('ready-to-implement');
    expect(m1.next_node?.id).toBe('plan-slices');
    expect(m1.next_node?.gate_id).toBeUndefined();
    // 2) 写出 [code] 切片（脱模板、未勾）→ 仍 ready-to-implement、停 slice-exit 门（默认 next 即回显 next_node.gate_id=slice-exit）
    const filledFix = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED']);
    const m2 = (await nextJson(filledFix.root)).modules[0];
    expect(m2.proposal_step).toBe('ready-to-implement');
    expect(m2.next_node?.id).toBe('plan-slices');
    expect(m2.next_node?.gate_id).toBe('slice-exit');
    // 3) --auto 放行 slice-exit → 写 SLICES_APPROVED + 审计 → 派生 coding、next_node=code（门已消费、不带 gate_id，进入 S31 切片循环）
    const d3 = await nextJson(filledFix.root, true);
    expect(existsSync(join(filledFix.dir, 'SLICES_APPROVED'))).toBe(true);
    expect(d3.proposal_step).toBe('coding');
    expect(d3.modules[0].next_node?.id).toBe('code');
    expect(d3.modules[0].next_node?.gate_id).toBeUndefined();
    expect(d3.modules[0].next_node?.slice).toBe('切片1');
  });

  it('ST-S32-02: 纯文档提案整段跳过 slice 子流程（不卡死）', async () => {
    const { root } = setupCmd(PURE_DELTA, ['SPEC_MERGED']);
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).not.toBe('ready-to-implement');
    expect(m.next_node?.id).not.toBe('plan-slices');
    expect(m.proposal_step).toBe('ready-to-verify');
  });

  it('ST-S32-03: plan 段不再产 [code]（write-tasks 只需 [delta]/[deploy] 脱模板）', async () => {
    // [delta] 全勾、[code] 缺失、未 merge → plan 完成、派生进入 spec/merge（ready-to-merge），不被 [code] 阻塞
    const { root, dir } = setupCmd(PURE_DELTA);
    expect(detectProposalStep(dir)).toBe('ready-to-merge');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-merge');
  });

  it('ST-S32-04: 重复 slice-exit --auto 幂等且默认派生稳定', async () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED']);
    await nextJson(root, true);
    await nextJson(root, true);
    expect(auditLines(dir).filter(l => JSON.parse(l).gate_id === 'slice-exit')).toHaveLength(1);
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(true);
    // 默认 next / status 派生 coding / code 不变
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('coding');
    expect(m.next_node?.id).toBe('code');
    expect(statusJson(root).modules[0].active_change.proposal_step).toBe('coding');
  });

  it('ST-S32-05: merge 后自动模式也必须先规划切片', async () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_TEMPLATE, ['SPEC_MERGED']);
    const first = await nextJson(root, true);
    expectPlanSlicesNotAutoPassed(first, dir);

    writeFileSync(join(dir, 'tasks.md'), DELTA_DONE_CODE_SLICES);
    const second = await nextJson(root, true);
    expect(second.gate_id).toBe('slice-exit');
    expect(second.gate_auto_passed).toBe(true);
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(true);
    expect(auditLines(dir).filter(l => JSON.parse(l).gate_id === 'slice-exit')).toHaveLength(1);
    expect(second.proposal_step).toBe('coding');
    expect(second.modules[0].next_node?.id).toBe('code');
  });
});

// ── 五、异常测试 ──
describe('S32 — 异常测试', () => {
  it('ST-S32-EX-1: 未 merge 不到切片时机（仍停 spec/merge 前沿）', async () => {
    // 无 SPEC_MERGED、[delta] 全勾、含 [code] 模板 → 仍在 spec/merge 段（ready-to-merge），不派生 ready-to-implement/plan-slices
    const { root, dir } = setupCmd(DELTA_DONE_CODE_TEMPLATE);
    expect(detectProposalStep(dir)).not.toBe('ready-to-implement');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).not.toBe('ready-to-implement');
    expect(m.next_node?.id).not.toBe('plan-slices');
    expect(m.proposal_step).toBe('ready-to-merge');
  });

  it('ST-S32-EX-2: 默认 next 不因 slice-exit 审计越门', async () => {
    // 手工构造 GATE_AUTO_PASSED 含 slice-exit 但无 SLICES_APPROVED → 默认 next 仍停 ready-to-implement（审计非状态源）
    const { root, dir } = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED']);
    writeFileSync(join(dir, 'GATE_AUTO_PASSED'),
      JSON.stringify({ gate_id: 'slice-exit', proposal_step: 'ready-to-implement', timestamp: '2000-01-01T00:00:00.000Z' }) + '\n');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-implement');
    expect(m.next_node?.id).toBe('plan-slices');
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(false);
  });

  it('ST-S32-EX-4: 未切片时 --auto 不得写空 SLICES_APPROVED', async () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_TEMPLATE, ['SPEC_MERGED']);
    const d = await nextJson(root, true);
    expectPlanSlicesNotAutoPassed(d, dir);
    expect(d.modules[0].next_node?.id).not.toBe('code');
  });

  it('UT-S32-26: SPEC_MERGED + code_required 但缺真实测试 ID → test-id-required', async () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_TEMPLATE, ['SPEC_MERGED'], 'feat', filledWithoutTestIds());
    expect(detectProposalStep(dir)).toBe('test-id-required');

    const statusData = statusJson(root);
    const s = statusData.modules[0].active_change;
    expect(s.proposal_step).toBe('test-id-required');
    expect(s.reason).toBe('code_change_requires_real_test_ids');

    const d = await nextJson(root);
    expect(d.proposal_step).toBe('test-id-required');
    expect(d.reason).toBe('code_change_requires_real_test_ids');
    expect(d.modules[0].reason).toBe('code_change_requires_real_test_ids');
    expect(d.modules[0].next_node?.id).not.toBe('plan-slices');
  });

  it('ST-S32-EX-6: 缺真实 UT/ST/SMOKE ID 时 next/status 不派 slice-planner', async () => {
    const { root } = setupCmd(PURE_CODE_TEMPLATE, ['SPEC_MERGED'], 'feat', filledWithoutTestIds());

    const s = statusJson(root).modules[0].active_change;
    expect(s.proposal_step).toBe('test-id-required');
    expect(s.reason).toBe('code_change_requires_real_test_ids');

    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('test-id-required');
    expect(m.reason).toBe('code_change_requires_real_test_ids');
    expect(m.next_node?.id).not.toBe('plan-slices');
    expect(m.action).toContain('测试 ID');
  });
});

// ── 六、纯代码提案（无 [delta]）需 no-delta SPEC_MERGED 后进入切片 ──
describe('S32 — 纯代码提案（无 [delta]）no-delta spec-complete', () => {
  it('UT-S32-10: 纯代码（无 [delta]）无 SPEC_MERGED、[code] 未脱模板 → spec-complete-required（不派 write-delta/plan-slices）', async () => {
    const { root, dir } = setupCmd(PURE_CODE_TEMPLATE); // 无任何 marker
    expect(detectProposalStep(dir)).toBe('spec-complete-required');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('spec-complete-required');
    expect(m.next_node?.id).not.toBe('plan-slices');
    expect(m.next_node?.id).not.toBe('write-delta');
    expect(m.proposal_step).not.toBe('delta-writing');
  });

  it('UT-S32-11: 纯代码 no-delta SPEC_MERGED 后 [code] 未脱模板 → ready-to-implement / plan-slices', async () => {
    const { root, dir } = setupCmd(PURE_CODE_TEMPLATE);
    writeNoDeltaMarker(dir);
    expect(detectProposalStep(dir)).toBe('ready-to-implement');
    const m = (await nextJson(root)).modules[0];
    expect(m.next_node?.id).toBe('plan-slices');
    expect(m.next_node?.gate_id).toBeUndefined();
  });

  it('UT-S32-12: 纯代码 no-delta SPEC_MERGED + [code] 脱模板后停 slice-exit 门', async () => {
    const { root, dir } = setupCmd(PURE_CODE_SLICES);
    writeNoDeltaMarker(dir);
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-implement');
    expect(m.next_node?.id).toBe('plan-slices');
    expect(m.next_node?.gate_id).toBe('slice-exit');
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(false);
  });

  it('ST-S32-EX-3: 纯代码提案（无 [delta]）需 no-delta merge 后进入切片', async () => {
    const { root, dir } = setupCmd(PURE_CODE_TEMPLATE);
    expect(detectProposalStep(dir)).toBe('spec-complete-required');
    const before = (await nextJson(root)).modules[0];
    expect(before.next_node?.id).not.toBe('plan-slices');
    runMerge(root);
    const marker = JSON.parse(readFileSync(join(dir, 'SPEC_MERGED'), 'utf-8'));
    expect(marker.type).toBe('no_delta_spec_complete');
    const after = (await nextJson(root)).modules[0];
    expect(after.proposal_step).toBe('ready-to-implement');
    expect(after.next_node?.id).toBe('plan-slices');
    expect(after.next_node?.id).not.toBe('write-delta');
    // 对照 ST-S32-EX-1：有 [delta] 提案无 SPEC_MERGED 仍停 spec/merge
    const deltaProp = setupCmd(DELTA_DONE_CODE_TEMPLATE, [], 'feat2');
    expect(detectProposalStep(deltaProp.dir)).not.toBe('ready-to-implement');
  });
});

// ── 七、enforce-slice-stage-ordering：提前填充 [code] auto-reset（§12.7 方案 C）──
function runMerge(root: string, slug = 'feat'): void {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  try { merge(slug); } finally { cap.restore(); ex.mockRestore(); restore(); }
}
function codeFilled(dir: string): boolean {
  return isTasksCodeFilled(readFileSync(join(dir, 'tasks.md'), 'utf-8'));
}
function autoresetLines(dir: string): any[] {
  const p = join(dir, 'CODE_AUTORESET');
  return existsSync(p) ? readFileSync(p, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

describe('S32 — 提前填充 [code] auto-reset（enforce-slice-stage-ordering）', () => {
  it('UT-S32-15: 有 [delta] 提案 merge 时 auto-reset 提前填充的 [code]（trigger:merge）', () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_SLICES); // 有 [delta] + [code] 提前填切片、无 SPEC_MERGED
    expect(codeFilled(dir)).toBe(true);
    runMerge(root);
    // [code] 被重置为占位、标题保留
    expect(codeFilled(dir)).toBe(false);
    expect(readFileSync(join(dir, 'tasks.md'), 'utf-8')).toContain('## [code]');
    // 备份含旧内容 + trigger:merge
    const lines = autoresetLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].trigger).toBe('merge');
    expect(lines[0].old_code).toContain('切片1');
    expect(lines[0].ts).toBeTruthy();
  });

  it('UT-S32-16: 纯代码提案 no-delta merge 时 auto-reset 提前填充的 [code]（trigger:merge）', async () => {
    const { root, dir } = setupCmd(PURE_CODE_SLICES); // 纯代码 + [code] 提前填、无 SPEC_MERGED
    runMerge(root);
    expect(codeFilled(dir)).toBe(false);
    expect(autoresetLines(dir)[0].trigger).toBe('merge');
    const marker = JSON.parse(readFileSync(join(dir, 'SPEC_MERGED'), 'utf-8'));
    expect(marker.type).toBe('no_delta_spec_complete');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-implement');
    expect(m.next_node?.id).toBe('plan-slices');
  });

  it('UT-S32-17: auto-reset 幂等（[code] 已占位不清理/不备份）', () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_TEMPLATE); // [code] 已是占位（[切片清单占位]）
    runMerge(root);           // SPEC_MERGED 写入
    runMerge(root);           // 已 merge → 幂等 return
    expect(existsSync(join(dir, 'CODE_AUTORESET'))).toBe(false); // 未 filled → 从不备份
  });

  it('UT-S32-18: 派生路径（status）只读、不触发 auto-reset', () => {
    const { root, dir } = setupCmd(PURE_CODE_SLICES); // [code] 提前填、无 marker
    statusJson(root);         // 纯派生
    expect(codeFilled(dir)).toBe(true);                          // [code] 未被修改
    expect(existsSync(join(dir, 'CODE_AUTORESET'))).toBe(false); // 无备份（被动派生只读）
  });

  it('ST-S32-06: 有 [delta] 提案提前填 [code] → merge auto-reset → slice-planner 重划 → 放行', async () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_SLICES); // 提前填
    runMerge(root);           // reset [code]、deltas 空 → 同时写 SPEC_MERGED
    expect(codeFilled(dir)).toBe(false);
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true);
    // merge 后前沿正常落 plan-slices（[code] 空）
    const m1 = (await nextJson(root)).modules[0];
    expect(m1.proposal_step).toBe('ready-to-implement');
    expect(m1.next_node?.id).toBe('plan-slices');
    expect(m1.next_node?.gate_id).toBeUndefined();
    // slice-planner 对已合并规格重划真实切片 → --auto 放行（有 delta 直接可放行）
    writeFileSync(join(dir, 'tasks.md'), DELTA_DONE_CODE_SLICES);
    const d = await nextJson(root, true);
    expect(d.proposal_step).toBe('coding');
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(true);
  });

  it('ST-S32-EX-5: 纯代码提案提前填 [code] → no-delta merge reset → plan-slices → 填 → 放行', async () => {
    const { root, dir } = setupCmd(PURE_CODE_SLICES); // 提前填、无 marker
    // 1) no-delta merge：reset + 写 SPEC_MERGED
    runMerge(root);
    expect(codeFilled(dir)).toBe(false);
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true);
    expect(autoresetLines(dir)[0].trigger).toBe('merge');
    const m1 = (await nextJson(root)).modules[0];
    expect(m1.proposal_step).toBe('ready-to-implement');
    expect(m1.next_node?.id).toBe('plan-slices');
    // 2) slice-planner 填真实切片 → filled → 放行 coding
    writeFileSync(join(dir, 'tasks.md'), PURE_CODE_SLICES);
    const d2 = await nextJson(root, true);
    expect(d2.gate_id).toBe('slice-exit');
    expect(d2.proposal_step).toBe('coding');
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(true);
  });
});

// ── 八、缺失 [code] section 的代码必需态回归（fix-missing-code-section-slice-gate）──
describe('S32 — 缺失 [code] section 的代码必需态', () => {
  it('UT-S32-19: SPEC_MERGED + 测试 delta + 缺失 [code] 仍进入 plan-slices', async () => {
    const { root, dir } = setupCmd(PURE_DELTA, ['SPEC_MERGED'], 'feat', codeRequiredProposal());
    writeTestDelta(dir, ['UT-S32-19', 'ST-S32-07']);

    expect(detectProposalStep(dir)).toBe('ready-to-implement');

    const statusData = statusJson(root);
    const s = statusData.modules[0].active_change;
    expect(s.proposal_step).toBe('ready-to-implement');
    expect(s.code_planning_diagnostic).toMatchObject({
      reason: 'tasks-code-section-missing',
      tasksPath: 'logos/changes/feat/tasks.md',
    });
    expect(statusData.modules[0].suggestion).toContain('slice-planner');
    expect(statusData.suggestion).toContain('slice-planner');
    expect(statusData.suggestion).not.toMatch(/verify|验收/);
    expect(statusData.modules[0].automation_diagnostic).toBeUndefined();

    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-implement');
    expect(m.next_node?.id).toBe('plan-slices');
    expect(m.next_node?.gate_id).toBeUndefined();
    expect(m.next_node?.id).not.toBe('verify');
    expect(m.next_node?.id).not.toBe('code');
    expect(m.code_planning_diagnostic?.reason).toBe('tasks-code-section-missing');
  });

  it('UT-S32-20: 缺失 [code] 的代码必需态 next --auto 不消费 slice-exit', async () => {
    const { root, dir } = setupCmd(PURE_DELTA, ['SPEC_MERGED'], 'feat', codeRequiredProposal());
    writeTestDelta(dir, ['UT-S32-20']);

    const d = await nextJson(root, true);
    expect(d.proposal_step).toBe('ready-to-implement');
    expect(d.gate_id).not.toBe('slice-exit');
    expect(d.gate_auto_passed).toBe(false);
    expect(d.modules[0].next_node?.id).toBe('plan-slices');
    expect(d.modules[0].next_node?.gate_id).toBeUndefined();
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(false);
    expect(auditLines(dir).filter(line => JSON.parse(line).gate_id === 'slice-exit')).toHaveLength(0);
  });

  it('UT-S32-21: 明确纯文档提案缺失 [code] 不被误伤', async () => {
    const { root, dir } = setupCmd(PURE_DELTA, ['SPEC_MERGED']);

    expect(detectProposalStep(dir)).toBe('ready-to-verify');
    const s = statusJson(root).modules[0].active_change;
    expect(s.proposal_step).toBe('ready-to-verify');
    expect(s.code_planning_diagnostic).toBeUndefined();

    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-verify');
    expect(m.next_node?.id).not.toBe('plan-slices');
  });

  it('UT-S32-22: slice-planner 可创建缺失 [code] section 并推进到 slice-exit', async () => {
    const { root, dir } = setupCmd(PURE_DELTA, ['SPEC_MERGED'], 'feat', codeRequiredProposal());
    writeTestDelta(dir, ['UT-S32-22']);

    const before = (await nextJson(root)).modules[0];
    expect(before.proposal_step).toBe('ready-to-implement');
    expect(before.next_node?.id).toBe('plan-slices');
    expect(before.next_node?.gate_id).toBeUndefined();

    writeFileSync(join(dir, 'tasks.md'), DELTA_DONE_CODE_SLICES);
    expect(isTasksCodeFilled(readFileSync(join(dir, 'tasks.md'), 'utf-8'))).toBe(true);

    const after = (await nextJson(root)).modules[0];
    expect(after.proposal_step).toBe('ready-to-implement');
    expect(after.next_node?.id).toBe('plan-slices');
    expect(after.next_node?.gate_id).toBe('slice-exit');

    const statusData = statusJson(root);
    expect(statusData.modules[0].suggestion).toContain('slice-exit');
    expect(statusData.suggestion).toContain('slice-exit');
    expect(statusData.suggestion).not.toMatch(/verify|验收/);
  });

  it('ST-S32-07: RunLogos 缺失 [code] 事故先派 slice-planner，切片写出后才进入 slice-exit/coding', async () => {
    const { root, dir } = setupCmd(PURE_DELTA, ['SPEC_MERGED'], 'feat', codeRequiredProposal());
    writeTestDelta(dir, ['UT-S32-19', 'UT-S32-22', 'ST-S32-07']);

    const first = await nextJson(root, true);
    expectPlanSlicesNotAutoPassed(first, dir);
    expect(first.modules[0].code_planning_diagnostic?.reason).toBe('tasks-code-section-missing');

    writeFileSync(join(dir, 'tasks.md'), DELTA_DONE_CODE_SLICES);
    const second = await nextJson(root);
    expect(second.modules[0].proposal_step).toBe('ready-to-implement');
    expect(second.modules[0].next_node?.gate_id).toBe('slice-exit');

    const third = await nextJson(root, true);
    expect(third.proposal_step).toBe('coding');
    expect(third.modules[0].next_node?.id).toBe('code');
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(true);
  });
});

describe('S32 — artifact 声明与切片合同诊断', () => {
  it('UT-S32-23: artifact 声明遗漏但磁盘产物存在可诊断', () => {
    const { root, dir } = setupCmd([
      '# 任务',
      '',
      '## [delta] 规格变更',
      '- [x] d',
      '',
      '## [code] 代码实现',
      '- [ ] 切片：覆盖 UT-S32-23，需要业务代码、测试和 reporter',
    ].join('\n'), ['SPEC_MERGED', 'SLICES_APPROVED']);
    mkdirSync(join(root, 'cli/src'), { recursive: true });
    mkdirSync(join(root, 'cli/test'), { recursive: true });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'cli/src/s32.ts'), 'export const s32 = true;\n');
    writeFileSync(join(root, 'cli/test/s32-extra.test.ts'), 'it("UT-S32-23",()=>{});\n');
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), '{"id":"UT-S32-23","status":"pass"}\n');

    const diagnostic = deriveAutomationDiagnostic(root, {
      proposalDir: dir,
      requiredTestIds: ['UT-S32-23'],
      declaredArtifacts: ['cli/src/s32.ts'],
    });

    expect(diagnostic).toMatchObject({
      reason: 'artifact-missing',
      completion_state: 'slice_incomplete',
    });
    expect(diagnostic?.missing_artifacts).toContain('cli/test/');
    expect(diagnostic?.remediation).toContain('更正');
  });

  it('UT-S32-24: artifact 越界必须阻断并要求人工或重派', () => {
    const { root, dir } = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED', 'SLICES_APPROVED']);

    const diagnostic = deriveAutomationDiagnostic(root, {
      proposalDir: dir,
      declaredArtifacts: ['../outside.txt'],
    });

    expect(diagnostic).toMatchObject({
      reason: 'artifact-out-of-scope',
      completion_state: 'invalid_done_claim',
      human_action_required: true,
      suggested_next_node: 'manual',
    });
  });

  it('UT-S32-25: 更正 artifacts 后重新验证通过局部完成', () => {
    const { root, dir } = setupCmd([
      '# 任务',
      '',
      '## [delta] 规格变更',
      '- [x] d',
      '',
      '## [code] 代码实现',
      '- [x] 切片：覆盖 UT-S32-25，需要业务代码、测试和 reporter',
    ].join('\n'), ['SPEC_MERGED', 'SLICES_APPROVED']);
    mkdirSync(join(root, 'cli/src'), { recursive: true });
    mkdirSync(join(root, 'cli/test'), { recursive: true });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'cli/src/s32-corrected.ts'), 'export const corrected = true;\n');
    writeFileSync(join(root, 'cli/test/s32-corrected.test.ts'), 'it("UT-S32-25",()=>{});\n');
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S32-25","status":"pass"}',
      '{"id":"UT-S32-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    const first = deriveAutomationDiagnostic(root, {
      proposalDir: dir,
      requiredTestIds: ['UT-S32-25'],
      declaredArtifacts: ['cli/src/s32-corrected.ts'],
    });
    expect(first?.reason).toBe('artifact-missing');

    const corrected = deriveAutomationDiagnostic(root, {
      proposalDir: dir,
      requiredTestIds: ['UT-S32-25'],
      declaredArtifacts: ['cli/src/s32-corrected.ts', 'cli/test/s32-corrected.test.ts'],
      verifyGate: 'FAIL',
      failedTests: ['UT-S32-REG'],
    });
    expect(corrected).toMatchObject({
      reason: 'global-verify-failed',
      completion_state: 'slice_done_global_verify_failed',
    });
    expect(corrected?.validated_artifacts).toEqual(['cli/src/s32-corrected.ts', 'cli/test/s32-corrected.test.ts']);
  });

  it('ST-S32-08: slice-planner 产物驱动后续 artifact 校验', () => {
    const { root, dir } = setupCmd([
      '# 任务',
      '',
      '## [delta] 规格变更',
      '- [x] d',
      '',
      '## [code] 代码实现',
      '- [ ] 切片：实现诊断闭环（覆盖 UT-S32-23、UT-S32-24、UT-S32-25、ST-S32-08）',
    ].join('\n'), ['SPEC_MERGED', 'SLICES_APPROVED']);
    mkdirSync(join(root, 'cli/src'), { recursive: true });
    mkdirSync(join(root, 'cli/test'), { recursive: true });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'cli/src/s32-st.ts'), 'export const st = true;\n');
    writeFileSync(join(root, 'cli/test/s32-st.test.ts'), 'it("ST-S32-08",()=>{});\n');
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S32-23","status":"pass"}',
      '{"id":"UT-S32-24","status":"pass"}',
      '{"id":"UT-S32-25","status":"pass"}',
      '{"id":"ST-S32-08","status":"pass"}',
    ].join('\n') + '\n');

    const diagnostic = deriveAutomationDiagnostic(root, {
      proposalDir: dir,
      declaredArtifacts: ['cli/src/s32-st.ts', 'cli/test/s32-st.test.ts'],
    });

    expect(diagnostic?.required_test_ids).toEqual(['UT-S32-23', 'UT-S32-24', 'UT-S32-25', 'ST-S32-08']);
    expect(diagnostic?.validated_artifacts).toEqual(['cli/src/s32-st.ts', 'cli/test/s32-st.test.ts']);
    expect(diagnostic?.missing_artifacts).toEqual([]);
  });
});
