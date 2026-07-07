/**
 * S24 next --auto 自动跳过可跳人类确认点（skip-gate）—— 切片 C。
 *
 * 用例 ID 与 logos/resources/test/core-S24-test-cases.md 严格对齐（UT-S24-01~17 / ST-S24-01~07 / ST-S24-EX-2.1）。
 * 核心不变量：默认 next（无 --auto）行为与未引入 --auto 时 1:1 一致，且忽略 GATE_AUTO_PASSED；
 * --auto 仅作用于现有 launched 停顿点；plan-exit auto 会额外写 PLAN_APPROVED 作为状态源。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { next } from '../src/commands/next.js';
import { status } from '../src/commands/status.js';
import { gateForProposalStep } from '../src/lib/flow-derive.js';
import { loadBuiltinFlow, findActivatedLoop } from '../src/lib/flow.js';
import { loopExhaustedGateId } from '../src/lib/flow-loop-derive.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** 已填提案（deploy/smoke 经 ## 部署影响 字段控制）。 */
function filled(deploy: '是' | '否' = '否', smoke: '是' | '否' = '否'): string {
  return [
    '# 变更提案：feat', '', '## 变更原因', '需要新能力。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01-feature-specs', '', '## 部署影响',
    `- 是否需要部署：${deploy}`, '- 部署原因：说明', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', `- 是否需要 smoke：${smoke}`, '',
    '## 变更概述', '概述。覆盖 UT-S24-23、UT-S24-24、ST-S24-10、ST-S24-EX-4e.2。',
  ].join('\n');
}

function codeRequiredProposal(): string {
  return filled()
    .replace('## 变更类型\n设计级', '## 变更类型\n代码级修复')
    .replace('## 变更概述\n概述。', '## 变更概述\n需要 CLI 状态派生代码、测试和 reporter 实现。');
}

const DELTA_DONE = '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta';
const DELTA_UNSTARTED = '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta'; // delta 未启动（无勾、无 delta 文件）→ ready-to-delta
const DELTA_DONE_CODE_TEMPLATE = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] [切片清单占位]';
// split-slice-planner-stage：merge 后 [code] 已脱模板（切片写出、未勾）但 slice-exit 未放行 → ready-to-implement
const DELTA_DONE_CODE_SLICES = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片1\n- [ ] 切片2';
const DEPLOY_EMPTY_TASKS = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [deploy] 部署\n';
const DEPLOY_DONE_TASKS = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [deploy] 部署\n- [x] 部署';

interface StepFixture { proposal: string; tasks: string; markers?: string[]; deploy?: boolean; smoke?: boolean; }
const FIXTURES: Record<string, StepFixture> = {
  'ready-to-delta': { proposal: filled(), tasks: DELTA_UNSTARTED },
  'ready-to-implement-missing-code': { proposal: codeRequiredProposal(), tasks: DELTA_DONE, markers: ['SPEC_MERGED'] },
  'ready-to-implement-template': { proposal: filled(), tasks: DELTA_DONE_CODE_TEMPLATE, markers: ['SPEC_MERGED'] },
  'ready-to-implement': { proposal: filled(), tasks: DELTA_DONE_CODE_SLICES, markers: ['SPEC_MERGED'] },
  'ready-to-merge': { proposal: filled(), tasks: DELTA_DONE },
  'ready-to-deploy': { proposal: filled('是', '否'), tasks: DEPLOY_EMPTY_TASKS, markers: ['VERIFY_PASS'], deploy: true },
  'ready-to-smoke': { proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'], deploy: true, smoke: true },
  // auto-execute-redline-steps：非门动作步骤 fixture（[code] 全勾 + SLICES_APPROVED → coding 完成）
  'ready-to-verify': { proposal: filled(), tasks: '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [x] 切片1', markers: ['SPEC_MERGED', 'SLICES_APPROVED'] },
  'verify-passed': { proposal: filled('否', '否'), tasks: '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [x] 切片1', markers: ['SPEC_MERGED', 'SLICES_APPROVED', 'VERIFY_PASS'] },
  'smoke-passed': { proposal: filled('是', '是'), tasks: '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [x] 切片1\n\n## [deploy] 部署\n- [x] 部署', markers: ['SPEC_MERGED', 'SLICES_APPROVED', 'VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS'], deploy: true, smoke: true },
};

interface Ctx { root: string; dir: string; auditPath: string; planPath: string; con: ReturnType<typeof captureConsole>; }

/** 建一个 launched 项目，活跃提案处于指定 proposal_step，并接管 cwd/console/exit。 */
function setup(step: keyof typeof FIXTURES, slug = 'feat'): Ctx {
  const fx = FIXTURES[step];
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      deployment_gates: { core: { deployment_required: Boolean(fx.deploy), smoke_required: Boolean(fx.smoke) } },
    }, { lineWidth: 0 }),
  );
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-06-20T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), fx.proposal);
  writeFileSync(join(dir, 'tasks.md'), fx.tasks);
  for (const mk of fx.markers ?? []) writeFileSync(join(dir, mk), '');
  // change-flow-redesign：builtin launched implement 默认激活切片循环（code_slices_green）。
  // VERIFY_PASS 态在真实流程中由 verify 同时写一行 pass 账本（空 [code] → 退化 tests_green 收敛）；
  // 合成 fixture 须补这行账本，否则 loop 未收敛会把 ready-to-deploy/smoke 回拉到 ready-to-verify。
  if ((fx.markers ?? []).includes('VERIFY_PASS')) {
    writeFileSync(join(dir, 'LOOP_ITERS'),
      JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module: 'core', timestamp: '2026-06-20T00:00:00.000Z' }) + '\n');
  }

  const restoreCwd = mockCwd(root);
  const con = captureConsole();
  const exitSpy = mockProcessExit();
  cleanups.push(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });
  return { root, dir, auditPath: join(dir, 'GATE_AUTO_PASSED'), planPath: join(dir, 'PLAN_APPROVED'), con };
}

