#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const runnerPattern = /^smoke-.+\.(?:sh|js|mjs|cjs)$/;
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'logos']);
const resultPath = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!ignoredDirs.has(entry)) files.push(...walk(full));
      continue;
    }
    if (stat.isFile()) files.push(full);
  }
  return files;
}

function discoverRunners() {
  return walk(root)
    .map(file => relative(root, file).replace(/\\/g, '/'))
    .filter(file => file.split('/').includes('scripts'))
    .filter(file => runnerPattern.test(basename(file)))
    .filter(file => file !== 'scripts/run-smoke.js')
    .sort();
}

function commandFor(runner) {
  const scriptsIndex = runner.split('/').lastIndexOf('scripts');
  const baseDir = scriptsIndex <= 0 ? '.' : runner.split('/').slice(0, scriptsIndex).join('/');
  const runnerFromBase = scriptsIndex <= 0 ? runner : runner.split('/').slice(scriptsIndex).join('/');
  if (runner.endsWith('.sh')) return { command: 'bash', args: [runnerFromBase], cwd: join(root, baseDir) };
  return { command: 'node', args: [runnerFromBase], cwd: join(root, baseDir) };
}

const runners = discoverRunners();
if (runners.length === 0) {
  console.error('No smoke runners found. Expected files matching scripts/smoke-*.sh or scripts/smoke-*.js.');
  process.exit(1);
}

let failed = false;
for (const runner of runners) {
  const { command, args, cwd } = commandFor(runner);
  console.log(`Running ${runner}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENLOGOS_SMOKE_RESULT_PATH: resultPath,
    },
  });
  if (result.status !== 0) failed = true;
}

process.exit(failed ? 1 : 0);
