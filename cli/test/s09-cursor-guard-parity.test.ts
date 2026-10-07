/**
 * guard-versioned-content-scope [code] 切片 5（slice-05-cursor-parity）：Cursor 分层能力（C11）与保护范围变更审批（C14）。
 *
 * 覆盖 UT-S09-404～408、ST-S09-178、UT-S01-146、UT-S08-77、UT-S08-78、ST-S40-13
 * （UT-S09-297 / UT-S09-302 的 MODIFIED 断言见 cursor-hooks-runtime.test.ts，UT-S01-131 见 cursor-adapter.test.ts）。
 * 规范：spec/cursor-plugin.md §6～§8、spec/pretooluse-guard.md「Cursor hooks 部分强度门禁适配合同」与
 * 「版本控制内容保护与事后检查（规范性）」、spec/agents-md.md。
 * - UT 以函数层调用分发源 plugin-cursor/hooks/runtime.cjs 与 cli/src/lib/cursor-adapter.ts 的真实实现；
 *   runtime 在源码布局下经 plugin/bin/guard-post-check.cjs 调用事后检查引擎（与部署副本同一份字节）。
 * - ST 以真实 CLI（dist/index.js）init 部署的 .cursor/hooks/** 驱动，stdin JSON + cwd，命令真实执行。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureConsole, makeTempRoot, mockCwd } from './helpers.js';
import {
  ENGINE_SRC, REPO_ROOT, VECTOR_FILE, buildProject, callIsProtected, cleanEnv, git, loadGuardRegion, type FixtureKind,
} from './s09-guard-vcs-fixtures.js';
import {
  HOST_INPUTS, HOST_STATES, OTHER_HOSTS, OTHER_HOST_BASELINE_FILE, buildHostProject, runHost,
} from './s09-other-hosts-fixtures.js';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import {
  CURSOR_ENGINE_REL_FILE,
  CURSOR_GUARD_STRENGTH_NOTICE_ZH,
  CURSOR_HOOK_EVENTS,
  createCursorAgentsInstruction,
} from '../src/lib/cursor-adapter.js';

const require = createRequire(import.meta.url);
const RUNTIME_SRC = join(REPO_ROOT, 'plugin-cursor', 'hooks', 'runtime.cjs');
const TEMPLATE_HOOKS = join(REPO_ROOT, 'plugin-cursor', 'hooks', 'hooks.json');
const CLI = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const TIMEOUT = 180_000;

interface RunResult { output: Record<string, unknown>; exitCode: number }
interface CursorRuntime {
  run: (mode: string, raw: string, cwd: string, opts?: { askPolicy?: string; platform?: string }) => RunResult;
  isProtectedPath: (root: string, p: string) => { mode: string; protected: boolean; step: number | string; reason: string };
  callKey: (event: Record<string, unknown>) => string | null;
  PATH_WHITELIST_PREFIXES: string[];
  GUARD_STRENGTH_LINE: string;
  EDIT_NOT_BLOCKED_LINE: string;
  SHELL_NOT_BLOCKED_LINE: string;
  CURSOR_ASK_POLICY: string;
  GENERATION_KEY_VERIFIED: boolean;
}
const runtime = require(RUNTIME_SRC) as CursorRuntime;

/** 「Cursor IDE 获得完整 preToolUse 硬拦」及同义表述（把 Cursor 表述为事前编辑硬拦 / 与 claude-code 等价）。 */
const FORBIDDEN_CLAIM = /获得完整\s*preToolUse\s*硬拦|完整\s*preToolUse\s*硬拦|Full pre-edit blocking|full preToolUse blocking|IDE gets full|beforeShellExecution 硬拦|hard-blocks shell writes|cursor-agent CLI has no preToolUse/i;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return root;
}

const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

function treeSnapshot(dir: string, skip: (rel: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string, prefix: string) => {
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs).sort()) {
      const rel = prefix ? `${prefix}/${name}` : name;
      if (skip(rel)) continue;
      const full = join(abs, name);
      if (statSync(full).isDirectory()) walk(full, rel);
      else out[rel] = readFileSync(full).toString('base64');
    }
  };
  walk(dir, '');
  return out;
}

