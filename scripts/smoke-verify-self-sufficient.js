#!/usr/bin/env node
/**
 * SMOKE-core-338～SMOKE-core-341：0.16.24 verify 自足能力的**安装态**取证（提案 verify-self-sufficient-cases）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.24 verify 自足安装态 smoke（SMOKE-core-338～341）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.24 本机测试环境发布（verify-self-sufficient-cases）」。
 *
 *   - SMOKE-core-338：安装态版本与制品身份（--version 等于成功部署回执的候选版本；回执 entry_realpath 为非空绝对路径且等于
 *     入口 realpath；包内校验器重算 asset-manifest 不抛错）。
 *   - SMOKE-core-339：对账与环境预检先于预跑（验收标准条目未写入配置 → acceptance_requirement_undeclared；写入但命令不在
 *     PATH → verify_env_not_ready；两者都不执行预跑；补齐后 PASS）。
 *   - SMOKE-core-340：本次改动用例的跳过分类（夹具经全局 CLI 正常 merge 建立真实变更集并在 verify 前断言；无原因 skip →
 *     case_tier_mismatch；平台跳过 → PASS 且 platform_skipped_cases 含该用例）。
 *   - SMOKE-core-341：新建提案带「验收标准」段、缺段只提醒；init + sync 生成的 CLAUDE.md 保护范围条款为新口径。
 *
 * **入口判断次序**（规格「四、自动化与证据要求」）：
 *   ① 宿主已指定 OPENLOGOS_SMOKE_ENV 且不是 test → 为全部 owned ID 写带原因的显式 skip（env-not-test），以 0 退出；
 *   ② 适用窗口：活跃变更为本提案，或 OPENLOGOS_VS_SMOKE=1；窗口外写 skip；
 *   ③ 部署前置：先读部署账本——没有本提案在 test 的成功 deploy 才写显式 skip；有记录时须与本机回执同一 deploy_id、
 *      result=done、environment=test，源码候选版本须可读且等于回执 candidate_version，否则 fail。
 * 全局 CLI 子进程在独立进程组中运行并限时 120 秒；要求解析信封的步骤以 --format json 调用并对 stdout.trim() 整体解析。
 * 「预跑未执行」以项目外标记 RAN 是否存在判定。全部写入只在一次性目录内，结束即删除；对全局安装态只读。
 */
import { spawn, spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable, recordSmokeNotApplicable } from './lib/smoke-not-applicable.mjs';
import { assetManifestVerdict, candidateVersion, installedVersionProblem, parseEnvelope, receiptEntryProblem, writeAll } from './smoke-runner-discovery.js';

export const SLUG = 'verify-self-sufficient-cases';
export const OWNED = ['SMOKE-core-338', 'SMOKE-core-339', 'SMOKE-core-340', 'SMOKE-core-341'];
const ENVIRONMENT = 'local-global-temp-project';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_VS_SMOKE_CHILD_TIMEOUT_MS);
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
const tempDir = tag => { const d = realpathSync(mkdtempSync(join(tmpdir(), `openlogos-smoke-vs-${tag}-`))); scopes.push(d); return d; };
function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_VS_')) delete env[key];
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

