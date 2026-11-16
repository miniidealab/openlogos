/**
 * slice-verify-efficient-mode 测试共用夹具（S13「切片 checkpoint owned 验收范围测试」夹具 SV、
 * S32「切片规划冻结验收范围测试」夹具 FZ）。
 *
 * 一次性临时项目：单模块 core（可选登记 team），已合并测试规格
 *   - `core-S01-test-cases.md`：基线用例（数量可调，可附 1 个 manual 用例）；
 *   - `core-S90-test-cases.md`：本提案变更用例 UT-S90-01～03（C）。
 * `SPEC_MERGED.test_change_set` 只把 S90 记为变更，故 S01 全部是基线 B。
 * 划分：`slice-a` 拥有 UT-S90-01、UT-S90-02；`slice-b` 拥有 UT-S90-03。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, takeExitCode, withCompleteClarification } from './helpers.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { next } from '../src/commands/next.js';
import { status } from '../src/commands/status.js';
import { verify } from '../src/commands/verify.js';
import { planSlices, SlicePlanError } from '../src/commands/slice.js';
import {
  TEST_SLICE_MANIFEST,
  appendSliceCheckpoint,
  computeSliceManifestIdentity,
  deriveSliceVerificationState,
  type SliceVerificationState,
  type TestSliceManifestV1,
} from '../src/lib/test-slice-manifest.js';

export const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_SCHEMA = resolve(CLI_ROOT, '..', 'spec', 'schema');
export const SLUG = 'scope-demo';
export const BASE_TARGET = 'logos/resources/test/core-S01-test-cases.md';
export const CHANGE_TARGET = 'logos/resources/test/core-S90-test-cases.md';
export const TEAM_TARGET = 'logos/resources/test/team-S60-test-cases.md';
export const CHANGED = ['UT-S90-01', 'UT-S90-02', 'UT-S90-03'];

export interface ScopeFixture {
  root: string;
  dir: string;
  tasksPath: string;
  manifestPath: string;
  ledgerPath: string;
  baseline: string[];
}

export interface FixtureOptions {
  /** 基线用例 ID；缺省为 UT-S01-01～03 + ST-S01-01。 */
  baseline?: string[];
  /** 是否在基线规格中附 1 个 `[manual]` 用例。 */
  manual?: boolean;
  /** 写入 logos.config.json 的 verify 片段（合并）。 */
  verify?: Record<string, unknown>;
  /** 同时登记 team 模块（initial，paths team/**）并定义 UT-S60-01。 */
  team?: boolean;
}

export function baselineIds(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `UT-S01-${String(i + 1).padStart(2, '0')}`);
}

function table(ids: string[], manual = false): string {
  return ['| ID | 用例 |', '|---|---|',
    ...ids.map(id => `| ${id} | ${id} fixture |`),
    ...(manual ? ['| UT-S01-9999 [manual] | 人工用例 |'] : []),
  ].join('\n') + '\n';
}

export function writeBaseline(f: ScopeFixture, ids: string[], manual = false): void {
  writeFileSync(join(f.root, BASE_TARGET), table(ids, manual));
  f.baseline = ids;
}

