/**
 * S45 — 企业知识直接录入与强拦截（knowledge-direct-intake，切片 slice-01-direct-intake-strong-block）。
 * 用例 ID 与 logos/resources/test/core-S45-test-cases.md 严格对齐：本切片覆盖 UT-S45-21～29、32～35、39～42，
 * ST-S45-07、08、10。测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入
 * logos/resources/verify/test-results.jsonl。CLI 用例经 cli/dist/index.js 真实进程执行（需先 npm run build）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readTagStateFacts, resolveTagState } from '../src/lib/knowledge-view.js';
import { buildProject } from './s09-guard-vcs-fixtures.js';
import { chain, deployEngine, nextId, preToolUse } from './s09-guard-post-check-helpers.js';

const CLI_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const TIMEOUT = 120_000;

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
function tmp(prefix = 'openlogos-kdi-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  roots.push(d);
  return d;
}

function put(root: string, rel: string, content: string | Buffer): void {
  const full = join(root, ...rel.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
const read = (root: string, rel: string) => readFileSync(join(root, ...rel.split('/')), 'utf8');
const has = (root: string, rel: string) => existsSync(join(root, ...rel.split('/')));

function cli(cwd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0', ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
interface Issue { code: string; path: string | null; message: string; fix_hint: string }
interface ApplyData {
  result: string; rolled_back?: boolean; candidate_dir: string | null; tag_state_before: string; tag_state_after: string;
  written: string[]; errors: Issue[]; warnings: Issue[];
}
function kapply(root: string, args: string[], env: Record<string, string> = {}): { status: number | null; data: ApplyData } {
  const r = cli(root, ['knowledge', 'apply', ...args, '--format', 'json'], env);
  return { status: r.status, data: JSON.parse(r.stdout.trim()).data as ApplyData };
}
function kcheck(root: string, env: Record<string, string> = {}) {
  const r = cli(root, ['knowledge', 'check', '--format', 'json'], env);
  return { status: r.status, data: JSON.parse(r.stdout.trim()).data as { tag_state: string; entries: number; head_compare: string; errors: Issue[]; warnings: Issue[] } };
}
function kindex(root: string, env: Record<string, string> = {}) {
  const r = cli(root, ['knowledge', 'index', '--format', 'json'], env);
  return { status: r.status, data: JSON.parse(r.stdout.trim()).data as { result: string; errors: Issue[] } };
}
function lintJson(root: string, slug = 'p1') {
  const r = cli(root, ['change-lint', '--slug', slug, '--format', 'json']);
  const env = JSON.parse(r.stdout.trim());
  return { status: r.status, data: env.data as { pass: boolean; violations: Issue[]; checks?: Array<{ id: number }> } };
}
const codesOf = (list: Issue[]) => list.map(i => i.code);

const KDIR = 'logos/resources/knowledge';
const SRCDIR = 'logos/resources/reference/knowledge';
const SCEN = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
const TAGS = `${KDIR}/TAGS.md`;
const INDEX = `${KDIR}/INDEX.md`;
const MARKER = `${KDIR}/.tags-enabled`;

interface EntryOpts { tags?: string[]; status?: string; module?: string; source?: string | null; rules?: Array<[string, string, string?]>; h1?: string; noMeta?: boolean; type?: string }
function entry(id: string, name: string, o: EntryOpts = {}): string {
  const type = o.type ?? 'rule';
  const meta: string[] = [`type: ${type}`, 'scope: module', `module: ${o.module ?? 'core'}`, `tags: ${JSON.stringify(o.tags ?? ['退款'])}`, `status: ${o.status ?? 'active'}`];
  if (o.source !== null) meta.push(`source: [{path: ${SRCDIR}/${o.source ?? 'refund-v3.md'}, version: v3}]`);
  const lines = [`# ${o.h1 ?? `${id}：${name}`}`, ''];
  if (!o.noMeta) lines.push('## 元数据', '', '```yaml', ...meta, '```', '');
  const rules = o.rules ?? (type === 'rule' ? [[`${id}-R1`, '单笔退款大于 5000 元需财务二审']] : []);
  if (rules.length > 0) {
    lines.push('## 规则', '', '| ID | 规则 | 状态 | 例外 |', '|---|---|---|---|');
    for (const [rid, text, status] of rules) lines.push(`| ${rid} | ${text} | ${status ?? 'active'} | 无 |`);
    lines.push('');
  }
  lines.push('## 说明', '', `${name}的背景说明。`, '');
  return lines.join('\n');
}
function tagsDoc(rows: Array<[string, string?]>): string {
  return ['# 知识标签表', '', '| 标签 | 别名 | 说明 |', '|---|---|---|', ...rows.map(([l, a]) => `| ${l} | ${a ?? ''} | |`), ''].join('\n');
}
function scenarioDoc(id: string, refs: string[]): string {
  return [`# ${id}：退款`, '', '## 场景目标', '', '完成退款。', '', '## 时序图', '', 'Step 1：提交退款。', '',
    '## 适用业务约束', '', '| 引用 | 作用位置 | 说明 | 例外 |', '|---|---|---|---|', ...refs.map(r => `| ${r} | Step 1 | 约束 | 无 |`), '',
    '## 异常与边界', '', '无。', ''].join('\n');
}
/** 项目根之外的一次性候选目录。 */
function candidate(files: Record<string, string | Buffer>): string {
  const d = tmp('openlogos-kdi-cand-');
  for (const [rel, c] of Object.entries(files)) put(d, rel, c);
  return d;
}

function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function commitAll(root: string, msg = 'c') {
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', msg, '--allow-empty']);
}

interface ProjectOpts { config?: string; git?: boolean }
/** launched 项目，无活跃提案。 */
function project(o: ProjectOpts = {}): string {
  const root = tmp();
  put(root, 'logos/logos.config.json', o.config ?? '{"locale":"zh","project":{"type":"cli"}}\n');
  put(root, 'logos/logos-project.yaml', 'project:\n  name: KDI Fixture\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 46\nresource_index: []\n');
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  mkdirSync(join(root, ...SCEN.split('/')), { recursive: true });
  if (o.git) {
    git(root, ['init', '-q', '-b', 'main']);
    commitAll(root, 'base');
  }
  return root;
}
/** 经真实 apply 录入一批条目（首批即启用标签表）。 */
function seed(root: string, entries: Record<string, string>, tags?: string, sources: Record<string, string> = { 'refund-v3.md': '# 退款制度 v3\n' }) {
  const files: Record<string, string> = {};
  for (const [name, c] of Object.entries(entries)) files[name] = c;
  for (const [name, c] of Object.entries(sources)) if (!has(root, `${SRCDIR}/${name}`)) files[`sources/${name}`] = c;
  if (tags) files['TAGS.md'] = tags;
  const r = kapply(root, [candidate(files)]);
  expect(r.status, JSON.stringify(r.data.errors)).toBe(0);
  return r;
}

