/**
 * guard-versioned-content-scope [code] 切片 6：init / adopt 技术栈建议忽略与 `.gitignore` 托管区块（S01 / S20）。
 *
 * 覆盖 UT-S01-139～144、ST-S01-31～33、UT-S20-49～51、ST-S20-26
 * （与 logos/resources/test/core-S01-test-cases.md、core-S20-test-cases.md 对齐）。
 * UT 以真实命令入口在进程内调用（mockCwd + readline 应答注入 + stdin.isTTY 切换）；ST 驱动 cli/dist 真实 CLI，
 * 交互用例经 python3 pty 伪终端应答。结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { init } from '../src/commands/init.js';
import { adopt } from '../src/commands/adopt.js';
import {
  computeSuggestions, detectStackCandidates, formatIgnoreAddCommand, isAcceptAnswer, planIgnoreSuggestions,
} from '../src/lib/ignore-suggest.js';
import { defaultScopeIo, type ScopeExecResult } from '../src/commands/scope.js';
import { MANAGED_END, MANAGED_NOTE, MANAGED_RUNTIME_ENTRY, MANAGED_START } from '../src/lib/gitignore-managed-block.js';
import { CLAUDE_POST_CHECK_COMMAND, CLAUDE_STOP_CHECK_COMMAND } from '../src/commands/init.js';
import { CURSOR_ENGINE_REL_FILE, CURSOR_HOOK_EVENTS } from '../src/lib/cursor-adapter.js';
import { captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  CLI, REPO_ROOT, applyGitIsolation, git, gitCommitAll, gitInit, isIgnored, makeDir, managedBlockLines, managedEntries,
  runCli, runCliPty, testEnv,
} from './ignore-suggest-helpers.js';

/* ---------- readline 应答注入（记录提示文本） ---------- */
let answers: string[] = [];
const prompts: string[] = [];
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((prompt: string, cb: (answer: string) => void) => {
      prompts.push(prompt);
      cb(answers.shift() ?? '');
    }),
    close: vi.fn(),
  })),
}));

const ASK_ZH = '是否加入 .gitignore（openlogos 托管区块）？[Y/n]：';
const ASK_EN = 'Add them to .gitignore (openlogos managed block)? [Y/n]: ';
const NODE = ['node_modules/', 'dist/', 'build/', 'coverage/'];
const PY = ['__pycache__/', '.venv/', '*.pyc'];

let restoreGit: () => void;
beforeAll(() => { restoreGit = applyGitIsolation(); });
afterAll(() => { restoreGit(); });

const cleanups: Array<() => void> = [];
let originalIsTTY: boolean | undefined;
beforeEach(() => {
  answers = [];
  prompts.length = 0;
  originalIsTTY = process.stdin.isTTY;
});
afterEach(() => {
  process.stdin.isTTY = originalIsTTY as boolean;
  vi.restoreAllMocks();
  while (cleanups.length) cleanups.pop()!();
});

function tmp(): string {
  const { root, cleanup } = makeDir();
  cleanups.push(cleanup);
  return root;
}

function setTTY(on: boolean): void {
  process.stdin.isTTY = (on ? true : undefined) as unknown as boolean;
}

interface RunOut { logs: string[]; errors: string[]; exited: string | null }

/** 在 root 下进程内执行命令入口；捕获输出与 process.exit。 */
async function inProcess(root: string, fn: () => Promise<void>): Promise<RunOut> {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  mockProcessExit();
  let exited: string | null = null;
  try {
    await fn();
  } catch (e) {
    const m = /process\.exit\((\d+)\)/.exec((e as Error).message);
    if (!m) throw e;
    exited = m[1];
  } finally {
    cap.restore();
    restoreCwd();
  }
  return { logs: cap.logs, errors: cap.errors, exited };
}

const readConfig = (root: string) => JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8')) as Record<string, unknown> & { guard?: { unversioned?: string[] } };
const gi = (root: string) => readFileSync(join(root, '.gitignore'));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

function expectedBlock(entries: string[], eol = '\n'): string {
  return [MANAGED_START, MANAGED_NOTE, MANAGED_RUNTIME_ENTRY, ...entries, MANAGED_END].join(eol);
}

/* ═════════════════════════════ S01 init ═════════════════════════════ */

