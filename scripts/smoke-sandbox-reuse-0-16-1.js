#!/usr/bin/env node
/**
 * SMOKE-core-239～SMOKE-core-241 — 0.16.1 沙箱复用的**安装态**取证（verify-sandbox-reuse-0-16-1）。
 * 用例按切片逐个补入下方 CASES 表：本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口，
 * 不存在「声明了却没实现」的 ID。当前已实现：
 *   - SMOKE-core-240：安装态 verify 复用沙箱的增量收益与等长改写内容正确性（功能规格 §2.91，ST-S13-25 夹具口径）。
 *   - SMOKE-core-239：安装态版本与制品身份（版本取 cli/src/lib/local-release-candidate.ts，不写死字面量；包内含沙箱复用实现）。
 *   - SMOKE-core-241：安装态 verify --fresh-sandbox、smoke 共用持久沙箱、sandbox_reuse:false 与 sandbox_mode:off 回退。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目与一次性 sandbox_root 内，结束即删除（含持久沙箱项目目录）；
 * 只读本机全局安装态（不安装 / 卸载），不触碰本仓活跃提案、本仓 logos/resources/、本仓配置的沙箱根与用户其他仓库
 * （包括 runlogos）；命令图中不出现任何公网发布命令。判据用行为断言（`--format json` 结构化字段与命令实际输出），
 * 版本号相等只证明装了新包、不证明行为生效。
 *
 * 平台不可执行：在 Seatbelt 等嵌套沙箱内（如本 runner 被 `openlogos smoke` 以 sandbox-exec 包裹执行），setuid 的
 * /bin/ps 不可执行，CLI 按规格 §2.91.6 判 `unsupported` 并退回一次性沙箱——这是正确的安装态行为，但无法在此取证
 * 复用收益。此时用例写 `skip` + `reason_code:"platform-unavailable"` + 非空 detail（S19「平台不可执行例外」），
 * 不写 pass；缺候选、缺部署记录等可补齐的环境缺口不属此类。
 *
 * 判据分两档（沿既有 runner 形态）：
 * - **本案安装验收窗口**（活跃提案为本 slug，或 OPENLOGOS_SBR_SMOKE=1）：全局入口缺失、入口不在全局包目录内
 *   或行为不符，一律写 **fail** 并非零退出。
 * - **窗口之外**：本 runner 不适用，按既有留痕机制为全部 owned ID 写 skip（不标 platform-unavailable）。
 *
 * **正式安装态模式**（缺省）：只认 PATH 中 `openlogos` 且 realpath 位于 `npm prefix -g` 的全局包目录内。
 * **自测模式**（仅供 runner 自身验证，须同时满足）：OPENLOGOS_SBR_SMOKE_SELF_TEST=1、OPENLOGOS_SBR_SMOKE_ENTRY
 * 注入入口、OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync,
  utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'verify-sandbox-reuse-0-16-1';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const INJECTED_ENTRY = process.env.OPENLOGOS_SBR_SMOKE_ENTRY;
const SELF_TEST = process.env.OPENLOGOS_SBR_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;
const RESULT = 'logos/resources/verify/test-results.jsonl';

const run = (cmd, args, cwd = repoRoot) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: process.env });
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
/**
 * 在一次性项目里调用 CLI 时剥离外层 smoke 的账本与本 runner 的控制变量：否则夹具项目的 smoke runner 会把记录
 * 写进外层账本，污染正式证据。
 */
function isolatedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key.startsWith('OPENLOGOS_SBR_')) delete env[key];
  }
  return env;
}
const cliRaw = (entry, cwd, args) =>
  spawnSync(cliBin(entry), cliArgs(entry, args), { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: isolatedEnv() });

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-sbr-${tag}-`));
  scopes.push(dir);
  return dir;
}

function put(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** 一次性项目：经全局入口 init，再声明两条 UT 用例；sandbox_root 指向一次性目录。 */
function initProject(entry, tag, verify = {}) {
  const dir = newTempDir(tag);
  const sbx = newTempDir(`${tag}-sbx`);
  const init = cliRaw(entry, dir, ['init', '--locale', 'en', '--ai-tool', 'claude-code']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || '').slice(0, 300)}`);
  put(dir, 'logos/resources/test/core-S01-test-cases.md',
    '# S01\n\n| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n');
  setVerify(dir, { sandbox_mode: 'auto', sandbox_root: sbx, sandbox_deny_workspace_write: true, ...verify });
  return { dir, sbx };
}

function smokeJson(entry, dir, extra = []) {
  const r = cliRaw(entry, dir, ['smoke', ...extra, '--format', 'json']);
  let data = null;
  try { data = JSON.parse(r.stdout).data; } catch { throw new Error(`smoke 输出不是 JSON：${(r.stdout || r.stderr || '').slice(0, 300)}`); }
  return { status: r.status, gate: data?.gate?.result, sandbox: data?.sandbox ?? null, reuse: data?.sandbox?.reuse ?? null };
}

