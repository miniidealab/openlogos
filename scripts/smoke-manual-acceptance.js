#!/usr/bin/env node
/**
 * SMOKE-core-342～SMOKE-core-346：0.16.25 冒烟阶段人工验收的**安装态**取证（提案 smoke-manual-acceptance）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.25 冒烟阶段人工验收安装态 smoke（SMOKE-core-342～346）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.25 本机测试环境发布（smoke-manual-acceptance）」。
 *
 *   - SMOKE-core-342：安装态版本与制品身份。
 *   - SMOKE-core-343：人工标记读取与关闭环境只列出；结果文件出现人工 SMOKE 报 manual_smoke_result_id；全人工项目空自动阶段。
 *   - SMOKE-core-344：开启环境：等待 → accept 记录 → 重跑通过。
 *   - SMOKE-core-345：首次通过后更正普通用例（expired_pass）、人工用例失败、部署已更换时 accept 零写入。
 *   - SMOKE-core-346：不部署提案的人工用例被累积到下一次部署的待验收清单。
 *
 * **入口判断次序**：① OPENLOGOS_SMOKE_ENV 已指定且不是 test → 全部 owned ID 写显式 skip（env-not-test）并以 0 退出；
 * ② 适用窗口：活跃变更为本提案或 OPENLOGOS_MA_SMOKE=1，窗口外写 skip；③ 部署前置：先读部署账本，没有本提案在 test 的成功
 * deploy 写显式 skip；有记录时须与本机回执同一 deploy_id、result=done、candidate_version 等于源码候选版本，否则 fail。
 * 每条用例在各自的一次性项目 P 中执行；P 内版本通道部署一律 `deploy --env <E> --ref HEAD --format json`，并断言
 * 退出码 0、data.status === "done"、data.deploy_id 非空。accept 由本 runner 以子进程直接调用（不经 AI 宿主）。
 * 全局 CLI 子进程在独立进程组中运行并限时 120 秒；要求信封的步骤以 --format json 调用并对 stdout.trim() 整体解析。
 */
import { spawn, spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable, recordSmokeNotApplicable } from './lib/smoke-not-applicable.mjs';
import { assetManifestVerdict, candidateVersion, installedVersionProblem, parseEnvelope, receiptEntryProblem, writeAll } from './smoke-runner-discovery.js';

export const SLUG = 'smoke-manual-acceptance';
export const OWNED = ['SMOKE-core-342', 'SMOKE-core-343', 'SMOKE-core-344', 'SMOKE-core-345', 'SMOKE-core-346'];
const ENVIRONMENT = 'local-global-temp-project';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_MA_SMOKE_CHILD_TIMEOUT_MS);
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

