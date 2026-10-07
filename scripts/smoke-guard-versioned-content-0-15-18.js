#!/usr/bin/env node
/**
 * SMOKE-core-215～SMOKE-core-222 — guard 以版本控制内容为保护对象（guard-versioned-content-scope，0.15.18）的
 * **安装态**取证。用例定义：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.15.18 …」节；
 * 部署方案：core-01-deployment-plan.md「OpenLogos 0.15.18 发布方案」。
 *
 * guard、事后检查引擎与 hook 注册都是托管资产：仓内源码修好、全局 CLI 或项目托管副本未更新，用户现场照旧误拦 /
 * 被绕过。判据一律用行为断言：版本号相等只证明装了新包，不证明规则生效。
 *
 * 驱动方式：每个隔离项目由安装态全局 CLI `openlogos init` / `sync` 建立托管资产；hook 一律按项目
 * `.claude/settings.json` **实际注册**的事件、matcher 与命令（经 `/bin/sh -c`，cwd = 项目根，
 * CLAUDE_PROJECT_DIR = 项目根）以宿主真实 stdin 形态调用：PreToolUse → 真实执行 → PostToolUse（成功）或
 * PostToolUseFailure（非零退出）。因此被调用的正是安装态托管的 `.claude/openlogos/bin/guard-check` 与
 * `guard-post-check.cjs`，注册缺失本身也会暴露为失败。
 *
 * 执行边界：SMOKE-core-215～221 的读写只在 `mktemp -d` 一次性 git 仓库与一次性 npm prefix（221 的旧版资产）内，
 * 结束即删除；对本机全局安装态只读（不安装 / 卸载，前后复核入口与版本未变）；git 用户名 / 邮箱只设在仓库级；
 * 不触碰本仓活跃提案与 logos/resources/；命令图中不出现任何公网发布命令。
 *
 * 判据分档（沿 SMOKE-core-209～214 runner 的既有形态）：
 * - **本案安装验收窗口**（活跃提案为本 slug，或 OPENLOGOS_GUARD_VERSIONED_SMOKE=1）：全局入口缺失、安装态不含
 *   事后检查引擎、安装身份与本次冻结候选不符 → 215～221 一律 fail 并非零退出（不得以 skip 充当安装验收证据）。
 *   候选版本在运行时读取 cli/src/lib/local-release-candidate.ts 的 LOCAL_RELEASE_CANDIDATE_VERSION（升版脚本写入），
 *   不写死版本字面量。git 不可用 → 215～221 显式 skip；221 缺回滚制品 → 221 显式 skip（携带缺失项）。
 * - **窗口之外**：本 runner 不适用，按既有留痕机制为 8 条用例写 skip。
 *
 * SMOKE-core-222（Cursor 真实宿主，人工实测项）：runner 只读证据文件
 * logos/resources/verify/smoke-evidence/SMOKE-core-222.json，**不生成、不改写**。证据格式（openlogos/smoke-evidence@1）：
 *   {
 *     "operator": "执行实测的人",                       // 必填，非空字符串
 *     "host": "cursor-agent | cursor-ide",              // 必填，真实宿主类型
 *     "host_version": "宿主版本（含可执行文件绝对路径）",   // 必填
 *     "session_id": "…", "performed_at": "ISO 时间",   // 建议填写
 *     "observed_channel": "inject-agent | post-report", // 必填：实测的 afterShellExecution 反馈渠道
 *     "spec_declared_channel": "inject-agent | post-report", // 必填：合并后 spec/cursor-plugin.md 声明的渠道
 *     "steps": [ { "step": 1..5, "observation": "…", "hook_stdin": …, "hook_stdout": …, "exit_code": …,
 *                  "artifacts": ["截图 / 宿主日志摘录路径"], "src_a_sha256_before": …, "src_a_sha256_after": … } ],
 *                                                       // 必填：操作序列 ①～⑤ 各至少一条
 *     "cursor_findings": {                              // 必填：承载跨切片「待实测」结论，回填 spec/cursor-plugin.md §8
 *       "invocation_id_field":            "宿主调用标识字段名，或 none（无可靠标识 → 匿名记录）",
 *       "generation_concurrent_same_command": "同一 generation 内是否会并发执行相同命令（yes / no / not_observed + 说明）",
 *       "after_shell_injects_agent":      "afterShellExecution 输出能否注入 agent 上下文",
 *       "after_shell_can_block":          "afterShellExecution 能否阻断 agent 后续步骤",
 *       "ask_prompt_default_mode":        "beforeShellExecution permission:ask 在默认模式下是否弹审批",
 *       "ask_prompt_auto_run_mode":       "自动运行模式下是否弹审批（不弹时 spec 须已声明改为 deny 且实测为 deny）",
 *       "before_shell_agent_message_delivered": "beforeShellExecution 的 agent_message 能否送达 agent",
 *       "session_start_delivers_pending": "sessionStart 能否带上待报告项",
 *       "tarball_engine_sha256":          "部署出的 .cursor/hooks/openlogos-guard-post.cjs 的 SHA-256（与随包引擎比对）"
 *     },
 *     "verdict": "pass | fail"                          // 必填
 *   }
 * 判定：字段齐全且 verdict=pass 且 observed_channel == spec_declared_channel → pass；verdict=fail 或两渠道不一致 → fail；
 * 文件缺失 / 不可解析 / 字段不全 / verdict 非 pass|fail → skip 并携带缺失项。skip 不计为通过，有 skip 时不得写 SMOKE_PASS。
 * 各项结论的取值由实测决定，runner 不预设任何结论。
 *
 * 仅供 runner 自身测试的注入（生产运行不设置）：
 *   OPENLOGOS_GUARD_VERSIONED_SMOKE_ENTRY            全局入口（指向隔离 prefix 或伪造安装包）
 *   OPENLOGOS_GUARD_VERSIONED_SMOKE_ROLLBACK_TARBALL 221 P2 旧版制品（缺省为 cli/rollback/miniidealab-openlogos-<回滚版本>.tgz）
 *   OPENLOGOS_GUARD_VERSIONED_SMOKE_EVIDENCE         222 证据文件路径
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const GUARD_VCS_SMOKE_IDS = Array.from({ length: 8 }, (_, i) => `SMOKE-core-${215 + i}`);
const AUTO_IDS = GUARD_VCS_SMOKE_IDS.slice(0, 7);
const MANUAL_ID = 'SMOKE-core-222';
const SLUG = 'guard-versioned-content-scope';
const ENVIRONMENT = 'local-global-temp-git-repo';
const MANUAL_ENVIRONMENT = 'manual-cursor-real-host';
const PACKAGED_GUARD = 'claude-plugin-template/bin/guard-check';
const PACKAGED_ENGINE = 'claude-plugin-template/bin/guard-post-check.cjs';
const MANAGED_GUARD = '.claude/openlogos/bin/guard-check';
const MANAGED_ENGINE = '.claude/openlogos/bin/guard-post-check.cjs';
const CURSOR_ENGINE = '.cursor/hooks/openlogos-guard-post.cjs';
const RUNTIME = 'logos/.openlogos-runtime';
const ENGINE_CMD = 'node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs"';
const POST_MATCHER = 'Bash|PowerShell|BashOutput|TaskOutput|KillShell|TaskStop';
const FAILURE_MATCHER = 'Bash|PowerShell';
const BLOCK_START = '# >>> openlogos managed >>>';
const BLOCK_END = '# <<< openlogos managed <<<';
const CURSOR_EVENTS = ['sessionStart', 'beforeShellExecution', 'afterFileEdit', 'afterShellExecution'];
const EVIDENCE_REL = 'logos/resources/verify/smoke-evidence/SMOKE-core-222.json';
const EVIDENCE_FIELDS = ['operator', 'host', 'host_version', 'observed_channel', 'spec_declared_channel', 'steps', 'verdict'];
const CURSOR_FINDING_KEYS = [
  'invocation_id_field', 'generation_concurrent_same_command', 'after_shell_injects_agent', 'after_shell_can_block',
  'ask_prompt_default_mode', 'ask_prompt_auto_run_mode', 'before_shell_agent_message_delivered',
  'session_start_delivers_pending', 'tarball_engine_sha256',
];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH
  || 'logos/resources/verify/smoke-results.jsonl');
const INJECTED_ENTRY = process.env.OPENLOGOS_GUARD_VERSIONED_SMOKE_ENTRY;

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: GUARD_VCS_SMOKE_IDS,
    environment: ENVIRONMENT,
    applies_when: [`active change == ${SLUG}`, 'OPENLOGOS_GUARD_VERSIONED_SMOKE=1'],
    candidate_version_source: 'cli/src/lib/local-release-candidate.ts',
    capability_probe: `installed ${PACKAGED_ENGINE} exists`,
    hook_driver: '.claude/settings.json registered hooks via /bin/sh -c',
    manual_evidence: { id: MANUAL_ID, path: EVIDENCE_REL, required_fields: EVIDENCE_FIELDS, cursor_findings: CURSOR_FINDING_KEYS },
    public_release_commands: [],
  }));
  process.exit(0);
}

/* ─────────────────────────── 结果账本（每条用例恰一条记录） ─────────────────────────── */

const results = new Map();
const started = Date.now();
const record = (id, status, detail, evidence = [], extra = {}) => results.set(id, { status, detail, evidence, ...extra });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of GUARD_VCS_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到（前序步骤已失败）', evidence: [] };
    const { status, detail, evidence, duration_ms: duration, ...extra } = row;
    appendFileSync(resultPath, `${JSON.stringify({
      id, status, timestamp, duration_ms: duration ?? Date.now() - started,
      environment: id === MANUAL_ID ? MANUAL_ENVIRONMENT : ENVIRONMENT, detail, evidence, ...extra,
    })}\n`);
  }
}

