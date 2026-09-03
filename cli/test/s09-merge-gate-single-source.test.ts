/**
 * 切片2：merge 准入判定与 change-lint 同源 + 门禁阶段可满足性元测试。
 * 覆盖 UT-S09-283、UT-S09-284、UT-S09-285、ST-S09-110、UT-S35-129。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { detectProposalStepViaFlow } from '../src/lib/flow-derive.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'gate-fixture';

interface Options {
  /** authority fact 的 tests；引用不存在 ID 时 change-lint 判 L10 违规 */
  tests?: string[];
  /** 是否携带 baseline_closure 声明——此前它决定 merge 要不要做预检 */
  closureSignal?: boolean;
  /** 是否产出 delta（plan 阶段的合法最小提案不含任何 delta） */
  withDelta?: boolean;
}

function impact(tests: string[]): string {
  return `## Authority Impact

\`\`\`yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [derived_projection]
  facts:
    - fact_id: core.gate-fixture
      change: create
      authority_ref: spec/gate-authority.md#registry
      authority_owner: GateFixtureEvaluator
      canonical_state: proposal authority impact
      sole_writer: approved delta merge
      mutation_entry: openlogos merge
      decision_api: AuthorityClosureEvaluator
      projections: [change-lint, next]
      freshness_proof: proposal content hash
      rebuild_rule: recompute from proposal
      recovery_source: proposal plus receipt
      retired_shadow_sources: [consumer-local-parser]
      forbidden_fallbacks: [mtime]
      cutover:
        old_writer_stop: local parsers removed
        new_writer_start: shared evaluator enabled
        rollback_boundary: before approved delta merge
        exit_evidence: all consumers deep equal
      tests: ${JSON.stringify(tests)}
  unresolved: []
\`\`\`
`;
}

const CLOSURE = `## 基线闭包计划

\`\`\`yaml
baseline_closure:
  policy: on-touch-v1
  schema_version: 1
  unit: canonical-merge-target-path
  delta_cardinality: exactly-one-per-non-skip-target
  effective_view: merged-resources-plus-current-change-deltas
  ambiguity: block-before-existing-plan-exit
  standalone_baseline_required: false
  jit_confirmation: disabled
  touched_scenario_ids: [S99]
  targets:
    - category: test
      scenario_ids: [S99]
      mode: CREATE
      delta_path: "deltas/test/core-S99-test-cases.md"
      reason: "夹具"
      evidence: ["target_absent: logos/resources/test/core-S99-test-cases.md"]
      missing_evidence: []
\`\`\`

`;

function proposal(options: Options): string {
  return `# 变更提案：gate-fixture

> module: core

## 变更原因
门禁夹具。

## 变更类型
代码级变更。

## 变更范围
- CLI evaluator。

## 部署影响
- 是否需要部署：否
- 部署原因：仅夹具
- 影响环境：本地
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## UI/UX 变更声明

\`\`\`yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
\`\`\`

${impact(options.tests ?? ['UT-S99-01'])}${options.closureSignal ? CLOSURE : ''}
## 决策澄清

\`\`\`yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data: {status: none, reason: 无数据影响}
  compatibility: {status: none, reason: 无兼容选择}
  security_privacy: {status: none, reason: 无安全隐私影响}
  public_release: {status: none, reason: 无公开发布}
  external_commitment: {status: none, reason: 无外部承诺}
decisions: []
unresolved: []
defaults: []
\`\`\`

## 变更概述
门禁夹具。
`;
}

function setup(options: Options = {}) {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  mkdirSync(join(root, 'spec'), { recursive: true });
  writeFileSync(join(root, 'spec', 'gate-authority.md'), '# registry\n');
  const dir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), proposal(options));
  const deltaTask = options.closureSignal
    ? '- [ ] [CREATE] `deltas/test/core-S99-test-cases.md`：规划 `UT-S99-01`。'
    : '- [ ] 规划 `deltas/test/core-S99-test-cases.md` 中的 `UT-S99-01`。';
  writeFileSync(join(dir, 'tasks.md'), `# 实现任务\n\n## [delta] 规格变更\n\n${deltaTask}\n\n## [code] 代码实现\n`);
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  if (options.withDelta) {
    const deltaDir = join(dir, 'deltas', 'test');
    mkdirSync(deltaDir, { recursive: true });
    writeFileSync(join(deltaDir, 'core-S99-test-cases.md'),
      '## ADDED — S99 夹具\n\n| ID | 描述 |\n|---|---|\n| UT-S99-01 | 夹具 |\n');
  }
  return { root, dir };
}

