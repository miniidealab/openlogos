/**
 * module-scoped-env-smoke 共用夹具：S1（单模块带登记表）、M0（多模块、无任何环境声明与 smoke.modules）、
 * MM（多模块，team 声明 team-prod、配置 smoke.modules.team）与真实 CLI 执行器。
 *
 * 口径见 logos/resources/test/core-S41-test-cases.md 等「夹具 MM」说明。本模块不得 import vitest，
 * 供零回归基准生成器（fixtures/gen-s19-module-env-baseline.ts）复用。
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { normalizeDefaultSandboxRoot } from './golden/normalize-default-sandbox-root.mjs';

export const CLI_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
export const MES_BASELINE_FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/s19-module-env-baseline.json');

/**
 * S1 单模块；M0 多模块无声明；MM 多模块（team 声明 team-prod、配置 smoke.modules.team.command）；
 * RL runlogos 形态（smoke-scope-isolated-modules）：同 MM，但 smoke 规格为 core、team 前缀与两份不带前缀、ID 段不统一的 core 发布规格（无 shared）。
 */
export type EnvKind = 'S1' | 'M0' | 'MM' | 'RL';

/** 夹具 RL 中不带前缀的 core 发布规格（文件名 → 用例 ID）。 */
export const RL_RELEASE_SPECS: Record<string, string> = {
  'official-release-package-1-0-4.md': 'SMOKE-official104-01',
  'release-1-0-3-rebuild-5.md': 'SMOKE-rebuild5-01',
};
export const SLUG = 'ship-it';

function registry(opts: EnvFixtureOptions): string {
  return [
    'schema_version: 1',
    'environments:',
    '  - {id: test, name: Test, tier: test, aliases: [测试]}',
    '  - {id: prod, name: Production, tier: prod, aliases: [生产]}',
    '  - id: team-prod',
    '    name: Team Production',
    '    tier: prod',
    `    aliases: [${(opts.teamProdAliases ?? ['Team-Production']).join(', ')}]`,
    '    deploy:',
    '      mode: script',
    '      script: tools/deploy-team.sh',
    '      args: ["{env}", "{ref}"]',
    ...(opts.teamProdRequireApproval ? ['    require_approval: true'] : []),
    '',
  ].join('\n');
}

/**
 * MM 变体选项（S41 / S21 / S42 按模块用例）：
 * - proposalModule：活跃提案 ship-it 所属模块（null 为无活跃提案）；S1 / M0 恒为 core。
 * - teamEnvironments / coreEnvironments：deployment_gates.<m>.environments（undefined 为夹具缺省：MM 的 team 为 [team-prod]、
 *   core 不声明）。
 * - teamProdAliases：team-prod 的别名（缺省 [Team-Production]；置 [] 可构造「别名已从登记表删除」）。
 * - teamProdRequireApproval：team-prod 配置 require_approval: true（受门环境）。
 */
export interface EnvFixtureOptions {
  proposalModule?: 'core' | 'team' | null;
  teamEnvironments?: string[];
  coreEnvironments?: string[];
  teamProdAliases?: string[];
  teamProdRequireApproval?: boolean;
}

/** 项目外一次性调用日志：与项目根同级的 `<项目目录名>.calls.log`。 */
export function callsLogPath(root: string): string {
  return join(dirname(root), `${basename(root)}.calls.log`);
}

/**
 * 记录型 runner：把被调用模块与注入变量写进项目外调用日志，并为本模块用例写 pass 结果。
 * 测试可放置 tools/<label>-ids.json（覆盖默认 ID 列表）与 tools/extra.jsonl（逐行追加 {id,status[,target_environment]} 结果；
 * 自带 target_environment 的行保留原值，值为 null 表示缺该字段）构造变体。
 */
const RUNNER = (label: string, ids: string[]) => `
const fs = require('fs'); const path = require('path');
const log = path.join(path.dirname(process.cwd()), path.basename(process.cwd()) + '.calls.log');
fs.appendFileSync(log, JSON.stringify({ runner: ${JSON.stringify(label)}, module: process.env.OPENLOGOS_SMOKE_MODULE ?? null, env: process.env.OPENLOGOS_SMOKE_ENV ?? null, result_path: process.env.OPENLOGOS_SMOKE_RESULT_PATH ?? null }) + '\\n');
const out = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;
const idsFile = path.join('tools', ${JSON.stringify(label)} + '-ids.json');
const ids = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, 'utf8')) : ${JSON.stringify(ids)};
const rows = ids.map(id => ({ id, status: 'pass' }));
const extra = path.join('tools', 'extra.jsonl');
if (fs.existsSync(extra)) for (const line of fs.readFileSync(extra, 'utf8').split('\\n')) if (line.trim()) rows.push(JSON.parse(line));
// 额外行自带 target_environment 时保留原值（null 表示缺该字段），否则与默认行一样标注本次环境
const stamped = rows.map(r => {
  const own = Object.prototype.hasOwnProperty.call(r, 'target_environment');
  const row = { ...r, timestamp: new Date().toISOString(), ...(!own && env ? { target_environment: env } : {}) };
  if (row.target_environment === null) delete row.target_environment;
  return row;
});
fs.writeFileSync(out, stamped.map(r => JSON.stringify(r)).join('\\n') + (stamped.length ? '\\n' : ''));
`;

