/**
 * branch-sync-generated-files 切片 3：branch sync 的保护与恢复（S44）。
 *
 * 覆盖 UT-S44-14、UT-S44-15、UT-S44-18、UT-S44-24、UT-S44-27、ST-S44-04、ST-S44-05
 * （logos/resources/test/core-S44-test-cases.md）。规范源：spec/branch-sync.md §4.4、§6、§7.2、§7.4、§7.5。
 * 基线夹具按 baseline-seed-txn.ts 的真实格式构造（提交记录经其严格校验）或由真实 baseline-seed 命令产生；
 * 取锁前后的交错、中途失败与 git 拒绝使用进程内注入点，不依赖时序竞争或磁盘故障；其余经真实 CLI 进程执行。
 * 「本地文件未被覆盖」以未入库文件执行前后的 SHA-256 比对取证。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { captureConsole, makeTempRoot, mockCwd, mockProcessExit, takeExitCode } from './helpers.js';
import { branchCommand } from '../src/commands/branch.js';
import type { BranchSyncHooks } from '../src/lib/branch-sync.js';
import {
  acquireLock, atomicWriteJson, backupDir, findUnfinalizedJournal, journalPath, lockPath, readRunRecord, releaseLock,
  runRecordPath, sha256, stagingDir, type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import { candidateKey } from '../src/lib/baseline-provenance.js';
import { cleanupFixtures, CONFIG, Fixture, LEDGER, REGISTRY, REPORT, VERIFY } from './s44-helpers.js';

const extraCleanups: Array<() => void> = [];
afterEach(() => {
  cleanupFixtures();
  while (extraCleanups.length > 0) extraCleanups.pop()!();
});

const RUNS = `${VERIFY}/baseline-seed-runs`;
const DEPLOY_REPORT = `${VERIFY}/deployment-report.md`;
const MARKER = 'logos/changes/a/VERIFY_PASS';
const TARGET = 'logos/resources/prd/core-system-map.md';

function rewriteArtifacts(fx: Fixture, who: string): void {
  fx.put(REPORT, `# Acceptance Report\n\n${who}\n`);
  fx.put(LEDGER, `{"id":"UT-${who}-01","status":"pass"}\n`);
}

/** 常用构造：两条分支各自重写验收产物，活跃提案 a 有（被跟踪的）VERIFY_PASS。 */
function divergedFixture(opts: { registry?: string } = {}): Fixture {
  const fx = new Fixture(opts);
  fx.put(MARKER, 'pass\n');
  fx.commit('marker');
  fx.diverge(f => rewriteArtifacts(f, 'A'), f => rewriteArtifacts(f, 'B'));
  return fx;
}

/** 按真实格式写出一条提交记录（经 readJournalStrict 的全部校验）。 */
function writeJournal(fx: Fixture, runId: string, phase: CommitJournal['phase'], moduleId = 'core'): void {
  const journal: CommitJournal = {
    phase,
    run_id: runId,
    module: moduleId,
    targets: [{ target_path: TARGET, old_sha256: null, new_sha256: sha256('new content'), applied: false }],
    // 备份路径按真实命令的写法取项目根的真实路径（CLI 进程的 cwd 是解析过符号链接的路径）
    index: { yaml_backup_path: join(backupDir(realpathSync(fx.root), runId), 'logos-project.yaml.bak'), old_yaml_sha256: sha256(fx.read(REGISTRY)) },
    state_transition: { from: 'required', to: 'seeded' },
    keys: [candidateKey(moduleId, 'cli:one')],
  };
  mkdirSync(dirname(journalPath(fx.root, runId)), { recursive: true });
  atomicWriteJson(journalPath(fx.root, runId), journal);
}

interface InProcessResult { exit: number | string | null | undefined; data?: Record<string, any>; error?: Record<string, any> }

