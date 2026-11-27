#!/usr/bin/env node
/**
 * SMOKE-core-352～SMOKE-core-358：0.16.27 分层验收与发布级验收的**安装态**取证（提案 layered-verification）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.27 分层验收安装态 smoke（SMOKE-core-352～358）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.27 本机测试环境发布（layered-verification）」。
 *
 *   - SMOKE-core-352：安装态版本与制品身份（--version 等于成功部署回执的候选版本；回执 entry_realpath 为非空绝对路径且等于
 *     入口 realpath；包内校验器重算 asset-manifest 不抛错）。
 *   - SMOKE-core-353：未开启时范围不变，提案脚手架含「受影响场景」段。
 *   - SMOKE-core-354：开启后提案级验收只采信三层合集（入口只执行清单内的 3 条，报告含级别与验收范围）。
 *   - SMOKE-core-355：评估不可用（pending）时扩大到全量，扩大不是失败。
 *   - SMOKE-core-356：主链路超过上限在执行前 FAIL（入口未被调用）。
 *   - SMOKE-core-357：发布级验收实际执行全量并写独立报告；没有测试命令时拒绝，旧结果不能充当证据。
 *   - SMOKE-core-358：发布级结论的查询——后一次失败推翻前一次通过，提交变了即作废；工作区不干净时拒绝。
 *
 * **入口判断次序**（规格「四、自动化与证据要求」）：
 *   ① 宿主已指定 OPENLOGOS_SMOKE_ENV 且不是 test → 为全部 owned ID 写带原因的显式 skip（env-not-test），以 0 退出；
 *   ② 适用窗口：活跃变更为本提案，或 OPENLOGOS_LV_SMOKE=1；窗口外写 skip；
 *   ③ 部署前置：先读部署账本——没有本提案在 test 的成功 deploy 才写显式 skip；有记录时须与本机回执同一 deploy_id、
 *      result=done、environment=test，源码候选版本须可读且等于回执 candidate_version、entry_realpath 为非空绝对路径，否则 fail。
 * 全局 CLI 子进程在独立进程组中运行并限时 120 秒；要求解析信封的步骤以 --format json 调用并对 stdout.trim() 整体解析
 *（错误信封在 stderr 时同样整体解析）。「入口被调用几次」「实际执行了哪些用例」读项目外的调用记录（OPENLOGOS_LV_LOG），
 * 不从 CLI 输出推断。全部写入只在一次性目录内，结束即删除；对全局安装态只读；发布级验收只在一次性项目内执行，不对本仓执行。
 * 环境变量一律使用 OPENLOGOS_LV_ 前缀。
 */
import { spawn, spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable, recordSmokeNotApplicable } from './lib/smoke-not-applicable.mjs';
import { assetManifestVerdict, candidateVersion, installedVersionProblem, parseEnvelope, receiptEntryProblem, writeAll } from './smoke-runner-discovery.js';

export const SLUG = 'layered-verification';
export const OWNED = ['SMOKE-core-352', 'SMOKE-core-353', 'SMOKE-core-354', 'SMOKE-core-355', 'SMOKE-core-356', 'SMOKE-core-357', 'SMOKE-core-358'];
const ENVIRONMENT = 'local-global-temp-project';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_LV_SMOKE_CHILD_TIMEOUT_MS);
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
const tempDir = tag => { const d = realpathSync(mkdtempSync(join(tmpdir(), `openlogos-smoke-lv-${tag}-`))); scopes.push(d); return d; };
function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_LV_')) delete env[key];
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

/** 错误信封在 stderr：整体解析并核对命令身份。 */
function parseErrorEnvelope(stderr, command, label) {
  let parsed;
  try { parsed = JSON.parse(String(stderr).trim()); } catch { throw new Error(`${label} 的 stderr 无法整体解析为错误信封：${String(stderr).slice(0, 200)}`); }
  if (!parsed || parsed.command !== command || !parsed.error || typeof parsed.error.code !== 'string') throw new Error(`${label} 的 stderr 不是 ${command} 的错误信封`);
  return parsed.error;
}

/**
 * 夹具记录型入口：调用记录写到项目外 OPENLOGOS_LV_LOG（收到的清单、实际执行的用例）；启动时清空结果文件；
 * 收到清单时只执行、只上报清单内的用例，否则执行全部；剧本在项目外 OPENLOGOS_LV_SCRIPT，决定每条用例写 pass 或 fail。
 */
