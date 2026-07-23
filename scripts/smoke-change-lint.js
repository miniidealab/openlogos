#!/usr/bin/env node
/**
 * SMOKE-core-51..53 — change-lint 发布后冒烟（change-lint-shift-left S35）。
 * 51 命令可见与可发现；52 text/JSON 调用契约（exit 0/2/1）；53 只读红线（项目级快照）。
 */
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

function writeSmoke(id, status, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = { id, status, timestamp: new Date().toISOString(), scenario: 'change-lint 发布后冒烟' };
  if (error) record.error = String(error).slice(0, 500);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

/**
 * code-r1 F14：发布后 smoke 默认调用**已部署的全局 `openlogos` 可执行文件**——仓库 dist 恒在，
 * 若隐式首选 dist 则全局安装缺失/陈旧也能全绿，无法证明部署产物可用。
 * 本地 dist / 其它入口仅可经 `OPENLOGOS_BIN` **显式** override（开发调试用途）。
 */
function cliCommand() {
  if (process.env.OPENLOGOS_BIN) return { command: process.env.OPENLOGOS_BIN, baseArgs: [] };
  return { command: 'openlogos', baseArgs: [] };
}

/** 部署一致性前置：`openlogos --version` 必须与 cli/package.json 一致（部署方案 §二十一）。 */
function assertDeployedVersion() {
  const expected = JSON.parse(readFileSync(join(repoRoot, 'cli/package.json'), 'utf-8')).version;
  const r = runCli(repoRoot, ['--version']);
  if (r.error || r.status !== 0) {
    throw new Error(`无法执行已部署 openlogos（${r.error ?? `exit ${r.status}`}）——全局安装缺失或损坏`);
  }
  const actual = `${r.stdout}`.trim();
  if (actual !== expected) {
    throw new Error(`已部署 openlogos 版本 ${actual} 与 cli/package.json ${expected} 不一致——部署未完成或陈旧`);
  }
}

function runCli(root, args) {
  const cli = cliCommand();
  const env = { ...process.env };
  delete env.OPENLOGOS_SMOKE_RESULT_PATH;
  return spawnSync(cli.command, [...cli.baseArgs, ...args], { cwd: root, encoding: 'utf-8', env });
}

function withTempProject(prefix, fn) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scaffoldLintFixture(root, opts = {}) {
  const slug = opts.slug ?? 'lint-fixture';
  mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  mkdirSync(join(root, 'logos/changes', slug), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 'lint-smoke', locale: 'zh', documents: {} }, null, 2));
  writeFileSync(join(root, 'logos/logos-project.yaml'), [
    'project:', '  name: lint-smoke', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', '    product_type: cli',
  ].join('\n'));
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-07-22T00:00:00.000Z' }));
  writeFileSync(join(root, 'logos/changes', slug, 'proposal.md'), [
    `# 变更提案：${slug}`, '', '> module: core', '',
    '## 变更原因', '冒烟夹具。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01', '', '## 部署影响',
    '- 是否需要部署：否', '- 部署原因：冒烟夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '纯文档更新，无需代码。',
  ].join('\n'));
  writeFileSync(join(root, 'logos/changes', slug, 'tasks.md'),
    opts.violating
      ? '# 任务\n- [ ] 旧格式任务（无 section 标题）'
      : '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/prd/`\n');
  return slug;
}

/** code-r2 F17：lstat 全类型快照——目录自身（覆盖空目录）、symlink（记 link target、不跟随）、普通文件记 hash。 */
function snapshotTree(root) {
  const out = new Map();
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = full.slice(root.length);
      const lst = lstatSync(full);
      if (lst.isSymbolicLink()) { out.set(rel, `symlink:${readlinkSync(full)}`); continue; }
      if (lst.isDirectory()) { out.set(rel, 'dir'); walk(full); continue; }
      if (lst.isFile()) { out.set(rel, createHash('sha256').update(readFileSync(full)).digest('hex')); continue; }
      out.set(rel, 'other');
    }
  };
  walk(root);
  return out;
}

