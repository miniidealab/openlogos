#!/usr/bin/env node
/**
 * SMOKE-core-54..58、67..69 — baseline-on-touch / 场景 CREATE 合同发布后真实安装包冒烟。
 * 默认只调用全局已部署 openlogos；OPENLOGOS_BIN 仅供显式本地调试。
 */
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { importInstalledPackageModule, seedInstalledMergeContract } from './lib/seed-installed-merge-contract.mjs';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const selectedCaseIds = new Set((process.env.OPENLOGOS_SMOKE_CASES || '').split(',').map(value => value.trim()).filter(Boolean));
const deployedCandidateBin = process.env.OPENLOGOS_BIN
  || spawnSync('which', ['openlogos'], { encoding: 'utf-8' }).stdout.trim();
const installedTransactionModule = await importInstalledPackageModule('dist/lib/merge-transaction.js', {
  candidateBin: deployedCandidateBin,
  fallbackRoot: repoRoot,
});

function report(id, status, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = { id, status, timestamp: new Date().toISOString(), scenario: 'baseline-on-touch 发布后冒烟' };
  if (error) record.error = String(error).slice(0, 500);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function cliCommand() {
  return process.env.OPENLOGOS_BIN
    ? { command: process.env.OPENLOGOS_BIN, args: [] }
    : { command: 'openlogos', args: [] };
}

function runCli(root, args, extraEnv = {}) {
  const cli = cliCommand();
  const env = { ...process.env, ...extraEnv };
  delete env.OPENLOGOS_SMOKE_RESULT_PATH;
  return spawnSync(cli.command, [...cli.args, ...args], { cwd: root, encoding: 'utf-8', env });
}

function envelope(result) {
  const line = `${result.stdout}\n${result.stderr}`.split('\n').find(v => v.trim().startsWith('{'));
  if (!line) throw new Error(`缺 JSON envelope：${`${result.stdout}\n${result.stderr}`.slice(0, 600)}`);
  return JSON.parse(line);
}

function assertInstalledVersion() {
  if (process.env.OPENLOGOS_BIN) return;
  const expected = JSON.parse(readFileSync(join(repoRoot, 'cli/package.json'), 'utf-8')).version;
  const r = runCli(repoRoot, ['--version']);
  if (r.status !== 0) throw new Error(`全局 openlogos 不可执行：${r.error ?? r.stderr}`);
  if (`${r.stdout}`.trim() !== expected) throw new Error(`全局版本 ${`${r.stdout}`.trim()} != ${expected}`);
}

function withTemp(prefix, fn) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  try { return fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function snapshotTree(root) {
  const snapshot = new Map();
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) snapshot.set(absolute.slice(root.length + 1), sha(readFileSync(absolute)));
    }
  };
  walk(root);
  return JSON.stringify([...snapshot.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')));
}

function resolvedOpenlogosPath() {
  const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['openlogos'], { encoding: 'utf-8' });
  if (lookup.status !== 0) throw new Error(`无法解析全局 openlogos 路径：${lookup.stderr}`);
  return `${lookup.stdout}`.trim().split(/\r?\n/)[0];
}

function npmGlobalRoot() {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`无法解析 npm global root：${result.stderr}`);
  return `${result.stdout}`.trim();
}

function npmGlobalPrefix() {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['prefix', '-g'], { encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`无法解析 npm global prefix：${result.stderr}`);
  return `${result.stdout}`.trim();
}

function installGlobalTarball(path) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '-g', path], {
    encoding: 'utf-8', env: process.env,
  });
  if (result.status !== 0) throw new Error(`npm install -g ${path} 失败：${result.stderr || result.stdout}`);
}

function targetPath(deltaPath) {
  const roots = {
    prd: 'logos/resources/prd', api: 'logos/resources/api', database: 'logos/resources/database',
    scenario: 'logos/resources/scenario', test: 'logos/resources/test', decisions: 'logos/resources/decisions',
    spec: 'spec', skills: 'skills',
  };
  const parts = deltaPath.split('/');
  return `${roots[parts[1]]}/${parts.slice(2).join('/')}`;
}

