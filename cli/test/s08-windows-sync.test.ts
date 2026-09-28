/**
 * S08 — Windows 平台资产同步与钩子可移植性（fix-windows-platform-compat，切片 4）。
 * 覆盖 UT-S08-61～UT-S08-69、UT-S08-71、UT-S08-72、ST-S08-38、ST-S08-39
 * （与 logos/resources/test/core-S08-test-cases.md「S08 Windows 平台资产同步与钩子可移植性测试」严格对齐）。
 *
 * 依据架构 §五十二 52.1 / 52.3 / 52.4 / 52.5：stamp 临时路径经 path API 推导；托管 .gitattributes 块；
 * 存量 CRLF 以 Git index blob 为基准受控恢复；适配器目录 rename 经 Windows 瞬时错误有界重试、回滚失败保留备份；
 * Python 探测以执行成功为准；Codex hook 显式 bash；OpenCode 在 win32 以 shell 调 CLI。
 *
 * 对 `node:fs` 仅包装 renameSync / rmSync 做调用记录与故障注入，其余透传。夹具一律在一次性隔离目录内构造，
 * Git 相关用例使用真实 git 与真实 index。ST-S08-38 / ST-S08-39 属 Windows 回归集。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
  renames: [] as Array<{ from: string; to: string }>,
  rms: [] as Array<{ path: string; options: Record<string, unknown> | undefined }>,
  renameFault: null as null | ((from: string, to: string) => Error | null),
  reset() { fsState.renames = []; fsState.rms = []; fsState.renameFault = null; },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped = {
    ...actual,
    renameSync: (from: import('node:fs').PathLike, to: import('node:fs').PathLike) => {
      fsState.renames.push({ from: String(from), to: String(to) });
      const injected = fsState.renameFault?.(String(from), String(to));
      if (injected) throw injected;
      return actual.renameSync(from, to);
    },
    rmSync: (path: import('node:fs').PathLike, options?: import('node:fs').RmOptions) => {
      fsState.rms.push({ path: String(path), options: options as Record<string, unknown> | undefined });
      return actual.rmSync(path, options);
    },
  };
  return { ...wrapped, default: wrapped };
});

const {
  chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
  writeFileSync,
} = await import('node:fs');
const { spawnSync } = await import('node:child_process');
const { createHash } = await import('node:crypto');
const { EventEmitter } = await import('node:events');
const { tmpdir } = await import('node:os');
const pathModule = (await import('node:path')).default;
const { basename, dirname, join, relative, resolve } = pathModule;
const { fileURLToPath, pathToFileURL } = await import('node:url');
const {
  syncStampTempPath, writeSyncStamp, readBundledAssetManifest, deriveManagedAssetsDiagnostic,
} = await import('../src/lib/asset-manifest.js');
const { GITATTRIBUTES_BLOCK_END, GITATTRIBUTES_BLOCK_START, managedGitattributesBlock } = await import('../src/lib/gitattributes.js');
const { buildTestChangeSet, readTestChangeSet } = await import('../src/lib/test-change-set.js');
const { isTransientWindowsFsError, WINDOWS_RENAME_RETRY_DELAYS_MS } = await import('../src/lib/fs-retry.js');
const { isWindowsArchiveBusyError } = await import('../src/lib/archive-watch.js');
const { REMOVE_TREE_MAX_RETRIES } = await import('../src/lib/fs-remove.js');
const { CURSOR_BACKUP_DIR_PREFIX } = await import('../src/lib/cursor-adapter.js');
const { CODEX_HOOK_COMMAND, deployCodexPlugin, detectPythonCommand, PYTHON_PROBE_CANDIDATES } = await import('../src/commands/init.js');
const { sync } = await import('../src/commands/sync.js');
const { mockCwd } = await import('./helpers.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(CLI_ROOT, '..');
const CLI_ENTRY = join(CLI_ROOT, 'dist', 'index.js');

const cleanups: Array<() => void> = [];
afterEach(() => {
  fsState.reset();
  vi.restoreAllMocks();
  while (cleanups.length) cleanups.pop()!();
});

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function cli(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(process.execPath, [CLI_ENTRY, ...args], { cwd, encoding: 'utf-8', env, timeout: 120_000 });
  return { status: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout;
}

function initRepo(root: string): void {
  git(root, ['init', '-q']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'commit.gpgsign', 'false']);
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toCrlf(bytes: Buffer): Buffer {
  return Buffer.from(bytes.toString('latin1').replace(/(?<!\r)\n/g, '\r\n'), 'latin1');
}

/** 目录树快照：posix 相对路径 → 内容 sha256。 */
function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current).sort()) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(dir, full).split(pathModule.sep).join('/')] = sha256(readFileSync(full));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

function withWin32<T>(fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value: 'win32' });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', original); }
}

function eperm(target: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`EPERM: operation not permitted, rename -> '${target}'`), { code: 'EPERM' });
}

