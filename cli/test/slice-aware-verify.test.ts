/**
 * make-verify-slice-aware：manifest、checkpoint、恢复合同与 final 收敛。
 *
 * 每个用例名使用已合并测试规格中的真实 UT/ST ID；全局 OpenLogos reporter 会按 ID
 * 分拆写入 test-results.jsonl。fixture 只在临时目录运行，不污染真实提案状态。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { next } from '../src/commands/next.js';
import { status } from '../src/commands/status.js';
import {
  collectVerifyData,
  verify,
} from '../src/commands/verify.js';
import {
  appendSliceCheckpoint,
  computeSpecFingerprint,
  computeTaskFingerprint,
  deriveSliceVerificationState,
  writeTestSliceManifestAtomic,
  type TestSliceManifestV1,
} from '../src/lib/test-slice-manifest.js';
import { deriveLoopState } from '../src/lib/flow-loop-derive.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { validateTestChangeSet } from '../src/lib/test-change-set.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import {
  captureConsole,
  makeTempRoot,
  mockCwd,
  mockProcessExit,
  scaffoldProject,
  withCompleteClarification,
} from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CHANGE = 'slice-aware';
const SPEC_TARGET = 'logos/resources/test/core-S99-test-cases.md';
const DEFAULT_IDS = [
  ['UT-S13-56', 'UT-S13-57'],
  ['UT-S27-36', 'UT-S31-28'],
  ['UT-S13-61', 'UT-S31-34'],
];

interface Fixture {
  root: string;
  dir: string;
  ids: string[][];
  tasksPath: string;
  manifestPath: string;
  manifest: TestSliceManifestV1;
}

function taskText(index: number, owned: string[] = DEFAULT_IDS[index]): string {
  return `切片 ${index + 1}：能力 ${index + 1}（覆盖 ${owned.join('、')}）`;
}

function tasks(ids: string[][], checked: boolean[] = []): string {
  return [
    '# 实现任务', '',
    '## [delta] 规格变更', '- [x] 已合并', '',
    '## [code] 代码实现',
    ...ids.map((owned, index) => `- [${checked[index] ? 'x' : ' '}] ${taskText(index, owned)}`),
    '',
  ].join('\n');
}

function proposal(): string {
  return withCompleteClarification([
    '# 变更提案：slice-aware', '',
    '## 变更原因', '让多切片 verify 可恢复。', '',
    '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '实现切片清单与检查点。',
  ].join('\n'));
}

function createFixture(options: { ids?: string[][]; checked?: boolean[]; manifest?: boolean } = {}): Fixture {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:', '  name: t', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched',
  ].join('\n'));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: CHANGE, module: 'core' }));
  const dir = join(root, 'logos', 'changes', CHANGE);
  mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
  const ids = options.ids ?? DEFAULT_IDS.map(group => [...group]);
  const allIds = ids.flat();
  const table = ['| ID | 用例 |', '|---|---|', ...allIds.map(id => `| ${id} | ${id} fixture |`)].join('\n');
  writeFileSync(join(root, SPEC_TARGET), table);
  writeFileSync(join(dir, 'deltas', 'test', 'core-S99-test-cases.md'), table);
  writeFileSync(join(dir, 'proposal.md'), proposal());
  const tasksPath = join(dir, 'tasks.md');
  writeFileSync(tasksPath, tasks(ids, options.checked));
  const testChangeSet = buildTestChangeSet({
    change: CHANGE,
    module: 'core',
    targets: [{ targetPath: SPEC_TARGET, beforeBytes: null, afterBytes: Buffer.from(table) }],
  });
  writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'baseline_closure_spec_complete',
    test_change_set: testChangeSet,
  }, null, 2)}\n`);
  writeFileSync(join(dir, 'SLICES_APPROVED'), '');
  const manifestPath = join(dir, 'TEST_SLICE_MANIFEST.json');
  const slices = ids.map((owned, index) => ({
    slice_id: `slice-0${index + 1}`,
    task_text: taskText(index, owned),
    owned_test_ids: [...owned].sort(),
    runner_selectors: [...owned].sort(),
    spec_targets: [SPEC_TARGET],
  }));
  const manifest: TestSliceManifestV1 = {
    schema: 'openlogos/test-slice-manifest@1',
    change: CHANGE,
    module: 'core',
    task_fingerprint: computeTaskFingerprint(readFileSync(tasksPath, 'utf8')),
    spec_fingerprint: computeSpecFingerprint(root, [SPEC_TARGET]),
    generated_at: '2026-08-16T00:00:00.000Z',
    slices,
  };
  if (options.manifest !== false) writeTestSliceManifestAtomic(manifestPath, manifest);
  return { root, dir, ids, tasksPath, manifestPath, manifest };
}

function state(f: Fixture) {
  return deriveSliceVerificationState(f.root, f.dir, { change: CHANGE, module: 'core' })!;
}

function writeResults(root: string, rows: Array<{ id: string; status: 'pass' | 'fail'; error?: string }>): void {
  writeFileSync(join(root, 'logos', 'resources', 'verify', 'test-results.jsonl'),
    `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
}

function runStatusJson(root: string): any {
  const restore = mockCwd(root); const cap = captureConsole(); const exit = mockProcessExit();
  try { status('json'); } finally { exit.mockRestore(); cap.restore(); restore(); }
  return JSON.parse(cap.logs.at(-1)!).data;
}

async function runNextJson(root: string, auto = false): Promise<any> {
  const restore = mockCwd(root); const cap = captureConsole(); const exit = mockProcessExit();
  try { await next('json', undefined, auto); } finally { exit.mockRestore(); cap.restore(); restore(); }
  return JSON.parse(cap.logs.at(-1)!).data;
}

function runVerifyJson(root: string): { data: any; exited: boolean } {
  const restore = mockCwd(root); const cap = captureConsole(); const exit = mockProcessExit();
  let exited = false;
  try { verify('json'); } catch { exited = true; }
  finally { exit.mockRestore(); cap.restore(); restore(); }
  const envelope = [...cap.logs, ...cap.errors].map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).find(item => item?.command === 'verify');
  return { data: envelope?.data, exited };
}

function rewriteManifest(f: Fixture, mutate: (value: any) => void): void {
  const value = JSON.parse(readFileSync(f.manifestPath, 'utf8'));
  mutate(value);
  writeFileSync(f.manifestPath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeChangeSet(f: Fixture, beforeBytes: Buffer | null): ReturnType<typeof buildTestChangeSet> {
  const afterBytes = readFileSync(join(f.root, SPEC_TARGET));
  const changeSet = buildTestChangeSet({
    change: CHANGE,
    module: 'core',
    targets: [{ targetPath: SPEC_TARGET, beforeBytes, afterBytes }],
  });
  writeFileSync(join(f.dir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'baseline_closure_spec_complete',
    test_change_set: changeSet,
  }, null, 2)}\n`);
  return changeSet;
}

describe('切片 1：checkpoint 与 manifest 基础', () => {
  it('UT-S32-32 UT-S32-38 UT-S32-39 UT-S32-42 ST-S32-10：合法 manifest、规范化 fingerprint 与原子替换', () => {
    const f = createFixture();
    expect(state(f).manifest_status).toBe('valid');
    const originalTask = computeTaskFingerprint(readFileSync(f.tasksPath, 'utf8'));
    writeFileSync(f.tasksPath, tasks(f.ids, [true, false, false]).replace(/\n/g, '\r\n'));
    expect(computeTaskFingerprint(readFileSync(f.tasksPath, 'utf8'))).toBe(originalTask);
    writeFileSync(f.tasksPath, readFileSync(f.tasksPath, 'utf8').replace(taskText(1, f.ids[1]), '能力语义变化（覆盖 UT-S27-36）'));
    expect(computeTaskFingerprint(readFileSync(f.tasksPath, 'utf8'))).not.toBe(originalTask);
    writeFileSync(f.tasksPath, tasks(f.ids));
    const lf = computeSpecFingerprint(f.root, [SPEC_TARGET]);
    writeFileSync(join(f.root, SPEC_TARGET), readFileSync(join(f.root, SPEC_TARGET), 'utf8').replace(/\n/g, '\r\n'));
    expect(computeSpecFingerprint(f.root, [SPEC_TARGET])).toBe(lf);
    writeTestSliceManifestAtomic(f.manifestPath, f.manifest);
    expect(JSON.parse(readFileSync(f.manifestPath, 'utf8')).schema).toBe('openlogos/test-slice-manifest@1');
    expect(existsSync(`${f.manifestPath}.tmp`)).toBe(false);
  });

  it('UT-S32-33 UT-S32-34 UT-S32-35 UT-S32-36 UT-S32-37：validator 对格式、漏配、重复、未知与 selector fail-closed', () => {
    const cases: Array<[string, (value: any) => void, string]> = [
      ['非法 slice', v => { v.slices[1].slice_id = 'BAD'; }, 'test-slice-manifest-invalid'],
      ['漏配', v => { v.slices[0].owned_test_ids.shift(); v.slices[0].runner_selectors.shift(); }, 'test-slice-test-id-missing'],
      ['重复', v => { v.slices[1].owned_test_ids.push(v.slices[0].owned_test_ids[0]); v.slices[1].runner_selectors.push(v.slices[0].owned_test_ids[0]); }, 'test-slice-test-id-duplicate'],
      ['未知', v => { v.slices[0].owned_test_ids.push('UT-S99-999'); v.slices[0].runner_selectors.push('UT-S99-999'); }, 'test-slice-test-id-unknown'],
      ['selector', v => { v.slices[0].runner_selectors = []; }, 'test-slice-manifest-invalid'],
    ];
    for (const [, mutate, code] of cases) {
      const f = createFixture(); rewriteManifest(f, mutate);
      expect(state(f).violations?.map(item => item.code)).toContain(code);
    }
  });

  it('UT-S13-56 UT-S13-57 UT-S13-63 UT-S16-10 UT-S16-12：eligible/pending 互斥，pending 不进覆盖分母，越界结果失败', () => {
    const f = createFixture();
    writeResults(f.root, f.ids[0].map(id => ({ id, status: 'pass' as const })));
    const current = state(f);
    expect(current.attempted_slice_id).toBe('slice-01');
    expect(current.pending_test_ids).toEqual([...f.ids[1], ...f.ids[2]].sort());
    const data = collectVerifyData(f.root, undefined, current);
    expect(data.uncovered_cases).toEqual([]);
    expect(data.summary.defined_count).toBe(current.eligible_test_ids.length);
    writeResults(f.root, [...f.ids[0], f.ids[2][0]].map(id => ({ id, status: 'pass' as const })));
    const outside = collectVerifyData(f.root, undefined, current);
    expect(outside.consistency.reasons).toContain('result_outside_eligible_scope');
    expect(outside.consistency.outside_eligible_result_ids).toEqual([f.ids[2][0]]);
  });

  it('UT-S13-58 UT-S13-60：checkpoint PASS 幂等且不生成最终 VERIFY_PASS', () => {
    const f = createFixture();
    writeResults(f.root, f.ids[0].map(id => ({ id, status: 'pass' as const })));
    const first = runVerifyJson(f.root);
    expect(first.data.gate.result).toBe('PASS');
    expect(first.data.verify_mode).toBe('slice-checkpoint');
    expect(existsSync(join(f.dir, 'VERIFY_PASS'))).toBe(false);
    const before = readFileSync(join(f.dir, 'SLICE_CHECKPOINTS.jsonl'), 'utf8');
    writeResults(f.root, [...f.ids[0], ...f.ids[1]].map(id => ({ id, status: 'pass' as const })));
    const secondSlice = deriveSliceVerificationState(f.root, f.dir)!;
    expect(appendSliceCheckpoint(f.dir, secondSlice, 'PASS')).toBe(true);
    expect(appendSliceCheckpoint(f.dir, secondSlice, 'PASS')).toBe(false);
    expect(readFileSync(join(f.dir, 'SLICE_CHECKPOINTS.jsonl'), 'utf8').length).toBeGreaterThan(before.length);
  });
});

describe('切片 2：manifest 恢复合同', () => {
  it('UT-S13-64 UT-S27-34 UT-S28-37 UT-S28-41 ST-S13-17 ST-S28-12：缺 manifest 派恢复且三入口零 Gate 副作用', async () => {
    const f = createFixture({ manifest: false });
    writeFileSync(join(f.dir, 'LOOP_ITERS'), 'seed\n');
    const before = readFileSync(join(f.dir, 'LOOP_ITERS'), 'utf8');
    const s = runStatusJson(f.root).modules[0];
    const n = (await runNextJson(f.root)).modules[0];
    expect(s.slice_verification_state.reason).toBe('test-slice-manifest-missing');
    expect(n.reason).toBe('test-slice-manifest-missing');
    expect(n.next_node).toMatchObject({ id: 'plan-slices', skill: 'slice-planner' });
    const v = runVerifyJson(f.root);
    expect(v.exited).toBe(true);
    expect(existsSync(join(f.dir, 'VERIFY_FAIL'))).toBe(false);
    expect(existsSync(join(f.dir, 'SLICE_CHECKPOINTS.jsonl'))).toBe(false);
    expect(readFileSync(join(f.dir, 'LOOP_ITERS'), 'utf8')).toBe(before);
  });

  it('UT-S16-13 UT-S28-42 ST-S16-04：恢复 next_node 与 dispatch 可被纯 JSON consumer 完整消费', async () => {
    const f = createFixture({ manifest: false });
    const data = await runNextJson(f.root);
    const node = data.modules[0].next_node;
    expect(node).toMatchObject({
      id: 'plan-slices', name: '恢复测试—切片清单', subflow_id: 'slice', skill: 'slice-planner',
      working_agent: null, review_agent: null, pre_script: null, post_script: null,
      dispatch: { idempotent: true, timeout_seconds: 900 },
    });
    expect(node.dispatch.artifacts_hint).toEqual(expect.arrayContaining(['tasks.md', 'TEST_SLICE_MANIFEST.json', 'logos/resources/test/']));
  });

  it('UT-S16-14 UT-S27-35 UT-S28-38 UT-S28-39 UT-S28-40 UT-S28-43 ST-S28-13 ST-S28-14 ST-S32-12 ST-S32-13：invalid/stale 可恢复，unsupported/ambiguous 保守阻塞', async () => {
    const invalid = createFixture(); rewriteManifest(invalid, v => { delete v.slices[0].runner_selectors; });
    expect(state(invalid).reason).toBe('test-slice-manifest-invalid');
    expect((await runNextJson(invalid.root)).modules[0].next_node.id).toBe('plan-slices');
    const stale = createFixture();
    writeFileSync(stale.tasksPath, readFileSync(stale.tasksPath, 'utf8').replace(taskText(0, stale.ids[0]), '漂移后的语义（覆盖 UT-S13-56）'));
    expect(state(stale).reason).toBe('test-slice-manifest-stale');
    const unsupported = createFixture(); rewriteManifest(unsupported, v => { v.schema = 'openlogos/test-slice-manifest@2'; });
    expect(state(unsupported).reason).toBe('test-slice-manifest-unsupported');
    expect((await runNextJson(unsupported.root)).modules[0].next_node).toBeUndefined();
    const ambiguous = createFixture(); rewriteManifest(ambiguous, v => {
      v.slices[1].owned_test_ids.push(v.slices[0].owned_test_ids[0]);
      v.slices[1].runner_selectors.push(v.slices[0].owned_test_ids[0]);
    });
    expect(state(ambiguous).reason).toBe('test-slice-assignment-ambiguous');
    expect((await runNextJson(ambiguous.root)).modules[0].next_node).toBeUndefined();
  });

  it('UT-S16-15 UT-S16-17 UT-S28-44：status/next 同源；legacy 单切片省略；恢复后重调 canonical 前沿', async () => {
    const f = createFixture();
    const s = runStatusJson(f.root).modules[0].slice_verification_state;
    const n = (await runNextJson(f.root)).modules[0].slice_verification_state;
    expect(n).toEqual(s);
    const legacy = createFixture({ ids: [['UT-S16-17']] });
    expect(runStatusJson(legacy.root).modules[0].slice_verification_state).toBeUndefined();
    expect((await runNextJson(legacy.root)).modules[0].slice_verification_state).toBeUndefined();
    const recovered = createFixture({ manifest: false });
    writeTestSliceManifestAtomic(recovered.manifestPath, recovered.manifest);
    expect((await runNextJson(recovered.root)).modules[0].slice_verification_state.attempted_slice_id).toBe('slice-01');
  });

  it('UT-S32-40 UT-S32-41 ST-S32-11 ST-S27-13：确定性重建只替换 manifest，保留任务、批准与 checkpoint，恢复不消耗 repair', () => {
    const f = createFixture();
    appendSliceCheckpoint(f.dir, state(f), 'PASS', '2026-08-16T00:01:00.000Z');
    writeFileSync(f.tasksPath, tasks(f.ids, [true, false, false]));
    const snapshots = ['tasks.md', 'SLICES_APPROVED', 'SLICE_CHECKPOINTS.jsonl']
      .map(name => [name, readFileSync(join(f.dir, name), 'utf8')] as const);
    const stable = { ...f.manifest, task_fingerprint: computeTaskFingerprint(readFileSync(f.tasksPath, 'utf8')) };
    writeTestSliceManifestAtomic(f.manifestPath, stable);
    const once = readFileSync(f.manifestPath, 'utf8');
    writeTestSliceManifestAtomic(f.manifestPath, stable);
    expect(readFileSync(f.manifestPath, 'utf8')).toBe(once);
    for (const [name, bytes] of snapshots) expect(readFileSync(join(f.dir, name), 'utf8')).toBe(bytes);
    expect(existsSync(join(f.dir, 'LOOP_ITERS'))).toBe(false);
  });
});

describe('切片 3：稳定 attempted slice 与 repair', () => {
  it('UT-S13-59 UT-S27-36 UT-S27-37 UT-S31-28 UT-S31-30 ST-S13-16 ST-S31-13：checkbox 前移后失败仍锁定同一 manifest slice', () => {
    const f = createFixture({ checked: [true, true, false] });
    writeResults(f.root, [
      { id: f.ids[0][0], status: 'pass' }, { id: f.ids[0][1], status: 'fail', error: 'x' },
    ]);
    const a = runVerifyJson(f.root);
    const b = runVerifyJson(f.root);
    expect(a.data.attempted_slice_id).toBe('slice-01');
    expect(b.data.attempted_slice_id).toBe('slice-01');
    const rows = readFileSync(join(f.dir, 'LOOP_ITERS'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.verify_mode === 'slice-checkpoint' && row.attempted_slice_id === 'slice-01')).toBe(true);
    expect(existsSync(join(f.dir, 'VERIFY_FAIL'))).toBe(true);
  });

  it('UT-S27-33 UT-S27-38 UT-S31-29：checkpoint PASS 不计失败迭代并只前移一片', () => {
    const f = createFixture();
    writeResults(f.root, f.ids[0].map(id => ({ id, status: 'pass' as const })));
    runVerifyJson(f.root);
    expect(existsSync(join(f.dir, 'LOOP_ITERS'))).toBe(false);
    expect(state(f)).toMatchObject({ confirmed_slice_ids: ['slice-01'], attempted_slice_id: 'slice-02' });
  });

  it('UT-S31-31 UT-S31-32 UT-S31-36 ST-S31-14：checkpoint 受 manifest 哈希隔离、PASS 幂等且重启派生确定', () => {
    const f = createFixture();
    const before = state(f);
    appendSliceCheckpoint(f.dir, before, 'PASS');
    appendSliceCheckpoint(f.dir, before, 'PASS');
    expect(readFileSync(join(f.dir, 'SLICE_CHECKPOINTS.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    const after = state(f);
    expect(state(f)).toEqual(after);

    // 哈希隔离：把该行的 manifest_sha256 换成一个**旧划分**的哈希 → 不再确认当前 slice。
    // 判据换成改写账本行、而不是改 manifest 的 generated_at：自 checkpoint @2 起身份绑定的
    // 是判定实质（排除 generated_at，根规范 §6.1），空转重跑不作废账本正是本次修正的目的。
    const ledger = join(f.dir, 'SLICE_CHECKPOINTS.jsonl');
    const row = JSON.parse(readFileSync(ledger, 'utf8').trim());
    writeFileSync(ledger, `${JSON.stringify({ ...row, manifest_sha256: `sha256:${'0'.repeat(64)}` })}\n`);
    expect(state(f).confirmed_slice_ids).toEqual([]);
    expect(state(f).attempted_slice_id).toBe('slice-01');

    // 反向锁死：仅 generated_at 变化（恢复重跑的必然形态）**不得**作废账本。
    writeFileSync(ledger, `${JSON.stringify(row)}\n`);
    rewriteManifest(f, v => { v.generated_at = '2026-08-16T00:02:00.000Z'; });
    expect(state(f).confirmed_slice_ids).toEqual(['slice-01']);
    expect(state(f).attempted_slice_id).toBe('slice-02');
  });

  it('UT-S27-40 ST-S27-12：同片真实失败累计且 loop-exhausted 不能被 --auto 放行', async () => {
    const f = createFixture();
    mkdirSync(join(f.root, 'logos', 'flow'), { recursive: true });
    writeFileSync(join(f.root, 'logos', 'flow', 'launched.yaml'), [
      'extends: builtin:launched@v1', 'overlay:', '  - op: set-loop', '    subflow: implement',
      '    set: { max_iters: 2, exhausted_gate: { skippable: false } }',
    ].join('\n'));
    writeResults(f.root, [{ id: f.ids[0][0], status: 'fail', error: 'x' }]);
    runVerifyJson(f.root); runVerifyJson(f.root);
    const n = await runNextJson(f.root, true);
    expect(n.gate_id).toBe('gate:implement:loop-exhausted');
    expect(n.skippable).toBe(false);
    expect(n.gate_auto_passed).toBe(false);
  });
});

describe('切片 4：final 全量收敛', () => {
  function reachFinal(f: Fixture): void {
    for (let index = 0; index < f.ids.length; index += 1) {
      const current = state(f);
      expect(current.attempted_slice_id).toBe(`slice-0${index + 1}`);
      expect(appendSliceCheckpoint(f.dir, current, 'PASS')).toBe(true);
    }
    writeFileSync(f.tasksPath, tasks(f.ids, f.ids.map(() => true)));
  }

  it('UT-S13-61 UT-S16-11 UT-S31-33：只有 tasks 与全部 checkpoint 同时完成才进入 final 全量 scope', () => {
    const f = createFixture();
    for (let i = 0; i < f.ids.length; i += 1) appendSliceCheckpoint(f.dir, state(f), 'PASS');
    expect(state(f).reason).toBe('slice-task-state-inconsistent');
    writeFileSync(f.tasksPath, tasks(f.ids, f.ids.map(() => true)));
    expect(state(f)).toMatchObject({ verify_mode: 'final', attempted_slice_id: null, pending_test_ids: [] });
    expect(state(f).eligible_test_ids).toEqual(f.ids.flat().sort());
  });

  it('UT-S13-62 UT-S27-39 UT-S31-35 ST-S31-15：final 缺覆盖硬失败且保留历史 checkpoint，修复后才 PASS', () => {
    const f = createFixture(); reachFinal(f);
    const checkpointBytes = readFileSync(join(f.dir, 'SLICE_CHECKPOINTS.jsonl'), 'utf8');
    writeResults(f.root, f.ids.flat().slice(0, -1).map(id => ({ id, status: 'pass' as const })));
    const fail = runVerifyJson(f.root);
    expect(fail.data.gate).toMatchObject({ result: 'FAIL', reason: 'incomplete_coverage' });
    expect(fail.data.pending_test_ids).toEqual([]);
    expect(existsSync(join(f.dir, 'VERIFY_PASS'))).toBe(false);
    expect(readFileSync(join(f.dir, 'SLICE_CHECKPOINTS.jsonl'), 'utf8')).toBe(checkpointBytes);
    const lastLoop = JSON.parse(readFileSync(join(f.dir, 'LOOP_ITERS'), 'utf8').trim().split('\n').at(-1)!);
    expect(lastLoop).toMatchObject({ verify_mode: 'final', attempted_slice_id: null });
    writeResults(f.root, f.ids.flat().map(id => ({ id, status: 'pass' as const })));
    expect(runVerifyJson(f.root).data.gate.result).toBe('PASS');
    expect(existsSync(join(f.dir, 'VERIFY_PASS'))).toBe(true);
  });

  it('UT-S31-34 ST-S13-15 ST-S16-03 ST-S27-11 ST-S31-12：逐片 checkpoint 不写最终 PASS，final PASS 后才收敛', () => {
    const f = createFixture();
    for (let index = 0; index < f.ids.length; index += 1) {
      const eligible = f.ids.slice(0, index + 1).flat();
      writeResults(f.root, eligible.map(id => ({ id, status: 'pass' as const })));
      expect(runVerifyJson(f.root).data.verify_mode).toBe('slice-checkpoint');
      expect(existsSync(join(f.dir, 'VERIFY_PASS'))).toBe(false);
    }
    writeFileSync(f.tasksPath, tasks(f.ids, f.ids.map(() => true)));
    const before = deriveLoopState(f.root, { id: 'core', name: 'Core', lifecycle: 'launched' }, f.dir, false);
    expect(before?.converged).toBe(false);
    writeResults(f.root, f.ids.flat().map(id => ({ id, status: 'pass' as const })));
    const final = runVerifyJson(f.root);
    expect(final.data).toMatchObject({ verify_mode: 'final', attempted_slice_id: null, pending_test_ids: [] });
    expect(deriveLoopState(f.root, { id: 'core', name: 'Core', lifecycle: 'launched' }, f.dir, false)?.converged).toBe(true);
  });
});

describe('canonical change set 分层消费', () => {
  it('UT-S32-43: 有效 change set 是 C/R 唯一来源且不扫描 Delta', () => {
    const f = createFixture();
    const expected = state(f).test_change_set;
    writeFileSync(join(f.dir, 'deltas/test/core-S99-test-cases.md'),
      '| ID | 用例 |\n|---|---|\n| UT-S99-999 | delta-only |\n');
    const actual = state(f);
    expect(actual.manifest_status).toBe('valid');
    expect(actual.test_change_set).toEqual(expected);
    expect(actual.test_change_set?.changed_test_ids).not.toContain('UT-S99-999');
  });

  it('UT-S32-44: 原样 baseline ID 放入 owned 返回 unknown', () => {
    const f = createFixture();
    const baselineId = f.ids[0][0];
    writeChangeSet(f, Buffer.from(`| ID | 用例 |\n|---|---|\n| ${baselineId} | ${baselineId} fixture |\n`));
    expect(state(f).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'test-slice-test-id-unknown', message: expect.stringContaining(baselineId) }),
    ]));
  });

  it('UT-S32-45: C 中新增或真实修改 ID 漏配返回 missing', () => {
    const f = createFixture();
    const missing = f.ids[0][0];
    rewriteManifest(f, value => {
      value.slices[0].owned_test_ids = value.slices[0].owned_test_ids.filter((id: string) => id !== missing);
      value.slices[0].runner_selectors = value.slices[0].runner_selectors.filter((id: string) => id !== missing);
    });
    expect(state(f).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'test-slice-test-id-missing', message: expect.stringContaining(missing) }),
    ]));
  });

  it('UT-S32-46: changed ID 多片归属保持 assignment ambiguous', () => {
    const f = createFixture();
    const duplicate = f.ids[0][0];
    rewriteManifest(f, value => {
      value.slices[1].owned_test_ids.push(duplicate);
      value.slices[1].runner_selectors.push(duplicate);
    });
    expect(state(f)).toMatchObject({
      reason: 'test-slice-assignment-ambiguous',
      human_action_required: true,
    });
  });

  it('UT-S32-47: removed ID 只在 R，放入 owned 才返回 unknown', () => {
    const f = createFixture();
    const removed = 'UT-S99-999';
    const changeSet = writeChangeSet(f, Buffer.from(`| ID | 用例 |\n|---|---|\n| ${removed} | gone |\n`));
    expect(changeSet.removed_test_ids).toEqual([removed]);
    expect(state(f).manifest_status).toBe('valid');
    rewriteManifest(f, value => {
      value.slices[0].owned_test_ids.push(removed);
      value.slices[0].runner_selectors.push(removed);
    });
    expect(state(f).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'test-slice-test-id-unknown', message: expect.stringContaining(removed) }),
    ]));
  });

  it('UT-S32-48: 不可信 change set 阻断且不误派 slice manifest 恢复', async () => {
    const f = createFixture({ manifest: false });
    const markerPath = join(f.dir, 'SPEC_MERGED');
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    marker.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`;
    writeFileSync(markerPath, JSON.stringify(marker));
    const before = new Set([...
      ['GATE_AUTO_PASSED', 'LOOP_ITERS', 'SLICE_CHECKPOINTS.jsonl', 'VERIFY_PASS', 'VERIFY_FAIL']
        .filter(name => existsSync(join(f.dir, name)))
    ]);
    expect(state(f)).toMatchObject({
      manifest_status: 'invalid', reason: 'test-slice-manifest-invalid', human_action_required: true,
    });
    const nextData = await runNextJson(f.root);
    expect(nextData.modules[0].next_node).toBeUndefined();
    expect(runVerifyJson(f.root).exited).toBe(true);
    const after = new Set(['GATE_AUTO_PASSED', 'LOOP_ITERS', 'SLICE_CHECKPOINTS.jsonl', 'VERIFY_PASS', 'VERIFY_FAIL']
      .filter(name => existsSync(join(f.dir, name))));
    expect(after).toEqual(before);
  });

  it('UT-S32-49: 跨仓事故 C 精确为六 ID且十二个原样 ID不被 owned', () => {
    const { root, cleanup } = makeTempRoot();
    cleanups.push(cleanup);
    const path = 'logos/resources/test/incident-test-cases.md';
    const baseline = [
      ...Array.from({ length: 9 }, (_, index) => `UT-S10-${121 + index}`),
      ...Array.from({ length: 4 }, (_, index) => `ST-S10-${36 + index}`),
    ];
    const before = Buffer.from(['| ID | 用例 |', '|---|---|', ...baseline.map(id => `| ${id} | ${id === 'UT-S10-129' ? 'old' : 'same'} |`)].join('\n'));
    const additions = ['ST-S10-44', 'UT-S10-137', 'UT-S10-138', 'UT-S10-139', 'UT-S10-140'];
    const after = Buffer.from(['| ID | 用例 |', '|---|---|',
      ...baseline.map(id => `| ${id} | ${id === 'UT-S10-129' ? 'new' : 'same'} |`),
      ...additions.map(id => `| ${id} | added |`),
    ].join('\n'));
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    writeFileSync(join(root, path), after);
    const changeSet = buildTestChangeSet({ change: 'incident', module: 'core', targets: [
      { targetPath: path, beforeBytes: before, afterBytes: after },
    ] });
    expect(changeSet.changed_test_ids).toEqual([
      'ST-S10-44', 'UT-S10-129', 'UT-S10-137', 'UT-S10-138', 'UT-S10-139', 'UT-S10-140',
    ]);
    expect(validateTestChangeSet(root, changeSet, { change: 'incident', module: 'core' }).valid).toBe(true);
  });

  it('ST-S32-14: status、next、change-lint、validator 与 verify 同源 C/R', async () => {
    const f = createFixture();
    const canonical = state(f).test_change_set;
    expect(runStatusJson(f.root).modules[0].slice_verification_state.test_change_set).toEqual(canonical);
    expect((await runNextJson(f.root)).modules[0].slice_verification_state.test_change_set).toEqual(canonical);
    const lint = runChangeLint(f.root, f.dir, CHANGE);
    expect(lint.ok && lint.test_change_set.valid && lint.test_change_set.value.changed_test_ids)
      .toEqual(canonical?.changed_test_ids);
    writeResults(f.root, f.ids[0].map(id => ({ id, status: 'pass' as const })));
    expect(runVerifyJson(f.root).data.test_change_set).toEqual(canonical);
  });

  it('ST-S32-15: change set 有效时 missing/invalid/stale 才派 plan-slices', async () => {
    const missing = createFixture({ manifest: false });
    expect((await runNextJson(missing.root)).modules[0].next_node.id).toBe('plan-slices');
    const invalid = createFixture();
    rewriteManifest(invalid, value => { delete value.slices[0].runner_selectors; });
    expect((await runNextJson(invalid.root)).modules[0].next_node.id).toBe('plan-slices');
    const stale = createFixture();
    writeFileSync(stale.tasksPath, `${readFileSync(stale.tasksPath, 'utf8')}\n`);
    rewriteManifest(stale, value => { value.task_fingerprint = `sha256:${'0'.repeat(64)}`; });
    expect((await runNextJson(stale.root)).modules[0].next_node.id).toBe('plan-slices');
  });

  it('ST-S32-16: change set 篡改跨 status/next/verify 保持人工边界且零副作用', async () => {
    const f = createFixture();
    const markerPath = join(f.dir, 'SPEC_MERGED');
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    marker.test_change_set.schema = 'openlogos/test-change-set@2';
    writeFileSync(markerPath, JSON.stringify(marker));
    const statusState = runStatusJson(f.root).modules[0].slice_verification_state;
    const nextState = (await runNextJson(f.root)).modules[0].slice_verification_state;
    expect(statusState.human_action_required).toBe(true);
    expect(nextState).toEqual(statusState);
    expect(runVerifyJson(f.root).exited).toBe(true);
    for (const name of ['VERIFY_PASS', 'VERIFY_FAIL', 'LOOP_ITERS', 'SLICE_CHECKPOINTS.jsonl']) {
      expect(existsSync(join(f.dir, name))).toBe(false);
    }
  });
});

describe('切片 5：发布 Schema 合同', () => {
  it('UT-S16-16：status/next/verify 1.1.0 Schema 正反例', async () => {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const schema = (name: string) => JSON.parse(readFileSync(join(process.cwd(), '..', 'spec', 'schema', `${name}.schema.json`), 'utf8'));
    const validate = (name: string, value: any) => {
      const ajv = new Ajv2020({ strict: false, allowUnionTypes: true }); addFormats(ajv);
      return { ok: ajv.validate(schema(name), value), errors: ajv.errors };
    };
    const f = createFixture();
    const statusData = runStatusJson(f.root);
    const nextData = await runNextJson(f.root);
    writeResults(f.root, f.ids[0].map(id => ({ id, status: 'pass' as const })));
    const verifyData = runVerifyJson(f.root).data;
    expect(validate('status', statusData).ok).toBe(true);
    expect(validate('next', nextData).ok).toBe(true);
    expect(validate('verify', verifyData).ok).toBe(true);
    const badCheckpoint = JSON.parse(JSON.stringify(verifyData)); badCheckpoint.attempted_slice_id = null;
    expect(validate('verify', badCheckpoint).ok).toBe(false);
    const badFinal = JSON.parse(JSON.stringify(verifyData));
    badFinal.verify_mode = 'final'; badFinal.attempted_slice_id = null; badFinal.pending_test_ids = ['UT-S99-999']; badFinal.checkpoint.final = true;
    expect(validate('verify', badFinal).ok).toBe(false);
    const badDispatch = JSON.parse(JSON.stringify(nextData)); delete badDispatch.modules[0].next_node.dispatch.idempotent;
    expect(validate('next', badDispatch).ok).toBe(false);
  });
});
