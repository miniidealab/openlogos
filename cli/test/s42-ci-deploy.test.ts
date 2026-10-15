/**
 * environment-deploy 切片 4：ci 方式部署与结果未知恢复（S42）。
 *
 * 覆盖 UT-S42-02、UT-S42-08、UT-S42-09、UT-S42-10、UT-S42-13、ST-S42-03（logos/resources/test/core-S42-test-cases.md）。
 * 规范源：spec/environments.md §11.1、§11.3、§11.4、§11.8；spec/cli-json-output.md「`openlogos deploy --format json`」。
 * ci 方式一律使用替身 `gh`（放在 PATH 最前的本地可执行脚本）：按状态文件输出 dispatch 响应、运行状态与 artifact 内容，
 * 并把收到的每次调用记入日志，不访问任何远程服务。provider: script 使用仓库内的触发 / 状态脚本。
 * 全部走真实 CLI 入口 cli/dist/index.js；结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, takeExitCode, writeLoopPass } from './helpers.js';
import { DEPLOY_LEDGER_REL, DEPLOY_PENDING_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';
import { deploy, DEPLOY_WORK_REL, type DeployCliOptions, type DeployHooks } from '../src/commands/deploy.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const SLUG = 'ship-it';

/** 替身 gh：状态文件驱动，调用逐条记入日志。 */
const FAKE_GH = `#!${process.execPath}
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GH_FAKE_LOG, JSON.stringify(args) + '\\n');
const st = JSON.parse(fs.readFileSync(process.env.GH_FAKE_STATE, 'utf-8'));
const save = () => fs.writeFileSync(process.env.GH_FAKE_STATE, JSON.stringify(st));
const out = s => process.stdout.write(s + '\\n');
const die = (msg, code = 1) => { process.stderr.write(msg + '\\n'); process.exit(code); };
if (args[0] === '--version') { out('gh version 2.99.0 (fake)'); process.exit(0); }
if (args[0] === 'auth' && args[1] === 'status') process.exit(st.auth === false ? 1 : 0);
if (args[0] === 'api') {
  const endpoint = args.find(a => a.startsWith('repos/')) || '';
  let m;
  if (args.includes('--method') && (m = /actions\\/workflows\\/([^/]+)\\/dispatches$/.exec(endpoint))) {
    const fields = {};
    for (let i = 0; i < args.length; i++) if (args[i] === '-f' || args[i] === '-F') { const kv = args[i + 1]; const at = kv.indexOf('='); fields[kv.slice(0, at)] = kv.slice(at + 1); }
    st.dispatches = (st.dispatches || []).concat([{ workflow: m[1], fields }]); save();
    const d = st.dispatch || {};
    if (d.exit) die('HTTP 422', d.exit);
    out(JSON.stringify(d.response || {})); process.exit(0);
  }
  if ((m = /actions\\/workflows\\/([^/]+)$/.exec(endpoint))) {
    if ((st.workflows || []).includes(m[1])) { out(JSON.stringify({ id: 1, path: '.github/workflows/' + m[1] })); process.exit(0); }
    die('HTTP 404: Not Found');
  }
  if ((m = /commits\\/(.+)$/.exec(endpoint))) {
    const sha = (st.remote || {})[decodeURIComponent(m[1])];
    if (sha) { out(JSON.stringify({ sha })); process.exit(0); }
    die('HTTP 422: No commit found');
  }
  die('unexpected api ' + endpoint);
}
if (args[0] === 'run' && args[1] === 'view') {
  const id = args[2]; const run = (st.runs || {})[id];
  if (!run) die('run not found');
  st.viewCount = st.viewCount || {}; const n = st.viewCount[id] || 0; st.viewCount[id] = n + 1; save();
  const v = run.views[Math.min(n, run.views.length - 1)];
  out(JSON.stringify({ url: 'https://github.example/runs/' + id, headSha: null, conclusion: '', ...v })); process.exit(0);
}
if (args[0] === 'run' && args[1] === 'download') {
  const id = args[2]; const dir = args[args.indexOf('-D') + 1]; const run = (st.runs || {})[id];
  if (!run || run.artifact == null) die('no artifact matches openlogos-deploy-result');
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'result.json'), run.artifact); process.exit(0);
}
die('unexpected gh ' + args.join(' '));
`;

/** provider: script 的触发脚本：TRIGGER_NO_ID=1 时不输出 run_id。 */
const TRIGGER = `#!/bin/sh
echo "triggering $OPENLOGOS_DEPLOY_REF"
if [ "$TRIGGER_NO_ID" = "1" ]; then echo '{"url":"https://ci.example/x"}'; else echo '{"run_id":"77","url":"https://ci.example/77"}'; fi
`;
/** provider: script 的状态脚本：第一次 in_progress，之后 completed/success 并回报请求 commit；记录收到的参数。 */
const STATUS = `#!/bin/sh
mkdir -p "$PUBLISH_DIR"
echo "$1" >> "$PUBLISH_DIR/status-args.txt"
n=$(wc -l < "$PUBLISH_DIR/status-args.txt" | tr -d ' ')
if [ "$n" -le 1 ]; then echo '{"status":"in_progress"}'; else echo "{\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\",\\"deployed_ref\\":\\"$OPENLOGOS_DEPLOY_REF\\"}"; fi
`;
const SCRIPT = `#!/bin/sh
mkdir -p "$PUBLISH_DIR"
echo "start $OPENLOGOS_DEPLOY_ID" >> "$PUBLISH_DIR/starts.txt"
`;

