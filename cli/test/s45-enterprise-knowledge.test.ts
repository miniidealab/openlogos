/**
 * S45 — 企业知识沉淀与场景引用（enterprise-knowledge-base，切片 slice-01-knowledge-reference）。
 * 用例 ID 与 logos/resources/test/core-S45-test-cases.md 严格对齐：切片1 覆盖 UT-S45-01～06、09、10、12、13、15、16、17、19、20，
 * ST-S45-01、04、05；切片2（slice-02-retirement-and-release）覆盖 UT-S45-07、08、11、14、18，ST-S45-02、03。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { withoutAcceptanceMissing } from './acceptance-criteria-lint-codes.js';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DELTA_TO_RESOURCE, classifyProposalDeltas } from '../src/lib/delta-classify.js';
import { MERGE_SUPPORTED_DELTA_DIRS } from '../src/lib/proposal-lifecycle.js';
import { MERGE_SUPPORTED_DELTA_DIRS_FOR_UI } from '../src/lib/flow-derive.js';
import { classifyCanonicalTargetCategory } from '../src/lib/canonical-target.js';
import { CHANGE_LINT_VIOLATION_CODES, evaluateDeltaConservation } from '../src/lib/change-lint.js';
import { composeOpenLogosMarkdown } from '../src/lib/markdown-section-authority.js';
import {
  buildKnowledgeView, candidateMarkdownAfter, findDuplicateIds, parseKnowledgeEntry, readKnowledgeDir, resolveKnowledgeReference,
} from '../src/lib/knowledge-view.js';
import { inferResourceDesc, scanCandidateFiles, syncResourceIndex } from '../src/lib/sync-resource-index.js';
import { DIRECTORIES, REFERENCE_SUBDIRECTORIES } from '../src/commands/init.js';

const CLI_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const REPO_ROOT = resolve(CLI_ROOT, '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function put(root: string, rel: string, content: string): void {
  const full = join(root, ...rel.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
function read(root: string, rel: string): string { return readFileSync(join(root, ...rel.split('/')), 'utf8'); }

/** 生产合并语义：显式关闭 vitest 全局的 legacy merge 开关。 */
function cli(cwd: string, args: string[]) {
  const env = { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' };
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 120000, env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
function lintJson(root: string, slug = 'p1') {
  const r = cli(root, ['change-lint', '--slug', slug, '--format', 'json']);
  const env = JSON.parse(r.stdout.trim());
  return { status: r.status, data: env.data as { pass: boolean; violations: Array<{ code: string; path: string; message: string; fix_hint: string }>; warnings?: Array<{ code: string; message: string; fix_hint: string }> }, raw: r.stdout };
}
const codes = (d: { violations: Array<{ code: string }> }) => d.violations.map(v => v.code);
const knowledgeViolations = (d: { violations: Array<{ code: string; path: string; message: string }> }) =>
  d.violations.filter(v => v.code.startsWith('knowledge_'));

const KDIR = 'logos/resources/knowledge';
const SRC = 'logos/resources/reference/knowledge/refund-policy.md';
const SCEN = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';

interface EntryOpts {
  type?: string; scope?: string; module?: string | null; status?: string; tags?: unknown; source?: unknown;
  rules?: Array<[string, string, string?]>; h1?: string; noMeta?: boolean; extra?: string;
}
/** 按 §2.102.3 模板生成条目正文。 */
function entry(id: string, name: string, o: EntryOpts = {}): string {
  const type = o.type ?? 'rule';
  const meta: Record<string, unknown> = { type, scope: o.scope ?? 'module' };
  if (o.module !== null) meta.module = o.module ?? 'core';
  meta.tags = o.tags === undefined ? ['退款'] : o.tags;
  meta.status = o.status ?? 'active';
  meta.source = o.source === undefined ? [{ path: SRC, version: 'v3' }] : o.source;
  for (const k of Object.keys(meta)) if (meta[k] === '__omit__') delete meta[k];
  const yaml = Object.entries(meta).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n');
  const lines = [`# ${o.h1 ?? `${id}：${name}`}`, ''];
  if (!o.noMeta) lines.push('## 元数据', '', '```yaml', yaml, '```', '');
  const rules = o.rules ?? (type === 'rule' ? [[`${id}-R1`, '单笔退款大于 5000 元需财务二审']] : []);
  if (rules.length > 0) {
    lines.push('## 规则', '', '| ID | 规则 | 状态 | 例外 |', '|---|---|---|---|');
    for (const [rid, text, status] of rules) lines.push(`| ${rid} | ${text} | ${status ?? 'active'} | 无 |`);
    lines.push('');
  }
  lines.push('## 说明', '', o.extra ?? `${name}的背景说明。`, '');
  return lines.join('\n');
}
const wholeFile = (target: string, body: string) => `## ADDED — ${target}（新文件，整文件）\n${body}`;
function scenarioDoc(id: string, refs: string[]): string {
  return [
    `# ${id}：退款`, '', '## 场景目标', '', '完成退款。', '', '## 时序图', '', 'Step 1：提交退款。', '',
    '## 适用业务约束', '', '| 引用 | 作用位置 | 说明 | 例外 |', '|---|---|---|---|',
    ...refs.map(r => `| ${r} | Step 1 | 约束 | 无 |`), '', '## 异常与边界', '', '无。', '',
  ].join('\n');
}

const CLARIFICATION = '## 决策澄清\n\n```yaml\nschema: openlogos/clarification@1\nmode: adaptive\nstatus: complete\nimpacts:\n  data: {status: none, reason: fixture}\n  compatibility: {status: none, reason: fixture}\n  security_privacy: {status: none, reason: fixture}\n  public_release: {status: none, reason: fixture}\n  external_commitment: {status: none, reason: fixture}\ndecisions: []\nunresolved: []\ndefaults: []\n```\n';

interface Fixture { root: string; slug: string; dir: string }
interface FixtureOpts {
  /** 已合并（磁盘上）的文件：相对项目根 → 正文。 */
  disk?: Record<string, string>;
  /** 本提案 delta：相对提案目录（以 deltas/ 开头）→ 正文。 */
  deltas?: Record<string, string>;
  /** 是否预建原文目录与原文文件（默认 true）。 */
  source?: boolean;
  /** 是否预建 logos/resources/knowledge/（默认 true）。 */
  knowledgeDir?: boolean;
  git?: boolean;
}
/** launched 项目 + ready-to-merge 提案 p1（PLAN_APPROVED，delta 全勾选）。 */
function fixture(o: FixtureOpts = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-s45-'));
  roots.push(root);
  const slug = 'p1';
  const dir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/logos.config.json', '{"locale":"zh","project":{"type":"cli"}}\n');
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: S45 Fixture\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 46\nresource_index: []\n');
  mkdirSync(join(root, ...SCEN.split('/')), { recursive: true });
  if (o.knowledgeDir !== false) mkdirSync(join(root, ...KDIR.split('/')), { recursive: true });
  if (o.source !== false) put(root, SRC, '# 退款制度 v3\n\n单笔退款大于 5000 元需财务二审。\n');
  // 强制维度：需求 / 功能规格 / 场景各一个 MODIFIED，保证 merge 准入与既有 fixture 同口径
  const base: Record<string, string> = {
    'logos/resources/prd/1-product-requirements/core-01-requirements.md': '# 需求\n\n## 一、判据\n\n旧正文。\n',
    'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md': '# 规格\n\n## 一、判据\n\n旧正文。\n',
    'logos/resources/test/core-S01-test-cases.md': '# 用例\n\n## 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |\n',
  };
  for (const [p, c] of Object.entries({ ...base, ...(o.disk ?? {}) })) put(root, p, c);
  const deltas: Record<string, string> = {
    'deltas/prd/1-product-requirements/core-01-requirements.md': '## MODIFIED — 一、判据\n\n新正文。\n',
    'deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md': '## MODIFIED — 一、判据\n\n新正文。\n',
    'deltas/test/core-S01-test-cases.md': '## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |\n',
    ...(o.deltas ?? {}),
  };
  writeDeltas({ root, slug, dir }, deltas);
  put(root, `logos/changes/${slug}/proposal.md`,
    '# 变更提案：s45 fixture\n\n## 变更原因\n真实原因。\n\n## 变更类型\n需求级\n\n## 变更范围\n- 影响的功能规格：fixture\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 变更概述\n概述。\n\n'
    + CLARIFICATION);
  put(root, `logos/changes/${slug}/PLAN_APPROVED`, '{}');
  if (o.git) {
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', '--local', 'user.email', 't@e']);
    git(root, ['config', '--local', 'user.name', 't']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'base']);
  }
  return { root, slug, dir };
}
/** 写入 delta 并重写 tasks.md（delta 全勾选，满足 P==T==D）。 */
function writeDeltas(f: Fixture, deltas: Record<string, string>): void {
  for (const [rel, content] of Object.entries(deltas)) put(f.root, `logos/changes/${f.slug}/${rel}`, content);
  const all: string[] = [];
  const walk = (d: string, prefix: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs, `${prefix}${name}/`);
      else all.push(`${prefix}${name}`);
    }
  };
  walk(join(f.dir, 'deltas'), 'deltas/');
  const items = all.map(p => {
    const target = p.replace(/^deltas\//, '');
    const mapped = target.startsWith('knowledge/') ? `logos/resources/${target}` : target.startsWith('prd/') || target.startsWith('test/') ? `logos/resources/${target}` : target;
    const mode = existsSync(join(f.root, ...mapped.split('/'))) ? 'MODIFY' : 'CREATE';
    return `- [x] [${mode}] \`${p}\`：fixture`;
  });
  put(f.root, `logos/changes/${f.slug}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n${items.join('\n')}\n\n## [code] 代码实现\n`);
}
function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
/** 项目全部文件（不含 .git）的字节快照。 */
function snapshotTree(root: string): Map<string, string> {
  const snap = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === '.git') continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else snap.set(abs, readFileSync(abs, 'utf8'));
    }
  };
  walk(root);
  return snap;
}
function expectTreeUnchanged(root: string, before: Map<string, string>) {
  const after = snapshotTree(root);
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [k, v] of before) expect(after.get(k), k).toBe(v);
}

