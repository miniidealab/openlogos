/**
 * Windows Git Bash 前提检查与警告（fix-claude-hook-windows-powershell-fallback，功能规格 §2.105.5，决策 C03 / C04）。
 *
 * Claude Code 在 Windows 上用 Git Bash 执行 hook，找不到时改用 PowerShell，并把 PreToolUse 失败当作阻断。
 * OpenLogos 的写入门禁是 bash 脚本，因此 init / adopt / sync 在 win32 上近似宿主的查找逻辑做一次检查：
 * 三项都未命中时只向 stderr 输出警告（含 winget 安装命令），不改变 stdout 与退出码。
 * 检查实现为纯函数：平台、环境变量、文件存在判断与 git 调用均由参数注入。
 */
import { execSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { win32 } from 'node:path';
import { type Locale, t } from '../i18n.js';

export interface GitBashProbeDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** 路径是否为存在的文件。 */
  exists: (path: string) => boolean;
  /** 运行 `git --exec-path` 并返回 stdout；git 不存在、失败或超时时抛错。 */
  runGit: () => string;
}

export interface GitBashProbeResult {
  /** 是否执行了检查（仅 win32）。 */
  checked: boolean;
  found: boolean;
  /** 命中的候选。 */
  via?: 'env' | 'git' | 'program-files';
  /** 已定位到 git 安装根、但其下没有 bin\bash.exe 时记下的安装根（典型为 MinGit）。 */
  gitRoot?: string;
}

/** git --exec-path 输出的已知后缀（反斜杠形态，不区分大小写）。 */
const EXEC_PATH_SUFFIX = /^(.*)\\(?:mingw64|mingw32|clangarm64)\\libexec\\git-core\\?$/i;

export const GIT_EXEC_PATH_TIMEOUT_MS = 5000;

export function probeGitBash(deps: GitBashProbeDeps): GitBashProbeResult {
  if (deps.platform !== 'win32') return { checked: false, found: false };

  // 1) CLAUDE_CODE_GIT_BASH_PATH：须指向存在的 bash.exe / sh.exe（误指 git.exe 等视为未命中）
  const configured = deps.env['CLAUDE_CODE_GIT_BASH_PATH'];
  if (configured && /^(?:bash|sh)\.exe$/i.test(win32.basename(configured)) && deps.exists(configured)) {
    return { checked: true, found: true, via: 'env' };
  }

  // 2) git --exec-path 反推安装根下的 bin\bash.exe
  let gitRoot: string | undefined;
  try {
    const out = deps.runGit().trim().replace(/\//g, '\\');
    const m = EXEC_PATH_SUFFIX.exec(out);
    if (m && m[1]) {
      const candidate = win32.join(m[1], 'bin', 'bash.exe');
      if (deps.exists(candidate)) return { checked: true, found: true, via: 'git' };
      gitRoot = m[1];
    }
  } catch {
    // git 不存在、调用失败或超时：本项未命中，继续
  }

  // 3) %ProgramFiles%\Git\bin\bash.exe
  const programFiles = deps.env['ProgramFiles'];
  if (programFiles && deps.exists(win32.join(programFiles, 'Git', 'bin', 'bash.exe'))) {
    return { checked: true, found: true, via: 'program-files' };
  }
  return gitRoot ? { checked: true, found: false, gitRoot } : { checked: true, found: false };
}

type ExecFn = (command: string, options: { encoding: 'utf-8'; timeout: number; windowsHide: boolean; stdio: ['ignore', 'pipe', 'ignore'] }) => string;

/** 以 shell 方式调用 `git --exec-path`（PATH 上的 git 可能是 `.cmd` 包装，见架构 52.5 第 4 条），5 秒超时。 */
export function makeRunGit(exec: ExecFn = execSync as unknown as ExecFn): () => string {
  return () => exec('git --exec-path', {
    encoding: 'utf-8', timeout: GIT_EXEC_PATH_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
  });
}

export function defaultGitBashDeps(): GitBashProbeDeps {
  return {
    platform: process.platform,
    env: process.env,
    exists: (path: string) => {
      try { return statSync(path).isFile(); } catch { return false; }
    },
    runGit: makeRunGit(),
  };
}

/** 未命中时的警告行；已命中或非 Windows 时为空。 */
export function gitBashWarningLines(locale: Locale, result: GitBashProbeResult): string[] {
  if (!result.checked || result.found) return [];
  const lines = [`⚠ ${t(locale, 'init.gitBashMissing')}`];
  if (result.gitRoot) lines.push(`  ${t(locale, 'init.gitBashMinGit', { root: result.gitRoot })}`);
  lines.push(`  ${t(locale, 'init.gitBashRemedy')}`);
  return lines;
}

/** init / adopt / sync 的 Claude Code 资产部署之后调用：警告只写 stderr，不改变 stdout 与退出码。 */
export function warnIfGitBashMissing(locale: Locale, deps: GitBashProbeDeps): void {
  for (const line of gitBashWarningLines(locale, probeGitBash(deps))) console.error(line);
}
