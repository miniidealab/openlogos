/**
 * S09 — merge 内部错误的稳定失败语义、状态分档与可归因诊断
 * （fix-merge-preflight-parity-and-bare-throw，切片 2）。
 * 覆盖 UT-S09-351～UT-S09-354、ST-S09-145（与 logos/resources/test/core-S09-test-cases.md 严格对齐）。
 *
 * 本组测试锁的是「失败**怎么被描述**」：
 *  - 默认兜底：任何逃出 mergeDirect 的错误类都必须产出四要素稳定形态，绝不裸抛（旧实现 `throw e`）；
 *  - 状态分档：档位只由控制流位置与落盘原语结构化返回派生，**不得**从 message 文本反推；
 *  - 不谎报：committed 之后失败时禁止声明「保持合并前字节 / 未写 SPEC_MERGED」——那比裸堆栈更有害；
 *  - 不臆造：delta 侧归属唯一命中才报，否则显式说明未能归因。
 *
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import {
  makeTempRoot, scaffoldProject, withCompleteClarification, registerCoreModule,
} from './helpers.js';
import { runDirectMerge } from '../src/commands/merge.js';
import { MergeDirectError } from '../src/lib/merge-direct.js';
import {
  TestChangeSetBuildError, buildTestChangeSet, forwardMergeTestChangeSets, AFTER_STATE_LINE_NOTE,
} from '../src/lib/test-change-set.js';
import {
  describeMergeFailure, classifyMergeFailureTier, readMergeFailureDiskFacts, MERGE_FALLBACK_ERROR_CODE,
} from '../src/lib/merge-failure-report.js';
import { BASELINE_CLOSURE_APPLY_JOURNAL } from '../src/lib/baseline-apply.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CLI_ROOT = join(REPO_ROOT, 'cli');
const SPEC_REL = 'logos/resources/test/core-S99-test-cases.md';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function spawnCli(cwd: string, args: string[], extraEnv: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args], {
    cwd, encoding: 'utf-8',
    env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0', ...extraEnv },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 一次性隔离项目 + 活跃提案骨架；baseline 表体与 delta 表体均由调用方给定。 */
function setup(opts: { baselineTable: string; deltaBody: string; slug?: string }) {
  const slug = opts.slug ?? 'merge-failure';
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
    '# 变更提案：失败语义夹具', '', '> module: core', '',
    '## 变更原因', '复刻 merge 失败出口现场。', '',
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
  const baselineText = ['# core-S99 测试用例', '', '## 一、既有用例', '', opts.baselineTable, ''].join('\n');
  writeFileSync(join(root, SPEC_REL), baselineText);
  writeFileSync(join(dir, 'deltas', 'test', 'core-S99-test-cases.md'), opts.deltaBody);
  return { root, dir, slug, baselineText };
}

class ExitSignal extends Error {
  constructor(readonly exitCode: number) { super(`exit:${exitCode}`); }
}

/** 调 runDirectMerge 并捕获 stderr 与退出行为（不终止测试进程）。 */
function runCapturing(root: string, dir: string, slug: string, stub?: () => never) {
  const lines: string[] = [];
  let exitCode: number | null = null;
  let returned: unknown;
  try {
    returned = runDirectMerge(root, dir, slug, {
      merge: stub ? (() => stub()) as never : undefined,
      stderr: line => lines.push(line),
      exit: (code: number) => { exitCode = code; throw new ExitSignal(code); },
    });
  } catch (e) {
    if (!(e instanceof ExitSignal)) throw e;
  }
  return { lines, text: lines.join('\n'), exitCode, returned };
}

const TIER_A_STATE = '  logos/resources/ 保持合并前字节，未写 SPEC_MERGED。';
const tierRollbackHint = (slug: string) =>
  '  回滚点：git checkout logos/resources/；修正 delta 后重跑 `openlogos merge ' + slug + '`。';

/**
 * 裸抛特征：栈帧行 / Node 版本尾行 / 以错误类名开头的裸首行（三项负向匹配，缺一不可）。
 *
 * 第三项须排除**稳定前缀行本身**：错误类名恰为 `Error` 时，`Error: merge 失败（…）` 与裸抛首行
 * 在正则上无法区分——不排除即把正确输出误判为裸抛（判据必须认「裸」，而不是认类名出现过）。
 */
