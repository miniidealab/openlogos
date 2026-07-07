/**
 * S31 — change-flow-redesign 代码切片循环（plan/spec/merge + code_slices_green + slice_state）。
 *
 * 覆盖切片 3/4/6 的核心派生：
 *  - ready-to-delta 驻留态检测（含纯代码提案不受影响）
 *  - slice_state 计数与省略规则（deriveSliceState / deriveSliceStateIfActive）
 *  - code_slices_green 复合收敛与空 [code] 退化（deriveLoopState，绝不死锁）
 *  - gateForProposalStep 三门映射（plan-exit / spec-exit / deliver-entry，均 skippable）
 * 用例名带 UT/ST-S31-* 供 OpenLogos reporter 追溯。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { detectProposalStep, status, type ModuleInfo } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import { verify } from '../src/commands/verify.js';
import { detectProposalStepViaFlow, gateForProposalStep } from '../src/lib/flow-derive.js';
import { deriveSliceState, deriveSliceStateIfActive, deriveLoopState, type LoopState } from '../src/lib/flow-loop-derive.js';
import { loadBuiltinFlow } from '../src/lib/flow.js';
import { checkSmokeCoverage } from '../src/lib/smoke-coverage.js';
import { deriveAutomationDiagnostic } from '../src/lib/automation-diagnostic.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function filled(): string {
  return [
    '# 变更提案：feat', '', '## 变更原因', '需要新能力。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01', '', '## 部署影响',
    '- 是否需要部署：否', '- 部署原因：纯文档', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '概述。',
  ].join('\n');
}

function codeRequiredProposal(): string {
  return filled()
    .replace('## 变更类型\n设计级', '## 变更类型\n代码级修复')
    .replace('## 变更概述\n概述。', '## 变更概述\n需要 CLI 状态派生代码、测试和 reporter 实现。');
}

/** 建提案目录并写 proposal/tasks（可选 delta 文件、LOOP_ITERS 行）。返回 { root, dir }。 */
function makeProposal(tasks: string, opts: { deltaFile?: boolean; loop?: Array<'pass' | 'fail'> } = {}): { root: string; dir: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  const dir = join(root, 'logos', 'changes', 'feat');
  mkdirSync(join(dir, 'deltas', 'spec'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), filled());
  writeFileSync(join(dir, 'tasks.md'), tasks);
  if (opts.deltaFile) writeFileSync(join(dir, 'deltas', 'spec', 'x.md'), 'delta');
  if (opts.loop) {
    writeFileSync(join(dir, 'LOOP_ITERS'),
      opts.loop.map((r, i) => JSON.stringify({ iter: i + 1, node: 'verify', result: r, module: 'core', timestamp: 't' })).join('\n') + '\n');
  }
  return { root, dir };
}

const LAUNCHED_MOD: ModuleInfo = { id: 'core', name: 'core', lifecycle: 'launched' };

