#!/usr/bin/env node
/**
 * 本机测试环境脚本部署安装态 smoke（SMOKE-core-268～SMOKE-core-271）。
 *
 * 权威定义：smoke 用例「本机测试环境脚本部署安装态 smoke（SMOKE-core-268～271）」与部署方案
 * 「本机测试环境脚本部署（scripts/deploy-local.mjs）」第二、四～七节。由 scripts/run-smoke.js 按 smoke-*.js 发现执行。
 *
 * 判据是三方交叉比对：脚本回执（logos/.openlogos-runtime/local-install/last-deploy.json）、账本
 * （`openlogos env show test --format json`）与实际安装内容（全局入口、package.json、dist/index.js，留存的候选与回滚制品）。
 *
 * 只读：不安装、不卸载全局，不改写运行态目录、回执与账本；唯一的安装动作是 SMOKE-core-271 在 mktemp 一次性
 * prefix 中试装回滚制品，结束即删除。
 *
 * 适用性：OPENLOGOS_SMOKE_ENV 为 test（或未设置）时执行；为其他环境时四条用例写显式 skip（env-not-test），
 * 且 skip 记录不声明 target_environment（避免对其他环境的 smoke 造成环境证据不一致）。回执缺失、test 未配置
 * deploy、回执 rollback_artifact 为 null 时对应用例写显式 skip 并携带缺失项；不标 platform-unavailable。
 *
 * 覆盖入口（供 cli/test/local-install-deploy-script.test.ts 指向一次性夹具；默认指向本仓与本机）：
 * - OPENLOGOS_LOCAL_INSTALL_SMOKE_ROOT：项目根（默认 cwd）；
 * - OPENLOGOS_LOCAL_INSTALL_SMOKE_RECEIPT：回执路径（默认 <根>/logos/.openlogos-runtime/local-install/last-deploy.json）；
 * - OPENLOGOS_LOCAL_INSTALL_SMOKE_NPM：npm 可执行文件（默认 npm）；
 * - OPENLOGOS_LOCAL_INSTALL_SMOKE_CLI：查询账本用的 openlogos 入口（.js 以 node 执行；默认 PATH 中的 openlogos）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync, appendFileSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { recordSmokeNotApplicable, smokeResultPath } from './lib/smoke-not-applicable.mjs';

const IDS = ['SMOKE-core-268', 'SMOKE-core-269', 'SMOKE-core-270', 'SMOKE-core-271'];
const TARGET_ENV = 'test';
const ENVIRONMENT = 'test-local-global';
const PACKAGE_NAME = '@miniidealab/openlogos';
const SCRIPT_REL = 'scripts/deploy-local.mjs';
const ENTRY_REL = 'dist/index.js';
const DEPLOY_LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
const RUNTIME_REL = 'logos/.openlogos-runtime/local-install';

const root = resolve(process.env.OPENLOGOS_LOCAL_INSTALL_SMOKE_ROOT || process.cwd());
const receiptPath = resolve(process.env.OPENLOGOS_LOCAL_INSTALL_SMOKE_RECEIPT || join(root, RUNTIME_REL, 'last-deploy.json'));
const npm = process.env.OPENLOGOS_LOCAL_INSTALL_SMOKE_NPM || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const resultPath = smokeResultPath(root);

const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const sha256File = file => sha256(readFileSync(file));

/** 子进程环境：剥离外层部署与 smoke 注入，避免被查询的 CLI 把记录写进外层账本或读到外层目标环境。 */
function childEnv() {
  const env = { ...process.env, NO_COLOR: '1' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('OPENLOGOS_DEPLOY_') || key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV') delete env[key];
  }
  return env;
}

const run = (cmd, args, cwd = root) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf-8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: childEnv() });

/** 等价于 `command -v`：按 PATH 顺序找第一个可执行文件。 */
function resolveCommand(name) {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // 不存在或不可执行
    }
  }
  return null;
}

function cliEntry() {
  const injected = process.env.OPENLOGOS_LOCAL_INSTALL_SMOKE_CLI;
  if (injected) return injected;
  return resolveCommand('openlogos');
}

