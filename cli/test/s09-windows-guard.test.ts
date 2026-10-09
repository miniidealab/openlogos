/**
 * S09 — Claude Code guard 跨平台可移植性与输入 fail-closed（fix-windows-platform-compat，切片 5）。
 * 覆盖 UT-S09-373～UT-S09-381、ST-S09-149、ST-S09-150、UT-S08-70
 * （与 logos/resources/test/core-S09-test-cases.md「S09 guard 跨平台可移植性与输入 fail-closed 测试」、
 *   core-S08-test-cases.md UT-S08-70 严格对齐）。
 *
 * 被测对象为分发源 `plugin/bin/guard-check`、`plugin/bin/openlogos-phase`、`plugin-codex/session-start.sh`、
 * `plugin-cursor/hooks/runtime.cjs`；托管副本经 init / sync 分发（ST-S09-150）。
 *
 * Python 探测 PATH 三态由测试自身构造并先断言（架构 §五十二 52.7 第 3 条）：
 * - P-none：PATH 仅含 node、bash 与系统工具（POSIX 为去除 python* / py 的系统命令链接目录；Windows 为 node 目录 + Git usr/bin）；
 * - P-stub：P-none 之前放一个可被发现、执行即非零退出的 `python3` 桩（复现商店占位别名，桩内计数）；
 * - P-real：正常 PATH，至少一个候选执行 `-c "import sys"` 退出 0。
 * 故障注入只作用于 Python 探测的 PATH，不替换被测 hook、node、bash 或文件系统。
 *
 * 修复前实现（必红对照 / UT-S09-381 基准）存于 test/fixtures/windows-compat-prefix/，为本变更改动前分发源字节。
 * ST-S09-149 属 Windows 回归集。结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, chmodSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isNotGitWorkTree } from './s09-guard-vcs-fixtures.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(CLI_ROOT, '..');
const CLI_ENTRY = join(CLI_ROOT, 'dist', 'index.js');
const GUARD_SRC = join(REPO_ROOT, 'plugin', 'bin', 'guard-check');
const PHASE_SRC = join(REPO_ROOT, 'plugin', 'bin', 'openlogos-phase');
const CODEX_SRC = join(REPO_ROOT, 'plugin-codex', 'session-start.sh');
const CURSOR_RUNTIME_SRC = join(REPO_ROOT, 'plugin-cursor', 'hooks', 'runtime.cjs');
const PREFIX_DIR = join(HERE, 'fixtures', 'windows-compat-prefix');
const IS_WIN = process.platform === 'win32';
const TIMEOUT = 120_000;

const requireCjs = createRequire(import.meta.url);

const scratch: string[] = [];
function tempDir(prefix: string): string {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  scratch.push(d);
  return d;
}
afterAll(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

/** Git Bash（Windows）或系统 bash（POSIX）的绝对路径。 */
function bashPath(): string {
  if (IS_WIN) {
    const exec = spawnSync('git', ['--exec-path'], { encoding: 'utf-8' }).stdout.trim();
    const gitRoot = resolve(exec, '..', '..', '..');
    const candidate = join(gitRoot, 'bin', 'bash.exe');
    expect(existsSync(candidate), `Git Bash 不存在：${candidate}`).toBe(true);
    return candidate;
  }
  const r = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf-8' });
  return r.stdout.trim();
}

// ── PATH 三态夹具 ─────────────────────────────────────────────────────────────
interface PathEnvs { none: string; noneNoNode: string; stub: string; real: string; stubCounter: string }
let ENVS: PathEnvs;
let BASH: string;