function finish() {
  flush();
  const bad = GUARD_VCS_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail' || !results.has(id));
  const skipped = GUARD_VCS_SMOKE_IDS.filter(id => results.get(id)?.status === 'skip');
  for (const id of GUARD_VCS_SMOKE_IDS) {
    const r = results.get(id);
    console.log(`  ${id}: ${r?.status ?? 'fail'} — ${String(r?.detail ?? '未执行').slice(0, 400)}`);
  }
  if (bad.length > 0) {
    console.error(`smoke 失败：${bad.join(', ')}`);
    process.exit(1);
  }
  if (skipped.length > 0) console.log(`smoke 跳过（不计为通过）：${skipped.join(', ')}`);
  console.log(`smoke 通过：${GUARD_VCS_SMOKE_IDS.filter(id => results.get(id)?.status === 'pass').join(', ') || '（无）'}`);
  process.exit(0);
}

/* ─────────────────────────── 通用工具 ─────────────────────────── */

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const shaOf = abs => (existsSync(abs) ? sha256(readFileSync(abs)) : 'absent');
const trunc = (s, n = 200) => String(s ?? '').slice(0, n);
const errMsg = e => (e instanceof Error ? e.message : String(e));

/** 子进程环境：去掉会改变 git 定位的变量与宿主项目目录，避免泄漏本仓上下文。 */
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'CLAUDE_PROJECT_DIR']) delete env[k];
  for (const k of Object.keys(env)) if (k.startsWith('OPENLOGOS_GUARD_TEST_') || k === 'OPENLOGOS_GUARD_NOW_NS') delete env[k];
  return { ...env, ...extra };
}

const run = (cmd, args, cwd = repoRoot, extraEnv = {}, input) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, input, env: cleanEnv(extraEnv) });
function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${(result.stdout || '') + (result.stderr || '')}`.trim().slice(0, 400));
  }
  return result.stdout;
}
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cliRaw = (entry, cwd, args) => run(cliBin(entry), cliArgs(entry, args), cwd);
const cli = (entry, cwd, args) => checked(cliRaw(entry, cwd, args), `openlogos ${args.join(' ')}`);
const git = (cwd, args) => checked(run('git', args, cwd), `git ${args.join(' ')}`);
const shQuote = s => `'${String(s).replace(/'/g, "'\\''")}'`;

function commandLookup() {
  if (INJECTED_ENTRY !== undefined) {
    return INJECTED_ENTRY && existsSync(INJECTED_ENTRY) ? realpathSync(INJECTED_ENTRY) : null;
  }
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
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

function readCandidateConstants() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
  const cand = /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text);
  const back = /LOCAL_RELEASE_ROLLBACK_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text);
  if (!cand) throw new Error(`无法读取候选版本（${src} 缺失或无 LOCAL_RELEASE_CANDIDATE_VERSION）`);
  return { version: cand[1], rollbackVersion: back ? back[1] : null };
}

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

/* ─────────────────────────── SMOKE-core-222：人工实测证据 ─────────────────────────── */

const nonEmpty = v => (typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined);

/** 只读证据文件，返回 { status, detail, evidence, missing? }；不生成、不改写证据。 */
export function evaluateManualEvidence(file) {
  const rel = relative(repoRoot, file).replace(/\\/g, '/') || file;
  if (!existsSync(file)) {
    return { status: 'skip', detail: `人工实测证据缺失：${rel}（需人类操作者在真实 Cursor 新 session 中完成后写入）`, missing: [rel] };
  }
  const bytes = readFileSync(file);
  const ev = [`evidence_file=${rel}`, `evidence_sha256=${sha256(bytes)}`];
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch (e) {
    return { status: 'skip', detail: `证据文件不是合法 JSON：${errMsg(e)}`, missing: ['valid-json'], evidence: ev };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { status: 'skip', detail: '证据文件顶层必须是对象', missing: ['object'], evidence: ev };
  }
  const missing = EVIDENCE_FIELDS.filter(k => !nonEmpty(doc[k]));
  if (nonEmpty(doc.steps) && !Array.isArray(doc.steps)) missing.push('steps(array)');
  if (Array.isArray(doc.steps)) {
    const covered = new Set(doc.steps.map(s => Number(s && s.step)));
    for (const n of [1, 2, 3, 4, 5]) if (!covered.has(n)) missing.push(`steps[step=${n}]`);
  }
  const findings = doc.cursor_findings;
  if (!findings || typeof findings !== 'object') missing.push('cursor_findings');
  else for (const k of CURSOR_FINDING_KEYS) if (!nonEmpty(findings[k])) missing.push(`cursor_findings.${k}`);
  if (nonEmpty(doc.verdict) && !['pass', 'fail'].includes(doc.verdict)) missing.push('verdict(pass|fail)');
  if (missing.length > 0) {
    return { status: 'skip', detail: `证据字段不全：${missing.join('、')}`, missing, evidence: ev };
  }
  ev.push(`operator=${doc.operator}`, `host=${doc.host}`, `host_version=${doc.host_version}`,
    `observed_channel=${doc.observed_channel}`, `spec_declared_channel=${doc.spec_declared_channel}`,
    `cursor_findings=${JSON.stringify(findings)}`);
  if (doc.verdict === 'fail') {
    return { status: 'fail', detail: '人工实测判定 fail：实测与规范声明不一致，须回流来源提案修订 spec/cursor-plugin.md', evidence: ev };
  }
  if (String(doc.observed_channel) !== String(doc.spec_declared_channel)) {
    return { status: 'fail', detail: `证据自相矛盾：verdict=pass 但实测渠道（${doc.observed_channel}）与规范声明（${doc.spec_declared_channel}）不一致`, evidence: ev };
  }
  return { status: 'pass', detail: `人工实测 pass：${doc.host} ${doc.host_version}，反馈渠道 ${doc.observed_channel} 与规范声明一致`, evidence: ev };
}

function recordManual() {
  const file = process.env.OPENLOGOS_GUARD_VERSIONED_SMOKE_EVIDENCE
    ? resolve(repoRoot, process.env.OPENLOGOS_GUARD_VERSIONED_SMOKE_EVIDENCE)
    : join(repoRoot, EVIDENCE_REL);
  const r = evaluateManualEvidence(file);
  const extra = r.status === 'skip'
    ? { not_applicable_reason: r.detail, missing_requirements: r.missing ?? [] }
    : {};
  record(MANUAL_ID, r.status, r.detail, r.evidence ?? [], { ...extra, duration_ms: 0 });
}

/* ─────────────────────────── 窗口判定与前置 ─────────────────────────── */

