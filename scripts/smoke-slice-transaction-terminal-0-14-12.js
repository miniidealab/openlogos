#!/usr/bin/env node
/**
 * SMOKE-core-176 — 0.14.12 apply 终态自校验与终态事务不堵恢复（安装态）。
 *
 * 双红线：
 *   ③ 业务非法 slot 必须被 apply 拦下并整体回滚——若 apply 成功即整体 FAIL，那正是被修的缺陷；
 *   ⑤⑥ 终态事务在场时必须创建出 origin=manifest-recovery 事务——若拿到的是 initial-plan
 *      的终态事务即整体 FAIL。
 *
 * 硬约束：全部关键断言穿过公开 `openlogos slice transaction` 命令，不以库级调用构造；
 * 任何步骤中都**不得删除或改名 TEST_SLICE_TRANSACTION.json**——那是本次要消除的人工绕过。
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

export const SLICE_TERMINAL_SMOKE_IDS = ['SMOKE-core-176'];
const EXPECTED_VERSION = '0.14.12';
const ROLLBACK_VERSION = '0.14.11';
const ENVIRONMENT = 'local-global-temp-project';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: SLICE_TERMINAL_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_SLICE_TERMINAL_TARBALL', 'OPENLOGOS_SLICE_TERMINAL_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

if (!process.env.DRYRUN_ENTRY) {
  requireEnvOrSkip(SLICE_TERMINAL_SMOKE_IDS, [
    ['OPENLOGOS_SLICE_TERMINAL_TARBALL', 'OPENLOGOS_TARBALL'],
    ['OPENLOGOS_SLICE_TERMINAL_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
  ], {
    reason: '切片事务终态自校验 smoke 需要 0.14.12 候选与 0.14.11 回滚制品',
    environment: 'slice-transaction-terminal',
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
const CODE_BODY = '- [ ] 切片1：第一片完整任务文本（覆盖 UT-S01-01）\n- [ ] 切片2：第二片完整任务文本（覆盖 UT-S01-02）';
const VALID_SLICES = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片完整任务文本（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [SPEC_REL] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片完整任务文本（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [SPEC_REL] },
];
// 结构合法（JSON 合法、四字段齐备），只在业务层非法：spec_targets 非测试规格；task_text 用简称。
const INVALID_SLICES = VALID_SLICES.map(s => ({ ...s, task_text: `${s.slice_id} 简称`, spec_targets: [OTHER_DOC] }));
const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', '- [ ] 实现代码变更', '',
  '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
].join('\n');

/** 一次性 launched 夹具项目；change set 由安装态 CLI 自己的构造器生成。 */
function scaffold(entry) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-176-'));
  cli(entry, base, ['init', 'stx-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, 'logos', 'resources', 'test'), { recursive: true });
  mkdirSync(join(base, 'logos', 'resources', 'prd', '3-technical-plan'), { recursive: true });
  writeFileSync(join(base, SPEC_REL), SPEC_AFTER);
  writeFileSync(join(base, OTHER_DOC), '# 架构\n\n这不是测试规格文档。\n');
  cli(entry, base, ['change', 'stx-demo']);
  const dir = join(base, 'logos', 'changes', 'stx-demo');
  writeFileSync(join(dir, 'tasks.md'), TASKS);

  const req = createRequire(join(packageRoot(entry), 'package.json'));
  const { buildTestChangeSet } = req(join(packageRoot(entry), 'dist', 'lib', 'test-change-set.js'));
  writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
    type: 'merge_transaction_complete', transaction_id: 'mtx_smoke', seal_sha256: null,
    receipt_sha256: null, completed_at: new Date().toISOString(),
    test_change_set: buildTestChangeSet({
      change: 'stx-demo', module: 'core',
      targets: [{ targetPath: SPEC_REL, beforeBytes: Buffer.from(SPEC_BEFORE, 'utf8'), afterBytes: Buffer.from(SPEC_AFTER, 'utf8') }],
    }),
  }));

  const codeFile = join(base, 'code.txt');
  const okFile = join(base, 'slices-ok.json');
  const badFile = join(base, 'slices-bad.json');
  writeFileSync(codeFile, CODE_BODY);
  writeFileSync(okFile, JSON.stringify(VALID_SLICES));
  writeFileSync(badFile, JSON.stringify(INVALID_SLICES));
  return { base, dir, codeFile, okFile, badFile, manifest: join(dir, 'TEST_SLICE_MANIFEST.json'), tasks: join(dir, 'tasks.md') };
}

