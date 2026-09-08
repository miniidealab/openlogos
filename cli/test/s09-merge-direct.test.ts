/**
 * S09 merge 直接合并与 lint-specs（lite-cut1b-remove-merge-transaction）。
 *
 * 覆盖 UT-S09-340 / UT-S09-341 / ST-S09-140，对应功能规格 §2.69 与 §2.70。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupFixtureRoots, frontierFixture, invoke, put } from './frontier-fixture.js';
import { mergeDirect, MergeDirectError } from '../src/lib/merge-direct.js';
import { lintSpecsIn } from '../src/commands/lint-specs.js';

afterAll(cleanupFixtureRoots);

/** 全部 canonical target 的 (字节, mtimeMs) 快照——用于证明失败路径零副作用。 */
function snapshot(f: ReturnType<typeof frontierFixture>): Map<string, string> {
  const snap = new Map<string, string>();
  for (const target of Object.keys(f.finals)) {
    const abs = join(f.root, ...target.split('/'));
    snap.set(target, `${readFileSync(abs, 'utf8')}::${statSync(abs).mtimeMs}`);
  }
  return snap;
}

function expectUntouched(f: ReturnType<typeof frontierFixture>, before: Map<string, string>, label: string) {
  for (const [target, value] of before) {
    const abs = join(f.root, ...target.split('/'));
    expect(`${readFileSync(abs, 'utf8')}::${statSync(abs).mtimeMs}`, `${label} / ${target}`).toBe(value);
  }
  expect(existsSync(join(f.proposalDir, 'SPEC_MERGED')), `${label} / SPEC_MERGED 不得创建`).toBe(false);
}

