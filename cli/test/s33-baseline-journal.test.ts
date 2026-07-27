import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeTempRoot } from './helpers.js';
import {
  sha256, atomicWriteJson, journalPath, resolvedDir, backupDir, runDir,
  writeSeedState, readSeedState, recoverJournal, readGate, acquireLock, releaseLock,
  type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';

const T1 = 'logos/resources/prd/core-system-map.md';
const T2 = 'logos/resources/prd/core-scenario-candidates.md';
const AT = '2026-07-14T00:00:00.000Z';

function doc(key: string, verified: boolean) {
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n  - key: "${key}"\n    state: active\n    verified: ${verified}\n\`\`\`\n`;
}
const oldA = doc('core::a11111111111', false);
const newA = doc('core::a11111111111', true);
const oldB = doc('core::b22222222222', false);
const newB = doc('core::b22222222222', true);

function w(root: string, rel: string, content: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function setupYaml(root: string, state: string) {
  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: ${state}\n`);
}

/** 构造一个处于指定崩溃态的 run（staging/backup/journal/on-disk 目标可分别指定）。 */
function makeCrashRun(root: string, runId: string, opts: {
  phase: 'prepared' | 'committing';
  onDisk: { t1: string; t2: string };       // 目标当前 on-disk 内容
  stagingIntact: boolean;                     // resolved 是否完好（含 newA/newB）——恢复从 resolved 前滚
  applied: [boolean, boolean];               // journal.targets[i].applied
  from: string;                              // state_transition.from
}) {
  // resolved（最终内容，供 roll-forward 复现）
  const rdir = resolvedDir(root, runId);
  if (opts.stagingIntact) {
    mkdirSync(join(rdir, dirname(T1)), { recursive: true });
    writeFileSync(join(rdir, T1), newA);
    mkdirSync(join(rdir, dirname(T2)), { recursive: true });
    writeFileSync(join(rdir, T2), newB);
  }
  // backup（old 内容 + yaml 备份）
  const bdir = backupDir(root, runId);
  mkdirSync(join(bdir, dirname(T1)), { recursive: true });
  writeFileSync(join(bdir, T1), oldA);
  mkdirSync(join(bdir, dirname(T2)), { recursive: true });
  writeFileSync(join(bdir, T2), oldB);
  const yBackup = join(bdir, 'logos-project.yaml.bak');
  writeFileSync(yBackup, readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8'));

  // 目标 on-disk
  w(root, T1, opts.onDisk.t1);
  w(root, T2, opts.onDisk.t2);

  const journal: CommitJournal = {
    phase: opts.phase,
    run_id: runId,
    module: 'core',
    targets: [
      { target_path: T1, old_sha256: sha256(oldA), new_sha256: sha256(newA), applied: opts.applied[0] },
      { target_path: T2, old_sha256: sha256(oldB), new_sha256: sha256(newB), applied: opts.applied[1] },
    ],
    index: { yaml_backup_path: yBackup, old_yaml_sha256: sha256(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8')) },
    state_transition: { from: opts.from as CommitJournal['state_transition']['from'], to: 'seeded' },
    keys: ['core::a11111111111', 'core::b22222222222'],
  };
  atomicWriteJson(journalPath(root, runId), journal);
}

function readT(root: string, rel: string) { return readFileSync(join(root, rel), 'utf-8'); }

describe('S33 commit journal 崩溃一致性 + 恢复门（F10）', () => {
  let root: string;
  let cleanup: () => void;
  beforeEach(() => { ({ root, cleanup } = makeTempRoot()); });
  afterEach(() => cleanup());

  it('UT-S33-28: journal prepared 崩溃 → 回滚（全旧、状态不变、journal 丢弃）', () => {
    setupYaml(root, 'partial');
    makeCrashRun(root, 'seed-core-0001', { phase: 'prepared', onDisk: { t1: oldA, t2: oldB }, stagingIntact: true, applied: [false, false], from: 'partial' });
    const r = recoverJournal(root, 'seed-core-0001', AT);
    expect(r.outcome).toBe('rolled-back');
    expect(readT(root, T1)).toBe(oldA);
    expect(readT(root, T2)).toBe(oldB);
    expect(readSeedState(root, 'core')).toBe('partial');
    expect(existsSync(journalPath(root, 'seed-core-0001'))).toBe(false);
  });

  it('UT-S33-29: committing 崩溃 + staging 完好 → 前滚（全新 + seeded + journal committed）', () => {
    setupYaml(root, 'partial');
    // T1 已 rename（new），T2 未（old）
    makeCrashRun(root, 'seed-core-0001', { phase: 'committing', onDisk: { t1: newA, t2: oldB }, stagingIntact: true, applied: [true, false], from: 'partial' });
    const r = recoverJournal(root, 'seed-core-0001', AT);
    expect(r.outcome).toBe('rolled-forward');
    expect(readT(root, T1)).toBe(newA);
    expect(readT(root, T2)).toBe(newB); // 补齐
    expect(readSeedState(root, 'core')).toBe('seeded');
  });

  it('UT-S33-30: committing 崩溃 + staging 缺失 → 回滚（全旧、状态保持 from）', () => {
    setupYaml(root, 'partial');
    makeCrashRun(root, 'seed-core-0001', { phase: 'committing', onDisk: { t1: newA, t2: oldB }, stagingIntact: false, applied: [true, false], from: 'partial' });
    const r = recoverJournal(root, 'seed-core-0001', AT);
    expect(r.outcome).toBe('rolled-back');
    expect(readT(root, T1)).toBe(oldA); // 从 backup 还原
    expect(readT(root, T2)).toBe(oldB);
    expect(readSeedState(root, 'core')).toBe('partial');
  });

  it('UT-S33-31: 逐故障点恢复后全旧或全新 + seeded⇔完整新集合在盘', () => {
    // 故障点矩阵：不同 onDisk/applied 组合，staging 完好 → 前滚全新；staging 缺失 → 回滚全旧。
    const points: Array<{ onDisk: { t1: string; t2: string }; applied: [boolean, boolean] }> = [
      { onDisk: { t1: oldA, t2: oldB }, applied: [false, false] },
      { onDisk: { t1: newA, t2: oldB }, applied: [true, false] },
      { onDisk: { t1: newA, t2: newB }, applied: [true, false] }, // applied 未持久化但盘上已新
    ];
    for (const intact of [true, false]) {
      for (const p of points) {
        const sub = makeTempRoot();
        try {
          setupYaml(sub.root, 'partial');
          makeCrashRun(sub.root, 'seed-core-0001', { phase: 'committing', onDisk: p.onDisk, stagingIntact: intact, applied: p.applied, from: 'partial' });
          recoverJournal(sub.root, 'seed-core-0001', AT);
          const t1 = readT(sub.root, T1), t2 = readT(sub.root, T2);
          const allNew = t1 === newA && t2 === newB;
          const allOld = t1 === oldA && t2 === oldB;
          expect(allNew || allOld).toBe(true);          // 全旧或全新
          const seeded = readSeedState(sub.root, 'core') === 'seeded';
          expect(seeded).toBe(allNew);                   // seeded ⇔ 完整新集合
        } finally { sub.cleanup(); }
      }
    }
  });

  it('UT-S33-35: 恢复按 on-disk hash 逐目标重判态（不只依 applied 列表）', () => {
    setupYaml(root, 'partial');
    // applied 说 [false,true] 但盘上 t1 已新、t2 仍旧 —— 恢复应按 hash 重判：前滚补齐 t2、保留 t1。
    makeCrashRun(root, 'seed-core-0001', { phase: 'committing', onDisk: { t1: newA, t2: oldB }, stagingIntact: true, applied: [false, true], from: 'partial' });
    recoverJournal(root, 'seed-core-0001', AT);
    expect(readT(root, T1)).toBe(newA);
    expect(readT(root, T2)).toBe(newB);
    expect(readSeedState(root, 'core')).toBe('seeded');
  });

  it('UT-S33-36: 派生索引旧值 backup 使回滚可执行（回滚后 yaml/state 还原为旧值 partial）', () => {
    setupYaml(root, 'partial');
    // backup 在 makeCrashRun 时捕获【旧】yaml（partial）。
    makeCrashRun(root, 'seed-core-0001', { phase: 'committing', onDisk: { t1: newA, t2: oldB }, stagingIntact: false, applied: [true, false], from: 'partial' });
    // 模拟提交中途已把状态写成 seeded（尚未终结即崩溃）。
    writeSeedState(root, 'core', 'seeded', { source_hash: 'new', denominator: 1 });
    expect(readSeedState(root, 'core')).toBe('seeded');
    // 回滚（staging 缺失）：应按 journal.index.yaml_backup_path 还原 yaml/state 到旧值 partial、目标全旧。
    recoverJournal(root, 'seed-core-0001', AT);
    expect(readT(root, T1)).toBe(oldA);
    expect(readT(root, T2)).toBe(oldB);
    expect(readSeedState(root, 'core')).toBe('partial'); // 由 backup 驱动的可执行回滚（非 seeded）
  });

  it('UT-S33-33: 读取门——committing 期间先恢复；锁被占用时返回 baseline_commit_in_progress', () => {
    setupYaml(root, 'partial');
    makeCrashRun(root, 'seed-core-0001', { phase: 'committing', onDisk: { t1: newA, t2: oldB }, stagingIntact: true, applied: [true, false], from: 'partial' });
    // 锁被占用 → 不把半新集合当权威
    acquireLock(root, 'core');
    const blocked = readGate(root, 'core', AT);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe('baseline_commit_in_progress');
    releaseLock(root, 'core');
    // 锁可取 → 先恢复，落定全新 + seeded
    const ok = readGate(root, 'core', AT);
    expect(ok.ok).toBe(true);
    expect(readT(root, T2)).toBe(newB);
    expect(readSeedState(root, 'core')).toBe('seeded');
  });

  it('UT-S33-34: prior=seeded 重扫 committing 崩溃后经读取门先恢复、不暴露半新/不复用旧 seeded', () => {
    setupYaml(root, 'seeded'); // prior seeded
    // 重扫 commit：from=seeded，committing，T1 已新 T2 旧（半新）；staging 完好。
    makeCrashRun(root, 'seed-core-0002', { phase: 'committing', onDisk: { t1: newA, t2: oldB }, stagingIntact: true, applied: [true, false], from: 'seeded' });
    // 恢复门前：盘上是半新（T1 new / T2 old）——读取门必须先恢复，不据半新集合出权威结论。
    const gate = readGate(root, 'core', AT);
    expect(gate.ok).toBe(true);
    const t1 = readT(root, T1), t2 = readT(root, T2);
    expect(t1 === newA && t2 === newB).toBe(true); // 落定全新（非半新）
    expect(readSeedState(root, 'core')).toBe('seeded');
  });
});
