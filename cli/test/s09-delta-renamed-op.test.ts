/**
 * UT-S09-347 / UT-S09-348 / ST-S09-144：第五个 delta op **`RENAMED`**（章节标题更名）。
 *
 * 规范源：`spec/change-management.md`「Delta `RENAMED` op：章节标题更名」、架构 §五十、
 * 需求 AC-RENAMED-01～07、`logos/resources/test/core-S09-test-cases.md`「S09 delta RENAMED op 测试」。
 *
 * 它是**唯一**能改写标题行、也是唯一能作用于文档级 H1 的 op：`ADDED` 顶层恒发 level 2、
 * `MODIFIED` 的标题行取自被锚定章节的原标题、`REMOVED` 是整节删除。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts）写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeOpenLogosMarkdown, parseDeltaBlocks } from '../src/lib/markdown-section-authority.js';
import { evaluateDeltaConservation, validateMarkdownDelta } from '../src/lib/change-lint.js';
import { cleanupFixtureRoots, frontierFixture, invoke, put } from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

/** 目标文档夹具：文档级 H1 + 两级子章节 + 重复标题（供序数锚）+ 表格条目（供守恒对照）。 */
const TARGET = [
  '# 旧机制：Authority Closure 测试用例',
  '',
  '导语正文，不得被 RENAMED 改动。',
  '',
  '## 一、单元测试',
  '',
  '| ID | 用例 |',
  '|---|---|',
  '| UT-S01-01 | 甲 |',
  '| UT-S01-02 | 乙 |',
  '',
  '### 自动化与证据要求',
  '',
  '- 甲组证据。',
  '',
  '## 二、场景测试',
  '',
  '| ID | 用例 |',
  '|---|---|',
  '| ST-S01-01 | 丙 |',
  '',
  '### 自动化与证据要求',
  '',
  '- 乙组证据。',
  '',
].join('\n');

const compose = (delta: string, before = TARGET) => composeOpenLogosMarkdown(before, delta, 'MODIFY');

/** 取某标题行的层级与文本；找不到返回 null。 */
function heading(doc: string, text: string): { level: number; line: number } | null {
  const lines = doc.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(#{1,6}) (.+)$/.exec(lines[i]);
    if (m && m[2].trim() === text) return { level: m[1].length, line: i };
  }
  return null;
}

