import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { validateAssetManifest, type AssetManifest } from '../src/lib/asset-manifest.js';
import {
  assertLocalReleaseCommandGraph,
  buildLocalReleaseRollbackPlan,
  freezeLocalReleaseCandidateIdentity,
  LOCAL_RELEASE_CANDIDATE_SCHEMA,
  LOCAL_RELEASE_CANDIDATE_VERSION,
  LOCAL_RELEASE_PACKAGE_NAME,
  LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS,
  LOCAL_RELEASE_ROLLBACK_VERSION,
  type LocalReleaseCandidateIdentity,
} from '../src/lib/local-release-candidate.js';

const repoRoot = resolve(import.meta.dirname, '../..');
const cliRoot = join(repoRoot, 'cli');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function run(command: string, args: string[], cwd = repoRoot) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180_000 });
}

function checked(command: string, args: string[], cwd = repoRoot): string {
  const result = run(command, args, cwd);
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 失败：${result.error?.message ?? `exit ${result.status}`} ${result.stderr}`.trim());
  }
  return result.stdout.trim();
}

function sha256(path: string): string {
  return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
}

function parsePack(stdout: string): { filename: string; version: string; files: Array<{ path: string }> } {
  const start = stdout.indexOf('[');
  if (start < 0) throw new Error(`npm pack 输出缺 JSON：${stdout}`);
  return JSON.parse(stdout.slice(start))[0];
}

function readVersion(path: string): string {
  return JSON.parse(readFileSync(path, 'utf8')).version;
}

function installedIdentity(packageRoot: string, tarball: string): LocalReleaseCandidateIdentity {
  const pluginVersions = Object.fromEntries(LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS.map(path => [
    path,
    readVersion(join(packageRoot, path)),
  ])) as LocalReleaseCandidateIdentity['plugin_versions'];
  const assetManifest = JSON.parse(readFileSync(join(packageRoot, 'asset-manifest.json'), 'utf8')) as AssetManifest;
  validateAssetManifest(assetManifest, packageRoot);
  return freezeLocalReleaseCandidateIdentity({
    schema: LOCAL_RELEASE_CANDIDATE_SCHEMA,
    package_name: JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).name,
    package_version: readVersion(join(packageRoot, 'package.json')),
    plugin_versions: pluginVersions,
    asset_manifest_version: assetManifest.version,
    tarball_sha256: sha256(tarball),
    command_path: join(packageRoot, 'dist/index.js'),
    package_root: packageRoot,
  } as LocalReleaseCandidateIdentity);
}

function createRollbackTarball(root: string): string {
  const source = join(root, 'rollback-source');
  mkdirSync(join(source, 'dist'), { recursive: true });
  writeFileSync(join(source, 'package.json'), `${JSON.stringify({
    name: LOCAL_RELEASE_PACKAGE_NAME,
    version: LOCAL_RELEASE_ROLLBACK_VERSION,
    type: 'module',
    bin: { openlogos: 'dist/index.js' },
    files: ['dist', 'asset-manifest.json', ...LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS.map(path => path.split('/')[0])],
  }, null, 2)}\n`);
  writeFileSync(join(source, 'dist/index.js'), `#!/usr/bin/env node\nconsole.log('${LOCAL_RELEASE_ROLLBACK_VERSION}');\n`);
  writeFileSync(join(source, 'asset-manifest.json'), `${JSON.stringify({ version: LOCAL_RELEASE_ROLLBACK_VERSION })}\n`);
  for (const path of LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS) {
    const target = join(source, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify({ name: 'openlogos', version: LOCAL_RELEASE_ROLLBACK_VERSION })}\n`);
  }
  const destination = join(root, 'rollback-pack');
  mkdirSync(destination, { recursive: true });
  const meta = parsePack(checked(npmCommand, ['pack', source, '--pack-destination', destination, '--json', '--ignore-scripts']));
  return join(destination, meta.filename);
}

function createCandidateTarball(root: string): { tarball: string; files: Set<string>; version: string } {
  const sourceRoot = join(root, 'candidate-source');
  const isolatedCli = join(sourceRoot, 'cli');
  const generated = new Set([
    'node_modules', 'skills', 'spec', 'opencode-plugin-template', 'codex-plugin-template',
    'claude-plugin-template', 'zcode-plugin-template', 'qoder-plugin-template', 'workbuddy-plugin-template',
  ]);
  cpSync(cliRoot, isolatedCli, {
    recursive: true,
    filter: source => source === cliRoot || !generated.has(source.slice(cliRoot.length + 1).split('/')[0]),
  });
  for (const dir of ['skills', 'spec', 'plugin-opencode', 'plugin-codex', 'plugin', 'plugin-zcode', 'plugin-qoder', 'plugin-workbuddy']) {
    cpSync(join(repoRoot, dir), join(sourceRoot, dir), { recursive: true });
  }
  symlinkSync(join(cliRoot, 'node_modules'), join(isolatedCli, 'node_modules'));
  const meta = parsePack(checked(npmCommand, ['pack', isolatedCli, '--pack-destination', root, '--json']));
  return { tarball: join(root, meta.filename), files: new Set(meta.files.map(item => item.path)), version: meta.version };
}

describe('S19 — OpenLogos 本地全局 candidate', () => {
  it('UT-S19-22: 当前 candidate identity 全源一致且历史 0.14.0 语义保留', () => {
    const versionSources = [
      'cli/package.json', 'cli/package-lock.json',
      'plugin/.claude-plugin/plugin.json', 'plugin-codex/plugin.json',
      'plugin-zcode/.zcode-plugin/plugin.json', 'plugin-qoder/.qoder-plugin/plugin.json',
      'plugin-workbuddy/.workbuddy-plugin/plugin.json', 'cli/asset-manifest.json',
    ];
    for (const path of versionSources) expect(readVersion(join(repoRoot, path)), path).toBe(LOCAL_RELEASE_CANDIDATE_VERSION);
    expect(LOCAL_RELEASE_CANDIDATE_VERSION).toBe('0.14.13');

    const assetManifest = JSON.parse(readFileSync(join(cliRoot, 'asset-manifest.json'), 'utf8')) as AssetManifest;
    validateAssetManifest(assetManifest, cliRoot);
    const smokeContract = JSON.parse(checked(process.execPath, [join(repoRoot, 'scripts/smoke-release-0-14-1-local.js'), '--self-test']));
    expect(smokeContract).toMatchObject({
      ids: ['SMOKE-core-157', 'SMOKE-core-158', 'SMOKE-core-159'],
      candidate_version: '0.14.1',
      rollback_version: '0.14.0',
      public_release_commands: [],
    });
    const dispatcher = readFileSync(join(repoRoot, 'scripts/run-smoke.js'), 'utf8');
    expect(dispatcher).toContain("'scripts/smoke-release-0-14-1-local.js'");
    expect(dispatcher).toContain('OPENLOGOS_MERGE_TRANSACTION_CANDIDATE_BIN');
    expect(dispatcher).toContain('OPENLOGOS_RELEASE_0_14_1_CANDIDATE_BIN');
    expect(dispatcher).toContain('env.OPENLOGOS_CANDIDATE_BIN = artifacts.candidateBin');
    expect(dispatcher).toContain("['scripts/smoke-merge-transaction-candidate.js', process.env.OPENLOGOS_MERGE_TRANSACTION_TARBALL]");
    expect(dispatcher).toContain("['scripts/smoke-release-0-14-1-local.js', process.env.OPENLOGOS_RELEASE_0_14_1_TARBALL]");
    expect(dispatcher).toContain('if (!prepareGlobalCandidate(runner))');
    const runner = readFileSync(join(repoRoot, 'scripts/smoke-release-0-14-1-local.js'), 'utf8');
    expect(runner).toContain('OPENLOGOS_SMOKE_RESULT_PATH');
    expect(runner).toContain("appendFileSync(resultPath");
    expect(runner).toContain("publicJson(entry, fixture.root, ['merge', 'transaction', 'status'");
    expect(runner).toContain("publicCli(entry, fixture.root, ['next', '--format', 'json'])");
    expect(runner).not.toContain('scripts/merge-transaction-smoke-fixtures.js');
    expect(runner).not.toContain('MERGE_TRANSACTION.json');

    expect(readFileSync(join(cliRoot, 'src/commands/merge-apply.ts'), 'utf8')).toContain('0.14.0 breaking cutover');
    const historicalRunner = readFileSync(join(repoRoot, 'scripts/smoke-merge-transaction-candidate.js'), 'utf8');
    const historicalEvidenceValidator = readFileSync(join(repoRoot, 'scripts/lib/runlogos-candidate-evidence.mjs'), 'utf8');
    expect(historicalRunner).toContain('SMOKE-core-141..156 — OpenLogos 0.14.0');
    expect(historicalRunner).toContain("const EXPECTED_VERSION = '0.14.0'");
    expect(historicalEvidenceValidator).toContain("const EXPECTED_VERSION = '0.14.0'");
    expect(readFileSync(join(repoRoot, 'CHANGELOG.md'), 'utf8')).toContain('## [0.14.1]');
  });

  it('UT-S19-23: 旧/混合证据和公开发布动作 fail-closed，回滚只使用固定 previous tarball', () => {
    const packageRoot = '/opt/openlogos/lib/node_modules/@miniidealab/openlogos';
    const valid: LocalReleaseCandidateIdentity = {
      schema: LOCAL_RELEASE_CANDIDATE_SCHEMA,
      package_name: LOCAL_RELEASE_PACKAGE_NAME,
      package_version: LOCAL_RELEASE_CANDIDATE_VERSION,
      plugin_versions: Object.fromEntries(LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS.map(path => [path, LOCAL_RELEASE_CANDIDATE_VERSION])) as LocalReleaseCandidateIdentity['plugin_versions'],
      asset_manifest_version: LOCAL_RELEASE_CANDIDATE_VERSION,
      tarball_sha256: `sha256:${'a'.repeat(64)}`,
      command_path: `${packageRoot}/dist/index.js`,
      package_root: packageRoot,
    };
    expect(freezeLocalReleaseCandidateIdentity(valid)).toEqual(valid);
    expect(() => freezeLocalReleaseCandidateIdentity({ ...valid, package_version: '0.14.0' } as never)).toThrow('package_version');
    expect(() => freezeLocalReleaseCandidateIdentity({
      ...valid,
      plugin_versions: { ...valid.plugin_versions, [LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS[2]]: '0.14.0' },
    })).toThrow('plugin_version');
    expect(() => freezeLocalReleaseCandidateIdentity({ ...valid, tarball_sha256: 'sha256:old' })).toThrow('tarball_sha256');

    const publicCommands = [
      ['npm', ['publish']], ['npm', ['dist-tag', 'add']], ['git', ['tag', 'v0.14.1']],
      ['git', ['push', 'origin']], ['gh', ['release', 'create']], ['wrangler', ['pages', 'deploy']],
    ] as const;
    for (const [command, args] of publicCommands) {
      expect(() => assertLocalReleaseCommandGraph([{ command, args }]), `${command} ${args.join(' ')}`).toThrow('public_release_forbidden');
    }
    expect(() => assertLocalReleaseCommandGraph([
      { command: 'npm', args: ['pack', '--json'] },
      { command: 'npm', args: ['install', '--prefix', '/tmp/openlogos-prefix', '/tmp/openlogos-0.14.2.tgz'] },
    ])).not.toThrow();

    const rollbackTarball = '/tmp/openlogos-0.14.2.tgz';
    const plan = buildLocalReleaseRollbackPlan('/tmp/openlogos-prefix', rollbackTarball, '/tmp/openlogos-prefix/bin/openlogos');
    expect(plan).toHaveLength(3);
    expect(plan[1].args.at(-1)).toBe(rollbackTarball);
    expect(plan[2]).toEqual({ command: '/tmp/openlogos-prefix/bin/openlogos', args: ['--version'] });
    expect(() => buildLocalReleaseRollbackPlan('relative', rollbackTarball, '/tmp/openlogos-prefix/bin/openlogos')).toThrow('prefix');
  });

  it('ST-S19-15: 隔离 prefix 真实 pack、安装、自检、previous 回滚与 current 恢复', () => {
    const root = mkdtempSync(join(tmpdir(), 'openlogos-release-0-14-1-'));
    roots.push(root);
    const rollbackTarball = createRollbackTarball(root);
    const candidate = createCandidateTarball(root);
    expect(candidate.version).toBe(LOCAL_RELEASE_CANDIDATE_VERSION);
    for (const required of [
      'package.json', 'asset-manifest.json', 'dist/index.js', 'dist/lib/local-release-candidate.js',
      ...LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS,
    ]) expect(candidate.files.has(required), `tarball 缺 ${required}`).toBe(true);

    const prefix = join(root, 'prefix');
    const install = (tarball: string) => checked(npmCommand, [
      'install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', tarball,
    ]);
    const packageRoot = join(prefix, 'node_modules/@miniidealab/openlogos');
    const entry = join(packageRoot, 'dist/index.js');

    install(candidate.tarball);
    const first = installedIdentity(packageRoot, candidate.tarball);
    expect(checked(process.execPath, [entry, '--version'], root)).toBe(LOCAL_RELEASE_CANDIDATE_VERSION);
    expect(checked(process.execPath, [entry, '--help'], root)).toContain('submit-content / seal / apply / recover / abort');
    const publicContract = JSON.parse(checked(process.execPath, [
      join(repoRoot, 'scripts/smoke-release-0-14-1-local.js'), '--transaction-self-test', resolve(entry),
    ], root));
    expect(publicContract.transaction.commit_paths).toEqual(expect.arrayContaining([
      'logos/logos-project.yaml',
      'logos/resources/prd/1-product-requirements/core-02-smoke.md',
      'logos/resources/prd/2-product-design/1-feature-specs/core-01-smoke.md',
    ]));
    expect(publicContract.action_parity).toMatchObject({ unknown_rejected: true });

    const rollbackPlan = buildLocalReleaseRollbackPlan(resolve(prefix), resolve(rollbackTarball), resolve(entry));
    for (const command of rollbackPlan.slice(0, 2)) checked(npmCommand, [...command.args], root);
    expect(checked(process.execPath, [entry, '--version'], root)).toBe(LOCAL_RELEASE_ROLLBACK_VERSION);
    for (const path of LOCAL_RELEASE_PLUGIN_MANIFEST_PATHS) {
      expect(readVersion(join(packageRoot, path)), path).toBe(LOCAL_RELEASE_ROLLBACK_VERSION);
    }

    install(candidate.tarball);
    const restored = installedIdentity(packageRoot, candidate.tarball);
    expect(checked(process.execPath, [entry, '--version'], root)).toBe(LOCAL_RELEASE_CANDIDATE_VERSION);
    expect(restored).toEqual(first);

    const missing = run(npmCommand, ['install', '--prefix', prefix, join(root, 'missing-0.14.1.tgz')], root);
    expect(missing.status).not.toBe(0);
    expect(checked(process.execPath, [entry, '--version'], root)).toBe(LOCAL_RELEASE_CANDIDATE_VERSION);
    expect(existsSync(candidate.tarball)).toBe(true);
  }, 180_000);
});
