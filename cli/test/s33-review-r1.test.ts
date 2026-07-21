import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { makeTempRoot, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { baselineSeedBegin, baselineSeedCommit } from '../src/commands/baseline-seed.js';
import {
  acquireLock, releaseLock, lockPath, validateTargetPaths, isSafeModuleId,
  readSeedState, recoverPendingForRead, recoverJournal, sha256, atomicWriteJson,
  journalPath, stagingDir, resolvedDir, backupDir, runRecordPath, eventsPath,
  type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import {
  scanModuleCandidates, buildBaselineCoverage, parseProvenanceSection, candidateKey,
} from '../src/lib/baseline-provenance.js';

const T1 = 'logos/resources/prd/core-system-map.md';
const T2 = 'logos/resources/prd/core-scenario-candidates.md';
// 契约保真：key = candidateKey(module, anchor)（F3：seed 输入须携锚点且 key 与 anchor 一致）。
const A1 = 'cli:one';
const A2 = 'cli:two';
const AX = 'cli:x';
const K1 = candidateKey('core', A1);
const K2 = candidateKey('core', A2);
const KX = candidateKey('core', AX);
const ANCHOR_OF: Record<string, string> = { [K1]: A1, [K2]: A2, [KX]: AX };

function setupAdopted(root: string, state = 'required') {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: ${state}\n`);
}
function docFor(keys: Array<{ key: string; verified?: boolean }>) {
  const body = keys.map(k => {
    const anchor = ANCHOR_OF[k.key] ?? k.key;
    return `  - key: "${k.key}"\n    anchor: "${anchor}"\n    state: active\n    verified: ${k.verified ?? false}\n`;
  }).join('');
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n${body}\`\`\`\n`;
}
function writeManifest(root: string, expected: unknown) {
  writeFileSync(join(root, 'seed-plan.json'), JSON.stringify({ module: 'core', expected }));
}
function stage(root: string, runId: string, target: string, content: string) {
  const p = join(stagingDir(root, runId), target);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
function fullExpected(t1Keys = [K1], t2Keys = [K2]) {
  return [
    { kind: 'system-map', target_path: T1, candidate_keys: t1Keys },
    { kind: 'scenario-candidates', target_path: T2, candidate_keys: t2Keys },
  ];
}

describe('S33 review r1 — F1..F9 修复的行为测试', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>; let exitSpy: ReturnType<typeof mockProcessExit>;
  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    setupAdopted(root);
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  // ---- F1：锁仅回收「进程确证已死」；空/损坏锁与活进程锁一律不抢占（link 原子发布完整 owner，无空窗口）----
  it('F1: 仅回收进程确证已死的锁；空/损坏锁与活进程锁一律不抢占', () => {
    mkdirSync(dirname(lockPath(root, 'core')), { recursive: true });
    // 死 pid 的锁（可解析、进程确证已死）→ 回收
    writeFileSync(lockPath(root, 'core'), JSON.stringify({ pid: 2147483646, at: Date.now() }));
    expect(acquireLock(root, 'core')).toBe(true); // 回收成功（进程确证已死）
    // 本进程刚获取、仍存活 → 第二次获取被拒（绝不双持）
    expect(acquireLock(root, 'core')).toBe(false);
    releaseLock(root, 'core');
    // F1：空锁**一律不回收**——本协议以 link 原子发布完整 owner，绝不产生「已创建、内容未写」的空窗口；
    // 空/不可解析锁只可能来自协议外持有者的发布窗口/活锁，即时回收会抢占其活锁 → 获取被拒。
    writeFileSync(lockPath(root, 'core'), '');
    expect(acquireLock(root, 'core')).toBe(false);
    // 损坏（非法 JSON）锁同理不回收
    writeFileSync(lockPath(root, 'core'), '{ broken json');
    expect(acquireLock(root, 'core')).toBe(false);
    rmSync(lockPath(root, 'core'), { force: true });
    // 另一【存活】进程（pid=1 init/launchd，恒存活且非本进程）持有 + 超旧时间戳 → 绝不按超时抢活锁
    writeFileSync(lockPath(root, 'core'), JSON.stringify({ pid: 1, at: 0 }));
    expect(acquireLock(root, 'core')).toBe(false);
    rmSync(lockPath(root, 'core'), { force: true });
  });

  // ---- F2：路径安全 + 标识符 ----
  it('F2: isSafeModuleId + validateTargetPaths 拒绝绝对/../非 md/坏标识符/嵌套符号链接', () => {
    expect(isSafeModuleId('core')).toBe(true);
    expect(isSafeModuleId('core/../x')).toBe(false);
    expect(isSafeModuleId('Core')).toBe(false);
    expect(isSafeModuleId('')).toBe(false);
    const bad = (p: string) => validateTargetPaths(root, [{ kind: 'system-map', target_path: p, candidate_keys: [] }]);
    expect(bad('/etc/passwd').ok).toBe(false);
    expect(bad('logos/resources/../secret.md').ok).toBe(false);
    expect(bad('logos/config.json').ok).toBe(false);            // 非 resources
    expect(bad('logos/resources/prd/x.txt').ok).toBe(false);    // 非 .md
    expect(bad('logos/resources/prd/x.md').ok).toBe(true);
    // 嵌套符号链接逃逸
    const evilTarget = join(tmpdir(), `evil-${process.pid}`);
    mkdirSync(evilTarget, { recursive: true });
    mkdirSync(join(root, 'logos/resources'), { recursive: true });
    symlinkSync(evilTarget, join(root, 'logos/resources/link'));
    expect(bad('logos/resources/link/x.md').ok).toBe(false);
    rmSync(evilTarget, { recursive: true, force: true });
  });

  // ---- F3：严格 schema + 模块归属 ----
  it('F3: 跨模块/伪造 key 与非法 schema 不得被标 seeded', () => {
    // 跨模块 key → candidate_key_mismatch 硬拒
    writeManifest(root, fullExpected(['other::a11111111111'], [K2]));
    let runId = (() => { con.logs.length = 0; baselineSeedBegin('core', 'seed-plan.json', 'json'); return JSON.parse(con.logs[0]).data.run_id; })();
    stage(root, runId, T1, docFor([{ key: 'other::a11111111111' }]));
    stage(root, runId, T2, docFor([{ key: K2 }]));
    con.errors.length = 0;
    expect(() => baselineSeedCommit('core', runId, 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('candidate_key_mismatch');
    expect(readSeedState(root, 'core')).toBe('required'); // 未标 seeded
  });

  it('F3: staged 章节 YAML 解析失败计入 invalid、不进 seeded', () => {
    writeManifest(root, fullExpected());
    con.logs.length = 0; baselineSeedBegin('core', 'seed-plan.json', 'json');
    const runId = JSON.parse(con.logs[0]).data.run_id;
    stage(root, runId, T1, '# doc\n\n## 逆向基线来源\n```yaml\ncandidates: [ this : is : broken\n```\n'); // 非法 YAML
    stage(root, runId, T2, docFor([{ key: K2 }]));
    con.logs.length = 0;
    baselineSeedCommit('core', runId, 'json');
    const r = JSON.parse(con.logs[0]).data;
    expect(r.invalid).toContain(T1);
    expect(r.baseline_seed_state).not.toBe('seeded');
  });

  // ---- F4：重扫继承 + tombstone 对账 ----
  it('F4: 重扫继承人工确认、消失候选转 tombstone（不抹确认、不缩分母）', () => {
    // 首次：T1 含 K1+KX，commit seeded
    writeManifest(root, fullExpected([K1, KX], [K2]));
    con.logs.length = 0; baselineSeedBegin('core', 'seed-plan.json', 'json');
    const run1 = JSON.parse(con.logs[0]).data.run_id;
    stage(root, run1, T1, docFor([{ key: K1 }, { key: KX }]));
    stage(root, run1, T2, docFor([{ key: K2 }]));
    con.logs.length = 0; baselineSeedCommit('core', run1, 'json');
    expect(JSON.parse(con.logs[0]).data.baseline_seed_state).toBe('seeded');

    // 人工确认 K1（模拟 JIT delta merge 落主文档：K1 verified:true）
    writeFileSync(join(root, T1), docFor([{ key: K1, verified: true }, { key: KX }]));
    let cov = scanModuleCandidates(root, 'core');
    expect(cov.candidates.find(c => c.key === K1)?.verified).toBe(true);

    // 重扫：T1 只含 K1（scanner 写 verified:false，KX 消失）
    writeManifest(root, fullExpected([K1], [K2]));
    con.logs.length = 0; baselineSeedBegin('core', 'seed-plan.json', 'json');
    const run2 = JSON.parse(con.logs[0]).data.run_id;
    stage(root, run2, T1, docFor([{ key: K1 }]));       // verified:false（scanner 输出）
    stage(root, run2, T2, docFor([{ key: K2 }]));
    con.logs.length = 0; baselineSeedCommit('core', run2, 'json');
    expect(JSON.parse(con.logs[0]).data.baseline_seed_state).toBe('seeded');

    // 对账后：K1 人工确认被继承（未被降级）、KX 转 tombstone（仍在分母）
    const merged = parseProvenanceSection(readFileSync(join(root, T1), 'utf-8'))!;
    expect(merged.candidates.find(c => c.key === K1)?.verified).toBe(true);   // 未抹确认
    expect(merged.candidates.find(c => c.key === KX)?.state).toBe('tombstone'); // 消失 → tombstone
    const c2 = scanModuleCandidates(root, 'core');
    // 分母含 K1(active)+KX(tombstone)+K2(active)=3，未因删除缩小；分子 K1=1
    const cc = c2.candidates;
    expect(cc.filter(c => c.state === 'active' || c.state === 'tombstone').length).toBe(3);
    expect(cc.filter(c => c.state === 'active' && c.verified).length).toBe(1);
  });

  // ---- F5：去重 + 解析失败新鲜度 ----
  it('F5: 同 key 跨文档不重复计数；章节解析失败 → freshness=unknown', () => {
    mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/prd/a.md'), docFor([{ key: K1, verified: true }]));
    writeFileSync(join(root, 'logos/resources/prd/b.md'), docFor([{ key: K1, verified: true }])); // 同 key
    const scan = scanModuleCandidates(root, 'core');
    expect(scan.candidates.length).toBe(1); // 去重
    // 解析失败文档 → parse_failed → freshness unknown
    writeFileSync(join(root, 'logos/resources/prd/c.md'), '# x\n\n## 逆向基线来源\n```yaml\n: broken :\n```\n');
    expect(scanModuleCandidates(root, 'core').parse_failed).toBe(true);
    expect(buildBaselineCoverage(root, 'core', 'seeded').freshness).toBe('unknown');
  });

  // ---- F7：跨模块恢复门（读前恢复所有未终结提交）----
  it('F7: recoverPendingForRead 在读取前恢复未终结提交（committing+staging 完好 → 全新 seeded）', () => {
    // 构造 committing 崩溃态（T1 新、T2 旧，staging 完好）
    const runId = 'seed-core-0001';
    const newA = docFor([{ key: K1 }]); const newB = docFor([{ key: K2 }]);
    const oldB = docFor([{ key: K2, verified: false }]) + '\n<!-- old -->';
    writeFileSync(join(root, T1), newA); mkdirSync(dirname(join(root, T2)), { recursive: true }); writeFileSync(join(root, T2), oldB);
    // resolved 完好（最终内容）
    for (const [t, c] of [[T1, newA], [T2, newB]] as const) { const p = join(resolvedDir(root, runId), t); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, c); }
    mkdirSync(backupDir(root, runId), { recursive: true });
    writeFileSync(join(backupDir(root, runId), 'logos-project.yaml.bak'), readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8'));
    const journal: CommitJournal = {
      phase: 'committing', run_id: runId, module: 'core',
      targets: [
        { target_path: T1, old_sha256: sha256('old-a'), new_sha256: sha256(newA), applied: true },
        { target_path: T2, old_sha256: sha256(oldB), new_sha256: sha256(newB), applied: false },
      ],
      index: { yaml_backup_path: join(backupDir(root, runId), 'logos-project.yaml.bak'), old_yaml_sha256: null },
      state_transition: { from: 'partial', to: 'seeded' },
      keys: [K1, K2],
    };
    atomicWriteJson(journalPath(root, runId), journal);
    const res = recoverPendingForRead(root, '2026-07-14T00:00:00Z');
    expect(res.inProgress).toEqual([]);          // 已恢复
    expect(readFileSync(join(root, T2), 'utf-8')).toBe(newB); // 全新
    expect(readSeedState(root, 'core')).toBe('seeded');
  });

  // ---- F9：幂等 commit 不重复审计事件、事件携真实 keys ----
  it('F9: 幂等重提交只记一条 register 事件、keys 为真实候选', () => {
    writeManifest(root, fullExpected());
    con.logs.length = 0; baselineSeedBegin('core', 'seed-plan.json', 'json');
    const runId = JSON.parse(con.logs[0]).data.run_id;
    stage(root, runId, T1, docFor([{ key: K1 }]));
    stage(root, runId, T2, docFor([{ key: K2 }]));
    baselineSeedCommit('core', runId, 'json');
    baselineSeedCommit('core', runId, 'json'); // 幂等重提交
    const events = readFileSync(eventsPath(root), 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const commits = events.filter(e => e.event_id === `${runId}-commit`);
    expect(commits.length).toBe(1);                       // 不重复
    expect(commits[0].keys.sort()).toEqual([K1, K2].sort()); // 真实 keys（非空）
  });
});
