/**
 * fix-guard-check-bash-write-target-jurisdiction 单切片：
 * guard-check Bash 写命令路径提取与逐路径管辖判定（S09）——
 * 全外路径放行（0.14.23 误拦回归锚）/ 任一项目内非白名单拦截 / 解析不出保守臂 / 三运行时一致。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD_CHECK_SRC = join(repoRoot, 'plugin', 'bin', 'guard-check');

let root: string;
let cleanup: () => void;

beforeEach(() => { ({ root, cleanup } = makeTempRoot()); });
afterEach(() => { cleanup(); });

function runGuard(
  cwd: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  projectDir?: string | null,
  extraEnv?: Record<string, string>,
): { exitCode: number; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(extraEnv ?? {}) };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir) env.CLAUDE_PROJECT_DIR = projectDir;
  const result = spawnSync('bash', [GUARD_CHECK_SRC], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    cwd, encoding: 'utf-8', timeout: 5000, env,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function launchedProject(base: string): void {
  scaffoldProject(base, { locale: 'zh' });
  writeFileSync(join(base, 'logos', 'logos-project.yaml'),
    'project:\n  name: "g"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
  mkdirSync(join(base, 'src'), { recursive: true });
}

/** python3 stub：`-c` 透传（json_get 可用），路径归一化调用失败 → 强制 is_whitelisted_path 走 bash 兜底分支。 */
function bashFallbackPath(base: string): string {
  const realPython = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf-8' }).stdout.trim();
  const stubDir = join(base, 'stub-fallback');
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(join(stubDir, 'python3'),
    `#!/bin/sh\nif [ "$1" = "-c" ]; then exec ${realPython} "$@"; fi\nexit 1\n`, { mode: 0o755 });
  return `${stubDir}:${process.env.PATH ?? ''}`;
}

/** 仅含 guard-check 所需外部命令且**无 python3** 的 PATH → 强制走 node 归一化分支。 */
function nodeOnlyPath(base: string): string {
  const stubDir = join(base, 'stub-node-only');
  mkdirSync(stubDir, { recursive: true });
  for (const tool of ['bash', 'cat', 'grep', 'sed', 'head', 'node']) {
    const real = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf-8' }).stdout.trim();
    symlinkSync(real, join(stubDir, tool));
  }
  return stubDir;
}

