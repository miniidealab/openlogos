#!/usr/bin/env node
/**
 * SMOKE-core-294～SMOKE-core-297 — 0.16.11 独立 smoke 模块应覆盖集合的**安装态**取证（来源提案 smoke-scope-isolated-modules，
 * 决策 C01、proposal-r1 F1、delta-r1 F1，功能规格 §2.98.6）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.11 独立 smoke 模块应覆盖集合安装态 smoke（SMOKE-core-294～297）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.11 本机测试环境发布（smoke-scope-isolated-modules）」。
 *
 *   - SMOKE-core-294：安装态版本、制品身份与本仓 sync 同源（包内 environments.md §14.5 含「独立 smoke 模块」定义）。
 *   - SMOKE-core-295：独立模块 team 只覆盖自己前缀，不被不带前缀的 core 发布 smoke 拖成 uncovered；core 提案目录字节不变。
 *   - SMOKE-core-296：非独立模块 core（含只写 report_path 的路径覆盖变体）仍覆盖不带前缀的发布 smoke，fail 阻断门禁。
 *   - SMOKE-core-297：① 单模块项目与 0.16.10 基线等值；② 已启用但无独立模块的多模块项目按扩大后的全量范围验收，不与基线等值。
 *
 * 临时项目一律经被测 CLI `init` 建立后写入 runlogos 形态配置；全局 CLI 以入口绝对路径经子进程调用；全部写入只在一次性目录内，
 * 结束即删除；对全局安装态只读，对本仓只做 SMOKE-core-294 ④ 的只读比对。
 *
 * **窗口**：活跃变更为 smoke-scope-isolated-modules，或 OPENLOGOS_SSIM_SMOKE=1；窗口外为全部 owned ID 写 skip。
 * **适用性**（缺即显式 skip，不标 platform-unavailable）：候选版本（local-release-candidate.ts）不早于 0.16.11；部署记录记载候选版本；
 * 本机留存制品中有回滚版本常量（升版前版本）的 tarball；本仓已 sync（logos/spec/environments.md 存在）。
 * **自测模式**（须同时满足）：OPENLOGOS_SSIM_SMOKE_SELF_TEST=1、OPENLOGOS_SSIM_SMOKE_ENTRY（候选入口）、OPENLOGOS_SSIM_SMOKE_BASELINE_ENTRY（基线入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置与本仓比对（④），结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';
import { rollbackVersionConst, selectBaselineArtifact } from './lib/local-install-baseline.mjs';

const SLUG = 'smoke-scope-isolated-modules';
const OWNED = ['SMOKE-core-294', 'SMOKE-core-295', 'SMOKE-core-296', 'SMOKE-core-297'];
const MIN_VERSION = '0.16.11';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const REPO_SYNCED_FILES = [
  ['logos/spec/environments.md', 'spec/environments.md'],
  ['logos/spec/test-results.md', 'spec/test-results.md'],
];
const LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
/** runlogos 形态中不带前缀、ID 段不统一的 core 发布规格（文件名 → 用例 ID）。 */
const RELEASE_SPECS = { 'official-release-package-1-0-4.md': 'SMOKE-official104-01', 'release-1-0-3-rebuild-5.md': 'SMOKE-rebuild5-01' };
const OFFICIAL = 'SMOKE-official104-01';
const MULTI_ALL = ['SMOKE-core-01', 'SMOKE-core-02', ...Object.values(RELEASE_SPECS), 'SMOKE-team-01'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_SSIM_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const run = (cmd, args, cwd = repoRoot, extra = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, ...extra });

