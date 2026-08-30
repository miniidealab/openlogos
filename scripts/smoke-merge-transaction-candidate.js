#!/usr/bin/env node
/**
 * SMOKE-core-141..156 — OpenLogos 0.14.0 本机全局候选与消费者合同接缝。
 * 只消费部署阶段冻结的本地制品/绝对命令，不执行 publish、Git、Release 或远程部署。
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { validateRunLogosCandidateEvidence } from './lib/runlogos-candidate-evidence.mjs';

export const MERGE_TRANSACTION_SMOKE_IDS = Array.from({ length: 10 }, (_, index) => `SMOKE-core-${141 + index}`);
export const MERGE_TRANSACTION_CONSUMER_SMOKE_IDS = Array.from({ length: 6 }, (_, index) => `SMOKE-core-${151 + index}`);
const EXPECTED_VERSION = '0.14.0';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: [...MERGE_TRANSACTION_SMOKE_IDS, ...MERGE_TRANSACTION_CONSUMER_SMOKE_IDS],
    candidate_version: EXPECTED_VERSION,
    required_env: [
      'OPENLOGOS_MERGE_TRANSACTION_TARBALL', 'OPENLOGOS_MERGE_TRANSACTION_ROLLBACK_TARBALL',
      'OPENLOGOS_CANDIDATE_BIN', 'OPENLOGOS_RUNLOGOS_VERIFY_COMMAND',
      'OPENLOGOS_RUNLOGOS_CONSUMER_COMMAND', 'OPENLOGOS_STACKED_CHANGE_EVIDENCE',
    ],
    required_paths: [
      'spec/schema/merge-transaction.schema.json', 'spec/schema/status.schema.json', 'spec/schema/next.schema.json',
      'skills/merge-executor/SKILL.md', 'skills/merge-executor/SKILL.en.md',
      'dist/lib/merge-transaction-semantic.js', 'dist/lib/merge-transaction-candidate.js',
      'spec/golden/merge-transaction-completed.json',
    ],
    public_release_commands: [],
  }));
  process.exit(0);
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const requiredFile = name => {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}`);
  const path = realpathSync(resolve(value));
  if (!existsSync(path)) throw new Error(`${name} 不存在：${path}`);
  return path;
};
const candidate = requiredFile('OPENLOGOS_MERGE_TRANSACTION_TARBALL');
const rollback = requiredFile('OPENLOGOS_MERGE_TRANSACTION_ROLLBACK_TARBALL');
const candidateCommand = resolve(process.env.OPENLOGOS_CANDIDATE_BIN);
const candidateBin = requiredFile('OPENLOGOS_CANDIDATE_BIN');
const packageRoot = realpathSync(join(dirname(candidateBin), '..'));
const packagedPaths = [
  'spec/schema/merge-transaction.schema.json', 'spec/schema/status.schema.json', 'spec/schema/next.schema.json',
  'skills/merge-executor/SKILL.md', 'skills/merge-executor/SKILL.en.md',
  'dist/lib/merge-transaction-semantic.js', 'dist/lib/merge-transaction-candidate.js',
  'spec/golden/merge-transaction-completed.json',
];

function run(command, args, cwd = repoRoot, env = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 600_000 });
}
function checked(result, label) {
  if (result.error || result.status !== 0) throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  return result.stdout.trim();
}
function report(id, status, startedAt, evidence, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify({
    id, status, timestamp: new Date().toISOString(), duration_ms: Date.now() - startedAt,
    environment: 'local-global-merge-transaction', candidate_tarball_sha256: hash(readFileSync(candidate)),
    rollback_tarball_sha256: hash(readFileSync(rollback)), global_entry_realpath: candidateBin,
    evidence: evidence ? [evidence] : [],
    ...(error ? { error: String(error instanceof Error ? error.message : error).slice(0, 2000) } : {}),
  })}\n`);
}
async function smoke(id, action) {
  const startedAt = Date.now();
  try { const evidence = await action(); report(id, 'pass', startedAt, JSON.stringify(evidence)); console.log(`✓ ${id}`); }
  catch (error) { report(id, 'fail', startedAt, null, error); console.error(`✗ ${id}: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}

const version = () => checked(run(candidateBin, ['--version']), 'openlogos --version');
const transactionHelp = () => readFileSync(join(packageRoot, 'dist/index.js'), 'utf8').includes("args[1] === 'transaction'");
const candidateFacts = () => ({
  schema: 'openlogos/merge-transaction-candidate@1',
  command_path: candidateBin,
  cli_version: version(),
  candidate_tarball_sha256: hash(readFileSync(candidate)),
  merge_transaction_schema_sha256: hash(readFileSync(join(packageRoot, 'spec/schema/merge-transaction.schema.json'))),
  status_schema_sha256: hash(readFileSync(join(packageRoot, 'spec/schema/status.schema.json'))),
  next_schema_sha256: hash(readFileSync(join(packageRoot, 'spec/schema/next.schema.json'))),
  contract_sha256: hash(readFileSync(join(packageRoot, 'spec/cli-json-output.md'))),
  semantic_validator: 'openlogos/merge-transaction-semantic@1',
});
function assertSameFacts(actual, label) {
  const expected = candidateFacts();
  for (const [key, value] of Object.entries(expected)) {
    if (actual?.[key] !== value) throw new Error(`${label} candidate fact 漂移：${key}`);
  }
}

await smoke('SMOKE-core-141', async () => {
  if (version() !== EXPECTED_VERSION) throw new Error(`候选版本不是 ${EXPECTED_VERSION}`);
  return { candidate_bin: candidateBin, version: EXPECTED_VERSION };
});
await smoke('SMOKE-core-142', async () => {
  const hashes = Object.fromEntries(packagedPaths.map(path => [path, hash(readFileSync(join(packageRoot, path)))]));
  if (!transactionHelp()) throw new Error('安装态缺 merge transaction 命令入口');
  return { paths: hashes, candidate: candidateFacts() };
});

// 143～149 必须由部署阶段生成的真实 CLI fixture harness 执行；它接收冻结的全局命令，
// 每个 case 都在独立临时项目中走 slot→seal→apply/recover，不能预造正式 target/marker。
for (const id of MERGE_TRANSACTION_SMOKE_IDS.slice(2, 9)) {
  await smoke(id, async () => {
    const harness = process.env.OPENLOGOS_MERGE_TRANSACTION_FIXTURE_HARNESS
      ? requiredFile('OPENLOGOS_MERGE_TRANSACTION_FIXTURE_HARNESS')
      : realpathSync(join(repoRoot, 'scripts/merge-transaction-smoke-fixtures.js'));
    const output = checked(run(process.execPath, [harness, '--case', id, '--openlogos', candidateBin], repoRoot, {
      ...process.env, OPENLOGOS_CANDIDATE_TARBALL: candidate, OPENLOGOS_ROLLBACK_TARBALL: rollback,
    }), `${id} 真实 transaction fixture`);
    const result = JSON.parse(output);
    if (result.id !== id || result.status !== 'pass' || result.precreated_completed === true) throw new Error(`${id} fixture 证据无效`);
    return result;
  });
}

for (const id of MERGE_TRANSACTION_CONSUMER_SMOKE_IDS.slice(0, 4)) {
  await smoke(id, async () => {
    const harness = process.env.OPENLOGOS_MERGE_TRANSACTION_FIXTURE_HARNESS
      ? requiredFile('OPENLOGOS_MERGE_TRANSACTION_FIXTURE_HARNESS')
      : realpathSync(join(repoRoot, 'scripts/merge-transaction-smoke-fixtures.js'));
    const output = checked(run(process.execPath, [harness, '--case', id, '--openlogos', candidateBin], repoRoot, {
      ...process.env, OPENLOGOS_CANDIDATE_TARBALL: candidate, OPENLOGOS_ROLLBACK_TARBALL: rollback,
    }), `${id} 消费者合同 fixture`);
    const result = JSON.parse(output);
    if (result.id !== id || result.status !== 'pass' || result.precreated_completed === true) throw new Error(`${id} fixture 证据无效`);
    return result;
  });
}

await smoke('SMOKE-core-155', async () => {
  const command = process.env.OPENLOGOS_RUNLOGOS_CONSUMER_COMMAND;
  if (!command) throw new Error('缺少 OPENLOGOS_RUNLOGOS_CONSUMER_COMMAND');
  const facts = candidateFacts();
  const output = checked(run('/bin/sh', ['-c', command], repoRoot, {
    ...process.env,
    OPENLOGOS_CANDIDATE_BIN: candidateCommand,
    OPENLOGOS_CANDIDATE_VERSION: EXPECTED_VERSION,
    OPENLOGOS_CANDIDATE_TARBALL_SHA256: facts.candidate_tarball_sha256,
    OPENLOGOS_CANDIDATE_FACTS: JSON.stringify(facts),
  }), 'RunLogos 修正消费者合同 E2E');
  const evidence = JSON.parse(output);
  validateRunLogosCandidateEvidence(evidence, {
    commandPath: candidateCommand,
    tarballSha256: facts.candidate_tarball_sha256,
  });
  return {
    candidate: facts,
    receipt_summary: evidence.scenarios.map(item => ({
      scenario: item.scenario,
      transaction_identity_hash: item.transaction_identity_hash,
      final_path_count: item.final_path_count,
      artifact_path_count: item.artifact_path_count,
      commit_path_count: item.commit_path_count,
      apply_count: item.apply_count,
    })),
    public_contract_only: true,
  };
});

await smoke('SMOKE-core-156', async () => {
  const evidencePath = requiredFile('OPENLOGOS_STACKED_CHANGE_EVIDENCE');
  const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const expectedNewIds = MERGE_TRANSACTION_CONSUMER_SMOKE_IDS;
  if (evidence.old?.smoke_id !== 'SMOKE-core-150'
    || JSON.stringify(evidence.followup?.smoke_ids) !== JSON.stringify(expectedNewIds)
    || !evidence.old?.slug || !evidence.followup?.slug || evidence.old.slug === evidence.followup.slug) {
    throw new Error('stacked slug 的 smoke ID 或 slug 归属无效');
  }
  const oldArchive = evidence.old?.archive_path ? realpathSync(resolve(evidence.old.archive_path)) : null;
  const oldMarker = evidence.old?.marker_path ? realpathSync(resolve(evidence.old.marker_path)) : null;
  if (!oldArchive || !oldMarker || !oldArchive.endsWith(`-${evidence.old.slug}`)
    || !oldMarker.startsWith(`${oldArchive}/`) || !oldMarker.endsWith('/SMOKE_PASS')) {
    throw new Error('old archive/SMOKE_PASS 归属无效');
  }
  const followupGuard = evidence.followup?.guard_path ? realpathSync(resolve(evidence.followup.guard_path)) : null;
  const followupMarker = evidence.followup?.marker_path ? realpathSync(resolve(evidence.followup.marker_path)) : null;
  const expectedGuard = realpathSync(join(repoRoot, 'logos/.openlogos-guard'));
  const expectedChangeRoot = realpathSync(join(repoRoot, 'logos/changes', evidence.followup.slug));
  if (followupGuard !== expectedGuard || !readFileSync(followupGuard, 'utf8').includes(evidence.followup.slug)
    || !followupMarker || !followupMarker.startsWith(`${expectedChangeRoot}/`)) {
    throw new Error('followup guard/marker 归属无效');
  }
  for (const side of ['old', 'followup']) {
    if (evidence[side].candidate_tarball_sha256 !== candidateFacts().candidate_tarball_sha256) {
      throw new Error(`${side} candidate hash 漂移`);
    }
  }
  return {
    old_slug: evidence.old.slug,
    followup_slug: evidence.followup.slug,
    old_smoke_id: evidence.old.smoke_id,
    followup_smoke_ids: evidence.followup.smoke_ids,
    evidence_only: true,
  };
});

await smoke('SMOKE-core-150', async () => {
  const command = process.env.OPENLOGOS_RUNLOGOS_VERIFY_COMMAND;
  if (!command) throw new Error('缺少 OPENLOGOS_RUNLOGOS_VERIFY_COMMAND');
  const result = run('/bin/sh', ['-c', command], repoRoot, {
    ...process.env, OPENLOGOS_CANDIDATE_BIN: candidateCommand,
    OPENLOGOS_CANDIDATE_VERSION: EXPECTED_VERSION,
    OPENLOGOS_CANDIDATE_TARBALL_SHA256: hash(readFileSync(candidate)),
  });
  const output = checked(result, 'RunLogos 真实跨仓 E2E');
  return validateRunLogosCandidateEvidence(JSON.parse(output), {
    commandPath: candidateCommand,
    tarballSha256: hash(readFileSync(candidate)),
  });
});

process.exit(process.exitCode ?? 0);