function writeTestDelta(dir: string, ids: string[] = ['UT-S24-25', 'ST-S24-11']): void {
  mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
  writeFileSync(join(dir, 'deltas', 'test', 'core-S24-test-cases.md'), ids.map(id => `| ${id} | 新增回归 |`).join('\n'));
}

/** 解析最后一行 JSON envelope 的 data。 */
function jsonData(con: ReturnType<typeof captureConsole>): Record<string, unknown> {
  const last = con.logs[con.logs.length - 1];
  return JSON.parse(last).data;
}
function auditLines(p: string): string[] {
  return existsSync(p) ? readFileSync(p, 'utf-8').split('\n').filter(Boolean) : [];
}
function writeStaleVerifyFailure(ctx: Ctx, passId = 'UT-S24-stale-pass'): void {
  mkdirSync(join(ctx.root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(ctx.root, 'logos/resources/verify/test-results.jsonl'), [
    JSON.stringify({ id: passId, status: 'pass' }),
    JSON.stringify({ id: 'UT-S24-STALE-REG', status: 'fail', error: 'stale regression' }),
  ].join('\n') + '\n');
}

// ── 一、gate 助手 UT ──
describe('S24 gate 助手（gateForProposalStep）', () => {
  it('UT-S24-01: ready-to-merge → spec 出口 gate skippable:true', () => {
    // change-flow-redesign：propose→plan/spec/merge，ready-to-merge 归属 spec 出口
    expect(gateForProposalStep('ready-to-merge')).toEqual({ gate_id: 'spec-exit', skippable: true });
  });
  it('UT-S24-02: ready-to-deploy → deliver 入口 gate skippable:true', () => {
    // change-flow-redesign：deliver 入口门改 skippable:true（无人值守可放行，部署目标可能是测试环境）
    expect(gateForProposalStep('ready-to-deploy')).toEqual({ gate_id: 'deliver-entry', skippable: true });
  });
  it('UT-S24-13: ready-to-delta → plan 出口 gate skippable:true', () => {
    // change-flow-redesign 新增 plan 出口「批准方案」门
    expect(gateForProposalStep('ready-to-delta')).toEqual({ gate_id: 'plan-exit', skippable: true });
  });
  it('UT-S24-18: ready-to-implement → slice 出口 gate skippable:true', () => {
    // split-slice-planner-stage：merge 后 slice 子流程出口「批准切片划分」门
    expect(gateForProposalStep('ready-to-implement')).toEqual({ gate_id: 'slice-exit', skippable: true });
  });
  it('UT-S24-03: ready-to-smoke 无对应 gate（不在 --auto 范围）', () => {
    expect(gateForProposalStep('ready-to-smoke')).toBeNull();
  });
  it('UT-S24-14: 达上限退出门 loop-exhausted → skippable:false（默认，无 exhausted_gate 覆盖）', () => {
    // builtin launched implement loop 默认无 exhausted_gate 覆盖 → exhausted_skippable 省略（消费方按 false 处理）。
    // gate_id 由 loopExhaustedGateId(subflow_id) 派生；默认达上限门固定不可跳（skippable:false）。
    const flow = loadBuiltinFlow('launched');
    const act = findActivatedLoop(flow);
    expect(act).not.toBeNull();
    const gateId = loopExhaustedGateId(act!.subflow_id);
    const egSkippable = flow.subflows.find(s => s.id === act!.subflow_id)?.loop?.exhausted_gate?.skippable ?? false;
    expect({ gate_id: gateId, skippable: egSkippable }).toEqual({ gate_id: 'gate:implement:loop-exhausted', skippable: false });
  });
});

// ── 二、next --auto 行为 UT ──
describe('S24 next --auto 行为', () => {
  it('UT-S24-04: ready-to-merge + --auto 放行并输出 merge 下一步建议', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_auto_passed).toBe(true);
    expect(d.command).toBe('openlogos merge feat');
  });

  it('UT-S24-05: ready-to-merge + --auto 追加 GATE_AUTO_PASSED 一行', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    expect(auditLines(ctx.auditPath)).toHaveLength(1);
  });

  it('UT-S24-06: ready-to-deploy + --auto 放行 deliver 入口门并写审计', () => {
    // change-flow-redesign：deliver-entry 改 skippable:true → --auto 放行并追加审计
    const ctx = setup('ready-to-deploy');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_id).toBe('deliver-entry');
    expect(d.skippable).toBe(true);
    expect(d.gate_auto_passed).toBe(true);
    expect(auditLines(ctx.auditPath)).toHaveLength(1);
  });

  it('UT-S24-07: 重复 plan-exit --auto 不重复追加审计', () => {
    const ctx = setup('ready-to-delta');
    next('json', undefined, true);
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('delta-writing');
    expect(d.modules).toEqual(expect.any(Array));
    expect((d.modules as any[])[0].next_node?.id).toBe('write-delta');
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'plan-exit')).toHaveLength(1);
  });

  it('UT-S24-08: 默认 next 忽略 GATE_AUTO_PASSED 不越过 gate', () => {
    const ctx = setup('ready-to-merge');
    // 预置审计文件后，默认 next 仍应停在 ready-to-merge，且不含 auto 字段
    writeFileSync(ctx.auditPath,
      JSON.stringify({ gate_id: 'spec-exit', proposal_step: 'ready-to-merge', timestamp: '2026-06-20T00:00:00.000Z' }) + '\n');
    next('json', undefined, false);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('ready-to-merge');
    expect(d.auto).toBeUndefined();
    expect(d.gate_id).toBeUndefined();
    expect(d.gate_auto_passed).toBeUndefined();
  });

  it('UT-S24-09: PLAN_APPROVED 是 plan gate 状态源', () => {
    const ctx = setup('ready-to-delta');
    writeFileSync(ctx.planPath, '');
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('delta-writing');
    expect((d.modules as any[])[0].next_node?.id).toBe('write-delta');
    ctx.con.logs.length = 0;
    status('json');
    expect(jsonData(ctx.con).proposal_step).toBe('delta-writing');
    expect(auditLines(ctx.auditPath)).toHaveLength(0);
  });

  it('UT-S24-10: GATE_AUTO_PASSED 每行 schema 含 gate_id/proposal_step/timestamp', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    const rec = JSON.parse(auditLines(ctx.auditPath)[0]);
    expect(Object.keys(rec).sort()).toEqual(['gate_id', 'proposal_step', 'timestamp']);
    expect(rec.gate_id).toBe('spec-exit');
    expect(rec.proposal_step).toBe('ready-to-merge');
    expect(typeof rec.timestamp).toBe('string');
  });

  it('UT-S24-11: ready-to-smoke + --auto 输出 auto_execute + command=openlogos smoke（非门动作步骤，不经 gate、不写审计）', () => {
    const ctx = setup('ready-to-smoke');
    next('json', undefined, true);
    const autoData = jsonData(ctx.con);
    // 无 flow gate（不经 gate_id），不写审计
    expect(autoData.gate_id).toBeNull();
    expect(autoData.gate_auto_passed).toBe(false);
    expect(existsSync(ctx.auditPath)).toBe(false);
    // auto-execute-redline-steps：新增 auto_execute 信号 + 具体命令
    expect(autoData.auto_execute).toBe(true);
    expect(autoData.command).toBe('openlogos smoke');
    // 默认 next（无 --auto）不置 auto_execute、行为不变
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    const def = jsonData(ctx.con);
    expect(def.auto_execute).toBeUndefined();
    expect(autoData.proposal_step).toBe(def.proposal_step);
  });

  it('UT-S24-12: --auto 的 JSON 附带 gate 字段；默认 next 不附带且 data 1:1', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    const autoData = jsonData(ctx.con);
    expect(autoData).toMatchObject({ auto: true, gate_id: 'spec-exit', skippable: true, gate_auto_passed: true });

    ctx.con.logs.length = 0;
    next('json', undefined, false);
    const def = jsonData(ctx.con);
    for (const k of ['auto', 'gate_id', 'skippable', 'gate_auto_passed']) expect(def[k]).toBeUndefined();
    expect(def.proposal_step).toBe('ready-to-merge');
  });

  it('UT-S24-28: next --auto 遇到 global verify failed 不 hard block，指向 repair/code', () => {
    const ctx = setup('ready-to-verify');
    writeFileSync(join(ctx.dir, 'LOOP_ITERS'),
      JSON.stringify({ iter: 1, node: 'verify', result: 'fail', module: 'core', timestamp: 't', slice: '切片1' }) + '\n');
    mkdirSync(join(ctx.root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(ctx.root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S24-28","status":"pass"}',
      '{"id":"UT-S24-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    next('json', undefined, true);
    const d = jsonData(ctx.con);

    expect(d.auto).toBe(true);
    expect(d.gate_auto_passed).toBe(false);
    expect(d.modules[0].automation_diagnostic).toMatchObject({
      reason: 'global-verify-failed',
      completion_state: 'slice_done_global_verify_failed',
      suggested_next_node: 'code',
      human_action_required: false,
    });
    expect(d.modules[0].next_node?.id).toBe('code');
    expect(JSON.stringify(d)).not.toContain('retry-exhausted');
  });

  it('UT-S24-29: 可恢复失败不写无关 gate 审计或 verify 通过 marker', () => {
    const ctx = setup('ready-to-verify');
    writeFileSync(join(ctx.dir, 'LOOP_ITERS'),
      JSON.stringify({ iter: 1, node: 'verify', result: 'fail', module: 'core', timestamp: 't' }) + '\n');
    mkdirSync(join(ctx.root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(ctx.root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S24-29","status":"pass"}',
      '{"id":"UT-S24-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    next('json', undefined, true);
    const d = jsonData(ctx.con);

    expect(d.modules[0].automation_diagnostic.reason).toBe('global-verify-failed');
    expect(d.gate_auto_passed).toBe(false);
    expect(existsSync(ctx.auditPath)).toBe(false);
    expect(existsSync(join(ctx.dir, 'VERIFY_PASS'))).toBe(false);
  });

  it('UT-S24-15: ready-to-delta + --auto 消费 plan gate 并进入 write-delta', () => {
    const ctx = setup('ready-to-delta');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_id).toBe('plan-exit');
    expect(d.skippable).toBe(true);
    expect(d.gate_auto_passed).toBe(true);
    const lines = auditLines(ctx.auditPath);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ gate_id: 'plan-exit', proposal_step: 'ready-to-delta' });
    expect(existsSync(ctx.planPath)).toBe(true);
    expect(d.proposal_step).toBe('delta-writing');
    expect((d.modules as any[])[0].proposal_step).toBe('delta-writing');
    expect((d.modules as any[])[0].next_node?.id).toBe('write-delta');
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    expect(jsonData(ctx.con).proposal_step).toBe('delta-writing');
  });

  it('UT-S09-64 / UT-S24-30 / UT-S24-31 / UT-S24-32: plan-exit auto 响应继续派发 write-delta，tasks 0/N 不阻断', () => {
    const ctx = setup('ready-to-delta');

    next('json', undefined, true);
    const d = jsonData(ctx.con);

    expect(d.gate_id).toBe('plan-exit');
    expect(d.gate_auto_passed).toBe(true);
    expect(d.proposal_step).toBe('delta-writing');
    expect((d.modules as any[])[0].proposal_step).toBe('delta-writing');
    expect((d.modules as any[])[0].next_node?.id).toBe('write-delta');
    expect((d.modules as any[])[0].plan_state).toMatchObject({
      plan_gate_pending: false,
      plan_approved: true,
      tasks_execution_done: 0,
      tasks_execution_total: 1,
      tasks_execution_scope: 'delta',
    });
    expect(JSON.stringify(d)).not.toMatch(/planning failed|blocked|retry-exhausted/i);
  });

  it('UT-S24-33: 已有 PLAN_APPROVED 时重复 auto 不追加 plan 审计且保持 write-delta 前沿', () => {
    const ctx = setup('ready-to-delta');
    writeFileSync(ctx.planPath, '');
    writeFileSync(ctx.auditPath,
      JSON.stringify({ gate_id: 'plan-exit', proposal_step: 'ready-to-delta', timestamp: '2000-01-01T00:00:00.000Z' }) + '\n');

    next('json', undefined, true);
    const d = jsonData(ctx.con);

    expect(d.proposal_step).toBe('delta-writing');
    expect((d.modules as any[])[0].next_node?.id).toBe('write-delta');
    expect(d.gate_auto_passed).toBe(false);
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'plan-exit')).toHaveLength(1);
  });

  it('UT-S24-34 / ST-S24-15: ready-to-merge + stale verify failed + --auto 保留 merge command', () => {
    const ctx = setup('ready-to-merge');
    writeStaleVerifyFailure(ctx, 'UT-S24-34');

    next('json', undefined, true);
    const d = jsonData(ctx.con);

    expect(d.proposal_step).toBe('ready-to-merge');
    expect(d.command).toBe('openlogos merge feat');
    expect(d.gate_id).toBe('spec-exit');
    expect(d.gate_auto_passed).toBe(true);
    expect(d.automation_diagnostic).toBeUndefined();
    expect((d.modules as any[])[0].automation_diagnostic).toBeUndefined();
    expect((d.modules as any[])[0].next_node).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain('global-verify-failed');
    expect(JSON.stringify(d)).not.toContain('suggested_next_node');
  });

  it('UT-S24-35: ready-to-merge 的模块级 command 不被 stale diagnostic 清空', () => {
    const ctx = setup('ready-to-merge');
    writeStaleVerifyFailure(ctx, 'UT-S24-35');

    next('json', undefined, true);
    const d = jsonData(ctx.con);

    expect((d.modules as any[])[0].command).toBe('openlogos merge feat');
    expect((d.modules as any[])[0].action).not.toMatch(/repair|code/i);
  });

  it('UT-S24-36: ready-to-merge + stale diagnostic 不写 SLICES_APPROVED、不消费 slice-exit', () => {
    const ctx = setup('ready-to-merge');
    writeStaleVerifyFailure(ctx, 'UT-S24-36');

    next('json', undefined, true);

    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(false);
    expect(auditLines(ctx.auditPath).map(line => JSON.parse(line).gate_id)).toEqual(['spec-exit']);
  });

  it('UT-S24-16: ready-to-deploy + --auto 放行部署门，gate_auto_passed 来自本次响应而非历史审计行', () => {
    const ctx = setup('ready-to-deploy');
    // 预置一条历史审计行（伪造），证明放行依据是本次派生而非读历史文件
    writeFileSync(ctx.auditPath,
      JSON.stringify({ gate_id: 'deliver-entry', proposal_step: 'ready-to-deploy', timestamp: '2000-01-01T00:00:00.000Z' }) + '\n');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_id).toBe('deliver-entry');
    expect(d.skippable).toBe(true);
    expect(d.gate_auto_passed).toBe(true);
    // 本次放行真实追加一行（历史 1 行 + 本次 1 行 = 2 行），证明 gate_auto_passed 由本次响应产生
    expect(auditLines(ctx.auditPath)).toHaveLength(2);
    expect(JSON.parse(auditLines(ctx.auditPath)[1])).toMatchObject({ gate_id: 'deliver-entry', proposal_step: 'ready-to-deploy' });
  });

  it('UT-S24-17: 审计存在但 PLAN_APPROVED 缺失时 status 不前移', () => {
    const ctx = setup('ready-to-delta');
    writeFileSync(ctx.auditPath,
      JSON.stringify({ gate_id: 'plan-exit', proposal_step: 'ready-to-delta', timestamp: '2000-01-01T00:00:00.000Z' }) + '\n');
    status('json');
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('ready-to-delta');
    expect(existsSync(ctx.planPath)).toBe(false);
  });

  it('UT-S24-19: ready-to-implement + --auto 消费 slice gate 并派生 coding', () => {
    // split-slice-planner-stage：slice-exit 被 --auto 放行 → 写 SLICES_APPROVED + 审计，响应续推 coding / next_node=code
    const ctx = setup('ready-to-implement');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_id).toBe('slice-exit');
    expect(d.skippable).toBe(true);
    expect(d.gate_auto_passed).toBe(true);
    const lines = auditLines(ctx.auditPath);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ gate_id: 'slice-exit', proposal_step: 'ready-to-implement' });
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(true);
    expect(d.proposal_step).toBe('coding');
    expect((d.modules as any[])[0].proposal_step).toBe('coding');
    expect((d.modules as any[])[0].next_node?.id).toBe('code');
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    expect(jsonData(ctx.con).proposal_step).toBe('coding');
  });

  it('UT-S24-20: 重复 slice-exit --auto 不重复追加审计', () => {
    const ctx = setup('ready-to-implement');
    next('json', undefined, true);
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('coding');
    expect((d.modules as any[])[0].next_node?.id).toBe('code');
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'slice-exit')).toHaveLength(1);
  });

  it('UT-S24-21: SLICES_APPROVED 是 slice gate 状态源', () => {
    const ctx = setup('ready-to-implement');
    writeFileSync(join(ctx.dir, 'SLICES_APPROVED'), '');
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('coding');
    expect((d.modules as any[])[0].next_node?.id).toBe('code');
    ctx.con.logs.length = 0;
    status('json');
    expect(jsonData(ctx.con).proposal_step).toBe('coding');
    expect(auditLines(ctx.auditPath)).toHaveLength(0);
  });

  it('UT-S24-22: 审计存在但 SLICES_APPROVED 缺失时 status 不前移', () => {
    const ctx = setup('ready-to-implement');
    writeFileSync(ctx.auditPath,
      JSON.stringify({ gate_id: 'slice-exit', proposal_step: 'ready-to-implement', timestamp: '2000-01-01T00:00:00.000Z' }) + '\n');
    status('json');
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('ready-to-implement');
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(false);
  });

  it('UT-S24-23: ready-to-implement 但 [code] 未脱模板时 --auto 不放行 slice-exit', () => {
    const ctx = setup('ready-to-implement-template');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('ready-to-implement');
    expect(d.gate_id).not.toBe('slice-exit');
    expect(d.gate_auto_passed).toBe(false);
    expect((d.modules as any[])[0].next_node?.id).toBe('plan-slices');
    expect((d.modules as any[])[0].next_node?.gate_id).toBeUndefined();
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(false);
    expect(auditLines(ctx.auditPath)).toHaveLength(0);
  });

  it('UT-S24-24: ready-to-implement 已脱模板时 --auto 才消费 slice-exit', () => {
    const ctx = setup('ready-to-implement');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_id).toBe('slice-exit');
    expect(d.gate_auto_passed).toBe(true);
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(true);
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'slice-exit')).toHaveLength(1);
    expect(d.proposal_step).toBe('coding');
  });

  it('UT-S24-25: 代码必需但缺失 [code] 时 ready-to-implement 不等于 slice-exit 到达', () => {
    const ctx = setup('ready-to-implement-missing-code');
    writeTestDelta(ctx.dir, ['UT-S24-25']);
    next('json', undefined, true);
    const d = jsonData(ctx.con);

    expect(d.proposal_step).toBe('ready-to-implement');
    expect(d.gate_id).not.toBe('slice-exit');
    expect(d.gate_auto_passed).toBe(false);
    expect((d.modules as any[])[0].next_node?.id).toBe('plan-slices');
    expect((d.modules as any[])[0].next_node?.gate_id).toBeUndefined();
  });

  it('UT-S24-26: 缺失 [code] 时不写 slice 审计与 marker', () => {
    const ctx = setup('ready-to-implement-missing-code');
    writeTestDelta(ctx.dir, ['UT-S24-26']);
    next('json', undefined, true);

    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(false);
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'slice-exit')).toHaveLength(0);
  });

  it('UT-S24-27: 缺失 [code] 与已脱模板 [code] 的 auto 行为区分', () => {
    const ctx = setup('ready-to-implement-missing-code');
    writeTestDelta(ctx.dir, ['UT-S24-27']);
    next('json', undefined, true);
    const a = jsonData(ctx.con);
    expect(a.proposal_step).toBe('ready-to-implement');
    expect((a.modules as any[])[0].next_node?.id).toBe('plan-slices');
    expect(a.gate_auto_passed).toBe(false);
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(false);

    writeFileSync(join(ctx.dir, 'tasks.md'), DELTA_DONE_CODE_SLICES);
    ctx.con.logs.length = 0;
    next('json', undefined, true);
    const b = jsonData(ctx.con);
    expect(b.gate_id).toBe('slice-exit');
    expect(b.gate_auto_passed).toBe(true);
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(true);
    expect((b.modules as any[])[0].next_node?.id).toBe('code');
  });
});

