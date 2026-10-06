/**
 * S09 merge 对目标既有测试欠债的继承口径（fix-inherited-test-debt-merge-block，功能规格 §2.86 /
 * §2.84.3 / §2.84.4；场景 S09「test-change-set 的捕获集变化」）。覆盖 UT-S09-382～UT-S09-384、
 * ST-S09-151；结果由 OpenLogos reporter 依 it 标题中的 ID 写入 test-results.jsonl。
 *
 * 判定口径与 S35 继承口径测试同源，本文件只覆盖 merge 侧的真实落盘结果与失败出口。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { mergeDirect } from '../src/lib/merge-direct.js';
import { runDirectMerge } from '../src/commands/merge.js';
import { AFTER_STATE_LINE_NOTE, TEST_CHANGE_SET_SCHEMA } from '../src/lib/test-change-set.js';
import {
  makeTempRoot, mergeAdmissibleProposal, mergeAdmissibleTasks, registerCoreModule, scaffoldProject,
} from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'inherited-debt-merge';
const S68 = 'logos/resources/test/core-S68-test-cases.md';
const S37 = 'logos/resources/test/core-S37-test-cases.md';
const S68_DELTA = 'deltas/test/core-S68-test-cases.md';
const S37_DELTA = 'deltas/test/core-S37-test-cases.md';

const DEBT_05 = '| ST-S68-05 | 欠债 | 一 | 二 | 三 |';
const DEBT_06 = '| ST-S68-06 | 欠债二 | 一 | 二 | 三 |';
const HEADER_4 = '| ID | 场景 | 步骤 | 断言 |\n|---|---|---|---|';
const s68 = (rows: string[]) =>
  ['# core-S68 测试用例', '', '## S68 场景测试', '', HEADER_4, '| ST-S68-01 | 正常 | 一 | 通过 |', ...rows, ''].join('\n');
const S68_CANON = s68([DEBT_05, DEBT_06]);
const S37_CANON = ['# core-S37 测试用例', '', '## S37 单元测试', '', '| ID | 描述 |', '|---|---|',
  '| UT-S37-01 | 定义甲 |', '| UT-S37-01 | 定义乙 |', ''].join('\n');
const S68_ADDED = '## ADDED — S68 补充用例\n\n| ID | 描述 |\n|---|---|\n| UT-S68-20 | 新增 |\n';
const S37_ADDED = '## ADDED — S37 补充用例\n\n| ID | 描述 |\n|---|---|\n| UT-S37-30 | 新增 |\n';

interface Fixture { root: string; proposalDir: string }
function setup(deltas: Record<string, string>, seeds: Record<string, string>): Fixture {
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
  const put = (base: string, rel: string, content: string) => {
    const abs = join(base, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  for (const [rel, content] of Object.entries(deltas)) put(proposalDir, rel, content);
  for (const [rel, content] of Object.entries(seeds)) put(root, rel, content);
  return { root, proposalDir };
}
const read = (f: Fixture, rel: string) => readFileSync(join(f.root, ...rel.split('/')), 'utf8');
const marker = (f: Fixture) => JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8')) as {
  test_change_set: Record<string, unknown> & { changed_test_ids: string[]; removed_test_ids: string[] };
};
function tree(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) { walk(abs); continue; }
      out.set(relative(dir, abs), createHash('sha256').update(readFileSync(abs)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

class ExitSignal extends Error {
  constructor(readonly exitCode: number) { super(`exit:${exitCode}`); }
}
/** 跳过预检、经真实 mergeDirect 与 runDirectMerge 失败出口映射（模拟预检漏判时的后备出口）。 */
function directMergeFailure(f: Fixture) {
  const lines: string[] = [];
  let exitCode: number | null = null;
  try {
    runDirectMerge(f.root, f.proposalDir, SLUG, {
      stderr: line => lines.push(line),
      exit: (code: number) => { exitCode = code; throw new ExitSignal(code); },
    });
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e;
  }
  return { exitCode, lines };
}

