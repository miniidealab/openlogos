/**
 * S39 勘误散文订正通道实现验收（closeout-deferred-errata-and-closure-gap）。
 * 覆盖 UT-S39-65～UT-S39-67、ST-S39-29；用例名中的逐条 ID 由全局 OpenLogos reporter
 * 写入 test-results.jsonl。权威判据：spec/baseline-closure.md §7.1、功能规格 §2.57。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  canonicalTargetFromDeltaPath,
  evaluateBaselineClosure,
  type BaselineClosureCategory,
} from '../src/lib/baseline-closure.js';
import { classifyProposalDeltas } from '../src/lib/delta-classify.js';
import { withCompleteClarification } from './helpers.js';

type Mode = 'MODIFY' | 'CREATE' | 'SKIP' | 'AMBIGUOUS';
interface RawTarget {
  category: BaselineClosureCategory;
  scenario_ids: string[];
  mode: Mode;
  delta_path: string | null;
  reason: string;
  evidence: string[];
  missing_evidence: string[];
}

interface Fixture {
  root: string;
  proposalDir: string;
  slug: string;
  closure: Record<string, unknown> & { touched_scenario_ids: string[]; targets: RawTarget[] };
}

const roots: string[] = [];
const CLI_DIST = join(process.cwd(), 'dist/index.js');
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

const SMOKE_TARGET = [
  '# smoke 规格', '', '## 冒烟规格', '',
  '| ID | 场景 |', '|---|---|', '| SMOKE-core-1 | 既有断言（旧口径散文） |', '',
  '既有散文说明。',
].join('\n') + '\n';

const DEPLOY_TARGET = [
  '# 部署方案', '', '## 部署矩阵', '',
  '旧口径散文行：与既有权威语义相矛盾的表述。',
].join('\n') + '\n';

const SMOKE_ERRATA_DELTA = [
  '## MODIFIED — 冒烟规格', '',
  '| ID | 场景 |', '|---|---|', '| SMOKE-core-1 | 既有断言（订正后的正确口径散文） |', '',
  '订正后的散文说明。',
].join('\n') + '\n';

const DEPLOY_ERRATA_DELTA = [
  '## MODIFIED — 部署矩阵', '',
  '订正后的散文行：与既有权威语义一致的表述。',
].join('\n') + '\n';

function materialDelta(category: string): string {
  return `## MODIFIED — 最终态\n\n${category} 已更新。\n`;
}

/** docs-only 勘误提案夹具：deployment_required=false + deployment/smoke MODIFY 散文订正 target。 */
function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-errata-'));
  roots.push(root);
  const slug = 'errata-fixture';
  const proposalDir = join(root, 'logos/changes', slug);
  mkdirSync(proposalDir, { recursive: true });
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 'errata', locale: 'zh' }));
  writeFileSync(join(root, 'logos/logos-project.yaml'), [
    'project:', '  name: errata', 'tech_stack:', '  database: sqlite', 'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', '    bootstrap: normal', '    product_type: cli',
  ].join('\n'));
  writeFileSync(join(root, 'logos/.openlogos-guard'), `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  const material: Array<[BaselineClosureCategory, string]> = [
    ['requirement', 'deltas/prd/1-product-requirements/core-req.md'],
    ['feature', 'deltas/prd/2-product-design/1-feature-specs/core-feature.md'],
    ['architecture', 'deltas/prd/3-technical-plan/1-architecture/core-arch.md'],
    ['scenario', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S39.md'],
    ['test', 'deltas/test/core-S39-test-cases.md'],
    ['deployment', 'deltas/prd/3-technical-plan/3-deployment/core-deploy.md'],
    ['smoke', 'deltas/test/smoke/core-smoke.md'],
  ];
  const targets: RawTarget[] = material.map(([category, delta_path]) => ({
    category, scenario_ids: ['S39'], mode: 'MODIFY', delta_path,
    reason: category === 'deployment' || category === 'smoke'
      ? `${category} 散文订正（§7.1 errata 例外：仅 MODIFIED、ID 守恒相等）。`
      : `${category} 由 S39 触达并需要最终态更新。`,
    evidence: [`target_exists: ${canonicalTargetFromDeltaPath(delta_path)}`], missing_evidence: [],
  }));
  for (const category of ['api', 'database', 'orchestration'] as BaselineClosureCategory[]) {
    targets.push({
      category, scenario_ids: ['S39'], mode: 'SKIP', delta_path: null,
      reason: `${category} 经场景证据判定不适用。`, evidence: ['scenario:S39#evidence'], missing_evidence: [],
    });
  }
  const sorted = [
    ...targets.filter(t => t.delta_path !== null).sort((a, b) => a.delta_path!.localeCompare(b.delta_path!, 'en')),
    ...targets.filter(t => t.delta_path === null).sort((a, b) => a.category.localeCompare(b.category, 'en')),
  ];
  const closure = {
    policy: 'on-touch-v1', schema_version: 1, unit: 'canonical-merge-target-path',
    delta_cardinality: 'exactly-one-per-non-skip-target',
    effective_view: 'merged-resources-plus-current-change-deltas',
    ambiguity: 'block-before-existing-plan-exit', standalone_baseline_required: false,
    jit_confirmation: 'disabled', touched_scenario_ids: ['S39'], targets: sorted,
  };
  const fixture: Fixture = { root, proposalDir, slug, closure };
  for (const target of sorted) {
    if (!target.delta_path) continue;
    const targetPath = canonicalTargetFromDeltaPath(target.delta_path)!;
    mkdirSync(dirname(join(root, targetPath)), { recursive: true });
    const bytes = target.category === 'smoke' ? SMOKE_TARGET
      : target.category === 'deployment' ? DEPLOY_TARGET
        : `# ${target.category}\n\n## 最终态\n\n既有最终态。\n`;
    writeFileSync(join(root, targetPath), bytes);
  }
  writeFixture(fixture, true, true);
  return fixture;
}

