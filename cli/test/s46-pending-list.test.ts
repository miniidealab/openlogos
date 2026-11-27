/**
 * S46 待验收清单、账本推导与关闭环境「未执行的人工用例」（smoke-manual-acceptance，切片 slice-02-registry-ledger-pending-list）。
 *
 * 覆盖 UT-S46-01～UT-S46-11、UT-S46-25～UT-S46-28、UT-S19-132，对应功能规格 §2.107.4、§2.107.7、§2.107.8，
 * spec/environments.md §15.3、§15.4、§15.7，场景 S46 EX-46.6～EX-46.11、EX-46.14、EX-46.18。
 * 全部用例在 mktemp 一次性 git 仓库中构造；账本夹具逐行写入一次性项目，不读写本仓账本。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadEnvironmentRegistry, readDeploymentLedger, manualBaselineOf, waitingStateOf } from '../src/lib/environments.js';
import { computeManualAcceptanceScope, listManualCasesAt } from '../src/lib/manual-acceptance.js';
import { runCli, dataOf, LEDGER_REL } from './s19-module-env-fixtures.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function git(root: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const S01 = 'logos/resources/test/core-S01-test-cases.md';
const SMOKE = 'logos/resources/test/smoke/core-smoke-test-cases.md';
const ST05 = '| ST-S01-05 [manual] | 人工观察终端渲染 | 真实终端 | 打开交互提示 | 颜色正确 |';
const UT77 = '| UT-S01-77 [manual/windows] | 系统弹窗 | Windows | 触发弹窗 | 用户确认 |';
const ST06 = '| ST-S01-06 | 自动用例 | 无 | 运行 | 通过 |';
const ST08 = '| ST-S01-08 [manual] | 人工确认首启 | 实机 | 安装 | 首启正常 |';
const head = '# core-S01\n\n| ID | 描述 | 前置 | 操作 | 预期 |\n|---|---|---|---|---|\n';

/** 一次性项目：已初始化的 openlogos 布局 + git 仓库；返回根目录。 */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'ol-s46-pl-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'logos/logos.config.json', JSON.stringify({ name: 'pl', locale: 'zh', documents: {}, smoke: { result_path: 'logos/resources/verify/smoke-results.jsonl', sandbox_mode: 'off' } }, null, 2));
  put(root, 'logos/logos-project.yaml', 'project:\n  name: pl\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'user.email', 't@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  return root;
}
/** 写规格并提交，返回 40 位 commit。 */
function commit(root: string, files: Record<string, string>, msg = 'c'): string {
  for (const [rel, content] of Object.entries(files)) put(root, rel, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', msg, '--allow-empty']);
  return git(root, ['rev-parse', 'HEAD']);
}
const s01 = (...rows: string[]) => head + rows.join('\n') + '\n';
const smokeSpec = (...rows: string[]) => '# Smoke\n\n| ID | 描述 |\n|---|---|\n' + rows.map(r => `| ${r} | 安装态 |`).join('\n') + '\n';

function registry(root: string, envs: string): void {
  put(root, 'logos/environments.yaml', `schema_version: 1\nenvironments:\n${envs}`);
}
const ENV_PROD = (extra = '') => `  - id: prod\n    name: Production\n    tier: prod\n    manual_acceptance:\n      enabled: true\n${extra}`;
const ENV_TEST = (extra = '') => `  - id: test\n    name: Test\n    tier: test\n${extra}`;

const meta = (env: string) => ({ environment: env, slug: null, recorded_at: '2026-11-27T00:00:00.000Z', observed_head: null, observed_dirty: null });
const deployRow = (env: string, id: string, ref: string | null, result = 'done') => ({
  kind: 'deploy', ...meta(env), deploy_id: id, ref, ref_source: ref === null ? 'unknown' : 'explicit', result,
  channel: 'version', mode: 'script', ref_requested: ref ?? 'f'.repeat(40),
});
const smokeRow = (env: string, deployId: string, ref: string | null, extra: Record<string, unknown> = {}) => ({
  kind: 'smoke', ...meta(env), deploy_id: deployId, ref, result: 'pass', env_evidence: 'declared', fresh_results: true,
  deploy_env_confirmed: true, verified: ref !== null, ...extra,
});
const manualRow = (env: string, deployId: string, caseId: string, result = 'pass', note: string | null = null) => ({
  kind: 'manual', ...meta(env), deploy_id: deployId, ref: null, case_id: caseId, result, note, evidence: [], recorder: null,
});
function ledger(root: string, rows: unknown[]): void {
  put(root, LEDGER_REL, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

/** 读取登记表与账本，计算某环境的人工验收范围。 */
function scopeOf(root: string, envId: string) {
  const reg = loadEnvironmentRegistry(root);
  if (reg.state !== 'loaded') throw new Error('registry');
  const env = reg.environments.find(e => e.id === envId) ?? null;
  return computeManualAcceptanceScope(root, env, readDeploymentLedger(root).byEnvironment.get(envId));
}

describe('S46 待验收清单（smoke-manual-acceptance）', () => {
  it('UT-S46-01: 在给定 commit 上枚举人工用例行，不受工作区影响', () => {
    const root = repo();
    const c1 = commit(root, { [S01]: s01(ST05, UT77, ST06), [SMOKE]: smokeSpec('SMOKE-core-901 [manual]', 'SMOKE-core-01') });
    // 工作区未提交的修改：新增人工行、改动既有行
    put(root, S01, s01(ST05.replace('颜色正确', '已改'), UT77, ST06, ST08));
    const rows = listManualCasesAt(root, c1)!;
    expect([...rows.keys()].sort()).toEqual(['SMOKE-core-901', 'ST-S01-05', 'UT-S01-77']);
    expect(rows.get('ST-S01-05')).toBe(ST05);
    expect(rows.get('UT-S01-77')).toBe(UT77);
    expect(rows.has('ST-S01-06')).toBe(false);
    expect(rows.has('SMOKE-core-01')).toBe(false);
    // 评审 code-r1 F3：中文子目录 / 文件名下的规格（git 默认 core.quotepath 会给展示路径加引号并转义）
    git(root, ['config', 'core.quotepath', 'true']);
    const ZH = 'logos/resources/test/中文模块/core-S09-测试用例.md';
    const ST09 = '| ST-S09-901 [manual] | 中文路径下的人工用例 | 实机 | 操作 | 正常 |';
    expect(git(root, ['ls-tree', '-r', '--name-only', c1, '--', 'logos/resources/test'])).not.toContain('中文模块');
    const c2 = commit(root, { [ZH]: '# core-S09\n\n| ID | 描述 | 前置 | 操作 | 预期 |\n|---|---|---|---|---|\n' + ST09 + '\n' });
    expect(git(root, ['ls-tree', '-r', '--name-only', c2, '--', 'logos/resources/test'])).toMatch(/\.md"$/m);
    const zhRows = listManualCasesAt(root, c2)!;
    expect(zhRows.get('ST-S09-901')).toBe(ST09);
    expect([...zhRows.keys()].sort()).toEqual(['SMOKE-core-901', 'ST-S01-05', 'ST-S01-08', 'ST-S09-901', 'UT-S01-77']);
    // 首次 smoke（无基线、未配置回归）：PENDING 并列出中文路径下的用例，不得直接通过
    registry(root, ENV_PROD());
    put(root, '.gitignore', 'logos/.openlogos-runtime/\nlogos/resources/verify/\n');
    ledger(root, [deployRow('prod', 'd1', c2)]);
    expect(scopeOf(root, 'prod').pending).toContain('ST-S09-901');
  });

  it('UT-S46-02: 首次开启取全部人工用例', () => {
    const root = repo();
    const c1 = commit(root, { [S01]: s01(ST05, UT77, ST06), [SMOKE]: smokeSpec('SMOKE-core-901 [manual]', 'SMOKE-core-01') });
    registry(root, ENV_PROD());
    ledger(root, [deployRow('prod', 'd1', c1)]);
    const scope = scopeOf(root, 'prod');
    expect(scope.pending).toEqual(['SMOKE-core-901', 'ST-S01-05', 'UT-S01-77']);
    expect(scope.baseline_ref).toBeNull();
    expect(scope.scope_unresolved).toBe(false);
  });

  it('UT-S46-03: 有基线时只取增量', () => {
    const root = repo();
    const c1 = commit(root, { [S01]: s01(ST05, UT77) });
    const c2 = commit(root, { [S01]: s01(ST05, UT77, ST08) });
    registry(root, ENV_PROD());
    ledger(root, [deployRow('prod', 'd1', c1), smokeRow('prod', 'd1', c1, { manual_passed: true }), deployRow('prod', 'd2', c2)]);
    const scope = scopeOf(root, 'prod');
    expect(scope.pending).toEqual(['ST-S01-08']);
    expect(scope.baseline_ref).toBe(c1);
  });

  it('UT-S46-04: 行内容变化计入增量，仅首尾空白变化不计入', () => {
    const root = repo();
    const c1 = commit(root, { [S01]: s01(ST05, UT77) });
    const c2 = commit(root, { [S01]: s01(ST05.replace('颜色正确', '颜色与光标正确'), `   ${UT77}   `) });
    registry(root, ENV_PROD());
    ledger(root, [deployRow('prod', 'd1', c1), smokeRow('prod', 'd1', c1, { manual_passed: true }), deployRow('prod', 'd2', c2)]);
    expect(scopeOf(root, 'prod').pending).toEqual(['ST-S01-05']);
  });

  it('UT-S46-05: 回归用例并入且在已部署版本上解析', () => {
    const root = repo();
    const c1 = commit(root, { [S01]: s01(ST05), [SMOKE]: smokeSpec('SMOKE-core-901 [manual]') });
    registry(root, ENV_PROD('      regression: [SMOKE-core-901]\n'));
    ledger(root, [deployRow('prod', 'd0', c1), smokeRow('prod', 'd0', c1, { manual_passed: true }), deployRow('prod', 'd1', c1)]);
    const scope = scopeOf(root, 'prod');
    expect(scope.pending).toEqual(['SMOKE-core-901']);
    expect(scope.regression_unresolved).toEqual([]);
  });

  it('UT-S46-06: 回归用例失效进入 regression_unresolved', () => {
    const root = repo();
    const c1 = commit(root, { [S01]: s01(ST05, ST06), [SMOKE]: smokeSpec('SMOKE-core-901 [manual]') });
    registry(root, ENV_PROD('      regression: [SMOKE-core-901, ST-S01-99]\n'));
    ledger(root, [deployRow('prod', 'd0', c1), smokeRow('prod', 'd0', c1, { manual_passed: true }), deployRow('prod', 'd1', c1)]);
    let scope = scopeOf(root, 'prod');
    expect(scope.regression_unresolved).toEqual(['ST-S01-99']);
    expect(scope.pending).not.toContain('ST-S01-99');
    // 另一夹具：regression 指向 R 版本中没有人工标记的 ST-S01-06
    registry(root, ENV_PROD('      regression: [ST-S01-06]\n'));
    scope = scopeOf(root, 'prod');
    expect(scope.regression_unresolved).toEqual(['ST-S01-06']);
    expect(scope.pending).not.toContain('ST-S01-06');
  });

  it('UT-S46-07: 已部署版本为 null 时清单无法确定，不读工作区', () => {
    const root = repo();
    commit(root, { [S01]: s01(ST05) });
    registry(root, ENV_PROD());
    ledger(root, [deployRow('prod', 'd1', null)]);
    put(root, S01, s01(ST05, ST08));
    const scope = scopeOf(root, 'prod');
    expect(scope.scope_unresolved).toBe(true);
    expect(scope.pending).toEqual([]);
  });

  it('UT-S46-08: 已部署版本对象不可读时清单无法确定', () => {
    const root = repo();
    commit(root, { [S01]: s01(ST05) });
    registry(root, ENV_PROD());
    ledger(root, [deployRow('prod', 'd1', 'c'.repeat(40))]);
    const scope = scopeOf(root, 'prod');
    expect(scope.scope_unresolved).toBe(true);
    expect(scope.pending).toEqual([]);
  });

  it('UT-S46-09: 基线不可读按全量并警告 manual_baseline_unavailable', () => {
    const root = repo();
    const c1 = commit(root, { [S01]: s01(ST05, ST08) });
    const missing = 'd'.repeat(40);
    registry(root, ENV_PROD());
    ledger(root, [deployRow('prod', 'd0', missing), smokeRow('prod', 'd0', missing, { manual_passed: true }), deployRow('prod', 'd1', c1)]);
    const scope = scopeOf(root, 'prod');
    expect(scope.pending).toEqual(['ST-S01-05', 'ST-S01-08']);
    expect(scope.warnings.map(w => w.code)).toEqual(['manual_baseline_unavailable']);
  });

  it('UT-S46-10: 关闭环境计算未执行的人工用例', () => {
    const root = repo();
    const c1 = commit(root, { [S01]: s01(ST05) });
    const c2 = commit(root, { [S01]: s01(ST05, ST08) });
    registry(root, ENV_TEST('    manual_acceptance:\n      regression: [ST-S01-05, ST-S01-99]\n'));
    ledger(root, [deployRow('test', 'd1', c1), deployRow('test', 'd2', c2)]);
    const scope = scopeOf(root, 'test');
    expect(scope.enabled).toBe(false);
    expect(scope.unexecuted).toEqual(['ST-S01-05', 'ST-S01-08']);
    expect(scope.warnings.map(w => w.code)).toEqual(['manual_regression_unknown']);
    expect(scope.warnings[0].message).toContain('ST-S01-99');
    expect(scope.pending).toEqual([]);
    expect(scope.regression_unresolved).toEqual([]);
    expect(scope.scope_unresolved).toBe(false);
  });

  it('UT-S46-11: 关闭环境没有上一次部署时为全部人工用例', () => {
    const root = repo();
    const c1 = commit(root, { [S01]: s01(ST05, UT77, ST06) });
    registry(root, ENV_TEST());
    ledger(root, [deployRow('test', 'd1', c1)]);
    expect(scopeOf(root, 'test').unexecuted).toEqual(['ST-S01-05', 'UT-S01-77']);
  });
});

describe('S46 账本推导（smoke-manual-acceptance）', () => {
  it('UT-S46-25: 过期推导与基线', () => {
    const root = repo();
    const c0 = commit(root, { [S01]: s01(ST05) });
    const c1 = commit(root, { [S01]: s01(ST05, ST08) });
    registry(root, ENV_PROD());
    // 只有一条通过记录且已过期 → 基线为 null
    ledger(root, [
      deployRow('prod', 'd1', c1), smokeRow('prod', 'd1', c1, { manual_passed: true }), manualRow('prod', 'd1', 'ST-S01-05', 'fail', '白屏'),
      deployRow('prod', 'd2', c1),
    ]);
    let state = readDeploymentLedger(root).byEnvironment.get('prod')!;
    expect(manualBaselineOf(state)).toBeNull();
    expect(state.verifiedRefs.has(c1)).toBe(false);
    expect(state.candidateRef).toBeNull();
    // 更早有一条未过期通过记录 → 基线退回它
    ledger(root, [
      deployRow('prod', 'd0', c0), smokeRow('prod', 'd0', c0, { manual_passed: true }),
      deployRow('prod', 'd1', c1), smokeRow('prod', 'd1', c1, { manual_passed: true }), manualRow('prod', 'd1', 'ST-S01-05', 'fail', '白屏'),
      deployRow('prod', 'd2', c1),
    ]);
    state = readDeploymentLedger(root).byEnvironment.get('prod')!;
    expect(manualBaselineOf(state)).toBe(c0);
    expect(state.verifiedRefs.has(c0)).toBe(true);
    expect(state.verifiedRefs.has(c1)).toBe(false);
    expect(state.candidateRef).toBe(c0);
  });

  it('UT-S46-26: 过期记录不作为晋级依据（deploy --dry-run）', () => {
    const root = repo();
    put(root, 'deploy/prod.sh', '#!/bin/sh\nexit 0\n');
    put(root, 'deploy/staging.sh', '#!/bin/sh\nexit 0\n');
    const x = commit(root, { [S01]: s01(ST05) });
    registry(root, [
      '  - id: staging\n    name: Staging\n    tier: staging\n    deploy: {mode: script, script: deploy/staging.sh}\n    manual_acceptance: {enabled: true}\n',
      '  - id: prod\n    name: Production\n    tier: prod\n    deploy: {mode: script, script: deploy/prod.sh}\n    promote_from: staging\n',
    ].join(''));
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'registry']);
    ledger(root, [
      deployRow('staging', 'd1', x), smokeRow('staging', 'd1', x, { manual_passed: true }), manualRow('staging', 'd1', 'ST-S01-05', 'fail', '白屏'),
    ]);
    const r = runCli(root, ['deploy', '--env', 'prod', '--ref', x, '--dry-run', '--format', 'json']);
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stderr.trim().split('\n').pop()!).error;
    expect(err.code).toBe('DEPLOY_PROMOTION_UNVERIFIED');
    expect(err.details.upstream_candidate_ref).not.toBe(x);
  });

  it('UT-S46-27: 剩余清单只读账本，多次等待不会重新列出已记录用例', () => {
    const root = repo();
    commit(root, { [S01]: s01(ST05) });
    registry(root, ENV_PROD());
    const c = git(root, ['rev-parse', 'HEAD']);
    ledger(root, [
      deployRow('prod', 'd1', c),
      smokeRow('prod', 'd1', c, { result: 'pending', verified: false, manual_pending: ['ST-S01-05', 'ST-S01-08'] }),
      manualRow('prod', 'd1', 'ST-S01-05'),
      smokeRow('prod', 'd1', c, { result: 'pending', verified: false, manual_pending: ['ST-S01-08'] }),
      manualRow('prod', 'd1', 'ST-S01-08'),
    ]);
    // 只读账本、不读 git：移走 .git 并清空 PATH 后推导结果不变（任何 git 调用都会失败）
    rmSync(join(root, '.git'), { recursive: true, force: true });
    const savedPath = process.env.PATH;
    process.env.PATH = '';
    let waiting: ReturnType<typeof waitingStateOf>;
    try {
      waiting = waitingStateOf(readDeploymentLedger(root).byEnvironment.get('prod'));
    } finally {
      process.env.PATH = savedPath;
    }
    expect(waiting).toEqual({ deploy_id: 'd1', remaining: [] });
    expect(waitingStateOf.length).toBe(1);
  });

  it('UT-S46-28: EnvView 的 manual_acceptance（env show / env list）', () => {
    const root = repo();
    commit(root, { [S01]: s01(ST05) });
    const c = git(root, ['rev-parse', 'HEAD']);
    registry(root, ENV_PROD() + ENV_TEST());
    ledger(root, [
      deployRow('prod', 'd1', c),
      smokeRow('prod', 'd1', c, { result: 'pending', verified: false, manual_pending: ['ST-S01-05', 'ST-S01-08'] }),
      manualRow('prod', 'd1', 'ST-S01-05'),
      smokeRow('prod', 'd1', c, { result: 'pending', verified: false, manual_pending: ['ST-S01-08'] }),
      manualRow('prod', 'd1', 'ST-S01-08'),
    ]);
    const show = dataOf<Record<string, any>>(runCli(root, ['env', 'show', 'prod', '--format', 'json']));
    expect(show.manual_acceptance).toEqual({ enabled: true, regression: [], waiting: { deploy_id: 'd1', remaining: [] } });
    const list = dataOf<Record<string, any>>(runCli(root, ['env', 'list', '--format', 'json'])).environments;
    expect(list.find((e: any) => e.id === 'prod').manual_acceptance).toEqual(show.manual_acceptance);
    expect('manual_acceptance' in list.find((e: any) => e.id === 'test')).toBe(false);
    // 最近 smoke 不是 pending 时 waiting=null
    put(root, LEDGER_REL, readFileSync(join(root, LEDGER_REL), 'utf-8') + JSON.stringify(smokeRow('prod', 'd1', c, { manual_passed: true })) + '\n');
    const again = dataOf<Record<string, any>>(runCli(root, ['env', 'show', 'prod', '--format', 'json']));
    expect(again.manual_acceptance.waiting).toBeNull();
  });
});

describe('S19 关闭环境的未执行人工用例（smoke-manual-acceptance）', () => {
  it('UT-S19-132: 自动用例为零但有人工用例，关闭环境 smoke 通过并列出「未执行的人工用例」', () => {
    for (const variant of ['smoke', 'utst'] as const) {
      const root = repo();
      const files: Record<string, string> = variant === 'smoke'
        ? { [SMOKE]: smokeSpec('SMOKE-core-901 [manual]') }
        : { [S01]: s01(ST05), [SMOKE]: '# Smoke\n\n暂无自动用例。\n' };
      const c = commit(root, files);
      registry(root, ENV_TEST());
      ledger(root, [deployRow('test', 'd1', c)]);
      const r = runCli(root, ['smoke', '--env', 'test', '--format', 'json']);
      expect(r.status, `${variant}: ${r.stderr}`).toBe(0);
      const data = dataOf<Record<string, any>>(r);
      expect(data.gate).toEqual({ result: 'PASS', reason: null });
      expect(data.summary.defined_count).toBe(0);
      const expected = variant === 'smoke' ? ['SMOKE-core-901'] : ['ST-S01-05'];
      expect(data.manual_acceptance).toMatchObject({ enabled: false, environment: 'test', deploy_id: 'd1', unexecuted: expected, pending: [] });
      const report = readFileSync(join(root, data.report_path), 'utf-8');
      expect(report).toContain(`未执行的人工用例 ${expected.length} 条`);
      for (const id of expected) expect(report).toContain(`- ${id}`);
    }
  });
});
