/**
 * verify-git-local-only 切片 2：发布级验收、发布查询与验收历史的 git 调用只读本地（功能规格 §2.111.1、§2.111.2、§2.111.4、§2.111.5）。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 验收期间的 git 调用只读本地测试」严格对齐：
 * UT-S13-312、317、319、320。（范围计算的用例属于切片 1：s13-verify-git-local-scope.test.ts。）
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 观测都不从 CLI 输出推断，且不依赖 PATH 查找与可执行脚本（Windows 上同样可用）：
 *   - 远端接入记录、对象库快照；
 *   - git 调用记录：只读 git 执行入口经测试接缝用 node 启动记录型程序，记下实际收到的参数与三个约束变量后转交真实的 git；
 *   - git 跟踪（GIT_TRACE）：git 自己记下进程树里的每一次调用，用来确认 verify 启动的 git 调用没有绕过执行入口的；
 *   - 只读 git 执行入口的时限记录（仅测试可用的接缝，记下每次调用请求的时限）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { TEST_TRACE_ENV } from '../src/lib/git-readonly.js';
import { createScopeProject, runVerify as runMsVerify } from './golden/s13-module-scope-fixture.mjs';
import { msProposal } from './golden/s13-shared-config-fixture.mjs';
import { createLv, destroyLv, git as lvGit, lvEnv, runVerify as runLvVerify } from './golden/s13-layered-fixture.mjs';
import {
  attachRemote, cleanupScratch, installGitRecorder, makeRemoteOnlyCommit, objectSnapshot, plainGit, readGitCalls, readGitTrace, remoteHits, scratchDir,
} from './golden/s13-git-local-fixture.mjs';

vi.setConfig({ testTimeout: 300_000 });

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const HISTORY_DIR = 'logos/resources/verify/history';

type Lv = ReturnType<typeof createLv>;
const lvs: Lv[] = [];
const roots: string[] = [];
const cleanups: Array<() => void> = [];
afterEach(() => {
  while (lvs.length) destroyLv(lvs.pop()!);
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  while (cleanups.length) cleanups.pop()!();
  cleanupScratch();
});
function lv(opts: Record<string, unknown> = {}): Lv {
  const f = createLv({ buildTestChangeSet, ...opts });
  lvs.push(f);
  return f;
}
const rel = (opts: Record<string, unknown> = {}): Lv => lv({ rel: true, ...opts });

function parseErr(stderr: string): any {
  const line = stderr.split('\n').reverse().find(l => l.trim().startsWith('{'));
  try { return line ? JSON.parse(line).error : null; } catch { return null; }
}
function lvCli(f: Lv, args: string[], env: Record<string, string | undefined> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: f.root, encoding: 'utf8', env: lvEnv(f, env), timeout: 120_000 });
  const line = (r.stdout ?? '').split('\n').reverse().find(l => l.trim().startsWith('{'));
  let data: any = null;
  try { data = line ? JSON.parse(line).data : null; } catch { /* 文本模式 */ }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', data, error: parseErr(r.stderr ?? '') };
}
const release = (f: Lv, env: Record<string, string | undefined> = {}) => runLvVerify(CLI, f, { args: ['--release', '--format', 'json'], env });
const check = (f: Lv, args: string[] = [], env: Record<string, string | undefined> = {}) =>
  lvCli(f, ['verify', '--release', '--check', ...args, '--format', 'json'], env);
const head = (root: string): string => plainGit(root, ['rev-parse', 'HEAD']).stdout;
const historyRecords = (root: string): any[] => {
  const dir = join(root, HISTORY_DIR);
  return existsSync(dir) ? readdirSync(dir).filter(n => n.endsWith('.json')).sort().map(n => JSON.parse(readFileSync(join(dir, n), 'utf8'))) : [];
};