const RUNNER = `import fs from 'node:fs';
const ALL = ['UT-S01-01', 'UT-S01-02', 'UT-S02-01', 'UT-S02-02', 'UT-S03-01', 'UT-S03-02'];
const scriptPath = process.env.OPENLOGOS_LV_SCRIPT;
const script = scriptPath && fs.existsSync(scriptPath) ? JSON.parse(fs.readFileSync(scriptPath, 'utf8')) : {};
let eligible = null;
try { const v = JSON.parse(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS || 'null'); if (Array.isArray(v)) eligible = v; } catch {}
const executed = eligible ? ALL.filter(id => eligible.includes(id)) : ALL;
const log = process.env.OPENLOGOS_LV_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ eligible, slice_scope: process.env.OPENLOGOS_VERIFY_SLICE_SCOPE ?? null, executed }) + '\\n');
const out = 'logos/resources/verify/test-results.jsonl';
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync(out, '');
let anyFail = false;
const lines = executed.map(id => {
  const status = (script.cases || {})[id] || 'pass';
  const rec = { id, status, scenario: id.split('-')[1], timestamp: new Date().toISOString() };
  if (status === 'fail') { rec.error = 'LV ' + id + ' failed'; anyFail = true; }
  return JSON.stringify(rec);
});
fs.writeFileSync(out, lines.join('\\n') + '\\n');
process.exit(anyFail ? 1 : 0);
`;
const ALL_IDS = ['UT-S01-01', 'UT-S01-02', 'UT-S02-01', 'UT-S02-02', 'UT-S03-01', 'UT-S03-02'];
const table = ids => ['| 用例ID | 验证目标 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具 |`)].join('\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function git(root, args) {
  const r = spawnSync('git', args, {
    cwd: root, encoding: 'utf8',
    env: { ...cleanEnv(), GIT_AUTHOR_NAME: 'lv', GIT_AUTHOR_EMAIL: 'lv@example.invalid', GIT_COMMITTER_NAME: 'lv', GIT_COMMITTER_EMAIL: 'lv@example.invalid' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 200)}`);
  return (r.stdout || '').trim();
}

/**
 * 夹具 P：经被测 CLI init 建立的 launched 项目（单模块 core；core-S01、core-S02 各两条，core-S03 两条且主链路小节列 mainPath），
 * verify 走记录型入口、关闭沙箱；全部内容提交到本地 git（不配置远端、不联网）。
 * opts：layered（verify.layered 的取值，缺省不写）、mainPath（主链路小节所列用例）、command（false 时不配置预跑命令）。
 */
async function fixtureP(entry, tag, opts = {}) {
  const root = tempDir(tag);
  await cliExpect(entry, root, ['init', `lv-${tag}`, '--locale', 'zh', '--ai-tool', 'claude-code'], 0, null);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: "lv-smoke"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  put(root, 'logos/resources/test/core-S01-test-cases.md', `${table(['UT-S01-01', 'UT-S01-02'])}\n`);
  put(root, 'logos/resources/test/core-S02-test-cases.md', `${table(['UT-S02-01', 'UT-S02-02'])}\n`);
  const mainPath = opts.mainPath ?? ['UT-S03-01'];
  put(root, 'logos/resources/test/core-S03-test-cases.md', `${table(['UT-S03-01', 'UT-S03-02'])}\n\n## 主链路用例\n\n${mainPath.map(id => `- ${id}`).join('\n')}\n`);
  put(root, 'tools/lv-runner.mjs', RUNNER);
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = {
    ...(cfg.verify ?? {}), result_path: 'logos/resources/verify/test-results.jsonl', sandbox_mode: 'off',
    ...(opts.layered ? { layered: opts.layered } : {}),
  };
  if (opts.command === false) delete cfg.verify.pre_run_command;
  else cfg.verify.pre_run_command = 'node tools/lv-runner.mjs';
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'lv fixture']);
  const outside = tempDir(`${tag}-out`);
  const fx = { root, log: join(outside, 'calls.jsonl'), script: join(outside, 'script.json') };
  writeFileSync(fx.script, JSON.stringify({ cases: {} }));
  return fx;
}
const fxEnv = fx => ({ OPENLOGOS_LV_LOG: fx.log, OPENLOGOS_LV_SCRIPT: fx.script });
const readCalls = log => existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const fail = (message, evidence) => Object.assign(new Error(message), { evidence });

