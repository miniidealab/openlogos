#!/usr/bin/env node
/**
 * SMOKE-core-181 — 0.14.17 合并事务终态出路（abort 重建 / completed 重开）安装态验证。
 *
 * 双红线：
 *   ② abort 后必须能归档让位重建——重跑 merge 仍返回 aborted 投影即 FAIL（死锁面①）；
 *   ③ completed 重开全链必须齐备（留痕/归档/作废/重写）——任一缺失即 FAIL（缺口①）。
 *
 * 零回归对照（强制）：同一 ②③ 在固定 0.14.16 上必须失败——abort 后无法重建、reopen 动作不可用
 * （死锁面本身）；若也能重建或重开则断言空转、整体 FAIL。反例与既有路径两版本行为一致。
 *
 * 硬约束：全部关键断言穿过公开 `openlogos merge` / `openlogos merge transaction` 命令；
 * 不得手工删除/改名 MERGE_TRANSACTION.json，不得手工创建、作废或改写 SPEC_MERGED 与 MERGE_REOPENS.jsonl。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const MERGE_TERMINAL_SMOKE_IDS = ['SMOKE-core-181'];
const EXPECTED_VERSION = '0.14.17';
const ROLLBACK_VERSION = '0.14.16';
const ENVIRONMENT = 'local-global-temp-project';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: MERGE_TERMINAL_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_MERGE_TERMINAL_TARBALL', 'OPENLOGOS_MERGE_TERMINAL_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

if (!process.env.DRYRUN_ENTRY) {
  requireEnvOrSkip(MERGE_TERMINAL_SMOKE_IDS, [
    ['OPENLOGOS_MERGE_TERMINAL_TARBALL', 'OPENLOGOS_TARBALL'],
    ['OPENLOGOS_MERGE_TERMINAL_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
  ], {
    reason: '合并事务终态出路 smoke 需要 0.14.17 候选与 0.14.16 回滚制品',
    environment: 'merge-terminal-outcome',
  });
}

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const run = (cmd, args, cwd = root, env = process.env) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, env });

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim().slice(0, 600));
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
// 强制事务路径（NODE_ENV=test 的 vitest 继承环境下 legacy 开关必须显式关闭）
const cliEnv = { ...process.env, OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' };
const cli = (e, cwd, a) => checked(run(cliBin(e), cliArgs(e, a), cwd, cliEnv), `openlogos ${a.join(' ')}`);
const cliRaw = (e, cwd, a) => run(cliBin(e), cliArgs(e, a), cwd, cliEnv);
const installGlobal = (tb, v) => checked(run(npmCommand, ['install', '--global', tb]), `全局安装 ${v}`);

function assertInstalledIdentity(expected) {
  const entry = commandLookup();
  const version = cli(entry, root, ['--version']).trim();
  if (!version.includes(expected)) throw new Error(`全局 openlogos 版本不符：期望 ${expected}，实际 ${version}`);
  return { entry, version };
}

const SLUG = 'terminal-demo';
const CATEGORIES = [
  ['requirement', 'deltas/prd/1-product-requirements/core-req.md', 'logos/resources/prd/1-product-requirements/core-req.md'],
  ['feature', 'deltas/prd/2-product-design/1-feature-specs/core-feature.md', 'logos/resources/prd/2-product-design/1-feature-specs/core-feature.md'],
  ['architecture', 'deltas/prd/3-technical-plan/1-architecture/core-arch.md', 'logos/resources/prd/3-technical-plan/1-architecture/core-arch.md'],
  ['scenario', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S09.md', 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S09.md'],
  ['test', 'deltas/test/core-S09-test-cases.md', 'logos/resources/test/core-S09-test-cases.md'],
];

function closureYaml() {
  const material = [...CATEGORIES].sort((a, b) => a[1].localeCompare(b[1], 'en')).map(([category, deltaPath, targetPath]) => [
    `    - category: ${category}`, '      scenario_ids: [S09]', '      mode: MODIFY',
    `      delta_path: "${deltaPath}"`, `      reason: "${category} 由 S09 触达并需要最终态更新。"`,
    `      evidence: ["target_exists: ${targetPath}"]`, '      missing_evidence: []',
  ].join('\n'));
  const skips = ['api', 'database', 'deployment', 'orchestration', 'smoke'].sort().map(category => [
    `    - category: ${category}`, '      scenario_ids: [S09]', '      mode: SKIP', '      delta_path: null',
    `      reason: "${category} 经场景证据判定不适用。"`, '      evidence: ["scenario:S09#evidence"]', '      missing_evidence: []',
  ].join('\n'));
  return [
    'baseline_closure:', '  policy: on-touch-v1', '  schema_version: 1', '  unit: canonical-merge-target-path',
    '  delta_cardinality: exactly-one-per-non-skip-target',
    '  effective_view: merged-resources-plus-current-change-deltas',
    '  ambiguity: block-before-existing-plan-exit', '  standalone_baseline_required: false',
    '  jit_confirmation: disabled', '  touched_scenario_ids: [S09]', '  targets:', ...material, ...skips,
  ].join('\n');
}

function proposalText() {
  return [
    '# 变更提案', '', '> module: core', '',
    '## 变更原因', 'smoke 夹具：验证合并事务终态出路。', '',
    '## 基线闭包计划', '', '```yaml', closureYaml(), '```', '',
    '## 变更类型', '设计级', '',
    '## 变更范围', '- 五个 MODIFY 目标（终态出路夹具）', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：smoke 夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '终态出路 smoke 夹具提案。', '',
    '## Authority Impact', '', '```yaml',
    'authority_impact:', '  schema: openlogos/authority-impact@1', '  applicability: not_applicable',
    '  evidence:', '    - smoke 夹具不改变业务事实归属', '```', '',
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

function put(base, rel, content) {
  const path = join(base, ...rel.split('/'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function scaffold() {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-181-'));
  put(base, 'logos/logos.config.json', JSON.stringify({ name: 'terminal-smoke', locale: 'zh' }));
  put(base, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: SLUG, module: 'core' })}\n`);
  put(base, 'logos/logos-project.yaml', [
    'project:', '  name: terminal-smoke', 'tech_stack:', '  database: sqlite', 'modules:',
    '  - id: core', '    name: Core', '    lifecycle: launched', '    bootstrap: normal', '    product_type: cli',
  ].join('\n'));
  mkdirSync(join(base, 'logos/resources/verify'), { recursive: true });
  for (const [category, deltaPath, targetPath] of CATEGORIES) {
    put(base, targetPath, `# ${category}\n\n## 最终态\n\n既有最终态。\n`);
    const body = category === 'test'
      ? '| ID | 描述 |\n|---|---|\n| UT-S09-01 | 夹具用例（v1） |\n'
      : `${category} 新增内容 v1。\n`;
    put(base, `logos/changes/${SLUG}/${deltaPath}`, `## ADDED — ${category} 新增节\n\n${body}`);
  }
  put(base, `logos/changes/${SLUG}/proposal.md`, proposalText());
  const tasks = CATEGORIES.map(([category, deltaPath]) => `- [x] [MODIFY] \`${deltaPath}\`：${category} 最终态。`).sort().join('\n');
  put(base, `logos/changes/${SLUG}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n\n${tasks}\n\n## [code] 代码实现\n`);
  return { base, dir: join(base, 'logos/changes', SLUG) };
}

const txCli = (entry, fx, ...args) => cliRaw(entry, fx.base, ['merge', 'transaction', ...args, '--slug', SLUG]);

function readTx(fx) {
  return JSON.parse(readFileSync(join(fx.dir, 'MERGE_TRANSACTION.json'), 'utf8'));
}

/** 提交全部 agent slot（final = 目标现状 + 新增节 / MODIFIED 整节订正），seal + apply 达 completed。 */
function submitSealApply(entry, fx) {
  const tx = readTx(fx);
  for (const target of tx.targets.filter(item => item.producer === 'agent')) {
    const deltaRaw = readFileSync(join(fx.dir, target.delta_path), 'utf8');
    const base = readFileSync(join(fx.base, target.target_path), 'utf8');
    let final;
    if (deltaRaw.startsWith('## MODIFIED — ')) {
      const anchor = deltaRaw.split('\n')[0].replace('## MODIFIED — ', '');
      const newBody = deltaRaw.split('\n').slice(1).join('\n').trim();
      final = `${base.slice(0, base.indexOf(`## ${anchor}`))}## ${anchor}\n\n${newBody}\n`;
    } else {
      final = `${base}\n${deltaRaw.replace(/^## ADDED — /, '## ')}`;
    }
    const statusOut = JSON.parse(cli(entry, fx.base, ['merge', 'transaction', 'status', '--slug', SLUG, '--format', 'json']));
    const descriptor = statusOut.data.merge_transaction.content_slots.items.find(item => item.slot_id === target.slot_id);
    const staging = join(fx.base, ...descriptor.staging_path.split('/'));
    mkdirSync(dirname(staging), { recursive: true });
    const temp = `${staging}.tmp`;
    writeFileSync(temp, final);
    renameSync(temp, staging);
    checked(txCli(entry, fx, 'submit-content', '--slot', target.slot_id, '--file', staging), `submit ${target.slot_id}`);
  }
  checked(txCli(entry, fx, 'seal'), 'seal');
  checked(txCli(entry, fx, 'apply'), 'apply');
}

