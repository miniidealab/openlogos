#!/usr/bin/env node
/**
 * SMOKE-core-242～SMOKE-core-245 — 0.16.1 公开发布（release-0-16-1）的**公网制品**取证。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.1 公开发布 smoke（SMOKE-core-242～245）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.1 公开发布方案（npm / GitHub Release / 官网）」。
 * 判据沿用 scripts/smoke-public-release-0-16-0.js（SMOKE-core-231～234），该 runner 的分派与适用窗口不变。
 *
 *   - SMOKE-core-242：registry 发布身份与 provenance，包内含沙箱复用实现（含 SMOKE-core-04 口径：插件模板随包）。
 *   - SMOKE-core-243：registry 隔离安装态可用（含 SMOKE-core-01 / 02 口径），并按 SMOKE-core-240 口径检查沙箱复用增量。
 *   - SMOKE-core-244：GitHub Release 与 registry 同源，正文含沙箱复用说明与「从 0.16.0 升级」指引、不含「未发布到 npm」。
 *   - SMOKE-core-245：官网 latest 等于 V、V 的英文摘要在场（含 SMOKE-core-07 / 08 / 15 口径）。
 *
 * **版本口径**：V 与 tag 提交号从部署记录 logos/resources/verify/deployment-report.md 中**标题含 `release-0-16-1`
 * 的那一节**的 `public_release_version: <V>` / `public_release_commit: <sha>` 两行读取（同文件 0.16.0 节的同名行
 * 不得被误读）；提交号缺省时取 `git rev-parse v<V>^{commit}`。断言全部写成关系式，不硬编码版本号。
 *
 * **执行边界**：公网只读；安装态只装到 `mktemp -d` 一次性 prefix 与一次性 sandbox_root，结束即删除。网络不可达、
 * `gh` 未认证、缺 V 属可补齐的环境缺口：写显式 skip（不标 platform-unavailable）。`platform-unavailable` 只用于
 * SMOKE-core-243 的沙箱复用检查在 Seatbelt 等嵌套沙箱内得到 `unsupported` 的情形（①～④ 须已通过）。
 *
 * **窗口**：活跃提案为本 slug，或 OPENLOGOS_PR161_SMOKE=1；窗口之外按既有留痕机制为全部 owned ID 写 skip。
 *
 * **自测模式**（须同时满足）：OPENLOGOS_PR161_SELF_TEST=1、OPENLOGOS_PR161_FIXTURE=<夹具目录>、
 * OPENLOGOS_PR161_SITE=<本地预览 URL>，且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本。夹具目录结构与
 * 0.16.0 runner 相同：release.json、npm-dist-tags.json、npm-view.json、npm-attestations.json、package.tgz、
 * gh-release.json、gh-latest.txt、gh-assets/。正式模式拒绝注入；结果以 environment=self-test-fixture 写入。
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';
import {
  entryCommand, entryIdentityProblems, installedLayout, processProblem, provenanceSourceProblems, statusEnvelopeProblems,
} from './lib/public-release-checks.mjs';

const SLUG = 'release-0-16-1';
const PKG = '@miniidealab/openlogos';
const REPO = 'miniidealab/openlogos';
const DEFAULT_SITE = 'https://openlogos.ai';
const OWNED = ['SMOKE-core-242', 'SMOKE-core-243', 'SMOKE-core-244', 'SMOKE-core-245'];
const FALLBACK_MESSAGE = 'Structured release summary unavailable for this version.';
const REFERENCE_DIRS = ['requirement', 'todolist', 'code', 'image', 'temp', 'note'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_PR161_SELF_TEST === '1';
const FIXTURE = process.env.OPENLOGOS_PR161_FIXTURE;
const SITE_OVERRIDE = process.env.OPENLOGOS_PR161_SITE;
const ENVIRONMENT = SELF_TEST ? 'self-test-fixture' : 'public-registry-github-site';
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

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

if (!SELF_TEST && (FIXTURE !== undefined || SITE_OVERRIDE !== undefined)) {
  refuse('设置了 OPENLOGOS_PR161_FIXTURE / _SITE 但未声明自测（OPENLOGOS_PR161_SELF_TEST=1）');
}
if (SELF_TEST && (!FIXTURE || !SITE_OVERRIDE)) refuse('自测模式需要同时提供 OPENLOGOS_PR161_FIXTURE 与 OPENLOGOS_PR161_SITE');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_PR161_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案公开发布验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_PR161_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_PR161_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

// ── 通用工具 ───────────────────────────────────────────────────────────────────

/** 环境缺口：写 skip 而非 fail。 */
class EnvGap extends Error {
  constructor(message, missing) { super(message); this.missing = missing; }
}

