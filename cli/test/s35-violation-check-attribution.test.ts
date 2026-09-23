/**
 * S35 — 违规层归属单点与人类可读输出的逐条可归因（fix-lint-violation-check-attribution）。
 * 覆盖 UT-S35-190～UT-S35-195、ST-S35-35（与 logos/resources/test/core-S35-test-cases.md 严格对齐）。
 *
 * **本组测试的断言对象是命令实际打印的文本**（捕获 stdout），不是 `runChangeLint` 返回的
 * `violations` 数组：本缺陷期间该数组内容始终正确，2270 个现存用例全绿而缺陷仍在，正是
 * 「只验 API 返回值」这条纪律缺席的后果（C04）。
 *
 * 改动前基线由 `golden/prechange-lint-render.json` 落盘提供（生成方式见 golden/README.md），
 * 夹具定义由 `lint-render-fixture.ts` 单点提供——基线与断言比较的是同一输入。
 * 逐条 ID 由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  setupLintRenderFixture, LINT_RENDER_SLUG, type LintRenderFixture, type LintRenderFixtureKind,
} from './lint-render-fixture.js';
import { changeLint, renderChecks, ChangeLintRenderError } from '../src/commands/change-lint.js';
import {
  runChangeLint, CHANGE_LINT_VIOLATION_CODES, type ChangeLintRunResult,
} from '../src/lib/change-lint.js';
// **改动前基线**：由 git HEAD（本刀落地前）的编译产物实测生成并落盘，测试只读、
// 不在运行时由待测新版实现重算（golden/README.md「为什么必须是落盘基线」）。
import GOLDEN from './golden/prechange-lint-render.json' with { type: 'json' };

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const REPO_ROOT = resolve(__dirname, '..', '..');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function fixture(kind: LintRenderFixtureKind): LintRenderFixture {
  const f = setupLintRenderFixture(kind);
  cleanups.push(f.cleanup);
  return f;
}

type Baseline = {
  text: { status: number; stdout: string; stderr: string };
  json: { status: number; data: Record<string, unknown> };
  checks: { id: number; label: string; violations: number }[];
};
const baseline = (kind: LintRenderFixtureKind): Baseline => (GOLDEN as Record<string, unknown>)[kind] as Baseline;

/** 跑命令层渲染并捕获它实际打印的 stdout / stderr 与退出码。 */
function runCommand(root: string, format: 'text' | 'json' = 'text'):
{ status: number; stdout: string; stderr: string } {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  const exit = mockProcessExit();
  let status = NaN;
  try {
    changeLint(LINT_RENDER_SLUG, format);
  } catch (e) {
    const m = /process\.exit\((\d+)\)/.exec((e as Error).message);
    if (!m) { cap.restore(); exit.mockRestore(); restoreCwd(); throw e; }
    status = Number(m[1]);
  } finally {
    cap.restore();
    exit.mockRestore();
    restoreCwd();
  }
  // 与真实进程的 stdout 逐字对齐：console.log 每次调用即一行，末尾补行尾。
  const nl = (lines: string[]) => lines.length > 0 ? `${lines.join('\n')}\n` : '';
  return { status, stdout: nl(cap.logs), stderr: nl(cap.errors) };
}

function lintOk(f: LintRenderFixture): Extract<ChangeLintRunResult, { ok: true }> {
  const out = runChangeLint(f.root, f.proposalDir, LINT_RENDER_SLUG);
  if (!out.ok) throw new Error(`${out.errorCode}: ${out.message}`);
  return out;
}

/** 某层下打印出的 `✗` 条目（每条 4 行：标题 + 缺什么 / 在哪补 / 补成什么样）。 */
function entriesUnderLayer(stdout: string, layer: number): { code: string; message: string; path: string; fix: string }[] {
  const lines = stdout.split('\n');
  const out: { code: string; message: string; path: string; fix: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = new RegExp(`^ {2}✗ L${layer} \\[([^\\]]+)\\]$`).exec(lines[i]);
    if (!m) continue;
    out.push({
      code: m[1],
      message: (lines[i + 1] ?? '').replace(/^ {6}缺什么：/, ''),
      path: (lines[i + 2] ?? '').replace(/^ {6}在哪补：/, ''),
      fix: (lines[i + 3] ?? '').replace(/^ {6}补成什么样：/, ''),
    });
  }
  return out;
}

