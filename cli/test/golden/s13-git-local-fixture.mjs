/**
 * verify-git-local-only 的夹具辅助（logos/resources/test/core-S13-test-cases.md「S13 验收期间的 git 调用只读本地测试」）。
 * 叠加在夹具 MS（s13-module-scope-fixture.mjs）与夹具 LV（s13-layered-fixture.mjs）之上：
 *
 *   - 远端：项目外的本机裸仓库，持有项目的全部对象并允许按对象取回；项目把它登记为远端，只配置 URL 与取回过滤器
 *     （不设 promisor 与 extensions.partialclone），并显式配置 protocol.file.allow=always。
 *   - 远端接入记录：remote.<name>.uploadpack 指向记录型包装脚本，远端一侧每被调用一次就在项目外追加一行。
 *   - 对象库快照：松散对象与 pack 目录的文件清单。
 *   - git 调用记录：经只读 git 执行入口的测试接缝，用 node 启动一个记录型程序代替 git——它先记下自己实际收到的参数与
 *     三个约束变量，再转交真实的 git；可让参数匹配的调用先写出自己的 PID 再长时间等待（验证超时终止）。
 *     不依赖 PATH 查找、shebang 与路径分隔符，Windows 上同样可用。
 *   - git 跟踪：GIT_TRACE 写到项目外的文件，由 git 自己记下进程树里每一次 git 调用（含测试入口自己启动的）。
 *   - 环境隔离：夹具自己的 git 与交给 CLI 子进程的环境都去掉宿主的仓库定位、索引与对象库变量，
 *     临时项目的操作不会落到外部仓库。
 *
 * 作为脚本运行时生成 UT-S13-318 的 golden（对象齐全时两套夹具在引入前实现上的输出）：
 *   node cli/test/golden/s13-git-local-fixture.mjs <引入前 CLI 的 dist/index.js> <输出 json>
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createScopeProject, normalizer as msNormalizer, runVerify as runMsVerify } from './s13-module-scope-fixture.mjs';
import { msProposal } from './s13-shared-config-fixture.mjs';
import { createLv, destroyLv, normalizeRun as normalizeLvRun, runVerify as runLvVerify } from './s13-layered-fixture.mjs';

const GIT_ID = {
  GIT_AUTHOR_NAME: 'vgl', GIT_AUTHOR_EMAIL: 'vgl@example.invalid',
  GIT_COMMITTER_NAME: 'vgl', GIT_COMMITTER_EMAIL: 'vgl@example.invalid',
  GIT_AUTHOR_DATE: '2026-11-28T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-28T00:00:00Z',
};

/**
 * 会把 git 的读写引到工作目录之外的环境变量（仓库定位、工作树、索引、对象库、公共目录、命名空间与配置注入）。
 * 夹具自己的 git 与交给 CLI 子进程的环境都必须去掉它们：否则即使工作目录是临时项目，对象、索引或配置也可能写进宿主仓库。
 */
export const GIT_LOCATION_ENV_KEYS = [
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR',
  'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_CEILING_DIRECTORIES', 'GIT_CONFIG', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS',
];
/** 供传给 CLI 子进程的 env 选项使用：把上面的变量显式置为 undefined（子进程环境中不出现）。 */
export const isolatedGitEnv = () => Object.fromEntries(GIT_LOCATION_ENV_KEYS.map(key => [key, undefined]));

/** 不带任何约束的 git（夹具自己的操作与对照步骤用）；去掉可能继承来的约束变量与仓库定位变量。 */
export function plainGit(root, args, { allowFail = false } = {}) {
  const env = { ...process.env, ...GIT_ID };
  for (const key of ['GIT_ALLOW_PROTOCOL', 'GIT_NO_LAZY_FETCH', 'GIT_TERMINAL_PROMPT', ...GIT_LOCATION_ENV_KEYS]) delete env[key];
  for (const key of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete env[key];
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env });
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return { status: r.status, stdout: (r.stdout ?? '').trim(), stderr: r.stderr ?? '' };
}