/** 当前平台不可执行（仅 SMOKE-core-243 的沙箱复用检查在嵌套沙箱内）：skip + reason_code platform-unavailable。 */
class PlatformUnavailable extends Error {}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, {
  cwd: opts.cwd ?? repoRoot, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: opts.env ?? isolatedEnv(),
});

/** 子命令剥离外层 smoke 账本与本 runner 的控制变量，避免夹具项目把记录写进外层账本。 */
function isolatedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key.startsWith('OPENLOGOS_PR161_') || key.startsWith('OPENLOGOS_PUBLIC_RELEASE_')) delete env[key];
  }
  return env;
}

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-pr161-${tag}-`));
  scopes.push(dir);
  return dir;
}

const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const tail = text => String(text || '').trim().slice(-300);

/** npm / gh 的网络类失败归为环境缺口，其余（如 E404）按真实失败处理。 */
function networkLike(text) {
  return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|network|getaddrinfo|socket hang up/i.test(String(text || ''));
}

function fixturePath(rel) {
  return join(FIXTURE, rel);
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ── 数据源（正式：公网只读；自测：夹具）────────────────────────────────────────

function releaseIdentity() {
  if (SELF_TEST) {
    const rel = readJsonFile(fixturePath('release.json'));
    return { version: rel.version, commit: rel.commit };
  }
  const reportPath = join(repoRoot, 'logos/resources/verify/deployment-report.md');
  const report = sectionForSlug(existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '', SLUG);
  if (!report) throw new EnvGap(`部署记录缺少标题含 ${SLUG} 的一节`, [`deployment-report:section:${SLUG}`]);
  const version = /public_release_version:\s*`?(\d+\.\d+\.\d+)`?/.exec(report)?.[1] ?? null;
  if (!version) throw new EnvGap(`部署记录 ${SLUG} 一节缺少 \`public_release_version: <V>\` 行`, ['deployment-report:public_release_version']);
  let commit = /public_release_commit:\s*`?([0-9a-f]{7,40})`?/.exec(report)?.[1] ?? null;
  if (!commit) {
    const r = run('git', ['rev-parse', `v${version}^{commit}`]);
    if (r.status !== 0) throw new EnvGap(`无法解析 v${version} 指向的提交：${tail(r.stderr)}`, [`git-tag:v${version}`]);
    commit = r.stdout.trim();
  } else {
    const r = run('git', ['rev-parse', `${commit}^{commit}`]);
    if (r.status !== 0) throw new EnvGap(`本地仓库找不到提交 ${commit}`, [`git-commit:${commit}`]);
    commit = r.stdout.trim();
  }
  return { version, commit };
}

/** 部署记录中标题（`# `）含 slug 的那一节，直到下一个一级标题；没有则返回 null。 */
function sectionForSlug(report, slug) {
  const lines = report.split('\n');
  const start = lines.findIndex(line => line.startsWith('# ') && line.includes(slug));
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && line.startsWith('# '));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

function npmJson(args) {
  const r = run(npmBin, args);
  if (r.status !== 0) {
    if (networkLike(r.stderr)) throw new EnvGap(`npm 网络不可达：${tail(r.stderr)}`, ['network:npm-registry']);
    throw new Error(`npm ${args.join(' ')} 失败：${tail(r.stderr)}`);
  }
  return JSON.parse(r.stdout);
}

function npmDistTags() {
  return SELF_TEST ? readJsonFile(fixturePath('npm-dist-tags.json')) : npmJson(['view', PKG, 'dist-tags', '--json']);
}

function npmVersionView(version) {
  if (SELF_TEST) return readJsonFile(fixturePath('npm-view.json'));
  return npmJson(['view', `${PKG}@${version}`, 'version', 'gitHead', 'dist.integrity', 'dist.attestations', '--json']);
}

/** `dist.attestations.url` 指向的证明 JSON（自测：夹具 npm-attestations.json）。 */
async function npmAttestations(view) {
  if (SELF_TEST) return readJsonFile(fixturePath('npm-attestations.json'));
  const url = view['dist.attestations']?.url;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    throw new EnvGap(`provenance 证明不可达：${url}（${error instanceof Error ? error.message : String(error)}）`, ['network:npm-attestations']);
  }
}

