/**
 * fix-reopen-test-change-set-forward-merge 切片2：reopen 后切片归属消费回归。
 * 消费侧代码零变化——断言前滚后的提案级 change set 让多切片归属成立、removed 后写胜出。
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildTestChangeSet,
  forwardMergeTestChangeSets,
} from '../src/lib/test-change-set.js';
import {
  computeSpecFingerprint,
  computeTaskFingerprint,
  deriveSliceVerificationState,
  writeTestSliceManifestAtomic,
  type TestSliceManifestV1,
} from '../src/lib/test-slice-manifest.js';
import { makeTempRoot, scaffoldProject, withCompleteClarification } from './helpers.js';
import {
  cleanupFixtureRoots,
  driveToPhase2Apply,
  frontierFixture,
  invoke,
  put,
} from './frontier-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
afterAll(cleanupFixtureRoots);

const CHANGE = 'reopen-consume';
const SPEC_TARGET = 'logos/resources/test/core-S99-test-cases.md';

/** 前滚 marker 消费 fixture：SPEC_MERGED.test_change_set 为 forwardMerge 结果。 */
function forwardedFixture(options: {
  ancestorChanged: string[];
  tableIds: string[];          // 当前规格表中的 ID（after）
  beforeIds?: string[] | null; // 当前事务 before 表 ID；null=CREATE，缺省=与 after 相同（幂等）
  slices: string[][];
}) {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:', '  name: t', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched',
  ].join('\n'));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: CHANGE, module: 'core' }));
  const dir = join(root, 'logos', 'changes', CHANGE);
  mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
  const table = (ids: string[]) => ['| ID | 用例 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} fixture |`)].join('\n');
  const after = table(options.tableIds);
  writeFileSync(join(root, SPEC_TARGET), after);
  writeFileSync(join(dir, 'deltas', 'test', 'core-S99-test-cases.md'), after);
  writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
    '# 变更提案：reopen-consume', '', '## 变更原因', 'reopen 消费回归。', '', '## 变更类型', '代码级', '',
  ].join('\n')));
  const tasksLines = [
    '# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '', '## [code] 代码实现',
    ...options.slices.map((owned, i) => `- [ ] 切片 ${i + 1}：能力 ${i + 1}（覆盖 ${owned.join('、')}）`), '',
  ];
  const tasksPath = join(dir, 'tasks.md');
  writeFileSync(tasksPath, tasksLines.join('\n'));
  const beforeBytes = options.beforeIds === null ? null
    : Buffer.from(table(options.beforeIds ?? options.tableIds));
  const current = buildTestChangeSet({
    change: CHANGE, module: 'core',
    targets: [{ targetPath: SPEC_TARGET, beforeBytes, afterBytes: Buffer.from(after) }],
  });
  // 前滚：祖先 receipt 的 changed 并入（与核心 apply 路径同一纯函数）
  const forwarded = forwardMergeTestChangeSets(current, [
    { changed_test_ids: options.ancestorChanged, removed_test_ids: [] },
  ]);
  writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'baseline_closure_spec_complete',
    test_change_set: forwarded,
  }, null, 2)}\n`);
  writeFileSync(join(dir, 'SLICES_APPROVED'), '');
  const slices = options.slices.map((owned, index) => ({
    slice_id: `slice-0${index + 1}`,
    task_text: `切片 ${index + 1}：能力 ${index + 1}（覆盖 ${owned.join('、')}）`,
    owned_test_ids: [...owned].sort(),
    runner_selectors: [...owned].sort(),
    spec_targets: [SPEC_TARGET],
  }));
  const manifest: TestSliceManifestV1 = {
    schema: 'openlogos/test-slice-manifest@1',
    change: CHANGE, module: 'core',
    task_fingerprint: computeTaskFingerprint(readFileSync(tasksPath, 'utf8')),
    spec_fingerprint: computeSpecFingerprint(root, [SPEC_TARGET]),
    generated_at: '2026-09-05T00:00:00.000Z',
    slices,
  };
  writeTestSliceManifestAtomic(join(dir, 'TEST_SLICE_MANIFEST.json'), manifest);
  return { root, dir, forwarded };
}

describe('reopen 后切片归属消费 — S32（fix-reopen-test-change-set-forward-merge 切片2）', () => {
  it('UT-S32-69: 前滚 change set 下多切片 owned⊆changed 全部放行，reader 只读当前 marker', () => {
    // 首轮 ID（A/B 本轮幂等零变化）由祖先前滚而来，C 为本轮新增
    const f = forwardedFixture({
      ancestorChanged: ['UT-S13-56', 'UT-S13-57'],
      tableIds: ['UT-S13-56', 'UT-S13-57', 'UT-S27-36'],
      beforeIds: ['UT-S13-56', 'UT-S13-57'],
      slices: [['UT-S13-56', 'UT-S13-57'], ['UT-S27-36']],
    });
    expect(f.forwarded.changed_test_ids).toEqual(['UT-S13-56', 'UT-S13-57', 'UT-S27-36']);
    const state = deriveSliceVerificationState(f.root, f.dir, { change: CHANGE, module: 'core' })!;
    expect(state.manifest_status).toBe('valid');
    expect(state.violations ?? []).toEqual([]);
    expect(state.test_change_set?.changed_test_ids).toEqual(f.forwarded.changed_test_ids);
  });

  it('UT-S32-70: removed 后写胜出——own 被本轮删除的首轮 ID 触发 test-slice-test-id-unknown', () => {
    // 祖先 changed 了 UT-S13-61；本轮把它从表中删除 → 前滚后 removed=[UT-S13-61]
    // 双切片计划（单切片下切片验证按设计不启用）：本轮删除 61、新增 36
    const f = forwardedFixture({
      ancestorChanged: ['UT-S13-56', 'UT-S13-61'],
      tableIds: ['UT-S13-56', 'UT-S27-36'],
      beforeIds: ['UT-S13-56', 'UT-S13-61'],
      slices: [['UT-S13-56', 'UT-S13-61'], ['UT-S27-36']],
    });
    expect(f.forwarded.removed_test_ids).toEqual(['UT-S13-61']);
    expect(f.forwarded.changed_test_ids).not.toContain('UT-S13-61');
    const state = deriveSliceVerificationState(f.root, f.dir, { change: CHANGE, module: 'core' })!;
    expect(state.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'test-slice-test-id-unknown', message: expect.stringContaining('UT-S13-61') }),
    ]));
  });

  it('ST-S32-23: 真实命令链——reopen 重合并后多切片规划全链成立', () => {
    const f = frontierFixture();
    // 首轮全链：changed=[UT-S01-01]
    expect(invoke(['merge', f.slug], f.root).status).toBe(0);
    driveToPhase2Apply(f);
    // 修正测试 delta：新增 UT-S01-02 行（守恒保留 UT-S01-01），delta 先落盘再 reopen
    const newTable = '| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |\n| UT-S01-02 | 二号用例 |';
    put(f.root, `logos/changes/${f.slug}/deltas/test/core-S01-test-cases.md`, `## MODIFIED — 一、判据\n\n${newTable}\n`);
    f.finals[f.targetPath] = `# 文档\n\n## 一、判据\n\n${newTable}\n`;
    const reopen = invoke(['merge', 'transaction', 'reopen', '--slug', f.slug, '--reason', '补充二号用例', '--confirm-spec-merged'], f.root);
    expect(reopen.status, reopen.stderr).toBe(0);
    driveToPhase2Apply(f);
    // 前滚后 changed 提案级完整：首轮 UT-S01-01（本轮幂等）+ 本轮 UT-S01-02
    const marker = JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8'));
    expect(marker.test_change_set.changed_test_ids).toEqual(['UT-S01-01', 'UT-S01-02']);
    // 多切片规划（真实 slice plan 单条受控写入口）：两片各 own 一个 ID → 一次调用落盘
    const slicesFile = join(f.root, 'slices.json');
    writeFileSync(slicesFile, JSON.stringify([
      { slice_id: 'slice-01-one', task_text: '切片1：一号能力（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [f.targetPath] },
      { slice_id: 'slice-02-two', task_text: '切片2：二号能力（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [f.targetPath] },
    ]));
    const planned = invoke(['slice', 'plan', '--file', slicesFile], f.root);
    expect(planned.status, planned.stderr).toBe(0);
    // manifest 落盘且两片归属成立；消费侧派生零 violation
    const manifest = JSON.parse(readFileSync(join(f.proposalDir, 'TEST_SLICE_MANIFEST.json'), 'utf8'));
    expect(manifest.slices.map((s: { slice_id: string }) => s.slice_id)).toEqual(['slice-01-one', 'slice-02-two']);
    const state = deriveSliceVerificationState(f.root, f.proposalDir, { change: f.slug, module: 'core' })!;
    expect(state.manifest_status).toBe('valid');
    expect(state.violations ?? []).toEqual([]);
  });
});