function setVerify(dir, verify) {
  const path = join(dir, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  cfg.verify = { ...(cfg.verify || {}), result_path: RESULT, ...verify };
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

/** 当前平台不可执行本用例（嵌套沙箱内复用按规格不可用）：记 skip + platform-unavailable，不记 pass / fail。 */
class PlatformUnavailable extends Error {}

/** 安装包根：入口向上找同时含 package.json 与 asset-manifest.json 的目录。 */
function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

/** 以 S19 夹具口径补齐 smoke 前置：活跃提案、部署决策、[deploy] 全勾、VERIFY_PASS / DEPLOY_DONE、smoke 用例与 runner。 */
function addSmokeFixture(dir, sandbox) {
  const slug = 'sbr-smoke-fixture';
  const proposal = `logos/changes/${slug}`;
  put(dir, 'logos/resources/test/smoke/core-smoke-test-cases.md', '| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  put(dir, `${proposal}/deltas/test/smoke/core-smoke-test-cases.md`, '## ADDED — 夹具 smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  put(dir, `${proposal}/proposal.md`, [
    '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：本地',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
  ].join('\n'));
  put(dir, `${proposal}/tasks.md`, '# 实现任务\n\n## [deploy] 发布\n- [x] 本机全局安装\n');
  put(dir, `${proposal}/VERIFY_PASS`, '');
  put(dir, `${proposal}/DEPLOY_DONE`, '');
  put(dir, 'logos/.openlogos-guard', JSON.stringify({ activeChange: slug, module: 'core' }));
  put(dir, 'logos/resources/verify/smoke-results.jsonl',
    `${JSON.stringify({ id: 'SMOKE-core-901', status: 'pass', timestamp: '2026-10-13T00:00:00.000Z' })}\n`);
  put(dir, 'scripts/smoke-sbr-fixture.mjs', [
    "import { appendFileSync, mkdirSync } from 'node:fs';",
    "import { dirname } from 'node:path';",
    "const p = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';",
    'mkdirSync(dirname(p), { recursive: true });',
    "appendFileSync(p, JSON.stringify({ id: 'SMOKE-core-901', status: 'pass', timestamp: new Date().toISOString() }) + '\\n');",
  ].join('\n'));
  const path = join(dir, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  cfg.smoke = {
    ...(cfg.smoke || {}), ...sandbox,
    result_path: 'logos/resources/verify/smoke-results.jsonl', command: 'node scripts/smoke-sbr-fixture.mjs',
  };
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

const PASS_LEDGER = ['UT-S01-01', 'UT-S01-02']
  .map(id => JSON.stringify({ id, status: 'pass', timestamp: '2026-10-13T00:00:00.000Z' })).join('\n') + '\n';

/** ST-S13-25 夹具口径的模拟增量编译器：按源内容哈希判定是否重编，输出编译数与指定源文件内容。 */
function compilerScript(watchFile) {
  return `
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
fs.mkdirSync('build-cache', { recursive: true });
let compiled = 0;
for (const name of fs.readdirSync('src').filter(n => n.endsWith('.c')).sort()) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join('src', name))).digest('hex');
  const obj = path.join('build-cache', name + '.o');
  if (fs.existsSync(obj) && fs.readFileSync(obj, 'utf8') === hash) continue;
  fs.writeFileSync(obj, hash);
  compiled++;
}
console.log('compiled=' + compiled);
console.log('watch=' + fs.readFileSync(${JSON.stringify(watchFile)}, 'utf8').trim());
fs.mkdirSync(path.dirname(${JSON.stringify(RESULT)}), { recursive: true });
fs.writeFileSync(${JSON.stringify(RESULT)}, ${JSON.stringify(PASS_LEDGER)});
`;
}

function verifyJson(entry, dir, extra = []) {
  const r = cliRaw(entry, dir, ['verify', ...extra, '--format', 'json']);
  let data = null;
  try { data = JSON.parse(r.stdout).data; } catch { throw new Error(`verify 输出不是 JSON：${(r.stdout || r.stderr || '').slice(0, 300)}`); }
  const tail = data?.pre_run?.commands?.[0]?.stdout_tail ?? '';
  return {
    status: r.status,
    gate: data?.gate?.result,
    reuse: data?.sandbox?.reuse ?? null,
    infos: data?.sandbox?.infos ?? [],
    sandbox: data?.sandbox ?? null,
    compiled: /compiled=(\d+)/.exec(tail)?.[1] ?? null,
    watch: /watch=(.*)/.exec(tail)?.[1] ?? null,
  };
}

/**
 * 每个用例：(entry) => { detail, evidence }，失败抛错。后续切片按同一形态补入 SMOKE-core-239 / 241。
 */
const CASES = {
  'SMOKE-core-240': (entry) => {
    const { dir } = initProject(entry, 'reuse', { sandbox_cache_paths: ['build-cache'] });
    for (let i = 1; i <= 20; i += 1) put(dir, `src/m${i}.c`, `int m${i}(void) { return ${String(i).padStart(3, '0')}; }\n`);
    put(dir, 'tools/compile.js', compilerScript('src/m3.c'));
    setVerify(dir, { pre_run_command: 'node tools/compile.js' });
    const problems = [];
    const evidence = [];
    const expectRun = (label, r, compiled, state) => {
      evidence.push(`${label}: gate=${r.gate} compiled=${r.compiled} state=${r.reuse?.state} dir=${r.reuse?.dir}`);
      if (r.gate !== 'PASS') problems.push(`${label} gate 应为 PASS，实际 ${r.gate}`);
      if (r.compiled !== compiled) problems.push(`${label} 应 compiled=${compiled}，实际 ${r.compiled}`);
      if (r.reuse?.state !== state) problems.push(`${label} reuse.state 应为 ${state}，实际 ${r.reuse?.state ?? '缺失'}`);
    };
    const r1 = verifyJson(entry, dir);
    if (r1.reuse?.state === 'unsupported') {
      throw new PlatformUnavailable(`当前执行环境无法复用沙箱（CLI 判 unsupported，常见于 Seatbelt 嵌套沙箱内 setuid ps 不可执行）：${r1.infos.join(' ')}`.slice(0, 500));
    }
    expectRun('①', r1, '20', 'created');
    writeFileSync(join(dir, 'src/m7.c'), 'int m7(void) { return 700; }\n');
    const r2 = verifyJson(entry, dir);
    expectRun('②', r2, '1', 'reused');
    const r3 = verifyJson(entry, dir);
    expectRun('③', r3, '0', 'reused');
    // ④ 另一个源文件等长改写并以 utimes 恢复原 mtime：仅凭大小 + mtime 的同步会漏掉它
    const m3 = join(dir, 'src/m3.c');
    const before = statSync(m3);
    const rewritten = 'int m3(void) { return 333; }';
    writeFileSync(m3, `${rewritten}\n`);
    if (statSync(m3).size !== before.size) problems.push('④ 夹具自检失败：改写后长度应与原文件相同');
    utimesSync(m3, before.atime, before.mtime);
    const r4 = verifyJson(entry, dir);
    expectRun('④', r4, '1', 'reused');
    if (r4.watch !== rewritten) problems.push(`④ 命令应读到等长改写后的新内容「${rewritten}」，实际「${r4.watch}」`);
    const dirs = new Set([r1, r2, r3, r4].map(r => r.reuse?.dir));
    if (dirs.size !== 1) problems.push(`四次 reuse.dir 应相同，实际 ${[...dirs].join(' / ')}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '复用沙箱只重编改动文件（20 → 1 → 0），等长改写并恢复 mtime 的源文件被正确同步', evidence };
  },

  'SMOKE-core-239': async (entry) => {
    const problems = [];
    const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
    const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
    const candidate = /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null;
    if (!candidate) throw new Error(`无法读取候选版本（${src} 缺失或无 LOCAL_RELEASE_CANDIDATE_VERSION）`);
    const version = (cliRaw(entry, repoRoot, ['--version']).stdout || '').trim();
    if (version !== candidate) problems.push(`--version 为 ${version}，部署记录候选版本为 ${candidate}`);
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    if (manifest.version !== version) problems.push(`asset-manifest version ${manifest.version} 与 --version ${version} 不一致`);
    const assetLib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
    try { assetLib.validateAssetManifest(manifest, pkg); } catch (e) { problems.push(`asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    // 沙箱复用实现：dist/lib/sandbox.js 引入 sandbox-reuse.js，后者承载持久目录前缀与同步清单
    const sandboxJs = join(pkg, 'dist/lib/sandbox.js');
    const reuseJs = join(pkg, 'dist/lib/sandbox-reuse.js');
    if (!existsSync(sandboxJs)) problems.push('包内缺少 dist/lib/sandbox.js');
    else if (!readFileSync(sandboxJs, 'utf8').includes('./sandbox-reuse.js')) problems.push('包内 dist/lib/sandbox.js 未引入 sandbox-reuse.js');
    if (!existsSync(reuseJs)) problems.push('包内缺少 dist/lib/sandbox-reuse.js');
    else {
      const body = readFileSync(reuseJs, 'utf8');
      for (const needle of ['openlogos-cli-sandbox-reuse-', 'sync-manifest.json']) {
        if (!body.includes(needle)) problems.push(`包内 dist/lib/sandbox-reuse.js 不含 ${needle}`);
      }
    }
    const indexJs = join(pkg, 'dist/index.js');
    if (!existsSync(indexJs) || !readFileSync(indexJs, 'utf8').includes('--fresh-sandbox')) problems.push('包内 dist/index.js 未注册 --fresh-sandbox');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `安装态身份同源（${version}）：manifest 自洽，包内 sandbox.js 经 sandbox-reuse.js 实现持久沙箱与同步清单，index.js 注册 --fresh-sandbox`,
      evidence: [`package_root=${pkg}`, `version=${version}`, `payload_hash=${manifest.payloadHash}`],
    };
  },

  'SMOKE-core-241': (entry) => {
    const { dir, sbx } = initProject(entry, 'fallback', { sandbox_cache_paths: ['build-cache'] });
    for (let i = 1; i <= 20; i += 1) put(dir, `src/m${i}.c`, `int m${i}(void) { return ${i}; }\n`);
    put(dir, 'tools/compile.js', compilerScript('src/m1.c'));
    setVerify(dir, { pre_run_command: 'node tools/compile.js' });
    addSmokeFixture(dir, { sandbox_mode: 'auto', sandbox_root: sbx, sandbox_deny_workspace_write: true, sandbox_cache_paths: ['build-cache'] });
    const problems = [];
    const evidence = [];
    const warm = verifyJson(entry, dir);
    if (warm.reuse?.state === 'unsupported') {
      throw new PlatformUnavailable(`当前执行环境无法复用沙箱（CLI 判 unsupported，常见于 Seatbelt 嵌套沙箱内 setuid ps 不可执行）：${warm.infos.join(' ')}`.slice(0, 500));
    }
    // ① verify --fresh-sandbox：新建世代，缓存从空开始 → 全量重编
    const fresh = verifyJson(entry, dir, ['--fresh-sandbox']);
    evidence.push(`①: state=${fresh.reuse?.state} compiled=${fresh.compiled} gen=${fresh.reuse?.generation}`);
    if (fresh.reuse?.state !== 'fresh') problems.push(`① reuse.state 应为 fresh，实际 ${fresh.reuse?.state ?? '缺失'}`);
    if (fresh.compiled !== '20') problems.push(`① 应 compiled=20，实际 ${fresh.compiled}`);
    // ② smoke：与 verify 共用同一持久沙箱
    const sm = smokeJson(entry, dir);
    evidence.push(`②: smoke gate=${sm.gate} state=${sm.reuse?.state} dir=${sm.reuse?.dir}`);
    if (sm.reuse?.dir !== fresh.reuse?.dir) problems.push(`② smoke reuse.dir 应与 ① 相同，实际 ${sm.reuse?.dir} / ${fresh.reuse?.dir}`);
    if (sm.reuse?.state !== 'reused') problems.push(`② smoke reuse.state 应为 reused，实际 ${sm.reuse?.state ?? '缺失'}`);
    if (sm.gate !== 'PASS') problems.push(`② smoke gate 应为 PASS，实际 ${sm.gate}`);
    // ③ sandbox_reuse:false：一次性沙箱，全量重编，临时目录运行后删除
    setVerify(dir, { sandbox_reuse: false });
    const off1 = verifyJson(entry, dir);
    evidence.push(`③: state=${off1.reuse?.state} compiled=${off1.compiled} root=${off1.sandbox?.root}`);
    if (off1.reuse?.state !== 'disabled') problems.push(`③ reuse.state 应为 disabled，实际 ${off1.reuse?.state ?? '缺失'}`);
    if (off1.compiled !== '20') problems.push(`③ 应 compiled=20，实际 ${off1.compiled}`);
    if (off1.sandbox?.root && existsSync(off1.sandbox.root)) problems.push(`③ 一次性沙箱目录运行后仍存在：${off1.sandbox.root}`);
    // ④ sandbox_mode:off：不出现 reuse
    setVerify(dir, { sandbox_mode: 'off' });
    const off2 = verifyJson(entry, dir);
    evidence.push(`④: reuse=${off2.sandbox && 'reuse' in off2.sandbox ? 'present' : 'absent'} gate=${off2.gate}`);
    if (!off2.sandbox || 'reuse' in off2.sandbox) problems.push('④ sandbox_mode=off 时不应出现 sandbox.reuse');
    for (const [label, r] of [['①', fresh], ['③', off1], ['④', off2]]) {
      if (r.gate !== 'PASS') problems.push(`${label} verify gate 应为 PASS，实际 ${r.gate}`);
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '--fresh-sandbox 重建、smoke 共用持久沙箱、sandbox_reuse:false 与 sandbox_mode:off 回退均符合预期', evidence };
  },
};

export const SBR_SMOKE_IDS = Object.keys(CASES);

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: SBR_SMOKE_IDS,
    environment: FORMAL_ENVIRONMENT,
    self_test_environment: SELF_TEST_ENVIRONMENT,
    applies_when: [`active change == ${SLUG}`, 'OPENLOGOS_SBR_SMOKE=1'],
    public_release_commands: [],
  }));
  process.exit(0);
}

