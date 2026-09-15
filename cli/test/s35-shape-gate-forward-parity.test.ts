/**
 * S35 — 行级 / 表级形态判据前移与预检-门一致性锁（fix-merge-preflight-parity-and-bare-throw）。
 * 覆盖 UT-S35-153～UT-S35-158、ST-S35-30（与 logos/resources/test/core-S35-test-cases.md 严格对齐）。
 *
 * 本组测试的核心不是「整数比较对不对」，而是**枚举口径对不对**（delta-r1 F1）：只共享最后那次
 * 比较、却让前移侧与后态各自决定「哪些表、哪些行进入比较」，漏扫的行照样在 merge 内部被拒。
 * 故每个形态臂都同时断言 change-lint 侧结论与 buildTestChangeSet 后态结论。
 *
 * 夹具在一次性隔离项目内构造；ST 臂走真实 CLI 子进程。结果由全局 OpenLogos reporter 写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import {
  makeTempRoot, scaffoldProject, withCompleteClarification, registerCoreModule,
} from './helpers.js';
import {
  runChangeLint, findTestTableShapeViolations, findUnextractableTestTableRows,
  CHANGE_LINT_VIOLATION_CODES, type ChangeLintViolation,
} from '../src/lib/change-lint.js';
import {
  buildTestChangeSet, TestChangeSetBuildError, type TestChangeSetInputTarget,
} from '../src/lib/test-change-set.js';
import {
  enumerateTestDefinitionTables, findDuplicateHeaderCells, rowColumnsMatchHeader,
} from '../src/lib/test-table-shape.js';
import { lintSpecsIn } from '../src/commands/lint-specs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CLI_ROOT = join(REPO_ROOT, 'cli');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const SPEC_REL = 'logos/resources/test/core-S99-test-cases.md';

function spawnCli(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args], {
    cwd, encoding: 'utf-8',
    // 安装态真实路径（mergeDirect 一次调用直接落盘）——vitest 全局开启的 0.13.x 兼容模式在此关闭。
    env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 一次性隔离项目 + 活跃提案骨架；`deltaBody` 原样写入 deltas/test/core-S99-test-cases.md。 */
function setup(deltaBody: string, slug = 'shape-gate'): { root: string; dir: string; slug: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', product_type: 'cli' }],
  }, { lineWidth: 0 }));
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-09-14T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
    '# 变更提案：形态前移夹具', '', '> module: core', '',
    '## 变更原因', '复刻 merge 预检盲点现场。', '',
    '## 变更类型', '代码级修复', '',
    '## 变更范围', '- 影响的功能规格：core-01', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '需要 CLI 代码、测试和 reporter 实现。',
  ].join('\n')));
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '', '## [delta] 规格变更', '- [ ] 产出 delta 到 `deltas/test/` — 新增用例', '',
    '## [code] 代码实现', '',
  ].join('\n'));
  // 已合并基线：不含本次新增行（供后态 before/after 对照与 lint 的测试证据）。
  writeFileSync(join(root, SPEC_REL),
    ['# core-S99 测试用例', '', '## 一、既有用例', '', '| ID | 用例 |', '|---|---|', '| UT-S99-01 | 既有 |', ''].join('\n'));
  writeFileSync(join(dir, 'deltas', 'test', 'core-S99-test-cases.md'), deltaBody);
  return { root, dir, slug };
}

function lint(root: string, dir: string, slug: string): ChangeLintViolation[] {
  const result = runChangeLint(root, dir, slug);
  if (!result.ok) throw new Error(`change-lint 操作错误：${result.errorCode} ${result.message}`);
  return result.violations;
}

function layerOfCode(root: string, dir: string, slug: string, code: string): number | null {
  const result = runChangeLint(root, dir, slug);
  if (!result.ok) throw new Error(result.message);
  if (!result.violations.some(v => v.code === code)) return null;
  // L 层归属经 checks 的计数体现——pushViolation(acc, 4, …) 的层号即该码的 L 层。
  const l4 = result.checks.find(c => c.id === 4);
  return l4 && l4.violations > 0 ? 4 : null;
}

function codesIn(violations: ChangeLintViolation[], prefix = 'delta_test_table_'): string[] {
  return violations.filter(v => v.code.startsWith(prefix)).map(v => v.code).sort();
}

