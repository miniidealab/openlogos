/**
 * fix-guard-background-record-never-closed [code] 切片 1：后台任务自行结束后，Stop 按宿主的后台任务现状关闭记录
 * （spec/pretooluse-guard.md「执行记录生命周期（C12）」关闭条件 4；S09-F Step 63→64、EX-9F.39～41）。
 *
 * 覆盖 UT-S09-481、UT-S09-482、UT-S09-483；ST-S09-210、ST-S09-211、ST-S09-212
 * （与 logos/resources/test/core-S09-test-cases.md 对齐）。
 * - hook 输入一律以实施时采集的 Claude Code 真实输入为模板（cli/test/fixtures/s09-claude-stop-background-tasks.json）：
 *   后台调用的 PostToolUse、任务进行中的 Stop、任务结束后的 Stop。测试只替换会话、路径与任务标识，不手写字段形态。
 * - UT 在函数层调用分发源 plugin/bin/guard-post-check.cjs 导出的真实实现，并以 stdin JSON 调用其 check 子命令观察磁盘事实。
 * - ST 以 PreToolUse（plugin/bin/guard-check）→ 真实执行 → PostToolUse / Stop 的完整链驱动；后台写入由真实 detached 子进程
 *   按信号文件触发，不依赖 sleep 竞态。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { makeTempRoot } from './helpers.js';
import { REPO_ROOT, buildProject, cleanEnv, git } from './s09-guard-vcs-fixtures.js';
import {
  RUNTIME, bash, chain, deployEngine, engine, engineCli, nextId, preToolUse, readJsonl, readRecord, records, snapshot,
  type HookRun,
} from './s09-guard-post-check-helpers.js';

const TIMEOUT = 180_000;
const CAPTURE = JSON.parse(readFileSync(join(REPO_ROOT, 'cli/test/fixtures/s09-claude-stop-background-tasks.json'), 'utf-8')) as {
  post_tool_use_background: Record<string, unknown> & { tool_response: Record<string, unknown> };
  stop_with_task_in_flight: Record<string, unknown> & { background_tasks: Array<Record<string, unknown>> };
  stop_after_task_ended: Record<string, unknown> & { background_tasks: unknown[] };
};

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
const recFile = (root: string, id: string) => existsSync(join(root, RUNTIME, 'guard-records', `${id}.json`));
const tomb = (root: string, id: string) => existsSync(join(root, RUNTIME, 'guard-records', `${id}.closed`));

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

/** 以采集到的真实输入为模板，替换会话与路径。 */
function based(template: Record<string, unknown>, root: string, session: string | null): Record<string, unknown> {
  const o = clone(template);
  o.cwd = root;
  o.transcript_path = join(root, '.t.jsonl');
  if (session === null) delete o.session_id; else o.session_id = session;
  return o;
}

/** 现状条目：以采集到的真实条目为模板，替换任务标识；status 按用例给定（undefined = 删除该字段）。 */
function task(id: string, status: string | undefined | null = 'running'): Record<string, unknown> {
  const t = clone(CAPTURE.stop_with_task_in_flight.background_tasks[0]);
  t.id = id;
  if (status === undefined) delete t.status; else t.status = status;
  return t;
}

const NO_FIELD = Symbol('no-field');
/** Stop：tasks 为 NO_FIELD 时删除 background_tasks 字段，否则原样写入（可为非法值）。 */
function stop(root: string, session: string | null, tasks: unknown): HookRun {
  const o = based(CAPTURE.stop_with_task_in_flight, root, session);
  if (tasks === NO_FIELD) delete o.background_tasks; else o.background_tasks = tasks;
  return engineCli(root, ['check', '--stop'], JSON.stringify(o));
}

/** 后台 Bash 调用：PreToolUse（run_in_background）→ PostToolUse（真实形态的 tool_response；taskId 为 null 时不含后台任务标识）。 */
function bgStart(root: string, session: string, command: string, id: string, taskId: string | null): HookRun {
  const pre = preToolUse(root, 'Bash', { command, run_in_background: true }, id, { session_id: session });
  expect(pre.exitCode, pre.stderr).toBe(0);
  expect(recFile(root, id), `${id} 已拍快照`).toBe(true);
  const o = based(CAPTURE.post_tool_use_background, root, session);
  o.tool_use_id = id;
  o.tool_input = { command, run_in_background: true };
  const resp = clone(CAPTURE.post_tool_use_background.tool_response);
  if (taskId === null) delete resp.backgroundTaskId; else resp.backgroundTaskId = taskId;
  o.tool_response = resp;
  return engineCli(root, ['check'], JSON.stringify(o));
}

