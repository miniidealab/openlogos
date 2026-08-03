/**
 * S38 — 决策记录沉淀能力（decision-record-capability）。
 * 用例 ID 与 logos/resources/test/core-S38-test-cases.md 严格对齐（UT-S38-01..19 含 16a / ST-S38-01..07）。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import {
  computeDecisionRecordWarnings, evaluateDeltaConservation, ID_PATTERN_REGISTRY,
} from '../src/lib/change-lint.js';
import { allocateDecisionRecordIds, parseDecisionFilenameDxx, applyDecisionRecords, DECISION_APPLY_JOURNAL } from '../src/lib/decision-record.js';
import { DELTA_TO_RESOURCE } from '../src/lib/delta-classify.js';
import { readProjectYaml } from '../src/lib/project-yaml.js';
import { scanCandidateFiles, inferResourceDesc } from '../src/lib/sync-resource-index.js';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const CLI_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
function spawnCli(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args], { cwd, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

interface ProjOpts {
  decisionSection?: boolean;        // proposal 是否含「已确定的设计决策」章节
  decisionsDeltaTask?: boolean;     // tasks [delta] 是否含 deltas/decisions/ 任务
  extraDelta?: { rel: string; content: string };  // 额外 delta（触发 violation 等）
  decisionsDelta?: { rel: string; content: string }; // deltas/decisions/ 实际文件
}

/** 搭一个 launched 项目 + 活跃提案（feat），按 opts 控制决策章节 / decisions delta。 */
function setupProj(o: ProjOpts = {}): { root: string; slug: string; dir: string } {
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
  const proposal = [
    '# 变更提案：feat', '', '> module: core', '',
    '## 变更原因', '需要新能力。', '', '## 变更类型', '设计级变更', '',
    ...(o.decisionSection ? ['## 已确定的设计决策', '- D07 选 X 而非 Y，因为不变量约束。', ''] : []),
    '## 部署影响', '- 是否需要部署：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '需要 CLI 代码、测试和 reporter 实现。',
  ].join('\n');
  writeFileSync(join(dir, 'proposal.md'), proposal);
  const deltaTasks = ['- [ ] 产出 delta 到 `deltas/test/` — 更新用例'];
  if (o.decisionsDeltaTask) deltaTasks.push('- [ ] 产出 delta 到 `deltas/decisions/core-D07-x.md` — 决策记录');
  writeFileSync(join(dir, 'tasks.md'), `# 任务\n\n## [delta] 规格变更\n${deltaTasks.join('\n')}\n\n## [code] 代码实现\n`);
  for (const d of [o.extraDelta, o.decisionsDelta].filter(Boolean) as { rel: string; content: string }[]) {
    const p = join(dir, d.rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, d.content);
  }
  return { root, slug, dir };
}

const parseEnv = (s: string) => JSON.parse(s.trim());

/* ═══════════ 一、UT ═══════════ */

