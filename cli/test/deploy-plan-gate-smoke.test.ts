/**
 * deploy-plan-gate-release-0-15-19：安装态 smoke runner `scripts/smoke-deploy-plan-gate-0-15-19.js`
 * （SMOKE-core-223～SMOKE-core-225）与 smoke 门的负向验证（code 评审 F1、F2），不落真实全局环境。
 *
 * - runner 的 cwd 为伪造仓库（活跃提案 = 本 slug、候选 / 回滚版本常量），结果写入伪造仓库或临时账本。
 * - 自测模式注入仓内 cli/dist/index.js；正式模式经 PATH 中指向仓内 dist 的 openlogos 链接模拟 workspace link。
 * - 缺回滚制品的 skip 经真实 `smoke` 门汇总：本提案新增用例 skip → 门禁 FAIL、不写 SMOKE_PASS、缺失项可见。
 * 本文件不认领 UT/ST 编号（smoke 用例的结果由 runner 自身写入 smoke 账本）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, scaffoldProject, takeExitCode } from './helpers.js';
import { smoke } from '../src/commands/smoke.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(REPO_ROOT, 'scripts', 'smoke-deploy-plan-gate-0-15-19.js');
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const SLUG = 'deploy-plan-gate-release-0-15-19';
const IDS = ['SMOKE-core-223', 'SMOKE-core-224', 'SMOKE-core-225'];
const TIMEOUT = 180_000;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return root;
}

/** 伪造仓库：活跃提案为本 slug；候选版本取仓内 dist 的真实版本，回滚版本指向不存在的制品。 */
function fakeRepo(): string {
  const root = tempRoot();
  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ smoke: { result_path: 'logos/resources/verify/smoke-results.jsonl' } }));
  const version = JSON.parse(readFileSync(join(REPO_ROOT, 'cli', 'package.json'), 'utf-8')).version as string;
  mkdirSync(join(root, 'cli', 'src', 'lib'), { recursive: true });
  writeFileSync(join(root, 'cli', 'src', 'lib', 'local-release-candidate.ts'), [
    `export const LOCAL_RELEASE_CANDIDATE_VERSION = '${version}' as const;`,
    "export const LOCAL_RELEASE_ROLLBACK_VERSION = '0.0.0-missing' as const;",
  ].join('\n'));
  return root;
}

interface Row { id: string; status: string; environment: string; detail: string; evidence: string[] }
function rows(path: string): Row[] {
  return existsSync(path) ? readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Row) : [];
}

function runRunner(cwd: string, env: Record<string, string | undefined>) {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ENTRY', 'OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_SELF_TEST',
    'OPENLOGOS_SMOKE_RESULT_PATH', 'OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE']) delete merged[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) merged[k] = v;
  const r = spawnSync(process.execPath, [RUNNER], { cwd, encoding: 'utf-8', env: merged, timeout: TIMEOUT });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('deploy-plan-gate smoke runner：正式与自测隔离（code 评审 F2）', () => {
  it('注入入口但未声明自测 → 拒绝运行、零写入', () => {
    const repo = fakeRepo();
    const ledger = join(repo, 'self.jsonl');
    const r = runRunner(repo, { OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ENTRY: CLI_ENTRY, OPENLOGOS_SMOKE_RESULT_PATH: ledger });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('未声明自测');
    expect(existsSync(ledger)).toBe(false);
    expect(existsSync(join(repo, 'logos/resources/verify/smoke-results.jsonl'))).toBe(false);
  }, TIMEOUT);

  it('自测模式但结果指向项目正式账本 → 拒绝运行、零写入', () => {
    const repo = fakeRepo();
    const r = runRunner(repo, { OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_SELF_TEST: '1', OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ENTRY: CLI_ENTRY });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('不得写入项目正式 smoke 账本');
    expect(existsSync(join(repo, 'logos/resources/verify/smoke-results.jsonl'))).toBe(false);
  }, TIMEOUT);

  it('正式模式：PATH 中的 openlogos 是指向仓内候选的工作区链接 → 三条 fail，门禁不放行', () => {
    const repo = fakeRepo();
    const bin = join(repo, 'fakebin');
    mkdirSync(bin, { recursive: true });
    symlinkSync(CLI_ENTRY, join(bin, 'openlogos'));
    const r = runRunner(repo, { PATH: [bin, process.env.PATH ?? ''].join(delimiter) });
    expect(r.status).not.toBe(0);
    const out = rows(join(repo, 'logos/resources/verify/smoke-results.jsonl'));
    expect(out.map(x => [x.id, x.status])).toEqual(IDS.map(id => [id, 'fail']));
    for (const x of out) {
      expect(x.environment).toBe('local-global-temp-project');
      expect(x.detail).toContain('不在全局 npm prefix 的包目录');
    }
  }, TIMEOUT);
});

