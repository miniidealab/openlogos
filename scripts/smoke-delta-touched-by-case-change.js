#!/usr/bin/env node
/**
 * SMOKE-core-367～SMOKE-core-374：0.16.29 测试用例文档按用例变化判断 delta 触及的**安装态**取证（提案 fix-delta-touched-by-case-change）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.29 测试用例文档按用例变化判断触及安装态 smoke（SMOKE-core-367～374）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.29 本机测试环境发布（fix-delta-touched-by-case-change）」。
 *
 *   - SMOKE-core-367：安装态版本与制品身份（批准版本、全局版本、部署回执、源码候选版本四者相等）。
 *   - SMOKE-core-368：同一提案里只改主链路小节的文档不并入，同时改了用例的文档照常并入。
 *   - SMOKE-core-369：不声明时删除编号不含场景号的用例，原场景并入。
 *   - SMOKE-core-370：不声明时跨文档移动用例，移出与移入的场景都并入。
 *   - SMOKE-core-371：场景文档的 delta 照常并入。
 *   - SMOKE-core-372：提案未合并时按文件名并入。
 *   - SMOKE-core-373：没有合并基线、或某份文档的合并前内容读不回时，只对无法判断的文档按文件名并入。
 *   - SMOKE-core-374：测试变更集无效或正式目标被改动时，普通提案走门禁 FAIL、多切片提案走切片清单暂停。
 *
 * **入口判断次序**（规格「四、自动化与证据要求」）：
 *   ① 宿主已指定 OPENLOGOS_SMOKE_ENV 且不是 test → 为全部 owned ID 写带原因的显式 skip（env-not-test），以 0 退出；
 *   ② 适用窗口：活跃变更为本提案，或 OPENLOGOS_DTC_SMOKE=1；窗口外写 skip；
 *   ③ 部署前置：先读部署账本——没有本提案在 test 的成功 deploy 才写显式 skip；有记录时须与本机回执同一 deploy_id、
 *      result=done、environment=test，源码候选版本须可读且等于回执 candidate_version 与 APPROVED_VERSION、
 *      entry_realpath 为非空绝对路径，否则 fail。
 * 全局 CLI 子进程在独立进程组中运行并限时 120 秒；要求解析信封的步骤以 --format json 调用并对 stdout.trim() 整体解析。
 * 夹具中的 merge 与 slice plan 一律由被测 CLI 真实执行，失败判该用例 fail，不手写 SPEC_MERGED 或切片清单。
 * 「实际执行了哪些用例」读项目外的调用记录（OPENLOGOS_DTC_LOG），不从 CLI 输出推断。
 * 用例失败时，在清理夹具之前把完整命令输出、SPEC_MERGED 全文与逐次调用记录写入该用例的失败证据（缺失的文件明确记录缺失）。
 * 全部写入只在一次性目录内，结束即删除；对全局安装态只读。环境变量一律使用 OPENLOGOS_DTC_ 前缀。
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

export const SLUG = 'fix-delta-touched-by-case-change';
/** 本次批准的目标版本（需求 AC-VERIFY-TIER-26）：装入其他版本号时不算达成。 */
export const APPROVED_VERSION = '0.16.29';
export const OWNED = ['SMOKE-core-367', 'SMOKE-core-368', 'SMOKE-core-369', 'SMOKE-core-370', 'SMOKE-core-371', 'SMOKE-core-372', 'SMOKE-core-373', 'SMOKE-core-374'];
const ENVIRONMENT = 'local-global-temp-project';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_DTC_SMOKE_CHILD_TIMEOUT_MS);
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
 * 且 candidate_version 等于本次批准的目标版本 APPROVED_VERSION，否则 { problem }（fail）。
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
  if (receipt.candidate_version !== APPROVED_VERSION) mismatch.push(`回执 candidate_version=${receipt.candidate_version}，本次批准的目标版本=${APPROVED_VERSION}`);
  if (mismatch.length > 0) return { problem: `本次成功部署回执与候选不符：${mismatch.join('；')}` };
  return { receipt };
}

