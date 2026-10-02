/**
 * S35 后态测试 ID 重复判据的同源前移（lint-modified-sibling-section-collision，功能规格 §2.85 / §2.84.5）。
 * 覆盖 UT-S35-196～UT-S35-201、ST-S35-36；逐条 ID 由全局 OpenLogos reporter 写入 test-results.jsonl。
 *
 * 夹具全部在一次性隔离项目或内存中构造，不依赖本仓自身提案内容。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';

// **阶段边界的哨兵挂载点**：lint 侧与 merge 侧共同调用同一 `buildTestChangeSet`；对它打 spy 可断言
// post-merge 本判据**未被调用**（阶段判别取既有完成标记，不以「目标是否已含该 ID」推断）。
vi.mock('../src/lib/test-change-set.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/test-change-set.js')>();
  return { ...actual, buildTestChangeSet: vi.fn(actual.buildTestChangeSet) };
});

import {
  AFTER_STATE_LINE_NOTE, buildTestChangeSet, TestChangeSetBuildError, type TestChangeSetInputTarget,
} from '../src/lib/test-change-set.js';
import { composeOpenLogosMarkdown, parseMarkdownHeadings } from '../src/lib/markdown-section-authority.js';
import { validateAndStripNonMarkdownDelta } from '../src/lib/non-markdown-delta.js';
import {
  CHANGE_LINT_VIOLATION_CODES, DELTA_TEST_ID_DUPLICATE_FIX_HINT, runChangeLint, toPublicViolation,
} from '../src/lib/change-lint.js';
import {
  makeTempRoot, mergeAdmissibleProposal, mergeAdmissibleTasks, registerCoreModule, scaffoldProject,
} from './helpers.js';

const spied = vi.mocked(buildTestChangeSet);
const cleanups: Array<() => void> = [];
beforeEach(() => { spied.mockClear(); });
afterEach(() => { spied.mockReset(); while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'after-state-dup-fixture';
const CODE = 'delta_test_id_duplicate';

const TEST_TARGET = 'logos/resources/test/core-S09-test-cases.md';
const TEST_DELTA = 'deltas/test/core-S09-test-cases.md';

/** token-agent 现场同构：五个并列 H2 的测试用例文档。 */
const CANON = [
  '# core-S09: 模型导入测试用例',
  '',
  '## S09: 模型导入 — 测试用例',
  '',
  '> 导言。',
  '',
  '### 测试替身层级要求',
  '',
  '替身说明。',
  '',
  '## 一、单元测试用例',
  '',
  '| ID | 描述 |',
  '|---|---|',
  '| UT-S09-01 | 未授权零调用 |',
  '| UT-S09-02 | 校验失败 |',
  '',
  '## 二、场景测试用例',
  '',
  '| ID | 描述 |',
  '|---|---|',
  '| ST-S09-01 | 导入成功 |',
  '',
  '## 三、覆盖度校验',
  '',
  '覆盖说明。',
  '',
  '## 四、追溯',
  '',
  '- 需求：S09',
  '',
].join('\n');
const CANON_IDS = ['UT-S09-01', 'UT-S09-02', 'ST-S09-01'];

/** 事故形态：只有一个 MODIFIED 块、正文把整份文档（自 `## S09` 标题之后）抄了一遍。 */
const ACCIDENT_DELTA = (() => {
  const lines = CANON.split('\n');
  const start = lines.indexOf('## S09: 模型导入 — 测试用例') + 1;
  return `## MODIFIED — S09: 模型导入 — 测试用例\n\n> 合并说明：本块整篇替换。\n${lines.slice(start).join('\n')}`;
})();
/** 事故 delta 中 `| UT-S09-01 |` 行的 1 基行号（夹具已知值，供 UT-S35-201 精确断言）。 */
const ACCIDENT_UT01_LINE = ACCIDENT_DELTA.split('\n').findIndex(l => l.startsWith('| UT-S09-01 |')) + 1;

/** 拆块形态：每个 H2 各一个同锚 MODIFIED 块，只携带该章节自己的正文。 */
const SPLIT_DELTA = (() => {
  const lines = CANON.split('\n');
  const blocks: string[] = [];
  let title: string | null = null;
  let body: string[] = [];
  const flush = (): void => { if (title !== null) blocks.push(`## MODIFIED — ${title}\n\n${body.join('\n').trim()}\n`); };
  for (const line of lines) {
    if (line.startsWith('## ')) { flush(); title = line.slice(3); body = []; continue; }
    if (title !== null) body.push(line);
  }
  flush();
  return blocks.join('\n');
})();

