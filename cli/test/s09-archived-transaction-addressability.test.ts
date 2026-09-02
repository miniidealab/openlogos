import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMergeTransaction } from '../src/lib/merge-transaction.js';

/**
 * S09 归档提案的事务只读寻址（fix-archived-transaction-unaddressable 切片1）
 *
 * `openlogos archive` 只**移动**事务字节的位置（`logos/changes/<slug>` →
 * `logos/changes/archive/<时间戳>-<slug>`），不销毁它们；因此可寻址性也不应随之消失。
 * 但可读 ≠ 可写：归档意味着该变更已终结。
 *
 * **归档模拟方式**：测试用目录移动模拟归档，而不是跑 `openlogos archive`——后者需要
 * VERIFY_PASS / DEPLOY_DONE / SMOKE_PASS 等一整套门禁，与本切片被测的「解析器按目录
 * 位置寻址」无关。目录名严格遵循 `<时间戳>-<slug>` 这一真实命名规则，且断言只依赖
 * 「以 `-<slug>` 结尾」，**不把任何具体时间戳固化进断言**。
 */

const roots: string[] = [];
const repoRoot = resolve(import.meta.dirname, '../..');
const CLI = join(repoRoot, 'cli/dist/index.js');

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function put(root: string, path: string, content: string): void {
  const target = join(root, ...path.split('/'));
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, content);
}

const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/** 建一个含真实 merge transaction 的提案（collecting 相位足以证明寻址与读写分流） */
function fixture(slug = 'addressable-fixture') {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-archived-addr-'));
  roots.push(root);
  const proposalDir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/logos.config.json', '{"locale":"zh","project":{"type":"cli"}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: Addr Fixture\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  put(root, 'logos/resources/test/core-S01-test-cases.md', '# 测试\n\n## 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |\n');
  put(root, `logos/changes/${slug}/deltas/test/core-S01-test-cases.md`, '## MODIFIED — 测试矩阵\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |\n');
  put(root, `logos/changes/${slug}/proposal.md`, `# fixture\n\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  policy: on-touch-v1\n  schema_version: 1\n  unit: canonical-merge-target-path\n  delta_cardinality: exactly-one-per-non-skip-target\n  effective_view: merged-resources-plus-current-change-deltas\n  ambiguity: block-before-existing-plan-exit\n  standalone_baseline_required: false\n  jit_confirmation: disabled\n  touched_scenario_ids: [S01]\n  targets:\n    - category: test\n      scenario_ids: [S01]\n      mode: MODIFY\n      delta_path: deltas/test/core-S01-test-cases.md\n      reason: fixture\n      evidence: [target_exists]\n      missing_evidence: []\n\`\`\`\n`);
  put(root, `logos/changes/${slug}/tasks.md`, '# 任务\n\n## [delta] 规格变更\n\n## [code] 代码实现\n');
  const tx = createMergeTransaction(root, proposalDir, slug);
  return { root, proposalDir, slug, tx };
}

/** 模拟 archive：把提案目录移到 logos/changes/archive/<时间戳>-<slug> */
function simulateArchive(root: string, slug: string, stamp = '20260101-1200'): string {
  const archived = join(root, 'logos', 'changes', 'archive', `${stamp}-${slug}`);
  mkdirSync(join(root, 'logos', 'changes', 'archive'), { recursive: true });
  renameSync(join(root, 'logos', 'changes', slug), archived);
  return archived;
}

function cli(root: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--format', 'json'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
  const raw = r.status === 0 ? r.stdout : r.stderr;
  let parsed: Record<string, unknown> | null = null;
  try { parsed = JSON.parse(raw.trim().split('\n').pop() ?? ''); } catch { /* 非 JSON 输出保留原文 */ }
  return { status: r.status, parsed, raw };
}

interface ErrorEnvelope { code?: string; message?: string; details?: { classification?: string } }
const errorOf = (out: ReturnType<typeof cli>) =>
  (out.parsed as { error?: ErrorEnvelope } | null)?.error;

const txOf = (out: ReturnType<typeof cli>) =>
  (out.parsed?.data as { merge_transaction?: Record<string, unknown> } | undefined)?.merge_transaction;

describe('S09 Unit Tests — 归档提案的事务只读寻址', () => {
  it('UT-S09-279: 归档提案可经 slug 只读寻址，身份与归档前一致', () => {
    const f = fixture();
    const before = txOf(cli(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]))!;
    expect(before.transaction_id).toBeTruthy();

    simulateArchive(f.root, f.slug);
    // 归档后 guard 仍指向该 slug，但活跃目录已不存在——修复前此处报「提案不存在」
    const after = txOf(cli(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]))!;

    expect(after.transaction_id).toBe(before.transaction_id);
    expect(after.phase).toBe(before.phase);
    expect(after.target_set_sha256).toBe(before.target_set_sha256);

    // slot 身份与计数守恒；staging_path 指向真实目录，随归档合法变化，故单独校验
    const slots = (v: unknown) => v as { required: number; submitted: number; missing_slot_ids: string[]; items: Array<{ slot_id: string; target_ref: string; staging_path: string }> };
    const a = slots(after.content_slots); const b = slots(before.content_slots);
    expect(a.required).toBe(b.required);
    expect(a.submitted).toBe(b.submitted);
    expect(a.missing_slot_ids).toEqual(b.missing_slot_ids);
    expect(a.items.map(i => `${i.slot_id}:${i.target_ref}`)).toEqual(b.items.map(i => `${i.slot_id}:${i.target_ref}`));

    // 归档态的 staging_path 仍必须是完整的 project-relative 路径——
    // 固定深度上溯会丢掉 logos/ 前缀，这里正是对该位置性假设的回归锁
    for (const item of a.items) {
      expect(item.staging_path.startsWith('logos/changes/archive/')).toBe(true);
      expect(item.staging_path).toContain(`-${f.slug}/merge-staging/`);
    }
  });

  it('UT-S09-280: 活跃提案两条既有路径零回归', () => {
    const f = fixture();
    const viaGuard = cli(f.root, ['merge', 'transaction', 'status']);
    const viaSlug = cli(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]);

    expect(viaGuard.status).toBe(0);
    expect(viaSlug.status).toBe(0);
    // 两条既有路径命中活跃目录，输出一致（时间戳字段由 envelope 承载，故比对 data 部分）
    expect(JSON.stringify(txOf(viaGuard))).toBe(JSON.stringify(txOf(viaSlug)));
    expect(txOf(viaGuard)!.slug).toBe(f.slug);
  });

  it('UT-S09-281: 归档提案上的写动作一律 fail-closed 且零副作用', () => {
    const f = fixture();
    const archivedDir = simulateArchive(f.root, f.slug);
    const txFile = join(archivedDir, 'MERGE_TRANSACTION.json');
    const before = sha(txFile);

    // submit-content 需要 --slot/--file 才能走到动作分支，其余四个直接发起
    const writes: string[][] = [
      ['merge', 'transaction', 'submit-content', '--slug', f.slug, '--slot', 'x', '--file', txFile],
      ['merge', 'transaction', 'seal', '--slug', f.slug],
      ['merge', 'transaction', 'apply', '--slug', f.slug],
      ['merge', 'transaction', 'recover', '--slug', f.slug],
      ['merge', 'transaction', 'abort', '--slug', f.slug],
    ];
    for (const args of writes) {
      const out = cli(f.root, args);
      expect(out.status, args.join(' ')).not.toBe(0);
      const err = errorOf(out);
      // 复用既有闭合枚举，不新增 classification（spec：未知 classification 必须 fail-closed）
      expect(err?.code, args.join(' ')).toBe('action_not_allowed');
      expect(err?.details?.classification, args.join(' ')).toBe('action_not_allowed');
      expect(err?.message ?? out.raw).toContain('已归档');
    }
    // 零副作用：事务文件字节不变
    expect(sha(txFile)).toBe(before);
  });

  it('UT-S09-282: 同一 slug 多归档命中报歧义，不取第一个', () => {
    const f = fixture();
    const first = simulateArchive(f.root, f.slug, '20260101-1200');
    // 再造一个同 slug、不同时间戳的归档目录
    const second = join(f.root, 'logos', 'changes', 'archive', `20260202-0900-${f.slug}`);
    cpSync(first, second, { recursive: true });

    const out = cli(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]);
    expect(out.status).not.toBe(0);
    const err = errorOf(out);
    expect(err?.code).toBe('target_set_mismatch');
    expect(err?.details?.classification).toBe('target_set_mismatch');
    expect(err?.message ?? out.raw).toContain('多个归档目录');
    // 不得择新或择旧地返回任一候选
    expect(txOf(out)).toBeUndefined();
  });
});