describe('guard-check Bash 写命令路径提取与逐路径管辖判定 — S09', () => {
  it('UT-S09-317: Bash 写命令全外路径放行（回归锚：误拦必红→放行必绿）——rm/cp/mv/mkdir/touch 全外实参 exit 0、flag 跳过、重定向不回归', () => {
    launchedProject(root);
    const { root: outside, cleanup: outsideCleanup } = makeTempRoot();
    try {
      const scratch = join(outside, 'scratchpad', 'session-x');
      mkdirSync(scratch, { recursive: true });
      // 0.14.23 上以下命令一律被无条件误拦（exit 2）；修复后按管辖边界放行——本组断言即缺陷回归锚
      const externalCommands = [
        `rm -rf ${join(scratch, 'work')}`,
        `rm ${join(outside, 'a.txt')} ${join(outside, 'b.txt')}`,
        `cp ${join(outside, 'a.txt')} ${join(outside, 'copy.txt')}`,
        `cp -R ${join(outside, 'dir')} ${join(outside, 'dir2')}`,
        `mv ${join(outside, 'a.txt')} ${join(outside, 'moved.txt')}`,
        `mkdir -p ${join(outside, 'new', 'deep')}`,
        `touch ${join(outside, 'stamp.txt')}`,
        `rm -- ${join(outside, 'dashed.txt')}`,
        'rm ../outside-repo/src/x.ts',
      ];
      for (const command of externalCommands) {
        const result = runGuard(root, 'Bash', { command }, root);
        expect(result.exitCode, command).toBe(0);
        expect(result.stderr, `${command} stderr`).toBe('');
      }
      // 既有 >/>> 重定向目标提取不回归：项目外重定向放行
      expect(runGuard(root, 'Bash', { command: `node build.js > ${join(outside, 'out.log')}` }, root).exitCode).toBe(0);
    } finally { outsideCleanup(); }
  });

  // 三运行时 × 多命令矩阵，每例 spawnSync 驱动 bash 脚本——隔离运行 5.2~5.7s，
  // 全局 10s 阈值余量不足 2 倍；verify 沙箱（工作区复制到临时 prefix、IO 更慢）下必然超时。
  // 与 ST-S19-22 / ST-S37-01..03 同族（重进程用例显式给超时），不放宽任何断言。
  it('UT-S09-318: 任一路径在内拦截 + 解析不出保守臂 + 三运行时一致（安全面零放宽）', { timeout: 120_000 }, () => {
    launchedProject(root);
    const { root: outside, cleanup: outsideCleanup } = makeTempRoot();
    try {
      // ① 任一路径在项目内非白名单 → exit 2 双通道拦截（stdout JSON 结构不变 + stderr 指引）
      const blockedCommands = [
        `rm ${join(root, 'src', 'index.ts')}`,
        `cp ${join(outside, 'a.txt')} ${join(root, 'src', 'b.ts')}`,
        `mv ${join(root, 'src', 'a.ts')} ${join(outside, 'moved.ts')}`,
        `touch ${join(root, 'src', 'stamp.ts')} ${join(outside, 'ok.txt')}`,
      ];
      for (const command of blockedCommands) {
        const result = runGuard(root, 'Bash', { command }, root);
        expect(result.exitCode, command).toBe(2);
        const parsed = JSON.parse(result.stdout) as { reason: string };
        expect(Object.keys(parsed), command).toEqual(['reason']);
        expect(parsed.reason, command).toContain('变更管理拦截');
        expect(result.stderr, command).toContain('openlogos change');
      }
      // ② 白名单目标放行
      expect(runGuard(root, 'Bash', { command: `touch ${join(root, 'logos', 'changes', 'x', 'a.md')}` }, root).exitCode).toBe(0);
      // ③ 解析不出保守臂：变量展开/命令替换/反引号/管道/复合形态 → 维持无条件拦截（即使路径看似全外）
      const conservativeCommands = [
        'rm $SCRATCH_DIR/file.txt',
        `rm $(cat ${join(outside, 'list.txt')})`,
        'rm `cat list.txt`',
        `rm ${join(outside, 'a.txt')} && rm ${join(outside, 'b.txt')}`,
        `rm ${join(outside, 'a.txt')} | tee log.txt`,
        'rm -rf',
      ];
      for (const command of conservativeCommands) {
        expect(runGuard(root, 'Bash', { command }, root).exitCode, command).toBe(2);
      }
      // ④ BASH_SAFE_PATTERNS 优先级不变（含 git push）
      expect(runGuard(root, 'Bash', { command: 'git push origin master' }, root).exitCode).toBe(0);
      expect(runGuard(root, 'Bash', { command: 'git status' }, root).exitCode).toBe(0);
      // ⑤ 三运行时同判：python3 归一化（默认）/ node 归一化（PATH 无 python3）/ bash 兜底（归一化失败）
      const externalRm = `rm -rf ${join(outside, 'scratch', 'x')}`;
      const internalRm = `rm ${join(root, 'src', 'index.ts')}`;
      const whitelistTouch = `touch ${join(root, 'logos', 'changes', 'x', 'a.md')}`;
      const runtimes: Array<[string, Record<string, string> | undefined]> = [
        ['python3', undefined],
        ['node', { PATH: nodeOnlyPath(root) }],
        ['bash-fallback', { PATH: bashFallbackPath(root) }],
      ];
      for (const [label, env] of runtimes) {
        expect(runGuard(root, 'Bash', { command: externalRm }, root, env).exitCode, `${label} 全外放行`).toBe(0);
        expect(runGuard(root, 'Bash', { command: internalRm }, root, env).exitCode, `${label} 项目内拦截`).toBe(2);
        expect(runGuard(root, 'Bash', { command: whitelistTouch }, root, env).exitCode, `${label} 白名单放行`).toBe(0);
      }
    } finally { outsideCleanup(); }
  });

  it('ST-S09-122: 端到端——全外 rm/cp 放行且写入可落盘；项目内拦截语义一致；保守臂维持；创建提案后放行', () => {
    launchedProject(root);
    const { root: fakeHome, cleanup: homeCleanup } = makeTempRoot();
    try {
      // ① launched 无提案：临时 HOME 下 ~/.claude 形态路径与临时 scratchpad 目录的 rm/cp → exit 0，后续写入可落盘
      const memoryFile = join(fakeHome, '.claude', 'projects', 'demo', 'memory', 'note.md');
      const scratchDir = join(fakeHome, 'scratchpad', 'session-y');
      mkdirSync(dirname(memoryFile), { recursive: true });
      mkdirSync(scratchDir, { recursive: true });
      writeFileSync(memoryFile, '# memo\n');
      expect(runGuard(root, 'Bash', { command: `rm -rf ${join(scratchDir, 'stale')}` }, root).exitCode).toBe(0);
      expect(runGuard(root, 'Bash', { command: `cp ${memoryFile} ${join(scratchDir, 'note-copy.md')}` }, root).exitCode).toBe(0);
      spawnSync('bash', ['-c', `cp ${memoryFile} ${join(scratchDir, 'note-copy.md')}`], { encoding: 'utf-8' });
      expect(readFileSync(join(scratchDir, 'note-copy.md'), 'utf-8')).toBe('# memo\n');
      // ② 同一项目 rm 项目内源码 → exit 2、双通道语义一致
      const blocked = runGuard(root, 'Bash', { command: `rm ${join(root, 'src', 'app.ts')}` }, root);
      expect(blocked.exitCode).toBe(2);
      const parsed = JSON.parse(blocked.stdout) as { reason: string };
      expect(parsed.reason).toContain('变更管理拦截');
      expect(blocked.stderr).toContain('变更管理拦截');
      expect(blocked.stderr).toContain('openlogos change');
      // ③ 解析不出（$VAR 与 && 复合）→ exit 2
      expect(runGuard(root, 'Bash', { command: 'rm -rf $TMP_SCRATCH/x' }, root).exitCode).toBe(2);
      expect(runGuard(root, 'Bash', { command: `rm ${join(fakeHome, 'a')} && rm ${join(fakeHome, 'b')}` }, root).exitCode).toBe(2);
      // ④ 创建提案（guard 文件在场）后重放② → exit 0 放行
      writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'fix-z', module: 'core' }));
      expect(runGuard(root, 'Bash', { command: `rm ${join(root, 'src', 'app.ts')}` }, root).exitCode).toBe(0);
    } finally { homeCleanup(); }
  });
});
