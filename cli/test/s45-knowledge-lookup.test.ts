/**
 * S45 — 企业知识设计时检索、状态提示与事务读取（knowledge-direct-intake，切片 slice-02-design-time-lookup-and-release）。
 * 用例 ID 与 logos/resources/test/core-S45-test-cases.md 严格对齐：本切片覆盖 UT-S45-30、31、36、37、38、43，ST-S45-06、09。
 * SMOKE-core-321～323 的安装态结果由 scripts/smoke-knowledge-direct-intake.js 写入 smoke 账本，其判据自测见
 * s45-knowledge-direct-intake-smoke.test.ts（不认领编号）。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 * CLI 用例经 cli/dist/index.js 真实进程执行（需先 npm run build）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { computeProposalKnowledgeState } from '../src/lib/change-lint.js';
import { scanCandidateFiles } from '../src/lib/sync-resource-index.js';

const CLI_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const REPO_ROOT = resolve(CLI_ROOT, '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const TIMEOUT = 120_000;

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
function tmp(prefix = 'openlogos-kdl-'): string {
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
    cwd, encoding: 'utf8', timeout: 120_000, env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0', ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
interface Issue { code: string; path: string | null; message: string; fix_hint: string }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function kjson(root: string, args: string[], env: Record<string, string> = {}): { status: number | null; data: any } {
  const r = cli(root, ['knowledge', ...args, '--format', 'json'], env);
  return { status: r.status, data: JSON.parse(r.stdout.trim()).data };
}
function lintJson(root: string, slug = 'p1') {
  const r = cli(root, ['change-lint', '--slug', slug, '--format', 'json']);
  return { status: r.status, data: JSON.parse(r.stdout.trim()).data as { pass: boolean; violations: Issue[] } };
}
const codesOf = (list: Issue[]) => list.map(i => i.code);

const KDIR = 'logos/resources/knowledge';
const SRCDIR = 'logos/resources/reference/knowledge';
const SCEN = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
const TAGS = `${KDIR}/TAGS.md`;

interface EntryOpts { tags?: string[]; module?: string; rules?: Array<[string, string, string?]> }
function metaBlock(o: EntryOpts = {}): string {
  return ['```yaml', 'type: rule', 'scope: module', `module: ${o.module ?? 'core'}`, `tags: ${JSON.stringify(o.tags ?? ['退款'])}`, 'status: active',
    `source: [{path: ${SRCDIR}/refund-v3.md, version: v3}]`, '```'].join('\n');
}
function entry(id: string, name: string, o: EntryOpts = {}): string {
  const rules = o.rules ?? [[`${id}-R1`, '单笔退款大于 5000 元需财务二审']];
  return [`# ${id}：${name}`, '', '## 元数据', '', metaBlock(o), '', '## 规则', '', '| ID | 规则 | 状态 | 例外 |', '|---|---|---|---|',
    ...rules.map(([rid, text, st]) => `| ${rid} | ${text} | ${st ?? 'active'} | 无 |`), '', '## 说明', '', `${name}的背景说明。`, ''].join('\n');
}
function tagsDoc(rows: Array<[string, string?]>): string {
  return ['# 知识标签表', '', '| 标签 | 别名 | 说明 |', '|---|---|---|', ...rows.map(([l, a]) => `| ${l} | ${a ?? ''} | |`), ''].join('\n');
}
function scenarioDoc(id: string, refs: Array<string | [string, string, string]>): string {
  return [`# ${id}：退款`, '', '## 场景目标', '', '完成退款。', '', '## 时序图', '', 'Step 1：提交退款。', '',
    '## 适用业务约束', '', '| 引用 | 作用位置 | 说明 | 例外 |', '|---|---|---|---|',
    ...refs.map(r => (typeof r === 'string' ? `| ${r} | Step 1 | 约束 | 无 |` : `| ${r[0]} | ${r[1]} | 约束 | ${r[2]} |`)), '',
    '## 异常与边界', '', '无。', ''].join('\n');
}
function candidate(files: Record<string, string>): string {
  const d = tmp('openlogos-kdl-cand-');
  for (const [rel, c] of Object.entries(files)) put(d, rel, c);
  return d;
}
function git(cwd: string, args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}
function project(o: { config?: string; git?: boolean } = {}): string {
  const root = tmp();
  put(root, 'logos/logos.config.json', o.config ?? '{"locale":"zh","project":{"type":"cli"}}\n');
  put(root, 'logos/logos-project.yaml', 'project:\n  name: KDL Fixture\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 46\nresource_index: []\n');
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  mkdirSync(join(root, ...SCEN.split('/')), { recursive: true });
  if (o.git) {
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'base']);
  }
  return root;
}
function seed(root: string, entries: Record<string, string>, tags?: string) {
  const files: Record<string, string> = { ...entries };
  if (!has(root, `${SRCDIR}/refund-v3.md`)) files['sources/refund-v3.md'] = '# 退款制度 v3\n';
  if (tags) files['TAGS.md'] = tags;
  const r = kjson(root, ['apply', candidate(files)]);
  expect(r.status, JSON.stringify(r.data.errors)).toBe(0);
}
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
  const items = files.map(p => `- [x] [${has(root, `logos/resources/${p.replace(/^deltas\//, '')}`) ? 'MODIFY' : 'CREATE'}] \`${p}\`：fixture`);
  put(root, `logos/changes/${slug}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n${items.join('\n')}\n\n## [code] 代码实现\n`);
  put(root, `logos/changes/${slug}/proposal.md`,
    '# 变更提案：kdl fixture\n\n## 变更原因\n真实原因。\n\n## 变更类型\n需求级\n\n## 变更范围\n- 影响的功能规格：fixture\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 变更概述\n概述。\n\n'
    + CLARIFICATION);
  put(root, `logos/changes/${slug}/PLAN_APPROVED`, '{}');
}
const metaOnlyModified = (file: string, o: EntryOpts) => ({ [`deltas/knowledge/${file}`]: `## MODIFIED — 元数据\n\n${metaBlock(o)}\n` });

/* —— 子进程工具（并发用例）—— */
function startCli(root: string, args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', d => { out += String(d); });
  const done = new Promise<{ status: number | null; stdout: string }>(res => child.on('exit', code => res({ status: code, stdout: out })));
  return { child, done };
}
async function waitFor(p: string) {
  const deadline = Date.now() + 60_000;
  while (!existsSync(p)) {
    if (Date.now() > deadline) throw new Error(`timeout waiting ${p}`);
    await new Promise(r => setTimeout(r, 50));
  }
}

