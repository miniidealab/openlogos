/**
 * fix-guard-background-record-never-closed [code] 切片 2：超期关闭与 SessionStart 会话标识转发
 * （spec/pretooluse-guard.md「执行记录生命周期（C12）」关闭条件 5、「Claude Code hook 注册与引擎分发」会话输入转发；
 * S09-F Step 29、Step 65、EX-9F.42～46；AC-GUARD-VCS-29）。
 *
 * 覆盖 UT-S09-484、UT-S09-485；ST-S09-213、ST-S09-214、ST-S09-215、ST-S09-216
 * （与 logos/resources/test/core-S09-test-cases.md 对齐）。
 * - 记录年龄一律由引擎的可注入时钟（OPENLOGOS_GUARD_NOW_NS）与同一组时间常量构造，不依赖 sleep，也不改写文件时间。
 *   预置的存量记录以分发源导出的真实 saveRecord 写入，基线取自一次真实快照。
 * - UT 在函数层调用分发源 plugin/bin/guard-post-check.cjs 导出的真实实现，并以 stdin JSON 调用其子命令观察磁盘事实。
 * - ST-S09-214、ST-S09-216 从真实注册的 SessionStart 入口 plugin/bin/openlogos-phase 的 stdin 送入按采集到的真实
 *   SessionStart 输入构造的 JSON，不直接向引擎构造带标识的输入。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { makeTempRoot } from './helpers.js';
import { REPO_ROOT, buildProject, cleanEnv, git } from './s09-guard-vcs-fixtures.js';
import {
  RUNTIME, bash, deployEngine, engine, engineCli, nextId, preToolUse, readJsonl, readRecord, records, snapshot,
  type HookRun,
} from './s09-guard-post-check-helpers.js';

const TIMEOUT = 240_000;
const PHASE = join(REPO_ROOT, 'plugin', 'bin', 'openlogos-phase');
const CAPTURE = JSON.parse(readFileSync(join(REPO_ROOT, 'cli/test/fixtures/s09-claude-stop-background-tasks.json'), 'utf-8')) as {
  post_tool_use_background: Record<string, unknown> & { tool_response: Record<string, unknown> };
  stop_with_task_in_flight: Record<string, unknown>;
  session_start: Record<string, unknown>;
};

const SEC = 1000;
const HOUR = 3600 * SEC;
const DAY = 24 * HOUR;
/** 固定的「当前时间」基准；全部记录年龄相对它构造。 */
const T0 = Date.parse('2026-10-20T08:00:00.000Z');
const clock = (ms: number): Record<string, string> => ({ OPENLOGOS_GUARD_NOW_NS: (BigInt(ms) * 1000000n).toString() });
const iso = (ms: number) => new Date(ms).toISOString();

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return root;
}

