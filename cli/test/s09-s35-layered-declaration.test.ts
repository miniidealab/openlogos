/**
 * layered-verification 切片 1：主链路小节读取（S13）、proposal「受影响场景」段的生成（S09）与检查（S35）。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md（UT-S13-219、220）、core-S09-test-cases.md
 * （UT-S09-504～506）、core-S35-test-cases.md（UT-S35-231～239）严格对齐。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runChangeLint } from '../src/lib/change-lint.js';
import { evaluatePlanPackage } from '../src/lib/plan-package.js';
import { PLAN_SECTION_REGISTRY } from '../src/lib/plan-package-contract.js';
import { parseMainPathDocument, readMainPathSet } from '../src/lib/main-path.js';
import { parseAffectedDeclaration, readAffectedDeclaration, knownScenarioIds } from '../src/lib/affected-scenarios.js';
import { frontierFixture, invoke, put, cleanupFixtureRoots } from './frontier-fixture.js';
/** 只含合法「验收标准」段（不带「受影响场景」段），本文件自行追加各种受影响场景声明。 */
const ACCEPTANCE_NONE_SECTION_ZH = ['## 验收标准', '- 自动验收环境要求：无', '- 平台限定用例：无', '- 需要人参与的验收：无', ''].join('\n');

afterAll(() => cleanupFixtureRoots());

const H2 = (content: string) => content.split('\n').filter(l => /^## /.test(l)).map(l => l.slice(3).trim());
const table = (rows: string[]) => ['| ID | 描述 |', '|---|---|', ...rows.map(r => `| ${r} | fixture |`)].join('\n') + '\n';

function declaration(body: string): string {
  return ['## 受影响场景', '', '```yaml', body, '```', ''].join('\n');
}
const DECL = (assessment: string, scenarios: string, shared = 'false') =>
  declaration(`schema: openlogos/affected-scenarios@1\nassessment: ${assessment}\nshared_change: ${shared}\nscenarios: ${scenarios}`);
const S61 = '\n  - id: S61\n    reason: 修改了 S61 依赖的公共函数';

/** 夹具 LL：frontier fixture 的合法提案，加上合法的「验收标准」段，已合并场景文档与测试用例文档 core-S61、core-S62。 */
function ll(declarationSection: string | null) {
  const f = frontierFixture();
  put(f.root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S61-flow.md', '# S61\n');
  put(f.root, 'logos/resources/test/core-S61-test-cases.md', table(['UT-S61-01', 'UT-S61-02']));
  put(f.root, 'logos/resources/test/core-S62-test-cases.md', table(['UT-S62-01', 'UT-S62-02 [manual]']));
  const path = join(f.proposalDir, 'proposal.md');
  const base = readFileSync(path, 'utf8');
  const sections = `${ACCEPTANCE_NONE_SECTION_ZH}\n${declarationSection ?? ''}`;
  writeFileSync(path, base.replace('## 变更概述', `${sections}\n## 变更概述`));
  return { ...f, path };
}

function lintOk(f: { root: string; proposalDir: string; slug: string }) {
  const r = runChangeLint(f.root, f.proposalDir, f.slug);
  if (!r.ok) throw new Error(`操作错误：${r.errorCode}`);
  return r;
}
const affViolations = (r: ReturnType<typeof lintOk>) => r.violations.filter(v => v.code === 'affected_scenarios_invalid');
const layeredWarnings = (r: ReturnType<typeof lintOk>) =>
  r.warnings.filter(w => w.code.startsWith('affected_scenarios') || w.code.startsWith('main_path'));

function scaffoldProposal(slug: string, locale: 'zh' | 'en') {
  const f = frontierFixture();
  if (locale === 'en') put(f.root, 'logos/logos.config.json', '{"locale":"en","project":{"type":"cli"}}\n');
  put(f.root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: slug, module: 'core' }));
  const r = invoke(['change', slug], f.root);
  expect(r.status, r.stderr).toBe(0);
  const dir = join(f.root, 'logos', 'changes', slug);
  return { root: f.root, dir, slug, proposal: readFileSync(join(dir, 'proposal.md'), 'utf8') };
}

