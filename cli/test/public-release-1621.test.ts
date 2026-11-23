import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { InstallUnavailable } from '../../scripts/lib/public-release-1621-install.mjs';
import { PUBLIC_RELEASE_01621_SMOKE_IDS, runReleaseCases, writeReleaseRows } from '../../scripts/smoke-public-release-0-16-21.js';
import { RELEASE_SUMMARIES_EN } from '../../website/src/data/release-summaries-en.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const identity = { version: '0.16.21', commit: 'a'.repeat(40), old: '0.16.2' };
const tag = 'v' + identity.version;
const repo = 'miniidealab/openlogos';
const laterLocalVersions = Array.from({ length: 13 }, (_, i) => '0.16.' + (i + 8));
const routes = ['cli/knowledge', 'cli/history', 'cli/branch', 'specs/branch-sync', 'concepts/enterprise-knowledge'];
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixtureRoot() {
  const path = mkdtempSync(join(tmpdir(), 'openlogos-pr1621-test-'));
  temporary.push(path);
  return path;
}

function fixture() {
  const dir = fixtureRoot();
  const bytes = Buffer.from('registry 与 GitHub 共用的夹具制品');
  const tarball = join(dir, 'fixture.tgz');
  writeFileSync(tarball, bytes);
  const source = (file: string) => readFileSync(join(root, file), 'utf8');
  const notes = source('CHANGELOG.md').split('## [' + identity.version + ']')[1].split('\n## [')[0].trimEnd();
  const registry = {
    tags: { latest: identity.version, old: identity.old },
    source: {
      version: identity.version,
      'dist.integrity': 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
    },
    attestations: {
      attestations: [{
        predicateType: 'https://slsa.dev/provenance/v1',
        bundle: {
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify({
              predicate: {
                buildDefinition: {
                  resolvedDependencies: [{
                    uri: 'git+https://github.com/' + repo + '@refs/tags/' + tag,
                    digest: { gitCommit: identity.commit },
                  }],
                },
              },
            })).toString('base64'),
          },
        },
      }],
    },
    tarball,
    absentVersions: laterLocalVersions,
  };
  const release = {
    info: { tagName: tag, isDraft: false, isPrerelease: false, body: '## [' + identity.version + ']' + notes },
    latest: tag,
    commit: identity.commit,
    bytes,
  };
  const link = 'https://github.com/' + repo + '/releases/tag/' + tag;
  const summary = RELEASE_SUMMARIES_EN[identity.version];
  const releases = '<div class="latest-version">' + tag + '</div><a href="' + link + '">GitHub Release</a>'
    + '<article><h3>' + tag + '</h3><div aria-label="Release summary for ' + tag + '">'
    + [...summary.valueSummaryEn.slice(0, 3), ...summary.fixSummaryEn.slice(0, 3)].map(s => '<p>' + s + '</p>').join('')
    + '</div><details class="summary-original"><summary>中文原文</summary></details></article>';
  const pages: Record<string, string> = {
    '/': '<div class="summary-card summary-latest"><strong>' + tag + '</strong></div><a href="/releases">发布</a>',
    '/releases': releases,
    '/zh/releases': releases,
    '/zh': '<html lang="zh">简体中文',
    '/zh/getting-started': '<html lang="zh-CN">简体中文',
    '/zh/cli': '<html lang="zh-CN">简体中文',
  };
  for (const locale of ['', 'zh/']) {
    const nav = '<nav class="sidebar">简体中文' + routes.map(route => '<a href="/' + locale + route + '/">导航</a>').join('') + '</nav>';
    for (const route of routes) {
      const path = locale + route;
      const body = source('website/src/content/docs/' + path + '.md')
        .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      pages['/' + path + '/'] = '<html lang="' + (locale ? 'zh-CN' : 'en') + '">' + nav
        + '<main>' + body + '</main></html>';
    }
  }
  const ops = {
    registry: () => registry,
    archive: () => ({
      packageJson: { name: '@miniidealab/openlogos', version: identity.version },
      manifest: { version: identity.version },
      files: [
        'dist/commands/knowledge.js', 'dist/commands/history.js', 'dist/commands/branch.js',
        'dist/lib/verification-history.js', 'dist/lib/result-path-lock.js',
        'claude-plugin-template/plugin.json', 'opencode-plugin-template/index.js', 'codex-plugin-template/plugin.json',
      ],
    }),
    publishedRun: () => 1234,
    host: () => ['knowledge apply:exit=0', 'history show:exit=0', 'branch status:exit=0', 'verify_scope=module,all'],
    linux: () => ['image=sha256:fixture', 'uid=1000', 'knowledge apply:exit=0', 'history show:exit=0', 'branch status:exit=0', 'verify_scope=module,all'],
    release: () => release,
    source,
    page: (path: string) => ({ status: path in pages ? 200 : 404, body: pages[path] ?? '' }),
  };
  return { dir, ops, registry, release, pages };
}

function readRows(path: string) {
  return readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
}

