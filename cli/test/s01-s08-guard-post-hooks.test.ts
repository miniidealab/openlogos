/**
 * guard-versioned-content-scope [code] 切片 3：Claude 事后检查 hook 注册与引擎分发（S01 / S08）。
 *
 * 覆盖 UT-S01-145、UT-S08-75、UT-S08-76（与 logos/resources/test/core-S01-test-cases.md、core-S08-test-cases.md 对齐）。
 * init / sync 走真实命令入口（mockCwd + captureConsole），合并函数与 manifest 校验以函数层调用真实实现。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import {
  CLAUDE_GUARD_HOOK_COMMAND, CLAUDE_PHASE_HOOK_COMMAND, CLAUDE_POST_CHECK_COMMAND, CLAUDE_STOP_CHECK_COMMAND,
  deployClaudeCodePlugin, deployClaudeGuardAssets, findClaudePluginTemplateSource,
} from '../src/commands/init.js';
import { buildAssetManifest, validateAssetManifest } from '../src/lib/asset-manifest.js';
import { captureConsole, makeTempRoot, mockCwd } from './helpers.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENGINE_SRC = join(repoRoot, 'plugin', 'bin', 'guard-post-check.cjs');
const GUARD_SRC = join(repoRoot, 'plugin', 'bin', 'guard-check');
const POST_MATCHER = 'Bash|PowerShell|BashOutput|TaskOutput|KillShell|TaskStop';

let root: string;
let cleanup: () => void;
beforeEach(() => { ({ root, cleanup } = makeTempRoot()); });
afterEach(() => { cleanup(); });

type Group = { matcher?: string; hooks: Array<{ type?: string; command?: string }> };
function settings(base: string): { raw: string; hooks: Record<string, Group[]> } {
  const raw = readFileSync(join(base, '.claude', 'settings.json'), 'utf-8');
  return { raw, hooks: (JSON.parse(raw) as { hooks: Record<string, Group[]> }).hooks };
}

function managed(groups: Group[] | undefined): Group[] {
  return (groups ?? []).filter(g => g.hooks.some(h => (h.command ?? '').includes('.claude/openlogos/bin/guard-post-check.cjs')));
}

function expectManagedPostHooks(hooks: Record<string, Group[]>): void {
  const post = managed(hooks.PostToolUse);
  expect(post).toHaveLength(1);
  expect(post[0].matcher).toBe(POST_MATCHER);
  expect(post[0].hooks.map(h => h.command)).toEqual([CLAUDE_POST_CHECK_COMMAND]);
  const fail = managed(hooks.PostToolUseFailure);
  expect(fail).toHaveLength(1);
  expect(fail[0].matcher).toBe('Bash|PowerShell');
  expect(fail[0].hooks.map(h => h.command)).toEqual([CLAUDE_POST_CHECK_COMMAND]);
  const stop = managed(hooks.Stop);
  expect(stop).toHaveLength(1);
  expect('matcher' in stop[0]).toBe(false);
  expect(stop[0].hooks.map(h => h.command)).toEqual([CLAUDE_STOP_CHECK_COMMAND]);
  expect(CLAUDE_POST_CHECK_COMMAND).toBe('node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" check');
  expect(CLAUDE_STOP_CHECK_COMMAND).toBe('node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" check --stop');
  expect(hooks.SessionEnd).toBeUndefined();
}

async function initClaude(base: string): Promise<void> {
  const restore = mockCwd(base);
  const cap = captureConsole();
  try { await init('demo', { locale: 'zh', aiTool: 'claude-code' }); } finally { cap.restore(); restore(); }
}

function runSync(base: string): void {
  const restore = mockCwd(base);
  const cap = captureConsole();
  try { sync(); } finally { cap.restore(); restore(); }
}

const USER_POST = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-post' }] };
const USER_STOP = { hooks: [{ type: 'command', command: 'echo user-stop' }] };

/** 预置：用户自有 PostToolUse / Stop 条目在托管条目之前；托管条目 matcher 多出 / 缺少工具名。 */
function presetMismatch(base: string, extra: Record<string, Group[]> = {}): void {
  const s = JSON.parse(readFileSync(join(base, '.claude', 'settings.json'), 'utf-8')) as { hooks: Record<string, unknown[]> };
  s.hooks.PostToolUse = [USER_POST, { matcher: 'Bash', hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] }];
  s.hooks.PostToolUseFailure = [{ matcher: 'Bash|PowerShell|Edit', hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] }];
  s.hooks.Stop = [USER_STOP, { matcher: 'X', hooks: [{ type: 'command', command: CLAUDE_STOP_CHECK_COMMAND }] }];
  Object.assign(s.hooks, extra);
  writeFileSync(join(base, '.claude', 'settings.json'), JSON.stringify(s, null, 2));
}