function yamlOf(proposal: string, title: string): string {
  const start = proposal.indexOf(`## ${title}`);
  const open = proposal.indexOf('```yaml', start);
  const close = proposal.indexOf('```', open + 7);
  return proposal.slice(open + 7, close);
}

describe('S13 主链路小节读取（layered-verification）', () => {
  it('UT-S13-219: 主链路小节读取', () => {
    const rows = table(['UT-S03-01', 'UT-S03-02', 'ST-S03-01']);
    // 二级标题、列表项带说明、`*` 列表
    const h2 = parseMainPathDocument(`${rows}\n## 主链路用例\n\n- UT-S03-01 — 用户能登录\n* ST-S03-01\n\n## 其他\n- UT-S03-02\n`, 'a.md');
    expect(h2).toEqual({ present: true, ids: ['UT-S03-01', 'ST-S03-01'], problems: [] });
    // 三级标题与英文标题；小节到同级或更高级标题为止
    const h3 = parseMainPathDocument(`## 测试\n${rows}\n### Main Path Cases\n\n说明文字不参与判定。\n- UT-S03-02: 说明\n### 备注\n- UT-S03-01\n`, 'b.md');
    expect(h3.present).toBe(true);
    expect(h3.ids).toEqual(['UT-S03-02']);
    expect(h3.problems).toEqual([]);
    // 没有小节的文档贡献为空；首格没有任何主链路标记
    const none = parseMainPathDocument(rows, 'c.md');
    expect(none).toEqual({ present: false, ids: [], problems: [] });
    expect(rows).not.toMatch(/\[main\]/);
    // 标题文本必须恰为约定标题
    expect(parseMainPathDocument(`${rows}\n## 主链路用例清单\n- UT-S03-01\n`, 'd.md').present).toBe(false);

    // 集合 = 全部文档主链路小节的并集（字典序）
    const f = frontierFixture();
    put(f.root, 'logos/resources/test/core-S03-test-cases.md', `${table(['UT-S03-01', 'UT-S03-02'])}\n## 主链路用例\n- UT-S03-01\n`);
    put(f.root, 'logos/resources/test/core-S04-test-cases.md', `${table(['UT-S04-01'])}\n### 主链路用例\n- UT-S04-01\n`);
    put(f.root, 'logos/resources/test/core-S05-test-cases.md', table(['UT-S05-01']));
    const set = readMainPathSet(f.root);
    expect(set.ids).toEqual(['UT-S03-01', 'UT-S04-01']);
    expect(set.problems).toEqual([]);
    expect(set.files).toEqual(['logos/resources/test/core-S03-test-cases.md', 'logos/resources/test/core-S04-test-cases.md']);
  });

  it('UT-S13-220: 主链路小节的结构错误', () => {
    const rows = table(['UT-S03-01', 'UT-S03-02 [manual]', 'SMOKE-core-01']);
    const one = (item: string) => parseMainPathDocument(`${rows}\n## 主链路用例\n${item}\n`, 'logos/resources/test/core-S03-test-cases.md').problems;
    expect(one('- UT-S03-99')).toEqual([expect.objectContaining({ code: 'undefined_id', id: 'UT-S03-99', file: 'logos/resources/test/core-S03-test-cases.md' })]);
    expect(one('- UT-S03-02')).toEqual([expect.objectContaining({ code: 'manual_case', id: 'UT-S03-02' })]);
    expect(one('- SMOKE-core-01')).toEqual([expect.objectContaining({ code: 'not_ut_st', id: 'SMOKE-core-01' })]);
    expect(one('- UT-S03-01\n- UT-S03-01')).toEqual([expect.objectContaining({ code: 'duplicate_id', id: 'UT-S03-01' })]);
    expect(one('- 登录流程必须可用')).toEqual([expect.objectContaining({ code: 'item_without_id', id: null })]);
    const twice = parseMainPathDocument(`${rows}\n## 主链路用例\n- UT-S03-01\n\n## Main Path Cases\n- UT-S03-01\n`, 'x.md');
    expect(twice.problems).toEqual([expect.objectContaining({ code: 'duplicate_section', id: null })]);
    expect(twice.ids).toEqual(['UT-S03-01']);
    // 出错的项不进入集合
    expect(parseMainPathDocument(`${rows}\n## 主链路用例\n- UT-S03-02\n- UT-S03-99\n`, 'x.md').ids).toEqual([]);
  });
});

