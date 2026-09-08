/**
 * S33 读锁有界重试与 reader 串行化（fix-baseline-readlock-reader-contention，架构 §四.B）。
 * 覆盖：UT-S33-56～UT-S33-60、ST-S33-10。
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  acquireLock, acquireReadLockWithRetry, releaseLock, setReadLockRetryPolicyForTests,
  DEFAULT_READ_LOCK_RETRY, readGate, withBaselineReadLock, withRecoveredReadLocks,
  lockPath, runsRoot, journalPath, backupDir, sha256, atomicWriteJson,
  type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import { makeTempRoot } from './helpers.js';

const AT = '2026-09-04T00:00:00.000Z';
const T1 = 'logos/resources/prd/core-system-map.md';
const T2 = 'logos/resources/prd/core-scenario-candidates.md';
const cliRoot = process.cwd();

function w(root: string, rel: string, content: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function setupYaml(root: string, state = 'partial') {
  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: ${state}\n`);
}

/** 以「另一个活进程」（vitest 父进程 ppid）身份写协议格式锁文件，构造 reader-reader / writer 持锁竞争。 */
function holdLockAsOtherProcess(root: string, moduleId = 'core') {
  mkdirSync(runsRoot(root), { recursive: true });
  writeFileSync(lockPath(root, moduleId),
    JSON.stringify({ pid: process.ppid, at: Date.now(), token: `other-${process.ppid}` }));
}