function sameSnapshot(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function commandDiscoverable() {
  if (!process.env.OPENLOGOS_BIN) assertDeployedVersion(); // 全局安装在场且版本与 cli/package.json 一致
  const help = runCli(repoRoot, ['--help']);
  if (help.status !== 0) throw new Error(`--help failed: ${help.stderr}`);
  if (!`${help.stdout}`.includes('change-lint')) throw new Error('--help 未收录 change-lint');
}

function textJsonContract() {
  return withTempProject('openlogos-lint-smoke-52-', root => {
    const slug = scaffoldLintFixture(root);
    // text 全过：exit 0、逐项 ✓、无 JSON
    const t0 = runCli(root, ['change-lint']);
    if (t0.status !== 0) throw new Error(`text pass exit ${t0.status}: ${t0.stderr}`);
    if (!t0.stdout.includes('✓') || !/PASS（\d+\/\d+）/.test(t0.stdout)) throw new Error(`text pass 输出异常: ${t0.stdout}`);
    if (t0.stdout.trim().startsWith('{')) throw new Error('text 模式 stdout 混入 JSON');
    // JSON 全过：stdout 通用信封
    const j0 = runCli(root, ['change-lint', '--format', 'json']);
    if (j0.status !== 0) throw new Error(`json pass exit ${j0.status}`);
    const env0 = JSON.parse(j0.stdout.trim());
    if (env0.command !== 'change-lint' || env0.data.slug !== slug || env0.data.pass !== true || !Array.isArray(env0.data.violations)) {
      throw new Error(`json envelope 异常: ${j0.stdout}`);
    }
    // 检查红：exit 2
    return withTempProject('openlogos-lint-smoke-52b-', root2 => {
      scaffoldLintFixture(root2, { violating: true });
      const j2 = runCli(root2, ['change-lint', '--format', 'json']);
      if (j2.status !== 2) throw new Error(`violating fixture 应 exit 2，得到 ${j2.status}: ${j2.stderr}`);
      const env2 = JSON.parse(j2.stdout.trim());
      if (env2.data.pass !== false || env2.data.violations.length === 0) throw new Error('检查红 envelope 异常');
      // 操作错误（slug 不存在）：stderr error envelope + exit 1
      const j1 = runCli(root2, ['change-lint', '--slug', 'not-exists', '--format', 'json']);
      if (j1.status !== 1) throw new Error(`不存在 slug 应 exit 1，得到 ${j1.status}`);
      const err = JSON.parse(j1.stderr.trim());
      if (err.command !== 'change-lint' || err.error.code !== 'slug_not_found') throw new Error(`error envelope 异常: ${j1.stderr}`);
    });
  });
}

function projectReadonly() {
  return withTempProject('openlogos-lint-smoke-53-', root => {
    scaffoldLintFixture(root);
    const runs = [
      ['change-lint'], // exit 0
      ['change-lint', '--slug', 'not-exists'], // exit 1
      ['change-lint', '--format', 'json'],
    ];
    const before = snapshotTree(root);
    for (const args of runs) runCli(root, args);
    if (!sameSnapshot(before, snapshotTree(root))) throw new Error('exit 0/1 路径项目根快照发生变化');
    return withTempProject('openlogos-lint-smoke-53b-', root2 => {
      scaffoldLintFixture(root2, { violating: true });
      const b2 = snapshotTree(root2);
      const r = runCli(root2, ['change-lint']); // exit 2
      if (r.status !== 2) throw new Error(`应 exit 2，得到 ${r.status}`);
      if (!sameSnapshot(b2, snapshotTree(root2))) throw new Error('exit 2 路径项目根快照发生变化');
      if (existsSync(join(root2, 'logos/changes/lint-fixture/UI_PROTOTYPE_HASHES.json'))) {
        throw new Error('lint 不得写 UI_PROTOTYPE_HASHES.json');
      }
    });
  });
}

const cases = [
  ['SMOKE-core-51', commandDiscoverable],
  ['SMOKE-core-52', textJsonContract],
  ['SMOKE-core-53', projectReadonly],
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
