#!/usr/bin/env node
/**
 * SMOKE-core-303～SMOKE-core-305 — 0.16.13 CLI 管道输出完整排空的**安装态**取证（来源提案 fix-cli-exit-truncates-piped-output，
 * 场景 S16「非零退出时 JSON envelope 排空后退出 > CLI 入口统一设置阻塞写」EX-2.7、EX-2.8；发布提案 release-0-16-13）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.13 CLI 管道输出完整排空安装态 smoke（SMOKE-core-303～305）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.13 本机测试环境发布（release-0-16-13）」。
 *
 *   - SMOKE-core-303：安装态版本与制品身份（payloadHash 自洽，包内含 dist/lib/stdio-blocking.js 且入口引用 ensureBlockingStdio）。
 *   - SMOKE-core-304：全局 CLI 经 Node spawn（socketpair）读取 change-lint --format json 与 merge preflight 的大输出完整、退出码保留。
 *   - SMOKE-core-305：消费方暂停读取时 deploy 超时仍按时终止进程树、watch 收到 SIGINT 仍及时退出（仅 POSIX）。
 *
 * 临时项目一律经被测 CLI `init` 建立后写入夹具；全局 CLI 以入口绝对路径经 Node spawn 调用；全部写入只在一次性目录内，
 * 结束即删除；对全局安装态只读，不读写本仓 logos/resources/（结果账本除外）。
 *
 * **窗口**：活跃变更为 release-0-16-13，或 OPENLOGOS_R01613_SMOKE=1；窗口外为全部 owned ID 写 skip。
 * **适用性**（缺即显式 skip）：候选版本（local-release-candidate.ts）不早于 0.16.13；部署记录记载候选版本。
 * **自测模式**（须同时满足）：OPENLOGOS_R01613_SMOKE_SELF_TEST=1、OPENLOGOS_R01613_SMOKE_ENTRY（候选入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置，结果以 environment=self-test-injected-entry 写入。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'release-0-16-13';
const OWNED = ['SMOKE-core-303', 'SMOKE-core-304', 'SMOKE-core-305'];
const MIN_VERSION = '0.16.13';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const PIPE_BUFFER = 65536;
const DELTA_COUNT = 300;
const LINT_SLUG = 'big-lint';
const ECHO_LINES = 3000;
const POSIX = process.platform !== 'win32';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_R01613_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd = repoRoot, extra = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, ...extra });
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
function candidateVersion() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
  return /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null;
}
function versionAtLeast(version, min) {
  const parse = v => (/^(\d+)\.(\d+)\.(\d+)/.exec(v ?? '') ?? []).slice(1).map(Number);
  const a = parse(version); const b = parse(min);
  if (a.length !== 3) return false;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

if (!SELF_TEST && process.env.OPENLOGOS_R01613_SMOKE_ENTRY !== undefined) {
  refuse('设置了 OPENLOGOS_R01613_SMOKE_ENTRY 但未声明自测（OPENLOGOS_R01613_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && !process.env.OPENLOGOS_R01613_SMOKE_ENTRY) refuse('自测模式需要 OPENLOGOS_R01613_SMOKE_ENTRY');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_R01613_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_R01613_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_R01613_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-r01613-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_R01613_')) delete env[key];
    if (key === 'OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS' || key === 'OPENLOGOS_STDIO_TRACE') delete env[key];
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDE_PROJECT_DIR'].includes(key)) delete env[key];
  }
  return { ...env, ...extra };
}
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 300)}`);
  return r.stdout.trim();
}
function cliOk(entry, root, args) {
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd: root, encoding: 'utf8', env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home') }), timeout: 300_000, input: '',
  });
  if (r.status !== 0) throw new Error(`openlogos ${args.join(' ')} 失败：exit ${r.status} ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  return r;
}

/** Node spawn 启动被测 CLI（默认 stdio 为 socketpair）；不挂 data 监听即为「消费方暂缓读取」。 */
function startCli(entry, root, args, extra = {}) {
  return spawn(process.execPath, [entry, ...args], {
    cwd: root, env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home'), ...extra }), stdio: ['ignore', 'pipe', 'pipe'],
  });
}
/** 开始读取并等待 close。 */
function collect(child) {
  return new Promise((res, rej) => {
    const out = []; const err = [];
    child.stdout.on('data', c => out.push(c));
    child.stderr.on('data', c => err.push(c));
    child.on('error', rej);
    child.on('close', (code, signal) => res({ code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }));
  });
}
const exited = child => (child.exitCode !== null || child.signalCode !== null
  ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  : new Promise(res => child.once('exit', (code, signal) => res({ code, signal }))));
