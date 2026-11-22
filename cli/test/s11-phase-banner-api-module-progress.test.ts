/**
 * S11 — SessionStart 阶段横幅 API 阶段按模块进度判定（fix-phase-banner-api-false-missing，单切片）。
 * 覆盖 UT-S11-111～UT-S11-115（与 logos/resources/test/core-S11-test-cases.md 严格对齐）。
 *
 * 被测对象是**源模板** `plugin/bin/openlogos-phase`（不测 `.claude/openlogos/bin/` 的 sync 部署副本）。
 * 约束 5a：API 按业务领域分文件、不带场景编号，横幅不做 API 逐场景判定；
 *  - status 路径：SessionStart 既有那一次 `openlogos status --format json` 可用时，按 initial 模块的
 *    `phase_progress["phase.3-2-api"]` 判定（存在未完成且未跳过的模块 → `Phase 3 Step 2 … (modules: …)`），
 *    结论覆盖 shell 的 `SKIP_API` 与「向后看兜底」；
 *  - 降级路径：status 不可用时沿用项目级判定（`SKIP_API` 含向后看兜底 → 跳过；目录为空 → Step 2；非空 → 继续）。
 *
 * status 路径以 PATH 首位的记录调用桩 `openlogos` 驱动；降级路径的 PATH 不含 `openlogos`。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject } from './helpers.js';

// 每条用例驱动多次真实子进程（bash 探测脚本、CLI status），与 s11-phase-probe-module-prefix 同例放宽超时。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHASE_HOOK = join(REPO_ROOT, 'plugin', 'bin', 'openlogos-phase');
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const BASE_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const API_DIR = 'logos/resources/api';
const DB_DIR = 'logos/resources/database';
const TEST_DIR = 'logos/resources/test';
const ORCH_DIR = 'logos/resources/scenario';
const SCEN_DIR = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';

interface MultiOpts {
  /** 声明的场景数（全部归属 team）。 */
  scenarios: number;
  /** 额外的 initial 模块 id（如 ops）。 */
  extraInitial?: string[];
  /** 是否写入 team 的全部测试用例文件。 */
  teamTests?: boolean;
}

function sid(i: number): string { return `S${String(i).padStart(2, '0')}`; }

/** 一次性多模块项目：core launched（skip api/database/scenario），team initial，前序阶段齐全。 */
function multiProject(opts: MultiOpts) {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  const ids = Array.from({ length: opts.scenarios }, (_, i) => sid(i + 1));
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:',
    '  name: "phase-api"',
    '  description: ""',
    'modules:',
    '  - id: core',
    '    name: core',
    '    lifecycle: launched',
    '    skip_phases: [api, database, scenario]',
    '  - id: team',
    '    name: team',
    '    lifecycle: initial',
    ...(opts.extraInitial ?? []).flatMap(m => [`  - id: ${m}`, `    name: ${m}`, '    lifecycle: initial']),
    'scenarios:',
    ...ids.flatMap(id => [`  - id: ${id}`, `    name: 场景 ${id}`, '    module: team']),
    '',
  ].join('\n'));
  const seed = (rel: string, name: string) => put(root, rel, name);
  for (const m of ['team', ...(opts.extraInitial ?? [])]) {
    seed('logos/resources/prd/1-product-requirements', `${m}-01-requirements.md`);
    seed('logos/resources/prd/2-product-design', `${m}-02-design.md`);
    seed('logos/resources/prd/3-technical-plan/1-architecture', `${m}-03-architecture.md`);
  }
  for (const id of ids) seed(SCEN_DIR, `team-${id}-flow.md`);
  if (opts.teamTests) for (const id of ids) seed(TEST_DIR, `team-${id}-test-cases.md`);
  return { root, ids };
}

/** 单模块 initial 项目（core），前序阶段齐全，API / 数据库 / 后续阶段目录为空。 */
function singleProject() {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:', '  name: "phase-api-single"', '  description: ""',
    'modules:', '  - id: core', '    name: core', '    lifecycle: initial',
    'scenarios:', '  - id: S01', '    name: 场景 S01', '    module: core', '',
  ].join('\n'));
  put(root, 'logos/resources/prd/1-product-requirements', 'core-01-requirements.md');
  put(root, 'logos/resources/prd/2-product-design', 'core-02-design.md');
  put(root, 'logos/resources/prd/3-technical-plan/1-architecture', 'core-03-architecture.md');
  put(root, SCEN_DIR, 'core-S01-flow.md');
  return { root };
}