function refuse(reason) {
  console.error(`smoke runner 拒绝运行（未写入任何结果）：${reason}`);
  process.exit(2);
}

function formalResultPath() {
  let configured = null;
  try {
    configured = JSON.parse(readFileSync(join(repoRoot, 'logos/logos.config.json'), 'utf8')).smoke?.result_path ?? null;
  } catch { /* 用缺省 */ }
  return resolve(repoRoot, configured || 'logos/resources/verify/smoke-results.jsonl');
}

if (INJECTED_ENTRY !== undefined && !SELF_TEST) refuse('设置了 OPENLOGOS_SBR_SMOKE_ENTRY 但未声明自测（OPENLOGOS_SBR_SMOKE_SELF_TEST=1）');
if (SELF_TEST && INJECTED_ENTRY === undefined) refuse('自测模式需要 OPENLOGOS_SBR_SMOKE_ENTRY 指定注入入口');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_SBR_SMOKE !== '1') {
  exitNotApplicable(SBR_SMOKE_IDS, {
    reason: `非本案安装验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_SBR_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_SBR_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of SBR_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT,
      ...(row.reason_code ? { reason_code: row.reason_code } : {}),
      detail: row.detail, evidence: row.evidence,
    })}\n`);
  }
}

function commandLookup() {
  if (SELF_TEST) return existsSync(INJECTED_ENTRY) ? realpathSync(INJECTED_ENTRY) : null;
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-c', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}

/** 正式模式：入口 realpath 必须在全局 npm prefix 的包目录内（排除 workspace link 与一次性隔离 prefix）。 */
function globalInstallProblem(entryPath) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = run(npm, ['prefix', '-g']);
  if (r.status !== 0 || !r.stdout.trim()) return `无法读取 npm prefix -g：${(r.stderr || '').slice(0, 200)}`;
  const prefix = realpathSync(r.stdout.trim());
  const nodeModules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  const pkgDir = join(nodeModules, '@miniidealab', 'openlogos');
  const within = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  if (lstatSync(pkgDir).isSymbolicLink()) return `全局包目录 ${pkgDir} 是链接（workspace link 不构成安装态证据）`;
  const realPkgDir = realpathSync(pkgDir);
  if (!within(realpathSync(nodeModules), realPkgDir)) return `全局包目录 ${pkgDir} 解引用后离开全局 node_modules 区域`;
  if (!within(realPkgDir, entryPath)) return `入口 ${entryPath} 不在全局 npm prefix 的包目录 ${pkgDir} 内`;
  if (within(repoRoot, entryPath)) return `入口 ${entryPath} 位于工作区 ${repoRoot} 内`;
  return null;
}

