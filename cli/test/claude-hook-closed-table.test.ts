/**
 * fix-claude-hook-windows-powershell-fallback 切片 1：Claude hook 托管条目封闭表迁移（S01 / S08）。
 *
 * 覆盖 UT-S01-147、UT-S01-148、ST-S01-34、UT-S08-84、UT-S08-85、UT-S08-86、UT-S08-88、UT-S08-89、ST-S08-44
 * （与 logos/resources/test/core-S01-test-cases.md、core-S08-test-cases.md 对齐；规则见功能规格 §2.105.2～§2.105.4）。
 * fix-claude-settings-local-eol 扩展 UT-S08-89：插入点取局部换行（单分组正反样例、三分组 A/B/C、顶层对象补写 language）。
 * init / sync 走真实命令入口（mockCwd + captureConsole）；结果由全局 OpenLogos reporter 写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { init, deployClaudeCodePlugin } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import {
  CLAUDE_GUARD_HOOK_COMMAND, CLAUDE_GUARD_HOOK_MATCHER, CLAUDE_PHASE_HOOK_COMMAND, CLAUDE_POST_CHECK_COMMAND,
  CLAUDE_POST_MATCHER, CLAUDE_STOP_CHECK_COMMAND,
} from '../src/lib/claude-hook-registry.js';
import { captureConsole, makeTempRoot, mockCwd } from './helpers.js';

const OLD_POST = 'node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs" check';
const OLD_STOP = `${OLD_POST} --stop`;
const ENGINE_ARG = '${CLAUDE_PROJECT_DIR}/.claude/openlogos/bin/guard-post-check.cjs';
const RUNLOGOS_PHASE = { type: 'command', command: 'node ".claude/openlogos/bin/openlogos-phase-launcher.cjs"' };
const AUDIT_GUARD = { type: 'command', command: 'node audit.cjs "${CLAUDE_PROJECT_DIR}/.claude/openlogos/bin/guard-check"' };
const AUDIT_ENGINE = { type: 'command', command: 'node audit.cjs ".claude/openlogos/bin/guard-post-check.cjs"' };
const AUDIT = { type: 'command', command: 'node audit.cjs' };

type Hook = { type?: string; command?: string; args?: string[]; timeout?: number };
type Group = { matcher?: string; hooks: Hook[] };
type Hooks = Record<string, Group[]>;

let root: string;
let cleanup: () => void;
beforeEach(() => { ({ root, cleanup } = makeTempRoot()); });
afterEach(() => { cleanup(); });

const settingsPath = (base: string): string => join(base, '.claude', 'settings.json');
const raw = (base: string): string => readFileSync(settingsPath(base), 'utf-8');
const hooksOf = (base: string): Hooks => (JSON.parse(raw(base)) as { hooks: Hooks }).hooks;
const writeHooks = (base: string, hooks: Hooks, extra: Record<string, unknown> = {}): void =>
  writeFileSync(settingsPath(base), JSON.stringify({ hooks, ...extra }, null, 2));

async function initClaude(base: string): Promise<void> {
  const restore = mockCwd(base);
  const cap = captureConsole();
  try { await init('demo', { locale: 'zh', aiTool: 'claude-code' }); } finally { cap.restore(); restore(); }
}

function runSync(base: string): { stderr: string } {
  const restore = mockCwd(base);
  const cap = captureConsole();
  try { sync(); } finally { cap.restore(); restore(); }
  return { stderr: cap.errors.join('\n') };
}

/** 统计某事件中与给定命令相同的条目数（任意分组）。 */
function count(groups: Group[] | undefined, command: string): number {
  return (groups ?? []).flatMap(g => g.hooks).filter(h => h.command === command && !h.args).length;
}

/** 某工具调用实际命中的命令集合（matcher 按 `|` 精确匹配工具名；无 matcher 视为全部命中）。 */
function hits(groups: Group[], tool: string): string[] {
  return groups.filter(g => g.matcher === undefined || g.matcher.split('|').includes(tool))
    .flatMap(g => g.hooks.map(h => h.command ?? ''));
}