/** 调用 openlogos 并解析 JSON envelope（成功在 stdout，错误在 stderr）。 */
function cliJson(args) {
  const entry = cliEntry();
  if (!entry) return { status: null, data: null, error: { message: 'PATH 中解析不到 openlogos' } };
  const r = entry.endsWith('.js') ? run(process.execPath, [entry, ...args, '--format', 'json']) : run(entry, [...args, '--format', 'json']);
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data ?? null; } catch { /* 失败路径无 stdout envelope */ }
  try { error = JSON.parse(r.stderr).error ?? null; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, error, stderr: r.stderr };
}

function isInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 读 .tgz 中的若干文件（ustar + pax 长路径），只用 zlib。 */
function readTarball(file, wanted) {
  const data = gunzipSync(readFileSync(file));
  const found = new Map();
  let offset = 0;
  let paxPath = null;
  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) break;
    const field = (start, len) => header.subarray(start, start + len).toString('utf-8').replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const body = data.subarray(offset + 512, offset + 512 + size);
    if (type === 'x') {
      const match = /\d+ path=([^\n]*)\n/.exec(body.toString('utf-8'));
      paxPath = match ? match[1] : null;
    } else {
      if ((type === '0' || type === '' || type === '\0') && wanted.includes(name)) found.set(name, Buffer.from(body));
      paxPath = null;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return found;
}

/** 当前全局入口身份：PATH 解析的 openlogos 的 realpath 与 --version。 */
function globalIdentity() {
  const entry = resolveCommand('openlogos');
  if (!entry) return { entry: null, realpath: null, version: null };
  const r = run(entry, ['--version']);
  return { entry, realpath: realpathSync(entry), version: r.status === 0 ? r.stdout.trim() : null };
}

/** 文件或目录树的指纹（用于只读与零写入取证）。 */
function treeHash(path) {
  if (!existsSync(path)) return 'absent';
  const out = [];
  const walk = p => {
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(`D ${relative(path, p)}`);
      for (const name of readdirSync(p).sort()) walk(join(p, name));
    } else out.push(`F ${relative(path, p)} ${sha256File(p)}`);
  };
  walk(path);
  return sha256(out.join('\n'));
}

/** 一个用例的判定收集器：逐项记证据，任一项不成立即 fail 并点名。 */
function checker() {
  const evidence = [];
  const failures = [];
  return {
    evidence,
    failures,
    expect(field, actual, expected) {
      const ok = actual === expected;
      evidence.push({ field, actual, expected, ok });
      if (!ok) failures.push(`${field}：实际 ${actual}，期望 ${expected}`);
      return ok;
    },
    assert(field, ok, detail) {
      evidence.push({ field, ok, detail });
      if (!ok) failures.push(`${field}：${detail}`);
      return ok;
    },
  };
}

const results = new Map();
function pass(id, c, started) {
  results.set(id, { status: c.failures.length === 0 ? 'pass' : 'fail', evidence: c.evidence, detail: c.failures.join('；') || null, duration_ms: Date.now() - started });
}
function skip(id, reason, missing) {
  results.set(id, { status: 'skip', reason, missing });
}

