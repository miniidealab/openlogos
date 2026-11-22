#!/usr/bin/env node
/**
 * SMOKE-core-326～SMOKE-core-327 — 0.16.20 验收历史的**安装态**取证（提案 verification-history，功能规格 §2.104）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.20 验收历史安装态 smoke（SMOKE-core-326～327）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.20 本机测试环境发布（verification-history）」。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *
 *   - SMOKE-core-326：安装态版本、制品身份与 history 命令（--version 等于本次成功部署回执的候选版本；payloadHash 自洽；
 *     帮助列出 history；空项目 history list 返回空列表）。
 *   - SMOKE-core-327：全局 CLI 在一次性项目中（复用 S19 待部署夹具）两轮 verify → 部署前 smoke 被拒且不留历史 → 真实 deploy
 *     → 两轮 smoke → 查询与占位值搜索 → archive 后按 run_id 定位。
 *
 * **窗口**：活跃变更为 verification-history，或 OPENLOGOS_VH_SMOKE=1；窗口外为全部 owned ID 写 skip（不声明 target_environment）。
 * **适用性**（缺即显式 skip）：候选版本（local-release-candidate.ts）不早于 0.16.20；本提案有成功的 test 部署记录
 * （deployments.jsonl 中 slug=本提案、result=done 的最后一条 deploy），且本机部署回执与之同一 deploy_id、result=done、
 * candidate_version 逐字段等于候选版本。部署记录存在但回执不符 → 判 fail。
 * **子进程判定**：全局 CLI 子进程在独立进程组中运行、限时 120 秒（OPENLOGOS_VH_SMOKE_CHILD_TIMEOUT_MS 只能缩短），到时对整个进程组
 *   SIGKILL 并立即判 fail；每一步按预期的退出码与输出通道判定后再解析（需解析信封的步骤一律 --format json），
 *   超时、信号、启动错误、非预期退出码或信封通道 / 形态不匹配均判 fail，不重试。
 * **自测模式**（须同时满足）：OPENLOGOS_VH_SMOKE_SELF_TEST=1、OPENLOGOS_VH_SMOKE_ENTRY（候选入口），且 OPENLOGOS_SMOKE_RESULT_PATH
 *   指向**仓库之外**的独立账本；正式 smoke 上下文（OPENLOGOS_SMOKE_ENV / OPENLOGOS_SMOKE_MODULE 已注入）中拒绝自测；
 *   自测跳过环境前置与版本下限，结果以 environment=self-test-injected-entry 写入、从不声明 target_environment。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'verification-history';
const OWNED = ['SMOKE-core-326', 'SMOKE-core-327'];
const MIN_VERSION = '0.16.20';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
// 子进程时限：规格上限 120 秒；OPENLOGOS_VH_SMOKE_CHILD_TIMEOUT_MS 只能缩短（供回归夹具），不能放宽
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_VH_SMOKE_CHILD_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 && v < 120_000 ? v : 120_000;
})();

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_VH_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd = repoRoot, extra = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, ...extra });
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

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
/** 比较账本路径前先解析真实路径（tmpdir 等常位于 symlink 之后，如 macOS /var → /private/var）。 */
function realOrSelf(p) {
  // 自身或祖先尚不存在时，解析最近的已存在祖先再拼回剩余部分
  const rest = [];
  let cur = resolve(p);
  for (;;) {
    try { return join(realpathSync(cur), ...rest); } catch { /* 继续向上 */ }
    const parent = dirname(cur);
    if (parent === cur) return resolve(p);
    rest.unshift(basename(cur));
    cur = parent;
  }
}

