#!/usr/bin/env node
/**
 * SMOKE-core-197..199 — OpenLogos 0.15.0 打包候选安装态取证。
 *
 * 在**一次性隔离 npm prefix** 中对固定 0.15.0 tarball 取证：candidate identity、破坏性契约、
 * 以及**本机全局零触碰**。按减法方案 §13 保险条款，本 runner 绝不执行本机全局安装。
 *
 * 只接受冻结的本地 tarball；不执行 publish、dist-tag、tag、release 或 push。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';

const IDS = ['SMOKE-core-197', 'SMOKE-core-198', 'SMOKE-core-199'];
const EXPECTED_VERSION = '0.15.0';
const EXPECTED_GLOBAL_VERSION = '0.14.25';
const repoRoot = resolve(import.meta.dirname, '..');

const resultPath = process.env.OPENLOGOS_SMOKE_RESULT_PATH
  ?? join(repoRoot, 'logos/resources/verify/smoke-results.jsonl');

function record(id, status, detail) {
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify({ id, status, detail, at: new Date().toISOString() })}\n`);
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 300_000 });

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({ ids: IDS, candidate_version: EXPECTED_VERSION, global_untouched: EXPECTED_GLOBAL_VERSION, public_release_commands: [] }));
  process.exit(0);
}

const tarballArg = process.argv[2];
if (!tarballArg || !isAbsolute(tarballArg) || !existsSync(tarballArg)) {
  // 环境不具备（未提供冻结 tarball）：为每个 owned ID 写 skip，禁止零记录退出。
  for (const id of IDS) record(id, 'skip', 'OPENLOGOS_RELEASE_0_15_0_TARBALL 未提供冻结 tarball 绝对路径');
  console.log('skip: 未提供冻结 tarball');
  process.exit(0);
}

// 部署前冻结本机全局事实
const globalBefore = run('openlogos', ['--version'], repoRoot);
const globalVersionBefore = globalBefore.status === 0 ? globalBefore.stdout.trim() : null;

const work = mkdtempSync(join(tmpdir(), 'openlogos-smoke-0150-'));
try {
  // ── SMOKE-core-197：candidate identity 冻结 ──
  const prefix = join(work, 'prefix');
  mkdirSync(prefix, { recursive: true });
  const install = run('npm', ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', tarballArg], work);
  if (install.status !== 0) throw new Error(`隔离安装失败：${install.stderr}`);
  const pkgRoot = join(prefix, 'node_modules/@miniidealab/openlogos');
  const entry = join(pkgRoot, 'dist/index.js');
  const version = run(process.execPath, [entry, '--version'], work).stdout.trim();
  const pkgVersion = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version;
  const assetVersion = JSON.parse(readFileSync(join(pkgRoot, 'asset-manifest.json'), 'utf8')).version;
  if (version !== EXPECTED_VERSION || pkgVersion !== EXPECTED_VERSION || assetVersion !== EXPECTED_VERSION) {
    throw new Error(`candidate identity 不一致：cli=${version} pkg=${pkgVersion} asset=${assetVersion}`);
  }
  if (!entry.startsWith(prefix)) throw new Error('入口未落在隔离 prefix 内（疑似 workspace link）');
  record('SMOKE-core-197', 'pass', `version=${EXPECTED_VERSION} tarball_sha256=${sha256(readFileSync(tarballArg))}`);

  // ── SMOKE-core-198：破坏性契约生效 ──
  const proj = join(work, 'proj');
  mkdirSync(proj, { recursive: true });
  for (const args of [['merge', 'transaction', 'status'], ['merge-apply', 'x']]) {
    if (run(process.execPath, [entry, ...args], proj).status === 0) {
      throw new Error(`已删除命令未 fail-closed：${args.join(' ')}`);
    }
  }
  for (const args of [['slice'], ['lint-specs']]) {
    const r = run(process.execPath, [entry, ...args], proj);
    if (`${r.stdout}${r.stderr}`.includes('Unknown command')) throw new Error(`新命令不可用：${args.join(' ')}`);
  }
  record('SMOKE-core-198', 'pass', '已删除命令面 fail-closed；slice plan 与 lint-specs 可用');

  // ── SMOKE-core-199：本机全局零触碰 ──
  const globalAfter = run('openlogos', ['--version'], repoRoot);
  const globalVersionAfter = globalAfter.status === 0 ? globalAfter.stdout.trim() : null;
  if (globalVersionAfter !== globalVersionBefore) {
    throw new Error(`本机全局被改动：${globalVersionBefore} → ${globalVersionAfter}`);
  }
  if (globalVersionAfter !== null && globalVersionAfter !== EXPECTED_GLOBAL_VERSION) {
    throw new Error(`本机全局应保持 ${EXPECTED_GLOBAL_VERSION}，实为 ${globalVersionAfter}`);
  }
  record('SMOKE-core-199', 'pass', `global=${globalVersionAfter ?? '(未安装)'} 前后一致`);
  console.log('0.15.0 打包候选 smoke 全部通过');
} catch (error) {
  for (const id of IDS) record(id, 'fail', String(error instanceof Error ? error.message : error));
  console.error(String(error));
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
