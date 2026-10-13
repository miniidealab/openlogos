/**
 * S13 沙箱复用与增量同步（verify-sandbox-reuse-0-16-1，切片 slice-01-verify-sandbox-reuse）。
 *
 * 覆盖 UT-S13-89～UT-S13-100、ST-S13-25，对应功能规格 §2.91、场景 S13「S13 沙箱复用与增量同步时序」
 * Step R1～R13 与 EX-3.5～EX-3.12。
 *
 * 夹具口径：一律在 mktemp 一次性项目与一次性 sandbox_root 内执行，不使用本仓配置的沙箱根。执行器级用例直接
 * 调用 runSandboxedCommand；CLI 用例经真实 `openlogos verify` 子进程执行；锁交错用例以真实子进程在执行器
 * 暴露的测试接缝（OPENLOGOS_SANDBOX_TEST_BEFORE_LINK）处汇合。凡断言「未变文件不比较内容」的步骤，先预热并让
 * 相邻两次运行间隔超过 2 秒（racy 窗口）。孤儿进程在 finally 中终止。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync,
  rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, cleanupFixtureRoots, fixtureRoots, put } from './frontier-fixture.js';
import { scaffoldProject } from './helpers.js';
import { runSandboxedCommand, type NormalizedSandboxConfig } from '../src/lib/sandbox.js';
import { detectLivenessCapability, projectDirName, scanProcEnvironment, SYNC_MANIFEST_SCHEMA } from '../src/lib/sandbox-reuse.js';

const SANDBOX_DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'lib', 'sandbox.js');
const RESULT = 'logos/resources/verify/test-results.jsonl';
const IDS = ['UT-S01-01', 'UT-S01-02'];
const PASS_LEDGER = IDS.map(id => JSON.stringify({ id, status: 'pass', timestamp: '2026-10-13T00:00:00.000Z' })).join('\n') + '\n';
const pids: number[] = [];

/**
 * 复用依赖旧写入者存活检查能力（§2.91.6）。在 Seatbelt 等嵌套沙箱内（如本仓 verify 以 sandbox-exec 包裹
 * `npm test`）setuid 的 /bin/ps 不可执行，执行器按规格判 unsupported 并退回一次性沙箱——此时依赖复用的用例
 * 显式 skip（同 UT-S13-47～54 对 OS 写保护能力的处理），不在不具备能力的环境里断言复用行为。
 */
const REUSE_CAPABLE = detectLivenessCapability().available;
const itReuse = it.skipIf(!REUSE_CAPABLE);

afterAll(() => {
  for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ } }
  cleanupFixtureRoots();
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  fixtureRoots.push(dir);
  return dir;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const asleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 30_000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for ${label}`);
    await asleep(25);
  }
}

// ───────────────────────── 执行器级夹具 ─────────────────────────

interface ExecFixture { root: string; sbx: string }

function execFixture(files: Record<string, string> = {}): ExecFixture {
  const root = tmp('openlogos-s13-reuse-proj-');
  const sbx = tmp('openlogos-s13-reuse-sbx-');
  for (const [rel, content] of Object.entries(files)) put(root, rel, content);
  return { root, sbx };
}

function cfg(f: ExecFixture, extra: Partial<NormalizedSandboxConfig> = {}): NormalizedSandboxConfig {
  return { mode: 'auto', root: f.sbx, denyWorkspaceWrite: true, reuse: true, cachePaths: [], ...extra };
}

function exec(f: ExecFixture, command: string, opts: { extra?: Partial<NormalizedSandboxConfig>; allowed?: string[]; fresh?: boolean } = {}) {
  return runSandboxedCommand({
    root: f.root,
    command,
    format: 'json',
    sandbox: cfg(f, opts.extra),
    allowedWritePaths: opts.allowed ?? [],
    freshSandbox: opts.fresh,
  });
}

function projectDirOf(f: { root: string; sbx: string }): string {
  return join(f.sbx, projectDirName(f.root));
}

function lockSnapshot(projectDir: string): Record<string, string> {
  const dir = join(projectDir, 'lock');
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) out[name] = readFileSync(join(dir, name), 'utf8');
  return out;
}

/** 毫秒级 mtime（bigint 纳秒截断，与实现同口径；浮点 mtimeMs 在 .999999 处会被舍入到下一毫秒）。 */
function mtimeMsOf(path: string): string {
  return String(lstatSync(path, { bigint: true }).mtimeNs / 1_000_000n);
}

function latestLockRecord(projectDir: string): { ws: string; token: string } {
  const names = readdirSync(join(projectDir, 'lock')).filter(n => /^gen-\d{12}$/.test(n)).sort();
  return JSON.parse(readFileSync(join(projectDir, 'lock', names[names.length - 1]), 'utf8'));
}

// ───────────────────────── CLI 夹具 ─────────────────────────

function cliProject(verify: Record<string, unknown> = {}): ExecFixture {
  const root = tmp('openlogos-s13-reuse-cli-');
  const sbx = tmp('openlogos-s13-reuse-clisbx-');
  scaffoldProject(root, { locale: 'en' });
  setVerify(root, { sandbox_mode: 'auto', sandbox_root: sbx, sandbox_deny_workspace_write: true, ...verify });
  put(root, 'logos/resources/test/core-S01-test-cases.md',
    `# S01\n\n| ID | 描述 |\n|---|---|\n${IDS.map(id => `| ${id} | ${id} 用例 |`).join('\n')}\n`);
  return { root, sbx };
}

function setVerify(root: string, verify: Record<string, unknown>): void {
  const cfgPath = join(root, 'logos', 'logos.config.json');
  const config = JSON.parse(readFileSync(cfgPath, 'utf8'));
  config.verify = { ...config.verify, ...verify };
  writeFileSync(cfgPath, JSON.stringify(config, null, 2));
}

/** 写入全部 pass 账本的普通运行器；`before` 为先执行的 JS 片段。 */
function passRunner(root: string, name: string, before = ''): string {
  put(root, `tools/${name}.data`, PASS_LEDGER);
  put(root, `tools/${name}.js`, `
const fs = require('fs'); const path = require('path');
${before}
fs.mkdirSync(path.dirname('${RESULT}'), { recursive: true });
fs.writeFileSync('${RESULT}', fs.readFileSync('tools/${name}.data'));
`);
  return `node tools/${name}.js`;
}

function verifyJson(root: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, [cli, 'verify', ...args, '--format', 'json'], {
    cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env },
  });
  let data;
  try { data = JSON.parse(r.stdout).data; } catch { data = undefined; }
  return { status: r.status, signal: r.signal, data, stderr: r.stderr, stdout: r.stdout };
}

