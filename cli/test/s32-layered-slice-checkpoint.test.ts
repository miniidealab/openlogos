/**
 * layered-verification 切片 3：分层开启时切片 checkpoint 的执行集合。
 * 用例 ID 与 logos/resources/test/core-S32-test-cases.md「S32 分层开启时的切片 checkpoint 测试」严格对齐：UT-S32-118～125。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 夹具 LS：S13 夹具 LV 的切片变体——已合并测试规格 core-S01（UT-S01-01～03）、core-S02（UT-S02-01、02）、
 * core-S03（UT-S03-01、02，主链路 UT-S03-01）、core-S04、core-S90（本提案新增 UT-S90-01～03）。活跃提案有有效的切片清单：
 * slice-a 拥有 UT-S90-01、02，slice-b 拥有 UT-S90-03；当前尝试 slice-a。提案声明 scenarios: [S02]；delta 触及 S90。
 * 提案集合 P = S02 的 2 条 ∪ S90 的 3 条 ∪ {UT-S03-01}。记录型入口同 LV，调用记录在项目外。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { planSlices } from '../src/commands/slice.js';
import { createLv, declarationYaml, destroyLv, mainPathSection, runVerify, table } from './golden/s13-layered-fixture.mjs';

vi.setConfig({ testTimeout: 180_000 });

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'index.js');
const OWNED_A = ['UT-S90-01', 'UT-S90-02'];
const ELIGIBLE = ['UT-S02-01', 'UT-S02-02', 'UT-S03-01', ...OWNED_A];
const TOTAL = [...ELIGIBLE, 'UT-S90-03'].sort();
const BASELINE_ALL = ['UT-S01-01', 'UT-S01-02', 'UT-S01-03', 'UT-S02-01', 'UT-S02-02', 'UT-S03-01', 'UT-S03-02', 'UT-S04-02'];
const S03_TWO_MAIN = { 'core-S03-test-cases.md': table(['UT-S03-01', 'UT-S03-02']) + mainPathSection(['UT-S03-01', 'UT-S03-02']) };

type Lv = ReturnType<typeof createLv>;
const made: Lv[] = [];
afterEach(() => { while (made.length) destroyLv(made.pop()!); });

function sliceTasks(a: string[], b: string[]): string {
  return [
    '# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '', '## [code] 代码实现',
    `- [ ] 切片1：能力 a（覆盖 ${a.join('、')}）`, `- [ ] 切片2：能力 b（覆盖 ${b.join('、')}）`, '',
  ].join('\n');
}

/** 建夹具并经 `slice plan` 的同一入口写出切片清单（verify_scope 由配置冻结进清单）。 */
function ls(sliceScope: 'baseline' | 'owned', opts: Record<string, any> = {}): Lv {
  const mod = opts.mod === true;
  const target = mod ? 'backend-S05-test-cases.md' : 'core-S90-test-cases.md';
  const a = mod ? ['UT-S05-03'] : OWNED_A;
  const b = mod ? ['UT-S05-04'] : ['UT-S90-03'];
  const f = createLv({
    buildTestChangeSet,
    change: { target, added: [...a, ...b] },
    tasks: sliceTasks(a, b),
    // 多模块夹具的提案登记在 backend（夹具缺省）；`slice plan` 按提案的模块写清单（§2.110）
    ...opts,
    verify: { slice_scope: sliceScope, ...(opts.verify ?? {}) },
  });
  made.push(f);
  writeFileSync(join(f.proposalDir!, 'SLICES_APPROVED'), '');
  const specTarget = `logos/resources/test/${target}`;
  const slicesFile = join(f.proposalDir!, 'slices.json');
  writeFileSync(slicesFile, JSON.stringify({ slices: [
    { slice_id: 'slice-a', task_text: `切片1：能力 a（覆盖 ${a.join('、')}）`, owned_test_ids: a, runner_selectors: a, spec_targets: [specTarget] },
    { slice_id: 'slice-b', task_text: `切片2：能力 b（覆盖 ${b.join('、')}）`, owned_test_ids: b, runner_selectors: b, spec_targets: [specTarget] },
  ] }, null, 2));
  planSlices(f.root, slicesFile);
  return f;
}
const verify = (f: Lv) => runVerify(CLI, f);
const checkpoints = (f: Lv): any[] => {
  const path = join(f.proposalDir!, 'SLICE_CHECKPOINTS.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
};
const warningCodes = (data: any): string[] => (data.warnings ?? []).map((w: any) => w.code);

describe('S32 分层开启时的切片 checkpoint', () => {
  it('UT-S32-118: baseline 范围的基线部分为受影响 ∪ 主链路', () => {
    const f = ls('baseline');
    const run = verify(f);
    expect(run.data.verify_mode).toBe('slice-checkpoint');
    expect(run.data.attempted_slice_id).toBe('slice-a');
    expect(run.data.eligible_test_ids).toEqual(ELIGIBLE);
    for (const id of ['UT-S01-01', 'UT-S01-02', 'UT-S01-03', 'UT-S03-02']) expect(run.data.eligible_test_ids).not.toContain(id);
    expect(run.data.pending_test_ids).toEqual(['UT-S90-03']);
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0].eligible).toEqual(ELIGIBLE);
    expect(run.calls[0].slice_scope).toBe('baseline');
    expect(run.calls[0].executed).toEqual(ELIGIBLE);
    expect(run.data.layers.execution.ids).toEqual(ELIGIBLE);
    expect(run.data.layers.total.ids).toEqual(TOTAL);
    expect(run.data.layers.expansion.level).toBe('none');
    expect(run.data.summary.defined_count).toBe(ELIGIBLE.length);
    expect(run.data.uncovered_cases).toEqual([]);
    expect(run.data.gate.result).toBe('PASS');
    expect(checkpoints(f).map(r => [r.slice_id, r.result])).toEqual([['slice-a', 'PASS']]);
  });

  it('UT-S32-119: owned 范围与分层无关，越界规则不变', () => {
    // ① 入口按清单执行：集合与注入和分层未开启时一致
    const on = ls('owned');
    const a = verify(on);
    const off = verify(ls('owned', { layered: { enabled: false } }));
    expect(a.data.eligible_test_ids).toEqual(OWNED_A);
    expect(a.calls[0].eligible).toEqual(OWNED_A);
    expect(a.calls[0].slice_scope).toBe('owned');
    expect(a.data.eligible_test_ids).toEqual(off.data.eligible_test_ids);
    expect(a.calls[0].eligible).toEqual(off.calls[0].eligible);
    expect(a.data.summary).toEqual(off.data.summary);
    expect(a.data.gate.result).toBe('PASS');
    expect(checkpoints(on).at(-1).result).toBe('PASS');
    expect(a.data.layers.execution.ids).toEqual(OWNED_A);
    // ② 入口零退出，另外上报一条提案集合之外的基线用例
    const g = ls('owned', { script: { extra: ['UT-S01-01'] } });
    const b = verify(g);
    expect(b.data.pre_run.commands[0].status).toBe('pass');
    expect(b.data.consistency.outside_eligible_result_ids).toContain('UT-S01-01');
    expect(b.data.consistency.reasons).toContain('result_outside_eligible_scope');
    expect(b.data.gate.result).toBe('FAIL');
    expect(checkpoints(g).at(-1).result).toBe('FAIL');
    expect(b.data.layers.outside_result_count).toBe(0);
    expect(warningCodes(b.data)).not.toContain('layered_runner_not_narrowed');
    // ③ 多模块（code-r1 F3）：执行清单只含 backend 的 owned 用例，入口另外上报模块范围之外的 web 基线用例——
    // 先按执行清单判越界，不按「范围外模块」忽略
    const m = ls('owned', { mod: true, script: { foreign: { backend: ['UT-S07-01'] } } });
    const c = verify(m);
    expect(c.data.eligible_test_ids).toEqual(['UT-S05-03']);
    expect(c.calls.map(call => call.runner)).not.toContain('web');
    expect(c.data.pre_run.commands.every((cmd: any) => cmd.status === 'pass')).toBe(true);
    expect(c.data.consistency.outside_eligible_result_ids).toContain('UT-S07-01');
    expect(c.data.consistency.reasons).toContain('result_outside_eligible_scope');
    expect(c.data.gate.result).toBe('FAIL');
    expect(checkpoints(m).at(-1).result).toBe('FAIL');
    expect(c.data.checkpoint.confirmed_slice_ids).toEqual([]);
    expect(c.data.layers.outside_result_count).toBe(0);
  });

  it('UT-S32-120: 分层未开启时与引入前一致', () => {
    const run = verify(ls('baseline', { layered: { enabled: false } }));
    expect(run.data.eligible_test_ids).toEqual([...BASELINE_ALL, ...OWNED_A].sort());
    expect(run.data.pending_test_ids).toEqual(['UT-S90-03']);
    expect(run.data.level).toBe('proposal');
    expect(run.data.layers).toBeUndefined();
    expect(run.calls[0].eligible).toEqual(run.data.eligible_test_ids);
    expect(run.calls[0].slice_scope).toBe('baseline');
    expect(run.data.gate.result).toBe('PASS');
    expect(run.report).not.toContain('Verification Scope');
    // 不写 verify.layered 时输出相同（level 之外没有任何分层字段）
    const absent = verify(ls('baseline', { layered: null }));
    expect(absent.data.eligible_test_ids).toEqual(run.data.eligible_test_ids);
    expect(absent.data.summary).toEqual(run.data.summary);
    expect(Object.keys(absent.data).sort()).toEqual(Object.keys(run.data).sort());
  });

  it('UT-S32-121: 扩大时 checkpoint 随之扩大', () => {
    const run = verify(ls('baseline', { declaration: declarationYaml({ shared: 'true' }) }));
    expect(run.data.eligible_test_ids).toEqual([...BASELINE_ALL, ...OWNED_A].sort());
    expect(run.data.layers.expansion.level).toBe('full');
    expect(run.data.layers.expansion.reasons.map((r: any) => r.code)).toEqual(['shared_change_declared']);
    expect(run.data.layers.execution.ids).toEqual(run.data.eligible_test_ids);
    expect(run.data.gate.result).toBe('PASS');
  });

  it('UT-S32-122: 受影响场景中的 pending 用例不提前进入', () => {
    const run = verify(ls('baseline', { declaration: declarationYaml({ scenarios: ['S02', 'S90'] }) }));
    expect(run.data.layers.affected.ids).toContain('UT-S90-03');
    expect(run.data.pending_test_ids).toEqual(['UT-S90-03']);
    expect(run.data.eligible_test_ids).not.toContain('UT-S90-03');
    expect(run.data.eligible_test_ids).toEqual(ELIGIBLE);
    expect(run.calls[0].executed).not.toContain('UT-S90-03');
    expect(run.data.gate.result).toBe('PASS');
  });

  it('UT-S32-123: checkpoint 同样受主链路约束', () => {
    const f = ls('baseline', { layered: { enabled: true, main_path_max: 1 }, docs: S03_TWO_MAIN });
    const over = verify(f);
    expect(over.calls).toHaveLength(0);
    expect(over.data.gate).toEqual({ result: 'FAIL', reason: 'main_path_over_limit' });
    expect(over.data.verify_mode).toBe('slice-checkpoint');
    expect(checkpoints(f).map(r => r.result)).toEqual(['FAIL']);
    const g = ls('baseline', { script: { cases: { 'UT-S03-01': ['fail', 'pass'] } } });
    const flaky = verify(g);
    expect(flaky.data.gate).toEqual({ result: 'FAIL', reason: 'main_path_flaky' });
    expect(flaky.data.layers.main_path.flaky_ids).toEqual(['UT-S03-01']);
    expect(checkpoints(g).map(r => r.result)).toEqual(['FAIL']);
    // 两种情形切片都不计入已确认：再次验收仍在尝试 slice-a
    for (const run of [over, flaky]) expect(run.data.checkpoint.confirmed_slice_ids).toEqual([]);
  });

  it('UT-S32-124: pending 被提前上报仍按 checkpoint 规则判越界', () => {
    const f = ls('baseline', { script: { extra: ['UT-S90-03'] } });
    const a = verify(f);
    expect(a.data.consistency.outside_eligible_result_ids).toContain('UT-S90-03');
    expect(a.data.consistency.reasons).toContain('result_outside_eligible_scope');
    expect(a.data.gate.result).toBe('FAIL');
    expect(checkpoints(f).at(-1).result).toBe('FAIL');
    expect(a.data.layers.outside_result_count).toBe(0);
    const g = ls('baseline', { script: { extra: ['UT-S01-01'] } });
    const b = verify(g);
    expect(b.data.consistency.outside_eligible_result_ids).toEqual([]);
    expect(b.data.consistency.ok).toBe(true);
    expect(b.data.layers.outside_result_count).toBe(1);
    expect(warningCodes(b.data)).toContain('layered_runner_not_narrowed');
    expect(b.data.gate.result).toBe('PASS');
    expect(checkpoints(g).at(-1).result).toBe('PASS');
  });

  it('UT-S32-125: 按模块扩大的 baseline checkpoint 保留模块外已识别场景', () => {
    const f = ls('baseline', { mod: true, declaration: declarationYaml({ scenarios: ['S07', 'S99'] }) });
    const run = verify(f);
    expect(run.data.layers, JSON.stringify(run.data).slice(0, 900) + run.stderr.slice(0, 300)).toBeDefined();
    expect(run.data.layers.expansion.level).toBe('module');
    expect(run.data.layers.expansion.reasons.map((r: any) => r.code)).toEqual(['scenario_unknown']);
    const execution: string[] = run.data.layers.execution.ids;
    const web = run.calls.find(c => c.runner === 'web');
    for (const id of ['UT-S07-01', 'UT-S07-02']) {
      expect(web.eligible, id).toContain(id);
      expect(execution, id).toContain(id);
    }
    // backend 模块的基线用例、主链路用例与本片 owned 都在；pending 的本提案用例不在
    for (const id of ['UT-S05-01', 'UT-S05-02', 'UT-S06-01', 'UT-S03-01', 'UT-S05-03']) expect(execution, id).toContain(id);
    expect(execution).not.toContain('UT-S05-04');
    expect(run.data.pending_test_ids).toEqual(['UT-S05-04']);
    expect(run.data.eligible_test_ids).toEqual(execution);
    expect(run.data.layers.total.ids).toContain('UT-S05-04');
    expect(run.calls.map(c => c.runner)).toEqual(['core', 'backend', 'web']);
    for (const call of run.calls) expect(call.slice_scope, call.runner).toBe('baseline');
    expect(run.data.gate.result).toBe('PASS');

    // 扩大到全量（code-r1 F2）：声明 shared_change: true 时，模块范围之外的 web 基线同样进入清单并被执行；pending 仍不进入
    const shared = declarationYaml({ shared: 'true', scenarios: [] });
    const g = ls('baseline', { mod: true, declaration: shared });
    const full = verify(g);
    expect(full.data.layers.expansion.level).toBe('full');
    expect(full.data.scope).toMatchObject({ mode: 'module' });
    expect(full.data.scope.modules).not.toContain('web');
    expect(full.calls.map(c => c.runner)).toEqual(['core', 'backend', 'web']);
    const webCall = full.calls.find(c => c.runner === 'web');
    expect(webCall.eligible).toEqual(expect.arrayContaining(['UT-S07-01', 'UT-S07-02']));
    expect(webCall.executed).toEqual(['UT-S07-01', 'UT-S07-02']);
    expect(full.data.eligible_test_ids).toEqual(['UT-S01-01', 'UT-S01-02', 'UT-S03-01', 'UT-S03-02', 'UT-S05-01', 'UT-S05-02', 'UT-S05-03', 'UT-S06-01', 'UT-S07-01', 'UT-S07-02']);
    expect(full.data.pending_test_ids).toEqual(['UT-S05-04']);
    expect(full.data.gate.result).toBe('PASS');
    expect(checkpoints(g).at(-1).result).toBe('PASS');
    // web 的基线回归失败会阻断检查点
    const h = ls('baseline', { mod: true, declaration: shared, script: { cases: { 'UT-S07-01': 'fail' } } });
    const broken = verify(h);
    expect(broken.data.failed_cases.map((c: any) => c.id)).toEqual(['UT-S07-01']);
    expect(broken.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(checkpoints(h).at(-1).result).toBe('FAIL');
  });
});