describe('S09 merge 对目标既有测试欠债的继承口径', () => {
  it('UT-S09-382: merge 合成期放行原样继承的欠债且 SPEC_MERGED.test_change_set 口径不变', () => {
    const f = setup({ [S68_DELTA]: S68_ADDED, [S37_DELTA]: S37_ADDED }, { [S68]: S68_CANON, [S37]: S37_CANON });
    mergeDirect(f.root, f.proposalDir, SLUG);
    const set = marker(f).test_change_set;
    expect(Object.keys(set)).toEqual(['schema', 'change', 'module', 'source', 'changed_test_ids', 'removed_test_ids', 'targets', 'sha256']);
    expect(set.schema).toBe(TEST_CHANGE_SET_SCHEMA);
    expect(set.changed_test_ids).toEqual(['UT-S37-30', 'UT-S68-20']);
    expect(set.removed_test_ids).toEqual([]);
    // 欠债行与两条重复记录逐字节保留、顺序不变。
    const s68After = read(f, S68);
    expect(s68After.indexOf(DEBT_05)).toBeGreaterThan(-1);
    expect(s68After.indexOf(DEBT_06)).toBeGreaterThan(s68After.indexOf(DEBT_05));
    const s37After = read(f, S37);
    expect(s37After.indexOf('| UT-S37-01 | 定义乙 |')).toBeGreaterThan(s37After.indexOf('| UT-S37-01 | 定义甲 |'));
  });

  it('UT-S09-383: 本提案引入的欠债 merge 仍以原码失败、失败出口与归因口径不变', () => {
    // ① 同表头新表追加一条与 ST-S68-05 逐字节相同的行（次数超出前态预算）→ ambiguous-table，delta 内唯一形态行可归因。
    const copyDelta = `## ADDED — S68 补充场景\n\n${HEADER_4}\n${DEBT_05}\n`;
    const f1 = setup({ [S68_DELTA]: copyDelta }, { [S68]: S68_CANON });
    const before1 = tree(join(f1.root, 'logos', 'resources'));
    const r1 = directMergeFailure(f1);
    expect(r1.exitCode).toBe(1);
    expect(r1.lines[0]).toMatch(/^Error: merge 失败（test-change-set-ambiguous-table）：/);
    expect(r1.lines[0]).toContain(AFTER_STATE_LINE_NOTE);
    const copyLine = copyDelta.split('\n').indexOf(DEBT_05) + 1;
    expect(r1.lines.some(l => l.startsWith(`  delta 侧归属（主诊断，可直接修改）：${S68_DELTA}:${copyLine} `))).toBe(true);
    expect(r1.lines).toContain('  logos/resources/ 保持合并前字节，未写 SPEC_MERGED。');
    expect(tree(join(f1.root, 'logos', 'resources'))).toEqual(before1);
    expect(existsSync(join(f1.proposalDir, 'SPEC_MERGED'))).toBe(false);

    // ② 新增与既有 ID 重复 → duplicate-id；归因口径与既有一致（只按形态归因，重复 ID 判为未能确定、不臆造）。
    const dupDelta = '## ADDED — S68 补充用例\n\n| ID | 描述 |\n|---|---|\n| ST-S68-01 | 重复 |\n';
    const f2 = setup({ [S68_DELTA]: dupDelta }, { [S68]: S68_CANON });
    const r2 = directMergeFailure(f2);
    expect(r2.exitCode).toBe(1);
    expect(r2.lines[0]).toBe('Error: merge 失败（test-change-set-duplicate-id）：test-change-set-duplicate-id：ST-S68-01');
    expect(r2.lines).toContain(`  delta 侧归属：未能确定（${S68}）——不臆造行号；请按上述合并后态行号在对应 delta 中人工比对`);
    expect(r2.lines).toContain('  logos/resources/ 保持合并前字节，未写 SPEC_MERGED。');
    expect(existsSync(join(f2.proposalDir, 'SPEC_MERGED'))).toBe(false);

    // ③ 改动欠债行本身（目标只有一条欠债，delta 内唯一形态行）→ ambiguous-table，归因到 delta 内该行。
    const single = s68([DEBT_05]);
    const touched = '| ST-S68-05 | 欠债改 | 一 | 二 | 三 |';
    const touchDelta = `## MODIFIED — S68 场景测试\n\n${HEADER_4}\n| ST-S68-01 | 正常 | 一 | 通过 |\n${touched}\n`;
    const f3 = setup({ [S68_DELTA]: touchDelta }, { [S68]: single });
    const r3 = directMergeFailure(f3);
    expect(r3.exitCode).toBe(1);
    expect(r3.lines[0]).toMatch(/^Error: merge 失败（test-change-set-ambiguous-table）：/);
    const touchLine = touchDelta.split('\n').indexOf(touched) + 1;
    expect(r3.lines.some(l => l.startsWith(`  delta 侧归属（主诊断，可直接修改）：${S68_DELTA}:${touchLine} `))).toBe(true);
    expect(read(f3, S68)).toBe(single);
  });

  it('UT-S09-384: 修正欠债行进入捕获集', () => {
    const fixDelta = `## MODIFIED — S68 场景测试\n\n${HEADER_4}\n| ST-S68-01 | 正常 | 一 | 通过 |\n| ST-S68-05 | 欠债 | 一 | 二 |\n${DEBT_06}\n`;
    const f = setup({ [S68_DELTA]: fixDelta }, { [S68]: S68_CANON });
    mergeDirect(f.root, f.proposalDir, SLUG);
    const set = marker(f).test_change_set;
    expect(set.changed_test_ids).toEqual(['ST-S68-05']);
    expect(set.removed_test_ids).toEqual([]);
    expect(read(f, S68)).toContain(DEBT_06);
  });

  it('ST-S09-151: 缺陷报告事故形态——目标既有欠债 + 纯 ADDED 真实 merge 退 0', () => {
    const f = setup({ [S68_DELTA]: S68_ADDED }, { [S68]: S68_CANON });
    const env = { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' };
    const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: f.root, encoding: 'utf8', timeout: 120000, env });
    const specs = () => {
      const r = run(['lint-specs', '--format', 'json']);
      const findings = (JSON.parse(r.stdout) as { data: { findings: Array<{ code: string; path: string; line: number }> } }).data.findings;
      return { status: r.status, debt: findings.filter(x => x.path === S68).map(x => `${x.code}:${x.line}`) };
    };
    const specsBefore = specs();
    // ① change-lint
    const lint = run(['change-lint', '--slug', SLUG, '--format', 'json']);
    expect(lint.status, lint.stderr).toBe(0);
    expect((JSON.parse(lint.stdout) as { data: { pass: boolean } }).data.pass).toBe(true);
    // ② 真实 merge（修复前退 1：merge 失败（test-change-set-ambiguous-table）…:8（合并后态行号），归属未能确定）
    const merge = run(['merge', SLUG]);
    expect(merge.status, merge.stderr).toBe(0);
    expect(merge.stderr).not.toContain('Error: merge 失败');
    // ③ SPEC_MERGED 与合并后目标
    expect(marker(f).test_change_set.changed_test_ids).toEqual(['UT-S68-20']);
    const after = read(f, S68);
    expect(after).toContain(DEBT_05);
    expect(after).toContain(DEBT_06);
    // ④ lint-specs 对该欠债的报出结论与退出码前后一致
    const specsAfter = specs();
    expect(specsBefore.status).toBe(1);
    expect(specsAfter.status).toBe(1);
    expect(specsBefore.debt).toEqual(['table_column_mismatch:8', 'table_column_mismatch:9']);
    expect(specsAfter.debt).toEqual(specsBefore.debt);
  });
});
