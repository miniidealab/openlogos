/**
 * S09 — merge 原型落盘在安装态的可执行位置、失败分档与可观测摘要
 * （fix-merge-prototype-commit-and-phase-module-prefix，切片 1）。
 * 覆盖 UT-S09-355～UT-S09-359、ST-S09-146（与 logos/resources/test/core-S09-test-cases.md 严格对齐）。
 *
 * 本组测试锁三件事：
 *  - **安装态可执行**（§12.3.1 约束 A）：`commitVerifiedPrototypes()` 必须在正常 `ui_impact`
 *    合并分支上被求值；被 `legacyMergeTestMode()` 等测试专用开关门死等价于无入口。
 *  - **失败分档**（§12.3.2）：P0 写入前拒绝 / P1 已完整回滚 / P2 回滚不完整，档位只由唯一入口的
 *    结构化返回值派生；P2 禁止任何零残留措辞、不写 SPEC_MERGED、非零退出。
 *  - **写入阶段前置与材料生命周期**（§12.3.3）：合成失败时原型根本不提交；原型提交后若规格落盘
 *    失败，依保留的 journal 回滚原型。
 *
 * ⚠️ 覆盖有效性前提：`vitest.config.ts` 对全体用例注入 `OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY=1`
 * ——那正是「全绿是假象」的来源（覆盖的是安装态永不执行的死路径）。本文件每个用例都**显式删除**
 * 该变量，并断言删除成立；`legacyMergeTestMode()` 是 `NODE_ENV==='test' && 该变量==='1'` 的与，
 * 变量缺席即落在安装态分支。需要真实全套环境（含 `NODE_ENV!=='test'`）的断言由 ST-S09-146 的
 * 真实 CLI 子进程承担。
 *
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit,
  mergeAdmissibleProposal, registerCoreModule,
} from './helpers.js';
import { SPEC_MERGED_MARKER } from '../src/lib/proposal-markers.js';
import type { CommitResult } from '../src/lib/ui-provenance.js';

/** 唯一入口调用探针 + 返回值注入（`vi.mock` 需在模块图构建前挂载，故用 `vi.hoisted`）。 */
const probe = vi.hoisted(() => ({
  calls: 0,
  override: null as null | ((r: CommitResult) => CommitResult),
  reset() { probe.calls = 0; probe.override = null; },
}));

vi.mock('../src/lib/ui-provenance.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/lib/ui-provenance.js')>();
  return {
    ...orig,
    commitVerifiedPrototypes: (...args: Parameters<typeof orig.commitVerifiedPrototypes>) => {
      probe.calls++;
      const real = orig.commitVerifiedPrototypes(...args);
      return probe.override ? probe.override(real) : real;
    },
  };
});

const { merge, runDirectMerge, buildPrototypeHooks } = await import('../src/commands/merge.js');
type PrototypeCommitOutcome = import('../src/commands/merge.js').PrototypeCommitOutcome;
const { PROTOTYPE_DELTA_SUBPATH, PROTOTYPE_RESOURCE_SUBPATH, COMMIT_JOURNAL } =
  await import('../src/lib/ui-provenance.js');
const { gradePrototypeCommit, renderPrototypeSummary } = await import('../src/commands/merge.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CLI_ROOT = join(REPO_ROOT, 'cli');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const SPEC_REL = 'logos/resources/test/core-S99-test-cases.md';
const STAGING_DIR = '.ui-commit-staging';
const BACKUP_DIR = '.ui-commit-backup';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); probe.reset(); });

/**
 * 进入安装态：删除 legacy 开关（并可选把 NODE_ENV 挪出 'test'）。
 * 返回恢复函数；**断言删除成立**——夹具绝不为求绿而注入该变量。
 */
function enterInstallState(opts: { keepNodeEnvTest?: boolean } = {}): () => void {
  const prevFlag = process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY;
  const prevNodeEnv = process.env.NODE_ENV;
  delete process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY;
  if (!opts.keepNodeEnvTest) process.env.NODE_ENV = 'production';
  expect(process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY).toBeUndefined();
  if (!opts.keepNodeEnvTest) expect(process.env.NODE_ENV).not.toBe('test');
  return () => {
    if (prevFlag === undefined) delete process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY;
    else process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY = prevFlag;
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  };
}

const BASELINE_SPEC = [
  '# core-S99 测试用例',
  '',
  '## 一、既有用例',
  '',
  '| ID | 用例 |',
  '|---|---|',
  '| UT-S99-01 | 既有 |',
  '',
].join('\n');

function deltaBody(anchor = '一、既有用例'): string {
  return [
    `## MODIFIED — ${anchor}`,
    '',
    '| ID | 用例 |',
    '|---|---|',
    '| UT-S99-01 | 既有 |',
    '| UT-S99-02 | 新增 |',
    '',
  ].join('\n');
}

