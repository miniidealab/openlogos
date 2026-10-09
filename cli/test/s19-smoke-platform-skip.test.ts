/**
 * S19 必要用例 skip 与平台不可执行例外（verify-smoke-guard-fixes-0-15-20，切片 slice-02-smoke-platform-skip）。
 *
 * 覆盖 UT-S19-51～UT-S19-56、ST-S19-23、ST-S19-24，对应功能规格 §2.48.5「本提案变更用例的 skip 是必要证据缺失」
 * 「平台不可执行例外」、场景 S19「smoke skip 统计口径」EX-19.7～EX-19.10、`spec/cli-json-output.md` §5.3 / §5.4。
 * 夹具：一次性 launched 项目，已合并 smoke 规格含 SMOKE-core-900（非本提案）、901 / 902（本提案新增，见 deltas）；
 * 前置标记齐备；smoke.command 指向写入指定记录的真实 runner 脚本。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, takeExitCode } from './helpers.js';
import { cli } from './frontier-fixture.js';
import { smoke } from '../src/commands/smoke.js';

const SLUG = 'smoke-platform-fixture';
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

type Rec = Record<string, unknown>;

/** 建项目；records 为 runner 写入的结果记录（可后续用 setRecords 改写）。 */
function project(records: Rec[], opts: { changed?: string[] } = {}): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  const changed = opts.changed ?? ['SMOKE-core-901', 'SMOKE-core-902'];
  mkdirSync(join(root, 'logos/resources/test/smoke'), { recursive: true });
  writeFileSync(join(root, 'logos/resources/test/smoke/core-smoke-test-cases.md'),
    ['| ID | 描述 |', '|---|---|', ...['SMOKE-core-900', ...changed].map(id => `| ${id} | 安装态 |`)].join('\n') + '\n');
  const proposalDir = join(root, 'logos/changes', SLUG);
  mkdirSync(join(proposalDir, 'deltas/test/smoke'), { recursive: true });
  writeFileSync(join(proposalDir, 'deltas/test/smoke/core-smoke-test-cases.md'),
    ['## ADDED — 夹具 smoke', '', '| ID | 描述 |', '|---|---|', ...changed.map(id => `| ${id} | 安装态 |`)].join('\n') + '\n');
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  writeFileSync(join(proposalDir, 'proposal.md'), [
    '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：本地',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
  ].join('\n'));
  writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [deploy] 发布\n- [x] 本机全局安装\n');
  writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
  writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts/smoke-fixture.mjs'), [
    "import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';",
    "import { dirname } from 'node:path';",
    "const p = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';",
    'mkdirSync(dirname(p), { recursive: true });',
    "appendFileSync(p, readFileSync('scripts/records.jsonl', 'utf8'));",
  ].join('\n'));
  setRecords(root, records);
  const configPath = join(root, 'logos/logos.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  config.smoke = { ...(config.smoke ?? {}), command: 'node scripts/smoke-fixture.mjs', sandbox_mode: 'off' };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return root;
}

function setRecords(root: string, records: Rec[]): void {
  const ts = new Date().toISOString();
  writeFileSync(join(root, 'scripts/records.jsonl'), records.map(r => JSON.stringify({ timestamp: ts, ...r })).join('\n') + (records.length ? '\n' : ''));
  const ledger = join(root, 'logos/resources/verify/smoke-results.jsonl');
  if (existsSync(ledger)) writeFileSync(ledger, '');
}

function runSmoke(root: string) {
  const restore = mockCwd(root);
  const con = captureConsole();
  const exitSpy = mockProcessExit();
  try { smoke('json'); } catch { /* process.exit 桩抛出 */ } finally { con.restore(); exitSpy.mockRestore(); restore(); }
  takeExitCode();
  return JSON.parse(con.logs[con.logs.length - 1]).data;
}

const reportOf = (root: string, data: { report_path: string }) => readFileSync(join(root, data.report_path), 'utf-8');
const PASS = (id: string): Rec => ({ id, status: 'pass' });
const PLATFORM_SKIP: Rec = { id: 'SMOKE-core-902', status: 'skip', reason_code: 'platform-unavailable', detail: 'requires win32' };

