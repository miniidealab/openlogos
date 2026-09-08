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
  resolveCanonicalMergeTarget,
  type CanonicalTargetCategory,
} from '../src/lib/canonical-target.js';
import { validateAndStripNonMarkdownDelta } from '../src/lib/non-markdown-delta.js';
import { planDirectTargets } from '../src/lib/merge-direct.js';
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
  category: CanonicalTargetCategory;
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
  const material: Array<[CanonicalTargetCategory, string]> = [
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
  for (const category of ['api', 'database', 'deployment', 'orchestration', 'smoke'] as CanonicalTargetCategory[]) {
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


function targetOf(f: Fixture, category: CanonicalTargetCategory): RawTarget {
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

/** 生产入口用 fixture：写好全部 delta 与 guard，返回各 canonical target 的合并前字节快照。 */
function productionSnapshot(f: Fixture): Map<string, string> {
  const overrides = new Map<string, string>();
  for (const target of f.closure.targets.filter(item => item.delta_path !== null)) {
    overrides.set(target.delta_path!, target.category === 'test'
      ? '## ADDED — 受控补充\n\n| ID | 场景 |\n|---|---|\n| UT-S39-01 | 生产入口 |\n| ST-S39-01 | 生产入口 |\n'
      : `## ADDED — 受控补充\n\n${target.category}-生产入口\n`);
  }
  writeFixture(f, true, true, overrides);
  const before = new Map<string, string>();
  for (const target of f.closure.targets.filter(item => item.delta_path !== null)) {
    const targetPath = canonicalTargetFromDeltaPath(target.delta_path!)!;
    before.set(targetPath, readFileSync(join(f.root, targetPath), 'utf-8'));
  }
  return before;
}

describe('S39 单元测试——canonical target 派生与 non-Markdown 协议', () => {


  it('UT-S39-03: 安全点段和平台分隔符规范化为同一目标', () => {
    const f = setup();
    const a = resolveCanonicalMergeTarget(f.root, f.proposalDir, 'deltas/prd/./1-product-requirements/core-req.md');
    const b = resolveCanonicalMergeTarget(f.root, f.proposalDir, 'deltas\\prd\\1-product-requirements\\core-req.md');
    expect(a?.canonicalTargetPath).toBe(b?.canonicalTargetPath);
  });

  it('UT-S39-04: 绝对路径、上跳、symlink escape 与未知类别目录均拒绝', () => {
    const f = setup();
    // 路径映射是 merge 目标集派生的唯一入口，非法路径必须映射为 null（fail-closed）
    for (const bad of [
      '/etc/passwd',
      'C:\\Windows\\system32',
      '../../escape.md',
      'deltas/test/../../../escape.md',
      'deltas/bogus/x.md',
      '',
    ]) {
      expect(canonicalTargetFromDeltaPath(bad), bad).toBeNull();
    }
    // symlink 逃逸提案目录：resolveCanonicalMergeTarget 读取真实路径后拒绝
    const outside = join(f.root, 'outside.md');
    writeFileSync(outside, '## ADDED — X\n\n正文。\n');
    const linked = join(f.proposalDir, 'deltas', 'test', 'linked.md');
    mkdirSync(dirname(linked), { recursive: true });
    try { symlinkSync(outside, linked); } catch { /* 平台不支持则跳过该分支 */ }
    if (existsSync(linked)) {
      expect(resolveCanonicalMergeTarget(f.root, f.proposalDir, 'deltas/test/linked.md')).toBeNull();
    }
    // 合法路径照常映射
    expect(canonicalTargetFromDeltaPath('deltas/test/core-S01-test-cases.md'))
      .toBe('logos/resources/test/core-S01-test-cases.md');
  });

  it('UT-S39-05 / UT-S35-29: 目标已存在时模式派生为 MODIFY', () => {
    const f = setup();
    writeFixture(f, true, true);
    const targets = planDirectTargets(f.root, f.proposalDir);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every(t => t.mode === 'MODIFY'), '夹具的目标均已存在').toBe(true);
    // 模式来自磁盘事实而非任何声明：不存在「声明 MODIFY 但目标缺失」这一失配
    expect(targets.every(t => existsSync(join(f.root, ...t.targetPath.split('/'))))).toBe(true);
  });

  it('UT-S39-06: 目标缺失时模式派生为 CREATE，不发明新 merge operation', () => {
    const f = setup();
    writeFixture(f, true, true);
    const scenario = targetOf(f, 'scenario');
    removeMergedTarget(f, scenario);
    const targetPath = canonicalTargetFromDeltaPath(scenario.delta_path!)!;
    const derived = planDirectTargets(f.root, f.proposalDir).find(t => t.targetPath === targetPath)!;
    expect(derived.mode).toBe('CREATE');
    // 模式集合闭合为二值，不存在第三种 operation
    expect(new Set(planDirectTargets(f.root, f.proposalDir).map(t => t.mode)))
      .toEqual(new Set(['MODIFY', 'CREATE']));
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

  it('UT-S39-27: SQL 按项目方言路由，SQLite 真执行且 PG/MySQL 降级而不冒充', () => {
    const f = setup();
    const path = 'logos/resources/database/touch.sql';
    const good = `## ADDED — ${path}（新文件，整文件）\n${sqlitePayload}`;
    const r = validateAndStripNonMarkdownDelta(good, 'CREATE', path, { root: f.root });
    expect(r.ok).toBe(true); expect(r.payload).not.toContain('## ADDED');
    expect(validateAndStripNonMarkdownDelta(good.replace('CREATE TABLE', 'CREATE TABL'), 'CREATE', path, { root: f.root }).ok).toBe(false);
    const yamlPath = join(f.root, 'logos/logos-project.yaml');
    const base = readFileSync(yamlPath, 'utf-8');
    // 0.14.10 起：非 SQLite 方言不再硬失败（架构 §四十二.1 能力缺失只能降级），但本用例的原意图
    // ——「不许用 SQLite 冒充该方言」——完整保留，改为正向断言：payload 通过的层级只能是
    // structure，绝不能是 sqlite 的 execution，即它从未进入 sqlite 执行路径。
    for (const dialect of ['postgresql', 'mysql'] as const) {
      writeFileSync(yamlPath, base.replace('database: sqlite', `database: ${dialect}`));
      const routed = validateAndStripNonMarkdownDelta(good, 'CREATE', path, { root: f.root });
      expect(routed.ok, `${dialect} 不应被阻断`).toBe(true);
      // 核心不变量：绝不进入 sqlite 的 execution 层——各方言只能走自己的适配器或降级。
      expect(routed.tier, `${dialect} 绝不能走 sqlite 的 execution 层`).not.toBe('execution');
      if (dialect === 'postgresql') {
        expect(routed.tier).toBe('syntax');            // 走自己的权威解析器
        expect(routed.degradation).toBeUndefined();
      } else {
        expect(routed.tier).toBe('structure');          // 无适配器 → 降级
        expect(routed.degradation?.dialect).toBe(dialect);
        expect(routed.degradation?.reason).toBe('adapter-not-implemented');
      }
    }
    writeFileSync(yamlPath, base.replace('  database: sqlite\n', ''));
    expect(validateAndStripNonMarkdownDelta(good, 'CREATE', path, { root: f.root }).message).toContain('未声明 SQL 方言');
  });





});

describe('S39 场景测试——非 Markdown 目标的原子 apply', () => {















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

    // 真实 merge CLI 入口必须消费同一原子原语；成功写全新，故障写全旧且不留 marker。
    // lite-cut1b：入口从 `merge-apply <manifest>` 收敛为 `merge <slug>` 一次调用，原语不变。
    const production = setup();
    const productionBefore = productionSnapshot(production);
    writeFileSync(join(production.root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: production.slug, module: 'core' }));
    const success = spawnSync(process.execPath, [CLI_DIST, 'merge', production.slug], {
      // vitest 全局开 legacy MERGE_PROMPT 开关供 0.13.x 回归；本段测生产合并入口，显式关闭。
      cwd: production.root, encoding: 'utf-8', timeout: 20_000,
      env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
    });
    expect(success.status, success.stderr).toBe(0);
    for (const [path, bytes] of productionBefore) {
      expect(readFileSync(join(production.root, path), 'utf-8'), path).not.toBe(bytes);
    }
    expect(existsSync(join(production.proposalDir, 'SPEC_MERGED'))).toBe(true);

    const faulted = setup();
    const faultedBefore = productionSnapshot(faulted);
    writeFileSync(join(faulted.root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: faulted.slug, module: 'core' }));
    const firstTarget = [...faultedBefore.keys()].sort()[0];
    const failure = spawnSync(process.execPath, [CLI_DIST, 'merge', faulted.slug], {
      cwd: faulted.root, encoding: 'utf-8', timeout: 20_000,
      env: {
        ...process.env, NODE_ENV: 'test',
        OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0',
        OPENLOGOS_TEST_MERGE_FAIL_AFTER: firstTarget,
      },
    });
    expect(failure.status).not.toBe(0);
    for (const [path, bytes] of faultedBefore) {
      expect(readFileSync(join(faulted.root, path), 'utf-8'), path).toBe(bytes);
    }
    expect(existsSync(join(faulted.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(faulted.proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL))).toBe(false);

    // lite-cut2b：CREATE 最低完整度检查随 L9 删除——新文档的结构完整性由人评审判断，不再由 lint 门强制。

    // merge 在落盘前经 L4 复跑 non-Markdown 校验；官方 schema 负例不得绕过纵深防御。
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
    const invalidBefore = productionSnapshot(invalidApi);
    writeFileSync(join(invalidApi.root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: invalidApi.slug, module: 'core' }));
    writeFileSync(join(invalidApi.proposalDir, invalidApiTarget.delta_path!),
      `## MODIFIED — logos/resources/api/touch.yaml（整文件替换）\n${openApiPathParameterMissingRequired}`);
    const invalidApiApply = spawnSync(process.execPath, [CLI_DIST, 'merge', invalidApi.slug], {
      cwd: invalidApi.root, encoding: 'utf-8', timeout: 20_000,
      env: { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
    });
    expect(invalidApiApply.status).not.toBe(0);
    expect(invalidApiApply.stderr).toContain('non_markdown_delta_invalid');
    for (const [path, bytes] of invalidBefore) {
      expect(readFileSync(join(invalidApi.root, path), 'utf-8')).toBe(bytes);
    }
    expect(existsSync(join(invalidApi.proposalDir, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(invalidApi.proposalDir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(invalidApi.proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL))).toBe(false);
  });
});
