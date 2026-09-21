/**
 * slice-02-lint-merge-predicate-convergence 实现验收。
 *
 * 覆盖 UT-S35-177～UT-S35-182 与 ST-S35-33，对应场景 S35「锚折算、RENAMED 映射与标题扫描的三处收敛」。
 * 结果由全局 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 *
 * 断言纪律：
 * ① UT-S35-180 是本族**安全锚**——把 L8 辖属身份切到 `normalizedText` 必须让它变红；
 *    **不得放宽**：冲突时的修复方向是让身份消费方改回无损文本，而非削弱断言。
 * ② UT-S35-178 同时对 `runChangeLint` / `evaluateDeltaConservation` 与 merge 合成两侧求真实结论，
 *    并断言上线前 merge 亦拒该形态——证明可合并集合不变、只改报错时机。
 * ③ UT-S35-182 的逐字对照以 `fixtures/s35-convergence-baseline.json`（上线前实测）为基准夹具。
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HEADING_VIEW, computeDecisionRecordWarnings, evaluateDeltaConservation, runChangeLint,
} from '../src/lib/change-lint.js';
import {
  buildRenameMaps, composeOpenLogosMarkdown, mapAnchorText, parseDeltaBlocks,
  parseMarkdownHeadings, resolveSectionAnchor, verifyAgentMaterialOutcome,
} from '../src/lib/markdown-section-authority.js';
import { scanHeadingRecords } from '../src/lib/markdown-scan.js';
import BASELINE from './fixtures/s35-convergence-baseline.json' with { type: 'json' };
import { invoke } from './frontier-fixture.js';

const roots: string[] = [];
/** 加载态源码变体的落地目录（UT-S35-177 的 merge 侧反证用；`test/**\/*.test.ts` 之外，不会被收集为用例）。 */
const VARIANT_DIR = fileURLToPath(new URL('./.fold-variant/', import.meta.url));
afterAll(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  rmSync(VARIANT_DIR, { recursive: true, force: true });
});

/**
 * 载入权威模块的**源码变体**：对源码施加 `mutate` 后落到项目内临时文件并动态 import。
 *
 * 用于 merge 侧的副本反证——`verifyAgentMaterialOutcome` 与 `mapAnchorText` 同在一个模块内，
 * ESM 命名空间 mock 只能替换**导入方**看到的绑定、拦不到模块自身的内部调用（code-r1 triage
 * 已说明该限制）。改在**加载态**替换共享函数体，就能让模块内部调用也走到受控变体：
 * 若 merge 侧仍持有私有折算副本，本变体对它无效 → 结论不变 → 反证臂变红。
 *
 * `mutate` **只允许锚定导出签名行**，不得依赖函数体内的局部变量名——code-r2 实证过：把副本里的
 * `ordinal` 改名为 `suffixMatch` 就能绕过基于变量名的文本判据。
 */
let variantSeq = 0;
async function loadAuthorityVariant(
  mutate: (source: string) => string,
): Promise<typeof import('../src/lib/markdown-section-authority.js')> {
  const source = readFileSync(
    new URL('../src/lib/markdown-section-authority.ts', import.meta.url), 'utf8');
  // 变体落在 test/.fold-variant/ 下，故模块内的相对 import 需改写为指向真实 src。
  const rewritten = mutate(source).replace(/from '\.\/([^']+)'/g, "from '../../src/lib/$1'");
  mkdirSync(VARIANT_DIR, { recursive: true });
  const file = join(VARIANT_DIR, `authority-variant-${variantSeq++}.ts`);
  writeFileSync(file, rewritten);
  return await import(/* @vite-ignore */ file);
}

/** 共享折算函数的导出签名——变体注入的唯一锚点；签名若变动，探针必须同步（否则静默失效）。 */
const FOLD_EXPORT_SIGNATURE =
  'export function mapAnchorText(anchor: string, renames: Map<string, string>): string {';
const FOLD_PROBE_SENTINEL = '\u0000FOLD-PROBE';

const SLUG = 'rename-fixture';
const BASE_DOC = '# 文档\n\n## 一、判据\n\n旧正文。\n';
const EMPTY_TASKS = '# 任务\n\n## [delta] 规格变更\n\n- [ ] 无。\n\n## [code] 代码实现\n';

type Fidelity = { ok: boolean; final?: string; error?: string };
type RenamedCase = {
  merge: { threw: boolean; message?: string; final?: string };
  verify: { ok: boolean; error: string | null };
  lintConservation: Array<{ code: string; anchor: string }>;
};
const fidelity = (key: string): Fidelity =>
  (BASELINE.fidelityCases as unknown as Record<string, Fidelity>)[key];
const renamedCase = (key: string): RenamedCase =>
  (BASELINE.renamedCases as unknown as Record<string, RenamedCase>)[key];