if (activeChange() !== SLUG && process.env.OPENLOGOS_GUARD_VERSIONED_SMOKE !== '1') {
  exitNotApplicable(GUARD_VCS_SMOKE_IDS, {
    reason: `非本案安装验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_GUARD_VERSIONED_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_GUARD_VERSIONED_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

recordManual();

function failAuto(reason, evidence = []) {
  for (const id of AUTO_IDS) record(id, 'fail', reason, evidence);
  finish();
}

function skipAuto(reason, missing) {
  for (const id of AUTO_IDS) record(id, 'skip', reason, [], { not_applicable_reason: reason, missing_requirements: missing, duration_ms: 0 });
  finish();
}

if (run('git', ['--version']).status !== 0) skipAuto('git 不可用，无法建立隔离 git 仓库', ['git']);

let candidate;
try { candidate = readCandidateConstants(); } catch (error) { failAuto(errMsg(error)); }
const entry = commandLookup();
if (!entry) failAuto('本机未找到全局 openlogos 入口——本次候选未安装到全局或安装到了错误的 npm prefix', ['global:openlogos']);
let pkgRoot;
let globalVersion;
try {
  pkgRoot = packageRoot(entry);
  globalVersion = cli(entry, repoRoot, ['--version']).trim();
} catch (error) {
  failAuto(errMsg(error), [`entry=${entry}`]);
}
const identityEvidence = [`entry=${entry}`, `package_root=${pkgRoot}`, `version=${globalVersion}`,
  `candidate_version=${candidate.version}`, INJECTED_ENTRY !== undefined ? 'mode=injected' : 'mode=global'];
if (!existsSync(join(pkgRoot, PACKAGED_ENGINE))) {
  failAuto(`全局安装态不含事后检查引擎 ${PACKAGED_ENGINE}（当前 ${globalVersion}）——入口仍指向旧版或安装未生效`, identityEvidence);
}
if (globalVersion !== candidate.version) {
  failAuto(`全局 --version（${globalVersion}）与本次冻结候选版本（${candidate.version}）不符`, identityEvidence);
}

const packagedGuardSha = shaOf(join(pkgRoot, PACKAGED_GUARD));
const packagedEngineSha = shaOf(join(pkgRoot, PACKAGED_ENGINE));
const baseEvidence = [...identityEvidence, `packaged_guard_sha256=${packagedGuardSha}`, `packaged_engine_sha256=${packagedEngineSha}`];
const scopes = [];
let toolSeq = 0;
/** 当前用例创建的隔离目录与 hook 上下文：失败时据此留证并保留目录（失败处置「保留隔离项目」）。 */
let caseDirs = [];
let caseCtxs = [];

/* ─────────────────────────── 隔离项目夹具 ─────────────────────────── */

function writeRel(root, rel, content) {
  const abs = join(root, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function newTempDir(tag) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `openlogos-smoke-guard-vcs-${tag}-`)));
  caseDirs.push(d);
  return d;
}

/**
 * 隔离 git 仓库 + 经指定 CLI init（Claude Code 默认）+ 置 launched + 提交。
 * opts.gitignore：init 前的 .gitignore 内容；opts.before(root)：init 前追加夹具；opts.aiTool。
 */
function newProject(tag, opts = {}) {
  const root = newTempDir(tag);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'smoke@openlogos.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeRel(root, 'src/a.js', 'console.log("a");\n');
  writeRel(root, '.gitignore', opts.gitignore ?? 'node_modules/\ndist/\n');
  if (opts.before) opts.before(root);
  git(root, ['add', '-A']);
  if (opts.forceAdd) git(root, ['add', '-f', '--', ...opts.forceAdd]);
  git(root, ['commit', '-q', '-m', 'base']);
  cli(opts.entry ?? entry, root, ['init', tag, '--locale', 'zh', '--ai-tool', opts.aiTool ?? 'claude-code']);
  const yamlPath = join(root, 'logos/logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/g, 'lifecycle: launched'));
  if (existsSync(join(root, 'logos/.openlogos-guard'))) throw new Error(`${tag}：临时项目意外存在活跃提案 guard 文件`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  return root;
}

/** SMOKE-core-216 形态：feat 分支（src/b.js）+ 零依赖 package.json 与 lockfile。 */
function newAllowProject(tag) {
  const root = newProject(tag);
  writeRel(root, 'package.json', `${JSON.stringify({ name: 'smoke-guard-vcs', version: '1.0.0', private: true }, null, 2)}\n`);
  writeRel(root, 'package-lock.json', `${JSON.stringify({
    name: 'smoke-guard-vcs', version: '1.0.0', lockfileVersion: 3, requires: true,
    packages: { '': { name: 'smoke-guard-vcs', version: '1.0.0' } },
  }, null, 2)}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'package']);
  git(root, ['checkout', '-q', '-b', 'feat']);
  writeRel(root, 'src/b.js', 'console.log("b");\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'feat']);
  git(root, ['checkout', '-q', '-']);
  if (existsSync(join(root, 'src/b.js'))) throw new Error('夹具：切回原分支后 src/b.js 仍存在');
  return root;
}

/* ─────────────────────────── hook 驱动（按项目实际注册） ─────────────────────────── */

function matcherMatches(matcher, toolName) {
  if (matcher === undefined || matcher === null || matcher === '' || matcher === '*') return true;
  if (!toolName) return false;
  try { return new RegExp(`^(?:${matcher})$`).test(toolName); } catch { return matcher === toolName; }
}

function registeredCommands(root, event, toolName) {
  const settings = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  const groups = (settings.hooks && settings.hooks[event]) || [];
  return groups.filter(g => matcherMatches(g.matcher, toolName))
    .flatMap(g => (g.hooks || []).filter(h => h && h.type === 'command' && typeof h.command === 'string').map(h => h.command));
}

/** 以宿主真实 stdin 调用该事件全部已注册命令；无注册返回 null。payload 中值为 undefined 的键被删除。 */
function fireHook(ctx, event, payload) {
  const cmds = registeredCommands(ctx.root, event, payload.tool_name);
  if (cmds.length === 0) {
    ctx.log.push({ event, tool: payload.tool_name ?? null, id: payload.tool_use_id ?? null, registered: false });
    return null;
  }
  const obj = {
    session_id: ctx.session, transcript_path: join(ctx.root, '.smoke-transcript.jsonl'), cwd: ctx.root,
    hook_event_name: event, permission_mode: 'default', ...payload,
  };
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  const input = JSON.stringify(obj);
  let code = 0;
  let stdout = '';
  let stderr = '';
  for (const c of cmds) {
    const r = spawnSync('/bin/sh', ['-c', c], {
      cwd: ctx.root, input, encoding: 'utf8', timeout: 180_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: ctx.root }),
    });
    const rc = r.status ?? 1;
    if (rc === 2 || code === 0) code = code === 2 ? 2 : rc;
    stdout += r.stdout || '';
    stderr += r.stderr || '';
  }
  ctx.log.push({ event, tool: payload.tool_name ?? null, id: payload.tool_use_id ?? null, input: trunc(input),
    exit: code, stdout: trunc(stdout), stderr: trunc(stderr) });
  return { code, stdout, stderr };
}

function execTool(ctx, tool, input, execOverride) {
  if (tool === 'Bash') {
    const r = spawnSync('bash', ['-c', execOverride ?? input.command], {
      cwd: ctx.root, encoding: 'utf8', timeout: 300_000,
      env: cleanEnv({ CLAUDE_PROJECT_DIR: ctx.root, GIT_EDITOR: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_offline: 'true', npm_config_update_notifier: 'false' }),
    });
    return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
  }
  const abs = isAbsolute(input.file_path) ? input.file_path : join(ctx.root, input.file_path);
  if (tool === 'Write') {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, input.content);
    return { status: 0, stdout: '', stderr: '' };
  }
  if (tool === 'Edit') {
    const text = readFileSync(abs, 'utf8');
    if (!text.includes(input.old_string)) return { status: 1, stdout: '', stderr: 'old_string 未命中' };
    writeFileSync(abs, text.replace(input.old_string, input.new_string));
    return { status: 0, stdout: '', stderr: '' };
  }
  throw new Error(`未支持的工具 ${tool}`);
}

const permissionDecision = out => {
  try { return JSON.parse(out.trim()).hookSpecificOutput?.permissionDecision ?? null; } catch { return null; }
};

/** 完整调用：PreToolUse →（放行时）真实执行 → PostToolUse / PostToolUseFailure（按注册触发）。 */
function call(ctx, tool, input, opts = {}) {
  toolSeq += 1;
  const id = opts.id ?? `toolu_smoke_${process.pid}_${toolSeq}`;
  const pre = fireHook(ctx, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id, ...(opts.extra || {}) });
  if (!pre) throw new Error(`${tool} 未注册 PreToolUse hook`);
  if (opts.preOnly || pre.code !== 0 || ['ask', 'deny'].includes(permissionDecision(pre.stdout))) {
    return { id, pre, exec: null, post: null };
  }
  const exec = execTool(ctx, tool, input, opts.exec);
  const ok = exec.status === 0;
  const post = fireHook(ctx, ok ? 'PostToolUse' : 'PostToolUseFailure', {
    tool_name: tool, tool_input: input, tool_use_id: id,
    ...(ok ? { tool_response: { stdout: exec.stdout, stderr: exec.stderr, interrupted: false } }
      : { error: `Command failed with exit code ${exec.status}` }),
  });
  return { id, pre, exec, post };
}

const stop = ctx => fireHook(ctx, 'Stop', { stop_hook_active: false });

function blockJson(stdout) {
  try {
    const o = JSON.parse(String(stdout).trim());
    return o && typeof o.reason === 'string' ? o : null;
  } catch { return null; }
}

/** 反馈文本（stderr 优先，回落 stdout JSON 的 reason）。 */
const feedback = r => (r ? (r.stderr && r.stderr.trim() ? r.stderr : (blockJson(r.stdout)?.reason ?? '')) : '');

/** 事后检查反馈中的变化列表：「变化文件：」之后的 `  - <路径>（<类型>）` 行。只取路径，不解析其余文案。 */
function reportedPaths(r) {
  const out = [];
  let inList = false;
  for (const line of feedback(r).split('\n')) {
    if (/^变化文件[:：]/.test(line.trim())) { inList = true; continue; }
    const m = /^\s+- (.+?)（[^（）]*）\s*$/.exec(line);
    if (inList && m) { out.push(m[1]); continue; }
    inList = false;
  }
  return out;
}

const restoreCommands = r => feedback(r).split('\n').map(l => l.trim()).filter(l => l.startsWith(`${ENGINE_CMD} restore `));
const restoreFor = (r, rel) => restoreCommands(r).find(c => c.endsWith(` -- ${rel}`) || c.endsWith(` -- ${shQuote(rel)}`));

function makeCtx(root, name) {
  const ctx = { root, session: `smoke-${name}-${process.pid}`, log: [] };
  caseCtxs.push(ctx);
  return ctx;
}

/** 断言收集器：问题累积后统一抛出。 */
function checker() {
  const problems = [];
  const expect = (cond, msg) => { if (!cond) problems.push(msg); return !!cond; };
  const done = (evidence = []) => {
    if (problems.length === 0) return;
    const err = new Error(problems.join('；'));
    err.evidence = evidence;
    throw err;
  };
  return { expect, done, problems };
}

const isAllowed = r => r && r.code === 0 && !blockJson(r.stdout) && permissionDecision(r.stdout) === null;
const descr = r => (r ? `exit ${r.code}${r.stderr ? ` ${trunc(r.stderr.replace(/\s+/g, ' '), 120)}` : ''}` : '未触发');

/** 放行步骤：PreToolUse 与（已注册时的）结束事件均 exit 0 且无拦截 JSON；Bash 的结束事件必须已注册。 */
function expectAllowed(c, label, step) {
  c.expect(isAllowed(step.pre), `${label} PreToolUse 应放行，实际 ${descr(step.pre)}`);
  if (step.pre.code !== 0) return;
  c.expect(step.exec && step.exec.status === 0, `${label} 命令执行失败：${trunc(step.exec?.stderr, 160)}`);
  if (step.post === null && step.exec) return;
  c.expect(isAllowed(step.post), `${label} 结束事件应 exit 0 且不报告，实际 ${descr(step.post)}；报告 ${JSON.stringify(reportedPaths(step.post))}`);
}