function put(root: string, rel: string, name: string, body = 'x\n') {
  mkdirSync(join(root, rel), { recursive: true });
  writeFileSync(join(root, rel, name), body);
}

/** 清空目录内的业务文件（保留 .gitkeep，它本就被探测排除）。 */
function clearDir(root: string, rel: string) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  for (const f of readdirSync(abs)) if (f !== '.gitkeep') rmSync(join(abs, f), { recursive: true, force: true });
}

type StubMode = { kind: 'json'; body: unknown } | { kind: 'fail'; body?: unknown } | { kind: 'raw'; text: string };

/** 记录调用的桩 openlogos：参数逐行追加到 calls.log，按模式输出 status JSON / 非零退出 / 原样文本。 */
function stubBin(root: string, mode: StubMode): { dir: string; calls: () => string[] } {
  const dir = join(root, '..', `stub-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const out = mode.kind === 'raw' ? mode.text : mode.body !== undefined ? JSON.stringify(mode.body) : '';
  writeFileSync(join(dir, 'out.txt'), out);
  writeFileSync(join(dir, 'openlogos'), [
    '#!/bin/bash',
    'd="$(cd "$(dirname "$0")" && pwd)"',
    'echo "$*" >> "$d/calls.log"',
    'cat "$d/out.txt"',
    mode.kind === 'fail' ? 'exit 3' : 'exit 0',
    '',
  ].join('\n'), { mode: 0o755 });
  return {
    dir,
    calls: () => existsSync(join(dir, 'calls.log'))
      ? readFileSync(join(dir, 'calls.log'), 'utf-8').split('\n').filter(Boolean) : [],
  };
}

/** status JSON：core launched（无 phase_progress），每个 initial 模块给定 phase.3-2-api 状态。 */
function statusBody(api: Record<string, { done: boolean; skipped: boolean } | null>) {
  return {
    data: {
      lifecycle: 'launched',
      modules: [
        { id: 'core', lifecycle: 'launched', phase_progress: null },
        ...Object.entries(api).map(([id, st]) => ({
          id, lifecycle: 'initial',
          phase_progress: st === null ? null : { 'phase.3-2-api': st },
        })),
      ],
    },
  };
}

/** 运行源模板（--plain）；`stub` 为空则 PATH 不含 openlogos（降级路径）。默认 PATH 不含 node（走 Python 解析），`node` 为真时走 node 解析。 */
function runProbe(root: string, opts: { stub?: string; trace?: boolean; node?: boolean } = {}) {
  const args = opts.trace ? ['-x', PHASE_HOOK, '--plain'] : [PHASE_HOOK, '--plain'];
  const r = spawnSync('bash', args, {
    cwd: root, encoding: 'utf-8',
    env: { ...process.env, PATH: [opts.stub, opts.node ? dirname(process.execPath) : '', BASE_PATH].filter(Boolean).join(':') },
  });
  const stdout = r.stdout ?? '';
  const m = stdout.match(/Current Phase: (.*)/);
  if (!m) throw new Error(`横幅缺 Current Phase：${stdout}\n${r.stderr}`);
  return { phase: m[1].trim(), stdout, stderr: r.stderr ?? '' };
}

/** 真实 CLI：读取指定模块的 phase.3-2-api。 */
function realApiState(root: string, mod: string) {
  expect(existsSync(CLI_ENTRY)).toBe(true);
  const r = spawnSync(process.execPath, [CLI_ENTRY, 'status', '--format', 'json'], {
    cwd: root, encoding: 'utf-8', env: { ...process.env },
  });
  const parsed = JSON.parse(r.stdout ?? '{}');
  const m = parsed?.data?.modules?.find((x: { id?: string }) => x?.id === mod);
  const st = m?.phase_progress?.['phase.3-2-api'];
  return { done: st?.done, skipped: st?.skipped };
}

/** 直接调用 check_scenarios_complete（只 source 函数定义段），取单调用点 missing。 */
function callCheck(root: string, dir: string, extPattern: string): string[] {
  const script = [
    'set +e',
    `eval "$(awk '/^get_scenario_ids\\(\\)/{f=1} /^CONFIG=/{f=0} f' ${JSON.stringify(PHASE_HOOK)})"`,
    `out=$(check_scenarios_complete ${JSON.stringify(dir)} ${JSON.stringify(extPattern)})`,
    'echo "MISSING:[$out]"',
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], { cwd: root, encoding: 'utf-8', env: { ...process.env, PATH: BASE_PATH } });
  if (/command not found/.test(r.stderr ?? '')) throw new Error(`函数未被 source：${r.stderr}`);
  const m = (r.stdout ?? '').match(/MISSING:\[(.*)\]/);
  if (!m) throw new Error(`check_scenarios_complete 未产出结果：${r.stdout}\n${r.stderr}`);
  return m[1].trim() ? m[1].trim().split(/\s+/) : [];
}

const API_STEP = 'Phase 3 Step 2: API & Database Design';

describe('S11 SessionStart 横幅 API 阶段按模块进度判定', () => {
  it('UT-S11-111: runlogos 形态——API 目录只有本模块按领域命名的文件时继续向下判定', () => {
    const { root } = multiProject({ scenarios: 104, teamTests: true });
    put(root, API_DIR, 'team-auth.yaml');
    put(root, API_DIR, 'team-requirements.yaml');
    const stub = stubBin(root, { kind: 'json', body: statusBody({ team: { done: true, skipped: false } }) });
    const { phase } = runProbe(root, { stub: stub.dir });
    expect(phase).not.toContain('missing');
    expect(phase.startsWith(API_STEP)).toBe(false);
    // 测试用例目录非空 → 空数据库目录按向后看兜底跳过；编排目录为空 → 确切到达 Step 3b
    expect(phase).toBe('Phase 3 Step 3b: Orchestration Tests');
  });

  it('UT-S11-112: 只有其他模块的 API 文件而 initial 模块仍需 API 时仍指向 API 阶段', () => {
    const { root } = multiProject({ scenarios: 4 });
    put(root, API_DIR, 'core-auth.yaml');
    // 桩取值与真实 CLI 一致：基础夹具上 team 的 phase.3-2-api 为未完成未跳过
    expect(realApiState(root, 'team')).toEqual({ done: false, skipped: false });

    const stub = stubBin(root, { kind: 'json', body: statusBody({ team: { done: false, skipped: false } }) });
    const base = runProbe(root, { stub: stub.dir });
    expect(base.phase).toBe(`${API_STEP} (modules: team)`);
    expect(base.phase).not.toContain('missing');
    // node 解析路径与 Python 解析路径结论一致
    expect(runProbe(root, { stub: stub.dir, node: true }).phase).toBe(`${API_STEP} (modules: team)`);

    // 另一臂：两个 initial 模块都未完成 → 按 id 升序
    const two = multiProject({ scenarios: 4, extraInitial: ['ops'] });
    put(two.root, API_DIR, 'core-auth.yaml');
    const stub2 = stubBin(two.root, {
      kind: 'json',
      body: statusBody({ team: { done: false, skipped: false }, ops: { done: false, skipped: false } }),
    });
    expect(runProbe(two.root, { stub: stub2.dir }).phase).toBe(`${API_STEP} (modules: ops team)`);
    expect(runProbe(two.root, { stub: stub2.dir, node: true }).phase).toBe(`${API_STEP} (modules: ops team)`);

    // 优先级臂：清空 API 目录 + 测试目录有文件 → shell 得出 SKIP_API=true，status 结论仍覆盖之
    clearDir(root, API_DIR);
    put(root, TEST_DIR, 'core-S01-test-cases.md');
    const prio = runProbe(root, { stub: stub.dir, trace: true });
    expect(prio.stderr).toMatch(/SKIP_API=true/);
    expect(prio.phase).toBe(`${API_STEP} (modules: team)`);
  });

  it('UT-S11-113: STATUS_JSON 不可用时降级为既有项目级判定且不输出逐场景 missing', () => {
    const forms: Array<[string, StubMode | null]> = [
      ['① PATH 无 openlogos', null],
      ['② 桩非零退出', { kind: 'fail' }],
      // code-r1 F1：stdout 已写出合法 JSON（且声称 team 的 API 已完成）后才非零退出，仍须视为不可用
      ['②b 桩输出合法 JSON 后非零退出', { kind: 'fail', body: statusBody({ team: { done: true, skipped: false } }) }],
      ['③a 非 JSON', { kind: 'raw', text: 'not json' }],
      ['③b data.modules 缺失', { kind: 'json', body: { data: { lifecycle: 'launched' } } }],
      ['③c initial 模块 phase_progress 为 null', { kind: 'json', body: statusBody({ team: null }) }],
    ];
    for (const [label, mode] of forms) {
      const { root } = multiProject({ scenarios: 4 });
      const stub = mode ? stubBin(root, mode).dir : undefined;

      // (a) API 目录只有 team-auth.yaml → 继续向下判定
      put(root, API_DIR, 'team-auth.yaml');
      const a = runProbe(root, { stub });
      expect(a.phase, label).not.toContain('missing');
      expect(a.phase.startsWith(API_STEP), label).toBe(false);

      // (b) API 目录为空、无后续阶段文件 → 不带后缀的 Step 2，且 shell 未命中 SKIP_API
      clearDir(root, API_DIR);
      const b = runProbe(root, { stub, trace: true });
      expect(b.phase, label).toBe(API_STEP);
      expect(b.stderr, label).not.toMatch(/SKIP_API=true/);

      // (c) 对照臂：编排目录放更后置产物 → 命中向后看兜底，继续到 Step 3a
      put(root, ORCH_DIR, 'team-refund-flow.json');
      const c = runProbe(root, { stub });
      expect(c.phase, label).toBe('Phase 3 Step 3a: Test Cases');
      expect(c.phase, label).not.toContain('missing');
      expect(runProbe(root, { stub, node: true }).phase, `${label}（node）`).toBe('Phase 3 Step 3a: Test Cases');
    }
  });

  it('UT-S11-114: API 目录为空且无后续阶段文件时仍报 Phase 3 Step 2（真空缺不被吞）', () => {
    const { root } = singleProject();
    const stub = stubBin(root, {
      kind: 'json',
      body: { data: { lifecycle: 'initial', modules: [{ id: 'core', lifecycle: 'initial', phase_progress: { 'phase.3-2-api': { done: false, skipped: false } } }] } },
    });
    expect(runProbe(root, { stub: stub.dir }).phase).toBe(`${API_STEP} (modules: core)`);
    expect(runProbe(root).phase).toBe(API_STEP);
  });

  it('UT-S11-115: 场景时序与测试用例两个逐场景调用点零回归；status 路径不新增 CLI 调用', () => {
    // 夹具 A：场景目录缺 S02/S04、测试目录缺 S01/S03
    const a = singleProjectWith({ scenarioMissing: ['S02', 'S04'], testMissing: ['S01', 'S03'] });
    expect(callCheck(a, SCEN_DIR, '*.md')).toEqual(['S02', 'S04']);
    expect(callCheck(a, TEST_DIR, '*.md')).toEqual(['S01', 'S03']);
    const stubA = stubBin(a, { kind: 'json', body: coreStatus(true) });
    expect(runProbe(a, { stub: stubA.dir }).phase).toBe('Phase 3 Step 1: Scenario Modeling (incomplete: missing S02 S04)');

    // 夹具 B：场景齐全、API 有本模块文件、测试缺 S01/S03 → 经过 API 分支到达测试用例调用点
    const b = singleProjectWith({ scenarioMissing: [], testMissing: ['S01', 'S03'], api: true });
    const stubB = stubBin(b, { kind: 'json', body: coreStatus(true) });
    expect(runProbe(b, { stub: stubB.dir }).phase).toBe('Phase 3 Step 3a: Test Cases (incomplete: missing S01 S03)');
    expect(stubB.calls()).toEqual(['status --format json']);
  });
});

function coreStatus(apiDone: boolean) {
  return { data: { lifecycle: 'initial', modules: [{ id: 'core', lifecycle: 'initial', phase_progress: { 'phase.3-2-api': { done: apiDone, skipped: false } } }] } };
}

/** 单模块四场景夹具：按需挖空场景目录 / 测试目录，可选写入按领域命名的 API 文件与数据库文件。 */
function singleProjectWith(o: { scenarioMissing: string[]; testMissing: string[]; api?: boolean }): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  const ids = ['S01', 'S02', 'S03', 'S04'];
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:', '  name: "phase-api-115"', '  description: ""',
    'modules:', '  - id: core', '    name: core', '    lifecycle: initial',
    'scenarios:', ...ids.flatMap(id => [`  - id: ${id}`, `    name: 场景 ${id}`, '    module: core']), '',
  ].join('\n'));
  put(root, 'logos/resources/prd/1-product-requirements', 'core-01-requirements.md');
  put(root, 'logos/resources/prd/2-product-design', 'core-02-design.md');
  put(root, 'logos/resources/prd/3-technical-plan/1-architecture', 'core-03-architecture.md');
  put(root, DB_DIR, 'core-schema.sql');
  for (const id of ids) {
    if (!o.scenarioMissing.includes(id)) put(root, SCEN_DIR, `core-${id}-flow.md`);
    if (!o.testMissing.includes(id)) put(root, TEST_DIR, `core-${id}-test-cases.md`);
  }
  if (o.api) put(root, API_DIR, 'core-auth.yaml');
  return root;
}