const K01_REFUND = `${KDIR}/core-K01-refund.md`;
const scenarioDelta = (name: string, refs: string[]) => ({
  [`deltas/prd/3-technical-plan/2-scenario-implementation/${name}`]:
    wholeFile(`${SCEN}/${name}`, scenarioDoc(name.replace(/^core-|\.md$/g, ''), refs)),
});
const knowledgeDelta = (file: string, body: string) => ({ [`deltas/knowledge/${file}`]: wholeFile(`${KDIR}/${file}`, body) });

/* ═══════════ 一、UT ═══════════ */

describe('S45 企业知识 — 类别注册与解析（UT）', () => {
  it('UT-S45-01: knowledge delta 类别注册且同源', () => {
    expect(DELTA_TO_RESOURCE.knowledge).toBe('logos/resources/knowledge');
    const sets = [Object.keys(DELTA_TO_RESOURCE), [...MERGE_SUPPORTED_DELTA_DIRS], [...MERGE_SUPPORTED_DELTA_DIRS_FOR_UI]].map(s => [...s].sort());
    expect(sets[1]).toContain('knowledge');
    expect(sets[2]).toContain('knowledge');
    expect(sets[0]).toEqual(sets[1]);
    expect(sets[1]).toEqual(sets[2]);
    expect(classifyCanonicalTargetCategory(`${KDIR}/core-K01-a.md`)).toBe('knowledge');
    const f = fixture({ deltas: { ...knowledgeDelta('core-K01-a.md', entry('K01', '退款')), 'deltas/reference/x.md': '## ADDED — x\n内容\n' } });
    const entries = classifyProposalDeltas(f.dir);
    const k = entries.find(e => e.relativePath === 'deltas/knowledge/core-K01-a.md')!;
    expect(k.lintValidity).toBe('valid');
    expect(k.mergeDisposition).toBe('mergeable');
    const ref = entries.find(e => e.relativePath === 'deltas/reference/x.md')!;
    expect(ref.lintValidity).toBe('explicitly_ignored');
    // code-r1 F2：知识目标只接受顶层 <module>-KXX-<slug>.md；非 .md 与嵌套目标在准入拒绝，合法顶层条目照常可引用
    const g = fixture({
      disk: { [`${KDIR}/core-K03-refund.md`]: entry('K03', '退款审批') },
      deltas: {
        'deltas/knowledge/core-K09-x.txt': '## MODIFIED — 一、判据\n\n正文。\n',
        'deltas/knowledge/sub/core-K10-y.md': wholeFile(`${KDIR}/sub/core-K10-y.md`, entry('K10', '嵌套')),
        ...scenarioDelta('core-S50-refund.md', ['K03-R1']),
      },
    });
    const rg = lintJson(g.root);
    const shape = rg.data.violations.filter(v => v.code === 'knowledge_entry_invalid');
    expect(shape.map(v => v.path).sort()).toEqual([
      'logos/changes/p1/deltas/knowledge/core-K09-x.txt', 'logos/changes/p1/deltas/knowledge/sub/core-K10-y.md',
    ]);
    for (const v of shape) expect(v.message).toContain('不符合规范形态');
    expect(codes(rg.data)).not.toContain('knowledge_reference_unknown');
    const before = snapshotTree(g.root);
    expect(cli(g.root, ['merge', 'p1']).status).not.toBe(0);
    expectTreeUnchanged(g.root, before);
    // code-r2 F2：顶层但缺模块前缀的 K11-refund.md 不是规范文件名——准入拒绝、不能成为引用目标
    const noModule = fixture({
      deltas: { ...knowledgeDelta('K11-refund.md', entry('K11', '退款')), ...scenarioDelta('core-S50-refund.md', ['K11-R1']) },
    });
    const rn = lintJson(noModule.root);
    expect(rn.status).toBe(2);
    const nm = rn.data.violations.filter(v => v.code === 'knowledge_entry_invalid');
    expect(nm.map(v => v.path)).toEqual(['logos/changes/p1/deltas/knowledge/K11-refund.md']);
    expect(nm[0].message).toContain('不符合规范形态');
    expect(rn.data.violations.some(v => v.code === 'knowledge_reference_unknown' && v.message.includes('K11-R1'))).toBe(true);
    const parsedNoModule = parseKnowledgeEntry(`${KDIR}/K11-refund.md`, entry('K11', '退款'), { root: noModule.root });
    expect(parsedNoModule.id).toBe('K11'); // 仍可提取 KXX 供重号诊断
    expect(parsedNoModule.valid).toBe(false);
    expect(resolveKnowledgeReference(buildKnowledgeView([parsedNoModule]), 'K11-R1')).toMatchObject({ kind: 'unknown', reason: 'invalid' });
    const beforeNm = snapshotTree(noModule.root);
    expect(cli(noModule.root, ['merge', 'p1']).status).not.toBe(0);
    expectTreeUnchanged(noModule.root, beforeNm);
  });

  it('UT-S45-02: 条目解析（规则 / 术语 / 混入异号行 / 缺元数据）', () => {
    const f = fixture();
    const k03 = parseKnowledgeEntry(`${KDIR}/core-K03-refund.md`, entry('K03', '退款审批', {
      rules: [['K03-R1', '大于 5000 元二审'], ['K03-R2', '原路退回', 'deprecated']],
    }), { root: f.root });
    expect(k03.id).toBe('K03');
    expect(k03.title?.startsWith('K03')).toBe(true);
    expect(k03.valid).toBe(true);
    expect(k03.meta).toMatchObject({ type: 'rule', scope: 'module', module: 'core', tags: ['退款'], status: 'active' });
    expect(k03.meta?.source).toEqual([{ path: SRC, version: 'v3' }]);
    expect(k03.rules.map(r => [r.id, r.status])).toEqual([['K03-R1', 'active'], ['K03-R2', 'deprecated']]);

    const k05 = parseKnowledgeEntry(`${KDIR}/core-K05-settle-day.md`, entry('K05', '结算日', { type: 'term' }), { root: f.root });
    expect(k05.id).toBe('K05');
    expect(k05.valid).toBe(true);
    expect(k05.rules).toEqual([]);

    const mixed = parseKnowledgeEntry(`${KDIR}/core-K03-mixed.md`, entry('K03', '混合', {
      rules: [['K03-R1', 'a'], ['K03-R2', 'b'], ['K09-R1', 'c']],
    }), { root: f.root });
    expect(mixed.valid).toBe(false);
    expect(mixed.problems.join('；')).toContain('K09-R1');
    const view = buildKnowledgeView([mixed]);
    expect(resolveKnowledgeReference(view, 'K03-R1')).toMatchObject({ kind: 'unknown', reason: 'invalid' });

    const noMeta = parseKnowledgeEntry(`${KDIR}/core-K07-x.md`, entry('K07', '无元数据', { noMeta: true, type: 'term' }), { root: f.root });
    expect(noMeta.id).toBe('K07');
    expect(noMeta.valid).toBe(false);
    expect(noMeta.problems).toContain('缺「元数据」节');
    expect(resolveKnowledgeReference(buildKnowledgeView([noMeta]), 'K07')).toMatchObject({ kind: 'unknown', reason: 'invalid' });

    // code-r1 F3：GFM 表格语义——转义竖线不分隔单元格；缺分隔行、规则正文为空均为无效
    const piped = parseKnowledgeEntry(`${KDIR}/core-K11-pipe.md`, entry('K11', '转义', { rules: [['K11-R1', '渠道为 A \\| B 时需复核']] }), { root: f.root });
    expect(piped.valid, piped.problems.join('；')).toBe(true);
    expect(piped.rules.map(r => [r.id, r.status])).toEqual([['K11-R1', 'active']]);
    expect(resolveKnowledgeReference(buildKnowledgeView([piped]), 'K11-R1')).toMatchObject({ kind: 'ok' });
    const noDelim = parseKnowledgeEntry(`${KDIR}/core-K12-nodelim.md`,
      entry('K12', '缺分隔行').replace('| ID | 规则 | 状态 | 例外 |\n|---|---|---|---|\n', '| ID | 规则 | 状态 | 例外 |\n'), { root: f.root });
    expect(noDelim.valid).toBe(false);
    expect(noDelim.problems.join('；')).toContain('分隔行');
    expect(resolveKnowledgeReference(buildKnowledgeView([noDelim]), 'K12-R1')).toMatchObject({ kind: 'unknown', reason: 'invalid' });
    const emptyText = parseKnowledgeEntry(`${KDIR}/core-K13-empty.md`, entry('K13', '空正文', { rules: [['K13-R1', '']] }), { root: f.root });
    expect(emptyText.valid).toBe(false);
    expect(emptyText.problems.join('；')).toContain('规则正文为空');
    expect(resolveKnowledgeReference(buildKnowledgeView([emptyText]), 'K13-R1')).toMatchObject({ kind: 'unknown', reason: 'invalid' });

    // code-r2 F3：HTML 注释内的整张规则表、只含注释的规则正文都不算实际规则
    const commentedTable = entry('K14', '注释表').replace('| ID | 规则 | 状态 | 例外 |', '<!--\n| ID | 规则 | 状态 | 例外 |')
      .replace('| K14-R1 | 单笔退款大于 5000 元需财务二审 | active | 无 |', '| K14-R1 | 单笔退款大于 5000 元需财务二审 | active | 无 |\n-->');
    const inComment = parseKnowledgeEntry(`${KDIR}/core-K14-comment.md`, commentedTable, { root: f.root });
    expect(inComment.valid).toBe(false);
    expect(inComment.rules).toEqual([]);
    expect(resolveKnowledgeReference(buildKnowledgeView([inComment]), 'K14-R1')).toMatchObject({ kind: 'unknown' });
    const commentOnly = parseKnowledgeEntry(`${KDIR}/core-K15-comment-cell.md`, entry('K15', '注释正文', { rules: [['K15-R1', '<!-- 待补 -->']] }), { root: f.root });
    expect(commentOnly.valid).toBe(false);
    expect(commentOnly.problems.join('；')).toContain('规则正文为空');
    expect(resolveKnowledgeReference(buildKnowledgeView([commentOnly]), 'K15-R1')).toMatchObject({ kind: 'unknown', reason: 'invalid' });
    // 准入：新增这两类条目报 knowledge_entry_invalid，规则引用被拒
    const g = fixture({
      deltas: {
        ...knowledgeDelta('core-K14-comment.md', commentedTable),
        ...knowledgeDelta('core-K15-comment-cell.md', entry('K15', '注释正文', { rules: [['K15-R1', '<!-- 待补 -->']] })),
        ...scenarioDelta('core-S50-refund.md', ['K14-R1', 'K15-R1']),
      },
    });
    const rg = lintJson(g.root);
    expect(rg.data.violations.filter(v => v.code === 'knowledge_entry_invalid').map(v => v.path.split('/').pop()).sort())
      .toEqual(['core-K14-comment.md', 'core-K15-comment-cell.md']);
    expect(rg.data.violations.filter(v => v.code === 'knowledge_reference_unknown')).toHaveLength(2);
    expect(rg.status).toBe(2);

    // code-r3 F3：GFM 表格在分隔行之后直到空行才结束——紧跟的无竖线续行也是数据行，必须进入列数与 ID 校验
    const withContinuation = (id: string, extra: string) =>
      entry(id, '续行').replace(`| ${id}-R1 | 单笔退款大于 5000 元需财务二审 | active | 无 |`, `| ${id}-R1 | 单笔退款大于 5000 元需财务二审 | active | 无 |\n${extra}`);
    const ownCont = parseKnowledgeEntry(`${KDIR}/core-K16-cont.md`, withContinuation('K16', 'K16-R2'), { root: f.root });
    expect(ownCont.valid).toBe(false);
    expect(ownCont.problems.join('；')).toMatch(/列数|规则正文为空|状态/);
    expect(resolveKnowledgeReference(buildKnowledgeView([ownCont]), 'K16-R1')).toMatchObject({ kind: 'unknown', reason: 'invalid' });
    expect(resolveKnowledgeReference(buildKnowledgeView([ownCont]), 'K16')).toMatchObject({ kind: 'unknown', reason: 'invalid' });
    const foreignCont = parseKnowledgeEntry(`${KDIR}/core-K17-cont.md`, withContinuation('K17', 'K99-R9'), { root: f.root });
    expect(foreignCont.valid).toBe(false);
    expect(foreignCont.problems.join('；')).toContain('K99-R9');
    expect(resolveKnowledgeReference(buildKnowledgeView([foreignCont]), 'K17-R1')).toMatchObject({ kind: 'unknown', reason: 'invalid' });
    const gc = fixture({
      deltas: {
        ...knowledgeDelta('core-K16-cont.md', withContinuation('K16', 'K16-R2')),
        ...knowledgeDelta('core-K17-cont.md', withContinuation('K17', 'K99-R9')),
        ...scenarioDelta('core-S50-refund.md', ['K16-R1', 'K17']),
      },
    });
    const rc = lintJson(gc.root);
    expect(rc.data.violations.filter(v => v.code === 'knowledge_entry_invalid').map(v => v.path.split('/').pop()).sort())
      .toEqual(['core-K16-cont.md', 'core-K17-cont.md']);
    expect(rc.data.violations.filter(v => v.code === 'knowledge_reference_unknown')).toHaveLength(2);
    expect(rc.status).toBe(2);
    // 表格后有空行时，后续段落不并入表格（合法条目保持有效）
    const blankAfter = parseKnowledgeEntry(`${KDIR}/core-K18-ok.md`, entry('K18', '正常'), { root: f.root });
    expect(blankAfter.valid, blankAfter.problems.join('；')).toBe(true);
    // code-r4 F3：表格紧接另一个块级结构（列表、分隔线、有序列表）时在该处结束——条目有效、规则可解析
    for (const [label, extra] of [['无序列表', '- 审批由财务负责。'], ['分隔线', '***'], ['有序列表', '1. 审批由财务负责。']] as const) {
      const okEntry = parseKnowledgeEntry(`${KDIR}/core-K16-block.md`, withContinuation('K16', extra), { root: f.root });
      expect(okEntry.valid, `${label}：${okEntry.problems.join('；')}`).toBe(true);
      expect(okEntry.rules.map(r => r.id), label).toEqual(['K16-R1']);
      expect(resolveKnowledgeReference(buildKnowledgeView([okEntry]), 'K16-R1'), label).toMatchObject({ kind: 'ok' });
    }
    const gb = fixture({
      deltas: {
        ...knowledgeDelta('core-K16-block.md', withContinuation('K16', '- 审批由财务负责。')),
        ...knowledgeDelta('core-K17-block.md', withContinuation('K17', '***')),
        ...scenarioDelta('core-S50-refund.md', ['K16-R1', 'K17-R1']),
      },
    });
    const rb = lintJson(gb.root);
    expect(knowledgeViolations(rb.data)).toEqual([]);
    expect(rb.data.pass).toBe(true);
    // code-r5 F3：表格边界与 GFM 解析器（mdast-util-gfm-table）同口径——自动链接与行内标签（CommonMark HTML 类型 7）
    // 不打断表格，仍是数据行并进入校验；块级 HTML（类型 1～6，如 <div>）与 HTML 注释才结束表格。
    // 下表的「GFM 数据行数」取自仓库网站所用解析器对同一输入的实测结果。
    const gfmOracle: Array<[string, string, number, boolean]> = [
      ['自动链接', '<https://example.org>', 2, false],
      ['行内标签首列', '<span>说明</span> | 内容 | active | 无 |', 2, false],
      ['块级 HTML', '<div>块</div>', 1, true],
      ['HTML 注释', '<!-- x -->', 1, true],
      ['无序列表', '- 审批由财务负责。', 1, true],
      ['分隔线', '***', 1, true],
    ];
    for (const [label, extra, gfmRows, valid] of gfmOracle) {
      const parsed = parseKnowledgeEntry(`${KDIR}/core-K16-html.md`, withContinuation('K16', extra), { root: f.root });
      expect(parsed.valid, `${label}：${parsed.problems.join('；')}`).toBe(valid);
      expect(resolveKnowledgeReference(buildKnowledgeView([parsed]), 'K16-R1').kind, label).toBe(valid ? 'ok' : 'unknown');
      // 数据行数与 GFM 一致：有效时只有 K16-R1；无效时多出的那行被当作数据行校验（问题点名该行）
      if (valid) expect(parsed.rules.map(r => r.id), label).toEqual(['K16-R1']);
      else expect(parsed.problems.some(p => p.includes(`第 ${parsed.rules[0].line + 1} 行`)), label).toBe(true);
      expect(gfmRows, label).toBe(valid ? 1 : 2);
    }
  });

  it('UT-S45-03: 有效知识视图合成（已合并 + 本提案 delta，不读其他提案与 archive）', () => {
    const k03 = entry('K03', '退款审批');
    const f = fixture({
      disk: {
        [`${KDIR}/core-K03-refund.md`]: k03,
        [`${KDIR}/core-K05-settle-day.md`]: entry('K05', '结算日', { type: 'term' }),
        'logos/changes/other/deltas/knowledge/core-K07-x.md': wholeFile(`${KDIR}/core-K07-x.md`, entry('K07', '他案')),
        'logos/changes/archive/20260101-old/deltas/knowledge/core-K07-y.md': wholeFile(`${KDIR}/core-K07-y.md`, entry('K07', '归档')),
      },
    });
    const addK06 = wholeFile(`${KDIR}/core-K06-x.md`, entry('K06', '新增'));
    const modK03 = '## MODIFIED — 规则\n\n| ID | 规则 | 状态 | 例外 |\n|---|---|---|---|\n| K03-R1 | 单笔退款大于 5000 元需财务二审 | active | 无 |\n| K03-R3 | 退款需原路返回 | active | 无 |\n';
    const live = readKnowledgeDir(f.root);
    const candidate = new Map(live);
    const after06 = candidateMarkdownAfter(f.root, `${KDIR}/core-K06-x.md`, addK06, { mode: 'CREATE', content: null });
    const after03 = candidateMarkdownAfter(f.root, `${KDIR}/core-K03-refund.md`, modK03, { mode: 'MODIFY', content: k03 });
    expect(after06).not.toBeNull();
    expect(after03).toBe(composeOpenLogosMarkdown(k03, modK03, 'MODIFY'));
    candidate.set(`${KDIR}/core-K06-x.md`, after06!);
    candidate.set(`${KDIR}/core-K03-refund.md`, after03!);
    const view = buildKnowledgeView([...candidate].map(([p, c]) => parseKnowledgeEntry(p, c, { root: f.root })));
    expect([...view.byId.keys()].sort()).toEqual(['K03', 'K05', 'K06']);
    expect(view.byId.get('K03')![0].rules.map(r => r.id)).toEqual(['K03-R1', 'K03-R3']);
    expect(view.byId.has('K07')).toBe(false);
  });

  it('UT-S45-04: 编号重复（跨文件 KXX / 同条目 Rn / 引用重号 ID）', () => {
    // ① 已合并 K01-refund，本提案新增 K01-customer-id
    const f1 = fixture({
      disk: { [K01_REFUND]: entry('K01', '退款') },
      deltas: knowledgeDelta('core-K01-customer-id.md', entry('K01', '客户编号')),
    });
    const r1 = lintJson(f1.root);
    expect(r1.status).toBe(2);
    const d1 = r1.data.violations.filter(v => v.code === 'knowledge_id_duplicate');
    expect(d1).toHaveLength(1);
    expect(d1[0].path).toBe('logos/changes/p1/deltas/knowledge/core-K01-customer-id.md');
    expect(d1[0].message).toContain(K01_REFUND);
    expect(d1[0].message).toContain(`${KDIR}/core-K01-customer-id.md`);
    // 纯函数：视图对该 ID 的解析结果为歧义且列出两个来源
    const view = buildKnowledgeView([
      parseKnowledgeEntry(K01_REFUND, entry('K01', '退款'), { root: f1.root }),
      parseKnowledgeEntry(`${KDIR}/core-K01-customer-id.md`, entry('K01', '客户编号'), { root: f1.root }),
    ]);
    expect(resolveKnowledgeReference(view, 'K01')).toEqual({ kind: 'duplicate', id: 'K01', paths: [`${KDIR}/core-K01-customer-id.md`, K01_REFUND] });
    expect(findDuplicateIds(view)).toEqual([{ id: 'K01', paths: [`${KDIR}/core-K01-customer-id.md`, K01_REFUND] }]);

    // ② 本提案修改 K03，规则表两行都是 K03-R1
    const k03 = entry('K03', '退款审批');
    const f2 = fixture({
      disk: { [`${KDIR}/core-K03-refund.md`]: k03 },
      deltas: { 'deltas/knowledge/core-K03-refund.md': '## MODIFIED — 规则\n\n| ID | 规则 | 状态 | 例外 |\n|---|---|---|---|\n| K03-R1 | 甲 | active | 无 |\n| K03-R1 | 乙 | active | 无 |\n' },
    });
    const r2 = lintJson(f2.root);
    const d2 = r2.data.violations.filter(v => v.code === 'knowledge_id_duplicate');
    expect(d2).toHaveLength(1);
    expect(d2[0].path).toBe('logos/changes/p1/deltas/knowledge/core-K03-refund.md');
    expect(d2[0].message).toContain('K03-R1');
    expect(d2[0].message).toContain(`${KDIR}/core-K03-refund.md`);

    // ③ 本提案场景引用 K01（已合并两个 K01，本提案不触及知识）
    const f3 = fixture({
      disk: { [K01_REFUND]: entry('K01', '退款'), [`${KDIR}/core-K01-customer-id.md`]: entry('K01', '客户编号') },
      deltas: scenarioDelta('core-S50-refund.md', ['K01']),
    });
    const r3 = lintJson(f3.root);
    expect(r3.status).toBe(2);
    expect(codes(r3.data).filter(c => c === 'knowledge_id_duplicate')).toHaveLength(1);
    expect(codes(r3.data)).not.toContain('knowledge_reference_unknown');
  });

  it('UT-S45-05: 引用解析——不存在的引用报 unknown，含文件、行与引用文本', () => {
    const f = fixture({
      disk: {
        [`${KDIR}/core-K03-refund.md`]: entry('K03', '退款审批'),
        [`${KDIR}/core-K05-settle-day.md`]: entry('K05', '结算日', { type: 'term' }),
      },
      deltas: scenarioDelta('core-S50-refund.md', ['K03-R1', 'K05', 'K03-R9', 'K08']),
    });
    const r = lintJson(f.root);
    expect(r.status).toBe(2);
    const unknown = r.data.violations.filter(v => v.code === 'knowledge_reference_unknown');
    expect(unknown.map(v => v.message.match(/引用的 (\S+) /)![1])).toEqual(['K03-R9', 'K08']);
    for (const v of unknown) {
      expect(v.path).toBe('logos/changes/p1/deltas/prd/3-technical-plan/2-scenario-implementation/core-S50-refund.md');
      expect(v.message).toMatch(new RegExp(`${SCEN}/core-S50-refund\\.md:\\d+`));
    }
    // code-r1 F1：只含章节式场景 delta（无知识 delta）时同样启用校验——在合成后的候选场景上判定约束章节
    const scen = `${SCEN}/core-S40-settle.md`;
    const plainScenario = '# S40：结算\n\n## 场景目标\n\n结算。\n\n## 异常与边界\n\n无。\n';
    const sectionAdded = fixture({
      disk: { [`${KDIR}/core-K03-refund.md`]: entry('K03', '退款审批'), [scen]: plainScenario },
      deltas: { 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S40-settle.md':
        '## ADDED — 适用业务约束\n\n| 引用 | 作用位置 | 说明 | 例外 |\n|---|---|---|---|\n| K81-R1 | Step 1 | 约束 | 无 |\n' },
    });
    const ra = lintJson(sectionAdded.root);
    expect(ra.status).toBe(2);
    expect(ra.data.violations.filter(v => v.code === 'knowledge_reference_unknown').map(v => v.message).join('\n')).toContain('K81-R1');
    const beforeA = snapshotTree(sectionAdded.root);
    expect(cli(sectionAdded.root, ['merge', 'p1']).status).not.toBe(0);
    expectTreeUnchanged(sectionAdded.root, beforeA);
    const sectionModified = fixture({
      disk: { [`${KDIR}/core-K03-refund.md`]: entry('K03', '退款审批'), [scen]: scenarioDoc('S40', ['K03-R1']) },
      deltas: { 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S40-settle.md':
        '## MODIFIED — 适用业务约束\n\n| 引用 | 作用位置 | 说明 | 例外 |\n|---|---|---|---|\n| K03-R1 | Step 1 | 约束 | 无 |\n| K82-R1 | Step 1 | 约束 | 无 |\n' },
    });
    const rm = lintJson(sectionModified.root);
    expect(rm.status).toBe(2);
    const unk = rm.data.violations.filter(v => v.code === 'knowledge_reference_unknown');
    expect(unk.map(v => v.message.match(/引用的 (\S+) /)![1])).toEqual(['K82-R1']);
    expect(cli(sectionModified.root, ['merge', 'p1']).status).not.toBe(0);
  });

  it('UT-S45-06: 引用已退役——只告警、不阻断', () => {
    // ① 已合并 K03-R2 为 deprecated，本提案场景引用 K03-R2
    const f1 = fixture({
      disk: { [`${KDIR}/core-K03-refund.md`]: entry('K03', '退款审批', { rules: [['K03-R1', 'a'], ['K03-R2', 'b', 'deprecated']] }) },
      deltas: scenarioDelta('core-S50-refund.md', ['K03-R2']),
    });
    const r1 = lintJson(f1.root);
    expect(r1.status).toBe(0);
    expect(r1.data.pass).toBe(true);
    expect(knowledgeViolations(r1.data)).toEqual([]);
    // verify-self-sufficient-cases：夹具早于「验收标准」段，缺段提醒是有意新增的 warning，不属本断言范围。
    const w1 = withoutAcceptanceMissing(r1.data.warnings);
    expect(w1.map(w => w.code)).toEqual(['knowledge_reference_deprecated']);
    expect(w1[0].message).toContain('K03-R2');
    expect(Object.keys(w1[0]).sort()).toEqual(['code', 'fix_hint', 'message']);

    // ② 本提案把已合并 K05 改为 deprecated；未改动的已合并场景仍引用 K05
    const k05 = entry('K05', '结算日', { type: 'term' });
    const f2 = fixture({
      disk: { [`${KDIR}/core-K05-settle-day.md`]: k05, [`${SCEN}/core-S40-settle.md`]: scenarioDoc('S40', ['K05']) },
      deltas: { 'deltas/knowledge/core-K05-settle-day.md': `## MODIFIED — 元数据\n\n\`\`\`yaml\ntype: "term"\nscope: "module"\nmodule: "core"\ntags: ["退款"]\nstatus: "deprecated"\nsource: [{"path":"${SRC}","version":"v3"}]\n\`\`\`\n` },
    });
    const r2 = lintJson(f2.root);
    expect(r2.status).toBe(0);
    expect(knowledgeViolations(r2.data)).toEqual([]);
    const w2 = withoutAcceptanceMissing(r2.data.warnings);
    expect(w2.filter(w => w.code === 'knowledge_reference_deprecated')).toHaveLength(1);
    expect(w2[0].message).toContain(`${SCEN}/core-S40-settle.md`);
    expect(w2[0].message).toContain('K05');
  });

  it('UT-S45-09: 同批新增条目被新场景引用——通过', () => {
    const f = fixture({
      deltas: { ...knowledgeDelta('core-K01-refund.md', entry('K01', '退款')), ...scenarioDelta('core-S50-refund.md', ['K01-R1']) },
    });
    const r = lintJson(f.root);
    expect(codes(r.data)).not.toContain('knowledge_reference_unknown');
    expect(r.data.pass).toBe(true);
    expect(r.status).toBe(0);
  });

  it('UT-S45-10: 零回归——未启用 L10 时不读知识目录、无 L10 检查项行', () => {
    const f = fixture({ knowledgeDir: false });
    const base = lintJson(f.root);
    const human = cli(f.root, ['change-lint', '--slug', 'p1']);
    expect(human.stdout).not.toContain('L10');
    expect(base.raw).not.toContain('knowledge_');
    // 往知识目录放一个结构无效的条目：未启用 L10 时它不被读取，JSON 除 timestamp 外逐字节不变
    put(f.root, `${KDIR}/core-K01-broken.md`, '# K01：只有标题\n');
    const after = lintJson(f.root);
    const strip = (s: string) => s.replace(/"timestamp":"[^"]*"/, '');
    expect(strip(after.raw)).toBe(strip(base.raw));
    expect(base.data.pass).toBe(true);
  });

  it('UT-S45-12: 资源索引补录 knowledge，既有人工描述不变', () => {
    const f = fixture();
    put(f.root, `${KDIR}/core-K01-a.md`, entry('K01', '退款'));
    put(f.root, `${KDIR}/core-K02-b.md`, entry('K02', '客户编号'));
    put(f.root, 'logos/logos-project.yaml', `project:\n  name: S45 Fixture\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nresource_index:\n  - path: ${KDIR}/core-K02-b.md\n    desc: 人工描述的客户编号条目\n`);
    expect(scanCandidateFiles(f.root)).toContain(`${KDIR}/core-K01-a.md`);
    expect(inferResourceDesc(`${KDIR}/core-K01-a.md`, 'zh')).toContain('K01');
    syncResourceIndex(f.root, 'zh');
    const idx = (parseYaml(read(f.root, 'logos/logos-project.yaml')).resource_index ?? []) as Array<{ path: string; desc: string }>;
    expect(idx.find(e => e.path === `${KDIR}/core-K01-a.md`)?.desc).toContain('K01');
    expect(idx.find(e => e.path === `${KDIR}/core-K02-b.md`)?.desc).toBe('人工描述的客户编号条目');
  });

  it('UT-S45-13: init 创建 knowledge/ 与 reference/knowledge/', () => {
    expect(DIRECTORIES).toContain('logos/resources/knowledge');
    expect(REFERENCE_SUBDIRECTORIES).toContain('knowledge');
    const root = mkdtempSync(join(tmpdir(), 'openlogos-s45-init-'));
    roots.push(root);
    const r = spawnSync(process.execPath, [CLI, 'init', '--locale', 'zh', '--ai-tool', 'other', 's45-init'], { cwd: root, encoding: 'utf8', timeout: 120000 });
    expect(r.status, r.stderr).toBe(0);
    expect(statSync(join(root, 'logos', 'resources', 'knowledge')).isDirectory()).toBe(true);
    expect(statSync(join(root, 'logos', 'resources', 'reference', 'knowledge')).isDirectory()).toBe(true);
  });

  it('UT-S45-15: Skill 文档包含知识加载、录入入口与冲突裁决（中英文）', () => {
    const skill = (name: string, en = false) => readFileSync(join(REPO_ROOT, 'skills', name, en ? 'SKILL.en.md' : 'SKILL.md'), 'utf8');
    for (const name of ['prd-writer', 'product-designer', 'scenario-architect', 'change-writer', 'test-writer']) {
      const zh = skill(name);
      const en = skill(name, true);
      expect(zh, name).toContain('加载相关企业知识');
      expect(en, name).toContain('Load relevant enterprise knowledge');
      expect(zh, name).toContain('录入入口');
      expect(en, name).toContain('Intake entry point');
      expect(zh, name).toContain('本轮用户没有提供企业资料');
      expect(en, name).toContain('has not provided enterprise material');
    }
    expect(skill('scenario-architect')).toContain('适用业务约束');
    expect(skill('scenario-architect', true)).toContain('applicable business constraints');
    expect(skill('change-writer')).toContain('原文将随仓库 push 扩散');
    expect(skill('change-writer')).toContain('预定 KXX');
    expect(skill('change-writer', true)).toContain('reserve the KXX');
    expect(skill('test-writer')).toContain('从 `KXX-Rn` 派生用例');
    expect(skill('test-writer', true)).toContain('Derive cases from `KXX-Rn`');
  });
});

