import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeTempRoot, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { baselineSeedBegin, baselineSeedCommit } from '../src/commands/baseline-seed.js';
import { collectStatusData } from '../src/commands/status.js';
import { indexCommand } from '../src/commands/index-cmd.js';
import { sync } from '../src/commands/sync.js';
import {
  stagingDir, runRecordPath, lockPath, journalPath, backupDir, readSeedState,
  sha256, atomicWriteJson, acquireLock, releaseLock, runDir,
  type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import { candidateKey, scanModuleCandidates } from '../src/lib/baseline-provenance.js';

/**
 * S33 code 第 3 轮：把评审 F1..F8 的最小复现原样固化为**真实命令入口**回归测试，
 * 证明相应生产缺陷已闭环（本轮反例输入不再被弱化输入绕开）。
 */

const T1 = 'logos/resources/prd/core-system-map.md';
const T2 = 'logos/resources/prd/core-scenario-candidates.md';
const A1 = 'cli:one';
const A2 = 'cli:two';
const A3 = 'cli:three';
const K1 = candidateKey('core', A1);
const K2 = candidateKey('core', A2);
const K3 = candidateKey('core', A3);
const ANCHOR_OF: Record<string, string> = { [K1]: A1, [K2]: A2, [K3]: A3 };

function setupAdopted(root: string, state = 'required', extraModuleYaml = '') {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
  const stateLine = state ? `\n    baseline_seed_state: ${state}` : '';
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted${stateLine}${extraModuleYaml}\n`);
}
/** 单候选文档（携 anchor，key 由 anchor 派生，除非显式覆盖以复现反例）。 */
function candDoc(specs: Array<{ anchor: string; key?: string; state?: string; verified?: unknown; aliases?: string[]; omitAnchor?: boolean; omitVerified?: boolean }>) {
  const body = specs.map(s => {
    const key = s.key ?? candidateKey('core', s.anchor);
    const anchorLine = s.omitAnchor ? '' : `    anchor: "${s.anchor}"\n`;
    const verifiedLine = s.omitVerified ? '' : `    verified: ${s.verified ?? false}\n`;
    const aliasLine = s.aliases ? `    aliases: [${s.aliases.map(a => `"${a}"`).join(', ')}]\n` : '';
    return `  - key: "${key}"\n${anchorLine}    state: ${s.state ?? 'active'}\n${verifiedLine}${aliasLine}`;
  }).join('');
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n${body}\`\`\`\n`;
}
function docByKeys(keys: string[]) {
  return candDoc(keys.map(k => ({ anchor: ANCHOR_OF[k] ?? k, key: k })));
}
function writeManifest(root: string, expected: unknown) {
  writeFileSync(join(root, 'seed-plan.json'), JSON.stringify({ module: 'core', expected }));
}
function fullExpected(t1 = [K1], t2 = [K2]) {
  return [
    { kind: 'system-map', target_path: T1, candidate_keys: t1 },
    { kind: 'scenario-candidates', target_path: T2, candidate_keys: t2 },
  ];
}
function stage(root: string, runId: string, target: string, content: string) {
  const p = join(stagingDir(root, runId), target); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, content);
}

