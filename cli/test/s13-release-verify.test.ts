/**
 * layered-verification 切片 4：发布级全量验收（openlogos verify --release）与发布级结论的查询（--release --check）。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 分层验收测试」严格对齐：
 * UT-S13-248、252～268、273、274，ST-S13-50、51。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 夹具 LV-rel：夹具 LV 去掉活跃提案，全部内容已提交、工作区干净（8 条自动化用例）。入口剧本与调用记录在项目外；
 * 断言「入口被调用几次」「收到的清单」「实际执行了哪些用例」一律读调用记录。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { registerSchema, validate } from '@hyperjump/json-schema/draft-2020-12';
import { spawnSync } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { planSlices } from '../src/commands/slice.js';
import { isModuleReportComplete } from '../src/lib/module-phase-report.js';
import {
  ALL_DEFAULT, P_DEFAULT, RESULTS, SLUG,
  commitAll, createLv, destroyLv, git, lvEnv, mainPathSection, put, readCalls, runVerify, setScript, table,
} from './golden/s13-layered-fixture.mjs';

vi.setConfig({ testTimeout: 240_000 });

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const REPO = resolve(CLI_ROOT, '..');
const REL_ALL = ['UT-S01-01', 'UT-S01-02', 'UT-S01-03', 'UT-S02-01', 'UT-S02-02', 'UT-S03-01', 'UT-S03-02', 'UT-S04-02'];
const RELEASE_REPORT = 'logos/resources/verify/release/acceptance-report.md';
const SHARED_REPORT = 'logos/resources/verify/acceptance-report.md';
const HISTORY_DIR = 'logos/resources/verify/history';
const PLATFORM = `${process.platform}-${process.arch}`;

let schemaId = '';
beforeAll(() => {
  const schema = JSON.parse(readFileSync(join(REPO, 'spec/schema/verify.schema.json'), 'utf8'));
  expect(schema.properties.release).toBeDefined();
  schemaId = schema.$id;
  try { registerSchema(schema); } catch { /* 同一 worker 内已注册 */ }
});

type Lv = ReturnType<typeof createLv>;
const made: Lv[] = [];
afterEach(() => { while (made.length) destroyLv(made.pop()!); });
function lv(opts: Record<string, unknown> = {}): Lv {
  const f = createLv({ buildTestChangeSet, ...opts });
  made.push(f);
  return f;
}
const rel = (opts: Record<string, unknown> = {}): Lv => lv({ rel: true, ...opts });

/**
 * 把夹具项目搬进另一个 git 仓库的子目录 apps/service/（项目根不是仓库根），仓库根另有一个与项目内同名的
 * logos/resources/verify/ 目录；全部提交、工作区干净。返回的夹具以子目录为项目根。
 */
const outers: string[] = [];
afterEach(() => { while (outers.length) rmSync(outers.pop()!, { recursive: true, force: true }); });
function relInSubdirectory(opts: Record<string, unknown> = {}): { f: Lv; outer: string } {
  const f = rel(opts);
  rmSync(join(f.root, '.git'), { recursive: true, force: true });
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-lv-outer-')));
  outers.push(outer);
  mkdirSync(join(outer, 'apps'), { recursive: true });
  renameSync(f.root, join(outer, 'apps', 'service'));
  f.root = join(outer, 'apps', 'service');
  put(outer, 'logos/resources/verify/outside.md', 'outside the project\n');
  put(outer, 'README.md', 'outer repository\n');
  git(outer, ['init', '-q']);
  git(outer, ['add', '-A']);
  git(outer, ['commit', '-qm', 'outer']);
  return { f, outer };
}

function parseErr(stderr: string): any {
  const line = stderr.split('\n').reverse().find(l => l.trim().startsWith('{'));
  try { return line ? JSON.parse(line).error : null; } catch { return null; }
}
function release(f: Lv, env: Record<string, string | undefined> = {}) {
  const run = runVerify(CLI, f, { args: ['--release', '--format', 'json'], env });
  return { ...run, error: parseErr(run.stderr) };
}
function cli(f: Lv, args: string[], env: Record<string, string | undefined> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: f.root, encoding: 'utf8', env: lvEnv(f, env), timeout: 120_000 });
  const line = (r.stdout ?? '').split('\n').reverse().find(l => l.trim().startsWith('{'));
  let data: any = null;
  try { data = line ? JSON.parse(line).data : null; } catch { /* 文本模式 */ }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', data, error: parseErr(r.stderr ?? '') };
}
const check = (f: Lv, args: string[] = []) => cli(f, ['verify', '--release', '--check', ...args, '--format', 'json']);
const head = (f: Lv): string => git(f.root, ['rev-parse', 'HEAD']);
const historyFiles = (f: Lv): string[] => existsSync(join(f.root, HISTORY_DIR)) ? readdirSync(join(f.root, HISTORY_DIR)).filter(n => n.endsWith('.json')).sort() : [];
const historyRecords = (f: Lv): any[] => historyFiles(f).map(n => JSON.parse(readFileSync(join(f.root, HISTORY_DIR, n), 'utf8')));
const read = (f: Lv, relPath: string): string => readFileSync(join(f.root, relPath), 'utf8');

