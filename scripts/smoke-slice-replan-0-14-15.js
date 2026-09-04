#!/usr/bin/env node
/**
 * SMOKE-core-179 — 0.14.15 已完成规划经受控重开完成重划（安装态）。
 *
 * 双红线：
 *   ③ reopen 必须成功进入 collecting 且留痕/归档齐备——被拒即缺口未修；
 *   ④ 新划分必须整体替换（[code] 与 manifest 无旧残留）——半新半旧比无法重划更坏。
 *
 * 零回归对照（强制）：同一 reopen 步骤在固定 0.14.14 上必须被拒（动作不可用），
 * 且 completed 后 submit-content/abort 被拒的锁死现场复现；若也能重开则断言空转、整体 FAIL。
 *
 * 硬约束：全部关键断言穿过公开 `openlogos slice transaction` 命令；不得手工创建任何
 * marker（含 SLICES_APPROVED——已批准分支归 UT-S32-65）、不得手工写 [code]/manifest、
 * 不得删除或改名 TEST_SLICE_TRANSACTION.json。
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

export const SLICE_REPLAN_SMOKE_IDS = ['SMOKE-core-179'];
const EXPECTED_VERSION = '0.14.15';
const ROLLBACK_VERSION = '0.14.14';
const ENVIRONMENT = 'local-global-temp-project';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: SLICE_REPLAN_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_SLICE_REPLAN_TARBALL', 'OPENLOGOS_SLICE_REPLAN_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

if (!process.env.DRYRUN_ENTRY) {
  requireEnvOrSkip(SLICE_REPLAN_SMOKE_IDS, [
    ['OPENLOGOS_SLICE_REPLAN_TARBALL', 'OPENLOGOS_TARBALL'],
    ['OPENLOGOS_SLICE_REPLAN_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
  ], {
    reason: '切片重划 smoke 需要 0.14.15 候选与 0.14.14 回滚制品',
    environment: 'slice-replan',
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
const SPEC_BEFORE = '| ID | 描述 |\n|---|---|\n';
const SPEC_AFTER = '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n';
const PLAN_A_CODE = '- [ ] 切片1：第一片完整任务文本（覆盖 UT-S01-01）\n- [ ] 切片2：第二片完整任务文本（覆盖 UT-S01-02）';
const PLAN_A = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片完整任务文本（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [SPEC_REL] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片完整任务文本（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [SPEC_REL] },
];
const PLAN_B_CODE = '- [ ] 重划后单切片：合并后的完整任务文本（覆盖 UT-S01-01、UT-S01-02）';
const PLAN_B = [
  { slice_id: 'slice-01-merged', task_text: '重划后单切片：合并后的完整任务文本（覆盖 UT-S01-01、UT-S01-02）', owned_test_ids: ['UT-S01-01', 'UT-S01-02'], runner_selectors: ['UT-S01-01', 'UT-S01-02'], spec_targets: [SPEC_REL] },
];
const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', '- [ ] 实现代码变更', '',
  '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
].join('\n');

function scaffold(entry) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-179-'));
  cli(entry, base, ['init', 'replan-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, 'logos', 'resources', 'test'), { recursive: true });
  writeFileSync(join(base, SPEC_REL), SPEC_AFTER);
  cli(entry, base, ['change', 'replan-demo']);
  const dir = join(base, 'logos', 'changes', 'replan-demo');
  writeFileSync(join(dir, 'tasks.md'), TASKS);
  const req = createRequire(join(packageRoot(entry), 'package.json'));
  const { buildTestChangeSet } = req(join(packageRoot(entry), 'dist', 'lib', 'test-change-set.js'));
  writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
    type: 'merge_transaction_complete', transaction_id: 'mtx_smoke', seal_sha256: null,
    receipt_sha256: null, completed_at: new Date().toISOString(),
    test_change_set: buildTestChangeSet({
      change: 'replan-demo', module: 'core',
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
    codeA: write('code-a.txt', PLAN_A_CODE), slicesA: write('slices-a.json', PLAN_A),
    codeB: write('code-b.txt', PLAN_B_CODE), slicesB: write('slices-b.json', PLAN_B),
    tasks: join(dir, 'tasks.md'),
    manifest: join(dir, 'TEST_SLICE_MANIFEST.json'),
    txFile: join(dir, 'TEST_SLICE_TRANSACTION.json'),
    audit: join(dir, 'SLICE_REPLANS.jsonl'),
  };
}

const tx = (entry, base, ...args) => cliRaw(entry, base, ['slice', 'transaction', ...args]);

function chain(entry, fx, code, slices) {
  for (const step of [
    ['submit-content', '--slot', 'slot_codesection', '--file', code],
    ['submit-content', '--slot', 'slot_slices', '--file', slices],
    ['seal'], ['apply'],
  ]) {
    const r = tx(entry, fx.base, ...step);
    if (r.status !== 0) throw new Error(`${step[0]} 失败：${r.stdout}${r.stderr}`.slice(0, 500));
  }
}

/** ②～⑤；expectReopenRejected=true 时在回滚版本上跑零回归对照。 */
function exercise(entry, { expectReopenRejected = false } = {}) {
  const scopes = [];
  const track = f => { scopes.push(f.base); return f; };
  try {
    // ② 首次规划（两切片）达 completed
    const a = track(scaffold(entry));
    chain(entry, a, a.codeA, a.slicesA);
    const statusOut = JSON.parse(tx(entry, a.base, 'status', '--format', 'json').stdout);
    const oldId = statusOut.data?.transaction_id ?? statusOut.data?.transaction?.transaction_id;
    const oldManifest = readFileSync(a.manifest, 'utf8');

    // ③ reopen
    const reopened = tx(entry, a.base, 'reopen', '--reason', '不确定性一维被证伪');
    if (expectReopenRejected) {
      if (reopened.status === 0) {
        throw new Error(`【断言空转】reopen 在 ${ROLLBACK_VERSION} 上竟成功——必须重写用例而非放行部署`);
      }
      // 锁死现场复现：completed 后 submit-content / abort 均被拒
      const sub = tx(entry, a.base, 'submit-content', '--slot', 'slot_slices', '--file', a.slicesB);
      const ab = tx(entry, a.base, 'abort');
      if (sub.status === 0 || ab.status === 0) throw new Error('回滚版锁死现场未复现');
      return { reopen_rejected_as_expected: true, lockout_reproduced: true };
    }
    if (reopened.status !== 0) {
      throw new Error(`【重划出口仍不存在】reopen 被拒：${reopened.stdout}${reopened.stderr}`.slice(0, 500));
    }
    const proj = JSON.parse(tx(entry, a.base, 'status', '--format', 'json').stdout).data;
    const phase = proj?.phase ?? proj?.transaction?.phase;
    if (phase !== 'collecting') throw new Error(`reopen 后 phase=${phase}，应为 collecting`);
    const auditRaw = readFileSync(a.audit, 'utf8');
    const audit = JSON.parse(auditRaw.trim().split('\n')[0]);
    if (audit.schema !== 'openlogos/slice-replan@1' || audit.old_transaction_id !== oldId || !audit.reason) {
      throw new Error(`留痕不齐备：${auditRaw.slice(0, 200)}`);
    }
    if (!existsSync(join(a.dir, 'slice-transactions', `${oldId}.json`))) throw new Error('旧事务未归档');
    if (readFileSync(a.manifest, 'utf8') !== oldManifest) throw new Error('重开后 apply 前 manifest 不得变化');
    if (!readFileSync(a.tasks, 'utf8').includes('第一片完整任务文本')) throw new Error('重开后 apply 前 [code] 不得变化');

    // ④ 重划：提交不同划分 → completed，整体替换无残留
    chain(entry, a, a.codeB, a.slicesB);
    const tasksAfter = readFileSync(a.tasks, 'utf8');
    const manifestAfter = readFileSync(a.manifest, 'utf8');
    if (!tasksAfter.includes('重划后单切片') || tasksAfter.includes('第一片完整任务文本')) {
      throw new Error('【半新半旧】[code] 段未整体替换');
    }
    if (manifestAfter === oldManifest || manifestAfter.includes('slice-01-a')) {
      throw new Error('【半新半旧】manifest 未整体替换');
    }

    // ⑤ 零回归：未重开的 completed 行为一致（另一夹具）
    const b = track(scaffold(entry));
    chain(entry, b, b.codeA, b.slicesA);
    const sub = tx(entry, b.base, 'submit-content', '--slot', 'slot_slices', '--file', b.slicesB);
    const ab = tx(entry, b.base, 'abort');
    if (sub.status === 0 || ab.status === 0) throw new Error('未重开的 completed 不得接受 submit/abort');

    return {
      reopen_to_collecting: true, audit_ok: true, old_archived: true,
      no_half_state_before_apply: true, full_replacement: true,
      untouched_completed_unchanged: true,
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

await smoke('SMOKE-core-179', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_SLICE_REPLAN_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_SLICE_REPLAN_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②～⑤
  const behaviour = exercise(initial.entry);

  // ⑥ 0.14.14→0.14.15 往返 + 零回归对照
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  const counter = exercise(rolledBack.entry, { expectReopenRejected: true });
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const behaviourAfterRestore = exercise(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    behaviour, zero_regression_counter: counter, behaviour_after_restore: behaviourAfterRestore,
  }];
});