if (!SELF_TEST && process.env.OPENLOGOS_VH_SMOKE_ENTRY !== undefined) {
  refuse('设置了 OPENLOGOS_VH_SMOKE_ENTRY 但未声明自测（OPENLOGOS_VH_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && !process.env.OPENLOGOS_VH_SMOKE_ENTRY) refuse('自测模式需要 OPENLOGOS_VH_SMOKE_ENTRY');
if (SELF_TEST && (process.env.OPENLOGOS_SMOKE_ENV || process.env.OPENLOGOS_SMOKE_MODULE)) {
  refuse('正式 smoke 上下文（已注入 OPENLOGOS_SMOKE_ENV / OPENLOGOS_SMOKE_MODULE）中不得启用自测模式');
}
if (SELF_TEST) {
  // 自测账本必须位于仓库之外：项目级与模块级（smoke.modules.<id>.result_path）正式账本都在仓库内，一并排除
  const rel = relative(realOrSelf(repoRoot), realOrSelf(resultPath));
  const insideRepo = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (insideRepo || realOrSelf(resultPath) === realOrSelf(formalResultPath())) {
    refuse('自测结果不得写入仓库内的 smoke 账本（含项目级与模块级正式账本）；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向仓库之外的独立账本');
  }
}

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_VH_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_VH_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_VH_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-vh-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content = 'x\n') {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function clearDir(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return;
  for (const f of readdirSync(abs)) if (f !== '.gitkeep') rmSync(join(abs, f), { recursive: true, force: true });
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_VH_')) delete env[key];
    if (key.startsWith('OPENLOGOS_VERIFY_') || key === 'OPENLOGOS_STDIO_TRACE') delete env[key];
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDE_PROJECT_DIR'].includes(key)) delete env[key];
    if (key === 'OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY' || key.startsWith('OPENLOGOS_GUARD_')) delete env[key];
  }
  return { ...env, ...extra };
}
/**
 * 统一的子进程成功判定（code-r1 F2）：先查启动错误、120 秒超时、信号与退出码，全部通过才返回 stdout。
 * 输出正确但非零退出、或打印后挂死至超时，一律判失败（不重试、不写 pass）。
 */
/**
 * 在独立进程组中运行子进程（code-r2 F2）：到时对整个进程组发 SIGKILL（不给忽略 SIGTERM 的机会，连同模板再启动的
 * status 一并终止），并立即返回 timedOut，不等待残留管道关闭。
 */
function runChild(cmd, args, { cwd, env }) {
  return new Promise(resolvePromise => {
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = r => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise({ stdout, stderr, ...r }); } };
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) { finish({ status: null, signal: null, error }); return; }
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } }
      child.stdout?.destroy(); child.stderr?.destroy();
      finish({ status: null, signal: 'SIGKILL', timedOut: true });
    }, CHILD_TIMEOUT_MS);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', error => finish({ status: null, signal: null, error }));
    child.on('close', (status, signal) => finish({ status, signal }));
    child.stdin.end('');
  });
}

function childOk(label, r) {
  if (r.timedOut) throw new Error(`${label} 超过 ${CHILD_TIMEOUT_MS / 1000} 秒未返回，已强制终止其进程组，判失败、不重试`);
  if (r.error) throw new Error(`${label} 启动失败：${r.error.message}`);
  if (r.signal) throw new Error(`${label} 被信号 ${r.signal} 终止，判失败`);
  if (r.status !== 0) throw new Error(`${label} 退出码 ${r.status}（非零即失败）：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return r.stdout || '';
}
/** 以子进程调用被测 CLI（时限 120 秒），经 childOk 判定成功后返回 stdout。 */
async function cli(entry, root, args) {
  const r = await runChild(process.execPath, [entry, ...args], {
    cwd: root, env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home') }),
  });
  return childOk(`全局 CLI ${args.join(' ')}`, r);
}
/**
 * 按预期退出码与输出通道判定一次全局 CLI 调用：先查超时、启动错误与信号，再要求退出码等于 expectExit；
 * channel 为 'stdout' / 'stderr' 时从该通道解析最后一行 JSON 信封，解析不到即判信封不匹配。
 */
async function cliExpect(entry, root, args, expectExit, channel) {
  const label = `全局 CLI ${args.join(' ')}`;
  const r = await runChild(process.execPath, [entry, ...args], {
    cwd: root, env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home') }),
  });
  if (r.timedOut) throw new Error(`${label} 超过 ${CHILD_TIMEOUT_MS / 1000} 秒未返回，已强制终止其进程组，判失败、不重试`);
  if (r.error) throw new Error(`${label} 启动失败：${r.error.message}`);
  if (r.signal) throw new Error(`${label} 被信号 ${r.signal} 终止，判失败`);
  if (r.status !== expectExit) throw new Error(`${label} 退出码 ${r.status}，预期 ${expectExit}：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  if (!channel) return { stdout: r.stdout || '', stderr: r.stderr || '' };
  const text = channel === 'stdout' ? (r.stdout || '') : (r.stderr || '');
  const line = text.split('\n').reverse().find(l => l.trim().startsWith('{'));
  let envelope = null;
  try { envelope = line ? JSON.parse(line) : null; } catch { envelope = null; }
  if (!envelope) throw new Error(`${label} 的 ${channel} 没有 JSON 信封（信封通道 / 形态不匹配）：${text.slice(0, 200)}`);
  return envelope;
}
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv(), timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return r.stdout.trim();
}
function allFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) allFiles(p, out); else out.push(p); }
  return out;
}