const scratch = [];
export function scratchDir(tag) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `openlogos-vgl-${tag}-`)));
  scratch.push(dir);
  return dir;
}
export function cleanupScratch() {
  while (scratch.length) rmSync(scratch.pop(), { recursive: true, force: true });
}

/**
 * 给项目登记一个可以按需提供对象的本机远端，并装上远端接入记录。返回 { dir, origin, log }。
 * 调用时项目的全部对象都会进入远端；之后才制造缺失。
 */
export function attachRemote(root) {
  // 目录名带空格：远端命令路径的引用在每次运行中都被真实验证
  const dir = scratchDir('remote dir');
  const origin = join(dir, 'origin.git');
  plainGit(root, ['clone', '-q', '--bare', root, origin]);
  plainGit(origin, ['config', 'uploadpack.allowfilter', 'true']);
  plainGit(origin, ['config', 'uploadpack.allowanysha1inwant', 'true']);
  const log = join(dir, 'remote-access.log');
  const wrapper = join(dir, 'upload-pack-recorder.sh');
  writeFileSync(wrapper, `#!/bin/sh\necho "upload-pack $*" >> ${shellQuote(log)}\nexec git-upload-pack "$@"\n`);
  chmodSync(wrapper, 0o755);
  plainGit(root, ['remote', 'add', 'origin', `file://${origin}`]);
  plainGit(root, ['config', 'remote.origin.partialclonefilter', 'blob:none']);
  plainGit(root, ['config', 'protocol.file.allow', 'always']);
  // remote.<name>.uploadpack 的取值会被拼进 shell 命令：路径必须按 shell 规则引用，否则含空格的路径在空格处被拆开
  plainGit(root, ['config', 'remote.origin.uploadpack', shellQuote(wrapper)]);
  return { dir, origin, log };
}

/**
 * 按 POSIX shell 规则引用一个路径：单引号包裹，内部的单引号转义；反斜杠统一写成正斜杠
 *（git 在 Windows 上经其自带的 sh 执行这条命令，正斜杠路径在两边都有效）。
 */
export function shellQuote(path) {
  return `'${String(path).replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`;
}

/** 远端接入记录的行数（远端收到了几次请求）。 */
export const remoteHits = remote => (existsSync(remote.log) ? readFileSync(remote.log, 'utf8').split('\n').filter(Boolean).length : 0);
export const clearRemoteLog = remote => rmSync(remote.log, { force: true });

/** 对象库快照：松散对象与 pack 目录的文件清单（排序后的相对路径）。 */
export function objectSnapshot(root) {
  const objects = join(root, '.git/objects');
  const out = [];
  for (const entry of readdirSync(objects, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'info') continue;
    for (const file of readdirSync(join(objects, entry.name))) out.push(`${entry.name}/${file}`);
  }
  return out.sort();
}

const loosePath = (root, id) => join(root, '.git/objects', id.slice(0, 2), id.slice(2));

/** 从本地对象库删除一个松散对象（夹具刚建好时对象都是松散的）。 */
export function dropLooseObject(root, id) {
  const path = loosePath(root, id);
  if (!existsSync(path)) throw new Error(`对象 ${id} 不是松散对象，无法制造缺失`);
  rmSync(path);
}

/** 提案起点中某个文件的内容对象 id。 */
export const baseBlobOf = (root, baseRef, file) => plainGit(root, ['rev-parse', `${baseRef}:${file}`]).stdout;

/**
 * 对照步骤：不加任何保护、直接读取同一个缺失对象，证明远端接入记录有区分力（记录中出现条目且对象被取回）；
 * 随后恢复缺失状态、清空记录。证明不了时抛错，夹具直接失败。
 */
export function proveRecorderAndRestore(root, remote, missingId, before) {
  clearRemoteLog(remote);
  const probe = plainGit(root, ['cat-file', '-e', missingId], { allowFail: true });
  const fetched = probe.status === 0;
  const hits = remoteHits(remote);
  // 恢复：删掉取回的对象（松散或 pack），回到制造缺失之后的快照
  const keep = new Set(before);
  for (const rel of objectSnapshot(root)) if (!keep.has(rel)) rmSync(join(root, '.git/objects', rel), { force: true });
  clearRemoteLog(remote);
  if (!fetched || hits === 0) throw new Error(`远端接入记录没有区分力：不加保护读取 ${missingId} 时 fetched=${fetched} hits=${hits}`);
  const after = objectSnapshot(root);
  if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error('对照步骤之后未能恢复缺失状态');
}