function expectPreBlocked(c, label, step) {
  c.expect(step.pre.code === 2, `${label} PreToolUse 应 exit 2，实际 exit ${step.pre.code}`);
  c.expect(!!blockJson(step.pre.stdout), `${label} stdout 缺拦截 JSON`);
  c.expect(step.pre.stderr.trim().length > 0, `${label} stderr 缺可读指引`);
}

/** 事后检查报告：Pre 放行、结束事件 exit 2、变化列表含 paths、恢复命令为引擎 restore 子命令形态。 */
function expectReported(c, label, step, paths, { failureEvent = false } = {}) {
  if (!c.expect(step.pre.code === 0, `${label} PreToolUse 应放行（由事后检查兜底），实际 ${descr(step.pre)}`)) return false;
  if (!c.expect(step.post !== null, `${label} 结束事件未注册 / 未触发`)) return false;
  if (failureEvent) c.expect(step.exec && step.exec.status !== 0, `${label} 应以非零退出走 PostToolUseFailure`);
  c.expect(step.post.code === 2, `${label} ${failureEvent ? 'PostToolUseFailure' : 'PostToolUse'} 应 exit 2，实际 exit ${step.post.code}`);
  const got = reportedPaths(step.post);
  for (const p of paths) c.expect(got.includes(p), `${label} 变化列表应含 ${p}，实际 ${JSON.stringify(got)}`);
  const cmds = restoreCommands(step.post);
  c.expect(!/git checkout|\s>\s|>>/.test(cmds.join('\n')), `${label} 恢复命令出现 shell 重定向或 git checkout`);
  return true;
}

/** 执行反馈给出的某路径恢复命令（同样经完整 hook 链）；恢复本身不得产生报告。 */
function runRestore(c, ctx, label, step, rel) {
  const cmd = restoreFor(step.post, rel);
  if (!c.expect(!!cmd, `${label} 反馈缺少 ${rel} 的恢复命令（应为 ${ENGINE_CMD} restore <record_id> -- <path>）`)) return null;
  const r = call(ctx, 'Bash', { command: cmd });
  expectAllowed(c, `${label} 恢复命令`, r);
  return r;
}

function hookEvidence(ctx) {
  return ctx.log.map(e => JSON.stringify(e));
}

function runtimeListing(root) {
  const dir = join(root, RUNTIME);
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d, pre) => {
    for (const n of readdirSync(d)) {
      const abs = join(d, n);
      if (lstatSync(abs).isDirectory()) walk(abs, `${pre}${n}/`);
      else out.push(`${pre}${n}`);
    }
  };
  walk(dir, '');
  return out.sort();
}

const pendingLines = root => {
  const f = join(root, RUNTIME, 'pending-reports.jsonl');
  return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(l => l.trim()) : [];
};
const changesListing = root => (existsSync(join(root, 'logos/changes')) ? readdirSync(join(root, 'logos/changes')).sort() : []);

/* ─────────────────────────── 各用例 ─────────────────────────── */

const versionBefore = { entry, version: globalVersion };
function globalUntouched() {
  const e = commandLookup();
  const v = e ? cliRaw(e, repoRoot, ['--version']).stdout.trim() : null;
  if (e !== versionBefore.entry || v !== versionBefore.version) {
    throw new Error(`全局入口或版本在矩阵执行期间发生变化：${versionBefore.entry}@${versionBefore.version} → ${e}@${v}`);
  }
}

async function case215() {
  const c = checker();
  const ev = [...baseEvidence];
  // ① 入口与版本：无 workspace link
  const linked = pkgRoot === repoRoot || pkgRoot.startsWith(`${repoRoot}${sep}`);
  c.expect(!linked, `安装态包根 ${pkgRoot} 位于本仓工作区内（workspace link）`);
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  c.expect(pkg.version === globalVersion, `--version（${globalVersion}）与包 package.json（${pkg.version}）不一致`);
  // ② asset-manifest 自洽；两个脚本 hash 等于 manifest 条目且与本仓分发源逐字节一致
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'asset-manifest.json'), 'utf8'));
  c.expect(manifest.version === undefined || manifest.version === globalVersion, `asset-manifest version（${manifest.version}）与 --version 不一致`);
  const assetLibPath = join(pkgRoot, 'dist/lib/asset-manifest.js');
  if (c.expect(existsSync(assetLibPath), '安装态缺 dist/lib/asset-manifest.js，无法校验 payloadHash')) {
    try {
      const lib = await import(pathToFileURL(assetLibPath).href);
      lib.validateAssetManifest(manifest, pkgRoot);
    } catch (e) { c.expect(false, `asset-manifest 不自洽（payloadHash / 条目 hash）：${errMsg(e)}`); }
  }
  for (const [packaged, source, sha] of [
    [PACKAGED_GUARD, 'plugin/bin/guard-check', packagedGuardSha],
    [PACKAGED_ENGINE, 'plugin/bin/guard-post-check.cjs', packagedEngineSha],
  ]) {
    const registered = (manifest.plugins || []).find(p => p.path === packaged)?.sha256;
    c.expect(registered === sha, `asset-manifest 登记的 ${packaged}（${registered}）与随包字节（${sha}）不一致`);
    const srcSha = shaOf(join(repoRoot, source));
    c.expect(srcSha === sha, `随包 ${packaged}（${sha}）与本仓分发源 ${source}（${srcSha}）不一致`);
    ev.push(`${source}_sha256=${srcSha}`);
  }
  // ③ Cursor：模板 hooks.json 含 afterShellExecution；引擎副本（模板内若另存则比对，另以 init 部署结果比对）
  const tplHooks = join(pkgRoot, 'cursor-plugin-template/hooks/hooks.json');
  if (c.expect(existsSync(tplHooks), '安装态缺 cursor-plugin-template/hooks/hooks.json')) {
    const h = JSON.parse(readFileSync(tplHooks, 'utf8'));
    c.expect(Array.isArray(h.hooks?.afterShellExecution) && h.hooks.afterShellExecution.length > 0, 'Cursor 模板 hooks.json 不含 afterShellExecution');
  }
  const tplEngine = join(pkgRoot, 'cursor-plugin-template/hooks/openlogos-guard-post.cjs');
  if (existsSync(tplEngine)) c.expect(shaOf(tplEngine) === packagedEngineSha, 'Cursor 模板内引擎副本与 guard-post-check.cjs 字节不一致');
  const cursorProject = newProject('s215c', { aiTool: 'cursor' });
  const deployedSha = shaOf(join(cursorProject, CURSOR_ENGINE));
  c.expect(deployedSha === packagedEngineSha, `Cursor 部署的 ${CURSOR_ENGINE}（${deployedSha}）与随包引擎（${packagedEngineSha}）不一致`);
  ev.push(`cursor_project=${cursorProject}`, `cursor_engine_sha256=${deployedSha}`);
  // ④ --help 列出 ignore / exempt；临时项目内 ignore / exempt list --format json
  const help = cli(entry, repoRoot, ['--help']);
  c.expect(/^\s+ignore\b/m.test(help) && /^\s+exempt\b/m.test(help), '`openlogos --help` 未列出 ignore 与 exempt');
  const project = newProject('s215');
  const ign = cliRaw(entry, project, ['ignore', 'list', '--format', 'json']);
  c.expect(ign.status === 0 && Array.isArray(JSON.parse(ign.stdout || '{}').data?.entries), `ignore list --format json 不可用：exit ${ign.status} ${trunc(ign.stderr)}`);
  const ex = cliRaw(entry, project, ['exempt', 'list', '--format', 'json']);
  let defaults = [];
  try { defaults = (JSON.parse(ex.stdout).data?.entries || []).filter(e => e.source === 'default'); } catch { /* 下方断言 */ }
  c.expect(ex.status === 0 && defaults.length === 2, `exempt list --format json 应含两条 source=default，实际 exit ${ex.status}：${trunc(ex.stdout)}`);
  ev.push(`project=${project}`, `exempt_defaults=${JSON.stringify(defaults.map(d => d.value))}`);
  c.done(ev);
  return { detail: `安装态身份同源（${globalVersion}，manifest 自洽，guard / 引擎 hash 与 manifest 及本仓分发源一致，Cursor 引擎副本同字节，help 列出 ignore / exempt，exempt 内置默认两项）`, evidence: ev };
}

