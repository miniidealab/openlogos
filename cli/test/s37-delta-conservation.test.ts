/**
 * S37 — delta 条目守恒门（merge-conservation-archive-audit）。
 * 用例 ID 与 logos/resources/test/core-S37-test-cases.md 严格对齐（UT-S37-01..31 / ST-S37-01..06）。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts，vitest.config.ts 注册）
 * 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, lstatSync, readlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';
import {
  evaluateDeltaConservation, ID_PATTERN_REGISTRY, deltaTargetProjectPath,
  validateMarkdownDelta, CHANGE_LINT_VIOLATION_CODES, DELTA_TO_RESOURCE, runChangeLint,
  resolveModifiedSectionKeys,
} from '../src/lib/change-lint.js';
import { parseTestCaseIds, extractStructuredTestIds } from '../src/lib/proposal-lifecycle.js';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..');
const REPO_ROOT = resolve(CLI_ROOT, '..');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function spawnCli(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args], { cwd, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ── 共享夹具 ──

const SMOKE_TARGET = [
  '# smoke 规格', '',
  '## 二、冒烟测试用例',
  '| ID | 描述 |', '|----|------|',
  '| SMOKE-core-01 | 安装 |', '| SMOKE-core-03 | 构建 |', '| SMOKE-core-07 | 页面 |',
  '',
].join('\n');

function table(...ids: string[]): string {
  return ['| ID | 描述 |', '|----|------|', ...ids.map(i => `| ${i} | 用例 |`)].join('\n');
}
function delta(op: string, anchor: string, body: string): string {
  return `## ${op} — ${anchor}\n\n${body}\n`;
}
const codesOf = (vs: { code: string }[]) => vs.map(v => v.code);

/** 双重复标题夹具（对齐真实 smoke 结构：同名子标题分属不同父章节）。 */
const DUP_TARGET = [
  '# smoke 规格', '',
  '## 四、runner 覆盖冒烟用例', '### 二、冒烟测试用例补充', table('SMOKE-core-31', 'SMOKE-core-32'), '',
  '## 七、UI 前置冒烟用例', '### 二、冒烟测试用例补充', table('SMOKE-core-40'), '',
].join('\n');

// ── ST 夹具：真实临时项目 ──

