#!/usr/bin/env node
/**
 * SMOKE-core-336～SMOKE-core-337：0.16.23 smoke runner 发现修复的**安装态**取证（提案 fix-smoke-runner-discovery-overflow）。
 * 场景 S19「smoke runner / reporter / dispatcher 覆盖检查」：runner 发现的遍历规则、默认 dispatcher 下零 runner 判定、EX-19.25。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.23 smoke runner 发现安装态 smoke（SMOKE-core-336～337）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.23 本机测试环境发布（fix-smoke-runner-discovery-overflow）」。
 *
 *   - SMOKE-core-336：安装态版本与制品身份（--version 等于本次成功部署回执的候选版本；入口无 workspace link 且等于回执
 *     entry_realpath；payloadHash 自洽）。
 *   - SMOKE-core-337：在含目录链接 `release → X`（X 内有哨兵 runner）与环形链接 `loop → .` 的一次性项目中，全局 CLI
 *     `verify --format json` 正常输出：臂 A 退出码 0、PASS、runners 只含仓内 runner；臂 B（新增 smoke 用例、仓内无 runner）
 *     退出码 1、FAIL、runners 为空、诊断与 gate.reason 为 smoke_runner_missing；两臂 stderr 不含 RangeError；
 *     verify 只做静态预检，夹具 dispatcher 未被执行。超宽目录的参数上限不在安装态物理建档，由 UT-S19-115 / UT-S19-121 覆盖。
 *
 * **入口判断次序**（规格「目标环境优先判断」）：
 *   ① 自测模式的拒绝规则（见下）；
 *   ② 普通入口下宿主已指定 OPENLOGOS_SMOKE_ENV 且不是 test → 为全部 owned ID 写带原因的显式 skip
 *      （env-not-test，缺失项 OPENLOGOS_SMOKE_ENV=test），不声明 target_environment，以 0 退出；
 *   ③ 适用窗口：活跃变更为本提案，或 OPENLOGOS_RD_SMOKE=1；窗口外写 skip；
 *   ④ 部署前置：先读部署账本——没有 SLUG 在 test 的成功 deploy 才写显式 skip；有记录时须与本机部署回执同一 deploy_id、
 *      result=done、environment=test，源码候选版本须可读且等于回执 candidate_version，否则 fail。不设固定版本下限：
 *      版本只按「源码候选 = 回执 = 安装态 --version」关系式判定（SMOKE-core-336 ① 比较安装态与回执）。
 * **自测模式**（须同时满足）：OPENLOGOS_RD_SMOKE_SELF_TEST=1、OPENLOGOS_RD_SMOKE_ENTRY（候选入口），且 OPENLOGOS_SMOKE_RESULT_PATH
 * 指向**仓库之外**的独立账本；正式 smoke 上下文（已注入 OPENLOGOS_SMOKE_ENV / OPENLOGOS_SMOKE_MODULE 任一变量）中拒绝自测。
 * 自测账本在任何写入前按 openSelfTestLedger 判定（符号链接、真实父目录、链接数），全部结果行经同一描述符写入。
 * 自测跳过窗口与部署前置，结果以 environment=self-test-injected-entry 写入，从不声明 target_environment。
 *
 * fix-smoke-runner-discovery-review-gaps：判定逻辑抽成可导入函数（UT-S19-122～126），主流程只在作为入口执行时运行。
 *
 * 全局 CLI 子进程在独立进程组中运行并限时 120 秒，到时对整个进程组强制终止并判 fail；每一步按预期退出码与输出通道判定后再解析。
 * 全部写入只在一次性目录内，结束即删除（先删链接再删目录）；对全局安装态只读，不读写本仓 logos/resources/（结果账本除外）。
 */
import { spawn, spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable, recordSmokeNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'fix-smoke-runner-discovery-overflow';
const OWNED = ['SMOKE-core-336', 'SMOKE-core-337'];
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOY_LEDGER = 'logos/.openlogos-runtime/deployments.jsonl';
const DEPLOY_RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const DEPLOY_ENV = 'test';
// 子进程时限：规格上限 120 秒；OPENLOGOS_RD_SMOKE_CHILD_TIMEOUT_MS 只能缩短（供回归夹具），不能放宽
const CHILD_TIMEOUT_MS = (() => {
  const v = Number(process.env.OPENLOGOS_RD_SMOKE_CHILD_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 && v < 120_000 ? v : 120_000;
})();

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_RD_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd = repoRoot) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });

function refuse(reason) {
  console.error(`smoke runner 拒绝运行（未写入任何结果）：${reason}`);
  process.exit(2);
}
function formalResultPath() {
  let configured = null;
  try { configured = JSON.parse(readFileSync(join(repoRoot, 'logos/logos.config.json'), 'utf8')).smoke?.result_path ?? null; } catch { /* 缺省 */ }
  return resolve(repoRoot, configured || 'logos/resources/verify/smoke-results.jsonl');
}
function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}
export function candidateVersion(root = repoRoot) {
  const src = join(root, 'cli/src/lib/local-release-candidate.ts');
  const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
  return /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null;
}
function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}
const ENVELOPE_MISMATCH = '信封通道 / 形态不匹配';

/**
 * UT-S19-122：stdout 整体解析为 JSON 信封（spec/cli-json-output.md「1.2 通用信封结构」）。
 * 只对 stdout.trim() 整体 JSON.parse，不挑选某一行；还要求 command 等于预期命令、version / timestamp 为字符串、data 为对象。
 * 不满足即抛错，错误信息含「信封通道 / 形态不匹配」。
 */
export function parseEnvelope(stdout, expectedCommand, label = 'stdout') {
  const text = (stdout ?? '').trim();
  const fail = why => new Error(`${label} 的 stdout 不是完整的 ${expectedCommand} JSON 信封（${ENVELOPE_MISMATCH}）：${why}；stdout 开头：${text.slice(0, 200)}`);
  if (!text) throw fail('stdout 为空');
  let envelope;
  try { envelope = JSON.parse(text); } catch (e) { throw fail(`整段无法解析为 JSON（${e instanceof Error ? e.message : String(e)}）`); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw fail('顶层不是 JSON 对象');
  if (envelope.command !== expectedCommand) throw fail(`command=${JSON.stringify(envelope.command)}，预期 ${JSON.stringify(expectedCommand)}`);
  if (typeof envelope.version !== 'string' || typeof envelope.timestamp !== 'string') throw fail('缺 version 或 timestamp');
  if (!envelope.data || typeof envelope.data !== 'object' || Array.isArray(envelope.data)) throw fail('缺 data 对象');
  return envelope;
}

/**
 * UT-S19-123：回执 entry_realpath 须为非空绝对路径，且**原值**等于实际入口 realpath（不对回执字段再做 realpath，
 * 与 scripts/smoke-local-install-deploy.js 的回执核对一致）。返回问题描述，或 null。
 */
export function receiptEntryProblem(receipt, entryRealpath) {
  const recorded = receipt?.entry_realpath;
  const suffix = `（实际入口 realpath=${entryRealpath}，回执 entry_realpath=${JSON.stringify(recorded ?? null)}）`;
  if (recorded === undefined || recorded === null) return `① 部署回执缺 entry_realpath${suffix}`;
  if (typeof recorded !== 'string' || recorded === '') return `① 部署回执 entry_realpath 为空${suffix}`;
  if (!isAbsolute(recorded)) return `① 部署回执 entry_realpath 不是绝对路径${suffix}`;
  if (recorded !== entryRealpath) return `① 入口 realpath 与回执 entry_realpath 不同${suffix}`;
  return null;
}

/** UT-S19-124：安装态 --version 须等于回执 candidate_version（三方关系式的第三边；不设固定下限）。 */
export function installedVersionProblem(installedVersion, receipt) {
  return installedVersion === receipt?.candidate_version
    ? null
    : `① --version 为 ${installedVersion}，本次成功部署回执的候选版本为 ${receipt?.candidate_version}`;
}

/**
 * 经已打开的描述符写完整段文本：按缓冲区字节偏移补写短写，写入量为 0 时报错（不留半行 JSONL）。
 */
export function writeAll(fsOps, fd, text) {
  const buf = Buffer.from(text, 'utf8');
  let offset = 0;
  while (offset < buf.length) {
    const n = fsOps.writeSync(fd, buf, offset, buf.length - offset);
    if (!(n > 0)) throw new Error(`账本写入失败：第 ${offset} 字节处写入量为 ${n}，剩余 ${buf.length - offset} 字节未写入`);
    offset += n;
  }
}

/**
 * 解析账本的真实位置：文件存在取其 realpath；realpath 失败时先用 lstat 区分——账本本身是无法解析的符号链接（悬空链接）
 * → { unresolvableLink: true }（其目标可能被自测创建后与正式账本共用，调用方须拒绝）；普通的待创建文件 → 真实父目录 + 文件名；
 * 都不存在时退回 resolve。
 */
function realLedgerPath(p, fsOps = nodeFs) {
  const abs = resolve(p);
  try { return { path: fsOps.realpathSync(abs) }; } catch { /* 文件不存在或为悬空链接 */ }
  let st = null;
  try { st = fsOps.lstatSync(abs); } catch { /* 不存在 */ }
  if (st?.isSymbolicLink()) return { path: abs, unresolvableLink: true };
  try { return { path: join(fsOps.realpathSync(dirname(abs)), basename(abs)) }; } catch { return { path: abs }; }
}

/**
 * UT-S19-125：打开自测结果账本。拒绝（抛错）发生在任何写入之前：
 *   - 结果路径本身是符号链接（含悬空链接），或 lstat 无法确认目标；
 *   - 父目录不存在或无法解析真实路径；
 *   - 真实父目录 + 文件名按路径分量判在仓库内（`..results.jsonl` 这类文件名算仓内），或与正式账本的真实位置相同
 *     （正式账本经目录别名配置时也按真实位置比较）；正式账本本身是无法解析的符号链接（悬空链接）时一律拒绝；
 *   - 以不跟随符号链接方式打开后，fstat 不是普通文件或链接数不为 1（排除与仓内账本共享同一文件的硬链接）；
 *   - 打开后的描述符与正式账本的设备号、inode 相同（路径文本不同的同一文件，如大小写别名）。
 * 通过后返回 { path, write(text), close() }：全部写入经这一次打开得到的描述符。fsOps 可注入以记录文件操作。
 */
export function openSelfTestLedger(root, ledgerPath, formalPath, fsOps = nodeFs) {
  const refuse = why => new Error(`自测结果不得写入仓库内或与其他账本共享的文件：${why}；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向仓库之外的独立账本`);
  const requested = resolve(root, ledgerPath);
  let st = null;
  try { st = fsOps.lstatSync(requested); } catch (e) {
    if (e?.code !== 'ENOENT') throw refuse(`无法确认结果路径 ${requested}（${e?.code ?? e}）`);
  }
  if (st?.isSymbolicLink()) throw refuse(`结果路径 ${requested} 是符号链接`);
  if (st && !st.isFile()) throw refuse(`结果路径 ${requested} 不是普通文件`);
  let realParent;
  try { realParent = fsOps.realpathSync(dirname(requested)); } catch (e) {
    throw refuse(`无法确认结果路径的真实父目录 ${dirname(requested)}（${e?.code ?? e}）`);
  }
  const target = join(realParent, basename(requested));
  let realRoot;
  try { realRoot = fsOps.realpathSync(root); } catch { realRoot = resolve(root); }
  const rel = relative(realRoot, target);
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  if (!outside) throw refuse(`结果路径 ${target} 位于仓库 ${realRoot} 内`);
  const formal = realLedgerPath(resolve(root, formalPath), fsOps);
  if (formal.unresolvableLink) throw refuse(`正式 smoke 账本 ${formal.path} 是无法解析的符号链接，无法确认自测结果与其互不相同`);
  if (target === formal.path) throw refuse(`结果路径 ${target} 是正式 smoke 账本（真实位置 ${formal.path}）`);
  // 先独占创建（O_CREAT | O_EXCL，与 cli/src/lib/sandbox.ts 同一用法）；EEXIST 转入已有文件分支（不带 O_CREAT 打开）。
  const { O_WRONLY, O_APPEND, O_CREAT, O_EXCL, O_NOFOLLOW = 0 } = nodeFs.constants;
  let fd;
  try {
    fd = fsOps.openSync(target, O_WRONLY | O_APPEND | O_CREAT | O_EXCL | O_NOFOLLOW, 0o644);
  } catch (e) {
    if (e?.code !== 'EEXIST') throw refuse(`无法以不跟随链接的方式创建 ${target}（${e?.code ?? e}）`);
    try { fd = fsOps.openSync(target, O_WRONLY | O_APPEND | O_NOFOLLOW); } catch (e2) {
      throw refuse(`无法以不跟随链接的方式打开 ${target}（${e2?.code ?? e2}）`);
    }
  }
  const fst = fsOps.fstatSync(fd);
  if (!fst.isFile() || fst.nlink !== 1) {
    fsOps.closeSync(fd);
    throw refuse(`打开的文件不是独立普通文件（isFile=${fst.isFile()}，nlink=${fst.nlink}）`);
  }
  // 文件身份核对：路径文本不同也可能是同一文件（如大小写不敏感卷上的大小写别名）。打开后再读正式账本的身份
  // （此时若自测刚经别名创建了它，也能读到），设备号与 inode 相同即在首次写入前关闭并拒绝。
  // 拒绝时**不删除任何文件**：该路径已是正式账本，正式写入方随时可能向它追加结果，任何「确认为空再删」都存在
  // 检查与删除之间的竞态窗口。自测从未向其写入字节，留下的至多是一份空的正式账本（位于仓外）。
  let formalStat = null;
  try { formalStat = fsOps.statSync(formal.path); } catch { /* 正式账本不存在：不可能与自测目标相同 */ }
  if (formalStat && formalStat.dev === fst.dev && formalStat.ino === fst.ino) {
    fsOps.closeSync(fd);
    throw refuse(`结果路径 ${target} 与正式 smoke 账本 ${formal.path} 是同一文件（dev=${fst.dev}，ino=${fst.ino}）`);
  }
  return {
    path: target,
    write: text => { writeAll(fsOps, fd, text); },
    close: () => { fsOps.closeSync(fd); },
  };
}

/**
 * UT-S19-126：制品校验结论。自测与正式统一复用 validateAssetManifest 的最终结果：抛出任何错误即返回 problem，
 * 不再把异常当作「开发布局缺文件」放行；只有校验通过才给出「payloadHash 自洽」。
 */
export function assetManifestVerdict(validate, manifest, pkg, { selfTest = false } = {}) {
  const evidence = [`asset_check_mode=${selfTest ? 'self-test' : 'formal'}`, `payload_hash=${manifest?.payloadHash}`];
  try {
    validate(manifest, pkg);
  } catch (e) {
    return { ok: false, problem: `② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`, evidence };
  }
  return { ok: true, detail: 'payloadHash 自洽', evidence };
}

const scopes = [];
const links = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-rd-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content = 'x\n') {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function link(target, path) {
  symlinkSync(target, path);
  links.push(path);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_RD_')) delete env[key];
    if (key.startsWith('OPENLOGOS_VERIFY_') || key === 'OPENLOGOS_STDIO_TRACE') delete env[key];
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDE_PROJECT_DIR'].includes(key)) delete env[key];
    if (key === 'OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY' || key.startsWith('OPENLOGOS_GUARD_')) delete env[key];
  }
  return { ...env, ...extra };
}
/** 在独立进程组中运行子进程：到时对整个进程组发 SIGKILL 并立即返回 timedOut。 */
function runChild(cmd, args, { cwd, env }) {
  return new Promise(resolvePromise => {
    let stdout = ''; let stderr = ''; let settled = false;
    const finish = r => { if (!settled) { settled = true; clearTimeout(timer); resolvePromise({ stdout, stderr, ...r }); } };
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) { finish({ status: null, signal: null, error }); return; }
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
/**
 * 按预期退出码与输出通道判定一次全局 CLI 调用：先查超时、启动错误与信号，再要求退出码等于 expectExit；
 * channel 为 'stdout' 时对 stdout 整体解析 JSON 信封，命令身份为 args[0]（parseEnvelope），不满足即判信封不匹配。
 */
async function cliExpect(entry, root, args, expectExit, channel) {
  const label = `全局 CLI ${args.join(' ')}`;
  const r = await runChild(process.execPath, [entry, ...args], {
    cwd: root, env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home') }),
  });
  if (r.timedOut) throw new Error(`${label} 超过 ${CHILD_TIMEOUT_MS / 1000} 秒未返回，已强制终止其进程组，判失败、不重试`);
  if (r.error) throw new Error(`${label} 启动失败：${r.error.message}`);
  if (r.signal) throw new Error(`${label} 被信号 ${r.signal} 终止，判失败`);
  if (r.status !== expectExit) throw new Error(`${label} 退出码 ${r.status}，预期 ${expectExit}：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  if (!channel) return { stdout: r.stdout || '', stderr: r.stderr || '' };
  const text = r.stdout || '';
  const envelope = parseEnvelope(text, args[0], label);
  return { envelope, stdout: text, stderr: r.stderr || '' };
}
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv(), timeout: CHILD_TIMEOUT_MS, killSignal: 'SIGKILL' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return r.stdout.trim();
}

const PROPOSAL_SLUG = 'rd-smoke';
const DISPATCHER_MARKER = '.dispatcher-executed';
const SENTINEL = 'release/scripts/smoke-linked.sh';
const VERIFY_RUNNER = `const fs = require('fs');
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', JSON.stringify({ id: 'UT-S01-01', status: 'pass', scenario: 'S01' }) + '\\n');
`;
const FIXTURE_DISPATCHER = `const fs = require('fs');
fs.writeFileSync(${JSON.stringify(DISPATCHER_MARKER)}, 'executed\\n');
`;

/**
 * 一次性项目：经被测 CLI init 建立，单模块 core launched；verify.pre_run_command 只写 UT-S01-01 pass；smoke.command 为
 * `node scripts/run-smoke.js`（夹具 dispatcher，被执行时写标记）。项目外目录 X 含哨兵 runner 与少量普通文件，项目内放
 * 目录链接 `release → X` 与环形链接 `loop → .`。活跃提案 rd-smoke。
 * 臂 A：仓内 runner scripts/smoke-a.sh，提案无 smoke 用例 delta；臂 B：提案新增 SMOKE-core-950，仓内无 runner，无 smoke 结果文件。
 */
async function discoveryProject(entryPath, arm) {
  const root = realpathSync(tempDir(`proj-${arm}`));
  const outside = realpathSync(tempDir(`outside-${arm}`));
  await cliExpect(entryPath, root, ['init', 'rd-smoke', '--locale', 'zh', '--ai-tool', 'other'], 0, null);
  put(root, 'logos/logos-project.yaml', [
    'project:', '  name: "rd-smoke"', '  description: ""',
    'modules:', '  - id: core', '    name: core', '    lifecycle: launched',
    'resource_index: []', '',
  ].join('\n'));
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { ...(cfg.verify ?? {}), result_path: 'logos/resources/verify/test-results.jsonl', pre_run_command: 'node tools/verify.cjs', sandbox_mode: 'off' };
  cfg.smoke = { ...(cfg.smoke ?? {}), result_path: 'logos/resources/verify/smoke-results.jsonl', command: 'node scripts/run-smoke.js', sandbox_mode: 'off' };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  put(root, 'logos/resources/test/core-S01-test-cases.md', '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n');
  put(root, 'tools/verify.cjs', VERIFY_RUNNER);
  put(root, 'scripts/run-smoke.js', FIXTURE_DISPATCHER);
  rmSync(join(root, 'logos/resources/verify/smoke-results.jsonl'), { force: true });
  if (arm === 'A') {
    put(root, 'scripts/smoke-a.sh', '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(root, 'scripts/smoke-a.sh'), 0o755);
  }
  // 项目外目录：哨兵 runner + 少量普通文件；项目内的目录链接与环形链接
  put(outside, 'scripts/smoke-linked.sh', `#!/usr/bin/env bash\necho executed > ${JSON.stringify(join(outside, 'EXECUTED'))}\n`);
  for (let i = 0; i < 5; i += 1) put(outside, `data/file-${i}.txt`);
  link(outside, join(root, 'release'));
  link('.', join(root, 'loop'));
  put(root, `logos/changes/${PROPOSAL_SLUG}/proposal.md`, [
    `# 变更提案：${PROPOSAL_SLUG}`, '', '## 变更原因', '安装态夹具。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '', '## 部署影响', '- 是否需要部署：否', '- 是否需要 smoke：否', '', '## 变更概述', '夹具。', '',
  ].join('\n'));
  put(root, `logos/changes/${PROPOSAL_SLUG}/tasks.md`, ['# 实现任务', '', '## [code] 代码实现', '- [x] 实现（覆盖 UT-S01-01）', ''].join('\n'));
  put(root, `logos/changes/${PROPOSAL_SLUG}/SPEC_MERGED`, '{}\n');
  if (arm === 'B') {
    put(root, `logos/changes/${PROPOSAL_SLUG}/deltas/test/smoke/core-smoke-test-cases.md`, '| ID | 描述 |\n|---|---|\n| SMOKE-core-950 | 夹具专用 |\n');
  }
  put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: PROPOSAL_SLUG, module: 'core' }));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'openlogos-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture']);
  return { root, outside };
}