async function case216() {
  const c = checker();
  const root = newAllowProject('s216');
  const ctx = makeCtx(root, '216');
  const changesBefore = changesListing(root);
  const steps = [
    ['① npm ci', 'Bash', { command: 'npm ci' }],
    ['② mkdir -p dist/x', 'Bash', { command: 'mkdir -p dist/x' }],
    ['③ node -e … > dist/run.log', 'Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'dist/build.log\',\'x\')" > dist/run.log' }],
    ['④ Write dist/a.txt', 'Write', { file_path: join(root, 'dist/a.txt'), content: 'x\n' }],
    ['⑤ Write reference/notes.md', 'Write', { file_path: join(root, 'logos/resources/reference/notes.md'), content: '# notes\n' }],
    ['⑥ git checkout feat', 'Bash', { command: 'git checkout feat' }],
    ['⑥ git checkout -', 'Bash', { command: 'git checkout -' }],
    ['⑦ git stash list', 'Bash', { command: 'git stash list' }],
  ];
  let sawB = false;
  for (const [label, tool, input] of steps) {
    const s = call(ctx, tool, input);
    expectAllowed(c, label, s);
    if (tool === 'Bash') c.expect(s.post !== null || s.pre.code !== 0, `${label} Bash 结束事件未注册`);
    if (label === '⑥ git checkout feat') sawB = existsSync(join(root, 'src/b.js'));
    if (reportedPaths(s.post).includes('src/b.js')) c.expect(false, `${label} 报告了切换分支带来的 src/b.js`);
  }
  c.expect(sawB, '⑥ 切到 feat 后 src/b.js 未出现（夹具未生效，分支切换空转）');
  const st = stop(ctx);
  c.expect(st !== null, '⑧ Stop hook 未注册');
  c.expect(isAllowed(st), `⑧ Stop 应 exit 0 无报告，实际 ${descr(st)}`);
  c.expect(pendingLines(root).length === 0, `⑧ 仍有待报告项：${pendingLines(root).join(' | ').slice(0, 200)}`);
  c.expect(JSON.stringify(changesListing(root)) === JSON.stringify(changesBefore), `全程产生了 logos/changes/* 条目：${changesListing(root).join(',')}`);
  c.expect(!existsSync(join(root, 'logos/.openlogos-guard')), '全程产生了 guard 文件');
  c.expect(run('git', ['check-ignore', '-q', '--', `${RUNTIME}/x`], root).status === 0, `${RUNTIME}/ 未被 git check-ignore 判为忽略`);
  const ev = [...baseEvidence, `project=${root}`, ...hookEvidence(ctx)];
  c.done(ev);
  return { detail: 'launched 无提案：npm ci、dist 产物、重定向写 dist、Write 被忽略文件与 exempt 默认路径、独立 git checkout / stash list 的 Pre / Post 全部 exit 0，分支切换不报告，Stop 无待报告，未产生提案或 guard 文件，运行时目录被忽略', evidence: ev };
}

async function case217() {
  const c = checker();
  const root = newProject('s217', {
    gitignore: 'node_modules/\ndist/\n/logos/*\n!/logos/logos.config.json\n!/logos/logos-project.yaml\n',
    before: r => {
      writeRel(r, 'docs/.gitignore', '*.tmp\n');
      writeRel(r, 'src/up.txt', 'hello');
    },
  });
  const ctx = makeCtx(root, '217');
  // 夹具：exempt docs/、clean filter、autocrlf、被忽略的规格文件、未跟踪 CRLF 文件
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.guard = { ...(cfg.guard || {}), exempt: ['docs/'] };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  git(root, ['config', 'filter.up.clean', 'tr a-z A-Z']);
  const attrs = join(root, '.gitattributes');
  writeFileSync(attrs, `${existsSync(attrs) ? readFileSync(attrs, 'utf8').replace(/\n?$/, '\n') : ''}src/up.txt filter=up\n`);
  git(root, ['add', '-A']);
  git(root, ['add', '--renormalize', '--', 'src/up.txt']);
  git(root, ['commit', '-q', '-m', 'fixtures']);
  git(root, ['config', 'core.autocrlf', 'true']);
  writeRel(root, 'logos/resources/prd/x.md', '# ignored spec\n');
  const crlfBytes = Buffer.from('line1\r\nline2\r\n');
  writeRel(root, 'src/crlf.txt', crlfBytes);
  c.expect(run('git', ['check-ignore', '-q', '--', 'logos/resources/prd/x.md'], root).status === 0, '夹具：logos/resources/prd/x.md 未被忽略');
  c.expect(git(root, ['show', ':src/up.txt']) === 'HELLO', '夹具：src/up.txt 索引内容不是 HELLO（clean filter 未生效）');
  const status0 = git(root, ['status', '--porcelain']).split('\n').filter(Boolean);
  c.expect(status0.length === 1 && status0[0] === '?? src/crlf.txt', `夹具：提交后 git status 应仅剩未跟踪 src/crlf.txt，实际 ${JSON.stringify(status0)}`);
  const A = join(root, 'src/a.js');
  const shaLog = [];
  const snap = label => shaLog.push(`${label}:${['src/a.js', 'src/crlf.txt', 'src/up.txt', '.git/config', '.git/info/exclude'].map(p => `${p}=${shaOf(join(root, p)).slice(0, 16)}`).join(',')}`);
  snap('start');

  // ①～④ 事前阻断
  expectPreBlocked(c, '① Edit src/a.js', call(ctx, 'Edit', { file_path: A, old_string: 'a', new_string: 'b' }));
  expectPreBlocked(c, '② Write src/new.js', call(ctx, 'Write', { file_path: join(root, 'src/new.js'), content: 'x' }));
  expectPreBlocked(c, '③ Write logos/resources/prd/x.md', call(ctx, 'Write', { file_path: join(root, 'logos/resources/prd/x.md'), content: 'x' }));
  expectPreBlocked(c, '④ Edit .gitignore', call(ctx, 'Edit', { file_path: join(root, '.gitignore'), old_string: 'dist/', new_string: 'build/' }));
  c.expect(!existsSync(join(root, 'src/new.js')), '② 被阻断的写入仍然落盘');
  // ⑤ cd 前缀 + sed -i
  const s5 = call(ctx, 'Bash', { command: `cd ${root} && sed -i.bak 's/a/b/' src/a.js` });
  expectReported(c, '⑤', s5, ['src/a.js']);
  snap('after5');
  // ⑥ node -e 写 src/a.js；⑩ 执行 ⑥ 反馈给出的恢复命令（须在同一路径被之后的步骤再次改写之前执行：
  //    引擎拒绝覆盖报告之后的修改，且去重表只保留每个路径最新一次报告）
  const before6 = shaOf(A);
  const s6 = call(ctx, 'Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'src/a.js\',\'y\')"' });
  if (expectReported(c, '⑥', s6, ['src/a.js'])) {
    const r10 = runRestore(c, ctx, '⑩（⑥ 的恢复）', s6, 'src/a.js');
    if (r10) c.expect(shaOf(A) === before6, `⑩ 恢复后 src/a.js（${shaOf(A)}）与 ⑥ 执行前（${before6}）不一致`);
  }
  snap('after6+10');
  // ⑦ 改写后非零退出 → PostToolUseFailure
  const s7 = call(ctx, 'Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'src/a.js\',\'z\');process.exit(3)"' });
  expectReported(c, '⑦', s7, ['src/a.js'], { failureEvent: true });
  c.expect(restoreCommands(s7.post).length > 0 && /openlogos change/.test(feedback(s7.post)), '⑦ 反馈缺恢复命令或「openlogos change <slug>」立案指引');
  // ⑧ git 复合调用不享受豁免，并提示拆分
  const s8 = call(ctx, 'Bash', { command: 'git status && node -e "require(\'fs\').writeFileSync(\'src/a.js\',\'w\')"' });
  if (expectReported(c, '⑧', s8, ['src/a.js'])) c.expect(/拆/.test(feedback(s8.post)), '⑧ 反馈未提示拆分 git 调用');
  // ⑨ 改写忽略规则来源 .git/info/exclude（随后执行其恢复命令，避免 src/ 被忽略影响后续步骤）
  //    根规范 spec/pretooluse-guard.md 规定 `>` / `>>` 重定向目标走事前判定，而 `.git/info/exclude` 属不可豁免项：
  //    事前 exit 2 且文件未被改写同样满足「改写忽略规则来源被拦下」（只会更严）；放行时则必须由事后检查列出。
  const excludeBefore = shaOf(join(root, '.git/info/exclude'));
  const s9 = call(ctx, 'Bash', { command: "echo 'src/' >> .git/info/exclude" });
  if (s9.pre.code === 0) {
    if (expectReported(c, '⑨', s9, ['.git/info/exclude'])) runRestore(c, ctx, '⑨', s9, '.git/info/exclude');
  } else {
    expectPreBlocked(c, '⑨（重定向目标事前判定）', s9);
    c.expect(shaOf(join(root, '.git/info/exclude')) === excludeBefore, '⑨ 事前阻断后 .git/info/exclude 仍被改写');
  }
  shaLog.push(`step9=${s9.pre.code === 0 ? 'post-check' : 'pre-block'}`);
  snap('after9');
  // ⑪ exempt 目录内的忽略规则来源仍受保护
  expectPreBlocked(c, '⑪ Edit docs/.gitignore', call(ctx, 'Edit', { file_path: join(root, 'docs/.gitignore'), old_string: '*.tmp', new_string: '*.log' }));
  // ⑫ node -e 追加 .git/config（随后恢复）
  const s12 = call(ctx, 'Bash', { command: 'node -e "require(\'fs\').appendFileSync(\'.git/config\',\'\\n[alias]\\n  x = status\\n\')"' });
  if (expectReported(c, '⑫', s12, ['.git/config'])) runRestore(c, ctx, '⑫', s12, '.git/config');
  // ⑬ autocrlf 下未跟踪 CRLF 文件：恢复后逐字节一致
  const s13 = call(ctx, 'Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'src/crlf.txt\',\'changed\')"' });
  if (expectReported(c, '⑬', s13, ['src/crlf.txt'])) {
    runRestore(c, ctx, '⑬', s13, 'src/crlf.txt');
    c.expect(existsSync(join(root, 'src/crlf.txt')) && Buffer.compare(readFileSync(join(root, 'src/crlf.txt')), crlfBytes) === 0,
      '⑬ 恢复后 src/crlf.txt 与执行前不是逐字节一致（CRLF 未保留）');
  }
  snap('after13');
  // ⑭ clean filter：过滤后 diff 为空仍报告；恢复后原始字节为 hello
  const s14 = call(ctx, 'Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'src/up.txt\',\'HELLO\')"' });
  const diffQuiet = run('git', ['diff', '--quiet', '--', 'src/up.txt'], root).status;
  c.expect(diffQuiet === 0, `⑭ 过滤后 git diff 应为空（夹具前提），实际 exit ${diffQuiet}`);
  if (expectReported(c, '⑭', s14, ['src/up.txt'])) {
    runRestore(c, ctx, '⑭', s14, 'src/up.txt');
    c.expect(readFileSync(join(root, 'src/up.txt'), 'utf8') === 'hello', '⑭ 恢复后 src/up.txt 原始字节不是 hello');
  }
  snap('after14');
  // ⑮ 恢复后再做相同修改视为新的变化事件；之后两次 Stop 不重复报告
  const cmd15 = 'node -e "require(\'fs\').writeFileSync(\'src/a.js\',\'X\')"';
  const s15a = call(ctx, 'Bash', { command: cmd15 });
  if (expectReported(c, '⑮ 第一次', s15a, ['src/a.js'])) runRestore(c, ctx, '⑮', s15a, 'src/a.js');
  const s15b = call(ctx, 'Bash', { command: cmd15 });
  expectReported(c, '⑮ 第二次（新 tool_use_id）', s15b, ['src/a.js']);
  for (const n of [1, 2]) {
    const st = stop(ctx);
    c.expect(st !== null && !reportedPaths(st).includes('src/a.js'), `⑮ 第二次修改之后第 ${n} 次 Stop 重复报告了 src/a.js：${descr(st)}`);
  }
  snap('end');
  const ev = [...baseEvidence, `project=${root}`, ...shaLog, ...hookEvidence(ctx)];
  c.done(ev);
  const step9 = s9.pre.code === 0 ? '.git/info/exclude 由事后检查列出' : '.git/info/exclude 的 >> 重定向按根规范事前 exit 2 且未改写';
  return { detail: `Edit/Write 已跟踪、未跟踪、被忽略规格、.gitignore 与 exempt 目录内 .gitignore 事前 exit 2；sed -i / node -e / 非零退出 / git 复合调用 / .git/config / autocrlf CRLF / clean filter 改写均由事后检查 exit 2 列出并给出引擎 restore 命令，恢复逐字节一致，恢复后同改再报、Stop 不重复；${step9}`, evidence: ev };
}