/** proposal r1 评审反例①：跨父链同名 H3 相对子节（不同 ID）。 */
const CROSS_PARENT_TARGET = [
  '# 规格', '', '## 模块甲', '', '### 行为', '', '旧正文。', '', '## 模块乙', '', '### 事件与最终态交互', '',
  '| ID | 描述 |', '|---|---|', '| UT-S09-01 | 验证行为 |', '',
].join('\n');
const crossParentDelta = (newId: string): string =>
  `## MODIFIED — 模块甲 > 行为\n\n新正文。\n\n### 事件与最终态交互\n\n| ID | 描述 |\n|---|---|\n| ${newId} | 验证行为 |\n`;

/** proposal r1 评审反例②：同父链同名相对子节（不同 ID）。 */
const SAME_PARENT_TARGET = [
  '# 规格', '', '## 导言', '', '旧导言。', '', '## 单元测试', '', '| ID | 描述 |', '|---|---|', '| UT-S09-01 | 验证行为 |', '',
].join('\n');
const SAME_PARENT_DELTA = '## MODIFIED — 导言\n\n新导言。\n\n## 单元测试\n\n| ID | 描述 |\n|---|---|\n| UT-S09-02 | 验证行为 |\n';

/** 正文重复锚自身根标题——序数锚（既有机制接受）与普通锚（合成器既有复验拒绝）两形态。 */
const ROOT_REPEAT_TARGET = '# 规格\n\n## 一、单元测试用例\n\n| ID | 描述 |\n|---|---|\n| UT-S09-01 | 验证行为 |\n';
const rootRepeatDelta = (anchor: string): string =>
  `## MODIFIED — ${anchor}\n## 一、单元测试用例\n| ID | 描述 |\n|---|---|\n| UT-S09-01 | 验证行为 |\n`;

/** 正文仅含更深子标题。 */
const DEEPER_ONLY_DELTA = '## MODIFIED — 一、单元测试用例\n\n### 1.1 子节\n\n| ID | 描述 |\n|---|---|\n| UT-S09-01 | 未授权零调用 |\n| UT-S09-02 | 校验失败 |\n';

const WHOLE_FILE_TARGET = 'logos/resources/test/core-S11-test-cases.md';
const WHOLE_FILE_DELTA = 'deltas/test/core-S11-test-cases.md';
const wholeFileCreate = (target: string, ids: string[]): string =>
  `## ADDED — ${target}（新文件，整文件）\n# S11 测试\n\n| ID | 描述 |\n|---|---|\n${ids.map(id => `| ${id} | 行为 |`).join('\n')}\n`;
/** 整文件夹具中 ID 行的 1 基行号（夹具已知值）：marker / H1 / 空行 / 表头 / 分隔行之后。 */
const wholeFileRowLines = (ids: string[]): number[] => ids.map((_, i) => 6 + i);

interface Fixture { root: string; proposalDir: string }

function setup(deltas: Record<string, string>, seedTargets: Record<string, string> = {}): Fixture {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root, 'launched');
  const proposalDir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(proposalDir, 'proposal.md'), mergeAdmissibleProposal());
  writeFileSync(join(proposalDir, 'tasks.md'),
    `${mergeAdmissibleTasks(Object.keys(deltas).map(p => `- [ ] 产出 delta 到 \`${p}\`。`))}\n## [code] 代码实现\n`);
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  for (const [rel, content] of Object.entries(deltas)) {
    const abs = join(proposalDir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const [rel, content] of Object.entries(seedTargets)) {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { root, proposalDir };
}

function lint(f: Fixture) {
  const out = runChangeLint(f.root, f.proposalDir, SLUG);
  if (!out.ok) throw new Error(out.message);
  return out;
}

function cliLintJson(f: Fixture) {
  const run = spawnSync(process.execPath, [CLI, 'change-lint', '--slug', SLUG, '--format', 'json'], {
    cwd: f.root, encoding: 'utf8', timeout: 120000,
  });
  return { status: run.status, json: JSON.parse(run.stdout) as { data: { pass: boolean; violations: Array<Record<string, unknown>> } } };
}

function merge(f: Fixture) {
  // vitest 全局注入 `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY=1`（只产 MERGE_PROMPT.md 不落盘）；
  // 本片验的是直接合并的真实结论，必须显式关掉它。
  return spawnSync(process.execPath, [CLI, 'merge', SLUG], {
    cwd: f.root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
  });
}

function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) { walk(abs); continue; }
      out.set(relative(root, abs).replace(/\\/g, '/'), createHash('sha256').update(readFileSync(abs)).digest('hex'));
    }
  };
  walk(root);
  return out;
}