let exitCode = 0;
try {
  const entry = commandLookup();
  const problem = !entry ? '找不到 openlogos 入口' : (SELF_TEST ? null : globalInstallProblem(entry));
  if (problem) {
    for (const id of SBR_SMOKE_IDS) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
  } else {
    for (const id of SBR_SMOKE_IDS) {
      const started = Date.now();
      try {
        const { detail, evidence } = await CASES[id](entry);
        results.set(id, { status: 'pass', detail, evidence: [`entry=${entry}`, ...evidence], duration_ms: Date.now() - started });
      } catch (error) {
        if (error instanceof PlatformUnavailable) {
          results.set(id, {
            status: 'skip', reason_code: 'platform-unavailable', detail: error.message,
            evidence: [`entry=${entry}`], duration_ms: Date.now() - started,
          });
          continue;
        }
        results.set(id, {
          status: 'fail', detail: error instanceof Error ? error.message : String(error),
          evidence: [`entry=${entry}`], duration_ms: Date.now() - started,
        });
      }
    }
  }
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = SBR_SMOKE_IDS.filter(id => !['pass', 'skip'].includes(results.get(id)?.status));
const platformSkipped = SBR_SMOKE_IDS.filter(id => results.get(id)?.status === 'skip');
for (const id of platformSkipped) console.log(`smoke 平台不可执行（skip）：${id}：${results.get(id)?.detail}`);
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${SBR_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
