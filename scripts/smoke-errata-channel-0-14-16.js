#!/usr/bin/env node
/**
 * SMOKE-core-180 — 0.14.16 docs-only 勘误可携带 deployment/smoke 散文订正且判据 fail-closed（安装态）。
 *
 * 双红线：
 *   ② 放行正例必须 lint exit 0——被拒即缺口未修；
 *   ③ fail-closed 反例必须逐一被拒——任一放行即放宽越界（实质变更混入无部署提案）。
 *
 * 零回归对照（强制）：同一正例在固定 0.14.15 上必须被 disposition 检查拒绝（缺口本身）；
 * 若也放行则断言空转、整体 FAIL。反例与既有路径在两版本上行为一致。
 *
 * 硬约束：全部关键断言穿过公开 `openlogos change-lint` / `openlogos merge` 命令；
 * 不得手工改写夹具的 lint/merge 结论、不得跳过违例变体。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const ERRATA_CHANNEL_SMOKE_IDS = ['SMOKE-core-180'];
const EXPECTED_VERSION = '0.14.16';
const ROLLBACK_VERSION = '0.14.15';
const ENVIRONMENT = 'local-global-temp-project';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: ERRATA_CHANNEL_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_ERRATA_CHANNEL_TARBALL', 'OPENLOGOS_ERRATA_CHANNEL_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

if (!process.env.DRYRUN_ENTRY) {
  requireEnvOrSkip(ERRATA_CHANNEL_SMOKE_IDS, [
    ['OPENLOGOS_ERRATA_CHANNEL_TARBALL', 'OPENLOGOS_TARBALL'],
    ['OPENLOGOS_ERRATA_CHANNEL_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
  ], {
    reason: '勘误散文订正通道 smoke 需要 0.14.16 候选与 0.14.15 回滚制品',
    environment: 'errata-channel',
  });
}

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const run = (cmd, args, cwd = root) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000 });

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result.stdout.trim();
}

function requiredFile(primary, routed) {
  const raw = process.env[primary] || process.env[routed];
  if (!raw) throw new Error(`缺少 ${primary}`);
  const path = realpathSync(resolve(raw));
  if (!existsSync(path)) throw new Error(`${primary} 不存在：${path}`);
  return { path, sha256: sha256(readFileSync(path)) };
}

function commandLookup() {
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-lc', 'command -v openlogos']);
  return realpathSync(checked(r, '定位全局 openlogos').split(/\r?\n/)[0]);
}

const cliBin = e => (e.endsWith('.js') ? process.execPath : e);
const cliArgs = (e, a) => (e.endsWith('.js') ? [e, ...a] : a);
const cli = (e, cwd, a) => checked(run(cliBin(e), cliArgs(e, a), cwd), `openlogos ${a.join(' ')}`);
const cliRaw = (e, cwd, a) => run(cliBin(e), cliArgs(e, a), cwd);
const installGlobal = (tb, v) => checked(run(npmCommand, ['install', '--global', tb]), `全局安装 ${v}`);

function assertInstalledIdentity(expected) {
  const entry = commandLookup();
  const version = cli(entry, root, ['--version']).trim();
  if (!version.includes(expected)) throw new Error(`全局 openlogos 版本不符：期望 ${expected}，实际 ${version}`);
  return { entry, version };
}

const SLUG = 'errata-demo';
const SMOKE_TARGET_REL = 'logos/resources/test/smoke/core-smoke.md';
const DEPLOY_TARGET_REL = 'logos/resources/prd/3-technical-plan/3-deployment/core-deploy.md';
const SMOKE_TARGET = '# smoke 规格\n\n## 冒烟规格\n\n| ID | 场景 |\n|---|---|\n| SMOKE-core-1 | 既有断言（旧口径散文） |\n\n既有散文说明。\n';
const DEPLOY_TARGET = '# 部署方案\n\n## 部署矩阵\n\n旧口径散文行。\n';
const SMOKE_ERRATA = '## MODIFIED — 冒烟规格\n\n| ID | 场景 |\n|---|---|\n| SMOKE-core-1 | 既有断言（订正后口径） |\n\n订正后的散文说明。\n';
const SMOKE_ROGUE = '## MODIFIED — 冒烟规格\n\n| ID | 场景 |\n|---|---|\n| SMOKE-core-1 | 既有断言（订正后口径） |\n| SMOKE-core-9 | 混入的新用例 |\n';
const SMOKE_ADDED = `${SMOKE_ERRATA}\n## ADDED — 新版本节\n\n新增内容。\n`;
const DEPLOY_ERRATA = '## MODIFIED — 部署矩阵\n\n订正后的散文行。\n';

const MATERIAL = [
  ['requirement', 'deltas/prd/1-product-requirements/core-req.md', 'logos/resources/prd/1-product-requirements/core-req.md'],
  ['feature', 'deltas/prd/2-product-design/1-feature-specs/core-feature.md', 'logos/resources/prd/2-product-design/1-feature-specs/core-feature.md'],
  ['architecture', 'deltas/prd/3-technical-plan/1-architecture/core-arch.md', 'logos/resources/prd/3-technical-plan/1-architecture/core-arch.md'],
  ['scenario', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S39.md', 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39.md'],
  ['test', 'deltas/test/core-S39-test-cases.md', 'logos/resources/test/core-S39-test-cases.md'],
  ['deployment', 'deltas/prd/3-technical-plan/3-deployment/core-deploy.md', DEPLOY_TARGET_REL],
  ['smoke', 'deltas/test/smoke/core-smoke.md', SMOKE_TARGET_REL],
];

function closureYaml() {
  const target = ([category, deltaPath, targetPath]) => [
    `    - category: ${category}`,
    "      scenario_ids: [S39]",
    '      mode: MODIFY',
    `      delta_path: "${deltaPath}"`,
    `      reason: "${category === 'deployment' || category === 'smoke' ? `${category} 散文订正（§7.1 errata 例外）。` : `${category} 由 S39 触达并需要最终态更新。`}"`,
    `      evidence: ["target_exists: ${targetPath}"]`,
    '      missing_evidence: []',
  ].join('\n');
  const skip = category => [
    `    - category: ${category}`,
    "      scenario_ids: [S39]",
    '      mode: SKIP',
    '      delta_path: null',
    `      reason: "${category} 经场景证据判定不适用。"`,
    '      evidence: ["scenario:S39#evidence"]',
    '      missing_evidence: []',
  ].join('\n');
  const material = [...MATERIAL].sort((a, b) => a[1].localeCompare(b[1], 'en')).map(target);
  const skips = ['api', 'database', 'orchestration'].sort().map(skip);
  return [
    'baseline_closure:',
    '  policy: on-touch-v1', '  schema_version: 1', '  unit: canonical-merge-target-path',
    '  delta_cardinality: exactly-one-per-non-skip-target',
    '  effective_view: merged-resources-plus-current-change-deltas',
    '  ambiguity: block-before-existing-plan-exit', '  standalone_baseline_required: false',
    '  jit_confirmation: disabled', '  touched_scenario_ids: [S39]', '  targets:',
    ...material, ...skips,
  ].join('\n');
}

function proposalText() {
  return [
    '# 变更提案', '', '> module: core', '',
    '## 变更原因', 'smoke 夹具：订正与既有权威语义相矛盾的 deployment/smoke 散文。', '',
    '## 基线闭包计划', '',
    '```yaml', closureYaml(), '```', '',
    '## 变更类型', '设计级（docs-only 勘误）', '',
    '## 变更范围', '- 影响的部署方案：core-deploy.md 散文订正', '- 影响的 smoke 测试：core-smoke.md 散文订正', '',
    '## 部署影响', '- 是否需要部署：否（勘误不产生新字节）', '- 部署原因：纯散文订正', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否（无部署）', '',
    '## 变更概述', '按 §7.1 errata 例外携带 deployment/smoke 散文订正 delta，零 ID 增删、零行为变化。', '',
    '## Authority Impact', '', '```yaml',
    'authority_impact:', '  schema: openlogos/authority-impact@1', '  applicability: not_applicable',
    '  evidence:', '    - smoke 夹具仅订正散文，不改变业务事实归属', '```', '',
    '## 决策澄清', '', '```yaml',
    'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete', 'impacts:',
    '  data:', '    status: none', '    reason: smoke 夹具不涉及数据影响',
    '  compatibility:', '    status: none', '    reason: smoke 夹具不涉及兼容性影响',
    '  security_privacy:', '    status: none', '    reason: smoke 夹具不涉及安全或隐私影响',
    '  public_release:', '    status: none', '    reason: smoke 夹具不涉及公开发布',
    '  external_commitment:', '    status: none', '    reason: smoke 夹具不涉及外部承诺',
    'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
  ].join('\n');
}

/** 直接落盘的最小 launched 项目 + docs-only errata 提案夹具。 */
function scaffold({ smokeDelta = SMOKE_ERRATA, deployRequired = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-180-'));
  mkdirSync(join(base, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(base, 'logos/logos.config.json'), JSON.stringify({ name: 'errata-smoke', locale: 'zh' }));
  writeFileSync(join(base, 'logos/logos-project.yaml'), [
    'project:', '  name: errata-smoke', 'tech_stack:', '  database: sqlite', 'modules:',
    '  - id: core', '    name: Core', '    lifecycle: launched', '    bootstrap: normal', '    product_type: cli',
  ].join('\n'));
  writeFileSync(join(base, 'logos/.openlogos-guard'), `${JSON.stringify({ activeChange: SLUG, module: 'core' })}\n`);
  const dir = join(base, 'logos/changes', SLUG);
  mkdirSync(dir, { recursive: true });
  for (const [category, deltaPath, targetPath] of MATERIAL) {
    mkdirSync(dirname(join(base, targetPath)), { recursive: true });
    const bytes = category === 'smoke' ? SMOKE_TARGET
      : category === 'deployment' ? DEPLOY_TARGET
        : `# ${category}\n\n## 最终态\n\n既有最终态。\n`;
    writeFileSync(join(base, targetPath), bytes);
    mkdirSync(dirname(join(dir, deltaPath)), { recursive: true });
    const delta = category === 'smoke' ? smokeDelta
      : category === 'deployment' ? DEPLOY_ERRATA
        : `## MODIFIED — 最终态\n\n${category} 已更新。\n`;
    writeFileSync(join(dir, deltaPath), delta);
  }
  let proposal = proposalText();
  let tasks = `# 任务\n\n## [delta] 规格变更\n\n${
    [...MATERIAL].sort((a, b) => a[1].localeCompare(b[1], 'en'))
      .map(([category, deltaPath]) => `- [x] [MODIFY] \`${deltaPath}\`：${category} 最终态。`).join('\n')
  }\n\n## [code] 代码实现\n`;
  if (deployRequired) {
    proposal = proposal
      .replace('- 是否需要部署：否（勘误不产生新字节）', '- 是否需要部署：是（受控发布）')
      .replace('- 是否需要 smoke：否（无部署）', '- 是否需要 smoke：是（发布后验证）')
      .replace('decisions: []', [
        'decisions:', '  - id: C01', '    category: deployment',
        '    question: 是否受控发布？', '    answer: 是，按夹具部署声明执行',
        '    rationale: smoke 夹具的零回归对照需要 deployment_required=true 形态', '    source: user',
        '    affects:', '      - proposal', '    rejected_options: []',
      ].join('\n'));
    tasks += '\n## [deploy] 部署任务\n\n- [ ] 执行受控发布\n';
  }
  writeFileSync(join(dir, 'proposal.md'), proposal);
  writeFileSync(join(dir, 'tasks.md'), tasks);
  return { base, dir };
}