/** ②～⑤；expectOutcomeMissing=true 时在回滚版本上跑零回归对照。 */
function exercise(entry, { expectOutcomeMissing = false } = {}) {
  const scopes = [];
  const track = fx => { scopes.push(fx.base); return fx; };
  try {
    // ② abort 重建
    const a = track(scaffold());
    checked(cliRaw(entry, a.base, ['merge', SLUG]), '首次 merge');
    const firstId = readTx(a).transaction_id;
    checked(txCli(entry, a, 'abort'), 'abort');
    const reqDelta = join(a.dir, CATEGORIES[0][1]);
    writeFileSync(reqDelta, readFileSync(reqDelta, 'utf8').replace('v1。', 'v2。'));
    const remerge = cliRaw(entry, a.base, ['merge', SLUG]);
    if (expectOutcomeMissing) {
      const rebuilt = remerge.status === 0 && readTx(a).transaction_id !== firstId;
      if (rebuilt) throw new Error(`【断言空转】abort 后在 ${ROLLBACK_VERSION} 上竟能重建——必须重写用例而非放行部署`);
      // completed reopen 在旧版不可用：另一夹具全链后 reopen 必须被拒
      const b2 = track(scaffold());
      checked(cliRaw(entry, b2.base, ['merge', SLUG]), '旧版对照 merge');
      submitSealApply(entry, b2);
      const reopenOld = txCli(entry, b2, 'reopen', '--reason', '对照', '--confirm-spec-merged');
      if (reopenOld.status === 0) throw new Error(`【断言空转】reopen 在 ${ROLLBACK_VERSION} 上竟成功`);
      return { abort_locked_as_expected: true, reopen_unavailable_as_expected: true };
    }
    if (remerge.status !== 0) throw new Error(`【死锁面①未解】abort 后重跑 merge 失败：${remerge.stdout}${remerge.stderr}`.slice(0, 500));
    const rebuiltId = readTx(a).transaction_id;
    if (rebuiltId === firstId) throw new Error('【死锁面①未解】abort 后重跑 merge 返回同一事务（未归档让位）');
    if (!existsSync(join(a.dir, 'merge-transactions', `${firstId}.json`))) throw new Error('旧 aborted 事务未归档');
    submitSealApply(entry, a);
    if (!existsSync(join(a.dir, 'SPEC_MERGED'))) throw new Error('全链 completed 后 SPEC_MERGED 缺失');

    // ③ completed 重开全链
    const noConfirm = txCli(entry, a, 'reopen', '--reason', '规格有误');
    if (noConfirm.status === 0) throw new Error('【放宽越界】未附确认的 reopen 竟成功');
    const reopened = txCli(entry, a, 'reopen', '--reason', '规格有误', '--confirm-spec-merged');
    if (reopened.status !== 0) throw new Error(`【缺口①未修】reopen 被拒：${reopened.stdout}${reopened.stderr}`.slice(0, 500));
    if (existsSync(join(a.dir, 'SPEC_MERGED'))) throw new Error('reopen 后 SPEC_MERGED 未作废');
    const audit = readFileSync(join(a.dir, 'MERGE_REOPENS.jsonl'), 'utf8');
    if (!audit.includes(rebuiltId) || !audit.includes('openlogos/merge-reopen@1')) throw new Error(`留痕不齐备：${audit.slice(0, 200)}`);
    if (!existsSync(join(a.dir, 'merge-transactions', `${rebuiltId}.json`))) throw new Error('重开后旧事务未归档');
    for (const [category, deltaPath] of CATEGORIES) {
      const body = category === 'test'
        ? '| ID | 描述 |\n|---|---|\n| UT-S09-01 | 夹具用例（v3） |'
        : `${category} 订正内容 v3。`;
      writeFileSync(join(a.dir, deltaPath), `## MODIFIED — ${category} 新增节\n\n${body}\n`);
    }
    checked(txCli(entry, a, 'abort'), '重开后让位');
    checked(cliRaw(entry, a.base, ['merge', SLUG]), '重合并 merge');
    submitSealApply(entry, a);
    if (!existsSync(join(a.dir, 'SPEC_MERGED'))) throw new Error('重合并后 SPEC_MERGED 未重写');

    // ④ fail-closed 反例：空 reason / 非 completed reopen
    const c = track(scaffold());
    checked(cliRaw(entry, c.base, ['merge', SLUG]), '反例 merge');
    if (txCli(entry, c, 'reopen', '--reason', '早了').status === 0) throw new Error('【放宽越界】collecting reopen 竟成功');
    if (txCli(entry, c, 'reopen', '--reason', '   ').status === 0) throw new Error('【放宽越界】空 reason reopen 竟成功');
    if (existsSync(join(c.dir, 'MERGE_REOPENS.jsonl'))) throw new Error('被拒的 reopen 留下副作用');

    return { abort_rebuild: true, reopen_full_chain: true, spec_merged_rewritten: true, fail_closed: true };
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

await smoke('SMOKE-core-181', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_MERGE_TERMINAL_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_MERGE_TERMINAL_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②～④
  const behaviour = exercise(initial.entry);

  // ⑤ 0.14.16→0.14.17 往返 + 零回归对照
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  const counter = exercise(rolledBack.entry, { expectOutcomeMissing: true });
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const behaviourAfterRestore = exercise(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    behaviour, zero_regression_counter: counter, behaviour_after_restore: behaviourAfterRestore,
  }];
});