describe('S19 必要用例 skip 与平台不可执行例外 — 单元测试', () => {
  it('UT-S19-51: 平台不可执行的必要用例 skip 放行', () => {
    const root = project([PASS('SMOKE-core-900'), PASS('SMOKE-core-901'), PLATFORM_SKIP]);
    const data = runSmoke(root);
    expect(data.gate).toEqual({ result: 'PASS', reason: null });
    expect(data.platform_skipped_cases).toEqual([{ id: 'SMOKE-core-902', detail: 'requires win32' }]);
    expect('required_skipped_cases' in data).toBe(false);
    expect(data.skipped_cases).toContain('SMOKE-core-902');
  });

  it('UT-S19-52: 必要用例 skip 缺原因码判 FAIL', () => {
    const root = project([PASS('SMOKE-core-900'), PASS('SMOKE-core-901'),
      { id: 'SMOKE-core-902', status: 'skip', detail: '缺 OPENLOGOS_ROLLBACK_TGZ' }]);
    const data = runSmoke(root);
    expect(data.gate).toEqual({ result: 'FAIL', reason: 'required_cases_skipped' });
    expect(data.required_skipped_cases).toEqual([{ id: 'SMOKE-core-902', detail: '缺 OPENLOGOS_ROLLBACK_TGZ' }]);
    expect('platform_skipped_cases' in data).toBe(false);
  });

  it('UT-S19-53: 平台不可执行但 detail 为空判 FAIL', () => {
    for (const rec of [
      { id: 'SMOKE-core-902', status: 'skip', reason_code: 'platform-unavailable', detail: '' },
      { id: 'SMOKE-core-902', status: 'skip', reason_code: 'platform-unavailable' },
    ]) {
      const root = project([PASS('SMOKE-core-900'), PASS('SMOKE-core-901'), rec]);
      const data = runSmoke(root);
      expect(data.gate.reason, JSON.stringify(rec)).toBe('required_cases_skipped');
      expect(data.required_skipped_cases.map((c: { id: string }) => c.id)).toEqual(['SMOKE-core-902']);
      expect('platform_skipped_cases' in data).toBe(false);
    }
  });

  it('UT-S19-54: 其他原因码不视为平台不可执行', () => {
    const root = project([PASS('SMOKE-core-900'), PASS('SMOKE-core-901'),
      { id: 'SMOKE-core-902', status: 'skip', reason_code: 'missing-artifact', detail: '缺回滚制品' }]);
    const data = runSmoke(root);
    expect(data.gate.reason).toBe('required_cases_skipped');
    expect('platform_skipped_cases' in data).toBe(false);
  });

  it('UT-S19-55: 非本提案用例 skip 口径不变', () => {
    const root = project([{ id: 'SMOKE-core-900', status: 'skip', detail: '缺宿主客户端' }, PASS('SMOKE-core-901'), PASS('SMOKE-core-902')]);
    const data = runSmoke(root);
    expect(data.gate).toEqual({ result: 'PASS', reason: null });
    expect('required_skipped_cases' in data).toBe(false);
    expect('platform_skipped_cases' in data).toBe(false);
    expect(data.summary).toEqual({
      defined_count: 3, executed_count: 3, passed_count: 2, failed_count: 0, skipped_count: 1,
      uncovered_count: 0, coverage_pct: 100, pass_rate_pct: 100,
    });
  });

  it('UT-S19-56: 原因优先级与报告独立小节', () => {
    const missingReason: Rec = { id: 'SMOKE-core-902', status: 'skip', detail: '缺制品' };
    // ① 失败用例优先
    const r1 = project([PASS('SMOKE-core-900'), { id: 'SMOKE-core-901', status: 'fail', error: 'boom' }, missingReason]);
    const d1 = runSmoke(r1);
    expect(d1.gate.reason).toBe('failed_cases');
    expect(d1.required_skipped_cases.map((c: { id: string }) => c.id)).toEqual(['SMOKE-core-902']);
    // ② 覆盖预检诊断码优先于 required_cases_skipped
    const r2 = project([PASS('SMOKE-core-900'), missingReason]);
    const d2 = runSmoke(r2);
    expect(d2.gate.reason).toBe('smoke_cases_uncovered');
    expect(d2.required_skipped_cases.map((c: { id: string }) => c.id)).toEqual(['SMOKE-core-902']);
    // ③ 平台不可执行列入独立小节、不进必要证据缺失小节
    const r3 = project([PASS('SMOKE-core-900'), PASS('SMOKE-core-901'), PLATFORM_SKIP]);
    const d3 = runSmoke(r3);
    const md = reportOf(r3, d3);
    expect(md).toContain('## Platform-Unavailable Skips（平台不可执行）');
    expect(md).toContain('| SMOKE-core-902 | requires win32 |');
    expect(md).not.toContain('## Required Cases Without Evidence');
  });
});

