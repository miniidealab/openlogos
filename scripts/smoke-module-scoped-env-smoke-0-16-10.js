#!/usr/bin/env node
/**
 * SMOKE-core-289～SMOKE-core-293 — 0.16.10 按模块区分环境与 smoke 的**安装态**取证（来源提案 module-scoped-env-smoke，功能规格 §2.98）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.10 按模块区分环境与 smoke 安装态 smoke（SMOKE-core-289～293）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.10 本机测试环境发布（module-scoped-env-smoke）」。
 *
 *   - SMOKE-core-289：安装态版本、制品身份与本仓 sync 同源（包内 schema 含 smoke.modules、environments.md 含 §14、dist 含 ENV_MODULE_MISMATCH）。
 *   - SMOKE-core-290：未声明环境的 core 不被登记表拦截；core 冒用 team 环境、team 用非本模块环境 / 不传 --env 均零写入拒绝。
 *   - SMOKE-core-291：core 有活跃提案时 team 版本部署与 team smoke（版本上下文、身份取账本、core 提案目录字节不变）。
 *   - SMOKE-core-292：team 声明引用失效时 deploy-done / smoke / deploy 均 ENV_GATE_REFERENCE_UNKNOWN 零写入、不降级。
 *   - SMOKE-core-293：单模块零回归（与 0.16.9 回滚制品逐项比对）与 next --auto 带 --env。
 *
 * 临时项目一律经被测 CLI `init` 建立后写入多模块配置；全局 CLI 以入口绝对路径经子进程调用；全部写入只在一次性目录内，
 * 结束即删除；对全局安装态只读，对本仓只做 SMOKE-core-289 ④ 的只读比对。
 *
 * **窗口**：活跃变更为 module-scoped-env-smoke，或 OPENLOGOS_MSES_SMOKE=1；窗口外为全部 owned ID 写 skip。
 * **适用性**（缺即显式 skip，不标 platform-unavailable）：候选版本（local-release-candidate.ts）不早于 0.16.10；部署记录记载候选版本；
 * 本机部署回执有回滚制品；本仓已 sync（logos/spec/environments.md 存在）。
 * **自测模式**（须同时满足）：OPENLOGOS_MSES_SMOKE_SELF_TEST=1、OPENLOGOS_MSES_SMOKE_ENTRY（候选入口）、OPENLOGOS_MSES_SMOKE_BASELINE_ENTRY（基线入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置与本仓比对（④），结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'module-scoped-env-smoke';
const OWNED = ['SMOKE-core-289', 'SMOKE-core-290', 'SMOKE-core-291', 'SMOKE-core-292', 'SMOKE-core-293'];
const MIN_VERSION = '0.16.10';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const REPO_SYNCED_FILES = [
  ['logos/spec/environments.md', 'spec/environments.md'],
  ['logos/skills/change-writer/SKILL.md', 'skills/change-writer/SKILL.md'],
];
const LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_MSES_SMOKE_SELF_TEST === '1';
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

if (!SELF_TEST && (process.env.OPENLOGOS_MSES_SMOKE_ENTRY !== undefined || process.env.OPENLOGOS_MSES_SMOKE_BASELINE_ENTRY !== undefined)) {
  refuse('设置了 OPENLOGOS_MSES_SMOKE_ENTRY / _BASELINE_ENTRY 但未声明自测（OPENLOGOS_MSES_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && (!process.env.OPENLOGOS_MSES_SMOKE_ENTRY || !process.env.OPENLOGOS_MSES_SMOKE_BASELINE_ENTRY)) {
  refuse('自测模式需要 OPENLOGOS_MSES_SMOKE_ENTRY 与 OPENLOGOS_MSES_SMOKE_BASELINE_ENTRY');
}
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_MSES_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_MSES_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_MSES_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-mses-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_MSES_')) delete env[key];
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

/** 记录型 smoke runner：把被调用模块与注入变量写进项目外一次性调用日志，并为本模块用例写 pass 结果。 */
const RUNNER = (label, ids) => `
const fs = require('fs'); const path = require('path');
const log = path.join(path.dirname(process.cwd()), path.basename(process.cwd()) + '.calls.log');
fs.appendFileSync(log, JSON.stringify({ runner: ${JSON.stringify(label)}, module: process.env.OPENLOGOS_SMOKE_MODULE ?? null, env: process.env.OPENLOGOS_SMOKE_ENV ?? null }) + '\\n');
const out = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;
const rows = ${JSON.stringify(ids)}.map(id => ({ id, status: 'pass', timestamp: new Date().toISOString(), ...(env ? { target_environment: env } : {}) }));
fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\\n') + '\\n');
`;

