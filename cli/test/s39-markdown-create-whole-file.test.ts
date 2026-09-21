/**
 * 切片 1：Markdown 新建文档的整文件协议与显式封装分流。
 * 覆盖 UT-S39-76～UT-S39-86、ST-S39-32；逐条 ID 由全局 OpenLogos reporter 写入 test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import {
  classifyCanonicalTargetCategory, classifyDeltaRoute, NON_MARKDOWN_CATEGORIES,
} from '../src/lib/canonical-target.js';
import { validateAndStripNonMarkdownDelta } from '../src/lib/non-markdown-delta.js';
import { firstLineOf } from '../src/lib/whole-file-marker.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import {
  makeTempRoot, mergeAdmissibleProposal, mergeAdmissibleTasks, registerCoreModule, scaffoldProject,
} from './helpers.js';
// **改动前基线**：由 git HEAD（本次实现落地前）的编译产物在一次性夹具上实测生成并落盘，
// 测试只读、不在运行时由待测新版实现重算（code-r1 F3）。夹具定义与基线同源，保证比较的是同一输入。
import GOLDEN from './golden/prechange-baseline.json' with { type: 'json' };
import FIX from './golden/regression-fixtures.json' with { type: 'json' };

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'md-whole-file-fixture';
const LIB = resolve(__dirname, '..', 'src', 'lib');

/** 本片统一的新建场景目标：Markdown 文档类别、后缀 `.md`、夹具起始不存在。 */
const SCENARIO_DELTA = 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S99-demo.md';
const SCENARIO_TARGET = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S99-demo.md';
const TEST_DELTA = 'deltas/test/core-S99-test-cases.md';
const TEST_TARGET = 'logos/resources/test/core-S99-test-cases.md';

const SCENARIO_BODY = '# S99：演示场景\n\n## 场景目标\n\n演示新建文档可以带 H1。\n';
const TEST_BODY = [
  '# S99 测试用例', '', '## 单元测试', '',
  '| ID | 测试点 | 前置条件 | 输入/操作 | 预期输出 |',
  '|---|---|---|---|---|',
  '| UT-S99-01 | 演示 | 无 | 无 | 通过 |', '',
].join('\n');

function envelope(target: string, body: string, suffix = '（新文件，整文件）', op = 'ADDED'): string {
  return `## ${op} — ${target}${suffix}\n${body}`;
}

interface Fixture { root: string; proposalDir: string }

/** 缺省补齐的测试规格 delta（旧章节写法）——merge 准入要求提案计划里有真实 UT/ST 来源。 */
const DEFAULT_TEST_DELTA = '## ADDED — S99 夹具\n\n| ID | 描述 |\n|---|---|\n| UT-S99-01 | 夹具 |\n';

function setup(deltas: Record<string, string> = {}): Fixture {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root, 'launched');
  const proposalDir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(proposalDir, 'proposal.md'), mergeAdmissibleProposal());
  if (!Object.keys(deltas).some(k => k.startsWith('deltas/test/'))) {
    deltas = { ...deltas, [TEST_DELTA]: DEFAULT_TEST_DELTA };
  }
  const entries = Object.keys(deltas);
  // `[code]` 标题必须在场（plan 阶段的空占位），否则 merge 准入判 tasks_code_header_missing。
  writeFileSync(join(proposalDir, 'tasks.md'),
    `${mergeAdmissibleTasks(entries.map(p => `- [ ] 产出 delta 到 \`${p}\`。`))}\n## [code] 代码实现\n`);
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  for (const [rel, content] of Object.entries(deltas)) {
    const abs = join(proposalDir, ...rel.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { root, proposalDir };
}

function lint(f: Fixture) {
  const out = runChangeLint(f.root, f.proposalDir, SLUG);
  if (!out.ok) throw new Error(out.message);
  return out;
}

function merge(f: Fixture) {
  // `vitest.config.ts` 对全体用例注入 `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY=1`（0.13.x 兼容模式，
  // 只产 MERGE_PROMPT.md 不落盘）。本片验的是**直接合并**的分流与落盘，必须显式关掉它。
  return spawnSync(process.execPath, [CLI, 'merge', SLUG], {
    cwd: f.root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
  });
}

/** 项目根字节快照——失败分支的「零写入」证据。 */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) { walk(abs); continue; }
      out.set(relative(root, abs).replace(/\\/g, '/'), createHash('sha256').update(readFileSync(abs)).digest('hex'));
    }
  };
  walk(root);
  return out;
}