/* ═══════════ 一、UT ═══════════ */

describe('S45 设计时检索（UT）', () => {
  it('UT-S45-30: 有效元数据列表含活跃提案知识 delta', () => {
    const root = project();
    seed(root, {
      'core-K01-refund.md': entry('K01', '退款规则', { module: 'billing' }),
      'core-K04-settle.md': entry('K04', '结算规则', { module: 'billing', tags: ['结算'] }),
    }, tagsDoc([['退款'], ['结算', 'settlement']]));
    withProposal(root, {
      ...knowledgeDelta('core-K12-refund.md', entry('K12', '退款上限', { module: 'core' })),
      ...metaOnlyModified('core-K04-settle.md', { module: 'core', tags: ['结算'] }),
    });
    expect(read(root, `${KDIR}/INDEX.md`)).not.toContain('K12');
    const l1 = kjson(root, ['list', '--module', 'core']);
    expect(l1.status).toBe(0);
    const ids = l1.data.entries.map((e: { id: string }) => e.id);
    expect(ids).toContain('K12');
    expect(ids).toContain('K04');
    expect(ids).not.toContain('K01');
    expect(l1.data.entries.find((e: { id: string }) => e.id === 'K12').origin).toBe('delta');
    expect(l1.data.entries.find((e: { id: string }) => e.id === 'K04').module).toBe('core');
    const l2 = kjson(root, ['list', '--tag', 'settlement']);
    expect(l2.data.entries.map((e: { id: string }) => e.id)).toContain('K04');
    unlinkSync(join(root, 'logos/.openlogos-guard'));
    const l3 = kjson(root, ['list', '--module', 'core']);
    expect(l3.data.entries.map((e: { id: string }) => e.id)).not.toContain('K12');
    expect(l3.data.entries.map((e: { id: string }) => e.id)).not.toContain('K04');
  }, TIMEOUT);

  it('UT-S45-31: 反查引用', () => {
    const root = project();
    seed(root, {
      'core-K03-refund.md': entry('K03', '退款规则', { rules: [['K03-R1', '一'], ['K03-R2', '二']] }),
      'core-K05-term.md': entry('K05', '结算日'),
    });
    put(root, `${SCEN}/core-S20-a.md`, scenarioDoc('S20', [['K03-R1', 'Step 4「提交退款」', '无'], 'K05']));
    put(root, `${SCEN}/core-S21-b.md`, scenarioDoc('S21', [['K03', 'Step 2', '本次例外：试点']]));
    withProposal(root, scenarioDelta('core-S22-c.md', ['K03-R2']));
    const r1 = kjson(root, ['refs', 'K03']);
    expect(r1.status).toBe(0);
    const pick = (refs: Array<{ scenario_path: string; level: string; origin: string }>, file: string) => refs.find(r => r.scenario_path.endsWith(file));
    expect(pick(r1.data.refs, 'core-S20-a.md')).toMatchObject({ ref: 'K03-R1', level: 'rule', location: 'Step 4「提交退款」', exception: '无', origin: 'resources' });
    expect(pick(r1.data.refs, 'core-S21-b.md')).toMatchObject({ ref: 'K03', level: 'entry', exception: '本次例外：试点' });
    expect(pick(r1.data.refs, 'core-S22-c.md')).toMatchObject({ ref: 'K03-R2', level: 'rule', origin: 'delta' });
    expect(typeof r1.data.refs[0].line).toBe('number');
    const r2 = kjson(root, ['refs', 'K03-R1']);
    expect(r2.data.refs.map((r: { ref: string }) => r.ref).sort()).toEqual(['K03', 'K03-R1']);
    expect(r2.data.refs.find((r: { ref: string }) => r.ref === 'K03').level).toBe('entry');
    expect(r2.data.target_status).toBe('active');
    const r3 = kjson(root, ['refs', 'K99']);
    expect(r3.status).toBe(0);
    expect(r3.data.refs).toEqual([]);
    expect(r3.data.target_status).toBe('unknown');
    expect(cli(root, ['knowledge', 'refs', 'K3x']).status).toBe(2);
  }, TIMEOUT);

  it('UT-S45-36: 状态提示、提案骨架、资源索引与 Skill 口径', () => {
    // ① 有知识问题的项目 / ② 无问题的项目
    const bad = project();
    seed(bad, { 'core-K01-refund.md': entry('K01', '退款规则') });
    put(bad, `${KDIR}/core-K02-manual.md`, entry('K02', '人工条目', { tags: ['售后'] }));
    const good = project();
    seed(good, { 'core-K01-refund.md': entry('K01', '退款规则') });
    for (const cmd of ['status', 'next']) {
      const tBad = cli(bad, [cmd]).stdout;
      expect(tBad, cmd).toContain('企业知识');
      expect(tBad, cmd).toContain('openlogos knowledge check');
      const tGood = cli(good, [cmd]).stdout;
      expect(tGood, cmd).not.toContain('企业知识：');
      const jBad = JSON.parse(cli(bad, [cmd, '--format', 'json']).stdout).data;
      const jGood = JSON.parse(cli(good, [cmd, '--format', 'json']).stdout).data;
      expect(Object.keys(jBad).sort(), cmd).toEqual(Object.keys(jGood).sort());
      expect(JSON.stringify(jBad), cmd).not.toContain('企业知识');
      expect(Object.keys(jBad), cmd).not.toContain('knowledge');
    }
    // ③ 无知识项目：JSON 不受知识提示影响；提案骨架；资源索引
    const plain = project();
    const jPlain = JSON.parse(cli(plain, ['status', '--format', 'json']).stdout).data;
    expect(Object.keys(jPlain)).not.toContain('knowledge');
    const ch = cli(plain, ['change', 'demo']);
    expect(ch.status, ch.stderr).toBe(0);
    expect(has(plain, 'logos/changes/demo/deltas/knowledge')).toBe(true);
    const scanned = scanCandidateFiles(good);
    expect(scanned).toContain(`${KDIR}/core-K01-refund.md`);
    expect(scanned).not.toContain(`${KDIR}/TAGS.md`);
    expect(scanned).not.toContain(`${KDIR}/INDEX.md`);
    expect(scanned).not.toContain(`${KDIR}/.tags-enabled`);
    // ④ Skill 口径
    for (const skill of ['prd-writer', 'product-designer', 'scenario-architect', 'change-writer', 'test-writer']) {
      const zh = readFileSync(join(REPO_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
      const en = readFileSync(join(REPO_ROOT, 'skills', skill, 'SKILL.en.md'), 'utf8');
      for (const t of ['knowledge apply', '项目根之外', 'knowledge list']) expect(zh, `${skill} zh ${t}`).toContain(t);
      for (const t of ['knowledge apply', 'outside the project root', 'knowledge list']) expect(en, `${skill} en ${t}`).toContain(t);
      if (skill === 'change-writer') {
        expect(zh).toContain('knowledge refs');
        expect(zh).toContain('只提供资料时不立案');
        expect(en).toContain('knowledge refs');
        expect(en).toContain('do not open a proposal');
      }
    }
  }, TIMEOUT);

  it('UT-S45-37: 设计时读取合成后全文（knowledge show）', () => {
    const root = project();
    seed(root, { 'core-K04-settle.md': entry('K04', '结算规则', { module: 'billing', rules: [['K04-R1', '日结'], ['K04-R2', '节假日顺延']] }) });
    put(root, `${KDIR}/core-K07-a.md`, entry('K07', '甲'));
    put(root, `${KDIR}/core-K07-b.md`, entry('K07', '乙'));
    withProposal(root, metaOnlyModified('core-K04-settle.md', { module: 'core' }));
    const l = kjson(root, ['list', '--module', 'core']);
    expect(l.data.entries.find((e: { id: string }) => e.id === 'K04').origin).toBe('delta');
    const s = kjson(root, ['show', 'K04']);
    expect(s.status).toBe(0);
    expect(s.data.content).toContain('K04-R1');
    expect(s.data.content).toContain('K04-R2');
    expect(s.data.content).toContain('module: core');
    expect(s.data.rules).toHaveLength(2);
    expect(s.data.rules[0]).toMatchObject({ id: 'K04-R1', rule: '日结', status: 'active', exception: '无' });
    expect(s.data.path).toBe(`${KDIR}/core-K04-settle.md`);
    expect(s.data.delta_path).toBe('logos/changes/p1/deltas/knowledge/core-K04-settle.md');
    const composed = computeProposalKnowledgeState(root, 'p1')!.candidate.get(`${KDIR}/core-K04-settle.md`);
    expect(s.data.content).toBe(composed);
    const s99 = kjson(root, ['show', 'K99']);
    expect(s99.status).toBe(1);
    expect(codesOf(s99.data.errors)).toContain('knowledge_reference_unknown');
    const s07 = kjson(root, ['show', 'K07']);
    expect(s07.status).toBe(1);
    expect(codesOf(s07.data.errors)).toContain('knowledge_id_duplicate');
  }, TIMEOUT);

  it('UT-S45-38: 录入事务：中断恢复与恢复失败', async () => {
    const root = project();
    seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') });
    withProposal(root, scenarioDelta('core-S12-refund.md', ['K05-R1']));
    const pre = snapshotTree(root);
    const barrier = join(tmp(), 'b');
    const cand = candidate({ 'core-K05-x.md': entry('K05', '新条目'), 'TAGS.md': tagsDoc([['退款'], ['结算']]) });
    const a = startCli(root, ['knowledge', 'apply', cand, '--format', 'json'],
      { NODE_ENV: 'test', OPENLOGOS_TEST_KNOWLEDGE_APPLY_BARRIER: barrier, OPENLOGOS_TEST_KNOWLEDGE_APPLY_BARRIER_AFTER: '2' });
    await waitFor(`${barrier}.reached`);
    a.child.kill('SIGKILL');
    await a.done;
    expect(existsSync(join(root, 'logos/.openlogos-runtime/knowledge-apply/BASELINE_CLOSURE_APPLY_JOURNAL.json'))).toBe(true);
    const ck = kjson(root, ['check']);
    expect(ck.status).toBe(1);
    expect(codesOf(ck.data.errors)).toContain('knowledge_apply_incomplete');
    // code-r1 F4：中断事务的诊断在同一读锁区间内完成——诊断期间恢复方取不到锁
    const cb = join(tmp(), 'c');
    const chk = startCli(root, ['knowledge', 'check', '--format', 'json'], { NODE_ENV: 'test', OPENLOGOS_TEST_KNOWLEDGE_READ_BARRIER: cb });
    await waitFor(`${cb}.reached`);
    const rr = cli(root, ['knowledge', 'apply', '--recover', '--format', 'json'], { OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS: '300' });
    expect(rr.status).toBe(2);
    expect(JSON.parse(rr.stdout).data.errors[0].code).toBe('knowledge_apply_busy');
    writeFileSync(`${cb}.release`, '');
    const chkOut = await chk.done;
    expect(chkOut.status).toBe(1);
    const chkData = JSON.parse(chkOut.stdout).data;
    expect(codesOf(chkData.errors)).toContain('knowledge_apply_incomplete');
    expect(chkData.entries).toBe(ck.data.entries);
    for (const args of [['list'], ['show', 'K05'], ['refs', 'K05']]) {
      const r = kjson(root, args);
      expect(r.status, args.join(' ')).toBe(1);
      expect(Object.keys(r.data)).toEqual(['errors']);
      expect(codesOf(r.data.errors)).toEqual(['knowledge_apply_incomplete']);
    }
    const lint = lintJson(root);
    expect(codesOf(lint.data.violations)).toContain('knowledge_apply_incomplete');
    expect(cli(root, ['status']).stdout).toContain('openlogos knowledge apply --recover');
    const rec = kjson(root, ['apply', '--recover']);
    expect(rec.status).toBe(0);
    expect(rec.data.result).toBe('recovered');
    expectTreeUnchanged(root, pre);
    expect(existsSync(join(root, 'logos/.openlogos-runtime/knowledge-apply/BASELINE_CLOSURE_APPLY_JOURNAL.json'))).toBe(false);
    // ③ 回滚失败
    const r3 = kjson(root, ['apply', candidate({ 'core-K05-x.md': entry('K05', '新条目'), 'TAGS.md': tagsDoc([['退款'], ['结算']]) })],
      { NODE_ENV: 'test', OPENLOGOS_TEST_KNOWLEDGE_APPLY_FAIL_AFTER: '2', OPENLOGOS_TEST_KNOWLEDGE_APPLY_CORRUPT_BACKUP: '1' });
    expect(r3.status).toBe(2);
    expect(r3.data.result).toBe('write_failed');
    expect(r3.data.rolled_back).toBe(false);
    expect(codesOf(r3.data.errors)).toEqual(expect.arrayContaining(['knowledge_apply_write_failed', 'knowledge_apply_recover_failed']));
    expect(existsSync(join(root, 'logos/.openlogos-runtime/knowledge-apply/BASELINE_CLOSURE_APPLY_JOURNAL.json'))).toBe(true);
  }, 240_000);

  it('UT-S45-43: 读取与提交互斥：不输出跨越提交的混合视图', async () => {
    const root = project();
    seed(root, {
      'core-K04-a.md': entry('K04', '甲', { module: 'billing' }),
      'core-K05-b.md': entry('K05', '乙', { module: 'billing' }),
    });
    const cand = candidate({ 'core-K04-a.md': entry('K04', '甲', { module: 'core' }), 'core-K05-b.md': entry('K05', '乙', { module: 'core' }) });
    const modules = (stdout: string) => {
      const entries = JSON.parse(stdout).data.entries as Array<{ id: string; module: string }>;
      return entries.filter(e => e.id === 'K04' || e.id === 'K05').map(e => e.module);
    };
    // ① list 读锁区间内停住，apply 等待
    const rb = join(tmp(), 'r');
    const list = startCli(root, ['knowledge', 'list', '--format', 'json'], { NODE_ENV: 'test', OPENLOGOS_TEST_KNOWLEDGE_READ_BARRIER: rb });
    await waitFor(`${rb}.reached`);
    const apply = startCli(root, ['knowledge', 'apply', cand, '--format', 'json'], { OPENLOGOS_KNOWLEDGE_LOCK_WAIT_MS: '30000' });
    await new Promise(r => setTimeout(r, 800));
    expect(read(root, `${KDIR}/core-K04-a.md`)).toContain('module: billing');
    writeFileSync(`${rb}.release`, '');
    const lr = await list.done;
    expect(lr.status).toBe(0);
    expect(modules(lr.stdout)).toEqual(['billing', 'billing']);
    expect((await apply.done).status).toBe(0);
    // ② 之后的读取为完整新版
    expect(modules(cli(root, ['knowledge', 'list', '--format', 'json']).stdout)).toEqual(['core', 'core']);
    // ③ apply 停在提交中途：list / show 报正在进行；④ change-lint 报未完成事务
    withProposal(root, scenarioDelta('core-S12-refund.md', ['K04-R1']));
    const wb = join(tmp(), 'w');
    const cand2 = candidate({ 'core-K04-a.md': entry('K04', '甲', { module: 'ops' }), 'core-K05-b.md': entry('K05', '乙', { module: 'ops' }) });
    const blocked = startCli(root, ['knowledge', 'apply', cand2, '--format', 'json'],
      { NODE_ENV: 'test', OPENLOGOS_TEST_KNOWLEDGE_APPLY_BARRIER: wb, OPENLOGOS_TEST_KNOWLEDGE_APPLY_BARRIER_AFTER: '1' });
    await waitFor(`${wb}.reached`);
    const budget = { OPENLOGOS_KNOWLEDGE_READ_LOCK_BUDGET_MS: '100' };
    for (const args of [['list'], ['show', 'K04']]) {
      const r = kjson(root, args, budget);
      expect(r.status, args.join(' ')).toBe(1);
      expect(r.data.errors[0].code).toBe('knowledge_apply_incomplete');
      expect(r.data.errors[0].message).toContain('正在进行');
    }
    const busyCheck = kjson(root, ['check'], budget);
    expect(busyCheck.status).toBe(1);
    expect(Object.keys(busyCheck.data)).toEqual(['errors']);
    expect(busyCheck.data.errors[0].code).toBe('knowledge_apply_incomplete');
    const lint = cli(root, ['change-lint', '--slug', 'p1', '--format', 'json'], budget);
    expect(lint.status).toBe(2);
    expect(codesOf(JSON.parse(lint.stdout).data.violations)).toContain('knowledge_apply_incomplete');
    writeFileSync(`${wb}.release`, '');
    expect((await blocked.done).status).toBe(0);
  }, 240_000);
});

/* ═══════════ 二、ST ═══════════ */

describe('S45 设计时检索（ST）', () => {
  it('ST-S45-06: 显式 guard.exempt: [] 的项目无提案直接录入并被引用', () => {
    const config = '{"locale":"zh","project":{"type":"cli"},"guard":{"exempt":[]}}\n';
    const root = project({ config, git: true });
    const cand = candidate({ 'core-K01-refund.md': entry('K01', '退款规则'), 'sources/refund-v3.md': '# 退款制度 v3\n' });
    const ap = kjson(root, ['apply', cand]);
    expect(ap.status, JSON.stringify(ap.data.errors)).toBe(0);
    expect(read(root, 'logos/logos.config.json')).toBe(config);
    withProposal(root, scenarioDelta('core-S12-refund.md', ['K01-R1']));
    expect(lintJson(root).data.pass).toBe(true);
    const m = cli(root, ['merge', 'p1']);
    expect(m.status, m.stderr).toBe(0);
    const refs = kjson(root, ['refs', 'K01-R1']);
    expect(refs.data.refs.some((r: { scenario_path: string }) => r.scenario_path === `${SCEN}/core-S12-refund.md`)).toBe(true);
  }, TIMEOUT);

  it('ST-S45-09: 需求与知识一起改：设计时 list 含 delta、合并后刷新索引', () => {
    const root = project();
    seed(root, { 'core-K01-refund.md': entry('K01', '退款规则') });
    withProposal(root, { ...knowledgeDelta('core-K02-refund-limit.md', entry('K02', '退款限额')), ...scenarioDelta('core-S12-refund.md', ['K02-R1']) }, 'p2');
    const l = kjson(root, ['list', '--module', 'core']);
    expect(l.data.entries.find((e: { id: string }) => e.id === 'K02').origin).toBe('delta');
    const before = snapshotTree(root);
    const c = kjson(root, ['apply', candidate({ 'core-K02-refund-limit.md': entry('K02', '录入版本') })]);
    expect(c.status).toBe(1);
    expect(codesOf(c.data.errors)).toContain('knowledge_apply_conflict');
    expectTreeUnchanged(root, before);
    expect(lintJson(root, 'p2').data.pass).toBe(true);
    const m = cli(root, ['merge', 'p2']);
    expect(m.status, m.stderr).toBe(0);
    const ck = kjson(root, ['check']);
    expect(ck.status).toBe(0);
    expect(codesOf(ck.data.warnings)).toContain('knowledge_index_stale');
    expect(kjson(root, ['index']).status).toBe(0);
    expect(codesOf(kjson(root, ['check']).data.warnings)).not.toContain('knowledge_index_stale');
    expect(has(root, TAGS)).toBe(true);
  }, TIMEOUT);
});
