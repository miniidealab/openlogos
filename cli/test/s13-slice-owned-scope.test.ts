/**
 * UT-S13-132/133/134/136/139/140、ST-S13-37：切片 checkpoint 的 owned 验收范围（slice-verify-efficient-mode 切片 1）。
 *
 * 对应功能规格 §2.37.2、§2.37.4、§2.37.8、§2.101，根规范 `spec/test-slice-manifest.md` §7、§7.1，
 * `spec/test-results.md`「切片 checkpoint 的结果集合与 pending 语义」，
 * 场景 S13「S13 切片 checkpoint 的 owned 验收范围」EX-11.1～EX-11.5。
 * 夹具 SV：基线 B = UT-S01-01～03 + ST-S01-01，变更 C = UT-S90-01～03；slice-a {01,02}，slice-b {03}。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts）写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectVerifyData, computeInScopeIds } from '../src/commands/verify.js';
import { deriveSliceVerificationState } from '../src/lib/test-slice-manifest.js';
import type { VerifyScopeData } from '../src/lib/verify-scope.js';
import {
  CHANGED, SLUG, checkCodeTasks, cliJson, createScopeFixture, fileState, passAll, passCurrentSlice, plan,
  readManifest, runVerifyJson, state, writeManifestRaw, writeResults, writeSlicesFile,
  type FixtureOptions, type ScopeFixture,
} from './slice-scope-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const BASELINE = ['ST-S01-01', 'UT-S01-01', 'UT-S01-02', 'UT-S01-03'];

function fx(options: FixtureOptions = {}): ScopeFixture {
  const { fixture, cleanup } = createScopeFixture(options);
  cleanups.push(cleanup);
  return fixture;
}

/** SV-owned / SV-baseline / SV-legacy（manifest 无 verify_scope 字段）。 */
function sv(kind: 'owned' | 'baseline' | 'legacy', options: FixtureOptions = {}): ScopeFixture {
  const f = fx({ ...options, verify: { slice_scope: kind === 'owned' ? 'owned' : 'baseline' } });
  plan(f);
  if (kind === 'legacy') {
    const raw = readManifest(f) as unknown as Record<string, unknown>;
    delete raw.verify_scope;
    writeManifestRaw(f, raw);
  }
  return f;
}

