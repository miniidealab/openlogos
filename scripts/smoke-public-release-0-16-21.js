#!/usr/bin/env node
/** OpenLogos 0.16.21 公开发布取证。公网操作均为读取，安装与夹具限于临时目录。 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { provenanceSourceProblems } from './lib/public-release-checks.mjs';
import { recordSmokeNotApplicable, smokeResultPath } from './lib/smoke-not-applicable.mjs';
import {
  checked, checkInstalledVersion, execute, InstallUnavailable, networkError, npmBin, readJson, requireExit,
} from './lib/public-release-1621-install.mjs';

const slug = 'release-0-16-21';
const pkg = '@miniidealab/openlogos';
const repo = 'miniidealab/openlogos';
const site = 'https://openlogos.ai';
const image = 'node:20';
const localVersions = Array.from({ length: 13 }, (_, i) => '0.16.' + (i + 8));
const artifacts = [
  'dist/commands/knowledge.js', 'dist/commands/history.js', 'dist/commands/branch.js',
  'dist/lib/verification-history.js', 'dist/lib/result-path-lock.js',
];
const templates = ['claude-plugin-template', 'opencode-plugin-template', 'codex-plugin-template'];
const docs = [
  ['cli/knowledge', ['knowledge apply', 'knowledge list']],
  ['cli/history', ['history list', 'history show', 'run_id']],
  ['cli/branch', ['branch status', 'branch sync']],
  ['specs/branch-sync', ['branch_sync', 'branch_sync.replace_paths']],
  ['concepts/enterprise-knowledge', ['KXX', 'KXX-Rn', 'logos/resources/knowledge/']],
];

export const PUBLIC_RELEASE_01621_SMOKE_IDS = [
  'SMOKE-core-328', 'SMOKE-core-329', 'SMOKE-core-330', 'SMOKE-core-331', 'SMOKE-core-332', 'SMOKE-core-333',
];

const detail = r => String(r.stderr || r.stdout || r.error?.message || '').trim().slice(-500);
const hash = (bytes, method = 'sha256', encoding = 'hex') => createHash(method).update(bytes).digest(encoding);
const envGap = (message, key) => new InstallUnavailable(message, [key]);

function readIdentity(root) {
  const path = join(root, 'logos/resources/verify/deployment-report.md');
  const sections = existsSync(path) ? readFileSync(path, 'utf8').split(/(?=^# )/m) : [];
  const section = sections.reverse().find(s => s.split('\n', 1)[0].includes(slug));
  const version = section?.match(/^public_release_version:\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m)?.[1];
  const commit = section?.match(/^public_release_commit:\s*([0-9a-f]{40})\s*$/m)?.[1];
  if (!version || !commit) throw envGap('缺少本提案的实际公开版本或 tag 提交号', 'deployment-report:' + slug);
  // 冻结记录可用 dist-tags JSON 或 old=… 表示；null/无 表示部署前没有该指针。
  const jsonOld = section.match(/"old"\s*:\s*(?:"([^"]+)"|(null))/);
  const old = (jsonOld?.[1] ?? jsonOld?.[2])
    ?? section.match(/(?:^|\s|[\x60、，,])old\s*=\s*[\x60"]?([\w.-]+|无)/m)?.[1]
    ?? section.match(/^public_release_old:\s*[\x60"]?([\w.-]+|无)/m)?.[1];
  if (old === undefined) throw envGap('部署记录缺少发布前 old dist-tag 值', 'deployment-report:dist-tags.old');
  const actual = execute('git', ['rev-parse', '--verify', 'refs/tags/v' + version + '^{commit}'], { cwd: root });
  if (actual.status !== 0) throw envGap('缺少本地发布 tag v' + version, 'git-tag:v' + version);
  checked(requireExit(actual, 0, '读取发布 tag') === commit, '部署记录与本地 tag 的提交不一致');
  return { version, commit, old: old === 'null' || old === '无' ? null : old };
}

function checkNetwork(r, service) {
  if (networkError(detail(r))) throw envGap(service + ' 不可达：' + detail(r), 'network:' + service);
}

async function get(url, service) {
  let response;
  try {
    response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    throw envGap(service + ' 无法读取：' + error.message, 'network:' + service);
  }
}

export function checkLinuxInstall(spec, version, { cwd = process.cwd(), tarball } = {}) {
  const inspect = args => execute('docker', args, { cwd });
  const daemon = inspect(['info', '--format', '{{.ServerVersion}}']);
  if (daemon.error || daemon.status !== 0) throw envGap('Docker 服务不可用：' + detail(daemon), 'docker');
  const imageArgs = ['image', 'inspect', '--format', '{{.Id}}', image];
  let inspected = inspect(imageArgs);
  if (inspected.status !== 0) {
    const pull = execute('docker', ['pull', image], { cwd, timeout: 240_000 });
    if (pull.error || pull.status !== 0) throw envGap('无法取得 Linux 镜像：' + detail(pull), 'docker:' + image);
    inspected = inspect(imageArgs);
  }
  const digest = requireExit(inspected, 0, '读取 Linux 镜像摘要');
  checked(/^sha256:[a-f0-9]{64}$/.test(digest), 'Linux 镜像返回了无效摘要');
  const lib = dirname(fileURLToPath(import.meta.url));
  const args = ['run', '--rm', '--user', 'node', '--mount', 'type=bind,src=' + join(lib, 'lib') + ',dst=/checks,readonly'];
  // 实际公网模式从 registry 安装；本地验证可将候选制品只读挂载到容器。
  if (tarball) args.push('--mount', 'type=bind,src=' + resolve(tarball) + ',dst=/candidate.tgz,readonly');
  args.push(digest, 'node', '/checks/public-release-1621-install.mjs', tarball ? '/candidate.tgz' : spec, version);
  const execution = execute('docker', args, { cwd, timeout: 480_000 });
  if (!execution.error && !execution.signal && [1, 3].includes(execution.status)) {
    const data = JSON.parse(execution.stderr.trim());
    const error = execution.status === 3 ? new InstallUnavailable(data.error, data.missing) : new Error(data.error);
    error.evidence = ['image=' + digest, 'docker_exit=' + execution.status, ...(data.evidence ?? [])];
    throw error;
  }
  const summary = JSON.parse(requireExit(execution, 0, 'Linux 隔离安装态'));
  checked(Number.isInteger(summary.uid) && summary.uid > 0 && Array.isArray(summary.evidence), 'Linux 未回报非 root 夹具证据');
  return ['image=' + digest, 'uid=' + summary.uid, ...summary.evidence];
}

function formalOps(root, temporary, identity) {
  function npm(args, cwd = root) {
    const r = execute(npmBin, [...args, '--fetch-retries=0'], { cwd });
    checkNetwork(r, 'npm');
    return r;
  }
  function gh(args) {
    const r = execute('gh', args, { cwd: root });
    checkNetwork(r, 'github');
    if (r.error?.code === 'ENOENT' || r.status === 4 || /gh auth login|authentication required|bad credentials|HTTP 401/i.test(detail(r))) {
      throw envGap('缺少可用的 gh 认证', 'gh:auth');
    }
    return requireExit(r, 0, 'GitHub ' + args.slice(0, 2).join(' '));
  }
  const git = args => {
    const r = execute('git', args, { cwd: root });
    if (args[0] === 'ls-remote') checkNetwork(r, 'github');
    return requireExit(r, 0, 'git ' + args[0]);
  };
  return {
    async registry() {
      const tags = JSON.parse(requireExit(npm(['view', pkg, 'dist-tags', '--json']), 0, 'registry dist-tags'));
      const source = JSON.parse(requireExit(npm(['view', pkg + '@' + identity.version, 'version', 'gitHead', 'dist.integrity', 'dist.attestations', '--json']), 0, 'registry 版本'));
      const url = source['dist.attestations']?.url;
      checked(typeof url === 'string' && new URL(url).protocol === 'https:', '缺少可读取的 HTTPS provenance 地址');
      const attestation = await get(url, 'npm provenance');
      checked(attestation.status === 200, 'provenance HTTP ' + attestation.status);
      const absentVersions = localVersions.filter(v => {
        const r = npm(['view', pkg + '@' + v, 'version', '--json']);
        if (!r.error && !r.signal && r.status !== 0 && /\bE404\b/.test(r.stdout + '\n' + r.stderr)) return true;
        if (r.status !== 0 || r.error || r.signal) requireExit(r, 0, '查询历史版本 ' + v);
        return false;
      });
      const pack = npm(['pack', pkg + '@' + identity.version, '--json', '--pack-destination', temporary], temporary);
      const [packed] = JSON.parse(requireExit(pack, 0, '下载 registry tarball'));
      const expectedFile = 'miniidealab-openlogos-' + identity.version + '.tgz';
      checked(packed?.filename === expectedFile, 'npm pack 未返回预期文件');
      return { tags, source, attestations: JSON.parse(attestation.body), tarball: join(temporary, expectedFile), absentVersions };
    },
    async archive(tarball) {
      const list = requireExit(execute('tar', ['-tzf', tarball], { cwd: temporary }), 0, '读取包清单');
      const entries = list.split('\n').filter(Boolean);
      checked(entries.every(name => name.startsWith('package/') && !name.split('/').includes('..')), '包内路径异常');
      requireExit(execute('tar', ['-xzf', tarball], { cwd: temporary }), 0, '解包 registry 制品');
      const root = join(temporary, 'package');
      const manifest = readJson(join(root, 'asset-manifest.json'));
      const { validateAssetManifest } = await import(pathToFileURL(join(root, 'dist/lib/asset-manifest.js')).href);
      validateAssetManifest(manifest, root);
      const sources = git(['ls-tree', '-r', '--name-only', identity.commit, '--', 'cli/src']).split('\n');
      const paths = new Set(sources.map(p => p.slice('cli/src/'.length)));
      const files = entries.map(name => name.slice('package/'.length));
      checked(files.filter(p => p.startsWith('dist/') && p.endsWith('.js'))
        .every(p => paths.has(p.slice(5).replace(/\.js$/, '.ts'))), '包内存在没有源码对应的 dist 文件');
      return { packageJson: readJson(join(root, 'package.json')), manifest, files, root };
    },
    publishedRun() {
      const runs = JSON.parse(gh(['run', 'list', '--repo', repo, '--workflow', 'publish.yml', '--commit', identity.commit,
        '--limit', '30', '--json', 'databaseId,headBranch,headSha,event']));
      const run = runs.find(r => r.headSha === identity.commit && r.headBranch === 'v' + identity.version && r.event === 'push');
      checked(run?.databaseId, '找不到 tag 对应的 publish.yml run');
      const { jobs } = JSON.parse(gh(['run', 'view', String(run.databaseId), '--repo', repo, '--json', 'jobs']));
      checked(jobs.some(job => job.steps?.some(step => step.name === 'Publish' && step.conclusion === 'success')),
        'tag 对应的 publish.yml run 缺 Publish success');
      return run.databaseId;
    },
    host: () => {
      if (process.platform !== 'darwin') throw envGap('需要 macOS 宿主机执行安装态验收', 'host:macOS');
      return checkInstalledVersion(pkg + '@' + identity.version, identity.version);
    },
    linux: () => checkLinuxInstall(pkg + '@' + identity.version, identity.version, { cwd: root }),
    release() {
      const tag = 'v' + identity.version;
      const info = JSON.parse(gh(['release', 'view', tag, '--repo', repo, '--json', 'tagName,isDraft,isPrerelease,body,assets']));
      const latest = gh(['api', 'repos/' + repo + '/releases/latest', '--jq', '.tag_name']);
      const cliAssets = info.assets.filter(asset => /^miniidealab-openlogos-.*\.tgz$/.test(asset.name));
      checked(cliAssets.length === 1 && cliAssets[0].name === 'miniidealab-openlogos-' + identity.version + '.tgz',
        'Release 必须有唯一且同版本的 CLI 附件');
      const dir = join(temporary, 'release-assets');
      mkdirSync(dir);
      gh(['release', 'download', tag, '--repo', repo, '--pattern', cliAssets[0].name, '--dir', dir]);
      const remoteRef = git(['ls-remote', 'https://github.com/' + repo + '.git', 'refs/tags/' + tag + '^{}']);
      return { info, latest, commit: remoteRef.split(/\s+/)[0], bytes: readFileSync(join(dir, cliAssets[0].name)) };
    },
    source: path => git(['show', identity.commit + ':' + path]),
    page: path => get(site + path, 'website'),
  };
}

function text(html) {
  return html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '').replace(/&#(?:x([a-f0-9]+)|([0-9]+));/gi, (_, hex, dec) => String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec)))
    .replace(/&(?:lt|gt|quot|apos|nbsp|amp);/g, entity => ({ '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ', '&amp;': '&' })[entity])
    .replace(/\s+/g, ' ').trim();
}

function changelogSection(source, version) {
  const heading = '## [' + version + ']';
  const start = source.indexOf(heading);
  checked(start !== -1, 'tag 内缺少 CHANGELOG 发布节');
  const next = source.indexOf('\n## [', start + heading.length);
  return source.slice(start, next === -1 ? undefined : next).trim();
}

function summaryItems(source, version) {
  const start = source.indexOf("  '" + version + "': {");
  checked(start !== -1, 'tag 内缺少本版英文摘要');
  const entry = source.slice(start).split(/^  },\s*$/m, 1)[0];
  // 页面每组最多显示三条。摘要文件使用单引号字符串，每条独占一行。
  const groups = ['valueSummaryEn', 'fixSummaryEn'].map(key => {
    const group = entry.match(new RegExp(key + ':\\s*\\[([\\s\\S]*?)\\n\\s*\\]'))?.[1] ?? '';
    return [...group.matchAll(/^\s*'((?:[^'\\]|\\.)+)',?\s*$/gm)].slice(0, 3)
      .map(match => match[1].replace(/\\(['\\])/g, '$1'));
  });
  checked(groups[0].length > 0, '本版英文摘要为空');
  return groups.flat();
}

async function page(ops, path) {
  const response = await ops.page(path);
  checked(response.status === 200, path + ' HTTP ' + response.status);
  return response.body;
}

/** 执行与报告正式用例共用同一套断言。测试仅用注入的读取端模拟公网输入。 */
export async function runReleaseCases(identity, ops) {
  const version = identity.version;
  const tag = 'v' + version;
  const link = 'https://github.com/' + repo + '/releases/tag/' + tag;
  let registrySha;
  const cases = [
    async () => {
      const run = await ops.publishedRun();
      const record = await ops.registry();
      checked(record.tags.latest === version && (record.tags.old ?? null) === identity.old, 'registry latest 或发布前 old 指针不符');
      checked(record.source.version === version && (!record.source.gitHead || record.source.gitHead === identity.commit), 'registry 版本或 gitHead 不符');
      const provenance = provenanceSourceProblems(record.attestations, { repo, ...identity });
      checked(provenance.length === 0, provenance.join('；'));
      const bytes = readFileSync(record.tarball);
      checked(record.source['dist.integrity'] === 'sha512-' + hash(bytes, 'sha512', 'base64'), 'registry tarball integrity 不符');
      const unpacked = await ops.archive(record.tarball);
      checked(unpacked.packageJson.name === pkg && unpacked.packageJson.version === version && unpacked.manifest.version === version,
        '包名、包版本或 asset manifest 版本不符');
      for (const artifact of artifacts) checked(unpacked.files.includes(artifact), '包内缺 ' + artifact);
      for (const template of templates) checked(unpacked.files.some(path => path.startsWith(template + '/')), '包内缺 ' + template);
      checked(localVersions.every(v => record.absentVersions.includes(v)), '本机发布号已有公开制品或缺 E404 证据');
      registrySha = hash(bytes);
      return ['publish_run=' + run, 'tarball_sha256=' + registrySha, 'unpublished=' + localVersions.join(',')];
    },
    () => ops.host(),
    () => ops.linux(),
    async () => {
      const release = await ops.release();
      checked(release.info.tagName === tag && release.latest === tag && release.commit === identity.commit
        && release.info.isDraft === false && release.info.isPrerelease === false, 'GitHub Release 身份、tag 或 latest 不符');
      checked(hash(release.bytes) === registrySha, 'GitHub 附件与 registry SHA-256 不同');
      const notes = changelogSection(await ops.source('CHANGELOG.md'), version);
      checked(release.info.body.trim() === notes && notes.includes('从 0.16.7 升级') && !notes.includes('未发布到 npm'), 'GitHub Release 正文与已发布 CHANGELOG 不符');
      return ['release=' + tag, 'asset_sha256=' + registrySha];
    },
    async () => {
      const [home, english, chinese] = await Promise.all(['/', '/releases', '/zh/releases'].map(path => page(ops, path)));
      const homeLatest = home.match(/<div\b[^>]*class="[^"]*\bsummary-latest\b[^"]*"[^>]*>[\s\S]*?<strong[^>]*>\s*(v[\d.]+)/)?.[1];
      checked(homeLatest === tag && /href="\/releases\/?"/.test(home), '首页最近发布或发布动态入口不符');
      for (const releasePage of [english, chinese]) {
        const latest = releasePage.match(/class="[^"]*\blatest-version\b[^"]*"[^>]*>\s*(v[\d.]+)/)?.[1];
        checked(latest === tag && releasePage.includes('href="' + link + '"'), '发布页 latest 或 Release 链接不符');
        const headings = [...releasePage.matchAll(/<h3[^>]*>\s*v([\d.]+)\s*<\/h3>/g)].map(match => match[1]);
        checked(headings.includes(version) && !localVersions.some(value => headings.includes(value)), '公开发布时间线版本不符');
      }
      const summaries = summaryItems(await ops.source('website/src/data/release-summaries-en.mjs'), version);
      const article = [...english.matchAll(/<article\b[\s\S]*?<\/article>/g)]
        .map(match => match[0]).find(item => item.includes('Release summary for ' + tag));
      const summary = text(article ?? '');
      checked(summary && summaries.every(item => summary.includes(text(item))), '英文发布卡片缺少 tag 对应的摘要');
      checked(article.includes('summary-original'), '英文发布卡片缺少中文原文');
      return ['/:200', '/releases:200', '/zh/releases:200', 'latest=' + tag, 'summary=' + summaries[0]];
    },
    async () => {
      const evidence = [];
      for (const locale of ['', 'zh/']) {
        for (const [route, markers] of docs) {
          const url = '/' + locale + route + '/';
          const [html, source] = await Promise.all([page(ops, url), ops.source('website/src/content/docs/' + locale + route + '.md')]);
          const lang = locale ? 'zh-CN' : 'en';
          checked(new RegExp('<html\\b[^>]*\\blang="' + lang + '"').test(html), url + ' 页面语言不符');
          checked(html.includes('简体中文'), url + ' 缺少简体中文切换入口');
          const main = text(html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? '');
          checked(markers.every(marker => source.includes(marker) && main.includes(marker)), url + ' 缺少 tag 文档中的关键内容');
          const nav = html.match(/<nav\b[^>]*class="[^"]*\bsidebar\b[^"]*"[^>]*>[\s\S]*?<\/nav>/i)?.[0] ?? '';
          checked(docs.every(([path]) => nav.includes('href="/' + locale + path + '/"')), url + ' 侧边栏缺少同语言新页入口');
          evidence.push(url + ':200 ' + markers.join(','));
        }
      }
      for (const url of ['/zh', '/zh/getting-started', '/zh/cli']) {
        const html = await page(ops, url);
        if (url !== '/zh') checked(/<html\b[^>]*\blang="zh-CN"/.test(html), url + ' 中文文档页语言不符');
        checked(html.includes('简体中文'), url + ' 缺少简体中文切换入口');
        evidence.push(url + ':200');
      }
      return evidence;
    },
  ];
  const rows = [];
  for (const [index, run] of cases.entries()) {
    const start = Date.now();
    try {
      if (index >= 1 && index <= 3 && !registrySha) {
        if (rows[0].status === 'skip') throw new InstallUnavailable('缺少 registry 身份证据', rows[0].missing_requirements);
        throw new Error('registry 身份验证失败，无法验证同一制品');
      }
      const evidence = await run();
      rows.push(makeRow(index, start, 'pass', '公开发布断言通过', ['V=' + version, 'commit=' + identity.commit, ...evidence]));
    } catch (error) {
      rows.push(errorRow(index, start, error, ['V=' + version, 'commit=' + identity.commit]));
    }
  }
  return rows;
}