const SECRET = 'SECRET-PLACEHOLDER-7f3a';
const PROPOSAL_SLUG = 'vh-smoke';
const HISTORY_DIR = 'logos/resources/verify/history';
const VERIFY_RUNNER = `const fs = require('fs');
const m = JSON.parse(fs.readFileSync('tools/mode.json', 'utf8'));
const ids = ['UT-S01-01', 'UT-S01-02'];
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', ids.map(id => JSON.stringify((m.verifyFail || []).includes(id)
  ? { id, status: 'fail', scenario: 'S01', error: 'assert failed ' + m.secret } : { id, status: 'pass', scenario: 'S01' })).join('\\n') + '\\n');
`;
const SMOKE_RUNNER = `const fs = require('fs');
const m = JSON.parse(fs.readFileSync('tools/mode.json', 'utf8'));
const out = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';
const id = 'SMOKE-core-901';
const row = m.smokeFail ? { id, status: 'fail', target_environment: process.env.OPENLOGOS_SMOKE_ENV, error: 'boom', detail: 'runner detail ' + m.secret }
  : { id, status: 'pass', target_environment: process.env.OPENLOGOS_SMOKE_ENV, detail: 'ok' };
fs.writeFileSync(out, JSON.stringify(row) + '\\n');
`;

/**
 * 一次性项目：经被测 CLI init 建立，复用 S19 待部署夹具形态——单模块 core（launched，要求部署与 smoke），测试规格
 * UT-S01-01 / UT-S01-02，smoke 规格 SMOKE-core-901；登记表 test 以 no-op 脚本部署；活跃提案 vh-smoke 声明需部署与 smoke、
 * 已勾选 [code]、未勾选 [deploy]、SPEC_MERGED；提交到本地 git。
 */
async function historyProject(entryPath) {
  const root = realpathSync(tempDir('proj'));
  await cliExpect(entryPath, root, ['init', 'vh-smoke', '--locale', 'zh', '--ai-tool', 'other'], 0, null);
  put(root, 'logos/logos-project.yaml', [
    'project:', '  name: "vh-smoke"', '  description: ""',
    'modules:', '  - id: core', '    name: core', '    lifecycle: launched',
    'deployment_gates:', '  core:', '    deployment_required: true', '    smoke_required: true',
    'resource_index: []', '',
  ].join('\n'));
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { ...(cfg.verify ?? {}), result_path: 'logos/resources/verify/test-results.jsonl', pre_run_command: 'node tools/verify.cjs', sandbox_mode: 'off' };
  cfg.smoke = { ...(cfg.smoke ?? {}), result_path: 'logos/resources/verify/smoke-results.jsonl', command: 'node tools/smoke.cjs', sandbox_mode: 'off' };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  put(root, 'logos/resources/test/core-S01-test-cases.md', '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n');
  put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态夹具 |\n');
  put(root, 'logos/environments.yaml', 'schema_version: 1\nenvironments:\n  - id: test\n    name: Test\n    tier: test\n    deploy:\n      mode: script\n      script: tools/deploy-noop.mjs\n');
  put(root, 'tools/deploy-noop.mjs', '#!/usr/bin/env node\nprocess.exit(0);\n');
  chmodSync(join(root, 'tools/deploy-noop.mjs'), 0o755);
  put(root, 'tools/verify.cjs', VERIFY_RUNNER);
  put(root, 'tools/smoke.cjs', SMOKE_RUNNER);
  put(root, 'tools/mode.json', JSON.stringify({ secret: SECRET }));
  const dir = join(root, 'logos/changes', PROPOSAL_SLUG);
  put(root, `logos/changes/${PROPOSAL_SLUG}/proposal.md`, [
    `# 变更提案：${PROPOSAL_SLUG}`, '', '## 变更原因', '安装态夹具。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：test',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '夹具。', '',
  ].join('\n'));
  put(root, `logos/changes/${PROPOSAL_SLUG}/tasks.md`, ['# 实现任务', '', '## [code] 代码实现', '- [x] 实现（覆盖 UT-S01-01）', '',
    '## [deploy] 部署到 test', '- [ ] 部署到 test', ''].join('\n'));
  put(root, `logos/changes/${PROPOSAL_SLUG}/SPEC_MERGED`, '{}\n');
  put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: PROPOSAL_SLUG, module: 'core' }));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'openlogos-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  commitAll(root, 'fixture');
  return { root, dir };
}
function commitAll(root, message) {
  git(root, ['add', '-A']);
  if (git(root, ['status', '--porcelain'])) git(root, ['commit', '-qm', message]);
}
function setMode(root, m) { put(root, 'tools/mode.json', JSON.stringify({ secret: SECRET, ...m })); }

