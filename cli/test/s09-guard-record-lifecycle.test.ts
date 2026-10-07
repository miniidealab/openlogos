/**
 * guard-versioned-content-scope [code] 切片 4：执行记录生命周期、跨会话、提案边界与共享状态可靠性（S09-F）。
 *
 * 覆盖 UT-S09-395、396、397、401、416、417、418、419、420；
 * ST-S09-158、159、160、161、162、163、164、165、166、167、168、186、187、188、189、190
 * （与 logos/resources/test/core-S09-test-cases.md 对齐）。
 * - UT 以 stdin JSON 调用分发源引擎 plugin/bin/guard-post-check.cjs 的子命令，或在函数层调用其导出的真实实现
 *   （锁、原子落盘、代际与墓碑、溢出合并）；锁等待以 OPENLOGOS_GUARD_TEST_LOCK_WAIT_MS 注入缩短（默认 5 秒的用例照常真实等待）。
 * - ST 以完整 hook 链（PreToolUse → 真实执行 → PostToolUse / Stop / SessionStart）驱动分发源；后台调用由真实的
 *   detached 子进程按信号文件写入；提案边界经真实 CLI（cli/dist/index.js）的 change / archive 触发。
 * - 并发与中断：多个 hook 进程真正并发启动；中断以引擎的测试故障注入（OPENLOGOS_GUARD_TEST_FAULT，默认关闭）
 *   暂停在「写完临时文件、rename 之前」后 kill -9，或在第 n 次记录落盘后自 SIGKILL。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { makeTempRoot } from './helpers.js';
import { BASELINE_FILE, ENGINE_SRC, GUARD_SRC, REPO_ROOT, buildProject, cleanEnv, git, type FixtureKind } from './s09-guard-vcs-fixtures.js';
import {
  RUNTIME, bash, chain, deployEngine, engine, engineCli, nextId, postToolUse, preToolUse, rawOid, readJsonl, readRecord,
  records, snapshot, stopHook, type HookRun,
} from './s09-guard-post-check-helpers.js';
import { runGuardBoundary } from '../src/lib/guard-boundary.js';

const TIMEOUT = 180_000;
const CLI = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const PHASE = join(REPO_ROOT, 'plugin', 'bin', 'openlogos-phase');
const UNATTRIBUTED = '可能来自未结束的后台调用或用户手动修改，需向用户确认，请勿自行回滚';
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return root;
}

function fixture(kind: FixtureKind = 'G-repo', withEngine = true): string {
  const root = buildProject(tempRoot(), kind);
  expect(git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim(), `${kind} 应在 git 工作树内`).toBe('true');
  expect(existsSync(join(root, 'logos/.openlogos-guard')), `${kind} 不应有活跃提案`).toBe(false);
  if (withEngine) deployEngine(root);
  return root;
}

function commit(root: string, msg: string): void {
  expect(git(root, ['add', '-A']).status).toBe(0);
  expect(git(root, ['commit', '-qm', msg]).status).toBe(0);
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

async function waitForAsync(cond: () => boolean, label: string, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`等待超时：${label}`);
    await new Promise(r => setTimeout(r, 50));
  }
}

const NODE_WRITE = (rel: string, content: string) => `node -e "require('fs').writeFileSync('${rel}','${content}')"`;

function reasonOf(r: HookRun | null, label: string): string {
  expect(r, label).not.toBeNull();
  expect(r!.exitCode, `${label}：${r!.stderr}`).toBe(2);
  const reason = (JSON.parse(r!.stdout) as { reason: string }).reason;
  expect(r!.stderr.trim(), `${label} stderr 与 stdout 同文本`).toBe(reason.trim());
  return reason;
}

function quiet(r: HookRun | null, label: string): void {
  expect(r, label).not.toBeNull();
  expect(r!.exitCode, `${label}：${r!.stderr}${r!.stdout}`).toBe(0);
  expect(r!.stdout, label).toBe('');
}

/** 反馈中的变化文件清单（「  - <path>（类型）」行）。 */
function listed(reason: string): string[] {
  return [...reason.matchAll(/^ {2}- (\S+?)（(?:新增|删除|类型变化|内容变化)）$/gm)].map(m => m[1]);
}

/** 以 Claude Code 真实字段构造任意 hook 事件并调用引擎。 */
function hook(root: string, event: string, tool: string | null, toolInput: Record<string, unknown> | null, id: string | null,
  extra: Record<string, unknown> = {}, env: Record<string, string | undefined> = {}, args = ['check']): HookRun {
  const o: Record<string, unknown> = {
    session_id: 's09-life', transcript_path: join(root, '.t.jsonl'), cwd: root, hook_event_name: event, permission_mode: 'default',
  };
  if (tool) o.tool_name = tool;
  if (toolInput) o.tool_input = toolInput;
  if (id) o.tool_use_id = id;
  return engineCli(root, args, JSON.stringify({ ...o, ...extra }), env);
}

/** 后台 Bash 调用：PreToolUse（run_in_background）→ PostToolUse（tool_response 含后台任务标识）。 */
function bgStart(root: string, command: string, id: string, taskId: string): HookRun {
  const pre = preToolUse(root, 'Bash', { command, run_in_background: true }, id);
  expect(pre.exitCode, pre.stderr).toBe(0);
  expect(existsSync(join(root, RUNTIME, 'guard-records', `${id}.json`)), `${id} 已拍快照`).toBe(true);
  return hook(root, 'PostToolUse', 'Bash', { command, run_in_background: true }, id, {
    tool_response: { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: taskId },
  });
}

const tomb = (root: string, id: string) => existsSync(join(root, RUNTIME, 'guard-records', `${id}.closed`));
const recFile = (root: string, id: string) => existsSync(join(root, RUNTIME, 'guard-records', `${id}.json`));

/** 真实 detached 后台进程：信号文件出现后把 target 写为 content。 */
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