// ── 一、ready-to-delta 检测 ──
describe('S31 — ready-to-delta 驻留态检测', () => {
  it('UT-S31-01: 脱模板 + [delta] 未启动（无勾、无 delta 文件）→ ready-to-delta', () => {
    const { dir } = makeProposal('# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta');
    expect(detectProposalStepViaFlow(dir)).toBe('ready-to-delta');
    expect(detectProposalStep(dir)).toBe('ready-to-delta'); // 两处派生一致
  });

  it('UT-S31-02: 空 [delta] section（total=0、无 delta 文件）→ ready-to-delta', () => {
    const { dir } = makeProposal('# 任务\n\n## [delta] 规格变更\n');
    expect(detectProposalStepViaFlow(dir)).toBe('ready-to-delta');
  });

  it('UT-S31-03: [delta] 勾了一项 → delta-writing（已启动，离开 ready-to-delta）', () => {
    const { dir } = makeProposal('# 任务\n\n## [delta] 规格变更\n- [x] d1\n- [ ] d2');
    expect(detectProposalStepViaFlow(dir)).toBe('delta-writing');
  });

  it('UT-S31-04: [delta] 未勾但已产出 delta 文件 → delta-writing（已启动）', () => {
    const { dir } = makeProposal('# 任务\n\n## [delta] 规格变更\n- [ ] d1', { deltaFile: true });
    expect(detectProposalStepViaFlow(dir)).toBe('delta-writing');
  });

  it('UT-S31-05: 纯代码提案（无 [delta] section）缺 SPEC_MERGED → spec-complete-required（非 ready-to-delta/delta-writing）', () => {
    // support-nodelta-spec-complete：无 [delta] 纯代码提案不再 spec/merge 空过。
    // 关键仍是「不落 ready-to-delta / delta-writing」，而是停 no-delta spec-complete。
    const { dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [ ] 实现 x');
    expect(detectProposalStepViaFlow(dir)).toBe('spec-complete-required');
    expect(detectProposalStep(dir)).toBe('spec-complete-required');
  });

  it('UT-S31-06: [delta] 全勾 → ready-to-merge（不被 ready-to-delta 抢占）', () => {
    const { dir } = makeProposal('# 任务\n\n## [delta] 规格变更\n- [x] d1');
    expect(detectProposalStepViaFlow(dir)).toBe('ready-to-merge');
  });
});

// ── 二、slice_state 计数与省略 ──
describe('S31 — slice_state 计数与省略规则', () => {
  it('UT-S31-10: deriveSliceState 计数 total/done/current/remaining', () => {
    const { dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [x] 切片1\n- [ ] 切片2：API 编排\n- [ ] 切片3');
    expect(deriveSliceState(dir)).toEqual({ total: 3, done: 1, remaining: 2, current: '切片2：API 编排' });
  });

  it('UT-S31-11: [code] 全勾 → current 省略', () => {
    const { dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [x] 切片1\n- [x] 切片2');
    expect(deriveSliceState(dir)).toEqual({ total: 2, done: 2, remaining: 0 });
  });

  it('UT-S31-12: 空 [code]（total=0）→ {total:0,done:0,remaining:0}（无 current）', () => {
    const { dir } = makeProposal('# 任务\n\n## [code] 代码实现\n');
    expect(deriveSliceState(dir)).toEqual({ total: 0, done: 0, remaining: 0 });
  });

  it('UT-S31-13: builtin launched（切片循环默认激活）+ 提案目录 → deriveSliceStateIfActive 非 null', () => {
    const { root, dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [ ] 切片1');
    const ss = deriveSliceStateIfActive(root, LAUNCHED_MOD, dir);
    expect(ss).toMatchObject({ total: 1, done: 0, remaining: 1, current: '切片1' });
  });

  it('UT-S31-14: initial（builtin 无切片循环）→ deriveSliceStateIfActive 省略（null）', () => {
    const { root, dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [ ] 切片1');
    expect(deriveSliceStateIfActive(root, { id: 'core', name: 'core', lifecycle: 'initial' }, dir)).toBeNull();
  });

  it('UT-S31-14b: launched 无提案目录 → deriveSliceStateIfActive 省略（null）', () => {
    const { root } = makeProposal('# 任务\n\n## [code] 代码实现\n- [ ] 切片1');
    expect(deriveSliceStateIfActive(root, LAUNCHED_MOD, null)).toBeNull();
  });

  it('UT-S31-15: 缩进子任务 checkbox 不参与顶层切片计数', () => {
    const { dir } = makeProposal([
      '# 任务',
      '',
      '## [code] 代码实现',
      '- [ ] 切片1：Agent idle 状态读取契约',
      '  - [ ] 扩展 open-agent bridge 状态 IPC',
      '  - [x] 扩展 AgentAdapter 状态入口',
      '  - [ ] 补 AgentPanel idle/background/pending/streaming 读取',
      '- [ ] 切片2：完成屏障消费 Agent idle 状态',
      '  - [ ] drift-only 必须等待 Agent idle',
    ].join('\n'));
    expect(deriveSliceState(dir)).toMatchObject({
      total: 2,
      done: 0,
      remaining: 2,
      current: '切片1：Agent idle 状态读取契约',
    });
  });

  it('UT-S31-16: 父切片已勾但子任务未全勾时不计 done', () => {
    const { dir } = makeProposal([
      '# 任务',
      '',
      '## [code] 代码实现',
      '- [x] 切片1：Agent idle 状态读取契约',
      '  - [x] 扩展 open-agent bridge 状态 IPC',
      '  - [ ] 扩展 AgentAdapter 状态入口',
      '- [ ] 切片2：完成屏障消费 Agent idle 状态',
    ].join('\n'));
    expect(deriveSliceState(dir)).toEqual({
      total: 2,
      done: 0,
      remaining: 2,
      current: '切片1：Agent idle 状态读取契约',
      current_children: [
        { text: '扩展 open-agent bridge 状态 IPC', checked: true },
        { text: '扩展 AgentAdapter 状态入口', checked: false },
      ],
      current_unchecked_children: ['扩展 AgentAdapter 状态入口'],
    });
  });

  it('UT-S31-18: 无缩进 checkbox 时保持既有输出兼容', () => {
    const { dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [x] 切片1\n- [ ] 切片2');
    expect(deriveSliceState(dir)).toEqual({
      total: 2,
      done: 1,
      remaining: 1,
      current: '切片2',
    });
  });
});

// ── 三、code_slices_green 复合收敛 + 空 [code] 退化 ──
describe('S31 — code_slices_green 复合收敛', () => {
  const flow = loadBuiltinFlow('launched'); // implement loop: code_slices_green, max_iters:30
  function loop(root: string, dir: string): LoopState | null {
    return deriveLoopState(root, LAUNCHED_MOD, dir, false, flow);
  }

  it('复合收敛：切片全勾 ∧ 末轮 pass → converged:true', () => {
    const { root, dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [x] 切片1\n- [x] 切片2', { loop: ['fail', 'pass'] });
    expect(loop(root, dir)).toMatchObject({ until: 'code_slices_green', converged: true });
  });

  it('internal-S31-converged-requires-all-slices: 测试绿但切片未全勾 → converged:false（复合收敛更严，不误判完成）', () => {
    const { root, dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [x] 切片1\n- [ ] 切片2', { loop: ['pass'] });
    expect(loop(root, dir)).toMatchObject({ converged: false });
  });

  it('internal-S31-converged-requires-tests-green: 切片全勾但末轮 fail → converged:false', () => {
    const { root, dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [x] 切片1', { loop: ['fail'] });
    expect(loop(root, dir)).toMatchObject({ converged: false });
  });

  it('internal-S31-empty-code-no-section-pass: 空 [code]（无 section）+ 末轮 pass → 退化为 tests_green、converged:true（不死锁）', () => {
    const { root, dir } = makeProposal('# 任务\n\n## [delta] 规格变更\n- [x] d', { loop: ['pass'] });
    expect(loop(root, dir)).toMatchObject({ converged: true });
  });

  it('internal-S31-docs-only-no-code-section-pass: 无 [code] section + 末轮 pass → 退化 tests_green、converged:true（不死锁）', () => {
    const { root, dir } = makeProposal('# 任务\n\n## [delta] 规格变更\n- [x] d', { loop: ['pass'] });
    expect(loop(root, dir)).toMatchObject({ converged: true });
  });

  it('internal-S31-no-ledger-not-converged: iteration=0（无账本）→ converged:false（出环未达，前沿钉在 verify）', () => {
    const { root, dir } = makeProposal('# 任务\n\n## [code] 代码实现\n- [x] 切片1');
    expect(loop(root, dir)).toMatchObject({ iteration: 0, converged: false });
  });

  it('UT-S31-07: 纯文档无 [code] section 退化为 tests_green → converged:true + slice_state{total:0}（不因无切片卡死）', () => {
    // 无代码需求：复合收敛退化为纯 tests_green（仅看末轮 pass），绝不死锁；slice_state 同时报 total:0。
    const { root, dir } = makeProposal('# 任务\n\n## [delta] 规格变更\n- [x] d', { loop: ['pass'] });
    expect(loop(root, dir)).toMatchObject({ until: 'code_slices_green', converged: true });
    expect(deriveSliceState(dir)).toEqual({ total: 0, done: 0, remaining: 0 });
  });
});

// ── 四、gate 三门映射 ──
describe('S31 — gateForProposalStep 三门映射', () => {
  it('UT-S31-30: ready-to-delta → plan-exit skippable:true', () => {
    expect(gateForProposalStep('ready-to-delta')).toEqual({ gate_id: 'plan-exit', skippable: true });
  });
  it('UT-S31-31: ready-to-merge → spec-exit skippable:true', () => {
    expect(gateForProposalStep('ready-to-merge')).toEqual({ gate_id: 'spec-exit', skippable: true });
  });
  it('UT-S31-32: ready-to-deploy → deliver-entry skippable:true', () => {
    expect(gateForProposalStep('ready-to-deploy')).toEqual({ gate_id: 'deliver-entry', skippable: true });
  });
});

// ── 五、命令级契约（next_node.slice / ready-to-delta 文案 / verify 写 slice）——子代理遗漏的命令级断言 ──
/** 建带 guard 的 launched 命令级 fixture（活跃提案 = filled proposal + 指定 tasks/markers）。 */
function setupCmd(tasks: string, markers: string[] = [], slug = 'feat', proposal = filled()): { root: string; dir: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root);
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

function writeTestDelta(dir: string, ids: string[] = ['UT-S31-19', 'ST-S31-08']): void {
  mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
  writeFileSync(join(dir, 'deltas', 'test', 'core-S31-test-cases.md'), ids.map(id => `| ${id} | 新增回归 |`).join('\n'));
}
async function nextJson(root: string): Promise<{ modules: Array<Record<string, any>> }> {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  try { await next('json'); } finally { cap.restore(); ex.mockRestore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}
/** 顶层 next --auto 求值（含 gate 字段 / gate_auto_passed）。 */
async function nextJsonAuto(root: string): Promise<Record<string, any>> {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  try { await next('json', undefined, true); } finally { cap.restore(); ex.mockRestore(); restore(); }
  return JSON.parse(cap.logs[cap.logs.length - 1]).data;
}
/** 写 N 行 LOOP_ITERS（默认 fail；可指定每行 result）。 */
function writeLedgerRows(dir: string, results: Array<'pass' | 'fail'>): void {
  writeFileSync(join(dir, 'LOOP_ITERS'),
    results.map((r, i) => JSON.stringify({ iter: i + 1, node: 'verify', result: r, module: 'core', timestamp: 't' })).join('\n') + '\n');
}
function writeStaleVerifyFailure(root: string, passId = 'UT-S31-stale-pass'): void {
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
    JSON.stringify({ id: passId, status: 'pass' }),
    JSON.stringify({ id: 'UT-S31-STALE-REG', status: 'fail', error: 'stale regression' }),
  ].join('\n') + '\n');
}
/** 运行 verify（json），返回是否 exit + 捕获 stderr。 */
function runVerify(root: string): { exited: boolean; errors: string[] } {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  let exited = false;
  try { verify('json'); } catch { exited = true; } finally { cap.restore(); ex.mockRestore(); restore(); }
  return { exited, errors: cap.errors };
}
/** 写 verify fixture（最小用例 + 可选结果）；无结果 → NO_TEST_RESULTS 早退。 */
function writeVerifyFixture(root: string, result?: 'pass' | 'fail'): void {
  writeFileSync(join(root, 'logos', 'resources', 'test', 'core-S99-test-cases.md'),
    '# S99\n\n| ID | 描述 |\n|----|----|\n| UT-S99-01 | demo |\n');
  if (result) {
    writeFileSync(join(root, 'logos', 'resources', 'verify', 'test-results.jsonl'),
      JSON.stringify({ id: 'UT-S99-01', status: result }) + '\n');
  }
}

describe('S31 — 命令级契约', () => {
  it('UT-S31-40: coding 阶段 next_node 指向 code 且带 slice（=slice_state.current，不依赖 verify 前沿）', async () => {
    // SPEC_MERGED + [code] 未全勾 → coding；切片循环激活、未收敛、未达上限 → 注入 next_node.slice（高修：iteration=0 也注入）
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片1\n- [ ] 切片2', ['SPEC_MERGED', 'SLICES_APPROVED']);
    expect(detectProposalStep(dir)).toBe('coding'); // 直测确认阶段（next 的 active_change 是字符串、无 proposal_step）
    const m = (await nextJson(root)).modules[0];
    expect(m.next_node?.id).toBe('code');
    expect(m.slice_state?.current).toBe('切片1');
    expect(m.next_node?.slice).toBe('切片1'); // 高修：iteration=0 也注入
  });

  it('UT-S31-17: next_node 输出当前切片子任务', async () => {
    const { root } = setupCmd([
      '# 任务',
      '',
      '## [delta] 规格变更',
      '- [x] d',
      '',
      '## [code] 代码实现',
      '- [ ] 切片1：Agent idle 状态读取契约',
      '  - [x] 扩展 open-agent bridge 状态 IPC',
      '  - [ ] 扩展 AgentAdapter 状态入口',
      '- [ ] 切片2：完成屏障消费 Agent idle 状态',
    ].join('\n'), ['SPEC_MERGED', 'SLICES_APPROVED']);
    const m = (await nextJson(root)).modules[0];
    expect(m.next_node?.id).toBe('code');
    expect(m.next_node?.slice).toBe('切片1：Agent idle 状态读取契约');
    expect(m.slice_state.current_children).toEqual([
      { text: '扩展 open-agent bridge 状态 IPC', checked: true },
      { text: '扩展 AgentAdapter 状态入口', checked: false },
    ]);
    expect(m.slice_state.current_unchecked_children).toEqual(['扩展 AgentAdapter 状态入口']);
    expect(m.next_node?.slice_children).toEqual(m.slice_state.current_children);
  });

  it('UT-S31-08: next 选第一个未勾切片 + slice 子提示（勾 2 → slice = 第 3 行标题）', async () => {
    // [code] 3 行勾 2 → coding、切片循环激活、未收敛未达上限 → next_node.id==code、slice = 第一个未勾（第 3 行）
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [x] 切片1\n- [x] 切片2\n- [ ] 切片3：收尾', ['SPEC_MERGED', 'SLICES_APPROVED']);
    expect(detectProposalStep(dir)).toBe('coding');
    const m = (await nextJson(root)).modules[0];
    expect(m.next_node?.id).toBe('code');
    expect(m.slice_state).toMatchObject({ total: 3, done: 2, remaining: 1, current: '切片3：收尾' });
    expect(m.next_node?.slice).toBe('切片3：收尾'); // 选第一个未勾切片
  });

  it('UT-S31-09: slice 指「未建」切片（后片打断先片、全量 verify fail）→ 仍指第一个未勾行，不指已勾回归源', async () => {
    // 切片1 已勾（疑似被后续切片回归打断），切片2/3 未勾、全量 verify FAIL（账本末行 fail）。
    // slice 提示应指"建哪片"=第一个未勾（切片2），而非"修哪片"=已勾的回归源（切片1）。
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [x] 切片1\n- [ ] 切片2\n- [ ] 切片3', ['SPEC_MERGED', 'SLICES_APPROVED']);
    writeFileSync(join(dir, 'LOOP_ITERS'),
      JSON.stringify({ iter: 1, node: 'verify', result: 'fail', module: 'core', timestamp: 't', slice: '切片2' }) + '\n');
    expect(detectProposalStep(dir)).toBe('coding');
    const m = (await nextJson(root)).modules[0];
    expect(m.next_node?.slice).toBe('切片2'); // 第一个未勾（建哪片）
    expect(m.next_node?.slice).not.toBe('切片1'); // 不指向已勾的回归源（非"修哪片"）
    expect(m.slice_state?.current).toBe('切片2');
  });

  it('UT-S31-41: ready-to-delta 的 next 动作是「批准方案」而非「写 delta」', async () => {
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [ ] d'); // 无 SPEC_MERGED、delta 未启动 → ready-to-delta
    expect(detectProposalStep(dir)).toBe('ready-to-delta');
    const m = (await nextJson(root)).modules[0];
    expect(m.action).toContain('Approve the plan');
    expect(m.action).not.toContain('Write delta');
  });

  it('UT-S31-42: verify 在切片循环激活时把当前切片写进 LOOP_ITERS', () => {
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片A\n- [ ] 切片B', ['SPEC_MERGED']);
    writeFileSync(join(root, 'logos', 'resources', 'test', 'core-S99-test-cases.md'),
      '# S99\n\n| ID | 描述 |\n|----|----|\n| UT-S99-01 | demo |\n');
    writeFileSync(join(root, 'logos', 'resources', 'verify', 'test-results.jsonl'),
      JSON.stringify({ id: 'UT-S99-01', status: 'pass' }) + '\n');
    const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
    try { verify('json'); } catch { /* process.exit */ } finally { cap.restore(); ex.mockRestore(); restore(); }
    const ledger = join(dir, 'LOOP_ITERS');
    expect(existsSync(ledger)).toBe(true);
    expect(JSON.parse(readFileSync(ledger, 'utf-8').trim().split('\n').pop()!).slice).toBe('切片A');
  });
});

// ── 六、场景测试（端到端：逐片推进 / 升级退出门 / 退化 / 全量回归 / 异常）──
const CODE3 = (c: [boolean, boolean, boolean]) =>
  `# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [${c[0] ? 'x' : ' '}] 切片1\n- [${c[1] ? 'x' : ' '}] 切片2\n- [${c[2] ? 'x' : ' '}] 切片3`;

describe('S31 — 场景测试', () => {
  it('ST-S31-01: 逐片推进端到端（每轮 next 指向下一未勾片；全勾+末轮绿出环续推）', async () => {
    // 第 1 轮：全未勾 → next 指向切片1
    const s1 = setupCmd(CODE3([false, false, false]), ['SPEC_MERGED', 'SLICES_APPROVED']);
    expect((await nextJson(s1.root)).modules[0].next_node?.slice).toBe('切片1');
    // 第 2 轮：切片1 已勾 → next 指向切片2
    const s2 = setupCmd(CODE3([true, false, false]), ['SPEC_MERGED', 'SLICES_APPROVED']);
    writeLedgerRows(s2.dir, ['pass']);
    const m2 = (await nextJson(s2.root)).modules[0];
    expect(m2.next_node?.slice).toBe('切片2');
    expect(m2.loop_state?.converged).toBe(false); // 仍有未勾片 → 未收敛
    // 末态：全部勾选 + 末轮 verify(PASS) → converged 出环（不再指向 code 片）
    const s3 = setupCmd(CODE3([true, true, true]), ['SPEC_MERGED', 'SLICES_APPROVED']);
    writeLedgerRows(s3.dir, ['pass']);
    const m3 = (await nextJson(s3.root)).modules[0];
    expect(m3.loop_state?.converged).toBe(true);
    expect(m3.next_node?.slice).toBeUndefined(); // 出环：不再注入切片子提示
  });

  it('ST-S31-02: 中途某片不绿 → 同片继续迭代（slice_state.current 仍指该片、不推进）', async () => {
    // 切片1 已勾、切片2 进行中 verify(FAIL)：账本末行 fail、current 仍指切片2、未收敛
    const { root, dir } = setupCmd(CODE3([true, false, false]), ['SPEC_MERGED', 'SLICES_APPROVED']);
    writeLedgerRows(dir, ['fail']);
    const m = (await nextJson(root)).modules[0];
    expect(m.slice_state?.current).toBe('切片2');
    expect(m.loop_state?.converged).toBe(false);
    expect(m.next_node?.slice).toBe('切片2'); // 继续做同一未勾片，不跳过
  });

  it('ST-S31-03: 全部完成且测试绿 → converged:true 出环到 deliver/close', async () => {
    const { root, dir } = setupCmd(CODE3([true, true, true]), ['SPEC_MERGED']);
    writeLedgerRows(dir, ['fail', 'pass']); // 末轮 pass
    const data = await nextJson(root);
    expect(data.modules[0].loop_state).toMatchObject({ until: 'code_slices_green', converged: true });
    // 出环：next 不再钉在 code 切片
    expect(data.modules[0].next_node?.slice).toBeUndefined();
  });

  it('ST-S31-04: 达上限升级退出门（gate:implement:loop-exhausted、skippable:false、--auto 仍卡）', async () => {
    // 全勾但 30 轮均 fail（未绿）→ 前沿 ready-to-verify、escalated；--auto 默认仍阻塞不写审计
    const { root, dir } = setupCmd(CODE3([true, true, true]), ['SPEC_MERGED']);
    writeLedgerRows(dir, Array<'fail'>(30).fill('fail'));
    expect(detectProposalStep(dir)).toBe('ready-to-verify');
    const data = await nextJsonAuto(root);
    expect(data.modules[0].loop_state).toMatchObject({ escalated: true, max_iters: 30 });
    expect(data.gate_id).toBe('gate:implement:loop-exhausted');
    expect(data.skippable).toBe(false);
    expect(data.gate_auto_passed).toBe(false);
    expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(false); // --auto 不放行未收敛代码
  });

  it('ST-S31-05: 空 [code] 提案（纯 delta）不被卡死 → 按 tests_green 收敛出环', async () => {
    // 纯 delta 提案（无 [code] section）走 implement：退化为 tests_green，末轮 pass → converged
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d', ['SPEC_MERGED']);
    writeLedgerRows(dir, ['pass']);
    expect(detectProposalStep(dir)).toBe('ready-to-verify'); // 无 [code] → 直接可 verify
    const m = (await nextJson(root)).modules[0];
    expect(m.loop_state).toMatchObject({ converged: true }); // 退化 tests_green，不死锁
  });

  it('ST-S31-06: 全量回归把关（局部绿全局红不出环）—— [code] 全勾但全量 verify(FAIL) → 不收敛', async () => {
    // 第 3 片实现破坏第 1 片：[code] 全勾，但末轮全量 verify FAIL → tests_green:false → converged:false，不出环
    const { root, dir } = setupCmd(CODE3([true, true, true]), ['SPEC_MERGED']);
    writeLedgerRows(dir, ['pass', 'fail']); // 末轮 fail（全量回归红）
    const m = (await nextJson(root)).modules[0];
    expect(m.loop_state?.converged).toBe(false); // 即便 [code] 全勾，末轮 fail → 不出环
  });

  it('ST-S31-07: 父切片与子任务全部完成后才推进下一片', async () => {
    const baseTasks = (firstParent: boolean, firstChildren: [boolean, boolean, boolean]): string => [
      '# 任务',
      '',
      '## [delta] 规格变更',
      '- [x] d',
      '',
      '## [code] 代码实现',
      `- [${firstParent ? 'x' : ' '}] 切片1：Agent idle 状态读取契约`,
      `  - [${firstChildren[0] ? 'x' : ' '}] 扩展 open-agent bridge 状态 IPC`,
      `  - [${firstChildren[1] ? 'x' : ' '}] 扩展 AgentAdapter 状态入口`,
      `  - [${firstChildren[2] ? 'x' : ' '}] 补 AgentPanel idle/background/pending/streaming 读取`,
      '- [ ] 切片2：完成屏障消费 Agent idle 状态',
    ].join('\n');

    const blocked = setupCmd(baseTasks(true, [true, false, true]), ['SPEC_MERGED', 'SLICES_APPROVED']);
    writeLedgerRows(blocked.dir, ['pass']);
    const blockedState = (await nextJson(blocked.root)).modules[0];
    expect(blockedState.slice_state).toMatchObject({
      total: 2,
      done: 0,
      remaining: 2,
      current: '切片1：Agent idle 状态读取契约',
      current_unchecked_children: ['扩展 AgentAdapter 状态入口'],
    });
    expect(blockedState.next_node?.slice).toBe('切片1：Agent idle 状态读取契约');

    const advanced = setupCmd(baseTasks(true, [true, true, true]), ['SPEC_MERGED', 'SLICES_APPROVED']);
    writeLedgerRows(advanced.dir, ['pass']);
    const advancedState = (await nextJson(advanced.root)).modules[0];
    expect(advancedState.slice_state).toMatchObject({
      total: 2,
      done: 1,
      remaining: 1,
      current: '切片2：完成屏障消费 Agent idle 状态',
    });
    expect(advancedState.next_node?.slice).toBe('切片2：完成屏障消费 Agent idle 状态');
  });

  it('ST-S31-EX-1: initial 多模块默认不激活切片循环 → 不输出 slice_state、verify 不写账本', () => {
    const { root } = makeProposal('# 任务\n\n## [code] 代码实现\n- [ ] 切片1'); // makeProposal 不写 guard/launched
    writeFileSync(join(root, 'logos', 'logos-project.yaml'),
      'project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: initial\n  - id: auth\n    name: auth\n    lifecycle: initial\n');
    mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
    mkdirSync(join(root, 'logos', 'resources', 'verify'), { recursive: true });
    writeFileSync(join(root, 'logos', 'logos.config.json'),
      JSON.stringify({ name: 't', locale: 'zh', verify: { result_path: 'logos/resources/verify/test-results.jsonl' } }));
    const data = (() => { const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
      try { status('json'); } finally { cap.restore(); ex.mockRestore(); restore(); } return JSON.parse(cap.logs[0]).data; })();
    for (const m of data.modules) {
      expect(m.slice_state).toBeUndefined();
      expect(m.loop_state).toBeUndefined();
    }
    writeVerifyFixture(root, 'fail');
    runVerify(root);
    expect(existsSync(join(root, 'logos', 'resources', 'verify', 'LOOP_ITERS'))).toBe(false); // 多模块不归属 → 不写账本
  });

  it('ST-S31-EX-2: 配置类早退（NO_TEST_RESULTS）→ process.exit(1)、账本无新增行', () => {
    // 切片循环激活（launched 默认）但无 test-results → verify 早退、不计迭代、不写账本
    const { root, dir } = setupCmd(CODE3([true, true, true]), ['SPEC_MERGED']);
    writeVerifyFixture(root); // 有用例、无结果 → NO_TEST_RESULTS
    const r = runVerify(root);
    expect(r.exited).toBe(true);
    expect(r.errors.join('')).toContain('NO_TEST_RESULTS');
    expect(existsSync(join(dir, 'LOOP_ITERS'))).toBe(false); // 早退 → 不写账本
  });
});

describe('S31 — 空 [code] 退化边界（代码必需态不得进入 loop）', () => {
  it('UT-S31-19: 空 [code] 退化仅适用于 code_required=false', async () => {
    const docsOnly = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d', ['SPEC_MERGED', 'VERIFY_PASS']);
    writeLedgerRows(docsOnly.dir, ['pass']);
    const docsModule = (await nextJson(docsOnly.root)).modules[0];
    expect(docsModule.proposal_step).toBe('verify-passed');
    expect(docsModule.loop_state).toMatchObject({ converged: true });
    expect(docsModule.next_node?.id).not.toBe('plan-slices');

    const codeRequired = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d', ['SPEC_MERGED', 'VERIFY_PASS'], 'feat-code', codeRequiredProposal());
    writeTestDelta(codeRequired.dir, ['UT-S31-19']);
    writeLedgerRows(codeRequired.dir, ['pass']);
    const codeModule = (await nextJson(codeRequired.root)).modules[0];
    expect(codeModule.proposal_step).toBe('ready-to-implement');
    expect(codeModule.next_node?.id).toBe('plan-slices');
    expect(codeModule.next_node?.id).not.toBe('code');
    expect(codeModule.next_node?.id).not.toBe('verify');
    expect(codeModule.loop_state).toMatchObject({ converged: false });
  });

  it('UT-S31-20: 需要代码但切片缺失时不输出 verify repair 前沿', async () => {
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d', ['SPEC_MERGED', 'VERIFY_FAIL'], 'feat', codeRequiredProposal());
    writeTestDelta(dir, ['UT-S31-20']);
    writeLedgerRows(dir, ['fail']);

    expect(detectProposalStepViaFlow(dir)).toBe('ready-to-implement');
    expect(detectProposalStep(dir)).toBe('ready-to-implement');

    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-implement');
    expect(m.next_node?.id).toBe('plan-slices');
    expect(m.next_node?.id).not.toBe('verify');
    expect(m.next_node?.id).not.toBe('code');
    expect(m.command).not.toBe('openlogos verify');
  });

  it('ST-S31-08: 新增测试规格但未规划切片时不得按空 [code] 收敛', async () => {
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d', ['SPEC_MERGED'], 'feat', codeRequiredProposal());
    writeTestDelta(dir, ['UT-S31-19', 'UT-S31-20', 'ST-S31-08']);
    writeLedgerRows(dir, ['pass']);

    const m = (await nextJson(root)).modules[0];
    expect(m.proposal_step).toBe('ready-to-implement');
    expect(m.next_node?.id).toBe('plan-slices');
    expect(m.next_node?.id).not.toBe('verify');
    expect(m.next_node?.id).not.toBe('code');
    expect(m.loop_state).toMatchObject({ converged: false });
    expect(m.code_planning_diagnostic?.reason).toBe('tasks-code-section-missing');
  });
});

describe('S31 — slice-local done 与全量失败分离诊断', () => {
  it('UT-S31-21: slice-local done 不被全量 verify failed 否定', () => {
    const { root, dir } = setupCmd([
      '# 任务',
      '',
      '## [delta] 规格变更',
      '- [x] d',
      '',
      '## [code] 代码实现',
      '- [x] 切片：覆盖 UT-S31-21',
    ].join('\n'), ['SPEC_MERGED', 'SLICES_APPROVED']);
    mkdirSync(join(root, 'cli/src'), { recursive: true });
    mkdirSync(join(root, 'cli/test'), { recursive: true });
    writeFileSync(join(root, 'cli/src/s31.ts'), 'export const s31 = true;\n');
    writeFileSync(join(root, 'cli/test/s31.test.ts'), 'it("UT-S31-21",()=>{});\n');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S31-21","status":"pass"}',
      '{"id":"UT-S31-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    const diagnostic = deriveAutomationDiagnostic(root, {
      proposalDir: dir,
      requiredTestIds: ['UT-S31-21'],
      declaredArtifacts: ['cli/src/s31.ts', 'cli/test/s31.test.ts'],
      verifyGate: 'FAIL',
      failedTests: ['UT-S31-REG'],
    });

    expect(diagnostic).toMatchObject({
      reason: 'global-verify-failed',
      completion_state: 'slice_done_global_verify_failed',
    });
    expect(JSON.stringify(diagnostic)).not.toContain('claimed-done-but-unverified');
  });

  it('UT-S31-22: focused tests 缺失时才判切片未完成', () => {
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片：覆盖 UT-S31-22', ['SPEC_MERGED', 'SLICES_APPROVED']);
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), '{"id":"UT-OTHER","status":"pass"}\n');

    const diagnostic = deriveAutomationDiagnostic(root, {
      proposalDir: dir,
      requiredTestIds: ['UT-S31-22'],
    });

    expect(diagnostic).toMatchObject({
      reason: 'focused-tests-missing',
      completion_state: 'slice_incomplete',
    });
  });

  it('ST-S31-09: 全量失败驱动 repair，保留本片完成证据', async () => {
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [x] 切片：覆盖 ST-S31-09', ['SPEC_MERGED', 'SLICES_APPROVED']);
    mkdirSync(join(root, 'cli/src'), { recursive: true });
    writeFileSync(join(root, 'cli/src/s31-st.ts'), 'export const st = true;\n');
    writeLedgerRows(dir, ['fail']);
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"ST-S31-09","status":"pass"}',
      '{"id":"UT-S31-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    const data = await nextJsonAuto(root);

    expect(data.modules[0].automation_diagnostic).toMatchObject({
      reason: 'global-verify-failed',
      completion_state: 'slice_done_global_verify_failed',
      suggested_next_node: 'code',
    });
    expect(data.modules[0].automation_diagnostic.missing_artifacts).toEqual([]);
    expect(data.modules[0].next_node?.id).toBe('code');
  });

  it('UT-S31-23: ready-to-merge + stale failed 不派发 repair/code', async () => {
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d');
    writeStaleVerifyFailure(root, 'UT-S31-23');

    const data = await nextJsonAuto(root);

    expect(detectProposalStep(dir)).toBe('ready-to-merge');
    expect(data.proposal_step).toBe('ready-to-merge');
    expect(data.command).toBe('openlogos merge feat');
    expect(data.gate_id).toBe('spec-exit');
    expect(data.modules[0].automation_diagnostic).toBeUndefined();
    expect(data.modules[0].next_node).toBeUndefined();
  });

  it('UT-S31-24: ready-to-implement 缺切片 + stale failed 仍停 plan-slices', async () => {
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d', ['SPEC_MERGED'], 'feat', codeRequiredProposal());
    writeTestDelta(dir, ['UT-S31-24']);
    writeStaleVerifyFailure(root, 'UT-S31-24');

    const data = await nextJsonAuto(root);

    expect(data.proposal_step).toBe('ready-to-implement');
    expect(data.gate_id).toBeNull();
    expect(data.gate_auto_passed).toBe(false);
    expect(data.modules[0].next_node?.id).toBe('plan-slices');
    expect(data.modules[0].automation_diagnostic).toBeUndefined();
    expect(existsSync(join(dir, 'SLICES_APPROVED'))).toBe(false);
  });

  it('UT-S31-25 / ST-S31-10: verify-failed 前沿仍消费 global verify failed 为 repair/code', async () => {
    const { root, dir } = setupCmd('# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [x] 切片：覆盖 UT-S31-25 和 ST-S31-10', ['SPEC_MERGED', 'SLICES_APPROVED', 'VERIFY_FAIL']);
    writeLedgerRows(dir, ['fail']);
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S31-25","status":"pass"}',
      '{"id":"ST-S31-10","status":"pass"}',
      '{"id":"UT-S31-STALE-REG","status":"fail","error":"stale regression"}',
    ].join('\n') + '\n');

    const data = await nextJsonAuto(root);

    expect(data.proposal_step).toBe('verify-failed');
    expect(data.command).toBeNull();
    expect(data.modules[0].automation_diagnostic).toMatchObject({
      reason: 'global-verify-failed',
      completion_state: 'slice_done_global_verify_failed',
      suggested_next_node: 'code',
    });
    expect(data.modules[0].next_node?.id).toBe('code');
  });
});

describe('S31 — smoke 用例变更下的切片闭环', () => {
  it('UT-S31-SMOKE-01: [code] 切片描述必须携带新增 SMOKE ID 与 runner/reporter 闭环要求', () => {
    // split-slice-planner-stage：smoke 闭环要求已从 change-writer 迁到 slice-planner（merge 后唯一切片事实源）。
    // 按 skills/slice-planner/SKILL.md「Smoke 用例变更的强制闭环」段实际措辞断言。
    const slicePlanner = readFileSync(join(REPO_ROOT, 'skills/slice-planner/SKILL.md'), 'utf-8');
    expect(slicePlanner).toContain('SMOKE-*');
    expect(slicePlanner).toContain('runner');
    expect(slicePlanner).toContain('reporter');
    expect(slicePlanner).toContain('smoke-results.jsonl');
    expect(slicePlanner).toContain('[code]');
  });

  it('UT-S31-SMOKE-02: smoke 覆盖预检未过时切片不得勾选', () => {
    const { root } = makeProposal([
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [ ] 切片1：覆盖 SMOKE-NEW-04，必须实现 smoke runner/reporter/dispatcher',
    ].join('\n'));
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(join(proposalDir, 'deltas/test/smoke'), { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    writeFileSync(join(proposalDir, 'deltas/test/smoke/core-smoke-test-cases.md'), '| SMOKE-NEW-04 | temp |');

    const check = checkSmokeCoverage(root);
    const tasks = readFileSync(join(proposalDir, 'tasks.md'), 'utf-8');

    expect(check.result).toBe('FAIL');
    expect(check.diagnostics.map(d => d.code)).toContain('smoke_runner_missing');
    expect(tasks).toContain('- [ ] 切片1');
  });

  it('ST-S31-SMOKE-01: 含 smoke 用例的切片完整闭环后才进入下一片', () => {
    const { root, dir } = makeProposal([
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [ ] 切片1：覆盖 SMOKE-NEW-05，必须实现 smoke runner/reporter/dispatcher',
      '- [ ] 切片2：后续能力',
    ].join('\n'));
    mkdirSync(join(dir, 'deltas/test/smoke'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    writeFileSync(join(dir, 'deltas/test/smoke/core-smoke-test-cases.md'), '| SMOKE-NEW-05 | temp |');
    writeFileSync(join(root, 'scripts/smoke-new.sh'), '#!/usr/bin/env bash\n');
    writeFileSync(join(root, 'logos/resources/verify/smoke-results.jsonl'), '{"id":"SMOKE-NEW-05","status":"pass"}\n');

    const check = checkSmokeCoverage(root, {
      command: 'node scripts/run-smoke.js',
    });
    expect(check.result).toBe('PASS');

    writeFileSync(join(dir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 切片1：覆盖 SMOKE-NEW-05，必须实现 smoke runner/reporter/dispatcher',
      '- [ ] 切片2：后续能力',
    ].join('\n'));
    const state = deriveSliceState(dir);
    expect(state.current).toBe('切片2：后续能力');
  });
});
