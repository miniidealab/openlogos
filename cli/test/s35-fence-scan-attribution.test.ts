/**
 * 切片3：围栏提取单点、多命中可归因与诊断点名。
 * 覆盖 UT-S35-127、UT-S35-128、UT-S35-130、ST-S35-24、UT-S05-51、ST-S05-23。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { evaluateAuthorityClosure, planCreateTargets, collectPlannedAuthorityCreateTargets } from '../src/lib/authority-closure.js';
import { hasBaselineClosureSignal } from '../src/lib/baseline-closure.js';
import { detectProposalStepViaFlow } from '../src/lib/flow-derive.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** 四反引号 markdown 示意块，块内含一段 yaml——裸正则会把它误算为真实声明。 */
const NESTED_SAMPLE = [
  '## 说明', '',
  '````markdown',
  '下面是**示意**，不是真实声明：', '',
  '```yaml',
  'authority_impact:',
  '  schema: openlogos/authority-impact@1',
  '  applicability: not_applicable',
  '  evidence: [示意]',
  '```',
  '````', '',
].join('\n');

const CLOSURE_SAMPLE = [
  '## 说明', '',
  '````markdown',
  '示意的闭包计划：', '',
  '```yaml',
  'baseline_closure:',
  '  policy: on-touch-v1',
  '  schema_version: 1',
  '  targets: []',
  '```',
  '````', '',
].join('\n');

function impact(tests: string[], ref: string): string {
  return `## Authority Impact

\`\`\`yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [derived_projection]
  facts:
    - fact_id: core.fence-fixture
      change: create
      authority_ref: ${ref}
      authority_owner: FenceFixtureEvaluator
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

const CLOSURE_PLAN = `## 基线闭包计划

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
    - category: spec
      scenario_ids: [S99]
      mode: CREATE
      delta_path: "deltas/spec/planned-fence.md"
      reason: "夹具"
      evidence: ["target_absent: spec/planned-fence.md"]
      missing_evidence: []
\`\`\`

`;

function proposal(body: { nested?: string; closure?: boolean; impactBlock: string }): string {
  return `# 变更提案：fence-fixture

> module: core

## 变更原因
围栏夹具。

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

${body.nested ?? ''}${body.impactBlock}${body.closure ? CLOSURE_PLAN : ''}
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
围栏夹具。
`;
}

function setup(content: string) {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  mkdirSync(join(root, 'spec'), { recursive: true });
  writeFileSync(join(root, 'spec', 'fence-authority.md'), '# registry\n');
  const dir = join(root, 'logos', 'changes', 'fence-fixture');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), content);
  writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n\n- [ ] 规划 `deltas/test/core-S99-test-cases.md` 中的 `UT-S99-01`。\n\n## [code] 代码实现\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'fence-fixture', module: 'core' }));
  return { root, dir, content };
}

