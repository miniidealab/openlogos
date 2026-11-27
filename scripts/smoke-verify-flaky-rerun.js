#!/usr/bin/env node
/**
 * SMOKE-core-347～SMOKE-core-351：0.16.26 verify 失败用例复跑与偶发判定的**安装态**取证（提案 verify-flaky-rerun）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.26 verify 复跑安装态 smoke（SMOKE-core-347～351）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.26 本机测试环境发布（verify-flaky-rerun）」。
 *
 *   - SMOKE-core-347：安装态版本与制品身份（--version 等于成功部署回执的候选版本；回执 entry_realpath 为非空绝对路径且等于
 *     入口 realpath；包内校验器重算 asset-manifest 不抛错）。
 *   - SMOKE-core-348：首跑失败、复跑通过记为偶发（Gate PASS、flaky_cases、flaky_cases_present、runner 被调用 2 次且第 2 次
 *     收到 ["UT-S01-01"] 与 RERUN=1、result_path 含三条用例、报告含「偶发用例」小节）。
 *   - SMOKE-core-349：两次都失败照常 FAIL（failed_cases）。
 *   - SMOKE-core-350：超过上限不复跑（max_cases: 1，runner 只被调用 1 次，too_many_failures）。
 *   - SMOKE-core-351：关闭配置后不复跑（enabled: false，runner 只被调用 1 次，disabled）。
 *
 * **入口判断次序**（规格「四、自动化与证据要求」）：
 *   ① 宿主已指定 OPENLOGOS_SMOKE_ENV 且不是 test → 为全部 owned ID 写带原因的显式 skip（env-not-test），以 0 退出；
 *   ② 适用窗口：活跃变更为本提案，或 OPENLOGOS_RR_SMOKE=1；窗口外写 skip；
 *   ③ 部署前置：先读部署账本——没有本提案在 test 的成功 deploy 才写显式 skip；有记录时须与本机回执同一 deploy_id、
 *      result=done、environment=test，源码候选版本须可读且等于回执 candidate_version、entry_realpath 为非空绝对路径，否则 fail。
 * 全局 CLI 子进程在独立进程组中运行并限时 120 秒；要求解析信封的步骤以 --format json 调用并对 stdout.trim() 整体解析。
 * 「runner 被调用几次」读项目外的调用记录（OPENLOGOS_RR_LOG），不从 CLI 输出推断。全部写入只在一次性目录内，结束即删除；
 * 对全局安装态只读。环境变量一律使用 OPENLOGOS_RR_ 前缀。
 */
import { spawn, spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable, recordSmokeNotApplicable } from './lib/smoke-not-applicable.mjs';
import { assetManifestVerdict, candidateVersion, installedVersionProblem, parseEnvelope, receiptEntryProblem, writeAll } from './smoke-runner-discovery.js';

export const SLUG = 'verify-flaky-rerun';
export const OWNED = ['SMOKE-core-347', 'SMOKE-core-348', 'SMOKE-core-349', 'SMOKE-core-350', 'SMOKE-core-351'];
const ENVIRONMENT = 'local-global-temp-project';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_RR_SMOKE_CHILD_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 && v < 120_000 ? v : 120_000;
})();

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd = repoRoot) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });

function activeChange() {
  try { return JSON.parse(readFileSync(join(repoRoot, 'logos', '.openlogos-guard'), 'utf8')).activeChange || null; } catch { return null; }
}

/**
 * 部署前置：先读账本——没有本提案（slug）在 test 的成功 deploy → { missing }（显式 skip）；有记录时源码候选版本须可读，
 * 且本机回执同一 deploy_id、result=done、environment=test、candidate_version 等于源码候选版本、entry_realpath 为非空绝对路径，
 * 否则 { problem }（fail）。
 */