interface FixtureOpts {
  slug?: string;
  /** 原型 basename → 内容；空对象 = 本次无原型资产。 */
  prototypes?: Record<string, string>;
  /** PLAN_APPROVED.hashes 覆盖（用于构造 hash 失配的 P0 臂）。 */
  hashesOverride?: Record<string, string>;
  /** delta 的章节锚（给不存在的锚即构造合成失败）。 */
  deltaAnchor?: string;
  /** resources 侧预置的**旧**原型（basename → 内容），用于让事务产生 backup。 */
  preexisting?: Record<string, string>;
}

/** 一次性隔离项目：launched GUI 提案 + full provenance + 原型 delta + 一份可合并的 markdown 规格 delta。 */
function fixture(opts: FixtureOpts = {}) {
  const slug = opts.slug ?? 'proto-install';
  const prototypes = opts.prototypes ?? { 'core-01-home.html': '<h1>home</h1>\n' };
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    `project:\n  name: t\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n    product_type: web\n`);
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-09-15T00:00:00.000Z' }));

  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  const names = Object.keys(prototypes);
  const pagesYaml = names.length > 0
    ? names.map((n, i) => `  - id: p${i}\n    prototype: ${n}\n    description: p${i}`).join('\n')
    : '';
  // 无原型资产的形态：声明段 ui_impact:false（L7 逐页非空门无页可查），
  // 但持久化 PLAN_APPROVED 含「曾渲染 + hashes」⇒ hasUiProvenanceEvidence ⇒ uiImpact 仍为真。
  const uiBlock = names.length > 0
    ? `\n## UI/UX 变更声明\n\n\`\`\`yaml\nui_impact: true\ndesign_system_mode: generated\npages:\n${pagesYaml}\n\`\`\`\n`
    : `\n## UI/UX 变更声明\n\n\`\`\`yaml\nui_impact: false\ndesign_system_mode: generated\npages: []\n\`\`\`\n`;
  writeFileSync(join(dir, 'proposal.md'),
    mergeAdmissibleProposal(slug, 'core').replace(/\n## 决策澄清/, `${uiBlock}\n## 决策澄清`));
  // change-lint L2：需代码的提案必须保留空 `## [code]` 标题（tasks_code_header_missing）。
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '',
    '## [delta] 规格变更', '',
    '- [ ] 产出 delta 文件到 `deltas/test/core-S99-test-cases.md` — 新增用例', '',
    '## [code] 代码实现', '',
  ].join('\n'));
  writeFileSync(join(dir, 'design-system.json'), JSON.stringify({ tokens: { color: { primary: '#000' } } }));

  // 原型 delta
  const protoDir = join(dir, PROTOTYPE_DELTA_SUBPATH);
  mkdirSync(protoDir, { recursive: true });
  const hashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(prototypes)) {
    writeFileSync(join(protoDir, name), content);
    hashes[name] = sha(content);
  }
  // 无原型资产形态：声明段无页，但持久化 provenance 仍须 classify 为 full
  //（rendered:true + pages/hashes 非空），否则落入 partial 的 P0 臂而非 `none`。
  const provPages = names.length > 0 ? names : ['core-01-home.html'];
  const provHashes = opts.hashesOverride
    ?? (names.length > 0 ? hashes : { 'core-01-home.html': sha('<h1>home</h1>\n') });
  writeFileSync(join(dir, 'PLAN_APPROVED'), JSON.stringify({
    ui_prototype_rendered: true, pages: provPages, hashes: provHashes,
  }, null, 2) + '\n');

  // resources 侧预置旧原型（让提交事务产生 backup，补偿回滚才有材料可用）
  if (opts.preexisting) {
    const resDir = join(root, PROTOTYPE_RESOURCE_SUBPATH);
    mkdirSync(resDir, { recursive: true });
    for (const [name, content] of Object.entries(opts.preexisting)) {
      writeFileSync(join(resDir, name), content);
    }
  }

  // markdown 规格 delta + 其 canonical target 基线
  mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
  writeFileSync(join(dir, 'deltas', 'test', 'core-S99-test-cases.md'), deltaBody(opts.deltaAnchor));
  writeFileSync(join(root, SPEC_REL), BASELINE_SPEC);

  return { root, dir, slug, prototypes, protoDir };
}

