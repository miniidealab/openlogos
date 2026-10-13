#!/usr/bin/env node
/**
 * SMOKE-core-246～SMOKE-core-250 — 0.16.2 公开发布（release-0-16-2）的**公网制品**取证。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.2 公开发布 smoke（SMOKE-core-246～250）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.2 公开发布方案（npm / GitHub Release / 官网）」。
 * 判据沿用 scripts/smoke-public-release-0-16-1.js（SMOKE-core-242～245，随 release-0-16-1 撤销、保留不执行），
 * 该 runner 不改；本 runner 另增 Linux 容器用例与「0.16.1 从未公开」的反向断言。
 *
 *   - SMOKE-core-246：registry 发布身份与 provenance，包内含沙箱复用实现与 Linux 修复（含 SMOKE-core-04 口径），0.16.1 不在 registry。
 *   - SMOKE-core-247：宿主机 registry 隔离安装态可用（含 SMOKE-core-01 / 02 口径），并按 SMOKE-core-240 口径检查沙箱复用增量。
 *   - SMOKE-core-248：docker node:20 一次性容器内以非 root 用户从 registry 安装，在同用户不可转储进程存在时连续两次 verify 仍复用。
 *   - SMOKE-core-249：GitHub Release 与 registry 同源，正文含沙箱复用 / Linux / 「从 0.16.0 升级」、不含「未发布到 npm」，v0.16.1 无 Release。
 *   - SMOKE-core-250：官网 latest 等于 V、V 的英文摘要在场（含 SMOKE-core-07 / 08 / 15 口径），发布提交的英文摘要无 0.16.1 键。
 *
 * **版本口径**：V 与 tag 提交号从部署记录 logos/resources/verify/deployment-report.md 中**标题行含 `release-0-16-2`
 * 的那一节**的 `public_release_version: <V>` / `public_release_commit: <sha>` 两行读取（同文件其他节的同名行不得被误读）；
 * 提交号缺省时取 `git rev-parse v<V>^{commit}`。断言全部写成关系式，不硬编码 V；`0.16.1` 只作「从未公开」的反向断言对象。
 *
 * **执行边界**：公网只读；宿主机安装态只装到 `mktemp -d` 一次性 prefix 与一次性 sandbox_root，Linux 安装态只在
 * `docker run --rm` 一次性容器内，结束即删除。网络不可达、`gh` 未认证、缺 V、docker 不可用属可补齐的环境缺口：写显式
 * skip（不标 platform-unavailable）。`platform-unavailable` 只用于 SMOKE-core-247 ⑤ 在 Seatbelt 等嵌套沙箱内得到
 * `unsupported` 的情形（①～④ 须已通过）；SMOKE-core-248 容器内得到 `unsupported` 计失败。
 *
 * **窗口**：活跃提案为本 slug，或 OPENLOGOS_PR162_SMOKE=1；窗口之外按既有留痕机制为全部 owned ID 写 skip。
 *
 * **自测模式**（须同时满足）：OPENLOGOS_PR162_SELF_TEST=1、OPENLOGOS_PR162_FIXTURE=<夹具目录>、
 * OPENLOGOS_PR162_SITE=<本地预览 URL>，且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本。夹具目录结构：release.json、
 * npm-dist-tags.json、npm-view.json、npm-attestations.json、package.tgz、gh-release.json、gh-latest.txt、gh-assets/，
 * 以及反向断言夹具 npm-view-0.16.1.json（`{"error":{"code":"E404"}}` 或 `{"version":"…"}`）与
 * gh-release-0.16.1.json（`{"status":404}` 或 Release JSON）。SMOKE-core-248 以只读挂载把夹具 package.tgz 传入容器。
 * release.json 的 commit 可为 `WORKTREE`（读工作区文件）。正式模式拒绝注入；结果以 environment=self-test-fixture 写入。
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

const SLUG = 'release-0-16-2';
const PKG = '@miniidealab/openlogos';
const REPO = 'miniidealab/openlogos';
const DEFAULT_SITE = 'https://openlogos.ai';
const OWNED = ['SMOKE-core-246', 'SMOKE-core-247', 'SMOKE-core-248', 'SMOKE-core-249', 'SMOKE-core-250'];
/** 从未公开的版本：只作反向断言对象（部署方案「与 0.16.1 公开发布方案的关系」）。 */
const NEVER_PUBLIC = '0.16.1';
const LINUX_IMAGE = 'node:20';
const FALLBACK_MESSAGE = 'Structured release summary unavailable for this version.';
const REFERENCE_DIRS = ['requirement', 'todolist', 'code', 'image', 'temp', 'note'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_PR162_SELF_TEST === '1';
const FIXTURE = process.env.OPENLOGOS_PR162_FIXTURE;
const SITE_OVERRIDE = process.env.OPENLOGOS_PR162_SITE;
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
  refuse('设置了 OPENLOGOS_PR162_FIXTURE / _SITE 但未声明自测（OPENLOGOS_PR162_SELF_TEST=1）');
}
if (SELF_TEST && (!FIXTURE || !SITE_OVERRIDE)) refuse('自测模式需要同时提供 OPENLOGOS_PR162_FIXTURE 与 OPENLOGOS_PR162_SITE');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_PR162_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案公开发布验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_PR162_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_PR162_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

