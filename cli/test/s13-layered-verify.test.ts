/**
 * layered-verification 切片 2：分层开启时的提案级验收（final / 非切片 verify）——配置、三层集合、扩大规则、
 * 执行与核对、主链路约束、报告、JSON 与验收历史（单模块夹具 LV）。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 分层验收测试」严格对齐：
 * UT-S13-217、218、221～235、238～247、249～251、269，ST-S13-48、49。
 * （多模块夹具 LV-mod 的 UT-S13-236、237、270～272 在 s13-layered-verify-modules.test.ts。）
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 断言「入口被调用几次」「收到的清单」「实际执行了哪些用例」一律读项目外的调用记录，不从 CLI 输出推断。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerSchema, validate } from '@hyperjump/json-schema/draft-2020-12';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureConsole, mockCwd, mockProcessExit, takeExitCode } from './helpers.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { verify as runVerifyInProcess } from '../src/commands/verify.js';
import {
  ALL_DEFAULT, P_DEFAULT, RESULTS, SLUG,
  createLv, declarationYaml, destroyLv, lvEnv, mainPathSection, normalizeRun, observeDisabledFixture, put, readCalls, runVerify,
  setDeclaration, setScript, table,
} from './golden/s13-layered-fixture.mjs';

vi.setConfig({ testTimeout: 180_000 });

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const REPO = resolve(CLI_ROOT, '..');
const GOLDEN = JSON.parse(readFileSync(join(CLI_ROOT, 'test/golden/s13-layered-disabled-baseline.json'), 'utf8'));

let schemaId = '';
beforeAll(() => {
  const schema = JSON.parse(readFileSync(join(REPO, 'spec/schema/verify.schema.json'), 'utf8'));
  expect(schema.properties.level).toBeDefined();
  expect(schema.properties.layers).toBeDefined();
  schemaId = schema.$id;
  try { registerSchema(schema); } catch { /* 同一 worker 内已注册 */ }
});
async function expectSchemaValid(data: unknown): Promise<void> {
  const output = await validate(schemaId, data as any);
  expect(output.valid, JSON.stringify(output).slice(0, 400)).toBe(true);
}

type Lv = ReturnType<typeof createLv>;
const made: Lv[] = [];
afterEach(() => { while (made.length) destroyLv(made.pop()!); });
function lv(opts: Record<string, unknown> = {}): Lv {
  const f = createLv({ buildTestChangeSet, ...opts });
  made.push(f);
  return f;
}
const verify = (f: Lv, o?: { args?: string[]; env?: Record<string, string | undefined> }) => runVerify(CLI, f, o);
const reasonCodes = (data: any): string[] => data.layers.expansion.reasons.map((r: any) => r.code);
const warningCodes = (data: any): string[] => (data.warnings ?? []).map((w: any) => w.code);
const executedOf = (run: { calls: any[] }): string[] => Array.from(new Set(run.calls.flatMap(c => c.executed as string[]))).sort();
const S03_TWO_MAIN = { 'core-S03-test-cases.md': table(['UT-S03-01', 'UT-S03-02']) + mainPathSection(['UT-S03-01', 'UT-S03-02']) };

function history(f: Lv, args: string[] = []) {
  const r = spawnSync(process.execPath, [CLI, 'history', 'list', '--format', 'json', '--limit', '50', ...args], {
    cwd: f.root, encoding: 'utf8', env: lvEnv(f),
  });
  const line = (r.stdout ?? '').split('\n').reverse().find(l => l.trim().startsWith('{'));
  return { status: r.status, stderr: r.stderr ?? '', data: line ? JSON.parse(line).data : null };
}

/** 各扩大情形（UT-S13-225～233 的代表臂），供 UT-S13-234 复用。 */
const EXPANSION_ARMS: Array<{ name: string; opts?: Record<string, unknown>; after?: (f: Lv) => void; code: string }> = [
  { name: '共享路径改动', opts: { changes: { 'package.json': '{}\n' } }, code: 'shared_path_changed' },
  { name: '声明共享改动', opts: { declaration: declarationYaml({ shared: 'true' }) }, code: 'shared_change_declared' },
  { name: '声明缺失', opts: { declaration: null }, code: 'declaration_missing' },
  { name: '声明未填写', opts: { declaration: declarationYaml({ assessment: 'pending' }) }, code: 'declaration_invalid' },
  { name: '无法评估', opts: { declaration: declarationYaml({ assessment: 'unknown' }) }, code: 'assessment_unknown' },
  { name: '不存在的场景', opts: { declaration: declarationYaml({ scenarios: ['S02', 'S99'] }) }, code: 'scenario_unknown' },
  { name: '缺 baseRef', opts: { guard: 'no-base' }, code: 'base_ref_unavailable' },
  { name: '没有活跃提案', after: f => rmSync(join(f.root, 'logos/.openlogos-guard')), code: 'no_active_change' },
];

