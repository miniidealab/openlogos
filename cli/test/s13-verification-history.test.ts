/**
 * S13 验收历史留存与查询（verification-history，切片 1）。
 * 覆盖 UT-S13-141～UT-S13-146、UT-S13-148～UT-S13-156、ST-S13-38、ST-S13-39
 * （与 logos/resources/test/core-S13-test-cases.md「S13 验收历史留存与查询测试（verification-history）」对齐）。
 *
 * 夹具 VH：一次性项目，单模块 core（launched），已合并测试规格定义 UT-S01-01、UT-S01-02、ST-S01-01；
 * `verify.pre_run_command` 指向记录型 runner（按环境变量决定每条用例 pass / fail、可写入敏感占位值、可阻塞等待放行、记录每次调用）；
 * 活跃提案 vh-demo。全部经真实 CLI（dist/index.js）子进程驱动，断言读回磁盘文件。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl（scenario_id=S13）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, withCompleteClarification } from './helpers.js';
import { createScopeFixture, plan as planSlicesFixture, passCurrentSlice, checkCodeTasks, writeResults } from './slice-scope-fixture.js';

vi.setConfig({ testTimeout: 120_000 });

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(CLI_ROOT, '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const SLUG = 'vh-demo';
const SECRET = 'SECRET-PLACEHOLDER-7f3a';
const HISTORY_DIR = 'logos/resources/verify/history';
const RESULTS = 'logos/resources/verify/test-results.jsonl';
const IDS = ['ST-S01-01', 'UT-S01-01', 'UT-S01-02'];
const WHITELIST = [
  'schema', 'run_id', 'kind', 'started_at', 'finished_at', 'outcome', 'gate', 'error_code', 'proposal', 'module_scope',
  'verify_mode', 'attempted_slice_id', 'environment', 'deploy_id', 'counts', 'failed_ids', 'skipped_ids', 'uncovered_ids',
  'result_source', 'commit', 'cli_version', 'raw_location',
].sort();

const RUNNER = `const fs = require('fs');
fs.appendFileSync('runner-calls.log', 'run\\n');
if (process.env.VH_BLOCK) {
  fs.writeFileSync(process.env.VH_BLOCK + '.started', '');
  const end = Date.now() + 60000;
  while (!fs.existsSync(process.env.VH_BLOCK) && Date.now() < end) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
}
if (process.env.VH_NO_RESULTS === '1') process.exit(3);
const fail = (process.env.VH_FAIL || '').split(',').filter(Boolean);
const ids = JSON.parse(fs.readFileSync('tools/ids.json', 'utf8'));
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', ids.map(id => JSON.stringify(
  fail.includes(id)
    ? { id, status: 'fail', scenario: 'S01', duration_ms: 3, error: 'assert failed ' + (process.env.VH_SECRET || '') }
    : { id, status: 'pass', scenario: 'S01', duration_ms: 3 },
)).join('\\n') + '\\n');
`;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

interface VhOptions { proposal?: boolean; preRun?: boolean; config?: Record<string, unknown>; gitignore?: string; git?: boolean }

function testTable(ids: string[]): string {
  return ['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} fixture |`)].join('\n') + '\n';
}

function writeProposal(root: string, slug: string): string {
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
    `# 变更提案：${slug}`, '', '## 变更原因', '验收历史夹具。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '夹具。',
  ].join('\n')));
  writeFileSync(join(dir, 'tasks.md'), ['# 实现任务', '', '## [code] 代码实现', '- [ ] 实现', ''].join('\n'));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  return dir;
}

function vh(opts: VhOptions = {}) {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    ['project:', '  name: vh', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', ''].join('\n'));
  writeFileSync(join(root, 'logos/resources/test/core-S01-test-cases.md'), testTable(IDS));
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(join(root, 'tools', 'run.cjs'), RUNNER);
  writeFileSync(join(root, 'tools', 'ids.json'), JSON.stringify(IDS));
  const cfgPath = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { ...cfg.verify, sandbox_mode: 'off', ...(opts.preRun === false ? {} : { pre_run_command: 'node tools/run.cjs' }), ...(opts.config ?? {}) };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  if (opts.proposal !== false) writeProposal(root, SLUG);
  if (opts.gitignore !== undefined) writeFileSync(join(root, '.gitignore'), opts.gitignore);
  if (opts.git) {
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'vh@example.invalid');
    git(root, 'config', 'user.name', 'vh');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'fixture');
  }
  return root;
}

function git(root: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

function cleanEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', ...extra };
  for (const k of Object.keys(env)) if (k.startsWith('OPENLOGOS_VERIFY_')) delete env[k];
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  return env as NodeJS.ProcessEnv;
}

interface CliRun { status: number | null; stdout: string; stderr: string; out: any; err: any }
function parseLast(text: string): any {
  const line = text.split('\n').reverse().find(l => l.trim().startsWith('{'));
  if (!line) return null;
  try { return JSON.parse(line); } catch { return null; }
}
function cli(root: string, args: string[], env: Record<string, string | undefined> = {}): CliRun {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', env: cleanEnv(env), timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: parseLast(r.stdout ?? ''), err: parseLast(r.stderr ?? '') };
}
const verify = (root: string, env: Record<string, string | undefined> = {}) => cli(root, ['verify', '--format', 'json'], env);

function historyFiles(root: string): string[] {
  const dir = join(root, HISTORY_DIR);
  return existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.json')).sort() : [];
}
function readJson(path: string): any { return JSON.parse(readFileSync(path, 'utf8')); }
function readIndex(root: string, runId: string): any { return readJson(join(root, HISTORY_DIR, `${runId}.json`)); }
function sha(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function allFiles(dir: string, base = dir, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) allFiles(p, base, out); else out.push(p);
  }
  return out;
}
function grepFiles(dir: string, needle: string): string[] {
  return allFiles(dir).filter(p => readFileSync(p, 'utf8').includes(needle));
}
const gateLine = (report: string) => (report.match(/\*\*Gate 3\.5\*\*[^\n]*\*\*(PASS|FAIL)\*\*/) ?? [])[1];

