#!/usr/bin/env node
/**
 * SMOKE-core-170 — 0.14.6 归档事务只读寻址、写动作 fail-closed 与不适用显式 skip。
 *
 * 只接受冻结本地 tarball；归档寻址断言全部在一次性夹具中构造，
 * **不为构造断言而归档新提案、不改写 guard、不触碰任何既有归档内容**；
 * 不包含公开发布、远程仓库或官网写操作。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const ARCHIVED_ADDRESSABILITY_SMOKE_IDS = ['SMOKE-core-170'];
const EXPECTED_VERSION = '0.14.6';
const ROLLBACK_VERSION = '0.14.5';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: ARCHIVED_ADDRESSABILITY_SMOKE_IDS,
    environment: 'local-global-temp-project',
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_ARCHIVED_ADDR_TARBALL', 'OPENLOGOS_ARCHIVED_ADDR_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

// 环境不具备（缺候选/回滚制品）必须留痕：沿用不适用契约，禁止硬失败或静默零记录退出
requireEnvOrSkip(ARCHIVED_ADDRESSABILITY_SMOKE_IDS, [
  ['OPENLOGOS_ARCHIVED_ADDR_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_ARCHIVED_ADDR_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: '归档事务可寻址 smoke 需要 0.14.6 候选与 0.14.5 回滚制品',
  environment: 'archived-addressability',
});

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

const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);

function cli(entry, cwd, args) {
  return checked(run(cliBin(entry), cliArgs(entry, args), cwd), `openlogos ${args.join(' ')}`);
}

/** 允许非零退出：用于观察 fail-closed 的 error envelope */
function cliRaw(entry, cwd, args) {
  const r = run(cliBin(entry), cliArgs(entry, args), cwd);
  return { status: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

function cliJson(entry, cwd, args) {
  const r = run(cliBin(entry), cliArgs(entry, [...args, '--format', 'json']), cwd);
  const raw = (r.status === 0 ? r.stdout : r.stderr).trim().split('\n').pop() ?? '';
  try { return { status: r.status, json: JSON.parse(raw) }; } catch { return { status: r.status, json: null, raw }; }
}

function installGlobal(tarball, expectedVersion) {
  checked(run(npmCommand, ['install', '--global', tarball]), `全局安装 ${expectedVersion}`);
}

function assertInstalledIdentity(expectedVersion) {
  const entry = commandLookup();
  const version = cli(entry, root, ['--version']).trim();
  if (!version.includes(expectedVersion)) {
    throw new Error(`全局 openlogos 版本不符：期望 ${expectedVersion}，实际 ${version}`);
  }
  return { entry, version };
}

/**
 * 夹具用**仓库中已归档提案的真实事务文件**构造。
 *
 * 不用 `openlogos merge` 现造事务：那需要过完整 change-lint 门，与本用例被测的
 * 「按目录位置寻址」无关；也不改写任何既有归档内容——只把字节复制进一次性目录。
 */
function archivedTransactionSource() {
  const archiveRoot = join(root, 'logos', 'changes', 'archive');
  if (!existsSync(archiveRoot)) throw new Error('仓库缺少 logos/changes/archive，夹具前提不成立');
  for (const name of readdirSync(archiveRoot).sort().reverse()) {
    const dir = join(archiveRoot, name);
    if (!existsSync(join(dir, 'MERGE_TRANSACTION.json'))) continue;
    const slug = name.replace(/^\d{8}-\d{4}-/, '');
    if (slug !== name) return { dir, slug };
  }
  throw new Error('归档目录中找不到含 MERGE_TRANSACTION.json 的提案');
}

/** 一次性夹具项目骨架（不跑 init：只需 logos.config.json 与 guard） */
function fixtureProject() {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-170-'));
  mkdirSync(join(base, 'logos'), { recursive: true });
  writeFileSync(join(base, 'logos', 'logos.config.json'), '{"locale":"zh","project":{"type":"cli"}}\n');
  writeFileSync(join(base, 'logos', '.openlogos-guard'), `${JSON.stringify({ activeChange: 'some-other-change', module: 'core' })}\n`);
  return base;
}

const placeProposal = (base, src, dest) => {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  return dest;
};

/** 步骤 ②③④⑤：归档寻址、写动作 fail-closed、歧义 */
function exerciseArchivedAddressability(entry) {
  const { dir: srcDir, slug } = archivedTransactionSource();
  const base = fixtureProject();
  try {
    // 活跃态读一次，作为归档前的身份基线
    const activeDir = placeProposal(base, srcDir, join(base, 'logos', 'changes', slug));
    const beforeOut = cliJson(entry, base, ['merge', 'transaction', 'status', '--slug', slug]);
    if (beforeOut.status !== 0) throw new Error('活跃态事务不可读，夹具前提不成立');
    const before = beforeOut.json.data.merge_transaction;

    // 放成归档态：logos/changes/archive/<时间戳>-<slug>
    rmSync(activeDir, { recursive: true, force: true });
    const archivedDir = placeProposal(base, srcDir, join(base, 'logos', 'changes', 'archive', `20260101-1200-${slug}`));
    const txFile = join(archivedDir, 'MERGE_TRANSACTION.json');
    const txBefore = sha256(readFileSync(txFile));

    // ③ 归档后只读寻址：身份守恒 + staging_path 仍是完整 project-relative
    const afterOut = cliJson(entry, base, ['merge', 'transaction', 'status', '--slug', slug]);
    if (afterOut.status !== 0) throw new Error('归档后无法只读寻址该事务');
    const tx = afterOut.json.data.merge_transaction;
    if (tx.transaction_id !== before.transaction_id || tx.phase !== before.phase) {
      throw new Error('归档前后事务身份漂移');
    }
    for (const item of tx.content_slots.items) {
      if (!item.staging_path.startsWith('logos/changes/archive/')) {
        throw new Error(`归档态 staging_path 不是完整 project-relative 路径：${item.staging_path}`);
      }
    }

    // ④ 写动作全部 fail-closed 且零副作用
    const rejected = [];
    for (const action of ['seal', 'apply', 'recover', 'abort']) {
      const r = cliJson(entry, base, ['merge', 'transaction', action, '--slug', slug]);
      if (r.status === 0) throw new Error(`归档提案上的 ${action} 未被拒绝`);
      const code = r.json?.error?.details?.classification ?? r.json?.error?.code;
      if (code !== 'action_not_allowed') throw new Error(`${action} 的 classification 非预期：${code}`);
      rejected.push(action);
    }
    if (sha256(readFileSync(txFile)) !== txBefore) throw new Error('写动作拒绝路径产生了副作用');

    // ⑤ 歧义 fail-closed
    placeProposal(base, srcDir, join(base, 'logos', 'changes', 'archive', `20260202-0900-${slug}`));
    const ambiguous = cliRaw(entry, base, ['merge', 'transaction', 'status', '--slug', slug]);
    if (ambiguous.status === 0 || !ambiguous.out.includes('多个归档目录')) {
      throw new Error('同 slug 多归档命中未 fail-closed');
    }

    return {
      source_slug: slug,
      transaction_id: tx.transaction_id,
      phase: tx.phase,
      identity_stable: true,
      staging_path_project_relative: true,
      rejected_write_actions: rejected,
      tx_sha256_stable: true,
      ambiguity_fail_closed: true,
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** 步骤 ⑥：账本中不得存在零记录退出的 runner，不适用必须带原因 */
function exerciseSkipLedger() {
  const ledger = join(mkdtempSync(join(tmpdir(), 'openlogos-smoke-170-ledger-')), 'smoke-results.jsonl');
  const hosts = [
    ['scripts/smoke-zcode-staging.js', 8],
    ['scripts/smoke-qoder-staging.js', 8],
    ['scripts/smoke-workbuddy-staging.js', 8],
    ['scripts/smoke-trae-local-negative.js', 6],
  ];
  let expected = 0;
  for (const [script, owned] of hosts) {
    const r = run(process.execPath, [join(root, script)], root, { ...process.env, OPENLOGOS_SMOKE_RESULT_PATH: ledger });
    if (r.status !== 0) throw new Error(`${script} 在环境不具备时应以成功状态退出，实际 exit ${r.status}`);
    expected += owned;
  }
  const records = existsSync(ledger)
    ? readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
    : [];
  if (records.length !== expected) {
    throw new Error(`账本记录数 ${records.length} ≠ 期望 ${expected}——存在零记录退出的 runner`);
  }
  if (!records.every(r => r.status === 'skip')) throw new Error('不适用记录必须全部为 skip');
  if (records.some(r => r.status === 'pass')) throw new Error('检测到伪造 pass');
  if (!records.every(r => r.not_applicable_reason && (r.missing_requirements?.length ?? 0) > 0)) {
    throw new Error('skip 记录缺不适用原因或缺失项');
  }
  rmSync(dirname(ledger), { recursive: true, force: true });
  return { runners: hosts.length, skip_records: records.length, all_with_reason: true, zero_record_exits: 0 };
}

async function smoke(id, operation) {
  const started = Date.now();
  let record;
  try {
    const evidence = await operation();
    record = { id, status: 'pass', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: 'local-global-temp-project', evidence };
  } catch (error) {
    record = { id, status: 'fail', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: 'local-global-temp-project', evidence: [], error: error instanceof Error ? error.message : String(error) };
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  if (record.status !== 'pass') throw new Error(record.error);
  return record;
}

await smoke('SMOKE-core-170', async () => {
  const candidate = requiredFile('OPENLOGOS_ARCHIVED_ADDR_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_ARCHIVED_ADDR_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');

  const initial = assertInstalledIdentity(EXPECTED_VERSION);
  const addressability = exerciseArchivedAddressability(initial.entry);
  const ledger = exerciseSkipLedger();

  // ⑦ 回滚往返
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const addressabilityAfterRestore = exerciseArchivedAddressability(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    addressability, addressability_after_restore: addressabilityAfterRestore,
    skip_ledger: ledger,
  }];
});
