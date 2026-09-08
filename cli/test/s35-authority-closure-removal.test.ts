/**
 * S35 change-lint 检查项收敛与存量 authority_impact 兼容（lite-cut2a-remove-authority-closure）。
 *
 * 覆盖 UT-S35-134 / UT-S35-135 / ST-S35-26。L10 权威闭包删除后：
 * 检查项收敛为 L0～L9，其余级别结论零漂移；存量 `authority_impact` 块一律忽略而非报错。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runChangeLint } from '../src/lib/change-lint.js';
import { cleanupFixtureRoots, frontierFixture, invoke, put } from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

/** 历史 `authority_impact` 块的四种形态——完整 required / not_applicable / 字段残缺 / YAML 非法。 */
const LEGACY_BLOCKS: Array<{ label: string; yaml: string }> = [
  {
    label: '完整 required',
    yaml: [
      'authority_impact:', '  schema: openlogos/authority-impact@1',
      '  applicability: required', '  trigger_reasons: [shared_business_fact]',
      '  facts:', '    - fact_id: merge.spec-complete', '      change: create',
      '      authority_ref: spec/change-management.md#merge', '      sole_writer: openlogos merge',
      '      tests: [UT-S01-01]', '  unresolved: []',
    ].join('\n'),
  },
  {
    label: 'not_applicable',
    yaml: [
      'authority_impact:', '  schema: openlogos/authority-impact@1',
      '  applicability: not_applicable', '  evidence: [纯文案变更]',
    ].join('\n'),
  },
  {
    label: '字段残缺',
    yaml: ['authority_impact:', '  applicability: required', '  facts:', '    - fact_id: x'].join('\n'),
  },
  {
    label: 'YAML 非法',
    yaml: ['authority_impact:', '  facts: [unclosed', '   : : :'].join('\n'),
  },
];

function withAuthorityBlock(proposalPath: string, yaml: string): void {
  const content = readFileSync(proposalPath, 'utf8');
  writeFileSync(proposalPath, `${content.trimEnd()}\n\n## Authority Impact\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
}

describe('L10 删除后的 change-lint 检查项与兼容 — S35', () => {
  it('UT-S35-134: 检查项集合收敛为 10 项且其余级别零漂移', () => {
    const f = frontierFixture();
    const before = runChangeLint(f.root, f.proposalDir, f.slug);
    expect(before.ok).toBe(true);

    // ① 检查项恰为 L0～L9，不含任何 L10 条目
    const ids = before.checks!.map(c => c.id).sort((a, b) => a - b);
    expect(ids).not.toContain(10);
    expect(Math.max(...ids)).toBeLessThanOrEqual(9);
    expect(before.checks!.some(c => /Authority|权威闭包/.test(c.label))).toBe(false);

    // ② envelope 不再挂 authority 维度
    expect((before as unknown as Record<string, unknown>).authority_closure).toBeUndefined();

    // ③ 其余级别结论零漂移：带上历史 authority 块后逐条相同
    const withBlock = frontierFixture();
    withAuthorityBlock(join(withBlock.proposalDir, 'proposal.md'), LEGACY_BLOCKS[0].yaml);
    const after = runChangeLint(withBlock.root, withBlock.proposalDir, withBlock.slug);
    const shape = (r: typeof before) => ({
      ids: r.checks!.map(c => c.id),
      violations: r.violations.map(v => `${v.code}::${v.path}::${v.message}`),
    });
    expect(shape(after)).toEqual(shape(before));
  });

  it('UT-S35-135: 存量 authority_impact 块被忽略而非报错', () => {
    for (const block of LEGACY_BLOCKS) {
      const f = frontierFixture();
      withAuthorityBlock(join(f.proposalDir, 'proposal.md'), block.yaml);
      const result = runChangeLint(f.root, f.proposalDir, f.slug);
      expect(result.ok, `${block.label}：预检须能完成`).toBe(true);
      expect(result.violations, `${block.label}：不得产生任何 violation`).toEqual([]);
      // 块内容不被解析——诊断中不出现 fact_id / 字段名相关线索
      const text = JSON.stringify(result);
      expect(text, `${block.label}`).not.toMatch(/authority_impact|authority_closure|fact_id|sole_writer/);
      expect(result.warnings ?? [], `${block.label}：也不得降级为 warning`).toEqual([]);
    }
  });
});

describe('L10 删除后的端到端 — S35', () => {
  it('ST-S35-26: 真实 CLI 下无 authority_impact 的提案全链通过', () => {
    const f = frontierFixture();
    // 前置：提案完全不含 Authority Impact 小节
    const proposalPath = join(f.proposalDir, 'proposal.md');
    expect(readFileSync(proposalPath, 'utf8')).not.toContain('Authority Impact');

    // ① change-lint PASS（10/10），envelope 无 authority 码与维度
    const lint = invoke(['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
    expect(lint.status, lint.stderr).toBe(0);
    const envelope = JSON.parse(lint.stdout.trim().split('\n').pop()!);
    expect(envelope.data.pass).toBe(true);
    expect(envelope.data.violations).toEqual([]);
    expect(envelope.data.authority_closure).toBeUndefined();
    expect(envelope.data.plan_package.authority_closure).toBeUndefined();
    expect(JSON.stringify(envelope)).not.toMatch(/authority_closure_incomplete|authority_impact_/);
    // 文本形态：检查项编号上界为 9，无 L10 行（总数随 L7/L9 的条件在场而变，最多 10 项）
    const lintText = invoke(['change-lint', '--slug', f.slug], f.root);
    expect(lintText.stdout).toMatch(/PASS（\d+\/\d+）/);
    expect(lintText.stdout).not.toMatch(/Authority|权威闭包/);
    expect(lintText.stdout).not.toMatch(/^\s*[✓✗] L10 /m);
    const shown = [...lintText.stdout.matchAll(/^\s*[✓✗] L(\d+) /gm)].map(m => Number(m[1]));
    expect(shown.length).toBeGreaterThan(0);
    expect(Math.max(...shown)).toBeLessThanOrEqual(9);

    // ② merge 成功并写 SPEC_MERGED；全程无「缺声明」类诊断
    const merged = invoke(['merge', f.slug], f.root);
    expect(merged.status, merged.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
    expect(merged.stderr).not.toMatch(/authority|声明缺失/i);

    // ③ 新建提案的模板不再生成 Authority Impact 小节
    const fresh = frontierFixture();
    mkdirSync(join(fresh.root, 'logos', 'changes'), { recursive: true });
    put(fresh.root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: 'tpl-probe', module: 'core' }));
    const created = invoke(['change', 'tpl-probe'], fresh.root);
    expect(created.status, created.stderr).toBe(0);
    const template = readFileSync(join(fresh.root, 'logos/changes/tpl-probe/proposal.md'), 'utf8');
    expect(template).not.toContain('Authority Impact');
    expect(template).not.toContain('authority_impact');
  });
});
