#!/usr/bin/env node
/**
 * SMOKE-core-324～SMOKE-core-325 — 0.16.19 SessionStart 横幅 API 阶段修复的**安装态**取证（提案 fix-phase-banner-api-false-missing）：
 * 场景 S11「per-scenario 覆盖判定的权威口径与 SessionStart 同口径约束」约束 5 / 5a、EX-11.26。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.19 SessionStart 横幅 API 阶段安装态 smoke（SMOKE-core-324～325）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.19 本机测试环境发布（fix-phase-banner-api-false-missing）」。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *
 *   - SMOKE-core-324：安装态版本与插件模板身份（--version 等于候选版本；payloadHash 自洽；包内
 *     claude-plugin-template/bin/openlogos-phase 与仓内源模板逐字节一致，且 API 分支不再调用逐场景判定）。
 *   - SMOKE-core-325：在一次性多模块项目中运行**安装包内**的插件模板，四种 API 形态给出正确横幅，且模板只读。
 *
 * 临时项目经被测 CLI `init` 建立后写入夹具；全局 CLI 与模板子进程时限 120 秒（超时判失败、不重试）。
 * 全部写入只在一次性目录内，结束即删除；对全局安装态只读，不读写本仓 logos/resources/（结果账本除外）。
 *
 * **窗口**：活跃变更为 fix-phase-banner-api-false-missing，或 OPENLOGOS_FPB_SMOKE=1；窗口外为全部 owned ID 写 skip（不声明 target_environment）。
 * **适用性**（缺即显式 skip）：候选版本（local-release-candidate.ts）不早于 0.16.19；本提案有成功的 test 部署记录
 * （deployments.jsonl 中 slug=本提案、result=done 的最后一条 deploy），且本机部署回执与之同一 deploy_id、result=done、
 * candidate_version 逐字段等于候选版本（code-r1 F5）。部署记录存在但回执不符 → 判 fail。
 * **子进程成功判定**（code-r1 F2）：全局 CLI 与模板子进程一律限时 120 秒，先检查启动错误、超时、信号与退出码，再解析 stdout。
 *   子进程在独立进程组中启动，到时对整个进程组发 SIGKILL 并立即返回（code-r2 F2：忽略 SIGTERM 或模板再启动的 status
 *   挂住都不能拖住 runner），随后记 fail。
 * **降级路径 PATH**（code-r1 F4）：③④ 使用 runner 自建的隔离 bin 目录（链接系统目录中除 openlogos 以外的命令），
 * 调用模板前验证该 PATH 找不到 openlogos；系统目录列表可由 OPENLOGOS_FPB_SMOKE_FALLBACK_DIRS 覆盖（仅供回归夹具）。
 * **自测模式**（须同时满足）：OPENLOGOS_FPB_SMOKE_SELF_TEST=1、OPENLOGOS_FPB_SMOKE_ENTRY（候选入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向**仓库之外**的独立账本；正式 smoke 上下文（OPENLOGOS_SMOKE_ENV / OPENLOGOS_SMOKE_MODULE 已注入）
 * 中拒绝自测（code-r1 F3）。自测跳过环境前置与版本下限，结果以 environment=self-test-injected-entry 写入、从不声明 target_environment；
 * 入口位于开发布局（cli/dist，无 claude-plugin-template）时，插件模板取仓内源模板 plugin/bin/openlogos-phase。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'fix-phase-banner-api-false-missing';
const OWNED = ['SMOKE-core-324', 'SMOKE-core-325'];
const MIN_VERSION = '0.16.19';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
// 子进程时限：规格上限 120 秒；OPENLOGOS_FPB_SMOKE_CHILD_TIMEOUT_MS 只能缩短（供回归夹具），不能放宽
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_FPB_SMOKE_CHILD_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 && v < 120_000 ? v : 120_000;
})();
const SOURCE_TEMPLATE = 'plugin/bin/openlogos-phase';
const PACKAGE_TEMPLATE = 'claude-plugin-template/bin/openlogos-phase';
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const API_STEP = 'Phase 3 Step 2: API & Database Design';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_FPB_SMOKE_SELF_TEST === '1';
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

if (!SELF_TEST && process.env.OPENLOGOS_FPB_SMOKE_ENTRY !== undefined) {
  refuse('设置了 OPENLOGOS_FPB_SMOKE_ENTRY 但未声明自测（OPENLOGOS_FPB_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && !process.env.OPENLOGOS_FPB_SMOKE_ENTRY) refuse('自测模式需要 OPENLOGOS_FPB_SMOKE_ENTRY');
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

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_FPB_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_FPB_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_FPB_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-fpb-${tag}-`)); scopes.push(d); return d; };

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
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_FPB_')) delete env[key];
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
/** 以 bash 子进程运行插件模板（--plain，时限 120 秒），经 childOk 判定成功后返回 Current Phase。 */
async function banner(template, root, pathValue) {
  const r = await runChild('bash', [template, '--plain'], { cwd: root, env: cleanEnv({ PATH: pathValue }) });
  const stdout = childOk('插件模板', r);
  const m = stdout.match(/Current Phase: (.*)/);
  if (!m) throw new Error(`插件模板未输出 Current Phase：${(r.stderr || stdout).slice(0, 300)}`);
  return m[1].trim();
}

