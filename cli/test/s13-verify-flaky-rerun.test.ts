/**
 * verify-flaky-rerun 切片 1：单命令组下的失败用例复跑与偶发判定。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 失败用例复跑与偶发判定测试」严格对齐：
 * UT-S13-180～201、UT-S13-210～213、UT-S13-215、UT-S13-216、ST-S13-46、ST-S13-47。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 夹具 RR：一次性项目，单模块 core（launched），已合并测试规格定义 UT-S01-01～03；verify.pre_run_command 指向记录型 runner
 * tools/rr-runner.mjs——每次被执行时在项目外临时目录追加一行调用记录（第几次调用、收到的 ELIGIBLE / RERUN、工作目录），
 * 启动时清空结果文件，按剧本 tools/rr-script.json 决定每条用例在第 n 次调用时写 pass / fail / skip 或不写；
 * 「第几次调用」只以调用记录计数，不依赖时间或随机。断言「runner 被调用几次」「复跑收到的变量」一律读调用记录。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerSchema, validate } from '@hyperjump/json-schema/draft-2020-12';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, withCompleteClarification } from './helpers.js';
import { verify as runVerifyInProcess } from '../src/commands/verify.js';

vi.setConfig({ testTimeout: 120_000 });

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const RESULTS = 'logos/resources/verify/test-results.jsonl';
const REPO = resolve(CLI_ROOT, '..');
let schemaId = '';
beforeAll(() => {
  const schema = JSON.parse(readFileSync(join(REPO, 'spec/schema/verify.schema.json'), 'utf8'));
  expect(schema.properties.rerun).toBeDefined();
  expect(schema.properties.flaky_cases).toBeDefined();
  schemaId = schema.$id;
  try { registerSchema(schema); } catch { /* 同一 worker 内已注册 */ }
});

/** verify JSON 的 data 符合 spec/schema/verify.schema.json（含 rerun / flaky_cases）。 */
async function expectSchemaValid(data: unknown): Promise<void> {
  const output = await validate(schemaId, data as any);
  expect(output.valid, JSON.stringify(output).slice(0, 400)).toBe(true);
}

const RUNNER = `import fs from 'node:fs';
const script = JSON.parse(fs.readFileSync('tools/rr-script.json', 'utf8'));
const log = process.env.RR_LOG;
let n = 1;
if (log) {
  n = (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0) + 1;
  fs.appendFileSync(log, JSON.stringify({
    call: n,
    eligible: process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS ?? null,
    rerun: process.env.OPENLOGOS_VERIFY_RERUN ?? null,
    cwd: process.cwd(),
  }) + '\\n');
}
const out = 'logos/resources/verify/test-results.jsonl';
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync(out, '');
let eligible = null;
if (!script.wide && process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS) {
  try { const v = JSON.parse(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS); if (Array.isArray(v)) eligible = new Set(v); } catch {}
}
const pick = plan => Array.isArray(plan) ? plan[Math.min(n, plan.length) - 1] : plan;
const ts = (script.timestamps ?? {})[String(n)];
const lines = [];
let anyFail = false;
for (const [id, plan] of Object.entries(script.cases)) {
  if (eligible && !eligible.has(id)) continue;
  const status = pick(plan);
  if (!status || status === 'none') continue;
  const rec = { id, status, scenario: 'S01', call: n };
  if (ts !== 'none') rec.timestamp = ts ?? new Date().toISOString();
  if (status === 'fail') { rec.error = 'RR ' + id + ' failed on call ' + n; anyFail = true; }
  if (status === 'skip') { rec.reason_code = 'platform-unavailable'; rec.detail = 'RR platform skip'; }
  lines.push(JSON.stringify(rec));
}
if (script.rollback && anyFail) {
  fs.writeFileSync(out, Object.keys(script.cases).map(id => JSON.stringify({ id, status: 'pass', scenario: 'S01' })).join('\\n') + '\\n');
  process.exit(1);
}
if ((script.invalidLine ?? []).includes(n)) lines.push('{not json');
fs.writeFileSync(out, lines.length ? lines.join('\\n') + '\\n' : '');
const override = (script.exit ?? {})[String(n)];
process.exit(override !== undefined ? override : (anyFail ? 1 : 0));
`;

type Plan = string | string[];
interface Script {
  cases: Record<string, Plan>;
  wide?: boolean;
  rollback?: boolean;
  exit?: Record<string, number>;
  timestamps?: Record<string, string>;
  invalidLine?: number[];
}

interface RrOptions {
  script: Script;
  verify?: Record<string, unknown>;
  preRun?: boolean;
  /** 建活跃提案（无切片清单）。 */
  proposal?: boolean;
  ids?: string[];
}