/** 目录下全部文件的 路径 → 内容 快照（用于断言「字节不变」）。 */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), relPath);
      else out[relPath] = readFileSync(join(current, entry.name), 'utf8');
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out;
}

describe('S13 发布级验收 — 前置条件', () => {
  it('UT-S13-252: 发布级：不是 git 仓库时拒绝', () => {
    const noGit = rel({ git: false });
    const fresh = rel({ git: false });
    spawnSync('git', ['init', '-q'], { cwd: fresh.root });
    for (const f of [noGit, fresh]) {
      put(f.root, RESULTS, 'PRESET\n');
      const run = release(f);
      expect(run.status).toBe(2);
      expect(run.error.code).toBe('RELEASE_VERIFY_NOT_GIT');
      expect(run.calls).toHaveLength(0);
      expect(read(f, RESULTS)).toBe('PRESET\n');
      expect(historyFiles(f)).toEqual([]);
      expect(existsSync(join(f.root, RELEASE_REPORT))).toBe(false);
    }
  });

  it('UT-S13-253: 发布级：工作区不干净时拒绝', () => {
    const tracked = rel();
    put(tracked.root, 'src/core.ts', 'export const core = 2;\n');
    const a = release(tracked);
    expect(a.status).toBe(2);
    expect(a.error.code).toBe('RELEASE_VERIFY_DIRTY');
    expect(a.error.details.paths).toEqual(['src/core.ts']);
    expect(a.error.details.total).toBe(1);
    expect(a.calls).toHaveLength(0);
    expect(historyFiles(tracked)).toEqual([]);

    const untracked = rel();
    put(untracked.root, 'src/new-file.ts', 'export {};\n');
    const b = release(untracked);
    expect(b.status).toBe(2);
    expect(b.error.code).toBe('RELEASE_VERIFY_DIRTY');
    expect(b.error.details.paths).toEqual(['src/new-file.ts']);
    expect(b.calls).toHaveLength(0);

    // 暂存了改动、工作区又改回原样：HEAD 与工作区没有净差异，但 git status 有条目（code-r1 F4）
    const staged = rel();
    const original = read(staged, 'src/core.ts');
    put(staged.root, 'src/core.ts', `${original}// staged\n`);
    git(staged.root, ['add', 'src/core.ts']);
    put(staged.root, 'src/core.ts', original);
    expect(git(staged.root, ['diff', '--name-only', 'HEAD'])).toBe('');
    const s = release(staged);
    expect(s.status).toBe(2);
    expect(s.error.code).toBe('RELEASE_VERIFY_DIRTY');
    expect(s.error.details.paths).toEqual(['src/core.ts']);
    expect(s.calls).toHaveLength(0);
    expect(historyFiles(staged)).toEqual([]);
    // 重命名：新旧两端都列出
    const renamed = rel();
    git(renamed.root, ['mv', 'src/core.ts', 'src/core-renamed.ts']);
    expect(release(renamed).error.details.paths).toEqual(['src/core-renamed.ts', 'src/core.ts']);

    // details.paths 至多 20 条，total 给出总数
    const many = rel();
    for (let i = 0; i < 25; i += 1) put(many.root, `src/extra-${String(i).padStart(2, '0')}.ts`, 'export {};\n');
    const c = release(many);
    expect(c.error.details.paths).toHaveLength(20);
    expect(c.error.details.total).toBe(25);

    // 只改动 lifecycle 路径不算不干净
    const lifecycle = rel();
    put(lifecycle.root, 'logos/resources/verify/notes.txt', 'lifecycle only\n');
    const d = release(lifecycle);
    expect(d.status).toBe(0);
    expect(d.data.gate.result).toBe('PASS');
    expect(d.calls).toHaveLength(1);

    // 项目位于仓库子目录（code-r2 F4）：按项目前缀分类——本项目的验收产物允许变化，项目外的同名目录变化须拒绝
    const sub = relInSubdirectory();
    put(sub.f.root, 'logos/resources/verify/notes.txt', 'lifecycle inside the project\n');
    const inside = release(sub.f);
    expect(inside.status, inside.stderr).toBe(0);
    expect(inside.calls).toHaveLength(1);
    // 收尾复核使用同一分类：本次写出的结果文件、历史与发布级报告都在项目内的 lifecycle 路径下，不算不干净
    expect(inside.data.release).toMatchObject({ commit_unchanged: true, worktree_clean: true });
    expect(inside.data.gate.result).toBe('PASS');
    expect(git(sub.outer, ['status', '--porcelain']).length).toBeGreaterThan(0);

    const outside = relInSubdirectory();
    put(outside.outer, 'logos/resources/verify/outside.md', 'changed outside the project\n');
    const refused = release(outside.f);
    expect(refused.status).toBe(2);
    expect(refused.error.code).toBe('RELEASE_VERIFY_DIRTY');
    expect(refused.error.details.paths).toEqual(['logos/resources/verify/outside.md']);
    expect(refused.calls).toHaveLength(0);
    // 项目内的源码改动照常拒绝，路径按仓库根相对给出
    const source = relInSubdirectory();
    put(source.f.root, 'src/core.ts', 'export const core = 9;\n');
    expect(release(source.f).error.details.paths).toEqual(['apps/service/src/core.ts']);
  });

  it('UT-S13-254: 发布级：没有测试命令时拒绝，旧结果不能充当证据', () => {
    const f = rel({ verify: { pre_run_command: undefined } });
    const preset = `${REL_ALL.map(id => JSON.stringify({ id, status: 'pass' })).join('\n')}\n`;
    put(f.root, RESULTS, preset);
    const run = release(f);
    expect(run.status).toBe(2);
    expect(run.error.code).toBe('RELEASE_VERIFY_NO_COMMAND');
    expect(read(f, RESULTS)).toBe(preset);
    expect(historyFiles(f)).toEqual([]);
    expect(run.calls).toHaveLength(0);
    const query = check(f);
    expect(query.status).toBe(1);
    expect(query.data).toMatchObject({ valid: false, reason: 'no_conclusive_run', latest: null });
  });

  it('UT-S13-268: 发布级参数的用法检查', () => {
    const f = rel();
    const sha = head(f);
    for (const args of [['verify', '--check'], ['verify', '--commit', sha], ['verify', '--release', '--commit', sha]]) {
      const r = cli(f, [...args, '--format', 'json']);
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.error.code, args.join(' ')).toBe('INVALID_ARGUMENT');
      expect(readCalls(f), args.join(' ')).toEqual([]);
      expect(historyFiles(f), args.join(' ')).toEqual([]);
    }
  });
});