/** 经全局 CLI 建立活跃提案并按给定取值填写「受影响场景」段；返回 proposal.md 的脚手架原文。 */
async function addProposal(entry, fx, { assessment, scenarios }) {
  await cliExpect(entry, fx.root, ['change', 'lv-smoke'], 0, null);
  const path = join(fx.root, 'logos/changes/lv-smoke/proposal.md');
  const scaffold = readFileSync(path, 'utf8');
  setDeclaration(fx, { assessment, scenarios }, scaffold);
  return scaffold;
}
function setDeclaration(fx, { assessment, scenarios }, base) {
  const path = join(fx.root, 'logos/changes/lv-smoke/proposal.md');
  const content = base ?? readFileSync(path, 'utf8');
  const items = scenarios.length === 0 ? ' []' : `\n${scenarios.map(id => `  - id: ${id}\n    reason: 夹具声明 ${id} 受波及`).join('\n')}`;
  const yaml = `schema: openlogos/affected-scenarios@1\nassessment: ${assessment}\nshared_change: false\nscenarios:${items}\n`;
  const next = content.replace(/(## 受影响场景\s*\n+```yaml\n)[\s\S]*?(```)/, (_m, open, close) => `${open}${yaml}${close}`);
  if (next === content && !content.includes(yaml)) throw new Error('proposal.md 中找不到可改写的「受影响场景」段');
  writeFileSync(path, next);
}

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

let DEPLOYED = null;
const PLATFORM = `${process.platform}-${process.arch}`;
const RELEASE_REPORT = 'logos/resources/verify/release/acceptance-report.md';

export const CASES = {
  'SMOKE-core-352': async (entry) => {
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

  'SMOKE-core-353': async (entry) => {
    const fx = await fixtureP(entry, 'off');
    const scaffold = await addProposal(entry, fx, { assessment: 'assessed', scenarios: ['S02'] });
    const r = await cliExpect(entry, fx.root, ['verify', '--format', 'json'], 0, 'stdout', fxEnv(fx));
    const d = r.envelope.data;
    const calls = readCalls(fx.log);
    const evidence = [`level=${d.level}`, `has_layers=${d.layers !== undefined}`, `gate=${JSON.stringify(d.gate)}`, `calls=${JSON.stringify(calls)}`];
    if (!scaffold.includes('## 受影响场景') || !scaffold.includes('schema: openlogos/affected-scenarios@1')) throw fail('提案脚手架缺少「受影响场景」段', evidence);
    if (d.level !== 'proposal') throw fail(`level=${d.level}，预期 proposal`, evidence);
    if (d.layers !== undefined) throw fail('未开启分层时不应输出 layers', evidence);
    if (calls.length !== 1 || calls[0].eligible !== null || !same(calls[0].executed, ALL_IDS)) throw fail('入口应被调用 1 次、未收到清单并执行全部 6 条用例', evidence);
    if (d.gate?.result !== 'PASS') throw fail(`gate=${JSON.stringify(d.gate)}，预期 PASS`, evidence);
    return { detail: '未开启分层：脚手架含「受影响场景」段，verify 执行全部 6 条用例，level=proposal 且没有 layers', evidence };
  },

  'SMOKE-core-354': async (entry) => {
    const fx = await fixtureP(entry, 'on', { layered: { enabled: true } });
    await addProposal(entry, fx, { assessment: 'assessed', scenarios: ['S02'] });
    const expected = ['UT-S02-01', 'UT-S02-02', 'UT-S03-01'];
    const r = await cliExpect(entry, fx.root, ['verify', '--format', 'json'], 0, 'stdout', fxEnv(fx));
    const d = r.envelope.data;
    const calls = readCalls(fx.log);
    const evidence = [`gate=${JSON.stringify(d.gate)}`, `layers.total=${JSON.stringify(d.layers?.total ?? null)}`, `expansion=${JSON.stringify(d.layers?.expansion ?? null)}`, `calls=${JSON.stringify(calls)}`, `uncovered=${JSON.stringify(d.uncovered_cases)}`];
    if (d.gate?.result !== 'PASS') throw fail(`gate=${JSON.stringify(d.gate)}，预期 PASS`, evidence);
    if (d.layers?.expansion?.level !== 'none') throw fail('layers.expansion.level 应为 none', evidence);
    if (!same(d.layers?.total?.ids, expected)) throw fail('layers.total.ids 应为 S02 的两条加 UT-S03-01', evidence);
    if (calls.length !== 1 || !same(calls[0].eligible, expected) || !same(calls[0].executed, expected)) throw fail('入口应只收到并执行清单内的 3 条用例', evidence);
    if ((d.uncovered_cases ?? []).length !== 0) throw fail('集合外用例不应计未覆盖', evidence);
    const report = readFileSync(join(fx.root, 'logos/resources/verify/acceptance-report.md'), 'utf8');
    if (!report.includes('提案级（分层）') || !report.includes('## 验收范围 / Verification Scope')) throw fail('验收报告缺少级别行或验收范围小节', evidence);
    return { detail: '开启分层：提案级验收只执行并采信三层合集的 3 条用例，报告含级别与验收范围', evidence };
  },

  'SMOKE-core-355': async (entry) => {
    const fx = await fixtureP(entry, 'expand', { layered: { enabled: true } });
    await addProposal(entry, fx, { assessment: 'assessed', scenarios: ['S02'] });
    setDeclaration(fx, { assessment: 'pending', scenarios: [] });
    const r = await cliExpect(entry, fx.root, ['verify', '--format', 'json'], 0, 'stdout', fxEnv(fx));
    const d = r.envelope.data;
    const calls = readCalls(fx.log);
    const codes = (d.layers?.expansion?.reasons ?? []).map(x => x.code);
    const evidence = [`gate=${JSON.stringify(d.gate)}`, `expansion=${JSON.stringify(d.layers?.expansion ?? null)}`, `calls=${JSON.stringify(calls)}`];
    if (d.layers?.expansion?.level !== 'full') throw fail('layers.expansion.level 应为 full', evidence);
    if (!codes.includes('declaration_invalid')) throw fail('扩大原因应含 declaration_invalid', evidence);
    if (calls.length !== 1 || !same(calls[0].executed, ALL_IDS)) throw fail('入口应执行全部 6 条用例', evidence);
    if (d.gate?.result !== 'PASS') throw fail(`gate=${JSON.stringify(d.gate)}，预期 PASS（扩大不是失败）`, evidence);
    return { detail: '声明未填写时扩大到全量并执行全部用例，门禁 PASS', evidence };
  },

  'SMOKE-core-356': async (entry) => {
    const fx = await fixtureP(entry, 'limit', { layered: { enabled: true, main_path_max: 1 }, mainPath: ['UT-S03-01', 'UT-S03-02'] });
    const r = await cliExpect(entry, fx.root, ['verify', '--format', 'json'], 1, 'stdout', fxEnv(fx));
    const d = r.envelope.data;
    const calls = readCalls(fx.log);
    const evidence = [`gate=${JSON.stringify(d.gate)}`, `main_path=${JSON.stringify(d.layers?.main_path ?? null)}`, `calls=${calls.length}`];
    if (d.gate?.reason !== 'main_path_over_limit') throw fail(`gate=${JSON.stringify(d.gate)}，预期 main_path_over_limit`, evidence);
    if (d.layers?.main_path?.limit !== 1 || d.layers?.main_path?.count !== 2) throw fail('layers.main_path 应给出 limit=1、count=2', evidence);
    if (calls.length !== 0) throw fail(`入口被调用 ${calls.length} 次，预期 0 次`, evidence);
    return { detail: '主链路超过上限在执行前 FAIL，入口未被调用', evidence };
  },

  'SMOKE-core-357': async (entry) => {
    const fx = await fixtureP(entry, 'release', { layered: { enabled: true } });
    const head = git(fx.root, ['rev-parse', 'HEAD']);
    const r = await cliExpect(entry, fx.root, ['verify', '--release', '--format', 'json'], 0, 'stdout', fxEnv(fx));
    const d = r.envelope.data;
    const calls = readCalls(fx.log);
    const evidence = [`level=${d.level}`, `release=${JSON.stringify(d.release ?? null)}`, `head=${head}`, `calls=${JSON.stringify(calls)}`];
    if (d.level !== 'release') throw fail(`level=${d.level}，预期 release`, evidence);
    if (d.release?.commit !== head) throw fail('data.release.commit 不等于运行前的 HEAD', evidence);
    if (calls.length !== 1 || calls[0].eligible !== null || !same(calls[0].executed, ALL_IDS)) throw fail('入口应未收到清单并执行全部 6 条用例', evidence);
    const report = readFileSync(join(fx.root, RELEASE_REPORT), 'utf8');
    if (!report.includes('发布级（全量）') || !report.includes(head) || !report.includes(PLATFORM)) throw fail('发布级报告缺少级别、提交号或平台', evidence);
    // 最新一条验收历史：直接读中央索引（文件名以时间开头，字典序最大者最新）
    const historyDir = join(fx.root, 'logos/resources/verify/history');
    const files = existsSync(historyDir) ? nodeFs.readdirSync(historyDir).filter(n => n.endsWith('.json')).sort() : [];
    const latest = files.length > 0 ? JSON.parse(readFileSync(join(historyDir, files[files.length - 1]), 'utf8')) : null;
    evidence.push(`history=${JSON.stringify({ level: latest?.level, head: latest?.commit?.head })}`);
    if (latest?.level !== 'release' || latest?.commit?.head !== head) throw fail('最新验收历史应为 level=release 且提交号为运行前的 HEAD', evidence);
    // ③ 新项目没有测试命令、预置全绿结果：拒绝
    const bare = await fixtureP(entry, 'nocmd', { command: false });
    put(bare.root, 'logos/resources/verify/test-results.jsonl', `${ALL_IDS.map(id => JSON.stringify({ id, status: 'pass' })).join('\n')}\n`);
    const refused = await cliExpect(entry, bare.root, ['verify', '--release', '--format', 'json'], 2, null, fxEnv(bare));
    const error = parseErrorEnvelope(refused.stderr, 'verify', '全局 CLI verify --release（无测试命令）');
    evidence.push(`no_command_error=${error.code}`, `no_command_calls=${readCalls(bare.log).length}`);
    if (error.code !== 'RELEASE_VERIFY_NO_COMMAND') throw fail(`错误码 ${error.code}，预期 RELEASE_VERIFY_NO_COMMAND`, evidence);
    if (readCalls(bare.log).length !== 0) throw fail('没有测试命令时入口不应被调用', evidence);
    return { detail: '发布级验收执行全部用例并写独立报告与历史（提交号绑定）；没有测试命令时拒绝，旧结果不充当证据', evidence };
  },

  'SMOKE-core-358': async (entry) => {
    const fx = await fixtureP(entry, 'check', { layered: { enabled: true } });
    const evidence = [];
    await cliExpect(entry, fx.root, ['verify', '--release', '--format', 'json'], 0, 'stdout', fxEnv(fx));
    const first = (await cliExpect(entry, fx.root, ['verify', '--release', '--check', '--format', 'json'], 0, 'stdout')).envelope.data;
    evidence.push(`check1=${JSON.stringify({ valid: first.valid, reason: first.reason })}`);
    if (first.valid !== true) throw fail('发布级 PASS 之后查询应为 valid=true', evidence);
    // ② 剧本在项目外：改为一条用例 fail，不改变提交
    writeFileSync(fx.script, JSON.stringify({ cases: { 'UT-S02-01': 'fail' } }));
    await cliExpect(entry, fx.root, ['verify', '--release'], 1, null, fxEnv(fx));
    const second = (await cliExpect(entry, fx.root, ['verify', '--release', '--check', '--format', 'json'], 1, 'stdout')).envelope.data;
    evidence.push(`check2=${JSON.stringify({ valid: second.valid, reason: second.reason })}`);
    if (second.valid !== false || second.reason !== 'latest_failed') throw fail('后一次失败应推翻前一次通过（latest_failed）', evidence);
    // ③ 新建一个空提交
    git(fx.root, ['commit', '-q', '--allow-empty', '-m', 'next']);
    const third = (await cliExpect(entry, fx.root, ['verify', '--release', '--check', '--format', 'json'], 1, 'stdout')).envelope.data;
    evidence.push(`check3=${JSON.stringify({ valid: third.valid, reason: third.reason })}`);
    if (third.valid !== false || third.reason !== 'other_commit_only') throw fail('提交变了应作废（other_commit_only）', evidence);
    // ④ 留下一个未提交的源码改动
    const before = readCalls(fx.log).length;
    put(fx.root, 'tools/lv-runner.mjs', `${RUNNER}\n// uncommitted change\n`);
    const dirty = await cliExpect(entry, fx.root, ['verify', '--release', '--format', 'json'], 2, null, fxEnv(fx));
    const error = parseErrorEnvelope(dirty.stderr, 'verify', '全局 CLI verify --release（工作区不干净）');
    evidence.push(`dirty_error=${error.code}`, `calls_before=${before}`, `calls_after=${readCalls(fx.log).length}`);
    if (error.code !== 'RELEASE_VERIFY_DIRTY') throw fail(`错误码 ${error.code}，预期 RELEASE_VERIFY_DIRTY`, evidence);
    if (readCalls(fx.log).length !== before) throw fail('工作区不干净时入口不应被调用', evidence);
    return { detail: '查询以最近一次结论为准；提交变了即作废；工作区不干净时发布级验收拒绝执行', evidence };
  },
};
export const LAYERED_VERIFICATION_SMOKE_IDS = Object.keys(CASES);

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
    console.log(`分层验收安装态 smoke 不适用于环境 ${TARGET_ENV}，已写显式 skip`);
    process.exit(0);
  }
  // ② 适用窗口
  if (activeChange() !== SLUG && process.env.OPENLOGOS_LV_SMOKE !== '1') {
    exitNotApplicable(OWNED, {
      reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_LV_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_LV_SMOKE'], environment: ENVIRONMENT, repoRoot,
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
      for (const id of LAYERED_VERIFICATION_SMOKE_IDS) {
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
