#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

function writeSmoke(id, status, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = { id, status, timestamp: new Date().toISOString(), scenario: 'smoke coverage precheck' };
  if (error) record.error = String(error).slice(0, 500);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function cliCommand() {
  if (process.env.OPENLOGOS_BIN) return { command: process.env.OPENLOGOS_BIN, baseArgs: [] };
  const distEntry = join(repoRoot, 'cli/dist/index.js');
  if (existsSync(distEntry)) return { command: process.execPath, baseArgs: [distEntry] };
  return { command: 'npx', baseArgs: ['-y', '@miniidealab/openlogos@latest'] };
}

function runCli(root, args) {
  const cli = cliCommand();
  const env = { ...process.env };
  delete env.OPENLOGOS_SMOKE_RESULT_PATH;
  return spawnSync(cli.command, [...cli.baseArgs, ...args], {
    cwd: root,
    encoding: 'utf-8',
    env,
  });
}

function parseEnvelope(result) {
  const raw = result.stdout.trim() || result.stderr.trim();
  const firstLine = raw.split('\n').find(line => line.trim().startsWith('{'));
  return firstLine ? JSON.parse(firstLine) : null;
}

function withTempProject(prefix, fn) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scaffoldProject(root, slug, smokeId, command = 'node scripts/run-smoke.js') {
  mkdirSync(join(root, 'logos/resources/test/smoke'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  mkdirSync(join(root, 'logos/changes', slug, 'deltas/test/smoke'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({
    name: 'smoke-coverage-fixture',
    locale: 'zh',
    documents: {},
    smoke: {
      result_path: 'logos/resources/verify/smoke-results.jsonl',
      report_path: 'logos/resources/verify/smoke-report.md',
      command,
      sandbox_mode: 'off',
    },
  }, null, 2));
  writeFileSync(join(root, 'logos/logos-project.yaml'), [
    'project:',
    '  name: smoke-coverage-fixture',
    'modules:',
    '  - id: core',
    '    name: Core',
    '    lifecycle: launched',
  ].join('\n'));
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  writeFileSync(join(root, 'logos/resources/test/smoke/core-smoke-test-cases.md'), `| ${smokeId} | temp |\n`);
  writeFileSync(join(root, 'logos/changes', slug, 'deltas/test/smoke/core-smoke-test-cases.md'), `| ${smokeId} | temp |\n`);
}

function smokeRunnerMissingDiagnostic() {
  return withTempProject('openlogos-smoke-runner-missing-', root => {
    scaffoldProject(root, 'add-smoke', 'SMOKE-TEMP-01');
    const result = runCli(root, ['smoke', '--format', 'json']);
    const envelope = parseEnvelope(result);
    if (result.status === 0) throw new Error('smoke unexpectedly passed');
    const data = envelope?.data;
    const codes = data?.diagnostics?.map(item => item.code) ?? [];
    if (!codes.includes('smoke_runner_missing') && !data?.uncovered_cases?.includes('SMOKE-TEMP-01')) {
      throw new Error(`missing runner diagnostic for SMOKE-TEMP-01: ${JSON.stringify(data)}`);
    }
    if (existsSync(join(root, 'logos/changes/add-smoke/SMOKE_PASS'))) {
      throw new Error('SMOKE_PASS should not be written for runner missing case');
    }
  });
}

function smokeReporterMissingDiagnostic() {
  return withTempProject('openlogos-smoke-reporter-missing-', root => {
    scaffoldProject(root, 'add-smoke', 'SMOKE-TEMP-02');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/smoke-temp.js'), 'process.exit(0);\n');

    const result = runCli(root, ['smoke', '--format', 'json']);
    const envelope = parseEnvelope(result);
    if (result.status === 0) throw new Error('smoke unexpectedly passed');
    const data = envelope?.data;
    const codes = data?.diagnostics?.map(item => item.code) ?? [];
    if (!codes.includes('smoke_reporter_missing')) {
      throw new Error(`missing reporter diagnostic: ${JSON.stringify(data)}`);
    }
  });
}

function smokeDispatcherCoveragePasses() {
  return withTempProject('openlogos-smoke-dispatcher-coverage-', root => {
    scaffoldProject(root, 'add-smoke', 'SMOKE-TEMP-03');
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/smoke-temp.js'), [
      "const { appendFileSync, mkdirSync } = require('node:fs');",
      "const { dirname } = require('node:path');",
      "const p = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';",
      "mkdirSync(dirname(p), { recursive: true });",
      "appendFileSync(p, JSON.stringify({ id: 'SMOKE-TEMP-03', status: 'pass', scenario: 'dispatcher coverage' }) + '\\n');",
    ].join('\n'));
    writeFileSync(join(root, 'scripts/run-smoke.js'), readFileSync(join(repoRoot, 'scripts/run-smoke.js'), 'utf-8'));

    const result = runCli(root, ['smoke', '--format', 'json']);
    const envelope = parseEnvelope(result);
    if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'smoke failed');
    const data = envelope?.data;
    if (data?.uncovered_cases?.includes('SMOKE-TEMP-03')) {
      throw new Error('SMOKE-TEMP-03 should be covered');
    }
    if ((data?.diagnostics ?? []).length > 0) {
      throw new Error(`unexpected diagnostics: ${JSON.stringify(data.diagnostics)}`);
    }
  });
}

const cases = [
  ['SMOKE-core-28', smokeRunnerMissingDiagnostic],
  ['SMOKE-core-29', smokeReporterMissingDiagnostic],
  ['SMOKE-core-30', smokeDispatcherCoveragePasses],
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