/**
 * `+缺内容`：删除某个已跟踪文件在提案起点中的内容对象，并完成对照步骤。返回 { blob, snapshot }。
 * 调用前该文件必须已在工作区被修改（差异计算才会去读它）。
 */
export function makeContentMissing(root, remote, baseRef, file) {
  const blob = baseBlobOf(root, baseRef, file);
  dropLooseObject(root, blob);
  const snapshot = objectSnapshot(root);
  proveRecorderAndRestore(root, remote, blob, snapshot);
  return { blob, snapshot };
}

/**
 * `+缺起点`：在远端造一个本地没有的提交，并完成对照步骤。返回 { commit, snapshot }。
 * 调用方把 guard 的 baseRef 改成它。
 */
export function makeRemoteOnlyCommit(root, remote) {
  const work = join(remote.dir, 'remote-only-work');
  plainGit(remote.dir, ['clone', '-q', remote.origin, work]);
  plainGit(work, ['commit', '-q', '--allow-empty', '-m', 'remote only']);
  const commit = plainGit(work, ['rev-parse', 'HEAD']).stdout;
  plainGit(work, ['push', '-q', 'origin', 'HEAD:refs/heads/remote-only']);
  const snapshot = objectSnapshot(root);
  proveRecorderAndRestore(root, remote, commit, snapshot);
  return { commit, snapshot };
}

/** 把 guard 的 baseRef 改为指定提交。 */
export function setGuardBaseRef(root, baseRef) {
  const path = join(root, 'logos/.openlogos-guard');
  const guard = JSON.parse(readFileSync(path, 'utf8'));
  writeFileSync(path, JSON.stringify({ ...guard, baseRef }, null, 2));
}

const RECORDER = `import { appendFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const pick = key => (key in process.env ? process.env[key] : '<unset>');
if (process.env.VGL_GIT_LOG) {
  appendFileSync(process.env.VGL_GIT_LOG, JSON.stringify({
    args: args.join(' '), allowProtocol: pick('GIT_ALLOW_PROTOCOL'), noLazyFetch: pick('GIT_NO_LAZY_FETCH'), terminalPrompt: pick('GIT_TERMINAL_PROMPT'),
  }) + '\\n');
}
const wait = process.env.VGL_GIT_WAIT_MATCH;
if (wait && args.join(' ').includes(wait)) {
  writeFileSync(process.env.VGL_GIT_PID_FILE, String(process.pid));
  setTimeout(() => process.exit(0), 300000);
} else {
  const r = spawnSync('git', args, { stdio: 'inherit' });
  process.exit(r.status === null ? 1 : r.status);
}
`;

/**
 * git 调用记录：返回 { dir, log, pidFile, trace, env(extra) }。env() 给出交给 CLI 子进程的环境变量：
 *   - 只读 git 执行入口改为用 node 启动记录型程序（它记下实际收到的参数与约束变量，再转交真实的 git）；
 *   - GIT_TRACE 指向项目外的文件，由 git 自己记下进程树里的每一次调用；
 *   - 宿主的仓库定位变量被去掉。
 * extra 里的 VGL_GIT_WAIT_MATCH：参数（空格连接）包含该字符串的调用先把自己的 PID 写入 pidFile，然后长时间等待。
 */
export function installGitRecorder() {
  const dir = scratchDir('gitrec');
  const log = join(dir, 'git-calls.jsonl');
  const pidFile = join(dir, 'waiting.pid');
  const trace = join(dir, 'git-trace.log');
  const script = join(dir, 'git-recorder.mjs');
  writeFileSync(script, RECORDER);
  return {
    dir, log, pidFile, trace,
    env: (extra = {}) => ({
      ...isolatedGitEnv(),
      OPENLOGOS_TEST_GIT_READONLY_COMMAND: JSON.stringify([process.execPath, script]),
      VGL_GIT_LOG: log, VGL_GIT_PID_FILE: pidFile, GIT_TRACE: trace, ...extra,
    }),
  };
}

