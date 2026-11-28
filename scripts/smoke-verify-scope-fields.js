#!/usr/bin/env node
/**
 * SMOKE-core-359～SMOKE-core-366：0.16.28 验收范围字段判断与切片模块的**安装态**取证（提案 verify-scope-fields-and-slice-module）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.28 验收范围字段判断与切片模块安装态 smoke（SMOKE-core-359～366）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.28 本机测试环境发布（verify-scope-fields-and-slice-module）」。
 *
 *   - SMOKE-core-359：安装态版本与制品身份。
 *   - SMOKE-core-360：多模块项目只改两个配置文件的无关字段时验收范围不回落。
 *   - SMOKE-core-361：改了相关字段时回落全量并写明字段。
 *   - SMOKE-core-362：提案起点或工作区内容无法严格解析时回落并写明是哪一侧。
 *   - SMOKE-core-363：工作区缺项目配置时入口错误不变（PROJECT_NOT_INITIALIZED）。
 *   - SMOKE-core-364：分层项目只改无关字段时保持收窄，改 smoke 后扩大并点名字段。
 *   - SMOKE-core-365：非 core 模块提案规划切片后验收不报清单无效。
 *   - SMOKE-core-366：--slug 指向非活跃提案时拒绝且不改文件。
 *
 * **入口判断次序**（规格「四、自动化与证据要求」）：
 *   ① 宿主已指定 OPENLOGOS_SMOKE_ENV 且不是 test → 为全部 owned ID 写带原因的显式 skip（env-not-test），以 0 退出；
 *   ② 适用窗口：活跃变更为本提案，或 OPENLOGOS_VSF_SMOKE=1；窗口外写 skip；
 *   ③ 部署前置：先读部署账本——没有本提案在 test 的成功 deploy 才写显式 skip；有记录时须与本机回执同一 deploy_id、
 *      result=done、environment=test，源码候选版本须可读且等于回执 candidate_version、entry_realpath 为非空绝对路径，否则 fail。
 * 全局 CLI 子进程在独立进程组中运行并限时 120 秒；要求解析信封的步骤以 --format json 调用并对 stdout.trim() 整体解析
 *（错误信封在 stderr 时同样整体解析）。「哪些命令组被执行」「实际执行了哪些用例」读项目外的调用记录（OPENLOGOS_VSF_LOG），
 * 不从 CLI 输出推断。全部写入只在一次性目录内，结束即删除；对全局安装态只读。环境变量一律使用 OPENLOGOS_VSF_ 前缀。
 */
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable, recordSmokeNotApplicable } from './lib/smoke-not-applicable.mjs';
import { assetManifestVerdict, candidateVersion, installedVersionProblem, parseEnvelope, receiptEntryProblem, writeAll } from './smoke-runner-discovery.js';

export const SLUG = 'verify-scope-fields-and-slice-module';
export const OWNED = ['SMOKE-core-359', 'SMOKE-core-360', 'SMOKE-core-361', 'SMOKE-core-362', 'SMOKE-core-363', 'SMOKE-core-364', 'SMOKE-core-365', 'SMOKE-core-366'];
const ENVIRONMENT = 'local-global-temp-project';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_VSF_SMOKE_CHILD_TIMEOUT_MS);
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
const tempDir = tag => { const d = realpathSync(mkdtempSync(join(tmpdir(), `openlogos-smoke-vsf-${tag}-`))); scopes.push(d); return d; };
function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_VSF_')) delete env[key];
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
 * 记录型入口（两套夹具共用）：参数为命令组名（模块 id，或 project 表示全部）。从已合并测试规格按文件名前缀取本组用例；
 * 调用记录写到项目外 OPENLOGOS_VSF_LOG（命令组、收到的清单、实际执行的用例）；收到清单时只执行、只上报清单内的用例。
 * 模块命令组逐个执行，结果以追加方式写入；project 命令组独占结果文件，启动时清空。
 */