function refuse(reason) {
  console.error(`smoke runner 拒绝运行（未写入任何结果）：${reason}`);
  process.exit(2);
}
function formalResultPath() {
  let configured = null;
  try { configured = JSON.parse(readFileSync(join(repoRoot, 'logos/logos.config.json'), 'utf8')).smoke?.result_path ?? null; } catch { /* 缺省 */ }
  return resolve(repoRoot, configured || 'logos/resources/verify/smoke-results.jsonl');
}
function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}
function candidateVersion() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
  return /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null;
}
function versionAtLeast(version, min) {
  const parse = v => (/^(\d+)\.(\d+)\.(\d+)/.exec(v ?? '') ?? []).slice(1).map(Number);
  const a = parse(version); const b = parse(min);
  if (a.length !== 3) return false;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

if (!SELF_TEST && (process.env.OPENLOGOS_SSIM_SMOKE_ENTRY !== undefined || process.env.OPENLOGOS_SSIM_SMOKE_BASELINE_ENTRY !== undefined)) {
  refuse('设置了 OPENLOGOS_SSIM_SMOKE_ENTRY / _BASELINE_ENTRY 但未声明自测（OPENLOGOS_SSIM_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && (!process.env.OPENLOGOS_SSIM_SMOKE_ENTRY || !process.env.OPENLOGOS_SSIM_SMOKE_BASELINE_ENTRY)) {
  refuse('自测模式需要 OPENLOGOS_SSIM_SMOKE_ENTRY 与 OPENLOGOS_SSIM_SMOKE_BASELINE_ENTRY');
}
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_SSIM_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_SSIM_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_SSIM_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-ssim-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_SSIM_')) delete env[key];
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDE_PROJECT_DIR'].includes(key)) delete env[key];
  }
  return { ...env, ...extra };
}
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 300)}`);
  return r.stdout.trim();
}
/** 被测 CLI 调用；返回退出码与输出（不因非零退出抛错，由用例判定）。 */
function cli(entry, root, args) {
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd: root, encoding: 'utf8', env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home') }), timeout: 300_000, input: '',
  });
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function cliOk(entry, root, args) {
  const r = cli(entry, root, args);
  if (r.status !== 0) throw new Error(`openlogos ${args.join(' ')} 失败：exit ${r.status} ${(r.stderr || r.stdout).slice(0, 400)}`);
  return r;
}
const json = text => { try { return JSON.parse(text); } catch { return null; } };
const errorCode = r => json(r.stderr)?.error?.code ?? null;
/** 目录（或文件）字节快照：相对路径 → sha256。 */
function snapshot(root, rel) {
  const out = {};
  const walk = (abs, key) => {
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const name of readdirSync(abs).sort()) walk(join(abs, name), key ? `${key}/${name}` : name);
    else out[key] = sha256(readFileSync(abs));
  };
  walk(join(root, rel), '');
  return JSON.stringify(out);
}
const callsLog = root => join(dirname(root), `${basename(root)}.calls.log`);
const calls = root => (existsSync(callsLog(root)) ? readFileSync(callsLog(root), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

/**
 * 记录型 smoke runner：把被调用模块与注入变量写进项目外一次性调用日志，并按用例写 pass 结果。
 * tools/<label>-ids.json 覆盖默认 ID 列表，tools/extra.jsonl 逐行追加 {id,status} 结果（用于构造 fail / 缺结果变体）。
 */
const RUNNER = (label, ids) => `
const fs = require('fs'); const path = require('path');
const log = path.join(path.dirname(process.cwd()), path.basename(process.cwd()) + '.calls.log');
fs.appendFileSync(log, JSON.stringify({ runner: ${JSON.stringify(label)}, module: process.env.OPENLOGOS_SMOKE_MODULE ?? null, env: process.env.OPENLOGOS_SMOKE_ENV ?? null }) + '\\n');
const out = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;
const idsFile = path.join('tools', ${JSON.stringify(label)} + '-ids.json');
const ids = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, 'utf8')) : ${JSON.stringify(ids)};
const rows = ids.map(id => ({ id, status: 'pass' }));
const extraFile = path.join('tools', 'extra.jsonl');
if (fs.existsSync(extraFile)) for (const line of fs.readFileSync(extraFile, 'utf8').split('\\n')) if (line.trim()) rows.push(JSON.parse(line));
fs.writeFileSync(out, rows.map(r => JSON.stringify({ ...r, timestamp: new Date().toISOString(), ...(env ? { target_environment: env } : {}) })).join('\\n') + (rows.length ? '\\n' : ''));
`;

const REGISTRY = [
  'schema_version: 1',
  'environments:',
  '  - {id: test, name: Test, tier: test}',
  '  - id: team-prod',
  '    name: Team Production',
  '    tier: prod',
  '    deploy:',
  '      mode: script',
  '      script: scripts/deploy-team.sh',
  '      args: ["{env}", "{ref}"]',
  '',
].join('\n');
const PROPOSAL = module => [
  `# 变更提案：${module}-x`, '', `> module: ${module} | created: 2026-10-20`, '', '## 变更原因', '发布。', '', '## 变更类型', '代码级修复', '',
  '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：test',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
].join('\n');
const TASKS = ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n');
const spec = id => `# Smoke\n\n| ID | 描述 |\n|---|---|\n| ${id} | case |\n`;