export function deployedCandidate(root = repoRoot, slug = SLUG, readVersion = () => candidateVersion(root)) {
  const ledgerPath = join(root, DEPLOY_LEDGER);
  const rows = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } })
    : [];
  const deploys = rows.filter(r => r.kind === 'deploy' && r.slug === slug && r.environment === DEPLOY_ENV && r.result === 'done' && r.rollback !== true);
  const last = deploys[deploys.length - 1];
  if (!last) return { missing: `部署账本 ${DEPLOY_LEDGER} 中没有本提案 ${slug} 在 ${DEPLOY_ENV} 的成功部署记录` };
  let version = null;
  try { version = readVersion(); } catch (e) { return { problem: `源码候选版本不可读：${e instanceof Error ? e.message : String(e)}` }; }
  if (!version) return { problem: `已有 ${slug} 的成功部署记录（deploy_id ${last.deploy_id}），但源码候选版本不可读` };
  const receiptPath = join(root, DEPLOY_RECEIPT);
  if (!existsSync(receiptPath)) return { problem: `本提案已有成功部署记录（deploy_id ${last.deploy_id}），但缺少部署回执 ${DEPLOY_RECEIPT}` };
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch (e) { return { problem: `部署回执无法解析：${e instanceof Error ? e.message : String(e)}` }; }
  const mismatch = [];
  if (receipt.deploy_id !== last.deploy_id) mismatch.push(`deploy_id 回执=${receipt.deploy_id} 账本=${last.deploy_id}`);
  if (receipt.result !== 'done') mismatch.push(`回执 result=${receipt.result}`);
  if (receipt.environment !== DEPLOY_ENV) mismatch.push(`回执 environment=${receipt.environment}`);
  if (receipt.candidate_version !== version) mismatch.push(`回执 candidate_version=${receipt.candidate_version}，源码候选版本=${version}`);
  if (typeof receipt.entry_realpath !== 'string' || receipt.entry_realpath === '' || !isAbsolute(receipt.entry_realpath)) {
    mismatch.push(`回执 entry_realpath 不是非空绝对路径：${JSON.stringify(receipt.entry_realpath ?? null)}`);
  }
  if (mismatch.length > 0) return { problem: `本次成功部署回执与候选不符：${mismatch.join('；')}` };
  return { receipt };
}

