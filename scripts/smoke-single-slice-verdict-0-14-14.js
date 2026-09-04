#!/usr/bin/env node
/**
 * SMOKE-core-178 — 0.14.14 单切片计划经事务写出 [code] 且三分支守门如实（安装态）。
 *
 * 双红线：
 *   ③ 单切片 apply 必须达 completed——整体回滚并报「判为 unknown……0 条违规」即整体 FAIL，
 *      那正是被修复的缺陷（守门把「判定器不适用」读成失败）；
 *   ④ 业务非法 slot 必须仍被拦下——放宽越界（非法产物获得成功终态）同样整体 FAIL。
 *
 * 零回归对照（强制）：同一单切片断言在固定 0.14.13 上 apply 必须失败（缺陷本身）；
 * 若在 0.14.13 上也达 completed，说明断言空转，整体 FAIL、不得放行部署。
 *
 * 硬约束：全部关键断言穿过公开 `openlogos slice transaction` 命令；不得手工写 [code] 段或
 * manifest，不得删除或改名 TEST_SLICE_TRANSACTION.json 构造前提（删 manifest 属恢复夹具例外）。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const SINGLE_VERDICT_SMOKE_IDS = ['SMOKE-core-178'];
const EXPECTED_VERSION = '0.14.14';
const ROLLBACK_VERSION = '0.14.13';
const ENVIRONMENT = 'local-global-temp-project';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: SINGLE_VERDICT_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_SINGLE_VERDICT_TARBALL', 'OPENLOGOS_SINGLE_VERDICT_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

if (!process.env.DRYRUN_ENTRY) {
  requireEnvOrSkip(SINGLE_VERDICT_SMOKE_IDS, [
    ['OPENLOGOS_SINGLE_VERDICT_TARBALL', 'OPENLOGOS_TARBALL'],
    ['OPENLOGOS_SINGLE_VERDICT_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
  ], {
    reason: '单切片终态判定 smoke 需要 0.14.14 候选与 0.14.13 回滚制品',
    environment: 'single-slice-verdict',
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

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

const SPEC_REL = 'logos/resources/test/core-S01-test-cases.md';
const OTHER_DOC = 'logos/resources/prd/3-technical-plan/core-01-architecture.md';
const SPEC_BEFORE = '| ID | 描述 |\n|---|---|\n';
const SPEC_AFTER = '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n';
const SINGLE_CODE = '- [ ] 单切片：完整任务文本（覆盖 UT-S01-01、UT-S01-02）';
const SINGLE_SLICES = [
  { slice_id: 'slice-01-single', task_text: '单切片：完整任务文本（覆盖 UT-S01-01、UT-S01-02）', owned_test_ids: ['UT-S01-01', 'UT-S01-02'], runner_selectors: ['UT-S01-01', 'UT-S01-02'], spec_targets: [SPEC_REL] },
];
const DOUBLE_CODE = '- [ ] 切片1：第一片完整任务文本（覆盖 UT-S01-01）\n- [ ] 切片2：第二片完整任务文本（覆盖 UT-S01-02）';
const DOUBLE_VALID = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片完整任务文本（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [SPEC_REL] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片完整任务文本（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [SPEC_REL] },
];
const DOUBLE_INVALID = DOUBLE_VALID.map(s => ({ ...s, task_text: `${s.slice_id} 简称`, spec_targets: [OTHER_DOC] }));
const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', '- [ ] 实现代码变更', '',
  '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
].join('\n');

/** 一次性 launched 夹具项目；change set 由安装态 CLI 自己的构造器生成。 */
function scaffold(entry) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-178-'));
  cli(entry, base, ['init', 'verdict-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, 'logos', 'resources', 'test'), { recursive: true });
  mkdirSync(join(base, 'logos', 'resources', 'prd', '3-technical-plan'), { recursive: true });
  writeFileSync(join(base, SPEC_REL), SPEC_AFTER);
  writeFileSync(join(base, OTHER_DOC), '# 架构\n\n这不是测试规格文档。\n');
  cli(entry, base, ['change', 'verdict-demo']);
  const dir = join(base, 'logos', 'changes', 'verdict-demo');
  writeFileSync(join(dir, 'tasks.md'), TASKS);

  const req = createRequire(join(packageRoot(entry), 'package.json'));
  const { buildTestChangeSet } = req(join(packageRoot(entry), 'dist', 'lib', 'test-change-set.js'));
  writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
    type: 'merge_transaction_complete', transaction_id: 'mtx_smoke', seal_sha256: null,
    receipt_sha256: null, completed_at: new Date().toISOString(),
    test_change_set: buildTestChangeSet({
      change: 'verdict-demo', module: 'core',
      targets: [{ targetPath: SPEC_REL, beforeBytes: Buffer.from(SPEC_BEFORE, 'utf8'), afterBytes: Buffer.from(SPEC_AFTER, 'utf8') }],
    }),
  }));

  const write = (name, value) => {
    const p = join(base, name);
    writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
    return p;
  };
  return {
    base, dir,
    singleCode: write('code-single.txt', SINGLE_CODE),
    singleSlices: write('slices-single.json', SINGLE_SLICES),
    doubleCode: write('code-double.txt', DOUBLE_CODE),
    doubleValid: write('slices-double-valid.json', DOUBLE_VALID),
    doubleInvalid: write('slices-double-invalid.json', DOUBLE_INVALID),
    tasks: join(dir, 'tasks.md'),
    manifest: join(dir, 'TEST_SLICE_MANIFEST.json'),
    txFile: join(dir, 'TEST_SLICE_TRANSACTION.json'),
  };
}

const tx = (entry, base, ...args) => cliRaw(entry, base, ['slice', 'transaction', ...args]);

