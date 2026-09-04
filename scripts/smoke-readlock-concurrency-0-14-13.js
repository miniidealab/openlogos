#!/usr/bin/env node
/**
 * SMOKE-core-177 — 0.14.13 安装态并发只读全零退出与真冲突如实报错。
 *
 * 双红线：
 *   ③ 8 路并发只读 status 必须全部零退出——任一路 baseline_commit_in_progress 即整体 FAIL，
 *      那正是被修复的缺陷（reader-reader 假阳性）；
 *   ④ 受控夹具进程以协议内方式（安装态包自身的 acquireLock）真持锁超读者预算时，
 *      status 必须非零退出且错误码为 baseline_commit_in_progress——若成功返回说明硬门被弱化。
 *
 * 零回归对照（强制）：同一并发断言在固定 0.14.12 上必须复现失败（2026-09-03 实测 8 路 7 失败）；
 * 若在 0.14.12 上也全零退出，说明断言空转（并发度或时序未撞锁），整体 FAIL、不得放行部署。
 *
 * 硬约束：不得手工删除或改写模块锁文件与 journal 构造前提；并发断言由 N 个真实独立 CLI 进程构成。
 */
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const READLOCK_SMOKE_IDS = ['SMOKE-core-177'];
const EXPECTED_VERSION = '0.14.13';
const ROLLBACK_VERSION = '0.14.12';
const ENVIRONMENT = 'local-global-temp-project';
const READERS = 8;
const CANDIDATE_ROUNDS = 3;     // 候选版本：每一轮都必须全零退出
const COUNTER_ROUNDS = 6;       // 0.14.12 对照：至多几轮内必须观察到至少一次假阳性
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: READLOCK_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_READLOCK_TARBALL', 'OPENLOGOS_READLOCK_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

if (!process.env.DRYRUN_ENTRY) {
  requireEnvOrSkip(READLOCK_SMOKE_IDS, [
    ['OPENLOGOS_READLOCK_TARBALL', 'OPENLOGOS_TARBALL'],
    ['OPENLOGOS_READLOCK_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
  ], {
    reason: '读锁并发 smoke 需要 0.14.13 候选与 0.14.12 回滚制品',
    environment: 'readlock-concurrency',
  });
}

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const run = (cmd, args, cwd = root) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000 });

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
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-lc', 'command -v openlogos']);
  return realpathSync(checked(r, '定位全局 openlogos').split(/\r?\n/)[0]);
}

const cliBin = e => (e.endsWith('.js') ? process.execPath : e);
const cliArgs = (e, a) => (e.endsWith('.js') ? [e, ...a] : a);
const cli = (e, cwd, a) => checked(run(cliBin(e), cliArgs(e, a), cwd), `openlogos ${a.join(' ')}`);
const installGlobal = (tb, v) => checked(run(npmCommand, ['install', '--global', tb]), `全局安装 ${v}`);

function assertInstalledIdentity(expected) {
  const entry = commandLookup();
  const version = cli(entry, root, ['--version']).trim();
  if (!version.includes(expected)) throw new Error(`全局 openlogos 版本不符：期望 ${expected}，实际 ${version}`);
  return { entry, version };
}

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

/** 一次性 adopted 夹具项目：status/next 的读取门会对 adopted 模块取模块级事务锁。 */
function scaffold(entry) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-177-'));
  cli(entry, base, ['init', 'readlock-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8')
    .replace(/^(\s*)lifecycle:.*$/m, '$1lifecycle: launched\n$1bootstrap: adopted\n$1baseline_seed_state: partial'));
  return base;
}

const runsDir = base => join(base, 'logos', 'resources', 'verify', 'baseline-seed-runs');

function spawnReader(entry, cwd) {
  return new Promise(resolvePromise => {
    const child = spawn(cliBin(entry), cliArgs(entry, ['status', '--format', 'json']), { cwd });
    let out = '';
    let err = '';
    child.stdout.on('data', d => { out += String(d); });
    child.stderr.on('data', d => { err += String(d); });
    child.on('close', code => resolvePromise({ code: code ?? -1, out, err }));
  });
}

/** 一轮 N 路真实进程并发只读；返回逐路退出码、错误码计数与投影集合。 */
async function concurrencyRound(entry, base) {
  const results = await Promise.all(Array.from({ length: READERS }, () => spawnReader(entry, base)));
  const codes = results.map(r => r.code);
  const falsePositives = results.filter(r => `${r.out}${r.err}`.includes('baseline_commit_in_progress')).length;
  const projections = new Set();
  for (const r of results) {
    if (r.code !== 0) continue;
    try {
      const env = JSON.parse(r.out);
      projections.add(JSON.stringify((env.data?.modules ?? []).map(m => ({ id: m.id, seed: m.baseline_seed_state }))));
    } catch { projections.add('<unparsable>'); }
  }
  return { codes, false_positives: falsePositives, distinct_projections: projections.size };
}

function assertNoResidualLock(base) {
  const residual = existsSync(runsDir(base)) ? readdirSync(runsDir(base)).filter(f => f.endsWith('.commit.lock')) : [];
  if (residual.length > 0) throw new Error(`并发结束后残留锁文件：${residual.join(', ')}`);
}