describe('S13 发布级验收 — 执行范围与产物', () => {
  it('UT-S13-255: 发布级恒为全量', async () => {
    // ① 分层开启且主链路超限：发布级不读取分层开关、不检查主链路约束
    const layered = rel({
      layered: { enabled: true, main_path_max: 1 },
      docs: { 'core-S03-test-cases.md': table(['UT-S03-01', 'UT-S03-02']) + mainPathSection(['UT-S03-01', 'UT-S03-02']) },
    });
    const a = release(layered, { OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS: '["UT-S01-01"]', OPENLOGOS_VERIFY_SLICE_SCOPE: 'owned' });
    expect(a.status).toBe(0);
    expect(a.calls).toHaveLength(1);
    expect(a.calls[0].eligible).toBeNull();
    expect(a.calls[0].slice_scope).toBeNull();
    expect(a.calls[0].executed).toEqual(REL_ALL);
    // ② 多模块（提案仍在，全部提交且干净）：全部命令组
    const mod = lv({ mod: true, commitAll: true });
    const b = release(mod);
    expect(b.status).toBe(0);
    expect(b.calls.map(c => c.runner)).toEqual(['core', 'backend', 'web']);
    for (const call of b.calls) { expect(call.eligible).toBeNull(); expect(call.slice_scope).toBeNull(); }
    expect(b.data.summary.defined_count).toBe(10);
    // ③ 活跃提案处于 slice-checkpoint（全部提交且干净）：不进入切片模式
    const a1 = ['UT-S90-01', 'UT-S90-02'];
    const b1 = ['UT-S90-03'];
    const sliced = lv({
      change: { target: 'core-S90-test-cases.md', added: [...a1, ...b1] },
      tasks: ['# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '', '## [code] 代码实现',
        `- [ ] 切片1：能力 a（覆盖 ${a1.join('、')}）`, `- [ ] 切片2：能力 b（覆盖 ${b1.join('、')}）`, ''].join('\n'),
    });
    writeFileSync(join(sliced.proposalDir!, 'SLICES_APPROVED'), '');
    const target = 'logos/resources/test/core-S90-test-cases.md';
    const slicesFile = join(sliced.proposalDir!, 'slices.json');
    writeFileSync(slicesFile, JSON.stringify({ slices: [
      { slice_id: 'slice-a', task_text: `切片1：能力 a（覆盖 ${a1.join('、')}）`, owned_test_ids: a1, runner_selectors: a1, spec_targets: [target] },
      { slice_id: 'slice-b', task_text: `切片2：能力 b（覆盖 ${b1.join('、')}）`, owned_test_ids: b1, runner_selectors: b1, spec_targets: [target] },
    ] }, null, 2));
    planSlices(sliced.root, slicesFile);
    commitAll(sliced, 'proposal with slices');
    const c = release(sliced);
    expect(c.status).toBe(0);
    expect(c.calls[0].eligible).toBeNull();
    expect(c.calls[0].slice_scope).toBeNull();
    expect(c.calls[0].executed).toEqual([...REL_ALL, ...a1, ...b1].sort());
    expect(existsSync(join(sliced.proposalDir!, 'SLICE_CHECKPOINTS.jsonl'))).toBe(false);
    // ④ 单模块项目只配置了模块命令（code-r1 F1）：发布级同样应用模块覆盖并实际执行；磁盘上的旧全绿账本不能充当证据
    const onlyModuleCommand = {
      pre_run_command: undefined, rerun_failed: { enabled: false },
      modules: { core: { pre_run_command: 'node tools/lv-runner.mjs core' } },
    };
    const single = rel({ verify: onlyModuleCommand, script: { cases: { 'UT-S02-01': 'fail' } } });
    put(single.root, RESULTS, `${REL_ALL.map(id => JSON.stringify({ id, status: 'pass' })).join('\n')}\n`);
    const d = release(single);
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0].runner).toBe('core');
    expect(d.calls[0].executed).toEqual(REL_ALL);
    expect(d.status).toBe(1);
    expect(d.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(historyRecords(single)[0]).toMatchObject({ level: 'release', result_source: 'executed' });
    // 缺少该模块声明的环境要求：零调用
    const gated = rel({ verify: { ...onlyModuleCommand, modules: { core: { ...onlyModuleCommand.modules.core, requirements: { env: ['LV_CORE_TOKEN'] } } } } });
    const e = release(gated);
    expect(e.data.gate).toEqual({ result: 'FAIL', reason: 'verify_env_not_ready' });
    expect(e.calls).toHaveLength(0);
    for (const run of [a, b, c]) {
      expect(run.data.level).toBe('release');
      expect(run.data.gate.result).toBe('PASS');
      for (const key of ['layers', 'verify_mode', 'attempted_slice_id', 'eligible_test_ids', 'pending_test_ids', 'manifest', 'checkpoint', 'test_change_set', 'scope', 'automation_diagnostic']) {
        expect(run.data, key).not.toHaveProperty(key);
      }
      expect(run.data.history).toMatchObject({ run_dir: null, raw_location: 'none' });
      const output = await validate(schemaId, run.data);
      expect(output.valid).toBe(true);
    }
  });

  it('UT-S13-256: 发布级不触碰提案标记与提案级报告', () => {
    const f = lv({
      changes: {
        [`logos/changes/${SLUG}/VERIFY_PASS`]: '',
        [`logos/changes/${SLUG}/SLICE_CHECKPOINTS.jsonl`]: '{"slice_id":"slice-a","result":"PASS"}\n',
        [`logos/changes/${SLUG}/LOOP_ITERS`]: '{"iter":1}\n',
        [SHARED_REPORT]: '# Acceptance Report\n\nproposal-level report sentinel\n',
      },
      commitAll: true,
    });
    const before = snapshot(f.proposalDir!);
    const reportBefore = read(f, SHARED_REPORT);
    const pass = release(f);
    expect(pass.status).toBe(0);
    setScript(f, { mode: 'narrow', cases: { 'UT-S02-01': 'fail' } });
    const fail = release(f);
    expect(fail.status).toBe(1);
    expect(fail.data.gate.reason).toBe('failed_cases');
    expect(snapshot(f.proposalDir!)).toEqual(before);
    expect(read(f, SHARED_REPORT)).toBe(reportBefore);
    expect(existsSync(join(f.proposalDir!, 'verify-runs'))).toBe(false);
    expect(existsSync(join(f.proposalDir!, 'VERIFY_FAIL'))).toBe(false);
    expect(existsSync(join(f.proposalDir!, 'VERIFY_PASS'))).toBe(true);
    expect(historyRecords(f).map(r => r.proposal)).toEqual([null, null]);

    // 沙箱开启且测试入口在副本里生成了共用验收报告（code-r1 F5）：发布级不把它写回工作区
    const sandboxed = lv({
      verify: { sandbox_mode: 'auto', sandbox_root: realpathSync(tmpdir()), sandbox_deny_workspace_write: true },
      changes: { [SHARED_REPORT]: '# Acceptance Report\n\nproposal-level report sentinel\n', [`logos/changes/${SLUG}/VERIFY_PASS`]: '' },
      commitAll: true,
      script: { writeShared: true },
    });
    const sharedPath = join(sandboxed.root, SHARED_REPORT);
    const identity = statSync(sharedPath);
    const run = release(sandboxed);
    expect(run.data.sandbox.isolated, JSON.stringify(run.data.sandbox)).toBe(true);
    expect(run.status).toBe(0);
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0].cwd).not.toBe(sandboxed.root); // 入口确实在副本里执行并生成了共用报告
    expect(read(sandboxed, SHARED_REPORT)).toBe('# Acceptance Report\n\nproposal-level report sentinel\n');
    expect(statSync(sharedPath).ino).toBe(identity.ino);
    expect(statSync(sharedPath).mtimeMs).toBe(identity.mtimeMs);
    expect(read(sandboxed, RELEASE_REPORT)).toContain('发布级（全量）');

    // 结果路径配置成共用验收报告（code-r2 F5）：发布级按保留路径处理——不启动命令、不清空也不覆盖提案级报告
    const sentinel = '# Acceptance Report\n\nproposal-level report sentinel\n';
    const VARIANT = 'logos/resources/verify/Acceptance-Report.md';
    const ALIAS = 'logos/resources/verify/alias-results.jsonl';
    const collisions: Array<[string, Record<string, unknown>, ((g: Lv) => void)?]> = [
      ['最终结果路径', { result_path: SHARED_REPORT }],
      // code-r3 F5：不同的路径文本指向同一份既有报告——硬链接（任何卷上都成立）与仅大小写不同的拼写（不区分大小写的卷上成立）
      ['硬链接', { result_path: ALIAS }, g => { linkSync(join(g.root, SHARED_REPORT), join(g.root, ALIAS)); }],
      ['仅大小写不同的拼写', { result_path: VARIANT }],
      ['阶段结果路径用另一种拼写', {
        pre_run_command: undefined,
        regression_command: 'node tools/lv-runner.mjs project', incremental_command: 'node tools/lv-runner.mjs project',
        incremental_result_path: VARIANT,
      }],
      ['阶段结果路径', {
        pre_run_command: undefined,
        regression_command: 'node tools/lv-runner.mjs project', incremental_command: 'node tools/lv-runner.mjs project',
        regression_result_path: SHARED_REPORT,
      }],
      ['模块命令组', { result_path: SHARED_REPORT, pre_run_command: undefined, modules: { core: { pre_run_command: 'node tools/lv-runner.mjs core' } } }],
    ];
    let variantArms = 0;
    for (const [name, verifyConfig, setup] of collisions) {
      const g = rel({ verify: verifyConfig, changes: { [SHARED_REPORT]: sentinel }, commitAll: true });
      const path = join(g.root, SHARED_REPORT);
      setup?.(g);
      // 仅大小写不同的拼写只在两种拼写指向同一份文件的卷上构成冲突；区分大小写的卷上它是另一个文件，本臂不适用
      if (name.includes('拼写')) {
        const sameFile = existsSync(join(g.root, VARIANT)) && statSync(join(g.root, VARIANT)).ino === statSync(path).ino;
        if (!sameFile) continue;
        variantArms += 1;
      }
      const before = statSync(path);
      const blocked = release(g);
      expect(blocked.calls, name).toHaveLength(0);
      expect(blocked.data.gate, name).toEqual({ result: 'FAIL', reason: 'pre_run_failed' });
      // 诊断点名配置中的原路径（可以是另一种拼写或别名）
      const configured = String(verifyConfig.result_path ?? verifyConfig.regression_result_path ?? verifyConfig.incremental_result_path);
      expect(blocked.data.pre_run.diagnostics.some((line: string) => line.includes(configured)), `${name}: ${JSON.stringify(blocked.data.pre_run.diagnostics)}`).toBe(true);
      expect(read(g, SHARED_REPORT), name).toBe(sentinel);
      expect(statSync(path).ino, name).toBe(before.ino);
      expect(statSync(path).mtimeMs, name).toBe(before.mtimeMs);
      expect(check(g).data, name).toMatchObject({ valid: false });
    }
    // 本机（darwin 缺省卷不区分大小写）上两条拼写臂都必须实际执行，不得静默跳过
    if (process.platform === 'darwin' && existsSync(join(CLI_ROOT, 'PACKAGE.JSON'))) expect(variantArms).toBe(2);
  });

  it('UT-S13-257: 发布级报告与 JSON', async () => {
    const f = rel({ script: { cases: { 'UT-S02-01': 'fail' } } });
    const sha = head(f);
    const run = release(f);
    expect(run.status).toBe(1);
    expect(run.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(run.data.level).toBe('release');
    expect(run.data.release).toEqual({ commit: sha, platform: PLATFORM, commit_unchanged: true, worktree_clean: true, head_at_finish: sha });
    expect(run.data.report_path).toBe(RELEASE_REPORT);
    const report = read(f, RELEASE_REPORT);
    expect(report).toContain('| 级别 / Level | 发布级（全量）/ release (full) |');
    expect(report).toContain(`| 提交 / Commit | ${sha} |`);
    expect(report).toContain(`| 平台 / Platform | ${PLATFORM} |`);
    expect(report).toContain('UT-S02-01');
    expect(report).toContain('**FAIL**');
    expect(report).not.toContain('LV-RUNNER-OUTPUT');
    expect(existsSync(join(f.root, SHARED_REPORT))).toBe(false);
    const output = await validate(schemaId, run.data);
    expect(output.valid).toBe(true);
  });

  it('UT-S13-258: 发布级的历史记录', () => {
    const f = rel();
    const sha = head(f);
    const run = release(f);
    expect(run.status).toBe(0);
    const records = historyRecords(f);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: 'verify', level: 'release', platform: PLATFORM, proposal: null, raw_location: 'none', verify_mode: null,
      module_scope: null, result_source: 'executed', outcome: 'completed', commit: { head: sha, dirty: false },
      gate: { result: 'PASS', reason: null },
    });
    expect(records[0].counts.defined).toBe(8);
    expect(run.data.history.run_id).toBe(records[0].run_id);
  });

  it('UT-S13-265: 发布级报告与 release 模块的验收报告互不覆盖', () => {
    const f = rel({
      extraInitialModule: 'release',
      docs: { 'release-S08-test-cases.md': table(['UT-S08-01']) },
    });
    const moduleReport = 'logos/resources/verify/release-acceptance-report.md';
    // 先以提案级 verify 生成 release 模块的验收报告（PASS）
    expect(runVerify(CLI, f).status).toBe(0);
    expect(isModuleReportComplete(f.root, 'release', 'acceptance')).toBe(true);
    const moduleBytes = read(f, moduleReport);
    expect(moduleBytes).toContain('| Module | release |');
    const rows = (text: string) => text.split('\n').filter(l => l.startsWith('| Module |') || l.includes('**Gate 3.5**'));

    const first = release(f);
    expect(first.status).toBe(0);
    expect(read(f, moduleReport)).toBe(moduleBytes);
    expect(read(f, RELEASE_REPORT)).toContain('发布级（全量）');
    const releaseBytes = read(f, RELEASE_REPORT);

    expect(runVerify(CLI, f).status).toBe(0);
    expect(read(f, RELEASE_REPORT)).toBe(releaseBytes);
    expect(rows(read(f, moduleReport))).toEqual(rows(moduleBytes));

    const moduleAfterVerify = read(f, moduleReport);
    // 发布级 FAIL 也不改动模块验收报告，模块报告完成判定不受影响
    setScript(f, { mode: 'narrow', cases: { 'UT-S08-01': 'fail' } });
    const second = release(f);
    expect(second.status).toBe(1);
    expect(read(f, moduleReport)).toBe(moduleAfterVerify);
    expect(isModuleReportComplete(f.root, 'release', 'acceptance')).toBe(true);
    expect(existsSync(join(f.root, RELEASE_REPORT))).toBe(true);
    expect(existsSync(join(f.root, moduleReport))).toBe(true);
  });

  it('UT-S13-266: 结果路径落在发布级报告路径上', () => {
    // 没有预跑命令：改写到默认结果路径并提示
    const f = rel({ verify: { result_path: RELEASE_REPORT, pre_run_command: undefined } });
    put(f.root, RESULTS, `${REL_ALL.map(id => JSON.stringify({ id, status: 'pass' })).join('\n')}\n`);
    const run = runVerify(CLI, f);
    expect(run.data.gate.result).toBe('PASS');
    expect(run.data.pre_run.diagnostics.some((d: string) => d.includes('verify.result_path') && d.includes(RELEASE_REPORT))).toBe(true);
    expect(existsSync(join(f.root, RELEASE_REPORT))).toBe(false);
    // 配置了预跑命令：按既有保留路径规则不调用入口（入口会按原配置写到保留路径）
    const g = rel({ verify: { result_path: RELEASE_REPORT } });
    const blocked = runVerify(CLI, g);
    expect(blocked.calls).toHaveLength(0);
    expect(blocked.data.gate).toEqual({ result: 'FAIL', reason: 'pre_run_failed' });
    expect(blocked.data.pre_run.diagnostics.some((d: string) => d.includes(RELEASE_REPORT))).toBe(true);
    expect(existsSync(join(g.root, RELEASE_REPORT))).toBe(false);
  });

  it('UT-S13-267: 发布级沿用失败复跑', () => {
    const f = rel({ script: { cases: { 'UT-S03-01': ['fail', 'pass'] } } });
    const run = release(f);
    expect(run.calls).toHaveLength(2);
    expect(run.calls[1].rerun).toBe('1');
    expect(run.data.gate).toEqual({ result: 'PASS', reason: null });
    expect((run.data.warnings ?? []).map((w: any) => w.code)).toContain('flaky_cases_present');
    expect(historyRecords(f)[0].flaky_ids).toEqual(['UT-S03-01']);
    expect(check(f).data).toMatchObject({ valid: true, reason: null });
  });

  it('UT-S13-273: 发布级：无理由的跳过不能构成通过', () => {
    const arms: Array<[string, Record<string, string>, string[]]> = [
      ['全部', Object.fromEntries(REL_ALL.map(id => [id, 'skip-bare'])), REL_ALL],
      ['一条', { 'UT-S02-02': 'skip-bare' }, ['UT-S02-02']],
    ];
    for (const [name, cases, expected] of arms) {
      const f = rel({ script: { cases } });
      const run = release(f);
      expect(run.data.pre_run.commands[0].status, name).toBe('pass');
      expect(run.data.gate, name).toEqual({ result: 'FAIL', reason: 'case_tier_mismatch' });
      expect(run.data.tier_mismatch_cases.map((c: any) => c.id), name).toEqual(expected);
      expect((run.data.warnings ?? []).map((w: any) => w.code), name).not.toContain('unclassified_skipped_cases');
      const query = check(f);
      expect(query.status, name).toBe(1);
      expect(query.data, name).toMatchObject({ valid: false, reason: 'latest_failed' });
    }
  });

  it('UT-S13-274: 发布级：带平台原因的跳过被接受', () => {
    const f = rel({ script: { cases: { 'UT-S02-02': 'skip' } } });
    const run = release(f);
    expect(run.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(run.data.platform_skipped_cases.map((c: any) => c.id)).toEqual(['UT-S02-02']);
    const report = read(f, RELEASE_REPORT);
    expect(report).toContain('平台跳过 / Platform Skips');
    expect(report).toContain('UT-S02-02');
    const query = check(f);
    expect(query.status).toBe(0);
    expect(query.data.valid).toBe(true);
  });
});

