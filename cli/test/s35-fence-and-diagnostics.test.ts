/**
 * S35 围栏提取单点与诊断可归因（lite-cut2a 迁座自 s35-fence-scan-attribution.test.ts）。
 *
 * 覆盖 UT-S35-127、UT-S35-130。原实现以 `authority-closure` 为对照组，该模块随 L10 删除；
 * 本文件把同一判据改挂到存活的提取器上——判据本身（掩码单点、诊断点名具体对象）逐字不变。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { readUiUxDeclaration } from '../src/lib/ui-first.js';
import { evaluateProposalClarification } from '../src/lib/clarification.js';
import { authorityScan, fenceMask, scanMarkdownAuthorityStructure } from '../src/lib/markdown-scan.js';
import { runChangeLint } from '../src/lib/change-lint.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** 四反引号 markdown 示意块，块内含一段 yaml——裸正则会把它误算为真实声明。 */
const NESTED_SAMPLE = [
  '## 说明', '',
  '````markdown',
  '下面是**示意**，不是真实声明：', '',
  '```yaml',
  'baseline_closure:',
  '  policy: on-touch-v1',
  '  schema_version: 1',
  '  targets: []',
  '```',
  '````', '',
].join('\n');

const REAL_CLOSURE = [
  '## 基线闭包计划', '',
  '```yaml',
  'baseline_closure:',
  '  policy: on-touch-v1',
  '  schema_version: 1',
  '  unit: canonical-merge-target-path',
  '  delta_cardinality: exactly-one-per-non-skip-target',
  '  effective_view: merged-resources-plus-current-change-deltas',
  '  ambiguity: block-before-existing-plan-exit',
  '  standalone_baseline_required: false',
  '  jit_confirmation: disabled',
  '  touched_scenario_ids: [S99]',
  '  targets: []',
  '```', '',
].join('\n');

function proposal(extra: string): string {
  return `# 围栏夹具提案

> module: core

## 变更原因
围栏夹具。

## 变更类型
需求级变更。

## 变更范围
- 影响的功能规格：夹具

## 部署影响
- 是否需要部署：否
- 部署原因：夹具
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## UI/UX 变更声明

\`\`\`yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
\`\`\`

${extra}
## 决策澄清

\`\`\`yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data: {status: none, reason: 无数据影响}
  compatibility: {status: none, reason: 无兼容选择}
  security_privacy: {status: none, reason: 无安全隐私影响}
  public_release: {status: none, reason: 无公开发布}
  external_commitment: {status: none, reason: 无外部承诺}
decisions: []
unresolved: []
defaults: []
\`\`\`

## 变更概述
围栏夹具。
`;
}

function setup(content: string) {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  const dir = join(root, 'logos', 'changes', 'fence-fixture');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), content);
  writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n\n- [ ] 规划 `deltas/test/core-S99-test-cases.md` 中的 `UT-S99-01`。\n\n## [code] 代码实现\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'fence-fixture', module: 'core' }));
  return { root, dir, content };
}

describe('S35 围栏提取单点与可归因', () => {
  it('UT-S35-127: 围栏提取与其余提取器同源', () => {
    // 含嵌套围栏的文档：四反引号块内示意一段 baseline_closure yaml，块外另有一段真实声明。
    const f = setup(proposal(`${NESTED_SAMPLE}${REAL_CLOSURE}`));
    const lines = f.content.split('\n');

    // ① 共享掩码把示意块整体标记为围栏内容——块内那段 yaml 不构成声明
    const scan = authorityScan(lines);
    const mask = fenceMask(lines);
    const sampleLine = lines.findIndex(l => l.trim() === 'policy: on-touch-v1');
    expect(sampleLine).toBeGreaterThan(-1);
    expect(scan.masked[sampleLine], '示意块内的行必须被掩码').toBe(true);
    expect(mask[sampleLine]).toBe(true);

    // ② 存活的提取器对同一文档得到同一组围栏：均只见块外那一处真实声明，示意块不构成第二处
    const structure = scanMarkdownAuthorityStructure(f.content);
    const closureFences = structure.fences.filter(fence => /ya?ml/i.test(fence.info) && fence.content.includes('baseline_closure:'));
    expect(closureFences, '共享结构扫描中恰有一处 yaml 闭包声明围栏').toHaveLength(1);

    // clarification 与 ui-first 走同一掩码：各自只解析到自己小节内的唯一围栏，不受示意块干扰
    const clarification = evaluateProposalClarification(f.content);
    expect(clarification.present).toBe(true);
    expect(clarification.valid, JSON.stringify(clarification.issues ?? [])).toBe(true);
    expect(readUiUxDeclaration(f.dir).ui_impact).toBe(false);

    // ③ 裸正则的反面：不走掩码时会把示意块也算进来，命中 2 处
    const naive = [...f.content.matchAll(/^baseline_closure\s*:/gm)];
    expect(naive.length, '裸正则会多命中示意块——这正是掩码必须单点的原因').toBe(2);
  });

  it('UT-S35-130: 诊断点名具体对象', () => {
    // 构造触发各类 change-lint 违规的提案，逐条断言诊断中出现导致失败的实体本身。
    const f = setup(proposal(REAL_CLOSURE));
    // delta 缺段标记 → 必须点名该 delta 文件路径
    const deltaDir = join(f.dir, 'deltas', 'test');
    mkdirSync(deltaDir, { recursive: true });
    writeFileSync(join(deltaDir, 'core-S99-test-cases.md'), '没有任何段标记的正文。\n');

    const result = runChangeLint(f.root, f.dir, 'fence-fixture');
    expect(result.ok).toBe(true);
    expect(result.violations.length).toBeGreaterThan(0);

    for (const v of result.violations) {
      const text = `${v.path} ${v.message} ${v.fix_hint ?? ''}`;
      // 每条诊断都必须出现导致失败的实体本身：文件路径 / 测试 ID / 字段名 / 章节锚
      const namesConcreteObject = /[\w-]+\.(?:md|ts|json|yaml)/.test(text)
        || /(?:UT|ST|SMOKE)-[A-Za-z0-9]+-[A-Za-z0-9.]+/.test(text)
        || /`[^`]+`/.test(text)
        || /「[^」]+」/.test(text);
      expect(namesConcreteObject, `诊断未点名具体对象：[${v.code}] ${text}`).toBe(true);
      // 禁止「为空、非法或不在某集合中」这类无法定位的措辞组合
      expect(text, `诊断措辞无法定位：[${v.code}]`).not.toMatch(/为空、非法或不在/);
    }
    // 缺段标记这一条必须点名该 delta 的具体路径
    const marker = result.violations.find(v => v.code === 'delta_missing_section_marker');
    expect(marker, JSON.stringify(result.violations.map(v => v.code))).toBeDefined();
    expect(`${marker!.path} ${marker!.message}`).toContain('core-S99-test-cases.md');
  });
});
