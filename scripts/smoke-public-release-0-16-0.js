#!/usr/bin/env node
/**
 * SMOKE-core-231～SMOKE-core-234 — 首次公开发布（release-0-16-0）的**公网制品**取证。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.0 公开发布 smoke（SMOKE-core-231～234）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.0 公开发布方案（npm / GitHub Release / 官网）」。
 *
 *   - SMOKE-core-231：registry 发布身份与 provenance（含 SMOKE-core-04 口径：插件模板随包）。
 *   - SMOKE-core-232：registry 隔离安装态可用（含 SMOKE-core-01 / 02 口径）。
 *   - SMOKE-core-233：GitHub Release 与 registry 同源。
 *   - SMOKE-core-234：官网 latest 等于 V、英文摘要在场、改名资源可访问（含 SMOKE-core-07 / 08 / 15 口径）。
 *
 * 复用用例 SMOKE-core-01 / 02 / 04 由 scripts/smoke-core-cli.js、07 / 08 / 15 由 website/scripts/smoke-releases.mjs
 * 认领记录。本 runner 在上述用例内按其口径执行判定、在 evidence 中注明，不为它们另写记录（每个 ID 只有一条结果）。
 *
 * **版本口径**：V 为实际成功发布的版本，从部署记录 logos/resources/verify/deployment-report.md 的
 * `public_release_version: <V>` 行读取；tag 提交号优先取同文件 `public_release_commit: <sha>` 行，缺省时取
 * `git rev-parse v<V>^{commit}`。断言全部写成关系式，不硬编码版本号。缺 V 或缺提交号时写显式 skip 并带缺失项。
 *
 * **执行边界**：公网只读——只用 `npm view`、`npm pack <spec>`（下载到临时目录）、`gh release view` /
 * `gh release download`、`gh api`、HTTP GET；不执行任何发布写操作。安装态只装到 `mktemp -d` 一次性 prefix，
 * 结束即删除，不触碰本机全局 prefix、本仓活跃提案与用户其他仓库。网络不可达、`gh` 未认证属可补齐的环境缺口：
 * 写显式 skip（`missing_requirements` 列出缺失项），**不**标 `reason_code:"platform-unavailable"`。
 *
 * **窗口**：活跃提案为本 slug，或 OPENLOGOS_PUBLIC_RELEASE_SMOKE=1；窗口之外按既有留痕机制为全部 owned ID 写 skip。
 *
 * **自测模式**（仅供 runner 自身验证，须同时满足）：OPENLOGOS_PUBLIC_RELEASE_SELF_TEST=1、
 * OPENLOGOS_PUBLIC_RELEASE_FIXTURE=<夹具目录>、OPENLOGOS_PUBLIC_RELEASE_SITE=<本地预览 URL>，且
 * OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本。夹具目录以本地文件替代公网读取：
 *   release.json（{ version, commit }；commit 为 "WORKTREE" 时 CHANGELOG 与源码清单取工作区）、
 *   npm-dist-tags.json、npm-view.json、npm-attestations.json（provenance 证明）、package.tgz（替代 registry tarball 与安装规格）、
 *   gh-release.json、gh-latest.txt、gh-assets/（Release 附件）。
 * 正式模式拒绝上述注入；结果以 environment=self-test-fixture 写入。
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

const SLUG = 'release-0-16-0';
const PKG = '@miniidealab/openlogos';
const REPO = 'miniidealab/openlogos';
const DEFAULT_SITE = 'https://openlogos.ai';
const OWNED = ['SMOKE-core-231', 'SMOKE-core-232', 'SMOKE-core-233', 'SMOKE-core-234'];
const RENAMED_IMAGE = '/runlogos/4.db-editor.sqlite-postgresql-mysql.jpg';
const OLD_IMAGE = '/runlogos/4.db-editor(sqllite:postgresql:mysql).jpg';
const FALLBACK_MESSAGE = 'Structured release summary unavailable for this version.';
const REFERENCE_DIRS = ['requirement', 'todolist', 'code', 'image', 'temp', 'note'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_PUBLIC_RELEASE_SELF_TEST === '1';
const FIXTURE = process.env.OPENLOGOS_PUBLIC_RELEASE_FIXTURE;
const SITE_OVERRIDE = process.env.OPENLOGOS_PUBLIC_RELEASE_SITE;
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
  refuse('设置了 OPENLOGOS_PUBLIC_RELEASE_FIXTURE / _SITE 但未声明自测（OPENLOGOS_PUBLIC_RELEASE_SELF_TEST=1）');
}
if (SELF_TEST && (!FIXTURE || !SITE_OVERRIDE)) refuse('自测模式需要同时提供 OPENLOGOS_PUBLIC_RELEASE_FIXTURE 与 OPENLOGOS_PUBLIC_RELEASE_SITE');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_PUBLIC_RELEASE_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案公开发布验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_PUBLIC_RELEASE_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_PUBLIC_RELEASE_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

// ── 通用工具 ───────────────────────────────────────────────────────────────────

/** 环境缺口：写 skip 而非 fail。 */
class EnvGap extends Error {
  constructor(message, missing) { super(message); this.missing = missing; }
}

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, {
  cwd: opts.cwd ?? repoRoot, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: opts.env ?? isolatedEnv(),
});