function baseProject(root, seed = null) {
  mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
  mkdirSync(join(root, 'logos/changes'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 'touch-smoke', locale: 'zh' }, null, 2));
  seedInstalledMergeContract(root, { candidateBin: deployedCandidateBin, fallbackRoot: repoRoot });
  writeFileSync(join(root, 'logos/logos-project.yaml'), [
    'project:', '  name: touch-smoke', 'tech_stack:', '  database: sqlite',
    'scenario_counter:', '  next_id: 39', 'decision_counter:', '  next_id: 1',
    'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', `    bootstrap: ${seed ? 'adopted' : 'normal'}`,
    ...(seed ? [`    baseline_seed_state: ${seed}`] : []), '    product_type: cli', 'scenarios: []', 'resource_index: []',
  ].join('\n') + '\n');
}

function fixedClosure(targets, touched = ['S39']) {
  return {
    policy: 'on-touch-v1', schema_version: 1, unit: 'canonical-merge-target-path',
    delta_cardinality: 'exactly-one-per-non-skip-target',
    effective_view: 'merged-resources-plus-current-change-deltas',
    ambiguity: 'block-before-existing-plan-exit', standalone_baseline_required: false,
    jit_confirmation: 'disabled', touched_scenario_ids: touched, targets,
  };
}

function material(category, deltaPath, ids = ['S39'], mode = 'MODIFY') {
  return {
    category, scenario_ids: ids, mode, delta_path: deltaPath,
    reason: `${category} 被本次场景触达。`, evidence: [`${mode === 'CREATE' ? 'target_absent' : 'target_exists'}: ${targetPath(deltaPath)}`],
    missing_evidence: [],
  };
}

function skip(category, ids = ['S39']) {
  return { category, scenario_ids: ids, mode: 'SKIP', delta_path: null, reason: `${category} 不适用。`, evidence: [`scenario:${ids[0]}`], missing_evidence: [] };
}

