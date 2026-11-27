/**
 * verify-flaky-rerun 切片 2：两阶段命令、模块命令组与切片 checkpoint 下的复跑。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 失败用例复跑与偶发判定测试」严格对齐：
 * UT-S13-202、UT-S13-203、UT-S13-204、UT-S13-214。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 记录型 runner tools/rr-runner.mjs <label> [结果路径]：
 * - 每次被执行时在项目外调用记录（RR_LOG）追加一行：label、该 label 的第几次调用、收到的 ELIGIBLE / RERUN /
 *   OPENLOGOS_VERIFY_MODULES / OPENLOGOS_VERIFY_SLICE_SCOPE、工作目录；
 * - 启动时清空结果路径，按剧本 tools/rr-script.json 中该 label 的 cases 决定第 n 次调用写 pass / fail 或不写（none）；
 * - 收到 OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS 时只写集合内用例；有 fail 时以非零状态退出。
 * 「第几次调用」只以调用记录按 label 计数，不依赖时间或随机；断言调用次数与收到的变量一律读调用记录。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject } from './helpers.js';
// @ts-expect-error 夹具为 ESM .mjs，无类型声明
import { addProposal, createScopeProject, git, put } from './golden/s13-module-scope-fixture.mjs';
import { createScopeFixture, plan, setVerifyConfig, SLUG } from './slice-scope-fixture.js';

vi.setConfig({ testTimeout: 120_000 });

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const RESULTS = 'logos/resources/verify/test-results.jsonl';

const RUNNER = `import fs from 'node:fs';
import path from 'node:path';
const label = process.argv[2] || 'project';
const out = process.argv[3] || 'logos/resources/verify/test-results.jsonl';
const script = JSON.parse(fs.readFileSync('tools/rr-script.json', 'utf8'));
const log = process.env.RR_LOG;
const prior = log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const n = prior.filter(e => e.label === label).length + 1;
if (log) fs.appendFileSync(log, JSON.stringify({
  label, call: n,
  eligible: process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS ?? null,
  rerun: process.env.OPENLOGOS_VERIFY_RERUN ?? null,
  modules: process.env.OPENLOGOS_VERIFY_MODULES ?? null,
  sliceScope: process.env.OPENLOGOS_VERIFY_SLICE_SCOPE ?? null,
  cwd: process.cwd(),
}) + '\\n');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '');
let eligible = null;
if (process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS) {
  try { const v = JSON.parse(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS); if (Array.isArray(v)) eligible = new Set(v); } catch {}
}
const spec = script[label] ?? {};
const cases = spec.cases ?? {};
const pick = plan => Array.isArray(plan) ? plan[Math.min(n, plan.length) - 1] : plan;
const lines = [];
let anyFail = false;
// rows：第 n 次调用原样写出的记录（按给定顺序，可省略 timestamp）
for (const row of ((spec.rows ?? {})[String(n)] ?? [])) {
  if (eligible && !eligible.has(row.id)) continue;
  if (row.status === 'fail') anyFail = true;
  lines.push(JSON.stringify({ scenario: 'RR', label, call: n, ...row }));
}
for (const [id, plan] of Object.entries(cases)) {
  if (eligible && !eligible.has(id)) continue;
  let status = pick(plan);
  // ifabsent:<file>：工作目录中不存在该文件时 pass，否则 fail（探测命令可见的输入）
  if (typeof status === 'string' && status.startsWith('ifabsent:')) status = fs.existsSync(status.slice('ifabsent:'.length)) ? 'fail' : 'pass';
  if (!status || status === 'none') continue;
  const rec = { id, status, scenario: 'RR', label, call: n, timestamp: new Date().toISOString() };
  if (status === 'fail') { rec.error = 'RR ' + label + ' ' + id + ' failed on call ' + n; anyFail = true; }
  lines.push(JSON.stringify(rec));
}
fs.writeFileSync(out, lines.length ? lines.join('\\n') + '\\n' : '');
// touch：在工作目录留下一个未声明为缓存的状态文件
if (spec.touch) fs.writeFileSync(spec.touch, 'state from ' + label);
process.exit(anyFail ? 1 : 0);
`;

type Plan = string | string[];
type Script = Record<string, { cases?: Record<string, Plan>; rows?: Record<string, Array<Record<string, unknown>>>; touch?: string }>;
interface Call { label: string; call: number; eligible: string | null; rerun: string | null; modules: string | null; sliceScope: string | null; cwd: string }

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tmpRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return realpathSync(root);
}

function installRunner(root: string, script: Script): void {
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(join(root, 'tools', 'rr-runner.mjs'), RUNNER);
  writeFileSync(join(root, 'tools', 'rr-script.json'), JSON.stringify(script));
}

function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' };
  for (const k of Object.keys(env)) {
    if (k.startsWith('OPENLOGOS_VERIFY_') || k.startsWith('OPENLOGOS_TEST_') || k.startsWith('RR_')) delete env[k];
  }
  return { ...env, ...extra } as NodeJS.ProcessEnv;
}

function runVerify(root: string, log: string, args: string[] = []) {
  const r = spawnSync(process.execPath, [CLI, 'verify', '--format', 'json', ...args], {
    cwd: root, encoding: 'utf8', env: cleanEnv({ RR_LOG: log }), timeout: 120_000,
  });
  const line = (r.stdout ?? '').split('\n').reverse().find(l => l.trim().startsWith('{'));
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', data: line ? JSON.parse(line).data : null };
}

function readCalls(log: string): Call[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function newLog(): string {
  return join(tmpRoot(), 'calls.jsonl');
}

/** 夹具 RR-two：单模块 core，UT-S01-01～03；regression / incremental 两段。 */
function rrTwo(script: Script, verify: Record<string, unknown>): string {
  const root = tmpRoot();
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    ['project:', '  name: rr', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', ''].join('\n'));
  mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
  writeFileSync(join(root, 'logos/resources/test/core-S01-test-cases.md'),
    ['| ID | 描述 |', '|---|---|', ...['UT-S01-01', 'UT-S01-02', 'UT-S01-03'].map(id => `| ${id} | ${id} fixture |`)].join('\n') + '\n');
  installRunner(root, script);
  const cfgPath = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { result_path: RESULTS, sandbox_mode: 'off', ...verify };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return root;
}

const ledger = (root: string, rel = RESULTS) => readFileSync(join(root, rel), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

describe('S13 失败用例复跑——多来源（verify-flaky-rerun 切片 2）', () => {
  it('UT-S13-202: 两阶段命令按阶段复跑', () => {
    const root = rrTwo({
      regression: { cases: { 'UT-S01-01': 'pass', 'UT-S01-02': 'pass' } },
      incremental: { cases: { 'UT-S01-03': ['fail', 'pass'] } },
    }, {
      regression_command: 'node tools/rr-runner.mjs regression logos/resources/verify/regression.jsonl',
      incremental_command: 'node tools/rr-runner.mjs incremental logos/resources/verify/incremental.jsonl',
      regression_result_path: 'logos/resources/verify/regression.jsonl',
      incremental_result_path: 'logos/resources/verify/incremental.jsonl',
    });
    const log = newLog();
    const r = runVerify(root, log);
    const calls = readCalls(log);
    expect(calls.filter(c => c.label === 'regression')).toHaveLength(1);
    const inc = calls.filter(c => c.label === 'incremental');
    expect(inc).toHaveLength(2);
    expect(inc[1]).toMatchObject({ eligible: '["UT-S01-03"]', rerun: '1' });
    expect(r.data.rerun.commands).toHaveLength(1);
    expect(r.data.rerun.commands[0]).toMatchObject({ stage: 'incremental', modules: null, ids: ['UT-S01-03'], status_after: 'pass' });
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-03']);
    expect(r.data.gate).toEqual({ result: 'PASS', reason: null });
    // regression 阶段的用例结果不变（仍为首跑记录）
    const byId = Object.fromEntries(ledger(root).map(row => [row.id, row]));
    expect(byId['UT-S01-01']).toMatchObject({ label: 'regression', call: 1, status: 'pass' });
    expect(byId['UT-S01-02']).toMatchObject({ label: 'regression', call: 1, status: 'pass' });
    expect(byId['UT-S01-03']).toMatchObject({ label: 'incremental', call: 2, status: 'pass' });

    // 持久沙箱下：首跑两段与复跑都在同一副本内执行，后续段不因复跑占用而退回一次性副本
    const sandboxRoot = tmpRoot();
    const boxed = rrTwo({
      regression: { cases: { 'UT-S01-01': 'pass', 'UT-S01-02': 'pass' } },
      incremental: { cases: { 'UT-S01-03': ['fail', 'pass'] } },
    }, {
      regression_command: 'node tools/rr-runner.mjs regression',
      incremental_command: 'node tools/rr-runner.mjs incremental',
      sandbox_mode: 'always', sandbox_root: sandboxRoot, sandbox_deny_workspace_write: false,
    });
    const boxedLog = newLog();
    const rb = runVerify(boxed, boxedLog);
    const boxedCalls = readCalls(boxedLog);
    expect(boxedCalls.map(c => c.label)).toEqual(['regression', 'incremental', 'incremental']);
    expect(new Set(boxedCalls.map(c => c.cwd)).size).toBe(1);
    expect(boxedCalls[0].cwd).not.toBe(boxed);
    expect((rb.data.sandbox.infos ?? []).some((line: string) => line.includes('busy-fallback'))).toBe(false);
    expect(rb.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-03']);
    expect(rb.data.gate.result).toBe('PASS');

    // code-r1 F4：只切换复跑开关，两阶段首跑看到的输入相同——regression 在副本里留下未声明为缓存的状态文件，
    // incremental 只有在看不到它时才通过；后续阶段在持有的副本内照常镜像同步，状态文件被清理
    const stateRun = (enabled: boolean) => {
      const sb = tmpRoot();
      const root = rrTwo({
        regression: { cases: { 'UT-S01-01': 'pass', 'UT-S01-02': 'pass' }, touch: 'rr-stage-state.tmp' },
        incremental: { cases: { 'UT-S01-03': 'ifabsent:rr-stage-state.tmp' } },
      }, {
        regression_command: 'node tools/rr-runner.mjs regression',
        incremental_command: 'node tools/rr-runner.mjs incremental',
        sandbox_mode: 'always', sandbox_root: sb, sandbox_deny_workspace_write: false,
        rerun_failed: { enabled },
      });
      const lg = newLog();
      const out = runVerify(root, lg);
      return { out, calls: readCalls(lg) };
    };
    const on = stateRun(true);
    const off = stateRun(false);
    expect(off.out.data.gate, JSON.stringify(off.out.data.failed_cases)).toEqual({ result: 'PASS', reason: null });
    expect(on.out.data.gate, JSON.stringify(on.out.data.failed_cases)).toEqual(off.out.data.gate);
    expect(on.out.data.summary).toEqual(off.out.data.summary);
    expect(on.calls.map(c => c.label)).toEqual(['regression', 'incremental']);
    expect(off.calls.map(c => c.label)).toEqual(['regression', 'incremental']);
  });

  it('UT-S13-214: 同一 ID 跨阶段时只在生效来源复跑一次', () => {
    const twoShared = (incremental: Plan) => rrTwo({
      regression: { cases: { 'UT-S01-01': 'pass', 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' } },
      incremental: { cases: { 'UT-S01-01': incremental } },
    }, {
      regression_command: 'node tools/rr-runner.mjs regression',
      incremental_command: 'node tools/rr-runner.mjs incremental',
    });
    // ① incremental 复跑写 pass：只在 incremental 复跑一次，记为偶发
    const root = twoShared(['fail', 'pass']);
    const log = newLog();
    const r = runVerify(root, log);
    const calls = readCalls(log);
    expect(calls.filter(c => c.label === 'regression')).toHaveLength(1);
    const inc = calls.filter(c => c.label === 'incremental');
    expect(inc).toHaveLength(2);
    expect(inc[1].eligible).toBe('["UT-S01-01"]');
    expect(r.data.rerun.commands).toHaveLength(1);
    expect(r.data.rerun.commands[0]).toMatchObject({ stage: 'incremental', ids: ['UT-S01-01'] });
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.gate.result).toBe('PASS');

    // ② incremental 复跑不写该用例：regression 不被再执行，其首跑 pass 不能把它转成偶发
    const root2 = twoShared(['fail', 'none']);
    const log2 = newLog();
    const r2 = runVerify(root2, log2);
    const calls2 = readCalls(log2);
    expect(calls2.filter(c => c.label === 'regression')).toHaveLength(1);
    expect(calls2.filter(c => c.label === 'incremental')).toHaveLength(2);
    expect(r2.data.flaky_cases).toBeUndefined();
    expect(r2.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r2.data.failed_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);

    // ③ code-r1 F5：regression 写一条无 timestamp 的 pass；incremental 依次写较晚的 pass、较早的 fail。
    // 全局去重因有缺失 timestamp 退回行序、选中 incremental 的 fail；单看 incremental 会选较晚的 pass——来源必须取全局胜出记录的
    const root3 = rrTwo({
      regression: { rows: { 1: [{ id: 'UT-S01-01', status: 'pass' }, { id: 'UT-S01-02', status: 'pass' }, { id: 'UT-S01-03', status: 'pass' }] } },
      incremental: { rows: {
        1: [
          { id: 'UT-S01-01', status: 'pass', timestamp: '2026-11-27T10:00:00Z' },
          { id: 'UT-S01-01', status: 'fail', error: 'early fail', timestamp: '2026-11-27T09:00:00Z' },
        ],
        2: [{ id: 'UT-S01-01', status: 'pass', timestamp: '2026-11-27T11:00:00Z' }],
      } },
    }, {
      regression_command: 'node tools/rr-runner.mjs regression',
      incremental_command: 'node tools/rr-runner.mjs incremental',
    });
    const log3 = newLog();
    const r3 = runVerify(root3, log3);
    const calls3 = readCalls(log3);
    expect(r3.data.rerun.requested_ids).toEqual(['UT-S01-01']);
    expect(calls3.filter(c => c.label === 'regression')).toHaveLength(1);
    const inc3 = calls3.filter(c => c.label === 'incremental');
    expect(inc3).toHaveLength(2);
    expect(inc3[1].eligible).toBe('["UT-S01-01"]');
    expect(r3.data.rerun.commands).toEqual([expect.objectContaining({ stage: 'incremental', ids: ['UT-S01-01'] })]);
    expect(r3.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
  });

  it('UT-S13-203: 模块范围下只复跑相关命令组', () => {
    const root: string = createScopeProject({
      modules: [{ id: 'core', paths: ['src/**'] }, { id: 'backend', paths: ['backend/**'] }],
      tests: { 'core-S01-test-cases.md': ['UT-S01-01', 'UT-S01-02'], 'backend-S02-test-cases.md': ['UT-S02-01', 'UT-S02-02'] },
    });
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    installRunner(root, {
      core: { cases: { 'UT-S01-01': 'pass', 'UT-S01-02': 'pass' } },
      backend: { cases: { 'UT-S02-01': ['fail', 'pass'], 'UT-S02-02': 'pass' } },
    });
    const cfgPath = join(root, 'logos', 'logos.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.verify.pre_run_command = 'node tools/rr-runner.mjs project';
    cfg.verify.modules = {
      core: { pre_run_command: 'node tools/rr-runner.mjs core' },
      backend: { pre_run_command: 'node tools/rr-runner.mjs backend' },
    };
    delete cfg.verify.rerun_failed;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    // 夹具配置与 runner 先提交，提案起点之后只有两个模块的代码改动（共享配置改动会让范围回落全量）
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'rr runner']);
    addProposal(root, { module: 'backend' });
    // 两个模块都有改动 → 范围 M = {backend, core}，两个命令组首跑都执行
    put(root, 'src/protocol.ts', 'export const v = 2;\n');
    put(root, 'backend/app.ts', 'export const b = 1;\n');
    const log = newLog();
    const r = runVerify(root, log);
    expect(r.data?.scope?.mode, r.stdout + r.stderr).toBe('module');
    const calls = readCalls(log);
    expect(calls.filter(c => c.label === 'core')).toHaveLength(1);
    const backend = calls.filter(c => c.label === 'backend');
    expect(backend).toHaveLength(2);
    expect(backend[1]).toMatchObject({ eligible: '["UT-S02-01"]', rerun: '1' });
    expect(backend[1].modules).toBe(backend[0].modules);
    expect(backend[0].modules).toBe('backend');
    expect(r.data.rerun.commands).toHaveLength(1);
    expect(r.data.rerun.commands[0]).toMatchObject({ stage: 'pre_run', modules: ['backend'], ids: ['UT-S02-01'], status_after: 'pass' });
    expect(r.data.flaky_cases).toEqual([{ id: 'UT-S02-01', module: 'backend', first_error: 'RR backend UT-S02-01 failed on call 1' }]);
    expect(r.data.gate.result).toBe('PASS');
  });

  it('UT-S13-204: 切片 checkpoint 下与 eligible 求交', () => {
    const { fixture: f, cleanup } = createScopeFixture();
    cleanups.push(cleanup);
    plan(f);
    installRunner(f.root, {
      project: { cases: {
        'ST-S01-01': 'pass', 'UT-S01-01': 'pass', 'UT-S01-02': 'pass', 'UT-S01-03': 'pass',
        'UT-S90-01': ['fail', 'pass'], 'UT-S90-02': 'pass', 'UT-S90-03': 'fail',
      } },
    });
    setVerifyConfig(f.root, { pre_run_command: 'node tools/rr-runner.mjs project', sandbox_mode: 'off' });
    const log = newLog();
    const r = runVerify(f.root, log);
    expect(r.data?.verify_mode, r.stdout + r.stderr).toBe('slice-checkpoint');
    const eligible: string[] = r.data.eligible_test_ids;
    expect(eligible).toContain('UT-S90-01');
    expect(eligible).not.toContain('UT-S90-03');
    const calls = readCalls(log);
    expect(calls).toHaveLength(2);
    expect(r.data.rerun.requested_ids).toEqual(['UT-S90-01']);
    expect(r.data.rerun.requested_ids.every((id: string) => eligible.includes(id))).toBe(true);
    expect(calls[1]).toMatchObject({ eligible: '["UT-S90-01"]', rerun: '1' });
    expect(calls[1].sliceScope).toBe(calls[0].sliceScope);
    expect(calls[0].sliceScope).toBeTruthy();
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S90-01']);
    expect(r.data.gate.result).toBe('PASS');
    expect(r.data.checkpoint).toMatchObject({ result: 'PASS' });
    expect(r.data.checkpoint.confirmed_slice_ids).toContain(r.data.attempted_slice_id);
    const ledgerRows = readFileSync(join(f.dir, 'SLICE_CHECKPOINTS.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(ledgerRows.at(-1)).toMatchObject({ result: 'PASS' });
    void SLUG;
  });
});