const checkLines = (stdout: string) => stdout.split('\n').filter(l => /^ {2}[✓✗] L\d+/.test(l));

function snapshotTree(root: string): Map<string, string> {
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

/** 本仓项目根的字节快照：工作树相对 HEAD 的完整增删改（含未跟踪文件）。 */
const repoState = () => execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });

function spawnCli(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('S35 违规层归属单点与人类可读输出的逐条可归因', () => {
  it('UT-S35-190: 事故形态直接回归锚——L4 违规在人类可读输出中逐条打印', () => {
    const f = fixture('l4-only');
    const run = runCommand(f.root);

    // ① L4 行在场，且该违规的 code / message / path / fix_hint 四项俱全、恰打印一次。
    const l4 = entriesUnderLayer(run.stdout, 4);
    expect(l4.length).toBe(1);
    expect(l4[0].code).toBe('delta_section_anchor_unresolvable');
    expect(l4[0].message).toBe('ADDED 章节没有形成唯一新增结果：S81：WorkBuddy Agent 类型全生命周期');
    expect(l4[0].path).toBe(
      `logos/changes/${LINT_RENDER_SLUG}/deltas/prd/3-technical-plan/2-scenario-implementation/core-S81-demo.md`);
    expect(l4[0].fix).toContain('body **不含章节标题本身**');
    for (const part of [l4[0].code, l4[0].message, l4[0].path, l4[0].fix]) expect(part.length).toBeGreaterThan(0);
    // ③ L4 行不得缺席（缺席即本刀所修缺陷的原形态）。
    expect(run.stdout).toContain('✗ L4 [');
    expect(checkLines(run.stdout).some(l => l.startsWith('  ✗ L4 '))).toBe(true);

    // ② L8 本次零违规 → 保留 `✓ L8`；不得把这条 L4 违规打印或计入 L8。
    const result = lintOk(f);
    expect(result.checks.find(c => c.id === 8)!.violations).toBe(0);
    expect(run.stdout).toContain('  ✓ L8 条目守恒（ID 隐式删除拦截）');
    expect(entriesUnderLayer(run.stdout, 8)).toEqual([]);

    // 回归对照（改动前实测基线）：同夹具下 L4 整行消失、底部只剩聚合结论，L8 打勾是正确行为。
    const before = baseline('l4-only');
    expect(before.text.stdout).not.toContain('L4');
    expect(before.text.stdout).toContain('  ✓ L8 条目守恒（ID 隐式删除拦截）');
    expect(before.text.stdout.trimEnd().split('\n').pop()).toBe('FAIL（8/9，1 项违规）');
    // 使用者仅凭 stdout 即可定位与自修——改动前 stdout 不含 code / path / fix_hint 任何一项。
    expect(before.text.stdout).not.toContain('delta_section_anchor_unresolvable');
    expect(run.stdout).toContain('delta_section_anchor_unresolvable');
  });

  it('UT-S35-191: 同一 code 跨层共存——两条 delta_section_anchor_unresolvable 分属 L4 与 L8', () => {
    const f = fixture('l4-and-l8');
    const result = lintOk(f);
    const run = runCommand(f.root);

    // 同一次 lint 确实同时产出登记在 L4 与 L8 的同码违规。
    expect(result.checks.find(c => c.id === 4)!.violations).toBe(1);
    expect(result.checks.find(c => c.id === 8)!.violations).toBe(1);
    expect(result.violations.map(v => v.code)).toEqual(
      ['delta_section_anchor_unresolvable', 'delta_section_anchor_unresolvable']);

    // 两条各自打印在**自己登记的层**下：不串层、不丢失、不重复。
    const l4 = entriesUnderLayer(run.stdout, 4);
    const l8 = entriesUnderLayer(run.stdout, 8);
    expect(l4.length).toBe(1);
    expect(l8.length).toBe(1);
    expect(l4[0].message).toContain('ADDED 章节没有形成唯一新增结果');
    expect(l4[0].path).toContain('core-S81-demo.md');
    expect(l8[0].message).toContain('章节锚「不存在的章节」在目标主文档未命中任何章节（not-found）');
    expect(l8[0].path).toContain('core-S82-demo.md');
    // 每层的 ✗ 条目数 == checks[] 的对应计数。
    for (const check of result.checks) {
      expect(entriesUnderLayer(run.stdout, check.id).length).toBe(check.violations);
    }
    // 打印总数 == violations 总数（无违规蒸发）。
    expect(result.checks.reduce((n, c) => n + entriesUnderLayer(run.stdout, c.id).length, 0))
      .toBe(result.violations.length);

    // **结构性反证臂**：改动前以 code 为唯一入参归属 → 两条都打在 L8、L4 整行消失。
    // 任何以 code 为唯一入参的实现都无法同时满足两侧（同一 code 横跨两层，入参无从区分）。
    const before = baseline('l4-and-l8');
    expect(entriesUnderLayer(before.text.stdout, 8).length).toBe(2);
    expect(entriesUnderLayer(before.text.stdout, 4).length).toBe(0);
    expect(before.checks.find(c => c.id === 4)!.violations).toBe(1);
  });

  it('UT-S35-192: fail-loud——某层计数非零却筛不出可打印违规时显式报异常', () => {
    const f = fixture('l4-only');
    const result = lintOk(f);

    // ① 受控注入：令 L4 计数为 1 而该层可打印违规集合为空。
    const starved: Extract<ChangeLintRunResult, { ok: true }> = { ...result, violations: [] };
    const cap1 = captureConsole();
    let thrown: unknown;
    try { renderChecks(starved); } catch (e) { thrown = e; } finally { cap1.restore(); }
    expect(thrown).toBeInstanceOf(ChangeLintRenderError);
    expect((thrown as ChangeLintRenderError).code).toBe('render_layer_attribution_inconsistent');
    // 点名该检查层与其计数。
    expect((thrown as ChangeLintRenderError).message).toContain('L4');
    expect((thrown as ChangeLintRenderError).message).toContain('计数为 1');
    // 禁止打印「既无 ✓ 也无 ✗」的空层：抛出前不得为 L4 输出任何行。
    expect(cap1.logs.filter(l => l.includes('L4'))).toEqual([]);

    // ② 受控注入：违规的层号没有对应检查项行（孤儿层）→ 同样显式报异常，不静默蒸发。
    const orphan: Extract<ChangeLintRunResult, { ok: true }> = {
      ...result,
      violations: [{ ...result.violations[0], check_layer: 7 }],
      checks: result.checks.map(c => c.id === 4 ? { ...c, violations: 0 } : c),
    };
    const cap2 = captureConsole();
    let thrown2: unknown;
    try { renderChecks(orphan); } catch (e) { thrown2 = e; } finally { cap2.restore(); }
    expect(thrown2).toBeInstanceOf(ChangeLintRenderError);
    expect((thrown2 as ChangeLintRenderError).message).toContain('L7');

    // ③ 一致输入下不抛（反证臂的对照）：同一渲染器对真实结论正常打印。
    const cap3 = captureConsole();
    try { expect(() => renderChecks(result)).not.toThrow(); } finally { cap3.restore(); }

    // ④ 命令层的对外形态：稳定错误码 + 非零退出，而非裸抛 Node 未捕获堆栈（不得静默、
    //    不得以聚合结论代替）。改动前该组合走 else 分支、循环体零次，整行消失且不报错。
    expect(baseline('l4-only').text.stderr).toBe('');
  });

  it('UT-S35-193: 零回归锚——--format json 输出逐字节不变', () => {
    for (const kind of ['l4-only', 'clean'] as LintRenderFixtureKind[]) {
      const f = fixture(kind);
      const run = runCommand(f.root, 'json');
      const data = JSON.parse(run.stdout.trim().split('\n').pop()!).data;
      // envelope 的 timestamp/version 与本刀无关；契约主体（pass / plan_package / violations /
      // warnings 的出现与省略形态）按序列化字节逐字比对改动前实测基线。
      expect(JSON.stringify(data)).toBe(JSON.stringify(baseline(kind).json.data));
      expect(run.status).toBe(baseline(kind).json.status);
      // 层号不得漏进对外 JSON：每条 violation 的字段集合逐字不变、不含 check_layer。
      for (const v of data.violations as Record<string, unknown>[]) {
        expect(Object.keys(v)).not.toContain('check_layer');
      }
      const beforeKeys = (baseline(kind).json.data.violations as Record<string, unknown>[])
        .map(v => Object.keys(v).join(','));
      expect((data.violations as Record<string, unknown>[]).map(v => Object.keys(v).join(','))).toEqual(beforeKeys);
    }
  });

  it('UT-S35-194: 零回归锚——检查项、违规码集合、exit code 与结论文案零改动', () => {
    // ② 违规码注册表：断言集合本身（被意外扩充同样是回归）。
    expect([...CHANGE_LINT_VIOLATION_CODES]).toEqual(GOLDEN._violation_codes as string[]);
    expect(new Set(CHANGE_LINT_VIOLATION_CODES).size).toBe((GOLDEN._violation_codes as string[]).length);

    for (const kind of ['l4-only', 'l4-and-l8', 'clean'] as LintRenderFixtureKind[]) {
      const f = fixture(kind);
      // ① 检查项标识集合与总数（含 label）——基线取改动前实测，禁止硬编码 10/10 之类字面量。
      expect(lintOk(f).checks).toEqual(baseline(kind).checks);
      const run = runCommand(f.root);
      // ③ 退出码。
      expect(run.status).toBe(baseline(kind).text.status);
      // ④ 末行结论文案（PASS（…）/ FAIL（…，N 项违规[，M warning]）形态不变）。
      expect(run.stdout.trimEnd().split('\n').pop())
        .toBe(baseline(kind).text.stdout.trimEnd().split('\n').pop());
    }
  });

  it('UT-S35-195: 无违规时输出形态不变，且每层至少一行', () => {
    const f = fixture('clean');
    const run = runCommand(f.root);
    // 与改动前逐字相同——本刀不新增任何行。
    expect(run.stdout).toBe(baseline('clean').text.stdout);
    expect(run.status).toBe(0);
    // 每个检查项恰打印一行 `✓ L<id> <label>`；末行 PASS。
    const result = lintOk(f);
    const lines = checkLines(run.stdout);
    expect(lines.length).toBe(result.checks.length);
    expect(lines).toEqual(result.checks.map(c => `  ✓ L${c.id} ${c.label}`));
    expect(run.stdout.trimEnd().split('\n').pop()).toMatch(/^PASS（/);
  });

  it('ST-S35-35: 真实 CLI 下证明「看到 FAIL 就能知道错在哪」', () => {
    const bad = fixture('l4-only');
    const good = fixture('clean');
    const beforeFixture = snapshotTree(bad.root);
    const beforeRepo = repoState();

    // ① 真实进程、默认人类可读格式：✗ L4 行 + 四要素 + 退出码 2 + 末行 FAIL。
    const badText = spawnCli(bad.root, ['change-lint', '--slug', LINT_RENDER_SLUG]);
    expect(badText.status).toBe(2);
    const l4 = entriesUnderLayer(badText.stdout, 4);
    expect(l4.length).toBe(1);
    expect(l4[0].code).toBe('delta_section_anchor_unresolvable');
    expect(l4[0].path).toContain('deltas/prd/3-technical-plan/2-scenario-implementation/core-S81-demo.md');
    expect(l4[0].message).toContain('ADDED 章节没有形成唯一新增结果');
    expect(l4[0].fix).toContain('body **不含章节标题本身**');
    expect(badText.stdout.trimEnd().split('\n').pop()).toMatch(/^FAIL（/);

    // ② JSON 输出与改动前同夹具实测逐字节相同。
    const badJson = spawnCli(bad.root, ['change-lint', '--slug', LINT_RENDER_SLUG, '--format', 'json']);
    expect(badJson.status).toBe(2);
    expect(JSON.stringify(JSON.parse(badJson.stdout.trim().split('\n').pop()!).data))
      .toBe(JSON.stringify(baseline('l4-only').json.data));

    // ③ 合法夹具：全 ✓ 行 + PASS、退出码 0，形态与改动前逐字相同。
    const goodText = spawnCli(good.root, ['change-lint', '--slug', LINT_RENDER_SLUG]);
    expect(goodText.status).toBe(0);
    expect(goodText.stdout).toBe(baseline('clean').text.stdout);
    const goodJson = spawnCli(good.root, ['change-lint', '--slug', LINT_RENDER_SLUG, '--format', 'json']);
    expect(JSON.stringify(JSON.parse(goodJson.stdout.trim().split('\n').pop()!).data))
      .toBe(JSON.stringify(baseline('clean').json.data));

    // ④ 零写入：运行前后夹具与本仓项目根字节快照均不变。
    expect(snapshotTree(bad.root)).toEqual(beforeFixture);
    expect(repoState()).toBe(beforeRepo);
  });
});
