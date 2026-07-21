#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const resultPath = resolve(
  repoRoot,
  process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl',
);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let packageFixture = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeSmoke(id, status, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id,
    status,
    timestamp: new Date().toISOString(),
    scenario: 'core CLI deployment smoke',
  };
  if (error) record.error = String(error).slice(0, 500);
  appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
}

function run(command, args, cwd, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.OPENLOGOS_SMOKE_RESULT_PATH;
  return spawnSync(command, args, { cwd, encoding: 'utf-8', env });
}

function checked(result, label) {
  if (result.status !== 0) {
    throw new Error([
      `${label} failed with exit ${result.status}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function parseEnvelope(result) {
  const raw = `${result.stdout || ''}\n${result.stderr || ''}`;
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

function preparePackagedCli() {
  if (packageFixture) return packageFixture;

  const root = mkdtempSync(join(tmpdir(), 'openlogos-smoke-package-'));
  const installRoot = join(root, 'install');
  mkdirSync(installRoot, { recursive: true });
  writeFileSync(join(installRoot, 'package.json'), JSON.stringify({ name: 'openlogos-smoke-install', private: true }));

  const packed = checked(
    run(npmCommand, ['pack', join(repoRoot, 'cli'), '--pack-destination', root, '--json'], repoRoot),
    'npm pack',
  );
  let metadata;
  try {
    metadata = JSON.parse(packed.stdout.trim())[0];
  } catch (error) {
    throw new Error(`unable to parse npm pack metadata: ${String(error)}\n${packed.stdout.slice(0, 500)}`);
  }

  const tarball = join(root, metadata.filename);
  assert(existsSync(tarball), `npm pack did not create ${tarball}`);
  checked(
    run(npmCommand, ['install', tarball, '--ignore-scripts', '--no-audit', '--no-fund'], installRoot),
    'npm install packed CLI',
  );

  const entry = join(installRoot, 'node_modules/@miniidealab/openlogos/dist/index.js');
  assert(existsSync(entry), 'installed CLI entry is missing');
  packageFixture = {
    root,
    entry,
    files: new Set((metadata.files || []).map(item => item.path)),
  };
  return packageFixture;
}

function cleanupPackageFixture() {
  if (!packageFixture) return;
  rmSync(packageFixture.root, { recursive: true, force: true });
  packageFixture = null;
}

function runCli(root, args) {
  const { entry } = preparePackagedCli();
  return run(process.execPath, [entry, ...args], root);
}

function writeConfig(root, config) {
  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({
    name: 'core-cli-smoke',
    locale: 'zh',
    documents: {},
    ...config,
  }, null, 2));
}

function writeLaunchedProject(root, bootstrap) {
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
  mkdirSync(join(root, 'logos/changes'), { recursive: true });
  writeConfig(root, {});
  writeFileSync(join(root, 'logos/logos-project.yaml'), [
    'project:',
    '  name: core-cli-smoke',
    'modules:',
    '  - id: core',
    '    name: Core',
    '    lifecycle: launched',
    ...(bootstrap ? [`    bootstrap: ${bootstrap}`] : []),
    'deployment_gates:',
    '  core:',
    '    deployment_required: true',
    '    smoke_required: true',
    '',
  ].join('\n'));
}

function writeProposal(root, slug, proposal, tasks) {
  const proposalDir = join(root, 'logos/changes', slug);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({
    activeChange: slug,
    module: 'core',
    createdAt: '2026-07-10T00:00:00.000Z',
  }));
  writeFileSync(join(proposalDir, 'proposal.md'), proposal);
  writeFileSync(join(proposalDir, 'tasks.md'), tasks);
  return proposalDir;
}

const NO_DEPLOY_PROPOSAL = [
  '# 变更提案：docs-only',
  '',
  '## 变更原因',
  '补充说明文档。',
  '',
  '## 变更类型',
  '文档级',
  '',
  '## 部署影响',
  '- 是否需要部署：否',
  '- 部署原因：仅更新文档，不需要发布运行产物',
  '- 影响环境：无',
  '- 是否涉及数据迁移：否',
  '- 是否需要回滚预案：否',
  '- 是否需要 smoke：否',
  '',
  '## 变更概述',
  '补充文档。',
].join('\n');

const DEPLOY_PROPOSAL = [
  '# 变更提案：runtime-change',
  '',
  '## 变更原因',
  '修改 CLI 运行时代码。',
  '',
  '## 变更类型',
  '代码级修复',
  '',
  '## 部署影响',
  '- 是否需要部署：是',
  '- 部署原因：修改 CLI 运行时代码，需要发布新包',
  '- 影响环境：staging',
  '- 是否涉及数据迁移：否',
  '- 是否需要回滚预案：是',
  '- 是否需要 smoke：是',
  '',
  '## 变更概述',
  '修改运行时代码。',
].join('\n');

function smokeCliPackageVersion() {
  const fixture = preparePackagedCli();
  const version = checked(run(process.execPath, [fixture.entry, '--version'], fixture.root), 'openlogos --version');
  assert(/^\d+\.\d+\.\d+/.test(version.stdout.trim()), `unexpected version: ${version.stdout.trim()}`);
}

function smokeInitAssets() {
  withTempProject('openlogos-smoke-init-assets-', root => {
    checked(runCli(root, ['init', 'smoke', '--locale', 'zh', '--ai-tool', 'all']), 'openlogos init');
    for (const name of ['requirement', 'todolist', 'code', 'image', 'temp', 'note']) {
      assert(existsSync(join(root, 'logos/resources/reference', name)), `missing reference directory: ${name}`);
    }
    assert(existsSync(join(root, 'AGENTS.md')), 'AGENTS.md was not generated');
    assert(existsSync(join(root, 'CLAUDE.md')), 'CLAUDE.md was not generated');
    assert(existsSync(join(root, '.agents/plugins/marketplace.json')), 'Codex marketplace was not generated');
  });
}

function smokePackageTemplates() {
  const { files } = preparePackagedCli();
  for (const prefix of ['claude-plugin-template/', 'codex-plugin-template/', 'opencode-plugin-template/']) {
    assert([...files].some(path => path.startsWith(prefix)), `packed CLI is missing ${prefix}`);
  }
}

function smokeNoDeployStatus() {
  withTempProject('openlogos-smoke-no-deploy-', root => {
    writeLaunchedProject(root);
    const proposalDir = writeProposal(root, 'docs-only', NO_DEPLOY_PROPOSAL, '# 实现任务\n');
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeFileSync(join(proposalDir, 'LOOP_ITERS'), '{"iter":1,"node":"verify","result":"pass","module":"core"}\n');

    const output = checked(runCli(root, ['status', '--format', 'json']), 'openlogos status');
    const data = parseEnvelope(output).data;
    const module = data.modules.find(item => item.id === 'core');
    assert(module.active_change.deployment_required === false, 'deployment_required should be false');
    assert(module.active_change.proposal_step === 'verify-passed', `unexpected step: ${module.active_change.proposal_step}`);
    assert(/archive/i.test(module.suggestion || ''), 'status should suggest archive instead of deploy');
  });
}

function smokeDeployProgress() {
  withTempProject('openlogos-smoke-deploy-progress-', root => {
    writeLaunchedProject(root);
    writeProposal(root, 'runtime-change', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 已完成业务代码',
      '- [ ] 不应计入部署进度的代码任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
      '- [ ] 同步官网',
    ].join('\n'));

    const output = checked(runCli(root, ['status', '--format', 'json']), 'openlogos status');
    const active = parseEnvelope(output).data.modules.find(item => item.id === 'core').active_change;
    assert(active.deployment_progress.checked === 1, 'deploy checked count should be 1');
    assert(active.deployment_progress.total === 2, 'deploy total should ignore [code] tasks');
    assert(active.deployment_document.name === 'tasks.md', 'deployment document should point to tasks.md');
  });
}

function smokeAdoptNextGuidance() {
  withTempProject('openlogos-smoke-adopt-next-', root => {
    writeLaunchedProject(root, 'adopted');
    const output = checked(runCli(root, ['next']), 'openlogos next');
    // brownfield-adopter（S33）：required 时引导逆向建基线（取代旧 add-baseline-docs）。
    assert(output.stdout.includes('openlogos baseline-seed begin'), 'missing reverse-baseline guidance');
    assert(!output.stdout.includes('openlogos change add-baseline-docs'), 'still suggests add-baseline-docs');
  });
}

function smokeVerifyWithoutPreRun() {
  withTempProject('openlogos-smoke-verify-none-', root => {
    writeConfig(root, { verify: { result_path: 'logos/resources/verify/test-results.jsonl', sandbox_mode: 'off' } });
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/logos-project.yaml'), 'project:\n  name: verify-none\n');
    writeFileSync(join(root, 'logos/resources/test/core-S13-test-cases.md'), '| UT-S13-02 | one |\n| UT-S13-03 | two |\n');
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), '{"id":"UT-S13-02","status":"pass"}\n');

    const output = runCli(root, ['verify', '--format', 'json']);
    assert(output.status !== 0, 'verify should fail when coverage is incomplete');
    const data = parseEnvelope(output).data;
    assert(data.pre_run.mode === 'none', `unexpected pre_run mode: ${data.pre_run.mode}`);
    assert(data.gate.result === 'FAIL', 'verify gate should fail');
    assert(data.pre_run.suggestions.some(item => item.includes('verify.pre_run_command')), 'missing pre-run remediation');
  });
}

function smokeVerifyTwoPhase() {
  withTempProject('openlogos-smoke-verify-two-phase-', root => {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    writeFileSync(join(root, 'scripts/regression.js'), [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "mkdirSync('logos/resources/verify', { recursive: true });",
      "writeFileSync('logos/resources/verify/regression.jsonl', '{\"id\":\"UT-S13-02\",\"status\":\"fail\",\"error\":\"old\"}\\n{\"id\":\"UT-S13-03\",\"status\":\"pass\"}\\n');",
    ].join('\n'));
    writeFileSync(join(root, 'scripts/incremental.js'), [
      "import { mkdirSync, writeFileSync } from 'node:fs';",
      "mkdirSync('logos/resources/verify', { recursive: true });",
      "writeFileSync('logos/resources/verify/incremental.jsonl', '{\"id\":\"UT-S13-02\",\"status\":\"pass\"}\\n');",
    ].join('\n'));
    writeConfig(root, { verify: {
      result_path: 'logos/resources/verify/test-results.jsonl',
      regression_command: 'node scripts/regression.js',
      incremental_command: 'node scripts/incremental.js',
      regression_result_path: 'logos/resources/verify/regression.jsonl',
      incremental_result_path: 'logos/resources/verify/incremental.jsonl',
      merge_strategy: 'last-write-wins',
      sandbox_mode: 'off',
    } });
    writeFileSync(join(root, 'logos/logos-project.yaml'), 'project:\n  name: verify-two-phase\n');
    writeFileSync(join(root, 'logos/resources/test/core-S13-test-cases.md'), '| UT-S13-02 | one |\n| UT-S13-03 | two |\n');

    const output = checked(runCli(root, ['verify', '--format', 'json']), 'two-phase verify');
    const data = parseEnvelope(output).data;
    assert(data.pre_run.mode === 'two_phase', `unexpected pre_run mode: ${data.pre_run.mode}`);
    assert(data.pre_run.commands.every(item => item.status === 'pass'), 'two-phase commands did not pass');
    assert(data.gate.result === 'PASS', 'two-phase verify gate should pass');
  });
}

function smokeLegacySkippedBootstrap() {
  withTempProject('openlogos-smoke-legacy-bootstrap-', root => {
    writeLaunchedProject(root, 'skipped');
    const status = checked(runCli(root, ['status', '--format', 'json']), 'openlogos status');
    const module = parseEnvelope(status).data.modules.find(item => item.id === 'core');
    assert(module.bootstrap === 'adopted', `legacy bootstrap was not normalized: ${module.bootstrap}`);
    const next = checked(runCli(root, ['next']), 'openlogos next');
    // brownfield-adopter（S33）：历史 skipped 与 adopted 一致，引导逆向建基线。
    assert(next.stdout.includes('openlogos baseline-seed begin'), 'legacy bootstrap lost reverse-baseline guidance');
  });
}

function writeSandboxVerifyFixture(root, mode, writesForbidden) {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
  writeFileSync(join(root, 'scripts/verify-result.js'), [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('logos/resources/verify', { recursive: true });",
    "writeFileSync('logos/resources/verify/test-results.jsonl', '{\"id\":\"UT-S13-02\",\"status\":\"pass\"}\\n');",
    ...(writesForbidden ? ["writeFileSync('forbidden.txt', 'blocked');"] : []),
  ].join('\n'));
    writeConfig(root, { verify: {
      result_path: 'logos/resources/verify/test-results.jsonl',
      pre_run_command: 'node scripts/verify-result.js',
      sandbox_mode: mode,
      sandbox_root: tmpdir(),
      sandbox_deny_workspace_write: true,
    } });
  writeFileSync(join(root, 'logos/logos-project.yaml'), 'project:\n  name: verify-sandbox\n');
  writeFileSync(join(root, 'logos/resources/test/core-S13-test-cases.md'), '| UT-S13-02 | sandbox |\n');
}

function smokeVerifyAutoSandbox() {
  withTempProject('openlogos-smoke-verify-auto-', root => {
    writeSandboxVerifyFixture(root, 'auto', false);
    const output = checked(runCli(root, ['verify', '--format', 'json']), 'verify auto sandbox');
    const data = parseEnvelope(output).data;
    assert(data.gate.result === 'PASS', 'verify auto sandbox gate should pass');
    assert(['pass', 'warn'].includes(data.sandbox.status), `unexpected sandbox status: ${data.sandbox.status}`);
    assert(!existsSync(join(root, 'forbidden.txt')), 'verify auto sandbox wrote a forbidden workspace file');
  });
}

function smokeVerifyAlwaysSandbox() {
  withTempProject('openlogos-smoke-verify-always-', root => {
    writeSandboxVerifyFixture(root, 'always', true);
    const output = runCli(root, ['verify', '--format', 'json']);
    assert(output.status !== 0, 'verify always sandbox should reject forbidden writes');
    const data = parseEnvelope(output).data;
    assert(data.gate.result === 'FAIL', 'verify always sandbox gate should fail');
    assert(data.sandbox.status === 'fail', `unexpected sandbox status: ${data.sandbox.status}`);
    assert(!existsSync(join(root, 'forbidden.txt')), 'forbidden verify write escaped the sandbox');
  });
}

function writeNestedSmokeFixture(root, mode, writesForbidden) {
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/test/smoke'), { recursive: true });
  writeFileSync(join(root, 'scripts/smoke-nested.js'), [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "mkdirSync('logos/resources/verify', { recursive: true });",
    "writeFileSync('logos/resources/verify/smoke-results.jsonl', '{\"id\":\"SMOKE-NESTED-01\",\"status\":\"pass\"}\\n');",
    ...(writesForbidden ? ["writeFileSync('forbidden.txt', 'blocked');"] : []),
  ].join('\n'));
  writeConfig(root, { smoke: {
    result_path: 'logos/resources/verify/smoke-results.jsonl',
    report_path: 'logos/resources/verify/smoke-report.md',
    command: 'node scripts/smoke-nested.js',
    sandbox_mode: mode,
    sandbox_root: tmpdir(),
    sandbox_deny_workspace_write: true,
  } });
  writeFileSync(join(root, 'logos/logos-project.yaml'), 'project:\n  name: smoke-sandbox\n');
  writeFileSync(join(root, 'logos/resources/test/smoke/core-smoke-test-cases.md'), '| SMOKE-NESTED-01 | nested sandbox |\n');
}

function smokeAutoSandbox() {
  withTempProject('openlogos-smoke-smoke-auto-', root => {
    writeNestedSmokeFixture(root, 'auto', false);
    const output = checked(runCli(root, ['smoke', '--format', 'json']), 'smoke auto sandbox');
    const data = parseEnvelope(output).data;
    assert(data.gate.result === 'PASS', 'smoke auto sandbox gate should pass');
    assert(['pass', 'warn'].includes(data.sandbox.status), `unexpected sandbox status: ${data.sandbox.status}`);
    assert(!existsSync(join(root, 'forbidden.txt')), 'smoke auto sandbox wrote a forbidden workspace file');
  });
}

function smokeAlwaysSandbox() {
  withTempProject('openlogos-smoke-smoke-always-', root => {
    writeNestedSmokeFixture(root, 'always', true);
    const output = runCli(root, ['smoke', '--format', 'json']);
    assert(output.status !== 0, 'smoke always sandbox should reject forbidden writes');
    const data = parseEnvelope(output).data;
    assert(data.gate.result === 'FAIL', 'smoke always sandbox gate should fail');
    assert(data.sandbox.status === 'fail', `unexpected sandbox status: ${data.sandbox.status}`);
    assert(!existsSync(join(root, 'forbidden.txt')), 'forbidden smoke write escaped the sandbox');
  });
}

function smokeDeployDone() {
  withTempProject('openlogos-smoke-deploy-done-', root => {
    writeLaunchedProject(root);
    const proposalDir = writeProposal(root, 'runtime-change', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 修改运行时代码',
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布本地 CLI',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeFileSync(join(proposalDir, 'LOOP_ITERS'), '{"iter":1,"node":"verify","result":"pass","module":"core"}\n');
    writeFileSync(join(proposalDir, 'SMOKE_PASS'), 'old');
    writeFileSync(join(proposalDir, 'SMOKE_FAIL'), 'old');
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), '# Deployment Report\n\nstaging ok\n');

    const output = checked(runCli(root, ['deploy-done', '--env', 'staging', '--format', 'json']), 'openlogos deploy-done');
    const data = parseEnvelope(output).data;
    assert(data.next_step === 'ready-to-smoke', `unexpected next step: ${data.next_step}`);
    assert(existsSync(join(proposalDir, 'DEPLOY_DONE')), 'DEPLOY_DONE was not written');
    assert(!existsSync(join(proposalDir, 'SMOKE_PASS')), 'old SMOKE_PASS was not cleared');
    assert(!existsSync(join(proposalDir, 'SMOKE_FAIL')), 'old SMOKE_FAIL was not cleared');
    assert(readFileSync(join(proposalDir, 'tasks.md'), 'utf-8').includes('- [x] 发布本地 CLI'), 'deploy task was not checked');

    const status = checked(runCli(root, ['status', '--format', 'json']), 'openlogos status after deploy-done');
    const active = parseEnvelope(status).data.modules.find(item => item.id === 'core').active_change;
    assert(active.proposal_step === 'ready-to-smoke', `unexpected proposal step: ${active.proposal_step}`);
  });
}


// ── contract-self-description（SMOKE-core-49/50）：发布后契约自描述冒烟 ──

const CONTRACT_PROPOSAL = [
  '# 变更提案：contract-smoke',
  '',
  '## 变更原因',
  '契约自描述冒烟。',
  '',
  '## 变更类型',
  '代码级修复',
  '',
  '## 部署影响',
  '- 是否需要部署：否',
  '- 部署原因：纯代码',
  '- 影响环境：无',
  '- 是否涉及数据迁移：否',
  '- 是否需要回滚预案：否',
  '- 是否需要 smoke：否',
  '',
  '## 变更概述',
  '实现契约字段。',
].join('\n');

function smokeContractSelfDescription() {
  // SMOKE-core-49：发布安装后 status/next 真实携带 contract.version（与打包 schema 一致）、step_meta 闭合枚举、facts 六布尔
  withTempProject('openlogos-smoke-contract-', root => {
    writeLaunchedProject(root);
    writeProposal(root, 'contract-smoke', CONTRACT_PROPOSAL,
      '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta\n\n## [code] 代码实现\n（切片由 slice-planner 规划）\n');

    const { entry } = preparePackagedCli();
    const pkgRoot = resolve(entry, '..', '..');
    // code review F9：分别读取两份已安装 schema，各自与对应响应核对（任一漂移即失败）
    // add-feature-model（S34，delta-F1=B）：契约改为**条件版本**——schema 为向后兼容 superset，
    // x-contract-version = 支持集最高版；响应 contract.version ∈ 支持集（$defs.contract.enum），
    // 且 features present ⟺ 1.1.0（见 spec/cli-json-output.md §1.4 调整后的映射校验）。
    const schemaVersions = {};
    const supportedVersions = {};
    for (const name of ['status', 'next']) {
      const schemaPath = join(pkgRoot, 'spec', 'schema', `${name}.schema.json`);
      assert(existsSync(schemaPath), `packed CLI missing spec/schema/${name}.schema.json`);
      const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
      assert(typeof schema['x-contract-version'] === 'string', `${name} schema 缺 x-contract-version`);
      assert(String(schema.$id || '').endsWith(`/${schema['x-contract-version']}`),
        `${name} schema $id(${schema.$id}) 与 x-contract-version(${schema['x-contract-version']}) 不一致`);
      schemaVersions[name] = schema['x-contract-version'];
      const enumVals = schema.$defs?.contract?.properties?.version?.enum;
      assert(Array.isArray(enumVals) && enumVals.length > 0, `${name} schema 缺 $defs.contract.version.enum`);
      assert(enumVals.includes(schema['x-contract-version']),
        `${name} x-contract-version(${schema['x-contract-version']}) 不在支持集(${enumVals})`);
      supportedVersions[name] = enumVals;
    }
    assert(schemaVersions.status === schemaVersions.next,
      `status/next schema 契约版本漂移: ${schemaVersions.status} vs ${schemaVersions.next}`);

    const statusData = parseEnvelope(checked(runCli(root, ['status', '--format', 'json']), 'status --format json')).data;
    const nextData = parseEnvelope(checked(runCli(root, ['next', '--format', 'json']), 'next --format json')).data;
    for (const [name, data] of [['status', statusData], ['next', nextData]]) {
      const v = data.contract?.version;
      // ① 响应版本必须在 schema 支持集内
      assert(data.contract && supportedVersions[name].includes(v),
        `${name} data.contract.version(${v}) 不在 packed ${name} schema 支持集(${supportedVersions[name]})`);
      // ② 条件版本一致性：任一 module 输出 features ⟺ 1.1.0；否则 1.0.0
      const hasFeatures = Array.isArray(data.modules) && data.modules.some(m => m.features !== undefined);
      assert(v === (hasFeatures ? '1.1.0' : '1.0.0'),
        `${name} 条件版本失配: hasFeatures=${hasFeatures} 但 contract.version=${v}`);
    }
    const active = statusData.modules.find(item => item.id === 'core').active_change;
    assert(['pre-implement', 'implement', 'post-implement'].includes(active.step_meta?.phase), `step_meta.phase 非法: ${active.step_meta?.phase}`);
    assert(['produce', 'gate', 'command-required', 'residency'].includes(active.step_meta?.kind), `step_meta.kind 非法: ${active.step_meta?.kind}`);
    const facts = active.facts;
    for (const key of ['spec_complete', 'slices_planned', 'slices_approved', 'code_required', 'has_delta_tasks', 'verify_pass']) {
      assert(typeof facts?.[key] === 'boolean', `facts.${key} 缺失或非布尔`);
    }
    // 与磁盘相符抽样：无 SPEC_MERGED/SLICES_APPROVED/VERIFY_PASS
    assert(facts.spec_complete === false && facts.slices_approved === false && facts.verify_pass === false,
      `facts 与磁盘不符: ${JSON.stringify(facts)}`);
  });
}

function smokeSpecPhaseNoLoopState() {
  // SMOKE-core-50：spec 阶段（未 merge 活跃提案）确不挂 loop_state；step_meta.phase==pre-implement 反面锚成立
  withTempProject('openlogos-smoke-noloop-', root => {
    writeLaunchedProject(root);
    writeProposal(root, 'contract-smoke', CONTRACT_PROPOSAL,
      '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n\n## [code] 代码实现\n（切片由 slice-planner 规划）\n');

    const statusData = parseEnvelope(checked(runCli(root, ['status', '--format', 'json']), 'status --format json')).data;
    const nextData = parseEnvelope(checked(runCli(root, ['next', '--format', 'json']), 'next --format json')).data;
    const mod = statusData.modules.find(item => item.id === 'core');
    assert(mod.active_change.step_meta.phase === 'pre-implement', `spec 阶段 phase 应为 pre-implement: ${mod.active_change.step_meta.phase}`);
    assert(mod.loop_state === undefined, `spec 阶段不得挂 loop_state: ${JSON.stringify(mod.loop_state)}`);
    const nmod = nextData.modules.find(item => item.id === 'core');
    assert(nmod.loop_state === undefined, `next spec 阶段不得挂 loop_state`);
    // 流程未被判死：next 仍给出可执行建议（普通推进）
    assert(typeof nmod.action === 'string' && nmod.action.length > 0, 'next 应给出普通推进建议');
  });
}

const cases = [
  ['SMOKE-core-01', smokeCliPackageVersion],
  ['SMOKE-core-02', smokeInitAssets],
  ['SMOKE-core-04', smokePackageTemplates],
  ['SMOKE-core-05', smokeNoDeployStatus],
  ['SMOKE-core-06', smokeDeployProgress],
  ['SMOKE-core-11', smokeAdoptNextGuidance],
  ['SMOKE-core-12', smokeVerifyWithoutPreRun],
  ['SMOKE-core-13', smokeVerifyTwoPhase],
  ['SMOKE-core-14', smokeLegacySkippedBootstrap],
  ['SMOKE-core-16', smokeVerifyAutoSandbox],
  ['SMOKE-core-17', smokeVerifyAlwaysSandbox],
  ['SMOKE-core-18', smokeAutoSandbox],
  ['SMOKE-core-19', smokeAlwaysSandbox],
  ['SMOKE-core-20', smokeDeployDone],
  ['SMOKE-core-49', smokeContractSelfDescription],
  ['SMOKE-core-50', smokeSpecPhaseNoLoopState],
];

let failed = false;
try {
  for (const [id, fn] of cases) {
    try {
      fn();
      writeSmoke(id, 'pass');
    } catch (error) {
      failed = true;
      writeSmoke(id, 'fail', error);
    }
  }
} finally {
  cleanupPackageFixture();
}

process.exit(failed ? 1 : 0);