function fixture(): string {
  const root = buildProject(tempRoot(), 'G-repo');
  expect(git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim(), 'G-repo 应在 git 工作树内').toBe('true');
  expect(existsSync(join(root, 'logos/.openlogos-guard')), 'G-repo 不应有活跃提案').toBe(false);
  deployEngine(root);
  return root;
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitFor(cond: () => boolean, label: string, ms = 20_000): void {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`等待超时：${label}`);
    sleep(50);
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const recDir = (root: string) => join(root, RUNTIME, 'guard-records');
const recFile = (root: string, id: string) => existsSync(join(recDir(root), `${id}.json`));
const tomb = (root: string, id: string) => existsSync(join(recDir(root), `${id}.closed`));
const tombs = (root: string) => (existsSync(recDir(root)) ? readdirSync(recDir(root)).filter(n => n.endsWith('.closed')) : []);

function reasonOf(r: HookRun, label: string): string {
  expect(r.exitCode, `${label}：${r.stderr}`).toBe(2);
  const reason = (JSON.parse(r.stdout) as { reason: string }).reason;
  expect(r.stderr.trim(), `${label} stderr 与 stdout 同文本`).toBe(reason.trim());
  return reason;
}

function quiet(r: HookRun, label: string): void {
  expect(r.exitCode, `${label}：${r.stderr}${r.stdout}`).toBe(0);
  expect(r.stdout, label).toBe('');
}

/** 以采集到的真实输入为模板，替换会话与路径（session 为 null 时删除 session_id）。 */
function based(template: Record<string, unknown>, root: string, session: string | null): Record<string, unknown> {
  const o = clone(template);
  o.cwd = root;
  o.transcript_path = join(root, '.t.jsonl');
  if (session === null) delete o.session_id; else o.session_id = session;
  return o;
}

type Kind = 'pre' | 'post' | 'post-failure' | 'stop' | 'session-start';
const KINDS: Kind[] = ['pre', 'post', 'post-failure', 'stop', 'session-start'];

/** 在给定会话与时钟下触发一个持锁检查点（Stop 不带 background_tasks，等价于宿主任务登记表不可达）。 */
function checkpoint(root: string, kind: Kind, session: string | null, nowMs: number): HookRun {
  const env = clock(nowMs);
  if (kind === 'pre') {
    const extra: Record<string, unknown> = session === null ? { session_id: undefined } : { session_id: session };
    return preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId(), extra, env);
  }
  if (kind === 'stop') {
    const o = based(CAPTURE.stop_with_task_in_flight, root, session);
    delete o.background_tasks;
    return engineCli(root, ['check', '--stop'], JSON.stringify(o), env);
  }
  if (kind === 'session-start') {
    return engineCli(root, ['check', '--session-start'], JSON.stringify(based(CAPTURE.session_start, root, session)), env);
  }
  const o = based(CAPTURE.post_tool_use_background, root, session);
  o.tool_use_id = nextId();
  o.tool_input = { command: 'ls' };
  if (kind === 'post-failure') {
    o.hook_event_name = 'PostToolUseFailure';
    delete o.tool_response;
    o.error = 'Command failed';
  } else {
    o.tool_response = { stdout: '', stderr: '', interrupted: false };
  }
  return engineCli(root, ['check'], JSON.stringify(o), env);
}

/** 一次真实快照得到的记录模板（基线 = 项目当前状态），随后移除，供预置存量记录使用。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function template(root: string): any {
  expect(snapshot(root, 'node tpl.js', 'TPL', true, clock(T0)).exitCode).toBe(0);
  const rec = readRecord(root, 'TPL');
  expect(rec).toMatchObject({ background: true, created_at: iso(T0), closed: false });
  rmSync(join(recDir(root), 'TPL.json'));
  return rec;
}

interface Preset { id: string; session: string | null; ageMs: number; taskId?: string | null; anonymous?: boolean; command?: string }

/** 以分发源的真实 saveRecord 预置一条后台记录；created_at = now - age。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function preset(root: string, tpl: any, p: Preset, nowMs = T0): void {
  const rec = {
    ...clone(tpl), id: p.id, anonymous: p.anonymous === true, session_id: p.session, background: true,
    background_task_id: p.taskId ?? null, command: p.command ?? `node ${p.id}.js`, created_at: iso(nowMs - p.ageMs),
    generation: 1, closed: false,
  };
  if (p.session === null) delete rec.session_id;
  expect(engine.saveRecord(root, rec), `预置 ${p.id}`).toBe(true);
}

function wipeRecords(root: string): void {
  rmSync(recDir(root), { recursive: true, force: true });
}

/** 真实 detached 后台进程：信号文件出现后把 target 写为 content 并退出。 */
function startBgWriter(root: string, target: string, content: string): { trigger: () => void; child: ChildProcess } {
  const dir = tempRoot();
  const script = join(dir, 'delayed-writer.js');
  const sig = join(dir, 'go');
  writeFileSync(script, `const fs=require('fs');const [sig,t,c]=process.argv.slice(2);
const h=setInterval(()=>{if(fs.existsSync(sig)){fs.writeFileSync(t,c);clearInterval(h);process.exit(0);}},30);`);
  const child = spawn('node', [script, sig, target, content], { cwd: root, stdio: 'ignore', detached: true, env: cleanEnv() });
  cleanups.push(() => { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } });
  return {
    child,
    trigger: () => {
      writeFileSync(sig, '');
      waitFor(() => existsSync(join(root, target)) && readFileSync(join(root, target), 'utf-8') === content, `后台写入 ${target}`);
    },
  };
}