/** 取得 registry tarball 到 dir，返回路径。 */
function fetchRegistryTarball(version, dir) {
  const target = join(dir, `miniidealab-openlogos-${version}.tgz`);
  if (SELF_TEST) {
    copyFileSync(fixturePath('package.tgz'), target);
    return target;
  }
  const r = run(npmBin, ['pack', `${PKG}@${version}`, '--pack-destination', dir, '--json']);
  if (r.status !== 0) {
    if (networkLike(r.stderr)) throw new EnvGap(`npm 网络不可达：${tail(r.stderr)}`, ['network:npm-registry']);
    throw new Error(`npm pack ${PKG}@${version} 失败：${tail(r.stderr)}`);
  }
  const name = JSON.parse(r.stdout)[0]?.filename;
  const path = name ? join(dir, name.replace(/^@miniidealab\//, 'miniidealab-').replace(/\//g, '-')) : null;
  if (path && existsSync(path)) return path;
  const found = readdirSync(dir).find(file => file.endsWith('.tgz'));
  if (!found) throw new Error('npm pack 未产出 tarball');
  return join(dir, found);
}

function installSpec(version, tarballPath) {
  return SELF_TEST ? tarballPath : `${PKG}@${version}`;
}

function ghAuthGap() {
  if (SELF_TEST) return null;
  const r = run('gh', ['auth', 'status']);
  if (r.error) return new EnvGap('未安装 gh CLI', ['gh-cli']);
  if (r.status !== 0) return new EnvGap(`gh 未认证：${tail(r.stderr)}`, ['gh-auth']);
  return null;
}

function ghReleaseView(version) {
  if (SELF_TEST) return readJsonFile(fixturePath('gh-release.json'));
  const r = run('gh', ['release', 'view', `v${version}`, '--repo', REPO, '--json', 'tagName,isDraft,isPrerelease,body,assets']);
  if (r.status !== 0) {
    if (networkLike(r.stderr)) throw new EnvGap(`GitHub 网络不可达：${tail(r.stderr)}`, ['network:github']);
    throw new Error(`gh release view v${version} 失败：${tail(r.stderr)}`);
  }
  return JSON.parse(r.stdout);
}

function ghLatestTag() {
  if (SELF_TEST) return readFileSync(fixturePath('gh-latest.txt'), 'utf8').trim();
  const r = run('gh', ['api', `repos/${REPO}/releases/latest`, '--jq', '.tag_name']);
  if (r.status !== 0) {
    if (networkLike(r.stderr)) throw new EnvGap(`GitHub 网络不可达：${tail(r.stderr)}`, ['network:github']);
    throw new Error(`gh api releases/latest 失败：${tail(r.stderr)}`);
  }
  return r.stdout.trim();
}

function ghDownloadAssets(version, dir) {
  if (SELF_TEST) {
    const src = fixturePath('gh-assets');
    for (const file of existsSync(src) ? readdirSync(src) : []) {
      if (/^miniidealab-openlogos-.*\.tgz$/.test(file)) copyFileSync(join(src, file), join(dir, file));
    }
  } else {
    const r = run('gh', ['release', 'download', `v${version}`, '--repo', REPO, '--pattern', 'miniidealab-openlogos-*.tgz', '--dir', dir]);
    if (r.status !== 0) {
      if (networkLike(r.stderr)) throw new EnvGap(`GitHub 网络不可达：${tail(r.stderr)}`, ['network:github']);
      throw new Error(`gh release download v${version} 失败：${tail(r.stderr)}`);
    }
  }
  return readdirSync(dir).filter(file => file.endsWith('.tgz'));
}

/** 读取发布提交（或自测的工作区）中的文件文本。 */
function fileAtCommit(commit, rel) {
  if (commit === 'WORKTREE') return readFileSync(join(repoRoot, rel), 'utf8');
  const r = run('git', ['show', `${commit}:${rel}`]);
  if (r.status !== 0) throw new Error(`git show ${commit}:${rel} 失败：${tail(r.stderr)}`);
  return r.stdout;
}

/** 发布提交中 cli/src 下的文件清单（相对 cli/src）。 */
function sourceFilesAtCommit(commit) {
  if (commit === 'WORKTREE') {
    const out = [];
    const walk = dir => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else out.push(relative(join(repoRoot, 'cli/src'), full).split('\\').join('/'));
      }
    };
    walk(join(repoRoot, 'cli/src'));
    return new Set(out);
  }
  const r = run('git', ['ls-tree', '-r', '--name-only', commit, '--', 'cli/src']);
  if (r.status !== 0) throw new Error(`git ls-tree ${commit} 失败：${tail(r.stderr)}`);
  return new Set(r.stdout.split('\n').filter(Boolean).map(line => line.slice('cli/src/'.length)));
}