describe('S09 提案脚手架「受影响场景」段（layered-verification）', () => {
  it('UT-S09-504: 脚手架生成「受影响场景」段（zh）', () => {
    const { proposal } = scaffoldProposal('lv-zh', 'zh');
    const heads = H2(proposal);
    expect(heads.filter(h => h === '受影响场景')).toHaveLength(1);
    const i = heads.indexOf('受影响场景');
    expect(heads[i - 1]).toBe('验收标准');
    expect(heads[i + 1]).toBe('变更概述');
    expect(heads.filter(h => h !== '受影响场景')).toEqual([
      '变更原因', '最小实现论证', '变更类型', '变更范围', '部署影响', 'UI/UX 变更声明', '决策澄清', '验收标准', '变更概述',
    ]);
    const yaml = yamlOf(proposal, '受影响场景');
    expect(yaml).toMatch(/^schema: openlogos\/affected-scenarios@1$/m);
    expect(yaml).toMatch(/^assessment: pending\b/m);
    expect(yaml).toMatch(/^shared_change: false\b/m);
    expect(yaml).toMatch(/^scenarios: \[\]/m);
    // 去掉新增段后，其余内容与引入前的脚手架逐字一致（新增段位于「变更概述」标题之前）
    const start = proposal.indexOf('## 受影响场景');
    const end = proposal.indexOf('## 变更概述');
    const without = proposal.slice(0, start) + proposal.slice(end);
    expect(without).not.toContain('affected-scenarios');
    expect(without).toContain('- 需要人参与的验收：[无 / 人工验收事项与执行环节]\n\n## 变更概述\n');
  });

  it('UT-S09-505: 脚手架生成 Affected Scenarios 段（en）', () => {
    const { proposal } = scaffoldProposal('lv-en', 'en');
    const heads = H2(proposal);
    const i = heads.indexOf('Affected Scenarios');
    expect(i).toBeGreaterThan(0);
    expect(heads[i - 1]).toBe('Acceptance Criteria');
    expect(heads[i + 1]).toBe('Summary');
    expect(heads.filter(h => h !== 'Affected Scenarios')).toEqual([
      'Reason', 'Minimal Implementation Rationale', 'Change Type', 'Scope', 'Deployment Impact', 'UI/UX Change Declaration',
      'Decision Clarification', 'Acceptance Criteria', 'Summary',
    ]);
    const yaml = yamlOf(proposal, 'Affected Scenarios');
    expect(yaml).toMatch(/^schema: openlogos\/affected-scenarios@1$/m);
    expect(yaml).toMatch(/^assessment: pending\b/m);
    expect(yaml).toMatch(/^shared_change: false\b/m);
    expect(yaml).toMatch(/^scenarios: \[\]/m);
  });

  it('UT-S09-506: 该段不是必填章节', () => {
    const withSection = ll(DECL('assessed', '[]'));
    const without = ll(null);
    expect(readFileSync(without.path, 'utf8')).not.toContain('## 受影响场景');
    expect(evaluatePlanPackage(without.root, without.proposalDir).ready).toBe(true);
    expect(evaluatePlanPackage(withSection.root, withSection.proposalDir).ready).toBe(true);
    expect(Object.keys(PLAN_SECTION_REGISTRY).sort()).toEqual(['clarification', 'deployment', 'reason', 'scope', 'summary', 'type']);
    expect(Object.values(PLAN_SECTION_REGISTRY).map(v => v.zh)).not.toContain('受影响场景');
  });
});