const linkedPath = p => p.startsWith('release/') || p.startsWith('loop/');

const CASES = {
  'SMOKE-core-336': async (entryPath) => {
    const problems = [];
    const evidence = [`entry_realpath=${entryPath}`];
    const work = realpathSync(tempDir('ver'));
    const version = (await cliExpect(entryPath, work, ['--version'], 0, null)).stdout.trim();
    evidence.push(`version=${version}`);
    if (!SELF_TEST) {
      evidence.push(`candidate=${DEPLOYED?.candidate_version}`, `deploy_id=${DEPLOYED?.deploy_id}`, `receipt_entry_realpath=${DEPLOYED?.entry_realpath}`);
      const versionProblem = installedVersionProblem(version, DEPLOYED);
      if (versionProblem) problems.push(versionProblem);
      const entryProblem = receiptEntryProblem(DEPLOYED, entryPath);
      if (entryProblem) problems.push(entryProblem);
    }
    const pkg = packageRoot(entryPath);
    if (!pkg) throw new Error(`无法从 ${entryPath} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`package_root=${pkg}`);
    let validate;
    try {
      validate = (await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href)).validateAssetManifest;
    } catch (e) {
      validate = () => { throw new Error(`无法加载安装包内的 validateAssetManifest：${e instanceof Error ? e.message : String(e)}`); };
    }
    const asset = assetManifestVerdict(validate, manifest, pkg, { selfTest: SELF_TEST });
    evidence.push(...asset.evidence);
    if (!asset.ok) problems.push(asset.problem);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return {
      detail: SELF_TEST
        ? `自测入口版本 ${version}，${asset.detail}`
        : `安装态版本等于本次成功部署回执的候选版本，入口与回执一致，${asset.detail}`,
      evidence,
    };
  },

  'SMOKE-core-337': async (entryPath) => {
    const problems = [];
    const evidence = [];
    // ① 臂 A：仓内有 runner、无新增 smoke 用例 → 退出码 0、PASS、runners 只含仓内 runner
    const a = await discoveryProject(entryPath, 'A');
    const ra = await cliExpect(entryPath, a.root, ['verify', '--format', 'json'], 0, 'stdout');
    const runnersA = ra.envelope?.data?.smoke_precheck?.runners ?? null;
    evidence.push(`armA gate=${ra.envelope?.data?.gate?.result} runners=${JSON.stringify(runnersA)}`);
    if (ra.envelope?.data?.gate?.result !== 'PASS') problems.push(`① 臂 A gate.result=${ra.envelope?.data?.gate?.result}，预期 PASS`);
    if (!Array.isArray(runnersA) || !runnersA.includes('scripts/smoke-a.sh')) problems.push(`① 臂 A runners 不含 scripts/smoke-a.sh：${JSON.stringify(runnersA)}`);
    if (Array.isArray(runnersA) && runnersA.some(linkedPath)) problems.push(`① 臂 A runners 含链接目录内的路径：${JSON.stringify(runnersA)}`);
    if (/RangeError/.test(ra.stderr)) problems.push('① 臂 A stderr 含 RangeError');
    // ② 臂 B：新增 smoke 用例、仓内无 runner、唯一 runner 在链接内 → 退出码 1、FAIL、smoke_runner_missing
    const b = await discoveryProject(entryPath, 'B');
    const rb = await cliExpect(entryPath, b.root, ['verify', '--format', 'json'], 1, 'stdout');
    const pre = rb.envelope?.data?.smoke_precheck;
    const codes = (pre?.diagnostics ?? []).map(d => d?.code);
    evidence.push(`armB gate=${rb.envelope?.data?.gate?.result} reason=${rb.envelope?.data?.gate?.reason} runners=${JSON.stringify(pre?.runners ?? null)} codes=${JSON.stringify(codes)}`);
    if (rb.envelope?.data?.gate?.result !== 'FAIL') problems.push(`② 臂 B gate.result=${rb.envelope?.data?.gate?.result}，预期 FAIL`);
    if (!Array.isArray(pre?.runners) || pre.runners.length !== 0) problems.push(`② 臂 B runners 应为空：${JSON.stringify(pre?.runners ?? null)}`);
    if (!codes.includes('smoke_runner_missing')) problems.push(`② 臂 B 诊断不含 smoke_runner_missing：${JSON.stringify(codes)}`);
    if (rb.envelope?.data?.gate?.reason !== 'smoke_runner_missing') problems.push(`② 臂 B gate.reason=${rb.envelope?.data?.gate?.reason}，预期 smoke_runner_missing`);
    if (/RangeError/.test(rb.stderr)) problems.push('② 臂 B stderr 含 RangeError');
    // ③ verify 只做静态预检：夹具 dispatcher 与哨兵 runner 都未被执行
    for (const [arm, p] of [['A', a], ['B', b]]) {
      if (existsSync(join(p.root, DISPATCHER_MARKER))) problems.push(`③ 臂 ${arm} 夹具 dispatcher 被执行`);
      if (existsSync(join(p.outside, 'EXECUTED'))) problems.push(`③ 臂 ${arm} 链接目录内的哨兵 runner 被执行`);
    }
    evidence.push(`sentinel=${SENTINEL}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '含目录链接与环形链接的项目中 verify 正常输出；臂 A PASS 且 runners 只含仓内 runner；臂 B 报 smoke_runner_missing；dispatcher 未执行', evidence };
  },
};

