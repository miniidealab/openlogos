/**
 * fix-next-ensure-initial-plan-slice-transaction 单切片：
 * next 对 initial-plan 切片事务的问即建与投影输出（S28）+ 创建时机前移的消费回归（S32）。
 *
 * 缺陷背景：消费方契约要求派发 slice-planner **之前**由 `next` 输出的 slice_transaction
 * canonical 投影派生写域（投影缺失 fail-closed）；而 initial-plan 事务此前为懒创建——仅在
 * 首次 submit-content 时用即建，`next` 正常 ready-to-implement 路径既不创建也不输出投影。
 * 两条契约拼合 = 鸡生蛋死锁：任何新提案首达 plan-slices 必然 blocked（功能规格 §2.65）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import {
  applyTestSliceTransaction, readTestSliceTransactionIfPresent, sealTestSliceTransaction,
  submitTestSliceContent,
} from '../src/lib/test-slice-transaction.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'stx-ensure';
const SPEC_REL = 'logos/resources/test/core-S01-test-cases.md';
const CODE_BODY = '- [ ] 切片1：第一片（覆盖 UT-S01-01）\n- [ ] 切片2：第二片（覆盖 UT-S01-02）';
const SLICES = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [SPEC_REL] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [SPEC_REL] },
];

interface ModuleProjection {
  detail?: string;
  next_node?: { id?: string };
  slice_transaction?: {
    transaction_id: string; origin: string; phase: string;
    content_slots: { required: number; submitted: number; missing_slot_ids: string[] };
  };
}

/** 构造 spec-complete 且切片未填的 ready-to-implement 提案（首达 plan-slices，无事务文件）。 */
function setupReadyToImplement(options: { codeSection?: boolean; specMerged?: boolean; testDelta?: boolean } = {}) {
  const { codeSection = true, specMerged = true, testDelta = true } = options;
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
  const before = Buffer.from(['| ID | 描述 |', '|---|---|', ''].join('\n'), 'utf8');
  const after = Buffer.from(['| ID | 描述 |', '|---|---|', '| UT-S01-01 | a |', '| UT-S01-02 | b |', ''].join('\n'), 'utf8');
  writeFileSync(join(root, SPEC_REL), after);
  const dir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '# 变更提案：ensure 夹具\n\n## 变更原因\n\n夹具。\n');
  writeFileSync(join(dir, 'PLAN_APPROVED'), '');
  if (specMerged) {
    writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
      type: 'merge_transaction_complete', transaction_id: 'mtx_fixture', seal_sha256: null,
      receipt_sha256: null, completed_at: new Date().toISOString(),
      test_change_set: buildTestChangeSet({
        change: SLUG, module: 'core',
        targets: [{ targetPath: SPEC_REL, beforeBytes: before, afterBytes: after }],
      }),
    }));
  }
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
    ...(codeSection ? ['## [code] 代码实现', '', '（本段在 plan 段留空，由 slice-planner 填写。）', ''] : []),
    '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
  ].join('\n'));
  // 测试 ID 证据：post-merge 阶段按 delta 测试文件 + 已合并规格中的结构化 ID 判定
  if (testDelta) {
    mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'test', 'core-S01-test-cases.md'),
      '## ADDED — 用例\n\n| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n');
  }
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  const codeFile = join(root, 'code.txt');
  const slicesFile = join(root, 'slices.json');
  writeFileSync(codeFile, CODE_BODY);
  writeFileSync(slicesFile, JSON.stringify(SLICES));
  return { root, dir, codeFile, slicesFile, txPath: join(dir, 'TEST_SLICE_TRANSACTION.json') };
}

function runNext(root: string): ModuleProjection {
  const result = spawnSync(process.execPath, [CLI, 'next', '--format', 'json'], {
    cwd: root, encoding: 'utf8', timeout: 60000,
  });
  expect(result.status, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { data: { modules: ModuleProjection[] } }).data.modules[0];
}

