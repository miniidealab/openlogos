/**
 * guard-versioned-content-scope [code] 切片 6：sync 按配置重渲染 `.gitignore` 托管区块与存量升级补齐事后检查接线（S08）。
 *
 * 覆盖 UT-S08-73、UT-S08-74、ST-S08-40、ST-S08-41（与 logos/resources/test/core-S08-test-cases.md 对齐）。
 * UT 以真实 sync 入口进程内调用；ST-S08-40 驱动 cli/dist 真实 CLI；ST-S08-41 用隔离副本真实 `npm pack`（含 prepack）
 * 冻结候选 tarball，安装到一次性 prefix 后以安装态 CLI 入口执行。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { init, createAgentsMd, generatePolicyMdc, CLAUDE_POST_CHECK_COMMAND, CLAUDE_STOP_CHECK_COMMAND } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import { runScopeCommand } from '../src/commands/scope.js';
import { MANAGED_END, MANAGED_NOTE, MANAGED_RUNTIME_ENTRY, MANAGED_START } from '../src/lib/gitignore-managed-block.js';
import { CURSOR_ENGINE_REL_FILE, CURSOR_GUARD_STRENGTH_NOTICE_ZH, CURSOR_HOOK_EVENTS } from '../src/lib/cursor-adapter.js';
import { captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  CLI, REPO_ROOT, applyGitIsolation, gitCommitAll, gitInit, isIgnored, makeDir, managedEntries, runCli, testEnv,
} from './ignore-suggest-helpers.js';

let restoreGit: () => void;
beforeAll(() => { restoreGit = applyGitIsolation(); });
afterAll(() => { restoreGit(); });

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (cleanups.length) cleanups.pop()!();
});

function tmp(): string {
  const { root, cleanup } = makeDir('openlogos-gisync-');
  cleanups.push(cleanup);
  return root;
}

const block = (entries: string[], eol = '\n') => [MANAGED_START, MANAGED_NOTE, MANAGED_RUNTIME_ENTRY, ...entries, MANAGED_END].join(eol);
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const gi = (root: string) => readFileSync(join(root, '.gitignore'));
const configPath = (root: string) => join(root, 'logos', 'logos.config.json');

function setGuard(root: string, guard: unknown): void {
  const c = JSON.parse(readFileSync(configPath(root), 'utf-8')) as Record<string, unknown>;
  if (guard === undefined) delete c.guard;
  else c.guard = guard;
  writeFileSync(configPath(root), JSON.stringify(c, null, 2));
}

async function initProject(root: string, aiTool = 'claude-code'): Promise<void> {
  const prevTTY = process.stdin.isTTY;
  process.stdin.isTTY = undefined as unknown as boolean;
  const restore = mockCwd(root);
  const cap = captureConsole();
  try { await init('demo', { locale: 'zh', aiTool }); } finally { cap.restore(); restore(); process.stdin.isTTY = prevTTY; }
}

interface SyncOut { logs: string[]; errors: string[]; exit: string | null }
function runSync(root: string): SyncOut {
  const restore = mockCwd(root);
  const cap = captureConsole();
  const exitSpy = mockProcessExit();
  let exit: string | null = null;
  try {
    sync();
  } catch (e) {
    const m = /process\.exit\((\d+)\)/.exec((e as Error).message);
    if (!m) throw e;
    exit = m[1];
  } finally {
    cap.restore();
    restore();
    exitSpy.mockRestore();
  }
  return { logs: cap.logs, errors: cap.errors, exit };
}

describe('S08 sync 重渲染 .gitignore 托管区块', () => {
  it('UT-S08-73: 托管区块按配置重渲染且幂等', async () => {
    const root = tmp();
    await initProject(root);
    // ① 存量：.gitignore 无区块、配置无 guard.unversioned → 末尾追加仅含运行时条目的区块（前补空行）
    writeFileSync(join(root, '.gitignore'), 'user-rule/\n');
    setGuard(root, undefined);
    let out = runSync(root);
    expect(out.exit).toBeNull();
    expect(gi(root).toString('utf-8')).toBe(`user-rule/\n\n${block([])}\n`);
    expect(out.logs).toContain('  ✓ .gitignore OpenLogos 托管区块已更新');
    // ② 配置 guard.unversioned → 按配置顺序
    const guardCfg = { unversioned: ['dist/', '*.log'], exempt: ['docs/'] };
    setGuard(root, guardCfg);
    runSync(root);
    expect(gi(root).toString('utf-8')).toBe(`user-rule/\n\n${block(['dist/', '*.log'])}\n`);
    // ③ 区块内部被手工改动（删行、加行）→ 恢复
    writeFileSync(join(root, '.gitignore'), `user-rule/\n\n${MANAGED_START}\n${MANAGED_NOTE}\n*.log\nhand-added/\n${MANAGED_END}\n`);
    runSync(root);
    expect(gi(root).toString('utf-8')).toBe(`user-rule/\n\n${block(['dist/', '*.log'])}\n`);
    // ④ 区块外 CRLF + 用户规则 → 区块外字节不变、区块用 CRLF
    const crlf = Buffer.from('# 用户\r\nsecret.txt\r\n', 'utf-8');
    writeFileSync(join(root, '.gitignore'), crlf);
    runSync(root);
    const after4 = gi(root);
    expect(after4.subarray(0, crlf.length).equals(crlf)).toBe(true);
    expect(after4.subarray(crlf.length).toString('utf-8')).toBe(`\r\n${block(['dist/', '*.log'], '\r\n')}\r\n`);
    // ⑤ 无 .gitignore → 新建仅含区块的文件
    rmSync(join(root, '.gitignore'));
    runSync(root);
    expect(gi(root).toString('utf-8')).toBe(`${block(['dist/', '*.log'])}\n`);
    // ⑥ 配置未变时第二次 sync：字节与 mtime 不变
    const bytes = gi(root);
    const mtime = statSync(join(root, '.gitignore')).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    out = runSync(root);
    expect(gi(root).equals(bytes)).toBe(true);
    expect(statSync(join(root, '.gitignore')).mtimeMs).toBe(mtime);
    expect(out.logs).not.toContain('  ✓ .gitignore OpenLogos 托管区块已更新');
    // sync 不改写 guard.unversioned / guard.exempt
    expect((JSON.parse(readFileSync(configPath(root), 'utf-8')) as { guard: unknown }).guard).toEqual(guardCfg);
    // 区块内容与 openlogos ignore 渲染结果逐字节相同
    const twin = tmp();
    await initProject(twin);
    rmSync(join(twin, '.gitignore'));
    setGuard(twin, undefined);
    const r = runScopeCommand('ignore', ['add', 'dist/', '*.log'], twin, { exec: () => ({ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }) });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(gi(twin).equals(bytes)).toBe(true);
  });

  it('UT-S08-74: 区块损坏 fail loud 但不阻断其他同步', async () => {
    const cases: Array<{ name: string; gitignore: string; guard?: unknown; expectErr: RegExp }> = [
      { name: '两个起始标记', gitignore: `a/\n${MANAGED_START}\n${MANAGED_START}\n${MANAGED_END}\n`, expectErr: /\.gitignore 中的 openlogos 托管区块已损坏（发现 2 个起始标记.*），未改动 \.gitignore/ },
      { name: '只有起始标记', gitignore: `a/\n${MANAGED_START}\nx/\n`, expectErr: /\.gitignore 中的 openlogos 托管区块已损坏（只有起始标记没有结束标记.*），未改动 \.gitignore/ },
      { name: '非法条目', gitignore: 'a/\n', guard: { unversioned: ['dist/', '!keep'] }, expectErr: /guard\.unversioned 中有非法条目 "!keep"：不能以 # 或 ! 开头，未改动 \.gitignore/ },
    ];
    for (const c of cases) {
      const root = tmp();
      await initProject(root);
      if (c.guard !== undefined) setGuard(root, c.guard);
      writeFileSync(join(root, '.gitignore'), c.gitignore);
      const cfgBefore = readFileSync(configPath(root));
      // 让其余同步步骤都有事可做：指令文件、托管资产、hook 注册、.gitattributes、版本戳
      writeFileSync(join(root, 'AGENTS.md'), 'stale\n');
      writeFileSync(join(root, 'CLAUDE.md'), 'stale\n');
      writeFileSync(join(root, '.claude', 'openlogos', 'bin', 'guard-check'), '#!/bin/sh\nexit 0\n');
      const settingsPath = join(root, '.claude', 'settings.json');
      const s = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { hooks: Record<string, unknown> };
      delete s.hooks.PostToolUse;
      writeFileSync(settingsPath, JSON.stringify(s, null, 2));
      rmSync(join(root, '.gitattributes'), { force: true });
      rmSync(join(root, 'logos', '.openlogos-sync.json'), { force: true });

      const out = runSync(root);
      expect(out.exit, c.name).toBe('1');
      expect(gi(root).toString('utf-8'), c.name).toBe(c.gitignore);
      expect(out.errors.join('\n'), c.name).toMatch(c.expectErr);
      expect(out.errors.join('\n'), c.name).toContain('sync 部分完成：.gitignore 托管区块未更新。');
      expect(readFileSync(join(root, 'AGENTS.md'), 'utf-8')).toContain('<!-- OPENLOGOS:BEGIN -->');
      expect(readFileSync(join(root, 'CLAUDE.md'), 'utf-8')).toContain('<!-- OPENLOGOS:BEGIN -->');
      expect(sha(join(root, '.claude', 'openlogos', 'bin', 'guard-check'))).toBe(sha(join(REPO_ROOT, 'plugin', 'bin', 'guard-check')));
      const hooks = (JSON.parse(readFileSync(settingsPath, 'utf-8')) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }).hooks;
      expect(hooks.PostToolUse.flatMap(g => g.hooks.map(h => h.command))).toContain(CLAUDE_POST_CHECK_COMMAND);
      expect(existsSync(join(root, '.gitattributes'))).toBe(true);
      expect(existsSync(join(root, 'logos', '.openlogos-sync.json'))).toBe(true);
      // 「sync 部分完成」位于 Sync complete. 之前
      expect(out.logs.join('\n')).toContain('Sync complete.');
      // 非法条目：sync 不自行修正配置
      if (c.guard !== undefined) expect(JSON.parse(readFileSync(configPath(root), 'utf-8')).guard).toEqual(c.guard);
      else expect(readFileSync(configPath(root)).equals(cfgBefore)).toBe(true);
      // 修复后再次 sync：退出码 0 且区块写入
      if (c.guard !== undefined) setGuard(root, { unversioned: ['dist/'] });
      writeFileSync(join(root, '.gitignore'), 'a/\n');
      const fixed = runSync(root);
      expect(fixed.exit, c.name).toBeNull();
      expect(managedEntries(gi(root).toString('utf-8'))).toEqual(c.guard !== undefined ? [MANAGED_RUNTIME_ENTRY, 'dist/'] : [MANAGED_RUNTIME_ENTRY]);
    }
  });

  it('生成指令「唯一例外」不再列 .gitignore，追加保护范围配置行（功能规格 2.88.8a / spec/agents-md.md）', async () => {
    const zhLine = '`.gitignore`、`.git/info/exclude` 与 `logos/logos.config.json` 决定 guard 的保护范围，不得直接修改；需要忽略或豁免路径时，直接执行 `openlogos ignore add|remove …` 或 `openlogos exempt add|remove …`（`list` 不受限），由宿主对这次命令弹出原生审批、用户批准后执行；若 guard 提示当前权限模式下宿主不会弹出审批，请用户在终端用 `! <命令原文>` 自行执行，或切换到默认权限模式后重试，不得以对话中的口头同意替代审批。';
    const enLine = '`.gitignore`, `.git/info/exclude` and `logos/logos.config.json` define the guard\'s protection scope and must not be edited directly. To ignore or exempt a path, run `openlogos ignore add|remove …` or `openlogos exempt add|remove …` directly (`list` is unrestricted); the host will show its native approval prompt for that command and it runs only after the user approves. If the guard reports that the current permission mode will not show an approval prompt, ask the user to run `! <command>` in the terminal or switch to the default permission mode and retry; a verbal "yes" in the conversation never replaces the approval.';
    for (const target of ['agents', 'claude'] as const) {
      const zh = createAgentsMd('zh', 'claude-code', target, true);
      expect(zh).toContain('- **唯一例外**：纯 typo 修复（不改变语义）、`README.md` 等非方法论文件\n');
      expect(zh).toContain(`- **保护范围配置**：${zhLine}`);
      const en = createAgentsMd('en', 'claude-code', target, true);
      expect(en).toContain('- **Only exception**: pure typo fixes (no semantic change), `README.md` and other non-methodology files\n');
      expect(en).toContain(`- **Protection scope**: ${enLine}`);
      for (const text of [zh, en]) expect(text).not.toContain('`.gitignore`/`README.md`');
    }
    expect(generatePolicyMdc('zh', true)).toContain(`- 保护范围配置：${zhLine}`);
    expect(generatePolicyMdc('en', true)).toContain(`- Protection scope: ${enLine}`);
    for (const l of ['zh', 'en'] as const) expect(generatePolicyMdc(l, true)).not.toContain('`.gitignore`/`README.md`');
  });

  it('ST-S08-40: 真实 sync 重渲染托管区块', () => {
    const root = tmp();
    gitInit(root);
    const init = runCli(['init', 'demo', '--locale', 'zh', '--ai-tool', 'claude-code'], root);
    expect(init.status, init.stderr).toBe(0);
    // 存量形态：含用户规则、无托管区块；配置 guard.unversioned=["dist/"]
    const user = Buffer.from('# 用户规则\n*.log\n', 'utf-8');
    writeFileSync(join(root, '.gitignore'), user);
    setGuard(root, { unversioned: ['dist/'] });
    gitCommitAll(root);
    const r1 = runCli(['sync'], root);
    expect(r1.status, r1.stderr).toBe(0);
    expect(isIgnored(root, 'dist/x')).toBe(true);
    expect(isIgnored(root, 'logos/.openlogos-runtime/x')).toBe(true);
    expect(gi(root).subarray(0, user.length).equals(user)).toBe(true);
    const once = gi(root);
    const r2 = runCli(['sync'], root);
    expect(r2.status, r2.stderr).toBe(0);
    expect(gi(root).equals(once)).toBe(true);
    // 人为破坏区块后 sync：退出码 1、.gitignore 不变、其他托管资产仍为新版本
    const broken = `${once.toString('utf-8')}${MANAGED_START}\n`;
    writeFileSync(join(root, '.gitignore'), broken);
    const guardDest = join(root, '.claude', 'openlogos', 'bin', 'guard-check');
    writeFileSync(guardDest, '#!/bin/sh\nexit 0\n');
    const r3 = runCli(['sync'], root);
    expect(r3.status).toBe(1);
    expect(r3.stderr).toContain('.gitignore 中的 openlogos 托管区块已损坏');
    expect(r3.stderr).toContain('sync 部分完成：.gitignore 托管区块未更新。');
    expect(gi(root).toString('utf-8')).toBe(broken);
    expect(sha(guardDest)).toBe(sha(join(REPO_ROOT, 'plugin', 'bin', 'guard-check')));
  });

  it('ST-S08-41: 存量项目升级 sync 补齐事后检查接线', { timeout: 600_000 }, () => {
    const work = tmp();
    // ① 固定候选 tarball：隔离副本中真实 npm pack（prepack 生成随包模板与 asset manifest，不写工作区）
    const sourceRoot = join(work, 'candidate-source');
    const cliRoot = join(REPO_ROOT, 'cli');
    const isolatedCli = join(sourceRoot, 'cli');
    const generated = new Set(['node_modules', 'skills', 'spec', 'opencode-plugin-template', 'codex-plugin-template',
      'claude-plugin-template', 'zcode-plugin-template', 'qoder-plugin-template', 'workbuddy-plugin-template', 'cursor-plugin-template']);
    cpSync(cliRoot, isolatedCli, {
      recursive: true,
      filter: src => src === cliRoot || (!generated.has(src.slice(cliRoot.length + 1).split('/')[0]) && !src.endsWith('.tgz')),
    });
    for (const dir of ['skills', 'spec', 'plugin-opencode', 'plugin-codex', 'plugin', 'plugin-zcode', 'plugin-qoder', 'plugin-workbuddy', 'plugin-cursor']) {
      cpSync(join(REPO_ROOT, dir), join(sourceRoot, dir), { recursive: true });
    }
    symlinkSync(join(cliRoot, 'node_modules'), join(isolatedCli, 'node_modules'));
    const packed = spawnSync('npm', ['pack', isolatedCli, '--pack-destination', work, '--json'], { cwd: work, encoding: 'utf-8', env: testEnv(), timeout: 300_000 });
    expect(packed.status, packed.stderr).toBe(0);
    // prepack 会向 stdout 打印构建日志：JSON 数组从首个独占一行的 `[` 开始
    const jsonStart = packed.stdout.search(/^\[$/m);
    expect(jsonStart, packed.stdout.slice(0, 2000)).toBeGreaterThanOrEqual(0);
    const meta = JSON.parse(packed.stdout.slice(jsonStart)) as Array<{ filename: string }>;
    const tarball = join(work, meta[0].filename);
    const tarballSha = sha(tarball);
    const prefix = join(work, 'prefix');
    mkdirSync(prefix, { recursive: true });
    const install = spawnSync('npm', ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', tarball], {
      encoding: 'utf-8', env: testEnv(), timeout: 300_000,
    });
    expect(install.status, install.stderr).toBe(0);
    const pkgRoot = join(prefix, 'node_modules', '@miniidealab', 'openlogos');
    const entry = join(pkgRoot, 'dist', 'index.js');
    expect(existsSync(entry)).toBe(true);
    // 记录候选身份：tarball SHA-256 与 CLI 入口类别（安装态 prefix 入口，非仓库 dist）
    console.info(`ST-S08-41 candidate tarball sha256=${tarballSha} entry=installed-prefix(${entry !== CLI ? 'isolated' : 'repo'})`);
    expect(entry).not.toBe(CLI);
    const cand = (args: string[], cwd: string) => {
      const r = spawnSync(process.execPath, [entry, ...args], { cwd, encoding: 'utf-8', env: testEnv(), timeout: 120_000, input: '' });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };

    // ② 0.15.17 形态夹具（Claude + Cursor，含用户自有 hooks 条目）
    const proj = join(work, 'proj');
    mkdirSync(proj, { recursive: true });
    gitInit(proj);
    expect(cand(['init', 'demo', '--locale', 'zh', '--ai-tool', 'claude-code'], proj).status).toBe(0);
    expect(cand(['init', '--ai-tool', 'cursor'], proj).status).toBe(0);
    const settingsPath = join(proj, '.claude', 'settings.json');
    const hooksPath = join(proj, '.cursor', 'hooks.json');
    const claudeEngine = join(proj, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs');
    const cursorEngine = join(proj, CURSOR_ENGINE_REL_FILE);
    const guardCheck = join(proj, '.claude', 'openlogos', 'bin', 'guard-check');
    const userPost = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-post' }] };
    const userStop = { hooks: [{ type: 'command', command: 'echo user-stop' }] };
    const userCursor = { type: 'command', command: 'echo user-after-shell' };
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { hooks: Record<string, unknown[]> };
    delete settings.hooks.PostToolUseFailure;
    settings.hooks.PostToolUse = [userPost];
    settings.hooks.Stop = [userStop];
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    writeFileSync(hooksPath, `${JSON.stringify({
      version: 1,
      hooks: {
        sessionStart: [{ type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs session' }],
        beforeShellExecution: [{ type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs shell' }],
        afterFileEdit: [{ type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs edit' }],
        afterShellExecution: [userCursor],
      },
    }, null, 2)}\n`);
    rmSync(claudeEngine, { force: true });
    rmSync(cursorEngine, { force: true });
    const agentsPath = join(proj, 'AGENTS.md');
    const oldClaim = 'Cursor IDE 经同一 .cursor/hooks.json 获得完整 preToolUse 硬拦。';
    // 多宿主项目的 AGENTS.md 托管段不含 Cursor 专段：旧文案注入托管段内（0.15.17 形态），sync 重生成托管段后应消失
    writeFileSync(agentsPath, readFileSync(agentsPath, 'utf-8').replace('<!-- OPENLOGOS:BEGIN -->\n', `<!-- OPENLOGOS:BEGIN -->\n${oldClaim}\n`));
    expect(readFileSync(agentsPath, 'utf-8')).toContain(oldClaim);
    writeFileSync(join(proj, '.gitignore'), 'node_modules/\n');
    const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    const userHashes = [hash(userPost), hash(userStop), hash(userCursor)];

    // ③ 候选 CLI 执行 sync
    const s1 = cand(['sync'], proj);
    expect(s1.status, s1.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(pkgRoot, 'asset-manifest.json'), 'utf-8')) as { plugins: Array<{ path: string; sha256: string }> };
    const engineSha = manifest.plugins.find(p => p.path === 'claude-plugin-template/bin/guard-post-check.cjs')!.sha256;
    expect(sha(claudeEngine)).toBe(engineSha);
    expect(sha(cursorEngine)).toBe(engineSha);
    type Group = { matcher?: string; hooks: Array<{ command?: string }> };
    const after = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { hooks: Record<string, Group[]> };
    const cmds = (ev: string) => after.hooks[ev].flatMap(g => g.hooks.map(h => h.command));
    expect(cmds('PostToolUse')).toContain(CLAUDE_POST_CHECK_COMMAND);
    expect(cmds('PostToolUseFailure')).toContain(CLAUDE_POST_CHECK_COMMAND);
    expect(cmds('Stop')).toContain(CLAUDE_STOP_CHECK_COMMAND);
    const cursorHooks = JSON.parse(readFileSync(hooksPath, 'utf-8')) as { hooks: Record<string, Array<{ command: string }>> };
    for (const ev of CURSOR_HOOK_EVENTS) expect(cursorHooks.hooks[ev].some(h => h.command.includes('openlogos-runtime.cjs')), ev).toBe(true);
    const agents = readFileSync(agentsPath, 'utf-8');
    expect(agents).not.toContain(oldClaim);
    expect(`${s1.stdout}${s1.stderr}`).toContain(CURSOR_GUARD_STRENGTH_NOTICE_ZH);
    expect(CURSOR_GUARD_STRENGTH_NOTICE_ZH).toContain('afterShellExecution post-check');
    expect([hash(after.hooks.PostToolUse[0]), hash(after.hooks.Stop[0]), hash(cursorHooks.hooks.afterShellExecution[0])]).toEqual(userHashes);
    expect(managedEntries(readFileSync(join(proj, '.gitignore'), 'utf-8'))).toEqual([MANAGED_RUNTIME_ENTRY]);
    // ④ 再次 sync：两份配置、引擎与 guard-check 字节零变化
    const snap = [settingsPath, hooksPath, claudeEngine, cursorEngine, guardCheck].map(sha);
    const s2 = cand(['sync'], proj);
    expect(s2.status, s2.stderr).toBe(0);
    expect([settingsPath, hooksPath, claudeEngine, cursorEngine, guardCheck].map(sha)).toEqual(snap);
  });
});
