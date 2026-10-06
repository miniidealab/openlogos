/**
 * S35 后态对目标既有测试欠债的继承口径（fix-inherited-test-debt-merge-block，功能规格 §2.86 / §2.84.2 /
 * §2.84.5 / §2.85.3）。覆盖 UT-S35-202～UT-S35-215、ST-S35-37；逐条 ID 由全局 OpenLogos reporter 写入
 * test-results.jsonl。
 *
 * 每条 UT 同时断言两侧：一侧真实 `runChangeLint`（delta 形态），一侧以与 merge 同一合成器
 * `composeOpenLogosMarkdown` 求后态后调用真实 `buildTestChangeSet`。夹具全部在一次性隔离项目内构造。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';

// 哨兵挂载点：断言 lint 送入判据的目标集合（UT-S35-211 ④）与 post-merge 不重合成（UT-S35-215）。
vi.mock('../src/lib/test-change-set.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/test-change-set.js')>();
  return { ...actual, buildTestChangeSet: vi.fn(actual.buildTestChangeSet) };
});
vi.mock('../src/lib/markdown-section-authority.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/markdown-section-authority.js')>();
  return { ...actual, composeOpenLogosMarkdown: vi.fn(actual.composeOpenLogosMarkdown) };
});

import {
  buildTestChangeSet, forwardMergeTestChangeSets, inheritedAmbiguousRowKeys, isInheritedAmbiguousRow,
  TestChangeSetBuildError, TEST_CHANGE_SET_SCHEMA, type TestChangeSetInputTarget, type TestChangeSetV1,
} from '../src/lib/test-change-set.js';
import { composeOpenLogosMarkdown } from '../src/lib/markdown-section-authority.js';
import { findTestTableShapeViolations, runChangeLint } from '../src/lib/change-lint.js';
import { lintSpecsIn } from '../src/commands/lint-specs.js';
import {
  makeTempRoot, mergeAdmissibleProposal, mergeAdmissibleTasks, registerCoreModule, scaffoldProject,
} from './helpers.js';

const buildSpy = vi.mocked(buildTestChangeSet);
const composeSpy = vi.mocked(composeOpenLogosMarkdown);
const cleanups: Array<() => void> = [];
beforeEach(() => { buildSpy.mockClear(); composeSpy.mockClear(); });
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'inherited-debt-fixture';
const COL = 'delta_test_table_column_mismatch';
const DUP = 'delta_test_id_duplicate';
const AMBIGUOUS = 'test-change-set-ambiguous-table';
const DUPLICATE = 'test-change-set-duplicate-id';

const testTarget = (n: string) => `logos/resources/test/core-${n}-test-cases.md`;
const testDelta = (n: string) => `deltas/test/core-${n}-test-cases.md`;

// —— 宿主现场复刻：S68 表头 4 列、ST-S68-05 / ST-S68-06 两行 5 列 ——
const S68_DEBT_ROWS = ['| ST-S68-05 | 欠债 | 一 | 二 | 三 |', '| ST-S68-06 | 欠债二 | 一 | 二 | 三 |'];
const s68 = (rows: string[]) => [
  '# core-S68 测试用例', '', '## S68 场景测试', '',
  '| ID | 场景 | 步骤 | 断言 |', '|---|---|---|---|', '| ST-S68-01 | 正常 | 一 | 通过 |', ...rows, '',
].join('\n');
const S68_CANON = s68(S68_DEBT_ROWS);
const S68_CLEAN = s68([]);
const S68_ADDED = '## ADDED — S68 补充用例\n\n| ID | 描述 |\n|---|---|\n| UT-S68-20 | 新增 |\n';
const s68Modified = (rows: string[]) =>
  `## MODIFIED — S68 场景测试\n\n| ID | 场景 | 步骤 | 断言 |\n|---|---|---|---|\n${rows.join('\n')}\n`;
const S68_CARRY = s68Modified(['| ST-S68-01 | 正常 | 一 | 通过（新） |', ...S68_DEBT_ROWS]);

// —— 宿主现场复刻：S37 同文件重复 ID ——
const s37 = (rows: string[]) => [
  '# core-S37 测试用例', '', '## S37 单元测试', '', '| ID | 描述 |', '|---|---|', ...rows, '',
].join('\n');
const S37_ROWS = ['| UT-S37-01 | 定义甲 |', '| UT-S37-01 | 定义乙 |', '| UT-S37-02 | 其它 |'];
const S37_CANON = s37(S37_ROWS);
const S37_ADDED = '## ADDED — S37 补充用例\n\n| ID | 描述 |\n|---|---|\n| UT-S37-30 | 新增 |\n';
const s37Modified = (rows: string[]) => `## MODIFIED — S37 单元测试\n\n| ID | 描述 |\n|---|---|\n${rows.join('\n')}\n`;

// —— 评审 F1 / F2 夹具：表头 3 列，UT-S01-01 一行 4 列（欠债 r） ——
const R = '| UT-S01-01 | 历史 | 条件 | 结果 |';
const s01 = (rows: string[], extra = '') => [
  '# core-S01 测试用例', '', '## 单元测试', '', '| ID | 描述 | 预期 |', '|---|---|---|', ...rows, '', extra,
].join('\n');
const s01Modified = (rows: string[], anchor = '单元测试') =>
  `## MODIFIED — ${anchor}\n\n| ID | 描述 | 预期 |\n|---|---|---|\n${rows.join('\n')}\n`;

interface Fixture { root: string; proposalDir: string }
type Files = Record<string, string>;

function setup(deltas: Files, seeds: Files = {}): Fixture {
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
  for (const [rel, content] of Object.entries(deltas)) put(proposalDir, rel, content);
  for (const [rel, content] of Object.entries(seeds)) put(root, rel, content);
  return { root, proposalDir };
}
function put(base: string, rel: string, content: string): void {
  const abs = join(base, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function lint(f: Fixture) {
  const out = runChangeLint(f.root, f.proposalDir, SLUG);
  if (!out.ok) throw new Error(out.message);
  return out;
}
const codesOf = (out: ReturnType<typeof lint>) => out.violations.map(v => v.code);

/** 后态侧：按 merge 口径（只含本次 delta 触及的目标）求后态并调用真实判据。 */
function afterTargets(deltas: Files, seeds: Files): TestChangeSetInputTarget[] {
  return Object.entries(deltas).map(([deltaRel, delta]) => {
    const targetPath = `logos/resources/${deltaRel.slice('deltas/'.length)}`;
    const before = seeds[targetPath] ?? null;
    const after = composeOpenLogosMarkdown(before ?? '', delta, before === null ? 'CREATE' : 'MODIFY');
    return { targetPath, beforeBytes: before === null ? null : Buffer.from(before), afterBytes: Buffer.from(after) };
  });
}
function afterVerdict(targets: TestChangeSetInputTarget[]): { code: string | null; set: TestChangeSetV1 | null } {
  try {
    return { code: null, set: buildTestChangeSet({ change: SLUG, module: 'core', targets }) };
  } catch (e) {
    return { code: e instanceof TestChangeSetBuildError ? e.code : `other:${String(e)}`, set: null };
  }
}