interface Rr { root: string; log: string; proposalDir: string | null }

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tmpRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return realpathSync(root);
}

const testTable = (ids: string[]) => ['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} fixture |`)].join('\n') + '\n';

function rr(opts: RrOptions): Rr {
  const root = tmpRoot();
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    ['project:', '  name: rr', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', ''].join('\n'));
  const ids = opts.ids ?? ['UT-S01-01', 'UT-S01-02', 'UT-S01-03'];
  mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
  writeFileSync(join(root, 'logos/resources/test/core-S01-test-cases.md'), testTable(ids));
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(join(root, 'tools', 'rr-runner.mjs'), RUNNER);
  writeFileSync(join(root, 'tools', 'rr-script.json'), JSON.stringify(opts.script));
  const cfgPath = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = {
    result_path: RESULTS,
    sandbox_mode: 'off',
    ...(opts.preRun === false ? {} : { pre_run_command: 'node tools/rr-runner.mjs' }),
    ...(opts.verify ?? {}),
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const logDir = tmpRoot();
  const proposalDir = opts.proposal ? writeProposal(root) : null;
  return { root, log: join(logDir, 'calls.jsonl'), proposalDir };
}

function writeProposal(root: string): string {
  const slug = 'rr-demo';
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
    `# 变更提案：${slug}`, '', '## 变更原因', '复跑夹具。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '夹具。',
  ].join('\n')));
  writeFileSync(join(dir, 'tasks.md'), ['# 实现任务', '', '## [code] 代码实现', '- [ ] 实现', ''].join('\n'));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  return dir;
}

function cleanEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' };
  for (const k of Object.keys(env)) {
    if (k.startsWith('OPENLOGOS_VERIFY_') || k.startsWith('OPENLOGOS_TEST_') || k.startsWith('RR_')) delete env[k];
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env as NodeJS.ProcessEnv;
}

function parseLast(text: string): any {
  const line = text.split('\n').reverse().find(l => l.trim().startsWith('{'));
  return line ? JSON.parse(line) : null;
}