/** ②③ 候选版本：每一轮 8 路并发都必须全零退出、投影一致、无残留锁。 */
async function exerciseCandidateConcurrency(entry) {
  const base = scaffold(entry);
  try {
    const rounds = [];
    for (let i = 0; i < CANDIDATE_ROUNDS; i++) {
      const round = await concurrencyRound(entry, base);
      rounds.push(round);
      if (round.codes.some(c => c !== 0) || round.false_positives > 0) {
        throw new Error(`【并发假阳性未消除】第 ${i + 1} 轮退出码=${JSON.stringify(round.codes)}，`
          + `baseline_commit_in_progress 出现 ${round.false_positives} 次——这正是被修复的缺陷`);
      }
      if (round.distinct_projections !== 1) {
        throw new Error(`【投影不一致】第 ${i + 1} 轮出现 ${round.distinct_projections} 种模块投影`);
      }
    }
    assertNoResidualLock(base);
    return { rounds, readers_per_round: READERS };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** 零回归对照：同一断言在 0.14.12 上必须复现假阳性，否则断言空转。 */
async function exerciseCounterOnRollback(entry) {
  const base = scaffold(entry);
  try {
    const rounds = [];
    for (let i = 0; i < COUNTER_ROUNDS; i++) {
      const round = await concurrencyRound(entry, base);
      rounds.push(round);
      if (round.false_positives > 0) return { reproduced_at_round: i + 1, rounds };
    }
    throw new Error(`【断言空转】${COUNTER_ROUNDS} 轮 ${READERS} 路并发在 ${ROLLBACK_VERSION} 上均全零退出，`
      + '未复现 reader-reader 假阳性——必须重写用例而非放行部署');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** ④⑤ 真冲突对照：受控夹具进程以安装态包自身的 acquireLock（协议内）持锁超读者预算。 */
async function exerciseTrueConflict(entry) {
  const base = scaffold(entry);
  try {
    const pkgRoot = packageRoot(entry);
    const lockLib = pathToFileURL(join(pkgRoot, 'dist', 'lib', 'baseline-seed-txn.js')).href;
    const holder = join(base, 'holder.mjs');
    writeFileSync(holder, [
      `import { acquireLock, releaseLock } from ${JSON.stringify(lockLib)};`,
      'const [projectRoot, ms] = process.argv.slice(2);',
      "if (!acquireLock(projectRoot, 'core')) { console.error('holder-failed'); process.exit(2); }",
      "console.log('held');",
      "setTimeout(() => { releaseLock(projectRoot, 'core'); process.exit(0); }, Number(ms));",
    ].join('\n'));
    const holderChild = spawn(process.execPath, [holder, base, '4000']);
    const holderExit = new Promise(resolvePromise => holderChild.on('close', c => resolvePromise(c ?? -1)));
    await new Promise((resolvePromise, rejectPromise) => {
      holderChild.stdout.on('data', d => { if (String(d).includes('held')) resolvePromise(); });
      holderChild.on('close', () => rejectPromise(new Error('夹具进程未能以协议内方式取到锁')));
    });

    // ④ 持锁窗口内：status 必须如实报 baseline_commit_in_progress、非零退出。
    const blocked = await spawnReader(entry, base);
    if (blocked.code === 0) throw new Error('【硬门被弱化】writer 真持锁期间 status 竟成功返回');
    if (!`${blocked.out}${blocked.err}`.includes('baseline_commit_in_progress')) {
      throw new Error(`真持锁失败输出未携带 baseline_commit_in_progress：${(blocked.out + blocked.err).slice(0, 300)}`);
    }

    // ⑤ 释放后恢复：writer 正常走完持锁窗口（提交不受干扰），读者恢复零退出。
    const holderCode = await holderExit;
    if (holderCode !== 0) throw new Error(`夹具持锁进程异常退出：${holderCode}`);
    const after = await spawnReader(entry, base);
    if (after.code !== 0) throw new Error(`释放后 status 未恢复零退出：${(after.out + after.err).slice(0, 300)}`);
    assertNoResidualLock(base);
    return { blocked_exit: blocked.code, holder_exit: holderCode, recovered_exit: after.code };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

async function smoke(id, operation) {
  const started = Date.now();
  let record;
  try {
    const evidence = await operation();
    record = { id, status: 'pass', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: ENVIRONMENT, evidence };
  } catch (error) {
    record = { id, status: 'fail', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: ENVIRONMENT, evidence: [], error: error instanceof Error ? error.message : String(error) };
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  if (record.status !== 'pass') throw new Error(record.error);
  return record;
}

if (process.env.DRYRUN_ENTRY) {
  const e = realpathSync(process.env.DRYRUN_ENTRY);
  const concurrency = await exerciseCandidateConcurrency(e);
  const conflict = await exerciseTrueConflict(e);
  console.log(`MATRIX ${JSON.stringify({ version: cli(e, root, ['--version']).trim(), concurrency, conflict }, null, 1)}`);
  process.exit(0);
}

await smoke('SMOKE-core-177', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_READLOCK_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_READLOCK_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②③ 并发复现路径（候选：全零退出）+ ④⑤ 真冲突对照
  const concurrency = await exerciseCandidateConcurrency(initial.entry);
  const conflict = await exerciseTrueConflict(initial.entry);

  // ⑥ 既有 SMOKE-core-176 的回归由其 runner 在 run-smoke 同批分派中自行承担
  // ⑦ 0.14.12→0.14.13 往返 + 零回归对照：并发断言在 0.14.12 上必须复现失败
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  const counter = await exerciseCounterOnRollback(rolledBack.entry);
  const conflictOnRollback = await exerciseTrueConflict(rolledBack.entry); // ④ 两版本行为一致
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const concurrencyAfterRestore = await exerciseCandidateConcurrency(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    concurrency, conflict,
    zero_regression_counter: counter, conflict_on_rollback: conflictOnRollback,
    concurrency_after_restore: concurrencyAfterRestore,
  }];
});
