/**
 * S09 — proposal.md 形态的单一来源约定（single-source-proposal-scaffold）。
 * 覆盖 UT-S09-362、UT-S09-363、UT-S09-364（与 logos/resources/test/core-S09-test-cases.md 严格对齐）。
 *
 * 三条用例均为**仓库文本静态断言**，读取对象一律是根权威 `skills/`、`spec/`——断言 `logos/skills/`、
 * `logos/spec/` 下的 dogfood 副本等于放过「根权威未改、副本先行」的漂移，属无效证据。
 *
 * 每条用例都带负向样例（本次改动**前**的真实原文）：只断言「现状判绿」而不证明「旧形态判红」，
 * 无法排除判据写成恒真。结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_SECTION_REGISTRY } from '../src/lib/plan-package-contract.js';
import { authorityScan } from '../src/lib/markdown-scan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

/** 根权威文件——不得替换为 logos/skills、logos/spec 下的 dogfood 副本。 */
const SKILL_ZH = join(REPO_ROOT, 'skills', 'change-writer', 'SKILL.md');
const SKILL_EN = join(REPO_ROOT, 'skills', 'change-writer', 'SKILL.en.md');
const SPEC_CM = join(REPO_ROOT, 'spec', 'change-management.md');

const read = (p: string) => readFileSync(p, 'utf-8');

/**
 * 截取以 `startRe` 开头的章节，至下一个同级或更高级 ATX 标题止。
 *
 * **必须 fence-aware**：proposal 模板自带 `# 变更提案` / `# Change Proposal` 一级标题，
 * 天真的行扫描会把 fenced block 内的这一行当成新章节、在模板开头就截断 Step 4 段——
 * 于是「段内有无可复制骨架」的判据永远看不到那个 block，对真实旧模板形态失效。
 * 围栏识别复用既有单点 `authorityScan`（masked 行 = 围栏/注释内），不另写第二份提取。
 */
