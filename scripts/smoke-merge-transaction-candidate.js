#!/usr/bin/env node
/**
 * SMOKE-core-141..150 — OpenLogos 0.14.0 本机全局候选与 RunLogos 接缝。
 * 只消费部署阶段冻结的本地制品/绝对命令，不执行 publish、Git、Release 或远程部署。
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { validateRunLogosCandidateEvidence } from './lib/runlogos-candidate-evidence.mjs';

export const MERGE_TRANSACTION_SMOKE_IDS = Array.from({ length: 10 }, (_, index) => `SMOKE-core-${141 + index}`);
const EXPECTED_VERSION = '0.14.0';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: MERGE_TRANSACTION_SMOKE_IDS,
    candidate_version: EXPECTED_VERSION,
    required_env: [
      'OPENLOGOS_MERGE_TRANSACTION_TARBALL', 'OPENLOGOS_MERGE_TRANSACTION_ROLLBACK_TARBALL',
      'OPENLOGOS_CANDIDATE_BIN', 'OPENLOGOS_RUNLOGOS_VERIFY_COMMAND',
    ],
    required_paths: ['spec/schema/merge-transaction.schema.json', 'skills/merge-executor/SKILL.md', 'skills/merge-executor/SKILL.en.md'],
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

await smoke('SMOKE-core-141', async () => {
  if (version() !== EXPECTED_VERSION) throw new Error(`候选版本不是 ${EXPECTED_VERSION}`);
  return { candidate_bin: candidateBin, version: EXPECTED_VERSION };
});
await smoke('SMOKE-core-142', async () => {
  const paths = ['spec/schema/merge-transaction.schema.json', 'skills/merge-executor/SKILL.md', 'skills/merge-executor/SKILL.en.md'];
  const hashes = Object.fromEntries(paths.map(path => [path, hash(readFileSync(join(packageRoot, path)))]));
  if (!transactionHelp()) throw new Error('安装态缺 merge transaction 命令入口');
  return { paths: hashes, tarball_sha256: hash(readFileSync(candidate)) };
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

await smoke('SMOKE-core-150', async () => {
  const command = process.env.OPENLOGOS_RUNLOGOS_VERIFY_COMMAND;
  if (!command) throw new Error('缺少 OPENLOGOS_RUNLOGOS_VERIFY_COMMAND');
  const result = run('/bin/sh', ['-c', command], repoRoot, {
    ...process.env, OPENLOGOS_CANDIDATE_BIN: candidateCommand,
    OPENLOGOS_CANDIDATE_VERSION: EXPECTED_VERSION,
    OPENLOGOS_CANDIDATE_TARBALL_SHA256: hash(readFileSync(candidate)),
  });
  const output = checked(result, 'RunLogos 真实跨仓 E2E');
  return validateRunLogosCandidateEvidence(JSON.parse(output));
});

process.exit(process.exitCode ?? 0);