let root: string;
let cleanup: () => void;
let work: string;
let tags: { v1: string; v2: string; v3: string; head: string };

const fakeState = () => join(work, 'gh-state.json');
const fakeLog = () => join(work, 'gh-calls.jsonl');
const publish = () => join(work, 'publish');

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

interface GhState {
  auth?: boolean;
  workflows?: string[];
  remote?: Record<string, string>;
  dispatch?: { response?: Record<string, unknown>; exit?: number };
  runs?: Record<string, { views: Array<Record<string, unknown>>; artifact?: string | null }>;
  dispatches?: Array<{ workflow: string; fields: Record<string, string> }>;
  viewCount?: Record<string, number>;
}

const readState = (): GhState => JSON.parse(readFileSync(fakeState(), 'utf-8'));
function setState(patch: GhState): void {
  writeFileSync(fakeState(), JSON.stringify({ ...readState(), ...patch }));
}
const ghCalls = (): string[][] => (existsSync(fakeLog()) ? readFileSync(fakeLog(), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const dispatchCount = () => (readState().dispatches ?? []).length;

type CiCfg = Record<string, unknown>;

/** 登记表：prod / staging 按参数配置；test 为 script（dry-run 用）。 */
function registry(prod: CiCfg, extra: { prodSecrets?: string[]; staging?: CiCfg } = {}): string {
  const envs: Array<Record<string, unknown>> = [
    { id: 'test', name: 'Test', tier: 'test', secrets: ['TEST_TOKEN'], deploy: { mode: 'script', script: 'deploy/run.sh', args: ['{env}', '{ref_short}'] } },
    { id: 'prod', name: 'Production', tier: 'prod', ...(extra.prodSecrets ? { secrets: extra.prodSecrets } : {}), deploy: prod },
    ...(extra.staging ? [{ id: 'staging', name: 'Staging', tier: 'staging', deploy: extra.staging }] : []),
  ];
  return stringifyYaml({ schema_version: 1, environments: envs }, { lineWidth: 0 });
}

const GHA = (over: CiCfg = {}): CiCfg => ({ mode: 'ci', provider: 'github-actions', workflow: 'deploy.yml', poll_interval_sec: 1, timeout_sec: 30, ...over });

function setup(opts: { registry?: string; proposal?: boolean } = {}): void {
  scaffoldProject(root, { locale: 'en' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }, { lineWidth: 0 }));
  put(ENV_REGISTRY_REL, opts.registry ?? registry(GHA()));
  if (opts.proposal) {
    const dir = join(root, 'logos/changes', SLUG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), [
      '# 变更提案：ship-it', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：生产',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
    ].join('\n'));
    writeFileSync(join(dir, 'tasks.md'), ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n'));
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    writeLoopPass(dir);
    put('logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core', createdAt: new Date().toISOString() }));
  }
  put('.gitignore', `logos/.openlogos-runtime/\n${ENV_REGISTRY_REL}\n`);
  git(['init', '-q']);
  git(['config', 'user.name', 't']);
  git(['config', 'user.email', 't@example.invalid']);
  const commit = (label: string, exec = true) => {
    put('deploy/run.sh', `${SCRIPT}# ${label}\n`);
    put('ci/trigger.sh', TRIGGER);
    put('ci/status.sh', STATUS);
    for (const f of ['deploy/run.sh', 'ci/trigger.sh', 'ci/status.sh']) chmodSync(join(root, f), exec || f !== 'deploy/run.sh' ? 0o755 : 0o644);
    put('payload.txt', `${label}\n`);
    git(['add', '-A']);
    git(['commit', '-qm', label]);
    return git(['rev-parse', 'HEAD']);
  };
  const v1 = commit('v1'); git(['tag', 'v1']);
  const v2 = commit('v2'); git(['tag', 'v2']);
  const v3 = commit('v3', false); git(['tag', 'v3']); // 脚本不带可执行位
  const head = commit('head');
  tags = { v1, v2, v3, head };

  mkdirSync(join(work, 'bin'), { recursive: true });
  writeFileSync(join(work, 'bin', 'gh'), FAKE_GH);
  chmodSync(join(work, 'bin', 'gh'), 0o755);
  writeFileSync(fakeState(), JSON.stringify({
    auth: true, workflows: ['deploy.yml'], remote: { v1, v2, main: head },
    dispatch: { response: { workflow_run_id: 101, run_url: 'https://api.github.example/runs/101', html_url: 'https://github.example/runs/101' } },
    runs: { 101: { views: [{ status: 'completed', conclusion: 'success' }], artifact: JSON.stringify({ deployed_ref: v1 }) } },
  } satisfies GhState));
}

