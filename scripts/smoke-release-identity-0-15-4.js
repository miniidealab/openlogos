#!/usr/bin/env node
/**
 * SMOKE-core-206 — 发布身份一致性与**环境事实断言边界**的安装态取证。
 *
 * 两件事一起验（已合并 smoke 规格「OpenLogos 0.15.4 发布身份与环境事实断言边界安装态 smoke」）：
 *   ① 装对了：全局 `--version`、安装态 package.json、安装态 asset-manifest 三处版本**互相相等**——
 *      关系断言，不与任何字面量比较；候选常量 == 该版本、回滚常量 != 该版本；
 *      临时项目内 `status --format json` 的 `data.contract.version` 为固定 `1.0.0`（契约位，逐字节守死）。
 *   ② 验的方式不会随下次发布过期：步骤④自指检查本 runner 源码，判据**按位置语义**——
 *      包版本承载位不得出现 `x.y.z` 字面量，**契约版本位的固定期望值明确放行**（delta-r1 F2）。
 *      两类边界在同一条内自证：(a) 保留 contract 断言时自检仍通过；(b) 注入包版本字面量时自检失败并点名。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目内，结束即删除；本 runner **不做任何安装/卸载**，
 * 只读全局安装态；命令图中不出现 npm publish / dist-tag / git tag / gh release / git push。
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const RELEASE_IDENTITY_SMOKE_IDS = ['SMOKE-core-206'];
const ENVIRONMENT = 'local-global-temp-project';
const CONTRACT_VERSION_EXPECTED = '1.0.0';   // 契约版本位：被测性质，必须固定字面量（架构 §49.2 边界）
const SELF_PATH = fileURLToPath(import.meta.url);

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH
  || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: RELEASE_IDENTITY_SMOKE_IDS,
    environment: ENVIRONMENT,
    // 候选身份随 LOCAL_RELEASE_CANDIDATE_VERSION 移动；本 runner 不写死任何包版本字面量。
    candidate_version_source: 'cli/dist/lib/local-release-candidate.js',
    contract_version_expected: CONTRACT_VERSION_EXPECTED,
    public_release_commands: [],
  }));
  process.exit(0);
}

const results = new Map();
const record = (id, status, detail, evidence = []) => results.set(id, { status, detail, evidence });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of RELEASE_IDENTITY_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到（前序步骤已失败）', evidence: [] };
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: 0,
      environment: ENVIRONMENT, detail: row.detail, evidence: row.evidence,
    })}\n`);
  }
}

const run = (cmd, args, cwd = repoRoot) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000 });

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result.stdout;
}

const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cli = (entry, cwd, args) => checked(run(cliBin(entry), cliArgs(entry, args), cwd), `openlogos ${args.join(' ')}`);
const cliJson = (entry, cwd, args) => JSON.parse(cli(entry, cwd, [...args, '--format', 'json']));

function commandLookup() {
  const r = process.platform === 'win32'
    ? run('where', ['openlogos'])
    : run('/bin/sh', ['-lc', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

/** 从安装包内读取候选/回滚常量——运行时读取，不在本 runner 内重复钉死版本。 */
function releaseConstants(pkgRoot) {
  const path = join(pkgRoot, 'dist', 'lib', 'local-release-candidate.js');
  if (!existsSync(path)) return { candidate: null, rollback: null };
  const text = readFileSync(path, 'utf8');
  const pick = name => new RegExp(`${name}\\s*=\\s*['"]([^'"]+)['"]`).exec(text)?.[1] ?? null;
  return { candidate: pick('LOCAL_RELEASE_CANDIDATE_VERSION'), rollback: pick('LOCAL_RELEASE_ROLLBACK_VERSION') };
}

/**
 * 步骤④的自指检查：**按位置语义**扫描给定源码文本。
 *
 * - 违规：包版本承载位钉死字面量——`--version` / `package.json` / `asset-manifest` / tarball 读数
 *   被拿去与一个 `x.y.z` 字面量比较；
 * - 放行：契约版本位的固定期望值（常量名含 CONTRACT / contract 的赋值与比较）。
 * 判据不是「源码里有没有 x.y.z」，否则合法的契约断言会假红（delta-r1 F2）。
 */
export function selfCheckSource(text) {
  const semver = String.raw`\d+\.\d+\.\d+`;
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!new RegExp(semver).test(stripped)) return;
    if (/CONTRACT|contract/.test(stripped)) return;                       // 契约版本位：放行
    const pkgSlot = new RegExp(
      String.raw`(version|Version)[^\n]{0,80}['"\`]${semver}['"\`]|['"\`]${semver}['"\`][^\n]{0,80}(version|Version)`,
    );
    if (pkgSlot.test(stripped)) {
      findings.push({ line: i + 1, excerpt: stripped.trim().slice(0, 140) });
    }
  });
  return findings;
}

