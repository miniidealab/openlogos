/**
 * UT-S13-135/137/138、ST-S13-35/36：verify 向 runner 与验收报告暴露验收范围（slice-verify-efficient-mode 切片 2）。
 *
 * 对应功能规格 §2.37.4、§2.101.5，`spec/test-results.md`「三个集合」「checkpoint/final 报告」，
 * 场景 S13「S13 切片 checkpoint 的 owned 验收范围」Step 4、Step 7、Step 10、EX-11.3。
 * 夹具 SV（见 slice-scope-fixture.ts）+ 记录型运行器：只为 OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS 写结果，
 * 并把收到的 OPENLOGOS_VERIFY_SLICE_SCOPE（含「是否存在」）与 eligible 记入调用日志。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts）写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CHANGED, CLI_ROOT, checkCodeTasks, createScopeFixture, fileState, passCurrentSlice, plan, readManifest,
  runVerifyJson, setVerifyConfig, writeManifestRaw, writeSlicesFile, type FixtureOptions, type ScopeFixture,
} from './slice-scope-fixture.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const BASELINE = ['ST-S01-01', 'UT-S01-01', 'UT-S01-02', 'UT-S01-03'];
const RECORDER = `const fs = require('fs');
const all = JSON.parse(fs.readFileSync('tools/all-ids.json', 'utf8'));
const raw = process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
const ids = raw ? JSON.parse(raw) : all;
fs.appendFileSync('rec-calls.jsonl', JSON.stringify({
  has_scope: Object.prototype.hasOwnProperty.call(process.env, 'OPENLOGOS_VERIFY_SLICE_SCOPE'),
  scope: process.env.OPENLOGOS_VERIFY_SLICE_SCOPE ?? null,
  eligible: ids,
}) + '\\n');
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', ids.map(id => JSON.stringify({ id, status: 'pass' })).join('\\n') + '\\n');
`;

interface Call { has_scope: boolean; scope: string | null; eligible: string[] }

/** 夹具 SV + 记录型运行器（沙箱关闭，预跑命令在项目根执行）。 */
function fx(options: FixtureOptions & { scope?: 'owned' | 'baseline' | 'auto' } = {}): ScopeFixture {
  const { fixture, cleanup } = createScopeFixture({
    ...options,
    verify: { ...(options.verify ?? {}), ...(options.scope && options.scope !== 'auto' ? { slice_scope: options.scope } : {}) },
  });
  cleanups.push(cleanup);
  mkdirSync(join(fixture.root, 'tools'), { recursive: true });
  writeFileSync(join(fixture.root, 'tools', 'rec.cjs'), RECORDER);
  const all = [...BASELINE, ...CHANGED, ...(options.team ? ['UT-S60-01'] : [])].sort();
  writeFileSync(join(fixture.root, 'tools', 'all-ids.json'), JSON.stringify(all));
  setVerifyConfig(fixture.root, { pre_run_command: 'node tools/rec.cjs', sandbox_mode: 'off' });
  return fixture;
}

function calls(f: ScopeFixture): Call[] {
  const path = join(f.root, 'rec-calls.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
}

/** 真实 CLI，可显式指定子进程环境（用于预置父进程同名变量）。 */
function cliVerify(f: ScopeFixture, env: Record<string, string | undefined> = {}) {
  const merged: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', ...env };
  if (!('OPENLOGOS_VERIFY_SLICE_SCOPE' in env)) delete merged.OPENLOGOS_VERIFY_SLICE_SCOPE;
  delete merged.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), 'verify', '--format', 'json'], {
    cwd: f.root, encoding: 'utf8', env: merged as NodeJS.ProcessEnv, timeout: 120_000,
  });
  const line = (r.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? '';
  let data: any = null;
  try { data = JSON.parse(line).data; } catch { /* 错误路径 */ }
  return { status: r.status, data };
}

function cliJson(f: ScopeFixture, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args, '--format', 'json'],
    { cwd: f.root, encoding: 'utf8' });
  return { status: r.status, json: JSON.parse((r.stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? 'null') };
}

function report(f: ScopeFixture, name = 'acceptance-report.md'): string {
  return readFileSync(join(f.root, 'logos', 'resources', 'verify', name), 'utf8');
}