function silenceConsole(): { lines: () => string } {
  const captured: string[] = [];
  const push = (...args: unknown[]) => { captured.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(push);
  vi.spyOn(console, 'warn').mockImplementation(push);
  vi.spyOn(console, 'error').mockImplementation(push);
  return { lines: () => captured.join('\n') };
}

/** 四个适配器：托管目录位置、被篡改文件（触发整目录替换）、「安装 rename」判定。 */
const ADAPTERS = [
  { tool: 'zcode', dir: '.zcode/plugins/openlogos', tamper: 'skills/prd-writer/SKILL.md', txnPrefix: '.openlogos-zcode-txn-' },
  { tool: 'qoder', dir: '.qoder/plugins/openlogos', tamper: 'skills/prd-writer/SKILL.md', txnPrefix: '.openlogos-qoder-txn-' },
  { tool: 'workbuddy', dir: '.workbuddy/plugins/openlogos', tamper: 'skills/prd-writer/SKILL.md', txnPrefix: '.openlogos-workbuddy-txn-' },
  { tool: 'cursor', dir: '.cursor/skills/prd-writer', tamper: 'SKILL.md', txnPrefix: CURSOR_BACKUP_DIR_PREFIX },
] as const;
type Adapter = typeof ADAPTERS[number];

function isInstallRename(target: string, from: string, to: string): boolean {
  return to === target && (basename(from) === basename(target) || basename(from).startsWith('new-'));
}

function residualTxnDirs(root: string, adapter: Adapter): string[] {
  const parent = adapter.tool === 'cursor' ? join(root, '.cursor') : dirname(join(root, ...adapter.dir.split('/')));
  return existsSync(parent) ? readdirSync(parent).filter(entry => entry.startsWith(adapter.txnPrefix)) : [];
}

function setupAdapterProject(adapter: Adapter): { root: string; target: string } {
  expect(existsSync(CLI_ENTRY)).toBe(true);
  const root = tempDir(`openlogos-s08w-${adapter.tool}-`);
  const r = cli(root, ['init', '--name', 't', '--locale', 'zh', '--ai-tool', adapter.tool]);
  expect(r.status, r.out).toBe(0);
  const target = join(root, ...adapter.dir.split('/'));
  const tamperFile = join(target, ...adapter.tamper.split('/'));
  expect(existsSync(tamperFile), tamperFile).toBe(true);
  writeFileSync(tamperFile, `${readFileSync(tamperFile, 'utf8')}\n<!-- local drift -->\n`);
  return { root, target };
}

function runSyncInProcess(root: string): { error: unknown; output: string } {
  const restoreCwd = mockCwd(root);
  const console = silenceConsole();
  try {
    withWin32(() => sync());
    return { error: null, output: console.lines() };
  } catch (error) {
    return { error, output: console.lines() };
  } finally {
    restoreCwd();
  }
}

/** 模拟 cmd.exe 两层 ^ 转义解析 + MSVCRT 参数拆分，验证 win32 shell 调用的参数原样到达 CLI。 */
function decodeWindowsShellCommand(command: string): string[] {
  let line = command;
  for (let pass = 0; pass < 2; pass++) line = line.replace(/\^(.)/g, '$1');
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let hasToken = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      let count = 0;
      while (line[i] === '\\') { count++; i++; }
      if (line[i] === '"') {
        current += '\\'.repeat(Math.floor(count / 2));
        if (count % 2 === 1) current += '"';
        else inQuotes = !inQuotes;
        hasToken = true;
      } else {
        current += '\\'.repeat(count);
        i--;
        hasToken = true;
      }
      continue;
    }
    if (ch === '"') { inQuotes = !inQuotes; hasToken = true; continue; }
    if ((ch === ' ' || ch === '\t') && !inQuotes) {
      if (hasToken) { args.push(current); current = ''; hasToken = false; }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (hasToken) args.push(current);
  return args;
}

function fakeSpawnRecorder() {
  const calls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
  const spawnImpl = (command: string, args: string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options });
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  return { calls, spawnImpl };
}

// ── Python 探测三态夹具（架构 §五十二 52.7 第 3 条：测试自身构造并先断言 PATH 条件） ──
function pythonPathFixtures() {
  const base = tempDir('openlogos-s08w-python-');
  const none = join(base, 'none');
  mkdirSync(none);
  const stub = join(base, 'stub');
  mkdirSync(stub);
  if (process.platform === 'win32') {
    // 可被发现但执行即非零退出：以 node.exe 冒充 python3.exe（`-c "import sys"` 对 node 为非法用法）
    const stubExe = join(stub, 'python3.exe');
    try { linkSync(process.execPath, stubExe); } catch { copyFileSync(process.execPath, stubExe); }
  } else {
    writeFileSync(join(stub, 'python3'), '#!/bin/sh\nexit 9\n');
    chmodSync(join(stub, 'python3'), 0o755);
  }
  const realLabel = detectPythonCommand(process.env);
  expect(realLabel, 'P-real 前置条件：本机必须存在可执行的 Python（不成立判 FAIL）').not.toBeNull();
  const candidate = PYTHON_PROBE_CANDIDATES.find(c => c.label === realLabel)!;
  const exe = spawnSync(candidate.command, [...candidate.args, '-c', 'import sys; print(sys.executable)'], { encoding: 'utf-8' })
    .stdout.trim();
  expect(existsSync(exe), exe).toBe(true);
  const envWith = (dir: string): NodeJS.ProcessEnv => ({ ...process.env, PATH: dir, Path: dir });
  // 前置断言：三种 PATH 条件确实成立
  for (const c of PYTHON_PROBE_CANDIDATES) {
    const r = spawnSync(c.command, [...c.args, '-c', 'import sys'], { env: envWith(none), stdio: 'ignore' });
    expect(r.error || r.status !== 0, `P-none 下 ${c.label} 不可执行`).toBeTruthy();
  }
  const stubRun = spawnSync('python3', ['-c', 'import sys'], { env: envWith(stub), stdio: 'ignore' });
  expect(stubRun.error, 'P-stub：python3 桩可被发现').toBeUndefined();
  expect(stubRun.status, 'P-stub：python3 桩执行非零').not.toBe(0);
  return {
    none: envWith(none),
    stub: envWith(stub),
    real: envWith(dirname(exe)),
    realLabel: realLabel!,
  };
}

