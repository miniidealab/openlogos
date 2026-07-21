import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeTempRoot, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { next } from '../src/commands/next.js';
import { collectStatusData } from '../src/commands/status.js';
import { baselineSeedStatus } from '../src/commands/baseline-seed.js';
import {
  runRecordPath, lockPath, journalPath, backupDir, sha256, atomicWriteJson,
  type CommitJournal,
} from '../src/lib/baseline-seed-txn.js';
import { candidateKey } from '../src/lib/baseline-provenance.js';
import { effectiveBaselineSeedState } from '../src/lib/baseline-jit.js';
import { migrateBaselineProvenance } from '../src/lib/migrate-lifecycle.js';
import { withRecoveredReadLocks, listProjectModuleIds } from '../src/lib/baseline-seed-txn.js';
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

/**
 * baseline-seed-legacy-default-unify：legacy adopted（yaml 无 baseline_seed_state 字段）缺省语义
 * 三入口统一（唯一事实源 effectiveBaselineSeedState）+ status JSON 契约恒输出 + sync 迁移落盘。
 * 切片1 覆盖 UT-S33-41、UT-S33-42、UT-S33-43、UT-S33-46、UT-S33-47、UT-S33-48；切片2 覆盖 UT-S33-44、UT-S33-45。
 */

const T1 = 'logos/resources/prd/core-system-map.md';
const A1 = 'cli:one';
const K1 = candidateKey('core', A1);

/** legacy 夹具：adopted、无 baseline_seed_state 字段、无旧布尔。extraModules 追加多模块场景。 */
function setupLegacyAdopted(root: string, extraModules = '') {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n${extraModules}`);
}

function setupExplicitAdopted(root: string, state: 'required' | 'partial' | 'seeded') {
  mkdirSync(join(root, 'logos/resources/prd'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
  writeFileSync(join(root, 'logos/logos-project.yaml'),
    `modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: ${state}\n`);
}

function candidateDoc(key = K1, anchor = A1) {
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n  - key: "${key}"\n    anchor: "${anchor}"\n    state: active\n    verified: false\n\`\`\`\n`;
}

function writeOpenRun(root: string, runId = 'seed-core-0001') {
  const rec = { run_id: runId, module: 'core', status: 'open', expected: [], created_at: '2026-07-21T00:00:00Z', issued_nonce: 'n1' };
  mkdirSync(dirname(runRecordPath(root, runId)), { recursive: true });
  atomicWriteJson(runRecordPath(root, runId), rec);
}

/** 提交进行中：committing journal + 锁被存活进程（pid=1）占用 → 读锁不可得。 */
function stallCommit(root: string): void {
  const runId = 'seed-core-0001';
  mkdirSync(dirname(lockPath(root, 'core')), { recursive: true });
  writeFileSync(lockPath(root, 'core'), JSON.stringify({ pid: 1, at: Date.now() }));
  writeFileSync(join(root, T1), candidateDoc());
  const journal: CommitJournal = {
    phase: 'committing', run_id: runId, module: 'core',
    targets: [{ target_path: T1, old_sha256: null, new_sha256: sha256(candidateDoc()), applied: true }],
    index: { yaml_backup_path: join(backupDir(root, runId), 'x.bak'), old_yaml_sha256: null },
    state_transition: { from: 'partial', to: 'seeded' }, keys: [K1],
  };
  atomicWriteJson(journalPath(root, runId), journal);
}