function standardTargets(ids = ['S39']) {
  return [
    material('requirement', 'deltas/prd/1-product-requirements/core-req.md', ids),
    material('feature', 'deltas/prd/2-product-design/1-feature-specs/core-feature.md', ids),
    material('architecture', 'deltas/prd/3-technical-plan/1-architecture/core-arch.md', ids),
    material('scenario', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S39.md', ids),
    material('test', 'deltas/test/core-S39-test-cases.md', ids),
    skip('api', ids), skip('database', ids), skip('deployment', ids), skip('orchestration', ids), skip('smoke', ids),
  ];
}

function completeClarificationSection() {
  return [
    '## 决策澄清', '', '```yaml',
    'schema: openlogos/clarification@1',
    'mode: adaptive',
    'status: complete',
    'impacts:',
    '  data:',
    '    status: none',
    '    reason: 冒烟夹具不改变数据结构或数据处理方式',
    '  compatibility:',
    '    status: none',
    '    reason: 冒烟夹具不改变对外兼容契约',
    '  security_privacy:',
    '    status: none',
    '    reason: 冒烟夹具不处理安全或隐私数据',
    '  public_release:',
    '    status: none',
    '    reason: 冒烟夹具不执行公开发布',
    '  external_commitment:',
    '    status: none',
    '    reason: 冒烟夹具不产生外部承诺',
    'decisions: []',
    'unresolved: []',
    'defaults: []',
    '```', '',
  ];
}

const scenarioDelta = [
  '## ADDED — S39 完整场景', '', '# S39 目标', '## 场景目标', '验证完整场景。',
  '## 参与者', '- User', '- CLI', '## 前置条件', '前置成立。', '## 成功后置条件', '后置一致。',
  '## 时序图', '```mermaid', 'sequenceDiagram', '  participant U as User',
  '  participant C as CLI', '  U->>C: 执行步骤', '```', '## 步骤说明',
  '1. 用户发起。', '2. CLI 校验。', '3. CLI 返回。',
  '## 异常与边界', '- 异常关闭。', '## 追溯', '- P04',
].join('\n') + '\n';

const testDelta = [
  '## ADDED — S39 完整测试', '', '# S39 测试', '## 正常路径正例',
  '| ID | 场景 |', '|---|---|', '| UT-S39-01 | 正常 |', '| ST-S39-01 | 端到端 |',
  '## 异常', '失败关闭。', '## 边界', '空输入。', '## 追溯', 'S39。',
  '## OpenLogos reporter', '写入 test-results.jsonl。',
].join('\n') + '\n';

const orchestrationDelta = [
  '## ADDED — S39 编排', '', '# 调用链', '请求链。', '## fixture', '准备。',
  '## 断言', '响应。', '## cleanup', '清理。', '## 失败诊断', '输出诊断。',
  '## OpenLogos reporter', '写 test-results.jsonl。',
].join('\n') + '\n';

const openApi = [
  'openapi: 3.1.0', 'info:', '  title: Touch', '  version: 1.0.0', 'paths:', '  /touch:',
  '    get:', '      operationId: getTouch', '      security:', '        - bearerAuth: []', '      responses:',
  "        '200':", '          description: ok', "        '400':", '          description: error',
  'components:', '  securitySchemes:', '    bearerAuth:', '      type: http', '      scheme: bearer',
  '  schemas:', '    Touch:', '      type: object', '      deprecated: false # compatibility',
].join('\n') + '\n';

const sqlite = [
  '-- migration: create touch', '-- rollback: DROP TABLE touch;', 'CREATE TABLE touch (',
  ' id INTEGER PRIMARY KEY,', ' name TEXT NOT NULL UNIQUE,',
  ' CONSTRAINT name_check CHECK(length(name) > 0)', ');', 'CREATE INDEX idx_touch_name ON touch(name);',
].join('\n') + '\n';

function writeProposal(root, slug, targets, opts = {}) {
  const dir = join(root, 'logos/changes', slug); mkdirSync(dir, { recursive: true });
  for (const t of targets.filter(t => t.delta_path && t.mode === 'MODIFY')) {
    const path = join(root, targetPath(t.delta_path)); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '# Existing\n');
  }
  const proposal = [
    '# Touch smoke', '', '> module: core', '',
    '## 变更原因', '验证 baseline-on-touch 发布态闭环。', '',
    '## 变更类型', opts.code === false ? '设计级（纯文档）' : '设计级', '',
    '## 变更范围', '- 仅修改隔离 smoke 临时项目中的规格夹具。', '',
    '## 部署影响',
    '- 是否需要部署：否',
    '- 部署原因：仅验证隔离 smoke 夹具',
    '- 影响环境：隔离临时目录',
    '- 是否涉及数据迁移：否',
    '- 是否需要回滚预案：否',
    '- 是否需要 smoke：否', '',
    '## 变更概述', '验证基线闭包计划、受控合并与失败回滚。', '',
    ...completeClarificationSection(),
    '## 基线闭包计划', '', '```yaml',
    JSON.stringify({ baseline_closure: fixedClosure(targets, opts.touched ?? ['S39']) }, null, 2), '```', '',
  ].join('\n');
  writeFileSync(join(dir, 'proposal.md'), proposal);
  const tasks = targets.filter(t => t.delta_path).map(t => `- [${opts.checked ? 'x' : ' '}] [${t.mode}] \`${t.delta_path}\`：${t.reason}`).join('\n');
  writeFileSync(join(dir, 'tasks.md'), `# 任务\n\n## [delta] 规格变更\n\n${tasks}\n\n## [code] 代码实现\n`);
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  if (opts.deltas) {
    for (const t of targets.filter(t => t.delta_path)) {
      const path = join(dir, t.delta_path); mkdirSync(dirname(path), { recursive: true });
      let content = '## ADDED — Touch update\n\n最终态。\n';
      if (t.category === 'scenario' && t.mode === 'CREATE') content = scenarioDelta;
      if (t.category === 'test' && t.mode === 'CREATE') content = testDelta;
      if (t.category === 'orchestration') content = orchestrationDelta;
      if (t.category === 'api') content = `## ADDED — ${targetPath(t.delta_path)}（新文件，整文件）\n${openApi}`;
      if (t.category === 'database') content = `## ADDED — ${targetPath(t.delta_path)}（新文件，整文件）\n${sqlite}`;
      writeFileSync(path, content);
    }
  }
  return dir;
}

