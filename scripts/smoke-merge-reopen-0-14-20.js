#!/usr/bin/env node
// SMOKE-core-191：0.14.20 reopen 后 test change set 前滚全链（含 removed 后写胜出、失配 fail-closed、
// 无留痕零回归与 0.14.19 空 change set 缺陷对照）。全部关键断言穿过公开 openlogos merge /
// merge transaction 命令与 SPEC_MERGED 磁盘事实；环境缺失写显式 skip，禁止静默零记录退出。
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

const SMOKE_ID = 'SMOKE-core-191';
const EXPECTED_VERSION = '0.14.20';
const ROLLBACK_VERSION = '0.14.19';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/merge-reopen-smoke@1',
    ids: [SMOKE_ID],
    required_env: ['OPENLOGOS_MERGE_REOPEN_TARBALL', 'OPENLOGOS_MERGE_REOPEN_ROLLBACK_TARBALL'],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'fix-reopen-test-change-set-forward-merge' && process.env.OPENLOGOS_MERGE_REOPEN_STAGING !== '1') {
  exitNotApplicable([SMOKE_ID], {
    reason: 'merge reopen staging 未就绪：需活跃变更 fix-reopen-test-change-set-forward-merge 或 OPENLOGOS_MERGE_REOPEN_STAGING=1',
    missing: ['OPENLOGOS_MERGE_REOPEN_STAGING', 'OPENLOGOS_MERGE_REOPEN_TARBALL'],
    environment: 'merge-reopen-staging',
  });
}

const tarball = process.env.OPENLOGOS_MERGE_REOPEN_TARBALL;
const rollbackTarball = process.env.OPENLOGOS_MERGE_REOPEN_ROLLBACK_TARBALL;

function sanitize(value) {
  return String(value).replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>').slice(0, 4000);
}

