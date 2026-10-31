/**
 * fix-cli-exit-truncates-piped-output：CLI 退出时管道输出完整排空与运行期异步区间。
 *
 * 覆盖 UT-S16-46～UT-S16-55、ST-S16-06（场景 S16「CLI 入口统一设置阻塞写」EX-2.7、EX-2.8）。
 * 一律以 Node `child_process.spawn` 启动真实 CLI（dist/index.js），默认 stdio 为 socketpair（macOS 下 8192 字节即截断）；
 * 输出量 > 65536 字节，断言前先断言收到字节数。截断对照仅 darwin 必须复现；进程树 / 进程组断言仅 POSIX。
 * 全局 OpenLogos reporter 按用例名中的 ID 写入 test-results.jsonl（scenario_id="S16"）。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { ENV_REGISTRY_REL } from '../src/lib/environments.js';
import {
  asyncStdioDepth, ensureBlockingStdio, enterAsyncStdio, resetStdioBlockingForTest, withAsyncStdio, type StdioStream,
} from '../src/lib/stdio-blocking.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const HELPER_URL = pathToFileURL(resolve(HERE, '../dist/lib/stdio-blocking.js')).href;
const PIPE_BUFFER = 65536;
const TIMEOUT = 90_000;
const POSIX = process.platform !== 'win32';
const DELTA_COUNT = 300;
const SLUG = 'big-lint';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

interface PipedRun { code: number | null; signal: NodeJS.Signals | null; stdout: Buffer; stderr: Buffer }

/** 以 Node spawn（默认 socketpair）运行子进程，收集 stdout / stderr 全部 chunk 直至 close。 */
function runPiped(args: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<PipedRun> {
  return collect(start(args, cwd, env));
}

function start(args: string[], cwd: string, env: Record<string, string | undefined> = {}): ChildProcess {
  const childEnv = { ...process.env, ...env };
  delete childEnv.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
  return spawn(process.execPath, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** 开始读取（暂缓读取的子进程在此时才恢复消费）并等待 close。 */
function collect(child: ChildProcess): Promise<PipedRun> {
  return new Promise((resolvePromise, reject) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout!.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr!.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code, signal) => resolvePromise({ code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err) }));
  });
}

/** 子进程退出（不依赖 stdio 被读完）。 */
function exited(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise(res => child.once('exit', (code, signal) => res({ code, signal })));
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const started = Date.now();
  while (!cond()) {
    if (Date.now() - started > timeoutMs) throw new Error(`waitFor timeout: ${label}`);
    await sleep(50);
  }
}

async function within<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const pidGone = (pid: number) => { try { process.kill(pid, 0); return false; } catch (e) { return (e as NodeJS.ErrnoException).code === 'ESRCH'; } };

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** launched 项目：活跃提案含 DELTA_COUNT 个缺段标记的 delta，change-lint 违规足以使输出 > 65536 字节。 */
function bigLintProject(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'en' });
  writeFileSync(join(root, 'logos/logos-project.yaml'), stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }));
  const dir = join(root, 'logos/changes', SLUG);
  mkdirSync(join(dir, 'deltas/prd/1-product-requirements'), { recursive: true });
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  writeFileSync(join(dir, 'proposal.md'), `# 变更提案：${SLUG}\n`);
  writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n');
  for (let i = 0; i < DELTA_COUNT; i++) {
    writeFileSync(join(dir, `deltas/prd/1-product-requirements/core-${String(i).padStart(3, '0')}-big.md`), 'no markers\n');
  }
  return root;
}

const isDeltaViolation = (path: string) => path.includes(`logos/changes/${SLUG}/deltas/`);