/** 0.16.22 init 产物形态 + 用户条目（HM-0.16.22 夹具）。 */
function hm01622(): Hooks {
  return {
    SessionStart: [{ hooks: [RUNLOGOS_PHASE] }, { hooks: [{ type: 'command', command: CLAUDE_PHASE_HOOK_COMMAND }] }],
    PreToolUse: [
      { matcher: 'Edit', hooks: [AUDIT_GUARD] },
      { matcher: CLAUDE_GUARD_HOOK_MATCHER, hooks: [{ type: 'command', command: CLAUDE_GUARD_HOOK_COMMAND }] },
    ],
    PostToolUse: [{ matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: OLD_POST }] }],
    PostToolUseFailure: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: OLD_POST }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'echo user-stop' }] }, { hooks: [{ type: 'command', command: OLD_STOP }] }],
  };
}

/** HM-exec：PostToolUse 与 Stop 托管条目改为历史 exec 形态（Stop 路径用 `\`），PreToolUse 标准分组内加未收录写法。 */
function hmExec(): Hooks {
  const h = hm01622();
  h.PostToolUse = [{ matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: 'node', args: [ENGINE_ARG, 'check'] }] }];
  h.Stop = [h.Stop[0], { hooks: [{ type: 'command', command: 'node', args: [ENGINE_ARG.replace(/\//g, '\\'), 'check', '--stop'] }] }];
  h.PreToolUse[1].hooks.push({ type: 'command', command: 'bash', args: ['C:/proj/.claude/openlogos/bin/guard-check'] });
  return h;
}

function expectCurrentPostHooks(hooks: Hooks): void {
  for (const [event, command] of [['PostToolUse', CLAUDE_POST_CHECK_COMMAND], ['PostToolUseFailure', CLAUDE_POST_CHECK_COMMAND],
    ['Stop', CLAUDE_STOP_CHECK_COMMAND]] as const) {
    expect(count(hooks[event], command), `${event} 现行托管条目唯一`).toBe(1);
    const legacy = (hooks[event] ?? []).flatMap(g => g.hooks).filter(h => h.command === OLD_POST || h.command === OLD_STOP || h.args);
    expect(legacy, `${event} 无历史形态残留`).toEqual([]);
  }
}

/** 以 bash 执行注册命令（模拟 bash 宿主：CLAUDE_PROJECT_DIR 由 shell 展开），返回退出码。 */
function runRegistered(base: string, command: string, input: unknown): number {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: base };
  return spawnSync('bash', ['-c', command], { cwd: base, env, input: JSON.stringify(input), encoding: 'utf-8', timeout: 20_000 }).status ?? -1;
}

function runEngineDirect(base: string, args: string[], input: unknown): number {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: base };
  return spawnSync(process.execPath, [join(base, '.claude', 'openlogos', 'bin', 'guard-post-check.cjs'), ...args],
    { cwd: base, env, input: JSON.stringify(input), encoding: 'utf-8', timeout: 20_000 }).status ?? -1;
}

const POST_INPUT = (base: string, event: string) => ({
  hook_event_name: event, session_id: 's-1', tool_use_id: 't-1', cwd: base,
  tool_name: 'Bash', tool_input: { command: 'echo hi' }, tool_response: { stdout: 'hi' },
});

describe('S01 Claude hook 托管识别封闭表', () => {
  it('UT-S01-147: init 写入的注册形态', async () => {
    await initClaude(root);
    const text = raw(root);
    const hooks = hooksOf(root);
    expect(hooks.PostToolUse.flatMap(g => g.hooks.map(h => h.command))).toEqual([CLAUDE_POST_CHECK_COMMAND]);
    expect(hooks.PostToolUseFailure.flatMap(g => g.hooks.map(h => h.command))).toEqual([CLAUDE_POST_CHECK_COMMAND]);
    expect(hooks.Stop.flatMap(g => g.hooks.map(h => h.command))).toEqual([CLAUDE_STOP_CHECK_COMMAND]);
    for (const c of [CLAUDE_POST_CHECK_COMMAND, CLAUDE_STOP_CHECK_COMMAND]) {
      expect(c, '事后检查命令不含裸 $VAR').not.toMatch(/\$(?!\{)[A-Za-z_]/);
      expect(c).toContain('${CLAUDE_PROJECT_DIR}');
    }
    expect(hooks.PreToolUse.flatMap(g => g.hooks.map(h => h.command))).toEqual(['"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check']);
    expect(hooks.SessionStart.flatMap(g => g.hooks.map(h => h.command))).toEqual(['"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/openlogos-phase']);
    for (const c of [CLAUDE_GUARD_HOOK_COMMAND, CLAUDE_PHASE_HOOK_COMMAND]) {
      expect(c.startsWith('node'), 'bash 脚本型 hook 不经 node 中转').toBe(false);
      expect(/^".*"$/.test(c), '不是整体加引号的单个字符串（PowerShell 下会被当作字符串求值）').toBe(false);
    }
    for (const g of Object.values(hooks).flat()) for (const h of g.hooks) expect(Object.keys(h).sort()).toEqual(['command', 'type']);
    expect(text.length).toBeGreaterThan(0);
  });

  it('UT-S01-148: 封闭表识别与分组判定', async () => {
    await initClaude(root);
    const userPre = { matcher: 'Edit', hooks: [AUDIT_GUARD, { type: 'command', command: CLAUDE_GUARD_HOOK_COMMAND }] };
    const userAuditPost = { matcher: 'Bash', hooks: [AUDIT_ENGINE] };
    const timeoutStop = { hooks: [{ type: 'command', command: CLAUDE_STOP_CHECK_COMMAND, timeout: 30 }] };
    writeHooks(root, {
      PreToolUse: [userPre],
      SessionStart: [{ hooks: [RUNLOGOS_PHASE] }],
      PostToolUse: [
        { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: OLD_POST }] },
        { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: 'node', args: [ENGINE_ARG.replace(/\//g, '\\'), 'check'] }] },
        userAuditPost,
      ],
      PostToolUseFailure: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] }],
      Stop: [timeoutStop],
    });
    deployClaudeCodePlugin(root, 'zh');
    const hooks = hooksOf(root);
    // ①：用户分组（含引用 guard 路径的命令与逐字相同的 guard 命令）原样保留，不计入“已注册”，标准分组照常追加且唯一
    expect(hooks.PreToolUse[0]).toEqual(userPre);
    expect(hooks.PreToolUse.filter(g => g.matcher === CLAUDE_GUARD_HOOK_MATCHER)).toEqual([
      { matcher: CLAUDE_GUARD_HOOK_MATCHER, hooks: [{ type: 'command', command: CLAUDE_GUARD_HOOK_COMMAND }] },
    ]);
    // ②：RunLogos launcher 条目保留；OpenLogos SessionStart 托管条目存在且唯一
    expect(hooks.SessionStart[0]).toEqual({ hooks: [RUNLOGOS_PHASE] });
    expect(count(hooks.SessionStart, CLAUDE_PHASE_HOOK_COMMAND)).toBe(1);
    // ③：历史字符串与历史 exec（`\` 路径）收敛为一条现行形态，args 被移除，位置为第一条所在位置
    expect(hooks.PostToolUse).toEqual([
      { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] },
      userAuditPost, // ⑤：引用引擎路径的用户命令按用户条目保留
    ]);
    // ④：带 timeout 的条目不是托管条目，原样保留；标准 Stop 分组追加
    expect(hooks.Stop[0]).toEqual(timeoutStop);
    expect(hooks.Stop[1]).toEqual({ hooks: [{ type: 'command', command: CLAUDE_STOP_CHECK_COMMAND }] });
    // 再次部署零变化
    const before = raw(root);
    deployClaudeCodePlugin(root, 'zh');
    expect(raw(root)).toBe(before);
  });

  it('ST-S01-34: init 端到端与注册命令可执行', async () => {
    const restore = mockCwd(root);
    const cap = captureConsole();
    try { await init('demo', { locale: 'zh', aiTool: 'claude-code' }); } finally { cap.restore(); restore(); }
    const hooks = hooksOf(root);
    expectCurrentPostHooks(hooks);
    expect(count(hooks.PreToolUse, CLAUDE_GUARD_HOOK_COMMAND)).toBe(1);
    expect(count(hooks.SessionStart, CLAUDE_PHASE_HOOK_COMMAND)).toBe(1);
    // 在 bash 下执行注册的 PostToolUse 命令，与直接以 node 调用引擎的退出码一致
    const input = POST_INPUT(root, 'PostToolUse');
    expect(runRegistered(root, hooks.PostToolUse[0].hooks[0].command!, input)).toBe(runEngineDirect(root, ['check'], input));
    // 非 Windows：stderr 不含 Git Bash 前提警告
    if (process.platform !== 'win32') expect(cap.errors.join('\n')).not.toContain('Git Bash');
    // 重复部署后 settings.json 字节零变化
    const before = raw(root);
    deployClaudeCodePlugin(root, 'zh');
    expect(raw(root)).toBe(before);
  });
});

describe('S08 sync 按封闭表迁移 Claude hook', () => {
  it('UT-S08-84: 历史 "$CLAUDE_PROJECT_DIR/…" 形态迁移', async () => {
    await initClaude(root);
    const preset = hm01622();
    writeHooks(root, preset);
    runSync(root);
    const hooks = hooksOf(root);
    expectCurrentPostHooks(hooks);
    // 位置与原托管条目一致
    expect(hooks.PostToolUse[0].hooks[0].command).toBe(CLAUDE_POST_CHECK_COMMAND);
    expect(hooks.Stop[1].hooks[0].command).toBe(CLAUDE_STOP_CHECK_COMMAND);
    // PreToolUse / SessionStart 托管条目逐字不变；用户条目与 RunLogos launcher 保留
    expect(hooks.PreToolUse).toEqual(preset.PreToolUse);
    expect(hooks.SessionStart).toEqual(preset.SessionStart);
    expect(hooks.Stop[0]).toEqual(preset.Stop[0]);
  });

  it('UT-S08-85: 已知 exec 写法迁移与未收录写法保留', async () => {
    await initClaude(root);
    const preset = hmExec();
    writeHooks(root, preset);
    runSync(root);
    const hooks = hooksOf(root);
    expectCurrentPostHooks(hooks);
    expect(hooks.PostToolUse).toEqual([{ matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] }]);
    expect(hooks.Stop[1]).toEqual({ hooks: [{ type: 'command', command: CLAUDE_STOP_CHECK_COMMAND }] });
    // 未收录的 bash + args 写法按用户条目保留；标准分组中的现行 guard-check 仍唯一
    expect(hooks.PreToolUse[1]).toEqual(preset.PreToolUse[1]);
    expect(count(hooks.PreToolUse, CLAUDE_GUARD_HOOK_COMMAND)).toBe(1);
  });

  it('UT-S08-86: 分组判定、收敛与幂等', async () => {
    await initClaude(root);
    // ① 只留用户分组（matcher Edit，含逐字相同的 guard 命令）→ 追加完整 matcher 的标准分组
    const userPre = { matcher: 'Edit', hooks: [{ type: 'command', command: CLAUDE_GUARD_HOOK_COMMAND }] };
    // ② PostToolUse 同时含历史形态与现行形态托管条目 → 收敛为一条，保留第一条的位置
    const preset = hm01622();
    preset.PreToolUse = [userPre];
    preset.PostToolUse = [
      { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: OLD_POST }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-post' }] },
      { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] },
    ];
    writeHooks(root, preset);
    runSync(root);
    const hooks = hooksOf(root);
    expect(hooks.PreToolUse).toEqual([
      userPre,
      { matcher: CLAUDE_GUARD_HOOK_MATCHER, hooks: [{ type: 'command', command: CLAUDE_GUARD_HOOK_COMMAND }] },
    ]);
    expect(hits(hooks.PreToolUse, 'Write')).toEqual([CLAUDE_GUARD_HOOK_COMMAND]);
    expect(hooks.PostToolUse).toEqual([
      { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-post' }] },
    ]);
    // ③ 第二次 sync 字节零变化
    const before = raw(root);
    runSync(root);
    expect(raw(root)).toBe(before);
    // ④ 不可解析 / 顶层为数组：零写入
    for (const bad of ['{ "hooks": ', '[{"hooks":{}}]']) {
      writeFileSync(settingsPath(root), bad);
      runSync(root);
      expect(raw(root)).toBe(bad);
    }
    // ⑤ 重复的顶层 hooks 键（code-r1 F1）：写入 JSON.parse 生效的末项，被遮盖的前项原文不动
    const shadow = '"hooks": {"Shadowed": [{"hooks": [{"type": "command", "command": "echo shadow"}]}]}';
    writeFileSync(settingsPath(root), `{\n  ${shadow},\n  "hooks": {}\n}\n`);
    runSync(root);
    const effective = hooksOf(root);
    expect(count(effective.SessionStart, CLAUDE_PHASE_HOOK_COMMAND), '生效成员中 SessionStart 托管条目唯一').toBe(1);
    expect(count(effective.PreToolUse, CLAUDE_GUARD_HOOK_COMMAND)).toBe(1);
    expectCurrentPostHooks(effective);
    expect(raw(root)).toContain(shadow);
    const settled = raw(root);
    runSync(root);
    expect(raw(root)).toBe(settled);
  });

  it('UT-S08-88: 托管条目与用户条目同组', async () => {
    await initClaude(root);
    const preset = hm01622();
    preset.PostToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: OLD_POST }, AUDIT] }];
    preset.PreToolUse = [{ matcher: 'Edit|Write|Bash', hooks: [{ type: 'command', command: CLAUDE_GUARD_HOOK_COMMAND }, { type: 'command', command: 'echo user-pre' }] }];
    writeHooks(root, preset);
    runSync(root);
    const hooks = hooksOf(root);
    // 原分组保留原 matcher 与用户命令，托管条目移入紧随其后的标准分组
    expect(hooks.PostToolUse).toEqual([
      { matcher: 'Bash', hooks: [AUDIT] },
      { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] },
    ]);
    expect(hits(hooks.PostToolUse, 'Bash').sort()).toEqual([AUDIT.command, CLAUDE_POST_CHECK_COMMAND].sort());
    expect(hits(hooks.PostToolUse, 'PowerShell')).toEqual([CLAUDE_POST_CHECK_COMMAND]);
    expect(hooks.PreToolUse).toEqual([
      { matcher: 'Edit|Write|Bash', hooks: [{ type: 'command', command: 'echo user-pre' }] },
      { matcher: CLAUDE_GUARD_HOOK_MATCHER, hooks: [{ type: 'command', command: CLAUDE_GUARD_HOOK_COMMAND }] },
    ]);
    expect(hits(hooks.PreToolUse, 'Write').sort()).toEqual(['echo user-pre', CLAUDE_GUARD_HOOK_COMMAND].sort());
    expect(hits(hooks.PreToolUse, 'MultiEdit')).toEqual([CLAUDE_GUARD_HOOK_COMMAND]);
    const before = raw(root);
    runSync(root);
    expect(raw(root)).toBe(before);

    // 两个混合分组并存（code-r1 F2）：先把第一组的旧检查移入紧随其后新建的纯托管标准分组，
    // 再按迁移后的顺序收敛 → A、纯托管组、B 三个分组
    const B = { type: 'command', command: 'node b.cjs' };
    preset.PostToolUse = [
      { matcher: 'Bash', hooks: [{ type: 'command', command: OLD_POST }, AUDIT] },
      { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }, B] },
    ];
    writeHooks(root, preset);
    runSync(root);
    expect(hooksOf(root).PostToolUse).toEqual([
      { matcher: 'Bash', hooks: [AUDIT] },
      { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] },
      { matcher: CLAUDE_POST_MATCHER, hooks: [B] },
    ]);
    const twice = raw(root);
    runSync(root);
    expect(raw(root)).toBe(twice);
  });

  it('UT-S08-89: 首次迁移的字节保真（含同次语言合并）', async () => {
    await initClaude(root);
    const cur = (c: string) => JSON.stringify({ type: 'command', command: c });
    const oldStop = cur(OLD_STOP);
    const compact = (language: string) => '{"hooks":{'
      + `"SessionStart":[{"hooks":[${cur(CLAUDE_PHASE_HOOK_COMMAND)}]}],`
      + `"PreToolUse":[{"matcher":"${CLAUDE_GUARD_HOOK_MATCHER}","hooks":[${cur(CLAUDE_GUARD_HOOK_COMMAND)}]}],`
      + `"PostToolUse":[{"matcher":"${CLAUDE_POST_MATCHER}","hooks":[${cur(CLAUDE_POST_CHECK_COMMAND)}]},{"matcher":"Bash","hooks":[{"type":"command","command":"echo \\u0061udit"}]}],`
      + `"PostToolUseFailure":[{"matcher":"Bash|PowerShell","hooks":[${cur(CLAUDE_POST_CHECK_COMMAND)}]}],`
      + `"Stop":[{"hooks":[${oldStop}]}]}${language}}`;
    for (const [language, expectedTail] of [['', ',"language":"chinese"}'], [',"language":"english"', ',"language":"chinese"}']] as const) {
      const before = compact(language);
      expect(before).toContain('"echo \\u0061udit"');
      writeFileSync(settingsPath(root), before);
      runSync(root); // 完整 sync 入口：hook 合并 + 紧随其后的语言合并
      const after = raw(root);
      // 直接比较原始文本：只有 Stop 托管 hook 对象区间与 language 片段被改写
      const expected = before.replace(oldStop, cur(CLAUDE_STOP_CHECK_COMMAND)).replace(/(,"language":"english")?}$/, expectedTail);
      expect(after).toBe(expected);
      expect(after).toContain('"echo \\u0061udit"');
      expect((JSON.parse(after) as { language: string }).language).toBe('chinese');
      // 第二次 sync 整文件字节零变化
      runSync(root);
      expect(raw(root)).toBe(after);
    }

    // CRLF 展开格式 + 混合分组（code-r1 F3 / F5）：旧托管对象紧跟数组左括号，用户命令另起一行、缩进八个空格。
    // 移出托管条目后，用户命令的前导 CRLF 与缩进逐字节保留；新插入片段沿用 CRLF，不出现孤立 LF。
    const userLine = '\r\n        {"type": "command", "command": "node audit.cjs"}';
    const crlf = [
      '{',
      '  "hooks": {',
      `    "SessionStart": [{"hooks": [${cur(CLAUDE_PHASE_HOOK_COMMAND)}]}],`,
      `    "PreToolUse": [{"matcher": "${CLAUDE_GUARD_HOOK_MATCHER}", "hooks": [${cur(CLAUDE_GUARD_HOOK_COMMAND)}]}],`,
      `    "PostToolUse": [{"matcher": "Bash", "hooks": [${cur(OLD_POST)},${userLine}]}],`,
      `    "PostToolUseFailure": [{"matcher": "Bash|PowerShell", "hooks": [${cur(CLAUDE_POST_CHECK_COMMAND)}]}],`,
      `    "Stop": [{"hooks": [${cur(CLAUDE_STOP_CHECK_COMMAND)}]}]`,
      '  },',
      '  "language": "chinese"',
      '}',
      '',
    ].join('\r\n');
    writeFileSync(settingsPath(root), crlf);
    runSync(root);
    const migrated = raw(root);
    expect(migrated).toContain(`"hooks": [${userLine}]`);
    expect(migrated, 'CRLF 文件中不出现孤立 LF').not.toMatch(/(?<!\r)\n/);
    expect(hooksOf(root).PostToolUse).toEqual([
      { matcher: 'Bash', hooks: [AUDIT] },
      { matcher: CLAUDE_POST_MATCHER, hooks: [{ type: 'command', command: CLAUDE_POST_CHECK_COMMAND }] },
    ]);
    // CRLF 展开格式、hooks 为空对象：五个事件全部注册，仍无孤立 LF
    writeFileSync(settingsPath(root), '{\r\n  "hooks": {}\r\n}\r\n');
    runSync(root);
    expect(raw(root)).not.toMatch(/(?<!\r)\n/);
    expectCurrentPostHooks(hooksOf(root));
    const crlfSettled = raw(root);
    runSync(root);
    expect(raw(root)).toBe(crlfSettled);

    // —— 插入点取局部换行（fix-claude-settings-local-eol）：远处的换行不得影响插入点 ——
    const entry = (command: string) => ({ type: 'command', command });
    const otherEvents = {
      SessionStart: [{ hooks: [entry(CLAUDE_PHASE_HOOK_COMMAND)] }],
      PreToolUse: [{ matcher: CLAUDE_GUARD_HOOK_MATCHER, hooks: [entry(CLAUDE_GUARD_HOOK_COMMAND)] }],
      PostToolUse: [{ matcher: CLAUDE_POST_MATCHER, hooks: [entry(CLAUDE_POST_CHECK_COMMAND)] }],
      PostToolUseFailure: [{ matcher: 'Bash|PowerShell', hooks: [entry(CLAUDE_POST_CHECK_COMMAND)] }],
    };
    const crlfCount = (s: string) => s.split('\r\n').length - 1;
    const loneLfCount = (s: string) => (s.match(/(?<!\r)\n/g) ?? []).length;
    /** 首次 sync：断言只在 pos 处插入了一段，其余字节与原文完全相同；返回插入的片段。第二次 sync 零变化。 */
    const syncInsertedAt = (before: string, pos: number): string => {
      writeFileSync(settingsPath(root), before);
      runSync(root);
      const after = raw(root);
      const tail = before.slice(pos);
      expect(after.startsWith(before.slice(0, pos)), '插入点之前逐字节不变').toBe(true);
      expect(after.endsWith(tail), '插入点之后逐字节不变').toBe(true);
      runSync(root);
      expect(raw(root), '第二次 sync 整文件字节零变化').toBe(after);
      return after.slice(pos, after.length - tail.length);
    };
    const stopOf = () => hooksOf(root).Stop;

    // ① 单分组 Stop：局部 LF、只有顶层右花括号前一处 CRLF → 追加标准组后全文仍只有这一处 CRLF
    const userStop = { hooks: [AUDIT] };
    const lfBase = JSON.stringify({ hooks: { ...otherEvents, Stop: [userStop] }, language: 'chinese' }, null, 2);
    const farCrlf = `${lfBase.slice(0, -2)}\r\n}`;
    expect(crlfCount(farCrlf)).toBe(1);
    const stopClose = (s: string) => s.indexOf('\n    ]', s.indexOf('"Stop"'));
    const lfFrag = syncInsertedAt(farCrlf, stopClose(farCrlf));
    expect(lfFrag.startsWith(',\n      {'), '新分隔符用 LF').toBe(true);
    expect(lfFrag, '新增组内部不含 CR').not.toContain('\r');
    expect(crlfCount(raw(root)), '全文仍只有原来的一处 CRLF').toBe(1);
    expect(stopOf()).toEqual([userStop, { hooks: [entry(CLAUDE_STOP_CHECK_COMMAND)] }]);

    // ② 反向样例：局部 CRLF、只有顶层右花括号前一处 LF → 新增片段沿用 CRLF，孤立 LF 仍只有一处
    const farLf = `${lfBase.split('\n').join('\r\n').slice(0, -3)}\n}`;
    expect(loneLfCount(farLf)).toBe(1);
    const crlfFrag = syncInsertedAt(farLf, farLf.indexOf('\r\n    ]', farLf.indexOf('"Stop"')));
    expect(crlfFrag.startsWith(',\r\n      {'), '新分隔符用 CRLF').toBe(true);
    expect(loneLfCount(crlfFrag), '新增组内部不含孤立 LF').toBe(0);
    expect(loneLfCount(raw(root))).toBe(1);
    expect(count(stopOf(), CLAUDE_STOP_CHECK_COMMAND), '托管分组唯一').toBe(1);

    // ③ 三个用户分组 A、B、C：只有 A 与 B 之间的分隔用 CRLF，B 与 C 之间及 C 的各行用 LF
    const groupA = '{"hooks": [{"type": "command", "command": "echo A"}]}';
    const groupB = '{"hooks": [{"type": "command", "command": "echo B"}]}';
    const groupC = '{\n        "hooks": [\n          {"type": "command", "command": "echo C"}\n        ]\n      }';
    const otherText = JSON.stringify(otherEvents, null, 2).slice(1, -2).split('\n').join('\n  ');
    const abc = `{\n  "hooks": {${otherText},\n    "Stop": [\n      ${groupA},\r\n      ${groupB},\n      ${groupC}\n    ]\n  },\n  "language": "chinese"\n}\n`;
    expect(JSON.parse(abc)).toBeTruthy();
    const abcFrag = syncInsertedAt(abc, stopClose(abc));
    expect(abcFrag.startsWith(',\n      {'), 'C 后新增的分隔符用 LF，而非 A 与 B 之间的 CRLF').toBe(true);
    expect(abcFrag, '新增组内部各行用 LF').not.toContain('\r');
    expect(raw(root), 'A 与 B 之间原有的 CRLF 逐字节保留').toContain(`${groupA},\r\n      ${groupB},\n      ${groupC}`);
    expect(crlfCount(raw(root))).toBe(1);
    expect(stopOf().map(g => g.hooks[0].command)).toEqual(['echo A', 'echo B', 'echo C', CLAUDE_STOP_CHECK_COMMAND]);

    // ④ 顶层对象同样布局：前两个成员之间用 CRLF，其后用 LF → 补写 language 的分隔与成员用 LF
    const hooksText = JSON.stringify({ ...otherEvents, Stop: [{ hooks: [entry(CLAUDE_STOP_CHECK_COMMAND)] }] }, null, 2).split('\n').join('\n  ');
    const top = `{\n  "model": "sonnet",\r\n  "permissions": {"allow": ["Bash(ls)"]},\n  "hooks": ${hooksText}\n}\n`;
    const topFrag = syncInsertedAt(top, top.length - 3);
    expect(topFrag).toBe(',\n  "language": "chinese"');
    expect(crlfCount(raw(root))).toBe(1);
    expect((JSON.parse(raw(root)) as { language: string }).language).toBe('chinese');

    // ⑤ 首个成员 model 的冒号与值之间用 CRLF，其后成员与分隔均用 LF（code-r1 F1）：
    // 新增 language 的键值分隔取自相邻末项，不从首项复制 CRLF
    const colonCrlf = `{\n  "model":\r\n    "sonnet",\n  "permissions": {"allow": ["Bash(ls)"]},\n  "hooks": ${hooksText}\n}\n`;
    const colonFrag = syncInsertedAt(colonCrlf, colonCrlf.length - 3);
    expect(colonFrag, '新增 language 片段只用 LF').toBe(',\n  "language": "chinese"');
    expect(raw(root), '首项冒号后的 CRLF 逐字节保留').toContain('"model":\r\n    "sonnet",\n');
    expect(crlfCount(raw(root))).toBe(1);

    // ⑥ 展开的空容器自身含 LF、唯一 CRLF 在顶层右花括号前（code-r1 F2）：新增片段取括号之间的 LF
    const emptyStop = `${JSON.stringify({ hooks: { ...otherEvents, Stop: [] }, language: 'chinese' }, null, 2)
      .replace('"Stop": []', '"Stop": [\n    ]').slice(0, -2)}\r\n}`;
    expect(crlfCount(emptyStop)).toBe(1);
    writeFileSync(settingsPath(root), emptyStop);
    runSync(root);
    const stopFilled = raw(root);
    const arrStart = emptyStop.indexOf('"Stop": [') + '"Stop": '.length;
    const arrTail = emptyStop.slice(emptyStop.indexOf('\n    ]', arrStart) + '\n    ]'.length);
    expect(stopFilled.startsWith(emptyStop.slice(0, arrStart)), '空数组之前逐字节不变').toBe(true);
    expect(stopFilled.endsWith(arrTail), '空数组之后逐字节不变').toBe(true);
    expect(stopFilled.slice(arrStart, stopFilled.length - arrTail.length), '新数组内容只用 LF').not.toContain('\r');
    expect(crlfCount(stopFilled), '全文仍只有原来的一处 CRLF').toBe(1);
    expect(stopOf()).toEqual([{ hooks: [entry(CLAUDE_STOP_CHECK_COMMAND)] }]);
    runSync(root);
    expect(raw(root)).toBe(stopFilled);
    // 空 hooks 对象同理：括号之间为 LF，五个事件全部以 LF 注册
    const emptyHooks = '{\n  "hooks": {\n  },\n  "language": "chinese"\r\n}';
    writeFileSync(settingsPath(root), emptyHooks);
    runSync(root);
    const hooksFilled = raw(root);
    expect(crlfCount(hooksFilled), '空 hooks 对象填充后仍只有一处 CRLF').toBe(1);
    expect(hooksFilled.endsWith('"language": "chinese"\r\n}')).toBe(true);
    expectCurrentPostHooks(hooksOf(root));
    runSync(root);
    expect(raw(root)).toBe(hooksFilled);
  });

  it('ST-S08-44: 真实 CLI sync 端到端迁移', async () => {
    await initClaude(root);
    for (const preset of [hm01622(), hmExec()]) {
      writeHooks(root, preset);
      runSync(root);
      const hooks = hooksOf(root);
      expectCurrentPostHooks(hooks);
      for (const [event, command, args] of [['PostToolUse', CLAUDE_POST_CHECK_COMMAND, ['check']],
        ['PostToolUseFailure', CLAUDE_POST_CHECK_COMMAND, ['check']], ['Stop', CLAUDE_STOP_CHECK_COMMAND, ['check', '--stop']]] as const) {
        const input = POST_INPUT(root, event);
        expect(runRegistered(root, command, input), `${event} 注册命令可运行`).toBe(runEngineDirect(root, [...args], input));
      }
      const before = raw(root);
      runSync(root);
      expect(raw(root)).toBe(before);
    }
  });
});