function writeResult(status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id: SMOKE_ID, status, timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt, environment: 'merge-reopen-staging', evidence,
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

const work = mkdtempSync(join(tmpdir(), 'openlogos-reopen-smoke-'));

function installEntry(file, name) {
  const prefix = join(work, `prefix-${name}`);
  mkdirSync(prefix, { recursive: true });
  checked('npm', ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', file]);
  return join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js');
}

const TABLE_BOTH = '| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |\n| UT-S01-02 | 二号用例 |';
const TABLE_ONE = '| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |';

/** 与 CLI 回归同构的最小 launched 提案 fixture；测试表含两个新增 ID（供 removed 后写胜出步骤删除其一）。 */
function buildFixture(dir) {
  const slug = 'reopen-smoke-fixture';
  const put = (rel, content) => {
    const full = join(dir, rel); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content);
  };
  put('logos/logos.config.json', '{"locale":"zh","project":{"type":"cli"}}\n');
  put('logos/.openlogos-guard', JSON.stringify({ activeChange: slug, module: 'core' }) + '\n');
  put('logos/logos-project.yaml', 'project:\n  name: R\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n');
  const files = [
    ['requirement', 'logos/resources/prd/1-product-requirements/core-01-requirements.md', 'deltas/prd/1-product-requirements/core-01-requirements.md', '旧正文。', '新正文。'],
    ['feature', 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md', 'deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md', '旧正文。', '新正文。'],
    ['scenario', 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md', '旧正文。', '新正文。'],
    ['test', 'logos/resources/test/core-S01-test-cases.md', 'deltas/test/core-S01-test-cases.md',
      '| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |', TABLE_BOTH],
  ];
  const finals = {};
  for (const [, target, delta, before, after] of files) {
    put(target, `# 文档\n\n## 一、判据\n\n${before}\n`);
    finals[target] = `# 文档\n\n## 一、判据\n\n${after}\n`;
    put(`logos/changes/${slug}/${delta}`, `## MODIFIED — 一、判据\n\n${after}\n`);
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
  const head = '# 变更提案：reopen smoke\n\n## 变更原因\n真实原因。\n\n## 变更类型\n设计级\n\n## 变更范围\n- 影响的功能规格：fixture\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 变更概述\n概述。\n\n';
  put(`logos/changes/${slug}/proposal.md`,
    `${head}${clarification}\n## 基线闭包计划\n\n\`\`\`yaml\nbaseline_closure:\n  policy: on-touch-v1\n  schema_version: 1\n  unit: canonical-merge-target-path\n  delta_cardinality: exactly-one-per-non-skip-target\n  effective_view: merged-resources-plus-current-change-deltas\n  ambiguity: block-before-existing-plan-exit\n  standalone_baseline_required: false\n  jit_confirmation: disabled\n  touched_scenario_ids: [S01]\n  targets:\n${sortedModify}\n${dims.map(skip).join('\n')}\n\`\`\`\n`);
  put(`logos/changes/${slug}/tasks.md`,
    `# 任务\n\n## [delta] 规格变更\n${files.map(([, , delta]) => `- [x] [MODIFY] \`${delta}\`：fixture 更新`).sort().join('\n')}\n\n## [code] 代码实现\n`);
  // PLAN_APPROVED 属 HISTORICAL_MARKERS：豁免 authority_impact 声明（与 CLI 回归 fixture 同形）
  put(`logos/changes/${slug}/PLAN_APPROVED`, '{}');
  return { slug, finals, proposalDir: join(dir, 'logos', 'changes', slug), project: dir };
}

function cliJson(entry, args, cwd) {
  return JSON.parse(checked(process.execPath, [entry, ...args, '--format', 'json'], { cwd }).stdout);
}

/** 提交全部缺失 slot → seal → apply（事务须已在盘：merge 或 reopen 创建）。 */
function driveChain(entry, f) {
  const txStatus = cliJson(entry, ['merge', 'transaction', 'status', '--slug', f.slug], f.project).data.merge_transaction;
  for (const target of txStatus.content_slots.missing_slot_ids) {
    const item = txStatus.content_slots.items.find(row => row.slot_id === target);
    const staging = join(f.project, item.staging_path);
    mkdirSync(dirname(staging), { recursive: true });
    const planTarget = JSON.parse(readFileSync(join(f.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'))
      .targets.find(row => row.slot_id === target);
    writeFileSync(staging, f.finals[planTarget.target_path]);
    checked(process.execPath, [entry, 'merge', 'transaction', 'submit-content', '--slug', f.slug, '--slot', target, '--file', staging], { cwd: f.project });
  }
  checked(process.execPath, [entry, 'merge', 'transaction', 'seal', '--slug', f.slug], { cwd: f.project });
  checked(process.execPath, [entry, 'merge', 'transaction', 'apply', '--slug', f.slug], { cwd: f.project });
}

function changeSetOf(f) {
  return JSON.parse(readFileSync(join(f.proposalDir, 'SPEC_MERGED'), 'utf8')).test_change_set;
}

function putFile(dir, rel, content) {
  const full = join(dir, rel); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, content);
}

function reopen(entry, f, reason) {
  checked(process.execPath, [entry, 'merge', 'transaction', 'reopen', '--slug', f.slug, '--reason', reason, '--confirm-spec-merged'], { cwd: f.project });
}

const startedAt = Date.now();
try {
  if (!tarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_MERGE_REOPEN_TARBALL'), { __skip: true });
  if (!rollbackTarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_MERGE_REOPEN_ROLLBACK_TARBALL'), { __skip: true });
  const evidence = [];

  // ① candidate identity
  const entry = installEntry(tarball, 'candidate');
  const version = checked(process.execPath, [entry, '--version']).stdout.trim();
  if (version !== EXPECTED_VERSION) throw new Error(`candidate 版本漂移：${version}`);
  evidence.push(`candidate=${EXPECTED_VERSION} sha256:${sha256(tarball)}`);

  // ② 前滚全链：首轮完整 merge（changed 含两个新增 ID）→ 修正非测试目标 → reopen → 幂等重合并
  const a = buildFixture(join(work, 'p-forward'));
  checked(process.execPath, [entry, 'merge', a.slug], { cwd: a.project });
  driveChain(entry, a);
  const first = changeSetOf(a);
  if (JSON.stringify(first.changed_test_ids) !== JSON.stringify(['UT-S01-01', 'UT-S01-02'])) {
    throw new Error(`首轮 change set 异常：${JSON.stringify(first.changed_test_ids)}`);
  }
  // 修正 delta 先落盘再 reopen（事务创建时冻结 delta 哈希）；测试目标保持幂等
  putFile(a.project, `logos/changes/${a.slug}/deltas/prd/1-product-requirements/core-01-requirements.md`, '## MODIFIED — 一、判据\n\n修正后的正文。\n');
  a.finals['logos/resources/prd/1-product-requirements/core-01-requirements.md'] = '# 文档\n\n## 一、判据\n\n修正后的正文。\n';
  reopen(entry, a, '修正需求描述');
  driveChain(entry, a);
  const forwarded = changeSetOf(a);
  if (JSON.stringify(forwarded.changed_test_ids) !== JSON.stringify(['UT-S01-01', 'UT-S01-02'])) {
    throw new Error(`前滚失败：reopen 幂等重合并后 changed=${JSON.stringify(forwarded.changed_test_ids)}（首轮 ID 丢失）`);
  }
  if (forwarded.removed_test_ids.length !== 0) throw new Error('前滚后 removed 应为空');
  if (!/^sha256:[0-9a-f]{64}$/.test(forwarded.sha256)) throw new Error('前滚后 sha256 非法');
  evidence.push('reopen 幂等重合并后 changed 提案级完整');

  // ③ removed 后写胜出：再 reopen，本轮删除 UT-S01-02 行
  putFile(a.project, `logos/changes/${a.slug}/deltas/test/core-S01-test-cases.md`, `## MODIFIED — 一、判据\n\n${TABLE_ONE}\n`);
  a.finals['logos/resources/test/core-S01-test-cases.md'] = `# 文档\n\n## 一、判据\n\n${TABLE_ONE}\n`;
  reopen(entry, a, '删除二号用例');
  driveChain(entry, a);
  const afterRemove = changeSetOf(a);
  if (JSON.stringify(afterRemove.changed_test_ids) !== JSON.stringify(['UT-S01-01'])) {
    throw new Error(`removed 后写胜出失败：changed=${JSON.stringify(afterRemove.changed_test_ids)}`);
  }
  if (JSON.stringify(afterRemove.removed_test_ids) !== JSON.stringify(['UT-S01-02'])) {
    throw new Error(`removed 后写胜出失败：removed=${JSON.stringify(afterRemove.removed_test_ids)}`);
  }
  evidence.push('removed 后写胜出通过');

  // ④ 失配 fail-closed：隔离副本篡改归档 receipt 身份 → seal 稳定拒绝并点名路径
  const b = buildFixture(join(work, 'p-mismatch'));
  checked(process.execPath, [entry, 'merge', b.slug], { cwd: b.project });
  driveChain(entry, b);
  reopen(entry, b, '失配演示');
  const auditLine = JSON.parse(readFileSync(join(b.proposalDir, 'MERGE_REOPENS.jsonl'), 'utf8').trim().split('\n')[0]);
  const receiptPath = join(b.proposalDir, 'merge-transactions', `${auditLine.old_transaction_id}.receipt.json`);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.test_change_set.change = 'other-change';
  writeFileSync(receiptPath, JSON.stringify(receipt));
  const txStatus = cliJson(entry, ['merge', 'transaction', 'status', '--slug', b.slug], b.project).data.merge_transaction;
  for (const target of txStatus.content_slots.missing_slot_ids) {
    const item = txStatus.content_slots.items.find(row => row.slot_id === target);
    const staging = join(b.project, item.staging_path);
    mkdirSync(dirname(staging), { recursive: true });
    const planTarget = JSON.parse(readFileSync(join(b.proposalDir, 'MERGE_TRANSACTION.json'), 'utf8'))
      .targets.find(row => row.slot_id === target);
    writeFileSync(staging, b.finals[planTarget.target_path]);
    checked(process.execPath, [entry, 'merge', 'transaction', 'submit-content', '--slug', b.slug, '--slot', target, '--file', staging], { cwd: b.project });
  }
  const badSeal = checked(process.execPath, [entry, 'merge', 'transaction', 'seal', '--slug', b.slug], { cwd: b.project, allowFailure: true });
  if (badSeal.status === 0) throw new Error('失配祖先 receipt 未被拒绝');
  if (!badSeal.stderr.includes('身份失配')) throw new Error('失配拒绝缺稳定信息');
  if (!badSeal.stderr.includes('.receipt.json')) throw new Error('失配拒绝未点名 receipt 路径');
  evidence.push('失配 fail-closed 稳定拒绝通过');

  // ⑤ 无留痕零回归（candidate 上）：未 reopen 的提案 change set 正常且无前滚通道副作用
  const c = buildFixture(join(work, 'p-plain'));
  checked(process.execPath, [entry, 'merge', c.slug], { cwd: c.project });
  driveChain(entry, c);
  if (existsSync(join(c.proposalDir, 'MERGE_REOPENS.jsonl'))) throw new Error('无留痕提案不应有 MERGE_REOPENS.jsonl');
  const plain = changeSetOf(c);
  if (JSON.stringify(plain.changed_test_ids) !== JSON.stringify(['UT-S01-01', 'UT-S01-02'])) {
    throw new Error(`无留痕零回归失败：${JSON.stringify(plain.changed_test_ids)}`);
  }
  evidence.push('无留痕零回归通过');

  // ⑥ 0.14.19 对照：同一 reopen+幂等重合并流程必须复现空 change set（缺陷本身，防断言空转）
  const rollbackEntry = installEntry(rollbackTarball, 'rollback');
  const rollbackVersion = checked(process.execPath, [rollbackEntry, '--version']).stdout.trim();
  if (rollbackVersion !== ROLLBACK_VERSION) throw new Error(`回滚版本漂移：${rollbackVersion}`);
  const d = buildFixture(join(work, 'p-contrast'));
  checked(process.execPath, [rollbackEntry, 'merge', d.slug], { cwd: d.project });
  driveChain(rollbackEntry, d);
  const contrastFirst = changeSetOf(d);
  if (JSON.stringify(contrastFirst.changed_test_ids) !== JSON.stringify(['UT-S01-01', 'UT-S01-02'])) {
    throw new Error('对照：0.14.19 首轮 change set 异常');
  }
  putFile(d.project, `logos/changes/${d.slug}/deltas/prd/1-product-requirements/core-01-requirements.md`, '## MODIFIED — 一、判据\n\n修正后的正文。\n');
  d.finals['logos/resources/prd/1-product-requirements/core-01-requirements.md'] = '# 文档\n\n## 一、判据\n\n修正后的正文。\n';
  reopen(rollbackEntry, d, '对照修正');
  driveChain(rollbackEntry, d);
  const contrast = changeSetOf(d);
  if (contrast.changed_test_ids.includes('UT-S01-01') && contrast.changed_test_ids.includes('UT-S01-02')) {
    throw new Error(`对照空转：0.14.19 上 changed 也保持完整（${JSON.stringify(contrast.changed_test_ids)}），矩阵必须重写`);
  }
  evidence.push(`0.14.19 空 change set 缺陷对照有效（changed=${JSON.stringify(contrast.changed_test_ids)}）`);

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
