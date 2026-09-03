/**
 * 切片2：恢复事务与 next 集成。
 * 覆盖 UT-S32-56、ST-S32-19、UT-S28-45、UT-S28-46。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import {
  TestSliceTransactionError, applyTestSliceTransaction, createTestSliceTransaction,
  ensureManifestRecoveryTransaction, isManifestRecoveryReason,
  readTestSliceTransactionIfPresent, sealTestSliceTransaction, submitTestSliceContent,
} from '../src/lib/test-slice-transaction.js';
import { deriveSliceVerificationState } from '../src/lib/test-slice-manifest.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'stx-rec';

const CODE_BODY = '- [ ] 切片1：第一片（覆盖 UT-S01-01）\n- [ ] 切片2：第二片（覆盖 UT-S01-02）';
const SLICES = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: ['logos/resources/test/core-S01-test-cases.md'] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: ['logos/resources/test/core-S01-test-cases.md'] },
];
const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', CODE_BODY, '',
  '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
].join('\n');

/** 造一个已完成 initial-plan 的提案，再按需破坏 manifest 形成失效态。 */
function setup(breakage: 'none' | 'missing' | 'invalid' = 'none') {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
  const specRel = 'logos/resources/test/core-S01-test-cases.md';
  const before = Buffer.from(['| ID | 描述 |', '|---|---|', ''].join('\n'), 'utf8');
  const after = Buffer.from(['| ID | 描述 |', '|---|---|', '| UT-S01-01 | a |', '| UT-S01-02 | b |', ''].join('\n'), 'utf8');
  writeFileSync(join(root, specRel), after);
  const dir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(dir, { recursive: true });
  // 用 CLI 自己的构造器造 change set——手写 canonical 形状会造出无效夹具（manifest 恒 invalid）。
  writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
    type: 'merge_transaction_complete', transaction_id: 'mtx_fixture', seal_sha256: null,
    receipt_sha256: null, completed_at: new Date().toISOString(),
    test_change_set: buildTestChangeSet({
      change: SLUG, module: 'core',
      targets: [{ targetPath: specRel, beforeBytes: before, afterBytes: after }],
    }),
  }));
  writeFileSync(join(dir, 'tasks.md'), TASKS);
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  const codeFile = join(root, 'code.txt');
  const slicesFile = join(root, 'slices.json');
  writeFileSync(codeFile, CODE_BODY);
  writeFileSync(slicesFile, JSON.stringify(SLICES));

  // 先跑完一次 initial-plan，得到合法的两产物
  createTestSliceTransaction(root, dir, SLUG);
  submitTestSliceContent(dir, 'slot_codesection', codeFile);
  submitTestSliceContent(dir, 'slot_slices', slicesFile);
  sealTestSliceTransaction(dir);
  applyTestSliceTransaction(root, dir);
  // 事务停在 completed 且**文件保留在场**。此前这里 rmSync 掉 TEST_SLICE_TRANSACTION.json
  // 来「模拟新一轮」——那一步删除正是缺陷报告所指的人工绕过（消费方去改 OpenLogos 拥有的
  // 文件），把它写进前提会让「终态不占活跃名额」这条约束在测试中天然不可见。

  const manifestPath = join(dir, 'TEST_SLICE_MANIFEST.json');
  if (breakage === 'missing') rmSync(manifestPath, { force: true });
  if (breakage === 'invalid') writeFileSync(manifestPath, '{"schema":"openlogos/test-slice-manifest@1"}');
  return { root, dir, codeFile, slicesFile, manifestPath };
}