interface StOpts { deltaRel?: string; deltaContent?: string; target?: { rel: string; content: string } }
function setupProject(o: StOpts = {}): { root: string; slug: string; dir: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  const slug = 'feat';
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', product_type: 'cli' }],
  }, { lineWidth: 0 }));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-08-01T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), [
    '# 变更提案：feat', '', '> module: core', '',
    '## 变更原因', '需要新能力。', '', '## 变更类型', '代码级修复', '',
    '## 部署影响', '- 是否需要部署：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '需要 CLI 代码、测试和 reporter 实现。',
  ].join('\n'));
  writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/test/` — 更新用例\n\n## [code] 代码实现\n');
  if (o.target) {
    const t = join(root, o.target.rel);
    mkdirSync(dirname(t), { recursive: true });
    writeFileSync(t, o.target.content);
  }
  if (o.deltaRel && o.deltaContent !== undefined) {
    const d = join(dir, o.deltaRel);
    mkdirSync(dirname(d), { recursive: true });
    writeFileSync(d, o.deltaContent);
  }
  return { root, slug, dir };
}

const SMOKE_REL = 'logos/resources/test/smoke/core-smoke-test-cases.md';
const SMOKE_DELTA_REL = 'deltas/test/smoke/core-smoke-test-cases.md';

function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = full.slice(root.length);
      const lst = lstatSync(full);
      if (lst.isSymbolicLink()) { out.set(rel, `symlink:${readlinkSync(full)}`); continue; }
      if (lst.isDirectory()) { out.set(rel, 'dir'); walk(full); continue; }
      if (lst.isFile()) { out.set(rel, createHash('sha256').update(readFileSync(full)).digest('hex')); continue; }
      out.set(rel, 'other');
    }
  };
  walk(root);
  return out;
}

/* ========== UT — 守恒判据核心 ========== */

describe('S37 — 守恒判据（结构化归属对账）', () => {
  it('UT-S37-01: 纯 ADDED 通过——新增条目天然守恒', () => {
    const d = delta('ADDED', '新用例', table('SMOKE-core-99'));
    expect(evaluateDeltaConservation(d, SMOKE_TARGET)).toEqual([]);
  });

  it('UT-S37-02: MODIFIED 结构位置携带全量 + 新增通过', () => {
    const d = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-03', 'SMOKE-core-07', 'SMOKE-core-99'));
    expect(evaluateDeltaConservation(d, SMOKE_TARGET)).toEqual([]);
  });

  it('UT-S37-03: MODIFIED 隐式删单个测试 ID——恰 1 条违规且三字段齐备', () => {
    const d = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-07'));
    const vs = evaluateDeltaConservation(d, SMOKE_TARGET);
    expect(vs).toHaveLength(1);
    expect(vs[0].code).toBe('delta_implicit_id_removal');
    expect(vs[0].message).toContain('SMOKE-core-03');
    expect(vs[0].anchor).toBe('二、冒烟测试用例');
    expect(vs[0].fix_hint).toContain('REMOVED-ITEMS');
  });

  it('UT-S37-04: MODIFIED 隐式删多个 ID——逐 ID 各一条、稳定排序；同锚多重 MODIFIED 单写者拒绝（code-r1 F1）', () => {
    const target = `# t\n\n## 用例表\n${table('UT-S12-01', 'ST-S12-02', 'SMOKE-core-07')}\n`;
    const d = delta('MODIFIED', '用例表', table());
    const vs = evaluateDeltaConservation(d, target);
    expect(vs).toHaveLength(3);
    expect(new Set(codesOf(vs))).toEqual(new Set(['delta_implicit_id_removal']));
    const again = evaluateDeltaConservation(d, target);
    expect(vs.map(v => v.message)).toEqual(again.map(v => v.message)); // 稳定
    // code-r1 F1 可复现输入：先全量保留、再同锚只保留一个 ID——并集守恒是假象，逐块替换后
    // 第二块覆盖第一块并静默删除 ST-S12-02/SMOKE-core-07 → 单写者规则 fail-closed 拒绝
    const multi = delta('MODIFIED', '用例表', table('UT-S12-01', 'ST-S12-02', 'SMOKE-core-07'))
      + delta('MODIFIED', '用例表', table('UT-S12-01'));
    const mv = evaluateDeltaConservation(multi, target);
    expect(codesOf(mv)).toEqual(['delta_implicit_id_removal']);
    expect(mv[0].message).toContain('2 个 MODIFIED 写者');
    expect(mv[0].fix_hint).toContain('单个 MODIFIED 块');
  });

  it('UT-S37-05: MODIFIED 隐式删场景总览表 SXX 行；普通编号表/孤立 pipe/异节编号表不伪装保留（code-r1/r2 F3）；无冒号 SXX 标题守恒（code-r1 F4）', () => {
    const target = '# t\n\n## 场景地图\n| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | b |\n';
    const d = delta('MODIFIED', '场景地图', '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |');
    const vs = evaluateDeltaConservation(d, target);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
    expect(vs[0].message).toContain('S05');
    // code-r1 F3 可复现输入：正式场景表删 S05，另附「历史引用」表头普通表首列写 S05 → 不构成结构化保留
    const fake = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n\n| 历史引用 | 说明 |\n|---|---|\n| S05 | 已退役 |');
    const fv = evaluateDeltaConservation(fake, target);
    expect(codesOf(fv)).toEqual(['delta_implicit_id_removal']);
    expect(fv[0].message).toContain('S05');
    // code-r2 F3 残留可复现输入：`### 历史引用` 子节内「编号+说明」通用表头表——schema（第二列非「场景名称」）出局
    const fakeR2 = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n\n### 历史引用\n\n| 编号 | 说明 |\n| --- | --- |\n| S05 | 只作历史引用，不是场景条目 |');
    const fv2 = evaluateDeltaConservation(fakeR2, target);
    expect(codesOf(fv2)).toEqual(['delta_implicit_id_removal']);
    expect(fv2[0].message).toContain('S05');
    // code-r3 F3 残留可复现输入：`### 历史引用` 子节内**完整克隆双列 schema**（编号+场景名称）表——
    // 表身份键为「历史引用」≠ 正式表身份 ''（直接辖属），克隆表不能为正式表的删除背书
    const cloneR3 = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n\n### 历史引用\n\n| 编号 | 场景名称 |\n| --- | --- |\n| S05 | 仅作历史引用，不是正式场景条目 |');
    const cv3 = evaluateDeltaConservation(cloneR3, target);
    expect(codesOf(cv3)).toEqual(['delta_implicit_id_removal']);
    expect(cv3[0].message).toContain('S05');
    // code-r4 F3 残留可复现输入：目标**预先**同时含正式条目与历史副本（S05 既有身份 {'', '历史引用'}），
    // delta 删正式条目、仅保留历史副本——(ID, 表身份) 逐对守恒下，身份 '' 缺失必须报违规（任一交集不放行）
    const dualTarget = '# t\n\n## 场景地图\n| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | 正式场景 |\n\n### 历史引用\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |\n';
    const dropFormal = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n\n### 历史引用\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |');
    const dv = evaluateDeltaConservation(dropFormal, dualTarget);
    expect(codesOf(dv)).toEqual(['delta_implicit_id_removal']);
    expect(dv[0].message).toContain('S05');
    expect(dv[0].message).toContain('正式表·直接辖属'); // 缺的是正式表身份，不被历史副本背书
    // 双副本全量保留（含历史副本子节）→ 每个 (ID, 身份) 对均保留，无违规
    const keepBoth = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | 正式场景 |\n\n### 历史引用\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |');
    expect(evaluateDeltaConservation(keepBoth, dualTarget)).toEqual([]);
    // 反向：删历史副本、保留正式条目——身份「历史引用」缺失同样必须显式
    const dropHistorical = delta('MODIFIED', '场景地图', '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | 正式场景 |');
    const hv = evaluateDeltaConservation(dropHistorical, dualTarget);
    expect(codesOf(hv)).toEqual(['delta_implicit_id_removal']);
    expect(hv[0].message).toContain('「历史引用」');
    // code-r5 F3 残留可复现输入：正式表与历史快照表**同一标题子路径**（都直接辖属 `## 场景地图`），
    // 仅由普通文本「历史快照：」分隔——两表身份此前因 subPath 相同被 `Set` 坍缩，历史快照为正式条目删除背书。
    // 修法：同子路径下多张合格场景表按文档序取 0 基位次入身份键（正式表 #0 ≠ 历史快照 #1）。
    const sameSubPathTarget = '# t\n\n## 场景地图\n| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | 正式场景 |\n\n历史快照：\n\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |\n';
    const dropFormalSameSub = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n\n历史快照：\n\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |');
    const sv = evaluateDeltaConservation(dropFormalSameSub, sameSubPathTarget);
    expect(codesOf(sv)).toEqual(['delta_implicit_id_removal']); // 删正式条目、仅留历史快照 → 必报违规
    expect(sv[0].message).toContain('S05');
    expect(sv[0].message).toContain('第 1 张场景表'); // 缺的是正式表（同子路径首张）
    expect(sv[0].message).toContain('共 2 张');
    // 反向：删历史快照表、保留正式条目——同子路径第 2 张缺失同样显式报违规
    const dropHistSameSub = delta('MODIFIED', '场景地图', '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | 正式场景 |');
    const shv = evaluateDeltaConservation(dropHistSameSub, sameSubPathTarget);
    expect(codesOf(shv)).toEqual(['delta_implicit_id_removal']);
    expect(shv[0].message).toContain('第 2 张场景表');
    // 正例：同子路径双表**全量保留**（正式表 + 历史快照表）→ 每个 (ID, 身份) 对齐，无违规
    const keepBothSameSub = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | 正式场景 |\n\n历史快照：\n\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |');
    expect(evaluateDeltaConservation(keepBothSameSub, sameSubPathTarget)).toEqual([]);
    // 身份配对下的显式迁移路径：REMOVED-ITEMS 点名后另行 ADDED，不触发违规（迁移必须显式）
    const move = delta('MODIFIED', '场景地图', '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |')
      + delta('REMOVED-ITEMS', '场景地图', '- S05 — 迁移到其他分组，另行 ADDED')
      + delta('ADDED', '新分组场景', '| 编号 | 场景名称 |\n|---|---|\n| S05 | b |');
    expect(evaluateDeltaConservation(move, target)).toEqual([]);
    // code-r2 F3 辖属反例：完整场景 schema 表但辖属链无场景语义标题（目标「附录」节）→ 不构成既有集合成员
    const appendixTarget = '# t\n\n## 附录\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 引用 |\n';
    const appendixDrop = delta('MODIFIED', '附录', '改写为纯散文。');
    expect(evaluateDeltaConservation(appendixDrop, appendixTarget)).toEqual([]); // 附录中的编号表不入守恒集合
    // 孤立 pipe 行（无 delimiter 的伪表）同样不构成保留
    const orphan = delta('MODIFIED', '场景地图', '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n\n| S05 | 孤立行 |');
    expect(codesOf(evaluateDeltaConservation(orphan, target))).toEqual(['delta_implicit_id_removal']);
    // 合法场景表（编号+场景名称 schema + 场景地图辖属）正常构成保留
    const legal = delta('MODIFIED', '场景地图', '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | b |');
    expect(evaluateDeltaConservation(legal, target)).toEqual([]);
    // 真实「三、场景总览」形态：①分组子标题下的场景表（context 经锚传递）仍正常计数
    const overviewTarget = '# t\n\n## 三、场景总览\n### ① 初始化\n| 编号 | 场景名称 | 优先级 |\n|---|---|---|\n| S01 | a | P0 |\n| S05 | b | P0 |\n';
    const overviewDrop = delta('MODIFIED', '三、场景总览', '### ① 初始化\n| 编号 | 场景名称 | 优先级 |\n|---|---|---|\n| S01 | a | P0 |');
    const ov = evaluateDeltaConservation(overviewDrop, overviewTarget);
    expect(codesOf(ov)).toEqual(['delta_implicit_id_removal']);
    expect(ov[0].message).toContain('S05');
    // code-r1 F4 可复现输入：真实「功能验收摘要」结构的无冒号 `### SXX` 标题——删任一必产违规
    const noColonTarget = '# t\n\n## 功能验收摘要\n### S01\n验收项。\n### S05\n验收项。\n';
    const drop = delta('MODIFIED', '功能验收摘要', '### S01\n验收项。');
    const nv = evaluateDeltaConservation(drop, noColonTarget);
    expect(codesOf(nv)).toEqual(['delta_implicit_id_removal']);
    expect(nv[0].message).toContain('S05');
    const keep = delta('MODIFIED', '功能验收摘要', '### S01\n验收项。\n### S05\n验收项。');
    expect(evaluateDeltaConservation(keep, noColonTarget)).toEqual([]);
  });

  it('UT-S37-06: MODIFIED 隐式吞节号标题（多级/字母后缀形态）', () => {
    const target = '# t\n\n## 二、规格\n### 2.19.A 旧能力\n内容\n### 2.29.1 新能力\n内容\n';
    const d = delta('MODIFIED', '二、规格', '### 2.29.1 新能力\n内容');
    const vs = evaluateDeltaConservation(d, target);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
    expect(vs[0].message).toContain('2.19.A');
  });

  it('UT-S37-07: 部分删除成对写法（MODIFIED 剩余全量 + REMOVED-ITEMS 同锚点名）通过', () => {
    const d = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-07'))
      + delta('REMOVED-ITEMS', '二、冒烟测试用例', '- SMOKE-core-03 — 构建流程重构，检查项由新用例取代');
    expect(evaluateDeltaConservation(d, SMOKE_TARGET)).toEqual([]);
  });

  it('UT-S37-08: 整节 REMOVED 通过——全节 ID 随章节显式删除、未逐个点名', () => {
    const d = delta('REMOVED', '二、冒烟测试用例', '该冒烟域下线，整节删除。');
    expect(evaluateDeltaConservation(d, SMOKE_TARGET)).toEqual([]);
  });

  it('UT-S37-09: REMOVED-ITEMS 点名拼写不存在的 ID → delta_removed_unknown_id', () => {
    const d = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-03', 'SMOKE-core-07'))
      + delta('REMOVED-ITEMS', '二、冒烟测试用例', '- UT-S12-99 — 不存在的 ID');
    const vs = evaluateDeltaConservation(d, SMOKE_TARGET);
    expect(codesOf(vs)).toEqual(['delta_removed_unknown_id']);
    expect(vs[0].message).toContain('UT-S12-99');
  });

  it('UT-S37-10: 目标主文档不存在（全新文档）跳过守恒', () => {
    const d = delta('MODIFIED', '任意章节', '任意内容');
    expect(evaluateDeltaConservation(d, null)).toEqual([]);
  });

  it('UT-S37-11: 纯散文 delta 不进 L8——触及章节无注册表 ID', () => {
    const target = '# t\n\n## 说明章节\n一段没有任何稳定 ID 的散文。\n';
    const d = delta('MODIFIED', '说明章节', '改写后的散文，仍然没有 ID。');
    expect(evaluateDeltaConservation(d, target)).toEqual([]);
  });

  it('UT-S37-12: fence 内 ID 不算保留——围栏引用不豁免隐式删除', () => {
    const d = delta('MODIFIED', '二、冒烟测试用例',
      `${table('SMOKE-core-01', 'SMOKE-core-07')}\n\n\`\`\`\n| SMOKE-core-03 | 围栏内示例 |\n\`\`\``);
    const vs = evaluateDeltaConservation(d, SMOKE_TARGET);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
    expect(vs[0].message).toContain('SMOKE-core-03');
  });

  it('UT-S37-13: 散文提及不算保留（F2 反例）', () => {
    const d = delta('MODIFIED', '二、冒烟测试用例',
      `${table('SMOKE-core-01', 'SMOKE-core-07')}\n\n说明：SMOKE-core-03 已删除，但本节不再保留其表格行。`);
    const vs = evaluateDeltaConservation(d, SMOKE_TARGET);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
  });

  it('UT-S37-14: 非 ID 列单元格出现不算保留（F2 反例）', () => {
    const d = delta('MODIFIED', '二、冒烟测试用例',
      '| ID | 描述 |\n|----|------|\n| SMOKE-core-01 | 参考 SMOKE-core-03 的旧行为 |\n| SMOKE-core-07 | 页面 |');
    const vs = evaluateDeltaConservation(d, SMOKE_TARGET);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
    expect(vs[0].message).toContain('SMOKE-core-03');
  });

  it('UT-S37-15: 跨章节出现不背书（F2 反例）——逐章节归属对账', () => {
    const target = `# t\n\n## A 章\n${table('UT-S12-01')}\n\n## B 章\n${table('SMOKE-core-03')}\n`;
    const d = delta('MODIFIED', 'A 章', table('UT-S12-01', 'SMOKE-core-03'))
      + delta('MODIFIED', 'B 章', table());
    const vs = evaluateDeltaConservation(d, target);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
    expect(vs[0].anchor).toBe('B 章');
    expect(vs[0].message).toContain('SMOKE-core-03');
  });

  it('UT-S37-16: 错误章节点名不背书（F2 反例）——unknown + implicit 双违规', () => {
    const target = `# t\n\n## A 章\n${table('UT-S12-01')}\n\n## B 章\n${table('SMOKE-core-03')}\n`;
    const d = delta('MODIFIED', 'A 章', table('UT-S12-01'))
      + delta('REMOVED-ITEMS', 'A 章', '- SMOKE-core-03 — 点错了章节')
      + delta('MODIFIED', 'B 章', table());
    const vs = evaluateDeltaConservation(d, target);
    expect(codesOf(vs).sort()).toEqual(['delta_implicit_id_removal', 'delta_removed_unknown_id']);
    const unknown = vs.find(v => v.code === 'delta_removed_unknown_id')!;
    expect(unknown.anchor).toBe('A 章');
    const implicit = vs.find(v => v.code === 'delta_implicit_id_removal')!;
    expect(implicit.anchor).toBe('B 章');
  });

  it('UT-S37-17: 仅 REMOVED-ITEMS 无同锚 MODIFIED——点名无物质载体（对偶缺陷）', () => {
    const d = delta('REMOVED-ITEMS', '二、冒烟测试用例', '- SMOKE-core-03 — 退役');
    const vs = evaluateDeltaConservation(d, SMOKE_TARGET);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
    expect(vs[0].message).toContain('无物质载体');
  });
});

