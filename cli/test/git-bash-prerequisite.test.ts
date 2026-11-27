/**
 * fix-claude-hook-windows-powershell-fallback 切片 2：Windows Git Bash 前提警告（S01 / S08）。
 *
 * 覆盖 UT-S01-149、UT-S08-87、ST-S08-45（与 logos/resources/test/core-S01-test-cases.md、core-S08-test-cases.md 对齐；
 * 规则见功能规格 §2.105.5）。
 * - UT-S01-149 直接驱动纯函数 probeGitBash / gitBashWarningLines（平台、环境变量、文件存在、git 调用全部注入）。
 * - UT-S08-87 以 vi.mock 注入前提检查依赖后调用真实 sync 入口，分别捕获 stdout（console.log）、stderr（console.error）与退出码。
 * - ST-S08-45 属 Windows 回归集（package.json `test:windows`），在 windows-latest 运行真实 CLI；非 Windows 平台跳过
 *   （reporter 记 skip：平台能力限制，用例名注明）。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { itOnPlatform } from './platform-skip.js';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import {
  GIT_EXEC_PATH_TIMEOUT_MS, gitBashWarningLines, makeRunGit, probeGitBash, type GitBashProbeDeps,
} from '../src/lib/git-bash-prerequisite.js';
import { captureConsole, makeTempRoot, mockCwd } from './helpers.js';

const state = vi.hoisted(() => ({ deps: null as null | Record<string, unknown> }));
vi.mock('../src/lib/git-bash-prerequisite.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/git-bash-prerequisite.js')>();
  return { ...mod, defaultGitBashDeps: () => (state.deps as GitBashProbeDeps | null) ?? mod.defaultGitBashDeps() };
});

const IS_WIN = process.platform === 'win32';
const CLI_ENTRY = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js');
const MINGIT_EXEC_PATH = 'C:/Users/admin/Documents/Codex/Git/mingw64/libexec/git-core\n';
const MINGIT_ROOT = 'C:\\Users\\admin\\Documents\\Codex\\Git';

/** win32 注入依赖：files 为存在的文件集合（反斜杠路径，大小写不敏感比较）。 */
function winDeps(opts: { env?: Record<string, string>; files?: string[]; git?: () => string }): GitBashProbeDeps {
  const files = new Set((opts.files ?? []).map(f => f.toLowerCase()));
  return {
    platform: 'win32',
    env: opts.env ?? {},
    exists: p => files.has(p.replace(/\//g, '\\').toLowerCase()),
    runGit: opts.git ?? (() => { throw new Error('git: not found'); }),
  };
}

let root: string;
let cleanup: () => void;
beforeEach(() => { ({ root, cleanup } = makeTempRoot()); state.deps = null; });
afterEach(() => { state.deps = null; cleanup(); });

describe('S01 Git Bash 前提检查', () => {
  it('UT-S01-149: Git Bash 前提检查（纯函数）', () => {
    // 非 Windows：不检查、无警告
    const darwin = probeGitBash({ platform: 'darwin', env: {}, exists: () => true, runGit: () => '' });
    expect(darwin).toEqual({ checked: false, found: false });
    expect(gitBashWarningLines('zh', darwin)).toEqual([]);

    // CLAUDE_CODE_GIT_BASH_PATH 指向存在的 bash.exe / BASH.EXE / sh.exe → 命中
    for (const p of ['D:\\PortableGit\\bin\\bash.exe', 'D:\\PortableGit\\bin\\BASH.EXE', 'D:\\PortableGit\\usr\\bin\\sh.exe']) {
      expect(probeGitBash(winDeps({ env: { CLAUDE_CODE_GIT_BASH_PATH: p }, files: [p] }))).toEqual({ checked: true, found: true, via: 'env' });
    }
    // 变量误指现存 git.exe + 只有 MinGit + 标准位置为空 → 继续探测，最终警告含 MinGit 安装根与 winget 命令
    const gitExe = 'C:\\Users\\admin\\Documents\\Codex\\Git\\cmd\\git.exe';
    const mingit = probeGitBash(winDeps({
      env: { CLAUDE_CODE_GIT_BASH_PATH: gitExe, ProgramFiles: 'C:\\Program Files' }, files: [gitExe], git: () => MINGIT_EXEC_PATH,
    }));
    expect(mingit).toEqual({ checked: true, found: false, gitRoot: MINGIT_ROOT });
    const zh = gitBashWarningLines('zh', mingit).join('\n');
    expect(zh).toContain('依赖 Git Bash');
    expect(zh).toContain('winget install --id Git.Git -e');
    expect(zh).toContain('https://git-scm.com/download/win');
    expect(zh).toContain('CLAUDE_CODE_GIT_BASH_PATH');
    expect(zh).toContain('开新的 Claude Code 会话');
    expect(zh).toContain(MINGIT_ROOT);
    expect(zh).toContain('MinGit');
    const en = gitBashWarningLines('en', mingit).join('\n');
    expect(en).toContain('depends on Git Bash');
    expect(en).toContain('winget install --id Git.Git -e');
    expect(en).toContain(MINGIT_ROOT);
    expect(en).toContain('new Claude Code session');

    // git 反推：mingw64 / mingw32 / clangarm64 后缀，安装根下有 bin\bash.exe → 命中
    for (const arch of ['mingw64', 'mingw32', 'clangarm64']) {
      const deps = winDeps({ git: () => `D:/tools/Git/${arch}/libexec/git-core`, files: ['D:\\tools\\Git\\bin\\bash.exe'] });
      expect(probeGitBash(deps)).toEqual({ checked: true, found: true, via: 'git' });
    }
    // %ProgramFiles%\Git\bin\bash.exe 存在 → 命中
    expect(probeGitBash(winDeps({ env: { ProgramFiles: 'C:\\Program Files' }, files: ['C:\\Program Files\\Git\\bin\\bash.exe'] })))
      .toEqual({ checked: true, found: true, via: 'program-files' });
    // runGit 抛错 / 超时 / 输出无已知后缀 → 本项未命中并继续，最终无安装根提示
    for (const git of [() => { throw new Error('ETIMEDOUT'); }, () => 'garbage output\n', () => '']) {
      const r = probeGitBash(winDeps({ git }));
      expect(r).toEqual({ checked: true, found: false });
      expect(gitBashWarningLines('zh', r).join('\n')).not.toContain('MinGit');
    }
    // win32 下 git 以 shell 方式调用（execSync 字符串命令），5 秒超时
    const calls: Array<[string, Record<string, unknown>]> = [];
    const runGit = makeRunGit(((cmd: string, opts: Record<string, unknown>) => { calls.push([cmd, opts]); return MINGIT_EXEC_PATH; }) as never);
    expect(runGit()).toBe(MINGIT_EXEC_PATH);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('git --exec-path');
    expect(calls[0][1].timeout).toBe(GIT_EXEC_PATH_TIMEOUT_MS);
    expect(GIT_EXEC_PATH_TIMEOUT_MS).toBe(5000);
  });
});

describe('S08 sync 的 Git Bash 前提警告', () => {
  async function initProject(base: string, aiTool: string): Promise<void> {
    const restore = mockCwd(base); const cap = captureConsole();
    try { await init('demo', { locale: 'zh', aiTool }); } finally { cap.restore(); restore(); }
  }
  function runSync(base: string): { stdout: string; stderr: string; exitCode: number | undefined } {
    const prev = process.exitCode;
    process.exitCode = undefined;
    const restore = mockCwd(base); const cap = captureConsole();
    try { sync(); } finally { cap.restore(); restore(); }
    const exitCode = process.exitCode as number | undefined;
    process.exitCode = prev;
    return { stdout: cap.logs.join('\n'), stderr: cap.errors.join('\n'), exitCode };
  }

  it('UT-S08-87: sync 的 Git Bash 前提警告与输出通道', async () => {
    await initProject(root, 'claude-code');
    runSync(root); // 先稳定一次，后续两次 sync 的既有输出可直接比较
    const missing = winDeps({ git: () => MINGIT_EXEC_PATH });
    const present = winDeps({ env: { ProgramFiles: 'C:\\Program Files' }, files: ['C:\\Program Files\\Git\\bin\\bash.exe'] });

    state.deps = present as unknown as Record<string, unknown>;
    const ok = runSync(root);
    state.deps = missing as unknown as Record<string, unknown>;
    const warned = runSync(root);
    // 警告只出现在 stderr
    expect(warned.stderr).toContain('winget install --id Git.Git -e');
    expect(warned.stderr).toContain(MINGIT_ROOT);
    expect(warned.stdout).not.toContain('Git Bash');
    expect(ok.stderr).not.toContain('Git Bash');
    // stdout 逐字节相同、退出码相同
    expect(warned.stdout).toBe(ok.stdout);
    expect(warned.exitCode).toBe(ok.exitCode);
    // 非 Windows → 无警告
    state.deps = { platform: 'darwin', env: {}, exists: () => false, runGit: () => '' };
    expect(runSync(root).stderr).not.toContain('Git Bash');
    // 非 Claude 宿主项目：不检查、不触碰 settings.json
    const { root: codex, cleanup: c2 } = makeTempRoot();
    try {
      await initProject(codex, 'codex');
      state.deps = missing as unknown as Record<string, unknown>;
      const r = runSync(codex);
      expect(r.stderr).not.toContain('Git Bash');
      expect(spawnSync('ls', [join(codex, '.claude', 'settings.json')]).status).not.toBe(0);
    } finally { c2(); }
  });

  itOnPlatform(IS_WIN, 'requires win32', 'ST-S08-45: windows-latest 真实 CLI 的前提警告（非 Windows 平台跳过）', async () => {
    await initProject(root, 'claude-code');
    const cli = (env: NodeJS.ProcessEnv) => {
      const r = spawnSync(process.execPath, [CLI_ENTRY, 'sync'], { cwd: root, env, encoding: 'utf-8', timeout: 120_000 });
      return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
    };
    cli(process.env); // 稳定一次
    // ① 隐去 Git Bash：PATH 只含 node 目录与 System32，ProgramFiles 指向空临时目录，不设 CLAUDE_CODE_GIT_BASH_PATH
    const emptyPf = mkdtempSync(join(tmpdir(), 'ol-pf-'));
    mkdirSync(join(emptyPf, 'Git'), { recursive: true });
    const hidden: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!/^(path|programfiles|claude_code_git_bash_path)$/i.test(k)) hidden[k] = v;
    }
    hidden.PATH = [dirname(process.execPath), join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')].join(delimiter);
    hidden.ProgramFiles = emptyPf;
    try {
      const a = cli(hidden);
      expect(a.stderr).toContain('winget install --id Git.Git -e');
      expect(a.status).toBe(0);
      // ② 保留 runner 预装的 Git for Windows
      const b = cli(process.env);
      expect(b.stderr).not.toContain('winget install --id Git.Git -e');
      expect(b.stdout).toBe(a.stdout);
      expect(b.status).toBe(a.status);
    } finally { rmSync(emptyPf, { recursive: true, force: true }); }
  });
});
