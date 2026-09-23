/**
 * change-lint 呈现层夹具的**唯一定义点**（fix-lint-violation-check-attribution）。
 *
 * 改动前基线的生成脚本与 UT-S35-190～195 / ST-S35-35 读同一份构造代码——否则「逐字节相同」
 * 比较的就不是同一件事（golden/README.md「为什么必须是落盘基线」同理）。
 *
 * 三种夹具形态：
 * - `l4-only`   20260921 runlogos `add-workbuddy-agent-type` 原形态：`ADDED` body 重复写与锚
 *               同名的标题 → L4 `delta_section_anchor_unresolvable` 恰一条；该码亦为 L8 所用，
 *               但本输入在 L8 无违规（守恒对账把 `ADDED` 块排除在物质块之外）。
 * - `l4-and-l8` 同一次 lint 同时产出登记在 L4 与登记在 L8 的**同码**违规——「从 code 反推层号」
 *               的结构性反证臂。
 * - `clean`     全部检查通过（PASS），用于「无违规时输出形态不变」的零回归对照。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  makeTempRoot, mergeAdmissibleProposal, mergeAdmissibleTasks, registerCoreModule, scaffoldProject,
} from './helpers.js';

export type LintRenderFixtureKind = 'l4-only' | 'l4-and-l8' | 'clean';

export const LINT_RENDER_SLUG = 'lint-render-fixture';

const SCENARIO_DELTA = 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S81-demo.md';
const SCENARIO_TARGET = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S81-demo.md';
const SECOND_DELTA = 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S82-demo.md';
const SECOND_TARGET = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S82-demo.md';
const TEST_DELTA = 'deltas/test/core-S99-test-cases.md';

const BEFORE_DOC = '# 文档\n\n## 甲\n\n甲正文。\n';
/** 事故原形态：`ADDED` 的 body 里又写了一遍与锚同名的标题 → 合成后不唯一。 */
const DUPLICATE_TITLE_DELTA = '## ADDED — S81：WorkBuddy Agent 类型全生命周期\n\n'
  + '## S81：WorkBuddy Agent 类型全生命周期\n\n正文。\n';
const CLEAN_DELTA = '## ADDED — S81：WorkBuddy Agent 类型全生命周期\n\n正文。\n';
/** 物质块（`MODIFIED`）的锚在目标主文档中不存在 → L8 同码违规（not-found）。 */
const UNRESOLVABLE_MODIFIED_DELTA = '## MODIFIED — 不存在的章节\n\n新正文。\n';
const TEST_DELTA_BODY = '## ADDED — S99 夹具\n\n| ID | 描述 |\n|---|---|\n| UT-S99-01 | 夹具 |\n';

export interface LintRenderFixture { root: string; proposalDir: string; slug: string; cleanup: () => void }

/** 构造一次性隔离项目 + 活跃提案；调用方负责在收尾时执行 `cleanup()`。 */
export function setupLintRenderFixture(kind: LintRenderFixtureKind): LintRenderFixture {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root, 'launched');

  const deltas: Record<string, string> = { [TEST_DELTA]: TEST_DELTA_BODY };
  const seeds: Record<string, string> = {};
  if (kind === 'clean') {
    deltas[SCENARIO_DELTA] = CLEAN_DELTA;
    seeds[SCENARIO_TARGET] = BEFORE_DOC;
  } else {
    deltas[SCENARIO_DELTA] = DUPLICATE_TITLE_DELTA;
    seeds[SCENARIO_TARGET] = BEFORE_DOC;
  }
  if (kind === 'l4-and-l8') {
    deltas[SECOND_DELTA] = UNRESOLVABLE_MODIFIED_DELTA;
    seeds[SECOND_TARGET] = BEFORE_DOC;
  }

  const proposalDir = join(root, 'logos', 'changes', LINT_RENDER_SLUG);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(proposalDir, 'proposal.md'), mergeAdmissibleProposal());
  writeFileSync(join(proposalDir, 'tasks.md'),
    `${mergeAdmissibleTasks(Object.keys(deltas).map(p => `- [ ] 产出 delta 到 \`${p}\`。`))}\n## [code] 代码实现\n`);
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: LINT_RENDER_SLUG, module: 'core' }));
  for (const [rel, content] of Object.entries(deltas)) {
    const abs = join(proposalDir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  for (const [rel, content] of Object.entries(seeds)) {
    const abs = join(root, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { root, proposalDir, slug: LINT_RENDER_SLUG, cleanup };
}