describe('S35 受影响场景声明与主链路小节检查（layered-verification）', () => {
  it('UT-S35-231: 缺段只警告', () => {
    const f = ll(null);
    const r = lintOk(f);
    expect(layeredWarnings(r).map(w => w.code)).toEqual(['affected_scenarios_missing']);
    expect(affViolations(r)).toEqual([]);
    expect(r.violations).toEqual([]);
    expect(r.checks.some(c => c.id === 12)).toBe(false);
    const cli = invoke(['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
    expect(cli.status, cli.stderr).toBe(0);
    expect(JSON.parse(cli.stdout.trim().split('\n').pop()!).data.pass).toBe(true);
  });

  it('UT-S35-232: 合法声明通过', () => {
    for (const scenarios of [S61, '[]']) {
      const r = lintOk(ll(DECL('assessed', scenarios)));
      expect(affViolations(r), scenarios).toEqual([]);
      expect(layeredWarnings(r), scenarios).toEqual([]);
      expect(r.violations, scenarios).toEqual([]);
      expect(r.checks.find(c => c.id === 12), scenarios).toMatchObject({ violations: 0 });
    }
  });

  it('UT-S35-233: 未填写与结构非法报违规', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['pending', DECL('pending', '[]'), /pending/],
      ['YAML 损坏', declaration('schema: openlogos/affected-scenarios@1\nassessment: [assessed\nscenarios: []'), /YAML 无法解析/],
      ['没有 fenced YAML', '## 受影响场景\n\nassessment: assessed\n', /没有 fenced YAML/],
      ['assessment 非法', DECL('maybe', '[]'), /assessment 必须为 assessed 或 unknown/],
      ['shared_change 非布尔', DECL('assessed', '[]', '"no"'), /shared_change 必须为布尔值/],
      ['缺 reason', DECL('assessed', '\n  - id: S61'), /reason 为空/],
      ['reason 为空', DECL('assessed', '\n  - id: S61\n    reason: "  "'), /reason 为空/],
      ['编号重复', DECL('assessed', `${S61}${S61}`), /场景编号 S61 重复/],
      ['id 形态非法', DECL('assessed', '\n  - id: scenario-1\n    reason: x'), /不是场景编号/],
    ];
    for (const [label, section, pattern] of cases) {
      const f = ll(section);
      const r = lintOk(f);
      const v = affViolations(r);
      expect(v.length, label).toBeGreaterThan(0);
      expect(v.some(x => pattern.test(x.message)), `${label}: ${v.map(x => x.message).join(' | ')}`).toBe(true);
      expect(v.every(x => x.fix_hint.length > 0 && x.path === 'logos/changes/' + f.slug + '/proposal.md'), label).toBe(true);
      const cli = invoke(['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
      expect(cli.status, label).toBe(2);
    }
  });

  it('UT-S35-234: 场景不存在报违规', () => {
    const r = lintOk(ll(DECL('assessed', `${S61}\n  - id: S99\n    reason: 不存在的场景`)));
    const v = affViolations(r);
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('S99');
    expect(v[0].message).not.toContain('S61');
  });

  it('UT-S35-235: 引用本提案新建的场景合法', () => {
    const f = ll(DECL('assessed', '\n  - id: S07\n    reason: 本提案新建场景，行为与 S61 共用入口'));
    expect(affViolations(lintOk(f)).map(v => v.message).join()).toContain('S07');
    put(f.root, `logos/changes/${f.slug}/deltas/prd/3-technical-plan/2-scenario-implementation/core-S07-new-flow.md`, '## ADDED — S07 新场景\n\n正文。\n');
    expect(knownScenarioIds(f.root, f.proposalDir).has('S07')).toBe(true);
    expect(affViolations(lintOk(f))).toEqual([]);
  });

  it('UT-S35-236: 无法评估通过但提示', () => {
    const r = lintOk(ll(DECL('unknown', '[]')));
    expect(affViolations(r)).toEqual([]);
    expect(layeredWarnings(r).map(w => w.code)).toEqual(['affected_scenarios_unknown']);
  });

  it('UT-S35-237: 主链路小节结构错误给出警告', () => {
    // ① 已合并文档的主链路小节列未定义 ID
    const a = ll(DECL('assessed', '[]'));
    put(a.root, 'logos/resources/test/core-S61-test-cases.md', `${table(['UT-S61-01', 'UT-S61-02'])}\n## 主链路用例\n- UT-S61-77\n`);
    const ra = lintOk(a);
    const wa = ra.warnings.filter(w => w.code === 'main_path_invalid');
    expect(wa).toHaveLength(1);
    expect(wa[0].message).toContain('logos/resources/test/core-S61-test-cases.md');
    expect(wa[0].message).toContain('UT-S61-77');
    expect(wa[0].message).toContain('undefined_id');
    expect(ra.violations).toEqual([]);
    // ② 本提案的测试 delta 新增主链路小节并列一条 [manual] 用例——按合成后态检查
    const b = ll(DECL('assessed', '[]'));
    const baseline = lintOk(b);
    put(b.root, `logos/changes/${b.slug}/deltas/test/core-S62-test-cases.md`, '## ADDED — 主链路用例\n\n- UT-S62-02\n');
    const rb = lintOk(b);
    const wb = rb.warnings.filter(w => w.code === 'main_path_invalid');
    expect(wb, JSON.stringify(rb.violations)).toHaveLength(1);
    expect(wb[0].message).toContain('UT-S62-02');
    expect(wb[0].message).toContain('manual_case');
    // 主链路问题不计违规：违规集合不因主链路小节的错误增加主链路相关条目
    expect(rb.violations.filter(v => /main_path/.test(v.code))).toEqual([]);
    expect(baseline.warnings.filter(w => w.code.startsWith('main_path'))).toEqual([]);
  });

  it('UT-S35-238: 主链路超过上限给出警告', () => {
    const mk = (enabled: boolean | null) => {
      const f = ll(DECL('assessed', '[]'));
      put(f.root, 'logos/resources/test/core-S61-test-cases.md', `${table(['UT-S61-01', 'UT-S61-02'])}\n## 主链路用例\n- UT-S61-01\n- UT-S61-02\n`);
      const cfgPath = join(f.root, 'logos', 'logos.config.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      cfg.verify = { ...(cfg.verify ?? {}), layered: { main_path_max: 1, ...(enabled === null ? {} : { enabled }) } };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      return lintOk(f);
    };
    for (const enabled of [null, false, true]) {
      const r = mk(enabled);
      const w = r.warnings.filter(x => x.code === 'main_path_over_limit');
      expect(w, String(enabled)).toHaveLength(1);
      expect(w[0].message).toContain('2');
      expect(w[0].message).toContain('1');
      expect(w[0].message.includes('verify 会据此'), String(enabled)).toBe(enabled === true);
      expect(r.violations, String(enabled)).toEqual([]);
    }
    // 缺省上限 50：2 条不超限；没有任何主链路小节时没有主链路相关警告
    const none = lintOk(ll(DECL('assessed', '[]')));
    expect(none.warnings.filter(w => w.code.startsWith('main_path'))).toEqual([]);
  });

  it('UT-S35-239: 与 verify 同一判定', () => {
    const cases: Array<[string, string, string]> = [
      ['assessed + S61', DECL('assessed', S61), 'usable'],
      ['assessed + []', DECL('assessed', '[]'), 'usable'],
      ['pending', DECL('pending', '[]'), 'invalid'],
      ['reason 为空', DECL('assessed', '\n  - id: S61\n    reason: ""'), 'invalid'],
      ['S99', DECL('assessed', `${S61}\n  - id: S99\n    reason: x`), 'scenario_unknown'],
      ['unknown', DECL('unknown', '[]'), 'unknown'],
    ];
    for (const [label, section, expected] of cases) {
      const f = ll(section);
      const decl = readAffectedDeclaration(f.root, f.proposalDir);
      expect(decl.status, label).toBe(expected);
      const violated = affViolations(lintOk(f)).length > 0;
      expect(violated, label).toBe(decl.status === 'invalid' || decl.status === 'scenario_unknown');
    }
    // 不论状态如何，共享标志与已识别场景都独立给出
    const known = new Set(['S61']);
    const d1 = parseAffectedDeclaration(DECL('unknown', S61, 'true'), known);
    expect(d1).toMatchObject({ status: 'unknown', sharedChange: true, recognized: [{ id: 'S61' }] });
    const d2 = parseAffectedDeclaration(DECL('pending', `${S61}\n  - id: S99\n    reason: x`, 'true'), known);
    expect(d2).toMatchObject({ status: 'invalid', sharedChange: true, unknownScenarioIds: ['S99'] });
    expect(d2.recognized.map(s => s.id)).toEqual(['S61']);
    expect(parseAffectedDeclaration('# 提案\n', known)).toMatchObject({ status: 'missing', sharedChange: false, recognized: [] });
  });
});
