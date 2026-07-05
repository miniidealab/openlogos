#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

function writeSmoke(id, status, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = { id, status, timestamp: new Date().toISOString(), scenario: 'instruction file merge' };
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
  const result = spawnSync(cli.command, [...cli.baseArgs, ...args], {
    cwd: root,
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error([
      `openlogos ${args.join(' ')} failed with exit ${result.status}`,
      result.stdout.trim(),
      result.stderr.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function withTempProject(prefix, fn) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function countManagedBlocks(content) {
  return (content.match(/OPENLOGOS:BEGIN/g) ?? []).length;
}

function assertInstructionFile(root, fileName, userText) {
  const fullPath = join(root, fileName);
  if (!existsSync(fullPath)) throw new Error(`${fileName} was not created`);
  const content = readFileSync(fullPath, 'utf-8');
  if (!content.includes(userText)) throw new Error(`${fileName} lost user content`);
  if (countManagedBlocks(content) !== 1) throw new Error(`${fileName} should contain exactly one OpenLogos managed block`);
  if (!content.includes('OpenLogos')) throw new Error(`${fileName} missing OpenLogos content`);
}

function smokeInitPreservesInstructionFiles() {
  return withTempProject('openlogos-smoke-init-instructions-', root => {
    writeFileSync(join(root, 'AGENTS.md'), 'team agents rule\n');
    writeFileSync(join(root, 'CLAUDE.md'), 'team claude rule\n');
    runCli(root, ['init', 'smoke', '--locale', 'zh', '--ai-tool', 'all']);
    assertInstructionFile(root, 'AGENTS.md', 'team agents rule');
    assertInstructionFile(root, 'CLAUDE.md', 'team claude rule');
  });
}

function smokeSyncIsIdempotent() {
  return withTempProject('openlogos-smoke-sync-instructions-', root => {
    writeFileSync(join(root, 'AGENTS.md'), 'team agents rule\n');
    writeFileSync(join(root, 'CLAUDE.md'), 'team claude rule\n');
    runCli(root, ['init', 'smoke', '--locale', 'zh', '--ai-tool', 'all']);
    runCli(root, ['sync']);
    runCli(root, ['sync']);
    assertInstructionFile(root, 'AGENTS.md', 'team agents rule');
    assertInstructionFile(root, 'CLAUDE.md', 'team claude rule');
  });
}

function smokeAdoptReusesLowercaseInstructionFiles() {
  return withTempProject('openlogos-smoke-adopt-instructions-', root => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-app' }, null, 2));
    writeFileSync(join(root, 'agents.md'), 'lowercase agents rule\n');
    writeFileSync(join(root, 'claude.md'), 'lowercase claude rule\n');
    runCli(root, ['adopt', '--locale', 'zh', '--ai-tool', 'cursor']);

    const entries = readdirSync(root);
    if (!entries.includes('agents.md')) throw new Error('agents.md was not preserved');
    if (!entries.includes('claude.md')) throw new Error('claude.md was not preserved');
    if (entries.includes('AGENTS.md')) throw new Error('AGENTS.md duplicate was created');
    if (entries.includes('CLAUDE.md')) throw new Error('CLAUDE.md duplicate was created');
    assertInstructionFile(root, 'agents.md', 'lowercase agents rule');
    assertInstructionFile(root, 'claude.md', 'lowercase claude rule');
  });
}

const cases = [
  ['SMOKE-core-25', smokeInitPreservesInstructionFiles],
  ['SMOKE-core-26', smokeSyncIsIdempotent],
  ['SMOKE-core-27', smokeAdoptReusesLowercaseInstructionFiles],
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
