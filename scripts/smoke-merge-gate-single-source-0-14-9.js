#!/usr/bin/env node
/**
 * SMOKE-core-173 — 0.14.9 merge 准入单点化与误伤边界（安装态）。
 *
 * 只接受冻结本地 tarball；全部断言在一次性临时项目中构造，
 * **不触碰本仓或用户其它项目的活跃提案、guard 与 marker**，**不手工创建任何 marker**。
 * 不包含公开发布、远程仓库或官网写操作。
 *
 * 步骤 ② 是红线：合法提案被拦下意味着收紧造成了误伤，失败即整体 FAIL，
 * 不得以「其余步骤都过」为由记 pass。
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

export const MERGE_GATE_SINGLE_SOURCE_SMOKE_IDS = ['SMOKE-core-173'];
const EXPECTED_VERSION = '0.14.9';
const ROLLBACK_VERSION = '0.14.8';
const ENVIRONMENT = 'local-global-temp-project';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: MERGE_GATE_SINGLE_SOURCE_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_MERGE_GATE_TARBALL', 'OPENLOGOS_MERGE_GATE_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

requireEnvOrSkip(MERGE_GATE_SINGLE_SOURCE_SMOKE_IDS, [
  ['OPENLOGOS_MERGE_GATE_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_MERGE_GATE_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: 'merge 准入单点化 smoke 需要 0.14.9 候选与 0.14.8 回滚制品',
  environment: 'merge-gate-single-source',
});

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const run = (command, args, cwd = root, env = process.env) =>
  spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 600_000 });

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
const cliRaw = (entry, cwd, args) => run(cliBin(entry), cliArgs(entry, args), cwd);

const installGlobal = (tarball, v) => checked(run(npmCommand, ['install', '--global', tarball]), `全局安装 ${v}`);

function assertInstalledIdentity(expectedVersion) {
  const entry = commandLookup();
  const version = cli(entry, root, ['--version']).trim();
  if (!version.includes(expectedVersion)) {
    throw new Error(`全局 openlogos 版本不符：期望 ${expectedVersion}，实际 ${version}`);
  }
  return { entry, version };
}

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

const AUTHORITY = (tests, ref) => `## Authority Impact

\`\`\`yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [derived_projection]
  facts:
    - fact_id: core.smoke-merge-gate
      change: create
      authority_ref: ${ref}
      authority_owner: SmokeMergeGateEvaluator
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

/** 四反引号示意块——裸正则会把块内的 yaml 误算为真实声明。 */
const NESTED_SAMPLE = [
  '## 说明', '', '````markdown', '下面是示意，不是真实声明：', '',
  '```yaml', 'authority_impact:', '  schema: openlogos/authority-impact@1',
  '  applicability: not_applicable', '  evidence: [示意]', '```', '````', '',
].join('\n');

const PROPOSAL = ({ tests = ['UT-S99-01'], ref = 'spec/smoke-authority.md#registry', nested = '' } = {}) => `# 变更提案：smoke-merge-gate

> module: core

## 变更原因
安装态验证 merge 准入单点化。

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

## UI/UX 变更声明

\`\`\`yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
\`\`\`

${nested}${AUTHORITY(tests, ref)}
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
安装态夹具。
`;

const TASKS = '# 实现任务\n\n## [delta] 规格变更\n\n- [ ] 规划 `deltas/test/core-S99-test-cases.md` 中的 `UT-S99-01`。\n\n## [code] 代码实现\n';
const TEST_DELTA = '## ADDED — S99 安装态夹具\n\n| ID | 描述 |\n|---|---|\n| UT-S99-01 | 安装态夹具 |\n';

