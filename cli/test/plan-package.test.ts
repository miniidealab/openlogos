/**
 * Plan Package 完成合同回归。测试结果由全局 OpenLogos reporter 写入 JSONL。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { proposalTemplate, tasksTemplate } from '../src/i18n.js';
import {
  PLAN_PACKAGE_CLI_CONTRACT_VERSION,
  PLAN_PACKAGE_CONTRACT_VERSION,
  PLAN_SECTION_REGISTRY,
  evaluateProposalStructure,
  sortCompletionIssues,
} from '../src/lib/plan-package-contract.js';
import { evaluatePlanPackage } from '../src/lib/plan-package.js';
import { isProposalTemplateFilled } from '../src/lib/proposal-lifecycle.js';
import { runChangeLint } from '../src/lib/change-lint.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = resolve(HERE, '..', 'dist', 'index.js');
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function clarification(locale: 'zh' | 'en'): string {
  const title = locale === 'zh' ? '决策澄清' : 'Decision Clarification';
  return [`## ${title}`, '', '```yaml',
    'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
    'impacts:', '  data:', '    status: none', '    reason: 无数据影响',
    '  compatibility:', '    status: none', '    reason: 无兼容选择',
    '  security_privacy:', '    status: none', '    reason: 无安全隐私影响',
    '  public_release:', '    status: none', '    reason: 无公开发布',
    '  external_commitment:', '    status: none', '    reason: 无外部承诺',
    'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
  ].join('\n');
}

function proposal(locale: 'zh' | 'en' = 'zh'): string {
  const authority = ['## Authority Impact', '', '```yaml', 'authority_impact:',
    '  schema: openlogos/authority-impact@1', '  applicability: not_applicable',
    '  evidence: [仅测试 Plan Package 结构，不改变业务事实归属]', '```', ''].join('\n');
  if (locale === 'en') return [
    '# Change Proposal: feat', '', '> module: core', '',
    '## Reason', 'Fix a plan convergence bug.', '',
    '## Change Type', 'Code level fix.', '',
    '## Scope', '- CLI plan package evaluation.', '',
    '## Deployment Impact',
    '- Deployment required: no', '- Deployment reason: local tests only', '- Affected environments: local',
    '- Data migration involved: no', '- Rollback plan required: no', '- Smoke required: no', '',
    '## Summary', 'Use one evaluator for all plan consumers.', '', authority, clarification('en'),
  ].join('\n');
  return [
    '# 变更提案：feat', '', '> module: core', '',
    '## 变更原因', '修复 plan 收敛故障。', '',
    '## 变更类型', '代码级缺陷修复。', '',
    '## 变更范围', '- CLI Plan Package evaluator。', '',
    '## 部署影响',
    '- 是否需要部署：否', '- 部署原因：仅本地测试', '- 影响环境：本地',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '让所有 plan 消费方共用一个 evaluator。', '', authority, clarification('zh'),
  ].join('\n');
}

function tasks(codeBody = '', delta = '- [ ] `deltas/test/core-S35-test-cases.md`：增加测试。'): string {
  return `# 任务\n\n## [delta] 规格变更\n${delta}\n\n## [code] 代码实现\n${codeBody}`;
}

function setup(locale: 'zh' | 'en' = 'zh', proposalText = proposal(locale), tasksText = tasks()) {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', product_type: 'cli' }],
  }));
  const dir = join(root, 'logos', 'changes', 'feat');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), proposalText);
  writeFileSync(join(dir, 'tasks.md'), tasksText);
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
  return { root, dir };
}

function snapshot(root: string): string {
  const hash = createHash('sha256');
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name); const st = statSync(full);
      hash.update(full.slice(root.length));
      if (st.isDirectory()) walk(full); else hash.update(readFileSync(full));
    }
  };
  walk(root); return hash.digest('hex');
}

function cli(root: string, args: string[]) {
  return spawnSync(process.execPath, [CLI_ENTRY, ...args], { cwd: root, encoding: 'utf8' });
}

describe('S09 Plan Package scaffold 与三态', () => {
  it('UT-S09-224: 中文 proposal canonical 章节齐全', () => {
    expect(evaluateProposalStructure(proposal('zh'))).toEqual([]);
    for (const row of Object.values(PLAN_SECTION_REGISTRY)) expect(proposal('zh')).toContain(`## ${row.zh}`);
  });
  it('UT-S09-225: 英文 proposal 共享语义 ID', () => {
    expect(evaluateProposalStructure(proposal('en'))).toEqual([]);
    for (const row of Object.values(PLAN_SECTION_REGISTRY)) expect(proposal('en')).toContain(`## ${row.en}`);
  });
  it('UT-S09-226: launched tasks 生成空 code 锚点', () => {
    for (const locale of ['zh', 'en'] as const) {
      const text = tasksTemplate(locale, true);
      expect(text).toContain('## [code]');
      expect(text).not.toMatch(/^- \[ \].*(?:实现代码变更|Implement code changes)$/m);
    }
  });
  it('UT-S09-227: plan 三态相互独立', () => {
    const f = setup();
    const plan = evaluatePlanPackage(f.root, f.dir);
    expect(plan.tasks).toMatchObject({ plan_filled: true, code_required: true, code_slices_filled: false });
    writeFileSync(join(f.dir, 'SPEC_MERGED'), '{}');
    writeFileSync(join(f.dir, 'tasks.md'), tasks('- [ ] 真实切片（覆盖 `UT-S09-227`）'));
    expect(evaluatePlanPackage(f.root, f.dir).tasks).toMatchObject({ plan_filled: true, code_required: true, code_slices_filled: true });
  });
  it('UT-S09-228: summary 改名不能被详细设计替代', () => {
    const text = proposal().replace('## 变更概述', '## 核心设计');
    expect(evaluateProposalStructure(text)).toContainEqual(expect.objectContaining({ code: 'proposal_required_section_missing', section_id: 'summary', expected: '变更概述' }));
  });
  it('UT-S09-229: plan code checkbox 精确拒绝', () => {
    const f = setup('zh', proposal(), tasks('- [ ] 提前实现'));
    expect(evaluatePlanPackage(f.root, f.dir).issues.map(i => i.code)).toContain('tasks_code_entry_before_spec_complete');
  });
  it('UT-S09-230: 历史 marker bypass 不回退', () => {
    const f = setup('zh', proposal().replace('## 变更概述', '## 核心设计'), tasks('- [ ] 历史代码'));
    writeFileSync(join(f.dir, 'SPEC_MERGED'), '{}');
    expect(evaluatePlanPackage(f.root, f.dir).ready).toBe(true);
  });
  it('UT-S09-231: proposal/tasks 脱模板后识别 ready-to-delta', () => {
    const f = setup();
    expect(evaluatePlanPackage(f.root, f.dir)).toMatchObject({ ready: true, proposal: { filled: true }, tasks: { plan_filled: true } });
  });
});

describe('S35 L0 统一 evaluator', () => {
  it('UT-S35-100: locale section registry', () => {
    expect(Object.keys(PLAN_SECTION_REGISTRY)).toEqual(['reason', 'type', 'scope', 'deployment', 'summary', 'clarification']);
    expect(new Set(Object.values(PLAN_SECTION_REGISTRY).flatMap(row => [row.zh, row.en])).size).toBe(12);
  });
  it('UT-S35-101: proposal missing/duplicate/empty', () => {
    const base = proposal();
    const cases = [
      base.replace(/## 变更概述\n[^\n]+\n/, ''),
      `${base}\n## 变更概述\n重复`,
      base.replace('让所有 plan 消费方共用一个 evaluator。', '<!-- empty -->'),
    ];
    expect(evaluateProposalStructure(cases[0]).some(i => i.code === 'proposal_required_section_missing')).toBe(true);
    expect(evaluateProposalStructure(cases[1]).some(i => i.code === 'proposal_required_section_duplicate')).toBe(true);
    expect(evaluateProposalStructure(cases[2]).some(i => i.code === 'proposal_required_section_empty')).toBe(true);
  });
  it('UT-S35-102: placeholder/type/deployment 非法聚合', () => {
    const text = proposal().replace('代码级缺陷修复。', '其他').replace('- 是否需要部署：否', '- 是否需要部署：待定').replace('修复 plan 收敛故障。', '[为什么要做这个变更？]');
    expect(evaluateProposalStructure(text).map(i => i.code)).toEqual(expect.arrayContaining(['proposal_placeholder_remaining', 'proposal_change_type_invalid', 'proposal_deployment_fields_invalid']));
  });
  it('UT-S35-104: tasks plan 模板残留', () => {
    const f = setup('zh', proposal(), tasks('', '- [ ] 更新需求文档的场景和验收条件'));
    expect(evaluatePlanPackage(f.root, f.dir).issues.map(i => i.code)).toContain('tasks_template_remaining');
  });
  it('UT-S35-105: code 三态', () => {
    const empty = setup();
    expect(evaluatePlanPackage(empty.root, empty.dir).tasks.code_slices_filled).toBe(false);
    const missing = setup('zh', proposal(), '# 任务\n\n## [delta]\n- [ ] `deltas/test/x.md`');
    expect(evaluatePlanPackage(missing.root, missing.dir).issues.map(i => i.code)).toContain('tasks_code_section_missing');
    writeFileSync(join(empty.dir, 'SPEC_MERGED'), '{}');
    writeFileSync(join(empty.dir, 'tasks.md'), tasks('- [ ] 切片（覆盖 `UT-S35-105`）'));
    expect(evaluatePlanPackage(empty.root, empty.dir).tasks.code_slices_filled).toBe(true);
  });
  it('UT-S35-106: L0 exit 分层', () => {
    const good = setup();
    expect(runChangeLint(good.root, good.dir, 'feat')).toMatchObject({ ok: true, plan_package: { ready: true } });
    const bad = setup('zh', proposal().replace('## 变更概述', '## 核心设计'));
    expect(runChangeLint(bad.root, bad.dir, 'feat')).toMatchObject({ ok: true, plan_package: { ready: false } });
  });
  it('UT-S35-107: legacy wrapper 与 evaluator 同结论', () => {
    expect(isProposalTemplateFilled(proposal())).toBe(true);
    const broken = proposal().replace('## 变更概述', '## 核心设计');
    expect(isProposalTemplateFilled(broken)).toBe(false);
  });
  it('UT-S35-108: issue 去重与 canonical 排序', () => {
    const issue = evaluateProposalStructure(proposal().replace('## 变更概述', '## 核心设计'))[0];
    expect(sortCompletionIssues([issue, issue])).toEqual([issue]);
  });
  it('UT-S35-109: plan 前沿等价仅约束 plan fixture', () => {
    const f = setup('zh', proposal().replace('## 变更概述', '## 核心设计'));
    expect(evaluatePlanPackage(f.root, f.dir).ready).toBe(false);
    writeFileSync(join(f.dir, 'PLAN_APPROVED'), '');
    expect(evaluatePlanPackage(f.root, f.dir).ready).toBe(true);
  });
  it('UT-S35-110: 只读问题不自修', () => {
    const f = setup('zh', proposal().replace('## 变更概述', '## 核心设计'));
    const before = snapshot(f.root); evaluatePlanPackage(f.root, f.dir); runChangeLint(f.root, f.dir, 'feat');
    expect(snapshot(f.root)).toBe(before);
  });
  it('UT-S35-111: completion/asset contract 绑定版本', () => {
    expect(PLAN_PACKAGE_CONTRACT_VERSION).toBe('1');
    expect(PLAN_PACKAGE_CLI_CONTRACT_VERSION).toBe('1.3.0');
  });
});

describe('Plan Package 现场闭环', () => {
  it('ST-S09-88: 中英文 change→lint 全链收敛', () => {
    for (const locale of ['zh', 'en'] as const) {
      const f = setup(locale);
      const result = runChangeLint(f.root, f.dir, 'feat');
      expect(result).toMatchObject({ ok: true, plan_package: { ready: true } });
    }
  });
  it('ST-S09-89: 现场双错一次返回并可修复', () => {
    const broken = proposal().replace('## 变更概述', '## 核心设计');
    const f = setup('zh', broken, tasks('- [ ] 提前实现'));
    const first = runChangeLint(f.root, f.dir, 'feat');
    expect(first.ok && first.plan_package.issues.map(i => i.code)).toEqual(['proposal_required_section_missing', 'tasks_code_entry_before_spec_complete']);
    writeFileSync(join(f.dir, 'proposal.md'), proposal()); writeFileSync(join(f.dir, 'tasks.md'), tasks());
    expect(runChangeLint(f.root, f.dir, 'feat')).toMatchObject({ ok: true, plan_package: { ready: true } });
  });
  it('ST-S35-16: 真实 CLI 复现双错且 exit 2', () => {
    const f = setup('zh', proposal().replace('## 变更概述', '## 核心设计'), tasks('- [ ] 提前实现'));
    const out = cli(f.root, ['change-lint', '--format', 'json']);
    expect(out.status).toBe(2);
    expect(JSON.parse(out.stdout).data.plan_package.issues.map((i: { code: string }) => i.code)).toEqual(['proposal_required_section_missing', 'tasks_code_entry_before_spec_complete']);
  });
  it('ST-S35-17: 修复后 L0 与 lint 同时全绿', () => {
    const f = setup(); const out = cli(f.root, ['change-lint', '--format', 'json']);
    expect(out.status).toBe(0); expect(JSON.parse(out.stdout).data).toMatchObject({ pass: true, plan_package: { ready: true } });
  });
  it('ST-S35-18: success/fail/history/zh/en 全部只读', () => {
    for (const locale of ['zh', 'en'] as const) {
      const f = setup(locale); const before = snapshot(f.root); cli(f.root, ['change-lint', '--format', 'json']);
      expect(snapshot(f.root)).toBe(before);
    }
  });
});
