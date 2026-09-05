import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  abortMergeTransaction,
  createMergeTransaction,
  listMergeTransactionPlanTargets,
  readMergeTransaction,
} from '../src/lib/merge-transaction.js';
import { detectProposalStepViaFlow } from '../src/lib/flow-derive.js';
import { loadBuiltinFlow } from '../src/lib/flow.js';
import {
  cleanupFixtureRoots,
  driveToPhase,
  driveToPhase2Apply,
  frontierFixture,
  invoke,
  invokeJson,
  put,
} from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

describe('merge 前沿事务事实 — S05/S09（fix-merge-flow-transaction-contract 切片1）', () => {
  it('UT-S05-52: 开事务后前沿立即推进 merge-generated，next 派 apply-merge', () => {
    const f = frontierFixture();
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('ready-to-merge');
    createMergeTransaction(f.root, f.proposalDir, f.slug);
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
    const next = invokeJson(['next'], f.root);
    const moduleItem = next.data.modules?.[0] ?? next.data;
    expect(moduleItem.proposal_step ?? next.data.proposal_step).toBe('merge-generated');
    expect((moduleItem.next_node ?? next.data.next_node).id).toBe('apply-merge');
  });

  it('UT-S05-53: 各相位下前沿恒 merge-generated 且投影 next_action 与事务一致', () => {
    for (const [phase, expectedAction] of [['collecting', 'submit_content'], ['ready', 'seal'], ['sealed', 'apply']] as const) {
      const f = frontierFixture();
      const tx = driveToPhase(f, phase);
      expect(tx.phase).toBe(phase);
      expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
      const next = invokeJson(['next'], f.root);
      expect(next.data.merge_transaction.phase).toBe(phase);
      expect(next.data.merge_transaction.next_action).toBe(expectedAction);
    }
  });

  it('UT-S05-54: next 投影与 merge transaction status 同快照逐字段一致', () => {
    const f = frontierFixture();
    driveToPhase(f, 'ready');
    const viaNext = invokeJson(['next'], f.root).data.merge_transaction;
    const viaStatusCmd = invokeJson(['merge', 'transaction', 'status', '--slug', f.slug], f.root).data.merge_transaction;
    expect(viaNext).toEqual(viaStatusCmd);
  });

  it('UT-S05-55: failed（aborted）相位不冻结前沿，投影按 classification 给出出路', () => {
    const f = frontierFixture();
    driveToPhase(f, 'collecting');
    const aborted = abortMergeTransaction(f.proposalDir);
    expect(aborted.phase).toBe('failed');
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
    const next = invokeJson(['next'], f.root);
    expect(next.data.merge_transaction.phase).toBe('failed');
    expect(next.data.merge_transaction.allowed_actions).toContain('abort');
  });

  it('ST-S05-24: 真实 CLI 全链前沿推进（merge→apply-merge→apply→越过 merge 段）', () => {
    const f = frontierFixture();
    const merge = invoke(['merge', f.slug], f.root);
    expect(merge.status, merge.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'))).toBe(true);
    const mid = invokeJson(['next'], f.root);
    expect((mid.data.modules?.[0] ?? mid.data).proposal_step ?? mid.data.proposal_step).toBe('merge-generated');
    driveToPhase2Apply(f);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
    const after = invokeJson(['next'], f.root);
    const step = (after.data.modules?.[0] ?? after.data).proposal_step ?? after.data.proposal_step;
    expect(step).not.toBe('merge-generated');
    expect(step).not.toBe('ready-to-merge');
  });

  it('ST-S05-25: 非终态重跑 merge 幂等返回，前沿不回退、无第二事务', () => {
    const f = frontierFixture();
    const first = invoke(['merge', f.slug], f.root);
    expect(first.status).toBe(0);
    const txId = readMergeTransaction(f.proposalDir).transaction_id;
    const second = invoke(['merge', f.slug], f.root);
    expect(second.status).toBe(0);
    expect(readMergeTransaction(f.proposalDir).transaction_id).toBe(txId);
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
  });

  it('UT-S09-303: flow-derive 事务判据——事务在盘任意相位 merge-generated；皆无则 ready-to-merge', () => {
    const f = frontierFixture();
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('ready-to-merge');
    driveToPhase(f, 'sealed');
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
  });

  it('UT-S09-304: 判据两处同源——launched.yaml done_when 列表与 flow-derive 对同一 fixture 同判', () => {
    const flow = loadBuiltinFlow('launched');
    const node = flow.subflows.find(s => s.id === 'merge')!.nodes.find(n => n.id === 'generate-merge-prompt')!;
    const doneWhen = String(node.done_when);
    expect(doneWhen).toContain('MERGE_TRANSACTION.json');
    expect(doneWhen).toContain('MERGE_PROMPT_GENERATED');
    expect(doneWhen).toContain('MERGE_PROMPT.md');
    expect(node.dispatch?.artifacts_hint).toContain('MERGE_TRANSACTION.json');
    // flow-derive 消费同一 done_when（anyPresentList 动态解析）：逐 marker fixture 同判
    for (const marker of ['MERGE_TRANSACTION.json', 'MERGE_PROMPT_GENERATED', 'MERGE_PROMPT.md']) {
      const f = frontierFixture();
      put(f.root, `logos/changes/${f.slug}/${marker}`, marker.endsWith('.json') ? '{}' : '');
      expect(detectProposalStepViaFlow(f.proposalDir), marker).toBe('merge-generated');
    }
  });

  it('UT-S09-305: legacy marker 兼容——仅 MERGE_PROMPT marker 在场同样推进（0.13.x 合同不破）', () => {
    const f = frontierFixture();
    put(f.root, `logos/changes/${f.slug}/MERGE_PROMPT_GENERATED`, '');
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
  });

  it('UT-S09-306: 后置条件二分——no-delta 当场 SPEC_MERGED；有 delta 开事务且 SPEC_MERGED 不在场', () => {
    const noDelta = frontierFixture(false);
    const r1 = invoke(['merge', noDelta.slug], noDelta.root);
    expect(r1.status, r1.stderr).toBe(0);
    expect(existsSync(join(noDelta.proposalDir, 'SPEC_MERGED'))).toBe(true);
    // 生产 no-delta 同样经事务落 receipt，但当场完成（phase=completed）——「当场写 SPEC_MERGED、前沿即进」成立
    expect(readMergeTransaction(noDelta.proposalDir).phase).toBe('completed');
    expect(detectProposalStepViaFlow(noDelta.proposalDir)).not.toBe('merge-generated');

    const withDelta = frontierFixture();
    const r2 = invoke(['merge', withDelta.slug], withDelta.root);
    expect(r2.status, r2.stderr).toBe(0);
    expect(existsSync(join(withDelta.proposalDir, 'MERGE_TRANSACTION.json'))).toBe(true);
    expect(existsSync(join(withDelta.proposalDir, 'SPEC_MERGED'))).toBe(false);
  });

  it('UT-S09-307: merge（有 delta）收尾提示为事务引导，不含 MERGE_PROMPT.md 指向', () => {
    const f = frontierFixture();
    const result = invoke(['merge', f.slug], f.root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('submit-content');
    expect(result.stdout).toContain('seal');
    expect(result.stdout).toContain('apply');
    expect(result.stdout).not.toContain('MERGE_PROMPT.md');
    // 幂等重跑提示体现现状（phase/next_action 在场）
    const rerun = invoke(['merge', f.slug], f.root);
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain('phase');
  });

  it('ST-S09-116: 生产链路无死区——每步 proposal_step 与磁盘事实一致', () => {
    const f = frontierFixture();
    expect(invoke(['merge', f.slug], f.root).status).toBe(0);
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
    let tx = readMergeTransaction(f.proposalDir);
    for (const target of listMergeTransactionPlanTargets(f.proposalDir)) {
      const descriptor = tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
      const staging = join(f.root, descriptor.staging_path);
      mkdirSync(dirname(staging), { recursive: true });
      writeFileSync(staging, f.finals[target.target_path]);
      expect(invoke(['merge', 'transaction', 'submit-content', '--slug', f.slug, '--slot', target.slot_id, '--file', staging], f.root).status).toBe(0);
      tx = readMergeTransaction(f.proposalDir);
    }
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
    expect(invoke(['merge', 'transaction', 'seal', '--slug', f.slug], f.root).status).toBe(0);
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
    expect(invoke(['merge', 'transaction', 'apply', '--slug', f.slug], f.root).status).toBe(0);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
    expect(readFileSync(join(f.root, f.targetPath), 'utf8')).toContain('新定义');
    expect(detectProposalStepViaFlow(f.proposalDir)).not.toBe('merge-generated');
  });

  it('ST-S09-117: 终态协同——abort 后重跑归档让位重建前沿仍 merge-generated；越权删事务文件回退 ready-to-merge', () => {
    const f = frontierFixture();
    expect(invoke(['merge', f.slug], f.root).status).toBe(0);
    const oldId = readMergeTransaction(f.proposalDir).transaction_id;
    abortMergeTransaction(f.proposalDir);
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
    expect(invoke(['merge', f.slug], f.root).status).toBe(0);
    const rebuilt = readMergeTransaction(f.proposalDir);
    // transaction_id 由 plan/target set 确定性派生：delta 未变时重建得同 id；重建证据 = 旧事务已归档 + phase 回 collecting
    expect(existsSync(join(f.proposalDir, 'merge-transactions', `${oldId}.json`))).toBe(true);
    expect(rebuilt.phase).toBe('collecting');
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('merge-generated');
    // 越权手删（仅测试模拟）：事实消失 → 前沿如实回退
    rmSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'));
    expect(detectProposalStepViaFlow(f.proposalDir)).toBe('ready-to-merge');
  });
});

