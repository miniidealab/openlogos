#!/usr/bin/env node
/**
 * SMOKE-core-157..159 — OpenLogos 0.14.1 本机全局候选、公共消费者合同与回滚恢复。
 * 只接受冻结的本地 tarball；不执行 publish、dist-tag、tag、release、官网部署或 push。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RELEASE_0_14_1_SMOKE_IDS = ['SMOKE-core-157', 'SMOKE-core-158', 'SMOKE-core-159'];
const EXPECTED_VERSION = '0.14.1';
const ROLLBACK_VERSION = '0.14.0';
const repoRoot = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(repoRoot,
  process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const pluginPaths = [
  'claude-plugin-template/.claude-plugin/plugin.json',
  'codex-plugin-template/plugin.json',
  'zcode-plugin-template/.zcode-plugin/plugin.json',
  'qoder-plugin-template/.qoder-plugin/plugin.json',
  'workbuddy-plugin-template/.workbuddy-plugin/plugin.json',
];

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: RELEASE_0_14_1_SMOKE_IDS,
    environment: 'local-global',
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_RELEASE_0_14_1_TARBALL', 'OPENLOGOS_RELEASE_0_14_1_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    required_env: ['OPENLOGOS_CANDIDATE_BIN'],
    public_release_commands: [],
  }));
  process.exit(0);
}

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function run(command, args, cwd = repoRoot, env = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 600_000 });
}

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result.stdout.trim();
}

function requiredTarball(primary, routed) {
  const raw = process.env[primary] || process.env[routed];
  if (!raw) throw new Error(`缺少 ${primary}`);
  const path = realpathSync(resolve(raw));
  if (!existsSync(path)) throw new Error(`${primary} 不存在：${path}`);
  return { path, sha256: sha256(readFileSync(path)) };
}

function npmValue(args) {
  return checked(run(npmCommand, args), `npm ${args.join(' ')}`);
}

function commandLookup() {
  const result = process.platform === 'win32'
    ? run('where', ['openlogos'])
    : run('/bin/sh', ['-lc', 'command -v openlogos']);
  return checked(result, '新 shell 定位 openlogos').split(/\r?\n/)[0];
}

async function installedFacts(expectedVersion, tarball, strictCandidate) {
  const prefix = realpathSync(npmValue(['prefix', '-g']));
  const npmRoot = realpathSync(npmValue(['root', '-g']));
  const lookup = commandLookup();
  const entryRealpath = realpathSync(lookup);
  const configuredRealpath = realpathSync(configuredBin);
  if (strictCandidate && entryRealpath !== configuredRealpath) {
    throw new Error(`全局入口 realpath 漂移：${entryRealpath} != ${configuredRealpath}`);
  }
  const packageRoot = realpathSync(join(npmRoot, '@miniidealab/openlogos'));
  const rel = relative(npmRoot, packageRoot);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`package root 越出 npm root：${packageRoot}`);
  const entryRel = relative(packageRoot, entryRealpath);
  if (entryRel.startsWith('..') || isAbsolute(entryRel) || entryRel !== 'dist/index.js') {
    throw new Error(`全局入口不属于冻结 package root：${entryRealpath}`);
  }
  const version = checked(run(entryRealpath, ['--version']), 'openlogos --version');
  if (version !== expectedVersion) throw new Error(`全局版本=${version}，期望 ${expectedVersion}`);
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (pkg.name !== '@miniidealab/openlogos' || pkg.version !== expectedVersion) throw new Error('package identity 不一致');
  const pluginVersions = {};
  for (const path of pluginPaths) {
    const manifest = JSON.parse(readFileSync(join(packageRoot, path), 'utf8'));
    if (manifest.version !== expectedVersion) throw new Error(`${path} 版本=${manifest.version}`);
    pluginVersions[path] = manifest.version;
  }
  const asset = JSON.parse(readFileSync(join(packageRoot, 'asset-manifest.json'), 'utf8'));
  if (asset.version !== expectedVersion) throw new Error(`asset manifest 版本=${asset.version}`);
  let candidateIdentity = null;
  if (strictCandidate) {
    const assetModule = await import(`${pathToFileURL(join(packageRoot, 'dist/lib/asset-manifest.js')).href}?t=${Date.now()}`);
    assetModule.validateAssetManifest(asset, packageRoot);
    const releaseModule = await import(`${pathToFileURL(join(packageRoot, 'dist/lib/local-release-candidate.js')).href}?t=${Date.now()}`);
    candidateIdentity = releaseModule.freezeLocalReleaseCandidateIdentity({
      schema: releaseModule.LOCAL_RELEASE_CANDIDATE_SCHEMA,
      package_name: pkg.name,
      package_version: pkg.version,
      plugin_versions: pluginVersions,
      asset_manifest_version: asset.version,
      tarball_sha256: tarball.sha256,
      command_path: entryRealpath,
      package_root: packageRoot,
    });
    releaseModule.assertLocalReleaseCommandGraph([
      { command: npmCommand, args: ['install', '-g', tarball.path] },
      { command: entryRealpath, args: ['--version'] },
    ]);
  }
  return {
    prefix, npm_root: npmRoot, command_lookup: lookup, entry_realpath: entryRealpath,
    package_root: packageRoot, version, plugin_versions: pluginVersions,
    asset_manifest_version: asset.version, asset_payload_hash: asset.payloadHash ?? null,
    candidate: candidateIdentity,
  };
}

function installGlobal(tarball, version) {
  checked(run(npmCommand, ['install', '-g', '--ignore-scripts', '--no-audit', '--no-fund', tarball.path]), `安装 ${version}`);
}

function put(root, path, content) {
  const target = join(root, ...path.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function publicCli(entry, root, args) {
  const command = entry.endsWith('.js') ? process.execPath : entry;
  const commandArgs = entry.endsWith('.js') ? [entry, ...args] : args;
  const env = { ...process.env, NODE_ENV: 'production' };
  delete env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY;
  delete env.OPENLOGOS_TEST_MERGE_TX_FAIL_AFTER;
  return run(command, commandArgs, root, env);
}

function publicJson(entry, root, args) {
  const result = publicCli(entry, root, [...args, '--format', 'json']);
  const output = checked(result, `openlogos ${args.join(' ')}`);
  const envelope = JSON.parse(output);
  const projection = envelope?.data?.merge_transaction;
  if (!projection) throw new Error(`${args.join(' ')} 缺少公开 merge_transaction 投影`);
  return projection;
}

function closureTarget(category, mode, deltaPath = null) {
  return [
    `    - category: ${category}`,
    '      scenario_ids: [S19]',
    `      mode: ${mode}`,
    `      delta_path: ${deltaPath ?? 'null'}`,
    `      reason: ${mode === 'SKIP' ? '本 fixture 不触达该类别' : `smoke ${mode} 公共合同目标`}`,
    `      evidence: [${mode === 'CREATE' ? 'target_absent' : mode === 'MODIFY' ? 'target_exists' : 'scope_excluded'}]`,
    '      missing_evidence: []',
  ].join('\n');
}

function transactionFixture(label) {
  const root = mkdtempSync(join(tmpdir(), `openlogos-0141-${label}-`));
  const slug = `smoke-0141-${label}`;
  const requirementDelta = 'deltas/prd/1-product-requirements/core-02-smoke.md';
  const featureDelta = 'deltas/prd/2-product-design/1-feature-specs/core-01-smoke.md';
  const scenarioDelta = 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke.md';
  const testDelta = 'deltas/test/core-S19-test-cases.md';
  const targets = [
    closureTarget('requirement', 'CREATE', requirementDelta),
    closureTarget('feature', 'MODIFY', featureDelta),
    closureTarget('scenario', 'MODIFY', scenarioDelta),
    closureTarget('test', 'MODIFY', testDelta),
    closureTarget('api', 'SKIP'),
    closureTarget('architecture', 'SKIP'),
    closureTarget('database', 'SKIP'),
    closureTarget('decision', 'SKIP'),
    closureTarget('deployment', 'SKIP'),
    closureTarget('orchestration', 'SKIP'),
    closureTarget('smoke', 'SKIP'),
  ].join('\n');
  put(root, 'logos/logos.config.json', '{"locale":"zh","sourceRoots":{"src":["src"],"test":["test"]}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', [
    'project:', '  name: smoke', 'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', 'decision_counter:', '  next_id: 7',
    'scenario_counter:', '  next_id: 40', 'resource_index: []', '',
  ].join('\n'));
  put(root, 'logos/resources/prd/2-product-design/1-feature-specs/core-01-smoke.md', '# Smoke 功能基线\n\n## F01 基础功能\n\n已有功能。\n');
  put(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S19-smoke.md', '# S19 Smoke 场景基线\n\n## S19 主路径\n\n已有场景。\n');
  put(root, 'logos/resources/test/core-S19-test-cases.md', '# S19 Smoke 测试基线\n\n## S19 基础测试\n\n已有测试。\n');
  put(root, `logos/changes/${slug}/${requirementDelta}`, [
    '## ADDED — P02 Smoke 公共合同需求', '', '### 问题与目标', '', '验证 CREATE content slot。', '',
    '### 用户价值', '', '证明安装态公共消费者合同可用。', '', '### 范围', '', '仅限临时 fixture。', '',
    '### 验收条件', '', '- 公共 transaction 完成。', '', '### 非目标', '', '- 不读取私有 transaction 文件。', '',
  ].join('\n'));
  put(root, `logos/changes/${slug}/${featureDelta}`, '## ADDED — F02 Smoke 公共合同功能\n\n安装态功能 slot。\n');
  put(root, `logos/changes/${slug}/${scenarioDelta}`, '## ADDED — S19 Smoke 安装态分支\n\n安装态场景 slot。\n');
  put(root, `logos/changes/${slug}/${testDelta}`, '## ADDED — S19 Smoke 用例扩展\n\n安装态测试 slot。\n');
  put(root, `logos/changes/${slug}/proposal.md`, [
    '# 0.14.1 安装态公共合同 smoke', '', '> module: core', '',
    '## 部署影响', '', '- 是否需要部署：否', '- 是否需要 smoke：否', '',
    '## 基线闭包计划', '', '```yaml',
    'baseline_closure:', '  policy: on-touch-v1', '  schema_version: 1',
    '  unit: canonical-merge-target-path', '  delta_cardinality: exactly-one-per-non-skip-target',
    '  effective_view: merged-resources-plus-current-change-deltas',
    '  ambiguity: block-before-existing-plan-exit', '  standalone_baseline_required: false',
    '  jit_confirmation: disabled', '  touched_scenario_ids: [S19]', '  targets:', targets, '```', '',
  ].join('\n'));
  put(root, `logos/changes/${slug}/tasks.md`, [
    '# 任务', '', '## [delta] 规格变更', '',
    `- [x] [CREATE] \`${requirementDelta}\``, `- [x] [MODIFY] \`${featureDelta}\``,
    `- [x] [MODIFY] \`${scenarioDelta}\``, `- [x] [MODIFY] \`${testDelta}\``, '',
    '## [code] 代码实现', '',
  ].join('\n'));
  return { root, slug, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function publicFinalContent() {
  return [
    '# Smoke 公共合同最终内容', '',
    '## P02 Smoke 公共合同需求', '', '### 问题与目标', '', '验证 CREATE content slot。', '',
    '### 用户价值', '', '证明安装态公共消费者合同可用。', '', '### 范围', '', '仅限临时 fixture。', '',
    '### 验收条件', '', '- 公共 transaction 完成。', '', '### 非目标', '', '- 不读取私有 transaction 文件。', '',
    '## F01 基础功能', '', '已有功能。', '', '## F02 Smoke 公共合同功能', '', '安装态功能 slot。', '',
    '## S19 主路径', '', '已有场景。', '', '## S19 Smoke 安装态分支', '', '安装态场景 slot。', '',
    '## S19 基础测试', '', '已有测试。', '', '## S19 Smoke 用例扩展', '', '安装态测试 slot。', '',
  ].join('\n');
}

function atomicSlotWrite(root, stagingPath, content) {
  const target = join(root, ...stagingPath.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  const temp = join(dirname(target), `.content.${process.pid}.tmp`);
  writeFileSync(temp, content);
  renameSync(temp, target);
  return target;
}

function assertReceiptClosure(root, completed) {
  const finalPaths = completed.receipt.final_hashes.map(item => item.path);
  const artifactPaths = completed.artifact_hashes.map(item => item.path);
  if (finalPaths.some(path => artifactPaths.includes(path))) throw new Error('final/artifact hashes 发生环形重叠');
  const union = [...new Set([...finalPaths, ...artifactPaths])].sort();
  if (JSON.stringify(union) !== JSON.stringify([...completed.receipt.commit_paths].sort())) {
    throw new Error('final/artifact hashes 未守恒覆盖 commit_paths');
  }
  for (const item of completed.receipt.final_hashes) {
    const path = join(root, ...item.path.split('/'));
    if (sha256(readFileSync(path)) !== item.sha256) throw new Error(`正式目标 hash 不可重算：${item.path}`);
  }
}

function exercisePublicTransaction(entry) {
  const fixture = transactionFixture('complete');
  try {
    checked(publicCli(entry, fixture.root, ['merge', fixture.slug]), '公共 merge transaction 创建');
    const status = publicJson(entry, fixture.root, ['merge', 'transaction', 'status', '--slug', fixture.slug]);
    const nextOutput = checked(publicCli(entry, fixture.root, ['next', '--format', 'json']), '公开 next transaction 投影');
    const next = JSON.parse(nextOutput)?.data?.merge_transaction;
    if (!next || JSON.stringify(status) !== JSON.stringify(next)) throw new Error('status/next 公开 transaction 投影不一致');
    if (status.phase !== 'collecting' || status.content_slots.required !== 4 || status.next_action !== 'submit_content') {
      throw new Error('CREATE/MODIFY 公共 content slot 集合不正确');
    }
    for (const descriptor of status.content_slots.items) {
      const contentPath = atomicSlotWrite(fixture.root, descriptor.staging_path, publicFinalContent());
      publicJson(entry, fixture.root, [
        'merge', 'transaction', 'submit-content', '--slug', fixture.slug,
        '--slot', descriptor.slot_id, '--file', contentPath,
      ]);
    }
    const sealed = publicJson(entry, fixture.root, ['merge', 'transaction', 'seal', '--slug', fixture.slug]);
    if (sealed.phase !== 'sealed' || sealed.next_action !== 'apply') throw new Error('公共 seal 投影不正确');
    const completed = publicJson(entry, fixture.root, ['merge', 'transaction', 'apply', '--slug', fixture.slug]);
    if (completed.phase !== 'completed' || !completed.receipt?.receipt_sha256) throw new Error('公共 completed receipt 缺失');
    assertReceiptClosure(fixture.root, completed);
    return {
      transaction_id: completed.transaction_id,
      receipt_sha256: completed.receipt.receipt_sha256,
      schema_sha256: completed.schema_sha256,
      contract_sha256: completed.contract_sha256,
      commit_paths: completed.receipt.commit_paths,
    };
  } finally { fixture.cleanup(); }
}

function exerciseAbortAndActionParity(entry) {
  const fixture = transactionFixture('abort');
  try {
    checked(publicCli(entry, fixture.root, ['merge', fixture.slug]), 'abort fixture transaction 创建');
    const status = publicJson(entry, fixture.root, ['merge', 'transaction', 'status', '--slug', fixture.slug]);
    const help = checked(publicCli(entry, fixture.root, ['--help']), '安装态 help');
    if (!help.includes('submit-content / seal / apply / recover / abort')) throw new Error('help 缺少已知 action 命令');
    const unknown = publicCli(entry, fixture.root, [
      'merge', 'transaction', 'future-action', '--slug', fixture.slug, '--format', 'json',
    ]);
    if (unknown.status === 0) throw new Error('未知 transaction action 未 fail-closed');
    const aborted = publicJson(entry, fixture.root, ['merge', 'transaction', 'abort', '--slug', fixture.slug]);
    if (status.next_action !== 'submit_content' || aborted.phase !== 'failed'
      || aborted.classification !== 'aborted' || aborted.receipt !== null
      || aborted.allowed_actions.length !== 0 || aborted.next_action !== null) {
      throw new Error('abort/action parity 公开终态不正确');
    }
    return { known_actions: ['submit_content', 'seal', 'apply', 'recover', 'abort'], unknown_rejected: true };
  } finally { fixture.cleanup(); }
}

if (process.argv.includes('--transaction-self-test')) {
  const index = process.argv.indexOf('--transaction-self-test');
  const entry = process.argv[index + 1];
  if (!entry || !isAbsolute(entry)) throw new Error('--transaction-self-test 需要绝对 CLI 入口');
  const transaction = exercisePublicTransaction(realpathSync(entry));
  const actionParity = exerciseAbortAndActionParity(realpathSync(entry));
  console.log(JSON.stringify({ transaction, action_parity: actionParity }));
  process.exit(0);
}

const candidate = requiredTarball('OPENLOGOS_RELEASE_0_14_1_TARBALL', 'OPENLOGOS_TARBALL');
const rollback = requiredTarball('OPENLOGOS_RELEASE_0_14_1_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
const configuredBin = process.env.OPENLOGOS_CANDIDATE_BIN;
if (!configuredBin || !isAbsolute(configuredBin)) throw new Error('OPENLOGOS_CANDIDATE_BIN 必须是绝对路径');

function report(id, status, startedAt, evidence, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify({
    id,
    status,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    environment: 'local-global',
    candidate_tarball_sha256: candidate.sha256,
    rollback_tarball_sha256: rollback.sha256,
    global_entry_realpath: existsSync(configuredBin) ? realpathSync(configuredBin) : configuredBin,
    package_asset_schema_contract_receipt_hashes: evidence?.hashes ?? {},
    evidence: evidence ? [evidence] : [],
    ...(error ? { error: String(error instanceof Error ? error.message : error).slice(0, 2000) } : {}),
  })}\n`);
}

async function smoke(id, action) {
  const startedAt = Date.now();
  try {
    const evidence = await action();
    report(id, 'pass', startedAt, evidence);
    console.log(`✓ ${id}`);
    return true;
  } catch (error) {
    report(id, 'fail', startedAt, null, error);
    console.error(`✗ ${id}: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

const firstPassed = await smoke('SMOKE-core-157', async () => {
  const facts = await installedFacts(EXPECTED_VERSION, candidate, true);
  return {
    entry: facts.entry_realpath,
    package_root: facts.package_root,
    versions: { package: facts.version, asset: facts.asset_manifest_version, ...facts.plugin_versions },
    hashes: { candidate_tarball: candidate.sha256, asset_manifest: facts.asset_payload_hash },
  };
});
if (!firstPassed) {
  try { installGlobal(rollback, ROLLBACK_VERSION); } catch (error) { console.error(`失败后回滚 0.14.0 失败：${error}`); }
  process.exit(1);
}

const secondPassed = await smoke('SMOKE-core-158', async () => {
  const facts = await installedFacts(EXPECTED_VERSION, candidate, true);
  const transaction = exercisePublicTransaction(facts.entry_realpath);
  const actionParity = exerciseAbortAndActionParity(facts.entry_realpath);
  const packageRoot = facts.package_root;
  const releaseModule = await import(`${pathToFileURL(join(packageRoot, 'dist/lib/local-release-candidate.js')).href}?smoke=${Date.now()}`);
  let oldRejected = false;
  let mixedRejected = false;
  try {
    releaseModule.freezeLocalReleaseCandidateIdentity({
      schema: releaseModule.LOCAL_RELEASE_CANDIDATE_SCHEMA,
      package_name: '@miniidealab/openlogos', package_version: ROLLBACK_VERSION,
      plugin_versions: Object.fromEntries(pluginPaths.map(path => [path, ROLLBACK_VERSION])),
      asset_manifest_version: ROLLBACK_VERSION, tarball_sha256: rollback.sha256,
      command_path: facts.entry_realpath, package_root: facts.package_root,
    });
  } catch { oldRejected = true; }
  try {
    releaseModule.freezeLocalReleaseCandidateIdentity({
      schema: releaseModule.LOCAL_RELEASE_CANDIDATE_SCHEMA,
      package_name: '@miniidealab/openlogos', package_version: EXPECTED_VERSION,
      plugin_versions: { ...facts.plugin_versions, [pluginPaths[0]]: ROLLBACK_VERSION },
      asset_manifest_version: EXPECTED_VERSION, tarball_sha256: candidate.sha256,
      command_path: facts.entry_realpath, package_root: facts.package_root,
    });
  } catch { mixedRejected = true; }
  if (!oldRejected || !mixedRejected) {
    throw new Error('candidate evidence validator 未拒绝旧版本或混合版本 facts');
  }
  return {
    public_contract_only: true,
    repository_source_reads: 0,
    private_transaction_file_reads: 0,
    transaction: {
      transaction_id: transaction.transaction_id,
      commit_path_count: transaction.commit_paths.length,
      known_actions: actionParity.known_actions,
      unknown_action_rejected: actionParity.unknown_rejected,
    },
    candidate_validator: { accepted_0_14_1: true, rejected_0_14_0: oldRejected, rejected_mixed: mixedRejected },
    hashes: {
      candidate_tarball: candidate.sha256,
      transaction_schema: transaction.schema_sha256,
      transaction_contract: transaction.contract_sha256,
      transaction_receipt: transaction.receipt_sha256,
    },
  };
});
if (!secondPassed) {
  try { installGlobal(rollback, ROLLBACK_VERSION); } catch (error) { console.error(`失败后回滚 0.14.0 失败：${error}`); }
  process.exit(1);
}

const thirdPassed = await smoke('SMOKE-core-159', async () => {
  try {
    installGlobal(rollback, ROLLBACK_VERSION);
    const rolledBack = await installedFacts(ROLLBACK_VERSION, rollback, false);
    installGlobal(candidate, EXPECTED_VERSION);
    const restored = await installedFacts(EXPECTED_VERSION, candidate, true);
    return {
      sequence: [EXPECTED_VERSION, rolledBack.version, restored.version],
      entry_sequence: [realpathSync(configuredBin), rolledBack.entry_realpath, restored.entry_realpath],
      public_release_calls: 0,
      hashes: { candidate_tarball: candidate.sha256, rollback_tarball: rollback.sha256 },
    };
  } catch (error) {
    try { installGlobal(candidate, EXPECTED_VERSION); } catch (restoreError) {
      throw new Error(`${error instanceof Error ? error.message : error}；恢复 0.14.1 失败：${restoreError}`);
    }
    throw error;
  }
});

process.exit(thirdPassed ? 0 : 1);