const lint = (entry, base) => cliRaw(entry, base, ['change-lint', '--slug', SLUG, '--format', 'json']);
const merge = (entry, base) => cliRaw(entry, base, ['merge', SLUG]);

/** ②～④；expectLegalRejected=true 时在回滚版本上跑零回归对照。 */
function exercise(entry, { expectLegalRejected = false } = {}) {
  const scopes = [];
  const track = f => { scopes.push(f.base); return f; };
  try {
    // ② 放行正例：docs-only errata 提案 lint / merge 准入
    const legal = track(scaffold());
    const legalLint = lint(entry, legal.base);
    if (expectLegalRejected) {
      if (legalLint.status === 0) {
        throw new Error(`【断言空转】errata 正例在 ${ROLLBACK_VERSION} 上竟放行——必须重写用例而非放行部署`);
      }
      const legalMerge = merge(entry, legal.base);
      if (legalMerge.status === 0) throw new Error(`【断言空转】errata 正例 merge 在 ${ROLLBACK_VERSION} 上竟放行`);
      return { legal_rejected_as_expected: true };
    }
    if (legalLint.status !== 0) {
      throw new Error(`【勘误通道仍不存在】正例 lint 被拒：${legalLint.stdout}${legalLint.stderr}`.slice(0, 600));
    }
    const legalMerge = merge(entry, legal.base);
    if (legalMerge.status !== 0) {
      throw new Error(`【勘误通道仍不存在】正例 merge 准入被拒：${legalMerge.stdout}${legalMerge.stderr}`.slice(0, 600));
    }

    // ③ fail-closed 反例：ID 增删 / ADDED 块，逐一被拒且 violation 可归因
    const rejected = {};
    for (const [name, smokeDelta, marker] of [
      ['id_growth', SMOKE_ROGUE, 'SMOKE-core-9'],
      ['added_block', SMOKE_ADDED, '只允许 MODIFIED 块'],
    ]) {
      const fx = track(scaffold({ smokeDelta }));
      const r = lint(entry, fx.base);
      if (r.status === 0) throw new Error(`【放宽越界】反例 ${name} 竟放行`);
      const raw = `${r.stdout}${r.stderr}`;
      if (!raw.includes(marker)) throw new Error(`反例 ${name} violation 未归因（缺 ${marker}）：${raw.slice(0, 400)}`);
      const m = merge(entry, fx.base);
      if (m.status === 0) throw new Error(`【放宽越界】反例 ${name} merge 竟放行`);
      if (existsSync(join(fx.dir, 'MERGE_TRANSACTION.json'))) throw new Error(`反例 ${name} 残留合并事务`);
      rejected[name] = true;
    }

    // ④ 既有路径零回归：deployment_required=true 实质变更照常放行
    const material = track(scaffold({ smokeDelta: `${SMOKE_ERRATA}\n## ADDED — 新版本 Smoke 节\n\n| ID | 场景 |\n|---|---|\n| SMOKE-core-2 | 新版本断言 |\n`, deployRequired: true }));
    const materialLint = lint(entry, material.base);
    if (materialLint.status !== 0) {
      throw new Error(`【零回归破坏】deployment_required=true 实质变更被拒：${materialLint.stdout}${materialLint.stderr}`.slice(0, 600));
    }

    return { legal_passed: true, ...rejected, material_path_intact: true };
  } finally {
    for (const base of scopes) rmSync(base, { recursive: true, force: true });
  }
}

async function smoke(id, operation) {
  const started = Date.now();
  let record;
  try {
    const evidence = await operation();
    record = { id, status: 'pass', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: ENVIRONMENT, evidence };
  } catch (error) {
    record = { id, status: 'fail', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: ENVIRONMENT, evidence: [], error: error instanceof Error ? error.message : String(error) };
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  if (record.status !== 'pass') throw new Error(record.error);
  return record;
}

if (process.env.DRYRUN_ENTRY) {
  const e = realpathSync(process.env.DRYRUN_ENTRY);
  console.log(`MATRIX ${JSON.stringify({ version: cli(e, root, ['--version']).trim(), ...exercise(e) }, null, 1)}`);
  process.exit(0);
}

await smoke('SMOKE-core-180', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_ERRATA_CHANNEL_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_ERRATA_CHANNEL_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②～④
  const behaviour = exercise(initial.entry);

  // ⑤ 0.14.15→0.14.16 往返 + 零回归对照
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  const counter = exercise(rolledBack.entry, { expectLegalRejected: true });
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const behaviourAfterRestore = exercise(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    behaviour, zero_regression_counter: counter, behaviour_after_restore: behaviourAfterRestore,
  }];
});