function smoke268() {
  const started = Date.now();
  const c = checker();
  const check = cliJson(['env', 'check']);
  c.expect('env check 退出码', check.status, 0);
  c.assert('env check errors', Array.isArray(check.data?.errors) && check.data.errors.length === 0, JSON.stringify(check.data?.errors ?? check.error));
  const show = cliJson(['env', 'show', TARGET_ENV]);
  const deploy = show.data?.environment?.deploy;
  if (show.status === 0 && !deploy) {
    skip('SMOKE-core-268', `登记表 ${TARGET_ENV} 尚未配置 deploy（部署方案「本机测试环境脚本部署」第二节）`, ['test-deploy-config']);
    return;
  }
  c.expect('environment.deploy.mode', deploy?.mode ?? null, 'script');
  c.expect('environment.deploy.script', deploy?.script ?? null, SCRIPT_REL);

  const identityBefore = JSON.stringify(globalIdentity());
  const runtimeBefore = treeHash(join(root, RUNTIME_REL));
  const ledgerBefore = treeHash(join(root, DEPLOY_LEDGER_REL));
  const dry = cliJson(['deploy', '--env', TARGET_ENV, '--ref', 'HEAD', '--channel', 'version', '--dry-run']);
  c.expect('deploy --dry-run 退出码', dry.status, 0);
  c.expect('deploy --dry-run status', dry.data?.status ?? null, 'dry-run');
  c.assert('dry-run plan 脚本路径', JSON.stringify(dry.data?.plan ?? null).includes(SCRIPT_REL), JSON.stringify(dry.data?.plan ?? dry.error));
  c.expect('dry-run 前后全局入口与版本', JSON.stringify(globalIdentity()), identityBefore);
  c.expect('dry-run 前后运行态 local-install', treeHash(join(root, RUNTIME_REL)), runtimeBefore);
  c.expect('dry-run 前后账本', treeHash(join(root, DEPLOY_LEDGER_REL)), ledgerBefore);
  pass('SMOKE-core-268', c, started);
}

