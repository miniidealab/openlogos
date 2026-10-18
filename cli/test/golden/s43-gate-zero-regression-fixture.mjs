/**
 * UT-S43-14（environment-promotion-approval 切片 2）零回归夹具：未配置晋级与审批门禁的三种项目上，执行
 * deploy（版本通道）/ deploy-done / smoke（有 / 无活跃提案）/ status / env list / env show，记录规范化后的输出、
 * 退出码、账本字节与提案目录文件。与 ST-S41-05 的夹具相比，增加 openlogos deploy 的版本通道部署。
 *
 * 本文件是夹具的唯一定义点：基线生成（引入本提案前的 0.16.4 CLI）与测试（当前 CLI）调用同一函数，
 * 保证比较的是同一输入。见 test/golden/README.md「s43-gate-zero-regression-baseline.json」。
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SLUG = 'ship-it';
const RESULT_REL = 'logos/resources/verify/smoke-results.jsonl';
const LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
const R1 = '1'.repeat(40);
const REGISTRY_PLAIN = 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test, aliases: [测试]}\n  - {id: prod, name: Production, tier: prod, aliases: [生产]}\n';
const REGISTRY_DEPLOY = [
  'schema_version: 1', 'environments:',
  '  - {id: staging, name: Staging, tier: staging, deploy: {mode: script, script: deploy/staging.sh}}',
  '  - {id: prod, name: Production, tier: prod, aliases: [生产], deploy: {mode: script, script: deploy/prod.sh}}', '',
].join('\n');
const RUNNER = `
const fs = require('fs'); const path = require('path');
const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;
const out = 'logos/resources/verify/smoke-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
const rows = ['SMOKE-core-01', 'SMOKE-core-02'].map(id => ({ id, status: 'pass', timestamp: '2026-10-15T00:00:00.000Z', target_environment: env ?? 'none' }));
fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\\n') + '\\n');
`;
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: '2026-10-15T00:00:00Z',
  GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_DATE: '2026-10-15T00:00:00Z',
};
const COMMON = { slug: null, recorded_at: '2026-10-15T01:00:00.000Z', observed_head: R1, observed_dirty: false };
/** openlogos deploy 写出的成功记录（部署执行已启用的账本证据）。 */
const EXEC_DEPLOY = {
  kind: 'deploy', environment: 'prod', ...COMMON, deploy_id: 'd-exec-1', ref: R1, ref_source: 'explicit', result: 'done',
  channel: 'version', mode: 'script', ref_input: 'v1', ref_requested: R1, rollback: false, rollback_from: null, duration_ms: 900,
  ci_run_id: null, ci_run_url: null, ci_reported_ref: null, failure_reason: null, log_path: null, reconciled: false,
};

