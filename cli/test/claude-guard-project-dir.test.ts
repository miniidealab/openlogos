/**
 * fix-claude-guard-hook-project-dir-and-sync-deploy 单切片：
 * ① init/adopt hook 注册 $CLAUDE_PROJECT_DIR 形态与新旧幂等迁移（S01）
 * ② sync 托管 guard 资产、存量项目补齐（S08）
 * ③ guard-check 工作目录收敛与 fail-closed（S09）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import {
  CLAUDE_GUARD_HOOK_COMMAND,
  CLAUDE_GUARD_HOOK_LEGACY_COMMAND,
  CLAUDE_PHASE_HOOK_COMMAND,
  CLAUDE_PHASE_HOOK_LEGACY_COMMAND,
  deployClaudeCodePlugin,
  findClaudePluginTemplateSource,
} from '../src/commands/init.js';
import { captureConsole, makeTempRoot, mockCwd, scaffoldProject } from './helpers.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD_CHECK_SRC = join(repoRoot, 'plugin', 'bin', 'guard-check');

let root: string;
let cleanup: () => void;
const restores: Array<() => void> = [];

beforeEach(() => { ({ root, cleanup } = makeTempRoot()); });
afterEach(() => { while (restores.length) restores.pop()!(); cleanup(); });

function settingsOf(base: string): { raw: string; json: Record<string, unknown> } {
  const raw = readFileSync(join(base, '.claude', 'settings.json'), 'utf-8');
  return { raw, json: JSON.parse(raw) };
}

function commandsOf(json: Record<string, unknown>, event: string): string[] {
  const groups = ((json['hooks'] as Record<string, unknown>)?.[event] ?? []) as Array<{ hooks?: Array<{ command?: string }> }>;
  return groups.flatMap(g => (g.hooks ?? []).map(h => h.command ?? ''));
}

function runGuard(
  cwd: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  projectDir?: string | null,
): { exitCode: number; stdout: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir) env.CLAUDE_PROJECT_DIR = projectDir;
  const result = spawnSync('bash', [GUARD_CHECK_SRC], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    cwd, encoding: 'utf-8', timeout: 5000, env,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? '' };
}

function launchedProject(base: string): void {
  scaffoldProject(base, { locale: 'zh' });
  writeFileSync(join(base, 'logos', 'logos-project.yaml'),
    'project:\n  name: "g"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
}

describe('Claude hook $CLAUDE_PROJECT_DIR 注册与迁移 — S01', () => {
  it('UT-S01-137: 注册形态——PreToolUse/SessionStart command 均为 $CLAUDE_PROJECT_DIR 新形态', () => {
    if (!findClaudePluginTemplateSource()) return;
    const result = deployClaudeCodePlugin(root, 'zh');
    expect(result).not.toBeNull();
    const { json } = settingsOf(root);
    expect(commandsOf(json, 'PreToolUse')).toEqual([CLAUDE_GUARD_HOOK_COMMAND]);
    expect(commandsOf(json, 'SessionStart')).toEqual([CLAUDE_PHASE_HOOK_COMMAND]);
    expect(CLAUDE_GUARD_HOOK_COMMAND).toContain('$CLAUDE_PROJECT_DIR');
    expect(CLAUDE_PHASE_HOOK_COMMAND).toContain('$CLAUDE_PROJECT_DIR');
  });

  it('UT-S01-138: 幂等迁移——旧相对条目就地升级、新旧并存收敛唯一、用户自有条目字节不变', () => {
    if (!findClaudePluginTemplateSource()) return;
    const userHook = { type: 'command', command: 'echo user-own-hook' };
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: CLAUDE_PHASE_HOOK_LEGACY_COMMAND }] }],
        PreToolUse: [
          { matcher: 'Edit|Write|Bash', hooks: [{ type: 'command', command: CLAUDE_GUARD_HOOK_LEGACY_COMMAND }] },
          // 历史异常态：新旧并存
          { matcher: 'Edit|Write|Bash', hooks: [{ type: 'command', command: CLAUDE_GUARD_HOOK_COMMAND }] },
          { matcher: 'Bash', hooks: [userHook] },
        ],
      },
    }, null, 2));
    deployClaudeCodePlugin(root, 'zh');
    const { json } = settingsOf(root);
    // 旧相对升级、新旧并存收敛为唯一新形态
    expect(commandsOf(json, 'PreToolUse').filter(c => c === CLAUDE_GUARD_HOOK_COMMAND).length).toBe(1);
    expect(commandsOf(json, 'PreToolUse')).not.toContain(CLAUDE_GUARD_HOOK_LEGACY_COMMAND);
    expect(commandsOf(json, 'SessionStart')).toEqual([CLAUDE_PHASE_HOOK_COMMAND]);
    // 用户自有条目保真
    expect(commandsOf(json, 'PreToolUse')).toContain('echo user-own-hook');
  });

  it('ST-S01-30: 真实 init 后两 hook 均新形态、guard-check 在盘；重复部署 settings 字节零变化', async () => {
    if (!findClaudePluginTemplateSource()) return;
    const restore = mockCwd(root); const cap = captureConsole();
    try { await init('demo', { locale: 'zh', aiTool: 'claude-code' }); } finally { cap.restore(); restore(); }
    const { json, raw } = settingsOf(root);
    expect(commandsOf(json, 'PreToolUse')).toEqual([CLAUDE_GUARD_HOOK_COMMAND]);
    expect(commandsOf(json, 'SessionStart')).toEqual([CLAUDE_PHASE_HOOK_COMMAND]);
    expect(existsSync(join(root, '.claude', 'openlogos', 'bin', 'guard-check'))).toBe(true);
    // 重复部署（sync 恒部署同一入口）：settings 字节零变化
    deployClaudeCodePlugin(root, 'zh');
    expect(settingsOf(root).raw).toBe(raw);
  });
});

describe('sync 托管 guard 资产 — S08', () => {
  it('UT-S08-59: asset-manifest 登记 guard-check；缺失/漂移落盘刷新；非 Claude 宿主不部署', async () => {
    if (!findClaudePluginTemplateSource()) return;
    // manifest 登记（版本化哈希）
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'cli', 'asset-manifest.json'), 'utf-8'));
    const entry = (manifest.plugins as Array<{ path: string; sha256: string }>).find(a => a.path === 'claude-plugin-template/bin/guard-check');
    expect(entry).toBeDefined();
    expect(entry!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // 缺失/漂移 → sync 刷新为随包字节
    const restore = mockCwd(root); const cap = captureConsole();
    try {
      await init('demo', { locale: 'zh', aiTool: 'claude-code' });
      const dest = join(root, '.claude', 'openlogos', 'bin', 'guard-check');
      writeFileSync(dest, '#!/bin/sh\nexit 0\n'); // 漂移
      sync();
      expect(readFileSync(dest, 'utf-8')).toBe(readFileSync(GUARD_CHECK_SRC, 'utf-8'));
      rmSync(dest); // 缺失
      sync();
      expect(readFileSync(dest, 'utf-8')).toBe(readFileSync(GUARD_CHECK_SRC, 'utf-8'));
    } finally { cap.restore(); restore(); }
    // 非 Claude 宿主：codex 项目 sync 不产 .claude guard
    const { root: codexRoot, cleanup: codexCleanup } = makeTempRoot();
    const restore2 = mockCwd(codexRoot); const cap2 = captureConsole();
    try {
      await init('demo', { locale: 'zh', aiTool: 'codex' });
      sync();
      expect(existsSync(join(codexRoot, '.claude', 'openlogos', 'bin', 'guard-check'))).toBe(false);
    } finally { cap2.restore(); restore2(); codexCleanup(); }
  });

  it('UT-S08-60: 存量项目补齐——无 guard-check、仅旧 SessionStart 的项目 sync 后齐备且迁移；重复 sync 零变化', async () => {
    if (!findClaudePluginTemplateSource()) return;
    const restore = mockCwd(root); const cap = captureConsole();
    try {
      await init('demo', { locale: 'zh', aiTool: 'claude-code' });
      // 构造存量态：删 guard-check、settings 只剩旧相对 SessionStart（guard 功能上线前 init 的典型形态）
      rmSync(join(root, '.claude', 'openlogos', 'bin', 'guard-check'));
      writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: CLAUDE_PHASE_HOOK_LEGACY_COMMAND }] }] },
      }, null, 2));
      sync();
      expect(existsSync(join(root, '.claude', 'openlogos', 'bin', 'guard-check'))).toBe(true);
      const { json, raw } = settingsOf(root);
      expect(commandsOf(json, 'PreToolUse')).toEqual([CLAUDE_GUARD_HOOK_COMMAND]);
      expect(commandsOf(json, 'SessionStart')).toEqual([CLAUDE_PHASE_HOOK_COMMAND]);
      sync();
      expect(settingsOf(root).raw).toBe(raw);
    } finally { cap.restore(); restore(); }
  });

  it('ST-S08-37: 真实 CLI sync 端到端——补齐后 bin 与随包同字节、用户自有 hooks 保真、二跑幂等', async () => {
    if (!findClaudePluginTemplateSource()) return;
    const restore = mockCwd(root); const cap = captureConsole();
    try {
      await init('demo', { locale: 'zh', aiTool: 'claude-code' });
      rmSync(join(root, '.claude', 'openlogos', 'bin', 'guard-check'));
      writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: CLAUDE_PHASE_HOOK_LEGACY_COMMAND }] }],
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo my-hook' }] }],
        },
      }, null, 2));
      sync();
      const dest = join(root, '.claude', 'openlogos', 'bin', 'guard-check');
      expect(readFileSync(dest, 'utf-8')).toBe(readFileSync(GUARD_CHECK_SRC, 'utf-8'));
      const { json, raw } = settingsOf(root);
      expect(commandsOf(json, 'PreToolUse')).toContain(CLAUDE_GUARD_HOOK_COMMAND);
      expect(commandsOf(json, 'PreToolUse')).toContain('echo my-hook');
      expect(commandsOf(json, 'SessionStart')).toEqual([CLAUDE_PHASE_HOOK_COMMAND]);
      sync();
      expect(settingsOf(root).raw).toBe(raw);
    } finally { cap.restore(); restore(); }
  });
});

describe('guard-check 工作目录收敛与 fail-closed — S09', () => {
  it('UT-S09-313: fail-closed 边界矩阵——变量坏目录/缺失非根 exit 2；缺失但 cwd 为根回退；确认根无 config 放行', () => {
    launchedProject(root);
    // 变量指向不可进入目录 → exit 2 + 可读 reason
    const badDir = runGuard(root, 'Edit', { file_path: join(root, 'src', 'a.ts') }, join(root, 'no-such-dir'));
    expect(badDir.exitCode).toBe(2);
    expect(badDir.stdout).toContain('CLAUDE_PROJECT_DIR');
    // 变量缺失 + cwd 为项目子目录 → exit 2（0.14.20 在此静默放行——fail-open 消除）
    mkdirSync(join(root, 'src'), { recursive: true });
    const subdir = runGuard(join(root, 'src'), 'Edit', { file_path: join(root, 'src', 'a.ts') }, null);
    expect(subdir.exitCode).toBe(2);
    expect(subdir.stdout).toContain('fail-closed');
    // 变量缺失 + cwd 为项目根 → 兼容回退（launched 无提案 → 既有阻断语义）
    const rootCwd = runGuard(root, 'Edit', { file_path: join(root, 'src', 'a.ts') }, null);
    expect(rootCwd.exitCode).toBe(2);
    expect(rootCwd.stdout).not.toContain('fail-closed（'); // 阻断来自 guard 判定，非收敛失败
    // 变量指向确认根但无 logos.config.json → 真非 OpenLogos 项目放行
    const { root: plain, cleanup: plainCleanup } = makeTempRoot();
    try {
      const notProject = runGuard(plain, 'Edit', { file_path: join(plain, 'x.ts') }, plain);
      expect(notProject.exitCode).toBe(0);
    } finally { plainCleanup(); }
  });

  it('UT-S09-314: 子目录 cwd + 变量在场——阻断/放行/白名单/绝对路径归一化与项目根 cwd 逐项一致', () => {
    launchedProject(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    const sub = join(root, 'src');
    const cases: Array<[string, Record<string, unknown>]> = [
      ['Edit', { file_path: join(root, 'src', 'index.ts') }],            // 无提案源码 → 阻断
      ['Bash', { command: 'git push origin master' }],                    // 安全白名单 → 放行
      ['Edit', { file_path: join(root, 'logos', 'changes', 'x', 'proposal.md') }], // 白名单目录 → 放行
      ['Bash', { command: 'sed -i "" s/a/b/ src/index.ts' }],             // 无提案写命令 → 阻断
    ];
    for (const [tool, input] of cases) {
      const fromSub = runGuard(sub, tool, input, root);
      const fromRoot = runGuard(root, tool, input, root);
      expect(fromSub.exitCode, `${tool} ${JSON.stringify(input)}`).toBe(fromRoot.exitCode);
    }
    // 有提案（guard 文件在场）→ 子目录 cwd 放行
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
    expect(runGuard(sub, 'Edit', { file_path: join(root, 'src', 'index.ts') }, root).exitCode).toBe(0);
  });

  it('ST-S09-120: 子目录 cwd 端到端——无提案 Edit 阻断且 reason 含指引；创建提案后同一调用放行', () => {
    launchedProject(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    const sub = join(root, 'src');
    const blocked = runGuard(sub, 'Edit', { file_path: join(root, 'src', 'app.ts') }, root);
    expect(blocked.exitCode).toBe(2);
    expect(blocked.stdout).toContain('reason');
    expect(blocked.stdout).toContain('openlogos change');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'fix-x', module: 'core' }));
    const allowed = runGuard(sub, 'Edit', { file_path: join(root, 'src', 'app.ts') }, root);
    expect(allowed.exitCode).toBe(0);
  });
});
