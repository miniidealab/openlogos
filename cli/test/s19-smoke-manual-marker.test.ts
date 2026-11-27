/**
 * S19 SMOKE 人工标记读取与全人工项目的空自动阶段（smoke-manual-acceptance，切片 slice-01-smoke-manual-marker）。
 *
 * 覆盖 UT-S19-127～UT-S19-131、UT-S19-133、UT-S19-134、ST-S19-40，对应功能规格 §2.107.2、§2.107.6，
 * 场景 S19「S19 SMOKE 人工标记读取与人工判定接入」Step 1～2、EX-19.26～EX-19.28。
 * 全部用例在一次性项目中构造；结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, takeExitCode } from './helpers.js';
import { cli as CLI } from './frontier-fixture.js';
import { checkSmokeCoverage, extractSmokeIdSetsFromContent, extractSmokeIdsFromContent } from '../src/lib/smoke-coverage.js';
import { collectSmokeData, extractSmokeDefinedIds, extractSmokeManualIds, smoke } from '../src/commands/smoke.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const SMOKE_SPEC = 'logos/resources/test/smoke/core-smoke-test-cases.md';
const RESULT_REL = 'logos/resources/verify/smoke-results.jsonl';

type Rec = Record<string, unknown>;

function put(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function table(rows: string[]): string {
  return ['# Smoke', '', '| ID | 描述 |', '|---|---|', ...rows.map(r => `| ${r} | 安装态 |`)].join('\n') + '\n';
}

/**
 * 一次性项目（无活跃提案、无登记表）。records 非 null 时配置 runner 写入这些结果；为 null 时不配置 smoke.command。
 */
function project(opts: { smokeRows?: string[] | null; records?: Rec[] | null; extraFiles?: Record<string, string> } = {}): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  if (opts.smokeRows !== null) put(root, SMOKE_SPEC, table(opts.smokeRows ?? ['SMOKE-core-01']));
  for (const [rel, content] of Object.entries(opts.extraFiles ?? {})) put(root, rel, content);
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfg.smoke = { result_path: RESULT_REL, sandbox_mode: 'off' };
  if (opts.records !== null && opts.records !== undefined) {
    cfg.smoke.command = 'node tools/runner.mjs';
    put(root, 'tools/records.jsonl', opts.records.map(r => JSON.stringify({ timestamp: new Date().toISOString(), ...r })).join('\n') + (opts.records.length ? '\n' : ''));
    put(root, 'tools/runner.mjs', [
      "import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';",
      "import { dirname } from 'node:path';",
      `const p = process.env.OPENLOGOS_SMOKE_RESULT_PATH || '${RESULT_REL}';`,
      'mkdirSync(dirname(p), { recursive: true });',
      "appendFileSync(p, readFileSync('tools/records.jsonl', 'utf8'));",
    ].join('\n'));
  }
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  return root;
}

/** 进程内执行 `openlogos smoke --format json`：返回 envelope（stdout 或 stderr 的最后一行）与退出码。 */
function runSmoke(root: string): { exit: number | undefined; out: any; err: any } {
  const restore = mockCwd(root);
  const con = captureConsole();
  const exitSpy = mockProcessExit();
  let exitArg: number | undefined;
  try { smoke('json'); } catch { /* process.exit 桩抛出 */ } finally {
    const call = exitSpy.mock.calls[0];
    if (call) exitArg = Number(call[0] ?? 0);
    con.restore(); exitSpy.mockRestore(); restore();
  }
  const pending = takeExitCode();
  const exit = exitArg ?? (pending === undefined || pending === null ? undefined : Number(pending));
  const last = (lines: string[]) => {
    for (let i = lines.length - 1; i >= 0; i--) {
      try { return JSON.parse(lines[i]); } catch { /* 非 JSON 行 */ }
    }
    return null;
  };
  return { exit, out: last(con.logs), err: last(con.errors ?? []) };
}

/** 引入人工标记前的首格读法（逐字复刻旧实现），供 UT-S19-131 对照。 */
function legacyExtract(content: string): string[] {
  const tableIds: string[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const firstCell = line.split('|')[1]?.trim().replace(/^`|`$/g, '') ?? '';
    if (/^SMOKE-[A-Za-z0-9-]+-\d{1,3}$/.test(firstCell)) tableIds.push(firstCell);
  }
  const uniq = (v: string[]) => Array.from(new Set(v)).sort();
  if (tableIds.length > 0) return uniq(tableIds);
  return uniq([...content.matchAll(/\bSMOKE-[A-Za-z0-9-]+-\d{1,3}\b/g)].map(m => m[0]));
}