/** 章节正文（不含标题行）——用于「正文逐字节不变」的直接比对。 */
function sectionBody(doc: string, title: string): string {
  const lines = doc.split('\n');
  const start = lines.findIndex(l => new RegExp(`^#{1,6} ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(l));
  if (start < 0) return '<未找到>';
  const level = /^(#{1,6}) /.exec(lines[start])![1].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = /^(#{1,6}) /.exec(lines[i]);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start + 1, end).join('\n');
}

describe('S09 — delta RENAMED op', () => {
  it('UT-S09-347: RENAMED 解析与应用（含 H1、层级/正文/位置三不变）', () => {
    // ① H2 小节更名
    const h2 = compose('## RENAMED — 一、单元测试\n\n一、单元测试（订正后）\n');
    expect(heading(h2, '一、单元测试（订正后）')?.level).toBe(2);
    expect(heading(h2, '一、单元测试')).toBeNull();
    expect(sectionBody(h2, '一、单元测试（订正后）')).toBe(sectionBody(TARGET, '一、单元测试'));
    // 位置不变：更名后的标题仍在原行号（非「删后追加到文末」）
    expect(heading(h2, '一、单元测试（订正后）')?.line).toBe(heading(TARGET, '一、单元测试')?.line);

    // ② 文档级 H1 更名——这是唯有 RENAMED 能做的一类
    const h1 = compose('## RENAMED — 旧机制：Authority Closure 测试用例\n\nS09：变更提案合并机制测试用例\n');
    const renamedH1 = heading(h1, 'S09：变更提案合并机制测试用例');
    expect(renamedH1?.level, 'H1 更名后必须仍是 H1').toBe(1);
    expect(renamedH1?.line).toBe(0);
    expect(h1.split('\n').slice(1).join('\n'), 'H1 更名不得改动其后任何字节')
      .toBe(TARGET.split('\n').slice(1).join('\n'));

    // ③ 标题路径锚
    const viaPath = compose('## RENAMED — 二、场景测试 > 自动化与证据要求\n\n证据与自动化要求（场景）\n');
    expect(heading(viaPath, '证据与自动化要求（场景）')?.level).toBe(3);
    expect(sectionBody(viaPath, '证据与自动化要求（场景）')).toBe('\n- 乙组证据。\n');
    expect(viaPath).toContain('### 自动化与证据要求');   // 另一处同名小节原样保留

    // ④ 序数锚在重复标题中精确命中第 2 处
    const viaOrdinal = compose('## RENAMED — 自动化与证据要求 [2]\n\n乙组证据要求\n');
    expect(heading(viaOrdinal, '乙组证据要求')?.level).toBe(3);
    expect(sectionBody(viaOrdinal, '乙组证据要求')).toBe('\n- 乙组证据。\n');
    expect(sectionBody(viaOrdinal, '自动化与证据要求')).toBe('\n- 甲组证据。\n');  // 第 1 处未被动

    // ⑤ 同一 delta 内 RENAMED 后以**新标题**为锚 MODIFIED 该节正文
    const combo = compose([
      '## RENAMED — 一、单元测试',
      '',
      '一、单元测试（订正后）',
      '',
      '## MODIFIED — 一、单元测试（订正后）',
      '',
      '| ID | 用例 |',
      '|---|---|',
      '| UT-S01-01 | 甲（改） |',
      '| UT-S01-02 | 乙 |',
      '',
      '### 自动化与证据要求',
      '',
      '- 甲组证据。',
      '',
    ].join('\n'));
    expect(heading(combo, '一、单元测试（订正后）')?.level).toBe(2);
    expect(combo).toContain('| UT-S01-01 | 甲（改） |');
    expect(combo).toContain('| UT-S01-02 | 乙 |');

    // RENAMED 块被解析为独立 op（不被误吞为 MODIFIED）
    const blocks = parseDeltaBlocks('## RENAMED — 一、单元测试\n\n新名\n');
    expect(blocks.map(b => b.op)).toEqual(['RENAMED']);
    expect(blocks[0].anchor).toBe('一、单元测试');
  });

  it('UT-S09-347: lint 接纳 RENAMED 且不产生条目守恒判定', () => {
    const delta = '## RENAMED — 一、单元测试\n\n一、单元测试（订正后）\n';
    // L4：RENAMED 是物质变更段，不得判「缺段标记」
    const v = validateMarkdownDelta(delta);
    expect(v.missingSectionMarker).toBe(false);
    expect(v.templateSkeleton).toBe(false);
    // L8：不增删条目 → 零守恒判定（若被当作 MODIFIED 对账，整节 ID 会被误判隐式删除）
    expect(evaluateDeltaConservation(delta, TARGET)).toEqual([]);
  });

  it('UT-S09-348: RENAMED 的 fail-closed 反例（拒绝时零改写）', () => {
    // `blockIllegal`：块本身畸形（正文空 / 多行 / 带 `#`）。C04 起 lint 与 merge 对这类形态
    // **统一为拒绝**——此前 lint 侧跳过、merge 侧抛错，同一形态两个结论；现两侧同走
    // `buildRenameMaps` 单点，lint 即报 `delta_section_anchor_unresolvable` 并点名该块。
    // 块合法而**锚**不可解析的两例不属此列：映射表可正常构建，守恒侧照常零判定。
    const cases: Array<[string, string, RegExp, boolean]> = [
      ['锚命中 0 个', '## RENAMED — 不存在的章节\n\n新名\n', /不存在或不唯一/, false],
      ['锚命中多个（未消歧）', '## RENAMED — 自动化与证据要求\n\n新名\n', /不存在或不唯一/, false],
      ['块正文为空', '## RENAMED — 一、单元测试\n\n', /正文为空/, true],
      ['块正文多行', '## RENAMED — 一、单元测试\n\n新名\n第二行\n', /正文有 2 行/, true],
      ['块正文以 # 开头', '## RENAMED — 一、单元测试\n\n## 新名\n', /不得带 # 前缀/, true],
    ];
    for (const [label, delta, pattern, blockIllegal] of cases) {
      expect(() => compose(delta), `${label} 必须拒绝`).toThrow(pattern);
      // 合成是纯函数：抛错即目标文档零改写（无任何中间落盘）
      expect(TARGET, `${label} 后夹具字节不变`).toBe(TARGET);
      // lint 侧同判据：非法块同样不被当作「有效正文」放行
      expect(validateMarkdownDelta(delta).missingSectionMarker, `${label}: 段标记仍应被识别`).toBe(false);
      const conservation = evaluateDeltaConservation(delta, TARGET);
      if (blockIllegal) {
        // C04：两侧统一拒绝——lint 先报，merge 不再是该形态的首次暴露信号
        expect(conservation.map(v => v.code), `${label}: lint 侧同样拒绝`)
          .toEqual(['delta_section_anchor_unresolvable']);
        expect(conservation[0].message, `${label}: 点名该块`).toMatch(pattern);
      } else {
        expect(conservation, `${label}: 块合法，不产生守恒判定`).toEqual([]);
      }
    }
  });

  it('ST-S09-144: 含 RENAMED 的提案端到端 merge（真实 CLI）', () => {
    const f = frontierFixture();
    // 在既有四个 MODIFIED delta 之上，追加一个 RENAMED 块（目标文档 H1 更名）
    const testDelta = join('logos', 'changes', f.slug, 'deltas', 'test', 'core-S01-test-cases.md');
    const existing = readFileSync(join(f.root, testDelta), 'utf8');
    put(f.root, testDelta, `## RENAMED — 文档\n\nS01：初始化 OpenLogos 项目 — 测试用例\n\n${existing}`);

    // ① change-lint 接纳（不判缺段标记、不产生守恒违规）
    const lint = invoke(['change-lint', '--slug', f.slug], f.root);
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);
    expect(lint.stdout).not.toContain('delta_missing_section_marker');
    expect(lint.stdout).not.toContain('delta_implicit_id_removal');

    // ② merge 一次调用成功并写 SPEC_MERGED
    const merged = invoke(['merge', f.slug], f.root);
    expect(merged.status, merged.stdout + merged.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);

    // ③ 目标文档 H1 为新名且层级仍为 H1；正文与既有 MODIFIED 结果并存
    const applied = readFileSync(join(f.root, f.targetPath), 'utf8');
    expect(applied.split('\n')[0]).toBe('# S01：初始化 OpenLogos 项目 — 测试用例');
    expect(applied).toContain('| UT-S01-01 | 新定义 |');   // 同文件的 MODIFIED 照常生效
    expect(applied).not.toContain('# 文档');
    // 其它目标不受影响
    for (const [target, expected] of Object.entries(f.finals)) {
      if (target === f.targetPath) continue;
      expect(readFileSync(join(f.root, target), 'utf8'), target).toBe(expected);
    }
  });
});