const scopes = [];
const tempDir = tag => { const d = realpathSync(mkdtempSync(join(tmpdir(), `openlogos-smoke-rr-${tag}-`))); scopes.push(d); return d; };
function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_RR_')) delete env[key];
    if (key.startsWith('OPENLOGOS_VERIFY_') || key === 'OPENLOGOS_STDIO_TRACE' || key.startsWith('OPENLOGOS_GUARD_')) delete env[key];
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDE_PROJECT_DIR'].includes(key)) delete env[key];
  }
  return { ...env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0', ...extra };
}
function runChild(cmd, args, { cwd, env }) {
  return new Promise(resolvePromise => {
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = r => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise({ stdout, stderr, ...r }); } };
    let child;
    try { child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (error) { finish({ status: null, signal: null, error }); return; }
    const timer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } }
      child.stdout?.destroy(); child.stderr?.destroy();
      finish({ status: null, signal: 'SIGKILL', timedOut: true });
    }, CHILD_TIMEOUT_MS);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', error => finish({ status: null, signal: null, error }));
    child.on('close', (status, signal) => finish({ status, signal }));
    child.stdin.end('');
  });
}
/** 按预期退出码与输出通道判定一次全局 CLI 调用；channel=stdout 时对 stdout 整体解析信封（命令身份为 args[0]）。 */
async function cliExpect(entry, root, args, expectExit, channel, env = {}) {
  const label = `全局 CLI ${args.join(' ')}`;
  const r = await runChild(process.execPath, [entry, ...args], { cwd: root, env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home'), ...env }) });
  if (r.timedOut) throw new Error(`${label} 超过 ${CHILD_TIMEOUT_MS / 1000} 秒未返回，已强制终止其进程组，判失败、不重试`);
  if (r.error) throw new Error(`${label} 启动失败：${r.error.message}`);
  if (r.signal) throw new Error(`${label} 被信号 ${r.signal} 终止，判失败`);
  if (expectExit !== null && r.status !== expectExit) throw new Error(`${label} 退出码 ${r.status}，预期 ${expectExit}：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  if (!channel) return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  return { status: r.status, envelope: parseEnvelope(r.stdout || '', args[0], label), stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** 夹具记录型 runner：按剧本决定第 n 次调用写 pass / fail；调用记录写到项目外 OPENLOGOS_RR_LOG；收到集合时只写集合内用例。 */
const RUNNER = `import fs from 'node:fs';
const script = JSON.parse(fs.readFileSync('tools/rr-script.json', 'utf8'));
const log = process.env.OPENLOGOS_RR_LOG;
const n = (log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0) + 1;
if (log) fs.appendFileSync(log, JSON.stringify({ call: n, eligible: process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS ?? null, rerun: process.env.OPENLOGOS_VERIFY_RERUN ?? null }) + '\\n');
const out = 'logos/resources/verify/test-results.jsonl';
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync(out, '');
let eligible = null;
try { const v = JSON.parse(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS || 'null'); if (Array.isArray(v)) eligible = new Set(v); } catch {}
const lines = [];
let anyFail = false;
for (const [id, plan] of Object.entries(script.cases)) {
  if (eligible && !eligible.has(id)) continue;
  const status = Array.isArray(plan) ? plan[Math.min(n, plan.length) - 1] : plan;
  const rec = { id, status, scenario: 'S01', timestamp: new Date().toISOString() };
  if (status === 'fail') { rec.error = 'RR ' + id + ' failed on call ' + n; anyFail = true; }
  lines.push(JSON.stringify(rec));
}
fs.writeFileSync(out, lines.join('\\n') + '\\n');
process.exit(anyFail ? 1 : 0);
`;
const table = ids => ['| 用例ID | 验证目标 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具 |`)].join('\n');

function git(root, args) {
  const r = spawnSync('git', args, {
    cwd: root, encoding: 'utf8',
    env: { ...cleanEnv(), GIT_AUTHOR_NAME: 'rr', GIT_AUTHOR_EMAIL: 'rr@example.invalid', GIT_COMMITTER_NAME: 'rr', GIT_COMMITTER_EMAIL: 'rr@example.invalid' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 200)}`);
}

/** 夹具 P：经被测 CLI init 建立的 launched 项目（单模块 core，UT-S01-01～03），verify 走记录型 runner、关闭沙箱。 */
async function fixtureP(entry, tag, cases, rerunFailed) {
  const root = tempDir(tag);
  await cliExpect(entry, root, ['init', `rr-${tag}`, '--locale', 'zh', '--ai-tool', 'claude-code'], 0, null);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: "rr-smoke"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  put(root, 'logos/resources/test/core-S01-test-cases.md', `${table(['UT-S01-01', 'UT-S01-02', 'UT-S01-03'])}\n`);
  put(root, 'tools/rr-runner.mjs', RUNNER);
  put(root, 'tools/rr-script.json', JSON.stringify({ cases }));
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = {
    ...(cfg.verify ?? {}), result_path: 'logos/resources/verify/test-results.jsonl',
    pre_run_command: 'node tools/rr-runner.mjs', sandbox_mode: 'off',
    ...(rerunFailed ? { rerun_failed: rerunFailed } : {}),
  };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  // 每次执行全局 CLI 前把夹具改动提交到本地 git（不配置远端、不联网）
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'rr fixture']);
  return { root, log: join(tempDir(`${tag}-log`), 'calls.jsonl') };
}
const readCalls = log => existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const fail = (message, evidence) => Object.assign(new Error(message), { evidence });

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

let DEPLOYED = null;

export const CASES = {
  'SMOKE-core-347': async (entry) => {
    const evidence = [`entry_realpath=${entry}`];
    const problems = [];
    const version = (await cliExpect(entry, tempDir('ver'), ['--version'], 0, null)).stdout.trim();
    evidence.push(`version=${version}`, `deploy_id=${DEPLOYED.deploy_id}`, `receipt_entry_realpath=${DEPLOYED.entry_realpath}`);
    const vp = installedVersionProblem(version, DEPLOYED);
    if (vp) problems.push(vp);
    const ep = receiptEntryProblem(DEPLOYED, entry);
    if (ep) problems.push(ep);
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    const lib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
    const verdict = assetManifestVerdict(lib.validateAssetManifest, manifest, pkg);
    evidence.push(...verdict.evidence);
    if (!verdict.ok) problems.push(verdict.problem);
    if (problems.length > 0) throw fail(problems.join('；'), evidence);
    return { detail: '安装态版本等于回执候选版本，入口与回执一致，payloadHash 与资源摘要自洽', evidence };
  },

  'SMOKE-core-348': async (entry) => {
    const { root, log } = await fixtureP(entry, 'flaky', { 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' });
    const r = await cliExpect(entry, root, ['verify', '--format', 'json'], 0, 'stdout', { OPENLOGOS_RR_LOG: log });
    const d = r.envelope.data;
    const calls = readCalls(log);
    const evidence = [`gate=${JSON.stringify(d.gate)}`, `flaky=${JSON.stringify(d.flaky_cases ?? null)}`, `rerun=${JSON.stringify(d.rerun ?? null)}`, `calls=${JSON.stringify(calls)}`];
    if (d.gate?.result !== 'PASS') throw fail(`gate=${JSON.stringify(d.gate)}，预期 PASS`, evidence);
    if (!(d.flaky_cases ?? []).some(c => c.id === 'UT-S01-01')) throw fail('flaky_cases 不含 UT-S01-01', evidence);
    if ((d.failed_cases ?? []).length !== 0) throw fail('failed_cases 不为空', evidence);
    if (!(d.warnings ?? []).some(w => w.code === 'flaky_cases_present')) throw fail('warnings 不含 flaky_cases_present', evidence);
    if (d.rerun?.attempted !== true) throw fail('rerun.attempted 不为 true', evidence);
    if (calls.length !== 2 || calls[1].eligible !== '["UT-S01-01"]' || calls[1].rerun !== '1') throw fail('runner 应被调用 2 次且第 2 次收到 ["UT-S01-01"] 与 RERUN=1', evidence);
    const rows = readFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const ids = rows.map(row => row.id).sort();
    evidence.push(`result_ids=${JSON.stringify(ids)}`);
    if (JSON.stringify(ids) !== JSON.stringify(['UT-S01-01', 'UT-S01-02', 'UT-S01-03'])) throw fail('result_path 不是三条用例', evidence);
    const report = readFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'utf8');
    if (!report.includes('## 偶发用例 / Flaky Cases') || !report.includes('UT-S01-01')) throw fail('验收报告缺少「偶发用例」小节', evidence);
    return { detail: '首跑失败、复跑通过记为偶发：Gate PASS 带 flaky_cases_present，runner 复跑一次且只收到失败用例，报告含偶发小节', evidence };
  },

  'SMOKE-core-349': async (entry) => {
    const { root, log } = await fixtureP(entry, 'real', { 'UT-S01-01': 'fail', 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' });
    const r = await cliExpect(entry, root, ['verify', '--format', 'json'], 1, 'stdout', { OPENLOGOS_RR_LOG: log });
    const d = r.envelope.data;
    const evidence = [`gate=${JSON.stringify(d.gate)}`, `failed=${JSON.stringify(d.failed_cases)}`, `calls=${readCalls(log).length}`];
    if (d.gate?.result !== 'FAIL' || d.gate?.reason !== 'failed_cases') throw fail(`gate=${JSON.stringify(d.gate)}，预期 FAIL failed_cases`, evidence);
    if (!(d.failed_cases ?? []).some(c => c.id === 'UT-S01-01')) throw fail('failed_cases 不含 UT-S01-01', evidence);
    if (d.flaky_cases !== undefined) throw fail('不应出现 flaky_cases', evidence);
    return { detail: '两次都失败照常 FAIL（failed_cases），不记偶发', evidence };
  },

  'SMOKE-core-350': async (entry) => {
    const { root, log } = await fixtureP(entry, 'cap', { 'UT-S01-01': 'fail', 'UT-S01-02': 'fail', 'UT-S01-03': 'pass' }, { max_cases: 1 });
    const r = await cliExpect(entry, root, ['verify', '--format', 'json'], 1, 'stdout', { OPENLOGOS_RR_LOG: log });
    const d = r.envelope.data;
    const calls = readCalls(log);
    const evidence = [`gate=${JSON.stringify(d.gate)}`, `rerun=${JSON.stringify(d.rerun ?? null)}`, `calls=${calls.length}`];
    if (calls.length !== 1) throw fail(`runner 被调用 ${calls.length} 次，预期 1 次`, evidence);
    if (d.gate?.reason !== 'failed_cases') throw fail(`gate=${JSON.stringify(d.gate)}，预期 FAIL failed_cases`, evidence);
    if (d.rerun?.attempted !== false || d.rerun?.skipped_reason !== 'too_many_failures') throw fail('rerun 应为 attempted=false、skipped_reason=too_many_failures', evidence);
    return { detail: '失败数超过上限时不复跑，按首跑判定', evidence };
  },

  'SMOKE-core-351': async (entry) => {
    const { root, log } = await fixtureP(entry, 'off', { 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' }, { enabled: false });
    const r = await cliExpect(entry, root, ['verify', '--format', 'json'], 1, 'stdout', { OPENLOGOS_RR_LOG: log });
    const d = r.envelope.data;
    const calls = readCalls(log);
    const evidence = [`gate=${JSON.stringify(d.gate)}`, `rerun=${JSON.stringify(d.rerun ?? null)}`, `calls=${calls.length}`];
    if (calls.length !== 1) throw fail(`runner 被调用 ${calls.length} 次，预期 1 次`, evidence);
    if (d.gate?.reason !== 'failed_cases') throw fail(`gate=${JSON.stringify(d.gate)}，预期 FAIL failed_cases`, evidence);
    if (d.rerun?.skipped_reason !== 'disabled') throw fail('rerun.skipped_reason 应为 disabled', evidence);
    return { detail: '关闭配置后不复跑，按首跑判 FAIL', evidence };
  },
};
export const VERIFY_FLAKY_RERUN_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const fd = nodeFs.openSync(resultPath, 'a');
  const timestamp = new Date().toISOString();
  try {
    for (const id of OWNED) {
      const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
      const record = { id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT };
      if (row.status !== 'skip') record.target_environment = TARGET_ENV ?? DEPLOY_ENV;
      record.detail = row.detail;
      record.evidence = row.evidence;
      writeAll(nodeFs, fd, `${JSON.stringify(record)}\n`);
    }
  } finally {
    nodeFs.closeSync(fd);
  }
}
function globalEntry() {
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-c', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}
function globalInstallProblem(entryPath) {
  const r = run(npmBin, ['prefix', '-g']);
  if (r.status !== 0 || !r.stdout.trim()) return `无法读取 npm prefix -g：${(r.stderr || '').slice(0, 200)}`;
  const prefix = realpathSync(r.stdout.trim());
  const nodeModules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  const pkgDir = join(nodeModules, '@miniidealab', 'openlogos');
  const inside = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  if (lstatSync(pkgDir).isSymbolicLink()) return `全局包目录 ${pkgDir} 是链接（workspace link 不构成安装态证据）`;
  if (!inside(realpathSync(pkgDir), entryPath)) return `入口 ${entryPath} 不在全局 npm prefix 的包目录 ${pkgDir} 内`;
  if (inside(repoRoot, entryPath)) return `入口 ${entryPath} 位于工作区 ${repoRoot} 内`;
  return null;
}

async function main() {
  // ① 目标环境优先
  if (TARGET_ENV && TARGET_ENV !== DEPLOY_ENV) {
    recordSmokeNotApplicable(OWNED, { reason: 'env-not-test', missing: [`OPENLOGOS_SMOKE_ENV=${DEPLOY_ENV}`], environment: ENVIRONMENT, repoRoot });
    console.log(`verify 复跑安装态 smoke 不适用于环境 ${TARGET_ENV}，已写显式 skip`);
    process.exit(0);
  }
  // ② 适用窗口
  if (activeChange() !== SLUG && process.env.OPENLOGOS_RR_SMOKE !== '1') {
    exitNotApplicable(OWNED, {
      reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_RR_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_RR_SMOKE'], environment: ENVIRONMENT, repoRoot,
    });
  }
  // ③ 部署前置
  const deployed = deployedCandidate(repoRoot);
  if (deployed.missing) exitNotApplicable(OWNED, { reason: deployed.missing, missing: ['deployment-record'], environment: ENVIRONMENT, repoRoot });
  let entry = null;
  try {
    if (deployed.problem) {
      for (const id of OWNED) results.set(id, { status: 'fail', detail: deployed.problem, evidence: [], duration_ms: 0 });
    } else {
      DEPLOYED = deployed.receipt;
      entry = globalEntry();
      const problem = !entry ? '找不到 openlogos 入口' : globalInstallProblem(entry);
      if (problem) {
        for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
        entry = null;
      }
    }
    if (entry) {
      for (const id of VERIFY_FLAKY_RERUN_SMOKE_IDS) {
        const started = Date.now();
        try {
          const out = await CASES[id](entry);
          results.set(id, { status: 'pass', detail: out.detail, evidence: [`entry=${entry}`, ...out.evidence], duration_ms: Date.now() - started });
        } catch (error) {
          results.set(id, { status: 'fail', detail: error instanceof Error ? error.message : String(error), evidence: [`entry=${entry}`, ...(error?.evidence ?? [])], duration_ms: Date.now() - started });
        }
      }
    }
  } finally {
    flush();
    for (const s of scopes) rmSync(s, { recursive: true, force: true });
  }
  const failed = OWNED.filter(id => results.get(id)?.status === 'fail');
  if (failed.length > 0) {
    console.error(`smoke 失败：${failed.join(', ')}`);
    for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
    process.exit(1);
  }
  console.log(`smoke 通过：${OWNED.join(', ')}`);
  process.exit(0);
}

/** 作为入口执行时才运行主流程；以模块方式导入时只暴露判定函数。 */
function invokedAsEntry() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

if (invokedAsEntry()) await main();