describe('S13 分层验收 — 配置与未开启', () => {
  it('UT-S13-217: 分层配置的缺省与非法取值', () => {
    const none = verify(lv({ layered: null }));
    expect(none.data.gate.result).toBe('PASS');
    expect(none.data.layers).toBeUndefined();
    expect(warningCodes(none.data)).not.toContain('layered_config_invalid');
    expect(none.calls[0].eligible).toBeNull();

    const arms: Array<[unknown, string, boolean]> = [
      [[], 'verify.layered', false],
      [{ enabled: 'yes' }, 'verify.layered.enabled', false],
      [{ enabled: true, main_path_max: 0 }, 'verify.layered.main_path_max', true],
      [{ enabled: true, shared_paths: 'x' }, 'verify.layered.shared_paths', true],
    ];
    for (const [layered, field, enabled] of arms) {
      const run = verify(lv({ layered }));
      const warning = (run.data.warnings ?? []).find((w: any) => w.code === 'layered_config_invalid');
      expect(warning, field).toBeDefined();
      expect(warning.fields, field).toEqual([field]);
      expect(run.data.gate.result, field).toBe('PASS');
      expect(run.status, field).toBe(0);
      expect(Boolean(run.data.layers), field).toBe(enabled);
      if (enabled) expect(run.data.layers.main_path.limit, field).toBe(50);
    }
    // shared_paths 非法时按缺省清单处理：改动 package.json 仍扩大到全量
    const fallback = verify(lv({ layered: { enabled: true, shared_paths: 'x' }, changes: { 'package.json': '{}\n' } }));
    expect(reasonCodes(fallback.data)).toContain('shared_path_changed');
  });

  it('UT-S13-218: 未开启时与引入前一致', () => {
    // 逐字比对引入前构建生成的 golden（新增的 level 字段除外）：JSON、验收报告、调用记录与退出码
    const now = observeDisabledFixture(CLI, buildTestChangeSet);
    expect(now).toEqual(GOLDEN);
    const f = lv({ layered: { enabled: false } });
    const run = verify(f);
    expect(run.data.level).toBe('proposal');
    expect(run.data.layers).toBeUndefined();
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0].eligible).toBeNull();
    expect(run.calls[0].executed).toEqual(ALL_DEFAULT);
    expect(run.report).not.toContain('验收范围');
    expect(run.report).not.toContain('级别');
    const normalized = normalizeRun(f, run);
    expect(normalized.envelope.data.level).toBeUndefined();
    expect(normalized.report).toBe(GOLDEN['all-pass'].report);
  });
});