function cli(args: string[], env: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: 'utf-8', timeout: 120_000,
    env: {
      ...process.env, PATH: `${join(work, 'bin')}:${process.env.PATH}`, GH_FAKE_STATE: fakeState(), GH_FAKE_LOG: fakeLog(),
      PUBLISH_DIR: publish(), ...env,
    },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function deployJson(args: string[], env: Record<string, string | undefined> = {}): { status: number | null; data: any; error: any; stderr: string } {
  const r = cli(['deploy', ...args, '--format', 'json'], env);
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data; } catch { /* 失败路径无 stdout */ }
  try { error = JSON.parse(r.stderr).error; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, error, stderr: r.stderr };
}

/** 进程内调用 deploy（JSON 模式），用于注入确定的并发交错；替身 gh 经 PATH 生效。 */
async function deployInProcess(opts: DeployCliOptions, hooks: DeployHooks): Promise<{ exit: number; data: any; error: any }> {
  const con = captureConsole();
  const restoreCwd = mockCwd(root);
  const exitSpy = mockProcessExit();
  const saved = { PATH: process.env.PATH, GH_FAKE_STATE: process.env.GH_FAKE_STATE, GH_FAKE_LOG: process.env.GH_FAKE_LOG };
  process.env.PATH = `${join(work, 'bin')}:${process.env.PATH}`;
  process.env.GH_FAKE_STATE = fakeState();
  process.env.GH_FAKE_LOG = fakeLog();
  try {
    let exit: number;
    try {
      await deploy('json', opts, hooks);
      exit = Number(takeExitCode() ?? 0);
    } catch (error) {
      const m = /^process\.exit\((\d+)\)$/.exec((error as Error).message);
      if (!m) throw error;
      takeExitCode();
      exit = Number(m[1]);
    }
    let data = null;
    let error = null;
    try { data = JSON.parse(con.logs[0]).data; } catch { /* 失败路径无 stdout */ }
    try { error = JSON.parse(con.errors[0]).error; } catch { /* 成功路径无 stderr envelope */ }
    return { exit, data, error };
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    exitSpy.mockRestore();
    restoreCwd();
    con.restore();
  }
}

function ledger(): Array<Record<string, any>> {
  const p = join(root, DEPLOY_LEDGER_REL);
  return existsSync(p) ? readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

function envShow(env: string): any {
  const r = cli(['env', 'show', env, '--format', 'json']);
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout).data;
}

const pendingPath = (env = 'prod') => join(root, DEPLOY_PENDING_REL, `${env}.json`);
const pending = (env = 'prod') => JSON.parse(readFileSync(pendingPath(env), 'utf-8'));