describe('deploy-plan-gate smoke runner：全局包目录本身是工作区链接（code 评审 r2 F2）', () => {
  it('正式模式：npm prefix -g 下的包目录链接到当前项目之外的候选工作区 → 三条 fail，正式账本无 pass', () => {
    const repo = fakeRepo();
    // 一次性全局 prefix：包目录是指向「另一份候选工作区」（仓内 cli/）的链接，可执行 shim 指向包内 dist——
    // 与 npm link 产生的路径关系相同；入口解引用后落在候选工作区内，且不在 runner 的当前项目（repo）里。
    const prefix = join(repo, 'global-prefix');
    mkdirSync(join(prefix, 'lib', 'node_modules', '@miniidealab'), { recursive: true });
    mkdirSync(join(prefix, 'bin'), { recursive: true });
    const pkgDir = join(prefix, 'lib', 'node_modules', '@miniidealab', 'openlogos');
    symlinkSync(join(REPO_ROOT, 'cli'), pkgDir);
    symlinkSync(join(pkgDir, 'dist', 'index.js'), join(prefix, 'bin', 'openlogos'));
    const r = runRunner(repo, {
      PATH: [join(prefix, 'bin'), process.env.PATH ?? ''].join(delimiter),
      npm_config_prefix: prefix,
      NPM_CONFIG_PREFIX: prefix,
    });
    expect(r.status).not.toBe(0);
    const out = rows(join(repo, 'logos/resources/verify/smoke-results.jsonl'));
    expect(out.map(x => [x.id, x.status])).toEqual(IDS.map(id => [id, 'fail']));
    for (const x of out) {
      expect(x.environment).toBe('local-global-temp-project');
      expect(x.detail).toContain('workspace link 不构成安装态证据');
    }
  }, TIMEOUT);
});

describe('deploy-plan-gate smoke：缺回滚制品的 skip 不得放行（code 评审 F1）', () => {
  it('自测：223 / 224 pass、225 缺回滚制品 skip → 真实 smoke 门 FAIL、无 SMOKE_PASS、缺失项可见', () => {
    // ① 自测模式运行真实 runner（注入仓内候选，独立账本）。
    const repo = fakeRepo();
    const ledger = join(repo, 'self-test.jsonl');
    const r = runRunner(repo, {
      OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_SELF_TEST: '1', OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ENTRY: CLI_ENTRY,
      OPENLOGOS_SMOKE_RESULT_PATH: ledger,
    });
    const out = rows(ledger);
    expect(out.map(x => [x.id, x.status]), r.stderr).toEqual([
      ['SMOKE-core-223', 'pass'], ['SMOKE-core-224', 'pass'], ['SMOKE-core-225', 'skip'],
    ]);
    for (const x of out) expect(x.environment).toBe('self-test-injected-entry');
    const skipDetail = out[2].detail;
    expect(skipDetail).toContain('缺回滚制品');
    expect(existsSync(join(repo, 'logos/resources/verify/smoke-results.jsonl'))).toBe(false);

    // ② 把 runner 的实际记录交给真实 smoke 门：项目以本提案新增这三条 smoke 用例，smoke.command 回放上述记录。
    const root = tempRoot();
    scaffoldProject(root, { locale: 'zh' });
    mkdirSync(join(root, 'logos/resources/test/smoke'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/smoke/core-smoke-test-cases.md'), IDS.map(id => `| ${id} | 安装态 |`).join('\n'));
    const proposalDir = join(root, 'logos/changes', SLUG);
    mkdirSync(join(proposalDir, 'deltas/test/smoke'), { recursive: true });
    writeFileSync(join(proposalDir, 'deltas/test/smoke/core-smoke-test-cases.md'), IDS.map(id => `| ${id} | 安装态 |`).join('\n'));
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：本地',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [deploy] 发布\n- [x] 本机全局安装\n');
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/smoke-replay.mjs'), [
      "import { appendFileSync, mkdirSync } from 'node:fs';",
      "import { dirname } from 'node:path';",
      "const p = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';",
      'mkdirSync(dirname(p), { recursive: true });',
      `appendFileSync(p, ${JSON.stringify(readFileSync(ledger, 'utf-8'))});`,
    ].join('\n'));
    const configPath = join(root, 'logos/logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    // 本用例验证门禁汇总，不验证沙箱：关闭沙箱，直接在项目根回放 runner 的实际记录。
    config.smoke = { ...(config.smoke ?? {}), command: 'node scripts/smoke-replay.mjs', sandbox_mode: 'off' };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const restore = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    try { smoke('json'); } finally { con.restore(); exitSpy.mockRestore(); restore(); }
    expect(takeExitCode()).toBe(1);
    const data = JSON.parse(con.logs[con.logs.length - 1]).data;
    expect(data.summary.failed_count).toBe(0);
    expect(data.uncovered_cases).toEqual([]);
    expect(data.diagnostics).toEqual([]);
    expect(data.gate).toEqual({ result: 'FAIL', reason: 'required_cases_skipped' });
    expect(data.required_skipped_cases).toEqual([{ id: 'SMOKE-core-225', detail: skipDetail }]);
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(true);
    expect(readFileSync(join(root, data.report_path), 'utf-8')).toContain(skipDetail);
  }, TIMEOUT);
});
