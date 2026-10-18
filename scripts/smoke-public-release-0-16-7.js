#!/usr/bin/env node
/**
 * SMOKE-core-272～SMOKE-core-279 — 0.16.7 公开发布（release-0-16-7）的**公网制品**与官网文档取证。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.7 公开发布 smoke（SMOKE-core-272～279）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.7 公开发布方案（npm / GitHub Release / 官网，含官网文档补齐）」。
 * 公网判据沿用 scripts/smoke-public-release-0-16-2.js（SMOKE-core-246～250），该 runner 不改；安装态的环境能力判据沿用
 * 0.16.3～0.16.6 安装态 runner（SMOKE-core-252 / 255 / 259 / 260 / 264），由 scripts/lib/env-capability-check-0-16-7.cjs
 * 在宿主机与 Linux 容器内共用同一份实现。
 *
 *   - SMOKE-core-272：registry 发布身份与 provenance，包内含环境命令（含 SMOKE-core-04 口径），0.16.3～0.16.6 不在 registry。
 *   - SMOKE-core-273：宿主机 registry 隔离安装态可用（含 SMOKE-core-01 / 02 口径），环境登记全链路与提案默认环境生效。
 *   - SMOKE-core-274：宿主机 registry 安装态的 script 部署、dry-run、回滚、晋级与审批。
 *   - SMOKE-core-275：docker node:20 一次性容器内以非 root 用户从 registry 安装，复跑 273 ④⑤ 与 274。
 *   - SMOKE-core-276：GitHub Release 与 registry 同源，正文含环境能力与「从 0.16.2 升级」、不含「未发布到 npm」，v0.16.3～v0.16.6 无 Release。
 *   - SMOKE-core-277：官网 latest 等于 V、V 的英文摘要在场（含 SMOKE-core-07 / 08 / 15 口径），发布提交的英文摘要无 0.16.3～0.16.6 键。
 *   - SMOKE-core-278：官网中英文 env / deploy / approve / environments 新页可达、内容在场、可从侧边栏进入（含 SMOKE-core-21 口径）。
 *   - SMOKE-core-279：官网中英文既有文档页已补环境能力。
 *
 * **版本口径**：V 与 tag 提交号从部署记录 logos/resources/verify/deployment-report.md 中**标题行含 `release-0-16-7`
 * 的那一节**的 `public_release_version: <V>` / `public_release_commit: <sha>` 两行读取（同文件其他节的同名行不得被误读）；
 * 提交号缺省时取 `git rev-parse v<V>^{commit}`。断言全部写成关系式，不硬编码 V；0.16.3～0.16.6 只作「从未公开」的反向断言对象。
 *
 * **执行边界**：公网只读；宿主机安装态只装到 `mktemp -d` 一次性 prefix，环境能力用例只在一次性临时 git 项目内执行，
 * Linux 安装态只在 `docker run --rm` 一次性容器内，结束即删除。网络不可达、`gh` 未认证、缺 V、docker 不可用属可补齐的
 * 环境缺口：写显式 skip（不标 platform-unavailable）。
 *
 * **窗口**：活跃提案为本 slug，或 OPENLOGOS_PR167_SMOKE=1；窗口之外按既有留痕机制为全部 owned ID 写 skip。
 *
 * **自测模式**（须同时满足）：OPENLOGOS_PR167_SELF_TEST=1、OPENLOGOS_PR167_FIXTURE=<夹具目录>、
 * OPENLOGOS_PR167_SITE=<本地预览 URL>，且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本。夹具目录结构：release.json、
 * npm-dist-tags.json、npm-view.json、npm-attestations.json、package.tgz、gh-release.json、gh-latest.txt、gh-assets/，
 * 以及每个未公开版本的反向断言夹具 npm-view-<版本>.json（`{"error":{"code":"E404"}}` 或 `{"version":"…"}`）与
 * gh-release-<版本>.json（`{"status":404}` 或 Release JSON）。SMOKE-core-275 以只读挂载把夹具 package.tgz 传入容器。
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';
import {
  entryCommand, entryIdentityProblems, installedLayout, processProblem, provenanceSourceProblems, statusEnvelopeProblems,
} from './lib/public-release-checks.mjs';

const SLUG = 'release-0-16-7';
const PKG = '@miniidealab/openlogos';
const REPO = 'miniidealab/openlogos';
const DEFAULT_SITE = 'https://openlogos.ai';
const OWNED = [
  'SMOKE-core-272', 'SMOKE-core-273', 'SMOKE-core-274', 'SMOKE-core-275',
  'SMOKE-core-276', 'SMOKE-core-277', 'SMOKE-core-278', 'SMOKE-core-279',
];
/** 从未公开的版本：只作反向断言对象（部署方案「与 0.16.3～0.16.6 的关系」）。 */
const NEVER_PUBLIC = ['0.16.3', '0.16.4', '0.16.5', '0.16.6'];
const LINUX_IMAGE = 'node:20';
const FALLBACK_MESSAGE = 'Structured release summary unavailable for this version.';
const REFERENCE_DIRS = ['requirement', 'todolist', 'code', 'image', 'temp', 'note'];
const ENV_CHECK_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'lib', 'env-capability-check-0-16-7.cjs');
const RELEASE_NOTE_KEYWORDS = ['环境', 'openlogos deploy', ['openlogos', 'approve'].join(' '), '从 0.16.2 升级'];