const dupViolations = (out: ReturnType<typeof lint>) => out.violations.filter(v => v.code === CODE);
const codesOf = (out: ReturnType<typeof lint>) => out.violations.map(v => v.code);
const idsOf = (text: string): string[] =>
  text.split('\n').map(l => /^\|\s*((?:UT|ST)-S\d{2}-\d+)\s*\|/.exec(l)?.[1]).filter((x): x is string => !!x);

/** 后态侧：按 merge 口径求目标集合后调用**真实** buildTestChangeSet；返回抛出的错误码或 null。 */
function afterStateVerdict(targets: TestChangeSetInputTarget[]): string | null {
  try {
    buildTestChangeSet({ change: SLUG, module: 'core', targets });
    return null;
  } catch (e) {
    return e instanceof TestChangeSetBuildError ? e.code : `other:${e instanceof Error ? e.message : String(e)}`;
  }
}
function sectionAfter(targetPath: string, before: string | null, delta: string): TestChangeSetInputTarget {
  const after = composeOpenLogosMarkdown(before ?? '', delta, before === null ? 'CREATE' : 'MODIFY');
  return { targetPath, beforeBytes: before === null ? null : Buffer.from(before), afterBytes: Buffer.from(after) };
}
function wholeFileAfter(targetPath: string, delta: string): TestChangeSetInputTarget {
  const checked = validateAndStripNonMarkdownDelta(delta, 'CREATE', targetPath);
  if (!checked.ok || typeof checked.payload !== 'string') throw new Error(checked.message ?? '封装不合法');
  return { targetPath, beforeBytes: null, afterBytes: Buffer.from(checked.payload) };
}