/** 构造一次性 launched 夹具项目 + 活跃提案；绝不手工写 marker。 */
function scaffold(entry, options = {}) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-173-'));
  cli(entry, base, ['init', 'gate-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const projectYaml = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(projectYaml, readFileSync(projectYaml, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, 'spec'), { recursive: true });
  writeFileSync(join(base, 'spec', 'smoke-authority.md'), '# registry\n');
  cli(entry, base, ['change', 'smoke-merge-gate']);
  const dir = join(base, 'logos', 'changes', 'smoke-merge-gate');
  writeFileSync(join(dir, 'proposal.md'), PROPOSAL(options));
  writeFileSync(join(dir, 'tasks.md'), TASKS);
  if (options.withDelta !== false) {
    mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'test', 'core-S99-test-cases.md'), TEST_DELTA);
  }
  return { base, dir };
}

const stepOf = (entry, base) => JSON.parse(cli(entry, base, ['next', '--format', 'json'])).data?.proposal_step ?? null;
const lintOf = (entry, base) => cliRaw(entry, base, ['change-lint', '--format', 'json']);
const mergeOf = (entry, base) => cliRaw(entry, base, ['merge', 'smoke-merge-gate']);

/** 步骤 ②～⑥、⑧：误伤边界、准入同源、无信号仍预检、阻断可归因、围栏单点、门禁可满足性。 */
function exerciseMergeGate(entry) {
  const scopes = [];
  const track = f => { scopes.push(f.base); return f; };
  try {
    // ② 合法提案不被误拦 —— 红线
    const ok = track(scaffold(entry));
    cli(entry, ok.base, ['next', '--auto', '--format', 'json']);   // 经正常 gate 路径批准
    const okLint = lintOf(entry, ok.base);
    if (okLint.status !== 0) throw new Error(`合法提案 change-lint 竟失败：${okLint.stdout}${okLint.stderr}`);
    const okMerge = mergeOf(entry, ok.base);
    if (okMerge.status !== 0) {
      throw new Error(`【误伤】合法提案 merge 被拦下：${okMerge.stdout}${okMerge.stderr}`);
    }
    if (!existsSync(join(ok.dir, 'MERGE_TRANSACTION.json'))) throw new Error('合法提案 merge 未生成事务');

    // ③④⑤ 不合规提案：无 baseline_closure 信号也经预检、拒绝、逐条可归因
    const bad = track(scaffold(entry, { tests: ['UT-S97-99'] }));
    if (/baseline_closure/.test(readFileSync(join(bad.dir, 'proposal.md'), 'utf8'))) {
      throw new Error('夹具意外含 baseline_closure 声明，测不到「无信号也经预检」');
    }
    const badLint = lintOf(entry, bad.base);
    if (badLint.status === 0) throw new Error('不合规提案 change-lint 竟通过');
    const badMerge = mergeOf(entry, bad.base);
    if (badMerge.status === 0) throw new Error('不合规提案 merge 竟放行 —— 准入未收紧');
    const badText = `${badMerge.stdout}${badMerge.stderr}`;
    if (!badText.includes('authority_closure_incomplete')) throw new Error('merge 未判 authority_closure_incomplete');
    if (!badText.includes('UT-S97-99')) throw new Error('诊断未点名未命中的具体 ID');
    if (!badText.includes('修复：')) throw new Error('诊断缺逐条 fix_hint');
    if (!badText.includes('openlogos change-lint')) throw new Error('诊断未给出可复现的自查命令');
    if (badText.includes('L1-L9 未全过')) throw new Error('诊断退化为聚合结论');
    if (existsSync(join(bad.dir, 'SPEC_MERGED')) || existsSync(join(bad.dir, 'MERGE_PROMPT.md'))) {
      throw new Error('拒绝路径仍产生了写入');
    }

    // ⑥ 围栏单点：含四反引号示意块的提案不被误判
    const nested = track(scaffold(entry, { nested: NESTED_SAMPLE }));
    const nestedStep = stepOf(entry, nested.base);
    if (nestedStep !== 'ready-to-delta' && nestedStep !== 'delta-writing') {
      throw new Error(`嵌套示意块导致派生异常：${nestedStep}`);
    }

    // ⑧ 门禁可满足性：plan 阶段的合法最小提案（不含任何 delta）须可达 ready-to-delta
    const minimal = track(scaffold(entry, { withDelta: false }));
    const minimalStep = stepOf(entry, minimal.base);
    if (minimalStep !== 'ready-to-delta') {
      throw new Error(`plan 阶段合法最小提案未达 ready-to-delta：${minimalStep}`);
    }

    return {
      legit_merge_not_blocked: true,
      merge_transaction_created: true,
      lint_merge_consistent: { lint_exit: badLint.status, merge_exit: badMerge.status },
      unsignaled_proposal_prechecked: true,
      diagnostics_attributable: true,
      nested_fence_step: nestedStep,
      plan_minimal_step: minimalStep,
    };
  } finally {
    for (const base of scopes) rmSync(base, { recursive: true, force: true });
  }
}