describe('S16 EX-2.7 — 写出后立即退出的命令经 Node spawn 管道完整输出', () => {
  it('UT-S16-46: change-lint 大量违规时 JSON 完整', async () => {
    const root = bigLintProject();
    const run = await runPiped([CLI, 'change-lint', '--format', 'json'], root);
    expect(run.stdout.length).toBeGreaterThan(PIPE_BUFFER);
    const env = JSON.parse(run.stdout.toString('utf8'));
    expect(env.command).toBe('change-lint');
    expect(env.data.pass).toBe(false);
    const violations = env.data.violations as Array<{ path: string }>;
    expect(violations.filter(v => isDeltaViolation(v.path))).toHaveLength(DELTA_COUNT);
    expect(run.code).toBe(2);
  }, TIMEOUT);

  it('UT-S16-47: merge preflight 违规时 stderr 完整', async () => {
    const root = bigLintProject();
    const lint = JSON.parse((await runPiped([CLI, 'change-lint', '--format', 'json'], root)).stdout.toString('utf8'));
    const expected = (lint.data.violations as unknown[]).length;
    const run = await runPiped([CLI, 'merge', SLUG], root);
    const stderr = run.stderr.toString('utf8');
    expect(run.stderr.length).toBeGreaterThan(PIPE_BUFFER);
    expect(stderr).toContain(`change-lint 未通过（${expected} 项违规）`);
    const lines = stderr.split('\n');
    expect(lines.filter(l => /^ {2}- \[/.test(l))).toHaveLength(expected);
    expect(lines.filter(l => isDeltaViolation(l) && /^ {2}- \[/.test(l))).toHaveLength(DELTA_COUNT);
    // 末尾的自查提示在场：尾部未丢
    expect(stderr).toContain(`自查命令：openlogos change-lint --slug ${SLUG}`);
    expect(run.code).toBe(1);
  }, TIMEOUT);

  it('UT-S16-48: text 模式代表性大输出非零退出完整', async () => {
    const root = bigLintProject();
    const run = await runPiped([CLI, 'change-lint'], root);
    expect(run.stdout.length).toBeGreaterThan(PIPE_BUFFER);
    const lines = run.stdout.toString('utf8').trimEnd().split('\n');
    expect(lines[0]).toBe(`change-lint: ${SLUG}`);
    // 哨兵：渲染的最后一行是结论行，且违规计数与 JSON 一致
    const lint = JSON.parse((await runPiped([CLI, 'change-lint', '--format', 'json'], root)).stdout.toString('utf8'));
    expect(lines[lines.length - 1]).toMatch(new RegExp(`^FAIL（\\d+/\\d+，${lint.data.violations.length} 项违规`));
    expect(run.code).toBe(2);
  }, TIMEOUT);

  it('UT-S16-49: 不支持 setBlocking 的句柄与 TTY 保持原状', async () => {
    resetStdioBlockingForTest();
    const calls: Array<[string, boolean]> = [];
    const stub = (_name: string, extra: Partial<StdioStream> = {}, handle?: unknown): StdioStream => ({
      writableLength: 0, write: (_c: string, cb?: () => void) => { cb?.(); return true; }, _handle: handle, ...extra,
    });
    const blockingHandle = (name: string) => ({ setBlocking: (b: boolean) => { calls.push([name, b]); return 0; } });
    const noHandle = stub('no-handle');
    const noMethod = stub('no-method', {}, {});
    const throwing = stub('throwing', {}, { setBlocking: () => { throw new Error('boom'); } });
    const tty = stub('tty', { isTTY: true }, blockingHandle('tty'));
    const failingRc = stub('rc', {}, { setBlocking: (b: boolean) => { calls.push(['rc', b]); return -22; } });
    const pipe = stub('pipe', {}, blockingHandle('pipe'));
    expect(() => ensureBlockingStdio([noHandle, noMethod, throwing, tty, failingRc, pipe])).not.toThrow();
    expect(calls).toEqual([['rc', true], ['pipe', true]]);
    calls.length = 0;
    await withAsyncStdio(async () => { expect(calls).toEqual([['pipe', false]]); });
    // 只切换被记录的句柄：TTY 与设阻塞失败的句柄不被切为异步
    expect(calls).toEqual([['pipe', false], ['pipe', true]]);
    resetStdioBlockingForTest();

    // 文件重定向：stdout 句柄无 setBlocking（同步写），输出完整、退出码不变
    const root = bigLintProject();
    const dir = tempDir('s16-redirect-');
    const outPath = join(dir, 'out.json');
    const fd = openSync(outPath, 'w');
    try {
      const r = spawnSync(process.execPath, [CLI, 'change-lint', '--format', 'json'], { cwd: root, stdio: ['ignore', fd, 'pipe'] });
      expect(r.status).toBe(2);
    } finally {
      closeSync(fd);
    }
    const text = readFileSync(outPath, 'utf8');
    expect(text.length).toBeGreaterThan(PIPE_BUFFER);
    expect(JSON.parse(text).data.violations.filter((v: { path: string }) => isDeltaViolation(v.path))).toHaveLength(DELTA_COUNT);
  }, TIMEOUT);

  it('UT-S16-50: 平台条件化截断必红对照', async () => {
    // 截断取决于平台：darwin 的管道 / socket 为异步写（根因复现平台），对照臂必须真的截断；
    // 其他平台（如 Windows 管道同步写）未截断不判为失败，只检验完整输出与退出码。载荷有限三档重试。
    const requireTruncation = process.platform === 'darwin';
    const overhead = '{"pad":""}\n'.length;
    let truncated: { written: number; received: number; parsed: boolean } | null = null;
    for (const size of [200_000, 2_000_000, 8_000_000]) {
      const script = `const s=JSON.stringify({pad:'x'.repeat(${size})});console.log(s);process.exit(2);`;
      const run = await runPiped(['-e', script], process.cwd());
      const written = size + overhead;
      let parsed = true;
      try { JSON.parse(run.stdout.toString('utf8')); } catch { parsed = false; }
      expect(run.code).toBe(2);
      if (run.stdout.length < written) { truncated = { written, received: run.stdout.length, parsed }; break; }
      expect(run.stdout.length).toBe(written);
      expect(parsed).toBe(true);
    }
    if (requireTruncation) expect(truncated).not.toBeNull();
    if (truncated) {
      expect(truncated.received).toBeLessThan(truncated.written);
      expect(truncated.parsed).toBe(false);
    }

    // 修复臂：入口先调用 ensureBlockingStdio()，所有平台都完整、退出码保留
    const size = truncated ? truncated.written - overhead : 200_000;
    const fixed = await runPiped(['--input-type=module', '-e',
      `import { ensureBlockingStdio } from ${JSON.stringify(HELPER_URL)};ensureBlockingStdio();`
      + `const s=JSON.stringify({pad:'x'.repeat(${size})});console.log(s);process.exit(2);`], process.cwd());
    expect(fixed.stdout.length).toBe(size + overhead);
    expect(JSON.parse(fixed.stdout.toString('utf8')).pad).toHaveLength(size);
    expect(fixed.code).toBe(2);
  }, TIMEOUT);
});

// ───────────────────────── 运行期异步区间（EX-2.8） ─────────────────────────

// 回显由 awk 一次生成（不用 sh 循环逐行 echo）：负载下脚本耗时稳定在毫秒级，不挤占部署 / 观察超时预算
const FILLER = (lines: number, tag: string) => `awk 'BEGIN { for (i = 0; i < ${lines}; i++) printf "${tag} %d ${'x'.repeat(96)}\\n", i }'`;
const ECHO_LINES = 3000;

/** 部署脚本：先记录进程号并派生孙进程，再回显 > 65536 字节，然后长时间休眠。 */
const DEPLOY_SCRIPT = `#!/bin/sh
sleep 60 &
echo $! > "$PUBLISH_DIR/child.pid"
echo $$ > "$PUBLISH_DIR/script.pid"
${FILLER(ECHO_LINES, 'deploy-echo')}
sleep 60
`;

/** ci 触发脚本：回显 > 65536 字节后报告 run_id（最后一个非空行）。 */
const TRIGGER_SCRIPT = `#!/bin/sh
${FILLER(ECHO_LINES, 'trigger-echo')}
echo '{"run_id":"77","url":"https://ci.example/77"}'
`;
/** ci 状态脚本：每次调用记录时间，回显 > 65536 字节后持续报告未完成。 */
const STATUS_SCRIPT = `#!/bin/sh
mkdir -p "$PUBLISH_DIR"
date +%s >> "$PUBLISH_DIR/status-calls.txt"
${FILLER(ECHO_LINES, 'status-echo')}
echo '{"status":"in_progress"}'
`;

interface DeployFixture { root: string; publish: string; trace: string }

/** 临时 git 项目：prod 环境按给定 deploy 配置；脚本均已提交。 */
function deployProject(deployCfg: Record<string, unknown>): DeployFixture {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  const work = tempDir('s16-deploy-');
  const publish = join(work, 'publish');
  mkdirSync(publish, { recursive: true });
  scaffoldProject(root, { locale: 'en' });
  writeFileSync(join(root, 'logos/logos-project.yaml'), stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }));
  const put = (rel: string, content: string, exec = false) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
    if (exec) chmodSync(join(root, rel), 0o755);
  };
  put(ENV_REGISTRY_REL, stringifyYaml({
    schema_version: 1,
    environments: [{ id: 'prod', name: 'Production', tier: 'prod', deploy: deployCfg }],
  }, { lineWidth: 0 }));
  put('deploy/run.sh', DEPLOY_SCRIPT, true);
  put('ci/trigger.sh', TRIGGER_SCRIPT, true);
  put('ci/status.sh', STATUS_SCRIPT, true);
  put('.gitignore', `logos/.openlogos-runtime/\n${ENV_REGISTRY_REL}\n`);
  const git = (args: string[]) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  git(['init', '-q']);
  git(['config', 'user.name', 't']);
  git(['config', 'user.email', 't@example.invalid']);
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
  return { root, publish, trace: join(work, 'stdio-trace.log') };
}