describe('S28 initial-plan 问即建', () => {
  it('UT-S28-50: 首达 plan-slices 问即建创建 + 投影', () => {
    const fx = setupReadyToImplement();
    expect(existsSync(fx.txPath), '前置：首达时无事务文件').toBe(false);

    const module = runNext(fx.root);
    expect(module.next_node?.id).toBe('plan-slices');
    const tx = module.slice_transaction;
    expect(tx, 'ready-to-implement 必须携带 slice_transaction 投影').toBeDefined();
    expect(tx!.origin).toBe('initial-plan');
    expect(tx!.phase).toBe('collecting');
    expect(tx!.transaction_id).toMatch(/^stx_/);
    expect(tx!.content_slots.required).toBe(2);
    expect(tx!.content_slots.missing_slot_ids).toEqual(expect.arrayContaining(['slot_codesection', 'slot_slices']));
    expect(existsSync(fx.txPath), '事务文件必须落盘').toBe(true);
  });

  it('UT-S28-51: 幂等重入与既有事务只读（collecting 半程 / completed 终态均不重建）', () => {
    const fx = setupReadyToImplement();
    // ① 首达创建后重跑 → transaction_id 不变
    const first = runNext(fx.root).slice_transaction!;
    const second = runNext(fx.root).slice_transaction!;
    expect(second.transaction_id, '幂等：不得重复创建').toBe(first.transaction_id);
    // ② 已提交 1 slot → 投影反映真实进度，与 slice transaction status 同源
    submitTestSliceContent(fx.dir, 'slot_codesection', fx.codeFile);
    const half = runNext(fx.root).slice_transaction!;
    expect(half.transaction_id).toBe(first.transaction_id);
    expect(half.phase).toBe('collecting');
    expect(half.content_slots.submitted).toBe(1);
    expect(readTestSliceTransactionIfPresent(fx.dir)!.content_slots.submitted).toBe(1);
    // ③ completed 终态 → 只读投影，不归档、不重建
    submitTestSliceContent(fx.dir, 'slot_slices', fx.slicesFile);
    sealTestSliceTransaction(fx.dir);
    expect(applyTestSliceTransaction(fx.root, fx.dir).phase).toBe('completed');
    const done = runNext(fx.root).slice_transaction!;
    expect(done.transaction_id, '终态事务只读输出，不得归档让位重建').toBe(first.transaction_id);
    expect(done.phase).toBe('completed');
    expect(existsSync(join(fx.dir, 'slice-transactions', `${first.transaction_id}.json`)), 'ensure 不得触发终态归档').toBe(false);
  });

  it('UT-S28-52: 失败如实与非触发场景不创建', () => {
    // ① 创建失败（提案目录只读）→ 省略字段 + detail 携错误 + 无半写文件
    const fx = setupReadyToImplement();
    chmodSync(fx.dir, 0o555);
    try {
      const module = runNext(fx.root);
      expect(module.slice_transaction, '创建失败必须省略投影字段').toBeUndefined();
      expect(module.detail ?? '').toContain('切片事务尚不可用');
      expect(existsSync(fx.txPath), '不得留下半写事务文件').toBe(false);
    } finally { chmodSync(fx.dir, 0o755); }
    // ② delta-writing 前沿（无 SPEC_MERGED）→ 不创建、不输出
    const fx2 = setupReadyToImplement({ specMerged: false });
    const m2 = runNext(fx2.root);
    expect(m2.slice_transaction).toBeUndefined();
    expect(existsSync(fx2.txPath)).toBe(false);
    // ③ 无 [code] 标题且无测试 delta 的纯 docs 提案 → 不创建、不输出
    const fx3 = setupReadyToImplement({ codeSection: false, testDelta: false });
    const m3 = runNext(fx3.root);
    expect(m3.slice_transaction).toBeUndefined();
    expect(existsSync(fx3.txPath)).toBe(false);
    // ④ 无活跃提案 → 不创建、不输出
    const fx4 = setupReadyToImplement();
    rmSync(join(fx4.root, 'logos', '.openlogos-guard'));
    const m4 = runNext(fx4.root);
    expect(m4.slice_transaction).toBeUndefined();
    expect(existsSync(fx4.txPath)).toBe(false);
  });

  it('ST-S28-16: 问即建端到端——next 投影 → submit-content 续用 → apply 后投影 completed', () => {
    const fx = setupReadyToImplement();
    const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: fx.root, encoding: 'utf8', timeout: 60000,
    });
    // next 拿到投影（事务 X 落盘）
    const projected = runNext(fx.root).slice_transaction!;
    expect(projected.origin).toBe('initial-plan');
    const txId = projected.transaction_id;
    // slice-planner 按投影提交两 slot → seal → apply，全程只有事务 X
    expect(run(['slice', 'transaction', 'submit-content', '--slot', 'slot_codesection', '--file', fx.codeFile]).status).toBe(0);
    expect(run(['slice', 'transaction', 'submit-content', '--slot', 'slot_slices', '--file', fx.slicesFile]).status).toBe(0);
    expect(readTestSliceTransactionIfPresent(fx.dir)!.transaction_id, '续用同一事务，不得重建').toBe(txId);
    expect(run(['slice', 'transaction', 'seal']).status).toBe(0);
    expect(run(['slice', 'transaction', 'apply']).status).toBe(0);
    expect(readTestSliceTransactionIfPresent(fx.dir)!.transaction_id).toBe(txId);
    // 产物原子落盘 + 再跑 next 投影 completed
    expect(readFileSync(join(fx.dir, 'tasks.md'), 'utf-8')).toContain('切片1：第一片');
    expect(existsSync(join(fx.dir, 'TEST_SLICE_MANIFEST.json'))).toBe(true);
    const done = runNext(fx.root).slice_transaction!;
    expect(done.transaction_id).toBe(txId);
    expect(done.phase).toBe('completed');
  });
});