describe('S45 企业知识 — 合并阶段与结构（UT）', () => {
  it('UT-S45-16: 合并后复跑不重放', () => {
    const f = fixture({
      deltas: { ...knowledgeDelta('core-K01-refund.md', entry('K01', '退款')), ...scenarioDelta('core-S50-refund.md', ['K01-R1']) },
    });
    expect(lintJson(f.root).data.pass).toBe(true);
    const m = cli(f.root, ['merge', 'p1']);
    expect(m.status, m.stderr).toBe(0);
    expect(existsSync(join(f.dir, 'SPEC_MERGED'))).toBe(true);
    const again = lintJson(f.root);
    expect(again.data.violations).toEqual([]);
    expect(again.data.pass).toBe(true);
    expect(again.raw).not.toContain('non_markdown_delta_invalid');
  });

  it('UT-S45-17: 待应用修正以合并基线计算候选后态，与实际写入一致', () => {
    // 增量修正依赖 git 对象库保存的合并基线，故在真实 git 仓库中构造
    const f = fixture({
      git: true,
      deltas: { ...knowledgeDelta('core-K01-refund.md', entry('K01', '退款')), ...scenarioDelta('core-S50-refund.md', ['K01-R1']) },
    });
    expect(cli(f.root, ['merge', 'p1']).status).toBe(0);
    // 修改同一 ADDED delta：给 K01 新增 K01-R2，形成待应用修正
    const amended = entry('K01', '退款', { rules: [['K01-R1', '单笔退款大于 5000 元需财务二审'], ['K01-R2', '退款需原路返回']] });
    writeDeltas(f, knowledgeDelta('core-K01-refund.md', amended));
    const lint = lintJson(f.root);
    expect(lint.data.violations).toEqual([]);
    expect(lint.data.pass).toBe(true);
    const expected = candidateMarkdownAfter(f.root, K01_REFUND, read(f.root, `logos/changes/p1/deltas/knowledge/core-K01-refund.md`), { mode: 'CREATE', content: null });
    const m = cli(f.root, ['merge', 'p1']);
    expect(m.status, m.stderr + m.stdout).toBe(0);
    expect(read(f.root, K01_REFUND)).toBe(expected);
    expect(read(f.root, K01_REFUND)).toContain('K01-R2');

    // code-r1 F4：撤回场景 MODIFY 时，恢复为合并基线的场景纳入有效场景视图
    const scen = `${SCEN}/core-S40-settle.md`;
    const g = fixture({
      git: true,
      disk: {
        [`${KDIR}/core-K03-refund.md`]: entry('K03', '退款审批'),
        [`${KDIR}/core-K05-settle-day.md`]: entry('K05', '结算日', { type: 'term' }),
        [`${KDIR}/core-K07-legacy.md`]: entry('K07', '存量', { tags: '__omit__' }),
        [scen]: scenarioDoc('S40', ['K03', 'K07']),
      },
      deltas: { 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S40-settle.md':
        '## MODIFIED — 适用业务约束\n\n| 引用 | 作用位置 | 说明 | 例外 |\n|---|---|---|---|\n| K05 | Step 1 | 约束 | 无 |\n' },
    });
    const first = cli(g.root, ['merge', 'p1']);
    expect(first.status, first.stderr).toBe(0);
    expect(read(g.root, scen)).not.toContain('| K03 |');
    // 撤回场景 delta，同时把 K03 退役：实际写回的场景会恢复对 K03、K07 的引用
    rmSync(join(g.dir, 'deltas', 'prd', '3-technical-plan', '2-scenario-implementation'), { recursive: true, force: true });
    writeDeltas(g, { 'deltas/knowledge/core-K03-refund.md': `## MODIFIED — 元数据\n\n\`\`\`yaml\ntype: "rule"\nscope: "module"\nmodule: "core"\ntags: ["退款"]\nstatus: "deprecated"\nsource: [{"path":"${SRC}","version":"v3"}]\n\`\`\`\n` });
    const amend = lintJson(g.root);
    expect(amend.data.warnings?.some(w => w.code === 'knowledge_reference_deprecated' && w.message.includes(scen) && w.message.includes('K03'))).toBe(true);
    const unknownK07 = amend.data.violations.filter(v => v.code === 'knowledge_reference_unknown');
    expect(unknownK07).toHaveLength(1);
    expect(unknownK07[0].path).toBe(scen);
    expect(unknownK07[0].message).toContain('K07');
    expect(amend.status).toBe(2);
  });

  it('UT-S45-19: 结构无效的新条目不能落盘也不能被引用', () => {
    const f = fixture({
      deltas: { ...knowledgeDelta('core-K01-refund.md', '# K01：退款规则\n'), ...scenarioDelta('core-S50-refund.md', ['K01']) },
    });
    const before = snapshotTree(f.root);
    const r = lintJson(f.root);
    expect(r.status).toBe(2);
    const inv = r.data.violations.filter(v => v.code === 'knowledge_entry_invalid');
    expect(inv).toHaveLength(1);
    expect(inv[0].path).toBe('logos/changes/p1/deltas/knowledge/core-K01-refund.md');
    expect(inv[0].message).toContain('缺「元数据」节');
    const unk = r.data.violations.filter(v => v.code === 'knowledge_reference_unknown');
    expect(unk).toHaveLength(1);
    expect(unk[0].message).toContain('目标条目结构无效');
    expectTreeUnchanged(f.root, before);
    const m = cli(f.root, ['merge', 'p1']);
    expect(m.status).not.toBe(0);
    expectTreeUnchanged(f.root, before);
  });

  it('UT-S45-20: 元数据部分缺项、来源越界与规则行格式', () => {
    const cases: Array<[string, EntryOpts, string]> = [
      ['K01', { source: '__omit__' }, 'source 缺失或为空'],
      ['K02', { source: [{ path: SRC }] }, 'source[0] 缺 version'],
      ['K03', { source: [{ path: 'logos/resources/reference/knowledge/missing.md', version: 'v1' }] }, '指向的文件不存在'],
      ['K04', { tags: [] }, 'tags 缺失或不是非空字符串列表'],
      ['K05', { rules: [['K05-R1', 'a'], ['K09-R1', 'b']] }, 'K09-R1'],
      ['K06', { source: [{ path: 'README.md', version: 'v1' }] }, '不在 logos/resources/reference/knowledge/ 内'],
      ['K07', { source: [{ path: 'logos/resources/reference/knowledge/link.md', version: 'v1' }] }, '解析真实路径后不在'],
    ];
    const deltas: Record<string, string> = {};
    for (const [id, o] of cases) Object.assign(deltas, knowledgeDelta(`core-${id}-x.md`, entry(id, `条目${id}`, o)));
    Object.assign(deltas, scenarioDelta('core-S50-refund.md', cases.map(([id]) => `${id}-R1`)));
    const f = fixture({
      deltas,
      disk: { [`${KDIR}/core-K20-legacy.md`]: entry('K20', '存量', { tags: '__omit__' }), 'README.md': '# readme\n' },
    });
    symlinkSync(join(f.root, 'README.md'), join(f.root, 'logos', 'resources', 'reference', 'knowledge', 'link.md'));
    const before = snapshotTree(f.root);
    const r = lintJson(f.root);
    expect(r.status).toBe(2);
    const inv = r.data.violations.filter(v => v.code === 'knowledge_entry_invalid');
    expect(inv.map(v => v.path.split('/').pop())).toEqual(cases.map(([id]) => `core-${id}-x.md`));
    cases.forEach(([, , hint], i) => expect(inv[i].message, hint).toContain(hint));
    const unk = r.data.violations.filter(v => v.code === 'knowledge_reference_unknown');
    expect(unk).toHaveLength(cases.length);
    for (const v of unk) expect(v.message).toContain('目标条目结构无效');
    // 存量结构无效条目不因本提案报 entry_invalid
    expect(r.data.violations.some(v => v.message.includes('core-K20-legacy.md') && v.code === 'knowledge_entry_invalid')).toBe(false);
    const m = cli(f.root, ['merge', 'p1']);
    expect(m.status).not.toBe(0);
    expectTreeUnchanged(f.root, before);

    // code-r1 F5：原文目录或其上级解析到仓库外时，即使原文文件「属于该目录」也判无效
    for (const linkAt of ['logos/resources/reference/knowledge', 'logos/resources/reference']) {
      const outside = mkdtempSync(join(tmpdir(), 'openlogos-s45-outside-'));
      roots.push(outside);
      const h = fixture({ source: false, deltas: knowledgeDelta('core-K01-x.md', entry('K01', '外部原文')) });
      const linkAbs = join(h.root, ...linkAt.split('/'));
      rmSync(linkAbs, { recursive: true, force: true });
      mkdirSync(dirname(linkAbs), { recursive: true });
      if (!linkAt.endsWith('knowledge')) mkdirSync(join(outside, 'knowledge'), { recursive: true });
      put(outside, linkAt.endsWith('knowledge') ? 'refund-policy.md' : 'knowledge/refund-policy.md', '# 外部原文\n');
      symlinkSync(outside, linkAbs);
      expect(existsSync(join(h.root, ...SRC.split('/'))), linkAt).toBe(true);
      const rh = lintJson(h.root);
      const inv = rh.data.violations.filter(v => v.code === 'knowledge_entry_invalid');
      expect(inv, linkAt).toHaveLength(1);
      expect(inv[0].message, linkAt).toContain('不在仓库内约定位置');
    }
  });
});

