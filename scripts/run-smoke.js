#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const runnerPattern = /^smoke-.+\.(?:sh|js|mjs|cjs)$/;
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'logos']);
const resultPath = resolve(
  root,
  process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl',
);

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

function environmentFor(runner) {
  const env = {
    ...process.env,
    OPENLOGOS_SMOKE_RESULT_PATH: resultPath,
  };
  const hostArtifacts = {
    'scripts/smoke-zcode-staging.js': {
      tarball: process.env.OPENLOGOS_ZCODE_TARBALL,
      previousTarball: process.env.OPENLOGOS_ZCODE_PREVIOUS_TARBALL,
    },
    'scripts/smoke-qoder-staging.js': {
      tarball: process.env.OPENLOGOS_QODER_TARBALL,
      previousTarball: process.env.OPENLOGOS_QODER_PREVIOUS_TARBALL,
    },
    'scripts/smoke-workbuddy-staging.js': {
      tarball: process.env.OPENLOGOS_WORKBUDDY_TARBALL,
      previousTarball: process.env.OPENLOGOS_WORKBUDDY_PREVIOUS_TARBALL,
    },
    'scripts/smoke-trae-local-negative.js': {
      tarball: process.env.OPENLOGOS_TRAE_LOCAL_TARBALL,
      previousTarball: process.env.OPENLOGOS_TRAE_ROLLBACK_TARBALL,
    },
    'scripts/smoke-test-change-set-local-global.js': {
      tarball: process.env.OPENLOGOS_TEST_CHANGE_SET_TARBALL,
      previousTarball: process.env.OPENLOGOS_TEST_CHANGE_SET_ROLLBACK_TARBALL,
    },
    'scripts/smoke-plan-package-convergence.js': {
      tarball: process.env.OPENLOGOS_PLAN_CONVERGENCE_TARBALL,
      previousTarball: process.env.OPENLOGOS_PLAN_CONVERGENCE_ROLLBACK_TARBALL,
    },
    'scripts/smoke-merge-transaction-candidate.js': {
      tarball: process.env.OPENLOGOS_MERGE_TRANSACTION_TARBALL,
      previousTarball: process.env.OPENLOGOS_MERGE_TRANSACTION_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_MERGE_TRANSACTION_CANDIDATE_BIN,
    },
    'scripts/smoke-release-0-14-1-local.js': {
      tarball: process.env.OPENLOGOS_RELEASE_0_14_1_TARBALL,
      previousTarball: process.env.OPENLOGOS_RELEASE_0_14_1_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_RELEASE_0_14_1_CANDIDATE_BIN,
    },
    'scripts/smoke-release-0-14-2-preflight-reopen.js': {
      tarball: process.env.OPENLOGOS_RELEASE_0_14_2_TARBALL,
      previousTarball: process.env.OPENLOGOS_RELEASE_0_14_2_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_RELEASE_0_14_2_CANDIDATE_BIN,
    },
    'scripts/smoke-authority-closure-candidate.js': {
      tarball: process.env.OPENLOGOS_AUTHORITY_CLOSURE_TARBALL,
      previousTarball: process.env.OPENLOGOS_AUTHORITY_CLOSURE_ROLLBACK_TARBALL,
    },
    'scripts/smoke-nested-section-anchor-0-14-4.js': {
      tarball: process.env.OPENLOGOS_NESTED_ANCHOR_TARBALL,
      previousTarball: process.env.OPENLOGOS_NESTED_ANCHOR_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_NESTED_ANCHOR_CANDIDATE_BIN,
    },
    'scripts/smoke-sync-yaml-overlay-0-14-5.js': {
      tarball: process.env.OPENLOGOS_SYNC_YAML_TARBALL,
      previousTarball: process.env.OPENLOGOS_SYNC_YAML_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_SYNC_YAML_CANDIDATE_BIN,
    },
    'scripts/smoke-archived-addressability-0-14-6.js': {
      tarball: process.env.OPENLOGOS_ARCHIVED_ADDR_TARBALL,
      previousTarball: process.env.OPENLOGOS_ARCHIVED_ADDR_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_ARCHIVED_ADDR_CANDIDATE_BIN,
    },
    'scripts/smoke-resource-index-scope-0-14-7.js': {
      tarball: process.env.OPENLOGOS_RESOURCE_INDEX_TARBALL,
      previousTarball: process.env.OPENLOGOS_RESOURCE_INDEX_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_RESOURCE_INDEX_CANDIDATE_BIN,
    },
    'scripts/smoke-plan-gate-deadlock-0-14-8.js': {
      tarball: process.env.OPENLOGOS_PLAN_GATE_TARBALL,
      previousTarball: process.env.OPENLOGOS_PLAN_GATE_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_PLAN_GATE_CANDIDATE_BIN,
    },
    'scripts/smoke-merge-gate-single-source-0-14-9.js': {
      tarball: process.env.OPENLOGOS_MERGE_GATE_TARBALL,
      previousTarball: process.env.OPENLOGOS_MERGE_GATE_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_MERGE_GATE_CANDIDATE_BIN,
    },
    'scripts/smoke-sql-dialect-tiering-0-14-10.js': {
      tarball: process.env.OPENLOGOS_SQL_TIER_TARBALL,
      previousTarball: process.env.OPENLOGOS_SQL_TIER_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_SQL_TIER_CANDIDATE_BIN,
    },
    'scripts/smoke-slice-transaction-0-14-11.js': {
      tarball: process.env.OPENLOGOS_SLICE_TX_TARBALL,
      previousTarball: process.env.OPENLOGOS_SLICE_TX_ROLLBACK_TARBALL,
      candidateBin: process.env.OPENLOGOS_SLICE_TX_CANDIDATE_BIN,
    },
  };
  const artifacts = hostArtifacts[runner];
  if (!artifacts) return env;
  if (artifacts.tarball) env.OPENLOGOS_TARBALL = artifacts.tarball;
  if (artifacts.previousTarball) env.OPENLOGOS_PREVIOUS_TARBALL = artifacts.previousTarball;
  if (artifacts.candidateBin) env.OPENLOGOS_CANDIDATE_BIN = artifacts.candidateBin;
  if (runner === 'scripts/smoke-merge-transaction-candidate.js') {
    if (artifacts.tarball) env.OPENLOGOS_MERGE_TRANSACTION_TARBALL = artifacts.tarball;
    if (artifacts.previousTarball) env.OPENLOGOS_MERGE_TRANSACTION_ROLLBACK_TARBALL = artifacts.previousTarball;
  }
  return env;
}

