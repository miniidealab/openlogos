/**
 * 切片1：apply 终态自校验与整体回滚。
 * 覆盖 UT-S32-59、UT-S32-60、ST-S32-20。
 *
 * 缺陷背景：`apply` 写盘成功即置 `completed`，同一进程内的 `deriveSliceVerificationState()`
 * 随即把这份刚写出的 manifest 判为 `invalid`。复核器 `verifyAppliedManifest()` 早已存在、
 * 注释也写明用途，但**全仓零调用方**——没有任何执行路径经过它，于是这条约束不存在
 * （架构 §四十三.2.1）。现场后果是提案被永久锁死在 plan-slices。
 *
 * 本组用例的 slot 内容一律**结构合法**（JSON 合法、四个必填字段齐备），非法只体现在业务层面。
 * 用缺字段或非 JSON 构造会命中 `parseSlicesSlot` 的既有结构校验，与本缺陷无关。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import {
  TestSliceTransactionError, applyTestSliceTransaction, createTestSliceTransaction,
  readTestSliceTransactionIfPresent, sealTestSliceTransaction, submitTestSliceContent,
} from '../src/lib/test-slice-transaction.js';
import { deriveSliceVerificationState } from '../src/lib/test-slice-manifest.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'stx-verify';
const SPEC_REL = 'logos/resources/test/core-S01-test-cases.md';
const OTHER_DOC = 'logos/resources/prd/3-technical-plan/core-01-architecture.md';

const CODE_BODY = '- [ ] 切片1：第一片完整任务文本（覆盖 UT-S01-01）\n- [ ] 切片2：第二片完整任务文本（覆盖 UT-S01-02）';
const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', '- [ ] 实现代码变更', '',
  '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
].join('\n');

/** 合法切片：spec_targets 指向测试规格；task_text 逐字等于 [code] 行去掉前缀。 */
const VALID_SLICES = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片完整任务文本（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [SPEC_REL] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片完整任务文本（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [SPEC_REL] },
];
/** 业务非法：spec_targets 指向非测试规格文档，且 task_text 用简称而非 [code] 行全文。 */
const INVALID_SLICES = [
  { slice_id: 'slice-01-a', task_text: '切片1简称', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [OTHER_DOC] },
  { slice_id: 'slice-02-b', task_text: '切片2简称', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [OTHER_DOC] },
];

function setup() {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
  mkdirSync(join(root, 'logos', 'resources', 'prd', '3-technical-plan'), { recursive: true });
  const before = Buffer.from(['| ID | 描述 |', '|---|---|', ''].join('\n'), 'utf8');
  const after = Buffer.from(['| ID | 描述 |', '|---|---|', '| UT-S01-01 | a |', '| UT-S01-02 | b |', ''].join('\n'), 'utf8');
  writeFileSync(join(root, SPEC_REL), after);
  writeFileSync(join(root, OTHER_DOC), '# 架构\n\n这不是测试规格文档。\n');
  const dir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
    type: 'merge_transaction_complete', transaction_id: 'mtx_fixture', seal_sha256: null,
    receipt_sha256: null, completed_at: new Date().toISOString(),
    test_change_set: buildTestChangeSet({
      change: SLUG, module: 'core',
      targets: [{ targetPath: SPEC_REL, beforeBytes: before, afterBytes: after }],
    }),
  }));
  writeFileSync(join(dir, 'tasks.md'), TASKS);
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  const codeFile = join(root, 'code.txt');
  writeFileSync(codeFile, CODE_BODY);
  const write = (name: string, value: unknown) => {
    const p = join(root, name); writeFileSync(p, JSON.stringify(value)); return p;
  };
  return {
    root, dir, codeFile,
    validSlices: write('slices-valid.json', VALID_SLICES),
    invalidSlices: write('slices-invalid.json', INVALID_SLICES),
    tasksPath: join(dir, 'tasks.md'),
    manifestPath: join(dir, 'TEST_SLICE_MANIFEST.json'),
  };
}

function driveTo(fx: ReturnType<typeof setup>, slicesFile: string) {
  if (!readTestSliceTransactionIfPresent(fx.dir)) createTestSliceTransaction(fx.root, fx.dir, SLUG);
  submitTestSliceContent(fx.dir, 'slot_codesection', fx.codeFile);
  submitTestSliceContent(fx.dir, 'slot_slices', slicesFile);
  sealTestSliceTransaction(fx.dir);
}