/**
 * 经被测 CLI init 建立的一次性 git 项目。kind：multi（runlogos 形态：core 不声明环境，team 声明 [team-prod]；
 * smoke 规格为 core / team 前缀与两份不带前缀的 core 发布规格）或 single（单模块带登记表）。
 * smokeModules 为 logos.config.json 的 smoke.modules（multi 缺省为 team 独立命令；传 null 表示不配置）。
 */
function makeProject(entry, kind, { smokeModules } = {}) {
  const root = realpathSync(tempDir(kind));
  scopes.push(callsLog(root));
  cliOk(entry, root, ['init', 'ssim', '--locale', 'zh', '--ai-tool', 'other']);
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const modulesCfg = kind === 'multi' ? (smokeModules === undefined ? { team: { command: 'node scripts/smoke-team.js' } } : smokeModules) : null;
  cfg.smoke = {
    command: 'node scripts/smoke-project.js', result_path: 'logos/resources/verify/smoke-results.jsonl', sandbox_mode: 'off',
    ...(modulesCfg ? { modules: modulesCfg } : {}),
  };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  const modules = kind === 'multi'
    ? '  - id: core\n    name: core\n    lifecycle: launched\n  - id: team\n    name: team\n    lifecycle: initial\n'
    : '  - id: core\n    name: core\n    lifecycle: launched\n';
  const gates = kind === 'multi' ? 'deployment_gates:\n  team:\n    environments: [team-prod]\n' : '';
  put(root, 'logos/logos-project.yaml', `project:\n  name: "ssim"\nmodules:\n${modules}${gates}`);
  put(root, 'logos/environments.yaml', REGISTRY);
  put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | a |\n| SMOKE-core-02 | b |\n');
  let all;
  if (kind === 'multi') {
    put(root, 'logos/resources/test/smoke/team-smoke-test-cases.md', spec('SMOKE-team-01'));
    for (const [file, id] of Object.entries(RELEASE_SPECS)) put(root, `logos/resources/test/smoke/${file}`, spec(id));
    all = MULTI_ALL;
  } else {
    put(root, 'logos/resources/test/smoke/shared-smoke-test-cases.md', spec('SMOKE-shared-01'));
    all = ['SMOKE-core-01', 'SMOKE-core-02', 'SMOKE-shared-01'];
  }
  put(root, 'scripts/smoke-project.js', RUNNER('project', all));
  put(root, 'scripts/smoke-team.js', RUNNER('team', ['SMOKE-team-01']));
  put(root, 'scripts/deploy-team.sh', `#!/bin/sh\necho "{\\"deploy\\":\\"$1\\"}" >> '${callsLog(root)}'\n`);
  chmodSync(join(root, 'scripts/deploy-team.sh'), 0o755);
  put(root, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nok\n');
  put(root, '.gitignore', 'logos/.openlogos-runtime/\ntools/\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'openlogos-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}
const setIds = (root, label, list) => put(root, `tools/${label}-ids.json`, JSON.stringify(list));
const setExtra = (root, rows) => put(root, 'tools/extra.jsonl', rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const resetRunner = root => { rmSync(join(root, 'tools'), { recursive: true, force: true }); };
function versionDeployTeam(entry, root) {
  const head = git(root, ['rev-parse', 'HEAD']);
  const dep = cli(entry, root, ['deploy', '--env', 'team-prod', '--ref', head, '--format', 'json']);
  const d = json(dep.stdout)?.data;
  if (dep.status !== 0 || d?.channel !== 'version') throw new Error(`team-prod 版本通道部署失败：exit ${dep.status} ${errorCode(dep) ?? ''} channel=${d?.channel}`);
  return d;
}
const smokeData = (entry, root, args = []) => {
  const r = cli(entry, root, ['smoke', ...args, '--format', 'json']);
  const d = json(r.stdout)?.data;
  if (!d) throw new Error(`smoke ${args.join(' ')} 无 JSON 输出：exit ${r.status} ${errorCode(r) ?? r.stderr.slice(0, 200)}`);
  return d;
};

/** 以被测 CLI `change` 创建归属 module 的提案，并补齐部署前置（已填提案、[deploy] 任务、VERIFY_PASS）。返回提案相对路径。 */
function proposal(entry, root, module) {
  const slug = `${module}-x`;
  for (const stale of readdirSync(join(root, 'logos/changes')).filter(n => n !== 'archive')) rmSync(join(root, 'logos/changes', stale), { recursive: true, force: true });
  rmSync(join(root, 'logos/.openlogos-guard'), { force: true });
  cliOk(entry, root, ['change', slug, '--module', module]);
  const rel = `logos/changes/${slug}`;
  put(root, `${rel}/proposal.md`, PROPOSAL(module));
  put(root, `${rel}/tasks.md`, TASKS);
  put(root, `${rel}/VERIFY_PASS`, '');
  put(root, `${rel}/LOOP_ITERS`, `${JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module, timestamp: '2026-10-19T00:00:00.000Z' })}\n`);
  return rel;
}

/** 剔除易变字段：项目根、时间戳、UUID、40 / 64 位哈希、耗时、CLI 版本号。 */
function normalize(text, root) {
  return text.split(root).join('<ROOT>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<TS>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
    .replace(/\b[0-9a-f]{64}\b/g, '<HASH>')
    .replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/"duration_ms":\s*\d+/g, '"duration_ms":0')
    .replace(/"version":\s*"\d+\.\d+\.\d+"/g, '"version":"<V>"');
}

const CASES = {
  'SMOKE-core-294': async (entry) => {
    const problems = [];
    const evidence = [`entry_realpath=${entry}`];
    const version = (run(process.execPath, [entry, '--version']).stdout || '').trim();
    const candidate = SELF_TEST ? version : candidateVersion();
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (version !== candidate) problems.push(`① --version 为 ${version}，部署记录候选版本为 ${candidate}`);
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`package_root=${pkg}`, `payload_hash=${manifest.payloadHash}`);
    try {
      const lib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
      lib.validateAssetManifest(manifest, pkg);
    } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    const read = rel => (existsSync(join(pkg, rel)) ? readFileSync(join(pkg, rel), 'utf8') : '');
    const env = read('spec/environments.md');
    const s145 = env.slice(env.indexOf('### 14.5'), env.indexOf('### 14.6'));
    if (!s145.includes('**独立 smoke 模块**')) problems.push('③ 包内 spec/environments.md §14.5 缺少「独立 smoke 模块」定义');
    if (!read('dist/lib/smoke-scope.js').includes('isolatedSmokeModules')) problems.push('③ 包内 dist 缺少独立 smoke 模块判定实现');
    if (!SELF_TEST) {
      for (const [repoRel, pkgRel] of REPO_SYNCED_FILES) {
        const a = existsSync(join(repoRoot, repoRel)) ? sha256(readFileSync(join(repoRoot, repoRel))) : null;
        const b = existsSync(join(pkg, pkgRel)) ? sha256(readFileSync(join(pkg, pkgRel))) : null;
        evidence.push(`${repoRel}=${a}`, `package:${pkgRel}=${b}`);
        if (!a || !b || a !== b) problems.push(`④ 本仓 ${repoRel} 与全局包内 ${pkgRel} 字节不一致（需重新执行本仓 openlogos sync 后复核）`);
      }
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: `安装态身份同源（${version}）：manifest 自洽，包内 §14.5 含独立 smoke 模块定义与判定实现${SELF_TEST ? '' : '，本仓 sync 副本同字节'}`, evidence };
  },

  'SMOKE-core-295': async (entry) => {
    const root = makeProject(entry, 'multi');
    const evidence = [`project=${root}`];
    const problems = [];
    const rel = proposal(entry, root, 'core');
    const before = snapshot(root, rel);
    versionDeployTeam(entry, root);
    const d = smokeData(entry, root, ['--env', 'team-prod']);
    evidence.push(`defined=${d.summary?.defined_count} uncovered=${JSON.stringify(d.uncovered_cases)} reasons=${JSON.stringify(d.scope?.reasons)} gate=${d.gate?.result}`);
    if (d.gate?.result !== 'PASS') problems.push(`② smoke 未通过：${d.gate?.reason}`);
    if (d.summary?.defined_count !== 1) problems.push(`② defined_count 应等于 team 前缀用例数 1，实际 ${d.summary?.defined_count}`);
    for (const id of Object.values(RELEASE_SPECS)) if ((d.uncovered_cases ?? []).includes(id)) problems.push(`② 不带前缀的发布用例 ${id} 不应 uncovered`);
    if (!(d.scope?.reasons ?? []).includes('isolated_module')) problems.push('② scope.reasons 应含 isolated_module');
    const runners = calls(root).filter(c => 'runner' in c);
    evidence.push(`calls=${JSON.stringify(runners)}`);
    if (runners.length !== 1 || runners[0].runner !== 'team') problems.push(`③ 调用日志应只有 team 命令一次，实际 ${JSON.stringify(runners)}`);
    if (snapshot(root, rel) !== before) problems.push('③ core 提案目录字节有变化');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '独立模块 team 只覆盖 team 前缀用例，不被不带前缀的发布 smoke 拖成 uncovered；core 提案目录字节不变', evidence };
  },

  'SMOKE-core-296': async (entry) => {
    const evidence = [];
    const problems = [];
    for (const [label, smokeModules] of [
      ['team 独立', undefined],
      ['core 只写 report_path', { team: { command: 'node scripts/smoke-team.js' }, core: { report_path: 'logos/resources/verify/core-smoke-report.md' } }],
    ]) {
      const root = makeProject(entry, 'multi', { smokeModules });
      proposal(entry, root, 'core');
      const dd = cli(entry, root, ['deploy-done', '--format', 'json']);
      if (dd.status !== 0) throw new Error(`${label}：core deploy-done 失败 ${errorCode(dd) ?? dd.stderr.slice(0, 200)}`);
      const first = smokeData(entry, root);
      evidence.push(`${label}: defined=${first.summary?.defined_count} gate=${first.gate?.result} source=${first.scope?.command_source}`);
      if (label === 'team 独立') {
        if (first.gate?.result !== 'PASS') problems.push(`${label} ① 全部 pass 时应通过：${first.gate?.reason}`);
        if (first.summary?.defined_count !== 4) problems.push(`${label} ① 应覆盖集合应含 core 前缀与两份发布用例（4 条），实际 ${first.summary?.defined_count}`);
      }
      setIds(root, 'project', MULTI_ALL.filter(id => id !== OFFICIAL));
      setExtra(root, [{ id: OFFICIAL, status: 'fail' }]);
      const second = smokeData(entry, root);
      evidence.push(`${label}: fail-run gate=${second.gate?.result} failed=${JSON.stringify((second.failed_cases ?? []).map(f => f.id))} oos=${second.scope?.out_of_scope_result_count}`);
      if (second.gate?.result !== 'FAIL' || !(second.failed_cases ?? []).some(f => f.id === OFFICIAL)) problems.push(`${label} ② 发布用例 fail 应阻断门禁`);
      if (second.scope?.out_of_scope_result_count !== 1) problems.push(`${label} ② 范围外结果只应有 team 用例 1 条，实际 ${second.scope?.out_of_scope_result_count}`);
      if (second.scope?.command_source !== 'project') problems.push(`${label} ② core 应执行项目级 runner，实际 ${second.scope?.command_source}`);
      if (label !== 'team 独立' && !existsSync(join(root, 'logos/resources/verify/core-smoke-report.md'))) problems.push(`${label} ③ 报告未写入 report_path 所指位置`);
      resetRunner(root);
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '非独立模块 core（含只写 report_path 的变体）仍覆盖不带前缀的发布 smoke，发布用例 fail 阻断门禁、不计入范围外结果', evidence };
  },

  'SMOKE-core-297': async (entry, { baselineEntry, baselineEvidence = [] }) => {
    const evidence = [`baseline=${baselineEntry}`, ...baselineEvidence];
    const problems = [];
    // ① 单模块（未启用）：与基线等值
    const single = {};
    for (const [label, bin] of [['candidate', entry], ['baseline', baselineEntry]]) {
      const root = makeProject(bin, 'single');
      proposal(bin, root, 'core');
      const dd = cli(bin, root, ['deploy-done', '--env', 'test', '--format', 'json']);
      const sm = cli(bin, root, ['smoke', '--env', 'test', '--format', 'json']);
      single[label] = JSON.stringify({ dd: [dd.status, normalize(dd.stdout, root), normalize(dd.stderr, root)], sm: [sm.status, normalize(sm.stdout, root), normalize(sm.stderr, root)] });
    }
    if (single.candidate !== single.baseline) problems.push('① 单模块项目 deploy-done / smoke 与基线不一致');
    if (single.candidate.includes('\\"scope\\"')) problems.push('① 单模块项目不应输出 scope');
    // ② 已启用但无独立模块：按扩大后的全量范围验收，不与基线等值
    const multi = {};
    for (const [label, bin] of [['candidate', entry], ['baseline', baselineEntry]]) {
      const root = makeProject(bin, 'multi', { smokeModules: null });
      proposal(bin, root, 'core');
      versionDeployTeam(bin, root);
      const allPass = smokeData(bin, root, ['--env', 'team-prod']);
      setIds(root, 'project', MULTI_ALL.filter(id => id !== 'SMOKE-core-01'));
      setExtra(root, [{ id: 'SMOKE-core-01', status: 'fail' }]);
      const coreFail = smokeData(bin, root, ['--env', 'team-prod']);
      setExtra(root, []);
      const missing = smokeData(bin, root, ['--env', 'team-prod']);
      multi[label] = { allPass, coreFail, missing };
    }
    const c = multi.candidate; const b = multi.baseline;
    evidence.push(`② defined candidate=${c.allPass.summary?.defined_count} baseline=${b.allPass.summary?.defined_count}`);
    if (c.allPass.summary?.defined_count !== MULTI_ALL.length) problems.push(`② 候选 defined_count 应等于全部规格用例数 ${MULTI_ALL.length}，实际 ${c.allPass.summary?.defined_count}`);
    if (!(c.allPass.summary?.defined_count > b.allPass.summary?.defined_count)) problems.push('② 候选 defined_count 应大于基线');
    if (c.allPass.gate?.result !== 'PASS') problems.push(`② 全部 pass 时候选应通过：${c.allPass.gate?.reason}`);
    if (c.coreFail.gate?.result !== 'FAIL' || !(c.coreFail.failed_cases ?? []).some(f => f.id === 'SMOKE-core-01')) problems.push('② core 用例 fail 时候选应列入 failed_cases 并 FAIL');
    evidence.push(`② core-fail baseline gate=${b.coreFail.gate?.result} oos=${b.coreFail.scope?.out_of_scope_result_count}`);
    if (!(c.missing.uncovered_cases ?? []).includes('SMOKE-core-01') || c.missing.gate?.result === 'PASS') problems.push('② 缺 core 用例结果时候选应 uncovered 且门禁不通过');
    const candUncovered = new Set(c.missing.uncovered_cases ?? []);
    if (!(b.missing.uncovered_cases ?? []).every(id => candUncovered.has(id))) problems.push('② 基线 uncovered_cases 应是候选 uncovered_cases 的子集');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '单模块项目与基线一致且无 scope；已启用无独立模块项目的应覆盖范围扩大为全部规格，新纳入的 core 用例 fail 阻断、缺结果 uncovered', evidence };
  },
};