function toFinal(f: ScopeFixture): void {
  passCurrentSlice(f);
  passCurrentSlice(f);
  checkCodeTasks(f, 2);
}

describe('S13 verify 向 runner 与验收报告暴露验收范围', () => {
  it('UT-S13-135: checkpoint 注入 OPENLOGOS_VERIFY_SLICE_SCOPE，final 不注入且不泄漏父进程同名变量', () => {
    const owned = fx({ scope: 'owned' });
    plan(owned);
    expect(cliVerify(owned).data.gate.result).toBe('PASS');
    expect(calls(owned).at(-1)).toEqual({ has_scope: true, scope: 'owned', eligible: ['UT-S90-01', 'UT-S90-02'] });

    const legacy = fx({ scope: 'baseline' });
    plan(legacy);
    const raw = readManifest(legacy) as unknown as Record<string, unknown>;
    delete raw.verify_scope;
    writeManifestRaw(legacy, raw);
    expect(cliVerify(legacy).data.gate.result).toBe('PASS');
    expect(calls(legacy).at(-1)).toMatchObject({ has_scope: true, scope: 'baseline' });

    const final = fx({ scope: 'owned' });
    plan(final);
    toFinal(final);
    const run = cliVerify(final, { OPENLOGOS_VERIFY_SLICE_SCOPE: 'owned' });
    expect(run.data.verify_mode).toBe('final');
    expect(run.data.gate.result).toBe('PASS');
    expect(calls(final).at(-1)).toMatchObject({ has_scope: false, scope: null });
    expect(calls(final).at(-1)!.eligible).toHaveLength(BASELINE.length + CHANGED.length);

    // 进程内调用同样不泄漏，且调用结束后恢复父进程原值
    const inProc = fx({ scope: 'owned' });
    plan(inProc);
    toFinal(inProc);
    process.env.OPENLOGOS_VERIFY_SLICE_SCOPE = 'owned';
    try {
      runVerifyJson(inProc.root);
      expect(calls(inProc).at(-1)).toMatchObject({ has_scope: false });
      expect(process.env.OPENLOGOS_VERIFY_SLICE_SCOPE).toBe('owned');
    } finally {
      delete process.env.OPENLOGOS_VERIFY_SLICE_SCOPE;
    }
  });

  it('UT-S13-137: owned 范围的 checkpoint 不写、不改模块验收报告；baseline 与 final 照旧写', () => {
    const OLD = '# 旧的 team 模块验收报告\n';
    const teamReport = (f: ScopeFixture) => join(f.root, 'logos', 'resources', 'verify', 'team-acceptance-report.md');
    const seed = (f: ScopeFixture) => { writeFileSync(teamReport(f), OLD); return fileState(teamReport(f)); };

    // ① owned checkpoint：字节与 mtime 不变，不新建任何模块报告，共用报告照常写
    const owned = fx({ scope: 'owned', team: true });
    plan(owned);
    const before = seed(owned);
    const r1 = runVerifyJson(owned.root);
    expect(r1.data.verify_mode).toBe('slice-checkpoint');
    expect(fileState(teamReport(owned))).toEqual(before);
    expect(existsSync(join(owned.root, 'logos', 'resources', 'verify', 'core-acceptance-report.md'))).toBe(false);
    expect(report(owned)).toContain('# Acceptance Report');

    // ② baseline checkpoint：照旧重写
    const baseline = fx({ scope: 'baseline', team: true });
    plan(baseline);
    seed(baseline);
    expect(runVerifyJson(baseline.root).data.verify_mode).toBe('slice-checkpoint');
    expect(readFileSync(teamReport(baseline), 'utf8')).not.toBe(OLD);

    // ③ owned 下的 final：照旧重写
    const final = fx({ scope: 'owned', team: true });
    plan(final);
    toFinal(final);
    seed(final);
    expect(runVerifyJson(final.root).data.verify_mode).toBe('final');
    expect(readFileSync(teamReport(final), 'utf8')).not.toBe(OLD);
  });

  it('UT-S13-138: 共用验收报告标明验收范围', () => {
    const owned = fx({ scope: 'owned' });
    plan(owned);
    expect(runVerifyJson(owned.root).data.gate.result).toBe('PASS');
    const ownedReport = report(owned);
    expect(ownedReport).toContain('- 验收范围 / Verify scope: `owned`');
    expect(ownedReport).toContain('基线回归由 final 承担');
    expect(ownedReport).toContain('- Final: false');            // 仍标注为切片检查点、非最终验收

    const legacy = fx({ scope: 'baseline' });
    plan(legacy);
    const raw = readManifest(legacy) as unknown as Record<string, unknown>;
    delete raw.verify_scope;
    writeManifestRaw(legacy, raw);
    expect(runVerifyJson(legacy.root).data.gate.result).toBe('PASS');
    const legacyReport = report(legacy);
    expect(legacyReport).toContain('- 验收范围 / Verify scope: `baseline`');
    expect(legacyReport).not.toContain('基线回归由 final 承担');
    expect(legacyReport).toContain('- Final: false');
  });
});