describe('S38 决策记录 — change-lint warning + JSON 契约（UT）', () => {
  const propSection = '## 已确定的设计决策\n- D07 决策。\n';
  const propNoSection = '## 变更概述\n无决策。\n';

  it('UT-S38-01: 决策章节在场 + deltas/decisions 在场 → 无 warning', () => {
    const tasks = '## [delta]\n- [ ] 产出 `deltas/decisions/core-D07-x.md`\n';
    expect(computeDecisionRecordWarnings(propSection, tasks, false)).toEqual([]);
    // 或 delta 条目在场（post-merge）：hasDecisionsDeltaEntry=true 同样无 warning
    expect(computeDecisionRecordWarnings(propSection, '## [delta]\n- [ ] x\n', true)).toEqual([]);
  });

  it('UT-S38-02: 决策章节在场 + 缺 deltas/decisions → 恰 1 条 warning', () => {
    const w = computeDecisionRecordWarnings(propSection, '## [delta]\n- [ ] 产出 `deltas/test/x.md`\n', false);
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe('decision_record_section_without_delta');
    expect(w[0].fix_hint).toContain('deltas/decisions/');
  });

  it('UT-S38-03: 无决策章节 → 零 warning + JSON 不含 warnings 字段（零回归）', () => {
    expect(computeDecisionRecordWarnings(propNoSection, '## [delta]\n- [ ] x\n', false)).toEqual([]);
    const { root } = setupProj({ decisionSection: false });
    const r = spawnCli(root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    const env = parseEnv(r.stdout);
    expect(Object.prototype.hasOwnProperty.call(env.data, 'warnings')).toBe(false); // 空时整字段省略
  });

  it('UT-S38-04: warning 走独立通道、item 闭合字段、不进 violations 枚举', () => {
    const { root } = setupProj({ decisionSection: true, decisionsDeltaTask: false });
    const r = spawnCli(root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    expect(r.status).toBe(0);
    const env = parseEnv(r.stdout);
    expect(env.data.pass).toBe(true);
    expect(env.data.warnings).toHaveLength(1);
    expect(Object.keys(env.data.warnings[0]).sort()).toEqual(['code', 'fix_hint', 'message']); // 闭合三字段、无 path
    expect(env.data.warnings[0].code).toBe('decision_record_section_without_delta');
    expect((env.data.violations as { code: string }[]).some(v => v.code === 'decision_record_section_without_delta')).toBe(false);
  });

  it('UT-S38-05: warning + violation 并存 envelope（各自独立、互不混入）', () => {
    // 决策章节但缺 deltas/decisions → warning；同时放一个未知类别 delta → L6 delta_path_invalid（pass:false）
    const { root } = setupProj({ decisionSection: true, decisionsDeltaTask: false, extraDelta: { rel: 'deltas/bogus/x.md', content: '## ADDED — x\n内容\n' } });
    const r = spawnCli(root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    expect(r.status).toBe(2);
    const env = parseEnv(r.stdout);
    expect(env.data.pass).toBe(false);
    expect((env.data.violations as { code: string }[]).some(v => v.code === 'delta_path_invalid')).toBe(true);
    expect(env.data.warnings).toHaveLength(1);
    expect(env.data.warnings[0].code).toBe('decision_record_section_without_delta'); // 两数组各自独立
  });

  it('UT-S38-06: 多条 warning 稳定排序（当前单 code，排序为恒等且重复运行一致）', () => {
    const a = computeDecisionRecordWarnings(propSection, '## [delta]\n- [ ] x\n', false);
    const b = computeDecisionRecordWarnings(propSection, '## [delta]\n- [ ] x\n', false);
    expect(a).toEqual(b); // 确定性
  });

  it('UT-S38-02a: [code] 段提及 deltas/decisions/ 不抑制 warning — 扫描收敛到 [delta] 段（code-r1 F3）', () => {
    // [delta] 段只规划测试文件；deltas/decisions/ 仅出现在 [code] 段说明文字里 → 非权威任务 → warning 仍在
    const tasks = [
      '## [delta] 规格变更', '- [ ] 产出 `deltas/test/x.md`', '',
      '## [code] 代码实现', '- [ ] 实现 deltas/decisions/core-D07-x.md 的落盘逻辑',
    ].join('\n');
    const w = computeDecisionRecordWarnings(propSection, tasks, false);
    expect(w).toHaveLength(1);
    expect(w[0].code).toBe('decision_record_section_without_delta');
  });

  it('UT-S38-02b: [delta] 段内普通说明 / HTML 注释 / 围栏示例提及 deltas/decisions/ 均不抑制 warning（code-r2 F3）', () => {
    // 三组反例：路径都出现在 [delta] 段内，但均非结构化任务项 → 仍应产 warning
    const prose = [
      '## [delta] 规格变更', '- [ ] 只更新 `deltas/test/x.md`',
      '', '说明：本案不要创建 deltas/decisions/，该路径仅作解释。',
    ].join('\n');
    const htmlComment = [
      '## [delta] 规格变更', '- [ ] 只更新 `deltas/test/x.md`',
      '<!-- - [ ] 产出 deltas/decisions/core-D07-x.md（注释掉，不算数） -->',
    ].join('\n');
    const fenced = [
      '## [delta] 规格变更', '- [ ] 只更新 `deltas/test/x.md`',
      '', '```markdown', '- [ ] 产出 deltas/decisions/core-D07-x.md', '```',
    ].join('\n');
    for (const tasks of [prose, htmlComment, fenced]) {
      const w = computeDecisionRecordWarnings(propSection, tasks, false);
      expect(w).toHaveLength(1);
      expect(w[0].code).toBe('decision_record_section_without_delta');
    }
  });

  it('UT-S38-03a: 围栏内示例 `## 已确定的设计决策` 不触发 warning — fence-aware 章节判定（code-r1 F3）', () => {
    const fenced = ['# 提案', '', '```markdown', '## 已确定的设计决策', '- 文档示例、非真实章节', '```', ''].join('\n');
    expect(computeDecisionRecordWarnings(fenced, '## [delta]\n- [ ] 产出 `deltas/test/x.md`\n', false)).toEqual([]);
    // 真实（围栏外）决策章节仍照常触发
    const real = ['# 提案', '', '## 已确定的设计决策', '- 真实决策', ''].join('\n');
    expect(computeDecisionRecordWarnings(real, '## [delta]\n- [ ] 产出 `deltas/test/x.md`\n', false)).toHaveLength(1);
  });
});

describe('S38 决策记录 — DXX 守恒（复用 S37 判据，UT）', () => {
  const T = ['# t', '', '## 决策索引', '### D07 旧决策', '内容', '### D12 新决策', '内容', ''].join('\n');
  const codesOf = (vs: { code: string }[]) => vs.map(v => v.code);

  it('UT-S38-07: DXX 入注册表被识别 — MODIFIED 缺 D07 且无点名 → delta_implicit_id_removal', () => {
    expect(ID_PATTERN_REGISTRY.decisionHeading.exec('D07 旧决策')?.[1]).toBe('D07');
    const d = '## MODIFIED — 决策索引\n### D12 新决策\n内容\n';
    const vs = evaluateDeltaConservation(d, T);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
    expect(vs[0].message).toContain('D07');
  });

  it('UT-S38-08: MODIFIED 携全部 DXX → 守恒通过', () => {
    const d = '## MODIFIED — 决策索引\n### D07 旧决策\n内容\n### D12 新决策\n内容\n';
    expect(evaluateDeltaConservation(d, T)).toEqual([]);
  });

  it('UT-S38-09: superseded 流转不触发守恒（D07 标题仍在、仅状态变）', () => {
    const d = '## MODIFIED — 决策索引\n### D07 旧决策（superseded by D12）\n内容\n### D12 新决策\n内容\n';
    expect(evaluateDeltaConservation(d, T)).toEqual([]);
  });

  it('UT-S38-10: 决策记录显式删除（REMOVED-ITEMS 点名 D07）→ 守恒通过', () => {
    const d = '## MODIFIED — 决策索引\n### D12 新决策\n内容\n\n## REMOVED-ITEMS — 决策索引\n- D07 — 被 D12 取代\n';
    expect(evaluateDeltaConservation(d, T)).toEqual([]);
  });

  it('UT-S38-07a: DXX 决策表首列结构位置入守恒 — MODIFIED 表缺 D07 且无点名 → delta_implicit_id_removal（code-r1 F1）', () => {
    // 首列表头「编号」的决策索引表：首列 DXX 是结构位置（feature-spec §2.34.2「首列结构位置携带的 DXX」）
    const tableTarget = [
      '# 决策记录', '', '## 决策索引', '',
      '| 编号 | 决策 | 状态 |', '|----|----|----|',
      '| D07 | 旧决策 | superseded |', '| D12 | 新决策 | accepted |', '',
    ].join('\n');
    const drop = [
      '## MODIFIED — 决策索引', '',
      '| 编号 | 决策 | 状态 |', '|----|----|----|',
      '| D12 | 新决策 | accepted |', '',
    ].join('\n');
    const vs = evaluateDeltaConservation(drop, tableTarget);
    expect(codesOf(vs)).toEqual(['delta_implicit_id_removal']);
    expect(vs[0].message).toContain('D07');
    // 正例：MODIFIED 携全部表行 → 守恒通过（证明表首列确进入注册表、非旁路）
    const keepAll = [
      '## MODIFIED — 决策索引', '',
      '| 编号 | 决策 | 状态 |', '|----|----|----|',
      '| D07 | 旧决策 | superseded |', '| D12 | 新决策 | accepted |', '',
    ].join('\n');
    expect(evaluateDeltaConservation(keepAll, tableTarget)).toEqual([]);
    // 显式删除（REMOVED-ITEMS 点名）合法
    const explicitRemove = [
      '## MODIFIED — 决策索引', '',
      '| 编号 | 决策 | 状态 |', '|----|----|----|',
      '| D12 | 新决策 | accepted |', '',
      '## REMOVED-ITEMS — 决策索引', '- D07 — 被 D12 取代', '',
    ].join('\n');
    expect(evaluateDeltaConservation(explicitRemove, tableTarget)).toEqual([]);
  });
});

describe('S38 决策记录 — DXX 分配公式与计数器（UT，delta-r2 F5 基准只含已落盘）', () => {
  const cand = (n: number) => ({ filenameDxx: n, titleDxx: n });

  it('UT-S38-11: 基准先扫已落盘最大 DXX（缺失 counter，已有 D03 → base=4/D04）', () => {
    const r = allocateDecisionRecordIds([3], undefined, [cand(4)]);
    expect(r.base).toBe(4);
    expect(r.ok).toBe(true);
    expect(r.allocations).toEqual([4]);
  });

  it('UT-S38-12: stale counter（next_id=2 但已落盘 D05 → base=6/D06）', () => {
    const r = allocateDecisionRecordIds([5], 2, [cand(6)]);
    expect(r.base).toBe(6);
    expect(r.ok).toBe(true);
    expect(r.allocations).toEqual([6]);
  });

  it('UT-S38-13: 拟定 DXX 与既有资源重复 → 拒绝（不覆盖既有）', () => {
    // 已落盘 D03，候选拟号 D03：base=4，expected_0=4，filename 3 ≠ 4 → 拒绝
    const r = allocateDecisionRecordIds([3], undefined, [cand(3)]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('不一致');
  });

  it('UT-S38-14: 一案多条连续分配（next_id=7、无更大已落盘 → D07/D08、next_id=9）', () => {
    const r = allocateDecisionRecordIds([], 7, [cand(7), cand(8)]);
    expect(r.ok).toBe(true);
    expect(r.allocations).toEqual([7, 8]);
    expect(r.persistedNextId).toBe(9);
  });

  it('UT-S38-15: 文件名 ≠ 标题 ≠ expected → 拒绝', () => {
    const r = allocateDecisionRecordIds([], 7, [{ filenameDxx: 7, titleDxx: 9 }]);
    expect(r.ok).toBe(false);
  });

  it('UT-S38-16: 正例 — 拟定号 == expected（next_id=7 → D07、next_id=8）', () => {
    const r = allocateDecisionRecordIds([], 7, [cand(7)]);
    expect(r.ok).toBe(true);
    expect(r.allocations).toEqual([7]);
    expect(r.persistedNextId).toBe(8);
  });

  it('UT-S38-16a: 首条合法记录不被自拒（资源空、next_id=1、拟号 D01 → base=1/D01，delta-r2 F5）', () => {
    const r = allocateDecisionRecordIds([], 1, [cand(1)]);
    expect(r.base).toBe(1);            // 基准不含本批 → 不是 max(1,1+1)=2
    expect(r.ok).toBe(true);
    expect(r.allocations).toEqual([1]); // D01，不被算成 D02 后自拒
    expect(r.persistedNextId).toBe(2);
    // 缺失 counter 亦同
    expect(allocateDecisionRecordIds([], undefined, [cand(1)]).allocations).toEqual([1]);
    // 文件名解析 helper
    expect(parseDecisionFilenameDxx('core-D01-decision-record-capability.md')).toBe(1);
  });

  it('UT-S38-17: project-yaml 只读取侧解析 decision_counter（无取号 / 写 helper）', async () => {
    const { root } = setupProj();
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      decision_counter: { next_id: 5 },
    }, { lineWidth: 0 }));
    const res = readProjectYaml(root);
    expect(res.data?.decision_counter?.next_id).toBe(5);
    // 缺字段 → undefined（视为未配置）
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }, { lineWidth: 0 }));
    expect(readProjectYaml(root).data?.decision_counter).toBeUndefined();
    // 回归锚：project-yaml 源码不含决策取号 / 写 helper（CLI 不取号；分配公式在独立 decision-record.ts）
    const src = (await import('node:fs')).readFileSync(join(CLI_ROOT, 'src', 'lib', 'project-yaml.ts'), 'utf-8');
    expect(/allocateDecision|nextDecisionId|writeDecisionCounter|function\s+\w*[Dd]ecision\w*Counter\s*\([^)]*\):\s*\w+\s*\{[^}]*next_id\s*=/.test(src)).toBe(false);
    // 分配公式的单一事实源在 decision-record.ts（不在 project-yaml）
    const drSrc = (await import('node:fs')).readFileSync(join(CLI_ROOT, 'src', 'lib', 'decision-record.ts'), 'utf-8');
    expect(drSrc).toContain('allocateDecisionRecordIds');
  });
});

