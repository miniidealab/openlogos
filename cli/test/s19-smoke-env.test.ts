/**
 * environment-registry 切片 4：smoke 环境一致性、环境证据与 smoke 账本（S19），以及 S41 全链路。
 *
 * 覆盖 UT-S19-58～UT-S19-73、ST-S19-25～ST-S19-29（core-S19-test-cases.md「S19 smoke 环境一致性、环境证据与部署账本测试」）
 * 与 UT-S41-11、ST-S41-02（core-S41-test-cases.md）。规范源：spec/environments.md §3、§4.2、§5、§6；spec/test-results.md。
 * 全部在一次性临时项目（git 仓库）中构造；除 UT-S19-58 的纯函数与需要注入写入口 / 等锁上限的 UT-S19-69～UT-S19-71
 * （进程内调用 smoke 并注入 SmokeWriteIo）外，均走真实 CLI 入口 cli/dist/index.js。
 * 「命令未运行」以结果文件哨兵内容未被清空取证；「零副作用」以提案目录文件集合与账本字节前后比对取证。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, takeExitCode } from './helpers.js';
import { classifyDeployDoneMarker, readDeployDoneMarker } from '../src/lib/lifecycle-gate.js';
import { DEPLOY_LEDGER_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';
import { makeErrorEnvelope } from '../src/lib/json-output.js';
import { DEPLOY_LEDGER_LOCK_REL, appendLedgerLine, removeOwnLedgerLine } from '../src/lib/deployment-ledger.js';
import { smoke, type SmokeWriteIo } from '../src/commands/smoke.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const SLUG = 'ship-it';
const RESULT_REL = 'logos/resources/verify/smoke-results.jsonl';
const SENTINEL = '{"id":"SENTINEL","status":"pass"}\n';
const REGISTRY = 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test, aliases: [测试]}\n  - {id: prod, name: Production, tier: prod, aliases: [生产]}\n';
const PROPOSAL = [
  '# 变更提案：ship-it', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：生产',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
].join('\n');
const TASKS = ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [x] 发布'].join('\n');

/**
 * runner 夹具：读取 tools/mode.json 决定 target_environment 写法——
 * "env" 写注入的 OPENLOGOS_SMOKE_ENV；"none" 不写；其他字符串原样写；"partial" 第一行写 env、第二行不写；"empty" 不写任何行。
 * 每行附带 observed_env（runner 实际读到的 OPENLOGOS_SMOKE_ENV）与 runner 自定义的 environment 标签。
 */
const RUNNER = `
const fs = require('fs'); const path = require('path');
const mode = JSON.parse(fs.readFileSync('tools/mode.json', 'utf-8')).target;
const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;
const out = 'logos/resources/verify/smoke-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
const rows = mode === 'empty' ? [] : ['SMOKE-core-01', 'SMOKE-core-02'].map((id, i) => {
  const row = { id, status: 'pass', timestamp: new Date().toISOString(), environment: 'runner-label', observed_env: env };
  if (mode === 'env' || (mode === 'partial' && i === 0)) row.target_environment = env;
  else if (mode !== 'none' && mode !== 'partial') row.target_environment = mode;
  return row;
});
fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\\n') + (rows.length ? '\\n' : ''));
`;

let root: string;
let cleanup: () => void;

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function commitFile(file: string, content: string): string {
  put(file, content);
  git(['add', '-A']);
  git(['commit', '-qm', file]);
  return git(['rev-parse', 'HEAD']);
}

interface SetupOpts {
  registry?: boolean | string;
  command?: boolean;
  sandbox?: 'off' | 'auto';
  guard?: boolean;
  target?: string;
}

function setup(opts: SetupOpts = {}): void {
  scaffoldProject(root, { locale: 'en' });
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfg.smoke = {
    result_path: RESULT_REL,
    sandbox_mode: opts.sandbox ?? 'off',
    ...(opts.command === false ? {} : { command: 'node tools/runner.js' }),
    ...(opts.sandbox === 'auto' ? { sandbox_root: join(root, '..', `${root.split('/').pop()}-sbx`), sandbox_reuse: false } : {}),
  };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }, { lineWidth: 0 }));
  put('logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | a |\n| SMOKE-core-02 | b |\n');
  put('tools/runner.js', RUNNER);
  put('tools/mode.json', JSON.stringify({ target: opts.target ?? 'env' }));
  put('logos/resources/verify/deployment-report.md', '# Deployment Report\n\nok\n');
  if (opts.registry !== false) put(ENV_REGISTRY_REL, typeof opts.registry === 'string' ? opts.registry : REGISTRY);
  const proposalDir = join(root, 'logos/changes', SLUG);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(proposalDir, 'proposal.md'), PROPOSAL);
  writeFileSync(join(proposalDir, 'tasks.md'), TASKS);
  writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
  if (opts.guard !== false) {
    put('logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core', createdAt: new Date().toISOString() }));
  }
  git(['init', '-q']);
  git(['config', 'user.name', 't']);
  git(['config', 'user.email', 't@example.invalid']);
  put('.gitignore', 'logos/.openlogos-runtime/\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
}

const markerPath = () => join(root, 'logos/changes', SLUG, 'DEPLOY_DONE');
const ledgerPath = () => join(root, DEPLOY_LEDGER_REL);

function writeMarker(content: string | Record<string, unknown>): void {
  writeFileSync(markerPath(), typeof content === 'string' ? content : `${JSON.stringify(content)}\n`);
}

function marker(environment: string | null, ref: string | null, deployId = 'dep-1'): Record<string, unknown> {
  return { deploy_id: deployId, environment, ref, ref_source: ref === null ? 'unknown' : 'explicit', recorded_at: '2026-10-14T00:00:00.000Z' };
}

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf-8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function smokeJson(env?: string): { status: number | null; data: any; stderr: string; error: any } {
  const r = cli(['smoke', ...(env !== undefined ? ['--env', env] : []), '--format', 'json']);
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data; } catch { /* 拒绝路径无 stdout */ }
  try { error = JSON.parse(r.stderr).error; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, stderr: r.stderr, error };
}

