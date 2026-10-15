/**
 * UT-S42-16（environment-deploy）零回归夹具：部署执行未启用的两种项目上，执行既有
 * deploy-done / smoke（有 / 无活跃提案）/ status / env list / env show，记录规范化后的输出、退出码、
 * 账本字节与提案目录文件。
 *
 * 本文件是夹具的唯一定义点：基线生成（引入本提案前的 CLI）与测试（当前 CLI）调用同一函数，
 * 保证比较的是同一输入。见 test/golden/README.md「s42-zero-regression-baseline.json」。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SLUG = 'ship-it';
const RESULT_REL = 'logos/resources/verify/smoke-results.jsonl';
const LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
const REGISTRY = 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test, aliases: [测试]}\n  - {id: prod, name: Production, tier: prod, aliases: [生产]}\n';
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

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}

/** 夹具项目：活跃提案已 verify、需部署需 smoke；registry=true 时登记 test / prod（均未配置 deploy）。 */
function buildProject(root, registry) {
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
  put(root, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nok\n');
  if (registry) put(root, 'logos/environments.yaml', REGISTRY);
  put(root, `logos/changes/${SLUG}/proposal.md`, [
    '# 变更提案：ship-it', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：生产',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
  ].join('\n'));
  put(root, `logos/changes/${SLUG}/tasks.md`, ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n'));
  put(root, `logos/changes/${SLUG}/VERIFY_PASS`, '');
  put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core', createdAt: '2026-10-15T00:00:00.000Z' }));
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'fixture']);
}

/** 规范化：去掉随调用或构建变化的值（时间、UUID、临时路径、CLI 版本、耗时、资产哈希），commit 按首次出现顺序编号。 */
function normalizer(root) {
  const commits = new Map();
  const roots = [root, realpathSync(root)];
  return text => {
    let out = text;
    for (const r of roots) out = out.split(r).join('<ROOT>');
    out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TIME>');
    out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>');
    // 资产 / 载荷哈希（sha256）随每次构建的资产内容变化，与部署行为无关
    out = out.replace(/\b[0-9a-f]{64}\b/g, '<SHA256>');
    out = out.replace(/\b[0-9a-f]{40}\b/g, c => {
      if (!commits.has(c)) commits.set(c, `<COMMIT-${commits.size + 1}>`);
      return commits.get(c);
    });
    out = out.replace(/"(duration_ms|elapsed_ms|durationMs)":\s*\d+/g, '"$1":<N>');
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
 * 在两种未启用夹具上执行既有命令，返回可逐字比较的观测结果。
 * @param {string} cliEntry  CLI 入口（dist/index.js）
 */
export function observeUnenabledFixtures(cliEntry) {
  const result = {};
  for (const [name, registry] of [['no-registry', false], ['registry-without-deploy', true]]) {
    const root = mkdtempSync(join(tmpdir(), 'ol-s42-zero-'));
    try {
      buildProject(root, registry);
      const norm = normalizer(root);
      const run = args => {
        const r = spawnSync(process.execPath, [cliEntry, ...args], {
          cwd: root, encoding: 'utf-8', timeout: 120_000,
          env: { ...process.env, ...GIT_ENV, OPENLOGOS_SMOKE_ENV: '', NO_COLOR: '1' },
        });
        return { args: args.join(' '), exit: r.status, stdout: envelope(r.stdout ?? '', norm), stderr: envelope(r.stderr ?? '', norm) };
      };
      const env = registry ? ['--env', 'prod'] : [];
      const steps = [];
      steps.push(run(['deploy-done', ...env, ...(registry ? ['--ref', 'HEAD'] : []), '--format', 'json']));
      steps.push(run(['smoke', ...env, '--format', 'json']));
      steps.push(run(['status', '--format', 'json']));
      steps.push(run(['env', 'list', '--format', 'json']));
      steps.push(run(['env', 'show', 'prod', '--format', 'json']));
      rmSync(join(root, 'logos/.openlogos-guard'));
      steps.push(run(['smoke', ...env, '--format', 'json']));
      steps.push(run(['env', 'list', '--format', 'json']));
      const proposalDir = join(root, 'logos/changes', SLUG);
      result[name] = {
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

// 直接执行：node s42-zero-regression-fixture.mjs <cli-entry> <out.json>（只用于以引入前的 CLI 生成基线）
if (process.argv[1] && process.argv[1].endsWith('s42-zero-regression-fixture.mjs') && process.argv.length >= 4) {
  writeFileSync(process.argv[3], JSON.stringify(observeUnenabledFixtures(process.argv[2]), null, 2) + '\n');
  console.log(`baseline written: ${process.argv[3]}`);
}
