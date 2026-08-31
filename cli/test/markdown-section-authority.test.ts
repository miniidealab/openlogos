/**
 * S37 Section Anchor Authority 回归。
 * 用例 ID 来自已合并规格；Vitest 全局 OpenLogos reporter 逐条写入 test-results.jsonl。
 */
import { describe, expect, it } from 'vitest';
import { evaluateDeltaConservation } from '../src/lib/change-lint.js';
import {
  composeOpenLogosMarkdown,
  parseDeltaBlocks,
  parseMarkdownHeadings,
  resolveSectionAnchor,
  verifyAgentMaterialOutcome,
} from '../src/lib/markdown-section-authority.js';

const realParent = '七、项目文件夹动态 watcher 交互规则';
const realLeaf = '7.1 已打开文件外部变化感知';
const anchor = `${realParent} > ${realLeaf}`;
const before = [
  '# RunLogos', '',
  `## ${realParent}`, '',
  `### ${realLeaf}`, '',
  '旧正文。', '',
  '#### 叶下说明', '',
  '保持子标题。', '',
  '## 八、其它规则', '',
  `### ${realLeaf}`, '',
  '同名叶。', '',
].join('\n');

describe('MarkdownSectionAuthority', () => {
  it('UT-S37-37: fence-aware block parser 只采信围栏外控制块并保留 REMOVED-ITEMS 声明', () => {
    const delta = [
      '```md', '## MODIFIED — 伪锚', '## 围栏内标题', '```', '',
      `## MODIFIED — ${anchor}`, '', '新正文。', '',
      '~~~md', '## REMOVED — 伪删除', '~~~', '',
      `## REMOVED-ITEMS — ${anchor}`, '', '- UT-S37-01 — 显式退役', '',
    ].join('\n');
    expect(parseDeltaBlocks(delta)).toEqual([
      expect.objectContaining({ op: 'MODIFIED', anchor, markerLine: 5 }),
      expect.objectContaining({ op: 'REMOVED-ITEMS', anchor, markerLine: 13 }),
    ]);
    expect(parseDeltaBlocks(delta)[0].lines.join('\n')).toContain('## REMOVED — 伪删除');
  });

  it('UT-S37-38: heading tree/path/range 唯一解析，重复叶与围栏伪标题不首命中', () => {
    const source = `${before}\n\`\`\`md\n### ${realLeaf}\n\`\`\`\n`;
    const headings = parseMarkdownHeadings(source);
    const hit = resolveSectionAnchor(headings, anchor);
    expect(hit.status).toBe('ok');
    expect(hit.hit).toMatchObject({ level: 3, text: realLeaf, path: ['RunLogos', realParent, realLeaf] });
    expect(source.slice(hit.hit!.start, hit.hit!.end)).toContain('#### 叶下说明');
    expect(source.slice(hit.hit!.start, hit.hit!.end)).not.toContain('## 八、其它规则');
    expect(resolveSectionAnchor(headings, realLeaf)).toMatchObject({ status: 'ambiguous' });
    expect(resolveSectionAnchor(headings, `不存在父级 > ${realLeaf}`)).toMatchObject({ status: 'not_found' });
  });

  it('UT-S37-39: Agent verifier 对 MODIFIED 身份/正文及字面量路径伪标题 fail-closed', () => {
    const delta = `## MODIFIED — ${anchor}\n\n新正文。\n\n#### 叶下说明\n\n保持子标题。\n`;
    const valid = before.replace('旧正文。', '新正文。');
    expect(verifyAgentMaterialOutcome(delta, before, valid).ok).toBe(true);
    const literal = `${before}\n## ${anchor}\n\n新正文。\n`;
    expect(verifyAgentMaterialOutcome(delta, before, literal)).toMatchObject({ ok: false });
    const moved = valid.replace(`## ${realParent}\n\n### ${realLeaf}`, `## 错误父级\n\n### ${realLeaf}`);
    expect(verifyAgentMaterialOutcome(delta, before, moved)).toMatchObject({ ok: false });
    expect(verifyAgentMaterialOutcome(delta, before, valid.replace('新正文。', ''))).toMatchObject({ ok: false });
  });

  it('UT-S37-40 ST-S37-10: OpenLogos composer 用真实 H3 范围改写且声明块不物化', () => {
    const delta = [
      `## MODIFIED — ${anchor}`, '', '新正文。', '', '#### 叶下说明', '', '保持子标题。', '',
      `## REMOVED-ITEMS — ${anchor}`, '', '- UT-S37-01 — 仅作守恒声明', '',
    ].join('\n');
    const output = composeOpenLogosMarkdown(before, delta, 'MODIFY');
    expect(output).toContain(`## ${realParent}\n\n### ${realLeaf}\n\n新正文。`);
    expect(output).toContain('#### 叶下说明');
    expect(output).toContain(`## 八、其它规则\n\n### ${realLeaf}\n\n同名叶。`);
    expect(output).not.toContain(anchor.replace(' > ', ' > '));
    expect(output).not.toContain('UT-S37-01 — 仅作守恒声明');
    expect(verifyAgentMaterialOutcome(delta, before, output).ok).toBe(true);
  });

  it('ST-S37-09: lint 与 Agent transaction verifier 对合法路径和歧义路径结论同源', () => {
    const body = ['新正文。', '', '#### 叶下说明', '', '保持子标题。'].join('\n');
    const pathDelta = `## MODIFIED — ${anchor}\n\n${body}\n`;
    const valid = before.replace('旧正文。', '新正文。');
    expect(evaluateDeltaConservation(pathDelta, before)).toEqual([]);
    expect(verifyAgentMaterialOutcome(pathDelta, before, valid).ok).toBe(true);

    const ambiguousDelta = `## MODIFIED — ${realLeaf}\n\n${body}\n`;
    expect(evaluateDeltaConservation(ambiguousDelta, before).map(item => item.code))
      .toEqual(['delta_section_anchor_unresolvable']);
    expect(verifyAgentMaterialOutcome(ambiguousDelta, before, valid)).toMatchObject({ ok: false });
  });
});