/** 落盘目标目录内某原型的字节（不存在返回 null）。 */
function landed(root: string, basename: string): string | null {
  const p = join(root, PROTOTYPE_RESOURCE_SUBPATH, basename);
  return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

/** 原型事务恢复材料是否仍在场。 */
function materials(dir: string) {
  return {
    journal: existsSync(join(dir, COMMIT_JOURNAL)),
    staging: existsSync(join(dir, STAGING_DIR)),
    backup: existsSync(join(dir, BACKUP_DIR)),
  };
}

/** 在安装态下跑 merge，捕获 console 与 process.exit。 */
function runMerge(root: string, slug: string, opts: { keepNodeEnvTest?: boolean } = {}) {
  const restoreEnv = enterInstallState(opts);
  const restoreCwd = mockCwd(root);
  const con = captureConsole();
  const exitSpy = mockProcessExit();
  let threw: unknown = null;
  try { merge(slug); } catch (e) { threw = e; }
  const out = { logs: [...con.logs], errors: [...con.errors], threw };
  con.restore(); exitSpy.mockRestore(); restoreCwd(); restoreEnv();
  return { ...out, text: out.logs.join('\n'), errText: out.errors.join('\n') };
}

/** 零残留措辞集合——档 P2 的输出中一条都不许出现。 */
const ZERO_RESIDUE_PHRASES = ['零残留', '保持 merge 前态', '保持合并前字节', '未发生写入'];

describe('S09 merge 原型落盘安装态路径（切片 1）', () => {
  it('UT-S09-355: 安装态正常分支必定求值 commitVerifiedPrototypes（修复前必红）', () => {
    const f = fixture({ slug: 'p355' });
    const r = runMerge(f.root, f.slug);

    // 探针：唯一入口在安装态被**恰一次**求值。修复前该调用锁在 legacyMergeTestMode() 内，
    // 安装态下 calls 恒为 0、下方字节断言必红——本用例即 EX-9.25 的回归锁。
    expect(probe.calls).toBe(1);
    expect(r.threw).toBeNull();
    expect(landed(f.root, 'core-01-home.html')).toBe(f.prototypes['core-01-home.html']);
    // 落盘字节逐字节等于 delta 字节
    expect(sha(landed(f.root, 'core-01-home.html')!))
      .toBe(sha(readFileSync(join(f.protoDir, 'core-01-home.html'), 'utf-8')));
    // 规格 delta 照常合并，SPEC_MERGED 在场
    expect(readFileSync(join(f.root, SPEC_REL), 'utf-8')).toContain('UT-S99-02');
    expect(existsSync(join(f.dir, SPEC_MERGED_MARKER))).toBe(true);
    // 材料生命周期：整次 merge 成功后统一清理
    expect(materials(f.dir)).toEqual({ journal: false, staging: false, backup: false });
  });

  it('UT-S09-356: 档 P0 写入前拒绝 —— 零残留 + 告警 + 合并照常', () => {
    // staged 全量校验在写入任何 target 之前失配 ⇒ 唯一入口返回 ok:false 且 rolledBack 字段缺席 ⇒ P0
    const f = fixture({ slug: 'p356', hashesOverride: { 'core-01-home.html': sha('drifted') } });
    const r = runMerge(f.root, f.slug);

    expect(probe.calls).toBe(1);
    expect(r.threw).toBeNull();
    // ① resources 侧零改动、零残留
    expect(landed(f.root, 'core-01-home.html')).toBeNull();
    expect(materials(f.dir)).toEqual({ journal: false, staging: false, backup: false });
    // ② 显式告警 + reason + remediation
    expect(r.text).toContain('原型未落盘（hash_mismatch）');
    expect(r.text).toContain('openlogos check-ui-hash-match');
    // ③ 合并照常：规格 delta 已落盘、SPEC_MERGED 在场
    expect(readFileSync(join(f.root, SPEC_REL), 'utf-8')).toContain('UT-S99-02');
    expect(existsSync(join(f.dir, SPEC_MERGED_MARKER))).toBe(true);
  });

  it('UT-S09-357: 摘要可观测 —— committed 逐个可见 / 零资产明说 / 失败必有告警（禁止静默）', () => {
    // 形态①：两份原型且 provenance 完整
    const f1 = fixture({
      slug: 'p357a',
      prototypes: { 'core-01-home.html': '<h1>a</h1>\n', 'core-02-list.html': '<h1>b</h1>\n' },
    });
    const r1 = runMerge(f1.root, f1.slug);
    const rel = PROTOTYPE_RESOURCE_SUBPATH.replace(/\\/g, '/');
    expect(r1.text).toContain('原型落盘：2 个已提交');
    expect(r1.text).toContain(`    → ${rel}/core-01-home.html`);
    expect(r1.text).toContain(`    → ${rel}/core-02-list.html`);
    // 摘要列出的路径与磁盘实际落盘文件一一对应
    expect(landed(f1.root, 'core-01-home.html')).toBe('<h1>a</h1>\n');
    expect(landed(f1.root, 'core-02-list.html')).toBe('<h1>b</h1>\n');
    // 与 canonical target 同级可见（同一摘要块内）
    expect(r1.text).toContain(SPEC_REL);

    // 形态②：ui_impact 经持久化 provenance 判真，但本次无原型资产
    probe.reset();
    const f2 = fixture({ slug: 'p357b', prototypes: {} });
    const r2 = runMerge(f2.root, f2.slug);
    expect(probe.calls).toBe(1);
    expect(r2.text).toContain('原型落盘：本次无原型资产');
    expect(r2.text).not.toContain('原型未落盘');

    // 形态③：落盘失败必有告警
    probe.reset();
    const f3 = fixture({ slug: 'p357c', hashesOverride: { 'core-01-home.html': sha('drifted') } });
    const r3 = runMerge(f3.root, f3.slug);
    expect(r3.text).toContain('原型未落盘');

    // 三形态均不得出现静默态：落盘成功而摘要无痕、或未落盘而无告警
    for (const [text, expectMark] of [[r1.text, '原型落盘：'], [r2.text, '原型落盘：'], [r3.text, '原型未落盘']] as const) {
      expect(text).toContain(expectMark);
    }

    // 摘要渲染的各档文案（纯函数层）：skipped 不产行、committed 逐个成行、
    // P0 与 P1 措辞可区分、P2 不含任何零残留措辞。
    expect(renderPrototypeSummary({ tier: 'skipped', committed: [] })).toEqual([]);
    expect(renderPrototypeSummary({ tier: 'none', committed: [] })[0]).toContain('本次无原型资产');
    const rendered = renderPrototypeSummary({ tier: 'committed', committed: ['a.html', 'b.html'] });
    expect(rendered[0]).toContain('2 个已提交');
    expect(rendered).toHaveLength(3);
    const p0 = renderPrototypeSummary({ tier: 'P0', committed: [], reason: 'hash_mismatch' }).join('\n');
    expect(p0).toContain('零残留');
    expect(p0).not.toContain('已完整回滚');
    expect(renderPrototypeSummary({ tier: 'P1', committed: [], reason: 'commit_failed:x' }).join('\n'))
      .toContain('已完整回滚');
    const p2 = renderPrototypeSummary({ tier: 'P2', committed: [], reason: 'commit_failed_rollback_incomplete:x' }).join('\n');
    for (const phrase of ZERO_RESIDUE_PHRASES) expect(p2).not.toContain(phrase);
  });

  it('UT-S09-358: 分档准确 —— P1 已完整回滚 vs P2 回滚不完整，禁止零残留谎报', () => {
    // 纯函数层：档位只由结构化返回值派生
    expect(gradePrototypeCommit({ ok: true, advisory: false, cls: 'full', committed: ['a.html'] }).tier).toBe('committed');
    expect(gradePrototypeCommit({ ok: true, advisory: false, cls: 'full', committed: [] }).tier).toBe('none');
    expect(gradePrototypeCommit({ ok: false, advisory: false, cls: 'full', committed: [], reason: 'hash_mismatch' }).tier).toBe('P0');
    expect(gradePrototypeCommit({ ok: false, advisory: false, cls: 'full', committed: [], reason: 'commit_failed:x', rolledBack: true }).tier).toBe('P1');
    expect(gradePrototypeCommit({ ok: false, advisory: false, cls: 'full', committed: [], reason: 'commit_failed_rollback_incomplete:x', rolledBack: false }).tier).toBe('P2');

    // ① 档 P1：可声明零残留，但必须点名「已完整回滚」，规格照常合并
    const f1 = fixture({ slug: 'p358a' });
    probe.override = () => ({
      ok: false, advisory: false, cls: 'full', committed: [],
      reason: 'commit_failed:boom', rolledBack: true,
    });
    const r1 = runMerge(f1.root, f1.slug);
    expect(r1.threw).toBeNull();
    expect(r1.text).toContain('已完整回滚');
    expect(existsSync(join(f1.dir, SPEC_MERGED_MARKER))).toBe(true);
    expect(readFileSync(join(f1.root, SPEC_REL), 'utf-8')).toContain('UT-S99-02');

    // ② 档 P2：禁止零残留措辞、不写 SPEC_MERGED、非零退出、恢复材料保留
    //    **真实故障**（code-r1 F3 测试缺口）：不覆盖返回值，而是让唯一入口内部的提交事务
    //    真的失败——第二个原型的 resources 目标被预置成非空目录 ⇒ 备份/rename 抛错进 catch；
    //    第一个原型的 backup 文件在回滚前被置为不可读 ⇒ abortTransaction 的还原也失败
    //    ⇒ 唯一入口真实返回 rolledBack:false。
    probe.reset();
    const f2 = fixture({
      slug: 'p358b',
      prototypes: { 'core-01-home.html': '<h1>new-1</h1>\n', 'core-02-list.html': '<h1>new-2</h1>\n' },
      preexisting: { 'core-01-home.html': '<h1>old-1</h1>\n' },
    });
    // 让第二个目标成为**非空目录** ⇒ 提交循环在处理它时抛错（真实 EISDIR / ENOTEMPTY）
    const blockDir = join(f2.root, PROTOTYPE_RESOURCE_SUBPATH, 'core-02-list.html');
    mkdirSync(blockDir, { recursive: true });
    writeFileSync(join(blockDir, 'keep.txt'), 'x');
    // 让第一个目标的**回滚**真实失败：delta 源置为只读 ⇒ staged 副本与 rename 后的 target 同为
    // 0444 ⇒ abortTransaction 的 `copyFileSync(backup → target)` 真实抛 EACCES ⇒ rolledBack:false。
    chmodSync(join(f2.protoDir, 'core-01-home.html'), 0o444);
    const r2 = runMerge(f2.root, f2.slug);
    expect(String(r2.threw)).toContain('process.exit(1)');
    expect(existsSync(join(f2.dir, SPEC_MERGED_MARKER))).toBe(false);
    // 规格 delta 未进入落盘阶段
    expect(readFileSync(join(f2.root, SPEC_REL), 'utf-8')).not.toContain('UT-S99-02');
    const p2Text = `${r2.text}\n${r2.errText}`;
    for (const phrase of ZERO_RESIDUE_PHRASES) {
      // 「保持合并前字节」只允许出现在**规格侧**那一行（本档规格确实未动），不得用于原型侧。
      if (phrase === '保持合并前字节') continue;
      expect(p2Text).not.toContain(phrase);
    }
    expect(p2Text).toContain('原型事务状态不可确认');
    expect(p2Text).toContain('恢复材料已保留');
    expect(p2Text).toContain('git diff logos/resources/prd/2-product-design/2-page-design/');
    // 档位确实来自**真实事务**：reason 带 rollback_incomplete，且第一个目标确已被替换为新字节
    // （证明「已写过 target 且回滚没回成」这一真实 P2 形态，而非伪造返回值）
    expect(r2.threw).toBeTruthy();
    expect(p2Text).toContain('rollback_incomplete');
    expect(landed(f2.root, 'core-01-home.html')).toBe('<h1>new-1</h1>\n');
    // 恢复材料全部保留（禁止在不可确认态销毁补偿能力）
    expect(materials(f2.dir)).toEqual({ journal: true, staging: true, backup: true });

    // ③ 唯一入口**抛出**而非返回 CommitResult（code-r1 F3）：提案目录置为不可写 ⇒
    //    staging 目录创建真实抛 EACCES。无法证实原型是否被替换 ⇒ fail-safe 取档 P2，
    //    绝不按「未写入」声明旧态（修复前该异常会带着无阶段戳进通用报告、被误判为档 A）。
    probe.reset();
    const f3 = fixture({ slug: 'p358c' });
    chmodSync(f3.dir, 0o555);
    let r3;
    try { r3 = runMerge(f3.root, f3.slug); } finally { chmodSync(f3.dir, 0o755); }
    expect(String(r3.threw)).toContain('process.exit(1)');
    const t3 = `${r3.text}\n${r3.errText}`;
    expect(t3).toContain('原型事务状态不可确认');
    expect(t3).not.toContain('logos/resources/ 保持合并前字节，未写 SPEC_MERGED。');  // 修复前的档 A 谎报
    expect(existsSync(join(f3.dir, SPEC_MERGED_MARKER))).toBe(false);

    // 反证臂：档位若改为从输出文本反推即失去判据——此处断言两档的 reason 文本差异
    // 不参与判定（同一 reason 前缀、不同 rolledBack 得到不同档）。
    const sameReason = 'commit_failed:same';
    expect(gradePrototypeCommit({ ok: false, advisory: false, cls: 'full', committed: [], reason: sameReason, rolledBack: true }).tier).toBe('P1');
    expect(gradePrototypeCommit({ ok: false, advisory: false, cls: 'full', committed: [], reason: sameReason, rolledBack: false }).tier).toBe('P2');
  });

  it('UT-S09-359: 顺序与材料生命周期 —— 合成失败不得已提交原型；规格提交失败须能回滚原型', () => {
    // ① 合成失败（MODIFIED 章节锚在主文档中不存在）⇒ 阶段一失败 ⇒ afterPrepare 从未执行。
    //    此形态在 `merge()` 里会先被同源准入（change-lint delta_section_anchor_unresolvable）拦下，
    //    故直接把**真实钩子**挂到 runDirectMerge 上绕过前移预检，锁 mergeDirect 自身的顺序契约
    //    （不复刻第二份钩子实现；准入拒绝形态另由 ST-S09-146 步骤⑤覆盖）。
    const f1 = fixture({ slug: 'p359a', deltaAnchor: '不存在的章节锚' });
    const outcome: PrototypeCommitOutcome = { tier: 'skipped', committed: [] };
    const hooks = buildPrototypeHooks(f1.dir, f1.root, f1.slug, outcome);
    const restore1 = enterInstallState();
    const lines1: string[] = [];
    let exit1: number | null = null;
    try {
      runDirectMerge(f1.root, f1.dir, f1.slug, {
        hooks, stderr: l => lines1.push(l), exit: (c: number) => { exit1 = c; throw new Error('exit'); },
      });
    } catch { /* exit 信号 */ }
    restore1();
    expect(exit1).toBe(1);
    expect(probe.calls).toBe(0);                                   // 原型根本未进入提交（顺序约束）
    expect(outcome.tier).toBe('skipped');
    expect(landed(f1.root, 'core-01-home.html')).toBeNull();
    expect(materials(f1.dir)).toEqual({ journal: false, staging: false, backup: false });
    expect(existsSync(join(f1.dir, SPEC_MERGED_MARKER))).toBe(false);
    // 档 A 声明与磁盘事实一致
    expect(lines1.join('\n')).toContain('logos/resources/ 保持合并前字节，未写 SPEC_MERGED。');

    // ② 原型提交成功 + 规格提交失败 ⇒ 依保留的 journal 回滚原型
    probe.reset();
    const f2 = fixture({ slug: 'p359b' });
    const prevFail = process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
    process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = SPEC_REL;
    // 故障注入要求 NODE_ENV==='test'；legacy 开关仍被删除 ⇒ 仍走安装态分支
    const r2 = runMerge(f2.root, f2.slug, { keepNodeEnvTest: true });
    if (prevFail === undefined) delete process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
    else process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = prevFail;

    expect(probe.calls).toBe(1);
    expect(String(r2.threw)).toContain('process.exit(1)');
    expect(existsSync(join(f2.dir, SPEC_MERGED_MARKER))).toBe(false);
    expect(readFileSync(join(f2.root, SPEC_REL), 'utf-8')).not.toContain('UT-S99-02');
    // 原型已回滚到 merge 前态（merge 前该文件不存在 ⇒ 回滚后仍不存在），材料已清理
    expect(landed(f2.root, 'core-01-home.html')).toBeNull();
    expect(materials(f2.dir)).toEqual({ journal: false, staging: false, backup: false });
    expect(r2.errText).toContain('原型已依 journal 回滚至 merge 前字节');

    // ③ 规格**已提交**、仅清理失败（code-r1 F1）：规格侧状态不可确认 ⇒ **不得单独回滚原型**，
    //    否则造出「规格新 / 原型旧」的永久分叉且补偿材料被销毁、重跑也修不回来。
    probe.reset();
    const f3 = fixture({ slug: 'p359c', preexisting: { 'core-01-home.html': '<h1>old</h1>\n' } });
    const prevCleanup = process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL;
    process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL = '1';
    const r3 = runMerge(f3.root, f3.slug, { keepNodeEnvTest: true });
    if (prevCleanup === undefined) delete process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL;
    else process.env.OPENLOGOS_TEST_APPLY_CLEANUP_FAIL = prevCleanup;

    expect(String(r3.threw)).toContain('process.exit(1)');
    // 规格确已提交（主文档新字节 + SPEC_MERGED 在场）
    expect(readFileSync(join(f3.root, SPEC_REL), 'utf-8')).toContain('UT-S99-02');
    expect(existsSync(join(f3.dir, SPEC_MERGED_MARKER))).toBe(true);
    // 原型**未被退回旧版**，两侧同为新态；恢复材料全部保留
    expect(landed(f3.root, 'core-01-home.html')).toBe(f3.prototypes['core-01-home.html']);
    expect(materials(f3.dir)).toEqual({ journal: true, staging: true, backup: true });
    expect(r3.errText).toContain('规格侧状态不可确认（可能已提交）：不单独回滚原型');
    expect(r3.errText).not.toContain('原型已依 journal 回滚至 merge 前字节');

    // ④ 规格**已确认整批回滚** + 原型补偿回滚**真实失败**（code-r1 F2）：整体不得取档 B。
    //    delta 源置只读 ⇒ rename 后 target 为 0444 ⇒ 补偿的 backup→target 复制真实抛 EACCES。
    probe.reset();
    const f4 = fixture({ slug: 'p359d', preexisting: { 'core-01-home.html': '<h1>old</h1>\n' } });
    chmodSync(join(f4.protoDir, 'core-01-home.html'), 0o444);
    const prevFail4 = process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
    process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = SPEC_REL;
    const r4 = runMerge(f4.root, f4.slug, { keepNodeEnvTest: true });
    if (prevFail4 === undefined) delete process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
    else process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = prevFail4;

    expect(String(r4.threw)).toContain('process.exit(1)');
    const t4 = `${r4.text}\n${r4.errText}`;
    // 规格侧确已回滚、原型侧确未回滚——两侧结论必须分别如实陈述
    expect(readFileSync(join(f4.root, SPEC_REL), 'utf-8')).not.toContain('UT-S99-02');
    expect(landed(f4.root, 'core-01-home.html')).toBe(f4.prototypes['core-01-home.html']);
    expect(t4).toContain('规格 delta 已整批回滚至合并前字节');
    expect(t4).toContain('原型事务回滚不完整');
    expect(t4).toContain('整体不可宣称 logos/resources/ 已回到合并前态');
    // 修复前此处会盖上档 B 并宣称整个 resources 已整批回滚——与原型侧磁盘相反
    expect(t4).not.toContain('logos/resources/ 保持合并前字节，未写 SPEC_MERGED（落盘中途失败，已整批回滚）。');
    expect(materials(f4.dir)).toEqual({ journal: true, staging: true, backup: true });

    // ⑤ 规格已回滚 + 原型补偿**直接抛错**（code-r2 F2 残留）：抛出必须同样形成「原型不可确认」
    //    的结构化结果，不得在整体阶段戳生成前逃出。真实故障注入：在补偿开始前把 journal 的
    //    临时写入路径 `UI_COMMIT_JOURNAL.json.tmp` 造成**目录** ⇒ abortTransaction 的第一步
    //    「写 abort intent」真实抛 EISDIR（该写入不在 abortTransaction 的 try 内）。
    //    臂④只触发 rollbackAllToOld() 内部被捕获的复制失败，覆盖不到这条路径。
    probe.reset();
    const f5 = fixture({ slug: 'p359e', preexisting: { 'core-01-home.html': '<h1>old</h1>\n' } });
    const outcome5: PrototypeCommitOutcome = { tier: 'skipped', committed: [] };
    const realHooks = buildPrototypeHooks(f5.dir, f5.root, f5.slug, outcome5);
    const wrapped = {
      ...realHooks,
      onApplyFailure(info: { rolledBack: boolean }) {
        // 补偿开始前制造真实文件系统故障（不改源码、不伪造返回值）
        mkdirSync(join(f5.dir, `${COMMIT_JOURNAL}.tmp`), { recursive: true });
        writeFileSync(join(f5.dir, `${COMMIT_JOURNAL}.tmp`, 'keep.txt'), 'x');
        return realHooks.onApplyFailure!(info);
      },
    };
    const prevFail5 = process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
    process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = SPEC_REL;
    const restore5 = enterInstallState({ keepNodeEnvTest: true });
    const lines5: string[] = [];
    let exit5: number | null = null;
    try {
      runDirectMerge(f5.root, f5.dir, f5.slug, {
        hooks: wrapped, stderr: l => lines5.push(l), exit: (c: number) => { exit5 = c; throw new Error('exit'); },
      });
    } catch { /* exit 信号 */ }
    restore5();
    if (prevFail5 === undefined) delete process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER;
    else process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER = prevFail5;

    const t5 = lines5.join('\n');
    expect(exit5).toBe(1);
    // 磁盘事实：原型仍是新字节、journal 保留、规格已回滚、SPEC_MERGED 缺席
    expect(landed(f5.root, 'core-01-home.html')).toBe(f5.prototypes['core-01-home.html']);
    expect(materials(f5.dir).journal).toBe(true);
    expect(readFileSync(join(f5.root, SPEC_REL), 'utf-8')).not.toContain('UT-S99-02');
    expect(existsSync(join(f5.dir, SPEC_MERGED_MARKER))).toBe(false);
    // 失败输出：两侧结论分别如实陈述，且**不得**出现档 A 的整体旧态断言
    expect(t5).toContain('规格 delta 已整批回滚至合并前字节');
    expect(t5).toContain('原型事务回滚不完整');
    expect(t5).toContain('整体不可宣称 logos/resources/ 已回到合并前态');
    expect(t5).not.toContain('logos/resources/ 保持合并前字节，未写 SPEC_MERGED。');
    // 诊断不降级：原始规格失败原因与补偿抛错原因都保留
    expect(t5).toContain('test fault after');
    expect(t5.toLowerCase()).toContain('rollback_threw');
  });

  it('ST-S09-146: 真实 openlogos merge 子进程在安装态端到端落盘原型、可观测且失败声明与磁盘一致', () => {
    const cliEntry = join(CLI_ROOT, 'dist', 'index.js');
    expect(existsSync(cliEntry)).toBe(true);

    // 安装态环境：剔除全部 OPENLOGOS_INTERNAL_*，NODE_ENV 非 test
    const installEnv = (() => {
      const e: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (k.startsWith('OPENLOGOS_INTERNAL_')) continue;
        if (k === 'NODE_ENV' || k === 'OPENLOGOS_TEST_MERGE_FAIL_AFTER') continue;
        if (typeof v === 'string') e[k] = v;
      }
      e.NODE_ENV = 'production';
      return e;
    })();
    expect(Object.keys(installEnv).some(k => k.startsWith('OPENLOGOS_INTERNAL_'))).toBe(false);
    expect(installEnv.NODE_ENV).not.toBe('test');

    const run = (cwd: string, args: string[]) => {
      const r = spawnSync(process.execPath, [cliEntry, ...args], { cwd, encoding: 'utf-8', env: installEnv });
      return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
    };

    // ① 端到端落盘 + ② 摘要逐个列出
    const f1 = fixture({
      slug: 'st146a',
      prototypes: { 'core-01-home.html': '<h1>real-a</h1>\n', 'core-02-list.html': '<h1>real-b</h1>\n' },
    });
    const r1 = run(f1.root, ['merge', f1.slug]);
    expect(r1.status).toBe(0);
    expect(landed(f1.root, 'core-01-home.html')).toBe('<h1>real-a</h1>\n');
    expect(landed(f1.root, 'core-02-list.html')).toBe('<h1>real-b</h1>\n');
    expect(readFileSync(join(f1.root, SPEC_REL), 'utf-8')).toContain('UT-S99-02');
    expect(existsSync(join(f1.dir, SPEC_MERGED_MARKER))).toBe(true);
    const rel = PROTOTYPE_RESOURCE_SUBPATH.replace(/\\/g, '/');
    expect(r1.stdout).toContain('原型落盘：2 个已提交');
    expect(r1.stdout).toContain(`${rel}/core-01-home.html`);
    expect(r1.stdout).toContain(`${rel}/core-02-list.html`);

    // ③ 档 P0 臂：provenance 失配 ⇒ 原型零改动、规格照常合并
    const f2 = fixture({ slug: 'st146b', hashesOverride: { 'core-01-home.html': sha('drifted') } });
    const before = snapshotTree(join(f2.root, PROTOTYPE_RESOURCE_SUBPATH));
    const r2 = run(f2.root, ['merge', f2.slug]);
    expect(r2.status).toBe(0);
    expect(snapshotTree(join(f2.root, PROTOTYPE_RESOURCE_SUBPATH))).toEqual(before);
    expect(materials(f2.dir)).toEqual({ journal: false, staging: false, backup: false });
    expect(r2.stdout).toContain('原型未落盘');
    expect(readFileSync(join(f2.root, SPEC_REL), 'utf-8')).toContain('UT-S99-02');
    expect(existsSync(join(f2.dir, SPEC_MERGED_MARKER))).toBe(true);

    // ⑤ 合成失败臂（端到端可达形态）：章节锚不可解析的 delta 在真实 CLI 下由**同源准入**
    //    （change-lint 与 compose 共用锚判据）在原型提交之前拦下 —— 原型零改动、零恢复材料、
    //    SPEC_MERGED 缺席，与顺序约束一致。mergeDirect 内部「prepare 失败 ⇒ afterPrepare 不执行」
    //    的契约由 UT-S09-359 步骤①直接锁。
    const f3 = fixture({ slug: 'st146c', deltaAnchor: '不存在的章节锚' });
    const r3 = run(f3.root, ['merge', f3.slug]);
    expect(r3.status).not.toBe(0);
    expect(landed(f3.root, 'core-01-home.html')).toBeNull();
    expect(materials(f3.dir)).toEqual({ journal: false, staging: false, backup: false });
    expect(existsSync(join(f3.dir, SPEC_MERGED_MARKER))).toBe(false);
    expect(`${r3.stdout}\n${r3.stderr}`).toContain('delta_section_anchor_unresolvable');
    expect(`${r3.stdout}\n${r3.stderr}`).toContain('未生成 MERGE_PROMPT、未写 SPEC_MERGED');

    // ⑦ 零回归：非 ui_impact 提案的 merge 成功且摘要不含原型段
    const f4 = fixture({ slug: 'st146d', prototypes: {} });
    writeFileSync(join(f4.dir, 'PLAN_APPROVED'), '');                 // 空 marker ⇒ 无曾渲染证据
    writeFileSync(join(f4.dir, 'proposal.md'),
      readFileSync(join(f4.dir, 'proposal.md'), 'utf-8')
        .replace(/product_type/g, 'product_type'));
    writeFileSync(join(f4.root, 'logos', 'logos-project.yaml'),
      `project:\n  name: t\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n    product_type: cli\n`);
    const r4 = run(f4.root, ['merge', f4.slug]);
    expect(r4.status).toBe(0);
    expect(r4.stdout).not.toContain('原型落盘：');
    expect(r4.stdout).not.toContain('原型未落盘');
    expect(existsSync(join(f4.dir, SPEC_MERGED_MARKER))).toBe(true);
  }, 60_000);
});

/** 目录全树字节快照（相对路径 → 内容），用于零改动比对。 */
function snapshotTree(dir: string, base = dir): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      for (const [k, v] of snapshotTree(abs, base)) out.set(k, v);
    } else {
      out.set(abs.slice(base.length + 1), readFileSync(abs, 'utf8'));
    }
  }
  return out;
}