const proposal = (module: string) => [
  '# 变更提案：ship-it', '', `> module: ${module} | created: 2026-10-19`, '', '## 变更原因', '发布。', '', '## 变更类型', '代码级修复', '',
  '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：test',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
].join('\n');
const TASKS = ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n');

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

export function git(root: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** 构造夹具项目，活跃提案 ship-it（缺省归属 core）处于 ready-to-deploy。 */
export function buildEnvProject(root: string, kind: EnvKind, opts: EnvFixtureOptions = {}): string {
  const mmLike = kind === 'MM' || kind === 'RL';
  const proposalModule = mmLike && opts.proposalModule !== undefined ? opts.proposalModule : 'core';
  put(root, 'logos/logos.config.json', `${JSON.stringify({
    name: 'mes', locale: 'en', description: '', documents: {},
    smoke: {
      command: 'node scripts/smoke-project.js', result_path: 'logos/resources/verify/smoke-results.jsonl', sandbox_mode: 'off',
      ...(mmLike ? { modules: { team: { command: 'node scripts/smoke-team.js' } } } : {}),
    },
  }, null, 2)}\n`);
  const modules = kind === 'S1'
    ? [{ id: 'core', name: 'Core', lifecycle: 'launched' }]
    : [{ id: 'core', name: 'Core', lifecycle: 'launched' }, { id: 'team', name: 'Team', lifecycle: 'initial' }];
  // 夹具口径：core 不声明 deployment_gates；仅 MM 的 team 声明 environments
  const project: Record<string, unknown> = { project: { name: 'mes' }, modules };
  if (mmLike) {
    const gates: Record<string, { environments: string[] }> = { team: { environments: opts.teamEnvironments ?? ['team-prod'] } };
    if (opts.coreEnvironments) gates.core = { environments: opts.coreEnvironments };
    project.deployment_gates = gates;
  }
  put(root, 'logos/logos-project.yaml', stringifyYaml(project, { lineWidth: 0 }));
  put(root, 'logos/environments.yaml', registry(mmLike ? opts : {}));
  put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | a |\n| SMOKE-core-02 | b |\n');
  if (kind === 'RL') {
    for (const [file, id] of Object.entries(RL_RELEASE_SPECS)) put(root, `logos/resources/test/smoke/${file}`, `# Release smoke\n\n| ID | 描述 |\n|---|---|\n| ${id} | r |\n`);
  } else {
    put(root, 'logos/resources/test/smoke/shared-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-shared-01 | g |\n');
  }
  if (kind !== 'S1') put(root, 'logos/resources/test/smoke/team-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-team-01 | t |\n');
  const global = kind === 'RL' ? Object.values(RL_RELEASE_SPECS) : ['SMOKE-shared-01'];
  const all = kind === 'S1' ? ['SMOKE-core-01', 'SMOKE-core-02', ...global] : ['SMOKE-core-01', 'SMOKE-core-02', ...global, 'SMOKE-team-01'];
  put(root, 'scripts/smoke-project.js', RUNNER('project', all));
  // team 配置了独立命令（独立 smoke 模块），其 runner 只为 team 前缀用例写结果（smoke-scope-isolated-modules）
  put(root, 'scripts/smoke-team.js', RUNNER('team', ['SMOKE-team-01']));
  // 部署脚本在部署工作树中运行：调用日志写到夹具构造时确定的项目外绝对路径
  put(root, 'tools/deploy-team.sh', `#!/bin/sh\necho "{\\"deploy\\":\\"$1\\",\\"ref\\":\\"$2\\"}" >> '${callsLogPath(root)}'\n`);
  chmodSync(join(root, 'tools/deploy-team.sh'), 0o755);
  put(root, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nok\n');
  if (proposalModule !== null) {
    const dir = join(root, 'logos/changes', SLUG);
    put(root, `logos/changes/${SLUG}/proposal.md`, proposal(proposalModule));
    put(root, `logos/changes/${SLUG}/tasks.md`, TASKS);
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    writeFileSync(join(dir, 'LOOP_ITERS'), `${JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module: proposalModule, timestamp: '2026-10-19T00:00:00.000Z' })}\n`);
    put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: proposalModule, createdAt: '2026-10-19T00:00:00.000Z' }));
  }
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'user.email', 't@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}

