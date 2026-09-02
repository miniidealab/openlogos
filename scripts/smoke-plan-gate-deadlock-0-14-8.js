#!/usr/bin/env node
/**
 * SMOKE-core-172 — 0.14.8 plan 门死锁解除与强度不降（安装态）。
 *
 * 只接受冻结本地 tarball；全部断言在一次性临时项目中构造，
 * **不触碰本仓或用户其它项目的活跃提案、guard 与 marker**，
 * **不手工创建 PLAN_APPROVED**——手工创建正是本缺陷当前的绕法，用它构造前提会使本用例失去意义。
 * 不包含公开发布、远程仓库或官网写操作。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const PLAN_GATE_DEADLOCK_SMOKE_IDS = ['SMOKE-core-172'];
const EXPECTED_VERSION = '0.14.8';
const ROLLBACK_VERSION = '0.14.7';
const ENVIRONMENT = 'local-global-temp-project';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: PLAN_GATE_DEADLOCK_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_PLAN_GATE_TARBALL', 'OPENLOGOS_PLAN_GATE_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

// 环境不具备（缺候选/回滚制品）必须留痕：沿用既有的不适用契约，禁止静默零记录退出
requireEnvOrSkip(PLAN_GATE_DEADLOCK_SMOKE_IDS, [
  ['OPENLOGOS_PLAN_GATE_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_PLAN_GATE_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: 'plan 门死锁 smoke 需要 0.14.8 候选与 0.14.7 回滚制品',
  environment: 'plan-gate-deadlock',
});

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function run(command, args, cwd = root, env = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 600_000 });
}

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
  const result = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-lc', 'command -v openlogos']);
  return realpathSync(checked(result, '定位全局 openlogos').split(/\r?\n/)[0]);
}

const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cli = (entry, cwd, args) => checked(run(cliBin(entry), cliArgs(entry, args), cwd), `openlogos ${args.join(' ')}`);
/** 允许非零退出的调用——负向断言要读诊断，不能因退出码直接抛。 */
const cliRaw = (entry, cwd, args) => run(cliBin(entry), cliArgs(entry, args), cwd);

function installGlobal(tarball, expectedVersion) {
  checked(run(npmCommand, ['install', '--global', tarball]), `全局安装 ${expectedVersion}`);
}

function assertInstalledIdentity(expectedVersion) {
  const entry = commandLookup();
  const version = cli(entry, root, ['--version']).trim();
  if (!version.includes(expectedVersion)) {
    throw new Error(`全局 openlogos 版本不符：期望 ${expectedVersion}，实际 ${version}`);
  }
  return { entry, version };
}

/** 安装态包根：从 bin realpath 上溯到含 package.json 的目录。 */
function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

const AUTHORITY_IMPACT = tests => `## Authority Impact

\`\`\`yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [derived_projection]
  facts:
    - fact_id: core.smoke-plan-gate
      change: create
      authority_ref: spec/smoke-authority.md#registry
      authority_owner: SmokePlanGateEvaluator
      canonical_state: proposal authority impact
      sole_writer: approved delta merge
      mutation_entry: openlogos merge
      decision_api: AuthorityClosureEvaluator
      projections: [change-lint, next]
      freshness_proof: proposal content hash
      rebuild_rule: recompute from proposal
      recovery_source: proposal plus receipt
      retired_shadow_sources: [consumer-local-parser]
      forbidden_fallbacks: [mtime]
      cutover:
        old_writer_stop: local parsers removed
        new_writer_start: shared evaluator enabled
        rollback_boundary: before approved delta merge
        exit_evidence: all consumers deep equal
      tests: ${JSON.stringify(tests)}
  unresolved: []
\`\`\`
`;

const PROPOSAL = tests => `# 变更提案：smoke-plan-gate

> module: core

## 变更原因
安装态验证 plan 门死锁解除。

## 变更类型
代码级变更。

## 变更范围
- CLI evaluator。

## 部署影响
- 是否需要部署：否
- 部署原因：仅临时项目
- 影响环境：本地
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

${AUTHORITY_IMPACT(tests)}
## 决策澄清

\`\`\`yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data: {status: none, reason: 无数据影响}
  compatibility: {status: none, reason: 无兼容选择}
  security_privacy: {status: none, reason: 无安全隐私影响}
  public_release: {status: none, reason: 无公开发布}
  external_commitment: {status: none, reason: 无外部承诺}
decisions: []
unresolved: []
defaults: []
\`\`\`

## 变更概述
由唯一 evaluator 按阶段计算完成状态。
`;