function registry({ teamAliases = ['Team-Production'], requireApproval = false } = {}) {
  return [
    'schema_version: 1',
    'environments:',
    '  - {id: test, name: Test, tier: test}',
    '  - id: team-prod',
    '    name: Team Production',
    '    tier: prod',
    `    aliases: [${teamAliases.join(', ')}]`,
    '    deploy:',
    '      mode: script',
    '      script: scripts/deploy-team.sh',
    '      args: ["{env}", "{ref}"]',
    ...(requireApproval ? ['    require_approval: true'] : []),
    '',
  ].join('\n');
}
const PROPOSAL = module => [
  `# 变更提案：${module}-x`, '', `> module: ${module} | created: 2026-10-19`, '', '## 变更原因', '发布。', '', '## 变更类型', '代码级修复', '',
  '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：test',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
].join('\n');
const TASKS = ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n');

/**
 * 经被测 CLI init 建立的一次性 git 项目。kind：multi（core 不声明环境、team 声明 [team-prod]，配置 smoke.modules.team）
 * 或 single（单模块带登记表）。teamDecl 覆盖 team 的 environments 声明。
 */
function makeProject(entry, kind, { teamDecl = ['team-prod'], teamAliases, requireApproval } = {}) {
  const root = realpathSync(tempDir(kind));
  scopes.push(callsLog(root));
  cliOk(entry, root, ['init', 'mses', '--locale', 'zh', '--ai-tool', 'other']);
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.smoke = {
    command: 'node scripts/smoke-project.js', result_path: 'logos/resources/verify/smoke-results.jsonl', sandbox_mode: 'off',
    ...(kind === 'multi' ? { modules: { team: { command: 'node scripts/smoke-team.js' } } } : {}),
  };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  const modules = kind === 'multi'
    ? '  - id: core\n    name: core\n    lifecycle: launched\n  - id: team\n    name: team\n    lifecycle: initial\n'
    : '  - id: core\n    name: core\n    lifecycle: launched\n';
  const gates = kind === 'multi' ? `deployment_gates:\n  team:\n    environments: [${teamDecl.join(', ')}]\n` : '';
  put(root, 'logos/logos-project.yaml', `project:\n  name: "mses"\nmodules:\n${modules}${gates}`);
  put(root, 'logos/environments.yaml', kind === 'multi' ? registry({ teamAliases, requireApproval }) : registry());
  put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | a |\n');
  put(root, 'logos/resources/test/smoke/shared-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-shared-01 | g |\n');
  const all = ['SMOKE-core-01', 'SMOKE-shared-01'];
  if (kind === 'multi') {
    put(root, 'logos/resources/test/smoke/team-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-team-01 | t |\n');
    all.push('SMOKE-team-01');
  }
  put(root, 'scripts/smoke-project.js', RUNNER('project', all));
  put(root, 'scripts/smoke-team.js', RUNNER('team', ['SMOKE-team-01', 'SMOKE-shared-01']));
  put(root, 'scripts/deploy-team.sh', `#!/bin/sh\necho "{\\"deploy\\":\\"$1\\"}" >> '${callsLog(root)}'\n`);
  chmodSync(join(root, 'scripts/deploy-team.sh'), 0o755);
  put(root, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nok\n');
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'openlogos-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}

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
  'SMOKE-core-289': async (entry) => {
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
    const schema = json(read('spec/logos.config.schema.json'));
    if (!schema?.properties?.smoke?.properties?.modules) problems.push('③ 包内 spec/logos.config.schema.json 缺少 smoke.modules 定义');
    if (!/^## 14\. 按模块区分环境与 smoke/m.test(read('spec/environments.md'))) problems.push('③ 包内 spec/environments.md 缺少 §14');
    if (!read('dist/lib/module-env-scope.js').includes('envScope.error.moduleMismatch') || !read('dist/commands/deploy-done.js').includes('ENV_MODULE_MISMATCH')) {
      problems.push('③ 包内 dist 缺少 ENV_MODULE_MISMATCH 的实现');
    }
    if (!SELF_TEST) {
      for (const [repoRel, pkgRel] of REPO_SYNCED_FILES) {
        const a = existsSync(join(repoRoot, repoRel)) ? sha256(readFileSync(join(repoRoot, repoRel))) : null;
        const b = existsSync(join(pkg, pkgRel)) ? sha256(readFileSync(join(pkg, pkgRel))) : null;
        evidence.push(`${repoRel}=${a}`, `package:${pkgRel}=${b}`);
        if (!a || !b || a !== b) problems.push(`④ 本仓 ${repoRel} 与全局包内 ${pkgRel} 字节不一致（需重新执行本仓 openlogos sync 后复核）`);
      }
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: `安装态身份同源（${version}）：manifest 自洽，包内含 smoke.modules schema、§14 与按模块归属实现${SELF_TEST ? '' : '，本仓 sync 副本同字节'}`, evidence };
  },

  'SMOKE-core-290': async (entry) => {
    const root = makeProject(entry, 'multi');
    const evidence = [`project=${root}`];
    const problems = [];
    const rel = proposal(entry, root, 'core');
    // ① core：deploy-done（不传 --env）与 smoke 均成功，environment 为 null，不写部署账本
    const dd = cli(entry, root, ['deploy-done', '--format', 'json']);
    const marker = json(existsSync(join(root, rel, 'DEPLOY_DONE')) ? readFileSync(join(root, rel, 'DEPLOY_DONE'), 'utf8') : '');
    const sm = cli(entry, root, ['smoke', '--format', 'json']);
    evidence.push(`core deploy-done=${dd.status} smoke=${sm.status} gate=${json(sm.stdout)?.data?.gate?.result ?? '-'}`);
    if (dd.status !== 0) problems.push(`① deploy-done 失败：${errorCode(dd) ?? dd.stderr.slice(0, 200)}`);
    if (!marker || marker.environment !== null) problems.push('① DEPLOY_DONE.environment 应为 null');
    if (sm.status !== 0 || json(sm.stdout)?.data?.gate?.result !== 'PASS') problems.push(`① smoke 未通过：${errorCode(sm) ?? sm.stderr.slice(0, 200)}`);
    if (existsSync(join(root, LEDGER_REL))) problems.push('① 不应写部署账本');
    // ② core：deploy-done --env team-prod → ENV_MODULE_MISMATCH，零写入
    const before2 = snapshot(root, rel);
    const mm = cli(entry, root, ['deploy-done', '--env', 'team-prod', '--format', 'json']);
    evidence.push(`core deploy-done team-prod=${errorCode(mm)}`);
    if (mm.status !== 1 || errorCode(mm) !== 'ENV_MODULE_MISMATCH') problems.push(`② 应为 ENV_MODULE_MISMATCH，实际 ${errorCode(mm) ?? `exit ${mm.status}`}`);
    if (snapshot(root, rel) !== before2 || existsSync(join(root, LEDGER_REL))) problems.push('② 拒绝后提案目录或账本有写入');
    // ③ team：deploy-done --env test → ENV_MODULE_MISMATCH；不传 → ENV_REQUIRED；均零写入
    const teamRel = proposal(entry, root, 'team');
    const before3 = snapshot(root, teamRel);
    const t1 = cli(entry, root, ['deploy-done', '--env', 'test', '--format', 'json']);
    const t2 = cli(entry, root, ['deploy-done', '--format', 'json']);
    evidence.push(`team deploy-done test=${errorCode(t1)} none=${errorCode(t2)}`);
    if (errorCode(t1) !== 'ENV_MODULE_MISMATCH') problems.push(`③ --env test 应为 ENV_MODULE_MISMATCH，实际 ${errorCode(t1) ?? `exit ${t1.status}`}`);
    if (errorCode(t2) !== 'ENV_REQUIRED') problems.push(`③ 不传 --env 应为 ENV_REQUIRED，实际 ${errorCode(t2) ?? `exit ${t2.status}`}`);
    if (snapshot(root, teamRel) !== before3 || existsSync(join(root, LEDGER_REL))) problems.push('③ 拒绝后提案目录或账本有写入');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '未声明环境的 core 落标与 smoke 不被登记表拦截且不写账本；core 冒用 team 环境、team 用非本模块环境与不传 --env 均零写入拒绝', evidence };
  },

  'SMOKE-core-291': async (entry) => {
    const root = makeProject(entry, 'multi');
    const evidence = [`project=${root}`];
    const problems = [];
    const rel = proposal(entry, root, 'core');
    const before = snapshot(root, rel);
    const head = git(root, ['rev-parse', 'HEAD']);
    const dep = cli(entry, root, ['deploy', '--env', 'team-prod', '--ref', head, '--format', 'json']);
    const depData = json(dep.stdout)?.data;
    evidence.push(`deploy=${dep.status} channel=${depData?.channel} deploy_id=${depData?.deploy_id}`);
    if (dep.status !== 0 || depData?.channel !== 'version') problems.push(`① 应以版本通道部署成功：exit ${dep.status} ${errorCode(dep) ?? ''} channel=${depData?.channel}`);
    const sm = cli(entry, root, ['smoke', '--env', 'team-prod', '--format', 'json']);
    const d = json(sm.stdout)?.data;
    evidence.push(`smoke=${sm.status} scope=${JSON.stringify(d?.scope)} evidence_deploy_id=${d?.environment_evidence?.deploy_id}`);
    if (sm.status !== 0 || d?.gate?.result !== 'PASS') problems.push(`② smoke 未通过：${errorCode(sm) ?? d?.gate?.reason}`);
    if (d?.scope?.module !== 'team' || d?.scope?.context !== 'version') problems.push(`② scope 应为 team / version，实际 ${JSON.stringify(d?.scope)}`);
    if (!depData?.deploy_id || d?.environment_evidence?.deploy_id !== depData.deploy_id) problems.push('② 部署身份未取自 ① 的账本记录');
    const runners = calls(root).filter(c => 'runner' in c);
    evidence.push(`calls=${JSON.stringify(runners)}`);
    if (runners.length !== 1 || runners[0].runner !== 'team' || runners[0].module !== 'team') problems.push(`③ 调用日志应只有 team 命令一次且 OPENLOGOS_SMOKE_MODULE=team，实际 ${JSON.stringify(runners)}`);
    if (snapshot(root, rel) !== before) problems.push('③ core 提案目录字节有变化');
    for (const m of ['DEPLOY_DONE', 'SMOKE_PASS', 'SMOKE_FAIL']) if (existsSync(join(root, rel, m))) problems.push(`③ core 提案出现 ${m}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: 'core 有活跃提案时 team 版本部署成功，team smoke 进入版本上下文、执行 team 命令、身份取账本，core 提案目录字节不变', evidence };
  },

  'SMOKE-core-292': async (entry) => {
    const root = makeProject(entry, 'multi', { teamDecl: ['team-production-gone'], teamAliases: ['Team-Production'], requireApproval: true });
    const evidence = [`project=${root}`];
    const problems = [];
    const rel = proposal(entry, root, 'team');
    const before = { proposal: snapshot(root, rel), ledger: snapshot(root, LEDGER_REL) };
    for (const args of [['deploy-done', '--env', 'team-prod'], ['smoke', '--env', 'team-prod'], ['deploy', '--env', 'team-prod']]) {
      const r = cli(entry, root, [...args, '--format', 'json']);
      evidence.push(`${args[0]}=${errorCode(r) ?? `exit ${r.status}`}`);
      if (r.status !== 1 || errorCode(r) !== 'ENV_GATE_REFERENCE_UNKNOWN') problems.push(`${args[0]} 应为 ENV_GATE_REFERENCE_UNKNOWN，实际 ${errorCode(r) ?? `exit ${r.status}`}`);
    }
    if (snapshot(root, rel) !== before.proposal) problems.push('提案目录字节有变化');
    if (snapshot(root, LEDGER_REL) !== before.ledger) problems.push('账本字节有变化');
    if (calls(root).length > 0) problems.push('部署脚本或 smoke runner 被运行');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: 'team 声明引用失效时 deploy-done / smoke / deploy 均 ENV_GATE_REFERENCE_UNKNOWN，提案目录与账本字节不变，脚本未运行', evidence };
  },

  'SMOKE-core-293': async (entry, { baselineEntry }) => {
    const evidence = [`baseline=${baselineEntry}`];
    const problems = [];
    const outputs = {};
    for (const [label, bin] of [['candidate', entry], ['baseline', baselineEntry]]) {
      const root = makeProject(bin, 'single');
      proposal(bin, root, 'core');
      const dd = cli(bin, root, ['deploy-done', '--env', 'test', '--format', 'json']);
      const next = json(cli(bin, root, ['next', '--auto', '--format', 'json']).stdout)?.data;
      const sm = cli(bin, root, ['smoke', '--env', 'test', '--format', 'json']);
      outputs[label] = {
        deployDone: { status: dd.status, out: normalize(dd.stdout, root), err: normalize(dd.stderr, root) },
        smoke: { status: sm.status, out: normalize(sm.stdout, root), err: normalize(sm.stderr, root) },
        nextCommand: next?.command ?? null,
      };
    }
    const { candidate, baseline } = outputs;
    evidence.push(`next candidate=${candidate.nextCommand} baseline=${baseline.nextCommand}`);
    if (JSON.stringify(candidate.deployDone) !== JSON.stringify(baseline.deployDone)) problems.push('① deploy-done --env test 与基线不一致');
    if (JSON.stringify(candidate.smoke) !== JSON.stringify(baseline.smoke)) problems.push('① smoke --env test 与基线不一致');
    if (candidate.smoke.out.includes('"scope"')) problems.push('① 单模块项目不应输出 scope');
    if (candidate.nextCommand !== 'openlogos smoke --env test') problems.push(`② 候选 next --auto 命令应为 openlogos smoke --env test，实际 ${candidate.nextCommand}`);
    if (baseline.nextCommand !== 'openlogos smoke') problems.push(`② 基线 next --auto 命令应为 openlogos smoke，实际 ${baseline.nextCommand}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '单模块项目 deploy-done / smoke 与基线一致且无 scope；next --auto 带 --env（基线为 openlogos smoke）', evidence };
  },
};

export const MODULE_SCOPED_ENV_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of MODULE_SCOPED_ENV_SMOKE_IDS) {
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

/** 正式模式：从本机部署回执的回滚制品（部署前版本）在一次性 prefix 中安装基线入口。 */
function installBaseline() {
  const receiptPath = join(repoRoot, RECEIPT);
  if (!existsSync(receiptPath)) return { gap: `缺少本机部署回执 ${RECEIPT}`, missing: ['deploy-receipt'] };
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const artifact = receipt.rollback_artifact?.path;
  if (!artifact || !existsSync(artifact)) return { gap: '部署回执未记载可用的回滚制品', missing: ['rollback-artifact'] };
  const prefix = tempDir('baseline');
  const inst = run(npmBin, ['install', '-g', '--prefix', prefix, artifact]);
  if (inst.status !== 0) throw new Error(`安装回滚制品失败：${(inst.stderr || '').slice(0, 300)}`);
  const entry = join(prefix, 'lib', 'node_modules', '@miniidealab', 'openlogos', 'dist', 'index.js');
  const version = (run(process.execPath, [entry, '--version']).stdout || '').trim();
  if (version !== receipt.previous_version) throw new Error(`回滚制品版本 ${version} 与回执 previous_version ${receipt.previous_version} 不一致`);
  return { entry, version };
}

let exitCode = 0;
try {
  let entry = null;
  let baselineEntry = null;
  if (SELF_TEST) {
    entry = realpathSync(resolve(process.env.OPENLOGOS_MSES_SMOKE_ENTRY));
    baselineEntry = realpathSync(resolve(process.env.OPENLOGOS_MSES_SMOKE_BASELINE_ENTRY));
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
    entry = globalEntry();
    const problem = !entry ? '找不到 openlogos 入口' : globalInstallProblem(entry);
    if (problem) {
      for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
      entry = null;
    }
  }
  if (entry) {
    for (const id of MODULE_SCOPED_ENV_SMOKE_IDS) {
      const started = Date.now();
      try {
        const { detail, evidence } = await CASES[id](entry, { baselineEntry });
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

const failed = MODULE_SCOPED_ENV_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${MODULE_SCOPED_ENV_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
