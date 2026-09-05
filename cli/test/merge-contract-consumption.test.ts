import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  abortMergeTransaction,
  MergeTransactionError,
  listMergeTransactionPlanTargets,
  readMergeTransaction,
  sealMergeTransaction,
  submitMergeContent,
} from '../src/lib/merge-transaction.js';
import { TRANSIENT_STATUS_ERROR_CODES, VERSION } from '../src/lib/json-output.js';
import {
  cleanupFixtureRoots,
  driveToPhase,
  frontierFixture,
  invoke,
  invokeJson,
  put,
} from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

/** 把 fixture 的事务文件篡改为「旧版 CLI 创建」形态（摘要失配）——仅测试构造存量事务。 */
function staleContract(proposalDir: string) {
  const path = join(proposalDir, 'MERGE_TRANSACTION.json');
  const tx = JSON.parse(readFileSync(path, 'utf8'));
  tx.schema_sha256 = `sha256:${'6'.repeat(64)}`;
  tx.contract_sha256 = `sha256:${'5'.repeat(64)}`;
  writeFileSync(path, `${JSON.stringify(tx, null, 2)}\n`);
  return tx;
}

describe('merge 事务投影必挂与错误码合同 — S16/S09（fix-merge-flow-transaction-contract 切片2）', () => {
  it('UT-S16-38: 活跃事务在场时 status/next 的 data.merge_transaction 必挂；无事务时字段省略', () => {
    const f = frontierFixture();
    for (const cmd of ['status', 'next']) {
      expect(invokeJson([cmd], f.root).data.merge_transaction, `${cmd} 无事务`).toBeUndefined();
    }
    const tx = driveToPhase(f, 'collecting');
    for (const cmd of ['status', 'next']) {
      const projection = invokeJson([cmd], f.root).data.merge_transaction;
      expect(projection, `${cmd} 必挂`).toBeDefined();
      expect(projection.transaction_id).toBe(tx.transaction_id);
      expect(projection.phase).toBe('collecting');
    }
  });

  it('UT-S16-39: status 投影与 merge transaction status 同快照逐字段一致，next 不改写事务动作', () => {
    const f = frontierFixture();
    driveToPhase(f, 'sealed');
    const viaStatus = invokeJson(['status'], f.root).data.merge_transaction;
    const viaNext = invokeJson(['next'], f.root).data.merge_transaction;
    const viaTxStatus = invokeJson(['merge', 'transaction', 'status', '--slug', f.slug], f.root).data.merge_transaction;
    expect(viaStatus).toEqual(viaTxStatus);
    expect(viaNext).toEqual(viaTxStatus);
    expect(viaNext.allowed_actions).toEqual(viaTxStatus.allowed_actions);
    expect(viaNext.next_action).toBe('apply');
  });

  it('UT-S16-40: 失败路径结构化错误码——baseline 锁硬报稳定码；损坏输入容错为结构化 success envelope（无一无声退化）', () => {
    // 失败路径①：baseline commit 锁被其它活 writer 持有 → stderr error envelope + 稳定码（瞬态类）
    const locked = frontierFixture();
    // 恢复门只对 adopted 模块启用——把 fixture 标记为 adopted，并以其它活进程（ppid）持锁
    put(locked.root, 'logos/logos-project.yaml',
      'project:\n  name: F\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: partial\n    product_type: cli\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
    const runsDir = join(locked.root, 'logos', 'resources', 'verify', 'baseline-seed-runs');
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(join(runsDir, 'core.commit.lock'),
      JSON.stringify({ pid: process.ppid, at: Date.now(), token: `other-${process.ppid}` }));
    for (const cmd of ['status', 'next']) {
      const result = invoke([cmd, '--format', 'json'], locked.root);
      expect(result.status, cmd).not.toBe(0);
      const envelope = JSON.parse(result.stderr.trim().split('\n').pop()!);
      expect(envelope.error.code, cmd).toBe('baseline_commit_in_progress');
      expect(TRANSIENT_STATUS_ERROR_CODES).toContain(envelope.error.code);
    }
    // 损坏输入路径：合同只允许两种结构化形态——容错（exit 0 + success envelope）或
    // 结构化报错（exit≠0 + stderr error envelope 携带稳定 error.code）；禁止无码纯文本退化。
    for (const breaker of [
      (f: ReturnType<typeof frontierFixture>) => put(f.root, 'logos/.openlogos-guard', '{ broken'),
      (f: ReturnType<typeof frontierFixture>) => put(f.root, 'logos/flow/launched.yaml', '{{{{not yaml'),
    ]) {
      const f = frontierFixture();
      breaker(f);
      for (const cmd of ['status', 'next']) {
        const result = invoke([cmd, '--format', 'json'], f.root);
        if (result.status === 0) {
          const envelope = JSON.parse(result.stdout.trim().split('\n').pop()!);
          expect(envelope.data, `${cmd} 容错形态`).toBeDefined();
        } else {
          const envelope = JSON.parse(result.stderr.trim().split('\n').pop()!);
          expect(typeof envelope.error?.code, `${cmd} 报错形态必须带稳定码`).toBe('string');
          expect(envelope.error.code.length, cmd).toBeGreaterThan(0);
        }
      }
    }
  });

  it('UT-S16-41: 瞬态错误码集合稳定——增删必须显式过本快照（合同版本绑定）', () => {
    expect([...TRANSIENT_STATUS_ERROR_CODES]).toEqual(['baseline_commit_in_progress']);
  });

  it('UT-S09-308: 存量事务合同失配 fail-closed——稳定码、双方摘要、remediation、retryable:false；abort 仍放行（出路）', () => {
    const f = frontierFixture();
    driveToPhase(f, 'ready');
    const stale = staleContract(f.proposalDir);
    let caught: MergeTransactionError | null = null;
    try {
      sealMergeTransaction(f.root, f.proposalDir);
    } catch (error) {
      caught = error as MergeTransactionError;
    }
    expect(caught).toBeInstanceOf(MergeTransactionError);
    expect(caught!.classification).toBe('unsupported_contract');
    expect(caught!.retryable).toBe(false);
    expect(caught!.message).toContain(stale.schema_sha256);
    expect(caught!.message).toContain(VERSION);
    expect(caught!.message).toContain('abort');
    expect(caught!.message).toContain('不支持就地迁移');
    // submit 同样被拦
    expect(() => submitMergeContent(f.proposalDir, 'slot_x', join(f.root, 'nope'))).toThrow(/unsupported_contract|存量事务合同/);
    // status 只读投影仍可读；abort 是 remediation 出路，放行
    expect(readMergeTransaction(f.proposalDir).phase).toBe('ready');
    expect(abortMergeTransaction(f.proposalDir).phase).toBe('failed');
  });

  it('ST-S16-12: 宿主只读投影全链分流——待开事务→collecting→ready→sealed→completed 全程不 stat 事务文件', () => {
    const f = frontierFixture();
    const phaseOf = () => invokeJson(['next'], f.root).data.merge_transaction?.phase ?? '(absent)';
    expect(phaseOf()).toBe('(absent)');
    expect(invoke(['merge', f.slug], f.root).status).toBe(0);
    expect(phaseOf()).toBe('collecting');
    driveToPhase2(f, 'ready');
    expect(phaseOf()).toBe('ready');
    expect(invoke(['merge', 'transaction', 'seal', '--slug', f.slug], f.root).status).toBe(0);
    expect(phaseOf()).toBe('sealed');
    expect(invoke(['merge', 'transaction', 'apply', '--slug', f.slug], f.root).status).toBe(0);
    expect(phaseOf()).toBe('completed');
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
  });

  it('ST-S16-13: 存量失配事务机器消费——写动作稳定码拒绝且文本携带码，只读 status 可用', () => {
    const f = frontierFixture();
    driveToPhase(f, 'ready');
    staleContract(f.proposalDir);
    const jsonResult = invoke(['merge', 'transaction', 'seal', '--slug', f.slug, '--format', 'json'], f.root);
    expect(jsonResult.status).not.toBe(0);
    const envelope = JSON.parse(jsonResult.stderr.trim().split('\n').pop()!);
    expect(JSON.stringify(envelope)).toContain('unsupported_contract');
    expect(envelope.error.message).toContain('abort');
    const textResult = invoke(['merge', 'transaction', 'seal', '--slug', f.slug], f.root);
    expect(textResult.status).not.toBe(0);
    expect(textResult.stderr).toContain('unsupported_contract');
    const readOnly = invoke(['merge', 'transaction', 'status', '--slug', f.slug, '--format', 'json'], f.root);
    expect(readOnly.status).toBe(0);
    expect(JSON.parse(readOnly.stdout).data.merge_transaction.phase).toBe('ready');
  });
});

/** ST-S16-12 的 submit 段：从 merge 命令已创建的事务续跑到 ready。 */
function driveToPhase2(f: ReturnType<typeof frontierFixture>, phase: 'ready') {
  let tx = readMergeTransaction(f.proposalDir);
  for (const target of listMergeTransactionPlanTargets(f.proposalDir)) {
    const descriptor = tx.content_slots.items.find(item => item.slot_id === target.slot_id)!;
    const staging = join(f.root, descriptor.staging_path);
    mkdirSync(join(staging, '..'), { recursive: true });
    writeFileSync(staging, f.finals[target.target_path]);
    tx = submitMergeContent(f.proposalDir, target.slot_id, staging);
  }
  void phase;
}