const TASKS = '# 实现任务\n\n## [delta] 规格变更\n\n- [ ] [MODIFY] `deltas/test/core-S99-test-cases.md`：规划 `UT-S99-01`。\n\n## [code] 代码实现\n\n## [deploy] 部署任务\n\n- [ ] 无\n';

/** 构造一次性 launched 夹具项目 + 活跃提案；绝不手工写 PLAN_APPROVED。 */
function scaffold(entry, tests) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-172-'));
  cli(entry, base, ['init', 'gate-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const projectYaml = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(projectYaml, readFileSync(projectYaml, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, 'spec'), { recursive: true });
  writeFileSync(join(base, 'spec', 'smoke-authority.md'), '# registry\n');
  cli(entry, base, ['change', 'smoke-plan-gate']);
  const dir = join(base, 'logos', 'changes', 'smoke-plan-gate');
  writeFileSync(join(dir, 'proposal.md'), PROPOSAL(tests));
  writeFileSync(join(dir, 'tasks.md'), TASKS);
  return { base, dir };
}

const stepOf = (entry, base) => JSON.parse(cli(entry, base, ['next', '--format', 'json'])).data?.proposal_step ?? null;

/** 步骤 ②～⑦：死锁解除、gate 正常消费、负向不放行、spec 阶段强度不降。 */
function exercisePlanGate(entry) {
  const { base, dir } = scaffold(entry, ['UT-S99-01']);
  try {
    // ③ 未产出任何 test delta 时即可派生到 ready-to-delta（修复前为 writing）
    const stepBeforeApproval = stepOf(entry, base);
    if (stepBeforeApproval !== 'ready-to-delta') {
      throw new Error(`派生 proposal_step 期望 ready-to-delta，实际 ${stepBeforeApproval}`);
    }
    if (existsSync(join(dir, 'PLAN_APPROVED'))) throw new Error('派生前已存在 PLAN_APPROVED —— 夹具被污染');

    // ④ 经正常 gate 路径批准：marker 与审计行均由 CLI 写入，未手工创建
    cli(entry, base, ['next', '--auto', '--format', 'json']);
    if (!existsSync(join(dir, 'PLAN_APPROVED'))) throw new Error('plan-exit 未写入 PLAN_APPROVED');
    const auditPath = join(dir, 'GATE_AUDIT.jsonl');
    const audit = existsSync(auditPath) ? readFileSync(auditPath, 'utf8') : '';
    if (!audit.includes('GATE_AUTO_PASSED')) throw new Error('缺少 GATE_AUTO_PASSED 审计行');

    // ⑤ 批准后派生为 delta-writing，且 test delta 可正常产出（此前被 guard 拦下）
    const stepAfterApproval = stepOf(entry, base);
    if (stepAfterApproval !== 'delta-writing') {
      throw new Error(`批准后 proposal_step 期望 delta-writing，实际 ${stepAfterApproval}`);
    }
    const deltaPath = join(dir, 'deltas', 'test', 'core-S99-test-cases.md');
    mkdirSync(dirname(deltaPath), { recursive: true });
    writeFileSync(deltaPath, '## ADDED — S99 分阶段校验\n\n| ID | 描述 |\n|---|---|\n| UT-S99-01 | 分阶段校验 |\n');
    if (!existsSync(deltaPath)) throw new Error('test delta 未能写入');

    // ⑥ 负向：tests 为空数组与非法 ID，均须停在 writing 并点名 fact/字段
    const negatives = [];
    for (const tests of [[], ['not-a-test-id']]) {
      const neg = scaffold(entry, tests);
      try {
        const step = stepOf(entry, neg.base);
        if (step !== 'writing') throw new Error(`负向 tests=${JSON.stringify(tests)} 期望停在 writing，实际 ${step}`);
        const lint = cliRaw(entry, neg.base, ['change-lint', '--format', 'json']);
        const text = `${lint.stdout}${lint.stderr}`;
        if (!text.includes('authority_closure_incomplete')) {
          throw new Error(`负向 tests=${JSON.stringify(tests)} 未判 authority_closure_incomplete`);
        }
        if (!text.includes('core.smoke-plan-gate')) throw new Error('诊断未点名具体 fact');
        if (text.includes('脱模板')) throw new Error('诊断出现与实际原因不符的「脱模板」措辞');
        negatives.push({ tests, step, diagnosed: true });
      } finally {
        rmSync(neg.base, { recursive: true, force: true });
      }
    }

    // ⑦ 强度不降：引用不存在 ID 的提案，spec 阶段 change-lint 的 L10 仍 FAIL 并点名未命中 ID
    const strict = scaffold(entry, ['UT-S97-99']);
    let strictEvidence;
    try {
      const lint = cliRaw(entry, strict.base, ['change-lint', '--format', 'json']);
      const text = `${lint.stdout}${lint.stderr}`;
      if (lint.status === 0) throw new Error('change-lint 对不存在测试 ID 竟然通过 —— spec 阶段强度被削弱');
      if (!text.includes('authority_closure_incomplete')) throw new Error('L10 未判 authority_closure_incomplete');
      if (!text.includes('UT-S97-99')) throw new Error('诊断未点名未命中的具体 ID');
      strictEvidence = { exit_status: lint.status, named_missing_id: true };
    } finally {
      rmSync(strict.base, { recursive: true, force: true });
    }

    return {
      step_before_approval: stepBeforeApproval,
      plan_approved_by_cli: true,
      gate_auto_passed_audit: true,
      step_after_approval: stepAfterApproval,
      test_delta_written: true,
      negatives,
      spec_stage_still_strict: strictEvidence,
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** 步骤 ⑧：判据单点与发布 schema 枚举锚，判据对象是**安装态产物**而非 workspace。 */
function assertSinglePredicate(entry) {
  const pkg = packageRoot(entry);
  const libDir = join(pkg, 'dist', 'lib');
  if (!existsSync(libDir)) throw new Error(`安装态缺少 dist/lib：${libDir}`);

  // ① HISTORICAL_MARKERS 在随包 dist 中恰好 1 处定义
  const definitions = readdirSync(libDir)
    .filter(name => name.endsWith('.js') && statSync(join(libDir, name)).isFile())
    .filter(name => /(?:^|\s)(?:const|let|var)\s+HISTORICAL_MARKERS\s*=/m.test(readFileSync(join(libDir, name), 'utf8')));
  if (definitions.length !== 1) {
    throw new Error(`安装态 HISTORICAL_MARKERS 定义处数为 ${definitions.length}（期望 1）：${definitions.join('、')}`);
  }

  // ② 每份发布 schema 的 proposalStep 枚举与 REGISTERED_STEPS 逐项相等（sha256 冻结不计入锚）
  const { REGISTERED_STEPS } = createRequire(entry)(join(libDir, 'step-registry.js'));
  const registered = new Set(REGISTERED_STEPS);
  const anchors = {};
  for (const name of ['next.schema.json', 'status.schema.json']) {
    const schemaPath = join(pkg, 'spec', 'schema', name);
    if (!existsSync(schemaPath)) throw new Error(`安装态缺少发布 schema：${schemaPath}`);
    const declared = new Set(JSON.parse(readFileSync(schemaPath, 'utf8')).$defs.proposalStep.enum);
    const missing = [...registered].filter(step => !declared.has(step)).sort();
    const stale = [...declared].filter(step => !registered.has(step)).sort();
    if (missing.length > 0 || stale.length > 0) {
      throw new Error(`${name} 的 proposalStep 与注册表不一致：缺 ${missing.join('、') || '无'}；多 ${stale.join('、') || '无'}`);
    }
    anchors[name] = { enum_size: declared.size, missing: [], stale: [] };
  }
  return { historical_markers_definitions: definitions, registered_steps: REGISTERED_STEPS.length, schema_anchors: anchors };
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

await smoke('SMOKE-core-172', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_PLAN_GATE_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_PLAN_GATE_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②～⑧
  const planGate = exercisePlanGate(initial.entry);
  const singlePredicate = assertSinglePredicate(initial.entry);

  // ⑨ 0.14.7→0.14.8→0.14.7→0.14.8 往返，每阶段复核 identity，恢复后行为不变
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const planGateAfterRestore = exercisePlanGate(restored.entry);
  const singlePredicateAfterRestore = assertSinglePredicate(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    plan_gate: planGate,
    single_predicate: singlePredicate,
    plan_gate_after_restore: planGateAfterRestore,
    single_predicate_after_restore: singlePredicateAfterRestore,
  }];
});