/** 后台 Bash 调用：PreToolUse（run_in_background）→ PostToolUse（真实形态的 tool_response）。 */
function bgStart(root: string, session: string, command: string, id: string, taskId: string, nowMs: number): HookRun {
  const env = clock(nowMs);
  const pre = preToolUse(root, 'Bash', { command, run_in_background: true }, id, { session_id: session }, env);
  expect(pre.exitCode, pre.stderr).toBe(0);
  expect(recFile(root, id), `${id} 已拍快照`).toBe(true);
  const o = based(CAPTURE.post_tool_use_background, root, session);
  o.tool_use_id = id;
  o.tool_input = { command, run_in_background: true };
  o.tool_response = { ...clone(CAPTURE.post_tool_use_background.tool_response), backgroundTaskId: taskId };
  return engineCli(root, ['check'], JSON.stringify(o), env);
}

/** 会话 session 的 Bash 完整链：PreToolUse → 真实执行 → PostToolUse。 */
function bashChain(root: string, session: string, command: string, nowMs: number): { pre: HookRun; post: HookRun } {
  const env = clock(nowMs);
  const id = nextId();
  const pre = preToolUse(root, 'Bash', { command }, id, { session_id: session }, env);
  expect(pre.exitCode, pre.stderr).toBe(0);
  expect(bash(root, command).status, command).toBe(0);
  const o = based(CAPTURE.post_tool_use_background, root, session);
  o.tool_use_id = id;
  o.tool_input = { command };
  o.tool_response = { stdout: '', stderr: '', interrupted: false };
  return { pre, post: engineCli(root, ['check'], JSON.stringify(o), env) };
}