function buildEnvs(): PathEnvs {
  const base = tempDir('openlogos-s09w-path-');
  const nodeDir = join(base, 'node-bin');
  mkdirSync(nodeDir);
  let sysDirs: string[];
  if (IS_WIN) {
    const gitRoot = resolve(spawnSync('git', ['--exec-path'], { encoding: 'utf-8' }).stdout.trim(), '..', '..', '..');
    sysDirs = [join(gitRoot, 'usr', 'bin')];
    writeFileSync(join(nodeDir, 'node'), `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, '/')}" "$@"\n`);
  } else {
    const farm = join(base, 'sys-farm');
    mkdirSync(farm);
    for (const dir of ['/bin', '/usr/bin', '/usr/sbin', '/sbin']) {
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        if (/^python/i.test(name) || name === 'py' || existsSync(join(farm, name))) continue;
        try { symlinkSync(join(dir, name), join(farm, name)); } catch { /* ignore */ }
      }
    }
    sysDirs = [farm];
    symlinkSync(process.execPath, join(nodeDir, 'node'));
  }
  const stubDir = join(base, 'stub');
  mkdirSync(stubDir);
  const stubCounter = join(base, 'stub-calls.log');
  writeFileSync(join(stubDir, 'python3'), `#!/bin/sh\necho call >> "${stubCounter.replace(/\\/g, '/')}"\nexit 9009\n`);
  chmodSync(join(stubDir, 'python3'), 0o755);
  chmodSync(join(nodeDir, 'node'), 0o755);
  const none = [nodeDir, ...sysDirs].join(delimiter);
  return {
    none,
    noneNoNode: sysDirs.join(delimiter),
    stub: [stubDir, none].join(delimiter),
    real: process.env.PATH ?? '',
    stubCounter,
  };
}

/** 受控 PATH 之外只透传运行所需的系统变量（Windows 版 node.exe 需要 SystemRoot 等）。 */
function baseEnv(pathEnv: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { PATH: pathEnv, HOME: process.env.HOME ?? '', ...extra };
  if (IS_WIN) {
    for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']) {
      if (process.env[key]) env[key] = process.env[key];
    }
  }
  return env;
}

function sh(pathEnv: string, script: string): { status: number | null; out: string } {
  const r = spawnSync(BASH, ['-c', script], { encoding: 'utf-8', env: baseEnv(pathEnv) });
  return { status: r.status, out: (r.stdout ?? '').trim() };
}

function assertPathCondition(label: 'P-none' | 'P-stub' | 'P-real', pathEnv: string): void {
  const discoverable = (cmd: string) => sh(pathEnv, `command -v ${cmd} >/dev/null 2>&1 && echo yes || echo no`).out;
  const runs = (cmd: string) => sh(pathEnv, `${cmd} -c "import sys" >/dev/null 2>&1 && echo yes || echo no`).out;
  expect(discoverable('node'), `${label}: node 可用`).toBe('yes');
  if (label === 'P-none') {
    expect([discoverable('python3'), discoverable('python'), discoverable('py')], label).toEqual(['no', 'no', 'no']);
  } else if (label === 'P-stub') {
    expect(discoverable('python3'), 'P-stub: python3 可被发现').toBe('yes');
    expect(runs('python3'), 'P-stub: python3 执行非零').toBe('no');
    expect([discoverable('python'), discoverable('py')], label).toEqual(['no', 'no']);
  } else {
    expect([runs('python3'), runs('python'), runs('py -3')], 'P-real: 至少一个候选可执行').toContain('yes');
  }
}

const STATES = ['P-none', 'P-stub', 'P-real'] as const;
type State = typeof STATES[number];
const envOf = (state: State) => ({ 'P-none': ENVS.none, 'P-stub': ENVS.stub, 'P-real': ENVS.real })[state];

beforeAll(() => {
  BASH = bashPath();
  ENVS = buildEnvs();
}, TIMEOUT);

// ── 项目夹具与 hook 调用 ───────────────────────────────────────────────────────
function launchedProject(opts: { guardSlug?: string } = {}): string {
  const root = tempDir('openlogos-s09w-proj-');
  mkdirSync(join(root, 'logos'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ name: 'win-guard', locale: 'zh' }, null, 2));
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    'project:\n  name: "win-guard"\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n');
  if (opts.guardSlug) {
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: opts.guardSlug, module: 'core' }));
    mkdirSync(join(root, 'logos', 'changes', opts.guardSlug), { recursive: true });
    writeFileSync(join(root, 'logos', 'changes', opts.guardSlug, 'proposal.md'), '# p\n');
  }
  return root;
}

interface HookRun { exit: number | null; stdout: string; stderr: string }

