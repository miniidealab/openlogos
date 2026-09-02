#!/usr/bin/env node
/**
 * SMOKE-core-135..140 — Plan Package 0.13.31 安装态、sync 身份与回滚冒烟。
 * 仅消费调用方固定的本地候选/回滚 tarball；不执行 publish、Git 或远程发布。
 */
import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const PLAN_PACKAGE_SMOKE_IDS = [
  'SMOKE-core-135', 'SMOKE-core-136', 'SMOKE-core-137',
  'SMOKE-core-138', 'SMOKE-core-139', 'SMOKE-core-140',
];
const EXPECTED_VERSION = '0.13.31';
const ROLLBACK_VERSION = '0.13.30';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const evidenceRoot = join(repoRoot, 'logos/resources/verify/plan-package-smoke-evidence');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: PLAN_PACKAGE_SMOKE_IDS, candidate_version: EXPECTED_VERSION, rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_PLAN_CONVERGENCE_TARBALL', 'OPENLOGOS_PLAN_CONVERGENCE_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'], public_release_commands: [],
  }));
  process.exit(0);
}

// 环境不具备（缺历史候选制品）必须留痕：静默零记录退出会让「不适用」与「该跑没跑」同形
requireEnvOrSkip(PLAN_PACKAGE_SMOKE_IDS, [
  ['OPENLOGOS_PLAN_CONVERGENCE_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_PLAN_CONVERGENCE_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: 'plan-package 收敛 smoke 需要 0.13.31 候选与回滚制品',
  environment: 'plan-package-convergence',
});

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function run(command, args, cwd = repoRoot, env = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120_000 });
}
function checked(result, label) {
  if (result.error || result.status !== 0) throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  return result.stdout.trim();
}
function requiredTarball(name, version) {
  const raw = process.env[name];
  if (!raw) throw new Error(`缺少 ${name}`);
  const path = realpathSync(resolve(raw));
  if (!existsSync(path)) throw new Error(`${name} 不存在：${path}`);
  return { path, version, sha256: sha256(readFileSync(path)) };
}
function npmValue(args) { return checked(run(npmCommand, args), `npm ${args.join(' ')}`); }
function install(tarball) {
  checked(run(npmCommand, ['install', '-g', '--ignore-scripts', tarball.path]), `安装 ${tarball.version}`);
  const packageRoot = join(npmValue(['root', '-g']), '@miniidealab', 'openlogos');
  const version = checked(run('openlogos', ['--version']), 'openlogos --version');
  if (version !== tarball.version) throw new Error(`安装后版本=${version}，期望 ${tarball.version}`);
  return { packageRoot: realpathSync(packageRoot), entry: realpathSync(checked(run(process.platform === 'win32' ? 'where' : 'which', ['openlogos']), '定位 openlogos').split(/\r?\n/)[0]) };
}
function snapshot(root) {
  const out = {};
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name); const stat = statSync(path); const rel = relative(root, path);
      if (stat.isDirectory()) walk(path); else out[rel] = sha256(readFileSync(path));
    }
  };
  walk(root); return out;
}
function project(prefix = 'plan-package-smoke-', locale = 'zh') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 'smoke', locale, aiTool: 'codex', documents: {}, sourceRoots: { src: ['src'], test: ['test'] } }, null, 2));
  writeFileSync(join(root, 'logos/logos-project.yaml'), 'project:\n  name: smoke\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    product_type: cli\n');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function report(id, status, startedAt, context, evidence, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify({
    id, status, timestamp: new Date().toISOString(), duration_ms: Date.now() - startedAt,
    environment: 'local-global-isolated', candidate_tarball_sha256: context.candidate.sha256,
    rollback_tarball_sha256: context.rollback.sha256, global_entry_realpath: context.entry?.entry ?? null,
    plan_contract_version: '1.3.0', evidence: evidence ? [evidence] : [],
    ...(error ? { error: String(error instanceof Error ? error.message : error).slice(0, 2000) } : {}),
  })}\n`);
}
function evidence(id, payload) {
  mkdirSync(evidenceRoot, { recursive: true });
  const path = join(evidenceRoot, `${id}.json`); writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  return relative(repoRoot, path).replace(/\\/g, '/');
}
function clarification(locale) {
  const title = locale === 'en' ? 'Decision Clarification' : '决策澄清';
  const reasons = locale === 'en'
    ? ['No data impact.', 'No compatibility choice.', 'No security or privacy impact.', 'No public release.', 'No external commitment.']
    : ['无数据影响。', '无兼容选择。', '无安全隐私影响。', '无公开发布。', '无外部承诺。'];
  return [`## ${title}`, '', '```yaml',
    'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
    'impacts:', '  data:', '    status: none', `    reason: ${reasons[0]}`,
    '  compatibility:', '    status: none', `    reason: ${reasons[1]}`,
    '  security_privacy:', '    status: none', `    reason: ${reasons[2]}`,
    '  public_release:', '    status: none', `    reason: ${reasons[3]}`,
    '  external_commitment:', '    status: none', `    reason: ${reasons[4]}`,
    'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
  ].join('\n');
}
function filledProposal(locale, slug) {
  if (locale === 'en') return [
    `# Change Proposal: ${slug}`, '', '> module: core', '',
    '## Reason', 'Fix the Plan Package convergence bug.', '',
    '## Change Type', 'Code level fix.', '',
    '## Scope', '- CLI Plan Package evaluation.', '',
    '## Deployment Impact',
    '- Deployment required: no', '- Deployment reason: local smoke fixture', '- Affected environments: local',
    '- Data migration involved: no', '- Rollback plan required: no', '- Smoke required: no', '',
    '## Summary', 'Use one evaluator for all Plan Package consumers.', '', clarification(locale),
  ].join('\n');
  return [
    `# 变更提案：${slug}`, '', '> module: core', '',
    '## 变更原因', '修复 Plan Package 收敛故障。', '',
    '## 变更类型', '代码级缺陷修复。', '',
    '## 变更范围', '- CLI Plan Package evaluator。', '',
    '## 部署影响',
    '- 是否需要部署：否', '- 部署原因：本地 smoke fixture', '- 影响环境：本地',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '让所有 Plan Package 消费方共用一个 evaluator。', '', clarification(locale),
  ].join('\n');
}
function filledTasks(locale) {
  const title = locale === 'en' ? '# Tasks' : '# 任务';
  const delta = locale === 'en' ? 'Specification changes' : '规格变更';
  const code = locale === 'en' ? 'Code implementation' : '代码实现';
  const detail = locale === 'en' ? 'Add Plan Package regression cases.' : '增加 Plan Package 回归用例。';
  return `${title}\n\n## [delta] ${delta}\n- [ ] \`deltas/test/core-S35-test-cases.md\`：${detail}\n\n## [code] ${code}\n`;
}
function fillChangeFixture(f) {
  writeFileSync(join(f.dir, 'proposal.md'), filledProposal(f.locale, f.slug));
  writeFileSync(join(f.dir, 'tasks.md'), filledTasks(f.locale));
  const target = join(f.root, 'logos/resources/test/core-S35-test-cases.md');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, '| ID | 用例 |\n|---|---|\n| UT-S35-100 | Plan Package 回归 |\n');
}
function createChangeFixture(locale = 'zh', slug = `plan-smoke-${locale}`) {
  const f = project(`plan-package-smoke-${locale}-`, locale);
  const result = run('openlogos', ['change', slug], f.root);
  checked(result, `openlogos change ${slug}`);
  const dir = join(f.root, 'logos/changes', slug);
  return {
    ...f, dir, locale, slug,
    scaffoldProposal: readFileSync(join(dir, 'proposal.md'), 'utf8'),
    scaffoldTasks: readFileSync(join(dir, 'tasks.md'), 'utf8'),
  };
}