/* ========== UT — 章节锚解析（fail-closed） ========== */

describe('S37 — 章节锚解析', () => {
  it('UT-S37-18: 单段锚唯一命中正常对账，零锚违规', () => {
    const d = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-03', 'SMOKE-core-07'));
    expect(evaluateDeltaConservation(d, SMOKE_TARGET)).toEqual([]);
  });

  it('UT-S37-19: 重复标题单段锚 fail-closed（ambiguous，真实 smoke 结构夹具）——不取第一个、不合并', () => {
    const d = delta('MODIFIED', '二、冒烟测试用例补充', table('SMOKE-core-31', 'SMOKE-core-32'));
    const vs = evaluateDeltaConservation(d, DUP_TARGET);
    expect(codesOf(vs)).toEqual(['delta_section_anchor_unresolvable']);
    expect(vs[0].message).toContain('ambiguous');
    expect(vs[0].message).toMatch(/行 \d+、\d+/); // 候选位置列出
    expect(vs[0].fix_hint).toContain('标题路径锚');
  });

  it('UT-S37-20: 标题路径锚对第一处与后续各处均可精确定位', () => {
    const ok = delta('MODIFIED', '四、runner 覆盖冒烟用例 > 二、冒烟测试用例补充', table('SMOKE-core-31', 'SMOKE-core-32'));
    expect(evaluateDeltaConservation(ok, DUP_TARGET)).toEqual([]);
    // 第二处：删 SMOKE-core-40 未点名 → 只对该父章节下的目标节违规
    const bad = delta('MODIFIED', '七、UI 前置冒烟用例 > 二、冒烟测试用例补充', table());
    const vs = evaluateDeltaConservation(bad, DUP_TARGET);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
    expect(vs[0].message).toContain('SMOKE-core-40');
    expect(vs[0].message).not.toContain('SMOKE-core-31');
  });

  it('UT-S37-21: 锚不存在 fail-closed（not-found）；空锚物质变更不豁免（code-r1 F2）', () => {
    const d = delta('MODIFIED', '不存在的章节', table('SMOKE-core-01'));
    const vs = evaluateDeltaConservation(d, SMOKE_TARGET);
    expect(codesOf(vs)).toEqual(['delta_section_anchor_unresolvable']);
    expect(vs[0].message).toContain('not-found');
    // code-r1 F2 可复现输入：`## MODIFIED` 裸标记（无锚）——不得被过滤为零违规
    const bare = `## MODIFIED\n\n${table('SMOKE-core-01')}\n`;
    const bv = evaluateDeltaConservation(bare, SMOKE_TARGET);
    expect(codesOf(bv)).toEqual(['delta_section_anchor_unresolvable']);
    expect(bv[0].message).toContain('缺章节锚');
    // 空锚 REMOVED / REMOVED-ITEMS 同拒
    expect(codesOf(evaluateDeltaConservation('## REMOVED\n\n原因。\n', SMOKE_TARGET))).toEqual(['delta_section_anchor_unresolvable']);
    expect(codesOf(evaluateDeltaConservation('## REMOVED-ITEMS\n\n- SMOKE-core-03 — x\n', SMOKE_TARGET))).toEqual(['delta_section_anchor_unresolvable']);
    // 空锚 ADDED 合法（纯新增无守恒义务）
    expect(evaluateDeltaConservation(`## ADDED\n\n${table('SMOKE-core-99')}\n`, SMOKE_TARGET)).toEqual([]);
  });
});

