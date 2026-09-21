/**
 * 切片 2：`ADDED` 锚合成后唯一性判据的 L4 前移。
 * 覆盖 UT-S35-183～UT-S35-189、ST-S35-34、UT-S39-87、ST-S39-33；
 * 逐条 ID 由全局 OpenLogos reporter 写入 test-results.jsonl。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';

// **注入式反证的挂载点**：判据独立成模块，两个消费方（merge 侧 `verifyAgentMaterialOutcome`
// 与 lint 侧 `evaluateAddedAnchorUniqueness`）都**跨模块**调用它。把它换成相反结论时，两侧必须
// 同时翻转；只翻转一侧即证明存在第二份实现。同模块内的函数调用不经导出绑定、注入不到，
// 那样的「单点」无法被证伪——这正是判据下沉成独立模块的理由。
vi.mock('../src/lib/added-anchor-outcome.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/added-anchor-outcome.js')>();
  return { ...actual, evaluateAddedAnchorOutcome: vi.fn(actual.evaluateAddedAnchorOutcome) };
});

import { evaluateAddedAnchorOutcome, ADDED_ANCHOR_FIX_HINT } from '../src/lib/added-anchor-outcome.js';
import {
  composeOpenLogosMarkdown, evaluateAddedAnchorUniqueness, verifyAgentMaterialOutcome,
} from '../src/lib/markdown-section-authority.js';
import {
  CHANGE_LINT_VIOLATION_CODES, evaluateDeltaConservation, runChangeLint,
} from '../src/lib/change-lint.js';
import {
  makeTempRoot, mergeAdmissibleProposal, mergeAdmissibleTasks, registerCoreModule, scaffoldProject,
} from './helpers.js';
// **改动前基线**：由 git HEAD（本次实现落地前）的编译产物实测生成并落盘，测试只读、
// 不在运行时由待测新版实现重算（code-r1 F3）。夹具定义与基线同源。
import GOLDEN from './golden/prechange-baseline.json' with { type: 'json' };
import FIX from './golden/regression-fixtures.json' with { type: 'json' };

const spied = vi.mocked(evaluateAddedAnchorOutcome);
const cleanups: Array<() => void> = [];
beforeEach(() => { spied.mockClear(); });
afterEach(() => { spied.mockReset(); while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'added-anchor-fixture';

const SCENARIO_DELTA = 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S81-demo.md';
const SCENARIO_TARGET = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S81-demo.md';
const TEST_DELTA = 'deltas/test/core-S99-test-cases.md';
const TEST_TARGET = 'logos/resources/test/core-S99-test-cases.md';
const DEFAULT_TEST_DELTA = FIX.legacyCreateDelta;

const BEFORE_DOC = FIX.cleanAddedBefore;
/** 20260921 runlogos S81 事故原形态：`ADDED` 的 body 里又写了一遍与锚同名的标题。 */
const DUPLICATE_TITLE_DELTA = '## ADDED — S81：WorkBuddy Agent 类型全生命周期\n\n'
  + '## S81：WorkBuddy Agent 类型全生命周期\n\n正文。\n';
const CLEAN_DELTA = FIX.cleanAddedDelta;

interface Fixture { root: string; proposalDir: string }

function setup(deltas: Record<string, string> = {}, seedTargets: Record<string, string> = {}): Fixture {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root, 'launched');
  const proposalDir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(proposalDir, 'proposal.md'), mergeAdmissibleProposal());
  if (!Object.keys(deltas).some(k => k.startsWith('deltas/test/'))) {
    deltas = { ...deltas, [TEST_DELTA]: DEFAULT_TEST_DELTA };
  }
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

