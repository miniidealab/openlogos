/**
 * fix-claude-hook-windows-powershell-fallback 切片 1：PowerShell 宿主与 bash 宿主下的 Claude hook 行为（S09）。
 *
 * 覆盖 ST-S09-218、ST-S09-219（与 logos/resources/test/core-S09-test-cases.md 对齐；规则见功能规格 §2.105.1～§2.105.3）。
 * 证据范围：CI 无法运行 Claude Code 本体。两条 ST 都取 sync 实际生成的 settings.json 中的命令：
 * - ST-S09-218 在真实 bash 中执行（PATH 去掉 node），验证门禁入口不依赖 node；
 * - ST-S09-219 属 Windows 回归集（package.json `test:windows`），在 windows-latest 以真实
 *   `powershell.exe -NoProfile -Command` 执行；执行前**模拟** Claude Code 的占位符处理，两种机制各一轮：
 *   (a) 把 `${CLAUDE_PROJECT_DIR}` 替换为项目根绝对路径；(b) 改写为 `$env:CLAUDE_PROJECT_DIR`。
 *   非 Windows 平台跳过（reporter 记 skip：平台能力限制，用例名注明）。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { itOnPlatform } from './platform-skip.js';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import { captureConsole, makeTempRoot, mockCwd } from './helpers.js';

const IS_WIN = process.platform === 'win32';

type Hooks = Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;

let root: string;
let cleanup: () => void;
beforeEach(() => { ({ root, cleanup } = makeTempRoot()); });
afterEach(() => { cleanup(); });

const OLD_POST = 'node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" check';

/**
 * launched Claude 宿主项目，hook 注册与托管 bin 由真实 sync 生成（code-r1 F4）：
 * init 显式选择 claude-code；随后把 settings.json 改成只有 0.16.22 旧注册（无 PreToolUse），并删除托管 bin，
 * 再执行真实 sync()，断言 sync 生成了现行注册与脚本——被测命令一律取自这次 sync 的产物。
 */
async function launchedClaudeProject(base: string): Promise<Hooks> {
  let restore = mockCwd(base);
  let cap = captureConsole();
  try { await init('g', { locale: 'zh', aiTool: 'claude-code' }); } finally { cap.restore(); restore(); }
  const yaml = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(yaml, readFileSync(yaml, 'utf-8').replace(/lifecycle: initial/g, 'lifecycle: launched'));
  const settings = join(base, '.claude', 'settings.json');
  writeFileSync(settings, JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: '"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/openlogos-phase' }] }],
    PostToolUse: [{ matcher: 'Bash|PowerShell|BashOutput|TaskOutput|KillShell|TaskStop', hooks: [{ type: 'command', command: OLD_POST }] }],
    PostToolUseFailure: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: OLD_POST }] }],
    Stop: [{ hooks: [{ type: 'command', command: `${OLD_POST} --stop` }] }],
  } }, null, 2));
  rmSync(join(base, '.claude', 'openlogos', 'bin'), { recursive: true, force: true });
  restore = mockCwd(base);
  cap = captureConsole();
  try { sync(); } finally { cap.restore(); restore(); }
  const hooks = (JSON.parse(readFileSync(settings, 'utf-8')) as { hooks: Hooks }).hooks;
  // sync 生成现行注册与托管脚本
  for (const f of ['guard-check', 'openlogos-phase', 'guard-post-check.cjs']) {
    expect(existsSync(join(base, '.claude', 'openlogos', 'bin', f)), `sync 部署 ${f}`).toBe(true);
  }
  expect(hooks.PreToolUse.flatMap(g => g.hooks.map(h => h.command))).toEqual(['"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check']);
  for (const e of ['PostToolUse', 'PostToolUseFailure', 'Stop']) {
    expect(hooks[e].flatMap(g => g.hooks.map(h => h.command)).every(c => c.includes('${CLAUDE_PROJECT_DIR}')), `${e} 已迁移为现行形态`).toBe(true);
  }
  return hooks;
}

const registered = (hooks: Hooks, event: string): string => hooks[event][hooks[event].length - 1].hooks[0].command;