/** 后台调用启动时可能顺带送达此前的待报告项，退出码 0 或 2 都不影响记录保持打开。 */
function bgOpen(root: string, session: string, command: string, id: string, taskId: string | null): void {
  expect([0, 2], `${id} 启动`).toContain(bgStart(root, session, command, id, taskId).exitCode);
  expect(readRecord(root, id)).toMatchObject({ background: true, background_task_id: taskId, session_id: session, closed: false });
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

describe('S09-F Stop 按后台任务现状关闭 — 单元', () => {
  it('UT-S09-481: Stop 后台任务现状的成员关系判定', () => {
    // 规范核实（入库夹具）：现状条目的 id 与后台调用 PostToolUse 返回的后台任务标识同值；任务结束后的 Stop 现状为空数组
    const capturedId = CAPTURE.post_tool_use_background.tool_response.backgroundTaskId;
    expect(typeof capturedId).toBe('string');
    expect(engine.backgroundTaskIdOf(CAPTURE.post_tool_use_background)).toBe(capturedId);
    expect(CAPTURE.stop_with_task_in_flight.background_tasks.map(t => t.id)).toEqual([capturedId]);
    expect([...engine.backgroundTasksOf(CAPTURE.stop_with_task_in_flight)]).toEqual([capturedId]);
    expect(CAPTURE.stop_after_task_ended.background_tasks).toEqual([]);
    expect(engine.backgroundTasksOf(CAPTURE.stop_after_task_ended).size).toBe(0);
    expect(CAPTURE.stop_with_task_in_flight.session_id).toBe(CAPTURE.post_tool_use_background.session_id);

    // 函数层：只看成员关系，不读 status
    const rec = { id: 'x', background: true, anonymous: false, session_id: 's1', background_task_id: 't1' };
    const inp = { session_id: 's1' };
    expect(engine.closableByBackgroundTasks(rec, inp, new Set(['t2']))).toBe(true);
    expect(engine.closableByBackgroundTasks(rec, inp, new Set(['t1', 't2']))).toBe(false);
    expect(engine.closableByBackgroundTasks(rec, inp, new Set())).toBe(true);
    expect(engine.closableByBackgroundTasks(rec, inp, null)).toBe(false);
    for (const status of ['running', 'completed', 'failed', 'weird', undefined]) {
      const ids = engine.backgroundTasksOf({ background_tasks: [task('t1', status)] });
      expect([...ids], `status=${String(status)}`).toEqual(['t1']);
      expect(engine.closableByBackgroundTasks(rec, inp, ids), `status=${String(status)} 不关闭`).toBe(false);
    }

    const root = fixture();
    bgOpen(root, 's1', 'node bg-r2.js', 'R2', 't2');
    // ① 现状含 t1、t2：均保留
    bgOpen(root, 's1', 'node bg-r1.js', 'R1', 't1');
    quiet(stop(root, 's1', [task('t1'), task('t2')]), '①');
    expect([recFile(root, 'R1'), recFile(root, 'R2')], '① 均保留').toEqual([true, true]);
    // ② 现状只含 t2，t2 条目的 status 依次为 running / completed / failed / 未知值 / 缺失：每轮 R1 关闭，R2 保留
    const statuses: Array<string | undefined> = ['running', 'completed', 'failed', 'weird', undefined];
    statuses.forEach((status, i) => {
      const id = i === 0 ? 'R1' : `R1-${i}`;
      const tid = i === 0 ? 't1' : `t1-${i}`;
      if (i > 0) bgOpen(root, 's1', `node bg-${id}.js`, id, tid);
      quiet(stop(root, 's1', [task('t2', status)]), `② status=${String(status)}`);
      expect([recFile(root, id), tomb(root, id)], `② ${id} 最终对比后关闭并写墓碑`).toEqual([false, true]);
      expect(recFile(root, 'R2'), `② status=${String(status)} 时 R2 保留`).toBe(true);
    });
    // ③ 空数组：R2 关闭
    quiet(stop(root, 's1', []), '③');
    expect([recFile(root, 'R2'), tomb(root, 'R2')], '③ R2 关闭').toEqual([false, true]);
    expect(records(root)).toEqual([]);
  }, TIMEOUT);

  it('UT-S09-482: Stop 后台任务现状的字段可用性', () => {
    const invalid: Array<[string, unknown]> = [
      ['字段缺失', NO_FIELD],
      ['null', null],
      ['对象', { t9: task('t9') }],
      ['字符串', 't9'],
      ['数组中含非对象条目', [task('t9'), 't8']],
      ['数组中含缺少 id 的条目', [task('t9'), { type: 'shell', status: 'running' }]],
      ['数组中含 id 为空串的条目', [task('t9'), task('')]],
    ];
    // 函数层：无效现状一律返回 null；空数组与合法条目有效
    for (const [label, v] of invalid) {
      expect(engine.backgroundTasksOf(v === NO_FIELD ? {} : { background_tasks: v }), label).toBeNull();
    }
    expect(engine.backgroundTasksOf({ background_tasks: [task('t9', undefined)] })).toEqual(new Set(['t9']));
    expect(engine.backgroundTasksOf({ background_tasks: [] })).toEqual(new Set());
    expect(engine.backgroundTasksOf(null)).toBeNull();

    const root = fixture();
    bgOpen(root, 's1', 'node bg-r1.js', 'R1', 't1');
    invalid.forEach(([label, v], i) => {
      const fg = `F${i + 1}`;
      expect(snapshot(root, `node fg-${i}.js`, fg).exitCode).toBe(0);
      expect(readRecord(root, fg).background).toBe(false);
      quiet(stop(root, 's1', v), label);
      expect(recFile(root, 'R1'), `${label}：现状无效，R1 保留`).toBe(true);
      expect([recFile(root, fg), tomb(root, fg)], `${label}：非后台记录照常关闭`).toEqual([false, true]);
    });
    expect(readRecord(root, 'R1').closed).toBe(false);
  }, TIMEOUT);

  it('UT-S09-483: Stop 后台任务现状的身份对应', () => {
    // 函数层
    const all = new Set<string>();
    expect(engine.closableByBackgroundTasks({ background: true, session_id: 's1', background_task_id: null }, { session_id: 's1' }, all), '未回填').toBe(false);
    expect(engine.closableByBackgroundTasks({ background: true, anonymous: true, session_id: 's1', background_task_id: 't' }, { session_id: 's1' }, all), '匿名').toBe(false);
    expect(engine.closableByBackgroundTasks({ background: true, session_id: 's2', background_task_id: 't5' }, { session_id: 's1' }, all), '其他会话').toBe(false);
    expect(engine.closableByBackgroundTasks({ background: true, session_id: 's1', background_task_id: 't' }, {}, all), '输入缺 session_id').toBe(false);
    expect(engine.closableByBackgroundTasks({ background: false, session_id: 's1', background_task_id: 't' }, { session_id: 's1' }, all), '非后台').toBe(false);

    const root = fixture();
    bgOpen(root, 's1', 'node bg-r3.js', 'R3', null);
    // 匿名后台记录：PreToolUse 缺少调用标识
    expect(preToolUse(root, 'Bash', { command: 'node bg-anon.js', run_in_background: true }, null, { session_id: 's1' }).exitCode).toBe(0);
    const anon = records(root).map(n => n.slice(0, -5)).find(n => n.startsWith('anon-'))!;
    expect(readRecord(root, anon)).toMatchObject({ anonymous: true, background: true, session_id: 's1' });
    bgOpen(root, 's2', 'node bg-r5.js', 'R5', 't5');
    const alive = () => ['R3', anon, 'R5'].map(id => recFile(root, id));
    // ① s1 Stop，空数组：未回填、匿名、其他会话均不适用
    quiet(stop(root, 's1', []), '①');
    expect(alive(), '①').toEqual([true, true, true]);
    // ② 缺少 session_id 的 Stop，空数组：不关闭任何后台记录
    quiet(stop(root, null, []), '②');
    expect(alive(), '②').toEqual([true, true, true]);
    // ③ s2 的非 Stop 事件附带 background_tasks 空数组：不按该字段关闭
    const extra = { session_id: 's2', background_tasks: [] };
    expect(preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId(), extra).exitCode).toBe(0);
    const post = based(CAPTURE.post_tool_use_background, root, 's2');
    post.tool_use_id = nextId();
    post.tool_input = { command: 'ls' };
    post.tool_response = { stdout: '', stderr: '', interrupted: false };
    post.background_tasks = [];
    quiet(engineCli(root, ['check'], JSON.stringify(post)), '③ PostToolUse');
    const ss = { session_id: 's2', cwd: root, transcript_path: join(root, '.t.jsonl'), hook_event_name: 'SessionStart', source: 'startup', background_tasks: [] };
    expect(engineCli(root, ['check', '--session-start'], JSON.stringify(ss)).exitCode).toBe(0);
    expect(alive(), '③ 非 Stop 事件不按该字段关闭').toEqual([true, true, true]);
    expect(readRecord(root, 'R5').closed).toBe(false);
    // 对照：s2 的 Stop 空数组才关闭 R5
    quiet(stop(root, 's2', []), '对照');
    expect(alive()).toEqual([true, true, false]);
  }, TIMEOUT);
});