describe('S19 SMOKE 人工标记读取（smoke-manual-acceptance）', () => {
  it('UT-S19-127: 首格容忍人工标记，输出自动集合与人工集合', () => {
    const content = table(['SMOKE-core-01', 'SMOKE-core-901 [manual]', '`SMOKE-core-902` [manual/macos]']);
    const sets = extractSmokeIdSetsFromContent(content);
    expect(sets.auto).toEqual(['SMOKE-core-01']);
    expect(sets.manual).toEqual(['SMOKE-core-901', 'SMOKE-core-902']);
    // 既有消费方（defined / changed_case_ids / 模块范围）只拿到自动集合
    expect(extractSmokeIdsFromContent(content)).toEqual(['SMOKE-core-01']);
  });

  it('UT-S19-128: 整份文件只有人工行时不触发全文回退', () => {
    const content = table(['SMOKE-core-901 [manual]']) + '\n正文提到 SMOKE-core-950 作为夹具编号。\n';
    const sets = extractSmokeIdSetsFromContent(content);
    expect(sets.manual).toEqual(['SMOKE-core-901']);
    expect(sets.auto).toEqual([]);
    expect([...sets.auto, ...sets.manual]).not.toContain('SMOKE-core-950');
  });

  it('UT-S19-129: 人工 SMOKE 不计入覆盖、runner 要求与本提案变更用例', () => {
    const SLUG = 'manual-only-delta';
    const root = project({
      smokeRows: ['SMOKE-core-900', 'SMOKE-core-901 [manual]'],
      records: [{ id: 'SMOKE-core-900', status: 'pass' }],
    });
    put(root, `logos/changes/${SLUG}/deltas/test/smoke/core-smoke-test-cases.md`,
      ['## ADDED — 夹具人工 smoke', '', '| ID | 描述 |', '|---|---|', '| SMOKE-core-901 [manual] | 实机安装后确认首启界面 |'].join('\n') + '\n');
    put(root, RESULT_REL, JSON.stringify({ id: 'SMOKE-core-900', status: 'pass' }) + '\n');

    const check = checkSmokeCoverage(root, { slug: SLUG, resultPath: RESULT_REL, command: null });
    expect(check.changed_case_ids).not.toContain('SMOKE-core-901');
    expect(check.diagnostics.map(d => d.code)).not.toContain('smoke_runner_missing');
    expect(check.diagnostics.map(d => d.code)).not.toContain('smoke_cases_uncovered');

    const data = collectSmokeData(root, undefined, undefined, check, { deferReport: true });
    expect(extractSmokeDefinedIds(root)).toEqual(['SMOKE-core-900']);
    expect(extractSmokeManualIds(root)).toEqual(['SMOKE-core-901']);
    expect(data.summary.defined_count).toBe(1);
    expect(data.uncovered_cases).not.toContain('SMOKE-core-901');
    expect(data.changed_cases).not.toContain('SMOKE-core-901');
    expect(data.gate).toEqual({ result: 'PASS', reason: null });
  });

  it('UT-S19-130: smoke 结果出现人工 SMOKE ID 时门禁 FAIL（manual_smoke_result_id）', () => {
    const root = project({
      smokeRows: ['SMOKE-core-900', 'SMOKE-core-901 [manual]'],
      records: [{ id: 'SMOKE-core-900', status: 'pass' }, { id: 'SMOKE-core-901', status: 'pass' }],
    });
    const r = runSmoke(root);
    expect(r.exit).toBe(1);
    expect(r.out.data.gate).toEqual({ result: 'FAIL', reason: 'manual_smoke_result_id' });
    const diag = r.out.data.diagnostics.find((d: Rec) => d.code === 'manual_smoke_result_id');
    expect(diag).toBeDefined();
    expect(diag.case_ids).toEqual(['SMOKE-core-901']);
    expect(existsSync(join(root, 'logos/resources/verify/smoke-report.md'))).toBe(true);
  });

  it('UT-S19-131: 未带标记的行读法与门禁与引入前一致（回归对照）', () => {
    const fixtures = [
      table(['SMOKE-core-01', 'SMOKE-core-02']),
      table(['`SMOKE-core-03`', 'SMOKE-core-04']) + '\n正文提到 SMOKE-core-99。\n',
      '# 只有正文\n\n部署后执行 SMOKE-core-05 与 SMOKE-core-06。\n',
      '| 说明 | 列 |\n|---|---|\n| 不是用例 | SMOKE-core-07 |\n\n正文 SMOKE-core-08\n',
      '',
    ];
    for (const content of fixtures) {
      expect(extractSmokeIdsFromContent(content)).toEqual(legacyExtract(content));
      expect(extractSmokeIdSetsFromContent(content).manual).toEqual([]);
    }
    // 门禁：既有夹具（无任何 [manual]）结论、reason 与退出码不变；只多出默认 manual_acceptance
    const pass = runSmoke(project({ smokeRows: ['SMOKE-core-01'], records: [{ id: 'SMOKE-core-01', status: 'pass' }] }));
    expect(pass.exit ?? 0).toBe(0);
    expect(pass.out.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(pass.out.data.manual_acceptance).toMatchObject({ enabled: false, pending: [], unexecuted: [], warnings: [] });
    const fail = runSmoke(project({ smokeRows: ['SMOKE-core-01'], records: [{ id: 'SMOKE-core-01', status: 'fail', error: 'boom' }] }));
    expect(fail.exit).toBe(1);
    expect(fail.out.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
  });

  it('UT-S19-133: 存在自动用例但缺结果文件时仍报 NO_SMOKE_RESULTS', () => {
    const root = project({ smokeRows: ['SMOKE-core-01', 'SMOKE-core-901 [manual]'], records: null });
    const r = runSmoke(root);
    expect(r.exit).toBe(1);
    expect(r.err.error.code).toBe('NO_SMOKE_RESULTS');
    // 不进入人工阶段，不写任何部署账本行
    expect(existsSync(join(root, 'logos/.openlogos-runtime/deployments.jsonl'))).toBe(false);
  });

  it('UT-S19-134: 两类用例都没有时才报 NO_SMOKE_CASES；只有人工用例时自动阶段空通过', () => {
    // ① 没有任何 smoke 规格表行，测试规格中也没有人工用例
    const none = project({ smokeRows: null, records: [] });
    put(none, RESULT_REL, '');
    const r1 = runSmoke(none);
    expect(r1.exit).toBe(1);
    expect(r1.err.error.code).toBe('NO_SMOKE_CASES');
    // ② 只有人工 SMOKE，没有 runner、没有结果文件
    const manualOnly = project({ smokeRows: ['SMOKE-core-901 [manual]'], records: null });
    const r2 = runSmoke(manualOnly);
    expect(r2.exit ?? 0).toBe(0);
    expect(r2.out.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(r2.out.data.summary.defined_count).toBe(0);
    // ③ 只有人工 UT/ST（smoke 规格没有任何用例）
    const manualUt = project({
      smokeRows: null,
      records: null,
      extraFiles: { 'logos/resources/test/core-S01-test-cases.md': '| ID | 描述 |\n|---|---|\n| ST-S01-05 [manual] | 人工观察终端渲染 |\n' },
    });
    const r3 = runSmoke(manualUt);
    expect(r3.exit ?? 0).toBe(0);
    expect(r3.out.data.gate.result).toBe('PASS');
  });
});

describe('S19 SMOKE 人工标记真实 CLI（smoke-manual-acceptance）', () => {
  it('ST-S19-40: 真实 CLI：未配置人工验收、无人工用例的项目零变化', () => {
    const root = project({ smokeRows: ['SMOKE-core-01', 'SMOKE-core-02'], records: [{ id: 'SMOKE-core-01', status: 'pass' }, { id: 'SMOKE-core-02', status: 'pass' }] });
    const env: Record<string, string> = { ...process.env as Record<string, string>, NO_COLOR: '1' };
    for (const k of Object.keys(env)) if (k.startsWith('OPENLOGOS_SMOKE_')) delete env[k];
    const r = spawnSync(process.execPath, [CLI, 'smoke', '--format', 'json'], { cwd: root, encoding: 'utf8', env, timeout: 120_000 });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout.trim().split('\n').pop()!);
    expect(out.command).toBe('smoke');
    const data = out.data;
    expect(data.gate).toEqual({ result: 'PASS', reason: null });
    expect(data.summary).toMatchObject({ defined_count: 2, executed_count: 2, passed_count: 2, failed_count: 0, uncovered_count: 0 });
    expect(data.diagnostics).toEqual([]);
    // 唯一新增：值为默认的 data.manual_acceptance
    expect(data.manual_acceptance).toEqual({
      enabled: false, environment: null, deploy_id: null, deploy_confirmed: false, ref: null, baseline_ref: null,
      pending: [], passed: [], failed: [], remaining: [], regression_unresolved: [], unexecuted: [], warnings: [],
    });
    const expectedKeys = ['environment', 'summary', 'gate', 'changed_cases', 'diagnostics', 'runners', 'failed_cases',
      'uncovered_cases', 'skipped_cases', 'sandbox', 'report_path', 'result_path', 'manual_acceptance'];
    for (const k of expectedKeys) expect(Object.keys(data)).toContain(k);
    expect(Object.keys(data).filter(k => !['history', ...expectedKeys].includes(k))).toEqual([]);
    // 报告与账本：不出现人工验收内容，不写部署账本
    expect(readFileSync(join(root, data.report_path), 'utf-8')).not.toContain('人工');
    expect(existsSync(join(root, 'logos/.openlogos-runtime/deployments.jsonl'))).toBe(false);
  });
});