function smoke269(receipt) {
  const started = Date.now();
  const c = checker();
  c.expect('回执 result', receipt.result, 'done');
  c.expect('回执 environment', receipt.environment, TARGET_ENV);

  const show = cliJson(['env', 'show', TARGET_ENV]);
  const view = show.data ?? {};
  c.expect('env show 退出码', show.status, 0);
  c.expect('账本 last_deploy.deploy_id', view.last_deploy?.deploy_id ?? null, receipt.deploy_id);
  c.expect('账本 last_deploy.result', view.last_deploy?.result ?? null, 'done');
  c.expect('账本 last_deploy.mode', view.last_deploy?.mode ?? null, 'script');
  c.expect('账本 current_ref', view.current_ref ?? null, receipt.ref);

  const prefixRun = run(npm, ['prefix', '-g']);
  c.expect('npm prefix -g', prefixRun.status === 0 ? prefixRun.stdout.trim() : null, receipt.prefix);
  const identity = globalIdentity();
  c.expect('全局入口 realpath', identity.realpath, receipt.entry_realpath);
  c.assert('全局入口位于 prefix 之下', Boolean(identity.realpath && receipt.prefix && isInside(identity.realpath, realpathSync(receipt.prefix))),
    `${identity.realpath} / ${receipt.prefix}`);
  c.expect('全局 --version', identity.version, receipt.candidate_version);
  const pkgDir = join(receipt.prefix ?? '', 'lib', 'node_modules', ...PACKAGE_NAME.split('/'));
  let pkgVersion = null;
  try { pkgVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8')).version; } catch { /* 缺失按不一致计 */ }
  c.expect('全局 package.json 版本', pkgVersion, receipt.candidate_version);
  const entryFile = join(pkgDir, ENTRY_REL);
  c.expect(`全局 ${ENTRY_REL} SHA-256`, existsSync(entryFile) ? sha256File(entryFile) : null, receipt.candidate_entry_sha256);
  pass('SMOKE-core-269', c, started);
}

function smoke270(receipt) {
  const started = Date.now();
  const c = checker();
  const tarball = receipt.candidate_tarball?.path ?? null;
  if (c.assert('候选 tarball 存在', Boolean(tarball && existsSync(tarball)), String(tarball))) {
    c.expect('候选 tarball SHA-256', sha256File(tarball), receipt.candidate_tarball.sha256);
    let files = new Map();
    try { files = readTarball(tarball, ['package/package.json', `package/${ENTRY_REL}`]); } catch (error) {
      c.assert('候选 tarball 可解包', false, error.message);
    }
    const pkg = files.get('package/package.json');
    let version = null;
    try { version = pkg ? JSON.parse(pkg.toString('utf-8')).version : null; } catch { /* 损坏按不一致计 */ }
    c.expect('候选包版本', version, receipt.candidate_version);
    const entry = files.get(`package/${ENTRY_REL}`);
    c.expect(`候选包 ${ENTRY_REL} SHA-256`, entry ? sha256(entry) : null, receipt.candidate_entry_sha256);
  }
  pass('SMOKE-core-270', c, started);
}

function smoke271(receipt) {
  const started = Date.now();
  if (!receipt.rollback_artifact) {
    skip('SMOKE-core-271', '回执 rollback_artifact 为 null（部署前未全局安装，没有回滚制品）', ['rollback-artifact']);
    return;
  }
  const c = checker();
  const artifact = receipt.rollback_artifact.path;
  if (c.assert('回滚制品存在', existsSync(artifact), artifact)) {
    c.expect('回滚制品 SHA-256', sha256File(artifact), receipt.rollback_artifact.sha256);
    const before = JSON.stringify(globalIdentity());
    const prefix = mkdtempSync(join(tmpdir(), 'openlogos-smoke-local-install-'));
    try {
      const install = run(npm, ['install', '-g', '--prefix', prefix, artifact]);
      if (c.expect('隔离安装退出码', install.status, 0)) {
        const bin = join(prefix, 'bin', 'openlogos');
        const version = existsSync(bin) ? run(bin, ['--version']) : null;
        c.expect('隔离试装 --version', version && version.status === 0 ? version.stdout.trim() : null, receipt.previous_version);
        const entry = join(prefix, 'lib', 'node_modules', ...PACKAGE_NAME.split('/'), ENTRY_REL);
        c.expect(`隔离试装 ${ENTRY_REL} SHA-256`, existsSync(entry) ? sha256File(entry) : null, receipt.previous_entry_sha256);
      }
    } finally {
      rmSync(prefix, { recursive: true, force: true });
    }
    c.expect('试装前后全局入口与版本', JSON.stringify(globalIdentity()), before);
  }
  pass('SMOKE-core-271', c, started);
}

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
    if (row.status === 'skip') {
      recordSmokeNotApplicable([id], { reason: row.reason, missing: row.missing, environment: ENVIRONMENT, repoRoot: root });
      continue;
    }
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT, target_environment: TARGET_ENV,
      detail: row.detail, evidence: row.evidence,
    })}\n`);
  }
}

function main() {
  const target = process.env.OPENLOGOS_SMOKE_ENV;
  if (target && target !== TARGET_ENV) {
    recordSmokeNotApplicable(IDS, { reason: 'env-not-test', missing: ['OPENLOGOS_SMOKE_ENV=test'], environment: ENVIRONMENT, repoRoot: root });
    console.log(`本机测试环境安装态 smoke 不适用于环境 ${target}，已写显式 skip`);
    return 0;
  }

  try {
    smoke268();
  } catch (error) {
    results.set('SMOKE-core-268', { status: 'fail', detail: `执行异常：${error.message}`, evidence: [], duration_ms: 0 });
  }

  let receipt = null;
  if (existsSync(receiptPath)) {
    try { receipt = JSON.parse(readFileSync(receiptPath, 'utf-8')); } catch (error) {
      for (const id of IDS.slice(1)) results.set(id, { status: 'fail', detail: `回执无法解析：${error.message}`, evidence: [], duration_ms: 0 });
    }
  } else {
    for (const id of IDS.slice(1)) skip(id, `回执不存在：${receiptPath}（test 尚未经 scripts/deploy-local.mjs 部署）`, ['receipt']);
  }
  if (receipt) {
    for (const [id, fn] of [['SMOKE-core-269', smoke269], ['SMOKE-core-270', smoke270], ['SMOKE-core-271', smoke271]]) {
      try {
        fn(receipt);
      } catch (error) {
        results.set(id, { status: 'fail', detail: `执行异常：${error.message}`, evidence: [], duration_ms: 0 });
      }
    }
  }

  flush();
  let failed = false;
  for (const id of IDS) {
    const row = results.get(id);
    console.log(`${id} ${row?.status ?? 'fail'}${row?.detail ? `：${row.detail}` : row?.reason ? `：${row.reason}` : ''}`);
    if (!row || row.status === 'fail') failed = true;
  }
  return failed ? 1 : 0;
}

process.exitCode = main();
