#!/usr/bin/env node
// SMOKE-core-190：0.14.19 merge 前沿事务事实全链（含跨组件验收 + 0.14.18 死区零回归对照）。
// 全部关键断言穿过公开 openlogos merge / merge transaction / status / next 命令；
// 环境缺失写显式 skip，禁止静默零记录退出。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SMOKE_ID = 'SMOKE-core-190';
const EXPECTED_VERSION = '0.14.19';
const ROLLBACK_VERSION = '0.14.18';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/merge-frontier-smoke@1',
    ids: [SMOKE_ID],
    required_env: ['OPENLOGOS_MERGE_FRONTIER_TARBALL', 'OPENLOGOS_MERGE_FRONTIER_ROLLBACK_TARBALL'],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'fix-merge-flow-transaction-contract' && process.env.OPENLOGOS_MERGE_FRONTIER_STAGING !== '1') {
  exitNotApplicable([SMOKE_ID], {
    reason: 'merge frontier staging 未就绪：需活跃变更 fix-merge-flow-transaction-contract 或 OPENLOGOS_MERGE_FRONTIER_STAGING=1',
    missing: ['OPENLOGOS_MERGE_FRONTIER_STAGING', 'OPENLOGOS_MERGE_FRONTIER_TARBALL'],
    environment: 'merge-frontier-staging',
  });
}

const tarball = process.env.OPENLOGOS_MERGE_FRONTIER_TARBALL;
const rollbackTarball = process.env.OPENLOGOS_MERGE_FRONTIER_ROLLBACK_TARBALL;

function sanitize(value) {
  return String(value).replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>').slice(0, 4000);
}

function writeResult(status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id: SMOKE_ID, status, timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt, environment: 'merge-frontier-staging', evidence,
  };
  if (error) record.error = sanitize(error);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot, env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8', timeout: options.timeout || 300000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} 失败：exit ${result.status}\n${result.stderr}`);
  }
  return result;
}

const work = mkdtempSync(join(tmpdir(), 'openlogos-frontier-smoke-'));