// ───────────────────────── 单元测试 ─────────────────────────

describe('S13 沙箱复用与增量同步 — 单元测试', () => {
  itReuse('UT-S13-89: 持久目录身份与 created / reused', () => {
    const f = cliProject();
    setVerify(f.root, { pre_run_command: passRunner(f.root, 'pass') });
    const first = verifyJson(f.root);
    const second = verifyJson(f.root);
    const expectedDir = join(f.sbx, projectDirName(f.root));
    expect(projectDirName(f.root)).toMatch(/^openlogos-cli-sandbox-reuse-[0-9a-f]{16}$/);
    const hash = execFileSync('shasum', ['-a', '256'], { input: realpathSync(f.root), encoding: 'utf8' }).slice(0, 16);
    expect(projectDirName(f.root)).toBe(`openlogos-cli-sandbox-reuse-${hash}`);
    for (const run of [first, second]) {
      expect(run.data.gate.result).toBe('PASS');
      expect(run.data.sandbox.reuse.dir).toBe(expectedDir);
    }
    expect(first.data.sandbox.reuse.state).toBe('created');
    expect(second.data.sandbox.reuse.state).toBe('reused');
    expect(second.data.sandbox.reuse.generation).toBe(first.data.sandbox.reuse.generation);
    expect(second.data.sandbox.root).toBe(join(expectedDir, second.data.sandbox.reuse.generation));
    expect(existsSync(second.data.sandbox.root), '运行后世代目录仍在').toBe(true);
    const lock = Object.keys(lockSnapshot(expectedDir));
    expect(lock).toEqual(expect.arrayContaining([
      'gen-000000000001', 'gen-000000000001.released', 'gen-000000000002', 'gen-000000000002.released',
    ]));
  });

  itReuse('UT-S13-90: 增量同步只动变化项、mtime 保真（执行器级计数）', () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 10; i++) files[`src/f${i}.txt`] = `content-${i}\n`;
    const f = execFixture(files);
    const warm = exec(f, 'true');
    expect(warm.sandbox.reuse?.state).toBe('created');
    sleep(2100);
    exec(f, 'true');
    sleep(2100);
    const ws = join(warm.sandbox.reuse!.dir!, warm.sandbox.reuse!.generation!, 'workspace');
    const before = new Map<string, { ino: number; mtimeMs: number }>();
    for (let i = 3; i <= 10; i++) {
      const st = statSync(join(ws, `src/f${i}.txt`));
      before.set(`f${i}`, { ino: st.ino, mtimeMs: st.mtimeMs });
    }
    writeFileSync(join(f.root, 'src/f1.txt'), 'changed and longer content\n');
    writeFileSync(join(f.root, 'src/f11.txt'), 'new file\n');
    chmodSync(join(f.root, 'src/f11.txt'), 0o640);
    unlinkSync(join(f.root, 'src/f2.txt'));
    const run = exec(f, 'true');
    expect(run.sandbox.reuse?.state).toBe('reused');
    expect(run.sandbox.reuse?.copied).toBe(2);
    expect(run.sandbox.reuse?.removed).toBe(1);
    expect(run.sandbox.reuse?.content_compared).toBe(1);
    for (let i = 3; i <= 10; i++) {
      const st = statSync(join(ws, `src/f${i}.txt`));
      expect(st.ino).toBe(before.get(`f${i}`)!.ino);
      expect(st.mtimeMs).toBe(before.get(`f${i}`)!.mtimeMs);
    }
    const src = statSync(join(f.root, 'src/f11.txt'));
    const dst = statSync(join(ws, 'src/f11.txt'));
    expect(mtimeMsOf(join(ws, 'src/f11.txt'))).toBe(mtimeMsOf(join(f.root, 'src/f11.txt')));
    expect(dst.mode & 0o7777).toBe(src.mode & 0o7777);
    expect(existsSync(join(ws, 'src/f2.txt'))).toBe(false);
  }, 30_000);

  itReuse('UT-S13-91: 镜像还原上轮的沙箱改动（含元数据整定）', () => {
    const f = execFixture({
      'src/a.ts': 'AAAA',
      'src/b.sh': 'echo b\n',
      'src/c.txt': 'c content\n',
      'src/dir/inner.txt': 'inner\n',
      'probe.js': `
const fs = require('fs');
const st = p => fs.lstatSync(p);
console.log(JSON.stringify({
  files: fs.readdirSync('src').sort(),
  a: fs.readFileSync('src/a.ts', 'utf8'),
  bMode: st('src/b.sh').mode & 0o7777,
  bIno: st('src/b.sh').ino,
  cMtime: String(fs.lstatSync('src/c.txt', { bigint: true }).mtimeNs / 1000000n),
  cIno: st('src/c.txt').ino,
  dirIsDir: st('src/dir').isDirectory(),
  link: fs.readlinkSync('link'),
}));
`,
    });
    chmodSync(join(f.root, 'src/b.sh'), 0o644);
    symlinkSync('src/a.ts', join(f.root, 'link'));
    const first = exec(f, 'echo leak > src/leak.txt && printf changed-longer > src/a.ts && chmod +x src/b.sh'
      + ' && touch -t 202001010000 src/c.txt && rm -rf src/dir && ln -s ../src src/dir');
    const ws = join(first.sandbox.reuse!.dir!, first.sandbox.reuse!.generation!, 'workspace');
    const bIno = lstatSync(join(ws, 'src/b.sh')).ino;
    const cIno = lstatSync(join(ws, 'src/c.txt')).ino;
    expect(lstatSync(join(ws, 'src/b.sh')).mode & 0o111, '首轮已改成可执行').not.toBe(0);

    const second = exec(f, 'node probe.js');
    const facts = JSON.parse(second.command.stdout_tail!);
    expect(facts.files).toEqual(['a.ts', 'b.sh', 'c.txt', 'dir']);
    expect(facts.a).toBe('AAAA');
    expect(facts.bMode, '只改权限的副本被还原').toBe(statSync(join(f.root, 'src/b.sh')).mode & 0o7777);
    expect(facts.cMtime, '只改 mtime 的副本被还原').toBe(mtimeMsOf(join(f.root, 'src/c.txt')));
    expect(facts.bIno, '原位整定、未重写字节').toBe(bIno);
    expect(facts.cIno).toBe(cIno);
    expect(facts.dirIsDir).toBe(true);
    expect(facts.link, 'symlink 字面量保持相对').toBe('src/a.ts');
    expect(second.sandbox.reuse?.copied, '只计 a.ts 与 dir/inner.txt；b.sh / c.txt 仅整定不计入').toBe(2);

    sleep(2100);
    const third = exec(f, 'node probe.js');
    const facts3 = JSON.parse(third.command.stdout_tail!);
    expect(facts3.bIno).toBe(bIno);
    expect(facts3.cIno).toBe(cIno);
    expect(facts3.bMode).toBe(statSync(join(f.root, 'src/b.sh')).mode & 0o7777);
    expect(facts3.cMtime).toBe(mtimeMsOf(join(f.root, 'src/c.txt')));
    expect(third.sandbox.reuse?.copied).toBe(0);

    sleep(2100);
    const fourth = exec(f, 'node probe.js');
    expect(fourth.sandbox.reuse?.content_compared, '第三轮清单写入已晚于 ctime 超过 2 秒').toBe(0);
    expect(readFileSync(join(f.root, 'src/a.ts'), 'utf8'), '工作区字节不变').toBe('AAAA');
    expect(existsSync(join(f.root, 'src/leak.txt'))).toBe(false);
  }, 30_000);

  itReuse('UT-S13-92: 等长改写且 mtime 被保留（EX-3.5）', () => {
    const f = execFixture({ 'src/flag.js': 'exports.flag = 0;' });
    const flag = join(f.root, 'src/flag.js');
    exec(f, 'cat src/flag.js');
    sleep(2100);
    exec(f, 'cat src/flag.js');
    sleep(2100);

    // 臂 ①：工作区等长改写，并以 utimes 恢复原 mtime，mode 不变
    const st = statSync(flag);
    writeFileSync(flag, 'exports.flag = 1;');
    utimesSync(flag, st.atime, st.mtime);
    const arm1 = exec(f, 'cat src/flag.js');
    expect(arm1.command.stdout_tail).toBe('exports.flag = 1;');
    expect(arm1.sandbox.reuse!.content_compared).toBeGreaterThanOrEqual(1);
    expect(arm1.sandbox.reuse!.copied).toBeGreaterThanOrEqual(1);
    sleep(2100);

    // 臂 ②：本轮命令在副本中等长改写并恢复其 mtime；下一轮须读到工作区内容
    exec(f, `node -e "const fs=require('fs');const s=fs.statSync('src/flag.js');fs.writeFileSync('src/flag.js','exports.flag = 9;');fs.utimesSync('src/flag.js',s.atime,s.mtime)"`);
    sleep(2100);
    const arm2 = exec(f, 'cat src/flag.js');
    expect(arm2.command.stdout_tail).toBe('exports.flag = 1;');
    expect(arm2.sandbox.reuse!.content_compared).toBeGreaterThanOrEqual(1);
    expect(arm2.sandbox.reuse!.copied).toBeGreaterThanOrEqual(1);

    // 臂 ③（code-r1 F3）：可解析但字段损坏的同步清单整份作废，回到内容判定；命令仍在沙箱内执行，清单被重建
    const manifestPath = join(arm2.sandbox.reuse!.dir!, arm2.sandbox.reuse!.generation!, 'sync-manifest.json');
    const valid = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const corrupt: Array<[string, unknown]> = [
      ['written_at_ns 非数字', { ...valid, written_at_ns: '损坏' }],
      ['指纹为字符串', { ...valid, files: { 'src/flag.js': { src: 'abcdef', dst: 'abcdef' } } }],
      ['指纹长度不符', { ...valid, files: { 'src/flag.js': { src: ['1', '2', '3', '4', '5'], dst: ['1', '2', '3', '4', '5'] } } }],
      ['schema 不符', { ...valid, schema: 'openlogos/sandbox-sync-manifest@0' }],
      ['files 为数组', { ...valid, files: [] }],
    ];
    let next = 2;
    for (const [label, body] of corrupt) {
      writeFileSync(manifestPath, JSON.stringify(body));
      const content = `exports.flag = ${next++};`;
      const before = statSync(flag);
      writeFileSync(flag, content);
      utimesSync(flag, before.atime, before.mtime);
      const run = exec(f, 'cat src/flag.js');
      expect(run.sandbox.isolated, label).toBe(true);
      expect(run.sandbox.reuse?.state, label).toBe('reused');
      expect(run.command.stdout_tail, label).toBe(content);
      const rebuilt = JSON.parse(readFileSync(manifestPath, 'utf8'));
      expect(rebuilt.schema, label).toBe(SYNC_MANIFEST_SCHEMA);
      expect(rebuilt.written_at_ns, label).toMatch(/^\d+$/);
    }

    // 臂 ③ 真实 CLI：损坏清单下预跑命令仍在沙箱内执行，原工作区只回收白名单结果
    const c = cliProject();
    setVerify(c.root, { pre_run_command: passRunner(c.root, 'pass', `fs.writeFileSync('build-out.txt', 'artifact');`) });
    const cliFirst = verifyJson(c.root);
    const cliManifest = join(cliFirst.data.sandbox.reuse.dir, cliFirst.data.sandbox.reuse.generation, 'sync-manifest.json');
    writeFileSync(cliManifest, JSON.stringify({ ...JSON.parse(readFileSync(cliManifest, 'utf8')), written_at_ns: 'not-a-number' }));
    const cliSecond = verifyJson(c.root);
    expect(cliSecond.data.sandbox.isolated).toBe(true);
    expect(cliSecond.data.sandbox.reuse.state).toBe('reused');
    expect(cliSecond.data.gate.result).toBe('PASS');
    expect(existsSync(join(c.root, 'build-out.txt')), '原工作区只回收白名单结果').toBe(false);
    expect(JSON.parse(readFileSync(cliManifest, 'utf8')).written_at_ns).toMatch(/^\d+$/);
  }, 60_000);

  itReuse('UT-S13-93: 缓存路径留存与非法项', () => {
    const illegal = ['/abs', '../out', '', '.', 'logos/resources/verify', 'logos/resources/verify/test-results.jsonl'];
    const f = cliProject({ sandbox_cache_paths: ['build-cache', ...illegal] });
    put(f.root, 'build-cache/ws-only.o', 'from workspace\n');
    setVerify(f.root, { pre_run_command: passRunner(f.root, 'first', `fs.mkdirSync('build-cache', { recursive: true }); fs.writeFileSync('build-cache/x.o', 'built');`) });
    const first = verifyJson(f.root);
    expect(first.data.gate.result).toBe('PASS');
    setVerify(f.root, { pre_run_command: passRunner(f.root, 'second', `console.log('cache=' + fs.readdirSync('build-cache').sort().join(','));`) });
    const second = verifyJson(f.root);
    expect(second.data.pre_run.commands[0].stdout_tail).toContain('cache=x.o');
    expect(second.data.pre_run.commands[0].stdout_tail).not.toContain('ws-only.o');
    const diags: string[] = first.data.sandbox.diagnostics;
    for (const marker of ['绝对路径', '..', '空路径', '项目根', '为其祖先', '相同']) {
      expect(diags.some(d => d.includes('sandbox_cache_paths') && d.includes(marker)), marker).toBe(true);
    }
    expect(['warn', 'fail']).toContain(first.data.sandbox.status);
    expect(diags.some(d => d.includes('检测到非白名单写入') && d.includes('build-cache/x.o')), '缓存路径不豁免写入审计').toBe(true);
    expect(second.data.gate.result, 'logos/resources/verify 按普通镜像路径同步').toBe('PASS');

    const strict = cliProject({ sandbox_mode: 'always', sandbox_cache_paths: ['build-cache'] });
    setVerify(strict.root, { pre_run_command: passRunner(strict.root, 'first', `fs.mkdirSync('build-cache', { recursive: true }); fs.writeFileSync('build-cache/x.o', 'built');`) });
    const always = verifyJson(strict.root);
    expect(always.data.pre_run.commands[0].status, 'always 下缓存路径写入判命令失败').toBe('fail');
  }, 60_000);

  itReuse('UT-S13-94: 上轮结果文件不跨运行回收（EX-3.8）', () => {
    const f = cliProject();
    setVerify(f.root, { pre_run_command: passRunner(f.root, 'pass') });
    expect(verifyJson(f.root).data.gate.result).toBe('PASS');
    put(f.root, 'tools/noop.js', 'process.exit(0);\n');
    setVerify(f.root, { pre_run_command: 'node tools/noop.js' });
    const second = verifyJson(f.root);
    expect(second.data.sandbox.reuse.state).toBe('reused');
    expect(second.data.gate.result).toBe('FAIL');
    expect(second.data.gate.reason).toBe('incomplete_coverage');
    expect(readFileSync(join(f.root, RESULT), 'utf8')).toBe('');
  }, 60_000);

  itReuse('UT-S13-95: 隔离不变量在复用下同口径', () => {
    const strip = (r: ReturnType<typeof exec>) => ({
      status: r.sandbox.status,
      command: r.command.status,
      diagnostics: r.sandbox.diagnostics,
    });
    // 臂 ①：非白名单写入
    for (const mode of ['auto', 'always'] as const) {
      const f = execFixture({ 'src/a.txt': 'a' });
      for (let round = 0; round < 2; round++) {
        const reused = exec(f, 'echo x > src/out.txt', { extra: { mode } });
        const oneOff = exec(f, 'echo x > src/out.txt', { extra: { mode, reuse: false } });
        expect(strip(reused)).toEqual(strip(oneOff));
        expect(reused.sandbox.status).toBe(mode === 'auto' ? 'warn' : 'fail');
        expect(existsSync(join(f.root, 'src/out.txt'))).toBe(false);
      }
    }
    // 臂 ②：上轮在缓存路径中新建逃逸 symlink
    for (const mode of ['auto', 'always'] as const) {
      const outside = tmp('openlogos-s13-reuse-outside-');
      const f = execFixture({ 'src/a.txt': 'a' });
      exec(f, `mkdir -p build-cache && ln -s ${outside} build-cache/esc`, { extra: { mode: 'auto', cachePaths: ['build-cache'] } });
      const second = exec(f, 'true', { extra: { mode, cachePaths: ['build-cache'] } });
      expect(second.sandbox.isolated).toBe(false);
      expect(second.sandbox.status).toBe(mode === 'auto' ? 'warn' : 'fail');
      expect(second.sandbox.diagnostics[0]).toContain('build-cache/esc');
      const projectDir = projectDirOf(f);
      expect(existsSync(join(projectDir, 'ws-000000000001')), '世代目录保留').toBe(true);
      expect(existsSync(join(projectDir, 'lock', 'gen-000000000002.released'))).toBe(true);
      // 对照：同一逃逸链接位于一次性沙箱副本中
      const g = execFixture({ 'src/a.txt': 'a' });
      symlinkSync(outside, join(g.root, 'esc'));
      const oneOff = exec(g, 'true', { extra: { mode, reuse: false } });
      expect(second.sandbox.status).toBe(oneOff.sandbox.status);
    }
    // 臂 ③：白名单结果文件定点回收
    const f = execFixture({ 'src/a.txt': 'a' });
    const reused = exec(f, 'mkdir -p out && echo round-1 > out/result.jsonl', { allowed: ['out/result.jsonl'] });
    expect(readFileSync(join(f.root, 'out/result.jsonl'), 'utf8')).toBe('round-1\n');
    const oneOff = exec(f, 'mkdir -p out && echo round-2 > out/result.jsonl', { allowed: ['out/result.jsonl'], extra: { reuse: false } });
    expect(strip(reused)).toEqual(strip(oneOff));

    // 臂 ④（code-r1 F1）：workspace 根 / 世代目录 / 项目目录被换成指向沙箱外的链接，同步不得进入外部目录
    for (const target of ['workspace', 'generation', 'project'] as const) {
      const g = execFixture({ 'src/a.txt': 'a' });
      const firstRun = exec(g, 'true');
      const projectDir = firstRun.sandbox.reuse!.dir!;
      const wsDir = join(projectDir, firstRun.sandbox.reuse!.generation!);
      const outside = tmp('openlogos-s13-reuse-victim-');
      writeFileSync(join(outside, 'valuable.txt'), 'do-not-touch');
      mkdirSync(join(outside, 'lock'));
      writeFileSync(join(outside, 'lock', 'keep.txt'), 'keep');
      const victim = target === 'workspace' ? join(wsDir, 'workspace') : target === 'generation' ? wsDir : projectDir;
      rmSync(victim, { recursive: true, force: true });
      symlinkSync(outside, victim);
      const run = exec(g, 'cat src/a.txt');
      expect(run.command.stdout_tail, target).toBe('a');
      expect(run.sandbox.isolated, target).toBe(true);
      expect(readFileSync(join(outside, 'valuable.txt'), 'utf8'), `${target} 外部文件不变`).toBe('do-not-touch');
      expect(readdirSync(outside).sort(), `${target} 外部目录未被写入`).toEqual(['lock', 'valuable.txt']);
      expect(readdirSync(join(outside, 'lock')), target).toEqual(['keep.txt']);
      expect(lstatSync(victim).isSymbolicLink(), `${target} 链接已被替换为真实目录`).toBe(false);
    }
  }, 60_000);

  itReuse('UT-S13-96: 世代锁竞争与延迟申请者（EX-3.6）', async () => {
    const childScript = (f: ExecFixture, command: string) => `
import { runSandboxedCommand } from ${JSON.stringify(SANDBOX_DIST)};
const r = runSandboxedCommand({ root: ${JSON.stringify(f.root)}, command: ${JSON.stringify(command)}, format: 'json',
  sandbox: { mode: 'auto', root: ${JSON.stringify(f.sbx)}, denyWorkspaceWrite: true, reuse: true, cachePaths: [] },
  allowedWritePaths: [] });
process.stdout.write(JSON.stringify({ state: r.sandbox.reuse.state, root: r.sandbox.root, gen: r.sandbox.reuse.generation }));
`;
    const runChild = (f: ExecFixture, command: string, env: NodeJS.ProcessEnv) => {
      const script = join(tmp('openlogos-s13-reuse-child-'), 'child.mjs');
      writeFileSync(script, childScript(f, command));
      const child = spawn(process.execPath, [script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      pids.push(child.pid!);
      let out = '';
      child.stdout.on('data', d => { out += d; });
      return new Promise<{ state: string; root: string; gen: string | null }>((resolve, reject) => {
        child.on('close', code => {
          try { resolve(JSON.parse(out)); } catch { reject(new Error(`child exit ${code}: ${out}`)); }
        });
      });
    };

    // 臂 ①：两个子进程同时接管同一「未释放且持有者已死」的世代
    {
      const f = execFixture({ 'src/a.txt': 'a' });
      const probe = tmp('openlogos-s13-reuse-probe-');
      put(f.root, 'holder.js', `
const fs = require('fs'); const path = require('path');
const key = path.join(${JSON.stringify(probe)}, 'inuse-' + path.basename(path.dirname(process.cwd())));
try { fs.writeFileSync(key, String(process.pid), { flag: 'wx' }); }
catch { fs.writeFileSync(path.join(${JSON.stringify(probe)}, 'violation-' + process.pid), key); }
const until = Date.now() + 300; while (Date.now() < until) {}
try { fs.unlinkSync(key); } catch {}
`);
      const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
      const projectDir = projectDirOf(f);
      mkdirSync(join(projectDir, 'lock'), { recursive: true });
      writeFileSync(join(projectDir, 'lock', 'gen-000000000005'), JSON.stringify({ token: 'old', pid: dead, ws: 'ws-000000000005' }));
      const barrier = tmp('openlogos-s13-reuse-barrier-');
      const env = { OPENLOGOS_SANDBOX_TEST_BEFORE_LINK: barrier };
      const a = runChild(f, 'node holder.js', env);
      const b = runChild(f, 'node holder.js', env);
      await waitFor(() => readdirSync(barrier).filter(n => n.startsWith('ready-')).length === 2, 30_000, 'both ready');
      writeFileSync(join(barrier, 'go'), '');
      const results = await Promise.all([a, b]);
      const states = results.map(r => r.state).sort();
      expect(states).toEqual(['busy-fallback', 'recovered']);
      const busy = results.find(r => r.state === 'busy-fallback')!;
      expect(existsSync(busy.root), '一次性临时目录已清理').toBe(false);
      expect(readdirSync(probe).filter(n => n.startsWith('violation-'))).toEqual([]);
      expect(Object.keys(lockSnapshot(projectDir))).toEqual(['gen-000000000005', 'gen-000000000006', 'gen-000000000006.released']);
    }

    // 臂 ②：A 持过期观察暂停于 link() 前；B 完整运行并释放；C 持有下一世代；恢复 A
    {
      const f = execFixture({ 'src/a.txt': 'a' });
      exec(f, 'true'); // gen-1 已释放
      const projectDir = projectDirOf(f);
      const barrier = tmp('openlogos-s13-reuse-barrier-');
      const signals = tmp('openlogos-s13-reuse-signal-');
      const a = runChild(f, 'touch A-WAS-HERE', { OPENLOGOS_SANDBOX_TEST_BEFORE_LINK: barrier });
      await waitFor(() => readdirSync(barrier).some(n => n.startsWith('ready-')), 30_000, 'A ready');
      const bRun = exec(f, 'true');
      expect(bRun.sandbox.reuse?.state).toBe('reused');
      put(f.root, 'block.js', `
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(join(signals, 'c-running'))}, '');
while (!fs.existsSync(${JSON.stringify(join(signals, 'c-go'))})) { const t = Date.now() + 20; while (Date.now() < t) {} }
`);
      const c = runChild(f, 'node block.js', {});
      await waitFor(() => existsSync(join(signals, 'c-running')), 30_000, 'C running');
      const cRecord = readFileSync(join(projectDir, 'lock', 'gen-000000000003'), 'utf8');
      writeFileSync(join(barrier, 'go'), '');
      const aResult = await a;
      expect(aResult.state).toBe('busy-fallback');
      const cWorkspace = join(projectDir, JSON.parse(cRecord).ws, 'workspace');
      expect(existsSync(join(cWorkspace, 'A-WAS-HERE')), 'A 未进入 C 的世代').toBe(false);
      writeFileSync(join(signals, 'c-go'), '');
      const cResult = await c;
      expect(cResult.state).toBe('reused');
      const lock = lockSnapshot(projectDir);
      expect(Object.keys(lock)).toEqual([
        'gen-000000000001', 'gen-000000000001.released',
        'gen-000000000002', 'gen-000000000002.released',
        'gen-000000000003', 'gen-000000000003.released',
      ]);
      expect(lock['gen-000000000003'], 'A 未改写 C 的锁记录').toBe(cRecord);
    }
  }, 120_000);

  itReuse('UT-S13-97: 旧写入者跨轮残留（EX-3.7）', async () => {
    // 臂 ①：CLI 被强杀，脱离 stdio 的子进程仍在旧世代写入
    {
      const f = cliProject();
      const pidsDir = tmp('openlogos-s13-reuse-pids-');
      put(f.root, 'tools/orphan.js', `
const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const log = path.join(process.cwd(), 'orphan.log');
const w = spawn(process.execPath, ['-e', 'const fs=require("fs");setInterval(()=>fs.appendFileSync(' + JSON.stringify(log) + ',"x\\\\n"),50)'],
  { detached: true, stdio: 'ignore' });
w.unref();
fs.writeFileSync(${JSON.stringify(join(pidsDir, 'writer'))}, String(w.pid));
fs.writeFileSync(${JSON.stringify(join(pidsDir, 'blocker'))}, String(process.pid));
setInterval(() => {}, 1000);
`);
      setVerify(f.root, { pre_run_command: 'node tools/orphan.js' });
      const cliChild = spawn(process.execPath, [cli, 'verify', '--format', 'json'], { cwd: f.root, stdio: 'ignore' });
      pids.push(cliChild.pid!);
      const projectDir = projectDirOf(f);
      const oldLog = join(projectDir, 'ws-000000000001', 'workspace', 'orphan.log');
      try {
        await waitFor(() => existsSync(oldLog) && existsSync(join(pidsDir, 'writer')), 60_000, 'orphan writing');
        for (const name of ['writer', 'blocker']) pids.push(Number(readFileSync(join(pidsDir, name), 'utf8')));
        cliChild.kill('SIGKILL');
        await new Promise(r => cliChild.on('exit', r));
        setVerify(f.root, { pre_run_command: passRunner(f.root, 'pass') });
        const size0 = statSync(oldLog).size;
        const normal = verifyJson(f.root);
        expect(normal.data.sandbox.reuse.state).toBe('recovered');
        expect(normal.data.sandbox.reuse.generation).not.toBe('ws-000000000001');
        expect(normal.data.sandbox.reuse.abandoned).toContain(join(projectDir, 'ws-000000000001'));
        expect(normal.data.gate.result).toBe('PASS');
        const fresh = verifyJson(f.root, ['--fresh-sandbox']);
        expect(fresh.data.sandbox.reuse.state).toBe('fresh');
        expect(fresh.data.sandbox.reuse.abandoned).toContain(join(projectDir, 'ws-000000000001'));
        await asleep(300);
        expect(existsSync(oldLog), '旧世代未被删除').toBe(true);
        expect(statSync(oldLog).size, 'orphan.log 持续增长').toBeGreaterThan(size0);
        expect(existsSync(join(f.root, 'orphan.log'))).toBe(false);
      } finally {
        for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ } }
      }
    }

    // 臂 ②：主命令正常退出，后台写入者在下一轮清空结果之后写回旧账本（②a 组内、②b 脱组；②b 另跑 fresh 变体）
    for (const variant of ['a', 'b', 'b-fresh'] as const) {
      const f = cliProject();
      const barrier = tmp('openlogos-s13-reuse-bg-');
      const detached = variant !== 'a';
      put(f.root, 'tools/bg.js', `
const fs = require('fs'); const path = require('path');
const target = path.join(process.argv[2], ${JSON.stringify(RESULT)});
const ledger = fs.readFileSync(process.argv[3]);
const go = ${JSON.stringify(join(barrier, 'go'))};
const timer = setInterval(() => {
  if (!fs.existsSync(go)) return;
  clearInterval(timer);
  fs.writeFileSync(target, ledger);
  fs.writeFileSync(${JSON.stringify(join(barrier, 'receipt'))}, '');
}, 20);
setTimeout(() => process.exit(0), 60000);
`);
      setVerify(f.root, { pre_run_command: passRunner(f.root, 'first', `
const { spawn } = require('child_process');
const bg = spawn(process.execPath, ['tools/bg.js', process.cwd(), require('path').resolve('tools/first.data')],
  { stdio: 'ignore', detached: ${detached} });
fs.writeFileSync(${JSON.stringify(join(barrier, 'bg-pid'))}, String(bg.pid));
bg.unref();
`) });
      const first = verifyJson(f.root);
      pids.push(Number(readFileSync(join(barrier, 'bg-pid'), 'utf8')));
      expect(first.data.gate.result).toBe('PASS');
      const projectDir = projectDirOf(f);
      const firstWs = first.data.sandbox.reuse.generation;
      expect(existsSync(join(projectDir, 'lock', 'gen-000000000001.released'))).toBe(false);
      const tainted = JSON.parse(readFileSync(join(projectDir, 'lock', 'gen-000000000001.tainted'), 'utf8'));
      if (detached) {
        let code: string | undefined;
        try { process.kill(-tainted.pgid, 0); } catch (error) { code = (error as NodeJS.ErrnoException).code; }
        expect(code, '首轮结束时命令进程组已空').toBe('ESRCH');
        expect(tainted.reason).toContain('运行标记扫描命中');
      }
      put(f.root, 'tools/second.js', `
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(join(barrier, 'go'))}, '');
const deadline = Date.now() + 20000;
while (!fs.existsSync(${JSON.stringify(join(barrier, 'receipt'))}) && Date.now() < deadline) { const t = Date.now() + 20; while (Date.now() < t) {} }
`);
      setVerify(f.root, { pre_run_command: 'node tools/second.js' });
      const second = verifyJson(f.root, variant === 'b-fresh' ? ['--fresh-sandbox'] : []);
      expect(existsSync(join(barrier, 'receipt')), '后台写入者确已写回旧账本').toBe(true);
      expect(second.data.sandbox.reuse.state).toBe(variant === 'b-fresh' ? 'fresh' : 'recovered');
      expect(second.data.sandbox.reuse.generation).not.toBe(firstWs);
      expect(second.data.gate.result, '旧结果不得归入本轮').toBe('FAIL');
      expect(readFileSync(join(f.root, RESULT), 'utf8')).toBe('');
      expect(readFileSync(join(projectDir, firstWs, 'workspace', RESULT), 'utf8'), '旧账本只留在旧世代').toBe(PASS_LEDGER);
      if (variant === 'b-fresh') {
        expect(existsSync(join(projectDir, firstWs)), 'fresh 未删除仍被使用的旧世代').toBe(true);
        expect(second.data.sandbox.reuse.abandoned).toContain(join(projectDir, firstWs));
      }
    }

    // 臂 ④（code-r1 F2）：运行标记扫描无法完成时不得当作无旧写入者
    {
      const fake = (envs: Record<string, string | NodeJS.ErrnoException>, owners: Record<string, number | NodeJS.ErrnoException>) => ({
        list: () => Object.keys(envs),
        readEnviron: (pid: string) => { const v = envs[pid]; if (typeof v !== 'string') throw v; return v; },
        ownerUid: (pid: string) => { const v = owners[pid]; if (typeof v !== 'number') throw v; return v; },
        currentUid: () => 501,
      });
      const err = (code: string) => Object.assign(new Error(code), { code });
      // 同用户、仍存活但环境不可读 → 无法完成扫描
      expect(() => scanProcEnvironment('tag', fake({ 100: err('EACCES') }, { 100: 501 }))).toThrow(/环境不可读/);
      // 读取时已退出的竞态 → 跳过；其他用户进程不可读 → 跳过；可读且带标记 → 命中
      expect(scanProcEnvironment('tag', fake(
        { 100: err('ENOENT'), 101: err('EACCES'), 102: `A=1\0${'OPENLOGOS_SANDBOX_RUN'}=tag\0`, 103: err('EACCES') },
        { 101: 0, 103: err('ENOENT') },
      ))).toEqual([102]);

      // 扫描无法完成：released 世代复查不通过 → 新建世代；fresh 不删除旧世代
      const g = execFixture({ 'src/a.txt': 'a' });
      const firstRun = exec(g, 'true');
      const oldWs = join(firstRun.sandbox.reuse!.dir!, firstRun.sandbox.reuse!.generation!);
      process.env.OPENLOGOS_SANDBOX_TEST_SCAN_ERROR = '1';
      try {
        const normal = exec(g, 'true');
        expect(normal.sandbox.reuse?.state).toBe('recovered');
        const fresh = exec(g, 'true', { fresh: true });
        expect(fresh.sandbox.reuse?.state).toBe('fresh');
        expect(existsSync(oldWs), '无法确认旧写入者时 fresh 不删除旧世代').toBe(true);
        expect(fresh.sandbox.reuse?.abandoned).toContain(oldWs);
      } finally {
        delete process.env.OPENLOGOS_SANDBOX_TEST_SCAN_ERROR;
      }
    }

    // 臂 ③：锁记录发布后、目标世代同步完成前 CLI 退出
    {
      const f = cliProject();
      setVerify(f.root, { pre_run_command: passRunner(f.root, 'pass') });
      const killed = verifyJson(f.root, [], { OPENLOGOS_SANDBOX_TEST_EXIT_AFTER_PUBLISH: '1' });
      expect(killed.signal).toBe('SIGKILL');
      const next = verifyJson(f.root);
      expect(next.data.sandbox.reuse.state).toBe('recovered');
      expect(latestLockRecord(projectDirOf(f)).ws).toBe(next.data.sandbox.reuse.generation);
      expect(next.data.gate.result).toBe('PASS');
    }
  }, 240_000);

  itReuse('UT-S13-98: 锁被占用、无法确认与无法复用时退回', () => {
    const arms: Array<{ name: string; seed?: (projectDir: string) => void; env?: Record<string, string>; state: string }> = [
      { name: 'held', state: 'busy-fallback', seed: d => writeFileSync(join(d, 'lock', 'gen-000000000003'), JSON.stringify({ token: 't', pid: process.pid, ws: 'ws-000000000003' })) },
      { name: 'garbage', state: 'busy-fallback', seed: d => writeFileSync(join(d, 'lock', 'gen-000000000003'), 'not json') },
      { name: 'link', state: 'unsupported', env: { OPENLOGOS_SANDBOX_TEST_LINK_ERROR: 'EPERM' } },
      { name: 'platform', state: 'unsupported', env: { OPENLOGOS_SANDBOX_TEST_NO_LIVENESS: '1' } },
    ];
    for (const arm of arms) {
      const f = execFixture({ 'src/a.txt': 'a' });
      exec(f, 'true'); // gen-1 / gen-2 之前的正常世代
      const projectDir = projectDirOf(f);
      arm.seed?.(projectDir);
      const lockBefore = lockSnapshot(projectDir);
      const wsBefore = readdirSync(projectDir).sort();
      const saved: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(arm.env ?? {})) { saved[k] = process.env[k]; process.env[k] = v; }
      let run;
      try {
        run = exec(f, 'mkdir -p out && echo ok > out/r.jsonl', { allowed: ['out/r.jsonl'] });
      } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
      expect(run.sandbox.reuse?.state, arm.name).toBe(arm.state);
      expect(readFileSync(join(f.root, 'out/r.jsonl'), 'utf8'), `${arm.name} 结果被回收`).toBe('ok\n');
      expect(existsSync(run.sandbox.root), `${arm.name} 一次性临时目录已删除`).toBe(false);
      expect(lockSnapshot(projectDir), `${arm.name} 锁记录字节不变`).toEqual(lockBefore);
      expect(readdirSync(projectDir).sort()).toEqual(wsBefore);
      const baseline = exec(execFixture({ 'src/a.txt': 'a' }), 'mkdir -p out && echo ok > out/r.jsonl', { allowed: ['out/r.jsonl'], extra: { reuse: false } });
      expect(run.sandbox.status, `${arm.name} status 不因退回改变`).toBe(baseline.sandbox.status);
      if (arm.state === 'unsupported') {
        expect((run.sandbox.infos ?? []).some(i => i.includes('unsupported'))).toBe(true);
      }
    }
  }, 60_000);

  itReuse('UT-S13-99: --fresh-sandbox 重建与锁记录绑定（EX-3.9 锁已释放分支）', () => {
    const f = cliProject({ sandbox_cache_paths: ['build-cache'] });
    setVerify(f.root, { pre_run_command: passRunner(f.root, 'pass', `
console.log('cache=' + (fs.existsSync('build-cache/artifact') ? 'present' : 'missing'));
fs.mkdirSync('build-cache', { recursive: true }); fs.writeFileSync('build-cache/artifact', 'x');`) });
    verifyJson(f.root);
    const prior = verifyJson(f.root);
    expect(prior.data.pre_run.commands[0].stdout_tail).toContain('cache=present');
    const projectDir = projectDirOf(f);
    const oldWs = prior.data.sandbox.reuse.generation;

    const fresh = verifyJson(f.root, ['--fresh-sandbox']);
    expect(fresh.data.sandbox.reuse.state).toBe('fresh');
    expect(fresh.data.sandbox.reuse.generation).not.toBe(oldWs);
    expect(fresh.data.pre_run.commands[0].stdout_tail, '缓存路径从空开始').toContain('cache=missing');
    const record = latestLockRecord(projectDir);
    expect(record.ws).toBe(fresh.data.sandbox.reuse.generation);
    const lockNames = readdirSync(join(projectDir, 'lock')).filter(n => /^gen-\d{12}$/.test(n)).sort();
    const released = JSON.parse(readFileSync(join(projectDir, 'lock', `${lockNames[lockNames.length - 1]}.released`), 'utf8'));
    expect(released.ws).toBe(record.ws);
    expect(existsSync(join(projectDir, oldWs)), '被替换的正常释放世代已删除').toBe(false);
    expect(fresh.data.sandbox.reuse.abandoned).toEqual([]);

    const after = verifyJson(f.root);
    expect(after.data.sandbox.reuse.state).toBe('reused');
    expect(after.data.sandbox.reuse.generation).toBe(fresh.data.sandbox.reuse.generation);
    expect(existsSync(join(projectDir, oldWs)), '旧世代未被重新创建').toBe(false);

    setVerify(f.root, { sandbox_reuse: false });
    const plain = verifyJson(f.root);
    const disabled = verifyJson(f.root, ['--fresh-sandbox']);
    expect(disabled.status).toBe(plain.status);
    expect(disabled.data.sandbox.reuse.state).toBe('disabled');
  }, 90_000);

  it('UT-S13-100: 关闭复用、关闭沙箱与无法复用环境的零回归（EX-3.10、EX-3.12）', () => {
    // ① sandbox_reuse:false
    {
      const f = execFixture({ 'src/a.txt': 'a' });
      const run = exec(f, 'mkdir -p out && echo ok > out/r.jsonl', { extra: { reuse: false }, allowed: ['out/r.jsonl'] });
      expect(run.sandbox.reuse).toEqual({
        enabled: false, state: 'disabled', dir: null, generation: null, copied: 0, removed: 0,
        content_compared: 0, sync_ms: 0, abandoned: [],
      });
      // 有 OS 写保护时为 pass 且无诊断；无写保护的平台（如未装 bwrap 的 Linux）按既有能力分层为 warn
      expect(run.sandbox).toMatchObject({ mode: 'auto', isolated: true });
      expect(['pass', 'warn']).toContain(run.sandbox.status);
      expect(run.sandbox.root).toMatch(/openlogos-cli-sandbox-[^/]+$/);
      expect(existsSync(run.sandbox.root)).toBe(false);
      expect(existsSync(projectDirOf(f)), '不创建持久目录').toBe(false);
    }
    // ② sandbox_mode:off
    {
      const f = execFixture({ 'src/a.txt': 'a' });
      const run = exec(f, 'true', { extra: { mode: 'off' } });
      expect('reuse' in run.sandbox).toBe(false);
      expect(run.sandbox.status).toBe('skipped');
    }
    // ③ 沙箱根位于项目根内；④ 工作区含 FIFO
    const inside = (f: ExecFixture) => ({ ...cfg(f), root: join(f.root, '.sbx') });
    for (const arm of ['inside', 'fifo'] as const) {
      for (const mode of ['auto', 'always'] as const) {
        const results = [true, false].map(reuse => {
          const f = execFixture({ 'src/a.txt': 'a' });
          if (arm === 'fifo') execFileSync('mkfifo', [join(f.root, 'pipe')]);
          const sandbox = arm === 'inside' ? { ...inside(f), mode, reuse } : { ...cfg(f), mode, reuse };
          return runSandboxedCommand({ root: f.root, command: 'true', format: 'json', sandbox, allowedWritePaths: [] });
        });
        const [reused, oneOff] = results;
        expect(reused.sandbox.status, `${arm}/${mode}`).toBe(mode === 'auto' ? 'warn' : 'fail');
        expect(reused.sandbox.status).toBe(oneOff.sandbox.status);
        expect(reused.sandbox.isolated).toBe(false);
        expect(reused.sandbox.diagnostics[0]).toMatch(/^无法启用沙箱：/);
        expect(oneOff.sandbox.diagnostics[0]).toMatch(/^无法启用沙箱：/);
        expect(reused.command.status).toBe(mode === 'auto' ? 'pass' : 'fail');
      }
    }
    // ⑤ 嵌套沙箱：运行标记扫描不可用（setuid ps 被拒）→ unsupported 退回一次性沙箱，不新建、不累积世代
    const nestable = process.platform === 'darwin'
      && spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true']).status === 0;
    if (nestable) {
      const f = execFixture({ 'src/a.txt': 'a' });
      const script = join(tmp('openlogos-s13-reuse-nested-'), 'child.mjs');
      writeFileSync(script, `
import { runSandboxedCommand } from ${JSON.stringify(SANDBOX_DIST)};
const out = [];
for (let i = 0; i < 2; i++) {
  const r = runSandboxedCommand({ root: ${JSON.stringify(f.root)}, command: 'true', format: 'json',
    sandbox: { mode: 'auto', root: ${JSON.stringify(f.sbx)}, denyWorkspaceWrite: true, reuse: true, cachePaths: [] },
    allowedWritePaths: [] });
  out.push({ state: r.sandbox.reuse.state, infos: r.sandbox.infos ?? [] });
}
process.stdout.write(JSON.stringify(out));
`);
      const r = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', process.execPath, script], { encoding: 'utf8' });
      const runs = JSON.parse(r.stdout) as Array<{ state: string; infos: string[] }>;
      expect(runs.map(x => x.state), '嵌套沙箱内不得判为可复用').toEqual(['unsupported', 'unsupported']);
      expect(runs[0].infos.some(i => i.includes('运行标记扫描不可用'))).toBe(true);
      expect(existsSync(projectDirOf(f)), '不创建持久目录、不累积世代').toBe(false);
    }
  }, 60_000);
});

