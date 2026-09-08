/**
 * S39 delta→canonical target 派生（lite-cut2b-remove-baseline-closure）。
 *
 * 覆盖 UT-S39-68 / UT-S39-69 / ST-S39-30，对应功能规格 §2.71。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { planDirectTargets, MergeDirectError } from '../src/lib/merge-direct.js';
import { cleanupFixtureRoots, frontierFixture, invoke, put } from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

/** 与 frontierFixture 的四个 MODIFY delta 对应的 canonical target。 */
const FIXTURE_TARGETS = [
  'logos/resources/prd/1-product-requirements/core-01-requirements.md',
  'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md',
  'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md',
  'logos/resources/test/core-S01-test-cases.md',
];

describe('merge 目标集由 delta 文件派生 — S39（§2.71）', () => {
  it('UT-S39-68: 目标集 = deltas 的无逻辑投影，不读 proposal 任何 YAML', () => {
    const f = frontierFixture();

    // ① 目标集与 delta 一一对应
    const targets = planDirectTargets(f.root, f.proposalDir);
    expect(targets.map(t => t.targetPath).sort()).toEqual([...FIXTURE_TARGETS].sort());
    expect(targets.every(t => t.mode === 'MODIFY'), '四个目标均已存在 → MODIFY').toBe(true);

    // ② 注入一段与之矛盾的历史 baseline_closure 块：结果必须逐字段不变
    const proposalPath = join(f.proposalDir, 'proposal.md');
    const original = readFileSync(proposalPath, 'utf8');
    writeFileSync(proposalPath, `${original}\n\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  policy: on-touch-v1\n  schema_version: 1\n  touched_scenario_ids: [S01, S02, S03]\n  targets:\n    - category: test\n      delta_path: "deltas/test/ghost-1.md"\n    - category: test\n      delta_path: "deltas/test/ghost-2.md"\n\`\`\`\n`);
    expect(planDirectTargets(f.root, f.proposalDir)).toEqual(targets);

    // ③ 注入语法非法的 YAML：仍不影响——证明该块根本未被解析
    writeFileSync(proposalPath, `${original}\n\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  targets: [unclosed\n   : : :\n\`\`\`\n`);
    expect(planDirectTargets(f.root, f.proposalDir)).toEqual(targets);

    // ④ CREATE 由磁盘事实判定：删掉一个目标后同一 delta 派生为 CREATE
    writeFileSync(proposalPath, original);
    rmSync(join(f.root, ...FIXTURE_TARGETS[3].split('/')));
    const afterDelete = planDirectTargets(f.root, f.proposalDir);
    const testTarget = afterDelete.find(t => t.targetPath === FIXTURE_TARGETS[3])!;
    expect(testTarget.mode).toBe('CREATE');
  });

  it('UT-S39-69: 不可映射的 delta 在写入前 fail-closed', () => {
    const cases: Array<{ label: string; setup: (f: ReturnType<typeof frontierFixture>) => void }> = [
      {
        label: '未知类别目录',
        setup: f => put(f.root, `logos/changes/${f.slug}/deltas/bogus/x.md`, '## ADDED — X\n\n正文。\n'),
      },
      {
        label: '上跳路径',
        setup: f => put(f.root, `logos/changes/${f.slug}/deltas/test/../../../escape.md`, '## ADDED — X\n\n正文。\n'),
      },
      {
        label: 'symlink 越界',
        setup: f => {
          const outside = join(f.root, 'outside.md');
          writeFileSync(outside, '## ADDED — X\n\n正文。\n');
          symlinkSync(outside, join(f.proposalDir, 'deltas', 'test', 'linked.md'));
        },
      },
    ];

    for (const { label, setup } of cases) {
      const f = frontierFixture();
      const before = new Map(FIXTURE_TARGETS.map(t => {
        const abs = join(f.root, ...t.split('/'));
        return [t, `${readFileSync(abs, 'utf8')}::${statSync(abs).mtimeMs}`];
      }));
      setup(f);

      let caught: unknown = null;
      try { planDirectTargets(f.root, f.proposalDir); } catch (e) { caught = e; }
      // 未知类别与越界路径由分类器判为不可 merge 或由映射判 null——两者都必须在写入前停下
      const cli = invoke(['merge', f.slug], f.root);
      if (caught === null) {
        // 分类器已把它过滤为不可 merge：目标集不得包含任何越界目标
        const targets = planDirectTargets(f.root, f.proposalDir);
        expect(targets.every(t => t.targetPath.startsWith('logos/resources/') || t.targetPath.startsWith('spec/')),
          `${label}：不得产生越界目标`).toBe(true);
      } else {
        expect(caught, label).toBeInstanceOf(MergeDirectError);
        expect(cli.status, `${label}：CLI 必须非零退出`).not.toBe(0);
        // 失败路径零副作用
        for (const [t, snapshot] of before) {
          const abs = join(f.root, ...t.split('/'));
          expect(`${readFileSync(abs, 'utf8')}::${statSync(abs).mtimeMs}`, `${label} / ${t}`).toBe(snapshot);
        }
        expect(existsSync(join(f.proposalDir, 'SPEC_MERGED')), `${label}：不得写 SPEC_MERGED`).toBe(false);
      }
    }
  });

  it('ST-S39-30: 真实 CLI 下无 baseline_closure 的提案全链通过', () => {
    const f = frontierFixture();
    // 前置：proposal 完全不含基线闭包计划
    expect(readFileSync(join(f.proposalDir, 'proposal.md'), 'utf8')).not.toContain('基线闭包计划');
    expect(readFileSync(join(f.proposalDir, 'proposal.md'), 'utf8')).not.toContain('baseline_closure');

    // ① change-lint：检查项编号上界为 8、无 L9 行，envelope 无 baseline_closure
    const lintText = invoke(['change-lint', '--slug', f.slug], f.root);
    expect(lintText.status, lintText.stderr).toBe(0);
    expect(lintText.stdout).not.toMatch(/^\s*[✓✗] L9 /m);
    const shown = [...lintText.stdout.matchAll(/^\s*[✓✗] L(\d+) /gm)].map(m => Number(m[1]));
    expect(Math.max(...shown)).toBeLessThanOrEqual(8);
    const lintJson = invoke(['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
    const envelope = JSON.parse(lintJson.stdout.trim().split('\n').pop()!);
    expect(envelope.data.pass).toBe(true);
    expect(envelope.data.baseline_closure).toBeUndefined();

    // ② merge 一次调用成功
    const merged = invoke(['merge', f.slug], f.root);
    expect(merged.status, merged.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);

    // ③ 各 canonical target 落到最终态
    for (const [target, final] of Object.entries(f.finals)) {
      expect(readFileSync(join(f.root, ...target.split('/')), 'utf8'), target).toBe(final);
    }
  });
});