export function setVerifyConfig(root: string, patch: Record<string, unknown>): void {
  const path = join(root, 'logos', 'logos.config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.verify = { ...config.verify, ...patch };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete config.verify[key];
  writeFileSync(path, JSON.stringify(config, null, 2));
}

export function createScopeFixture(options: FixtureOptions = {}): { fixture: ScopeFixture; cleanup: () => void } {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:', '  name: t', 'modules:',
    '  - id: core', '    name: Core', '    lifecycle: launched',
    ...(options.team ? [
      '    paths:', '      - "src/**"',
      '  - id: team', '    name: Team', '    lifecycle: initial', '    paths:', '      - "team/**"',
    ] : []),
  ].join('\n') + '\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  const dir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(dir, { recursive: true });
  const baseline = options.baseline ?? ['ST-S01-01', 'UT-S01-01', 'UT-S01-02', 'UT-S01-03'];
  writeFileSync(join(root, BASE_TARGET), table(baseline, options.manual));
  const changeTable = table(CHANGED);
  writeFileSync(join(root, CHANGE_TARGET), changeTable);
  if (options.team) writeFileSync(join(root, TEAM_TARGET), table(['UT-S60-01']));
  writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
    `# 变更提案：${SLUG}`, '',
    '## 变更原因', '验证切片验收范围。', '',
    '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '冻结验收范围。',
  ].join('\n')));
  const tasksPath = join(dir, 'tasks.md');
  writeFileSync(tasksPath, [
    '# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '',
    '## [code] 代码实现', '（本段在 plan 段留空。）', '',
  ].join('\n'));
  writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'baseline_closure_spec_complete',
    test_change_set: buildTestChangeSet({
      change: SLUG, module: 'core',
      targets: [{ targetPath: CHANGE_TARGET, beforeBytes: null, afterBytes: Buffer.from(changeTable) }],
    }),
  }, null, 2)}\n`);
  writeFileSync(join(dir, 'SLICES_APPROVED'), '');
  if (options.verify) setVerifyConfig(root, options.verify);
  return {
    fixture: {
      root, dir, tasksPath,
      manifestPath: join(dir, TEST_SLICE_MANIFEST),
      ledgerPath: join(dir, 'SLICE_CHECKPOINTS.jsonl'),
      baseline,
    },
    cleanup,
  };
}

/** 划分 v1：slice-a {01,02}，slice-b {03}；v2：把 UT-S90-02 移到 slice-b（划分改变）。 */
export function slicesInput(version: 1 | 2 = 1) {
  const a = version === 1 ? ['UT-S90-01', 'UT-S90-02'] : ['UT-S90-01'];
  const b = version === 1 ? ['UT-S90-03'] : ['UT-S90-02', 'UT-S90-03'];
  return [
    { slice_id: 'slice-a', task_text: `切片1：能力 a（覆盖 ${a.join('、')}）`, owned_test_ids: a, runner_selectors: a, spec_targets: [CHANGE_TARGET] },
    { slice_id: 'slice-b', task_text: `切片2：能力 b（覆盖 ${b.join('、')}）`, owned_test_ids: b, runner_selectors: b, spec_targets: [CHANGE_TARGET] },
  ];
}

export function writeSlicesFile(f: ScopeFixture, version: 1 | 2 = 1): string {
  const path = join(f.dir, version === 1 ? 'slices.json' : 'slices-v2.json');
  writeFileSync(path, JSON.stringify({ slices: slicesInput(version) }, null, 2));
  return path;
}

export function plan(f: ScopeFixture, version: 1 | 2 = 1) {
  return planSlices(f.root, writeSlicesFile(f, version));
}

export function catchPlan(f: ScopeFixture, version: 1 | 2 = 1): SlicePlanError {
  try {
    plan(f, version);
  } catch (error) {
    if (error instanceof SlicePlanError) return error;
    throw error;
  }
  throw new Error('期望 slice plan 拒绝，但它成功返回');
}

export function state(f: ScopeFixture): SliceVerificationState {
  return deriveSliceVerificationState(f.root, f.dir, { change: SLUG, module: 'core' })!;
}

export function readManifest(f: ScopeFixture): TestSliceManifestV1 {
  return JSON.parse(readFileSync(f.manifestPath, 'utf8')) as TestSliceManifestV1;
}

export function writeManifestRaw(f: ScopeFixture, value: unknown): void {
  writeFileSync(f.manifestPath, `${JSON.stringify(value, null, 2)}\n`);
}

/** 当前在盘 manifest 在读取侧的判定实质身份（与 verify 采信同一函数）。 */
export function currentIdentity(f: ScopeFixture): string {
  return computeSliceManifestIdentity(state(f).manifest_data!);
}

/** 为当前 attempted slice 追加一行身份匹配的 PASS checkpoint（「切片一已通过」）。 */
export function passCurrentSlice(f: ScopeFixture): void {
  const current = state(f);
  if (!appendSliceCheckpoint(f.dir, current, 'PASS', '2026-11-16T00:00:00.000Z')) {
    throw new Error('夹具：追加 PASS checkpoint 失败');
  }
}

export function checkCodeTasks(f: ScopeFixture, count = 2): void {
  let content = readFileSync(f.tasksPath, 'utf8');
  for (let i = 0; i < count; i++) content = content.replace(/^- \[ \] (切片)/m, '- [x] $1');
  writeFileSync(f.tasksPath, content);
}

export function writeResults(root: string, rows: Array<{ id: string; status: 'pass' | 'fail'; error?: string }>): void {
  writeFileSync(join(root, 'logos', 'resources', 'verify', 'test-results.jsonl'),
    `${rows.map(row => JSON.stringify(row)).join('\n')}\n`);
}

export function passAll(ids: string[]) {
  return ids.map(id => ({ id, status: 'pass' as const }));
}

export function runStatusJson(root: string): any {
  const restore = mockCwd(root); const cap = captureConsole(); const exit = mockProcessExit();
  try { status('json'); } finally { exit.mockRestore(); cap.restore(); restore(); }
  return JSON.parse(cap.logs.at(-1)!).data;
}

export async function runNextJson(root: string): Promise<any> {
  const restore = mockCwd(root); const cap = captureConsole(); const exit = mockProcessExit();
  try { await next('json', undefined, false); } finally { exit.mockRestore(); cap.restore(); restore(); }
  return JSON.parse(cap.logs.at(-1)!).data;
}

export function runVerifyJson(root: string): { data: any; exited: boolean } {
  const restore = mockCwd(root); const cap = captureConsole(); const exit = mockProcessExit();
  let exited = false;
  try { verify('json'); } catch { exited = true; }
  finally { exit.mockRestore(); cap.restore(); restore(); }
  const code = takeExitCode();
  if (code !== undefined && code !== 0) exited = true;
  const envelope = [...cap.logs, ...cap.errors].map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).find(item => item?.command === 'verify');
  return { data: envelope?.data, exited };
}

/** 真实 CLI（构建产物 dist/index.js）。 */
export function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args], { cwd, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function cliJson(cwd: string, ...args: string[]): { status: number | null; json: any } {
  const r = cli(cwd, ...args, '--format', 'json');
  const line = [...r.stdout.split('\n'), ...r.stderr.split('\n')].reverse()
    .find(item => item.trim().startsWith('{'));
  return { status: r.status, json: line ? JSON.parse(line) : null };
}

/** 磁盘事实：字节哈希 + mtime（「零改写」只认磁盘，不认命令自述）。 */
export function fileState(path: string): { sha: string; mtimeMs: number } | null {
  if (!existsSync(path)) return null;
  return { sha: createHash('sha256').update(readFileSync(path)).digest('hex'), mtimeMs: statSync(path).mtimeMs };
}

export function tempLeftovers(dir: string): string[] {
  return readdirSync(dir).filter(name => name.endsWith('.tmp'));
}
