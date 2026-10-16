/**
 * local-install-deploy-script 切片 1：本仓 test 环境部署脚本 scripts/deploy-local.mjs（S42 script 方式的使用者）。
 *
 * 覆盖 UT-S42-18～UT-S42-23、UT-S42-25、ST-S42-05、ST-S42-07（logos/resources/test/core-S42-test-cases.md
 * 「五、本仓本机测试环境部署脚本」）。规范源：部署方案「本机测试环境脚本部署（scripts/deploy-local.mjs）」第四～六节。
 *
 * 全部在 mktemp 一次性目录中构造：
 * - 临时 git 项目：放入本仓脚本副本（100755）与最小 cli/ 包夹具（dist/index.js 对 --version 输出版本，含内容标记）；
 * - 一次性「全局」prefix：替身 npm 的 `prefix -g` 返回它；
 * - PATH 前置替身 npm：pack / ci / install -g [--prefix] / uninstall -g，按调用顺序写日志，可按用例注入失败或篡改。
 * 不触碰本机真实全局 prefix、本仓运行态目录与用户其他仓库。结果由全局 OpenLogos reporter 写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { scaffoldProject } from './helpers.js';
import { DEPLOY_LEDGER_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';
import { DEPLOY_WORK_REL } from '../src/commands/deploy.js';

// 每条用例都驱动真实子进程（git、脚本、替身 npm，ST 另含 CLI 与 git worktree），全量 verify 并发时会明显变慢。
vi.setConfig({ testTimeout: 120_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const CLI = resolve(HERE, '../dist/index.js');
const SCRIPT_REL = 'scripts/deploy-local.mjs';
const PKG = '@miniidealab/openlogos';
const RUNTIME_REL = 'logos/.openlogos-runtime/local-install';
const VERSION_A = '9.0.0';
const VERSION_B = '9.1.0';

/**
 * 替身 npm（Node 脚本）。环境变量：
 * - FAKE_NPM_LOG：调用日志（每行 {args, cwd}）；
 * - FAKE_GLOBAL_PREFIX：`prefix -g` 的返回值与未带 --prefix 时的安装目标；
 * - FAKE_NPM_FAULTS：JSON。ci / pack-cli: "fail"；pack-cli: "two"（产出两个 tarball）；
 *   install-<isolated|global>-<rollback|candidate>: "fail" | "wrong-version" | "tamper" | "lock"（安装后 lib 只读）。
 * tarball 种类按路径判断（/rollback/ 或 /candidates/），隔离与否按是否带 --prefix 判断。
 */
const FAKE_NPM = String.raw`#!/usr/bin/env node
const fs = require('fs'); const path = require('path'); const zlib = require('zlib');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ args, cwd: process.cwd() }) + '\n');
const faults = JSON.parse(process.env.FAKE_NPM_FAULTS || '{}');
const globalPrefix = process.env.FAKE_GLOBAL_PREFIX;
const opt = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const die = msg => { process.stderr.write(msg + '\n'); process.exit(1); };
const pkgPath = prefix => path.join(prefix, 'lib', 'node_modules', '@miniidealab', 'openlogos');

function tar(entries) {
  const blocks = [];
  for (const { name, data, mode } of entries) {
    const h = Buffer.alloc(512);
    const put = (str, off, len) => h.write(str, off, len, 'utf-8');
    put(name, 0, 100); put(mode.toString(8).padStart(7, '0') + '\0', 100, 8);
    put('0000000\0', 108, 8); put('0000000\0', 116, 8);
    put(data.length.toString(8).padStart(11, '0') + '\0', 124, 12);
    put('00000000000\0', 136, 12); put('        ', 148, 8); put('0', 156, 1);
    put('ustar\0', 257, 6); put('00', 263, 2);
    let sum = 0; for (const b of h) sum += b;
    put(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}

function untar(file) {
  const data = zlib.gunzipSync(fs.readFileSync(file));
  const out = []; let off = 0;
  while (off + 512 <= data.length) {
    const h = data.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf-8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('utf-8').replace(/\0.*$/s, '').trim() || '0', 8);
    const mode = parseInt(h.subarray(100, 108).toString('utf-8').replace(/\0.*$/s, '').trim() || '644', 8);
    out.push({ name, data: Buffer.from(data.subarray(off + 512, off + 512 + size)), mode });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

function walk(dir, base = dir) {
  const files = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === 'node_modules') continue;
    const p = path.join(dir, name); const st = fs.statSync(p);
    if (st.isDirectory()) files.push(...walk(p, base));
    else files.push({ name: 'package/' + path.relative(base, p), data: fs.readFileSync(p), mode: st.mode & 0o777 });
  }
  return files;
}

const cmd = args[0];
if (cmd === 'prefix') { process.stdout.write(globalPrefix + '\n'); process.exit(0); }
if (cmd === 'ci') { if (faults.ci === 'fail') die('npm ci failed (fake)'); process.exit(0); }
if (cmd === 'pack') {
  const kind = process.cwd().startsWith(fs.realpathSync(globalPrefix)) || process.cwd().startsWith(globalPrefix) ? 'rollback' : 'cli';
  if (kind === 'cli' && faults['pack-cli'] === 'fail') die('npm pack failed (fake)');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  const dest = opt('--pack-destination') || process.cwd();
  const file = pkg.name.replace(/^@/, '').replace('/', '-') + '-' + pkg.version + '.tgz';
  const buf = tar(walk(process.cwd()));
  fs.writeFileSync(path.join(dest, file), buf);
  if (kind === 'cli' && faults['pack-cli'] === 'two') fs.writeFileSync(path.join(dest, 'extra-0.0.0.tgz'), buf);
  process.stdout.write(file + '\n'); process.exit(0);
}
if (cmd === 'install' && args.includes('-g')) {
  const prefix = opt('--prefix') || globalPrefix;
  const tgz = args.filter((a, i) => !a.startsWith('-') && i > 0 && args[i - 1] !== '--prefix').pop();
  const kind = tgz.includes('/rollback/') ? 'rollback' : 'candidate';
  const fault = faults['install-' + (opt('--prefix') ? 'isolated' : 'global') + '-' + kind];
  if (fault === 'fail') die('npm install failed (fake)');
  const dir = pkgPath(prefix);
  fs.rmSync(dir, { recursive: true, force: true });
  for (const e of untar(tgz)) {
    const p = path.join(dir, e.name.replace(/^package\//, ''));
    fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, e.data); fs.chmodSync(p, e.mode);
  }
  const entry = path.join(dir, 'dist', 'index.js');
  if (fault === 'wrong-version') fs.writeFileSync(entry, '#!/usr/bin/env node\nconsole.log("0.0.0-wrong");\n');
  if (fault === 'tamper') fs.appendFileSync(entry, '// tampered\n');
  fs.chmodSync(entry, 0o755);
  const bin = path.join(prefix, 'bin', 'openlogos');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.rmSync(bin, { force: true });
  fs.symlinkSync(path.relative(path.dirname(bin), entry), bin);
  // lock：安装完成后把 <prefix>/lib 设为只读，使脚本最后清理该隔离 prefix 时 rmSync 抛 EACCES（code r1 F1）
  if (fault === 'lock') fs.chmodSync(path.join(prefix, 'lib'), 0o555);
  process.exit(0);
}
if (cmd === 'uninstall' && args.includes('-g')) {
  const prefix = opt('--prefix') || globalPrefix;
  fs.rmSync(pkgPath(prefix), { recursive: true, force: true });
  fs.rmSync(path.join(prefix, 'bin', 'openlogos'), { force: true });
  process.exit(0);
}
die('fake npm: unsupported ' + args.join(' '));
`;

