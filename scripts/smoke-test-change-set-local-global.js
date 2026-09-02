#!/usr/bin/env node
/**
 * SMOKE-core-130..134 — canonical test change set 的 0.13.30 本机全局候选验证。
 *
 * 只接受固定本地 tarball；不会执行 publish、dist-tag、Git、Release 或远程部署命令。
 * 正常模式会在同一 npm 全局 prefix 实际演练 candidate → rollback → candidate。
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const TEST_CHANGE_SET_LOCAL_SMOKE_IDS = [
  'SMOKE-core-130', 'SMOKE-core-131', 'SMOKE-core-132', 'SMOKE-core-133', 'SMOKE-core-134',
];
const EXPECTED_VERSION = '0.13.30';
const ROLLBACK_VERSION = '0.13.29';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot,
  process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const evidenceRoot = join(repoRoot, 'logos/resources/verify/test-change-set-smoke-evidence');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: TEST_CHANGE_SET_LOCAL_SMOKE_IDS,
    environment: 'local-global',
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_TEST_CHANGE_SET_TARBALL', 'OPENLOGOS_TEST_CHANGE_SET_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

// 环境不具备（缺历史候选制品）必须留痕：静默零记录退出会让「不适用」与「该跑没跑」同形
requireEnvOrSkip(TEST_CHANGE_SET_LOCAL_SMOKE_IDS, [
  ['OPENLOGOS_TEST_CHANGE_SET_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_TEST_CHANGE_SET_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: 'test-change-set smoke 需要 0.13.30 候选与回滚制品',
  environment: 'test-change-set-local-global',
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function run(command, args, cwd = repoRoot) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env, timeout: 120_000 });
}

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label} 失败：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result.stdout.trim();
}

function npmValue(args) {
  return checked(run(npmCommand, args), `npm ${args.join(' ')}`);
}

function requiredTarball(name, expectedVersion) {
  const raw = process.env[name];
  if (!raw) throw new Error(`缺少 ${name}`);
  const path = realpathSync(resolve(raw));
  if (!existsSync(path)) throw new Error(`${name} 不存在：${path}`);
  return { path, expectedVersion, sha256: sha256(readFileSync(path)) };
}

function packageRoot() {
  return join(npmValue(['root', '-g']), '@miniidealab', 'openlogos');
}

function installedEntryFacts(expectedVersion) {
  const prefix = realpathSync(npmValue(['prefix', '-g']));
  const lookup = checked(run(process.platform === 'win32' ? 'where' : 'which', ['openlogos']), '定位全局 openlogos')
    .split(/\r?\n/)[0];
  const entry = realpathSync(lookup);
  const rel = relative(prefix, entry);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`入口 ${entry} 不在全局 prefix ${prefix}`);
  const version = checked(run('openlogos', ['--version']), 'openlogos --version');
  if (version !== expectedVersion) throw new Error(`全局版本=${version}，期望 ${expectedVersion}`);
  const root = packageRoot();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== '@miniidealab/openlogos' || pkg.version !== expectedVersion) throw new Error('全局 package identity 不匹配');
  return { prefix, entry, package_root: root, version };
}

function installTarball(tarball, expectedVersion) {
  checked(run(npmCommand, ['install', '-g', '--ignore-scripts', tarball.path]), `安装 ${expectedVersion}`);
  return installedEntryFacts(expectedVersion);
}

function evidence(id, payload) {
  mkdirSync(evidenceRoot, { recursive: true });
  const path = join(evidenceRoot, `${id}.json`);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return relative(repoRoot, path).replace(/\\/g, '/');
}

function report(id, status, startedAt, context, evidencePath, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const row = {
    id, status, timestamp: new Date().toISOString(), duration_ms: Date.now() - startedAt,
    environment: 'local-global',
    candidate_tarball_sha256: context.candidate.sha256,
    rollback_tarball_sha256: context.rollback.sha256,
    global_entry_realpath: context.entry?.entry ?? null,
    evidence: evidencePath ? [evidencePath] : [],
    ...(error ? { error: String(error instanceof Error ? error.message : error).slice(0, 2000) } : {}),
  };
  appendFileSync(resultPath, `${JSON.stringify(row)}\n`);
}

function incidentBytes() {
  const baseline = [
    ...Array.from({ length: 9 }, (_, index) => `UT-S10-${121 + index}`),
    ...Array.from({ length: 4 }, (_, index) => `ST-S10-${36 + index}`),
  ];
  const additions = ['ST-S10-44', 'UT-S10-137', 'UT-S10-138', 'UT-S10-139', 'UT-S10-140'];
  const markdown = rows => Buffer.from(['| ID | 用例 |', '|---|---|', ...rows].join('\n'));
  return {
    baseline,
    before: markdown(baseline.map(id => `| ${id} | ${id === 'UT-S10-129' ? 'old' : 'same'} |`)),
    after: markdown([
      ...baseline.map(id => `| ${id} | ${id === 'UT-S10-129' ? 'new' : 'same'} |`),
      ...additions.map(id => `| ${id} | added |`),
    ]),
  };
}

async function installedModules(context) {
  const base = context.entry.package_root;
  return {
    change: await import(`${pathToFileURL(join(base, 'dist/lib/test-change-set.js')).href}?t=${Date.now()}`),
    slice: await import(`${pathToFileURL(join(base, 'dist/lib/test-slice-manifest.js')).href}?t=${Date.now()}`),
  };
}

function writeSliceFixture(modules, changeSet, after) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-change-set-smoke-'));
  const proposalDir = join(root, 'logos/changes/incident');
  const targetPath = 'logos/resources/test/incident-test-cases.md';
  mkdirSync(dirname(join(root, targetPath)), { recursive: true });
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(root, targetPath), after);
  writeFileSync(join(proposalDir, 'SPEC_MERGED'), `${JSON.stringify({ test_change_set: changeSet }, null, 2)}\n`);
  return { root, proposalDir, targetPath, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const context = {
  candidate: requiredTarball('OPENLOGOS_TARBALL', EXPECTED_VERSION),
  rollback: requiredTarball('OPENLOGOS_PREVIOUS_TARBALL', ROLLBACK_VERSION),
  entry: null,
};
let failed = false;

async function smoke(id, fn) {
  const startedAt = Date.now();
  try {
    const data = await fn();
    const path = evidence(id, data);
    report(id, 'pass', startedAt, context, path);
    console.log(`✓ ${id}`);
  } catch (error) {
    failed = true;
    report(id, 'fail', startedAt, context, null, error);
    console.error(`✗ ${id}: ${error instanceof Error ? error.message : error}`);
  }
}

context.entry = installTarball(context.candidate, EXPECTED_VERSION);
const modules = await installedModules(context);

await smoke('SMOKE-core-130', async () => {
  const versions = {};
  for (const path of [
    'claude-plugin-template/.claude-plugin/plugin.json', 'codex-plugin-template/plugin.json',
    'zcode-plugin-template/.zcode-plugin/plugin.json', 'qoder-plugin-template/.qoder-plugin/plugin.json',
    'workbuddy-plugin-template/.workbuddy-plugin/plugin.json',
  ]) {
    const metadata = JSON.parse(readFileSync(join(context.entry.package_root, path), 'utf8'));
    if (metadata.version !== EXPECTED_VERSION) throw new Error(`${path} 版本=${metadata.version}`);
    versions[path] = metadata.version;
  }
  return { ...context.entry, versions, tarball_size: readFileSync(context.candidate.path).length };
});

let incident;
await smoke('SMOKE-core-131', async () => {
  const data = incidentBytes();
  const targetPath = 'logos/resources/test/incident-test-cases.md';
  incident = modules.change.buildTestChangeSet({
    change: 'incident', module: 'core',
    targets: [{ targetPath, beforeBytes: data.before, afterBytes: data.after }],
  });
  const expected = ['ST-S10-44', 'UT-S10-129', 'UT-S10-137', 'UT-S10-138', 'UT-S10-139', 'UT-S10-140'];
  if (JSON.stringify(incident.changed_test_ids) !== JSON.stringify(expected)) throw new Error('事故 C 不是精确六 ID');
  const baselineUnchanged = data.baseline.filter(id => id !== 'UT-S10-129');
  if (baselineUnchanged.some(id => incident.changed_test_ids.includes(id))) throw new Error('原样 baseline 误入 C');
  return { changed: incident.changed_test_ids, baseline: baselineUnchanged, hash: incident.sha256 };
});

await smoke('SMOKE-core-132', async () => {
  const data = incidentBytes();
  const removedBefore = Buffer.from(`${data.before.toString()}\n| UT-S10-999 | removed |`);
  const withRemoved = modules.change.buildTestChangeSet({
    change: 'incident', module: 'core', targets: [{
      targetPath: 'logos/resources/test/incident-test-cases.md', beforeBytes: removedBefore, afterBytes: data.after,
    }],
  });
  if (!withRemoved.removed_test_ids.includes('UT-S10-999') || withRemoved.changed_test_ids.includes('UT-S10-999')) {
    throw new Error('removed 未与 C 分层');
  }
  const duplicate = Buffer.from(`${data.after.toString()}\n| UT-S10-137 | duplicate |\n`);
  let duplicateRejected = false;
  try {
    modules.change.buildTestChangeSet({ change: 'incident', module: 'core', targets: [{
      targetPath: 'logos/resources/test/incident-test-cases.md', beforeBytes: data.before, afterBytes: duplicate,
    }] });
  } catch { duplicateRejected = true; }
  if (!duplicateRejected) throw new Error('duplicate ID 未 fail-closed');

  const fixture = writeSliceFixture(modules, incident, data.after);
  try {
    const changed = incident.changed_test_ids;
    const tasks = [
      '# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '', '## [code] 代码实现',
      `- [ ] 切片 1：事故前半（覆盖 ${changed.slice(0, 3).join('、')}）`,
      `- [ ] 切片 2：事故后半（覆盖 ${changed.slice(3).join('、')}）`, '',
    ].join('\n');
    writeFileSync(join(fixture.proposalDir, 'tasks.md'), tasks);
    const groups = [changed.slice(0, 3), changed.slice(3)];
    const manifest = {
      schema: 'openlogos/test-slice-manifest@1', change: 'incident', module: 'core',
      task_fingerprint: modules.slice.computeTaskFingerprint(tasks),
      spec_fingerprint: modules.slice.computeSpecFingerprint(fixture.root, [fixture.targetPath]),
      generated_at: '2026-08-26T00:00:00.000Z',
      slices: groups.map((owned, index) => ({
        slice_id: `incident-0${index + 1}`,
        task_text: index === 0
          ? `切片 1：事故前半（覆盖 ${owned.join('、')}）`
          : `切片 2：事故后半（覆盖 ${owned.join('、')}）`,
        owned_test_ids: owned, runner_selectors: owned, spec_targets: [fixture.targetPath],
      })),
    };
    const manifestPath = join(fixture.proposalDir, 'TEST_SLICE_MANIFEST.json');
    const evaluate = value => {
      writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
      return modules.slice.deriveSliceVerificationState(fixture.root, fixture.proposalDir, {
        change: 'incident', module: 'core',
      });
    };
    if (evaluate(manifest).manifest_status !== 'valid') throw new Error('正例 manifest 未通过');
    const missing = structuredClone(manifest);
    missing.slices[0].owned_test_ids.shift(); missing.slices[0].runner_selectors.shift();
    if (!evaluate(missing).violations.some(item => item.code === 'test-slice-test-id-missing')) throw new Error('missing 未检出');
    const unknown = structuredClone(manifest);
    unknown.slices[0].owned_test_ids.push('UT-S10-121'); unknown.slices[0].runner_selectors.push('UT-S10-121');
    if (!evaluate(unknown).violations.some(item => item.code === 'test-slice-test-id-unknown')) throw new Error('unknown 未检出');
    const duplicateOwned = structuredClone(manifest);
    duplicateOwned.slices[1].owned_test_ids.push(changed[0]); duplicateOwned.slices[1].runner_selectors.push(changed[0]);
    if (!evaluate(duplicateOwned).violations.some(item => item.code === 'test-slice-test-id-duplicate')) throw new Error('duplicate ownership 未检出');
  } finally { fixture.cleanup(); }
  return { removed: withRemoved.removed_test_ids, missing_rejected: true, unknown_rejected: true, duplicate_rejected: true };
});

await smoke('SMOKE-core-133', async () => {
  const data = incidentBytes();
  const fixture = writeSliceFixture(modules, incident, data.after);
  try {
    const valid = modules.change.readTestChangeSet(fixture.root, fixture.proposalDir, {
      change: 'incident', module: 'core', targetPaths: [fixture.targetPath],
    });
    if (!valid.valid) throw new Error(`重启读取失败：${JSON.stringify(valid)}`);
    const markerPath = join(fixture.proposalDir, 'SPEC_MERGED');
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    marker.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`;
    writeFileSync(markerPath, JSON.stringify(marker));
    const tampered = modules.change.readTestChangeSet(fixture.root, fixture.proposalDir, {
      change: 'incident', module: 'core', targetPaths: [fixture.targetPath],
    });
    if (tampered.valid || tampered.code !== 'test-slice-change-set-hash') throw new Error('marker 篡改未 fail-closed');
    return { stable_hash: valid.value.sha256, tamper_code: tampered.code, git_calls: 0 };
  } finally { fixture.cleanup(); }
});

await smoke('SMOKE-core-134', async () => {
  const rollback = installTarball(context.rollback, ROLLBACK_VERSION);
  const restored = installTarball(context.candidate, EXPECTED_VERSION);
  context.entry = restored;
  const restoredModules = await installedModules(context);
  const data = incidentBytes();
  const result = restoredModules.change.buildTestChangeSet({
    change: 'incident', module: 'core', targets: [{
      targetPath: 'logos/resources/test/incident-test-cases.md', beforeBytes: data.before, afterBytes: data.after,
    }],
  });
  if (result.changed_test_ids.length !== 6) throw new Error('恢复候选后六 ID 断言失败');
  return { sequence: [EXPECTED_VERSION, rollback.version, restored.version], public_release_calls: 0 };
});

// 任一前序 smoke 失败也尽力恢复候选；恢复失败继续保持非零退出且不伪造 PASS。
try {
  if (installedEntryFacts(EXPECTED_VERSION).version !== EXPECTED_VERSION) installTarball(context.candidate, EXPECTED_VERSION);
} catch (error) {
  failed = true;
  console.error(`候选恢复失败：${error instanceof Error ? error.message : error}`);
}

process.exit(failed ? 1 : 0);
