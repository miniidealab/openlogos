/**
 * sync-claude-response-language [code] 单切片：按 locale 托管项目 `.claude/settings.json` 顶层 `language`（S08）。
 *
 * 覆盖 UT-S08-79～UT-S08-83、ST-S08-42、ST-S08-43（与 logos/resources/test/core-S08-test-cases.md 对齐）。
 * UT 以部署函数与真实 init / sync 入口进程内调用；ST 驱动 cli/dist 真实 CLI。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deployClaudeCodePlugin, init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import { captureConsole, mockCwd } from './helpers.js';
import { applyGitIsolation, makeDir, runCli } from './ignore-suggest-helpers.js';

let restoreGit: () => void;
beforeAll(() => { restoreGit = applyGitIsolation(); });
afterAll(() => { restoreGit(); });

const cleanups: Array<() => void> = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (cleanups.length) cleanups.pop()!();
});

function tmp(): string {
  const { root, cleanup } = makeDir('openlogos-claude-lang-');
  cleanups.push(cleanup);
  return root;
}

type Settings = Record<string, unknown> & { hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ command?: string }> }>> };
const settingsPath = (root: string) => join(root, '.claude', 'settings.json');
const readSettings = (root: string): Settings => JSON.parse(readFileSync(settingsPath(root), 'utf-8')) as Settings;
const writeSettings = (root: string, s: unknown) => writeFileSync(settingsPath(root), JSON.stringify(s, null, 2));
const withoutLanguage = (s: Settings) => { const { language: _ignored, ...rest } = s; return rest; };
const CUSTOM_HINT_ZH = '项目 .claude/settings.json 的 language 为自定义值';
const CUSTOM_HINT_EN = 'Project .claude/settings.json language is a custom value';
const USER_PRE = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-pre' }] };
const PERMISSIONS = { allow: ['Bash(npm test:*)'], deny: [] as string[] };

function deploy(root: string, locale: 'zh' | 'en'): string[] {
  const cap = captureConsole();
  try { deployClaudeCodePlugin(root, locale); } finally { cap.restore(); }
  return cap.logs;
}

async function initProject(root: string, locale: 'zh' | 'en' = 'zh', aiTool = 'claude-code'): Promise<void> {
  const prevTTY = process.stdin.isTTY;
  process.stdin.isTTY = undefined as unknown as boolean;
  const restore = mockCwd(root);
  const cap = captureConsole();
  try { await init('demo', { locale, aiTool }); } finally { cap.restore(); restore(); process.stdin.isTTY = prevTTY; }
}

function runSync(root: string): string[] {
  const restore = mockCwd(root);
  const cap = captureConsole();
  try { sync(); } finally { cap.restore(); restore(); }
  return cap.logs;
}

function setLocale(root: string, locale: 'zh' | 'en'): void {
  const p = join(root, 'logos', 'logos.config.json');
  const c = JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>;
  c.locale = locale;
  writeFileSync(p, JSON.stringify(c, null, 2));
}

const hintLines = (logs: string[], hint: string) => logs.filter(l => l.includes(hint));

describe('S08 sync 合并 Claude Code 项目回复语言设置', () => {
  it('UT-S08-79: 按 locale 写入与骨架创建', () => {
    // ① / ② 文件不存在：随骨架一起创建
    for (const [locale, value] of [['zh', 'chinese'], ['en', 'english']] as const) {
      const root = tmp();
      deploy(root, locale);
      const s = readSettings(root);
      expect(s.language).toBe(value);
      expect(s.hooks?.SessionStart?.length).toBeGreaterThan(0);
    }
    // ③ 存量合法 settings.json：含用户 PreToolUse 条目与 permissions，无 language
    const root = tmp();
    deploy(root, 'zh');
    const base = readSettings(root);
    delete base.language;
    base.hooks!.PreToolUse = [USER_PRE, ...base.hooks!.PreToolUse!];
    const preset = { permissions: PERMISSIONS, ...base };
    writeSettings(root, preset);
    deploy(root, 'zh');
    const after = readSettings(root);
    expect(after.language).toBe('chinese');
    expect(Object.keys(after).at(-1)).toBe('language');
    expect(withoutLanguage(after)).toEqual(preset);
    expect(Object.keys(withoutLanguage(after))).toEqual(Object.keys(preset));
    expect(after.hooks!.PreToolUse![0]).toEqual(USER_PRE);
  });

  it('UT-S08-80: 托管值按当前 locale 跟随', () => {
    for (const [preset, locale, expected] of [['chinese', 'en', 'english'], ['english', 'zh', 'chinese']] as const) {
      const root = tmp();
      deploy(root, 'zh');
      const s = readSettings(root);
      s.language = preset;
      writeSettings(root, s);
      deploy(root, locale);
      const after = readSettings(root);
      expect(after.language).toBe(expected);
      expect(withoutLanguage(after)).toEqual(withoutLanguage(s));
    }
    // ③ 已等于当前映射值：不写盘
    const root = tmp();
    deploy(root, 'zh');
    const before = readFileSync(settingsPath(root));
    const mtime = statSync(settingsPath(root)).mtimeMs;
    deploy(root, 'zh');
    expect(readFileSync(settingsPath(root)).equals(before)).toBe(true);
    expect(statSync(settingsPath(root)).mtimeMs).toBe(mtime);
  });

  it('UT-S08-81: 自定义值保留并提示', () => {
    for (const custom of ['japanese', 'Chinese', 123, null] as const) {
      for (const [locale, hint] of [['zh', CUSTOM_HINT_ZH], ['en', CUSTOM_HINT_EN]] as const) {
        const root = tmp();
        deploy(root, locale);
        const s = readSettings(root);
        s.language = custom;
        // 托管 PreToolUse 条目缺失：同一轮应被补齐
        delete s.hooks!.PreToolUse;
        writeSettings(root, s);
        const prevExit = process.exitCode;
        const logs = deploy(root, locale);
        expect(process.exitCode).toBe(prevExit);
        const after = readSettings(root);
        expect(after.language).toEqual(custom);
        const lines = hintLines(logs, hint);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(JSON.stringify(custom));
        expect(after.hooks!.PreToolUse!.some(g => g.hooks.some(h => (h.command ?? '').includes('guard-check')))).toBe(true);
      }
    }
  });

  it('UT-S08-82: 损坏 settings.json 原样保留', async () => {
    for (const broken of ['{ "hooks": ', '[1,2]']) {
      const root = tmp();
      await initProject(root);
      writeFileSync(settingsPath(root), broken);
      rmSync(join(root, 'CLAUDE.md'));
      rmSync(join(root, '.claude', 'openlogos', 'bin', 'guard-check'));
      expect(() => runSync(root)).not.toThrow();
      expect(readFileSync(settingsPath(root), 'utf-8')).toBe(broken);
      expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
      expect(existsSync(join(root, '.claude', 'openlogos', 'bin', 'guard-check'))).toBe(true);
    }
  });

  it('UT-S08-83: 恒部署路径、幂等与作用边界', async () => {
    const root = tmp();
    await initProject(root);
    // ① commands 幂等 skip 分支下仍写入 language
    expect(readdirMd(join(root, '.claude', 'commands', 'openlogos')).length).toBeGreaterThan(0);
    const s = readSettings(root);
    delete s.language;
    writeSettings(root, s);
    runSync(root);
    expect(readSettings(root).language).toBe('chinese');
    // ③ 第二次 sync 字节不变
    const before = readFileSync(settingsPath(root));
    runSync(root);
    expect(readFileSync(settingsPath(root)).equals(before)).toBe(true);
    // ④ settings.local.json 不读不写
    const localPath = join(root, '.claude', 'settings.local.json');
    writeFileSync(localPath, JSON.stringify({ language: 'japanese' }, null, 2));
    const localBefore = readFileSync(localPath);
    const s2 = readSettings(root);
    delete s2.language;
    writeSettings(root, s2);
    runSync(root);
    expect(readFileSync(localPath).equals(localBefore)).toBe(true);
    expect(readSettings(root).language).toBe('chinese');
    // ② skip 分支下自定义值提示照常输出
    const s3 = readSettings(root);
    s3.language = 'japanese';
    writeSettings(root, s3);
    const logs = runSync(root);
    expect(hintLines(logs, CUSTOM_HINT_ZH)).toHaveLength(1);
    expect(readSettings(root).language).toBe('japanese');
    // ⑤ 非 Claude 项目不触碰 settings.json
    const other = tmp();
    await initProject(other, 'zh', 'codex');
    runSync(other);
    expect(existsSync(settingsPath(other))).toBe(false);
  });

  it('ST-S08-42: zh 存量项目真实 sync 端到端', () => {
    const root = stockFixture();
    const preset = readSettings(root);
    const r1 = runCli(['sync'], root);
    expect(r1.status, r1.stderr).toBe(0);
    const after = readSettings(root);
    expect(after.language).toBe('chinese');
    expect(withoutLanguage(after)).toEqual(preset);
    expect(Object.keys(withoutLanguage(after))).toEqual(Object.keys(preset));
    expect(after.hooks!.PreToolUse![0]).toEqual(USER_PRE);
    const bytes = readFileSync(settingsPath(root));
    const r2 = runCli(['sync'], root);
    expect(r2.status, r2.stderr).toBe(0);
    expect(readFileSync(settingsPath(root)).equals(bytes)).toBe(true);
  });

  it('ST-S08-43: locale 切换后 sync 跟随与自定义值保留', () => {
    const root = stockFixture();
    expect(runCli(['sync'], root).status).toBe(0);
    expect(readSettings(root).language).toBe('chinese');
    setLocale(root, 'en');
    const r1 = runCli(['sync'], root);
    expect(r1.status, r1.stderr).toBe(0);
    expect(readSettings(root).language).toBe('english');
    const s = readSettings(root);
    s.language = 'japanese';
    writeSettings(root, s);
    const r2 = runCli(['sync'], root);
    expect(r2.status, r2.stderr).toBe(0);
    expect(readSettings(root).language).toBe('japanese');
    expect(r2.stdout.split('\n').filter(l => l.includes('custom value'))).toHaveLength(1);
  });
});

function readdirMd(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')) : [];
}

/** zh 存量夹具：真实 CLI init 后去掉 language，并加入用户自有 hook 条目与 permissions 顶层键。 */
function stockFixture(): string {
  const root = tmp();
  mkdirSync(root, { recursive: true });
  const r = runCli(['init', 'demo', '--locale', 'zh', '--ai-tool', 'claude-code'], root);
  expect(r.status, r.stderr).toBe(0);
  const s = readSettings(root);
  delete s.language;
  s.hooks!.PreToolUse = [USER_PRE, ...s.hooks!.PreToolUse!];
  writeSettings(root, { permissions: PERMISSIONS, ...s });
  return root;
}
