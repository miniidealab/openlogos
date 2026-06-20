/**
 * S09 flow-derive-launched（M1 切片 B2）——引擎 UT + 测试期「ViaFlow==旧 detectProposalStep」并跑等价矩阵。
 *
 * 用例 ID 与 logos/resources/test/core-S09-test-cases.md 严格对齐（UT-S09-21~50 / ST-S09-14~26）。
 * 并跑断言仅测试期：对每个 ProposalStep 态与边角，断言 detectProposalStepViaFlow 与旧
 * detectProposalStep 返回相等，证明 launched flow 派生 1:1 不改行为。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot } from './helpers.js';
import { detectProposalStep, collectStatusData, type ModuleInfo } from '../src/commands/status.js';
import { detectProposalStepViaFlow } from '../src/lib/flow-derive.js';
import { loadBuiltinFlow } from '../src/lib/flow.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

interface ProposalOpts { proposal?: string; tasks?: string; markers?: string[]; smokeCases?: boolean; }

/** 建提案目录，返回 { dir, root }。smokeCases=true 时在 root/logos/resources/test/smoke 放用例。 */
function makeProposal(opts: ProposalOpts): { dir: string; root: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  const dir = join(root, 'logos', 'changes', 'feat');
  mkdirSync(join(dir, 'deltas'), { recursive: true });
  if (opts.proposal !== undefined) writeFileSync(join(dir, 'proposal.md'), opts.proposal);
  if (opts.tasks !== undefined) writeFileSync(join(dir, 'tasks.md'), opts.tasks);
  for (const mk of opts.markers ?? []) writeFileSync(join(dir, mk), '');
  if (opts.smokeCases) {
    const smokeDir = join(root, 'logos', 'resources', 'test', 'smoke');
    mkdirSync(smokeDir, { recursive: true });
    writeFileSync(join(smokeDir, 'core-smoke.md', ), 'smoke case');
  }
  return { dir, root };
}

/** 已填提案（deploy/smoke 经 ## 部署影响 字段控制）。 */
function filled(deploy: '是' | '否' = '否', smoke: '是' | '否' = '否'): string {
  return [
    '# 变更提案：feat', '', '## 变更原因', '需要新能力。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01-feature-specs', '', '## 部署影响',
    `- 是否需要部署：${deploy}`, '- 部署原因：说明', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', `- 是否需要 smoke：${smoke}`, '',
    '## 变更概述', '概述。',
  ].join('\n');
}
/** 已填正文但部署字段为占位符 → 提案级决策为 null，回退 tasks 源（smoke_required=null）。 */
function undeclaredDeploy(): string {
  return [
    '# 变更提案：feat', '', '## 变更原因', '需要新能力。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01-feature-specs', '', '## 部署影响',
    '- 是否需要部署：是 / 否', '', '## 变更概述', '概述。',
  ].join('\n');
}
const TEMPLATE = [
  '# 变更提案：feat', '', '## 变更原因', '[为什么要做这个变更？来源于哪个需求/反馈/Bug？]', '',
  '## 变更类型', '[需求级 / 设计级 / 接口级 / 代码级]', '', '## 变更范围', '- 影响的需求文档：[列表]', '',
  '## 部署影响', '- 是否需要部署：是 / 否', '', '## 变更概述', '[用 1-3 段话概述具体改什么]',
].join('\n');

const DELTA_PARTIAL = '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta';
const DELTA_DONE = '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta';
const DELTA_EMPTY = '# 任务\n\n## [delta] 规格变更\n';
const CODE_DONE = '# 任务\n\n## [code] 代码实现\n- [x] 实现';
const DELTA_DONE_CODE_PARTIAL = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] c';
const DELTA_DONE_CODE_DONE = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [x] c';
const DELTA_DONE_CODE_EMPTY = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n';
const DEPLOY_DONE_TASKS = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [deploy] 部署\n- [x] 部署';
const DEPLOY_PARTIAL_TASKS = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [deploy] 部署\n- [ ] 部署';
const DEPLOY_EMPTY_TASKS = '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [deploy] 部署\n';
const OLDFMT_DONE = '# 任务\n- [x] 全部完成';
const OLDFMT_PARTIAL = '# 任务\n- [ ] 未完成';
const DEP: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'> = { deployment_required: true };