/** 子命令剥离外层 smoke 账本与本 runner 的控制变量，避免夹具项目把记录写进外层账本。 */
function isolatedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key.startsWith('OPENLOGOS_PUBLIC_RELEASE_')) delete env[key];
  }
  return env;
}

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-public-${tag}-`));
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
  const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '';
  const version = /public_release_version:\s*`?(\d+\.\d+\.\d+)`?/.exec(report)?.[1] ?? null;
  if (!version) throw new EnvGap('部署记录缺少 `public_release_version: <V>` 行', ['deployment-report:public_release_version']);
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

// ── 用例 ─────────────────────────────────────────────────────────────────────

const CASES = {
  'SMOKE-core-231': async () => {
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
    // SMOKE-core-04 口径：插件模板随包
    const templates = ['claude-plugin-template', 'opencode-plugin-template', 'codex-plugin-template'];
    const missingTemplates = templates.filter(t => !existsSync(join(pkg, t)));
    if (missingTemplates.length > 0) problems.push(`SMOKE-core-04 口径：缺插件模板 ${missingTemplates.join(', ')}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `registry ${PKG}@${version}：latest 指向 V，SLSA provenance 来源为 refs/tags/v${version} 且 gitCommit 等于 tag 提交；包内版本与 manifest 自洽，无孤儿 dist 产物，插件模板随包`,
      evidence: [`V=${version}`, `commit=${commit}`, `registry_tarball_sha256=${reg.sha256}`, `dist_tags=${JSON.stringify(tags)}`,
        `integrity=${view['dist.integrity'] ?? ''}`, 'reused=SMOKE-core-04'],
    };
  },

  'SMOKE-core-232': async () => {
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
    return {
      detail: `隔离 prefix 从 ${SELF_TEST ? '夹具 tarball' : 'registry'} 安装 V，经真实入口执行：版本一致，init all 生成资产与 reference 子目录，sync 无 manifest 错误，托管 guard 与随包模板一致，status 成功 envelope 合法`,
      evidence: [`V=${version}`, `prefix=${prefix}`, `entry=${layout.entry}`, `entry_kind=${layout.kind}`, `calls=${calls.join(',')}`,
        'reused=SMOKE-core-01,SMOKE-core-02'],
    };
  },

  'SMOKE-core-233': async () => {
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
      if (!notes.includes('从 0.13.x 升级') || !notes.includes('openlogos sync')) problems.push('④ 正文缺「从 0.13.x 升级」或 openlogos sync 指引');
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `GitHub Release v${version} 为 latest、非 draft / prerelease，附件与 registry tarball 同源，正文与 CHANGELOG 一致并含升级指引`,
      evidence: [`V=${version}`, `release_asset_sha256=${assetSha}`, `registry_tarball_sha256=${reg.sha256}`, `latest=${latest}`],
    };
  },

  'SMOKE-core-234': async () => {
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
    // ③④ 改名资源
    for (const path of ['/runlogos', '/zh/runlogos']) {
      const page = await httpGet(`${site}${path}`);
      statuses.push(`${path}=${page.status}`);
      if (page.status !== 200) { problems.push(`③ ${path} HTTP ${page.status}`); continue; }
      const src = /id="cap1-db"[^>]*>\s*<img[^>]*src="([^"]+)"/.exec(page.body)?.[1] ?? null;
      if (src !== RENAMED_IMAGE) problems.push(`③ ${path} 数据库编辑器图片 src=${src}，应为 ${RENAMED_IMAGE}`);
    }
    const img = await httpGet(`${site}${RENAMED_IMAGE}`);
    statuses.push(`image=${img.status}`);
    if (img.status !== 200 || !img.contentType.startsWith('image/jpeg')) problems.push(`④ 改名图片 HTTP ${img.status} ${img.contentType}`);
    let oldStatus = 'n/a';
    try { oldStatus = String((await httpGet(`${site}${encodeURI(OLD_IMAGE)}`)).status); } catch { oldStatus = 'unreachable'; }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `官网 ${site}：/releases 与 /zh/releases latest=V，V 展示英文摘要与中文原文，首页可进入发布动态，改名图片可访问`,
      evidence: [`V=${version}`, `site=${site}`, ...statuses, `old_image_status=${oldStatus}`, 'reused=SMOKE-core-07,SMOKE-core-08,SMOKE-core-15'],
    };
  },
};

export const PUBLIC_RELEASE_SMOKE_IDS = Object.keys(CASES);

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
    if (row.status === 'skip') {
      record.not_applicable_reason = row.detail;
      record.missing_requirements = row.missing ?? [];
    }
    appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  }
}

const outcome = (error, started, evidence = []) => (error instanceof EnvGap
  ? { status: 'skip', detail: error.message, missing: error.missing, evidence, duration_ms: Date.now() - started }
  : { status: 'fail', detail: error instanceof Error ? error.message : String(error), evidence, duration_ms: Date.now() - started });

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
