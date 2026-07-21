import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeTempRoot, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { baselineSeedBegin, baselineSeedCommit } from '../src/commands/baseline-seed.js';
import { collectStatusData } from '../src/commands/status.js';
import {
  stagingDir, resolvedDir, backupDir, journalPath, runRecordPath, lockPath, readSeedState,
  sha256, atomicWriteJson, recoverJournal, eventsPath,
  type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import { detectBaselineJitAdvisory } from '../src/lib/baseline-jit.js';
import { scanModuleCandidates, buildBaselineCoverage, candidateKey } from '../src/lib/baseline-provenance.js';

const T1 = 'logos/resources/prd/core-system-map.md';
const T2 = 'logos/resources/prd/core-scenario-candidates.md';
// 契约保真：key = candidateKey(module, anchor)（hash 形式），anchor 为语义锚点。
const A1 = 'cli:one';
const A2 = 'cli:two';
const K1 = candidateKey('core', A1);
const K2 = candidateKey('core', A2);

function setupAdopted(root: string, state?: string) {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
  const stateLine = state ? `\n    baseline_seed_state: ${state}` : '';
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted${stateLine}\n`);
}
/** 契约保真候选文档：每候选携 anchor，key 由 anchor 派生（除非显式覆盖 key 以复现反例）。 */
interface CandSpec { anchor: string; key?: string; verified?: boolean; state?: string; aliases?: string[] }
function docForA(cands: CandSpec[]) {
  const body = cands.map(c => {
    const key = c.key ?? candidateKey('core', c.anchor);
    const aliasLine = c.aliases ? `    aliases: [${c.aliases.map(a => `"${a}"`).join(', ')}]\n` : '';
    return `  - key: "${key}"\n    anchor: "${c.anchor}"\n    state: ${c.state ?? 'active'}\n    verified: ${c.verified ?? false}\n${aliasLine}`;
  }).join('');
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n${body}\`\`\`\n`;
}
/** 兼容旧签名（按 key 列表）——内部映射到锚点 A1/A2（K1↔A1、K2↔A2），保 on-disk/staged 一致。 */
function docFor(keys: Array<{ key: string; verified?: boolean; state?: string }>) {
  const anchorForKey = (k: string) => (k === K1 ? A1 : k === K2 ? A2 : k);
  return docForA(keys.map(k => ({ anchor: anchorForKey(k.key), key: k.key, verified: k.verified, state: k.state })));
}
function writeManifest(root: string, expected: unknown) { writeFileSync(join(root, 'seed-plan.json'), JSON.stringify({ module: 'core', expected })); }
function fullExpected(t1 = [K1], t2 = [K2]) {
  return [
    { kind: 'system-map', target_path: T1, candidate_keys: t1 },
    { kind: 'scenario-candidates', target_path: T2, candidate_keys: t2 },
  ];
}
function stage(root: string, runId: string, target: string, content: string) {
  const p = join(stagingDir(root, runId), target); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content);
}

