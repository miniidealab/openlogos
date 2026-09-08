/**
 * S09 章节锚序数消歧 + S35 重复标题检查 + L8 降级（lite-cut2c）。
 *
 * 覆盖 UT-S09-342 / UT-S09-343 / ST-S09-141 / UT-S35-136 / UT-S35-137 / UT-S37-41 / ST-S37-11。
 * 对应功能规格 §2.72（锚序数与重复标题）与 §2.73（L8 降级）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMarkdownHeadings, resolveSectionAnchor, composeOpenLogosMarkdown } from '../src/lib/markdown-section-authority.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { lintSpecsIn } from '../src/commands/lint-specs.js';
import { cleanupFixtureRoots, frontierFixture, invoke, put } from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

/** 含两处字节完全相同的 `## 契约` 标题，各自正文不同。 */
const DUP_DOC = [
  '# 文档', '',
  '## 契约', '', '第一处正文。', '',
  '## 其它', '', '中间节。', '',
  '## 契约', '', '第二处正文。', '',
].join('\n');

const anchorsOf = (content: string) => parseMarkdownHeadings(content);

describe('章节锚序数消歧 — S09（§2.72）', () => {
  it('UT-S09-342: 序数在重复标题下精确定位', () => {
    const headings = anchorsOf(DUP_DOC);
    const first = resolveSectionAnchor(headings, '契约 [1]');
    const second = resolveSectionAnchor(headings, '契约 [2]');
    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(first.hit!.line).toBeLessThan(second.hit!.line);

    // 合成结果只改动被点名的那一处，另一处字节不变
    const composed = composeOpenLogosMarkdown(DUP_DOC, '## MODIFIED — 契约 [2]\n\n改写后的第二处。\n', 'MODIFY');
    expect(composed).toContain('第一处正文。');
    expect(composed).toContain('改写后的第二处。');
    expect(composed).not.toContain('第二处正文。');

    // 删除第 1 处：第 2 处完整保留
    const removed = composeOpenLogosMarkdown(DUP_DOC, '## REMOVED — 契约 [1]\n\n删除首处壳。\n', 'MODIFY');
    expect(removed).not.toContain('第一处正文。');
    expect(removed).toContain('第二处正文。');
  });

  it('UT-S09-343: 无后缀语义零漂移与越界 fail-closed', () => {
    const unique = anchorsOf('# 文档\n\n## 唯一\n\n正文。\n');
    const dup = anchorsOf(DUP_DOC);

    // ① 同名候选恰 1 处、无后缀 → 命中（与本变更前一致）
    expect(resolveSectionAnchor(unique, '唯一').status).toBe('ok');
    // ② 同名候选 2 处、无后缀 → ambiguous 并给出两处候选（与本变更前一致）
    const ambiguous = resolveSectionAnchor(dup, '契约');
    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.candidates).toHaveLength(2);
    // ③ 序数越界 → not_found
    expect(resolveSectionAnchor(dup, '契约 [3]').status).toBe('not_found');
    // ④ 候选恰 1 处 + [1] → 命中
    expect(resolveSectionAnchor(unique, '唯一 [1]').status).toBe('ok');
    // ⑤ 路径锚 + 序数：先按路径过滤候选，再按序数选取
    const nested = anchorsOf('# 文档\n\n## A\n\n### 子\n\n一\n\n## B\n\n### 子\n\n二\n');
    const viaPath = resolveSectionAnchor(nested, 'B > 子 [1]');
    expect(viaPath.status).toBe('ok');
    expect(viaPath.hit!.path).toEqual(['文档', 'B', '子']);
    // 非法序数形态（0、负数、非末尾）按普通标题文本处理，不误判为序数
    expect(resolveSectionAnchor(dup, '契约 [0]').status).toBe('not_found');
  });

  it('ST-S09-141: 真实 CLI 下用序数锚删除重复标题壳', () => {
    const f = frontierFixture();
    // 构造在需求目标上（夹具的测试 delta 保持原样，以满足 L3 的真实测试 ID 要求）
    const target = 'logos/resources/prd/1-product-requirements/core-01-requirements.md';
    // 一处空壳 + 一处内容完整，两者标题字节相同
    put(f.root, target, ['# 文档', '', '## 一、判据', '', '## 一、判据', '', '完整正文。', ''].join('\n'));
    put(f.root, `logos/changes/${f.slug}/deltas/prd/1-product-requirements/core-01-requirements.md`,
      '## REMOVED — 一、判据 [1]\n\n删除空壳。\n');

    const merged = invoke(['merge', f.slug], f.root);
    expect(merged.status, merged.stderr).toBe(0);
    const after = readFileSync(join(f.root, ...target.split('/')), 'utf8');
    // 空壳已删，内容完整的那一处逐字节保留
    expect(after.match(/^## 一、判据$/gm) ?? []).toHaveLength(1);
    expect(after).toContain('完整正文。');
  });
});

describe('重复标题检查与 L8 强度 — S35（§2.72.2 / §2.73）', () => {
  it('UT-S35-136: lint-specs 报告路径锚无法消歧的重复标题', () => {
    const f = frontierFixture();
    const specDir = 'logos/resources/test';
    // ① 文本与祖先链均相同 → 报告
    put(f.root, `${specDir}/core-S90-test-cases.md`, DUP_DOC);
    // ② 仅文本相同、祖先不同 → 不报告（路径锚可消歧）
    put(f.root, `${specDir}/core-S91-test-cases.md`,
      '# 文档\n\n## A\n\n### 单元测试\n\n一\n\n## B\n\n### 单元测试\n\n二\n');
    // ③ 标题互不相同 → 不报告
    put(f.root, `${specDir}/core-S92-test-cases.md`, '# 文档\n\n## X\n\n一\n\n## Y\n\n二\n');

    const result = lintSpecsIn(f.root);
    const dups = result.findings.filter(x => x.code === 'duplicate_heading');
    expect(dups.some(d => d.path.includes('core-S90'))).toBe(true);
    expect(dups.some(d => d.path.includes('core-S91')), '祖先不同可用路径锚消歧，不是缺陷').toBe(false);
    expect(dups.some(d => d.path.includes('core-S92'))).toBe(false);
    expect(dups.find(d => d.path.includes('core-S90'))!.message).toContain('契约');

    // 不参与任何门：同一状态下 merge 与 verify 均不因其结论阻断
    expect(invoke(['merge', f.slug], f.root).status, '本项不得阻断 merge').toBe(0);
  });

  it('UT-S35-137: L8 守恒码降级为警告且诊断逐字不变', () => {
    const f = frontierFixture();
    // 隐式删除既有 ID：MODIFIED 块丢掉 UT-S01-01
    put(f.root, `logos/changes/${f.slug}/deltas/test/core-S01-test-cases.md`,
      '## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-99 | 新增 |\n');
    const result = runChangeLint(f.root, f.proposalDir, f.slug);
    expect(result.ok).toBe(true);
    const codes = (c: string) => result.ok === true && result.violations.some(v => v.code === c);
    expect(codes('delta_implicit_id_removal'), '守恒码不得再出现在 violations').toBe(false);
    const warnCodes = result.ok === true ? result.warnings.map(w => w.code) : [];
    expect(warnCodes).toContain('delta_implicit_id_removal');
    // 诊断内容保留定位精度：点名被删 ID
    const warn = result.ok === true ? result.warnings.find(w => w.code === 'delta_implicit_id_removal')! : null;
    expect(warn!.message).toContain('UT-S01-01');
    expect(warn!.fix_hint.length).toBeGreaterThan(0);

    // 锚不可解析仍是违规——它是定位失败而非守恒判断
    const g = frontierFixture();
    put(g.root, `logos/changes/${g.slug}/deltas/test/core-S01-test-cases.md`,
      '## MODIFIED — 不存在的章节\n\n正文。\n');
    const anchorResult = runChangeLint(g.root, g.proposalDir, g.slug);
    expect(anchorResult.ok === true && anchorResult.violations.some(v => v.code === 'delta_section_anchor_unresolvable')).toBe(true);
  });
});

describe('条目守恒降级后的端到端 — S37（§2.73）', () => {
  it('UT-S37-41: merge 不再因条目守恒拒绝', () => {
    const f = frontierFixture();
    put(f.root, `logos/changes/${f.slug}/deltas/test/core-S01-test-cases.md`,
      '## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-99 | 新增 |\n');
    const merged = invoke(['merge', f.slug], f.root);
    expect(merged.status, merged.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
    // 告警照常给出并点名被删 ID
    expect(merged.stdout).toContain('delta_implicit_id_removal');
    expect(merged.stdout).toContain('UT-S01-01');
  });

  it('ST-S37-11: 静默删除由 verify 的孤儿检查兜住', () => {
    const f = frontierFixture();
    put(f.root, `logos/changes/${f.slug}/deltas/test/core-S01-test-cases.md`,
      '## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-99 | 新增 |\n');
    // ① change-lint：守恒在 warnings、不阻断
    const lint = runChangeLint(f.root, f.proposalDir, f.slug);
    expect(lint.ok === true && lint.violations.some(v => v.code === 'delta_implicit_id_removal')).toBe(false);
    // ② merge 成功
    expect(invoke(['merge', f.slug], f.root).status).toBe(0);
    // ③ 规格中 UT-S01-01 已消失，但测试结果账本里仍有它 → verify 必须判不一致
    put(f.root, 'logos/resources/verify/test-results.jsonl',
      '{"id":"UT-S01-01","status":"pass"}\n{"id":"UT-S01-99","status":"pass"}\n');
    const verified = invoke(['verify'], f.root);
    const text = verified.stdout + verified.stderr;
    expect(text).toContain('UT-S01-01');
  });
});
