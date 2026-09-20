/**
 * S35 — 变更类型 ↔ delta 层面观测 warning（anti-overdesign-scale-signals）。
 * 覆盖 UT-S35-159～UT-S35-172、ST-S35-31（与 logos/resources/test/core-S35-test-cases.md 严格对齐）。
 *
 * 本组测试的语义本体是**通道归属**与**免计边界**：新增判定只能出现在 warnings、绝不进 violations，
 * 且「传播规则给的是最少需要更新的下界、不是上限」这一定性必须可被证伪——UT-S35-160 即该定性的
 * 守门用例（代码级顺带补回归测试规格是正当形态，实现若把传播规则当上限即红）。
 *
 * 夹具在一次性隔离项目内构造；ST 臂走真实 CLI 子进程。结果由全局 OpenLogos reporter 写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, withCompleteClarification, registerCoreModule } from './helpers.js';
import { runChangeLint, CHANGE_LINT_VIOLATION_CODES } from '../src/lib/change-lint.js';
import BASELINE from './fixtures/s35-change-type-baseline.json' with { type: 'json' };
import {
  evaluateProposalStructure, isValidChangeType, resolveChangeType, resolveProposalChangeType,
} from '../src/lib/plan-package-contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(resolve(HERE, '..', '..'), 'cli');
const WARN = 'change_type_delta_layer_mismatch';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function proposalBody(changeType: string, locale: 'zh' | 'en' = 'zh'): string {
  if (locale === 'en') {
    return [
      '# Change Proposal: fixture', '', '> module: core', '',
      '## Reason', 'Fixture for the layer-observation warning.', '',
      '## Change Type', changeType, '',
      '## Scope', '- Affected specs: core-01', '',
      '## Deployment Impact', '- Deployment required: no', '- Deployment reason: fixture',
      '- Affected environments: none', '- Data migration involved: no',
      '- Rollback plan required: no', '- Smoke required: no', '',
      '## Summary', 'Requires CLI code, tests and a reporter.',
    ].join('\n');
  }
  return withCompleteClarification([
    '# 变更提案：层面观测夹具', '', '> module: core', '',
    '## 变更原因', '构造声明类型与 delta 层面的对照。', '',
    '## 变更类型', changeType, '',
    '## 变更范围', '- 影响的功能规格：core-01', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '需要 CLI 代码、测试和 reporter 实现。',
  ].join('\n'));
}

/** 一次性隔离项目 + 活跃提案；`deltaPaths` 逐条写成合法的 ADDED 块（目标主文档不存在 → 免守恒）。 */
function setup(changeType: string, deltaPaths: string[], slug = 'layer-fixture'): { root: string; dir: string; slug: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', product_type: 'cli' }],
  }, { lineWidth: 0 }));
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-09-20T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), proposalBody(changeType));
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '', '## [delta] 规格变更',
    '- [ ] 产出 delta 到 `deltas/test/` — 新增用例', '',
    '## [code] 代码实现', '',
  ].join('\n'));
  for (const rel of deltaPaths) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, ['## ADDED — 夹具章节', '', '夹具正文，不含模板占位。', ''].join('\n'));
  }
  return { root, dir, slug };
}

function lint(root: string, dir: string, slug: string) {
  const r = runChangeLint(root, dir, slug);
  if (!r.ok) throw new Error(`change-lint 操作错误：${r.errorCode} ${r.message}`);
  return r;
}

/**
 * 与 `scratchpad/capture-baseline.mjs` **逐字同构**的夹具（同 slug / 同文件布局 / 同正文），
 * 供零回归锚与上线前实测基线逐字段比对。不得改动——改了就对不上基线。
 */
function baselineFixture(changeType: string, deltaPaths: string[], extra: Array<[string, string]> = []) {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  const slug = 'baseline-fixture';
  const put = (rel: string, body: string) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  };
  put('logos/logos.config.json', JSON.stringify({ locale: 'zh', project: { name: 'x' } }, null, 2));
  put('logos/logos-project.yaml',
    'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    product_type: cli\n');
  put('logos/.openlogos-guard',
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-09-20T00:00:00.000Z' }));
  put(`logos/changes/${slug}/proposal.md`, baselineProposal(changeType));
  put(`logos/changes/${slug}/tasks.md`,
    ['# 实现任务', '', '## [delta] 规格变更', '- [ ] 产出 delta 到 `deltas/test/` — 新增用例', '', '## [code] 代码实现', ''].join('\n'));
  for (const rel of deltaPaths) put(`logos/changes/${slug}/${rel}`, ['## ADDED — 夹具章节', '', '夹具正文，不含模板占位。', ''].join('\n'));
  for (const [rel, body] of extra) put(`logos/changes/${slug}/${rel}`, body);
  return { root, dir: join(root, 'logos', 'changes', slug), slug };
}