/** git 调用记录 + 时限记录。 */
function observers() {
  const rec = installGitRecorder();
  const trace = join(scratchDir('trace'), 'timeouts.jsonl');
  return {
    rec, trace,
    env: (extra: Record<string, string> = {}) => rec.env({ [TEST_TRACE_ENV]: trace, ...extra }),
    calls: () => readGitCalls(rec),
    traced: () => readGitTrace(rec),
    timeouts: (): Array<{ args: string[]; timeout_ms: number }> =>
      (existsSync(trace) ? readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []),
  };
}
type GitCall = { args: string; allowProtocol: string; noLazyFetch: string; terminalPrompt: string };
const constrained = (c: GitCall) => c.allowProtocol === '' && c.noLazyFetch === '1' && c.terminalPrompt === '0';
const unconstrained = (c: GitCall) => c.allowProtocol === '<unset>' && c.noLazyFetch === '<unset>' && c.terminalPrompt === '<unset>';
const HISTORY_HEAD = 'rev-parse HEAD';
const HISTORY_STATUS = 'status --porcelain --untracked-files=no';
const RUNNER_COMMIT = 'commit -q --allow-empty -m during-run';
/** git 跟踪里的参数会给含特殊字符的参数加单引号；比较前去掉。 */
const unquote = (text: string) => text.replace(/'/g, '');
/**
 * 进程树里的每一次 git 调用（git 跟踪）要么经过了只读执行入口（出现在 git 调用记录里，逐条配对），
 * 要么属于允许的例外（测试入口自己启动的调用、git 自己派生的维护命令）。返回没有经过执行入口的调用。
 */
function outsideEntry(traced: string[], recorded: GitCall[]): string[] {
  const pool = recorded.map(c => unquote(c.args));
  const outside: string[] = [];
  for (const entry of traced.map(unquote)) {
    const at = pool.indexOf(entry);
    if (at >= 0) pool.splice(at, 1);
    else outside.push(entry);
  }
  return outside;
}
const isGitHousekeeping = (args: string) => /^(maintenance|gc|pack-refs|reflog|prune|repack|pack-objects|rev-list)\b/.test(args);
/** 记录测试入口实际收到的三个约束变量，再转交给记录型入口本身。 */
const ENV_PROBE = `import fs from 'node:fs';
const pick = key => (key in process.env ? process.env[key] : '<unset>');
fs.writeFileSync(process.env.VGL_PROBE_FILE, JSON.stringify({ allowProtocol: pick('GIT_ALLOW_PROTOCOL'), noLazyFetch: pick('GIT_NO_LAZY_FETCH'), terminalPrompt: pick('GIT_TERMINAL_PROMPT') }));
await import('./lv-runner.mjs');
`;

describe('S13 验收期间的 git 调用只读本地 — 发布查询', () => {
  it('UT-S13-312: 发布查询指定的提交本地不存在时不连接远端并照旧拒绝', () => {
    const f = rel();
    const remote = attachRemote(f.root);
    // 只存在于远端的提交；夹具先以不加保护的读取证明远端接入记录有区分力，再恢复缺失状态
    const { commit, snapshot } = makeRemoteOnlyCommit(f.root, remote);
    const statusBefore = plainGit(f.root, ['status', '--porcelain', '--untracked-files=all']).stdout;
    const historyBefore = historyRecords(f.root).length;
    const run = check(f, ['--commit', commit]);
    expect(remoteHits(remote)).toBe(0);
    expect(objectSnapshot(f.root)).toEqual(snapshot);
    expect(run.status).toBe(2);
    expect(run.error?.code).toBe('RELEASE_CHECK_COMMIT_INVALID');
    // 只查询：测试入口没有被调用，没有写入任何报告、历史或标记
    expect(existsSync(f.log)).toBe(false);
    expect(plainGit(f.root, ['status', '--porcelain', '--untracked-files=all']).stdout).toBe(statusBefore);
    expect(historyRecords(f.root).length).toBe(historyBefore);
  });
});

describe('S13 验收期间的 git 调用只读本地 — 约束的施加范围与时限', () => {
  it('UT-S13-317: verify 启动的每个 git 调用都带三项约束，既有时限保留', () => {
    const expectTimeouts = (rows: Array<{ args: string[]; timeout_ms: number }>, label: string) => {
      expect(rows.length, label).toBeGreaterThan(0);
      for (const row of rows) {
        const joined = row.args.join(' ');
        const expected = joined === HISTORY_HEAD ? 10_000 : joined === HISTORY_STATUS ? 30_000 : 60_000;
        expect(row.timeout_ms, `${label}：${joined}`).toBe(expected);
      }
    };

    // ① 夹具 MS：提案级，按模块限定范围
    const root = createScopeProject();
    roots.push(root);
    msProposal(root);
    const a = observers();
    const ra = runMsVerify(CLI, root, { env: a.env() });
    expect(ra.data.gate.result).toBe('PASS');
    const callsA = a.calls() as GitCall[];
    expect(callsA.length).toBeGreaterThan(0);
    for (const c of callsA) expect(constrained(c), `① ${c.args}`).toBe(true);
    expectTimeouts(a.timeouts(), '①');
    expect(a.timeouts().map(r => r.args.join(' '))).toEqual(expect.arrayContaining([HISTORY_HEAD, HISTORY_STATUS]));

    // 没有绕过执行入口的 git 调用：git 跟踪里的每一次调用都在 git 调用记录里
    expect(a.traced().length).toBeGreaterThan(0);
    expect(outsideEntry(a.traced(), callsA).filter(x => !isGitHousekeeping(x)), '①').toEqual([]);

    // ② 夹具 LV：提案级，分层；测试入口在执行期间自己运行一次 git（新建空提交）——它不经过执行入口，也不继承这些约束
    const probeFile = join(scratchDir('probe'), 'runner-env.json');
    const f = lv({
      script: { during: { 1: 'commit' } },
      verify: { pre_run_command: 'node tools/probe.mjs project' },
      changes: { 'tools/probe.mjs': ENV_PROBE },
    });
    const b = observers();
    const rb = runLvVerify(CLI, f, { env: b.env({ VGL_PROBE_FILE: probeFile }) });
    expect(rb.data.gate.result).toBe('PASS');
    // 测试入口收到的环境里没有这三个约束变量：它内部启动的 git 不继承约束
    expect(unconstrained(JSON.parse(readFileSync(probeFile, 'utf8'))), '② 测试入口内部的 git 调用不继承约束').toBe(true);
    const callsB = b.calls() as GitCall[];
    expect(callsB.length).toBeGreaterThan(0);
    for (const c of callsB) expect(constrained(c), `② ${c.args}`).toBe(true);
    // git 跟踪看得到测试入口自己的那次提交（证明跟踪覆盖了执行入口之外的调用）；除它之外没有绕过执行入口的调用
    const outsideB = outsideEntry(b.traced(), callsB).filter(x => !isGitHousekeeping(x));
    expect(outsideB).toEqual([RUNNER_COMMIT]);
    expectTimeouts(b.timeouts(), '②');

    // ③ 夹具 LV-rel：发布级验收与发布查询
    const r = rel();
    const c1 = observers();
    const run = release(r, c1.env());
    expect(run.data.gate.result).toBe('PASS');
    const releaseCalls = c1.calls() as GitCall[];
    expect(releaseCalls.length).toBeGreaterThan(0);
    for (const c of releaseCalls) expect(constrained(c), `③ release ${c.args}`).toBe(true);
    for (const row of c1.timeouts()) expect(row.timeout_ms, `③ release ${row.args.join(' ')}`).toBe(60_000);
    expect(outsideEntry(c1.traced(), releaseCalls).filter(x => !isGitHousekeeping(x)), '③ release').toEqual([]);
    const c2 = observers();
    const checked = check(r, [], c2.env());
    expect(checked.status).toBe(0);
    const checkCalls = c2.calls() as GitCall[];
    expect(checkCalls.length).toBeGreaterThan(0);
    for (const c of checkCalls) expect(constrained(c), `③ check ${c.args}`).toBe(true);
    for (const row of c2.timeouts()) expect(row.timeout_ms, `③ check ${row.args.join(' ')}`).toBe(60_000);
    expect(outsideEntry(c2.traced(), checkCalls).filter(x => !isGitHousekeeping(x)), '③ check').toEqual([]);
  });
});

describe('S13 验收期间的 git 调用只读本地 — 验收历史', () => {
  it('UT-S13-319: 提案级 verify 的历史记录使用受约束读取的提交快照，smoke 的历史记录不变', () => {
    // ① 提案级 verify：夹具 LV 全部提交且工作区干净
    const f = lv({ commitAll: true });
    const a = observers();
    const run = runLvVerify(CLI, f, { env: a.env() });
    expect(run.data.gate.result).toBe('PASS');
    const record = historyRecords(f.root).find(r => r.run_id === run.data.history.run_id);
    expect(record.commit).toEqual({ head: head(f.root), dirty: false });
    const calls = a.calls() as GitCall[];
    const headCalls = calls.filter(c => c.args === HISTORY_HEAD);
    const statusCalls = calls.filter(c => c.args === HISTORY_STATUS);
    expect(headCalls.length).toBeGreaterThan(0);
    expect(statusCalls.length).toBeGreaterThan(0);
    for (const c of [...headCalls, ...statusCalls]) expect(constrained(c), `① ${c.args}`).toBe(true);
    const timeouts = a.timeouts();
    expect(timeouts.find(r => r.args.join(' ') === HISTORY_HEAD)?.timeout_ms).toBe(10_000);
    expect(timeouts.find(r => r.args.join(' ') === HISTORY_STATUS)?.timeout_ms).toBe(30_000);

    // ② smoke：写历史时读取提交号与工作区状态的调用不经只读执行入口
    const root = smokeProject();
    const b = observers();
    const smoke = smokeCli(root, ['smoke', '--env', 'test', '--format', 'json'], b.env());
    expect(smoke.out?.data?.history?.run_id, smoke.stderr.slice(0, 300)).toBeTruthy();
    // git 跟踪里有这两条读取（确实发生了），git 调用记录里没有（没有经过只读执行入口，也就不带约束）
    const traced = b.traced().map(unquote);
    expect(traced).toEqual(expect.arrayContaining([HISTORY_HEAD, HISTORY_STATUS]));
    const recorded = (b.calls() as GitCall[]).map(c => c.args);
    expect(recorded).not.toContain(HISTORY_HEAD);
    expect(recorded).not.toContain(HISTORY_STATUS);
    // 时限记录里同样没有它们；时限与环境仍由历史记录的读取函数决定：10 秒、30 秒，不传 env（继承进程环境）
    expect(b.timeouts().some(r => [HISTORY_HEAD, HISTORY_STATUS].includes(r.args.join(' ')))).toBe(false);
    const source = readFileSync(join(CLI_ROOT, 'src/lib/verification-history.ts'), 'utf8');
    const readCommit = source.slice(source.indexOf('function readCommit('), source.indexOf('function readCommit(') + 600);
    expect(readCommit).toContain("['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8', timeout: 10_000 }");
    expect(readCommit).toContain("['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf-8', timeout: 30_000 }");
    expect(readCommit.slice(0, readCommit.indexOf('return { head: head.stdout.trim()'))).not.toContain('env:');
    // 记录的 commit 与缺省读取的取值规则一致：提交号为 HEAD，dirty 按已跟踪文件是否有改动
    const smokeRecord = historyRecords(root).find(r => r.run_id === smoke.out.data.history.run_id);
    const dirty = plainGit(root, ['status', '--porcelain', '--untracked-files=no']).stdout.length > 0;
    expect(smokeRecord.commit).toEqual({ head: head(root), dirty });
  });

  it('UT-S13-320: 发布级验收的历史仍记在运行开始时固定的提交上', () => {
    // ① 执行期间新建一个提交（A → B），一条用例 fail——与既有 UT-S13-259 同一反例
    const f = rel({ script: { during: { 1: 'commit' }, cases: { 'UT-S02-01': 'fail' } } });
    const a = head(f.root);
    const obs = observers();
    const run = release(f, obs.env());
    const b = head(f.root);
    expect(b).not.toBe(a);
    const record = historyRecords(f.root).find(r => r.run_id === run.data.history.run_id);
    expect(record.level).toBe('release');
    expect(record.commit).toEqual({ head: a, dirty: false });
    const forA = check(f, ['--commit', a]);
    expect(forA.status).toBe(1);
    expect(forA.data).toMatchObject({ valid: false, reason: 'latest_failed', commit: a });
    const forB = check(f, ['--commit', b]);
    expect(forB.data.valid).toBe(false);
    expect(forB.data.latest).toBeNull();
    // 写历史阶段没有新增读取提交号的调用；前置检查与收尾复核的调用都带三项约束
    const calls = obs.calls() as GitCall[];
    expect(calls.some(c => c.args === HISTORY_HEAD || c.args === HISTORY_STATUS)).toBe(false);
    expect(calls.some(c => c.args.startsWith('rev-parse --verify --quiet HEAD'))).toBe(true);
    expect(calls.some(c => c.args.startsWith('status --porcelain=v1'))).toBe(true);
    for (const c of calls) expect(constrained(c), `① ${c.args}`).toBe(true);

    // ② 执行期间改写一个已跟踪的源码文件而不提交（HEAD 仍为 A），全部 pass：收尾复核的是 HEAD 与工作区
    const g = rel({ script: { during: { 1: 'modified' } } });
    const a2 = head(g.root);
    const run2 = release(g);
    expect(head(g.root)).toBe(a2);
    expect(run2.data.gate).toEqual({ result: 'FAIL', reason: 'release_commit_changed' });
    expect(run2.data.release).toMatchObject({ commit: a2, commit_unchanged: true, worktree_clean: false });
    const record2 = historyRecords(g.root).find(r => r.run_id === run2.data.history.run_id);
    expect(record2.commit).toEqual({ head: a2, dirty: false });
  });
});

// —— UT-S13-319 ② 的夹具：可写出 smoke 历史的最小项目（做法同 s19-smoke-history.test.ts 的夹具 SH）——

const SMOKE_SLUG = 'vgl-smoke';
const SMOKE_IDS = ['SMOKE-core-901', 'SMOKE-core-902'];
const SMOKE_RUNNER = `const fs = require('fs'); const path = require('path');
const out = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, ${JSON.stringify(SMOKE_IDS)}.map(id => JSON.stringify({ id, status: 'pass', target_environment: process.env.OPENLOGOS_SMOKE_ENV, detail: 'ok' })).join('\\n') + '\\n');
`;

function smokeCli(root: string, args: string[], env: Record<string, string | undefined> = {}) {
  const merged: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' };
  for (const k of Object.keys(merged)) if (k.startsWith('OPENLOGOS_SMOKE_') || k.startsWith('OPENLOGOS_VERIFY_')) delete merged[k];
  Object.assign(merged, env);
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8', env: merged as NodeJS.ProcessEnv, timeout: 120_000 });
  const line = (r.stdout ?? '').split('\n').reverse().find(l => l.trim().startsWith('{'));
  let out: any = null;
  try { out = line ? JSON.parse(line) : null; } catch { /* 文本输出 */ }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out };
}

