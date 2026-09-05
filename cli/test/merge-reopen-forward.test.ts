import { afterAll, describe, expect, it } from 'vitest';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MergeTransactionError,
  readMergeTransaction,
  reopenMergeTransaction,
  sealMergeTransaction,
} from '../src/lib/merge-transaction.js';
import { forwardMergeTestChangeSets, type TestChangeSetV1 } from '../src/lib/test-change-set.js';
import {
  cleanupFixtureRoots,
  driveToPhase,
  driveToPhase2Apply,
  frontierFixture,
  invoke,
  put,
} from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

function specMergedChangeSet(proposalDir: string): { changed_test_ids: string[]; removed_test_ids: string[]; targets: Array<{ before_sha256: string | null; after_sha256: string }>; sha256: string } {
  return JSON.parse(readFileSync(join(proposalDir, 'SPEC_MERGED'), 'utf8')).test_change_set;
}

/** 首轮完整 merge → reopen → 幂等重提交所有 slot（磁盘已是合并态，快照 diff 为空）。 */
function reopenAndResubmitIdempotent(f: ReturnType<typeof frontierFixture>) {
  driveToPhase(f, 'completed');
  reopenMergeTransaction(f.root, f.proposalDir, f.slug, { reason: '修正非测试目标', confirmSpecMerged: true });
  return readMergeTransaction(f.proposalDir);
}