describe('S19 必要用例 skip 与平台不可执行例外 — 场景测试', () => {
  /** 真实 runner：按 process.platform 判定，非 win32 时为 902 写 platform-unavailable skip。 */
  function platformRunner(root: string, withReason: boolean): void {
    writeFileSync(join(root, 'scripts/smoke-fixture.mjs'), [
      "import { appendFileSync, mkdirSync } from 'node:fs';",
      "import { dirname } from 'node:path';",
      "const p = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';",
      'mkdirSync(dirname(p), { recursive: true });',
      'const ts = new Date().toISOString();',
      "const rows = [{ id: 'SMOKE-core-900', status: 'pass' }, { id: 'SMOKE-core-901', status: 'pass' }];",
      "if (process.platform === 'win32') rows.push({ id: 'SMOKE-core-902', status: 'pass' });",
      `else rows.push({ id: 'SMOKE-core-902', status: 'skip', detail: 'requires win32'${withReason ? ", reason_code: 'platform-unavailable'" : ''} });`,
      "appendFileSync(p, rows.map(r => JSON.stringify({ ...r, timestamp: ts })).join('\\n') + '\\n');",
    ].join('\n'));
    const ledger = join(root, 'logos/resources/verify/smoke-results.jsonl');
    if (existsSync(ledger)) writeFileSync(ledger, '');
  }

  function smokeCli(root: string) {
    const r = spawnSync(process.execPath, [cli, 'smoke', '--format', 'json'], { cwd: root, encoding: 'utf8', timeout: 120_000 });
    return { status: r.status, data: JSON.parse(r.stdout).data };
  }

  it('ST-S19-23: 真实 runner 的平台不可执行放行与缺口拦截', () => {
    const root = project([]);
    platformRunner(root, true);
    const first = smokeCli(root);
    if (process.platform === 'win32') {
      expect(first.data.gate.result).toBe('PASS');
      expect('platform_skipped_cases' in first.data).toBe(false);
    } else {
      expect(first.status).toBe(0);
      expect(first.data.gate).toEqual({ result: 'PASS', reason: null });
      expect(first.data.platform_skipped_cases).toEqual([{ id: 'SMOKE-core-902', detail: 'requires win32' }]);
    }
    expect(existsSync(join(root, 'logos/changes', SLUG, 'SMOKE_PASS'))).toBe(true);
    platformRunner(root, false);
    const third = smokeCli(root);
    if (process.platform !== 'win32') {
      expect(third.status).not.toBe(0);
      expect(third.data.gate).toEqual({ result: 'FAIL', reason: 'required_cases_skipped' });
    }
  });

  it('ST-S19-24: 平台不可执行与环境缺口并存', () => {
    const root = project([PASS('SMOKE-core-900'),
      { id: 'SMOKE-core-901', status: 'skip', reason_code: 'missing-artifact', detail: '缺回滚制品' }, PLATFORM_SKIP]);
    const { status, data } = smokeCli(root);
    expect(status).not.toBe(0);
    expect(data.gate).toEqual({ result: 'FAIL', reason: 'required_cases_skipped' });
    expect(data.required_skipped_cases).toEqual([{ id: 'SMOKE-core-901', detail: '缺回滚制品' }]);
    expect(data.platform_skipped_cases).toEqual([{ id: 'SMOKE-core-902', detail: 'requires win32' }]);
    const md = reportOf(root, data);
    const platformSection = md.slice(md.indexOf('## Platform-Unavailable Skips'), md.indexOf('## Required Cases Without Evidence'));
    expect(platformSection).toContain('SMOKE-core-902');
    expect(platformSection).not.toContain('SMOKE-core-901');
    const requiredStart = md.indexOf('## Required Cases Without Evidence');
    const requiredEnd = md.indexOf('\n## ', requiredStart + 1);
    const requiredSection = md.slice(requiredStart, requiredEnd === -1 ? undefined : requiredEnd);
    expect(requiredSection).toContain('SMOKE-core-901');
    expect(requiredSection).not.toContain('SMOKE-core-902');
  });
});