function readLoopIters(f: ScopeFixture): string {
  const path = join(f.dir, 'LOOP_ITERS');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('S13 切片 checkpoint 的 owned 验收范围', () => {
  it('UT-S13-132: owned 范围的 eligible / pending 公式', () => {
    const f = sv('owned');
    const first = state(f);
    expect(first).toMatchObject({
      verify_mode: 'slice-checkpoint', attempted_slice_id: 'slice-a', verify_scope: 'owned',
      eligible_test_ids: ['UT-S90-01', 'UT-S90-02'], pending_test_ids: ['UT-S90-03'],
    });
    passCurrentSlice(f);
    const second = state(f);
    expect(second).toMatchObject({
      attempted_slice_id: 'slice-b', eligible_test_ids: CHANGED, pending_test_ids: [],
    });
    for (const current of [first, second]) {
      expect(current.eligible_test_ids.some(id => BASELINE.includes(id))).toBe(false);
    }
  });

  it('UT-S13-133: owned 范围下基线无结果不计 uncovered', () => {
    const f = sv('owned');
    writeResults(f.root, passAll(['UT-S90-01', 'UT-S90-02']));
    const run = runVerifyJson(f.root);
    expect(run.exited).toBe(false);
    expect(run.data.gate.result).toBe('PASS');
    expect(run.data.verify_mode).toBe('slice-checkpoint');
    expect(run.data.eligible_test_ids).toHaveLength(2);
    expect(run.data.uncovered_cases).toEqual([]);
    expect(run.data.summary.defined_count).toBe(2);
    expect(run.data.summary.coverage_pct ?? run.data.summary.coverage).toBe(100);
    const ledger = readFileSync(f.ledgerPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ slice_id: 'slice-a', result: 'PASS' });
    expect(existsSync(join(f.dir, 'VERIFY_PASS'))).toBe(false);
  });

  it('UT-S13-134: baseline 与旧 manifest 的集合与引入前一致', () => {
    const expected = [...BASELINE, 'UT-S90-01', 'UT-S90-02'].sort();
    const runs = (['baseline', 'legacy'] as const).map(kind => {
      const f = sv(kind);
      const current = state(f);
      expect(current.verify_scope).toBe('baseline');
      expect(current.eligible_test_ids).toEqual(expected);       // B ∪ owned(slice-a)，引入前公式
      expect(current.pending_test_ids).toEqual(['UT-S90-03']);
      writeResults(f.root, passAll(expected));
      const run = runVerifyJson(f.root);
      expect(run.data.gate.result).toBe('PASS');
      return run.data;
    });
    // 显式 baseline 与缺字段的旧 manifest：集合、Gate 与统计逐字段相同
    for (const key of ['eligible_test_ids', 'pending_test_ids', 'gate', 'summary', 'uncovered_cases', 'verify_mode']) {
      expect(runs[1][key], key).toEqual(runs[0][key]);
    }
  });

  it('UT-S13-136: owned 范围下输出基线结果判越界', () => {
    const f = sv('owned');
    writeResults(f.root, passAll(['UT-S90-01', 'UT-S90-02', 'UT-S01-01']));
    const direct = collectVerifyData(f.root, undefined, state(f));
    expect(direct.consistency.reasons).toContain('result_outside_eligible_scope');
    expect(direct.consistency.outside_eligible_result_ids).toEqual(['UT-S01-01']);
    const run = runVerifyJson(f.root);
    expect(run.exited).toBe(true);
    expect(run.data.gate.result).toBe('FAIL');
    expect(existsSync(join(f.dir, 'VERIFY_FAIL'))).toBe(true);
    expect(readLoopIters(f)).toContain('"verify_mode":"slice-checkpoint"');
    expect(readLoopIters(f)).toContain('"attempted_slice_id":"slice-a"');
    expect(existsSync(f.ledgerPath) ? readFileSync(f.ledgerPath, 'utf8') : '').not.toContain('"result":"PASS"');
  });

  it('UT-S13-139: owned 范围下 final 仍全量', () => {
    const all = [...BASELINE, ...CHANGED].sort();
    const finalFixture = (): ScopeFixture => {
      const f = sv('owned');
      passCurrentSlice(f);
      passCurrentSlice(f);
      checkCodeTasks(f, 2);
      const current = state(f);
      expect(current).toMatchObject({ verify_mode: 'final', eligible_test_ids: all, pending_test_ids: [] });
      return f;
    };
    // ① 只有 owned 结果：基线进入 uncovered，不改列 pending
    const only = finalFixture();
    writeResults(only.root, passAll(CHANGED));
    const r1 = runVerifyJson(only.root);
    expect(r1.data.verify_mode).toBe('final');
    expect(r1.data.gate).toMatchObject({ result: 'FAIL', reason: 'incomplete_coverage' });
    expect([...r1.data.uncovered_cases].sort()).toEqual(BASELINE);
    expect(r1.data.pending_test_ids).toEqual([]);
    // ② 全量通过：写 VERIFY_PASS
    const green = finalFixture();
    writeResults(green.root, passAll(all));
    const r2 = runVerifyJson(green.root);
    expect(r2.data.gate.result).toBe('PASS');
    expect(existsSync(join(green.dir, 'VERIFY_PASS'))).toBe(true);
    // ③ 基线回归失败：failed_cases + final LOOP_ITERS
    const red = finalFixture();
    writeResults(red.root, all.map(id => (id === 'UT-S01-02' ? { id, status: 'fail' as const, error: '基线回归失败' } : { id, status: 'pass' as const })));
    const r3 = runVerifyJson(red.root);
    expect(r3.data.gate).toMatchObject({ result: 'FAIL', reason: 'failed_cases' });
    expect(readLoopIters(red)).toContain('"verify_mode":"final"');
    expect(existsSync(join(red.dir, 'VERIFY_PASS'))).toBe(false);
  });

  it('UT-S13-140: owned 范围与模块范围叠加', () => {
    const f = sv('owned', { team: true });
    const scope: VerifyScopeData = {
      mode: 'module', modules: ['core'], reasons: [], fallback_reason: null, out_of_scope_result_count: 0,
    };
    const inScope = computeInScopeIds(f.root, scope);
    expect(inScope.has('UT-S60-01')).toBe(false);
    const current = deriveSliceVerificationState(f.root, f.dir, { change: SLUG, module: 'core' },
      { inScope: id => inScope.has(id) })!;
    expect(current.eligible_test_ids).toEqual(['UT-S90-01', 'UT-S90-02']);   // 不含 B_S、不含 UT-S60-01
    writeResults(f.root, passAll(['UT-S90-01', 'UT-S90-02', 'UT-S60-01']));
    const data = collectVerifyData(f.root, undefined, current, { scope, inScope });
    expect(data.scope).toMatchObject({ mode: 'module', out_of_scope_result_count: 1 });
    expect(data.consistency.reasons).not.toContain('result_outside_eligible_scope');
    expect(data.uncovered_cases).toEqual([]);
  });

  it('ST-S13-37: owned 范围下后续切片改坏前序切片被 checkpoint 拦下（真实 CLI）', () => {
    const f = fx({ verify: { slice_scope: 'owned' } });
    expect(cliJson(f.root, 'slice', 'plan', '--file', writeSlicesFile(f)).status).toBe(0);
    writeResults(f.root, passAll(['UT-S90-01', 'UT-S90-02']));
    expect(cliJson(f.root, 'verify').json.data.gate.result).toBe('PASS');
    checkCodeTasks(f, 1);
    // ① 切片二的实现使切片一的 UT-S90-01 失败
    writeResults(f.root, [
      { id: 'UT-S90-01', status: 'fail', error: '切片二改坏了切片一' }, { id: 'UT-S90-02', status: 'pass' }, { id: 'UT-S90-03', status: 'pass' },
    ]);
    const failed = cliJson(f.root, 'verify');
    expect(failed.status).not.toBe(0);
    expect(failed.json.data).toMatchObject({ attempted_slice_id: 'slice-b', verify_mode: 'slice-checkpoint' });
    expect(failed.json.data.eligible_test_ids).toContain('UT-S90-01');
    expect(failed.json.data.gate.result).toBe('FAIL');
    expect(readLoopIters(f)).toContain('"attempted_slice_id":"slice-b"');
    const midway = cliJson(f.root, 'next').json.data.modules[0].slice_verification_state;
    expect(midway.confirmed_slice_ids).toEqual(['slice-a']);
    // ② 修复后重跑
    const ledgerBefore = fileState(f.ledgerPath);
    writeResults(f.root, passAll(CHANGED));
    expect(cliJson(f.root, 'verify').json.data.gate.result).toBe('PASS');
    expect(fileState(f.ledgerPath)).not.toEqual(ledgerBefore);
    const rows = readFileSync(f.ledgerPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(rows.filter(row => row.result === 'PASS').map(row => row.slice_id)).toEqual(['slice-a', 'slice-b']);
  });
});