/** 项目全部文件（不含 .git 与 guard 运行态目录）的字节快照。 */
function snapshotTree(root: string): Map<string, string> {
  const snap = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === '.git' || name === '.openlogos-runtime') continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else snap.set(abs, readFileSync(abs, 'latin1'));
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

/* —— 带活跃提案的夹具（与 s45-enterprise-knowledge 同口径：ready-to-merge 的 p1）—— */
const CLARIFICATION = '## 决策澄清\n\n```yaml\nschema: openlogos/clarification@1\nmode: adaptive\nstatus: complete\nimpacts:\n  data: {status: none, reason: fixture}\n  compatibility: {status: none, reason: fixture}\n  security_privacy: {status: none, reason: fixture}\n  public_release: {status: none, reason: fixture}\n  external_commitment: {status: none, reason: fixture}\ndecisions: []\nunresolved: []\ndefaults: []\n```\n';
const wholeFile = (target: string, body: string) => `## ADDED — ${target}（新文件，整文件）\n${body}`;
const scenarioDelta = (name: string, refs: string[]) => ({
  [`deltas/prd/3-technical-plan/2-scenario-implementation/${name}`]: wholeFile(`${SCEN}/${name}`, scenarioDoc(name.replace(/^core-|\.md$/g, ''), refs)),
});
const knowledgeDelta = (file: string, body: string) => ({ [`deltas/knowledge/${file}`]: wholeFile(`${KDIR}/${file}`, body) });

function withProposal(root: string, deltas: Record<string, string> = {}, slug = 'p1'): void {
  const dir = join(root, 'logos', 'changes', slug);
  put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
  const base: Record<string, string> = {
    'logos/resources/prd/1-product-requirements/core-01-requirements.md': '# 需求\n\n## 一、判据\n\n旧正文。\n',
    'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md': '# 规格\n\n## 一、判据\n\n旧正文。\n',
    'logos/resources/test/core-S01-test-cases.md': '# 用例\n\n## 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |\n',
  };
  for (const [p, c] of Object.entries(base)) if (!has(root, p)) put(root, p, c);
  const all: Record<string, string> = {
    'deltas/prd/1-product-requirements/core-01-requirements.md': '## MODIFIED — 一、判据\n\n新正文。\n',
    'deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md': '## MODIFIED — 一、判据\n\n新正文。\n',
    'deltas/test/core-S01-test-cases.md': '## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |\n',
    ...deltas,
  };
  for (const [rel, c] of Object.entries(all)) put(root, `logos/changes/${slug}/${rel}`, c);
  const files: string[] = [];
  const walk = (d: string, prefix: string) => {
    for (const name of readdirSync(d).sort()) {
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs, `${prefix}${name}/`);
      else files.push(`${prefix}${name}`);
    }
  };
  walk(join(dir, 'deltas'), 'deltas/');
  const items = files.map(p => {
    const t = p.replace(/^deltas\//, '');
    const mapped = `logos/resources/${t}`;
    return `- [x] [${has(root, mapped) ? 'MODIFY' : 'CREATE'}] \`${p}\`：fixture`;
  });
  put(root, `logos/changes/${slug}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n${items.join('\n')}\n\n## [code] 代码实现\n`);
  put(root, `logos/changes/${slug}/proposal.md`,
    '# 变更提案：kdi fixture\n\n## 变更原因\n真实原因。\n\n## 变更类型\n需求级\n\n## 变更范围\n- 影响的功能规格：fixture\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 变更概述\n概述。\n\n'
    + CLARIFICATION);
  put(root, `logos/changes/${slug}/PLAN_APPROVED`, '{}');
}

/* ═══════════ 一、UT ═══════════ */

