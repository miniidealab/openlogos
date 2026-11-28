#!/usr/bin/env node
/**
 * SMOKE-core-375～SMOKE-core-379：0.16.30 验收期间 git 调用只读本地的**安装态**取证（提案 verify-git-local-only）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.30 验收期间 git 调用只读本地安装态 smoke（SMOKE-core-375～379）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.30 本机测试环境发布（verify-git-local-only）」。
 *
 *   - SMOKE-core-375：安装态版本与制品身份（批准版本、全局版本、部署回执、源码候选版本四者相等）。
 *   - SMOKE-core-376：本地缺文件内容时不连接远端，扩大到全量后按实际结果判定。
 *   - SMOKE-core-377：本地缺起点提交对象时不连接远端，判为起点不可达（不执行差异计算）。
 *   - SMOKE-core-378：发布查询指定的提交本地不存在时不连接远端并照旧拒绝。
 *   - SMOKE-core-379：对象齐全时验收范围与结果不变。
 *
 * **入口判断次序**（规格「四、自动化与证据要求」）：
 *   ① 宿主已指定 OPENLOGOS_SMOKE_ENV 且不是 test → 为全部 owned ID 写带原因的显式 skip（env-not-test），以 0 退出；
 *   ② 适用窗口：活跃变更为本提案，或 OPENLOGOS_VGL_SMOKE=1；窗口外写 skip；
 *   ③ 部署前置：先读部署账本——没有本提案在 test 的成功 deploy 才写显式 skip；有记录时须与本机回执同一 deploy_id、
 *      result=done、environment=test，源码候选版本须可读且等于回执 candidate_version 与 APPROVED_VERSION、
 *      entry_realpath 为非空绝对路径，否则 fail。
 * 全局 CLI 子进程在独立进程组中运行并限时 120 秒；要求解析信封的步骤以 --format json 调用并对输出整体解析。
 * 「远端有没有收到请求」读远端接入记录，「对象库有没有新增」比较快照，「某个 git 调用有没有发生」读 git 调用记录
 *（GIT_TRACE，由 git 自己记下，不依赖 PATH 查找与可执行脚本），
 * 「实际执行了哪些用例」读调用记录，都不从 CLI 输出推断。每条行为用例先执行对照步骤（不加保护读取同一个缺失对象）
 * 证明远端接入记录有区分力，证明不了判 fail。用例失败时，在清理夹具之前把完整命令输出（含失败的 init）、远端接入记录、
 * git 调用记录、对象库快照与逐次调用记录写入该用例的失败证据；被测 CLI 异常退出时对象库终态照样采集。
 * 远端是本机裸仓库，不配置网络远端、不联网；全部写入只在一次性目录内，结束即删除；不触碰用户级 git 配置；
 * 对全局安装态只读。环境变量一律使用 OPENLOGOS_VGL_ 前缀。
 */
import { spawn, spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable, recordSmokeNotApplicable } from './lib/smoke-not-applicable.mjs';
import { assetManifestVerdict, candidateVersion, installedVersionProblem, parseEnvelope, receiptEntryProblem, writeAll } from './smoke-runner-discovery.js';
import { entryCommand, entryIdentityProblems, installedLayout } from './lib/public-release-checks.mjs';

