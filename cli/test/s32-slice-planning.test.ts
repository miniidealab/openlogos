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
import { loadBuiltinFlow } from '../src/lib/flow.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function filled(): string {
  return [
    '# 变更提案：feat', '', '## 变更原因', '需要新能力。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01', '', '## 部署影响',
    '- 是否需要部署：否', '- 部署原因：纯文档', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '概述。',
  ].join('\n');
}

/** 建带 guard 的 launched 命令级 fixture（活跃提案 = filled proposal + 指定 tasks/markers）。 */
function setupCmd(tasks: string, markers: string[] = [], slug = 'feat'): { root: string; dir: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }, { lineWidth: 0 }));
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-06-20T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(join(dir, 'deltas', 'spec'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), filled());
  writeFileSync(join(dir, 'tasks.md'), tasks);
  for (const mk of markers) writeFileSync(join(dir, mk), '');
  return { root, dir };
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

// tasks 片段
const DELTA_DONE_CODE_TEMPLATE = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] [切片清单占位]';
const DELTA_DONE_CODE_SLICES = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片1\n- [ ] 切片2';
const PURE_DELTA = '# 任务\n\n## [delta] 规格变更\n- [x] d';

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
  });

  it('UT-S32-05: plan-slices 完成判定 = [code] 脱模板 → 停在 slice-exit 门（slice-exit, skippable:true）', async () => {
    // [code] 已脱模板（切片写出、未勾）、SLICES_APPROVED 不存在 → ready-to-implement，停 slice-exit 门等批准（不进入 coding）。
    // 注：默认 next 顶层不回显 gate；门归属经 --auto 顶层 gate 字段核验（与 plan-exit 一致）。
    const { root, dir } = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED']);
    expect(detectProposalStep(dir)).toBe('ready-to-implement');
    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-implement');
    expect(m.next_node?.id).toBe('plan-slices');
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(false);
    // --auto 下顶层 gate = slice-exit、skippable:true（停门待批准的归属门）
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
});

// ── 四、场景测试 ──
describe('S32 — 场景测试', () => {
  it('ST-S32-01: merge 后切片规划端到端至 slice-exit 放行进 coding', async () => {
    // 1) merge 就绪、[code] 仍模板 → ready-to-implement、next_node=plan-slices
    const tpl = setupCmd(DELTA_DONE_CODE_TEMPLATE, ['SPEC_MERGED']);
    const m1 = (await nextJson(tpl.root)).modules[0];
    expect(m1.proposal_step).toBe('ready-to-implement');
    expect(m1.next_node?.id).toBe('plan-slices');
    // 2) 写出 [code] 切片（脱模板、未勾）→ 仍 ready-to-implement、停 slice-exit 门
    const filledFix = setupCmd(DELTA_DONE_CODE_SLICES, ['SPEC_MERGED']);
    const m2 = (await nextJson(filledFix.root)).modules[0];
    expect(m2.proposal_step).toBe('ready-to-implement');
    // 3) --auto 放行 slice-exit → 写 SLICES_APPROVED + 审计 → 派生 coding、next_node=code（进入 S31 切片循环）
    const d3 = await nextJson(filledFix.root, true);
    expect(existsSync(join(filledFix.dir, 'SLICES_APPROVED'))).toBe(true);
    expect(d3.proposal_step).toBe('coding');
    expect(d3.modules[0].next_node?.id).toBe('code');
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
});
