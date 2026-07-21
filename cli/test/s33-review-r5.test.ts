import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { makeTempRoot, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { collectStatusData } from '../src/commands/status.js';
import { detectBaselineJitAdvisory } from '../src/lib/baseline-jit.js';
import {
  lockPath, journalPath, backupDir, sha256, atomicWriteJson,
  acquireLock, releaseLock, runsRoot,
  recordIssuedRun, isIssuedRun, newIssuedNonce,
  type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import { candidateKey } from '../src/lib/baseline-provenance.js';

/**
 * S33 code 第 5 轮：把评审新确认的三条残留反例固化为真实入口回归——
 *  F1（回收 marker 永久锁死）、F7（verify/jit/status 顶层仍在锁外读半集合）、F2（全局账本跨模块 lost-update）。
 */

const T1 = 'logos/resources/prd/core-system-map.md';
const A1 = 'cli:one';
const K1 = candidateKey('core', A1);

let DEAD_PID: number;
beforeAll(() => { DEAD_PID = spawnSync(process.execPath, ['-e', '0']).pid ?? 2147483646; });

function candDoc(key: string, anchor: string) {
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n  - key: "${key}"\n    anchor: "${anchor}"\n    state: active\n    verified: false\n\`\`\`\n`;
}
function setupAdopted(root: string, cfgExtra: Record<string, unknown> = {}) {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {}, ...cfgExtra }));
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: required\n`);
}
/** 提交进行中（committing journal + pid=1 存活锁，无法恢复）——机器读取者必须报 commit_in_progress、不读半集合。 */
function stallCommit(root: string): void {
  const runId = 'seed-core-0001';
  mkdirSync(dirname(lockPath(root, 'core')), { recursive: true });
  writeFileSync(lockPath(root, 'core'), JSON.stringify({ pid: 1, at: 0 })); // pid=1 存活 → 无法恢复
  writeFileSync(join(root, T1), candDoc(K1, A1));
  const journal: CommitJournal = {
    phase: 'committing', run_id: runId, module: 'core',
    targets: [{ target_path: T1, old_sha256: null, new_sha256: sha256(candDoc(K1, A1)), applied: true }],
    index: { yaml_backup_path: join(backupDir(root, runId), 'x.bak'), old_yaml_sha256: null },
    state_transition: { from: 'partial', to: 'seeded' }, keys: [K1],
  };
  atomicWriteJson(journalPath(root, runId), journal);
}

describe('S33 review r5 — F1 永久锁死 / F7 锁外读半集合 / F2 跨模块账本 lost-update', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>; let exitSpy: ReturnType<typeof mockProcessExit>;
  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot()); setupAdopted(root);
    restoreCwd = mockCwd(root); con = captureConsole(); exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  // ---- F1：回收者崩溃遗留的 reclaim marker 不永久锁死；且回收**绝不移动/覆盖 path 上的活锁** ----
  it('F1: 死锁 + 回收者已死的孤儿 marker（承载死回收者身份）→ 仍能回收死锁并发布活锁（无永久锁死）', () => {
    const lp = lockPath(root, 'core');
    mkdirSync(dirname(lp), { recursive: true });
    writeFileSync(lp, JSON.stringify({ pid: DEAD_PID, at: 0, token: 'dtok' }));
    // 回收者恰在「建 marker、替换 path」之间崩溃遗留的确定名孤儿 marker（回收者 pid 已死）。
    const marker = `${lp}.reclaim-${sha256('dtok').slice(0, 16)}`;
    writeFileSync(marker, JSON.stringify({ pid: DEAD_PID, at: 0, token: 'reclaimer-dead' }));
    expect(acquireLock(root, 'core')).toBe(true); // 检测到孤儿 marker（死回收者）→ 移走后重赢仲裁 → 回收死锁
    expect(JSON.parse(readFileSync(lp, 'utf-8')).pid).toBe(process.pid);
    expect(existsSync(marker)).toBe(false); // marker 已清理，无残留
    expect(acquireLock(root, 'core')).toBe(false); // 活锁存在 → 重入被拒（互斥不破）
    releaseLock(root, 'core');
  });

  it('F1: **path 为活锁**时（即便旁有陈旧 reclaim marker）回收绝不移动/覆盖活锁——返回 false 且活锁字节不变', () => {
    // 评审 F1 三方 barrier 交错的安全核心：竞争者抢先回收并发布活锁 B 后，后来者绝不能把 path 上的活锁 B 移走。
    // 本协议下 path 为活锁（owner 进程存活）时**直接短路 return false**，根本不进入回收/marker 分支。
    const lp = lockPath(root, 'core');
    mkdirSync(dirname(lp), { recursive: true });
    const liveB = JSON.stringify({ pid: 1, at: 0, token: 'live-B' }); // pid=1 存活 → 活锁 B
    writeFileSync(lp, liveB);
    // 旁置一个陈旧 reclaim marker（来自更早对某死锁的在飞回收）——不得诱使协议移动活锁 B。
    writeFileSync(`${lp}.reclaim-${sha256('some-dead-token').slice(0, 16)}`, JSON.stringify({ pid: DEAD_PID, token: 'rc' }));
    expect(acquireLock(root, 'core')).toBe(false); // 活锁存在 → 不抢
    expect(readFileSync(lp, 'utf-8')).toBe(liveB); // 活锁 B 字节不变（绝未被移走/覆盖）
  });

  it('F1: 空槽（回收者移走死锁后未及发布即崩溃）→ 后续获取者经快路径直接获取，重入被拒', () => {
    const lp = lockPath(root, 'core');
    mkdirSync(dirname(lp), { recursive: true });
    expect(existsSync(lp)).toBe(false);
    expect(acquireLock(root, 'core')).toBe(true);  // 空槽 → 快路径原子发布
    expect(acquireLock(root, 'core')).toBe(false); // 活锁存在 → 重入被拒
    releaseLock(root, 'core');
  });

  // ---- F7：机器读取者在**同一读锁区间**内读取；提交进行中报 commit_in_progress，不据半集合 ----
  it('F7: JIT advisory 在提交进行中经读锁区间返回 baseline_commit_in_progress（不据半集合判 advisory）', () => {
    mkdirSync(join(root, 'logos/changes/feat/deltas'), { recursive: true });
    stallCommit(root);
    const adv = detectBaselineJitAdvisory(root, 'feat');
    expect(adv.advise).toBe(false);
    expect(adv.message).toContain('baseline_commit_in_progress');
  });

  it('F7: status 顶层 suggestion 在提交进行中不据半集合推断 required，改提示稍后重试', () => {
    stallCommit(root);
    const data = collectStatusData(root);
    // 顶层 suggestion 经读锁区间派生；提交进行中 → 不驱动逆向 baseline-seed。
    expect(data.suggestion).not.toContain('逆向建立现状基线');
  });

  // ---- F2：签发账本每模块独立——不同模块并发 begin 不再跨模块 lost-update ----
  it('F2: 账本按模块分文件、互不覆盖——记录一个模块不改动另一模块账本，两条签发独立存活', () => {
    const nonceA = newIssuedNonce();
    const nonceB = newIssuedNonce();
    recordIssuedRun(root, 'seed-core-1', 'core', nonceA);
    const coreLedgerAfterA = readFileSync(join(runsRoot(root), '.issued-runs-core.json'), 'utf-8');
    recordIssuedRun(root, 'seed-other-1', 'other', nonceB);
    // 记录 other 后 core 账本字节不变（无共享可竞争文件 → 跨模块并发无 lost-update）。
    expect(readFileSync(join(runsRoot(root), '.issued-runs-core.json'), 'utf-8')).toBe(coreLedgerAfterA);
    // 每模块独立账本、各自可核对；不存在旧的全局账本。
    expect(existsSync(join(runsRoot(root), '.issued-runs-other.json'))).toBe(true);
    expect(existsSync(join(runsRoot(root), '.issued-runs.json'))).toBe(false);
    expect(isIssuedRun(root, 'seed-core-1', 'core', nonceA)).toBe(true);
    expect(isIssuedRun(root, 'seed-other-1', 'other', nonceB)).toBe(true);
  });
});