describe('S09 Scenario Tests — 归档前后只读投影一致', () => {
  it('ST-S09-109: 归档前后同一事务只读投影一致，写路径终结且 guard 未被改写', () => {
    const f = fixture();
    const guardPath = join(f.root, 'logos', '.openlogos-guard');
    const guardBefore = sha(guardPath);

    const before = txOf(cli(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]))!;
    const archivedDir = simulateArchive(f.root, f.slug);
    const after = txOf(cli(f.root, ['merge', 'transaction', 'status', '--slug', f.slug]))!;

    expect(after.transaction_id).toBe(before.transaction_id);
    expect(after.phase).toBe(before.phase);
    const slotIds = (v: unknown) => (v as { items: Array<{ slot_id: string }> }).items.map(i => i.slot_id);
    expect(slotIds(after.content_slots)).toEqual(slotIds(before.content_slots));

    // 写路径已终结
    const txBytes = sha(join(archivedDir, 'MERGE_TRANSACTION.json'));
    const sealed = cli(f.root, ['merge', 'transaction', 'seal', '--slug', f.slug]);
    expect(sealed.status).not.toBe(0);
    expect(sha(join(archivedDir, 'MERGE_TRANSACTION.json'))).toBe(txBytes);

    // 全程未改写 guard——不得靠把 guard 指回归档提案来获得可读性
    expect(sha(guardPath)).toBe(guardBefore);
  });
});