interface PhaseRun { status: number; stdout: string; stderr: string }
/** 真实注册的 SessionStart 入口：stdin 原样送入，时钟经环境注入。 */
function phase(root: string, stdin: string, nowMs: number, args: string[] = []): PhaseRun {
  const r = spawnSync('bash', [PHASE, ...args], {
    cwd: root, input: stdin, encoding: 'utf-8', timeout: 60_000,
    env: cleanEnv({ CLAUDE_PROJECT_DIR: root, PATH: process.env.PATH, ...clock(nowMs) }),
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function sessionStartOutput(r: PhaseRun, label: string): { hookSpecificOutput: { hookEventName: string; additionalContext: string } } {
  expect(r.status, `${label}：${r.stderr}`).toBe(0);
  const out = JSON.parse(r.stdout) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  expect(out.hookSpecificOutput.hookEventName, label).toBe('SessionStart');
  expect(typeof out.hookSpecificOutput.additionalContext, label).toBe('string');
  return out;
}

describe('S09-F 超期关闭 — 单元', () => {
  it('UT-S09-484: 超期关闭的判定边界', () => {
    // 函数层：阈值、严格大于、当前会话豁免、输入缺 session_id、无 session_id 的记录、rebase-only、created_at 非法
    expect(engine.RECORD_EXPIRE_MS).toBe(7 * DAY);
    const at = (age: number, extra: Record<string, unknown> = {}) => ({ session_id: 's1', created_at: iso(T0 - age), ...extra });
    const cur = { session_id: 's2' };
    expect(engine.recordExpired(at(7 * DAY - HOUR), cur, T0)).toBe(false);
    expect(engine.recordExpired(at(7 * DAY), cur, T0), '恰好 7 天不算').toBe(false);
    expect(engine.recordExpired(at(7 * DAY + 1), cur, T0), '超过 1 毫秒即超期').toBe(true);
    expect(engine.recordExpired(at(30 * DAY, { session_id: 's2' }), cur, T0), '当前会话豁免').toBe(false);
    expect(engine.recordExpired(at(8 * DAY), {}, T0), '输入缺 session_id').toBe(false);
    expect(engine.recordExpired(at(8 * DAY), null, T0)).toBe(false);
    expect(engine.recordExpired({ created_at: iso(T0 - 8 * DAY) }, cur, T0), '记录没有 session_id').toBe(true);
    expect(engine.recordExpired(at(8 * DAY, { rebase_only: true }), cur, T0), 'rebase-only 不在此列').toBe(false);
    expect(engine.recordExpired({ session_id: 's1', created_at: 'not-a-date' }, cur, T0)).toBe(false);

    const root = fixture();
    const tpl = template(root);
    const seed = () => {
      wipeRecords(root);
      preset(root, tpl, { id: 'A-6d23h', session: 's1', ageMs: 6 * DAY + 23 * HOUR, taskId: 'ta' });
      preset(root, tpl, { id: 'B-7d', session: 's1', ageMs: 7 * DAY, taskId: 'tb' });
      preset(root, tpl, { id: 'C-7d1s', session: 's1', ageMs: 7 * DAY + SEC, taskId: 'tc' });
      preset(root, tpl, { id: 'anon-1-d8', session: 's1', ageMs: 8 * DAY, anonymous: true });
      preset(root, tpl, { id: 'E-unfilled-8d', session: 's1', ageMs: 8 * DAY });
      preset(root, tpl, { id: 'F-nosession-8d', session: null, ageMs: 8 * DAY, taskId: 'tf' });
      preset(root, tpl, { id: 'G-current-30d', session: 's2', ageMs: 30 * DAY });
    };
    const all = ['A-6d23h', 'B-7d', 'C-7d1s', 'E-unfilled-8d', 'F-nosession-8d', 'G-current-30d', 'anon-1-d8'];
    const kept = ['A-6d23h', 'B-7d', 'G-current-30d'];
    const closed = all.filter(id => !kept.includes(id));
    const open = () => records(root).map(n => n.slice(0, -5));
    // ① 五种检查点结论相同
    for (const kind of KINDS) {
      seed();
      expect(open(), `${kind} 预置`).toEqual(all);
      expect(checkpoint(root, kind, 's2', T0).exitCode, kind).toBe(0);
      expect(open(), `${kind}：超期且非当前会话的记录被关闭`).toEqual(kept);
      for (const id of closed) expect(tomb(root, id), `${kind}：${id} 写墓碑`).toBe(true);
      for (const id of kept) expect(readRecord(root, id).closed, `${kind}：${id} 保留`).toBe(false);
    }
    // ② 输入缺少 session_id：不做超期关闭
    for (const kind of KINDS) {
      seed();
      expect(checkpoint(root, kind, null, T0).exitCode, `② ${kind}`).toBe(0);
      expect(open(), `② ${kind}：输入缺 session_id 时不关闭`).toEqual(all);
    }
    // ③ 提案边界命令不做超期关闭
    seed();
    for (const sub of ['boundary-start', 'boundary-end']) {
      expect(engineCli(root, [sub], '', clock(T0)).exitCode, sub).toBe(0);
      expect(open(), `③ ${sub}`).toEqual(all);
    }
  }, TIMEOUT);

  it('UT-S09-485: 两条新规则沿用既有关闭流程', () => {
    const tA = T0 - 20 * DAY;
    const guardFile = JSON.stringify({ activeChange: 'p1', module: 'core', createdAt: iso(tA), baseRef: null });
    const round = (withProposal: boolean) => {
      const root = fixture();
      // R0：会话 s0，建立于 tA；R1：会话 s1，建立于 tA+1 天并回填标识 t1
      expect(preToolUse(root, 'Bash', { command: 'node bg-r0.js', run_in_background: true }, 'R0', { session_id: 's0' }, clock(tA)).exitCode).toBe(0);
      quiet(bgStart(root, 's1', 'node bg-r1.js', 'R1', 't1', tA + DAY), 'R1 启动');
      expect(readRecord(root, 'R0')).toMatchObject({ background: true, session_id: 's0', created_at: iso(tA) });
      expect(readRecord(root, 'R1')).toMatchObject({ background_task_id: 't1', session_id: 's1', created_at: iso(tA + DAY) });
      const savedR0 = readRecord(root, 'R0');
      const savedR1 = readRecord(root, 'R1');
      if (withProposal) writeFileSync(join(root, 'logos/.openlogos-guard'), guardFile);
      // ① Stop（现状不含 R1 的标识）：R0 此时只有 2 天，不超期
      writeFileSync(join(root, 'src/s1.js'), '1');
      const stopIn = based(CAPTURE.stop_with_task_in_flight, root, 's1');
      stopIn.background_tasks = [];
      const st = engineCli(root, ['check', '--stop'], JSON.stringify(stopIn), clock(tA + 2 * DAY));
      if (withProposal) quiet(st, '④-① 有活跃提案不报告');
      else expect(reasonOf(st, '① 关闭前最终对比当场送达')).toContain('src/s1.js');
      expect([recFile(root, 'R1'), tomb(root, 'R1')], '① R1 写墓碑并删除').toEqual([false, true]);
      expect(recFile(root, 'R0'), '① R0 未超期').toBe(true);
      // ② PreToolUse 补查时 R0 超期（建立 8 天，来自其他会话）
      writeFileSync(join(root, 'src/s0.js'), '0');
      // 有活跃提案时 guard-check 在 PreToolUse 走 proposal_step 判定、不触发补查（既有行为）；该轮改由 PostToolUse 检查点触发
      const pre = checkpoint(root, withProposal ? 'post' : 'pre', 's1', tA + 8 * DAY);
      expect(pre.exitCode, `② 不阻断当前工具调用：${pre.stderr}`).toBe(0);
      expect([recFile(root, 'R0'), tomb(root, 'R0')], '② R0 写墓碑并删除').toEqual([false, true]);
      const pending = readJsonl(root, 'pending-reports.jsonl').map(i => i.path);
      if (withProposal) expect(pending, '④-② 有活跃提案不报告新变化').toEqual([]);
      else expect(pending, '② 变化写入待报告项').toContain('src/s0.js');
      // ③ 关闭后的迟到写入：看到墓碑即丢弃，记录不复活
      for (const rec of [savedR0, savedR1]) {
        expect(engine.saveRecord(root, { ...rec, generation: 99 }), `③ ${rec.id}`).toBe(false);
        expect(recFile(root, rec.id)).toBe(false);
      }
      expect(records(root)).toEqual([]);
    };
    round(false);
    // ④ 存在 logos/.openlogos-guard 时：记录照常关闭，不报告新变化
    round(true);
  }, TIMEOUT);
});

describe('S09-F 超期关闭 — 场景', () => {
  it('ST-S09-213: 超期关闭前的最终对比与关闭后不再列出', () => {
    const root = fixture();
    const bg = startBgWriter(root, 'src/a.js', 'bg-old\n');
    // ① 会话 s1 后台调用 R0
    quiet(bgStart(root, 's1', 'node bg-r0.js', 'R0', 't0', T0), '①');
    // ② 后台改 src/a.js，不经任何检查
    bg.trigger();
    // ③ 时钟推进 7 天零 1 秒，会话 s2 执行 Bash ls 完整链
    const now = T0 + 7 * DAY + SEC;
    const env = clock(now);
    const id = nextId();
    const pre = preToolUse(root, 'Bash', { command: 'ls' }, id, { session_id: 's2' }, env);
    expect(pre.exitCode, `③ 当前调用不被阻断：${pre.stderr}`).toBe(0);
    expect([recFile(root, 'R0'), tomb(root, 'R0')], '③ PreToolUse 补查时 R0 最终对比后删除并写墓碑').toEqual([false, true]);
    expect(readJsonl(root, 'pending-reports.jsonl').map(i => i.path), '③ src/a.js 写入待报告项').toContain('src/a.js');
    expect(bash(root, 'ls').status).toBe(0);
    const post = based(CAPTURE.post_tool_use_background, root, 's2');
    post.tool_use_id = id;
    post.tool_input = { command: 'ls' };
    post.tool_response = { stdout: '', stderr: '', interrupted: false };
    expect(reasonOf(engineCli(root, ['check'], JSON.stringify(post), env), '③ PostToolUse 送达')).toContain('src/a.js');
    // ④ hook 之外手动改 src/b.js，s2 再执行 Bash ls 完整链
    writeFileSync(join(root, 'src/b.js'), 'manual\n');
    const again = bashChain(root, 's2', 'ls', now);
    quiet(again.post, '④ 不报告 src/b.js');
    expect(again.post.stderr).not.toContain('bg-r0.js');
    expect(records(root)).toEqual([]);
  }, TIMEOUT);

  it('ST-S09-214: 存量后台记录在一个检查点内收敛', () => {
    const root = fixture();
    const tpl = template(root);
    // 预置 300 条属于其他会话、年龄 8～40 天的未关闭记录（已回填、未回填、匿名三类轮换）
    const oldIds: string[] = [];
    for (let i = 0; i < 300; i++) {
      const kind = i % 3;
      const id = kind === 2 ? `anon-${1000 + i}-old` : `old-${String(i).padStart(3, '0')}`;
      oldIds.push(id);
      preset(root, tpl, {
        id, session: `old-session-${i % 20}`, ageMs: (8 + (i % 33)) * DAY, taskId: kind === 0 ? `task-${i}` : null,
        anonymous: kind === 2, command: `node stale-${i}.js`,
      });
    }
    preset(root, tpl, { id: 'Ra', session: 'other-recent', ageMs: 3 * DAY, taskId: 'ta', command: 'node recent-ra.js' });
    preset(root, tpl, { id: 'Rb', session: 's2', ageMs: 10 * DAY, command: 'node current-rb.js' });
    expect(records(root)).toHaveLength(302);
    // ① 以 hook 模式运行真实注册的 SessionStart 入口，stdin 为按真实宿主输入构造的 SessionStart JSON（session_id = s2）
    sessionStartOutput(phase(root, JSON.stringify(based(CAPTURE.session_start, root, 's2')), T0), '① 入口');
    expect(records(root).map(n => n.slice(0, -5)), '① 300 条全部关闭，Ra（未满 7 天）、Rb（当前会话）仍在').toEqual(['Ra', 'Rb']);
    const closedTombs = tombs(root);
    for (const id of oldIds) expect(closedTombs, `① ${id} 有墓碑`).toContain(`${id}.closed`);
    expect(closedTombs).toHaveLength(300);
    // ② s2 Bash node -e 改 src/a.js 完整链：相关未关闭调用只列出 Ra、Rb 的命令
    const c = bashChain(root, 's2', `node -e "require('fs').writeFileSync('src/a.js','changed')"`, T0);
    const reason = reasonOf(c.post, '②');
    expect(reason).toContain('src/a.js');
    expect(reason).toContain('node recent-ra.js');
    expect(reason).toContain('node current-rb.js');
    expect(reason).not.toMatch(/node stale-\d+\.js/);
  }, TIMEOUT);

  it('ST-S09-215: 两个不收敛的反例', () => {
    const root = fixture();
    const tpl = template(root);
    // ① 会话 s1 的未回填标识后台记录 Rb，年龄 10 天；s1 连续发送 Stop（空数组）、PreToolUse 补查、SessionStart
    preset(root, tpl, { id: 'Rb', session: 's1', ageMs: 10 * DAY });
    const stopIn = based(CAPTURE.stop_with_task_in_flight, root, 's1');
    stopIn.background_tasks = [];
    quiet(engineCli(root, ['check', '--stop'], JSON.stringify(stopIn), clock(T0)), '① Stop');
    expect(checkpoint(root, 'pre', 's1', T0).exitCode).toBe(0);
    expect(checkpoint(root, 'session-start', 's1', T0).exitCode).toBe(0);
    expect(recFile(root, 'Rb'), '① 当前会话豁免超期关闭，未回填标识不适用 Stop 现状').toBe(true);
    expect(readRecord(root, 'Rb').closed).toBe(false);
    // ② 改由会话 s2 发送任一检查点：Rb 被超期关闭
    expect(checkpoint(root, 'pre', 's2', T0).exitCode).toBe(0);
    expect([recFile(root, 'Rb'), tomb(root, 'Rb')], '②').toEqual([false, true]);
    // ③ 另一轮：其他会话的后台记录 Rc 年龄 6 天
    wipeRecords(root);
    const created = T0 - 6 * DAY;
    preset(root, tpl, { id: 'Rc', session: 'other', ageMs: 6 * DAY, taskId: 'tc' });
    expect(readRecord(root, 'Rc').created_at).toBe(iso(created));
    expect(checkpoint(root, 'stop', 's1', T0).exitCode).toBe(0);
    expect(recFile(root, 'Rc'), '③ 不足 7 天保留').toBe(true);
    // ④ 时钟推进到恰好 7 天
    expect(checkpoint(root, 'stop', 's1', created + 7 * DAY).exitCode).toBe(0);
    expect(recFile(root, 'Rc'), '④ 恰好 7 天保留').toBe(true);
    // ⑤ 推进到 7 天零 1 秒
    expect(checkpoint(root, 'stop', 's1', created + 7 * DAY + SEC).exitCode).toBe(0);
    expect([recFile(root, 'Rc'), tomb(root, 'Rc')], '⑤').toEqual([false, true]);
  }, TIMEOUT);

  it('ST-S09-216: SessionStart 入口拿不到会话标识时不回收，由之后的检查点回收', () => {
    const root = fixture();
    const tpl = template(root);
    const ids = ['old-1', 'old-2', 'old-3', 'old-4', 'old-5'];
    const seed = () => {
      wipeRecords(root);
      rmSync(join(root, RUNTIME, 'pending-reports.jsonl'), { force: true });
      rmSync(join(root, RUNTIME, 'reported.jsonl'), { force: true });
      ids.forEach((id, i) => preset(root, tpl, { id, session: `gone-${i}`, ageMs: 8 * DAY, taskId: `t${i}` }));
    };
    const open = () => records(root).map(n => n.slice(0, -5));
    // 记录打开期间的一处未报告变化：用于确认入口照常接管、对比并注入待报告项
    writeFileSync(join(root, 'src/a.js'), 'changed-while-open\n');
    const noSession = based(CAPTURE.session_start, root, null);
    const inputs: Array<[string, string]> = [
      ['① 空', ''],
      ['② 非 JSON 文本', 'this is not json'],
      ['③ JSON 数组', '[1,2,3]'],
      ['④ 不含 session_id 的 SessionStart JSON', JSON.stringify(noSession)],
    ];
    for (const [label, stdin] of inputs) {
      seed();
      const out = sessionStartOutput(phase(root, stdin, T0), label);
      expect(open(), `${label}：5 条记录全部保留`).toEqual(ids);
      expect(out.hookSpecificOutput.additionalContext, `${label}：待报告项照常注入`).toContain('src/a.js');
    }
    // ⑤ 会话 s2 发送任意工具的 PreToolUse 补查：5 条记录被超期关闭
    expect(checkpoint(root, 'pre', 's2', T0).exitCode).toBe(0);
    expect(open(), '⑤').toEqual([]);
    for (const id of ids) expect(tomb(root, id), `⑤ ${id}`).toBe(true);
    // ⑥ --plain：不调用引擎，记录保留
    seed();
    const plain = phase(root, JSON.stringify(based(CAPTURE.session_start, root, 's2')), T0, ['--plain']);
    expect(plain.status, plain.stderr).toBe(0);
    expect(plain.stdout.trim().startsWith('{'), '⑥ plain 输出不是 hook JSON').toBe(false);
    expect(open(), '⑥ --plain 不调用引擎').toEqual(ids);
    // 对照：同一入口带上 session_id 即回收（证明 ①～④ 的保留来自缺少会话标识，而非入口未调用引擎）
    sessionStartOutput(phase(root, JSON.stringify(based(CAPTURE.session_start, root, 's2')), T0), '对照');
    expect(open(), '对照').toEqual([]);
  }, TIMEOUT);
});