describe('S35 后态测试 ID 重复判据的同源前移', () => {
  it('UT-S35-196: 事故形态必红——单块整篇 MODIFIED 吞并兄弟章节 → delta_test_id_duplicate（修复前 PASS）', () => {
    const f = setup({ [TEST_DELTA]: ACCIDENT_DELTA }, { [TEST_TARGET]: CANON });
    const out = lint(f);
    const dup = dupViolations(out);
    expect(dup.length).toBe(1);
    expect(out.violations.length).toBeGreaterThan(0); // 准入结论 = 违规非空（与 merge 预检同源）
    const v = dup[0];
    expect(v.path).toBe(`logos/changes/${SLUG}/${TEST_DELTA}`);
    expect(v.check_layer).toBe(4);
    // message 四项：后态目标与行号口径 / 重复裸 ID / delta 侧归属 / 诊断信号。
    expect(v.message).toContain(TEST_TARGET);
    expect(v.message).toContain(AFTER_STATE_LINE_NOTE);
    expect(v.message).toMatch(/测试 ID UT-S09-01 重复/);
    expect(v.message).toContain(`本 delta 第 ${ACCIDENT_UT01_LINE} 行`);
    expect(v.message).toContain('疑似整篇改写吞并兄弟章节「一、单元测试用例」');
    expect(v.fix_hint).toContain('为每个被改写的同级章节各写一个 `## MODIFIED — <章节标题>` 块');
    expect(v.fix_hint).toBe(DELTA_TEST_ID_DUPLICATE_FIX_HINT);
    // 后态侧确实以 duplicate-id 拒绝——前移的是它本身。
    expect(afterStateVerdict([sectionAfter(TEST_TARGET, CANON, ACCIDENT_DELTA)])).toBe('test-change-set-duplicate-id');
  });

  it('UT-S35-197: 拆块版本必绿——每个 H2 各一个同锚 MODIFIED → 零该码，后态 ID 集合 == 前态', () => {
    const f = setup({ [TEST_DELTA]: SPLIT_DELTA }, { [TEST_TARGET]: CANON });
    const out = lint(f);
    expect(dupViolations(out)).toEqual([]);
    expect(out.violations).toEqual([]);
    const target = sectionAfter(TEST_TARGET, CANON, SPLIT_DELTA);
    expect(idsOf(target.afterBytes.toString('utf8'))).toEqual(CANON_IDS);
    expect(afterStateVerdict([target])).toBeNull();
  });

  it('UT-S35-198: 合法下沉反例必绿——四种写法零该码，且后态 buildTestChangeSet 通过', () => {
    const cases: Array<[string, string, string, (after: string) => void]> = [
      ['① 跨父链同名 H3 相对子节', CROSS_PARENT_TARGET, crossParentDelta('UT-S09-02'), (after) => {
        const hs = parseMarkdownHeadings(after).map(h => `${'#'.repeat(h.level)} ${h.text}`);
        expect(hs).toContain('#### 事件与最终态交互');
        expect(hs.filter(h => h === '### 事件与最终态交互').length).toBe(1); // 模块乙原 H3 保留
        expect(idsOf(after).sort()).toEqual(['UT-S09-01', 'UT-S09-02']);
      }],
      ['② 同父链同名不同 ID', SAME_PARENT_TARGET, SAME_PARENT_DELTA, (after) => {
        const hs = parseMarkdownHeadings(after).map(h => `${'#'.repeat(h.level)} ${h.text}`);
        expect(hs).toContain('### 单元测试');
        expect(hs).toContain('## 单元测试');
        expect(idsOf(after).sort()).toEqual(['UT-S09-01', 'UT-S09-02']);
      }],
      ['③ 序数锚下正文重复根标题', ROOT_REPEAT_TARGET, rootRepeatDelta('一、单元测试用例 [1]'), (after) => {
        const hs = parseMarkdownHeadings(after).map(h => `${'#'.repeat(h.level)} ${h.text}`);
        expect(hs).toEqual(['# 规格', '## 一、单元测试用例', '### 一、单元测试用例']);
        expect(idsOf(after)).toEqual(['UT-S09-01']);
      }],
      ['④ 正文仅含更深子标题', CANON, DEEPER_ONLY_DELTA, (after) => {
        expect(idsOf(after)).toEqual(CANON_IDS);
      }],
    ];
    for (const [name, target, delta, check] of cases) {
      const f = setup({ [TEST_DELTA]: delta }, { [TEST_TARGET]: target });
      const out = lint(f);
      expect(dupViolations(out), name).toEqual([]);
      expect(out.violations, name).toEqual([]);
      // 后态确实接受——证明前移集合的扩大部分恰为后态已拒形态、未新拒后态接纳的形态。
      const t = sectionAfter(TEST_TARGET, target, delta);
      expect(afterStateVerdict([t]), name).toBeNull();
      check(t.afterBytes.toString('utf8'));
    }
  });

  it('UT-S35-199: 一致性锁按码整族双向比对——单目标内 / 触及目标间全部形态，任一侧单独收紧即失败', () => {
    const S10_TARGET = 'logos/resources/test/core-S10-test-cases.md';
    const S10_DELTA = 'deltas/test/core-S10-test-cases.md';
    const s10Create = (id: string) => `## ADDED — S10 测试\n\n| ID | 描述 |\n|---|---|\n| ${id} | 行为 |\n`;
    const addRow = (id: string) => SPLIT_DELTA.replace('| UT-S09-02 | 校验失败 |', `| UT-S09-02 | 校验失败 |\n| ${id} | 新增 |`);
    const addToSection3 = (id: string) => SPLIT_DELTA.replace('覆盖说明。', `覆盖说明。\n\n| ID | 描述 |\n|---|---|\n| ${id} | 新增 |`);

    type Case = { name: string; deltas: Record<string, string>; seeds: Record<string, string>; afterTargets: () => TestChangeSetInputTarget[]; expectDup: string[] };
    const cases: Case[] = [
      // —— 单目标内重复 ——
      { name: '整篇吞并兄弟章节', deltas: { [TEST_DELTA]: ACCIDENT_DELTA }, seeds: { [TEST_TARGET]: CANON },
        afterTargets: () => [sectionAfter(TEST_TARGET, CANON, ACCIDENT_DELTA)], expectDup: [TEST_DELTA] },
      { name: '同一目标两章节各自新增同 ID', deltas: { [TEST_DELTA]: addToSection3('UT-S09-07').replace('| UT-S09-02 | 校验失败 |', '| UT-S09-02 | 校验失败 |\n| UT-S09-07 | 新增 |') }, seeds: { [TEST_TARGET]: CANON },
        afterTargets: () => [sectionAfter(TEST_TARGET, CANON, addToSection3('UT-S09-07').replace('| UT-S09-02 | 校验失败 |', '| UT-S09-02 | 校验失败 |\n| UT-S09-07 | 新增 |'))], expectDup: [TEST_DELTA] },
      { name: '新增 ID 与保留章节既有 ID 重复', deltas: { [TEST_DELTA]: addToSection3('UT-S09-01') }, seeds: { [TEST_TARGET]: CANON },
        afterTargets: () => [sectionAfter(TEST_TARGET, CANON, addToSection3('UT-S09-01'))], expectDup: [TEST_DELTA] },
      { name: '整文件 CREATE payload 内重复', deltas: { [WHOLE_FILE_DELTA]: wholeFileCreate(WHOLE_FILE_TARGET, ['UT-S09-08', 'UT-S09-08']) }, seeds: {},
        afterTargets: () => [wholeFileAfter(WHOLE_FILE_TARGET, wholeFileCreate(WHOLE_FILE_TARGET, ['UT-S09-08', 'UT-S09-08']))], expectDup: [WHOLE_FILE_DELTA] },
      // —— 触及目标间重复 ——
      { name: '两个 test delta 各自新增同 ID', deltas: { [TEST_DELTA]: addRow('UT-S09-09'), [S10_DELTA]: s10Create('UT-S09-09') }, seeds: { [TEST_TARGET]: CANON },
        afterTargets: () => [sectionAfter(TEST_TARGET, CANON, addRow('UT-S09-09')), sectionAfter(S10_TARGET, null, s10Create('UT-S09-09'))], expectDup: [TEST_DELTA, S10_DELTA] },
      { name: '章节 CREATE 与 MODIFY 既有 ID 重复', deltas: { [TEST_DELTA]: SPLIT_DELTA, [S10_DELTA]: s10Create('UT-S09-01') }, seeds: { [TEST_TARGET]: CANON },
        afterTargets: () => [sectionAfter(TEST_TARGET, CANON, SPLIT_DELTA), sectionAfter(S10_TARGET, null, s10Create('UT-S09-01'))], expectDup: [TEST_DELTA, S10_DELTA] },
      { name: '整文件 CREATE 与章节 MODIFY 跨目标重复', deltas: { [TEST_DELTA]: SPLIT_DELTA, [WHOLE_FILE_DELTA]: wholeFileCreate(WHOLE_FILE_TARGET, ['UT-S09-01']) }, seeds: { [TEST_TARGET]: CANON },
        afterTargets: () => [sectionAfter(TEST_TARGET, CANON, SPLIT_DELTA), wholeFileAfter(WHOLE_FILE_TARGET, wholeFileCreate(WHOLE_FILE_TARGET, ['UT-S09-01']))], expectDup: [TEST_DELTA, WHOLE_FILE_DELTA] },
      // —— 已修正版本与合法下沉 ——
      { name: '已修正：拆块', deltas: { [TEST_DELTA]: SPLIT_DELTA }, seeds: { [TEST_TARGET]: CANON },
        afterTargets: () => [sectionAfter(TEST_TARGET, CANON, SPLIT_DELTA)], expectDup: [] },
      { name: '已修正：改名', deltas: { [TEST_DELTA]: addRow('UT-S09-09'), [S10_DELTA]: s10Create('UT-S09-10') }, seeds: { [TEST_TARGET]: CANON },
        afterTargets: () => [sectionAfter(TEST_TARGET, CANON, addRow('UT-S09-09')), sectionAfter(S10_TARGET, null, s10Create('UT-S09-10'))], expectDup: [] },
      { name: '合法：跨父链同名', deltas: { [TEST_DELTA]: crossParentDelta('UT-S09-02') }, seeds: { [TEST_TARGET]: CROSS_PARENT_TARGET },
        afterTargets: () => [sectionAfter(TEST_TARGET, CROSS_PARENT_TARGET, crossParentDelta('UT-S09-02'))], expectDup: [] },
      { name: '合法：同父链同名不同 ID', deltas: { [TEST_DELTA]: SAME_PARENT_DELTA }, seeds: { [TEST_TARGET]: SAME_PARENT_TARGET },
        afterTargets: () => [sectionAfter(TEST_TARGET, SAME_PARENT_TARGET, SAME_PARENT_DELTA)], expectDup: [] },
    ];
    for (const c of cases) {
      const out = lint(setup(c.deltas, c.seeds));
      const lintSide = dupViolations(out).map(v => v.path.replace(`logos/changes/${SLUG}/`, '')).sort();
      const afterSide = afterStateVerdict(c.afterTargets());
      // 两侧结论逐夹具一致：后态以 duplicate-id 拒 ⇔ 预检报本码（涉事 delta 各报一条）。
      expect(afterSide, c.name).toBe(c.expectDup.length > 0 ? 'test-change-set-duplicate-id' : null);
      expect(lintSide, c.name).toEqual([...c.expectDup].sort());
      // 本码之外不得有其它违规（夹具本身合法）。
      expect(codesOf(out).filter(code => code !== CODE), c.name).toEqual([]);
    }
    // **注入式反证臂**：单独改为逐目标调用（不按集合）——触及目标间的形态后态侧不再被拒，
    // 与按集合调用的结论相反，证明锁覆盖的是集合口径而非仅单目标扫描。
    for (const c of cases.filter(x => x.expectDup.length === 2)) {
      const perTarget = c.afterTargets().map(t => afterStateVerdict([t]));
      expect(perTarget, c.name).toEqual([null, null]);
      expect(afterStateVerdict(c.afterTargets()), c.name).toBe('test-change-set-duplicate-id');
    }
    // 边界断言：`-target-duplicate` 不纳入比对——同一 targetPath 送两次由后态以该码拒，预检不报本码。
    const twice = [sectionAfter(TEST_TARGET, CANON, SPLIT_DELTA), sectionAfter(TEST_TARGET, CANON, SPLIT_DELTA)];
    expect(afterStateVerdict(twice)).toBe('test-change-set-target-duplicate');
  });

  it('UT-S35-200: 阶段边界、通道闸与不双报——六夹具', () => {
    // ① SPEC_MERGED 后不重放：拆块夹具真实合并后重跑 lint，零该码且判据未被调用（哨兵）。
    const merged = setup({ [TEST_DELTA]: SPLIT_DELTA }, { [TEST_TARGET]: CANON });
    spied.mockClear();
    expect(dupViolations(lint(merged))).toEqual([]);
    expect(spied.mock.calls.length).toBe(1); // merge 前：本判据对集合恰调用一次
    const run = merge(merged);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(join(merged.proposalDir, 'SPEC_MERGED'))).toBe(true);
    spied.mockClear();
    const before = snapshot(merged.root);
    const after = lint(merged);
    expect(dupViolations(after)).toEqual([]);
    expect(after.violations).toEqual([]);
    expect(spied.mock.calls).toEqual([]); // post-merge 未重放
    expect(snapshot(merged.root)).toEqual(before); // 项目级零写入

    // ② 他因失败不纳入：锚不可解析的 delta 只报既有锚码，集合中另一 delta 照常报本码。
    const S12_TARGET = 'logos/resources/test/core-S12-test-cases.md';
    const S12_DELTA = 'deltas/test/core-S12-test-cases.md';
    const mixed = setup(
      { [TEST_DELTA]: ACCIDENT_DELTA, [S12_DELTA]: '## MODIFIED — 不存在的章节\n\n正文。\n' },
      { [TEST_TARGET]: CANON, [S12_TARGET]: '# S12\n\n## 一、单元测试用例\n\n| ID | 描述 |\n|---|---|\n| UT-S12-01 | x |\n' },
    );
    const mixedOut = lint(mixed);
    expect(mixedOut.violations.filter(v => v.code === 'delta_section_anchor_unresolvable').map(v => v.path))
      .toEqual([`logos/changes/${SLUG}/${S12_DELTA}`]);
    expect(dupViolations(mixedOut).map(v => v.path)).toEqual([`logos/changes/${SLUG}/${TEST_DELTA}`]);

    // ③ 后态同时 ambiguous-table：只报列数码、不报本码（不双报）。
    const shape = ACCIDENT_DELTA.replace('| UT-S09-02 | 校验失败 |', '| UT-S09-02 | 校验失败 | 多出一格 |');
    const shapeOut = lint(setup({ [TEST_DELTA]: shape }, { [TEST_TARGET]: CANON }));
    expect(codesOf(shapeOut)).toContain('delta_test_table_column_mismatch');
    expect(dupViolations(shapeOut)).toEqual([]);
    expect(afterStateVerdict([sectionAfter(TEST_TARGET, CANON, shape)])).toBe('test-change-set-ambiguous-table');

    // ④ 合法 Markdown 整文件 CREATE payload 内重复：本码必报（ID 检查集合不按通道排除）。
    const wf = setup({ [WHOLE_FILE_DELTA]: wholeFileCreate(WHOLE_FILE_TARGET, ['UT-S09-08', 'UT-S09-08']) });
    const wfOut = lint(wf);
    expect(dupViolations(wfOut).map(v => v.path)).toEqual([`logos/changes/${SLUG}/${WHOLE_FILE_DELTA}`]);
    expect(dupViolations(wfOut)[0].message).toContain(`本 delta 第 ${wholeFileRowLines(['a', 'b']).join('、')} 行`);
    expect(dupViolations(wfOut)[0].message).not.toContain('疑似整篇改写'); // 整文件无章节锚，不参与信号判定
    expect(codesOf(wfOut)).toEqual([CODE]);

    // ⑤ 封装不合法的整文件 delta：只报 non_markdown_delta_invalid、不纳入集合。
    const badEnvelope = setup({ [WHOLE_FILE_DELTA]: wholeFileCreate('logos/resources/test/other.md', ['UT-S09-08', 'UT-S09-08']) });
    const badOut = lint(badEnvelope);
    expect(codesOf(badOut)).toContain('non_markdown_delta_invalid');
    expect(dupViolations(badOut)).toEqual([]);

    // ⑥ 普通锚下正文重复根标题：合成器既有复验拒绝 → 不纳入集合、本码不报；且不得为此放宽复验。
    const plain = rootRepeatDelta('一、单元测试用例');
    expect(() => composeOpenLogosMarkdown(ROOT_REPEAT_TARGET, plain, 'MODIFY')).toThrow(/MODIFIED 章节身份不守恒/);
    const plainOut = lint(setup({ [TEST_DELTA]: plain }, { [TEST_TARGET]: ROOT_REPEAT_TARGET }));
    expect(dupViolations(plainOut)).toEqual([]);
  });

  it('UT-S35-201: 诊断信号与判定正交、delta 侧归属精确、公开键集合不变', () => {
    const publicKeys = (v: Parameters<typeof toPublicViolation>[0]) => Object.keys(toPublicViolation(v));
    // ① 同父链同级同名命中：message 含提示与碰撞标题文本；行号从 message 解析并对夹具已知值精确比对。
    const hit = dupViolations(lint(setup({ [TEST_DELTA]: ACCIDENT_DELTA }, { [TEST_TARGET]: CANON })))[0];
    expect(hit.message).toContain('疑似整篇改写吞并兄弟章节「一、单元测试用例」「二、场景测试用例」');
    expect(/本 delta 第 (\d+) 行/.exec(hit.message)?.[1]).toBe(String(ACCIDENT_UT01_LINE));
    expect(hit.message).toContain(AFTER_STATE_LINE_NOTE);
    expect(publicKeys(hit)).toEqual(['code', 'path', 'message', 'fix_hint']);
    expect('line' in toPublicViolation(hit)).toBe(false);

    // ② 跨父链同名且新增 ID 恰与既有 ID 重复：违规照报，但 message 不含提示（信号未命中不影响判定）。
    const crossDelta = crossParentDelta('UT-S09-01');
    const cross = dupViolations(lint(setup({ [TEST_DELTA]: crossDelta }, { [TEST_TARGET]: CROSS_PARENT_TARGET })));
    expect(cross.length).toBe(1);
    expect(cross[0].message).not.toContain('疑似整篇改写');
    const crossLine = crossDelta.split('\n').findIndex(l => l.startsWith('| UT-S09-01 |')) + 1;
    expect(/本 delta 第 (\d+) 行/.exec(cross[0].message)?.[1]).toBe(String(crossLine));
    expect(publicKeys(cross[0])).toEqual(['code', 'path', 'message', 'fix_hint']);

    // ③ RENAMED 折算（复用 mapAnchorText 单点）：
    //   ③a 锚章节被同 delta 改名、MODIFIED 用新名作锚——信号判定须把新名折算回合并前标题才能解析到 hit。
    const anchorRenamed = `## RENAMED — S09: 模型导入 — 测试用例\n\nS09: 模型导入测试\n\n`
      + ACCIDENT_DELTA.replace('## MODIFIED — S09: 模型导入 — 测试用例', '## MODIFIED — S09: 模型导入测试');
    const renA = dupViolations(lint(setup({ [TEST_DELTA]: anchorRenamed }, { [TEST_TARGET]: CANON })));
    expect(renA.length).toBe(1);
    expect(renA[0].message).toContain('疑似整篇改写吞并兄弟章节「一、单元测试用例」');
    expect(renA[0].message).toContain('锚章节「S09: 模型导入测试」');
    //   ③b 兄弟章节被同 delta 改名、正文沿用旧名——折算后与合并前标题一致，信号照常命中。
    //   （正文若使用新名，合成后同名 H2/H3 并存会让 RENAMED 的身份复验判歧义——那是合成器既有拒绝，
    //     不是本判据的形态，故不作为必过夹具。）
    const siblingRenamed = `## RENAMED — 二、场景测试用例\n\n二、场景用例\n\n${ACCIDENT_DELTA}`;
    const renB = dupViolations(lint(setup({ [TEST_DELTA]: siblingRenamed }, { [TEST_TARGET]: CANON })));
    expect(renB.length).toBe(1);
    expect(renB[0].message).toContain('「二、场景测试用例」');

    // ④ ID 在 delta 内多次出现时逐行列出（按夹具已知行号精确比对）。
    const wfOut = lint(setup({ [WHOLE_FILE_DELTA]: wholeFileCreate(WHOLE_FILE_TARGET, ['UT-S09-08', 'UT-S09-08']) }));
    expect(dupViolations(wfOut)[0].message).toContain(`本 delta 第 ${wholeFileRowLines(['a', 'b']).join('、')} 行`);

    // 回归锚：新码已入闭合码表 L4 族，紧随 delta_test_table_duplicate_header。
    const codes = [...CHANGE_LINT_VIOLATION_CODES];
    expect(codes[codes.indexOf('delta_test_table_duplicate_header') + 1]).toBe(CODE);
  });

  it('ST-S35-36: 真实 CLI 端到端——事故形态在 write-delta 节点闭环，合法下沉不受影响', () => {
    // 步骤①：真实 change-lint --format json。
    const bad = setup({ [TEST_DELTA]: ACCIDENT_DELTA }, { [TEST_TARGET]: CANON });
    const badBefore = snapshot(bad.root);
    const { status, json } = cliLintJson(bad);
    expect(status).toBe(2);
    expect(json.data.pass).toBe(false);
    const v = json.data.violations.find(x => x.code === CODE);
    expect(v).toBeDefined();
    expect(v!.path).toBe(`logos/changes/${SLUG}/${TEST_DELTA}`);
    expect(String(v!.message)).toContain(`本 delta 第 ${ACCIDENT_UT01_LINE} 行`);
    expect(String(v!.message)).toContain(AFTER_STATE_LINE_NOTE);
    expect(String(v!.fix_hint)).toContain('## MODIFIED — <章节标题>');
    expect(Object.keys(v!)).toEqual(['code', 'path', 'message', 'fix_hint']);
    expect(snapshot(bad.root)).toEqual(badBefore); // 步骤⑤：lint 项目级零写入
    // 步骤②：真实 merge 于「change-lint 未通过」预检出口拒绝（修复前退出于合成期 test-change-set-duplicate-id）。
    const badMerge = merge(bad);
    expect(badMerge.status).not.toBe(0);
    expect(badMerge.stderr).toContain('change-lint 未通过');
    expect(badMerge.stderr).toContain(CODE);
    expect(badMerge.stderr).not.toContain('merge 失败（test-change-set-duplicate-id）');
    expect(existsSync(join(bad.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(snapshot(bad.root)).toEqual(badBefore); // 目标字节不变

    // 步骤③：拆块后 lint PASS、真实 merge 成功、后态 ID 无重复。
    const good = setup({ [TEST_DELTA]: SPLIT_DELTA }, { [TEST_TARGET]: CANON });
    const goodLint = cliLintJson(good);
    expect(goodLint.status).toBe(0);
    expect(goodLint.json.data.pass).toBe(true);
    const goodMerge = merge(good);
    expect(goodMerge.status, goodMerge.stderr).toBe(0);
    expect(existsSync(join(good.proposalDir, 'SPEC_MERGED'))).toBe(true);
    expect(idsOf(readFileSync(join(good.root, ...TEST_TARGET.split('/')), 'utf8'))).toEqual(CANON_IDS);

    // 步骤④：合法下沉臂——跨父链同名 H3 相对子节 lint PASS、merge 成功、合并后为 H4 子节。
    const legal = setup({ [TEST_DELTA]: crossParentDelta('UT-S09-02') }, { [TEST_TARGET]: CROSS_PARENT_TARGET });
    expect(cliLintJson(legal).json.data.pass).toBe(true);
    const legalMerge = merge(legal);
    expect(legalMerge.status, legalMerge.stderr).toBe(0);
    const landed = readFileSync(join(legal.root, ...TEST_TARGET.split('/')), 'utf8');
    expect(landed).toContain('#### 事件与最终态交互');
    expect(idsOf(landed).sort()).toEqual(['UT-S09-01', 'UT-S09-02']);
  });
});