/** 夹具包的入口：对 --version 输出版本；marker 区分同版本的不同内容。 */
const entrySource = (version: string, marker: string) =>
  `#!/usr/bin/env node\n// marker: ${marker}\nif (process.argv.includes('--version')) console.log('${version}');\n`;
const sha = (buf: Buffer | string) => createHash('sha256').update(buf).digest('hex');

let base: string;
let proj: string;
let globalPrefix: string;
let stubBin: string;
let npmLog: string;
let scratchTmp: string;

function put(rel: string, content: string, mode?: number): void {
  const p = join(proj, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  if (mode !== undefined) chmodSync(p, mode);
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: proj, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** 把版本为 version、内容标记为 marker 的夹具包直接装进 prefix（模拟部署前已有的全局安装）。 */
function installFake(prefix: string, version: string, marker: string): void {
  const dir = join(prefix, 'lib/node_modules', PKG);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: PKG, version, bin: { openlogos: 'dist/index.js' } }));
  writeFileSync(join(dir, 'dist/index.js'), entrySource(version, marker));
  chmodSync(join(dir, 'dist/index.js'), 0o755);
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  spawnSync('ln', ['-sf', '../lib/node_modules/@miniidealab/openlogos/dist/index.js', join(prefix, 'bin/openlogos')]);
}

/** 写 cli/ 夹具包并提交；返回提交 sha。 */
function commitCli(version: string, marker: string, message: string): string {
  put('cli/package.json', JSON.stringify({ name: PKG, version, bin: { openlogos: 'dist/index.js' } }, null, 2));
  put('cli/dist/index.js', entrySource(version, marker), 0o755);
  git(['add', '-A']);
  git(['commit', '-qm', message]);
  return git(['rev-parse', 'HEAD']);
}

interface ProjectOpts {
  /** ST：建 OpenLogos 项目骨架与登记表（test 环境指向脚本副本）。 */
  registry?: boolean;
  /** 部署前全局是否已装 A。 */
  globalA?: boolean;
}

