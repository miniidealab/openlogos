#!/usr/bin/env node
// SMOKE-core-196：0.14.25 生命周期 fail-closed 与状态对账发布全链
// （安装态 smoke/archive 拒绝矩阵 + state_inconsistency 投影在场 + 补标后全链放行）
// + 固定 0.14.24 对照（smoke 照常写 SMOKE_PASS、archive 照常成功、无投影字段）防断言空转
// + 0.14.24↔0.14.25 roundtrip。断言全部驱动真实安装态 CLI 命令，库级直调不计入闭环证据。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SMOKE_ID = 'SMOKE-core-196';
const EXPECTED_VERSION = '0.14.25';
const ROLLBACK_VERSION = '0.14.24';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/lifecycle-failclosed-smoke@1',
    ids: [SMOKE_ID],
    required_env: ['OPENLOGOS_LIFECYCLE_FC_TARBALL', 'OPENLOGOS_LIFECYCLE_FC_ROLLBACK_TARBALL'],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'fix-deploy-done-leak-failclosed-selfheal' && process.env.OPENLOGOS_LIFECYCLE_FC_STAGING !== '1') {
  exitNotApplicable([SMOKE_ID], {
    reason: 'lifecycle fail-closed staging 未就绪：需活跃变更 fix-deploy-done-leak-failclosed-selfheal 或 OPENLOGOS_LIFECYCLE_FC_STAGING=1',
    missing: ['OPENLOGOS_LIFECYCLE_FC_STAGING', 'OPENLOGOS_LIFECYCLE_FC_TARBALL'],
    environment: 'lifecycle-failclosed-staging',
  });
}

const tarball = process.env.OPENLOGOS_LIFECYCLE_FC_TARBALL;
const rollbackTarball = process.env.OPENLOGOS_LIFECYCLE_FC_ROLLBACK_TARBALL;

function sanitize(value) {
  return String(value).replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>').slice(0, 4000);
}

function writeResult(status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id: SMOKE_ID, status, timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt, environment: 'lifecycle-failclosed-staging', evidence,
  };
  if (error) record.error = sanitize(error);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function run(entry, args, cwd, allowFailure = true) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env },
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`openlogos ${args.join(' ')} 失败：exit ${result.status}\n${result.stderr}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function checkedNpm(args) {
  const result = spawnSync('npm', args, { cwd: repoRoot, encoding: 'utf8', timeout: 300000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} 失败：exit ${result.status}\n${result.stderr}`);
  return result;
}

const work = mkdtempSync(join(tmpdir(), 'openlogos-lifecycle-fc-smoke-'));

function installPrefix(file, name) {
  const prefix = join(work, `prefix-${name}`);
  mkdirSync(prefix, { recursive: true });
  checkedNpm(['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', file]);
  return {
    entry: join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js'),
    pkgRoot: join(prefix, 'node_modules/@miniidealab/openlogos'),
  };
}

const DEPLOY_PROPOSAL = [
  '# 变更提案：runtime-change', '', '## 部署影响',
  '- 是否需要部署：是', '- 部署原因：安装态夹具', '- 影响环境：staging',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：是',
].join('\n');