interface Case { name: string; deltas: Files; seeds: Files; reject: 'column' | 'dup' | null }
/** 两侧结论：lint 侧的继承相关码 + 后态侧错误码。 */
function bothSides(c: Case) {
  const out = lint(setup(c.deltas, c.seeds));
  const after = afterVerdict(afterTargets(c.deltas, c.seeds));
  return { out, lintCodes: codesOf(out), after };
}
function expectCase(c: Case) {
  const { out, lintCodes, after } = bothSides(c);
  if (c.reject === null) {
    expect(out.violations, c.name).toEqual([]);
    expect(after.code, c.name).toBeNull();
  } else if (c.reject === 'column') {
    expect(lintCodes, c.name).toContain(COL);
    expect(after.code, c.name).toBe(AMBIGUOUS);
  } else {
    expect(lintCodes, c.name).toContain(DUP);
    expect(after.code, c.name).toBe(DUPLICATE);
  }
  return { out, after };
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
function cli(f: Fixture, args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: f.root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
  });
}
function cliLintJson(f: Fixture) {
  const run = cli(f, ['change-lint', '--slug', SLUG, '--format', 'json']);
  return { status: run.status, stderr: run.stderr,
    json: JSON.parse(run.stdout) as { data: { pass: boolean; violations: Array<{ code: string; message: string }> } } };
}

