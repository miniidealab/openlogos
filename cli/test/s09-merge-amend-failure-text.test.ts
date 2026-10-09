/**
 * S09 merge 增量修正失败的报告文案（verify-smoke-guard-fixes-0-15-20，切片 slice-04-merge-amend-failure-text）。
 *
 * 覆盖 UT-S09-455～UT-S09-458、ST-S09-203、ST-S09-204，对应功能规格 §2.84.3「增量修正路径的状态声明」与场景 S09
 * 「已合并提案的增量修正时序」EX-9.47～EX-9.50（决策 C05，proposal r1 F2）。
 * 夹具为 mkdtemp 下 git init 的已合并项目（首次合并后提交）；档 B / C 用仅测试环境生效的既有注入：
 * OPENLOGOS_TEST_MERGE_FAIL_AFTER（整批回滚）、OPENLOGOS_TEST_APPLY_CLEANUP_FAIL=1（已提交后清理失败）。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupFixtureRoots, cli, frontierFixture, invoke, put } from './frontier-fixture.js';
import { checkMergedProposal, executeAmend } from '../src/lib/merge-amend.js';
import { applyBaselineClosureBatch } from '../src/lib/baseline-apply.js';
import { mergeDirect } from '../src/lib/merge-direct.js';
import { describeMergeFailure } from '../src/lib/merge-failure-report.js';

afterAll(cleanupFixtureRoots);

const REQ = 'logos/resources/prd/1-product-requirements/core-01-requirements.md';
const FEATURE = 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md';
const SCENARIO = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md';
const CREATED = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S02-new.md';
const CHECKOUT = 'git checkout logos/resources/';
const FIRST_MERGE_A = '保持合并前字节，未写 SPEC_MERGED';
const CERTAIN_UNCHANGED = ['已合并状态未变', '未执行修正', '已恢复修正前状态', '保持合并前字节'];

type Fixture = ReturnType<typeof frontierFixture>;

function git(root: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}：${r.stderr}`);
  return r.stdout;
}
function commitAll(root: string, m: string) { git(root, ['add', '-A']); git(root, ['commit', '-q', '--allow-empty', '-m', m]); }
const deltaOf = (target: string) => target.replace(/^logos\/resources\//, 'deltas/');
function writeDelta(f: Fixture, target: string, content: string) { put(f.root, `logos/changes/${f.slug}/${deltaOf(target)}`, content); }

function gitFixture(): Fixture {
  const f = frontierFixture();
  writeDelta(f, CREATED, '## ADDED — 新场景\n\n第一版。\n');
  git(f.root, ['init', '-q']);
  git(f.root, ['config', 'user.email', 'fixture@example.com']);
  git(f.root, ['config', 'user.name', 'fixture']);
  git(f.root, ['config', 'commit.gpgsign', 'false']);
  commitAll(f.root, 'init');
  return f;
}

function merge(f: Fixture, env: Record<string, string> = {}, json = true) {
  const r = spawnSync(process.execPath, [cli, 'merge', f.slug, ...(json ? ['--format', 'json'] : [])], {
    cwd: f.root, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0', ...env },
  });
  let envelope: { code: string; message: string } | null = null;
  if (json && r.status !== 0) {
    try { envelope = JSON.parse(r.stderr.trim().split('\n').pop() ?? '').error; } catch { envelope = null; }
  }
  return { status: r.status, stderr: r.stderr, stdout: r.stdout, envelope };
}

function mergedFixture(): Fixture {
  const f = gitFixture();
  const r = merge(f);
  expect(r.status, r.stderr).toBe(0);
  commitAll(f.root, 'merge');
  return f;
}

function marker(f: Fixture) { return JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8')); }

function expectNoCheckout(text: string, label: string) {
  expect(text, `${label}：不得建议 ${CHECKOUT}`).not.toContain(CHECKOUT);
}

describe('S09 merge 增量修正失败文案 — 单元测试', () => {
  it('UT-S09-455: 前置拒绝（档 A）使用修正文案且无 git checkout', () => {
    const arms: Array<[string, string, (f: Fixture) => void, string]> = [
      ['主文档漂移', 'MERGE_AMEND_DRIFT', (f) => {
        writeDelta(f, SCENARIO, '## MODIFIED — 一、判据\n\n修正。\n');
        writeFileSync(join(f.root, ...REQ.split('/')), `${readFileSync(join(f.root, ...REQ.split('/')), 'utf8')}手工改动。\n`);
      }, '漂移文件'],
      ['旧标记无基线', 'MERGE_AMEND_BASELINE_MISSING', (f) => {
        const m = marker(f); delete m.merge_baseline; delete m.amendments;
        writeFileSync(join(f.proposalDir, 'SPEC_MERGED'), `${JSON.stringify(m, null, 2)}\n`);
        writeDelta(f, SCENARIO, '## MODIFIED — 一、判据\n\n修正。\n');
      }, '另立新提案'],
      ['撤回首次 CREATE 目标', 'MERGE_AMEND_CREATE_WITHDRAW', (f) => {
        spawnSync('rm', [join(f.proposalDir, ...deltaOf(CREATED).split('/'))]);
      }, 'resource_index'],
    ];
    for (const [label, code, setup, guidance] of arms) {
      const f = mergedFixture();
      setup(f);
      const text = merge(f, {}, false);
      expect(text.status, label).not.toBe(0);
      expect(text.stderr, label).toContain(`merge 失败（${code}）`);
      expect(text.stderr, label).toContain('未进入修正写入');
      expect(text.stderr, label).toContain('保持本次修正前的状态');
      expect(text.stderr, label).toContain(guidance);
      expectNoCheckout(text.stderr, `${label} stderr`);
      expect(text.stderr, label).not.toContain(FIRST_MERGE_A);
      const json = merge(f);
      expect(json.envelope?.code, label).toBe(code);
      expect(json.envelope?.message, label).toContain('未进入修正写入');
      expectNoCheckout(json.envelope?.message ?? '', `${label} envelope`);
      expect(json.envelope?.message, label).not.toContain(FIRST_MERGE_A);
    }
  });

  it('UT-S09-456: 落盘失败且已确认回滚（档 B）', () => {
    const f = mergedFixture();
    const verifyPass = 'verified\n';
    writeFileSync(join(f.proposalDir, 'VERIFY_PASS'), verifyPass);
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n修正一。\n');
    writeDelta(f, SCENARIO, '## MODIFIED — 一、判据\n\n修正二。\n');
    const before = readFileSync(join(f.root, ...SCENARIO.split('/')), 'utf8');
    const r = merge(f, { OPENLOGOS_TEST_MERGE_FAIL_AFTER: SCENARIO });
    expect(r.status).not.toBe(0);
    expect(r.envelope?.code).toBe('MERGE_APPLY_FAILED');
    expect(r.stderr).toContain('已确认整批回滚');
    expect(r.stderr).toContain('SPEC_MERGED 原记录保留');
    expect(r.stderr).toContain('已按备份恢复');
    expectNoCheckout(r.stderr, 'stderr');
    expectNoCheckout(r.envelope?.message ?? '', 'envelope');
    expect(r.envelope?.message).toContain('已确认整批回滚');
    expect(readFileSync(join(f.proposalDir, 'VERIFY_PASS'), 'utf8')).toBe(verifyPass);
    expect(readFileSync(join(f.root, ...SCENARIO.split('/')), 'utf8')).toBe(before);
  });

  it('UT-S09-457: 已提交后清理失败与原语抛错逃逸（档 C）', () => {
    // 臂 ①：真实 CLI，已提交后清理持续失败（已提交后清理失败的反例）
    {
      const f = mergedFixture();
      writeFileSync(join(f.proposalDir, 'VERIFY_PASS'), '');
      writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n已提交的修正。\n');
      const r = merge(f, { OPENLOGOS_TEST_APPLY_CLEANUP_FAIL: '1' });
      expect(r.status).not.toBe(0);
      for (const text of [r.stderr, r.envelope?.message ?? '']) {
        expect(text).toContain('可能已提交本次修正或状态不可确认');
        expect(text).toContain('SPEC_MERGED 可能已改写');
        expect(text).toContain('须重新 verify');
        expect(text).toContain('git status');
        for (const phrase of CERTAIN_UNCHANGED) expect(text, phrase).not.toContain(phrase);
        expectNoCheckout(text, '臂①');
      }
      expect(r.envelope?.code, '保留原始错误码').toBeTruthy();
      expect(existsSync(join(f.proposalDir, 'VERIFY_PASS'))).toBe(false);
      // SPEC_MERGED 实际已含新的修正记录：证明「未变」断言与磁盘相反
      expect(marker(f).amendments.length).toBe(1);
      expect(readFileSync(join(f.root, ...FEATURE.split('/')), 'utf8')).toContain('已提交的修正。');
    }
    // 臂 ②：lib 级注入落盘原语返回 ok:false、rolled_back:false
    {
      const f = mergedFixture();
      writeFileSync(join(f.proposalDir, 'VERIFY_PASS'), '');
      writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n修正。\n');
      const check = checkMergedProposal(f.root, f.proposalDir);
      if (check.kind !== 'amend') throw new Error('前置：应进入增量修正');
      let caught: unknown = null;
      try {
        executeAmend(f.root, f.proposalDir, f.slug, check.plan, {
          apply: (root, dir, inputs, hook) => {
            const real = applyBaselineClosureBatch(root, dir, inputs, hook);
            return real.ok ? { ok: false, error: 'test: 回滚未确认', rolled_back: false } : real;
          },
        });
      } catch (e) { caught = e; }
      const report = describeMergeFailure(f.proposalDir, f.slug, caught);
      expect(report.tier).toBe('C');
      expect(report.amend).toBe(true);
      const text = report.lines.join('\n');
      expect(text).toContain('可能已提交本次修正或状态不可确认');
      for (const phrase of CERTAIN_UNCHANGED) expect(text, phrase).not.toContain(phrase);
      expectNoCheckout(text, '臂②');
      expect(existsSync(join(f.proposalDir, 'VERIFY_PASS'))).toBe(false);
    }
  });

  it('UT-S09-458: 首次合并失败文案逐字不变', () => {
    // 档 A：准备阶段失败（delta 锚不可解析；lib 入口绕过准入，直达合成失败的报告）
    const a = gitFixture();
    writeDelta(a, SCENARIO, '## MODIFIED — 不存在的章节\n\n正文。\n');
    let caught: unknown = null;
    try { mergeDirect(a.root, a.proposalDir, a.slug); } catch (e) { caught = e; }
    const ra = describeMergeFailure(a.proposalDir, a.slug, caught);
    expect(ra.amend).toBe(false);
    const textA = ra.lines.join('\n');
    expect(textA).toContain('  logos/resources/ 保持合并前字节，未写 SPEC_MERGED。');
    expect(textA).toContain(`  回滚点：${CHECKOUT}；修正 delta 后重跑 \`openlogos merge ${a.slug}\`。`);
    expect(textA).not.toContain('未进入修正写入');
    // 档 B：落盘中途失败、已整批回滚
    const b = gitFixture();
    const rb = merge(b, { OPENLOGOS_TEST_MERGE_FAIL_AFTER: SCENARIO }, false);
    expect(rb.stderr).toContain('  logos/resources/ 保持合并前字节，未写 SPEC_MERGED（落盘中途失败，已整批回滚）。');
    expect(rb.stderr).toContain(`回滚点：${CHECKOUT}`);
    expect(rb.stderr).not.toContain('已确认整批回滚');
    // 档 C：已提交后清理失败
    const c = gitFixture();
    const rc = merge(c, { OPENLOGOS_TEST_APPLY_CLEANUP_FAIL: '1' }, false);
    expect(rc.stderr).toContain('  状态不可确认：主文档可能已是合并后字节，SPEC_MERGED 可能已写入，提案目录下可能残留私有事务材料。');
    expect(rc.stderr).not.toContain('可能已提交本次修正');
  });
});

describe('S09 merge 增量修正失败文案 — 场景测试', () => {
  it('ST-S09-203: 漂移被拒后按指引核对不丢未提交改动', () => {
    const f = mergedFixture();
    writeDelta(f, SCENARIO, '## MODIFIED — 一、判据\n\n修正。\n');
    const reqAbs = join(f.root, ...REQ.split('/'));
    const manual = `${readFileSync(reqAbs, 'utf8')}未提交的手工修改。\n`;
    writeFileSync(reqAbs, manual);
    const r = merge(f);
    expect(r.status).not.toBe(0);
    expect(r.envelope?.code).toBe('MERGE_AMEND_DRIFT');
    expect(r.stderr).toContain('未进入修正写入');
    expect(r.stderr).toContain(REQ);
    expectNoCheckout(r.stderr, 'stderr');
    expectNoCheckout(r.envelope?.message ?? '', 'envelope');
    expect(readFileSync(reqAbs, 'utf8'), '手工修改仍在').toBe(manual);
  });

  it('ST-S09-204: 档 C 端到端——已提交后清理失败', () => {
    const f = mergedFixture();
    writeFileSync(join(f.proposalDir, 'VERIFY_PASS'), '');
    const tasks = readFileSync(join(f.proposalDir, 'tasks.md'), 'utf8').replace(/## \[code\] 代码实现\n?/, '## [code] 代码实现\n\n- [x] 单切片：实现（覆盖 UT-S01-01）\n');
    writeFileSync(join(f.proposalDir, 'tasks.md'), tasks);
    commitAll(f.root, 'verified');
    writeDelta(f, FEATURE, '## MODIFIED — 一、判据\n\n交付后修正。\n');
    const r = merge(f, { OPENLOGOS_TEST_APPLY_CLEANUP_FAIL: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('可能已提交本次修正或状态不可确认');
    for (const phrase of CERTAIN_UNCHANGED) expect(r.stderr, phrase).not.toContain(phrase);
    expectNoCheckout(r.stderr, 'stderr');
    expect(marker(f).amendments.length, 'SPEC_MERGED 已新增修正记录').toBe(1);
    expect(readFileSync(join(f.root, ...FEATURE.split('/')), 'utf8')).toContain('交付后修正。');
    expect(existsSync(join(f.proposalDir, 'VERIFY_PASS'))).toBe(false);
    const archived = invoke(['archive', f.slug], f.root);
    expect(archived.status).not.toBe(0);
    expect(archived.stderr).toContain('ARCHIVE_VERIFY_NOT_PASSED');
  });
});