function smokeProject(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  const put = (relPath: string, content: string) => { mkdirSync(dirname(join(root, relPath)), { recursive: true }); writeFileSync(join(root, relPath), content); };
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.smoke = { result_path: 'logos/resources/verify/smoke-results.jsonl', report_path: 'logos/resources/verify/smoke-report.md', sandbox_mode: 'off', command: 'node tools/runner.js' };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  writeFileSync(join(root, 'logos/logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }));
  put('logos/resources/test/smoke/core-smoke-test-cases.md', `# Smoke\n\n| ID | 描述 |\n|---|---|\n${SMOKE_IDS.map(id => `| ${id} | ${id} |`).join('\n')}\n`);
  put('tools/runner.js', SMOKE_RUNNER);
  put('logos/resources/verify/deployment-report.md', '# Deployment Report\n\nok\n');
  put('logos/environments.yaml', 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test}\n');
  put(`logos/changes/${SMOKE_SLUG}/proposal.md`, [
    `# 变更提案：${SMOKE_SLUG}`, '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：test',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
  ].join('\n'));
  put(`logos/changes/${SMOKE_SLUG}/tasks.md`, ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [x] 发布'].join('\n'));
  put(`logos/changes/${SMOKE_SLUG}/VERIFY_PASS`, '');
  put('logos/.openlogos-guard', JSON.stringify({ activeChange: SMOKE_SLUG, module: 'core' }));
  put('.gitignore', 'logos/.openlogos-runtime/\n');
  lvGit(root, ['init', '-q']);
  lvGit(root, ['add', '-A']);
  lvGit(root, ['commit', '-qm', 'init']);
  const deployed = smokeCli(root, ['deploy-done', '--env', 'test', '--ref', 'HEAD']);
  if (deployed.status !== 0) throw new Error(`deploy-done 失败：${deployed.stderr}`);
  return root;
}
