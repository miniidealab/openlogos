/** 0.16.22 公网制品、升级入口和 Windows 回归证据。 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checked, execute, requireExit } from './lib/public-release-1621-install.mjs';
import { provenanceSourceProblems } from './lib/public-release-checks.mjs';
import { recordSmokeNotApplicable, smokeResultPath } from './lib/smoke-not-applicable.mjs';
import { writeReleaseRows } from './smoke-public-release-0-16-21.js';

const slug = 'fix-public-upgrade-0-16-22';
const repo = 'miniidealab/openlogos';
const pkg = '@miniidealab%2fopenlogos';
const registry = 'https://registry.npmjs.org';
const mirror = 'https://registry.npmmirror.com';
const site = 'https://openlogos.ai';
const download = 'website/public/downloads/openlogos-upgrade.cjs';
const ids = ['SMOKE-core-334', 'SMOKE-core-335'];
const environment = 'public-registry-github-site';

function command(name, args) {
  return requireExit(execute(name, args), 0, name + ' ' + args.slice(0, 2).join(' '));
}

async function request(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  checked(response.ok, url + ' 返回 HTTP ' + response.status);
  return response;
}

async function mirrorEvidence(version) {
  const evidence = [];
  try {
    const latest = await (await request(mirror + '/' + pkg + '/latest')).json();
    evidence.push('mirror.latest=' + latest.version);
    const target = await (await request(mirror + '/' + pkg + '/' + version)).json();
    const tarball = await request(target.dist.tarball);
    const contents = Buffer.from(await tarball.arrayBuffer());
    const integrity = 'sha512-' + createHash('sha512').update(contents).digest('base64');
    evidence.push('mirror.tarball=' + target.dist.tarball, 'mirror.integrity=' + integrity);
  } catch (error) {
    evidence.push('mirror.未就绪=' + error.message);
  }
  return evidence;
}

function releaseIdentity(root) {
  const path = join(root, 'logos/resources/verify/deployment-report.md');
  if (!existsSync(path)) return null;
  const report = readFileSync(path, 'utf8');
  const section = report.split(/(?=^# )/m).reverse().find(part => part.split('\n', 1)[0].includes(slug));
  if (!section) return null;
  const version = section.match(/^public_release_version:\s*(0\.16\.22)\s*$/m)?.[1];
  const commit = section.match(/^public_release_commit:\s*([0-9a-f]{40})\s*$/m)?.[1];
  checked(version && commit, '缺少本提案的实际生产部署版本或提交号');
  const tag = 'v' + version;
  checked(command('git', ['rev-parse', '--verify', 'refs/tags/' + tag + '^{commit}']) === commit, '部署记录与本地 tag 不符');
  return { version, commit, tag };
}

async function checkPublic({ version, commit, tag }) {
  const dist = (await (await request(registry + '/' + pkg + '/' + version)).json()).dist;
  const tarball = Buffer.from(await (await request(dist.tarball)).arrayBuffer());
  const integrity = 'sha512-' + createHash('sha512').update(tarball).digest('base64');
  checked(dist.integrity === integrity, 'npm tarball 完整性不符');
  const attestations = await (await request(dist.attestations.url)).json();
  const problems = provenanceSourceProblems(attestations, { repo, version, commit });
  checked(problems.length === 0, problems.join('、'));

  const temporary = mkdtempSync(join(tmpdir(), 'openlogos-upgrade-release-'));
  try {
    command('gh', ['release', 'download', tag, '--repo', repo, '--pattern', '*.tgz', '--dir', temporary]);
    const assets = readdirSync(temporary);
    checked(assets.length === 1 && tarball.equals(readFileSync(join(temporary, assets[0]))), 'GitHub Release 与 npm tarball 字节不一致');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }

  const script = Buffer.from(await (await request(site + '/downloads/openlogos-upgrade.cjs')).arrayBuffer());
  const original = execute('git', ['show', commit + ':' + download]);
  requireExit(original, 0, '读取 tag 中的升级脚本');
  checked(script.equals(Buffer.from(original.stdout)), '官网下载脚本与发布提交字节不一致');
  for (const locale of ['', '/zh']) {
    const route = locale + '/getting-started/quick-start/';
    const page = await (await request(site + route)).text();
    checked(['openlogos-upgrade.cjs', registry, version].every(item => page.includes(item)), route + ' 缺少当前版本的官方源与升级脚本');
  }
  return ['npm.integrity=' + integrity, 'release=' + tag, 'script=' + download, ...await mirrorEvidence(version)];
}

function checkWindows({ version, commit }) {
  const runs = JSON.parse(command('gh', ['run', 'list', '--repo', repo, '--workflow', 'ci.yml', '--branch', 'master',
    '--commit', commit, '--json', 'databaseId,headSha,conclusion']));
  const run = runs.find(candidate => candidate.headSha === commit && candidate.conclusion === 'success');
  checked(run, '缺少与发布提交一致的成功 CI');
  const args = ['run', 'view', String(run.databaseId), '--repo', repo];
  const { jobs } = JSON.parse(command('gh', [...args, '--json', 'jobs']));
  const job = jobs.find(candidate => candidate.name === 'Windows regression' && candidate.conclusion === 'success');
  checked(job, '该次 CI 缺少成功的 Windows 回归');
  const log = command('gh', [...args, '--job', String(job.databaseId), '--log']);
  const evidence = [
    'Windows upgrade ST-S19-35: CMD ' + version + ' | ',
    'Windows upgrade ST-S19-36: CMD ' + version + ', machine and current directory shadows reported | ',
  ].map(marker => log.split('\n').find(line => line.includes(marker))?.split(marker)[1]?.trim());
  checked(evidence.every(path => path?.endsWith('openlogos.cmd')), 'Windows 日志缺少真实 CMD 版本和入口证据');
  return ['github.run=' + run.databaseId, 'github.job=' + job.databaseId, ...evidence];
}

const root = process.cwd();
let active;
try {
  active = JSON.parse(readFileSync(join(root, 'logos/.openlogos-guard'), 'utf8')).activeChange;
} catch { /* 无活跃提案时仅记录不适用。 */ }
async function main() {
  if (active !== slug) {
    recordSmokeNotApplicable(ids, { reason: '当前不在 ' + slug + ' 的公开验收窗口', environment, repoRoot: root });
    return;
  }
  let identity;
  let invalidIdentity;
  try { identity = releaseIdentity(root); } catch (error) { invalidIdentity = error; }
  if (!identity && !invalidIdentity) {
    recordSmokeNotApplicable(ids, {
      reason: '等待本提案的正式生产部署记录', missing: ['deployment-report:' + slug], environment, repoRoot: root,
    });
    return;
  }
  const rows = [];
  for (const [index, check] of [checkPublic, checkWindows].entries()) {
    const start = Date.now();
    let status = 'pass';
    let detail = '发布证据核验通过';
    let evidence = [];
    try {
      if (invalidIdentity) throw invalidIdentity;
      evidence = [identity.tag, identity.commit, ...await check(identity)];
    } catch (error) {
      status = 'fail';
      detail = error.message;
    }
    rows.push({ id: ids[index], status, detail, evidence, timestamp: new Date().toISOString(), duration_ms: Date.now() - start, environment });
    console.log(ids[index] + ' ' + status + ' ' + detail);
  }
  writeReleaseRows(smokeResultPath(root), rows, process.env.OPENLOGOS_SMOKE_ENV);
  if (rows.some(row => row.status === 'fail')) process.exitCode = 1;
}

await main();