/** 项目全部文件（含运行态目录，不含 .git）的 SHA-256 清单。 */
function treeHash(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { out.push(`D ${p.slice(root.length)}`); walk(p); }
      else out.push(`F ${p.slice(root.length)} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
    }
  };
  walk(root);
  return out.join('\n');
}

/** 替身记录中没有调用运行列表接口（gh run list 或 GET .../actions/runs）。 */
function expectNoRunListing(): void {
  for (const call of ghCalls()) {
    expect(call.slice(0, 2).join(' '), `不得扫描运行列表：${call.join(' ')}`).not.toBe('run list');
    expect(call.some(a => /actions\/runs\/?(\?.*)?$/.test(a)), `不得扫描运行列表：${call.join(' ')}`).toBe(false);
  }
}

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  work = `${root}-work`;
  mkdirSync(work, { recursive: true });
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
  cleanup();
});

// 含真实轮询间隔（poll_interval_sec: 1）与观察超时，单个用例需要十秒以上
describe('S42 ci 方式部署 — 单元测试（environment-deploy 切片 4）', { timeout: 60_000 }, () => {
  it('UT-S42-02: dry-run 覆盖全部检查且不写任何文件', () => {
    setup({ registry: registry(GHA({ inputs: { version: '{ref}', id: '{deploy_id}' } })) });
    const env = { TEST_TOKEN: 'tok-value' };

    // script：plan 给出通道、请求 commit、脚本路径与参数展开
    const before = treeHash();
    const s = deployJson(['--env', 'test', '--ref', 'v1', '--dry-run'], env);
    expect(s.status, s.stderr).toBe(0);
    expect(s.data).toMatchObject({
      status: 'dry-run', deploy_id: null, channel: 'version', mode: 'script', ref_input: 'v1', ref_requested: tags.v1,
      ref: null, duration_ms: null, log_path: null, output_tail: null, ledger_written: false,
    });
    expect(s.data.plan).toMatchObject({ workdir: 'worktree', script: 'deploy/run.sh', args: ['test', tags.v1.slice(0, 12)], workflow: null });
    expect(existsSync(join(root, DEPLOY_WORK_REL)), '未建工作树').toBe(false);
    expect(existsSync(publish()), '脚本未运行').toBe(false);
    expect(treeHash(), '全部文件与运行态目录不变').toBe(before);

    // ci：plan 给出工作流与调度 ref；替身 gh 未收到 dispatch
    const c = deployJson(['--env', 'prod', '--ref', 'v1', '--dry-run'], env);
    expect(c.status, c.stderr).toBe(0);
    expect(c.data).toMatchObject({ status: 'dry-run', mode: 'ci', channel: 'version', ref_requested: tags.v1, ledger_written: false });
    expect(c.data.plan).toMatchObject({ workflow: 'deploy.yml', dispatch_ref: 'v1', inputs: { version: tags.v1, id: '{deploy_id}' }, timeout_sec: 30 });
    expect(dispatchCount(), '未发出 dispatch').toBe(0);
    expect(ghCalls().some(c => c.includes('--method')), '没有任何写入型 gh 调用').toBe(false);
    expect(treeHash()).toBe(before);

    // 检查失败分别报错（dry-run 同样执行全部检查）
    const rejected = (args: string[], code: string, e: Record<string, string | undefined> = env) => {
      const r = deployJson(args, e);
      expect(r.status, code).toBe(1);
      expect(r.error?.code).toBe(code);
      expect(treeHash(), `${code} 零写入`).toBe(before);
    };
    rejected(['--env', 'test', '--ref', 'v3', '--dry-run'], 'DEPLOY_SCRIPT_NOT_EXECUTABLE');
    rejected(['--env', 'test', '--ref', 'v1', '--dry-run'], 'DEPLOY_SECRETS_MISSING', { TEST_TOKEN: undefined });
    setState({ auth: false });
    rejected(['--env', 'prod', '--ref', 'v1', '--dry-run'], 'DEPLOY_CI_UNAVAILABLE');
    setState({ auth: true, workflows: [] });
    rejected(['--env', 'prod', '--ref', 'v1', '--dry-run'], 'DEPLOY_CI_UNAVAILABLE');
    expect(dispatchCount()).toBe(0);

    // env check 对 ci 环境报告 gh 可用性
    setState({ auth: false, workflows: ['deploy.yml'] });
    const check = cli(['env', 'check', 'prod', '--format', 'json'], env);
    expect(check.status).toBe(1);
    expect(JSON.parse(check.stdout).data.errors).toEqual([expect.objectContaining({ code: 'DEPLOY_CI_UNAVAILABLE', environment: 'prod' })]);
    setState({ auth: true });
    expect(cli(['env', 'check', 'prod', '--format', 'json'], env).status).toBe(0);
  });

  it('UT-S42-08: github-actions 运行身份与结论', () => {
    setup();
    // ① dispatch 返回运行身份，轮询两次后 completed/success
    setState({ runs: { 101: { views: [{ status: 'queued' }, { status: 'in_progress' }, { status: 'completed', conclusion: 'success' }], artifact: JSON.stringify({ deployed_ref: tags.v1 }) } } });
    const r1 = deployJson(['--env', 'prod', '--ref', 'v1']);
    expect(r1.status, r1.stderr).toBe(0);
    const dispatchCall = ghCalls().find(c => c.includes('--method'))!;
    expect(dispatchCall).toEqual(expect.arrayContaining(['api', 'POST', 'repos/{owner}/{repo}/actions/workflows/deploy.yml/dispatches', 'return_run_details=true']));
    expect(readState().viewCount?.['101']).toBe(3);
    expectNoRunListing();
    expect(r1.data).toMatchObject({ status: 'done', mode: 'ci', ref: tags.v1, ref_source: 'ci-reported' });
    expect(r1.data.ci).toMatchObject({ provider: 'github-actions', run_id: '101', conclusion: 'success', reported_ref: tags.v1 });
    expect(ledger().pop()).toMatchObject({
      result: 'done', mode: 'ci', channel: 'version', ci_run_id: '101', ci_run_url: 'https://github.example/runs/101',
      ref: tags.v1, ref_source: 'ci-reported', ci_reported_ref: tags.v1, failure_reason: null,
    });
    expect(existsSync(pendingPath()), '终态后删除未决记录').toBe(false);
    expect(envShow('prod').current_ref).toBe(tags.v1);

    // ② 结论 failure
    setState({ dispatch: { response: { workflow_run_id: 102, html_url: 'https://github.example/runs/102' } }, runs: { 102: { views: [{ status: 'completed', conclusion: 'failure' }] } } });
    const r2 = deployJson(['--env', 'prod', '--ref', 'v2']);
    expect(r2.status).toBe(1);
    expect(r2.error.code).toBe('DEPLOY_FAILED');
    expect(r2.error.details).toMatchObject({ failure_reason: 'ci-failure', mode: 'ci', ledger_written: true, ci: { run_id: '102', conclusion: 'failure' } });
    expect(ledger().pop()).toMatchObject({ result: 'failed', failure_reason: 'ci-failure', ref: null, ci_run_id: '102' });
    expect(existsSync(pendingPath())).toBe(false);
    expect(envShow('prod').current_ref).toBe(tags.v1);

    // ③ dispatch 响应不含运行身份
    setState({ dispatch: { response: {} } });
    const r3 = deployJson(['--env', 'prod', '--ref', 'v2']);
    expect(r3.status).toBe(1);
    expect(r3.error.code).toBe('DEPLOY_RESULT_UNKNOWN');
    expect(r3.error.details).toMatchObject({ failure_reason: 'ci-run-id-missing', ledger_written: true });
    expect(ledger().pop()).toMatchObject({ result: 'unknown', failure_reason: 'ci-run-id-missing', ref: null, ci_run_id: null });
    expect(pending(), '未决记录保留').toMatchObject({ deploy_id: r3.error.details.deploy_id, run_id: null, mode: 'ci' });
    expect(envShow('prod').current_ref).toBe(tags.v1);
    expect(deployJson(['--env', 'prod', '--abandon', r3.error.details.deploy_id]).data.status).toBe('abandoned');

    // ④ 一直 in_progress，timeout_sec: 3
    put(ENV_REGISTRY_REL, registry(GHA({ timeout_sec: 3 })));
    setState({ dispatch: { response: { workflow_run_id: 104, html_url: 'https://github.example/runs/104' } }, runs: { 104: { views: [{ status: 'in_progress' }] } } });
    const r4 = deployJson(['--env', 'prod', '--ref', 'v2']);
    expect(r4.status).toBe(1);
    expect(r4.error.code).toBe('DEPLOY_RESULT_UNKNOWN');
    expect(r4.error.details).toMatchObject({ failure_reason: 'ci-observe-timeout', ci: { run_id: '104' } });
    expect(ledger().pop()).toMatchObject({ result: 'unknown', failure_reason: 'ci-observe-timeout', ci_run_id: '104' });
    expect(pending()).toMatchObject({ deploy_id: r4.error.details.deploy_id, run_id: '104' });
    expect(envShow('prod').current_ref).toBe(tags.v1);
    expectNoRunListing();
  });

  it('UT-S42-09: CI 部署版本只认运行回报', () => {
    setup();
    let n = 200;
    const runWith = (artifact: string | null, views: Array<Record<string, unknown>> = [{ status: 'completed', conclusion: 'success' }]) => {
      n += 1;
      setState({ dispatch: { response: { workflow_run_id: n, html_url: `https://github.example/runs/${n}` } }, runs: { [n]: { views, artifact } } });
      const r = deployJson(['--env', 'prod', '--ref', 'v1']);
      expect(r.status, r.stderr).toBe(0);
      return r.data;
    };
    const unconfirmed = (data: any, reported: string | null, label: string) => {
      expect(data, label).toMatchObject({ status: 'done', ref: null, ref_source: 'unknown' });
      expect(data.warnings, label).toEqual([expect.objectContaining({ code: 'DEPLOY_REF_UNCONFIRMED', requested: tags.v1, reported })]);
      expect(ledger().pop(), label).toMatchObject({ result: 'done', ref: null, ref_source: 'unknown', ci_reported_ref: reported });
      const view = envShow('prod');
      expect(view.current_ref, label).toBeNull();
      expect(view.previous_ref, `${label} 未确认记录不能作为 previous_ref`).toBe(tags.v1);
    };

    // ① 回报等于请求 commit
    const d1 = runWith(JSON.stringify({ deployed_ref: tags.v1 }));
    expect(d1).toMatchObject({ ref: tags.v1, ref_source: 'ci-reported', warnings: [] });

    // ② workflow_ref: main、默认 checkout，回报 main 的 commit
    put(ENV_REGISTRY_REL, registry(GHA({ workflow_ref: 'main' })));
    const before2 = dispatchCount();
    unconfirmed(runWith(JSON.stringify({ deployed_ref: tags.head })), tags.head, '②');
    expect(readState().dispatches![before2].fields.ref, '② 在 main 上调度').toBe('main');
    expect(ghCalls().some(c => c[0] === 'run' && c[1] === 'download' && c[2] === String(n)), '② 读取了回报').toBe(true);

    // ③ 调度提交（headSha）等于请求 commit，但回报 checkout 检出的另一个 tag
    put(ENV_REGISTRY_REL, registry(GHA()));
    unconfirmed(runWith(JSON.stringify({ deployed_ref: tags.v2 }), [{ status: 'completed', conclusion: 'success', headSha: tags.v1 }]), tags.v2, '③');
    // ④ 不存在 artifact；⑤ 内容不是 JSON
    unconfirmed(runWith(null), null, '④');
    unconfirmed(runWith('not json'), null, '⑤');

    // ⑥ workflow_ref: main、通过 inputs 接收版本并检出，回报请求 commit
    put(ENV_REGISTRY_REL, registry(GHA({ workflow_ref: 'main', inputs: { version: '{ref}' } })));
    const before6 = dispatchCount();
    const d6 = runWith(JSON.stringify({ deployed_ref: tags.v1 }));
    expect(d6).toMatchObject({ ref: tags.v1, ref_source: 'ci-reported', warnings: [] });
    expect(readState().dispatches![before6].fields).toMatchObject({ ref: 'main', 'inputs[version]': tags.v1 });
    expect(envShow('prod').current_ref).toBe(tags.v1);
  });

  it('UT-S42-10: github-actions 调度 ref 与 provider: script 协议', () => {
    setup();
    // ① 未配置 workflow_ref、远端 v1 解析为同一 commit：在 v1 上调度
    expect(deployJson(['--env', 'prod', '--ref', 'v1']).status).toBe(0);
    expect(readState().dispatches![0].fields.ref).toBe('v1');

    // ② 只给 commit；③ 远端 tag 指向另一 commit：均零触发
    const before = dispatchCount();
    const r2 = deployJson(['--env', 'prod', '--ref', tags.v1]);
    expect(r2.error?.code).toBe('DEPLOY_CI_REF_NOT_DISPATCHABLE');
    setState({ remote: { v1: tags.v2, v2: tags.v2, main: tags.head } });
    const r3 = deployJson(['--env', 'prod', '--ref', 'v1']);
    expect(r3.error?.code).toBe('DEPLOY_CI_REF_NOT_DISPATCHABLE');
    expect(dispatchCount(), '②③ 零触发').toBe(before);
    expect(existsSync(pendingPath())).toBe(false);

    // ④ provider: script：trigger 输出 run_id，status 依次 in_progress 与 completed/success 并回报 deployed_ref
    const scriptCi = { mode: 'ci', provider: 'script', trigger_script: 'ci/trigger.sh', status_script: 'ci/status.sh', poll_interval_sec: 1, timeout_sec: 30 };
    put(ENV_REGISTRY_REL, registry(scriptCi));
    const r4 = deployJson(['--env', 'prod', '--ref', 'v2']);
    expect(r4.status, r4.stderr).toBe(0);
    expect(r4.data).toMatchObject({ status: 'done', mode: 'ci', ref: tags.v2, ref_source: 'ci-reported', ci: { provider: 'script', run_id: '77', run_url: 'https://ci.example/77' } });
    expect(readFileSync(join(publish(), 'status-args.txt'), 'utf-8')).toBe('77\n77\n');
    expect(ledger().pop()).toMatchObject({ result: 'done', ref_source: 'ci-reported', ci_run_id: '77', ci_reported_ref: tags.v2 });
    expect(existsSync(join(root, DEPLOY_WORK_REL, r4.data.deploy_id)), '工作树已移除').toBe(false);

    // ⑤ trigger_script 缺 run_id
    const r5 = deployJson(['--env', 'prod', '--ref', 'v2'], { TRIGGER_NO_ID: '1' });
    expect(r5.status).toBe(1);
    expect(r5.error.code).toBe('DEPLOY_RESULT_UNKNOWN');
    expect(r5.error.details.failure_reason).toBe('ci-run-id-missing');
    expect(pending()).toMatchObject({ run_id: null, provider: 'script' });
  });

  it('UT-S42-13: CI 未决占用不随本地进程退出解除', () => {
    setup({ registry: registry(GHA({ timeout_sec: 3 })) });
    setState({ dispatch: { response: { workflow_run_id: 301, html_url: 'https://github.example/runs/301' } }, runs: { 301: { views: [{ status: 'in_progress' }] } } });
    const first = deployJson(['--env', 'prod', '--ref', 'v1']);
    expect(first.error.details.failure_reason).toBe('ci-observe-timeout');
    const deployId = first.error.details.deploy_id;
    expect(pending()).toMatchObject({ deploy_id: deployId, run_id: '301' });
    const dispatches = dispatchCount();
    const notBlocked = (r: { error: any }, label: string, baseline = dispatches) => {
      expect(r.error?.code, label).not.toBe('DEPLOY_IN_PROGRESS');
      expect(r.error?.code, label).not.toBe('DEPLOY_REF_REQUIRED');
      expect(dispatchCount(), `${label} 未发出新的 dispatch`).toBe(baseline);
    };

    // ① 新部署：未决记录占用环境
    const r1 = deployJson(['--env', 'prod', '--ref', 'v1']);
    expect(r1.error.code).toBe('DEPLOY_IN_PROGRESS');
    expect(r1.error.details.holder).toMatchObject({ deploy_id: deployId, unresolved: true, run_id: '301', mode: 'ci' });
    expect(dispatchCount()).toBe(dispatches);

    // ② 远程仍在运行
    const lines = ledger().length;
    const r2 = deployJson(['--env', 'prod', '--reconcile']);
    expect(r2.status, r2.stderr).toBe(0);
    expect(r2.data).toMatchObject({ status: 'still-running', deploy_id: deployId, ledger_written: false });
    notBlocked(r2, '②');
    expect(ledger().length, '账本无新增').toBe(lines);
    expect(envShow('prod').deploy_in_progress).toMatchObject({ deploy_id: deployId, unresolved: true });

    // ③ 远程已完成：补记同一 deploy_id 的终态记录
    setState({ runs: { 301: { views: [{ status: 'completed', conclusion: 'success' }], artifact: JSON.stringify({ deployed_ref: tags.v1 }) } }, viewCount: {} });
    const r3 = deployJson(['--env', 'prod', '--reconcile']);
    expect(r3.status, r3.stderr).toBe(0);
    expect(r3.data).toMatchObject({ status: 'reconciled', deploy_id: deployId, ref: tags.v1, ref_source: 'ci-reported', ledger_written: true });
    notBlocked(r3, '③');
    expect(ledger().pop()).toMatchObject({ deploy_id: deployId, reconciled: true, result: 'done', ref_source: 'ci-reported', ref: tags.v1 });
    expect(existsSync(pendingPath()), '未决记录删除').toBe(false);
    const view = envShow('prod');
    expect(view.last_deploy).toMatchObject({ deploy_id: deployId, result: 'done' });
    expect(view.current_ref).toBe(tags.v1);
    expect(view.deploy_in_progress).toBeNull();

    // ④ 未决记录无 run_id：--reconcile 无法查询并保持占用，--abandon 后释放
    setState({ dispatch: { response: {} } });
    const noId = deployJson(['--env', 'prod', '--ref', 'v2']);
    expect(noId.error.details.failure_reason).toBe('ci-run-id-missing');
    const noIdDeploy = noId.error.details.deploy_id;
    const d4 = dispatchCount();
    const r4 = deployJson(['--env', 'prod', '--reconcile']);
    expect(r4.status).toBe(1);
    expect(r4.error.code).toBe('DEPLOY_RESULT_UNKNOWN');
    expect(r4.error.message).toContain('--abandon');
    expect(pending().deploy_id, '保持占用').toBe(noIdDeploy);
    const a4 = deployJson(['--env', 'prod', '--abandon', noIdDeploy]);
    expect(a4.data).toMatchObject({ status: 'abandoned', deploy_id: noIdDeploy, ledger_written: true });
    expect(ledger().pop()).toMatchObject({ deploy_id: noIdDeploy, result: 'unknown', failure_reason: 'abandoned', ref: null });
    expect(existsSync(pendingPath()), '已释放').toBe(false);
    expect(dispatchCount()).toBe(d4);

    // ⑤ 无活跃提案（无 guard）时对版本通道的未决记录 --reconcile，不传 --ref
    setState({ dispatch: { response: { workflow_run_id: 305, html_url: 'https://github.example/runs/305' } }, runs: { 305: { views: [{ status: 'in_progress' }] } } });
    put('logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core', createdAt: new Date().toISOString() }));
    const p5 = deployJson(['--env', 'prod', '--ref', 'v2', '--channel', 'version']);
    expect(p5.error.code).toBe('DEPLOY_RESULT_UNKNOWN');
    rmSync(join(root, 'logos/.openlogos-guard'));
    setState({ runs: { 305: { views: [{ status: 'completed', conclusion: 'success' }], artifact: JSON.stringify({ deployed_ref: tags.v2 }) } } });
    const d5 = dispatchCount();
    const r5 = deployJson(['--env', 'prod', '--reconcile']);
    expect(r5.status, r5.stderr).toBe(0);
    expect(r5.data).toMatchObject({ status: 'reconciled', channel: 'version', ref: tags.v2 });
    notBlocked({ error: r5.error }, '⑤', d5);

    // ⑥ --abandon 错误与正确 deploy_id
    setState({ dispatch: { response: { workflow_run_id: 306 } }, runs: { 306: { views: [{ status: 'in_progress' }] } } });
    const p6 = deployJson(['--env', 'prod', '--ref', 'v1']);
    const before = readFileSync(pendingPath(), 'utf-8');
    const d6 = dispatchCount();
    const wrong = deployJson(['--env', 'prod', '--abandon', 'not-the-id']);
    expect(wrong.error.code).toBe('DEPLOY_PENDING_NOT_FOUND');
    expect(readFileSync(pendingPath(), 'utf-8'), '未决记录不变').toBe(before);
    const right = deployJson(['--env', 'prod', '--abandon', p6.error.details.deploy_id]);
    expect(right.data.status).toBe('abandoned');
    expect(existsSync(pendingPath())).toBe(false);
    notBlocked({ error: wrong.error }, '⑥ 错误 id', d6);
    notBlocked({ error: right.error }, '⑥ 正确 id', d6);
  });
});