const environment = 'public-registry-github-site';
function makeRow(index, started, status, message, evidence, missing) {
  return {
    id: PUBLIC_RELEASE_01621_SMOKE_IDS[index], status, timestamp: new Date().toISOString(),
    duration_ms: Date.now() - started, environment, detail: message, evidence,
    ...(status === 'skip' ? { missing_requirements: missing, not_applicable_reason: message } : {}),
  };
}
function errorRow(index, start, error, evidence = []) {
  return makeRow(index, start, error instanceof InstallUnavailable ? 'skip' : 'fail', error.message,
    [...evidence, ...(error.evidence ?? [])], error.missing);
}

export function writeReleaseRows(path, rows, target) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, rows.map(row => JSON.stringify({
    ...row, ...(row.status !== 'skip' && target ? { target_environment: target } : {}),
  })).join('\n') + '\n');
}

async function main() {
  const root = process.cwd();
  const guardPath = join(root, 'logos/.openlogos-guard');
  let active;
  try { active = readJson(guardPath).activeChange; } catch { /* 无活跃提案 */ }
  if (active !== slug && process.env.OPENLOGOS_PR1621_SMOKE !== '1') {
    recordSmokeNotApplicable(PUBLIC_RELEASE_01621_SMOKE_IDS, {
      reason: '不在 ' + slug + ' 公开发布验收窗口', missing: ['active-change', 'OPENLOGOS_PR1621_SMOKE'], environment, repoRoot: root,
    });
    return;
  }
  const temporary = mkdtempSync(join(tmpdir(), 'openlogos-public-release-1621-'));
  const start = Date.now();
  let rows;
  try {
    const identity = readIdentity(root);
    rows = await runReleaseCases(identity, formalOps(root, temporary, identity));
  } catch (error) {
    rows = PUBLIC_RELEASE_01621_SMOKE_IDS.map((_, i) => errorRow(i, start, error));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  writeReleaseRows(smokeResultPath(root), rows, process.env.OPENLOGOS_SMOKE_ENV);
  for (const row of rows) console.log(row.id + ' ' + row.status + ' ' + row.detail);
  if (rows.some(row => row.status !== 'pass')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