async function case218() {
  const c = checker();
  const root = newProject('s218');
  const ctx = makeCtx(root, '218');
  // ① 只发 PreToolUse，真实执行，不发结束事件
  const late = call(ctx, 'Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'src/a.js\',\'late\')"' }, { preOnly: true });
  c.expect(late.pre.code === 0, `① PreToolUse 应放行，实际 ${descr(late.pre)}`);
  const ex = execTool(ctx, 'Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'src/a.js\',\'late\')"' });
  c.expect(ex.status === 0, '① 命令执行失败');
  // ② 补查点：Write dist/c.txt 的 PreToolUse 不阻断当前调用本身
  const s2 = call(ctx, 'Write', { file_path: join(root, 'dist/c.txt'), content: 'c' });
  c.expect(s2.pre.code === 0, `② 补查点 PreToolUse 应 exit 0，实际 ${descr(s2.pre)}`);
  // ③ Stop 送达；④ 再次 Stop 不重复
  const st3 = stop(ctx);
  c.expect(st3 && st3.code === 2 && reportedPaths(st3).includes('src/a.js'), `③ Stop 应 exit 2 并列出 src/a.js，实际 ${descr(st3)} ${JSON.stringify(reportedPaths(st3))}`);
  const st4 = stop(ctx);
  c.expect(isAllowed(st4), `④ 再次 Stop 应 exit 0 不重复报告，实际 ${descr(st4)}`);
  // ⑤ 记录状态。按根规范 spec/pretooluse-guard.md「前台记录在 Stop 时关闭」（提交 97ad143，晚于本用例文字）：
  //    非后台记录在 Stop 做最终对比后关闭——记录文件删除、写墓碑 <id>.closed。用例原文「closed:false」已被根规范取代。
  const listing = runtimeListing(root);
  const recJson = join(root, RUNTIME, 'guard-records', `${late.id}.json`);
  const tomb = join(root, RUNTIME, 'guard-records', `${late.id}.closed`);
  c.expect(existsSync(tomb) && !existsSync(recJson), `⑤ 该前台记录应在 Stop 时关闭（墓碑在场、记录文件删除），实际 json=${existsSync(recJson)} closed=${existsSync(tomb)}`);
  const ev = [...baseEvidence, `project=${root}`, `record_id=${late.id}`, `runtime=${JSON.stringify(listing)}`,
    `pending=${trunc(pendingLines(root).join('|'), 300)}`, `reported_sha256=${shaOf(join(root, RUNTIME, 'reported.jsonl'))}`, ...hookEvidence(ctx)];
  c.done(ev);
  return { detail: '缺结束事件的执行记录：补查点不阻断当前调用，Stop exit 2 送达 src/a.js，再次 Stop 不重复；记录按根规范在 Stop 时关闭（墓碑）', evidence: ev };
}

async function case219() {
  const c = checker();
  const root = newProject('s219');
  const ctx = makeCtx(root, '219');
  const files = ['logos/logos.config.json', '.gitignore'];
  const before = files.map(f => shaOf(join(root, f)));
  const pre = (command, mode) => call(ctx, 'Bash', { command }, { preOnly: true, extra: { permission_mode: mode } }).pre;
  const askOk = (label, r, command) => {
    let o = null;
    try { o = JSON.parse(r.stdout.trim()); } catch { /* 下方断言 */ }
    const h = o?.hookSpecificOutput;
    c.expect(r.code === 0 && h?.hookEventName === 'PreToolUse' && h?.permissionDecision === 'ask'
      && String(h?.permissionDecisionReason ?? '').includes(command), `${label} 应 exit 0 且 permissionDecision=ask（reason 含命令原文），实际 ${descr(r)} ${trunc(r.stdout)}`);
  };
  const ADD = 'openlogos exempt add src/';
  askOk('① default', pre(ADD, 'default'), ADD);
  askOk('② acceptEdits', pre(ADD, 'acceptEdits'), ADD);
  for (const mode of ['bypassPermissions', 'dontAsk', 'auto', undefined]) {
    const r = pre(ADD, mode);
    const text = feedback(r);
    c.expect(r.code === 2, `③ ${mode ?? '字段缺失'} 应 exit 2，实际 ${descr(r)}`);
    c.expect(text.includes(mode ?? 'permission_mode'), `③ ${mode ?? '字段缺失'} reason 未包含当前权限模式`);
    c.expect(text.includes(`! ${ADD}`), `③ ${mode ?? '字段缺失'} reason 未提示用户以「! ${ADD}」自行执行`);
  }
  const CD = `cd ${root} && openlogos ignore add src/`;
  askOk('④ cd 前缀', pre(CD, 'default'), CD);
  const r5 = pre('openlogos ignore add src/ && echo ok', 'default');
  c.expect(r5.code === 2, `⑤ 复合形态应 exit 2，实际 ${descr(r5)}`);
  const r6 = pre('openlogos exempt list', 'bypassPermissions');
  c.expect(r6.code === 0 && permissionDecision(r6.stdout) === null, `⑥ exempt list 应 exit 0 且不输出 permissionDecision，实际 ${descr(r6)} ${trunc(r6.stdout)}`);
  // ⑦ 伪造「授权」文件不起作用
  const forged = sha256(ADD);
  writeRel(root, `${RUNTIME}/${forged}.json`, JSON.stringify({ command: ADD, approved: true, approved_by: 'user' }));
  writeRel(root, `${RUNTIME}/approvals/${forged}.json`, JSON.stringify({ command: ADD, approved: true }));
  const r7 = pre(ADD, 'bypassPermissions');
  c.expect(r7.code === 2, `⑦ 伪造授权文件后 bypassPermissions 仍应 exit 2，实际 ${descr(r7)}`);
  // ⑧ 字节不变
  const after = files.map(f => shaOf(join(root, f)));
  files.forEach((f, i) => c.expect(before[i] === after[i], `⑧ ${f} 字节发生变化（${before[i]} → ${after[i]}）`));
  const ev = [...baseEvidence, `project=${root}`, ...files.map((f, i) => `${f}:${before[i]}→${after[i]}`), ...hookEvidence(ctx)];
  c.done(ev);
  return { detail: '保护范围变更：default / acceptEdits 与 cd 前缀 → ask；bypassPermissions / dontAsk / auto / 字段缺失 → exit 2 并提示「! 命令」；复合形态 exit 2；list 不受限；伪造授权文件无效；配置与 .gitignore 字节不变', evidence: ev };
}

/** .gitignore 区块外内容（首个起始标记到其后首个结束标记之间——含两行标记——之外的全部字节）。 */
function outsideBlock(text) {
  const s = text.indexOf(BLOCK_START);
  if (s < 0) return text;
  const e = text.indexOf(BLOCK_END, s);
  if (e < 0) return text;
  let end = e + BLOCK_END.length;
  if (text.startsWith('\r\n', end)) end += 2; else if (text[end] === '\n') end += 1;
  return text.slice(0, s) + text.slice(end);
}
function blockLines(text) {
  const s = text.indexOf(BLOCK_START);
  const e = text.indexOf(BLOCK_END, s);
  if (s < 0 || e < 0) return [];
  return text.slice(s + BLOCK_START.length, e).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
}