describe('S38 决策记录 — resource_index 扫描器扩展（UT）', () => {
  it('UT-S38-18: scanCandidateFiles 纳入 decisions/', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const dDir = join(root, 'logos', 'resources', 'decisions');
      mkdirSync(dDir, { recursive: true });
      writeFileSync(join(dDir, 'core-D01-x.md'), '# D01：x\n');
      const files = scanCandidateFiles(root);
      expect(files).toContain('logos/resources/decisions/core-D01-x.md');
    } finally { cleanup(); }
  });

  it('UT-S38-19: inferResourceDesc 对 DXX 生成内容化 desc（非空、非通用兜底）', () => {
    const desc = inferResourceDesc('logos/resources/decisions/core-D01-decision-record-capability.md', 'zh');
    expect(desc).toBeTruthy();
    expect(desc).toContain('D01');
    expect(desc).toContain('决策记录');
  });
});

/* ═══════════ 二、ST（真实 CLI 端到端） ═══════════ */

describe('S38 决策记录 — CLI 端到端（ST）', () => {
  it('ST-S38-01: 决策章节缺 deltas → change-lint warning、exit 0、JSON warnings 在场', () => {
    const { root } = setupProj({ decisionSection: true, decisionsDeltaTask: false });
    const text = spawnCli(root, ['change-lint', '--slug', 'feat']);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('⚠ 决策记录');
    expect(text.stdout).toMatch(/PASS（/);
    const j = spawnCli(root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    const env = parseEnv(j.stdout);
    expect(env.data.pass).toBe(true);
    expect(env.data.warnings[0].code).toBe('decision_record_section_without_delta');
    expect(env.data.violations).toEqual([]);
  });

  it('ST-S38-02: 补齐后 warning 消失；无决策提案 JSON 无 warnings 字段（零回归）', () => {
    const withDelta = setupProj({ decisionSection: true, decisionsDeltaTask: true });
    const r1 = spawnCli(withDelta.root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    expect(r1.status).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(parseEnv(r1.stdout).data, 'warnings')).toBe(false);
    const noSec = setupProj({ decisionSection: false });
    const r2 = spawnCli(noSec.root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    expect(Object.prototype.hasOwnProperty.call(parseEnv(r2.stdout).data, 'warnings')).toBe(false);
  });

  it('ST-S38-03: 决策记录经生产 apply 入口完整落盘 + 计数器持久化 + 索引更新 + SPEC_MERGED（delta-r1 F2 / code-r2 F2）', () => {
    // 七段 ADR 结构：状态 / 背景 / 决策 / 理由 / 备选方案 / 影响面 / 来源
    const adrBody = [
      '# D01：决策记录沉淀位置定于顶层 decisions/', '',
      '- 状态：accepted', '',
      '## 背景', '决策理由过去只沉淀在 archive 的 proposal，归档即失联。', '',
      '## 决策', '在 logos/resources/decisions/ 建立 ADR 变体决策记录。', '',
      '## 理由', '单一目录使 AI 只需看一处、直接可检索。', '',
      '## 备选方案', '放 prd/1-product-requirements/proposals/——名与变更提案相撞，否。', '',
      '## 影响面', '约束 change-writer / merge-executor / change-lint。', '',
      '## 来源', 'decision-record-capability（issue #12）。', '',
    ].join('\n');
    const decRel = 'core-D01-decision-record-capability.md';
    const { root, dir } = setupProj({
      decisionSection: true, decisionsDeltaTask: true,
      decisionsDelta: { rel: `deltas/decisions/${decRel}`, content: `## ADDED — core-D01（全新决策记录）\n\n${adrBody}` },
    });
    const decDoc = join(root, 'logos', 'resources', 'decisions', decRel);
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    // 前置项目状态（apply 须读取并保留）：已有 resource_index（含一条既有项）、无 decision_counter、无决策文档
    writeFileSync(yamlPath, [
      'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', '    product_type: cli',
      'resource_index:', '  - path: logos/logos-project.yaml', '    desc: 项目索引', '',
    ].join('\n'));

    // ── 阶段一：openlogos merge 只校验 + 生成 prompt，绝不落盘资源、不写 SPEC_MERGED（merge 不是落盘者）──
    const merge = spawnCli(root, ['merge', 'feat']);
    expect(merge.status).toBe(0);
    expect(existsSync(join(dir, 'MERGE_PROMPT.md'))).toBe(true);
    expect(existsSync(decDoc)).toBe(false);
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(false);

    // ── 阶段二：调用生产 apply 入口。测试只准备输入（delta + 现有 YAML）并调用；被验证产物
    //    （主文档 / counter / index / SPEC_MERGED）全部由生产代码从真实 delta 解析并产出、测试不自行写出。──
    const r = applyDecisionRecords(root, dir, 'zh');
    expect(r.ok).toBe(true);
    expect(r.applied).toEqual([{ file: decRel, dxx: 1, op: 'ADDED' }]); // 空资源 + 未配置 counter → base=1、拟号 D01（不被自拒）
    expect(r.persistedNextId).toBe(2);

    // ── 落盘契约断言（产物均由 apply 生产，非测试写出）──
    const landed = readFileSync(decDoc, 'utf-8');
    for (const seg of ['状态', '背景', '决策', '理由', '备选方案', '影响面', '来源']) expect(landed).toContain(seg);
    expect(landed).toContain('单一目录使 AI 只需看一处'); // 正文确来自 delta ADDED 块解析、非测试重写
    expect(readProjectYaml(root).data?.decision_counter?.next_id).toBe(2); // 持久化 = max(已落盘 DXX)+1
    const riOf = () => (parseYaml(readFileSync(yamlPath, 'utf-8')).resource_index ?? []) as { path: string; desc?: string }[];
    const entry = riOf().find(e => e.path === `logos/resources/decisions/${decRel}`);
    expect(entry?.desc).toContain('D01'); // resource_index 更新 + 内容化 desc（走权威 sync 路径）
    expect(riOf().some(e => e.path === 'logos/logos-project.yaml')).toBe(true); // 既有 YAML 内容被保留
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true); // marker 最后才写

    // ── 幂等：再次 apply → 无操作、counter 不再前移、索引不重复 ──
    const r2 = applyDecisionRecords(root, dir, 'zh');
    expect(r2.ok).toBe(true);
    expect(r2.applied).toEqual([]);
    expect(readProjectYaml(root).data?.decision_counter?.next_id).toBe(2);
    expect(riOf().filter(e => e.path === `logos/resources/decisions/${decRel}`)).toHaveLength(1);

    // ── 失败注入（零半状态）：空资源 + 未配置 counter 下拟号 D07（≠ 应分配 D01）→ apply 拒绝、不落盘、不动 counter/marker ──
    const bad = setupProj({
      decisionSection: true, decisionsDeltaTask: true,
      decisionsDelta: { rel: 'deltas/decisions/core-D07-x.md', content: '## ADDED — core-D07-x\n\n# D07：错号决策\n\n- 状态：accepted\n' },
    });
    const rf = applyDecisionRecords(bad.root, bad.dir, 'zh');
    expect(rf.ok).toBe(false);
    expect(rf.error).toContain('不一致'); // base=1 → expected D01，D07 拒
    expect(existsSync(join(bad.root, 'logos', 'resources', 'decisions', 'core-D07-x.md'))).toBe(false); // 未落盘
    expect(readProjectYaml(bad.root).data?.decision_counter).toBeUndefined(); // counter 未消耗
    expect(existsSync(join(bad.dir, 'SPEC_MERGED'))).toBe(false); // marker 未写
  });

  it('ST-S38-04: 决策记录隐式删除被 merge 拒绝（复用 S37 消费点）', () => {
    const target = ['# t', '', '## 决策索引', '### D07 旧决策', '内容', ''].join('\n');
    const { root, dir } = setupProj();
    // 落一个既有决策主文档 + 一个隐式删 D07 的 delta
    const decDir = join(root, 'logos', 'resources', 'decisions');
    mkdirSync(decDir, { recursive: true });
    writeFileSync(join(decDir, 'core-D07-x.md'), target);
    const dd = join(dir, 'deltas', 'decisions', 'core-D07-x.md');
    mkdirSync(dirname(dd), { recursive: true });
    writeFileSync(dd, '## MODIFIED — 决策索引\n（无 D07、无点名）\n');
    const merge = spawnCli(root, ['merge', 'feat']);
    expect(merge.status).not.toBe(0);
    expect(existsSync(join(dir, 'MERGE_PROMPT.md'))).toBe(false);
  });

  it('ST-S38-04a: 决策表首列隐式删除被 merge 拒绝（code-r1 F1，真实 CLI 非零退出、不生成 MERGE_PROMPT）', () => {
    const tableTarget = [
      '# 决策记录', '', '## 决策索引', '',
      '| 编号 | 决策 | 状态 |', '|----|----|----|',
      '| D07 | 旧决策 | superseded |', '| D12 | 新决策 | accepted |', '',
    ].join('\n');
    const { root, dir } = setupProj();
    const decDir = join(root, 'logos', 'resources', 'decisions');
    mkdirSync(decDir, { recursive: true });
    writeFileSync(join(decDir, 'core-D07-x.md'), tableTarget);
    const dd = join(dir, 'deltas', 'decisions', 'core-D07-x.md');
    mkdirSync(dirname(dd), { recursive: true });
    writeFileSync(dd, [
      '## MODIFIED — 决策索引', '',
      '| 编号 | 决策 | 状态 |', '|----|----|----|',
      '| D12 | 新决策 | accepted |', '',
    ].join('\n'));
    const merge = spawnCli(root, ['merge', 'feat']);
    expect(merge.status).not.toBe(0);
    expect(existsSync(join(dir, 'MERGE_PROMPT.md'))).toBe(false);
  });

  it('ST-S38-05: 无决策章节提案零回归（change-lint 无 warning、无 warnings 字段、无 decisions/ 落盘）', () => {
    const { root } = setupProj({ decisionSection: false });
    const text = spawnCli(root, ['change-lint', '--slug', 'feat']);
    expect(text.stdout).not.toContain('⚠ 决策记录');
    const j = spawnCli(root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    expect(Object.prototype.hasOwnProperty.call(parseEnv(j.stdout).data, 'warnings')).toBe(false);
    expect(existsSync(join(root, 'logos', 'resources', 'decisions'))).toBe(false);
  });

  it('ST-S38-06: 权威 sync 路径发现决策 + 内容化 desc + 幂等；删 archive 后自足', async () => {
    const { syncResourceIndex } = await import('../src/lib/sync-resource-index.js');
    const { root, cleanup } = makeTempRoot();
    try {
      scaffoldProject(root, { locale: 'zh' });
      // resource_index 作为最后一个 key（appendToResourceIndex 追加到文件末尾，真实 yaml 同此结构）
      writeFileSync(join(root, 'logos', 'logos-project.yaml'),
        'modules:\n  - id: core\n    name: Core\n    lifecycle: launched\nresource_index:\n  - path: logos/logos-project.yaml\n    desc: 项目索引\n');
      const decDir = join(root, 'logos', 'resources', 'decisions');
      mkdirSync(decDir, { recursive: true });
      writeFileSync(join(decDir, 'core-D01-x.md'), '# D01：决策\n- 状态：accepted\n');
      const riOf = () => (parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')).resource_index ?? []) as { path: string; desc?: string }[];
      syncResourceIndex(root, 'zh');
      const entry1 = riOf().find(e => e.path === 'logos/resources/decisions/core-D01-x.md');
      expect(entry1).toBeTruthy();
      expect(entry1?.desc).toContain('D01');
      // 幂等
      syncResourceIndex(root, 'zh');
      const entry2 = riOf().find(e => e.path === 'logos/resources/decisions/core-D01-x.md');
      expect(entry2?.desc).toBe(entry1?.desc);
      // 删 archive 后决策仍在（自足性）
      const archive = join(root, 'logos', 'changes', 'archive');
      mkdirSync(archive, { recursive: true });
      rmSync(archive, { recursive: true, force: true });
      expect(existsSync(join(decDir, 'core-D01-x.md'))).toBe(true);
    } finally { cleanup(); }
  });

  it('ST-S38-07: 类别注册解自举死锁 — deltas/decisions/ 判 mergeable、change-lint exit 0', () => {
    expect(DELTA_TO_RESOURCE['decisions']).toBe('logos/resources/decisions');
    const { root } = setupProj({
      decisionSection: true, decisionsDeltaTask: true,
      decisionsDelta: { rel: 'deltas/decisions/core-D07-x.md', content: '## ADDED — core-D07-x\n\n# D07：某决策\n- 状态：accepted\n' },
    });
    const lint = spawnCli(root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    expect(lint.status).toBe(0);
    const env = parseEnv(lint.stdout);
    // L6 delta 路径合法：无 delta_path_invalid（decisions 已是合法类别）
    expect((env.data.violations as { code: string }[]).some(v => v.code === 'delta_path_invalid')).toBe(false);
  });

  it('ST-S38-08: 围栏内决策示例 + [code] 段路径提及 → change-lint 无 warning 误报（code-r1 F3，真实 CLI）', () => {
    const { root, dir } = setupProj({ decisionSection: false });
    // 决策章节只出现在围栏示例内（非真实标题）；deltas/decisions/ 仅出现在 [code] 段
    writeFileSync(join(dir, 'proposal.md'), [
      '# 变更提案：feat', '', '> module: core', '',
      '## 变更原因', '需要能力。', '', '## 变更类型', '设计级变更', '',
      '```markdown', '## 已确定的设计决策', '- 这是模板示例、非本提案的真实决策章节', '```', '',
      '## 部署影响', '- 是否需要部署：否', '- 是否需要 smoke：否', '',
    ].join('\n'));
    writeFileSync(join(dir, 'tasks.md'), [
      '# 任务', '', '## [delta] 规格变更', '- [ ] 产出 `deltas/test/x.md`', '',
      '## [code] 代码实现', '- [ ] 实现 deltas/decisions/ 落盘逻辑',
    ].join('\n'));
    const j = spawnCli(root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    const env = parseEnv(j.stdout);
    // 围栏内示例不是真实决策章节 → 整个 warnings 字段省略
    expect(Object.prototype.hasOwnProperty.call(env.data, 'warnings')).toBe(false);
  });

  it('ST-S38-09: 真实决策章节 + 仅 [code] 段提及 deltas/decisions/ → warning 仍在（[delta] 段无权威任务，code-r1 F3，真实 CLI）', () => {
    const { root, dir } = setupProj({ decisionSection: true });
    // 覆写 tasks：[delta] 只规划测试；deltas/decisions/ 仅在 [code] 段
    writeFileSync(join(dir, 'tasks.md'), [
      '# 任务', '', '## [delta] 规格变更', '- [ ] 产出 `deltas/test/x.md`', '',
      '## [code] 代码实现', '- [ ] 实现 deltas/decisions/core-D07-x.md 落盘',
    ].join('\n'));
    const j = spawnCli(root, ['change-lint', '--slug', 'feat', '--format', 'json']);
    const env = parseEnv(j.stdout);
    expect(env.data.pass).toBe(true); // warning 不改 exit code
    expect((env.data.warnings as { code: string }[]).some(w => w.code === 'decision_record_section_without_delta')).toBe(true);
  });

  it('ST-S38-10: superseded MODIFIED（保号就地更新）+ 同批 ADDED 新决策一并落盘（code-r3 F2 / 场景 §三 B6）', () => {
    const { root, dir } = setupProj({ decisionSection: true, decisionsDeltaTask: true });
    const decDir = join(root, 'logos', 'resources', 'decisions');
    mkdirSync(decDir, { recursive: true });
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    // 前置：既有 D07=accepted；counter next_id=8；resource_index 种子（apply 须读取并保留）
    writeFileSync(join(decDir, 'core-D07-old.md'),
      ['# D07：旧结论', '', '- 状态：accepted', '', '## 决策', '采用 X。', ''].join('\n'));
    writeFileSync(yamlPath, [
      'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', '    product_type: cli',
      'decision_counter:', '  next_id: 8',
      'resource_index:', '  - path: logos/logos-project.yaml', '    desc: 项目索引',
      '  - path: logos/resources/decisions/core-D07-old.md', '    desc: D07 决策记录', '',
    ].join('\n'));
    const dDir = join(dir, 'deltas', 'decisions');
    mkdirSync(dDir, { recursive: true });
    // MODIFIED：D07 携整条剩余全量、仅把状态改为 superseded by D08（DXX 在场、保号）
    writeFileSync(join(dDir, 'core-D07-old.md'),
      '## MODIFIED — D07：旧结论\n\n' + ['# D07：旧结论', '', '- 状态：superseded by D08', '', '## 决策', '采用 X。', ''].join('\n'));
    // ADDED：同批新增 D08
    writeFileSync(join(dDir, 'core-D08-new.md'),
      '## ADDED — core-D08（全新决策记录）\n\n' + ['# D08：新结论（取代 D07）', '', '- 状态：accepted', '', '## 决策', '改采 Y。', '', '## 来源', 'D07 被本条取代。', ''].join('\n'));

    const r = applyDecisionRecords(root, dir, 'zh');
    expect(r.ok).toBe(true);
    // D07 就地更新保号（MODIFIED，不静默跳过）、D08 新增取号；按 slug 声明序 core-D07-old < core-D08-new
    expect(r.applied).toEqual([
      { file: 'core-D07-old.md', dxx: 7, op: 'MODIFIED' },
      { file: 'core-D08-new.md', dxx: 8, op: 'ADDED' },
    ]);
    const landed07 = readFileSync(join(decDir, 'core-D07-old.md'), 'utf-8');
    expect(landed07).toContain('superseded by D08');       // 状态确被更新
    expect(landed07).not.toContain('- 状态：accepted');     // 旧状态不再残留（不是 no-op）
    expect(readFileSync(join(decDir, 'core-D08-new.md'), 'utf-8')).toContain('改采 Y'); // D08 落盘
    expect(readProjectYaml(root).data?.decision_counter?.next_id).toBe(9); // base=8、ADDED 1 条 → 9
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true);
  });

  it('ST-S38-11: apply 事务中途失败回滚零半状态、复权后重试完整成功（code-r3 F2 失败回滚 + 重试幂等）', () => {
    const { root, dir } = setupProj({
      decisionSection: true, decisionsDeltaTask: true,
      decisionsDelta: { rel: 'deltas/decisions/core-D01-x.md', content: '## ADDED — core-D01-x\n\n# D01：某决策\n\n- 状态：accepted\n\n## 决策\n采用 X。\n' },
    });
    const decDir = join(root, 'logos', 'resources', 'decisions');
    const decDoc = join(decDir, 'core-D01-x.md');
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    writeFileSync(yamlPath, [
      'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', '    product_type: cli',
      'resource_index:', '  - path: logos/logos-project.yaml', '    desc: 项目索引', '',
    ].join('\n'));

    // 注入：只读 YAML 使事务「写主文档后、syncResourceIndex 更新索引」步骤抛 EACCES
    chmodSync(yamlPath, 0o444);
    const r1 = applyDecisionRecords(root, dir, 'zh');
    chmodSync(yamlPath, 0o644);
    expect(r1.ok).toBe(false);
    // 回滚：主文档未残留、counter/marker 均不存在（零半状态，非「文档已落盘而 counter/marker 缺失」）
    expect(existsSync(decDoc)).toBe(false);
    expect(readProjectYaml(root).data?.decision_counter).toBeUndefined();
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(false);

    // 复权后重试 → 完整成功（不因半状态卡死、不按文件名跳过）
    const r2 = applyDecisionRecords(root, dir, 'zh');
    expect(r2.ok).toBe(true);
    expect(r2.applied).toEqual([{ file: 'core-D01-x.md', dxx: 1, op: 'ADDED' }]);
    expect(existsSync(decDoc)).toBe(true);
    expect(readProjectYaml(root).data?.decision_counter?.next_id).toBe(2);
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true);
  });

  it('ST-S38-12: 显式 ADDED 同名既有决策（内容不同）→ 冲突拒绝、不覆盖、零改动（code-r4 F2 / 对齐 UT-S38-13）', () => {
    const { root, dir } = setupProj({
      decisionSection: true, decisionsDeltaTask: true,
      decisionsDelta: { rel: 'deltas/decisions/core-D03-old.md', content: '## ADDED — core-D03-old\n\n# D03：新正文（不同）\n\n- 状态：accepted\n\n## 决策\n改采 Z。\n' },
    });
    const decDir = join(root, 'logos', 'resources', 'decisions');
    const decDoc = join(decDir, 'core-D03-old.md');
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    mkdirSync(decDir, { recursive: true });
    // 既有 D03（内容不同）+ stale next_id=3：正确基准 max(3,3+1)=4、拟号 D03 重复须拒绝、不覆盖
    const existingBody = ['# D03：既有结论', '', '- 状态：accepted', '', '## 决策', '采用 X。', ''].join('\n');
    writeFileSync(decDoc, existingBody);
    writeFileSync(yamlPath, [
      'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', '    product_type: cli',
      'decision_counter:', '  next_id: 3',
      'resource_index:', '  - path: logos/logos-project.yaml', '    desc: 项目索引',
      '  - path: logos/resources/decisions/core-D03-old.md', '    desc: D03 决策记录', '',
    ].join('\n'));
    const yamlBefore = readFileSync(yamlPath, 'utf-8');

    const r = applyDecisionRecords(root, dir, 'zh');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('冲突'); // 同名既有决策记录冲突（非误当半成品覆盖）
    expect(readFileSync(decDoc, 'utf-8')).toBe(existingBody); // 既有正文未被覆盖
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore); // YAML / counter 未变
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(false); // marker 未写
  });

  it('ST-S38-13: 空 decision_counter 块 + 合法 ADDED → 成功后磁盘补齐 next_id=2（code-r4 F2 持久化后置条件）', () => {
    const { root, dir } = setupProj({
      decisionSection: true, decisionsDeltaTask: true,
      decisionsDelta: { rel: 'deltas/decisions/core-D01-x.md', content: '## ADDED — core-D01-x\n\n# D01：某决策\n\n- 状态：accepted\n\n## 决策\n采用 X。\n' },
    });
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    // decision_counter 块存在但缺 next_id 字段（旧实现此时静默原样写回、磁盘仍无 next_id）
    writeFileSync(yamlPath, [
      'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', '    product_type: cli',
      'decision_counter:',
      'resource_index:', '  - path: logos/logos-project.yaml', '    desc: 项目索引', '',
    ].join('\n'));

    const r = applyDecisionRecords(root, dir, 'zh');
    expect(r.ok).toBe(true);
    expect(r.applied).toEqual([{ file: 'core-D01-x.md', dxx: 1, op: 'ADDED' }]);
    // 后置条件：磁盘 YAML 必须含 next_id=2（空块被补字段，而非静默原样写回）
    expect(readProjectYaml(root).data?.decision_counter?.next_id).toBe(2);
    expect(readFileSync(yamlPath, 'utf-8')).toContain('next_id: 2');
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true);
  });

  it('ST-S38-14: 同名【同内容】既有决策 + 无 journal → ADDED 仍冲突拒绝、零改动（code-r5 F2：内容相等不证事务身份）', () => {
    const body = ['# D03：既有结论', '', '- 状态：accepted', '', '## 决策', '采用 X。', ''].join('\n');
    const { root, dir } = setupProj({
      decisionSection: true, decisionsDeltaTask: true,
      decisionsDelta: { rel: 'deltas/decisions/core-D03-same.md', content: `## ADDED — core-D03-same\n\n${body}` },
    });
    const decDir = join(root, 'logos', 'resources', 'decisions');
    const decDoc = join(decDir, 'core-D03-same.md');
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    mkdirSync(decDir, { recursive: true });
    // 既有 D03 正文恰与 delta 正文相同、stale next_id=3、无本次事务 journal
    writeFileSync(decDoc, body);
    writeFileSync(yamlPath, [
      'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', '    product_type: cli',
      'decision_counter:', '  next_id: 3',
      'resource_index:', '  - path: logos/logos-project.yaml', '    desc: 项目索引',
      '  - path: logos/resources/decisions/core-D03-same.md', '    desc: D03 决策记录', '',
    ].join('\n'));
    const yamlBefore = readFileSync(yamlPath, 'utf-8');

    const r = applyDecisionRecords(root, dir, 'zh');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('冲突'); // 内容相同也拒绝（无 journal 佐证其为崩溃残留）
    expect(readFileSync(decDoc, 'utf-8')).toBe(body);          // 既有正文不变
    expect(readFileSync(yamlPath, 'utf-8')).toBe(yamlBefore);  // counter 未前移到 4、索引不变
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(false);  // marker 未写
    expect(existsSync(join(dir, DECISION_APPLY_JOURNAL))).toBe(false); // 未落 journal
  });

  it('ST-S38-15: marker 前崩溃（counter 已前移、journal 在场）→ 重试前滚补 marker、不重算自拒（code-r5 F2 重试幂等）', () => {
    const { root, dir } = setupProj({
      decisionSection: true, decisionsDeltaTask: true,
      decisionsDelta: { rel: 'deltas/decisions/core-D01-x.md', content: '## ADDED — core-D01-x\n\n# D01：某决策\n\n- 状态：accepted\n\n## 决策\n采用 X。\n' },
    });
    const decDoc = join(root, 'logos', 'resources', 'decisions', 'core-D01-x.md');
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    writeFileSync(yamlPath, [
      'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', '    product_type: cli',
      'resource_index:', '  - path: logos/logos-project.yaml', '    desc: 项目索引', '',
    ].join('\n'));
    // 1. 正常 apply 成功 → 落盘正文 + counter=2 + index，journal 已清
    const r0 = applyDecisionRecords(root, dir, 'zh');
    expect(r0.ok).toBe(true);
    const landedBody = readFileSync(decDoc, 'utf-8');
    // 2. 构造「counter 已前移到 2、正文/索引在场、SPEC_MERGED 缺失、journal 在场」的 marker 前崩溃等价磁盘态
    rmSync(join(dir, 'SPEC_MERGED'));
    writeFileSync(join(dir, DECISION_APPLY_JOURNAL), JSON.stringify({
      base: 1, persistedNextId: 2, addedCount: 1,
      targets: [{ file: 'core-D01-x.md', op: 'ADDED', dxx: 1, preExisted: false, prevContent: null, body: landedBody }],
    }));
    expect(readProjectYaml(root).data?.decision_counter?.next_id).toBe(2); // counter 已前移
    // 3. 重试：据 journal 前滚补 marker、以原 D01/next_id=2 完成，而非据已前移 counter 重算 base=2→D02 自拒
    const r1 = applyDecisionRecords(root, dir, 'zh');
    expect(r1.ok).toBe(true);
    expect(r1.applied).toEqual([{ file: 'core-D01-x.md', dxx: 1, op: 'ADDED' }]);
    expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true);
    expect(readProjectYaml(root).data?.decision_counter?.next_id).toBe(2); // 未被重算/前移到 3
    expect(existsSync(join(dir, DECISION_APPLY_JOURNAL))).toBe(false);     // 提交后清 journal
  });
});
