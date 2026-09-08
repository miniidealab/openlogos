/**
 * S09 三处形态订正（lite-cut3a）：决策澄清 → 文档、UI provenance → 警告、seed 恢复门 → 隔离并继续。
 *
 * 覆盖 UT-S09-344 / UT-S09-345 / UT-S09-346 / ST-S09-142 / ST-S09-143，对应功能规格 §2.74。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { evaluatePlanPackage } from '../src/lib/plan-package.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { runsRoot, journalPath } from '../src/lib/baseline-seed-txn.js';
import { checkUiHashMatch } from '../src/lib/ui-provenance.js';
import { cleanupFixtureRoots, frontierFixture, invoke, put, repoRoot } from './frontier-fixture.js';

afterAll(cleanupFixtureRoots);

/** 把 fixture 的「## 决策澄清」小节替换为给定内容（null 表示整节移除）。 */
function setClarification(proposalPath: string, yaml: string | null): void {
  const content = readFileSync(proposalPath, 'utf8');
  const head = content.split('## 决策澄清')[0];
  writeFileSync(proposalPath, yaml === null ? head : `${head}## 决策澄清\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n`);
}

describe('决策澄清由判定改为文档 — S09（§2.74.1）', () => {
  it('UT-S09-344: 决策澄清不再参与任何判定', () => {
    const variants: Array<{ label: string; yaml: string | null }> = [
      { label: '无小节', yaml: null },
      { label: 'YAML 语法非法', yaml: 'schema: openlogos/clarification@1\nimpacts: [unclosed\n  : : :' },
      { label: 'id 不匹配 CXX', yaml: 'schema: openlogos/clarification@1\nmode: provided\nstatus: complete\ndecisions:\n  - id: 不合法\n    category: 乱填' },
      { label: '完整合法', yaml: 'schema: openlogos/clarification@1\nmode: provided\nstatus: complete\nimpacts:\n  data: {status: none, reason: 无}\ndecisions: []\nunresolved: []\ndefaults: []' },
    ];
    for (const { label, yaml } of variants) {
      const f = frontierFixture();
      setClarification(join(f.proposalDir, 'proposal.md'), yaml);

      const plan = evaluatePlanPackage(f.root, f.proposalDir);
      expect(plan.issues.map(i => i.code), `${label}：不得产生 clarification 判定`)
        .not.toContain('proposal_clarification_invalid');
      // plan_state 不再携带 clarification 字段
      expect(JSON.stringify(plan)).not.toContain('"clarification"');

      const lint = runChangeLint(f.root, f.proposalDir, f.slug);
      expect(lint.ok, label).toBe(true);
      expect(lint.ok === true && lint.violations.map(v => v.code), label)
        .not.toContain('clarification_contract_invalid');
    }
    // 模板仍生成该小节——它作为文档保留
    const tpl = frontierFixture();
    put(tpl.root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: 'tpl-probe', module: 'core' }));
    expect(invoke(['change', 'tpl-probe'], tpl.root).status).toBe(0);
    expect(readFileSync(join(tpl.root, 'logos/changes/tpl-probe/proposal.md'), 'utf8')).toContain('## 决策澄清');
  });

  it('ST-S09-142: 真实 CLI 下无决策澄清小节的提案全链通过', () => {
    const f = frontierFixture();
    setClarification(join(f.proposalDir, 'proposal.md'), null);
    expect(readFileSync(join(f.proposalDir, 'proposal.md'), 'utf8')).not.toContain('决策澄清');

    const lint = invoke(['change-lint', '--slug', f.slug], f.root);
    expect(lint.status, lint.stderr).toBe(0);
    expect(lint.stdout).not.toMatch(/澄清|clarification/i);

    const merged = invoke(['merge', f.slug], f.root);
    expect(merged.status, merged.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
  });
});

describe('UI provenance 与 seed 恢复门降级 — S09（§2.74.2 / §2.74.3）', () => {
  it('UT-S09-345: UI provenance 失配降为告警，诊断能力不减', () => {
    const f = frontierFixture();
    // 构造 full provenance + 原型在批准后被改动（hash 漂移）
    const proto = join(f.proposalDir, 'deltas', 'prd', '2-product-design', '2-page-design');
    mkdirSync(proto, { recursive: true });
    writeFileSync(join(proto, 'core-01-home.html'), '<html>批准后被改动</html>');
    writeFileSync(join(f.proposalDir, 'PLAN_APPROVED'), JSON.stringify({
      ui_prototype_rendered: true,
      pages: ['core-01-home.html'],
      hashes: { 'core-01-home.html': 'f'.repeat(64) },
    }));

    // 诊断命令仍如实报失配
    expect(checkUiHashMatch(f.proposalDir).ok, 'check-ui-hash-match 必须仍能发现漂移').toBe(false);

    // merge 不再因此拒绝
    const merged = invoke(['merge', f.slug], f.root);
    expect(merged.status, merged.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(true);
  });

  it('UT-S09-346: 损坏 seed journal 被隔离而非阻塞', () => {
    const broken = [
      { label: '非法 JSON', body: '{broken' },
      { label: 'schema 非法', body: '[]' },
      { label: '必填字段缺失', body: JSON.stringify({ phase: 'prepared' }) },
    ];
    for (const { label, body } of broken) {
      const f = frontierFixture();
      put(f.root, 'logos/logos-project.yaml', [
        'project:', '  name: F', 'modules:', '  - id: core', '    name: Core',
        '    lifecycle: launched', '    bootstrap: adopted', '    baseline_seed_state: partial',
        'scenario_counter:', '  next_id: 40', 'resource_index: []', '',
      ].join('\n'));
      const runId = 'seed-core-broken';
      mkdirSync(join(runsRoot(f.root), runId), { recursive: true });
      writeFileSync(journalPath(f.root, runId), body);

      // 三个只读消费者均零退出
      for (const cmd of ['status', 'next', 'change-lint']) {
        const r = invoke(cmd === 'change-lint' ? [cmd, '--slug', f.slug] : [cmd], f.root);
        expect(r.status, `${label} / ${cmd}：${r.stderr}`).toBe(0);
      }
      // 损坏 journal 被隔离留存：原路径消失、隔离副本内容逐字节保留
      expect(existsSync(journalPath(f.root, runId)), `${label}：原 journal 应已移走`).toBe(false);
      const files = readdirSync(join(runsRoot(f.root), runId));
      const quarantined = files.find(n => n.includes('.corrupt-'));
      expect(quarantined, `${label}：应存在隔离副本`).toBeDefined();
      expect(readFileSync(join(runsRoot(f.root), runId, quarantined!), 'utf8')).toBe(body);
    }
  });

  it('ST-S09-143: GUI overlay 仅剩原型节点', () => {
    const raw = readFileSync(join(repoRoot, 'spec', 'flow', 'overlays', 'gui-ui-first.yaml'), 'utf8');
    const doc = parseYaml(raw) as { overlay: Array<{ op: string; node: { id: string } }> };
    expect(doc.overlay).toHaveLength(1);
    expect(doc.overlay[0].op).toBe('add');
    expect(doc.overlay[0].node.id).toBe('write-ui-prototype');
    expect(raw).not.toContain('id: verify-ui-provenance');

    // 两个诊断命令照常可用（未随节点移除而消失）
    const f = frontierFixture();
    for (const cmd of ['check-ui-prototype', 'check-ui-hash-match']) {
      const r = invoke([cmd], f.root);
      expect(typeof r.status, `${cmd} 应仍可调用`).toBe('number');
      expect(r.stderr).not.toContain('Unknown command');
    }
  });
});