/** 降级路径的隔离 bin 目录（code-r1 F4）：链接系统目录中除 openlogos 以外的命令，并验证找不到 openlogos。 */
function fallbackPath() {
  const dirs = (process.env.OPENLOGOS_FPB_SMOKE_FALLBACK_DIRS || SYSTEM_PATH).split(':').filter(Boolean);
  const bin = realpathSync(tempDir('fallback-bin'));
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) {
      if (name === 'openlogos' || existsSync(join(bin, name))) continue;
      try { symlinkSync(join(d, name), join(bin, name)); } catch { /* 同名已存在等，忽略 */ }
    }
  }
  const probe = spawnSync('/bin/sh', ['-c', 'command -v openlogos'], { encoding: 'utf8', env: { PATH: bin }, timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (probe.status === 0) throw new Error(`降级路径 PATH 仍能找到 openlogos：${probe.stdout.trim()}`);
  return bin;
}
/** 项目全部文件的字节快照，用于只读取证。 */
function snapshot(root) {
  const out = new Map();
  const walk = d => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs); else out.set(relative(root, abs), sha256(readFileSync(abs)));
    }
  };
  walk(root);
  return out;
}
const sameSnapshot = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/** 插件模板路径：安装包内的 claude-plugin-template；开发布局自测时取仓内源模板。 */
function templateOf(entryPath) {
  const pkg = packageRoot(entryPath);
  if (pkg && existsSync(join(pkg, PACKAGE_TEMPLATE))) return { path: join(pkg, PACKAGE_TEMPLATE), source: 'package' };
  if (SELF_TEST) return { path: join(repoRoot, SOURCE_TEMPLATE), source: 'repo-source(self-test)' };
  throw new Error(`安装包 ${pkg ?? '(未定位)'} 内缺少 ${PACKAGE_TEMPLATE}`);
}

const SCENARIO_COUNT = 30;
const SCEN = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
const API = 'logos/resources/api';
const ORCH = 'logos/resources/scenario';
const sid = i => `S${String(i).padStart(2, '0')}`;

/** 经被测 CLI init 建立的多模块项目：core launched（skip api/database/scenario），team initial；
 *  team 前序阶段齐全，测试用例 / 编排 / 验收目录不放文件。 */
async function multiModuleProject(entryPath) {
  const root = realpathSync(tempDir('proj'));
  await cli(entryPath, root, ['init', 'fpb-smoke', '--locale', 'zh', '--ai-tool', 'other']);
  const ids = Array.from({ length: SCENARIO_COUNT }, (_, i) => sid(i + 1));
  put(root, 'logos/logos-project.yaml', [
    'project:', '  name: "fpb-smoke"', '  description: ""',
    'modules:',
    '  - id: core', '    name: core', '    lifecycle: launched', '    skip_phases: [api, database, scenario]',
    '  - id: team', '    name: team', '    lifecycle: initial',
    'scenarios:', ...ids.flatMap(id => [`  - id: ${id}`, `    name: 场景 ${id}`, '    module: team']),
    'resource_index: []', '',
  ].join('\n'));
  rmSync(join(root, 'logos/.openlogos-guard'), { force: true });
  put(root, 'logos/resources/prd/1-product-requirements/team-01-requirements.md');
  put(root, 'logos/resources/prd/2-product-design/team-02-design.md');
  put(root, 'logos/resources/prd/3-technical-plan/1-architecture/team-03-architecture.md');
  for (const id of ids) put(root, `${SCEN}/team-${id}-flow.md`);
  for (const rel of ['logos/resources/test', ORCH, 'logos/resources/verify', 'logos/resources/database', API]) clearDir(root, rel);
  return root;
}

