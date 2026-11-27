/**
 * verify-self-sufficient-cases 切片 1：proposal「验收标准」段的生成（S09）与检查（S35）。
 * 用例 ID 与 logos/resources/test/core-S09-test-cases.md「S09 提案验收标准段脚手架测试」、
 * core-S35-test-cases.md「S35 验收标准段检查测试」严格对齐（UT-S09-490～492、UT-S35-225～229）。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runChangeLint } from '../src/lib/change-lint.js';
import { evaluatePlanPackage } from '../src/lib/plan-package.js';
import { parseAcceptanceCriteria } from '../src/lib/acceptance-criteria.js';
import { frontierFixture, invoke, put, cleanupFixtureRoots } from './frontier-fixture.js';
import { ACCEPTANCE_NONE_SECTION_ZH } from './acceptance-criteria-lint-codes.js';

afterAll(() => cleanupFixtureRoots());

const H2 = (content: string) => content.split('\n').filter(l => /^## /.test(l)).map(l => l.slice(3).trim());

/** 用 openlogos change 在 frontier fixture 项目里生成一份新提案（可指定 locale）。 */
function scaffoldProposal(slug: string, locale: 'zh' | 'en') {
  const f = frontierFixture();
  if (locale === 'en') put(f.root, 'logos/logos.config.json', '{"locale":"en","project":{"type":"cli"}}\n');
  put(f.root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: slug, module: 'core' }));
  const r = invoke(['change', slug], f.root);
  expect(r.status, r.stderr).toBe(0);
  const dir = join(f.root, 'logos', 'changes', slug);
  return { root: f.root, dir, slug, proposal: readFileSync(join(dir, 'proposal.md'), 'utf8') };
}

/** 合法、无任何违规与警告来源的提案（frontier fixture），可按需插入「验收标准」段。 */
function cleanFixture(acceptance: string | null) {
  const f = frontierFixture();
  const path = join(f.proposalDir, 'proposal.md');
  const base = readFileSync(path, 'utf8');
  const withSection = acceptance === null ? base : base.replace('## 变更概述', `${acceptance}\n## 变更概述`);
  writeFileSync(path, withSection);
  return { ...f, path };
}

function lintOk(f: { root: string; proposalDir: string; slug: string }) {
  const r = runChangeLint(f.root, f.proposalDir, f.slug);
  if (!r.ok) throw new Error(`操作错误：${r.errorCode}`);
  return r;
}

const accViolations = (r: ReturnType<typeof lintOk>) => r.violations.filter(v => v.code === 'acceptance_criteria_invalid');
const accWarnings = (r: ReturnType<typeof lintOk>) => r.warnings.filter(w => w.code.startsWith('acceptance_criteria'));