function setup(opts: ProjectOpts = {}): string {
  // macOS 的 tmpdir 经 /var → /private/var 符号链接；取 realpath 让脚本输出的路径与断言同形
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lids-')));
  proj = join(base, 'proj');
  globalPrefix = join(base, 'global');
  stubBin = join(base, 'stub-bin');
  npmLog = join(base, 'npm.log');
  scratchTmp = join(base, 'tmp');
  for (const d of [proj, globalPrefix, stubBin, scratchTmp]) mkdirSync(d, { recursive: true });
  writeFileSync(join(stubBin, 'npm'), FAKE_NPM);
  chmodSync(join(stubBin, 'npm'), 0o755);
  writeFileSync(npmLog, '');
  if (opts.globalA !== false) installFake(globalPrefix, VERSION_A, 'a');

  if (opts.registry) {
    scaffoldProject(proj, { locale: 'zh' });
    put(ENV_REGISTRY_REL, stringifyYaml({
      schema_version: 1,
      environments: [{ id: 'test', name: '本地测试环境', tier: 'test', deploy: { mode: 'script', script: SCRIPT_REL } }],
    }, { lineWidth: 0 }));
  }
  put('.gitignore', `logos/.openlogos-runtime/\n${ENV_REGISTRY_REL}\n`);
  mkdirSync(join(proj, 'scripts'), { recursive: true });
  copyFileSync(join(REPO, SCRIPT_REL), join(proj, SCRIPT_REL));
  chmodSync(join(proj, SCRIPT_REL), 0o755);
  git(['init', '-q']);
  git(['config', 'user.name', 't']);
  git(['config', 'user.email', 't@example.invalid']);
  return commitCli(VERSION_B, 'b', 'v1');
}

function env(extra: Record<string, string | undefined> = {}, faults: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [stubBin, join(globalPrefix, 'bin'), process.env.PATH ?? ''].join(delimiter),
    TMPDIR: scratchTmp,
    FAKE_NPM_LOG: npmLog,
    FAKE_GLOBAL_PREFIX: globalPrefix,
    FAKE_NPM_FAULTS: JSON.stringify(faults),
    OPENLOGOS_DEPLOY_ENV: undefined,
    OPENLOGOS_DEPLOY_REF: undefined,
    OPENLOGOS_DEPLOY_ID: undefined,
    OPENLOGOS_DEPLOY_CHANNEL: undefined,
    ...extra,
  };
}

