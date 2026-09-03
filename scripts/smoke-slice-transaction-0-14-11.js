#!/usr/bin/env node
/**
 * SMOKE-core-175 — 0.14.11 测试切片事务全链与原子回滚（安装态）。
 *
 * 只接受冻结本地 tarball；全部断言在一次性临时项目中构造，
 * **不触碰本仓或用户其它项目的活跃提案、guard 与 marker**，
 * **不手工写 tasks.md 的 [code] 段或 TEST_SLICE_MANIFEST.json**——手工写正是本次要消除的
 * 旧路径，用它构造前提会使本用例失去意义。
 *
 * 红线：步骤 ⑤「apply 回滚无半写态」。它是不变量 H（原子性由构造保证）唯一的直接证据——
 * 只验证成功路径无法区分「构造保证」与「纪律维持」，后者在顺利时同样一致。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const SLICE_TRANSACTION_SMOKE_IDS = ['SMOKE-core-175'];
const EXPECTED_VERSION = '0.14.11';
const ROLLBACK_VERSION = '0.14.10';
const ENVIRONMENT = 'local-global-temp-project';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: SLICE_TRANSACTION_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_SLICE_TX_TARBALL', 'OPENLOGOS_SLICE_TX_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

requireEnvOrSkip(SLICE_TRANSACTION_SMOKE_IDS, [
  ['OPENLOGOS_SLICE_TX_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_SLICE_TX_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: '切片事务 smoke 需要 0.14.11 候选与 0.14.10 回滚制品',
  environment: 'slice-transaction',
});

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const run = (cmd, args, cwd = root, env = process.env) =>
  spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 600_000 });

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
const CODE_BODY = '- [ ] 切片1：第一片（覆盖 UT-S01-01）\n- [ ] 切片2：第二片（覆盖 UT-S01-02）';
const SLICES = specRel => ([
  { slice_id: 'slice-01-a', task_text: '切片1：第一片（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [specRel] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [specRel] },
]);
const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', '- [ ] 实现代码变更', '',
  '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
].join('\n');

/** 构造一次性 launched 夹具项目。change set 用安装态 CLI 自己的构造器生成，不手写 canonical 形状。 */
function scaffold(entry) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-175-'));
  cli(entry, base, ['init', 'stx-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, 'logos', 'resources', 'test'), { recursive: true });
  writeFileSync(join(base, SPEC_REL), SPEC_AFTER);
  cli(entry, base, ['change', 'stx-demo']);
  const dir = join(base, 'logos', 'changes', 'stx-demo');
  writeFileSync(join(dir, 'tasks.md'), TASKS);

  // 用安装态 CLI 捆绑的 buildTestChangeSet 造合法 change set
  const req = createRequire(join(packageRoot(entry), 'package.json'));
  const { buildTestChangeSet } = req(join(packageRoot(entry), 'dist', 'lib', 'test-change-set.js'));
  const changeSet = buildTestChangeSet({
    change: 'stx-demo', module: 'core',
    targets: [{ targetPath: SPEC_REL, beforeBytes: Buffer.from(SPEC_BEFORE, 'utf8'), afterBytes: Buffer.from(SPEC_AFTER, 'utf8') }],
  });
  writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
    type: 'merge_transaction_complete', transaction_id: 'mtx_smoke', seal_sha256: null,
    receipt_sha256: null, completed_at: new Date().toISOString(), test_change_set: changeSet,
  }));

  const codeFile = join(base, 'code.txt');
  const slicesFile = join(base, 'slices.json');
  writeFileSync(codeFile, CODE_BODY);
  writeFileSync(slicesFile, JSON.stringify(SLICES(SPEC_REL)));
  return { base, dir, codeFile, slicesFile };
}

const tx = (entry, base, ...args) => cliRaw(entry, base, ['slice', 'transaction', ...args]);
const codeSection = text => /## \[code\][\s\S]*?(?=\n## |$)/.exec(text)?.[0] ?? '';
const otherSections = text => text.replace(codeSection(text), '');