// 含真实轮询间隔（poll_interval_sec: 1）与观察超时，单个用例需要十秒以上
describe('S42 ci 方式部署 — 复核修复（environment-deploy code-r1）', { timeout: 120_000 }, () => {
  it('UT-S42-13: 迟到的 reconcile 查询不会提交到已替换的占用上，查询期间他人的 abandon 被互斥（code-r1 F2）', async () => {
    setup({ registry: registry(GHA({ timeout_sec: 3 })) });
    setState({ dispatch: { response: { workflow_run_id: 501, html_url: 'https://github.example/runs/501' } }, runs: { 501: { views: [{ status: 'in_progress' }] } } });
    const first = deployJson(['--env', 'prod', '--ref', 'v1']);
    expect(first.error.details.failure_reason).toBe('ci-observe-timeout');
    const oldId = first.error.details.deploy_id;
    setState({ runs: { 501: { views: [{ status: 'completed', conclusion: 'success' }], artifact: JSON.stringify({ deployed_ref: tags.v1 }) } } });

    // ① 查询进行中（持有环境锁）时另一进程 abandon：被互斥拒绝、未决记录不变；本次 reconcile 照常补记
    let concurrent: { status: number | null; error: any } | null = null;
    const r1 = await deployInProcess({ env: 'prod', reconcile: true }, {
      afterRemoteQuery: () => {
        const before = readFileSync(pendingPath(), 'utf-8');
        const r = deployJson(['--env', 'prod', '--abandon', oldId]);
        concurrent = { status: r.status, error: r.error };
        expect(readFileSync(pendingPath(), 'utf-8'), '并发 abandon 未改动未决记录').toBe(before);
      },
    });
    expect(concurrent!.status).toBe(1);
    expect(concurrent!.error.code).toBe('DEPLOY_IN_PROGRESS');
    expect(concurrent!.error.details.holder).toMatchObject({ unresolved: false, mode: 'ci' });
    expect(r1.exit).toBe(0);
    expect(r1.data).toMatchObject({ status: 'reconciled', deploy_id: oldId });
    expect(ledger().filter(l => l.deploy_id === oldId).map(l => l.result)).toEqual(['unknown', 'done']);

    // ② 旧查询期间未决记录被替换为另一场部署（绕过互斥的最坏情形）：旧 reconcile 不删除新记录、不追加旧结论
    setState({ dispatch: { response: { workflow_run_id: 502, html_url: 'https://github.example/runs/502' } }, runs: { 502: { views: [{ status: 'in_progress' }] } } });
    const second = deployJson(['--env', 'prod', '--ref', 'v2']);
    const staleId = second.error.details.deploy_id;
    setState({ runs: { 502: { views: [{ status: 'completed', conclusion: 'success' }], artifact: JSON.stringify({ deployed_ref: tags.v2 }) } } });
    const ledgerBefore = readFileSync(join(root, DEPLOY_LEDGER_REL), 'utf-8');
    const replacement = JSON.stringify({ ...JSON.parse(readFileSync(pendingPath(), 'utf-8')), deploy_id: 'new-deployment', run_id: '777' });
    const r2 = await deployInProcess({ env: 'prod', reconcile: true }, { afterRemoteQuery: () => writeFileSync(pendingPath(), replacement) });
    expect(r2.exit).toBe(1);
    expect(r2.error.code).toBe('DEPLOY_PENDING_NOT_FOUND');
    expect(r2.error.message).toContain(staleId);
    expect(readFileSync(pendingPath(), 'utf-8'), '新部署的未决记录保留').toBe(replacement);
    expect(readFileSync(join(root, DEPLOY_LEDGER_REL), 'utf-8'), '旧结论未追加').toBe(ledgerBefore);
  });

  it('UT-S42-02: 提案通道 cmd verify 下 dry-run 不执行验收命令（code-r1 F3）', () => {
    setup({ proposal: true });
    put('logos/flow/launched.yaml', ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 1 }',
      '  - op: modify', '    target: verify', '    set: { done_when: "cmd:touch VERIFY_CMD_SENTINEL" }'].join('\n'));
    const env = { TEST_TOKEN: 'tok-value' };
    const before = treeHash();
    const r = deployJson(['--env', 'test', '--ref', 'v1', '--channel', 'proposal', '--dry-run'], env);
    expect(r.status).toBe(1);
    expect(r.error.code).toBe('VERIFY_NOT_PASSED');
    expect(existsSync(join(root, 'VERIFY_CMD_SENTINEL')), '验收命令未执行').toBe(false);
    expect(treeHash(), '项目快照不变').toBe(before);
    expect(existsSync(publish()), '部署脚本未运行').toBe(false);

    // 真实部署保留既有验收执行顺序：执行 cmd verify 后部署
    const real = deployJson(['--env', 'test', '--ref', 'v1', '--channel', 'proposal'], env);
    expect(real.status, real.stderr).toBe(0);
    expect(existsSync(join(root, 'VERIFY_CMD_SENTINEL')), '真实部署执行了验收命令').toBe(true);
    expect(real.data).toMatchObject({ channel: 'proposal', status: 'done' });
  });
});