function stackShapeHits(text: string, className: string): string[] {
  const hits: string[] = [];
  if (/^\s+at .+ \(/m.test(text)) hits.push('stack-frame');
  if (/^Node\.js v/m.test(text)) hits.push('node-version-footer');
  const bare = text.split('\n')
    .some(line => line.startsWith(`${className}:`) && !line.startsWith('Error: merge 失败（'));
  if (bare) hits.push('bare-error-class-line');
  return hits;
}

/** 目录全树字节快照（相对路径 → 内容），用于零残留比对。 */
function snapshotTree(dir: string, base = dir): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      for (const [k, v] of snapshotTree(abs, base)) out.set(k, v);
    } else {
      out.set(abs.slice(base.length + 1), readFileSync(abs, 'utf8'));
    }
  }
  return out;
}

const LEGAL_BASELINE = [
  '| ID | 用例 |',
  '|---|---|',
  '| UT-S99-01 | 既有 |',
].join('\n');

/** 事故形态：基线表内已存在列数不一致的数据行（delta 侧看不见 ⇒ 天然绕过前移预检）。 */
const MALFORMED_BASELINE = [
  '| ID | 用例 |',
  '|---|---|',
  '| UT-S99-01 | 既有 |',
  '| UT-S99-02 |',
].join('\n');

const MALFORMED_BASELINE_FIXED = MALFORMED_BASELINE.replace('| UT-S99-02 |', '| UT-S99-02 | 既有二 |');

const CLEAN_DELTA = [
  '## ADDED — 二、新增用例', '',
  '| ID | 用例 |',
  '|---|---|',
  '| UT-S99-10 | 新增 |',
  '',
].join('\n');