/** publish.yml「Prepare release notes」同规则：截取 `## [V]` 起到下一个 `\n## [` 之前。 */
function releaseNotesFromChangelog(changelog, version) {
  const header = `## [${version}]`;
  const start = changelog.indexOf(header);
  if (start === -1) return null;
  const next = changelog.indexOf('\n## [', start + header.length);
  return `${(next === -1 ? changelog.slice(start) : changelog.slice(start, next)).trim()}\n`;
}

async function httpGet(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const contentType = res.headers.get('content-type') || '';
    const body = contentType.startsWith('image/') ? '' : await res.text();
    return { status: res.status, contentType, body };
  } catch (error) {
    throw new EnvGap(`官网不可达：${url}（${error instanceof Error ? error.message : String(error)}）`, ['network:site']);
  }
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(relative(base, full).split('\\').join('/'));
  }
  return out;
}

// ── 共享上下文：V、提交号、registry tarball ─────────────────────────────────────

const ctx = { identity: null, registry: null };

function registryTarball() {
  if (ctx.registry) return ctx.registry;
  const { version } = ctx.identity;
  const dir = newTempDir('registry');
  const tarball = fetchRegistryTarball(version, dir);
  const extractDir = join(dir, 'x');
  mkdirSync(extractDir);
  const x = run('tar', ['-xzf', tarball, '-C', extractDir]);
  if (x.status !== 0) throw new Error(`解包 registry tarball 失败：${tail(x.stderr)}`);
  ctx.registry = { tarball, sha256: fileSha(tarball), pkgDir: join(extractDir, 'package') };
  return ctx.registry;
}

const PASS_LEDGER = ['UT-S01-01', 'UT-S01-02']
  .map(id => JSON.stringify({ id, status: 'pass', timestamp: '2026-10-13T00:00:00.000Z' })).join('\n') + '\n';

/** ST-S13-25 / SMOKE-core-240 夹具口径的模拟增量编译器：按源内容哈希判定是否重编，输出编译数。 */
const COMPILER = `
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
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', ${JSON.stringify(PASS_LEDGER)});
`;

/** 经安装入口在一次性项目里连续 verify 两次（中间改 1 个源文件），返回复用状态与编译数。 */
function reuseIncrementalCheck(cli) {
  const dir = newTempDir('reuse');
  const sbx = newTempDir('reuse-sbx');
  const put = (rel, content) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), content); };
  const init = cli(dir, ['init', '--locale', 'en', '--ai-tool', 'claude-code']);
  if (init.status !== 0) return { problems: [`init 失败：exit ${init.status}`], summary: 'init-failed', unsupported: false };
  put('logos/resources/test/core-S01-test-cases.md', '# S01\n\n| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n');
  for (let i = 1; i <= 20; i += 1) put(`src/m${i}.c`, `int m${i}(void) { return ${i}; }\n`);
  put('tools/compile.js', COMPILER);
  const cfgPath = join(dir, 'logos/logos.config.json');
  const cfg = readJsonFile(cfgPath);
  cfg.verify = { ...(cfg.verify || {}), result_path: 'logos/resources/verify/test-results.jsonl', pre_run_command: 'node tools/compile.js',
    sandbox_mode: 'auto', sandbox_root: sbx, sandbox_deny_workspace_write: true, sandbox_cache_paths: ['build-cache'] };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const once = () => {
    const r = cli(dir, ['verify', '--format', 'json']);
    let data = null;
    try { data = JSON.parse(r.stdout).data; } catch { /* 下方按缺失处理 */ }
    const tailText = data?.pre_run?.commands?.[0]?.stdout_tail ?? '';
    return { gate: data?.gate?.result ?? null, state: data?.sandbox?.reuse?.state ?? null, compiled: /compiled=(\d+)/.exec(tailText)?.[1] ?? null };
  };
  const first = once();
  if (first.state === 'unsupported') return { problems: [], summary: `first=${JSON.stringify(first)}`, unsupported: true };
  writeFileSync(join(dir, 'src/m7.c'), 'int m7(void) { return 700; }\n');
  const second = once();
  const summary = `first=${JSON.stringify(first)} second=${JSON.stringify(second)}`;
  const problems = [];
  if (first.gate !== 'PASS' || second.gate !== 'PASS') problems.push('verify gate 应两次 PASS');
  if (first.state !== 'created' || second.state !== 'reused') problems.push('sandbox.reuse.state 应依次为 created / reused');
  if (first.compiled !== '20' || second.compiled !== '1') problems.push('compiled 应依次为 20 / 1');
  return { problems, summary, unsupported: false };
}