describe('S33 legacy 缺省语义三入口统一（baseline-seed-legacy-default-unify 切片1）', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });
  afterEach(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); cleanup(); });

  async function triEntryStates(): Promise<{ nextState: string; nextDetail: string; statusState: string | undefined; statusSuggestion: string; seedState: string; seedText: string }> {
    con.logs.length = 0;
    await next('json');
    const nextData = JSON.parse(con.logs[0]).data;
    const nextMod = nextData.modules[0];

    const statusMod = collectStatusData(root).modules![0];

    con.logs.length = 0;
    baselineSeedStatus('core', 'json');
    const seedData = JSON.parse(con.logs[0]).data;

    con.logs.length = 0;
    baselineSeedStatus('core', 'text');
    const seedText = con.logs.join('\n');

    return {
      nextState: nextMod.baseline_seed_state,
      nextDetail: `${nextMod.action} ${nextMod.detail}`,
      statusState: statusMod.baseline_seed_state,
      statusSuggestion: statusMod.suggestion,
      seedState: seedData.baseline_seed_state,
      seedText,
    };
  }

  it('UT-S33-41: 三入口一致性——legacy 无候选 → required，三者逐字节一致且均附 legacy sync 迁移提示', async () => {
    setupLegacyAdopted(root);
    const r = await triEntryStates();
    expect(r.nextState).toBe('required');
    expect(r.statusState).toBe('required');
    expect(r.seedState).toBe('required');
    // 三入口逐字节一致（单一事实源）
    expect(new Set([r.nextState, r.statusState, r.seedState]).size).toBe(1);
    // next 引导逆向建基线 + legacy 迁移提示
    expect(r.nextDetail).toContain('逆向建立现状基线');
    expect(r.nextDetail).toContain('openlogos sync');
    // status 引导 + legacy 迁移提示
    expect(r.statusSuggestion).toContain('逆向建立现状基线');
    expect(r.statusSuggestion).toContain('openlogos sync');
    // baseline-seed status（text）附 legacy 迁移提示
    expect(r.seedText).toContain('openlogos sync');
  });

  it('UT-S33-42: 三入口一致性——legacy 有候选（无 open run）→ seeded，展示覆盖率并引导正常迭代', async () => {
    setupLegacyAdopted(root);
    writeFileSync(join(root, T1), candidateDoc());
    const r = await triEntryStates();
    expect(r.nextState).toBe('seeded');
    expect(r.statusState).toBe('seeded');
    expect(r.seedState).toBe('seeded');
    expect(new Set([r.nextState, r.statusState, r.seedState]).size).toBe(1);
    expect(r.statusSuggestion).toContain('openlogos change');
    expect(r.statusSuggestion).toContain('现状基线已建立');
  });

  it('UT-S33-43: 三入口一致性——legacy 有候选 + open run → partial（与状态机「扫描中断」对齐），引导恢复入口', async () => {
    setupLegacyAdopted(root);
    writeFileSync(join(root, T1), candidateDoc());
    writeOpenRun(root);
    const r = await triEntryStates();
    expect(r.nextState).toBe('partial');
    expect(r.statusState).toBe('partial');
    expect(r.seedState).toBe('partial');
    expect(new Set([r.nextState, r.statusState, r.seedState]).size).toBe(1);
    // 无 guard 前提：主引导指向恢复入口
    expect(r.statusSuggestion).toContain('baseline-seed');
    const statusMod = collectStatusData(root).modules![0];
    expect(statusMod.baseline_coverage?.incomplete).toBe(true);
  });

  it('UT-S33-46: 契约恒输出——adopted 模块矩阵恒含合法枚举；非 adopted 模块行为不变', () => {
    // explicit 三档
    for (const state of ['required', 'partial', 'seeded'] as const) {
      setupExplicitAdopted(root, state);
      const mod = collectStatusData(root).modules![0];
      expect(mod.baseline_seed_state).toBe(state);
    }
    // legacy 两档（无候选 / 有候选）
    setupLegacyAdopted(root);
    expect(collectStatusData(root).modules![0].baseline_seed_state).toBe('required');
    writeFileSync(join(root, T1), candidateDoc());
    expect(collectStatusData(root).modules![0].baseline_seed_state).toBe('seeded');
    // 多模块：非 adopted launched 模块不输出该字段（行为不变）
    setupLegacyAdopted(root, '  - id: web\n    name: Web\n    lifecycle: launched\n');
    const mods = collectStatusData(root).modules!;
    const webMod = mods.find(m => m.id === 'web')!;
    expect(webMod.baseline_seed_state).toBeUndefined();
    const coreMod = mods.find(m => m.id === 'core')!;
    expect(['required', 'partial', 'seeded']).toContain(coreMod.baseline_seed_state);
  });

  it('UT-S33-47: commit-in-progress 降级分支仍恒输出（legacy 无字段 → 保守兜底 partial）', () => {
    setupLegacyAdopted(root);
    stallCommit(root);
    const mod = collectStatusData(root).modules![0];
    // 降级 suggestion + 字段仍在且为合法枚举（不因原始字段缺失而缺字段）
    expect(mod.suggestion).toContain('提交进行中');
    expect(['required', 'partial', 'seeded']).toContain(mod.baseline_seed_state);
    expect(mod.baseline_seed_state).toBe('partial');
    // helper 直测：锁占用 → 保守兜底 + commit_in_progress 信号
    const eff = effectiveBaselineSeedState(root, 'core');
    expect(eff).toEqual({ state: 'partial', legacy: true, commit_in_progress: true });
  });

  it('UT-S33-48: 回归——unknown 不再出现于任何 JSON 输出；活跃提案下 adopted 仍恒输出字段', async () => {
    // 覆盖两档 legacy 夹具的三命令 JSON 全集
    for (const withCandidates of [false, true]) {
      setupLegacyAdopted(root);
      if (withCandidates) writeFileSync(join(root, T1), candidateDoc());
      con.logs.length = 0;
      await next('json');
      baselineSeedStatus('core', 'json');
      const outputs = [...con.logs, JSON.stringify(collectStatusData(root))].join('\n');
      expect(outputs).not.toContain('"baseline_seed_state":"unknown"');
      expect(outputs).not.toContain('"state":"unknown"');
    }
    // 活跃提案（guard 归属 core）：adopted 模块 status 仍恒输出字段（旧实现此路径缺字段）
    setupLegacyAdopted(root);
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core', createdAt: '2026-07-21T00:00:00Z' }));
    const dir = join(root, 'logos/changes/feat');
    mkdirSync(join(dir, 'deltas'), { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), '# 变更提案：feat\n\n## 部署影响\n- 是否需要部署：否\n\n## 变更概述\n真实提案，非模板。\n');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [ ] 写 delta\n');
    const mod = collectStatusData(root).modules![0];
    expect(['required', 'partial', 'seeded']).toContain(mod.baseline_seed_state);
  });

  // ---- 切片2：sync 迁移落盘（migrateBaselineProvenance 即 sync 在全模块读锁区间内调用的迁移入口）----

  /** 与 sync 相同的调用语境：全模块读锁区间内执行迁移（migrate 内派生 assumeLocked 复用）。 */
  function runMigrationLikeSync(r: string) {
    const res = withRecoveredReadLocks(r, new Date().toISOString(), listProjectModuleIds(r),
      () => migrateBaselineProvenance(r));
    expect(res.ok).toBe(true);
    return (res as { ok: true; value: ReturnType<typeof migrateBaselineProvenance> }).value;
  }

  function readYamlModule(r: string, id = 'core'): Record<string, unknown> {
    const yaml = parseYaml(readFileSync(join(r, 'logos/logos-project.yaml'), 'utf-8'));
    return (yaml.modules as Array<Record<string, unknown>>).find(m => m.id === id)!;
  }

  it('UT-S33-44: sync 迁移落盘——两档派生值写入显式枚举 + changes 记录派生依据 + 幂等（含历史 skipped 兼容）', () => {
    // ①无候选 → required
    setupLegacyAdopted(root);
    const r1 = runMigrationLikeSync(root);
    expect(r1.migrated).toBe(true);
    expect(r1.changes.join('\n')).toContain('core: baseline_seed_state 缺省 → required（派生：无逆向候选）');
    expect(readYamlModule(root)['baseline_seed_state']).toBe('required');
    // 幂等：再跑一次无变更、不重复落盘
    const r1b = runMigrationLikeSync(root);
    expect(r1b.migrated).toBe(false);
    expect(r1b.changes).toEqual([]);

    // ②有候选（无 open run）→ seeded；bootstrap 用历史 skipped 覆盖兼容读取
    writeFileSync(join(root, 'logos/logos-project.yaml'),
      'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: skipped\n');
    writeFileSync(join(root, T1), candidateDoc());
    const r2 = runMigrationLikeSync(root);
    expect(r2.migrated).toBe(true);
    expect(r2.changes.join('\n')).toContain('core: baseline_seed_state 缺省 → seeded（派生：有逆向候选）');
    expect(readYamlModule(root)['baseline_seed_state']).toBe('seeded');
    // 写前备份存在
    expect(r2.backupPath).toBeTruthy();
  });

  it('UT-S33-45: sync 迁移——显式值不覆盖；布尔 true→required 不回归；布尔 false 移除后按派生落盘（不再空转）', () => {
    // ①已有显式值 partial → 不覆盖、无变更
    setupExplicitAdopted(root, 'partial');
    const r1 = runMigrationLikeSync(root);
    expect(r1.migrated).toBe(false);
    expect(readYamlModule(root)['baseline_seed_state']).toBe('partial');

    // ②历史布尔 true → required（既有迁移行为不回归），布尔被移除
    writeFileSync(join(root, 'logos/logos-project.yaml'),
      'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_required: true\n');
    const r2 = runMigrationLikeSync(root);
    expect(r2.migrated).toBe(true);
    expect(r2.changes.join('\n')).toContain('baseline_seed_required(true) → baseline_seed_state: required');
    const m2 = readYamlModule(root);
    expect(m2['baseline_seed_state']).toBe('required');
    expect(m2['baseline_seed_required']).toBeUndefined();

    // ③历史布尔 false → 移除布尔后按无字段走派生落盘（此前「不推断」空转形成死角）
    writeFileSync(join(root, 'logos/logos-project.yaml'),
      'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_required: false\n');
    const r3 = runMigrationLikeSync(root);
    expect(r3.migrated).toBe(true);
    expect(r3.changes.join('\n')).toContain('移除历史布尔 baseline_seed_required(false)');
    expect(r3.changes.join('\n')).toContain('core: baseline_seed_state 缺省 → required（派生：无逆向候选）');
    const m3 = readYamlModule(root);
    expect(m3['baseline_seed_state']).toBe('required');
    expect(m3['baseline_seed_required']).toBeUndefined();
  });
});