describe('S09 提案验收标准段脚手架', () => {
  it('UT-S09-490: zh 脚手架含「验收标准」段', () => {
    const { proposal } = scaffoldProposal('vs-scaffold', 'zh');
    const heads = H2(proposal);
    expect(heads.filter(h => h === '验收标准')).toHaveLength(1);
    const i = heads.indexOf('验收标准');
    expect(heads[i - 1]).toBe('决策澄清');
    // layered-verification：其后新增「受影响场景」段，再后才是「变更概述」
    expect(heads[i + 1]).toBe('受影响场景');
    expect(heads[i + 2]).toBe('变更概述');
    // 其余既有段与顺序不变
    expect(heads.filter(h => h !== '验收标准' && h !== '受影响场景')).toEqual([
      '变更原因', '最小实现论证', '变更类型', '变更范围', '部署影响', 'UI/UX 变更声明', '决策澄清', '变更概述',
    ]);
    const parsed = parseAcceptanceCriteria(proposal);
    expect(parsed.present && parsed.structured).toBe(true);
    for (const label of ['自动验收环境要求', '平台限定用例', '需要人参与的验收']) {
      expect(proposal).toMatch(new RegExp(`^- ${label}：\\[.+\\]$`, 'm'));
    }
    expect(parsed.problems.map(p => p.kind)).toEqual(['field_placeholder', 'field_placeholder', 'field_placeholder']);
  });

  it('UT-S09-491: en 脚手架含 Acceptance Criteria 段', () => {
    const { proposal } = scaffoldProposal('vs-scaffold-en', 'en');
    const heads = H2(proposal);
    expect(heads.filter(h => h === 'Acceptance Criteria')).toHaveLength(1);
    const i = heads.indexOf('Acceptance Criteria');
    expect(heads[i - 1]).toBe('Decision Clarification');
    expect(heads[i + 1]).toBe('Affected Scenarios'); // layered-verification 新增段
    expect(heads[i + 2]).toBe('Summary');
    for (const label of ['Automated verification requirements', 'Platform-limited cases', 'Human-involved acceptance']) {
      expect(proposal).toMatch(new RegExp(`^- ${label}: \\[.+\\]$`, 'm'));
    }
    expect(parseAcceptanceCriteria(proposal).structured).toBe(true);
  });

  it('UT-S09-492: 新脚手架未填写时的 lint 与计划状态', () => {
    // ① 未填写的新脚手架：验收标准三个占位各报一条，与既有 canonical 占位违规并列
    const s = scaffoldProposal('vs-unfilled', 'zh');
    const r1 = lintOk({ root: s.root, proposalDir: s.dir, slug: s.slug });
    const acc = accViolations(r1);
    expect(acc).toHaveLength(3);
    for (const label of ['自动验收环境要求', '平台限定用例', '需要人参与的验收']) {
      expect(acc.some(v => v.message.includes(label) && v.message.includes('占位'))).toBe(true);
    }
    expect(r1.violations.some(v => v.code !== 'acceptance_criteria_invalid')).toBe(true);
    expect(r1.checks.some(c => c.id === 11 && c.violations === 3)).toBe(true);

    // ② 三个字段为「无」、其余按既有规则填好：该段不产生违规或警告；plan_ready 只由 canonical 判据决定
    const withNone = cleanFixture(ACCEPTANCE_NONE_SECTION_ZH);
    const without = cleanFixture(null);
    const r2 = lintOk(withNone);
    expect(accViolations(r2)).toEqual([]);
    expect(accWarnings(r2)).toEqual([]);
    expect(r2.violations).toEqual([]);
    expect(evaluatePlanPackage(withNone.root, withNone.proposalDir).ready)
      .toBe(evaluatePlanPackage(without.root, without.proposalDir).ready);
  });
});