function startDeploy(f: DeployFixture): ChildProcess {
  return start([CLI, 'deploy', '--env', 'prod', '--ref', 'HEAD'], f.root, { PUBLISH_DIR: f.publish, OPENLOGOS_STDIO_TRACE: f.trace });
}

const readPid = (f: DeployFixture, name: string) => Number(readFileSync(join(f.publish, name), 'utf-8').trim());
const pidsReady = (f: DeployFixture) => existsSync(join(f.publish, 'child.pid')) && existsSync(join(f.publish, 'script.pid'));

interface TraceEvent { at: number; event: string; depth: number }
function readTrace(path: string): TraceEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').trim().split('\n').filter(Boolean).map(line => {
    const [at, event, depth] = line.split(' ');
    return { at: Number(at), event, depth: Number(depth.slice('depth='.length)) };
  });
}

describe.skipIf(!POSIX)('S16 EX-2.8 — 消费方暂停读取时运行期区间保持事件循环可响应', () => {
  it('UT-S16-51: deploy script 模式暂缓读取时超时仍终止进程树', async () => {
    const timeoutSec = 3;
    const f = deployProject({ mode: 'script', script: 'deploy/run.sh', timeout_sec: timeoutSec });
    const child = startDeploy(f); // 暂缓读取：不挂 data 监听
    await waitFor(() => pidsReady(f), 30_000, '部署脚本启动');
    const scriptPid = readPid(f, 'script.pid');
    const grandchild = readPid(f, 'child.pid');
    const startedAt = Date.now();
    await waitFor(() => pidGone(scriptPid) && pidGone(grandchild), timeoutSec * 1000 + 10_000, '超时终止进程树');
    expect(Date.now() - startedAt).toBeLessThan(timeoutSec * 1000 + 10_000);
    // 仍未读取任何输出：区间末尾的排空在等待消费方，CLI 尚未退出
    expect(child.exitCode).toBeNull();

    const run = await within(collect(child), 30_000, '恢复读取后 CLI 退出');
    const stdout = run.stdout.toString('utf8');
    expect(run.stdout.length).toBeGreaterThan(PIPE_BUFFER);
    expect(stdout).toContain(`deploy-echo ${ECHO_LINES - 1} `);
    expect(run.code).toBe(1);
    expect(stdout + run.stderr.toString('utf8')).toMatch(/timeout|超时|timed out/i);
  }, TIMEOUT);

  it('UT-S16-52: deploy 暂缓读取时 SIGINT / SIGTERM 仍完成清理', async () => {
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      const f = deployProject({ mode: 'script', script: 'deploy/run.sh', timeout_sec: 120 });
      const child = startDeploy(f);
      await waitFor(() => pidsReady(f), 30_000, `${sig} 部署脚本启动`);
      const scriptPid = readPid(f, 'script.pid');
      const grandchild = readPid(f, 'child.pid');
      // 让回显写满消费方缓冲（消费方始终未读取）
      await sleep(1500);
      expect(child.exitCode).toBeNull();
      child.kill(sig);
      const result = await within(exited(child), 10_000, `${sig} 后 CLI 退出`);
      expect(result.code, `${sig} 退出码`).toBe(130);
      await waitFor(() => pidGone(scriptPid) && pidGone(grandchild), 5_000, `${sig} 进程组清理`);
      child.stdout!.destroy();
      child.stderr!.destroy();
    }
  }, TIMEOUT);

  it('UT-S16-53: watch 暂缓读取时 SIGINT 仍及时退出', async () => {
    const { root, cleanup } = makeTempRoot();
    cleanups.push(cleanup);
    scaffoldProject(root, { locale: 'en' });
    // 400 个模块使单帧快照 > 65536 字节
    writeFileSync(join(root, 'logos/logos-project.yaml'), stringifyYaml({
      modules: Array.from({ length: 400 }, (_, i) => ({ id: `m${i}`, name: `Module ${i}`, lifecycle: 'launched' })),
    }));
    const trace = join(tempDir('s16-watch-'), 'trace.log');
    const child = start([CLI, 'watch', '--format', 'json', '--interval', '60'], root, { OPENLOGOS_STDIO_TRACE: trace });
    // 就绪 = 已进入常驻异步区间、初始快照（> 65536 字节）已写出并积压在未读取的管道里、SIGINT 处理已注册。
    // 以 watch-ready 观测点判定，不以固定等待猜测（全量负载下 400 模块的初始快照派生可能耗时数秒）。
    await waitFor(() => readTrace(trace).some(e => e.event === 'watch-ready'), 60_000, 'watch 常驻区间就绪');
    const events = readTrace(trace);
    const asyncIdx = events.findIndex(e => e.event === 'async');
    expect(asyncIdx).toBeGreaterThanOrEqual(0);
    expect(asyncIdx).toBeLessThan(events.findIndex(e => e.event === 'watch-ready'));
    expect(events.slice(asyncIdx).some(e => e.event === 'blocking'), '常驻期未恢复阻塞').toBe(false);
    expect(child.exitCode).toBeNull();
    child.kill('SIGINT');
    const result = await within(exited(child), 10_000, 'SIGINT 后 watch 退出');
    expect(result).toEqual({ code: 0, signal: null });
    child.stdout!.destroy();
    child.stderr!.destroy();
  }, TIMEOUT);

  it('UT-S16-55: ci 模式 script provider 嵌套区间下外层观察超时仍推进', async () => {
    // 观察超时须容纳多轮（poll 1s）状态查询：触发与每轮查询都是内层区间
    const timeoutSec = 8;
    const f = deployProject({
      mode: 'ci', provider: 'script', trigger_script: 'ci/trigger.sh', status_script: 'ci/status.sh',
      poll_interval_sec: 1, timeout_sec: timeoutSec,
    });
    const child = startDeploy(f); // 暂缓读取
    // 最外层（ci 执行阶段）结束才开始排空：深度归 0 的 drain-start
    await waitFor(() => readTrace(f.trace).some(e => e.event === 'drain-start' && e.depth === 0), timeoutSec * 1000 + 30_000, '外层观察超时推进');
    const events = readTrace(f.trace);
    const firstEnter = events.find(e => e.event === 'enter')!;
    const outerDrain = events.find(e => e.event === 'drain-start' && e.depth === 0)!;
    expect(outerDrain.at - firstEnter.at).toBeLessThan(timeoutSec * 1000 + 15_000);
    // 触发 + 多轮状态查询均以内层区间嵌套运行
    const calls = readFileSync(join(f.publish, 'status-calls.txt'), 'utf-8').trim().split('\n');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const inner = events.filter(e => e.event === 'enter' && e.depth === 2);
    expect(inner.length).toBe(calls.length + 1);
    // 首次切异步之后、最外层排空之前句柄从未恢复阻塞；内层结束只减深度、不排空
    const firstAsync = events.findIndex(e => e.event === 'async');
    const drainIdx = events.indexOf(outerDrain);
    expect(firstAsync).toBeGreaterThanOrEqual(0);
    expect(events.slice(firstAsync, drainIdx).some(e => e.event === 'blocking')).toBe(false);
    expect(events.slice(0, drainIdx).some(e => e.event === 'drain-start')).toBe(false);
    expect(child.exitCode).toBeNull();

    const run = await within(collect(child), 30_000, '恢复读取后 CLI 退出');
    const stdout = run.stdout.toString('utf8');
    expect(run.stdout.length).toBeGreaterThan(PIPE_BUFFER);
    expect(stdout).toContain(`trigger-echo ${ECHO_LINES - 1} `);
    expect(stdout).toContain('run 77: in_progress');
    expect(run.code).toBe(1);
    // 最外层排空后才恢复阻塞
    const after = readTrace(f.trace);
    expect(after[after.length - 1].event).toBe('blocking');
  }, TIMEOUT);
});

