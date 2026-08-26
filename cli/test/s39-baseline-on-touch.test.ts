/**
 * S39 baseline-on-touch 实现验收。
 * 用例名中的逐条 UT/ST ID 由全局 OpenLogos reporter 写入 test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import {
  canonicalTargetFromDeltaPath,
  effectiveTargetView,
  evaluateBaselineClosure,
  parseBaselineClosurePlan,
  resolveCanonicalMergeTarget,
  scanCommittedEvidenceFiles,
  validateAndStripNonMarkdownDelta,
  type BaselineClosureCategory,
} from '../src/lib/baseline-closure.js';
import { classifyProposalDeltas } from '../src/lib/delta-classify.js';
import { runChangeLint } from '../src/lib/change-lint.js';
import { backupDir, journalPath, runsRoot } from '../src/lib/baseline-seed-txn.js';
import {
  parseProvenanceSection, reconcileCandidates, serializeProvenanceSection,
} from '../src/lib/baseline-provenance.js';
import {
  applyBaselineClosureBatch, BASELINE_CLOSURE_APPLY_JOURNAL, recoverBaselineClosureApply,
} from '../src/lib/baseline-apply.js';
import { extractUniqueAuthoritySection } from '../src/lib/markdown-scan.js';
import { withCompleteClarification } from './helpers.js';

type Mode = 'MODIFY' | 'CREATE' | 'SKIP' | 'AMBIGUOUS';
interface RawTarget {
  category: BaselineClosureCategory;
  scenario_ids: string[];
  mode: Mode;
  delta_path: string | null;
  reason: string;
  evidence: string[];
  missing_evidence: string[];
}

interface Fixture {
  root: string;
  proposalDir: string;
  slug: string;
  closure: Record<string, unknown> & { touched_scenario_ids: string[]; targets: RawTarget[] };
}

const roots: string[] = [];
const CLI_DIST = join(process.cwd(), 'dist/index.js');
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function sha(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function baseTargets(ids: string[] = ['S39']): RawTarget[] {
  const material: Array<[BaselineClosureCategory, string]> = [
    ['requirement', 'deltas/prd/1-product-requirements/core-req.md'],
    ['feature', 'deltas/prd/2-product-design/1-feature-specs/core-feature.md'],
    ['architecture', 'deltas/prd/3-technical-plan/1-architecture/core-arch.md'],
    ['scenario', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S39.md'],
    ['test', 'deltas/test/core-S39-test-cases.md'],
  ];
  const out: RawTarget[] = material.map(([category, delta_path]) => ({
    category, scenario_ids: ids, mode: 'MODIFY', delta_path,
    reason: `${category} 由 S39 触达并需要最终态更新。`,
    evidence: [`target_exists: ${canonicalTargetFromDeltaPath(delta_path)}`], missing_evidence: [],
  }));
  for (const category of ['api', 'database', 'deployment', 'orchestration', 'smoke'] as BaselineClosureCategory[]) {
    out.push({
      category, scenario_ids: ids, mode: 'SKIP', delta_path: null,
      reason: `${category} 经场景证据判定不适用。`, evidence: [`scenario:${ids[0]}#evidence`], missing_evidence: [],
    });
  }
  return out;
}

function setup(ids: string[] = ['S39']): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-s39-'));
  roots.push(root);
  const slug = 'touch-fixture';
  const proposalDir = join(root, 'logos/changes', slug);
  mkdirSync(proposalDir, { recursive: true });
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 's39', locale: 'zh' }));
  writeFileSync(join(root, 'logos/logos-project.yaml'), [
    'project:', '  name: s39', 'tech_stack:', '  database: sqlite', 'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', '    bootstrap: normal', '    product_type: cli',
  ].join('\n'));
  const closure = {
    policy: 'on-touch-v1', schema_version: 1, unit: 'canonical-merge-target-path',
    delta_cardinality: 'exactly-one-per-non-skip-target',
    effective_view: 'merged-resources-plus-current-change-deltas',
    ambiguity: 'block-before-existing-plan-exit', standalone_baseline_required: false,
    jit_confirmation: 'disabled', touched_scenario_ids: ids, targets: baseTargets(ids),
  };
  const fixture = { root, proposalDir, slug, closure };
  for (const target of closure.targets.filter(t => t.delta_path)) {
    const targetPath = canonicalTargetFromDeltaPath(target.delta_path!)!;
    mkdirSync(dirname(join(root, targetPath)), { recursive: true });
    writeFileSync(join(root, targetPath), `# ${target.category}\n\n既有最终态。\n`);
  }
  writeFixture(fixture, false, false);
  return fixture;
}

function proposalText(f: Fixture): string {
  return withCompleteClarification([
    '# 变更提案', '', '> module: core', '', '## 基线闭包计划', '',
    '```yaml', stringifyYaml({ baseline_closure: f.closure }).trimEnd(), '```', '',
    '## 变更类型', '设计级', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：本地测试', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否',
  ].join('\n'));
}

function writeFixture(f: Fixture, checked: boolean, withDeltas: boolean, overrides = new Map<string, string>()): void {
  writeFileSync(join(f.proposalDir, 'proposal.md'), proposalText(f));
  const material = f.closure.targets.filter(t => t.delta_path !== null);
  const tasks = material.map(t => `- [${checked ? 'x' : ' '}] [${t.mode}] \`${t.delta_path}\`：${t.reason}`).join('\n');
  writeFileSync(join(f.proposalDir, 'tasks.md'), `# 任务\n\n## [delta] 规格变更\n\n${tasks}\n\n## [code] 代码实现\n`);
  if (!withDeltas) return;
  for (const target of material) {
    const path = join(f.proposalDir, target.delta_path!);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, overrides.get(target.delta_path!) ?? `## MODIFIED — 最终态\n\n${target.category} 已更新。\n`);
  }
}

function evaluate(f: Fixture) {
  const proposalContent = readFileSync(join(f.proposalDir, 'proposal.md'), 'utf-8');
  const tasksContent = readFileSync(join(f.proposalDir, 'tasks.md'), 'utf-8');
  const entries = classifyProposalDeltas(f.proposalDir);
  const contents = new Map<string, string>();
  for (const e of entries) {
    if (e.contentProbeEligible) contents.set(e.relativePath, readFileSync(join(f.proposalDir, e.relativePath), 'utf-8'));
  }
  return evaluateBaselineClosure({
    root: f.root, proposalDir: f.proposalDir, slug: f.slug,
    proposalContent, tasksContent, deltaEntries: entries, deltaContents: contents,
  });
}

function targetOf(f: Fixture, category: BaselineClosureCategory): RawTarget {
  return f.closure.targets.find(t => t.category === category)!;
}

function sortClosureTargets(f: Fixture): void {
  const material = f.closure.targets.filter(target => target.delta_path !== null)
    .sort((a, b) => a.delta_path!.localeCompare(b.delta_path!, 'en'));
  const nonMaterial = f.closure.targets.filter(target => target.delta_path === null)
    .sort((a, b) => a.category.localeCompare(b.category, 'en'));
  f.closure.targets = [...material, ...nonMaterial];
}

function removeMergedTarget(f: Fixture, target: RawTarget): void {
  unlinkSync(join(f.root, canonicalTargetFromDeltaPath(target.delta_path!)!));
}

function scenarioViolations(content: string) {
  const f = setup();
  const scenario = targetOf(f, 'scenario');
  scenario.mode = 'CREATE';
  removeMergedTarget(f, scenario);
  writeFixture(f, true, true, new Map([[scenario.delta_path!, content]]));
  return evaluate(f).violations.filter(violation => violation.code === 'create_target_incomplete');
}

function snapshotTree(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) result.set(absolute.slice(root.length + 1), sha(readFileSync(absolute)));
    }
  };
  walk(root);
  return result;
}

function configureDeploymentDecision(
  f: Fixture,
  deploymentRequired: boolean,
  smokeRequired: boolean,
  hasDeploySection: boolean,
): void {
  const configure = (category: 'deployment' | 'smoke', required: boolean, deltaPath: string) => {
    const target = targetOf(f, category);
    target.mode = required ? 'MODIFY' : 'SKIP';
    target.delta_path = required ? deltaPath : null;
    target.evidence = [`proposal.md#部署影响:${category}`];
    target.missing_evidence = [];
    if (required) {
      const targetPath = canonicalTargetFromDeltaPath(deltaPath)!;
      mkdirSync(dirname(join(f.root, targetPath)), { recursive: true });
      writeFileSync(join(f.root, targetPath), `# ${category}\n\n既有发布规格。\n`);
    }
  };
  configure('deployment', deploymentRequired, 'deltas/prd/3-technical-plan/3-deployment/core-deploy.md');
  configure('smoke', smokeRequired, 'deltas/test/smoke/core-smoke.md');
  sortClosureTargets(f);
  writeFixture(f, false, false);
  const proposalPath = join(f.proposalDir, 'proposal.md');
  writeFileSync(proposalPath, readFileSync(proposalPath, 'utf-8')
    .replace('- 是否需要部署：否', `- 是否需要部署：${deploymentRequired ? '是（受控发布）' : '否（无需发布）'}`)
    .replace('- 是否需要 smoke：否', `- 是否需要 smoke：${smokeRequired ? '是（发布后验证）' : '否（无部署环境）'}`));
  if (hasDeploySection) {
    const tasksPath = join(f.proposalDir, 'tasks.md');
    writeFileSync(tasksPath, `${readFileSync(tasksPath, 'utf-8')}\n## [deploy] 部署任务\n\n- [ ] 执行受控发布\n`);
  }
}

const deploymentAuthoritySpoofs: Array<{
  name: string;
  mutate: (content: string) => string;
}> = [
  {
    name: 'fenced code 中的部署示例',
    mutate: content => content.replace(/\n## 部署影响[\s\S]*$/, [
      '', '```markdown', '## 部署影响', '- 是否需要部署：否', '- 是否需要 smoke：否', '```',
    ].join('\n')),
  },
  {
    name: 'HTML comment 中的部署示例',
    mutate: content => content.replace(/\n## 部署影响[\s\S]*$/, [
      '', '<!--', '## 部署影响', '- 是否需要部署：否', '- 是否需要 smoke：否', '-->',
    ].join('\n')),
  },
  {
    name: '两个围栏外同名部署节',
    mutate: content => `${content}\n\n##   部署影响   ##\n- 是否需要部署：否\n- 是否需要 smoke：否`,
  },
  {
    name: 'Setext H2 位于 ATX 部署节之前',
    mutate: content => content.replace('\n## 部署影响', [
      '', '部署影响', '--------', '- 是否需要部署：是', '- 是否需要 smoke：是', '', '## 部署影响',
    ].join('\n')),
  },
  {
    name: 'Setext H2 位于 ATX 部署节之后',
    mutate: content => `${content}\n\n部署影响\n--------\n- 是否需要部署：是\n- 是否需要 smoke：是`,
  },
  {
    name: '权威部署节内字段重复',
    mutate: content => content.replace(
      '- 是否需要部署：否',
      '- 是否需要部署：否\n- 是否需要部署：否',
    ),
  },
  {
    name: 'H1 兄弟章节后的部署示例',
    mutate: content => content.replace(/\n## 部署影响[\s\S]*$/, [
      '', '## 部署影响', '', '# 附录示例', '- 是否需要部署：否', '- 是否需要 smoke：否',
    ].join('\n')),
  },
  {
    name: 'Setext H1 兄弟章节后的部署示例',
    mutate: content => content.replace(/\n## 部署影响[\s\S]*$/, [
      '', '## 部署影响', '', '附录示例', '========', '- 是否需要部署：否', '- 是否需要 smoke：否',
    ].join('\n')),
  },
];

const fullScenario = [
  '## ADDED — S39 完整场景', '', '# S39：目标', '', '## 场景目标', '形成可观察的完整场景。', '',
  '## 参与者', '- User', '- CLI', '', '## 前置条件', '前置成立。', '', '## 成功后置条件', '后置一致。', '',
  '```mermaid', 'sequenceDiagram',
  '  participant U as User', '  participant C as CLI', '  U->>C: 执行步骤', '```', '',
  '## 主路径步骤', '1. 用户发起。', '2. CLI 校验。', '3. CLI 返回。', '',
  '## 异常与边界', '- 异常失败关闭。', '', '## 追溯', '- P04 / UT-S39-12',
].join('\n');

const fullTest = [
  '## ADDED — S39 完整测试', '', '# S39 测试', '', '## 正常路径正例',
  '| ID | 场景 |', '|---|---|', '| UT-S39-01 | 正常 |', '| ST-S39-01 | 端到端 |', '',
  '## 异常', '失败关闭。', '', '## 边界', '空输入。', '', '## 追溯', 'S39。', '',
  '## OpenLogos reporter', '逐条写入 test-results.jsonl。',
].join('\n');

const openApiPayload = [
  'openapi: 3.1.0', 'info:', '  title: Touch API', '  version: 1.0.0',
  'paths:', '  /touch:', '    get:', '      operationId: getTouch', '      security:', '        - bearerAuth: []',
  '      responses:', "        '200':", '          description: ok', "        '400':", '          description: error response',
  'components:', '  securitySchemes:', '    bearerAuth:', '      type: http', '      scheme: bearer',
  '  schemas:', '    Touch:', '      type: object', '      deprecated: false # compatibility contract',
].join('\n') + '\n';

const openApiPathParameterMissingRequired = openApiPayload
  .replace('  /touch:', '  /touch/{id}:')
  .replace('      security:', [
    '      parameters:', '        - name: id', '          in: path',
    '          schema:', '            type: string', '      security:',
  ].join('\n'));

const openApiParameterSchemaAndContent = openApiPayload.replace('      security:', [
  '      parameters:', '        - name: filter', '          in: query',
  '          schema:', '            type: string', '          content:',
  '            application/json:', '              schema:', '                type: string',
  '      security:',
].join('\n'));

const openApiRequestBodyMissingContent = openApiPayload.replace('      security:', [
  '      requestBody:', '        required: true', '        description: missing content',
  '      security:',
].join('\n'));

const sqlitePayload = [
  '-- migration: create touch table', '-- rollback: DROP TABLE touch;',
  'CREATE TABLE touch (', '  id INTEGER PRIMARY KEY,', '  name TEXT NOT NULL UNIQUE,',
  '  parent_id INTEGER,', '  CONSTRAINT fk_parent FOREIGN KEY(parent_id) REFERENCES touch(id)', ');',
  'CREATE INDEX idx_touch_name ON touch(name);',
].join('\n') + '\n';

function writeProductionApplyManifest(f: Fixture, suffix: string): {
  manifestRel: string;
  expected: Map<string, string>;
  before: Map<string, string>;
} {
  const overrides = new Map<string, string>();
  for (const target of f.closure.targets.filter(item => item.delta_path !== null)) {
    overrides.set(target.delta_path!, target.category === 'test'
      ? `## ADDED — 受控补充\n\n| ID | 场景 |\n|---|---|\n| UT-S39-01 | ${suffix} |\n| ST-S39-01 | ${suffix} |\n`
      : `## ADDED — 受控补充\n\n${target.category}-${suffix}\n`);
  }
  writeFixture(f, true, true, overrides);
  writeFileSync(join(f.root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: f.slug, module: 'core' }));
  writeFileSync(join(f.proposalDir, 'MERGE_PROMPT.md'), '# 受控合并指令\n');
  writeFileSync(join(f.proposalDir, 'MERGE_PROMPT_GENERATED'), '');
  const expected = new Map<string, string>();
  const before = new Map<string, string>();
  const prepared = f.closure.targets.filter(item => item.delta_path !== null).map(target => {
    const targetPath = canonicalTargetFromDeltaPath(target.delta_path!)!;
    const delta = readFileSync(join(f.proposalDir, target.delta_path!), 'utf-8');
    const prior = readFileSync(join(f.root, targetPath), 'utf-8');
    const final = `${prior.trimEnd()}\n\n## 受控补充\n\n${target.category}-${suffix}\n`;
    expected.set(targetPath, final);
    before.set(targetPath, prior);
    return {
      delta_path: target.delta_path,
      target_path: targetPath,
      mode: target.mode,
      source_sha256: sha(delta),
      before_sha256: sha(prior),
      content_base64: Buffer.from(final).toString('base64'),
      sha256: sha(final),
    };
  });
  const manifestRel = `logos/changes/${f.slug}/MERGE_APPLY_MANIFEST.json`;
  writeFileSync(join(f.root, manifestRel), `${JSON.stringify({
    schema: 'openlogos/baseline-merge-apply@1', slug: f.slug,
    prepared_targets: prepared, metadata_targets: [],
  }, null, 2)}\n`);
  return { manifestRel, expected, before };
}

describe('S39 单元测试——闭包、路径、完整度与协议', () => {
  it('UT-S39-01 / UT-S35-32 / ST-S35-07: 一目标一 task 的合法 plan 通过且未产 delta 不误报', () => {
    const r = evaluate(setup());
    expect(r.violations).toEqual([]);
    expect(r.summary?.planned_delta_targets).toBe(5);
  });

  it('UT-S39-02 / UT-S09-148 / ST-S09-59: 多场景共享目标只保留一个最终态 target/task', () => {
    const f = setup(['S05', 'S39']);
    const r = evaluate(f);
    expect(r.violations).toEqual([]);
    expect(r.plan?.targets.filter(t => t.canonicalTargetPath).length).toBe(5);
    expect(r.plan?.targets[0].scenarioIds).toEqual(['S05', 'S39']);
  });

  it('UT-S39-03: 安全点段和平台分隔符规范化为同一目标', () => {
    const f = setup();
    const a = resolveCanonicalMergeTarget(f.root, f.proposalDir, 'deltas/prd/./1-product-requirements/core-req.md');
    const b = resolveCanonicalMergeTarget(f.root, f.proposalDir, 'deltas\\prd\\1-product-requirements\\core-req.md');
    expect(a?.canonicalTargetPath).toBe(b?.canonicalTargetPath);
  });

  it('UT-S39-04: 绝对路径、上跳、symlink escape 与伪造语义类别均拒绝', () => {
    const f = setup();
    expect(resolveCanonicalMergeTarget(f.root, f.proposalDir, '/tmp/x')).toBeNull();
    expect(resolveCanonicalMergeTarget(f.root, f.proposalDir, 'deltas/prd/../x.md')).toBeNull();
    const outside = mkdtempSync(join(tmpdir(), 's39-out-')); roots.push(outside);
    mkdirSync(join(f.proposalDir, 'deltas/prd'), { recursive: true });
    symlinkSync(outside, join(f.proposalDir, 'deltas/prd/escape'));
    expect(resolveCanonicalMergeTarget(f.root, f.proposalDir, 'deltas/prd/escape/x.md')).toBeNull();

    for (const [category, wrong] of [
      ['requirement', 'test'], ['scenario', 'orchestration'],
    ] as const) {
      const g = setup();
      const target = targetOf(g, category);
      target.category = wrong;
      writeFixture(g, false, false);
      expect(evaluate(g).violations.some(v => v.code === 'baseline_closure_malformed'
        && v.message.includes('语义类别'))).toBe(true);
    }
    const deploymentSwap = setup();
    const deployment = targetOf(deploymentSwap, 'deployment');
    deployment.mode = 'CREATE';
    deployment.delta_path = 'deltas/test/smoke/core-new-smoke.md';
    deployment.evidence = ['proposal.md#部署影响'];
    deploymentSwap.closure.targets = [
      ...deploymentSwap.closure.targets.filter(target => target.delta_path !== null)
        .sort((a, b) => a.delta_path!.localeCompare(b.delta_path!, 'en')),
      ...deploymentSwap.closure.targets.filter(target => target.delta_path === null)
        .sort((a, b) => a.category.localeCompare(b.category, 'en')),
    ];
    writeFixture(deploymentSwap, false, false);
    expect(evaluate(deploymentSwap).violations.some(v => v.code === 'baseline_closure_malformed'
      && v.message.includes('语义类别=smoke'))).toBe(true);
  });

  it('UT-S39-05 / UT-S35-29: 已存在目标与 MODIFY 磁盘事实一致，缺失会报模式漂移', () => {
    const f = setup();
    expect(evaluate(f).violations.some(v => v.code === 'delta_target_mode_mismatch')).toBe(false);
    removeMergedTarget(f, targetOf(f, 'scenario'));
    expect(evaluate(f).violations.some(v => v.code === 'delta_target_mode_mismatch')).toBe(true);
  });

  it('UT-S39-06: 缺失目标可声明 CREATE 且不发明新 merge operation', () => {
    const f = setup();
    const scenario = targetOf(f, 'scenario'); scenario.mode = 'CREATE'; removeMergedTarget(f, scenario);
    writeFixture(f, false, false);
    expect(evaluate(f).violations).toEqual([]);
  });

  it('UT-S39-07 / UT-S35-30: plan 后 CREATE 目标被外部创建会阻断模式漂移', () => {
    const f = setup();
    const scenario = targetOf(f, 'scenario'); scenario.mode = 'CREATE';
    writeFixture(f, false, false);
    expect(evaluate(f).violations.some(v => v.code === 'delta_target_mode_mismatch')).toBe(true);
  });

  it('UT-S39-08: effective view 同时返回已合并字节与当前唯一 delta', () => {
    const f = setup(); writeFixture(f, false, true);
    const r = evaluate(f); const target = r.plan!.targets.find(t => t.category === 'scenario')!;
    const contents = new Map([[target.deltaPath!, readFileSync(join(f.proposalDir, target.deltaPath!), 'utf-8')]]);
    const view = effectiveTargetView(f.root, target, contents);
    expect(view.ok && view.mergedBytes).toContain('既有最终态');
    expect(view.ok && view.deltaBytes).toContain('MODIFIED');
  });

  it('UT-S39-09 / UT-S33-50 / ST-S33-06: EvidenceScanner 排除安全 partial 的 staging/resolved/backup', () => {
    const f = setup();
    const committed = 'logos/resources/prd/1-product-requirements/core-req.md';
    const staged = 'logos/resources/verify/baseline-seed-runs/run/staging/fake.md';
    mkdirSync(dirname(join(f.root, staged)), { recursive: true }); writeFileSync(join(f.root, staged), 'fake');
    expect(scanCommittedEvidenceFiles(f.root, [staged, committed])).toEqual([committed]);
  });

  it('UT-S39-10: API/orchestration 与 deployment/smoke disposition 均须和权威决策一致', () => {
    const f = setup(); targetOf(f, 'orchestration').mode = 'AMBIGUOUS'; targetOf(f, 'orchestration').missing_evidence = ['protocol'];
    targetOf(f, 'orchestration').evidence = [];
    writeFixture(f, false, false);
    const codes = evaluate(f).violations.map(v => v.code);
    expect(codes).toContain('baseline_closure_target_missing');

    for (const [deployment, smoke, section, valid] of [
      [false, false, false, true],
      [true, false, true, true],
      [true, true, true, true],
      [true, true, false, false],
      [false, false, true, false],
    ] as const) {
      const g = setup();
      configureDeploymentDecision(g, deployment, smoke, section);
      const deploymentViolations = evaluate(g).violations.filter(v => v.message.includes('部署')
        || v.message.includes('deployment') || v.message.includes('smoke'));
      expect(deploymentViolations.length === 0).toBe(valid);
    }

    for (const equivalentHeading of ['## 部署影响 ##', '  ##   部署影响   ###', '部署影响\n--------']) {
      const equivalent = setup();
      const proposalPath = join(equivalent.proposalDir, 'proposal.md');
      writeFileSync(proposalPath, readFileSync(proposalPath, 'utf-8')
        .replace('## 部署影响', equivalentHeading));
      expect(evaluate(equivalent).violations.filter(v => v.message.includes('部署')
        || v.message.includes('deployment') || v.message.includes('smoke'))).toEqual([]);
    }

    for (const spoof of deploymentAuthoritySpoofs.filter(item => item.name.startsWith('Setext H2'))) {
      const duplicate = setup();
      const proposal = spoof.mutate(readFileSync(join(duplicate.proposalDir, 'proposal.md'), 'utf-8'));
      expect(extractUniqueAuthoritySection(proposal, '部署影响').status, spoof.name).toBe('duplicate');
    }

    for (const mutateProposal of [
      (content: string) => content.replace(/\n## 部署影响[\s\S]*$/, ''),
      (content: string) => content.replace('\n- 是否需要 smoke：否', ''),
      (content: string) => content.replace('- 是否需要部署：否\n', ''),
      (content: string) => content
        .replace('- 是否需要部署：否', '- 是否需要部署：是/否')
        .replace('- 是否需要 smoke：否', '- 是否需要 smoke：是/否'),
      ...deploymentAuthoritySpoofs.map(fixture => fixture.mutate),
    ]) {
      const strict = setup();
      const proposalPath = join(strict.proposalDir, 'proposal.md');
      writeFileSync(proposalPath, mutateProposal(readFileSync(proposalPath, 'utf-8')));
      expect(evaluate(strict).violations.some(v => v.code === 'baseline_closure_target_missing'
        && v.message.includes('on-touch-v1'))).toBe(true);
    }
  });

  it('UT-S39-11: 无持久化证据时 database SKIP 不生成 task', () => {
    const f = setup(); const r = evaluate(f);
    expect(r.plan?.targets.find(t => t.category === 'database')?.mode).toBe('SKIP');
    expect(readFileSync(join(f.proposalDir, 'tasks.md'), 'utf-8')).not.toContain('[SKIP]');
  });

  it('UT-S39-12 / UT-S35-35 / UT-S35-36 / ST-S35-10: scenario CREATE 完整与残缺矩阵', () => {
    const f = setup(); const scenario = targetOf(f, 'scenario'); scenario.mode = 'CREATE'; removeMergedTarget(f, scenario);
    writeFixture(f, true, true, new Map([[scenario.delta_path!, fullScenario]]));
    expect(evaluate(f).violations.filter(v => v.code === 'create_target_incomplete')).toEqual([]);
    writeFileSync(join(f.proposalDir, scenario.delta_path!), fullScenario.replace('## ADDED', '## MODIFIED'));
    expect(evaluate(f).violations.some(v => v.code === 'create_target_incomplete' && v.message.includes('ADDED'))).toBe(true);
    writeFileSync(join(f.proposalDir, scenario.delta_path!), `${fullScenario}\n\n## REMOVED — 历史章节\n\n删除。\n`);
    expect(evaluate(f).violations.some(v => v.code === 'create_target_incomplete' && v.message.includes('禁止'))).toBe(true);
    writeFileSync(join(f.proposalDir, scenario.delta_path!), fullScenario.replace('sequenceDiagram', 'flowchart TD'));
    expect(evaluate(f).violations.some(v => v.code === 'create_target_incomplete' && v.message.includes('sequenceDiagram'))).toBe(true);
  });

  it('UT-S39-13: OpenAPI CREATE 完整协议通过 schema/ref/operationId 检查', () => {
    const marker = '## ADDED — logos/resources/api/touch.yaml（新文件，整文件）\n';
    expect(validateAndStripNonMarkdownDelta(marker + openApiPayload, 'CREATE', 'logos/resources/api/touch.yaml').ok).toBe(true);
  });

  it('UT-S39-14: DB 与 test CREATE 完整夹具均通过', () => {
    const f = setup();
    const sql = '## ADDED — logos/resources/database/touch.sql（新文件，整文件）\n' + sqlitePayload;
    expect(validateAndStripNonMarkdownDelta(sql, 'CREATE', 'logos/resources/database/touch.sql', { root: f.root }).ok).toBe(true);
    const test = targetOf(f, 'test'); test.mode = 'CREATE'; removeMergedTarget(f, test);
    writeFixture(f, true, true, new Map([[test.delta_path!, fullTest]]));
    expect(evaluate(f).violations.some(v => v.code === 'create_target_incomplete')).toBe(false);
  });

  it.each(['required', 'partial', 'seeded'] as const)('UT-S39-15: seed 三态 %s 均可进入 ClosureEvaluator', state => {
    const f = setup();
    const yaml = readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8')
      .replace('bootstrap: normal', 'bootstrap: adopted') + `\n    baseline_seed_state: ${state}\n`;
    writeFileSync(join(f.root, 'logos/logos-project.yaml'), yaml);
    expect(evaluate(f).violations).toEqual([]);
  });

  it('UT-S39-16 / ST-S20-12: adopted skip_phases 不会压掉当前 change 的 API/DB 维度判定', () => {
    const f = setup();
    writeFileSync(join(f.root, 'logos/logos-project.yaml'), readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8')
      .replace('bootstrap: normal', 'bootstrap: adopted\n    skip_phases: [api, database]'));
    const r = evaluate(f);
    expect(r.plan?.targets.some(t => t.category === 'api')).toBe(true);
    expect(r.plan?.targets.some(t => t.category === 'database')).toBe(true);
  });

  it('UT-S39-17: 现状 evidence 与本次 reason 保持两个独立字段', () => {
    const f = setup(); const r = evaluate(f); const target = r.plan!.targets[0];
    expect(target.applicabilityEvidence[0]).toContain('target_exists');
    expect(target.reason).toContain('触达');
  });

  it('UT-S39-18 / UT-S33-54 / ST-S33-08: 新链路不含 JIT/confirmed/baseline_warnings 写回', () => {
    const files = ['src/lib/baseline-closure.ts', 'src/commands/next.ts', 'src/commands/adopt.ts'];
    const source = files.map(p => readFileSync(join(process.cwd(), p), 'utf-8')).join('\n');
    expect(source).not.toMatch(/confirmed_[a-z]|baseline_warnings|verified\s*:\s*true/i);

    const prior = parseProvenanceSection([
      '# prior', '', '## 逆向基线来源', '```yaml', 'candidates:',
      '  - key: "core::aaaaaaaaaaaa"', '    anchor: "cli:old"', '    state: active',
      '    verified: true', '    confirmed_by: "legacy-user"', '    evidence: "legacy-proof"',
      '    confirmed_at: "2024-01-01T00:00:00Z"', '```',
    ].join('\n'))!.candidates[0];
    const staged = parseProvenanceSection([
      '# staged', '', '## 逆向基线来源', '```yaml', 'candidates:',
      '  - key: "core::aaaaaaaaaaaa"', '    anchor: "cli:old"', '    state: active',
      '    verified: false', '```',
    ].join('\n'))!.candidates[0];
    const reconciled = reconcileCandidates([prior], [staged]);
    expect(reconciled[0]).toMatchObject({
      verified: false, confirmed_by: null, evidence: null, confirmed_at: null,
    });
    const serialized = serializeProvenanceSection(reconciled);
    expect(serialized).not.toMatch(/verified:\s*true|confirmed_|legacy-user|legacy-proof|2024-01-01/);
  });

  it('UT-S39-19 / UT-S35-38 / ST-S35-13: 重复 YAML key 严格报 baseline_closure_malformed', () => {
    const f = setup();
    const bad = '# P\n\n## 基线闭包计划\n\n```yaml\nbaseline_closure:\n  policy: on-touch-v1\n  policy: on-touch-v1\n```\n';
    const r = parseBaselineClosurePlan(f.root, f.proposalDir, bad, 'proposal.md');
    expect(r.violations[0].code).toBe('baseline_closure_malformed');
  });

  it('UT-S39-20 / UT-S35-28 / UT-S35-39 / ST-S35-08: proposal 中两个别名目标按 canonical key 报重复', () => {
    const f = setup();
    const clone = { ...f.closure.targets[0], scenario_ids: [...f.closure.targets[0].scenario_ids], evidence: ['duplicate'] };
    f.closure.targets.splice(1, 0, clone); writeFixture(f, false, false);
    expect(evaluate(f).violations.some(v => v.code === 'delta_target_duplicate')).toBe(true);
  });

  it('UT-S39-21 / UT-S35-40: touched scenario 缺任一强制维度会逐项失败', () => {
    const f = setup(); f.closure.targets = f.closure.targets.filter(t => t.category !== 'test'); writeFixture(f, false, false);
    expect(evaluate(f).violations.some(v => v.code === 'baseline_closure_target_missing' && v.message.includes('test'))).toBe(true);
  });

  it('UT-S39-22 / UT-S35-42: SKIP 空 evidence 的字段组合判 malformed', () => {
    const f = setup(); targetOf(f, 'api').evidence = []; writeFixture(f, false, false);
    expect(evaluate(f).violations[0].code).toBe('baseline_closure_malformed');
  });

  it('UT-S39-23 / UT-S35-31 / ST-S09-58: 合法 AMBIGUOUS 带 missing_evidence 并在既有门前阻断', () => {
    const f = setup(); const api = targetOf(f, 'api'); api.mode = 'AMBIGUOUS'; api.evidence = []; api.missing_evidence = ['协议兼容性'];
    writeFixture(f, false, false);
    expect(evaluate(f).violations.some(v => v.code === 'baseline_closure_ambiguous' && v.message.includes('协议兼容性'))).toBe(true);
  });

  it('UT-S39-24 / UT-S35-44 / ST-S35-14: P/T 数量相同但成员不同仍按集合差集失败', () => {
    const f = setup();
    const tasksPath = join(f.proposalDir, 'tasks.md');
    writeFileSync(tasksPath, readFileSync(tasksPath, 'utf-8').replace('core-req.md', 'other.md'));
    const codes = evaluate(f).violations.map(v => v.code);
    expect(codes).toContain('baseline_closure_target_missing');
    expect(codes).toContain('delta_target_unplanned');
  });

  it('UT-S35-26 / ST-S35-11: legacy 无 policy 且无 mode 时不激活 L9', () => {
    const f = setup();
    const r = evaluateBaselineClosure({
      root: f.root, proposalDir: f.proposalDir, slug: f.slug,
      proposalContent: '# legacy proposal\n',
      tasksContent: '# 任务\n\n## [delta] 规格变更\n- [ ] 旧格式任务\n',
      deltaEntries: [], deltaContents: new Map(),
    });
    expect(r).toEqual({ active: false, violations: [] });
  });

  it('UT-S35-27: task mode 在场但 proposal 无声明时不能逃逸 L9', () => {
    const f = setup();
    const r = evaluateBaselineClosure({
      root: f.root, proposalDir: f.proposalDir, slug: f.slug,
      proposalContent: '# no closure\n',
      tasksContent: '# 任务\n\n## [delta] 规格变更\n- [ ] [MODIFY] `deltas/test/x.md`：x\n',
      deltaEntries: [], deltaContents: new Map(),
    });
    expect(r.violations[0].code).toBe('baseline_closure_declaration_missing');
  });

  it('UT-S35-33: 已勾 task 缺实际 delta 在 spec 阶段失败', () => {
    const f = setup(); writeFixture(f, true, false);
    const r = evaluate(f);
    expect(r.summary?.stage).toBe('spec');
    expect(r.violations.some(v => v.code === 'delta_target_unplanned' && v.message.includes('缺少实际 delta'))).toBe(true);
  });

  it('UT-S35-34 / ST-S35-09: 未规划实际 delta 与已完成缺文件双向稳定报差集', () => {
    const f = setup(); writeFixture(f, true, false);
    const extra = join(f.proposalDir, 'deltas/test/extra.md'); mkdirSync(dirname(extra), { recursive: true });
    writeFileSync(extra, '## ADDED — extra\n\nextra\n');
    const r = evaluate(f);
    expect(r.violations.some(v => v.code === 'delta_target_unplanned' && v.path.endsWith('extra.md'))).toBe(true);
    expect(r.violations.some(v => v.code === 'delta_target_unplanned' && v.path.endsWith('tasks.md'))).toBe(true);
  });

  it('UT-S35-41: touched scenario 缺条件维度 disposition 不得默认为 SKIP', () => {
    const f = setup(); f.closure.targets = f.closure.targets.filter(t => t.category !== 'api'); writeFixture(f, false, false);
    expect(evaluate(f).violations.some(v => v.code === 'baseline_closure_target_missing' && v.message.includes('api'))).toBe(true);
  });

  it('UT-S35-43: AMBIGUOUS 缺 missing_evidence 属 schema malformed', () => {
    const f = setup(); const api = targetOf(f, 'api'); api.mode = 'AMBIGUOUS'; api.evidence = []; api.missing_evidence = [];
    writeFixture(f, false, false);
    expect(evaluate(f).violations[0].code).toBe('baseline_closure_malformed');
  });

  it('UT-S39-25 / UT-S05-B09 / ST-S05-B04 / UT-S11-B02 / UT-S33-55 / ST-S33-09: 不可恢复 journal 统一硬门', () => {
    const f = setup();
    writeFileSync(join(f.root, 'logos/logos-project.yaml'), readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8')
      .replace('bootstrap: normal', 'bootstrap: adopted'));
    const run = join(runsRoot(f.root), 'broken'); mkdirSync(run, { recursive: true });
    writeFileSync(join(run, 'commit-journal.json'), '{broken');
    expect(() => evaluate(f)).toThrow(/baseline_commit_in_progress/);
  });

  it('UT-S39-26 / UT-S35-45 / ST-S35-15: OpenAPI marker/target/重复 key/语法逐项 fail-closed', () => {
    const path = 'logos/resources/api/touch.yaml';
    const good = `## ADDED — ${path}（新文件，整文件）\n${openApiPayload}`;
    expect(validateAndStripNonMarkdownDelta(good, 'CREATE', path).ok).toBe(true);
    expect(validateAndStripNonMarkdownDelta(good.replace('openapi: 3.1.0', 'openapi: 3.0.3'), 'CREATE', path).ok).toBe(true);
    expect(validateAndStripNonMarkdownDelta(good.replace(path, 'logos/resources/api/other.yaml'), 'CREATE', path).ok).toBe(false);
    expect(validateAndStripNonMarkdownDelta(good.replace('openapi: 3.1.0', 'openapi: 3.1.0\nopenapi: 3.0.0'), 'CREATE', path).ok).toBe(false);
    expect(validateAndStripNonMarkdownDelta(good.replace(/info:\n  title: Touch API\n  version: 1\.0\.0\n/, ''), 'CREATE', path).ok).toBe(false);
    expect(validateAndStripNonMarkdownDelta(good.replace("        '200':\n          description: ok", "        '200': ok"), 'CREATE', path).ok).toBe(false);
    expect(validateAndStripNonMarkdownDelta(good.replace('      type: object', '      type: impossible'), 'CREATE', path).ok).toBe(false);
    for (const invalid of [
      openApiPathParameterMissingRequired,
      openApiPayload.replace('      type: http', '      type: invalid'),
      openApiRequestBodyMissingContent,
      openApiParameterSchemaAndContent,
    ]) {
      const rejected = validateAndStripNonMarkdownDelta(`## ADDED — ${path}（新文件，整文件）\n${invalid}`, 'CREATE', path);
      expect(rejected.ok).toBe(false);
      expect(rejected.message).toContain('官方 schema 校验失败');
    }
    expect(validateAndStripNonMarkdownDelta(
      `## ADDED — ${path}（新文件，整文件）\n${openApiPathParameterMissingRequired.replace('openapi: 3.1.0', 'openapi: 3.0.3')}`,
      'CREATE', path,
    ).ok).toBe(false);
  });

  it('UT-S39-27: SQL 按项目方言路由，SQLite 真执行且缺失/PG/MySQL 不冒充通过', () => {
    const f = setup();
    const path = 'logos/resources/database/touch.sql';
    const good = `## ADDED — ${path}（新文件，整文件）\n${sqlitePayload}`;
    const r = validateAndStripNonMarkdownDelta(good, 'CREATE', path, { root: f.root });
    expect(r.ok).toBe(true); expect(r.payload).not.toContain('## ADDED');
    expect(validateAndStripNonMarkdownDelta(good.replace('CREATE TABLE', 'CREATE TABL'), 'CREATE', path, { root: f.root }).ok).toBe(false);
    const yamlPath = join(f.root, 'logos/logos-project.yaml');
    const base = readFileSync(yamlPath, 'utf-8');
    for (const dialect of ['postgresql', 'mysql']) {
      writeFileSync(yamlPath, base.replace('database: sqlite', `database: ${dialect}`));
      const rejected = validateAndStripNonMarkdownDelta(good, 'CREATE', path, { root: f.root });
      expect(rejected.ok).toBe(false);
      expect(rejected.message).toContain('拒绝用 SQLite');
    }
    writeFileSync(yamlPath, base.replace('  database: sqlite\n', ''));
    expect(validateAndStripNonMarkdownDelta(good, 'CREATE', path, { root: f.root }).message).toContain('未声明 SQL 方言');
  });

  it('UT-S39-28: canonical 与兼容标题矩阵只按权威 ATX 标题识别', () => {
    const aliases = ['步骤说明', '主路径步骤', '主路径', '主流程', '正常流程', 'main path'];
    for (const [index, alias] of aliases.entries()) {
      const level = index % 2 === 0 ? '##' : '###';
      let fixture = fullScenario.replace('## 主路径步骤', `${level} ${alias}`);
      if (index === aliases.length - 1) fixture = fixture.replace(/\n/g, '\r\n');
      expect(scenarioViolations(fixture), alias).toEqual([]);
    }
    expect(fullScenario.replace('## 主路径步骤', '## 步骤说明')).toContain('## 步骤说明');
  });

  it('UT-S39-29: 散文、围栏、HTML 注释与 Mermaid 消息不能冒充步骤章节', () => {
    const stepBlock = '## 主路径步骤\n1. 用户发起。\n2. CLI 校验。\n3. CLI 返回。\n';
    const withoutSteps = fullScenario.replace(stepBlock, '');
    const fixtures = [
      withoutSteps.replace('## 追溯', '普通散文提到步骤说明与主流程。\n\n## 追溯'),
      withoutSteps.replace('## 追溯', '```markdown\n## 步骤说明\n1. 假步骤\n2. 假步骤\n3. 假步骤\n```\n\n## 追溯'),
      withoutSteps.replace('## 追溯', '~~~text\n## 主流程\n1. 假步骤\n2. 假步骤\n3. 假步骤\n~~~\n\n## 追溯'),
      withoutSteps.replace('## 追溯', '<!--\n## 正常流程\n1. 假步骤\n2. 假步骤\n3. 假步骤\n-->\n\n## 追溯'),
      withoutSteps,
    ];
    for (const fixture of fixtures) {
      const violations = scenarioViolations(fixture);
      expect(violations).toHaveLength(1);
      expect(violations[0].message).toContain('步骤章节缺失');
    }
  });

  it('UT-S39-30: 唯一步骤章节必须有连续且非空的三项有序列表', () => {
    expect(scenarioViolations(fullScenario)).toEqual([]);
    const two = fullScenario.replace('\n3. CLI 返回。', '');
    expect(scenarioViolations(two)[0].message).toContain('步骤有序列表少于 3 项');
    const empty = fullScenario.replace('2. CLI 校验。', '2.');
    expect(scenarioViolations(empty)[0].message).toContain('步骤有序列表存在空项');
    const unordered = fullScenario
      .replace('1. 用户发起。', '- 用户发起。')
      .replace('2. CLI 校验。', '- CLI 校验。')
      .replace('3. CLI 返回。', '- CLI 返回。');
    expect(scenarioViolations(unordered)[0].message).toContain('步骤章节无有序列表');
    const duplicate = fullScenario.replace('## 异常与边界', '### 主流程\n1. 重复一。\n2. 重复二。\n3. 重复三。\n\n## 异常与边界');
    expect(scenarioViolations(duplicate)[0].message).toContain('步骤章节重复');
    const otherSectionNumbers = unordered.replace('- 异常失败关闭。', '1. 异常一。\n2. 异常二。\n3. 异常三。');
    expect(scenarioViolations(otherSectionNumbers)[0].message).toContain('步骤章节无有序列表');
  });

  it('UT-S39-31: Mermaid 时序只采信完整 mermaid sequenceDiagram', () => {
    expect(scenarioViolations(fullScenario)).toEqual([]);
    expect(scenarioViolations(fullScenario.replace('```mermaid', '```text'))[0].message)
      .toContain('时序缺合法 Mermaid sequenceDiagram');
    expect(scenarioViolations(fullScenario.replace('  participant C as CLI\n', ''))[0].message)
      .toContain('参与者少于 2');
    expect(scenarioViolations(fullScenario.replace('  U->>C: 执行步骤\n', ''))[0].message)
      .toContain('缺消息');
    const commented = fullScenario.replace(
      '```mermaid\nsequenceDiagram', '<!--\n```mermaid\nsequenceDiagram',
    ).replace('  U->>C: 执行步骤\n```', '  U->>C: 执行步骤\n```\n-->');
    expect(scenarioViolations(commented)[0].message).toContain('时序缺合法 Mermaid sequenceDiagram');
  });

  it('UT-S39-32: 异常/边界与追溯章节必须唯一且有权威正文', () => {
    expect(scenarioViolations(fullScenario)).toEqual([]);
    expect(scenarioViolations(fullScenario.replace('## 异常与边界\n- 异常失败关闭。', '## 异常与边界'))[0].message)
      .toContain('异常/边界章节为空');
    expect(scenarioViolations(fullScenario.replace('## 追溯\n- P04 / UT-S39-12', '## 追溯'))[0].message)
      .toContain('追溯章节为空');
    expect(scenarioViolations(fullScenario.replace('## 异常与边界\n- 异常失败关闭。\n\n', ''))[0].message)
      .toContain('异常/边界章节缺失');
    const duplicate = fullScenario.replace('## 追溯', '## 边界\n- 边界正文。\n\n## 追溯');
    expect(scenarioViolations(duplicate)[0].message).toContain('异常/边界章节重复');
    const sampleOnly = fullScenario.replace('- P04 / UT-S39-12', '```text\n追溯样例\n```');
    expect(scenarioViolations(sampleOnly)[0].message).toContain('追溯章节为空');
  });
});

describe('S39 场景测试——plan/spec/merge 纵深闭环', () => {
  it('ST-S39-01: 已有目标在 spec 阶段保持唯一 MODIFY task/delta', () => {
    const f = setup(); writeFixture(f, true, true); const r = evaluate(f);
    expect(r.summary?.stage).toBe('spec'); expect(r.violations).toEqual([]);
  });

  it('ST-S39-02: 两个场景共享主规格仍只有五个 material targets', () => {
    const f = setup(['S05', 'S39']); writeFixture(f, true, true);
    expect(evaluate(f).summary?.actual_delta_targets).toBe(5);
  });

  it('ST-S39-03: 缺失场景与测试可同批全量 CREATE', () => {
    const f = setup(); const s = targetOf(f, 'scenario'); const t = targetOf(f, 'test');
    s.mode = 'CREATE'; t.mode = 'CREATE'; removeMergedTarget(f, s); removeMergedTarget(f, t);
    writeFixture(f, true, true, new Map([[s.delta_path!, fullScenario], [t.delta_path!, fullTest]]));
    expect(evaluate(f).violations).toEqual([]);
  });

  it('ST-S39-04: API 与 DB non-Markdown CREATE 均可完成严格预检', () => {
    const f = setup();
    expect(validateAndStripNonMarkdownDelta(
      '## ADDED — logos/resources/api/touch.yaml（新文件，整文件）\n' + openApiPayload,
      'CREATE', 'logos/resources/api/touch.yaml').ok).toBe(true);
    expect(validateAndStripNonMarkdownDelta(
      '## ADDED — logos/resources/database/touch.sql（新文件，整文件）\n' + sqlitePayload,
      'CREATE', 'logos/resources/database/touch.sql', { root: f.root }).ok).toBe(true);
  });

  it('ST-S39-05: 纯 CLI 的 API/DB/编排均证据化 SKIP 且无 checkbox', () => {
    const f = setup(); const text = readFileSync(join(f.proposalDir, 'tasks.md'), 'utf-8');
    expect(['api', 'database', 'orchestration'].every(c => targetOf(f, c as BaselineClosureCategory).mode === 'SKIP')).toBe(true);
    expect(text).not.toContain('[SKIP]');
  });

  it('ST-S39-06 / UT-S33-49 / ST-S33-05: adopted required 无 seed 也能完成首个 on-touch plan', () => {
    const f = setup(); writeFileSync(join(f.root, 'logos/logos-project.yaml'), readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8')
      .replace('bootstrap: normal', 'bootstrap: adopted\n    baseline_seed_state: required'));
    expect(evaluate(f).violations).toEqual([]);
  });

  it('ST-S39-07 / UT-S20-17 / UT-S33-51 / ST-S33-07: seeded 只加速 evidence，不替代缺失目标 CREATE', () => {
    const f = setup(); const s = targetOf(f, 'scenario'); s.mode = 'CREATE'; removeMergedTarget(f, s);
    s.evidence.push('seeded_candidate: core::abc'); writeFixture(f, false, false);
    expect(evaluate(f).plan?.targets.find(t => t.category === 'scenario')?.mode).toBe('CREATE');
  });

  it('ST-S39-08: AMBIGUOUS 在既有 plan-exit 前一次性阻断', () => {
    const f = setup(); const api = targetOf(f, 'api'); api.mode = 'AMBIGUOUS'; api.evidence = []; api.missing_evidence = ['外部协议'];
    writeFixture(f, false, false);
    expect(evaluate(f).violations.filter(v => v.code === 'baseline_closure_ambiguous')).toHaveLength(1);
  });

  it('ST-S39-09: change-lint L9 与共享 evaluator 得到相同闭包结论', () => {
    const f = setup(); writeFixture(f, true, true);
    const direct = evaluate(f);
    const lint = runChangeLint(f.root, f.proposalDir, f.slug);
    expect(lint.ok).toBe(true);
    if (lint.ok) {
      expect(lint.baseline_closure).toEqual(direct.summary);
      expect(lint.violations.filter(v => v.code.startsWith('baseline_') || v.code.startsWith('delta_target'))).toEqual([]);
    }
  });

  it('ST-S39-10 / ST-S33-08: on-touch 端到端产物不产生 JIT 确认状态', () => {
    const f = setup(); writeFixture(f, true, true);
    const bytes = [readFileSync(join(f.proposalDir, 'proposal.md'), 'utf-8'), readFileSync(join(f.proposalDir, 'tasks.md'), 'utf-8')].join('\n');
    expect(bytes).not.toMatch(/confirmed_|baseline_warnings/i);
    expect(bytes).toContain('jit_confirmation: disabled');
  });

  it('ST-S39-11 / UT-S09-147 / UT-S09-150 / UT-S09-151 / ST-S09-57: 唯一 plan-exit 前 P==T，逐文件完成后 P==T==D', () => {
    const f = setup(); expect(evaluate(f).summary?.stage).toBe('plan');
    expect(readFileSync(join(f.proposalDir, 'tasks.md'), 'utf-8')).toContain('## [code] 代码实现\n');
    writeFixture(f, true, true); const spec = evaluate(f);
    expect(spec.summary?.stage).toBe('spec'); expect(spec.summary?.planned_delta_targets).toBe(spec.summary?.actual_delta_targets);

    for (const spoof of deploymentAuthoritySpoofs) {
      const invalid = setup();
      const proposalPath = join(invalid.proposalDir, 'proposal.md');
      writeFileSync(proposalPath, spoof.mutate(readFileSync(proposalPath, 'utf-8')));
      const lint = spawnSync(process.execPath, [
        CLI_DIST, 'change-lint', '--slug', invalid.slug, '--format', 'json',
      ], { cwd: invalid.root, encoding: 'utf-8', timeout: 20_000 });
      expect(lint.status, `${spoof.name}\nstdout=${lint.stdout}\nstderr=${lint.stderr}`).toBe(2);
      const envelope = JSON.parse(lint.stdout);
      expect(envelope.data.pass, spoof.name).toBe(false);
      expect(envelope.data.violations.some((violation: { code: string }) => (
        violation.code === 'baseline_closure_target_missing'
      )), spoof.name).toBe(true);
    }
  });

  it('ST-S39-12 / UT-S11-B03: prepared journal 可恢复后才允许 ClosureEvaluator 读取一致集合', () => {
    const f = setup(); writeFileSync(join(f.root, 'logos/logos-project.yaml'), readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8')
      .replace('bootstrap: normal', 'bootstrap: adopted'));
    const runId = 'seed-core-recover'; const runDir = join(runsRoot(f.root), runId); mkdirSync(runDir, { recursive: true });
    const targetPath = 'logos/resources/prd/1-product-requirements/core-req.md'; const old = readFileSync(join(f.root, targetPath), 'utf-8');
    const yBackup = join(backupDir(f.root, runId), 'logos-project.yaml.bak'); mkdirSync(dirname(yBackup), { recursive: true });
    writeFileSync(yBackup, readFileSync(join(f.root, 'logos/logos-project.yaml'), 'utf-8'));
    writeFileSync(journalPath(f.root, runId), JSON.stringify({
      phase: 'prepared', run_id: runId, module: 'core', keys: [],
      targets: [{ target_path: targetPath, old_sha256: sha(old), new_sha256: sha('new'), applied: false }],
      index: { yaml_backup_path: yBackup, old_yaml_sha256: sha(readFileSync(yBackup, 'utf-8')) },
      state_transition: { from: 'required', to: 'seeded' },
    }));
    expect(evaluate(f).violations).toEqual([]);
    expect(existsSync(journalPath(f.root, runId))).toBe(false);
  });

  it('ST-S39-14: 四份历史场景以主流程标题通过且 fixture 不被改写', () => {
    const archived = [
      'core-S27-loop-iterate.md', 'core-S28-next-node.md',
      'core-S31-code-slice-loop.md', 'core-S32-slice-planning.md',
    ];
    const archiveRoot = join(process.cwd(), '..', 'logos/changes/archive/20260816-0030-make-verify-slice-aware',
      'deltas/prd/3-technical-plan/2-scenario-implementation');
    for (const file of archived) {
      const original = readFileSync(join(archiveRoot, file), 'utf-8');
      const fixture = original.replace(/^### 步骤\s*$/m, '### 主流程');
      expect(fixture, file).toContain('### 主流程');
      expect(scenarioViolations(fixture), file).toEqual([]);
      expect(readFileSync(join(archiveRoot, file), 'utf-8'), file).toBe(original);
    }
  });

  it('ST-S39-15: canonical 场景贯穿 change-lint 与 merge 同源预检', () => {
    const f = setup();
    const scenario = targetOf(f, 'scenario');
    scenario.mode = 'CREATE';
    removeMergedTarget(f, scenario);
    const canonical = fullScenario.replace('## 主路径步骤', '## 步骤说明');
    const overrides = new Map<string, string>();
    for (const target of f.closure.targets.filter(item => item.delta_path !== null)) {
      overrides.set(target.delta_path!, `## ADDED — ${target.category} 受控补充\n\n最终态内容。\n`);
    }
    overrides.set(scenario.delta_path!, canonical);
    overrides.set(targetOf(f, 'test').delta_path!, [
      '## ADDED — S39 结构合同测试', '', '| ID | 场景 |', '|---|---|',
      '| UT-S39-28 | canonical 标题 |', '| ST-S39-15 | lint/merge 同源 |', '',
    ].join('\n'));
    writeFixture(f, true, true, overrides);
    writeFileSync(join(f.root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: f.slug, module: 'core' }));

    const lint = spawnSync(process.execPath, [CLI_DIST, 'change-lint', '--slug', f.slug, '--format', 'json'], {
      cwd: f.root, encoding: 'utf-8', timeout: 20_000,
    });
    expect(lint.status, `${lint.stdout}\n${lint.stderr}`).toBe(0);
    expect(JSON.parse(lint.stdout).data.pass).toBe(true);

    const merge = spawnSync(process.execPath, [CLI_DIST, 'merge', f.slug], {
      cwd: f.root, encoding: 'utf-8', timeout: 20_000,
    });
    expect(merge.status, merge.stderr).toBe(0);
    expect(existsSync(join(f.proposalDir, 'MERGE_PROMPT.md'))).toBe(true);
    expect(existsSync(join(f.root, canonicalTargetFromDeltaPath(scenario.delta_path!)!))).toBe(false);
    expect(canonical.split('\n').slice(1).join('\n')).not.toMatch(/^## ADDED\b/m);
  });

  it('ST-S39-16: 真正缺步骤时 lint/merge 同源失败且项目字节不变', () => {
    const f = setup();
    const scenario = targetOf(f, 'scenario');
    scenario.mode = 'CREATE';
    removeMergedTarget(f, scenario);
    const invalid = fullScenario.replace(
      '## 主路径步骤\n1. 用户发起。\n2. CLI 校验。\n3. CLI 返回。\n',
      '普通散文提到步骤，但没有权威步骤章节。\n',
    );
    writeFixture(f, true, true, new Map([[scenario.delta_path!, invalid]]));
    writeFileSync(join(f.root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: f.slug, module: 'core' }));
    const before = snapshotTree(f.root);

    const lint = spawnSync(process.execPath, [CLI_DIST, 'change-lint', '--slug', f.slug, '--format', 'json'], {
      cwd: f.root, encoding: 'utf-8', timeout: 20_000,
    });
    expect(lint.status).toBe(2);
    const lintEnvelope = JSON.parse(lint.stdout);
    expect(lintEnvelope.data.violations.some((violation: { code: string; message: string }) => (
      violation.code === 'create_target_incomplete' && violation.message.includes('步骤章节缺失')
    ))).toBe(true);
    expect(snapshotTree(f.root)).toEqual(before);

    const merge = spawnSync(process.execPath, [CLI_DIST, 'merge', f.slug], {
      cwd: f.root, encoding: 'utf-8', timeout: 20_000,
    });
    expect(merge.status).not.toBe(0);
    expect(merge.stderr).toContain('create_target_incomplete');
    expect(existsSync(join(f.proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(f.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(snapshotTree(f.root)).toEqual(before);
  });

  it('ST-S39-13: API/DB CREATE+MODIFY 与 Markdown/counter/index/marker 同批提交，末段故障整批回滚', () => {
    const f = setup();
    const apiCreate = 'logos/resources/api/touch.yaml';
    const apiModify = 'logos/resources/api/existing.json';
    const dbCreate = 'logos/resources/database/touch.sql';
    const dbModify = 'logos/resources/database/existing.sql';
    const requirement = 'logos/resources/prd/1-product-requirements/core-req.md';
    const projectYaml = 'logos/logos-project.yaml';
    const index = 'logos/resource-index.yaml';
    const marker = `logos/changes/${f.slug}/SPEC_MERGED`;
    mkdirSync(join(f.root, 'logos/resources/api'), { recursive: true });
    mkdirSync(join(f.root, 'logos/resources/database'), { recursive: true });
    writeFileSync(join(f.root, apiModify), '{"legacy":true}\n');
    writeFileSync(join(f.root, dbModify), '-- legacy ddl\n');
    const old = new Map([
      [apiModify, readFileSync(join(f.root, apiModify), 'utf-8')],
      [dbModify, readFileSync(join(f.root, dbModify), 'utf-8')],
      [requirement, readFileSync(join(f.root, requirement), 'utf-8')],
      [projectYaml, readFileSync(join(f.root, projectYaml), 'utf-8')],
    ]);
    const openApiJson = `${JSON.stringify({
      openapi: '3.1.0', info: { title: 'Touch JSON', version: '1.0.0' },
      paths: { '/touch-json': { get: {
        operationId: 'getTouchJson', security: [{ bearerAuth: [] }],
        responses: { 200: { description: 'ok' }, 400: { description: 'error' } },
      } } },
      components: {
        securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
        schemas: { Touch: { type: 'object', deprecated: false } },
      },
    }, null, 2)}\n`;
    const sqliteModify = sqlitePayload.replace(/\btouch\b/g, 'existing');
    const inputs = [
      { kind: 'non-markdown' as const, deltaPath: 'deltas/api/touch.yaml', mode: 'CREATE' as const,
        deltaBytes: `## ADDED — ${apiCreate}（新文件，整文件）\n${openApiPayload}` },
      { kind: 'non-markdown' as const, deltaPath: 'deltas/api/existing.json', mode: 'MODIFY' as const,
        deltaBytes: `## MODIFIED — ${apiModify}（整文件替换）\n${openApiJson}` },
      { kind: 'non-markdown' as const, deltaPath: 'deltas/database/touch.sql', mode: 'CREATE' as const,
        deltaBytes: `## ADDED — ${dbCreate}（新文件，整文件）\n${sqlitePayload}` },
      { kind: 'non-markdown' as const, deltaPath: 'deltas/database/existing.sql', mode: 'MODIFY' as const,
        deltaBytes: `## MODIFIED — ${dbModify}（整文件替换）\n${sqliteModify}` },
      { kind: 'prepared' as const, targetPath: requirement, mode: 'MODIFY' as const, bytes: '# requirement 新最终态\n' },
      { kind: 'prepared' as const, targetPath: projectYaml, mode: 'MODIFY' as const,
        bytes: `${old.get(projectYaml)}scenario_counter:\n  next_id: 40\n` },
      { kind: 'prepared' as const, targetPath: index, mode: 'CREATE' as const, bytes: 'resources:\n  - S39\n' },
      { kind: 'prepared' as const, targetPath: marker, mode: 'CREATE' as const, bytes: '{"type":"spec_merged"}\n' },
    ];

    const failed = applyBaselineClosureBatch(f.root, f.proposalDir, inputs, {
      afterWrite(targetPath) { if (targetPath === index) throw new Error('fault-after-index'); },
    });
    expect(failed).toMatchObject({ ok: false, rolled_back: true });
    for (const [path, bytes] of old) expect(readFileSync(join(f.root, path), 'utf-8')).toBe(bytes);
    for (const path of [apiCreate, dbCreate, index, marker]) expect(existsSync(join(f.root, path))).toBe(false);
    expect(existsSync(join(f.proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL))).toBe(false);

    // 模拟 target rename 已完成、applied journal 位尚未来得及持久化的真实崩溃窗口。
    const txnBackup = join(f.proposalDir, '.baseline-closure-apply-txn/backup/0.old');
    mkdirSync(dirname(txnBackup), { recursive: true });
    writeFileSync(txnBackup, old.get(requirement)!);
    const crashedBytes = '# crash-window 新字节\n';
    writeFileSync(join(f.root, requirement), crashedBytes);
    writeFileSync(join(f.proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL), `${JSON.stringify({
      schema: 'openlogos/baseline-closure-apply@1', phase: 'committing', created_dirs: [],
      entries: [{
        target_path: requirement, mode: 'MODIFY', kind: 'prepared',
        old_sha256: sha(old.get(requirement)!), new_sha256: sha(crashedBytes),
        staged_path: '.baseline-closure-apply-txn/staging/0.new',
        backup_path: '.baseline-closure-apply-txn/backup/0.old', applied: false,
      }],
    }, null, 2)}\n`);
    expect(recoverBaselineClosureApply(f.root, f.proposalDir)).toEqual({ ok: true, recovered: 'rolled_back' });
    expect(readFileSync(join(f.root, requirement), 'utf-8')).toBe(old.get(requirement));

    const applied = applyBaselineClosureBatch(f.root, f.proposalDir, inputs);
    expect(applied.ok).toBe(true);
    expect(readFileSync(join(f.root, apiCreate), 'utf-8')).toBe(openApiPayload);
    expect(readFileSync(join(f.root, apiModify), 'utf-8')).toBe(openApiJson);
    expect(readFileSync(join(f.root, dbCreate), 'utf-8')).toBe(sqlitePayload);
    expect(readFileSync(join(f.root, dbModify), 'utf-8')).toBe(sqliteModify);
    expect([apiCreate, apiModify, dbCreate, dbModify]
      .every(path => !readFileSync(join(f.root, path), 'utf-8').includes('## ADDED —'))).toBe(true);
    expect(readFileSync(join(f.root, index), 'utf-8')).toContain('S39');
    expect(existsSync(join(f.root, marker))).toBe(true);

    // 真实 merge-executor CLI 入口必须消费同一原子原语；成功写全新，故障写全旧并清除 prompt。
    const production = setup();
    const successManifest = writeProductionApplyManifest(production, 'success');
    const success = spawnSync(process.execPath, [CLI_DIST, 'merge-apply', production.slug, '--manifest', successManifest.manifestRel], {
      cwd: production.root, encoding: 'utf-8', timeout: 20_000,
    });
    expect(success.status, success.stderr).toBe(0);
    for (const [path, bytes] of successManifest.expected) {
      expect(readFileSync(join(production.root, path), 'utf-8')).toBe(bytes);
    }
    expect(existsSync(join(production.proposalDir, 'SPEC_MERGED'))).toBe(true);

    const faulted = setup();
    const faultManifest = writeProductionApplyManifest(faulted, 'fault');
    const firstTarget = canonicalTargetFromDeltaPath(targetOf(faulted, 'requirement').delta_path!)!;
    const failure = spawnSync(process.execPath, [CLI_DIST, 'merge-apply', faulted.slug, '--manifest', faultManifest.manifestRel], {
      cwd: faulted.root, encoding: 'utf-8', timeout: 20_000,
      env: { ...process.env, NODE_ENV: 'test', OPENLOGOS_TEST_MERGE_APPLY_FAIL_AFTER: firstTarget },
    });
    expect(failure.status).not.toBe(0);
    for (const [path, bytes] of faultManifest.before) {
      expect(readFileSync(join(faulted.root, path), 'utf-8')).toBe(bytes);
    }
    expect(existsSync(join(faulted.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(faulted.proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(faulted.proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL))).toBe(false);

    for (const operation of ['MODIFIED', 'REMOVED'] as const) {
      const invalidCreate = setup();
      const scenario = targetOf(invalidCreate, 'scenario');
      scenario.mode = 'CREATE';
      removeMergedTarget(invalidCreate, scenario);
      writeFixture(invalidCreate, true, true, new Map([
        [scenario.delta_path!, fullScenario.replace('## ADDED', `## ${operation}`)],
      ]));
      writeFileSync(join(invalidCreate.root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: invalidCreate.slug, module: 'core' }));
      const rejected = spawnSync(process.execPath, [CLI_DIST, 'merge', invalidCreate.slug], {
        cwd: invalidCreate.root, encoding: 'utf-8', timeout: 20_000,
      });
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain('create_target_incomplete');
      expect(existsSync(join(invalidCreate.proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
      expect(existsSync(join(invalidCreate.proposalDir, 'SPEC_MERGED'))).toBe(false);
    }

    // merge-apply 在读取 manifest 前重跑同一 L9 evaluator；官方 schema 负例不得绕过纵深防御。
    const invalidApi = setup();
    const invalidApiTarget = targetOf(invalidApi, 'api');
    invalidApiTarget.mode = 'MODIFY';
    invalidApiTarget.delta_path = 'deltas/api/touch.yaml';
    invalidApiTarget.evidence = ['target_exists: logos/resources/api/touch.yaml'];
    const orchestrationTarget = targetOf(invalidApi, 'orchestration');
    orchestrationTarget.mode = 'MODIFY';
    orchestrationTarget.delta_path = 'deltas/scenario/touch.md';
    orchestrationTarget.evidence = ['target_exists: logos/resources/scenario/touch.md'];
    for (const target of [invalidApiTarget, orchestrationTarget]) {
      const targetPath = canonicalTargetFromDeltaPath(target.delta_path!)!;
      mkdirSync(dirname(join(invalidApi.root, targetPath)), { recursive: true });
      writeFileSync(join(invalidApi.root, targetPath), `# ${target.category} old\n`);
    }
    sortClosureTargets(invalidApi);
    const invalidManifest = writeProductionApplyManifest(invalidApi, 'invalid-api');
    writeFileSync(join(invalidApi.proposalDir, invalidApiTarget.delta_path!),
      `## MODIFIED — logos/resources/api/touch.yaml（整文件替换）\n${openApiPathParameterMissingRequired}`);
    const invalidApiApply = spawnSync(process.execPath, [CLI_DIST, 'merge-apply', invalidApi.slug, '--manifest', invalidManifest.manifestRel], {
      cwd: invalidApi.root, encoding: 'utf-8', timeout: 20_000,
    });
    expect(invalidApiApply.status).not.toBe(0);
    expect(invalidApiApply.stderr).toContain('non_markdown_delta_invalid');
    for (const [path, bytes] of invalidManifest.before) {
      expect(readFileSync(join(invalidApi.root, path), 'utf-8')).toBe(bytes);
    }
    expect(existsSync(join(invalidApi.proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(invalidApi.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(invalidApi.proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL))).toBe(false);
  });
});