// ── 六、auto_execute 非门动作步骤（auto-execute-redline-steps）──
describe('S24 auto_execute 非门动作步骤', () => {
  it('UT-S24-AE-01: verify-passed + --auto → auto_execute:true + command=openlogos archive', () => {
    const ctx = setup('verify-passed');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('verify-passed');
    expect(d.auto_execute).toBe(true);
    expect(d.command).toBe('openlogos archive feat');
    expect(String(d.action)).toContain('auto');
  });

  it('UT-S24-AE-02: ready-to-verify + --auto → auto_execute:true + command=openlogos verify', () => {
    const ctx = setup('ready-to-verify');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('ready-to-verify');
    expect(d.auto_execute).toBe(true);
    expect(d.command).toBe('openlogos verify');
  });

  it('UT-S24-AE-03: 默认 next（无 --auto）不输出 auto_execute', () => {
    const ctx = setup('verify-passed');
    next('json', undefined, false);
    const d = jsonData(ctx.con);
    expect(d.auto_execute).toBeUndefined();
  });

  it('UT-S24-AE-04: loop-exhausted + --auto 不置 auto_execute（硬红线回归）', () => {
    // 达上限未收敛：verify 账本两行 fail（max_iters 默认 → escalated），proposal_step 处于 verify 前沿
    const ctx = setup('ready-to-verify');
    writeFileSync(join(ctx.dir, 'LOOP_ITERS'),
      [1, 2, 3].map(i => JSON.stringify({ iter: i, node: 'verify', result: 'fail', module: 'core', timestamp: '2026-06-20T00:00:00.000Z' })).join('\n') + '\n');
    writeFileSync(join(ctx.dir, 'VERIFY_FAIL'), '');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.auto_execute).toBeUndefined();
  });

  it('UT-S24-AE-05: smoke-passed + --auto → auto_execute:true + command=openlogos archive', () => {
    const ctx = setup('smoke-passed');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('smoke-passed');
    expect(d.auto_execute).toBe(true);
    expect(d.command).toBe('openlogos archive feat');
  });

  it('ST-S24-AE-01: 全自动 verify 通过后 next --auto 直接给出可执行归档信号', () => {
    const ctx = setup('verify-passed');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.auto_execute).toBe(true);
    expect(d.command).toBe('openlogos archive feat');
  });
});

