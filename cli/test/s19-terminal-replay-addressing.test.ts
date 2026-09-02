import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * S19 一次性用例的终态重放与显式寻址（fix-archived-transaction-unaddressable 切片3）
 *
 * 一次性迁移 / 恢复类用例的被测对象是**会被消费掉的外部事务**。它必须经 `--slug` 显式
 * 寻址目标提案，并以「completed 终态可重放」为判据——依赖「目标恰好挂在活跃 guard 下」
 * 会在原提案归档、活跃变更换成别的之后永久失败，且失败原因与被测能力无关。
 *
 * 「不得自建第二套查找逻辑」是架构 §三十九.1 的硬约束：归档目录查找只在 CLI 的单点解析
 * 器中存在，runner 一律调用它。
 */

const repoRoot = resolve(import.meta.dirname, '../..');
const ONE_SHOT_RUNNER = 'scripts/smoke-nested-section-anchor-0-14-4.js';

const readScript = (rel: string) => readFileSync(join(repoRoot, rel), 'utf8');

describe('S19 Unit Tests — 一次性用例的终态重放与显式寻址', () => {
  it('UT-S19-32: 一次性 runner 经 --slug 显式寻址，且不复制第二套查找逻辑', () => {
    const source = readScript(ONE_SHOT_RUNNER);

    // ① 经 --slug 显式寻址：status 调用必须能带上目标提案 slug
    expect(source).toContain('OPENLOGOS_RUNLOGOS_SLUG');
    expect(source).toMatch(/'--slug'/);
    // self-test 契约暴露该 env，供 driver 传参
    const contract = JSON.parse(
      execFileSync(process.execPath, [join(repoRoot, ONE_SHOT_RUNNER), '--self-test'], { encoding: 'utf8' }),
    ) as { target_slug_env?: string };
    expect(contract.target_slug_env).toBe('OPENLOGOS_RUNLOGOS_SLUG');

    // ② 以 completed 终态为判据（幂等重放分支存在，且不重复提交/新建事务）
    expect(source).toContain("phase === 'completed'");
    expect(source).toContain('replayed_completed');

    // ③ 不自建第二套查找逻辑：runner 不得自行拼接归档目录路径
    expect(source).not.toContain('changes/archive');
    // ④ 不得改写 guard 来换取可读性
    expect(source).not.toMatch(/writeFileSync\([^)]*openlogos-guard/);

    // ⑤ 归档目录的 slug→目录解析在实现中单点存在：
    //    只有 CLI 解析器做「按 -<slug> 后缀匹配归档目录」这件事，runner 不得复制。
    const resolver = readScript('cli/src/commands/merge-transaction.ts');
    expect(resolver).toContain("join(root, 'logos', 'changes', 'archive')");
    expect(resolver).toContain('endsWith(`-${slug}`)');
    // 该匹配逻辑在 cli/src 中只出现一次
    const resolverHits = readdirSync(join(repoRoot, 'cli/src/commands'))
      .filter(name => name.endsWith('.ts'))
      .filter(name => readScript(join('cli/src/commands', name)).includes('endsWith(`-${slug}`)'));
    expect(resolverHits).toEqual(['merge-transaction.ts']);
    // runner 侧零副本：一次性 runner 不做任何 slug→归档目录的解析
    expect(source).not.toContain('endsWith(`-${slug}`)');
  });

});