function runCli(root: string, args: string[], env: Record<string, string | undefined> = {}) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: root, encoding: 'utf-8', timeout: 120_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...env }),
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function traceEvents(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function archiveReady(root: string, slug: string): void {
  writeFileSync(join(root, 'logos/changes', slug, 'VERIFY_PASS'), '');
}

/** 另一进程持有状态锁（直到 release；holdMs 给出时到时自行释放）。 */
async function holdLock(root: string, holdMs?: number): Promise<{ child: ChildProcess; release: () => Promise<void>; exited: Promise<void> }> {
  const script = `const e=require(${JSON.stringify(ENGINE_SRC)});const r=e.acquireLock(process.argv[1],0);
if(!r){process.exit(3)}process.stdout.write('ready\\n');
process.on('SIGTERM',()=>{r();process.exit(0)});
${holdMs ? `setTimeout(()=>{r();process.exit(0)},${holdMs});` : ''}setInterval(()=>{},1000);`;
  const child = spawn('node', ['-e', script, root], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise<void>(res => child.on('exit', () => res()));
  cleanups.push(() => { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } });
  let out = '';
  child.stdout!.on('data', d => { out += String(d); });
  await waitForAsync(() => out.includes('ready'), '持锁进程就绪');
  return {
    child, exited,
    release: async () => { child.kill('SIGTERM'); await exited; },
  };
}

function runAsync(cmd: string, args: string[], input: string, cwd: string, env: NodeJS.ProcessEnv): Promise<HookRun & { signal: string | null; ms: number }> {
  return new Promise(res => {
    const t0 = Date.now();
    const c = spawn(cmd, args, { cwd, env });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', d => { stdout += String(d); });
    c.stderr.on('data', d => { stderr += String(d); });
    c.on('close', (code, signal) => res({ exitCode: code ?? -1, stdout, stderr, signal, ms: Date.now() - t0 }));
    c.stdin.end(input);
  });
}

function postInput(root: string, command: string, id: string | null, event = 'PostToolUse'): string {
  return JSON.stringify({
    session_id: 's09-life', cwd: root, hook_event_name: event, tool_name: 'Bash', tool_input: { command },
    ...(id ? { tool_use_id: id } : {}), tool_response: { stdout: '', stderr: '', interrupted: false },
  });
}

function deadPid(): number {
  const r = spawnSync('node', ['-e', '0']);
  return r.pid!;
}

function writeLock(root: string, pid: number, agoMs: number): void {
  mkdirSync(join(root, RUNTIME), { recursive: true });
  writeFileSync(join(root, RUNTIME, 'state.lock'), JSON.stringify({ pid, host: 'h', acquired_at: new Date(Date.now() - agoMs).toISOString() }));
}

function backdateLock(root: string, ms = 31_000): void {
  const f = join(root, RUNTIME, 'state.lock');
  const cur = JSON.parse(readFileSync(f, 'utf-8'));
  cur.acquired_at = new Date(Date.parse(cur.acquired_at) - ms).toISOString();
  writeFileSync(f, JSON.stringify(cur));
}

function tmpResidue(root: string): string[] {
  const out: string[] = [];
  for (const d of ['', 'guard-records', 'pending-spill']) {
    const dir = join(root, RUNTIME, d);
    if (!existsSync(dir)) continue;
    for (const n of readdirSync(dir)) if (n.includes('.tmp-')) out.push(join(d, n));
  }
  return out;
}

function spills(root: string): string[] {
  const d = join(root, RUNTIME, 'pending-spill');
  return existsSync(d) ? readdirSync(d).filter(n => n.endsWith('.json')).sort() : [];
}

/** 全部状态文件可解析。 */
function expectStateParsable(root: string): void {
  for (const f of ['pending-reports.jsonl', 'reported.jsonl']) {
    const p = join(root, RUNTIME, f);
    if (!existsSync(p)) continue;
    for (const l of readFileSync(p, 'utf-8').split('\n').filter(Boolean)) expect(() => JSON.parse(l), f).not.toThrow();
  }
  const cache = join(root, RUNTIME, 'raw-baseline.json');
  if (existsSync(cache)) expect(() => JSON.parse(readFileSync(cache, 'utf-8'))).not.toThrow();
  for (const n of records(root)) expect(() => JSON.parse(readFileSync(join(root, RUNTIME, 'guard-records', n), 'utf-8')), n).not.toThrow();
}

describe('S09-F 执行记录生命周期 — 单元', () => {
  it('UT-S09-395: 执行记录关闭条件状态机', () => {
    const root = fixture();
    const pendingPaths = () => readJsonl(root, 'pending-reports.jsonl').map(i => i.path);
    // ① 同标识非后台 PostToolUse：最终对比（报告本次写入）后关闭，写墓碑
    expect(snapshot(root, 'node w1.js', 'A').exitCode).toBe(0);
    writeFileSync(join(root, 'src/s1.js'), '1');
    expect(reasonOf(postToolUse(root, 'node w1.js', 'A'), '①')).toContain('src/s1.js');
    expect([recFile(root, 'A'), tomb(root, 'A')]).toEqual([false, true]);
    // ② 同标识非后台 PostToolUseFailure
    expect(snapshot(root, 'node w2.js', 'B').exitCode).toBe(0);
    writeFileSync(join(root, 'src/s2.js'), '2');
    expect(reasonOf(postToolUse(root, 'node w2.js', 'B', true), '②')).toContain('src/s2.js');
    expect([recFile(root, 'B'), tomb(root, 'B')]).toEqual([false, true]);
    // ③ 后台调用 PostToolUse 返回 background_task_id：回填，不关闭
    quiet(bgStart(root, 'node bg-c.js', 'C', 'bgC'), '③');
    expect(readRecord(root, 'C')).toMatchObject({ background: true, background_task_id: 'bgC', closed: false });
    // ④ 查询类工具显示运行中：不关闭
    quiet(hook(root, 'PostToolUse', 'BashOutput', { bash_id: 'bgC' }, nextId(), { tool_response: { status: 'running', stdout: '' } }), '④ BashOutput');
    quiet(hook(root, 'PostToolUse', 'TaskOutput', { task_id: 'bgC', block: false }, nextId(), {
      tool_response: { retrieval_status: 'not_ready', task: { task_id: 'bgC', task_type: 'local_bash', status: 'running' } },
    }), '④ TaskOutput');
    expect(recFile(root, 'C')).toBe(true);
    // ⑤ 已完成 / 失败 / 被终止：最终对比后关闭（变化写入待报告项，下一次 Bash 结束事件或 Stop 送达）
    const ends: Array<[string, string, Record<string, unknown>, Record<string, unknown>]> = [
      ['C', 'BashOutput', { bash_id: 'bgC' }, { status: 'completed', exitCode: 0 }],
      ['D', 'TaskOutput', { task_id: 'bgD' }, { retrieval_status: 'success', task: { task_id: 'bgD', status: 'failed', exitCode: 1 } }],
      ['E', 'BashOutput', { bash_id: 'bgE' }, { status: 'killed' }],
    ];
    for (const [id, tool, ti, resp] of ends) {
      // 新后台调用的 PostToolUse 同时送达此前存入的待报告项（exit 2），不影响本记录保持打开
      if (id !== 'C') expect([0, 2]).toContain(bgStart(root, `node bg-${id}.js`, id, `bg${id}`).exitCode);
      writeFileSync(join(root, `src/end-${id}.js`), id);
      quiet(hook(root, 'PostToolUse', tool, ti, nextId(), { tool_response: resp }), `⑤ ${tool}`);
      expect([recFile(root, id), tomb(root, id)], `⑤ ${id} 关闭`).toEqual([false, true]);
      expect(pendingPaths(), `⑤ ${id} 关闭前最终对比`).toContain(`src/end-${id}.js`);
    }
    // ⑥ 终止类工具成功（KillShell / TaskStop）
    for (const [id, tool, ti] of [['F', 'KillShell', { shell_id: 'bgF' }], ['G', 'TaskStop', { task_id: 'bgG' }]] as const) {
      expect([0, 2]).toContain(bgStart(root, `node bg-${id}.js`, id, `bg${id}`).exitCode);
      writeFileSync(join(root, `src/kill-${id}.js`), id);
      quiet(hook(root, 'PostToolUse', tool, ti, nextId(), { tool_response: { message: `Successfully killed ${id}`, [Object.keys(ti)[0]]: `bg${id}` } }), `⑥ ${tool}`);
      expect([recFile(root, id), tomb(root, id)], `⑥ ${id}`).toEqual([false, true]);
      expect(pendingPaths()).toContain(`src/kill-${id}.js`);
    }
    expect(reasonOf(stopHook(root), '送达后台关闭时的最终对比结果')).toContain('src/kill-G.js');
    // ⑦ Stop：非后台记录、匿名非后台记录、被拒绝调用留下的记录关闭；后台记录不受影响
    quiet(bgStart(root, 'node bg-H.js', 'H', 'bgH'), '⑦ 后台 H');
    expect(snapshot(root, 'node fg.js', 'I').exitCode).toBe(0);
    expect(preToolUse(root, 'Bash', { command: 'node anon.js' }, null).exitCode).toBe(0);
    const anon = records(root).map(n => n.slice(0, -5)).find(n => n.startsWith('anon-'))!;
    expect(anon).toMatch(/^anon-\d+-[a-z0-9]+$/);
    // 被用户拒绝：PreToolUse 已拍快照，宿主未执行、不发 PostToolUse
    const denied = preToolUse(root, 'Bash', { command: 'node denied.js' }, 'J');
    expect(denied.exitCode).toBe(0);
    expect(recFile(root, 'J')).toBe(true);
    writeFileSync(join(root, 'src/stop.js'), 's');
    expect(reasonOf(stopHook(root), '⑦ Stop 最终对比')).toContain('src/stop.js');
    for (const id of ['I', anon, 'J']) expect([recFile(root, id), tomb(root, id)], `⑦ ${id}`).toEqual([false, true]);
    expect(recFile(root, 'H'), 'Stop 不关闭后台记录').toBe(true);
    // ⑧ SessionStart、补查无变化：不关闭
    expect(hook(root, 'SessionStart', null, null, null, { source: 'startup' }, {}, ['check', '--session-start']).exitCode).toBe(0);
    expect(preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId()).exitCode).toBe(0);
    expect(recFile(root, 'H')).toBe(true);
    expect(readRecord(root, 'H').closed).toBe(false);
  }, TIMEOUT);

  it('UT-S09-396: 匿名记录与无标识结束事件', () => {
    const root = fixture();
    expect(snapshot(root, 'node r2.js', 'R2').exitCode).toBe(0);
    const pre = preToolUse(root, 'Bash', { command: NODE_WRITE('src/a.js', 'anon') }, null);
    expect(pre.exitCode).toBe(0);
    const anon = records(root).map(n => n.slice(0, -5)).filter(n => n !== 'R2');
    expect(anon).toHaveLength(1);
    expect(anon[0]).toMatch(/^anon-\d+-[a-z0-9]+$/);
    expect(readRecord(root, anon[0]).anonymous).toBe(true);
    expect(readRecord(root, 'R2').anonymous).toBe(false);
    bash(root, NODE_WRITE('src/a.js', 'anon'));
    // 缺标识的 PostToolUse：只触发对比（报告 src/a.js，无法唯一归因），不关闭任何记录、不按「最近一次」关联
    const reason = reasonOf(postToolUse(root, NODE_WRITE('src/a.js', 'anon'), null), '无标识结束事件');
    expect(listed(reason)).toEqual(['src/a.js']);
    expect(reason).toContain(UNATTRIBUTED);
    expect(records(root).sort()).toEqual([`${anon[0]}.json`, 'R2.json'].sort());
    expect(tomb(root, anon[0]) || tomb(root, 'R2')).toBe(false);
    quiet(postToolUse(root, 'x', null), '再次无标识结束事件不重复');
    expect(records(root)).toHaveLength(2);
  }, TIMEOUT);

  it('UT-S09-397: 基线规则：最早未关闭记录、新快照不吸收、rebase-only 局部更新', () => {
    const root = fixture();
    expect(snapshot(root, 'node r1.js', 'R1', true).exitCode).toBe(0);
    const r1Before = readRecord(root, 'R1').entries;
    writeFileSync(join(root, 'src/a.js'), 'X\n');
    // R3 在 a.js 已被改动后建立：其快照中 a.js 已是 X
    expect(snapshot(root, 'node r3.js', 'R3', true).exitCode).toBe(0);
    expect(readRecord(root, 'R3').entries['src/a.js'].digest).toBe(rawOid(root, 'src/a.js'));
    // R3 的 check：以 R1 为「执行前」基线，a.js 仍被报告，不被 R3 快照吸收
    const reason = reasonOf(hook(root, 'PostToolUse', 'Bash', { command: 'node r3.js', run_in_background: true }, 'R3',
      { tool_response: { backgroundTaskId: 'b3' } }), 'R3 的 check');
    expect(listed(reason)).toEqual(['src/a.js']);
    expect(recFile(root, 'R3')).toBe(true);
    // rebase-only：本次调用改动的路径集合为 {src/b.js}
    expect(engineCli(root, ['snapshot', '--rebase-only'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git checkout -- src/b.js' }, tool_use_id: 'RB' })).exitCode).toBe(0);
    expect(readRecord(root, 'RB').rebase_only).toBe(true);
    writeFileSync(join(root, 'src/b.js'), 'B2\n');
    quiet(postToolUse(root, 'git checkout -- src/b.js', 'RB'), 'rebase-only 不报告');
    expect(recFile(root, 'RB')).toBe(false);
    const nb = rawOid(root, 'src/b.js');
    const r1 = readRecord(root, 'R1').entries;
    const r3 = readRecord(root, 'R3').entries;
    expect([r1['src/b.js'].digest, r3['src/b.js'].digest]).toEqual([nb, nb]);
    expect(r1['src/a.js'], 'a.js 基线不动').toEqual(r1Before['src/a.js']);
    for (const k of Object.keys(r1Before).filter(k => k !== 'src/b.js')) expect(r1[k], k).toEqual(r1Before[k]);
  }, TIMEOUT);

  it('UT-S09-401: 提案边界函数', () => {
    const root = fixture();
    expect(snapshot(root, 'node r1.js', 'R1', true).exitCode).toBe(0);
    writeFileSync(join(root, 'src/a.js'), 'pre\n');
    // boundary-start：把未报告的 src/a.js 写入 pending
    const bs = engineCli(root, ['boundary-start']);
    expect(bs.exitCode, bs.stderr).toBe(0);
    expect(readJsonl(root, 'pending-reports.jsonl').map(i => i.path)).toEqual(['src/a.js']);
    // 写 guard 后：check 不报告新变化，但照常送达 pending、照常关闭 / 去重
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'p', module: 'core' }));
    writeFileSync(join(root, 'src/b.js'), 'during\n');
    expect(snapshot(root, 'node fg.js', 'F').exitCode).toBe(0);
    const during = reasonOf(postToolUse(root, 'node fg.js', 'F'), '提案期间 check');
    expect(listed(during)).toEqual(['src/a.js']);
    expect([recFile(root, 'F'), tomb(root, 'F')], '照常关闭').toEqual([false, true]);
    quiet(postToolUse(root, 'ls', null), '提案期间不报告 b.js、pending 不重复');
    // boundary-end：R1 全部条目基线更新为当时内容
    const be = engineCli(root, ['boundary-end']);
    expect(be.exitCode, be.stderr).toBe(0);
    const r1 = readRecord(root, 'R1').entries;
    expect(r1['src/a.js'].digest).toBe(rawOid(root, 'src/a.js'));
    expect(r1['src/b.js'].digest).toBe(rawOid(root, 'src/b.js'));
    // 删 guard 后的 check：只对比不更新基线
    rmSync(join(root, 'logos/.openlogos-guard'));
    quiet(postToolUse(root, 'ls', null), '归档后不误报提案期间改动');
    writeFileSync(join(root, 'src/a.js'), 'after\n');
    const before = readRecord(root, 'R1');
    expect(listed(reasonOf(postToolUse(root, 'ls', null), '归档后的新变化'))).toEqual(['src/a.js']);
    expect(readRecord(root, 'R1').entries).toEqual(before.entries);
    expect(readRecord(root, 'R1').generation).toBe(before.generation);
    // 引擎缺失：边界钩子跳过，change / archive 退出码不受影响
    const bare = fixture('G-repo', false);
    expect(runGuardBoundary(bare, 'boundary-start')).toEqual({ status: 'skipped' });
    const ch = runCli(bare, ['change', 'p9']);
    expect(ch.status, ch.stderr).toBe(0);
    expect(existsSync(join(bare, 'logos/.openlogos-guard'))).toBe(true);
    archiveReady(bare, 'p9');
    const ar = runCli(bare, ['archive', 'p9']);
    expect(ar.status, ar.stderr).toBe(0);
    expect(existsSync(join(bare, 'logos/.openlogos-guard'))).toBe(false);
    expect(existsSync(join(bare, RUNTIME, 'guard-records'))).toBe(false);
  }, TIMEOUT);

  it('UT-S09-416: 项目级锁 state.lock', async () => {
    const root = fixture();
    const lock = join(root, RUNTIME, 'state.lock');
    // O_CREAT|O_EXCL：已存在的锁文件不被覆盖
    writeLock(root, process.pid, 0);
    const pre = readFileSync(lock, 'utf-8');
    expect(engine.acquireLock(root, 0)).toBeNull();
    expect(readFileSync(lock, 'utf-8')).toBe(pre);
    rmSync(lock);
    // ① A 持锁时 B 请求：B 等待至 A 释放后获得
    const a = await holdLock(root, 1500);
    const content = JSON.parse(readFileSync(lock, 'utf-8'));
    expect(content).toMatchObject({ pid: a.child.pid, host: expect.any(String) });
    expect(Number.isFinite(Date.parse(content.acquired_at))).toBe(true);
    const t1 = Date.now();
    const relB = engine.acquireLock(root);
    expect(relB, '① B 获得').not.toBeNull();
    expect(Date.now() - t1).toBeGreaterThanOrEqual(800);
    expect(JSON.parse(readFileSync(lock, 'utf-8')).pid).toBe(process.pid);
    relB();
    expect(existsSync(lock)).toBe(false);
    await a.exited;
    // ② A 持锁 6 秒：B 等待 5 秒后放弃
    const a2 = await holdLock(root, 6000);
    const t2 = Date.now();
    expect(engine.acquireLock(root), '② 放弃').toBeNull();
    const waited = Date.now() - t2;
    expect(waited).toBeGreaterThanOrEqual(4900);
    expect(waited).toBeLessThan(6000);
    await a2.release();
    // ③ acquired_at 早于 31 秒且 pid 不存在：打破并获得
    writeLock(root, deadPid(), 31_000);
    const rel3 = engine.acquireLock(root, 0);
    expect(rel3, '③').not.toBeNull();
    expect(JSON.parse(readFileSync(lock, 'utf-8')).pid).toBe(process.pid);
    rel3();
    // ④ acquired_at 早于 31 秒但 pid 仍存活：不打破
    const alive = await holdLock(root);
    backdateLock(root);
    expect(engine.acquireLock(root, 300), '④').toBeNull();
    expect(JSON.parse(readFileSync(lock, 'utf-8')).pid).toBe(alive.child.pid);
    await alive.release();
    // ⑤ acquired_at 早于 10 秒且 pid 不存在：不打破
    writeLock(root, deadPid(), 10_000);
    expect(engine.acquireLock(root, 300), '⑤').toBeNull();
    expect(existsSync(lock)).toBe(true);
    // ⑥ 回收互斥 state.lock.reclaim 被存活进程持有：不回收过期锁（锁与互斥均不变）
    const mutex = `${lock}.reclaim`;
    writeLock(root, deadPid(), 31_000);
    const staleText = readFileSync(lock, 'utf-8');
    writeFileSync(mutex, JSON.stringify({ pid: process.pid, host: 'h', acquired_at: new Date().toISOString(), token: 'live' }));
    expect(engine.acquireLock(root, 300), '⑥ 互斥存活').toBeNull();
    expect(readFileSync(lock, 'utf-8')).toBe(staleText);
    expect(JSON.parse(readFileSync(mutex, 'utf-8')).token).toBe('live');
    // ⑦ 回收互斥的持有者已不存在（回收中途崩溃）：打破互斥后回收过期锁
    writeFileSync(mutex, JSON.stringify({ pid: deadPid(), host: 'h', acquired_at: new Date().toISOString(), token: 'dead' }));
    const rel7 = engine.acquireLock(root, 2000);
    expect(rel7, '⑦').not.toBeNull();
    expect(JSON.parse(readFileSync(lock, 'utf-8')).pid).toBe(process.pid);
    expect(existsSync(mutex), '回收互斥已释放').toBe(false);
    rel7();
    // ⑧ 并发回收：多个进程同时发现同一把过期锁，在「判定过期」与「替换锁文件」之间注入停顿放大竞态窗口；
    //    断言只有一个进程回收成功、任意时刻至多一个持有者、持锁期间锁文件始终是自己的
    writeLock(root, deadPid(), 31_000);
    const staleIno = engine.lockIdentity(lock).ino;
    const trace = join(tempRoot(), 'reclaim-trace.jsonl');
    const holds = join(tempRoot(), 'holds.jsonl');
    const script = `const e=require(${JSON.stringify(ENGINE_SRC)});const fs=require('fs');
const lock=${JSON.stringify(lock)};const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
const r=e.acquireLock(${JSON.stringify(root)},30000);if(!r)process.exit(3);
const t0=Date.now();const own=()=>{try{return JSON.parse(fs.readFileSync(lock,'utf-8')).pid===process.pid}catch{return false}};
const o1=own();sleep(150);const o2=own();
fs.appendFileSync(${JSON.stringify(holds)},JSON.stringify({pid:process.pid,t0,t1:Date.now(),o1,o2})+'\\n');r();`;
    const env = { ...process.env, OPENLOGOS_GUARD_TEST_FAULT: 'pause-reclaim:300', OPENLOGOS_GUARD_TRACE: trace };
    const N = 5;
    const runs = await Promise.all(Array.from({ length: N }, () => new Promise<number>(res => {
      const c = spawn('node', ['-e', script], { env, stdio: 'ignore' });
      cleanups.push(() => { try { c.kill('SIGKILL'); } catch { /* 已退出 */ } });
      c.on('exit', code => res(code ?? -1));
    })));
    expect(runs, '全部进程最终获得锁').toEqual(Array(N).fill(0));
    const ev = readFileSync(trace, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const judged = new Set(ev.filter(e => e.op === 'lock-stale-judged' && e.ino === staleIno).map(e => e.pid));
    expect(judged.size, '多个进程同时判定同一把锁过期').toBeGreaterThanOrEqual(2);
    expect(ev.filter(e => e.op === 'lock-broken'), '只有一个进程回收成功').toHaveLength(1);
    const hs = readFileSync(holds, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
      .sort((a: { t0: number }, b: { t0: number }) => a.t0 - b.t0);
    expect(hs).toHaveLength(N);
    for (const h of hs) expect([h.o1, h.o2], `pid ${h.pid} 持锁期间锁文件是自己的`).toEqual([true, true]);
    for (let i = 1; i < hs.length; i++) expect(hs[i].t0, '任意时刻至多一个持有者').toBeGreaterThanOrEqual(hs[i - 1].t1);
    expect(existsSync(lock)).toBe(false);
    expect(existsSync(mutex)).toBe(false);
  }, TIMEOUT);

  it('UT-S09-417: 原子落盘与临时文件处理', () => {
    const root = fixture();
    expect(snapshot(root, 'node r.js', 'R', true).exitCode).toBe(0);
    writeFileSync(join(root, 'src/a.js'), 'X\n');
    expect(preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId()).exitCode).toBe(0);
    reasonOf(postToolUse(root, 'ls', null), '建立 reported');
    writeFileSync(join(root, 'src/b.js'), 'Y\n');
    expect(preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId()).exitCode).toBe(0);
    const files = ['guard-records/R.json', 'pending-reports.jsonl', 'reported.jsonl', 'raw-baseline.json'];
    const orig = Object.fromEntries(files.map(f => [f, readFileSync(join(root, RUNTIME, f), 'utf-8')]));
    for (const f of files) expect(orig[f].length, f).toBeGreaterThan(0);
    // 在 rename 之前注入失败：原文件不变且可解析；同目录留下 *.tmp-<pid>-<rand>
    const prev = process.env.OPENLOGOS_GUARD_TEST_FAULT;
    process.env.OPENLOGOS_GUARD_TEST_FAULT = 'throw-before-rename';
    try {
      for (const f of files) expect(() => engine.writeAtomic(join(root, RUNTIME, f), '{"broken":')).toThrow(/rename 之前失败/);
    } finally {
      if (prev === undefined) delete process.env.OPENLOGOS_GUARD_TEST_FAULT; else process.env.OPENLOGOS_GUARD_TEST_FAULT = prev;
    }
    for (const f of files) expect(readFileSync(join(root, RUNTIME, f), 'utf-8'), f).toBe(orig[f]);
    expectStateParsable(root);
    const residue = tmpResidue(root);
    for (const f of files) {
      const base = f.split('/').pop()!;
      expect(residue.some(r => r.split('/').pop()!.startsWith(`${base}.tmp-${process.pid}-`)), `${f} 先写同目录临时文件`).toBe(true);
    }
    // 预置残留：读取忽略
    writeFileSync(join(root, RUNTIME, 'guard-records', 'x.json.tmp-123-ab'), '{"id":"x","closed":false');
    expect(records(root)).toEqual(['R.json']);
    expect(engine.loadOpenRecords(root, false).map((r: { id: string }) => r.id)).toEqual(['R']);
    // 下次持锁时清理（其他进程的临时文件，持锁时必为残留）
    const trace = join(tempRoot(), 'trace.jsonl');
    expect(hook(root, 'PostToolUse', 'Bash', { command: 'ls' }, null, {}, { OPENLOGOS_GUARD_TRACE: trace }).exitCode).toBe(2);
    expect(tmpResidue(root)).toEqual([]);
    expect(traceEvents(trace).filter(e => e.op === 'tmp-cleaned').map(e => e.name)).toContain('x.json.tmp-123-ab');
    expectStateParsable(root);
  }, TIMEOUT);

  it('UT-S09-418: 记录代际与墓碑', () => {
    const root = fixture();
    expect(snapshot(root, 'node r.js', 'R', true).exitCode).toBe(0);
    const rec = readRecord(root, 'R');
    rec.generation = 3;
    writeFileSync(join(root, RUNTIME, 'guard-records', 'R.json'), JSON.stringify(rec));
    const rel = engine.acquireLock(root, 0);
    try {
      // ① 代际落后（2 < 3）的更新：丢弃
      expect(engine.saveRecord(root, { ...rec, generation: 2, entries: {} })).toBe(false);
      expect(readRecord(root, 'R').generation).toBe(3);
      expect(Object.keys(readRecord(root, 'R').entries).length).toBeGreaterThan(0);
      // ② 关闭：记录文件删除且写入墓碑
      engine.closeRecord(root, 'R');
      expect([recFile(root, 'R'), tomb(root, 'R')]).toEqual([false, true]);
      // ③ 迟到写入（基线更新、关闭、追加条目）：看到墓碑即丢弃，R 不复活
      expect(engine.saveRecord(root, { ...rec, generation: 4, entries: { ...rec.entries, 'src/a.js': { exists: true, type: 'file', digest: 'x' } } })).toBe(false);
      expect(engine.updateRecord(root, { ...rec, entries: { ...rec.entries, 'src/new.js': { exists: true, type: 'file', digest: 'y' } } })).toBe(false);
      engine.closeRecord(root, 'R');
      expect([recFile(root, 'R'), tomb(root, 'R')]).toEqual([false, true]);
      expect(engine.loadOpenRecords(root).map((r: { id: string }) => r.id)).toEqual([]);
    } finally { rel(); }
    // ④ 下一会话 SessionStart：墓碑被清理
    expect(hook(root, 'SessionStart', null, null, null, { source: 'startup' }, {}, ['check', '--session-start']).exitCode).toBe(0);
    expect(tomb(root, 'R')).toBe(false);
    expect(recFile(root, 'R')).toBe(false);
  }, TIMEOUT);

  it('UT-S09-419: 拿不到锁时的降级', async () => {
    const root = fixture();
    expect(snapshot(root, 'node r1.js', 'R1', true).exitCode).toBe(0);
    const holder = await holdLock(root);
    const W = { OPENLOGOS_GUARD_TEST_LOCK_WAIT_MS: '300' };
    // ① PreToolUse 拍快照拿不到锁：按非 git 回落判定（node -e 的回落结论与修改前基准一致），不写执行记录
    const base = (JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as { cases: Array<{ fixture: string; key: string; exit: number }> })
      .cases.find(c => c.fixture === 'N-repo' && c.key === 'Bash node -e writeFileSync')!;
    const pre = preToolUse(root, 'Bash', { command: "node -e \"require('fs').writeFileSync('src/a.js','y')\"" }, 'P1', {}, W);
    expect(pre.exitCode).toBe(base.exit);
    expect(recFile(root, 'P1')).toBe(false);
    // ② PostToolUse 有 2 条待报告项 → O_EXCL 写入 pending-spill/<pid>-<时间戳>.json
    writeFileSync(join(root, 'src/a.js'), 'A2\n');
    writeFileSync(join(root, 'src/b.js'), 'B2\n');
    expect(postToolUse(root, 'ls', null, false, 'Bash', W).exitCode).toBe(0);
    expect(spills(root)).toHaveLength(1);
    expect(spills(root)[0]).toMatch(/^\d+-\d+\.json$/);
    // ③ Stop 有 1 条（与已溢出项去重）
    writeFileSync(join(root, 'src/c.js'), 'C\n');
    expect(engineCli(root, ['check', '--stop'], JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false }), W).exitCode).toBe(0);
    const sp = spills(root);
    expect(sp).toHaveLength(2);
    // spill 文件名为 <pid>-<时间戳>，pid 位数不同时字典序不等于写入顺序，故按内容比对、不依赖文件顺序
    const items = sp.map(n => (JSON.parse(readFileSync(join(root, RUNTIME, 'pending-spill', n), 'utf-8')) as Array<{ path: string }>).map(i => i.path).sort())
      .sort((x, y) => x[0].localeCompare(y[0]));
    expect(items).toEqual([['src/a.js', 'src/b.js'], ['src/c.js']]);
    expect(existsSync(join(root, RUNTIME, 'pending-reports.jsonl')) ? readJsonl(root, 'pending-reports.jsonl') : []).toEqual([]);
    // ④ 锁释放后任意检查点持锁：合并后删除，无重复
    await holder.release();
    expect(preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId()).exitCode).toBe(0);
    expect(spills(root)).toEqual([]);
    const pend = readJsonl(root, 'pending-reports.jsonl').map(i => i.path).sort();
    expect(pend).toEqual(['src/a.js', 'src/b.js', 'src/c.js']);
    const reason = reasonOf(stopHook(root), '④ 送达');
    expect(listed(reason).sort()).toEqual(['src/a.js', 'src/b.js', 'src/c.js']);
    quiet(stopHook(root), '④ 不重复');
  }, TIMEOUT);

  it('UT-S09-420: 多文件更新中断只会多报', () => {
    const root = fixture();
    for (const id of ['R1', 'R2', 'R3']) expect(snapshot(root, `node ${id}.js`, id, true).exitCode).toBe(0);
    const old = readRecord(root, 'R3').entries['src/b.js'].digest;
    // 独立 git 调用的 rebase：在更新 R2 之后注入进程终止
    expect(engineCli(root, ['snapshot', '--rebase-only'], JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git checkout x -- src/b.js' }, tool_use_id: 'RB' })).exitCode).toBe(0);
    writeFileSync(join(root, 'src/b.js'), 'rebased\n');
    const killed = spawnSync('node', [ENGINE_SRC, 'check'], {
      input: postInput(root, 'git checkout x -- src/b.js', 'RB'), cwd: root, encoding: 'utf-8',
      env: cleanEnv({ CLAUDE_PROJECT_DIR: root, OPENLOGOS_GUARD_TEST_FAULT: 'kill-after-record-writes:2' }),
    });
    expect(killed.signal).toBe('SIGKILL');
    const nb = rawOid(root, 'src/b.js');
    expect(readRecord(root, 'R1').entries['src/b.js'].digest).toBe(nb);
    expect(readRecord(root, 'R2').entries['src/b.js'].digest).toBe(nb);
    expect(readRecord(root, 'R3').entries['src/b.js'].digest).toBe(old);
    // 被中断进程留下的锁：模拟时间流逝 31 秒后过期被打破
    backdateLock(root);
    const reason = reasonOf(postToolUse(root, 'ls', null), '之后检查');
    expect(listed(reason)).toEqual(['src/b.js']);
    expect(reason).toContain(UNATTRIBUTED);
  }, TIMEOUT);
});