const context = {
  candidate: requiredTarball('OPENLOGOS_TARBALL', EXPECTED_VERSION),
  rollback: requiredTarball('OPENLOGOS_PREVIOUS_TARBALL', ROLLBACK_VERSION), entry: null,
};
let failed = false;
async function smoke(id, fn) {
  const startedAt = Date.now();
  try { report(id, 'pass', startedAt, context, evidence(id, await fn())); console.log(`✓ ${id}`); }
  catch (error) { failed = true; report(id, 'fail', startedAt, context, null, error); console.error(`✗ ${id}: ${error instanceof Error ? error.message : error}`); }
}

context.entry = install(context.candidate);
const assetModule = await import(`${pathToFileURL(join(context.entry.packageRoot, 'dist/lib/asset-manifest.js')).href}?${Date.now()}`);
const planModule = await import(`${pathToFileURL(join(context.entry.packageRoot, 'dist/lib/plan-package.js')).href}?${Date.now()}`);
const flowModule = await import(`${pathToFileURL(join(context.entry.packageRoot, 'dist/lib/flow-derive.js')).href}?${Date.now()}`);

await smoke('SMOKE-core-135', async () => {
  const manifest = JSON.parse(readFileSync(join(context.entry.packageRoot, 'asset-manifest.json'), 'utf8'));
  assetModule.validateAssetManifest(manifest, context.entry.packageRoot);
  for (const path of ['package.json', 'claude-plugin-template/.claude-plugin/plugin.json', 'codex-plugin-template/plugin.json']) {
    if (JSON.parse(readFileSync(join(context.entry.packageRoot, path), 'utf8')).version !== EXPECTED_VERSION) throw new Error(`${path} 版本不一致`);
  }
  if (manifest.planContractVersion !== '1.3.0') throw new Error('Plan contract 不是 1.3.0');
  return { ...context.entry, manifest_hash: manifest.payloadHash, asset_count: ['skills', 'templates', 'schemas', 'plugins'].flatMap(group => manifest[group]).length };
});

