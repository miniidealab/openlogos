/**
 * guard-versioned-content-scope [code] 切片 6 测试辅助：隔离 git 环境、真实 CLI 调用、伪 TTY 驱动与托管区块解析。
 *
 * 伪 TTY 用 python3 标准库 `pty`：子进程的 stdin / stdout 都是同一个伪终端，`process.stdin.isTTY` 为真；
 * 按「出现提示子串 → 写入回答 + 回车」的顺序应答，返回合并输出与真实退出码。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANAGED_END, MANAGED_START } from '../src/lib/gitignore-managed-block.js';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI = join(REPO_ROOT, 'cli', 'dist', 'index.js');

/** 隔离的 git 全局 / 系统配置（不读本机 core.excludesFile、XDG ignore），不改全局 git 配置。 */
const isolatedHome = mkdtempSync(join(tmpdir(), 'openlogos-gitenv-'));
const emptyGlobal = join(isolatedHome, 'gitconfig');
writeFileSync(emptyGlobal, '');
mkdirSync(join(isolatedHome, 'xdg'), { recursive: true });
process.on("exit", () => { try { rmSync(isolatedHome, { recursive: true, force: true }); } catch { /* 忽略 */ } });
export const GIT_ISOLATION: Record<string, string> = {
  GIT_CONFIG_GLOBAL: emptyGlobal,
  GIT_CONFIG_NOSYSTEM: '1',
  XDG_CONFIG_HOME: join(isolatedHome, 'xdg'),
};

export function testEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...GIT_ISOLATION, ...extra };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'CLAUDE_PROJECT_DIR']) delete env[k];
  // 真实 CLI 子进程不受 vitest 环境变量影响 Codex 个人插件同步
  env.OPENLOGOS_DISABLE_CODEX_PERSONAL_SYNC = '1';
  env.OPENLOGOS_SKIP_CODEX_PLUGIN_INSTALL = '1';
  return env;
}

/** 在当前进程内套用 git 隔离环境（in-process 调用 init / adopt / sync 时用），返回还原函数。 */
export function applyGitIsolation(): () => void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(GIT_ISOLATION)) { prev[k] = process.env[k]; process.env[k] = v; }
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

export function git(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', env: testEnv() });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 初始化临时 git 仓库（仅仓库级身份配置）。 */
export function gitInit(root: string): void {
  for (const args of [['init', '-q'], ['config', 'user.name', 'OpenLogos Test'], ['config', 'user.email', 'test@example.invalid'], ['config', 'commit.gpgsign', 'false']]) {
    const r = git(root, args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
}

export function gitCommitAll(root: string, message = 'fixture'): void {
  for (const args of [['add', '-A', '-f', '.'], ['commit', '-q', '-m', message]]) {
    const r = git(root, args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
}

export function isIgnored(root: string, rel: string): boolean {
  return git(root, ['check-ignore', '-q', '--', rel]).status === 0;
}

export function runCli(args: string[], cwd: string, input?: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf-8', env: testEnv(), timeout: 120_000, input: input ?? '',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const PTY_DRIVER = String.raw`
import json, os, pty, select, sys, time
argv = json.loads(sys.argv[1]); cwd = sys.argv[2]; answers = json.loads(sys.argv[3])
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvp(argv[0], argv)
out = b''; pos = 0; idx = 0; deadline = time.time() + 110
while time.time() < deadline:
    r, _, _ = select.select([fd], [], [], 0.2)
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        out += data
    while idx < len(answers):
        trig = answers[idx][0].encode('utf-8')
        at = out.find(trig, pos)
        if at < 0:
            break
        pos = at + len(trig)
        os.write(fd, answers[idx][1].encode('utf-8') + b'\r')
        idx += 1
_, status = os.waitpid(pid, 0)
sys.stdout.buffer.write(out)
sys.stdout.flush()
sys.exit(os.WEXITSTATUS(status) if os.WIFEXITED(status) else 99)
`;

/**
 * 伪 TTY 驱动真实 CLI。`answers` 为 [提示子串, 回答] 序列，按出现顺序应答；返回合并输出（终端换行为 \r\n）。
 */
export function runCliPty(args: string[], cwd: string, answers: Array<[string, string]>, entry: string = CLI): { status: number | null; output: string } {
  const r = spawnSync('python3', ['-c', PTY_DRIVER, JSON.stringify([process.execPath, entry, ...args]), cwd, JSON.stringify(answers)], {
    encoding: 'utf-8', env: testEnv(), timeout: 120_000,
  });
  return { status: r.status, output: (r.stdout ?? '').replace(/\r\n/g, '\n') };
}

/** 取托管区块各行（不含行尾）；无区块返回 null。 */
export function managedBlockLines(text: string): string[] | null {
  const lines = text.split(/\r?\n/);
  const s = lines.findIndex(l => l.trim() === MANAGED_START);
  const e = lines.findIndex(l => l.trim() === MANAGED_END);
  if (s < 0 || e < s) return null;
  return lines.slice(s, e + 1);
}

/** 区块条目行（去掉起止标记与说明注释）。 */
export function managedEntries(text: string): string[] | null {
  const lines = managedBlockLines(text);
  if (!lines) return null;
  return lines.slice(1, -1).filter(l => !l.startsWith('#'));
}

export function makeDir(prefix = 'openlogos-ignore-'): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