describe('S09-F Stop 按后台任务现状关闭 — 场景', () => {
  it('ST-S09-210: 后台任务自行结束后在 Stop 关闭记录', () => {
    const root = fixture();
    // ① 两条后台调用：PreToolUse → PostToolUse（tool_response 含后台任务标识）
    quiet(bgStart(root, 's1', 'node bg-r1.js', 'R1', 't1'), '① R1');
    quiet(bgStart(root, 's1', 'node bg-r2.js', 'R2', 't2'), '① R2');
    // ② 现状含 t1、t2
    quiet(stop(root, 's1', [task('t1'), task('t2')]), '②');
    expect([recFile(root, 'R1'), recFile(root, 'R2')], '②').toEqual([true, true]);
    // ③ 现状只含 t2，t2 条目 status 为非运行值
    quiet(stop(root, 's1', [task('t2', 'completed')]), '③');
    expect([recFile(root, 'R1'), tomb(root, 'R1')], '③ R1 最终对比后删除并写墓碑').toEqual([false, true]);
    expect(recFile(root, 'R2'), '③ R2 仍在').toBe(true);
    // ④ 空数组
    quiet(stop(root, 's1', []), '④');
    expect([recFile(root, 'R2'), tomb(root, 'R2')], '④').toEqual([false, true]);
    expect(records(root)).toEqual([]);
    // ⑤ hook 之外手动改 src/a.js：无未关闭记录时按执行前已有改动处理，不报告
    writeFileSync(join(root, 'src/a.js'), 'manual\n');
    const c = chain(root, 'ls');
    expect(c.post, '⑤').not.toBeNull();
    quiet(c.post!, '⑤');
    expect(c.post!.stderr).not.toContain('bg-r1.js');
    expect(c.post!.stderr).not.toContain('bg-r2.js');
    expect(readJsonl(root, 'pending-reports.jsonl')).toEqual([]);
  }, TIMEOUT);

  it('ST-S09-211: Stop 关闭前的最终对比仍发现变化', () => {
    const root = fixture();
    const bg = startBgWriter(root, 'src/a.js', 'bg-final\n');
    quiet(bgStart(root, 's1', 'node bg-r1.js', 'R1', 't1'), '①');
    bg.trigger();
    // trigger() 返回时写入已落盘，夹具脚本随即退出；宿主不产生任何查询或终止类工具调用
    // ② 空数组：最终对比发现 src/a.js，归因 R1 的命令；R1 关闭
    const reason = reasonOf(stop(root, 's1', []), '②');
    expect(reason).toContain('src/a.js');
    expect(reason).toContain('node bg-r1.js');
    expect([recFile(root, 'R1'), tomb(root, 'R1')], '② R1 关闭').toEqual([false, true]);
    // ③ 再次 Stop：不重复报告，不再列出 R1
    const again = stop(root, 's1', []);
    quiet(again, '③');
    expect(again.stderr).not.toContain('bg-r1.js');
  }, TIMEOUT);

  it('ST-S09-212: 其他会话、未回填标识与现状无效时不被 Stop 误关', () => {
    const root = fixture();
    const bg = startBgWriter(root, 'src/a.js', 'bg-late\n');
    quiet(bgStart(root, 's1', 'node bg-r1.js', 'R1', 't1'), '① R1');
    // ② PostToolUse 不含后台任务标识
    quiet(bgStart(root, 's1', 'node bg-r3.js', 'R3', null), '② R3');
    expect(readRecord(root, 'R3')).toMatchObject({ background: true, background_task_id: null });
    const both = () => [recFile(root, 'R1'), recFile(root, 'R3')];
    // ③ 会话 s2 Stop，空数组
    quiet(stop(root, 's2', []), '③');
    expect(both(), '③').toEqual([true, true]);
    // ④ s1 Stop，输入不含 background_tasks
    quiet(stop(root, 's1', NO_FIELD), '④');
    expect(both(), '④').toEqual([true, true]);
    // ⑤ s1 Stop，现状含 t1
    quiet(stop(root, 's1', [task('t1')]), '⑤');
    expect(both(), '⑤').toEqual([true, true]);
    // ⑥ 触发后台写入
    bg.trigger();
    // ⑦ s1 Bash ls 完整链
    const id = nextId();
    expect(preToolUse(root, 'Bash', { command: 'ls' }, id, { session_id: 's1' }).exitCode).toBe(0);
    expect(bash(root, 'ls').status).toBe(0);
    const post = based(CAPTURE.post_tool_use_background, root, 's1');
    post.tool_use_id = id;
    post.tool_input = { command: 'ls' };
    post.tool_response = { stdout: '', stderr: '', interrupted: false };
    const reason = reasonOf(engineCli(root, ['check'], JSON.stringify(post)), '⑦');
    expect(reason).toContain('src/a.js');
    expect(reason).toContain('node bg-r1.js');
    expect(both(), '⑦ 记录仍在').toEqual([true, true]);
  }, TIMEOUT);
});