/** 进程内执行 `branch sync --base main --format json`，可带注入点。 */
async function syncInProcess(fx: Fixture, hooks: BranchSyncHooks): Promise<InProcessResult> {
  const restoreCwd = mockCwd(realpathSync(fx.root));
  const con = captureConsole();
  const exitSpy = mockProcessExit();
  try {
    let exit: number | string | null | undefined;
    try {
      await branchCommand('sync', 'json', { base: 'main' }, hooks);
      exit = takeExitCode() ?? 0;
    } catch (error) {
      // mockProcessExit 把 process.exit(n) 变成抛错
      const m = /process\.exit\((\d+)\)/.exec(String((error as Error).message));
      if (!m) throw error;
      exit = Number(m[1]);
    }
    if (con.errors.length > 0) return { exit, error: (JSON.parse(con.errors[0]) as Record<string, any>).error };
    return { exit, data: (JSON.parse(con.logs[0]) as Record<string, any>).data };
  } finally {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
  }
}

const lockFree = (fx: Fixture, moduleId = 'core'): boolean => !existsSync(lockPath(fx.root, moduleId));

describe('S44 基线事务协同', () => {
  it('UT-S44-14: 拿不到锁、或持锁检查时存在未终结 / 损坏的提交记录——零改动拒绝，不执行恢复', async () => {
    const expectRefused = (fx: Fixture, r: { status?: number | null; exit?: unknown; error?: Record<string, any> }, before: ReturnType<Fixture['state']>): void => {
      expect(r.status ?? r.exit).toBe(1);
      expect(r.error!.code).toBe('baseline_commit_in_progress');
      expect(fx.merging()).toBe(false);
      expect(fx.state()).toEqual(before); // 含提交记录字节不变（未执行恢复）与标记仍在
      expect(fx.exists(MARKER)).toBe(true);
    };

    // ① core 存在阶段为 committing 的未终结提交记录
    const f1 = divergedFixture();
    writeJournal(f1, 'seed-core-0001', 'committing');
    let before = f1.state();
    expectRefused(f1, f1.sync(), before);
    expect(findUnfinalizedJournal(f1.root, 'core')!.runId).toBe('seed-core-0001');

    // ② 提交记录文件被截断
    const f2 = divergedFixture();
    f2.put(`${RUNS}/seed-core-0001/commit-journal.json`, '{"phase":"committing","run_id":"seed-core-0');
    before = f2.state();
    expectRefused(f2, f2.sync(), before);

    // ③ 另一个进程（本测试进程）持有 core 的事务锁
    const f3 = divergedFixture();
    expect(acquireLock(f3.root, 'core')).toBe(true);
    try {
      before = f3.state();
      expectRefused(f3, f3.sync(), before);
    } finally { releaseLock(f3.root, 'core'); }

    // ④ 多模块：team 的锁被占用、core 可取得——结束后 core 的锁已释放
    const f4 = divergedFixture({ registry: stringifyYaml({
      project: { name: 'x' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }, { id: 'team', name: 'Team', lifecycle: 'launched' }],
      resource_index: [],
    }) });
    expect(acquireLock(f4.root, 'team')).toBe(true);
    try {
      before = f4.state();
      const r4 = f4.sync();
      expectRefused(f4, r4, before);
      expect(r4.error!.message).toContain('team');
      expect(lockFree(f4, 'core')).toBe(true);
    } finally { releaseLock(f4.root, 'team'); }

    // ⑤ 确定性交错：同步开始时没有未终结的记录；在「取锁之前」另一方取得锁、写下 committing 记录后不终结并释放锁
    const f5 = divergedFixture();
    let beforeLocks: ReturnType<Fixture['state']> | null = null;
    const r5 = await syncInProcess(f5, {
      beforeAcquireLocks: () => {
        expect(findUnfinalizedJournal(f5.root, 'core')).toBeNull();
        writeJournal(f5, 'seed-core-0001', 'committing');
        beforeLocks = f5.state();
      },
    });
    // 被拒绝即证明提交记录的检查发生在持锁之后
    expectRefused(f5, r5, beforeLocks!);
    expect(lockFree(f5)).toBe(true);

    // ⑥ 「取锁之后、发起合并之前」工作区被改动：持锁重验拒绝
    const f6 = divergedFixture();
    const head6 = f6.head();
    const r6 = await syncInProcess(f6, { afterAcquireLocks: () => f6.put(REPORT, 'changed while starting\n') });
    expect(r6.exit).toBe(1);
    expect(r6.error!.code).toBe('BRANCH_WORKTREE_DIRTY');
    expect(f6.merging()).toBe(false);
    expect(f6.head()).toBe(head6);
    expect(f6.exists(MARKER)).toBe(true);
    expect(lockFree(f6)).toBe(true);
  }, 60_000);

  it('UT-S44-14: 主分支引用在持锁重验之后被推进——合并、文件处置、登记表与输出使用同一个已确认的提交', async () => {
    const registry = (ids: string[]): string => stringifyYaml({ project: { name: 'x' }, scenarios: ids.map(id => ({ id, name: id })), resource_index: [] });
    const fx = new Fixture({ registry: registry(['S01']) });
    const c = fx.diverge(
      f => { rewriteArtifacts(f, 'A'); f.put(REGISTRY, registry(['S01', 'S50'])); },
      f => { rewriteArtifacts(f, 'B1'); f.put(REGISTRY, registry(['S01', 'S51'])); },
    );
    // 预先造好 B2（main 的下一个提交），再把 main 放回 B1；同步期间由注入点把 main 推进到 B2
    fx.git(['checkout', '-q', 'main']);
    rewriteArtifacts(fx, 'B2');
    fx.put(REGISTRY, registry(['S01', 'S51', 'S52']));
    const B2 = fx.commit('B2');
    fx.git(['checkout', '-q', 'proposal/a']);
    fx.git(['update-ref', 'refs/heads/main', c.main]);

    let moved = false;
    const r = await syncInProcess(fx, {
      // 发起合并的那一刻（持锁重验已经通过）另一个工作目录把主分支推进到了 B2
      git: args => {
        if (args.includes('merge') && !args.includes('--abort') && !moved) {
          fx.git(['update-ref', 'refs/heads/main', B2]);
          moved = true;
        }
        return undefined;
      },
    });
    expect(moved).toBe(true);
    expect(fx.git(['rev-parse', 'main'])).toBe(B2);
    expect(r.exit).toBe(0);
    expect(r.data!.result).toBe('synced');
    // 输出身份、实际合并的父提交、文件处置与登记表全部是 B1，没有混入 B2
    expect(r.data!.base.commit).toBe(c.main);
    expect(fx.git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)).toEqual([c.prop, c.main]);
    expect(fx.tryGit(['merge-base', '--is-ancestor', B2, 'HEAD']).status).toBe(1);
    expect(fx.bytes(REPORT).equals(fx.blob(c.main, REPORT))).toBe(true);
    expect(fx.bytes(LEDGER).equals(fx.blob(c.main, LEDGER))).toBe(true);
    expect(fx.read(REPORT)).not.toContain('B2');
    expect((parseYaml(fx.read(REGISTRY)) as Record<string, any>).scenarios.map((s: { id: string }) => s.id)).toEqual(['S01', 'S50', 'S51']);
    expect(fx.git(['status', '--porcelain'])).toBe('');
    // 之后再同步一次才会带进 B2
    const next = fx.sync();
    expect(next.data).toMatchObject({ result: 'synced' });
    expect(next.data!.base.commit).toBe(B2);
    expect(fx.read(REPORT)).toContain('B2');
  }, 30_000);

  it('UT-S44-14: 同步结束后模块锁均已释放——成功、仍有冲突、失败三种结果', async () => {
    const ok = divergedFixture();
    expect(ok.sync().data!.result).toBe('synced');
    expect(lockFree(ok)).toBe(true);
    // 没有基线事务的项目里不留下空的运行目录
    expect(ok.exists(RUNS)).toBe(false);

    const clash = new Fixture();
    clash.put('clash.txt', 'shared\n');
    clash.commit('clash');
    clash.diverge(f => f.put('clash.txt', 'A\n'), f => f.put('clash.txt', 'B\n'));
    expect(clash.sync().data!.result).toBe('conflicts');
    expect(lockFree(clash)).toBe(true);

    const failed = divergedFixture();
    const r = await syncInProcess(failed, { beforeStep: step => { if (step === 'replace') throw new Error('injected'); } });
    expect(r.error!.code).toBe('BRANCH_SYNC_FAILED');
    expect(lockFree(failed)).toBe(true);
  }, 30_000);

  it('UT-S44-15: 分支独有的基线运行完整保留；同一次运行两边改动不同时报 baseline-run-diverged', () => {
    /** 一次运行的全部被跟踪材料。 */
    const putRun = (fx: Fixture, runId: string, note: string): void => {
      fx.put(`${RUNS}/${runId}/staging/${TARGET}`, `# staged ${note}\n`);
      fx.put(`${RUNS}/${runId}/resolved/${TARGET}`, `# resolved ${note}\n`);
      fx.put(`${RUNS}/${runId}/backup/logos-project.yaml.bak`, `project: ${note}\n`);
      writeJournal(fx, runId, 'committed');
      fx.put(`${RUNS}/${runId}/run.json`, JSON.stringify({ run_id: runId, module: 'core', status: 'committed', expected: [], created_at: note }, null, 2));
    };

    // ① 本分支有运行 r-a，主分支有另一次运行 r-b
    const fx = new Fixture();
    fx.diverge(f => { putRun(f, 'r-a', 'A'); rewriteArtifacts(f, 'A'); }, f => { putRun(f, 'r-b', 'B'); rewriteArtifacts(f, 'B'); });
    const runFiles = (state: Record<string, string>, runId: string): Record<string, string> =>
      Object.fromEntries(Object.entries(state).filter(([p]) => p.startsWith(`${RUNS}/${runId}/`)));
    const beforeFiles = runFiles(fx.files(), 'r-a');
    const beforeRecord = readRunRecord(fx.root, 'r-a');
    expect(Object.keys(beforeFiles)).toHaveLength(5);
    expect(findUnfinalizedJournal(fx.root, 'core')).toBeNull();

    const r = fx.sync();
    expect(r.status, r.stderr).toBe(0);
    expect(r.data!.result).toBe('synced');
    const after = fx.files();
    expect(runFiles(after, 'r-a')).toEqual(beforeFiles);
    expect(Object.keys(runFiles(after, 'r-b'))).toHaveLength(5);
    expect(after[`${RUNS}/r-b/run.json`]).toBeDefined();
    expect(readRunRecord(fx.root, 'r-a')).toEqual(beforeRecord);
    expect(readRunRecord(fx.root, 'r-b')).toMatchObject({ run_id: 'r-b', status: 'committed' });
    expect(findUnfinalizedJournal(fx.root, 'core')).toBeNull();
    expect((r.data!.replaced as Array<{ path: string }>).some(i => i.path.startsWith(RUNS))).toBe(false);

    // ② 同一次运行的 run.json 两边改成不同内容，改动行不相邻（git 可自动合并）
    const lines = (first: string, last: string): string => [`first: ${first}`, 'a: 1', 'b: 2', 'c: 3', 'd: 4', 'e: 5', 'f: 6', `last: ${last}`, ''].join('\n');
    const auto = new Fixture();
    auto.put(`${RUNS}/r0/run.json`, lines('O', 'O'));
    auto.commit('r0');
    const c2 = auto.diverge(f => f.put(`${RUNS}/r0/run.json`, lines('A', 'O')), f => f.put(`${RUNS}/r0/run.json`, lines('O', 'B')));
    const r2 = auto.sync();
    expect(r2.status).toBe(2);
    expect(r2.data!.result).toBe('conflicts');
    // git 已自动合并（索引中没有未合并的路径），仍列为剩余冲突
    expect(auto.git(['diff', '--name-only', '--diff-filter=U'])).toBe('');
    expect(r2.data!.remaining_conflicts).toEqual([{ path: `${RUNS}/r0/run.json`, category: 'verify-record', reason: 'baseline-run-diverged' }]);
    expect(auto.head()).toBe(c2.prop);
    expect(auto.merging()).toBe(true);

    // ③ 本分支修改 run.json，主分支删除它
    const del = new Fixture();
    del.put(`${RUNS}/r0/run.json`, lines('O', 'O'));
    del.commit('r0');
    const c3 = del.diverge(f => f.put(`${RUNS}/r0/run.json`, lines('A', 'O')), f => { f.remove(`${RUNS}/r0/run.json`); f.put('main.txt', 'm\n'); });
    const r3 = del.sync();
    expect(r3.status).toBe(2);
    expect(r3.data!.remaining_conflicts).toEqual([{ path: `${RUNS}/r0/run.json`, category: 'verify-record', reason: 'baseline-run-diverged' }]);
    expect(del.head()).toBe(c3.prop);
  }, 60_000);
});