const tx = (entry, base, ...args) => cliRaw(entry, base, ['slice', 'transaction', ...args]);
const txFile = dir => join(dir, 'TEST_SLICE_TRANSACTION.json');

function exercise(entry) {
  const scopes = [];
  const track = f => { scopes.push(f.base); return f; };
  try {
    // ②③ 业务非法 slot 全链 → apply 必须失败且整体回滚
    const bad = track(scaffold(entry));
    tx(entry, bad.base, 'submit-content', '--slot', 'slot_codesection', '--file', bad.codeFile);
    tx(entry, bad.base, 'submit-content', '--slot', 'slot_slices', '--file', bad.badFile);
    const sealedBad = tx(entry, bad.base, 'seal');
    if (sealedBad.status !== 0) throw new Error(`业务非法 slot 应能通过 seal（结构合法）：${sealedBad.stderr}`);
    const tasksBefore = readFileSync(bad.tasks, 'utf8');
    const applyBad = tx(entry, bad.base, 'apply', '--format', 'json');
    if (applyBad.status === 0) {
      throw new Error('【终态自校验未生效】业务非法 slot 的 apply 竟成功——这正是被修复的缺陷');
    }
    if (readFileSync(bad.tasks, 'utf8') !== tasksBefore) throw new Error('【半写态】apply 失败后 tasks.md 未回滚');
    if (existsSync(bad.manifest)) throw new Error('【半写态】apply 失败后 manifest 仍存在');
    const envelope = JSON.parse(applyBad.stderr.trim());
    const violations = envelope?.error?.details?.violations ?? [];
    if (violations.length === 0) throw new Error('violations 被压缩为空，无法定位不合格字段');
    for (const v of violations) {
      for (const key of ['code', 'path', 'message', 'fix_hint']) {
        if (!(key in v)) throw new Error(`violation 缺少 ${key}，未保真`);
      }
    }
    if (!violations.some(v => String(v.message).includes(OTHER_DOC))) {
      throw new Error('violations 未点名非法的 spec_target');
    }
    const failedPhase = JSON.parse(tx(entry, bad.base, 'status', '--format', 'json').stdout).data?.phase;
    if (failedPhase !== 'failed') throw new Error(`apply 失败后 phase=${failedPhase}，应为 failed`);

    // ④ 修正后重提 → completed，全程未删除任何 OpenLogos 拥有的文件
    const resubmit = tx(entry, bad.base, 'submit-content', '--slot', 'slot_slices', '--file', bad.okFile);
    if (resubmit.status !== 0) {
      throw new Error(`【新死锁】failed 态不接受修正后的提交：${resubmit.stdout}${resubmit.stderr}`);
    }
    tx(entry, bad.base, 'seal');
    const fixed = tx(entry, bad.base, 'apply', '--format', 'json');
    if (fixed.status !== 0) throw new Error(`修正后 apply 仍失败：${fixed.stdout}${fixed.stderr}`);
    if (!existsSync(bad.manifest)) throw new Error('修正后 manifest 未落盘');
    if (!existsSync(txFile(bad.dir))) throw new Error('事务文件不应在恢复流程中消失');

    // ⑤⑥⑦ 终态事务在场 → 仍能创建恢复事务并完成恢复
    const rec = track(scaffold(entry));
    for (const step of [
      ['submit-content', '--slot', 'slot_codesection', '--file', rec.codeFile],
      ['submit-content', '--slot', 'slot_slices', '--file', rec.okFile],
      ['seal'], ['apply'],
    ]) {
      const r = tx(entry, rec.base, ...step);
      if (r.status !== 0) throw new Error(`健康全链 ${step[0]} 失败：${r.stdout}${r.stderr}`);
    }
    const completedId = JSON.parse(tx(entry, rec.base, 'status', '--format', 'json').stdout).data?.transaction_id;
    rmSync(rec.manifest, { force: true });               // 只让 manifest 失效
    if (!existsSync(txFile(rec.dir))) throw new Error('前置破坏后事务文件必须仍在场');
    const frozen = readFileSync(rec.tasks, 'utf8');

    const nextOut = cliRaw(entry, rec.base, ['next', '--format', 'json']);
    const mod = JSON.parse(nextOut.stdout).data.modules[0];
    const projected = mod.slice_transaction;
    if (!projected || projected.origin !== 'manifest-recovery') {
      throw new Error(`【恢复入口仍被堵死】next 返回 origin=${projected?.origin ?? '<无投影>'}，应为 manifest-recovery`);
    }
    if (projected.transaction_id === completedId) {
      throw new Error('【恢复入口仍被堵死】next 返回的是那个 completed 的 initial-plan 事务');
    }
    if (projected.content_slots.required !== 1) {
      throw new Error(`恢复事务 slot 未收窄：required=${projected.content_slots.required}`);
    }
    const detail = String(mod.detail ?? '');
    if (detail.includes('（无缺口）')) throw new Error('有缺口时不得渲染「（无缺口）」');
    if (!detail.includes('manifest-recovery')) throw new Error('detail 未如实说明这是恢复事务');
    // 旧终态事务被归档而非静默覆盖
    const archived = join(rec.dir, 'slice-transactions', `${completedId}.json`);
    if (!existsSync(archived)) throw new Error('终态事务未归档，receipt 被静默丢弃');

    for (const step of [['submit-content', '--slot', 'slot_slices', '--file', rec.okFile], ['seal'], ['apply']]) {
      const r = tx(entry, rec.base, ...step);
      if (r.status !== 0) throw new Error(`恢复 ${step[0]} 失败：${r.stdout}${r.stderr}`);
    }
    if (readFileSync(rec.tasks, 'utf8') !== frozen) throw new Error('恢复后 [code] 段未保持字节恒等');

    // ⑧ recover 文案不得断言未发生的前提
    const recovered = tx(entry, rec.base, 'recover');
    if (recovered.status === 0) throw new Error('recover 尚未开放，不应成功');
    if (`${recovered.stdout}${recovered.stderr}`.includes('apply 失败已整体回滚')) {
      throw new Error('recover 文案仍断言「apply 失败已整体回滚」这一不成立的前提');
    }

    return {
      invalid_slot_rejected: true,
      no_half_write: true,
      violations_preserved: violations.length,
      resubmit_after_failure_ok: true,
      terminal_does_not_block_recovery: true,
      recovery_required_slots: projected.content_slots.required,
      terminal_transaction_archived: true,
      code_section_byte_equal: true,
      recover_message_sound: true,
      transaction_file_never_removed: true,
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

await smoke('SMOKE-core-176', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_SLICE_TERMINAL_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_SLICE_TERMINAL_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②～⑧
  const behaviour = exercise(initial.entry);

  // ⑨ 回归既有 SMOKE-core-175 的断言由该 runner 自身承担（run-smoke 同批分派）
  // ⑩ 0.14.11→0.14.12→0.14.11→0.14.12 往返，每阶段复核 identity 与结论
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const behaviourAfterRestore = exercise(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    behaviour, behaviour_after_restore: behaviourAfterRestore,
  }];
});