/** 未配置门禁的三种夹具。 */
export const FIXTURES = [
  { name: 'no-registry', registry: null, ledger: null, commands: 'full' },
  { name: 'registry-without-gates', registry: REGISTRY_PLAIN, ledger: null, commands: 'full' },
  { name: 'deploy-enabled-without-gates', registry: REGISTRY_DEPLOY, ledger: [EXEC_DEPLOY], commands: 'full' },
];

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/** 夹具项目：活跃提案已 verify、需部署需 smoke；登记表与账本按夹具给出。 */
function buildProject(root, fixture) {
  put(root, 'logos/logos.config.json', JSON.stringify({
    name: 'fixture', locale: 'en',
    documents: { test: { label: { en: 'Test' }, path: './resources/test', pattern: '**/*.md' } },
    smoke: { result_path: RESULT_REL, sandbox_mode: 'off', command: 'node tools/runner.js' },
  }, null, 2));
  put(root, 'logos/logos-project.yaml', [
    'modules:', '  - id: core', '    name: Core', '    lifecycle: launched',
    'deployment_gates:', '  core:', '    deployment_required: true', '    smoke_required: true', '',
  ].join('\n'));
  put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | a |\n| SMOKE-core-02 | b |\n');
  put(root, 'tools/runner.js', RUNNER);
  put(root, 'deploy/prod.sh', '#!/bin/sh\nexit 0\n');
  put(root, 'deploy/staging.sh', '#!/bin/sh\nexit 0\n');
  chmodSync(join(root, 'deploy/prod.sh'), 0o755);
  chmodSync(join(root, 'deploy/staging.sh'), 0o755);
  put(root, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nok\n');
  if (fixture.registry) put(root, 'logos/environments.yaml', fixture.registry);
  put(root, `logos/changes/${SLUG}/proposal.md`, [
    '# 变更提案：ship-it', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：生产',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
  ].join('\n'));
  put(root, `logos/changes/${SLUG}/tasks.md`, ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n'));
  put(root, `logos/changes/${SLUG}/VERIFY_PASS`, '');
  put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core', createdAt: '2026-10-15T00:00:00.000Z' }));
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  if (fixture.ledger) put(root, LEDGER_REL, fixture.ledger.map(r => JSON.stringify(r)).join('\n') + '\n');
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture']);
}

/** 平台默认沙箱根的可能取值（sandbox.ts defaultSandboxRoot：darwin 为 /private/tmp，其余为 os.tmpdir()）。 */
const DEFAULT_SANDBOX_ROOTS = new Set(['/private/tmp', tmpdir(), realpathSync(tmpdir())]);

/** 规范化：去掉随调用或构建变化的值（时间、UUID、临时路径、CLI 版本、耗时、资产哈希），commit 按首次出现顺序编号。 */
function normalizer(root) {
  const commits = new Map();
  const roots = [root, realpathSync(root)];
  return text => {
    let out = text;
    for (const r of roots) out = out.split(r).join('<ROOT>');
    // 平台默认沙箱根（darwin 为 /private/tmp，其余为 os.tmpdir()）是宿主环境事实，不进基线
    out = out.replace(/"root":"([^"]*)"/g, (m, v) => (DEFAULT_SANDBOX_ROOTS.has(v) ? '"root":"<SANDBOX_ROOT>"' : m));
    out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TIME>');
    out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>');
    out = out.replace(/\b[0-9a-f]{64}\b/g, '<SHA256>');
    out = out.replace(/\b[0-9a-f]{40}\b/g, c => {
      if (!commits.has(c)) commits.set(c, `<COMMIT-${commits.size + 1}>`);
      return commits.get(c);
    });
    out = out.replace(/"(duration_ms|elapsed_ms|durationMs)":\s*\d+/g, '"$1":"<N>"');
    return out;
  };
}

function envelope(raw, norm) {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  try {
    const parsed = JSON.parse(trimmed);
    delete parsed.version;
    delete parsed.timestamp;
    return JSON.parse(norm(JSON.stringify(parsed)));
  } catch {
    return norm(trimmed);
  }
}

/**
 * 在全部夹具上执行既有命令，返回可逐字比较的观测结果。
 * @param {string} cliEntry  CLI 入口（dist/index.js）
 */
export function observeDeployGateFixtures(cliEntry) {
  const result = {};
  for (const fixture of FIXTURES) {
    const root = mkdtempSync(join(tmpdir(), 'ol-s43-gate-zero-'));
    try {
      buildProject(root, fixture);
      const norm = normalizer(root);
      const run = args => {
        const r = spawnSync(process.execPath, [cliEntry, ...args], {
          cwd: root, encoding: 'utf-8', timeout: 120_000,
          env: { ...process.env, ...GIT_ENV, OPENLOGOS_SMOKE_ENV: '', NO_COLOR: '1' },
        });
        return { args: args.join(' '), exit: r.status, stdout: envelope(r.stdout ?? '', norm), stderr: envelope(r.stderr ?? '', norm) };
      };
      const steps = [];
      if (fixture.commands === 'full') {
        const env = fixture.registry ? ['--env', 'prod'] : [];
        steps.push(run(['deploy', '--env', 'prod', '--ref', 'HEAD', '--channel', 'version', '--format', 'json']));
        steps.push(run(['deploy-done', ...env, ...(fixture.registry ? ['--ref', 'HEAD'] : []), '--format', 'json']));
        steps.push(run(['smoke', ...env, '--format', 'json']));
        steps.push(run(['status', '--format', 'json']));
        steps.push(run(['env', 'list', '--format', 'json']));
        steps.push(run(['env', 'show', 'prod', '--format', 'json']));
        rmSync(join(root, 'logos/.openlogos-guard'));
        steps.push(run(['smoke', ...env, '--format', 'json']));
        steps.push(run(['env', 'list', '--format', 'json']));
      }
      const proposalDir = join(root, 'logos/changes', SLUG);
      result[fixture.name] = {
        steps,
        ledger: existsSync(join(root, LEDGER_REL)) ? norm(readFileSync(join(root, LEDGER_REL), 'utf-8')) : null,
        proposal_files: readdirSync(proposalDir).sort(),
        deploy_done: existsSync(join(proposalDir, 'DEPLOY_DONE')) ? norm(readFileSync(join(proposalDir, 'DEPLOY_DONE'), 'utf-8')) : null,
        tasks: norm(readFileSync(join(proposalDir, 'tasks.md'), 'utf-8')),
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  return result;
}

// 直接执行：node s43-gate-zero-regression-fixture.mjs <cli-entry> <out.json>（只用于以引入前的 CLI 生成基线）
if (process.argv[1] && process.argv[1].endsWith('s43-gate-zero-regression-fixture.mjs') && process.argv.length >= 4) {
  writeFileSync(process.argv[3], JSON.stringify(observeDeployGateFixtures(process.argv[2]), null, 2) + '\n');
  console.log(`baseline written: ${process.argv[3]}`);
}