describe('merge 直接合并 — S09（功能规格 §2.69）', () => {
  it('UT-S09-340: 一次调用完成合并且 SPEC_MERGED 结构化字段零回归', () => {
    const f = frontierFixture();
    // fixture 的四个 MODIFIED 目标之外，再补一个 ADDED 与一个 REMOVED 块，覆盖三种块形态。
    const scenarioTarget = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md';
    put(f.root, scenarioTarget, '# 文档\n\n## 一、判据\n\n旧正文。\n\n## 待删小节\n\n将被 REMOVED。\n');
    put(f.root, `logos/changes/${f.slug}/deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md`,
      '## MODIFIED — 一、判据\n\n新正文。\n\n## ADDED — 新增小节\n\n新增内容。\n\n## REMOVED — 待删小节\n\n随本次变更删除。\n');

    const result = mergeDirect(f.root, f.proposalDir, f.slug);

    // ① 一次调用即完成：全部 canonical target 落到最终态
    expect(result.target_count).toBe(4);
    for (const target of ['logos/resources/prd/1-product-requirements/core-01-requirements.md', f.targetPath]) {
      expect(readFileSync(join(f.root, ...target.split('/')), 'utf8'), target).toBe(f.finals[target]);
    }
    // ② 章节锚正确定位、标题层级 rebase 正确、REMOVED 真的删掉、ADDED 真的加上
    const scenario = readFileSync(join(f.root, ...scenarioTarget.split('/')), 'utf8');
    expect(scenario).toContain('## 一、判据');
    expect(scenario).toContain('新正文。');
    expect(scenario).toContain('## 新增小节');
    expect(scenario).not.toContain('待删小节');

    // ③ SPEC_MERGED 在场且结构化字段零回归
    const marker = JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8'));
    expect(marker.type).toBe('merge_complete');
    expect(typeof marker.completed_at).toBe('string');
    expect(new Date(marker.completed_at).toString()).not.toBe('Invalid Date');
    const cs = marker.test_change_set;
    expect(cs.schema).toBe('openlogos/test-change-set@1');
    expect(cs.change).toBe(f.slug);
    expect(cs.module).toBe('core');
    expect(cs.source).toBe('semantic-before-after-diff');
    expect(Array.isArray(cs.changed_test_ids)).toBe(true);
    expect(Array.isArray(cs.removed_test_ids)).toBe(true);
    expect(Array.isArray(cs.targets)).toBe(true);
    expect(typeof cs.sha256).toBe('string');
    // fixture 的测试规格把 UT-S01-01 的定义从「旧定义」改成「新定义」——语义 diff 必须认出它
    expect(cs.changed_test_ids).toContain('UT-S01-01');
    expect(cs.removed_test_ids).toEqual([]);

    // ④ 无任何事务中间态残留
    for (const residue of ['MERGE_TRANSACTION.json', 'MERGE_RECEIPT.json', 'merge-staging', 'merge-content']) {
      expect(existsSync(join(f.proposalDir, residue)), residue).toBe(false);
    }
    expect(readdirSync(f.proposalDir).some(name => name.startsWith('merge-'))).toBe(false);
  });

  it('UT-S09-341: 失败零副作用与整批回滚', () => {
    /** 每条失败都必须：稳定错误码 + 携带 git 回滚点提示。 */
    const expectFailure = (
      f: ReturnType<typeof frontierFixture>, code: string, label: string,
    ): void => {
      let caught: MergeDirectError | null = null;
      try { mergeDirect(f.root, f.proposalDir, f.slug); } catch (e) { caught = e as MergeDirectError; }
      expect(caught, label).toBeInstanceOf(MergeDirectError);
      expect(caught!.code, label).toBe(code);
      expect(caught!.message, `${label} 须含回滚点提示`).toContain('git checkout logos/resources/');
    };

    // (a) delta 缺段标记
    const noMarker = frontierFixture();
    put(noMarker.root, `logos/changes/${noMarker.slug}/deltas/test/core-S01-test-cases.md`, '没有任何段标记的正文。\n');
    let before = snapshot(noMarker);
    expectFailure(noMarker, 'MERGE_DELTA_INVALID', '缺段标记');
    expectUntouched(noMarker, before, '缺段标记');

    // (b) 章节锚解析到 0 处
    const notFound = frontierFixture();
    put(notFound.root, `logos/changes/${notFound.slug}/deltas/test/core-S01-test-cases.md`,
      '## MODIFIED — 不存在的章节\n\n正文。\n');
    before = snapshot(notFound);
    expectFailure(notFound, 'MERGE_DELTA_INVALID', '锚 0 处');
    expectUntouched(notFound, before, '锚 0 处');

    // (c) 章节锚解析到多处
    const ambiguous = frontierFixture();
    put(ambiguous.root, ambiguous.targetPath, '# 文档\n\n## 一、判据\n\nA\n\n## 一、判据\n\nB\n');
    before = snapshot(ambiguous);
    expectFailure(ambiguous, 'MERGE_DELTA_INVALID', '锚多处');
    expectUntouched(ambiguous, before, '锚多处');

    // (d) delta 与目标事实不符：MODIFIED 锚指向的目标不存在（派生模型下模式判为 CREATE，
    //     整份新文档却带着 MODIFIED 锚）——合成阶段 fail-closed
    const mismatch = frontierFixture();
    const missing = join(mismatch.root, 'logos/resources/prd/1-product-requirements/core-01-requirements.md');
    writeFileSync(missing, '');
    rmSync(missing);
    before = snapshot2(mismatch, missing);
    expectFailure(mismatch, 'MERGE_DELTA_INVALID', 'delta 与目标事实不符');
    for (const [target, value] of before) {
      const abs = join(mismatch.root, ...target.split('/'));
      expect(`${readFileSync(abs, 'utf8')}::${statSync(abs).mtimeMs}`, `delta 与目标事实不符 / ${target}`).toBe(value);
    }
    expect(existsSync(join(mismatch.proposalDir, 'SPEC_MERGED'))).toBe(false);

    // (e) SPEC_MERGED 已在场
    const done = frontierFixture();
    mergeDirect(done.root, done.proposalDir, done.slug);
    const markerBytes = readFileSync(join(done.proposalDir, 'SPEC_MERGED'), 'utf8');
    let caught: MergeDirectError | null = null;
    try { mergeDirect(done.root, done.proposalDir, done.slug); } catch (e) { caught = e as MergeDirectError; }
    expect(caught).toBeInstanceOf(MergeDirectError);
    expect(caught!.code).toBe('MERGE_ALREADY_COMPLETE');
    expect(caught!.message).toContain('git checkout logos/resources/');
    expect(readFileSync(join(done.proposalDir, 'SPEC_MERGED'), 'utf8')).toBe(markerBytes);

  });
});