/** 后态判据：把 delta 的表体当作合并后态整体喂给 buildTestChangeSet，返回抛出的错误码（未抛为 null）。 */
function postStateCode(afterContent: string): string | null {
  const targets: TestChangeSetInputTarget[] = [{
    targetPath: SPEC_REL, beforeBytes: null, afterBytes: Buffer.from(afterContent, 'utf8'),
  }];
  try {
    buildTestChangeSet({ change: 'shape-gate', module: 'core', targets });
    return null;
  } catch (e) {
    if (e instanceof TestChangeSetBuildError) return e.code;
    throw e;
  }
}

/** delta 形态 → 其合并后态近似（ADDED 块直接成为主文档章节内容）。 */
function asMergedDoc(tableBody: string): string {
  return ['# core-S99 测试用例', '', '## 一、用例', '', tableBody, ''].join('\n');
}

function added(title: string, body: string): string {
  return [`## ADDED — ${title}`, '', body, ''].join('\n');
}

// ── 形态夹具（表体原文；两侧共用，保证「同一形态」名副其实）──

/** 事故形态：表头 6 列，UT-S10-187 行少一个管道符实为 5 列。 */
const FX_INCIDENT = [
  '| ID | 测试点 | 前置条件 | 输入/操作 | 操作 | 预期输出 |',
  '|---|---|---|---|---|---|',
  '| UT-S10-186 | a | b | c | d | e |',
  '| UT-S10-187 | a | b | c | de |',
].join('\n');

const FX_INCIDENT_FIXED = FX_INCIDENT.replace('| UT-S10-187 | a | b | c | de |', '| UT-S10-187 | a | b | c | d | e |');

/** delta-r1 F1 反例一：表头措辞非 TEST_ID_HEADER_RE，数据行首格仍是合法测试 ID。 */
const FX_HEADER_WORDING = [
  '| 编号 | 操作 | 断言 |',
  '|---|---|---|',
  '| UT-S99-10 | 只有两列 |',
].join('\n');

const FX_HEADER_WORDING_FIXED = FX_HEADER_WORDING.replace('| UT-S99-10 | 只有两列 |', '| UT-S99-10 | 操作 | 断言 |');

/** delta-r1 F1 反例二：无首尾管道外形，数据行只剩一个裸 ID、整行不含管道符。 */
const FX_NO_EDGE_PIPES = ['ID | 描述', '---|---', 'UT-S99-11'].join('\n');

const FX_NO_EDGE_PIPES_FIXED = ['ID | 描述', '---|---', 'UT-S99-11 | 描述'].join('\n');

/** 表头重复（后态同码另一半触发形态）。 */
const FX_DUP_HEADER = [
  '| ID | 断言 | 断言 |',
  '|---|---|---|',
  '| UT-S99-12 | a | b |',
].join('\n');

const FX_DUP_HEADER_FIXED = FX_DUP_HEADER.replace('| ID | 断言 | 断言 |', '| ID | 断言 | 备注 |');

/** manual 标记首格 + 列数不一致。 */
const FX_MANUAL_MISMATCH = [
  '| ID | 用例 | 备注 |',
  '|---|---|---|',
  '| UT-S99-13 [manual] | 两列 |',
].join('\n');

/** 首格非法（散文）且同时列数不一致——在 TEST_ID_HEADER_RE 表头族内，§2.82.2 适用。 */
const FX_BAD_FIRST_CELL = [
  '| ID | 用例 | 备注 |',
  '|---|---|---|',
  '| 待补 ID | 只有两列 |',
].join('\n');

/** 完全合法（含 manual 行、行内代码与长文案单元格）。 */
const FX_LEGAL = [
  '| ID | 用例 | 备注 |',
  '|---|---|---|',
  '| UT-S99-20 | 调用 `runChangeLint(root, dir, slug)` 后取 violations | 正常 |',
  '| UT-S99-21 [manual] | 人工核对安装态输出，覆盖较长的一段说明文字以确保不因长度被误判 | 人工 |',
].join('\n');

/** 非测试定义表：列数不一致但无任何合法测试 ID 首格数据行。 */
const FX_NON_ID_TABLE = [
  '| 步骤 | 说明 |',
  '|---|---|',
  '| 第一步 |',
].join('\n');