function deltaBytes(target: RawTarget): string {
  if (target.category === 'smoke') return SMOKE_ERRATA_DELTA;
  if (target.category === 'deployment') return DEPLOY_ERRATA_DELTA;
  return materialDelta(target.category);
}

function writeFixture(f: Fixture, checked: boolean, withDeltas: boolean, overrides = new Map<string, string>()): void {
  writeFileSync(join(f.proposalDir, 'proposal.md'), withCompleteClarification([
    '# 变更提案', '', '> module: core', '', '## 基线闭包计划', '',
    '```yaml', stringifyYaml({ baseline_closure: f.closure }).trimEnd(), '```', '',
    '## 变更类型', '设计级（docs-only 勘误）', '', '## 部署影响', '- 是否需要部署：否（勘误不产生新字节）', '- 部署原因：纯散文订正',
    '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否（无部署）',
  ].join('\n')));
  const material = f.closure.targets.filter(t => t.delta_path !== null);
  const tasks = material.map(t => `- [${checked ? 'x' : ' '}] [${t.mode}] \`${t.delta_path}\`：${t.reason}`).join('\n');
  writeFileSync(join(f.proposalDir, 'tasks.md'), `# 任务\n\n## [delta] 规格变更\n\n${tasks}\n\n## [code] 代码实现\n`);
  if (!withDeltas) return;
  for (const target of material) {
    const path = join(f.proposalDir, target.delta_path!);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, overrides.get(target.delta_path!) ?? deltaBytes(target));
  }
}

function evaluate(f: Fixture) {
  const proposalContent = readFileSync(join(f.proposalDir, 'proposal.md'), 'utf-8');
  const tasksContent = readFileSync(join(f.proposalDir, 'tasks.md'), 'utf-8');
  const entries = classifyProposalDeltas(f.proposalDir);
  const contents = new Map<string, string>();
  for (const e of entries) {
    if (e.contentProbeEligible) contents.set(e.relativePath, readFileSync(join(f.proposalDir, e.relativePath), 'utf-8'));
  }
  return evaluateBaselineClosure({
    root: f.root, proposalDir: f.proposalDir, slug: f.slug,
    proposalContent, tasksContent, deltaEntries: entries, deltaContents: contents,
  });
}

function dispositionViolations(f: Fixture) {
  return evaluate(f).violations.filter(v => v.message.includes('disposition 与 proposal 决策不一致'));
}

function targetOf(f: Fixture, category: BaselineClosureCategory): RawTarget {
  return f.closure.targets.find(t => t.category === category)!;
}

function lintCli(f: Fixture) {
  const r = spawnSync(process.execPath, [CLI_DIST, 'change-lint', '--slug', f.slug, '--format', 'json'], {
    cwd: f.root, encoding: 'utf8', timeout: 60_000,
  });
  const raw = `${r.stdout}\n${r.stderr}`.trim();
  return { status: r.status, raw };
}