/** 直接在项目根执行脚本（UT）。 */
function runScript(ref: string, faults: Record<string, string> = {}, deployId = 'dep-0001', extra: Record<string, string | undefined> = {}) {
  const r = spawnSync(join(proj, SCRIPT_REL), [], {
    cwd: proj, encoding: 'utf-8', timeout: 60_000,
    env: env({
      OPENLOGOS_DEPLOY_ENV: 'test', OPENLOGOS_DEPLOY_REF: ref, OPENLOGOS_DEPLOY_ID: deployId, OPENLOGOS_DEPLOY_CHANNEL: 'version', ...extra,
    }, faults),
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function cli(args: string[], faults: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: proj, encoding: 'utf-8', timeout: 120_000, env: env({}, faults) });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

interface NpmCall { args: string[]; cwd: string }
const npmCalls = (): NpmCall[] => readFileSync(npmLog, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
/** 去掉只读的 `prefix -g`，把调用归类成可比对的步骤名。 */
function npmSteps(): string[] {
  return npmCalls().filter(c => c.args[0] !== 'prefix').map(c => {
    const [cmd] = c.args;
    if (cmd === 'pack') return c.args.includes('--ignore-scripts') ? 'pack-global' : 'pack-cli';
    if (cmd === 'ci') return 'ci';
    if (cmd === 'uninstall') return 'uninstall-global';
    const tgz = c.args[c.args.length - 1];
    const kind = tgz.includes('/rollback/') ? 'rollback' : 'candidate';
    return `install-${c.args.includes('--prefix') ? 'isolated' : 'global'}-${kind}`;
  });
}

/** 一次性全局 prefix 的目录树指纹（含符号链接目标与权限）。 */
function globalTree(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.push(`L ${p} -> ${readlinkSync(p)}`);
      else if (st.isDirectory()) { out.push(`D ${p}`); walk(p); }
      else out.push(`F ${p} ${sha(readFileSync(p))} ${st.mode & 0o777}`);
    }
  };
  walk(globalPrefix);
  return out.join('\n');
}

const globalVersion = () => spawnSync(join(globalPrefix, 'bin/openlogos'), ['--version'], { encoding: 'utf-8' }).stdout.trim();
const globalEntrySha = () => sha(readFileSync(join(globalPrefix, 'lib/node_modules', PKG, 'dist/index.js')));
const runtime = (...p: string[]) => join(proj, RUNTIME_REL, ...p);
const receipt = (): any => JSON.parse(readFileSync(runtime('last-deploy.json'), 'utf-8'));
const entryShaOf = (version: string, marker: string) => sha(entrySource(version, marker));
const ledger = (): Array<Record<string, any>> => {
  const p = join(proj, DEPLOY_LEDGER_REL);
  return existsSync(p) ? readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
};

beforeEach(() => { base = ''; });
afterEach(() => { if (base) rmSync(base, { recursive: true, force: true }); });

describe('local-install-deploy-script：scripts/deploy-local.mjs（UT）', () => {
  it('UT-S42-18: 输入校验失败时拒绝且零触碰', () => {
    const v1 = setup();
    const older = v1;
    const head = commitCli(VERSION_B, 'b2', 'v2');
    expect(head).not.toBe(older);
    const before = globalTree();

    const cases: Array<[string, Record<string, string | undefined>, RegExp]> = [
      ['缺 REF', { OPENLOGOS_DEPLOY_REF: undefined }, /OPENLOGOS_DEPLOY_REF/],
      ['缺 ID', { OPENLOGOS_DEPLOY_ID: undefined }, /OPENLOGOS_DEPLOY_ID/],
      ['HEAD 不等于请求 commit', { OPENLOGOS_DEPLOY_REF: older }, /HEAD .* 不等于请求 commit/],
    ];
    for (const [label, extra, pattern] of cases) {
      const r = runScript(head, {}, 'dep-0001', extra);
      expect(r.status, label).not.toBe(0);
      expect(r.stderr, label).toMatch(/失败步骤：①/);
      expect(r.stderr, label).toMatch(pattern);
    }
    expect(npmCalls()).toEqual([]);
    expect(globalTree()).toBe(before);
    expect(existsSync(runtime('rollback'))).toBe(false);
    expect(existsSync(runtime('candidates'))).toBe(false);
    expect(existsSync(runtime('last-deploy.json'))).toBe(false);
  });

  it('UT-S42-19: 正常路径的执行顺序与回执', () => {
    const ref = setup();
    const r = runScript(ref, {}, 'dep-0019');
    expect(r.status, r.stderr).toBe(0);

    // 回滚制品的隔离试装严格先于全局安装
    expect(npmSteps()).toEqual([
      'pack-global', 'install-isolated-rollback', 'ci', 'pack-cli', 'install-isolated-candidate', 'install-global-candidate',
    ]);
    const calls = npmCalls().filter(c => c.args[0] !== 'prefix');
    expect(calls[0].cwd).toBe(join(globalPrefix, 'lib/node_modules', PKG));
    expect(calls[2].cwd).toBe(join(proj, 'cli'));

    expect(globalVersion()).toBe(VERSION_B);
    expect(globalEntrySha()).toBe(entryShaOf(VERSION_B, 'b'));

    const rc = receipt();
    expect(rc).toMatchObject({
      deploy_id: 'dep-0019', environment: 'test', ref, candidate_version: VERSION_B,
      candidate_entry_sha256: entryShaOf(VERSION_B, 'b'), prefix: globalPrefix,
      previous_version: VERSION_A, previous_entry_sha256: entryShaOf(VERSION_A, 'a'),
      result: 'done', failed_step: null, restored: false, restore_error: null,
    });
    expect(rc.candidate_tarball.path).toBe(runtime('candidates', 'dep-0019.tgz'));
    expect(sha(readFileSync(rc.candidate_tarball.path))).toBe(rc.candidate_tarball.sha256);
    expect(rc.rollback_artifact.path).toBe(runtime('rollback', 'dep-0019.tgz'));
    expect(sha(readFileSync(rc.rollback_artifact.path))).toBe(rc.rollback_artifact.sha256);
    expect(rc.entry_realpath).toBe(join(globalPrefix, 'lib/node_modules', PKG, 'dist/index.js'));
    expect(Number.isNaN(Date.parse(rc.recorded_at))).toBe(false);
    // 两个隔离 prefix 与 pack 临时目录已删除；运行态目录不在工作树外的其他位置
    expect(readdirSync(scratchTmp)).toEqual([]);
    expect(readdirSync(runtime()).sort()).toEqual(['candidates', 'last-deploy.json', 'rollback']);
  });

  // 只读目录对 root 无效，root 下无法构造清理失败
  it.skipIf(process.getuid?.() === 0)('UT-S42-19: 换包成功后临时目录清理失败不改变已确认的部署结论（code r1 F1）', () => {
    setup({ registry: true });
    git(['tag', 'v1']);
    try {
      const r = cli(['deploy', '--env', 'test', '--ref', 'v1', '--format', 'json'], { 'install-isolated-candidate': 'lock' });
      // 退出结果、回执、全局内容与 CLI 落账四者一致：都是成功
      expect(r.status, r.stderr).toBe(0);
      const last = ledger().filter(l => l.kind === 'deploy').at(-1)!;
      expect(last).toMatchObject({ result: 'done', mode: 'script' });
      expect(receipt()).toMatchObject({ deploy_id: last.deploy_id, result: 'done', restored: false });
      expect(globalVersion()).toBe(VERSION_B);
      expect(globalEntrySha()).toBe(entryShaOf(VERSION_B, 'b'));
      expect(npmSteps()).not.toContain('install-global-rollback');
      // 清理失败的路径与原因进入 stderr（CLI 部署日志）；其余临时目录照常清理，只剩被锁的那个 prefix
      const logText = readFileSync(join(proj, last.log_path), 'utf-8');
      const leftovers = readdirSync(scratchTmp);
      expect(leftovers.length).toBe(1);
      expect(leftovers[0]).toMatch(/^deploy-local-prefix-/);
      expect(logText).toContain(`临时目录清理失败（不影响部署结论，可手动删除）：${join(scratchTmp, leftovers[0])}`);
      // 只读目录下 Node 的 rmSync 报 ENOTEMPTY（macOS）或 EACCES / EPERM
      expect(logText).toMatch(/ENOTEMPTY|EACCES|EPERM/);
    } finally {
      for (const name of existsSync(scratchTmp) ? readdirSync(scratchTmp) : []) {
        const lib = join(scratchTmp, name, 'lib');
        if (existsSync(lib)) chmodSync(lib, 0o755);
      }
    }
  });

  it('UT-S42-20: 回滚制品可打包但隔离试装失败时不执行全局安装', () => {
    for (const fault of ['wrong-version', 'fail']) {
      const ref = setup();
      const before = globalTree();
      const r = runScript(ref, { 'install-isolated-rollback': fault });
      expect(r.status, fault).not.toBe(0);
      const rc = receipt();
      expect(rc.result).toBe('failed');
      expect(rc.failed_step).toBe('④');
      expect(rc.restored).toBe(false);
      expect(rc.restore_error).toBeNull();
      expect(npmSteps()).toEqual(['pack-global', 'install-isolated-rollback']);
      expect(npmSteps()).not.toContain('install-global-candidate');
      expect(globalTree()).toBe(before);
      expect(r.stderr).toMatch(/全局未被改动/);
      rmSync(base, { recursive: true, force: true });
    }
    base = '';
  });

  it('UT-S42-21: 构建、打包或候选隔离试装失败时全局零触碰', () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ ci: 'fail' }, '⑤'],
      [{ 'pack-cli': 'fail' }, '⑤'],
      [{ 'pack-cli': 'two' }, '⑤'],
      [{ 'install-isolated-candidate': 'wrong-version' }, '⑥'],
    ];
    for (const [faults, step] of cases) {
      const ref = setup();
      const before = globalTree();
      const r = runScript(ref, faults);
      const label = JSON.stringify(faults);
      expect(r.status, label).not.toBe(0);
      const rc = receipt();
      expect(rc.result, label).toBe('failed');
      expect(rc.failed_step, label).toBe(step);
      expect(npmSteps(), label).not.toContain('install-global-candidate');
      expect(globalTree(), label).toBe(before);
      // 回滚制品保留
      expect(existsSync(rc.rollback_artifact.path), label).toBe(true);
      rmSync(base, { recursive: true, force: true });
    }
    base = '';
  });

  it('UT-S42-22: 全局安装后复核失败的自动回装', () => {
    // ① 回装正常
    let ref = setup();
    let r = runScript(ref, { 'install-global-candidate': 'tamper' });
    expect(r.status).not.toBe(0);
    let rc = receipt();
    expect(rc).toMatchObject({ result: 'failed', failed_step: '⑧', restored: true, restore_error: null });
    expect(npmSteps().slice(-2)).toEqual(['install-global-candidate', 'install-global-rollback']);
    expect(globalVersion()).toBe(VERSION_A);
    expect(globalEntrySha()).toBe(rc.previous_entry_sha256);
    expect(r.stderr).toMatch(/恢复结果：已回装并复核通过/);
    rmSync(base, { recursive: true, force: true });

    // ② 回装后版本仍不对
    ref = setup();
    r = runScript(ref, { 'install-global-candidate': 'tamper', 'install-global-rollback': 'wrong-version' });
    expect(r.status).not.toBe(0);
    rc = receipt();
    expect(rc).toMatchObject({ result: 'failed', failed_step: '⑧', restored: false });
    expect(rc.restore_error).toMatch(/回装复核/);
    expect(r.stderr).toContain(`人工恢复命令：npm install -g ${rc.rollback_artifact.path}`);
    expect(rc.manual_recovery).toBe(`npm install -g ${rc.rollback_artifact.path}`);
    rmSync(base, { recursive: true, force: true });

    // ③ 部署前未全局安装：无回滚制品，不自动卸载
    ref = setup({ globalA: false });
    r = runScript(ref, { 'install-global-candidate': 'tamper' });
    expect(r.status).not.toBe(0);
    rc = receipt();
    expect(rc).toMatchObject({ result: 'failed', failed_step: '⑧', restored: false, rollback_artifact: null });
    expect(rc.restore_error).toMatch(/无回滚制品/);
    expect(r.stderr).toContain(`npm uninstall -g ${PKG}`);
    expect(npmSteps()).not.toContain('uninstall-global');
  });

  it('UT-S42-23: 部署前未全局安装时首次安装', () => {
    const ref = setup({ globalA: false });
    const r = runScript(ref);
    expect(r.status, r.stderr).toBe(0);
    expect(npmSteps()).toEqual(['ci', 'pack-cli', 'install-isolated-candidate', 'install-global-candidate']);
    expect(globalVersion()).toBe(VERSION_B);
    expect(receipt()).toMatchObject({
      previous_version: null, previous_entry_sha256: null, rollback_artifact: null, result: 'done', candidate_version: VERSION_B,
    });
  });

  it('UT-S42-25: 第 ⑨ 步写回执失败纳入全局变更后的恢复', () => {
    const subcases: Array<{ label: string; faults: Record<string, string>; occupy: 'target' | 'tmp'; restored: boolean }> = [
      { label: '回执目标被目录占据，回装正常', faults: {}, occupy: 'target', restored: true },
      { label: '回执目标被目录占据，回装后版本不对', faults: { 'install-global-rollback': 'wrong-version' }, occupy: 'target', restored: false },
      { label: '临时文件路径被目录占据，回装正常', faults: {}, occupy: 'tmp', restored: true },
    ];
    for (const sc of subcases) {
      const ref = setup();
      const id = 'dep-0025';
      const occupied = sc.occupy === 'target' ? runtime('last-deploy.json') : runtime(`.last-deploy.json.${id}.tmp`);
      mkdirSync(occupied, { recursive: true });
      const r = runScript(ref, sc.faults, id);
      expect(r.status, sc.label).not.toBe(0);
      // 回装与复核被执行
      expect(npmSteps().slice(-2), sc.label).toEqual(['install-global-candidate', 'install-global-rollback']);
      if (sc.restored) {
        expect(globalVersion(), sc.label).toBe(VERSION_A);
        expect(globalEntrySha(), sc.label).toBe(entryShaOf(VERSION_A, 'a'));
        expect(r.stderr, sc.label).toMatch(/恢复结果：已回装并复核通过/);
      } else {
        expect(r.stderr, sc.label).toMatch(/恢复结果：未恢复：/);
      }
      const lines = r.stderr.split('\n');
      expect(lines.some(l => l.includes('失败步骤：⑨')), sc.label).toBe(true);
      expect(lines.some(l => l.includes(`回滚制品：${runtime('rollback', `${id}.tgz`)}`)), sc.label).toBe(true);
      expect(lines.some(l => l.includes(`人工恢复命令：npm install -g ${runtime('rollback', `${id}.tgz`)}`)), sc.label).toBe(true);
      expect(r.stderr, sc.label).toMatch(/回执写不出/);
      // 占据路径的目录不变（仍是空目录），不留下半个 JSON 或其他临时文件
      expect(lstatSync(occupied).isDirectory(), sc.label).toBe(true);
      expect(readdirSync(occupied), sc.label).toEqual([]);
      const leftovers = readdirSync(runtime()).filter(n => !['rollback', 'candidates', 'last-deploy.json', `.last-deploy.json.${id}.tmp`].includes(n));
      expect(leftovers, sc.label).toEqual([]);
      if (sc.occupy === 'tmp') expect(existsSync(runtime('last-deploy.json')), sc.label).toBe(false);
      else expect(existsSync(runtime(`.last-deploy.json.${id}.tmp`)), sc.label).toBe(false);
      expect(existsSync(runtime('rollback', `${id}.tgz`)), sc.label).toBe(true);
      expect(existsSync(runtime('candidates', `${id}.tgz`)), sc.label).toBe(true);
      rmSync(base, { recursive: true, force: true });
    }
    base = '';
  });
});