// ── 通用工具 ───────────────────────────────────────────────────────────────────

/** 环境缺口：写 skip 而非 fail。 */
class EnvGap extends Error {
  constructor(message, missing) { super(message); this.missing = missing; }
}

/** 当前平台不可执行（仅 SMOKE-core-247 ⑤ 的沙箱复用检查在嵌套沙箱内）：skip + reason_code platform-unavailable。 */
class PlatformUnavailable extends Error {}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, {
  cwd: opts.cwd ?? repoRoot, encoding: 'utf8', timeout: opts.timeout ?? 600_000, maxBuffer: 64 * 1024 * 1024, env: opts.env ?? isolatedEnv(),
});

/** 子命令剥离外层 smoke 账本与本 runner 的控制变量，避免夹具项目把记录写进外层账本。 */
function isolatedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key.startsWith('OPENLOGOS_PR162_') || key.startsWith('OPENLOGOS_PUBLIC_RELEASE_')) delete env[key];
  }
  return env;
}

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-pr162-${tag}-`));
  scopes.push(dir);
  return dir;
}

const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const tail = text => String(text || '').trim().slice(-300);

/** npm / gh / docker 的网络类失败归为环境缺口，其余（如 E404）按真实失败处理。 */
function networkLike(text) {
  return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|network|getaddrinfo|socket hang up|TLS handshake timeout|i\/o timeout/i.test(String(text || ''));
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

/**
 * registry 是否有该版本：返回 `{ e404: true }` 或 `{ e404: false, version }`。
 * E404 是本函数的**预期**结果之一（反向断言），网络失败归环境缺口，其余失败按真实失败处理。
 */
function npmVersionPresence(version) {
  if (SELF_TEST) {
    const doc = readJsonFile(fixturePath(`npm-view-${version}.json`));
    return doc?.error?.code === 'E404' ? { e404: true } : { e404: false, version: doc.version ?? null };
  }
  const r = run(npmBin, ['view', `${PKG}@${version}`, 'version', '--json']);
  const text = `${r.stdout}\n${r.stderr}`;
  if (r.status !== 0) {
    if (/\bE404\b/.test(text)) return { e404: true };
    if (networkLike(text)) throw new EnvGap(`npm 网络不可达：${tail(r.stderr)}`, ['network:npm-registry']);
    throw new Error(`npm view ${PKG}@${version} version 失败：${tail(r.stderr)}`);
  }
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* 空输出按无版本 */ }
  // npm 对不存在的版本也可能以 0 退出且输出为空：同样视为 registry 无此版本
  if (parsed === null || parsed === '' || (Array.isArray(parsed) && parsed.length === 0)) return { e404: true };
  return { e404: false, version: Array.isArray(parsed) ? parsed.join(',') : String(parsed) };
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

/** `releases/tags/v<version>` 是否 404：返回 `{ notFound: true }` 或 `{ notFound: false, tag }`。 */
function ghReleaseByTagPresence(version) {
  if (SELF_TEST) {
    const doc = readJsonFile(fixturePath(`gh-release-${version}.json`));
    return doc?.status === 404 ? { notFound: true } : { notFound: false, tag: doc.tag_name ?? doc.tagName ?? null };
  }
  const r = run('gh', ['api', `repos/${REPO}/releases/tags/v${version}`, '--jq', '.tag_name']);
  if (r.status !== 0) {
    if (/HTTP 404|Not Found/.test(`${r.stdout}\n${r.stderr}`)) return { notFound: true };
    if (networkLike(r.stderr)) throw new EnvGap(`GitHub 网络不可达：${tail(r.stderr)}`, ['network:github']);
    throw new Error(`gh api releases/tags/v${version} 失败：${tail(r.stderr)}`);
  }
  return { notFound: false, tag: r.stdout.trim() };
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

/** 英文摘要源文件中是否登记了该版本键（`'x.y.z': {` 形态）。 */
function hasSummaryKey(source, version) {
  return new RegExp(`^\\s*['"]${version.replace(/\./g, '\\.')}['"]\\s*:\\s*\\{`, 'm').test(source);
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
const S01_CASES = '# S01\n\n| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n';

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
  put('logos/resources/test/core-S01-test-cases.md', S01_CASES);
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

/**
 * SMOKE-core-248 容器内脚本（CommonJS，以 `node /smoke/c248.js <安装规格> <V>` 在 node:20 容器内以非 root 用户运行）。
 * 只把结构化结果以 `SMOKE248_RESULT=<json>` 一行打印到 stdout；`gaps` 为可补齐的环境缺口，`problems` 为真实失败。
 * 不可转储进程的构造与 ST-S13-26 同口径：exec 一份仅保留执行权限（0111）的 sleep 副本。
 */
const CONTAINER_SCRIPT = `'use strict';
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const [spec, V] = process.argv.slice(2);
const out = { uid: process.getuid(), steps: {}, gaps: [], problems: [] };
let pre = null;
const finish = () => {
  if (pre) { try { process.kill(pre.pid, 'SIGKILL'); } catch {} }
  process.stdout.write('\\nSMOKE248_RESULT=' + JSON.stringify(out) + '\\n');
  process.exit(0);
};
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, ...opts });
const tail = t => String(t || '').trim().slice(-300);
const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const netLike = t => /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|network|getaddrinfo|socket hang up/i.test(String(t || ''));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pr162-248-'));
try {
  // ① 非 root
  if (out.uid === 0) { out.problems.push('① 容器内 uid 为 0，应以非 root 用户执行'); finish(); }
  // ② 从 registry（自测：只读挂载的本地 tarball）安装
  const prefix = path.join(T, 'prefix');
  const inst = sh('npm', ['install', '-g', '--prefix', prefix, spec]);
  out.steps.install = inst.status;
  if (inst.status !== 0) {
    if (netLike(inst.stderr)) out.gaps.push('network:npm-registry(container)');
    else out.problems.push('② 容器内安装失败：' + tail(inst.stderr));
    finish();
  }
  const bin = path.join(prefix, 'bin', 'openlogos');
  const ver = sh(bin, ['--version']);
  out.steps.version = String(ver.stdout || '').trim();
  if (ver.status !== 0 || out.steps.version !== V) { out.problems.push('② --version=' + out.steps.version + '（exit ' + ver.status + '），应为 ' + V); finish(); }
  // ③ 不可转储进程：environ EACCES、stat 可读、启动早于命令 2 秒以上
  const sleepSrc = String(sh('sh', ['-c', 'command -v sleep']).stdout || '').trim();
  const xonly = path.join(T, 'sleep-xonly');
  fs.writeFileSync(xonly, fs.readFileSync(sleepSrc));
  fs.chmodSync(xonly, 0o111);
  pre = spawn(xonly, ['3600'], { stdio: 'ignore' });
  const statStart = pid => { const s = fs.readFileSync('/proc/' + pid + '/stat', 'utf8'); return Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[19]) / 100; };
  const uptime = () => Number(fs.readFileSync('/proc/uptime', 'utf8').split(/\\s+/)[0]);
  for (let i = 0; i < 50 && !fs.existsSync('/proc/' + pre.pid + '/stat'); i += 1) pause(100);
  let environ = 'readable';
  try { fs.readFileSync('/proc/' + pre.pid + '/environ'); } catch (e) { environ = e.code; }
  out.steps.pre_pid = pre.pid;
  out.steps.environ = environ;
  if (environ !== 'EACCES') { out.gaps.push('non-dumpable-process:environ=' + environ); finish(); }
  let age = 0;
  try {
    for (let i = 0; i < 100; i += 1) { age = uptime() - statStart(pre.pid); if (age > 2) break; pause(200); }
  } catch (e) { out.gaps.push('non-dumpable-process:stat-unreadable(' + e.code + ')'); finish(); }
  out.steps.pre_age_seconds = Number(age.toFixed(2));
  if (!(age > 2)) { out.gaps.push('non-dumpable-process:age<=2s'); finish(); }
  // ④ SMOKE-core-240 夹具口径：连续两次 verify，中间改 1 个源文件
  const dir = path.join(T, 'proj'); const sbx = path.join(T, 'sbx');
  fs.mkdirSync(dir); fs.mkdirSync(sbx);
  const put = (rel, content) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), content); };
  const init = sh(bin, ['init', '--locale', 'en', '--ai-tool', 'claude-code'], { cwd: dir });
  if (init.status !== 0) { out.problems.push('④ init 失败：exit ' + init.status + ' ' + tail(init.stderr)); finish(); }
  put('logos/resources/test/core-S01-test-cases.md', ${JSON.stringify(S01_CASES)});
  for (let i = 1; i <= 20; i += 1) put('src/m' + i + '.c', 'int m' + i + '(void) { return ' + i + '; }\\n');
  put('tools/compile.js', ${JSON.stringify(COMPILER)});
  const cfgPath = path.join(dir, 'logos/logos.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.verify = Object.assign({}, cfg.verify || {}, { result_path: 'logos/resources/verify/test-results.jsonl', pre_run_command: 'node tools/compile.js',
    sandbox_mode: 'auto', sandbox_root: sbx, sandbox_deny_workspace_write: true, sandbox_cache_paths: ['build-cache'] });
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const once = () => {
    const r = sh(bin, ['verify', '--format', 'json'], { cwd: dir });
    let data = null;
    try { data = JSON.parse(r.stdout).data; } catch {}
    const t = (data && data.pre_run && data.pre_run.commands && data.pre_run.commands[0] && data.pre_run.commands[0].stdout_tail) || '';
    const m = /compiled=(\\d+)/.exec(t);
    return { exit: r.status, gate: data && data.gate ? data.gate.result : null, state: data && data.sandbox && data.sandbox.reuse ? data.sandbox.reuse.state : null, compiled: m ? m[1] : null };
  };
  const first = once();
  fs.writeFileSync(path.join(dir, 'src/m7.c'), 'int m7(void) { return 700; }\\n');
  const second = once();
  out.steps.verify = [first, second];
  if (first.gate !== 'PASS' || second.gate !== 'PASS') out.problems.push('④ verify gate 应两次 PASS');
  if (first.state !== 'created' || second.state !== 'reused') out.problems.push('④ sandbox.reuse.state 应依次为 created / reused（Linux 容器内 unsupported 亦计失败）');
  if (first.compiled !== '20' || second.compiled !== '1') out.problems.push('④ compiled 应依次为 20 / 1');
  // ⑤ 最新世代释放记录：released（非 tainted），含数字型 command_started_uptime
  const lockDirs = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (!e.isDirectory()) continue; const f = path.join(d, e.name); if (e.name === 'lock') lockDirs.push(f); else walk(f); } };
  walk(sbx);
  const records = [];
  for (const ld of lockDirs) for (const n of fs.readdirSync(ld)) { const m = /^(gen-\\d{12})\\.(released|tainted)$/.exec(n); if (m) records.push({ gen: m[1], kind: m[2], file: path.join(ld, n) }); }
  records.sort((a, b) => a.gen.localeCompare(b.gen));
  const latest = records[records.length - 1];
  if (!latest) out.problems.push('⑤ 持久沙箱中无释放记录');
  else {
    let rec = {};
    try { rec = JSON.parse(fs.readFileSync(latest.file, 'utf8')); } catch {}
    out.steps.release_record = { gen: latest.gen, kind: latest.kind, command_started_uptime: rec.command_started_uptime ?? null, reason: rec.reason ?? null };
    if (latest.kind !== 'released') out.problems.push('⑤ 最新释放记录为 ' + latest.kind + '（' + (rec.reason || '') + '），应为 released');
    if (typeof rec.command_started_uptime !== 'number') out.problems.push('⑤ 释放记录缺数字型 command_started_uptime');
  }
} catch (e) {
  out.problems.push('容器内脚本异常：' + (e && e.stack ? String(e.stack).slice(0, 400) : String(e)));
}
finish();
`;

/** node:20 镜像摘要；本地无镜像时拉取（网络失败归环境缺口）。 */
function linuxImageDigest() {
  const inspect = () => run('docker', ['image', 'inspect', LINUX_IMAGE, '--format', '{{json .RepoDigests}}']);
  let r = inspect();
  if (r.status !== 0) {
    const pull = run('docker', ['pull', LINUX_IMAGE]);
    if (pull.status !== 0) {
      throw new EnvGap(`无法获取 docker 镜像 ${LINUX_IMAGE}：${tail(pull.stderr)}`, networkLike(pull.stderr) ? ['network:docker-registry'] : [`docker-image:${LINUX_IMAGE}`]);
    }
    r = inspect();
  }
  let digests = [];
  try { digests = JSON.parse(r.stdout); } catch { /* 下方按缺失处理 */ }
  return digests[0] ?? `${LINUX_IMAGE}(无 RepoDigests)`;
}

// ── 用例 ─────────────────────────────────────────────────────────────────────

const CASES = {
  'SMOKE-core-246': async () => {
    const { version, commit } = ctx.identity;
    const problems = [];
    const tags = npmDistTags();
    if (tags.latest !== version) problems.push(`① dist-tags.latest=${tags.latest}，应为 V=${version}`);
    if (tags.old === version) problems.push('① old dist-tag 被移到了 V');
    const view = npmVersionView(version);
    if (view.version !== version) problems.push(`② version=${view.version}，应为 ${version}`);
    // 来源提交以 SLSA provenance 为准：tarball 发布不写 gitHead；gitHead 存在时须同样相等
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
    // 沙箱复用实现与 Linux 修复（§2.92 command_started_uptime）随包
    const reuseJs = join(pkg, 'dist/lib/sandbox-reuse.js');
    if (!existsSync(reuseJs)) problems.push('③ 包内缺 dist/lib/sandbox-reuse.js');
    else {
      if (!readFileSync(reuseJs, 'utf8').includes('command_started_uptime')) problems.push('③ 包内 dist/lib/sandbox-reuse.js 不含 command_started_uptime（Linux 修复未进入构建产物）');
      if (!readFileSync(join(pkg, 'dist/lib/sandbox.js'), 'utf8').includes('./sandbox-reuse.js')) problems.push('③ 包内 dist/lib/sandbox.js 未引入 sandbox-reuse.js');
    }
    if (!readFileSync(join(pkg, 'dist/index.js'), 'utf8').includes('--fresh-sandbox')) problems.push('③ 包内 dist/index.js 未注册 --fresh-sandbox');
    const sources = sourceFilesAtCommit(commit);
    const orphans = walkFiles(join(pkg, 'dist')).filter(f => f.endsWith('.js'))
      .filter(f => !sources.has(f.replace(/\.js$/, '.ts')));
    if (orphans.length > 0) problems.push(`④ dist 中无源文件的产物：${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? ' …' : ''}`);
    // ⑤ 0.16.1 从未进入 registry
    const never = npmVersionPresence(NEVER_PUBLIC);
    if (!never.e404) problems.push(`⑤ registry 存在 ${PKG}@${NEVER_PUBLIC}（version=${never.version}），0.16.1 被意外发布，需由用户决定处置`);
    // SMOKE-core-04 口径：插件模板随包
    const templates = ['claude-plugin-template', 'opencode-plugin-template', 'codex-plugin-template'];
    const missingTemplates = templates.filter(t => !existsSync(join(pkg, t)));
    if (missingTemplates.length > 0) problems.push(`SMOKE-core-04 口径：缺插件模板 ${missingTemplates.join(', ')}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `registry ${PKG}@${version}：latest 指向 V，SLSA provenance 来源为 refs/tags/v${version} 且 gitCommit 等于 tag 提交；包内版本与 manifest 自洽，含沙箱复用实现与 Linux 修复，无孤儿 dist 产物，插件模板随包；${NEVER_PUBLIC} 返回 E404`,
      evidence: [`V=${version}`, `commit=${commit}`, `registry_tarball_sha256=${reg.sha256}`, `dist_tags=${JSON.stringify(tags)}`,
        `integrity=${view['dist.integrity'] ?? ''}`, `npm_view_${NEVER_PUBLIC}=E404`, 'reused=SMOKE-core-04'],
    };
  },

  'SMOKE-core-247': async () => {
    const { version } = ctx.identity;
    const reg = registryTarball();
    const prefix = newTempDir('prefix');
    const problems = [];
    const inst = run(npmBin, ['install', '-g', '--prefix', prefix, installSpec(version, reg.tarball)]);
    if (inst.status !== 0) {
      if (networkLike(inst.stderr)) throw new EnvGap(`npm 网络不可达：${tail(inst.stderr)}`, ['network:npm-registry']);
      throw new Error(`① 隔离安装失败：${tail(inst.stderr)}`);
    }
    // ① 真实命令入口：Unix 链接须可执行且解析到隔离安装包，Windows 按 shim 内容核对指向
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
    // ③ SMOKE-core-02 口径：init all（在当前目录生成，名称参数只写入项目配置）后 sync
    const allDir = newTempDir('init-all');
    const initAll = cli(allDir, ['init', 'smoke', '--locale', 'zh', '--ai-tool', 'all']);
    const initAllFail = processProblem(initAll, '③ init all');
    if (initAllFail) problems.push(initAllFail);
    else {
      const missingRefs = REFERENCE_DIRS.filter(d => !existsSync(join(allDir, 'logos/resources/reference', d)));
      if (!existsSync(join(allDir, 'logos'))) problems.push('③ 未生成 logos/');
      if (missingRefs.length > 0) problems.push(`③ 缺 reference 子目录 ${missingRefs.join(', ')}`);
      const sync = cli(allDir, ['sync']);
      const syncFail = processProblem(sync, '③ sync');
      if (syncFail) problems.push(syncFail);
      if (`${sync.stdout}${sync.stderr}`.includes('asset hash 不匹配')) problems.push('③ sync 输出含 asset hash 不匹配');
    }
    // claude-code 项目：托管 guard 与随包模板一致；④ status 成功退出且为合法成功 envelope
    const ccDir = newTempDir('init-cc');
    const initCc = cli(ccDir, ['init', '--locale', 'en', '--ai-tool', 'claude-code']);
    const initCcFail = processProblem(initCc, '③ init claude-code');
    if (initCcFail) problems.push(initCcFail);
    else {
      const syncCc = cli(ccDir, ['sync']);
      const syncCcFail = processProblem(syncCc, '③ sync claude-code');
      if (syncCcFail) problems.push(syncCcFail);
      const managed = join(ccDir, '.claude/openlogos/bin/guard-check');
      const bundled = join(layout.pkgDir, 'claude-plugin-template/bin/guard-check');
      if (!existsSync(managed)) problems.push('③ 未部署托管 guard-check');
      else if (fileSha(managed) !== fileSha(bundled)) problems.push('③ 托管 guard-check 与随包模板 SHA-256 不一致');
      for (const p of statusEnvelopeProblems(cli(ccDir, ['status', '--format', 'json']), version)) problems.push(`④ ${p}`);
    }
    if (problems.length > 0) throw new Error(`${problems.join('；')}（调用：${calls.join(', ')}）`);
    // ⑤ SMOKE-core-240 口径：沙箱复用增量（模拟增量编译器，一次性 sandbox_root，缓存路径 build-cache）
    const reuse = reuseIncrementalCheck(cli);
    const evidence = [`V=${version}`, `host_platform=${process.platform}`, `prefix=${prefix}`, `entry=${layout.entry}`, `entry_kind=${layout.kind}`,
      `calls=${calls.join(',')}`, `reuse=${reuse.summary}`, 'reused=SMOKE-core-01,SMOKE-core-02'];
    if (reuse.unsupported) {
      throw Object.assign(new PlatformUnavailable(`①～④ 通过；⑤ 当前执行环境无法复用沙箱（CLI 判 unsupported，常见于 Seatbelt 嵌套沙箱内 setuid ps 不可执行）：${reuse.summary}`.slice(0, 500)), { evidence });
    }
    if (reuse.problems.length > 0) throw new Error(`⑤ ${reuse.problems.join('；')}（${reuse.summary}）`);
    return {
      detail: `宿主机（${process.platform}）隔离 prefix 从 ${SELF_TEST ? '夹具 tarball' : 'registry'} 安装 V，经真实入口执行：版本一致，init all 生成资产与 reference 子目录，sync 无 manifest 错误，托管 guard 与随包模板一致，status 成功 envelope 合法，沙箱复用增量生效`,
      evidence,
    };
  },

  'SMOKE-core-248': async () => {
    const { version } = ctx.identity;
    const docker = run('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 60_000 });
    if (docker.error || docker.status !== 0) {
      throw new EnvGap(`docker 不可用：${docker.error ? docker.error.message : tail(docker.stderr)}`, ['docker']);
    }
    const digest = linuxImageDigest();
    const dir = newTempDir('linux');
    writeFileSync(join(dir, 'c248.js'), CONTAINER_SCRIPT);
    let spec = `${PKG}@${version}`;
    if (SELF_TEST) {
      copyFileSync(registryTarball().tarball, join(dir, 'pkg.tgz'));
      spec = '/smoke/pkg.tgz';
    }
    // 一次性容器（--rm）；node:20 内置非 root 用户 node；脚本目录只读挂载
    const r = run('docker', ['run', '--rm', '--user', 'node', '-v', `${dir}:/smoke:ro`, LINUX_IMAGE, 'node', '/smoke/c248.js', spec, version]);
    const line = String(r.stdout || '').split('\n').reverse().find(l => l.startsWith('SMOKE248_RESULT='));
    if (!line) {
      const text = `${r.stdout}\n${r.stderr}`;
      if (r.error || networkLike(text)) throw new EnvGap(`docker 容器未能运行：${r.error ? r.error.message : tail(r.stderr)}`, ['docker-run']);
      throw new Error(`容器未产出结构化结果（exit ${r.status}）：${tail(r.stderr || r.stdout)}`);
    }
    const res = JSON.parse(line.slice('SMOKE248_RESULT='.length));
    const evidence = [`V=${version}`, `image=${digest}`, `docker_server=${docker.stdout.trim()}`, `uid=${res.uid}`,
      `steps=${JSON.stringify(res.steps)}`.slice(0, 1500)];
    if (res.problems.length > 0) throw Object.assign(new Error(res.problems.join('；')), { evidence });
    if (res.gaps.length > 0) throw new EnvGap(`容器内环境构造未完成：${res.gaps.join(', ')}`, res.gaps);
    return {
      detail: `docker ${LINUX_IMAGE} 一次性容器内以 uid ${res.uid} 从 ${SELF_TEST ? '夹具 tarball' : 'registry'} 安装 V；存在 environ 不可读（EACCES）、启动早于命令 ${res.steps.pre_age_seconds}s 的同用户不可转储进程时，连续两次 verify 为 created / reused、compiled 20 / 1，最新释放记录为 released 且含 command_started_uptime`,
      evidence,
    };
  },

  'SMOKE-core-249': async () => {
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
      for (const keyword of ['沙箱复用', 'Linux', '从 0.16.0 升级']) {
        if (!notes.includes(keyword)) problems.push(`④ 正文缺「${keyword}」`);
      }
      if (notes.includes('未发布到 npm')) problems.push('④ 正文含「未发布到 npm」');
    }
    // ⑤ v0.16.1 从未有 Release
    const never = ghReleaseByTagPresence(NEVER_PUBLIC);
    if (!never.notFound) problems.push(`⑤ 存在 v${NEVER_PUBLIC} 的 GitHub Release（${never.tag}），0.16.1 被意外发布，需由用户决定处置`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `GitHub Release v${version} 为 latest、非 draft / prerelease，附件与 registry tarball 同源，正文与 CHANGELOG 一致，含沙箱复用、Linux 修复与「从 0.16.0 升级」指引；v${NEVER_PUBLIC} 无 Release`,
      evidence: [`V=${version}`, `release_asset_sha256=${assetSha}`, `registry_tarball_sha256=${reg.sha256}`, `latest=${latest}`, `release_v${NEVER_PUBLIC}=404`],
    };
  },

  'SMOKE-core-250': async () => {
    const { version, commit } = ctx.identity;
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
    // ③ 发布提交的英文摘要：有 V 键、无 0.16.1 键
    const summaries = fileAtCommit(commit, 'website/src/data/release-summaries-en.mjs');
    if (!hasSummaryKey(summaries, version)) problems.push(`③ release-summaries-en.mjs 无 '${version}' 键`);
    if (hasSummaryKey(summaries, NEVER_PUBLIC)) problems.push(`③ release-summaries-en.mjs 仍含从未公开的 '${NEVER_PUBLIC}' 键`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `官网 ${site}：/releases 与 /zh/releases latest=V，V 展示英文摘要与中文原文，首页可进入发布动态；发布提交的英文摘要有 '${version}'、无 '${NEVER_PUBLIC}'`,
      evidence: [`V=${version}`, `site=${site}`, ...statuses, 'reused=SMOKE-core-07,SMOKE-core-08,SMOKE-core-15'],
    };
  },
};

export const PUBLIC_RELEASE_0162_SMOKE_IDS = Object.keys(CASES);
const PUBLIC_RELEASE_SMOKE_IDS = PUBLIC_RELEASE_0162_SMOKE_IDS;

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
  const ev = error?.evidence ?? evidence;
  if (error instanceof PlatformUnavailable) {
    return { status: 'skip', reason_code: 'platform-unavailable', detail: error.message, evidence: ev, duration_ms: Date.now() - started };
  }
  return error instanceof EnvGap
    ? { status: 'skip', detail: error.message, missing: error.missing, evidence: ev, duration_ms: Date.now() - started }
    : { status: 'fail', detail: error instanceof Error ? error.message : String(error), evidence: ev, duration_ms: Date.now() - started };
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