function materialize(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-conv-'));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const absolute = join(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

const clarification = [
  '## 决策澄清', '', '```yaml',
  'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete', 'impacts:',
  '  data: {status: none, reason: fixture}', '  compatibility: {status: none, reason: fixture}',
  '  security_privacy: {status: none, reason: fixture}', '  public_release: {status: none, reason: fixture}',
  '  external_commitment: {status: none, reason: fixture}', 'decisions: []', 'unresolved: []', 'defaults: []',
  '```', '',
].join('\n');

/** launched 隔离夹具：一个既有 Markdown 目标 + 一份 scenario delta + 一份 test delta。 */
function proposalFiles(scenarioDelta: string, target = BASE_DOC): Record<string, string> {
  return {
    'logos/logos.config.json': '{"locale":"zh","project":{"type":"cli"}}\n',
    'logos/.openlogos-guard': JSON.stringify({ activeChange: SLUG, module: 'core' }) + '\n',
    'logos/logos-project.yaml': [
      'project:', '  name: Rename Fixture', 'modules:', '  - id: core', '    name: Core',
      '    lifecycle: launched', 'scenario_counter:', '  next_id: 40', 'resource_index: []', '',
    ].join('\n'),
    'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md': target,
    'logos/resources/test/core-S01-test-cases.md':
      '# 用例\n\n## 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |\n',
    [`logos/changes/${SLUG}/proposal.md`]: [
      '# 变更提案：更名夹具', '', '## 变更原因', '真实原因。', '', '## 变更类型', '需求级', '',
      '## 变更范围', '- 影响的功能规格：fixture', '', '## 部署影响',
      '- 是否需要部署：否', '- 部署原因：无', '- 影响环境：无', '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '概述。', '', clarification,
    ].join('\n'),
    [`logos/changes/${SLUG}/PLAN_APPROVED`]: '{}',
    [`logos/changes/${SLUG}/deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md`]: scenarioDelta,
    [`logos/changes/${SLUG}/deltas/test/core-S01-test-cases.md`]:
      '## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |\n',
    [`logos/changes/${SLUG}/tasks.md`]: [
      '# 任务', '', '## [delta] 规格变更', '',
      '- [x] [MODIFY] `deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md`：fixture 更新',
      '- [x] [MODIFY] `deltas/test/core-S01-test-cases.md`：fixture 用例更新', '', '## [code] 代码实现', '',
    ].join('\n'),
  };
}

const ILLEGAL_RENAMED: Record<string, string> = {
  'multi-line': '## RENAMED — 一、判据\n\n新标题一\n新标题二\n',
  'empty-body': '## RENAMED — 一、判据\n\n\n',
  'hash-prefixed': '## RENAMED — 一、判据\n\n## 新标题\n',
  // code-r1 F1 的两个绕过入口
  'missing-anchor': '## RENAMED\n\n新标题\n',
  'added-then-illegal-rename': '## ADDED — 一、判据\n\n正文。\n\n## RENAMED — 一、判据\n\n新标题\n第二行\n',
};
/** 目标主文档尚不存在（CREATE 路径）的形态——L4 的块形态检查不得因此跳过。 */
const CREATE_MODE_CASES = new Set(['added-then-illegal-rename']);
const LEGAL_RENAMED = '## RENAMED — 一、判据\n\n一、判据（订正后）\n\n## MODIFIED — 一、判据（订正后）\n\n新正文。\n';

describe('S35 单元测试——锚折算 / RENAMED 映射 / 标题扫描的三处收敛', () => {
  it('UT-S35-177: 锚折算单点——lint 与 merge 的**真实**消费者随共享实现同时变化', async () => {
    const renames = new Map([['旧标题', '新标题'], ['父', '新父'], ['带空白', '新带空白']]);
    const anchors = [
      '旧标题', '新标题', '父 > 旧标题', '旧标题 [2]', '父 > 旧标题 [3]',
      '带空白  [2]', '未命中', '父 > 未命中 [1]',
    ];

    // ① 共享实现的折算语义：按 ' > ' 分段、`[n]` 后缀原样保留且不参与折算（期望值写死，
    //    不用同一次调用自比较——自比较恒真、无鉴别力，code-r1 F3）。
    expect(anchors.map(a => mapAnchorText(a, renames))).toEqual([
      '新标题', '新标题', '新父 > 新标题', '新标题 [2]', '新父 > 新标题 [3]',
      '新带空白  [2]', '未命中', '新父 > 未命中 [1]',
    ]);

    // ② **注入式反证（真实消费路径）**：把共享模块的 `mapAnchorText` 换成受控变体，再重新
    //    加载 `change-lint`，用它的**真实**消费者 `evaluateDeltaConservation` 求同一 delta。
    //    lint 若还持有私有折算副本（如独立的 `localAnchorFold`），注入不会被观察到 → 本臂变红。
    vi.resetModules();
    const calls: Array<{ anchor: string; renamed: number }> = [];
    vi.doMock('../src/lib/markdown-section-authority.js', async () => {
      const actual = await vi.importActual<typeof import('../src/lib/markdown-section-authority.js')>(
        '../src/lib/markdown-section-authority.js');
      return {
        ...actual,
        mapAnchorText: (anchor: string, map: Map<string, string>) => {
          calls.push({ anchor, renamed: map.size });
          // 受控变体：折算后附加哨兵后缀 → 折回旧标题的重试必然落空，
          // 于是真实消费者的结论从「锚可解析」翻转为「锚不可解析」。
          return `${actual.mapAnchorText(anchor, map)}\u0000SENTINEL`;
        },
      };
    });
    try {
      const injected = await import('../src/lib/change-lint.js');
      const violations = injected.evaluateDeltaConservation(LEGAL_RENAMED, BASE_DOC);
      expect(calls.length, 'lint 的真实消费路径未调用共享实现 → 仍持有折算副本').toBeGreaterThan(0);
      expect(violations.map(v => v.code), '注入受控变体后 lint 的真实结论必须随之变化')
        .toEqual(['delta_section_anchor_unresolvable']);
    } finally {
      vi.doUnmock('../src/lib/markdown-section-authority.js');
      vi.resetModules();
    }

    // ③ 未注入时（本模块顶层导入的真实实现）：同一 delta 零违规，且 merge 侧合成成功——
    //    两侧对同一输入结论一致，注入只在 ② 中生效。
    expect(evaluateDeltaConservation(LEGAL_RENAMED, BASE_DOC).map(v => ({ code: v.code, anchor: v.anchor })))
      .toEqual(renamedCase('legal-rename-then-modify').lintConservation);
    const final = composeOpenLogosMarkdown(BASE_DOC, LEGAL_RENAMED, 'MODIFY');
    expect(final).toBe(renamedCase('legal-rename-then-modify').merge.final);
    expect(verifyAgentMaterialOutcome(LEGAL_RENAMED, BASE_DOC, final).ok).toBe(true);

    // ④ **注入式反证（merge 侧真实消费者）**：在**加载态**替换共享折算函数体，再调真实
    //    `verifyAgentMaterialOutcome`。夹具必经更名回退——`LEGAL_RENAMED` 的 MODIFIED 块以
    //    **新标题**为锚，该锚在 before 文档中不存在，只有折回旧标题才能解析成功。
    //    注入锚点只取导出签名行，**不依赖函数体内的局部变量名**（code-r2 实证：把副本里的
    //    `ordinal` 改名为 `suffixMatch` 就能绕过基于变量名的文本判据）。
    //    merge 侧若仍持有私有折算副本，本变体对它无效 → 结论不变 → 本臂变红。
    const controlVariant = await loadAuthorityVariant(source => source);   // 对照：不改任何字节
    expect(controlVariant.verifyAgentMaterialOutcome(LEGAL_RENAMED, BASE_DOC, final).ok,
      '对照臂：未注入时加载态变体的结论必须与真实实现一致（否则探针本身有偏）').toBe(true);

    const foldVariant = await loadAuthorityVariant(source => {
      expect(source.includes(FOLD_EXPORT_SIGNATURE),
        '共享折算函数的导出签名已变动，merge 侧反证探针必须同步更新').toBe(true);
      return source.replace(FOLD_EXPORT_SIGNATURE, [
        FOLD_EXPORT_SIGNATURE,
        `  return __probeOriginalFold(anchor, renames) + ${JSON.stringify(FOLD_PROBE_SENTINEL)};`,
        '}',
        'function __probeOriginalFold(anchor: string, renames: Map<string, string>): string {',
      ].join('\n'));
    });
    // 变体确实改变了共享折算的输出（前置自检，避免注入失效而静默绿）
    expect(foldVariant.mapAnchorText('旧标题', new Map([['旧标题', '新标题']])))
      .toBe(`新标题${FOLD_PROBE_SENTINEL}`);
    const injectedMerge = foldVariant.verifyAgentMaterialOutcome(LEGAL_RENAMED, BASE_DOC, final);
    expect(injectedMerge.ok,
      'merge 侧真实消费者未随共享折算变化 → 仍持有第二份折算实现').toBe(false);

    // ⑤ 辅助的结构性断言：lint 侧从**唯一定义点**导入折算与映射构建（与 ② 的行为反证互补，
    //    不作为 merge 侧副本的判据——那已由 ④ 的真实消费者反证承担）。
    const lintSource = readFileSync(new URL('../src/lib/change-lint.ts', import.meta.url), 'utf8');
    const authoritySource = readFileSync(
      new URL('../src/lib/markdown-section-authority.ts', import.meta.url), 'utf8');
    expect(lintSource).toMatch(/import\s*\{[^}]*\bmapAnchorText\b[^}]*\}\s*from\s*'\.\/markdown-section-authority\.js'/s);
    expect(lintSource).toMatch(/import\s*\{[^}]*\bbuildRenameMaps\b[^}]*\}\s*from\s*'\.\/markdown-section-authority\.js'/s);
    expect(authoritySource).toMatch(/export function mapAnchorText\(/);
    expect(authoritySource).toMatch(/export function buildRenameMaps\(/);
  });

  it('UT-S35-178: 非法 RENAMED 块两侧统一为拒绝，预检在 L4 先报且不依赖基线', () => {
    for (const [key, delta] of Object.entries(ILLEGAL_RENAMED)) {
      const baseline = renamedCase(key);
      const createMode = CREATE_MODE_CASES.has(key);
      const base = createMode ? '' : BASE_DOC;

      // ① 上线前 merge 侧即拒该形态——证明**可合并集合不变**，本次只改报错时机
      expect(baseline.merge.threw, key).toBe(true);
      expect(baseline.verify.ok, key).toBe(false);
      //    上线前 lint 侧零违规：这正是被作废的分叉（含 code-r1 F1 的两个绕过入口）
      expect(baseline.lintConservation, key).toEqual([]);

      // ② 改后 merge 侧仍拒（口径逐字不变）
      expect(() => composeOpenLogosMarkdown(base, delta, createMode ? 'CREATE' : 'MODIFY'), key).toThrow();
      const verified = verifyAgentMaterialOutcome(delta, base, base);
      expect(verified.ok, key).toBe(false);
      expect(verified.error, key).toBe(baseline.verify.error);

      // ③ 共享映射单点对同一形态返回 error，两侧据此统一拒绝（含缺锚块——不再静默跳过）
      const maps = buildRenameMaps(parseDeltaBlocks(delta));
      expect(maps.error, key).toBe(baseline.verify.error);
      expect(maps.reverse.size, key).toBe(0);

      // ④ **真实 change-lint 出口：违规落在 L4**（块形态判据，不读基线主文档），
      //    因此目标是否已存在都必须报出——code-r1 F1 的两个绕过入口由此关闭。
      const files = proposalFiles(delta);
      if (createMode) {
        // 目标主文档尚不存在：同一 delta 内先 ADDED 再 RENAMED 是合法写法，
        // 不能因「新目标无守恒义务」而跳过块语法检查。
        delete files['logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md'];
      }
      const root = materialize(files);
      const lint = runChangeLint(root, join(root, 'logos/changes', SLUG), SLUG);
      const reported = lint.violations.filter(v => v.code === 'delta_section_anchor_unresolvable'
        && v.path.includes('deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md'));
      expect(reported.length, `${key}: lint 必须报出`).toBeGreaterThan(0);
      expect(reported[0].message, `${key}: 点名具体违反项`).toContain(baseline.verify.error!);
      expect(lint.checks.find(c => c.id === 4)!.violations, `${key}: 归属 L4`).toBeGreaterThan(0);
      expect(lint.violations.length, `${key}: 同一形态不重复报`).toBe(reported.length);

      // ⑤ 库级 API 同样 fail-closed（目标存在时）：调用方拿不到「零违规」的假象
      if (!createMode) {
        const violations = evaluateDeltaConservation(delta, BASE_DOC);
        expect(violations.map(v => v.code), key).toEqual(['delta_section_anchor_unresolvable']);
        expect(violations[0].message, key).toContain(baseline.verify.error!);
      }
    }

    // ⑥ 合法 RENAMED 零行为变更：两侧均通过（既有规范写法不被误拒）
    expect(evaluateDeltaConservation(LEGAL_RENAMED, BASE_DOC)).toEqual([]);
    expect(renamedCase('legal-rename-then-modify').merge.threw).toBe(false);
    const legalRoot = materialize(proposalFiles(LEGAL_RENAMED));
    expect(runChangeLint(legalRoot, join(legalRoot, 'logos/changes', SLUG), SLUG).violations).toEqual([]);
  });

  it('UT-S35-179: 标题扫描单点且 rawText / normalizedText 双视图同时可得', () => {
    const doc = [
      '# 顶层 `doc`', '', '## 业务 `正式`', '', '内容。', '',
      '```markdown', '## 围栏内的伪标题', '```', '',
      '    ## 缩进代码内的伪标题', '',
      '<!--', '## 注释内的伪标题', '-->', '',
      '### 子节 ``含 ` 的定界``', '', '尾。', '',
    ].join('\n');

    // ① 掩码行不入标题集合；一次扫描即同时产出两个视图
    const records = scanHeadingRecords(doc.split('\n'));
    expect(records.map(r => r.rawText)).toEqual(['顶层 `doc`', '业务 `正式`', '子节 ``含 ` 的定界``']);
    expect(records.map(r => r.normalizedText)).toEqual(['顶层', '业务', '子节']);
    expect(records.map(r => r.level)).toEqual([1, 2, 3]);
    for (const record of records) {
      expect(record.rawText.length).toBeGreaterThanOrEqual(record.normalizedText.length);
    }

    // ② 行号与层级与 merge 侧 heading tree 一一对应（同一次扫描的两种投影）
    const headings = parseMarkdownHeadings(doc);
    expect(headings.map(h => h.line)).toEqual(records.map(r => r.line));
    expect(headings.map(h => h.level)).toEqual(records.map(r => r.level));
    expect(headings.map(h => h.text)).toEqual(records.map(r => r.normalizedText));
    expect(headings.map(h => h.rawText)).toEqual(records.map(r => r.rawText));

    // ③ 与上线前实测逐字相同（line / level / text / path / rawHeading 全项）
    expect(headings.map(h => ({
      line: h.line, level: h.level, text: h.text, path: h.path, rawHeading: h.rawHeading,
    }))).toEqual(BASELINE.headings);

    // ④ 结构性单点：lint 侧不再自建第二份标题扫描
    const lintSource = readFileSync(new URL('../src/lib/change-lint.ts', import.meta.url), 'utf8');
    expect(lintSource).not.toMatch(/function\s+scanHeadings\s*\(/);
    expect(lintSource).toMatch(/import\s*\{[^}]*\bscanHeadingRecords\b[^}]*\}\s*from\s*'\.\/markdown-scan\.js'/s);
  });

  it('UT-S35-180: 安全锚——辖属标题不同的场景表行不得坍缩身份', () => {
    const before = [
      '# 场景', '', '## 场景总览', '', '### 业务 `正式`', '',
      '| 编号 | 场景名称 |', '|---|---|', '| S01 | 登录 |', '',
    ].join('\n') + '\n';
    const delta = [
      '## MODIFIED — 场景总览', '', '### 业务 `历史`', '',
      '| 编号 | 场景名称 |', '|---|---|', '| S01 | 登录 |', '',
    ].join('\n') + '\n';

    // ① 现状：未声明删除、未 RENAMED，仅把该行移到另一辖属标题下 → 隐式删除被拦并点名
    const violations = evaluateDeltaConservation(delta, before);
    expect(violations.map(v => ({ code: v.code, anchor: v.anchor, message: v.message }))).toEqual(BASELINE.conservation);
    expect(violations).toHaveLength(1);
    expect(violations[0].code).toBe('delta_implicit_id_removal');
    expect(violations[0].message).toContain('S01');
    expect(violations[0].message).toContain('业务 `正式`');   // **原始**表身份，未被规范化吞掉

    // ② **注入式反证**：把 L8 辖属身份切到 normalizedText，两个辖属路径坍缩为「业务」、
    //    身份相同 → 守恒返回空集。本臂必须让上面的断言失去效力，证明 ① 的强度真来自无损身份。
    //    本用例**不得被放宽**：冲突时的修复方向是让身份消费方改回无损文本，而非削弱断言。
    const original = HEADING_VIEW.identity;
    (HEADING_VIEW as { identity: (h: { rawText: string; normalizedText: string }) => string })
      .identity = h => h.normalizedText;
    try {
      const drifted = evaluateDeltaConservation(delta, before);
      expect(drifted, '身份改取规范化文本后守恒门被绕过——这正是必须避免的形态').toEqual([]);
    } finally {
      (HEADING_VIEW as { identity: typeof original }).identity = original;
    }

    // ③ 恢复后强度不降
    expect(evaluateDeltaConservation(delta, before)).toHaveLength(1);
  });

  it('UT-S35-181: 锚定位消费规范化文本且与 merge 侧逐字一致', () => {
    const doc = [
      '# 顶层 `doc`', '', '## 业务 `正式`', '', '内容。', '',
      '```markdown', '## 围栏内的伪标题', '```', '',
      '    ## 缩进代码内的伪标题', '',
      '<!--', '## 注释内的伪标题', '-->', '',
      '### 子节 ``含 ` 的定界``', '', '尾。', '',
    ].join('\n');
    const headings = parseMarkdownHeadings(doc);

    // ① 锚解析结论与上线前实测逐字相同（锚定位本就取规范化文本，收敛不改其口径）
    for (const [anchor, expected] of Object.entries(BASELINE.anchorProbes)) {
      const r = resolveSectionAnchor(headings, anchor);
      expect({ status: r.status, candidates: r.candidates.length, line: r.hit?.line ?? null }, anchor)
        .toEqual(expected);
    }

    // ② 含行内代码的标题：写原文锚与写剥离后的锚**结论相同**——不再出现
    //    「lint 判不可解析而 merge 成功」的组合（两侧现在读同一个 normalizedText）
    expect(resolveSectionAnchor(headings, '业务 `正式`').status)
      .toBe(resolveSectionAnchor(headings, '业务').status);
    expect(resolveSectionAnchor(headings, '业务 `正式`').hit?.line)
      .toBe(resolveSectionAnchor(headings, '业务').hit?.line);

    // ③ lint 与 merge 对同一含行内代码标题的 delta 结论一致：都成功
    const before = '# 文档\n\n## 业务 `正式`\n\n旧正文。\n';
    const delta = '## MODIFIED — 业务 `正式`\n\n新正文。\n';
    expect(evaluateDeltaConservation(delta, before)).toEqual([]);
    expect(composeOpenLogosMarkdown(before, delta, 'MODIFY'))
      .toBe(fidelity('modified-under-inline-code-title').final);
  });

  it('UT-S35-182: 标题保真仍取 rawHeading；决策章节判定视图显式选定', () => {
    // ① 保真检查未与规范化管道合流：ADDED / RENAMED 发射的标题逐字保留行内代码，
    //    与上线前实测逐字相同（基准夹具 = 本切片实现前的实测输出）
    for (const key of ['added-inline-code-title', 'added-nested-inline-code-title',
      'renamed-inline-code-title', 'modified-under-inline-code-title'] as const) {
      const baseline = fidelity(key);
      expect(baseline.ok, key).toBe(true);
    }
    expect(composeOpenLogosMarkdown(BASE_DOC, '## ADDED — 二、`stripInlineCode` 的边界\n\n新章节正文。\n', 'MODIFY'))
      .toBe(fidelity('added-inline-code-title').final);
    expect(composeOpenLogosMarkdown(BASE_DOC, '## ADDED — 三、``含 ` 的定界`` 与尾注\n\n新章节正文。\n', 'MODIFY'))
      .toBe(fidelity('added-nested-inline-code-title').final);
    expect(composeOpenLogosMarkdown('# 文档\n\n## 业务 `正式`\n\n正文。\n',
      '## RENAMED — 业务 `正式`\n\n业务 `历史`\n', 'MODIFY'))
      .toBe(fidelity('renamed-inline-code-title').final);
    //    rawHeading 仍是标题行原始字节（含 `#` 前缀），不经 stripInlineCode
    const heading = parseMarkdownHeadings('# 文档\n\n## 业务 `正式`\n\n正文。\n')
      .find(h => h.rawText === '业务 `正式`')!;
    expect(heading.rawHeading).toBe('## 业务 `正式`');
    expect(heading.text).toBe('业务');

    // ② 决策章节判定的视图**显式选定**并有鉴别用例：
    //    `## 已确定的设计\`x\`决策` 在 rawText 下不命中、在 normalizedText 下命中，两视图结论相反。
    for (const [key, doc] of Object.entries(BASELINE.decisionDocs)) {
      const codes = computeDecisionRecordWarnings(doc, EMPTY_TASKS, false).map(w => w.code);
      expect(codes, key).toEqual(
        (BASELINE.decisionSection as unknown as Record<string, string[]>)[key]);
    }
    //    视图取用点哨兵：注入 normalizedText 后该鉴别用例结论翻转，证明判定确实走 HEADING_VIEW
    const discriminating = (BASELINE.decisionDocs as Record<string, string>)['inline-code-inside'];
    expect(computeDecisionRecordWarnings(discriminating, EMPTY_TASKS, false)).toEqual([]);
    const original = HEADING_VIEW.identity;
    (HEADING_VIEW as { identity: (h: { rawText: string; normalizedText: string }) => string })
      .identity = h => h.normalizedText;
    try {
      expect(computeDecisionRecordWarnings(discriminating, EMPTY_TASKS, false)
        .map(w => w.code)).toEqual(['decision_record_section_without_delta']);
    } finally {
      (HEADING_VIEW as { identity: typeof original }).identity = original;
    }
    expect(computeDecisionRecordWarnings(discriminating, EMPTY_TASKS, false)).toEqual([]);
  });
});