describe('S44 中途失败与发起合并前的拒绝', () => {
  it('UT-S44-18: 合并发起后任一步失败都中止合并回到同步前，并报告 step 与 restored', async () => {
    const registry = (extra: string): string => stringifyYaml({
      project: { name: 'x' }, scenarios: [{ id: 'S01', name: '初始化' }, { id: extra, name: extra }], resource_index: [],
    });
    const fx = new Fixture({ registry: stringifyYaml({ project: { name: 'x' }, scenarios: [{ id: 'S01', name: '初始化' }], resource_index: [] }) });
    fx.put(MARKER, 'pass\n');
    fx.commit('marker');
    fx.diverge(
      f => { rewriteArtifacts(f, 'A'); f.put(REGISTRY, registry('S50')); },
      f => { rewriteArtifacts(f, 'B'); f.put(REGISTRY, registry('S51')); },
    );
    const before = fx.state();

    const failAt = (target: string): BranchSyncHooks => ({ beforeStep: step => { if (step === target) throw new Error(`injected ${target} failure`); } });
    const cases: Array<[string, BranchSyncHooks]> = [
      ['replace', failAt('replace')],
      // ② 登记表写回前自检：构造不可解析的合并结果
      ['registry', { tamperRegistryText: () => 'project: [unclosed\n  - : :\n' }],
      ['markers', failAt('markers')],
      ['commit', failAt('commit')],
    ];
    for (const [step, hooks] of cases) {
      const r = await syncInProcess(fx, hooks);
      expect(r.exit, step).toBe(1);
      expect(r.error!.code).toBe('BRANCH_SYNC_FAILED');
      expect(r.error!.details).toEqual({ step, restored: true });
      // MERGE_HEAD 不存在；全部文件、索引与分支指向等于同步前
      expect(fx.merging()).toBe(false);
      expect(fx.state()).toEqual(before);
      expect(lockFree(fx)).toBe(true);
    }
    // 没有注入时同一仓库可以正常同步（恢复确实完整）
    const ok = fx.sync();
    expect(ok.data!.result).toBe('synced');
    expect(ok.data!.registry.status).toBe('merged');

    // ⑤ 处置清单文件失败，且 git merge --abort 也失败
    const stuck = divergedFixture();
    const r5 = await syncInProcess(stuck, {
      ...failAt('replace'),
      git: args => (args.includes('--abort') ? { ok: false, stdout: '', stderr: 'fatal: injected abort failure' } : undefined),
    });
    expect(r5.exit).toBe(1);
    expect(r5.error!.code).toBe('BRANCH_SYNC_FAILED');
    expect(r5.error!.details).toEqual({ step: 'replace', restored: false });
    expect(r5.error!.message).toContain('git merge --abort');
    expect(lockFree(stuck)).toBe(true);

    // ⑥ 纯快进路径上清除标记失败：分支指向回到同步前的提交
    const ff = new Fixture();
    ff.git(['checkout', '-q', '-b', 'proposal/a']);
    ff.git(['checkout', '-q', 'main']);
    rewriteArtifacts(ff, 'B');
    ff.commit('B');
    ff.git(['checkout', '-q', 'proposal/a']);
    ff.put(MARKER, 'local\n');
    const ffBefore = ff.state();
    const r6 = await syncInProcess(ff, failAt('markers'));
    expect(r6.error!.code).toBe('BRANCH_SYNC_FAILED');
    expect(r6.error!.details).toEqual({ step: 'markers', restored: true });
    expect(ff.state()).toEqual(ffBefore);
    expect(lockFree(ff)).toBe(true);
  }, 60_000);

  /** UT-S44-24 的构造：main 新增并跟踪账本、notes.md 与 docs/guide/a.md；本分支不跟踪这些路径。 */
  function collisionFixture(opts: { ownCommit: boolean; local: (fx: Fixture) => void; mainAddsLedger?: boolean }): Fixture {
    const fx = new Fixture();
    fx.git(['rm', '-q', '--cached', LEDGER]);
    fx.remove(LEDGER);
    fx.put('.gitignore', `${LEDGER}\ndocs/guide\n*.cache\n`);
    fx.put(MARKER, 'pass\n');
    fx.commit('untrack ledger');
    fx.git(['checkout', '-q', '-b', 'proposal/a']);
    if (opts.ownCommit) { fx.put('prop.txt', 'p\n'); fx.commit('A'); }
    fx.git(['checkout', '-q', 'main']);
    if (opts.mainAddsLedger !== false) {
      fx.put(LEDGER, '{"id":"UT-MAIN-01","status":"pass"}\n');
      fx.git(['add', '-f', LEDGER]);
      fx.put('notes.md', 'main notes\n');
      fx.put('docs/guide/a.md', '# guide\n');
      fx.git(['add', '-f', 'docs/guide/a.md', 'notes.md']);
    } else {
      fx.put('main.txt', 'm\n');
      fx.git(['add', 'main.txt']);
    }
    fx.git(['commit', '-q', '-m', 'B']);
    fx.git(['checkout', '-q', 'proposal/a']);
    for (const p of [LEDGER, 'notes.md', 'docs']) expect(fx.exists(p)).toBe(false);
    opts.local(fx);
    return fx;
  }

  it('UT-S44-24: 未入库的本地文件占用主分支新增的路径——发起合并前拒绝，本地字节不变（快进与不快进）', () => {
    const expectCollision = (fx: Fixture, expected: string[]): void => {
      const before = fx.state();
      const r = fx.sync();
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.error!.code).toBe('BRANCH_UNTRACKED_COLLISION');
      expect(r.error!.details.paths).toEqual(expected);
      expect(fx.merging()).toBe(false);
      expect(fx.state()).toEqual(before); // HEAD、索引、全部文件（含未入库的本地文件）不变
      expect(fx.exists(MARKER)).toBe(true);
      expect(lockFree(fx)).toBe(true);
    };
    const localLedger = (fx: Fixture): void => fx.put(LEDGER, 'LOCAL LEDGER\n');

    // ① 被忽略的本地账本，本分支有自己的提交（不快进的合并）；② 同上但本分支是 main 的祖先（快进）
    const noFf = collisionFixture({ ownCommit: true, local: localLedger });
    expect(noFf.git(['status', '--porcelain'])).toBe(''); // 被忽略：工作区视为干净
    expectCollision(noFf, [LEDGER]);
    expectCollision(collisionFixture({ ownCommit: false, local: localLedger }), [LEDGER]);
    // ③ 未被跟踪、未被忽略的 notes.md（两种合并方式各一例）
    for (const ownCommit of [true, false]) {
      expectCollision(collisionFixture({ ownCommit, local: fx => fx.put('notes.md', 'my notes\n') }), ['notes.md']);
    }
    // ④ 被忽略的普通文件 docs/guide 占住了上级目录的位置
    expectCollision(collisionFixture({ ownCommit: true, local: fx => fx.put('docs/guide', 'a plain file\n') }), ['docs/guide/a.md']);
    // 多个路径按升序列出
    expectCollision(collisionFixture({ ownCommit: true, local: fx => { fx.put('notes.md', 'x\n'); localLedger(fx); } }), [LEDGER, 'notes.md'].sort());

    // ⑤ 对照：被忽略的本地文件存在，但 main 没有新增同路径的文件——正常同步
    const control = collisionFixture({ ownCommit: true, mainAddsLedger: false, local: fx => { localLedger(fx); fx.put('build.cache', 'cache\n'); } });
    const rc = control.sync();
    expect(rc.status).toBe(0);
    expect(rc.data!.result).toBe('synced');
    expect(control.read(LEDGER)).toBe('LOCAL LEDGER\n');
    expect(control.read('build.cache')).toBe('cache\n');
    expect((rc.data!.replaced as Array<{ path: string }>).map(i => i.path)).not.toContain(LEDGER);

    // 不经 CLI 的对照断言：真正的合并下 --no-overwrite-ignore 不生效，git 会覆盖被忽略的本地文件。
    // 本断言固定「不能依赖 git 选项」这一前提；若 git 行为变化导致它失败，请复核 spec/branch-sync.md §7.4。
    const copy = makeTempRoot();
    extraCleanups.push(copy.cleanup);
    cpSync(noFf.root, copy.root, { recursive: true });
    expect(readFileSync(join(copy.root, LEDGER), 'utf-8')).toBe('LOCAL LEDGER\n');
    spawnSync('git', ['merge', '--no-ff', '--no-commit', '--no-overwrite-ignore', 'main'], { cwd: copy.root, encoding: 'utf-8' });
    expect(readFileSync(join(copy.root, LEDGER), 'utf-8')).toBe('{"id":"UT-MAIN-01","status":"pass"}\n');
  }, 120_000);

  it('UT-S44-27: git 因其他原因拒绝发起合并——BRANCH_SYNC_MERGE_FAILED，仓库状态不变', async () => {
    const fx = divergedFixture();
    const before = fx.state();
    const r = await syncInProcess(fx, {
      git: args => (args.includes('merge') && !args.includes('--abort')
        ? { ok: false, stdout: '', stderr: 'fatal: injected refusal from a pre-merge hook' }
        : undefined),
    });
    expect(r.exit).toBe(1);
    expect(r.error!.code).toBe('BRANCH_SYNC_MERGE_FAILED');
    expect(r.error!.message).toContain('fatal: injected refusal from a pre-merge hook');
    expect(fx.merging()).toBe(false);
    expect(fx.state()).toEqual(before);
    expect(fx.exists(MARKER)).toBe(true);
    expect(lockFree(fx)).toBe(true);
  });
});