describe('S35 行级 / 表级形态判据前移', () => {
  it('UT-S35-153: 列数判据前移必红（20260914 事故形态旧实现必绿）', () => {
    const { root, dir, slug } = setup(added('二、新增用例', FX_INCIDENT));
    const violations = lint(root, dir, slug);
    const mismatch = violations.filter(v => v.code === 'delta_test_table_column_mismatch');
    expect(mismatch).toHaveLength(1);
    expect(layerOfCode(root, dir, slug, 'delta_test_table_column_mismatch')).toBe(4);
    // 旧实现的盲点正是「首格合法即放行」：首格可提取性检查对该行零信号。
    expect(findUnextractableTestTableRows(added('二、新增用例', FX_INCIDENT))).toEqual([]);
    // 后态确实拒绝——前移的是同一形态，不是新判据。
    expect(postStateCode(asMergedDoc(FX_INCIDENT))).toBe('test-change-set-ambiguous-table');
    // 修复后两侧同时转绿。
    const fixed = setup(added('二、新增用例', FX_INCIDENT_FIXED), 'shape-gate-fixed');
    expect(codesIn(lint(fixed.root, fixed.dir, fixed.slug))).toEqual([]);
    expect(postStateCode(asMergedDoc(FX_INCIDENT_FIXED))).toBeNull();
  });

  it('UT-S35-154: 首格合法而列数不一致必被拒，且与首格码不双报', () => {
    // ① 裸 ID 首格 + 列数不一致。
    const bare = setup(added('二、新增用例', FX_INCIDENT), 'fx-bare');
    expect(codesIn(lint(bare.root, bare.dir, bare.slug))).toEqual(['delta_test_table_column_mismatch']);
    // ② manual 标记首格不豁免列数判定（剥离标记后按裸 ID 判身份）。
    const manual = setup(added('二、新增用例', FX_MANUAL_MISMATCH), 'fx-manual');
    expect(codesIn(lint(manual.root, manual.dir, manual.slug))).toEqual(['delta_test_table_column_mismatch']);
    expect(postStateCode(asMergedDoc(FX_MANUAL_MISMATCH))).toBe('test-change-set-ambiguous-table');
    // ③ 首格非法（散文）+ 列数同时不一致：只报首格码，不报列数码——首格非法的行不构成 ID 行。
    const bad = setup(added('二、新增用例', FX_BAD_FIRST_CELL), 'fx-bad-cell');
    expect(codesIn(lint(bad.root, bad.dir, bad.slug))).toEqual(['delta_test_table_id_unextractable']);
    // 对照：后态对该形态同样不抛 ambiguous（该行不产生测试定义），两侧一致。
    expect(postStateCode(asMergedDoc(FX_BAD_FIRST_CELL))).toBeNull();
  });

  it('UT-S35-155: 枚举口径对齐——两个漏扫盲点必红 + 真正合法表零误报', () => {
    // ① delta-r1 F1 反例一：表头措辞非 TEST_ID_HEADER_RE，旧实现整表绕过。
    const wording = setup(added('二、新增用例', FX_HEADER_WORDING), 'fx-wording');
    expect(codesIn(lint(wording.root, wording.dir, wording.slug))).toEqual(['delta_test_table_column_mismatch']);
    expect(postStateCode(asMergedDoc(FX_HEADER_WORDING))).toBe('test-change-set-ambiguous-table');
    // 旧口径的漏扫证据：首格检查（其适用集合逐字不变，仍限 TEST_ID_HEADER_RE 表头族）对该表零输出。
    expect(findUnextractableTestTableRows(added('二、新增用例', FX_HEADER_WORDING))).toEqual([]);

    // ② delta-r1 F1 反例二：无首尾管道外形，数据行不含管道符导致旧块边界提前收束。
    const noEdge = setup(added('二、新增用例', FX_NO_EDGE_PIPES), 'fx-no-edge');
    expect(codesIn(lint(noEdge.root, noEdge.dir, noEdge.slug))).toEqual(['delta_test_table_column_mismatch']);
    expect(postStateCode(asMergedDoc(FX_NO_EDGE_PIPES))).toBe('test-change-set-ambiguous-table');

    // ①② 修复后两侧同时转绿——证明前移不是无差别收紧。
    for (const [fixture, slug] of [[FX_HEADER_WORDING_FIXED, 'fx-wording-ok'], [FX_NO_EDGE_PIPES_FIXED, 'fx-no-edge-ok']] as const) {
      const ok = setup(added('二、新增用例', fixture), slug);
      expect(codesIn(lint(ok.root, ok.dir, ok.slug))).toEqual([]);
      expect(postStateCode(asMergedDoc(fixture))).toBeNull();
    }

    // ③ 完全合法表（含 manual 行、行内代码与长文案单元格）零误报。
    const legal = setup(added('二、新增用例', FX_LEGAL), 'fx-legal');
    expect(codesIn(lint(legal.root, legal.dir, legal.slug))).toEqual([]);
    expect(postStateCode(asMergedDoc(FX_LEGAL))).toBeNull();

    // ④ 列数不一致但无任何合法测试 ID 首格数据行：change-lint 零输出（后态亦不抛），
    //    该类表的列数问题由 lint-specs 只读诊断承担——两者定位不同，不构成分裂。
    const nonId = setup(added('二、新增用例', FX_NON_ID_TABLE), 'fx-non-id');
    expect(codesIn(lint(nonId.root, nonId.dir, nonId.slug))).toEqual([]);
    expect(postStateCode(asMergedDoc(FX_NON_ID_TABLE))).toBeNull();
    writeFileSync(join(nonId.root, SPEC_REL), asMergedDoc(FX_NON_ID_TABLE));
    expect(lintSpecsIn(nonId.root).findings.map(f => f.code)).toContain('table_column_mismatch');

    // ⑤ 围栏内的同形态表格不参与判定（authorityScan 掩码）。
    const fenced = setup(added('二、新增用例', ['```markdown', FX_INCIDENT, '```'].join('\n')), 'fx-fenced');
    expect(codesIn(lint(fenced.root, fenced.dir, fenced.slug))).toEqual([]);
  });

  it('UT-S35-156: 诊断可归因——点名 delta 文件与 delta 内行号', () => {
    // 已知布局：第 1 行标记、第 2 行空、第 3 行表头、第 4 行分隔、第 5/6 行数据；病灶在第 6 行。
    const body = added('二、新增用例', FX_INCIDENT);
    expect(body.split('\n')[5]).toBe('| UT-S10-187 | a | b | c | de |');
    const { root, dir, slug } = setup(body);
    const v = lint(root, dir, slug).find(x => x.code === 'delta_test_table_column_mismatch');
    expect(v).toBeDefined();
    // path 指向 delta 文件本身（非合并后态 canonical target）。
    expect(v!.path).toBe(`logos/changes/${slug}/deltas/test/core-S99-test-cases.md`);
    // 行号为 delta 内 1 基行号，精确等于夹具已知值 6。
    expect(v!.message).toContain('第 6 行');
    expect(v!.message).toContain('表头 6 列');
    expect(v!.message).toContain('本行 5 列');
    expect(v!.message).toContain('UT-S10-187');
    // 纯函数层同样给出 delta 内行号（1 基）与两侧列数——诊断不依赖命令层拼装。
    expect(findTestTableShapeViolations(body)).toEqual([
      { kind: 'column-mismatch', line: 6, headerCount: 6, rowCellCount: 5, firstCell: 'UT-S10-187' },
    ]);
  });

  it('UT-S35-157: 一致性锁——后态 test-change-set-ambiguous-table 全码族，预检必先报', () => {
    const family: Array<{ name: string; body: string; expected: string }> = [
      { name: '事故形态·行内缺管道', body: FX_INCIDENT, expected: 'delta_test_table_column_mismatch' },
      { name: '表头多列', body: ['| ID | a | b | c |', '|---|---|---|---|', '| UT-S99-30 | x | y |'].join('\n'), expected: 'delta_test_table_column_mismatch' },
      { name: '行尾多余管道', body: ['| ID | a |', '|---|---|', '| UT-S99-31 | x | y |'].join('\n'), expected: 'delta_test_table_column_mismatch' },
      { name: 'manual 标记行', body: FX_MANUAL_MISMATCH, expected: 'delta_test_table_column_mismatch' },
      { name: 'F1 反例一·表头措辞', body: FX_HEADER_WORDING, expected: 'delta_test_table_column_mismatch' },
      { name: 'F1 反例二·数据行不含管道符', body: FX_NO_EDGE_PIPES, expected: 'delta_test_table_column_mismatch' },
      { name: '表头重复', body: FX_DUP_HEADER, expected: 'delta_test_table_duplicate_header' },
    ];

    // 双向比对：后态拒 ⇔ 预检报，逐夹具一致。
    for (const { name, body, expected } of family) {
      const fx = setup(added('二、新增用例', body), `lock-${family.indexOf(family.find(f => f.name === name)!)}`);
      expect(codesIn(lint(fx.root, fx.dir, fx.slug)), name).toEqual([expected]);
      expect(postStateCode(asMergedDoc(body)), name).toBe('test-change-set-ambiguous-table');
    }

    // 已修正版本：两侧均通过（前移不是无差别收紧）。
    for (const fixture of [FX_INCIDENT_FIXED, FX_HEADER_WORDING_FIXED, FX_NO_EDGE_PIPES_FIXED, FX_DUP_HEADER_FIXED, FX_LEGAL]) {
      expect(postStateCode(asMergedDoc(fixture))).toBeNull();
      expect(findTestTableShapeViolations(added('二、新增用例', fixture))).toEqual([]);
    }

    // 注入式反证臂：**单独放宽预检侧枚举口径**（恢复旧的表头措辞限制 / 「不含管道符即收束」
    // 块边界）时，锁必红——证明锁覆盖的是枚举口径而非仅那次整数比较。
    const relaxedByHeaderWording = (content: string) => {
      const lines = content.split('\n');
      return enumerateTestDefinitionTables(lines)
        .filter(t => /^(?:用例\s*)?id$/i.test(t.headers[0] ?? ''))
        .flatMap(t => t.rows.filter(r => !rowColumnsMatchHeader(t.headers.length, r.cells.length)));
    };
    expect(relaxedByHeaderWording(FX_HEADER_WORDING)).toEqual([]);      // 旧口径漏扫
    expect(findTestTableShapeViolations(added('x', FX_HEADER_WORDING))).toHaveLength(1); // 新口径必报
    const relaxedByPipeBoundary = (content: string) => {
      const lines = content.split('\n').filter(line => line.includes('|'));
      return enumerateTestDefinitionTables(lines)
        .flatMap(t => t.rows.filter(r => !rowColumnsMatchHeader(t.headers.length, r.cells.length)));
    };
    expect(relaxedByPipeBoundary(FX_NO_EDGE_PIPES)).toEqual([]);        // 旧口径漏扫
    expect(findTestTableShapeViolations(added('x', FX_NO_EDGE_PIPES))).toHaveLength(1);  // 新口径必报

    // 边界断言：需合并后态全局视角的身份类判定不纳入锁——在 delta 片段上不可判定，
    // 强行前移只会产生假阳性。此处证明它们确由后态而非预检承担。
    const duplicateIdDoc = asMergedDoc([
      '| ID | 用例 |', '|---|---|', '| UT-S99-40 | 一 |', '| UT-S99-40 | 二 |',
    ].join('\n'));
    expect(postStateCode(duplicateIdDoc)).toBe('test-change-set-duplicate-id');
    const dupIdDelta = setup(added('二、新增用例',
      ['| ID | 用例 |', '|---|---|', '| UT-S99-40 | 一 |', '| UT-S99-40 | 二 |'].join('\n')), 'lock-dup-id');
    expect(codesIn(lint(dupIdDelta.root, dupIdDelta.dir, dupIdDelta.slug))).toEqual([]);
    // target-duplicate / overlap 同理由后态承担（同一目标出现两次即拒）。
    const dupTarget: TestChangeSetInputTarget[] = [
      { targetPath: SPEC_REL, beforeBytes: null, afterBytes: Buffer.from(asMergedDoc(FX_LEGAL), 'utf8') },
      { targetPath: SPEC_REL, beforeBytes: null, afterBytes: Buffer.from(asMergedDoc(FX_LEGAL), 'utf8') },
    ];
    let dupTargetCode: string | null = null;
    try { buildTestChangeSet({ change: 'shape-gate', module: 'core', targets: dupTarget }); }
    catch (e) { dupTargetCode = (e as TestChangeSetBuildError).code; }
    expect(dupTargetCode).toBe('test-change-set-target-duplicate');
  });

  it('UT-S35-158: 表头重复前移（同码另一半触发形态）', () => {
    const body = added('二、新增用例', FX_DUP_HEADER);
    const { root, dir, slug } = setup(body, 'fx-dup-header');
    const v = lint(root, dir, slug).find(x => x.code === 'delta_test_table_duplicate_header');
    expect(v).toBeDefined();
    expect(layerOfCode(root, dir, slug, 'delta_test_table_duplicate_header')).toBe(4);
    expect(v!.path).toBe(`logos/changes/${slug}/deltas/test/core-S99-test-cases.md`);
    // 点名表头行的 delta 内行号（第 3 行）与重复表头文本。
    expect(body.split('\n')[2]).toBe('| ID | 断言 | 断言 |');
    expect(v!.message).toContain('第 3 行');
    expect(v!.message).toContain("'断言'");
    expect(findDuplicateHeaderCells(['ID', '断言', '断言'])).toEqual(['断言']);
    expect(findDuplicateHeaderCells(['ID', '断言', '备注'])).toEqual([]);
    // 后态同形态以同一错误码拒绝；修复后两侧转绿。
    expect(postStateCode(asMergedDoc(FX_DUP_HEADER))).toBe('test-change-set-ambiguous-table');
    const ok = setup(added('二、新增用例', FX_DUP_HEADER_FIXED), 'fx-dup-header-ok');
    expect(codesIn(lint(ok.root, ok.dir, ok.slug))).toEqual([]);
    expect(postStateCode(asMergedDoc(FX_DUP_HEADER_FIXED))).toBeNull();

    // 两个新码进入闭合码表（注册表单点）。
    expect(CHANGE_LINT_VIOLATION_CODES as readonly string[]).toContain('delta_test_table_column_mismatch');
    expect(CHANGE_LINT_VIOLATION_CODES as readonly string[]).toContain('delta_test_table_duplicate_header');
  });

  it('ST-S35-30: 20260914 事故端到端复现（真实 CLI）——少一个管道符在 write-delta 节点即闭环', () => {
    const { root, dir, slug } = setup(added('二、新增用例', FX_INCIDENT), 'e2e-shape');
    const deltaPath = join(dir, 'deltas', 'test', 'core-S99-test-cases.md');

    // ① 真实 change-lint：exit 2、pass=false、violations 含新码，path/line 指向 delta 侧。
    const bad = spawnCli(root, ['change-lint', '--slug', slug, '--format', 'json']);
    expect(bad.status).toBe(2);
    const badEnvelope = JSON.parse(bad.stdout.trim().split('\n').pop()!);
    expect(badEnvelope.data.pass).toBe(false);
    const hit = (badEnvelope.data.violations as ChangeLintViolation[])
      .find(v => v.code === 'delta_test_table_column_mismatch');
    expect(hit).toBeDefined();
    expect(hit!.path).toBe(`logos/changes/${slug}/deltas/test/core-S99-test-cases.md`);
    expect(hit!.message).toContain('第 6 行');

    // ② 按诊断补齐管道符后重跑：PASS——诊断足以在 write-delta 节点自修闭环。
    writeFileSync(deltaPath, added('二、新增用例', FX_INCIDENT_FIXED));
    const good = spawnCli(root, ['change-lint', '--slug', slug, '--format', 'json']);
    expect(good.status, good.stdout + good.stderr).toBe(0);
    expect(JSON.parse(good.stdout.trim().split('\n').pop()!).data.pass).toBe(true);

    // ③ 续跑真实 merge：成功合并并写入 SPEC_MERGED（修复前此步确定性退 1 硬停）。
    const merged = spawnCli(root, ['merge', slug]);
    expect(merged.status, merged.stdout + merged.stderr).toBe(0);
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true);
    const marker = JSON.parse(readFileSync(join(dir, 'SPEC_MERGED'), 'utf8'));
    expect(marker.test_change_set.changed_test_ids).toEqual(['UT-S10-186', 'UT-S10-187']);

    // ④ 对照臂（后态判据不放宽）：绕过预检直接构建合并后态，仍 fail-closed 拒绝。
    expect(postStateCode(asMergedDoc(FX_INCIDENT))).toBe('test-change-set-ambiguous-table');

    // ⑤ 枚举盲点臂：表头措辞非 TEST_ID_HEADER_RE 的同类病灶，真实 CLI 同样报出（修复前整表绕过）。
    const blind = setup(added('二、新增用例', FX_HEADER_WORDING), 'e2e-blind');
    const blindRun = spawnCli(blind.root, ['change-lint', '--slug', blind.slug, '--format', 'json']);
    expect(blindRun.status).toBe(2);
    expect((JSON.parse(blindRun.stdout.trim().split('\n').pop()!).data.violations as ChangeLintViolation[])
      .map(v => v.code)).toContain('delta_test_table_column_mismatch');

    // ⑥ change-lint 项目级零写入：运行前后字节快照相等。
    const snapshot = readFileSync(join(blind.root, SPEC_REL), 'utf8');
    spawnCli(blind.root, ['change-lint', '--slug', blind.slug]);
    expect(readFileSync(join(blind.root, SPEC_REL), 'utf8')).toBe(snapshot);
  });
});