describe('S09 PowerShell 宿主下的 Claude hook 行为', () => {
  itOnPlatform(!IS_WIN, 'requires a non-Windows bash host', 'ST-S09-218: bash 宿主上门禁入口不依赖 node', async () => {
    const hooks = await launchedClaudeProject(root);
    const preToolUse = hooks.PreToolUse.find(g => g.matcher === 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell')!.hooks[0].command;
    expect(preToolUse).toBe('"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check');
    mkdirSync(join(root, 'src'), { recursive: true });

    // PATH：只含 bash 与系统工具目录，不含 node；一份带真实 python3，一份 python 必失败
    const realPython = spawnSync('bash', ['-c', 'command -v python3'], { encoding: 'utf-8' }).stdout.trim();
    const withPy = join(root, 'bin-py');
    mkdirSync(withPy, { recursive: true });
    if (realPython) symlinkSync(realPython, join(withPy, 'python3'));
    const noPy = join(root, 'bin-nopy');
    mkdirSync(noPy, { recursive: true });
    for (const n of ['python3', 'python']) writeFileSync(join(noPy, n), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const sysPath = '/usr/bin:/bin';

    const run = (pathPrefix: string) => {
      const env: NodeJS.ProcessEnv = { PATH: `${pathPrefix}:${sysPath}`, HOME: root, CLAUDE_PROJECT_DIR: root, LANG: 'C.UTF-8' };
      expect(spawnSync('/bin/bash', ['-c', 'command -v node || true'], { env, encoding: 'utf-8' }).stdout.trim(), 'PATH 中没有 node').toBe('');
      const r = spawnSync('/bin/bash', ['-c', preToolUse], {
        cwd: root, env, encoding: 'utf-8', timeout: 20_000,
        input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(root, 'src', 'a.ts') } }),
      });
      return { exit: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };

    // ① 有 Python、无活跃提案 → exit 2，stdout JSON 与 stderr 均含既有阻断 reason
    expect(realPython, '本机需有 python3 以覆盖 Python 回退').not.toBe('');
    const blocked = run(withPy);
    expect(blocked.exit).toBe(2);
    expect((JSON.parse(blocked.stdout) as { reason: string }).reason).toContain('openlogos change');
    expect(blocked.stderr).toContain('openlogos change');
    // ② 创建活跃提案 → exit 0
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'fix-x', module: 'core' }));
    expect(run(withPy).exit).toBe(0);
    // ③ node 与 Python 都没有 → fail-closed（exit 2，指出无法解析 hook 输入）
    const failClosed = run(noPy);
    expect(failClosed.exit).toBe(2);
    expect(failClosed.stderr).toMatch(/无法解析|cannot parse/i);
    for (const r of [blocked, failClosed]) expect(r.stderr).not.toMatch(/node: (command )?not found/);
  });

  itOnPlatform(IS_WIN, 'requires win32', 'ST-S09-219: windows-latest：PowerShell 执行 sync 生成的命令（非 Windows 平台跳过）', async () => {
    const hooks = await launchedClaudeProject(root);
    const ps = (command: string, input: unknown) => {
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
        cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf-8', timeout: 60_000,
        input: JSON.stringify(input),
      });
      return { exit: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    };
    const engine = join(root, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs');
    const direct = (args: string[], input: unknown) => spawnSync(process.execPath, [engine, ...args], {
      cwd: root, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf-8', timeout: 60_000, input: JSON.stringify(input),
    }).status ?? -1;
    const input = (event: string) => ({
      hook_event_name: event, session_id: 's-1', tool_use_id: 't-1', cwd: root,
      tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_response: { stdout: 'hi' },
    });
    const mechanisms: Array<[string, (c: string) => string]> = [
      ['(a) 替换为绝对路径', c => c.split('${CLAUDE_PROJECT_DIR}').join(root)],
      ['(b) 改写为 $env:CLAUDE_PROJECT_DIR', c => c.split('${CLAUDE_PROJECT_DIR}').join('$env:CLAUDE_PROJECT_DIR')],
    ];
    for (const [label, substitute] of mechanisms) {
      for (const [event, args] of [['PostToolUse', ['check']], ['PostToolUseFailure', ['check']], ['Stop', ['check', '--stop']]] as const) {
        const r = ps(substitute(registered(hooks, event)), input(event));
        expect(r.out, `${label} ${event}`).not.toContain('MODULE_NOT_FOUND');
        expect(r.exit, `${label} ${event} 与直接调用引擎一致`).toBe(direct([...args], input(event)));
      }
      const pre = hooks.PreToolUse.find(g => g.matcher === 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell')!.hooks[0].command;
      const r = ps(substitute(pre), { tool_name: 'Edit', tool_input: { file_path: join(root, 'src', 'a.ts') } });
      expect(r.exit, `${label} PreToolUse 在 PowerShell 下不得以 0 退出`).not.toBe(0);
    }
    // 必红对照：0.16.22 的 "$CLAUDE_PROJECT_DIR" 形态在 PowerShell 下定位不到引擎
    const control = ps('node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" check --stop', input('Stop'));
    expect(control.out).toContain('MODULE_NOT_FOUND');
    expect(existsSync(engine)).toBe(true);
  });
});