describe('S01 技术栈建议忽略（init）', () => {
  it('UT-S01-139: 技术栈探测与候选合并', async () => {
    const cases: Array<[string[], string[]]> = [
      [['package.json'], NODE],
      [['requirements.txt'], PY],
      [['pyproject.toml'], PY],
      [['setup.py'], PY],
      [['Cargo.toml'], ['target/']],
      [['requirements.txt', 'package.json'], [...NODE, ...PY]],
      [['Cargo.toml', 'pyproject.toml', 'requirements.txt', 'package.json'], [...NODE, ...PY, 'target/']],
      [[], []],
    ];
    for (const [files, expected] of cases) {
      const root = tmp();
      for (const f of files) writeFileSync(join(root, f), f === 'package.json' ? '{"name":"demo"}' : '');
      const { candidates } = detectStackCandidates(root);
      expect(candidates, files.join('+')).toEqual(expected);
      expect(new Set(candidates).size).toBe(candidates.length);
    }
    // 空目录：无候选、不提问
    const empty = tmp();
    const ask = vi.fn(async () => '');
    const plan = await planIgnoreSuggestions(empty, 'zh', { interactive: true, ask, log: () => {} });
    expect(plan.outcome).toBe('none');
    expect(ask).not.toHaveBeenCalled();
    // 真实 init（TTY）在空目录不出现建议询问
    setTTY(true);
    const out = await inProcess(empty, () => init('demo', { locale: 'zh', aiTool: 'claude-code' }));
    expect(out.exited).toBeNull();
    expect(prompts.some(p => p.includes('[Y/n]'))).toBe(false);
  });

  it('UT-S01-140: 已忽略条目不再建议（git 仓库）', async () => {
    const root = tmp();
    gitInit(root);
    writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(root, '.git', 'info', 'exclude'), 'dist/\n');
    mkdirSync(join(root, 'packages', 'a'), { recursive: true });
    writeFileSync(join(root, 'packages', 'a', '.gitignore'), 'coverage/\nbuild/\n'); // 子目录无关规则
    const r = computeSuggestions(root, NODE);
    expect(r.git).toBe(true);
    expect(r.suggestions.map(s => s.entry)).toEqual(['build/', 'coverage/']);

    // 判定调用为 git check-ignore -q --no-index；*.pyc 以 openlogos-probe.pyc 探测
    const calls: string[][] = [];
    const exec = (cmd: string, args: string[], cwd: string): ScopeExecResult => {
      calls.push([cmd, ...args]);
      return defaultScopeIo.exec(cmd, args, cwd);
    };
    computeSuggestions(root, PY, { ...defaultScopeIo, exec });
    const checks = calls.filter(c => c[1] === 'check-ignore');
    expect(checks).toEqual([
      ['git', 'check-ignore', '-q', '--no-index', '--', '__pycache__/'],
      ['git', 'check-ignore', '-q', '--no-index', '--', '.venv/'],
      ['git', 'check-ignore', '-q', '--no-index', '--', 'openlogos-probe.pyc'],
    ]);

    // dist/ 下已有被跟踪文件且未被忽略 → 条目保留并附「含 N 个已跟踪文件」
    const tracked = tmp();
    gitInit(tracked);
    writeFileSync(join(tracked, 'package.json'), '{"name":"demo"}');
    mkdirSync(join(tracked, 'dist'), { recursive: true });
    for (const f of ['a.js', 'b.js']) writeFileSync(join(tracked, 'dist', f), f);
    gitCommitAll(tracked);
    const lines: string[] = [];
    const plan = await planIgnoreSuggestions(tracked, 'zh', { interactive: false, ask: async () => '', log: l => lines.push(l) });
    expect(plan.suggestions.find(s => s.entry === 'dist/')?.tracked).toBe(2);
    expect(lines).toContain('  dist/（含 2 个已跟踪文件）');
    // --no-index：已跟踪不影响已忽略判定（被忽略时不再建议）
    writeFileSync(join(tracked, '.gitignore'), 'dist/\n');
    expect(computeSuggestions(tracked, NODE).suggestions.map(s => s.entry)).not.toContain('dist/');
  });

  it('UT-S01-141: 非 git 仓库按 .gitignore 文本判定', async () => {
    const root = tmp();
    writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
    writeFileSync(join(root, '.gitignore'), 'node_modules\n# dist/\n!build/\n');
    const r = computeSuggestions(root, NODE);
    expect(r.git).toBe(false);
    expect(r.suggestions.map(s => s.entry)).toEqual(['dist/', 'build/', 'coverage/']);
    setTTY(false);
    const out = await inProcess(root, () => init('demo', { locale: 'zh', aiTool: 'claude-code' }));
    expect(out.exited).toBeNull();
    const text = out.logs.join('\n');
    expect(text).toContain('当前目录不在 git 仓库中，guard 新判据不生效');
    expect(text).toContain('openlogos ignore add dist/ build/ coverage/');
    expect(text).not.toMatch(/ignore add node_modules\//);
  });

  it('UT-S01-142: 接受写入、拒绝不写', async () => {
    expect(['', 'y', 'Y', 'yes'].every(isAcceptAnswer)).toBe(true);
    expect(['n', 'N', 'no', 'x', 'yy'].some(isAcceptAnswer)).toBe(false);
    for (const answer of ['', 'yes']) {
      const root = tmp();
      writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
      writeFileSync(join(root, 'requirements.txt'), '');
      setTTY(true);
      answers = [answer];
      const out = await inProcess(root, () => init('demo', { locale: 'zh', aiTool: 'claude-code' }));
      expect(out.exited).toBeNull();
      // --locale / --ai-tool 已给出，建议询问仍出现
      expect(prompts.filter(p => p === ASK_ZH)).toHaveLength(1);
      prompts.length = 0;
      expect(readConfig(root).guard?.unversioned).toEqual([...NODE, ...PY]);
      expect(managedBlockLines(gi(root).toString('utf-8'))).toEqual(expectedBlock([...NODE, ...PY]).split('\n'));
      expect(out.logs.join('\n')).toContain(`已加入 .gitignore 托管区块：${[...NODE, ...PY].join('、')}`);
    }
    // 拒绝
    const root = tmp();
    writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
    setTTY(true);
    answers = ['n'];
    const out = await inProcess(root, () => init('demo', { locale: 'zh', aiTool: 'claude-code' }));
    expect(out.exited).toBeNull();
    expect('guard' in readConfig(root)).toBe(false);
    expect(managedEntries(gi(root).toString('utf-8'))).toEqual([MANAGED_RUNTIME_ENTRY]);
    expect(out.logs.join('\n')).toContain('已跳过。之后可运行：openlogos ignore add node_modules/ dist/ build/ coverage/');
    // en 文案同口径
    const en = tmp();
    writeFileSync(join(en, 'Cargo.toml'), '[package]\nname = "demo"\n');
    setTTY(true);
    answers = ['n'];
    const outEn = await inProcess(en, () => init('demo', { locale: 'en', aiTool: 'claude-code' }));
    expect(prompts).toContain(ASK_EN);
    expect(outEn.logs.join('\n')).toContain('Detected Rust project. These paths are not ignored by git yet:');
    expect(outEn.logs.join('\n')).toContain('  · Skipped. You can add them later: openlogos ignore add target/');
  });

  it('UT-S01-143: 运行时目录条目直接写入与区块边界', async () => {
    // ① 无 .gitignore → 新建仅含托管区块的文件
    const r1 = tmp();
    setTTY(false);
    const o1 = await inProcess(r1, () => init('demo', { locale: 'zh', aiTool: 'claude-code' }));
    expect(o1.exited).toBeNull();
    expect(gi(r1).toString('utf-8')).toBe(`${expectedBlock([])}\n`);
    expect(o1.logs).toContain('  ✓ 已在 .gitignore 托管区块写入 logos/.openlogos-runtime/（OpenLogos 运行时文件）');
    expect(gi(r1).toString('utf-8')).not.toContain('logos/.openlogos-guard');

    // ② 已有用户内容（CRLF）→ 末尾追加、前置空行、区块用 CRLF、区块外字节不变
    const r2 = tmp();
    const user = Buffer.from('# 用户规则\r\n*.log\r\nsecret.txt\r\n', 'utf-8');
    writeFileSync(join(r2, '.gitignore'), user);
    await inProcess(r2, () => init('demo', { locale: 'zh', aiTool: 'claude-code' }));
    const after2 = gi(r2);
    expect(after2.subarray(0, user.length).equals(user)).toBe(true);
    expect(after2.subarray(user.length).toString('utf-8')).toBe(`\r\n${expectedBlock([], '\r\n')}\r\n`);

    // ③ 全部候选已被忽略 → 不提问，区块仍写运行时条目并告知
    const r3 = tmp();
    gitInit(r3);
    writeFileSync(join(r3, 'package.json'), '{"name":"demo"}');
    writeFileSync(join(r3, '.gitignore'), `${NODE.join('\n')}\n`);
    setTTY(true);
    const o3 = await inProcess(r3, () => init('demo', { locale: 'zh', aiTool: 'claude-code' }));
    expect(prompts.some(p => p.includes('[Y/n]'))).toBe(false);
    expect('guard' in readConfig(r3)).toBe(false);
    expect(managedEntries(gi(r3).toString('utf-8'))).toEqual([MANAGED_RUNTIME_ENTRY]);
    expect(o3.logs).toContain('  ✓ 已在 .gitignore 托管区块写入 logos/.openlogos-runtime/（OpenLogos 运行时文件）');

    // ④ 两个起始标记 / 有起无止 → exit 1，项目内零写入
    for (const broken of [
      `a\n${MANAGED_START}\nx/\n${MANAGED_START}\n${MANAGED_END}\n`,
      `a\n${MANAGED_START}\nx/\n`,
    ]) {
      const r4 = tmp();
      writeFileSync(join(r4, 'package.json'), '{"name":"demo"}');
      writeFileSync(join(r4, '.gitignore'), broken);
      setTTY(true);
      const o4 = await inProcess(r4, () => init('demo', { locale: 'zh', aiTool: 'claude-code' }));
      expect(o4.exited).toBe('1');
      expect(o4.errors.join('\n')).toMatch(/\.gitignore 中的 openlogos 托管区块已损坏（.+），请手工修复后重试，未创建任何文件。/);
      expect(existsSync(join(r4, 'logos'))).toBe(false);
      expect(existsSync(join(r4, 'AGENTS.md'))).toBe(false);
      expect(gi(r4).toString('utf-8')).toBe(broken);
      expect(prompts.some(p => p.includes('[Y/n]'))).toBe(false);
    }
  });

  it('UT-S01-144: 非交互默认不写建议条目', async () => {
    const root = tmp();
    writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
    setTTY(false);
    const out = await inProcess(root, () => init('demo', { locale: 'zh' }));
    expect(out.exited).toBeNull();
    expect(prompts.some(p => p.includes('[Y/n]'))).toBe(false);
    expect('guard' in readConfig(root)).toBe(false);
    expect(managedEntries(gi(root).toString('utf-8'))).toEqual([MANAGED_RUNTIME_ENTRY]);
    const text = out.logs.join('\n');
    for (const e of NODE) expect(out.logs).toContain(`  ${e}`);
    expect(text).toContain('非交互环境，未写入建议忽略条目。如需加入：openlogos ignore add node_modules/ dist/ build/ coverage/');
    expect(text).toContain('由 AI 代为执行时，宿主会对这次调用弹出原生审批');
    // 含通配条目时加引号
    const py = tmp();
    writeFileSync(join(py, 'pyproject.toml'), '[project]\nname = "demo"\n');
    const outPy = await inProcess(py, () => init('demo', { locale: 'zh' }));
    expect(outPy.logs.join('\n')).toContain("openlogos ignore add __pycache__/ .venv/ '*.pyc'");
    expect(formatIgnoreAddCommand(['a b/', "it's/", 'x/'])).toBe("openlogos ignore add 'a b/' 'it'\\''s/' x/");
  });

  it('ST-S01-31: 交互 init：接受、拒绝与已忽略不再建议', () => {
    const fixture = () => {
      const root = tmp();
      gitInit(root);
      writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
      writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
      return root;
    };
    const original = Buffer.from('node_modules/\n');
    // 接受（直接回车）
    const acc = fixture();
    const r = runCliPty(['init', '--locale', 'zh', '--ai-tool', 'claude-code'], acc, [['[Y/n]', '']]);
    expect(r.status, r.output).toBe(0);
    const listed = r.output.slice(r.output.indexOf('以下路径尚未被 git 忽略：'), r.output.indexOf('[Y/n]'));
    expect(listed.split('\n').slice(1).map(l => l.trim()).filter(l => l.endsWith('/'))).toEqual(['dist/', 'build/', 'coverage/']);
    expect(listed).not.toContain('node_modules/');
    for (const p of ['dist/x', 'build/x', 'coverage/x', 'logos/.openlogos-runtime/x']) expect(isIgnored(acc, p), p).toBe(true);
    expect(gi(acc).subarray(0, original.length).equals(original)).toBe(true);
    expect(readConfig(acc).guard?.unversioned).toEqual(['dist/', 'build/', 'coverage/']);
    // 同构夹具拒绝
    const rej = fixture();
    const r2 = runCliPty(['init', '--locale', 'zh', '--ai-tool', 'claude-code'], rej, [['[Y/n]', 'n']]);
    expect(r2.status, r2.output).toBe(0);
    expect('guard' in readConfig(rej)).toBe(false);
    expect(managedEntries(gi(rej).toString('utf-8'))).toEqual([MANAGED_RUNTIME_ENTRY]);
    expect(isIgnored(rej, 'dist/x')).toBe(false);
    expect(gi(rej).subarray(0, original.length).equals(original)).toBe(true);
  });

  it('ST-S01-32: 非交互 init 输出提示命令', () => {
    const fixture = () => {
      const root = tmp();
      gitInit(root);
      writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
      writeFileSync(join(root, 'requirements.txt'), '');
      return root;
    };
    const ni = fixture();
    const r = runCli(['init', '--locale', 'zh', '--ai-tool', 'claude-code'], ni);
    expect(r.status, r.stderr).toBe(0);
    expect('guard' in readConfig(ni)).toBe(false);
    expect(managedEntries(gi(ni).toString('utf-8'))).toEqual([MANAGED_RUNTIME_ENTRY]);
    const m = /如需加入：(openlogos ignore add .+)$/m.exec(r.stdout);
    expect(m, r.stdout).not.toBeNull();
    const cmd = m![1];
    expect(cmd).toBe("openlogos ignore add node_modules/ dist/ build/ coverage/ __pycache__/ .venv/ '*.pyc'");
    // 人工确认后原样执行同一命令（以 shell 解析引号；openlogos 指向被测 dist）
    const shim = join(tmp(), 'bin');
    mkdirSync(shim, { recursive: true });
    writeFileSync(join(shim, 'openlogos'), `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`, { mode: 0o755 });
    const run = spawnSync('sh', ['-c', cmd], { cwd: ni, encoding: 'utf-8', env: testEnv({ PATH: `${shim}:${process.env.PATH ?? ''}` }) });
    expect(run.status, run.stderr).toBe(0);
    // 与交互接受的结果相同
    const acc = fixture();
    const pr = runCliPty(['init', '--locale', 'zh', '--ai-tool', 'claude-code'], acc, [['[Y/n]', 'y']]);
    expect(pr.status, pr.output).toBe(0);
    expect(gi(ni).equals(gi(acc))).toBe(true);
    expect(readConfig(ni).guard).toEqual(readConfig(acc).guard);
  });

  it('ST-S01-33: init 端到端事后检查接线', () => {
    const root = tmp();
    const r = runCli(['init', 'demo', '--locale', 'zh', '--ai-tool', 'all'], root);
    expect(r.status, r.stderr).toBe(0);
    const settingsPath = join(root, '.claude', 'settings.json');
    const hooksPath = join(root, '.cursor', 'hooks.json');
    const claudeEngine = join(root, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs');
    const cursorEngine = join(root, CURSOR_ENGINE_REL_FILE);
    type Group = { matcher?: string; hooks: Array<{ command?: string }> };
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { hooks: Record<string, Group[]> };
    const cmds = (ev: string) => (settings.hooks[ev] ?? []).flatMap(g => g.hooks.map(h => h.command));
    expect(cmds('PostToolUse')).toContain(CLAUDE_POST_CHECK_COMMAND);
    expect(cmds('PostToolUseFailure')).toContain(CLAUDE_POST_CHECK_COMMAND);
    expect(cmds('Stop')).toContain(CLAUDE_STOP_CHECK_COMMAND);
    const engineSrc = join(REPO_ROOT, 'plugin', 'bin', 'guard-post-check.cjs');
    expect(sha(claudeEngine)).toBe(sha(engineSrc));
    expect(sha(cursorEngine)).toBe(sha(engineSrc));
    const hooks = JSON.parse(readFileSync(hooksPath, 'utf-8')) as { hooks: Record<string, Array<{ command: string }>> };
    for (const ev of CURSOR_HOOK_EVENTS) {
      expect(hooks.hooks[ev]?.some(h => h.command.includes('openlogos-runtime.cjs')), ev).toBe(true);
    }
    expect(CURSOR_HOOK_EVENTS).toHaveLength(4);
    // 用户自有 hooks 条目（按 CLI 同一序列化格式写回，保证不是格式差异）
    const userClaude = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-post' }] };
    const userCursor = { type: 'command', command: 'echo user-after-shell' };
    const sRaw = readFileSync(settingsPath, 'utf-8');
    const s = JSON.parse(sRaw) as { hooks: Record<string, unknown[]> };
    s.hooks.PostToolUse = [userClaude, ...s.hooks.PostToolUse];
    writeFileSync(settingsPath, JSON.stringify(s, null, 2) + (sRaw.endsWith('\n') ? '\n' : ''));
    const hRaw = readFileSync(hooksPath, 'utf-8');
    const h = JSON.parse(hRaw) as { hooks: Record<string, unknown[]> };
    h.hooks.afterShellExecution = [userCursor, ...h.hooks.afterShellExecution];
    writeFileSync(hooksPath, JSON.stringify(h, null, 2) + (hRaw.endsWith('\n') ? '\n' : ''));
    const before = [settingsPath, hooksPath, claudeEngine, cursorEngine].map(sha);
    const r2 = runCli(['init', '--ai-tool', 'all'], root);
    expect(r2.status, r2.stderr).toBe(0);
    expect([settingsPath, hooksPath, claudeEngine, cursorEngine].map(sha)).toEqual(before);
    const s2 = JSON.parse(readFileSync(settingsPath, 'utf-8')) as { hooks: Record<string, unknown[]> };
    const h2 = JSON.parse(readFileSync(hooksPath, 'utf-8')) as { hooks: Record<string, unknown[]> };
    const hashOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    expect(hashOf(s2.hooks.PostToolUse[0])).toBe(hashOf(userClaude));
    expect(hashOf(h2.hooks.afterShellExecution[0])).toBe(hashOf(userCursor));
  });
});

/* ═════════════════════════════ S20 adopt ═════════════════════════════ */

describe('S20 技术栈建议忽略（adopt）', () => {
  it('UT-S20-49: 存量 .gitignore 下只建议未被忽略的条目', async () => {
    const root = tmp();
    gitInit(root);
    writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n/dist\n');
    mkdirSync(join(root, 'packages', 'a'), { recursive: true });
    writeFileSync(join(root, 'packages', 'a', '.gitignore'), 'coverage/\n');
    writeFileSync(join(root, '.git', 'info', 'exclude'), 'build/\n');
    setTTY(true);
    answers = [''];
    const out = await inProcess(root, () => adopt(undefined, { locale: 'zh', aiTool: 'cursor' }));
    expect(out.exited).toBeNull();
    expect(prompts).toContain(ASK_ZH);
    const listed = out.logs.slice(out.logs.findIndex(l => l.includes('以下路径尚未被 git 忽略')) + 1)
      .filter(l => /^ {2}\S+\/?$/.test(l) && !l.includes('✓'));
    expect(listed.map(l => l.trim()).slice(0, 1)).toEqual(['coverage/']);
    expect(readConfig(root).guard?.unversioned).toEqual(['coverage/']);

    // 全部候选已命中：不提问、无 guard.unversioned、区块只含运行时条目
    const all = tmp();
    gitInit(all);
    writeFileSync(join(all, 'package.json'), '{"name":"demo"}');
    writeFileSync(join(all, '.gitignore'), 'node_modules/\n/dist\n');
    writeFileSync(join(all, '.git', 'info', 'exclude'), 'build/\ncoverage/\n');
    prompts.length = 0;
    setTTY(true);
    const o2 = await inProcess(all, () => adopt(undefined, { locale: 'zh', aiTool: 'cursor' }));
    expect(o2.exited).toBeNull();
    expect(prompts.some(p => p.includes('[Y/n]'))).toBe(false);
    expect('guard' in readConfig(all)).toBe(false);
    expect(managedEntries(gi(all).toString('utf-8'))).toEqual([MANAGED_RUNTIME_ENTRY]);
  });

  it('UT-S20-50: 接受 / 拒绝与区块外逐字节不变', async () => {
    // 注意：CRLF 文件中的空行在 git 中是模式 "\r"，会命中一切路径，故夹具不含空行
    const userBytes = Buffer.from('# 团队规则\r\n*.log\r\n# 产物\r\ndist/\r\n', 'utf-8');
    const fixture = () => {
      const root = tmp();
      gitInit(root);
      writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
      writeFileSync(join(root, '.gitignore'), userBytes);
      return root;
    };
    // 接受
    const acc = fixture();
    setTTY(true);
    answers = ['y'];
    const o1 = await inProcess(acc, () => adopt(undefined, { locale: 'zh', aiTool: 'cursor' }));
    expect(o1.exited, o1.logs.join('\n')).toBeNull();
    const expected = ['node_modules/', 'build/', 'coverage/'];
    expect(readConfig(acc).guard?.unversioned).toEqual(expected);
    const a = gi(acc);
    expect(a.subarray(0, userBytes.length).equals(userBytes)).toBe(true);
    expect(a.subarray(userBytes.length).toString('utf-8')).toBe(`\r\n${expectedBlock(expected, '\r\n')}\r\n`);
    // 拒绝
    const rej = fixture();
    setTTY(true);
    answers = ['n'];
    const o2 = await inProcess(rej, () => adopt(undefined, { locale: 'zh', aiTool: 'cursor' }));
    expect(o2.exited).toBeNull();
    expect('guard' in readConfig(rej)).toBe(false);
    expect(managedEntries(gi(rej).toString('utf-8'))).toEqual([MANAGED_RUNTIME_ENTRY]);
    expect(gi(rej).subarray(0, userBytes.length).equals(userBytes)).toBe(true);
    expect(o2.logs.join('\n')).toContain('openlogos ignore add node_modules/ build/ coverage/');
    // 已有完整区块：原地替换、不重复
    const inPlace = tmp();
    gitInit(inPlace);
    writeFileSync(join(inPlace, 'package.json'), '{"name":"demo"}');
    const head = `top\n${MANAGED_START}\n# old note\nstale/\n${MANAGED_END}\n`;
    const tail = 'bottom-rule\n';
    writeFileSync(join(inPlace, '.gitignore'), head + tail);
    setTTY(true);
    answers = [''];
    await inProcess(inPlace, () => adopt(undefined, { locale: 'zh', aiTool: 'cursor' }));
    const ip = gi(inPlace).toString('utf-8');
    expect(ip.split(MANAGED_START)).toHaveLength(2);
    expect(ip).toBe(`top\n${expectedBlock(NODE)}\n${tail}`);
    // 区块损坏（两个起始标记）→ exit 1，未创建 logos/，.gitignore 字节不变
    const broken = tmp();
    writeFileSync(join(broken, 'package.json'), '{"name":"demo"}');
    const brokenBytes = `${MANAGED_START}\n${MANAGED_START}\n${MANAGED_END}\n`;
    writeFileSync(join(broken, '.gitignore'), brokenBytes);
    setTTY(true);
    const o4 = await inProcess(broken, () => adopt(undefined, { locale: 'zh', aiTool: 'cursor' }));
    expect(o4.exited).toBe('1');
    expect(o4.errors.join('\n')).toContain('.gitignore 中的 openlogos 托管区块已损坏');
    expect(existsSync(join(broken, 'logos'))).toBe(false);
    expect(gi(broken).toString('utf-8')).toBe(brokenBytes);
  });

  it('UT-S20-51: 已跟踪产物目录的提示与非交互默认', async () => {
    const fixture = () => {
      const root = tmp();
      gitInit(root);
      writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
      writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
      mkdirSync(join(root, 'dist', 'sub'), { recursive: true });
      writeFileSync(join(root, 'dist', 'a.js'), 'a');
      writeFileSync(join(root, 'dist', 'b c.js'), 'b');
      writeFileSync(join(root, 'dist', 'sub', 'd.js'), 'd');
      writeFileSync(join(root, 'src.js'), 'src');
      gitCommitAll(root);
      return root;
    };
    const root = fixture();
    const lsBefore = git(root, ['ls-files', 'dist/']).stdout;
    setTTY(true);
    answers = [''];
    const out = await inProcess(root, () => adopt(undefined, { locale: 'zh', aiTool: 'cursor' }));
    expect(out.exited).toBeNull();
    expect(out.logs).toContain('  dist/（含 3 个已跟踪文件）');
    const text = out.logs.join('\n');
    expect(text).toContain('有 3 个已跟踪文件命中 "dist/"');
    for (const f of ['dist/a.js', 'dist/b c.js', 'dist/sub/d.js']) expect(text).toContain(`    ${f}`);
    const cmd = "git --literal-pathspecs rm --cached -- 'dist/a.js' 'dist/b c.js' 'dist/sub/d.js'";
    expect(text).toContain(cmd);
    expect(git(root, ['ls-files', 'dist/']).stdout).toBe(lsBefore); // CLI 未执行
    // 在夹具副本中执行该命令：恰好移出这 3 个文件
    const copy = join(tmp(), 'copy');
    cpSync(root, copy, { recursive: true });
    const othersBefore = git(copy, ['ls-files']).stdout.split('\n').filter(f => f && !f.startsWith('dist/'));
    const run = spawnSync('sh', ['-c', cmd], { cwd: copy, encoding: 'utf-8', env: testEnv() });
    expect(run.status, run.stderr).toBe(0);
    expect(git(copy, ['ls-files', 'dist/']).stdout).toBe('');
    expect(git(copy, ['ls-files']).stdout.split('\n').filter(f => f && !f.startsWith('dist/'))).toEqual(othersBefore);
    // 非 TTY：不写建议条目，报告含建议清单与提示命令，退出码 0
    const ni = fixture();
    setTTY(false);
    const o2 = await inProcess(ni, () => adopt(undefined, { locale: 'zh', aiTool: 'cursor' }));
    expect(o2.exited).toBeNull();
    expect('guard' in readConfig(ni)).toBe(false);
    expect(o2.logs).toContain('  dist/（含 3 个已跟踪文件）');
    expect(o2.logs.join('\n')).toContain('如需加入：openlogos ignore add dist/ build/ coverage/');
    expect(managedEntries(gi(ni).toString('utf-8'))).toEqual([MANAGED_RUNTIME_ENTRY]);
  });

  it('ST-S20-26: 真实 adopt 存量 Node 项目的建议忽略', () => {
    const root = tmp();
    gitInit(root);
    writeFileSync(join(root, 'package.json'), '{"name":"demo"}');
    const original = Buffer.from('node_modules/\n');
    writeFileSync(join(root, '.gitignore'), original);
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'bundle.js'), 'x');
    gitCommitAll(root);
    const r = runCliPty(['adopt', '--locale', 'zh', '--ai-tool', 'claude-code'], root, [['[Y/n]', 'y']]);
    expect(r.status, r.output).toBe(0);
    const listed = r.output.slice(r.output.indexOf('以下路径尚未被 git 忽略：'), r.output.indexOf('是否加入'));
    expect(listed.split('\n').slice(1).map(l => l.trim().replace(/（.*）$/, '')).filter(l => /^\S+\/$/.test(l))).toEqual(['dist/', 'build/', 'coverage/']);
    for (const p of ['dist/x', 'build/x', 'coverage/x', 'logos/.openlogos-runtime/x']) expect(isIgnored(root, p), p).toBe(true);
    expect(git(root, ['ls-files', 'dist/']).stdout.trim()).toBe('dist/bundle.js');
    expect(gi(root).subarray(0, original.length).equals(original)).toBe(true);
    const before = gi(root);
    const s = runCli(['sync'], root);
    expect(s.status, s.stderr).toBe(0);
    expect(gi(root).equals(before)).toBe(true);
  });
});
