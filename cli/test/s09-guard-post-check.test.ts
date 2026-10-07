/**
 * guard-versioned-content-scope [code] 切片 3：Bash 事后检查引擎（同步调用闭环）（S09-F）。
 *
 * 覆盖 UT-S09-390、391、393、394、398、399、400、410、411、413、414、415；
 * ST-S09-152、154、156、157、169、170、171、174、177、180、183、184、185、191、192
 * （与 logos/resources/test/core-S09-test-cases.md 对齐）。
 * - UT 以函数层直接调用分发源 plugin/bin/guard-post-check.cjs 导出的真实实现（切段、快照 / 摘要、对比、反馈），
 *   或以 stdin JSON 调用分发源 guard-check / 引擎子命令；时间以 OPENLOGOS_GUARD_NOW_NS 注入。
 * - ST 以完整 hook 链（PreToolUse → 真实执行 → PostToolUse / PostToolUseFailure / Stop）驱动分发源，
 *   断言退出码、stdout JSON、stderr 与 logos/.openlogos-runtime/ 下的磁盘事实。
 * - 后台调用以「快照后不发送结束事件」的未关闭记录模拟；后台结束确认、跨会话、提案边界、并发锁属切片 4。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, unlinkSync,
  utimesSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { makeTempRoot } from './helpers.js';
import { GUARD_SRC, REPO_ROOT, buildProject, callIsProtected, cleanEnv, git, loadGuardRegion, type FixtureKind } from './s09-guard-vcs-fixtures.js';
import {
  CLAUDE_ENGINE_CMD, RUNTIME, bash, blobOf, chain, deployEngine, engine, engineCli, nextId, postToolUse, preToolUse,
  rawOid, readJsonl, readRecord, records, restoreCommands, restoreFor, sedExec, sessionStart, sha, snapshot, stopHook, writeAt,
} from './s09-guard-post-check-helpers.js';

const TIMEOUT = 180_000;
const CLI = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** Cursor runtime 分发源（plugin-cursor/hooks/runtime.cjs；git 判据下回落到 plugin/bin 引擎分发源）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cursorRuntime(): any {
  return createRequire(import.meta.url)(join(REPO_ROOT, 'plugin-cursor', 'hooks', 'runtime.cjs'));
}

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return root;
}

/** G-* 夹具：口径断言（在 git 工作树内、无 guard 文件）+ 托管引擎副本。 */
function fixture(kind: FixtureKind = 'G-repo'): string {
  const root = buildProject(tempRoot(), kind);
  expect(git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim(), `${kind} 应在 git 工作树内`).toBe('true');
  expect(existsSync(join(root, 'logos/.openlogos-guard')), `${kind} 不应有活跃提案`).toBe(false);
  deployEngine(root);
  return root;
}

function commit(root: string, msg: string, paths: string[] = ['-A']): void {
  expect(git(root, ['add', ...paths]).status).toBe(0);
  expect(git(root, ['commit', '-qm', msg]).status).toBe(0);
}

function expectReported(r: { exitCode: number; stdout: string; stderr: string } | null, label: string): string {
  expect(r, label).not.toBeNull();
  expect(r!.exitCode, `${label}：${r!.stderr}`).toBe(2);
  const reason = (JSON.parse(r!.stdout) as { reason: string }).reason;
  expect(r!.stderr.trim(), `${label} stderr 与 stdout 同文本`).toBe(reason.trim());
  return reason;
}

function expectQuiet(r: { exitCode: number; stdout: string; stderr: string } | null, label: string): void {
  expect(r, label).not.toBeNull();
  expect(r!.exitCode, `${label}：${r!.stderr}`).toBe(0);
  expect(r!.stderr, label).not.toContain('事后检查');
  expect(r!.stderr, label).not.toContain('变更管理拦截');
}

function runRestore(root: string, cmd: string): { status: number; stdout: string; stderr: string } {
  return bash(root, cmd);
}

const NODE_WRITE = (rel: string, content: string) => `node -e "require('fs').writeFileSync('${rel}','${content}')"`;

/* ─────────────────────────── 函数层 UT ─────────────────────────── */