/** 部署前置（与上一版安装态 runner 同一判据）：缺记录 → { missing }；回执不符 → { problem }；否则 { receipt }。 */
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
const tempDir = tag => { const d = realpathSync(mkdtempSync(join(tmpdir(), `openlogos-smoke-ma-${tag}-`))); scopes.push(d); return d; };
function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_MA_')) delete env[key];
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
/** 按预期退出码与输出通道判定一次全局 CLI 调用；channel=stdout/stderr 时整体解析该通道的信封。 */
async function cliExpect(entry, root, args, expectExit, channel, env = {}) {
  const label = `全局 CLI ${args.join(' ')}`;
  const r = await runChild(process.execPath, [entry, ...args], { cwd: root, env: cleanEnv(env) });
  if (r.timedOut) throw new Error(`${label} 超过 ${CHILD_TIMEOUT_MS / 1000} 秒未返回，已强制终止其进程组，判失败、不重试`);
  if (r.error) throw new Error(`${label} 启动失败：${r.error.message}`);
  if (r.signal) throw new Error(`${label} 被信号 ${r.signal} 终止，判失败`);
  if (expectExit !== null && r.status !== expectExit) throw new Error(`${label} 退出码 ${r.status}，预期 ${expectExit}：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  if (!channel) return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  const text = channel === 'stderr' ? (r.stderr || '') : (r.stdout || '');
  if (channel === 'stderr') {
    // 错误信封（stderr）：整体解析，须为同一命令的 {command, error:{code}} 信封
    let envelope = null;
    try { envelope = JSON.parse(text.trim()); } catch { /* 不是完整 JSON */ }
    if (!envelope || envelope.command !== args[0] || typeof envelope.error?.code !== 'string') {
      throw new Error(`${label} 的 stderr 不是完整的 ${args[0]} 错误信封：${text.slice(0, 200)}`);
    }
    return { status: r.status, envelope, stdout: r.stdout || '', stderr: r.stderr || '' };
  }
  // 子命令信封身份：env show / env list 等两段式命令为「命令 子命令」
  const command = args[0] === 'env' && args[1] ? `${args[0]} ${args[1]}` : args[0];
  return { status: r.status, envelope: parseEnvelope(text, command, label), stdout: r.stdout || '', stderr: r.stderr || '' };
}
const fail = (message, evidence) => Object.assign(new Error(message), { evidence });

function git(root, args) {
  const r = run('git', args, root);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 200)}`);
  return (r.stdout || '').trim();
}
function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message, '--allow-empty']);
  return git(root, ['rev-parse', 'HEAD']);
}
function ledgerRows(root) {
  const p = join(root, DEPLOY_LEDGER);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }) : [];
}
const lastSmokeRow = root => ledgerRows(root).filter(r => r.kind === 'smoke').pop() ?? null;

const ST05 = '| ST-S01-05 [manual] | 人工观察终端渲染 | 真实终端 | 打开交互提示 | 颜色正确 |';
const ST08 = '| ST-S01-08 [manual] | 人工确认首启 | 实机 | 安装 | 首启正常 |';
const RUNNER = `const fs = require('fs'); const path = require('path');
const out = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
const env = process.env.OPENLOGOS_SMOKE_ENV || null;
const ids = ['SMOKE-core-01'];
if (fs.existsSync('tools/write-manual')) ids.push('SMOKE-core-901');
fs.writeFileSync(out, ids.map(id => JSON.stringify({ id, status: 'pass', timestamp: new Date().toISOString(), ...(env ? { target_environment: env } : {}) })).join('\\n') + '\\n');
`;

/**
 * 一次性项目 P：经被测 CLI init 后改为 launched；登记表 ma-test（未开启）与 ma-prod（开启人工验收），二者都以 script 方式
 * 部署到被 git 跟踪的 deploy/noop.sh；测试规格含 ST-S01-05 [manual]，smoke 规格含 SMOKE-core-01 与 SMOKE-core-901 [manual]。
 */
async function manualProject(entry, tag, { manualOnly = false } = {}) {
  const root = tempDir(tag);
  await cliExpect(entry, root, ['init', `ma-${tag}`, '--locale', 'zh', '--ai-tool', 'claude-code'], 0, null);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'ma-smoke']);
  git(root, ['config', 'user.email', 'ma-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: "ma-smoke"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nresource_index: []\n');
  put(root, 'logos/environments.yaml', [
    'schema_version: 1', 'environments:',
    '  - id: ma-test', '    name: MA Test', '    tier: test', '    deploy: {mode: script, script: deploy/noop.sh}',
    '  - id: ma-prod', '    name: MA Prod', '    tier: prod', '    deploy: {mode: script, script: deploy/noop.sh}', '    manual_acceptance: {enabled: true}', '',
  ].join('\n'));
  put(root, 'deploy/noop.sh', '#!/bin/sh\nexit 0\n');
  chmodSync(join(root, 'deploy/noop.sh'), 0o755);
  if (manualOnly) {
    put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 [manual] | 实机确认 |\n');
  } else {
    put(root, 'logos/resources/test/core-S01-test-cases.md', `# core-S01\n\n| ID | 描述 | 前置 | 操作 | 预期 |\n|---|---|---|---|---|\n${ST05}\n`);
    put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | 自动 |\n| SMOKE-core-901 [manual] | 实机安装后确认首启界面 |\n');
    put(root, 'tools/runner.cjs', RUNNER);
  }
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.smoke = { result_path: 'logos/resources/verify/smoke-results.jsonl', sandbox_mode: 'off', ...(manualOnly ? {} : { command: 'node tools/runner.cjs' }) };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n.codex-home/\n');
  commit(root, 'fixture');
  return root;
}

