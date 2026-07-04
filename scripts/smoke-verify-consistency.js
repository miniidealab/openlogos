#!/usr/bin/env node
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

function writeSmoke(id, status, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = { id, status, timestamp: new Date().toISOString(), scenario: 'verify result consistency' };
  if (error) record.error = String(error).slice(0, 500);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function cliCommand() {
  if (process.env.OPENLOGOS_BIN) {
    return { command: process.env.OPENLOGOS_BIN, baseArgs: [] };
  }
  const distEntry = join(repoRoot, 'cli/dist/index.js');
  if (existsSync(distEntry)) {
    return { command: process.execPath, baseArgs: [distEntry] };
  }
  return { command: 'openlogos', baseArgs: [] };
}

function scaffoldProject(root, caseId, resultLines) {
  mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({
    name: 'verify-consistency-smoke',
    locale: 'zh',
    documents: {},
    verify: {
      result_path: 'logos/resources/verify/test-results.jsonl',
      sandbox_mode: 'auto',
      sandbox_root: '/private/tmp',
      sandbox_deny_workspace_write: true,
    },
  }, null, 2));
  writeFileSync(join(root, 'logos/logos-project.yaml'), 'project:\n  name: verify-consistency-smoke\n');
  writeFileSync(join(root, 'logos/resources/test/core-S13-smoke-test-cases.md'), `| ${caseId} | smoke defined |\n`);
  writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), resultLines.join('\n') + '\n');
}

function runVerify(root) {
  const cli = cliCommand();
  return spawnSync(cli.command, [...cli.baseArgs, 'verify', '--format', 'json'], {
    cwd: root,
    encoding: 'utf-8',
  });
}

function parseEnvelope(result) {
  const raw = result.stdout.trim() || result.stderr.trim();
  const firstLine = raw.split('\n').find(line => line.trim().startsWith('{'));
  return firstLine ? JSON.parse(firstLine) : null;
}

function withTempProject(fn) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-smoke-verify-consistency-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function smokeInvalidStatus() {
  return withTempProject(root => {
    scaffoldProject(root, 'UT-S13-SMOKE-31', [
      '{"id":"UT-S13-SMOKE-31","status":"pass"}',
      '{"id":"UT-S13-SMOKE-31-BAD","status":"unknown"}',
    ]);
    const result = runVerify(root);
    const envelope = parseEnvelope(result);
    if (result.status === 0) throw new Error('verify unexpectedly passed');
    if (envelope?.data?.gate?.result !== 'FAIL') throw new Error('gate did not fail');
    if (!envelope?.data?.consistency?.reasons?.includes('invalid_test_result_status')) {
      throw new Error('missing invalid status consistency reason');
    }
  });
}

function smokeUnknownId() {
  return withTempProject(root => {
    scaffoldProject(root, 'UT-S13-SMOKE-32', [
      '{"id":"UT-S13-SMOKE-32","status":"pass"}',
      '{"id":"UT-S13-GHOST","status":"pass"}',
    ]);
    const result = runVerify(root);
    const envelope = parseEnvelope(result);
    if (result.status === 0) throw new Error('verify unexpectedly passed');
    if (!envelope?.data?.consistency?.unknown_result_ids?.includes('UT-S13-GHOST')) {
      throw new Error('missing unknown result id diagnostic');
    }
  });
}

function smokeLastWriteWins() {
  return withTempProject(root => {
    scaffoldProject(root, 'UT-S13-SMOKE-33', [
      '{"id":"UT-S13-SMOKE-33","status":"fail","error":"old"}',
      '{"id":"UT-S13-SMOKE-33","status":"pass"}',
    ]);
    const result = runVerify(root);
    const envelope = parseEnvelope(result);
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'verify failed');
    if (envelope?.data?.gate?.result !== 'PASS') throw new Error('gate did not pass');
    if (envelope?.data?.summary?.executed_count !== 1) throw new Error('duplicate id was not deduplicated');
  });
}

const cases = [
  ['SMOKE-core-31', smokeInvalidStatus],
  ['SMOKE-core-32', smokeUnknownId],
  ['SMOKE-core-33', smokeLastWriteWins],
];

let failed = false;
for (const [id, fn] of cases) {
  try {
    fn();
    writeSmoke(id, 'pass');
  } catch (error) {
    failed = true;
    writeSmoke(id, 'fail', error);
  }
}

process.exit(failed ? 1 : 0);
