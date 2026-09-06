#!/usr/bin/env node
// SMOKE-core-194：0.14.23 next 问即建发布全链（安装态 ready-to-implement 提案 → next 携 slice_transaction
// 投影且事务落盘 → 幂等续用 → 非触发零回归）+ 固定 0.14.22 无投影缺陷复现对照 + roundtrip。
// next 行为断言驱动真实安装态 `openlogos next --format json` 并解析 JSON 输出；库级函数直调不计入闭环证据。
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
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SMOKE_ID = 'SMOKE-core-194';
const EXPECTED_VERSION = '0.14.23';
const ROLLBACK_VERSION = '0.14.22';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/next-ensure-smoke@1',
    ids: [SMOKE_ID],
    required_env: ['OPENLOGOS_NEXT_ENSURE_TARBALL', 'OPENLOGOS_NEXT_ENSURE_ROLLBACK_TARBALL'],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'fix-next-ensure-initial-plan-slice-transaction' && process.env.OPENLOGOS_NEXT_ENSURE_STAGING !== '1') {
  exitNotApplicable([SMOKE_ID], {
    reason: 'next ensure staging 未就绪：需活跃变更 fix-next-ensure-initial-plan-slice-transaction 或 OPENLOGOS_NEXT_ENSURE_STAGING=1',
    missing: ['OPENLOGOS_NEXT_ENSURE_STAGING', 'OPENLOGOS_NEXT_ENSURE_TARBALL'],
    environment: 'next-ensure-staging',
  });
}

const tarball = process.env.OPENLOGOS_NEXT_ENSURE_TARBALL;
const rollbackTarball = process.env.OPENLOGOS_NEXT_ENSURE_ROLLBACK_TARBALL;

function sanitize(value) {
  return String(value).replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>').slice(0, 4000);
}