/** 构造「部署与 smoke 实际都已完成、但漏跑 deploy-done」的 20260907 孤儿状态项目。 */
function initOrphanProject(entry, dir, opts = {}) {
  mkdirSync(dir, { recursive: true });
  run(entry, ['init', 'demo', '--locale', 'zh', '--ai-tool', 'claude-code'], dir, false);
  writeFileSync(join(dir, 'logos', 'logos-project.yaml'),
    'project:\n  name: "demo"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n'
    + 'deployment_gates:\n  core:\n    deployment_required: true\n    smoke_required: true\n');
  const slug = 'deploy-feature';
  const proposalDir = join(dir, 'logos', 'changes', slug);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(dir, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  writeFileSync(join(proposalDir, 'proposal.md'), DEPLOY_PROPOSAL);
  writeFileSync(join(proposalDir, 'tasks.md'), [
    '# 实现任务', '', '## [deploy] 部署任务',
    opts.deployChecked === false ? '- [ ] 部署到 staging' : '- [x] 部署到 staging',
  ].join('\n'));
  writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
  if (opts.smokePass) writeFileSync(join(proposalDir, 'SMOKE_PASS'), '');
  mkdirSync(join(dir, 'logos', 'resources', 'verify'), { recursive: true });
  writeFileSync(join(dir, 'logos', 'resources', 'verify', 'deployment-report.md'), '# Deployment Report\n\nok\n');
  // 配置一个可观察的 smoke.command，用于证明拒绝时它从未执行
  const configPath = join(dir, 'logos', 'logos.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.smoke = { command: `node -e "require('fs').writeFileSync('smoke-command-ran.txt','ran')"` };
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { slug, dir, proposalDir };
}

const startedAt = Date.now();
try {
  if (!tarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_LIFECYCLE_FC_TARBALL'), { __skip: true });
  if (!rollbackTarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_LIFECYCLE_FC_ROLLBACK_TARBALL'), { __skip: true });
  const evidence = [];

  // ① candidate identity
  const candidate = installPrefix(tarball, 'candidate');
  const version = run(candidate.entry, ['--version'], repoRoot, false).stdout.trim();
  if (version !== EXPECTED_VERSION) throw new Error(`candidate 版本漂移：${version}`);
  evidence.push(`candidate=${EXPECTED_VERSION} sha256:${sha256(tarball)}`);

  // ②③④ fail-closed 拒绝矩阵 + 对账投影 + 补标后放行
  const verifyFixes = (entry, label) => {
    const p = initOrphanProject(entry, join(work, `p-${label}`), { smokePass: true });

    // ② smoke 缺 DEPLOY_DONE → 拒绝、零副作用
    const smokeRejected = run(entry, ['smoke'], p.dir);
    if (smokeRejected.status === 0) throw new Error(`[${label}] 缺 DEPLOY_DONE 时 smoke 未被拒绝`);
    if (!smokeRejected.stderr.includes('SMOKE_DEPLOY_NOT_DONE')) {
      throw new Error(`[${label}] smoke 拒绝缺错误码 SMOKE_DEPLOY_NOT_DONE：${smokeRejected.stderr.slice(0, 160)}`);
    }
    if (!smokeRejected.stderr.includes('openlogos deploy-done')) {
      throw new Error(`[${label}] smoke 拒绝缺补救命令提示`);
    }
    if (existsSync(join(p.dir, 'smoke-command-ran.txt'))) throw new Error(`[${label}] 拒绝时 smoke.command 仍被执行`);
    if (existsSync(join(p.dir, 'logos/resources/verify/smoke-report.md'))) {
      throw new Error(`[${label}] 拒绝时仍生成 smoke-report.md`);
    }

    // ② smoke：[deploy] 未全勾（DEPLOY_DONE 旁路在场）→ SMOKE_DEPLOY_TASKS_INCOMPLETE
    const p2 = initOrphanProject(entry, join(work, `p-${label}-tasks`), { deployChecked: false });
    writeFileSync(join(p2.proposalDir, 'DEPLOY_DONE'), '');
    const tasksRejected = run(entry, ['smoke'], p2.dir);
    if (!tasksRejected.stderr.includes('SMOKE_DEPLOY_TASKS_INCOMPLETE')) {
      throw new Error(`[${label}] [deploy] 未全勾未得 SMOKE_DEPLOY_TASKS_INCOMPLETE：${tasksRejected.stderr.slice(0, 160)}`);
    }

    // ③ archive 三级链条：缺 VERIFY_PASS / 缺 DEPLOY_DONE / 缺 SMOKE_PASS 各自拒绝且零副作用
    const p3 = initOrphanProject(entry, join(work, `p-${label}-archive`), {});
    rmSync(join(p3.proposalDir, 'VERIFY_PASS'));
    const noVerify = run(entry, ['archive', p3.slug], p3.dir);
    if (!noVerify.stderr.includes('ARCHIVE_VERIFY_NOT_PASSED')) {
      throw new Error(`[${label}] 缺 VERIFY_PASS 未得 ARCHIVE_VERIFY_NOT_PASSED：${noVerify.stderr.slice(0, 160)}`);
    }
    writeFileSync(join(p3.proposalDir, 'VERIFY_PASS'), '');
    writeFileSync(join(p3.proposalDir, 'SMOKE_PASS'), '');
    const noDeploy = run(entry, ['archive', p3.slug], p3.dir);
    if (!noDeploy.stderr.includes('ARCHIVE_DEPLOY_NOT_DONE')) {
      throw new Error(`[${label}] 缺 DEPLOY_DONE 未得 ARCHIVE_DEPLOY_NOT_DONE（SMOKE_PASS 不得反推部署完成）`);
    }
    if (!existsSync(p3.proposalDir)) throw new Error(`[${label}] archive 拒绝后提案目录被移动`);
    if (!existsSync(join(p3.dir, 'logos', '.openlogos-guard'))) throw new Error(`[${label}] archive 拒绝后 guard 被删`);
    rmSync(join(p3.proposalDir, 'SMOKE_PASS'));
    writeFileSync(join(p3.proposalDir, 'DEPLOY_DONE'), '');
    const noSmoke = run(entry, ['archive', p3.slug], p3.dir);
    if (!noSmoke.stderr.includes('ARCHIVE_SMOKE_NOT_PASSED')) {
      throw new Error(`[${label}] 缺 SMOKE_PASS 未得 ARCHIVE_SMOKE_NOT_PASSED`);
    }

    // ④ state_inconsistency 投影在场（status 与 next 均携带，且不写 DEPLOY_DONE）
    const statusJson = JSON.parse(run(entry, ['status', '--format', 'json'], p.dir, false).stdout);
    const activeChangeProjection = (statusJson.data.modules ?? [])
      .map(m => m.active_change).find(Boolean)?.state_inconsistency;
    if (!activeChangeProjection || activeChangeProjection.kind !== 'deploy_done_missing_with_downstream_evidence') {
      throw new Error(`[${label}] status 缺 state_inconsistency 投影`);
    }
    if (activeChangeProjection.remediation !== 'openlogos deploy-done') {
      throw new Error(`[${label}] 投影 remediation 漂移：${activeChangeProjection.remediation}`);
    }
    const nextJson = JSON.parse(run(entry, ['next', '--format', 'json'], p.dir, false).stdout);
    const nextModule = (nextJson.data.modules ?? [])[0] ?? {};
    if (!nextModule.state_inconsistency) throw new Error(`[${label}] next 缺 state_inconsistency 投影`);
    if (!String(nextModule.detail || '').includes('openlogos deploy-done')) {
      throw new Error(`[${label}] next 人读引导缺对账建议行`);
    }
    if (existsSync(join(p.proposalDir, 'DEPLOY_DONE'))) {
      throw new Error(`[${label}] status/next 违反唯一 writer 不变量，代写了 DEPLOY_DONE`);
    }

    // ⑤ 补标后全链放行：deploy-done → smoke 正常执行 → 投影消失
    run(entry, ['deploy-done'], p.dir, false);
    if (!existsSync(join(p.proposalDir, 'DEPLOY_DONE'))) throw new Error(`[${label}] deploy-done 未落标`);
    const smokeAfter = run(entry, ['smoke'], p.dir);
    if (!existsSync(join(p.dir, 'smoke-command-ran.txt'))) {
      throw new Error(`[${label}] 补标后 smoke.command 未执行（exit ${smokeAfter.status}）`);
    }
    const healed = JSON.parse(run(entry, ['status', '--format', 'json'], p.dir, false).stdout);
    const healedProjection = (healed.data.modules ?? [])
      .map(m => m.active_change).find(Boolean)?.state_inconsistency;
    if (healedProjection !== undefined) throw new Error(`[${label}] 补标后投影未消失`);
  };
  verifyFixes(candidate.entry, 'candidate');
  evidence.push('smoke/archive fail-closed 拒绝矩阵 + 对账投影在场 + 补标后全链放行 通过');

  // ⑥ 0.14.24 对照：缺陷必须复现（smoke 照常执行、archive 照常成功、无投影字段）
  const rollback = installPrefix(rollbackTarball, 'rollback');
  const rollbackVersion = run(rollback.entry, ['--version'], repoRoot, false).stdout.trim();
  if (rollbackVersion !== ROLLBACK_VERSION) throw new Error(`回滚版本漂移：${rollbackVersion}`);
  const contrast = initOrphanProject(rollback.entry, join(work, 'p-contrast'), { smokePass: true });
  const oldSmoke = run(rollback.entry, ['smoke'], contrast.dir);
  if (!existsSync(join(contrast.dir, 'smoke-command-ran.txt'))) {
    throw new Error(`对照空转：0.14.24 缺 DEPLOY_DONE 时 smoke.command 未执行（exit ${oldSmoke.status}），矩阵必须重写`);
  }
  const oldStatus = JSON.parse(run(rollback.entry, ['status', '--format', 'json'], contrast.dir, false).stdout);
  const oldProjection = (oldStatus.data.modules ?? []).map(m => m.active_change).find(Boolean)?.state_inconsistency;
  if (oldProjection !== undefined) throw new Error('对照空转：0.14.24 竟已输出 state_inconsistency 投影，矩阵必须重写');
  const contrastArchive = initOrphanProject(rollback.entry, join(work, 'p-contrast-archive'), {});
  rmSync(join(contrastArchive.proposalDir, 'VERIFY_PASS'));
  const oldArchive = run(rollback.entry, ['archive', contrastArchive.slug], contrastArchive.dir);
  if (oldArchive.status !== 0 || existsSync(contrastArchive.proposalDir)) {
    throw new Error('对照空转：0.14.24 竟拒绝了缺 VERIFY_PASS 的归档，矩阵必须重写');
  }
  const archivedDir = join(contrastArchive.dir, 'logos', 'changes', 'archive');
  if (!existsSync(archivedDir) || readdirSync(archivedDir).length === 0) {
    throw new Error('对照异常：0.14.24 归档未落到 archive 目录');
  }
  evidence.push('0.14.24 对照有效：smoke 照常执行、archive 照常成功、无投影字段（缺陷复现）');

  // ⑦ roundtrip
  const restored = installPrefix(tarball, 'restore');
  const restoredVersion = run(restored.entry, ['--version'], repoRoot, false).stdout.trim();
  if (restoredVersion !== EXPECTED_VERSION) throw new Error('roundtrip 恢复失败');
  verifyFixes(restored.entry, 'roundtrip');
  evidence.push(`roundtrip ${ROLLBACK_VERSION}→${EXPECTED_VERSION} 无混装且结论不变`);

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