const CASES = {
  'SMOKE-core-326': async (entryPath) => {
    const problems = [];
    const evidence = [`entry_realpath=${entryPath}`];
    const work = realpathSync(tempDir('ver'));
    const version = (await cliExpect(entryPath, work, ['--version'], 0, null)).stdout.trim();
    const candidate = SELF_TEST ? version : DEPLOYED?.candidate_version;
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (!SELF_TEST) evidence.push(`deploy_id=${DEPLOYED?.deploy_id}`);
    if (version !== candidate) problems.push(`① --version 为 ${version}，本次成功部署回执的候选版本为 ${candidate}`);
    if (!SELF_TEST && !versionAtLeast(version, MIN_VERSION)) problems.push(`① --version ${version} 早于 ${MIN_VERSION}`);
    const pkg = packageRoot(entryPath);
    if (!pkg) throw new Error(`无法从 ${entryPath} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`package_root=${pkg}`, `payload_hash=${manifest.payloadHash}`);
    try {
      const lib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
      lib.validateAssetManifest(manifest, pkg);
    } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    const help = (await cliExpect(entryPath, work, ['--help'], 0, null)).stdout;
    if (!/\bhistory\b/.test(help)) problems.push('③ --help 未列出 history');
    const list = await cliExpect(entryPath, work, ['history', 'list', '--format', 'json'], 0, 'stdout');
    evidence.push(`empty_history_runs=${JSON.stringify(list.data?.runs)}`);
    if (!Array.isArray(list.data?.runs) || list.data.runs.length !== 0) problems.push('③ 空项目 history list 未返回空列表');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装态版本等于候选版本；payloadHash 自洽；帮助列出 history，空项目 history list 返回空列表', evidence };
  },

  'SMOKE-core-327': async (entryPath) => {
    const problems = [];
    const evidence = [];
    const { root, dir } = await historyProject(entryPath);
    const indexFiles = () => (existsSync(join(root, HISTORY_DIR)) ? readdirSync(join(root, HISTORY_DIR)).filter(n => n.endsWith('.json')).sort() : []);
    // ① 第一次 verify：UT-S01-02 失败（预期退出码 1、stdout FAIL 信封）
    setMode(root, { verifyFail: ['UT-S01-02'] });
    const v1 = await cliExpect(entryPath, root, ['verify', '--format', 'json'], 1, 'stdout');
    const firstRun = v1.data?.history?.run_id;
    if (v1.data?.gate?.result !== 'FAIL' || !firstRun) throw Object.assign(new Error('① 第一次 verify 未给出 FAIL 结论与 history.run_id'), { evidence });
    // ② 第二次 verify：全部通过
    setMode(root, {});
    const v2 = await cliExpect(entryPath, root, ['verify', '--format', 'json'], 0, 'stdout');
    if (v2.data?.gate?.result !== 'PASS') problems.push('② 第二次 verify 未 PASS');
    if (!existsSync(join(dir, 'VERIFY_PASS'))) problems.push('② 未写出 VERIFY_PASS');
    // ③ 部署前 smoke：既有错误信封 SMOKE_DEPLOY_NOT_DONE，且不新增历史
    const beforeSmoke = indexFiles();
    const rejected = await cliExpect(entryPath, root, ['smoke', '--env', 'test', '--format', 'json'], 1, 'stderr');
    if (rejected.error?.code !== 'SMOKE_DEPLOY_NOT_DONE') problems.push(`③ 部署前 smoke 错误码为 ${rejected.error?.code}`);
    if (JSON.stringify(indexFiles()) !== JSON.stringify(beforeSmoke)) problems.push('③ 部署前被拒的 smoke 新增了历史');
    // ④ 真实 deploy（提交工作区后部署请求 HEAD）
    commitAll(root, 'before deploy');
    const dep = await cliExpect(entryPath, root, ['deploy', '--env', 'test', '--format', 'json'], 0, 'stdout');
    const deployId = dep.data?.deploy_id ?? dep.data?.record?.deploy_id ?? null;
    evidence.push(`deploy_id=${deployId}`);
    if (!existsSync(join(dir, 'DEPLOY_DONE'))) problems.push('④ deploy 未写 DEPLOY_DONE');
    // ⑤ 两次 smoke：第一次失败（预期 1、stdout FAIL 信封），第二次通过
    setMode(root, { smokeFail: true });
    const s1 = await cliExpect(entryPath, root, ['smoke', '--env', 'test', '--format', 'json'], 1, 'stdout');
    setMode(root, {});
    const s2 = await cliExpect(entryPath, root, ['smoke', '--env', 'test', '--format', 'json'], 0, 'stdout');
    for (const [label, s] of [['第一次', s1], ['第二次', s2]]) {
      const idx = s.data?.history?.run_id ? JSON.parse(readFileSync(join(root, HISTORY_DIR, `${s.data.history.run_id}.json`), 'utf8')) : null;
      if (!idx || idx.environment !== 'test') problems.push(`⑤ ${label} smoke 历史缺失或 environment 不为 test`);
      else if (deployId && idx.deploy_id !== deployId) problems.push(`⑤ ${label} smoke 历史 deploy_id=${idx.deploy_id}，部署为 ${deployId}`);
    }
    // ⑥ 查询：4 条倒序；第①轮详情
    const list = await cliExpect(entryPath, root, ['history', 'list', '--format', 'json'], 0, 'stdout');
    const order = (list.data?.runs ?? []).map(r => `${r.kind}:${r.gate?.result}`);
    evidence.push(`order=${order.join(',')}`);
    if (order.join(',') !== 'smoke:PASS,smoke:FAIL,verify:PASS,verify:FAIL') problems.push(`⑥ 列表顺序为 ${order.join(',')}`);
    const shown = await cliExpect(entryPath, root, ['history', 'show', firstRun, '--format', 'json'], 0, 'stdout');
    if (JSON.stringify(shown.data?.run?.failed_ids) !== JSON.stringify(['UT-S01-02'])) problems.push('⑥ 第①轮 failed_ids 不符');
    if (shown.data?.full_record?.path !== `logos/changes/${PROPOSAL_SLUG}/verify-runs/${firstRun}`) problems.push(`⑥ 第①轮 full_record 为 ${JSON.stringify(shown.data?.full_record)}`);
    // ⑦ 占位值：中央索引不含；提案运行目录完整结果含（缺省 raw_in_proposal=true）
    const indexHits = allFiles(join(root, HISTORY_DIR)).filter(p => readFileSync(p, 'utf8').includes(SECRET));
    const runHits = allFiles(join(dir, 'verify-runs')).filter(p => readFileSync(p, 'utf8').includes(SECRET));
    if (indexHits.length > 0) problems.push(`⑦ 中央索引含占位值：${indexHits.map(p => relative(root, p)).join(', ')}`);
    if (runHits.length === 0) problems.push('⑦ 提案运行目录的完整结果不含占位值');
    // ⑧ archive 后按 run_id 定位；中央索引字节不变
    const indexBefore = sha256(readFileSync(join(root, HISTORY_DIR, `${firstRun}.json`)));
    commitAll(root, 'before archive');
    await cliExpect(entryPath, root, ['archive', PROPOSAL_SLUG], 0, null);
    const after = await cliExpect(entryPath, root, ['history', 'show', firstRun, '--format', 'json'], 0, 'stdout');
    const archivedPath = after.data?.full_record?.path ?? '';
    evidence.push(`archived_full_record=${archivedPath}`);
    if (!new RegExp(`^logos/changes/archive/[^/]+-${PROPOSAL_SLUG}/verify-runs/${firstRun}$`).test(archivedPath)) problems.push(`⑧ 归档后 full_record 为 ${archivedPath}`);
    if (sha256(readFileSync(join(root, HISTORY_DIR, `${firstRun}.json`))) !== indexBefore) problems.push('⑧ 归档改写了中央索引');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '两轮 verify、部署前被拒、真实部署与两轮 smoke 均留下正确历史；中央索引无自由文本；归档后按 run_id 仍可定位', evidence };
  },
};

export const VERIFICATION_HISTORY_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of VERIFICATION_HISTORY_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
    const record = { id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT };
    if (row.status !== 'skip' && TARGET_ENV && !SELF_TEST) record.target_environment = TARGET_ENV;
    record.detail = row.detail;
    record.evidence = row.evidence;
    appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  }
}

function globalEntry() {
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-c', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}
function globalInstallProblem(entryPath) {
  const r = run(npmBin, ['prefix', '-g']);
  if (r.status !== 0 || !r.stdout.trim()) return `无法读取 npm prefix -g：${(r.stderr || '').slice(0, 200)}`;
  const prefix = realpathSync(r.stdout.trim());
  const nodeModules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  const pkgDir = join(nodeModules, '@miniidealab', 'openlogos');
  const inside = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  if (lstatSync(pkgDir).isSymbolicLink()) return `全局包目录 ${pkgDir} 是链接（workspace link 不构成安装态证据）`;
  if (!inside(realpathSync(pkgDir), entryPath)) return `入口 ${entryPath} 不在全局 npm prefix 的包目录 ${pkgDir} 内`;
  if (inside(repoRoot, entryPath)) return `入口 ${entryPath} 位于工作区 ${repoRoot} 内`;
  return null;
}

/**
 * 本提案的成功部署证据（code-r1 F5）：deployments.jsonl 中 slug=本提案、environment=test、result=done 的最后一条 deploy，
 * 与本机部署回执同一 deploy_id、result=done，且回执 candidate_version 逐字段等于源码候选版本。
 * 返回 { missing } 表示部署记录确实缺失（显式 skip），{ problem } 表示记录存在但不符（fail），{ receipt } 表示通过。
 */
function deployedCandidate(version) {
  const ledgerPath = join(repoRoot, DEPLOY_LEDGER);
  const rows = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } })
    : [];
  const deploys = rows.filter(r => r.kind === 'deploy' && r.slug === SLUG && r.environment === DEPLOY_ENV && r.result === 'done' && r.rollback !== true);
  const last = deploys[deploys.length - 1];
  if (!last) return { missing: `部署账本 ${DEPLOY_LEDGER} 中没有本提案 ${SLUG} 在 ${DEPLOY_ENV} 的成功部署记录` };
  const receiptPath = join(repoRoot, DEPLOY_RECEIPT);
  if (!existsSync(receiptPath)) return { problem: `本提案已有成功部署记录（deploy_id ${last.deploy_id}），但缺少部署回执 ${DEPLOY_RECEIPT}` };
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch (e) { return { problem: `部署回执 ${DEPLOY_RECEIPT} 无法解析：${e instanceof Error ? e.message : String(e)}` }; }
  const mismatch = [];
  if (receipt.deploy_id !== last.deploy_id) mismatch.push(`deploy_id 回执=${receipt.deploy_id} 账本=${last.deploy_id}`);
  if (receipt.result !== 'done') mismatch.push(`回执 result=${receipt.result}`);
  if (receipt.environment !== DEPLOY_ENV) mismatch.push(`回执 environment=${receipt.environment}`);
  if (receipt.candidate_version !== version) mismatch.push(`回执 candidate_version=${receipt.candidate_version}，源码候选版本=${version}`);
  if (mismatch.length > 0) return { problem: `本次成功部署回执与候选不符：${mismatch.join('；')}` };
  return { receipt };
}

let DEPLOYED = null;
let exitCode = 0;
try {
  let entryPath = null;
  if (SELF_TEST) {
    entryPath = realpathSync(resolve(process.env.OPENLOGOS_VH_SMOKE_ENTRY));
  } else {
    const skip = (reason, missing) => exitNotApplicable(OWNED, { reason, missing, environment: ENVIRONMENT, repoRoot });
    const version = candidateVersion();
    if (!versionAtLeast(version, MIN_VERSION)) skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-version']);
    const deployed = deployedCandidate(version);
    if (deployed.missing) skip(deployed.missing, ['deployment-record']);
    if (deployed.problem) {
      for (const id of OWNED) results.set(id, { status: 'fail', detail: deployed.problem, evidence: [], duration_ms: 0 });
    } else {
      DEPLOYED = deployed.receipt;
      entryPath = globalEntry();
      const problem = !entryPath ? '找不到 openlogos 入口' : globalInstallProblem(entryPath);
      if (problem) {
        for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
        entryPath = null;
      }
    }
  }
  if (entryPath) {
    for (const id of VERIFICATION_HISTORY_SMOKE_IDS) {
      const started = Date.now();
      try {
        const out = await CASES[id](entryPath);
        results.set(id, { status: 'pass', detail: out.detail, evidence: [`entry=${entryPath}`, ...out.evidence], duration_ms: Date.now() - started });
      } catch (error) {
        results.set(id, {
          status: 'fail', detail: error instanceof Error ? error.message : String(error),
          evidence: [`entry=${entryPath}`, ...(error?.evidence ?? [])], duration_ms: Date.now() - started,
        });
      }
    }
  }
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = VERIFICATION_HISTORY_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${VERIFICATION_HISTORY_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
