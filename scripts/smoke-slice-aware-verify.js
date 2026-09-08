#!/usr/bin/env node
/**
 * SMOKE-core-62..66 — make-verify-slice-aware 本地全局安装冒烟。
 *
 * 默认验证已部署的全局 openlogos。开发期可用 OPENLOGOS_BIN 显式指向待测 CLI；
 * 回滚演练始终安装到临时 prefix，不改写当前全局环境。
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { recordSmokeNotApplicable } from './lib/smoke-not-applicable.mjs';

const repoRoot = process.cwd();
const expectedVersion = JSON.parse(readFileSync(join(repoRoot, 'cli/package.json'), 'utf8')).version;
const resultPath = resolve(
  repoRoot,
  process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl',
);

function writeSmoke(id, status, startedAt, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const row = {
    id,
    status,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    scenario: '切片感知 verify 本地全局安装冒烟',
  };
  if (error) row.error = String(error instanceof Error ? error.message : error).slice(0, 2000);
  appendFileSync(resultPath, `${JSON.stringify(row)}\n`);
}

function run(command, args, cwd = repoRoot, env = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function assertOk(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label} 失败：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
}

function npmValue(args) {
  const result = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args);
  assertOk(result, `npm ${args.join(' ')}`);
  return result.stdout.trim();
}

function cliInvocation() {
  if (process.env.OPENLOGOS_BIN) {
    return { command: process.execPath, baseArgs: [resolve(process.env.OPENLOGOS_BIN)] };
  }
  return { command: 'openlogos', baseArgs: [] };
}

function runCli(root, args) {
  const cli = cliInvocation();
  const env = { ...process.env };
  delete env.OPENLOGOS_SMOKE_RESULT_PATH;
  return spawnSync(cli.command, [...cli.baseArgs, ...args], { cwd: root, encoding: 'utf8', env });
}

function envelope(result, label, expectedStatus = 0) {
  if (result.status !== expectedStatus) {
    throw new Error(`${label} exit=${result.status}，期望 ${expectedStatus}：${result.stderr}`);
  }
  const raw = (expectedStatus === 0 ? result.stdout : `${result.stdout}\n${result.stderr}`)
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const line of raw.reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.command) return parsed;
    } catch { /* 继续查找 envelope */ }
  }
  throw new Error(`${label} 未返回 JSON envelope`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function prefixedHash(bytes) {
  return `sha256:${sha256(bytes)}`;
}

function taskLines(checked = []) {
  return [
    '# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '', '## [code] 代码实现',
    ...Array.from({ length: 5 }, (_, index) => `- [${checked[index] ? 'x' : ' '}] 切片 ${index + 1}：smoke 能力 ${index + 1}（覆盖 UT-S90-0${index + 1}）`),
    '',
  ].join('\n');
}

function taskFingerprint() {
  const model = Array.from({ length: 5 }, (_, index) => ({
    task_text: `切片 ${index + 1}：smoke 能力 ${index + 1}（覆盖 UT-S90-0${index + 1}）`,
    children: [],
  }));
  return prefixedHash(Buffer.from(JSON.stringify(model), 'utf8'));
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-slice-smoke-'));
  const slug = 'slice-smoke';
  const proposalDir = join(root, 'logos', 'changes', slug);
  const specTarget = 'logos/resources/test/core-S90-test-cases.md';
  const ids = Array.from({ length: 5 }, (_, index) => [`UT-S90-0${index + 1}`]);
  mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
  mkdirSync(join(root, 'logos', 'resources', 'verify'), { recursive: true });
  mkdirSync(join(proposalDir, 'deltas', 'test'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({
    name: 'slice-smoke', locale: 'zh',
    verify: { result_path: 'logos/resources/verify/test-results.jsonl', sandbox_mode: 'auto' },
    smoke: { result_path: 'logos/resources/verify/smoke-results.jsonl' },
  }, null, 2));
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:', '  name: slice-smoke', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched',
  ].join('\n'));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  writeFileSync(join(proposalDir, 'proposal.md'), [
    '# 变更提案：slice-smoke', '', '## 变更原因', '回归切片 verify。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：smoke fixture',
    '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '隔离回归。', '', '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1',
    'mode: adaptive', 'status: complete', 'impacts:', '  data: { status: none, reason: 无 }',
    '  compatibility: { status: none, reason: 无 }', '  security_privacy: { status: none, reason: 无 }',
    '  public_release: { status: none, reason: 无 }', '  external_commitment: { status: none, reason: 无 }',
    'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
  ].join('\n'));
  writeFileSync(join(proposalDir, 'tasks.md'), taskLines());
  writeFileSync(join(proposalDir, 'SLICES_APPROVED'), '');
  const table = ['| ID | 用例 |', '|---|---|', ...ids.flat().map(id => `| ${id} | ${id} |`)].join('\n');
  writeFileSync(join(root, specTarget), table);
  const changeSetPayload = {
    schema: 'openlogos/test-change-set@1', change: slug, module: 'core',
    source: 'semantic-before-after-diff', changed_test_ids: ids.flat().sort(), removed_test_ids: [],
    targets: [{ target_path: specTarget, before_sha256: null, after_sha256: sha256(Buffer.from(table)) }],
  };
  const testChangeSet = { ...changeSetPayload, sha256: prefixedHash(Buffer.from(JSON.stringify(changeSetPayload), 'utf8')) };
  writeFileSync(join(proposalDir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'baseline_closure_spec_complete', test_change_set: testChangeSet,
  }, null, 2)}\n`);
  writeFileSync(join(proposalDir, 'deltas', 'test', 'core-S90-test-cases.md'), table);
  const specFingerprint = prefixedHash(Buffer.from(`${specTarget}\0${table}\0`, 'utf8'));
  const manifest = {
    schema: 'openlogos/test-slice-manifest@1', change: slug, module: 'core',
    task_fingerprint: taskFingerprint(), spec_fingerprint: specFingerprint,
    generated_at: '2026-08-16T00:00:00.000Z',
    slices: ids.map((owned, index) => ({
      slice_id: `slice-0${index + 1}`,
      task_text: `切片 ${index + 1}：smoke 能力 ${index + 1}（覆盖 UT-S90-0${index + 1}）`,
      owned_test_ids: owned,
      runner_selectors: owned,
      spec_targets: [specTarget],
    })),
  };
  const manifestPath = join(proposalDir, 'TEST_SLICE_MANIFEST.json');
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, manifestBytes);
  return { root, proposalDir, ids, manifestPath, manifestBytes, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writeResults(f, ids, failId = null) {
  writeFileSync(join(f.root, 'logos', 'resources', 'verify', 'test-results.jsonl'),
    `${ids.map(id => JSON.stringify({ id, status: id === failId ? 'fail' : 'pass', ...(id === failId ? { error: 'smoke failure' } : {}) })).join('\n')}\n`);
}

function runVerify(f, expectedStatus = 0) {
  return envelope(runCli(f.root, ['verify', '--format', 'json']), 'openlogos verify', expectedStatus).data;
}

function smoke62() {
  const version = runCli(repoRoot, ['--version']);
  assertOk(version, 'openlogos --version');
  if (version.stdout.trim() !== expectedVersion) throw new Error(`CLI 版本=${version.stdout.trim()}，期望 ${expectedVersion}`);
  const localPackage = JSON.parse(readFileSync(join(repoRoot, 'cli', 'package.json'), 'utf8'));
  const claudePlugin = JSON.parse(readFileSync(join(repoRoot, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
  const codexPlugin = JSON.parse(readFileSync(join(repoRoot, 'plugin-codex', 'plugin.json'), 'utf8'));
  for (const [name, value] of [['cli', localPackage.version], ['claude plugin', claudePlugin.version], ['codex plugin', codexPlugin.version]]) {
    if (value !== expectedVersion) throw new Error(`${name} 版本=${value}，期望 ${expectedVersion}`);
  }
  let packageRoot = repoRoot;
  if (!process.env.OPENLOGOS_BIN) {
    const prefix = realpathSync(npmValue(['prefix', '-g']));
    const lookup = run(process.platform === 'win32' ? 'where' : 'which', ['openlogos']);
    assertOk(lookup, '解析全局 openlogos');
    const commandPath = realpathSync(lookup.stdout.trim().split(/\r?\n/)[0]);
    const rel = relative(prefix, commandPath);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`命令 ${commandPath} 不在 npm prefix ${prefix}`);
    packageRoot = join(npmValue(['root', '-g']), '@miniidealab', 'openlogos');
  }
  for (const asset of [
    'skills/slice-planner/SKILL.md', 'spec/test-slice-manifest.md',
    'spec/schema/status.schema.json', 'spec/schema/next.schema.json', 'spec/schema/verify.schema.json',
  ]) if (!existsSync(join(packageRoot, asset))) throw new Error(`安装包缺少 ${asset}`);
  const verifySchema = JSON.parse(readFileSync(join(packageRoot, 'spec', 'schema', 'verify.schema.json'), 'utf8'));
  if (verifySchema['x-contract-version'] !== '1.1.0') throw new Error('verify schema 不是 1.1.0');
}

function smoke63() {
  const f = fixture();
  try {
    for (let index = 0; index < 5; index += 1) {
      writeResults(f, f.ids.slice(0, index + 1).flat());
      const data = runVerify(f);
      if (data.verify_mode !== 'slice-checkpoint' || data.attempted_slice_id !== `slice-0${index + 1}`) {
        throw new Error(`第 ${index + 1} 片状态错误：${JSON.stringify(data)}`);
      }
      if (existsSync(join(f.proposalDir, 'VERIFY_PASS'))) throw new Error('checkpoint 提前写入 VERIFY_PASS');
    }
    writeFileSync(join(f.proposalDir, 'tasks.md'), taskLines([true, true, true, true, true]));
    writeResults(f, f.ids.flat());
    const final = runVerify(f);
    if (final.verify_mode !== 'final' || final.pending_test_ids.length !== 0 || final.gate.result !== 'PASS') {
      throw new Error(`final 状态错误：${JSON.stringify(final)}`);
    }
    if (!existsSync(join(f.proposalDir, 'VERIFY_PASS'))) throw new Error('final PASS 未写 marker');
  } finally { f.cleanup(); }
}

function smoke64() {
  const f = fixture();
  try {
    writeResults(f, f.ids[0]); runVerify(f);
    writeFileSync(join(f.proposalDir, 'tasks.md'), taskLines([true, true, false, false, false]));
    const eligible = [...f.ids[0], ...f.ids[1]];
    writeResults(f, eligible, f.ids[1][0]);
    const one = runVerify(f, 1); const two = runVerify(f, 1);
    if (one.attempted_slice_id !== 'slice-02' || two.attempted_slice_id !== 'slice-02') throw new Error('跨进程失败发生串片');
    const loops = readFileSync(join(f.proposalDir, 'LOOP_ITERS'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    if (loops.length !== 2 || loops.some(row => row.attempted_slice_id !== 'slice-02')) throw new Error('repair iteration 归属错误');
    writeResults(f, eligible); runVerify(f);
    const nextData = envelope(runCli(f.root, ['next', '--format', 'json']), 'openlogos next').data;
    if (nextData.modules[0].slice_verification_state.attempted_slice_id !== 'slice-03') throw new Error('修复 PASS 后未前移第三片');
  } finally { f.cleanup(); }
}

function smoke65() {
  const f = fixture();
  try {
    writeResults(f, f.ids[0]); runVerify(f);
    const taskBytes = readFileSync(join(f.proposalDir, 'tasks.md'), 'utf8');
    const checkpointBytes = readFileSync(join(f.proposalDir, 'SLICE_CHECKPOINTS.jsonl'), 'utf8');
    unlinkSync(f.manifestPath);
    const missing = envelope(runCli(f.root, ['next', '--format', 'json']), 'openlogos next').data;
    const mod = missing.modules[0];
    if (mod.reason !== 'test-slice-manifest-missing' || mod.next_node?.id !== 'plan-slices' || mod.next_node?.dispatch?.idempotent !== true) {
      throw new Error(`恢复合同错误：${JSON.stringify(mod)}`);
    }
    if (existsSync(join(f.proposalDir, 'VERIFY_FAIL')) || existsSync(join(f.proposalDir, 'LOOP_ITERS'))) throw new Error('恢复态产生 Gate/loop 副作用');
    writeFileSync(f.manifestPath, f.manifestBytes);
    const recovered = envelope(runCli(f.root, ['next', '--format', 'json']), '恢复后 next').data.modules[0];
    if (recovered.slice_verification_state.attempted_slice_id !== 'slice-02') throw new Error('恢复后未续跑原 attempted slice');
    if (readFileSync(join(f.proposalDir, 'tasks.md'), 'utf8') !== taskBytes
      || readFileSync(join(f.proposalDir, 'SLICE_CHECKPOINTS.jsonl'), 'utf8') !== checkpointBytes) throw new Error('恢复改写了任务或 checkpoint');
  } finally { f.cleanup(); }
}

/** 制品缺失属「环境不具备」而非失败：返回 null 让调用方留痕 skip（功能规格 §2.48.4） */
function findRollbackTarballOrNull() {
  const explicit = process.env.OPENLOGOS_ROLLBACK_TARBALL;
  const candidate = explicit ? resolve(explicit) : join(repoRoot, 'miniidealab-openlogos-0.13.25.tgz');
  if (!existsSync(candidate)) return null;
  return candidate;
}

function findRollbackTarball() {
  const explicit = process.env.OPENLOGOS_ROLLBACK_TARBALL;
  const candidate = explicit ? resolve(explicit) : join(repoRoot, 'miniidealab-openlogos-0.13.25.tgz');
  if (!existsSync(candidate)) throw new Error(`缺少 0.13.25 回滚 tarball：${candidate}`);
  const bytes = readFileSync(candidate);
  const actual = sha256(bytes);
  if (process.env.OPENLOGOS_ROLLBACK_SHA256 && actual !== process.env.OPENLOGOS_ROLLBACK_SHA256.replace(/^sha256:/, '')) {
    throw new Error(`回滚 tarball 哈希不匹配：${actual}`);
  }
  return candidate;
}

/** 不适用哨兵：由驱动循环唯一落一条 skip 记录 */
const NOT_APPLICABLE = Symbol('not-applicable');

function smoke66() {
  const f = fixture();
  try {
    for (let index = 0; index < 5; index += 1) {
      writeResults(f, f.ids.slice(0, index + 1).flat()); runVerify(f);
    }
    writeFileSync(join(f.proposalDir, 'tasks.md'), taskLines([true, true, true, true, true]));
    writeResults(f, f.ids.flat().slice(0, -1));
    const negative = runVerify(f, 1);
    if (negative.gate.result !== 'FAIL' || negative.pending_test_ids.length !== 0
      || !negative.uncovered_cases.includes(f.ids.at(-1)[0])) throw new Error('final 负例未硬失败');
    writeResults(f, f.ids.flat());
    if (runVerify(f).gate.result !== 'PASS') throw new Error('补齐 final 后未 PASS');
  } finally { f.cleanup(); }

  // 0.13.25 是从未发布的本地候选版本；本机没有该制品时属环境不具备，
  // 必须写显式 skip 而不是 fail——真实失败与不适用不得混用（功能规格 §2.48.4）。
  const rollbackCandidate = findRollbackTarballOrNull();
  if (!rollbackCandidate) {
    // 返回哨兵而不是自行落记录：驱动循环见函数正常返回即写 pass，
    // 若在此直接写 skip 会被随后的 pass 覆盖，形成「断言没跑却记成通过」的假通过。
    return NOT_APPLICABLE;
  }
  const rollback = findRollbackTarball();
  const prefix = mkdtempSync(join(tmpdir(), 'openlogos-rollback-prefix-'));
  try {
    const install = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', prefix, rollback], repoRoot);
    assertOk(install, '隔离 prefix 安装 0.13.25 回滚包');
    const bin = join(prefix, 'node_modules', '.bin', process.platform === 'win32' ? 'openlogos.cmd' : 'openlogos');
    const restored = run(bin, ['--version'], prefix);
    assertOk(restored, '隔离回滚命令版本检查');
    if (restored.stdout.trim() !== '0.13.25') throw new Error(`回滚包版本=${restored.stdout.trim()}，期望 0.13.25`);
  } finally { rmSync(prefix, { recursive: true, force: true }); }
}

const cases = [
  ['SMOKE-core-62', smoke62], ['SMOKE-core-63', smoke63], ['SMOKE-core-64', smoke64],
  ['SMOKE-core-65', smoke65], ['SMOKE-core-66', smoke66],
];

// §13 保险条款：本次发布打包但不全局安装，全局仍为上一版本。本 runner 的验收对象是
// 已全局安装的候选，环境不具备——为每个 owned ID 留痕 skip，禁止零记录退出。
if (!process.env.OPENLOGOS_BIN) {
  const probe = runCli(repoRoot, ['--version']);
  const installed = probe.status === 0 ? `${probe.stdout}`.trim() : null;
  if (installed !== expectedVersion) {
    recordSmokeNotApplicable(cases.map(([id]) => id), {
      reason: `已安装 ${installed ?? '(缺失)'} ≠ 候选 ${expectedVersion}——本次按 §13 保险条款打包但不全局安装`,
      missing: ['globally-installed-candidate'],
      environment: 'packaged-not-installed',
    });
    console.log('− 全部用例（环境不具备：候选未全局安装，已记 skip）');
    process.exit(0);
  }
}

let failed = false;
for (const [id, check] of cases) {
  const startedAt = Date.now();
  try {
    const outcome = check();
    if (outcome === NOT_APPLICABLE) {
      recordSmokeNotApplicable([id], {
        reason: '缺少 0.13.25 回滚 tarball（该版本从未发布到 registry，本机无留存）',
        missing: ['OPENLOGOS_ROLLBACK_TARBALL'],
        environment: 'slice-aware-verify-rollback',
        repoRoot,
      });
      console.log(`− ${id}（环境不具备，已记 skip）`);
      continue;
    }
    writeSmoke(id, 'pass', startedAt);
    console.log(`✓ ${id}`);
  } catch (error) {
    failed = true;
    writeSmoke(id, 'fail', startedAt, error);
    console.error(`✗ ${id}: ${error instanceof Error ? error.message : error}`);
  }
}

process.exit(failed ? 1 : 0);