describe('S44 保护与恢复 — 场景', () => {
  it('ST-S44-04: 基线运行与部署记录在同步后完整', () => {
    const K1 = candidateKey('core', 'cli:one');
    const K2 = candidateKey('core', 'cli:two');
    const SYSTEM_MAP = 'logos/resources/prd/core-system-map.md';
    const SCENARIOS = 'logos/resources/prd/core-scenario-candidates.md';
    const stagedDoc = (key: string, anchor: string): string =>
      `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n  - key: "${key}"\n    anchor: "${anchor}"\n    state: active\n    verified: false\n\`\`\`\n`;

    const fx = new Fixture({ registry: 'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: required\nresource_index: []\n' });
    fx.put(DEPLOY_REPORT, '# Deployment Report\n\n## deploy 1\n');
    fx.commit('deploy report');
    let runId = '';
    fx.diverge(
      f => {
        // proposal/a：以真实 baseline-seed 流程完成一次种子提交（运行目录被跟踪）
        f.put('seed-plan.json', JSON.stringify({ module: 'core', expected: [
          { kind: 'system-map', target_path: SYSTEM_MAP, candidate_keys: [K1] },
          { kind: 'scenario-candidates', target_path: SCENARIOS, candidate_keys: [K2] },
        ] }));
        const begun = f.cli(['baseline-seed', 'begin', '--module', 'core', '--manifest', 'seed-plan.json', '--format', 'json']);
        expect(begun.status, begun.stderr).toBe(0);
        runId = (JSON.parse(begun.stdout) as Record<string, any>).data.run_id;
        for (const [target, key, anchor] of [[SYSTEM_MAP, K1, 'cli:one'], [SCENARIOS, K2, 'cli:two']]) {
          const p = join(stagingDir(f.root, runId), target);
          mkdirSync(dirname(p), { recursive: true });
          writeFileSync(p, stagedDoc(key, anchor));
        }
        const committed = f.cli(['baseline-seed', 'commit', '--module', 'core', '--run-id', runId, '--format', 'json']);
        expect(committed.status, committed.stderr).toBe(0);
        expect((JSON.parse(committed.stdout) as Record<string, any>).data.baseline_seed_state).toBe('seeded');
        f.put(DEPLOY_REPORT, '# Deployment Report\n\n## deploy 1\n\n## deploy A\n');
        rewriteArtifacts(f, 'A');
      },
      f => {
        // main：另有一次基线运行（按真实格式构造的 open run）并追加过另一段部署报告
        f.put(`${RUNS}/seed-core-0100/staging/${SYSTEM_MAP}`, '# staged on main\n');
        mkdirSync(dirname(runRecordPath(f.root, 'seed-core-0100')), { recursive: true });
        atomicWriteJson(runRecordPath(f.root, 'seed-core-0100'), { run_id: 'seed-core-0100', module: 'core', status: 'open', expected: [], created_at: '2026-11-12T00:00:00.000Z' });
        f.put(DEPLOY_REPORT, '# Deployment Report\n\n## deploy 1\n\n## deploy B\n');
        rewriteArtifacts(f, 'B');
      },
    );
    const propRun = (): Record<string, string> => Object.fromEntries(Object.entries(fx.files()).filter(([p]) => p.startsWith(`${RUNS}/${runId}/`)));
    const beforeRun = propRun();
    for (const part of ['staging/', 'resolved/', 'backup/', 'commit-journal.json', 'run.json']) {
      expect(Object.keys(beforeRun).some(p => p.startsWith(`${RUNS}/${runId}/${part}`)), part).toBe(true);
    }

    // ① 同步
    const r = fx.sync();
    expect(r.status).toBe(2);
    expect(fx.read(REPORT)).toBe(fx.show('main', REPORT));
    expect((r.data!.replaced as Array<{ path: string }>).map(i => i.path)).not.toContain(DEPLOY_REPORT);
    expect(r.data!.remaining_conflicts).toEqual([{ path: DEPLOY_REPORT, category: 'verify-record', reason: 'git-conflict' }]);
    expect(fx.read(DEPLOY_REPORT)).toContain('## deploy A');
    expect(fx.read(DEPLOY_REPORT)).toContain('## deploy B');

    // ② 两次运行的目录
    expect(propRun()).toEqual(beforeRun);
    expect(fx.exists(`${RUNS}/seed-core-0100/staging/${SYSTEM_MAP}`)).toBe(true);
    expect(readRunRecord(fx.root, 'seed-core-0100')).toMatchObject({ run_id: 'seed-core-0100', status: 'open' });
    expect(readRunRecord(fx.root, runId)).toMatchObject({ run_id: runId, status: 'committed' });

    // ③ baseline-seed 的只读状态查询成功，不报 baseline_commit_in_progress
    const status = fx.cli(['baseline-seed', 'status', '--module', 'core', '--format', 'json']);
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout + status.stderr).not.toContain('baseline_commit_in_progress');
    expect((JSON.parse(status.stdout) as Record<string, any>).data.baseline_seed_state).toBe('seeded');
  }, 60_000);

  it('ST-S44-05: 拒绝执行与中途失败后仓库不变', async () => {
    const fx = divergedFixture();
    const tracked = (): { head: string; index: string; files: Record<string, string> } => {
      const s = fx.state();
      const names = new Set(fx.git(['ls-files']).split('\n'));
      return { head: s.head, index: s.index, files: Object.fromEntries(Object.entries(s.files).filter(([p]) => names.has(p))) };
    };

    // ① 已跟踪文件有未提交改动
    fx.put(REPORT, 'dirty\n');
    let before = tracked();
    let r = fx.sync();
    expect(r.status).toBe(1);
    expect(r.error!.code).toBe('BRANCH_WORKTREE_DIRTY');
    expect(tracked()).toEqual(before);
    expect(fx.exists(MARKER)).toBe(true);
    fx.git(['checkout', '--', REPORT]);

    // ② replace_paths 含基线运行目录（已提交）
    const config = fx.read(CONFIG);
    fx.setConfig({ branch_sync: { replace_paths: [`${RUNS}/`] } });
    fx.commit('bad config');
    before = tracked();
    r = fx.sync();
    expect(r.status).toBe(1);
    expect(r.error!.code).toBe('BRANCH_SYNC_CONFIG_INVALID');
    expect(r.error!.details.entries[0].reason).toBe('protected-path');
    expect(tracked()).toEqual(before);
    expect(fx.exists(MARKER)).toBe(true);
    fx.put(CONFIG, config);
    fx.commit('restore config');

    // ③ core 存在未终结的基线提交记录
    writeJournal(fx, 'seed-core-0001', 'committing');
    before = tracked();
    r = fx.sync();
    expect(r.status).toBe(1);
    expect(r.error!.code).toBe('baseline_commit_in_progress');
    expect(tracked()).toEqual(before);
    expect(fx.exists(MARKER)).toBe(true);
    fx.remove(RUNS);

    // ④ 注入提交失败
    before = tracked();
    const r4 = await syncInProcess(fx, { beforeStep: step => { if (step === 'commit') throw new Error('injected commit failure'); } });
    expect(r4.exit).toBe(1);
    expect(r4.error!.code).toBe('BRANCH_SYNC_FAILED');
    expect(r4.error!.details).toEqual({ step: 'commit', restored: true });
    expect(tracked()).toEqual(before);
    expect(fx.merging()).toBe(false);
  }, 60_000);
});