// 含真实轮询间隔（poll_interval_sec: 1）与观察超时，单个用例需要十秒以上
describe('S42 ci 方式部署 — 场景测试（environment-deploy 切片 4）', { timeout: 60_000 }, () => {
  it('ST-S42-03: ci 方式端到端（替身 gh）与结果未知恢复', () => {
    setup({ registry: registry(GHA(), { staging: GHA({ timeout_sec: 3 }) }) });
    setState({ dispatch: { response: { workflow_run_id: 401, html_url: 'https://github.example/runs/401' } }, runs: { 401: { views: [{ status: 'in_progress' }] } } });

    const r1 = deployJson(['--env', 'staging', '--ref', 'v1']);
    expect(r1.status).toBe(1);
    expect(r1.error.code).toBe('DEPLOY_RESULT_UNKNOWN');
    const deployId = r1.error.details.deploy_id;

    const r2 = cli(['deploy', '--env', 'staging', '--ref', 'v1']);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain('[DEPLOY_IN_PROGRESS]');

    setState({ runs: { 401: { views: [{ status: 'completed', conclusion: 'success' }], artifact: JSON.stringify({ deployed_ref: tags.v1 }) } } });
    const r3 = cli(['deploy', '--env', 'staging', '--reconcile']);
    expect(r3.status, r3.stderr).toBe(0);
    expect(r3.stdout).toContain(deployId);

    const view = envShow('staging');
    expect(view.current_ref).toBe(tags.v1);
    expect(view.last_deploy).toMatchObject({ deploy_id: deployId, result: 'done', mode: 'ci', channel: 'version' });
    expect(view.deploy_in_progress).toBeNull();
    expect(ledger().filter(l => l.deploy_id === deployId).map(l => l.result)).toEqual(['unknown', 'done']);
    expect(dispatchCount(), '只触发过一次').toBe(1);
  });
});