async function within(p, ms, label) {
  let timer;
  try {
    return await Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`超时：${label}`)), ms); })]);
  } finally { clearTimeout(timer); }
}
async function waitFor(cond, ms, label) {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > ms) throw new Error(`等待超时：${label}`);
    await sleep(50);
  }
}
const pidGone = pid => { try { process.kill(pid, 0); return false; } catch (e) { return e.code === 'ESRCH'; } };

/** 经被测 CLI init 建立的一次性项目，模块登记表写为给定 YAML。 */
function initProject(entry, tag, modulesYaml) {
  const root = realpathSync(tempDir(tag));
  cliOk(entry, root, ['init', 'r01613', '--locale', 'zh', '--ai-tool', 'other']);
  put(root, 'logos/logos-project.yaml', `project:\n  name: "r01613"\nmodules:\n${modulesYaml}`);
  return root;
}
const CORE_LAUNCHED = '  - id: core\n    name: core\n    lifecycle: launched\n';

/** 活跃提案含 DELTA_COUNT 个缺段标记的 delta：change-lint 违规与 merge preflight 输出均 > 65536 字节。 */
function bigLintProject(entry) {
  const root = initProject(entry, 'lint', CORE_LAUNCHED);
  const dir = join(root, 'logos/changes', LINT_SLUG);
  put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: LINT_SLUG, module: 'core' }));
  put(root, `logos/changes/${LINT_SLUG}/proposal.md`, `# 变更提案：${LINT_SLUG}\n`);
  put(root, `logos/changes/${LINT_SLUG}/tasks.md`, '# 实现任务\n');
  for (let i = 0; i < DELTA_COUNT; i += 1) {
    put(root, relative(root, join(dir, `deltas/prd/1-product-requirements/core-${String(i).padStart(3, '0')}-big.md`)), 'no markers\n');
  }
  return root;
}
const isDeltaViolation = text => text.includes(`logos/changes/${LINT_SLUG}/deltas/`);

const FILLER = (lines, tag) => `awk 'BEGIN { for (i = 0; i < ${lines}; i++) printf "${tag} %d ${'x'.repeat(96)}\\n", i }'`;
const DEPLOY_SCRIPT = `#!/bin/sh
sleep 60 &
echo $! > "$PUBLISH_DIR/child.pid"
echo $$ > "$PUBLISH_DIR/script.pid"
${FILLER(ECHO_LINES, 'deploy-echo')}
sleep 60
`;