const globalMutatingRunners = new Set([
  'scripts/smoke-baseline-on-touch.js',
  'scripts/smoke-merge-transaction-candidate.js',
  'scripts/smoke-plan-package-convergence.js',
  'scripts/smoke-test-change-set-local-global.js',
  'scripts/smoke-release-0-14-1-local.js',
  'scripts/smoke-nested-section-anchor-0-14-4.js',
  'scripts/smoke-sync-yaml-overlay-0-14-5.js',
  'scripts/smoke-archived-addressability-0-14-6.js',
  'scripts/smoke-resource-index-scope-0-14-7.js',
  'scripts/smoke-plan-gate-deadlock-0-14-8.js',
  'scripts/smoke-merge-gate-single-source-0-14-9.js',
  'scripts/smoke-sql-dialect-tiering-0-14-10.js',
  'scripts/smoke-slice-transaction-0-14-11.js',
]);

const globalCandidateRunners = new Map([
  ['scripts/smoke-merge-transaction-candidate.js', process.env.OPENLOGOS_MERGE_TRANSACTION_TARBALL],
  ['scripts/smoke-release-0-14-1-local.js', process.env.OPENLOGOS_RELEASE_0_14_1_TARBALL],
  ['scripts/smoke-nested-section-anchor-0-14-4.js', process.env.OPENLOGOS_NESTED_ANCHOR_TARBALL],
  ['scripts/smoke-sync-yaml-overlay-0-14-5.js', process.env.OPENLOGOS_SYNC_YAML_TARBALL],
  ['scripts/smoke-archived-addressability-0-14-6.js', process.env.OPENLOGOS_ARCHIVED_ADDR_TARBALL],
  ['scripts/smoke-resource-index-scope-0-14-7.js', process.env.OPENLOGOS_RESOURCE_INDEX_TARBALL],
  ['scripts/smoke-plan-gate-deadlock-0-14-8.js', process.env.OPENLOGOS_PLAN_GATE_TARBALL],
  ['scripts/smoke-merge-gate-single-source-0-14-9.js', process.env.OPENLOGOS_MERGE_GATE_TARBALL],
  ['scripts/smoke-sql-dialect-tiering-0-14-10.js', process.env.OPENLOGOS_SQL_TIER_TARBALL],
  ['scripts/smoke-slice-transaction-0-14-11.js', process.env.OPENLOGOS_SLICE_TX_TARBALL],
]);

function prepareGlobalCandidate(runner) {
  const tarball = globalCandidateRunners.get(runner);
  if (!tarball) return true;
  const prepared = spawnSync(npmCommand, [
    'install', '-g', '--ignore-scripts', '--no-audit', '--no-fund', resolve(tarball),
  ], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  return prepared.status === 0;
}

function restoreGlobalCandidate(runner) {
  const tarball = process.env.OPENLOGOS_GLOBAL_RESTORE_TARBALL;
  if (!tarball || !globalMutatingRunners.has(runner)) return true;
  const restored = spawnSync(npmCommand, ['install', '-g', resolve(tarball)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  return restored.status === 0;
}

const runners = discoverRunners();
if (runners.length === 0) {
  console.error('No smoke runners found. Expected files matching scripts/smoke-*.sh or scripts/smoke-*.js.');
  process.exit(1);
}

let failed = false;
for (const runner of runners) {
  const { command, args, cwd } = commandFor(runner);
  if (runner === 'website/scripts/smoke-releases.mjs') {
    console.log('正在刷新网站 smoke 构建产物');
    let preparationFailed = false;
    for (const args of [['run', 'generate:releases'], ['exec', '--', 'astro', 'build']]) {
      const build = spawnSync(npmCommand, args, {
        cwd,
        stdio: 'inherit',
        env: process.env,
      });
      if (build.status !== 0) {
        failed = true;
        preparationFailed = true;
        break;
      }
    }
    if (preparationFailed) continue;
  }
  if (!prepareGlobalCandidate(runner)) {
    failed = true;
    continue;
  }
  console.log(`Running ${runner}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: environmentFor(runner),
  });
  if (result.status !== 0) failed = true;
  if (!restoreGlobalCandidate(runner)) failed = true;
}

process.exit(failed ? 1 : 0);