describe('S33 review r3 — F1..F8 反例的真实入口回归', () => {
  let root: string; let cleanup: () => void; let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>; let exitSpy: ReturnType<typeof mockProcessExit>;
  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot()); setupAdopted(root, 'required');
    restoreCwd = mockCwd(root); con = captureConsole(); exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  function begin(): string { con.logs.length = 0; baselineSeedBegin('core', 'seed-plan.json', 'json'); return JSON.parse(con.logs[0]).data.run_id; }
  function commitErr(runId: string): string {
    con.errors.length = 0;
    expect(() => baselineSeedCommit('core', runId, 'json')).toThrow('process.exit(1)');
    return con.errors.join('\n');
  }

  // ---- F1：损坏回收不抢占处于发布窗口的活锁 ----
  it('F1: 处于「已 O_EXCL 创建、payload 未写」窗口的空锁不被损坏回收抢占', () => {
    mkdirSync(dirname(lockPath(root, 'core')), { recursive: true });
    // 精确模拟第一持有者的发布窗口：openSync('wx') 创建空文件并持有 fd（尚未写 owner payload）。
    const fd = openSync(lockPath(root, 'core'), 'wx');
    try {
      // 第二进程（本测试）此刻尝试获取：空/不可解析锁一律不回收 → 不抢占活锁。
      expect(acquireLock(root, 'core')).toBe(false);
    } finally {
      closeSync(fd);
    }
  });

  it('F1: 成功获取后锁文件恒为完整可解析 owner（link 原子发布，无空窗口）', () => {
    expect(acquireLock(root, 'core')).toBe(true);
    const raw = readFileSync(lockPath(root, 'core'), 'utf-8');
    const owner = JSON.parse(raw);
    expect(owner.pid).toBe(process.pid);
    expect(typeof owner.token).toBe('string');
    releaseLock(root, 'core');
  });

  // ---- F2：run 必须为 begin 签发、record 绑定、module 注册 ----
  it('F2: 手工放入的未签发安全字符串 run（非 seed-<module>-NNNN 格式）被拒，不提交', () => {
    // runs 目录手工放入 unsigned-safe-id/run.json（run_id 故意写成 different-id）+ staged 产物。
    const badId = 'unsigned-safe-id';
    mkdirSync(runDir(root, badId), { recursive: true });
    atomicWriteJson(runRecordPath(root, badId), { run_id: 'different-id', module: 'core', status: 'open', expected: fullExpected(), created_at: '2026-07-14T00:00:00Z' });
    stage(root, badId, T1, docByKeys([K1])); stage(root, badId, T2, docByKeys([K2]));
    const err = commitErr(badId);
    expect(err).toContain('unknown_run');
    expect(readSeedState(root, 'core')).toBe('required'); // 绝不 seeded
  });

  it('F2: 已签发 run 但 run.json.run_id 被篡改为他值 → 拒绝（record 与签发不一致）', () => {
    writeManifest(root, fullExpected());
    const runId = begin();
    const rec = JSON.parse(readFileSync(runRecordPath(root, runId), 'utf-8'));
    rec.run_id = 'seed-core-9999'; // 篡改：与 --run-id 不一致
    atomicWriteJson(runRecordPath(root, runId), rec);
    stage(root, runId, T1, docByKeys([K1])); stage(root, runId, T2, docByKeys([K2]));
    expect(commitErr(runId)).toContain('unknown_run');
  });

  it('F2: 对未注册 / 非 adopted module 的 begin 被拒', () => {
    writeManifest(root, fullExpected());
    con.errors.length = 0;
    expect(() => baselineSeedBegin('ghost', 'seed-plan.json', 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('unknown_run');
  });

  // ---- F3：严格 seed schema（未知 state / 缺 verified / 缺 anchor / key-hash 不匹配）----
  it('F3: 未知 state 被归一放行的反例现被硬拒（invalid_provenance）', () => {
    writeManifest(root, fullExpected());
    const runId = begin();
    stage(root, runId, T1, candDoc([{ anchor: A1, state: 'forged' }])); // 未知状态
    stage(root, runId, T2, docByKeys([K2]));
    expect(commitErr(runId)).toContain('invalid_provenance');
    expect(readSeedState(root, 'core')).toBe('required');
  });

  it('F3: 缺失 verified 被硬拒（invalid_provenance）', () => {
    writeManifest(root, fullExpected());
    const runId = begin();
    stage(root, runId, T1, candDoc([{ anchor: A1, omitVerified: true }]));
    stage(root, runId, T2, docByKeys([K2]));
    expect(commitErr(runId)).toContain('invalid_provenance');
  });

  it('F3: 缺失 anchor 的任意 core::12hex 候选被硬拒（invalid_provenance）', () => {
    writeManifest(root, fullExpected(['core::aaaaaaaaaaaa'], [K2]));
    const runId = begin();
    stage(root, runId, T1, candDoc([{ anchor: '', key: 'core::aaaaaaaaaaaa', omitAnchor: true }]));
    stage(root, runId, T2, docByKeys([K2]));
    expect(commitErr(runId)).toContain('invalid_provenance');
  });

  it('F3: key 与 anchor 的 hash 不匹配被硬拒（invalid_provenance）', () => {
    writeManifest(root, fullExpected(['core::aaaaaaaaaaaa'], [K2]));
    const runId = begin();
    stage(root, runId, T1, candDoc([{ anchor: A1, key: 'core::aaaaaaaaaaaa' }])); // key 非 anchor 派生
    stage(root, runId, T2, docByKeys([K2]));
    expect(commitErr(runId)).toContain('invalid_provenance');
  });

  // ---- F4：真实 anchor 重命名 + 跨文档移动身份继承（不产生重复/tombstone 残留）----
  it('F4: 候选跨目标文档移动经模块级对账继承身份，不在旧文档留 tombstone、不跨文档重复', () => {
    // 首次 seeded：T1=[A1], T2=[A2]
    writeManifest(root, fullExpected([K1], [K2]));
    let runId = begin();
    stage(root, runId, T1, docByKeys([K1])); stage(root, runId, T2, docByKeys([K2]));
    con.logs.length = 0; baselineSeedCommit('core', runId, 'json');
    // 重扫：A1 移动到 T2（新增 A3 占 T1），T2 现含 A2+A1
    writeManifest(root, fullExpected([K3], [K2, K1]));
    runId = begin();
    stage(root, runId, T1, docByKeys([K3]));
    stage(root, runId, T2, docByKeys([K2, K1]));
    con.logs.length = 0; baselineSeedCommit('core', runId, 'json');
    expect(JSON.parse(con.logs[0]).data.baseline_seed_state).toBe('seeded');
    const cands = scanModuleCandidates(root, 'core').candidates;
    // A1 仍为单一 active（移动到 T2），未在 T1 留 tombstone、未跨文档重复
    const a1 = cands.filter(c => c.key === K1);
    expect(a1.length).toBe(1);
    expect(a1[0].state).toBe('active');
    expect(scanModuleCandidates(root, 'core').parse_failed).toBe(false); // 无跨文档同 key 冲突
  });

  // ---- F5：同一稳定键跨多个目标文档在 begin 与 commit 均被拒 ----
  it('F5: begin 拒绝同 key 分布在多个目标文档（candidate_key_conflict）', () => {
    writeManifest(root, fullExpected([K1], [K1])); // K1 同时出现在两个目标
    con.errors.length = 0;
    expect(() => baselineSeedBegin('core', 'seed-plan.json', 'json')).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('candidate_key_conflict');
  });

  it('F5: commit 重验持久化计划时同样拒绝跨目标重复 key（篡改 run.json）', () => {
    writeManifest(root, fullExpected([K1], [K2]));
    const runId = begin();
    // 篡改 run.json，把 K1 也塞进第二个目标的 candidate_keys（跨目标重复）
    const rec = JSON.parse(readFileSync(runRecordPath(root, runId), 'utf-8'));
    rec.expected[1].candidate_keys = [K2, K1];
    atomicWriteJson(runRecordPath(root, runId), rec);
    stage(root, runId, T1, docByKeys([K1])); stage(root, runId, T2, docByKeys([K2]));
    expect(commitErr(runId)).toContain('candidate_key_conflict');
  });

  // ---- F6（baseline-seed-legacy-default-unify 修订）：legacy 缺省经统一派生，无候选 → required 且字段恒在 ----
  it('F6(修订): legacy adopted 无字段无候选 → 派生 required + 字段恒在 + 逆向建基线引导（附 legacy 迁移提示）', () => {
    setupAdopted(root, ''); // 无 baseline_seed_state 字段、无候选
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_seed_state).toBe('required');
    expect(mod.suggestion).toContain('逆向建立现状基线');
    expect(mod.suggestion).toContain('openlogos sync');
  });

  it('F6: 契约矩阵——显式 required→required、缺省+候选→seeded', () => {
    // 显式 required
    setupAdopted(root, 'required');
    expect(collectStatusData(root).modules![0].baseline_seed_state).toBe('required');
    // 缺省 + 有候选（无 open run）→ seeded（由候选推导）
    setupAdopted(root, '');
    writeFileSync(join(root, T1), docByKeys([K1]));
    expect(collectStatusData(root).modules![0].baseline_seed_state).toBe('seeded');
  });

  it('F6: 旧布尔 baseline_seed_required:true 仍映射 required（迁移兼容）', () => {
    mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
    writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
    writeFileSync(join(root, 'logos/logos-project.yaml'),
      `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_required: true\n`);
    expect(collectStatusData(root).modules![0].baseline_seed_state).toBe('required');
  });

  // ---- F7：index / sync 尊重恢复门 inProgress，不继续读半提交集合 ----
  function stallCommit(): void {
    // committing journal + 存活进程（pid=1）持锁 → recoverPendingForRead 无法恢复 → inProgress=[core]
    const runId = 'seed-core-0001';
    mkdirSync(dirname(lockPath(root, 'core')), { recursive: true });
    writeFileSync(lockPath(root, 'core'), JSON.stringify({ pid: 1, at: 0 }));
    writeFileSync(join(root, T1), docByKeys([K1]));
    const journal: CommitJournal = {
      phase: 'committing', run_id: runId, module: 'core',
      targets: [{ target_path: T1, old_sha256: null, new_sha256: sha256(docByKeys([K1])), applied: true }],
      index: { yaml_backup_path: join(backupDir(root, runId), 'x.bak'), old_yaml_sha256: null },
      state_transition: { from: 'partial', to: 'seeded' }, keys: [K1],
    };
    atomicWriteJson(journalPath(root, runId), journal);
  }

  it('F7: index 在提交进行中非零退出、报 baseline_commit_in_progress，不生成半提交索引', () => {
    stallCommit();
    con.errors.length = 0;
    expect(() => indexCommand()).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('baseline_commit_in_progress');
    expect(existsSync(join(root, 'logos/index-prompt.md'))).toBe(false);
  });

  it('F7: sync 在提交进行中非零退出、报 baseline_commit_in_progress，不迁移/索引资产', () => {
    stallCommit();
    con.errors.length = 0;
    expect(() => sync()).toThrow('process.exit(1)');
    expect(con.errors.join('\n')).toContain('baseline_commit_in_progress');
  });

  it('F7: status 在提交进行中先过门，返回 commit_in_progress、不据半集合派生有效状态', () => {
    stallCommit();
    const mod = collectStatusData(root).modules![0];
    expect(mod.baseline_coverage?.commit_in_progress).toBe(true);
  });
});