/** 版本通道 script 部署夹具：prod 环境 timeout_sec=3，脚本先记录进程号再回显 > 65536 字节后休眠。 */
function deployProject(entry, timeoutSec) {
  const root = initProject(entry, 'deploy', CORE_LAUNCHED);
  put(root, 'logos/environments.yaml', [
    'schema_version: 1', 'environments:', '  - id: prod', '    name: Production', '    tier: prod', '    deploy:',
    '      mode: script', '      script: deploy/run.sh', `      timeout_sec: ${timeoutSec}`, '',
  ].join('\n'));
  put(root, 'deploy/run.sh', DEPLOY_SCRIPT);
  chmodSync(join(root, 'deploy/run.sh'), 0o755);
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'openlogos-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}

const CASES = {
  'SMOKE-core-303': async (entry) => {
    const problems = [];
    const evidence = [`entry_realpath=${entry}`];
    const version = (run(process.execPath, [entry, '--version']).stdout || '').trim();
    const candidate = SELF_TEST ? version : candidateVersion();
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (version !== candidate) problems.push(`① --version 为 ${version}，部署记录候选版本为 ${candidate}`);
    if (!versionAtLeast(version, MIN_VERSION)) problems.push(`① --version ${version} 早于 ${MIN_VERSION}`);
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`package_root=${pkg}`, `payload_hash=${manifest.payloadHash}`);
    try {
      const lib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
      lib.validateAssetManifest(manifest, pkg);
    } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    const helper = join(pkg, 'dist/lib/stdio-blocking.js');
    if (!existsSync(helper)) problems.push('③ 包内缺少 dist/lib/stdio-blocking.js');
    else evidence.push(`stdio_blocking_sha256=${createHash('sha256').update(readFileSync(helper)).digest('hex')}`);
    if (!readFileSync(join(pkg, 'dist/index.js'), 'utf8').includes('ensureBlockingStdio')) problems.push('③ 入口 dist/index.js 未引用 ensureBlockingStdio');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装态版本等于候选、payloadHash 自洽、包内含管道排空 helper 且入口已接入', evidence };
  },

  'SMOKE-core-304': async (entry) => {
    const problems = [];
    const root = bigLintProject(entry);
    const lint = await within(collect(startCli(entry, root, ['change-lint', '--format', 'json'])), 120_000, 'change-lint');
    const evidence = [`change_lint_bytes=${lint.stdout.length}`, `change_lint_exit=${lint.code}`];
    let violations = null;
    try { violations = JSON.parse(lint.stdout.toString('utf8')).data.violations; } catch { problems.push(`① change-lint JSON 不可解析（收到 ${lint.stdout.length} 字节）`); }
    if (lint.stdout.length <= PIPE_BUFFER) problems.push(`① 收到字节数 ${lint.stdout.length} 未超过 ${PIPE_BUFFER}，夹具不足`);
    if (violations && violations.filter(v => isDeltaViolation(v.path)).length !== DELTA_COUNT) problems.push(`① delta 违规条数不为 ${DELTA_COUNT}`);
    if (lint.code !== 2) problems.push(`① 退出码为 ${lint.code}，应为 2`);

    const merge = await within(collect(startCli(entry, root, ['merge', LINT_SLUG])), 120_000, 'merge');
    const stderr = merge.stderr.toString('utf8');
    const listed = stderr.split('\n').filter(l => /^ {2}- \[/.test(l));
    evidence.push(`merge_stderr_bytes=${merge.stderr.length}`, `merge_listed=${listed.length}`, `merge_exit=${merge.code}`);
    if (merge.stderr.length <= PIPE_BUFFER) problems.push(`② merge stderr ${merge.stderr.length} 字节未超过 ${PIPE_BUFFER}`);
    if (violations && listed.length !== violations.length) problems.push(`② merge 列出 ${listed.length} 条违规，change-lint 为 ${violations.length}`);
    if (!stderr.includes(`自查命令：openlogos change-lint --slug ${LINT_SLUG}`)) problems.push('② merge stderr 末尾自查提示缺失（尾部被截断）');
    if (merge.code !== 1) problems.push(`② merge 退出码为 ${merge.code}，应为 1`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: 'change-lint JSON 与 merge preflight 违规清单经 Node spawn 管道完整读到，退出码 2 / 1 保留', evidence };
  },

  'SMOKE-core-305': async (entry) => {
    if (!POSIX) return { skip: true, detail: '非 POSIX 平台：进程树 / 进程组与信号断言不适用', missing: ['posix'] };
    const problems = [];
    const evidence = [];
    // ① ② deploy 超时：消费方暂缓读取
    const timeoutSec = 3;
    const root = deployProject(entry, timeoutSec);
    const publish = tempDir('publish');
    const child = startCli(entry, root, ['deploy', '--env', 'prod', '--ref', 'HEAD'], { PUBLISH_DIR: publish });
    const pidFile = name => join(publish, name);
    await waitFor(() => existsSync(pidFile('child.pid')) && existsSync(pidFile('script.pid')), 60_000, '部署脚本启动');
    const scriptPid = Number(readFileSync(pidFile('script.pid'), 'utf8').trim());
    const grandchild = Number(readFileSync(pidFile('child.pid'), 'utf8').trim());
    const started = Date.now();
    try {
      await waitFor(() => pidGone(scriptPid) && pidGone(grandchild), timeoutSec * 1000 + 10_000, '超时终止进程树');
      evidence.push(`tree_killed_after_ms=${Date.now() - started}`);
      if (child.exitCode !== null) problems.push('① CLI 在消费方读取前已退出（区间末尾未等待排空）');
    } catch (e) {
      problems.push(`① ${e.message}：消费方暂停时部署超时未按时终止进程树`);
      for (const pid of [scriptPid, grandchild]) { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ } }
    }
    const deployRun = await within(collect(child), 60_000, '恢复读取后 deploy 退出');
    const out = deployRun.stdout.toString('utf8');
    evidence.push(`deploy_stdout_bytes=${deployRun.stdout.length}`, `deploy_exit=${deployRun.code}`);
    if (!out.includes(`deploy-echo ${ECHO_LINES - 1} `)) problems.push('② 回显末行缺失');
    if (deployRun.code !== 1) problems.push(`② deploy 退出码为 ${deployRun.code}，应为 1`);

    // ③ watch：400 模块使单帧快照 > 65536 字节，消费方暂缓读取
    const modules = Array.from({ length: 400 }, (_, i) => `  - id: m${i}\n    name: Module ${i}\n    lifecycle: launched\n`).join('');
    const watchRoot = initProject(entry, 'watch', modules);
    const trace = join(tempDir('trace'), 'trace.log');
    const watch = startCli(entry, watchRoot, ['watch', '--format', 'json', '--interval', '60'], { OPENLOGOS_STDIO_TRACE: trace });
    try {
      await waitFor(() => existsSync(trace) && readFileSync(trace, 'utf8').includes(' watch-ready '), 60_000, 'watch 常驻区间就绪');
      watch.kill('SIGINT');
      const r = await within(exited(watch), 10_000, 'SIGINT 后 watch 退出');
      evidence.push(`watch_exit=${r.code}`, `watch_signal=${r.signal}`);
      if (r.code !== 0 || r.signal !== null) problems.push(`③ watch 退出为 code=${r.code} signal=${r.signal}，应为 0 且无信号`);
    } catch (e) {
      problems.push(`③ ${e.message}`);
      watch.kill('SIGKILL');
    } finally {
      watch.stdout.destroy();
      watch.stderr.destroy();
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '消费方暂停读取时部署超时按时终止进程树、恢复读取后输出完整；watch 收到 SIGINT 以 0 退出', evidence };
  },
};

