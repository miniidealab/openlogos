/**
 * S09 — Plan 阶段决策澄清协议（clarification@1）。
 * 测试 ID 与 logos/resources/test/core-S09-test-cases.md §十四严格对齐；
 * Vitest 全局 OpenLogos reporter 会把每个 ID 写入 test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  CLARIFICATION_CATEGORIES,
  CLARIFICATION_SCHEMA,
  evaluateProposalClarification,
  validateClarificationOutput,
  type ClarificationCategory,
  type ClarificationOutput,
} from '../src/lib/clarification.js';
import {
  derivePlanState,
  detectProposalStep,
  isProposalTemplateFilled,
  resolveProposalDeploymentDecision,
} from '../src/lib/proposal-lifecycle.js';
import { collectStatusData } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import { proposalTemplate } from '../src/i18n.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { captureConsole, makeTempRoot, mockCwd, scaffoldProject } from './helpers.js';

type Doc = Record<string, any>;
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function impacts(overrides: Record<string, 'none' | 'required'> = {}): Doc {
  return Object.fromEntries(['data', 'compatibility', 'security_privacy', 'public_release', 'external_commitment']
    .map(key => [key, { status: overrides[key] ?? 'none', reason: `${key} 的确定性依据` }]));
}

function decision(id: string, category: ClarificationCategory, source: 'user' | 'policy' | 'repository_fact' = 'user'): Doc {
  return {
    id, category, question: `${category} 怎么选？`, answer: '采用推荐方案', rationale: '用户明确确认', source,
    affects: ['proposal'], rejected_options: ['不采用'],
  };
}

function unresolved(id: string, category: ClarificationCategory, depends_on: string[] = []): Doc {
  return {
    id, category, depends_on, question: `${category} 怎么选？`, impact: `影响 ${category}`,
    recommendation: '采用兼容方案', recommendation_reason: '风险最低',
    options: [{ id: 'recommended', label: '推荐方案', tradeoff: '实现成本略高' }],
  };
}

function completeDoc(): Doc {
  return { schema: CLARIFICATION_SCHEMA, mode: 'adaptive', status: 'complete', impacts: impacts(), decisions: [], unresolved: [], defaults: [] };
}

function pendingDoc(category: ClarificationCategory, impactKey?: string): Doc {
  const override = impactKey ? { [impactKey]: 'required' as const } : {};
  return {
    schema: CLARIFICATION_SCHEMA, mode: 'adaptive', status: 'pending', impacts: impacts(override),
    decisions: [], unresolved: [unresolved('C01', category)], defaults: [],
  };
}

function proposal(doc: Doc | null, deploy = false): string {
  const clarification = doc === null ? '' : [
    '', '## 决策澄清', '', '```yaml', stringifyYaml(doc, { lineWidth: 0 }).trimEnd(), '```',
  ].join('\n');
  return [
    '# 变更提案：feat', '', '## 变更原因', '需要实现决策澄清。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- 影响的业务场景：S09', '', '## 部署影响',
    `- 是否需要部署：${deploy ? '是' : '否'}`, '- 部署原因：本地验证', '- 影响环境：本地',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', `- 是否需要 smoke：${deploy ? '是' : '否'}`,
    '', '## UI/UX 变更声明', '', '```yaml', 'ui_impact: false', 'design_system_mode: generated',
    'design_system_fallback_reason: ""', 'pages: []', '```', clarification,
    '', '## 变更概述', '实现完整 clarification 状态机。', '',
  ].join('\n');
}

function evaluate(doc: Doc | null, deploy = false) {
  return evaluateProposalClarification(proposal(doc, deploy), deploy);
}

function proposalWithClarificationBlocks(docs: Doc[]): string {
  const blocks = docs.map(doc => ['```yaml', stringifyYaml(doc, { lineWidth: 0 }).trimEnd(), '```'].join('\n'));
  return proposal(null).replace(
    '\n\n## 变更概述',
    `\n\n## 决策澄清\n\n${blocks.join('\n\n')}\n\n## 变更概述`,
  );
}

function filledInitialTemplate(): string {
  return proposalTemplate('zh', 'feat', 'core')
    .replace('[为什么要做这个变更？来源于哪个需求/反馈/Bug？]', '修复决策澄清模板完成谓词。')
    .replace('[需求级 / 设计级 / 接口级 / 代码级]', '代码级')
    .replaceAll('[列表]', '无')
    .replace('- 是否需要部署：是 / 否', '- 是否需要部署：否')
    .replace('- 部署原因：[说明为什么需要或不需要部署]', '- 部署原因：仅修改本地解析逻辑')
    .replace('- 影响环境：[本地 / 测试 / 预发 / 生产 / 无]', '- 影响环境：本地')
    .replace('- 是否涉及数据迁移：是 / 否', '- 是否涉及数据迁移：否')
    .replace('- 是否需要回滚预案：是 / 否', '- 是否需要回滚预案：否')
    .replace('- 是否需要 smoke：是 / 否', '- 是否需要 smoke：否')
    .replace('[用 1-3 段话概述具体改什么]', '保持初始澄清为保守未完成状态。');
}

function setup(doc: Doc | null, deploy = false): { root: string; dir: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    project: { name: 'clarification' },
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: deploy, smoke_required: deploy } },
  }, { lineWidth: 0 }));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
  const dir = join(root, 'logos', 'changes', 'feat');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), proposal(doc, deploy));
  writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [ ] 产出 delta\n\n## [code] 代码实现\n');
  return { root, dir };
}

function statusClarification(root: string): ClarificationOutput {
  return collectStatusData(root).modules![0].active_change!.plan_state!.clarification!;
}

async function nextData(root: string, auto = false): Promise<any> {
  const restore = mockCwd(root);
  const con = captureConsole();
  try { await next('json', undefined, auto); }
  finally { con.restore(); restore(); }
  return JSON.parse(con.logs.at(-1)!).data;
}

function ajvFor(schemaName: 'status' | 'next') {
  const schema = JSON.parse(readFileSync(join(process.cwd(), '..', 'spec', 'schema', `${schemaName}.schema.json`), 'utf8'));
  const ajv = new Ajv2020({ strict: false, allowUnionTypes: true });
  addFormats(ajv);
  return { ajv, schema };
}

describe('S09 clarification@1 — 结构解析与确定性校验', () => {
  it('UT-S09-152: 提取唯一 clarification@1 YAML 区块', () => {
    const result = evaluate(completeDoc());
    expect(result).toMatchObject({ present: true, valid: true, output: { schema: CLARIFICATION_SCHEMA, mode: 'adaptive', status: 'complete' } });

    const invalid = completeDoc();
    delete invalid.impacts.compatibility;
    for (const docs of [[completeDoc(), invalid], [invalid, completeDoc()]]) {
      const duplicated = evaluateProposalClarification(proposalWithClarificationBlocks(docs), false);
      expect(duplicated).toMatchObject({
        valid: false,
        issues: ['决策澄清章节必须且只能包含一个 YAML 围栏'],
        output: { status: 'invalid', reason: 'clarification-contract-invalid' },
      });
    }
  });

  it('UT-S09-153: 五类 impacts 完整合法', () => {
    expect(evaluate(completeDoc()).output.required_categories).toEqual([]);
  });

  it('UT-S09-154: impacts 缺字段 fail-closed', () => {
    const doc = completeDoc(); delete doc.impacts.security_privacy;
    expect(evaluate(doc).output.reason).toBe('clarification-contract-invalid');
  });

  it('UT-S09-155: impacts 未知状态 fail-closed', () => {
    const doc = completeDoc(); doc.impacts.data.status = 'maybe';
    expect(evaluate(doc).valid).toBe(false);
  });

  it('UT-S09-156: impacts 空理由 fail-closed', () => {
    const doc = completeDoc(); doc.impacts.compatibility.reason = '  ';
    expect(evaluate(doc).issues).toContain('clarification.impacts.compatibility 非法');
  });

  it('UT-S09-157: category 闭合枚举', () => {
    for (const category of CLARIFICATION_CATEGORIES) expect(evaluate(pendingDoc(category)).output.status).toBe('pending');
    const doc = pendingDoc('product'); doc.unresolved[0].category = 'unknown';
    expect(evaluate(doc).output.status).toBe('invalid');
  });

  it('UT-S09-158: CXX 格式与全局局部唯一', () => {
    for (const id of ['C00', 'C001']) { const doc = pendingDoc('product'); doc.unresolved[0].id = id; expect(evaluate(doc).valid).toBe(false); }
    const doc = pendingDoc('product'); doc.decisions = [decision('C01', 'ownership')];
    expect(evaluate(doc).issues.some(issue => issue.includes('全局唯一'))).toBe(true);
  });

  it('UT-S09-159: depends_on 不存在被拒', () => {
    const doc = pendingDoc('data', 'data'); doc.unresolved[0].depends_on = ['C99'];
    expect(evaluate(doc).issues.join(' ')).toContain('C99');
  });

  it('UT-S09-160: depends_on 循环被拒', () => {
    const doc = pendingDoc('product');
    doc.unresolved = [unresolved('C01', 'product', ['C02']), unresolved('C02', 'ownership', ['C01'])];
    expect(evaluate(doc).issues).toContain('unresolved.depends_on 存在循环依赖');
  });

  it('UT-S09-161: complete 与 unresolved 冲突', () => {
    const doc = completeDoc(); doc.unresolved = [unresolved('C01', 'product')];
    expect(evaluate(doc).output.status).toBe('invalid');
  });
});

describe('S09 clarification@1 — 条件性必选用户决定', () => {
  it('UT-S09-162: data required 匹配完整问题', () => {
    expect(evaluate(pendingDoc('data', 'data')).output).toMatchObject({ status: 'pending', reason: 'data-clarification-required', required_categories: ['data'], next_decision_id: 'C01' });
  });

  it('UT-S09-163: compatibility 仅 user 决定满足', () => {
    const doc = pendingDoc('compatibility', 'compatibility'); doc.decisions = [decision('C02', 'compatibility', 'policy')];
    expect(evaluate(doc).output.reason).toBe('compatibility-clarification-required');
    doc.decisions[0].source = 'user'; doc.status = 'complete'; doc.unresolved = [];
    expect(evaluate(doc).output.status).toBe('complete');
  });

  it('UT-S09-164: security_privacy required 可恢复 pending', () => {
    expect(evaluate(pendingDoc('security_privacy', 'security_privacy')).output.reason).toBe('security-privacy-clarification-required');
  });

  it('UT-S09-165: 部署字段派生 deployment 必选类别', () => {
    expect(evaluate(pendingDoc('deployment'), true).output).toMatchObject({ required_categories: ['deployment'], reason: 'deployment-clarification-required' });
  });

  it('UT-S09-166: public_release 映射 release 且不被 deployment 替代', () => {
    const doc = pendingDoc('release', 'public_release'); doc.decisions = [decision('C02', 'deployment')];
    expect(evaluate(doc).output.required_categories).toContain('release');
  });

  it('UT-S09-167: external_commitment 可恢复 pending', () => {
    expect(evaluate(pendingDoc('external_commitment', 'external_commitment')).output.reason).toBe('external-commitment-clarification-required');
  });

  it('UT-S09-168: 推荐答案或非 user source 不得冒充决定', () => {
    const doc = pendingDoc('data', 'data'); doc.decisions = [decision('C02', 'data', 'repository_fact')];
    expect(evaluate(doc).output.required_categories).toEqual(['data']);
  });

  it('UT-S09-168a: 必选类别缺对应 unresolved 判 invalid', () => {
    const doc = completeDoc(); doc.status = 'pending'; doc.impacts.data.status = 'required';
    expect(evaluate(doc).output).toMatchObject({ status: 'invalid', reason: 'clarification-contract-invalid', next_decision: null });
  });

  it('UT-S09-169: none 加合法理由不产生问答', () => {
    expect(evaluate(completeDoc()).output).toMatchObject({ status: 'complete', required: false, required_categories: [] });
  });

  it('UT-S09-170: required_categories 去重与固定排序', () => {
    const doc = pendingDoc('deployment');
    doc.impacts.data.status = 'required';
    doc.unresolved = [unresolved('C01', 'data'), unresolved('C02', 'deployment')];
    expect(evaluate(doc, true).output.required_categories).toEqual(['data', 'deployment']);
  });
});

describe('S09 clarification@1 — 完成谓词、JSON 与 auto', () => {
  it('UT-S09-171: proposal_filled 加强谓词全真路径', () => {
    expect(isProposalTemplateFilled(proposal(completeDoc()))).toBe(true);
    expect(isProposalTemplateFilled(proposal(pendingDoc('product')))).toBe(false);
  });

  it('UT-S09-172: status 输出完整 clarification', () => {
    const { root } = setup(pendingDoc('data', 'data'));
    const data = collectStatusData(root);
    expect(data.contract.version).toBe('1.2.0');
    expect(data.modules![0].active_change!.plan_state!.clarification).toMatchObject({ next_decision_id: 'C01', required_categories: ['data'] });
  });

  it('UT-S09-173: next 与 status clarification 同义', async () => {
    const { root } = setup(pendingDoc('product'));
    expect((await nextData(root)).modules[0].plan_state.clarification).toEqual(statusClarification(root));
  });

  it('UT-S09-174: 队首依赖未满足直接判契约非法', () => {
    const doc = pendingDoc('ownership'); doc.unresolved = [unresolved('C02', 'ownership', ['C01']), unresolved('C03', 'product')];
    expect(evaluate(doc).output).toMatchObject({ status: 'invalid', next_decision: null });
  });

  it('UT-S09-174a: 稳定拓扑序三方选择同一队首', async () => {
    const doc = pendingDoc('ownership'); doc.unresolved = [unresolved('C01', 'ownership'), unresolved('C02', 'data', ['C01'])];
    const { root } = setup(doc);
    expect(statusClarification(root).next_decision_id).toBe('C01');
    expect((await nextData(root)).modules[0].plan_state.clarification.next_decision_id).toBe('C01');
    const unstable = pendingDoc('product');
    unstable.unresolved = [unresolved('C01', 'ownership'), unresolved('C02', 'product')];
    expect(evaluate(unstable).issues).toContain('unresolved 未按固定类别/CXX 稳定拓扑序持久化');
  });

  it('UT-S09-175: auto pending 不写任何批准 marker', async () => {
    const { root, dir } = setup(pendingDoc('product'));
    await nextData(root, true);
    expect(existsSync(join(dir, 'PLAN_APPROVED'))).toBe(false);
    expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(false);
  });

  it('UT-S09-176: 跨进程重读状态一致', () => {
    const content = proposal(pendingDoc('product'));
    expect(evaluateProposalClarification(content, false).output).toEqual(evaluateProposalClarification(content, false).output);
  });
});

describe('S09 clarification@1 — 模板、兼容与 lint', () => {
  it('UT-S09-177: 新提案模板保持保守未完成且占位理由不可冒充事实', () => {
    for (const locale of ['zh', 'en'] as const) {
      const template = proposalTemplate(locale, 'feat', 'core');
      expect(template).toContain('openlogos/clarification@1');
      expect(template).toContain('status: pending');
      expect(evaluateProposalClarification(template, null)).toMatchObject({
        valid: false,
        output: { status: 'invalid', reason: 'clarification-contract-invalid' },
      });
      expect(isProposalTemplateFilled(template)).toBe(false);
      expect(evaluateProposalClarification(template.replace('status: pending', 'status: complete'), null).valid).toBe(false);
    }
  });

  it('UT-S09-178: writing legacy 缺区块仅提示补齐', () => {
    expect(evaluate(null).output).toMatchObject({ status: 'invalid', reason: 'legacy-clarification-backfill-required' });
  });

  it('UT-S09-179: 已越过 plan 历史提案不回退', () => {
    const { dir } = setup(null); writeFileSync(join(dir, 'SPEC_MERGED'), '');
    expect(detectProposalStep(dir)).not.toBe('writing');
  });

  it('UT-S09-180: 未知 clarification schema 原样表示并保守停止', () => {
    const doc = completeDoc(); doc.schema = 'openlogos/clarification@2';
    expect(evaluate(doc).output).toMatchObject({ schema: 'openlogos/clarification@2', status: 'invalid', required: true, reason: 'clarification-upgrade-required', next_decision: null });
  });

  it('UT-S09-181: change-lint 汇总结构与类别不一致', () => {
    const doc = pendingDoc('deployment'); doc.impacts.data.reason = ''; doc.unresolved = [];
    const { root, dir } = setup(doc, true);
    const result = runChangeLint(root, dir, 'feat');
    expect(result.ok).toBe(true);
    expect(result.violations?.filter(v => v.code === 'clarification_contract_invalid').length).toBeGreaterThan(1);
  });
});

describe('S09 clarification@1 — Schema 与共享 builder', () => {
  const invalidBase = (): ClarificationOutput => ({
    schema: CLARIFICATION_SCHEMA, mode: 'adaptive', status: 'invalid', required: true,
    required_categories: [], unresolved_decisions: 0, next_decision_id: null,
    reason: 'clarification-contract-invalid', next_decision: null,
  });

  it('UT-S09-182: complete 矛盾组合被共享契约拒绝', () => {
    const value = evaluate(completeDoc()).output; value.required = true; value.required_categories = ['data']; value.unresolved_decisions = 1;
    expect(validateClarificationOutput(value)).toBe(false);
  });

  it('UT-S09-183: pending 缺完整当前问题被共享契约拒绝', () => {
    const value = evaluate(pendingDoc('data', 'data')).output; value.next_decision = null;
    expect(validateClarificationOutput(value)).toBe(false);
  });

  it('UT-S09-184: invalid 归一化分支通过共享契约', () => {
    expect(validateClarificationOutput(invalidBase())).toBe(true);
  });

  it('UT-S09-185: next_decision ID 不相等被共享 builder 拒绝', () => {
    const value = evaluate(pendingDoc('product')).output; value.next_decision_id = 'C02';
    expect(validateClarificationOutput(value)).toBe(false);
  });

  it('UT-S09-186: required_categories 非规范顺序被共享 builder 拒绝', () => {
    const value = evaluate(pendingDoc('data', 'data'), true).output; value.required_categories = ['deployment', 'data'];
    expect(validateClarificationOutput(value)).toBe(false);
  });

  it('UT-S09-187: unknown @2 invalid 是 1.2 Schema 正例', () => {
    const doc = completeDoc(); doc.schema = 'openlogos/clarification@2';
    const { root } = setup(doc);
    const data = collectStatusData(root);
    const { ajv, schema } = ajvFor('status');
    expect(ajv.validate(schema, data), JSON.stringify(ajv.errors)).toBe(true);
  });
});

describe('S09 clarification@1 — 场景测试', () => {
  it('ST-S09-60: 简单变更零额外问答直通', () => {
    const { dir } = setup(completeDoc());
    expect(detectProposalStep(dir)).toBe('ready-to-delta');
  });

  it('ST-S09-61: 部署方案未确认以完整问题阻塞 plan', async () => {
    const { root, dir } = setup(pendingDoc('deployment'), true);
    const s = statusClarification(root); const n = (await nextData(root, true)).modules[0].plan_state.clarification;
    expect(s).toEqual(n); expect(s.reason).toBe('deployment-clarification-required'); expect(detectProposalStep(dir)).toBe('writing');
  });

  it('ST-S09-62: 依赖决策逐个持久化并恢复', () => {
    const doc = pendingDoc('data', 'data'); doc.decisions = [decision('C01', 'ownership')]; doc.unresolved = [unresolved('C02', 'data', ['C01'])];
    expect(evaluate(doc).output.next_decision_id).toBe('C02');
  });

  it('ST-S09-63: 数据迁移 required 经用户决定后完成', () => {
    const doc = completeDoc(); doc.impacts.data.status = 'required'; doc.decisions = [decision('C01', 'data')];
    expect(evaluate(doc).output.status).toBe('complete');
  });

  it('ST-S09-64: 部署与公开发布双必选互不替代', () => {
    const doc = pendingDoc('release', 'public_release'); doc.decisions = [decision('C01', 'deployment')]; doc.unresolved[0].id = 'C02';
    expect(evaluate(doc, true).output.required_categories).toEqual(['release']);
  });

  it('ST-S09-65: next --auto 不回答 recommendation', async () => {
    const { root, dir } = setup(pendingDoc('compatibility', 'compatibility'));
    const before = readFileSync(join(dir, 'proposal.md'), 'utf8');
    const a = await nextData(root, true); const b = await nextData(root, true);
    expect(a.modules[0].plan_state.clarification.next_decision_id).toBe(b.modules[0].plan_state.clarification.next_decision_id);
    expect(readFileSync(join(dir, 'proposal.md'), 'utf8')).toBe(before);
  });

  it('ST-S09-66: 非法区块跨 status/next 一致失败', async () => {
    const doc = completeDoc(); delete doc.impacts.data;
    const { root } = setup(doc);
    expect((await nextData(root)).modules[0].plan_state.clarification).toEqual(statusClarification(root));
  });

  it('ST-S09-67: writing legacy 补齐后启用严格校验', () => {
    const { dir } = setup(null); expect(detectProposalStep(dir)).toBe('writing');
    const doc = completeDoc(); delete doc.impacts.data; writeFileSync(join(dir, 'proposal.md'), proposal(doc));
    expect(derivePlanState(dir, 'writing', resolveProposalDeploymentDecision(dir)).clarification?.reason).toBe('clarification-contract-invalid');
  });

  it('ST-S09-68: RunLogos 消费字段由 CLI 一次给全', async () => {
    const { root } = setup(pendingDoc('product'));
    expect((await nextData(root)).modules[0].plan_state.clarification.next_decision).toEqual(expect.objectContaining({ id: 'C01', question: expect.any(String), impact: expect.any(String), recommendation: expect.any(String), recommendation_reason: expect.any(String), options: expect.any(Array) }));
  });

  it('ST-S09-69: 新进程恢复不会重问已确认决定', () => {
    const doc = pendingDoc('data', 'data'); doc.decisions = [decision('C01', 'ownership')]; doc.unresolved = [unresolved('C02', 'data', ['C01'])];
    const persisted = proposal(doc); expect(evaluateProposalClarification(persisted, false).output.next_decision_id).toBe('C02');
    expect(evaluateProposalClarification(persisted, false).output.next_decision_id).toBe('C02');
  });

  it('ST-S09-70: 手动与 auto 授权均不替代方案决定', async () => {
    const { root } = setup(pendingDoc('product'));
    expect((await nextData(root, false)).proposal_step).toBe('writing');
    expect((await nextData(root, true)).proposal_step).toBe('writing');

    const initial = setup(null);
    writeFileSync(join(initial.dir, 'proposal.md'), filledInitialTemplate());
    expect(collectStatusData(initial.root).modules![0].active_change!.proposal_step).toBe('writing');
    expect((await nextData(initial.root, false)).proposal_step).toBe('writing');
    expect((await nextData(initial.root, true)).proposal_step).toBe('writing');
    expect(existsSync(join(initial.dir, 'PLAN_APPROVED'))).toBe(false);
    expect(existsSync(join(initial.dir, 'GATE_AUTO_PASSED'))).toBe(false);
  });

  it('ST-S09-71: required 缺 unresolved 端到端 fail-closed', async () => {
    const doc = completeDoc(); doc.status = 'pending'; doc.impacts.data.status = 'required';
    const { root } = setup(doc);
    expect(statusClarification(root)).toMatchObject({ status: 'invalid', reason: 'clarification-contract-invalid', next_decision: null });
    expect((await nextData(root, true)).proposal_step).toBe('writing');
  });

  it('ST-S09-72: unknown @2 端到端可表示且零副作用', async () => {
    const doc = completeDoc(); doc.schema = 'openlogos/clarification@2';
    const { root, dir } = setup(doc); const before = readFileSync(join(dir, 'proposal.md'), 'utf8');
    const data = await nextData(root, true); const { ajv, schema } = ajvFor('next');
    expect(data.contract.version).toBe('1.2.0');
    expect(ajv.validate(schema, data), JSON.stringify(ajv.errors)).toBe(true);
    expect(readFileSync(join(dir, 'proposal.md'), 'utf8')).toBe(before);
  });
});