/** 读取 git 调用记录（只读执行入口启动的调用）：[{ args, allowProtocol, noLazyFetch, terminalPrompt }]。 */
export function readGitCalls(recorder) {
  if (!existsSync(recorder.log)) return [];
  return readFileSync(recorder.log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

/** 读取 git 跟踪：进程树里每一次 git 内建命令的参数（空格连接），含测试入口自己启动的调用。 */
export function readGitTrace(recorder) {
  if (!existsSync(recorder.trace)) return [];
  const out = [];
  for (const line of readFileSync(recorder.trace, 'utf8').split('\n')) {
    const m = /trace: built-in: git (.*)$/.exec(line);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** 进程是否仍然存在。 */
export function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// —— 夹具组合 ——

/** 夹具 MS：多模块项目 + 活跃提案（归属 portal-web，已改 portal-web/app.ts）+ 远端。返回 { root, remote, baseRef }。 */
export function msWithRemote(proposal = {}) {
  const root = createScopeProject();
  msProposal(root, proposal);
  const baseRef = JSON.parse(readFileSync(join(root, 'logos/.openlogos-guard'), 'utf8')).baseRef;
  const remote = attachRemote(root);
  return { root, remote, baseRef };
}

/** 夹具 LV：分层项目 + 活跃提案（另改 src/core.ts）+ 远端。返回 { f, remote, baseRef }。 */
export function lvWithRemote(buildTestChangeSet, opts = {}) {
  const f = createLv({ buildTestChangeSet, changes: { 'src/core.ts': 'export const core = 2;\n' }, ...opts });
  const baseRef = JSON.parse(readFileSync(join(f.root, 'logos/.openlogos-guard'), 'utf8')).baseRef;
  const remote = attachRemote(f.root);
  return { f, remote, baseRef };
}

// —— UT-S13-318 的 golden：对象齐全时两套夹具的输出 ——

function normalizeMs(root, run) {
  const norm = msNormalizer(root);
  const env = run.envelope ? { ...run.envelope } : null;
  if (env) { delete env.version; delete env.timestamp; }
  if (env?.data && typeof env.data === 'object') { env.data = { ...env.data }; delete env.data.history; }
  return {
    status: run.status,
    envelope: env ? JSON.parse(norm(JSON.stringify(env))) : null,
    calls: run.calls,
    report: run.report === null ? null : norm(run.report),
  };
}

/** 对象齐全（登记了远端但不删除任何对象）时的观测；只依赖 CLI 入口，对引入前、引入后的构建都能运行。 */
export function observeComplete(cliEntry, buildTestChangeSet) {
  const out = {};
  const ms = msWithRemote();
  try {
    // 阳性对照：同一夹具的远端上造一个与验收输入无关、只存在于远端的提交，先取回一次证明远端接入记录能观测到访问，再还原
    makeRemoteOnlyCommit(ms.root, ms.remote);
    out['ms-narrowed'] = normalizeMs(ms.root, runMsVerify(cliEntry, ms.root, { env: isolatedGitEnv() }));
    out['ms-remote-hits'] = remoteHits(ms.remote);
  } finally {
    rmSync(ms.root, { recursive: true, force: true });
  }
  const lv = lvWithRemote(buildTestChangeSet);
  try {
    makeRemoteOnlyCommit(lv.f.root, lv.remote);
    out['lv-narrowed'] = normalizeLvRun(lv.f, runLvVerify(cliEntry, lv.f, { env: isolatedGitEnv() }));
    out['lv-remote-hits'] = remoteHits(lv.remote);
  } finally {
    destroyLv(lv.f);
  }
  cleanupScratch();
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('s13-git-local-fixture.mjs') && process.argv[2] && process.argv[3]) {
  const lib = await import(pathToFileURL(resolve(dirname(process.argv[2]), 'lib/test-change-set.js')).href);
  writeFileSync(process.argv[3], `${JSON.stringify(observeComplete(process.argv[2], lib.buildTestChangeSet), null, 2)}\n`);
  console.log(`golden written: ${process.argv[3]}`);
}
