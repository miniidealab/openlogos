#!/usr/bin/env node
/** SMOKE-core-163～167：固定 candidate 的 Authority Closure 安装态身份、负向门、cutover 与回滚。 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const AUTHORITY_CLOSURE_SMOKE_IDS = [
  'SMOKE-core-163', 'SMOKE-core-164', 'SMOKE-core-165', 'SMOKE-core-166', 'SMOKE-core-167',
];
const repoRoot = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: AUTHORITY_CLOSURE_SMOKE_IDS,
    environment: 'installed-candidate-isolated-prefix',
    required_source_env: ['OPENLOGOS_AUTHORITY_CLOSURE_TARBALL', 'OPENLOGOS_AUTHORITY_CLOSURE_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    reporter: 'OPENLOGOS_SMOKE_RESULT_PATH',
    reporter_identity_fields: ['version', 'entry_realpath', 'tarball_sha256', 'asset_payload_hash'],
    public_release_commands: [],
  }));
  process.exit(0);
}

// 环境不具备（缺历史候选制品）必须留痕：静默零记录退出会让「不适用」与「该跑没跑」同形
requireEnvOrSkip(AUTHORITY_CLOSURE_SMOKE_IDS, [
  ['OPENLOGOS_AUTHORITY_CLOSURE_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_AUTHORITY_CLOSURE_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: 'Authority Closure 候选 smoke 需要候选与回滚制品',
  environment: 'authority-closure-candidate',
});

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const run = (command, args, cwd = repoRoot) => spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 600_000 });
const checked = (result, label) => {
  if (result.error || result.status !== 0) throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  return result.stdout.trim();
};
const requiredTarball = (primary, routed) => {
  const raw = process.env[primary] || process.env[routed];
  if (!raw) throw new Error(`缺少 ${primary}`);
  return realpathSync(resolve(raw));
};
function report(id, status, startedAt, candidateIdentity, evidence, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify({
    id, status, timestamp: new Date().toISOString(), duration_ms: Date.now() - startedAt,
    environment: 'installed-candidate-isolated-prefix', candidate_identity: candidateIdentity, evidence,
    ...(error ? { error: String(error instanceof Error ? error.message : error).slice(0, 2000) } : {}),
  })}\n`);
}

const candidateTarball = requiredTarball('OPENLOGOS_AUTHORITY_CLOSURE_TARBALL', 'OPENLOGOS_TARBALL');
const rollbackTarball = requiredTarball('OPENLOGOS_AUTHORITY_CLOSURE_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
const transitionRoot = mkdtempSync(join(tmpdir(), 'openlogos-authority-transition-'));
const prefix = join(transitionRoot, 'prefix');

function install(tarball) {
  rmSync(prefix, { recursive: true, force: true });
  checked(run(npmCommand, ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', tarball]), `隔离安装 ${tarball}`);
  const packageRoot = realpathSync(join(prefix, 'node_modules', '@miniidealab', 'openlogos'));
  const entry = realpathSync(join(packageRoot, 'dist', 'index.js'));
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'asset-manifest.json'), 'utf8'));
  return {
    packageRoot, entry, manifest,
    identity: { version: pkg.version, entry_realpath: entry, tarball_sha256: sha256(readFileSync(tarball)), asset_payload_hash: manifest.payloadHash },
  };
}

function proposalRequired(overrides = '') {
  return `\`\`\`yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: required
  trigger_reasons: [derived_projection]
  facts:
    - fact_id: core.smoke-authority
      change: create
      authority_ref: spec/authority.md
      authority_owner: evaluator
      canonical_state: proposal
      sole_writer: merge
      mutation_entry: openlogos merge
      decision_api: AuthorityClosureEvaluator
      projections: [status]
      freshness_proof: sha256
      rebuild_rule: recompute
      recovery_source: receipt
      retired_shadow_sources: [local-parser]
      forbidden_fallbacks: [mtime]
      cutover:
        old_writer_stop: stopped
        new_writer_start: started
        rollback_boundary: before write
        exit_evidence: old rejected
      tests: [UT-S35-112]
  unresolved: []
${overrides}\`\`\`
`;
}

function fullProposal(impact) {
  return `# 变更提案：authority-smoke

> module: core

## 变更原因
验证安装态 Authority Closure。

## 变更类型
设计级（纯测试规格，无需代码）。

## 变更范围
- 安装态 evaluator。

## 部署影响
- 是否需要部署：否
- 部署原因：隔离 smoke fixture
- 影响环境：本地
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

${impact}
## 决策澄清

\`\`\`yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data: {status: none, reason: 无数据影响}
  compatibility: {status: none, reason: 无兼容影响}
  security_privacy: {status: none, reason: 无安全隐私影响}
  public_release: {status: none, reason: 无公开发布}
  external_commitment: {status: none, reason: 无外部承诺}
decisions: []
unresolved: []
defaults: []
\`\`\`

## 变更概述
只读验证安装态 evaluator。
`;
}

function treeHash(root) {
  const hash = createHash('sha256');
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name); const stat = statSync(path);
      hash.update(path.slice(root.length));
      if (stat.isDirectory()) walk(path); else hash.update(readFileSync(path));
    }
  };
  walk(root); return hash.digest('hex');
}

function evaluatorFixture(evaluate) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-authority-evaluator-'));
  const dir = join(root, 'logos', 'changes', 'smoke');
  mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true }); mkdirSync(join(root, 'spec'), { recursive: true }); mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ name: 'authority-smoke', locale: 'zh', documents: {} }));
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), 'project:\n  name: authority-smoke\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    product_type: cli\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'smoke', module: 'core' }));
  writeFileSync(join(root, 'spec', 'authority.md'), '# authority\n');
  writeFileSync(join(root, 'logos', 'resources', 'test', 'cases.md'), '| ID | 场景 |\n|---|---|\n| UT-S35-112 | smoke |\n');
  writeFileSync(join(dir, 'proposal.md'), fullProposal(proposalRequired()));
  writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta]\n- [ ] 记录安装态 smoke 规格\n');
  const runCase = value => { writeFileSync(join(dir, 'proposal.md'), fullProposal(value)); return evaluate(root, dir); };
  const runLintCase = (value, entry) => {
    writeFileSync(join(dir, 'proposal.md'), fullProposal(value));
    const before = treeHash(root);
    const result = run(process.execPath, [entry, 'change-lint', 'smoke', '--format', 'json'], root);
    if (treeHash(root) !== before) throw new Error('change-lint 产生写副作用');
    const envelope = JSON.parse((result.stdout || result.stderr).trim());
    return { status: result.status, envelope };
  };
  return { root, dir, runCase, runLintCase, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

let failed = false;
try {
  const frozenRollback = install(rollbackTarball);
  const candidateBefore = install(candidateTarball);
  const candidateModule = await import(pathToFileURL(join(candidateBefore.packageRoot, 'dist', 'lib', 'authority-candidate.js')).href);
  const evaluatorModule = await import(pathToFileURL(join(candidateBefore.packageRoot, 'dist', 'lib', 'authority-closure.js')).href);
  const cases = {
    'SMOKE-core-163': () => {
      const failures = candidateModule.validateAuthorityCandidateAssets(candidateBefore.manifest, candidateBefore.packageRoot);
      if (failures.length) throw new Error(JSON.stringify(failures));
      return { version: candidateBefore.identity.version, entry_realpath: candidateBefore.entry, payload_hash: candidateBefore.manifest.payloadHash };
    },
    'SMOKE-core-164': () => {
      const f = evaluatorFixture(evaluatorModule.evaluateAuthorityClosure);
      try {
        const notApplicableImpact = '```yaml\nauthority_impact:\n  schema: openlogos/authority-impact@1\n  applicability: not_applicable\n  evidence: [pure smoke fixture]\n```\n';
        const required = f.runCase(proposalRequired());
        const notApplicable = f.runCase(notApplicableImpact);
        const variants = [
          '',
          proposalRequired().replace('  schema: openlogos/authority-impact@1', '  schema: bad'),
          proposalRequired().replace('spec/authority.md', 'spec/missing.md'),
          proposalRequired().replace('      sole_writer: merge\n', ''),
          proposalRequired().replace('        exit_evidence: old rejected', '        exit_evidence: ""'),
        ];
        const lintPositive = [f.runLintCase(proposalRequired(), candidateBefore.entry), f.runLintCase(notApplicableImpact, candidateBefore.entry)];
        const lintNegative = variants.map(value => f.runLintCase(value, candidateBefore.entry));
        const codes = lintNegative.map(value => value.envelope.data.violations.find(item => item.code.startsWith('authority_'))?.code);
        const expected = [...evaluatorModule.AUTHORITY_CLOSURE_ISSUE_CODES];
        if (!required.pass || !notApplicable.pass || lintPositive.some(value => value.status !== 0)
          || lintNegative.some(value => value.status !== 2) || JSON.stringify(codes) !== JSON.stringify(expected)) {
          throw new Error(`exit/codes=${JSON.stringify({ positive: lintPositive.map(v => v.status), negative: lintNegative.map(v => v.status), codes })}`);
        }
        return { required_exit: 0, not_applicable_exit: 0, negative_exits: lintNegative.map(v => v.status), codes, read_only: true };
      } finally { f.cleanup(); }
    },
    'SMOKE-core-165': () => {
      const f = evaluatorFixture(evaluatorModule.evaluateAuthorityClosure);
      try {
        const stale = f.runLintCase(proposalRequired().replace('      retired_shadow_sources: [local-parser]', '      retired_shadow_sources: []'), candidateBefore.entry);
        const recovered = f.runLintCase(proposalRequired(), candidateBefore.entry);
        if (stale.status !== 2 || recovered.status !== 0) throw new Error('stale projection 未被拒绝或新进程 authority 恢复失败');
        return { stale_rejected: true, recovery_source: 'authority/receipt', restart_query_pass: true, processes: 2 };
      } finally { f.cleanup(); }
    },
    'SMOKE-core-166': () => {
      const canonical = candidateModule.AUTHORITY_CUTOVER_ORDER.map(event => ({ event, success: true }));
      const legacyAlive = candidateModule.validateAuthorityCutover(canonical.filter(row => row.event !== 'old_writer_rejected'));
      const closed = candidateModule.validateAuthorityCutover(canonical);
      if (legacyAlive.pass || !closed.pass) throw new Error('legacy writer/cutover 判据错误');
      return { old_writer_rejected: true, freshness_probe: true, exit_evidence: true };
    },
    'SMOKE-core-167': () => {
      const rollbackActual = install(rollbackTarball); const candidateAfter = install(candidateTarball);
      const result = candidateModule.validateAuthorityRollback({
        candidate_before: candidateBefore.identity, frozen_rollback: frozenRollback.identity,
        rollback_actual: rollbackActual.identity, candidate_after: candidateAfter.identity,
      });
      if (!result.pass) throw new Error(JSON.stringify(result.failures));
      return { rollback_version: rollbackActual.identity.version, candidate_version: candidateAfter.identity.version, reinstall_idempotent: true };
    },
  };
  for (const id of AUTHORITY_CLOSURE_SMOKE_IDS) {
    const startedAt = Date.now();
    try { report(id, 'pass', startedAt, candidateBefore.identity, cases[id]()); }
    catch (error) { failed = true; report(id, 'fail', startedAt, candidateBefore.identity, null, error); break; }
  }
} finally {
  rmSync(transitionRoot, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