describe('S35 场景测试——三处收敛后预检与合成结论一致、守恒强度不降', () => {
  it('ST-S35-33: 真实 CLI 下两侧一致，且 SPEC_MERGED 按分支相反断言', () => {
    const targetRel = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md';

    // ① 非法 RENAMED（独立隔离夹具，起始无 SPEC_MERGED）：lint exit 2 并点名该块；
    //    随后真实 merge 亦非零，结束仍无该标记、目标保持合并前字节。
    const illegal = materialize(proposalFiles(ILLEGAL_RENAMED['multi-line']));
    expect(existsSync(join(illegal, 'logos/changes', SLUG, 'SPEC_MERGED'))).toBe(false);
    const illegalBefore = readFileSync(join(illegal, targetRel), 'utf8');
    const illegalLint = invoke(['change-lint', '--slug', SLUG, '--format', 'json'], illegal);
    expect(illegalLint.status).toBe(2);
    const illegalEnvelope = JSON.parse(illegalLint.stdout.trim().split('\n').pop()!);
    expect(illegalEnvelope.data.pass).toBe(false);
    const anchorViolation = illegalEnvelope.data.violations.find(
      (v: { code: string }) => v.code === 'delta_section_anchor_unresolvable');
    expect(anchorViolation).toBeDefined();
    expect(anchorViolation.message).toContain('RENAMED');
    //    归属 **L4**（delta 块形态判据，不读基线主文档）——与已合并 ST-S35-33 步骤⑤「① 为 L4」一致
    const illegalChecks = runChangeLint(illegal, join(illegal, 'logos/changes', SLUG), SLUG).checks;
    expect(illegalChecks.find(c => c.id === 4)!.violations).toBeGreaterThan(0);
    const illegalMerge = invoke(['merge', SLUG], illegal);
    expect(illegalMerge.status).not.toBe(0);
    expect(existsSync(join(illegal, 'logos/changes', SLUG, 'SPEC_MERGED'))).toBe(false);
    expect(readFileSync(join(illegal, targetRel), 'utf8')).toBe(illegalBefore);

    // ② 合法 RENAMED + 后续块以新标题为锚（**独立夹具，不复用①**）：
    //    change-lint PASS、真实 merge exit 0 并生成 SPEC_MERGED，合并后标题与正文符合预期。
    const legal = materialize(proposalFiles(LEGAL_RENAMED));
    expect(existsSync(join(legal, 'logos/changes', SLUG, 'SPEC_MERGED'))).toBe(false);
    const legalLint = invoke(['change-lint', '--slug', SLUG], legal);
    expect(legalLint.status, legalLint.stdout + legalLint.stderr).toBe(0);
    const legalMerge = invoke(['merge', SLUG], legal);
    expect(legalMerge.status, legalMerge.stderr).toBe(0);
    expect(existsSync(join(legal, 'logos/changes', SLUG, 'SPEC_MERGED'))).toBe(true);
    const mergedDoc = readFileSync(join(legal, targetRel), 'utf8');
    expect(mergedDoc).toContain('## 一、判据（订正后）');
    expect(mergedDoc).toContain('新正文。');
    expect(mergedDoc).not.toContain('旧正文。');

    // ③ 守恒反例在真实 change-lint 下仍判 delta_implicit_id_removal 并点名 S01
    const conservationTarget = [
      '# 场景', '', '## 场景总览', '', '### 业务 `正式`', '',
      '| 编号 | 场景名称 |', '|---|---|', '| S01 | 登录 |', '',
    ].join('\n') + '\n';
    const conservationDelta = [
      '## MODIFIED — 场景总览', '', '### 业务 `历史`', '',
      '| 编号 | 场景名称 |', '|---|---|', '| S01 | 登录 |', '',
    ].join('\n') + '\n';
    const conservation = materialize(proposalFiles(conservationDelta, conservationTarget));
    const conservationLint = invoke(['change-lint', '--slug', SLUG, '--format', 'json'], conservation);
    const conservationEnvelope = JSON.parse(conservationLint.stdout.trim().split('\n').pop()!);
    // **按真实通道逐项断言，不合并 violations / warnings**（code-r1 F4）：
    // `delta_implicit_id_removal` 由**既有 §2.73** 降级为 **warning**（`change-lint.ts` 守恒两码
    // 降级，本提案未触碰该机制），故 `violations` 中不含它、`data.pass` 为 true、退出码为 0。
    //
    // ⚠️ **已合并规格合同待订正（code-r1 F4 / r2 / r3 连续 insisted）**：`core-S35-test-cases.md`
    // 的 ST-S35-33 步骤⑤ 把 ③ 归为「预期拒绝分支」并要求 `L8 violations > 0`、`data.pass=false`、
    // exit 2、通过数少于总数——该要求与 §2.73 的既有降级语义**不可同时成立**。
    // code-r3 处置时实测：直接订正已合并主文档会被工具链 fail-closed 拒绝
    // （`SPEC_MERGED.test_change_set.targets[].after_sha256` 绑定 → L9 `test-slice-manifest-invalid`，
    // 且明文「禁止从 Delta、Git 或 slice manifest 反推」），故订正只能经**新变更提案**重新 merge。
    // 此处如实断言现行契约并把冲突显式留痕；不得以合并通道、省略状态断言的方式掩盖。
    const conservationViolations = (conservationEnvelope.data.violations ?? [])
      .filter((v: { code: string }) => v.code === 'delta_implicit_id_removal');
    const conservationWarnings = (conservationEnvelope.data.warnings ?? [])
      .filter((v: { code: string }) => v.code === 'delta_implicit_id_removal');
    expect(conservationViolations, '§2.73：守恒两码走 warning 通道，不进 violations').toEqual([]);
    expect(conservationWarnings.length, '守恒信号必须在 warning 通道出现').toBeGreaterThan(0);
    expect(conservationWarnings[0].message).toContain('S01');
    expect(conservationWarnings[0].message).toContain('业务 `正式`');   // **原始**表身份，未被规范化吞掉
    expect(conservationLint.status, '§2.73 下守恒警告不改变退出码').toBe(0);
    expect(conservationEnvelope.data.pass, '§2.73 下守恒警告不改变 pass').toBe(true);
    //    强度不降：同一夹具在库级 API 上仍 fail-closed 地产出该判定并点名原始表身份
    const conservationDirect = evaluateDeltaConservation(conservationDelta, conservationTarget);
    expect(conservationDirect.map(v => v.code)).toEqual(['delta_implicit_id_removal']);
    expect(conservationDirect[0].message).toContain('业务 `正式`');

    // ④ 标题含行内代码的锚在 change-lint 与 merge 下解析结论一致（两侧均成功合并）
    const inlineTarget = '# 文档\n\n## 业务 `正式`\n\n旧正文。\n';
    const inlineDelta = '## MODIFIED — 业务 `正式`\n\n新正文。\n';
    const inline = materialize(proposalFiles(inlineDelta, inlineTarget));
    const inlineLint = invoke(['change-lint', '--slug', SLUG], inline);
    expect(inlineLint.status, inlineLint.stdout + inlineLint.stderr).toBe(0);
    const inlineMerge = invoke(['merge', SLUG], inline);
    expect(inlineMerge.status, inlineMerge.stderr).toBe(0);
    expect(readFileSync(join(inline, targetRel), 'utf8'))
      .toBe(fidelity('modified-under-inline-code-title').final);

    // ⑤ 门禁口径不变、通过数按分支断言（禁止硬编码检查项数字）
    const lintOf = (root: string) => {
      const r = runChangeLint(root, join(root, 'logos/changes', SLUG), SLUG);
      return {
        checkIds: r.checks.map(c => c.id),
        total: r.checks.length,
        passed: r.checks.filter(c => c.violations === 0).length,
        pass: r.violations.length === 0,
        checkViolations: Object.fromEntries(r.checks.map(c => [String(c.id), c.violations])),
      };
    };
    const legalGate = lintOf(materialize(proposalFiles(LEGAL_RENAMED)));
    const illegalGate = lintOf(materialize(proposalFiles(ILLEGAL_RENAMED['multi-line'])));
    const conservationGate = lintOf(materialize(proposalFiles(conservationDelta, conservationTarget)));
    const inlineGate = lintOf(materialize(proposalFiles(inlineDelta, inlineTarget)));
    for (const gate of [illegalGate, conservationGate, inlineGate]) {
      expect(gate.checkIds).toEqual(legalGate.checkIds);   // 标识集合
      expect(gate.total).toBe(legalGate.total);            // 总数
    }
    // ① 是预期新增拒绝分支：L4 失败、pass=false、通过数恰少于总数
    expect(illegalGate.pass).toBe(false);
    expect(illegalGate.passed).toBeLessThan(illegalGate.total);
    expect(illegalGate.checkViolations['4']).toBeGreaterThan(0);
    // ③ 守恒分支：§2.73 下为 **warning**，故 pass=true、通过数等于总数、L8 零违规。
    //    （与 ST-S35-33 步骤⑤ 对 ③ 的「预期拒绝」措辞冲突，见步骤③ 处的留痕。）
    expect(conservationGate.pass).toBe(true);
    expect(conservationGate.passed).toBe(conservationGate.total);
    expect(conservationGate.checkViolations['8']).toBe(0);
    // ② 与 ④ 是不受影响 / 合法分支：全部检查项通过
    expect(legalGate.pass).toBe(true);
    expect(legalGate.passed).toBe(legalGate.total);
    expect(inlineGate.pass).toBe(true);
    expect(inlineGate.passed).toBe(inlineGate.total);

    // ⑥ change-lint 项目级零写入：同一夹具重复求值结论稳定
    expect(lintOf(legal)).toEqual({ ...legalGate, pass: legalGate.pass });
  });
});