/** (d) 分支专用：目标已被删除时不能读它，只快照其余目标。 */
function snapshot2(f: ReturnType<typeof frontierFixture>, skipAbs: string): Map<string, string> {
  const snap = new Map<string, string>();
  for (const target of Object.keys(f.finals)) {
    const abs = join(f.root, ...target.split('/'));
    if (abs === skipAbs) continue;
    snap.set(target, `${readFileSync(abs, 'utf8')}::${statSync(abs).mtimeMs}`);
  }
  return snap;
}

describe('lint-specs 独立结构检查 — S09/§2.70', () => {
  it('ST-S09-140: 合并 → 回滚重来 → lint-specs 不参与门的端到端', () => {
    const f = frontierFixture();

    // ① 一次调用合并多目标成功，SPEC_MERGED 在场
    const first = invoke(['merge', f.slug], f.root);
    expect(first.status, first.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
    expect(readFileSync(join(f.root, ...f.targetPath.split('/')), 'utf8')).toBe(f.finals[f.targetPath]);

    // ② 「发现 delta 有误」：回滚 + 删 marker → 修正 delta → 重跑 merge 成功（无需 reopen / abort 通道）
    for (const [target, final] of Object.entries(f.finals)) {
      void final;
      const abs = join(f.root, ...target.split('/'));
      const isTest = target === f.targetPath;
      writeFileSync(abs, isTest
        ? '# 文档\n\n## 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |\n'
        : '# 文档\n\n## 一、判据\n\n旧正文。\n');
    }
    rmSync(join(f.proposalDir, 'SPEC_MERGED'));
    put(f.root, `logos/changes/${f.slug}/deltas/test/core-S01-test-cases.md`,
      '## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 修正后的定义 |\n');
    const second = invoke(['merge', f.slug], f.root);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(join(f.root, ...f.targetPath.split('/')), 'utf8')).toContain('修正后的定义');
    // 不存在 reopen / abort 通道：merge 无子命令
    expect(invoke(['merge', 'transaction', 'reopen', '--slug', f.slug], f.root).status).not.toBe(0);

    // ③ 植入重复 ID → lint-specs 非零退出并点名该 ID 与位置
    const specDir = join(f.root, 'logos', 'resources', 'test');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'core-S02-test-cases.md'),
      '# S02\n\n| ID | 描述 |\n|---|---|\n| UT-S01-01 | 与 S01 重名 |\n');
    const lint = lintSpecsIn(f.root);
    expect(lint.ok).toBe(false);
    const dup = lint.findings.find(x => x.code === 'duplicate_test_id');
    expect(dup, 'duplicate_test_id 必须被点名').toBeDefined();
    expect(dup!.message).toContain('UT-S01-01');
    expect(dup!.message).toContain('core-S02-test-cases.md');
    const cliLint = invoke(['lint-specs'], f.root);
    expect(cliLint.status).not.toBe(0);
    expect(cliLint.stdout).toContain('duplicate_test_id');

    // ④ 同一状态下 merge 与 verify 均不因 lint-specs 结论而阻断（证明它不参与任何门）
    const g = frontierFixture();
    writeFileSync(join(g.root, 'logos', 'resources', 'test', 'core-S02-test-cases.md'),
      '# S02\n\n| ID | 描述 |\n|---|---|\n| UT-S01-01 | 与 S01 重名 |\n');
    expect(lintSpecsIn(g.root).ok, '前置：该状态下 lint-specs 确实判红').toBe(false);
    const mergeUnderDup = invoke(['merge', g.slug], g.root);
    expect(mergeUnderDup.status, `merge 不得因 lint-specs 结论阻断：${mergeUnderDup.stderr}`).toBe(0);
    const verifyUnderDup = invoke(['verify'], g.root);
    expect(verifyUnderDup.stderr).not.toContain('duplicate_test_id');
    expect(verifyUnderDup.stderr).not.toContain('lint-specs');
  });
});