/** SMOKE-core-278：新页（英文路径；中文为 /zh 前缀）与各页必含字面量。 */
const NEW_PAGES = [
  { path: '/cli/env/', must: ['openlogos env list', 'env check', 'proposal_default_env'] },
  { path: '/cli/deploy/', must: ['openlogos deploy --env', '--dry-run', '--rollback', 'DEPLOY_APPROVAL_REQUIRED', 'DEPLOY_PROMOTION_UNVERIFIED'] },
  { path: '/cli/approve/', must: [['openlogos', 'approve', '--env'].join(' '), '--ref'] },
  { path: '/specs/environments/', must: ['logos/environments.yaml', 'promote_from', 'require_approval', 'deployments.jsonl'] },
];
const NEW_SOURCES = ['cli/env.md', 'cli/deploy.md', 'cli/approve.md', 'specs/environments.md'];
/** SMOKE-core-279：既有页与补齐后必含字面量。 */
const REVISED_PAGES = [
  { path: '/cli/deploy-done/', must: ['--ref', 'DEPLOY_DONE_GATED_ENV'] },
  { path: '/cli/smoke/', must: ['OPENLOGOS_SMOKE_ENV', 'target_environment'] },
  { path: '/cli/status/', must: ['environments'] },
  { path: '/cli/ignore-exempt/', must: ['logos/environments.yaml'] },
  { path: '/specs/change-management/', must: [['openlogos', 'approve'].join(' '), ['--force', 'promote'].join('-')] },
  { path: '/skills/deployment-executor/', must: ['openlogos deploy'] },
  { path: '/skills/change-writer/', must: ['proposal_default_env'] },
];
/** SMOKE-core-21 原定义访问的中文路由（/zh 为中文首页，其余为中文文档页）。 */
const ZH_ROUTES = ['/zh', '/zh/getting-started', '/zh/cli'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_PR167_SELF_TEST === '1';
const FIXTURE = process.env.OPENLOGOS_PR167_FIXTURE;
const SITE_OVERRIDE = process.env.OPENLOGOS_PR167_SITE;
const ENVIRONMENT = SELF_TEST ? 'self-test-fixture' : 'public-registry-github-site';
/** 本次 smoke 实际验证的环境（`openlogos smoke --env` 注入）；skip 记录不声明。 */
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
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
  refuse('设置了 OPENLOGOS_PR167_FIXTURE / _SITE 但未声明自测（OPENLOGOS_PR167_SELF_TEST=1）');
}
if (SELF_TEST && (!FIXTURE || !SITE_OVERRIDE)) refuse('自测模式需要同时提供 OPENLOGOS_PR167_FIXTURE 与 OPENLOGOS_PR167_SITE');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_PR167_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案公开发布验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_PR167_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_PR167_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