function ledger(): Array<Record<string, any>> {
  return existsSync(ledgerPath()) ? readFileSync(ledgerPath(), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

function smokeRows(): Array<Record<string, any>> {
  return ledger().filter(l => l.kind === 'smoke');
}

function snapshot(): string {
  const dir = join(root, 'logos/changes', SLUG);
  return JSON.stringify({
    files: readdirSync(dir).sort(),
    ledger: existsSync(ledgerPath()) ? readFileSync(ledgerPath(), 'utf-8') : null,
    results: existsSync(join(root, RESULT_REL)) ? readFileSync(join(root, RESULT_REL), 'utf-8') : null,
  });
}

/** 拒绝路径：错误码、退出码 1、smoke.command 未运行（哨兵仍在）、无 smoke marker、账本与提案目录不变。 */
function expectRejected(env: string | undefined, code: string, contains?: string): any {
  put(RESULT_REL, SENTINEL);
  const before = snapshot();
  const r = smokeJson(env);
  expect(r.status, `${code}: ${r.stderr}`).toBe(1);
  expect(r.error?.code).toBe(code);
  if (contains) expect(r.error.message).toContain(contains);
  expect(readFileSync(join(root, RESULT_REL), 'utf-8'), '命令未运行').toBe(SENTINEL);
  for (const m of ['SMOKE_PASS', 'SMOKE_FAIL']) expect(existsSync(join(root, 'logos/changes', SLUG, m)), m).toBe(false);
  expect(snapshot(), `${code} 零副作用`).toBe(before);
  return r.error;
}

const proposalDir = () => join(root, 'logos/changes', SLUG);
const lockPath = () => join(root, DEPLOY_LEDGER_LOCK_REL);
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

/** 两种 smoke 标记的存在性与原始字节、账本字节（被目录占据时记为 <dir>）。 */
function markerLedgerState(): Record<string, string | null> {
  const read = (p: string) => {
    if (!existsSync(p)) return null;
    return statSync(p).isDirectory() ? '<dir>' : readFileSync(p).toString('base64');
  };
  return {
    SMOKE_PASS: read(join(proposalDir(), 'SMOKE_PASS')),
    SMOKE_FAIL: read(join(proposalDir(), 'SMOKE_FAIL')),
    ledger: read(ledgerPath()),
  };
}

/** 重置提案目录内的 smoke 标记为给定现场。 */
function placeMarkers(markers: Partial<Record<'SMOKE_PASS' | 'SMOKE_FAIL', string>>): void {
  for (const name of ['SMOKE_PASS', 'SMOKE_FAIL'] as const) rmSync(join(proposalDir(), name), { force: true });
  for (const [name, content] of Object.entries(markers)) writeFileSync(join(proposalDir(), name), content);
}

/** 预置新鲜账本锁文件（mtime 为当前时间，不会被当作遗留锁回收）。 */
function placeLock(): void {
  put(DEPLOY_LEDGER_LOCK_REL, '99999');
}

/**
 * 进程内调用 smoke（JSON 模式），用于注入写入口与等锁上限；process.exit 被替换为抛错并在此还原为退出码。
 * 其他异常原样上抛——测试据此断言「不以未捕获异常退出」。
 */
function smokeInProcess(env: string | undefined, writeIo?: Partial<SmokeWriteIo>): { exit: number; logs: string[]; errors: string[] } {
  const con = captureConsole();
  const restoreCwd = mockCwd(root);
  const exitSpy = mockProcessExit();
  try {
    let exit: number;
    try {
      smoke('json', env, { writeIo });
      exit = Number(takeExitCode() ?? 0);
    } catch (error) {
      const m = /^process\.exit\((\d+)\)$/.exec((error as Error).message);
      if (!m) throw error;
      takeExitCode();
      exit = Number(m[1]);
    }
    return { exit, logs: [...con.logs], errors: [...con.errors] };
  } finally {
    exitSpy.mockRestore();
    restoreCwd();
    con.restore();
  }
}

/** SMOKE_LEDGER_WRITE_FAILED：退出码 1、stderr 只有一份 JSON envelope、无成功 envelope；返回 error 对象。 */
function expectLedgerWriteFailed(r: { exit: number; logs: string[]; errors: string[] }, stage: 'ledger' | 'marker', label: string): any {
  expect(r.exit, label).toBe(1);
  expect(r.logs, `${label} 不输出成功 envelope`).toEqual([]);
  expect(r.errors, `${label} stderr 只有一份 envelope`).toHaveLength(1);
  const err = JSON.parse(r.errors[0]).error;
  expect(err.code, label).toBe('SMOKE_LEDGER_WRITE_FAILED');
  expect(err.details.stage, label).toBe(stage);
  expect(typeof err.details.reason === 'string' && err.details.reason.length > 0, `${label} reason 非空`).toBe(true);
  return err;
}

const eacces = (path: string) => Object.assign(new Error(`EACCES: permission denied, unlink '${path}'`), { code: 'EACCES' });
const ioError = (code: string, what: string) => Object.assign(new Error(`${code}: ${what}`), { code });

/** 去掉账本末尾的换行，构造「末行完整但缺少换行」的现场（既有读取器仍接受该末行）。 */
function stripLedgerTrailingNewline(): void {
  writeFileSync(ledgerPath(), readFileSync(ledgerPath(), 'utf-8').replace(/\n$/, ''));
}

// ───────────── environment-deploy 切片 2：smoke 部署身份核对（UT-S19-72、UT-S19-73、ST-S19-29） ─────────────

/** prod 配置了 deploy 的登记表：部署执行已启用（spec/environments.md §1）。 */
const REGISTRY_DEPLOY = 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test, aliases: [测试]}\n  - id: prod\n    name: Production\n    tier: prod\n    aliases: [生产]\n    deploy: {mode: script, script: deploy/prod.sh}\n';
const RA = 'a'.repeat(40);
const RB = 'b'.repeat(40);

/** deploy-done 写出的旧形态 deploy 记录。 */
function legacyDeployLine(env: string, deployId: string, ref: string | null): Record<string, unknown> {
  return {
    kind: 'deploy', environment: env, slug: SLUG, recorded_at: '2026-10-15T00:00:00.000Z', observed_head: RA, observed_dirty: false,
    deploy_id: deployId, ref, ref_source: ref === null ? 'unknown' : 'explicit', result: 'done',
  };
}

/** openlogos deploy 写出的扩展 deploy 记录（版本通道）。 */
function execDeployLine(env: string, deployId: string, result: 'done' | 'failed' | 'unknown', ref: string | null): Record<string, unknown> {
  return {
    kind: 'deploy', environment: env, slug: null, recorded_at: '2026-10-15T01:00:00.000Z', observed_head: RA, observed_dirty: false,
    deploy_id: deployId, ref, ref_source: ref === null ? 'unknown' : 'explicit', result,
    channel: 'version', mode: 'script', ref_input: 'v2', ref_requested: ref ?? RB,
    failure_reason: result === 'failed' ? 'exit-code' : (result === 'unknown' ? 'ci-observe-timeout' : null),
  };
}

function writeLedger(lines: Array<Record<string, unknown>>): void {
  if (lines.length === 0) { rmSync(ledgerPath(), { force: true }); return; }
  put(DEPLOY_LEDGER_REL, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}

function proposalFiles(): string[] {
  return readdirSync(join(root, 'logos/changes', SLUG)).sort();
}

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
});
afterEach(() => {
  rmSync(join(root, '..', `${root.split('/').pop()}-sbx`), { recursive: true, force: true });
  cleanup();
});