function merge(f: Fixture) {
  // vitest 全局注入 `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY=1`（0.13.x 兼容模式，只产
  // MERGE_PROMPT.md 不落盘）；本片验的是直接合并的真实结论，必须显式关掉它。
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

const anchorViolations = (out: ReturnType<typeof lint>) =>
  out.violations.filter(v => v.code === 'delta_section_anchor_unresolvable');

/** lint 无 exitCode 字段：准入结论等于「violations 是否为空」，与 merge 准入判定同源。 */
const lintRejected = (out: ReturnType<typeof lint>) => out.violations.length > 0;

describe('S35 ADDED 锚合成后唯一性的 L4 前移', () => {
  it('UT-S35-183: body 重复写与锚同名标题 → L4 判违规，且错误在 change-lint 阶段报出', () => {
    const f = setup({ [SCENARIO_DELTA]: DUPLICATE_TITLE_DELTA }, { [SCENARIO_TARGET]: BEFORE_DOC });
    // ① lint 阶段即报——**本用例的本体**。
    const violations = anchorViolations(lint(f));
    expect(violations.length).toBe(1);
    expect(violations[0].path).toBe(`logos/changes/${SLUG}/${SCENARIO_DELTA}`);
    expect(violations[0].message).toContain('ADDED 章节没有形成唯一新增结果');
    expect(violations[0].message).toContain('S81：WorkBuddy Agent 类型全生命周期');
    // fix_hint 必须点明契约，作者不必去读判据实现即可改对。
    expect(violations[0].fix_hint).toContain('body **不含章节标题本身**');
    expect(violations[0].fix_hint).toBe(ADDED_ANCHOR_FIX_HINT);
    expect(lintRejected(lint(f))).toBe(true);
    // ② merge 亦拒同一形态，但其失败不得是该形态的首次暴露信号。
    expect(merge(f).status).not.toBe(0);
    expect(() => composeOpenLogosMarkdown(BEFORE_DOC, DUPLICATE_TITLE_DELTA, 'MODIFY'))
      .toThrow(/ADDED 章节没有形成唯一新增结果/);
  });

  it('UT-S35-184: 合法 ADDED（body 不含同名标题）→ 通过，合成结果逐字不变', () => {
    const f = setup({ [SCENARIO_DELTA]: CLEAN_DELTA }, { [SCENARIO_TARGET]: BEFORE_DOC });
    expect(anchorViolations(lint(f))).toEqual([]);
    const run = merge(f);
    expect(run.status, run.stderr).toBe(0);
    // **对照改动前基线字节**——与同版本 composer 自比证明不了零回归（两侧同步改变输出时仍会通过）。
    const landed = readFileSync(join(f.root, ...SCENARIO_TARGET.split('/')), 'utf8');
    expect(landed).toBe(GOLDEN.cleanAddedCompose);
    // 同版本自比只作为「落盘 == 合成」的一致性附证，不承担零回归举证。
    expect(landed).toBe(composeOpenLogosMarkdown(BEFORE_DOC, CLEAN_DELTA, 'MODIFY'));
  });

  it('UT-S35-185: 锚在合并前文档已存在 → 仍被拒，且同形态只报一次', () => {
    const existing = '# 文档\n\n## S81：WorkBuddy Agent 类型全生命周期\n\n既有正文。\n';
    const f = setup({ [SCENARIO_DELTA]: CLEAN_DELTA }, { [SCENARIO_TARGET]: existing });
    const out = lint(f);
    const same = out.violations.filter(
      v => v.code === 'delta_section_anchor_unresolvable' && v.path === `logos/changes/${SLUG}/${SCENARIO_DELTA}`);
    // 仍被拒，但**出现次数恰为 1**——同一事实不得被两个判据双报。
    expect(same.length).toBe(1);
    expect(merge(f).status).not.toBe(0);
  });

  it('UT-S35-186: 唯一性判定与 merge 侧共用具名实现（含注入式反证臂）', () => {
    const cases: Array<[string, string, string]> = [
      ['合法 ADDED', BEFORE_DOC, CLEAN_DELTA],
      ['body 重复标题', BEFORE_DOC, DUPLICATE_TITLE_DELTA],
      ['锚合并前已存在', '# 文档\n\n## S81：WorkBuddy Agent 类型全生命周期\n\n正文。\n', CLEAN_DELTA],
      ['ADDED 与 RENAMED 组合', BEFORE_DOC, '## RENAMED — 甲\n\n乙\n\n## ADDED — 丙\n\n丙正文。\n'],
    ];
    for (const [name, before, delta] of cases) {
      const lintSide = evaluateAddedAnchorUniqueness(before, delta, 'MODIFY');
      let mergeSide = true;
      try {
        const output = composeOpenLogosMarkdown(before, delta, 'MODIFY');
        mergeSide = verifyAgentMaterialOutcome(delta, before, output).ok;
      } catch { mergeSide = false; }
      // 两侧结论逐一相同（合成阶段因**其它 op** 失败的情形不在本批用例内）。
      expect(lintSide.ok, name).toBe(mergeSide);
    }

    // **注入式反证臂**：把共享判据换成恒假，lint 与 merge 两侧必须**同时**翻转。
    spied.mockImplementation((anchor: string) => ({ ok: false, error: `注入：${anchor}` }));
    expect(evaluateAddedAnchorUniqueness(BEFORE_DOC, CLEAN_DELTA, 'MODIFY').ok).toBe(false);
    expect(() => composeOpenLogosMarkdown(BEFORE_DOC, CLEAN_DELTA, 'MODIFY')).toThrow(/注入：/);
    spied.mockImplementation(() => ({ ok: true }));
    // 换成恒真：两侧都不再以「ADDED 未形成唯一新增结果」为由拒绝原本必拒的事故形态。
    // （merge 侧随后仍会在标题保真等后续检查上失败——注入掩盖掉的正是「唯一命中」这一前置事实，
    //   故只断言拒绝理由不再是本判据，而不断言整体放行。）
    expect(evaluateAddedAnchorUniqueness(BEFORE_DOC, DUPLICATE_TITLE_DELTA, 'MODIFY').ok).toBe(true);
    let injectedError = '';
    try { composeOpenLogosMarkdown(BEFORE_DOC, DUPLICATE_TITLE_DELTA, 'MODIFY'); }
    catch (e) { injectedError = e instanceof Error ? e.message : String(e); }
    expect(injectedError).not.toContain('ADDED 章节没有形成唯一新增结果');
  });

  it('UT-S35-187: 回归锚——L4 检查项与违规码集合零改动，L8 守恒对 ADDED/RENAMED 的排除逐字不变', () => {
    // 检查项基线取自改动前构建在**同形夹具**上的实测输出（id + label 完整列表），
    // 禁止硬编码 `10/10`，也禁止只做「当前集合内部自洽」的弱断言——新增一个名称不同的
    // 检查项仍能满足那种断言，而对照完整基线则必然变红。
    const golden = setup({ [TEST_DELTA]: DEFAULT_TEST_DELTA });
    const goldenOut = lint(golden);
    expect(goldenOut.checks.map(c => ({ id: c.id, label: c.label }))).toEqual(GOLDEN.changeLintChecks);
    expect(goldenOut.violations.map(v => v.code)).toEqual(GOLDEN.changeLintViolationsOnCleanFixture);
    // 违规码注册表：**完整数组**逐项对照改动前基线——本刀复用既有码，不增不减不改序。
    expect([...CHANGE_LINT_VIOLATION_CODES]).toEqual(GOLDEN.changeLintViolationCodes);

    const f = setup({ [SCENARIO_DELTA]: CLEAN_DELTA }, { [SCENARIO_TARGET]: BEFORE_DOC });
    // L8 守恒：ADDED / RENAMED 仍被排除在守恒物质块之外，结论与本刀无关。
    expect(evaluateDeltaConservation(CLEAN_DELTA, BEFORE_DOC)).toEqual([]);
    expect(evaluateDeltaConservation(DUPLICATE_TITLE_DELTA, BEFORE_DOC)).toEqual([]);
    expect(evaluateDeltaConservation('## RENAMED — 甲\n\n乙\n', BEFORE_DOC)).toEqual([]);
  });

  it('UT-S35-188: 通道排除——整文件封装（含 Markdown 整文件）不进入本判据', () => {
    const wholeFileTarget = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S98-new.md';
    const wholeFileDelta = 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S98-new.md';
    const apiDelta = 'deltas/api/core-api.yaml';
    const cases: Array<[string, Record<string, string>]> = [
      // ① 合法 Markdown 整文件 CREATE——首行同为 `## ADDED —`、目标同为 `.md`。
      ['Markdown 整文件', { [wholeFileDelta]: `## ADDED — ${wholeFileTarget}（新文件，整文件）\n# S98：新场景\n\n正文。\n` }],
      // ② API non-Markdown 整文件。
      ['non-Markdown 整文件', { [apiDelta]: `## ADDED — logos/resources/api/core-api.yaml（新文件，整文件）\n${OPENAPI}` }],
    ];
    for (const [name, deltas] of cases) {
      spied.mockClear();
      const f = setup(deltas);
      const out = lint(f);
      expect(anchorViolations(out), name).toEqual([]);
      expect(out.violations, name).toEqual([]);
      // **哨兵**：本判据未被调用。仅断言「L4 通过」不算覆盖——按 `.md` 扫描但判定恰好通过的
      // 实现同样能满足那个弱断言。缺省补齐的测试 delta 是章节写法，会合法地调用一次本判据，
      // 故哨兵断言的是「整文件那份没有把调用次数抬高」：章节 delta 恰 1 次，整文件 0 次。
      const anchors = spied.mock.calls.map(c => c[0]);
      expect(anchors, name).toEqual(['S99 夹具']);
    }
    // ③ 普通章节 ADDED 正常进入本判据。
    spied.mockClear();
    const section = setup({ [SCENARIO_DELTA]: CLEAN_DELTA }, { [SCENARIO_TARGET]: BEFORE_DOC });
    lint(section);
    expect(spied.mock.calls.map(c => c[0]).sort())
      .toEqual(['S81：WorkBuddy Agent 类型全生命周期', 'S99 夹具']);
  });

  it('UT-S35-189: 阶段边界——SPEC_MERGED 之后不重放本判据', () => {
    const f = setup({ [SCENARIO_DELTA]: CLEAN_DELTA }, { [SCENARIO_TARGET]: BEFORE_DOC });
    // ① merge 前通过。
    expect(anchorViolations(lint(f))).toEqual([]);
    // ② 真实 merge 成功并写出 SPEC_MERGED。
    const run = merge(f);
    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
    // ③ merge 后重跑：目标此时已含该章节，若把当前文件当 before 重放，判据必返回
    // 「没有形成唯一新增结果」，一次成功的合并被倒挂成失败——本断言即该回放的锁。
    spied.mockClear();
    const before = snapshot(f.root);
    const after = lint(f);
    expect(anchorViolations(after)).toEqual([]);
    expect(after.violations).toEqual([]);
    // ④ 哨兵：post-merge 本判据未被调用（阶段判别取既有完成标记，不以章节是否存在推断）。
    expect(spied.mock.calls).toEqual([]);
    expect(snapshot(f.root)).toEqual(before); // 项目级零写入
  });

  it('UT-S39-87: 交叉锚——合法 Markdown 整文件 CREATE 通过真实 L4 且章节唯一性判定未被调用', () => {
    const target = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S99-demo.md';
    const delta = 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S99-demo.md';
    // 与 UT-S39-76 同一份合法新建夹具：`.md` 目标、首行整文件 marker、payload 首行为 H1。
    const f = setup({ [delta]: `## ADDED — ${target}（新文件，整文件）\n# S99：演示场景\n\n正文。\n` });
    spied.mockClear();
    const out = lint(f);
    expect(out.violations).toEqual([]);
    expect(out.violations).toEqual([]);
    // 现行 `parseDeltaBlocks` 会把该首行解析成 anchor 为「路径 + 后缀」的 ADDED 块；若章节预检
    // 按 `.md` 或语义类别补集划定扫描范围而不按共享分流结果排除，该合法输入会被判违规。
    expect(spied.mock.calls.map(c => c[0])).toEqual(['S99 夹具']);
    expect(spied.mock.calls.some(c => c[0].includes('（新文件，整文件）'))).toBe(false);
    // 合法新建能力本身不受影响：真实 merge 成功、H1 逐字保留。
    expect(merge(f).status).toBe(0);
    expect(readFileSync(join(f.root, ...target.split('/')), 'utf8')).toBe('# S99：演示场景\n\n正文。\n');
  });

  it('ST-S35-34: 真实 CLI 下前移承诺——事故形态在 lint 阶段被拦，失败分支事务边界成立', () => {
    // 步骤①②：失败夹具。
    const bad = setup({ [SCENARIO_DELTA]: DUPLICATE_TITLE_DELTA }, { [SCENARIO_TARGET]: BEFORE_DOC });
    const badBefore = snapshot(bad.root);
    const badLint = lint(bad);
    expect(lintRejected(badLint)).toBe(true);
    expect(anchorViolations(badLint)[0].message).toContain('S81：WorkBuddy Agent 类型全生命周期');
    const l4 = badLint.checks.find(c => c.id === 4 || String(c.id) === '4');
    if (l4) expect(l4.violations).toBeGreaterThan(0);
    expect(badLint.violations.length).toBeGreaterThan(0);
    const badMerge = merge(bad);
    expect(badMerge.status).not.toBe(0);
    expect(existsSync(join(bad.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(snapshot(bad.root)).toEqual(badBefore); // 目标保持合并前字节

    // 步骤③④⑤：独立的合法夹具。
    const good = setup({ [SCENARIO_DELTA]: CLEAN_DELTA }, { [SCENARIO_TARGET]: BEFORE_DOC });
    const goodLint = lint(good);
    expect(lintRejected(goodLint)).toBe(false);
    expect(goodLint.violations).toEqual([]);
    // 检查项标识集合与总数以实测为基准，两臂一致（禁止硬编码 `10/10`）。
    expect(goodLint.checks.map(c => c.id)).toEqual(badLint.checks.map(c => c.id));
    const goodMerge = merge(good);
    expect(goodMerge.status, goodMerge.stderr).toBe(0);
    expect(existsSync(join(good.proposalDir, 'SPEC_MERGED'))).toBe(true);
    const landed = readFileSync(join(good.root, ...SCENARIO_TARGET.split('/')), 'utf8');
    expect(landed.split('## S81：WorkBuddy Agent 类型全生命周期').length - 1).toBe(1); // 含且仅含一处
    // 步骤⑤：post-merge 重跑仍通过且项目级零写入。
    const mergedSnapshot = snapshot(good.root);
    expect(lint(good).violations).toEqual([]);
    expect(snapshot(good.root)).toEqual(mergedSnapshot);
  });

  it('ST-S39-33: 端到端——事故形态在 lint 阶段报出，改写为整文件封装后新建成功且 H1 保留', () => {
    const target = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S81-new.md';
    const delta = 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S81-new.md';
    const anchorForm = '## ADDED — S81：WorkBuddy Agent 类型全生命周期\n\n'
      + '# S81：WorkBuddy Agent 类型全生命周期\n\n正文。\n';

    // 步骤①：事故原形态（CREATE + 章节锚 + body 重复同名标题）。
    const f1 = setup({ [delta]: anchorForm });
    const before1 = snapshot(f1.root);
    const lint1 = lint(f1);
    expect(lintRejected(lint1)).toBe(true);
    expect(anchorViolations(lint1).length).toBe(1);
    // 步骤②：失败分支事务边界。
    expect(merge(f1).status).not.toBe(0);
    expect(existsSync(join(f1.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(f1.root, ...target.split('/')))).toBe(false);
    expect(snapshot(f1.root)).toEqual(before1);

    // 步骤③④：改写为整文件封装（刀一的能力）——新建成功且 H1 逐字保留。
    const body = '# S81：WorkBuddy Agent 类型全生命周期\n\n## 场景目标\n\n正文。\n';
    const f2 = setup({ [delta]: `## ADDED — ${target}（新文件，整文件）\n${body}` });
    expect(lint(f2).violations).toEqual([]);
    const run2 = merge(f2);
    expect(run2.status, run2.stderr).toBe(0);
    const landed = readFileSync(join(f2.root, ...target.split('/')), 'utf8');
    expect(landed).toBe(body);
    expect(landed.split('\n')[0]).toBe('# S81：WorkBuddy Agent 类型全生命周期');

    // 步骤⑤：不带后缀的章节写法（body 不重复标题）全程通过——旧写法零回归。
    const f3 = setup({ [delta]: '## ADDED — S81 章节\n\n正文。\n' });
    expect(lint(f3).violations).toEqual([]);
    expect(merge(f3).status).toBe(0);
    expect(readFileSync(join(f3.root, ...target.split('/')), 'utf8')).toContain('## S81 章节');
  });
});

const OPENAPI = [
  'openapi: 3.1.0', 'info:', '  title: Touch API', '  version: 1.0.0',
  'paths:', '  /touch:', '    get:', '      operationId: getTouch', '      security:', '        - bearerAuth: []',
  '      responses:', "        '200':", '          description: ok', "        '400':", '          description: error response',
  'components:', '  securitySchemes:', '    bearerAuth:', '      type: http', '      scheme: bearer',
  '  schemas:', '    Touch:', '      type: object', '      deprecated: false # compatibility contract',
].join('\n') + '\n';