/* ═══════════ 二、ST ═══════════ */

describe('S45 企业知识 — 场景测试（ST）', () => {
  it('ST-S45-01: 新录入知识与场景同批合并的全链路', () => {
    const f = fixture({
      deltas: {
        ...knowledgeDelta('core-K01-refund.md', entry('K01', '退款')),
        ...knowledgeDelta('core-K02-settle-day.md', entry('K02', '结算日', { type: 'term' })),
        ...scenarioDelta('core-S50-refund.md', ['K01-R1', 'K02']),
      },
    });
    const lint = lintJson(f.root);
    expect(lint.data.pass).toBe(true);
    const m = cli(f.root, ['merge', 'p1']);
    expect(m.status, m.stderr).toBe(0);
    expect(read(f.root, K01_REFUND)).toContain('K01-R1');
    expect(read(f.root, `${KDIR}/core-K02-settle-day.md`)).toContain('K02：结算日');
    expect(read(f.root, `${SCEN}/core-S50-refund.md`)).toContain('| K01-R1 |');
    const idx = (parseYaml(read(f.root, 'logos/logos-project.yaml')).resource_index ?? []) as Array<{ path: string }>;
    for (const p of [K01_REFUND, `${KDIR}/core-K02-settle-day.md`, `${SCEN}/core-S50-refund.md`]) {
      expect(idx.some(e => e.path === p), p).toBe(true);
    }
    const marker = JSON.parse(readFileSync(join(f.dir, 'SPEC_MERGED'), 'utf8'));
    expect(marker.type).toBe('merge_complete');
  });

  it('ST-S45-04: 跨分支重号被拦截，重编号后合并', () => {
    const f = fixture({ git: true, deltas: scenarioDelta('core-S50-refund.md', ['K01-R1']) });
    // 分支 A 已把 K01-refund 合入主线
    git(f.root, ['checkout', '-qb', 'proposal-a']);
    put(f.root, K01_REFUND, entry('K01', '退款'));
    git(f.root, ['add', '-A']);
    git(f.root, ['commit', '-qm', 'A: K01 refund']);
    git(f.root, ['checkout', '-q', 'main']);
    git(f.root, ['merge', '-q', '--no-ff', '-m', 'merge A', 'proposal-a']);
    // 分支 B（本提案）从旧起点分出、新增 K01-customer-id，再同步主线
    git(f.root, ['checkout', '-qb', 'proposal-b', 'HEAD~1']);
    writeDeltas(f, knowledgeDelta('core-K01-customer-id.md', entry('K01', '客户编号')));
    git(f.root, ['add', '-A']);
    git(f.root, ['commit', '-qm', 'B: K01 customer id']);
    git(f.root, ['merge', '-q', '-m', 'sync main', 'main']);
    expect(existsSync(join(f.root, ...K01_REFUND.split('/')))).toBe(true);

    const r = lintJson(f.root);
    expect(r.status).toBe(2);
    const dup = r.data.violations.filter(v => v.code === 'knowledge_id_duplicate');
    expect(dup).toHaveLength(1);
    expect(dup[0].path).toBe('logos/changes/p1/deltas/knowledge/core-K01-customer-id.md');
    expect(dup[0].message).toContain('core-K01-refund.md');
    expect(dup[0].message).toContain('core-K01-customer-id.md');
    const before = snapshotTree(f.root);
    expect(cli(f.root, ['merge', 'p1']).status).not.toBe(0);
    expectTreeUnchanged(f.root, before);

    // 重编号为 K02 并改写本提案内的引用
    rmSync(join(f.dir, 'deltas', 'knowledge', 'core-K01-customer-id.md'));
    writeDeltas(f, { ...knowledgeDelta('core-K02-customer-id.md', entry('K02', '客户编号')), ...scenarioDelta('core-S50-refund.md', ['K01-R1', 'K02-R1']) });
    const ok = lintJson(f.root);
    expect(ok.data.violations).toEqual([]);
    const m = cli(f.root, ['merge', 'p1']);
    expect(m.status, m.stderr).toBe(0);
    expect(read(f.root, K01_REFUND)).toContain('K01：退款');
    expect(read(f.root, `${KDIR}/core-K02-customer-id.md`)).toContain('K02：客户编号');
  });

  it('ST-S45-05: 升级前已 launched 的项目首次录入', () => {
    const f = fixture({ knowledgeDir: false, source: false });
    expect(existsSync(join(f.root, ...KDIR.split('/')))).toBe(false);
    expect(existsSync(join(f.root, 'logos', 'resources', 'reference', 'knowledge'))).toBe(false);
    // 按 Skill 录入入口：创建原文目录并写原文，产出知识 delta 与引用它的新场景
    put(f.root, 'logos/resources/reference/knowledge/refund-policy.md', '# 退款制度\n\n大于 5000 元二审。\n');
    writeDeltas(f, { ...knowledgeDelta('core-K01-refund.md', entry('K01', '退款')), ...scenarioDelta('core-S50-refund.md', ['K01-R1']) });
    const lint = lintJson(f.root);
    expect(lint.data.pass).toBe(true);
    const m = cli(f.root, ['merge', 'p1']);
    expect(m.status, m.stderr).toBe(0);
    const landed = read(f.root, K01_REFUND);
    expect(landed).toContain(SRC);
    expect(existsSync(join(f.root, ...SRC.split('/')))).toBe(true);
    const idx = (parseYaml(read(f.root, 'logos/logos-project.yaml')).resource_index ?? []) as Array<{ path: string }>;
    expect(idx.some(e => e.path === K01_REFUND)).toBe(true);
  });
});