// ── 用例 ─────────────────────────────────────────────────────────────────────

const CASES = {
  'SMOKE-core-242': async () => {
    const { version, commit } = ctx.identity;
    const problems = [];
    const tags = npmDistTags();
    if (tags.latest !== version) problems.push(`① dist-tags.latest=${tags.latest}，应为 V=${version}`);
    if (tags.old === version) problems.push('① old dist-tag 被移到了 V');
    const view = npmVersionView(version);
    if (view.version !== version) problems.push(`② version=${view.version}，应为 ${version}`);
    // 来源提交以 SLSA provenance 为准：tarball 发布不写 gitHead；gitHead 存在时须同样相等（release-0-16-0 增量修正）
    if (view.gitHead && view.gitHead !== commit) problems.push(`② gitHead=${view.gitHead}，应为 v${version} 提交 ${commit}`);
    const attestations = await npmAttestations(view);
    if (!attestations) problems.push('② dist.attestations 缺失（provenance 不可查）');
    else for (const p of provenanceSourceProblems(attestations, { repo: REPO, version, commit })) problems.push(`② ${p}`);
    const reg = registryTarball();
    const pkg = reg.pkgDir;
    const pkgJson = readJsonFile(join(pkg, 'package.json'));
    if (pkgJson.version !== version) problems.push(`③ 包内 package.json 版本 ${pkgJson.version} ≠ V`);
    const manifest = readJsonFile(join(pkg, 'asset-manifest.json'));
    if (manifest.version !== version) problems.push(`③ asset-manifest 版本 ${manifest.version} ≠ V`);
    try {
      const assetLib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
      assetLib.validateAssetManifest(manifest, pkg);
    } catch (e) { problems.push(`③ asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    const guardEntry = ['skills', 'templates', 'schemas', 'plugins'].flatMap(k => manifest[k] ?? [])
      .find(a => a.path === 'claude-plugin-template/bin/guard-check');
    const guardFile = join(pkg, 'claude-plugin-template/bin/guard-check');
    if (!guardEntry || !existsSync(guardFile)) problems.push('③ 缺随包 guard 模板或其 manifest 条目');
    else if (fileSha(guardFile) !== guardEntry.sha256) problems.push('③ 随包 guard 模板 SHA-256 ≠ manifest 条目');
    const sources = sourceFilesAtCommit(commit);
    const orphans = walkFiles(join(pkg, 'dist')).filter(f => f.endsWith('.js'))
      .filter(f => !sources.has(f.replace(/\.js$/, '.ts')));
    if (orphans.length > 0) problems.push(`④ dist 中无源文件的产物：${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? ' …' : ''}`);
    // 0.16.1 能力：沙箱复用实现随包
    const reuseJs = join(pkg, 'dist/lib/sandbox-reuse.js');
    if (!existsSync(reuseJs)) problems.push('③ 包内缺 dist/lib/sandbox-reuse.js');
    else if (!readFileSync(join(pkg, 'dist/lib/sandbox.js'), 'utf8').includes('./sandbox-reuse.js')) problems.push('③ 包内 dist/lib/sandbox.js 未引入 sandbox-reuse.js');
    if (!readFileSync(join(pkg, 'dist/index.js'), 'utf8').includes('--fresh-sandbox')) problems.push('③ 包内 dist/index.js 未注册 --fresh-sandbox');
    // SMOKE-core-04 口径：插件模板随包
    const templates = ['claude-plugin-template', 'opencode-plugin-template', 'codex-plugin-template'];
    const missingTemplates = templates.filter(t => !existsSync(join(pkg, t)));
    if (missingTemplates.length > 0) problems.push(`SMOKE-core-04 口径：缺插件模板 ${missingTemplates.join(', ')}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `registry ${PKG}@${version}：latest 指向 V，SLSA provenance 来源为 refs/tags/v${version} 且 gitCommit 等于 tag 提交；包内版本与 manifest 自洽，含沙箱复用实现，无孤儿 dist 产物，插件模板随包`,
      evidence: [`V=${version}`, `commit=${commit}`, `registry_tarball_sha256=${reg.sha256}`, `dist_tags=${JSON.stringify(tags)}`,
        `integrity=${view['dist.integrity'] ?? ''}`, 'reused=SMOKE-core-04'],
    };
  },

  'SMOKE-core-243': async () => {
    const { version } = ctx.identity;
    const reg = registryTarball();
    const prefix = newTempDir('prefix');
    const problems = [];
    const inst = run(npmBin, ['install', '-g', '--prefix', prefix, installSpec(version, reg.tarball)]);
    if (inst.status !== 0) {
      if (networkLike(inst.stderr)) throw new EnvGap(`npm 网络不可达：${tail(inst.stderr)}`, ['network:npm-registry']);
      throw new Error(`① 隔离安装失败：${tail(inst.stderr)}`);
    }
    // ① 真实命令入口：Unix 链接须可执行且解析到隔离安装包，Windows 按 shim 内容核对指向（code 评审 r1 F1）
    const layout = installedLayout(prefix);
    const identity = entryIdentityProblems(layout);
    if (identity.length > 0) throw new Error(`① ${identity.join('；')}`);
    const calls = [];
    // 一律经该入口（绝对路径）执行，不做 PATH 查找、不绕过入口直接加载包内脚本
    const cli = (cwd, args) => {
      const { command, args: argv } = entryCommand(layout, args);
      const r = spawnSync(command, argv, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: isolatedEnv() });
      calls.push(`${args.join(' ')}=${r.error ? 'spawn-error' : (r.signal ?? r.status)}`);
      return r;
    };
    // ② SMOKE-core-01 口径
    const verRun = cli(prefix, ['--version']);
    const verFail = processProblem(verRun, '② --version');
    if (verFail) problems.push(verFail);
    else if (verRun.stdout.trim() !== version) problems.push(`② --version=${verRun.stdout.trim()}，应为 ${version}`);
    // ③④ SMOKE-core-02 口径：init all（在当前目录生成，名称参数只写入项目配置）
    const allDir = newTempDir('init-all');
    const initAll = cli(allDir, ['init', 'smoke', '--locale', 'zh', '--ai-tool', 'all']);
    const initAllFail = processProblem(initAll, '③ init all');
    if (initAllFail) problems.push(initAllFail);
    else {
      const missingRefs = REFERENCE_DIRS.filter(d => !existsSync(join(allDir, 'logos/resources/reference', d)));
      if (!existsSync(join(allDir, 'logos'))) problems.push('③ 未生成 logos/');
      if (missingRefs.length > 0) problems.push(`③ 缺 reference 子目录 ${missingRefs.join(', ')}`);
      const sync = cli(allDir, ['sync']);
      const syncFail = processProblem(sync, '④ sync');
      if (syncFail) problems.push(syncFail);
      if (`${sync.stdout}${sync.stderr}`.includes('asset hash 不匹配')) problems.push('④ sync 输出含 asset hash 不匹配');
    }
    // ⑤ claude-code 项目：托管 guard 与随包模板一致
    const ccDir = newTempDir('init-cc');
    const initCc = cli(ccDir, ['init', '--locale', 'en', '--ai-tool', 'claude-code']);
    const initCcFail = processProblem(initCc, '⑤ init claude-code');
    if (initCcFail) problems.push(initCcFail);
    else {
      const syncCc = cli(ccDir, ['sync']);
      const syncCcFail = processProblem(syncCc, '⑤ sync');
      if (syncCcFail) problems.push(syncCcFail);
      const managed = join(ccDir, '.claude/openlogos/bin/guard-check');
      const bundled = join(layout.pkgDir, 'claude-plugin-template/bin/guard-check');
      if (!existsSync(managed)) problems.push('⑤ 未部署托管 guard-check');
      else if (fileSha(managed) !== fileSha(bundled)) problems.push('⑤ 托管 guard-check 与随包模板 SHA-256 不一致');
      // ⑥ status 成功退出且为合法成功 envelope（code 评审 r1 F2）
      for (const p of statusEnvelopeProblems(cli(ccDir, ['status', '--format', 'json']), version)) problems.push(`⑥ ${p}`);
    }
    if (problems.length > 0) throw new Error(`${problems.join('；')}（调用：${calls.join(', ')}）`);
    // ⑤ SMOKE-core-240 口径：沙箱复用增量（模拟增量编译器，一次性 sandbox_root，缓存路径 build-cache）
    const reuse = reuseIncrementalCheck(cli);
    const evidence = [`V=${version}`, `prefix=${prefix}`, `entry=${layout.entry}`, `entry_kind=${layout.kind}`, `calls=${calls.join(',')}`,
      `reuse=${reuse.summary}`, 'reused=SMOKE-core-01,SMOKE-core-02'];
    if (reuse.unsupported) {
      throw Object.assign(new PlatformUnavailable(`①～④ 通过；⑤ 当前执行环境无法复用沙箱（CLI 判 unsupported，常见于 Seatbelt 嵌套沙箱内 setuid ps 不可执行）：${reuse.summary}`.slice(0, 500)), { evidence });
    }
    if (reuse.problems.length > 0) throw new Error(`⑤ ${reuse.problems.join('；')}（${reuse.summary}）`);
    return {
      detail: `隔离 prefix 从 ${SELF_TEST ? '夹具 tarball' : 'registry'} 安装 V，经真实入口执行：版本一致，init all 生成资产与 reference 子目录，sync 无 manifest 错误，托管 guard 与随包模板一致，status 成功 envelope 合法，沙箱复用增量生效`,
      evidence,
    };
  },

  'SMOKE-core-244': async () => {
    const { version, commit } = ctx.identity;
    const gap = ghAuthGap();
    if (gap) throw gap;
    const problems = [];
    const rel = ghReleaseView(version);
    if (rel.tagName !== `v${version}`) problems.push(`① tagName=${rel.tagName}`);
    if (rel.isDraft) problems.push('① Release 是 draft');
    if (rel.isPrerelease) problems.push('① Release 是 prerelease');
    const latest = ghLatestTag();
    if (latest !== `v${version}`) problems.push(`② releases/latest=${latest}，应为 v${version}（非 latest 的有效 Release 在此失败，不归为缺 Release）`);
    const dir = newTempDir('gh-assets');
    const assets = ghDownloadAssets(version, dir);
    const expectedName = `miniidealab-openlogos-${version}.tgz`;
    const reg = registryTarball();
    let assetSha = null;
    if (assets.length !== 1 || assets[0] !== expectedName) problems.push(`③ Release 附件应恰为 ${expectedName}，实际 ${JSON.stringify(assets)}`);
    else {
      assetSha = fileSha(join(dir, expectedName));
      if (assetSha !== reg.sha256) problems.push(`③ 附件 SHA-256 ${assetSha} ≠ registry tarball ${reg.sha256}`);
    }
    const notes = releaseNotesFromChangelog(fileAtCommit(commit, 'CHANGELOG.md'), version);
    if (!notes) problems.push(`④ 发布提交的 CHANGELOG.md 无 ## [${version}] 节`);
    else {
      if (String(rel.body || '').trim() !== notes.trim()) problems.push('④ Release 正文与 CHANGELOG 提取结果不一致');
      if (!notes.includes('从 0.16.0 升级')) problems.push('④ 正文缺「从 0.16.0 升级」指引');
      if (!notes.includes('沙箱复用')) problems.push('④ 正文缺沙箱复用说明');
      if (notes.includes('未发布到 npm')) problems.push('④ 正文仍含「未发布到 npm」');
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `GitHub Release v${version} 为 latest、非 draft / prerelease，附件与 registry tarball 同源，正文与 CHANGELOG 一致，含沙箱复用说明与「从 0.16.0 升级」指引`,
      evidence: [`V=${version}`, `release_asset_sha256=${assetSha}`, `registry_tarball_sha256=${reg.sha256}`, `latest=${latest}`],
    };
  },

  'SMOKE-core-245': async () => {
    const { version } = ctx.identity;
    const site = (SITE_OVERRIDE || DEFAULT_SITE).replace(/\/$/, '');
    const problems = [];
    const statuses = [];
    // ① /releases 与 /zh/releases（SMOKE-core-07 / 15 口径）
    for (const path of ['/releases', '/zh/releases']) {
      const page = await httpGet(`${site}${path}`);
      statuses.push(`${path}=${page.status}`);
      if (page.status !== 200) { problems.push(`① ${path} HTTP ${page.status}`); continue; }
      // Astro 会在 class 列表后追加作用域类名（如 `latest-version astro-xxxx`）
      const latest = /class="(?:[^"]*\s)?latest-version(?:\s[^"]*)?"[^>]*>\s*v([0-9][0-9.]*)\s*</.exec(page.body)?.[1] ?? null;
      if (latest !== version) problems.push(`① ${path} latest=${latest}，应为 ${version}`);
      if (path === '/releases') {
        const start = page.body.indexOf(`>v${version}</h3>`);
        if (start === -1) problems.push(`① ${path} 无 v${version} 版本卡片`);
        else {
          const next = page.body.indexOf('<article', start);
          const card = page.body.slice(start, next === -1 ? undefined : next);
          const valueBlock = card.split('<h4')[1] ?? '';
          if (!valueBlock.includes('<li') || valueBlock.includes(FALLBACK_MESSAGE)) problems.push(`① v${version} 未展示英文价值摘要（为回退提示）`);
          if (!card.includes('summary-original')) problems.push(`① v${version} 缺中文原文次级内容`);
        }
      }
    }
    // ② 首页最近发布入口（SMOKE-core-08 口径）
    const home = await httpGet(`${site}/`);
    statuses.push(`/=${home.status}`);
    if (home.status !== 200) problems.push(`② 首页 HTTP ${home.status}`);
    else if (!/href="\/releases"/.test(home.body)) problems.push('② 首页无 /releases 入口');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `官网 ${site}：/releases 与 /zh/releases latest=V，V 展示英文摘要与中文原文，首页可进入发布动态`,
      evidence: [`V=${version}`, `site=${site}`, ...statuses, 'reused=SMOKE-core-07,SMOKE-core-08,SMOKE-core-15'],
    };
  },
};