function apiDbTargets() {
  return [
    material('api', 'deltas/api/touch.yaml', ['S39'], 'CREATE'),
    material('database', 'deltas/database/touch.sql', ['S39'], 'CREATE'),
    material('requirement', 'deltas/prd/1-product-requirements/core-req.md'),
    material('feature', 'deltas/prd/2-product-design/1-feature-specs/core-feature.md'),
    material('architecture', 'deltas/prd/3-technical-plan/1-architecture/core-arch.md'),
    material('scenario', 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S39.md', ['S39'], 'CREATE'),
    material('orchestration', 'deltas/scenario/core-S39-orchestration.md', ['S39'], 'CREATE'),
    material('test', 'deltas/test/core-S39-test-cases.md', ['S39'], 'CREATE'),
    skip('deployment'), skip('smoke'),
  ];
}

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function markdownFinal(root, dir, target) {
  const source = readFileSync(join(dir, target.delta_path), 'utf-8');
  const material = source.replace(/^## ADDED\s+[—-]\s*/, '## ');
  if (target.mode === 'CREATE') return material;
  return `${readFileSync(join(root, targetPath(target.delta_path)), 'utf-8').trimEnd()}\n\n${material}`;
}

function completeTransaction(root, dir, slug, targets, applyEnv = {}) {
  let transaction = envelope(runCli(root, ['merge', 'transaction', 'status', '--slug', slug, '--format', 'json'])).data.merge_transaction;
  const plannedBySlot = new Map(installedTransactionModule.listMergeTransactionPlanTargets(dir)
    .map(target => [target.slot_id, target]));
  for (const slot of transaction.content_slots.items.filter(item => item.submitted_sha256 === null)) {
    const planned = plannedBySlot.get(slot.slot_id);
    if (!planned) throw new Error(`transaction slot 无内部计划身份：${slot.slot_id}`);
    const target = targets.find(item => item.delta_path && targetPath(item.delta_path) === planned.target_path);
    if (!target) throw new Error(`transaction slot 无对应 target：${planned.target_path}`);
    const contentPath = join(root, ...slot.staging_path.split('/'));
    mkdirSync(dirname(contentPath), { recursive: true });
    writeFileSync(contentPath, Buffer.from(markdownFinal(root, dir, target)));
    const submitted = runCli(root, [
      'merge', 'transaction', 'submit-content', '--slug', slug, '--slot', slot.slot_id,
      '--file', contentPath, '--format', 'json',
    ]);
    if (submitted.status !== 0) throw new Error(`submit-content 失败：${submitted.stdout}${submitted.stderr}`);
  }
  const sealed = runCli(root, ['merge', 'transaction', 'seal', '--slug', slug, '--format', 'json']);
  if (sealed.status !== 0) throw new Error(`seal 失败：${sealed.stdout}${sealed.stderr}`);
  const applied = runCli(root, ['merge', 'transaction', 'apply', '--slug', slug, '--format', 'json'], applyEnv);
  transaction = applied.status === 0 ? envelope(applied).data.merge_transaction : transaction;
  return { applied, transaction };
}

function scenarioCreateTargets() {
  const targets = standardTargets();
  const scenario = targets.find(target => target.category === 'scenario');
  scenario.mode = 'CREATE';
  scenario.evidence = [`target_absent: ${targetPath(scenario.delta_path)}`];
  return targets;
}

function prepareScenarioCreate(root, content, slug = 'scenario-create-contract') {
  baseProject(root);
  const targets = scenarioCreateTargets();
  const dir = writeProposal(root, slug, targets, { checked: true, deltas: true });
  const scenario = targets.find(target => target.category === 'scenario');
  const test = targets.find(target => target.category === 'test');
  writeFileSync(join(dir, scenario.delta_path), content);
  writeFileSync(join(dir, test.delta_path), testDelta);
  return { dir, targets, scenario };
}

function runCase(id, fn) {
  if (selectedCaseIds.size > 0 && !selectedCaseIds.has(id)) return true;
  try { fn(); report(id, 'pass'); } catch (e) { report(id, 'fail', e); return false; }
  return true;
}

assertInstalledVersion();
let failed = false;

failed = !runCase('SMOKE-core-54', () => withTemp('touch-smoke-54-', root => {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'existing-touch' }));
  const adopted = runCli(root, ['adopt', '--locale', 'zh', '--ai-tool', 'cursor']);
  if (adopted.status !== 0 || !`${adopted.stdout}`.includes('openlogos change <slug>')) throw new Error('adopt 未给 direct-change 主提示');
  for (const state of ['required', 'partial', 'seeded']) {
    const yamlPath = join(root, 'logos/logos-project.yaml');
    writeFileSync(yamlPath, readFileSync(yamlPath, 'utf-8').replace(/baseline_seed_state:\s*(required|partial|seeded)/, `baseline_seed_state: ${state}`));
    const n = runCli(root, ['next', '--format', 'json']); const data = envelope(n).data;
    if (n.status !== 0 || data.command !== 'openlogos change <slug>') throw new Error(`seed=${state} 未 direct-change`);
  }
  const broken = join(root, 'logos/resources/verify/baseline-seed-runs/broken'); mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, 'commit-journal.json'), '{broken');
  for (const cmd of [['next', '--format', 'json'], ['status', '--format', 'json']]) {
    const r = runCli(root, cmd); if (r.status === 0 || !`${r.stderr}`.includes('baseline_commit_in_progress')) throw new Error(`${cmd[0]} 未被损坏 journal 硬阻断`);
  }
  const change = runCli(root, ['change', 'must-not-exist']);
  if (change.status === 0 || !`${change.stderr}`.includes('baseline_commit_in_progress')) throw new Error('change 未被损坏 journal 硬阻断');
  if (existsSync(join(root, 'logos/changes/must-not-exist')) || existsSync(join(root, 'logos/.openlogos-guard'))) throw new Error('change 硬门失败后仍写 proposal/guard');
})) || failed;

