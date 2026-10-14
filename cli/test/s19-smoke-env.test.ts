/**
 * environment-registry 切片 4：smoke 环境一致性、环境证据与 smoke 账本（S19），以及 S41 全链路。
 *
 * 覆盖 UT-S19-58～UT-S19-67、ST-S19-25～ST-S19-27（core-S19-test-cases.md「S19 smoke 环境一致性、环境证据与部署账本测试」）
 * 与 UT-S41-11、ST-S41-02（core-S41-test-cases.md）。规范源：spec/environments.md §3、§4.2、§5、§6；spec/test-results.md。
 * 全部在一次性临时项目（git 仓库）中构造；除 UT-S19-58 的纯函数外均走真实 CLI 入口 cli/dist/index.js。
 * 「命令未运行」以结果文件哨兵内容未被清空取证；「零副作用」以提案目录文件集合与账本字节前后比对取证。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { classifyDeployDoneMarker, readDeployDoneMarker } from '../src/lib/lifecycle-gate.js';
import { DEPLOY_LEDGER_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';

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
function expectRejected(env: string | undefined, code: string, contains?: string): void {
  put(RESULT_REL, SENTINEL);
  const before = snapshot();
  const r = smokeJson(env);
  expect(r.status, `${code}: ${r.stderr}`).toBe(1);
  expect(r.error?.code).toBe(code);
  if (contains) expect(r.error.message).toContain(contains);
  expect(readFileSync(join(root, RESULT_REL), 'utf-8'), '命令未运行').toBe(SENTINEL);
  for (const m of ['SMOKE_PASS', 'SMOKE_FAIL']) expect(existsSync(join(root, 'logos/changes', SLUG, m)), m).toBe(false);
  expect(snapshot(), `${code} 零副作用`).toBe(before);
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
