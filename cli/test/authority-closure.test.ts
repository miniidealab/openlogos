/** Authority Closure 计划门回归；测试结果由全局 OpenLogos reporter 写入 JSONL。 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import {
  AUTHORITY_CLOSURE_ISSUE_CODES,
  authorityClosureSummary,
  collectPlannedAuthorityCreateTargets,
  evaluateAuthorityClosure,
} from '../src/lib/authority-closure.js';
import { evaluatePlanPackage } from '../src/lib/plan-package.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { derivePlanState, resolveProposalDeploymentDecision } from '../src/lib/proposal-lifecycle.js';
import { detectProposalStepViaFlow, evaluateFlowPlanPackage } from '../src/lib/flow-derive.js';
import { writePlanApprovedMarker } from '../src/lib/ui-provenance.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const TEST_IDS = ['UT-S35-112', 'UT-S35-120', 'ST-S35-19', 'ST-S35-21', 'SMOKE-core-163', 'SMOKE-core-167'];

function impactRequired(overrides = ''): string {
  return `## Authority Impact

\`\`\`yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [derived_projection]
  facts:
    - fact_id: core.plan-authority
      change: create
      authority_ref: spec/authority.md#registry
      authority_owner: PlanPackageEvaluator
      canonical_state: proposal authority impact
      sole_writer: approved delta merge
      mutation_entry: openlogos merge
      decision_api: AuthorityClosureEvaluator
      projections: [change-lint, status, next, flow]
      freshness_proof: proposal content hash
      rebuild_rule: recompute from proposal
      recovery_source: proposal plus receipt
      retired_shadow_sources: [consumer-local-parser, marker-scan]
      forbidden_fallbacks: [mtime, directory-scan]
      cutover:
        old_writer_stop: local parsers removed
        new_writer_start: shared evaluator enabled
        rollback_boundary: before approved delta merge
        exit_evidence: all consumers deep equal
      tests: [UT-S35-112, ST-S35-19]
  unresolved: []
${overrides}\`\`\`
`;
}

function impactNotApplicable(evidence = '[纯测试夹具，不改变事实归属]'): string {
  return `## Authority Impact

\`\`\`yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: not_applicable
  evidence: ${evidence}
\`\`\`
`;
}

function baseProposal(impact = impactRequired()): string {
  return `# 变更提案：authority

> module: core

## 变更原因
验证 Authority Closure。

## 变更类型
代码级变更。

## 变更范围
- CLI evaluator。

## 部署影响
- 是否需要部署：否
- 部署原因：仅本地测试
- 影响环境：本地
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

${impact}
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
由唯一 evaluator 计算完成状态。
`;
}

function setup(impact = impactRequired()) {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  mkdirSync(join(root, 'spec'), { recursive: true });
  writeFileSync(join(root, 'spec', 'authority.md'), '# registry\n');
  mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
  writeFileSync(join(root, 'logos', 'resources', 'test', 'core-authority.md'), [
    '| ID | 场景 |', '|---|---|', ...TEST_IDS.map(id => `| ${id} | authority |`), '',
  ].join('\n'));
  const dir = join(root, 'logos', 'changes', 'authority');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), baseProposal(impact));
  writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta]\n- [ ] `deltas/spec/authority.md`\n\n## [code]\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'authority', module: 'core' }));
  return { root, dir };
}

function evalOf(f: ReturnType<typeof setup>) {
  return evaluateAuthorityClosure(f.root, f.dir)!;
}

function treeHash(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name); const stat = statSync(path);
      hash.update(path.slice(root.length));
      if (stat.isDirectory()) walk(path); else hash.update(readFileSync(path));
    }
  };
  walk(root); return hash.digest('hex');
}

describe('S09 Authority Impact plan gate', () => {
  it('UT-S09-266: required 完整时 Plan Package authority ready', () => {
    const f = setup();
    expect(evaluatePlanPackage(f.root, f.dir)).toMatchObject({ ready: true, authority_closure: { facts_closed: 1, pass: true } });
  });

  it('UT-S09-267: not_applicable 合法且计数为零', () => {
    const f = setup(impactNotApplicable());
    expect(evalOf(f)).toMatchObject({ applicability: 'not_applicable', facts_total: 0, projections: 0, pass: true });
  });

  it('UT-S09-268: writing 缺声明不降级', () => {
    const f = setup('');
    expect(evalOf(f).issues[0].code).toBe('authority_impact_declaration_missing');
    expect(evaluatePlanPackage(f.root, f.dir).ready).toBe(false);
  });

  it('UT-S09-269: 四种历史 marker 对 legacy 省略且不回退', () => {
    for (const marker of ['PLAN_APPROVED', 'SPEC_MERGED', 'MERGED', 'VERIFY_PASS']) {
      const f = setup(''); writeFileSync(join(f.dir, marker), '');
      expect(evaluateAuthorityClosure(f.root, f.dir)).toBeUndefined();
      expect(evaluatePlanPackage(f.root, f.dir).authority_closure).toBeUndefined();
    }
  });

  it('UT-S09-270: plan 批准只进入 delta-writing', () => {
    const f = setup(); writePlanApprovedMarker(f.dir);
    expect(detectProposalStepViaFlow(f.dir)).toBe('delta-writing');
    for (const marker of ['SPEC_MERGED', 'MERGED', 'VERIFY_PASS', 'SMOKE_PASS']) expect(existsSync(join(f.dir, marker))).toBe(false);
  });

  it('ST-S09-104: 缺声明修复后 ready，批准后进入 delta-writing', () => {
    const f = setup('');
    expect(evaluatePlanPackage(f.root, f.dir).ready).toBe(false);
    writeFileSync(join(f.dir, 'proposal.md'), baseProposal());
    expect(evaluatePlanPackage(f.root, f.dir).ready).toBe(true);
    writePlanApprovedMarker(f.dir);
    expect(detectProposalStepViaFlow(f.dir)).toBe('delta-writing');
  });

  it('ST-S09-105: 批准后 authority 漂移会重新阻断', () => {
    const f = setup(); writePlanApprovedMarker(f.dir);
    const changed = readFileSync(join(f.dir, 'proposal.md'), 'utf8').replace('exit_evidence: all consumers deep equal', 'exit_evidence: ""');
    writeFileSync(join(f.dir, 'proposal.md'), changed);
    expect(evaluatePlanPackage(f.root, f.dir)).toMatchObject({ ready: false, authority_closure: { pass: false } });
    expect(detectProposalStepViaFlow(f.dir)).toBe('writing');
  });
});

describe('S16 Authority Closure JSON', () => {
  it('UT-S16-35: required summary 恰有八字段且计数同源', () => {
    const value = authorityClosureSummary(evalOf(setup()));
    expect(Object.keys(value)).toEqual(['schema', 'applicability', 'facts_total', 'facts_closed', 'projections', 'retired_shadow_sources', 'unresolved', 'pass']);
    expect(value).toMatchObject({ facts_total: 1, facts_closed: 1, projections: 4, retired_shadow_sources: 2, pass: true });
  });

  it('UT-S16-36: violation code 只有五个规范值且 item 四字段', () => {
    expect(AUTHORITY_CLOSURE_ISSUE_CODES).toHaveLength(5);
    const f = setup('');
    expect(Object.keys(evalOf(f).issues[0]).sort()).toEqual(['code', 'fix_hint', 'message', 'path']);
  });

  it('UT-S16-37: legacy 省略而合法 not_applicable 在场', () => {
    const legacy = setup(''); writeFileSync(join(legacy.dir, 'PLAN_APPROVED'), '');
    expect(evaluateAuthorityClosure(legacy.root, legacy.dir)).toBeUndefined();
    expect(evalOf(setup(impactNotApplicable()))).toMatchObject({ applicability: 'not_applicable', pass: true });
  });

  it('ST-S16-11: lint/status/next/flow 消费同一 summary', () => {
    const f = setup();
    const lint = runChangeLint(f.root, f.dir, 'authority');
    if (!lint.ok) throw new Error(lint.message);
    const step = detectProposalStepViaFlow(f.dir);
    const status = derivePlanState(f.dir, step, resolveProposalDeploymentDecision(f.dir));
    const next = derivePlanState(f.dir, step, resolveProposalDeploymentDecision(f.dir));
    const flow = evaluateFlowPlanPackage(f.root, f.dir);
    expect(lint.authority_closure).toEqual(status.plan_package.authority_closure);
    expect(next.plan_package.authority_closure).toEqual(flow.authority_closure);
  });
});

describe('S35 Authority Closure lint', () => {
  it('UT-S35-112: required 完整解析', () => {
    const f = setup(impactRequired().replace('spec/authority.md#registry', 'spec/planned-authority.md#registry'));
    const proposal = baseProposal(impactRequired().replace('spec/authority.md#registry', 'spec/planned-authority.md#registry')) + `\n\`\`\`yaml
baseline_closure:
  schema_version: 1
  policy: on-touch-v1
  targets:
    - mode: CREATE
      delta_path: deltas/spec/planned-authority.md
      evidence: ["target_absent: spec/planned-authority.md"]
\`\`\`
`;
    expect([...collectPlannedAuthorityCreateTargets(proposal)]).toContain('spec/planned-authority.md');
    expect([...collectPlannedAuthorityCreateTargets(proposal.replace('mode: CREATE', 'mode: MODIFY'))]).not.toContain('spec/planned-authority.md');
    writeFileSync(join(f.dir, 'proposal.md'), proposal);
    expect(evalOf(f)).toMatchObject({ facts_closed: 1, pass: true, issues: [] });
  });

  it('UT-S35-113: declaration missing', () => {
    expect(evalOf(setup('')).issues.map(i => i.code)).toEqual(['authority_impact_declaration_missing']);
  });

  it('UT-S35-114: malformed 严格拒绝重复键、未知字段、非法分支、重复 fact 与空字符串', () => {
    const cases = [
      impactNotApplicable().replace('  evidence:', '  schema: duplicate\n  evidence:'),
      impactNotApplicable().replace('  evidence:', '  unknown: true\n  evidence:'),
      impactNotApplicable().replace('not_applicable', 'sometimes'),
      impactRequired().replace('  unresolved: []', '    - fact_id: core.plan-authority\n      change: create\n  unresolved: []'),
      impactRequired().replace('authority_owner: PlanPackageEvaluator', 'authority_owner: ""'),
    ];
    for (const value of cases) expect(evalOf(setup(value)).issues.length).toBeGreaterThan(0);
  });

  it('UT-S35-115: authority_ref 不存在时精确报引用缺失', () => {
    const f = setup(impactRequired().replace('spec/authority.md#registry', 'spec/missing.md#registry'));
    expect(evalOf(f).issues).toContainEqual(expect.objectContaining({ code: 'authority_fact_reference_missing', path: expect.stringContaining('proposal.md'), fix_hint: expect.any(String) }));
  });

  it('UT-S35-116: closure 字段缺失时多问题不短路', () => {
    const value = impactRequired().replace('      sole_writer: approved delta merge\n', '').replace('      mutation_entry: openlogos merge\n', '')
      .replace('      freshness_proof: proposal content hash\n', '').replace('      recovery_source: proposal plus receipt\n', '')
      .replace('      tests: [UT-S35-112, ST-S35-19]\n', '');
    const issues = evalOf(setup(value)).issues.filter(i => i.code === 'authority_closure_incomplete');
    expect(issues.length).toBeGreaterThanOrEqual(5);
  });

  it('UT-S35-117: cutover 缺口与 unresolved 均稳定阻断', () => {
    const value = impactRequired().replace('        old_writer_stop: local parsers removed', '        old_writer_stop: ""')
      .replace('  unresolved: []', '  unresolved: [旧 writer 尚未关闭]');
    expect(evalOf(setup(value)).issues.filter(i => i.code === 'authority_cutover_unclosed')).toHaveLength(2);
  });

  it('UT-S35-118: not_applicable 严格分支', () => {
    expect(evalOf(setup(impactNotApplicable())).pass).toBe(true);
    expect(evalOf(setup(impactNotApplicable('[]'))).pass).toBe(false);
    expect(evalOf(setup(impactNotApplicable() .replace('  evidence:', '  facts: []\n  evidence:'))).pass).toBe(false);
  });

  it('UT-S35-119: 只采信 effective test view 结构化 ID', () => {
    expect(evalOf(setup()).pass).toBe(true);
    const f = setup(impactRequired().replace('ST-S35-19]', 'UT-S99-999]'));
    writeFileSync(join(f.root, 'logos', 'resources', 'test', 'essay.md'), '散文提及 UT-S99-999。\n');
    expect(evalOf(f).issues.map(i => i.code)).toContain('authority_closure_incomplete');
  });

  it('UT-S35-120: 多问题全序且 evaluator 只读', () => {
    const f = setup(impactRequired().replace('spec/authority.md#registry', 'spec/missing.md')
      .replace('authority_owner: PlanPackageEvaluator', 'authority_owner: ""')
      .replace('        exit_evidence: all consumers deep equal', '        exit_evidence: ""')
      .replace('  unresolved: []', '  unresolved: [尚未解决]'));
    const before = treeHash(f.root); const first = evalOf(f); const second = evalOf(f); const after = treeHash(f.root);
    expect(first).toEqual(second); expect(after).toBe(before);
    expect(new Set(first.issues.map(i => i.code))).toEqual(new Set(['authority_fact_reference_missing', 'authority_closure_incomplete', 'authority_cutover_unclosed']));
  });

  it('ST-S35-19: producer 修复环由 fail 收敛到 ready', () => {
    const f = setup(''); expect(evalOf(f).pass).toBe(false);
    writeFileSync(join(f.dir, 'proposal.md'), baseProposal(impactRequired().replace('        exit_evidence: all consumers deep equal', '        exit_evidence: ""')));
    expect(evalOf(f).pass).toBe(false);
    writeFileSync(join(f.dir, 'proposal.md'), baseProposal());
    expect(evaluatePlanPackage(f.root, f.dir).ready).toBe(true);
  });

  it('ST-S35-20: 合法与非法输入的四消费者均共享 evaluator', () => {
    for (const impact of [impactRequired(), impactRequired().replace('sole_writer: approved delta merge', 'sole_writer: ""')]) {
      const f = setup(impact); const expected = evaluatePlanPackage(f.root, f.dir).authority_closure;
      const lint = runChangeLint(f.root, f.dir, 'authority'); if (!lint.ok) throw new Error(lint.message);
      const step = detectProposalStepViaFlow(f.dir);
      expect(lint.authority_closure).toEqual(expected);
      expect(derivePlanState(f.dir, step, resolveProposalDeploymentDecision(f.dir)).plan_package.authority_closure).toEqual(expected);
      expect(evaluateFlowPlanPackage(f.root, f.dir).authority_closure).toEqual(expected);
    }
  });

  it('ST-S35-21: stale/shadow/cutover 未闭合时阻断，补齐后通过', () => {
    const broken = impactRequired().replace('      retired_shadow_sources: [consumer-local-parser, marker-scan]', '      retired_shadow_sources: []')
      .replace('        old_writer_stop: local parsers removed', '        old_writer_stop: ""');
    const f = setup(broken); expect(evalOf(f).pass).toBe(false);
    writeFileSync(join(f.dir, 'proposal.md'), baseProposal());
    expect(evalOf(f).pass).toBe(true);
  });
});