// ───────────────────────── 场景测试 ─────────────────────────

describe('S13 沙箱复用与增量同步 — 场景测试', () => {
  itReuse('ST-S13-25: 模拟增量编译器端到端', () => {
    const f = cliProject({ sandbox_cache_paths: ['build-cache'] });
    for (let i = 1; i <= 20; i++) put(f.root, `src/m${i}.c`, `int m${i}(void) { return ${i}; }\n`);
    put(f.root, 'tools/compile.js', `
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
fs.mkdirSync('build-cache', { recursive: true });
let compiled = 0;
for (const name of fs.readdirSync('src').filter(n => n.endsWith('.c')).sort()) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join('src', name))).digest('hex');
  const obj = path.join('build-cache', name + '.o');
  if (fs.existsSync(obj) && fs.readFileSync(obj, 'utf8') === hash) continue;
  fs.writeFileSync(obj, hash);
  compiled++;
}
console.log('compiled=' + compiled);
fs.mkdirSync(path.dirname(${JSON.stringify(RESULT)}), { recursive: true });
fs.writeFileSync(${JSON.stringify(RESULT)}, ${JSON.stringify(PASS_LEDGER)});
`);
    setVerify(f.root, { pre_run_command: 'node tools/compile.js' });
    const runs = [
      verifyJson(f.root),
      (writeFileSync(join(f.root, 'src/m7.c'), 'int m7(void) { return 700; }\n'), verifyJson(f.root)),
      verifyJson(f.root),
      verifyJson(f.root, ['--fresh-sandbox']),
    ];
    expect(runs.map(r => r.data.gate.result)).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
    const compiled = runs.map(r => /compiled=(\d+)/.exec(r.data.pre_run.commands[0].stdout_tail)?.[1]);
    expect(compiled, '修改前实现每次都是 compiled=20').toEqual(['20', '1', '0', '20']);
    expect(runs.map(r => r.data.sandbox.reuse.state)).toEqual(['created', 'reused', 'reused', 'fresh']);
  }, 120_000);
});