describe('S35 围栏提取单点与可归因', () => {
  it('UT-S35-127: 围栏提取与其余提取器同源', () => {
    // 含嵌套围栏的文档：四反引号块内示意一段 authority_impact yaml，块外另有一段真实声明。
    const f = setup(proposal({ nested: NESTED_SAMPLE, impactBlock: impact(['UT-S99-01'], 'spec/fence-authority.md#r') }));
    const evaluation = evaluateAuthorityClosure(f.root, f.dir, undefined, 'plan')!;
    // 只应命中块外那一处；修复前裸正则命中 2 处 → 判 authority_impact_malformed。
    expect(evaluation.issues.map(i => i.code)).not.toContain('authority_impact_malformed');
    expect(evaluation.applicability).toBe('required');

    // 与既有 fence-aware 提取器同源：baseline-closure 对同一文档同样只见块外那一处声明，
    // 因此 authority-closure 也应恰好命中一处并正常映射出 CREATE 目标。
    const g = setup(proposal({ nested: CLOSURE_SAMPLE, closure: true, impactBlock: impact(['UT-S99-01'], 'spec/fence-authority.md#r') }));
    expect(hasBaselineClosureSignal(g.content, '')).toBe(true);
    const plannedG = planCreateTargets(g.content);
    expect(plannedG.ambiguity).toBeUndefined();
    expect(plannedG.targets.has('spec/planned-fence.md')).toBe(true);
    expect(collectPlannedAuthorityCreateTargets(g.content).has('spec/planned-fence.md')).toBe(true);
  });

  it('UT-S35-128: 多命中产出诊断而非静默空集', () => {
    // 掩码外确实写了两段 baseline_closure 声明。
    const f = setup(proposal({ closure: true, impactBlock: impact(['UT-S99-01'], 'spec/planned-fence.md#r') })
      .replace('## 决策澄清', `${CLOSURE_PLAN}## 决策澄清`));
    const planned = planCreateTargets(f.content);
    expect(planned.targets.size).toBe(0);
    // 必须点名命中处数与行号，而非静默返回空集。
    expect(planned.ambiguity).toBeDefined();
    expect(planned.ambiguity).toContain('2 处');
    expect(planned.ambiguity).toMatch(/第 \d+、\d+ 行/);

    // 且该原因必须出现在最终诊断里——否则用户只看到 authority_ref 无法解析、无从归因。
    const evaluation = evaluateAuthorityClosure(f.root, f.dir, undefined, 'plan')!;
    const ref = evaluation.issues.find(i => i.code === 'authority_fact_reference_missing');
    expect(ref).toBeDefined();
    expect(ref!.message).toContain('baseline_closure 声明');
  });

  it('UT-S35-130: 诊断点名具体对象', () => {
    // 两段 authority_impact 声明 → 诊断须点名处数与行号，不得只说「不唯一或非法」。
    const dup = setup(proposal({ impactBlock: impact(['UT-S99-01'], 'spec/fence-authority.md#r') })
      .replace('## 决策澄清', `${impact(['UT-S99-02'], 'spec/fence-authority.md#r')}## 决策澄清`));
    const evaluation = evaluateAuthorityClosure(dup.root, dup.dir, undefined, 'plan')!;
    const malformed = evaluation.issues.find(i => i.code === 'authority_impact_malformed');
    expect(malformed).toBeDefined();
    expect(malformed!.message).toContain('2 处');
    expect(malformed!.message).toMatch(/第 \d+、\d+ 行/);
    // 禁止无法定位的笼统措辞
    expect(malformed!.message).not.toBe('authority_impact YAML 不唯一、无法严格解析或根结构非法。');
  });

  it('ST-S35-24: 嵌套示意块不影响 plan 阶段容错', () => {
    const f = setup(proposal({
      nested: NESTED_SAMPLE, closure: true,
      impactBlock: impact(['UT-S99-01'], 'spec/planned-fence.md#registry'),
    }));
    // authority_ref 指向闭包计划中声明 CREATE、尚未创建的目标——容错须正常生效。
    expect(detectProposalStepViaFlow(f.dir)).toBe('ready-to-delta');
    const evaluation = evaluateAuthorityClosure(f.root, f.dir, undefined, 'plan')!;
    expect(evaluation.issues.map(i => i.code)).not.toContain('authority_fact_reference_missing');
  });
});

describe('S05 围栏多命中的归因路径', () => {
  it('UT-S05-51: 嵌套围栏不再使 plan 阶段容错静默失效', () => {
    const f = setup(proposal({
      nested: CLOSURE_SAMPLE, closure: true,
      impactBlock: impact(['UT-S99-01'], 'spec/planned-fence.md#registry'),
    }));
    // 示意块被掩码覆盖 → 候选恢复为 1 → CREATE 容错生效 → 派生为 ready-to-delta。
    expect(detectProposalStepViaFlow(f.dir)).toBe('ready-to-delta');
  });

  it('ST-S05-23: 真实多份声明时诊断指向真实原因', () => {
    const f = setup(proposal({ closure: true, impactBlock: impact(['UT-S99-01'], 'spec/planned-fence.md#registry') })
      .replace('## 决策澄清', `${CLOSURE_PLAN}## 决策澄清`));
    // 正当拒绝：确实写了两段声明。
    expect(detectProposalStepViaFlow(f.dir)).toBe('writing');
    const evaluation = evaluateAuthorityClosure(f.root, f.dir, undefined, 'plan')!;
    const ref = evaluation.issues.find(i => i.code === 'authority_fact_reference_missing')!;
    // 诊断须指向真实原因（声明多命中），而非让用户去查 authority_ref 拼写。
    expect(ref.message).toContain('2 处');
    expect(ref.message).toContain('baseline_closure');
  });
});
