import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { baselineSeedBegin, baselineSeedCommit, baselineSeedStatus } from '../src/commands/baseline-seed.js';
import {
  acquireLock, releaseLock, stagingDir, resolvedDir, backupDir, readSeedState,
  sha256, atomicWriteJson, journalPath, readJournal, readRunRecord, runRecordPath,
  type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import { dirname } from 'node:path';
import { candidateKey } from '../src/lib/baseline-provenance.js';

const SYSTEM_MAP = 'logos/resources/prd/core-system-map.md';
const SCENARIOS = 'logos/resources/prd/core-scenario-candidates.md';
// 契约保真：key = candidateKey(module, anchor)（F3：seed 输入须携锚点且 key 与 anchor 一致）。
const A1 = 'cli:one';
const A2 = 'cli:two';
const K1 = candidateKey('core', A1);
const K2 = candidateKey('core', A2);
const ANCHOR_OF: Record<string, string> = { [K1]: A1, [K2]: A2 };

function setupAdopted(root: string, state: 'required' | 'partial' | 'seeded' = 'required') {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: ${state}\n`);
}

function writeManifest(root: string, expected: unknown, file = 'seed-plan.json') {
  writeFileSync(join(root, file), JSON.stringify({ module: 'core', expected }));
  return file;
}

function fullExpected() {
  return [
    { kind: 'system-map', target_path: SYSTEM_MAP, candidate_keys: [K1] },
    { kind: 'scenario-candidates', target_path: SCENARIOS, candidate_keys: [K2] },
  ];
}

function stagedDoc(keys: string[]) {
  const body = keys.map(k => {
    const anchor = ANCHOR_OF[k] ?? k;
    return `  - key: "${k}"\n    anchor: "${anchor}"\n    state: active\n    verified: false\n`;
  }).join('');
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n${body}\`\`\`\n`;
}

/** 运行 begin 并返回其 JSON envelope。 */
function begin(root: string, con: ReturnType<typeof captureConsole>, manifest = 'seed-plan.json') {
  con.logs.length = 0;
  baselineSeedBegin('core', manifest, 'json');
  return JSON.parse(con.logs[0]).data as { run_id: string; baseline_seed_state: string };
}

function stage(root: string, runId: string, target: string, content: string) {
  const p = join(stagingDir(root, runId), target);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, content);
}

function commit(root: string, con: ReturnType<typeof captureConsole>, runId: string) {
  con.logs.length = 0;
  baselineSeedCommit('core', runId, 'json');
  return JSON.parse(con.logs[0]).data as { baseline_seed_state: string; committed: string[]; missing: string[]; invalid: string[] };
}