const lintOf = (f: { root: string; dir: string }) => {
  const lint = runChangeLint(f.root, f.dir, SLUG);
  if (!lint.ok) throw new Error(lint.message);
  return lint;
};
const mergeOf = (f: { root: string; dir: string }) =>
  spawnSync(process.execPath, [CLI, 'merge', SLUG], { cwd: f.root, encoding: 'utf8', timeout: 120000 });

describe('S09 merge 准入与 change-lint 同源', () => {
  it('UT-S09-283: 准入结论与 change-lint 逐字同源', () => {
    // ① 合规提案：lint 无违规 → merge 放行
    const ok = setup({ tests: ['UT-S99-01'], withDelta: true });
    expect(lintOf(ok).violations).toEqual([]);
    expect(mergeOf(ok).status).toBe(0);

    // ② 不合规提案：lint 有违规 → merge 拒绝
    const bad = setup({ tests: ['UT-S97-99'], withDelta: true });
    expect(lintOf(bad).violations.length).toBeGreaterThan(0);
    expect(mergeOf(bad).status).not.toBe(0);
  });

  it('UT-S09-284: 无 baseline_closure 信号的提案同样经预检', () => {
    // 不带闭包声明、[delta] 任务也无 [MODIFY]/[CREATE] 标记——此前整道预检不做、直接放行
    const f = setup({ tests: ['UT-S97-99'], closureSignal: false, withDelta: true });
    expect(readFileSync(join(f.dir, 'proposal.md'), 'utf8')).not.toContain('baseline_closure');
    expect(lintOf(f).violations.some(v => v.code === 'authority_closure_incomplete')).toBe(true);
    const merged = mergeOf(f);
    expect(merged.status).not.toBe(0);
    expect(`${merged.stdout}${merged.stderr}`).toContain('UT-S97-99');
    // 失败路径不得留下任何写入
    expect(existsSync(join(f.dir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(f.dir, 'MERGE_PROMPT.md'))).toBe(false);
  });

  it('UT-S09-285: 拒绝时逐条输出可归因诊断', () => {
    const f = setup({ tests: ['UT-S97-99'], withDelta: true });
    const merged = mergeOf(f);
    const text = `${merged.stdout}${merged.stderr}`;
    const lint = lintOf(f);
    // 每条违规都单独成行，含 code、路径与具体实体
    for (const v of lint.violations) expect(text).toContain(`[${v.code}]`);
    expect(text).toContain('修复：');
    expect(text).toContain('UT-S97-99');
    // 并给出可复现的自查命令
    expect(text).toContain('openlogos change-lint');
    // 禁止只给聚合结论
    expect(text).not.toContain('L1-L9 未全过');
  });

  it('ST-S09-110: 真实 CLI 下 merge 可由 change-lint 完全预知', () => {
    const f = setup({ tests: ['UT-S97-99'], withDelta: true });
    // ①② 补齐前：两者同为失败，且 merge 诊断含 lint 点名的同一 ID
    expect(lintOf(f).violations.length).toBeGreaterThan(0);
    const before = mergeOf(f);
    expect(before.status).not.toBe(0);
    expect(`${before.stdout}${before.stderr}`).toContain('UT-S97-99');

    // ③④ 修正 fact 引用后：两者同为成功
    const proposalPath = join(f.dir, 'proposal.md');
    writeFileSync(proposalPath, readFileSync(proposalPath, 'utf8').replace('UT-S97-99', 'UT-S99-01'));
    expect(lintOf(f).violations).toEqual([]);
    expect(mergeOf(f).status).toBe(0);
  });
});

describe('S35 门禁阶段可满足性', () => {
  it('UT-S35-129: 每道门在其阶段的合法最小提案均通过', () => {
    // plan 阶段的合法最小提案：完整 proposal/tasks，**不含任何 delta**
    const plan = setup({ tests: ['UT-S99-01'], withDelta: false });
    expect(detectProposalStepViaFlow(plan.dir)).toBe('ready-to-delta');

    // spec / merge 阶段的合法最小提案：含全部已规划 delta，[code] 仍为空标题
    const spec = setup({ tests: ['UT-S99-01'], withDelta: true });
    const lint = lintOf(spec);
    // 逐门断言：任一门在其阶段不可满足即失败，并点名是哪一道
    const failing = lint.checks.filter(c => c.violations > 0).map(c => `L${c.id} ${c.label}`);
    expect(failing).toEqual([]);
    expect(lint.checks.length).toBeGreaterThanOrEqual(8);
  });
});
