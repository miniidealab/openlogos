#!/usr/bin/env node
/**
 * SMOKE-core-168 — 0.14.4 嵌套章节锚、回滚往返与 RunLogos 原事务恢复。
 * 仅接受冻结本地 tarball；不包含任何公开发布、远程仓库或官网写操作。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const NESTED_SECTION_ANCHOR_SMOKE_IDS = ['SMOKE-core-168'];
const EXPECTED_VERSION = '0.14.4';
const ROLLBACK_VERSION = '0.14.3';
const RUNLOGOS_TRANSACTION_ID = 'mtx_e7f7b924499d49f96aaf8a2f';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: NESTED_SECTION_ANCHOR_SMOKE_IDS,
    environment: 'local-global-runlogos',
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_NESTED_ANCHOR_TARBALL', 'OPENLOGOS_NESTED_ANCHOR_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    required_runlogos_env: ['OPENLOGOS_RUNLOGOS_ROOT', 'OPENLOGOS_RUNLOGOS_FINAL_CONTENT'],
    target_slug_env: 'OPENLOGOS_RUNLOGOS_SLUG',
    runlogos_merge_authority_env: 'OPENLOGOS_RUNLOGOS_MERGE_AUTHORIZED',
    transaction_id: RUNLOGOS_TRANSACTION_ID,
    public_release_commands: [],
  }));
  process.exit(0);
}

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function run(command, args, cwd = root, env = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 600_000 });
}

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result.stdout.trim();
}

function requiredFile(primary, routed) {
  const raw = process.env[primary] || process.env[routed];
  if (!raw) throw new Error(`缺少 ${primary}`);
  const path = realpathSync(resolve(raw));
  if (!existsSync(path)) throw new Error(`${primary} 不存在：${path}`);
  return { path, sha256: sha256(readFileSync(path)) };
}

function commandLookup() {
  const result = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-lc', 'command -v openlogos']);
  return realpathSync(checked(result, '定位全局 openlogos').split(/\r?\n/)[0]);
}

function cliJson(entry, cwd, args) {
  const command = entry.endsWith('.js') ? process.execPath : entry;
  const commandArgs = entry.endsWith('.js') ? [entry, ...args, '--format', 'json'] : [...args, '--format', 'json'];
  return JSON.parse(checked(run(command, commandArgs, cwd), `openlogos ${args.join(' ')}`)).data.merge_transaction;
}

function assertInstalledIdentity(expectedVersion, expectedTarballSha) {
  const entry = commandLookup();
  const version = checked(run(entry, ['--version']), 'openlogos --version');
  if (version !== expectedVersion) throw new Error(`全局版本=${version}，期望 ${expectedVersion}`);
  const packageRoot = realpathSync(join(dirname(entry), '..'));
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const asset = JSON.parse(readFileSync(join(packageRoot, 'asset-manifest.json'), 'utf8'));
  if (pkg.version !== expectedVersion || asset.version !== expectedVersion) throw new Error('package/asset 版本混装');
  const manifests = [
    'claude-plugin-template/.claude-plugin/plugin.json', 'codex-plugin-template/plugin.json',
    'zcode-plugin-template/.zcode-plugin/plugin.json', 'qoder-plugin-template/.qoder-plugin/plugin.json',
    'workbuddy-plugin-template/.workbuddy-plugin/plugin.json',
  ];
  for (const path of manifests) {
    if (JSON.parse(readFileSync(join(packageRoot, path), 'utf8')).version !== expectedVersion) {
      throw new Error(`plugin manifest 版本混装：${path}`);
    }
  }
  return { entry, package_root: packageRoot, version, tarball_sha256: expectedTarballSha, asset_payload_hash: asset.payloadHash };
}

function installGlobal(tarball, version) {
  checked(run(npmCommand, ['install', '-g', '--force', '--ignore-scripts', '--no-audit', '--no-fund', tarball]), `安装 ${version}`);
}

function exerciseNestedFixture(entry) {
  const output = checked(run(process.execPath, [
    join(root, 'scripts/merge-preflight-reopen-smoke-fixtures.js'),
    '--case', 'SMOKE-core-168', '--openlogos', entry,
  ]), '执行嵌套章节锚临时 fixture');
  const evidence = JSON.parse(output);
  if (evidence.id !== 'SMOKE-core-168' || evidence.status !== 'pass') throw new Error('临时 fixture 未真实通过');
  return evidence;
}

function recoverRunLogos(entry) {
  if (process.env.OPENLOGOS_RUNLOGOS_MERGE_AUTHORIZED !== '1') {
    throw new Error('缺少 RunLogos merge 独立授权：OPENLOGOS_RUNLOGOS_MERGE_AUTHORIZED=1');
  }
  const runlogosRoot = realpathSync(resolve(process.env.OPENLOGOS_RUNLOGOS_ROOT || ''));
  const contentFile = realpathSync(resolve(process.env.OPENLOGOS_RUNLOGOS_FINAL_CONTENT || ''));
  // 经 --slug 显式寻址目标提案：不带 slug 会解析 RunLogos 当前活跃 guard，在原提案归档、
  // 活跃变更换成别的之后必然拿到另一个事务。目标提案 slug 由 env 显式给出，命中活跃或
  // 已归档目录都由 CLI 的单点解析器负责——runner 不自建查找逻辑、不改写 guard。
  const targetSlug = process.env.OPENLOGOS_RUNLOGOS_SLUG;
  const statusArgs = ['merge', 'transaction', 'status', ...(targetSlug ? ['--slug', targetSlug] : [])];
  const status = cliJson(entry, runlogosRoot, statusArgs);
  if (status.transaction_id === RUNLOGOS_TRANSACTION_ID && status.phase === 'completed') {
    if (status.content_slots.required !== 7 || status.content_slots.submitted !== 7
      || status.content_slots.missing_slot_ids.length !== 0 || !status.receipt?.receipt_sha256) {
      throw new Error('RunLogos 原 transaction completed 投影不完整');
    }
    return {
      transaction_id: status.transaction_id,
      receipt_sha256: status.receipt.receipt_sha256,
      content_slots: status.content_slots,
      replayed_completed: true,
    };
  }
  if (status.transaction_id !== RUNLOGOS_TRANSACTION_ID || status.phase !== 'collecting'
    || status.content_slots.required !== 7 || status.content_slots.submitted !== 6
    || status.content_slots.missing_slot_ids.length !== 1) throw new Error('RunLogos 原 transaction 冻结事实漂移');
  const slotId = status.content_slots.missing_slot_ids[0];
  const descriptor = status.content_slots.items.find(item => item.slot_id === slotId);
  const staging = join(runlogosRoot, ...descriptor.staging_path.split('/'));
  mkdirSync(dirname(staging), { recursive: true });
  const temporary = join(dirname(staging), `.content.${process.pid}.tmp`);
  writeFileSync(temporary, readFileSync(contentFile));
  const handle = openSync(temporary, 'r');
  try { fsyncSync(handle); } finally { closeSync(handle); }
  renameSync(temporary, staging);
  const ready = cliJson(entry, runlogosRoot, ['merge', 'transaction', 'submit-content', '--slot', slotId, '--file', descriptor.staging_path]);
  const sealed = cliJson(entry, runlogosRoot, ['merge', 'transaction', 'seal']);
  const completed = cliJson(entry, runlogosRoot, ['merge', 'transaction', 'apply']);
  if (ready.transaction_id !== RUNLOGOS_TRANSACTION_ID || sealed.transaction_id !== RUNLOGOS_TRANSACTION_ID
    || completed.transaction_id !== RUNLOGOS_TRANSACTION_ID || completed.phase !== 'completed') {
    throw new Error('RunLogos 原 transaction 未在同一身份下完成');
  }
  return { transaction_id: completed.transaction_id, receipt_sha256: completed.receipt.receipt_sha256, content_slots: completed.content_slots };
}

async function smoke(id, operation) {
  const started = Date.now();
  let record;
  try {
    const evidence = await operation();
    record = {
      id, status: 'pass', timestamp: new Date().toISOString(), duration_ms: Date.now() - started,
      environment: 'local-global-runlogos', evidence,
    };
  } catch (error) {
    record = {
      id, status: 'fail', timestamp: new Date().toISOString(), duration_ms: Date.now() - started,
      environment: 'local-global-runlogos', evidence: [], error: error instanceof Error ? error.message : String(error),
    };
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  if (record.status !== 'pass') throw new Error(record.error);
  return record;
}

await smoke('SMOKE-core-168', async () => {
  const candidate = requiredFile('OPENLOGOS_NESTED_ANCHOR_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_NESTED_ANCHOR_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION, candidate.sha256);
  const firstFixture = exerciseNestedFixture(initial.entry);
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION, rollback.sha256);
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION, candidate.sha256);
  const secondFixture = exerciseNestedFixture(restored.entry);
  const runlogos = recoverRunLogos(restored.entry);
  return [{ candidate, rollback, initial, rolled_back: rolledBack, restored, first_fixture: firstFixture, second_fixture: secondFixture, runlogos }];
});