describe('S33 baseline-seed 命令（两阶段 staging 协议）', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    setupAdopted(root);
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  it('UT-S33-18: begin 冻结逻辑计划（无 hash）+ 建 staging + 持久化 run 记录 + 不下调状态', () => {
    writeManifest(root, fullExpected());
    const d = begin(root, con);
    expect(d.run_id).toMatch(/^seed-core-\d{4}$/);
    expect(existsSync(stagingDir(root, d.run_id))).toBe(true);
    expect(existsSync(join(root, 'logos/resources/verify/baseline-seed-runs', d.run_id, 'run.json'))).toBe(true);
    // begin 不下调状态（保持 required）
    expect(readSeedState(root, 'core')).toBe('required');
  });

  it('UT-S33-19: commit 全部 staged 合法 → seeded，原子提交到目标，missing/invalid 空', () => {
    writeManifest(root, fullExpected());
    const d = begin(root, con);
    stage(root, d.run_id, SYSTEM_MAP, stagedDoc([K1]));
    stage(root, d.run_id, SCENARIOS, stagedDoc([K2]));
    const r = commit(root, con, d.run_id);
    expect(r.baseline_seed_state).toBe('seeded');
    expect(r.missing).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(existsSync(join(root, SYSTEM_MAP))).toBe(true);
    expect(existsSync(join(root, SCENARIOS))).toBe(true);
    expect(readSeedState(root, 'core')).toBe('seeded');
  });

  it('UT-S33-20: commit 部分 staged → partial（不提交不完整集合、绝不 seeded）', () => {
    writeManifest(root, fullExpected());
    const d = begin(root, con);
    stage(root, d.run_id, SYSTEM_MAP, stagedDoc([K1])); // 仅 1/2
    const r = commit(root, con, d.run_id);
    expect(r.baseline_seed_state).toBe('partial');
    expect(r.committed).toEqual([SYSTEM_MAP]);
    expect(r.missing).toEqual([SCENARIOS]);
    // 不提交不完整集合为权威：目标文档不落盘
    expect(existsSync(join(root, SYSTEM_MAP))).toBe(false);
    expect(readSeedState(root, 'core')).toBe('partial');
  });

  it('UT-S33-21: 缺必需 kind 的 manifest 被 begin 拒（missing_required_kind）', () => {
    writeManifest(root, [{ kind: 'system-map', target_path: SYSTEM_MAP, candidate_keys: [K1] }]); // 缺 scenario-candidates
    expect(() => baselineSeedBegin('core', 'seed-plan.json', 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('missing_required_kind');
  });

  it('UT-S33-22: target_path 路径逃逸被拒（path_escape）+ 不建 run', () => {
    writeManifest(root, [
      { kind: 'system-map', target_path: '/etc/passwd', candidate_keys: [K1] },
      { kind: 'scenario-candidates', target_path: SCENARIOS, candidate_keys: [K2] },
    ]);
    expect(() => baselineSeedBegin('core', 'seed-plan.json', 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('path_escape');
    expect(existsSync(join(root, 'logos/resources/verify/baseline-seed-runs'))).toBe(false);
  });

  it('UT-S33-23: candidate_keys 与 staged candidates[] 不一致被拒（candidate_key_mismatch）', () => {
    writeManifest(root, fullExpected());
    const d = begin(root, con);
    stage(root, d.run_id, SYSTEM_MAP, stagedDoc(['core::WRONGKEY0000'])); // key 不符
    stage(root, d.run_id, SCENARIOS, stagedDoc([K2]));
    expect(() => baselineSeedCommit('core', d.run_id, 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('candidate_key_mismatch');
    expect(readSeedState(root, 'core')).toBe('required'); // 不写状态、不提交
  });

  it('UT-S33-24: commit 幂等（同 run 依 staging 重算、状态与分类一致、不重复计数）', () => {
    writeManifest(root, fullExpected());
    const d = begin(root, con);
    stage(root, d.run_id, SYSTEM_MAP, stagedDoc([K1]));
    stage(root, d.run_id, SCENARIOS, stagedDoc([K2]));
    const first = commit(root, con, d.run_id);
    const second = commit(root, con, d.run_id);
    expect(second.baseline_seed_state).toBe('seeded');
    expect(second.committed.length).toBe(first.committed.length);
    expect(second.missing).toEqual([]);
  });

  it('UT-S33-25: commit 拒绝 unknown / stale / 并发（run_locked）', () => {
    // unknown
    expect(() => baselineSeedCommit('core', 'seed-core-9999', 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('unknown_run');
    // stale：begin 两次，第二次 supersede 第一次
    writeManifest(root, fullExpected());
    const d1 = begin(root, con);
    const d2 = begin(root, con);
    expect(d2.run_id).not.toBe(d1.run_id);
    con.errors.length = 0;
    expect(() => baselineSeedCommit('core', d1.run_id, 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('stale_run');
    // run_locked：预先持锁
    acquireLock(root, 'core');
    con.errors.length = 0;
    try {
      expect(() => baselineSeedCommit('core', d2.run_id, 'json')).toThrow('process.exit(1)');
      expect(con.errors.join('\n')).toContain('run_locked');
    } finally {
      releaseLock(root, 'core');
    }
  });

  it('UT-S33-26: 产物 schema 非法计入 invalid、不进 seeded', () => {
    writeManifest(root, fullExpected());
    const d = begin(root, con);
    stage(root, d.run_id, SYSTEM_MAP, '# 无逆向基线来源章节的非法产物\n'); // invalid
    stage(root, d.run_id, SCENARIOS, stagedDoc([K2]));
    const r = commit(root, con, d.run_id);
    expect(r.invalid).toContain(SYSTEM_MAP);
    expect(r.baseline_seed_state).not.toBe('seeded');
    expect(r.baseline_seed_state).toBe('partial');
  });

  it('UT-S33-27: 从 partial 重新 begin 不回退 required（保留 partial 至新 run 首次有效 commit）', () => {
    setupAdopted(root, 'partial');
    writeManifest(root, fullExpected());
    const d = begin(root, con);
    // begin 不下调：仍 partial（不回 required）
    expect(readSeedState(root, 'core')).toBe('partial');
    expect(d.baseline_seed_state).toBe('partial');
  });

  it('UT-S33-32: 半提交 run 被新 begin supersede——begin 先在锁内跑其恢复到一致态再 supersede', () => {
    setupAdopted(root, 'partial');
    // 构造 run A：committing 未终结 journal + staging 完好（T1 已 rename、T2 未），run.json=open。
    const runA = 'seed-core-0001';
    const oldB = '# old b\n\n## 逆向基线来源\n```yaml\ncandidates:\n  - key: "core::b22222222222"\n    state: active\n    verified: false\n```\n';
    const newA = stagedDoc([K1]);
    const newB = stagedDoc([K2]);
    // on-disk：T1 新、T2 旧
    mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
    writeFileSync(join(root, SYSTEM_MAP), newA);
    writeFileSync(join(root, SCENARIOS), oldB);
    // resolved 完好（最终内容，供 roll-forward）
    const resolve = (t: string, c: string) => { const p = join(resolvedDir(root, runA), t); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); };
    resolve(SYSTEM_MAP, newA);
    resolve(SCENARIOS, newB);
    // backup（old + yaml 备份）
    mkdirSync(join(backupDir(root, runA), dirname(SCENARIOS)), { recursive: true });
    writeFileSync(join(backupDir(root, runA), SCENARIOS), oldB);
    writeFileSync(join(backupDir(root, runA), 'logos-project.yaml.bak'), readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8'));
    // run.json = open + journal committing
    atomicWriteJson(runRecordPath(root, runA), { run_id: runA, module: 'core', status: 'open', expected: fullExpected(), created_at: '2026-07-14T00:00:00Z' });
    const journal: CommitJournal = {
      phase: 'committing', run_id: runA, module: 'core',
      targets: [
        { target_path: SYSTEM_MAP, old_sha256: sha256('placeholder-old-a'), new_sha256: sha256(newA), applied: true },
        { target_path: SCENARIOS, old_sha256: sha256(oldB), new_sha256: sha256(newB), applied: false },
      ],
      index: { yaml_backup_path: join(backupDir(root, runA), 'logos-project.yaml.bak'), old_yaml_sha256: null },
      state_transition: { from: 'partial', to: 'seeded' },
      keys: [K1, K2],
    };
    atomicWriteJson(journalPath(root, runA), journal);

    // 发起 begin(B)：应先恢复 A（前滚到一致态、journal 终结）再 supersede A，再建 B。
    writeManifest(root, fullExpected());
    const dB = begin(root, con);
    expect(dB.run_id).not.toBe(runA);
    // A 的 journal 已终结（committed），A 的 run.json 已 superseded
    expect(readJournal(root, runA)?.phase).toBe('committed');
    expect(readRunRecord(root, runA)?.status).toBe('superseded');
    // A 前滚落定全新集合
    expect(readFileSync(join(root, SCENARIOS), 'utf-8')).toBe(newB);
  });

  it('UT-S33-18b: baseline-seed status 只读 run/staging 进度', () => {
    writeManifest(root, fullExpected());
    const d = begin(root, con);
    stage(root, d.run_id, SYSTEM_MAP, stagedDoc([K1]));
    con.logs.length = 0;
    baselineSeedStatus('core', 'json');
    const s = JSON.parse(con.logs[0]).data;
    expect(s.run_id).toBe(d.run_id);
    expect(s.staged).toBe(1);
    expect(s.expected).toBe(2);
  });
});