function installEntry(file, name) {
  const prefix = join(work, `prefix-${name}`);
  mkdirSync(prefix, { recursive: true });
  checked('npm', ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', file]);
  return join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js');
}

/** 与 CLI 回归同构的最小 launched 提案 fixture（requirement/feature/scenario/test 四强制维度 MODIFY）。 */
function buildFixture(dir, withDelta = true) {
  const slug = 'frontier-smoke-fixture';
  const put = (rel, content) => {
    const full = join(dir, rel); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content);
  };
  put('logos/logos.config.json', '{"locale":"zh","project":{"type":"cli"}}\n');
  put('logos/.openlogos-guard', JSON.stringify({ activeChange: slug, module: 'core' }) + '\n');
  put('logos/logos-project.yaml', 'project:\n  name: F\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  const files = [
    ['requirement', 'logos/resources/prd/1-product-requirements/core-01-requirements.md', 'deltas/prd/1-product-requirements/core-01-requirements.md', '旧正文。', '新正文。'],
    ['feature', 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md', 'deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md', '旧正文。', '新正文。'],
    ['scenario', 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md', '旧正文。', '新正文。'],
    ['test', 'logos/resources/test/core-S01-test-cases.md', 'deltas/test/core-S01-test-cases.md',
      '| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |', '| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |'],
  ];
  const finals = {};
  for (const [, target, delta, before, after] of files) {
    put(target, `# 文档\n\n## 一、判据\n\n${before}\n`);
    finals[target] = `# 文档\n\n## 一、判据\n\n${after}\n`;
    if (withDelta) put(`logos/changes/${slug}/${delta}`, `## MODIFIED — 一、判据\n\n${after}\n`);
  }
  const modify = files.map(([category, , delta]) => [
    `    - category: ${category}`, '      scenario_ids: [S01]', '      mode: MODIFY',
    `      delta_path: ${delta}`, '      reason: fixture', '      evidence: [target_exists]', '      missing_evidence: []',
  ].join('\n'));
  const skip = category => [
    `    - category: ${category}`, '      scenario_ids: [S01]', '      mode: SKIP',
    '      delta_path: null', '      reason: fixture 不适用', '      evidence: [fixture]', '      missing_evidence: []',
  ].join('\n');
  const dims = ['api', 'architecture', 'database', 'deployment', 'orchestration', 'smoke'];
  const sortedModify = files.map(([, , delta], index) => ({ delta, block: modify[index] }))
    .sort((a, b) => a.delta.localeCompare(b.delta)).map(item => item.block).join('\n');
  const clarification = '## 决策澄清\n\n```yaml\nschema: openlogos/clarification@1\nmode: adaptive\nstatus: complete\nimpacts:\n  data: {status: none, reason: fixture}\n  compatibility: {status: none, reason: fixture}\n  security_privacy: {status: none, reason: fixture}\n  public_release: {status: none, reason: fixture}\n  external_commitment: {status: none, reason: fixture}\ndecisions: []\nunresolved: []\ndefaults: []\n```\n';
  const head = '# 变更提案：frontier smoke\n\n## 变更原因\n真实原因。\n\n## 变更类型\n设计级\n\n## 变更范围\n- 影响的功能规格：fixture\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 变更概述\n概述。\n\n';
  if (withDelta) {
    put(`logos/changes/${slug}/proposal.md`,
      `${head}${clarification}\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  policy: on-touch-v1\n  schema_version: 1\n  unit: canonical-merge-target-path\n  delta_cardinality: exactly-one-per-non-skip-target\n  effective_view: merged-resources-plus-current-change-deltas\n  ambiguity: block-before-existing-plan-exit\n  standalone_baseline_required: false\n  jit_confirmation: disabled\n  touched_scenario_ids: [S01]\n  targets:\n${sortedModify}\n${dims.map(skip).join('\n')}\n\`\`\`\n`);
    put(`logos/changes/${slug}/tasks.md`,
      `# 任务\n\n## [delta] 规格变更\n${files.map(([, , delta]) => `- [x] [MODIFY] \`${delta}\`：fixture 更新`).sort().join('\n')}\n\n## [code] 代码实现\n`);
  } else {
    put(`logos/changes/${slug}/proposal.md`, `${head}## 复用测试 ID\n\n- UT-S01-01 — 回归覆盖\n\n${clarification}`);
    put(`logos/changes/${slug}/tasks.md`, '# 任务\n\n## [delta] 规格变更\n\n## [code] 代码实现\n');
  }
  // PLAN_APPROVED 属 HISTORICAL_MARKERS：与 vitest fixture 同形，豁免 authority_impact 声明
  put(`logos/changes/${slug}/PLAN_APPROVED`, '{}');
  return { slug, finals, proposalDir: join(dir, 'logos', 'changes', slug) };
}

function cliJson(entry, args, cwd) {
  return JSON.parse(checked(process.execPath, [entry, ...args, '--format', 'json'], { cwd }).stdout);
}

function stepOf(entry, cwd) {
  const data = cliJson(entry, ['next'], cwd).data;
  return (data.modules?.[0] ?? data).proposal_step ?? data.proposal_step;
}

const startedAt = Date.now();
try {
  if (!tarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_MERGE_FRONTIER_TARBALL'), { __skip: true });
  if (!rollbackTarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_MERGE_FRONTIER_ROLLBACK_TARBALL'), { __skip: true });
  const evidence = [];

  // ① candidate identity
  const entry = installEntry(tarball, 'candidate');
  const version = checked(process.execPath, [entry, '--version']).stdout.trim();
  if (version !== EXPECTED_VERSION) throw new Error(`candidate 版本漂移：${version}`);
  evidence.push(`candidate=${EXPECTED_VERSION} sha256:${sha256(tarball)}`);

  // ② 跨组件全链：merge 开事务 → 前沿推进 → submit/seal/apply → SPEC_MERGED → 前沿越过
  const project = join(work, 'p-chain');
  const f = buildFixture(project);
  checked(process.execPath, [entry, 'merge', f.slug], { cwd: project });
  if (!existsSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'))) throw new Error('merge 未创建事务');
  if (stepOf(entry, project) !== 'merge-generated') throw new Error('开事务后前沿未推进 merge-generated（死区未除）');
  const projection = cliJson(entry, ['next'], project).data.merge_transaction;
  if (!projection || projection.phase !== 'collecting') throw new Error('data.merge_transaction 未必挂或相位错误');
  const txStatus = cliJson(entry, ['merge', 'transaction', 'status', '--slug', f.slug], project).data.merge_transaction;
  if (JSON.stringify(projection) !== JSON.stringify(txStatus)) throw new Error('投影与 transaction status 漂移');
  for (const target of txStatus.content_slots.missing_slot_ids) {
    const detail = cliJson(entry, ['merge', 'transaction', 'status', '--slug', f.slug], project).data.merge_transaction;
    const item = detail.content_slots.items.find(row => row.slot_id === target);
    const staging = join(project, item.staging_path);
    mkdirSync(dirname(staging), { recursive: true });
    const planTarget = JSON.parse(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'))
      .targets.find(row => row.slot_id === target);
    writeFileSync(staging, f.finals[planTarget.target_path]);
    checked(process.execPath, [entry, 'merge', 'transaction', 'submit-content', '--slug', f.slug, '--slot', target, '--file', staging], { cwd: project });
  }
  checked(process.execPath, [entry, 'merge', 'transaction', 'seal', '--slug', f.slug], { cwd: project });
  checked(process.execPath, [entry, 'merge', 'transaction', 'apply', '--slug', f.slug], { cwd: project });
  if (!existsSync(join(f.proposalDir, 'SPEC_MERGED'))) throw new Error('apply 后 SPEC_MERGED 缺失');
  const afterStep = stepOf(entry, project);
  if (afterStep === 'merge-generated' || afterStep === 'ready-to-merge') throw new Error(`apply 后前沿未越过 merge 段：${afterStep}`);
  evidence.push('跨组件全链前沿推进通过');

  // ③ 后置条件二分 + 收尾文案
  const noDeltaProject = join(work, 'p-nodelta');
  const noDeltaFixture = buildFixture(noDeltaProject, false);
  const noDeltaOut = checked(process.execPath, [entry, 'merge', noDeltaFixture.slug], { cwd: noDeltaProject });
  if (!existsSync(join(noDeltaFixture.proposalDir, 'SPEC_MERGED'))) throw new Error('no-delta 未当场写 SPEC_MERGED');
  const withDeltaProject = join(work, 'p-hint');
  const hintFixture = buildFixture(withDeltaProject);
  const hintOut = checked(process.execPath, [entry, 'merge', hintFixture.slug], { cwd: withDeltaProject });
  if (hintOut.stdout.includes('MERGE_PROMPT.md')) throw new Error('收尾提示仍指向 MERGE_PROMPT.md');
  if (!hintOut.stdout.includes('submit-content')) throw new Error('收尾提示缺事务引导');
  void noDeltaOut;
  evidence.push('后置条件二分与事务引导文案通过');

  // ④ 幂等 + abort 重建
  const beforeId = JSON.parse(readFileSync(join(hintFixture.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8')).transaction_id;
  checked(process.execPath, [entry, 'merge', hintFixture.slug], { cwd: withDeltaProject });
  const afterId = JSON.parse(readFileSync(join(hintFixture.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8')).transaction_id;
  if (beforeId !== afterId) throw new Error('非终态重跑 merge 未幂等');
  checked(process.execPath, [entry, 'merge', 'transaction', 'abort', '--slug', hintFixture.slug], { cwd: withDeltaProject });
  checked(process.execPath, [entry, 'merge', hintFixture.slug], { cwd: withDeltaProject });
  if (!existsSync(join(hintFixture.proposalDir, 'merge-transactions', `${beforeId}.json`))) throw new Error('abort 后重建未归档旧事务');
  if (stepOf(entry, withDeltaProject) !== 'merge-generated') throw new Error('重建后前沿漂移');
  evidence.push('幂等与终态重建通过');

  // ⑤ 存量失配稳定码
  const staleTx = JSON.parse(readFileSync(join(hintFixture.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'));
  staleTx.schema_sha256 = `sha256:${'6'.repeat(64)}`;
  writeFileSync(join(hintFixture.proposalDir, 'MERGE_TRANSACTION.json'), JSON.stringify(staleTx, null, 2) + '\n');
  const staleSeal = checked(process.execPath, [entry, 'merge', 'transaction', 'seal', '--slug', hintFixture.slug], { cwd: withDeltaProject, allowFailure: true });
  if (staleSeal.status === 0) throw new Error('存量失配事务未被拒绝');
  if (!staleSeal.stderr.includes('unsupported_contract')) throw new Error('失配拒绝缺稳定码');
  if (!staleSeal.stderr.includes('abort')) throw new Error('失配拒绝缺 remediation');
  evidence.push('存量失配 fail-closed 稳定码通过');

  // ⑥ 零回归对照：0.14.18 上 merge 开事务后前沿必须仍死区
  const rollbackEntry = installEntry(rollbackTarball, 'rollback');
  const rollbackVersion = checked(process.execPath, [rollbackEntry, '--version']).stdout.trim();
  if (rollbackVersion !== ROLLBACK_VERSION) throw new Error(`回滚版本漂移：${rollbackVersion}`);
  const contrastProject = join(work, 'p-contrast');
  const contrastFixture = buildFixture(contrastProject);
  checked(process.execPath, [rollbackEntry, 'merge', contrastFixture.slug], { cwd: contrastProject });
  if (!existsSync(join(contrastFixture.proposalDir, 'MERGE_TRANSACTION.json'))) throw new Error('对照：0.14.18 merge 未开事务');
  const contrastStep = stepOf(rollbackEntry, contrastProject);
  if (contrastStep !== 'ready-to-merge') throw new Error(`对照空转：0.14.18 前沿=${contrastStep}（应死区停 ready-to-merge）`);
  evidence.push('0.14.18 死区零回归对照有效');

  // ⑦ roundtrip identity
  const restored = checked(process.execPath, [installEntry(tarball, 'restore'), '--version']).stdout.trim();
  if (restored !== EXPECTED_VERSION) throw new Error('roundtrip 恢复失败');
  evidence.push(`roundtrip ${ROLLBACK_VERSION}→${EXPECTED_VERSION} 无混装`);

  writeResult('pass', startedAt, null, evidence);
  console.log(`✓ ${SMOKE_ID}`);
} catch (error) {
  if (error && error.__skip) {
    writeResult('skip', startedAt, error.message, []);
    console.log(`- ${SMOKE_ID} skip: ${error.message}`);
  } else {
    writeResult('fail', startedAt, error instanceof Error ? error.message : String(error), []);
    console.error(`✗ ${SMOKE_ID}: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