describe('S39 勘误散文订正通道（§7.1 errata 例外）', () => {
  it('UT-S39-65: errata 散文订正放行矩阵——deployment/smoke 纯散文 MODIFY delta 在无需部署下放行', () => {
    // spec 阶段：delta 在场、仅 MODIFIED 块、ID 守恒相等 → 两维度 disposition 均放行
    const f = setup();
    const result = evaluate(f);
    expect(dispositionViolations(f)).toEqual([]);
    expect(result.violations).toEqual([]);
    // plan 阶段：delta 未产出 → 按 target 声明放行，delta 阶段收口
    const plan = setup();
    writeFixture(plan, false, false);
    expect(dispositionViolations(plan)).toEqual([]);
  });

  it('UT-S39-66: errata 判据不满足逐一 fail-closed，violation 可归因且不降级', () => {
    // ① target mode=CREATE（目标缺失）→ 拒绝
    const create = setup();
    const dep = targetOf(create, 'deployment');
    dep.mode = 'CREATE';
    unlinkSync(join(create.root, canonicalTargetFromDeltaPath(dep.delta_path!)!));
    writeFixture(create, true, true);
    const createViolations = dispositionViolations(create);
    expect(createViolations.length).toBeGreaterThan(0);
    expect(createViolations[0].message).toContain('CREATE 一律拒绝');

    // ② delta 含 ADDED 块（新增版本节）→ 拒绝
    const added = setup();
    writeFixture(added, true, true, new Map([[targetOf(added, 'smoke').delta_path!,
      `${SMOKE_ERRATA_DELTA}\n## ADDED — 新版本节\n\n新增内容。\n`]]));
    const addedViolations = dispositionViolations(added);
    expect(addedViolations.length).toBeGreaterThan(0);
    expect(addedViolations[0].message).toContain('只允许 MODIFIED 块');

    // ③ delta 含 REMOVED-ITEMS 声明块 → 拒绝（即使守恒点名合法）
    const removed = setup();
    writeFixture(removed, true, true, new Map([[targetOf(removed, 'smoke').delta_path!, [
      '## MODIFIED — 冒烟规格', '', '| ID | 场景 |', '|---|---|', '', '订正后的散文说明。', '',
      '## REMOVED-ITEMS — 冒烟规格', '- SMOKE-core-1 — 不再需要', '',
    ].join('\n')]]));
    const removedViolations = dispositionViolations(removed);
    expect(removedViolations.length).toBeGreaterThan(0);
    expect(removedViolations[0].message).toContain('REMOVED-ITEMS');

    // ④ MODIFIED 新增结构化测试 ID → 拒绝（守恒相等比一般 MODIFY 更严）
    const grown = setup();
    writeFixture(grown, true, true, new Map([[targetOf(grown, 'smoke').delta_path!, [
      '## MODIFIED — 冒烟规格', '', '| ID | 场景 |', '|---|---|',
      '| SMOKE-core-1 | 既有断言（订正） |', '| SMOKE-core-2 | 混入的新用例 |', '',
    ].join('\n')]]));
    const grownViolations = dispositionViolations(grown);
    expect(grownViolations.length).toBeGreaterThan(0);
    expect(grownViolations[0].message).toContain('SMOKE-core-2');

    // 全部违例 violation 均可归因：code/path/message/fix_hint 齐备，无降级
    for (const v of [...createViolations, ...addedViolations, ...removedViolations, ...grownViolations]) {
      expect(v.code).toBe('baseline_closure_target_missing');
      expect(v.path.length).toBeGreaterThan(0);
      expect(v.message.length).toBeGreaterThan(0);
      expect(v.fix_hint).toContain('§7.1');
    }

    // ⑤ 无需部署提案携带 [deploy] section → 既有部署决策一致性检查拒绝，语义零变化
    const deploySection = setup();
    const tasksPath = join(deploySection.proposalDir, 'tasks.md');
    writeFileSync(tasksPath, `${readFileSync(tasksPath, 'utf-8')}\n## [deploy] 部署任务\n\n- [ ] 执行部署\n`);
    const conflict = evaluate(deploySection).violations.filter(v => v.message.includes('部署决策与 tasks [deploy] 冲突'));
    expect(conflict.length).toBeGreaterThan(0);
  });

  it('UT-S39-67: 既有路径零回归——deployment_required=true 实质变更与全 SKIP 形态判定不变', () => {
    // ① deployment_required=true + deployment/smoke 实质 delta（含 ADDED 版本节）照常放行
    const material = setup();
    const proposalPath = join(material.proposalDir, 'proposal.md');
    writeFileSync(proposalPath, readFileSync(proposalPath, 'utf-8')
      .replace('- 是否需要部署：否（勘误不产生新字节）', '- 是否需要部署：是（受控发布）')
      .replace('- 是否需要 smoke：否（无部署）', '- 是否需要 smoke：是（发布后验证）'));
    const tasksPath = join(material.proposalDir, 'tasks.md');
    writeFileSync(tasksPath, `${readFileSync(tasksPath, 'utf-8')}\n## [deploy] 部署任务\n\n- [ ] 执行受控发布\n`);
    writeFileSync(join(material.proposalDir, targetOf(material, 'smoke').delta_path!),
      `${SMOKE_ERRATA_DELTA}\n## ADDED — 新版本 Smoke 节\n\n| ID | 场景 |\n|---|---|\n| SMOKE-core-2 | 新版本断言 |\n`);
    expect(dispositionViolations(material)).toEqual([]);

    // ② deployment_required=false + deployment/smoke 均 SKIP 的既有合法形态照常通过
    const skip = setup();
    for (const category of ['deployment', 'smoke'] as BaselineClosureCategory[]) {
      const target = targetOf(skip, category);
      rmSync(join(skip.proposalDir, target.delta_path!), { force: true });
      target.mode = 'SKIP';
      target.delta_path = null;
      target.evidence = ['proposal: deployment_required=false'];
    }
    skip.closure.targets = [
      ...skip.closure.targets.filter(t => t.delta_path !== null).sort((a, b) => a.delta_path!.localeCompare(b.delta_path!, 'en')),
      ...skip.closure.targets.filter(t => t.delta_path === null).sort((a, b) => a.category.localeCompare(b.category, 'en')),
    ];
    writeFixture(skip, true, true);
    expect(dispositionViolations(skip)).toEqual([]);
  });

  it('ST-S39-29: 真实 CLI errata 提案全链——合法形态 lint PASS 且 merge 准入放行，违例变体拒绝', () => {
    // 合法形态：真实 change-lint exit 0 → 真实 merge 生成事务（准入放行）
    const legal = setup();
    const lint = lintCli(legal);
    expect(lint.status, `合法 errata 提案 lint 必须 exit 0：${lint.raw.slice(0, 400)}`).toBe(0);
    const merged = spawnSync(process.execPath, [CLI_DIST, 'merge', legal.slug], {
      cwd: legal.root, encoding: 'utf8', timeout: 60_000,
    });
    expect(merged.status, `合法 errata 提案 merge 准入必须放行：${`${merged.stdout}${merged.stderr}`.slice(0, 400)}`).toBe(0);
    // 准入放行的物证：生成合并指令产物（0.14.x 事务或 test 环境 legacy prompt，二者其一）
    const mergeArtifact = existsSync(join(legal.proposalDir, 'MERGE_TRANSACTION.json'))
      || existsSync(join(legal.proposalDir, 'MERGE_PROMPT_GENERATED'));
    expect(mergeArtifact).toBe(true);

    // 违例变体：MODIFIED 新增 SMOKE ID → lint exit 2 且 violation 点名；merge 拒绝且零事务残留
    const rogue = setup();
    writeFixture(rogue, true, true, new Map([[targetOf(rogue, 'smoke').delta_path!, [
      '## MODIFIED — 冒烟规格', '', '| ID | 场景 |', '|---|---|',
      '| SMOKE-core-1 | 既有断言（订正） |', '| SMOKE-core-9 | 混入的新用例 |', '',
    ].join('\n')]]));
    const rogueLint = lintCli(rogue);
    expect(rogueLint.status).toBe(2);
    expect(rogueLint.raw).toContain('SMOKE-core-9');
    const rogueMerge = spawnSync(process.execPath, [CLI_DIST, 'merge', rogue.slug], {
      cwd: rogue.root, encoding: 'utf8', timeout: 60_000,
    });
    expect(rogueMerge.status).not.toBe(0);
    expect(existsSync(join(rogue.proposalDir, 'MERGE_TRANSACTION.json'))).toBe(false);
    expect(existsSync(join(rogue.proposalDir, 'MERGE_PROMPT_GENERATED'))).toBe(false);
  });
});