/* ========== UT — ID 模式注册表 ========== */

describe('S37 — ID 模式注册表', () => {
  it('UT-S37-22: 测试 ID 识别正反例——结构位置 + parseTestCaseIds 判形，无第二份正则', () => {
    expect(parseTestCaseIds('见 UT-S37-01 与 ST-S37-02a、SMOKE-core-53')).toEqual(['UT-S37-01', 'ST-S37-02a', 'SMOKE-core-53']);
    expect(parseTestCaseIds('UT-Sxx-* 通配 与 UT-S99-TBD 占位')).toEqual([]);
    // 结构位置：仅测试表 ID 首列构成存在性
    const structural = extractStructuredTestIds(`散文里的 UT-S12-88 不算。\n\n${table('UT-S12-01')}`);
    expect(structural).toEqual(['UT-S12-01']);
  });

  it('UT-S37-23: 场景 ID 识别正反例——`## SXX:` / `### SXX`（含无冒号形态，code-r1 F4）标题与场景表行首列', () => {
    expect(ID_PATTERN_REGISTRY.scenarioHeading.exec('S37: delta 条目守恒门')?.[1]).toBe('S37');
    expect(ID_PATTERN_REGISTRY.scenarioHeading.exec('S05：查看下一步建议')?.[1]).toBe('S05');
    // code-r1 F4：契约 §2.33.3 明确 `### SXX` 无冒号形态是合法结构位置（真实语料：功能验收摘要 `### S01`）
    expect(ID_PATTERN_REGISTRY.scenarioHeading.exec('S37 无冒号带描述标题')?.[1]).toBe('S37');
    expect(ID_PATTERN_REGISTRY.scenarioHeading.exec('S01')?.[1]).toBe('S01'); // 裸 SXX 标题（行尾）
    // 前缀伪命中仍拒绝
    expect(ID_PATTERN_REGISTRY.scenarioHeading.test('S999x 伪场景')).toBe(false);
    expect(ID_PATTERN_REGISTRY.scenarioHeading.test('SMOKE-core-01 冒烟')).toBe(false);
    expect(ID_PATTERN_REGISTRY.scenarioRow.test('S05')).toBe(true);
    expect(ID_PATTERN_REGISTRY.scenarioRow.test('S999x')).toBe(false);
    expect(ID_PATTERN_REGISTRY.scenarioRow.test('SXX')).toBe(false);
    // 场景表表头语义（code-r1/r2 F3）：首列「编号 / 场景编号」+ 第二列「场景名称」双列 schema + 辖属语义
    expect(ID_PATTERN_REGISTRY.scenarioTableHeader.test('编号')).toBe(true);
    expect(ID_PATTERN_REGISTRY.scenarioTableHeader.test('场景编号')).toBe(true);
    expect(ID_PATTERN_REGISTRY.scenarioTableHeader.test('历史引用')).toBe(false);
    expect(ID_PATTERN_REGISTRY.scenarioTableSecondHeader.test('场景名称')).toBe(true);
    expect(ID_PATTERN_REGISTRY.scenarioTableSecondHeader.test('说明')).toBe(false);
    expect(ID_PATTERN_REGISTRY.scenarioSectionTitle.test('三、场景总览')).toBe(true);
    expect(ID_PATTERN_REGISTRY.scenarioSectionTitle.test('场景地图')).toBe(true);
    expect(ID_PATTERN_REGISTRY.scenarioSectionTitle.test('历史引用')).toBe(false);
  });

  it('UT-S37-24: 节号完整 token 文法（F4）——多级/直接字母后缀/末级点分字母互不坍缩；版本号与散文引用不入集合', () => {
    const positives = ['2.33', '2.29.1', '2.29.2', '2.2b', '2.2c', '2.5a', '2.7A', '2.13.1',
      '2.19.A', '2.19.B', '2.19.C', '2.20.A', '2.20.B', '2.20.C', '2.20.D'];
    for (const p of positives) expect(ID_PATTERN_REGISTRY.sectionNumber.test(p), p).toBe(true);
    expect(new Set(positives).size).toBe(positives.length); // 完整 token 即 ID，互不坍缩
    for (const n of ['2.19.AB', '2..9', 'v0.13.21', '2.19.', '.2.19']) {
      expect(ID_PATTERN_REGISTRY.sectionNumber.test(n), n).toBe(false);
    }
    // 结构位置：版本号 / 散文小数 / 标题行外 §引用 不构成既有集合成员
    const target = '# t\n\n## 甲章\n### 2.19.A 能力\n版本 0.13.21 发布；散文里提到 1.5 与 §2.7 引用。\n';
    const d = delta('MODIFIED', '甲章', '改写散文（吞掉 2.19.A 小节）');
    const vs = evaluateDeltaConservation(d, target);
    expect(vs).toHaveLength(1); // 仅 2.19.A 一条——0.13.21 / 1.5 / §2.7 均不在集合内
    expect(vs[0].message).toContain('2.19.A');
  });

  it('UT-S37-25: 节号 corpus 回归（F4）——当前受管规格全部编号标题识别 + 逐个删除必产违规', () => {
    const docs = [
      'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md',
      'logos/resources/prd/2-product-design/2-page-design/core-01-cli-experience.md',
      'logos/resources/prd/1-product-requirements/core-01-requirements.md',
      'logos/resources/test/core-S37-test-cases.md',
      'logos/resources/test/smoke/core-smoke-test-cases.md',
    ];
    const loose = /^[0-9][0-9.A-Za-z]*$/;
    const tokens = new Set<string>();
    for (const rel of docs) {
      const content = readFileSync(join(REPO_ROOT, rel), 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const m = /^#{1,6}\s+(\S+)/.exec(line);
        if (m && loose.test(m[1])) {
          expect(ID_PATTERN_REGISTRY.sectionNumber.test(m[1]), `文法漏形态：${m[1]}（${rel}）`).toBe(true);
          tokens.add(m[1]);
        }
      }
    }
    for (const must of ['2.19.A', '2.19.B', '2.19.C', '2.20.A', '2.20.B', '2.20.C', '2.20.D', '2.29.1', '2.2b']) {
      expect(tokens.has(must), must).toBe(true);
    }
    // 逐个删除任一标题 → 守恒违规（合成 corpus 文档 + 逐 token 删除）
    const all = [...tokens];
    const corpusDoc = `# corpus\n\n## 语料\n${all.map(t2 => `### ${t2} 标题`).join('\n')}\n`;
    for (const tok of all) {
      const body = all.filter(t2 => t2 !== tok).map(t2 => `### ${t2} 标题`).join('\n');
      const vs = evaluateDeltaConservation(delta('MODIFIED', '语料', body), corpusDoc);
      expect(codesOf(vs), tok).toEqual(['delta_implicit_id_removal']);
      expect(vs[0].message).toContain(tok);
    }
  });
});