describe('S09-F 执行记录生命周期 — 场景', () => {
  it('ST-S09-158: 中断后未闭合快照补查', () => {
    const root = fixture();
    const cmd = NODE_WRITE('src/a.js', 'int');
    // ① PreToolUse 后真实执行，不发送结束事件
    expect(preToolUse(root, 'Bash', { command: cmd }, 'T1').exitCode).toBe(0);
    expect(bash(root, cmd).status).toBe(0);
    // ② 下一次 Edit 的 PreToolUse：补查不阻断，pending 新增 src/a.js
    expect(preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId()).exitCode).toBe(0);
    expect(readJsonl(root, 'pending-reports.jsonl').map(i => i.path)).toEqual(['src/a.js']);
    // ③ 下一次 Bash ls 完整链：PostToolUse 送达
    expect(listed(reasonOf(chain(root, 'ls').post, '③'))).toEqual(['src/a.js']);
    expect(recFile(root, 'T1'), '①的记录未关闭（未收到 T1 的结束事件）').toBe(true);
    // ④ 另一轮：重复①后直接 Stop → 送达；再次 Stop 不重复
    const root2 = fixture();
    expect(preToolUse(root2, 'Bash', { command: cmd }, 'T2').exitCode).toBe(0);
    expect(bash(root2, cmd).status).toBe(0);
    expect(listed(reasonOf(stopHook(root2), '④ Stop'))).toEqual(['src/a.js']);
    quiet(stopHook(root2), '④ 再次 Stop');
    // 依据 spec「执行记录生命周期」关闭条件 3（97ad143 补充）：Stop 对非后台记录做最终对比后关闭
    expect([recFile(root2, 'T2'), tomb(root2, 'T2')]).toEqual([false, true]);
  }, TIMEOUT);

  it('ST-S09-159: 补查之后才写入的后台写入', () => {
    const root = fixture();
    const w = startBgWriter(root, 'src/a.js', 'bg\n');
    // ① 后台 Bash：PreToolUse → PostToolUse（tool_response 含后台任务标识）
    quiet(bgStart(root, 'node delayed-writer.js', 'BG1', 'task-bg1'), '①');
    expect(readRecord(root, 'BG1')).toMatchObject({ background: true, background_task_id: 'task-bg1', closed: false });
    // ② 任意工具 PreToolUse 补查：无报告、记录仍在
    expect(preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId()).exitCode).toBe(0);
    expect(readJsonl(root, 'pending-reports.jsonl')).toEqual([]);
    expect(recFile(root, 'BG1')).toBe(true);
    // ③ 触发写入
    w.trigger();
    // ④ 新的前台 Bash（会拍快照的命令）完整链：新快照不把该变化当作执行前已有改动
    const c = chain(root, 'node -e "0"');
    expect(c.recordAfterPre).toBe(true);
    const reason = reasonOf(c.post, '④');
    expect(listed(reason)).toEqual(['src/a.js']);
    expect(reason).toContain('未结束的后台调用');
    expect(reason).toContain('node delayed-writer.js');
    quiet(chain(root, 'ls').post, '④ ls 不重复');
  }, TIMEOUT);

  it('ST-S09-160: 迟到结束事件与无标识结束事件', () => {
    const root = fixture();
    const cmd = NODE_WRITE('src/a.js', 'late');
    expect(preToolUse(root, 'Bash', { command: cmd }, 't1').exitCode).toBe(0);
    expect(bash(root, cmd).status).toBe(0);
    // ② 补查发现并经 Stop 送达
    expect(preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId()).exitCode).toBe(0);
    expect(listed(reasonOf(stopHook(root), '② Stop'))).toEqual(['src/a.js']);
    // ③ 迟到的 t1 PostToolUse：最终对比后关闭（Stop 已关闭则看到墓碑），不重复报告
    quiet(postToolUse(root, cmd, 't1'), '③');
    expect([recFile(root, 't1'), tomb(root, 't1')]).toEqual([false, true]);
    // ④ 缺 tool_use_id 的调用：生成 anon- 记录；缺标识结束事件报告一次、不关闭任何记录
    const cmd2 = NODE_WRITE('src/b.js', 'anon');
    expect(preToolUse(root, 'Bash', { command: cmd2 }, null).exitCode).toBe(0);
    const anon = records(root).find(n => n.startsWith('anon-'));
    expect(anon).toBeDefined();
    expect(bash(root, cmd2).status).toBe(0);
    expect(listed(reasonOf(postToolUse(root, cmd2, null), '④'))).toEqual(['src/b.js']);
    expect(records(root)).toContain(anon);
    quiet(postToolUse(root, cmd2, null), '④ 不重复');
    expect(records(root)).toContain(anon);
  }, TIMEOUT);

  it('ST-S09-161: 后台运行期间 checkout / pull 不误报，后台随后改源码仍被发现', () => {
    const root = fixture();
    const main = git(root, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
    expect(git(root, ['config', 'pull.rebase', 'false']).status).toBe(0);
    expect(git(root, ['checkout', '-q', '-b', 'feature']).status).toBe(0);
    writeFileSync(join(root, 'src/a.js'), 'feat-a\n');
    commit(root, 'feature a');
    const remote = join(tempRoot(), 'remote.git');
    expect(git(root, ['clone', '-q', '--bare', root, remote]).status).toBe(0);
    const work = join(tempRoot(), 'work');
    expect(git(root, ['clone', '-q', '-b', 'feature', remote, work]).status).toBe(0);
    for (const [k, v] of [['user.name', 't'], ['user.email', 't@example.invalid'], ['commit.gpgsign', 'false']]) git(work, ['config', k, v]);
    writeFileSync(join(work, 'src/b.js'), 'remote-b\n');
    expect(git(work, ['commit', '-qam', 'remote b']).status).toBe(0);
    expect(git(work, ['push', '-q', 'origin', 'feature']).status).toBe(0);
    expect(git(root, ['checkout', '-q', main]).status).toBe(0);
    // ① 后台 dev-server
    const w = startBgWriter(root, 'src/a.js', 'bg-dev\n');
    quiet(bgStart(root, 'node dev-server.js', 'DEV', 'task-dev'), '①');
    const before = readRecord(root, 'DEV').entries;
    // ② 独立 git checkout；③ 独立 git pull：前后 rebase-only，不报告
    for (const cmd of ['git checkout -q feature', `git pull -q ${remote} feature`]) {
      const c = chain(root, cmd);
      expect(c.pre.exitCode).toBe(0);
      expect(c.recordAfterPre, `${cmd} snapshot --rebase-only`).toBe(true);
      expect(c.exec!.status, c.exec!.stderr).toBe(0);
      quiet(c.post, cmd);
      expect(recFile(root, c.id), `${cmd} check --rebase-only 后删除`).toBe(false);
    }
    expect(readFileSync(join(root, 'src/b.js'), 'utf-8')).toBe('remote-b\n');
    // ④ ls 完整链与 Stop：不报告分支切换与 pull 带来的变化
    quiet(chain(root, 'ls').post, '④ ls');
    quiet(stopHook(root), '④ Stop');
    const after = readRecord(root, 'DEV').entries;
    const changed = Object.keys({ ...before, ...after }).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
    expect(changed).toEqual(['src/a.js', 'src/b.js']);
    // ⑤ 后台改 src/a.js；⑥ ls 完整链 exit 2
    w.trigger();
    expect(listed(reasonOf(chain(root, 'ls').post, '⑥'))).toEqual(['src/a.js']);
  }, TIMEOUT);

  it('ST-S09-162: 跨会话（含 /clear）延迟写入', () => {
    const phase = (root: string) => {
      const r = spawnSync('bash', [PHASE], { cwd: root, encoding: 'utf-8', timeout: 60_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: root, PATH: process.env.PATH }) });
      expect(r.status, r.stderr).toBe(0);
      return JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } };
    };
    // 一轮：② 先于 ③
    const root = fixture();
    quiet(bgStart(root, 'node session-bg.js', 'R1', 'task-r1'), '① s1 后台调用');
    // ② 模拟 /clear：不发送任何结束事件，以 s2 发送 SessionStart（phase launcher 调用 check --session-start）
    const ctx = phase(root);
    expect(ctx.hookSpecificOutput.additionalContext).not.toContain('src/a.js');
    expect(readRecord(root, 'R1').closed).toBe(false);
    // ③ 后台改 src/a.js；④ s2 中 Bash ls 完整链 exit 2，归因 R1 命令
    writeFileSync(join(root, 'src/a.js'), 'bg-after-clear\n');
    const reason = reasonOf(chain(root, 'ls').post, '④');
    expect(listed(reason)).toEqual(['src/a.js']);
    expect(reason).toContain('node session-bg.js');
    // ⑤ 另一轮：③ 先于 ②——SessionStart 注入上下文含该变化，下一次 Bash 结束事件送达
    const root2 = fixture();
    quiet(bgStart(root2, 'node session-bg.js', 'R1', 'task-r1'), '⑤ ①');
    writeFileSync(join(root2, 'src/a.js'), 'bg-before-clear\n');
    const ctx2 = phase(root2);
    expect(ctx2.hookSpecificOutput.additionalContext).toContain('src/a.js');
    expect(ctx2.hookSpecificOutput.additionalContext).toContain('=== End OpenLogos Context ===');
    expect(recFile(root2, 'R1')).toBe(true);
    expect(listed(reasonOf(chain(root2, 'ls').post, '⑤ 下一次 Bash 结束事件'))).toEqual(['src/a.js']);
    quiet(stopHook(root2), '⑤ 不重复');
  }, TIMEOUT);

  it('ST-S09-163: 宿主确认后台结束后关闭记录', () => {
    const root = fixture();
    quiet(bgStart(root, 'node bg-r1.js', 'R1', 'bash_1'), '①');
    // ② 查询类工具显示运行中
    quiet(hook(root, 'PostToolUse', 'BashOutput', { bash_id: 'bash_1' }, nextId(), { tool_response: { shellId: 'bash_1', status: 'running', stdout: '...' } }), '② BashOutput');
    quiet(hook(root, 'PostToolUse', 'TaskOutput', { task_id: 'bash_1', block: false }, nextId(), {
      tool_response: { retrieval_status: 'not_ready', task: { task_id: 'bash_1', status: 'running' } },
    }), '② TaskOutput');
    expect(recFile(root, 'R1')).toBe(true);
    // ③ 显示已完成：最终对比后记录文件删除
    quiet(hook(root, 'PostToolUse', 'TaskOutput', { task_id: 'bash_1', block: true }, nextId(), {
      tool_response: { retrieval_status: 'success', task: { task_id: 'bash_1', status: 'completed', exitCode: 0 } },
    }), '③');
    expect([recFile(root, 'R1'), tomb(root, 'R1')]).toEqual([false, true]);
    // ④ 另一轮：KillShell / TaskStop 成功
    quiet(bgStart(root, 'node bg-r2.js', 'R2', 'bash_2'), '④ R2');
    quiet(hook(root, 'PostToolUse', 'KillShell', { shell_id: 'bash_2' }, nextId(), { tool_response: { message: 'Successfully killed shell: bash_2 (node bg-r2.js)', shell_id: 'bash_2' } }), '④ KillShell');
    expect(recFile(root, 'R2')).toBe(false);
    quiet(bgStart(root, 'node bg-r3.js', 'R3', 'bash_3'), '④ R3');
    quiet(hook(root, 'PostToolUse', 'TaskStop', { task_id: 'bash_3' }, nextId(), { tool_response: { message: 'Successfully stopped task: bash_3', task_id: 'bash_3', task_type: 'local_bash' } }), '④ TaskStop');
    expect(recFile(root, 'R3')).toBe(false);
    expect(records(root)).toEqual([]);
    // ⑤ 关闭后在 hook 之外手动改 src/a.js：无未关闭记录时按执行前已有改动处理，不报告、不出现 R1 归因
    writeFileSync(join(root, 'src/a.js'), 'manual\n');
    const c = chain(root, 'ls');
    quiet(c.post, '⑤');
    expect(c.post!.stderr).not.toContain('bg-r1.js');
  }, TIMEOUT);

  /** ST-S09-164 / 165 共用 ①～④：后台 R1 → 真实 change p1 → 提案期间改动 → 真实 archive p1。 */
  function proposalRound(root: string, trace: string): void {
    quiet(bgStart(root, 'node dev.js', 'R1', 'task-r1'), '①');
    const ch = runCli(root, ['change', 'p1'], { OPENLOGOS_GUARD_TRACE: trace });
    expect(ch.status, ch.stderr).toBe(0);
    const bs = traceEvents(trace).filter(e => e.op === 'boundary');
    expect(bs.map(e => [e.name, e.guard_exists]), '② 写 guard 前调用 boundary-start').toEqual([['boundary-start', false]]);
    expect(existsSync(join(root, 'logos/.openlogos-guard'))).toBe(true);
    // ③ 有提案时 Edit src/a.js 与 Bash 改 src/b.js：检查点不报告
    expect(preToolUse(root, 'Edit', { file_path: 'src/a.js', old_string: 'a', new_string: 'P' }, nextId()).exitCode).toBe(0);
    writeFileSync(join(root, 'src/a.js'), 'P\n');
    const c = chain(root, NODE_WRITE('src/b.js', 'P'));
    expect(c.recordAfterPre, '提案期间照常拍快照').toBe(true);
    quiet(c.post, '③ Bash');
    quiet(stopHook(root), '③ Stop');
    // ④ 真实 archive：删 guard 前 R1 基线整体更新
    archiveReady(root, 'p1');
    const ar = runCli(root, ['archive', 'p1'], { OPENLOGOS_GUARD_TRACE: trace });
    expect(ar.status, ar.stderr).toBe(0);
    expect(traceEvents(trace).filter(e => e.op === 'boundary').map(e => [e.name, e.guard_exists])).toEqual([['boundary-start', false], ['boundary-end', true]]);
    expect(existsSync(join(root, 'logos/.openlogos-guard'))).toBe(false);
    const r1 = readRecord(root, 'R1').entries;
    expect(r1['src/a.js'].digest).toBe(rawOid(root, 'src/a.js'));
    expect(r1['src/b.js'].digest).toBe(rawOid(root, 'src/b.js'));
  }

  it('ST-S09-164: 提案期间改动在归档后不误报', () => {
    const root = fixture();
    proposalRound(root, join(tempRoot(), 'trace.jsonl'));
    // ⑤ ls 完整链与 Stop：不报告 a.js、b.js
    quiet(chain(root, 'ls').post, '⑤ ls');
    quiet(stopHook(root), '⑤ Stop');
  }, TIMEOUT);

  it('ST-S09-165: 归档后、首次检查前的后台写入', () => {
    const root = fixture();
    proposalRound(root, join(tempRoot(), 'trace.jsonl'));
    writeFileSync(join(root, 'src/a.js'), 'bg-after-archive\n');
    const reason = reasonOf(chain(root, 'ls').post, '归档后的后台写入');
    expect(listed(reason)).toEqual(['src/a.js']);
  }, TIMEOUT);

  it('ST-S09-166: 提案开始前未检查的后台写入存为待报告项', () => {
    const run = (deliverDuring: boolean) => {
      const root = fixture();
      quiet(bgStart(root, 'node dev.js', 'R1', 'task-r1'), '①');
      writeFileSync(join(root, 'src/b.js'), 'bg-before-change\n'); // ② 之后不经任何检查
      const ch = runCli(root, ['change', 'p2']);
      expect(ch.status, ch.stderr).toBe(0);
      expect(readJsonl(root, 'pending-reports.jsonl').map(i => i.path)).toEqual(['src/b.js']);
      if (deliverDuring) {
        expect(listed(reasonOf(chain(root, 'ls').post, '④ 提案期间送达'))).toEqual(['src/b.js']);
      }
      archiveReady(root, 'p2');
      const ar = runCli(root, ['archive', 'p2']);
      expect(ar.status, ar.stderr).toBe(0);
      if (deliverDuring) {
        quiet(chain(root, 'ls').post, '⑥ 已送达不重复');
      } else {
        expect(readJsonl(root, 'pending-reports.jsonl').map(i => i.path), '归档不吸收、不删除待报告项').toEqual(['src/b.js']);
        expect(listed(reasonOf(chain(root, 'ls').post, '⑥ 送达'))).toEqual(['src/b.js']);
      }
    };
    run(true);
    run(false);
  }, TIMEOUT);

  it('ST-S09-167: 边界缺失时不静默吸收', () => {
    const root = fixture();
    quiet(bgStart(root, 'node dev.js', 'R1', 'task-r1'), '①');
    const ch = runCli(root, ['change', 'p3']);
    expect(ch.status, ch.stderr).toBe(0);
    writeFileSync(join(root, 'src/a.js'), 'p3-a\n');
    quiet(chain(root, NODE_WRITE('src/b.js', 'p3-b')).post, '③ 提案期间');
    rmSync(join(root, 'logos/.openlogos-guard')); // ④ 手动删除（不经 CLI）
    const reason = reasonOf(chain(root, 'ls').post, '⑤');
    expect(listed(reason).sort()).toEqual(['src/a.js', 'src/b.js']);
    expect(reason).toContain('需向用户确认');
    quiet(chain(root, 'ls').post, '⑥ 不重复');
  }, TIMEOUT);

  it('ST-S09-168: 无法归因变化只报一次且不要求回滚', () => {
    const root = fixture();
    quiet(bgStart(root, 'node server-one.js', 'R1', 't1'), 'R1');
    quiet(bgStart(root, 'node server-two.js', 'R2', 't2'), 'R2');
    writeFileSync(join(root, 'src/a.js'), 'manual\n');
    const reason = reasonOf(chain(root, 'ls').post, '③');
    expect(listed(reason)).toEqual(['src/a.js']);
    expect(reason).toContain(UNATTRIBUTED);
    expect(reason).toContain('node server-one.js');
    expect(reason).toContain('node server-two.js');
    expect(reason).not.toContain('请回滚上述改动');
    quiet(stopHook(root), '④ Stop');
    quiet(chain(root, 'ls').post, '⑤');
  }, TIMEOUT);

  it('ST-S09-186: 8 个并发 PostToolUse 全部送达', async () => {
    const root = fixture();
    const ids: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const id = `C${i}`;
      const cmd = NODE_WRITE(`src/p${i}.js`, `p${i}`);
      expect(preToolUse(root, 'Bash', { command: cmd }, id).exitCode).toBe(0);
      expect(bash(root, cmd).status).toBe(0);
      ids.push(id);
    }
    const env = cleanEnv({ CLAUDE_PROJECT_DIR: root });
    const runs = await Promise.all(ids.map((id, i) => runAsync('node', [ENGINE_SRC, 'check'], postInput(root, NODE_WRITE(`src/p${i + 1}.js`, `p${i + 1}`), id), root, env)));
    const stop = stopHook(root);
    const all = [...runs, stop].filter(r => r.exitCode === 2).map(r => reasonOf(r, 'feedback'));
    for (const r of [...runs, stop]) expect([0, 2], r.stderr).toContain(r.exitCode);
    const counts = new Map<string, number>();
    for (const t of all) for (const p of listed(t)) counts.set(p, (counts.get(p) ?? 0) + 1);
    expect([...counts.keys()].sort()).toEqual(Array.from({ length: 8 }, (_, i) => `src/p${i + 1}.js`));
    for (const [p, n] of counts) expect(n, p).toBe(1);
    expectStateParsable(root);
    for (const f of ['pending-reports.jsonl', 'reported.jsonl']) {
      const p = join(root, RUNTIME, f);
      const lines = existsSync(p) ? readFileSync(p, 'utf-8').split('\n').filter(Boolean) : [];
      expect(new Set(lines).size, `${f} 无重复行`).toBe(lines.length);
    }
    expect(readJsonl(root, 'reported.jsonl').map(e => e.path).sort()).toEqual([...counts.keys()].sort());
    expect(existsSync(join(root, RUNTIME, 'state.lock'))).toBe(false);
    expect(records(root)).toEqual([]);
  }, TIMEOUT);

  it('ST-S09-187: 关闭记录后迟到的旧写入不复活', () => {
    const root = fixture();
    const cmd = NODE_WRITE('src/a.js', 'R');
    expect(preToolUse(root, 'Bash', { command: cmd }, 'R').exitCode).toBe(0);
    const old = readRecord(root, 'R');
    expect(bash(root, cmd).status).toBe(0);
    reasonOf(postToolUse(root, cmd, 'R'), '① 正常关闭');
    expect([recFile(root, 'R'), tomb(root, 'R')]).toEqual([false, true]);
    // ② 另一进程以 R 的旧代际重放：一次基线更新写入、一次追加条目写入（锁内）
    const script = `const e=require(${JSON.stringify(ENGINE_SRC)});const root=process.argv[1];const old=JSON.parse(process.argv[2]);
const rel=e.acquireLock(root,5000);if(!rel)process.exit(3);
const a=e.saveRecord(root,{...old,generation:old.generation+1,entries:{...old.entries,'src/a.js':{exists:true,type:'file',digest:'zz'}}});
const b=e.updateRecord(root,{...old,entries:{...old.entries,'src/late.js':{exists:true,type:'file',digest:'yy'}}});
rel();process.stdout.write(JSON.stringify([a,b]));`;
    const r = spawnSync('node', ['-e', script, root, JSON.stringify(old)], { encoding: 'utf-8' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([false, false]);
    expect([recFile(root, 'R'), tomb(root, 'R')]).toEqual([false, true]);
    // ③ ls 完整链：不出现 R 的归因
    const c = chain(root, 'ls');
    quiet(c.post, '③');
    expect(records(root)).toEqual([]);
  }, TIMEOUT);

  it('ST-S09-188: 写入中途被 kill 后状态可读', async () => {
    const root = fixture();
    const cmd = NODE_WRITE('src/a.js', 'killed');
    expect(preToolUse(root, 'Bash', { command: cmd }, 'K').exitCode).toBe(0);
    expect(bash(root, cmd).status).toBe(0);
    // PostToolUse 运行到「写完临时文件、rename 之前」暂停点时 kill -9
    const child = spawn('node', [ENGINE_SRC, 'check'], {
      cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv({ CLAUDE_PROJECT_DIR: root, OPENLOGOS_GUARD_TEST_FAULT: 'pause-before-rename' }),
    });
    cleanups.push(() => { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } });
    const exited = new Promise<string | null>(res => child.on('exit', (_c, sig) => res(sig)));
    child.stdin!.end(postInput(root, cmd, 'K'));
    await waitForAsync(() => tmpResidue(root).length > 0, '暂停点');
    child.kill('SIGKILL');
    expect(await exited).toBe('SIGKILL');
    const residue = tmpResidue(root);
    expect(residue.length).toBeGreaterThan(0);
    // 残留临时文件被读取忽略，所有状态文件可解析
    expect(records(root)).toEqual(['K.json']);
    expectStateParsable(root);
    expect(existsSync(join(root, RUNTIME, 'state.lock'))).toBe(true);
    // 锁过期（模拟 31 秒后）被打破；被中断那次的变化在之后的检查中被报告；残留临时文件被清理
    backdateLock(root);
    const c = chain(root, 'ls');
    expect(listed(reasonOf(c.post, '之后检查'))).toEqual(['src/a.js']);
    expect(tmpResidue(root)).toEqual([]);
    expect(existsSync(join(root, RUNTIME, 'state.lock'))).toBe(false);
    expectStateParsable(root);
    // 反馈已完整写出、去重表与送达状态落盘之前被 kill：下一检查点重报同一事件（多报不漏报）
    const cmd2 = NODE_WRITE('src/b.js', 'emitted');
    expect(preToolUse(root, 'Bash', { command: cmd2 }, 'K2').exitCode).toBe(0);
    expect(bash(root, cmd2).status).toBe(0);
    const k2 = spawnSync('node', [ENGINE_SRC, 'check'], {
      input: postInput(root, cmd2, 'K2'), cwd: root, encoding: 'utf-8',
      env: cleanEnv({ CLAUDE_PROJECT_DIR: root, OPENLOGOS_GUARD_TEST_FAULT: 'kill-after-emit' }),
    });
    expect(k2.signal).toBe('SIGKILL');
    expect(listed(k2.stderr), '被 kill 前反馈已写出').toEqual(['src/b.js']);
    expect(listed((JSON.parse(k2.stdout) as { reason: string }).reason)).toEqual(['src/b.js']);
    expect(readJsonl(root, 'reported.jsonl').some(e => e.path === 'src/b.js'), '去重表尚未写入').toBe(false);
    backdateLock(root);
    expect(listed(reasonOf(chain(root, 'ls').post, '下一检查点重报'))).toEqual(['src/b.js']);
    quiet(chain(root, 'ls').post, '重报后不再重复');
  }, TIMEOUT);

  it('ST-S09-189: 过期锁被打破', () => {
    const root = fixture();
    writeLock(root, deadPid(), 31_000);
    const trace = join(tempRoot(), 'trace.jsonl');
    const T = { OPENLOGOS_GUARD_TRACE: trace };
    const cmd = NODE_WRITE('src/a.js', 'stale');
    const pre = preToolUse(root, 'Bash', { command: cmd }, 'S', {}, T);
    expect(pre.exitCode, pre.stderr).toBe(0);
    expect(recFile(root, 'S'), 'PreToolUse 正常拍快照（未回落）').toBe(true);
    expect(bash(root, cmd).status).toBe(0);
    expect(listed(reasonOf(postToolUse(root, cmd, 'S', false, 'Bash', T), 'PostToolUse'))).toEqual(['src/a.js']);
    const ev = traceEvents(trace);
    const broken = ev.findIndex(e => e.op === 'lock-broken');
    expect(broken).toBeGreaterThanOrEqual(0);
    const acquired = ev.slice(broken).find(e => e.op === 'lock-acquired');
    expect(acquired, '锁文件被替换为当前进程').toBeDefined();
    expect(acquired!.pid).toBe(ev[broken].pid);
    expect(existsSync(join(root, RUNTIME, 'state.lock')), '之后释放').toBe(false);
  }, TIMEOUT);

  it('ST-S09-189: 过期锁被打破（并发回收：多个 hook 进程同时发现同一把过期锁）', async () => {
    const root = fixture();
    writeLock(root, deadPid(), 31_000);
    const staleIno = engine.lockIdentity(join(root, RUNTIME, 'state.lock')).ino;
    const trace = join(tempRoot(), 'trace.jsonl');
    // 在「判定过期」与「替换锁文件」之间注入停顿，使各进程的判定都落在第一次回收之前
    const env = cleanEnv({
      CLAUDE_PROJECT_DIR: root, OPENLOGOS_GUARD_TRACE: trace, OPENLOGOS_GUARD_TEST_FAULT: 'pause-reclaim:300',
      OPENLOGOS_GUARD_TEST_LOCK_WAIT_MS: '30000',
    });
    const ids = ['C1', 'C2', 'C3', 'C4'];
    const runs = await Promise.all(ids.map(id => runAsync('node', [ENGINE_SRC, 'snapshot'], JSON.stringify({
      session_id: 's09-life', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: NODE_WRITE('src/a.js', id) }, tool_use_id: id,
    }), root, env)));
    for (const r of runs) expect(r.exitCode, r.stderr).toBe(0);
    for (const id of ids) expect(recFile(root, id), `${id} 拍快照（未回落）`).toBe(true);
    const ev = traceEvents(trace) as Array<{ op: string; pid: number; t: number; ino?: string }>;
    const judged = new Set(ev.filter(e => e.op === 'lock-stale-judged' && e.ino === staleIno).map(e => e.pid));
    expect(judged.size, '多个 hook 进程同时判定同一把锁过期').toBeGreaterThanOrEqual(2);
    expect(ev.filter(e => e.op === 'lock-broken'), '只有一个进程回收成功').toHaveLength(1);
    // 任意时刻至多一个持有者：按 trace 的获得 / 释放时刻，每段持锁区间互不重叠
    const spans = ev.filter(e => e.op === 'lock-acquired').map(a => ({
      pid: a.pid, t0: a.t, t1: ev.find(e => e.op === 'lock-released' && e.pid === a.pid && e.t >= a.t)?.t ?? -1,
    })).sort((a, b) => a.t0 - b.t0);
    expect(spans).toHaveLength(ids.length);
    for (const sp of spans) expect(sp.t1, `pid ${sp.pid} 释放`).toBeGreaterThanOrEqual(sp.t0);
    for (let i = 1; i < spans.length; i++) expect(spans[i].t0, '持锁区间不重叠').toBeGreaterThanOrEqual(spans[i - 1].t1);
    expect(existsSync(join(root, RUNTIME, 'state.lock')), '之后释放').toBe(false);
    expect(existsSync(join(root, RUNTIME, 'state.lock.reclaim')), '回收互斥已释放').toBe(false);
  }, TIMEOUT);

  it('ST-S09-190: 锁超时时报告进入 spill 并在之后合并送达', async () => {
    const root = fixture();
    const cmdA = NODE_WRITE('src/a.js', 'spilled');
    expect(preToolUse(root, 'Bash', { command: cmdA }, 'SA').exitCode).toBe(0);
    expect(bash(root, cmdA).status).toBe(0);
    // ① 夹具进程持有未过期锁
    const holder = await holdLock(root);
    const env = cleanEnv({ CLAUDE_PROJECT_DIR: root });
    // ② PostToolUse 与 ③ PreToolUse（node -e 改 src/b.js）同时发送
    const cmdB = NODE_WRITE('src/b.js', 'fallback');
    const preInput = JSON.stringify({ session_id: 's09-life', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: cmdB }, tool_use_id: 'SB', permission_mode: 'default' });
    const [post, pre] = await Promise.all([
      runAsync('node', [ENGINE_SRC, 'check'], postInput(root, cmdA, 'SA'), root, env),
      runAsync('bash', [GUARD_SRC], preInput, root, env),
    ]);
    expect(post.exitCode, post.stderr).toBe(0);
    expect(post.ms, '② 等待 5 秒').toBeGreaterThanOrEqual(4900);
    expect(spills(root)).toHaveLength(1);
    const base = (JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as { cases: Array<{ fixture: string; key: string; exit: number }> })
      .cases.find(c => c.fixture === 'N-repo' && c.key === 'Bash node -e writeFileSync')!;
    expect(pre.exitCode, '③ 回落结论与修改前基准一致').toBe(base.exit);
    expect(recFile(root, 'SB'), '③ 不写执行记录').toBe(false);
    // ④ 释放锁后 ls 完整链：送达 src/a.js，spill 删除，之后不重复
    await holder.release();
    expect(listed(reasonOf(chain(root, 'ls').post, '④'))).toEqual(['src/a.js']);
    expect(spills(root)).toEqual([]);
    quiet(chain(root, 'ls').post, '④ 不重复');
    quiet(stopHook(root), '④ Stop 不重复');
  }, TIMEOUT);
});