await smoke('SMOKE-core-136', async () => {
  const localeResults = [];
  for (const locale of ['zh', 'en']) {
    const f = createChangeFixture(locale);
    try {
      const titles = locale === 'en'
        ? ['Reason', 'Change Type', 'Scope', 'Deployment Impact', 'Decision Clarification', 'Summary']
        : ['变更原因', '变更类型', '变更范围', '部署影响', '决策澄清', '变更概述'];
      for (const title of titles) if (!f.scaffoldProposal.includes(`## ${title}`)) throw new Error(`${locale} scaffold 缺 canonical 章节 ${title}`);
      const codeSection = f.scaffoldTasks.split('## [code]')[1] ?? '';
      if (!f.scaffoldTasks.includes('## [code]') || /^- \[[ xX]\].+$/m.test(codeSection)) throw new Error(`${locale} scaffold 的 [code] 不是空锚点`);

      fillChangeFixture(f);
      const ready = run('openlogos', ['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
      if (ready.status !== 0 || JSON.parse(ready.stdout).data.plan_package.ready !== true) throw new Error(`${locale} 合法 fixture 未 ready`);
      const summary = locale === 'en' ? ['## Summary', '## Core Design'] : ['## 变更概述', '## 核心设计'];
      writeFileSync(join(f.dir, 'proposal.md'), readFileSync(join(f.dir, 'proposal.md'), 'utf8').replace(summary[0], summary[1]));
      writeFileSync(join(f.dir, 'tasks.md'), `${readFileSync(join(f.dir, 'tasks.md'), 'utf8').trimEnd()}\n- [ ] ${locale === 'en' ? 'Premature coding' : '提前编码'}\n`);
      const lint = run('openlogos', ['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
      if (lint.status !== 2) throw new Error(`${locale} 双错 lint exit=${lint.status}`);
      const issues = JSON.parse(lint.stdout).data.plan_package.issues;
      const expectedCodes = ['proposal_required_section_missing', 'tasks_code_entry_before_spec_complete'];
      if (JSON.stringify(issues.map(row => row.code)) !== JSON.stringify(expectedCodes)) throw new Error(`${locale} issues 不精确`);
      for (const code of expectedCodes) {
        const issue = issues.find(row => row.code === code);
        if (!issue || !issue.path || !issue.section_id || !issue.expected || !issue.fix_hint) throw new Error(`${locale} ${code} 字段不完整`);
      }
      localeResults.push({ locale, issues: issues.map(row => ({ code: row.code, path: row.path, section: row.section_id })), snapshot: snapshot(f.root) });
    } finally { f.cleanup(); }
  }
  return { locales: localeResults };
});

await smoke('SMOKE-core-137', async () => {
  const f = createChangeFixture();
  try {
    fillChangeFixture(f);
    const before = snapshot(f.root); const evaluation = planModule.evaluatePlanPackage(f.root, f.dir);
    const lint = run('openlogos', ['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
    const status = run('openlogos', ['status', '--format', 'json'], f.root);
    const next = run('openlogos', ['next', '--format', 'json'], f.root);
    for (const [name, result] of [['lint', lint], ['status', status], ['next', next]]) if (result.status !== 0) throw new Error(`${name} exit=${result.status}`);
    const statusPlan = JSON.parse(status.stdout).data.modules[0].active_change.plan_state.plan_package;
    const nextPlan = JSON.parse(next.stdout).data.modules[0].plan_state.plan_package;
    if (JSON.stringify(evaluation) !== JSON.stringify(statusPlan) || JSON.stringify(evaluation) !== JSON.stringify(nextPlan)) throw new Error('四方 evaluation 漂移');
    if (flowModule.detectProposalStepViaFlow(f.dir) !== 'ready-to-delta') throw new Error('flow 前沿不一致');
    if (JSON.stringify(before) !== JSON.stringify(snapshot(f.root))) throw new Error('只读命令产生写副作用');
    return { ready: evaluation.ready, issues: evaluation.issues, readonly_hash: sha256(JSON.stringify(before)) };
  } finally { f.cleanup(); }
});

await smoke('SMOKE-core-138', async () => {
  const f = project('plan-sync-smoke-');
  try {
    const user = join(f.root, '.agents/plugins/user-owned.txt'); mkdirSync(dirname(user), { recursive: true }); writeFileSync(user, 'user-owned');
    const userHash = sha256(readFileSync(user)); checked(run('openlogos', ['sync'], f.root), '第一次 sync');
    const first = snapshot(f.root); checked(run('openlogos', ['sync'], f.root), '第二次 sync');
    const second = snapshot(f.root); const stamp = JSON.parse(readFileSync(join(f.root, 'logos/.openlogos-sync.json'), 'utf8'));
    if (JSON.stringify(first) !== JSON.stringify(second)) throw new Error('第二次 sync 非幂等');
    if (sha256(readFileSync(user)) !== userHash) throw new Error('用户资产被覆盖');
    if (stamp.planContractVersion !== '1.3.0' || !/^[a-f0-9]{64}$/.test(stamp.managedAssetsHash)) throw new Error('sync stamp 不完整');
    return { stamp, user_hash: userHash };
  } finally { f.cleanup(); }
});

await smoke('SMOKE-core-139', async () => {
  const manifest = assetModule.readBundledAssetManifest(join(context.entry.packageRoot, 'asset-manifest.json'));
  const old = { ...manifest, payloadHash: '0'.repeat(64) };
  const oldKey = assetModule.assetCacheKey(old); const currentKey = assetModule.assetCacheKey(manifest);
  if (oldKey === currentKey) throw new Error('同 semver cache key 未绑定 payload hash');
  const cache = mkdtempSync(join(tmpdir(), 'openlogos-cache-smoke-'));
  try { mkdirSync(join(cache, oldKey)); writeFileSync(join(cache, oldKey, 'SKILL.md'), 'stale'); mkdirSync(join(cache, currentKey));
    return { old_key: oldKey, current_key: currentKey, refreshed: oldKey !== currentKey };
  } finally { rmSync(cache, { recursive: true, force: true }); }
});

await smoke('SMOKE-core-140', async () => {
  const rollback = install(context.rollback); const restored = install(context.candidate); context.entry = restored;
  const f = createChangeFixture();
  try {
    fillChangeFixture(f);
    const lint = run('openlogos', ['change-lint', '--slug', f.slug, '--format', 'json'], f.root);
    if (lint.status !== 0 || JSON.parse(lint.stdout).data.plan_package.ready !== true) throw new Error('恢复候选后最小正例失败');
    return { candidate: context.candidate.sha256, rollback: context.rollback.sha256, rollback_entry: rollback.entry, restored_entry: restored.entry, public_side_effects: [] };
  } finally { f.cleanup(); }
});

process.exit(failed ? 1 : 0);