/* ========== UT — 契约与同源 ========== */

describe('S37 — 契约、同源与零漂移', () => {
  function lintFixture(deltaContent: string, targetContent: string): { root: string; slug: string; dir: string } {
    return setupProject({
      deltaRel: SMOKE_DELTA_REL, deltaContent,
      target: { rel: SMOKE_REL, content: targetContent },
    });
  }

  it('UT-S37-26: violation 结构与排序——code/path/fix_hint 必填，L8 位于 L7 后，同 path 按 delta 源位置序（code-r1 F5）；跨文件同章节多写者拒绝（code-r1 F1）', () => {
    const bad = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01'))
      + delta('MODIFIED', '不存在的章节', '内容');
    const { root, slug, dir } = lintFixture(bad, SMOKE_TARGET);
    const result = runChangeLint(root, dir, slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const l8 = result.violations.filter(v => codesL8.includes(v.code));
    expect(l8.length).toBeGreaterThanOrEqual(3); // 2 隐式删 + 1 锚
    for (const v of l8) {
      expect(v.code).toBeTruthy();
      expect(v.path).toMatch(/^logos\/changes\/feat\/deltas\/test\/smoke\//);
      expect(v.fix_hint).toBeTruthy();
      expect(v.flow_reason).toBeUndefined(); // L8 无 flow_reason 映射
    }
    // L8 全部排在非 L8 之后（生成序 = 检查项序）
    const firstL8 = result.violations.findIndex(v => codesL8.includes(v.code));
    expect(result.violations.slice(firstL8).every(v => codesL8.includes(v.code))).toBe(true);
    expect(result.checks.find(c => c.id === 8)?.label).toContain('条目守恒');
    // code-r1 F5：同 path 按 delta 源位置出现序——故意与字典序相反的锚序列（Z 章在前、A 章在后）
    const zaTarget = `# t\n\n## Z章\n${table('UT-S12-01')}\n\n## A章\n${table('SMOKE-core-03')}\n`;
    const zaDelta = delta('MODIFIED', 'Z章', table()) + delta('MODIFIED', 'A章', table());
    const zv = evaluateDeltaConservation(zaDelta, zaTarget);
    expect(zv.map(v => v.anchor)).toEqual(['Z章', 'A章']); // 源位置序，非字典序
    const { root: r2d, slug: s2d, dir: d2d } = lintFixture(zaDelta, zaTarget);
    // 经 runChangeLint 同序（pushViolation seq = 生成序）
    const lintRes = runChangeLint(r2d, d2d, s2d);
    expect(lintRes.ok).toBe(true);
    if (lintRes.ok) {
      const seq = lintRes.violations.filter(v => codesL8.includes(v.code)).map(v => v.message);
      expect(seq[0]).toContain('Z章');
      expect(seq[1]).toContain('A章');
    }
    // code-r2 F5 残留可复现输入：同锚声明跨越另一锚的交错形态——delta 源序为
    // ① MODIFIED — A章（全量，无违规）→ ② MODIFIED — B章（漏 UT-S01-03，先违规）→
    // ③ REMOVED-ITEMS — A章（点名不存在的 UT-S01-99，后违规）。输出必须按声明源行序 [B章, A章]，
    // 不得因 A 锚首现在前而把 ③ 的违规提前。
    const ivTarget = `# t\n\n## A章\n${table('UT-S01-01')}\n\n## B章\n${table('UT-S01-02', 'UT-S01-03')}\n`;
    const ivDelta = delta('MODIFIED', 'A章', table('UT-S01-01'))
      + delta('MODIFIED', 'B章', table('UT-S01-02'))
      + delta('REMOVED-ITEMS', 'A章', '- UT-S01-99 — 点名不存在的 ID');
    const iv = evaluateDeltaConservation(ivDelta, ivTarget);
    expect(iv.map(v => ({ code: v.code, anchor: v.anchor }))).toEqual([
      { code: 'delta_implicit_id_removal', anchor: 'B章' },
      { code: 'delta_removed_unknown_id', anchor: 'A章' },
    ]);
    // code-r1 F1（跨文件分支）：delta 路径 → 目标路径为单射（同名同子路径映射），两个不同 delta 文件
    // 无法指向同一目标文件；提案级 sectionWriters 聚合是对该不变量的纵深防御。此处锁定聚合键的
    // 确定性：同一（delta, target）解析出的章节键稳定且唯一，供 lint/merge 共享聚合。
    const keys1 = resolveModifiedSectionKeys(delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-03', 'SMOKE-core-07')), SMOKE_TARGET);
    const keys2 = resolveModifiedSectionKeys(delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-03', 'SMOKE-core-07')), SMOKE_TARGET);
    expect(keys1).toEqual(keys2);
    expect(keys1).toHaveLength(1);
    // 锚不可解析 / 空锚的块不产生写者键（冲突判定只基于解析成功的写者）
    expect(resolveModifiedSectionKeys('## MODIFIED\n\n内容\n', SMOKE_TARGET)).toEqual([]);
    expect(resolveModifiedSectionKeys(delta('MODIFIED', '不存在的章节', '内容'), SMOKE_TARGET)).toEqual([]);
  });

  const codesL8 = ['delta_implicit_id_removal', 'delta_removed_unknown_id', 'delta_section_anchor_unresolvable'];

  it('UT-S37-27: 同源锚——lint L8 与 merge 消费点共享判据，同一夹具两侧结论逐字段一致', () => {
    const bad = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-07'));
    const { root, slug, dir } = lintFixture(bad, SMOKE_TARGET);
    const result = runChangeLint(root, dir, slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lintSide = result.violations.filter(v => codesL8.includes(v.code));
    // merge 侧 = 同一导出函数（merge.ts 打包调用 evaluateDeltaConservation，无第二份判据）
    const mergeSide = evaluateDeltaConservation(bad, SMOKE_TARGET);
    expect(lintSide.map(v => ({ code: v.code, message: v.message, fix_hint: v.fix_hint })))
      .toEqual(mergeSide.map(v => ({ code: v.code, message: v.message, fix_hint: v.fix_hint })));
  });

  it('UT-S37-28: 判据纯函数韧性——段标记畸形输入不抛异常、L8 不重复报 L4 缺陷', () => {
    expect(evaluateDeltaConservation('没有任何段标记的纯文本。', SMOKE_TARGET)).toEqual([]);
    expect(evaluateDeltaConservation('', SMOKE_TARGET)).toEqual([]);
    expect(validateMarkdownDelta('没有任何段标记的纯文本。').missingSectionMarker).toBe(true);
  });

  it('UT-S37-29: L4 承认 REMOVED-ITEMS——配对合法；仅 REMOVED-ITEMS 无物质变更块仍非法', () => {
    const paired = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01'))
      + delta('REMOVED-ITEMS', '二、冒烟测试用例', '- SMOKE-core-03 — 退役');
    expect(validateMarkdownDelta(paired).missingSectionMarker).toBe(false);
    const only = delta('REMOVED-ITEMS', '二、冒烟测试用例', '- SMOKE-core-03 — 退役');
    expect(validateMarkdownDelta(only).missingSectionMarker).toBe(true);
    // REMOVED-ITEMS 模板占位标题命中骨架
    expect(validateMarkdownDelta('## REMOVED-ITEMS — [被删条目所在章节锚]\n- X — y').templateSkeleton).toBe(true);
  });

  it('UT-S37-30: 映射一致性（F5）——DELTA_TO_RESOURCE 与两份权威文档三方一致', () => {
    expect(DELTA_TO_RESOURCE['spec']).toBe('spec');
    expect(DELTA_TO_RESOURCE['skills']).toBe('skills');
    expect(deltaTargetProjectPath('deltas/skills/change-writer/SKILL.md')).toBe('skills/change-writer/SKILL.md');
    expect(deltaTargetProjectPath('deltas/spec/change-management.md')).toBe('spec/change-management.md');
    expect(deltaTargetProjectPath('deltas/test/smoke/x.md')).toBe('logos/resources/test/smoke/x.md');
    const spec = readFileSync(join(REPO_ROOT, 'spec', 'change-management.md'), 'utf-8');
    expect(spec).toContain('`deltas/skills/` → 对应**项目根目录 `skills/`**');
    expect(spec).toContain('`deltas/spec/` → 对应项目根目录 `spec/`');
    const skill = readFileSync(join(REPO_ROOT, 'skills', 'change-writer', 'SKILL.md'), 'utf-8');
    expect(skill).toContain('| 项目根 `skills/`（Skill 文档，权威） | `deltas/skills/` |');
    expect(skill).toContain('| 项目根 `spec/`（方法论规范，权威） | `deltas/spec/` |');
    // 全类目映射均在权威 spec 声明中出现
    for (const category of Object.keys(DELTA_TO_RESOURCE)) {
      expect(spec).toContain(`deltas/${category}/`);
    }
  });

  it('UT-S37-31: 零回归——枚举 26 码闭合；合法 delta 零 L8 违规、L1–L7 判据不受影响', () => {
    expect(CHANGE_LINT_VIOLATION_CODES).toHaveLength(26);
    expect(new Set(CHANGE_LINT_VIOLATION_CODES).size).toBe(26);
    // 合法形态全过：纯 ADDED / 全量 MODIFIED / 整节 REMOVED / 成对部分删除
    const legalDeltas = [
      delta('ADDED', '新章节', table('SMOKE-core-99')),
      delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-03', 'SMOKE-core-07')),
      delta('REMOVED', '二、冒烟测试用例', '整节下线。'),
      delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-07'))
        + delta('REMOVED-ITEMS', '二、冒烟测试用例', '- SMOKE-core-03 — 退役'),
    ];
    for (const d of legalDeltas) {
      expect(evaluateDeltaConservation(d, SMOKE_TARGET)).toEqual([]);
      expect(validateMarkdownDelta(d).missingSectionMarker).toBe(false);
      expect(validateMarkdownDelta(d).templateSkeleton).toBe(false);
    }
    // L1–L7 行为锚：无 delta 的干净提案 checks 含 L8（0 违规）且整体 PASS
    const { root, slug, dir } = setupProject();
    const result = runChangeLint(root, dir, slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.violations).toEqual([]);
    expect(result.checks.find(c => c.id === 8)?.violations).toBe(0);
  });
});

/* ========== ST — 真实 CLI 端到端 ========== */

describe('S37 — ST 场景测试', () => {
  const BAD_DELTA = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-07'));
  const PAIRED_DELTA = delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-07'))
    + delta('REMOVED-ITEMS', '二、冒烟测试用例', '- SMOKE-core-03 — 构建流程重构，检查项退役');

  it('ST-S37-01: change-lint 端到端拦截——exit 2、L8 违规与 fix_hint、JSON code 属闭合枚举', { timeout: 120_000 }, () => {
    const { root } = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: BAD_DELTA, target: { rel: SMOKE_REL, content: SMOKE_TARGET } });
    const r = spawnCli(root, ['change-lint']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('delta_implicit_id_removal');
    expect(r.stdout).toContain('SMOKE-core-03');
    expect(r.stdout).toMatch(/✗ L8/);
    const j = spawnCli(root, ['change-lint', '--format', 'json']);
    expect(j.status).toBe(2);
    const env = JSON.parse(j.stdout.trim());
    expect(env.data.pass).toBe(false);
    for (const v of env.data.violations) {
      expect(CHANGE_LINT_VIOLATION_CODES).toContain(v.code);
    }
  });

  it('ST-S37-02: merge 端到端拒绝——非零退出、不生成 MERGE_PROMPT、不写任何 marker；空锚物质变更同拒（code-r1 F2）；同锚多写者同拒（code-r1 F1）', { timeout: 120_000 }, () => {
    const { root, slug, dir } = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: BAD_DELTA, target: { rel: SMOKE_REL, content: SMOKE_TARGET } });
    const r = spawnCli(root, ['merge', slug]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('守恒');
    expect(r.stderr).toContain('delta_implicit_id_removal');
    expect(existsSync(join(dir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(dir, 'MERGE_PROMPT_GENERATED'))).toBe(false);
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(false);
    // code-r1 F2：`## MODIFIED` 空锚物质变更——lint exit 2 + merge 拒绝（不生成 MERGE_PROMPT/marker）
    const bare = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: `## MODIFIED\n\n${table('SMOKE-core-01')}\n`, target: { rel: SMOKE_REL, content: SMOKE_TARGET } });
    const lintBare = spawnCli(bare.root, ['change-lint']);
    expect(lintBare.status).toBe(2);
    expect(lintBare.stdout).toContain('delta_section_anchor_unresolvable');
    const mergeBare = spawnCli(bare.root, ['merge', bare.slug]);
    expect(mergeBare.status).toBe(1);
    expect(existsSync(join(bare.dir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(bare.dir, 'SPEC_MERGED'))).toBe(false);
    // code-r3 F3：历史引用子节克隆双列表背书删除——lint exit 2 + merge 拒绝（三层锁定之 CLI 两层）
    const cloneTarget = '# smoke 规格\n\n## 场景地图\n| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | b |\n';
    const cloneDelta = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n\n### 历史引用\n\n| 编号 | 场景名称 |\n| --- | --- |\n| S05 | 仅作历史引用 |');
    const clone = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: cloneDelta, target: { rel: SMOKE_REL, content: cloneTarget } });
    const lintClone = spawnCli(clone.root, ['change-lint']);
    expect(lintClone.status).toBe(2);
    expect(lintClone.stdout).toContain('delta_implicit_id_removal');
    const mergeClone = spawnCli(clone.root, ['merge', clone.slug]);
    expect(mergeClone.status).toBe(1);
    expect(existsSync(join(clone.dir, 'MERGE_PROMPT.md'))).toBe(false);
    // code-r4 F3：目标预先含正式条目+历史副本、delta 仅保留历史副本——lint exit 2 + merge 拒绝（三层锁定之 CLI 两层）
    const dualTarget = '# smoke 规格\n\n## 场景地图\n| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | 正式场景 |\n\n### 历史引用\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |\n';
    const dualDelta = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n\n### 历史引用\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |');
    const dual = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: dualDelta, target: { rel: SMOKE_REL, content: dualTarget } });
    const lintDual = spawnCli(dual.root, ['change-lint']);
    expect(lintDual.status).toBe(2);
    expect(lintDual.stdout).toContain('delta_implicit_id_removal');
    const mergeDual = spawnCli(dual.root, ['merge', dual.slug]);
    expect(mergeDual.status).toBe(1);
    expect(existsSync(join(dual.dir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(dual.dir, 'MERGE_PROMPT_GENERATED'))).toBe(false);
    // code-r5 F3：同一标题子路径下的正式表与历史快照表（仅普通文本分隔）——lint exit 2 + merge 拒绝（三层锁定之 CLI 两层）
    const sameSubTarget = '# smoke 规格\n\n## 场景地图\n| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | 正式场景 |\n\n历史快照：\n\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |\n';
    const sameSubDelta = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n\n历史快照：\n\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |');
    const sameSub = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: sameSubDelta, target: { rel: SMOKE_REL, content: sameSubTarget } });
    const lintSameSub = spawnCli(sameSub.root, ['change-lint']);
    expect(lintSameSub.status).toBe(2);
    expect(lintSameSub.stdout).toContain('delta_implicit_id_removal');
    const mergeSameSub = spawnCli(sameSub.root, ['merge', sameSub.slug]);
    expect(mergeSameSub.status).toBe(1);
    expect(existsSync(join(sameSub.dir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(sameSub.dir, 'MERGE_PROMPT_GENERATED'))).toBe(false);
    // 正例锁定：同子路径双表**全量保留**时 lint 放行（exit 0，L8 守恒通过），证明修法不误伤合法单写者
    const keepSameSubDelta = delta('MODIFIED', '场景地图',
      '| 编号 | 场景名称 |\n|---|---|\n| S01 | a |\n| S05 | 正式场景 |\n\n历史快照：\n\n| 编号 | 场景名称 |\n|---|---|\n| S05 | 历史快照 |');
    const keepSameSub = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: keepSameSubDelta, target: { rel: SMOKE_REL, content: sameSubTarget } });
    const lintKeep = spawnCli(keepSameSub.root, ['change-lint']);
    expect(lintKeep.stdout).not.toContain('delta_implicit_id_removal');
    // code-r1 F1：同锚多重 MODIFIED（先全量后缩水）——lint exit 2 + merge 拒绝
    const multi = setupProject({
      deltaRel: SMOKE_DELTA_REL,
      deltaContent: delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01', 'SMOKE-core-03', 'SMOKE-core-07'))
        + delta('MODIFIED', '二、冒烟测试用例', table('SMOKE-core-01')),
      target: { rel: SMOKE_REL, content: SMOKE_TARGET },
    });
    expect(spawnCli(multi.root, ['change-lint']).status).toBe(2);
    const mergeMulti = spawnCli(multi.root, ['merge', multi.slug]);
    expect(mergeMulti.status).toBe(1);
    expect(mergeMulti.stderr).toContain('MODIFIED 写者');
    expect(existsSync(join(multi.dir, 'MERGE_PROMPT.md'))).toBe(false);
  });

  it('ST-S37-03: 部分删除端到端落地（F1）——merge 放行后实际应用，仅点名条目消失、其余保留、事后点数相符', { timeout: 120_000 }, () => {
    const { root, slug, dir } = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: PAIRED_DELTA, target: { rel: SMOKE_REL, content: SMOKE_TARGET } });
    expect(spawnCli(root, ['change-lint']).status).toBe(0);
    const r = spawnCli(root, ['merge', slug]);
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, 'MERGE_PROMPT.md'))).toBe(true);
    // 按 merge-executor 协议应用：MODIFIED 整节替换（REMOVED-ITEMS 纯声明、不执行编辑）
    const targetPath = join(root, SMOKE_REL);
    const before = readFileSync(targetPath, 'utf-8');
    const beforeIds = extractStructuredTestIds(before);
    const lines = before.split('\n');
    const start = lines.findIndex(l => l.trim() === '## 二、冒烟测试用例');
    expect(start).toBeGreaterThan(-1);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i])) { end = i; break; }
    }
    const replacement = ['## 二、冒烟测试用例', '', table('SMOKE-core-01', 'SMOKE-core-07'), ''];
    writeFileSync(targetPath, [...lines.slice(0, start), ...replacement, ...lines.slice(end)].join('\n'));
    const after = readFileSync(targetPath, 'utf-8');
    const afterIds = extractStructuredTestIds(after);
    expect(after).toContain('## 二、冒烟测试用例'); // 章节仍在
    expect(afterIds).toContain('SMOKE-core-01');
    expect(afterIds).toContain('SMOKE-core-07');
    expect(afterIds).not.toContain('SMOKE-core-03'); // 仅点名条目消失
    // 事后点数公式：合并后 == 合并前 − REMOVED-ITEMS 点名 + 新增(0)
    expect(afterIds.length).toBe(beforeIds.length - 1);
  });

  it('ST-S37-04: 歧义锚端到端拒绝（F3）——单段锚拒绝，标题路径锚放行', { timeout: 120_000 }, () => {
    const single = delta('MODIFIED', '二、冒烟测试用例补充', table('SMOKE-core-31', 'SMOKE-core-32'));
    const { root, slug, dir } = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: single, target: { rel: SMOKE_REL, content: DUP_TARGET } });
    const r = spawnCli(root, ['change-lint']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('delta_section_anchor_unresolvable');
    expect(spawnCli(root, ['merge', slug]).status).toBe(1);
    // 改标题路径锚 → 放行
    writeFileSync(join(dir, SMOKE_DELTA_REL),
      delta('MODIFIED', '四、runner 覆盖冒烟用例 > 二、冒烟测试用例补充', table('SMOKE-core-31', 'SMOKE-core-32')));
    expect(spawnCli(root, ['change-lint']).status).toBe(0);
    expect(spawnCli(root, ['merge', slug]).status).toBe(0);
  });

  it('ST-S37-05: 合法提案零漂移——纯 ADDED delta lint 全过、merge 正常生成 MERGE_PROMPT', { timeout: 120_000 }, () => {
    const legal = delta('ADDED', '三、新增冒烟用例', table('SMOKE-core-99'));
    const { root, slug, dir } = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: legal, target: { rel: SMOKE_REL, content: SMOKE_TARGET } });
    const r = spawnCli(root, ['change-lint']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('✓ L8 条目守恒');
    const m = spawnCli(root, ['merge', slug]);
    expect(m.status).toBe(0);
    expect(existsSync(join(dir, 'MERGE_PROMPT.md'))).toBe(true);
  });

  it('ST-S37-06: 只读性——change-lint 运行前后项目全量文件集合与内容哈希不变', { timeout: 120_000 }, () => {
    const { root } = setupProject({ deltaRel: SMOKE_DELTA_REL, deltaContent: BAD_DELTA, target: { rel: SMOKE_REL, content: SMOKE_TARGET } });
    const before = snapshotTree(root);
    expect(spawnCli(root, ['change-lint']).status).toBe(2);
    expect(spawnCli(root, ['change-lint', '--format', 'json']).status).toBe(2);
    const after = snapshotTree(root);
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort());
  });
});