// —— 全部继承夹具（UT-S35-212 双向比对的集合） ——
const S70 = '# core-S70\n\n## S70 用例\n\n| ID | 描述 |\n|---|---|\n| UT-S70-01 | 甲 |\n';
const S71 = '# core-S71\n\n## S71 用例\n\n| ID | 描述 |\n|---|---|\n| UT-S70-01 | 乙 |\n';
const S70_ADDED = '## ADDED — S70 补充\n\n| ID | 描述 |\n|---|---|\n| UT-S70-10 | 新增 |\n';
const S71_ADDED = '## ADDED — S71 补充\n\n| ID | 描述 |\n|---|---|\n| UT-S71-10 | 新增 |\n';
const S71_TOUCH = '## MODIFIED — S71 用例\n\n| ID | 描述 |\n|---|---|\n| UT-S70-01 | 丙 |\n';
const CROSS_SEEDS = { [testTarget('S70')]: S70, [testTarget('S71')]: S71 };
const S01_TWO_TABLES = s01([R, '| UT-S01-02 | 旧描述 | 成功 |'],
  '## 补充\n\n| ID | 描述 | 预期 |\n|---|---|---|\n| UT-S01-03 | 补充 | 成功 |\n');

const CASES: Record<string, Case> = {
  '202': { name: 'S68 既有欠债 + 纯 ADDED', deltas: { [testDelta('S68')]: S68_ADDED }, seeds: { [testTarget('S68')]: S68_CANON }, reject: null },
  '203': { name: 'S37 既有重复 + 纯 ADDED', deltas: { [testDelta('S37')]: S37_ADDED }, seeds: { [testTarget('S37')]: S37_CANON }, reject: null },
  '204a': { name: '新增列数不一致行（无欠债目标）', deltas: { [testDelta('S68')]: '## ADDED — S68 补充用例\n\n| ID | 描述 |\n|---|---|\n| UT-S68-21 | 新 | 多 |\n' }, seeds: { [testTarget('S68')]: S68_CLEAN }, reject: 'column' },
  '204b': { name: '新增列数不一致行（含无关欠债目标）', deltas: { [testDelta('S68')]: '## ADDED — S68 补充用例\n\n| ID | 描述 |\n|---|---|\n| UT-S68-21 | 新 | 多 |\n' }, seeds: { [testTarget('S68')]: S68_CANON }, reject: 'column' },
  '205a': { name: '新增 ID 与既有 ID 重复', deltas: { [testDelta('S68')]: '## ADDED — S68 补充用例\n\n| ID | 描述 |\n|---|---|\n| ST-S68-01 | 重复 |\n' }, seeds: { [testTarget('S68')]: S68_CANON }, reject: 'dup' },
  '205b': { name: '既有重复再新增第三条', deltas: { [testDelta('S37')]: '## ADDED — S37 补充用例\n\n| ID | 描述 |\n|---|---|\n| UT-S37-01 | 第三条 |\n' }, seeds: { [testTarget('S37')]: S37_CANON }, reject: 'dup' },
  '206': { name: '改动欠债行本身', deltas: { [testDelta('S68')]: s68Modified(['| ST-S68-01 | 正常 | 一 | 通过 |', '| ST-S68-05 | 欠债改 | 一 | 二 | 三 |', S68_DEBT_ROWS[1]]) }, seeds: { [testTarget('S68')]: S68_CANON }, reject: 'column' },
  '207': { name: '同表改合法行并原样携带欠债行', deltas: { [testDelta('S01')]: s01Modified([R, '| UT-S01-02 | 新描述 | 成功 |']) }, seeds: { [testTarget('S01')]: s01([R, '| UT-S01-02 | 旧描述 | 成功 |']) }, reject: null },
  '208a': { name: '同表新增同字节副本', deltas: { [testDelta('S01')]: s01Modified([R, '| UT-S01-02 | 旧描述 | 成功 |', R]) }, seeds: { [testTarget('S01')]: s01([R, '| UT-S01-02 | 旧描述 | 成功 |']) }, reject: 'column' },
  '208b': { name: '副本追加到另一张同表头表', deltas: { [testDelta('S01')]: s01Modified(['| UT-S01-03 | 补充 | 成功 |', R], '补充') }, seeds: { [testTarget('S01')]: S01_TWO_TABLES }, reject: 'column' },
  '209a': { name: '前态两份相同欠债、数量不变', deltas: { [testDelta('S01')]: s01Modified([R, R, '| UT-S01-02 | 新描述 | 成功 |']) }, seeds: { [testTarget('S01')]: s01([R, R, '| UT-S01-02 | 旧描述 | 成功 |']) }, reject: null },
  '209b': { name: '前态两份相同欠债、减为一份', deltas: { [testDelta('S01')]: s01Modified([R, '| UT-S01-02 | 旧描述 | 成功 |']) }, seeds: { [testTarget('S01')]: s01([R, R, '| UT-S01-02 | 旧描述 | 成功 |']) }, reject: null },
  '210a': { name: '既有重复 ID 中一条被改动', deltas: { [testDelta('S37')]: s37Modified(['| UT-S37-01 | 定义甲 |', '| UT-S37-01 | 定义乙改 |', '| UT-S37-02 | 其它 |']) }, seeds: { [testTarget('S37')]: S37_CANON }, reject: 'dup' },
  '210b': { name: '既有重复 ID 原样携带（对照）', deltas: { [testDelta('S37')]: s37Modified(['| UT-S37-01 | 定义甲 |', '| UT-S37-01 | 定义乙 |', '| UT-S37-02 | 其它改 |']) }, seeds: { [testTarget('S37')]: S37_CANON }, reject: null },
  '211-1': { name: '跨目标：只触及 T1', deltas: { [testDelta('S70')]: S70_ADDED }, seeds: CROSS_SEEDS, reject: null },
  '211-2': { name: '跨目标：两目标各纯 ADDED', deltas: { [testDelta('S70')]: S70_ADDED, [testDelta('S71')]: S71_ADDED }, seeds: CROSS_SEEDS, reject: null },
  '211-3': { name: '跨目标：T1 ADDED + T2 改动重复记录', deltas: { [testDelta('S70')]: S70_ADDED, [testDelta('S71')]: S71_TOUCH }, seeds: CROSS_SEEDS, reject: 'dup' },
  '211-4': { name: '跨目标：只改 T2（放行对照）', deltas: { [testDelta('S71')]: S71_TOUCH }, seeds: CROSS_SEEDS, reject: null },
};