describe('S13 verify 暴露验收范围 — 端到端（真实 CLI）', () => {
  it('ST-S13-35: owned 范围从首片到 final 的端到端', () => {
    const f = fx({ scope: 'auto', verify: { slice_scope_threshold: 3 } });
    // ① 规划冻结 owned
    const planned = cliJson(f, 'slice', 'plan', '--file', writeSlicesFile(f));
    expect(planned.json.data).toMatchObject({ verify_scope: 'owned', verify_scope_source: 'decided' });
    // ② status 带出范围
    expect(cliJson(f, 'status').json.data.modules[0].slice_verification_state.verify_scope).toBe('owned');
    // ③ 切片一 checkpoint：运行器只收到 2 个 ID
    expect(cliVerify(f).data.gate.result).toBe('PASS');
    expect(calls(f).at(-1)).toEqual({ has_scope: true, scope: 'owned', eligible: ['UT-S90-01', 'UT-S90-02'] });
    // ④ 勾选切片一后切片二 checkpoint：只收到 3 个 UT-S90-*
    checkCodeTasks(f, 1);
    expect(cliVerify(f).data.gate.result).toBe('PASS');
    expect(calls(f).at(-1)).toEqual({ has_scope: true, scope: 'owned', eligible: CHANGED });
    // ⑤ 勾选切片二后 final：收到全部 7 个 ID，未收到范围变量，写 VERIFY_PASS
    checkCodeTasks(f, 1);
    const final = cliVerify(f);
    expect(final.data.verify_mode).toBe('final');
    expect(final.data.gate.result).toBe('PASS');
    expect(calls(f).at(-1)).toEqual({ has_scope: false, scope: null, eligible: [...BASELINE, ...CHANGED].sort() });
    expect(existsSync(join(f.dir, 'VERIFY_PASS'))).toBe(true);
  });

  it('ST-S13-36: 未达阈值时 baseline 零回归', () => {
    const f = fx({ scope: 'auto' });                            // 缺省阈值 1000
    expect(cliJson(f, 'slice', 'plan', '--file', writeSlicesFile(f)).json.data.verify_scope).toBe('baseline');
    const first = cliVerify(f);
    expect(first.data.gate.result).toBe('PASS');
    expect(first.data.eligible_test_ids).toEqual([...BASELINE, 'UT-S90-01', 'UT-S90-02'].sort());
    expect(calls(f).at(-1)).toEqual({
      has_scope: true, scope: 'baseline', eligible: [...BASELINE, 'UT-S90-01', 'UT-S90-02'].sort(),
    });
    checkCodeTasks(f, 1);
    const second = cliVerify(f);
    expect(second.data.gate.result).toBe('PASS');
    expect(calls(f).at(-1)).toEqual({ has_scope: true, scope: 'baseline', eligible: [...BASELINE, ...CHANGED].sort() });
    const ledger = readFileSync(f.ledgerPath, 'utf8').trim().split('\n');
    expect(ledger).toHaveLength(2);
    checkCodeTasks(f, 1);
    const final = cliVerify(f);
    expect(final.data.verify_mode).toBe('final');
    expect(final.data.gate.result).toBe('PASS');
    expect(calls(f).at(-1)).toMatchObject({ has_scope: false });
    expect(existsSync(join(f.dir, 'VERIFY_PASS'))).toBe(true);
  });
});