async function case220() {
  const c = checker();
  const userIgnore = '# 用户注释：依赖目录\r\nnode_modules/\r\ndist/\r\n\r\n# 本地文件\r\n*.local\r\n';
  const root = newProject('s220', {
    gitignore: userIgnore,
    before: r => writeRel(r, 'build/out.txt', 'tracked build output\n'),
    forceAdd: ['build/out.txt'],
  });
  const gi = join(root, '.gitignore');
  const cfgPath = join(root, 'logos/logos.config.json');
  const outside0 = outsideBlock(readFileSync(gi, 'utf8'));
  c.expect(outside0.includes('\r\n'), '夹具：区块外内容不是 CRLF 行尾');
  const trail = [];
  const step = (label, args) => {
    const giBefore = shaOf(gi);
    const cfgBefore = shaOf(cfgPath);
    const r = cliRaw(entry, root, args);
    const text = readFileSync(gi, 'utf8');
    trail.push(`${label}: exit ${r.status}; gitignore ${giBefore.slice(0, 12)}→${shaOf(gi).slice(0, 12)}; outside ${sha256(outsideBlock(text)).slice(0, 12)}; config ${cfgBefore.slice(0, 12)}→${shaOf(cfgPath).slice(0, 12)}`);
    return { r, text, giBefore, cfgBefore };
  };
  const outsideSame = (label, text) => c.expect(outsideBlock(text) === outside0, `${label} .gitignore 区块外内容发生变化`);
  const s1 = step('①', ['ignore', 'add', 'coverage/']);
  c.expect(s1.r.status === 0, `① exit ${s1.r.status}：${trunc(s1.r.stderr)}`);
  c.expect(blockLines(s1.text).includes('logos/.openlogos-runtime/') && blockLines(s1.text).includes('coverage/'), `① 托管区块应含 logos/.openlogos-runtime/ 与 coverage/，实际 ${JSON.stringify(blockLines(s1.text))}`);
  outsideSame('①', s1.text);
  const s2 = step('②', ['ignore', 'add', 'coverage/']);
  c.expect(s2.r.status === 0 && /已存在|already/i.test(s2.r.stdout), `② 应 exit 0 并提示已存在，实际 exit ${s2.r.status}：${trunc(s2.r.stdout)}`);
  c.expect(shaOf(gi) === s2.giBefore && shaOf(cfgPath) === s2.cfgBefore, '② 重复添加改动了 .gitignore 或 logos.config.json');
  const s3 = step('③', ['ignore', 'add', 'build/']);
  c.expect(s3.r.status === 0, `③ exit ${s3.r.status}`);
  c.expect(s3.r.stdout.includes("git --literal-pathspecs rm --cached -- 'build/out.txt'"), `③ 未输出按实际文件生成的 git rm --cached 命令：${trunc(s3.r.stdout, 400)}`);
  c.expect(/\b1\b/.test(s3.r.stdout) && s3.r.stdout.includes('build/out.txt'), '③ 未输出已跟踪文件数量与示例');
  c.expect(git(root, ['ls-files', 'build/out.txt']).trim() === 'build/out.txt', '③ build/out.txt 被移出了索引（不应代为执行）');
  outsideSame('③', s3.text);
  const s4 = step('④', ['ignore', 'remove', 'coverage/']);
  c.expect(s4.r.status === 0 && !blockLines(s4.text).includes('coverage/'), `④ 区块内仍有 coverage/（exit ${s4.r.status}）`);
  outsideSame('④', s4.text);
  const s5 = step('⑤', ['ignore', 'list', '--format', 'json']);
  let listed = null;
  try { listed = JSON.parse(s5.r.stdout).data.entries.map(e => e.value); } catch { /* 下方断言 */ }
  const unversioned = JSON.parse(readFileSync(cfgPath, 'utf8')).guard?.unversioned ?? [];
  c.expect(Array.isArray(listed) && JSON.stringify([...listed].sort()) === JSON.stringify([...unversioned].sort()), `⑤ entries（${JSON.stringify(listed)}）与配置 guard.unversioned（${JSON.stringify(unversioned)}）不一致`);
  const s6a = step('⑥ exempt add', ['exempt', 'add', 'docs/notes/']);
  const s6b = step('⑥ exempt remove', ['exempt', 'remove', 'logos/resources/reference/']);
  const s6c = step('⑥ exempt list', ['exempt', 'list', '--format', 'json']);
  let exempt = null;
  try { exempt = JSON.parse(s6c.r.stdout).data.entries.map(e => e.value); } catch { /* 下方断言 */ }
  c.expect(s6a.r.status === 0 && s6b.r.status === 0 && Array.isArray(exempt)
    && exempt.includes('docs/notes/') && exempt.includes('logos/resources/verify/baseline-seed-runs/*/staging/')
    && !exempt.includes('logos/resources/reference/'), `⑥ exempt 清单不符：${JSON.stringify(exempt)}`);
  outsideSame('⑥', s6c.text);
  // ⑦ 区块标记损坏（重复起始标记）→ exit 1 且零写入
  writeFileSync(gi, `${readFileSync(gi, 'utf8')}${BLOCK_START}\r\n`);
  const s7 = step('⑦', ['ignore', 'add', 'tmp/']);
  c.expect(s7.r.status === 1, `⑦ 标记损坏时应 exit 1，实际 ${s7.r.status}`);
  c.expect(shaOf(gi) === s7.giBefore && shaOf(cfgPath) === s7.cfgBefore, '⑦ 标记损坏时仍写入了 .gitignore 或 logos.config.json');
  const ev = [...baseEvidence, `project=${root}`, ...trail];
  c.done(ev);
  return { detail: 'ignore / exempt：区块外 CRLF 内容逐字节不变、重复添加零写入、已跟踪文件给出 git --literal-pathspecs rm --cached 命令且不代为执行、remove / list 与配置一致、内置默认项物化后删除、标记损坏 exit 1 零写入', evidence: ev };
}