const deltaLineOf = (delta: string, row: string): number[] =>
  delta.split('\n').flatMap((l, i) => (l === row ? [i + 1] : []));

describe('S35 后态对目标既有测试欠债的继承口径', () => {
  it('UT-S35-202: 事故形态——目标既有欠债行 + 纯 ADDED 两侧均通过', () => {
    const { after } = expectCase(CASES['202']);
    expect(after.set!.changed_test_ids).toEqual(['UT-S68-20']);
    expect(after.set!.removed_test_ids).toEqual([]);
  });

  it('UT-S35-203: 目标既有同文件重复 ID + 纯 ADDED 两侧均通过', () => {
    const { out, after } = expectCase(CASES['203']);
    expect(codesOf(out)).not.toContain(DUP);
    expect(after.set!.changed_test_ids).toEqual(['UT-S37-30']);
    expect(after.set!.removed_test_ids).toEqual([]);
  });

  it('UT-S35-204: 本提案新增的列数不一致行两侧均拒绝，宽容不外溢', () => {
    const a = expectCase(CASES['204a']).out.violations.filter(v => v.code === COL);
    const b = expectCase(CASES['204b']).out.violations.filter(v => v.code === COL);
    expect(a.length).toBe(1);
    // 含无关欠债的目标下，message（delta 内行号 / 表头列数 / 本行列数）与无欠债时逐字一致。
    expect(b.map(v => v.message)).toEqual(a.map(v => v.message));
    expect(a[0].message).toContain('表头 2 列，本行 3 列');
  });

  it('UT-S35-205: 本提案新增 ID 与目标既有 ID 重复两侧均拒绝', () => {
    expectCase(CASES['205a']);
    expectCase(CASES['205b']);
  });

  it('UT-S35-206: 改动欠债行本身两侧均拒绝，行号指向 delta 内该行', () => {
    const c = CASES['206'];
    const { out } = expectCase(c);
    const line = deltaLineOf(c.deltas[testDelta('S68')], '| ST-S68-05 | 欠债改 | 一 | 二 | 三 |')[0];
    expect(out.violations.filter(v => v.code === COL).map(v => v.message))
      .toEqual([expect.stringContaining(`第 ${line} 行`)]);
  });

  it('UT-S35-207: 同表 MODIFIED 只改合法行、原样携带欠债行两侧均通过（评审 F1）', () => {
    const c = CASES['207'];
    const { after } = expectCase(c);
    expect(after.set!.changed_test_ids).toEqual(['UT-S01-02']);
    // 注入式反证：L4 不接入继承判定（旧实现）时本夹具必报——证明过滤由共享判定完成。
    expect(findTestTableShapeViolations(c.deltas[testDelta('S01')]).filter(v => v.kind === 'column-mismatch')).toHaveLength(1);
  });

  it('UT-S35-208: 新增同字节副本不得复用既有豁免（评审 F2）', () => {
    const a = CASES['208a'];
    const lines = deltaLineOf(a.deltas[testDelta('S01')], R);
    expect(lines.length).toBe(2);
    const reported = expectCase(a).out.violations.filter(v => v.code === COL).map(v => /第 (\d+) 行/.exec(v.message)?.[1]);
    // 整键按本提案引入：两条同字节行逐行各报，不臆断哪条是新增。
    expect(reported).toEqual(lines.map(String));
    expectCase(CASES['208b']);
  });

  it('UT-S35-209: 前态多份相同欠债——数量不变与减少两侧均通过', () => {
    expectCase(CASES['209a']);
    expectCase(CASES['209b']);
  });

  it('UT-S35-210: 既有重复 ID 中一条被改动两侧均拒绝，原样携带对照两侧通过', () => {
    expectCase(CASES['210a']);
    expectCase(CASES['210b']);
  });

  it('UT-S35-211: 跨目标重复 ID 按多重集判定，只按本次触及目标收集', () => {
    for (const k of ['211-1', '211-2']) {
      const { after } = expectCase(CASES[k]);
      expect(after.set!.changed_test_ids, k).not.toContain('UT-S70-01');
    }
    expectCase(CASES['211-3']);
    buildSpy.mockClear();
    const { after } = expectCase(CASES['211-4']);
    expect(after.set!.changed_test_ids).toEqual(['UT-S70-01']);
    // lint 侧送入判据的目标集合只含本次触及的 T2，未读取或送入 T1。
    const lintCall = buildSpy.mock.calls[0][0];
    expect(lintCall.targets.map(t => t.targetPath)).toEqual([testTarget('S71')]);
  });

  it('UT-S35-212: 一致性锁新边界双向比对 + 注入式反证 + 表头重复残差臂', () => {
    for (const [key, c] of Object.entries(CASES)) {
      const { lintCodes, after } = bothSides(c);
      const lintRejects = lintCodes.includes(COL) || lintCodes.includes(DUP);
      expect(lintRejects, `${key} ${c.name}`).toBe(after.code !== null);
      expect(lintRejects, `${key} ${c.name}`).toBe(c.reject !== null);
    }
    // 注入①：把计次规则替换为「存在匹配」——208a 的同字节副本被错误豁免，L4 侧结论翻转为零报。
    const target = testTarget('S01');
    const before = Buffer.from(CASES['208a'].seeds[target]);
    const existence = inheritedAmbiguousRowKeys(target, before, before);
    const delta = CASES['208a'].deltas[testDelta('S01')];
    expect(findTestTableShapeViolations(delta, (h, c) => isInheritedAmbiguousRow(existence, target, h, c))).toEqual([]);
    const [t] = afterTargets(CASES['208a'].deltas, CASES['208a'].seeds);
    const real = inheritedAmbiguousRowKeys(target, t.beforeBytes, t.afterBytes);
    expect(findTestTableShapeViolations(delta, (h, c) => isInheritedAmbiguousRow(real, target, h, c))).toHaveLength(2);
    // 注入②：L4 不接入继承判定——207 必报。
    expect(findTestTableShapeViolations(CASES['207'].deltas[testDelta('S01')])).toHaveLength(1);
    // 残差臂（不纳入比对）：既有表头重复 + 纯 ADDED——后态仍拒绝（表头形态不在宽容范围），预检如实记录为通过。
    const dupHeader = '# core-S68\n\n## S68 场景测试\n\n| ID | ID |\n|---|---|\n| ST-S68-01 | 正常 |\n';
    const residual: Case = { name: '表头重复残差', deltas: { [testDelta('S68')]: S68_ADDED }, seeds: { [testTarget('S68')]: dupHeader }, reject: null };
    const r = bothSides(residual);
    expect(r.after.code).toBe(AMBIGUOUS);
    expect(r.lintCodes).not.toContain('delta_test_table_duplicate_header');
  });

  it('UT-S35-213: 原样继承场景下变更集结论与无欠债基线一致', () => {
    const debt = '## 历史欠债\n\n| ID | 描述 |\n|---|---|\n| ST-S90-05 | 欠 | 债 |\n| UT-S90-07 | 重复甲 |\n| UT-S90-07 | 重复乙 |\n';
    const base = '# core-S90\n\n## 单元测试\n\n| ID | 描述 |\n|---|---|\n| UT-S90-01 | 一 |\n| UT-S90-02 | 二 |\n| UT-S90-03 | 三 |\n';
    const A = `${base}\n${debt}`;
    const B = base;
    const delta = '## MODIFIED — 单元测试\n\n| ID | 描述 |\n|---|---|\n| UT-S90-01 | 一 |\n| UT-S90-02 | 二改 |\n\n'
      + '## REMOVED-ITEMS — 单元测试\n\n- UT-S90-03 — 随本次变更删除\n\n'
      + '## ADDED — 新增节\n\n| ID | 描述 |\n|---|---|\n| UT-S90-10 | 新增 |\n';
    const target = testTarget('S90');
    const run = (before: string, d: string) => afterVerdict(afterTargets({ [testDelta('S90')]: d }, { [target]: before }));
    const a = run(A, delta);
    const b = run(B, delta);
    expect(a.code).toBeNull();
    expect(b.code).toBeNull();
    expect(a.set!.changed_test_ids).toEqual(b.set!.changed_test_ids);
    expect(a.set!.removed_test_ids).toEqual(b.set!.removed_test_ids);
    expect(a.set!.changed_test_ids).toEqual(['UT-S90-02', 'UT-S90-10']);
    expect(a.set!.removed_test_ids).toEqual(['UT-S90-03']);
    expect(Object.keys(a.set!)).toEqual(['schema', 'change', 'module', 'source', 'changed_test_ids', 'removed_test_ids', 'targets', 'sha256']);
    expect(a.set!.schema).toBe(TEST_CHANGE_SET_SCHEMA);
    // 修正臂：欠债行被修正为合规行 → 该 ID 进入变更集（修正本就是变更）。
    const fix = '## MODIFIED — 历史欠债\n\n| ID | 描述 |\n|---|---|\n| ST-S90-05 | 欠债 |\n| UT-S90-07 | 重复甲 |\n| UT-S90-07 | 重复乙 |\n';
    expect(run(A, fix).set!.changed_test_ids).toEqual(['ST-S90-05']);
  });

  it('UT-S35-214: 零回归——target-duplicate / overlap / invalid-utf8 与 lint-specs 可观测性不变', () => {
    const t = afterTargets({ [testDelta('S68')]: S68_ADDED }, { [testTarget('S68')]: S68_CANON })[0];
    // ① target-duplicate
    const dupTargets = afterVerdict([t, t]);
    expect(dupTargets.code).toBe('test-change-set-target-duplicate');
    expect(() => buildTestChangeSet({ change: SLUG, module: 'core', targets: [t, t] }))
      .toThrow(/^test-change-set-target-duplicate$/);
    // ② overlap（前滚合并路径）
    const current = buildTestChangeSet({ change: SLUG, module: 'core', targets: [t] });
    expect(() => forwardMergeTestChangeSets({ ...current, removed_test_ids: ['UT-S68-20'] }, [{ changed_test_ids: [], removed_test_ids: [] }]))
      .toThrow('test-change-set-overlap：UT-S68-20');
    // ③ invalid-utf8
    expect(() => buildTestChangeSet({ change: SLUG, module: 'core', targets: [{ ...t, afterBytes: Buffer.from([0xff]) }] }))
      .toThrow(`test-change-set-invalid-utf8：${t.targetPath}`);
    // ④ lint-specs 仍报出全部既有欠债
    const f = setup({}, { [testTarget('S68')]: S68_CANON, [testTarget('S37')]: S37_CANON });
    const result = lintSpecsIn(f.root);
    expect(result.ok).toBe(false);
    const found = result.findings.map(x => `${x.code}@${x.path}:${x.line}`);
    expect(found).toEqual(expect.arrayContaining([
      `table_column_mismatch@${testTarget('S68')}:8`,
      `table_column_mismatch@${testTarget('S68')}:9`,
    ]));
    expect(result.findings.some(x => x.code === 'duplicate_test_id' && x.message.includes('UT-S37-01'))).toBe(true);
  });

  it('UT-S35-215: L4 列数检查的合并后阶段边界——不重放、不回退严格扫描、不重合成', () => {
    const deltas = { [testDelta('S68')]: `${S68_CARRY}\n${S68_ADDED}` };
    const seeds = { [testTarget('S68')]: S68_CANON };
    // 未合并对照：继承判定生效，零列数码。
    const pending = setup(deltas, seeds);
    expect(codesOf(lint(pending))).toEqual([]);
    // 真实合并后再次 lint。
    const merged = setup(deltas, seeds);
    const run = cli(merged, ['merge', SLUG]);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(join(merged.proposalDir, 'SPEC_MERGED'))).toBe(true);
    composeSpy.mockClear();
    const snap = snapshot(merged.root);
    const after = lint(merged);
    expect(codesOf(after)).not.toContain(COL);
    expect(codesOf(after)).not.toContain(DUP);
    expect(composeSpy).not.toHaveBeenCalled();
    expect(snapshot(merged.root)).toEqual(snap);
    // 注入式反证：去掉完成标记闸并回退到只扫 delta 片段的旧扫描，原样携带的两条欠债行会被重新报出。
    expect(findTestTableShapeViolations(deltas[testDelta('S68')]).filter(v => v.kind === 'column-mismatch')).toHaveLength(2);
    // 不依赖前态的检查保持原合同：合并后注入表头重复与首格不可提取形态，照常报出。
    put(merged.proposalDir, testDelta('S68'),
      `${deltas[testDelta('S68')]}\n## ADDED — 注入形态\n\n| ID | ID |\n|---|---|\n| UT-S68-30 | x |\n\n| 用例 ID | 描述 |\n|---|---|\n| 非法首格 | x |\n`);
    const injected = codesOf(lint(merged));
    expect(injected).toContain('delta_test_table_duplicate_header');
    expect(injected).toContain('delta_test_table_id_unextractable');
    expect(injected).not.toContain(COL);
  });

  it('ST-S35-37: 真实 CLI 端到端——目标既有欠债不再阻断无关提案，新增欠债仍被拒', () => {
    const seeds = { [testTarget('S68')]: S68_CANON, [testTarget('S37')]: S37_CANON };
    const specsJson = (f: Fixture) => {
      const run = cli(f, ['lint-specs', '--format', 'json']);
      const data = JSON.parse(run.stdout) as { data: { findings: Array<{ code: string; path: string; line: number }> } };
      return { status: run.status, debt: data.data.findings.map(x => `${x.code}@${x.path}:${x.line}`).sort() };
    };
    // ① P1：两文件各纯 ADDED → lint PASS、真实 merge 成功、欠债逐字节保留。
    const p1 = setup({ [testDelta('S68')]: S68_ADDED, [testDelta('S37')]: S37_ADDED }, seeds);
    const specsBefore = specsJson(p1);
    const snapP1 = snapshot(p1.root);
    const l1 = cliLintJson(p1);
    expect(l1.status, l1.stderr).toBe(0);
    expect(l1.json.data.pass).toBe(true);
    expect(snapshot(p1.root)).toEqual(snapP1); // ⑤ lint 项目级零写入
    const m1 = cli(p1, ['merge', SLUG]);
    expect(m1.status, m1.stderr).toBe(0);
    expect(m1.stderr).not.toContain('Error: merge 失败');
    expect(existsSync(join(p1.proposalDir, 'SPEC_MERGED'))).toBe(true);
    const s68After = readFileSync(join(p1.root, ...testTarget('S68').split('/')), 'utf8');
    for (const row of S68_DEBT_ROWS) expect(s68After).toContain(row);
    expect(readFileSync(join(p1.root, ...testTarget('S37').split('/')), 'utf8')).toContain('| UT-S37-01 | 定义乙 |');
    // ④ lint-specs 对既有欠债的报出结论前后一致。
    const specsAfter = specsJson(p1);
    expect(specsBefore.status).toBe(1);
    expect(specsAfter.status).toBe(1);
    expect(specsAfter.debt).toEqual(specsBefore.debt);

    // ② P2：MODIFIED 整节替换原样携带欠债行 → lint PASS、merge 成功。
    const p2 = setup({ [testDelta('S68')]: S68_CARRY }, seeds);
    expect(cliLintJson(p2).status).toBe(0);
    const m2 = cli(p2, ['merge', SLUG]);
    expect(m2.status, m2.stderr).toBe(0);

    // ③ P3：P2 基础上追加一条与 ST-S68-05 逐字节相同的行 → lint exit 2、merge 于预检出口拒绝。
    const p3Delta = s68Modified(['| ST-S68-01 | 正常 | 一 | 通过（新） |', ...S68_DEBT_ROWS, S68_DEBT_ROWS[0]]);
    const p3 = setup({ [testDelta('S68')]: p3Delta }, seeds);
    const l3 = cliLintJson(p3);
    expect(l3.status).toBe(2);
    expect(l3.json.data.violations.map(v => v.code)).toContain(COL);
    const snapP3 = snapshot(p3.root);
    const m3 = cli(p3, ['merge', SLUG]);
    expect(m3.status).not.toBe(0);
    expect(m3.stderr).toContain('change-lint 未通过');
    expect(existsSync(join(p3.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(snapshot(p3.root)).toEqual(snapP3);

    // ⑥ P4：MODIFIED 原样携带 + ADDED → merge 成功后再次 lint 仍 PASS、零写入。
    const p4 = setup({ [testDelta('S68')]: `${S68_CARRY}\n${S68_ADDED}` }, seeds);
    expect(cliLintJson(p4).status).toBe(0);
    const m4 = cli(p4, ['merge', SLUG]);
    expect(m4.status, m4.stderr).toBe(0);
    const snapP4 = snapshot(p4.root);
    const l4 = cliLintJson(p4);
    expect(l4.status, l4.stderr).toBe(0);
    expect(l4.json.data.violations.map(v => v.code)).not.toContain(COL);
    expect(l4.stderr).not.toContain('ADDED 章节已存在或不唯一');
    expect(snapshot(p4.root)).toEqual(snapP4);
  });
});