/** 与基线脚本同构的 zh/en 提案正文。 */
function baselineProposalFor(changeType: string, locale: 'zh' | 'en'): string {
  return locale === 'en' ? proposalBody(changeType, 'en') : baselineProposal(changeType);
}

function baselineProposal(changeType: string): string {
  return ['# 变更提案：层面观测夹具', '', '> module: core', '',
    '## 变更原因', '构造声明类型与 delta 层面的对照。', '',
    '## 变更类型', changeType, '',
    '## 变更范围', '- 影响的功能规格：core-01', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '需要 CLI 代码、测试和 reporter 实现。', '',
    '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive',
    'status: ready', 'impacts:', '  data:', '    status: none', '    reason: 无',
    'decisions: []', 'unresolved: []', 'defaults: []', '```', ''].join('\n');
}

/** 整个项目根的逐文件字节指纹——用于「只读命令项目级零写入」断言。 */
function treeFingerprint(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else out.push(`${r}:${createHash('sha256').update(readFileSync(abs)).digest('hex')}`);
    }
  };
  walk(root, '');
  return out;
}

type BaselineScenario = {
  ok: boolean; pass?: boolean;
  checks?: Array<{ id: number; label: string; violations: number }>;
  violations?: Array<{ code: string; path: string; message: string; fix_hint: string }>;
  warningCodes?: string[];
};
const scenario = (key: string): BaselineScenario =>
  (BASELINE.lintScenarios as unknown as Record<string, BaselineScenario>)[key];

/** 本 warning 是否出现（以及其条目）。 */
function warnOf(root: string, dir: string, slug: string) {
  return lint(root, dir, slug).warnings.filter(w => w.code === WARN);
}

const D_TEST = 'deltas/test/core-S99-test-cases.md';
const D_PRD1 = 'deltas/prd/1-product-requirements/core-01-requirements.md';
const D_PRD2 = 'deltas/prd/2-product-design/core-02-design.md';
const D_PRD3 = 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S99-x.md';
const D_API = 'deltas/api/core-api.yaml';
const D_DB = 'deltas/database/core-db.md';
const D_SCEN = 'deltas/scenario/core-S99-flow.md';
const D_DEC = 'deltas/decisions/core-D99-fixture.md';
const D_SPEC = 'deltas/spec/change-management.md';
const D_SKILL = 'deltas/skills/change-writer/SKILL.md';

