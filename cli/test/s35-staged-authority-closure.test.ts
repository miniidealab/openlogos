/**
 * 切片1：authority closure 分阶段校验 + 「## 复用测试 ID」接入 effective test view。
 * 覆盖 UT-S05-47/48、UT-S35-121~124、ST-S05-22、ST-S35-22；结果由全局 OpenLogos reporter 写入 JSONL。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { collectEffectiveTestIds, evaluateAuthorityClosure } from '../src/lib/authority-closure.js';
import { evaluatePlanPackage } from '../src/lib/plan-package.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { detectProposalStepViaFlow } from '../src/lib/flow-derive.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** 已合并测试规格中真实存在的 ID，用于「复用测试 ID」正向用例。 */
const MERGED_IDS = ['UT-S01-01', 'ST-S01-01'];

interface FactOptions {
  tests?: unknown;
  authorityRef?: string;
  reuseSection?: string;
  /** 在 proposal.md 中附一段 baseline_closure，把 authority_ref 声明为「已规划 CREATE、此刻尚不存在」。 */
  plannedCreate?: string;
}

/** 唯一合法 baseline_closure 围栏：把 delta_path 映射出的 canonical 目标声明为 CREATE + target_absent。 */
function baselineClosure(canonical: string, deltaPath: string): string {
  return `## 基线闭包

\`\`\`yaml
baseline_closure:
  policy: on-touch-v1
  schema_version: 1
  targets:
    - dimension: spec
      mode: CREATE
      delta_path: ${deltaPath}
      evidence:
        - 'target_absent: ${canonical}'
\`\`\`

`;
}

