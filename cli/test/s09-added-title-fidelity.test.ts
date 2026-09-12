/**
 * UT-S09-349 / UT-S09-350：`ADDED` 标题保真。
 *
 * 规范源：架构 §五十一「规范化形式不得充当产出内容」、功能规格 §2.80、
 * `spec/change-management.md`「Delta op 的标题保真规则」、`core-S09-test-cases.md`「S09 ADDED 标题保真测试」。
 *
 * 缺陷两次静默发生的机制：`ADDED` 用剥离后的锚做标题（`stripInlineCode` 整段删除行内代码），
 * 而既有复验「锚在 final 唯一命中」与产出共用同一条剥离管道——两边用同一把尺子量，永远相等。
 * 测试结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, expect, it } from 'vitest';
import {
  composeOpenLogosMarkdown, parseDeltaBlocks, verifyAgentMaterialOutcome,
} from '../src/lib/markdown-section-authority.js';

const BEFORE = [
  '# 文档',
  '',
  '导语。',
  '',
  '## 既有章节',
  '',
  '| ID | 用例 |',
  '|---|---|',
  '| UT-S01-01 | 甲 |',
  '',
  '### 子节',
  '',
  '子节正文。',
  '',
].join('\n');

/** 取落盘文本中某标题的**原始行**（不经任何规范化）——本组断言的唯一合法取值来源。 */
function rawHeadingLine(doc: string, contains: string): string | undefined {
  return doc.split('\n').find(l => /^#{1,6} /.test(l) && l.includes(contains));
}

describe('S09 — ADDED 标题保真', () => {
  it('UT-S09-349: 含行内代码的 ADDED 标题原样落盘', () => {
    // ① 顶层 ADDED，锚含单段行内代码
    const one = composeOpenLogosMarkdown(BEFORE, '## ADDED — Delta `RENAMED` op：章节标题更名\n\n正文甲。\n', 'MODIFY');
    expect(rawHeadingLine(one, 'op：章节标题更名')).toBe('## Delta `RENAMED` op：章节标题更名');

    // ② 锚含多段行内代码
    const two = composeOpenLogosMarkdown(BEFORE, '## ADDED — 3.17 `a_field` 与 `b_field` 投影\n\n正文乙。\n', 'MODIFY');
    expect(rawHeadingLine(two, '投影')).toBe('## 3.17 `a_field` 与 `b_field` 投影');

    // ③ 标题路径锚：子章节带行内代码，层级按父级 +1
    const nested = composeOpenLogosMarkdown(BEFORE, '## ADDED — 既有章节 > 新子节 `x_flag`\n\n子节正文。\n', 'MODIFY');
    expect(rawHeadingLine(nested, '新子节')).toBe('### 新子节 `x_flag`');

    // ④ 对照组：锚不含行内代码 → 与本变更前逐字节一致（零回归）
    const plain = composeOpenLogosMarkdown(BEFORE, '## ADDED — 纯文本新章节\n\n正文丙。\n', 'MODIFY');
    expect(rawHeadingLine(plain, '纯文本新章节')).toBe('## 纯文本新章节');

    // 定位侧不变：anchor 仍是剥离版（`` `X` `` 与 X 等价匹配的基础），rawAnchor 保留原文
    const blocks = parseDeltaBlocks('## ADDED — Delta `RENAMED` op：章节标题更名\n\n正文。\n');
    expect(blocks[0].anchor).toBe('Delta  op：章节标题更名');
    expect(blocks[0].rawAnchor).toBe('Delta `RENAMED` op：章节标题更名');

    // 正文与既有章节不受影响
    expect(one).toContain('| UT-S01-01 | 甲 |');
    expect(one).toContain('子节正文。');
  });

  it('UT-S09-350: 复验拦截「写下的 != 落盘的」，且不共用剥离管道', () => {
    const delta = '## ADDED — Delta `RENAMED` op：章节标题更名\n\n正文甲。\n';

    // 正例：真实合成结果通过复验
    const good = composeOpenLogosMarkdown(BEFORE, delta, 'MODIFY');
    expect(verifyAgentMaterialOutcome(delta, BEFORE, good).ok).toBe(true);

    // 反例：模拟修复前行为——标题被剥离后落盘（其余字节相同）
    const stale = good.replace('## Delta `RENAMED` op：章节标题更名', '## Delta  op：章节标题更名');
    expect(stale).not.toBe(good);
    const verdict = verifyAgentMaterialOutcome(delta, BEFORE, stale);
    expect(verdict.ok, '被吞标题必须被复验拦下').toBe(false);
    expect(verdict.error).toContain('落盘标题与 delta 不符');
    expect(verdict.error, '诊断须同时给出写下的与落盘的两侧').toContain('Delta `RENAMED` op');

    // 诊断可区分：「章节不存在」是另一类错误，不得与标题不符混为一谈
    const removed = good.split('\n').filter(l => !l.startsWith('## Delta')).join('\n');
    const missing = verifyAgentMaterialOutcome(delta, BEFORE, removed);
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('没有形成唯一新增结果');

    // 关键：比较不得经 stripInlineCode——若复验拿剥离后的两侧比对，stale 会假性通过。
    // 本断言即锁住该机制：剥离版两侧相等，而复验仍判失败。
    const strippedExpected = 'Delta  op：章节标题更名';
    expect(stale).toContain(`## ${strippedExpected}`);
    expect(verdict.ok, '剥离后两侧相等，但复验必须仍然失败').toBe(false);
  });
});