describe('S45 直接录入 — apply 与强拦截（UT）', () => {
  it('UT-S45-21: 无提案直接录入成功', () => {
    const root = project();
    const cand = candidate({
      'core-K01-refund.md': entry('K01', '退款审批规则'),
      'sources/refund-v3.md': '# 退款制度 v3\n',
    });
    const r = kapply(root, [cand]);
    expect(r.status).toBe(0);
    expect(r.data.result).toBe('applied');
    expect(r.data.written).toEqual([`${SRCDIR}/refund-v3.md`, `${KDIR}/core-K01-refund.md`, TAGS, MARKER, INDEX]);
    expect(read(root, `${KDIR}/core-K01-refund.md`)).toBe(readFileSync(join(cand, 'core-K01-refund.md'), 'utf8'));
    expect(read(root, `${SRCDIR}/refund-v3.md`)).toBe('# 退款制度 v3\n');
    expect(read(root, TAGS)).toContain('| 退款 |');
    expect(r.data.tag_state_after).toBe('enabled');
    expect(has(root, 'logos/.openlogos-guard')).toBe(false);
    expect(existsSync(join(root, 'logos', 'changes'))).toBe(false);
    expect(existsSync(cand)).toBe(true);
  }, TIMEOUT);

  it('UT-S45-22: 候选目录输入形态', () => {
    const root = project();
    seed(root, { 'core-K01-refund.md': entry('K01', '退款审批规则') });
    const good = entry('K02', '结算规则', { tags: ['退款'] });
    const linkTarget = candidate({ 'x.md': good });
    const cases: Array<() => string> = [
      () => candidate({ 'core-K02-settle.md': good, 'notes.txt': 'x' }),
      () => candidate({ 'core-K02-settle.md': good, 'INDEX.md': '# x\n' }),
      () => { const d = candidate({}); symlinkSync(join(linkTarget, 'x.md'), join(d, 'core-K02-settle.md')); return d; },
      () => candidate({}),
      () => { const d = join(root, KDIR, 'tmp'); put(d, 'core-K02-settle.md', good); return d; },
      () => candidate({ 'core-K02-settle.md': good, 'sources/refund-v3.md': '# 不同的内容\n' }),
    ];
    for (const [i, make] of cases.entries()) {
      const dir = make();
      const before = snapshotTree(root);
      const r = kapply(root, [dir]);
      expect(r.status, `case ${i + 1}`).toBe(1);
      expect(codesOf(r.data.errors), `case ${i + 1}`).toContain('knowledge_apply_input_invalid');
      expectTreeUnchanged(root, before);
      if (i === 4) rmSync(join(root, KDIR, 'tmp'), { recursive: true, force: true });
    }
    // ⑦ 同名同字节原文 + 合法新条目
    const srcBefore = read(root, `${SRCDIR}/refund-v3.md`);
    const r7 = kapply(root, [candidate({ 'core-K02-settle.md': good, 'sources/refund-v3.md': srcBefore })]);
    expect(r7.status).toBe(0);
    expect(r7.data.written).not.toContain(`${SRCDIR}/refund-v3.md`);
    expect(r7.data.written).toContain(`${KDIR}/core-K02-settle.md`);
    expect(read(root, `${SRCDIR}/refund-v3.md`)).toBe(srcBefore);
  }, TIMEOUT);

  it('UT-S45-23: 判据不通过整批拒绝、零写入', () => {
    const root = project();
    seed(root, { 'core-K03-refund.md': entry('K03', '退款规则', { rules: [['K03-R1', '五千元二审'], ['K03-R2', '原路返回']] }) });
    put(root, `${SCEN}/core-S12-refund.md`, scenarioDoc('S12', ['K03-R2']));
    const batches: Array<{ files: Record<string, string>; expectCodes: string[] }> = [
      { files: { 'core-K04-a.md': entry('K04', '合法新条目'), 'core-K05-b.md': entry('K05', '缺元数据', { noMeta: true }) }, expectCodes: ['knowledge_entry_invalid'] },
      { files: { 'core-K03-other.md': entry('K03', '另一条') }, expectCodes: ['knowledge_id_duplicate'] },
      { files: { 'core-K03-refund.md': entry('K03', '退款规则', { rules: [['K03-R1', '五千元二审']] }) }, expectCodes: ['knowledge_removal_forbidden', 'knowledge_reference_unknown'] },
      { files: { 'core-K03-refund.md': entry('K03', '退款规则', { tags: ['售后'], rules: [['K03-R1', '五千元二审'], ['K03-R2', '原路返回']] }) }, expectCodes: ['knowledge_tag_unknown', 'knowledge_reference_unknown'] },
    ];
    for (const [i, b] of batches.entries()) {
      const before = snapshotTree(root);
      const r = kapply(root, [candidate(b.files)]);
      expect(r.status, `batch ${i + 1}`).toBe(1);
      for (const c of b.expectCodes) expect(codesOf(r.data.errors), `batch ${i + 1}`).toContain(c);
      if (i === 0) expect(r.data.errors.find(e => e.code === 'knowledge_entry_invalid')!.path).toBe('candidate:core-K05-b.md');
      if (i === 1) expect(r.data.errors.find(e => e.code === 'knowledge_id_duplicate')!.message).toContain('core-K03-refund.md');
      if (i >= 2) expect(r.data.errors.find(e => e.code === 'knowledge_reference_unknown')!.path).toBe(`${SCEN}/core-S12-refund.md`);
      expectTreeUnchanged(root, before);
    }
    expect(has(root, `${KDIR}/core-K04-a.md`)).toBe(false);
    // code-r1 F5：磁盘既有重号同样阻断与之无关的合法录入（判据 6 在后态全集上检查）
    put(root, `${KDIR}/core-K07-a.md`, entry('K07', '甲'));
    put(root, `${KDIR}/core-K07-b.md`, entry('K07', '乙'));
    for (const files of [{ 'core-K12-new.md': entry('K12', '无关合法条目') }, { 'TAGS.md': tagsDoc([['退款'], ['结算']]) }]) {
      const before = snapshotTree(root);
      const r = kapply(root, [candidate(files)]);
      expect(r.status).toBe(1);
      const dup = r.data.errors.find(e => e.code === 'knowledge_id_duplicate');
      expect(dup?.message).toContain('core-K07-a.md');
      expect(dup?.message).toContain('core-K07-b.md');
      expectTreeUnchanged(root, before);
    }
  }, TIMEOUT);

  it('UT-S45-24: 两次 apply 之间无提交时的退役冻结', () => {
    const root = project({ git: true });
    const v1 = entry('K03', '退款规则', { rules: [['K03-R1', '五千元二审'], ['K03-R2', '原路返回']] });
    seed(root, { 'core-K03-refund.md': v1 });
    commitAll(root, 'K03 active');
    const retired = entry('K03', '退款规则', { rules: [['K03-R1', '五千元二审', 'deprecated'], ['K03-R2', '原路返回']] });
    expect(kapply(root, [candidate({ 'core-K03-refund.md': retired })]).status).toBe(0);
    const reactivate = entry('K03', '退款规则', { rules: [['K03-R1', '五千元二审'], ['K03-R2', '原路返回']] });
    const rewrite = entry('K03', '退款规则', { rules: [['K03-R1', '八千元二审', 'deprecated'], ['K03-R2', '原路返回']] });
    for (const c of [reactivate, rewrite]) {
      const r = kapply(root, [candidate({ 'core-K03-refund.md': c })]);
      expect(r.status).toBe(1);
      const v = r.data.errors.find(e => e.code === 'knowledge_retired_id_mutated');
      expect(v?.message).toContain('K03-R1');
      expect(read(root, `${KDIR}/core-K03-refund.md`)).toBe(retired);
    }
    const reviseActive = entry('K03', '退款规则', { rules: [['K03-R1', '五千元二审', 'deprecated'], ['K03-R2', '原路返回，八千元以上人工复核']] });
    expect(kapply(root, [candidate({ 'core-K03-refund.md': reviseActive })]).status).toBe(0);
  }, TIMEOUT);

  it('UT-S45-25: 标签判据、别名、格式与同义提示', () => {
    const root = project();
    seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') }, tagsDoc([['退款', 'refund、退货退款']]));
    // ① 别名规范化匹配
    expect(kapply(root, [candidate({ 'core-K02-a.md': entry('K02', '别名条目', { tags: ['Refund'] }) })]).status).toBe(0);
    // ② 表外标签
    const outside = entry('K03', '售后条目', { tags: ['售后'] });
    let before = snapshotTree(root);
    const r2 = kapply(root, [candidate({ 'core-K03-b.md': outside })]);
    expect(r2.status).toBe(1);
    expect(codesOf(r2.data.errors)).toContain('knowledge_tag_unknown');
    expectTreeUnchanged(root, before);
    // ③ 同批加入标签表
    const withAfterSale = tagsDoc([['退款', 'refund、退货退款'], ['售后']]);
    expect(kapply(root, [candidate({ 'core-K03-b.md': outside, 'TAGS.md': withAfterSale })]).status).toBe(0);
    // ④ 删去仍被使用的标签
    before = snapshotTree(root);
    const r4 = kapply(root, [candidate({ 'TAGS.md': tagsDoc([['售后']]) })]);
    expect(r4.status).toBe(1);
    expect(r4.data.errors.filter(e => e.code === 'knowledge_tag_unknown').map(e => e.path)).toContain(`${KDIR}/core-K01-refund.md`);
    expectTreeUnchanged(root, before);
    // ⑤ 格式错误
    for (const bad of [
      tagsDoc([['退款', 'refund、退货退款'], ['售后'], ['退款']]),
      tagsDoc([['退款', 'refund、退货退款'], ['售后', '退款']]),
      '# 标签\n\n| 名称 | 说明 |\n|---|---|\n| 退款 | x |\n',
    ]) {
      const r = kapply(root, [candidate({ 'TAGS.md': bad })]);
      expect(r.status).toBe(1);
      expect(codesOf(r.data.errors)).toContain('knowledge_tags_invalid');
    }
    // ⑥ 疑似同义只提示
    const r6 = kapply(root, [candidate({ 'TAGS.md': tagsDoc([['退款', 'refund、退货退款'], ['售后'], ['退 款']]) })]);
    expect(r6.status).toBe(0);
    expect(codesOf(r6.data.warnings)).toContain('knowledge_tag_synonym');
    // code-r1 F2：落盘标签表被人工改坏（缺合法表头）时，仅含条目的批次同样按 after_tags 格式判据拒绝
    put(root, TAGS, '# 标签\n\n| 名称 | 说明 |\n|---|---|\n| 退款 | x |\n');
    const broken = snapshotTree(root);
    const r7 = kapply(root, [candidate({ 'core-K09-z.md': entry('K09', '表外标签条目', { tags: ['不存在的标签'] }) })]);
    expect(r7.status).toBe(1);
    const inv = r7.data.errors.find(e => e.code === 'knowledge_tags_invalid');
    expect(inv?.path).toBe(TAGS);
    expect(inv?.message).toContain('落盘标签表');
    expectTreeUnchanged(root, broken);
  }, TIMEOUT);

  it('UT-S45-26: 标签表三态判定（纯函数）', () => {
    const mk = (gitRepo: boolean) => project({ git: gitRepo });
    const r1 = mk(true);
    put(r1, INDEX, '<!-- x -->\n标签表：已启用\n');
    expect(resolveTagState(readTagStateFacts(r1))).toBe('never');
    const r2 = mk(true); put(r2, TAGS, tagsDoc([['退款']])); put(r2, MARKER, '{}\n');
    expect(resolveTagState(readTagStateFacts(r2))).toBe('enabled');
    const r3 = mk(true); put(r3, TAGS, tagsDoc([['退款']]));
    expect(resolveTagState(readTagStateFacts(r3))).toBe('enabled');
    const r4 = mk(true); put(r4, MARKER, '{}\n');
    expect(resolveTagState(readTagStateFacts(r4))).toBe('missing');
    const r5 = mk(true); put(r5, TAGS, tagsDoc([['退款']])); commitAll(r5, 'tags'); unlinkSync(join(r5, ...TAGS.split('/')));
    expect(resolveTagState(readTagStateFacts(r5))).toBe('missing');
    const r6 = mk(false); put(r6, INDEX, '标签表：已启用\n');
    expect(resolveTagState(readTagStateFacts(r6))).toBe('never');
  }, TIMEOUT);

  it('UT-S45-27: 升级后首次启用不使存量条目失效', () => {
    const root = project();
    put(root, `${SRCDIR}/refund-v3.md`, '# 退款制度 v3\n');
    put(root, `${KDIR}/core-K01-refund.md`, entry('K01', '退款规则', { tags: ['退款'] }));
    put(root, `${KDIR}/core-K02-settle.md`, entry('K02', '结算规则', { tags: ['结算'] }));
    withProposal(root, scenarioDelta('core-S12-refund.md', ['K01-R1']));
    expect(lintJson(root).data.pass).toBe(true);
    const r = kapply(root, ['--init-tags']);
    expect(r.status).toBe(0);
    expect(r.data.tag_state_after).toBe('enabled');
    expect(read(root, TAGS)).toContain('| 退款 |');
    expect(read(root, TAGS)).toContain('| 结算 |');
    expect(has(root, MARKER)).toBe(true);
    expect(has(root, INDEX)).toBe(true);
    expect(lintJson(root).data.pass).toBe(true);
    expect(codesOf(kcheck(root).data.errors)).not.toContain('knowledge_tag_unknown');
  }, TIMEOUT);

  it('UT-S45-28: 已启用但词表丢失', () => {
    for (const variant of ['marker', 'head'] as const) {
      const root = project({ git: true });
      seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') });
      commitAll(root, 'enabled');
      unlinkSync(join(root, ...TAGS.split('/')));
      if (variant === 'head') unlinkSync(join(root, ...MARKER.split('/')));
      withProposal(root, scenarioDelta('core-S12-refund.md', ['K01-R1']));
      for (let pass = 0; pass < 2; pass++) {
        const indexBefore = read(root, INDEX);
        const ix = kindex(root);
        expect(ix.status, variant).toBe(1);
        expect(codesOf(ix.data.errors)).toContain('knowledge_tags_missing');
        expect(read(root, INDEX)).toBe(indexBefore);
        const before = snapshotTree(root);
        const ap = kapply(root, [candidate({ 'core-K02-a.md': entry('K02', '新条目') })]);
        expect(ap.status).toBe(1);
        expect(codesOf(ap.data.errors)).toContain('knowledge_tags_missing');
        expectTreeUnchanged(root, before);
        const ck = kcheck(root);
        expect(ck.status).toBe(1);
        expect(codesOf(ck.data.errors)).toContain('knowledge_tags_missing');
        const lint = lintJson(root);
        expect(lint.status).toBe(2);
        const v = lint.data.violations.find(x => x.code === 'knowledge_tags_missing');
        expect(v?.path).toContain('deltas/prd/3-technical-plan/2-scenario-implementation/core-S12-refund.md');
      }
      const restored = kapply(root, [candidate({ 'TAGS.md': tagsDoc([['退款']]) })]);
      expect(restored.status, JSON.stringify(restored.data.errors)).toBe(0);
      expect(restored.data.tag_state_after).toBe('enabled');
    }
    // ⑥ --init-tags 由现存条目生成
    const root = project({ git: true });
    seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') });
    commitAll(root, 'enabled');
    unlinkSync(join(root, ...TAGS.split('/')));
    const r = kapply(root, ['--init-tags']);
    expect(r.status).toBe(0);
    expect(read(root, TAGS)).toContain('| 退款 |');
    expect(r.data.warnings.some(w => w.message.includes('退款'))).toBe(true);
  }, TIMEOUT);

  it('UT-S45-29: 总索引同批生成、确定性与过期只提示', () => {
    const root = project();
    seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') });
    const r1 = kapply(root, [candidate({ 'core-K02-settle.md': entry('K02', '结算规则') })]);
    expect(r1.status).toBe(0);
    const idx = read(root, INDEX);
    expect(idx.indexOf('| K01 |')).toBeGreaterThan(0);
    expect(idx.indexOf('| K02 |')).toBeGreaterThan(idx.indexOf('| K01 |'));
    expect(idx).toContain('标签表：已启用');
    expect(kindex(root).data.result).toBe('unchanged');
    expect(read(root, INDEX)).toBe(idx);
    expect(idx).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    put(root, `${KDIR}/core-K02-settle.md`, entry('K02', '结算日规则'));
    const ck = kcheck(root);
    expect(ck.status).toBe(0);
    expect(ck.data.errors).toEqual([]);
    expect(codesOf(ck.data.warnings)).toContain('knowledge_index_stale');
    expect(kindex(root).data.result).toBe('written');
    expect(codesOf(kcheck(root).data.warnings)).not.toContain('knowledge_index_stale');
  }, TIMEOUT);

  it('UT-S45-32: 全库诊断', () => {
    const root = project({ git: true });
    seed(root, {
      'core-K03-refund.md': entry('K03', '退款规则', { rules: [['K03-R1', '一'], ['K03-R2', '二', 'deprecated'], ['K03-R3', '三']] }),
    });
    put(root, `${KDIR}/core-K04-notags.md`, entry('K04', '缺标签', { tags: [] }));
    put(root, `${KDIR}/core-K07-a.md`, entry('K07', '甲'));
    put(root, `${KDIR}/core-K07-b.md`, entry('K07', '乙'));
    put(root, `${KDIR}/core-K05-outside.md`, entry('K05', '表外标签', { tags: ['售后'] }));
    put(root, `${SCEN}/core-S20-a.md`, scenarioDoc('S20', ['K20']));
    put(root, `${SCEN}/core-S21-b.md`, scenarioDoc('S21', ['K03-R2']));
    commitAll(root, 'library');
    put(root, `${KDIR}/core-K03-refund.md`, entry('K03', '退款规则', { rules: [['K03-R1', '一'], ['K03-R2', '二', 'deprecated']] }));
    const before = snapshotTree(root);
    const ck = kcheck(root);
    expect(ck.status).toBe(1);
    const codes = codesOf(ck.data.errors);
    for (const c of ['knowledge_entry_invalid', 'knowledge_id_duplicate', 'knowledge_tag_unknown', 'knowledge_reference_unknown', 'knowledge_removal_forbidden']) expect(codes).toContain(c);
    expect(ck.data.errors.find(e => e.code === 'knowledge_reference_unknown')!.path).toBe(`${SCEN}/core-S20-a.md`);
    expect(ck.data.errors.find(e => e.code === 'knowledge_removal_forbidden')!.message).toContain('K03-R3');
    expect(codesOf(ck.data.warnings)).toEqual(expect.arrayContaining(['knowledge_reference_deprecated', 'knowledge_index_stale']));
    expect(ck.data.head_compare).toBe('ok');
    expectTreeUnchanged(root, before);
    // ② 非 git 副本
    const copy = project();
    for (const [abs, content] of snapshotTree(root)) {
      const rel = abs.slice(root.length + 1);
      if (rel.startsWith('.git')) continue;
      put(copy, rel, Buffer.from(content, 'latin1'));
    }
    const ck2 = kcheck(copy);
    expect(ck2.data.head_compare).toBe('unavailable');
    expect(codesOf(ck2.data.errors)).not.toContain('knowledge_removal_forbidden');
  }, TIMEOUT);

  it('UT-S45-33: change-lint L10 的标签增量与范围', () => {
    const mk = () => {
      const root = project();
      seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') });
      put(root, `${KDIR}/core-K08-manual.md`, entry('K08', '人工条目', { tags: ['售后'] }));
      return root;
    };
    const r1 = mk();
    withProposal(r1, knowledgeDelta('core-K09-new.md', entry('K09', '新条目', { tags: ['未登记'] })));
    const l1 = lintJson(r1);
    expect(l1.status).toBe(2);
    const v1 = l1.data.violations.find(v => v.code === 'knowledge_tag_unknown');
    expect(v1?.path).toContain('deltas/knowledge/core-K09-new.md');
    const r2 = mk();
    withProposal(r2, scenarioDelta('core-S12-refund.md', ['K08']));
    const l2 = lintJson(r2);
    const v2 = l2.data.violations.find(v => v.code === 'knowledge_reference_unknown');
    expect(v2?.message).toContain('标签不在标签表');
    expect(l2.status).toBe(2);
    const r3 = mk();
    withProposal(r3, { 'deltas/knowledge/TAGS.md': tagsDoc([['退款']]) });
    const l3 = lintJson(r3);
    const v3 = l3.data.violations.find(v => v.code === 'knowledge_entry_invalid');
    expect(v3?.message).toContain('knowledge apply');
    expect(l3.status).toBe(2);
    const r4 = mk();
    withProposal(r4);
    const l4 = lintJson(r4);
    expect(l4.data.violations.filter(v => v.code.startsWith('knowledge_'))).toEqual([]);
    expect((l4.data.checks ?? []).some(c => c.id === 10)).toBe(false);
  }, TIMEOUT);

  it('UT-S45-34: guard：知识目录受保护，独立 apply 调用不报告', () => {
    const root = tmp();
    buildProject(root, 'G-repo');
    deployEngine(root);
    put(root, `${SRCDIR}/refund-v3.md`, '# 退款制度 v3\n');
    commitAll(root, 'source');
    const w = preToolUse(root, 'Write', { file_path: `${KDIR}/core-K09-x.md`, content: 'x' }, nextId());
    expect(w.exitCode).toBe(2);
    expect(`${w.stdout}${w.stderr}`).toContain('openlogos knowledge apply');
    const b = preToolUse(root, 'Bash', { command: `echo x > ${KDIR}/core-K09-x.md` }, nextId());
    expect(b.exitCode).toBe(2);
    const cand = candidate({ 'core-K01-refund.md': entry('K01', '退款规则') });
    const cmd = `cd ${JSON.stringify(root)} && openlogos knowledge apply ${JSON.stringify(cand)}`;
    const c3 = chain(root, cmd, { exec: `cd ${JSON.stringify(root)} && node ${JSON.stringify(CLI)} knowledge apply ${JSON.stringify(cand)}` });
    expect(c3.pre.exitCode).toBe(0);
    expect(c3.exec?.status).toBe(0);
    expect(c3.post?.exitCode).toBe(0);
    expect(`${c3.post?.stdout ?? ''}${c3.post?.stderr ?? ''}`).not.toContain(KDIR);
    expect(has(root, `${KDIR}/core-K01-refund.md`)).toBe(true);
    const cand2 = candidate({ 'core-K02-settle.md': entry('K02', '结算规则') });
    const c4 = chain(root, `openlogos knowledge apply ${JSON.stringify(cand2)} && echo x > src/a.js`,
      { exec: `node ${JSON.stringify(CLI)} knowledge apply ${JSON.stringify(cand2)} && echo x > src/a.js` });
    // 复合调用不享受独立调用豁免：事前轻判已拦下对受保护 src/a.js 的写入，或放行后由事后检查报告
    if (c4.pre.exitCode === 0) expect(`${c4.post?.stdout ?? ''}${c4.post?.stderr ?? ''}`).toContain('src/a.js');
    else expect(c4.pre.exitCode).toBe(2);
    // 用事前轻判识别不出写入目标的复合调用再验一次：放行后由事后检查报告 src/b.js
    const cand3 = candidate({ 'core-K03-x.md': entry('K03', '丙') });
    const c5 = chain(root, `openlogos knowledge apply ${JSON.stringify(cand3)} && python3 tools/mod.py`,
      { exec: `node ${JSON.stringify(CLI)} knowledge apply ${JSON.stringify(cand3)} && python3 tools/mod.py` });
    expect(c5.pre.exitCode).toBe(0);
    expect(`${c5.post?.stdout ?? ''}${c5.post?.stderr ?? ''}`).toContain('src/b.js');
  }, TIMEOUT);

  it('UT-S45-35: 与活跃提案冲突与写入失败恢复', () => {
    const r1 = project();
    seed(r1, { 'core-K01-refund.md': entry('K01', '退款规则') });
    withProposal(r1, knowledgeDelta('core-K03-refund.md', entry('K03', '提案条目')));
    let before = snapshotTree(r1);
    const c = kapply(r1, [candidate({ 'core-K03-refund.md': entry('K03', '录入条目') })]);
    expect(c.status).toBe(1);
    expect(codesOf(c.data.errors)).toContain('knowledge_apply_conflict');
    expectTreeUnchanged(r1, before);
    const r2 = project();
    seed(r2, { 'core-K01-refund.md': entry('K01', '退款规则') });
    before = snapshotTree(r2);
    const f = kapply(r2, [candidate({ 'core-K02-a.md': entry('K02', '甲'), 'TAGS.md': tagsDoc([['退款'], ['结算']]), 'sources/new-v1.md': '# 新原文\n' })],
      { NODE_ENV: 'test', OPENLOGOS_TEST_KNOWLEDGE_APPLY_FAIL_AFTER: '2' });
    expect(f.status).toBe(2);
    expect(f.data.result).toBe('write_failed');
    expect(f.data.rolled_back).toBe(true);
    expect(codesOf(f.data.errors)).toContain('knowledge_apply_write_failed');
    expectTreeUnchanged(r2, before);
    expect(existsSync(join(r2, 'logos/.openlogos-runtime/knowledge-apply/BASELINE_CLOSURE_APPLY_JOURNAL.json'))).toBe(false);
  }, TIMEOUT);

  it('UT-S45-39: 候选与活跃提案同编号占用', () => {
    const root = project();
    seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') });
    withProposal(root, { ...knowledgeDelta('core-K12-b.md', entry('K12', '提案条目')), ...scenarioDelta('core-S12-refund.md', ['K12-R1']) });
    const before = snapshotTree(root);
    const r = kapply(root, [candidate({ 'core-K12-a.md': entry('K12', '录入条目') })]);
    expect(r.status).toBe(1);
    const v = r.data.errors.find(e => e.code === 'knowledge_apply_conflict');
    expect(v?.message).toContain('core-K12-a.md');
    expect(v?.message).toContain('core-K12-b.md');
    expectTreeUnchanged(root, before);
    expect(lintJson(root).data.pass).toBe(true);
    // code-r1 F3：活跃提案另一份 delta 不可读时，apply 不得按「无提案」放行
    const unreadable = join(root, 'logos/changes/p1/deltas/prd/1-product-requirements/core-01-requirements.md');
    chmodSync(unreadable, 0o000);
    try {
      const r0 = kapply(root, [candidate({ 'core-K12-a.md': entry('K12', '录入条目') })]);
      expect(r0.status).toBe(1);
      const v0 = r0.data.errors.find(e => e.code === 'knowledge_apply_conflict');
      expect(v0?.message).toContain('不可读');
      expect(v0?.path).toBe('logos/changes/p1/');
    } finally {
      chmodSync(unreadable, 0o644);
    }
    expectTreeUnchanged(root, before);
    // code-r2 F3：合并标记不可读时，不得把「阶段证据读取失败」当作「无待应用修正」
    {
      const r3 = project({ git: true });
      seed(r3, { 'core-K01-refund.md': entry('K01', '退款规则') });
      withProposal(r3);
      commitAll(r3, 'proposal');
      const mm = cli(r3, ['merge', 'p1']);
      expect(mm.status, mm.stderr).toBe(0);
      commitAll(r3, 'merged');
      withProposal(r3, knowledgeDelta('core-K12-b.md', entry('K12', '修正新增条目')));
      const pending = kapply(r3, [candidate({ 'core-K12-a.md': entry('K12', '录入条目') })]);
      expect(pending.status).toBe(1);
      expect(codesOf(pending.data.errors)).toContain('knowledge_apply_conflict');
      const before3 = snapshotTree(r3);
      const marker = join(r3, 'logos/changes/p1/SPEC_MERGED');
      chmodSync(marker, 0o000);
      try {
        const r = kapply(r3, [candidate({ 'core-K12-a.md': entry('K12', '录入条目') })]);
        expect(r.status).toBe(1);
        const v = r.data.errors.find(e => e.code === 'knowledge_apply_conflict');
        expect(v?.message).toContain('SPEC_MERGED');
        expect(v?.message).toContain('不可读');
      } finally {
        chmodSync(marker, 0o644);
      }
      expectTreeUnchanged(r3, before3);
      expect(has(r3, `${KDIR}/core-K12-a.md`)).toBe(false);
      // code-r3 F3：标记本身可读，仅阶段解析器读取标记时报 IO 错误（测试故障注入）——同样拒绝且零写入
      const r4 = kapply(r3, [candidate({ 'core-K12-a.md': entry('K12', '录入条目') })], { NODE_ENV: 'test', OPENLOGOS_TEST_SPEC_MERGED_READ_FAIL: '1' });
      expect(r4.status).toBe(1);
      const v4 = r4.data.errors.find(e => e.code === 'knowledge_apply_conflict');
      expect(v4?.message).toContain('SPEC_MERGED');
      expect(v4?.message).toContain('EIO');
      expectTreeUnchanged(r3, before3);
      expect(has(r3, `${KDIR}/core-K12-a.md`)).toBe(false);
    }
    // ② 已合并、无待应用修正：提案视图等于磁盘
    const m = cli(root, ['merge', 'p1']);
    expect(m.status, m.stderr).toBe(0);
    const r2 = kapply(root, [candidate({ 'core-K12-a.md': entry('K12', '录入条目') })]);
    expect(r2.status).toBe(1);
    expect(codesOf(r2.data.errors)).toContain('knowledge_id_duplicate');
    expect(has(root, `${KDIR}/core-K12-a.md`)).toBe(false);
  }, TIMEOUT);

  it('UT-S45-40: 从「已启用但词表丢失」恢复', () => {
    const mk = () => {
      const root = project();
      seed(root, { 'core-K01-refund.md': entry('K01', '退款规则'), 'core-K02-settle.md': entry('K02', '结算规则', { tags: ['结算'] }) });
      put(root, `${SCEN}/core-S12-settle.md`, scenarioDoc('S12', ['K02-R1']));
      unlinkSync(join(root, ...TAGS.split('/')));
      return root;
    };
    const root = mk();
    const before = snapshotTree(root);
    const r1 = kapply(root, [candidate({ 'TAGS.md': tagsDoc([['退款']]) })]);
    expect(r1.status).toBe(1);
    expect(r1.data.errors.find(e => e.code === 'knowledge_tag_unknown')?.path).toBe(`${KDIR}/core-K02-settle.md`);
    expect(r1.data.errors.find(e => e.code === 'knowledge_reference_unknown')?.path).toBe(`${SCEN}/core-S12-settle.md`);
    expectTreeUnchanged(root, before);
    expect(resolveTagState(readTagStateFacts(root))).toBe('missing');
    const r2 = kapply(root, ['--init-tags']);
    expect(r2.status).toBe(0);
    expect(r2.data.tag_state_after).toBe('enabled');
    expect(read(root, TAGS)).toContain('| 退款 |');
    expect(read(root, TAGS)).toContain('| 结算 |');
    expect(r2.data.warnings.length).toBeGreaterThan(0);
    const other = mk();
    const r3 = kapply(other, [candidate({ 'TAGS.md': tagsDoc([['退款'], ['结算']]) })]);
    expect(r3.status).toBe(0);
    expect(r3.data.tag_state_after).toBe('enabled');
  }, TIMEOUT);

  it('UT-S45-41: 排他锁：并发的 index / 恢复不干扰正在提交的录入', async () => {
    const startBlocked = (root: string, barrier: string, files?: Record<string, string>) => {
      const cand = candidate(files ?? { 'core-K05-x.md': entry('K05', '新条目'), 'TAGS.md': tagsDoc([['退款'], ['结算']]) });
      const child = spawn(process.execPath, [CLI, 'knowledge', 'apply', cand, '--format', 'json'], {
        cwd: root, env: { ...process.env, NODE_ENV: 'test', OPENLOGOS_TEST_KNOWLEDGE_APPLY_BARRIER: barrier, OPENLOGOS_TEST_KNOWLEDGE_APPLY_BARRIER_AFTER: '2' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const done = new Promise<number | null>(res => child.on('exit', code => res(code)));
      return { child, done };
    };
    const waitFor = async (p: string) => {
      const deadline = Date.now() + 60_000;
      while (!existsSync(p)) {
        if (Date.now() > deadline) throw new Error(`timeout waiting ${p}`);
        await new Promise(r => setTimeout(r, 50));
      }
    };
    const runAsync = (root: string, args: string[], env: Record<string, string>) => new Promise<{ status: number | null; stdout: string }>(res => {
      const c = spawn(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      c.stdout.on('data', d => { out += String(d); });
      c.on('exit', code => res({ status: code, stdout: out }));
    });
    const mk = () => { const root = project(); seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') }); return root; };

    // ① 等待期内放行：index 在锁释放后正常执行
    {
      const root = mk();
      const barrier = join(tmp(), 'b');
      const a = startBlocked(root, barrier);
      await waitFor(`${barrier}.reached`);
      const b = runAsync(root, ['knowledge', 'index', '--format', 'json'], { OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS: '30000' });
      await new Promise(r => setTimeout(r, 500));
      writeFileSync(`${barrier}.release`, '');
      expect(await a.done).toBe(0);
      const rb = await b;
      expect(rb.status).toBe(0);
      expect(has(root, `${KDIR}/core-K05-x.md`)).toBe(true);
      expect(read(root, TAGS)).toContain('| 结算 |');
      expect(read(root, INDEX)).toContain('| K05 |');
    }
    // ② 超时报忙，不触碰首个事务
    {
      const root = mk();
      const barrier = join(tmp(), 'b');
      const a = startBlocked(root, barrier);
      await waitFor(`${barrier}.reached`);
      const staged = readdirSync(join(root, 'logos/.openlogos-runtime/knowledge-apply')).sort();
      const k05 = read(root, `${KDIR}/core-K05-x.md`);
      const rb = await runAsync(root, ['knowledge', 'index', '--format', 'json'], { OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS: '500' });
      expect(rb.status).toBe(2);
      expect(JSON.parse(rb.stdout).data.errors[0].code).toBe('knowledge_apply_busy');
      expect(readdirSync(join(root, 'logos/.openlogos-runtime/knowledge-apply')).sort()).toEqual(staged);
      expect(read(root, `${KDIR}/core-K05-x.md`)).toBe(k05);
      writeFileSync(`${barrier}.release`, '');
      expect(await a.done).toBe(0);
      expect(read(root, INDEX)).toContain('| K05 |');
    }
    // ③ 提交中途：--recover 报忙；check 报正在录入；④ 杀死后恢复
    {
      const root = mk();
      const preA = snapshotTree(root);
      const barrier = join(tmp(), 'b');
      const a = startBlocked(root, barrier);
      await waitFor(`${barrier}.reached`);
      const rr = await runAsync(root, ['knowledge', 'apply', '--recover', '--format', 'json'], { OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS: '500' });
      expect(rr.status).toBe(2);
      expect(JSON.parse(rr.stdout).data.errors[0].code).toBe('knowledge_apply_busy');
      const ck = await runAsync(root, ['knowledge', 'check', '--format', 'json'], { OPENLOGOS_KNOWLEDGE_READ_LOCK_BUDGET_MS: '200' });
      expect(ck.status).toBe(1);
      const ckErr = JSON.parse(ck.stdout).data.errors.find((e: Issue) => e.code === 'knowledge_apply_incomplete');
      expect(ckErr.message).toContain('正在进行');
      a.child.kill('SIGKILL');
      await a.done;
      const rec = kapply(root, ['--recover']);
      expect(rec.status).toBe(0);
      expect(rec.data.result).toBe('recovered');
      expectTreeUnchanged(root, preA);
    }
    // ⑤ code-r1 F1：增量修正撤回最后一份知识 delta 时，恢复写回知识文件同样须持排他锁
    {
      const root = project({ git: true });
      seed(root, { 'core-K03-refund.md': entry('K03', '退款规则', { rules: [['K03-R1', '五千元二审']] }) });
      commitAll(root, 'K03');
      const baselineK03 = read(root, `${KDIR}/core-K03-refund.md`);
      withProposal(root, { 'deltas/knowledge/core-K03-refund.md': `## MODIFIED — 规则\n\n| ID | 规则 | 状态 | 例外 |\n|---|---|---|---|\n| K03-R1 | 八千元二审 | active | 无 |\n` });
      commitAll(root, 'proposal');
      const m1 = cli(root, ['merge', 'p1']);
      expect(m1.status, m1.stderr).toBe(0);
      expect(read(root, `${KDIR}/core-K03-refund.md`)).toContain('八千元二审');
      commitAll(root, 'merged');
      rmSync(join(root, 'logos/changes/p1/deltas/knowledge'), { recursive: true, force: true });
      withProposal(root, {});
      const barrier = join(tmp(), 'b');
      const a = startBlocked(root, barrier);
      await waitFor(`${barrier}.reached`);
      const busy = cli(root, ['merge', 'p1'], { OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS: '300' });
      expect(busy.status).toBe(1);
      expect(busy.stderr).toContain('另一个企业知识录入');
      expect(read(root, `${KDIR}/core-K03-refund.md`)).toContain('八千元二审');
      writeFileSync(`${barrier}.release`, '');
      expect(await a.done).toBe(0);
      const m2 = cli(root, ['merge', 'p1']);
      expect(m2.status, m2.stderr).toBe(0);
      expect(read(root, `${KDIR}/core-K03-refund.md`)).toBe(baselineK03);
      // code-r2 F1：摘要已相等（无待应用修正）但残留合并事务日志的目标含知识文件时，恢复写回前同样先取锁
      const journal = join(root, 'logos/changes/p1/BASELINE_CLOSURE_APPLY_JOURNAL.json');
      writeFileSync(journal, JSON.stringify({
        schema: 'openlogos/baseline-closure-apply@1', phase: 'committing', created_dirs: [],
        entries: [{ target_path: `${KDIR}/core-K03-refund.md`, mode: 'MODIFY', kind: 'prepared', old_sha256: '0'.repeat(64), new_sha256: '1'.repeat(64), staged_path: '.baseline-closure-apply-txn/staging/0.new', backup_path: '.baseline-closure-apply-txn/backup/0.old', applied: true }],
      }));
      const journalBytes = readFileSync(journal, 'utf8');
      const b2 = join(tmp(), 'b');
      const a2 = startBlocked(root, b2, { 'core-K06-y.md': entry('K06', '另一新条目'), 'TAGS.md': tagsDoc([['退款'], ['结算'], ['审计']]) });
      await waitFor(`${b2}.reached`);
      const busy2 = cli(root, ['merge', 'p1'], { OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS: '300' });
      expect(busy2.status).toBe(1);
      expect(busy2.stderr).toContain('另一个企业知识录入');
      expect(readFileSync(journal, 'utf8')).toBe(journalBytes);
      expect(read(root, `${KDIR}/core-K03-refund.md`)).toBe(baselineK03);
      writeFileSync(`${b2}.release`, '');
      await a2.done;
      unlinkSync(journal);
    }
  }, 240_000);

  it('UT-S45-42: 词表恢复计入只存在于活跃提案中的知识与引用', () => {
    const root = project();
    seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') }, tagsDoc([['退款'], ['合规']]));
    withProposal(root, { ...knowledgeDelta('core-K12-audit.md', entry('K12', '审计规则', { tags: ['合规'] })), ...scenarioDelta('core-S12-audit.md', ['K12-R1']) });
    unlinkSync(join(root, ...TAGS.split('/')));
    const before = snapshotTree(root);
    const r1 = kapply(root, [candidate({ 'TAGS.md': tagsDoc([['退款']]) })]);
    expect(r1.status).toBe(1);
    expect(r1.data.errors.find(e => e.code === 'knowledge_tag_unknown')?.path).toContain('deltas/knowledge/core-K12-audit.md');
    expect(r1.data.errors.find(e => e.code === 'knowledge_reference_unknown')?.path).toContain('deltas/prd/3-technical-plan/2-scenario-implementation/core-S12-audit.md');
    expectTreeUnchanged(root, before);
    expect(resolveTagState(readTagStateFacts(root))).toBe('missing');
    const r2 = kapply(root, ['--init-tags']);
    expect(r2.status).toBe(0);
    expect(read(root, TAGS)).toContain('| 合规 |');
    expect(r2.data.tag_state_after).toBe('enabled');
    const lint = lintJson(root);
    expect(lint.data.violations.filter(v => ['knowledge_reference_unknown', 'knowledge_tag_unknown'].includes(v.code))).toEqual([]);
    expect(lint.data.pass).toBe(true);
  }, TIMEOUT);
});

/* ═══════════ 二、ST ═══════════ */

describe('S45 直接录入 — 场景测试（ST）', () => {
  it('ST-S45-07: 强拦截零写入，修正后重试成功', () => {
    const root = project();
    seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') });
    const before = snapshotTree(root);
    const bad = kapply(root, [candidate({ 'core-K02-a.md': entry('K02', '甲', { source: null }), 'core-K03-b.md': entry('K03', '乙', { tags: ['售后'] }) })]);
    expect(bad.status).toBe(1);
    expect(codesOf(bad.data.errors)).toEqual(expect.arrayContaining(['knowledge_entry_invalid', 'knowledge_tag_unknown']));
    expectTreeUnchanged(root, before);
    const good = kapply(root, [candidate({
      'core-K02-a.md': entry('K02', '甲'), 'core-K03-b.md': entry('K03', '乙', { tags: ['售后'] }), 'TAGS.md': tagsDoc([['退款'], ['售后']]),
    })]);
    expect(good.status).toBe(0);
    expect(good.data.written).toEqual([`${KDIR}/core-K02-a.md`, `${KDIR}/core-K03-b.md`, TAGS, INDEX]);
  }, TIMEOUT);

  it('ST-S45-08: 升级、首次启用、人工编辑与词表丢失', () => {
    const root = project();
    put(root, `${SRCDIR}/refund-v3.md`, '# 退款制度 v3\n');
    put(root, `${KDIR}/core-K01-refund.md`, entry('K01', '退款规则'));
    put(root, `${KDIR}/core-K02-settle.md`, entry('K02', '结算规则', { tags: ['结算'] }));
    withProposal(root, scenarioDelta('core-S12-refund.md', ['K01-R1', 'K02']));
    expect(lintJson(root).data.pass).toBe(true);
    const init = kapply(root, ['--init-tags']);
    expect(init.status).toBe(0);
    expect(read(root, TAGS)).toContain('| 退款 |');
    expect(read(root, TAGS)).toContain('| 结算 |');
    put(root, `${KDIR}/core-K02-settle.md`, entry('K02', '结算规则', { tags: ['售后'] }));
    const l3 = lintJson(root);
    expect(l3.data.violations.find(v => v.code === 'knowledge_reference_unknown')?.message).toContain('标签不在标签表');
    const ck = kcheck(root);
    expect(ck.status).toBe(1);
    expect(codesOf(ck.data.errors)).toContain('knowledge_tag_unknown');
    unlinkSync(join(root, ...TAGS.split('/')));
    expect(kindex(root).status).toBe(1);
    expect(codesOf(lintJson(root).data.violations)).toContain('knowledge_tags_missing');
  }, TIMEOUT);

  it('ST-S45-10: 无 reference 豁免的项目走提案通道录入原文与知识', () => {
    const config = '{"locale":"zh","project":{"type":"cli"},"guard":{"exempt":[]}}\n';
    const root = project({ config });
    withProposal(root, {
      ...knowledgeDelta('core-K02-refund-cap.md', entry('K02', '退款上限', { source: 'cap-v1.md' })),
      ...scenarioDelta('core-S12-refund.md', ['K02-R1']),
    }, 'p3');
    const r = kapply(root, [candidate({ 'sources/cap-v1.md': '# 上限制度 v1\n' })]);
    expect(r.status, JSON.stringify(r.data.errors)).toBe(0);
    expect(r.data.written).toEqual([`${SRCDIR}/cap-v1.md`]);
    expect(r.data.tag_state_after).toBe('never');
    expect(has(root, TAGS)).toBe(false);
    expect(has(root, MARKER)).toBe(false);
    expect(lintJson(root, 'p3').data.pass).toBe(true);
    const m = cli(root, ['merge', 'p3']);
    expect(m.status, m.stderr).toBe(0);
    expect(read(root, 'logos/logos.config.json')).toBe(config);
    expect(has(root, `${KDIR}/core-K02-refund-cap.md`)).toBe(true);
    expect(has(root, `${SRCDIR}/cap-v1.md`)).toBe(true);
  }, TIMEOUT);
});