export const RUNNER_DISCOVERY_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
/** 正式账本：一次打开、经同一描述符追加全部结果行。 */
function openFormalLedger(path) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = nodeFs.openSync(path, 'a');
  return { path, write: text => { writeAll(nodeFs, fd, text); }, close: () => { nodeFs.closeSync(fd); } };
}
function flush(ledger) {
  const timestamp = new Date().toISOString();
  const out = ledger ?? openFormalLedger(resultPath);
  try {
    for (const id of RUNNER_DISCOVERY_SMOKE_IDS) {
      const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
      const record = { id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT };
      if (row.status !== 'skip' && !SELF_TEST) record.target_environment = TARGET_ENV ?? DEPLOY_ENV;
      record.detail = row.detail;
      record.evidence = row.evidence;
      out.write(`${JSON.stringify(record)}\n`);
    }
  } finally {
    out.close();
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

/**
 * UT-S19-124：部署前置。先读账本：deployments.jsonl 中 slug=SLUG（被复核的安装所属提案）、environment=test、result=done
 * 的最后一条 deploy 不存在 → { missing }（显式 skip，不采用其他提案的回执）。有记录时须与本机部署回执同一 deploy_id、
 * result=done、environment=test，源码候选版本须可读且等于回执 candidate_version，否则 { problem }（fail）。
 * 源码版本只在查到匹配部署记录之后才读取（readVersion），读取异常保留原因判 fail；无记录时不读取，照常 skip。
 * 不设固定版本下限；安装态 --version 与回执的比较由 installedVersionProblem 承担。
 */
export function deployedCandidate(root = repoRoot, readVersion = () => candidateVersion(root)) {
  const ledgerPath = join(root, DEPLOY_LEDGER);
  const rows = existsSync(ledgerPath)
    ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } })
    : [];
  const deploys = rows.filter(r => r.kind === 'deploy' && r.slug === SLUG && r.environment === DEPLOY_ENV && r.result === 'done' && r.rollback !== true);
  const last = deploys[deploys.length - 1];
  if (!last) return { missing: `部署账本 ${DEPLOY_LEDGER} 中没有本提案 ${SLUG} 在 ${DEPLOY_ENV} 的成功部署记录` };
  let version;
  try { version = readVersion(); } catch (e) {
    return { problem: `已有 ${SLUG} 的成功部署记录（deploy_id ${last.deploy_id}），但源码候选版本不可读（cli/src/lib/local-release-candidate.ts）：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!version) return { problem: `已有 ${SLUG} 的成功部署记录（deploy_id ${last.deploy_id}），但源码候选版本不可读（cli/src/lib/local-release-candidate.ts）` };
  const receiptPath = join(root, DEPLOY_RECEIPT);
  if (!existsSync(receiptPath)) return { problem: `本提案已有成功部署记录（deploy_id ${last.deploy_id}），但缺少部署回执 ${DEPLOY_RECEIPT}` };
  let receipt;
  try { receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); } catch (e) { return { problem: `部署回执 ${DEPLOY_RECEIPT} 无法解析：${e instanceof Error ? e.message : String(e)}` }; }
  const mismatch = [];
  if (receipt.deploy_id !== last.deploy_id) mismatch.push(`deploy_id 回执=${receipt.deploy_id} 账本=${last.deploy_id}`);
  if (receipt.result !== 'done') mismatch.push(`回执 result=${receipt.result}`);
  if (receipt.environment !== DEPLOY_ENV) mismatch.push(`回执 environment=${receipt.environment}`);
  if (receipt.candidate_version !== version) mismatch.push(`回执 candidate_version=${receipt.candidate_version}，源码候选版本=${version}`);
  if (mismatch.length > 0) return { problem: `本次成功部署回执与候选不符：${mismatch.join('；')}` };
  return { receipt };
}

let DEPLOYED = null;

async function main() {
  // ① 自测模式的拒绝规则
  if (!SELF_TEST && process.env.OPENLOGOS_RD_SMOKE_ENTRY !== undefined) {
    refuse('设置了 OPENLOGOS_RD_SMOKE_ENTRY 但未声明自测（OPENLOGOS_RD_SMOKE_SELF_TEST=1）');
  }
  if (SELF_TEST && !process.env.OPENLOGOS_RD_SMOKE_ENTRY) refuse('自测模式需要 OPENLOGOS_RD_SMOKE_ENTRY');
  if (SELF_TEST && (process.env.OPENLOGOS_SMOKE_ENV || process.env.OPENLOGOS_SMOKE_MODULE)) {
    refuse('正式 smoke 上下文（已注入 OPENLOGOS_SMOKE_ENV / OPENLOGOS_SMOKE_MODULE）中不得启用自测模式');
  }
  let selfTestLedger = null;
  if (SELF_TEST) {
    // 账本判定与打开发生在任何写入之前；拒绝即退出，不写任何结果
    try { selfTestLedger = openSelfTestLedger(repoRoot, resultPath, formalResultPath()); } catch (e) { refuse(e instanceof Error ? e.message : String(e)); }
  }

  // ② 目标环境优先：普通入口下目标非 test → 带原因的显式 skip，不声明 target_environment
  if (!SELF_TEST && TARGET_ENV && TARGET_ENV !== DEPLOY_ENV) {
    recordSmokeNotApplicable(OWNED, {
      reason: 'env-not-test', missing: [`OPENLOGOS_SMOKE_ENV=${DEPLOY_ENV}`], environment: ENVIRONMENT, repoRoot,
    });
    console.log(`smoke runner 发现安装态 smoke 不适用于环境 ${TARGET_ENV}，已写显式 skip`);
    process.exit(0);
  }

  // ③ 适用窗口
  if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_RD_SMOKE !== '1') {
    exitNotApplicable(OWNED, {
      reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_RD_SMOKE=1`,
      missing: ['active-change', 'OPENLOGOS_RD_SMOKE'], environment: ENVIRONMENT, repoRoot,
    });
  }

  let exitCode = 0;
  try {
    let entryPath = null;
    if (SELF_TEST) {
      entryPath = realpathSync(resolve(process.env.OPENLOGOS_RD_SMOKE_ENTRY));
    } else {
      // ④ 部署前置：先查账本，无记录才 skip；有记录时版本不可读或与回执不符判 fail
      const skip = (reason, missing) => exitNotApplicable(OWNED, { reason, missing, environment: ENVIRONMENT, repoRoot });
      const deployed = deployedCandidate(repoRoot);
      if (deployed.missing) skip(deployed.missing, ['deployment-record']);
      if (deployed.problem) {
        for (const id of OWNED) results.set(id, { status: 'fail', detail: deployed.problem, evidence: [], duration_ms: 0 });
      } else {
        DEPLOYED = deployed.receipt;
        entryPath = globalEntry();
        const problem = !entryPath ? '找不到 openlogos 入口' : globalInstallProblem(entryPath);
        if (problem) {
          for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
          entryPath = null;
        }
      }
    }
    if (entryPath) {
      for (const id of RUNNER_DISCOVERY_SMOKE_IDS) {
        const started = Date.now();
        try {
          const out = await CASES[id](entryPath);
          results.set(id, { status: 'pass', detail: out.detail, evidence: [`entry=${entryPath}`, ...out.evidence], duration_ms: Date.now() - started });
        } catch (error) {
          results.set(id, {
            status: 'fail', detail: error instanceof Error ? error.message : String(error),
            evidence: [`entry=${entryPath}`, ...(error?.evidence ?? [])], duration_ms: Date.now() - started,
          });
        }
      }
    }
  } finally {
    flush(selfTestLedger);
    // 先删链接再删目录，避免 rm 顺着链接进入项目外目录
    for (const l of links) { try { unlinkSync(l); } catch { /* 已删除 */ } }
    for (const s of scopes) rmSync(s, { recursive: true, force: true });
  }

  const failed = RUNNER_DISCOVERY_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail');
  if (failed.length > 0) {
    exitCode = 1;
    console.error(`smoke 失败：${failed.join(', ')}`);
    for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  } else {
    console.log(`smoke 通过：${RUNNER_DISCOVERY_SMOKE_IDS.join(', ')}`);
  }
  process.exit(exitCode);
}

/** 作为入口执行时才运行主流程；以模块方式导入（单测）时只暴露判定函数（与 scripts/run-smoke.js 同一写法）。 */
function invokedAsEntry() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedAsEntry()) await main();