describe('S13 发布级验收 — 提交身份与查询', () => {
  it('UT-S13-259: 提交身份在执行前固定', () => {
    const f = rel({ script: { during: { 1: 'commit' } } });
    const a = head(f);
    const run = release(f);
    const b = head(f);
    expect(b).not.toBe(a);
    expect(run.data.gate).toEqual({ result: 'FAIL', reason: 'release_commit_changed' });
    expect(run.data.release).toMatchObject({ commit: a, commit_unchanged: false, head_at_finish: b });
    expect(historyRecords(f)[0].commit).toEqual({ head: a, dirty: false });
    const report = read(f, RELEASE_REPORT);
    expect(report).toContain(`| 提交 / Commit | ${a} |`);
    expect(report).toContain('release_commit_changed');
    expect(report).toContain(b);
    const forB = check(f, ['--commit', b]);
    expect(forB.data.valid).toBe(false);
    expect(forB.data.latest).toBeNull();
    const forA = check(f, ['--commit', a]);
    expect(forA.status).toBe(1);
    expect(forA.data).toMatchObject({ valid: false, reason: 'latest_failed', commit: a });
  });

  it('UT-S13-260: 收尾时工作区不干净', () => {
    const f = rel({ script: { during: { 1: 'untracked' } } });
    const run = release(f);
    expect(run.status).toBe(1);
    expect(run.data.gate.reason).toBe('release_commit_changed');
    expect(run.data.release.commit_unchanged).toBe(true);
    expect(run.data.release.worktree_clean).toBe(false);
    expect(read(f, RELEASE_REPORT)).toContain('不干净 / dirty');
    // 执行期间暂存改动后把工作区改回原样：收尾复核同样判不干净（code-r1 F4）
    const g = rel({ script: { during: { 1: 'staged' } } });
    const staged = release(g);
    expect(staged.calls).toHaveLength(1);
    expect(staged.data.gate.reason).toBe('release_commit_changed');
    expect(staged.data.release).toMatchObject({ commit_unchanged: true, worktree_clean: false });
    expect(check(g).data).toMatchObject({ valid: false, reason: 'latest_failed' });
    // 子目录项目（code-r2 F4）：执行期间留下的未跟踪源码文件，收尾同样按项目前缀判为不干净
    const sub = relInSubdirectory({ script: { during: { 1: 'untracked' } } });
    const left = release(sub.f);
    expect(left.calls).toHaveLength(1);
    expect(left.data.gate.reason).toBe('release_commit_changed');
    expect(left.data.release).toMatchObject({ commit_unchanged: true, worktree_clean: false });
  });

  it('UT-S13-261: 查询以最近一次结论为准', () => {
    const f = rel();
    expect(release(f).status).toBe(0);
    setScript(f, { mode: 'narrow', cases: { 'UT-S02-01': 'fail' } });
    const failed = release(f);
    expect(failed.status).toBe(1);
    const a = check(f);
    expect(a.status).toBe(1);
    expect(a.data).toMatchObject({ valid: false, reason: 'latest_failed', level: 'release', platform: PLATFORM });
    expect(a.data.latest.run_id).toBe(failed.data.history.run_id);

    const g = rel({ script: { cases: { 'UT-S02-01': 'fail' } } });
    expect(release(g).status).toBe(1);
    setScript(g, { mode: 'narrow' });
    const passed = release(g);
    expect(passed.status).toBe(0);
    const b = check(g);
    expect(b.status).toBe(0);
    expect(b.data).toMatchObject({ valid: true, reason: null });
    expect(b.data.latest.run_id).toBe(passed.data.history.run_id);
  });

  it('UT-S13-262: 环境预检未通过的运行不是结论', () => {
    const f = rel({ verify: { requirements: { env: ['LV_TOKEN'] } } });
    expect(release(f, { LV_TOKEN: 'set' }).status).toBe(0);
    const blocked = release(f);
    expect(blocked.data.gate).toEqual({ result: 'FAIL', reason: 'verify_env_not_ready' });
    expect(blocked.data.level).toBe('release');
    const records = historyRecords(f);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ level: 'release', result_source: 'none', gate: { reason: 'verify_env_not_ready' } });
    expect(check(f).data).toMatchObject({ valid: true, reason: null });

    const g = rel({ verify: { requirements: { env: ['LV_TOKEN'] } } });
    const only = release(g);
    expect(only.data.gate.reason).toBe('verify_env_not_ready');
    expect(only.calls).toHaveLength(0);
    const query = check(g);
    expect(query.status).toBe(1);
    expect(query.data).toMatchObject({ valid: false, reason: 'no_conclusive_run' });
  });

  it('UT-S13-263: 提交变了即作废；其他平台的结论不算', () => {
    // ① 提交 A 上 PASS 后新建提交 B
    const f = rel();
    expect(release(f).status).toBe(0);
    put(f.root, 'src/core.ts', 'export const core = 3;\n');
    commitAll(f, 'B');
    setScript(f, { mode: 'narrow' });
    const filesBefore = snapshot(join(f.root, 'logos'));
    const a = check(f);
    expect(a.status).toBe(1);
    expect(a.data).toMatchObject({ valid: false, reason: 'other_commit_only', latest: null });
    expect(readCalls(f)).toEqual([]);
    expect(snapshot(join(f.root, 'logos'))).toEqual(filesBefore);
    // ② 提交相同、平台不同的 PASS 记录
    const g = rel();
    expect(release(g).status).toBe(0);
    const [file] = historyFiles(g);
    const record = JSON.parse(read(g, `${HISTORY_DIR}/${file}`));
    writeFileSync(join(g.root, HISTORY_DIR, file), JSON.stringify({ ...record, platform: 'plan9-mips' }, null, 2));
    const b = check(g);
    expect(b.status).toBe(1);
    expect(b.data).toMatchObject({ valid: false, reason: 'other_platform_only' });
    // ③ 没有任何发布级记录（提案级记录不算）
    const h = rel();
    expect(runVerify(CLI, h).status).toBe(0);
    const before = snapshot(join(h.root, 'logos'));
    const c = check(h);
    expect(c.status).toBe(1);
    expect(c.data).toMatchObject({ valid: false, reason: 'no_conclusive_run' });
    expect(snapshot(join(h.root, 'logos'))).toEqual(before);
    expect(git(h.root, ['status', '--porcelain', '--', 'src', 'tools'])).toBe('');
  });

  it('UT-S13-264: --check 指定提交', () => {
    const f = rel();
    const a = head(f);
    expect(release(f).status).toBe(0);
    put(f.root, 'src/core.ts', 'export const core = 3;\n');
    commitAll(f, 'B');
    put(f.root, 'src/core.ts', 'export const core = 4;\n'); // 未提交改动：查询不要求工作区干净
    for (const arg of [a, a.slice(0, 10)]) {
      const r = check(f, ['--commit', arg]);
      expect(r.status, arg).toBe(0);
      expect(r.data, arg).toMatchObject({ valid: true, reason: null, commit: a });
    }
    const bad = check(f, ['--commit', 'not-a-commit']);
    expect(bad.status).toBe(2);
    expect(bad.error.code).toBe('RELEASE_CHECK_COMMIT_INVALID');
    // 文本模式同样给出结论
    const text = cli(f, ['verify', '--release', '--check', '--commit', a]);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain(a);
  });
});