describe('local-install-deploy-script：真实 CLI 经脚本部署到 test（ST）', () => {
  function deployJson(args: string[], faults: Record<string, string> = {}) {
    const r = cli(['deploy', ...args, '--format', 'json'], faults);
    let data: any = null;
    let error: any = null;
    try { data = JSON.parse(r.stdout).data; } catch { /* 失败路径无 stdout */ }
    try { error = JSON.parse(r.stderr).error; } catch { /* 成功路径无 stderr envelope */ }
    return { ...r, data, error };
  }

  it('ST-S42-05: 真实 CLI 经脚本部署到 test', () => {
    const v1 = setup({ registry: true });
    git(['tag', 'v1']);
    const before = globalTree();

    const check = cli(['env', 'check', '--format', 'json']);
    expect(check.status, check.stderr).toBe(0);
    expect(JSON.parse(check.stdout).data.errors).toEqual([]);

    const dry = deployJson(['--env', 'test', '--ref', 'v1', '--dry-run']);
    expect(dry.status, dry.stderr).toBe(0);
    expect(npmCalls()).toEqual([]);
    expect(globalTree()).toBe(before);

    const r = deployJson(['--env', 'test', '--ref', 'v1']);
    expect(r.status, r.stderr).toBe(0);
    const last = ledger().filter(l => l.kind === 'deploy').at(-1)!;
    expect(last).toMatchObject({ result: 'done', mode: 'script', ref: v1, ref_requested: v1, ref_source: 'explicit', environment: 'test' });
    expect(existsSync(join(proj, DEPLOY_WORK_REL, last.deploy_id))).toBe(false);

    const show = cli(['env', 'show', 'test', '--format', 'json']);
    expect(show.status, show.stderr).toBe(0);
    expect(JSON.parse(show.stdout).data.current_ref).toBe(v1);

    const rc = receipt();
    expect(rc).toMatchObject({ deploy_id: last.deploy_id, ref: v1, result: 'done', candidate_version: VERSION_B });
    expect(globalVersion()).toBe(VERSION_B);
  });

  it('ST-S42-07: 回执写失败时 CLI 只落失败、全局恢复为部署前版本', () => {
    const v1 = setup({ registry: true });
    git(['tag', 'v1']);
    expect(v1).toMatch(/^[0-9a-f]{40}$/);
    mkdirSync(runtime('last-deploy.json'), { recursive: true });
    const currentBefore = JSON.parse(cli(['env', 'show', 'test', '--format', 'json']).stdout).data.current_ref;
    const entryBefore = globalEntrySha();

    const r = deployJson(['--env', 'test', '--ref', 'v1']);
    expect(r.status).toBe(1);
    expect(r.error?.code).toBe('DEPLOY_FAILED');
    expect(r.error?.details?.deployed).toBe(false);

    const last = ledger().filter(l => l.kind === 'deploy').at(-1)!;
    expect(last).toMatchObject({ result: 'failed', ref: null, failure_reason: 'exit-code' });
    expect(JSON.parse(cli(['env', 'show', 'test', '--format', 'json']).stdout).data.current_ref).toBe(currentBefore);

    const logText = readFileSync(join(proj, last.log_path), 'utf-8');
    const rollbackPath = runtime('rollback', `${last.deploy_id}.tgz`);
    expect(logText).toContain('失败步骤：⑨');
    expect(logText).toContain('恢复结果：已回装并复核通过');
    expect(logText).toContain(`回滚制品：${rollbackPath}`);
    expect(logText).toContain(`人工恢复命令：npm install -g ${rollbackPath}`);

    expect(globalVersion()).toBe(VERSION_A);
    expect(globalEntrySha()).toBe(entryBefore);
  });
});

