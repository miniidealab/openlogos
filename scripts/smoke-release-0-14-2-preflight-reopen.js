#!/usr/bin/env node
/**
 * SMOKE-core-160..162 — 0.14.2 安装态 preflight/reopen 与 RunLogos 恢复。
 * 不执行 publish、tag、release、官网部署或 git push；SMOKE-core-162 需要显式授权环境变量。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, renameSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { importInstalledPackageModule } from './lib/seed-installed-merge-contract.mjs';

export const RELEASE_0_14_2_SMOKE_IDS = ['SMOKE-core-160', 'SMOKE-core-161', 'SMOKE-core-162'];
const EXPECTED_VERSION = '0.14.2';
const ROLLBACK_VERSION = '0.14.1';
const EXPECTED_RUNLOGOS_TRANSACTION = 'mtx_7e0341e3719feccd22ef7615';
const repoRoot = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: RELEASE_0_14_2_SMOKE_IDS,
    environment: 'installed-candidate',
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    fixture_runner: 'scripts/merge-preflight-reopen-smoke-fixtures.js',
    required_source_env: ['OPENLOGOS_RELEASE_0_14_2_TARBALL', 'OPENLOGOS_RELEASE_0_14_2_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    required_env: ['OPENLOGOS_CANDIDATE_BIN'],
    runlogos_authorization_env: 'OPENLOGOS_RUNLOGOS_RECOVERY_AUTHORIZED',
    runlogos_archive_env: 'OPENLOGOS_RUNLOGOS_ARCHIVED_CHANGE_DIR',
    public_release_commands: [],
  }));
  process.exit(0);
}

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const run = (command, args, cwd = repoRoot, env = process.env) => spawnSync(command, args, {
  cwd, env, encoding: 'utf8', timeout: 600_000,
});
const checked = (result, label) => {
  if (result.error || result.status !== 0) throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  return result.stdout.trim();
};
const requiredFile = (primary, routed) => {
  const raw = process.env[primary] || process.env[routed];
  if (!raw) throw new Error(`缺少 ${primary}`);
  return realpathSync(resolve(raw));
};
const cliRun = (entry, root, args) => entry.endsWith('.js')
  ? run(process.execPath, [entry, ...args], root)
  : run(entry, args, root);

function report(id, status, startedAt, evidence) {
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify({
    id, status, timestamp: new Date().toISOString(), duration_ms: Date.now() - startedAt,
    environment: 'installed-candidate', evidence,
  })}\n`);
}

function installedVersion(entry, expected) {
  const version = checked(cliRun(entry, repoRoot, ['--version']), `${entry} --version`);
  if (version !== expected) throw new Error(`版本=${version}，期望 ${expected}`);
  return version;
}

function isolatedTransition(candidateTarball, rollbackTarball) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-0142-transition-'));
  const prefix = join(root, 'prefix');
  const install = tarball => checked(run(npmCommand, [
    'install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', tarball,
  ]), `隔离安装 ${tarball}`);
  const uninstall = () => checked(run(npmCommand, [
    'uninstall', '--prefix', prefix, '--ignore-scripts', '@miniidealab/openlogos',
  ]), '隔离卸载 candidate');
  try {
    install(rollbackTarball);
    const entry = realpathSync(join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js'));
    installedVersion(entry, ROLLBACK_VERSION);
    uninstall(); install(candidateTarball);
    installedVersion(entry, EXPECTED_VERSION);
    const firstCandidateRealpath = realpathSync(entry);
    uninstall(); install(rollbackTarball);
    installedVersion(entry, ROLLBACK_VERSION);
    uninstall(); install(candidateTarball);
    installedVersion(entry, EXPECTED_VERSION);
    return { root, prefix, entry: realpathSync(entry), first_candidate_realpath: firstCandidateRealpath };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function fixtureCase(id, entry) {
  const output = checked(run(process.execPath, [
    join(repoRoot, 'scripts/merge-preflight-reopen-smoke-fixtures.js'), '--case', id, '--openlogos', entry,
  ]), id);
  const evidence = JSON.parse(output);
  if (evidence.id !== id || evidence.status !== 'pass' || !evidence.transaction_id || !evidence.receipt_sha256) {
    throw new Error(`${id} fixture evidence 不完整`);
  }
  return evidence;
}

async function completedArchivedRunlogosCase(entry, root, archiveInput, slotId) {
  const archiveRoot = realpathSync(join(root, 'logos/changes/archive'));
  const archiveDir = realpathSync(resolve(archiveInput));
  const archiveRelative = relative(archiveRoot, archiveDir);
  if (!archiveRelative || archiveRelative.startsWith('..') || isAbsolute(archiveRelative)) {
    throw new Error('RunLogos completed replay 必须指向项目 logos/changes/archive 下的真实归档目录');
  }
  const transactionModule = await importInstalledPackageModule('dist/lib/merge-transaction.js', {
    candidateBin: entry,
  });
  const semanticModule = await importInstalledPackageModule('dist/lib/merge-transaction-semantic.js', {
    candidateBin: entry,
  });
  const transaction = transactionModule.readMergeTransaction(archiveDir);
  semanticModule.assertMergeTransactionSemantics(transaction);
  if (transaction.transaction_id !== EXPECTED_RUNLOGOS_TRANSACTION || transaction.phase !== 'completed') {
    throw new Error('RunLogos 归档 transaction 不符合冻结的 completed 事实');
  }
  if (!transaction.receipt || transaction.content_slots.missing_slot_ids.length !== 0
    || transaction.content_slots.submitted !== transaction.content_slots.required) {
    throw new Error('RunLogos completed replay 缺少完整 receipt/slot 证据');
  }

  const receipt = JSON.parse(readFileSync(join(archiveDir, 'MERGE_RECEIPT.json'), 'utf8'));
  const marker = JSON.parse(readFileSync(join(archiveDir, 'SPEC_MERGED'), 'utf8'));
  const { schema: receiptSchema, ...canonicalReceipt } = receipt;
  if (receiptSchema !== transaction.schema) throw new Error('RunLogos 归档 receipt schema 不符合事务契约');
  const receiptSha256 = semanticModule.computeMergeReceiptSha256(canonicalReceipt);
  if (receipt.transaction_id !== transaction.transaction_id
    || receipt.receipt_sha256 !== receiptSha256
    || transaction.receipt.receipt_sha256 !== receiptSha256
    || marker.transaction_id !== transaction.transaction_id
    || marker.receipt_sha256 !== receiptSha256) {
    throw new Error('RunLogos 归档 receipt/SPEC_MERGED 身份或 hash 不一致');
  }
  const artifactHashes = {};
  for (const name of ['MERGE_RECEIPT.json', 'SPEC_MERGED']) {
    const expected = transaction.artifact_hashes.find(item => item.path.endsWith(`/${name}`));
    const actual = sha256(readFileSync(join(archiveDir, name)));
    if (!expected || expected.sha256 !== actual) throw new Error(`RunLogos 归档 ${name} artifact hash 不一致`);
    artifactHashes[name] = actual;
  }
  return {
    root, archived_change_dir: archiveDir, slot_id: slotId, retryable: true,
    recovered_replay: true, archived_replay: true,
    transaction_id: transaction.transaction_id, receipt_sha256: receiptSha256,
    artifact_hashes: artifactHashes,
  };
}

async function runlogosCase(entry) {
  if (process.env.OPENLOGOS_RUNLOGOS_RECOVERY_AUTHORIZED !== '1') {
    throw new Error('SMOKE-core-162 缺少 RunLogos 恢复/继续 merge 明确授权');
  }
  const root = realpathSync(resolve(process.env.OPENLOGOS_RUNLOGOS_ROOT || ''));
  const slotId = process.env.OPENLOGOS_RUNLOGOS_S44_SLOT_ID;
  const archivedChangeDir = process.env.OPENLOGOS_RUNLOGOS_ARCHIVED_CHANGE_DIR;
  if (archivedChangeDir) return completedArchivedRunlogosCase(entry, root, archivedChangeDir, slotId);
  const contentFile = realpathSync(resolve(process.env.OPENLOGOS_RUNLOGOS_S44_CONTENT_FILE || ''));
  if (!slotId || !existsSync(contentFile)) throw new Error('缺少 RunLogos S44 slot/content 输入');
  const initial = JSON.parse(checked(
    cliRun(entry, root, ['merge', 'transaction', 'status', '--format', 'json']),
    'RunLogos initial status',
  )).data.merge_transaction;
  if (initial.transaction_id !== EXPECTED_RUNLOGOS_TRANSACTION) throw new Error('RunLogos transaction 不符合冻结事实');
  if (initial.phase === 'completed') {
    if (!initial.receipt?.receipt_sha256 || initial.content_slots.missing_slot_ids.length !== 0) {
      throw new Error('RunLogos completed replay 缺少完整 receipt/slot 证据');
    }
    return {
      root, slot_id: slotId, retryable: true, recovered_replay: true,
      transaction_id: initial.transaction_id, receipt_sha256: initial.receipt.receipt_sha256,
    };
  }
  const apply = cliRun(entry, root, ['merge', 'transaction', 'apply', '--format', 'json']);
  if (apply.status === 0) throw new Error('RunLogos legacy apply 未触发预期 reopen');
  const error = JSON.parse(apply.stderr).error;
  const status = JSON.parse(checked(cliRun(entry, root, ['merge', 'transaction', 'status', '--format', 'json']), 'RunLogos status')).data.merge_transaction;
  if (status.transaction_id !== EXPECTED_RUNLOGOS_TRANSACTION || status.phase !== 'collecting'
    || JSON.stringify(status.content_slots.missing_slot_ids) !== JSON.stringify([slotId])) {
    throw new Error('RunLogos reopen transaction/missing slot 不符合冻结事实');
  }
  const descriptor = status.content_slots.items.find(item => item.slot_id === slotId);
  if (!descriptor) throw new Error('RunLogos S44 slot descriptor 缺失');
  const staging = join(root, ...descriptor.staging_path.split('/'));
  mkdirSync(dirname(staging), { recursive: true });
  const temp = join(dirname(staging), `.content.${process.pid}.tmp`);
  writeFileSync(temp, readFileSync(contentFile));
  renameSync(temp, staging);
  checked(cliRun(entry, root, ['merge', 'transaction', 'submit-content', '--slot', slotId, '--file', descriptor.staging_path, '--format', 'json']), 'RunLogos submit');
  checked(cliRun(entry, root, ['merge', 'transaction', 'seal', '--format', 'json']), 'RunLogos reseal');
  const completed = JSON.parse(checked(cliRun(entry, root, ['merge', 'transaction', 'apply', '--format', 'json']), 'RunLogos apply')).data.merge_transaction;
  if (completed.phase !== 'completed' || completed.transaction_id !== EXPECTED_RUNLOGOS_TRANSACTION) throw new Error('RunLogos 未完成同一事务');
  return { root, slot_id: slotId, retryable: error.details?.retryable, transaction_id: completed.transaction_id, receipt_sha256: completed.receipt.receipt_sha256 };
}

const candidateTarball = requiredFile('OPENLOGOS_RELEASE_0_14_2_TARBALL', 'OPENLOGOS_TARBALL');
const rollbackTarball = requiredFile('OPENLOGOS_RELEASE_0_14_2_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
const configuredBin = realpathSync(resolve(process.env.OPENLOGOS_CANDIDATE_BIN || ''));
installedVersion(configuredBin, EXPECTED_VERSION);
const transition = isolatedTransition(candidateTarball, rollbackTarball);
let failed = false;
try {
  for (const id of RELEASE_0_14_2_SMOKE_IDS) {
    const startedAt = Date.now();
    try {
      const evidence = id === 'SMOKE-core-162' ? await runlogosCase(configuredBin) : fixtureCase(id, transition.entry);
      report(id, 'pass', startedAt, {
        cli_realpath: id === 'SMOKE-core-162' ? configuredBin : transition.entry,
        cli_version: EXPECTED_VERSION,
        candidate_tarball_sha256: sha256(readFileSync(candidateTarball)),
        rollback_tarball_sha256: sha256(readFileSync(rollbackTarball)),
        fixture_or_project_root: evidence.root ?? evidence.cli_realpath,
        ...evidence,
      });
    } catch (error) {
      failed = true;
      report(id, 'fail', startedAt, { error: error instanceof Error ? error.message : String(error) });
      break;
    }
  }
} finally {
  rmSync(transition.root, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