describe('S33 review r2 — 残留边界闭环', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>; let exitSpy: ReturnType<typeof mockProcessExit>;
  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot()); setupAdopted(root, 'required');
    restoreCwd = mockCwd(root); con = captureConsole(); exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  function begin(): string { con.logs.length = 0; baselineSeedBegin('core', 'seed-plan.json', 'json'); return JSON.parse(con.logs[0]).data.run_id; }

  it('F2: --run-id 路径注入被拒（path_escape）', () => {
    con.errors.length = 0;
    expect(() => baselineSeedCommit('core', '../evil', 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('path_escape');
  });

  it('F2: 被篡改的 run 记录 target_path 在 commit 时重新校验并拒绝', () => {
    writeManifest(root, fullExpected());
    const runId = begin();
    // 篡改 run.json，把 target_path 改成越界路径
    const rec = JSON.parse(readFileSync(runRecordPath(root, runId), 'utf-8'));
    rec.expected[0].target_path = 'logos/resources/../../evil.md';
    atomicWriteJson(runRecordPath(root, runId), rec);
    con.errors.length = 0;
    expect(() => baselineSeedCommit('core', runId, 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('path_escape');
  });

  it('F3: staged 候选 verified:true 或非 active 状态被拒（invalid_provenance）', () => {
    writeManifest(root, fullExpected());
    const runId = begin();
    stage(root, runId, T1, docFor([{ key: K1, verified: true }])); // 伪造人工确认
    stage(root, runId, T2, docFor([{ key: K2 }]));
    con.errors.length = 0;
    expect(() => baselineSeedCommit('core', runId, 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('invalid_provenance');
    expect(readSeedState(root, 'core')).toBe('required');

    // 非 active 状态（tombstone）同样被拒
    const runId2 = begin();
    stage(root, runId2, T1, docFor([{ key: K1, state: 'tombstone' }]));
    stage(root, runId2, T2, docFor([{ key: K2 }]));
    con.errors.length = 0;
    expect(() => baselineSeedCommit('core', runId2, 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('invalid_provenance');
  });

  it('F4: 真实 anchor 重命名身份继承（staged newAnchor + aliases=[旧 anchor] 继承 prior 人工确认）', () => {
    const OLD_A = 'cli:old';
    const NEW_A = 'cli:new';
    const OLD_K = candidateKey('core', OLD_A);
    const NEW_K = candidateKey('core', NEW_A);
    // 首次 seeded（含 OLD）
    writeManifest(root, fullExpected([OLD_K], [K2]));
    let runId = begin();
    stage(root, runId, T1, docForA([{ anchor: OLD_A }])); stage(root, runId, T2, docForA([{ anchor: A2 }]));
    con.logs.length = 0; baselineSeedCommit('core', runId, 'json');
    // 人工确认 OLD（merge 落主文档）
    writeFileSync(join(root, T1), docForA([{ anchor: OLD_A, verified: true }]));
    // 重扫：anchor 重命名 → NEW key，aliases 记**旧 anchor**（契约保真，非旧 key）
    writeManifest(root, fullExpected([NEW_K], [K2]));
    runId = begin();
    stage(root, runId, T1, docForA([{ anchor: NEW_A, aliases: [OLD_A] }]));
    stage(root, runId, T2, docForA([{ anchor: A2 }]));
    con.logs.length = 0; baselineSeedCommit('core', runId, 'json');
    const merged = readFileSync(join(root, T1), 'utf-8');
    // NEW 继承人工确认（verified:true）；OLD 未作为独立 tombstone 残留（身份已继承）
    const sec = scanModuleCandidates(root, 'core').candidates;
    expect(sec.find(c => c.key === NEW_K)?.verified).toBe(true);
    expect(sec.find(c => c.key === OLD_K)).toBeUndefined();
    expect(merged).toContain(NEW_K);
  });

  it('F4: 同 run 幂等重提交目标字节一致（staged 保持纯净、确定性序列化）', () => {
    writeManifest(root, fullExpected());
    const runId = begin();
    stage(root, runId, T1, docFor([{ key: K1 }])); stage(root, runId, T2, docFor([{ key: K2 }]));
    con.logs.length = 0; baselineSeedCommit('core', runId, 'json');
    const first = readFileSync(join(root, T1), 'utf-8');
    con.logs.length = 0; baselineSeedCommit('core', runId, 'json'); // 幂等重提交
    const second = readFileSync(join(root, T1), 'utf-8');
    expect(second).toBe(first); // 字节一致
    // staged 仍为纯净扫描器输出（未被对账污染）
    expect(readFileSync(join(stagingDir(root, runId), T1), 'utf-8')).toBe(docFor([{ key: K1 }]));
  });

  it('F5: 同稳定键跨文档冲突 → parse_failed / freshness=unknown（不静默 last-wins 报 fresh）', () => {
    mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/prd/a.md'), docFor([{ key: K1 }]));
    writeFileSync(join(root, 'logos/resources/prd/b.md'), docFor([{ key: K1, verified: true }])); // 同 key 冲突
    expect(scanModuleCandidates(root, 'core').parse_failed).toBe(true);
    expect(buildBaselineCoverage(root, 'core', 'seeded').freshness).toBe('unknown');
  });

  it('F6: legacy adopted（无字段）有逆向产物 → 有效状态 seeded 展示覆盖率，不误报 required', () => {
    setupAdopted(root); // 无 baseline_seed_state 字段
    writeFileSync(join(root, T1), docFor([{ key: K1, verified: false }]));
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_seed_state).toBe('seeded');       // 有产物 → seeded（非无条件 required）
    expect(mod.baseline_coverage?.denominator).toBe(1);
    expect(mod.suggestion.toLowerCase()).toContain('legacy'); // legacy 迁移提示
  });

  it('F6(baseline-seed-legacy-default-unify 修订): legacy adopted（无字段）无产物 → 派生 required、字段恒在，提示 legacy 迁移 + 逆向建基线引导', () => {
    setupAdopted(root);
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_seed_state).toBe('required');     // 架构 §4.1：缺省经统一派生（无候选 → required），unknown 第三态废除
    expect(mod.suggestion.toLowerCase()).toContain('legacy');
    expect(mod.suggestion).toContain('逆向建立现状基线'); // advisory 引导，不设硬门、不阻断 change
  });

  it('F7: 提交进行中（锁被存活进程占用）时 baseline-jit 返回 commit_in_progress、不据半集合判 advisory', () => {
    // committing journal + 锁被 pid=1（存活）占用 → recoverPendingForRead 无法恢复 → inProgress
    const runId = 'seed-core-0001';
    mkdirSync(dirname(lockPath(root, 'core')), { recursive: true });
    writeFileSync(lockPath(root, 'core'), JSON.stringify({ pid: 1, at: Date.now() }));
    writeFileSync(join(root, T1), docFor([{ key: K1 }]));
    const journal: CommitJournal = {
      phase: 'committing', run_id: runId, module: 'core',
      targets: [{ target_path: T1, old_sha256: null, new_sha256: sha256(docFor([{ key: K1 }])), applied: true }],
      index: { yaml_backup_path: join(backupDir(root, runId), 'x.bak'), old_yaml_sha256: null },
      state_transition: { from: 'partial', to: 'seeded' }, keys: [K1],
    };
    atomicWriteJson(journalPath(root, runId), journal);
    // change 触碰 T1
    const deltaP = join(root, 'logos/changes/feat/deltas/prd/core-system-map.md');
    mkdirSync(dirname(deltaP), { recursive: true }); writeFileSync(deltaP, docFor([{ key: K1 }]));
    const adv = detectBaselineJitAdvisory(root, 'feat');
    expect(adv.advise).toBe(false);
    expect(adv.message).toContain('baseline_commit_in_progress');
  });

  it('F9: 崩溃在 register 事件之前 → roll-forward 幂等补记事件（携真实 keys）', () => {
    const runId = 'seed-core-0002';
    const newA = docFor([{ key: K1 }]);
    writeFileSync(join(root, T1), newA); // 已 applied
    const rp = join(resolvedDir(root, runId), T1); mkdirSync(dirname(rp), { recursive: true }); writeFileSync(rp, newA);
    mkdirSync(backupDir(root, runId), { recursive: true });
    const journal: CommitJournal = {
      phase: 'committing', run_id: runId, module: 'core',
      targets: [{ target_path: T1, old_sha256: null, new_sha256: sha256(newA), applied: true }],
      index: { yaml_backup_path: join(backupDir(root, runId), 'x.bak'), old_yaml_sha256: null },
      state_transition: { from: 'partial', to: 'seeded' }, keys: [K1],
    };
    atomicWriteJson(journalPath(root, runId), journal);
    // 事件文件此刻无 register 事件（崩溃在 event 之前）
    recoverJournal(root, runId, '2026-07-14T00:00:00Z'); // roll-forward
    const events = readFileSync(eventsPath(root), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const commit = events.filter(e => e.event_id === `${runId}-commit`);
    expect(commit.length).toBe(1);
    expect(commit[0].keys).toEqual([K1]);
    expect(readSeedState(root, 'core')).toBe('seeded');
  });
});
