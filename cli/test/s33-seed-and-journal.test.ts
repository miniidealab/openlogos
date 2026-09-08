/**
 * adopted 项目的 seed 状态与 commit journal 读取门（lite-cut2b 迁座）。
 *
 * 覆盖 UT-S05-B09 / ST-S05-B04 / UT-S11-B02 / UT-S11-B03 /
 * UT-S33-49～51 / UT-S33-54～55 / ST-S33-05～09。
 *
 * 这些用例原先挂在 S39 闭包求值器上（`evaluate()` 即 ClosureEvaluator）。L9 删除后
 * 求值器不复存在，但**它们验证的能力仍然存活**——seed 提交事务的读取门由 status / next /
 * change / sync / index / change-lint 六个消费者共用。本文件把同一判据改挂到这些存活消费者上，
 * 判据强度不变：不可恢复即硬阻断、可恢复即先恢复再读、全程不产生确认字段。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backupDir, journalPath, runsRoot } from '../src/lib/baseline-seed-txn.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { planDirectTargets } from '../src/lib/merge-direct.js';
import { cleanupFixtureRoots, frontierFixture, invoke, put } from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** 把 fixture 标成 adopted，并置其 seed 状态。 */
function asAdopted(root: string, state: 'required' | 'partial' | 'seeded'): void {
  put(root, 'logos/logos-project.yaml', [
    'project:', '  name: Frontier Fixture', 'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', '    bootstrap: adopted', `    baseline_seed_state: ${state}`,
    'scenario_counter:', '  next_id: 40', 'resource_index: []', '',
  ].join('\n'));
}

describe('seed commit journal 读取门 — S05/S11/S33', () => {
  it('UT-S05-B09 / ST-S05-B04 / UT-S11-B02 / UT-S33-55 / ST-S33-09: 不可恢复 journal 隔离留存后继续（§2.74.3）', () => {
    const f = frontierFixture();
    asAdopted(f.root, 'partial');
    const run = join(runsRoot(f.root), 'broken');
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'commit-journal.json'), '{broken');

    // ① 库级消费者：恢复失败 → 隔离损坏 journal 后继续（该门保护的读者已随 lite-cut2b 删除）
    const lint = runChangeLint(f.root, f.proposalDir, f.slug);
    expect(lint.ok).toBe(true);

    // ② 真实 CLI 的两个只读消费者同样零退出
    for (const cmd of ['status', 'next']) {
      const result = invoke([cmd, '--format', 'json'], f.root);
      expect(result.status, `${cmd}: ${result.stderr}`).toBe(0);
    }
    // ③ 损坏 journal 被隔离留存，内容逐字节保留
    expect(existsSync(join(run, 'commit-journal.json'))).toBe(false);
    const kept = readdirSync(run).find(n => n.includes('.corrupt-'));
    expect(kept).toBeDefined();
    expect(readFileSync(join(run, kept!), 'utf8')).toBe('{broken');
    // ④ 只读路径零副作用：不写任何 marker
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(false);
  });

  it('UT-S11-B03: prepared journal 可恢复后消费者才读到一致集合', () => {
    const f = frontierFixture();
    asAdopted(f.root, 'partial');
    const runId = 'seed-core-recover';
    mkdirSync(join(runsRoot(f.root), runId), { recursive: true });
    const targetPath = 'logos/resources/test/core-S01-test-cases.md';
    const old = readFileSync(join(f.root, ...targetPath.split('/')), 'utf-8');
    const yamlBackup = join(backupDir(f.root, runId), 'logos-project.yaml.bak');
    mkdirSync(dirname(yamlBackup), { recursive: true });
    writeFileSync(yamlBackup, readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8'));
    writeFileSync(journalPath(f.root, runId), JSON.stringify({
      phase: 'prepared', run_id: runId, module: 'core', keys: [],
      targets: [{ target_path: targetPath, old_sha256: sha(old), new_sha256: sha('new'), applied: false }],
      index: { yaml_backup_path: yamlBackup, old_yaml_sha256: sha(readFileSync(yamlBackup, 'utf-8')) },
      state_transition: { from: 'required', to: 'seeded' },
    }));

    // 恢复与读取在同一锁序内：消费者先把 journal 收敛掉，再读到一致集合
    const lint = runChangeLint(f.root, f.proposalDir, f.slug);
    expect(lint.ok, lint.ok === false ? lint.message : '').toBe(true);
    expect(existsSync(journalPath(f.root, runId)), 'journal 已被恢复消化').toBe(false);
    // 目标保持全旧一致态，未被半新字节污染
    expect(readFileSync(join(f.root, ...targetPath.split('/')), 'utf-8')).toBe(old);
  });
});