describe('S09 merge 失败出口稳定语义', () => {
  it('UT-S09-351: 默认兜底——任何内部错误类均映射四要素稳定形态且取档 A', () => {
    const { root, dir, slug } = setup({ baselineTable: LEGAL_BASELINE, deltaBody: CLEAN_DELTA, slug: 'tier-a' });

    // ① 已登记的 MergeDirectError（既有通道，行为逐字不变）
    const a = runCapturing(root, dir, slug, () => {
      throw new MergeDirectError('MERGE_DELTA_INVALID', 'X 目标合成失败');
    });
    expect(a.exitCode).toBe(1);
    expect(a.lines[0]).toContain('Error: merge 失败（MERGE_DELTA_INVALID）：');
    expect(a.lines).toContain(TIER_A_STATE);
    expect(a.lines).toContain(tierRollbackHint(slug));

    // ② TestChangeSetBuildError——修复前 `throw e` 逃到进程顶层裸抛，本臂即该通道的回归锁
    const b = runCapturing(root, dir, slug, () => {
      throw new TestChangeSetBuildError(
        'test-change-set-ambiguous-table',
        `test-change-set-ambiguous-table：${SPEC_REL}:771${AFTER_STATE_LINE_NOTE}`,
        [SPEC_REL],
      );
    });
    expect(b.exitCode).toBe(1);
    expect(b.lines[0]).toContain('Error: merge 失败（test-change-set-ambiguous-table）：');
    expect(b.lines).toContain(TIER_A_STATE);
    expect(b.lines).toContain(tierRollbackHint(slug));
    expect(stackShapeHits(b.text, 'TestChangeSetBuildError')).toEqual([]);

    // ③ 未登记的合成内部错误类（无 code）——稳定兜底码 + 原始 message + 错误类名
    class SyntheticInternalError extends Error {
      constructor(message: string) { super(message); this.name = 'SyntheticInternalError'; }
    }
    const c = runCapturing(root, dir, slug, () => { throw new SyntheticInternalError('内部不变式被打破'); });
    expect(c.exitCode).toBe(1);
    expect(c.lines[0]).toBe(`Error: merge 失败（${MERGE_FALLBACK_ERROR_CODE}）：内部不变式被打破`);
    expect(c.text).toContain('错误类：SyntheticInternalError');
    expect(c.lines).toContain(TIER_A_STATE);
    expect(stackShapeHits(c.text, 'SyntheticInternalError')).toEqual([]);

    // 反证臂：档位取自控制流位置与磁盘事实，**不从 message 文本反推**——
    // 消息里写满「已提交 / SPEC_MERGED 已写入」的 prepare 阶段错误仍须判档 A。
    const misleading = runCapturing(root, dir, slug, () => {
      throw new MergeDirectError('MERGE_DELTA_INVALID', '主文档已是合并后字节，SPEC_MERGED 已写入');
    });
    expect(misleading.lines).toContain(TIER_A_STATE);
  });

  it('UT-S09-352: 诊断不降级——code 原样入错误码位，targetPaths 与原始 message 不被吞', () => {
    const { root, dir, slug } = setup({ baselineTable: LEGAL_BASELINE, deltaBody: CLEAN_DELTA, slug: 'diag' });
    const other = 'logos/resources/test/core-S98-test-cases.md';
    const message = `test-change-set-ambiguous-table：${SPEC_REL}:771${AFTER_STATE_LINE_NOTE}`;
    // 构造顺序倒置：错误类按既有 ASCII 序归一，输出须稳定。
    const run = runCapturing(root, dir, slug, () => {
      throw new TestChangeSetBuildError('test-change-set-ambiguous-table', message, [SPEC_REL, other]);
    });

    expect(run.lines[0]).toBe(`Error: merge 失败（test-change-set-ambiguous-table）：${message}`);
    expect(run.lines[0]).not.toContain(MERGE_FALLBACK_ERROR_CODE);
    expect(run.text).toContain(AFTER_STATE_LINE_NOTE);
    const targetLine = run.lines.find(l => l.includes('涉及 canonical target'))!;
    expect(targetLine).toContain(other);
    expect(targetLine).toContain(SPEC_REL);
    expect(targetLine.indexOf(other)).toBeLessThan(targetLine.indexOf(SPEC_REL));
  });

  it('UT-S09-353: 可归因优先级——唯一命中才报 delta 侧行号，归属不可得时不伪造', () => {
    const uniqueDelta = [
      '## ADDED — 二、新增用例', '',
      '| ID | 用例 | 备注 |',
      '|---|---|---|',
      '| UT-S99-10 | 正常 | ok |',
      '| UT-S99-11 | 少一列 |',
      '',
    ].join('\n');
    const one = setup({ baselineTable: LEGAL_BASELINE, deltaBody: uniqueDelta, slug: 'attr-one' });
    const err = () => {
      throw new TestChangeSetBuildError(
        'test-change-set-ambiguous-table',
        `test-change-set-ambiguous-table：${SPEC_REL}:42${AFTER_STATE_LINE_NOTE}`,
        [SPEC_REL],
      );
    };
    const hit = runCapturing(one.root, one.dir, one.slug, err);
    // 病灶行在 delta 文件内 1 基第 6 行（`## ADDED` 行为第 1 行）。
    expect(hit.text).toContain('delta 侧归属（主诊断，可直接修改）：deltas/test/core-S99-test-cases.md:6');
    expect(hit.text).toContain('表头 3 列，本行 2 列');
    // 主诊断与佐证并列在场。
    expect(hit.text).toContain(`${SPEC_REL}:42${AFTER_STATE_LINE_NOTE}`);

    // ② 同一形态但归属不唯一（两处病灶）——降级为「未能确定」，且输出中不得出现任何 delta 侧行号
    const ambiguousDelta = uniqueDelta.replace('| UT-S99-10 | 正常 | ok |', '| UT-S99-10 | 也少一列 |');
    const many = setup({ baselineTable: LEGAL_BASELINE, deltaBody: ambiguousDelta, slug: 'attr-many' });
    const miss = runCapturing(many.root, many.dir, many.slug, err);
    expect(miss.text).toContain('delta 侧归属：未能确定');
    expect(miss.text).not.toContain('主诊断');
    expect(miss.text).not.toMatch(/deltas\/[^\s]*:\d+/);
    expect(miss.text).toContain(AFTER_STATE_LINE_NOTE);
  });

  it('UT-S09-354: 状态档 B / C 分档正确，提交后失败不谎报零残留', () => {
    // ① 真实落盘中途失败 → 原语整批回滚（ok:false, rolled_back:true）→ 档 B
    const b = setup({ baselineTable: LEGAL_BASELINE, deltaBody: CLEAN_DELTA, slug: 'tier-b' });
    const before = readFileSync(join(b.root, SPEC_REL), 'utf8');
    const prevFailAfter = process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
    process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = SPEC_REL;
    const runB = runCapturing(b.root, b.dir, b.slug);
    if (prevFailAfter === undefined) delete process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
    else process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = prevFailAfter;

    expect(runB.exitCode).toBe(1);
    expect(runB.lines[0]).toContain('Error: merge 失败（MERGE_APPLY_FAILED）：');
    expect(runB.text).toContain('保持合并前字节');
    expect(runB.text).toContain('已整批回滚');
    expect(readFileSync(join(b.root, SPEC_REL), 'utf8')).toBe(before);
    expect(existsSync(join(b.dir, 'SPEC_MERGED'))).toBe(false);

    // ② 原语返回 ok:false 且 rolled_back !== true → 档 C（与 mergeDirect 的构造逐字同形）
    const c2 = setup({ baselineTable: LEGAL_BASELINE, deltaBody: CLEAN_DELTA, slug: 'tier-c2' });
    const runC2 = runCapturing(c2.root, c2.dir, c2.slug, () => {
      throw new MergeDirectError('MERGE_APPLY_FAILED', '回滚失败：backup 缺失', 'apply-unconfirmed');
    });
    expect(runC2.exitCode).toBe(1);
    expect(runC2.text).not.toContain('保持合并前字节');
    expect(runC2.text).not.toContain('未写 SPEC_MERGED');
    expect(runC2.text).toContain('状态不可确认');
    expect(runC2.text).toContain('git status');
    expect(runC2.text).toContain('git diff logos/resources/');
    expect(runC2.text).toContain('回滚失败：backup 缺失');

    // ③ 提交后清理失败：错误自原语内部逃出 → 档 C，且状态声明须与磁盘事实一致
    const c3 = setup({ baselineTable: LEGAL_BASELINE, deltaBody: CLEAN_DELTA, slug: 'tier-c3' });
    const prevCleanup = process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL;
    process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL = '1';
    const runC3 = runCapturing(c3.root, c3.dir, c3.slug);
    if (prevCleanup === undefined) delete process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL;
    else process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL = prevCleanup;

    expect(runC3.exitCode).toBe(1);
    expect(runC3.text).not.toContain('保持合并前字节');
    expect(runC3.text).not.toContain('未写 SPEC_MERGED');
    expect(runC3.text).toContain('状态不可确认');
    // 磁盘事实：目标确为新字节、SPEC_MERGED 确在场——旧实现在此会输出与事实相反的断言。
    expect(readFileSync(join(c3.root, SPEC_REL), 'utf8')).toContain('UT-S99-10');
    expect(existsSync(join(c3.dir, 'SPEC_MERGED'))).toBe(true);
    expect(existsSync(join(c3.dir, BASELINE_CLOSURE_APPLY_JOURNAL))).toBe(true);

    // 反证臂：若把档位判据改为「从 message 文本反推」，本断言必红——
    // 消息自称「已整批回滚」，但结构化阶段事实是 apply-unconfirmed，判定必须仍为 C。
    const lying = new MergeDirectError('MERGE_APPLY_FAILED', '主文档已回滚至合并前字节', 'apply-unconfirmed');
    expect(classifyMergeFailureTier(lying, readMergeFailureDiskFacts(c2.dir))).toBe('C');
    // 且磁盘事实兜底：无戳错误 + 已提交现场（marker 在场）同样判 C，不判 A。
    expect(classifyMergeFailureTier(new Error('无戳'), readMergeFailureDiskFacts(c3.dir))).toBe('C');
    expect(describeMergeFailure(c3.dir, c3.slug, new Error('无戳')).tier).toBe('C');
  });

  it('ST-S09-145: 真实 CLI——20260914 事故现场的稳定失败语义、零残留、分档与成功路径零漂移', () => {
    // 病灶在**基线**表内（delta 侧无病灶）：change-lint 前移检查看不到它 ⇒ 天然绕过预检，
    // 直达后态 buildTestChangeSet——正是 20260914 事故的抛点。
    const { root, dir, slug, baselineText } = setup({
      baselineTable: MALFORMED_BASELINE, deltaBody: CLEAN_DELTA, slug: 'e2e-failure',
    });

    const lint = spawnCli(root, ['change-lint', '--slug', slug, '--format', 'json']);
    expect(lint.status, lint.stdout + lint.stderr).toBe(0);

    const resourcesDir = join(root, 'logos', 'resources');
    const beforeTree = snapshotTree(resourcesDir);
    const bad = spawnCli(root, ['merge', slug]);

    // ① 非零退出
    expect(bad.status).not.toBe(0);
    // ② 稳定前缀 + 错误码 + 档 A 状态声明 + 回滚点
    expect(bad.stderr).toContain('Error: merge 失败（test-change-set-ambiguous-table）：');
    expect(bad.stderr).toContain(AFTER_STATE_LINE_NOTE);
    expect(bad.stderr).toContain('logos/resources/ 保持合并前字节，未写 SPEC_MERGED。');
    expect(bad.stderr).toContain('git checkout logos/resources/');
    // ③ 零残留：全树逐字节相等、无 marker、无事务残留
    expect(snapshotTree(resourcesDir)).toEqual(beforeTree);
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(dir, BASELINE_CLOSURE_APPLY_JOURNAL))).toBe(false);
    // ④ 对照臂：stderr 全文无裸抛特征（修复前此处是 Node 未捕获异常堆栈）
    expect(stackShapeHits(bad.stderr, 'TestChangeSetBuildError')).toEqual([]);
    // 归属不可得时不伪造（病灶不在任何 delta 内）
    expect(bad.stderr).toContain('delta 侧归属：未能确定');
    expect(bad.stderr).not.toMatch(/deltas\/[^\s]*:\d+/);

    // ⑤ 成功路径零漂移：修正基线该行后重跑，stdout 与 test_change_set 与独立构建逐字段一致
    writeFileSync(join(root, SPEC_REL), baselineText.replace(MALFORMED_BASELINE, MALFORMED_BASELINE_FIXED));
    const beforeBytes = readFileSync(join(root, SPEC_REL));
    const good = spawnCli(root, ['merge', slug]);
    expect(good.status, good.stdout + good.stderr).toBe(0);
    expect(good.stdout).toContain('📋');
    expect(good.stdout).toContain(`→ ${SPEC_REL}`);
    expect(good.stdout).toContain('test_change_set: C=');
    const marker = JSON.parse(readFileSync(join(dir, 'SPEC_MERGED'), 'utf8'));
    const expected = forwardMergeTestChangeSets(buildTestChangeSet({
      change: slug,
      module: 'core',
      targets: [{ targetPath: SPEC_REL, beforeBytes, afterBytes: readFileSync(join(root, SPEC_REL)) }],
    }), []);
    expect(marker.test_change_set).toEqual(expected);

    // ⑥ 档 C 端到端：提交后清理持续失败，状态声明须与磁盘事实一致
    const c = setup({ baselineTable: LEGAL_BASELINE, deltaBody: CLEAN_DELTA, slug: 'e2e-tier-c' });
    const tierC = spawnCli(c.root, ['merge', c.slug], {
      NODE_ENV: 'test', OPENLOGOS_TEST_APPLY_CLEANUP_FAIL: '1',
    });
    expect(tierC.status).not.toBe(0);
    expect(stackShapeHits(tierC.stderr, 'Error')).toEqual([]);
    expect(tierC.stderr).not.toContain('保持合并前字节');
    expect(tierC.stderr).not.toContain('未写 SPEC_MERGED');
    expect(tierC.stderr).toContain('状态不可确认');
    expect(tierC.stderr).toContain('git status');
    expect(readFileSync(join(c.root, SPEC_REL), 'utf8')).toContain('UT-S99-10');
    expect(existsSync(join(c.dir, 'SPEC_MERGED'))).toBe(true);
  });
});