/** 步骤 ②～⑧。 */
function exerciseTransaction(entry) {
  const scopes = [];
  const track = f => { scopes.push(f.base); return f; };
  try {
    // ② 命令面随包可用 + 契约哈希。事务尚未创建时 status 也必须可用（投影为 null）。
    const probe = track(scaffold(entry));
    const idle = tx(entry, probe.base, 'status', '--format', 'json');
    if (idle.status !== 0) throw new Error(`无事务时 slice transaction status 不可用：${idle.stderr}`);
    tx(entry, probe.base, 'submit-content', '--slot', 'slot_slices', '--file', probe.slicesFile);
    const status = tx(entry, probe.base, 'status', '--format', 'json');
    if (status.status !== 0) throw new Error(`slice transaction status 不可用：${status.stderr}`);
    const hashes = JSON.parse(status.stdout).data ?? {};
    for (const key of ['schema_sha256', 'contract_sha256']) {
      if (!/^sha256:[0-9a-f]{64}$/.test(hashes[key] ?? '')) throw new Error(`envelope 缺少 ${key}`);
    }

    // ③ initial-plan 全链
    const ok = track(scaffold(entry));
    const tasksBefore = readFileSync(join(ok.dir, 'tasks.md'), 'utf8');
    for (const step of [
      ['submit-content', '--slot', 'slot_codesection', '--file', ok.codeFile],
      ['submit-content', '--slot', 'slot_slices', '--file', ok.slicesFile],
      ['seal'], ['apply'],
    ]) {
      const r = tx(entry, ok.base, ...step);
      if (r.status !== 0) throw new Error(`initial-plan ${step[0]} 失败：${r.stdout}${r.stderr}`);
    }
    const manifestPath = join(ok.dir, 'TEST_SLICE_MANIFEST.json');
    if (!existsSync(manifestPath)) throw new Error('apply 后 manifest 未落盘');
    const tasksAfter = readFileSync(join(ok.dir, 'tasks.md'), 'utf8');

    // ④ 指纹一致 + 非 [code] 段字节恒等
    const req = createRequire(join(packageRoot(entry), 'package.json'));
    const { computeTaskFingerprint } = req(join(packageRoot(entry), 'dist', 'lib', 'test-slice-manifest.js'));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.task_fingerprint !== computeTaskFingerprint(tasksAfter)) {
      throw new Error('task_fingerprint 与实际 tasks.md 不一致');
    }
    if (otherSections(tasksAfter) !== otherSections(tasksBefore)) {
      throw new Error('[code] 之外的段未保持字节恒等');
    }
    if (!codeSection(tasksAfter).includes('切片1：第一片')) throw new Error('[code] 段未被替换');

    // ⑤ apply 中途失败整体回滚 —— 红线
    const bad = track(scaffold(entry));
    const brokenSlices = join(bad.base, 'broken.json');
    writeFileSync(brokenSlices, JSON.stringify([
      { ...SLICES(SPEC_REL)[0], spec_targets: ['logos/resources/test/nonexistent.md'] },
    ]));
    tx(entry, bad.base, 'submit-content', '--slot', 'slot_codesection', '--file', bad.codeFile);
    tx(entry, bad.base, 'submit-content', '--slot', 'slot_slices', '--file', brokenSlices);
    tx(entry, bad.base, 'seal');
    const badTasksBefore = readFileSync(join(bad.dir, 'tasks.md'), 'utf8');
    const applyBad = tx(entry, bad.base, 'apply');
    if (applyBad.status === 0) throw new Error('【原子性未保证】损坏的 apply 竟成功');
    if (readFileSync(join(bad.dir, 'tasks.md'), 'utf8') !== badTasksBefore) {
      throw new Error('【半写态】apply 失败后 tasks.md 未回滚');
    }
    if (existsSync(join(bad.dir, 'TEST_SLICE_MANIFEST.json'))) {
      throw new Error('【半写态】apply 失败后 manifest 仍存在');
    }
    const failedPhase = JSON.parse(tx(entry, bad.base, 'status', '--format', 'json').stdout).data?.phase;
    if (failedPhase !== 'failed') throw new Error(`apply 失败后 phase=${failedPhase}，应为 failed`);

    // ⑥ manifest-recovery 全链
    const rec = track(scaffold(entry));
    for (const step of [
      ['submit-content', '--slot', 'slot_codesection', '--file', rec.codeFile],
      ['submit-content', '--slot', 'slot_slices', '--file', rec.slicesFile],
      ['seal'], ['apply'],
    ]) tx(entry, rec.base, ...step);
    rmSync(join(rec.dir, 'TEST_SLICE_TRANSACTION.json'), { force: true });
    rmSync(join(rec.dir, 'TEST_SLICE_MANIFEST.json'), { force: true });
    cliRaw(entry, rec.base, ['next', '--format', 'json']);   // 由 next 创建恢复事务
    const recStatus = tx(entry, rec.base, 'status', '--format', 'json');
    const recData = JSON.parse(recStatus.stdout).data;
    if (recData?.origin !== 'manifest-recovery') throw new Error(`恢复事务未创建：origin=${recData?.origin}`);
    if (recData.content_slots.required !== 1) throw new Error(`恢复事务 slot 未收窄：required=${recData.content_slots.required}`);
    const frozen = readFileSync(join(rec.dir, 'tasks.md'), 'utf8');
    const rejected = tx(entry, rec.base, 'submit-content', '--slot', 'slot_codesection', '--file', rec.codeFile);
    if (rejected.status === 0) throw new Error('恢复事务竟接受 slot_codesection（[code] 未冻结）');
    tx(entry, rec.base, 'submit-content', '--slot', 'slot_slices', '--file', rec.slicesFile);
    tx(entry, rec.base, 'seal');
    const applyRec = tx(entry, rec.base, 'apply');
    if (applyRec.status !== 0) throw new Error(`恢复 apply 失败：${applyRec.stdout}${applyRec.stderr}`);
    if (readFileSync(join(rec.dir, 'tasks.md'), 'utf8') !== frozen) throw new Error('恢复后 [code] 段未保持字节恒等');

    // ⑦ 归档只读
    const arch = track(scaffold(entry));
    for (const step of [
      ['submit-content', '--slot', 'slot_codesection', '--file', arch.codeFile],
      ['submit-content', '--slot', 'slot_slices', '--file', arch.slicesFile],
      ['seal'], ['apply'],
    ]) tx(entry, arch.base, ...step);
    const archiveDir = join(arch.base, 'logos', 'changes', 'archive', '20260101-0000-stx-demo');
    mkdirSync(join(arch.base, 'logos', 'changes', 'archive'), { recursive: true });
    run('mv', [arch.dir, archiveDir]);
    const archManifest = readFileSync(join(archiveDir, 'TEST_SLICE_MANIFEST.json'), 'utf8');
    const writeActions = [
      ['submit-content', '--slot', 'slot_slices', '--file', arch.slicesFile],
      ['seal'], ['apply'], ['recover'], ['abort'],
    ];
    for (const action of writeActions) {
      const write = action[0];
      const r = tx(entry, arch.base, ...action, '--slug', 'stx-demo');
      if (r.status === 0) throw new Error(`归档提案竟放行写动作 ${write}`);
      if (!`${r.stdout}${r.stderr}`.includes('action_not_allowed')) {
        throw new Error(`归档拒绝码不符：${r.stdout}${r.stderr}`);
      }
    }
    if (readFileSync(join(archiveDir, 'TEST_SLICE_MANIFEST.json'), 'utf8') !== archManifest) {
      throw new Error('归档提案的写动作产生了副作用');
    }

    // ⑧ 旧路径不可用：安装态 dist 中 writeTestSliceManifestAtomic 只应被事务模块调用
    const libDir = join(packageRoot(entry), 'dist', 'lib');
    const callers = ['test-slice-transaction.js'];
    const commandsDir = join(packageRoot(entry), 'dist', 'commands');
    for (const dir of [libDir, commandsDir]) {
      for (const name of (existsSync(dir) ? readdirSync(dir) : [])) {
        if (!name.endsWith('.js')) continue;
        if (name === 'test-slice-manifest.js' || callers.includes(name)) continue;
        if (/writeTestSliceManifestAtomic\s*\(/.test(readFileSync(join(dir, name), 'utf8'))) {
          throw new Error(`安装态仍有旧写入路径：${name}`);
        }
      }
    }

    return {
      command_available: true,
      schema_sha256: hashes.schema_sha256,
      contract_sha256: hashes.contract_sha256,
      write_actions_rejected_when_archived: 5,
      initial_plan_ok: true,
      fingerprint_consistent: true,
      other_sections_byte_equal: true,
      rollback_no_half_write: true,
      recovery_required_slots: recData.content_slots.required,
      recovery_code_frozen: true,
      archive_read_only: true,
      no_legacy_writer: true,
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

await smoke('SMOKE-core-175', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_SLICE_TX_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_SLICE_TX_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②～⑧
  const transaction = exerciseTransaction(initial.entry);

  // ⑨ 0.14.10→0.14.11→0.14.10→0.14.11 往返，每阶段复核 identity 与结论
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const transactionAfterRestore = exerciseTransaction(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    transaction, transaction_after_restore: transactionAfterRestore,
  }];
});