describe('S32 创建时机前移消费回归', () => {
  it('UT-S32-71: next 已建后 submit-content 幂等续用', () => {
    const fx = setupReadyToImplement();
    const txId = runNext(fx.root).slice_transaction!.transaction_id;
    const after = submitTestSliceContent(fx.dir, 'slot_codesection', fx.codeFile);
    expect(after.transaction_id, '用即建条件不成立时必须续用同一事务').toBe(txId);
    expect(after.phase).toBe('collecting');
    expect(after.content_slots.submitted).toBe(1);
    // 后续 seal/apply 合同零变化
    submitTestSliceContent(fx.dir, 'slot_slices', fx.slicesFile);
    sealTestSliceTransaction(fx.dir);
    const completed = applyTestSliceTransaction(fx.root, fx.dir);
    expect(completed.phase).toBe('completed');
    expect(completed.transaction_id).toBe(txId);
  });

  it('UT-S32-72: 懒创建路径零回归——无 next 前置时 submit-content 仍用即建', () => {
    const fx = setupReadyToImplement();
    expect(existsSync(fx.txPath)).toBe(false);
    const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: fx.root, encoding: 'utf8', timeout: 60000,
    });
    expect(run(['slice', 'transaction', 'submit-content', '--slot', 'slot_codesection', '--file', fx.codeFile]).status).toBe(0);
    const tx = readTestSliceTransactionIfPresent(fx.dir)!;
    expect(tx.origin).toBe('initial-plan');
    expect(tx.content_slots.submitted).toBe(1);
    expect(run(['slice', 'transaction', 'submit-content', '--slot', 'slot_slices', '--file', fx.slicesFile]).status).toBe(0);
    expect(run(['slice', 'transaction', 'seal']).status).toBe(0);
    expect(run(['slice', 'transaction', 'apply']).status).toBe(0);
    expect(readTestSliceTransactionIfPresent(fx.dir)!.phase).toBe('completed');
  });
});