function verify(f: Rr, env: Record<string, string | undefined> = {}, args: string[] = ['--format', 'json']) {
  const r = spawnSync(process.execPath, [CLI, 'verify', ...args], {
    cwd: f.root, encoding: 'utf8', env: cleanEnv({ RR_LOG: f.log, ...env }), timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', data: parseLast(r.stdout ?? '')?.data };
}

function calls(f: Rr): Array<{ call: number; eligible: string | null; rerun: string | null; cwd: string }> {
  if (!existsSync(f.log)) return [];
  return readFileSync(f.log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function resetLog(f: Rr): void { rmSync(f.log, { force: true }); }

function setScript(f: Rr, script: Script): void {
  writeFileSync(join(f.root, 'tools', 'rr-script.json'), JSON.stringify(script));
  resetLog(f);
}

function setVerify(f: Rr, patch: (v: Record<string, any>) => void): void {
  const p = join(f.root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  patch(cfg.verify);
  writeFileSync(p, JSON.stringify(cfg, null, 2));
}

function ledgerRows(f: Rr): Array<Record<string, any> | string> {
  return readFileSync(join(f.root, RESULTS), 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return l; }
  });
}

const RERUN_DIAG = /复跑|rerun/i;
const warningCodes = (data: any): string[] => (data.warnings ?? []).map((w: any) => w.code);
const FLAKY = { 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' };

/** 不复跑时与引入前一致的结构断言：除新增 rerun 外不出现任何复跑相关字段、警告与诊断。 */
function expectLegacyShape(data: any): void {
  expect(data.flaky_cases).toBeUndefined();
  expect(warningCodes(data)).not.toContain('flaky_cases_present');
  expect(warningCodes(data)).not.toContain('rerun_config_invalid');
  expect(data.pre_run.diagnostics.filter((d: string) => RERUN_DIAG.test(d))).toEqual([]);
  expect(data.rerun.commands).toEqual([]);
  expect(data.rerun.attempted).toBe(false);
}

describe('S13 失败用例复跑与偶发判定（verify-flaky-rerun 切片 1）', () => {
  it('UT-S13-180: 首跑失败、复跑通过记为偶发', () => {
    const f = rr({ script: { cases: FLAKY } });
    const r = verify(f);
    const c = calls(f);
    expect(c).toHaveLength(2);
    expect(c[0].rerun).toBeNull();
    expect(c[1].eligible).toBe('["UT-S01-01"]');
    expect(c[1].rerun).toBe('1');
    expect(r.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(r.data.flaky_cases).toEqual([{ id: 'UT-S01-01', module: 'core', first_error: 'RR UT-S01-01 failed on call 1' }]);
    expect(r.data.failed_cases).toEqual([]);
    expect(warningCodes(r.data)).toContain('flaky_cases_present');
    expect(r.data.warnings.find((w: any) => w.code === 'flaky_cases_present').ids).toEqual(['UT-S01-01']);
    expect(r.data.rerun).toMatchObject({ attempted: true, skipped_reason: null, max_cases: 10, requested_ids: ['UT-S01-01'] });
    expect(r.status).toBe(0);
  });

  it('UT-S13-181: 复跑仍失败照常 FAIL', () => {
    const f = rr({ script: { cases: { ...FLAKY, 'UT-S01-01': 'fail' } } });
    const r = verify(f);
    expect(calls(f)).toHaveLength(2);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.failed_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.failed_cases[0].error).toBe('RR UT-S01-01 failed on call 2');
    expect(r.data.flaky_cases).toBeUndefined();
    expect(warningCodes(r.data)).not.toContain('flaky_cases_present');
    expect(r.status).not.toBe(0);
  });

  it('UT-S13-182: 部分偶发、部分失败', () => {
    const f = rr({ script: { cases: { 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': 'fail', 'UT-S01-03': 'pass' } } });
    const r = verify(f);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.failed_cases.map((c: any) => c.id)).toEqual(['UT-S01-02']);
    expect(r.data.rerun.requested_ids).toEqual(['UT-S01-01', 'UT-S01-02']);
    expect(calls(f)[1].eligible).toBe('["UT-S01-01","UT-S01-02"]');
  });

  it('UT-S13-183: 复跑没有新记录时维持失败', () => {
    const f = rr({ script: { cases: { ...FLAKY, 'UT-S01-01': ['fail', 'none'] } } });
    const r = verify(f);
    expect(calls(f)).toHaveLength(2);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.failed_cases).toEqual([{ id: 'UT-S01-01', error: 'RR UT-S01-01 failed on call 1' }]);
    expect(r.data.pre_run.diagnostics.some((d: string) => d.includes('复跑未产生') && d.includes('UT-S01-01'))).toBe(true);
    expect(r.data.flaky_cases).toBeUndefined();
  });

  it('UT-S13-184: 复跑记录为 skip 时维持失败', () => {
    const f = rr({ script: { cases: { ...FLAKY, 'UT-S01-01': ['fail', 'skip'] } } });
    const r = verify(f);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.failed_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.platform_skipped_cases).toBeUndefined();
    expect(r.data.skipped_cases).toEqual([]);
    expect(r.data.flaky_cases).toBeUndefined();
  });

  it('UT-S13-185: 首跑通过的用例不因复跑丢失', () => {
    const f = rr({ script: { cases: FLAKY } });
    const r = verify(f);
    expect(r.data.gate.result).toBe('PASS');
    expect(r.data.uncovered_cases).toEqual([]);
    expect(r.data.summary).toMatchObject({ executed_count: 3, passed_count: 3, failed_count: 0, uncovered_count: 0 });
    const rows = ledgerRows(f) as Array<Record<string, any>>;
    expect(rows.map(row => row.id).sort()).toEqual(['UT-S01-01', 'UT-S01-02', 'UT-S01-03']);
    const byId = Object.fromEntries(rows.map(row => [row.id, row]));
    expect(byId['UT-S01-01']).toMatchObject({ status: 'pass', call: 2 });
    expect(byId['UT-S01-02']).toMatchObject({ status: 'pass', call: 1 });
    expect(byId['UT-S01-03']).toMatchObject({ status: 'pass', call: 1 });
  });

  it('UT-S13-186: 复跑写入集合之外的记录不采信（复跑非零退出）', () => {
    const f = rr({ script: { wide: true, cases: { 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': ['pass', 'fail'], 'UT-S01-03': 'pass' } } });
    const r = verify(f);
    expect(calls(f)).toHaveLength(2);
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.failed_cases).toEqual([]);
    expect(r.data.rerun.commands[0].rerun_exit_code).not.toBe(0);
    expect(r.data.rerun.commands[0].status_after).toBe('fail');
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'pre_run_failed' });
    expect(r.data.pre_run.diagnostics.some((d: string) => d.includes('未按') && d.includes('UT-S01-02'))).toBe(true);
  });

  it('UT-S13-187: 超过上限不复跑', () => {
    const f = rr({ script: { cases: { 'UT-S01-01': 'fail', 'UT-S01-02': 'fail', 'UT-S01-03': 'pass' } }, verify: { rerun_failed: { max_cases: 1 } } });
    const r = verify(f);
    expect(calls(f)).toHaveLength(1);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.rerun).toEqual({
      attempted: false, skipped_reason: 'too_many_failures', max_cases: 1, requested_ids: ['UT-S01-01', 'UT-S01-02'], commands: [],
    });
  });

  it('UT-S13-188: 上限边界', () => {
    const f = rr({ script: { cases: { 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': ['fail', 'pass'], 'UT-S01-03': 'pass' } }, verify: { rerun_failed: { max_cases: 2 } } });
    const r = verify(f);
    expect(calls(f)).toHaveLength(2);
    expect(r.data.rerun.attempted).toBe(true);
    expect(r.data.gate.result).toBe('PASS');
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01', 'UT-S01-02']);
  });

  it('UT-S13-189: 关闭后与引入前一致', () => {
    const f = rr({ script: { cases: FLAKY }, verify: { rerun_failed: { enabled: false } } });
    const r = verify(f);
    expect(calls(f)).toHaveLength(1);
    expect(r.data.rerun).toEqual({ attempted: false, skipped_reason: 'disabled', max_cases: 10, requested_ids: [], commands: [] });
    expectLegacyShape(r.data);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.failed_cases).toEqual([{ id: 'UT-S01-01', error: 'RR UT-S01-01 failed on call 1' }]);
    expect(r.status).toBe(1);
    // 结果账本保持首跑原样（未被合并改写）
    expect((ledgerRows(f) as Array<Record<string, any>>).every(row => row.call === 1)).toBe(true);
  });

  it('UT-S13-190: 配置缺省与非法取值', () => {
    const f = rr({ script: { cases: FLAKY } });
    const absent = verify(f);
    expect(absent.data.rerun).toMatchObject({ attempted: true, max_cases: 10 });
    expect(warningCodes(absent.data)).not.toContain('rerun_config_invalid');
    const cases: Array<[unknown, string]> = [
      [{ max_cases: 0 }, 'verify.rerun_failed.max_cases'],
      [{ enabled: 'yes' }, 'verify.rerun_failed.enabled'],
      [[], 'verify.rerun_failed'],
    ];
    for (const [value, field] of cases) {
      setScript(f, { cases: FLAKY });
      setVerify(f, v => { v.rerun_failed = value; });
      const r = verify(f);
      const w = (r.data.warnings ?? []).find((x: any) => x.code === 'rerun_config_invalid');
      expect(w, field).toBeTruthy();
      expect(w.fields, field).toEqual([field]);
      expect(r.data.rerun, field).toMatchObject({ attempted: true, max_cases: 10 });
      expect(r.data.gate, field).toEqual({ result: 'PASS', reason: null });
    }
  });

  it('UT-S13-191: 首跑无失败时不复跑', () => {
    const f = rr({ script: { cases: { 'UT-S01-01': 'pass', 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' } } });
    const r = verify(f);
    expect(calls(f)).toHaveLength(1);
    expect(r.data.rerun).toEqual({ attempted: false, skipped_reason: 'no_failed_cases', max_cases: 10, requested_ids: [], commands: [] });
    expectLegacyShape(r.data);
    expect(r.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(r.status).toBe(0);
  });

  it('UT-S13-192: 测试入口回滚账本时不复跑', () => {
    const f = rr({ script: { rollback: true, cases: { 'UT-S01-01': 'fail', 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' } } });
    const r = verify(f);
    expect(calls(f)).toHaveLength(1);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'pre_run_failed' });
    expect(r.data.rerun.skipped_reason).toBe('no_failed_cases');
  });

  it('UT-S13-193: 环境预检失败时不复跑', () => {
    const f = rr({ script: { cases: FLAKY }, verify: { requirements: { env: ['RR_TOKEN'] } } });
    const r = verify(f, { RR_TOKEN: undefined });
    expect(calls(f)).toHaveLength(0);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'verify_env_not_ready' });
    expect(r.data.rerun).toEqual({ attempted: false, skipped_reason: 'precheck_failed', max_cases: 10, requested_ids: [], commands: [] });
  });

  it('UT-S13-194: 未执行预跑命令时不复跑', () => {
    const f = rr({ script: { cases: FLAKY }, preRun: false });
    writeFileSync(join(f.root, RESULTS), [
      JSON.stringify({ id: 'UT-S01-01', status: 'fail', error: 'preset failure' }),
      JSON.stringify({ id: 'UT-S01-02', status: 'pass' }),
      JSON.stringify({ id: 'UT-S01-03', status: 'pass' }),
    ].join('\n') + '\n');
    const r = verify(f);
    expect(calls(f)).toHaveLength(0);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.rerun.skipped_reason).toBe('no_command');
  });

  it('UT-S13-195: 测试变更集无效时不复跑', () => {
    const f = rr({ script: { cases: FLAKY }, proposal: true });
    writeFileSync(join(f.proposalDir!, 'SPEC_MERGED'), JSON.stringify({ type: 'merge_complete', completed_at: new Date().toISOString() }));
    const r = verify(f);
    expect(r.data, r.stdout + r.stderr).toBeTruthy();
    expect(calls(f)).toHaveLength(1);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'test_change_set_invalid' });
    expect(r.data.rerun.skipped_reason).toBe('gate_blocked');
  });

  it('UT-S13-196: 命令组改判成立', async () => {
    const f = rr({ script: { cases: FLAKY } });
    const r = verify(f);
    await expectSchemaValid(r.data);
    expect(r.data.pre_run.commands[0].status).toBe('fail');
    expect(r.data.pre_run.commands[0].exit_code).toBe(1);
    expect(r.data.rerun.commands).toEqual([{
      stage: 'pre_run', modules: null, ids: ['UT-S01-01'], first_exit_code: 1, rerun_exit_code: 0, skipped_reason: null, status_after: 'pass',
    }]);
    expect(r.data.gate.result).toBe('PASS');
  });

  it('UT-S13-197: 复跑命令非零退出时不改判', () => {
    const f = rr({ script: { cases: FLAKY, exit: { 2: 3 } } });
    const r = verify(f);
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.rerun.commands[0]).toMatchObject({ rerun_exit_code: 3, status_after: 'fail' });
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'pre_run_failed' });
  });

  it('UT-S13-198: 改判不掩盖未覆盖', () => {
    const f = rr({ script: { cases: { 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': 'pass', 'UT-S01-03': 'none' } } });
    const r = verify(f);
    expect(r.data.rerun.commands[0].status_after).toBe('pass');
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'incomplete_coverage' });
    expect(r.data.uncovered_cases).toEqual(['UT-S01-03']);
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
  });

  it('UT-S13-199: 同一沙箱内复跑', () => {
    const sandboxRoot = tmpRoot();
    const f = rr({ script: { cases: FLAKY }, verify: { sandbox_mode: 'always', sandbox_root: sandboxRoot, sandbox_deny_workspace_write: false } });
    const r = verify(f);
    const c = calls(f);
    expect(c).toHaveLength(2);
    expect(c[0].cwd).not.toBe(f.root);
    expect(c[1].cwd).toBe(c[0].cwd);
    // 沙箱诊断只有一次副本准备（复用摘要只出现一次），复跑没有新建副本
    expect((r.data.sandbox.infos ?? []).filter((line: string) => line.startsWith('沙箱复用：'))).toHaveLength(1);
    expect(r.data.gate.result).toBe('PASS');
  });

  it('UT-S13-200: 沙箱关闭时原地复跑', () => {
    const f = rr({ script: { cases: FLAKY } });
    const r = verify(f);
    const c = calls(f);
    expect(c).toHaveLength(2);
    expect(realpathSync(c[0].cwd)).toBe(f.root);
    expect(realpathSync(c[1].cwd)).toBe(f.root);
    expect(r.data.gate.result).toBe('PASS');
  });

  it('UT-S13-201: 复跑结束后恢复环境变量', async () => {
    const f = rr({ script: { cases: FLAKY } });
    const saved = {
      cwd: process.cwd(),
      eligible: process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS,
      rerun: process.env.OPENLOGOS_VERIFY_RERUN,
      log: process.env.RR_LOG,
      exitCode: process.exitCode,
    };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS = 'x';
    delete process.env.OPENLOGOS_VERIFY_RERUN;
    process.env.RR_LOG = f.log;
    let after: { eligible?: string; rerun?: string };
    try {
      process.chdir(f.root);
      runVerifyInProcess('json');
      after = { eligible: process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS, rerun: process.env.OPENLOGOS_VERIFY_RERUN };
    } finally {
      process.chdir(saved.cwd);
      logSpy.mockRestore();
      process.exitCode = saved.exitCode;
      if (saved.eligible === undefined) delete process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS; else process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS = saved.eligible;
      if (saved.rerun === undefined) delete process.env.OPENLOGOS_VERIFY_RERUN; else process.env.OPENLOGOS_VERIFY_RERUN = saved.rerun;
      if (saved.log === undefined) delete process.env.RR_LOG; else process.env.RR_LOG = saved.log;
    }
    const c = calls(f);
    expect(c).toHaveLength(2);
    expect(c[1]).toMatchObject({ eligible: '["UT-S01-01"]', rerun: '1' });
    expect(after!.eligible).toBe('x');
    expect(after!.rerun).toBeUndefined();
  });

  it('UT-S13-210: 首跑账本的非法行不被复跑抹掉', () => {
    const f = rr({ script: { cases: FLAKY, invalidLine: [1] }, proposal: true });
    const r = verify(f);
    expect(calls(f)).toHaveLength(2);
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.failed_cases).toEqual([]);
    expect(r.data.uncovered_cases).toEqual([]);
    expect(r.data.rerun.commands[0].status_after).toBe('pass');
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'result_ledger_inconsistent' });
    expect(r.data.consistency.reasons).toContain('invalid_test_result_json');
    expect(readFileSync(join(f.root, 'logos/resources/verify/acceptance-report.md'), 'utf8')).toMatch(/FAIL/);
    expect(existsSync(join(f.proposalDir!, 'VERIFY_PASS'))).toBe(false);
    expect(ledgerRows(f)).toContain('{not json');
    expect(warningCodes(r.data)).not.toContain('flaky_cases_present');
  });

  it('UT-S13-211: 复跑记录不写 timestamp 时照常采信', () => {
    const f = rr({ script: { cases: FLAKY, timestamps: { 1: 'none', 2: 'none' } } });
    const r = verify(f);
    expect((ledgerRows(f) as Array<Record<string, any>>).every(row => row.timestamp === undefined)).toBe(true);
    expect(r.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.failed_cases).toEqual([]);
  });

  it('UT-S13-212: 复跑记录与首跑同刻时照常采信', () => {
    const same = '2026-11-27T00:00:00Z';
    const f = rr({ script: { cases: FLAKY, timestamps: { 1: same, 2: same } } });
    const r = verify(f);
    expect(r.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    // 同刻配置不变、复跑不写该用例：维持失败（AC-VERIFY-RERUN-04）
    setScript(f, { cases: { ...FLAKY, 'UT-S01-01': ['fail', 'none'] }, timestamps: { 1: same, 2: same } });
    const r2 = verify(f);
    expect(calls(f)).toHaveLength(2);
    expect(r2.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r2.data.failed_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
  });

  it('UT-S13-213: 集合外记录不采信且复跑零退出时放行', () => {
    const f = rr({ script: { wide: true, exit: { 2: 0 }, cases: { 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': ['pass', 'fail'], 'UT-S01-03': 'pass' } } });
    const r = verify(f);
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.failed_cases).toEqual([]);
    expect(r.data.rerun.commands[0]).toMatchObject({ rerun_exit_code: 0, status_after: 'pass' });
    expect(r.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(r.data.pre_run.diagnostics.some((d: string) => d.includes('未按') && d.includes('UT-S01-02'))).toBe(true);
  });

  it('UT-S13-215: 一次性沙箱副本保留到复跑结束', () => {
    const sandboxRoot = tmpRoot();
    const f = rr({ script: { cases: FLAKY }, verify: { sandbox_mode: 'always', sandbox_reuse: false, sandbox_root: sandboxRoot, sandbox_deny_workspace_write: false } });
    const r = verify(f);
    const c = calls(f);
    expect(c).toHaveLength(2);
    expect(c[1].cwd).toBe(c[0].cwd);
    expect(c[0].cwd.startsWith(realpathSync(sandboxRoot)) || c[0].cwd.startsWith(sandboxRoot)).toBe(true);
    expect(r.data.gate.result).toBe('PASS');
    expect(existsSync(c[0].cwd)).toBe(false);
  });

  it('UT-S13-216: 首跑执行环境不可用时不复跑', async () => {
    const sandboxRoot = tmpRoot();
    const sandboxCfg = { sandbox_mode: 'always', sandbox_root: sandboxRoot, sandbox_deny_workspace_write: false };
    const f = rr({ script: { cases: FLAKY }, verify: sandboxCfg });
    const r = verify(f, { OPENLOGOS_TEST_RERUN_DISCARD_SANDBOX: '1' });
    expect(calls(f)).toHaveLength(1);
    expect(r.data.flaky_cases).toBeUndefined();
    expect(r.data.rerun).toMatchObject({ attempted: false, skipped_reason: 'sandbox_unavailable', requested_ids: ['UT-S01-01'] });
    expect(r.data.rerun.commands).toHaveLength(1);
    expect(r.data.rerun.commands[0]).toMatchObject({ rerun_exit_code: null, skipped_reason: 'sandbox_unavailable', status_after: 'fail' });
    await expectSchemaValid(r.data);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.failed_cases).toEqual([{ id: 'UT-S01-01', error: 'RR UT-S01-01 failed on call 1' }]);
    // 首跑零退出 + 非法行：status_after 取首跑状态（不强制为 fail），主原因为 result_ledger_inconsistent
    setScript(f, { cases: { ...FLAKY, 'UT-S01-01': 'fail' }, exit: { 1: 0 }, invalidLine: [1] });
    const r2 = verify(f, { OPENLOGOS_TEST_RERUN_DISCARD_SANDBOX: '1' });
    expect(calls(f)).toHaveLength(1);
    expect(r2.data.rerun.commands[0]).toMatchObject({ skipped_reason: 'sandbox_unavailable', status_after: 'pass' });
    expect(r2.data.failed_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r2.data.flaky_cases).toBeUndefined();
    expect(r2.data.gate).toEqual({ result: 'FAIL', reason: 'result_ledger_inconsistent' });

    // 副本仍在但不可继续使用的三种情形（code-r1 F1～F3）：都不启动第二次 runner、不新建副本、不在源工作区执行，用例维持失败
    const unusable = (label: string, env: Record<string, string>, verifyCfg: Record<string, unknown>) => {
      const g = rr({ script: { cases: FLAKY }, verify: { ...verifyCfg, sandbox_root: tmpRoot() } });
      const rg = verify(g, env);
      const cg = calls(g);
      expect(cg, label).toHaveLength(1);
      // 一次性副本在验收结束后已删除：直接比较路径（runner 记录的是真实路径），不做 realpath
      expect(cg.every(c => c.cwd !== g.root), label).toBe(true);
      expect(rg.data.rerun, label).toMatchObject({ attempted: false, skipped_reason: 'sandbox_unavailable' });
      expect(rg.data.rerun.commands[0], label).toMatchObject({ rerun_exit_code: null, skipped_reason: 'sandbox_unavailable' });
      expect(rg.data.flaky_cases, label).toBeUndefined();
      expect(rg.data.gate, `${label} ${JSON.stringify(rg.data.gate)} ${JSON.stringify(rg.data.sandbox)}`).toEqual({ result: 'FAIL', reason: 'failed_cases' });
      return rg;
    };
    // F1：副本内的结果路径被换成指向白名单外文件的链接——拒绝清空，外部文件不被截断
    const outsideDir = tmpRoot();
    const outside = join(outsideDir, 'outside.txt');
    writeFileSync(outside, 'KEEP-OUTSIDE');
    unusable('unsafe-result-path', { OPENLOGOS_TEST_RERUN_SANDBOX_TAMPER: 'unsafe-result-path', OPENLOGOS_TEST_RERUN_TAMPER_TARGET: outside },
      { sandbox_mode: 'always', sandbox_deny_workspace_write: false });
    expect(readFileSync(outside, 'utf8')).toBe('KEEP-OUTSIDE');
    // F2：auto 模式下副本出现逃逸链接（隔离复检失败）——不降级到源工作区执行
    unusable('escape', { OPENLOGOS_TEST_RERUN_SANDBOX_TAMPER: 'escape' }, { sandbox_mode: 'auto', sandbox_deny_workspace_write: false });
    // F3：持久副本内上一轮命令的后代仍在运行——不清空、不复跑
    unusable('old-writer', { OPENLOGOS_TEST_RERUN_SANDBOX_TAMPER: 'old-writer' }, { sandbox_mode: 'always', sandbox_deny_workspace_write: false });
    // code-r2 F2：原副本仍「存在」但已被换成普通文件（无法遍历）——复检出错转为不可用，验收照常给出 FAIL 响应
    for (const reuse of [true, false]) {
      const label = `not-a-directory reuse=${reuse}`;
      const rg = unusable(label, { OPENLOGOS_TEST_RERUN_SANDBOX_TAMPER: 'not-a-directory' },
        { sandbox_mode: 'always', sandbox_reuse: reuse, sandbox_deny_workspace_write: false });
      expect(rg.status, label).toBe(1);
      expect(rg.data.failed_cases, label).toEqual([{ id: 'UT-S01-01', error: 'RR UT-S01-01 failed on call 1' }]);
    }
    // code-r2 F1：工作区一侧的结果路径被换成指向白名单外文件的链接——清空与合并写回都被拒绝，
    // 外部文件不被截断或改写，门禁以首跑快照判定（工作区执行与持久副本两种执行环境）
    for (const verifyCfg of [{ sandbox_mode: 'off' }, { sandbox_mode: 'always', sandbox_deny_workspace_write: false }]) {
      const label = `unsafe-workspace-result-path ${verifyCfg.sandbox_mode}`;
      const guarded = join(tmpRoot(), 'guarded.txt');
      writeFileSync(guarded, 'KEEP-GUARDED');
      const g = rr({ script: { cases: FLAKY }, verify: { ...verifyCfg, sandbox_root: tmpRoot() } });
      const rg = verify(g, { OPENLOGOS_TEST_RERUN_SANDBOX_TAMPER: 'unsafe-workspace-result-path', OPENLOGOS_TEST_RERUN_TAMPER_TARGET: guarded });
      expect(calls(g), label).toHaveLength(1);
      expect(readFileSync(guarded, 'utf8'), label).toBe('KEEP-GUARDED');
      expect(rg.data.rerun, label).toMatchObject({ attempted: false, skipped_reason: 'sandbox_unavailable' });
      expect(rg.data.flaky_cases, label).toBeUndefined();
      expect(rg.data.gate, label).toEqual({ result: 'FAIL', reason: 'failed_cases' });
      expect(rg.data.failed_cases, label).toEqual([{ id: 'UT-S01-01', error: 'RR UT-S01-01 failed on call 1' }]);
      expect(rg.data.pre_run.diagnostics.some((d: string) => d.includes('拒绝经') && d.includes(RESULTS)), label).toBe(true);
    }
    // code-r3 F1：工作区结果路径换成「目标不存在」的链接——不经被拒绝的路径补写空文件，也不以 NO_TEST_RESULTS 早退；
    // 首跑命令非零退出与零退出两种状态都返回正常的 FAIL 响应，保留首跑失败用例及其错误
    for (const firstExit of [undefined, 0]) {
      const label = `dangling-workspace-result-path firstExit=${firstExit ?? 'nonzero'}`;
      const dangling = join(tmpRoot(), 'missing-dir', 'never-created.jsonl');
      const script = firstExit === undefined ? { cases: FLAKY } : { cases: FLAKY, exit: { 1: firstExit } };
      const g = rr({ script });
      const rg = verify(g, { OPENLOGOS_TEST_RERUN_SANDBOX_TAMPER: 'unsafe-workspace-result-path', OPENLOGOS_TEST_RERUN_TAMPER_TARGET: dangling });
      expect(rg.data, `${label}: ${rg.stderr}`).toBeTruthy();
      expect(rg.status, label).toBe(1);
      expect(calls(g), label).toHaveLength(1);
      expect(existsSync(dangling), label).toBe(false);
      expect(existsSync(dirname(dangling)), label).toBe(false);
      expect(rg.data.rerun, label).toMatchObject({ attempted: false, skipped_reason: 'sandbox_unavailable' });
      expect(rg.data.gate, label).toEqual({ result: 'FAIL', reason: 'failed_cases' });
      expect(rg.data.failed_cases, label).toEqual([{ id: 'UT-S01-01', error: 'RR UT-S01-01 failed on call 1' }]);
      expect(rg.data.pre_run.commands[0].status, label).toBe(firstExit === undefined ? 'fail' : 'pass');
    }
  });
});

describe('S13 失败用例复跑场景测试（verify-flaky-rerun 切片 1）', () => {
  it('ST-S13-46: 关闭复跑后回到引入前行为', () => {
    const f = rr({ script: { cases: FLAKY }, verify: { rerun_failed: { enabled: false } } });
    const r1 = verify(f);
    expect(calls(f)).toHaveLength(1);
    expect(r1.status).toBe(1);
    expect(r1.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r1.data.rerun.skipped_reason).toBe('disabled');
    expectLegacyShape(r1.data);
    setScript(f, { cases: { 'UT-S01-01': 'pass', 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' } });
    const r2 = verify(f);
    expect(calls(f)).toHaveLength(1);
    expect(r2.status).toBe(0);
    expect(r2.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(r2.data.rerun.skipped_reason).toBe('disabled');
    expectLegacyShape(r2.data);
  });

  it('ST-S13-47: 大面积失败不复跑', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `UT-S01-${String(i + 1).padStart(2, '0')}`);
    const cases = Object.fromEntries(ids.map((id, i) => [id, i < 11 ? 'fail' : 'pass']));
    const f = rr({ script: { cases }, ids });
    const r = verify(f);
    expect(calls(f)).toHaveLength(1);
    expect(r.status).not.toBe(0);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.rerun).toMatchObject({ attempted: false, skipped_reason: 'too_many_failures', max_cases: 10 });
    expect(r.data.rerun.requested_ids).toHaveLength(11);
  });
});