function sectionOf(content: string, startRe: RegExp): string {
  const lines = content.split('\n');
  const { masked } = authorityScan(lines);
  const start = lines.findIndex((l, i) => !masked[i] && startRe.test(l));
  if (start < 0) throw new Error(`未找到章节：${startRe}`);
  const level = (lines[start].match(/^#+/) ?? ['###'])[0].length;
  for (let i = start + 1; i < lines.length; i++) {
    if (masked[i]) continue;
    const m = lines[i].match(/^(#+)\s/);
    if (m && m[1].length <= level) return lines.slice(start, i).join('\n');
  }
  return lines.slice(start).join('\n');
}

/** 段内每个 fenced code block 中 `^## ` 级标题行的最大条数。 */
function maxSectionHeadingsInAnyFence(segment: string): number {
  const blocks = segment.match(/```[\s\S]*?```/g) ?? [];
  return blocks.reduce((max, b) => Math.max(max, (b.match(/^## /gm) ?? []).length), 0);
}

/** 判据：段内任一 fenced block 含 >=3 个 `## ` 标题 = 可整块复制的提案骨架。 */
const COPYABLE_SKELETON_THRESHOLD = 3;
const isCopyableSkeleton = (segment: string) =>
  maxSectionHeadingsInAnyFence(segment) >= COPYABLE_SKELETON_THRESHOLD;

/** 本次改动前的 zh 旧模板（`skills/change-writer/SKILL.md` Step 4 原文，5 个 `## ` 标题）。 */
const LEGACY_TEMPLATE_ZH = [
  '按以下模板生成，写入 `logos/changes/<slug>/proposal.md`：', '',
  '```markdown', '# 变更提案：[变更名称]', '',
  '## 变更原因', '[为什么要做这个变更？来源于哪个需求/反馈/Bug？]', '',
  '## 变更类型', '[需求级 / 设计级 / 接口级 / 部署级 / 代码级]', '',
  '## 变更范围', '- 影响的需求文档：[列表，精确到文件名和章节]', '',
  '## 部署影响', '- 是否需要部署：是 / 否', '',
  '## 变更概述', '[用 1-3 段话概述具体改什么]', '```',
].join('\n');

/**
 * 本次改动前的 en 旧模板（`SKILL.en.md` Step 4 原文，4 个 `## ` 标题）。
 * 其中只有 `Change Type` 精确等于 PLAN_SECTION_REGISTRY.type.en——这正是「按 registry 命中数判」
 * 会漏检的那一侧，故本夹具不可省。
 */
const LEGACY_TEMPLATE_EN = [
  'Generate using the following template and write to `logos/changes/<slug>/proposal.md`:', '',
  '```markdown', '# Change Proposal: [Change Name]', '',
  '## Reason for Change', '[Why is this change needed?]', '',
  '## Change Type', '[Requirement-level / Design-level / Interface-level / Code-level]', '',
  '## Change Scope', '- Affected requirement documents: [List]', '',
  '## Change Summary', '[Describe in 1-3 paragraphs what specifically will change]', '```',
].join('\n');

/** 本次改动前的 spec 旧内嵌模板（`spec/change-management.md` §proposal.md 原文，5 个 `## ` 标题）。 */
const LEGACY_TEMPLATE_SPEC = [
  '变更说明文档，必须包含：', '',
  '```markdown', '# 变更提案：[变更名称]', '',
  '## 变更原因', '[为什么要做这个变更？]', '',
  '## 变更类型', '[需求级 / 设计级 / 接口级 / 代码级]', '',
  '## 变更范围', '- 影响的需求文档：[列表]', '',
  '## 部署影响', '- 是否需要部署：是 / 否', '',
  '## 变更概述', '[用 1-3 段话概述具体改什么]', '```',
].join('\n');

/**
 * 「以整篇重写为前提的段保留指令」检出：按句切分后，同句既讲整篇重写又讲保留，
 * 且不带禁止性措辞 —— 即 `整篇重写 proposal.md 时必须原样保留该段` 那一形态。
 */
function rewritePremisedRetentionSentences(content: string): string[] {
  return content
    .split(/[。；\n]/)
    .filter(s => s.includes('整篇重写') && s.includes('保留')
      && !/禁止|不得|不以|严禁|绝不/.test(s));
}

/** 改动前 SKILL.md:315 的真实原文片段（负向样例）。 */
const LEGACY_UI_RETENTION_ZH =
  '整篇重写 `proposal.md` 时**必须原样保留该段**：本次不动界面就保留段并如实写 `ui_impact: false`';

describe('S09 proposal.md 单一来源与防复发', () => {
  it('UT-S09-362 Step 4 不得再出现可整块复制的提案模板，且须指向既有保真条款', () => {
    const zh = sectionOf(read(SKILL_ZH), /^### Step 4: 生成 proposal\.md\s*$/);
    const en = sectionOf(read(SKILL_EN), /^### Step 4: Generate proposal\.md\s*$/);

    // 正向：现行两份 Step 4 均无可整块复制的骨架（填写要点以列表承载，不入 fenced block）。
    expect(isCopyableSkeleton(zh)).toBe(false);
    expect(isCopyableSkeleton(en)).toBe(false);

    // 负向样例（有效性前提）：两份旧模板都必须被同一判据检出。
    expect(isCopyableSkeleton(LEGACY_TEMPLATE_ZH)).toBe(true);
    expect(isCopyableSkeleton(LEGACY_TEMPLATE_EN)).toBe(true);

    // 判据不绑定 registry 名称命中：en 旧模板 4 个标题中仅 1 个精确命中，按命中数判会漏检。
    const enRegistryHits = (LEGACY_TEMPLATE_EN.match(/^## (.+)$/gm) ?? [])
      .map(h => h.replace(/^## /, '').trim())
      .filter(h => Object.values(PLAN_SECTION_REGISTRY).some(t => t.en === h));
    expect(enRegistryHits).toEqual(['Change Type']);

    // 指令与指向。
    expect(zh).toMatch(/原地逐段填写/);
    expect(zh).toMatch(/禁止整篇重写/);
    expect(zh).toMatch(/canonical scaffold 保真/);
    expect(en).toMatch(/[Ff]ill it in place/);
    expect(en).toMatch(/[Nn]ever rewrite the file as a whole/);
    expect(en).toMatch(/Preserve the CLI scaffold/);
  });

  it('UT-S09-363 spec 不得自列必填章节清单，须指向脚手架与 change-lint 两个唯一来源', () => {
    const spec = read(SPEC_CM);
    const sec = sectionOf(spec, /^### proposal\.md\s*$/);

    // 正向 + 负向：内嵌模板已删，旧形态被同一判据检出。
    expect(isCopyableSkeleton(sec)).toBe(false);
    expect(isCopyableSkeleton(LEGACY_TEMPLATE_SPEC)).toBe(true);

    // 不再自列必填清单。
    expect(sec).not.toMatch(/变更说明文档，必须包含/);

    // 双唯一来源在场。
    expect(sec).toMatch(/proposalTemplate/);
    expect(sec).toMatch(/PLAN_SECTION_REGISTRY/);
    expect(sec).toMatch(/change-lint/);

    // 部署决策解析规范逐字保留——防止借本次删除顺手删掉无关内容。
    expect(sec).toContain('`## 部署影响` 是人工审核依据。CLI 的部署状态判断以 `tasks.md` 的 `[deploy]` section 和提案目录标记文件为准，不解析自由文本作为唯一依据。');
    expect(sec).toContain('`是否需要部署：否` 时，不得创建 `[deploy]` section；verify PASS 后下一步为 archive。');
    expect(sec).toContain('旧提案缺少结构化部署影响时，CLI 可回退到 `[deploy]` section 与模块级默认值，但必须标注兼容来源。');
  });

  it('UT-S09-364 保真条款覆盖非 canonical 段且不波及 tasks.md；全文无「整篇重写」前提的保留指令', () => {
    const zhAll = read(SKILL_ZH);
    const zh = sectionOf(zhAll, /^### canonical scaffold 保真\s*$/);
    const en = sectionOf(read(SKILL_EN), /^### Preserve the CLI scaffold\s*$/);

    // ① 保护范围覆盖不受 lint 强制的非 canonical 段。
    expect(zh).toMatch(/最小实现论证/);
    expect(zh).toMatch(/非 canonical 段|不受 lint 强制/);
    expect(en).toMatch(/Minimal Implementation Rationale/);
    expect(en).toMatch(/non-canonical sections|no lint enforces/);

    // ② 显式限定不约束 tasks.md 的 section 增删，并指向 tasks-spec。
    expect(zh).toMatch(/不约束 section 的增删|不约束 `tasks\.md`/);
    expect(zh).toMatch(/tasks-spec\.md/);
    expect(en).toMatch(/does \*\*not\*\* constrain adding or removing sections/);
    expect(en).toMatch(/tasks-spec\.md/);

    // ③ 全文不得再有以「整篇重写」为前提的段保留指令；负向样例证明判据非恒真。
    expect(rewritePremisedRetentionSentences(zhAll)).toEqual([]);
    expect(rewritePremisedRetentionSentences(LEGACY_UI_RETENTION_ZH).length).toBeGreaterThan(0);

    // 20260914 事故实证段逐字保留。
    expect(zhAll).toContain('20260914 事故实证');
    expect(zhAll).toContain('ui_declaration_missing');
  });
});