// ── 存量 CRLF 夹具：launched 项目 + 活跃提案的 SPEC_MERGED.test_change_set 与原型 provenance ──
const SPEC_A = 'logos/resources/test/core-S90-test-cases.md';
const SPEC_B = 'logos/resources/test/core-S91-test-cases.md';
const PROTO = 'logos/resources/prd/2-product-design/2-page-design/home.html';

function specTable(id: string): string {
  return `# ${id} 测试用例\n\n| ID | 测试点 | 预期 |\n|---|---|---|\n| UT-${id}-01 | 第一行 | 通过 |\n| UT-${id}-02 | 第二行 | 通过 |\n`;
}

function writeProposal(root: string, slug: string, specPath: string, withPrototype: boolean): void {
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  const bytes = readFileSync(join(root, ...specPath.split('/')));
  const changeSet = buildTestChangeSet({
    change: slug, module: 'core', targets: [{ targetPath: specPath, beforeBytes: null, afterBytes: bytes }],
  });
  writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({ test_change_set: changeSet }, null, 2));
  if (withPrototype) {
    const html = readFileSync(join(root, ...PROTO.split('/')));
    const deltaDir = join(dir, 'deltas', 'prd', '2-product-design', '2-page-design');
    mkdirSync(deltaDir, { recursive: true });
    writeFileSync(join(deltaDir, 'home.html'), html);
    writeFileSync(join(dir, 'PLAN_APPROVED'), JSON.stringify({
      ui_prototype_rendered: true, pages: ['home.html'], hashes: { 'home.html': sha256(html) },
    }));
  }
}

/** 旧版项目（无托管 .gitattributes 块）：LF 对象 + 既有哈希，提交到真实 git。 */
function setupLegacyLfRepo(): string {
  expect(existsSync(CLI_ENTRY)).toBe(true);
  const root = tempDir('openlogos-s08w-crlf-');
  const r = cli(root, ['init', '--name', 't', '--locale', 'zh', '--ai-tool', 'claude-code']);
  expect(r.status, r.out).toBe(0);
  rmSync(join(root, '.gitattributes'), { force: true });
  writeFileSync(join(root, ...SPEC_A.split('/')), specTable('S90'));
  writeFileSync(join(root, ...SPEC_B.split('/')), specTable('S91'));
  mkdirSync(dirname(join(root, ...PROTO.split('/'))), { recursive: true });
  writeFileSync(join(root, ...PROTO.split('/')), '<!doctype html>\n<html>\n<body>\n<h1>Home</h1>\n</body>\n</html>\n');
  writeProposal(root, 'demo-a', SPEC_A, true);
  writeProposal(root, 'demo-b', SPEC_B, false);
  initRepo(root);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'fixture']);
  return root;
}

function blobBytes(root: string, rel: string): Buffer {
  const r = spawnSync('git', ['cat-file', 'blob', `:./${rel}`], { cwd: root });
  expect(r.status, rel).toBe(0);
  return r.stdout;
}

function file(root: string, rel: string): string {
  return join(root, ...rel.split('/'));
}