/** 剥去 `//` 行注释与块注释后的源码，用于「判据不得复述」的单点断言。 */
function codeWithoutComments(file: string): string {
  return readFileSync(join(LIB, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
}

const route = (firstLine: string, targetPath: string, mode: 'CREATE' | 'MODIFY') => classifyDeltaRoute({
  firstLine, targetPath, semanticCategory: classifyCanonicalTargetCategory(targetPath), mode,
});

describe('S39 Markdown 新建整文件协议', () => {
  it('UT-S39-76: CREATE `.md` 整文件新建成功，落盘逐字节等于剥离后正文且 H1 逐字保留', () => {
    const delta = envelope(SCENARIO_TARGET, SCENARIO_BODY);
    const checked = validateAndStripNonMarkdownDelta(delta, 'CREATE', SCENARIO_TARGET);
    expect(checked.ok).toBe(true);
    expect(checked.payload).toBe(SCENARIO_BODY);

    const f = setup({ [SCENARIO_DELTA]: delta });
    expect(lint(f).violations).toEqual([]);
    const run = merge(f);
    expect(run.status, run.stderr).toBe(0);

    const landed = readFileSync(join(f.root, ...SCENARIO_TARGET.split('/')));
    // 逐字节：无重排、无重新序列化、无尾随空白归一。
    expect(landed.equals(Buffer.from(SCENARIO_BODY, 'utf8'))).toBe(true);
    // 本刀的核心能力——首行是 H1 且逐字保留（章节 op 恒发 H2，产不出这一行）。
    expect(landed.toString('utf8').split('\n')[0]).toBe('# S99：演示场景');
    expect(landed.toString('utf8').startsWith('# ')).toBe(true);
  });

  it('UT-S39-77: `invalid-envelope` 三形态在公开入口 / 真实 L4 / 真实 merge 三条路由上结论一致均为拒绝且零写入', () => {
    const forms: Array<{ name: string; delta: string; targetExists: boolean }> = [
      // ① 声明 target 与实际 canonical target 不一致
      { name: 'target 漂移', delta: envelope('logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S98-other.md', SCENARIO_BODY), targetExists: false },
      // ② CREATE 模式却写 `（整文件替换）` 后缀——**本用例的核心臂**
      { name: 'CREATE 写替换后缀', delta: envelope(SCENARIO_TARGET, SCENARIO_BODY, '（整文件替换）'), targetExists: false },
      // ③ 对已存在目标写 `（新文件，整文件）`（本次 mode 为 MODIFY）
      { name: 'MODIFY 写新建后缀', delta: envelope(SCENARIO_TARGET, SCENARIO_BODY), targetExists: true },
      // ④ **自洽的 MODIFY 封装**（code-r1 F2）：op、后缀与本次 mode 三者**完全自洽**，通用 marker
      //    校验（只比对 marker 与传入 mode）对它恒成立，必须靠「Markdown 整文件只在 CREATE 受理」
      //    这条受理边界才拒得掉。形态①②③都拦不住它——它们要么 target 漂移、要么 marker 与 mode
      //    不符，会在通用校验里先被拒；唯独本形态能检出「公开入口凭空多开放了整文件替换」。
      { name: '自洽 MODIFY 封装', delta: envelope(SCENARIO_TARGET, SCENARIO_BODY, '（整文件替换）', 'MODIFIED'), targetExists: true },
    ];
    for (const form of forms) {
      const mode = form.targetExists ? 'MODIFY' : 'CREATE';
      // (a) 公开校验入口
      expect(validateAndStripNonMarkdownDelta(form.delta, mode, SCENARIO_TARGET).ok, form.name).toBe(false);
      // 识别阶段必须把三者都认作「已声明封装」，而不是让它们落回 section。
      expect(route(firstLineOf(form.delta), SCENARIO_TARGET, mode).kind, form.name).toBe('invalid-envelope');

      const f = setup({ [SCENARIO_DELTA]: form.delta });
      if (form.targetExists) {
        const abs = join(f.root, ...SCENARIO_TARGET.split('/'));
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, '# 既有文档\n\n正文。\n');
      }
      const before = snapshot(f.root);
      // (b) 真实 change-lint：错误必须在准入阶段暴露
      const violations = lint(f).violations.filter(v => v.code === 'non_markdown_delta_invalid');
      expect(violations.length, form.name).toBeGreaterThan(0);
      expect(violations[0].path, form.name).toBe(`logos/changes/${SLUG}/${SCENARIO_DELTA}`);
      // fix_hint 必须同时给出两条合法路径，而不是把作者往章节锚上引。
      expect(violations[0].fix_hint, form.name).toContain('整文件');
      expect(violations[0].fix_hint, form.name).toContain('章节 op');
      // (c) 真实 merge：非零退出 + 零写入
      const run = merge(f);
      expect(run.status, form.name).not.toBe(0);
      expect(existsSync(join(f.proposalDir, 'SPEC_MERGED')), form.name).toBe(false);
      expect(snapshot(f.root), form.name).toEqual(before);
      // **不回退成章节锚**：现行 composer 对形态②会成功合成出 `## <路径>（整文件替换）` 这个畸形标题。
      if (!form.targetExists) expect(existsSync(join(f.root, ...SCENARIO_TARGET.split('/'))), form.name).toBe(false);
      else expect(readFileSync(join(f.root, ...SCENARIO_TARGET.split('/')), 'utf8'), form.name).toBe('# 既有文档\n\n正文。\n');
    }
    // **两处受理边界不得分裂**（code-r1 F2）：公开校验入口与共享路由对**同一输入**必须同结论。
    // 此前入口只判后缀与类别、不判 mode，自洽 MODIFY 封装在入口通过而在路由被判 invalid-envelope。
    const selfConsistentModify = envelope(SCENARIO_TARGET, SCENARIO_BODY, '（整文件替换）', 'MODIFIED');
    const entry = validateAndStripNonMarkdownDelta(selfConsistentModify, 'MODIFY', SCENARIO_TARGET);
    const routed = route(firstLineOf(selfConsistentModify), SCENARIO_TARGET, 'MODIFY');
    expect(entry.ok).toBe(false);
    expect(routed.kind).toBe('invalid-envelope');
    expect(entry.message).toBe(routed.reason);
    // API/DB/编排的 MODIFY 整文件替换行为不受影响（本次只收紧 Markdown）。
    const orchTarget = 'logos/resources/scenario/core-auth.json';
    expect(validateAndStripNonMarkdownDelta(
      envelope(orchTarget, '{"name":"登录","steps":[]}\n', '（整文件替换）', 'MODIFIED'), 'MODIFY', orchTarget).ok,
    ).toBe(true);
  });

  it('UT-S39-78: payload 形态三层（空 / 残留控制 marker / 模板骨架）逐一拒绝', () => {
    const cases: Array<[string, string]> = [
      ['空 payload', '   \n\n'],
      ['残留控制 marker', `# 标题\n\n## MODIFIED — ${SCENARIO_TARGET}（整文件替换）\n`],
      ['模板骨架', '# 标题\n\n[新增的完整内容]\n'],
    ];
    for (const [name, body] of cases) {
      const r = validateAndStripNonMarkdownDelta(envelope(SCENARIO_TARGET, body), 'CREATE', SCENARIO_TARGET);
      expect(r.ok, name).toBe(false);
    }
    // 判据与既有 non-Markdown payload 形态判据同源：同样的 payload 在 orchestration 目标上同样被拒。
    const orchestrationTarget = 'logos/resources/scenario/core-auth.json';
    expect(validateAndStripNonMarkdownDelta(
      envelope(orchestrationTarget, '   \n\n'), 'CREATE', orchestrationTarget).message,
    ).toBe(validateAndStripNonMarkdownDelta(envelope(SCENARIO_TARGET, '   \n\n'), 'CREATE', SCENARIO_TARGET).message);
  });

  it('UT-S39-79: Markdown 整文件不套用 OpenAPI / SQL 方言 / 受控根 Schema 校验', () => {
    // payload 同时含 `openapi:` 字样与 `CREATE TABL` 错拼，且不是合法 OpenAPI / SQL / 根 Schema。
    const hostile = '# S99：演示场景\n\n正文提到 `openapi: 3.1.0` 与 `CREATE TABL demo (id INT);`。\n';
    // **差分哨兵**：同一段 payload 换到各自的类型目标上，三个校验器都会拒绝；`.md` 目标却通过。
    // 若 Markdown 分支误调了其中任一校验器，本用例的 `.md` 臂必然复现对应的拒绝消息。
    const apiTarget = 'logos/resources/api/core-api.yaml';
    const sqlTarget = 'logos/resources/database/core-db.sql';
    const schemaTarget = 'spec/schema/demo.json';
    const apiReject = validateAndStripNonMarkdownDelta(envelope(apiTarget, hostile), 'CREATE', apiTarget);
    const schemaReject = validateAndStripNonMarkdownDelta(envelope(schemaTarget, hostile), 'CREATE', schemaTarget);
    expect(apiReject.ok).toBe(false);
    expect(schemaReject.ok).toBe(false);
    // SQL 分支在缺 root 时必定返回「缺少项目根」——它是 SQL 路径**被进入**的充分证据。
    const sqlReject = validateAndStripNonMarkdownDelta(envelope(sqlTarget, hostile), 'CREATE', sqlTarget);
    expect(sqlReject.ok).toBe(false);
    expect(sqlReject.message).toContain('缺少项目根');

    // `.md` 目标：**不传 root**（SQL 路径若被进入必然报「缺少项目根」）且通过，返回原始 payload。
    const md = validateAndStripNonMarkdownDelta(envelope(SCENARIO_TARGET, hostile), 'CREATE', SCENARIO_TARGET);
    expect(md.ok).toBe(true);
    expect(md.payload).toBe(hostile);
    expect(md.message).toBeUndefined();
    expect(md.tier).toBeUndefined();
    expect(md.degradation).toBeUndefined();
  });

  it('UT-S39-80: 回归锚——MODIFY 模式 `.md` 仍走章节合成，四个章节 op 输出逐字等于改动前基线', async () => {
    const { composeOpenLogosMarkdown } = await import('../src/lib/markdown-section-authority.js');
    for (const [op, delta] of Object.entries(FIX.sectionOps)) {
      expect(route(firstLineOf(delta), SCENARIO_TARGET, 'MODIFY').kind, op).toBe('section');
      // **完整字节**对照改动前基线——不是「包含某子串」。两侧同步改变输出时本断言必须变红。
      expect(composeOpenLogosMarkdown(FIX.sectionBefore, delta, 'MODIFY'), op)
        .toBe(GOLDEN.composeSections[op as keyof typeof GOLDEN.composeSections]);
    }
  });

  it('UT-S39-81: 回归锚——api / database / orchestration 与受控根 schema 行为逐字不变，类别集合恰为三者', () => {
    // 断言**集合本身**：集合被意外扩充（如把 test / scenario 文档类别塞进来）同样是回归。
    expect([...NON_MARKDOWN_CATEGORIES].sort()).toEqual(['api', 'database', 'orchestration']);

    const nm = FIX.nonMarkdown;
    const pick = (r: ReturnType<typeof validateAndStripNonMarkdownDelta>) =>
      ({ ok: r.ok, message: r.message ?? null, tier: r.tier ?? null, payload: r.payload ?? null });
    // **逐字对照改动前基线元组**（ok / message / tier / payload），而非只断言布尔。
    const actual = {
      apiOk: pick(validateAndStripNonMarkdownDelta(envelope(nm.apiTarget, nm.apiPayload), 'CREATE', nm.apiTarget)),
      apiDuplicateKey: pick(validateAndStripNonMarkdownDelta(
        envelope(nm.apiTarget, nm.apiPayload.replace('openapi: 3.1.0', 'openapi: 3.1.0\nopenapi: 3.0.0')), 'CREATE', nm.apiTarget)),
      orchOk: pick(validateAndStripNonMarkdownDelta(envelope(nm.orchTarget, nm.orchPayload), 'CREATE', nm.orchTarget)),
      orchDuplicateKey: pick(validateAndStripNonMarkdownDelta(envelope(nm.orchTarget, nm.orchDuplicateKey), 'CREATE', nm.orchTarget)),
      orchModifyReplace: pick(validateAndStripNonMarkdownDelta(
        envelope(nm.orchTarget, nm.orchPayload, '（整文件替换）', 'MODIFIED'), 'MODIFY', nm.orchTarget)),
      sqlSqliteOk: pick(validateAndStripNonMarkdownDelta(
        envelope(nm.sqlTarget, nm.sqlPayload), 'CREATE', nm.sqlTarget, { databaseDialect: 'sqlite' })),
      sqlSqliteBad: pick(validateAndStripNonMarkdownDelta(
        envelope(nm.sqlTarget, nm.sqlPayload.replace('CREATE TABLE', 'CREATE TABL')), 'CREATE', nm.sqlTarget, { databaseDialect: 'sqlite' })),
      mdRejectedByCategoryGate: pick(validateAndStripNonMarkdownDelta(
        envelope('logos/resources/api/core-api.md', '# 标题\n\n正文。\n'), 'CREATE', 'logos/resources/api/core-api.md')),
    };
    expect(actual).toEqual(GOLDEN.nonMarkdown);

    // 降级留痕通道仍在：非 SQLite 方言绝不冒充 sqlite 的 execution（层级随环境有无适配器浮动，
    // 故此处断言的是恒不变的那一半，不进基线）。
    const pg = validateAndStripNonMarkdownDelta(
      envelope(nm.sqlTarget, nm.sqlPayload), 'CREATE', nm.sqlTarget, { databaseDialect: 'postgresql' });
    expect(pg.ok).toBe(true);
    expect(pg.tier).not.toBe('execution');
    if (pg.tier === 'structure') expect(pg.degradation?.reason).toBeTruthy();

    // 三类目标一律按语义类别进入整文件通道，与首行是否声明封装无关。
    for (const target of [nm.apiTarget, nm.orchTarget, nm.sqlTarget]) {
      expect(route('随便一行不是 marker 的内容', target, 'CREATE'), target).toEqual({ kind: 'whole-file', channel: 'non-markdown' });
    }
  });

  it('UT-S39-82: 回归锚——CREATE 模式 `.md` 写不带后缀的章节 op（旧写法）仍然合法', async () => {
    const { composeOpenLogosMarkdown } = await import('../src/lib/markdown-section-authority.js');
    // 现网同形夹具：`## ADDED — S99 夹具` + 含 UT-S99-01 的用例表（首行不带整文件后缀）。
    const legacy = FIX.legacyCreateDelta;
    expect(route(firstLineOf(legacy), TEST_TARGET, 'CREATE').kind).toBe('section');

    const f = setup({ [TEST_DELTA]: legacy });
    expect(lint(f).violations).toEqual([]);
    const run = merge(f);
    expect(run.status, run.stderr).toBe(0);

    const landed = readFileSync(join(f.root, ...TEST_TARGET.split('/')), 'utf8');
    // **对照改动前基线**，而不是与同版本 composer 自比——两侧同步改变输出时后者仍会通过。
    expect(landed).toBe(GOLDEN.legacyCreateCompose);
    // 同版本自比只作为「落盘 == 合成」的一致性附证，不承担零回归举证。
    expect(landed).toBe(composeOpenLogosMarkdown('', legacy, 'CREATE'));
  });

  it('UT-S39-83: 残渣真实成因——首行 target 位写的是章节标题而非 canonical 路径 → 拒绝且不落盘', () => {
    const decisionDelta = 'deltas/decisions/core-D09-demo.md';
    const decisionTarget = 'logos/resources/decisions/core-D09-demo.md';
    // 历史残渣文档的真实成因形态：首行声明了封装，但 target 位填的是章节标题。
    const delta = envelope('D09：某决策', '# D09：某决策\n\n决策正文。\n');
    expect(route(firstLineOf(delta), decisionTarget, 'CREATE').kind).toBe('invalid-envelope');

    const f = setup({ [decisionDelta]: delta });
    const before = snapshot(f.root);
    const violations = lint(f).violations.filter(v => v.code === 'non_markdown_delta_invalid');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toContain('D09：某决策');
    expect(violations[0].fix_hint).toContain('整文件');

    const run = merge(f);
    // 失败分支的证据是**无文件、无成功标记、非零退出**——不得用「落盘标题不含后缀」这类
    // 需要文件存在才成立的断言代替。
    expect(run.status).not.toBe(0);
    expect(existsSync(join(f.root, ...decisionTarget.split('/')))).toBe(false);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(snapshot(f.root)).toEqual(before);
  });

  it('UT-S39-84: 类别闸——api / database / orchestration 下的 `.md` 一律不受理（marker 逐字合法的负例）', () => {
    const targets = [
      'logos/resources/api/core-api.md',
      'logos/resources/database/core-db.md',
      'logos/resources/scenario/core-auth.md',
    ];
    for (const target of targets) {
      // marker 逐字合法：op、破折号、后缀、声明 target 全部正确，正文为合法 Markdown。
      const delta = envelope(target, '# 标题\n\n正文。\n');
      const r = validateAndStripNonMarkdownDelta(delta, 'CREATE', target, { root: process.cwd() });
      expect(r.ok, target).toBe(false);
      // 拒绝原因是**类别不受理**而非 marker 形态问题。
      expect(r.message, target).toContain('整文件协议只支持');
      // 分流侧同样按类别把它们留在 non-markdown 通道，不因后缀 `.md` 改判为 Markdown 整文件。
      expect(route(firstLineOf(delta), target, 'CREATE'), target).toEqual({ kind: 'whole-file', channel: 'non-markdown' });
      expect(NON_MARKDOWN_CATEGORIES.has(classifyCanonicalTargetCategory(target)!), target).toBe(true);
    }
  });

  it('UT-S39-85: 三值分流判定恰一处实现，lint 与 merge 两侧对三值作相同处置', () => {
    // ① 返回值恰为三值，且识别只看首行协议形态（两个 op、两种后缀都算声明）。
    expect(route('正文第一行不是 marker', SCENARIO_TARGET, 'CREATE').kind).toBe('section');
    expect(route('## ADDED — 某章节标题', SCENARIO_TARGET, 'CREATE').kind).toBe('section');
    expect(route(`## ADDED — ${SCENARIO_TARGET}（新文件，整文件）`, SCENARIO_TARGET, 'CREATE'))
      .toMatchObject({ kind: 'whole-file', channel: 'markdown' });
    for (const bad of [
      `## ADDED — ${SCENARIO_TARGET}（整文件替换）`,
      `## MODIFIED — ${SCENARIO_TARGET}（整文件替换）`,
      `## MODIFIED — ${SCENARIO_TARGET}（新文件，整文件）`,
      '## ADDED — 别的路径.md（新文件，整文件）',
    ]) {
      // **关键断言：任一受理条件不满足的结论是拒绝，而不是降级为 `section`。**
      expect(route(bad, SCENARIO_TARGET, 'CREATE').kind, bad).toBe('invalid-envelope');
    }

    // ② 两侧对同一批输入结论一致（lint 有无违规 ⇔ merge 退出码）。
    const battery: Array<[string, string]> = [
      ['whole-file', envelope(SCENARIO_TARGET, SCENARIO_BODY)],
      ['section', '## ADDED — S99 章节\n\n正文。\n'],
      ['invalid-envelope', envelope(SCENARIO_TARGET, SCENARIO_BODY, '（整文件替换）')],
    ];
    for (const [kind, delta] of battery) {
      const f = setup({ [SCENARIO_DELTA]: delta });
      const hasViolation = lint(f).violations.length > 0;
      const mergeFailed = merge(f).status !== 0;
      expect(hasViolation, kind).toBe(mergeFailed);
      expect(hasViolation, kind).toBe(kind === 'invalid-envelope');
    }

    // ③ 单点：两个消费方都 import 同一判定函数，且**均不复述**协议后缀字面量（复述即违规）。
    for (const file of ['merge-direct.ts', 'change-lint.ts']) {
      const code = codeWithoutComments(file);
      expect(code, file).toContain('classifyDeltaRoute');
      expect(code.includes('（新文件，整文件）'), file).toBe(false);
      expect(code.includes('（整文件替换）'), file).toBe(false);
    }
  });

  it('UT-S39-86: 正例对照——payload 首行 H1 与控制行同名不构成拒绝理由', () => {
    // payload 唯一的标题逐字等于「控制行的 target 加后缀」。整文件语义下二者无关：
    // 控制行被剥离，H1 是文档自身标题，不存在「章节重复」这回事。
    const body = `# ${SCENARIO_TARGET}（新文件，整文件）\n\n正文。\n`;
    const delta = envelope(SCENARIO_TARGET, body);
    const checked = validateAndStripNonMarkdownDelta(delta, 'CREATE', SCENARIO_TARGET);
    expect(checked.ok).toBe(true);
    expect(checked.payload).toBe(body);

    const f = setup({ [SCENARIO_DELTA]: delta });
    expect(lint(f).violations).toEqual([]);
    const run = merge(f);
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(join(f.root, ...SCENARIO_TARGET.split('/')), 'utf8')).toBe(body);
  });

  it('ST-S39-32: 新建测试规格经整文件通道合并后账本闭合，且 merge 后重跑 change-lint 仍通过、零写入', () => {
    const f = setup({ [TEST_DELTA]: envelope(TEST_TARGET, TEST_BODY) });
    expect(lint(f).violations).toEqual([]);
    const run = merge(f);
    expect(run.status, run.stderr).toBe(0);

    // ② 落盘字节逐字等于剥离后正文，H1 保留。
    const landed = readFileSync(join(f.root, ...TEST_TARGET.split('/')));
    expect(landed.equals(Buffer.from(TEST_BODY, 'utf8'))).toBe(true);
    expect(landed.toString('utf8').split('\n')[0]).toBe('# S99 测试用例');

    // ③ 账本闭合：目标与新增用例 ID 必须进 test_change_set。若实现把该目标推入 `non-markdown`
    // 分支并 `continue`，tests.push 不可达，两者双双为空——本断言即该回退的锁。
    const marker = JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8'));
    const cs = marker.test_change_set;
    expect(cs.changed_test_ids).toContain('UT-S99-01');
    const entry = cs.targets.find((t: { target_path: string }) => t.target_path === TEST_TARGET);
    expect(entry).toBeTruthy();
    expect(entry.before_sha256 ?? null).toBeNull(); // CREATE：无前态
    expect(entry.after_sha256).toBe(createHash('sha256').update(landed).digest('hex'));

    // ④ 下游消费方读法一致。
    const reread = JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8')).test_change_set;
    expect(reread).toEqual(cs);

    // ⑤ 阶段边界：post-merge 重跑 change-lint 仍通过且零写入——原 CREATE 整文件 delta 仍在场，
    // 受理判定不得因「目标现已存在」重判 mode 而把已完成的合并倒挂成失败。
    const before = snapshot(f.root);
    expect(lint(f).violations).toEqual([]);
    expect(snapshot(f.root)).toEqual(before);

    // ⑥ **正文里出现章节 marker 形态的文本，post-merge 同样不得被读成指令**（code-r1 F1）。
    // 「正文即最终字节」意味着 payload 只是字节：一行 `## RENAMED — 术语` 加两段文字是**正文**，
    // 不是待执行的 RENAMED 块。此前 post-merge 把整文件降级成 `section`，`buildRenameMaps(
    // parseDeltaBlocks(...))` 就会把它判成「RENAMED 块正文有 2 行」，一次成功的合并在 post-merge
    // lint 上炸掉。冻结的必须是**重放**，不是**身份**；修复方向不是回头限制正文标题。
    const decisionTarget = 'logos/resources/decisions/core-D99-review.md';
    const decisionDelta = 'deltas/decisions/core-D99-review.md';
    const trapBody = '# 演示\n\n## RENAMED — 术语\n\n这是正文第一段。\n\n这是正文第二段。\n';
    const trap = setup({ [decisionDelta]: envelope(decisionTarget, trapBody) });
    expect(lint(trap).violations).toEqual([]);                 // 合并前
    const trapRun = merge(trap);
    expect(trapRun.status, trapRun.stderr).toBe(0);            // 合并
    expect(readFileSync(join(trap.root, ...decisionTarget.split('/')), 'utf8')).toBe(trapBody);
    const trapAfter = snapshot(trap.root);
    expect(lint(trap).violations).toEqual([]);                 // 合并后
    expect(snapshot(trap.root)).toEqual(trapAfter);            // post-merge 零写入
  });
});