// ── 通用工具 ───────────────────────────────────────────────────────────────────

/** 环境缺口：写 skip 而非 fail。 */
class EnvGap extends Error {
  constructor(message, missing) { super(message); this.missing = missing; }
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, {
  cwd: opts.cwd ?? repoRoot, encoding: 'utf8', timeout: opts.timeout ?? 900_000, maxBuffer: 64 * 1024 * 1024, env: opts.env ?? isolatedEnv(),
});

/** 子命令剥离外层 smoke 账本、外层目标环境、部署注入与本 runner 的控制变量，避免夹具项目把记录写进外层账本。 */
function isolatedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV'
      || key.startsWith('OPENLOGOS_DEPLOY_') || key.startsWith('OPENLOGOS_PR167_')) delete env[key];
  }
  return env;
}

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-pr167-${tag}-`));
  scopes.push(dir);
  return dir;
}

const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const tail = text => String(text || '').trim().slice(-300);

/** npm / gh / docker 的网络类失败归为环境缺口，其余（如 E404）按真实失败处理。 */
function networkLike(text) {
  return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|network|getaddrinfo|socket hang up|TLS handshake timeout|i\/o timeout/i.test(String(text || ''));
}

const fixturePath = rel => join(FIXTURE, rel);
const readJsonFile = path => JSON.parse(readFileSync(path, 'utf8'));

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

const installSpec = (version, tarballPath) => (SELF_TEST ? tarballPath : `${PKG}@${version}`);

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

/** 发布提交（或自测的工作区）中某目录下的文件清单（相对该目录）。 */
function filesAtCommit(commit, dir) {
  if (commit === 'WORKTREE') return new Set(walkFiles(join(repoRoot, dir)));
  const r = run('git', ['ls-tree', '-r', '--name-only', commit, '--', dir]);
  if (r.status !== 0) throw new Error(`git ls-tree ${commit} ${dir} 失败：${tail(r.stderr)}`);
  return new Set(r.stdout.split('\n').filter(Boolean).map(line => line.slice(dir.length + 1)));
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

const escapeHtml = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 去标签、解实体后的页面纯文本（代码块按 token 拆成多个 span 时，原文只在纯文本中连续出现）。 */
function pageText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}
/** 页面是否含该文本：原文、其 HTML 转义形式或去标签纯文本中任一在场即可。 */
function pageHas(page, text) {
  return page.body.includes(text) || page.body.includes(escapeHtml(text)) || page.body.includes(text.replace(/'/g, '&#39;'))
    || page.text.includes(text);
}

async function sitePage(site, path) {
  const res = await httpGet(`${site}${path}`);
  return { ...res, text: res.status === 200 ? pageText(res.body) : '' };
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

// ── 共享上下文：V、提交号、registry tarball、宿主机隔离安装 ─────────────────────

const ctx = { identity: null, registry: null, host: null };

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

/** 宿主机一次性 prefix 安装（SMOKE-core-273 / 274 共用）；入口身份不符直接失败。 */
function hostInstall() {
  if (ctx.host) return ctx.host;
  const { version } = ctx.identity;
  const reg = registryTarball();
  const prefix = newTempDir('prefix');
  const inst = run(npmBin, ['install', '-g', '--prefix', prefix, installSpec(version, reg.tarball)]);
  if (inst.status !== 0) {
    if (networkLike(inst.stderr)) throw new EnvGap(`npm 网络不可达：${tail(inst.stderr)}`, ['network:npm-registry']);
    throw new Error(`① 隔离安装失败：${tail(inst.stderr)}`);
  }
  const layout = installedLayout(prefix);
  const identity = entryIdentityProblems(layout);
  if (identity.length > 0) throw new Error(`① ${identity.join('；')}`);
  ctx.host = { prefix, layout };
  return ctx.host;
}

/** 以已安装入口运行环境能力检查（registry / deploy 场景），返回 { problems, gaps, evidence }。 */
function envCapability(layout, scenario) {
  const { command, args } = entryCommand(layout, []);
  const r = run(process.execPath, [ENV_CHECK_SCRIPT, JSON.stringify({ command, args }), scenario]);
  const line = String(r.stdout || '').split('\n').reverse().find(l => l.startsWith('ENVCHECK_RESULT='));
  if (!line) throw new Error(`环境能力检查未产出结构化结果（exit ${r.status}）：${tail(r.stderr || r.stdout)}`);
  return JSON.parse(line.slice('ENVCHECK_RESULT='.length));
}

/**
 * SMOKE-core-275 容器内脚本（CommonJS，以 `node /smoke/c275.cjs <安装规格> <V>` 在 node:20 容器内以非 root 用户运行）：
 * 安装后以同一份 env-capability-check（只读挂载为 /smoke/envcheck.cjs）复跑 registry 与 deploy 两个场景。
 * 只把结构化结果以 `SMOKE275_RESULT=<json>` 一行打印到 stdout。
 */
const CONTAINER_SCRIPT = `'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const [spec, V] = process.argv.slice(2);
const out = { uid: process.getuid(), steps: {}, gaps: [], problems: [], scenarios: {} };
const finish = () => { process.stdout.write('\\nSMOKE275_RESULT=' + JSON.stringify(out) + '\\n'); process.exit(0); };
const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 900000, maxBuffer: 64 * 1024 * 1024, ...opts });
const tail = t => String(t || '').trim().slice(-300);
const netLike = t => /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|network|getaddrinfo|socket hang up/i.test(String(t || ''));
try {
  if (out.uid === 0) { out.problems.push('① 容器内 uid 为 0，应以非 root 用户执行'); finish(); }
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'pr167-275-'));
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
  for (const scenario of ['registry', 'deploy']) {
    const r = sh(process.execPath, ['/smoke/envcheck.cjs', JSON.stringify({ command: bin, args: [] }), scenario]);
    const line = String(r.stdout || '').split('\\n').reverse().find(l => l.startsWith('ENVCHECK_RESULT='));
    if (!line) { out.problems.push(scenario + ' 未产出结构化结果：' + tail(r.stderr || r.stdout)); continue; }
    const res = JSON.parse(line.slice('ENVCHECK_RESULT='.length));
    out.scenarios[scenario] = { problems: res.problems.length, gaps: res.gaps };
    const label = scenario === 'registry' ? '③(273④⑤)' : '④(274)';
    for (const p of res.problems) out.problems.push(label + ' ' + p);
    for (const g of res.gaps) out.gaps.push(label + ' ' + g);
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

const siteBase = () => (SITE_OVERRIDE || DEFAULT_SITE).replace(/\/$/, '');

// ── 用例 ─────────────────────────────────────────────────────────────────────

const CASES = {
  'SMOKE-core-272': async () => {
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
    // 环境能力随包：四个命令与部署账本实现、dist/index.js 注册、guard 受限命令识别
    for (const rel of ['dist/commands/env.js', 'dist/commands/deploy.js', 'dist/commands/approve.js', 'dist/commands/deploy-done.js', 'dist/lib/deployment-ledger.js']) {
      if (!existsSync(join(pkg, rel))) problems.push(`③ 包内缺 ${rel}`);
    }
    const index = readFileSync(join(pkg, 'dist/index.js'), 'utf8');
    for (const command of ['env', 'deploy', 'approve']) {
      if (!new RegExp(`case '${command}'`).test(index)) problems.push(`③ 包内 dist/index.js 未注册 ${command}`);
    }
    const guardPath = join(pkg, 'claude-plugin-template/bin/guard-check');
    const guard = existsSync(guardPath) ? readFileSync(guardPath, 'utf8') : '';
    if (!guard) problems.push('③ 包内缺 claude-plugin-template/bin/guard-check');
    else for (const needle of ['approve', 'force-promote']) {
      if (!guard.includes(needle)) problems.push(`③ 包内 guard-check 受限命令清单缺 ${needle} 识别`);
    }
    const sources = filesAtCommit(commit, 'cli/src');
    const orphans = walkFiles(join(pkg, 'dist')).filter(f => f.endsWith('.js'))
      .filter(f => !sources.has(f.replace(/\.js$/, '.ts')));
    if (orphans.length > 0) problems.push(`④ dist 中无源文件的产物：${orphans.slice(0, 5).join(', ')}${orphans.length > 5 ? ' …' : ''}`);
    // ⑤ 0.16.3～0.16.6 从未进入 registry
    for (const v of NEVER_PUBLIC) {
      const never = npmVersionPresence(v);
      if (!never.e404) problems.push(`⑤ registry 存在 ${PKG}@${v}（version=${never.version}），本机候选版本被意外发布，需由用户决定处置`);
    }
    // SMOKE-core-04 口径：插件模板随包
    const templates = ['claude-plugin-template', 'opencode-plugin-template', 'codex-plugin-template'];
    const missingTemplates = templates.filter(t => !existsSync(join(pkg, t)));
    if (missingTemplates.length > 0) problems.push(`SMOKE-core-04 口径：缺插件模板 ${missingTemplates.join(', ')}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `registry ${PKG}@${version}：latest 指向 V，SLSA provenance 来源为 refs/tags/v${version} 且 gitCommit 等于 tag 提交；包内版本与 manifest 自洽，含 env / deploy / approve / deploy-done 命令与部署账本实现、guard 受限命令识别，无孤儿 dist 产物，插件模板随包；${NEVER_PUBLIC.join(' / ')} 均返回 E404`,
      evidence: [`V=${version}`, `commit=${commit}`, `registry_tarball_sha256=${reg.sha256}`, `dist_tags=${JSON.stringify(tags)}`,
        `integrity=${view['dist.integrity'] ?? ''}`, `never_public_e404=${NEVER_PUBLIC.join(',')}`, 'reused=SMOKE-core-04'],
    };
  },

  'SMOKE-core-273': async () => {
    const { version } = ctx.identity;
    const { prefix, layout } = hostInstall();
    const problems = [];
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
    // ③ SMOKE-core-02 口径：init all 后 sync，再 status
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
      for (const p of statusEnvelopeProblems(cli(allDir, ['status', '--format', 'json']), version)) problems.push(`③ ${p}`);
    }
    if (problems.length > 0) throw new Error(`${problems.join('；')}（调用：${calls.join(', ')}）`);
    // ④⑤ 环境登记全链路与提案默认环境（SMOKE-core-252 / 264 口径）
    const env = envCapability(layout, 'registry');
    const evidence = [`V=${version}`, `host_platform=${process.platform}`, `prefix=${prefix}`, `entry=${layout.entry}`, `entry_kind=${layout.kind}`,
      `calls=${calls.join(',')}`, `env_check=${JSON.stringify(env.evidence).slice(0, 1500)}`, 'reused=SMOKE-core-01,SMOKE-core-02'];
    if (env.problems.length > 0) throw Object.assign(new Error(env.problems.join('；')), { evidence });
    if (env.gaps.length > 0) throw Object.assign(new EnvGap(`环境能力检查缺少工具：${env.gaps.join(', ')}`, env.gaps), { evidence });
    return {
      detail: `宿主机（${process.platform}）隔离 prefix 从 ${SELF_TEST ? '夹具 tarball' : 'registry'} 安装 V，经真实入口执行：版本一致，init all 生成资产与 reference 子目录，sync 无 manifest 错误，status 成功 envelope 合法；env check 通过、proposal_default_env 输出并只标注 test，deploy-done --env 生产 → smoke --env prod 为 declared / verified，env show 一致`,
      evidence,
    };
  },

  'SMOKE-core-274': async () => {
    const { version } = ctx.identity;
    const { prefix, layout } = hostInstall();
    const env = envCapability(layout, 'deploy');
    const evidence = [`V=${version}`, `host_platform=${process.platform}`, `prefix=${prefix}`, `entry=${layout.entry}`,
      `env_check=${JSON.stringify(env.evidence).slice(0, 2000)}`];
    if (env.problems.length > 0) throw Object.assign(new Error(env.problems.join('；')), { evidence });
    if (env.gaps.length > 0) throw Object.assign(new EnvGap(`环境能力检查缺少工具：${env.gaps.join(', ')}`, env.gaps), { evidence });
    return {
      detail: '宿主机公网包：dry-run 零执行；staging 版本通道在请求 commit 的隔离工作树中执行（不含未提交改动），回滚到 v1；上游未验证时 prod 晋级零执行；staging smoke 验证后未审批零执行并给出 approve 命令；审批幂等，审批后部署成功并记录 promoted_from 与 approval_id',
      evidence,
    };
  },

  'SMOKE-core-275': async () => {
    const { version } = ctx.identity;
    const docker = run('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 60_000 });
    if (docker.error || docker.status !== 0) {
      throw new EnvGap(`docker 不可用：${docker.error ? docker.error.message : tail(docker.stderr)}`, ['docker']);
    }
    const digest = linuxImageDigest();
    const dir = newTempDir('linux');
    writeFileSync(join(dir, 'c275.cjs'), CONTAINER_SCRIPT);
    copyFileSync(ENV_CHECK_SCRIPT, join(dir, 'envcheck.cjs'));
    let spec = `${PKG}@${version}`;
    if (SELF_TEST) {
      copyFileSync(registryTarball().tarball, join(dir, 'pkg.tgz'));
      spec = '/smoke/pkg.tgz';
    }
    // 一次性容器（--rm）；node:20 内置非 root 用户 node；脚本目录只读挂载
    const r = run('docker', ['run', '--rm', '--user', 'node', '-v', `${dir}:/smoke:ro`, LINUX_IMAGE, 'node', '/smoke/c275.cjs', spec, version]);
    const line = String(r.stdout || '').split('\n').reverse().find(l => l.startsWith('SMOKE275_RESULT='));
    if (!line) {
      const text = `${r.stdout}\n${r.stderr}`;
      if (r.error || networkLike(text)) throw new EnvGap(`docker 容器未能运行：${r.error ? r.error.message : tail(r.stderr)}`, ['docker-run']);
      throw new Error(`容器未产出结构化结果（exit ${r.status}）：${tail(r.stderr || r.stdout)}`);
    }
    const res = JSON.parse(line.slice('SMOKE275_RESULT='.length));
    const evidence = [`V=${version}`, `image=${digest}`, `docker_server=${docker.stdout.trim()}`, `uid=${res.uid}`,
      `steps=${JSON.stringify(res.steps)}`, `scenarios=${JSON.stringify(res.scenarios)}`.slice(0, 1500)];
    if (res.problems.length > 0) throw Object.assign(new Error(res.problems.join('；')), { evidence });
    if (res.gaps.length > 0) throw Object.assign(new EnvGap(`容器内环境构造未完成：${res.gaps.join(', ')}`, res.gaps), { evidence });
    return {
      detail: `docker ${LINUX_IMAGE} 一次性容器内以 uid ${res.uid} 从 ${SELF_TEST ? '夹具 tarball' : 'registry'} 安装 V：环境登记全链路与提案默认环境（273 ④⑤）、script 部署 / 回滚 / 晋级 / 审批（274）与宿主机同口径通过`,
      evidence,
    };
  },

  'SMOKE-core-276': async () => {
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
      for (const keyword of RELEASE_NOTE_KEYWORDS) {
        if (!notes.includes(keyword)) problems.push(`④ 正文缺「${keyword}」`);
      }
      if (notes.includes('未发布到 npm')) problems.push('④ 正文含「未发布到 npm」');
    }
    // ⑤ v0.16.3～v0.16.6 从未有 Release
    for (const v of NEVER_PUBLIC) {
      const never = ghReleaseByTagPresence(v);
      if (!never.notFound) problems.push(`⑤ 存在 v${v} 的 GitHub Release（${never.tag}），未公开版本被意外发布，需由用户决定处置`);
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `GitHub Release v${version} 为 latest、非 draft / prerelease，附件与 registry tarball 同源，正文与 CHANGELOG 一致，含环境能力与「从 0.16.2 升级」指引；${NEVER_PUBLIC.map(v => `v${v}`).join(' / ')} 均无 Release`,
      evidence: [`V=${version}`, `release_asset_sha256=${assetSha}`, `registry_tarball_sha256=${reg.sha256}`, `latest=${latest}`,
        `never_public_release_404=${NEVER_PUBLIC.join(',')}`],
    };
  },

  'SMOKE-core-277': async () => {
    const { version, commit } = ctx.identity;
    const site = siteBase();
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
    // ③ 发布提交的英文摘要：有 V 键、无 0.16.3～0.16.6 键
    const summaries = fileAtCommit(commit, 'website/src/data/release-summaries-en.mjs');
    if (!hasSummaryKey(summaries, version)) problems.push(`③ release-summaries-en.mjs 无 '${version}' 键`);
    for (const v of NEVER_PUBLIC) {
      if (hasSummaryKey(summaries, v)) problems.push(`③ release-summaries-en.mjs 含从未公开的 '${v}' 键`);
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `官网 ${site}：/releases 与 /zh/releases latest=V，V 展示英文摘要与中文原文，首页可进入发布动态；发布提交的英文摘要有 '${version}'、无 ${NEVER_PUBLIC.map(v => `'${v}'`).join(' / ')}`,
      evidence: [`V=${version}`, `site=${site}`, ...statuses, 'reused=SMOKE-core-07,SMOKE-core-08,SMOKE-core-15'],
    };
  },

  'SMOKE-core-278': async () => {
    const { version, commit } = ctx.identity;
    const site = siteBase();
    const problems = [];
    const statuses = [];
    // ① 中英文新页可达、内容在场；中文页 lang=zh-CN；英文页渲染语言切换器（SMOKE-core-21 口径）
    for (const lang of ['', '/zh']) {
      for (const { path, must } of NEW_PAGES) {
        const url = `${lang}${path}`;
        const page = await sitePage(site, url);
        statuses.push(`${url}=${page.status}`);
        if (page.status !== 200) { problems.push(`① ${url} HTTP ${page.status}`); continue; }
        const missing = must.filter(text => !pageHas(page, text));
        if (missing.length > 0) problems.push(`① ${url} 缺 ${missing.map(t => `「${t}」`).join('、')}`);
        if (lang === '/zh' && !/<html[^>]*\blang="zh-CN"/.test(page.body)) problems.push(`① ${url} 的 <html lang> 不是 zh-CN`);
        if (!page.text.includes('简体中文')) problems.push(`① ${url} 未渲染含「简体中文」入口的语言切换器`);
      }
    }
    // SMOKE-core-21 原定义访问的中文路由：均非 404；其中文档页（首页 /zh 之外）为 <html lang="zh-CN">
    for (const url of ZH_ROUTES) {
      const page = await sitePage(site, url);
      statuses.push(`${url}=${page.status}`);
      if (page.status !== 200) problems.push(`SMOKE-core-21 口径：${url} HTTP ${page.status}`);
      else if (url !== '/zh' && !/<html[^>]*\blang="zh-CN"/.test(page.body)) problems.push(`SMOKE-core-21 口径：中文文档页 ${url} 的 <html lang> 不是 zh-CN`);
    }
    // ② 侧边栏进入新页
    for (const lang of ['', '/zh']) {
      const url = `${lang}/cli/`;
      const page = await sitePage(site, url);
      statuses.push(`${url}=${page.status}`);
      if (page.status !== 200) { problems.push(`② ${url} HTTP ${page.status}`); continue; }
      for (const { path } of NEW_PAGES) {
        const target = `${lang}${path}`;
        if (!page.body.includes(`href="${target}"`) && !page.body.includes(`href="${target.replace(/\/$/, '')}"`)) {
          problems.push(`② ${url} 侧边栏无指向 ${target} 的链接`);
        }
      }
    }
    // ③ 发布提交含中英文四份源文件
    const docs = filesAtCommit(commit, 'website/src/content/docs');
    for (const lang of ['', 'zh/']) {
      for (const src of NEW_SOURCES) {
        if (!docs.has(`${lang}${src}`)) problems.push(`③ 发布提交缺 website/src/content/docs/${lang}${src}`);
      }
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `官网 ${site}：中英文 env / deploy / approve / environments 八页可达、必含内容在场、中文页 lang=zh-CN、语言切换器在场，/cli 侧边栏可进入；发布提交含两种语言的源文件`,
      evidence: [`V=${version}`, `site=${site}`, ...statuses, 'reused=SMOKE-core-21'],
    };
  },

  'SMOKE-core-279': async () => {
    const { version } = ctx.identity;
    const site = siteBase();
    const problems = [];
    const statuses = [];
    for (const { path, must } of REVISED_PAGES) {
      const hits = {};
      for (const lang of ['', '/zh']) {
        const url = `${lang}${path}`;
        const page = await sitePage(site, url);
        statuses.push(`${url}=${page.status}`);
        if (page.status !== 200) { problems.push(`${url} HTTP ${page.status}`); continue; }
        hits[lang || 'en'] = must.filter(text => pageHas(page, text));
        const missing = must.filter(text => !hits[lang || 'en'].includes(text));
        if (missing.length > 0) problems.push(`${url} 缺 ${missing.map(t => `「${t}」`).join('、')}`);
      }
      if (hits.en && hits['/zh'] && JSON.stringify(hits.en) !== JSON.stringify(hits['/zh'])) {
        problems.push(`${path} 中英文命中项不一致：en=${JSON.stringify(hits.en)} zh=${JSON.stringify(hits['/zh'])}`);
      }
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `官网 ${site}：deploy-done / smoke / status / ignore-exempt / change-management / deployment-executor / change-writer 中英文页均已补环境能力`,
      evidence: [`V=${version}`, `site=${site}`, ...statuses],
    };
  },
};

export const PUBLIC_RELEASE_0167_SMOKE_IDS = Object.keys(CASES);
const PUBLIC_RELEASE_SMOKE_IDS = PUBLIC_RELEASE_0167_SMOKE_IDS;

// ── 执行与留痕 ───────────────────────────────────────────────────────────────

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of PUBLIC_RELEASE_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
    const record = { id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT };
    // target_environment 只声明本次实际验证的环境；skip 记录不声明
    if (row.status !== 'skip' && TARGET_ENV) record.target_environment = TARGET_ENV;
    record.detail = row.detail;
    record.evidence = row.evidence;
    if (row.status === 'skip') {
      record.not_applicable_reason = row.detail;
      record.missing_requirements = row.missing ?? [];
    }
    appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  }
}

const outcome = (error, started, evidence = []) => {
  const ev = error?.evidence ?? evidence;
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

const notPassed = PUBLIC_RELEASE_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass');
if (notPassed.length > 0) {
  console.error(`smoke 未全部通过：${notPassed.map(id => `${id}(${results.get(id)?.status})`).join(', ')}`);
  for (const id of notPassed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
console.log(`smoke 通过：${PUBLIC_RELEASE_SMOKE_IDS.join(', ')}`);
process.exit(0);