function withMergeableDelta(dir: string): string {
  mkdirSync(join(dir, 'deltas', 'spec'), { recursive: true });
  writeFileSync(join(dir, 'deltas', 'spec', 'x.md'), 'x');
  return dir;
}

interface UtCase { ut: string; expected: string; mk?: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'>; build: () => string; }

const UT: UtCase[] = [
  { ut: 'UT-S09-21', expected: 'writing', build: () => makeProposal({ proposal: TEMPLATE, tasks: DELTA_PARTIAL }).dir },
  { ut: 'UT-S09-22', expected: 'delta-writing', build: () => makeProposal({ proposal: filled(), tasks: DELTA_PARTIAL }).dir },
  { ut: 'UT-S09-23', expected: 'ready-to-merge', build: () => makeProposal({ proposal: filled(), tasks: DELTA_DONE }).dir },
  { ut: 'UT-S09-24', expected: 'merge-generated', build: () => makeProposal({ proposal: filled(), tasks: DELTA_DONE, markers: ['MERGE_PROMPT_GENERATED'] }).dir },
  { ut: 'UT-S09-25', expected: 'merge-generated', build: () => makeProposal({ proposal: filled(), tasks: DELTA_DONE, markers: ['MERGE_PROMPT.md'] }).dir },
  { ut: 'UT-S09-26', expected: 'coding', build: () => makeProposal({ proposal: filled(), tasks: DELTA_DONE_CODE_PARTIAL, markers: ['SPEC_MERGED'] }).dir },
  { ut: 'UT-S09-27', expected: 'coding', build: () => makeProposal({ proposal: filled(), tasks: DELTA_DONE_CODE_PARTIAL, markers: ['MERGED'] }).dir },
  { ut: 'UT-S09-28', expected: 'ready-to-verify', build: () => makeProposal({ proposal: filled(), tasks: DELTA_DONE_CODE_DONE, markers: ['SPEC_MERGED'] }).dir },
  { ut: 'UT-S09-29', expected: 'ready-to-verify', build: () => makeProposal({ proposal: filled(), tasks: CODE_DONE }).dir },
  { ut: 'UT-S09-30', expected: 'ready-to-verify', build: () => makeProposal({ proposal: filled(), tasks: OLDFMT_DONE, markers: ['SPEC_MERGED'] }).dir },
  { ut: 'UT-S09-31', expected: 'ready-to-merge', build: () => withMergeableDelta(makeProposal({ proposal: filled(), tasks: OLDFMT_DONE }).dir) },
  { ut: 'UT-S09-32', expected: 'delta-writing', build: () => withMergeableDelta(makeProposal({ proposal: filled(), tasks: OLDFMT_PARTIAL }).dir) },
  { ut: 'UT-S09-33', expected: 'verify-passed', build: () => makeProposal({ proposal: filled('否'), tasks: DELTA_DONE, markers: ['VERIFY_PASS'] }).dir },
  { ut: 'UT-S09-34', expected: 'verify-passed', build: () => makeProposal({ proposal: filled('否'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS'] }).dir },
  { ut: 'UT-S09-35', expected: 'verify-failed', build: () => makeProposal({ proposal: filled(), tasks: DELTA_DONE, markers: ['VERIFY_FAIL'] }).dir },
  { ut: 'UT-S09-36', expected: 'ready-to-deploy', mk: DEP, build: () => makeProposal({ proposal: filled('是', '否'), tasks: DEPLOY_EMPTY_TASKS, markers: ['VERIFY_PASS'] }).dir },
  { ut: 'UT-S09-37', expected: 'ready-to-deploy', mk: DEP, build: () => makeProposal({ proposal: filled('是', '否'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS'] }).dir },
  { ut: 'UT-S09-38', expected: 'ready-to-deploy', mk: DEP, build: () => makeProposal({ proposal: filled('是', '否'), tasks: DEPLOY_PARTIAL_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'] }).dir },
  { ut: 'UT-S09-39', expected: 'deploy-done', mk: DEP, build: () => makeProposal({ proposal: filled('是', '否'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'] }).dir },
  { ut: 'UT-S09-40', expected: 'deploy-done', build: () => makeProposal({ proposal: undeclaredDeploy(), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'] }).dir },
  { ut: 'UT-S09-41', expected: 'ready-to-smoke', mk: DEP, build: () => makeProposal({ proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'] }).dir },
  { ut: 'UT-S09-42', expected: 'ready-to-smoke', build: () => makeProposal({ proposal: undeclaredDeploy(), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'], smokeCases: true }).dir },
  { ut: 'UT-S09-43', expected: 'smoke-passed', mk: DEP, build: () => makeProposal({ proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS'] }).dir },
  { ut: 'UT-S09-44', expected: 'smoke-failed', mk: DEP, build: () => makeProposal({ proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_FAIL'] }).dir },
  { ut: 'UT-S09-45', expected: 'verify-failed', build: () => makeProposal({ proposal: TEMPLATE, tasks: DELTA_PARTIAL, markers: ['VERIFY_FAIL', 'SPEC_MERGED'] }).dir },
  { ut: 'UT-S09-46', expected: 'ready-to-deploy', mk: DEP, build: () => makeProposal({ proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'SMOKE_PASS'] }).dir },
  { ut: 'UT-S09-47', expected: 'ready-to-deploy', mk: DEP, build: () => makeProposal({ proposal: filled('是', '是'), tasks: DEPLOY_PARTIAL_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS'] }).dir },
  { ut: 'UT-S09-48', expected: 'coding', build: () => makeProposal({ proposal: filled(), tasks: DELTA_DONE_CODE_EMPTY, markers: ['SPEC_MERGED'] }).dir },
  { ut: 'UT-S09-49', expected: 'delta-writing', build: () => makeProposal({ proposal: filled(), tasks: DELTA_EMPTY }).dir },
  { ut: 'UT-S09-50', expected: 'verify-passed', mk: DEP, build: () => makeProposal({ proposal: filled('是', '是'), tasks: DELTA_DONE, markers: ['VERIFY_PASS'] }).dir },
];

describe('S09 launched flow-derive 引擎 UT（ViaFlow 期望值 + 与旧 detectProposalStep 并跑等价）', () => {
  for (const c of UT) {
    it(`${c.ut}: → ${c.expected}（ViaFlow==legacy）`, () => {
      const dir = c.build();
      const md = c.mk ?? {};
      const viaFlow = detectProposalStepViaFlow(dir, md);
      expect(viaFlow).toBe(c.expected);
      expect(viaFlow).toBe(detectProposalStep(dir, md));
    });
  }
});

// ── ST-S09-14~26：按规格语义的并跑等价（每个 ST 覆盖其类别） ──
function eq(dir: string, md: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'> = {}): string {
  const v = detectProposalStepViaFlow(dir, md);
  expect(v).toBe(detectProposalStep(dir, md));
  return v;
}

describe('S09 launched flow-derive 测试期并跑等价矩阵', () => {
  it('ST-S09-14: writing / delta-writing / ready-to-merge 等价', () => {
    expect(eq(makeProposal({ proposal: TEMPLATE, tasks: DELTA_PARTIAL }).dir)).toBe('writing');
    expect(eq(makeProposal({ proposal: filled(), tasks: DELTA_PARTIAL }).dir)).toBe('delta-writing');
    expect(eq(makeProposal({ proposal: filled(), tasks: DELTA_DONE }).dir)).toBe('ready-to-merge');
  });
  it('ST-S09-15: merge-generated 等价（两种 marker）', () => {
    expect(eq(makeProposal({ proposal: filled(), tasks: DELTA_DONE, markers: ['MERGE_PROMPT_GENERATED'] }).dir)).toBe('merge-generated');
    expect(eq(makeProposal({ proposal: filled(), tasks: DELTA_DONE, markers: ['MERGE_PROMPT.md'] }).dir)).toBe('merge-generated');
  });
  it('ST-S09-16: coding 等价（SPEC_MERGED 与旧 MERGED）', () => {
    expect(eq(makeProposal({ proposal: filled(), tasks: DELTA_DONE_CODE_PARTIAL, markers: ['SPEC_MERGED'] }).dir)).toBe('coding');
    expect(eq(makeProposal({ proposal: filled(), tasks: DELTA_DONE_CODE_PARTIAL, markers: ['MERGED'] }).dir)).toBe('coding');
  });
  it('ST-S09-17: ready-to-verify 等价（纯代码无 [delta] / 旧格式无 section）', () => {
    expect(eq(makeProposal({ proposal: filled(), tasks: CODE_DONE }).dir)).toBe('ready-to-verify');
    expect(eq(makeProposal({ proposal: filled(), tasks: OLDFMT_DONE, markers: ['SPEC_MERGED'] }).dir)).toBe('ready-to-verify');
  });
  it('ST-S09-18: verify-passed 等价（无需部署 / 部署决策冲突）', () => {
    expect(eq(makeProposal({ proposal: filled('否'), tasks: DELTA_DONE, markers: ['VERIFY_PASS'] }).dir)).toBe('verify-passed');
    expect(eq(makeProposal({ proposal: filled('否'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS'] }).dir)).toBe('verify-passed');
  });
  it('ST-S09-19: verify-failed 等价（VERIFY_FAIL 全局优先，含与 SPEC_MERGED/未填提案并存）', () => {
    expect(eq(makeProposal({ proposal: filled(), tasks: DELTA_DONE, markers: ['VERIFY_FAIL'] }).dir)).toBe('verify-failed');
    expect(eq(makeProposal({ proposal: TEMPLATE, tasks: DELTA_PARTIAL, markers: ['VERIFY_FAIL', 'SPEC_MERGED'] }).dir)).toBe('verify-failed');
  });
  it('ST-S09-20: ready-to-deploy 等价（无 deploy 任务 / DEPLOY_DONE 缺 / 任务未全勾）', () => {
    expect(eq(makeProposal({ proposal: filled('是', '否'), tasks: DEPLOY_EMPTY_TASKS, markers: ['VERIFY_PASS'] }).dir, DEP)).toBe('ready-to-deploy');
    expect(eq(makeProposal({ proposal: filled('是', '否'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS'] }).dir, DEP)).toBe('ready-to-deploy');
    expect(eq(makeProposal({ proposal: filled('是', '否'), tasks: DEPLOY_PARTIAL_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'] }).dir, DEP)).toBe('ready-to-deploy');
  });
  it('ST-S09-21: deploy-done 等价（smoke_required=false / smoke 未声明且无 smoke 用例）', () => {
    expect(eq(makeProposal({ proposal: filled('是', '否'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'] }).dir, DEP)).toBe('deploy-done');
    expect(eq(makeProposal({ proposal: undeclaredDeploy(), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'] }).dir)).toBe('deploy-done');
  });
  it('ST-S09-22: ready-to-smoke 等价（smoke_required=true / smoke 未声明但有 smoke 用例）', () => {
    expect(eq(makeProposal({ proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'] }).dir, DEP)).toBe('ready-to-smoke');
    expect(eq(makeProposal({ proposal: undeclaredDeploy(), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE'], smokeCases: true }).dir)).toBe('ready-to-smoke');
  });
  it('ST-S09-23: smoke-passed / smoke-failed 等价（SMOKE_FAIL 优先于 SMOKE_PASS）', () => {
    expect(eq(makeProposal({ proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS'] }).dir, DEP)).toBe('smoke-passed');
    expect(eq(makeProposal({ proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_FAIL', 'SMOKE_PASS'] }).dir, DEP)).toBe('smoke-failed');
  });
  it('ST-S09-24: 旧格式兜底等价（mergeableDelta + allTasksChecked）', () => {
    expect(eq(withMergeableDelta(makeProposal({ proposal: filled(), tasks: OLDFMT_DONE }).dir))).toBe('ready-to-merge');
    expect(eq(withMergeableDelta(makeProposal({ proposal: filled(), tasks: OLDFMT_PARTIAL }).dir))).toBe('delta-writing');
  });
  it('ST-S09-25: 边角①②③ 等价（VERIFY_FAIL 全局 / SMOKE 非全局 / 空 section）', () => {
    expect(eq(makeProposal({ proposal: TEMPLATE, tasks: DELTA_PARTIAL, markers: ['VERIFY_FAIL', 'SPEC_MERGED'] }).dir)).toBe('verify-failed');
    expect(eq(makeProposal({ proposal: filled('是', '是'), tasks: DEPLOY_DONE_TASKS, markers: ['VERIFY_PASS', 'SMOKE_PASS'] }).dir, DEP)).toBe('ready-to-deploy');
    expect(eq(makeProposal({ proposal: filled(), tasks: DELTA_DONE_CODE_EMPTY, markers: ['SPEC_MERGED'] }).dir)).toBe('coding');
    expect(eq(makeProposal({ proposal: filled(), tasks: DELTA_EMPTY }).dir)).toBe('delta-writing');
  });
  it('ST-S09-26: golden 零漂移——launched 提案 status 输出的 proposal_step 与旧逻辑一致', () => {
    // collectStatusData（内部已用 ViaFlow）输出的 proposal_step 应等于旧 detectProposalStep，证明 status 输出不漂移
    const { root, dir } = makeProposal({ proposal: filled(), tasks: DELTA_DONE_CODE_PARTIAL, markers: ['SPEC_MERGED'] });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'feat', name: 'Feat', lifecycle: 'launched' }] }, { lineWidth: 0 }));
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'feat' }));
    const data = collectStatusData(root);
    const mod = data.modules!.find(m => m.id === 'feat')!;
    expect(mod.active_change?.proposal_step).toBe(detectProposalStep(dir));
  });
});

// ── #3 漂移守卫：launched.yaml 的节点序列/谓词须与引擎假设一致 ──
describe('S09 launched flow 漂移守卫', () => {
  it('launched.yaml 节点 id 顺序与关键 done_when/fail_when 与引擎假设一致（漂移即失败）', () => {
    const flow = loadBuiltinFlow('launched');
    const ids = flow.subflows.flatMap(s => s.nodes.map(n => n.id));
    expect(ids).toEqual([
      'write-proposal', 'write-delta', 'generate-merge-prompt', 'apply-merge',
      'code', 'verify', 'deploy', 'smoke', 'archive',
    ]);
    const byId = Object.fromEntries(flow.subflows.flatMap(s => s.nodes).map(n => [n.id, n]));
    // marker / any_present 谓词
    expect(byId['verify'].done_when).toBe('marker:VERIFY_PASS');
    expect(byId['verify'].fail_when).toBe('marker:VERIFY_FAIL');
    expect(byId['deploy'].done_when).toBe('marker:DEPLOY_DONE');
    expect(byId['smoke'].done_when).toBe('marker:SMOKE_PASS');
    expect(byId['smoke'].fail_when).toBe('marker:SMOKE_FAIL');
    expect(byId['generate-merge-prompt'].done_when).toContain('MERGE_PROMPT_GENERATED');
    expect(byId['apply-merge'].done_when).toContain('SPEC_MERGED');
    expect(byId['apply-merge'].done_when).toContain('MERGED');
    // section / proposal / when 谓词（引擎硬编码语义所依赖，漂移须报警）
    expect(byId['write-proposal'].done_when).toBe('proposal_package_filled');
    expect(byId['write-delta'].done_when).toBe('section_complete:delta');
    expect(byId['write-delta'].when).toBe('delta_required');
    expect(byId['code'].done_when).toBe('section_complete:code');
    expect(byId['deploy'].when).toBe('deployment_required');
    expect(byId['smoke'].when).toBe('smoke_required');
    expect(byId['archive'].done_when).toBe('archived');
  });
});