describe('S13 分层验收 — 三层集合与受影响场景', () => {
  it('UT-S13-221: 三层合集与去重', () => {
    const run = verify(lv({ docs: { 'core-S01-test-cases.md': table(['UT-S01-01', 'UT-S01-02', 'UT-S01-03']) + mainPathSection(['UT-S01-01']) } }));
    const l = run.data.layers;
    expect(l.total.ids).toEqual(P_DEFAULT);
    expect(l.total.count).toBe(7);
    expect(new Set(l.total.ids).size).toBe(7);
    expect(l.changed.ids).toEqual(['UT-S01-04']);
    const scenarios = Object.fromEntries(l.affected.scenarios.map((s: any) => [s.id, s.sources]));
    expect(scenarios.S01).toContain('delta');
    expect(scenarios.S02).toEqual(['declared']);
    expect(l.main_path.ids).toEqual(['UT-S01-01', 'UT-S03-01']);
    expect(l.expansion).toEqual({ level: 'none', reasons: [] });
    expect(l.execution.ids).toEqual(P_DEFAULT);
  });

  it('UT-S13-222: 清单交给测试入口，集合外用例不计未覆盖', () => {
    const f = lv();
    // 进程内调用：断言调用结束后进程环境中两个变量恢复原状
    const saved = { e: process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS, s: process.env.OPENLOGOS_VERIFY_SLICE_SCOPE, l: process.env.LV_LOG, c: process.env.LV_SCRIPT };
    process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS = '["PARENT"]';
    process.env.OPENLOGOS_VERIFY_SLICE_SCOPE = 'parent-scope';
    process.env.LV_LOG = f.log;
    process.env.LV_SCRIPT = f.scriptPath;
    const restore = mockCwd(f.root); const cap = captureConsole(); const exit = mockProcessExit();
    let data: any;
    try {
      runVerifyInProcess('json');
      data = [...cap.logs, ...cap.errors].map(line => { try { return JSON.parse(line); } catch { return null; } }).find(item => item?.command === 'verify')?.data;
      expect(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS).toBe('["PARENT"]');
      expect(process.env.OPENLOGOS_VERIFY_SLICE_SCOPE).toBe('parent-scope');
    } finally {
      exit.mockRestore(); cap.restore(); restore(); takeExitCode();
      for (const [key, value] of [['OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS', saved.e], ['OPENLOGOS_VERIFY_SLICE_SCOPE', saved.s], ['LV_LOG', saved.l], ['LV_SCRIPT', saved.c]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
    const calls = readCalls(f);
    expect(calls).toHaveLength(1);
    expect(calls[0].eligible).toEqual(P_DEFAULT);
    expect(calls[0].slice_scope).toBeNull();
    expect(calls[0].executed).toEqual(P_DEFAULT);
    expect(data.summary.defined_count).toBe(7);
    expect(data.uncovered_cases).toEqual([]);
    expect(data.gate.result).toBe('PASS');
    expect(data.layers.outside_result_count).toBe(0);
  });

  it('UT-S13-223: delta 触及的场景自动并入', () => {
    const run = verify(lv({ declaration: declarationYaml({ scenarios: [] }) }));
    expect(run.data.layers.affected.scenarios).toEqual([{ id: 'S01', sources: ['delta'] }]);
    expect(run.data.layers.total.ids).toEqual(['UT-S01-01', 'UT-S01-02', 'UT-S01-03', 'UT-S01-04', 'UT-S03-01']);
    expect(run.data.layers.expansion.level).toBe('none');
    expect(run.data.gate.result).toBe('PASS');
  });

  it('UT-S13-224: 人工用例不进入受影响用例', () => {
    const run = verify(lv({ declaration: declarationYaml({ scenarios: ['S04'] }) }));
    expect(run.data.layers.affected.ids).toContain('UT-S04-02');
    expect(run.data.layers.affected.ids).not.toContain('UT-S04-01');
    expect(run.data.layers.total.ids).not.toContain('UT-S04-01');
    expect(executedOf(run)).toContain('UT-S04-02');
  });

  it('UT-S13-235: 提案尚未合并时本提案用例为空', () => {
    const run = verify(lv({ merged: false }));
    expect(run.data.layers.changed).toEqual({ count: 0, ids: [] });
    expect(run.data.layers.affected.ids).toEqual(['UT-S01-01', 'UT-S01-02', 'UT-S01-03', 'UT-S02-01', 'UT-S02-02']);
    expect(run.data.layers.main_path.ids).toEqual(['UT-S03-01']);
    expect(run.data.gate.reason).not.toBe('test_change_set_invalid');
    expect(run.data.change_set_diagnostic).toBeUndefined();
    expect(run.data.gate.result).toBe('PASS');
  });
});

describe('S13 分层验收 — 扩大规则', () => {
  it('UT-S13-225: 共享路径改动扩大到全量', () => {
    const arms: Array<[string, Record<string, unknown>, ((f: Lv) => void) | null]> = [
      ['package.json', { changes: { 'package.json': '{}\n' } }, null],
      ['tools/package-lock.json', { changes: { 'tools/package-lock.json': '{}\n' } }, null],
      ['logos/logos.config.json', {}, f => {
        const path = join(f.root, 'logos/logos.config.json');
        const cfg = JSON.parse(readFileSync(path, 'utf8'));
        cfg.description = 'changed after baseRef';
        writeFileSync(path, JSON.stringify(cfg, null, 2));
      }],
    ];
    for (const [file, opts, after] of arms) {
      const f = lv(opts);
      after?.(f);
      const run = verify(f);
      expect(run.data.layers.expansion.level, file).toBe('full');
      const reason = run.data.layers.expansion.reasons.find((r: any) => r.code === 'shared_path_changed');
      expect(reason?.detail, file).toContain(file);
      expect(executedOf(run), file).toEqual(ALL_DEFAULT);
      expect(run.calls[0].eligible, file).toBeNull();
      expect(run.data.summary.defined_count, file).toBe(9);
      expect(run.data.gate.result, file).toBe('PASS');
    }
  });

  it('UT-S13-226: 声明涉及共享改动扩大到全量', () => {
    const run = verify(lv({ declaration: declarationYaml({ shared: 'true' }) }));
    expect(run.data.layers.expansion.level).toBe('full');
    expect(reasonCodes(run.data)).toEqual(['shared_change_declared']);
    expect(run.data.layers.total.ids).toEqual(ALL_DEFAULT);
  });

  it('UT-S13-227: 自定义共享路径替换缺省清单', () => {
    const custom = { enabled: true, shared_paths: ['shared/**'] };
    const a = verify(lv({ layered: custom, changes: { 'shared/util.ts': 'export {};\n' } }));
    expect(a.data.layers.expansion.level).toBe('full');
    expect(a.data.layers.expansion.reasons[0]).toMatchObject({ code: 'shared_path_changed' });
    expect(a.data.layers.expansion.reasons[0].detail).toContain('shared/util.ts');
    const b = verify(lv({ layered: custom, changes: { 'package.json': '{}\n' } }));
    expect(b.data.layers.expansion).toEqual({ level: 'none', reasons: [] });
    const f = lv({ layered: { enabled: true, shared_paths: [] } });
    writeFileSync(join(f.root, 'logos/logos-project.yaml'), `${readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf8')}# touched\n`);
    const c = verify(f);
    expect(c.data.layers.expansion.level).toBe('full');
    expect(c.data.layers.expansion.reasons[0].detail).toContain('logos/logos-project.yaml');
  });

  it('UT-S13-228: 声明缺失退回按模块', () => {
    const run = verify(lv({ declaration: null }));
    expect(reasonCodes(run.data)).toEqual(['declaration_missing', 'module_scope_unavailable']);
    expect(run.data.layers.expansion.level).toBe('full');
    expect(run.data.layers.declaration.status).toBe('missing');
    expect(run.status).toBe(0);
    expect(run.data.gate.result).toBe('PASS');
    expect(run.data.summary.defined_count).toBe(9);
  });

  it('UT-S13-229: 声明非法或未填写', () => {
    const head = 'schema: openlogos/affected-scenarios@1\nassessment: assessed\nshared_change: false\nscenarios:';
    const arms: Array<[string, string]> = [
      ['pending', declarationYaml({ assessment: 'pending' })],
      ['YAML 损坏', 'schema: openlogos/affected-scenarios@1\nassessment: [assessed\nscenarios: []'],
      ['缺 reason', `${head}\n  - id: S02`],
      ['编号重复', `${head}\n  - id: S02\n    reason: a\n  - id: S02\n    reason: b`],
      ['shared_change 非布尔', declarationYaml({ shared: '"no"' })],
    ];
    for (const [name, declaration] of arms) {
      const run = verify(lv({ declaration }));
      expect(reasonCodes(run.data), name).toContain('declaration_invalid');
      expect(run.data.layers.declaration.status, name).toBe('invalid');
      expect(run.data.layers.declaration.detail, name).toBeTruthy();
      expect(run.data.layers.expansion.level, name).toBe('full');
      expect(run.data.layers.total.ids, name).toEqual(ALL_DEFAULT);
    }
  });

  it('UT-S13-230: 无法评估', () => {
    const run = verify(lv({ declaration: declarationYaml({ assessment: 'unknown' }) }));
    expect(reasonCodes(run.data)).toContain('assessment_unknown');
    expect(run.data.layers.declaration.status).toBe('unknown');
    expect(run.data.layers.total.ids).toEqual(ALL_DEFAULT);
  });

  it('UT-S13-231: 声明了不存在的场景', () => {
    const run = verify(lv({ declaration: declarationYaml({ scenarios: ['S02', 'S99'] }) }));
    const reason = run.data.layers.expansion.reasons.find((r: any) => r.code === 'scenario_unknown');
    expect(reason.detail).toContain('S99');
    expect(run.data.layers.declaration.status).toBe('scenario_unknown');
    // 不以 S02 缩小范围；已识别的 S02 仍被列出
    expect(run.data.layers.total.ids).toEqual(ALL_DEFAULT);
    expect(run.data.layers.affected.scenarios.map((s: any) => s.id)).toEqual(['S01', 'S02']);
  });

  it('UT-S13-232: 提案起点不可用', () => {
    const arms: Array<[Record<string, unknown>, string]> = [
      [{ guard: 'no-base' }, 'base_ref_missing'],
      [{ guard: 'bad-base' }, 'base_ref_unreachable'],
      [{ git: false }, 'not_git_repository'],
    ];
    for (const [opts, detail] of arms) {
      const run = verify(lv(opts));
      expect(run.data.layers.expansion.level, detail).toBe('full');
      const reason = run.data.layers.expansion.reasons.find((r: any) => r.code === 'base_ref_unavailable');
      expect(reason?.detail, detail).toContain(detail);
      expect(run.data.gate.result, detail).toBe('PASS');
    }
  });

  it('UT-S13-233: 没有活跃提案按全量', () => {
    const f = lv();
    rmSync(join(f.root, 'logos/.openlogos-guard'));
    const run = verify(f);
    expect(run.data.layers.expansion.level).toBe('full');
    expect(reasonCodes(run.data)).toEqual(['no_active_change']);
    expect(run.data.layers.declaration).toEqual({ status: 'none', detail: null });
    expect(run.data.gate.result).toBe('PASS');
    // 主链路约束照常检查
    const g = lv({ layered: { enabled: true, main_path_max: 1 }, docs: S03_TWO_MAIN });
    rmSync(join(g.root, 'logos/.openlogos-guard'));
    const blocked = verify(g);
    expect(blocked.data.gate).toEqual({ result: 'FAIL', reason: 'main_path_over_limit' });
    expect(blocked.calls).toHaveLength(0);
  });

  it('UT-S13-234: 只扩大不缩小', () => {
    for (const arm of EXPANSION_ARMS) {
      const f = lv(arm.opts ?? {});
      arm.after?.(f);
      const run = verify(f);
      expect(reasonCodes(run.data), arm.name).toContain(arm.code);
      expect(run.data.layers.expansion.level, arm.name).not.toBe('none');
      for (const id of P_DEFAULT) expect(run.data.layers.total.ids, `${arm.name} ${id}`).toContain(id);
      expect(run.data.gate.result, arm.name).toBe('PASS');
      expect(executedOf(run).filter(id => P_DEFAULT.includes(id)), arm.name).toEqual(P_DEFAULT);
    }
  });
});

describe('S13 分层验收 — 主链路约束', () => {
  it('UT-S13-238: 主链路超过上限在执行前判 FAIL', () => {
    const f = lv({ layered: { enabled: true, main_path_max: 1 }, docs: S03_TWO_MAIN });
    const run = verify(f);
    expect(run.calls).toHaveLength(0);
    expect(run.status).toBe(1);
    expect(run.data.gate).toEqual({ result: 'FAIL', reason: 'main_path_over_limit' });
    expect(run.data.layers.main_path).toMatchObject({ limit: 1, count: 2 });
    expect(run.data.layers.outside_result_count).toBe(0);
    expect(run.report).toContain('未执行');
    expect(run.report).toContain('main_path_over_limit');
    expect(run.report).toMatch(/limit：1；实际 \/ actual：2/);
    expect(existsSync(join(f.root, RESULTS))).toBe(false);
    expect(existsSync(join(f.proposalDir!, 'VERIFY_PASS'))).toBe(false);
    const latest = history(f).data.runs[0];
    expect(latest.result_source).toBe('none');
    expect(latest.gate).toEqual({ result: 'FAIL', reason: 'main_path_over_limit' });
    expect(latest.counts.defined).toBeNull();
  });

  it('UT-S13-239: 主链路小节结构错误在执行前判 FAIL', () => {
    const invalid = { 'core-S03-test-cases.md': table(['UT-S03-01', 'UT-S03-02']) + mainPathSection(['UT-S03-01', 'UT-S03-99']) };
    const a = verify(lv({ docs: invalid }));
    expect(a.calls).toHaveLength(0);
    expect(a.data.gate).toEqual({ result: 'FAIL', reason: 'main_path_invalid' });
    expect(a.data.layers.main_path.problems).toEqual([{ file: 'logos/resources/test/core-S03-test-cases.md', id: 'UT-S03-99', code: 'undefined_id' }]);
    expect(a.report).toContain('main_path_invalid');
    expect(a.report).toContain('UT-S03-99');
    // 同时超过上限时仍取 main_path_invalid
    const both = { 'core-S03-test-cases.md': table(['UT-S03-01', 'UT-S03-02']) + mainPathSection(['UT-S03-01', 'UT-S03-02', 'UT-S03-99']) };
    const b = verify(lv({ layered: { enabled: true, main_path_max: 1 }, docs: both }));
    expect(b.calls).toHaveLength(0);
    expect(b.data.gate.reason).toBe('main_path_invalid');
    expect(b.data.layers.main_path.count).toBe(2);
  });

  it('UT-S13-240: 执行前判 FAIL 时变更集无效优先', () => {
    const f = lv({ layered: { enabled: true, main_path_max: 1 }, docs: S03_TWO_MAIN });
    const markerPath = join(f.proposalDir!, 'SPEC_MERGED');
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    marker.test_change_set.changed_test_ids = ['UT-S01-99'];
    writeFileSync(markerPath, JSON.stringify(marker, null, 2));
    const run = verify(f);
    expect(run.calls).toHaveLength(0);
    expect(run.data.gate).toEqual({ result: 'FAIL', reason: 'test_change_set_invalid' });
    expect(run.data.change_set_diagnostic.code).toBe('test_change_set_invalid');
    expect(run.data.layers.main_path).toMatchObject({ limit: 1, count: 2 });
  });

  it('UT-S13-241: 主链路用例不得靠复跑通过', () => {
    const f = lv({ script: { cases: { 'UT-S03-01': ['fail', 'pass'] } } });
    const run = verify(f);
    expect(run.calls).toHaveLength(2);
    expect(run.calls[1].rerun).toBe('1');
    expect(run.data.gate).toEqual({ result: 'FAIL', reason: 'main_path_flaky' });
    expect(run.status).toBe(1);
    expect(run.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S03-01']);
    expect(run.data.layers.main_path.flaky_ids).toEqual(['UT-S03-01']);
    expect(existsSync(join(f.proposalDir!, 'VERIFY_PASS'))).toBe(false);
    expect(existsSync(join(f.proposalDir!, 'VERIFY_FAIL'))).toBe(true);
    expect(warningCodes(run.data)).not.toContain('flaky_cases_present');
    expect(run.report).toContain('main_path_flaky');
    expect(run.report).toContain('移出主链路');
  });

  it('UT-S13-242: 非主链路偶发与未开启时的主链路偶发照常放行', () => {
    const a = verify(lv({ script: { cases: { 'UT-S02-01': ['fail', 'pass'] } } }));
    expect(a.data.gate.result).toBe('PASS');
    expect(warningCodes(a.data)).toContain('flaky_cases_present');
    expect(a.data.layers.main_path.flaky_ids).toEqual([]);
    const b = verify(lv({ layered: { enabled: false }, script: { cases: { 'UT-S03-01': ['fail', 'pass'] } } }));
    expect(b.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(warningCodes(b.data)).toContain('flaky_cases_present');
    expect(b.data.layers).toBeUndefined();
  });

  it('UT-S13-243: 分层下的原因优先级', () => {
    const flaky = { 'UT-S03-01': ['fail', 'pass'] };
    const arms: Array<[string, Record<string, unknown>, Record<string, unknown>, string]> = [
      ['另有用例失败', { cases: { ...flaky, 'UT-S02-01': 'fail' } }, { cases: { 'UT-S02-01': 'fail' } }, 'failed_cases'],
      ['预跑命令非零退出', { cases: flaky, exit: { 2: 3 } }, { exit: { 1: 3 } }, 'pre_run_failed'],
      ['账本有非法行', { cases: flaky, invalidLine: [1, 2] }, { invalidLine: [1, 2] }, 'result_ledger_inconsistent'],
    ];
    for (const [name, withFlaky, without, fallback] of arms) {
      const a = verify(lv({ script: withFlaky }));
      expect(a.data.gate, name).toEqual({ result: 'FAIL', reason: 'main_path_flaky' });
      expect(a.data.layers.main_path.flaky_ids, name).toEqual(['UT-S03-01']);
      const b = verify(lv({ script: without }));
      expect(b.data.gate, name).toEqual({ result: 'FAIL', reason: fallback });
    }
  });
});

describe('S13 分层验收 — 测试入口未收窄', () => {
  it('UT-S13-244: 测试入口未收窄且因集合外失败而非零退出', () => {
    const run = verify(lv({ mode: 'wide', script: { cases: { 'UT-S03-02': 'fail' } } }));
    expect(run.calls[0].executed).toEqual(ALL_DEFAULT);
    expect(run.data.failed_cases).toEqual([]);
    expect(run.data.layers.outside_result_count).toBe(2);
    expect(warningCodes(run.data)).toContain('layered_runner_not_narrowed');
    expect(run.data.consistency.ok).toBe(true);
    expect(run.data.consistency.outside_eligible_result_ids).toEqual([]);
    expect(run.data.consistency.reasons).not.toContain('result_outside_eligible_scope');
    expect(run.data.rerun.skipped_reason).toBe('no_failed_cases');
    expect(run.calls).toHaveLength(1);
    expect(run.data.pre_run.commands[0].status).toBe('fail');
    expect(run.data.gate).toEqual({ result: 'FAIL', reason: 'pre_run_failed' });
  });

  it('UT-S13-269: 集合外失败行被忽略且入口零退出时放行', () => {
    const run = verify(lv({ mode: 'wide', script: { cases: { 'UT-S03-02': 'fail' }, exit: { 1: 0 } } }));
    expect(run.data.failed_cases).toEqual([]);
    expect(run.data.layers.outside_result_count).toBe(2);
    expect(warningCodes(run.data)).toContain('layered_runner_not_narrowed');
    expect(run.data.pre_run.commands[0].status).toBe('pass');
    expect(run.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(run.status).toBe(0);
  });

  it('UT-S13-245: 入口未收窄但未上报时不告警', () => {
    const run = verify(lv({ mode: 'quiet' }));
    expect(run.calls[0].executed).toEqual(ALL_DEFAULT);
    expect(run.data.layers.outside_result_count).toBe(0);
    expect(warningCodes(run.data)).not.toContain('layered_runner_not_narrowed');
    expect(run.data.summary.defined_count).toBe(7);
    expect(run.data.gate.result).toBe('PASS');
  });

  it('UT-S13-246: 失败复跑的范围在 P 之内', () => {
    const run = verify(lv({ mode: 'wide', script: { cases: { 'UT-S02-01': ['fail', 'pass'], 'UT-S03-02': ['fail', 'pass'] } } }));
    expect(run.data.rerun.requested_ids).toEqual(['UT-S02-01']);
    expect(run.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S02-01']);
    expect(run.calls).toHaveLength(2);
    expect(run.calls[1].eligible).toEqual(['UT-S02-01']);
  });
});

describe('S13 分层验收 — 报告、JSON 与验收历史', () => {
  it('UT-S13-247: 提案级报告的级别与验收范围小节', () => {
    const f = lv();
    const run = verify(f, { args: [] });
    expect(run.status).toBe(0);
    const report = run.report!;
    expect(report).toContain('| 级别 / Level | 提案级（分层）/ proposal (layered) |');
    expect(report).toContain('## 验收范围 / Verification Scope');
    expect(report).toContain('| 本提案用例 / Changed | 1 |');
    expect(report).toContain('| 受影响用例 / Affected | 6 |');
    expect(report).toMatch(/\| 主链路用例 \/ Main path \| 1（上限 \/ limit 50） \|/);
    expect(report).toContain('| 合计（提案集合）/ Total | 7 |');
    expect(report).toContain('S01（delta）、S02（declared）');
    expect(report).toContain('扩大级别 / Expansion：`none`');
    expect(report).toContain('集合外结果行数 / Results outside the set：0');
    expect(report).toContain('提案级通过不等于可以发布');
    expect(report).not.toContain('LV-RUNNER-OUTPUT');
    // 扩大时写明级别与原因
    setDeclaration(f, declarationYaml({ shared: 'true' }));
    const full = verify(f, { args: [] });
    expect(full.report).toContain('扩大级别 / Expansion：`full`');
    expect(full.report).toContain('`shared_change_declared`');
  });

  it('UT-S13-249: JSON 的 level 与 layers 结构', async () => {
    const none = verify(lv());
    const full = verify(lv({ declaration: declarationYaml({ shared: 'true' }) }));
    for (const run of [none, full]) {
      await expectSchemaValid(run.data);
      expect(run.data.level).toBe('proposal');
      for (const key of ['changed', 'affected', 'main_path', 'total', 'execution', 'declaration', 'expansion', 'outside_result_count']) {
        expect(run.data.layers, key).toHaveProperty(key);
      }
    }
    expect(none.data.layers.expansion.reasons).toEqual([]);
    expect(full.data.layers.expansion.reasons.length).toBeGreaterThan(0);
    // 执行前判 FAIL 的响应同样符合 schema
    const blocked = verify(lv({ layered: { enabled: true, main_path_max: 1 }, docs: S03_TWO_MAIN }));
    await expectSchemaValid(blocked.data);
  });

  it('UT-S13-250: 历史记录的 level、platform 与读取兼容', () => {
    const f = lv();
    expect(verify(f).status).toBe(0);
    const dir = join(f.root, 'logos/resources/verify/history');
    const [file] = readdirSync(dir).filter(n => n.endsWith('.json'));
    const record = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    expect(record.level).toBe('proposal');
    expect(record.platform).toBe(`${process.platform}-${process.arch}`);
    const preset = (suffix: string, mutate: (r: any) => void) => {
      const id = `${record.run_id}-${suffix}`;
      const copy = { ...record, run_id: id };
      mutate(copy);
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(copy, null, 2));
      return id;
    };
    const legacy = preset('legacy', r => { delete r.level; delete r.platform; });
    const release = preset('release', r => { r.level = 'release'; });
    const badLevel = preset('badlevel', r => { r.level = 'x'; });
    const badPlatform = preset('badplatform', r => { r.platform = 1; });
    const out = history(f);
    expect(out.status).toBe(0);
    const byId = Object.fromEntries(out.data.runs.map((r: any) => [r.run_id, r]));
    expect(byId[record.run_id]).toMatchObject({ level: 'proposal', platform: `${process.platform}-${process.arch}` });
    expect(byId[legacy]).toMatchObject({ level: 'proposal', platform: null });
    expect(byId[release].level).toBe('release');
    expect(byId[badLevel]).toBeUndefined();
    expect(byId[badPlatform]).toBeUndefined();
    const corrupt = out.data.warnings.filter((w: any) => w.code === 'verification_history_corrupt').map((w: any) => w.path);
    expect(corrupt.some((p: string) => p.includes(badLevel))).toBe(true);
    expect(corrupt.some((p: string) => p.includes(badPlatform))).toBe(true);
  });

  it('UT-S13-251: history list 按级别与提交筛选', () => {
    const f = lv();
    expect(verify(f).status).toBe(0);
    const dir = join(f.root, 'logos/resources/verify/history');
    const [file] = readdirSync(dir).filter(n => n.endsWith('.json'));
    const record = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const head = record.commit.head as string;
    const other = 'feedfacefeedfacefeedfacefeedfacefeedface';
    const preset = (suffix: string, commit: string) => {
      const id = `${record.run_id}-${suffix}`;
      writeFileSync(join(dir, `${id}.json`), JSON.stringify({
        ...record, run_id: id, level: 'release', proposal: null, raw_location: 'none', verify_mode: null, module_scope: null,
        commit: { head: commit, dirty: false },
      }, null, 2));
      return id;
    };
    const sameCommit = preset('rel-same', head);
    const otherCommit = preset('rel-other', other);
    const release = history(f, ['--level', 'release']);
    expect(release.data.runs.map((r: any) => r.run_id).sort()).toEqual([sameCommit, otherCommit].sort());
    expect(release.data.total).toBe(2);
    const filtered = history(f, ['--level', 'release', '--commit', head.slice(0, 10)]);
    expect(filtered.data.runs.map((r: any) => r.run_id)).toEqual([sameCommit]);
    const proposal = history(f, ['--level', 'proposal']);
    expect(proposal.data.runs.map((r: any) => r.run_id)).toEqual([record.run_id]);
    const byCommit = history(f, ['--commit', other.slice(0, 8)]);
    expect(byCommit.data.runs.map((r: any) => r.run_id)).toEqual([otherCommit]);
    const bad = history(f, ['--level', 'nightly']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('INVALID_ARGUMENT');
  });
});

describe('S13 分层验收 — 场景测试', () => {
  it('ST-S13-48: 分层开启的提案级验收只跑该跑的部分', () => {
    const f = lv();
    const run = verify(f);
    expect(run.status).toBe(0);
    expect(run.data.gate.result).toBe('PASS');
    expect(run.data.level).toBe('proposal');
    expect(run.data.layers.expansion.level).toBe('none');
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0].executed).toEqual(P_DEFAULT);
    expect(run.calls[0].executed).not.toContain('UT-S03-02');
    expect(run.calls[0].executed).not.toContain('UT-S04-02');
    const rows = readFileSync(join(f.root, RESULTS), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).id).sort();
    expect(rows).toEqual(P_DEFAULT);
    expect(run.report).toContain('提案级（分层）');
    expect(run.report).toContain('| 本提案用例 / Changed | 1 |');
    expect(run.report).toContain('| 主链路用例 / Main path | 1（上限 / limit 50） |');
    expect(existsSync(join(f.root, 'logos/changes', SLUG, 'VERIFY_PASS'))).toBe(true);
    const latest = history(f).data.runs[0];
    expect(latest.level).toBe('proposal');
    expect(latest.gate.result).toBe('PASS');
    expect(latest.counts.defined).toBe(7);
  });

  it('ST-S13-49: 评估不可用时扩大而不是放过', () => {
    const f = lv({ script: { cases: { 'UT-S03-02': 'fail' } } });
    const narrow = verify(f);
    expect(narrow.status).toBe(0);
    expect(narrow.data.gate.result).toBe('PASS');
    expect(executedOf(narrow)).not.toContain('UT-S03-02');
    setDeclaration(f, declarationYaml({ shared: 'true' }));
    setScript(f, { mode: 'narrow', cases: { 'UT-S03-02': 'fail' } });
    const full = verify(f);
    expect(full.status).toBe(1);
    expect(full.data.layers.expansion.level).toBe('full');
    expect(full.calls[0].executed).toContain('UT-S03-02');
    expect(full.data.failed_cases.map((c: any) => c.id)).toEqual(['UT-S03-02']);
    expect(full.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(full.report).toContain('shared_change_declared');
    expect(existsSync(join(f.root, 'logos/changes', SLUG, 'VERIFY_PASS'))).toBe(false);
  });
});