describe('S35 验收标准段检查', () => {
  it('UT-S35-225: 缺段只警告', () => {
    const f = cleanFixture(null);
    const r = lintOk(f);
    expect(r.violations).toEqual([]);
    expect(accWarnings(r).map(w => w.code)).toEqual(['acceptance_criteria_missing']);
    expect(accWarnings(r)[0].message).toContain(`logos/changes/${f.slug}/proposal.md`);
    expect(accWarnings(r)[0].fix_hint).toContain('## 验收标准');
    expect(r.checks.some(c => c.id === 11)).toBe(false);
    const cli = invoke(['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
    expect(cli.status).toBe(0);
    const data = JSON.parse(cli.stdout.trim().split('\n').pop()!).data;
    expect(data.pass).toBe(true);
    expect(data.warnings.map((w: { code: string }) => w.code)).toContain('acceptance_criteria_missing');
    // plan_package.ready 与带合法段时相同
    const withSection = cleanFixture(ACCEPTANCE_NONE_SECTION_ZH);
    expect(lintOk(withSection).plan_package.ready).toBe(r.plan_package.ready);
    // 评审 code-r1 F5：标题在场即按结构化段逐项校验——删空三个字段（只留标题或自由文本）不是缺段，逐项报违规、退出码 2
    for (const body of ['## 验收标准\n\n', '## 验收标准\n- 运行 sync 后 settings.json 含 language 键。\n']) {
      const emptied = cleanFixture(body);
      const re = lintOk(emptied);
      expect(accWarnings(re)).toEqual([]);
      expect(accViolations(re).map(v => v.code)).toEqual(['acceptance_criteria_invalid', 'acceptance_criteria_invalid', 'acceptance_criteria_invalid']);
      expect(accViolations(re).map(v => v.message).join('\n')).toMatch(/自动验收环境要求[\s\S]*平台限定用例[\s\S]*需要人参与的验收/);
      expect(re.checks.some(c => c.id === 11)).toBe(true);
      const ce = invoke(['change-lint', '--slug', emptied.slug, '--format', 'json'], emptied.root);
      expect(ce.status).toBe(2);
    }
  });

  it('UT-S35-226: 字段缺失或为空', () => {
    const missing = cleanFixture(ACCEPTANCE_NONE_SECTION_ZH.replace('- 平台限定用例：无\n', ''));
    const r1 = lintOk(missing);
    const v1 = accViolations(r1);
    expect(v1).toHaveLength(1);
    expect(v1[0].message).toContain('平台限定用例');
    expect(v1[0].message).toMatch(/proposal\.md:\d+/);
    expect(v1[0].fix_hint).toContain('没有就写「无」');
    expect(invoke(['change-lint', '--slug', missing.slug], missing.root).status).toBe(2);

    const empty = cleanFixture(ACCEPTANCE_NONE_SECTION_ZH.replace('- 需要人参与的验收：无', '- 需要人参与的验收：'));
    const v2 = accViolations(lintOk(empty));
    expect(v2).toHaveLength(1);
    expect(v2[0].message).toContain('需要人参与的验收');
    expect(v2[0].message).toContain('为空');
    const line = readFileSync(empty.path, 'utf8').split('\n').findIndex(l => l === '- 需要人参与的验收：') + 1;
    expect(v2[0].message).toContain(`proposal.md:${line}`);
    expect(v2[0].fix_hint).toContain('没有就写「无」');
  });

  it('UT-S35-227: 占位文字未替换', () => {
    const f = cleanFixture([
      '## 验收标准',
      '- 自动验收环境要求：[无 / `env:<变量名>` 条目]',
      '- 平台限定用例：[无 / 用例 ID 与适用平台]',
      '- 需要人参与的验收：[无 / 人工验收事项]',
      '',
    ].join('\n'));
    const v = accViolations(lintOk(f));
    expect(v).toHaveLength(3);
    expect(v.every(x => x.message.includes('占位'))).toBe(true);
    expect(invoke(['change-lint', '--slug', f.slug], f.root).status).toBe(2);
  });

  it('UT-S35-228: 环境要求条目格式非法', () => {
    const cases: Array<[string, string]> = [
      ['`pkg:docker`', 'pkg:docker'],
      ['`env:`', 'env:'],
      ['`check:bad name`', 'check:bad name'],
      ['需要一个数据库', '没有任何合法条目'],
    ];
    for (const [value, expectInMessage] of cases) {
      const f = cleanFixture(ACCEPTANCE_NONE_SECTION_ZH.replace('- 自动验收环境要求：无', `- 自动验收环境要求：${value}`));
      const v = accViolations(lintOk(f));
      expect(v, value).toHaveLength(1);
      expect(v[0].message, value).toContain(expectInMessage);
      for (const form of ['`env:<变量名>`', '`command:<命令名>`', '`check:<检查名>`']) {
        expect(v[0].fix_hint, value).toContain(form);
      }
      expect(invoke(['change-lint', '--slug', f.slug], f.root).status, value).toBe(2);
    }
  });

  it('UT-S35-229: 合法写法通过', () => {
    const variants: Array<[string, string]> = [
      ['全部为「无」', ACCEPTANCE_NONE_SECTION_ZH],
      ['条目加说明', ACCEPTANCE_NONE_SECTION_ZH.replace(
        '- 自动验收环境要求：无',
        '- 自动验收环境要求：`env:DB_URL` `command:docker` `check:db-ready` — 数据库连接、容器与就绪检查，由 [code] 任务写入 verify.requirements',
      )],
      ['en 段', [
        '## Acceptance Criteria',
        '- Automated verification requirements: `env:DB_URL` `command:docker` `check:db-ready` — database, container and readiness',
        '- Platform-limited cases: none',
        '- Human-involved acceptance: none',
        '',
      ].join('\n')],
    ];
    for (const [label, section] of variants) {
      const f = cleanFixture(section);
      const r = lintOk(f);
      expect(r.violations, label).toEqual([]);
      expect(accWarnings(r), label).toEqual([]);
      expect(r.checks.find(c => c.id === 11), label).toMatchObject({ violations: 0 });
      expect(invoke(['change-lint', '--slug', f.slug], f.root).status, label).toBe(0);
    }
    const entries = parseAcceptanceCriteria(readFileSync(cleanFixture(variants[1][1]).path, 'utf8')).entries;
    expect(entries.map(e => e.raw)).toEqual(['env:DB_URL', 'command:docker', 'check:db-ready']);
  });
});
