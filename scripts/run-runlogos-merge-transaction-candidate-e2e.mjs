#!/usr/bin/env node

import { cpSync, existsSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const SLUG = 'adopt-openlogos-merge-transaction-authority';
const sourceRepoValue = process.env.OPENLOGOS_RUNLOGOS_REPO;
if (!sourceRepoValue) throw new Error('缺少 OPENLOGOS_RUNLOGOS_REPO');
const sourceRepo = realpathSync(resolve(sourceRepoValue));
const sourceRunner = join(sourceRepo, 'scripts', 'run-openlogos-merge-transaction-candidate-e2e.mjs');
if (!existsSync(sourceRunner)) throw new Error(`RunLogos candidate runner 不存在：${sourceRunner}`);

const archiveRoot = join(sourceRepo, 'logos', 'changes', 'archive');
const archiveNames = readdirSync(archiveRoot)
  .filter(name => name.endsWith(`-${SLUG}`))
  .sort();
const archiveName = archiveNames.at(-1);
if (!archiveName) throw new Error(`RunLogos 归档提案不存在：${SLUG}`);

const bridgeRoot = mkdtempSync(join(tmpdir(), 'openlogos-runlogos-candidate-bridge-'));
const checkout = join(bridgeRoot, 'runlogos');

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result;
}

try {
  checked(spawnSync('git', ['clone', '--quiet', '--no-hardlinks', sourceRepo, checkout], {
    encoding: 'utf8', timeout: 120_000,
  }), '创建 RunLogos 一次性模板副本');
  const archivedChange = join(checkout, 'logos', 'changes', 'archive', basename(archiveName));
  const activeFixture = join(checkout, 'logos', 'changes', SLUG);
  if (!existsSync(archivedChange)) throw new Error(`一次性副本缺归档提案：${archivedChange}`);
  cpSync(archivedChange, activeFixture, { recursive: true });

  const result = checked(spawnSync(process.execPath, [sourceRunner], {
    cwd: checkout,
    env: process.env,
    encoding: 'utf8',
    timeout: 600_000,
    maxBuffer: 8 * 1024 * 1024,
  }), '运行 RunLogos 真实 candidate E2E');
  process.stdout.write(`${result.stdout.trim()}\n`);
} finally {
  rmSync(bridgeRoot, { recursive: true, force: true });
}