describe('公开发布 0.16.21 runner', () => {
  it('SMOKE-core-328～333 同源、两平台与双语页面通过，正式环境 reporter 每条只写一次', async () => {
    const { dir, ops } = fixture();
    const rows = await runReleaseCases(identity, ops);
    expect(rows.filter(row => row.status !== 'pass')).toEqual([]);
    const file = join(dir, 'verify', 'smoke-results.jsonl');
    writeReleaseRows(file, rows, 'prod');
    const recorded = readRows(file);
    expect(recorded.map(row => row.id)).toEqual(PUBLIC_RELEASE_01621_SMOKE_IDS);
    for (const row of recorded) {
      expect(row).toMatchObject({ status: 'pass', target_environment: 'prod', duration_ms: expect.any(Number) });
      expect(row.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/);
      expect(row.evidence).toEqual(expect.arrayContaining(['V=' + identity.version, 'commit=' + identity.commit]));
    }
    expect(recorded[0].evidence.find((line: string) => line.startsWith('tarball_sha256='))?.split('=')[1])
      .toBe(recorded[3].evidence.find((line: string) => line.startsWith('asset_sha256='))?.split('=')[1]);
  });

  it('SMOKE-core-328、331 拒绝来源提交、registry 完整性和 Release 附件散列不符', async () => {
    const { ops, registry, release } = fixture();
    const attestation = registry.attestations.attestations[0].bundle.dsseEnvelope;
    const good = attestation.payload;
    attestation.payload = Buffer.from(Buffer.from(good, 'base64').toString().replace(identity.commit, 'b'.repeat(40))).toString('base64');
    let rows = await runReleaseCases(identity, ops);
    expect(rows[0]).toMatchObject({ status: 'fail', detail: expect.stringContaining('gitCommit') });
    expect(rows.slice(1, 4).map(row => row.status)).toEqual(['fail', 'fail', 'fail']);
    attestation.payload = good;
    const integrity = registry.source['dist.integrity'];
    registry.source['dist.integrity'] = 'sha512-wrong';
    rows = await runReleaseCases(identity, ops);
    expect(rows[0]).toMatchObject({ status: 'fail', detail: expect.stringContaining('integrity') });
    registry.source['dist.integrity'] = integrity;
    release.bytes = Buffer.from('另一个附件');
    rows = await runReleaseCases(identity, ops);
    expect(rows[3]).toMatchObject({ status: 'fail', detail: expect.stringContaining('SHA-256') });
  });

  it('SMOKE-core-329、330 功能失败留证据，Docker 缺口只写 skip', async () => {
    const { dir, ops } = fixture();
    ops.host = () => {
      throw Object.assign(new Error('verify 范围与调用不符'), { evidence: ['verify:exit=1'] });
    };
    ops.linux = () => { throw new InstallUnavailable('Docker 服务不可用', ['docker']); };
    const rows = await runReleaseCases(identity, ops);
    const file = join(dir, 'rows.jsonl');
    writeReleaseRows(file, rows, 'prod');
    const recorded = readRows(file);
    expect(recorded[1]).toMatchObject({ status: 'fail', target_environment: 'prod', evidence: expect.arrayContaining(['verify:exit=1']) });
    expect(recorded[2]).toMatchObject({ status: 'skip', missing_requirements: ['docker'] });
    expect(recorded[2]).not.toHaveProperty('target_environment');
    expect(recorded[3].status).toBe('pass');
  });

  it('SMOKE-core-332、333 拒绝旧版本、缺英文摘要、跨语言导航和 404', async () => {
    const { ops, pages } = fixture();
    const english = pages['/releases'];
    const chinese = '/zh/cli/knowledge/';
    pages['/releases'] = english.replace(tag, 'v0.16.7');
    pages[chinese] = pages[chinese].replace('href="/zh/specs/branch-sync/"', 'href="/specs/branch-sync/"');
    let rows = await runReleaseCases(identity, ops);
    expect(rows[4]).toMatchObject({ status: 'fail', detail: expect.stringContaining('latest') });
    expect(rows[5]).toMatchObject({ status: 'fail', detail: expect.stringContaining('侧边栏') });
    pages['/releases'] = english.replace(RELEASE_SUMMARIES_EN[identity.version].valueSummaryEn[0], '');
    delete pages[chinese];
    rows = await runReleaseCases(identity, ops);
    expect(rows[4]).toMatchObject({ status: 'fail', detail: expect.stringContaining('摘要') });
    expect(rows[5]).toMatchObject({ status: 'fail', detail: expect.stringContaining('HTTP 404') });
  });

  it('SMOKE-core-328～333 窗口外跳过，窗口内缺发布记录时报告缺口并退出失败', () => {
    const dir = fixtureRoot();
    const script = join(dir, 'scripts/run-smoke.js');
    mkdirSync(join(dir, 'scripts/lib'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}\n');
    for (const file of [
      'run-smoke.js', 'smoke-public-release-0-16-21.js', 'lib/public-release-checks.mjs',
      'lib/public-release-1621-install.mjs', 'lib/smoke-not-applicable.mjs',
    ]) copyFileSync(join(root, 'scripts', file), join(dir, 'scripts', file));
    const run = (filename: string) => spawnSync(process.execPath, [script], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENLOGOS_PR1621_SMOKE: '0',
        OPENLOGOS_SMOKE_ENV: 'prod',
        OPENLOGOS_SMOKE_RESULT_PATH: join(dir, filename),
      },
    });
    expect(run('outside.jsonl').status).toBe(0);
    const skipped = readRows(join(dir, 'outside.jsonl'));
    expect(skipped.map(row => row.id)).toEqual(PUBLIC_RELEASE_01621_SMOKE_IDS);
    expect(skipped.every(row => row.status === 'skip' && !('target_environment' in row))).toBe(true);
    mkdirSync(join(dir, 'logos'));
    writeFileSync(join(dir, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'release-0-16-21' }));
    expect(run('inside.jsonl').status).toBe(1);
    const records = readRows(join(dir, 'inside.jsonl'));
    expect(records.map(row => row.id)).toEqual(PUBLIC_RELEASE_01621_SMOKE_IDS);
    for (const row of records) {
      expect(row).toMatchObject({ status: 'skip', missing_requirements: ['deployment-report:release-0-16-21'] });
      expect(row).not.toHaveProperty('target_environment');
    }
  });
});