const CASES = {
  'SMOKE-core-324': async (entryPath) => {
    const problems = [];
    const evidence = [`entry_realpath=${entryPath}`];
    // ① 版本与入口
    const version = (await cli(entryPath, realpathSync(tempDir('ver')), ['--version'])).trim();
    const candidate = SELF_TEST ? version : DEPLOYED?.candidate_version;
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (!SELF_TEST) evidence.push(`deploy_id=${DEPLOYED?.deploy_id}`);
    if (version !== candidate) problems.push(`① --version 为 ${version}，本次成功部署回执的候选版本为 ${candidate}`);
    if (!SELF_TEST && !versionAtLeast(version, MIN_VERSION)) problems.push(`① --version ${version} 早于 ${MIN_VERSION}`);
    // ② payloadHash 自洽
    const pkg = packageRoot(entryPath);
    if (!pkg) throw new Error(`无法从 ${entryPath} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`package_root=${pkg}`, `payload_hash=${manifest.payloadHash}`);
    try {
      const lib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
      lib.validateAssetManifest(manifest, pkg);
    } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    // ③ 包内插件模板与仓内源模板逐字节一致，且 API 分支不再调用逐场景判定
    const tpl = templateOf(entryPath);
    const tplHash = sha256(readFileSync(tpl.path));
    const srcHash = sha256(readFileSync(join(repoRoot, SOURCE_TEMPLATE)));
    evidence.push(`template=${tpl.path}`, `template_source=${tpl.source}`, `template_sha256=${tplHash}`, `source_sha256=${srcHash}`);
    if (tplHash !== srcHash) problems.push(`③ 包内 ${PACKAGE_TEMPLATE} 与仓内 ${SOURCE_TEMPLATE} 不一致`);
    if (readFileSync(tpl.path, 'utf8').includes('check_scenarios_complete "$P_API"')) problems.push('③ 包内插件模板仍在 API 分支调用 check_scenarios_complete');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装态版本等于候选版本；payloadHash 自洽；包内插件模板与源模板一致且 API 分支不做逐场景判定', evidence };
  },

  'SMOKE-core-325': async (entryPath) => {
    const problems = [];
    const evidence = [];
    const tpl = templateOf(entryPath);
    const root = await multiModuleProject(entryPath);
    // status 路径：PATH 首位是一个只含被测 CLI 的 openlogos 包装（不依赖全局 PATH 中的其他命令）
    const binDir = realpathSync(tempDir('bin'));
    writeFileSync(join(binDir, 'openlogos'), `#!/bin/bash\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(entryPath)} "$@"\n`, { mode: 0o755 });
    const statusPath = `${binDir}:${dirname(process.execPath)}:${SYSTEM_PATH}`;
    const isolatedFallback = fallbackPath();
    evidence.push(`template=${tpl.path}`, `project=${root}`);
    const check = async (label, pathValue, expectFn) => {
      const before = snapshot(root);
      const phase = await banner(tpl.path, root, pathValue);
      const after = snapshot(root);
      evidence.push(`${label}: ${phase}`);
      if (phase.includes('missing')) problems.push(`${label} 横幅含 missing：${phase}`);
      const err = expectFn(phase);
      if (err) problems.push(`${label} ${err}`);
      if (!sameSnapshot(before, after)) problems.push(`${label} 模板运行前后项目文件发生变化`);
    };

    // ① 只有 team 按领域命名的 API 文件 → 通过 API 判定，确切到达 Database Design
    put(root, `${API}/team-auth.yaml`);
    put(root, `${API}/team-requirements.yaml`);
    await check('①', statusPath, p => (p === 'Phase 3 Step 2: Database Design' ? null : `期望 Phase 3 Step 2: Database Design，实际 ${p}`));

    // ② 只有其他模块的 API 文件 → 真实 status 中 team 的 phase.3-2-api 未完成未跳过，横幅指向 API（modules: team）
    clearDir(root, API);
    put(root, `${API}/core-auth.yaml`);
    const st = await cli(entryPath, root, ['status', '--format', 'json']);
    const line = st.split('\n').map(l => l.trim()).filter(l => l.startsWith('{')).pop();
    const team = line ? JSON.parse(line)?.data?.modules?.find(m => m?.id === 'team') : null;
    const api = team?.phase_progress?.['phase.3-2-api'];
    evidence.push(`②status: team phase.3-2-api=${JSON.stringify(api ?? null)}`);
    if (!(api && api.done === false && api.skipped === false)) problems.push(`② 真实 status 中 team 的 phase.3-2-api 不是 done=false, skipped=false：${JSON.stringify(api ?? null)}`);
    await check('②', statusPath, p => (p === `${API_STEP} (modules: team)` ? null : `期望 ${API_STEP} (modules: team)，实际 ${p}`));

    // ③ 清空 API 目录、降级路径（PATH 不含 openlogos）→ 不带后缀的 Step 2（未命中 SKIP_API）
    clearDir(root, API);
    await check('③', isolatedFallback, p => (p === API_STEP ? null : `期望 ${API_STEP}，实际 ${p}`));

    // ④ 对照臂：编排目录放更后置产物 → 命中向后看兜底，继续到 Step 3a（测试目录为空）
    put(root, `${ORCH}/team-refund-flow.json`, '{}\n');
    await check('④', isolatedFallback, p => (p === 'Phase 3 Step 3a: Test Cases' ? null : `期望 Phase 3 Step 3a: Test Cases，实际 ${p}`));

    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装包插件模板在四种 API 形态下横幅正确、均不含 missing，且运行前后项目文件不变', evidence };
  },
};

export const FIX_PHASE_BANNER_API_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of FIX_PHASE_BANNER_API_SMOKE_IDS) {
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
    entryPath = realpathSync(resolve(process.env.OPENLOGOS_FPB_SMOKE_ENTRY));
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
    for (const id of FIX_PHASE_BANNER_API_SMOKE_IDS) {
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

const failed = FIX_PHASE_BANNER_API_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${FIX_PHASE_BANNER_API_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