describe('S16 EX-2.8 — withAsyncStdio 嵌套深度计数', () => {
  beforeEach(() => resetStdioBlockingForTest());
  afterEach(() => resetStdioBlockingForTest());

  it('UT-S16-54: withAsyncStdio 嵌套深度计数状态序列', async () => {
    const calls: boolean[] = [];
    // 每次排空屏障（write('', cb)）单独挂起，由测试逐个完成；全部完成后才视为无排队写入
    const barriers: Array<() => void> = [];
    const stream: StdioStream = {
      writableLength: 0,
      _handle: { setBlocking: (b: boolean) => { calls.push(b); return 0; } },
      write: (_c: string, cb?: () => void) => { barriers.push(() => cb?.()); return true; },
    };
    let completed = 0;
    const completeBarrier = (i: number) => {
      barriers[i]();
      completed++;
      if (completed === barriers.length) stream.writableLength = 0;
    };
    ensureBlockingStdio([stream]);
    expect(calls).toEqual([true]);
    calls.length = 0;

    // 外层进入 → 切异步；内层进入 → 无调用；内层结束 → 无调用、无排空等待
    const releaseOuter = enterAsyncStdio();
    expect(calls).toEqual([false]);
    stream.writableLength = 10; // 有排队写入：内层结束若等待排空会挂起，within 立即判红
    await within(withAsyncStdio(async () => { expect(asyncStdioDepth()).toBe(2); }), 1000, '内层结束不等待排空');
    expect(barriers, '内层结束未发起排空').toHaveLength(0);
    expect(calls).toEqual([false]);
    expect(asyncStdioDepth()).toBe(1);

    // 内层抛错同样不提前恢复、不排空
    await expect(within(withAsyncStdio(async () => { throw new Error('inner'); }), 1000, '内层抛错不等待排空')).rejects.toThrow('inner');
    expect(barriers).toHaveLength(0);
    expect(calls).toEqual([false]);
    expect(asyncStdioDepth()).toBe(1);

    // 最外层结束：存在排队写入时先排空，排空完成后才恢复阻塞
    const outerDone = releaseOuter();
    await sleep(10);
    expect(calls).toEqual([false]);
    expect(barriers).toHaveLength(1);
    completeBarrier(0);
    await outerDone;
    expect(calls).toEqual([false, true]);
    expect(asyncStdioDepth()).toBe(0);
    await releaseOuter(); // 幂等
    expect(asyncStdioDepth()).toBe(0);

    // 最外层排空期间有新区间进入（仍活动）→ 放弃本次恢复，保持异步；后进入者排空后才恢复
    const reset = () => { calls.length = 0; barriers.length = 0; completed = 0; };
    reset();
    const releaseA = enterAsyncStdio();
    stream.writableLength = 10;
    const doneA = releaseA();
    await sleep(10);
    const releaseB = enterAsyncStdio(); // 深度 0→1：再次切异步，A 的恢复资格失效
    completeBarrier(0);
    await doneA;
    expect(calls).toEqual([false, false]);
    expect(asyncStdioDepth()).toBe(1);
    await releaseB(); // 已无排队写入：直接恢复
    expect(calls).toEqual([false, false, true]);

    // 排空期间新区间进入并已结束（深度 0→1→0）：A 的过期屏障先完成也不得恢复，B 的屏障完成后才恢复（含 B 抛错）
    for (const bThrows of [false, true]) {
      reset();
      const releaseA2 = enterAsyncStdio();
      stream.writableLength = 10;
      const doneA2 = releaseA2();
      await sleep(10);
      expect(barriers).toHaveLength(1);
      const doneB2 = bThrows
        ? withAsyncStdio(async () => { throw new Error('b'); }).catch((e: Error) => e.message)
        : withAsyncStdio(async () => 'ok');
      await sleep(10);
      expect(asyncStdioDepth(), 'B 已结束').toBe(0);
      expect(barriers, 'B 发起自己的排空屏障').toHaveLength(2);
      completeBarrier(0); // 只完成 A 的屏障：B 的新增写入仍未排空
      await doneA2;
      expect(stream.writableLength).toBe(10);
      expect(calls, `bThrows=${bThrows}：过期屏障不得恢复阻塞`).toEqual([false, false]);
      completeBarrier(1);
      expect(await doneB2).toBe(bThrows ? 'b' : 'ok');
      expect(calls, `bThrows=${bThrows}：B 排空后恢复`).toEqual([false, false, true]);
      expect(asyncStdioDepth()).toBe(0);
    }
  });
});