function chain(entry, fx, code, slices) {
  for (const step of [
    ['submit-content', '--slot', 'slot_codesection', '--file', code],
    ['submit-content', '--slot', 'slot_slices', '--file', slices],
    ['seal'],
  ]) {
    const r = tx(entry, fx.base, ...step);
    if (r.status !== 0) throw new Error(`${step[0]} 失败：${r.stdout}${r.stderr}`);
  }
  return tx(entry, fx.base, 'apply', '--format', 'json');
}

/** ②③④⑤ 行为断言；expectSingleSliceBlocked=true 表示在回滚版本上跑零回归对照。 */
function exercise(entry, { expectSingleSliceBlocked = false } = {}) {
  const scopes = [];
  const track = f => { scopes.push(f.base); return f; };
  try {
    // ②③ 单切片全链
    const a = track(scaffold(entry));
    const appliedA = chain(entry, a, a.singleCode, a.singleSlices);
    if (expectSingleSliceBlocked) {
      if (appliedA.status === 0) {
        throw new Error(`【断言空转】单切片 apply 在 ${ROLLBACK_VERSION} 上竟成功——必须重写用例而非放行部署`);
      }
      const text = `${appliedA.stdout}${appliedA.stderr}`;
      if (!text.includes('unknown') || !text.includes('0 条违规')) {
        throw new Error(`回滚版失败形态与缺陷特征不符：${text.slice(0, 300)}`);
      }
      return { single_slice_blocked_as_expected: true };
    }
    if (appliedA.status !== 0) {
      throw new Error(`【单切片仍被误拒】apply 失败：${appliedA.stdout}${appliedA.stderr}`.slice(0, 500));
    }
    const errText = `${appliedA.stdout}${appliedA.stderr}`;
    const statusA = JSON.parse(tx(entry, a.base, 'status', '--format', 'json').stdout);
    const phaseA = statusA.data?.phase ?? statusA.data?.transaction?.phase;
    if (phaseA !== 'completed') throw new Error(`单切片 apply 后 phase=${phaseA}，应为 completed`);
    if (!readFileSync(a.tasks, 'utf8').includes('单切片：完整任务文本')) throw new Error('[code] 段未正确写出');
    if (!existsSync(a.manifest)) throw new Error('惰性 manifest 未落盘');
    if (errText.includes('unknown')) throw new Error('单切片路径输出不得出现 unknown');

    // ⑤（修正语义）多切片终态不堵恢复回归：completed 后删 manifest（保留事务文件）→ 恢复事务可达
    const b = track(scaffold(entry));
    const appliedB = chain(entry, b, b.doubleCode, b.doubleValid);
    if (appliedB.status !== 0) throw new Error(`多切片健康全链失败：${appliedB.stdout}${appliedB.stderr}`);
    const frozen = readFileSync(b.tasks, 'utf8');
    rmSync(b.manifest, { force: true });
    if (!existsSync(b.txFile)) throw new Error('恢复夹具不得触碰事务文件');
    const nextOut = cliRaw(entry, b.base, ['next', '--format', 'json']);
    const projected = JSON.parse(nextOut.stdout).data.modules[0].slice_transaction;
    if (!projected || projected.origin !== 'manifest-recovery') {
      throw new Error(`多切片恢复入口回归失败：origin=${projected?.origin ?? '<无投影>'}`);
    }
    if (projected.content_slots.required !== 1) throw new Error(`恢复事务 slot 未收窄：${projected.content_slots.required}`);
    for (const step of [['submit-content', '--slot', 'slot_slices', '--file', b.doubleValid], ['seal'], ['apply']]) {
      const r = tx(entry, b.base, ...step);
      if (r.status !== 0) throw new Error(`恢复 ${step[0]} 失败：${r.stdout}${r.stderr}`);
    }
    if (readFileSync(b.tasks, 'utf8') !== frozen) throw new Error('恢复后 [code] 段未保持字节恒等');

    // ④ 业务非法 slot 仍被拦下（放宽不得越界）
    const c = track(scaffold(entry));
    const appliedC = chain(entry, c, c.doubleCode, c.doubleInvalid);
    if (appliedC.status === 0) {
      throw new Error('【放宽越界】业务非法 slot 的 apply 竟成功——0.14.12 自校验被削弱');
    }
    const envelope = JSON.parse(appliedC.stderr.trim());
    const violations = envelope?.error?.details?.violations ?? [];
    if (violations.length === 0) throw new Error('失败终态未伴随非零 violations');
    for (const v of violations) {
      for (const key of ['code', 'path', 'message', 'fix_hint']) {
        if (!(key in v)) throw new Error(`violation 缺少 ${key}，未保真`);
      }
    }
    if (String(envelope?.error?.message ?? '').includes('unknown')) {
      throw new Error('失败文案不得渲染 unknown');
    }
    if (existsSync(c.manifest)) throw new Error('【半写态】业务非法回滚后 manifest 仍存在');

    return {
      single_slice_completed: true,
      code_section_written: true,
      lazy_manifest_present: true,
      multi_slice_recovery_regression_ok: true,
      invalid_slot_still_rejected: true,
      violations_preserved: violations.length,
      no_unknown_in_messages: true,
    };
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

await smoke('SMOKE-core-178', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_SINGLE_VERDICT_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_SINGLE_VERDICT_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②③④⑤
  const behaviour = exercise(initial.entry);

  // ⑥ 0.14.13→0.14.14 往返 + 零回归对照：单切片断言在 0.14.13 上必须失败
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  const counter = exercise(rolledBack.entry, { expectSingleSliceBlocked: true });
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const behaviourAfterRestore = exercise(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    behaviour, zero_regression_counter: counter, behaviour_after_restore: behaviourAfterRestore,
  }];
});