function shellEvent(root: string, command: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ hook_event_name: 'beforeShellExecution', command, cwd: root, ...extra });
}
function afterEvent(root: string, command: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ hook_event_name: 'afterShellExecution', command, cwd: root, output: '', duration: 1, ...extra });
}
function recordsDir(root: string) {
  return join(root, 'logos', '.openlogos-runtime', 'guard-records');
}
function recordFiles(root: string, suffix = '.json'): string[] {
  try { return readdirSync(recordsDir(root)).filter(n => n.endsWith(suffix) && !n.includes('.tmp-')).sort(); } catch { return []; }
}
/** 真实执行 shell 命令（模拟宿主在 before / after 之间执行）。 */
function execShell(root: string, command: string) {
  const r = spawnSync('bash', ['-c', command], { cwd: root, encoding: 'utf-8', env: cleanEnv(), timeout: 60_000 });
  expect(r.status, `${command}\n${r.stderr}`).toBe(0);
}

/** 夹具口径断言：G-* 须在 git 工作树内且无 guard 文件（口径不成立判 FAIL）。 */
function gFixture(kind: FixtureKind): string {
  const root = buildProject(tempRoot(), kind);
  expect(git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim(), `${kind} 应在 git 工作树内`).toBe('true');
  expect(existsSync(join(root, 'logos/.openlogos-guard')), `${kind} 不应有活跃提案`).toBe(false);
  return root;
}