const scopes = [];
/** 当前用例的命令轨迹与夹具（每条用例开始时清空）：失败时在清理夹具之前转成失败证据。 */
const CASE_TRACE = [];
const CASE_FIXTURES = [];
const tempDir = tag => { const d = realpathSync(mkdtempSync(join(tmpdir(), `openlogos-smoke-dtc-${tag}-`))); scopes.push(d); return d; };
function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_DTC_')) delete env[key];
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
  // 完整输出记入本用例的命令轨迹：用例失败时原样写入失败证据（下面的错误消息只取前 300 个字符，不能作为证据）
  CASE_TRACE.push({ args, status: r.status ?? null, signal: r.signal ?? null, timedOut: r.timedOut === true, stdout: r.stdout || '', stderr: r.stderr || '' });
  if (r.timedOut) throw new Error(`${label} 超过 ${CHILD_TIMEOUT_MS / 1000} 秒未返回，已强制终止其进程组，判失败、不重试`);
  if (r.error) throw new Error(`${label} 启动失败：${r.error.message}`);
  if (r.signal) throw new Error(`${label} 被信号 ${r.signal} 终止，判失败`);
  if (expectExit !== null && r.status !== expectExit) throw new Error(`${label} 退出码 ${r.status}，预期 ${expectExit}：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  if (!channel) return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  return { status: r.status, envelope: parseEnvelope(r.stdout || '', args[0], label), stdout: r.stdout || '', stderr: r.stderr || '' };
}

/**
 * 记录型入口：从已合并测试规格取全部不带 [manual] 的 UT/ST；调用记录写到项目外 OPENLOGOS_DTC_LOG（收到的清单、实际执行的用例）；
 * 收到清单时只执行、只上报清单内的用例；缺省全部 pass。
 */
const RUNNER = `import fs from 'node:fs';
import path from 'node:path';
const dir = 'logos/resources/test';
const own = [];
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('-test-cases.md')).sort()) {
  for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\\n')) {
    const m = /^\\|\\s*((?:UT|ST)-[A-Za-z0-9]+-[0-9]+)\\s*\\|/.exec(line);
    if (m && !own.includes(m[1])) own.push(m[1]);
  }
}
let eligible = null;
try { const v = JSON.parse(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS || 'null'); if (Array.isArray(v)) eligible = v; } catch {}
const executed = eligible ? own.filter(id => eligible.includes(id)) : own;
const log = process.env.OPENLOGOS_DTC_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ eligible, executed }) + '\\n');
const out = 'logos/resources/verify/test-results.jsonl';
fs.mkdirSync('logos/resources/verify', { recursive: true });
const now = new Date().toISOString();
fs.writeFileSync(out, executed.map(id => JSON.stringify({ id, status: 'pass', scenario: id.split('-')[1], timestamp: now })).join('\\n') + (executed.length ? '\\n' : ''));
`;
const rows = (ids, desc = {}) => `${['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | ${desc[id] ?? `${id} 夹具`} |`)].join('\n')}\n`;
/** 带标题结构的测试用例文档：用例表在「单元测试」下，另有一段「覆盖度校验」文字。 */
const doc = (ids, tail = '') => `# 测试用例\n\n## 单元测试\n\n${rows(ids)}\n## 覆盖度校验\n\n- 覆盖说明\n${tail}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = list => [...list].sort();
const sha = path => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);
const CONFIG = 'logos/logos.config.json';
const YAML = 'logos/logos-project.yaml';
const PROPOSAL = 'dtc-smoke';
const TEST_DIR = 'logos/resources/test';
const SCENARIO_DOC = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S02-demo.md';
const DELTA_SCENARIO = 'prd/3-technical-plan/2-scenario-implementation/core-S02-demo.md';
const S01 = ['UT-S01-01', 'UT-S01-02'];
const S02 = ['UT-S02-01', 'UT-S02-02', 'UT-JSON-90'];

function git(root, args) {
  const r = spawnSync('git', args, {
    cwd: root, encoding: 'utf8',
    env: { ...cleanEnv(), GIT_AUTHOR_NAME: 'dtc', GIT_AUTHOR_EMAIL: 'dtc@example.invalid', GIT_COMMITTER_NAME: 'dtc', GIT_COMMITTER_EMAIL: 'dtc@example.invalid' },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 200)}`);
  return (r.stdout || '').trim();
}
const commitAll = (root, message) => { git(root, ['add', '-A']); git(root, ['commit', '-q', '--allow-empty', '-m', message]); return git(root, ['rev-parse', 'HEAD']); };
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const editConfig = (root, mutate) => { const path = join(root, CONFIG); const cfg = readJson(path); mutate(cfg); writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`); };
const fxEnv = fx => ({ OPENLOGOS_DTC_LOG: fx.log });
const readCalls = log => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
const executedOf = calls => sorted(Array.from(new Set(calls.flatMap(c => c.executed))));
const fail = (message, evidence) => Object.assign(new Error(message), { evidence });

/** 常用 delta。 */
const dMain = ids => `## ADDED — 主链路用例\n\n${ids.map(id => `- ${id}`).join('\n')}\n`;
const dTable = (ids, desc = {}, removed = []) =>
  `## MODIFIED — 单元测试\n\n${rows(ids, desc)}${removed.length ? `\n## REMOVED-ITEMS — 单元测试\n\n${removed.map(id => `- ${id}`).join('\n')}\n` : ''}`;
const D_MAIN_S02 = { 'test/core-S02-test-cases.md': dMain(['UT-S02-01']) };
const D_MAIN_S01 = { 'test/core-S01-test-cases.md': dMain(['UT-S01-01']) };

/**
 * 声明的写法：用例中的 scenarios: [S01] 是场景编号简写，这里写成含 id 与非空 reason 的对象（沿用
 * scripts/smoke-layered-verification.js 的 setDeclaration 写法）；空列表原样写入。
 */
export function declarationYaml(scenarios) {
  const items = scenarios.length === 0 ? ' []' : `\n${scenarios.map(id => `  - id: ${id}\n    reason: 夹具声明 ${id} 受波及`).join('\n')}`;
  return `schema: openlogos/affected-scenarios@1\nassessment: assessed\nshared_change: false\nscenarios:${items}\n`;
}
const proposalMd = scenarios => [
  `# 变更提案：${PROPOSAL}`, '', '> module: core', '',
  '## 变更原因', '安装态 smoke 夹具：验证测试用例文档按用例变化判断 delta 触及。', '',
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
  '## 受影响场景', '', '```yaml', declarationYaml(scenarios).trimEnd(), '```', '',
  // 只改清单的 delta 不带任何测试 ID：以既有用例满足「需代码的提案须有可采信的测试 ID」的合并准入
  '## 复用测试 ID', '', '- UT-S03-01 — 夹具既有用例', '',
  '## 变更概述', 'smoke 夹具。', '',
].join('\n');

/**
 * 夹具 D（分层）：经被测 CLI init 建立项目后写入——单模块 core launched、verify.layered.enabled 为 true；已合并测试规格
 * core-S01（UT-S01-01、02）、core-S02（UT-S02-01、02、UT-JSON-90）、core-S03（UT-S03-01、02，主链路小节列 UT-S03-01），
 * 已合并场景文档 core-S02-demo.md；全部内容提交后经被测 CLI `change dtc-smoke` 建立活跃提案，写入 deltas 与声明；
 * opts.merged 不为 false 时经被测 CLI `merge dtc-smoke` 合并（写入 SPEC_MERGED，含测试变更集与合并基线）。
 */
export async function fixtureD(entry, tag, { deltas, scenarios = [], merged = true }) {
  const root = tempDir(tag);
  await cliExpect(entry, root, ['init', `dtc-${tag}`, '--locale', 'zh', '--ai-tool', 'claude-code'], 0, null);
  put(root, YAML, 'project:\n  name: "dtc-smoke"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  put(root, `${TEST_DIR}/core-S01-test-cases.md`, doc(S01));
  put(root, `${TEST_DIR}/core-S02-test-cases.md`, doc(S02));
  put(root, `${TEST_DIR}/core-S03-test-cases.md`, doc(['UT-S03-01', 'UT-S03-02'], '\n## 主链路用例\n\n- UT-S03-01\n'));
  put(root, SCENARIO_DOC, '# S02 演示\n\n## 场景目标\n\n原目标。\n');
  put(root, 'tools/dtc-runner.mjs', RUNNER);
  editConfig(root, cfg => {
    cfg.verify = {
      ...(cfg.verify ?? {}), result_path: 'logos/resources/verify/test-results.jsonl', sandbox_mode: 'off',
      pre_run_command: 'node tools/dtc-runner.mjs', layered: { enabled: true },
    };
  });
  git(root, ['init', '-q']);
  commitAll(root, 'dtc fixture');
  const outside = tempDir(`${tag}-out`);
  const fx = { tag, root, log: join(outside, 'calls.jsonl'), dir: join(root, 'logos/changes', PROPOSAL) };
  CASE_FIXTURES.push(fx);
  await cliExpect(entry, root, ['change', PROPOSAL], 0, null);
  writeFileSync(join(fx.dir, 'proposal.md'), proposalMd(scenarios));
  writeFileSync(join(fx.dir, 'tasks.md'), [
    '# 实现任务', '', '## [delta] 规格变更', '', ...Object.keys(deltas).map(rel => `- [x] 产出 delta 到 \`deltas/${rel}\`。`), '', '## [code] 代码实现', '',
  ].join('\n'));
  for (const [rel, content] of Object.entries(deltas)) put(fx.dir, `deltas/${rel}`, content);
  if (merged) {
    await cliExpect(entry, root, ['merge', PROPOSAL], 0, null);
    if (!existsSync(join(fx.dir, 'SPEC_MERGED'))) throw new Error('被测 CLI merge 未写出 SPEC_MERGED');
    commitAll(root, 'dtc merged');
  }
  return fx;
}
const markerOf = fx => readJson(join(fx.dir, 'SPEC_MERGED'));
const editMarker = (fx, mutate) => { const marker = markerOf(fx); mutate(marker); writeFileSync(join(fx.dir, 'SPEC_MERGED'), `${JSON.stringify(marker, null, 2)}\n`); };
const tamperChangeSet = fx => editMarker(fx, m => { m.test_change_set.sha256 = `sha256:${'0'.repeat(64)}`; });

/** 执行被测 CLI 的 verify 并整体解析信封；返回 data、退出码与调用记录。 */
export async function verifyRun(entry, fx, expectExit) {
  rmSync(fx.log, { force: true });
  const r = await cliExpect(entry, fx.root, ['verify', '--format', 'json'], expectExit, 'stdout', fxEnv(fx));
  return { status: r.status, data: r.envelope.data, calls: readCalls(fx.log), raw: `${r.stdout}${r.stderr}` };
}
const scenariosOf = data => data?.layers?.affected?.scenarios ?? null;
const scenarioEvidence = run => [`scenarios=${JSON.stringify(scenariosOf(run.data))}`, `expansion=${JSON.stringify(run.data?.layers?.expansion ?? null)}`, `executed=${JSON.stringify(executedOf(run.calls))}`, `gate=${JSON.stringify(run.data?.gate ?? null)}`];
const onlyDelta = ids => ids.map(id => ({ id, sources: ['delta'] }));

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

/**
 * 失败证据（规格「失败处置：保留信封、SPEC_MERGED 与调用记录」）：把本用例已产生的原始材料逐项写成证据行——
 * 每个夹具的合并标记全文与逐次调用记录（入口收到的清单、实际执行的用例），以及每条被测 CLI 命令的完整输出。
 * 文件不存在时明确记录缺失（未合并 / 测试入口未被调用）。必须在清理夹具之前调用。
 */
export function failureArtifacts(fixtures = CASE_FIXTURES, trace = CASE_TRACE) {
  const lines = [];
  for (const fx of fixtures) {
    const marker = join(fx.dir, 'SPEC_MERGED');
    lines.push(`artifact.fixture[${fx.tag}].spec_merged=${existsSync(marker) ? readFileSync(marker, 'utf8') : '（缺失：提案未合并，没有 SPEC_MERGED）'}`);
    lines.push(`artifact.fixture[${fx.tag}].calls=${existsSync(fx.log) ? readFileSync(fx.log, 'utf8') : '（缺失：测试入口未被调用，没有调用记录）'}`);
  }
  trace.forEach((c, i) => {
    // 成功的 init 只是建夹具的噪声，不写入；失败的 init（非预期退出、被信号终止或超时）照常保留完整输出
    if (c.args[0] === 'init' && c.status === 0 && !c.signal && !c.timedOut) return;
    lines.push(`artifact.command[${i}]=${JSON.stringify({ args: c.args, status: c.status, signal: c.signal, timed_out: c.timedOut, stdout: c.stdout, stderr: c.stderr })}`);
  });
  return lines;
}
/** 删除本进程建立的全部一次性目录。 */
export function cleanupScopes() {
  while (scopes.length) rmSync(scopes.pop(), { recursive: true, force: true });
}

let DEPLOYED = null;
export const IDENTITY_CASE = 'SMOKE-core-367';

/** 批准版本、全局版本、部署回执与源码候选版本四者必须相等；只有关系式相等而版本不是批准版本时同样判不符。 */
export function approvedVersionProblem(installed, receipt, source, approved = APPROVED_VERSION) {
  const mismatch = [];
  if (installed !== approved) mismatch.push(`全局 --version=${installed}`);
  if (receipt?.candidate_version !== approved) mismatch.push(`部署回执 candidate_version=${receipt?.candidate_version ?? null}`);
  if (source !== approved) mismatch.push(`源码候选版本=${source}`);
  return mismatch.length > 0 ? `装入的版本不是本次批准的目标版本 ${approved}：${mismatch.join('；')}` : null;
}

export const CASES = {
  'SMOKE-core-367': async (entry) => {
    const evidence = [`entry_realpath=${entry}`];
    const problems = [];
    const version = (await cliExpect(entry, tempDir('ver'), ['--version'], 0, null)).stdout.trim();
    let source = null;
    try { source = candidateVersion(repoRoot); } catch { /* 下方判定 */ }
    evidence.push(`approved=${APPROVED_VERSION}`, `version=${version}`, `source_candidate=${source}`, `receipt_candidate=${DEPLOYED.candidate_version}`, `deploy_id=${DEPLOYED.deploy_id}`, `receipt_entry_realpath=${DEPLOYED.entry_realpath}`);
    const ap = approvedVersionProblem(version, DEPLOYED, source);
    if (ap) problems.push(ap);
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
    return { detail: `安装态版本等于批准的 ${APPROVED_VERSION}，并与回执、源码候选版本一致；入口与回执一致，payloadHash 与资源摘要自洽`, evidence };
  },

  'SMOKE-core-368': async (entry) => {
    const fx = await fixtureD(entry, 'mixed', {
      deltas: { ...D_MAIN_S02, 'test/core-S01-test-cases.md': `${dTable(S01, { 'UT-S01-02': 'UT-S01-02 夹具（预期已修改）' })}\n${dMain(['UT-S01-01'])}` },
      scenarios: ['S01'],
    });
    const set = markerOf(fx).test_change_set;
    const run = await verifyRun(entry, fx, 0);
    const evidence = [`changed=${JSON.stringify(set.changed_test_ids)}`, ...scenarioEvidence(run)];
    if (!same(set.changed_test_ids, ['UT-S01-02'])) throw fail('测试变更集应只含 UT-S01-02', evidence);
    if (run.data.gate?.result !== 'PASS') throw fail('gate 应为 PASS', evidence);
    if (!same(scenariosOf(run.data), [{ id: 'S01', sources: ['declared', 'delta'] }])) throw fail('受影响场景应恰为 S01，来源含 declared 与 delta，没有 S02', evidence);
    if (run.data.layers?.expansion?.level !== 'none') throw fail('声明应被正常采信（expansion.level=none）', evidence);
    if (!same(executedOf(run.calls), sorted(['UT-S01-01', 'UT-S01-02', 'UT-S02-01', 'UT-S03-01']))) throw fail('入口应恰好执行 UT-S01-01、UT-S01-02、UT-S02-01、UT-S03-01', evidence);
    return { detail: '混合提案：只改清单的 S02 不并入、其主链路用例被执行；同时改了用例并声明的 S01 来源为 declared 与 delta', evidence };
  },

  'SMOKE-core-369': async (entry) => {
    const fx = await fixtureD(entry, 'remove', { deltas: { 'test/core-S02-test-cases.md': dTable(['UT-S02-01', 'UT-S02-02'], {}, ['UT-JSON-90']) } });
    const set = markerOf(fx).test_change_set;
    const run = await verifyRun(entry, fx, 0);
    const executed = executedOf(run.calls);
    const evidence = [`removed=${JSON.stringify(set.removed_test_ids)}`, `changed=${JSON.stringify(set.changed_test_ids)}`, ...scenarioEvidence(run)];
    if (!same(set.removed_test_ids, ['UT-JSON-90']) || set.changed_test_ids.length !== 0) throw fail('测试变更集应为 removed=[UT-JSON-90]、changed=[]', evidence);
    if (!same(scenariosOf(run.data), onlyDelta(['S02']))) throw fail('受影响场景应恰为 S02，来源 delta', evidence);
    if (!executed.includes('UT-S02-01') || !executed.includes('UT-S02-02')) throw fail('入口应执行 UT-S02-01 与 UT-S02-02', evidence);
    if (executed.some(id => S01.includes(id))) throw fail('入口不应执行 S01 的用例', evidence);
    return { detail: '删除编号不含场景号的 UT-JSON-90：原场景 S02 因 delta 并入', evidence };
  },

  'SMOKE-core-370': async (entry) => {
    const fx = await fixtureD(entry, 'move', { deltas: {
      'test/core-S02-test-cases.md': dTable(['UT-S02-01', 'UT-S02-02'], {}, ['UT-JSON-90']),
      'test/core-S01-test-cases.md': dTable([...S01, 'UT-JSON-90']),
    } });
    const set = markerOf(fx).test_change_set;
    const run = await verifyRun(entry, fx, 0);
    const executed = executedOf(run.calls);
    const evidence = [`changed=${JSON.stringify(set.changed_test_ids)}`, `removed=${JSON.stringify(set.removed_test_ids)}`, ...scenarioEvidence(run)];
    if (!same(set.changed_test_ids, ['UT-JSON-90']) || set.removed_test_ids.length !== 0) throw fail('测试变更集应为 changed=[UT-JSON-90]、removed=[]', evidence);
    if (!same(scenariosOf(run.data), onlyDelta(['S01', 'S02']))) throw fail('受影响场景应恰为 S01 与 S02，来源都是 delta', evidence);
    for (const id of ['UT-S02-01', 'UT-S02-02', 'UT-S01-01', 'UT-S01-02', 'UT-JSON-90']) if (!executed.includes(id)) throw fail(`入口应执行 ${id}`, evidence);
    return { detail: '跨文档移动 UT-JSON-90：移出的 S02 与移入的 S01 都因 delta 并入', evidence };
  },

  'SMOKE-core-371': async (entry) => {
    const fx = await fixtureD(entry, 'scenario-doc', { deltas: { [DELTA_SCENARIO]: '## MODIFIED — 场景目标\n\n新目标。\n', ...D_MAIN_S02 } });
    const run = await verifyRun(entry, fx, 0);
    const executed = executedOf(run.calls);
    const evidence = scenarioEvidence(run);
    if (!same(scenariosOf(run.data), onlyDelta(['S02']))) throw fail('受影响场景应恰为 S02，来源 delta', evidence);
    for (const id of S02) if (!executed.includes(id)) throw fail(`入口应执行 ${id}`, evidence);
    return { detail: '场景文档的 delta 照常让 S02 并入（同场景的测试用例文档只改了清单）', evidence };
  },

  'SMOKE-core-372': async (entry) => {
    const fx = await fixtureD(entry, 'unmerged', { deltas: D_MAIN_S02, merged: false });
    const run = await verifyRun(entry, fx, 0);
    const executed = executedOf(run.calls);
    const evidence = [`spec_merged=${existsSync(join(fx.dir, 'SPEC_MERGED'))}`, `changed=${JSON.stringify(run.data.layers?.changed?.ids ?? null)}`, ...scenarioEvidence(run)];
    if (existsSync(join(fx.dir, 'SPEC_MERGED'))) throw fail('夹具不应有 SPEC_MERGED', evidence);
    if (!same(scenariosOf(run.data), onlyDelta(['S02']))) throw fail('未合并时 S02 应按文件名并入，来源 delta', evidence);
    if (!same(run.data.layers?.changed?.ids, [])) throw fail('本提案用例应为空', evidence);
    for (const id of S02) if (!executed.includes(id)) throw fail(`入口应执行 ${id}`, evidence);
    if (run.raw.includes('test_change_set_invalid')) throw fail('输出中不应出现 test_change_set_invalid', evidence);
    return { detail: '提案未合并：只改清单的 S02 仍按文件名并入', evidence };
  },

  'SMOKE-core-373': async (entry) => {
    const deltas = { ...D_MAIN_S01, ...D_MAIN_S02 };
    const evidence = [];
    const check = (label, run, expectedScenarios, mustRun, mustNotRun) => {
      const executed = executedOf(run.calls);
      evidence.push(`${label}: ${scenarioEvidence(run).join(' ')}`);
      if (!same(scenariosOf(run.data), expectedScenarios)) throw fail(`${label} 受影响场景应为 ${JSON.stringify(expectedScenarios)}`, evidence);
      if (run.data.gate?.result !== 'PASS' || run.data.layers?.expansion?.level !== 'none') throw fail(`${label} 应 PASS 且未扩大`, evidence);
      if (run.raw.includes('test_change_set_invalid')) throw fail(`${label} 输出中不应出现 test_change_set_invalid`, evidence);
      for (const id of mustRun) if (!executed.includes(id)) throw fail(`${label} 入口应执行 ${id}`, evidence);
      for (const id of mustNotRun) if (executed.includes(id)) throw fail(`${label} 入口不应执行 ${id}`, evidence);
      return executed;
    };
    // ① 对照：基线可信，两份只改清单的文档都不并入
    const a = await fixtureD(entry, 'baseline-ok', { deltas });
    const ea = check('①', await verifyRun(entry, a, 0), [], ['UT-S01-01', 'UT-S02-01', 'UT-S03-01'], ['UT-S01-02', 'UT-S02-02', 'UT-JSON-90']);
    if (!same(ea, sorted(['UT-S01-01', 'UT-S02-01', 'UT-S03-01']))) throw fail('① 入口应恰好执行三条主链路用例', evidence);
    // ② 没有合并基线：两份都按文件名并入
    const b = await fixtureD(entry, 'baseline-missing', { deltas });
    editMarker(b, m => { delete m.merge_baseline; });
    check('②', await verifyRun(entry, b, 0), onlyDelta(['S01', 'S02']), ['UT-S01-02', 'UT-S02-02', 'UT-JSON-90'], []);
    // ③ 只有 S02 的合并前内容读不回：S02 按文件名并入，S01 仍被排除
    const c = await fixtureD(entry, 'baseline-blob', { deltas });
    editMarker(c, m => {
      const target = m.merge_baseline.targets.find(t => t.path === `${TEST_DIR}/core-S02-test-cases.md`);
      if (!target?.before) throw new Error('合并基线中缺少 core-S02-test-cases.md 的合并前记录');
      target.before.git_blob = '0123456789abcdef0123456789abcdef01234567';
    });
    check('③', await verifyRun(entry, c, 0), onlyDelta(['S02']), ['UT-S02-02', 'UT-JSON-90'], ['UT-S01-02']);
    return { detail: '基线可信时两份只改清单的文档都不并入；没有基线时都按文件名并入；只有 S02 读不回时仅 S02 并入', evidence };
  },

  'SMOKE-core-374': async (entry) => {
    const evidence = [];
    // ①② 普通提案：变更集无效 / 正式目标被改动 → 门禁 FAIL，S02 按文件名并入
    const arms = [
      ['①', async fx => tamperChangeSet(fx)],
      ['②', async fx => { nodeFs.appendFileSync(join(fx.root, TEST_DIR, 'core-S02-test-cases.md'), '\n合并后追加的一行文字。\n'); commitAll(fx.root, 'drift'); }],
    ];
    for (const [label, mutate] of arms) {
      const fx = await fixtureD(entry, `invalid-${label === '①' ? 'a' : 'b'}`, { deltas: D_MAIN_S02 });
      await mutate(fx);
      const run = await verifyRun(entry, fx, 1);
      evidence.push(`${label}: ${scenarioEvidence(run).join(' ')}`);
      if (run.data.gate?.result !== 'FAIL' || run.data.gate?.reason !== 'test_change_set_invalid') throw fail(`${label} 门禁应以 test_change_set_invalid 判 FAIL`, evidence);
      if (!same(scenariosOf(run.data), onlyDelta(['S02']))) throw fail(`${label} S02 应按文件名并入，来源 delta`, evidence);
      if (existsSync(join(fx.dir, 'VERIFY_PASS'))) throw fail(`${label} 不应写入 VERIFY_PASS`, evidence);
    }
    // ③ 多切片提案：切片清单暂停出口先行返回
    const fx = await fixtureD(entry, 'invalid-slices', { deltas: { ...D_MAIN_S02, 'test/core-S01-test-cases.md': dTable([...S01, 'UT-S01-03', 'UT-S01-04']) } });
    const input = { slices: ['UT-S01-03', 'UT-S01-04'].map((id, i) => ({
      slice_id: `slice-${i === 0 ? 'a' : 'b'}`, task_text: `切片${i + 1}：能力（覆盖 ${id}）`,
      owned_test_ids: [id], runner_selectors: [id], spec_targets: [`${TEST_DIR}/core-S01-test-cases.md`],
    })) };
    const rel = `logos/changes/${PROPOSAL}/slices.json`;
    put(fx.root, rel, JSON.stringify(input, null, 2));
    await cliExpect(entry, fx.root, ['slice', 'plan', '--file', rel, '--format', 'json'], 0, null);
    if (!existsSync(join(fx.dir, 'TEST_SLICE_MANIFEST.json'))) throw fail('③ 被测 CLI slice plan 未写出 TEST_SLICE_MANIFEST.json', evidence);
    const tracked = ['VERIFY_PASS', 'VERIFY_FAIL', 'SLICE_CHECKPOINTS.jsonl', 'LOOP_ITERS', 'tasks.md'];
    const snapshot = () => tracked.map(name => sha(join(fx.dir, name)));
    const before = snapshot();
    tamperChangeSet(fx);
    const run = await verifyRun(entry, fx, 2);
    const d = run.data;
    evidence.push(`③: reason=${d?.reason ?? null} human_action_required=${d?.slice_verification_state?.human_action_required ?? null} has_gate=${'gate' in (d ?? {})} has_layers=${'layers' in (d ?? {})} calls=${run.calls.length} markers_unchanged=${same(snapshot(), before)}`);
    if (d?.reason !== 'test-slice-manifest-invalid') throw fail('③ reason 应为 test-slice-manifest-invalid', evidence);
    if (d?.slice_verification_state?.human_action_required !== true) throw fail('③ human_action_required 应为 true', evidence);
    if ('gate' in d || 'layers' in d) throw fail('③ 响应中不应有 gate 与 layers', evidence);
    if (run.calls.length !== 0) throw fail('③ 测试入口不应被调用', evidence);
    if (!same(snapshot(), before)) throw fail('③ 验收标记、checkpoint、循环计数或 tasks.md 被改动', evidence);
    return { detail: '变更集无效：普通提案以 test_change_set_invalid 判 FAIL 且 S02 按文件名并入；多切片提案走切片清单暂停出口、零推进', evidence };
  },
};
export const DELTA_TOUCHED_SMOKE_IDS = Object.keys(CASES);

/**
 * 逐例分派。安装态身份用例（SMOKE-core-367）是其余用例的前置条件：它失败时保留身份校验明细，
 * 其余用例一律不执行，各写一条「身份校验失败、用例未执行」的失败记录——装上的不是本次候选时，
 * 行为用例即使碰巧通过也不能记为本次部署的通过（规格「失败处置：回流部署，不继续后续用例的通过判定」）。
 */
export async function dispatchCases(entry, deployed, cases = CASES) {
  DEPLOYED = deployed;
  const out = new Map();
  const runOne = async id => {
    const started = Date.now();
    CASE_TRACE.length = 0;
    CASE_FIXTURES.length = 0;
    try {
      const r = await cases[id](entry);
      out.set(id, { status: 'pass', detail: r.detail, evidence: [`entry=${entry}`, ...r.evidence], duration_ms: Date.now() - started });
    } catch (error) {
      // 失败时在夹具被清理之前收集原始材料；收集本身出错不得掩盖用例的失败
      let artifacts = [];
      try { artifacts = failureArtifacts(); } catch (e) { artifacts = [`artifact.error=${e instanceof Error ? e.message : String(e)}`]; }
      out.set(id, { status: 'fail', detail: error instanceof Error ? error.message : String(error), evidence: [`entry=${entry}`, ...(error?.evidence ?? []), ...artifacts], duration_ms: Date.now() - started });
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
    console.log(`测试用例文档按用例变化判断触及安装态 smoke 不适用于环境 ${TARGET_ENV}，已写显式 skip`);
    process.exit(0);
  }
  // ② 适用窗口
  if (activeChange() !== SLUG && process.env.OPENLOGOS_DTC_SMOKE !== '1') {
    exitNotApplicable(OWNED, {
      reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_DTC_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_DTC_SMOKE'], environment: ENVIRONMENT, repoRoot,
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
    cleanupScopes();
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