const RUNNER = `import fs from 'node:fs';
import path from 'node:path';
const name = process.argv[2] || 'project';
const dir = 'logos/resources/test';
const own = [];
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('-test-cases.md')).sort()) {
  if (name !== 'project' && !file.startsWith(name + '-')) continue;
  for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\\n')) {
    const m = /^\\|\\s*((?:UT|ST)-[A-Za-z0-9]+-[0-9]+)\\s*\\|/.exec(line);
    if (m && !own.includes(m[1])) own.push(m[1]);
  }
}
let eligible = null;
try { const v = JSON.parse(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS || 'null'); if (Array.isArray(v)) eligible = v; } catch {}
const executed = eligible ? own.filter(id => eligible.includes(id)) : own;
const log = process.env.OPENLOGOS_VSF_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ runner: name, eligible, executed }) + '\\n');
const out = 'logos/resources/verify/test-results.jsonl';
fs.mkdirSync('logos/resources/verify', { recursive: true });
if (name === 'project') fs.writeFileSync(out, '');
const now = new Date().toISOString();
fs.appendFileSync(out, executed.map(id => JSON.stringify({ id, status: 'pass', scenario: id.split('-')[1], timestamp: now })).join('\\n') + (executed.length ? '\\n' : ''));
`;
const table = ids => ['| 用例ID | 验证目标 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具 |`)].join('\n');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = path => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);
const CONFIG = 'logos/logos.config.json';
const YAML = 'logos/logos-project.yaml';
const PROPOSAL = 'vsf-smoke';
const L_ALL = ['UT-S01-01', 'UT-S01-02', 'UT-S02-01', 'UT-S02-02', 'UT-S03-01', 'UT-S03-02'];

function git(root, args) {
  const r = spawnSync('git', args, {
    cwd: root, encoding: 'utf8',
    env: { ...cleanEnv(), GIT_AUTHOR_NAME: 'vsf', GIT_AUTHOR_EMAIL: 'vsf@example.invalid', GIT_COMMITTER_NAME: 'vsf', GIT_COMMITTER_EMAIL: 'vsf@example.invalid' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 200)}`);
  return (r.stdout || '').trim();
}
const commitAll = (root, message) => { git(root, ['add', '-A']); git(root, ['commit', '-qm', message]); return git(root, ['rev-parse', 'HEAD']); };
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const editConfig = (root, mutate) => { const path = join(root, CONFIG); const cfg = readJson(path); mutate(cfg); writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`); };
const M_YAML = [
  'project:', '  name: "vsf-smoke"', 'modules:',
  '  - id: core', '    name: Core', '    lifecycle: launched', '    paths: ["core/**", "tools/**"]',
  '  - id: web', '    name: Web', '    lifecycle: launched', '    paths: ["web/**"]',
  'scenario_counter:', '  next_id: 40', 'resource_index: []', '',
].join('\n');

function outsideOf(tag, root) {
  const outside = tempDir(`${tag}-out`);
  return { root, log: join(outside, 'calls.jsonl') };
}
const fxEnv = fx => ({ OPENLOGOS_VSF_LOG: fx.log });
const readCalls = log => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const resetCalls = fx => rmSync(fx.log, { force: true });
const runners = calls => calls.map(c => c.runner);
const fail = (message, evidence) => Object.assign(new Error(message), { evidence });

/**
 * 夹具 P（多模块）：经被测 CLI init 建立项目后写入——模块 core 与 web（均 launched，各自声明 paths），已合并测试规格
 * core-S01（UT-S01-01、02）与 web-S05（UT-S05-01、02），verify.modules 各有命令组（记录型入口）、关闭沙箱；
 * logos.config.json 另含 smoke 与 description，logos-project.yaml 含 resource_index；分层关闭。全部内容提交后，
 * 经被测 CLI `change vsf-smoke --module web` 建立活跃提案（guard 带 baseRef 与 module: web）。opts.proposal 为 false 时不建提案。
 */
async function fixtureP(entry, tag, opts = {}) {
  const root = tempDir(tag);
  await cliExpect(entry, root, ['init', `vsf-${tag}`, '--locale', 'zh', '--ai-tool', 'claude-code'], 0, null);
  put(root, YAML, M_YAML);
  put(root, 'logos/resources/test/core-S01-test-cases.md', `${table(['UT-S01-01', 'UT-S01-02'])}\n`);
  put(root, 'logos/resources/test/web-S05-test-cases.md', `${table(['UT-S05-01', 'UT-S05-02'])}\n`);
  put(root, 'tools/vsf-runner.mjs', RUNNER);
  put(root, 'core/lib.ts', 'export const lib = 1;\n');
  put(root, 'web/app.ts', 'export const app = 1;\n');
  editConfig(root, cfg => {
    cfg.description = 'vsf smoke fixture';
    cfg.smoke = { ...(cfg.smoke ?? {}), command: 'node tools/smoke.mjs' };
    cfg.verify = {
      ...(cfg.verify ?? {}), result_path: 'logos/resources/verify/test-results.jsonl', sandbox_mode: 'off',
      pre_run_command: 'node tools/vsf-runner.mjs project',
      modules: { core: { pre_run_command: 'node tools/vsf-runner.mjs core' }, web: { pre_run_command: 'node tools/vsf-runner.mjs web' } },
    };
    delete cfg.verify.layered;
  });
  git(root, ['init', '-q']);
  commitAll(root, 'vsf fixture');
  const fx = outsideOf(tag, root);
  if (opts.proposal !== false) await cliExpect(entry, root, ['change', PROPOSAL, '--module', 'web'], 0, null);
  return fx;
}

/**
 * 夹具 L（分层）：同「OpenLogos 0.16.27 分层验收安装态 smoke」的单模块夹具——core-S01、core-S02 各两条，core-S03 两条且
 * 主链路小节列 UT-S03-01；verify.layered.enabled 为 true；活跃提案声明 assessment: assessed、scenarios: [S02]。
 */
async function fixtureL(entry, tag) {
  const root = tempDir(tag);
  await cliExpect(entry, root, ['init', `vsf-${tag}`, '--locale', 'zh', '--ai-tool', 'claude-code'], 0, null);
  put(root, YAML, 'project:\n  name: "vsf-smoke"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  put(root, 'logos/resources/test/core-S01-test-cases.md', `${table(['UT-S01-01', 'UT-S01-02'])}\n`);
  put(root, 'logos/resources/test/core-S02-test-cases.md', `${table(['UT-S02-01', 'UT-S02-02'])}\n`);
  put(root, 'logos/resources/test/core-S03-test-cases.md', `${table(['UT-S03-01', 'UT-S03-02'])}\n\n## 主链路用例\n\n- UT-S03-01\n`);
  put(root, 'tools/vsf-runner.mjs', RUNNER);
  editConfig(root, cfg => {
    cfg.verify = {
      ...(cfg.verify ?? {}), result_path: 'logos/resources/verify/test-results.jsonl', sandbox_mode: 'off',
      pre_run_command: 'node tools/vsf-runner.mjs project', layered: { enabled: true },
    };
  });
  git(root, ['init', '-q']);
  commitAll(root, 'vsf layered fixture');
  const fx = outsideOf(tag, root);
  await cliExpect(entry, root, ['change', PROPOSAL], 0, null);
  const path = join(root, 'logos/changes', PROPOSAL, 'proposal.md');
  const content = readFileSync(path, 'utf8');
  const yaml = 'schema: openlogos/affected-scenarios@1\nassessment: assessed\nshared_change: false\nscenarios:\n  - id: S02\n    reason: 夹具声明 S02 受波及\n';
  const next = content.replace(/(## 受影响场景\s*\n+```yaml\n)[\s\S]*?(```)/, (_m, open, close) => `${open}${yaml}${close}`);
  if (next === content) throw new Error('proposal.md 中找不到可改写的「受影响场景」段');
  writeFileSync(path, next);
  return fx;
}

/** 可合并的最小提案（登记在 web）：新增 web-S05 的两条用例。 */
const MERGE_PROPOSAL_MD = [
  `# 变更提案：${PROPOSAL}`, '', '> module: web', '',
  '## 变更原因', '安装态 smoke 夹具：验证非 core 模块提案的切片规划。', '',
  '## 变更类型', '代码级', '',
  '## 变更范围', '- 影响的测试规格：临时项目私有测试用例文档。', '',
  '## 部署影响', '- 是否需要部署：否', '- 部署原因：smoke 夹具不产生部署影响', '- 影响环境：无',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
  '## UI/UX 变更声明', '', '```yaml', 'ui_impact: false', 'design_system_mode: generated',
  'design_system_fallback_reason: ""', 'pages: []', '```', '',
  '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
  'impacts:', '  data:', '    status: none', '    reason: smoke 夹具不涉及数据影响',
  '  compatibility:', '    status: none', '    reason: smoke 夹具不涉及兼容性影响',
  '  security_privacy:', '    status: none', '    reason: smoke 夹具不涉及安全或隐私影响',
  '  public_release:', '    status: none', '    reason: smoke 夹具不涉及公开发布',
  '  external_commitment:', '    status: none', '    reason: smoke 夹具不涉及外部承诺',
  'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
  '## 验收标准', '- 自动验收环境要求：无', '- 平台限定用例：无', '- 需要人参与的验收：无', '',
  '## 受影响场景', '', '```yaml', 'schema: openlogos/affected-scenarios@1', 'assessment: assessed', 'shared_change: false', 'scenarios: []', '```', '',
  '## 变更概述', 'smoke 夹具：新增两条 web 用例并分两个切片。', '',
].join('\n');
const MERGE_DELTA_REL = 'deltas/test/web-S05-test-cases.md';
const MERGE_DELTA = `## ADDED — 新增用例（vsf-smoke）\n\n${table(['UT-S05-03', 'UT-S05-04'])}\n`;
const SLICE_INPUT = { slices: [
  { slice_id: 'slice-a', task_text: '切片1：能力 a（覆盖 UT-S05-03）', owned_test_ids: ['UT-S05-03'], runner_selectors: ['UT-S05-03'], spec_targets: ['logos/resources/test/web-S05-test-cases.md'] },
  { slice_id: 'slice-b', task_text: '切片2：能力 b（覆盖 UT-S05-04）', owned_test_ids: ['UT-S05-04'], runner_selectors: ['UT-S05-04'], spec_targets: ['logos/resources/test/web-S05-test-cases.md'] },
] };

/** 夹具 P 上经被测 CLI 完成合并（写入 SPEC_MERGED）并写好切片输入；返回切片输入的项目根相对路径。 */
async function mergedWebProposal(entry, fx) {
  const dir = join(fx.root, 'logos/changes', PROPOSAL);
  writeFileSync(join(dir, 'proposal.md'), MERGE_PROPOSAL_MD);
  writeFileSync(join(dir, 'tasks.md'), ['# 实现任务', '', '## [delta] 规格变更', '', `- [x] 产出 delta 到 \`${MERGE_DELTA_REL}\`。`, '', '## [code] 代码实现', ''].join('\n'));
  put(dir, MERGE_DELTA_REL, MERGE_DELTA);
  await cliExpect(entry, fx.root, ['merge', PROPOSAL], 0, null);
  if (!existsSync(join(dir, 'SPEC_MERGED'))) throw new Error('全局 CLI merge 未写出 SPEC_MERGED');
  const rel = `logos/changes/${PROPOSAL}/slices.json`;
  put(fx.root, rel, JSON.stringify(SLICE_INPUT, null, 2));
  return rel;
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
export const IDENTITY_CASE = 'SMOKE-core-359';

export const CASES = {
  'SMOKE-core-359': async (entry) => {
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

  'SMOKE-core-360': async (entry) => {
    const fx = await fixtureP(entry, 'unrelated');
    put(fx.root, 'web/app.ts', 'export const app = 2;\n');
    put(fx.root, YAML, M_YAML.replace('resource_index: []', 'resource_index:\n  - path: logos/resources/verify/a.md\n    desc: a'));
    editConfig(fx.root, cfg => { cfg.driver = { review: { enabled: true } }; });
    const r = await cliExpect(entry, fx.root, ['verify', '--format', 'json'], 0, 'stdout', fxEnv(fx));
    const d = r.envelope.data;
    const calls = readCalls(fx.log);
    const evidence = [`scope=${JSON.stringify(d.scope ?? null)}`, `gate=${JSON.stringify(d.gate)}`, `runners=${JSON.stringify(runners(calls))}`];
    if (d.scope?.mode !== 'module' || !same(d.scope?.modules, ['web'])) throw fail('scope 应为 module 且只含 web', evidence);
    if (d.scope?.fallback_reason !== null) throw fail('只改无关字段不应有回落原因', evidence);
    if (!same(runners(calls), ['web'])) throw fail('应只有 web 的命令组被执行', evidence);
    if (d.gate?.result !== 'PASS') throw fail(`gate=${JSON.stringify(d.gate)}，预期 PASS`, evidence);
    return { detail: '只改 resource_index 与 driver：验收范围保持按模块，只执行 web 的命令组', evidence };
  },

  'SMOKE-core-361': async (entry) => {
    const fx = await fixtureP(entry, 'related');
    put(fx.root, 'web/app.ts', 'export const app = 2;\n');
    put(fx.root, YAML, M_YAML.replace('resource_index: []', 'resource_index:\n  - path: logos/resources/verify/a.md\n    desc: a'));
    editConfig(fx.root, cfg => { cfg.driver = { review: { enabled: true } }; cfg.verify.modules.core.pre_run_command = 'node tools/vsf-runner.mjs core extra'; });
    const r = await cliExpect(entry, fx.root, ['verify', '--format', 'json'], null, 'stdout', fxEnv(fx));
    const d = r.envelope.data;
    const calls = readCalls(fx.log);
    const evidence = [`scope=${JSON.stringify(d.scope ?? null)}`, `runners=${JSON.stringify(runners(calls))}`];
    const expected = `${CONFIG}（verify）`;
    if (d.scope?.mode !== 'fallback-full') throw fail('scope.mode 应为 fallback-full', evidence);
    if (d.scope?.fallback_reason?.code !== 'shared_config_changed' || d.scope?.fallback_reason?.detail !== expected) throw fail(`回落原因应为 shared_config_changed：${expected}`, evidence);
    if (!same(runners(calls).sort(), ['core', 'web'])) throw fail('两个模块的命令组都应被执行', evidence);
    return { detail: '改了 verify：回落全量并点名文件与字段，两个模块的命令组都执行', evidence };
  },

  'SMOKE-core-362': async (entry) => {
    const evidence = [];
    // ① 提案起点中的 logos.config.json 是损坏的 JSON，工作区修正为有效内容
    const a = await fixtureP(entry, 'base-corrupt');
    const good = readFileSync(join(a.root, CONFIG), 'utf8');
    writeFileSync(join(a.root, CONFIG), '{ "name": "broken", ');
    const base = commitAll(a.root, 'broken base');
    const guardPath = join(a.root, 'logos/.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ ...readJson(guardPath), baseRef: base }, null, 2));
    writeFileSync(join(a.root, CONFIG), good);
    put(a.root, 'web/app.ts', 'export const app = 2;\n');
    const ra = (await cliExpect(entry, a.root, ['verify', '--format', 'json'], null, 'stdout', fxEnv(a))).envelope.data;
    evidence.push(`base_corrupt=${JSON.stringify(ra.scope ?? null)}`);
    const ea = `${CONFIG}（提案起点中的内容无法解析）`;
    if (ra.scope?.mode !== 'fallback-full' || ra.scope?.fallback_reason?.code !== 'shared_config_changed' || ra.scope?.fallback_reason?.detail !== ea) throw fail(`① 应回落并写明：${ea}`, evidence);
    // ② 工作区 logos-project.yaml 重复一个顶层键，modules 仍为两个带 paths 的模块
    const b = await fixtureP(entry, 'work-dup');
    put(b.root, 'web/app.ts', 'export const app = 2;\n');
    put(b.root, YAML, `${M_YAML}resource_index: []\n`);
    const rb = (await cliExpect(entry, b.root, ['verify', '--format', 'json'], null, 'stdout', fxEnv(b))).envelope.data;
    evidence.push(`work_dup=${JSON.stringify(rb.scope ?? null)}`);
    const eb = `${YAML}（工作区中的内容无法解析）`;
    if (rb.scope?.mode !== 'fallback-full' || rb.scope?.fallback_reason?.code !== 'shared_config_changed' || rb.scope?.fallback_reason?.detail !== eb) throw fail(`② 应回落并写明：${eb}`, evidence);
    return { detail: '提案起点或工作区内容无法严格解析时回落，原因写明是哪一侧', evidence };
  },

  'SMOKE-core-363': async (entry) => {
    const fx = await fixtureP(entry, 'no-config');
    rmSync(join(fx.root, CONFIG));
    const r = await cliExpect(entry, fx.root, ['verify', '--format', 'json'], 1, null, fxEnv(fx));
    const error = parseErrorEnvelope(r.stderr, 'verify', '全局 CLI verify（缺 logos.config.json）');
    const calls = readCalls(fx.log);
    const evidence = [`error=${error.code}`, `calls=${calls.length}`];
    if (error.code !== 'PROJECT_NOT_INITIALIZED') throw fail(`错误码 ${error.code}，预期 PROJECT_NOT_INITIALIZED`, evidence);
    if (calls.length !== 0) throw fail('不应有任何命令组被执行', evidence);
    if (`${r.stdout}${r.stderr}`.includes('shared_config_changed')) throw fail('输出中不应出现 shared_config_changed', evidence);
    return { detail: '工作区缺 logos.config.json：仍以 PROJECT_NOT_INITIALIZED 退出，没有执行命令、没有回落原因', evidence };
  },

  'SMOKE-core-364': async (entry) => {
    const fx = await fixtureL(entry, 'layered');
    const P = ['UT-S02-01', 'UT-S02-02', 'UT-S03-01'];
    const yamlPath = join(fx.root, YAML);
    writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace('resource_index: []', 'resource_index:\n  - path: logos/resources/verify/a.md\n    desc: a'));
    editConfig(fx.root, cfg => { cfg.description = 'changed after baseRef'; });
    const first = (await cliExpect(entry, fx.root, ['verify', '--format', 'json'], 0, 'stdout', fxEnv(fx))).envelope.data;
    const firstCalls = readCalls(fx.log);
    const evidence = [`expansion1=${JSON.stringify(first.layers?.expansion ?? null)}`, `calls1=${JSON.stringify(firstCalls)}`];
    if (first.layers?.expansion?.level !== 'none') throw fail('① 只改无关字段应保持收窄（level=none）', evidence);
    if (firstCalls.length !== 1 || !same(firstCalls[0].executed, P)) throw fail('① 入口应只执行提案集合内的 3 条用例', evidence);
    // ② 再改 smoke.command
    resetCalls(fx);
    editConfig(fx.root, cfg => { cfg.smoke = { ...(cfg.smoke ?? {}), command: 'node tools/other-smoke.mjs' }; });
    const second = (await cliExpect(entry, fx.root, ['verify', '--format', 'json'], 0, 'stdout', fxEnv(fx))).envelope.data;
    const secondCalls = readCalls(fx.log);
    const reason = (second.layers?.expansion?.reasons ?? []).find(x => x.code === 'shared_path_changed');
    evidence.push(`expansion2=${JSON.stringify(second.layers?.expansion ?? null)}`, `calls2=${JSON.stringify(secondCalls)}`);
    const expected = `${CONFIG}（smoke）`;
    if (second.layers?.expansion?.level !== 'full') throw fail('② 改 smoke 后应扩大到全量', evidence);
    if (reason?.detail !== expected) throw fail(`② shared_path_changed 的 detail 应为 ${expected}`, evidence);
    if (secondCalls.length !== 1 || !same(secondCalls[0].executed, L_ALL)) throw fail('② 入口应执行全部 6 条用例', evidence);
    return { detail: '分层项目：只改 resource_index 与 description 保持收窄；改 smoke 后扩大并点名字段', evidence };
  },

  'SMOKE-core-365': async (entry) => {
    const fx = await fixtureP(entry, 'slice');
    const slices = await mergedWebProposal(entry, fx);
    const plan = await cliExpect(entry, fx.root, ['slice', 'plan', '--file', slices, '--format', 'json'], 0, null);
    let planned = null;
    try { planned = JSON.parse(plan.stdout.trim()); } catch { /* 下方判定 */ }
    const dir = join(fx.root, 'logos/changes', PROPOSAL);
    const manifest = existsSync(join(dir, 'TEST_SLICE_MANIFEST.json')) ? readJson(join(dir, 'TEST_SLICE_MANIFEST.json')) : null;
    const evidence = [`plan=${JSON.stringify(planned?.data?.slice_ids ?? null)}`, `manifest_module=${manifest?.module ?? null}`];
    if (!planned || planned.command !== 'slice plan') throw fail('slice plan 的 stdout 不是可整体解析的成功信封', evidence);
    if (manifest?.module !== 'web') throw fail(`清单 module=${manifest?.module}，预期 web`, evidence);
    writeFileSync(join(dir, 'SLICES_APPROVED'), '');
    put(fx.root, 'web/app.ts', 'export const app = 2;\n');
    const r = await cliExpect(entry, fx.root, ['verify', '--format', 'json'], null, 'stdout', fxEnv(fx));
    const d = r.envelope.data;
    evidence.push(`verify_mode=${d.verify_mode}`, `attempted=${d.attempted_slice_id}`, `gate=${JSON.stringify(d.gate)}`);
    if (JSON.stringify(d).includes('test-slice-manifest-invalid')) throw fail('verify 仍报 test-slice-manifest-invalid', evidence);
    if (d.verify_mode !== 'slice-checkpoint' || d.attempted_slice_id !== 'slice-a') throw fail('verify 应进入第一个切片的 checkpoint', evidence);
    return { detail: '提案登记在 web：slice plan 写出 module=web 的清单，verify 进入首个切片 checkpoint', evidence };
  },

  'SMOKE-core-366': async (entry) => {
    const fx = await fixtureP(entry, 'slug');
    const slices = await mergedWebProposal(entry, fx);
    const otherDir = join(fx.root, 'logos/changes/other-demo');
    put(otherDir, 'tasks.md', '# 实现任务\n\n## [code] 代码实现\n（占位）\n');
    const before = sha(join(otherDir, 'tasks.md'));
    const r = await cliExpect(entry, fx.root, ['slice', 'plan', '--slug', 'other-demo', '--file', slices, '--format', 'json'], 1, null);
    const error = parseErrorEnvelope(r.stderr, 'slice plan', '全局 CLI slice plan --slug other-demo');
    const evidence = [`error=${error.code}`, `message=${String(error.message).slice(0, 120)}`, `tasks_unchanged=${sha(join(otherDir, 'tasks.md')) === before}`];
    if (error.code !== 'SLICE_PLAN_NO_ACTIVE_CHANGE') throw fail(`错误码 ${error.code}，预期 SLICE_PLAN_NO_ACTIVE_CHANGE`, evidence);
    if (sha(join(otherDir, 'tasks.md')) !== before) throw fail('other-demo/tasks.md 被改写', evidence);
    if (existsSync(join(otherDir, 'TEST_SLICE_MANIFEST.json'))) throw fail('other-demo 目录中生成了切片清单', evidence);
    return { detail: '--slug 指向非活跃提案：以 SLICE_PLAN_NO_ACTIVE_CHANGE 拒绝，目标提案文件不变', evidence };
  },
};
export const VERIFY_SCOPE_FIELDS_SMOKE_IDS = Object.keys(CASES);

/**
 * 逐例分派。安装态身份用例（SMOKE-core-359）是其余用例的前置条件：它失败时保留身份校验明细，
 * 其余用例一律不执行，各写一条「身份校验失败、用例未执行」的失败记录——装上的不是本次候选时，
 * 行为用例即使碰巧通过也不能记为本次部署的通过（规格「失败处置：回流部署，不继续后续用例的通过判定」）。
 */
export async function dispatchCases(entry, deployed, cases = CASES) {
  DEPLOYED = deployed;
  const out = new Map();
  const runOne = async id => {
    const started = Date.now();
    try {
      const r = await cases[id](entry);
      out.set(id, { status: 'pass', detail: r.detail, evidence: [`entry=${entry}`, ...r.evidence], duration_ms: Date.now() - started });
    } catch (error) {
      out.set(id, { status: 'fail', detail: error instanceof Error ? error.message : String(error), evidence: [`entry=${entry}`, ...(error?.evidence ?? [])], duration_ms: Date.now() - started });
    }
  };
  await runOne(IDENTITY_CASE);
  const identity = out.get(IDENTITY_CASE);
  for (const id of OWNED) {
    if (id === IDENTITY_CASE) continue;
    if (identity.status !== 'pass') {
      out.set(id, {
        status: 'fail',
        detail: `安装态身份校验（${IDENTITY_CASE}）失败，本用例未执行：${identity.detail}`,
        evidence: [`entry=${entry}`, `blocked_by=${IDENTITY_CASE}`],
        duration_ms: 0,
      });
      continue;
    }
    await runOne(id);
  }
  return out;
}

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
    console.log(`验收范围字段判断安装态 smoke 不适用于环境 ${TARGET_ENV}，已写显式 skip`);
    process.exit(0);
  }
  // ② 适用窗口
  if (activeChange() !== SLUG && process.env.OPENLOGOS_VSF_SMOKE !== '1') {
    exitNotApplicable(OWNED, {
      reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_VSF_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_VSF_SMOKE'], environment: ENVIRONMENT, repoRoot,
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
      for (const [id, row] of await dispatchCases(entry, DEPLOYED)) results.set(id, row);
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