function writeResult(status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id: SMOKE_ID, status, timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt, environment: 'next-ensure-staging', evidence,
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

const work = mkdtempSync(join(tmpdir(), 'openlogos-next-ensure-smoke-'));

function installPrefix(file, name) {
  const prefix = join(work, `prefix-${name}`);
  mkdirSync(prefix, { recursive: true });
  checked('npm', ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', file]);
  return {
    entry: join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js'),
    pkgRoot: join(prefix, 'node_modules/@miniidealab/openlogos'),
  };
}

const SLUG = 'smoke-ensure-proposal';
const SPEC_REL = 'logos/resources/test/core-S01-test-cases.md';

/** 隔离项目 + 构造 ready-to-implement 提案（spec-complete、[code] 标题在场切片未填）。 */
async function setupReadyProject(inst, dir, { specMerged = true } = {}) {
  mkdirSync(dir, { recursive: true });
  checked(process.execPath, [inst.entry, 'init', 'demo', '--locale', 'zh', '--ai-tool', 'claude-code'], { cwd: dir });
  writeFileSync(join(dir, 'logos', 'logos-project.yaml'),
    'project:\n  name: "demo"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    product_type: cli\n');
  mkdirSync(join(dir, 'logos', 'resources', 'test'), { recursive: true });
  const before = Buffer.from('| ID | 描述 |\n|---|---|\n', 'utf8');
  const after = Buffer.from('| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n', 'utf8');
  writeFileSync(join(dir, SPEC_REL), after);
  const proposalDir = join(dir, 'logos', 'changes', SLUG);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案：smoke ensure 夹具\n\n## 变更原因\n\n安装态夹具。\n');
  writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '');
  // 测试 ID 证据：post-merge 阶段按 delta 测试文件 + 已合并规格中的结构化 ID 判定
  mkdirSync(join(proposalDir, 'deltas', 'test'), { recursive: true });
  writeFileSync(join(proposalDir, 'deltas', 'test', 'core-S01-test-cases.md'),
    '## ADDED — 用例\n\n| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n');
  if (specMerged) {
    const { buildTestChangeSet } = await import(pathToFileURL(join(inst.pkgRoot, 'dist', 'lib', 'test-change-set.js')).href);
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), JSON.stringify({
      type: 'merge_transaction_complete', transaction_id: 'mtx_smoke', seal_sha256: null,
      receipt_sha256: null, completed_at: new Date().toISOString(),
      test_change_set: buildTestChangeSet({
        change: SLUG, module: 'core',
        targets: [{ targetPath: SPEC_REL, beforeBytes: before, afterBytes: after }],
      }),
    }));
  }
  writeFileSync(join(proposalDir, 'tasks.md'), [
    '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
    '## [code] 代码实现', '', '（本段在 plan 段留空，由 slice-planner 填写。）', '',
  ].join('\n'));
  writeFileSync(join(dir, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  return { proposalDir, txPath: join(proposalDir, 'TEST_SLICE_TRANSACTION.json') };
}

function runNext(inst, dir) {
  const result = checked(process.execPath, [inst.entry, 'next', '--format', 'json'], { cwd: dir });
  return JSON.parse(result.stdout).data.modules[0];
}

const startedAt = Date.now();
try {
  if (!tarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_NEXT_ENSURE_TARBALL'), { __skip: true });
  if (!rollbackTarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_NEXT_ENSURE_ROLLBACK_TARBALL'), { __skip: true });
  const evidence = [];

  // ① candidate identity
  const candidate = installPrefix(tarball, 'candidate');
  const version = checked(process.execPath, [candidate.entry, '--version']).stdout.trim();
  if (version !== EXPECTED_VERSION) throw new Error(`candidate 版本漂移：${version}`);
  const manifest = JSON.parse(readFileSync(join(candidate.pkgRoot, 'asset-manifest.json'), 'utf8'));
  if (manifest.version !== EXPECTED_VERSION) throw new Error(`asset-manifest 版本漂移：${manifest.version}`);
  evidence.push(`candidate=${EXPECTED_VERSION} sha256:${sha256(tarball)}`);

  // ②③④ 问即建全链
  const verifyEnsure = async (inst, label) => {
    const proj = join(work, `p-${label}`);
    const fx = await setupReadyProject(inst, proj);
    // ② 问即建：next 携投影且事务落盘
    const module = runNext(inst, proj);
    const tx = module.slice_transaction;
    if (!tx) throw new Error(`[${label}] ready-to-implement 的 next 未携带 slice_transaction 投影`);
    if (tx.origin !== 'initial-plan' || tx.phase !== 'collecting' || tx.content_slots.required !== 2) {
      throw new Error(`[${label}] 投影形态漂移：${JSON.stringify({ origin: tx.origin, phase: tx.phase, required: tx.content_slots.required })}`);
    }
    if (!existsSync(fx.txPath)) throw new Error(`[${label}] 事务文件未落盘`);
    // ③ 幂等：重跑 transaction_id 不变；submit-content 续用同一事务
    const again = runNext(inst, proj).slice_transaction;
    if (!again || again.transaction_id !== tx.transaction_id) {
      throw new Error(`[${label}] 幂等失败：${again && again.transaction_id} != ${tx.transaction_id}`);
    }
    const codeFile = join(proj, 'code.txt');
    writeFileSync(codeFile, '- [ ] 切片1：第一片（覆盖 UT-S01-01、UT-S01-02）');
    checked(process.execPath, [inst.entry, 'slice', 'transaction', 'submit-content', '--slot', 'slot_codesection', '--file', codeFile], { cwd: proj });
    const stored = JSON.parse(readFileSync(fx.txPath, 'utf8'));
    if (stored.transaction_id !== tx.transaction_id) throw new Error(`[${label}] submit-content 未续用同一事务（重建）`);
    // ④ 非触发零回归：delta-writing 前沿（无 SPEC_MERGED）不创建、不输出
    const proj2 = join(work, `p-${label}-nontrigger`);
    const fx2 = await setupReadyProject(inst, proj2, { specMerged: false });
    const module2 = runNext(inst, proj2);
    if (module2.slice_transaction) throw new Error(`[${label}] 非 plan-slices 前沿也输出了投影`);
    if (existsSync(fx2.txPath)) throw new Error(`[${label}] 非 plan-slices 前沿也创建了事务文件`);
    return tx.transaction_id;
  };
  await verifyEnsure(candidate, 'candidate');
  evidence.push('问即建投影 + 事务落盘 + 幂等续用 + 非触发零回归 通过');

  // ⑤ 0.14.22 对照：无投影且不落盘必须复现（防断言空转）
  const rollback = installPrefix(rollbackTarball, 'rollback');
  const rollbackVersion = checked(process.execPath, [rollback.entry, '--version']).stdout.trim();
  if (rollbackVersion !== ROLLBACK_VERSION) throw new Error(`回滚版本漂移：${rollbackVersion}`);
  const contrastProj = join(work, 'p-contrast');
  const contrastFx = await setupReadyProject(rollback, contrastProj);
  const contrastModule = runNext(rollback, contrastProj);
  if (contrastModule.slice_transaction) {
    throw new Error('对照空转：0.14.22 的 next 也输出了 slice_transaction，矩阵必须重写');
  }
  if (existsSync(contrastFx.txPath)) {
    throw new Error('对照空转：0.14.22 的 next 也落盘了事务文件，矩阵必须重写');
  }
  evidence.push('0.14.22 无投影且不落盘缺陷复现对照有效');

  // ⑥ roundtrip：恢复 0.14.23 后 identity 与问即建结论不变
  const restored = installPrefix(tarball, 'restore');
  const restoredVersion = checked(process.execPath, [restored.entry, '--version']).stdout.trim();
  if (restoredVersion !== EXPECTED_VERSION) throw new Error('roundtrip 恢复失败');
  await verifyEnsure(restored, 'roundtrip');
  evidence.push(`roundtrip ${ROLLBACK_VERSION}→${EXPECTED_VERSION} 无混装且问即建结论不变`);

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
