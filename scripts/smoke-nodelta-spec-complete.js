#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

function writeSmoke(id, status, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = { id, status, timestamp: new Date().toISOString(), scenario: 'no-delta spec-complete' };
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
  const raw = `${result.stdout}\n${result.stderr}`;
  const line = raw.split('\n').find(item => item.trim().startsWith('{'));
  if (!line) throw new Error(`missing JSON envelope: ${raw.slice(0, 500)}`);
  return JSON.parse(line);
}

function withTempProject(prefix, fn) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scaffoldLaunchedProject(root, slug, proposalOverview) {
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
  mkdirSync(join(root, 'logos/changes', slug), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({
    name: 'nodelta-smoke-fixture',
    locale: 'zh',
    documents: {},
    smoke: {
      result_path: 'logos/resources/verify/smoke-results.jsonl',
      report_path: 'logos/resources/verify/smoke-report.md',
      command: 'node scripts/run-smoke.js',
      sandbox_mode: 'off',
    },
  }, null, 2));
  writeFileSync(join(root, 'logos/logos-project.yaml'), [
    'project:',
    '  name: nodelta-smoke-fixture',
    'modules:',
    '  - id: core',
    '    name: Core',
    '    lifecycle: launched',
  ].join('\n'));
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({
    activeChange: slug,
    module: 'core',
    createdAt: '2026-07-07T00:00:00.000Z',
  }));
  writeFileSync(join(root, 'logos/changes', slug, 'proposal.md'), [
    `# 变更提案：${slug}`,
    '',
    '## 变更原因',
    '修复既有 CLI 行为。',
    '',
    '## 变更类型',
    '代码级修复',
    '',
    '## 部署影响',
    '- 是否需要部署：否',
    '- 部署原因：临时 smoke fixture',
    '- 影响环境：无',
    '- 是否涉及数据迁移：否',
    '- 是否需要回滚预案：否',
    '- 是否需要 smoke：否',
    '',
    '## 变更概述',
    proposalOverview,
  ].join('\n'));
  writeFileSync(join(root, 'logos/changes', slug, 'tasks.md'), [
    '# 实现任务',
    '',
    '## [code] 代码实现',
    '- [ ] [切片清单占位]',
  ].join('\n'));
}

function noDeltaMergeReachesPlanSlices() {
  return withTempProject('openlogos-nodelta-smoke-09-', root => {
    const slug = 'pure-code-fix';
    scaffoldLaunchedProject(root, slug, '需要代码实现，覆盖 UT-S32-11 与 ST-S32-EX-3。');

    const merge = runCli(root, ['merge', slug]);
    if (merge.status !== 0) throw new Error(merge.stderr || merge.stdout || 'merge failed');

    const markerPath = join(root, 'logos/changes', slug, 'SPEC_MERGED');
    if (!existsSync(markerPath)) throw new Error('SPEC_MERGED was not written');
    const marker = JSON.parse(readFileSync(markerPath, 'utf-8'));
    if (marker.type !== 'no_delta_spec_complete') {
      throw new Error(`unexpected marker: ${JSON.stringify(marker)}`);
    }

    const next = runCli(root, ['next', '--format', 'json']);
    if (next.status !== 0) throw new Error(next.stderr || next.stdout || 'next failed');
    const data = parseEnvelope(next).data;
    const mod = data.modules?.[0] ?? data;
    if (mod.proposal_step !== 'ready-to-implement') {
      throw new Error(`unexpected proposal_step: ${JSON.stringify(mod)}`);
    }
    if (mod.next_node?.id !== 'plan-slices') {
      throw new Error(`expected plan-slices next_node: ${JSON.stringify(mod.next_node)}`);
    }
    if (mod.next_node?.gate_id) {
      throw new Error(`plan-slices frontier must not carry gate_id before slices are written: ${JSON.stringify(mod.next_node)}`);
    }
  });
}

function missingTestIdsDoNotDispatchSlicePlanner() {
  return withTempProject('openlogos-nodelta-smoke-10-', root => {
    const slug = 'missing-test-ids';
    scaffoldLaunchedProject(root, slug, '需要 CLI 状态派生代码实现。');
    writeFileSync(join(root, 'logos/changes', slug, 'SPEC_MERGED'), JSON.stringify({
      type: 'no_delta_spec_complete',
      reason: 'pure-code proposal has no spec delta',
      completed_at: '2026-07-07T00:00:00.000Z',
    }, null, 2));

    const next = runCli(root, ['next', '--format', 'json']);
    if (next.status !== 0) throw new Error(next.stderr || next.stdout || 'next failed');
    const data = parseEnvelope(next).data;
    const mod = data.modules?.[0] ?? data;
    if (mod.proposal_step !== 'test-id-required') {
      throw new Error(`unexpected proposal_step: ${JSON.stringify(mod)}`);
    }
    if (mod.reason !== 'code_change_requires_real_test_ids') {
      throw new Error(`unexpected reason: ${JSON.stringify(mod)}`);
    }
    if (mod.next_node?.id === 'plan-slices') {
      throw new Error(`must not dispatch plan-slices without test IDs: ${JSON.stringify(mod.next_node)}`);
    }
    if (existsSync(join(root, 'logos/changes', slug, 'SLICES_APPROVED'))) {
      throw new Error('SLICES_APPROVED must not be written');
    }
  });
}

const cases = [
  ['SMOKE-core-09', noDeltaMergeReachesPlanSlices],
  ['SMOKE-core-10', missingTestIdsDoNotDispatchSlicePlanner],
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
