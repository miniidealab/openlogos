/**
 * S09 — 提案模板「最小实现论证」段（anti-overdesign-scale-signals，刀二）。
 * 覆盖 UT-S09-360、UT-S09-361（与 logos/resources/test/core-S09-test-cases.md 严格对齐）。
 *
 * 本段的语义本体是**它不受检**：不进 canonical 必填章节，且其占位文本不在既有
 * `hasPlaceholder` 枚举内——缺段 / 未填 / 占位残留三者均不告警。UT-S09-361 的对照臂
 * 是该结论的有效性前提：只断言「填妥后零 issue」而不证明「未填时确有 5 项」，
 * 无法排除既有判据被整体削弱。
 *
 * 夹具在一次性隔离项目内构造；UT-S09-360 走真实 CLI 子进程（模板到落盘的写入路径同属被测范围）。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, registerCoreModule } from './helpers.js';
import { evaluateProposalStructure } from '../src/lib/plan-package-contract.js';
import { proposalTemplate } from '../src/i18n.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(resolve(HERE, '..', '..'), 'cli');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const HEADINGS = {
  zh: { reason: '## 变更原因', minimal: '## 最小实现论证', type: '## 变更类型' },
  en: { reason: '## Reason', minimal: '## Minimal Implementation Rationale', type: '## Change Type' },
} as const;

/** 真实 `openlogos change <slug>` 产出的 proposal.md 原文。 */
function realChangeProposal(locale: 'zh' | 'en'): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale });
  registerCoreModule(root, 'launched');
  const slug = 'tpl-fixture';
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), 'change', slug], {
    cwd: root, encoding: 'utf-8', env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
  });
  if (r.status !== 0) throw new Error(`openlogos change 失败：${r.stderr || r.stdout}`);
  return readFileSync(join(root, 'logos', 'changes', slug, 'proposal.md'), 'utf-8');
}

function headingLine(content: string, heading: string): number {
  return content.split('\n').findIndex(l => l.trim() === heading);
}

describe('S09 提案模板「最小实现论证」段', () => {
  it('UT-S09-360 zh / en 两套模板成对含该段，且位置在「变更类型」之前', () => {
    for (const locale of ['zh', 'en'] as const) {
      const content = realChangeProposal(locale);
      const h = HEADINGS[locale];
      const reason = headingLine(content, h.reason);
      const minimal = headingLine(content, h.minimal);
      const type = headingLine(content, h.type);
      expect(minimal, `${locale} 模板缺「最小实现论证」段`).toBeGreaterThan(-1);
      expect(reason).toBeGreaterThan(-1);
      expect(type).toBeGreaterThan(-1);
      expect(reason, `${locale}: 该段须在「变更原因」之后`).toBeLessThan(minimal);
      expect(minimal, `${locale}: 该段须在「变更类型」之前`).toBeLessThan(type);
      // 三个占位提示齐备。
      const body = content.split('\n').slice(minimal + 1, type).join('\n');
      const probes = locale === 'zh'
        ? ['先检索既有机制', '为什么不能更小', '主动砍掉']
        : ['Existing mechanisms searched', 'cannot be smaller', 'Deliberately cut'];
      for (const probe of probes) expect(body, `${locale}: 缺占位提示 ${probe}`).toContain(probe);
    }
  });

  it('UT-S09-361 该段占位全留仍通过 L0；未填前提的对照臂证明既有判据未被放宽', () => {
    for (const locale of ['zh', 'en'] as const) {
      const raw = proposalTemplate(locale, 'x', 'core');

      // 对照臂（前提有效性证明）：未执行前提步骤的原始模板确实报既有的 5 项。
      const rawIssues = evaluateProposalStructure(raw, 'proposal.md', locale);
      expect(rawIssues, `${locale}: 原始模板应报既有 5 项`).toHaveLength(5);
      expect(rawIssues.filter(i => i.code === 'proposal_placeholder_remaining')).toHaveLength(4);
      expect(rawIssues.filter(i => i.code === 'proposal_deployment_fields_invalid')).toHaveLength(1);
      // 这 5 项全部落在既有 canonical 章节，与新增段无关。
      expect(rawIssues.map(i => i.section_id).sort())
        .toEqual(['deployment', 'reason', 'scope', 'summary', 'type']);

      // 主臂前提：填妥既有 canonical 章节，**仅保留**新增段的全部占位文本。
      const h = HEADINGS[locale];
      const lines = raw.split('\n');
      const minimal = headingLine(raw, h.minimal);
      const type = headingLine(raw, h.type);
      const kept = lines.slice(minimal, type); // 新增段原样保留（占位全留）
      const filled = (locale === 'zh' ? [
        '# 变更提案：x', '', '> module: core', '',
        '## 变更原因', '真实原因正文。', '',
        ...kept,
        '## 变更类型', '设计级', '',
        '## 变更范围', '- 影响的功能规格：core-01', '',
        '## 部署影响', '- 是否需要部署：否', '- 部署原因：无需发布', '- 影响环境：无',
        '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
        '## 变更概述', '真实概述正文。', '',
        '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive',
        'status: ready', 'impacts:', '  data:', '    status: none', '    reason: 无',
        'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
      ] : [
        '# Change Proposal: x', '', '> module: core', '',
        '## Reason', 'A real reason.', '',
        ...kept,
        '## Change Type', 'Design', '',
        '## Scope', '- Affected specs: core-01', '',
        '## Deployment Impact', '- Deployment required: no', '- Deployment reason: none',
        '- Affected environments: none', '- Data migration involved: no',
        '- Rollback plan required: no', '- Smoke required: no', '',
        '## Summary', 'A real summary.', '',
        '## Decision Clarification', '', '```yaml', 'schema: openlogos/clarification@1',
        'mode: adaptive', 'status: ready', 'impacts:', '  data:', '    status: none',
        '    reason: none', 'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
      ]).join('\n');

      // 新增段的占位文本确实原样留在产物里——断言前提成立，避免用例空跑。
      expect(filled).toContain(h.minimal);
      expect(filled).toContain(locale === 'zh' ? '[查了哪些既有能力' : '[which existing capabilities');

      const issues = evaluateProposalStructure(filled, 'proposal.md', locale);
      expect(issues, `${locale}: 新增段占位残留不得产生任何 issue：${JSON.stringify(issues)}`).toHaveLength(0);
    }
  });
});