export const PUBLIC_RELEASE_0161_SMOKE_IDS = Object.keys(CASES);
const PUBLIC_RELEASE_SMOKE_IDS = PUBLIC_RELEASE_0161_SMOKE_IDS;

// ── 执行与留痕 ───────────────────────────────────────────────────────────────

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of PUBLIC_RELEASE_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
    const record = {
      id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT,
      detail: row.detail, evidence: row.evidence,
    };
    if (row.reason_code) record.reason_code = row.reason_code;
    if (row.status === 'skip' && !row.reason_code) {
      record.not_applicable_reason = row.detail;
      record.missing_requirements = row.missing ?? [];
    }
    appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  }
}

const outcome = (error, started, evidence = []) => {
  if (error instanceof PlatformUnavailable) {
    return { status: 'skip', reason_code: 'platform-unavailable', detail: error.message, evidence: error.evidence ?? evidence, duration_ms: Date.now() - started };
  }
  return error instanceof EnvGap
    ? { status: 'skip', detail: error.message, missing: error.missing, evidence, duration_ms: Date.now() - started }
    : { status: 'fail', detail: error instanceof Error ? error.message : String(error), evidence, duration_ms: Date.now() - started };
};

try {
  const started = Date.now();
  try {
    ctx.identity = releaseIdentity();
  } catch (error) {
    for (const id of PUBLIC_RELEASE_SMOKE_IDS) results.set(id, outcome(error, started));
  }
  if (ctx.identity) {
    for (const id of PUBLIC_RELEASE_SMOKE_IDS) {
      const caseStart = Date.now();
      try {
        const { detail, evidence } = await CASES[id]();
        results.set(id, { status: 'pass', detail, evidence, duration_ms: Date.now() - caseStart });
      } catch (error) {
        results.set(id, outcome(error, caseStart, [`V=${ctx.identity.version}`]));
      }
    }
  }
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const notPassed = PUBLIC_RELEASE_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass'
  && results.get(id)?.reason_code !== 'platform-unavailable');
for (const id of PUBLIC_RELEASE_SMOKE_IDS.filter(x => results.get(x)?.reason_code === 'platform-unavailable')) {
  console.log(`smoke 平台不可执行（skip）：${id}：${results.get(id)?.detail}`);
}
if (notPassed.length > 0) {
  console.error(`smoke 未全部通过：${notPassed.map(id => `${id}(${results.get(id)?.status})`).join(', ')}`);
  for (const id of notPassed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
console.log(`smoke 通过：${PUBLIC_RELEASE_SMOKE_IDS.join(', ')}`);
process.exit(0);