export interface CliRun { status: number; stdout: string; stderr: string }

export function runCli(root: string, args: string[], entry = CLI_DIST): CliRun {
  const env = { ...process.env };
  for (const k of ['CLAUDE_PROJECT_DIR', 'OPENLOGOS_SMOKE_ENV', 'OPENLOGOS_SMOKE_RESULT_PATH', 'OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS']) delete env[k];
  const r = spawnSync(process.execPath, [entry, ...args], { cwd: root, encoding: 'utf-8', env, timeout: 120_000 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 剔除易变字段：项目根、时间戳、UUID、40 位 commit、64 位资产哈希、耗时、CLI 版本号。 */
export function normalizeOutput(text: string, root: string): string {
  let out = text;
  for (const r of [realpathSync(root), root]) out = out.split(r).join('<ROOT>');
  // verification-history（§2.104.11）：verify / smoke 输出除新增 history 元数据与一行历史路径外与引入前一致；
  // 零回归基准生成于引入前，比较前剔除新增部分
  out = out
    .replace(/,"history":\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g, '')
    .split('\n').filter(line => !/^(?:🗂 {2}(?:验收历史|Verification history)|⚠️ {2}(?:验收历史写入失败|Failed to write verification history))/.test(line)).join('\n');
  return normalizeDefaultSandboxRoot(out)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<TS>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
    .replace(/\b[0-9a-f]{64}\b/g, '<HASH>')
    .replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/"duration_ms":\s*\d+/g, '"duration_ms":0')
    .replace(/"version":\s*"\d+\.\d+\.\d+"/g, '"version":"<V>"');
}

/**
 * 零回归操作序列（ST-S19-31 ①② 的前缀，不含照 next 命令执行的那一步）：
 * deploy-done --env test → next（ready-to-smoke，不带 / 带 --auto）→ smoke --env test → next --auto（smoke-passed）
 * → env list / env show test / env check（ST-S41-07 ①、UT-S41-27）；smoke 之后另记 smoke 报告（UT-S19-80）。
 * 返回各步规范化后的退出码与输出，供零回归基准生成与测试比对。
 */
export function zeroRegressionRun(root: string, entry = CLI_DIST): Record<string, CliRun> {
  const out: Record<string, CliRun> = {};
  const step = (key: string, args: string[]) => {
    const r = runCli(root, args, entry);
    out[key] = { status: r.status, stdout: normalizeOutput(r.stdout, root), stderr: normalizeOutput(r.stderr, root) };
  };
  step('deploy-done', ['deploy-done', '--env', 'test', '--format', 'json']);
  step('next-ready-to-smoke', ['next', '--format', 'json']);
  step('next-auto-ready-to-smoke', ['next', '--auto', '--format', 'json']);
  step('smoke', ['smoke', '--env', 'test', '--format', 'json']);
  // smoke 报告（UT-S19-80）：报告首部的生成日期另行剔除
  const report = join(root, 'logos/resources/verify/smoke-report.md');
  out['smoke-report'] = {
    status: existsSync(report) ? 0 : 1, stderr: '',
    stdout: existsSync(report) ? normalizeOutput(readFileSync(report, 'utf-8'), root).replace(/\b\d{4}-\d{2}-\d{2}\b/g, '<DATE>') : '',
  };
  step('next-auto-smoke-passed', ['next', '--auto', '--format', 'json']);
  step('env-list', ['env', 'list', '--format', 'json']);
  step('env-show-test', ['env', 'show', 'test', '--format', 'json']);
  step('env-check', ['env', 'check', '--format', 'json']);
  return out;
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf-8'));
}

export const LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
export const PROPOSAL_REL = `logos/changes/${SLUG}`;

/** 目录（或文件）的字节快照：相对路径 → base64；不存在时为空对象。用于「零写入 / 提案目录字节不变」取证。 */
export function snapshot(root: string, rel: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string, key: string) => {
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(join(abs, name), key === '' ? name : `${key}/${name}`);
    } else {
      out[key] = readFileSync(abs).toString('base64');
    }
  };
  walk(join(root, rel), '');
  return out;
}

/** CLI JSON 错误信封的 error 对象（stderr）。 */
export function errorOf(run: CliRun): { code: string; message: string; details?: Record<string, unknown> } {
  return (JSON.parse(run.stderr) as { error: { code: string; message: string; details?: Record<string, unknown> } }).error;
}

/** CLI JSON 成功信封的 data（stdout）。 */
export function dataOf<T = Record<string, unknown>>(run: CliRun): T {
  return (JSON.parse(run.stdout) as { data: T }).data;
}