// ── 三、场景测试 ──
describe('S24 场景测试', () => {
  it('ST-S24-01: ready-to-merge 在 --auto 下放行并留痕', () => {
    const ctx = setup('ready-to-merge');
    next('text', undefined, true);
    const out = ctx.con.logs.join('\n');
    expect(out).toContain('spec-exit');
    expect(auditLines(ctx.auditPath)).toHaveLength(1);
  });

  it('ST-S24-02: ready-to-deploy 在 --auto 下放行 deliver 入口门并留痕', () => {
    // change-flow-redesign：deliver-entry skippable:true → --auto 放行（部署目标可能是测试环境而非生产）
    const ctx = setup('ready-to-deploy');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_id).toBe('deliver-entry');
    expect(d.gate_auto_passed).toBe(true);
    expect(auditLines(ctx.auditPath)).toHaveLength(1);
  });

  it('ST-S24-07: deliver 入口门在 --auto 下放行（部署可全自动），放行依据为本次 gate_auto_passed', () => {
    // Step 1→5a：活跃提案 ready-to-deploy，deliver-entry skippable:true → --auto 放行部署下一步 + 追加审计。
    const ctx = setup('ready-to-deploy');
    next('text', undefined, true);
    const out = ctx.con.logs.join('\n');
    expect(out).toContain('deliver-entry');
    expect(auditLines(ctx.auditPath)).toHaveLength(1);
    // 放行依据为本次响应（gate_auto_passed=true），JSON 形态复核
    ctx.con.logs.length = 0;
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_auto_passed).toBe(true);
    expect(d.gate_id).toBe('deliver-entry');
  });

  it('ST-S24-08: slice-exit 在 --auto 下放行并派生 coding', () => {
    // split-slice-planner-stage：活跃提案 ready-to-implement，--auto 写 SLICES_APPROVED + 审计 → 派生 coding/next_node=code
    // 注：与 plan-exit 一致，消费后文本/JSON 顶层动作已续推为 coding（不再回显 gate_id 文案），故经 JSON gate 字段核验放行。
    const ctx = setup('ready-to-implement');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.gate_id).toBe('slice-exit');
    expect(d.gate_auto_passed).toBe(true);
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(true);
    expect(auditLines(ctx.auditPath)).toHaveLength(1);
    expect(d.proposal_step).toBe('coding');
    expect((d.modules as any[])[0].next_node?.id).toBe('code');
    // 默认 next 复核：派生 coding 稳定
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    expect(jsonData(ctx.con).proposal_step).toBe('coding');
  });

  it('ST-S24-09: 重复 slice-exit --auto 不刷审计且状态前移', () => {
    const ctx = setup('ready-to-implement');
    next('json', undefined, true);
    next('json', undefined, true);
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('coding');
    expect((d.modules as any[])[0].next_node?.id).toBe('code');
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(true);
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'slice-exit')).toHaveLength(1);
    ctx.con.logs.length = 0;
    status('json');
    expect(jsonData(ctx.con).proposal_step).toBe('coding');
  });

  it('ST-S24-10: slice-exit 只在 plan-slices 完成后可被 auto 放行', () => {
    const ctx = setup('ready-to-implement-template');
    next('json', undefined, true);
    const first = jsonData(ctx.con);
    expect(first.proposal_step).toBe('ready-to-implement');
    expect((first.modules as any[])[0].next_node?.id).toBe('plan-slices');
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(false);
    expect(auditLines(ctx.auditPath)).toHaveLength(0);

    writeFileSync(join(ctx.dir, 'tasks.md'), DELTA_DONE_CODE_SLICES);
    ctx.con.logs.length = 0;
    next('json', undefined, true);
    const second = jsonData(ctx.con);
    expect(second.gate_id).toBe('slice-exit');
    expect(second.gate_auto_passed).toBe(true);
    expect(second.proposal_step).toBe('coding');
    expect((second.modules as any[])[0].next_node?.id).toBe('code');
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(true);
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'slice-exit')).toHaveLength(1);
  });

  it('ST-S24-11: 全自动模式下缺失 [code] 不得空过切片门', () => {
    const ctx = setup('ready-to-implement-missing-code');
    writeTestDelta(ctx.dir, ['UT-S24-25', 'UT-S24-26', 'ST-S24-11']);

    next('json', undefined, true);
    const first = jsonData(ctx.con);
    expect(first.proposal_step).toBe('ready-to-implement');
    expect((first.modules as any[])[0].next_node?.id).toBe('plan-slices');
    expect(first.gate_id).not.toBe('slice-exit');
    expect(first.gate_auto_passed).toBe(false);
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(false);
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'slice-exit')).toHaveLength(0);

    ctx.con.logs.length = 0;
    next('json', undefined, true);
    const second = jsonData(ctx.con);
    expect(second.proposal_step).toBe('ready-to-implement');
    expect((second.modules as any[])[0].next_node?.id).toBe('plan-slices');
    expect(second.gate_auto_passed).toBe(false);
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(false);
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'slice-exit')).toHaveLength(0);

    writeFileSync(join(ctx.dir, 'tasks.md'), DELTA_DONE_CODE_SLICES);
    ctx.con.logs.length = 0;
    next('json', undefined, true);
    const third = jsonData(ctx.con);
    expect(third.gate_id).toBe('slice-exit');
    expect(third.gate_auto_passed).toBe(true);
    expect(third.proposal_step).toBe('coding');
    expect((third.modules as any[])[0].next_node?.id).toBe('code');
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(true);
  });

  it('ST-S24-12: 无人值守全量红进入 repair 而非 retry exhausted', () => {
    const ctx = setup('ready-to-verify');
    writeFileSync(join(ctx.dir, 'LOOP_ITERS'),
      JSON.stringify({ iter: 2, node: 'verify', result: 'fail', module: 'core', timestamp: 't', slice: '切片1' }) + '\n');
    mkdirSync(join(ctx.root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(ctx.root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"ST-S24-12","status":"pass"}',
      '{"id":"UT-S24-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    next('json', undefined, true);
    const d = jsonData(ctx.con);

    expect((d.modules as any[])[0].automation_diagnostic).toMatchObject({
      reason: 'global-verify-failed',
      completion_state: 'slice_done_global_verify_failed',
    });
    expect((d.modules as any[])[0].next_node?.id).toBe('code');
    expect((d.modules as any[])[0].automation_diagnostic.failed_tests).toContain('UT-S24-REG');
    expect(d.gate_auto_passed).toBe(false);
    expect(JSON.stringify(d)).not.toContain('retry-exhausted');
  });

  it('ST-S24-EX-4e.2: 未到 slice-exit 门时误用 --auto 不写状态且保持 plan-slices', () => {
    const ctx = setup('ready-to-implement-template');
    next('json', undefined, true);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('ready-to-implement');
    expect(d.gate_auto_passed).toBe(false);
    expect((d.modules as any[])[0].next_node?.id).toBe('plan-slices');
    expect(existsSync(join(ctx.dir, 'SLICES_APPROVED'))).toBe(false);
    expect(auditLines(ctx.auditPath)).toHaveLength(0);
  });

  it('ST-S24-03: 默认 next 忽略 GATE_AUTO_PASSED 不越过 gate', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true); // 先放行留下审计
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    expect(jsonData(ctx.con).proposal_step).toBe('ready-to-merge');
  });

  it('ST-S24-04: 重复 plan-exit --auto 不刷审计且状态前移', () => {
    const ctx = setup('ready-to-delta');
    next('json', undefined, true);
    next('json', undefined, true);
    ctx.con.logs.length = 0;
    next('json', undefined, false);
    const d = jsonData(ctx.con);
    expect(d.proposal_step).toBe('delta-writing');
    expect((d.modules as any[])[0].next_node?.id).toBe('write-delta');
    expect(existsSync(ctx.planPath)).toBe(true);
    expect(auditLines(ctx.auditPath).filter(line => JSON.parse(line).gate_id === 'plan-exit')).toHaveLength(1);
  });

  it('ST-S09-32 / ST-S24-13: 全自动 plan gate 到 delta-writing 后产生 write-delta dispatch 信号', () => {
    const ctx = setup('ready-to-delta');

    next('json', undefined, true);
    const d = jsonData(ctx.con);

    expect(d.gate_auto_passed).toBe(true);
    expect(d.proposal_step).toBe('delta-writing');
    expect((d.modules as any[])[0].next_node?.id).toBe('write-delta');
    expect(existsSync(ctx.planPath)).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/blocked|no-progress|retry-exhausted/i);
  });

  it('ST-S24-14: 半自动 ready-to-delta 仍停人工确认，不写 PLAN_APPROVED', () => {
    const ctx = setup('ready-to-delta');

    next('json', undefined, false);
    const d = jsonData(ctx.con);

    expect(d.proposal_step).toBe('ready-to-delta');
    expect(String(d.action)).toMatch(/批准方案|Approve/i);
    expect(d.gate_auto_passed).toBeUndefined();
    expect(existsSync(ctx.planPath)).toBe(false);
    expect(auditLines(ctx.auditPath)).toHaveLength(0);
  });

  it('ST-S24-05: 默认 next JSON 零漂移（不含任何 --auto gate 字段）', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, false);
    const d = jsonData(ctx.con);
    expect('auto' in d).toBe(false);
    expect('gate_id' in d).toBe(false);
    expect('skippable' in d).toBe(false);
    expect('gate_auto_passed' in d).toBe(false);
  });

  it('ST-S24-06: 审计 JSONL 内容可被消费（合法 JSON + 三字段）', () => {
    const ctx = setup('ready-to-merge');
    next('json', undefined, true);
    for (const line of auditLines(ctx.auditPath)) {
      const rec = JSON.parse(line);
      expect(rec.gate_id).toBe('spec-exit');
      expect(rec.proposal_step).toBe('ready-to-merge');
      expect(rec.timestamp).toBeTruthy();
    }
  });
});

// ── 四、异常 ──
describe('S24 异常', () => {
  it('ST-S24-EX-2.1: 未初始化项目 next --auto 沿用既有错误语义，不写审计', async () => {
    const { root, cleanup } = makeTempRoot();
    const restoreCwd = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    cleanups.push(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });
    await expect(next('json', undefined, true)).rejects.toThrow('process.exit(1)');
    expect(existsSync(join(root, 'logos', 'changes', 'feat', 'GATE_AUTO_PASSED'))).toBe(false);
  });
});