function runHook(script: string, root: string, input: string, pathEnv: string): HookRun {
  const r = spawnSync(BASH, [script], {
    cwd: root, input, encoding: 'utf-8', timeout: 60_000,
    env: baseEnv(pathEnv, { CLAUDE_PROJECT_DIR: root }),
  });
  return { exit: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function guard(root: string, tool: string, toolInput: Record<string, unknown>, pathEnv = ENVS.real, script = GUARD_SRC): HookRun {
  return runHook(script, root, JSON.stringify({ tool_name: tool, tool_input: toolInput }), pathEnv);
}

// ── 函数层：按函数边界加载分发源真实实现 ─────────────────────────────────────────
function sliceFunction(lines: string[], header: string): string {
  const start = lines.findIndex(l => l.startsWith(header));
  expect(start, header).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && l === '}');
  return lines.slice(start, end + 1).join('\n');
}

/** 探测函数 + WHITELIST_PREFIXES 起至 is_whitelisted_path 结束（BASH_SAFE_PATTERNS 前最后一个列首 `}`）。 */
function loadGuardFunctions(dir: string): string {
  const source = readFileSync(GUARD_SRC, 'utf-8');
  const lines = source.split('\n');
  const probe = ['detect_python() {', 'has_python() {', 'run_python() {'].map(h => sliceFunction(lines, h)).join('\n\n');
  const start = lines.findIndex(l => l.startsWith('WHITELIST_PREFIXES=('));
  const fnStart = lines.findIndex(l => l.startsWith('is_whitelisted_path() {'));
  const next = lines.findIndex(l => l.startsWith('BASH_SAFE_PATTERNS=('));
  let end = -1;
  for (let i = next - 1; i > fnStart; i -= 1) if (lines[i] === '}') { end = i; break; }
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(fnStart);
  const region = lines.slice(start, end + 1).join('\n');
  expect(region).toContain('rel_of_cwd() {');
  for (const part of [probe, region]) expect(source).toContain(part);
  const file = join(dir, 'guard-functions.sh');
  writeFileSync(file, `${probe}\n\n${region}\n`);
  return file;
}

const WIN_ROOT = 'C:/Proj/Root';
/** 以受控输入模拟 Windows：覆盖 `pwd -W` 返回项目根的 win32 形态（Git Bash 语义），其余透传 builtin。 */
const PWD_W_SHIM = `pwd() { if [ "\${1:-}" = "-W" ]; then printf '%s\\n' '${WIN_ROOT}'; else builtin pwd "$@"; fi; }`;

function fnCall(fnFile: string, root: string, pathEnv: string, call: string): string {
  const r = spawnSync(BASH, ['-c', `source "$1"; ${PWD_W_SHIM}; ${call}`, 'fn', fnFile], {
    cwd: root, encoding: 'utf-8', timeout: 20_000, env: baseEnv(pathEnv),
  });
  expect(r.stderr ?? '', call).not.toMatch(/command not found/);
  return (r.stdout ?? '').trim();
}

// ── Windows shell 臂（UT-S09-378 / UT-S09-381 / ST-S09-149 共用）──────────────────
const PS_BLOCK = [
  'Set-Content src/a.ts x', 'Out-File -FilePath src/a.ts', 'New-Item src/b.ts', 'Remove-Item src/a.ts',
  'copy src\\a.ts src\\b.ts', 'echo x>src/a.ts', 'echo x > src\\a.ts', 'git log > src\\log.txt',
  "[IO.File]::WriteAllText('src/a.ts','x')", 'Set-Content $p x', 'echo x > $p', 'echo x; Remove-Item src\\a.ts',
];
const PS_EXEMPT = ['echo x>logos/resources/reference/n.md', 'Set-Content logos/resources/reference/n.md x'];
const PS_SAFE = ['echo x', 'Write-Output x', 'echo x > $null', 'git status 2>&1', 'Get-Content src/a.ts', 'openlogos status', 'git status'];
const PS_CASE_VARIANTS = ['set-content src/a.ts x', 'ECHO x>src/a.ts'];
/** 评审 F2：逗号数组多目标，首个为豁免、第二个为受保护源码（位置参数与命名参数两种写法）。 */
const PS_MULTI_TARGET = [
  'Set-Content logos/resources/reference/a.md,src/a.ts x',
  'Set-Content -Path logos/resources/reference/a.md,src/a.ts -Value x',
  "Set-Content -Path 'logos/resources/reference/a.md','src/a.ts' -Value x",
];

describe('S09 guard 跨平台可移植性与输入 fail-closed', () => {
  it('UT-S09-373: 三态 PATH 下 tool_name 均正确解析、判定一致', () => {
    const root = launchedProject();
    const verdicts: Record<string, number[]> = {};
    for (const state of STATES) {
      assertPathCondition(state, envOf(state));
      const env = envOf(state);
      const w = guard(root, 'Write', { file_path: 'src/index.ts' }, env);
      const t = guard(root, 'Bash', { command: 'touch src/a.ts' }, env);
      const p = guard(root, 'Write', { file_path: 'logos/changes/x/proposal.md' }, env);
      const r = guard(root, 'Read', { file_path: 'src/index.ts' }, env);
      for (const [label, run] of [['Write src', w], ['Bash touch', t]] as const) {
        expect(run.exit, `${state} ${label}`).toBe(2);
        expect(run.stderr, `${state} ${label}`).toContain('变更管理拦截');
      }
      expect(p.exit, `${state} 提案目录`).toBe(0);
      expect(r.exit, `${state} Read`).toBe(0);
      verdicts[state] = [w.exit!, p.exit!, r.exit!, t.exit!];
    }
    expect(verdicts['P-none']).toEqual(verdicts['P-real']);
    expect(verdicts['P-stub']).toEqual(verdicts['P-real']);
    // 必红对照：修复前实现的 node 分支读 stdin 设备路径，Windows 上 ENOENT 使 tool_name 为空 → Write src exit 0。
    // POSIX 上该设备路径可读，缺陷不可复现，故对照臂只在 Windows 回归 job 中断言。
    if (IS_WIN) {
      expect(guard(root, 'Write', { file_path: 'src/index.ts' }, ENVS.stub, join(PREFIX_DIR, 'guard-check')).exit).toBe(0);
    }
  }, TIMEOUT);

  it('UT-S09-374: node 分支不读 /dev/stdin', () => {
    const root = launchedProject();
    assertPathCondition('P-none', ENVS.none);
    expect(guard(root, 'Write', { file_path: 'src/index.ts' }, ENVS.none).exit).toBe(2);
    for (const file of [GUARD_SRC, PHASE_SRC]) {
      const text = readFileSync(file, 'utf-8');
      expect(text, file).not.toContain('/dev/stdin');
      expect(text, file).toMatch(/readFileSync\(0,\s*'utf-8'\)/);
    }
    expect(readFileSync(join(PREFIX_DIR, 'guard-check'), 'utf-8')).toContain('/dev/stdin'); // 对照：修复前存在
  }, TIMEOUT);

  it('UT-S09-375: Python 可用判据是「执行成功」而非「可发现」', () => {
    assertPathCondition('P-stub', ENVS.stub);
    const dir = tempDir('openlogos-s09w-fn-');
    const fnFile = loadGuardFunctions(dir);
    writeFileSync(ENVS.stubCounter, '');
    const probed = fnCall(fnFile, dir, ENVS.stub, 'detect_python; echo "PY=$GUARD_PY"');
    expect(probed).toMatch(/^PY=/);
    expect(probed).not.toBe('PY=python3');
    expect(probed).toBe('PY=none');
    // 一次完整 hook 调用内探测只执行一次：桩调用次数 ≤ 候选数
    const root = launchedProject();
    writeFileSync(ENVS.stubCounter, '');
    expect(guard(root, 'Write', { file_path: 'src/index.ts' }, ENVS.stub).exit).toBe(2);
    const calls = readFileSync(ENVS.stubCounter, 'utf-8').split('\n').filter(Boolean).length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(3);
    // 静态：不以 command -v 判 Python，不存在 python→elif node 结构
    for (const file of [GUARD_SRC, PHASE_SRC, CODEX_SRC]) {
      const text = readFileSync(file, 'utf-8');
      expect(text, file).not.toMatch(/command -v python/);
      expect(text, file).not.toMatch(/elif command -v node/);
    }
  }, TIMEOUT);

  it('UT-S09-376: 输入不可解析 fail-closed', () => {
    const root = launchedProject();
    assertPathCondition('P-real', ENVS.real);
    const cases: Array<[string, string, string]> = [
      ['非法 JSON', '{"tool_name":', ENVS.real],
      ['缺 tool_name', JSON.stringify({ tool_input: { file_path: 'src/a.ts' } }), ENVS.real],
      ['无 python 且无 node', JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'src/a.ts' } }), ENVS.noneNoNode],
    ];
    const noNode = sh(ENVS.noneNoNode, 'command -v node >/dev/null 2>&1 && echo yes || echo no').out;
    expect(noNode, '③ 前置：PATH 中无 node').toBe('no');
    for (const [label, input, env] of cases) {
      const run = runHook(GUARD_SRC, root, input, env);
      expect(run.exit, label).toBe(2);
      const reason = JSON.parse(run.stdout) as { reason: string };
      expect(reason.reason, label).toContain('无法解析');
      expect(run.stderr, label).toContain('无法解析');
      expect(run.stderr, label).toContain('node');
    }
  }, TIMEOUT);

  it('UT-S09-377: MultiEdit / NotebookEdit 覆盖与字段缺失 fail-closed', () => {
    const root = launchedProject();
    expect(guard(root, 'MultiEdit', { file_path: 'src/a.ts', edits: [] }).exit).toBe(2);
    expect(guard(root, 'NotebookEdit', { notebook_path: 'src/n.ipynb' }).exit).toBe(2);
    expect(guard(root, 'NotebookEdit', { notebook_path: 'logos/changes/x/n.ipynb' }).exit).toBe(0);
    const missing = guard(root, 'Edit', { old_string: 'a', new_string: 'b' });
    expect(missing.exit).toBe(2);
    expect(missing.stderr).toContain('无法');
  }, TIMEOUT);

  it('UT-S09-378: PowerShell 工具写入模式与 Windows shell 判定顺序', () => {
    const root = launchedProject();
    expect(isNotGitWorkTree(root), 'N-repo 口径：非 git 回落回归锚（git 判据下的新结论见 UT-S09-391 / ST-S09-156 等）').toBe(true);
    assertPathCondition('P-real', ENVS.real);
    mkdirSync(join(root, 'logos', 'resources', 'reference'), { recursive: true });
    for (const command of [...PS_BLOCK, ...PS_CASE_VARIANTS, ...PS_MULTI_TARGET]) {
      const run = guard(root, 'PowerShell', { command });
      expect(run.exit, `应阻断：${command}`).toBe(2);
      expect(run.stderr, command).not.toBe('');
    }
    for (const command of [...PS_EXEMPT, ...PS_SAFE]) {
      expect(guard(root, 'PowerShell', { command }).exit, `应放行：${command}`).toBe(0);
    }
    // 安全白名单对有写入信号的 Windows shell 输入不适用：同一命令在 Bash 工具下按既有顺序放行
    for (const command of ['echo x>src/a.ts', 'echo x > src\\a.ts', 'git log > src\\log.txt']) {
      expect(guard(root, 'Bash', { command }).exit, `Bash 既有顺序：${command}`).toBe(0);
    }
  }, TIMEOUT);

  it('UT-S09-381: 判定顺序例外的作用范围：Cursor win32 同判、Bash 工具零回归', () => {
    const root = launchedProject();
    expect(isNotGitWorkTree(root), 'N-repo 口径：非 git 回落回归锚（git 判据下的新结论见 UT-S09-404 / UT-S09-408 / ST-S09-178 等）').toBe(true);
    const current = requireCjs(CURSOR_RUNTIME_SRC) as { decideShell: (r: string, c: string, p?: string) => { decision: string } };
    const prefix = requireCjs(join(PREFIX_DIR, 'cursor-runtime.cjs')) as { decideShell: (r: string, c: string) => { decision: string } };
    // ① Cursor win32 与 UT-S09-378 逐条同判
    mkdirSync(join(root, 'logos', 'resources', 'reference'), { recursive: true });
    for (const command of PS_MULTI_TARGET) {
      expect(current.decideShell(root, command, 'win32').decision, `Cursor win32 多目标：${command}`).toBe('deny');
    }
    for (const command of [...PS_BLOCK, ...PS_CASE_VARIANTS, ...PS_MULTI_TARGET, ...PS_EXEMPT, ...PS_SAFE]) {
      const cursor = current.decideShell(root, command, 'win32').decision === 'deny' ? 2 : 0;
      expect(cursor, `Cursor win32 ↔ guard PowerShell：${command}`).toBe(guard(root, 'PowerShell', { command }).exit);
    }
    // ② 非 win32 Cursor：与修复前实现逐条相同（基准为修复前实现实测）
    for (const command of ['echo x>src/a.ts', 'echo x']) {
      expect(current.decideShell(root, command, 'darwin').decision, `Cursor darwin：${command}`)
        .toBe(prefix.decideShell(root, command).decision);
    }
    // ③ Bash 工具：单条命令与修复前 guard-check 逐条相同
    for (const command of ['echo x > src/a.ts', 'touch src/a.ts', 'echo x']) {
      expect(guard(root, 'Bash', { command }).exit, `Bash：${command}`)
        .toBe(guard(root, 'Bash', { command }, ENVS.real, join(PREFIX_DIR, 'guard-check')).exit);
    }
    // 复合命令按段判定（verify-smoke-guard-fixes-0-15-20，决策 C04）：`tee` 段不可提取目标 → 阻断
    expect(guard(root, 'Bash', { command: 'echo x | tee src/a.ts' }).exit, 'Bash：echo x | tee src/a.ts').toBe(2);
  }, TIMEOUT);

  it('UT-S09-379: 反斜杠与盘符路径的白名单与管辖判定', () => {
    const dir = tempDir('openlogos-s09w-fn379-');
    const fnFile = loadGuardFunctions(dir);
    const root = launchedProject();
    const nodeOnly = ENVS.none;
    const bashOnly = ENVS.noneNoNode;
    const runtimes: Array<[string, string]> = [['python', ENVS.real], ['node', nodeOnly], ['bash', bashOnly]];
    expect(sh(ENVS.real, `${'python3 -c "import sys" >/dev/null 2>&1 || python -c "import sys" >/dev/null 2>&1 || py -3 -c "import sys" >/dev/null 2>&1'} && echo ok`).out).toBe('ok');
    const winRootNative = WIN_ROOT.replace(/\//g, '\\');
    const cases: Array<[string, number, string | null]> = [
      ['logos\\changes\\x\\proposal.md', 0, 'logos/changes/x/proposal.md'],
      ['CLAUDE.md', 0, 'CLAUDE.md'],
      ['.claude\\openlogos\\bin\\x', 0, '.claude/openlogos/bin/x'],
      ['src\\a.ts', 1, 'src/a.ts'],
      [`${winRootNative}\\src\\a.ts`, 1, 'src/a.ts'],
      [`${winRootNative.toLowerCase()}\\CLAUDE.md`, 0, 'CLAUDE.md'],
      ['D:\\other\\x.ts', 0, null],
      // 评审 F1：点段须先消解再判管辖与白名单，均实指受保护的 src/a.ts
      [`${WIN_ROOT}/.claude/../src/a.ts`, 1, 'src/a.ts'],
      [`${WIN_ROOT}/logos/changes/../../src/a.ts`, 1, 'src/a.ts'],
      [`${WIN_ROOT}/../Root/src/a.ts`, 1, 'src/a.ts'],
      [`${winRootNative}\\.claude\\..\\src\\a.ts`, 1, 'src/a.ts'],
      ['logos/changes/../../src/a.ts', 1, 'src/a.ts'],
      ['.claude/../src/a.ts', 1, 'src/a.ts'],
    ];
    for (const [runtime, env] of runtimes) {
      for (const [input, rc, rel] of cases) {
        const q = JSON.stringify(input).replace(/\$/g, '\\$');
        expect(fnCall(fnFile, root, env, `is_whitelisted_path ${q}; echo "rc=$?"`), `${runtime} ${input}`).toBe(`rc=${rc}`);
        const got = fnCall(fnFile, root, env, `rel_of_cwd ${q}`);
        if (rel === null) expect(got.startsWith('../'), `${runtime} ${input} → ${got}`).toBe(true);
        else expect(got, `${runtime} ${input}`).toBe(rel);
      }
    }
  }, TIMEOUT);

  it('UT-S09-379: 点段路径经完整 hook 的 Write / Edit 判定（评审 F1）', () => {
    const root = launchedProject();
    mkdirSync(join(root, '.claude'), { recursive: true });
    mkdirSync(join(root, 'logos', 'changes'), { recursive: true });
    for (const state of STATES) {
      const env = envOf(state);
      for (const input of [
        `${root}/.claude/../src/a.ts`,
        `${root}/logos/changes/../../src/a.ts`,
        'logos/changes/../../src/a.ts',
      ]) {
        for (const tool of ['Write', 'Edit']) {
          expect(guard(root, tool, { file_path: input }, env).exit, `${state} ${tool} ${input}`).toBe(2);
        }
      }
    }
  }, TIMEOUT);

  it('UT-S09-380: plan 阶段 delta 收窄在反斜杠路径下有效', () => {
    const slug = 'win-plan';
    const root = launchedProject({ guardSlug: slug });
    const proto = `logos\\changes\\${slug}\\deltas\\prd\\2-product-design\\2-page-design\\core-01-x.html`;
    const tests = `logos\\changes\\${slug}\\deltas\\test\\core-S01-test-cases.md`;
    expect(guard(root, 'Write', { file_path: proto }).exit).toBe(0);
    const blocked = guard(root, 'Write', { file_path: tests });
    expect(blocked.exit).toBe(2);
    expect(blocked.stderr).toContain('plan 阶段');
    // 评审 F1：以点段从原型目录绕进非原型 delta 同样被收窄
    const dotted = `logos/changes/${slug}/deltas/prd/2-product-design/2-page-design/../../../test/core-S01-test-cases.md`;
    expect(guard(root, 'Write', { file_path: dotted }).exit).toBe(2);
    expect(guard(root, 'Write', { file_path: `${root}/${dotted}` }).exit).toBe(2);
    // 必红对照：修复前实现对后者 exit 0（反斜杠路径与 / 前缀比较失配，收窄失效）
    expect(guard(root, 'Write', { file_path: tests }, ENVS.real, join(PREFIX_DIR, 'guard-check')).exit).toBe(0);
  }, TIMEOUT);
});