export const SLUG = 'verify-git-local-only';
/** 本次批准的目标版本（需求 AC-VERIFY-TIER-26）：装入其他版本号时不算达成。 */
export const APPROVED_VERSION = '0.16.30';
export const OWNED = ['SMOKE-core-375', 'SMOKE-core-376', 'SMOKE-core-377', 'SMOKE-core-378', 'SMOKE-core-379'];
const ENVIRONMENT = 'local-global-temp-project';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_VGL_SMOKE_CHILD_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 && v < 120_000 ? v : 120_000;
})();

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
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
const tempDir = tag => { const d = realpathSync(mkdtempSync(join(tmpdir(), `openlogos-smoke-vgl-${tag}-`))); scopes.push(d); return d; };
function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
/** 会把 git 的读写引到工作目录之外的环境变量。 */
export const GIT_LOCATION_ENV_KEYS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR',
  'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_CEILING_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS',
];
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_VGL_')) delete env[key];
    if (key.startsWith('OPENLOGOS_VERIFY_') || key === 'OPENLOGOS_STDIO_TRACE' || key.startsWith('OPENLOGOS_GUARD_')) delete env[key];
    // 宿主的仓库定位、工作树、索引、对象库与配置注入变量一律不带入：否则即使工作目录是一次性项目，
    // 夹具的 git 与被测 CLI 也可能把对象、索引或配置写进宿主仓库（规格「二、执行边界」）
    if (GIT_LOCATION_ENV_KEYS.includes(key) || /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key) || key === 'CLAUDE_PROJECT_DIR') delete env[key];
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
 * 记录型入口：从已合并测试规格取全部 UT/ST；调用记录写到项目外 OPENLOGOS_VGL_LOG（收到的清单、实际执行的用例）；
 * 收到清单时只执行、只上报清单内的用例；OPENLOGOS_VGL_FAIL（逗号分隔的用例 ID）中的用例写 fail 并以非零状态退出，其余 pass。
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
const failing = String(process.env.OPENLOGOS_VGL_FAIL || '').split(',').filter(Boolean);
const log = process.env.OPENLOGOS_VGL_LOG;
if (log) fs.appendFileSync(log, JSON.stringify({ eligible, executed }) + '\\n');
const out = 'logos/resources/verify/test-results.jsonl';
fs.mkdirSync('logos/resources/verify', { recursive: true });
const now = new Date().toISOString();
let anyFail = false;
fs.writeFileSync(out, executed.map(id => {
  const fail = failing.includes(id);
  if (fail) anyFail = true;
  return JSON.stringify(fail ? { id, status: 'fail', scenario: id.split('-')[1], timestamp: now, error: 'vgl fixture failure' } : { id, status: 'pass', scenario: id.split('-')[1], timestamp: now });
}).join('\\n') + (executed.length ? '\\n' : ''));
process.exit(anyFail ? 1 : 0);
`;
const table = ids => `${['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具 |`)].join('\n')}\n`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = list => [...list].sort();
const CONFIG = 'logos/logos.config.json';
const YAML = 'logos/logos-project.yaml';
const PROPOSAL = 'vgl-smoke';
const TEST_DIR = 'logos/resources/test';
const ALL_IDS = ['UT-S01-01', 'UT-S01-02', 'UT-S02-01', 'UT-S02-02', 'UT-S03-01', 'UT-S03-02'];
const P_IDS = ['UT-S02-01', 'UT-S02-02', 'UT-S03-01'];
const MISSING_NOTE = '本地缺少对象，验收不从远端取回';

const GIT_ID = { GIT_AUTHOR_NAME: 'vgl', GIT_AUTHOR_EMAIL: 'vgl@example.invalid', GIT_COMMITTER_NAME: 'vgl', GIT_COMMITTER_EMAIL: 'vgl@example.invalid' };
/** 夹具自己的 git 操作与对照步骤：不带任何约束变量。 */
function git(root, args, { allowFail = false } = {}) {
  const env = { ...cleanEnv(), ...GIT_ID };
  for (const key of ['GIT_ALLOW_PROTOCOL', 'GIT_NO_LAZY_FETCH', 'GIT_TERMINAL_PROMPT']) delete env[key];
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 200)}`);
  return { status: r.status, stdout: (r.stdout || '').trim() };
}
const commitAll = (root, message) => { git(root, ['add', '-A']); git(root, ['commit', '-q', '--allow-empty', '-m', message]); return git(root, ['rev-parse', 'HEAD']).stdout; };
const readJson = path => JSON.parse(readFileSync(path, 'utf8'));
const editConfig = (root, mutate) => { const path = join(root, CONFIG); const cfg = readJson(path); mutate(cfg); writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`); };
const readLines = path => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);
const readCalls = log => readLines(log).map(l => JSON.parse(l));
const executedOf = calls => sorted(Array.from(new Set(calls.flatMap(c => c.executed))));
const fail = (message, evidence) => Object.assign(new Error(message), { evidence });

/**
 * 按 POSIX shell 规则引用一个路径：单引号包裹，内部的单引号转义；反斜杠统一写成正斜杠
 *（git 在 Windows 上经其自带的 sh 执行这条命令，正斜杠路径在两边都有效）。
 */