describe('S16 EX-2.7 — 模拟 RunLogos driver 读取 change-lint 与 merge 的大输出', () => {
  it('ST-S16-06: 模拟 RunLogos driver 依次读取 change-lint 与 merge 的大输出并分流', async () => {
    const root = bigLintProject();
    const branches: string[] = [];

    const lint = await runPiped([CLI, 'change-lint', '--format', 'json'], root);
    let lintData: { pass: boolean; violations: Array<{ path: string }> } | null = null;
    try { lintData = JSON.parse(lint.stdout.toString('utf8')).data; } catch { branches.push('lint-unparsed'); }
    if (lintData) branches.push(lint.code === 0 ? 'lint-pass' : lint.code === 2 ? 'lint-fail' : 'lint-error');
    expect(lint.stdout.length).toBeGreaterThan(8192);
    expect(lint.stdout.length).toBeGreaterThan(PIPE_BUFFER);

    const merge = await runPiped([CLI, 'merge', SLUG], root);
    const listed = merge.stderr.toString('utf8').split('\n').filter(l => /^ {2}- \[/.test(l));
    branches.push(merge.code === 0 ? 'merge-ok' : merge.code === 1 ? 'merge-rejected' : 'merge-error');

    expect(branches).toEqual(['lint-fail', 'merge-rejected']);
    expect(lintData!.pass).toBe(false);
    expect(listed).toHaveLength(lintData!.violations.length);
    expect(lintData!.violations.filter(v => isDeltaViolation(v.path))).toHaveLength(DELTA_COUNT);
    expect(merge.stderr.length).toBeGreaterThan(PIPE_BUFFER);
  }, TIMEOUT);
});