// ── SessionStart 注入（UT-S08-70）────────────────────────────────────────────
function sessionProject(): { root: string; bin: string } {
  const root = launchedProject({ guardSlug: 'demo-change' });
  const bin = join(root, '.fake-bin');
  mkdirSync(bin);
  const status = JSON.stringify({
    command: 'status', version: 'test',
    data: {
      lifecycle: 'launched', current_phase: null, suggestion: '继续当前提案', all_done: false,
      active_change: 'demo-change', proposal_step: 'delta-writing',
    },
  });
  writeFileSync(join(bin, 'openlogos'), `#!/bin/sh\nif [ "$1" = "status" ]; then\ncat <<'JSON'\n${status}\nJSON\nexit 0\nfi\nexit 1\n`);
  chmodSync(join(bin, 'openlogos'), 0o755);
  return { root, bin };
}

function sessionContext(script: string, root: string, pathEnv: string): string {
  const r = spawnSync(BASH, [script], { cwd: root, encoding: 'utf-8', timeout: 60_000, env: baseEnv(pathEnv) });
  expect(r.status, `${script}: ${r.stderr}`).toBe(0);
  const parsed = JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } };
  return parsed.hookSpecificOutput.additionalContext;
}

describe('S08 SessionStart 注入跨平台', () => {
  it('UT-S08-70: openlogos-phase 与 Codex session-start 三态下正确注入', () => {
    const { root, bin } = sessionProject();
    for (const script of [PHASE_SRC, CODEX_SRC]) {
      const outputs: Record<string, string> = {};
      for (const state of STATES) {
        assertPathCondition(state, envOf(state));
        const ctx = sessionContext(script, root, [bin, envOf(state)].join(delimiter));
        expect(ctx, `${state} ${script}`).toContain('Locale: zh');
        expect(ctx, `${state} ${script}`).toMatch(/中文/);
        expect(ctx, `${state} ${script}`).toContain('demo-change');
        expect(ctx, `${state} ${script}`).toMatch(/launched/);
        outputs[state] = ctx;
      }
      expect(outputs['P-none'], script).toBe(outputs['P-real']);
      expect(outputs['P-stub'], script).toBe(outputs['P-real']);
      expect(readFileSync(script, 'utf-8'), script).not.toContain('/dev/stdin');
    }
    // 必红对照：修复前实现在 P-stub 下未得到中文 locale 且状态字段为空
    // （openlogos-phase 回落为英文；Codex 版连上下文转义也走 python 桩，整段上下文为空）
    const prefixPhase = sessionContext(join(PREFIX_DIR, 'openlogos-phase'), root, [bin, ENVS.stub].join(delimiter));
    expect(prefixPhase).toContain('Locale: en');
    expect(prefixPhase).not.toContain('demo-change');
    const prefixCodex = sessionContext(join(PREFIX_DIR, 'session-start.sh'), root, [bin, ENVS.stub].join(delimiter));
    expect(prefixCodex).not.toContain('Locale: zh');
    expect(prefixCodex).not.toContain('demo-change');
  }, TIMEOUT);
});