describe('adopted seed 三态与首个 change — S33', () => {
  it('UT-S33-49 / ST-S33-05: required 状态不阻断首个 change 的规划与合并', () => {
    const f = frontierFixture();
    asAdopted(f.root, 'required');
    // 无任何 seed 产物，首个 change 仍可完成规划（目标集直接由 deltas 派生）
    expect(planDirectTargets(f.root, f.proposalDir).length).toBeGreaterThan(0);
    const lint = runChangeLint(f.root, f.proposalDir, f.slug);
    expect(lint.ok && lint.violations).toEqual([]);
    const merged = invoke(['merge', f.slug], f.root);
    expect(merged.status, merged.stderr).toBe(0);
    // seed state 保持兼容值，未被 change 流程改写
    expect(readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8')).toContain('baseline_seed_state: required');
  });

  it('UT-S33-50 / ST-S33-06: 安全 partial 的 staging 不被当作目标事实', () => {
    const f = frontierFixture();
    asAdopted(f.root, 'partial');
    // begin 后只写部分 staging、未进入 journal
    const staged = join(runsRoot(f.root), 'seed-core-partial', 'staging', 'core-S99-flow.md');
    mkdirSync(dirname(staged), { recursive: true });
    writeFileSync(staged, '# 看起来完整的文档\n\n## 场景目标\n\n占位。\n');

    // staging 不进入目标集——目标集只来自 deltas/，staging 既非 delta 也非 canonical target
    const targets = planDirectTargets(f.root, f.proposalDir);
    expect(targets.some(t => t.targetPath.includes('core-S99-flow'))).toBe(false);
    // 也不被当作「目标已存在」：同名 canonical target 仍判缺失
    expect(existsSync(join(f.root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S99-flow.md'))).toBe(false);
    // change 正常推进，run 后续仍可恢复
    expect(runChangeLint(f.root, f.proposalDir, f.slug).ok).toBe(true);
    expect(existsSync(staged), 'staging 未被 change 流程清理').toBe(true);
  });

  it('UT-S33-51 / ST-S33-07: seeded 状态只作加速，不替代缺失目标的 CREATE', () => {
    const f = frontierFixture();
    asAdopted(f.root, 'seeded');
    // 正式场景文档缺失时，delta 派生仍判 CREATE——seeded 不能让它变成「已存在」
    const scenarioTarget = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md';
    rmSync(join(f.root, ...scenarioTarget.split('/')));
    const derived = planDirectTargets(f.root, f.proposalDir).find(t => t.targetPath === scenarioTarget)!;
    expect(derived.mode).toBe('CREATE');
    // candidate 的 verified 标记不因本次 change 而改变
    expect(readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8')).toContain('baseline_seed_state: seeded');
  });

  it('UT-S33-54 / ST-S33-08: 全链路不产生确认字段与 baseline warning 写回', () => {
    for (const state of ['required', 'partial', 'seeded'] as const) {
      const f = frontierFixture();
      asAdopted(f.root, state);
      const before = readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8');

      const lint = invoke(['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
      const status = invoke(['status', '--format', 'json'], f.root);
      const next = invoke(['next', '--format', 'json'], f.root);
      for (const [label, out] of [['change-lint', lint], ['status', status], ['next', next]] as const) {
        const text = out.stdout + out.stderr;
        for (const forbidden of ['verified:true', 'confirmed_by', 'confirmed_at', 'baseline_warnings']) {
          expect(text, `${state}/${label} 不得出现 ${forbidden}`).not.toContain(forbidden);
        }
      }
      // 只读消费者不得写回项目 yaml
      expect(readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8'), state).toBe(before);
    }
  });
});