/* ═══════════ 切片2：退役保护（UT / ST）═══════════ */

const K03 = `${KDIR}/core-K03-refund.md`;
const K03_RULES = (r2 = ['K03-R2', '退款原路返回', 'deprecated'] as [string, string, string]) =>
  entry('K03', '退款审批', { rules: [['K03-R1', '单笔退款大于 5000 元需财务二审'], r2] });
const rulesBlock = (rows: Array<[string, string, string, string?]>) =>
  `## MODIFIED — 规则\n\n| ID | 规则 | 状态 | 例外 |\n|---|---|---|---|\n${rows.map(([id, t, st, ex]) => `| ${id} | ${t} | ${st} | ${ex ?? '无'} |`).join('\n')}\n`;
const lintOf = (disk: Record<string, string>, deltas: Record<string, string>) => lintJson(fixture({ disk, deltas }).root);

describe('S45 企业知识 — 退役保护（UT）', () => {
  it('UT-S45-07: 禁止删除已合并条目与规则', () => {
    // ① 对已合并 K03 写 REMOVED
    const r1 = lintOf({ [K03]: K03_RULES() }, { 'deltas/knowledge/core-K03-refund.md': '## REMOVED — 说明\n\n整节删除。\n' });
    const v1 = r1.data.violations.filter(v => v.code === 'knowledge_removal_forbidden');
    expect(v1).toHaveLength(1);
    expect(v1[0].path).toBe('logos/changes/p1/deltas/knowledge/core-K03-refund.md');
    expect(v1[0].fix_hint).toContain('deprecated');
    // ② 同锚 MODIFIED 去掉 K03-R2 + REMOVED-ITEMS 点名
    const r2 = lintOf({ [K03]: K03_RULES() }, {
      'deltas/knowledge/core-K03-refund.md': `${rulesBlock([['K03-R1', '单笔退款大于 5000 元需财务二审', 'active']])}\n## REMOVED-ITEMS — 规则\n- K03-R2 — 不再需要\n`,
    });
    const v2 = r2.data.violations.filter(v => v.code === 'knowledge_removal_forbidden');
    expect(v2).toHaveLength(1);
    expect(v2[0].message).toContain('K03-R2');
    // ③ 新文件名重新承载 K03，同时删除原文件内容（改文件名）
    const r3 = lintOf({ [K03]: K03_RULES() }, {
      ...knowledgeDelta('core-K03-renamed.md', K03_RULES()),
      'deltas/knowledge/core-K03-refund.md': '## REMOVED — 规则\n\n迁到新文件。\n',
    });
    expect(codes(r3.data)).toContain('knowledge_removal_forbidden');
    expect(r3.status).toBe(2);
    // ④ 本提案新增、尚未合并的条目可以删除或重编号（这里已重编号为 K07，原 K06 不存在）
    const r4 = lintOf({ [K03]: K03_RULES() }, knowledgeDelta('core-K07-x.md', entry('K07', '新增')));
    expect(codes(r4.data)).not.toContain('knowledge_removal_forbidden');
    expect(r4.data.pass).toBe(true);
  });

  it('UT-S45-08: 退役 ID 冻结（条目整体、规则三列；active 规则修订放行）', () => {
    const K04 = `${KDIR}/core-K04-old.md`;
    const K05 = `${KDIR}/core-K05-settle-day.md`;
    const disk = {
      [K03]: K03_RULES(),
      [K04]: entry('K04', '旧流程', { status: 'deprecated' }),
      [K05]: entry('K05', '结算日', { type: 'term', status: 'deprecated', extra: '结算日为银行清算日历中的日期。' }),
    };
    const mutated: Array<[string, Record<string, string>]> = [
      ['① K03-R2 改回 active', { 'deltas/knowledge/core-K03-refund.md': rulesBlock([['K03-R1', '单笔退款大于 5000 元需财务二审', 'active'], ['K03-R2', '退款原路返回', 'active']]) }],
      ['② K03-R2 改写正文', { 'deltas/knowledge/core-K03-refund.md': rulesBlock([['K03-R1', '单笔退款大于 5000 元需财务二审', 'active'], ['K03-R2', '客户编号由主数据系统下发', 'deprecated']]) }],
      ['③ K04 改标题', { 'deltas/knowledge/core-K04-old.md': '## RENAMED — K04：旧流程\nK04：新流程\n' }],
      ['④ K04 改 type', { 'deltas/knowledge/core-K04-old.md': `## MODIFIED — 元数据\n\n\`\`\`yaml\ntype: "compliance"\nscope: "module"\nmodule: "core"\ntags: ["退款"]\nstatus: "deprecated"\nsource: [{"path":"${SRC}","version":"v3"}]\n\`\`\`\n` }],
      ['⑥ K05 只改「说明」定义', { 'deltas/knowledge/core-K05-settle-day.md': '## MODIFIED — 说明\n\n结算日为自然日。\n' }],
      ['⑦ K03-R2 只改例外', { 'deltas/knowledge/core-K03-refund.md': rulesBlock([['K03-R1', '单笔退款大于 5000 元需财务二审', 'active'], ['K03-R2', '退款原路返回', 'deprecated', '原渠道注销时转人工']]) }],
    ];
    for (const [label, deltas] of mutated) {
      const r = lintOf(disk, deltas);
      const v = r.data.violations.filter(x => x.code === 'knowledge_retired_id_mutated');
      expect(v, label).toHaveLength(1);
      expect(v[0].path, label).toBe(`logos/changes/p1/${Object.keys(deltas)[0]}`);
      expect(v[0].message, label).toMatch(/K0[345]/);
      expect(r.status, label).toBe(2);
    }
    // ⑤ active 的 K03-R1 阈值 5000 → 8000：同一规则的修订，放行
    const ok = lintOf(disk, { 'deltas/knowledge/core-K03-refund.md': rulesBlock([['K03-R1', '单笔退款大于 8000 元需财务二审', 'active'], ['K03-R2', '退款原路返回', 'deprecated']]) });
    expect(codes(ok.data)).not.toContain('knowledge_retired_id_mutated');
    expect(ok.data.pass).toBe(true);
  });

  it('UT-S45-11: 守恒注册范围——知识规则隐式删除被拦，场景引用不计为场景条目 ID', () => {
    // ① MODIFIED 漏抄 K03-R2 且未点名
    const r1 = lintOf({ [K03]: K03_RULES() }, { 'deltas/knowledge/core-K03-refund.md': rulesBlock([['K03-R1', '单笔退款大于 5000 元需财务二审', 'active']]) });
    const v1 = r1.data.violations.filter(v => v.code === 'knowledge_removal_forbidden');
    expect(v1).toHaveLength(1);
    expect(v1[0].message).toContain('K03-R2');
    // 守恒判据：KXX-Rn 只在知识文档内进入集合
    const del = rulesBlock([['K03-R1', 'a', 'active']]);
    expect(evaluateDeltaConservation(del, K03_RULES(), { knowledge: true }).map(v => v.message).join('\n')).toContain('K03-R2');
    expect(evaluateDeltaConservation(del, K03_RULES()).map(v => v.message).join('\n')).not.toContain('K03-R2');
    // ② 场景 delta 改写「适用业务约束」表、去掉引用 K05 的行
    const scen = `${SCEN}/core-S40-settle.md`;
    const r2 = lintOf({
      [`${KDIR}/core-K05-settle-day.md`]: entry('K05', '结算日', { type: 'term' }),
      [K03]: K03_RULES(),
      [scen]: scenarioDoc('S40', ['K05', 'K03-R1']),
    }, {
      'deltas/prd/3-technical-plan/2-scenario-implementation/core-S40-settle.md':
        '## MODIFIED — 适用业务约束\n\n| 引用 | 作用位置 | 说明 | 例外 |\n|---|---|---|---|\n| K03-R1 | Step 1 | 约束 | 无 |\n',
    });
    const all = [...r2.data.violations.map(v => `${v.code} ${v.message}`), ...(r2.data.warnings ?? []).map(w => `${w.code} ${w.message}`)];
    expect(all.filter(x => x.startsWith('delta_implicit_id_removal') && x.includes('K05'))).toEqual([]);
    expect(r2.data.pass).toBe(true);
  });

  it('UT-S45-14: change-lint JSON 契约——L10 五码闭合、warning 走独立通道', () => {
    const outputs = [
      lintOf({ [K01_REFUND]: entry('K01', '退款') }, knowledgeDelta('core-K01-customer-id.md', entry('K01', '客户编号'))),
      lintOf({}, { ...knowledgeDelta('core-K01-refund.md', '# K01：退款规则\n'), ...scenarioDelta('core-S50-refund.md', ['K01', 'K09']) }),
      lintOf({ [K03]: K03_RULES() }, { 'deltas/knowledge/core-K03-refund.md': '## REMOVED — 说明\n\n整节删除。\n' }),
      lintOf({ [K03]: K03_RULES() }, { 'deltas/knowledge/core-K03-refund.md': rulesBlock([['K03-R1', '单笔退款大于 5000 元需财务二审', 'active'], ['K03-R2', '退款原路返回', 'active']]) }),
      lintOf({ [K03]: K03_RULES() }, scenarioDelta('core-S50-refund.md', ['K03-R2'])),
    ];
    const seen = new Set<string>();
    for (const o of outputs) {
      for (const v of o.data.violations) {
        expect((CHANGE_LINT_VIOLATION_CODES as readonly string[]).includes(v.code), v.code).toBe(true);
        if (!v.code.startsWith('knowledge_')) continue;
        seen.add(v.code);
        expect(Object.keys(v)).toEqual(['code', 'path', 'message', 'fix_hint']); // 不带 flow_reason / details
      }
      for (const w of o.data.warnings ?? []) {
        expect(Object.keys(w).sort()).toEqual(['code', 'fix_hint', 'message']);
        if (w.code === 'knowledge_reference_deprecated') seen.add(w.code);
      }
      expect(o.data.violations.some(v => v.code === 'knowledge_reference_deprecated')).toBe(false);
    }
    expect([...seen].sort()).toEqual([
      'knowledge_entry_invalid', 'knowledge_id_duplicate', 'knowledge_reference_deprecated', 'knowledge_reference_unknown',
      'knowledge_removal_forbidden', 'knowledge_retired_id_mutated',
    ]);
    for (const code of ['knowledge_entry_invalid', 'knowledge_reference_unknown', 'knowledge_id_duplicate', 'knowledge_removal_forbidden', 'knowledge_retired_id_mutated']) {
      expect((CHANGE_LINT_VIOLATION_CODES as readonly string[]).includes(code), code).toBe(true);
    }
    expect((CHANGE_LINT_VIOLATION_CODES as readonly string[]).includes('knowledge_reference_deprecated')).toBe(false);
    // warning 不改结论：只有 deprecated 告警的输出 pass=true、exit 0
    expect(outputs[4].status).toBe(0);
    expect(outputs[4].data.pass).toBe(true);
  });

  it('UT-S45-18: 撤回最后一个知识 delta 时仍拦截撤回已生效的退役', () => {
    const f = fixture({
      git: true,
      disk: { [K03]: K03_RULES(['K03-R2', '退款原路返回', 'active']) },
      deltas: { 'deltas/knowledge/core-K03-refund.md': rulesBlock([['K03-R1', '单笔退款大于 5000 元需财务二审', 'active'], ['K03-R2', '退款原路返回', 'deprecated']]) },
    });
    const first = cli(f.root, ['merge', 'p1']);
    expect(first.status, first.stderr).toBe(0);
    expect(read(f.root, K03)).toMatch(/\| K03-R2 \| 退款原路返回 \| deprecated \|/);
    // 撤回唯一的知识 MODIFY delta 并删除空目录；保留与知识无关的测试规格等 delta
    rmSync(join(f.dir, 'deltas', 'knowledge'), { recursive: true, force: true });
    writeDeltas(f, {});
    expect(existsSync(join(f.dir, 'deltas', 'test', 'core-S01-test-cases.md'))).toBe(true);
    const before = snapshotTree(f.root);
    const r = lintJson(f.root);
    expect(r.status).toBe(2);
    const v = r.data.violations.filter(x => x.code === 'knowledge_retired_id_mutated');
    expect(v).toHaveLength(1);
    expect(v[0].path).toBe(K03);
    expect(v[0].message).toContain('K03-R2');
    const human = cli(f.root, ['change-lint', '--slug', 'p1']);
    expect(human.stdout).toContain('L10');
    const amend = cli(f.root, ['merge', 'p1']);
    expect(amend.status).not.toBe(0);
    expectTreeUnchanged(f.root, before);
    expect(read(f.root, K03)).toMatch(/\| K03-R2 \| 退款原路返回 \| deprecated \|/);
  });
});