describe('S09-F 事后检查引擎 — 单元', () => {
  it('UT-S09-390: 独立 git / openlogos 调用切段识别', () => {
    for (const cmd of ['git checkout feature', 'cd /r && git pull', 'git add -A && git commit -m "a && b"', 'openlogos sync',
      'cd /r && openlogos status && git status']) {
      expect(engine.independentCall(cmd), cmd).toEqual({ independent: true, violation: null });
    }
    expect(engine.independentCall('cd /r'), '单独 cd').toEqual({ independent: false, violation: null });
    const cases: Array<[string, string]> = [
      ['git status && node m.js', 'node'], ['git diff > src/a.ts', '>'], ['git log | head', '|'], ['git apply $(cat p)', '$('],
      ['git show `x`', '`'], ['(git pull)', '('], ['git pull &', '&'], ['git apply <<EOF', '<<'], ['openlogos sync && node m.js', 'node'],
    ];
    for (const [cmd, tok] of cases) {
      expect(engine.independentCall(cmd), cmd).toEqual({ independent: false, violation: tok });
    }
  });

  it('UT-S09-391: Bash 事前轻判（可提取受保护目标 exit 2；其余放行并拍快照；只读免快照）', () => {
    const root = fixture();
    const verdict = (command: string, tool = 'Bash') => {
      rmSync(join(root, RUNTIME, 'guard-records'), { recursive: true, force: true });
      const id = nextId();
      const r = preToolUse(root, tool, { command }, id);
      return { exit: r.exitCode, snap: existsSync(join(root, RUNTIME, 'guard-records', `${id}.json`)), r };
    };
    for (const [cmd, tool] of [['echo x > src/a.js', 'Bash'], ['rm src/b.js', 'Bash'], ['cp README.md src/c.js', 'Bash'],
      ['Remove-Item src\\a.js', 'PowerShell']] as const) {
      const v = verdict(cmd, tool);
      expect(v.exit, cmd).toBe(2);
      expect(JSON.parse(v.r.stdout).reason, cmd).toContain('变更管理拦截');
      expect(v.r.stderr, cmd).toContain('openlogos change');
    }
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe('a\n');
    expect(existsSync(join(root, 'src/b.js'))).toBe(true);
    for (const cmd of ['sed -i s/a/b/ src/a.js', "node -e \"require('fs').writeFileSync('src/a.js','x')\"", 'rm $VAR', 'touch $D/a.md',
      'npm ci', 'echo x | tee src/a.js']) {
      const v = verdict(cmd);
      expect([v.exit, v.snap], cmd).toEqual([0, true]);
      expect(v.r.stderr, cmd).not.toContain('解析');
    }
    for (const cmd of ['ls -la', 'cat src/a.js', 'git status']) {
      const v = verdict(cmd);
      expect([v.exit, v.snap], cmd).toEqual([0, false]);
    }
    // dist/ 两条：放行且事后不报告（完整链）
    for (const [cmd, exec] of [['cmd > dist/build.log', 'echo log > dist/build.log'], ['mkdir -p dist/x', 'mkdir -p dist/x']]) {
      const c = chain(root, cmd, { exec });
      expect(c.pre.exitCode, cmd).toBe(0);
      expectQuiet(c.post, cmd);
    }
    // PowerShell 目标经变量给出：事前放行并拍快照
    const ps = verdict('Set-Content $p x', 'PowerShell');
    expect([ps.exit, ps.snap], 'PowerShell 变量目标').toEqual([0, true]);
    // 有活跃提案：放行时照常拍快照（只维护记录），PostToolUse 不报告、关闭记录
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
    rmSync(join(root, RUNTIME, 'guard-records'), { recursive: true, force: true });
    const inProposal = chain(root, NODE_WRITE('src/a.js', 'in-proposal'));
    expect([inProposal.pre.exitCode, inProposal.recordAfterPre], '提案期拍快照').toEqual([0, true]);
    expectQuiet(inProposal.post, '提案期不报告');
    expect(records(root)).toEqual([]);
    rmSync(join(root, 'logos/.openlogos-guard'));
    // 引擎缺失 → 非 git 回落（旧顺序：解析不出即阻断），reason 附带补齐提示
    const bare = join(tempRoot(), 'guard-check');
    writeFileSync(bare, readFileSync(GUARD_SRC));
    const env = cleanEnv({ CLAUDE_PROJECT_DIR: root });
    const fb = spawnSync('bash', [bare], { input: JSON.stringify({ tool_name: 'Bash', tool_use_id: nextId(), tool_input: { command: 'npm ci' } }), cwd: root, encoding: 'utf-8', env });
    expect(fb.status).toBe(2);
    expect(fb.stderr).toContain('运行 `openlogos sync` 补齐事后检查引擎');
    const fbw = spawnSync('bash', [bare], { input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: 'src/new.js', content: 'x' } }), cwd: root, encoding: 'utf-8', env });
    expect(fbw.status).toBe(2);
    expect(fbw.stderr).toContain('事后检查引擎缺失');
    // cp：git 判据下源只被读取，不算写入目标；只判定目标（目录目标按「目标/源末段」判定）。mv 的源会被移除，仍计入
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist/x.js'), 'x');
    const tp = (cmd: string) => engine.writeTargets(cmd, root).map((t: { path: string }) => t.path.slice(root.length + 1));
    expect(tp('cp src/a.js dist/a.js'), '只取目标').toEqual(['dist/a.js']);
    expect(tp('cp -r src/a.js src/b.js dist'), '多源：目录目标').toEqual(['dist/a.js', 'dist/b.js']);
    expect(tp('cp src/a.js dist/'), '以 / 结尾的目录目标').toEqual(['dist/a.js']);
    expect(tp('cp -t dist src/a.js src/b.js'), '-t').toEqual(['dist/a.js', 'dist/b.js']);
    expect(tp('cp --target-directory=src dist/x.js'), '--target-directory=').toEqual(['src/x.js']);
    expect(tp('cp -T dist/x.js src/y'), '-T 按文件处理').toEqual(['src/y']);
    expect(tp('cp src/a.js $D'), '目标不可确定 → 交给事后检查').toEqual([]);
    expect(tp('cp $S dist/'), '源不可确定且目标为目录 → 交给事后检查').toEqual([]);
    expect(tp('mv src/a.js dist/a.js'), 'mv 源与目标都计入').toEqual(['src/a.js', 'dist/a.js']);
    for (const cmd of ['cp src/a.js dist/a.js', 'cp src/a.js src/b.js dist/', 'cp -t dist src/a.js', 'cp src/a.js $D']) {
      const v = verdict(cmd);
      expect([v.exit, v.snap], `${cmd} 源不算写入目标`).toEqual([0, true]);
    }
    for (const cmd of ['cp dist/x.js src/', 'cp -t src dist/x.js', 'cp dist/x.js src/x2.js', 'mv src/a.js dist/a.js']) {
      expect(verdict(cmd).exit, `${cmd} 目标受保护`).toBe(2);
    }
    // PowerShell 复制段同口径（guard-check ws_copy_git_targets）
    for (const cmd of ['Copy-Item src\\a.js dist\\a.js', 'cp src\\a.js dist\\', 'Copy-Item -Path src\\a.js -Destination dist\\a.js']) {
      expect(verdict(cmd, 'PowerShell').exit, `PowerShell ${cmd}`).toBe(0);
    }
    for (const cmd of ['Copy-Item dist\\x.js src\\x2.js', 'Copy-Item dist\\x.js src\\', 'Copy-Item -Destination src\\x2.js -Path dist\\x.js']) {
      expect(verdict(cmd, 'PowerShell').exit, `PowerShell ${cmd}`).toBe(2);
    }
    // Cursor runtime 同口径（POSIX 经引擎 writeTargets；win32 经 wsCopyGitTargets）
    const cursor = cursorRuntime();
    expect(cursor.decideShell(root, 'cp src/a.js dist/a.js', 'darwin').decision, 'Cursor darwin cp 源').toBe('allow');
    expect(cursor.decideShell(root, 'cp dist/x.js src/x2.js', 'darwin').decision, 'Cursor darwin cp 目标').toBe('deny');
    expect(cursor.decideShell(root, 'Copy-Item src\\a.js dist\\a.js', 'win32').decision, 'Cursor win32 Copy-Item 源').toBe('allow');
    expect(cursor.decideShell(root, 'Copy-Item dist\\x.js src\\', 'win32').decision, 'Cursor win32 Copy-Item 目标').toBe('deny');
  }, TIMEOUT);

  it('UT-S09-393: 快照覆盖范围与原始字节留存', () => {
    const root = fixture('G-ignored-spec');
    writeAt(root, 'src/a.js', 'dirty\n');
    writeAt(root, 'src/new.js', 'new\n');
    writeAt(root, 'dist/big.bin', Buffer.alloc(6 * 1024 * 1024, 1));
    writeAt(root, 'logos/resources/test/huge.md', Buffer.alloc(6 * 1024 * 1024, 65));
    writeAt(root, 'node_modules/p/i.js', 'x');
    const trace = join(tempRoot(), 'trace.jsonl');
    const r = snapshot(root, 'node m.js', 'r393', false, { OPENLOGOS_GUARD_TRACE: trace });
    expect(r.exitCode, r.stderr).toBe(0);
    const rec = readRecord(root, 'r393');
    const keys = Object.keys(rec.entries);
    for (const k of ['src/a.js', 'src/new.js', 'logos/resources/test/t.md', 'logos/resources/test/huge.md', '.gitignore',
      'logos/logos.config.json', '.git/config']) expect(keys, k).toContain(k);
    expect(keys.some(k => k.startsWith('dist/') || k.startsWith('node_modules/') || k.startsWith(RUNTIME))).toBe(false);
    const cache = JSON.parse(readFileSync(join(root, RUNTIME, 'raw-baseline.json'), 'utf-8'));
    expect(rec.entries['src/b.js'].raw_oid).toBe(cache.tracked['src/b.js'].raw_oid);
    for (const k of ['src/a.js', 'src/new.js', 'logos/resources/test/t.md']) {
      expect(rec.entries[k].recoverable, k).toBe(true);
      expect(rec.entries[k].raw_oid, k).toBe(rawOid(root, k));
      expect(git(root, ['cat-file', '-e', rec.entries[k].raw_oid]).status, `${k} 在对象库`).toBe(0);
    }
    expect(rec.entries['logos/resources/test/huge.md'].recoverable).toBe(false);
    expect(git(root, ['cat-file', '-e', rec.entries['logos/resources/test/huge.md'].raw_oid]).status, 'huge 不写对象库').not.toBe(0);
    expect(rec.head).toMatch(/^[0-9a-f]{40}$/);
    expect(rec.index_tree).toMatch(/^[0-9a-f]{40}$/);
    expect(rec.generation).toBe(1);
    // 留存经 hash-object -w --no-filters --stdin-paths 批量写入
    const ev = readFileSync(trace, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const writes = ev.filter(e => e.op === 'git' && e.args.includes('hash-object') && e.args.includes('-w'));
    expect(writes.some(e => e.args.includes('--no-filters') && e.args.includes('--stdin-paths') && e.paths.includes('src/new.js'))).toBe(true);
    // 覆盖范围按受保护判定过滤：引擎内的 JS 判定与共享测试向量（guard-check 的 is_protected 同一向量）逐条一致
    const vectors = (JSON.parse(readFileSync(join(REPO_ROOT, 'plugin/test-vectors/guard-protected.json'), 'utf-8')) as {
      vectors: Array<{ fixture: FixtureKind; path: string; protected: boolean; step: number }> }).vectors;
    const roots = new Map<FixtureKind, string>();
    const outside = tempRoot();
    for (const v of vectors) {
      if (!roots.has(v.fixture)) roots.set(v.fixture, fixture(v.fixture));
      const vr = roots.get(v.fixture)!;
      const pctx = engine.makeProtectCtx(engine.gitContext(vr));
      const got = engine.protectVerdict(pctx, engine.relOfRoot(vr, v.path.replace('<OUTSIDE>', outside)));
      expect([got.protected, got.step], `${v.fixture} ${v.path}`).toEqual([v.protected, v.step]);
    }
  }, TIMEOUT);

  it('UT-S09-394: 变化判定以原始字节为准（函数层，可注入时钟）', () => {
    const root = fixture('G-ignored-spec');
    writeAt(root, 'src/a.js', 'dirty-1\n');
    writeAt(root, 'package.json', '{"name":"pre-dirty"}\n'); // 执行前已脏且本次不动
    const g = engine.gitContext(root);
    const pctx = engine.makeProtectCtx(g);
    const s1 = engine.scanProject(pctx);
    const base = Object.fromEntries([...s1.states].map(([p, s]: [string, unknown]) => [p, engine.entryOf(s)]));
    const statusBefore = git(root, ['status', '--porcelain']).stdout;
    writeAt(root, 'src/c.js', 'c\n');
    unlinkSync(join(root, 'logos/resources/test/t.md'));
    unlinkSync(join(root, 'src/b.js'));
    symlinkSync('a.js', join(root, 'src/b.js'));
    writeAt(root, 'src/a.js', 'dirty-2\n');
    const trace = join(tempRoot(), 'trace.jsonl');
    process.env.OPENLOGOS_GUARD_TRACE = trace;
    let s2;
    try { s2 = engine.scanProject(pctx, s1.cache); } finally { delete process.env.OPENLOGOS_GUARD_TRACE; }
    const changes = engine.diffStates(root, base, s2.states);
    const kinds = Object.fromEntries(changes.map((c: { path: string; change: string }) => [c.path, c.change]));
    expect(kinds).toEqual({ 'src/c.js': 'added', 'logos/resources/test/t.md': 'deleted', 'src/b.js': 'type', 'src/a.js': 'modified' });
    expect(base['src/b.js'].raw_oid).toBe(s1.cache.tracked['src/b.js'].raw_oid);
    const gitCalls = readFileSync(trace, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(e => e.op === 'git');
    expect(gitCalls.some(e => ['diff', 'status', 'diff-files', 'diff-index'].includes(e.args[0])), '不调用过滤后的 diff / status').toBe(false);
    expect(git(root, ['status', '--porcelain']).stdout.split('\n').some(l => l.endsWith('package.json'))).toBe(true);
    expect(statusBefore).toContain('src/a.js');
    // racy 规避：stat 签名不变但 mtime 不早于缓存记录时刻 → 必须重算；mtime 更早的条目复用。
    // 以可注入时钟把 src/c.js 的记录时刻固定为其 mtime（同一时间粒度内写入的情形）
    writeAt(root, 'src/c.js', 'c2\n');
    const mtimeNs = statSync(join(root, 'src/c.js'), { bigint: true }).mtimeNs;
    process.env.OPENLOGOS_GUARD_NOW_NS = String(mtimeNs);
    let s3;
    try { s3 = engine.scanProject(pctx, s2.cache); } finally { delete process.env.OPENLOGOS_GUARD_NOW_NS; }
    const trace2 = join(tempRoot(), 'trace2.jsonl');
    process.env.OPENLOGOS_GUARD_TRACE = trace2;
    try { engine.scanProject(pctx, s3.cache); } finally { delete process.env.OPENLOGOS_GUARD_TRACE; }
    const hashed = readFileSync(trace2, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
      .filter(e => e.op === 'git' && e.args.includes('hash-object')).flatMap(e => e.paths ?? []);
    expect(hashed, 'mtime 不早于记录时刻 → 重算').toContain('src/c.js');
    expect(hashed, '更早的条目复用缓存').not.toContain('logos/resources/prd/x.md');
    // 权限变化：git 记录的执行位变化（100644 → 100755）计为类型变化并在反馈中标明「执行位变化」；
    // git 不记录的其他权限位（0644 → 0600）不计入
    writeAt(root, 'src/m1.js', 'm1\n');
    writeAt(root, 'src/m2.js', 'm2\n');
    chmodSync(join(root, 'src/m1.js'), 0o644);
    chmodSync(join(root, 'src/m2.js'), 0o644);
    expect(git(root, ['add', 'src/m1.js', 'src/m2.js']).status).toBe(0);
    expect(git(root, ['commit', '-qm', 'modes']).status).toBe(0);
    const s4 = engine.scanProject(pctx, s3.cache);
    const base4 = Object.fromEntries([...s4.states].map(([p, s]: [string, unknown]) => [p, engine.entryOf(s)]));
    chmodSync(join(root, 'src/m1.js'), 0o755);
    chmodSync(join(root, 'src/m2.js'), 0o600);
    expect(git(root, ['diff', '--raw', '--', 'src/m1.js']).stdout, 'git 记录执行位变化').toContain(':100644 100755');
    expect(git(root, ['diff', '--raw', '--', 'src/m2.js']).stdout, 'git 不记录 0600').toBe('');
    const s5 = engine.scanProject(pctx, s4.cache);
    const modeChanges = engine.diffStates(root, base4, s5.states);
    expect(modeChanges.map((c: { path: string; change: string }) => [c.path, c.change])).toEqual([['src/m1.js', 'type']]);
    expect(modeChanges[0].exec_change).toEqual({ from: '100644', to: '100755' });
    const modeText = engine.renderFeedback([{ ...modeChanges[0], record_id: 'm1', attribution: { kind: 'self', command: 'chmod' } }]);
    expect(modeText).toContain('src/m1.js（类型变化：执行位变化 100644 → 100755）');
    expect(modeText).toContain(engine.restoreCommand('claude', 'm1', 'src/m1.js'));
    // 内容与执行位同时变化：内容变化并标明执行位变化
    writeAt(root, 'src/m1.js', 'm1-changed\n');
    chmodSync(join(root, 'src/m1.js'), 0o755);
    const both = engine.diffStates(root, base4, engine.scanProject(pctx, s5.cache).states)
      .find((c: { path: string }) => c.path === 'src/m1.js');
    expect(both.change).toBe('modified');
    expect(engine.renderFeedback([{ ...both, record_id: 'm1', attribution: { kind: 'self', command: 'x' } }]))
      .toContain('src/m1.js（内容变化，执行位变化 100644 → 100755）');
    // 执行位回到基线：与基线状态一致（去重条目据此清除）
    writeAt(root, 'src/m1.js', 'm1\n');
    chmodSync(join(root, 'src/m1.js'), 0o644);
    expect(engine.diffStates(root, base4, engine.scanProject(pctx).states).filter((c: { path: string }) => c.path.startsWith('src/m'))).toEqual([]);
    expect(engine.sameState(engine.statePath(root, 'src/m1.js'), { ...base4['src/m1.js'], mode: 0o755 }, root), '执行位不同不算一致').toBe(false);
  }, TIMEOUT);

  it('UT-S09-398: 事件级去重 (path, raw_digest, 事件签名)', () => {
    const root = fixture();
    writeAt(root, 'src/c.js', 'c\n');
    commit(root, 'c');
    expect(snapshot(root, 'node dev-server.js', 'R1').exitCode).toBe(0); // 未收到结束事件的前台调用
    // 检查点：无标识的 Bash PostToolUse（只对比、送达，不关闭任何记录；Stop 会关闭前台记录 R1，见 UT-S09-395）
    const check = () => postToolUse(root, 'ls', null);
    const a = join(root, 'src/a.js');
    // ① 改为 X → 检查 → 再检查两次：只报一次
    writeFileSync(a, 'X\n');
    expect(expectReported(check(), '①')).toContain('src/a.js');
    expect(check().exitCode).toBe(0);
    expect(check().exitCode).toBe(0);
    // ② 恢复为基线 → 检查（清除去重条目）→ 再次改为 X（新签名）→ 重新报告
    writeFileSync(a, 'a\n');
    expect(check().exitCode).toBe(0);
    expect(readJsonl(root, 'reported.jsonl').some(e => e.path === 'src/a.js'), '回到基线清除去重条目').toBe(false);
    writeFileSync(a, 'X\n');
    expect(expectReported(check(), '②')).toContain('src/a.js');
    // ③ 未恢复，再次写入相同内容（新事件签名）→ 重新报告一次
    writeFileSync(a, 'X\n');
    expect(expectReported(check(), '③')).toContain('src/a.js');
    expect(check().exitCode).toBe(0);
    // ④ 删除：事件签名为 absent 加观测序号，只报一次
    unlinkSync(join(root, 'src/b.js'));
    expect(expectReported(check(), '④')).toContain('src/b.js（删除）');
    expect(check().exitCode).toBe(0);
    expect(readJsonl(root, 'reported.jsonl').find(e => e.path === 'src/b.js').sig).toBe('absent:1');
    // ⑤ 改 c.js 为 Y → 报告 → 独立 git 调用 rebase 该路径 → 再次写入 Y → 报告
    writeFileSync(join(root, 'src/c.js'), 'Y\n');
    expect(expectReported(check(), '⑤')).toContain('src/c.js');
    const g = chain(root, 'git checkout -- src/c.js');
    expect([g.pre.exitCode, g.post!.exitCode]).toEqual([0, 0]);
    expect(readRecord(root, 'R1').entries['src/c.js'].digest).toBe(rawOid(root, 'src/c.js'));
    expect(readJsonl(root, 'reported.jsonl').some(e => e.path === 'src/c.js'), 'rebase 清除去重条目').toBe(false);
    writeFileSync(join(root, 'src/c.js'), 'Y\n');
    expect(expectReported(check(), '⑤ 再次')).toContain('src/c.js');
    // ⑥ 迟到结束事件：最终对比不重复，记录关闭
    expectQuiet(postToolUse(root, 'node dev-server.js', 'R1'), '⑥');
    expect(records(root)).not.toContain('R1.json');
  }, TIMEOUT);

  it('UT-S09-399: 反馈内容、归因与恢复命令（Claude / Cursor）', () => {
    const before = { exists: true, type: 'file', digest: 'o1', raw_oid: 'o1', recoverable: true, mode: 420, tracked: true };
    const after = { exists: true, type: 'file', digest: 'o2', raw_oid: 'o2', recoverable: true, mode: 420, ino: '1', ctime_ns: '1' };
    const self = { path: 'src/a.js', change: 'modified', before, after, record_id: 'r1', attribution: { kind: 'self', command: 'node m.js' } };
    const big = { ...self, path: 'logos/resources/test/huge.md', before: { ...before, recoverable: false } };
    const bg = { ...self, path: 'src/b.js', attribution: { kind: 'unattributed', commands: ['node dev-server.js'] } };
    const unknown = { ...self, path: 'src/c.js', change: 'added', before: { exists: false },
      attribution: { kind: 'unattributed', commands: ['node w1.js', 'node w2.js'] } };
    const t1 = engine.renderFeedback([self, big]);
    expect(t1).toContain('归因：本次调用（命令：node m.js）');
    expect(t1).toContain('src/a.js（内容变化）');
    expect(t1).toContain(`${CLAUDE_ENGINE_CMD} restore r1 -- src/a.js`);
    expect(t1).toContain('不可自动恢复');
    expect(restoreCommands(t1).some(c => c.includes('huge.md'))).toBe(false);
    expect(t1).toContain('请回滚');
    for (const t of [t1]) {
      expect(t).not.toContain('git checkout');
      expect(t).not.toMatch(/ >>? \S/);
    }
    const t2 = engine.renderFeedback([bg]);
    expect(t2).toContain('node dev-server.js');
    expect(t2).toContain('可能来自未结束的后台调用或用户手动修改，需向用户确认，请勿自行回滚');
    expect(t2).not.toMatch(/请回滚/);
    const t3 = engine.renderFeedback([unknown]);
    expect(t3).toContain('node w1.js');
    expect(t3).toContain('node w2.js');
    expect(t3).toContain('src/c.js（新增）');
    expect(t3).not.toMatch(/请回滚/);
    const t4 = engine.renderFeedback([{ ...self, attribution: { kind: 'self', command: 'git status && node m.js' } }]);
    expect(t4).toContain('拆成单独调用后重试');
    const tc = engine.renderFeedback([self], { host: 'cursor' });
    expect(tc).toContain('node ".cursor/hooks/openlogos-guard-post.cjs" restore r1 -- src/a.js');
    expect(tc).not.toContain('CLAUDE_PROJECT_DIR');
    // 端到端：exit 2 双通道，已跟踪干净文件同样给出 restore 子命令
    const root = fixture();
    const c = chain(root, NODE_WRITE('src/b.js', 'z'));
    const reason = expectReported(c.post, 'e2e');
    expect(restoreFor(reason, 'src/b.js')).toBe(`${CLAUDE_ENGINE_CMD} restore ${c.id} -- src/b.js`);
  }, TIMEOUT);

  it('UT-S09-400: 送达渠道（补查入待报告、Bash PostToolUse 送达、Stop 不重复、SessionStart 注入）', () => {
    const root = fixture();
    expect(snapshot(root, 'node dev-server.js', 'R1', true).exitCode).toBe(0);
    writeFileSync(join(root, 'src/a.js'), 'bg-1\n');
    // 已有 1 条未送达项（经一次补查存入）
    expect(preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId()).exitCode).toBe(0);
    expect(readJsonl(root, 'pending-reports.jsonl').map(i => i.path)).toEqual(['src/a.js']);
    // PreToolUse 补查新增 1 条：当前 Edit dist/a.txt 仍 exit 0
    writeFileSync(join(root, 'src/b.js'), 'bg-2\n');
    const edit = preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId());
    expect(edit.exitCode).toBe(0);
    expect(readJsonl(root, 'pending-reports.jsonl').map(i => i.path).sort()).toEqual(['src/a.js', 'src/b.js']);
    // 下一次 Bash PostToolUse 一并送达两项
    const ls = chain(root, 'ls');
    const reason = expectReported(ls.post, 'Bash PostToolUse');
    expect(reason).toContain('src/a.js');
    expect(reason).toContain('src/b.js');
    expect(readJsonl(root, 'pending-reports.jsonl')).toEqual([]);
    expect(readJsonl(root, 'reported.jsonl').map(e => e.path).sort()).toEqual(['src/a.js', 'src/b.js']);
    // Stop（stop_hook_active）无新项 exit 0
    expect(stopHook(root, true).exitCode).toBe(0);
    // SessionStart：未送达项并入注入上下文（stdout），exit 0
    writeFileSync(join(root, 'package.json'), '{"name":"bg-3"}\n');
    const ss = sessionStart(root);
    expect(ss.exitCode).toBe(0);
    expect(ss.stdout).toContain('package.json');
    // SessionStart 注入不算送达（S09-F Step 30）：之后的 Stop 以 exit 2 送达，再次 Stop 不重复
    expect(expectReported(stopHook(root), 'SessionStart 之后的 Stop')).toContain('package.json');
    expect(stopHook(root).exitCode).toBe(0);
  }, TIMEOUT);

  it('UT-S09-410: git 元数据快照采集范围（含 core.hooksPath 与 linked worktree）', () => {
    const root = fixture();
    writeAt(root, '.githooks/pre-commit', '#!/bin/sh\nexit 0\n');
    expect(git(root, ['config', 'core.hooksPath', '.githooks']).status).toBe(0);
    writeAt(root, '.git/hooks/post-merge', '#!/bin/sh\n');
    expect(snapshot(root, 'x', 'm1').exitCode).toBe(0);
    const keys = Object.keys(readRecord(root, 'm1').entries);
    for (const k of ['.git/config', '.git/info/exclude', '.git/hooks/post-merge', '.githooks/pre-commit']) expect(keys, k).toContain(k);
    const hookFiles = spawnSync('bash', ['-c', 'cd .git/hooks && ls'], { cwd: root, encoding: 'utf-8' }).stdout.split('\n').filter(Boolean);
    for (const h of hookFiles) expect(keys, h).toContain(`.git/hooks/${h}`);
    const banned = /^\.git\/(objects|refs|logs|modules)\/|^\.git\/(index|HEAD|ORIG_HEAD|FETCH_HEAD|packed-refs)$|^\.git\/MERGE_|\.lock$/;
    expect(keys.filter(k => banned.test(k))).toEqual([]);
    expectQuiet(postToolUse(root, 'x', 'm1'), '首个快照关闭');
    expect(snapshot(root, 'y', 'm2').exitCode).toBe(0);
    expectQuiet(postToolUse(root, 'y', 'm2'), '快照写 objects/ 后 check 不报告');

    // linked worktree：项目根为 linked worktree，git 目录与 common dir 分离且都位于项目根之内
    const main = buildProject(tempRoot(), 'G-repo');
    const wt = join(tempRoot(), 'wt');
    expect(git(main, ['worktree', 'add', '-q', wt, '-b', 'wt']).status).toBe(0);
    expect(spawnSync('mv', [main, join(wt, '.main')]).status).toBe(0);
    expect(git(join(wt, '.main'), ['worktree', 'repair', wt]).status).toBe(0);
    const gd = git(wt, ['rev-parse', '--absolute-git-dir']).stdout.trim();
    const cd = git(wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']).stdout.trim();
    expect(gd).not.toBe(cd);
    writeAt(wt, `${gd.slice(gd.indexOf('.main'))}/info/wt-note`, 'x');
    deployEngine(wt);
    expect(snapshot(wt, 'x', 'w1').exitCode).toBe(0);
    const wkeys = Object.keys(readRecord(wt, 'w1').entries);
    expect(wkeys).toContain('.main/.git/config');
    expect(wkeys).toContain('.main/.git/info/exclude');
    expect(wkeys.some(k => k.startsWith('.main/.git/hooks/'))).toBe(true);
    expect(wkeys).toContain(`${gd.slice(gd.indexOf('.main'))}/info/wt-note`);
    expect(wkeys.filter(k => banned.test(k.replace(/^\.main\//, '')))).toEqual([]);
    expectQuiet(postToolUse(wt, 'x', 'w1'), 'worktree check');
  }, TIMEOUT);

  it('UT-S09-411: 原始字节摘要与过滤无关（脏文件，autocrlf + clean filter）', () => {
    const root = fixture();
    expect(git(root, ['config', 'core.autocrlf', 'true']).status).toBe(0);
    expect(git(root, ['config', 'filter.up.clean', 'tr a-z A-Z']).status).toBe(0);
    writeAt(root, '.gitattributes', '*.up filter=up\n');
    writeAt(root, 'src/w.txt', 'w1\nw2\n');
    writeAt(root, 'src/a.up', 'abc\n');
    commit(root, 'filters');
    writeAt(root, 'src/w.txt', 'w1\r\nw2\r\nw3\r\n');
    writeAt(root, 'src/a.up', 'abcd\n');
    expect(snapshot(root, 'node m.js', 'f1').exitCode).toBe(0);
    const rec = readRecord(root, 'f1');
    expect(rec.entries['src/w.txt'].digest).toBe(rawOid(root, 'src/w.txt'));
    expect(rec.entries['src/a.up'].digest).toBe(rawOid(root, 'src/a.up'));
    const diffBefore = git(root, ['diff', '--', 'src/w.txt', 'src/a.up']).stdout;
    writeAt(root, 'src/w.txt', 'w1\nw2\nw3\n');
    writeAt(root, 'src/a.up', 'ABCD\n');
    expect(git(root, ['diff', '--', 'src/w.txt', 'src/a.up']).stdout, '过滤后 diff 不变').toBe(diffBefore);
    const reason = expectReported(postToolUse(root, 'node m.js', 'f1'), '过滤后相同也报告');
    expect(reason).toContain('src/w.txt（内容变化）');
    expect(reason).toContain('src/a.up（内容变化）');
    expect(restoreFor(reason, 'src/w.txt')).toBe(`${CLAUDE_ENGINE_CMD} restore f1 -- src/w.txt`);
    expect(restoreFor(reason, 'src/a.up')).toBe(`${CLAUDE_ENGINE_CMD} restore f1 -- src/a.up`);
  }, TIMEOUT);

  it('UT-S09-413: 原始字节基线缓存 raw-baseline.json（增量、racy、rebase 同步）', () => {
    const root = fixture();
    writeAt(root, '.gitattributes', '*.up filter=up\n');
    commit(root, 'attrs');
    const hashed = (env: Record<string, string>, id: string) => {
      const trace = join(tempRoot(), `${id}.jsonl`);
      expect(snapshot(root, 'x', id, false, { OPENLOGOS_GUARD_TRACE: trace, ...env }).exitCode).toBe(0);
      expectQuiet(postToolUse(root, 'x', id), id);
      if (!existsSync(trace)) return [] as string[];
      return readFileSync(trace, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))
        .filter(e => e.op === 'git' && e.args.includes('hash-object')).flatMap(e => e.paths ?? ['<stdin>']);
    };
    spawnSync('sleep', ['0.05']);
    const loose = () => git(root, ['count-objects', '-v']).stdout;
    const objectsBefore = new Set(spawnSync('bash', ['-c', 'find .git/objects -type f'], { cwd: root, encoding: 'utf-8' }).stdout.split('\n'));
    // ① 首次：覆盖全部已跟踪文件；无内容转换的 raw_oid 等于索引 blob；已跟踪文件不新增对象
    hashed({}, 'c1');
    const cache = JSON.parse(readFileSync(join(root, RUNTIME, 'raw-baseline.json'), 'utf-8'));
    const tracked = git(root, ['ls-files', '-s']).stdout.split('\n').filter(Boolean).map(l => {
      const m = /^\d+ ([0-9a-f]+) \d\t(.*)$/.exec(l)!;
      return { oid: m[1], path: m[2] };
    });
    expect(Object.keys(cache.tracked).sort()).toEqual(tracked.map(t => t.path).sort());
    for (const t of tracked) {
      expect(Object.keys(cache.tracked[t.path]).sort(), t.path).toEqual(
        ['ctime_ns', 'ino', 'mode', 'mtime_ns', 'raw_oid', 'recorded_at_ns', 'size', 'type', 'written'].sort());
      expect(cache.tracked[t.path].raw_oid, t.path).toBe(t.oid);
    }
    const objectsAfter = spawnSync('bash', ['-c', 'find .git/objects -type f'], { cwd: root, encoding: 'utf-8' }).stdout.split('\n').filter(Boolean);
    const added = objectsAfter.filter(o => !objectsBefore.has(o)).map(o => o.replace(/^\.git\/objects\//, '').replace('/', ''));
    const trackedOids = new Set(tracked.map(t => t.oid));
    expect(added.filter(o => trackedOids.has(o)), '已跟踪文件不新增对象').toEqual([]);
    void loose;
    // ② 不改任何文件：不调用 hash-object
    expect(hashed({}, 'c2')).toEqual([]);
    // ③ 只 touch src/b.js：只重算 src/b.js
    spawnSync('sleep', ['0.05']);
    const t = new Date(Date.now());
    utimesSync(join(root, 'src/b.js'), t, t);
    spawnSync('sleep', ['0.05']);
    expect(hashed({}, 'c3')).toEqual(['src/b.js']);
    // ④ mtime 不早于缓存记录时刻：一律重算（两次）
    const future = new Date(Date.now() + 3600_000);
    utimesSync(join(root, 'src/a.js'), future, future);
    expect(hashed({}, 'c4')).toContain('src/a.js');
    expect(hashed({}, 'c5')).toContain('src/a.js');
    // ⑤ 独立 git 调用改 src/a.js 后 rebase：缓存与未关闭记录同步更新
    writeAt(root, 'src/a.js', 'dirty\n');
    expect(snapshot(root, 'node dev-server.js', 'R1', true).exitCode).toBe(0);
    const g = chain(root, 'git checkout -- src/a.js');
    expect([g.pre.exitCode, g.post!.exitCode]).toEqual([0, 0]);
    const head = rawOid(root, 'src/a.js');
    expect(readRecord(root, 'R1').entries['src/a.js'].raw_oid).toBe(head);
    expect(JSON.parse(readFileSync(join(root, RUNTIME, 'raw-baseline.json'), 'utf-8')).tracked['src/a.js'].raw_oid).toBe(head);
  }, TIMEOUT);

  it('UT-S09-414: clean filter 下干净文件的原始字节判定（函数层）', () => {
    const root = fixture();
    expect(git(root, ['config', 'filter.up.clean', 'tr a-z A-Z']).status).toBe(0);
    writeAt(root, '.gitattributes', '*.up filter=up\n');
    writeAt(root, 'src/h.up', 'hello');
    commit(root, 'h');
    expect(git(root, ['status', '--porcelain', '--', 'src/h.up']).stdout).toBe('');
    const pctx = engine.makeProtectCtx(engine.gitContext(root));
    const s1 = engine.scanProject(pctx);
    const base = Object.fromEntries([...s1.states].map(([p, s]: [string, unknown]) => [p, engine.entryOf(s)]));
    writeFileSync(join(root, 'src/h.up'), 'HELLO');
    expect(git(root, ['diff', '--quiet', '--', 'src/h.up']).status, '对照：过滤后相同').toBe(0);
    const s2 = engine.scanProject(pctx, s1.cache);
    const ch = engine.diffStates(root, base, s2.states).find((c: { path: string }) => c.path === 'src/h.up');
    expect(ch.change).toBe('modified');
    expect(ch.before.raw_oid).toBe(blobOf(root, 'hello'));
    const cmd = engine.restoreCommand('claude', 'h1', 'src/h.up');
    expect(cmd).toBe(`${CLAUDE_ENGINE_CMD} restore h1 -- src/h.up`);
    const text = engine.renderFeedback([{ ...ch, record_id: 'h1', attribution: { kind: 'self', command: 'x' } }]);
    expect(text).toContain(cmd);
    expect(text).not.toContain('git checkout');
  }, TIMEOUT);

  it('UT-S09-415: restore 前置校验与按目录项恢复', () => {
    const root = fixture();
    writeAt(root, 'src/s.sh', '#!/bin/sh\necho s\n');
    chmodSync(join(root, 'src/s.sh'), 0o755);
    symlinkSync('a.js', join(root, 'src/l2.js'));
    commit(root, 'more');
    const outside = join(tempRoot(), 'outside.txt');
    writeFileSync(outside, 'OUT\n');
    const report = (id: string, mutate: () => void) => {
      expect(snapshot(root, 'node m.js', id).exitCode).toBe(0);
      mutate();
      return expectReported(postToolUse(root, 'node m.js', id), id);
    };
    const restore = (id: string, rel: string, env: Record<string, string> = {}) =>
      bash(root, `${CLAUDE_ENGINE_CMD} restore ${id} -- ${rel}`, env);
    const orig = (rel: string) => git(root, ['show', `HEAD:${rel}`]).stdout;
    // ① 执行前普通文件 → 执行后指向项目外的符号链接：替换目录项，不改链接目标
    report('u1', () => { unlinkSync(join(root, 'src/a.js')); symlinkSync(outside, join(root, 'src/a.js')); });
    const trace = join(tempRoot(), 'restore.jsonl');
    expect(restore('u1', 'src/a.js', { OPENLOGOS_GUARD_TRACE: trace }).status).toBe(0);
    expect(lstatSync(join(root, 'src/a.js')).isFile()).toBe(true);
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe(orig('src/a.js'));
    expect(readFileSync(outside, 'utf-8')).toBe('OUT\n');
    const ren = readFileSync(trace, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.op === 'restore-rename');
    expect(ren.tmp).toMatch(/^\.a\.js\.openlogos-restore-\d+$/);
    expect(readJsonl(root, 'reported.jsonl').some(e => e.path === 'src/a.js'), '去重条目清除').toBe(false);
    // ② 执行前普通文件 → 执行后目录：拒绝 exit 1
    report('u2', () => { unlinkSync(join(root, 'src/b.js')); mkdirSync(join(root, 'src/b.js')); writeFileSync(join(root, 'src/b.js/k'), 'k'); });
    expect(restore('u2', 'src/b.js').status).toBe(1);
    expect(statSync(join(root, 'src/b.js')).isDirectory()).toBe(true);
    rmSync(join(root, 'src/b.js'), { recursive: true });
    writeFileSync(join(root, 'src/b.js'), orig('src/b.js'));
    stopHook(root);
    // ③ 执行前普通文件 → 执行后删除：还原
    report('u3', () => unlinkSync(join(root, 'src/b.js')));
    expect(restore('u3', 'src/b.js').status).toBe(0);
    expect(readFileSync(join(root, 'src/b.js'), 'utf-8')).toBe(orig('src/b.js'));
    // ④ 执行前不存在 → 普通文件：删除；⑤ → 符号链接：删除目录项
    report('u4', () => writeFileSync(join(root, 'src/n.js'), 'n'));
    expect(restore('u4', 'src/n.js').status).toBe(0);
    expect(existsSync(join(root, 'src/n.js'))).toBe(false);
    report('u5', () => symlinkSync(outside, join(root, 'src/ln.js')));
    expect(restore('u5', 'src/ln.js').status).toBe(0);
    expect(() => lstatSync(join(root, 'src/ln.js'))).toThrow();
    expect(readFileSync(outside, 'utf-8')).toBe('OUT\n');
    // ⑥ 执行前不存在 → 执行后为目录：拒绝 exit 1（报告记录按「执行后为目录」构造）
    mkdirSync(join(root, 'src/d6'));
    writeFileSync(join(root, RUNTIME, 'reported.jsonl'), `${readFileSync(join(root, RUNTIME, 'reported.jsonl'), 'utf-8')}${JSON.stringify({
      path: 'src/d6', raw_digest: 'dir', sig: '0:0', record_id: 'u6', change: 'added', before: { exists: false },
      after: { exists: true, type: 'dir', digest: 'dir' },
    })}\n`);
    expect(restore('u6', 'src/d6').status).toBe(1);
    expect(statSync(join(root, 'src/d6')).isDirectory()).toBe(true);
    rmSync(join(root, 'src/d6'), { recursive: true });
    // ⑦ 执行前符号链接 → 执行后普通文件：临时链接 + rename 重建
    report('u7', () => { unlinkSync(join(root, 'src/l2.js')); writeFileSync(join(root, 'src/l2.js'), 'plain'); });
    expect(restore('u7', 'src/l2.js').status).toBe(0);
    expect(lstatSync(join(root, 'src/l2.js')).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(root, 'src/l2.js'))).toBe('a.js');
    // ⑧ 执行后又被修改（摘要不符）：拒绝、只报告、exit 1，文件不变
    report('u8', () => writeFileSync(join(root, 'src/a.js'), 'v1'));
    writeFileSync(join(root, 'src/a.js'), 'manual');
    const r8 = restore('u8', 'src/a.js');
    expect(r8.status).toBe(1);
    expect(r8.stderr).toContain('拒绝恢复');
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe('manual');
    writeFileSync(join(root, 'src/a.js'), orig('src/a.js'));
    stopHook(root);
    // ⑨ 文件类型不符：报告后被换成符号链接
    report('u9', () => writeFileSync(join(root, 'src/a.js'), 'v9'));
    unlinkSync(join(root, 'src/a.js'));
    symlinkSync('b.js', join(root, 'src/a.js'));
    expect(restore('u9', 'src/a.js').status).toBe(1);
    expect(lstatSync(join(root, 'src/a.js')).isSymbolicLink()).toBe(true);
    unlinkSync(join(root, 'src/a.js'));
    writeFileSync(join(root, 'src/a.js'), orig('src/a.js'));
    // ⑩ 执行前权限位 0755：恢复后仍为 0755
    report('u10', () => { writeFileSync(join(root, 'src/s.sh'), 'changed'); chmodSync(join(root, 'src/s.sh'), 0o644); });
    expect(restore('u10', 'src/s.sh').status).toBe(0);
    expect(statSync(join(root, 'src/s.sh')).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(root, 'src/s.sh'), 'utf-8')).toBe(orig('src/s.sh'));
    // ⑪ 执行前普通文件 → 执行后指向另一个受保护文件的项目内符号链接：按报告路径定位目录项（不跟随链接到 src/b.js），
    //    链接被替换为原文件，链接目标内容不变
    const bBefore = readFileSync(join(root, 'src/b.js'));
    const r11 = report('u11', () => { unlinkSync(join(root, 'src/a.js')); symlinkSync('b.js', join(root, 'src/a.js')); });
    expect(r11).toContain('src/a.js（类型变化）');
    const x11 = restore('u11', 'src/a.js');
    expect(x11.status, x11.stderr).toBe(0);
    expect(lstatSync(join(root, 'src/a.js')).isFile()).toBe(true);
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe(orig('src/a.js'));
    expect(lstatSync(join(root, 'src/b.js')).isFile()).toBe(true);
    expect(readFileSync(join(root, 'src/b.js')).equals(bBefore), '链接目标内容不变').toBe(true);
    // 父目录经项目内符号链接给出：父目录 realpath 后定位到同一目录项；父目录逃逸到项目外：拒绝 exit 1
    expect(engine.entryRelOfRoot(root, 'src/a.js')).toBe('src/a.js');
    symlinkSync('src', join(root, 'lnk'));
    expect(engine.entryRelOfRoot(root, 'lnk/a.js'), '项目内父目录链接').toBe('src/a.js');
    symlinkSync('b.js', join(root, 'src/l3.js'));
    expect(engine.entryRelOfRoot(root, 'src/l3.js'), '最后一级不解析').toBe('src/l3.js');
    unlinkSync(join(root, 'src/l3.js'));
    const outDir = tempRoot();
    writeFileSync(join(outDir, 'x.js'), 'OUT\n');
    symlinkSync(outDir, join(root, 'src/out'));
    expect(engine.entryRelOfRoot(root, 'src/out/x.js'), '父目录逃逸').toBeNull();
    const x11b = restore('u11', 'src/out/x.js');
    expect(x11b.status).toBe(1);
    expect(x11b.stderr).toContain('不在项目根之内');
    expect(readFileSync(join(outDir, 'x.js'), 'utf-8')).toBe('OUT\n');
    unlinkSync(join(root, 'src/out'));
    unlinkSync(join(root, 'lnk'));
    // ⑫ 只改执行位（0755 → 0644，git 记录为 100755 → 100644）：报告为执行位变化，restore 恢复执行位
    const r12 = report('u12', () => chmodSync(join(root, 'src/s.sh'), 0o644));
    expect(r12).toContain('src/s.sh（类型变化：执行位变化 100755 → 100644）');
    expect(restore('u12', 'src/s.sh').status).toBe(0);
    expect(statSync(join(root, 'src/s.sh')).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(root, 'src/s.sh'), 'utf-8')).toBe(orig('src/s.sh'));
    // 成功恢复不产生新报告
    expect(snapshot(root, 'ls', 'u13').exitCode).toBe(0);
    expectQuiet(postToolUse(root, 'ls', 'u13'), '恢复后检查');
  }, TIMEOUT);
});

/* ─────────────────────────── 场景 ST ─────────────────────────── */

describe('S09-F 事后检查引擎 — 场景', () => {
  it('ST-S09-152: 构建与依赖写入放行', () => {
    const root = fixture();
    for (const cmd of ['npm ci', 'npm run release:local', 'mkdir -p dist/x', "node -e \"process.stdout.write('log')\" > dist/build.log"]) {
      const c = chain(root, cmd);
      expect(c.pre.exitCode, cmd).toBe(0);
      expect(c.exec!.status, `${cmd}：${c.exec!.stderr}`).toBe(0);
      expectQuiet(c.post, cmd);
      expect(records(root), `${cmd} 非后台记录在 PostToolUse 后删除`).toEqual([]);
    }
    expect(existsSync(join(root, 'dist/build.log'))).toBe(true);
    const edit = preToolUse(root, 'Edit', { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' }, nextId());
    expectQuiet(edit, 'Edit dist/a.txt');
    expect(readJsonl(root, 'pending-reports.jsonl')).toEqual([]);
    expectQuiet(stopHook(root), 'Stop');
  }, TIMEOUT);

  it('ST-S09-154: 全部 git 命令放行且不报告', () => {
    const root = fixture();
    const branch = git(root, ['symbolic-ref', '--short', 'HEAD']).stdout.trim();
    const remote = join(tempRoot(), 'remote.git');
    expect(spawnSync('git', ['init', '-q', '--bare', remote], { env: cleanEnv() }).status).toBe(0);
    expect(git(root, ['config', 'pull.rebase', 'false']).status).toBe(0);
    expect(git(root, ['push', '-q', remote, branch]).status).toBe(0);
    expect(git(root, ['checkout', '-q', '-b', 'feature']).status).toBe(0);
    writeFileSync(join(root, 'src/a.js'), 'feature\n');
    commit(root, 'feature');
    expect(git(root, ['checkout', '-q', branch]).status).toBe(0);
    writeFileSync(join(root, 'src/b.js'), 'stashed\n');
    expect(git(root, ['stash', '-q']).status).toBe(0);
    const cmds = ['git checkout feature', 'git checkout -', 'git merge feature', 'git rebase feature', 'git stash pop',
      `git pull ${remote} ${branch}`, 'git reset --hard HEAD~1', 'git checkout -- src/a.js', 'git restore src/b.js',
      `git push ${remote} HEAD:tmp`, `cd ${root} && git checkout feature`];
    for (const cmd of cmds) {
      const c = chain(root, cmd);
      expect(c.pre.exitCode, cmd).toBe(0);
      expect(c.recordAfterPre, `${cmd} 无未关闭记录时不拍快照`).toBe(false);
      expectQuiet(c.post, cmd);
      expect(records(root), cmd).toEqual([]);
    }
    expect(git(root, ['symbolic-ref', '--short', 'HEAD']).stdout.trim()).toBe('feature');
    expectQuiet(chain(root, 'ls').post, 'ls');
    expectQuiet(stopHook(root), 'Stop');
  }, TIMEOUT);

  it('ST-S09-156: 任何写法改源码被发现（事前放行、事后报告并给出 restore）', () => {
    const root = fixture();
    const start = { a: sha(join(root, 'src/a.js')), b: sha(join(root, 'src/b.js')) };
    const cases: Array<{ cmd: string; exec?: string; path: string; kind: string }> = [
      { cmd: `cd ${root} && sed -i s/a/X/ src/a.js`, exec: `cd ${root} && ${sedExec('s/a/X/', 'src/a.js')}`, path: 'src/a.js', kind: '内容变化' },
      { cmd: NODE_WRITE('src/a.js', 'y'), path: 'src/a.js', kind: '内容变化' },
      { cmd: 'python3 tools/mod.py', path: 'src/b.js', kind: '内容变化' },
      { cmd: 'find src -name b.js -delete', path: 'src/b.js', kind: '删除' },
      { cmd: 'T=src/a.js; echo z > $T', path: 'src/a.js', kind: '内容变化' },
    ];
    for (const c of cases) {
      const run = chain(root, c.cmd, { exec: c.exec });
      expect(run.pre.exitCode, c.cmd).toBe(0);
      const reason = expectReported(run.post, c.cmd);
      expect(reason, c.cmd).toContain(`${c.path}（${c.kind}）`);
      expect(reason, c.cmd).toContain('归因：本次调用');
      const rc = restoreFor(reason, c.path);
      expect(rc, c.cmd).toBe(`${CLAUDE_ENGINE_CMD} restore ${run.id} -- ${c.path}`);
      expect(runRestore(root, rc!).status, c.cmd).toBe(0);
      expect({ a: sha(join(root, 'src/a.js')), b: sha(join(root, 'src/b.js')) }, `${c.cmd} 起点一致`).toEqual(start);
    }
    const blocked = chain(root, 'echo x > src/a.js');
    expect(blocked.pre.exitCode).toBe(2);
    expect(blocked.exec).toBeNull();
    expect(sha(join(root, 'src/a.js'))).toBe(start.a);
  }, TIMEOUT);

  it('ST-S09-157: 写入后失败经 PostToolUseFailure 发现', () => {
    const root = fixture();
    const c = chain(root, "node -e \"require('fs').writeFileSync('src/a.js','y');process.exit(3)\"");
    expect(c.exec!.status).toBe(3);
    const reason = expectReported(c.post, 'PostToolUseFailure');
    expect(reason).toContain('src/a.js');
    expect(records(root), '最终对比后关闭').toEqual([]);
  }, TIMEOUT);

  it('ST-S09-169: 内容级对比：执行前已有不误报，二次修改等不漏报', () => {
    const root = fixture('G-ignored-spec');
    writeFileSync(join(root, 'src/a.js'), 'pre-dirty\n');
    expectQuiet(chain(root, 'ls').post, 'ls 不报告执行前已有改动');
    const status = git(root, ['status', '--porcelain']).stdout;
    const r1 = chain(root, NODE_WRITE('src/a.js', 'second'));
    expect(git(root, ['status', '--porcelain']).stdout, 'git status 前后相同').toBe(status);
    expect(expectReported(r1.post, '二次修改')).toContain('src/a.js（内容变化）');
    const r2 = chain(root, "node -e \"require('fs').unlinkSync('logos/resources/test/t.md')\"");
    expect(expectReported(r2.post, '删除被忽略规格')).toContain('logos/resources/test/t.md（删除）');
    const r3 = chain(root, "node -e \"const fs=require('fs');fs.unlinkSync('src/b.js');fs.symlinkSync('../README.md','src/b.js')\"");
    expect(expectReported(r3.post, '类型变化')).toContain('src/b.js（类型变化）');
  }, TIMEOUT);

  it('ST-S09-170: 脏文件、未跟踪文件与被忽略规格经 restore 逐字节还原', () => {
    const setup = () => {
      const root = fixture('G-ignored-spec');
      expect(git(root, ['config', 'core.autocrlf', 'true']).status).toBe(0);
      expect(git(root, ['config', 'filter.up.clean', 'tr a-z A-Z']).status).toBe(0);
      writeAt(root, '.gitattributes', '*.up filter=up\n');
      writeAt(root, 'src/w.txt', 'w1\nw2\n');
      writeAt(root, 'src/a.up', 'abc\n');
      commit(root, 'filters', ['.gitattributes', 'src/w.txt', 'src/a.up']);
      writeAt(root, 'src/a.js', 'dirty\n');
      writeAt(root, 'src/new.js', 'new\n');
      writeAt(root, 'logos/resources/test/huge.md', Buffer.alloc(6 * 1024 * 1024, 66));
      writeAt(root, 'src/w.txt', 'w1\r\nw2\r\nw3\r\n');
      writeAt(root, 'src/a.up', 'abcd\n');
      return root;
    };
    const files = ['src/a.js', 'src/new.js', 'logos/resources/test/t.md', 'logos/resources/test/huge.md', 'src/w.txt', 'src/a.up'];
    const writer = `node -e "const fs=require('fs');for (const f of ${JSON.stringify(files).replace(/"/g, "'")}) fs.writeFileSync(f,'changed '+f)"`;
    const root = setup();
    const before = Object.fromEntries(files.map(f => [f, sha(join(root, f))]));
    const c = chain(root, writer);
    const reason = expectReported(c.post, '①');
    for (const f of files) expect(reason, f).toContain(f);
    expect(restoreFor(reason, 'logos/resources/test/huge.md'), 'huge.md 无恢复命令').toBeUndefined();
    expect(reason).toContain('不可自动恢复');
    for (const f of files.filter(x => !x.endsWith('huge.md'))) {
      const rc = restoreFor(reason, f);
      expect(rc, f).toBeDefined();
      expect(runRestore(root, rc!).status, f).toBe(0);
      expect(sha(join(root, f)), `${f} 逐字节还原`).toBe(before[f]);
    }
    expect(readFileSync(join(root, 'src/w.txt'), 'utf-8')).toContain('\r\n');
    expect(readFileSync(join(root, 'src/a.up'), 'utf-8')).toBe('abcd\n');
    writeFileSync(join(root, 'logos/resources/test/huge.md'), Buffer.alloc(6 * 1024 * 1024, 66));
    expectQuiet(chain(root, 'npm ci').post, '恢复后检查不产生新报告');
    // ③ 报告后手动再改 src/a.js：restore exit 1，保持手动内容
    const c2 = chain(root, writer);
    const reason2 = expectReported(c2.post, '③');
    writeFileSync(join(root, 'src/a.js'), 'manual\n');
    const r = runRestore(root, restoreFor(reason2, 'src/a.js')!);
    expect(r.status).toBe(1);
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe('manual\n');
  }, TIMEOUT);

  it('ST-S09-171: git 豁免边界（复合不豁免、可提取目标事前阻断）', () => {
    const root = fixture();
    writeAt(root, 'modify-source.js', "require('fs').writeFileSync('src/a.js','modified\\n')\n");
    commit(root, 'tool');
    expect(git(root, ['branch', 'feature']).status).toBe(0);
    const c1 = chain(root, 'git status && node modify-source.js');
    expect(c1.pre.exitCode).toBe(0);
    const r1 = expectReported(c1.post, '①');
    expect(r1).toContain('src/a.js');
    expect(r1).toContain('拆成单独调用后重试');
    expect(runRestore(root, restoreFor(r1, 'src/a.js')!).status).toBe(0);
    const c2 = chain(root, 'git diff > src/a.ts');
    expect(c2.pre.exitCode).toBe(2);
    expect(existsSync(join(root, 'src/a.ts'))).toBe(false);
    const c3 = chain(root, 'T=src/a.ts; git diff > $T');
    expect(c3.pre.exitCode).toBe(0);
    const r3 = expectReported(c3.post, '③');
    expect(r3).toContain('src/a.ts（新增）');
    expect(r3).toContain('拆成单独调用后重试');
    expect(runRestore(root, restoreFor(r3, 'src/a.ts')!).status).toBe(0);
    const c4 = chain(root, `cd ${root} && git checkout feature`);
    expect(c4.pre.exitCode).toBe(0);
    expectQuiet(c4.post, '④');
  }, TIMEOUT);

  it('ST-S09-174: CLI 自身写入不误报、复合调用不豁免', () => {
    const root = fixture();
    writeAt(root, 'modify-source.js', "require('fs').writeFileSync('src/a.js','modified\\n')\n");
    commit(root, 'tool');
    const sync = `node ${JSON.stringify(CLI)} sync`;
    // ① 无未关闭记录：独立 openlogos sync 不拍快照、不报告
    const c1 = chain(root, 'openlogos sync', { exec: sync });
    expect(c1.exec!.status, c1.exec!.stderr).toBe(0);
    expect(c1.recordAfterPre).toBe(false);
    expectQuiet(c1.post, '①');
    commit(root, 'synced');
    // ② 后台 R1 未关闭：sync 前后 rebase，只更新 sync 改动的路径
    rmSync(join(root, '.gitattributes'), { force: true });
    expect(snapshot(root, 'node dev-server.js', 'R1', true).exitCode).toBe(0);
    const beforeEntries = readRecord(root, 'R1').entries;
    const c2 = chain(root, 'openlogos sync', { exec: sync });
    expect(c2.pre.exitCode).toBe(0);
    expectQuiet(c2.post, '②');
    expectQuiet(chain(root, 'ls').post, '② ls');
    const afterEntries = readRecord(root, 'R1').entries;
    const changed = [...new Set([...Object.keys(beforeEntries), ...Object.keys(afterEntries)])]
      .filter(k => JSON.stringify(beforeEntries[k]) !== JSON.stringify(afterEntries[k])).sort();
    expect(changed).toContain('.gitattributes');
    expect(changed.every(k => ['.gitattributes', '.gitignore', 'logos/.openlogos-sync.json'].includes(k)), changed.join(',')).toBe(true);
    // ③ 复合调用不豁免：报告 src/a.js 并提示拆分
    const c3 = chain(root, 'openlogos sync && node modify-source.js', { exec: `${sync} && node modify-source.js` });
    const r3 = expectReported(c3.post, '③');
    expect(r3).toContain('src/a.js');
    expect(r3).toContain('拆成单独调用后重试');
    // ④ baseline-seed begin 作为独立 openlogos 调用（C13）：放行且不报告
    const c4 = chain(root, 'openlogos baseline-seed begin --module core --manifest logos/resources/reference/temp/m.json',
      { exec: `node ${JSON.stringify(CLI)} baseline-seed begin --module core --manifest logos/resources/reference/temp/m.json` });
    expect(c4.pre.exitCode).toBe(0);
    expect(c4.post!.exitCode).toBe(0);
    // run.json 仍属受保护内容：AI 经 Write 直接写入事前 exit 2
    const w = preToolUse(root, 'Write', { file_path: 'logos/resources/verify/baseline-seed-runs/core-20260101-001/run.json', content: '{}' }, nextId());
    expect(w.exitCode).toBe(2);
  }, TIMEOUT);

  it('ST-S09-177: 修改忽略规则来源与保护范围配置被发现', () => {
    for (const kind of ['G-repo', 'G-ignored-spec'] as FixtureKind[]) {
      const root = fixture(kind);
      writeAt(root, '.config/ignore', '*.tmp\n');
      expect(git(root, ['config', 'core.excludesFile', join(root, '.config/ignore')]).status).toBe(0);
      const gi = sha(join(root, '.gitignore'));
      const cfg = sha(join(root, 'logos/logos.config.json'));
      expect(preToolUse(root, 'Edit', { file_path: '.gitignore', old_string: 'dist/', new_string: 'src/' }, nextId()).exitCode).toBe(2);
      expect(preToolUse(root, 'Write', { file_path: 'logos/logos.config.json', content: '{"guard":{"exempt":["src/"]}}' }, nextId()).exitCode).toBe(2);
      expect([sha(join(root, '.gitignore')), sha(join(root, 'logos/logos.config.json'))]).toEqual([gi, cfg]);
      const bashCases: Array<[string, string]> = [
        ['echo src/ | tee -a .git/info/exclude', '.git/info/exclude'],
        ["node -e \"require('fs').appendFileSync('.config/ignore','src/\\n')\"", '.config/ignore'],
        ["node -e \"require('fs').writeFileSync('src/.gitignore','*\\n')\"", 'src/.gitignore'],
        ["node -e \"const fs=require('fs');const p='logos/logos.config.json';const c=JSON.parse(fs.readFileSync(p));c.guard={exempt:['src/']};fs.writeFileSync(p,JSON.stringify(c))\"", 'logos/logos.config.json'],
      ];
      for (const [cmd, rel] of bashCases) {
        const c = chain(root, cmd);
        expect(c.pre.exitCode, `${kind} ${cmd}`).toBe(0);
        const reason = expectReported(c.post, `${kind} ${cmd}`);
        expect(reason).toContain(rel);
        expect(runRestore(root, restoreFor(reason, rel)!).status, `${kind} restore ${rel}`).toBe(0);
      }
      expect(callIsProtected(loadGuardRegion(tempRoot()).file, root, 'src/a.js').protected, `${kind} src/a.js 仍受保护`).toBe(true);
      // 被忽略目录（dist/）之内的 .gitignore 同样是忽略规则来源（C14 任意层级）：进入快照，间接改写 / 新建被事后发现
      writeAt(root, 'dist/.gitignore', 'keep\n');
      expect(git(root, ['check-ignore', '-q', 'dist/.gitignore']).status, `${kind} dist/.gitignore 被忽略`).toBe(0);
      const distRules: Array<[string, string, string]> = [
        ["node -e \"require('fs').writeFileSync('dist/.gitignore','*\\n')\"", 'dist/.gitignore', '内容变化'],
        ["node -e \"require('fs').mkdirSync('dist/sub',{recursive:true});require('fs').writeFileSync('dist/sub/.gitignore','x')\"", 'dist/sub/.gitignore', '新增'],
      ];
      for (const [cmd, rel, label] of distRules) {
        const c = chain(root, cmd);
        expect(c.pre.exitCode, `${kind} ${cmd}`).toBe(0);
        const reason = expectReported(c.post, `${kind} ${cmd}`);
        expect(reason).toContain(`${rel}（${label}）`);
        expect(runRestore(root, restoreFor(reason, rel)!).status, `${kind} restore ${rel}`).toBe(0);
      }
      expect(readFileSync(join(root, 'dist/.gitignore'), 'utf-8')).toBe('keep\n');
      expect(existsSync(join(root, 'dist/sub/.gitignore'))).toBe(false);
      // 可确定目标的写入在事前即被阻断：is_protected 第 3 步先于「被忽略」判定
      const pre = preToolUse(root, 'Bash', { command: 'echo x >> dist/.gitignore' }, nextId());
      expect(pre.exitCode, `${kind} echo >> dist/.gitignore`).toBe(2);
      expect(pre.stderr).toContain('dist/.gitignore');
      expect(readFileSync(join(root, 'dist/.gitignore'), 'utf-8')).toBe('keep\n');
      if (kind === 'G-ignored-spec') {
        // logos.config.json 被 git 忽略（未跟踪）时结论相同
        writeFileSync(join(root, '.gitignore'), readFileSync(join(root, '.gitignore'), 'utf-8').replace('!/logos/logos.config.json\n', ''));
        expect(git(root, ['rm', '-q', '--cached', 'logos/logos.config.json']).status).toBe(0);
        commit(root, 'untrack config', ['.gitignore']);
        expect(git(root, ['check-ignore', '-q', 'logos/logos.config.json']).status).toBe(0);
        const c = chain(root, bashCases[3][0]);
        expect(expectReported(c.post, 'ignored config')).toContain('logos/logos.config.json');
      }
    }
  }, TIMEOUT);

  it('ST-S09-180: git 元数据改动被事后发现，独立 git config 只更新基线', () => {
    const root = fixture();
    const meta: Array<[string, string]> = [
      ["node -e \"require('fs').appendFileSync('.git/config','[alias]\\n\\tx = !rm -rf src\\n')\"", '.git/config'],
      ["node -e \"require('fs').writeFileSync('.git/hooks/pre-commit','#!/bin/sh\\n')\"", '.git/hooks/pre-commit'],
      ["node -e \"require('fs').appendFileSync('.git/info/exclude','src/\\n')\"", '.git/info/exclude'],
    ];
    for (const [cmd, rel] of meta) {
      const c = chain(root, cmd);
      expect(c.pre.exitCode, cmd).toBe(0);
      const reason = expectReported(c.post, cmd);
      expect(reason).toContain(rel);
      const rc = restoreFor(reason, rel);
      expect(rc, `${rel} 恢复命令`).toBeDefined();
      expect(runRestore(root, rc!).status).toBe(0);
    }
    expect(snapshot(root, 'node dev-server.js', 'R1', true).exitCode).toBe(0);
    const before = readRecord(root, 'R1').entries;
    const g = chain(root, 'git config user.name x');
    expect([g.pre.exitCode, g.post!.exitCode]).toEqual([0, 0]);
    expectQuiet(chain(root, 'ls').post, '④ ls');
    const after = readRecord(root, 'R1').entries;
    const changed = Object.keys({ ...before, ...after }).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    expect(changed).toEqual(['.git/config']);
    const c5 = chain(root, meta[0][0]);
    expect(expectReported(c5.post, '⑤')).toContain('.git/config');
  }, TIMEOUT);

  it('ST-S09-183: 事件级去重：恢复后再改为同一内容重新报告，未恢复只报一次', () => {
    const root = fixture();
    const c1 = chain(root, NODE_WRITE('src/a.js', 'X'));
    const r1 = expectReported(c1.post, '①');
    expect(runRestore(root, restoreFor(r1, 'src/a.js')!).status).toBe(0);
    expectQuiet(chain(root, 'ls').post, '③');
    expect(expectReported(chain(root, NODE_WRITE('src/a.js', 'X')).post, '④')).toContain('src/a.js');
    // ⑤ 另一轮：改为 X 后不恢复
    const root2 = fixture();
    expectReported(chain(root2, NODE_WRITE('src/a.js', 'X')).post, '⑤ 首次');
    for (let i = 0; i < 3; i++) expectQuiet(chain(root2, 'ls').post, `⑤ ls ${i}`);
    expectQuiet(stopHook(root2), '⑤ Stop');
  }, TIMEOUT);

  it('ST-S09-184: clean filter 下干净文件被改写可发现并还原原始字节', () => {
    const root = fixture();
    writeAt(root, '.gitattributes', '*.up filter=up\n');
    expect(git(root, ['config', 'filter.up.clean', 'tr a-z A-Z']).status).toBe(0);
    writeAt(root, 'src/h.up', 'hello');
    commit(root, 'h');
    const before = sha(join(root, 'src/h.up'));
    const c = chain(root, NODE_WRITE('src/h.up', 'HELLO'));
    const reason = expectReported(c.post, '①');
    expect(reason).toContain('src/h.up');
    expect(reason).not.toContain('git checkout');
    expect(git(root, ['diff', '--quiet', '--', 'src/h.up']).status).toBe(0);
    expect(runRestore(root, restoreFor(reason, 'src/h.up')!).status).toBe(0);
    expect(readFileSync(join(root, 'src/h.up'), 'utf-8')).toBe('hello');
    expect(sha(join(root, 'src/h.up'))).toBe(before);
    expectQuiet(chain(root, 'npm ci').post, '之后检查不报告');
  }, TIMEOUT);

  it('ST-S09-185: restore 恢复矩阵', () => {
    const root = fixture();
    const outside = join(tempRoot(), 'outside.txt');
    writeFileSync(outside, 'OUT\n');
    const orig = { a: readFileSync(join(root, 'src/a.js')), b: readFileSync(join(root, 'src/b.js')) };
    const run = (cmd: string, rel: string) => {
      const reason = expectReported(chain(root, cmd).post, cmd);
      return restoreFor(reason, rel)!;
    };
    // ①
    const r1 = run(`node -e "const fs=require('fs');fs.unlinkSync('src/a.js');fs.symlinkSync(${JSON.stringify(outside).replace(/"/g, "'")},'src/a.js')"`, 'src/a.js');
    expect(runRestore(root, r1).status).toBe(0);
    expect(lstatSync(join(root, 'src/a.js')).isFile()).toBe(true);
    expect(readFileSync(join(root, 'src/a.js')).equals(orig.a)).toBe(true);
    expect(readFileSync(outside, 'utf-8')).toBe('OUT\n');
    // ②
    const r2 = run("node -e \"const fs=require('fs');fs.unlinkSync('src/b.js');fs.mkdirSync('src/b.js')\"", 'src/b.js');
    const x2 = runRestore(root, r2);
    expect(x2.status).toBe(1);
    expect(statSync(join(root, 'src/b.js')).isDirectory()).toBe(true);
    rmSync(join(root, 'src/b.js'), { recursive: true });
    writeFileSync(join(root, 'src/b.js'), orig.b);
    expectQuiet(chain(root, 'npm ci').post, '② 复位');
    // ③
    const r3 = run("node -e \"require('fs').unlinkSync('src/b.js')\"", 'src/b.js');
    expect(runRestore(root, r3).status).toBe(0);
    expect(readFileSync(join(root, 'src/b.js')).equals(orig.b)).toBe(true);
    // ④
    const r4 = run(NODE_WRITE('src/new.js', 'n'), 'src/new.js');
    expect(runRestore(root, r4).status).toBe(0);
    expect(existsSync(join(root, 'src/new.js'))).toBe(false);
    // ⑤
    const r5 = run(NODE_WRITE('src/a.js', 'v1'), 'src/a.js');
    writeFileSync(join(root, 'src/a.js'), 'manual');
    expect(runRestore(root, r5).status).toBe(1);
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe('manual');
    writeFileSync(join(root, 'src/a.js'), orig.a);
    expectQuiet(chain(root, 'npm ci').post, '⑤ 复位');
    // ⑥ 执行前普通文件 → 执行后指向另一个受保护文件（src/b.js）的项目内符号链接：按报告路径恢复，
    //    链接被替换为原文件，链接目标内容不变
    const r6 = run("node -e \"const fs=require('fs');fs.unlinkSync('src/a.js');fs.symlinkSync('b.js','src/a.js')\"", 'src/a.js');
    const x6 = runRestore(root, r6);
    expect(x6.status, x6.stderr).toBe(0);
    expect(lstatSync(join(root, 'src/a.js')).isFile()).toBe(true);
    expect(readFileSync(join(root, 'src/a.js')).equals(orig.a)).toBe(true);
    expect(lstatSync(join(root, 'src/b.js')).isFile()).toBe(true);
    expect(readFileSync(join(root, 'src/b.js')).equals(orig.b), '链接目标内容不变').toBe(true);
    expectQuiet(chain(root, 'ls').post, '⑥ 恢复后不再报告');
  }, TIMEOUT);

  it('ST-S09-191: 独立调用形态的 restore 不被误报', () => {
    const root = fixture();
    writeAt(root, 'src/new.js', 'orig\n');
    const origNew = sha(join(root, 'src/new.js'));
    expect(snapshot(root, 'node dev-server.js', 'R1', true).exitCode).toBe(0);
    const c1 = chain(root, NODE_WRITE('src/new.js', 'evil'));
    const r1 = expectReported(c1.post, '①');
    const rc = restoreFor(r1, 'src/new.js')!;
    const r1Before = readRecord(root, 'R1').entries;
    // ② 经完整 hook 链执行 cd <根> && restore：不拍快照、不报告
    const c2 = chain(root, `cd ${root} && ${rc}`);
    expect(c2.pre.exitCode).toBe(0);
    expect(c2.recordAfterPre, '独立 restore 不拍快照').toBe(false);
    expectQuiet(c2.post, '②');
    expect(sha(join(root, 'src/new.js'))).toBe(origNew);
    const r1After = readRecord(root, 'R1').entries;
    expect(r1After['src/new.js'].digest).toBe(rawOid(root, 'src/new.js'));
    const others = Object.keys(r1Before).filter(k => k !== 'src/new.js');
    for (const k of others) expect(r1After[k], k).toEqual(r1Before[k]);
    expect(readJsonl(root, 'reported.jsonl').some(e => e.path === 'src/new.js')).toBe(false);
    // ③
    expectQuiet(chain(root, 'ls').post, '③ ls');
    expectQuiet(stopHook(root), '③ Stop');
    // ④ 非托管路径的引擎副本：不享受豁免，按普通 Bash 拍快照并对比
    const c4a = chain(root, NODE_WRITE('src/new.js', 'evil2'));
    const r4 = expectReported(c4a.post, '④ 报告');
    const copy = join(tempRoot(), 'guard-post-check.cjs');
    writeFileSync(copy, readFileSync(join(root, '.claude/openlogos/bin/guard-post-check.cjs')));
    const alt = restoreFor(r4, 'src/new.js')!.replace(CLAUDE_ENGINE_CMD, `node ${copy}`);
    const c4 = chain(root, alt);
    expect(c4.pre.exitCode).toBe(0);
    expect(c4.recordAfterPre, '非托管路径拍快照').toBe(true);
    expect(c4.exec!.status).toBe(0);
    expect(c4.post!.exitCode).toBe(0);
  }, TIMEOUT);

  it('ST-S09-192: 复合形态的 restore 不享受豁免', () => {
    const root = fixture();
    const r1 = expectReported(chain(root, NODE_WRITE('src/a.js', 'evil')).post, '①');
    const rc = restoreFor(r1, 'src/a.js')!;
    const c2 = chain(root, `${rc} && echo x > src/other.js`);
    expect(c2.pre.exitCode).toBe(2);
    expect(c2.exec).toBeNull();
    expect(existsSync(join(root, 'src/other.js'))).toBe(false);
    const c3 = chain(root, `T=src/other.js; ${rc} && echo x > $T`);
    expect(c3.pre.exitCode).toBe(0);
    expect(c3.recordAfterPre).toBe(true);
    const r3 = expectReported(c3.post, '③');
    expect(r3).toContain('src/other.js（新增）');
    expect(r3).not.toContain('  - src/a.js');
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe('a\n');
  }, TIMEOUT);
});