describe('S08 Windows 平台资产同步与钩子可移植性', () => {
  it('UT-S08-61: sync 戳临时文件名在反斜杠路径下合法', () => {
    const stampPath = 'C:\\p\\logos\\.openlogos-sync.json';
    const temp = syncStampTempPath(stampPath, pathModule.win32, 4242);
    expect(pathModule.win32.dirname(temp)).toBe('C:\\p\\logos');
    const name = pathModule.win32.basename(temp);
    expect(name).toBe('.openlogos-sync.json.tmp-4242');
    expect(name).not.toMatch(/[:\\]/);
    // 必红对照：修复前实现按 '/' 拆分，win32 路径下推导出含 `C:` 与 `\` 的非法文件名
    const legacyName = `.${stampPath.split('/').pop()}.tmp-4242`;
    expect(legacyName).toMatch(/C:/);
    expect(legacyName).toContain('\\');

    // 真实写入：临时文件与目标同目录，写入后 stamp 合法、无残留
    const dir = tempDir('openlogos-s08w-stamp-');
    const real = join(dir, 'logos', '.openlogos-sync.json');
    mkdirSync(dirname(real));
    const manifest = readBundledAssetManifest();
    writeSyncStamp(real, manifest, '2026-09-28T00:00:00.000Z');
    const rename = fsState.renames.find(r => r.to === real)!;
    expect(dirname(rename.from)).toBe(dirname(real));
    expect(basename(rename.from)).toBe(`.openlogos-sync.json.tmp-${process.pid}`);
    const stamp = JSON.parse(readFileSync(real, 'utf8'));
    expect(stamp.managedAssetsHash).toBe(manifest.payloadHash);
    expect(readdirSync(dirname(real))).toEqual(['.openlogos-sync.json']);
  });

  it('UT-S08-62: 托管 .gitattributes 块幂等写入并保留用户内容', () => {
    const block = managedGitattributesBlock();
    expect(block).toContain('logos/** -text');
    expect(block).toContain('.claude/openlogos/** -text');
    expect(block).toContain('.cursor/hooks/** -text');
    expect(block).toContain('.agents/plugins/openlogos/hooks/** -text');

    // ① 无 .gitattributes：init 新建且仅含托管块；sync 两次零 diff
    const root = tempDir('openlogos-s08w-attr-');
    expect(cli(root, ['init', '--name', 't', '--locale', 'zh']).status).toBe(0);
    const attrPath = join(root, '.gitattributes');
    expect(readFileSync(attrPath, 'utf8')).toBe(block);
    for (let i = 0; i < 2; i++) expect(cli(root, ['sync']).status).toBe(0);
    expect(readFileSync(attrPath, 'utf8')).toBe(block);

    // ② 已有用户内容：用户行字节不变、托管块追加一次；第二次零 diff
    writeFileSync(attrPath, '*.png binary');
    expect(cli(root, ['sync']).status).toBe(0);
    const once = readFileSync(attrPath, 'utf8');
    expect(once).toBe(`*.png binary\n${block}`);
    expect(cli(root, ['sync']).status).toBe(0);
    expect(readFileSync(attrPath, 'utf8')).toBe(once);

    // ③ 已含旧版托管块：原地替换不重复，块外用户内容保留
    const legacy = `*.png binary\n${GITATTRIBUTES_BLOCK_START}\nlogos/** -text\n${GITATTRIBUTES_BLOCK_END}\n*.pdf binary\n`;
    writeFileSync(attrPath, legacy);
    expect(cli(root, ['sync']).status).toBe(0);
    const replaced = readFileSync(attrPath, 'utf8');
    expect(replaced).toBe(`*.png binary\n${block}*.pdf binary\n`);
    expect(replaced.split(GITATTRIBUTES_BLOCK_START)).toHaveLength(2);
    expect(cli(root, ['sync']).status).toBe(0);
    expect(readFileSync(attrPath, 'utf8')).toBe(replaced);
  });

  it('UT-S08-63: 存量 CRLF——仅换行被转换的哈希绑定文件写回 index 字节', () => {
    const root = setupLegacyLfRepo();
    const expectedSpec = sha256(blobBytes(root, SPEC_A));
    const expectedProto = sha256(blobBytes(root, PROTO));
    for (const rel of [SPEC_A, PROTO]) writeFileSync(file(root, rel), toCrlf(blobBytes(root, rel)));
    expect(sha256(readFileSync(file(root, SPEC_A)))).not.toBe(expectedSpec);

    const r = cli(root, ['sync']);
    expect(r.status, r.out).toBe(0);
    for (const rel of [SPEC_A, PROTO]) {
      expect(readFileSync(file(root, rel)).equals(blobBytes(root, rel)), rel).toBe(true);
      expect(r.out, rel).toContain(rel);
    }
    expect(sha256(readFileSync(file(root, SPEC_A)))).toBe(expectedSpec);
    expect(sha256(readFileSync(file(root, PROTO)))).toBe(expectedProto);
    expect(git(root, ['status', '--porcelain', '--', SPEC_A, PROTO])).toBe('');
    // 读取入口复验：test_change_set 与原型哈希均一致
    expect(readTestChangeSet(root, join(root, 'logos', 'changes', 'demo-a'), { change: 'demo-a', module: 'core' }).valid).toBe(true);
  });

  it('UT-S08-64: 存量 CRLF——有本地修改的文件不动并逐路径报告', () => {
    const root = setupLegacyLfRepo();
    const markerPath = join(root, 'logos', 'changes', 'demo-b', 'SPEC_MERGED');
    const markerBefore = readFileSync(markerPath);
    const modified = Buffer.from(toCrlf(blobBytes(root, SPEC_B)).toString('utf8').replace('第二行', '第二行（本地改）'), 'utf8');
    writeFileSync(file(root, SPEC_B), modified);
    // 非哈希绑定的 CRLF 文件：用于证明未执行批量换行改写
    const bystander = 'logos/resources/prd/notes.md';
    mkdirSync(dirname(file(root, bystander)), { recursive: true });
    writeFileSync(file(root, bystander), 'a\r\nb\r\n');

    const r = cli(root, ['sync']);
    expect(r.status, r.out).toBe(0);
    expect(readFileSync(file(root, SPEC_B)).equals(modified)).toBe(true);
    expect(r.out).toMatch(new RegExp(`需人工处理：${SPEC_B.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(readFileSync(markerPath).equals(markerBefore)).toBe(true); // 未重签哈希
    expect(readFileSync(file(root, bystander), 'utf8')).toBe('a\r\nb\r\n');
  });

  it('UT-S08-65: 存量 CRLF——非 Git 仓库 / index 不可读只报告', () => {
    // ① 删除 .git
    const root = setupLegacyLfRepo();
    const crlf = new Map<string, Buffer>();
    for (const rel of [SPEC_A, PROTO]) {
      const bytes = toCrlf(blobBytes(root, rel));
      writeFileSync(file(root, rel), bytes);
      crlf.set(rel, bytes);
    }
    rmSync(join(root, '.git'), { recursive: true, force: true });
    const r1 = cli(root, ['sync']);
    expect(r1.status, r1.out).toBe(0);
    for (const [rel, bytes] of crlf) {
      expect(readFileSync(file(root, rel)).equals(bytes), rel).toBe(true);
      expect(r1.out).toContain(`需人工处理：${rel}`);
    }
    expect(r1.out).toContain('非 Git 仓库');

    // ② index 中无该路径
    const root2 = setupLegacyLfRepo();
    const bytes = toCrlf(blobBytes(root2, SPEC_A));
    git(root2, ['rm', '-q', '--cached', '--', SPEC_A]);
    writeFileSync(file(root2, SPEC_A), bytes);
    const r2 = cli(root2, ['sync']);
    expect(r2.status, r2.out).toBe(0);
    expect(readFileSync(file(root2, SPEC_A)).equals(bytes)).toBe(true);
    expect(r2.out).toContain(`需人工处理：${SPEC_A}`);
    expect(r2.out).toContain('Git index 中无该路径');
  });

  it('UT-S08-66: 托管钩子脚本 CRLF 由随包字节恢复', () => {
    const root = tempDir('openlogos-s08w-hooks-');
    expect(cli(root, ['init', '--name', 't', '--locale', 'zh', '--ai-tool', 'claude-code']).status).toBe(0);
    const bin = join(root, '.claude', 'openlogos', 'bin');
    for (const name of ['guard-check', 'openlogos-phase']) {
      writeFileSync(join(bin, name), toCrlf(readFileSync(join(bin, name))));
      expect(readFileSync(join(bin, name)).includes('\r\n')).toBe(true);
    }
    const r = cli(root, ['sync']);
    expect(r.status, r.out).toBe(0);
    for (const name of ['guard-check', 'openlogos-phase']) {
      const deployed = readFileSync(join(bin, name));
      expect(deployed.equals(readFileSync(join(REPO_ROOT, 'plugin', 'bin', name))), name).toBe(true);
      expect(deployed.includes('\r\n'), name).toBe(false);
    }
    const entry = readBundledAssetManifest().plugins.find(p => p.path === 'claude-plugin-template/bin/guard-check')!;
    expect(sha256(readFileSync(join(bin, 'guard-check')))).toBe(entry.sha256);
  });

  it('UT-S08-67: Cursor skill 备份目录与目标同卷', () => {
    const adapter = ADAPTERS.find(a => a.tool === 'cursor')!;
    const { root, target } = setupAdapterProject(adapter);
    fsState.renames = [];
    const ok = runSyncInProcess(root);
    expect(ok.error, ok.output).toBeNull();
    const backupRename = fsState.renames.find(r => r.from === target)!;
    expect(backupRename, '目标目录先被 rename 到备份位置').toBeDefined();
    const backupRoot = dirname(backupRename.to);
    expect(dirname(backupRoot)).toBe(join(root, '.cursor'));
    expect(basename(backupRoot).startsWith(CURSOR_BACKUP_DIR_PREFIX)).toBe(true);
    expect(dirname(backupRoot)).not.toBe(tmpdir());
    expect(residualTxnDirs(root, adapter)).toEqual([]); // 成功后备份被清理
    expect(readFileSync(join(target, 'SKILL.md'), 'utf8')).not.toContain('local drift');

    // 注入 fault：回滚恢复原目录
    writeFileSync(join(target, 'SKILL.md'), `${readFileSync(join(target, 'SKILL.md'), 'utf8')}\n<!-- local drift 2 -->\n`);
    const before = snapshotTree(target);
    process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT = 'after-skills';
    cleanups.push(() => { delete process.env.OPENLOGOS_CURSOR_TXN_FAIL_AT; });
    const failed = runSyncInProcess(root);
    expect(failed.error).toBeTruthy();
    expect(snapshotTree(target)).toEqual(before);
    expect(residualTxnDirs(root, adapter)).toEqual([]);
  });

  it('UT-S08-68: ZCode / Qoder / WorkBuddy / Cursor 目录 rename 瞬时锁重试', () => {
    expect(isTransientWindowsFsError).toBe(isWindowsArchiveBusyError);
    for (const adapter of ADAPTERS) {
      // ① 前 2 次 EPERM 后透传：成功，重试恰为 2
      const first = setupAdapterProject(adapter);
      let installAttempts = 0;
      fsState.renameFault = (from, to) => {
        if (!isInstallRename(first.target, from, to)) return null;
        installAttempts++;
        return installAttempts <= 2 ? eperm(to) : null;
      };
      fsState.rms = [];
      const ok = runSyncInProcess(first.root);
      expect(ok.error, `${adapter.tool}: ${ok.output}`).toBeNull();
      expect(installAttempts - 1, adapter.tool).toBe(2);
      expect(readFileSync(join(first.target, adapter.tamper), 'utf8'), adapter.tool).not.toContain('local drift');
      const recursiveRms = fsState.rms.filter(c => c.options?.recursive === true);
      expect(recursiveRms.length, adapter.tool).toBeGreaterThan(0);
      for (const c of recursiveRms) expect(c.options?.maxRetries, `${adapter.tool} ${c.path}`).toBe(REMOVE_TREE_MAX_RETRIES);

      // ② 持续 EPERM：重试至上限后抛出，回滚恢复原目录、备份被清理，sync 失败并点名目录
      const second = setupAdapterProject(adapter);
      const before = snapshotTree(second.target);
      let attempts = 0;
      fsState.renameFault = (from, to) => {
        if (!isInstallRename(second.target, from, to)) return null;
        attempts++;
        return eperm(to);
      };
      const failed = runSyncInProcess(second.root);
      fsState.renameFault = null;
      expect(failed.error, adapter.tool).toBeTruthy();
      expect(String((failed.error as Error).message), adapter.tool).toContain(second.target);
      expect(attempts, adapter.tool).toBe(WINDOWS_RENAME_RETRY_DELAYS_MS.length + 1);
      expect(snapshotTree(second.target), adapter.tool).toEqual(before);
      expect(residualTxnDirs(second.root, adapter), adapter.tool).toEqual([]);
    }
  }, 120_000);

  it('UT-S08-72: 适配器目录故障覆盖回滚阶段：如实报告、保留备份', () => {
    for (const adapter of ADAPTERS.filter(a => a.tool === 'cursor' || a.tool === 'zcode')) {
      const { root, target } = setupAdapterProject(adapter);
      // 评审 F3：ZCode 目录为「旧目录叠加新模板」，模板之外的用户文件必须跨回滚失败 + 重跑保真。
      // Cursor 托管 skill 目录按托管哨兵整体替换（正常路径即不保留目录内非模板文件），不设此臂。
      const userNote = adapter.tool === 'cursor' ? null : join(target, 'user-note.md');
      if (userNote) writeFileSync(userNote, '# 用户自有笔记\n');
      const before = snapshotTree(target);
      let sticky = false;
      fsState.renameFault = (from, to) => {
        if (isInstallRename(target, from, to)) sticky = true;
        if (!sticky) return null;
        return existsSync(from) && statSync(from).isDirectory() ? eperm(to) : null;
      };
      const failed = runSyncInProcess(root);
      expect(failed.error, adapter.tool).toBeTruthy();
      const message = String((failed.error as Error).message);
      expect(message, adapter.tool).toContain('回滚未完成');
      const residual = residualTxnDirs(root, adapter);
      expect(residual, adapter.tool).toHaveLength(1);
      const parent = adapter.tool === 'cursor' ? join(root, '.cursor') : dirname(target);
      const residualDir = join(parent, residual[0]);
      expect(message, adapter.tool).toContain(residualDir);
      // 备份仍在且内容等于原托管目录
      const backupDir = adapter.tool === 'cursor'
        ? join(residualDir, `skill-${basename(target)}`)
        : join(residualDir, `${basename(target)}.backup`);
      expect(snapshotTree(backupDir), adapter.tool).toEqual(before);
      expect(existsSync(target), adapter.tool).toBe(false);

      // ③ 解除故障后重跑：成功，托管目录为新版本，残留备份被清理
      fsState.renameFault = null;
      const ok = runSyncInProcess(root);
      expect(ok.error, `${adapter.tool}: ${ok.output}`).toBeNull();
      expect(readFileSync(join(target, adapter.tamper), 'utf8'), adapter.tool).not.toContain('local drift');
      if (userNote) expect(readFileSync(userNote, 'utf8'), `${adapter.tool} 用户文件保真`).toBe('# 用户自有笔记\n');
      expect(residualTxnDirs(root, adapter), adapter.tool).toEqual([]);
    }

    // 评审 F3：待恢复备份与已存在目标并存时无法判定以哪份为准 → 停止报告、保留备份，不静默清除
    const zcode = ADAPTERS.find(a => a.tool === 'zcode')!;
    const { root, target } = setupAdapterProject(zcode);
    const pendingDir = join(dirname(target), `${zcode.txnPrefix}pending`);
    mkdirSync(join(pendingDir, `${basename(target)}.backup`), { recursive: true });
    writeFileSync(join(pendingDir, `${basename(target)}.backup`, 'user-note.md'), 'keep\n');
    const conflict = runSyncInProcess(root);
    expect(String((conflict.error as Error | null)?.message ?? ''), conflict.output).toContain('未恢复的回滚备份');
    expect(readFileSync(join(pendingDir, `${basename(target)}.backup`, 'user-note.md'), 'utf8')).toBe('keep\n');
  }, 120_000);

  it('UT-S08-69: init 的 Python 探测以执行成功为准', () => {
    const fx = pythonPathFixtures();
    expect(detectPythonCommand(fx.none)).toBeNull();
    expect(detectPythonCommand(fx.stub)).toBeNull(); // P-stub 不得被判可用
    const real = detectPythonCommand(fx.real);
    expect(['python3', 'python', 'py -3']).toContain(real);
    expect(PYTHON_PROBE_CANDIDATES.map(c => c.label)).toEqual(['python3', 'python', 'py -3']);
    expect(detectPythonCommand.toString()).not.toMatch(/command -v|\bwhich\b/);
    const initSource = readFileSync(join(CLI_ROOT, 'src', 'commands', 'init.ts'), 'utf8');
    expect(initSource).not.toContain("execSync('python3 --version'");

    // 真实 init：P-none / P-stub 给出安装提示，P-real 不提示
    for (const [label, env, hinted] of [['P-none', fx.none, true], ['P-stub', fx.stub, true], ['P-real', fx.real, false]] as const) {
      const root = tempDir('openlogos-s08w-pyinit-');
      const r = cli(root, ['init', '--name', 't', '--locale', 'zh'], env);
      expect(r.status, `${label}: ${r.out}`).toBe(0);
      expect(r.out.includes('未检测到 Python 3'), label).toBe(hinted);
    }
  }, 60_000);

  it('UT-S08-71: Codex hook 显式 bash、OpenCode 在 win32 以 shell 调 CLI', async () => {
    // ① Codex config.toml 的 SessionStart hook command
    const root = tempDir('openlogos-s08w-codex-');
    const home = tempDir('openlogos-s08w-codex-home-');
    process.env.OPENLOGOS_CODEX_PERSONAL_HOME = home;
    process.env.OPENLOGOS_SKIP_CODEX_PLUGIN_INSTALL = '1';
    cleanups.push(() => {
      delete process.env.OPENLOGOS_CODEX_PERSONAL_HOME;
      delete process.env.OPENLOGOS_SKIP_CODEX_PLUGIN_INSTALL;
    });
    silenceConsole();
    expect(deployCodexPlugin(root, 'zh')).not.toBeNull();
    const toml = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
    const commandLine = toml.split('\n').find(line => line.startsWith('command = '))!;
    expect(JSON.parse(commandLine.slice('command = '.length))).toBe('bash ".agents/plugins/openlogos/hooks/session-start.sh"');
    expect(CODEX_HOOK_COMMAND).toBe('bash ".agents/plugins/openlogos/hooks/session-start.sh"');
    // 旧版直接执行条目被原地升级、不重复
    deployCodexPlugin(root, 'zh');
    expect(readFileSync(join(root, '.codex', 'config.toml'), 'utf8').split('[[hooks.SessionStart]]')).toHaveLength(2);

    // ② OpenCode CLI 桥接（src/cli-bridge.js 与 template/openlogos.js）
    const bridge = await import(pathToFileURL(join(REPO_ROOT, 'plugin-opencode', 'src', 'cli-bridge.js')).href);
    const template = await import(pathToFileURL(join(REPO_ROOT, 'plugin-opencode', 'template', 'openlogos.js')).href);
    const args = ['change', 'my slug "quoted" & more', 'C:\\dir with space\\', '100%', 'a^b'];
    const cwd = tempDir('openlogos-s08w-opencode-');
    mkdirSync(join(cwd, 'logos'), { recursive: true });
    writeFileSync(join(cwd, 'logos', 'logos.config.json'), '{}');
    const runners = [
      (spawnImpl: unknown, platform: string) => bridge.runOpenLogosCommand(args, { cwd, spawnImpl, platform }),
      (spawnImpl: unknown, platform: string) => template.default.internals.runOpenLogos(args, cwd, 15000, { spawnImpl, platform }),
    ];
    for (const run of runners) {
      const win = fakeSpawnRecorder();
      const res = await run(win.spawnImpl, 'win32');
      expect(res.ok).toBe(true);
      expect(win.calls).toHaveLength(1);
      expect(win.calls[0].options.shell).toBe(true);
      expect(win.calls[0].args).toEqual([]);
      expect(win.calls[0].command.startsWith('openlogos ')).toBe(true);
      expect(decodeWindowsShellCommand(win.calls[0].command)).toEqual(['openlogos', ...args]);

      const posix = fakeSpawnRecorder();
      await run(posix.spawnImpl, 'linux');
      expect(posix.calls[0].command).toBe('openlogos');
      expect(posix.calls[0].args).toEqual(args);
      expect(posix.calls[0].options.shell).toBeUndefined();
    }
  });
});

describe('S08 Windows 回归集场景测试', () => {
  it('ST-S08-38: Windows 真实 init + sync 全流程', () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);
    const root = tempDir('openlogos-s08w-st38-');
    const init = cli(root, ['init', '--name', 't', '--locale', 'zh', '--ai-tool', 'claude-code']);
    expect(init.status, init.out).toBe(0);
    const add = cli(root, ['init', '--ai-tool', 'cursor']);
    expect(add.status, add.out).toBe(0);
    const stampPath = join(root, 'logos', '.openlogos-sync.json');
    const manifest = readBundledAssetManifest();

    // 模拟包内资产版本升级：项目戳停留在旧版本标识，托管 Cursor skill 与包内字节不一致
    writeFileSync(stampPath, JSON.stringify({
      cliVersion: '0.0.1', syncedAt: '2020-01-01T00:00:00.000Z', planContractVersion: '0.0.1', managedAssetsHash: '0'.repeat(64),
    }, null, 2));
    const skill = join(root, '.cursor', 'skills', 'prd-writer', 'SKILL.md');
    writeFileSync(skill, `${readFileSync(skill, 'utf8')}\n<!-- old version -->\n`);
    expect(deriveManagedAssetsDiagnostic(root, manifest).status).toBe('stale');

    const first = cli(root, ['sync']);
    expect(first.status, first.out).toBe(0);
    expect(first.out).not.toMatch(/EINVAL|ENOENT|EXDEV/);
    const stamp = JSON.parse(readFileSync(stampPath, 'utf8'));
    expect(stamp.managedAssetsHash).toBe(manifest.payloadHash);
    expect(stamp.cliVersion).toBe(manifest.version);
    expect(readFileSync(skill, 'utf8')).not.toContain('old version');

    const snapshot = snapshotTree(root);
    const second = cli(root, ['sync']);
    expect(second.status, second.out).toBe(0);
    expect(second.out).not.toMatch(/EINVAL|ENOENT|EXDEV/);
    expect(snapshotTree(root)).toEqual(snapshot);

    const status = cli(root, ['status', '--format', 'json']);
    expect(status.status, status.out).toBe(0);
    expect(status.out).not.toMatch(/"managed_assets"\s*:\s*\{\s*"status"\s*:\s*"(missing|stale)"/);
    expect(deriveManagedAssetsDiagnostic(root, manifest).status).toBe('current');
  }, 120_000);

  it('ST-S08-39: 存量 CRLF 工作区升级后恢复', () => {
    const origin = setupLegacyLfRepo();
    const cloneParent = tempDir('openlogos-s08w-st39-');
    const clone = join(cloneParent, 'work');
    const r = spawnSync('git', ['-c', 'core.autocrlf=true', 'clone', '-q', '-c', 'core.autocrlf=true', origin, clone], { encoding: 'utf-8' });
    expect(r.status, r.stderr).toBe(0);
    for (const rel of [SPEC_A, SPEC_B, PROTO, '.claude/openlogos/bin/guard-check']) {
      expect(readFileSync(file(clone, rel)).includes('\r\n'), `${rel} 签出为 CRLF`).toBe(true);
    }
    const modified = readFileSync(file(clone, SPEC_B), 'utf8').replace('第二行', '第二行（本地改）');
    writeFileSync(file(clone, SPEC_B), modified);

    const synced = cli(clone, ['sync']);
    expect(synced.status, synced.out).toBe(0);
    expect(synced.out).toContain(`需人工处理：${SPEC_B}`);

    for (const rel of [SPEC_A, PROTO]) {
      expect(readFileSync(file(clone, rel)).equals(blobBytes(clone, rel)), rel).toBe(true);
    }
    expect(git(clone, ['status', '--porcelain', '--', SPEC_A, PROTO])).toBe('');
    for (const name of ['guard-check', 'openlogos-phase']) {
      const deployed = readFileSync(join(clone, '.claude', 'openlogos', 'bin', name));
      expect(deployed.includes('\r\n'), name).toBe(false);
      expect(deployed.equals(readFileSync(join(REPO_ROOT, 'plugin', 'bin', name))), name).toBe(true);
    }
    expect(readFileSync(file(clone, SPEC_B), 'utf8')).toBe(modified);
    expect(readFileSync(join(clone, '.gitattributes'), 'utf8')).toContain('logos/** -text');

    // 依赖 test_change_set 哈希的读取入口：恢复的一方不再报 target-hash，有本地修改的一方如实保留
    const a = readTestChangeSet(clone, join(clone, 'logos', 'changes', 'demo-a'), { change: 'demo-a', module: 'core' });
    expect(a.valid, JSON.stringify(a)).toBe(true);
    const b = readTestChangeSet(clone, join(clone, 'logos', 'changes', 'demo-b'), { change: 'demo-b', module: 'core' });
    expect(b.valid).toBe(false);
    expect(!b.valid && b.code).toBe('test-slice-change-set-target-hash');
    expect(!b.valid && b.message).toContain(SPEC_B);
  }, 120_000);
});