failed = !runCase('SMOKE-core-55', () => withTemp('touch-smoke-55-', root => {
  baseProject(root); const targets = standardTargets(['S05', 'S39']); writeProposal(root, 'closure-plan', targets, { touched: ['S05', 'S39'], code: false });
  let r = runCli(root, ['change-lint', '--format', 'json']); let env = envelope(r);
  if (r.status !== 0 || env.data.baseline_closure?.stage !== 'plan') throw new Error(`合法 P==T plan 未通过：${r.stdout}${r.stderr}`);
  targets.push({ ...targets[0], evidence: ['duplicate'] }); writeProposal(root, 'closure-plan', targets, { touched: ['S05', 'S39'], code: false });
  r = runCli(root, ['change-lint', '--format', 'json']); env = envelope(r);
  if (r.status !== 2 || !env.data.violations.some(v => v.code === 'delta_target_duplicate')) throw new Error('重复 canonical target 未被 L9 拒绝');
})) || failed;

failed = !runCase('SMOKE-core-56', () => withTemp('touch-smoke-56-', root => {
  baseProject(root); const targets = apiDbTargets(); const dir = writeProposal(root, 'full-create', targets, { checked: true, deltas: true });
  const lint = runCli(root, ['change-lint', '--format', 'json']);
  if (lint.status !== 0) throw new Error(`全量 CREATE/non-Markdown 预检失败：${lint.stdout}${lint.stderr}`);
  const merge = runCli(root, ['merge', 'full-create']);
  if (merge.status !== 0 || !existsSync(join(dir, 'MERGE_TRANSACTION.json'))) throw new Error(`真实 merge 未创建 transaction：${merge.stderr}`);
  const { applied, transaction } = completeTransaction(root, dir, 'full-create', targets);
  if (applied.status !== 0 || transaction.phase !== 'completed' || !transaction.receipt) {
    throw new Error(`真实 transaction apply 失败：${applied.stdout}${applied.stderr}`);
  }
  const sqlRun = spawnSync('sqlite3', [':memory:'], { input: readFileSync(join(root, 'logos/resources/database/touch.sql'), 'utf-8'), encoding: 'utf-8' });
  if (sqlRun.status !== 0) throw new Error(`SQLite 目标不可执行：${sqlRun.stderr}`);
  if (!readFileSync(join(root, 'logos/resources/api/touch.yaml'), 'utf-8').includes('openapi: 3.1.0')) throw new Error('OpenAPI 未落最终 payload');
  if (readFileSync(join(root, 'logos/resources/api/touch.yaml'), 'utf-8').startsWith('## ADDED')) throw new Error('控制 marker 泄漏到正式目标');
  const project = readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8');
  if (!existsSync(join(dir, 'SPEC_MERGED')) || !project.includes('logos/resources/api/touch.yaml')) throw new Error('marker/resource_index 未在成功事务落盘');
})) || failed;

