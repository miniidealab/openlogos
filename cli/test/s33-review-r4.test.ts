import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync, linkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { makeTempRoot, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { baselineSeedBegin, baselineSeedCommit } from '../src/commands/baseline-seed.js';
import { collectStatusData } from '../src/commands/status.js';
import { sync } from '../src/commands/sync.js';
import {
  stagingDir, runRecordPath, lockPath, journalPath, backupDir, readSeedState,
  sha256, atomicWriteJson, acquireLock, releaseLock, runDir,
  type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import { candidateKey, scanModuleCandidates } from '../src/lib/baseline-provenance.js';

/**
 * S33 code 第 4 轮：把评审 F1/F2/F4/F7/F10 本轮**新确认的反例**固化为真实入口回归。
 */

const T1 = 'logos/resources/prd/core-system-map.md';
const T2 = 'logos/resources/prd/core-scenario-candidates.md';
const T3 = 'logos/resources/prd/core-system-map-renamed.md';
const A1 = 'cli:one';
const A2 = 'cli:two';
const A3 = 'cli:three';
const K1 = candidateKey('core', A1);
const K2 = candidateKey('core', A2);
const K3 = candidateKey('core', A3);
const ANCHOR_OF: Record<string, string> = { [K1]: A1, [K2]: A2, [K3]: A3 };

// 真正已死的 pid：spawnSync 返回后子进程已退出，其 pid 确证已死。
let DEAD_PID: number;
beforeAll(() => { DEAD_PID = spawnSync(process.execPath, ['-e', '0']).pid ?? 2147483646; });

function setupAdopted(root: string, state = 'required', extraConfig = '') {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {}, ...(extraConfig ? JSON.parse(extraConfig) : {}) }));
  const stateLine = state ? `\n    baseline_seed_state: ${state}` : '';
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted${stateLine}\n`);
}
function candDoc(specs: Array<{ anchor: string; key?: string; state?: string; verified?: unknown }>) {
  const body = specs.map(s => {
    const key = s.key ?? candidateKey('core', s.anchor);
    return `  - key: "${key}"\n    anchor: "${s.anchor}"\n    state: ${s.state ?? 'active'}\n    verified: ${s.verified ?? false}\n`;
  }).join('');
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n${body}\`\`\`\n`;
}
function emptyDoc() {
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates: []\n\`\`\`\n`;
}
function docByKeys(keys: string[]) {
  return candDoc(keys.map(k => ({ anchor: ANCHOR_OF[k] ?? k, key: k })));
}
function writeManifest(root: string, expected: unknown) {
  writeFileSync(join(root, 'seed-plan.json'), JSON.stringify({ module: 'core', expected }));
}
function stage(root: string, runId: string, target: string, content: string) {
  const p = join(stagingDir(root, runId), target); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content);
}