export const ISOLATED_SMOKE_SCOPE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of ISOLATED_SMOKE_SCOPE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
    const record = { id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT };
    if (row.status !== 'skip' && TARGET_ENV) record.target_environment = TARGET_ENV;
    record.detail = row.detail;
    record.evidence = row.evidence;
    if (row.status === 'skip') { record.not_applicable_reason = row.detail; record.missing_requirements = row.missing ?? []; }
    appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  }
}

function globalEntry() {
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-c', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}
function globalInstallProblem(entry) {
  const r = run(npmBin, ['prefix', '-g']);
  if (r.status !== 0 || !r.stdout.trim()) return `无法读取 npm prefix -g：${(r.stderr || '').slice(0, 200)}`;
  const prefix = realpathSync(r.stdout.trim());
  const nodeModules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  const pkgDir = join(nodeModules, '@miniidealab', 'openlogos');
  const within = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  if (lstatSync(pkgDir).isSymbolicLink()) return `全局包目录 ${pkgDir} 是链接（workspace link 不构成安装态证据）`;
  if (!within(realpathSync(pkgDir), entry)) return `入口 ${entry} 不在全局 npm prefix 的包目录 ${pkgDir} 内`;
  if (within(repoRoot, entry)) return `入口 ${entry} 位于工作区 ${repoRoot} 内`;
  return null;
}

/**
 * 正式模式：安装行为比较基线（code-r1 F1）。基线版本取 local-release-candidate.ts 的回滚版本常量（升版前版本，即验收要求的
 * 0.16.10），在本机留存的回滚 / 候选制品中按包内版本选取并记录 SHA-256。修复后重部署时最近一次回执的回滚制品已是修复前的
 * 候选版本，不得充当基线；最近回滚制品只服务当前部署的回滚。
 */
function installBaseline() {
  const baselineVersion = rollbackVersionConst(repoRoot);
  const artifact = selectBaselineArtifact(repoRoot, baselineVersion);
  if (artifact.gap) return artifact;
  const prefix = tempDir('baseline');
  const inst = run(npmBin, ['install', '-g', '--prefix', prefix, artifact.path]);
  if (inst.status !== 0) throw new Error(`安装基线制品失败：${(inst.stderr || '').slice(0, 300)}`);
  const entry = join(prefix, 'lib', 'node_modules', '@miniidealab', 'openlogos', 'dist', 'index.js');
  const version = (run(process.execPath, [entry, '--version']).stdout || '').trim();
  if (version !== baselineVersion) throw new Error(`基线制品 ${artifact.path} 安装后版本 ${version} 不等于基线版本 ${baselineVersion}`);
  return { entry, version, artifact };
}

let exitCode = 0;
try {
  let entry = null;
  let baselineEntry = null;
  let baselineEvidence = [];
  if (SELF_TEST) {
    entry = realpathSync(resolve(process.env.OPENLOGOS_SSIM_SMOKE_ENTRY));
    baselineEntry = realpathSync(resolve(process.env.OPENLOGOS_SSIM_SMOKE_BASELINE_ENTRY));
  } else {
    const skip = (reason, missing) => exitNotApplicable(OWNED, { reason, missing, environment: ENVIRONMENT, repoRoot });
    const version = candidateVersion();
    if (!versionAtLeast(version, MIN_VERSION)) skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-version']);
    const record = existsSync(join(repoRoot, DEPLOYMENT_RECORD)) ? readFileSync(join(repoRoot, DEPLOYMENT_RECORD), 'utf8') : '';
    if (!record.includes(version)) skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version}`, ['deployment-record']);
    if (!existsSync(join(repoRoot, REPO_SYNCED_FILES[0][0]))) skip(`本仓未执行 openlogos sync（缺少托管副本 ${REPO_SYNCED_FILES[0][0]}）`, ['repo-sync']);
    const baseline = installBaseline();
    if (baseline.gap) skip(baseline.gap, baseline.missing);
    baselineEntry = baseline.entry;
    baselineEvidence = [`baseline_version=${baseline.version}`, `baseline_artifact=${baseline.artifact.path}`, `baseline_sha256=${baseline.artifact.sha256}`];
    entry = globalEntry();
    const problem = !entry ? '找不到 openlogos 入口' : globalInstallProblem(entry);
    if (problem) {
      for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
      entry = null;
    }
  }
  if (entry) {
    for (const id of ISOLATED_SMOKE_SCOPE_IDS) {
      const started = Date.now();
      try {
        const { detail, evidence } = await CASES[id](entry, { baselineEntry, baselineEvidence });
        results.set(id, { status: 'pass', detail, evidence: [`entry=${entry}`, ...evidence], duration_ms: Date.now() - started });
      } catch (error) {
        results.set(id, {
          status: 'fail', detail: error instanceof Error ? error.message : String(error),
          evidence: [`entry=${entry}`, ...(error?.evidence ?? [])], duration_ms: Date.now() - started,
        });
      }
    }
  }
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = ISOLATED_SMOKE_SCOPE_IDS.filter(id => results.get(id)?.status !== 'pass');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${ISOLATED_SMOKE_SCOPE_IDS.join(', ')}`);
}
process.exit(exitCode);