describe('S13 验收历史留存与查询（verification-history）', () => {
  it('UT-S13-141: 连续两次 verify 后两轮都可追溯', () => {
    const root = vh();
    const first = verify(root, { VH_FAIL: 'UT-S01-01,UT-S01-02' });
    const second = verify(root);
    expect(first.status).toBe(1);
    expect(second.status).toBe(0);
    const r1 = first.out.data.history.run_id;
    const r2 = second.out.data.history.run_id;
    expect(historyFiles(root)).toEqual([`${r1}.json`, `${r2}.json`].sort());
    const list = cli(root, ['history', 'list', '--slug', SLUG, '--format', 'json']);
    expect(list.out.data.runs.map((r: any) => [r.run_id, r.gate.result])).toEqual([[r2, 'PASS'], [r1, 'FAIL']]);
    const show = cli(root, ['history', 'show', r1, '--format', 'json']);
    expect(show.out.data.run.failed_ids).toEqual(['UT-S01-01', 'UT-S01-02']);
    expect(show.out.data.run.counts).toMatchObject({ defined: 3, executed: 3, passed: 1, failed: 2, uncovered: 0 });
    expect(gateLine(readFileSync(join(root, show.out.data.full_record.report_path), 'utf8'))).toBe('FAIL');
    // 最新报告与结果文件只反映第二次
    expect(gateLine(readFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'utf8'))).toBe('PASS');
    expect(readFileSync(join(root, RESULTS), 'utf8')).not.toContain('"fail"');
  });

  it('UT-S13-142: smoke 覆盖预检改判时报告与历史一致', () => {
    const root = vh();
    // 提案新增 smoke 用例但没有 runner：delta 中的 smoke 规格
    const proposal = join(root, 'logos/changes', SLUG);
    mkdirSync(join(proposal, 'deltas/test/smoke'), { recursive: true });
    writeFileSync(join(proposal, 'deltas/test/smoke/core-smoke-test-cases.md'),
      '## ADDED — 新增 smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 新用例 |\n');
    const r = verify(root);
    expect(r.out.data.gate.result).toBe('FAIL');
    const runId = r.out.data.history.run_id;
    const idx = readIndex(root, runId);
    expect(idx.gate.result).toBe('FAIL');
    expect(idx.gate.reason).toBe(r.out.data.gate.reason);
    const shared = readFileSync(join(root, 'logos/resources/verify/acceptance-report.md'));
    expect(gateLine(shared.toString())).toBe('FAIL');
    const snap = readFileSync(join(proposal, 'verify-runs', runId, 'report.md'));
    expect(snap.equals(shared)).toBe(true);
  });

  it('UT-S13-143: 复用既有结果标 reused', () => {
    const root = vh({ preRun: false });
    writeResults(root, IDS.map(id => ({ id, status: 'pass' as const })));
    const a = verify(root);
    const b = verify(root);
    expect(readIndex(root, a.out.data.history.run_id).result_source).toBe('reused');
    expect(readIndex(root, b.out.data.history.run_id).result_source).toBe('reused');
    expect(existsSync(join(root, 'runner-calls.log'))).toBe(false);
  });

  it('UT-S13-144: 进入执行后的早退仍留历史，执行前拒绝不留', () => {
    // ① 未配置预跑且结果文件不存在 → NO_TEST_RESULTS
    const r1root = vh({ preRun: false });
    const r1 = verify(r1root);
    expect(r1.status).toBe(1);
    expect(r1.err.error.code).toBe('NO_TEST_RESULTS');
    expect(r1.err.error.message).toBe(`No test results found at ${RESULTS}.`);
    const idx1 = readJson(join(r1root, r1.err.error.details.history.index_path));
    expect(idx1).toMatchObject({ outcome: 'aborted', error_code: 'NO_TEST_RESULTS', gate: { result: null } });
    expect(existsSync(join(r1root, 'logos/changes', SLUG, 'verify-runs', idx1.run_id, 'report.md'))).toBe(false);
    // ② 预跑执行后没有可验收用例 → NO_TEST_CASES
    const r2root = vh();
    rmSync(join(r2root, 'logos/resources/test/core-S01-test-cases.md'));
    const r2 = verify(r2root);
    expect(r2.status).toBe(1);
    expect(r2.err.error.code).toBe('NO_TEST_CASES');
    const idx2 = readJson(join(r2root, r2.err.error.details.history.index_path));
    expect(idx2).toMatchObject({ outcome: 'aborted', error_code: 'NO_TEST_CASES', result_source: 'executed' });
    // ③ 预跑非零退出且不写结果行：不是早退
    const r3root = vh();
    const r3 = verify(r3root, { VH_NO_RESULTS: '1' });
    expect(r3.out.data.gate.result).toBe('FAIL');
    expect(readIndex(r3root, r3.out.data.history.run_id)).toMatchObject({ outcome: 'completed', result_source: 'executed' });
    // ④ 未知参数（verify 忽略未知标志，仍正常运行）不属于拒绝；⑤ 配置缺失：不新增历史
    const r5root = vh();
    rmSync(join(r5root, 'logos/logos.config.json'));
    const r5 = verify(r5root);
    expect(r5.status).toBe(1);
    expect(r5.err.error.code).toBe('PROJECT_NOT_INITIALIZED');
    expect(r5.err.error.details).toBeUndefined();
    expect(historyFiles(r5root)).toEqual([]);
  });

  it('UT-S13-145: 自由文本的 Git 可见范围', () => {
    for (const raw of [true, false]) {
      const root = vh(raw ? {} : { config: { history: { raw_in_proposal: false } } });
      const r = verify(root, { VH_FAIL: 'UT-S01-01', VH_SECRET: SECRET });
      const runId = r.out.data.history.run_id;
      const idxPath = join(root, HISTORY_DIR, `${runId}.json`);
      const idx = readJson(idxPath);
      expect(Object.keys(idx).sort()).toEqual(WHITELIST);
      expect(readFileSync(idxPath, 'utf8')).not.toContain(SECRET);
      const runDir = join(root, 'logos/changes', SLUG, 'verify-runs', runId);
      const localDir = join(root, 'logos/.openlogos-runtime/verify-runs', runId);
      if (raw) {
        expect(idx.raw_location).toBe('proposal');
        expect(readFileSync(join(runDir, 'results.jsonl'), 'utf8')).toContain(SECRET);
        expect(existsSync(join(runDir, 'report.md'))).toBe(true);
        expect(existsSync(localDir)).toBe(false);
      } else {
        expect(idx.raw_location).toBe('local');
        const rows = readFileSync(join(runDir, 'results.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
        for (const row of rows) {
          for (const k of Object.keys(row)) expect(['id', 'status', 'scenario', 'timestamp', 'duration_ms', 'environment', 'target_environment']).toContain(k);
        }
        expect(grepFiles(runDir, SECRET)).toEqual([]);
        expect(existsSync(join(runDir, 'report.md'))).toBe(false);
        expect(grepFiles(localDir, SECRET).length).toBeGreaterThan(0);
        expect(existsSync(join(localDir, 'report.md'))).toBe(true);
      }
    }
  });

  it('UT-S13-146: 同一结果路径并发时后到者被拒', async () => {
    const root = vh();
    const flag = join(root, 'release.flag');
    const bg = spawn(process.execPath, [CLI, 'verify', '--format', 'json'], { cwd: root, env: cleanEnv({ VH_BLOCK: flag }) });
    const bgOut: string[] = [];
    bg.stdout.on('data', d => bgOut.push(String(d)));
    const deadline = Date.now() + 30_000;
    while (!existsSync(`${flag}.started`) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    expect(existsSync(`${flag}.started`)).toBe(true);
    writeResults(root, IDS.map(id => ({ id, status: 'pass' as const })));
    const before = { sha: sha(join(root, RESULTS)), mtime: statSync(join(root, RESULTS)).mtimeMs };
    const second = verify(root);
    expect(second.status).toBe(2);
    expect(second.err.error.code).toBe('RESULT_PATH_BUSY');
    expect(second.err.error.details.paths).toContain(RESULTS);
    expect({ sha: sha(join(root, RESULTS)), mtime: statSync(join(root, RESULTS)).mtimeMs }).toEqual(before);
    expect(historyFiles(root)).toEqual([]);
    writeFileSync(flag, '');
    const code: number = await new Promise(r => bg.on('close', c => r(c ?? -1)));
    expect(code).toBe(0);
    expect(historyFiles(root)).toHaveLength(1);
    expect(parseLast(bgOut.join('')).data.history.write_status).toBe('written');
  });

  it('UT-S13-148: checkpoint 与 final 各留一条', () => {
    const { fixture: f, cleanup } = createScopeFixture();
    cleanups.push(cleanup);
    planSlicesFixture(f);
    const all = [...f.baseline, 'UT-S90-01', 'UT-S90-02', 'UT-S90-03'];
    writeResults(f.root, all.map(id => ({ id, status: 'pass' as const })));
    const c1 = verify(f.root);
    const c2 = verify(f.root);
    expect(c1.out.data.verify_mode).toBe('slice-checkpoint');
    const firstSlice = c1.out.data.attempted_slice_id;
    expect(firstSlice).toBe('slice-a');
    // 推进到 final：slice-b 通过并勾选全部 [code]
    if (c2.out.data.attempted_slice_id !== 'slice-a') { /* 第二次已进入下一片 */ } else passCurrentSlice(f);
    passCurrentSlice(f);
    checkCodeTasks(f, 2);
    const fin = verify(f.root);
    expect(fin.out.data.verify_mode).toBe('final');
    const recs = [c1, c2, fin].map(r => readIndex(f.root, r.out.data.history.run_id));
    expect(recs[0]).toMatchObject({ verify_mode: 'slice-checkpoint', attempted_slice_id: 'slice-a' });
    expect(recs[1]).toMatchObject({ verify_mode: 'slice-checkpoint', attempted_slice_id: c2.out.data.attempted_slice_id });
    expect(recs[2]).toMatchObject({ verify_mode: 'final', attempted_slice_id: null });
    expect(historyFiles(f.root)).toHaveLength(3);
  });

  it('UT-S13-149: 归档后按 run_id 定位，同名新提案不串号', () => {
    const root = vh();
    const old = verify(root, { VH_FAIL: 'UT-S01-02' });
    const oldId = old.out.data.history.run_id;
    const oldIndexSha = sha(join(root, HISTORY_DIR, `${oldId}.json`));
    // 模拟 archive 的整目录移动（archive 命令本身的门禁由 ST-S13-38 覆盖）
    const archived = join(root, 'logos/changes/archive', `20261122-0730-${SLUG}`);
    renameSync(join(root, 'logos/changes', SLUG), archived);
    writeProposal(root, SLUG);
    const fresh = verify(root);
    const newId = fresh.out.data.history.run_id;
    const showOld = cli(root, ['history', 'show', oldId, '--format', 'json']).out.data;
    const showNew = cli(root, ['history', 'show', newId, '--format', 'json']).out.data;
    expect(showOld.full_record.path).toBe(`logos/changes/archive/20261122-0730-${SLUG}/verify-runs/${oldId}`);
    expect(showNew.full_record.path).toBe(`logos/changes/${SLUG}/verify-runs/${newId}`);
    expect(showOld.run.failed_ids).toEqual(['UT-S01-02']);
    expect(showNew.run.failed_ids).toEqual([]);
    rmSync(join(archived, 'verify-runs', oldId), { recursive: true });
    const gone = cli(root, ['history', 'show', oldId, '--format', 'json']).out.data;
    expect(gone.full_record).toBe('unavailable');
    expect(gone.unavailable_reason).toBe('not_found_locally');
    expect(gone.run.run_id).toBe(oldId);
    expect(sha(join(root, HISTORY_DIR, `${oldId}.json`))).toBe(oldIndexSha);
  });

  it('UT-S13-150: 没有活跃提案只写中央索引', () => {
    const root = vh({ proposal: false });
    const before = allFiles(join(root, 'logos/changes'));
    const r = verify(root);
    const idx = readIndex(root, r.out.data.history.run_id);
    expect(idx).toMatchObject({ proposal: null, raw_location: 'none' });
    expect(r.out.data.history.run_dir).toBeNull();
    expect(allFiles(join(root, 'logos/changes'))).toEqual(before);
    const show = cli(root, ['history', 'show', idx.run_id, '--format', 'json']).out.data;
    expect(show.full_record).toBe('unavailable');
    expect(show.unavailable_reason).toBe('no_proposal');
    const text = cli(root, ['history', 'show', idx.run_id]);
    expect(text.stdout).toContain('本次运行没有活跃提案');
  });

  it('UT-S13-151: 运行记录目录不影响 change-lint、merge 与计划指纹', () => {
    const { fixture: f, cleanup } = createScopeFixture();
    cleanups.push(cleanup);
    planSlicesFixture(f);
    const strip = (v: any) => JSON.parse(JSON.stringify(v, (k, val) => (k === 'timestamp' ? undefined : val)));
    const lintBefore = strip(cli(f.root, ['change-lint', '--format', 'json']).out?.data);
    const statusBefore = cli(f.root, ['status', '--format', 'json']).out.data;
    const manifestBefore = readFileSync(f.manifestPath, 'utf8');
    writeResults(f.root, [...f.baseline, 'UT-S90-01', 'UT-S90-02', 'UT-S90-03'].map(id => ({ id, status: 'pass' as const })));
    // 直接放入一个运行记录目录（与 verify 写出的形态相同），避免 checkpoint 推进改变派生
    const runDir = join(f.dir, 'verify-runs', '20261122T000000000Z-verify-abcdef');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'record.json'), '{}\n');
    writeFileSync(join(runDir, 'results.jsonl'), '{"id":"UT-S90-01","status":"pass"}\n');
    writeFileSync(join(runDir, 'report.md'), '# Acceptance Report\n');
    const lintAfter = strip(cli(f.root, ['change-lint', '--format', 'json']).out?.data);
    const statusAfter = cli(f.root, ['status', '--format', 'json']).out.data;
    expect(lintAfter).toEqual(lintBefore);
    expect(readFileSync(f.manifestPath, 'utf8')).toBe(manifestBefore);
    const step = (s: any) => s.modules.find((m: any) => m.id === 'core').active_change;
    expect(step(statusAfter).proposal_step).toBe(step(statusBefore).proposal_step);
    expect(JSON.stringify(step(statusAfter).slice_state ?? null)).toBe(JSON.stringify(step(statusBefore).slice_state ?? null));
    // verify 仍按 manifest 身份正常进入 checkpoint（指纹未因运行记录目录失效）
    expect(verify(f.root).out.data.manifest).toBeTruthy();
    // merge：no-delta 提案的 spec-complete 不把 verify-runs 当作 delta
    const root = vh();
    const dir = join(root, 'logos/changes', SLUG);
    mkdirSync(join(dir, 'verify-runs', 'x'), { recursive: true });
    writeFileSync(join(dir, 'verify-runs', 'x', 'results.jsonl'), '{}\n');
    writeFileSync(join(dir, 'PLAN_APPROVED'), '');
    writeFileSync(join(dir, 'tasks.md'), ['# 实现任务', '', '## [code] 代码实现', '（本段在 plan 段留空。）', ''].join('\n'));
    writeFileSync(join(dir, 'proposal.md'), `${readFileSync(join(dir, 'proposal.md'), 'utf8').trimEnd()}\n\n## 复用测试 ID\n- UT-S01-01 — 回归\n`);
    const merged = cli(root, ['merge', SLUG, '--format', 'json']);
    const payload = JSON.stringify(merged.out ?? merged.err ?? {});
    expect(merged.status).toBe(0);
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true);
    expect(payload).not.toContain('verify-runs');
    expect(readFileSync(join(dir, 'SPEC_MERGED'), 'utf8')).not.toContain('verify-runs');
    expect(existsSync(join(dir, 'verify-runs', 'x', 'results.jsonl'))).toBe(true);
  });

  it('UT-S13-152: 现有报告、结果文件与标记零回归', () => {
    for (const variant of ['green', 'fail', 'two-phase'] as const) {
      const config = variant === 'two-phase' ? {
        pre_run_command: undefined,
        regression_command: 'node tools/run.cjs',
        incremental_command: 'node -e "0"',
        regression_result_path: 'logos/resources/verify/reg.jsonl',
        incremental_result_path: 'logos/resources/verify/inc.jsonl',
      } : {};
      const root = vh({ config });
      if (variant === 'two-phase') {
        writeFileSync(join(root, 'tools', 'run.cjs'), RUNNER.replace(/logos\/resources\/verify\/test-results\.jsonl/g, 'logos/resources/verify/reg.jsonl'));
        const cfgPath = join(root, 'logos/logos.config.json');
        const cfg = readJson(cfgPath); delete cfg.verify.pre_run_command; writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      }
      const r = verify(root, variant === 'fail' ? { VH_FAIL: 'UT-S01-01' } : {});
      const marker = (n: string) => existsSync(join(root, 'logos/changes', SLUG, n));
      if (variant === 'fail') {
        expect(r.status).toBe(1);
        expect(marker('VERIFY_FAIL')).toBe(true);
        expect(marker('VERIFY_PASS')).toBe(false);
      } else {
        expect(r.out.data.gate.result).toBe('PASS');
        expect(marker('VERIFY_PASS')).toBe(true);
        expect(marker('VERIFY_FAIL')).toBe(false);
      }
      // 报告与 JSON 一致；JSON 除新增 history 外字段集合不变
      expect(gateLine(readFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'utf8'))).toBe(r.out.data.gate.result);
      const keys = Object.keys(r.out.data).filter(k => k !== 'history').sort();
      expect(keys).toEqual(expect.arrayContaining(['contract', 'summary', 'gate', 'failed_cases', 'uncovered_cases', 'skipped_cases', 'consistency', 'pre_run', 'report_path', 'sandbox']));
      expect(Object.keys(r.out.data)).toContain('history');
      const results = readFileSync(join(root, RESULTS), 'utf8').trim().split('\n').map(l => JSON.parse(l).id).sort();
      expect(results).toEqual(IDS);
    }
  });

  it('UT-S13-153: 历史写入失败不改变门禁与退出码', () => {
    const root = vh();
    writeFileSync(join(root, HISTORY_DIR), 'not a directory');
    const r = verify(root);
    expect(r.status).toBe(0);
    expect(r.out.data.gate.result).toBe('PASS');
    expect(existsSync(join(root, 'logos/changes', SLUG, 'VERIFY_PASS'))).toBe(true);
    expect(r.out.data.history.write_status).toBe('failed');
    expect(r.out.data.history.write_error).toEqual({ code: 'verification_history_write_failed', layer: 'index', path: HISTORY_DIR });
    const text = cli(root, ['verify']);
    expect(text.stdout).toContain('验收历史写入失败');
  });

  it('UT-S13-154: 损坏的历史文件被跳过并提示', () => {
    const root = vh();
    verify(root); verify(root);
    writeFileSync(join(root, HISTORY_DIR, '20990101T000000000Z-verify-000000.json'), 'not json');
    writeFileSync(join(root, HISTORY_DIR, '20990101T000000001Z-verify-000001.json'), JSON.stringify({ schema: 'openlogos/verification-run@1', run_id: '20990101T000000001Z-verify-000001' }));
    const r = cli(root, ['history', 'list', '--format', 'json']);
    expect(r.status).toBe(0);
    expect(r.out.data.runs).toHaveLength(2);
    expect(r.out.data.warnings.map((w: any) => [w.code, w.path])).toEqual([
      ['verification_history_corrupt', `${HISTORY_DIR}/20990101T000000000Z-verify-000000.json`],
      ['verification_history_corrupt', `${HISTORY_DIR}/20990101T000000001Z-verify-000001.json`],
    ]);
    // code-r1 F2：保留顶层键但缺 failed_ids、gate 为 null、计数类型不符的记录同样视为损坏
    const good = readJson(join(root, HISTORY_DIR, historyFiles(root).find(n => !n.startsWith('2099'))!));
    const bad = {
      '20990101T000000002Z-verify-000002': (() => { const v = { ...good, run_id: '20990101T000000002Z-verify-000002' }; delete v.failed_ids; return v; })(),
      '20990101T000000003Z-verify-000003': { ...good, run_id: '20990101T000000003Z-verify-000003', gate: null },
      '20990101T000000004Z-verify-000004': { ...good, run_id: '20990101T000000004Z-verify-000004', counts: { ...good.counts, failed: 'two' } },
      '20990101T000000005Z-verify-000005': { ...good, run_id: '20990101T000000005Z-verify-000005', failed_ids: [{ leak: 'x' }] },
    };
    for (const [id, v] of Object.entries(bad)) writeFileSync(join(root, HISTORY_DIR, `${id}.json`), JSON.stringify(v));
    const r2 = cli(root, ['history', 'list', '--format', 'json']);
    expect(r2.out.data.runs).toHaveLength(2);
    expect(r2.out.data.warnings.map((w: any) => w.path)).toEqual(expect.arrayContaining(Object.keys(bad).map(id => `${HISTORY_DIR}/${id}.json`)));
    const text = cli(root, ['history', 'list']);
    expect(text.status).toBe(0);
    expect(text.stderr).not.toContain('TypeError');
    const missing = cli(root, ['history', 'show', '20990101T000000002Z-verify-000002', '--format', 'json']);
    expect(missing.status).toBe(1);
    expect(missing.err.error.code).toBe('HISTORY_RUN_NOT_FOUND');
  });

  it('UT-S13-155: 查询命令的筛选、查看与错误码', () => {
    const root = vh();
    const fail = verify(root, { VH_FAIL: 'UT-S01-01' }).out.data.history.run_id;
    const pass = verify(root).out.data.history.run_id;
    // aborted：结果文件被删除且不配置预跑
    const cfgPath = join(root, 'logos/logos.config.json');
    const cfg = readJson(cfgPath); delete cfg.verify.pre_run_command; writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    rmSync(join(root, RESULTS));
    const aborted = readJson(join(root, verify(root).err.error.details.history.index_path)).run_id;
    // smoke 记录由夹具直接写入中央索引文件（smoke 写历史属切片 2）
    const smokeId = '20991231T235959999Z-smoke-abcdef';
    const base = readIndex(root, pass);
    writeFileSync(join(root, HISTORY_DIR, `${smokeId}.json`), JSON.stringify({
      ...base, run_id: smokeId, kind: 'smoke', started_at: '2099-12-31T23:59:59.999Z', verify_mode: null, environment: 'test', deploy_id: 'd-1',
    }));
    const list = (...a: string[]) => cli(root, ['history', 'list', ...a, '--format', 'json']).out.data.runs.map((r: any) => r.run_id);
    expect(list('--kind', 'verify', '--result', 'fail')).toEqual([fail]);
    expect(list('--result', 'aborted')).toEqual([aborted]);
    expect(list('--kind', 'smoke')).toEqual([smokeId]);
    expect(list('--limit', '1')).toEqual([smokeId]);
    expect(list('--kind', 'verify')).toEqual([aborted, pass, fail]);
    const missing = cli(root, ['history', 'show', '20000101T000000000Z-verify-ffffff', '--format', 'json']);
    expect(missing.status).toBe(1);
    expect(missing.err.error.code).toBe('HISTORY_RUN_NOT_FOUND');
    const text = cli(root, ['history', 'list']);
    const lines = text.stdout.trim().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines.find(l => l.includes(fail))).toMatch(/verify\s+vh-demo\s+FAIL\s+失败用例: 1/);
  });

  it('UT-S13-156: 历史路径被 git 忽略时照常写入并给出路径', () => {
    const root = vh({ gitignore: '/logos/resources/*\n', git: true });
    const headBefore = git(root, 'rev-parse', 'HEAD').trim();
    const indexBefore = sha(join(root, '.git', 'index'));
    const r = verify(root);
    const rel = r.out.data.history.index_path;
    expect(existsSync(join(root, rel))).toBe(true);
    expect(rel).toBe(`${HISTORY_DIR}/${r.out.data.history.run_id}.json`);
    const text = cli(root, ['verify']);
    expect(text.stdout).toMatch(new RegExp(`验收历史：${HISTORY_DIR}/.*\\.json`));
    expect(git(root, 'status', '--porcelain')).not.toContain(HISTORY_DIR);
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(headBefore);
    expect(sha(join(root, '.git', 'index'))).toBe(indexBefore);
    git(root, 'add', '-f', rel);
    expect(git(root, 'diff', '--cached', '--name-only')).toContain(rel);
  });

  it('ST-S13-38: 端到端：失败轮与通过轮在归档后仍可追溯', () => {
    const root = vh();
    const r1 = verify(root, { VH_FAIL: 'UT-S01-02' });
    const firstId = r1.out.data.history.run_id;
    expect(existsSync(join(root, 'logos/changes', SLUG, 'verify-runs', firstId))).toBe(true);
    const r2 = verify(root);
    expect(existsSync(join(root, 'logos/changes', SLUG, 'VERIFY_PASS'))).toBe(true);
    expect(existsSync(join(root, 'logos/changes', SLUG, 'VERIFY_FAIL'))).toBe(false);
    const archived = cli(root, ['archive', SLUG]);
    expect(archived.status).toBe(0);
    const runs = cli(root, ['history', 'list', '--slug', SLUG, '--format', 'json']).out.data.runs;
    expect(runs.map((r: any) => [r.run_id, r.gate.result])).toEqual([[r2.out.data.history.run_id, 'PASS'], [firstId, 'FAIL']]);
    const show = cli(root, ['history', 'show', firstId, '--format', 'json']).out.data;
    expect(show.full_record.path).toMatch(new RegExp(`^logos/changes/archive/[^/]+-${SLUG}/verify-runs/${firstId}$`));
    expect(show.run.failed_ids).toEqual(['UT-S01-02']);
    expect(gateLine(readFileSync(join(root, show.full_record.report_path), 'utf8'))).toBe('FAIL');
    expect(readFileSync(join(root, show.full_record.results_path), 'utf8')).toContain('"UT-S01-02"');
  });

  it('ST-S13-39: 新克隆与两分支各验收一次后合并无冲突', () => {
    const origin = vh({ proposal: false, git: true });
    const bare = join(dirname(origin), `${origin.split('/').pop()}-bare.git`);
    spawnSync('git', ['clone', '-q', '--bare', origin, bare]);
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }));
    const clone = (name: string) => {
      const dir = join(dirname(origin), `${origin.split('/').pop()}-${name}`);
      spawnSync('git', ['clone', '-q', bare, dir]);
      cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
      git(dir, 'config', 'user.email', 'vh@example.invalid');
      git(dir, 'config', 'user.name', 'vh');
      return dir;
    };
    const a = clone('a');
    const b = clone('b');
    git(a, 'checkout', '-q', '-b', 'branch-a');
    git(b, 'checkout', '-q', '-b', 'branch-b');
    const ra = verify(a).out.data.history.run_id;
    const rb = verify(b).out.data.history.run_id;
    for (const [dir, br] of [[a, 'branch-a'], [b, 'branch-b']] as const) {
      git(dir, 'add', HISTORY_DIR);
      git(dir, 'commit', '-qm', `history ${br}`);
      git(dir, 'push', '-q', 'origin', br);
    }
    git(a, 'fetch', '-q', 'origin');
    const merge = spawnSync('git', ['merge', '--no-edit', 'origin/branch-b'], { cwd: a, encoding: 'utf8' });
    expect(merge.status).toBe(0);
    expect(historyFiles(a)).toEqual([`${ra}.json`, `${rb}.json`].sort());
    git(a, 'push', '-q', 'origin', 'branch-a');
    const c = clone('c');
    git(c, 'checkout', '-q', 'branch-a');
    const runs = cli(c, ['history', 'list', '--format', 'json']).out.data.runs.map((r: any) => r.run_id).sort();
    expect(runs).toEqual([ra, rb].sort());
    const show = cli(c, ['history', 'show', ra, '--format', 'json']).out.data;
    expect(show.full_record).toBe('unavailable');
    expect(show.unavailable_reason).toBe('no_proposal');
  });
});

// 仓库内根规范：schema 目标字节已写入（切片 1 交付项）
describe('S13 verify.history 配置 schema', () => {
  it('spec/logos.config.schema.json 可解析且含 verify.history.raw_in_proposal（切片 1 交付的 schema 目标字节）', () => {
    const schema = readJson(join(REPO_ROOT, 'spec', 'logos.config.schema.json'));
    expect(schema.properties.verify.properties.history.properties.raw_in_proposal).toMatchObject({ type: 'boolean', default: true });
  });
});
