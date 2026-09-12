/**
 * UT-S37-42：L8 守恒判据的 `RENAMED` 折算。
 *
 * 规范源：`spec/change-management.md`「Delta RENAMED op」与既有 op 的组合、架构 §五十/§五十一、
 * `core-S37-test-cases.md`「四、L8 守恒判据的 RENAMED 折算」。
 *
 * 缺陷形态：规范规定「更名后以**新标题**作后续块的锚」，而 L8 在**合并前**文档里解析锚——
 * 新标题此刻尚不存在，直接解析必然 not-found，报 `delta_section_anchor_unresolvable`（violation，拦 merge）；
 * 而 `composeOpenLogosMarkdown` 顺序应用、合成完全成功。于是规范要求的写法被判据拒绝。
 * 测试结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, expect, it } from 'vitest';
import { evaluateDeltaConservation, resolveModifiedSectionKeys } from '../src/lib/change-lint.js';
import { composeOpenLogosMarkdown } from '../src/lib/markdown-section-authority.js';

// 夹具用**平铺**的两个 H2，避免 MODIFIED 的整节全量覆盖把 REMOVED 的目标一并吞掉
// （那是章节嵌套的固有语义，与本用例要测的折算无关）。
const TARGET = [
  '# 文档',
  '',
  '导语。',
  '',
  '## 甲节：Authority Closure 判据',
  '',
  '| ID | 用例 |',
  '|---|---|',
  '| UT-S99-01 | 甲 |',
  '',
  '## 待删除的空壳节',
  '',
  '空壳内容。',
  '',
].join('\n');

const NEW_TITLE = '甲节：代码审查判据';

/** 规范要求的写法：RENAMED 改名 → 以**新标题**为锚 MODIFIED → REMOVED 孤儿节。 */
const DELTA = [
  '## RENAMED — 甲节：Authority Closure 判据',
  '',
  NEW_TITLE,
  '',
  `## MODIFIED — ${NEW_TITLE}`,
  '',
  '| ID | 用例 |',
  '|---|---|',
  '| UT-S99-01 | 甲（改） |',
  '',
  '## REMOVED — 待删除的空壳节',
  '',
  '空壳，删除零损失。',
  '',
].join('\n');

describe('S37 — L8 守恒判据的 RENAMED 折算', () => {
  it('UT-S37-42: 规范要求的写法不再被误报锚不可解析，且不放宽真失败', () => {
    // 前置：这份 delta 的真实合成是成功的——判据不该与合成器分叉
    const composed = composeOpenLogosMarkdown(TARGET, DELTA, 'MODIFY');
    expect(composed).toContain(`## ${NEW_TITLE}`);
    expect(composed).toContain('| UT-S99-01 | 甲（改） |');
    expect(composed).not.toContain('## 待删除的空壳节');

    // ① 零 delta_section_anchor_unresolvable——新标题经反向映射折回旧标题后命中
    const violations = evaluateDeltaConservation(DELTA, TARGET);
    expect(violations.filter(v => v.code === 'delta_section_anchor_unresolvable')).toEqual([]);

    // ② 多写者判重不因更名失效：以新标题为锚的 MODIFIED 仍解析到被更名章节的真实行号
    const keys = resolveModifiedSectionKeys(DELTA, TARGET);
    expect(keys.length, '折算后应解析到被更名章节的真实行号').toBe(1);
    expect(TARGET.split('\n')[keys[0]], '行号应指向更名前的标题行')
      .toBe('## 甲节：Authority Closure 判据');

    // ③ 折算不放宽真失败：锚既不在盘、也不是本 delta 内任何 RENAMED 的新标题
    const bogus = DELTA.replace(`## MODIFIED — ${NEW_TITLE}`, '## MODIFIED — 从未存在的章节');
    const bogusViolations = evaluateDeltaConservation(bogus, TARGET);
    expect(bogusViolations.some(v => v.code === 'delta_section_anchor_unresolvable'),
      '真正的锚不可解析必须仍被报告').toBe(true);

    // ④ RENAMED 块正文非单行（非法形态）不进入映射表——折算不采信非法块
    const malformed = DELTA.replace(`${NEW_TITLE}\n`, `${NEW_TITLE}\n第二行\n`);
    const malformedViolations = evaluateDeltaConservation(malformed, TARGET);
    expect(malformedViolations.some(v => v.code === 'delta_section_anchor_unresolvable'),
      '非法 RENAMED 块不得为后续锚提供折算').toBe(true);
  });
});