function impact(options: FactOptions = {}): string {
  const tests = options.tests === undefined ? ['UT-S99-01'] : options.tests;
  return `## Authority Impact

\`\`\`yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [derived_projection]
  facts:
    - fact_id: core.staged-closure
      change: create
      authority_ref: ${options.authorityRef ?? 'spec/authority.md#registry'}
      authority_owner: StagedClosureEvaluator
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

function proposal(impactBlock: string, reuseSection = '', plannedCreate = ''): string {
  return `# 变更提案：staged-closure

> module: core

## 变更原因
验证分阶段 authority closure。

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

${impactBlock}${reuseSection}${plannedCreate}
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
由唯一 evaluator 按阶段计算完成状态。
`;
}

function setup(options: FactOptions = {}) {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  mkdirSync(join(root, 'spec'), { recursive: true });
  writeFileSync(join(root, 'spec', 'authority.md'), '# registry\n');
  mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
  writeFileSync(join(root, 'logos', 'resources', 'test', 'core-S01-test-cases.md'), [
    '| ID | 场景 |', '|---|---|', ...MERGED_IDS.map(id => `| ${id} | 既有 |`), '',
  ].join('\n'));
  const dir = join(root, 'logos', 'changes', 'staged-closure');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), proposal(impact(options), options.reuseSection ?? '', options.plannedCreate ?? ''));
  writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta]\n- [ ] `deltas/test/core-S99-test-cases.md`\n\n## [code]\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'staged-closure', module: 'core' }));
  return { root, dir };
}

const plan = (f: { root: string; dir: string }) => evaluateAuthorityClosure(f.root, f.dir, undefined, 'plan')!;
const spec = (f: { root: string; dir: string }) => evaluateAuthorityClosure(f.root, f.dir, undefined, 'spec')!;

describe('S35 authority closure 分阶段校验', () => {
  it('UT-S35-121: plan 阶段不查 effective view，spec 阶段查', () => {
    const f = setup({ tests: ['UT-S99-01'] });
    expect(plan(f).pass).toBe(true);

    const specEval = spec(f);
    expect(specEval.pass).toBe(false);
    const issue = specEval.issues.find(i => i.code === 'authority_closure_incomplete');
    expect(issue).toBeDefined();
    // 诊断必须点名未命中的具体 ID，而非只说「不完整」。
    expect(issue!.message).toContain('UT-S99-01');
  });

  it('UT-S35-122: 拦截点后移而非消失（强度不降）', () => {
    const f = setup({ tests: ['UT-S99-01'] });
    expect(plan(f).pass).toBe(true);
    // plan 放行的同一 ID，必然在 spec 阶段被复核并拦下——不存在「放行后再无人校验」的路径。
    expect(spec(f).issues.map(i => i.code)).toContain('authority_closure_incomplete');
    // 且 change-lint 全量门（spec 阶段的真实落点）同样在 L10 记违规。
    const lint = runChangeLint(f.root, f.dir, 'staged-closure');
    if (!lint.ok) throw new Error(lint.message);
    expect(lint.violations.some(v => v.code === 'authority_closure_incomplete')).toBe(true);
  });

  it('UT-S35-123: tests 与 authority_ref 阶段宽严对称', () => {
    // 形态 A —— 有规划意图、产物已按各阶段应有的进度落盘：
    //   authority_ref 指向 baseline_closure 中声明 CREATE 的目标（要到 merge 才存在）；
    //   tests 引用的 ID 由本提案的 test delta 提供（spec 阶段本该已存在，故予以产出）。
    const planned = setup({
      tests: ['UT-S99-01'],
      authorityRef: 'spec/planned-authority.md#registry',
      plannedCreate: baselineClosure('spec/planned-authority.md', 'deltas/spec/planned-authority.md'),
    });
    const deltaDir = join(planned.dir, 'deltas', 'test');
    mkdirSync(deltaDir, { recursive: true });
    writeFileSync(join(deltaDir, 'core-S99-test-cases.md'), [
      '## ADDED — S99 分阶段校验测试', '', '| ID | 描述 |', '|---|---|', '| UT-S99-01 | 分阶段校验 |', '',
    ].join('\n'));

    // 形态 B —— 两者都缺规划意图：authority_ref 指向未规划且不存在的目标，tests 格式非法。
    const unplanned = setup({ tests: ['not-a-test-id'], authorityRef: 'spec/never-planned.md#registry' });

    const rejects = (evaluation: ReturnType<typeof plan>, code: string) =>
      evaluation.issues.some(i => i.code === code);

    for (const [label, fixture] of [['planned', planned], ['unplanned', unplanned]] as const) {
      for (const [stage, evaluate] of [['plan', plan], ['spec', spec]] as const) {
        const evaluation = evaluate(fixture);
        const refRejected = rejects(evaluation, 'authority_fact_reference_missing');
        const testsRejected = rejects(evaluation, 'authority_closure_incomplete');
        // 核心判据：任一阶段出现「一个放行、另一个被拒」即失败。
        expect({ label, stage, refRejected, testsRejected })
          .toEqual({ label, stage, refRejected: label === 'unplanned', testsRejected: label === 'unplanned' });
      }
    }
  });

  it('UT-S35-124: 复用测试 ID 小节被 closure 采信（含负向）', () => {
    const reuse = `## 复用测试 ID

- ${MERGED_IDS[0]} — 复用既有覆盖，不重复造 ID

`;
    const ok = setup({ tests: [MERGED_IDS[0]], reuseSection: reuse });
    expect(collectEffectiveTestIds(ok.root, ok.dir).has(MERGED_IDS[0])).toBe(true);
    expect(spec(ok).pass).toBe(true);

    // 负向：小节列出已合并规格中不存在的 ID —— 不纳入 effective view，spec 阶段照常拦下。
    const bad = setup({
      tests: ['UT-S98-99'],
      reuseSection: '## 复用测试 ID\n\n- UT-S98-99 — 声称复用一个并不存在的 ID\n\n',
    });
    expect(collectEffectiveTestIds(bad.root, bad.dir).has('UT-S98-99')).toBe(false);
    expect(spec(bad).pass).toBe(false);
  });

  it('ST-S35-22: change-lint 全量门维持强校验', () => {
    // ① tests 引用不存在 ID：L10 FAIL 且点名未命中 ID。
    const f = setup({ tests: ['UT-S99-01'] });
    const before = runChangeLint(f.root, f.dir, 'staged-closure');
    if (!before.ok) throw new Error(before.message);
    const l10 = before.violations.filter(v => v.code === 'authority_closure_incomplete');
    expect(l10.length).toBeGreaterThan(0);
    // 诊断必须点名未命中的具体 ID。
    expect(l10.map(v => v.message).join('\n')).toContain('UT-S99-01');

    // ② 补齐对应 test delta 后：L10 通过。
    const deltaDir = join(f.dir, 'deltas', 'test');
    mkdirSync(deltaDir, { recursive: true });
    writeFileSync(join(deltaDir, 'core-S99-test-cases.md'), [
      '## ADDED — S99 分阶段校验测试', '', '| ID | 描述 |', '|---|---|', '| UT-S99-01 | 分阶段校验 |', '',
    ].join('\n'));
    expect(spec(f).pass).toBe(true);
  });
});

describe('S05 新建 authority fact 提案的 proposal_step 派生', () => {
  it('UT-S05-47: 新建 fact 提案可达 ready-to-delta', () => {
    const f = setup({ tests: ['UT-S99-01'] });
    // plan 阶段（next / status 派生的真实入口）不因 ID 尚不存在而失败。
    expect(evaluatePlanPackage(f.root, f.dir, undefined, 'plan')).toMatchObject({
      ready: true, authority_closure: { pass: true },
    });
    expect(detectProposalStepViaFlow(f.dir)).toBe('ready-to-delta');
  });

  it('UT-S05-48: plan 阶段非无条件放行（负向）', () => {
    for (const tests of [[], ['not-a-test-id']]) {
      const f = setup({ tests });
      const evaluation = evaluatePlanPackage(f.root, f.dir, undefined, 'plan');
      expect(evaluation.ready).toBe(false);
      const issue = evaluation.issues.find(i => i.code === 'authority_closure_incomplete');
      expect(issue).toBeDefined();
      // 诊断须点名具体 fact 与字段，不得出现与实际原因不符的「脱模板」措辞。
      expect(issue!.message).toContain('core.staged-closure');
      expect(issue!.message).toContain('tests');
      expect(issue!.message).not.toContain('脱模板');
      expect(detectProposalStepViaFlow(f.dir)).toBe('writing');
    }
  });

  it('ST-S05-22: 新建 fact 提案端到端走通 plan 门', () => {
    const f = setup({ tests: ['UT-S99-01'] });
    // 未手工创建任何 marker 的前提下，首次派生即为 ready-to-delta。
    expect(detectProposalStepViaFlow(f.dir)).toBe('ready-to-delta');

    // 产出 test delta 后，该 ID 进入 effective view，spec 阶段随之通过。
    const deltaDir = join(f.dir, 'deltas', 'test');
    mkdirSync(deltaDir, { recursive: true });
    writeFileSync(join(deltaDir, 'core-S99-test-cases.md'), [
      '## ADDED — S99 分阶段校验测试', '', '| ID | 描述 |', '|---|---|', '| UT-S99-01 | 分阶段校验 |', '',
    ].join('\n'));
    expect(collectEffectiveTestIds(f.root, f.dir).has('UT-S99-01')).toBe(true);
    expect(spec(f).pass).toBe(true);
  });
});