describe('S19 smoke 环境一致性与证据 — 单元测试', () => {
  it('UT-S19-58: DEPLOY_DONE 三类分类', () => {
    const R = 'a'.repeat(40);
    expect(classifyDeployDoneMarker('')).toEqual({ kind: 'legacy' });
    expect(classifyDeployDoneMarker('  \n\t\n')).toEqual({ kind: 'legacy' });
    expect(classifyDeployDoneMarker(JSON.stringify(marker('test', R))).kind).toBe('valid');
    expect(classifyDeployDoneMarker(JSON.stringify(marker(null, null))).kind).toBe('valid');
    const invalid: Array<[string, string]> = [
      ['{"environment":"test"', 'not valid JSON'],
      ['[]', 'not a JSON object'],
      ['"x"', 'not a JSON object'],
      [JSON.stringify((({ deploy_id: _d, ...rest }) => rest)(marker('test', R))), 'deploy_id'],
      [JSON.stringify(marker('test', 'a'.repeat(39))), 'ref'],
      [JSON.stringify({ ...marker('test', R), ref_source: 'guess' }), 'ref_source'],
      [JSON.stringify({ ...marker('test', R), recorded_at: 1 }), 'recorded_at'],
    ];
    for (const [text, problem] of invalid) {
      const cls = classifyDeployDoneMarker(text);
      expect(cls.kind, text).toBe('invalid');
      expect(cls.kind === 'invalid' && cls.problems, text).toContain(problem);
    }
  });

  it('UT-S19-59: 环境不一致拒绝', () => {
    setup();
    writeMarker(marker('test', 'a'.repeat(40)));
    expectRejected('prod', 'SMOKE_ENV_MISMATCH', 'test');
    expect(smokeRows()).toEqual([]);
  });

  it('UT-S19-60: 非空损坏 marker 拒绝（有 / 无登记表）', () => {
    setup();
    writeMarker('{"deploy_id":"x","environment":"pro');
    expectRejected('prod', 'SMOKE_DEPLOY_MARKER_INVALID', 'not valid JSON');
    rmSync(join(root, ENV_REGISTRY_REL));
    writeMarker({ ...marker('prod', null), ref_source: 'explicit' });
    expectRejected(undefined, 'SMOKE_DEPLOY_MARKER_INVALID', 'ref_source');
  });

  it('UT-S19-60: DEPLOY_DONE 读取失败拒绝，不降级为旧空格式（EACCES / EISDIR / 检查后消失）', () => {
    // 检查后消失：注入读取抛 ENOENT 的读取器，结果为 unreadable 并保留 I/O 原因，而不是 legacy
    const vanished = readDeployDoneMarker('/nowhere', () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); });
    expect(vanished).toEqual({ kind: 'unreadable', reason: 'ENOENT: gone' });
    expect(readDeployDoneMarker('/nowhere', () => '')).toEqual({ kind: 'legacy' });

    setup();
    // EISDIR：DEPLOY_DONE 被目录替代
    mkdirSync(markerPath());
    expectRejected('prod', 'SMOKE_DEPLOY_MARKER_INVALID', 'EISDIR');
    expect(smokeRows()).toEqual([]);
    rmSync(markerPath(), { recursive: true });

    // EACCES：记录 test 环境的合法 marker 不可读，不得降级为「环境未知」而按 prod 放行
    if (typeof process.getuid === 'function' && process.getuid() === 0) return; // root 不受文件权限限制
    writeMarker(marker('test', 'a'.repeat(40)));
    chmodSync(markerPath(), 0o000);
    try {
      expectRejected('prod', 'SMOKE_DEPLOY_MARKER_INVALID', 'EACCES');
      expect(smokeRows()).toEqual([]);
    } finally {
      chmodSync(markerPath(), 0o644);
    }
  });

  it('UT-S19-68: SMOKE_DEPLOY_MARKER_INVALID 的 error.details（非法 / 无法读取 / 文本模式与其他错误信封不变）', () => {
    // 共用构造入口：不传附加字段时 error 只有 code / message；附加字段不得覆盖 code / message
    expect(Object.keys(makeErrorEnvelope('x', 'C', 'm').error!)).toEqual(['code', 'message']);
    const extra = makeErrorEnvelope('x', 'C', 'm', { code: 'OVERRIDE', message: 'override', details: { problems: ['ref'] } }).error!;
    expect(extra).toEqual({ code: 'C', message: 'm', details: { problems: ['ref'] } });
    expect(Object.keys(extra)).toEqual(['code', 'message', 'details']);

    setup();
    // ① 截断为非法 JSON
    writeMarker('{"deploy_id":"x","environment":"pro');
    const e1 = expectRejected('prod', 'SMOKE_DEPLOY_MARKER_INVALID');
    expect(e1.details).toEqual({ problems: ['not valid JSON'] });
    expect(e1.message).toContain('not valid JSON');
    // 文本模式：同一错误的输出仍是 `Error: [code] message`，不出现 details
    const text = cli(['smoke', '--env', 'prod']);
    expect(text.status).toBe(1);
    expect(text.stderr.trim()).toBe(`Error: [SMOKE_DEPLOY_MARKER_INVALID] ${e1.message}`);

    // ② 合法 JSON 但 ref 为 39 位：problems 点名字段名
    writeMarker(marker('prod', 'a'.repeat(39)));
    const e2 = expectRejected('prod', 'SMOKE_DEPLOY_MARKER_INVALID');
    expect(e2.details).toEqual({ problems: ['ref'] });
    expect(e2.message).toContain('ref');

    // ③ DEPLOY_DONE 被同名目录替代（EISDIR）
    rmSync(markerPath());
    mkdirSync(markerPath());
    const e3 = expectRejected('prod', 'SMOKE_DEPLOY_MARKER_INVALID');
    expect(e3.details.problems).toEqual(['unreadable']);
    expect(e3.details.reason).toMatch(/^EISDIR: /);
    expect(e3.message).toContain(e3.details.reason);
    rmSync(markerPath(), { recursive: true });

    // ④ 合法 marker 权限 000（EACCES；root 不受文件权限限制时跳过本臂）
    if (!(typeof process.getuid === 'function' && process.getuid() === 0)) {
      writeMarker(marker('prod', 'a'.repeat(40)));
      chmodSync(markerPath(), 0o000);
      try {
        const e4 = expectRejected('prod', 'SMOKE_DEPLOY_MARKER_INVALID');
        expect(e4.details.problems).toEqual(['unreadable']);
        expect(e4.details.reason).toMatch(/^EACCES: /);
      } finally {
        chmodSync(markerPath(), 0o644);
      }
    }

    // 其他命令的既有错误信封逐字不变：error 只含 code / message
    const bare = makeTempRoot();
    try {
      const r = spawnSync(process.execPath, [CLI, 'status', '--format', 'json'], { cwd: bare.root, encoding: 'utf-8', timeout: 120_000 });
      expect(r.status).not.toBe(0);
      const err = JSON.parse(r.stderr).error;
      expect(err.code).toBe('PROJECT_NOT_INITIALIZED');
      expect(Object.keys(err)).toEqual(['code', 'message']);
    } finally {
      bare.cleanup();
    }
  });

  it('UT-S19-61: 旧空 marker 与未记录环境放行但未确认', () => {
    setup();
    for (const content of ['', marker(null, 'a'.repeat(40))] as const) {
      writeMarker(content as string | Record<string, unknown>);
      const r = smokeJson('prod');
      expect(r.status, r.stderr).toBe(0);
      expect(r.data.gate.result).toBe('PASS');
      expect(existsSync(join(root, 'logos/changes', SLUG, 'SMOKE_PASS'))).toBe(true);
      const last = smokeRows().pop()!;
      expect(last).toMatchObject({ environment: 'prod', deploy_env_confirmed: false, verified: false, result: 'pass', env_evidence: 'declared' });
    }
  });

  it('UT-S19-62: 环境证据判定', () => {
    const R = 'a'.repeat(40);
    const cases: Array<[string, string, string, string | null]> = [
      ['env', 'declared', 'PASS', null],
      ['partial', 'missing', 'PASS', null],
      ['test', 'mismatch', 'FAIL', 'SMOKE_ENV_EVIDENCE_MISMATCH'],
      ['empty', 'missing', 'FAIL', null],
    ];
    for (const [mode, evidence, gate, reason] of cases) {
      cleanup();
      ({ root, cleanup } = makeTempRoot());
      setup({ target: mode });
      writeMarker(marker('prod', R));
      const r = smokeJson('prod');
      expect(r.data.environment_evidence.env_evidence, mode).toBe(evidence);
      expect(r.data.gate.result, mode).toBe(gate);
      if (reason) {
        expect(r.data.gate.reason).toBe(reason);
        expect(r.status).toBe(1);
        expect(existsSync(join(root, 'logos/changes', SLUG, 'SMOKE_FAIL'))).toBe(true);
        expect(r.data.environment_evidence.mismatched_case_ids).toEqual(['SMOKE-core-01', 'SMOKE-core-02']);
      }
      if (mode === 'partial') expect(r.data.environment_evidence.missing_case_ids).toEqual(['SMOKE-core-02']);
      expect(smokeRows().pop()!.env_evidence, mode).toBe(evidence);
    }
  });

  it('UT-S19-62: 结果文件缺失的门禁 FAIL 仍产出环境证据、失败标记与账本', () => {
    setup({ command: false });
    // 本提案新增 smoke 用例（覆盖预检据 deltas/test/smoke 判定），结果文件缺失、无 smoke.command
    put(`logos/changes/${SLUG}/deltas/test/smoke/core-smoke-test-cases.md`, '| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | a |\n');
    const R = 'a'.repeat(40);
    writeMarker(marker('prod', R, 'dep-prod'));
    expect(existsSync(join(root, RESULT_REL))).toBe(false);
    const r = smokeJson('prod');
    expect(r.status).toBe(1);
    expect(r.data.gate.result).toBe('FAIL');
    expect(r.data.environment_evidence).toMatchObject({
      target: 'prod', env_evidence: 'missing', verified: false, deploy_env_confirmed: true, ref: R, ledger_written: true, fresh_results: false,
    });
    expect(existsSync(join(root, 'logos/changes', SLUG, 'SMOKE_FAIL'))).toBe(true);
    expect(existsSync(join(root, 'logos/changes', SLUG, 'SMOKE_PASS'))).toBe(false);
    expect(smokeRows().pop()).toMatchObject({ kind: 'smoke', result: 'fail', env_evidence: 'missing', verified: false, deploy_id: 'dep-prod' });
    const show = JSON.parse(cli(['env', 'show', 'prod', '--format', 'json']).stdout).data;
    expect(show.last_smoke).toMatchObject({ result: 'fail', verified: false });
  });

  it('UT-S19-63: smoke 记录继承部署 ref', () => {
    setup();
    const r1 = git(['rev-parse', 'HEAD']);
    const r2 = commitFile('src.txt', 'r2\n');
    writeMarker(marker('prod', r1, 'dep-r1'));
    const r = smokeJson('生产');
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.environment).toBe('prod');
    expect(r.data.environment_evidence).toMatchObject({ target: 'prod', deploy_id: 'dep-r1', ref: r1, deploy_env_confirmed: true, verified: true, fresh_results: true, ledger_written: true });
    expect(smokeRows().pop()).toMatchObject({ kind: 'smoke', ref: r1, deploy_id: 'dep-r1', observed_head: r2, verified: true });
    writeMarker(marker('prod', null, 'dep-null'));
    const unknown = smokeJson('prod');
    expect(unknown.data.environment_evidence).toMatchObject({ ref: null, verified: false });
    expect(smokeRows().pop()).toMatchObject({ ref: null, verified: false });
  });

  it('UT-S19-64: OPENLOGOS_SMOKE_ENV 注入', () => {
    for (const sandbox of ['off', 'auto'] as const) {
      cleanup();
      ({ root, cleanup } = makeTempRoot());
      setup({ sandbox });
      writeMarker(marker('prod', 'a'.repeat(40)));
      const r = smokeJson('生产');
      expect(r.status, `${sandbox}: ${r.stderr}`).toBe(0);
      expect(r.data.sandbox.mode, '配置的沙箱模式生效').toBe(sandbox);
      const rows = readFileSync(join(root, RESULT_REL), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
      expect(rows.map(x => x.observed_env), sandbox).toEqual(['prod', 'prod']);
    }
    // 无登记表时不注入
    cleanup();
    ({ root, cleanup } = makeTempRoot());
    setup({ registry: false });
    writeMarker(marker('prod', null));
    smokeJson('prod');
    const rows = readFileSync(join(root, RESULT_REL), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    expect(rows.map(x => x.observed_env)).toEqual([null, null]);
    expect(process.env.OPENLOGOS_SMOKE_ENV, '父进程环境未被污染').toBeUndefined();
  });

  it('UT-S19-65: 有登记表时 smoke 环境缺失或未登记', () => {
    setup();
    writeMarker(marker('prod', null));
    expectRejected(undefined, 'ENV_REQUIRED', 'test, prod');
    expectRejected('staging', 'ENV_UNKNOWN', 'test, prod');
  });

  it('UT-S19-66: 无登记表时 smoke 行为逐字不变', () => {
    const DATA_KEYS = ['changed_cases', 'diagnostics', 'environment', 'failed_cases', 'gate', 'report_path', 'result_path', 'runners', 'sandbox', 'skipped_cases', 'summary', 'uncovered_cases'];
    // ① 有活跃提案、marker 为空文件
    setup({ registry: false, target: 'other' });
    writeMarker('');
    const a = smokeJson('prod');
    expect(a.status).toBe(0);
    expect(Object.keys(a.data).sort()).toEqual(DATA_KEYS);
    expect(a.data.environment).toBe('prod');
    expect(a.data.gate).toEqual({ result: 'PASS', reason: null });
    const noEnv = smokeJson();
    expect(noEnv.status).toBe(0);
    expect(noEnv.data.environment).toBeNull();
    // ② 合法 marker 记录 test、本次 --env prod：不拒绝，target_environment 不改变门禁
    writeMarker(marker('test', null));
    const b = smokeJson('prod');
    expect(b.status, b.stderr).toBe(0);
    expect(Object.keys(b.data).sort()).toEqual(DATA_KEYS);
    expect(b.data.gate.result).toBe('PASS');
    expect(smokeRows().pop()).toMatchObject({ environment: 'prod', deploy_env_confirmed: false, env_evidence: 'mismatch', verified: false });
    // ③ 无活跃提案（既有 ST-S19-03 夹具形态）：PASS，账本无新增，无伪造上下文
    rmSync(join(root, 'logos/.openlogos-guard'));
    const before = readFileSync(ledgerPath(), 'utf-8');
    const c = smokeJson('production');
    expect(c.status).toBe(0);
    expect(c.data.environment).toBe('production');
    expect(c.data.gate.result).toBe('PASS');
    expect(readFileSync(ledgerPath(), 'utf-8')).toBe(before);
  });

  it('UT-S19-67: 未运行 smoke 命令时旧结果不得提升为新部署的已验证事实', () => {
    setup({ command: false });
    const r1 = git(['rev-parse', 'HEAD']);
    const r2 = commitFile('src.txt', 'r2\n');
    // R1 时代留下的全部声明 prod 的通过结果
    put(RESULT_REL, ['SMOKE-core-01', 'SMOKE-core-02']
      .map(id => JSON.stringify({ id, status: 'pass', target_environment: 'prod', note: `from ${r1}` })).join('\n') + '\n');
    writeMarker(marker('prod', r2, 'dep-r2'));
    const r = smokeJson('prod');
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.gate.result).toBe('PASS');
    expect(r.data.environment_evidence).toMatchObject({ fresh_results: false, env_evidence: 'declared', verified: false, ref: r2 });
    expect(smokeRows().pop()).toMatchObject({ ref: r2, fresh_results: false, verified: false });
    const show = JSON.parse(cli(['env', 'show', 'prod', '--format', 'json']).stdout).data;
    expect(show.last_smoke.verified).toBe(false);
  });
  it('UT-S19-69: 账本追加失败不改 smoke 标记；未传 --env / 无活跃提案不触碰账本与锁', () => {
    setup();
    expect(cli(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    const scenes: Array<[string, Partial<Record<'SMOKE_PASS' | 'SMOKE_FAIL', string>>]> = [
      ['无旧标记', {}], ['旧 SMOKE_FAIL', { SMOKE_FAIL: 'old-fail\n' }], ['旧 SMOKE_PASS', { SMOKE_PASS: 'old-pass\n' }],
    ];

    // ① 新鲜账本锁文件，等锁上限由注入缩短为 200ms
    for (const [label, markers] of scenes) {
      placeMarkers(markers);
      placeLock();
      const before = markerLedgerState();
      const r = smokeInProcess('prod', { appendLedger: (rt, line) => appendLedgerLine(rt, line, { timeoutMs: 200 }) });
      const err = expectLedgerWriteFailed(r, 'ledger', `① ${label}`);
      expect(err.details.gate_result).toBe('PASS');
      expect(err.details.reason).toContain('locked');
      expect(err.details).not.toHaveProperty('rollback');
      expect(markerLedgerState(), `① ${label}`).toEqual(before);
      rmSync(lockPath());
    }

    // ② 账本路径被同名目录占据（真实 CLI）
    const ledgerBytes = readFileSync(ledgerPath());
    rmSync(ledgerPath());
    mkdirSync(ledgerPath());
    for (const [label, markers] of scenes) {
      placeMarkers(markers);
      const before = markerLedgerState();
      const r = cli(['smoke', '--env', 'prod', '--format', 'json']);
      expect(r.status, `② ${label}: ${r.stderr}`).toBe(1);
      expect(r.stdout, `② ${label} 无成功 envelope`).toBe('');
      const err = JSON.parse(r.stderr).error; // 整个 stderr 只能是一份 JSON envelope
      expect(err.code).toBe('SMOKE_LEDGER_WRITE_FAILED');
      expect(err.details).toMatchObject({ stage: 'ledger', gate_result: 'PASS' });
      expect(err.details.reason).toMatch(/EISDIR/);
      expect(markerLedgerState(), `② ${label}`).toEqual(before);
    }
    rmSync(ledgerPath(), { recursive: true });
    writeFileSync(ledgerPath(), ledgerBytes);

    // ⑤ 追加已完整写入、随后释放账本锁失败（锁文件删不掉）：记录已写成，不得按追加失败报错；标记照常更新，现场一致（code-r1 F1）
    placeMarkers({ SMOKE_FAIL: 'old-fail\n' });
    const r5 = smokeInProcess('prod', {
      appendLedger: (rt, line) => appendLedgerLine(rt, line, {
        io: { releaseLock: fd => { closeSync(fd); throw ioError('EIO', 'unlink lock failed'); } },
      }),
    });
    expect(r5.exit, r5.errors.join('\n')).toBe(0);
    const env5 = JSON.parse(r5.logs[r5.logs.length - 1]).data;
    expect(env5.gate.result).toBe('PASS');
    expect(env5.environment_evidence.ledger_written).toBe(true);
    expect(markerLedgerState()).toMatchObject({ SMOKE_PASS: '', SMOKE_FAIL: null });
    expect(readFileSync(ledgerPath(), 'utf-8').startsWith(ledgerBytes.toString('utf-8'))).toBe(true);
    expect(smokeRows()).toHaveLength(1);
    expect(existsSync(lockPath()), '释放失败遗留的锁文件按 staleMs 回收').toBe(true);
    rmSync(lockPath());
    writeFileSync(ledgerPath(), ledgerBytes);

    // 追加经临时文件原子替换（code-r2 F1）：以下三种 I/O 故障都由生产代码保证账本逐字节等于执行前，标记不变
    // ⑥ 临时文件只写出部分字节即 ENOSPC；⑦ 同上且临时文件清理也失败；⑧ 临时文件写成、原子替换 rename 失败
    const tmpRel = `${DEPLOY_LEDGER_REL}.${process.pid}.append.tmp`;
    const partialWrite = (path: string, data: Buffer) => { writeFileSync(path, data.subarray(0, 15)); throw ioError('ENOSPC', 'no space left on device, write'); };
    const arms: Array<[string, Parameters<typeof appendLedgerLine>[2], string, boolean]> = [
      ['⑥', { io: { writeFile: partialWrite } }, 'ENOSPC', false],
      ['⑦', { io: { writeFile: partialWrite, remove: () => { throw ioError('EIO', 'i/o error, unlink'); } } }, 'ENOSPC', true],
      ['⑧', { io: { rename: () => { throw ioError('EXDEV', 'cross-device link not permitted, rename'); } } }, 'EXDEV', false],
    ];
    for (const [label, opts, code, tmpLeft] of arms) {
      placeMarkers({ SMOKE_FAIL: 'old-fail\n' });
      const before = markerLedgerState();
      const r = smokeInProcess('prod', { appendLedger: (rt, line) => appendLedgerLine(rt, line, opts) });
      const err = expectLedgerWriteFailed(r, 'ledger', label);
      expect(err.details.reason, label).toContain(code);
      expect(markerLedgerState(), `${label} 标记与账本逐字节不变`).toEqual(before);
      expect(readFileSync(ledgerPath()).equals(ledgerBytes), `${label} 账本无本次的行或残片`).toBe(true);
      // 临时文件只在其清理也失败时残留，且不影响账本内容
      expect(existsSync(join(root, tmpRel)), `${label} 临时文件`).toBe(tmpLeft);
      rmSync(join(root, tmpRel), { force: true });
    }

    // ③ 预置锁文件、无登记表且不传 --env：不写账本，标记行为与修复前一致，锁与账本未被触碰
    rmSync(join(root, ENV_REGISTRY_REL));
    placeMarkers({ SMOKE_FAIL: 'old-fail\n' });
    placeLock();
    const lock3 = { bytes: readFileSync(lockPath(), 'utf-8'), mtime: statSync(lockPath()).mtimeMs };
    const r3 = smokeJson();
    expect(r3.status, r3.stderr).toBe(0);
    expect(r3.data.gate.result).toBe('PASS');
    expect(r3.data).not.toHaveProperty('environment_evidence');
    expect(markerLedgerState()).toMatchObject({ SMOKE_PASS: '', SMOKE_FAIL: null, ledger: ledgerBytes.toString('base64') });
    expect({ bytes: readFileSync(lockPath(), 'utf-8'), mtime: statSync(lockPath()).mtimeMs }).toEqual(lock3);

    // ④ 预置锁文件、无活跃提案、传 --env：不写账本、不写标记，锁与账本未被触碰
    put(ENV_REGISTRY_REL, REGISTRY);
    rmSync(join(root, 'logos/.openlogos-guard'));
    placeMarkers({ SMOKE_FAIL: 'old-fail\n' });
    const before4 = markerLedgerState();
    const r4 = smokeJson('prod');
    expect(r4.status, r4.stderr).toBe(0);
    expect(r4.data.gate.result).toBe('PASS');
    expect(r4.data.environment_evidence).toMatchObject({ target: 'prod', ledger_written: false });
    expect(markerLedgerState()).toEqual(before4);
    expect({ bytes: readFileSync(lockPath(), 'utf-8'), mtime: statSync(lockPath()).mtimeMs }).toEqual(lock3);
  }, 120_000);

  it('UT-S19-70: 账本已写、标记阶段失败按快照恢复两种标记并撤销本次账本行', () => {
    setup();
    expect(cli(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    // 预置一条他人的 smoke 记录：撤销本次行时必须逐字节保留
    appendFileSync(ledgerPath(), `${JSON.stringify({ kind: 'smoke', environment: 'test', slug: 'other', recorded_at: '2026-10-01T00:00:00.000Z', result: 'pass' })}\n`);
    const expectRolledBack = (r: ReturnType<typeof smokeInProcess>, label: string, gate: 'PASS' | 'FAIL', before: Record<string, string | null>) => {
      const err = expectLedgerWriteFailed(r, 'marker', label);
      expect(err.details, label).toMatchObject({ gate_result: gate, rollback: 'complete', rollback_problems: [] });
      const after = markerLedgerState();
      expect(after, label).toEqual(before);
      expect(after.SMOKE_PASS !== null && after.SMOKE_FAIL !== null, `${label} 两种标记不得并存`).toBe(false);
    };

    // ① 旧 SMOKE_FAIL、本次 PASS：SMOKE_PASS 写成，删除 SMOKE_FAIL 抛 EACCES
    placeMarkers({ SMOKE_FAIL: 'old-fail\n' });
    const before1 = markerLedgerState();
    const r1 = smokeInProcess('prod', {
      removeMarker: path => { if (path.endsWith('SMOKE_FAIL')) throw eacces(path); rmSync(path, { force: true }); },
    });
    expectRolledBack(r1, '①', 'PASS', before1);
    expect(JSON.parse(r1.errors[0]).error.details.reason).toContain('EACCES');

    // ② 旧 SMOKE_PASS、本次 FAIL（runner 验证的是 test 环境）：SMOKE_FAIL 写成，删除 SMOKE_PASS 抛错
    put('tools/mode.json', JSON.stringify({ target: 'test' }));
    placeMarkers({ SMOKE_PASS: 'old-pass\n' });
    const before2 = markerLedgerState();
    const r2 = smokeInProcess('prod', {
      removeMarker: path => { if (path.endsWith('SMOKE_PASS')) throw eacces(path); rmSync(path, { force: true }); },
    });
    expectRolledBack(r2, '②', 'FAIL', before2);

    // ④ 账本末行完整但缺少换行（PASS / FAIL 两个方向）：追加前原样拒绝，标记与账本逐字节不变（code-r1 F2）
    const intactLedger = readFileSync(ledgerPath());
    stripLedgerTrailingNewline();
    for (const [label, target, markers, gate] of [
      ['④ PASS', 'env', { SMOKE_FAIL: 'old-fail\n' }, 'PASS'],
      ['④ FAIL', 'test', { SMOKE_PASS: 'old-pass\n' }, 'FAIL'],
    ] as const) {
      put('tools/mode.json', JSON.stringify({ target }));
      placeMarkers(markers);
      const before = markerLedgerState();
      const r = smokeInProcess('prod', {
        removeMarker: path => { throw eacces(path); },
      });
      const err = expectLedgerWriteFailed(r, 'ledger', label);
      expect(err.details.gate_result).toBe(gate);
      expect(err.details.reason).toContain('does not end with a newline');
      expect(markerLedgerState(), label).toEqual(before);
    }
    writeFileSync(ledgerPath(), intactLedger);

    // ③ 写目标标记本身失败：提案目录只读（真实 CLI；root 不受目录权限限制时跳过本臂）
    if (isRoot) return;
    put('tools/mode.json', JSON.stringify({ target: 'env' }));
    placeMarkers({ SMOKE_FAIL: 'old-fail\n' });
    const before3 = markerLedgerState();
    chmodSync(proposalDir(), 0o555);
    let r3: ReturnType<typeof cli>;
    try {
      r3 = cli(['smoke', '--env', 'prod', '--format', 'json']);
    } finally {
      chmodSync(proposalDir(), 0o755);
    }
    expect(r3.status, r3.stderr).toBe(1);
    const err3 = JSON.parse(r3.stderr).error;
    expect(err3.code).toBe('SMOKE_LEDGER_WRITE_FAILED');
    expect(err3.details).toMatchObject({ stage: 'marker', gate_result: 'PASS', rollback: 'complete', rollback_problems: [] });
    expect(err3.details.reason).toMatch(/EACCES/);
    expect(markerLedgerState()).toEqual(before3);
  }, 120_000);

  it('UT-S19-71: 恢复失败如实报告 rollback=incomplete，不让二次异常逃逸', () => {
    setup();
    expect(cli(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    const failRel = `logos/changes/${SLUG}/SMOKE_FAIL`;

    // Ⓐ 删除旧 SMOKE_FAIL 时文件已删、调用仍报错，随后写回旧 SMOKE_FAIL 失败
    placeMarkers({ SMOKE_FAIL: 'old-fail\n' });
    const before = markerLedgerState();
    const rA = smokeInProcess('prod', {
      removeMarker: path => {
        rmSync(path, { force: true });
        if (path.endsWith('SMOKE_FAIL')) throw Object.assign(new Error(`EIO: i/o error, unlink '${path}'`), { code: 'EIO' });
      },
      writeMarker: (path, content) => {
        if (path.endsWith('SMOKE_FAIL')) throw Object.assign(new Error(`EROFS: read-only file system, open '${path}'`), { code: 'EROFS' });
        writeFileSync(path, content);
      },
    });
    const errA = expectLedgerWriteFailed(rA, 'marker', 'Ⓐ');
    expect(errA.details.rollback).toBe('incomplete');
    expect(errA.details.rollback_problems).toHaveLength(1);
    expect(errA.details.rollback_problems[0].path).toBe(failRel);
    expect(errA.details.rollback_problems[0].reason).toContain('EROFS');
    expect(errA.message).toContain(failRel);
    // 能恢复的其余项已恢复：本次新建的 SMOKE_PASS 已删除，本次账本行已撤销
    expect(markerLedgerState()).toEqual({ ...before, SMOKE_FAIL: null });

    // Ⓑ 撤销本次账本行时账本锁等待超时
    placeMarkers({ SMOKE_FAIL: 'old-fail\n' });
    const beforeB = markerLedgerState();
    const rB = smokeInProcess('prod', {
      removeMarker: path => { if (path.endsWith('SMOKE_FAIL')) throw eacces(path); rmSync(path, { force: true }); },
      removeOwnLedger: (rt, line, removeIfEmpty) => {
        placeLock();
        return removeOwnLedgerLine(rt, line, removeIfEmpty, { timeoutMs: 200 });
      },
    });
    const errB = expectLedgerWriteFailed(rB, 'marker', 'Ⓑ');
    expect(errB.details.rollback).toBe('incomplete');
    expect(errB.details.rollback_problems).toHaveLength(1);
    expect(errB.details.rollback_problems[0].path).toBe(DEPLOY_LEDGER_REL);
    expect(errB.details.rollback_problems[0].reason).toContain('locked');
    const afterB = markerLedgerState();
    expect({ SMOKE_PASS: afterB.SMOKE_PASS, SMOKE_FAIL: afterB.SMOKE_FAIL }).toEqual({ SMOKE_PASS: beforeB.SMOKE_PASS, SMOKE_FAIL: beforeB.SMOKE_FAIL });
    // 未能撤销的本次 smoke 行如实留在账本，之前的记录逐字节保留在其前面
    const ledgerAfter = readFileSync(ledgerPath(), 'utf-8');
    expect(ledgerAfter.startsWith(Buffer.from(beforeB.ledger!, 'base64').toString('utf-8'))).toBe(true);
    expect(smokeRows()).toHaveLength(1);
    rmSync(lockPath());

    // Ⓒ 本次记录与缺换行的末行粘连（绕过追加前检查构造该现场）：撤销找不到整行时不得报告完整恢复（code-r1 F2）
    placeMarkers({ SMOKE_FAIL: 'old-fail\n' });
    stripLedgerTrailingNewline();
    const glued = readFileSync(ledgerPath(), 'utf-8');
    const rC = smokeInProcess('prod', {
      appendLedger: (_rt, line) => appendFileSync(ledgerPath(), line),
      removeMarker: path => { if (path.endsWith('SMOKE_FAIL')) throw eacces(path); rmSync(path, { force: true }); },
    });
    const errC = expectLedgerWriteFailed(rC, 'marker', 'Ⓒ');
    expect(errC.details.rollback).toBe('incomplete');
    expect(errC.details.rollback_problems).toHaveLength(1);
    expect(errC.details.rollback_problems[0].path).toBe(DEPLOY_LEDGER_REL);
    expect(errC.details.rollback_problems[0].reason).toContain('fused');
    // 账本未被撤销动作改动：粘连的本次记录如实保留，供人工处理
    expect(readFileSync(ledgerPath(), 'utf-8').startsWith(glued)).toBe(true);
    expect(markerLedgerState()).toMatchObject({ SMOKE_PASS: null, SMOKE_FAIL: Buffer.from('old-fail\n').toString('base64') });
  }, 120_000);
  it('UT-S19-72: 提案部署身份被后续部署取代时拒绝', () => {
    setup({ registry: REGISTRY_DEPLOY });
    const d1 = legacyDeployLine('prod', 'd1', RA);
    const cases: Array<[string, Record<string, unknown>]> = [
      ['① 版本通道', execDeployLine('prod', 'd2', 'done', RB)],
      ['② 后续失败', execDeployLine('prod', 'd3', 'failed', null)],
      ['③ 后续未知', execDeployLine('prod', 'd4', 'unknown', null)],
    ];
    for (const [label, later] of cases) {
      placeMarkers({});
      writeMarker(marker('prod', RA, 'd1'));
      writeLedger([d1, later]);
      const err = expectRejected('prod', 'SMOKE_DEPLOY_SUPERSEDED');
      expect(err.details.marker, label).toEqual({ deploy_id: 'd1', ref: RA });
      expect(err.details.latest, label).toMatchObject({ deploy_id: later.deploy_id, channel: 'version', result: later.result });
      expect(readFileSync(markerPath(), 'utf-8'), `${label} 不改写 marker`).toBe(`${JSON.stringify(marker('prod', RA, 'd1'))}\n`);
    }

    // ④ 对照：账本最新记录就是 d1 → 门禁 PASS、已验证
    placeMarkers({});
    writeLedger([d1]);
    const r4 = smokeJson('prod');
    expect(r4.status, r4.stderr).toBe(0);
    expect(r4.data.environment_evidence).toMatchObject({ deploy_id: 'd1', ref: RA, deploy_env_confirmed: true, verified: true });

    // ⑤ 对照：旧空格式 marker、账本有 d2 → 不做核对，部署环境未确认
    placeMarkers({});
    writeMarker('');
    writeLedger([d1, execDeployLine('prod', 'd2', 'done', RB)]);
    const r5 = smokeJson('prod');
    expect(r5.status, r5.stderr).toBe(0);
    expect(r5.data.environment_evidence).toMatchObject({ deploy_id: null, deploy_env_confirmed: false, verified: false });

    // ⑥ 对照：账本中 prod 没有 deploy 记录 → 按 marker 判定
    placeMarkers({});
    writeMarker(marker('prod', RA, 'd1'));
    writeLedger([legacyDeployLine('test', 't1', RB)]);
    const r6 = smokeJson('prod');
    expect(r6.status, r6.stderr).toBe(0);
    expect(r6.data.environment_evidence).toMatchObject({ deploy_id: 'd1', deploy_env_confirmed: true, verified: true });

    // ⑦ 对照（部署执行未启用）：登记表无 deploy，账本只有 deploy-done 记录且 d1 之后另有一条 → 不做核对，行为同修复前
    placeMarkers({});
    put(ENV_REGISTRY_REL, REGISTRY);
    writeMarker(marker('prod', RA, 'd1'));
    writeLedger([d1, legacyDeployLine('prod', 'd9', RB)]);
    const r7 = smokeJson('prod');
    expect(r7.status, r7.stderr).toBe(0);
    expect(r7.error).toBeNull();
    expect(r7.data.gate.result).toBe('PASS');
    expect(r7.data.environment_evidence).toMatchObject({ deploy_id: 'd1', ref: RA, deploy_env_confirmed: true, verified: true, ledger_written: true });
    expect(smokeRows().pop()).toMatchObject({ slug: SLUG, deploy_id: 'd1' });
  }, 120_000);

  it('UT-S19-73: 无活跃提案时以账本记录为部署身份', () => {
    setup({ registry: REGISTRY_DEPLOY, guard: false });
    const files = proposalFiles();
    const cases: Array<[string, Array<Record<string, unknown>>, Record<string, unknown>]> = [
      ['① 成功且版本已确认', [execDeployLine('prod', 'v2', 'done', RB)], { deploy_id: 'v2', ref: RB, deploy_env_confirmed: true, verified: true }],
      ['② 成功但版本未确认', [execDeployLine('prod', 'v3', 'done', null)], { deploy_id: 'v3', ref: null, deploy_env_confirmed: true, verified: false }],
      ['③ 失败', [execDeployLine('prod', 'v4', 'failed', null)], { deploy_id: 'v4', deploy_env_confirmed: false, verified: false }],
      ['④ 无 deploy 记录', [], { deploy_id: null, ref: null, deploy_env_confirmed: false, verified: false }],
    ];
    for (const [label, lines, expected] of cases) {
      writeLedger(lines);
      const r = smokeJson('prod');
      expect(r.status, `${label}: ${r.stderr}`).toBe(0);
      expect(r.data.environment_evidence, label).toMatchObject({ ...expected, ledger_written: true });
      const row = smokeRows().pop()!;
      expect(row, label).toMatchObject({ slug: null, deploy_id: expected.deploy_id, verified: expected.verified });
      expect(proposalFiles(), `${label} 不写任何提案标记`).toEqual(files);
    }

    // 对照（部署执行未启用）：⑤ 无登记表；⑥ 登记表无 deploy、账本只有 deploy-done 记录 → 不写账本，证据与修复前一致
    rmSync(join(root, ENV_REGISTRY_REL));
    writeLedger([legacyDeployLine('prod', 'd1', RA)]);
    const before5 = readFileSync(ledgerPath(), 'utf-8');
    const r5 = smokeJson('prod');
    expect(r5.status, r5.stderr).toBe(0);
    expect(r5.data).not.toHaveProperty('environment_evidence');
    expect(readFileSync(ledgerPath(), 'utf-8')).toBe(before5);

    put(ENV_REGISTRY_REL, REGISTRY);
    const r6 = smokeJson('prod');
    expect(r6.status, r6.stderr).toBe(0);
    expect(r6.data.environment_evidence).toMatchObject({ deploy_id: null, ref: null, deploy_env_confirmed: false, verified: false, ledger_written: false });
    expect(readFileSync(ledgerPath(), 'utf-8')).toBe(before5);

    // ⑦ 删除 deploy 配置但账本保留 openlogos deploy 写出的记录 → 仍按启用口径处理
    writeLedger([legacyDeployLine('prod', 'd1', RA), execDeployLine('prod', 'v5', 'done', RB)]);
    const r7 = smokeJson('prod');
    expect(r7.status, r7.stderr).toBe(0);
    expect(r7.data.environment_evidence).toMatchObject({ deploy_id: 'v5', ref: RB, deploy_env_confirmed: true, ledger_written: true });
    expect(smokeRows().pop()).toMatchObject({ slug: null, deploy_id: 'v5' });
    expect(proposalFiles()).toEqual(files);
  }, 120_000);
});

describe('S19 smoke 环境一致性与证据 — 场景测试', () => {
  it('ST-S19-25: 部署后 HEAD 改变仍记录实际部署版本并得到已验证事实', () => {
    setup();
    const r1 = git(['rev-parse', 'HEAD']);
    expect(cli(['deploy-done', '--env', 'prod', '--ref', r1]).status).toBe(0);
    const r2 = commitFile('src.txt', 'r2\n');
    const r = smokeJson('prod');
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.gate.result).toBe('PASS');
    expect(r.data.environment_evidence).toMatchObject({ env_evidence: 'declared', deploy_env_confirmed: true, ref: r1, verified: true });
    expect(smokeRows().pop()).toMatchObject({ ref: r1, observed_head: r2, verified: true });
  }, 120_000);

  it('ST-S19-26: 参数与 marker 都为 prod、runner 实际验证 test', () => {
    setup({ target: 'test' });
    expect(cli(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    const r = smokeJson('prod');
    expect(r.status).toBe(1);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'SMOKE_ENV_EVIDENCE_MISMATCH' });
    expect(existsSync(join(root, 'logos/changes', SLUG, 'SMOKE_FAIL'))).toBe(true);
    expect(readFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'utf-8')).toContain('**FAIL**');
    expect(smokeRows().pop()).toMatchObject({ env_evidence: 'mismatch', verified: false, result: 'fail' });
    const show = JSON.parse(cli(['env', 'show', 'prod', '--format', 'json']).stdout).data;
    expect(show.last_smoke.verified).toBe(false);
  }, 120_000);

  it('ST-S19-27: 截断 marker 拒绝与重新落标恢复', () => {
    setup();
    expect(cli(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    writeFileSync(markerPath(), readFileSync(markerPath(), 'utf-8').slice(0, 10));
    expectRejected('prod', 'SMOKE_DEPLOY_MARKER_INVALID');
    expect(smokeRows()).toEqual([]);
    expect(cli(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    const r = smokeJson('prod');
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.gate.result).toBe('PASS');
    expect(r.data.environment_evidence.verified).toBe(true);
  }, 120_000);

  it('ST-S19-28: 真实 CLI 下账本锁占用导致的写入失败与恢复后重跑', () => {
    setup();
    // ① 部署落标
    expect(cli(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    const deployOnly = readFileSync(ledgerPath(), 'utf-8');
    // ② 预置新鲜账本锁文件：等锁超时（5 秒）后 SMOKE_LEDGER_WRITE_FAILED，不写任何标记
    placeLock();
    const r2 = smokeJson('prod');
    expect(r2.status, r2.stderr).toBe(1);
    expect(r2.error).toMatchObject({ code: 'SMOKE_LEDGER_WRITE_FAILED', details: { stage: 'ledger', gate_result: 'PASS' } });
    for (const m of ['SMOKE_PASS', 'SMOKE_FAIL']) expect(existsSync(join(proposalDir(), m)), m).toBe(false);
    expect(readFileSync(ledgerPath(), 'utf-8')).toBe(deployOnly);
    expect(ledger().map(l => l.kind)).toEqual(['deploy']);
    // ③ 删除锁文件后重跑：门禁 PASS、写 SMOKE_PASS，账本新增一行已验证的 smoke 记录
    rmSync(lockPath());
    const r3 = smokeJson('prod');
    expect(r3.status, r3.stderr).toBe(0);
    expect(r3.data.gate.result).toBe('PASS');
    expect(r3.data.environment_evidence).toMatchObject({ verified: true, ledger_written: true });
    expect(existsSync(join(proposalDir(), 'SMOKE_PASS'))).toBe(true);
    expect(ledger().map(l => l.kind)).toEqual(['deploy', 'smoke']);
    const smokeRecord = smokeRows()[0];
    expect(smokeRecord).toMatchObject({ environment: 'prod', result: 'pass', verified: true });
    // ④ env show 的 last_smoke 为 ③ 的记录
    const show = JSON.parse(cli(['env', 'show', 'prod', '--format', 'json']).stdout).data;
    // last_smoke 是账本记录的投影：不含 kind、environment、observed_dirty
    const projected = Object.fromEntries(Object.entries(smokeRecord).filter(([k]) => !['kind', 'environment', 'observed_dirty'].includes(k)));
    expect(show.last_smoke).toEqual(projected);
  }, 120_000);
  it('ST-S19-29: 提案落标后被版本发布取代、提案通道重新部署后恢复', () => {
    setup();
    // ① 部署落标
    expect(cli(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    // ② 账本追加一条同环境的版本通道成功记录（模拟 openlogos deploy 版本通道发布；登记表本身未配置 deploy，
    //    由账本中的 openlogos deploy 记录使部署执行已启用）
    const lines = readFileSync(ledgerPath(), 'utf-8');
    put(DEPLOY_LEDGER_REL, `${lines}${JSON.stringify(execDeployLine('prod', 'v-other', 'done', RB))}\n`);
    // ③ smoke 被拒绝且零副作用
    const err = expectRejected('prod', 'SMOKE_DEPLOY_SUPERSEDED');
    expect(err.details.latest).toMatchObject({ deploy_id: 'v-other', channel: 'version' });
    // ④ 提案通道重新落标
    expect(cli(['deploy-done', '--env', 'prod', '--ref', 'HEAD']).status).toBe(0);
    const redeployed = JSON.parse(readFileSync(markerPath(), 'utf-8'));
    // ⑤ smoke 通过并得到已验证事实，smoke 记录关联 ④ 的部署
    const r = smokeJson('prod');
    expect(r.status, r.stderr).toBe(0);
    expect(r.data.gate.result).toBe('PASS');
    expect(r.data.environment_evidence).toMatchObject({ deploy_id: redeployed.deploy_id, verified: true });
    expect(smokeRows().pop()).toMatchObject({ deploy_id: redeployed.deploy_id, verified: true });
  }, 120_000);
});

describe('S41 登记表 fail-closed 与全链路', () => {
  it('UT-S41-11: 登记表非法时 fail-closed', () => {
    setup({ registry: 'schema_version: 1\nenvironments: [\n' });
    writeFileSync(join(root, 'logos/changes', SLUG, 'tasks.md'), TASKS.replace('- [x] 发布', '- [ ] 发布'));
    const tasksBefore = readFileSync(join(root, 'logos/changes', SLUG, 'tasks.md'), 'utf-8');
    const list = cli(['env', 'list', '--format', 'json']);
    expect(list.status).toBe(1);
    expect(JSON.parse(list.stderr).error.code).toBe('ENV_REGISTRY_INVALID');
    const dd = cli(['deploy-done', '--env', 'test', '--format', 'json']);
    expect(dd.status).toBe(1);
    expect(JSON.parse(dd.stderr).error.code).toBe('ENV_REGISTRY_INVALID');
    expect(existsSync(markerPath())).toBe(false);
    expect(readFileSync(join(root, 'logos/changes', SLUG, 'tasks.md'), 'utf-8')).toBe(tasksBefore);
    // smoke：deploy 前置满足（[deploy] 全勾 + DEPLOY_DONE 在场）后仍因登记表非法拒绝
    writeFileSync(join(root, 'logos/changes', SLUG, 'tasks.md'), TASKS);
    writeMarker(marker('test', null));
    expectRejected('test', 'ENV_REGISTRY_INVALID');
    expect(existsSync(ledgerPath())).toBe(false);
  });

  it('ST-S41-02: 部署与 smoke 全链路得到已验证事实', () => {
    setup();
    const r1 = git(['rev-parse', 'HEAD']);
    writeFileSync(join(root, 'logos/changes', SLUG, 'tasks.md'), TASKS.replace('- [x] 发布', '- [ ] 发布'));
    const dd = cli(['deploy-done', '--env', '测试', '--ref', 'HEAD', '--format', 'json']);
    expect(dd.status, dd.stderr).toBe(0);
    expect(JSON.parse(readFileSync(markerPath(), 'utf-8'))).toMatchObject({ environment: 'test', ref: r1 });
    const r2 = commitFile('src.txt', 'r2\n');
    const sm = smokeJson('test');
    expect(sm.status, sm.stderr).toBe(0);
    expect(existsSync(join(root, 'logos/changes', SLUG, 'SMOKE_PASS'))).toBe(true);
    const show = JSON.parse(cli(['env', 'show', 'test', '--format', 'json']).stdout).data;
    expect(show.current_ref).toBe(r1);
    expect(show.last_smoke).toMatchObject({ verified: true, ref: r1, observed_head: r2 });
    const st = JSON.parse(cli(['status', '--format', 'json']).stdout).data;
    const view = st.environments.find((e: any) => e.id === 'test');
    expect(view.current_ref).toBe(show.current_ref);
    expect(view.last_deploy).toEqual(show.last_deploy);
    expect(view.last_smoke).toEqual(show.last_smoke);
  }, 120_000);
});