describe('S32 apply 终态自校验', () => {
  it('UT-S32-59: 业务非法 slot 触发整体回滚，无半写态', () => {
    const fx = setup();
    driveTo(fx, fx.invalidSlices);
    const tasksBefore = readFileSync(fx.tasksPath, 'utf-8');
    expect(existsSync(fx.manifestPath), '前置：manifest 尚未存在').toBe(false);

    let caught: TestSliceTransactionError | null = null;
    try { applyTestSliceTransaction(fx.root, fx.dir); }
    catch (error) { caught = error as TestSliceTransactionError; }

    // 写盘本身会成功——缺陷正是「写盘成功即 completed」。这里必须由自校验拦下。
    expect(caught, 'apply 必须失败：产出被自身判定器判为非法').not.toBeNull();
    expect(caught!.code).toBe('apply_verification_failed');

    // 两产物同时回滚到 apply 前：manifest 原本不存在，回滚后仍不存在
    expect(readFileSync(fx.tasksPath, 'utf-8'), 'tasks.md 未回滚').toBe(tasksBefore);
    expect(existsSync(fx.manifestPath), 'manifest 残留即半写态').toBe(false);

    const tx = readTestSliceTransactionIfPresent(fx.dir)!;
    expect(tx.phase).toBe('failed');
    expect(tx.classification).toBe('recovery_required');
    expect(tx.retryable).toBe(true);
  });

  it('UT-S32-60: violations 保真且修正后可正常抵达 completed', () => {
    const fx = setup();
    driveTo(fx, fx.invalidSlices);
    let caught: TestSliceTransactionError | null = null;
    try { applyTestSliceTransaction(fx.root, fx.dir); }
    catch (error) { caught = error as TestSliceTransactionError; }
    expect(caught).not.toBeNull();

    // 四项字段俱全，可定位到具体的 spec_targets 与 task_text
    const violations = caught!.violations;
    expect(violations.length, 'violations 不得被压缩为空').toBeGreaterThan(0);
    for (const v of violations) {
      expect(v).toHaveProperty('code'); expect(v).toHaveProperty('path');
      expect(v).toHaveProperty('message'); expect(v).toHaveProperty('fix_hint');
    }
    expect(violations.some(v => v.message.includes(OTHER_DOC)), '未点名非法的 spec_target').toBe(true);
    expect(violations.some(v => v.path.includes('task_text')), '未点名不一致的 task_text').toBe(true);
    // 失败投影也带出同一批结论，而非只在异常里可见
    expect(readTestSliceTransactionIfPresent(fx.dir)!.violations).toEqual(violations);

    // 修正 slot 后重提：不需要删除任何 OpenLogos 拥有的文件即可收敛
    submitTestSliceContent(fx.dir, 'slot_slices', fx.validSlices);
    sealTestSliceTransaction(fx.dir);
    const done = applyTestSliceTransaction(fx.root, fx.dir);
    expect(done.phase).toBe('completed');
    expect(done.receipt).not.toBeNull();
    expect(done.violations, 'completed 后不得残留上一轮 violations').toEqual([]);
    expect(deriveSliceVerificationState(fx.root, fx.dir)?.manifest_status).toBe('valid');
  });

  it('ST-S32-20: 真实 CLI 下 violations 保真且可定位到字段', () => {
    const fx = setup();
    const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: fx.root, encoding: 'utf8', timeout: 60000,
    });
    run(['slice', 'transaction', 'submit-content', '--slot', 'slot_codesection', '--file', fx.codeFile]);
    run(['slice', 'transaction', 'submit-content', '--slot', 'slot_slices', '--file', fx.invalidSlices]);
    run(['slice', 'transaction', 'seal']);
    const applied = run(['slice', 'transaction', 'apply', '--format', 'json']);

    expect(applied.status, 'apply 必须以非零退出').not.toBe(0);
    const envelope = JSON.parse(applied.stderr.trim()) as {
      error: { details: { classification: string; violations: Array<Record<string, string>> } };
    };
    expect(envelope.error.details.classification).toBe('apply_verification_failed');
    const violations = envelope.error.details.violations;
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(Object.keys(v).sort()).toEqual(['code', 'fix_hint', 'message', 'path']);
    }
    expect(violations.some(v => v.message.includes(OTHER_DOC))).toBe(true);
    expect(existsSync(fx.manifestPath), '真实 CLI 下同样不得留下半写态').toBe(false);
  });
});