describe('S01 guard 事后检查 hook 注册与引擎部署', () => {
  it('UT-S01-145: Claude 事后检查 hook 注册幂等', async () => {
    expect(findClaudePluginTemplateSource()).not.toBeNull();
    await initClaude(root);
    const engineDest = join(root, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs');
    expect(readFileSync(engineDest).equals(readFileSync(ENGINE_SRC)), '引擎与随包字节一致').toBe(true);
    const first = settings(root);
    expectManagedPostHooks(first.hooks);
    expect(first.hooks.PreToolUse.flatMap(g => g.hooks.map(h => h.command))).toEqual([CLAUDE_GUARD_HOOK_COMMAND]);
    expect(first.hooks.SessionStart.flatMap(g => g.hooks.map(h => h.command))).toEqual([CLAUDE_PHASE_HOOK_COMMAND]);
    // 预置用户自有条目 + matcher 不一致的托管条目 → 就地校正而非新增，用户条目字节与顺序不变
    presetMismatch(root);
    const preTool = JSON.stringify(settings(root).hooks.PreToolUse);
    const sessionStart = JSON.stringify(settings(root).hooks.SessionStart);
    deployClaudeCodePlugin(root, 'zh');
    const after = settings(root);
    expectManagedPostHooks(after.hooks);
    expect(after.hooks.PostToolUse).toHaveLength(2);
    expect(JSON.stringify(after.hooks.PostToolUse[0])).toBe(JSON.stringify(USER_POST));
    expect(after.hooks.Stop).toHaveLength(2);
    expect(JSON.stringify(after.hooks.Stop[0])).toBe(JSON.stringify(USER_STOP));
    expect(JSON.stringify(after.hooks.PreToolUse)).toBe(preTool);
    expect(JSON.stringify(after.hooks.SessionStart)).toBe(sessionStart);
    // 重复执行零变化
    deployClaudeCodePlugin(root, 'zh');
    expect(settings(root).raw).toBe(after.raw);
  });
});

describe('S08 sync 补齐事后检查 hook 与引擎', () => {
  it('UT-S08-75: Claude PostToolUse / PostToolUseFailure / Stop 注册幂等', async () => {
    await initClaude(root);
    // 0.15.17 形态：只有 PreToolUse + SessionStart
    const s = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8')) as { hooks: Record<string, unknown> };
    for (const k of ['PostToolUse', 'PostToolUseFailure', 'Stop']) delete s.hooks[k];
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(s, null, 2));
    rmSync(join(root, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs'));
    runSync(root);
    expectManagedPostHooks(settings(root).hooks);
    expect(existsSync(join(root, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs'))).toBe(true);
    // matcher 不一致就地校正；同一事件两条托管条目收敛为一条；用户条目字节与相对顺序不变
    presetMismatch(root, {
      PostToolUse: [USER_POST, { matcher: 'Bash', hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] },
        { matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node .claude/openlogos/bin/guard-post-check.cjs check' }] }],
    });
    runSync(root);
    const after = settings(root);
    expectManagedPostHooks(after.hooks);
    expect(after.hooks.PostToolUse.map(g => JSON.stringify(g))).toEqual([
      JSON.stringify(USER_POST),
      JSON.stringify({ matcher: POST_MATCHER, hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] }),
    ]);
    expect(JSON.stringify(after.hooks.Stop[0])).toBe(JSON.stringify(USER_STOP));
    // 第二次 sync 零变化
    runSync(root);
    expect(settings(root).raw).toBe(after.raw);
    // 非 Claude 宿主项目不触碰 settings.json
    const { root: codex, cleanup: c2 } = makeTempRoot();
    try {
      const restore = mockCwd(codex); const cap = captureConsole();
      try { await init('demo', { locale: 'zh', aiTool: 'codex' }); sync(); } finally { cap.restore(); restore(); }
      expect(existsSync(join(codex, '.claude', 'settings.json'))).toBe(false);
      expect(existsSync(join(codex, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs'))).toBe(false);
    } finally { c2(); }
  });

  it('UT-S08-76: 新 guard 与引擎随 manifest 分发', async () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, 'cli', 'asset-manifest.json'), 'utf-8')) as {
      plugins: Array<{ path: string; sha256: string }>; payloadHash: string;
    };
    const paths = manifest.plugins.map(p => p.path);
    for (const p of ['claude-plugin-template/bin/guard-post-check.cjs', 'claude-plugin-template/bin/guard-check',
      'claude-plugin-template/bin/openlogos-phase']) expect(paths, p).toContain(p);
    // 版本化哈希与随包字节一致
    validateAssetManifest(manifest as never, join(repoRoot, 'cli'));
    // 缺失 / 漂移 → sync 以随包字节重写；guard-check 同理
    await initClaude(root);
    const engineDest = join(root, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs');
    const guardDest = join(root, '.claude', 'openlogos', 'bin', 'guard-check');
    writeFileSync(engineDest, '// drift\n');
    writeFileSync(guardDest, '#!/bin/sh\nexit 0\n');
    runSync(root);
    expect(readFileSync(engineDest).equals(readFileSync(ENGINE_SRC))).toBe(true);
    expect(readFileSync(guardDest).equals(readFileSync(GUARD_SRC))).toBe(true);
    rmSync(engineDest);
    runSync(root);
    expect(readFileSync(engineDest).equals(readFileSync(ENGINE_SRC))).toBe(true);
    // managedAssetsHash 随引擎变化
    const tmpEngine = join(root, 'engine-variant.cjs');
    writeFileSync(tmpEngine, `${readFileSync(ENGINE_SRC, 'utf-8')}\n// variant\n`);
    const a = buildAssetManifest('0.0.0', '1.4.0', [{ group: 'plugins', path: 'claude-plugin-template/bin/guard-post-check.cjs', sourcePath: ENGINE_SRC }]);
    const b = buildAssetManifest('0.0.0', '1.4.0', [{ group: 'plugins', path: 'claude-plugin-template/bin/guard-post-check.cjs', sourcePath: tmpEngine }]);
    expect(a.payloadHash).not.toBe(b.payloadHash);
    // 随包缺少引擎：manifest 校验 fail loud 点名资产路径
    const pkg = join(root, 'pkg', 'cli');
    mkdirSync(pkg, { recursive: true });
    expect(() => validateAssetManifest(a, pkg)).toThrow(/claude-plugin-template\/bin\/guard-post-check\.cjs/);
    // 部署入口：随包缺少引擎时点名路径、不注册指向缺失文件的 hook
    const fakeSource = join(root, 'fake-plugin');
    mkdirSync(join(fakeSource, 'bin'), { recursive: true });
    copyFileSync(GUARD_SRC, join(fakeSource, 'bin', 'guard-check'));
    const { root: bare, cleanup: c3 } = makeTempRoot();
    const cap = captureConsole();
    const prevExit = process.exitCode;
    try {
      deployClaudeGuardAssets(bare, fakeSource);
      expect(cap.errors.join('\n')).toContain(join(fakeSource, 'bin', 'guard-post-check.cjs'));
      const hooks = settings(bare).hooks;
      expect(hooks.PostToolUse).toBeUndefined();
      expect(hooks.PostToolUseFailure).toBeUndefined();
      expect(hooks.Stop).toBeUndefined();
      expect(existsSync(join(bare, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs'))).toBe(false);
    } finally { cap.restore(); process.exitCode = prevExit; c3(); }
  });
});