describe('S13 发布级验收 — 文本输出与场景测试', () => {
  it('UT-S13-248: 文本模式标明级别', () => {
    const zh = runVerify(CLI, lv(), { args: [] });
    expect(zh.status).toBe(0);
    expect(zh.stdout).toContain('级别：提案级（分层）');
    expect(zh.stdout).toContain('提案级通过不等于可以发布');
    const en = runVerify(CLI, lv({ locale: 'en' }), { args: [] });
    expect(en.status).toBe(0);
    expect(en.stdout).toContain('Level: proposal (layered)');
    expect(en.stdout).toContain('does not mean the product can be released');
    const f = rel();
    const sha = head(f);
    const out = runVerify(CLI, f, { args: ['--release'] });
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('级别：发布级（全量）');
    expect(out.stdout).toContain(sha);
    expect(out.stdout).toContain(PLATFORM);
    expect(out.stdout).toContain(RELEASE_REPORT);
    expect(out.stdout).not.toContain('提案级通过不等于可以发布');
  });

  it('ST-S13-50: 同一提交先提案级、后发布级，两份结论并存', () => {
    const f = lv({ commitAll: true });
    const sha = head(f);
    const proposal = runVerify(CLI, f);
    expect(proposal.status).toBe(0);
    expect(proposal.data.level).toBe('proposal');
    expect(proposal.calls[0].executed).toEqual(P_DEFAULT);
    const marker = join(f.proposalDir!, 'VERIFY_PASS');
    const markerStat = statSync(marker).mtimeMs;
    const full = release(f);
    expect(full.status).toBe(0);
    expect(full.data.level).toBe('release');
    expect(full.calls[0].executed).toEqual(ALL_DEFAULT);
    expect(read(f, SHARED_REPORT)).toContain('提案级（分层）');
    expect(read(f, SHARED_REPORT)).not.toContain('发布级（全量）');
    expect(read(f, RELEASE_REPORT)).toContain('发布级（全量）');
    expect(existsSync(marker)).toBe(true);
    expect(statSync(marker).mtimeMs).toBe(markerStat);
    const records = historyRecords(f);
    expect(records.map(r => r.level)).toEqual(['proposal', 'release']);
    expect(records.map(r => r.commit.head)).toEqual([sha, sha]);
    expect(records[0].proposal.slug).toBe(SLUG);
    expect(records[1].proposal).toBeNull();
  });

  it('ST-S13-51: 发布前查询：失败、修复、再通过', () => {
    const f = rel({ script: { cases: { 'UT-S02-01': 'fail' } } });
    const a = head(f);
    expect(runVerify(CLI, f, { args: ['--release'] }).status).toBe(1);
    const afterFail = check(f);
    expect(afterFail.status).toBe(1);
    expect(afterFail.data.reason).toBe('latest_failed');
    // 提交修复，得到提交 B
    put(f.root, 'src/core.ts', 'export const core = "fixed";\n');
    const b = commitAll(f, 'fix');
    setScript(f, { mode: 'narrow' });
    const afterCommit = check(f);
    expect(afterCommit.status).toBe(1);
    expect(afterCommit.data).toMatchObject({ reason: 'other_commit_only', commit: b });
    expect(runVerify(CLI, f, { args: ['--release'] }).status).toBe(0);
    const afterPass = check(f);
    expect(afterPass.status).toBe(0);
    expect(afterPass.data).toMatchObject({ valid: true, commit: b });
    const forA = check(f, ['--commit', a]);
    expect(forA.status).toBe(1);
    expect(forA.data).toMatchObject({ valid: false, reason: 'latest_failed', commit: a });
    rmSync(f.log, { force: true });
  });
});