/** 合法 prepared 阶段 journal（恢复 = 丢弃 journal、目标全旧），驱动 readGate 的取锁分支。 */
function makePreparedJournal(root: string, runId: string) {
  const oldA = '# old-a\n'; const oldB = '# old-b\n';
  const newA = '# new-a\n'; const newB = '# new-b\n';
  const bdir = backupDir(root, runId);
  mkdirSync(join(bdir, dirname(T1)), { recursive: true });
  writeFileSync(join(bdir, T1), oldA);
  mkdirSync(join(bdir, dirname(T2)), { recursive: true });
  writeFileSync(join(bdir, T2), oldB);
  const yBackup = join(bdir, 'logos-project.yaml.bak');
  writeFileSync(yBackup, readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8'));
  w(root, T1, oldA);
  w(root, T2, oldB);
  const journal: CommitJournal = {
    phase: 'prepared', run_id: runId, module: 'core',
    targets: [
      { target_path: T1, old_sha256: sha256(oldA), new_sha256: sha256(newA), applied: false },
      { target_path: T2, old_sha256: sha256(oldB), new_sha256: sha256(newB), applied: false },
    ],
    index: { yaml_backup_path: yBackup, old_yaml_sha256: sha256(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8')) },
    state_transition: { from: 'partial', to: 'seeded' },
    keys: ['core::a11111111111'],
  };
  atomicWriteJson(journalPath(root, runId), journal);
}

describe('S33 读锁有界重试与 reader 串行化', () => {
  let root: string;
  let cleanup: () => void;
  beforeEach(() => { ({ root, cleanup } = makeTempRoot()); setupYaml(root); });
  afterEach(() => { setReadLockRetryPolicyForTests(); cleanup(); });

  it('UT-S33-56: 读路径锁被占、预算内释放则成功（三入口复用同一重试实现）', () => {
    // 三个读入口都必须走 acquireReadLockWithRetry——源级证伪门：摘掉任一入口的公共实现本断言即红。
    const src = readFileSync(join(cliRoot, 'src/lib/baseline-seed-txn.ts'), 'utf-8');
    expect((src.match(/acquireReadLockWithRetry\(root, m(?:oduleId)?\)/g) ?? []).length).toBe(3);

    // withBaselineReadLock：锁被他者持有，注入 sleep 在首次退避时“释放”（模拟 owner 毫秒级读临界区结束）。
    let sleeps: number[] = [];
    setReadLockRetryPolicyForTests({ sleep: ms => { sleeps.push(ms); rmSync(lockPath(root, 'core'), { force: true }); } });
    holdLockAsOtherProcess(root);
    const r1 = withBaselineReadLock(root, 'core', AT, () => 'value');
    expect(r1).toEqual({ ok: true, value: 'value' });
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(lockPath(root, 'core'))).toBe(false); // 临界区结束后不残留锁

    // withRecoveredReadLocks：同一夹具形态。
    sleeps = [];
    holdLockAsOtherProcess(root);
    const r2 = withRecoveredReadLocks(root, AT, ['core'], () => 'multi');
    expect(r2).toEqual({ ok: true, value: 'multi' });
    expect(sleeps.length).toBeGreaterThanOrEqual(1);

    // readGate：需有未终结 journal 才进入取锁分支；预算内取到锁 → 走既有恢复门（prepared → 回滚丢弃）。
    sleeps = [];
    makePreparedJournal(root, 'seed-core-retry-1');
    holdLockAsOtherProcess(root);
    const r3 = readGate(root, 'core', AT);
    expect(r3).toEqual({ ok: true });
    expect(sleeps.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(journalPath(root, 'seed-core-retry-1'))).toBe(false); // 恢复门四步照旧执行
  });

  it('UT-S33-57: 预算耗尽维持既有错误形态（三入口逐一）', () => {
    // 时钟快进：每次读钟 +700ms，sleep 不真实等待——预算 2000ms 数次尝试后耗尽。
    let clock = 0;
    setReadLockRetryPolicyForTests({ now: () => { clock += 700; return clock; }, sleep: () => { /* noop */ } });
    holdLockAsOtherProcess(root);

    const r1 = withBaselineReadLock(root, 'core', AT, () => 'never');
    expect(r1).toEqual({ ok: false, error: 'baseline_commit_in_progress' });

    const r2 = withRecoveredReadLocks(root, AT, ['core'], () => 'never');
    expect(r2).toEqual({ ok: false, inProgress: ['core'] });

    makePreparedJournal(root, 'seed-core-blocked-1');
    holdLockAsOtherProcess(root);
    const r3 = readGate(root, 'core', AT);
    expect(r3).toEqual({ ok: false, error: 'baseline_commit_in_progress' });
    // 锁仍被“writer”持有、journal 原样在盘——门没有被弱化。
    expect(existsSync(journalPath(root, 'seed-core-blocked-1'))).toBe(true);
  });

  it('UT-S33-58: 退避序列 25/50/100/200/400 封顶且预算/时钟可注入', () => {
    // 记录型时钟：时间只随 sleep 前进，锁全程被占。
    let t = 0;
    const seq: number[] = [];
    setReadLockRetryPolicyForTests({ now: () => t, sleep: ms => { seq.push(ms); t += ms; } });
    holdLockAsOtherProcess(root);
    expect(acquireReadLockWithRetry(root, 'core')).toBe(false);
    // 默认预算 2000ms：25+50+100+200+400+400+400+400=1975，末次按剩余 25 截断，累计恰为预算。
    expect(seq).toEqual([25, 50, 100, 200, 400, 400, 400, 400, 25]);
    expect(t).toBe(DEFAULT_READ_LOCK_RETRY.budgetMs);

    // 预算注入后序列相应缩放：300ms → 25+50+100+125。
    t = 0; seq.length = 0;
    setReadLockRetryPolicyForTests({ budgetMs: 300, now: () => t, sleep: ms => { seq.push(ms); t += ms; } });
    expect(acquireReadLockWithRetry(root, 'core')).toBe(false);
    expect(seq).toEqual([25, 50, 100, 125]);
    expect(t).toBe(300);

    // 退避序列注入：单项 [10] 即封顶 10ms。
    t = 0; seq.length = 0;
    setReadLockRetryPolicyForTests({ budgetMs: 35, backoffMs: [10], now: () => t, sleep: ms => { seq.push(ms); t += ms; } });
    expect(acquireReadLockWithRetry(root, 'core')).toBe(false);
    expect(seq).toEqual([10, 10, 10, 5]);
  });

  it('UT-S33-59: 写路径保持 fail-fast，无任何重试或等待', () => {
    const seq: number[] = [];
    setReadLockRetryPolicyForTests({ sleep: ms => { seq.push(ms); } });
    holdLockAsOtherProcess(root);
    // begin/commit 的锁获取入口就是公共 acquireLock——活进程持锁必须立即 false、零退避。
    expect(acquireLock(root, 'core')).toBe(false);
    expect(seq).toEqual([]);
    // 源级证伪门：写路径命令仍直接使用 acquireLock，未被换成读路径重试实现。
    const cmdSrc = readFileSync(join(cliRoot, 'src/commands/baseline-seed.ts'), 'utf-8');
    expect((cmdSrc.match(/!acquireLock\(root, moduleId!\)/g) ?? []).length).toBe(2);
    expect(cmdSrc).not.toContain('acquireReadLockWithRetry');
  });

  it('UT-S33-60: 不可恢复 journal 的分层处置与死锁回收零回退', () => {
    // ① 底层 withBaselineReadLock 不做恢复，只如实报告未终结 journal（分层：raw 报告、wrapper 解决）。
    const broken = join(runsRoot(root), 'broken-retry');
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, 'commit-journal.json'), '{broken');
    let sleeps = 0;
    let computeCalls = 0;
    setReadLockRetryPolicyForTests({ sleep: () => { sleeps++; rmSync(lockPath(root, 'core'), { force: true }); } });
    holdLockAsOtherProcess(root);
    expect(() => withBaselineReadLock(root, 'core', AT, () => { computeCalls++; return 'x'; }))
      .toThrow(/baseline_commit_in_progress/);
    expect(sleeps).toBeGreaterThanOrEqual(1);   // 重试确实发生（锁是等到的）
    expect(computeCalls).toBe(0);               // 标准资源读取哨兵为 0——硬门零回退

    // 负责恢复的 withRecoveredReadLocks 则隔离损坏 journal 后继续（§2.74.3）
    holdLockAsOtherProcess(root);
    const r = withRecoveredReadLocks(root, AT, ['core'], () => { computeCalls++; return 'x'; });
    expect(r).toEqual({ ok: true, value: 'x' });
    expect(computeCalls).toBe(1);
    expect(existsSync(join(broken, 'commit-journal.json')), '损坏 journal 已被移走').toBe(false);
    rmSync(broken, { recursive: true, force: true });

    // ② 死进程持锁：回收协议行为不变——首次 acquireLock 内完成 marker 仲裁回收，零退避。
    const dead = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    const deadPid = dead.pid ?? 999_999;
    mkdirSync(runsRoot(root), { recursive: true });
    writeFileSync(lockPath(root, 'core'), JSON.stringify({ pid: deadPid, at: Date.now(), token: 'dead-token' }));
    const seq: number[] = [];
    setReadLockRetryPolicyForTests({ sleep: ms => { seq.push(ms); } });
    expect(acquireReadLockWithRetry(root, 'core')).toBe(true);
    expect(seq).toEqual([]); // 回收发生在 acquireLock 内部仲裁，不消耗读重试预算
    releaseLock(root, 'core');
    expect(existsSync(lockPath(root, 'core'))).toBe(false);
  });

  it('ST-S33-10: 多进程读者串行化不假阳性；writer 真持锁窗口内读者如实报错', async () => {
    const cli = join(cliRoot, 'dist/index.js');
    // 真实项目形态（scaffold + adopted core），真实多进程、真实时钟。
    const { scaffoldProject } = await import('./helpers.js');
    scaffoldProject(root, { name: 'readlock-st', locale: 'zh' });
    setupYaml(root, 'partial');

    const runOnce = (args: string[]) => new Promise<{ code: number; out: string }>(resolvePromise => {
      const child = spawn(process.execPath, [cli, ...args], { cwd: root });
      let out = '';
      child.stdout.on('data', d => { out += String(d); });
      child.stderr.on('data', d => { out += String(d); });
      child.on('close', code => resolvePromise({ code: code ?? -1, out }));
    });

    // 第一阶段：8 个独立子进程并发穿过读取门（status/next 各 4），必须全部零退出、无假阳性。
    const readers = await Promise.all([
      ...Array.from({ length: 4 }, () => runOnce(['status', '--format', 'json'])),
      ...Array.from({ length: 4 }, () => runOnce(['next', '--format', 'json'])),
    ]);
    for (const r of readers) {
      expect(r.code, r.out.slice(0, 400)).toBe(0);
      expect(r.out).not.toContain('baseline_commit_in_progress');
    }
    // 结束后无残留锁。
    const residual = readdirSync(runsRoot(root)).filter(f => f.endsWith('.commit.lock'));
    expect(residual).toEqual([]);

    // 第二阶段：writer 以协议内方式（dist 库 acquireLock，与 commit 同一把锁、同一入口）持锁超读者预算。
    const holder = join(root, 'holder.mjs');
    writeFileSync(holder, [
      `import { acquireLock, releaseLock } from ${JSON.stringify(join(cliRoot, 'dist/lib/baseline-seed-txn.js'))};`,
      'const [root, ms] = process.argv.slice(2);',
      "if (!acquireLock(root, 'core')) { console.error('holder-failed'); process.exit(2); }",
      "console.log('held');",
      "setTimeout(() => { releaseLock(root, 'core'); process.exit(0); }, Number(ms));",
    ].join('\n'));
    const holderChild = spawn(process.execPath, [holder, root, '3500']);
    const holderExit = new Promise<number>(resolvePromise => holderChild.on('close', c => resolvePromise(c ?? -1)));
    await new Promise<void>(resolvePromise => holderChild.stdout.on('data', d => { if (String(d).includes('held')) resolvePromise(); }));

    const blocked = await runOnce(['status', '--format', 'json']);
    expect(blocked.code).not.toBe(0);
    expect(blocked.out).toContain('baseline_commit_in_progress');

    // writer 不受干扰：holder 正常走完持锁窗口并释放。
    expect(await holderExit).toBe(0);
    const after = await runOnce(['status', '--format', 'json']);
    expect(after.code, after.out.slice(0, 400)).toBe(0);
    expect(readdirSync(runsRoot(root)).filter(f => f.endsWith('.commit.lock'))).toEqual([]);
  }, 30_000);
});