describe('S33 review r4 — F1/F2/F4/F7/F10 新反例的真实入口回归', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>; let exitSpy: ReturnType<typeof mockProcessExit>;
  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot()); setupAdopted(root, 'required');
    restoreCwd = mockCwd(root); con = captureConsole(); exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  function begin(): string { con.logs.length = 0; baselineSeedBegin('core', 'seed-plan.json', 'json'); return JSON.parse(con.logs[0]).data.run_id; }
  function commitOk(runId: string): string { con.logs.length = 0; baselineSeedCommit('core', runId, 'json'); return JSON.parse(con.logs[0]).data.baseline_seed_state; }
  function commitErr(runId: string): string {
    con.errors.length = 0;
    expect(() => baselineSeedCommit('core', runId, 'json')).toThrow('process.exit(1)');
    return con.errors.join('\n');
  }
  function beginErr(): string {
    con.errors.length = 0;
    expect(() => baselineSeedBegin('core', 'seed-plan.json', 'json')).toThrow('process.exit(1)');
    return con.errors.join('\n');
  }

  // ---- F1：陈旧锁并发回收——回收动作绝不盲删 path 上的活锁 ----
  it('F1: 死锁被原子回收后锁为完整活 owner；重入获取被拒（互斥不破）', () => {
    mkdirSync(dirname(lockPath(root, 'core')), { recursive: true });
    writeFileSync(lockPath(root, 'core'), JSON.stringify({ pid: DEAD_PID, at: 0, token: 'dtok' }));
    expect(acquireLock(root, 'core')).toBe(true); // 回收死锁
    const owner = JSON.parse(readFileSync(lockPath(root, 'core'), 'utf-8'));
    expect(owner.pid).toBe(process.pid);          // 已替换为本进程完整活 owner
    expect(typeof owner.token).toBe('string');
    // 无 .reclaim-* marker 残留
    expect(existsSync(`${lockPath(root, 'core')}.reclaim-${sha256('dtok').slice(0, 16)}`)).toBe(false);
    expect(acquireLock(root, 'core')).toBe(false); // 重入：不双持
    releaseLock(root, 'core');
  });

  it('F1: 孤儿回收 marker（回收者崩溃遗留的确定名 reclaim 文件）不会永久锁死——后续获取者仍能回收死锁', () => {
    mkdirSync(dirname(lockPath(root, 'core')), { recursive: true });
    const lp = lockPath(root, 'core');
    writeFileSync(lp, JSON.stringify({ pid: DEAD_PID, at: 0, token: 'dtok' }));
    // 模拟旧协议下回收者「建 marker 后、rename 前」崩溃遗留的**确定名**孤儿 reclaim 文件。
    // 旧实现：该文件永久 EEXIST → 所有后续回收者被拒 → 模块锁**永久锁死**。
    const orphan = `${lp}.reclaim-${sha256('dtok').slice(0, 16)}`;
    linkSync(lp, orphan);
    // 新实现：回收以「唯一命名隔离目标 + 原子 rename 移出 path」进行，孤儿确定名文件**永不阻塞** →
    // 获取成功、死锁被回收、发布为本进程完整活 owner（无永久锁死）。
    expect(acquireLock(root, 'core')).toBe(true);
    expect(JSON.parse(readFileSync(lp, 'utf-8')).pid).toBe(process.pid);
    expect(acquireLock(root, 'core')).toBe(false); // 活锁存在 → 重入被拒（互斥不破）
    releaseLock(root, 'core');
  });

  // ---- F2：格式合法且自洽但从未 begin 签发的 run 被拒（未见于 CLI 签发账本）----
  it('F2: 手工放入格式合法（seed-core-9999）且自述 id 一致但未签发的 run，commit 被拒、不 seeded', () => {
    const badId = 'seed-core-9999';
    mkdirSync(runDir(root, badId), { recursive: true });
    atomicWriteJson(runRecordPath(root, badId), {
      run_id: badId, module: 'core', status: 'open',
      expected: [
        { kind: 'system-map', target_path: T1, candidate_keys: [K1] },
        { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2] },
      ], created_at: '2026-07-14T00:00:00Z',
      // 伪造 nonce 也无用——CLI 签发账本无此 run 条目。
      issued_nonce: 'forged',
    });
    stage(root, badId, T1, docByKeys([K1])); stage(root, badId, T2, docByKeys([K2]));
    expect(commitErr(badId)).toContain('unknown_run');
    expect(readSeedState(root, 'core')).toBe('required');
  });

  it('F2: 正常 begin→commit 全链路仍通过（签发账本不破坏正常流程）', () => {
    writeManifest(root, [
      { kind: 'system-map', target_path: T1, candidate_keys: [K1] },
      { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2] },
    ]);
    const runId = begin();
    stage(root, runId, T1, docByKeys([K1])); stage(root, runId, T2, docByKeys([K2]));
    expect(commitOk(runId)).toBe('seeded');
  });

  // ---- F4：目标改名后旧文档退出 manifest —— 覆盖不足被拒 ----
  it('F4: 首轮 seeded 后，第二轮 manifest 把目标改名/换址且旧文档退出 → begin 被拒（provenance_doc_uncovered）', () => {
    // 首轮：T1=[K1], T2=[K2] → seeded
    writeManifest(root, [
      { kind: 'system-map', target_path: T1, candidate_keys: [K1] },
      { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2] },
    ]);
    let runId = begin();
    stage(root, runId, T1, docByKeys([K1])); stage(root, runId, T2, docByKeys([K2]));
    expect(commitOk(runId)).toBe('seeded');
    // 第二轮：system-map 目标改到 T3，旧 T1（仍持 K1）退出 manifest → 覆盖不足。
    writeManifest(root, [
      { kind: 'system-map', target_path: T3, candidate_keys: [K3] },
      { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2] },
    ]);
    expect(beginErr()).toContain('provenance_doc_uncovered');
    // 旧集合未被破坏，仍为 seeded、无跨文档重复。
    expect(readSeedState(root, 'core')).toBe('seeded');
    expect(scanModuleCandidates(root, 'core').parse_failed).toBe(false);
  });

  it('F4: 把旧文档纳入 manifest（清空其 provenance）→ 候选迁移到新文档、不残留不重复', () => {
    writeManifest(root, [
      { kind: 'system-map', target_path: T1, candidate_keys: [K1] },
      { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2] },
    ]);
    let runId = begin();
    stage(root, runId, T1, docByKeys([K1])); stage(root, runId, T2, docByKeys([K2]));
    expect(commitOk(runId)).toBe('seeded');
    // 第二轮：K1 迁移到 T2，旧 T1 纳入 manifest 且清空（candidate_keys: []）。
    writeManifest(root, [
      { kind: 'system-map', target_path: T1, candidate_keys: [] },
      { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2, K1] },
    ]);
    runId = begin();
    stage(root, runId, T1, emptyDoc()); stage(root, runId, T2, docByKeys([K2, K1]));
    expect(commitOk(runId)).toBe('seeded');
    const cands = scanModuleCandidates(root, 'core').candidates;
    const a1 = cands.filter(c => c.key === K1);
    expect(a1.length).toBe(1);
    expect(a1[0].state).toBe('active');
    expect(scanModuleCandidates(root, 'core').parse_failed).toBe(false);
  });

  // ---- F7：sync 在报 baseline_commit_in_progress 前**零写副作用** ----
  function stallCommit(): void {
    const runId = 'seed-core-0001';
    mkdirSync(dirname(lockPath(root, 'core')), { recursive: true });
    writeFileSync(lockPath(root, 'core'), JSON.stringify({ pid: 1, at: 0 })); // pid=1 存活 → 无法恢复
    writeFileSync(join(root, T1), docByKeys([K1]));
    const journal: CommitJournal = {
      phase: 'committing', run_id: runId, module: 'core',
      targets: [{ target_path: T1, old_sha256: null, new_sha256: sha256(docByKeys([K1])), applied: true }],
      index: { yaml_backup_path: join(backupDir(root, runId), 'x.bak'), old_yaml_sha256: null },
      state_transition: { from: 'partial', to: 'seeded' }, keys: [K1],
    };
    atomicWriteJson(journalPath(root, runId), journal);
  }

  it('F7: sync 在提交进行中先过门、非零退出，且**未迁移 lifecycle**（YAML/config 字节不变）', () => {
    // config.lifecycle=active + 模块无 launched 字段 → 若门前迁移会改写 YAML。
    mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
    writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {}, lifecycle: 'active' }));
    writeFileSync(join(root, 'logos/logos-project.yaml'),
      `modules:\n  - id: core\n    name: Core\n    bootstrap: adopted\n    baseline_seed_state: required\n`);
    stallCommit();
    const yamlBefore = readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8');
    const cfgBefore = readFileSync(join(root, 'logos/logos.config.json'), 'utf-8');
    con.errors.length = 0;
    expect(() => sync()).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('baseline_commit_in_progress');
    // 零写副作用：门在任何迁移之前。
    expect(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8')).toBe(yamlBefore);
    expect(readFileSync(join(root, 'logos/logos.config.json'), 'utf-8')).toBe(cfgBefore);
  });

  it('F7: status 提交进行中经读锁区间返回 commit_in_progress，不据半集合派生', () => {
    stallCommit();
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_coverage?.commit_in_progress).toBe(true);
  });

  // ---- F10：空/畸形 candidate_keys 不再关闭集合一致性校验 ----
  it('F10: manifest candidate_keys=[] 但 staged 非空 → commit 拒（candidate_key_mismatch），不 seeded', () => {
    writeManifest(root, [
      { kind: 'system-map', target_path: T1, candidate_keys: [] }, // 空键集
      { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2] },
    ]);
    const runId = begin();
    stage(root, runId, T1, docByKeys([K1])); // staged 非空
    stage(root, runId, T2, docByKeys([K2]));
    expect(commitErr(runId)).toContain('candidate_key_mismatch');
    expect(readSeedState(root, 'core')).toBe('required');
  });

  it('F10: manifest candidate_keys 非数组 → begin 拒（invalid_manifest）', () => {
    writeManifest(root, [
      { kind: 'system-map', target_path: T1, candidate_keys: 'K1' },
      { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2] },
    ]);
    expect(beginErr()).toContain('invalid_manifest');
  });

  it('F10: manifest candidate_keys 含非字符串元素 → begin 拒（invalid_manifest）', () => {
    writeManifest(root, [
      { kind: 'system-map', target_path: T1, candidate_keys: [123] },
      { kind: 'scenario-candidates', target_path: T2, candidate_keys: [K2] },
    ]);
    expect(beginErr()).toContain('invalid_manifest');
  });
});