const entry = commandLookup();
if (!entry) {
  exitNotApplicable(RELEASE_IDENTITY_SMOKE_IDS, {
    reason: '本机未安装全局 openlogos——安装态取证不适用',
    missing: ['global:openlogos'],
    environment: ENVIRONMENT,
    repoRoot,
  });
}

const scopes = [];
try {
  const pkgRoot = packageRoot(entry);
  const cliVersion = cli(entry, repoRoot, ['--version']).trim();
  const pkgVersion = readJson(join(pkgRoot, 'package.json')).version;
  const assetVersion = existsSync(join(pkgRoot, 'asset-manifest.json'))
    ? readJson(join(pkgRoot, 'asset-manifest.json')).version
    : null;
  const { candidate, rollback } = releaseConstants(pkgRoot);
  const evidence = [`entry=${entry}`, `cli=${cliVersion}`, `pkg=${pkgVersion}`, `asset=${assetVersion}`,
    `candidate=${candidate}`, `rollback=${rollback}`];

  // ① 三处版本互相相等——关系断言，不与任何字面量比较
  if (cliVersion !== pkgVersion) throw new Error(`--version 与安装态 package.json 不一致：${cliVersion} vs ${pkgVersion}`);
  if (assetVersion === null) throw new Error('安装态缺少 asset-manifest.json，无法完成三处同源校验');
  if (assetVersion !== pkgVersion) throw new Error(`asset-manifest 与 package.json 不一致：${assetVersion} vs ${pkgVersion}`);

  // ② 候选常量 == 该版本；回滚常量 != 该版本
  if (candidate === null || rollback === null) throw new Error('安装包内缺少发布候选/回滚常量');
  if (candidate !== pkgVersion) throw new Error(`候选常量与安装版本不一致：${candidate} vs ${pkgVersion}`);
  if (rollback === pkgVersion) throw new Error('回滚常量等于候选版本——回滚预案无意义');

  // ③ 临时项目内 status 的契约版本位：固定期望值，逐字节守死
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-relid-'));
  scopes.push(base);
  cli(entry, base, ['init', 'relid', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const statusEnvelope = cliJson(entry, base, ['status']);
  const contractVersion = statusEnvelope?.data?.contract?.version;
  if (contractVersion !== CONTRACT_VERSION_EXPECTED) {
    throw new Error(`契约版本位不符：期望 ${CONTRACT_VERSION_EXPECTED}，实际 ${contractVersion}`);
  }
  // envelope 顶层 version 是包版本承载位：只做关系断言，不比字面量
  if (statusEnvelope.version !== pkgVersion) {
    throw new Error(`status envelope 版本与安装态不一致：${statusEnvelope.version} vs ${pkgVersion}`);
  }

  // ④ 自指检查 + 两类边界自证
  const selfSource = readFileSync(SELF_PATH, 'utf8');
  const selfFindings = selfCheckSource(selfSource);
  if (selfFindings.length > 0) {
    throw new Error(`本 runner 自身钉死了包版本：${selfFindings.map(f => `行 ${f.line}：${f.excerpt}`).join('；')}`);
  }
  // (a) 保留契约断言时自检通过——上一行已证；再单独确认该行确实存在于源码中
  if (!selfSource.includes('CONTRACT_VERSION_EXPECTED')) {
    throw new Error('契约版本固定期望值缺失——步骤③失去被测性质');
  }
  // (b) 注入包版本字面量 → 自检必须失败并点名
  const injected = selfSource.replace(
    'if (cliVersion !== pkgVersion)',
    `if (cliVersion !== '${pkgVersion}')`,
  );
  const injectedFindings = selfCheckSource(injected);
  if (injectedFindings.length === 0) {
    throw new Error('自检对注入的包版本字面量未报警——判据退化，等于没有自检');
  }

  record('SMOKE-core-206', 'pass',
    `三处版本同源（${pkgVersion}）、候选/回滚常量正确、契约版本位固定为 ${CONTRACT_VERSION_EXPECTED}；`
    + `自指检查通过且两类边界自证（注入包版本字面量后命中 ${injectedFindings.length} 处）`,
    evidence);
} catch (error) {
  record('SMOKE-core-206', 'fail', error instanceof Error ? error.message : String(error),
    [`entry=${entry}`]);
} finally {
  flush();
  for (const scope of scopes) rmSync(scope, { recursive: true, force: true });
}

const failed = RELEASE_IDENTITY_SMOKE_IDS.filter(id => (results.get(id)?.status ?? 'fail') !== 'pass');
if (failed.length > 0) {
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
console.log(`smoke 通过：${RELEASE_IDENTITY_SMOKE_IDS.join(', ')}`);