/** 版本通道部署：--ref HEAD，断言退出码 0、data.status === "done"、data.deploy_id 非空，返回 deploy_id。 */
async function deploy(entry, root, env, evidence) {
  const r = await cliExpect(entry, root, ['deploy', '--env', env, '--ref', 'HEAD', '--format', 'json'], 0, 'stdout');
  const data = r.envelope.data ?? {};
  if (data.status !== 'done' || typeof data.deploy_id !== 'string' || data.deploy_id === '') {
    throw fail(`deploy --env ${env} --ref HEAD 未返回 data.status=done 与非空 deploy_id：${JSON.stringify({ status: data.status, deploy_id: data.deploy_id })}`, evidence);
  }
  evidence.push(`deploy ${env} → ${data.deploy_id}`);
  return data.deploy_id;
}

/** SMOKE-core-344 的 ①～④：ma-prod 部署 → smoke PENDING → accept 全部通过 → 重跑 PASS。返回 { deployId, passCommit }。 */
async function replayPass(entry, root, evidence) {
  const passCommit = git(root, ['rev-parse', 'HEAD']);
  const d = await deploy(entry, root, 'ma-prod', evidence);
  const show = await cliExpect(entry, root, ['env', 'show', 'ma-prod', '--format', 'json'], 0, 'stdout');
  const shownDeploy = show.envelope.data?.last_deploy?.deploy_id;
  if (shownDeploy !== d) throw fail(`env show 的 last_deploy.deploy_id=${shownDeploy} 与 deploy 返回的 ${d} 不一致`, evidence);
  const s1 = await cliExpect(entry, root, ['smoke', '--env', 'ma-prod', '--format', 'json'], 1, 'stdout');
  const g1 = s1.envelope.data.gate;
  evidence.push(`smoke① gate=${JSON.stringify(g1)}`);
  if (g1?.result !== 'PENDING' || g1?.reason !== 'manual_acceptance_pending') throw fail(`② 预期 PENDING / manual_acceptance_pending：${JSON.stringify(g1)}`, evidence);
  const pending = s1.envelope.data.manual_acceptance?.pending ?? [];
  if (JSON.stringify(pending) !== JSON.stringify(['SMOKE-core-901', 'ST-S01-05'])) throw fail(`② pending 预期两条人工用例：${JSON.stringify(pending)}`, evidence);
  if (lastSmokeRow(root)?.result !== 'pending') throw fail('② 账本最近 smoke 行不是 result=pending', evidence);
  const a = await cliExpect(entry, root, ['accept', '--env', 'ma-prod', '--deploy', d, '--case', 'ST-S01-05,SMOKE-core-901', '--result', 'pass', '--format', 'json'], 0, 'stdout');
  if ((a.envelope.data.remaining ?? []).length !== 0) throw fail(`③ accept 后 remaining 应为空：${JSON.stringify(a.envelope.data.remaining)}`, evidence);
  const s2 = await cliExpect(entry, root, ['smoke', '--env', 'ma-prod', '--format', 'json'], 0, 'stdout');
  evidence.push(`smoke② gate=${JSON.stringify(s2.envelope.data.gate)}`);
  if (s2.envelope.data.gate?.result !== 'PASS') throw fail(`④ 重跑预期 PASS：${JSON.stringify(s2.envelope.data.gate)}`, evidence);
  if (lastSmokeRow(root)?.manual_passed !== true) throw fail('④ 账本最近 smoke 行缺 manual_passed=true', evidence);
  return { deployId: d, passCommit };
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

export const CASES = {
  'SMOKE-core-342': async (entry) => {
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

  'SMOKE-core-343': async (entry) => {
    const evidence = [];
    const root = await manualProject(entry, 'closed');
    await deploy(entry, root, 'ma-test', evidence);
    const s1 = await cliExpect(entry, root, ['smoke', '--env', 'ma-test', '--format', 'json'], 0, 'stdout');
    const d1 = s1.envelope.data;
    evidence.push(`arm1 gate=${JSON.stringify(d1.gate)} defined=${d1.summary?.defined_count} unexecuted=${JSON.stringify(d1.manual_acceptance?.unexecuted)}`);
    if (d1.gate?.result !== 'PASS') throw fail(`① 关闭环境预期 PASS：${JSON.stringify(d1.gate)}`, evidence);
    if (d1.summary?.defined_count !== 1) throw fail(`① defined_count 应只含自动用例（1），实为 ${d1.summary?.defined_count}`, evidence);
    const unexecuted = d1.manual_acceptance?.unexecuted ?? [];
    if (!unexecuted.includes('ST-S01-05') || !unexecuted.includes('SMOKE-core-901')) throw fail(`① unexecuted 应含 ST-S01-05 与 SMOKE-core-901：${JSON.stringify(unexecuted)}`, evidence);
    if (ledgerRows(root).some(r => r.kind === 'smoke' && r.result === 'pending')) throw fail('① 关闭环境不应写 pending 行', evidence);
    put(root, 'tools/write-manual', '1');
    const s2 = await cliExpect(entry, root, ['smoke', '--env', 'ma-test', '--format', 'json'], 1, 'stdout');
    const diag = (s2.envelope.data.diagnostics ?? []).map(x => x.code);
    evidence.push(`arm2 gate=${JSON.stringify(s2.envelope.data.gate)} diagnostics=${JSON.stringify(diag)}`);
    if (!diag.includes('manual_smoke_result_id')) throw fail('② runner 写入人工 SMOKE 结果时应报 manual_smoke_result_id', evidence);
    const only = await manualProject(entry, 'only', { manualOnly: true });
    await deploy(entry, only, 'ma-test', evidence);
    const s3 = await cliExpect(entry, only, ['smoke', '--env', 'ma-test', '--format', 'json'], 0, 'stdout');
    evidence.push(`arm3 gate=${JSON.stringify(s3.envelope.data.gate)}`);
    if (s3.envelope.data.gate?.result !== 'PASS') throw fail(`③ 全人工项目预期 PASS（不报 NO_SMOKE_RESULTS / NO_SMOKE_CASES）：${JSON.stringify(s3.envelope.data.gate)}`, evidence);
    return { detail: '人工 SMOKE 不进自动集合、关闭环境只列出；人工结果被拦下；全人工项目空自动阶段', evidence };
  },

  'SMOKE-core-344': async (entry) => {
    const evidence = [];
    const root = await manualProject(entry, 'pass');
    await replayPass(entry, root, evidence);
    const show = await cliExpect(entry, root, ['env', 'show', 'ma-prod', '--format', 'json'], 0, 'stdout');
    const waiting = show.envelope.data?.manual_acceptance?.waiting;
    evidence.push(`waiting=${JSON.stringify(waiting)}`);
    if (waiting !== null) throw fail(`⑤ env show 的 manual_acceptance.waiting 应为 null：${JSON.stringify(waiting)}`, evidence);
    return { detail: '开启环境：等待 → 记录 → 重跑通过，等待状态清除', evidence };
  },

  'SMOKE-core-345': async (entry) => {
    const evidence = [];
    const root = await manualProject(entry, 'correct');
    const { deployId } = await replayPass(entry, root, evidence);
    const a = await cliExpect(entry, root, ['accept', '--env', 'ma-prod', '--deploy', deployId, '--case', 'SMOKE-core-901', '--result', 'fail', '--note', '白屏', '--format', 'json'], 0, 'stdout');
    evidence.push(`expired_pass=${a.envelope.data.expired_pass}`);
    if (a.envelope.data.expired_pass !== true) throw fail('② 首次通过后更正普通用例应 expired_pass=true', evidence);
    const s = await cliExpect(entry, root, ['smoke', '--env', 'ma-prod', '--format', 'json'], 1, 'stdout');
    const failed = s.envelope.data.manual_acceptance?.failed ?? [];
    evidence.push(`gate=${JSON.stringify(s.envelope.data.gate)} failed=${JSON.stringify(failed)}`);
    if (s.envelope.data.gate?.reason !== 'manual_cases_failed' || !failed.some(f => f.id === 'SMOKE-core-901' && f.note === '白屏')) {
      throw fail('③ 重跑预期 manual_cases_failed 且 failed 含 SMOKE-core-901 与说明', evidence);
    }
    const d2 = await deploy(entry, root, 'ma-prod', evidence);
    if (d2 === deployId) throw fail('④ 重新部署应得到新的 deploy_id', evidence);
    const before = readFileSync(join(root, DEPLOY_LEDGER), 'utf8');
    const r = await cliExpect(entry, root, ['accept', '--env', 'ma-prod', '--deploy', deployId, '--case', 'ST-S01-05', '--result', 'pass', '--format', 'json'], 1, 'stderr');
    evidence.push(`stale_accept=${r.envelope.error?.code}`);
    if (r.envelope.error?.code !== 'ACCEPT_DEPLOY_CHANGED') throw fail(`④ 旧部署清单的 accept 预期 ACCEPT_DEPLOY_CHANGED：${r.envelope.error?.code}`, evidence);
    if (readFileSync(join(root, DEPLOY_LEDGER), 'utf8') !== before) throw fail('④ ACCEPT_DEPLOY_CHANGED 时账本必须零写入', evidence);
    return { detail: '首次通过后更正普通用例使通过过期、重跑判失败；部署更换后旧清单记录被拒且零写入', evidence };
  },

  'SMOKE-core-346': async (entry) => {
    const evidence = [];
    const root = await manualProject(entry, 'accumulate');
    const { passCommit } = await replayPass(entry, root, evidence);
    put(root, 'logos/resources/test/core-S01-test-cases.md', `# core-S01\n\n| ID | 描述 | 前置 | 操作 | 预期 |\n|---|---|---|---|---|\n${ST05}\n${ST08}\n`);
    commit(root, 'proposal A merged, not deployed');
    put(root, 'README.md', 'unrelated\n');
    commit(root, 'unrelated change');
    await deploy(entry, root, 'ma-prod', evidence);
    const s = await cliExpect(entry, root, ['smoke', '--env', 'ma-prod', '--format', 'json'], 1, 'stdout');
    const ma = s.envelope.data.manual_acceptance ?? {};
    evidence.push(`pending=${JSON.stringify(ma.pending)} baseline=${ma.baseline_ref}`);
    if (!(ma.pending ?? []).includes('ST-S01-08')) throw fail('③ 待验收清单应含未部署提案新增的 ST-S01-08', evidence);
    if ((ma.pending ?? []).includes('ST-S01-05')) throw fail('③ 待验收清单不应含基线中未改动的 ST-S01-05', evidence);
    if (ma.baseline_ref !== passCommit) throw fail(`③ baseline_ref 应等于 SMOKE-core-344 通过时的提交 ${passCommit}，实为 ${ma.baseline_ref}`, evidence);
    return { detail: '不部署提案的人工用例被累积到下一次部署的待验收清单', evidence };
  },
};
export const MANUAL_ACCEPTANCE_SMOKE_IDS = Object.keys(CASES);

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
    console.log(`冒烟阶段人工验收安装态 smoke 不适用于环境 ${TARGET_ENV}，已写显式 skip`);
    process.exit(0);
  }
  // ② 适用窗口
  if (activeChange() !== SLUG && process.env.OPENLOGOS_MA_SMOKE !== '1') {
    exitNotApplicable(OWNED, {
      reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_MA_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_MA_SMOKE'], environment: ENVIRONMENT, repoRoot,
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
      for (const id of MANUAL_ACCEPTANCE_SMOKE_IDS) {
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

/** 作为入口执行时才运行主流程；以模块方式导入时只暴露判定函数（供自测以开发构建入口驱动 CASES）。 */
function invokedAsEntry() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; }
}

if (invokedAsEntry()) await main();