/*
 * 切片 2：安装态 smoke runner scripts/smoke-local-install-deploy.js（SMOKE-core-268～271）。
 * 覆盖 UT-S42-24、ST-S42-06、ST-S42-08。runner 经覆盖入口指向一次性夹具：项目根、替身 npm、仓库内 CLI 入口，
 * 结果写入一次性 smoke 账本；PATH 前置一次性全局 prefix，故 runner 解析到的 openlogos 是夹具全局入口。
 */
const RUNNER = join(REPO, 'scripts/smoke-local-install-deploy.js');
const VERSION_C = '9.2.0';

describe('local-install-deploy-script：安装态 smoke runner（UT / ST）', () => {
  function deploy(ref: string) {
    const r = cli(['deploy', '--env', 'test', '--ref', ref, '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout).data;
  }

  function envShow(): any {
    const r = cli(['env', 'show', 'test', '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout).data;
  }

  /** 运行 runner（OPENLOGOS_SMOKE_ENV=test），返回本次每个用例的结果行。 */
  function runRunner(): { status: number | null; stdout: string; rows: Record<string, any> } {
    const results = join(base, 'smoke-results.jsonl');
    rmSync(results, { force: true });
    const r = spawnSync(process.execPath, [RUNNER], {
      cwd: proj, encoding: 'utf-8', timeout: 120_000,
      env: env({
        OPENLOGOS_LOCAL_INSTALL_SMOKE_ROOT: proj,
        OPENLOGOS_LOCAL_INSTALL_SMOKE_NPM: join(stubBin, 'npm'),
        OPENLOGOS_LOCAL_INSTALL_SMOKE_CLI: CLI,
        OPENLOGOS_SMOKE_RESULT_PATH: results,
        OPENLOGOS_SMOKE_ENV: 'test',
      }),
    });
    const rows: Record<string, any> = {};
    if (existsSync(results)) {
      for (const line of readFileSync(results, 'utf-8').trim().split('\n').filter(Boolean)) {
        const row = JSON.parse(line);
        expect(rows[row.id], `${row.id} 只应有一条结果`).toBeUndefined();
        rows[row.id] = row;
      }
    }
    return { status: r.status, stdout: (r.stdout ?? '') + (r.stderr ?? ''), rows };
  }

  /** 运行态目录（含账本、回执、候选与回滚制品）的指纹。 */
  function runtimeTree(): string {
    const out: string[] = [];
    const rootDir = join(proj, 'logos/.openlogos-runtime');
    const walk = (dir: string) => {
      for (const name of readdirSync(dir).sort()) {
        const p = join(dir, name);
        const st = lstatSync(p);
        if (st.isDirectory()) { out.push(`D ${p}`); walk(p); } else out.push(`F ${p} ${sha(readFileSync(p))}`);
      }
    };
    if (existsSync(rootDir)) walk(rootDir);
    return out.join('\n');
  }

  const statuses = (rows: Record<string, any>) => Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, row.status]));
  const ALL_PASS = { 'SMOKE-core-268': 'pass', 'SMOKE-core-269': 'pass', 'SMOKE-core-270': 'pass', 'SMOKE-core-271': 'pass' };
  const ledgerHash = () => sha(readFileSync(join(proj, DEPLOY_LEDGER_REL)));

  it('UT-S42-24: smoke runner 安装态身份核对（部署工作树删除后）', () => {
    setup({ registry: true });
    git(['tag', 'v1']);
    const deployed = deploy('v1');
    expect(existsSync(join(proj, DEPLOY_WORK_REL, deployed.deploy_id))).toBe(false);

    const assertReadOnly = (label: string, fn: () => ReturnType<typeof runRunner>) => {
      const g = globalTree();
      const rt = runtimeTree();
      const result = fn();
      expect(globalTree(), `${label}：runner 不得改动全局`).toBe(g);
      expect(runtimeTree(), `${label}：runner 不得改动运行态目录与账本`).toBe(rt);
      return result;
    };

    const initial = assertReadOnly('初始', runRunner);
    expect(statuses(initial.rows), initial.stdout).toEqual(ALL_PASS);
    expect(initial.status).toBe(0);
    for (const row of Object.values(initial.rows)) {
      expect(row.target_environment).toBe('test');
      expect(Array.isArray(row.evidence) && row.evidence.length > 0).toBe(true);
    }

    const rc = receipt();
    const globalEntry = join(globalPrefix, 'lib/node_modules', PKG, 'dist/index.js');
    const globalPkg = join(globalPrefix, 'lib/node_modules', PKG, 'package.json');
    const tamperings: Array<{ label: string; file: string; mutate: (orig: Buffer) => Buffer; id: string; field: RegExp }> = [
      { label: '① 全局 dist/index.js 改一个字节', file: globalEntry, mutate: o => Buffer.concat([o, Buffer.from('/')]), id: 'SMOKE-core-269', field: /dist\/index\.js SHA-256/ },
      { label: '② 全局 package.json 版本', file: globalPkg, mutate: o => Buffer.from(o.toString('utf-8').replace(VERSION_B, '9.9.9')), id: 'SMOKE-core-269', field: /全局 package\.json 版本/ },
      { label: '③ 候选 tarball 改一个字节', file: rc.candidate_tarball.path, mutate: o => { const b = Buffer.from(o); b[b.length - 1] ^= 0xff; return b; }, id: 'SMOKE-core-270', field: /候选 tarball SHA-256/ },
      {
        label: '④ 账本最近 deploy 记录的 deploy_id 与回执不同', file: join(proj, DEPLOY_LEDGER_REL), id: 'SMOKE-core-269', field: /last_deploy\.deploy_id/,
        mutate: o => {
          const last = ledger().filter(l => l.kind === 'deploy').at(-1)!;
          const extra = { ...last, deploy_id: 'other-deploy-id', recorded_at: new Date(Date.now() + 1000).toISOString() };
          return Buffer.concat([o, Buffer.from(`${JSON.stringify(extra)}\n`)]);
        },
      },
    ];
    for (const t of tamperings) {
      const original = readFileSync(t.file);
      writeFileSync(t.file, t.mutate(original));
      const r = assertReadOnly(t.label, runRunner);
      expect(r.rows[t.id]?.status, `${t.label}\n${r.stdout}`).toBe('fail');
      expect(r.rows[t.id].detail, t.label).toMatch(t.field);
      expect(r.status, t.label).toBe(1);
      writeFileSync(t.file, original);
    }
    expect(statuses(runRunner().rows)).toEqual(ALL_PASS);
  });

  it('ST-S42-06: 成功部署后手工回装被检出，经记账入口恢复一致', () => {
    const v1 = setup({ registry: true });
    git(['tag', 'v1']);
    deploy('v1');
    const rollback = receipt().rollback_artifact.path;
    const ledgerBefore = ledgerHash();

    // ① 手工回装旧包 A（版本与入口内容都与 B 不同）
    const manual = spawnSync(join(stubBin, 'npm'), ['install', '-g', rollback], { encoding: 'utf-8', env: env() });
    expect(manual.status, manual.stderr).toBe(0);
    expect(globalVersion()).toBe(VERSION_A);
    expect(ledgerHash()).toBe(ledgerBefore);
    expect(envShow().current_ref).toBe(v1);

    // ② 身份核对失败并点名版本与入口哈希
    const detected = runRunner();
    expect(detected.rows['SMOKE-core-269']?.status, detected.stdout).toBe('fail');
    expect(detected.rows['SMOKE-core-269'].detail).toMatch(/全局 --version/);
    expect(detected.rows['SMOKE-core-269'].detail).toMatch(/dist\/index\.js SHA-256/);

    // ③～⑤ 以含脚本的提交经 CLI 重新部署后一致
    const v2 = commitCli(VERSION_C, 'c', 'v2');
    git(['tag', 'v2']);
    deploy('v2');
    const view = envShow();
    expect(view.current_ref).toBe(v2);
    expect(view.previous_ref).toBe(v1);
    const after = runRunner();
    expect(after.rows['SMOKE-core-269']?.status, after.stdout).toBe('pass');
    expect(globalVersion()).toBe(VERSION_C);
  });

  it('ST-S42-08: 成功落账后 smoke 失败不回装旧包，经 CLI 部署修复提交恢复', () => {
    const v1 = setup({ registry: true });
    git(['tag', 'v1']);
    deploy('v1');

    // ① smoke 失败：保存的候选 tarball 被删除
    rmSync(receipt().candidate_tarball.path);
    const mark = npmCalls().length;
    const g = globalTree();
    const ledgerBefore = ledgerHash();
    const failed = runRunner();
    expect(failed.rows['SMOKE-core-270']?.status, failed.stdout).toBe('fail');
    expect(failed.status).toBe(1);
    // ② runner 只做隔离试装，不发出全局 install -g / uninstall -g；全局与账本不变
    const runnerCalls = npmCalls().slice(mark);
    expect(runnerCalls.some(c => c.args[0] === 'uninstall')).toBe(false);
    expect(runnerCalls.some(c => c.args[0] === 'install' && !c.args.includes('--prefix'))).toBe(false);
    expect(globalTree()).toBe(g);
    expect(ledgerHash()).toBe(ledgerBefore);
    expect(envShow().current_ref).toBe(v1);

    // ③～⑤ 部署修复提交后恢复一致
    const v2 = commitCli(VERSION_C, 'c', 'v2 fix');
    git(['tag', 'v2']);
    deploy('v2');
    const view = envShow();
    expect(view.current_ref).toBe(v2);
    expect(view.previous_ref).toBe(v1);
    const after = runRunner();
    expect(statuses(after.rows), after.stdout).toEqual(ALL_PASS);
    expect(globalVersion()).toBe(VERSION_C);
    expect(globalEntrySha()).toBe(receipt().candidate_entry_sha256);
  });
});