describe('reopen 后 test change set 前滚合并 — S09（fix-reopen-test-change-set-forward-merge 切片1）', () => {
  it('UT-S09-309: 前滚合并规则——changed 前滚并集、removed 后写胜出、恒不相交且 ASCII 排序去重', () => {
    const current = {
      schema: 'openlogos/test-change-set@1', change: 'c', module: 'core', source: 'semantic-before-after-diff',
      changed_test_ids: ['UT-S01-03'], removed_test_ids: ['UT-S01-09'],
      targets: [{ target_path: 'logos/resources/test/core-S01-test-cases.md', before_sha256: null, after_sha256: 'sha256:0'.padEnd(71, '0') }],
      sha256: 'sha256:0'.padEnd(71, '0'),
    } as unknown as TestChangeSetV1;
    // 祖先 changed=[A,B]（B 在本轮幂等零变化）；祖先还 changed 了 UT-S01-09，本轮 removed 之 → 后写胜出
    const merged = forwardMergeTestChangeSets(current, [
      { changed_test_ids: ['UT-S01-01', 'UT-S01-02', 'UT-S01-09'], removed_test_ids: [] },
    ]);
    expect(merged.changed_test_ids).toEqual(['UT-S01-01', 'UT-S01-02', 'UT-S01-03']);
    expect(merged.removed_test_ids).toEqual(['UT-S01-09']);
    expect(merged.changed_test_ids.filter(id => merged.removed_test_ids.includes(id))).toEqual([]);
    // 反向：祖先 removed 的 ID 被本轮重新 changed → 从 removed 移除
    const revived = forwardMergeTestChangeSets(current, [
      { changed_test_ids: [], removed_test_ids: ['UT-S01-03'] },
    ]);
    expect(revived.changed_test_ids).toContain('UT-S01-03');
    expect(revived.removed_test_ids).toEqual(['UT-S01-09']);
    // 空祖先：原对象原样返回（逐字节不变的基础保证）
    expect(forwardMergeTestChangeSets(current, [])).toBe(current);
  });

  it('UT-S09-310: 边界——abort 祖先跳过、null 记空集、targets 保持当前快照且 sha 重算', () => {
    const f = frontierFixture();
    reopenAndResubmitIdempotent(f);
    // 模拟 abort 祖先（留痕行指向无 receipt 的归档）与 null change set 祖先
    appendFileSync(join(f.proposalDir, 'MERGE_REOPENS.jsonl'),
      `${JSON.stringify({ schema: 'openlogos/merge-reopen@1', old_transaction_id: 'mtx_deadbeefdeadbeefdeadbeef', reopened_at: new Date().toISOString(), reason: 'abort 祖先', spec_merged_present: false, confirmed: false })}\n`);
    writeFileSync(join(f.proposalDir, 'merge-transactions', 'mtx_nullcs000000000000000000.receipt.json'),
      `${JSON.stringify({ test_change_set: null })}\n`);
    appendFileSync(join(f.proposalDir, 'MERGE_REOPENS.jsonl'),
      `${JSON.stringify({ schema: 'openlogos/merge-reopen@1', old_transaction_id: 'mtx_nullcs000000000000000000', reopened_at: new Date().toISOString(), reason: 'null change set 祖先', spec_merged_present: false, confirmed: false })}\n`);
    driveToPhase2Apply(f);
    const cs = specMergedChangeSet(f.proposalDir);
    // 幂等重合并（本轮快照 diff 为空）+ 前滚祖先 → 首轮 ID 保持提案级完整
    expect(cs.changed_test_ids).toEqual(['UT-S01-01']);
    expect(cs.removed_test_ids).toEqual([]);
    // targets 保持当前快照：幂等目标 before==after；sha 为重算合法格式
    for (const target of cs.targets) expect(target.before_sha256).toBe(target.after_sha256);
    expect(cs.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('UT-S09-311: 祖先身份失配 / 留痕损坏 fail-closed——点名路径、不降级为快照 diff', () => {
    // 身份失配
    const bad = frontierFixture();
    const tx = reopenAndResubmitIdempotent(bad);
    void tx;
    const archived = readFileSync(join(bad.proposalDir, 'MERGE_REOPENS.jsonl'), 'utf8').trim().split('\n')
      .map(line => JSON.parse(line).old_transaction_id as string);
    const receiptPath = join(bad.proposalDir, 'merge-transactions', `${archived[0]}.receipt.json`);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    receipt.test_change_set.change = 'other-change';
    writeFileSync(receiptPath, JSON.stringify(receipt));
    driveToPhase2Apply(bad, { stopBeforeSeal: true });
    let caught: unknown;
    try { sealMergeTransaction(bad.root, bad.proposalDir); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(MergeTransactionError);
    expect((caught as MergeTransactionError).message).toContain('身份失配');
    expect((caught as MergeTransactionError).message).toContain(`${archived[0]}.receipt.json`);

    // 留痕行损坏
    const corrupt = frontierFixture();
    reopenAndResubmitIdempotent(corrupt);
    appendFileSync(join(corrupt.proposalDir, 'MERGE_REOPENS.jsonl'), '{ broken line\n');
    driveToPhase2Apply(corrupt, { stopBeforeSeal: true });
    let caught2: unknown;
    try { sealMergeTransaction(corrupt.root, corrupt.proposalDir); } catch (error) { caught2 = error; }
    expect(caught2).toBeInstanceOf(MergeTransactionError);
    expect((caught2 as MergeTransactionError).message).toContain('留痕行损坏');
    expect((caught2 as MergeTransactionError).message).toContain('MERGE_REOPENS.jsonl');
  });

  it('UT-S09-312: 无留痕逐字节不变；preflight test_change_set_sha256 与 SPEC_MERGED 同源', () => {
    // 无留痕：正常全链后 marker 不受前滚通道影响（与 0.14.19 语义一致）
    const plain = frontierFixture();
    driveToPhase(plain, 'completed');
    expect(existsSync(join(plain.proposalDir, 'MERGE_REOPENS.jsonl'))).toBe(false);
    const cs = specMergedChangeSet(plain.proposalDir);
    expect(cs.changed_test_ids).toEqual(['UT-S01-01']);
    // 同源：reopen 重合并后 sealed preflight 摘要 == marker sha256
    const f = frontierFixture();
    reopenAndResubmitIdempotent(f);
    driveToPhase2Apply(f);
    const stored = JSON.parse(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'));
    expect(stored.preflight?.test_change_set_sha256).toBe(specMergedChangeSet(f.proposalDir).sha256);
    expect(specMergedChangeSet(f.proposalDir).changed_test_ids).toEqual(['UT-S01-01']);
  });

  it('ST-S09-118: 真实 CLI 全链——reopen 后部分幂等重合并，changed 保持提案级完整', () => {
    const f = frontierFixture();
    // 首轮全链（真实命令）
    expect(invoke(['merge', f.slug], f.root).status).toBe(0);
    driveToPhase2Apply(f);
    expect(specMergedChangeSet(f.proposalDir).changed_test_ids).toEqual(['UT-S01-01']);
    // 仅修正非测试目标：需求 delta 内容变化在 reopen 前落盘（事务创建时冻结 delta 哈希），其余幂等
    put(f.root, `logos/changes/${f.slug}/deltas/prd/1-product-requirements/core-01-requirements.md`,
      '## MODIFIED — 一、判据\n\n修正后的正文。\n');
    f.finals['logos/resources/prd/1-product-requirements/core-01-requirements.md'] =
      f.finals['logos/resources/prd/1-product-requirements/core-01-requirements.md'].replace('新正文。', '修正后的正文。');
    // reopen（真实命令）
    const reopen = invoke(['merge', 'transaction', 'reopen', '--slug', f.slug, '--reason', '修正需求描述', '--confirm-spec-merged'], f.root);
    expect(reopen.status, reopen.stderr).toBe(0);
    driveToPhase2Apply(f);
    const cs = specMergedChangeSet(f.proposalDir);
    expect(cs.changed_test_ids).toEqual(['UT-S01-01']);
    expect(cs.removed_test_ids).toEqual([]);
    expect(readFileSync(join(f.root, 'logos/resources/prd/1-product-requirements/core-01-requirements.md'), 'utf8')).toContain('修正后的正文。');
  });

  it('ST-S09-119: 多次 reopen 链式前滚——第二次重合并后 changed 仍提案级完整', () => {
    const f = frontierFixture();
    driveToPhase(f, 'completed');
    // 第一次 reopen + 幂等重合并
    reopenMergeTransaction(f.root, f.proposalDir, f.slug, { reason: '第一次修正', confirmSpecMerged: true });
    driveToPhase2Apply(f);
    expect(specMergedChangeSet(f.proposalDir).changed_test_ids).toEqual(['UT-S01-01']);
    // 第二次 reopen：修正另一个非测试目标（delta 先落盘再 reopen），测试目标继续幂等
    put(f.root, `logos/changes/${f.slug}/deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md`,
      '## MODIFIED — 一、判据\n\n二次修正正文。\n');
    f.finals['logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md'] =
      f.finals['logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md'].replace(/新正文。|修正后的正文。/, '二次修正正文。');
    reopenMergeTransaction(f.root, f.proposalDir, f.slug, { reason: '第二次修正', confirmSpecMerged: true });
    driveToPhase2Apply(f);
    const cs = specMergedChangeSet(f.proposalDir);
    expect(cs.changed_test_ids).toEqual(['UT-S01-01']);
    // 留痕两行、归档 receipt 两份（链式 lineage 完整）
    const lines = readFileSync(join(f.proposalDir, 'MERGE_REOPENS.jsonl'), 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
  });
});