// ── 场景测试 ──────────────────────────────────────────────────────────────────
describe('S09 Windows 回归集场景测试', () => {
  it('ST-S09-149: Windows Git Bash 真实执行 guard-check 三态', () => {
    const root = launchedProject();
    const verdicts: Record<string, Array<number | null>> = {};
    for (const state of STATES) {
      assertPathCondition(state, envOf(state));
      const env = envOf(state);
      const src = guard(root, 'Write', { file_path: join(root, 'src', 'index.ts') }, env);
      const claude = guard(root, 'Write', { file_path: 'CLAUDE.md' }, env);
      const touch = guard(root, 'Bash', { command: 'touch src/a.ts' }, env);
      const ps = guard(root, 'PowerShell', { command: 'Set-Content src\\a.ts x' }, env);
      for (const [label, run] of [['Write src', src], ['Bash touch', touch], ['PowerShell', ps]] as const) {
        expect(run.exit, `${state} ${label}`).toBe(2);
        expect(run.stderr.trim(), `${state} ${label}`).not.toBe('');
      }
      expect(claude.exit, `${state} CLAUDE.md`).toBe(0);
      verdicts[state] = [src.exit, claude.exit, touch.exit, ps.exit];
    }
    expect(verdicts['P-none']).toEqual(verdicts['P-real']);
    expect(verdicts['P-stub']).toEqual(verdicts['P-real']);
  }, TIMEOUT);

  it('ST-S09-150: init / sync 部署的 matcher 与托管副本', () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);
    const NEW = 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell';
    const GUARD_CMD = '"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check';
    const cli = (cwd: string, args: string[]) => {
      const r = spawnSync(process.execPath, [CLI_ENTRY, ...args], { cwd, encoding: 'utf-8', timeout: 120_000 });
      expect(r.status, `${args.join(' ')}: ${r.stdout}\n${r.stderr}`).toBe(0);
    };
    const managedGroups = (root: string) => {
      const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
      return (settings.hooks.PreToolUse as Array<{ matcher: string; hooks: Array<{ command: string }> }>)
        .filter(g => g.hooks.some(h => h.command === GUARD_CMD));
    };
    // ① P1 新建
    const p1 = tempDir('openlogos-s09w-p1-');
    cli(p1, ['init', '--name', 'p1', '--locale', 'zh', '--ai-tool', 'claude-code']);
    expect(managedGroups(p1).map(g => g.matcher)).toEqual([NEW]);
    // ② P2 存量：旧 matcher 托管条目 + 用户自有 hook
    const p2 = tempDir('openlogos-s09w-p2-');
    cli(p2, ['init', '--name', 'p2', '--locale', 'zh', '--ai-tool', 'claude-code']);
    const settingsPath = join(p2, '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const userGroup = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-own-hook' }] };
    settings.hooks.PreToolUse = [
      { matcher: 'Edit|Write|Bash', hooks: [{ type: 'command', command: GUARD_CMD }] },
      userGroup,
    ];
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    cli(p2, ['sync']);
    const after = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    expect(managedGroups(p2).map(g => g.matcher)).toEqual([NEW]);
    expect(after.hooks.PreToolUse).toContainEqual(userGroup);
    // ③ 托管 guard-check 与分发源逐字节一致；重复 sync 零 diff
    for (const root of [p1, p2]) {
      expect(readFileSync(join(root, '.claude', 'openlogos', 'bin', 'guard-check')).equals(readFileSync(GUARD_SRC)), root).toBe(true);
    }
    const snapshot = [readFileSync(settingsPath), readFileSync(join(p2, '.claude', 'openlogos', 'bin', 'guard-check'))];
    cli(p2, ['sync']);
    expect(readFileSync(settingsPath).equals(snapshot[0])).toBe(true);
    expect(readFileSync(join(p2, '.claude', 'openlogos', 'bin', 'guard-check')).equals(snapshot[1])).toBe(true);
  }, TIMEOUT);
});