/** 步骤 ⑦：测试 ID 语法单点与随包规格的一致性，判据对象是**安装态产物**。 */
function assertTestIdSingleSource(entry) {
  const pkg = packageRoot(entry);
  const libDir = join(pkg, 'dist', 'lib');
  if (!existsSync(libDir)) throw new Error(`安装态缺少 dist/lib：${libDir}`);
  const literal = /(?:new RegExp\([^)]*\(\?:UT\|ST|= *\/[^/]*\(\?:UT\|ST)/;
  const offenders = readdirSync(libDir)
    .filter(name => name.endsWith('.js') && statSync(join(libDir, name)).isFile() && name !== 'test-id.js')
    .filter(name => literal.test(readFileSync(join(libDir, name), 'utf8')));
  if (offenders.length > 0) throw new Error(`安装态仍有自列测试 ID 正则：${offenders.join('、')}`);

  const { isTestId } = createRequire(entry)(join(libDir, 'test-id.js'));

  // 注意：测试规格（logos/resources/test/**）不随包分发，安装态无从遍历真实语料——
  // 「已合并规格中每个表格首列 ID 都被接纳」由源码侧 UT-S35-131 覆盖（2127 条）。
  // 此处改为对**代表性 ID 形态**逐一判定，其中 JSON 系正是放宽前被丢弃的那一类；
  // 若退回严格语法，accepted 断言立刻失败，而不是像遍历空目录那样恒真。
  const mustAccept = ['UT-S16-01', 'ST-S35-24', 'SMOKE-core-173', 'UT-JSON-09', 'ST-JSON-21', 'UT-S09-110a-neg'];
  const mustReject = ['not-a-test-id', 'UT', 'XX-S01-01', ''];
  const wronglyRejected = mustAccept.filter(id => !isTestId(id));
  if (wronglyRejected.length > 0) throw new Error(`权威语法拒绝了应接纳的 ID：${wronglyRejected.join('、')}`);
  const wronglyAccepted = mustReject.filter(id => isTestId(id));
  if (wronglyAccepted.length > 0) throw new Error(`权威语法接纳了应拒绝的字符串：${wronglyAccepted.join('、')}`);

  return {
    self_declared_regexes: 0,
    grammar_accepted: mustAccept,
    grammar_rejected: mustReject,
    corpus_check_note: '全量语料一致性由源码侧 UT-S35-131 覆盖；测试规格不随包分发',
  };
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

await smoke('SMOKE-core-173', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_MERGE_GATE_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_MERGE_GATE_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②～⑧
  const gate = exerciseMergeGate(initial.entry);
  const testId = assertTestIdSingleSource(initial.entry);

  // ⑨ 0.14.8→0.14.9→0.14.8→0.14.9 往返，每阶段复核 identity，恢复后行为不变
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const gateAfterRestore = exerciseMergeGate(restored.entry);
  const testIdAfterRestore = assertTestIdSingleSource(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    merge_gate: gate, test_id_single_source: testId,
    merge_gate_after_restore: gateAfterRestore, test_id_single_source_after_restore: testIdAfterRestore,
  }];
});