describe('S45 企业知识 — 退役保护场景（ST）', () => {
  it('ST-S45-02: 退役不复用，跨分支引用不错绑', () => {
    const k01Active = entry('K01', '退款');
    const f = fixture({ git: true, disk: { [K01_REFUND]: k01Active }, deltas: scenarioDelta('core-S50-refund.md', ['K01']) });
    // 分支 A：把最高号 K01 退役，新增客户编号规则——按「最大 KXX（含 deprecated）+ 1」定号
    const view = buildKnowledgeView([...readKnowledgeDir(f.root)].map(([p, c]) => parseKnowledgeEntry(p, c, { root: f.root })));
    const nextId = `K${String(Math.max(...[...view.byId.keys()].map(k => Number(k.slice(1)))) + 1).padStart(2, '0')}`;
    expect(nextId).toBe('K02');
    git(f.root, ['checkout', '-qb', 'proposal-a']);
    const k01Retired = entry('K01', '退款', { status: 'deprecated' });
    put(f.root, K01_REFUND, k01Retired);
    put(f.root, `${KDIR}/core-${nextId}-customer-id.md`, entry(nextId, '客户编号'));
    git(f.root, ['add', '-A']);
    git(f.root, ['commit', '-qm', 'A: retire K01, add K02']);
    git(f.root, ['checkout', '-q', 'main']);
    git(f.root, ['merge', '-q', '--no-ff', '-m', 'merge A', 'proposal-a']);
    // 分支 B（本提案）基于旧版本新增引用 K01 的退款场景，再同步主线
    git(f.root, ['checkout', '-qb', 'proposal-b', 'HEAD~1']);
    git(f.root, ['merge', '-q', '-m', 'sync main', 'main']);
    const r = lintJson(f.root);
    expect(r.status).toBe(0);
    expect(knowledgeViolations(r.data)).toEqual([]);
    expect(r.data.warnings?.some(w => w.code === 'knowledge_reference_deprecated' && w.message.includes('K01'))).toBe(true);
    const m = cli(f.root, ['merge', 'p1']);
    expect(m.status, m.stderr).toBe(0);
    expect(read(f.root, K01_REFUND)).toBe(k01Retired);
    expect(read(f.root, K01_REFUND)).toContain('K01-R1 | 单笔退款大于 5000 元需财务二审');
    expect(read(f.root, `${KDIR}/core-K02-customer-id.md`)).toContain('K02：客户编号');
  });

  it('ST-S45-03: 退役 ID 被 MODIFIED 保号改写时拒绝', () => {
    const k01 = entry('K01', '退款', { rules: [['K01-R1', '单笔退款大于 5000 元需财务二审'], ['K01-R2', '退款需财务二审', 'deprecated']] });
    // 分支 A 的提案：保留文件名、ID 与结构位置，把 K01-R2 改成客户编号校验并标 active
    const f = fixture({
      git: true,
      disk: { [K01_REFUND]: k01 },
      deltas: { 'deltas/knowledge/core-K01-refund.md': rulesBlock([['K01-R1', '单笔退款大于 5000 元需财务二审', 'active'], ['K01-R2', '客户编号校验', 'active']]) },
    });
    const a = lintJson(f.root);
    expect(a.status).toBe(2);
    expect(codes(a.data)).toContain('knowledge_retired_id_mutated');
    const before = snapshotTree(f.root);
    expect(cli(f.root, ['merge', 'p1']).status).not.toBe(0);
    expectTreeUnchanged(f.root, before);
    // 分支 B 的提案：新增引用 K01-R2 的退款场景
    rmSync(join(f.dir, 'deltas', 'knowledge'), { recursive: true, force: true });
    writeDeltas(f, scenarioDelta('core-S50-refund.md', ['K01-R2']));
    const b = lintJson(f.root);
    expect(b.status).toBe(0);
    expect(b.data.warnings?.some(w => w.code === 'knowledge_reference_deprecated' && w.message.includes('K01-R2'))).toBe(true);
    const m = cli(f.root, ['merge', 'p1']);
    expect(m.status, m.stderr).toBe(0);
    expect(read(f.root, K01_REFUND)).toBe(k01);
  });
});