failed = !runCase('SMOKE-core-57', () => withTemp('touch-smoke-57-', root => {
  baseProject(root); const targets = apiDbTargets(); const dir = writeProposal(root, 'fail-closed', targets, { checked: true, deltas: true });
  const before = new Map(targets.filter(target => target.mode === 'MODIFY').map(target => {
    const path = targetPath(target.delta_path); return [path, readFileSync(join(root, path), 'utf-8')];
  }));
  const beforeYaml = readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8');
  const mergeReady = runCli(root, ['merge', 'fail-closed']);
  if (mergeReady.status !== 0) throw new Error(`故障注入前 merge 失败：${mergeReady.stderr}`);
  const { applied: rolledBack } = completeTransaction(root, dir, 'fail-closed', targets, {
    NODE_ENV: 'test', OPENLOGOS_TEST_MERGE_TX_FAIL_AFTER: 'logos/resources/api/touch.yaml',
  });
  const afterFailure = envelope(runCli(root, ['merge', 'transaction', 'status', '--slug', 'fail-closed', '--format', 'json'])).data.merge_transaction;
  if (rolledBack.status === 0 || afterFailure.phase !== 'sealed') throw new Error('真实入口故障注入未回滚到可重试 sealed');
  for (const [path, bytes] of before) if (readFileSync(join(root, path), 'utf-8') !== bytes) throw new Error(`回滚未恢复 ${path}`);
  if (readFileSync(join(root, 'logos/logos-project.yaml'), 'utf-8') !== beforeYaml) throw new Error('回滚未恢复 index/counter');
  for (const p of ['logos/resources/api/touch.yaml', 'logos/resources/database/touch.sql', 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S39.md', 'logos/resources/scenario/core-S39-orchestration.md', 'logos/resources/test/core-S39-test-cases.md']) {
    if (existsSync(join(root, p))) throw new Error(`回滚残留 ${p}`);
  }
  if (existsSync(join(dir, 'SPEC_MERGED')) || existsSync(join(dir, 'MERGE_PROMPT.md'))) throw new Error('失败仍保留 marker/prompt');
  const sqlDelta = join(dir, 'deltas/database/touch.sql'); writeFileSync(sqlDelta, readFileSync(sqlDelta, 'utf-8').replace('CREATE TABLE', 'CREATE TABL'));
  const beforeRequirement = readFileSync(join(root, 'logos/resources/prd/1-product-requirements/core-req.md'), 'utf-8');
  const lint = runCli(root, ['change-lint', '--format', 'json']);
  if (lint.status !== 2 || !envelope(lint).data.violations.some(v => v.code === 'non_markdown_delta_invalid')) throw new Error('坏 SQL 未在 L9 fail-closed');
  const merge = runCli(root, ['merge', 'fail-closed']);
  if (merge.status === 0) throw new Error('merge 纵深未拒绝坏 SQL');
  if (existsSync(join(dir, 'MERGE_PROMPT.md')) || existsSync(join(dir, 'SPEC_MERGED'))) throw new Error('失败仍写 merge marker/prompt');
  if (readFileSync(join(root, 'logos/resources/prd/1-product-requirements/core-req.md'), 'utf-8') !== beforeRequirement) throw new Error('失败改写既有目标');
})) || failed;

failed = !runCase('SMOKE-core-58', () => withTemp('touch-smoke-58-', root => {
  baseProject(root, 'seeded');
  const next = runCli(root, ['next', '--format', 'json']); const status = runCli(root, ['status', '--format', 'json']);
  const bytes = `${next.stdout}${next.stderr}${status.stdout}${status.stderr}`;
  if (next.status !== 0 || status.status !== 0) throw new Error('seeded direct-change 状态读取失败');
  if (!bytes.includes('openlogos change <slug>')) throw new Error('seeded 主动作不是 direct-change');
  if (/baseline_warnings|confirmed_(?:by|at)|verified\s*:\s*true|JIT advisory/i.test(bytes)) throw new Error('旧确认/JIT 通道复活');
  const launched = readFileSync(join(repoRoot, 'spec/flow/launched.yaml'), 'utf-8');
  if ((launched.match(/^\s*-\s+id:\s*plan\s*$/gm) ?? []).length !== 1 || /add-baseline-docs/.test(launched)) throw new Error('plan gate 数量或 baseline fixture 回归');
})) || failed;

failed = !runCase('SMOKE-core-67', () => {
  const packageJson = JSON.parse(readFileSync(join(repoRoot, 'cli/package.json'), 'utf-8'));
  const expectedVersion = packageJson.version;
  if (packageJson.version !== expectedVersion) throw new Error(`待部署包版本 ${packageJson.version} != ${expectedVersion}`);

  const packageRoot = process.env.OPENLOGOS_BIN
    ? repoRoot
    : join(npmGlobalRoot(), '@miniidealab/openlogos');
  const assetPaths = process.env.OPENLOGOS_BIN
    ? [
      'spec/baseline-closure.md', 'spec/change-management.md',
      'skills/change-writer/SKILL.md', 'skills/scenario-architect/SKILL.md',
    ]
    : [
      'spec/baseline-closure.md', 'spec/change-management.md',
      'skills/change-writer/SKILL.md', 'skills/scenario-architect/SKILL.md',
    ];
  for (const asset of assetPaths) if (!existsSync(join(packageRoot, asset))) throw new Error(`安装包缺少 ${asset}`);

  if (!process.env.OPENLOGOS_BIN) {
    const commandPath = resolvedOpenlogosPath();
    const prefix = npmGlobalPrefix();
    if (!commandPath.startsWith(resolve(prefix))) throw new Error(`openlogos 路径不在 npm prefix：${commandPath}`);
    const installed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
    const claude = JSON.parse(readFileSync(join(packageRoot, 'claude-plugin-template/.claude-plugin/plugin.json'), 'utf-8'));
    const codex = JSON.parse(readFileSync(join(packageRoot, 'codex-plugin-template/plugin.json'), 'utf-8'));
    for (const [name, version] of [['CLI', installed.version], ['Claude plugin', claude.version], ['Codex plugin', codex.version]]) {
      if (version !== expectedVersion) throw new Error(`${name} 版本 ${version} != ${expectedVersion}`);
    }
  }
}) || failed;

failed = !runCase('SMOKE-core-68', () => {
  const aliases = ['步骤说明', '主流程', '主路径步骤', '主路径', '正常流程', 'main path'];
  for (const alias of aliases) withTemp('touch-smoke-68-valid-', root => {
    const content = scenarioDelta.replace('## 步骤说明', `## ${alias}`);
    prepareScenarioCreate(root, content, `valid-${aliases.indexOf(alias)}`);
    const before = snapshotTree(root);
    const lint = runCli(root, ['change-lint', '--format', 'json']);
    if (lint.status !== 0 || envelope(lint).data.pass !== true) throw new Error(`${alias} 未通过：${lint.stdout}${lint.stderr}`);
    if (snapshotTree(root) !== before) throw new Error(`${alias} lint 非只读`);
  });

  const stepBlock = '## 步骤说明\n1. 用户发起。\n2. CLI 校验。\n3. CLI 返回。\n';
  const invalid = [
    scenarioDelta.replace(stepBlock, '普通散文提到步骤但没有章节。\n'),
    scenarioDelta.replace(stepBlock, '```markdown\n## 步骤说明\n1. 假一\n2. 假二\n3. 假三\n```\n'),
    scenarioDelta.replace('2. CLI 校验。\n3. CLI 返回。\n', ''),
    scenarioDelta.replace('```mermaid', '```text'),
    scenarioDelta.replace('## 异常与边界\n- 异常关闭。', '## 异常与边界'),
    scenarioDelta.replace('## 追溯\n- P04', '## 追溯'),
  ];
  for (const [index, content] of invalid.entries()) withTemp('touch-smoke-68-invalid-', root => {
    prepareScenarioCreate(root, content, `invalid-${index}`);
    const before = snapshotTree(root);
    const lint = runCli(root, ['change-lint', '--format', 'json']);
    const data = envelope(lint).data;
    if (lint.status !== 2 || !data.violations.some(v => v.code === 'create_target_incomplete')) {
      throw new Error(`反例 ${index} 未 fail-closed：${lint.stdout}${lint.stderr}`);
    }
    if (snapshotTree(root) !== before) throw new Error(`反例 ${index} lint 非只读`);
  });
}) || failed;

failed = !runCase('SMOKE-core-69', () => {
  withTemp('touch-smoke-69-', root => {
    const invalid = scenarioDelta.replace(
      '## 步骤说明\n1. 用户发起。\n2. CLI 校验。\n3. CLI 返回。\n',
      '普通散文包含步骤，但没有权威步骤章节。\n',
    );
    const { dir } = prepareScenarioCreate(root, invalid, 'missing-steps');
    const before = snapshotTree(root);
    const lint = runCli(root, ['change-lint', '--format', 'json']);
    if (lint.status !== 2 || !envelope(lint).data.violations.some(v => v.code === 'create_target_incomplete')) {
      throw new Error(`缺步骤 lint 未拒绝：${lint.stdout}${lint.stderr}`);
    }
    const merge = runCli(root, ['merge', 'missing-steps']);
    if (merge.status === 0 || !`${merge.stderr}`.includes('create_target_incomplete')) throw new Error('缺步骤 merge 未拒绝');
    if (existsSync(join(dir, 'MERGE_PROMPT.md')) || existsSync(join(dir, 'SPEC_MERGED'))) throw new Error('失败留下 merge 产物');
    if (snapshotTree(root) !== before) throw new Error('lint/merge 失败改变项目字节');
  });

  if (process.env.OPENLOGOS_BIN) return;
  const rollbackTarball = process.env.OPENLOGOS_S39_ROLLBACK_TARBALL;
  const deployTarball = process.env.OPENLOGOS_S39_DEPLOY_TARBALL;
  const rollbackSha = process.env.OPENLOGOS_S39_ROLLBACK_SHA256;
  if (!rollbackTarball && !deployTarball && !rollbackSha) return;
  if (!rollbackTarball || !deployTarball || !rollbackSha) throw new Error('S39 历史回滚环境变量不完整');
  if (sha(readFileSync(rollbackTarball)) !== rollbackSha) throw new Error('0.13.26 回滚 tarball 哈希不一致');
  const originalPath = resolvedOpenlogosPath();
  try {
    installGlobalTarball(rollbackTarball);
    const rolledBack = runCli(repoRoot, ['--version']);
    if (rolledBack.status !== 0 || `${rolledBack.stdout}`.trim() !== '0.13.26') throw new Error('未精确恢复 0.13.26');
    if (resolvedOpenlogosPath() !== originalPath) throw new Error('回滚后命令路径漂移');
  } finally {
    installGlobalTarball(deployTarball);
  }
  const restored = runCli(repoRoot, ['--version']);
  if (restored.status !== 0 || `${restored.stdout}`.trim() !== '0.13.27') throw new Error('回滚演练后未恢复 0.13.27');
  if (resolvedOpenlogosPath() !== originalPath) throw new Error('恢复 0.13.27 后命令路径漂移');
}) || failed;

process.exit(failed ? 1 : 0);