export function shellQuote(path) {
  return `'${String(path).replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
}

/** 对象库快照：松散对象与 pack 目录的文件清单。 */
export function objectSnapshot(root) {
  const objects = join(root, '.git/objects');
  const out = [];
  for (const entry of nodeFs.readdirSync(objects, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'info') continue;
    for (const file of nodeFs.readdirSync(join(objects, entry.name))) out.push(`${entry.name}/${file}`);
  }
  return out.sort();
}

/**
 * 夹具 G（分层）：经被测 CLI init 建立项目后写入——单模块 core launched、verify.layered.enabled 为 true；已合并测试规格
 * core-S01（UT-S01-01、02）、core-S02（UT-S02-01、02）、core-S03（UT-S03-01、02，主链路小节列 UT-S03-01）；已跟踪的 src/core.ts。
 * 全部内容提交后（opts.proposal 不为 false 时）经被测 CLI `change vgl-smoke` 建立活跃提案，声明 scenarios 为 S02
 * （写成含 id 与非空 reason 的对象），并在提案期间修改 src/core.ts。
 * 随后登记一个可以按需提供对象的本机远端（只配置 URL 与取回过滤器，显式配置 protocol.file.allow=always），
 * 远端一侧每收到一次请求就在项目外追加一行远端接入记录。被测 CLI 的 git 调用由 git 自己经 GIT_TRACE 记到项目外的文件
 *（不依赖 PATH 查找与可执行脚本，Windows 上同样可用）。
 */
export async function fixtureG(entry, tag, opts = {}) {
  const root = tempDir(tag);
  await cliExpect(entry, root, ['init', `vgl-${tag}`, '--locale', 'zh', '--ai-tool', 'claude-code'], 0, null);
  put(root, YAML, 'project:\n  name: "vgl-smoke"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  put(root, `${TEST_DIR}/core-S01-test-cases.md`, table(['UT-S01-01', 'UT-S01-02']));
  put(root, `${TEST_DIR}/core-S02-test-cases.md`, table(['UT-S02-01', 'UT-S02-02']));
  put(root, `${TEST_DIR}/core-S03-test-cases.md`, `${table(['UT-S03-01', 'UT-S03-02'])}\n## 主链路用例\n\n- UT-S03-01\n`);
  put(root, 'src/core.ts', 'export const core = 1;\n');
  put(root, 'tools/vgl-runner.mjs', RUNNER);
  editConfig(root, cfg => {
    cfg.verify = {
      ...(cfg.verify ?? {}), result_path: 'logos/resources/verify/test-results.jsonl', sandbox_mode: 'off',
      pre_run_command: 'node tools/vgl-runner.mjs', layered: { enabled: true },
    };
  });
  git(root, ['init', '-q']);
  const base = commitAll(root, 'vgl fixture');
  if (opts.proposal !== false) {
    await cliExpect(entry, root, ['change', PROPOSAL], 0, null);
    const path = join(root, 'logos/changes', PROPOSAL, 'proposal.md');
    const content = readFileSync(path, 'utf8');
    // 声明的写法：场景编号写成含 id 与非空 reason 的对象
    const yaml = 'schema: openlogos/affected-scenarios@1\nassessment: assessed\nshared_change: false\nscenarios:\n  - id: S02\n    reason: 夹具声明 S02 受波及\n';
    const next = content.replace(/(## 受影响场景\s*\n+```yaml\n)[\s\S]*?(```)/, (_m, open, close) => `${open}${yaml}${close}`);
    if (next === content) throw new Error('proposal.md 中找不到可改写的「受影响场景」段');
    writeFileSync(path, next);
    put(root, 'src/core.ts', 'export const core = 2;\n');
  }
  // 远端与远端接入记录
  // 目录名带空格：远端命令路径的引用在每次运行中都被真实验证
  const outside = tempDir(`${tag} out`);
  const origin = join(outside, 'origin.git');
  git(root, ['clone', '-q', '--bare', root, origin]);
  git(origin, ['config', 'uploadpack.allowfilter', 'true']);
  git(origin, ['config', 'uploadpack.allowanysha1inwant', 'true']);
  const remoteLog = join(outside, 'remote-access.log');
  const uploadPack = join(outside, 'upload-pack-recorder.sh');
  writeFileSync(uploadPack, `#!/bin/sh\necho "upload-pack $*" >> ${shellQuote(remoteLog)}\nexec git-upload-pack "$@"\n`);
  nodeFs.chmodSync(uploadPack, 0o755);
  git(root, ['remote', 'add', 'origin', `file://${origin}`]);
  git(root, ['config', 'remote.origin.partialclonefilter', 'blob:none']);
  git(root, ['config', 'protocol.file.allow', 'always']);
  // remote.<name>.uploadpack 的取值会被拼进 shell 命令：路径必须按 shell 规则引用，否则含空格的路径在空格处被拆开
  git(root, ['config', 'remote.origin.uploadpack', shellQuote(uploadPack)]);
  const gitLog = join(outside, 'git-trace.log');
  const fx = { tag, root, base, outside, origin, remoteLog, gitLog, log: join(outside, 'calls.jsonl'), snapshotBefore: null, snapshotAfter: null };
  CASE_FIXTURES.push(fx);
  return fx;
}
const remoteHits = fx => readLines(fx.remoteLog).length;
/** 被测 CLI 运行期间进程树里的每一次 git 调用（取自 GIT_TRACE；参数里的单引号去掉）。 */
const gitCalls = fx => readLines(fx.gitLog).flatMap(line => { const m = /trace: built-in: git (.*)$/.exec(line); return m ? [m[1].trim().replace(/'/g, '')] : []; });

/**
 * 对照步骤：不加任何保护、直接读取同一个缺失对象，证明远端接入记录有区分力（记录中出现条目且对象被取回）；
 * 随后恢复缺失状态、清空记录。证明不了时判该用例 fail。
 */
function proveRecorderAndRestore(fx, missingId) {
  const before = objectSnapshot(fx.root);
  rmSync(fx.remoteLog, { force: true });
  const fetched = git(fx.root, ['cat-file', '-e', missingId], { allowFail: true }).status === 0;
  const hits = remoteHits(fx);
  const keep = new Set(before);
  for (const rel of objectSnapshot(fx.root)) if (!keep.has(rel)) rmSync(join(fx.root, '.git/objects', rel), { force: true });
  rmSync(fx.remoteLog, { force: true });
  if (!fetched || hits === 0) throw fail(`对照步骤未能证明远端接入记录有区分力：不加保护读取 ${missingId} 时 fetched=${fetched} hits=${hits}`, []);
  if (!same(objectSnapshot(fx.root), before)) throw fail('对照步骤之后未能恢复缺失状态', []);
  fx.snapshotBefore = before;
}

/** 删除某个已跟踪文件在提案起点中的内容对象，并完成对照步骤。 */
function makeContentMissing(fx, file) {
  const blob = git(fx.root, ['rev-parse', `${fx.base}:${file}`]).stdout;
  const loose = join(fx.root, '.git/objects', blob.slice(0, 2), blob.slice(2));
  if (!existsSync(loose)) throw new Error(`对象 ${blob} 不是松散对象，无法制造缺失`);
  rmSync(loose);
  proveRecorderAndRestore(fx, blob);
  return blob;
}

/** 在远端造一个本地没有的提交，并完成对照步骤。 */
function makeRemoteOnlyCommit(fx) {
  const work = join(fx.outside, 'remote-only-work');
  git(fx.outside, ['clone', '-q', fx.origin, work]);
  git(work, ['commit', '-q', '--allow-empty', '-m', 'remote only']);
  const commit = git(work, ['rev-parse', 'HEAD']).stdout;
  git(work, ['push', '-q', 'origin', 'HEAD:refs/heads/remote-only']);
  proveRecorderAndRestore(fx, commit);
  return commit;
}

/** 执行被测 CLI（git 调用经 GIT_TRACE 记录）；返回退出码、原始输出、信封（stdout 可整体解析时）与各项记录。 */
export async function runCli(entry, fx, args, expectExit, extraEnv = {}) {
  rmSync(fx.log, { force: true });
  rmSync(fx.gitLog, { force: true });
  let r;
  try {
    r = await cliExpect(entry, fx.root, args, expectExit, null, { GIT_TRACE: fx.gitLog, OPENLOGOS_VGL_LOG: fx.log, ...extraEnv });
  } finally {
    // 被测 CLI 已经运行过（即使退出码不符、超时或被信号终止）：对象库终态照样采集，原始失败原样抛出
    try { fx.snapshotAfter = objectSnapshot(fx.root); } catch { /* 采集失败不掩盖原始失败 */ }
  }
  let envelope = null;
  try { envelope = JSON.parse(r.stdout.trim()); } catch { /* 错误信封在 stderr，或不是 JSON */ }
  let errorEnvelope = null;
  try { errorEnvelope = JSON.parse(r.stderr.trim()); } catch { /* 没有错误信封 */ }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, envelope, errorEnvelope, data: envelope?.data ?? null, calls: readCalls(fx.log) };
}
const expansionReason = (data, code) => (data?.layers?.expansion?.reasons ?? []).find(r => r.code === code) ?? null;
const baseEvidence = (fx, run) => [
  `expansion=${JSON.stringify(run.data?.layers?.expansion ?? null)}`, `gate=${JSON.stringify(run.data?.gate ?? null)}`,
  `executed=${JSON.stringify(executedOf(run.calls))}`, `remote_hits=${remoteHits(fx)}`,
  `objects_unchanged=${same(fx.snapshotAfter, fx.snapshotBefore ?? fx.snapshotAfter)}`,
];
/** 不连接远端、对象库不变：两条都必须成立。 */
function assertLocalOnly(fx, label, evidence) {
  if (remoteHits(fx) !== 0) throw fail(`${label} 远端收到了请求（远端接入记录非空）`, evidence);
  if (fx.snapshotBefore && !same(fx.snapshotAfter, fx.snapshotBefore)) throw fail(`${label} 本地对象库有变化`, evidence);
}

/**
 * 失败证据（规格「四、自动化与证据要求」）：把本用例已产生的原始材料逐项写成证据行——本用例已执行的每条被测 CLI 命令的
 * 完整输出（含 init）、每个夹具的远端接入记录、git 调用记录、执行前后的对象库快照与逐次调用记录。文件不存在时明确记录缺失。
 * 必须在清理夹具之前调用。
 */
export function failureArtifacts(fixtures = CASE_FIXTURES, trace = CASE_TRACE) {
  const lines = [];
  const raw = (path, missing) => (existsSync(path) ? readFileSync(path, 'utf8') : missing);
  for (const fx of fixtures) {
    lines.push(`artifact.fixture[${fx.tag}].remote_access=${raw(fx.remoteLog, '（缺失：远端没有收到任何请求）')}`);
    lines.push(`artifact.fixture[${fx.tag}].git_calls=${raw(fx.gitLog, '（缺失：被测 CLI 没有调用 git，或尚未执行）')}`);
    lines.push(`artifact.fixture[${fx.tag}].calls=${raw(fx.log, '（缺失：测试入口未被调用，没有调用记录）')}`);
    lines.push(`artifact.fixture[${fx.tag}].objects_before=${fx.snapshotBefore ? JSON.stringify(fx.snapshotBefore) : '（缺失：没有制造缺失，未取快照）'}`);
    lines.push(`artifact.fixture[${fx.tag}].objects_after=${fx.snapshotAfter ? JSON.stringify(fx.snapshotAfter) : '（缺失：被测 CLI 尚未执行）'}`);
  }
  trace.forEach((c, i) => {
    // 本用例已经执行的每一条被测 CLI 命令都保留完整输出（含成功的 init）
    lines.push(`artifact.command[${i}]=${JSON.stringify({ args: c.args, status: c.status, signal: c.signal, timed_out: c.timedOut, stdout: c.stdout, stderr: c.stderr })}`);
  });
  return lines;
}
/** 删除本进程建立的全部一次性目录。 */
export function cleanupScopes() {
  while (scopes.length) rmSync(scopes.pop(), { recursive: true, force: true });
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
export const IDENTITY_CASE = 'SMOKE-core-375';

/** 批准版本、全局版本、部署回执与源码候选版本四者必须相等；只有关系式相等而版本不是批准版本时同样判不符。 */
export function approvedVersionProblem(installed, receipt, source, approved = APPROVED_VERSION) {
  const mismatch = [];
  if (installed !== approved) mismatch.push(`全局 --version=${installed}`);
  if (receipt?.candidate_version !== approved) mismatch.push(`部署回执 candidate_version=${receipt?.candidate_version ?? null}`);
  if (source !== approved) mismatch.push(`源码候选版本=${source}`);
  return mismatch.length > 0 ? `装入的版本不是本次批准的目标版本 ${approved}：${mismatch.join('；')}` : null;
}

export const CASES = {
  'SMOKE-core-375': async (entry) => {
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

  'SMOKE-core-376': async (entry) => {
    const evidence = [];
    // ① 全部 pass；② 提案集合之外的 UT-S03-02 实际会失败，其余全部 pass。两臂都没有其他门禁原因
    for (const [label, failing, exit, gate] of [['①', '', 0, { result: 'PASS', reason: null }], ['②', 'UT-S03-02', 1, { result: 'FAIL', reason: 'failed_cases' }]]) {
      const fx = await fixtureG(entry, `content-${label === '①' ? 'pass' : 'fail'}`);
      makeContentMissing(fx, 'src/core.ts');
      const run = await runCli(entry, fx, ['verify', '--format', 'json'], exit, { OPENLOGOS_VGL_FAIL: failing });
      const ev = baseEvidence(fx, run).map(e => `${label} ${e}`);
      evidence.push(...ev);
      assertLocalOnly(fx, label, evidence);
      const reason = expansionReason(run.data, 'base_ref_unavailable');
      if (run.data?.layers?.expansion?.level !== 'full' || !reason) throw fail(`${label} 应扩大到全量，原因含 base_ref_unavailable`, evidence);
      if (!String(reason.detail).includes('diff_failed') || !String(reason.detail).includes(MISSING_NOTE)) throw fail(`${label} detail 应含 diff_failed 与「${MISSING_NOTE}」：${reason.detail}`, evidence);
      if (!same(executedOf(run.calls), sorted(ALL_IDS))) throw fail(`${label} 入口应执行全部 6 条用例`, evidence);
      if (run.data.gate?.result !== gate.result || (gate.reason !== null && run.data.gate?.reason !== gate.reason)) throw fail(`${label} 门禁应为 ${JSON.stringify(gate)}`, evidence);
    }
    return { detail: '本地缺文件内容：没有连接远端、对象库不变，扩大到全量；全部通过判 PASS，多跑出来的用例失败判 failed_cases', evidence };
  },

  'SMOKE-core-377': async (entry) => {
    const fx = await fixtureG(entry, 'base-missing');
    const commit = makeRemoteOnlyCommit(fx);
    const guardPath = join(fx.root, 'logos/.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ ...readJson(guardPath), baseRef: commit }, null, 2));
    const run = await runCli(entry, fx, ['verify', '--format', 'json'], 0);
    const calls = gitCalls(fx);
    const probed = calls.some(c => c.startsWith(`cat-file -e ${commit}`));
    const diffed = calls.some(c => c.startsWith('diff') && c.includes(commit));
    if (calls.length === 0) throw fail('git 调用记录为空，无法确认调用情况', [`git_trace=${fx.gitLog}`]);
    const reason = expansionReason(run.data, 'base_ref_unavailable');
    const evidence = [...baseEvidence(fx, run), `detail=${reason?.detail ?? null}`, `probed_base=${probed}`, `diffed_base=${diffed}`];
    assertLocalOnly(fx, '', evidence);
    if (run.data?.layers?.expansion?.level !== 'full' || !reason) throw fail('应扩大到全量，原因含 base_ref_unavailable', evidence);
    if (!String(reason.detail).includes('base_ref_unreachable') || String(reason.detail).includes('diff_failed')) throw fail('detail 应含 base_ref_unreachable、不含 diff_failed', evidence);
    if (!probed) throw fail('git 调用记录中应有检查该起点提交的调用', evidence);
    if (diffed) throw fail('不应以该起点为参数执行差异计算', evidence);
    if (!same(executedOf(run.calls), sorted(ALL_IDS))) throw fail('入口应执行全部 6 条用例', evidence);
    if (run.data.gate?.result !== 'PASS') throw fail('gate 应为 PASS', evidence);
    return { detail: '本地缺起点提交对象：没有连接远端、对象库不变，判为起点不可达，没有执行差异计算', evidence };
  },

  'SMOKE-core-378': async (entry) => {
    const fx = await fixtureG(entry, 'release-check', { proposal: false });
    const commit = makeRemoteOnlyCommit(fx);
    const run = await runCli(entry, fx, ['verify', '--release', '--check', '--commit', commit, '--format', 'json'], 2);
    const code = run.errorEnvelope?.error?.code ?? null;
    const evidence = [`error=${code}`, `remote_hits=${remoteHits(fx)}`, `objects_unchanged=${same(fx.snapshotAfter, fx.snapshotBefore)}`, `runner_calls=${run.calls.length}`];
    assertLocalOnly(fx, '', evidence);
    if (!run.errorEnvelope || run.errorEnvelope.command !== 'verify' || code !== 'RELEASE_CHECK_COMMIT_INVALID') throw fail('stderr 应为 verify 的错误信封，error.code 为 RELEASE_CHECK_COMMIT_INVALID', evidence);
    if (run.calls.length !== 0) throw fail('测试入口不应被调用', evidence);
    return { detail: '发布查询指定的提交本地不存在：没有连接远端、对象库不变，照旧以 RELEASE_CHECK_COMMIT_INVALID 拒绝', evidence };
  },

  'SMOKE-core-379': async (entry) => {
    const fx = await fixtureG(entry, 'complete');
    // 阳性对照：同一夹具的远端上造一个与验收输入无关、只存在于远端的提交，先不加保护取回一次证明远端接入记录
    // 能观测到访问，再还原（被测提交与文件内容仍然齐全）；证明不了判 fail
    makeRemoteOnlyCommit(fx);
    const run = await runCli(entry, fx, ['verify', '--format', 'json'], 0);
    const evidence = baseEvidence(fx, run);
    if (run.data?.gate?.result !== 'PASS') throw fail('gate 应为 PASS', evidence);
    if (run.data?.layers?.expansion?.level !== 'none') throw fail('对象齐全时不应扩大（expansion.level=none）', evidence);
    if (!same(executedOf(run.calls), sorted(P_IDS))) throw fail('入口应恰好执行 UT-S02-01、UT-S02-02、UT-S03-01', evidence);
    if (remoteHits(fx) !== 0) throw fail('远端不应收到请求', evidence);
    return { detail: '对象齐全：验收范围照常收窄，结果不变，没有连接远端', evidence };
  },
};
export const VERIFY_GIT_LOCAL_SMOKE_IDS = Object.keys(CASES);

/**
 * 逐例分派。安装态身份用例（SMOKE-core-375）是其余用例的前置条件：它失败时保留身份校验明细，
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
/**
 * 定位全局安装的 CLI 入口（dist/index.js 的真实路径）并核对安装态身份；返回 { entry } 或 { problem }。
 *
 * - Unix：`command -v openlogos` 的 realpath 就是包目录内的入口。
 * - Windows：`where openlogos` 给出的是包目录**之外**的 npm 启动脚本 `<prefix>\\openlogos.cmd`，它不是入口本身。
 *   按既有的启动脚本校验（scripts/lib/public-release-checks.mjs）核对脚本内容确实指向包目录内的 dist/index.js，
 *   入口取该目标文件；并经命令解释器执行一次启动脚本的 `--version`，确认从启动脚本进入的与直接执行入口的是同一版本。
 *
 * probes 为可注入的探测（测试用）：platform、prefix()、which()、shimVersion(layout)、entryVersion(entry)。
 */
export function resolveGlobalEntry(probes = {}) {
  const platform = probes.platform ?? process.platform;
  const inside = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  let prefix;
  try { prefix = (probes.prefix ?? defaultNpmPrefix)(); } catch (e) { return { problem: `无法读取 npm prefix -g：${e instanceof Error ? e.message : String(e)}` }; }
  if (!prefix || !existsSync(prefix)) return { problem: `npm prefix -g 返回的目录不存在：${prefix}` };
  const layout = installedLayout(realpathSync(prefix), platform);
  if (!existsSync(layout.pkgDir)) return { problem: `全局 npm prefix 下没有安装包目录 ${layout.pkgDir}` };
  if (lstatSync(layout.pkgDir).isSymbolicLink()) return { problem: `全局包目录 ${layout.pkgDir} 是链接（workspace link 不构成安装态证据）` };
  let entry;
  if (platform === 'win32') {
    const problems = entryIdentityProblems(layout);
    if (problems.length > 0) return { problem: `Windows 启动脚本校验未通过：${problems.join('；')}` };
    entry = realpathSync(join(layout.pkgDir, 'dist', 'index.js'));
    let viaShim; let direct;
    try {
      viaShim = (probes.shimVersion ?? defaultShimVersion)(layout);
      direct = (probes.entryVersion ?? defaultEntryVersion)(entry);
    } catch (e) { return { problem: `经启动脚本执行 --version 失败：${e instanceof Error ? e.message : String(e)}` }; }
    if (viaShim !== direct) return { problem: `启动脚本 ${layout.entry} 的版本 ${viaShim} 与入口 ${entry} 的版本 ${direct} 不一致` };
  } else {
    let found;
    try { found = (probes.which ?? defaultWhich)(); } catch (e) { return { problem: `找不到 openlogos 入口：${e instanceof Error ? e.message : String(e)}` }; }
    if (!found) return { problem: '找不到 openlogos 入口' };
    entry = realpathSync(found);
  }
  if (!inside(realpathSync(layout.pkgDir), entry)) return { problem: `入口 ${entry} 不在全局 npm prefix 的包目录 ${layout.pkgDir} 内` };
  if (inside(repoRoot, entry)) return { problem: `入口 ${entry} 位于工作区 ${repoRoot} 内` };
  return { entry, layout };
}
/** npm 在 Windows 上是 .cmd 启动脚本，须经命令解释器执行。 */
function defaultNpmPrefix() {
  const r = process.platform === 'win32'
    ? run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', 'prefix', '-g'])
    : run('npm', ['prefix', '-g']);
  if (r.status !== 0 || !r.stdout.trim()) throw new Error((r.stderr || '').slice(0, 200) || `退出码 ${r.status}`);
  return r.stdout.trim();
}
function defaultWhich() {
  const r = run('/bin/sh', ['-c', 'command -v openlogos']);
  const first = r.status === 0 ? r.stdout.split(/\r?\n/).find(line => line.trim()) : null;
  return first ? first.trim() : null;
}
function defaultShimVersion(layout) {
  const { command, args } = entryCommand(layout, ['--version']);
  const r = run(command, args);
  if (r.status !== 0) throw new Error(`${layout.entry} --version 退出码 ${r.status}：${(r.stderr || '').slice(0, 200)}`);
  return r.stdout.trim();
}
function defaultEntryVersion(entry) {
  const r = run(process.execPath, [entry, '--version']);
  if (r.status !== 0) throw new Error(`${entry} --version 退出码 ${r.status}`);
  return r.stdout.trim();
}

async function main() {
  // ① 目标环境优先
  if (TARGET_ENV && TARGET_ENV !== DEPLOY_ENV) {
    recordSmokeNotApplicable(OWNED, { reason: 'env-not-test', missing: [`OPENLOGOS_SMOKE_ENV=${DEPLOY_ENV}`], environment: ENVIRONMENT, repoRoot });
    console.log(`验收期间 git 调用只读本地安装态 smoke 不适用于环境 ${TARGET_ENV}，已写显式 skip`);
    process.exit(0);
  }
  // ② 适用窗口
  if (activeChange() !== SLUG && process.env.OPENLOGOS_VGL_SMOKE !== '1') {
    exitNotApplicable(OWNED, {
      reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_VGL_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_VGL_SMOKE'], environment: ENVIRONMENT, repoRoot,
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
      const resolved = resolveGlobalEntry();
      if (resolved.problem) {
        for (const id of OWNED) results.set(id, { status: 'fail', detail: resolved.problem, evidence: [], duration_ms: 0 });
      } else {
        entry = resolved.entry;
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