describe('S09 Cursor 分层能力（guard-versioned-content-scope C11 / C14）', () => {
  it('UT-S09-404: Cursor 与 Claude 对共享测试向量的「是否受保护」结论逐条相同；runtime 规则表不含 .gitignore 白名单项', () => {
    const regionDir = tempRoot();
    const { file } = loadGuardRegion(regionDir);
    const vectors = (JSON.parse(readFileSync(VECTOR_FILE, 'utf-8')) as {
      vectors: Array<{ fixture: FixtureKind; path: string; protected: boolean; step: number }>;
    }).vectors;
    const roots = new Map<FixtureKind, string>();
    const outside = tempRoot();
    for (const v of vectors) {
      if (!roots.has(v.fixture)) roots.set(v.fixture, gFixture(v.fixture));
      const root = roots.get(v.fixture)!;
      const p = v.path.replace('<OUTSIDE>', outside);
      const claude = callIsProtected(file, root, p);
      const cursor = runtime.isProtectedPath(root, p);
      expect(cursor.mode, `${v.path}：Cursor 应处于 git 判据`).toBe('git');
      expect(cursor.protected, `${v.fixture} ${v.path}：Cursor ↔ Claude（${cursor.reason} / ${claude.reason}）`).toBe(claude.protected);
      expect([cursor.protected, String(cursor.step)], `${v.fixture} ${v.path}：Cursor ↔ 向量`).toEqual([v.protected, String(v.step)]);
      if (!p.startsWith('/')) {
        const abs = runtime.isProtectedPath(root, join(root, p));
        expect(abs.protected, `${v.fixture} 绝对 ${v.path}`).toBe(claude.protected);
      }
    }
    expect(runtime.PATH_WHITELIST_PREFIXES).not.toContain('.gitignore');
    expect(runtime.PATH_WHITELIST_PREFIXES.some(prefix => prefix.includes('gitignore'))).toBe(false);
  }, TIMEOUT);

  it('UT-S09-405: CURSOR_HOOK_EVENTS、模板 hooks.json 与托管文案——含 afterShellExecution，无「IDE 完整 preToolUse 硬拦」表述', () => {
    expect(CURSOR_HOOK_EVENTS).toContain('afterShellExecution');
    expect([...CURSOR_HOOK_EVENTS]).toEqual(['sessionStart', 'beforeShellExecution', 'afterShellExecution', 'afterFileEdit']);
    const template = JSON.parse(readFileSync(TEMPLATE_HOOKS, 'utf-8')) as { hooks: Record<string, unknown> };
    expect(template.hooks.afterShellExecution).toEqual([{ type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs shell-after' }]);
    expect(Object.keys(template.hooks).sort()).toEqual([...CURSOR_HOOK_EVENTS].sort());
    expect(Object.keys(template.hooks)).not.toContain('preToolUse');
    // 托管文案（cursor-adapter 生成的 AGENTS 指令段、CLI 提示行）与 runtime 固定声明
    const managed = [
      createCursorAgentsInstruction('zh', 'launched'), createCursorAgentsInstruction('en', 'initial'),
      CURSOR_GUARD_STRENGTH_NOTICE_ZH, runtime.GUARD_STRENGTH_LINE, runtime.EDIT_NOT_BLOCKED_LINE,
    ];
    for (const text of managed) {
      expect(text, text).not.toMatch(FORBIDDEN_CLAIM);
      expect(text, text).toContain('afterFileEdit');
    }
    expect(createCursorAgentsInstruction('zh', 'launched')).toContain('文件编辑经 afterFileEdit 事后报告');
    expect(createCursorAgentsInstruction('zh', 'launched')).toContain('afterShellExecution 事后检查');
    expect(CURSOR_GUARD_STRENGTH_NOTICE_ZH).toContain('only reported after the fact via afterFileEdit');
    expect(runtime.GUARD_STRENGTH_LINE).toContain('文件编辑经 afterFileEdit 事后报告');
    // 规范文本：旧表述只允许出现在「已撤销 / 不得 / 禁止」语境
    for (const spec of ['spec/cursor-plugin.md', 'spec/pretooluse-guard.md', 'spec/agents-md.md']) {
      const lines = readFileSync(join(REPO_ROOT, spec), 'utf-8').split('\n');
      for (const line of lines.filter(l => /获得完整\s*`?preToolUse`?\s*硬拦/.test(l))) {
        expect(line, `${spec} 只能以撤销 / 禁止语境提及旧表述`).toMatch(/撤销|不得|禁止/);
      }
      const table = lines.find(l => l.startsWith('| `preToolUse` |'));
      if (spec === 'spec/pretooluse-guard.md') expect(table).toContain('**未接入**');
    }
  });

  it('UT-S09-406: Cursor 受限命令返回 permission ask；list 放行；注入「不能保证弹出审批」实测结论后 deny', () => {
    const root = gFixture('G-repo');
    const config = readFileSync(join(root, 'logos/logos.config.json'));
    expect(runtime.CURSOR_ASK_POLICY).toBe('ask');
    for (const command of ['openlogos exempt add src/', 'openlogos ignore remove dist/', `cd ${root} && openlogos exempt remove docs/`]) {
      const r = runtime.run('shell', shellEvent(root, command), root);
      expect([r.output.permission, r.exitCode], command).toEqual(['ask', 0]);
      expect(r.output.user_message, command).toContain(command);
      expect(r.output.agent_message, command).toContain('需用户在宿主审批中确认');
    }
    const list = runtime.run('shell', shellEvent(root, 'openlogos exempt list'), root);
    expect([list.output.permission, list.exitCode]).toEqual(['allow', 0]);
    // 复合形态一律 deny
    const compound = runtime.run('shell', shellEvent(root, 'openlogos exempt add src/ && node x.js'), root);
    expect([compound.output.permission, compound.exitCode]).toEqual(['deny', 2]);
    // 注入实测结论（自动运行等模式不能保证弹出审批）→ deny：函数层注入与环境变量注入两种
    const injected = runtime.run('shell', shellEvent(root, 'openlogos exempt add src/'), root, { askPolicy: 'deny' });
    expect([injected.output.permission, injected.exitCode]).toEqual(['deny', 2]);
    expect(injected.output.user_message).toContain('openlogos exempt add src/');
    expect(injected.output.user_message).toContain('不能保证');
    const spawned = spawnSync(process.execPath, [RUNTIME_SRC, 'shell'], {
      cwd: root, input: shellEvent(root, 'openlogos exempt add src/'), encoding: 'utf-8',
      env: cleanEnv({ OPENLOGOS_CURSOR_ASK_POLICY: 'deny' }),
    });
    expect(spawned.status).toBe(2);
    expect(JSON.parse(spawned.stdout.trim()).permission).toBe('deny');
    // 注入只能收紧：未知取值不放宽为 allow
    const loose = spawnSync(process.execPath, [RUNTIME_SRC, 'shell'], {
      cwd: root, input: shellEvent(root, 'openlogos exempt add src/'), encoding: 'utf-8',
      env: cleanEnv({ OPENLOGOS_CURSOR_ASK_POLICY: 'allow' }),
    });
    expect(JSON.parse(loose.stdout.trim()).permission).toBe('ask');
    expect(readFileSync(join(root, 'logos/logos.config.json')).equals(config)).toBe(true);
  }, TIMEOUT);

  it('UT-S09-407: qoder / workbuddy / zcode 结论与修改前实测基准逐条相同，且未接入事后检查引擎', () => {
    const baseline = JSON.parse(readFileSync(OTHER_HOST_BASELINE_FILE, 'utf-8')) as {
      cases: Array<{ host: string; state: string; key: string; exit: number; stdout: string }>;
    };
    const expected = new Map(baseline.cases.map(c => [`${c.host}|${c.state}|${c.key}`, c]));
    expect(expected.size).toBe(Object.keys(OTHER_HOSTS).length * HOST_STATES.length * HOST_INPUTS.length);
    for (const state of HOST_STATES) {
      const root = buildHostProject(tempRoot(), state);
      for (const [host, rel] of Object.entries(OTHER_HOSTS)) {
        for (const item of HOST_INPUTS) {
          const got = runHost(join(REPO_ROOT, rel), root, item);
          const want = expected.get(`${host}|${state}|${item.key}`)!;
          expect(want, `${host}|${state}|${item.key} 基准缺失`).toBeDefined();
          expect({ exit: got.exit, stdout: got.stdout }, `${host}|${state}|${item.key}`).toEqual({ exit: want.exit, stdout: want.stdout });
        }
      }
      // 三宿主不调用事后检查引擎：不建立执行记录
      expect(existsSync(recordsDir(root)), `${state}：不应生成 guard-records/`).toBe(false);
    }
    for (const rel of Object.values(OTHER_HOSTS)) {
      const source = readFileSync(join(REPO_ROOT, rel), 'utf-8');
      expect(source, rel).not.toMatch(/guard-post-check|openlogos-guard-post/);
    }
  }, TIMEOUT);

  describe('UT-S09-408: Cursor shell-after 模式与快照关联', () => {
    const write = (file: string, content: string) => `node -e "require('fs').writeFileSync('${file}','${content}')"`;

    it('UT-S09-408: 有可靠调用标识——before 调引擎 snapshot、after 调 check 并关闭同一记录（墓碑）', () => {
      const root = gFixture('G-repo');
      const command = write('src/a.js', 'y');
      const before = runtime.run('shell', shellEvent(root, command, { tool_use_id: 't1', generation_id: 'g1' }), root);
      expect([before.output.permission, before.exitCode]).toEqual(['allow', 0]);
      expect(recordFiles(root)).toEqual(['cursor-t1.json']);
      const record = JSON.parse(readFileSync(join(recordsDir(root), 'cursor-t1.json'), 'utf-8'));
      expect([record.anonymous, record.host, record.command]).toEqual([false, 'cursor', command]);
      execShell(root, command);
      const after = runtime.run('shell-after', afterEvent(root, command, { tool_use_id: 't1', generation_id: 'g1' }), root);
      expect(after.exitCode).toBe(0);
      const report = after.output.agent_message as string;
      expect(report).toContain('src/a.js');
      expect(report).toContain('归因：本次调用');
      expect(report).toContain('node ".cursor/hooks/openlogos-guard-post.cjs" restore cursor-t1 -- src/a.js');
      expect(report).toContain(runtime.SHELL_NOT_BLOCKED_LINE);
      expect(recordFiles(root)).toEqual([]);
      expect(recordFiles(root, '.closed')).toEqual(['cursor-t1.closed']);
      // 迟到的同标识结束事件：墓碑在场，不复活、不重复报告
      const late = runtime.run('shell-after', afterEvent(root, command, { tool_use_id: 't1' }), root);
      expect(late.output).toEqual({});
      expect(recordFiles(root)).toEqual([]);
    }, TIMEOUT);

    it('UT-S09-408: 无可靠标识（仅 generation_id）——建匿名记录，after 只对比不关闭', () => {
      const root = gFixture('G-repo');
      expect(runtime.GENERATION_KEY_VERIFIED).toBe(false);
      expect(runtime.callKey({ generationId: 'g1', command: 'x' })).toBeNull();
      const command = write('src/b.js', 'z');
      const before = runtime.run('shell', shellEvent(root, command, { generation_id: 'g1', conversation_id: 'c1' }), root);
      expect(before.output.permission).toBe('allow');
      const records = recordFiles(root);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatch(/^anon-\d+-[a-z0-9]+\.json$/);
      const record = JSON.parse(readFileSync(join(recordsDir(root), records[0]), 'utf-8'));
      expect([record.anonymous, record.session_id]).toEqual([true, 'c1']);
      execShell(root, command);
      const after = runtime.run('shell-after', afterEvent(root, command, { generation_id: 'g1', conversation_id: 'c1' }), root);
      const report = after.output.agent_message as string;
      expect(report).toContain('src/b.js');
      expect(report).toContain('无法唯一归因');
      expect(recordFiles(root)).toEqual(records);
      expect(recordFiles(root, '.closed')).toEqual([]);
    }, TIMEOUT);

    it('UT-S09-408: 两次并发 before 后到达一个 after——按标识关联，不按「最近一次」猜测', () => {
      const root = gFixture('G-repo');
      const c1 = write('src/a.js', 'one');
      const c2 = write('src/b.js', 'two');
      expect(runtime.run('shell', shellEvent(root, c1, { tool_use_id: 'c1' }), root).output.permission).toBe('allow');
      expect(runtime.run('shell', shellEvent(root, c2, { tool_use_id: 'c2' }), root).output.permission).toBe('allow');
      expect(recordFiles(root)).toEqual(['cursor-c1.json', 'cursor-c2.json']);
      // 无标识的结束事件：只对比、不关闭任何记录（不把最近一次 c2 当作关联对象）
      runtime.run('shell-after', afterEvent(root, c2), root);
      expect(recordFiles(root)).toEqual(['cursor-c1.json', 'cursor-c2.json']);
      // 先完成的是 c1（早建立的记录）：按标识关闭 c1，c2 保持打开
      runtime.run('shell-after', afterEvent(root, c1, { tool_use_id: 'c1' }), root);
      expect(recordFiles(root)).toEqual(['cursor-c2.json']);
      expect(recordFiles(root, '.closed')).toEqual(['cursor-c1.closed']);
    }, TIMEOUT);
  });

  it('ST-S09-178: Cursor afterShellExecution 事后检查与 ask（真实 init 部署的 hooks 与引擎）', () => {
    const root = tempRoot();
    const initRun = spawnSync(process.execPath, [CLI, 'init', 'demo', '--ai-tool', 'cursor', '--locale', 'zh'], {
      cwd: root, encoding: 'utf-8', env: cleanEnv(), timeout: 120_000,
    });
    expect(initRun.status, initRun.stderr).toBe(0);
    // G-repo 口径：launched、无 guard、git 工作树、已跟踪 src/a.js、运行时目录与构建产物被忽略
    writeFileSync(join(root, 'logos/logos-project.yaml'),
      readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8').replace('lifecycle: initial', 'lifecycle: launched'));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/a.js'), 'a\n');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\ndist/\nlogos/.openlogos-runtime/\n');
    writeFileSync(join(root, 'package.json'), `${JSON.stringify({
      name: 'g', version: '1.0.0', private: true,
      scripts: { 'release:local': "node -e \"require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/app.txt','x')\"" },
    }, null, 2)}\n`);
    for (const args of [['init', '-q'], ['config', 'user.name', 'openlogos-test'], ['config', 'user.email', 'openlogos-test@example.invalid'],
      ['config', 'commit.gpgsign', 'false'], ['add', '-A'], ['commit', '-qm', 'init']]) {
      expect(git(root, args).status, `git ${args.join(' ')}`).toBe(0);
    }
    expect(git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim()).toBe('true');
    expect(existsSync(join(root, 'logos/.openlogos-guard'))).toBe(false);
    const hook = (mode: string, input: string) => {
      const r = spawnSync(process.execPath, ['.cursor/hooks/openlogos-runtime.cjs', mode], {
        cwd: root, input, encoding: 'utf-8', env: cleanEnv(), timeout: 120_000,
      });
      return { status: r.status, output: JSON.parse((r.stdout ?? '').trim() || '{}') as Record<string, string>, stderr: r.stderr };
    };

    // ① 部署事实：hooks.json 含 afterShellExecution；引擎副本与包内唯一源 SHA-256 相同
    const hooks = JSON.parse(readFileSync(join(root, '.cursor/hooks.json'), 'utf-8')) as { hooks: Record<string, Array<{ command: string }>> };
    expect(hooks.hooks.afterShellExecution.map(e => e.command)).toContain('node .cursor/hooks/openlogos-runtime.cjs shell-after');
    expect(sha256(join(root, CURSOR_ENGINE_REL_FILE))).toBe(sha256(ENGINE_SRC));

    // ② before（含调用标识）→ 真实执行 node -e 改 src/a.js → after 报告 src/a.js
    const modify = "node -e \"require('fs').writeFileSync('src/a.js','mutated')\"";
    const b2 = hook('shell', shellEvent(root, modify, { tool_use_id: 'st178-2', generation_id: 'g2' }));
    expect([b2.status, b2.output.permission]).toEqual([0, 'allow']);
    execShell(root, modify);
    const a2 = hook('shell-after', afterEvent(root, modify, { tool_use_id: 'st178-2', generation_id: 'g2' }));
    expect(a2.status).toBe(0);
    expect(a2.output.agent_message).toContain('src/a.js（内容变化）');
    expect(a2.output.agent_message).toContain(runtime.SHELL_NOT_BLOCKED_LINE);
    expect(a2.output.agent_message).toContain('node ".cursor/hooks/openlogos-guard-post.cjs" restore cursor-st178-2 -- src/a.js');
    expect(readFileSync(join(root, '.cursor/openlogos-guard-reports.log'), 'utf-8')).toContain('src/a.js');
    expect(existsSync(join(recordsDir(root), 'cursor-st178-2.closed'))).toBe(true);
    // 恢复后基线一致，后续检查不重复报告
    execShell(root, 'node .cursor/hooks/openlogos-guard-post.cjs restore cursor-st178-2 -- src/a.js');
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe('a\n');

    // ③ npm run release:local（只写被忽略的 dist/）→ after 不报告
    const release = 'npm run release:local';
    const b3 = hook('shell', shellEvent(root, release, { tool_use_id: 'st178-3' }));
    expect([b3.status, b3.output.permission]).toEqual([0, 'allow']);
    execShell(root, release);
    expect(existsSync(join(root, 'dist/app.txt'))).toBe(true);
    const a3 = hook('shell-after', afterEvent(root, release, { tool_use_id: 'st178-3' }));
    expect([a3.status, a3.output]).toEqual([0, {}]);

    // ④ 受限命令 → permission ask
    const b4 = hook('shell', shellEvent(root, 'openlogos exempt add src/'));
    expect([b4.status, b4.output.permission]).toEqual([0, 'ask']);
    expect(b4.output.user_message).toContain('openlogos exempt add src/');

    // ⑤ 宿主原生编辑后 afterFileEdit：报告声明未被阻断、仅事后报告
    writeFileSync(join(root, 'src/a.js'), 'edited by host\n');
    const e5 = hook('edit', JSON.stringify({ hook_event_name: 'afterFileEdit', file_path: 'src/a.js', cwd: root }));
    expect(e5.status).toBe(0);
    expect(e5.output.agent_message).toContain('src/a.js');
    expect(e5.output.agent_message).toContain('未被阻断（Cursor 文件编辑仅经 afterFileEdit 事后报告');
    expect(e5.output.agent_message).not.toMatch(FORBIDDEN_CLAIM);
  }, TIMEOUT);
});

describe('S01 / S08 Cursor 部署：afterShellExecution 与能力声明更正', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let consoleCapture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    restoreCwd = mockCwd(root);
    consoleCapture = captureConsole();
    process.env.OPENLOGOS_CODEX_PERSONAL_HOME = join(root, '.test-codex-home');
  });

  afterEach(() => {
    delete process.env.OPENLOGOS_CODEX_PERSONAL_HOME;
    consoleCapture.restore();
    restoreCwd();
    cleanup();
  });

  const userAfterShell = { type: 'command', command: './my-after-shell.sh', note: 'user' };

  it('UT-S01-146: init 部署 afterShellExecution 托管条目与引擎副本，提示行与托管指令不含 IDE 完整 preToolUse 硬拦', async () => {
    mkdirSync(join(root, '.cursor'), { recursive: true });
    writeFileSync(join(root, '.cursor/hooks.json'), `${JSON.stringify({
      version: 1, userField: { keep: true }, hooks: { afterShellExecution: [userAfterShell], stop: [{ type: 'command', command: './stop.sh' }] },
    }, null, 2)}\n`);
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    expect([...CURSOR_HOOK_EVENTS]).toContain('afterShellExecution');
    const template = JSON.parse(readFileSync(TEMPLATE_HOOKS, 'utf-8')) as { hooks: Record<string, unknown> };
    expect(new Set(Object.keys(template.hooks))).toEqual(new Set(CURSOR_HOOK_EVENTS));
    const hooks = JSON.parse(readFileSync(join(root, '.cursor/hooks.json'), 'utf-8'));
    expect(hooks.hooks.afterShellExecution).toEqual([
      userAfterShell, { type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs shell-after' },
    ]);
    expect(hooks.hooks.stop).toEqual([{ type: 'command', command: './stop.sh' }]);
    expect(hooks.userField).toEqual({ keep: true });
    expect(readFileSync(join(root, CURSOR_ENGINE_REL_FILE)).equals(readFileSync(ENGINE_SRC))).toBe(true);
    const output = consoleCapture.logs.join('\n');
    expect(output).toContain(CURSOR_GUARD_STRENGTH_NOTICE_ZH);
    expect(output).toContain('afterShellExecution');
    expect(output).not.toMatch(FORBIDDEN_CLAIM);
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('文件编辑经 afterFileEdit 事后报告');
    expect(agents).not.toMatch(FORBIDDEN_CLAIM);
    expect(CURSOR_GUARD_STRENGTH_NOTICE_ZH).toContain('afterFileEdit');
  });

  it('UT-S08-77: 存量三事件 hooks.json 经 sync 补齐 afterShellExecution；用户条目与未知字段字节不变；二次 sync 零 diff；不可解析零写入', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    // 构造存量：只有三事件的旧托管条目 + 用户自有 afterShellExecution 条目 + 未知字段；引擎副本缺失
    const legacy = {
      version: 1,
      unknownTop: [1, 2, 3],
      hooks: {
        sessionStart: [{ type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs session' }],
        beforeShellExecution: [{ type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs shell' }],
        afterFileEdit: [{ type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs edit' }],
        afterShellExecution: [userAfterShell],
      },
    };
    writeFileSync(join(root, '.cursor/hooks.json'), `${JSON.stringify(legacy, null, 2)}\n`);
    rmSync(join(root, CURSOR_ENGINE_REL_FILE), { force: true });
    sync();
    const hooks = JSON.parse(readFileSync(join(root, '.cursor/hooks.json'), 'utf-8'));
    expect(hooks.hooks.afterShellExecution).toEqual([
      userAfterShell, { type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs shell-after' },
    ]);
    expect(hooks.unknownTop).toEqual([1, 2, 3]);
    expect(JSON.stringify(hooks.hooks.afterShellExecution[0])).toBe(JSON.stringify(userAfterShell));
    expect(readFileSync(join(root, CURSOR_ENGINE_REL_FILE)).equals(readFileSync(ENGINE_SRC))).toBe(true);
    // 引擎漂移由 sync 刷新
    writeFileSync(join(root, CURSOR_ENGINE_REL_FILE), '// drifted\n');
    sync();
    expect(sha256(join(root, CURSOR_ENGINE_REL_FILE))).toBe(sha256(ENGINE_SRC));
    // 第二次 sync 零 diff
    const first = treeSnapshot(join(root, '.cursor'));
    sync();
    expect(treeSnapshot(join(root, '.cursor'))).toEqual(first);
    // hooks.json 不可解析：fail loud 零写入并回滚（引擎副本缺失也不被半写）
    writeFileSync(join(root, '.cursor/hooks.json'), '{ broken');
    rmSync(join(root, CURSOR_ENGINE_REL_FILE), { force: true });
    const broken = treeSnapshot(join(root, '.cursor'));
    expect(() => sync()).toThrow(/hooks\.json 无法解析/);
    expect(treeSnapshot(join(root, '.cursor'))).toEqual(broken);
  });

  it('UT-S08-78: 存量托管片段含旧文案「Cursor IDE 经同一 .cursor/hooks.json 获得完整 preToolUse 硬拦」→ sync 后更正，片段外用户内容不变', async () => {
    await init('demo', { locale: 'zh', aiTool: 'cursor' });
    const agentsPath = join(root, 'AGENTS.md');
    const oldLine = 'Cursor IDE 经同一 .cursor/hooks.json 获得完整 preToolUse 硬拦。';
    const userBefore = '# 团队约定（用户内容）\n\n保留我。\n\n';
    const userAfter = '\n\n## 用户附录\n\n也保留我。\n';
    const current = readFileSync(agentsPath, 'utf-8');
    const begin = current.indexOf('<!-- OPENLOGOS:BEGIN -->');
    const end = current.indexOf('<!-- OPENLOGOS:END -->') + '<!-- OPENLOGOS:END -->'.length;
    expect(begin).toBeGreaterThanOrEqual(0);
    const block = current.slice(begin, end).replace('## Cursor 宿主指令\n', `## Cursor 宿主指令\n${oldLine}\n`);
    expect(block).toContain(oldLine);
    writeFileSync(agentsPath, `${userBefore}${block}${userAfter}`);
    sync();
    const after = readFileSync(agentsPath, 'utf-8');
    const managed = after.slice(after.indexOf('<!-- OPENLOGOS:BEGIN -->'), after.indexOf('<!-- OPENLOGOS:END -->'));
    expect(managed).not.toMatch(FORBIDDEN_CLAIM);
    expect(managed).toContain('文件编辑经 afterFileEdit 事后报告');
    expect(managed).toContain('shell 命令经 beforeShellExecution 事前轻判');
    expect(managed).toContain('afterShellExecution 事后检查');
    expect(CURSOR_GUARD_STRENGTH_NOTICE_ZH).not.toMatch(FORBIDDEN_CLAIM);
    expect(after.startsWith(userBefore)).toBe(true);
    expect(after.endsWith(userAfter)).toBe(true);
  });
});

describe('S40 保护范围变更：Cursor 宿主审批', () => {
  it('ST-S40-13: 按 S08 部署的 Cursor hooks 对受限命令返回 permission ask（与 spec/cursor-plugin.md 当前声明一致），list 不返回 ask，guard 不写任何文件', () => {
    const root = tempRoot();
    const initRun = spawnSync(process.execPath, [CLI, 'init', 'demo', '--ai-tool', 'cursor', '--locale', 'zh'], {
      cwd: root, encoding: 'utf-8', env: cleanEnv(), timeout: 120_000,
    });
    expect(initRun.status, initRun.stderr).toBe(0);
    const syncRun = spawnSync(process.execPath, [CLI, 'sync'], { cwd: root, encoding: 'utf-8', env: cleanEnv(), timeout: 120_000 });
    expect(syncRun.status, syncRun.stderr).toBe(0);
    // spec/cursor-plugin.md §8：实测能保证弹出审批的模式返回 ask；当前声明未记录逐模式「不能保证」结论 → ask
    const spec = readFileSync(join(REPO_ROOT, 'spec/cursor-plugin.md'), 'utf-8');
    expect(spec).toContain('`beforeShellExecution` 返回 `{"permission": "ask", "user_message": "...", "agent_message": "..."}`');
    const before = treeSnapshot(root);
    const hook = (command: string) => {
      const r = spawnSync(process.execPath, ['.cursor/hooks/openlogos-runtime.cjs', 'shell'], {
        cwd: root, input: shellEvent(root, command, { conversation_id: 'c', generation_id: 'g' }), encoding: 'utf-8', env: cleanEnv(),
      });
      return { status: r.status, output: JSON.parse((r.stdout ?? '').trim()) as Record<string, string> };
    };
    const ask = hook('openlogos exempt add src/');
    expect(ask.status).toBe(0);
    expect(Object.keys(ask.output).sort()).toEqual(['agent_message', 'permission', 'user_message']);
    expect(ask.output.permission).toBe('ask');
    expect(ask.output.user_message).toContain('openlogos exempt add src/');
    expect(ask.output.agent_message.length).toBeGreaterThan(0);
    const list = hook('openlogos exempt list');
    expect(list.status).toBe(0);
    expect(list.output.permission).not.toBe('ask');
    expect(list.output.permission).toBe('allow');
    expect(treeSnapshot(root)).toEqual(before);
  }, TIMEOUT);
});