describe('S32 恢复事务', () => {
  it('UT-S32-56: 恢复事务 slot 收窄且 [code] 冻结', () => {
    const f = setup('invalid');
    const tx = ensureManifestRecoveryTransaction(f.root, f.dir, SLUG)!;
    expect(tx.origin).toBe('manifest-recovery');
    // required 收窄为仅 slot_slices
    expect(tx.content_slots.required).toBe(1);
    expect(tx.content_slots.missing_slot_ids).toEqual(['slot_slices']);
    // [code] 段冻结——提交 slot_codesection 被拒
    expect(() => submitTestSliceContent(f.dir, 'slot_codesection', f.codeFile))
      .toThrow(TestSliceTransactionError);

    const codeBefore = readFileSync(join(f.dir, 'tasks.md'), 'utf8');
    submitTestSliceContent(f.dir, 'slot_slices', f.slicesFile);
    sealTestSliceTransaction(f.dir);
    applyTestSliceTransaction(f.root, f.dir);
    // 仅 manifest 被重写，tasks.md 字节恒等
    expect(readFileSync(join(f.dir, 'tasks.md'), 'utf8')).toBe(codeBefore);
    expect(deriveSliceVerificationState(f.root, f.dir)!.manifest_status).toBe('valid');
  });

  it('ST-S32-19: 真实 CLI 下恢复全链与写动作白名单', () => {
    const f = setup('missing');
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, [CLI, 'slice', 'transaction', ...args], { cwd: f.root, encoding: 'utf8', timeout: 120000 });

    // ① next 创建恢复事务并在投影中给出 canonical 身份
    const next = spawnSync(process.execPath, [CLI, 'next', '--format', 'json'], { cwd: f.root, encoding: 'utf8', timeout: 120000 });
    const projection = readTestSliceTransactionIfPresent(f.dir);
    expect(projection?.origin).toBe('manifest-recovery');
    expect(`${next.stdout}`).toContain('manifest-recovery');

    // ② 提交收窄后的 slot → seal → apply
    expect(cli('submit-content', '--slot', 'slot_slices', '--file', f.slicesFile).status).toBe(0);
    expect(cli('seal').status).toBe(0);
    const codeBefore = readFileSync(join(f.dir, 'tasks.md'), 'utf8');
    expect(cli('apply').status).toBe(0);
    expect(readFileSync(join(f.dir, 'tasks.md'), 'utf8')).toBe(codeBefore);

    // ③ 已 completed：写动作不在 allowed_actions 内，被拒且无副作用
    const manifestBytes = readFileSync(f.manifestPath, 'utf8');
    const rejected = cli('submit-content', '--slot', 'slot_slices', '--file', f.slicesFile);
    expect(rejected.status).not.toBe(0);
    expect(`${rejected.stdout}${rejected.stderr}`).toContain('action_not_allowed');
    expect(readFileSync(f.manifestPath, 'utf8')).toBe(manifestBytes);
  });
});

describe('S28 恢复节点创建事务', () => {
  it('UT-S28-45: 三种失效态均创建恢复事务', () => {
    for (const reason of ['test-slice-manifest-missing', 'test-slice-manifest-invalid', 'test-slice-manifest-stale']) {
      expect(isManifestRecoveryReason(reason), reason).toBe(true);
    }
    for (const breakage of ['missing', 'invalid'] as const) {
      const f = setup(breakage);
      const state = deriveSliceVerificationState(f.root, f.dir);
      expect(isManifestRecoveryReason(state?.reason), `${breakage} 应为失效态`).toBe(true);
      const tx = ensureManifestRecoveryTransaction(f.root, f.dir, SLUG);
      expect(tx, `${breakage} 应创建恢复事务`).not.toBeNull();
      expect(tx!.origin).toBe('manifest-recovery');
      // 携带 canonical 身份，消费方不需自算
      expect(tx!.transaction_id).toMatch(/^stx_[0-9a-f]{24}$/);
    }
  });

  it('UT-S28-46: 无失效态不创建；已有事务则幂等', () => {
    // manifest 合法 → 不创建。注意此时磁盘上仍有那个 completed 的 initial-plan 事务，
    // 断言的是「没有新建恢复事务」，而不是「目录里没有事务文件」——后者只在夹具
    // 预先删除事务文件时才成立，那正是要消除的人工绕过。
    const ok = setup('none');
    expect(isManifestRecoveryReason(deriveSliceVerificationState(ok.root, ok.dir)?.reason)).toBe(false);
    expect(ensureManifestRecoveryTransaction(ok.root, ok.dir, SLUG)).toBeNull();
    const untouched = readTestSliceTransactionIfPresent(ok.dir)!;
    expect(untouched.phase).toBe('completed');
    expect(untouched.origin).toBe('initial-plan');

    // 已有活跃事务 → 幂等返回同一 id，不产生第二个
    const broken = setup('invalid');
    const first = ensureManifestRecoveryTransaction(broken.root, broken.dir, SLUG)!;
    const second = ensureManifestRecoveryTransaction(broken.root, broken.dir, SLUG)!;
    expect(second.transaction_id).toBe(first.transaction_id);
    expect(isManifestRecoveryReason('some-other-reason')).toBe(false);
  });
});