export const RELEASE_0_16_13_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of RELEASE_0_16_13_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
    const record = { id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT };
    if (row.status !== 'skip' && TARGET_ENV) record.target_environment = TARGET_ENV;
    record.detail = row.detail;
    record.evidence = row.evidence;
    if (row.status === 'skip') { record.not_applicable_reason = row.detail; record.missing_requirements = row.missing ?? []; }
    appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  }
}

function globalEntry() {
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-c', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}
function globalInstallProblem(entry) {
  const r = run(npmBin, ['prefix', '-g']);
  if (r.status !== 0 || !r.stdout.trim()) return `无法读取 npm prefix -g：${(r.stderr || '').slice(0, 200)}`;
  const prefix = realpathSync(r.stdout.trim());
  const nodeModules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  const pkgDir = join(nodeModules, '@miniidealab', 'openlogos');
  const inside = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  if (lstatSync(pkgDir).isSymbolicLink()) return `全局包目录 ${pkgDir} 是链接（workspace link 不构成安装态证据）`;
  if (!inside(realpathSync(pkgDir), entry)) return `入口 ${entry} 不在全局 npm prefix 的包目录 ${pkgDir} 内`;
  if (inside(repoRoot, entry)) return `入口 ${entry} 位于工作区 ${repoRoot} 内`;
  return null;
}

let exitCode = 0;
try {
  let entry = null;
  if (SELF_TEST) {
    entry = realpathSync(resolve(process.env.OPENLOGOS_R01613_SMOKE_ENTRY));
  } else {
    const skip = (reason, missing) => exitNotApplicable(OWNED, { reason, missing, environment: ENVIRONMENT, repoRoot });
    const version = candidateVersion();
    if (!versionAtLeast(version, MIN_VERSION)) skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-version']);
    const record = existsSync(join(repoRoot, DEPLOYMENT_RECORD)) ? readFileSync(join(repoRoot, DEPLOYMENT_RECORD), 'utf8') : '';
    if (!record.includes(version)) skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version}`, ['deployment-record']);
    entry = globalEntry();
    const problem = !entry ? '找不到 openlogos 入口' : globalInstallProblem(entry);
    if (problem) {
      for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
      entry = null;
    }
  }
  if (entry) {
    for (const id of RELEASE_0_16_13_SMOKE_IDS) {
      const started = Date.now();
      try {
        const out = await CASES[id](entry);
        if (out.skip) results.set(id, { status: 'skip', detail: out.detail, missing: out.missing, evidence: [], duration_ms: Date.now() - started });
        else results.set(id, { status: 'pass', detail: out.detail, evidence: [`entry=${entry}`, ...out.evidence], duration_ms: Date.now() - started });
      } catch (error) {
        results.set(id, {
          status: 'fail', detail: error instanceof Error ? error.message : String(error),
          evidence: [`entry=${entry}`, ...(error?.evidence ?? [])], duration_ms: Date.now() - started,
        });
      }
    }
  }
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = RELEASE_0_16_13_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail');
const skipped = RELEASE_0_16_13_SMOKE_IDS.filter(id => results.get(id)?.status === 'skip');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${RELEASE_0_16_13_SMOKE_IDS.filter(id => !skipped.includes(id)).join(', ')}${skipped.length ? `（skip：${skipped.join(', ')}）` : ''}`);
}
process.exit(exitCode);