const RUNNER = `const fs = require('fs');
if (process.env.VS_RAN) fs.writeFileSync(process.env.VS_RAN, 'ran');
const ids = JSON.parse(fs.readFileSync('tools/ids.json', 'utf8'));
const skips = {};
for (const item of (process.env.VS_SKIP || '').split(',').filter(Boolean)) {
  const [id, spec] = item.split('=');
  if (!spec) { skips[id] = {}; continue; }
  const [reason_code, ...rest] = spec.split(':');
  skips[id] = { reason_code, detail: rest.join(':') };
}
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', ids.map(id => (id in skips)
  ? JSON.stringify({ id, status: 'skip', scenario: 'S01', ...skips[id] })
  : JSON.stringify({ id, status: 'pass', scenario: 'S01' })).join('\\n') + '\\n');
`;
const table = ids => ['| 用例ID | 验证目标 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具 |`)].join('\n');
const CLARIFICATION = '## 决策澄清\n\n```yaml\nschema: openlogos/clarification@1\nmode: adaptive\nstatus: complete\nimpacts:\n  data: {status: none, reason: fixture}\n  compatibility: {status: none, reason: fixture}\n  security_privacy: {status: none, reason: fixture}\n  public_release: {status: none, reason: fixture}\n  external_commitment: {status: none, reason: fixture}\ndecisions: []\nunresolved: []\ndefaults: []\n```\n';

/** 经被测 CLI init 建立的 launched 项目（单模块 core），verify 走记录型 runner、关闭沙箱。 */
async function launchedProject(entry, tag) {
  const root = tempDir(tag);
  await cliExpect(entry, root, ['init', `vs-${tag}`, '--locale', 'zh', '--ai-tool', 'claude-code'], 0, null);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: "vs-smoke"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { ...(cfg.verify ?? {}), result_path: 'logos/resources/verify/test-results.jsonl', pre_run_command: 'node tools/run.cjs', sandbox_mode: 'off' };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  put(root, 'tools/run.cjs', RUNNER);
  return root;
}
function setVerify(root, patch) {
  const p = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  patch(cfg.verify);
  writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`);
}
function proposalMd(acceptanceRequirements) {
  return `# 变更提案：vs smoke\n\n## 变更原因\n夹具。\n\n## 变更类型\n需求级\n\n## 变更范围\n- 影响的功能规格：fixture\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 验收标准\n- 自动验收环境要求：${acceptanceRequirements}\n- 平台限定用例：无\n- 需要人参与的验收：无\n\n## 变更概述\n概述。\n\n${CLARIFICATION}`;
}
function fakeBin(name) {
  const dir = tempDir('bin');
  writeFileSync(join(dir, name), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, name), 0o755);
  return dir;
}
const pathWithout = dir => (process.env.PATH ?? '').split(delimiter).filter(p => p && p !== dir).join(delimiter);

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
  'SMOKE-core-338': async (entry) => {
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
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装态版本等于回执候选版本，入口与回执一致，payloadHash 与资源摘要自洽', evidence };
  },

  'SMOKE-core-339': async (entry) => {
    const root = await launchedProject(entry, 'precheck');
    put(root, 'logos/resources/test/core-S01-test-cases.md', `${table(['UT-S01-01'])}\n`);
    put(root, 'tools/ids.json', JSON.stringify(['UT-S01-01']));
    put(root, 'logos/changes/vs-smoke/proposal.md', proposalMd('`command:vs-fake-tool`'));
    put(root, 'logos/changes/vs-smoke/tasks.md', '# 任务\n\n## [code] 代码实现\n');
    put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: 'vs-smoke', module: 'core' }));
    const ran = `${root}.RAN`;
    const bin = fakeBin('vs-fake-tool');
    const evidence = [];
    const r1 = await cliExpect(entry, root, ['verify', '--format', 'json'], 1, 'stdout', { VS_RAN: ran, PATH: pathWithout(bin) });
    evidence.push(`arm1 gate=${JSON.stringify(r1.envelope.data.gate)}`);
    if (r1.envelope.data.gate?.reason !== 'acceptance_requirement_undeclared') throw Object.assign(new Error(`① gate.reason=${r1.envelope.data.gate?.reason}，预期 acceptance_requirement_undeclared`), { evidence });
    if (!(r1.envelope.data.requirements?.missing_declarations ?? []).includes('command:vs-fake-tool')) throw Object.assign(new Error('① 诊断未点名 command:vs-fake-tool'), { evidence });
    if (existsSync(ran)) throw Object.assign(new Error('① 预跑命令被执行（RAN 存在）'), { evidence });
    setVerify(root, v => { v.requirements = { commands: ['vs-fake-tool'] }; });
    const r2 = await cliExpect(entry, root, ['verify', '--format', 'json'], 1, 'stdout', { VS_RAN: ran, PATH: pathWithout(bin) });
    evidence.push(`arm2 gate=${JSON.stringify(r2.envelope.data.gate)}`);
    const missing = r2.envelope.data.requirements?.missing_environment ?? [];
    if (r2.envelope.data.gate?.reason !== 'verify_env_not_ready' || !missing.some(m => m.name === 'vs-fake-tool')) throw Object.assign(new Error(`② 预期 verify_env_not_ready 且缺失项含 vs-fake-tool：${JSON.stringify(r2.envelope.data.gate)} ${JSON.stringify(missing)}`), { evidence });
    if (existsSync(ran)) throw Object.assign(new Error('② 预跑命令被执行（RAN 存在）'), { evidence });
    const r3 = await cliExpect(entry, root, ['verify', '--format', 'json'], 0, 'stdout', { VS_RAN: ran, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` });
    evidence.push(`arm3 gate=${JSON.stringify(r3.envelope.data.gate)}`);
    if (r3.envelope.data.gate?.result !== 'PASS' || !existsSync(ran)) throw Object.assign(new Error('③ 补齐 PATH 后预期 PASS 且预跑被执行'), { evidence });
    rmSync(ran, { force: true });
    return { detail: '对账与环境预检先于预跑：漏写配置与缺命令都被挡在预跑之前，补齐后 PASS', evidence };
  },

  'SMOKE-core-340': async (entry) => {
    const root = await launchedProject(entry, 'skip');
    const slug = 'vs-smoke';
    const parent = '一、判据';
    const base = ['ST-S01-01', 'UT-S01-01', 'UT-S01-02'];
    const files = [
      ['logos/resources/prd/1-product-requirements/core-01-requirements.md', 'deltas/prd/1-product-requirements/core-01-requirements.md'],
      ['logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md', 'deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md'],
      ['logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md'],
      ['logos/resources/test/core-S01-test-cases.md', 'deltas/test/core-S01-test-cases.md'],
    ];
    for (const [target, delta] of files) {
      const isTest = target.includes('/test/');
      put(root, target, `# 文档\n\n## ${parent}\n\n${isTest ? table(base) : '旧正文。'}\n`);
      put(root, `logos/changes/${slug}/${delta}`, `## MODIFIED — ${parent}\n\n${isTest ? table([...base, 'UT-S01-90']) : '新正文。'}\n`);
    }
    put(root, `logos/changes/${slug}/proposal.md`, proposalMd('无'));
    put(root, `logos/changes/${slug}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n${files.map(([, d]) => d).sort().map(d => `- [x] [MODIFY] \`${d}\`：fixture 更新`).join('\n')}\n\n## [code] 代码实现\n`);
    put(root, `logos/changes/${slug}/PLAN_APPROVED`, '{}');
    put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: slug, module: 'core' }));
    put(root, 'tools/ids.json', JSON.stringify([...base, 'UT-S01-90']));
    await cliExpect(entry, root, ['merge', slug], 0, null);
    // 启动 verify 前：以全局包内的正式读取器断言真实变更集
    const pkg = packageRoot(entry);
    const tcs = await import(pathToFileURL(join(pkg, 'dist/lib/test-change-set.js')).href);
    const read = tcs.readTestChangeSet(root, join(root, 'logos/changes', slug), { change: slug, module: 'core' });
    const evidence = [`change_set_valid=${read.valid}`, `changed=${JSON.stringify(read.valid ? read.value.changed_test_ids : read.code)}`];
    if (!read.valid || !read.value.changed_test_ids.includes('UT-S01-90') || read.value.changed_test_ids.includes('UT-S01-02')) {
      throw Object.assign(new Error('真实变更集不含 UT-S01-90 或误含存量 UT-S01-02'), { evidence });
    }
    const r1 = await cliExpect(entry, root, ['verify', '--format', 'json'], 1, 'stdout', { VS_SKIP: 'UT-S01-90' });
    evidence.push(`arm1 gate=${JSON.stringify(r1.envelope.data.gate)}`);
    if (r1.envelope.data.gate?.reason !== 'case_tier_mismatch' || !(r1.envelope.data.tier_mismatch_cases ?? []).some(c => c.id === 'UT-S01-90')) {
      throw Object.assign(new Error(`① 预期 case_tier_mismatch 且 tier_mismatch_cases 含 UT-S01-90：${JSON.stringify(r1.envelope.data.gate)}`), { evidence });
    }
    const r2 = await cliExpect(entry, root, ['verify', '--format', 'json'], 0, 'stdout', { VS_SKIP: 'UT-S01-90=platform-unavailable:requires win32' });
    evidence.push(`arm2 gate=${JSON.stringify(r2.envelope.data.gate)}`);
    const platform = r2.envelope.data.platform_skipped_cases ?? [];
    if (r2.envelope.data.gate?.result !== 'PASS' || !platform.some(c => c.id === 'UT-S01-90' && c.detail === 'requires win32')) {
      throw Object.assign(new Error(`② 预期 PASS 且 platform_skipped_cases 含 UT-S01-90：${JSON.stringify(platform)}`), { evidence });
    }
    return { detail: '本次改动用例：无原因 skip 判 case_tier_mismatch，平台跳过放行并单独列出', evidence };
  },

  'SMOKE-core-341': async (entry) => {
    const root = tempDir('scaffold');
    await cliExpect(entry, root, ['init', 'vs-scaffold', '--locale', 'zh', '--ai-tool', 'claude-code'], 0, null);
    const yamlPath = join(root, 'logos/logos-project.yaml');
    writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace('lifecycle: initial', 'lifecycle: launched'));
    await cliExpect(entry, root, ['sync'], 0, null);
    const evidence = [];
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
    const newClause = '`logos/logos.config.json` 的 `guard` 字段决定 guard 的保护范围，不得直接修改';
    const fieldClause = '`logos/logos.config.json` 的其他字段（如 `verify.requirements`）只在已立案且属于当前提案范围时，由实现任务直接修改。';
    if (!claude.includes(newClause) || !claude.includes(fieldClause) || claude.includes('与 `logos/logos.config.json` 决定 guard 的保护范围')) {
      throw Object.assign(new Error('③ CLAUDE.md 保护范围条款不是新口径'), { evidence });
    }
    evidence.push('claude_md_protection_clause=new');
    await cliExpect(entry, root, ['change', 'vs-smoke-new'], 0, null);
    const proposalPath = join(root, 'logos/changes/vs-smoke-new/proposal.md');
    const proposal = readFileSync(proposalPath, 'utf8');
    for (const field of ['## 验收标准', '- 自动验收环境要求：', '- 平台限定用例：', '- 需要人参与的验收：']) {
      if (!proposal.includes(field)) throw Object.assign(new Error(`① 新建提案缺少「${field}」`), { evidence });
    }
    evidence.push('proposal_acceptance_section=present');
    writeFileSync(proposalPath, proposal.replace(/## 验收标准\n(?:- [^\n]*\n)+\n?/, ''));
    const lint = await cliExpect(entry, root, ['change-lint', '--format', 'json'], null, 'stdout');
    const warnings = (lint.envelope.data.warnings ?? []).map(w => w.code);
    const violations = (lint.envelope.data.violations ?? []).map(v => v.code);
    evidence.push(`lint_exit=${lint.status}`, `warnings=${JSON.stringify(warnings)}`);
    if (!warnings.includes('acceptance_criteria_missing')) throw Object.assign(new Error('② 删段后 change-lint 未给出 acceptance_criteria_missing 警告'), { evidence });
    if (violations.includes('acceptance_criteria_invalid')) throw Object.assign(new Error('② 缺段被报为违规（应只警告）'), { evidence });
    if (lint.status !== 0 && lint.status !== 2) throw Object.assign(new Error(`② change-lint 退出码 ${lint.status}`), { evidence });
    return { detail: '新建提案带验收标准段、缺段只提醒；生成指令的保护范围条款为新口径', evidence };
  },
};
export const VERIFY_SELF_SUFFICIENT_SMOKE_IDS = Object.keys(CASES);

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
    console.log(`verify 自足安装态 smoke 不适用于环境 ${TARGET_ENV}，已写显式 skip`);
    process.exit(0);
  }
  // ② 适用窗口
  if (activeChange() !== SLUG && process.env.OPENLOGOS_VS_SMOKE !== '1') {
    exitNotApplicable(OWNED, {
      reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_VS_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_VS_SMOKE'], environment: ENVIRONMENT, repoRoot,
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
      for (const id of VERIFY_SELF_SUFFICIENT_SMOKE_IDS) {
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
    for (const s of scopes) rmSync(`${s}.RAN`, { force: true });
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