describe('S35 变更类型 ↔ delta 层面观测 warning', () => {
  it('UT-S35-159 主链路：声明代码级而实有 prd delta → 产 warning，退出码形态不变', () => {
    const { root, dir, slug } = setup('代码级', [D_PRD3]);
    const r = lint(root, dir, slug);
    const hit = r.warnings.filter(w => w.code === WARN);
    expect(hit).toHaveLength(1);
    expect(hit[0].message.length).toBeGreaterThan(0);
    expect(hit[0].fix_hint.length).toBeGreaterThan(0);
    // 通道归属是本能力的语义本体：必须分别读 violations 与 warnings 两个真实字段。
    expect(r.violations.map(v => v.code)).not.toContain(WARN);
    expect(r.violations).toHaveLength(0); // 无其它违规 → 命令层 exit 0
  });

  it('UT-S35-160 免计边界·代码级 + 仅 test delta → 不告警（「下界不是上限」守门用例）', () => {
    const { root, dir, slug } = setup('代码级', [D_TEST]);
    expect(warnOf(root, dir, slug)).toHaveLength(0);
  });

  it('UT-S35-161 免计边界·接口级免计 api/database/scenario，越界只点名越界项', () => {
    const a = setup('接口级', [D_API, D_DB, D_SCEN], 'iface-clean');
    expect(warnOf(a.root, a.dir, a.slug)).toHaveLength(0);

    const b = setup('接口级', [D_API, D_DB, D_SCEN, D_PRD2], 'iface-over');
    const hit = warnOf(b.root, b.dir, b.slug);
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain('prd/2-product-design');
    for (const exempt of ['`api`', '`database`', '`scenario`']) expect(hit[0].message).not.toContain(exempt);
  });

  it('UT-S35-162 免计边界·需求级恒不告警（delta 覆盖全部八类）', () => {
    const { root, dir, slug } = setup('需求级',
      [D_PRD1, D_PRD2, D_PRD3, D_API, D_DB, D_SCEN, D_TEST, D_DEC, D_SPEC, D_SKILL]);
    expect(warnOf(root, dir, slug)).toHaveLength(0);
  });

  it('UT-S35-163 decisions 与层级正交：四档声明类型下均不告警', () => {
    for (const [i, t] of ['代码级', '接口级', '设计级', '需求级'].entries()) {
      const { root, dir, slug } = setup(t, [D_DEC], `dec-${i}`);
      expect(warnOf(root, dir, slug), `声明${t}时 decisions 不应告警`).toHaveLength(0);
    }
  });

  it('UT-S35-164 spec / skills 归设计级及以上', () => {
    for (const [i, t] of ['代码级', '接口级'].entries()) {
      const { root, dir, slug } = setup(t, [D_SPEC, D_SKILL], `ss-low-${i}`);
      const hit = warnOf(root, dir, slug);
      expect(hit, `声明${t}时应告警`).toHaveLength(1);
      expect(hit[0].message).toContain('spec');
      expect(hit[0].message).toContain('skills');
    }
    for (const [i, t] of ['设计级', '需求级'].entries()) {
      const { root, dir, slug } = setup(t, [D_SPEC, D_SKILL], `ss-high-${i}`);
      expect(warnOf(root, dir, slug), `声明${t}时不应告警`).toHaveLength(0);
    }
  });

  it('UT-S35-165 prd 子目录粒度：判定取自 relativePath，未知子目录不免计', () => {
    const ok = setup('设计级', [D_PRD2], 'prd2');
    expect(warnOf(ok.root, ok.dir, ok.slug)).toHaveLength(0);

    // 自触发形态：设计级 + prd/1-product-requirements。**预期行为，不是缺陷**。
    const req = setup('设计级', [D_PRD1], 'prd1');
    const hitReq = warnOf(req.root, req.dir, req.slug);
    expect(hitReq).toHaveLength(1);
    expect(hitReq[0].message).toContain('prd/1-product-requirements');
    expect(hitReq[0].message).not.toContain('`prd`'); // 子目录粒度，不是笼统的一级类别

    const unknown = setup('设计级', ['deltas/prd/9-unknown-bucket/core-x.md'], 'prd9');
    const hitUnknown = warnOf(unknown.root, unknown.dir, unknown.slug);
    expect(hitUnknown).toHaveLength(1);
    expect(hitUnknown[0].message).toContain('prd/9-unknown-bucket');
  });

  it('UT-S35-166 resolveChangeType·剥括号后唯一命中（zh，含嵌套与残缺括号）', () => {
    expect(resolveChangeType('代码级（不涉及设计级或需求级变更）', 'zh')).toBe('code');
    // 嵌套说明：正则式「吃到第一个右括号」会残留「，不涉及需求级）」而退化成歧义 null（静默漏报）。
    expect(resolveChangeType('代码级（修复解析器（局部实现），不涉及需求级）', 'zh')).toBe('code');
    expect(resolveChangeType('代码级（（三层（更深）嵌套））', 'zh')).toBe('code');
    // 残缺括号：未闭合的左括号之后全部视作说明文字；孤立右括号忽略——两者都不得误报。
    expect(resolveChangeType('代码级（未闭合说明，不涉及需求级', 'zh')).toBe('code');
    expect(resolveChangeType('代码级）孤立右括号', 'zh')).toBe('code');
    const { root, dir, slug } = setup('代码级（不涉及设计级或需求级变更）', [D_PRD3]);
    expect(resolveProposalChangeType(readFileSync(join(dir, 'proposal.md'), 'utf-8'))).toBe('code');
    expect(warnOf(root, dir, slug)).toHaveLength(1);
  });

  it('UT-S35-167 resolveChangeType·歧义两通道同时静默（zh）', () => {
    expect(resolveChangeType('设计级 / 代码级', 'zh')).toBeNull();
    const { root, dir, slug } = setup('设计级 / 代码级', [D_PRD1]);
    const r = lint(root, dir, slug);
    expect(r.warnings.map(w => w.code)).not.toContain(WARN);
    // 歧义正文通过既有包含式合法性检查，本就合法——不得因歧义而在另一侧报错。
    expect(r.violations.map(v => v.code)).not.toContain('proposal_change_type_invalid');
  });

  it('UT-S35-168 英文括号与歧义对称行为（en）', () => {
    expect(resolveChangeType('code level (not a design or requirements level change)', 'en')).toBe('code');
    expect(resolveChangeType('code level (fix parser (inner bit), not a requirements change)', 'en')).toBe('code');
    expect(resolveChangeType('design / code level', 'en')).toBeNull();
    const en = proposalBody('code level (not a design or requirements level change)', 'en');
    expect(resolveProposalChangeType(en)).toBe('code');
    expect(resolveProposalChangeType(proposalBody('design / code level', 'en'))).toBeNull();
  });

  it('UT-S35-169 有效条目口径：explicitly_ignored / invalid / 根下直放不计入', () => {
    const { root, dir, slug } = setup('代码级', [], 'invalid-only');
    for (const rel of ['deltas/reference/note.md', 'deltas/.hidden.md', 'deltas/loose.md']) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, ['## ADDED — 夹具', '', '正文', ''].join('\n'));
    }
    const r = lint(root, dir, slug);
    expect(r.warnings.map(w => w.code)).not.toContain(WARN);
    // 有效条目为空 → 恒不越界；既有 L6 对这些形态的结论不受本能力影响。
    expect(r.checks.find(c => c.id === 6)).toBeDefined();
  });

  it('UT-S35-170 零回归锚：结构诊断逐字段对齐上线前实测基线', () => {
    // 基线由 scratchpad/capture-baseline.mjs 在 commit 66889f0（本能力 feat 提交之前）的
    // cli 构建上实测捕获，随仓落盘于 test/fixtures/。**不是在测试内复述期望文案**。
    expect(BASELINE.structureDiagnostics.length).toBeGreaterThan(0);
    for (const sample of BASELINE.structureDiagnostics) {
      const locale = sample.locale as 'zh' | 'en';
      const body = baselineProposalFor(sample.content, locale);
      const actual = evaluateProposalStructure(body, 'proposal.md', locale).map(i => ({
        code: i.code, path: i.path, section_id: i.section_id ?? null, line: i.line ?? null,
        actual: i.actual ?? null, expected: i.expected ?? null, message: i.message, fix_hint: i.fix_hint,
      }));
      // 完整诊断字段逐字相同（code / path / section_id / line / actual / expected / message / fix_hint）。
      expect(actual, `${locale}:${sample.content}`).toEqual(sample.issues);
    }
    // 判据本体同样对齐基线：合法性结论由基线诊断中该码的有无反推。
    for (const sample of BASELINE.structureDiagnostics) {
      const expectValid = !sample.issues.some(i => i.code === 'proposal_change_type_invalid');
      expect(isValidChangeType(sample.content, sample.locale as 'zh' | 'en'),
        `${sample.locale}:${sample.content}`).toBe(expectValid);
    }
  });

  it('UT-S35-171 零回归锚：违规码全集、检查项集合与失败结论对齐上线前实测基线', () => {
    // ① 违规码**全集**逐字相同——新增任一其它码同样会红，不只是「新 warning 不在其中」。
    expect([...CHANGE_LINT_VIOLATION_CODES].sort()).toEqual(BASELINE.violationCodes);
    expect(CHANGE_LINT_VIOLATION_CODES).not.toContain(WARN);

    // ② 逐场景对齐基线：检查项集合（id + label + violations）、violations 完整字段、pass 结论。
    const cases: Array<[string, string, string[], Array<[string, string]>]> = [
      ['code+prd3', '代码级', [D_PRD3], []],
      ['code+test', '代码级', [D_TEST], []],
      ['requirements+prd3', '需求级', [D_PRD3], []],
      ['design+prd1', '设计级', [D_PRD1], []],
      ['ambiguous+prd1', '设计级 / 代码级', [D_PRD1], []],
      ['nodelta', '代码级', [], []],
      ['code+prd3+broken', '代码级', [D_PRD3], [['deltas/test/broken.md', '没有任何 ADDED/MODIFIED 段标记的正文\n']]],
    ];
    for (const [key, changeType, deltas, extra] of cases) {
      const base = scenario(key);
      expect(base, `基线缺场景 ${key}`).toBeDefined();
      const f = baselineFixture(changeType, deltas, extra);
      const r = lint(f.root, f.dir, f.slug);
      expect(r.checks.map(c => ({ id: c.id, label: c.label, violations: c.violations })), `${key}: 检查项集合须对齐基线`)
        .toEqual(base.checks);
      expect(r.violations.map(v => ({ code: v.code, path: v.path, message: v.message, fix_hint: v.fix_hint })),
        `${key}: violations 须对齐基线`).toEqual(base.violations);
      expect(r.violations.length === 0, `${key}: pass 结论须对齐基线`).toBe(base.pass);
      // 新 warning 只能出现在 warnings，且基线中该通道的既有内容不得被顶掉。
      expect(r.violations.map(v => v.code)).not.toContain(WARN);
      for (const code of base.warningCodes ?? []) expect(r.warnings.map(w => w.code)).toContain(code);
    }

    // ③ 真实违规仍 FAIL：warning 不得把失败结论改成通过，且命令层退出码为 2。
    const bad = baselineFixture('代码级', [D_PRD3],
      [['deltas/test/broken.md', '没有任何 ADDED/MODIFIED 段标记的正文\n']]);
    const rb = lint(bad.root, bad.dir, bad.slug);
    expect(rb.violations.length).toBeGreaterThan(0);
    expect(rb.warnings.map(w => w.code)).toContain(WARN);
    const cli = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), 'change-lint'], {
      cwd: bad.root, encoding: 'utf-8', env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
    });
    expect(cli.status, '有真实违规时必须 exit 2').toBe(2);
    expect(cli.stdout).toMatch(/^FAIL（/m);

    // ④ 无 delta 对照：有效条目为空，恒不告警且结论对齐基线。
    const nd = baselineFixture('代码级', []);
    const rn = lint(nd.root, nd.dir, nd.slug);
    expect(rn.warnings.map(w => w.code)).not.toContain(WARN);
    expect(rn.checks.map(c => c.id)).toEqual(scenario('nodelta').checks!.map(c => c.id));
  });

  it('UT-S35-172 可归因与零漂移：逐项点名、措辞克制、warnings 空则省略', () => {
    const { root, dir, slug } = setup('代码级', [D_PRD1, D_SPEC], 'attrib');
    const hit = warnOf(root, dir, slug);
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain('prd/1-product-requirements');
    expect(hit[0].message).toContain('spec'); // 两层都点名，不是只给首项或计数
    expect(hit[0].message).toContain('代码级');
    for (const banned of ['违反方法论', '违规', '不合规']) {
      expect(hit[0].message, '观测启发式不得断言违规').not.toContain(banned);
      expect(hit[0].fix_hint, '观测启发式不得断言违规').not.toContain(banned);
    }
    const quiet = setup('代码级', [D_TEST], 'attrib-quiet');
    expect(lint(quiet.root, quiet.dir, quiet.slug).warnings).toHaveLength(0);
  });

  it('ST-S35-31 真实 CLI 端到端：观测 warning 出数而不改变任何门禁结论', () => {
    const run = (root: string) => {
      const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), 'change-lint', '--format', 'json'], {
        cwd: root, encoding: 'utf-8', env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
      });
      return { status: r.status, json: JSON.parse(r.stdout || '{}') };
    };

    // ① 主臂：声明代码级 + prd delta。
    const a = setup('代码级', [D_PRD3], 'st-main');
    const ra = run(a.root);
    expect(ra.status).toBe(0);
    expect(ra.json.data.pass).toBe(true);
    expect(ra.json.data.violations ?? []).toHaveLength(0);
    const w = (ra.json.data.warnings ?? []).filter((x: { code: string }) => x.code === WARN);
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('prd/3-technical-plan');
    // ② 措辞断言。
    for (const banned of ['违反方法论', '违规', '不合规']) {
      expect(w[0].message).not.toContain(banned);
      expect(w[0].fix_hint).not.toContain(banned);
    }
    // ③ 对照臂·免计形态（独立夹具）。
    const b = setup('代码级', [D_TEST], 'st-exempt');
    const rb = run(b.root);
    expect(rb.status).toBe(0);
    expect(rb.json.data.warnings).toBeUndefined(); // 非空才出现，零漂移

    // ④ 对照臂·歧义（独立夹具；必须带 prd/1 才有鉴别力——该层对设计级与代码级都不免计，
    //    实现若把歧义错误解析成两者中任一个都会告警而使本臂红）。
    const c = setup('设计级 / 代码级', [D_PRD1], 'st-ambiguous');
    const rc = run(c.root);
    expect(rc.status).toBe(0);
    expect((rc.json.data.warnings ?? []).map((x: { code: string }) => x.code)).not.toContain(WARN);
    expect((rc.json.data.violations ?? []).map((x: { code: string }) => x.code))
      .not.toContain('proposal_change_type_invalid');

    // ⑤ 门禁不变：三臂的检查项集合与通过数取自真实人读输出（JSON 信封不含 checks），
    //    逐字相同且全通过——**不硬编码 10/10**：总数随适用性（如 GUI 才激活的 L7）变化。
    const checkLines = (root: string): string[] => {
      const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), 'change-lint'], {
        cwd: root, encoding: 'utf-8', env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
      });
      return (r.stdout ?? '').split('\n')
        .map(l => /^\s+([✓✗])\s+(L\d+)\b/.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map(m => `${m[2]}:${m[1]}`);
    };
    const la = checkLines(a.root);
    expect(la.length).toBeGreaterThan(0);
    expect(la).toEqual(checkLines(b.root));
    expect(la).toEqual(checkLines(c.root));
    expect(la.every(x => x.endsWith(':✓'))).toBe(true);
    for (const j of [ra.json, rb.json, rc.json]) expect(j.data.pass).toBe(true);

    // ⑤b merge 准入一致性：S09 已冻结「准入判定 = change-lint 完整结论」，warning 不进
    //    violations 故不得改变准入。主臂（命中 warning）必须照常放行并写 SPEC_MERGED；
    //    反证臂（同夹具另加一条真实违规）必须被拒且不写 marker——证明拒绝来自违规而非 warning。
    const mergeOf = (root: string, slug: string) => spawnSync(
      process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), 'merge', slug],
      { cwd: root, encoding: 'utf-8', env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' } });
    const mMain = mergeOf(a.root, a.slug);
    expect(mMain.status, `命中 warning 不得改变 merge 准入：${mMain.stderr || mMain.stdout}`).toBe(0);
    expect(existsSync(join(a.dir, 'SPEC_MERGED'))).toBe(true);

    // 反证臂的违规必须是**只有 change-lint 准入才检出**的形态，否则 merge 自身的 delta 校验
    // 会先行拒绝，该臂就测不到准入路径（实测：用「delta 缺段标记」构造时，把准入判定短路掉
    // 本臂仍绿——因为拒绝来自 merge 内部的 validateMarkdownDelta）。故取部署决策冲突
    // （L5 / tasks_deployment_conflict）：proposal 声明无需部署而 tasks 带 [deploy] section。
    const d = setup('代码级', [D_PRD3], 'st-violation');
    writeFileSync(join(d.dir, 'tasks.md'), [
      '# 实现任务', '', '## [delta] 规格变更', '- [ ] 产出 delta 到 `deltas/test/` — 新增用例', '',
      '## [code] 代码实现', '', '## [deploy] 部署任务', '- [ ] 发布新版本', '',
    ].join('\n'));
    const preBad = run(d.root);
    expect(preBad.status, '该臂须确有 change-lint 违规').toBe(2);
    expect((preBad.json.data.violations ?? []).map((x: { code: string }) => x.code))
      .toContain('tasks_deployment_conflict');
    const mBad = mergeOf(d.root, d.slug);
    expect(mBad.status, '准入违规必须挡停 merge').not.toBe(0);
    expect(existsSync(join(d.dir, 'SPEC_MERGED'))).toBe(false);

    // ⑥ 只读红线：change-lint 运行前后**整个项目根**逐文件字节指纹相等（不止提案目录）。
    const e = setup('代码级', [D_PRD1, D_SPEC], 'st-readonly');
    const beforeTree = treeFingerprint(e.root);
    const ro = run(e.root);
    expect(ro.status).toBe(0);
    expect((ro.json.data.warnings ?? []).map((x: { code: string }) => x.code)).toContain(WARN);
    checkLines(e.root); // 文本形态同样只读
    expect(treeFingerprint(e.root), 'change-lint 必须项目级零写入').toEqual(beforeTree);
  });
});
