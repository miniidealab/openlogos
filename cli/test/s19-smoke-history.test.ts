/**
 * S19 smoke 验收历史留存（verification-history，切片 2）。
 * 覆盖 UT-S19-100～UT-S19-107、ST-S19-34，以及 S13 中 smoke 参与运行锁冲突的 UT-S13-147
 * （与 core-S19-test-cases.md「S19 smoke 验收历史留存测试（verification-history）」、core-S13-test-cases.md 对齐）。
 *
 * 夹具 SH：一次性 git 项目，单模块 core（launched，deployment_gates 要求部署与 smoke），已合并 smoke 规格定义
 * SMOKE-core-901、SMOKE-core-902；`smoke.command` 指向记录型 runner（tools/mode.json 决定结果、可写入敏感占位值、
 * 可删除预创建的结果文件、可阻塞等待放行）；环境登记表含 test，活跃提案 sh-demo 经 `deploy-done --env test` 落账。
 * 全部经真实 CLI（dist/index.js）子进程驱动，断言读回磁盘文件。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl（scenario_id=S19 / S13）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { detectRuntimeWriteProtection } from '../src/lib/sandbox.js';

vi.setConfig({ testTimeout: 120_000 });

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'index.js');
const SLUG = 'sh-demo';
const SECRET = 'SECRET-PLACEHOLDER-7f3a';
const HISTORY_DIR = 'logos/resources/verify/history';
const RESULT_REL = 'logos/resources/verify/smoke-results.jsonl';
const IDS = ['SMOKE-core-901', 'SMOKE-core-902'];
const REGISTRY = 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test}\n';

const RUNNER = `const fs = require('fs'); const path = require('path');
const mode = JSON.parse(fs.readFileSync('tools/mode.json', 'utf8'));
const out = process.env.OPENLOGOS_SMOKE_RESULT_PATH || mode.out || 'logos/resources/verify/smoke-results.jsonl';
if (mode.block) {
  fs.writeFileSync(mode.block + '.started', '');
  const end = Date.now() + 60000;
  while (!fs.existsSync(mode.block) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}
if (mode.rows === 'delete') { try { fs.unlinkSync(out); } catch {} process.exit(0); }
fs.mkdirSync(path.dirname(out), { recursive: true });
const rows = mode.rows === 'none' ? [] : ${JSON.stringify(IDS)}.map(id => (mode.fail || []).includes(id)
  ? { id, status: 'fail', target_environment: process.env.OPENLOGOS_SMOKE_ENV, error: 'boom', detail: 'runner detail ' + (mode.detail || '') }
  : { id, status: 'pass', target_environment: process.env.OPENLOGOS_SMOKE_ENV, detail: 'ok ' + (mode.detail || '') });
fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\\n') + (rows.length ? '\\n' : ''));
// 先写完结果，再把另一项白名单产物（共用报告路径）写成 symlink：结果文件照常回收统计，报告产物回收校验失败 → 沙箱 fail
if (mode.symlinkReport) { const rp = 'logos/resources/verify/smoke-report.md'; try { fs.unlinkSync(rp); } catch {} fs.symlinkSync('smoke-results.jsonl', rp); }
`;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

interface ShOptions { registry?: boolean; command?: boolean; config?: Record<string, unknown>; deploy?: boolean }

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function git(root: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
function mode(root: string, m: Record<string, unknown>): void { put(root, 'tools/mode.json', JSON.stringify(m)); }

function sh(opts: ShOptions = {}): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.smoke = {
    result_path: RESULT_REL, report_path: 'logos/resources/verify/smoke-report.md', sandbox_mode: 'off',
    ...(opts.command === false ? {} : { command: 'node tools/runner.js' }), ...(opts.config ?? {}),
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  writeFileSync(join(root, 'logos/logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }));
  put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', `# Smoke\n\n| ID | 描述 |\n|---|---|\n${IDS.map(id => `| ${id} | ${id} |`).join('\n')}\n`);
  put(root, 'tools/runner.js', RUNNER);
  mode(root, {});
  put(root, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nok\n');
  if (opts.registry !== false) put(root, 'logos/environments.yaml', REGISTRY);
  const dir = join(root, 'logos/changes', SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), [
    `# 变更提案：${SLUG}`, '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：test',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
  ].join('\n'));
  writeFileSync(join(dir, 'tasks.md'), ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [x] 发布'].join('\n'));
  writeFileSync(join(dir, 'VERIFY_PASS'), '');
  put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core' }));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'user.email', 't@example.invalid');
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  if (opts.deploy !== false) {
    if (opts.registry === false) writeFileSync(join(dir, 'DEPLOY_DONE'), '');
    else {
      const r = cli(root, ['deploy-done', '--env', 'test', '--ref', 'HEAD']);
      if (r.status !== 0) throw new Error(`deploy-done 失败：${r.stderr}`);
    }
  }
  return root;
}

interface CliRun { status: number | null; stdout: string; stderr: string; out: any; err: any }
function parseLast(text: string): any {
  const line = text.split('\n').reverse().find(l => l.trim().startsWith('{'));
  if (!line) return null;
  try { return JSON.parse(line); } catch { return null; }
}
function cli(root: string, args: string[], env: Record<string, string | undefined> = {}): CliRun {
  const merged: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', ...env };
  for (const k of Object.keys(merged)) if (k.startsWith('OPENLOGOS_SMOKE_') || k.startsWith('OPENLOGOS_VERIFY_')) delete merged[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) merged[k] = v;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', env: merged as NodeJS.ProcessEnv, timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: parseLast(r.stdout ?? ''), err: parseLast(r.stderr ?? '') };
}
const smokeJson = (root: string, env = 'test', extra: Record<string, string | undefined> = {}) =>
  cli(root, ['smoke', ...(env ? ['--env', env] : []), '--format', 'json'], extra);
function readJson(p: string): any { return JSON.parse(readFileSync(p, 'utf8')); }
function readIndex(root: string, runId: string): any { return readJson(join(root, HISTORY_DIR, `${runId}.json`)); }
function historyFiles(root: string): string[] {
  const d = join(root, HISTORY_DIR);
  return existsSync(d) ? readdirSync(d).filter(n => n.endsWith('.json')).sort() : [];
}
function allFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) allFiles(p, out); else out.push(p); }
  return out;
}
const grep = (dir: string, needle: string) => allFiles(dir).filter(p => readFileSync(p, 'utf8').includes(needle));
const smokeGate = (report: string) => (report.match(/Gate 3\.8[^\n]*?(PASS|FAIL)/) ?? [])[1];
const lastDeployId = (root: string) => readFileSync(join(root, 'logos/.openlogos-runtime/deployments.jsonl'), 'utf8')
  .trim().split('\n').map(l => JSON.parse(l)).filter(r => r.kind === 'deploy').pop().deploy_id;
async function waitFor(path: string): Promise<void> {
  const end = Date.now() + 30_000;
  while (!existsSync(path) && Date.now() < end) await new Promise(r => setTimeout(r, 50));
  if (!existsSync(path)) throw new Error(`等待超时：${path}`);
}

describe('S19 smoke 验收历史留存（verification-history）', () => {
  it('UT-S19-100: 连续两次 smoke 后两条历史含环境与 deploy_id', () => {
    const root = sh();
    mode(root, { fail: ['SMOKE-core-902'] });
    const first = smokeJson(root);
    mode(root, {});
    const second = smokeJson(root);
    expect(first.status).toBe(1);
    expect(second.status).toBe(0);
    const r1 = first.out.data.history.run_id;
    const r2 = second.out.data.history.run_id;
    const list = cli(root, ['history', 'list', '--kind', 'smoke', '--format', 'json']).out.data.runs;
    expect(list.map((r: any) => [r.run_id, r.gate.result])).toEqual([[r2, 'PASS'], [r1, 'FAIL']]);
    const deployId = lastDeployId(root);
    for (const r of list) expect(r).toMatchObject({ kind: 'smoke', environment: 'test', deploy_id: deployId });
    const show = cli(root, ['history', 'show', r1, '--format', 'json']).out.data;
    expect(show.run.failed_ids).toEqual(['SMOKE-core-902']);
    expect(existsSync(join(root, show.full_record.path, 'results.jsonl'))).toBe(true);
    expect(existsSync(join(root, 'logos/changes', SLUG, 'verify-runs', r2, 'record.json'))).toBe(true);
  });

  it('UT-S19-101: runner detail 的 Git 可见范围', () => {
    for (const raw of [true, false]) {
      const root = sh();
      if (!raw) {
        const cfgPath = join(root, 'logos/logos.config.json');
        const cfg = readJson(cfgPath); cfg.verify = { ...cfg.verify, history: { raw_in_proposal: false } };
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      }
      mode(root, { detail: SECRET });
      const r = smokeJson(root);
      const runId = r.out.data.history.run_id;
      expect(readFileSync(join(root, HISTORY_DIR, `${runId}.json`), 'utf8')).not.toContain(SECRET);
      const runDir = join(root, 'logos/changes', SLUG, 'verify-runs', runId);
      const local = join(root, 'logos/.openlogos-runtime/verify-runs', runId);
      if (raw) {
        expect(readFileSync(join(runDir, 'results.jsonl'), 'utf8')).toContain(SECRET);
        expect(existsSync(join(runDir, 'report.md'))).toBe(true);
      } else {
        expect(grep(runDir, SECRET)).toEqual([]);
        expect(existsSync(join(runDir, 'report.md'))).toBe(false);
        expect(grep(local, SECRET).length).toBeGreaterThan(0);
      }
    }
  });

  it('UT-S19-102: 既有早退仍留历史，空结果不算早退', () => {
    // ① 不配置命令且结果文件不存在
    const r1root = sh({ command: false });
    const r1 = smokeJson(r1root);
    expect(r1.status).toBe(1);
    expect(r1.err.error.code).toBe('NO_SMOKE_RESULTS');
    const i1 = readJson(join(r1root, r1.err.error.details.history.index_path));
    expect(i1).toMatchObject({ kind: 'smoke', outcome: 'aborted', error_code: 'NO_SMOKE_RESULTS', gate: { result: null }, result_source: 'reused' });
    // ② 没有 smoke 用例规格
    const r2root = sh();
    rmSync(join(r2root, 'logos/resources/test/smoke/core-smoke-test-cases.md'));
    const r2 = smokeJson(r2root);
    expect(r2.status).toBe(1);
    expect(r2.err.error.code).toBe('NO_SMOKE_CASES');
    expect(readJson(join(r2root, r2.err.error.details.history.index_path))).toMatchObject({ outcome: 'aborted', error_code: 'NO_SMOKE_CASES' });
    // ③ 命令运行后不写任何行：空文件仍在 → completed / FAIL / 全部未覆盖
    const r3root = sh();
    mode(r3root, { rows: 'none' });
    const r3 = smokeJson(r3root);
    expect(r3.out.data.gate.result).toBe('FAIL');
    expect(readIndex(r3root, r3.out.data.history.run_id)).toMatchObject({ outcome: 'completed', uncovered_ids: IDS });
    // ④ runner 删除预创建的结果文件后替换失败 → NO_SMOKE_RESULTS、executed
    const r4root = sh();
    mode(r4root, { rows: 'delete' });
    const r4 = smokeJson(r4root);
    expect(r4.status).toBe(1);
    expect(r4.err.error.code).toBe('NO_SMOKE_RESULTS');
    expect(readJson(join(r4root, r4.err.error.details.history.index_path))).toMatchObject({ outcome: 'aborted', result_source: 'executed' });
  });

  it('UT-S19-103: 未配置命令时标 reused', () => {
    const root = sh({ command: false });
    put(root, RESULT_REL, IDS.map(id => JSON.stringify({ id, status: 'pass', target_environment: 'test' })).join('\n') + '\n');
    const r = smokeJson(root);
    expect(r.out.data.gate.result).toBe('PASS');
    expect(readIndex(root, r.out.data.history.run_id).result_source).toBe('reused');
  });

  it.skipIf(!detectRuntimeWriteProtection().available)('UT-S19-104: 无登记表时沙箱失败改判，报告与历史均为 FAIL', () => {
    const root = sh({ registry: false, config: { sandbox_mode: 'always' } });
    mode(root, { symlinkReport: true });
    const r = smokeJson(root, '');
    expect(r.out.data.sandbox.status).toBe('fail');
    expect(r.out.data.summary.passed_count).toBe(2);
    expect(r.out.data.gate.result).toBe('FAIL');
    const shared = readFileSync(join(root, 'logos/resources/verify/smoke-report.md'));
    expect(smokeGate(shared.toString())).toBe('FAIL');
    const runId = r.out.data.history.run_id;
    expect(readIndex(root, runId).gate.result).toBe('FAIL');
    expect(readFileSync(join(root, 'logos/changes', SLUG, 'verify-runs', runId, 'report.md')).equals(shared)).toBe(true);
  });

  it('UT-S19-105: smoke 报告与结果文件零回归', () => {
    for (const fail of [false, true]) {
      const root = sh();
      mode(root, fail ? { fail: ['SMOKE-core-901'] } : {});
      const r = smokeJson(root);
      const report = readFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'utf8');
      expect(smokeGate(report)).toBe(r.out.data.gate.result);
      const rows = readFileSync(join(root, RESULT_REL), 'utf8').trim().split('\n').map(l => JSON.parse(l).id);
      expect(rows).toEqual(IDS);
      const marker = (n: string) => existsSync(join(root, 'logos/changes', SLUG, n));
      expect(marker(fail ? 'SMOKE_FAIL' : 'SMOKE_PASS')).toBe(true);
      expect(marker(fail ? 'SMOKE_PASS' : 'SMOKE_FAIL')).toBe(false);
      const ledger = readFileSync(join(root, 'logos/.openlogos-runtime/deployments.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
      expect(ledger.filter(l => l.kind === 'smoke').pop()).toMatchObject({ result: fail ? 'fail' : 'pass', environment: 'test' });
      expect(Object.keys(r.out.data)).toContain('history');
      expect(Object.keys(r.out.data).filter(k => k !== 'history')).toEqual(expect.arrayContaining(['summary', 'gate', 'environment_evidence', 'report_path', 'result_path']));
    }
    // 模块级 report_path 覆盖（无模块配置时回落项目级）：报告路径照旧生效
    const root = sh({ config: { report_path: 'logos/resources/verify/custom-smoke-report.md' } });
    const r = smokeJson(root);
    expect(r.out.data.report_path).toBe('logos/resources/verify/custom-smoke-report.md');
    expect(existsSync(join(root, 'logos/resources/verify/custom-smoke-report.md'))).toBe(true);
  });

  it('UT-S19-106: 按 smoke 类型筛选', () => {
    const root = sh();
    smokeJson(root);
    smokeJson(root);
    // verify 两条由夹具直接写入中央索引（verify 写历史由切片 1 覆盖）
    const base = readJson(join(root, HISTORY_DIR, historyFiles(root)[0]));
    for (const id of ['20000101T000000000Z-verify-aaaaaa', '20000101T000000001Z-verify-bbbbbb']) {
      writeFileSync(join(root, HISTORY_DIR, `${id}.json`), JSON.stringify({ ...base, run_id: id, kind: 'verify', started_at: `2000-01-01T00:00:00.00${id[18]}Z`, environment: null, deploy_id: null }));
    }
    const runs = cli(root, ['history', 'list', '--kind', 'smoke', '--format', 'json']).out.data.runs;
    expect(runs).toHaveLength(2);
    expect(runs.every((r: any) => r.kind === 'smoke')).toBe(true);
    expect(runs[0].started_at >= runs[1].started_at).toBe(true);
  });

  it('UT-S19-107: 不同结果路径、相同报告路径的并发', async () => {
    const root = sh();
    const flag = join(root, 'alpha.flag');
    // alpha：结果路径 A，全部通过；写完共用报告后在测试暂停点停住
    const alpha = spawn(process.execPath, [CLI, 'smoke', '--env', 'test', '--format', 'json'], {
      cwd: root, env: { ...process.env, NO_COLOR: '1', OPENLOGOS_TEST_HISTORY_PAUSE_AFTER_REPORT: flag },
    });
    const alphaOut: string[] = [];
    alpha.stdout.on('data', d => alphaOut.push(String(d)));
    await waitFor(`${flag}.paused`);
    expect(smokeGate(readFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'utf8'))).toBe('PASS');
    // beta：结果路径 B（与 alpha 不同，运行锁不冲突），报告路径相同；一条失败
    const cfgPath = join(root, 'logos/logos.config.json');
    const cfg = readJson(cfgPath); cfg.smoke.result_path = 'logos/resources/verify/smoke-results-beta.jsonl';
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    mode(root, { fail: ['SMOKE-core-902'] });
    const beta = smokeJson(root);
    expect(beta.status).toBe(1);
    expect(beta.out.data.gate.result).toBe('FAIL');
    writeFileSync(flag, '');
    const code: number = await new Promise(r => alpha.on('close', c => r(c ?? -1)));
    expect(code).toBe(0);
    const alphaData = parseLast(alphaOut.join('')).data;
    // alpha 不再重写共用报告：共用报告仍为 beta 的 FAIL
    expect(smokeGate(readFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'utf8'))).toBe('FAIL');
    const runDir = (id: string) => join(root, 'logos/changes', SLUG, 'verify-runs', id);
    expect(readIndex(root, alphaData.history.run_id).gate.result).toBe('PASS');
    expect(smokeGate(readFileSync(join(runDir(alphaData.history.run_id), 'report.md'), 'utf8'))).toBe('PASS');
    expect(readIndex(root, beta.out.data.history.run_id).gate.result).toBe('FAIL');
    expect(smokeGate(readFileSync(join(runDir(beta.out.data.history.run_id), 'report.md'), 'utf8'))).toBe('FAIL');
  });

  it('ST-S19-34: 端到端：smoke 失败轮与通过轮可追溯', () => {
    const root = sh();
    mode(root, { fail: ['SMOKE-core-902'] });
    const r1 = smokeJson(root);
    expect(existsSync(join(root, 'logos/changes', SLUG, 'SMOKE_FAIL'))).toBe(true);
    mode(root, {});
    const r2 = smokeJson(root);
    expect(existsSync(join(root, 'logos/changes', SLUG, 'SMOKE_PASS'))).toBe(true);
    const runs = cli(root, ['history', 'list', '--kind', 'smoke']).stdout.trim().split('\n');
    expect(runs[0]).toContain(r2.out.data.history.run_id);
    expect(runs[1]).toContain(r1.out.data.history.run_id);
    const show = cli(root, ['history', 'show', r1.out.data.history.run_id, '--format', 'json']).out.data;
    expect(show.run).toMatchObject({ environment: 'test', deploy_id: lastDeployId(root), failed_ids: ['SMOKE-core-902'] });
    expect(readFileSync(join(root, show.full_record.results_path), 'utf8')).toContain('"SMOKE-core-902"');
    expect(smokeGate(readFileSync(join(root, show.full_record.report_path), 'utf8'))).toBe('FAIL');
  });
});

describe('S13 运行锁与 smoke 共享阶段结果路径', () => {
  it('UT-S13-147: 只共享阶段结果路径或只读既有结果也参加冲突判定', async () => {
    const root = sh();
    // verify 两阶段：regression 结果路径与 smoke.result_path 相同
    put(root, 'logos/resources/test/core-S01-test-cases.md', '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n');
    put(root, 'tools/reg.cjs', `const fs = require('fs');
const m = JSON.parse(fs.readFileSync('tools/mode.json', 'utf8'));
if (m.vblock) { fs.writeFileSync(m.vblock + '.started', ''); const end = Date.now() + 60000;
  while (!fs.existsSync(m.vblock) && Date.now() < end) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
fs.writeFileSync('logos/resources/verify/reg.jsonl', JSON.stringify({ id: 'UT-S01-01', status: 'pass' }) + '\\n');`);
    const cfgPath = join(root, 'logos/logos.config.json');
    const cfg = readJson(cfgPath);
    cfg.verify = { ...cfg.verify, sandbox_mode: 'off', regression_command: 'node tools/reg.cjs', incremental_command: 'node -e "0"',
      regression_result_path: 'logos/resources/verify/reg.jsonl', incremental_result_path: 'logos/resources/verify/inc.jsonl' };
    cfg.smoke.result_path = 'logos/resources/verify/reg.jsonl';
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const flag = join(root, 'v.flag');
    mode(root, { vblock: flag });
    const v = spawn(process.execPath, [CLI, 'verify', '--format', 'json'], { cwd: root, env: { ...process.env, NO_COLOR: '1' } });
    await waitFor(`${flag}.started`);
    put(root, 'logos/resources/verify/reg.jsonl', 'sentinel\n');
    const before = readFileSync(join(root, 'logos/resources/verify/reg.jsonl'), 'utf8');
    const busy = smokeJson(root);
    expect(busy.status).toBe(2);
    expect(busy.err.error.code).toBe('RESULT_PATH_BUSY');
    expect(busy.err.error.details.paths).toContain('logos/resources/verify/reg.jsonl');
    expect(readFileSync(join(root, 'logos/resources/verify/reg.jsonl'), 'utf8')).toBe(before);
    writeFileSync(flag, '');
    await new Promise(r => v.on('close', r));
    const smokeHistory = historyFiles(root).filter(n => n.includes('-smoke-'));
    expect(smokeHistory).toEqual([]);
    // 变体：持锁的是只读取既有结果的 verify（无预跑命令，停在测试暂停点），配置预跑的 verify 被拒
    const root2 = sh();
    put(root2, 'logos/resources/test/core-S01-test-cases.md', '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n');
    put(root2, 'logos/resources/verify/test-results.jsonl', JSON.stringify({ id: 'UT-S01-01', status: 'pass' }) + '\n');
    const cfg2Path = join(root2, 'logos/logos.config.json');
    const cfg2 = readJson(cfg2Path); cfg2.verify = { ...cfg2.verify, sandbox_mode: 'off' }; delete cfg2.verify.pre_run_command;
    writeFileSync(cfg2Path, JSON.stringify(cfg2, null, 2));
    const flag2 = join(root2, 'reuse.flag');
    const reuse = spawn(process.execPath, [CLI, 'verify', '--format', 'json'], {
      cwd: root2, env: { ...process.env, NO_COLOR: '1', OPENLOGOS_TEST_HISTORY_PAUSE_AFTER_REPORT: flag2 },
    });
    const reuseOut: string[] = [];
    reuse.stdout.on('data', d => reuseOut.push(String(d)));
    await waitFor(`${flag2}.paused`);
    cfg2.verify.pre_run_command = 'node -e "0"';
    writeFileSync(cfg2Path, JSON.stringify(cfg2, null, 2));
    const resultsBefore = readFileSync(join(root2, 'logos/resources/verify/test-results.jsonl'), 'utf8');
    const rejected = cli(root2, ['verify', '--format', 'json']);
    expect(rejected.status).toBe(2);
    expect(rejected.err.error.code).toBe('RESULT_PATH_BUSY');
    expect(readFileSync(join(root2, 'logos/resources/verify/test-results.jsonl'), 'utf8')).toBe(resultsBefore);
    writeFileSync(flag2, '');
    await new Promise(r => reuse.on('close', r));
    expect(readIndex(root2, parseLast(reuseOut.join('')).data.history.run_id).result_source).toBe('reused');
    expect(historyFiles(root2)).toHaveLength(1);
  });
});