function installRollback(tarball) {
  const prefix = newTempDir('rollback-prefix');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  checked(run(npm, ['install', '-g', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', tarball], prefix),
    `隔离 prefix 安装回滚制品 ${tarball}`);
  const bin = process.platform === 'win32' ? join(prefix, 'openlogos.cmd') : join(prefix, 'bin', 'openlogos');
  if (!existsSync(bin)) throw new Error(`隔离 prefix 中未找到 openlogos 入口：${bin}`);
  return realpathSync(bin);
}

/** P1 / P2 托管资产上复跑 216 ②④ 与 217 ①⑥。 */
function miniMatrix(c, root, tag) {
  const ctx = makeCtx(root, tag);
  expectAllowed(c, `${tag} 216② mkdir -p dist/x`, call(ctx, 'Bash', { command: 'mkdir -p dist/x' }));
  expectAllowed(c, `${tag} 216④ Write dist/a.txt`, call(ctx, 'Write', { file_path: join(root, 'dist/a.txt'), content: 'x' }));
  expectPreBlocked(c, `${tag} 217① Edit src/a.js`, call(ctx, 'Edit', { file_path: join(root, 'src/a.js'), old_string: 'a', new_string: 'b' }));
  const s6 = call(ctx, 'Bash', { command: 'node -e "require(\'fs\').writeFileSync(\'src/a.js\',\'y\')"' });
  if (expectReported(c, `${tag} 217⑥`, s6, ['src/a.js'])) runRestore(c, ctx, `${tag} 217⑥`, s6, 'src/a.js');
  return ctx;
}

const USER_CLAUDE_ENTRY = { matcher: 'Write', hooks: [{ type: 'command', command: 'true # user-owned smoke hook' }] };
const USER_CURSOR_ENTRY = { type: 'command', command: 'true # user-owned cursor hook' };

async function case221() {
  const c = checker();
  const ev = [...baseEvidence];
  const rollbackTarball = process.env.OPENLOGOS_GUARD_VERSIONED_SMOKE_ROLLBACK_TARBALL
    ? resolve(repoRoot, process.env.OPENLOGOS_GUARD_VERSIONED_SMOKE_ROLLBACK_TARBALL)
    : (candidate.rollbackVersion ? join(repoRoot, 'cli/rollback', `miniidealab-openlogos-${candidate.rollbackVersion}.tgz`) : null);
  if (!rollbackTarball || !existsSync(rollbackTarball)) {
    const missing = rollbackTarball ? relative(repoRoot, rollbackTarball).replace(/\\/g, '/') : 'LOCAL_RELEASE_ROLLBACK_VERSION';
    return { skip: true, detail: `缺回滚制品，无法构造 P2 旧版托管资产：${missing}`, missing: [missing] };
  }
  ev.push(`rollback_tarball=${rollbackTarball}`, `rollback_tarball_sha256=${shaOf(rollbackTarball)}`);
  // ① P1：Claude Code 新建项目
  const p1 = newProject('s221p1');
  const settings = JSON.parse(readFileSync(join(p1, '.claude/settings.json'), 'utf8')).hooks || {};
  const cmdsOf = ev2 => (settings[ev2] || []).flatMap(g => (g.hooks || []).map(h => h.command));
  c.expect(cmdsOf('PreToolUse').some(x => x.includes('.claude/openlogos/bin/guard-check')), 'P1 settings.json 缺 PreToolUse guard-check 条目');
  const engineCheck = `${ENGINE_CMD} check`;
  c.expect((settings.PostToolUse || []).some(g => g.matcher === POST_MATCHER && (g.hooks || []).some(h => h.command === engineCheck)), `P1 缺 PostToolUse（matcher ${POST_MATCHER}）→ ${engineCheck}`);
  c.expect((settings.PostToolUseFailure || []).some(g => g.matcher === FAILURE_MATCHER && (g.hooks || []).some(h => h.command === engineCheck)), `P1 缺 PostToolUseFailure（matcher ${FAILURE_MATCHER}）`);
  c.expect(cmdsOf('Stop').includes(`${engineCheck} --stop`), 'P1 缺 Stop → check --stop');
  c.expect(!('SessionEnd' in settings), 'P1 注册了 SessionEnd');
  c.expect(shaOf(join(p1, MANAGED_GUARD)) === packagedGuardSha && shaOf(join(p1, MANAGED_ENGINE)) === packagedEngineSha, 'P1 托管 guard-check / guard-post-check.cjs 与随包字节不一致');
  c.expect(blockLines(readFileSync(join(p1, '.gitignore'), 'utf8')).includes('logos/.openlogos-runtime/'), 'P1 .gitignore 托管区块缺 logos/.openlogos-runtime/');
  // ② P3：Cursor 新建项目
  const p3 = newProject('s221p3', { aiTool: 'cursor' });
  const ch = JSON.parse(readFileSync(join(p3, '.cursor/hooks.json'), 'utf8')).hooks || {};
  for (const e of CURSOR_EVENTS) {
    c.expect((ch[e] || []).some(h => String(h.command || '').includes('.cursor/hooks/openlogos-runtime.cjs')), `P3 .cursor/hooks.json 缺托管事件 ${e}`);
  }
  c.expect(shaOf(join(p3, CURSOR_ENGINE)) === packagedEngineSha, `P3 ${CURSOR_ENGINE} 与引擎字节不一致`);
  // ③ P2：旧版（隔离 prefix）init + 用户自有条目 → 对照 → 全局 sync → 同一输入
  const oldEntry = installRollback(rollbackTarball);
  const oldVersion = cli(oldEntry, repoRoot, ['--version']).trim();
  ev.push(`rollback_entry=${oldEntry}`, `rollback_version=${oldVersion}`);
  const p2 = newProject('s221p2', { entry: oldEntry, aiTool: 'all' });
  const sPath = join(p2, '.claude/settings.json');
  const cPath = join(p2, '.cursor/hooks.json');
  const s2 = JSON.parse(readFileSync(sPath, 'utf8'));
  s2.hooks = s2.hooks || {};
  s2.hooks.PreToolUse = [...(s2.hooks.PreToolUse || []), USER_CLAUDE_ENTRY];
  writeFileSync(sPath, `${JSON.stringify(s2, null, 2)}\n`);
  if (c.expect(existsSync(cPath), 'P2 旧版 init 未产出 .cursor/hooks.json')) {
    const c2 = JSON.parse(readFileSync(cPath, 'utf8'));
    c2.hooks = c2.hooks || {};
    c2.hooks.beforeShellExecution = [...(c2.hooks.beforeShellExecution || []), USER_CURSOR_ENTRY];
    writeFileSync(cPath, `${JSON.stringify(c2, null, 2)}\n`);
  }
  git(p2, ['add', '-A']);
  git(p2, ['commit', '-q', '-m', 'user hooks']);
  const p2ctx = makeCtx(p2, '221p2');
  const managedFiles = [MANAGED_GUARD, MANAGED_ENGINE, CURSOR_ENGINE, '.claude/settings.json', '.cursor/hooks.json', '.gitignore'];
  const shaSet = label => ev.push(`P2 ${label}: ${managedFiles.map(f => `${f}=${shaOf(join(p2, f)).slice(0, 16)}`).join(',')}`);
  shaSet('before-sync');
  const control = call(p2ctx, 'Bash', { command: 'mkdir -p dist/x' }, { preOnly: true });
  c.expect(control.pre.code === 2, `P2 对照：旧托管 guard 对 mkdir -p dist/x 应 exit 2，实际 ${descr(control.pre)}（夹具未装上旧版，矩阵空转）`);
  cli(entry, p2, ['sync']);
  shaSet('after-sync');
  const afterSync = call(p2ctx, 'Bash', { command: 'mkdir -p dist/x' });
  expectAllowed(c, 'P2 sync 后 mkdir -p dist/x', afterSync);
  c.expect(shaOf(join(p2, MANAGED_GUARD)) === packagedGuardSha && shaOf(join(p2, MANAGED_ENGINE)) === packagedEngineSha
    && shaOf(join(p2, CURSOR_ENGINE)) === packagedEngineSha, 'P2 sync 后托管资产未更新为随包字节');
  const s2After = JSON.parse(readFileSync(sPath, 'utf8')).hooks?.PreToolUse || [];
  c.expect(s2After.some(g => JSON.stringify(g) === JSON.stringify(USER_CLAUDE_ENTRY)), 'P2 sync 后 .claude/settings.json 用户自有 PreToolUse 条目未逐字保留');
  const c2After = existsSync(cPath) ? JSON.parse(readFileSync(cPath, 'utf8')).hooks?.beforeShellExecution || [] : [];
  c.expect(c2After.some(h => JSON.stringify(h) === JSON.stringify(USER_CURSOR_ENTRY)), 'P2 sync 后 .cursor/hooks.json 用户自有条目未逐字保留');
  // ④ 连续第二次 sync 零改动
  const twice = ['.claude/settings.json', '.cursor/hooks.json', '.gitignore'].map(f => shaOf(join(p2, f)));
  cli(entry, p2, ['sync']);
  ['.claude/settings.json', '.cursor/hooks.json', '.gitignore'].forEach((f, i) => c.expect(shaOf(join(p2, f)) === twice[i], `P2 第二次 sync 改动了 ${f}`));
  // ⑤ P1 / P2 托管资产复跑 216 ②④ 与 217 ①⑥
  const m1 = miniMatrix(c, p1, 'P1');
  const m2 = miniMatrix(c, p2, 'P2');
  // ⑥ P2：独立 openlogos sync 的 PreToolUse → 执行 → PostToolUse 不报告 sync 写入的 .gitignore / .gitattributes
  const gi = join(p2, '.gitignore');
  const ga = join(p2, '.gitattributes');
  writeFileSync(gi, outsideBlock(readFileSync(gi, 'utf8')));
  if (existsSync(ga)) writeFileSync(ga, '');
  git(p2, ['add', '-A']);
  git(p2, ['commit', '-q', '-m', 'drop managed blocks']);
  const giBefore = shaOf(gi);
  const gaBefore = shaOf(ga);
  const s6 = call(p2ctx, 'Bash', { command: 'openlogos sync' }, { exec: `${shQuote(cliBin(entry))}${entry.endsWith('.js') ? ` ${shQuote(entry)}` : ''} sync` });
  c.expect(shaOf(gi) !== giBefore || shaOf(ga) !== gaBefore, 'P2 ⑥ sync 未写入 .gitignore / .gitattributes（夹具空转）');
  expectAllowed(c, 'P2 ⑥ 独立 openlogos sync', s6);
  const rep = reportedPaths(s6.post);
  c.expect(!rep.includes('.gitignore') && !rep.includes('.gitattributes'), `P2 ⑥ 报告了 sync 写入的 ${JSON.stringify(rep)}`);
  ev.push(`p1=${p1}`, `p2=${p2}`, `p3=${p3}`, ...hookEvidence(p2ctx), ...hookEvidence(m1), ...hookEvidence(m2));
  c.done(ev);
  return { detail: `init（Claude / Cursor）注册与托管字节正确；P2 旧版（${oldVersion}）对照 exit 2、全局 sync 后 exit 0，托管资产更新、用户条目保留、二次 sync 零改动；P1 / P2 复跑矩阵一致；独立 openlogos sync 不报告其写入`, evidence: ev };
}

/* ─────────────────────────── 分派 ─────────────────────────── */

const CASES = [
  ['SMOKE-core-215', case215], ['SMOKE-core-216', case216], ['SMOKE-core-217', case217], ['SMOKE-core-218', case218],
  ['SMOKE-core-219', case219], ['SMOKE-core-220', case220], ['SMOKE-core-221', case221],
];

try {
  for (const [id, fn] of CASES) {
    const t0 = Date.now();
    caseDirs = [];
    caseCtxs = [];
    try {
      const out = await fn();
      if (out.skip) {
        record(id, 'skip', out.detail, [], { not_applicable_reason: out.detail, missing_requirements: out.missing ?? [], duration_ms: Date.now() - t0 });
      } else {
        record(id, 'pass', out.detail, out.evidence, { duration_ms: Date.now() - t0 });
      }
      scopes.push(...caseDirs);
    } catch (error) {
      const ev = error && Array.isArray(error.evidence) && error.evidence.length > 0
        ? error.evidence
        : [...baseEvidence, ...caseCtxs.flatMap(hookEvidence)];
      record(id, 'fail', errMsg(error), [...ev, ...caseDirs.map(d => `kept_dir=${d}`)], { duration_ms: Date.now() - t0 });
      console.error(`${id} 失败，保留隔离目录：${caseDirs.join(' ') || '（无）'}`);
    }
  }
  try {
    globalUntouched();
  } catch (error) {
    for (const id of AUTO_IDS) record(id, 'fail', errMsg(error), baseEvidence);
  }
} finally {
  for (const s of scopes) {
    try { chmodSync(s, 0o755); rmSync(s, { recursive: true, force: true }); } catch { /* 清理失败不影响判定 */ }
  }
}
finish();
