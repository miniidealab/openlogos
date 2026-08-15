#!/usr/bin/env node
/**
 * SMOKE-core-54..58 — baseline-on-touch 发布后真实安装包冒烟。
 * 默认只调用全局已部署 openlogos；OPENLOGOS_BIN 仅供显式本地调试。
 */
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

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
  '## ADDED — S39 完整场景', '', '# S39 目标', '## 参与者', '- User', '- CLI',
  '## 前置与后置', '前置、后置。', '```mermaid', 'sequenceDiagram', '  participant U as User',
  '  participant C as CLI', '  U->>C: 执行步骤', '```', '## 主路径步骤', '1. 执行。',
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
    '# Touch smoke', '', '> module: core', '', '## 基线闭包计划', '', '```yaml',
    JSON.stringify({ baseline_closure: fixedClosure(targets, opts.touched ?? ['S39']) }, null, 2), '```', '',
    '## 变更类型', opts.code === false ? '纯文档' : '设计级', '',
    '## 部署影响', '- 是否需要部署：否', '- 是否需要 smoke：否',
    '', ...completeClarificationSection(),
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

function writeApplyManifest(root, dir, slug, targets) {
  const preparedTargets = targets
    .filter(target => target.delta_path && !['api', 'database'].includes(target.category))
    .map(target => {
      const path = targetPath(target.delta_path);
      const source = readFileSync(join(dir, target.delta_path));
      const before = existsSync(join(root, path)) ? readFileSync(join(root, path)) : null;
      const final = Buffer.from(markdownFinal(root, dir, target));
      return {
        delta_path: target.delta_path, target_path: path, mode: target.mode,
        source_sha256: sha(source), before_sha256: before ? sha(before) : null,
        content_base64: final.toString('base64'), sha256: sha(final),
      };
    });
  const creates = targets.filter(target => target.mode === 'CREATE' && target.delta_path);
  const projectPath = join(root, 'logos/logos-project.yaml');
  const metadata = Buffer.from(`${JSON.stringify({
    project: { name: 'touch-smoke' }, tech_stack: { database: 'sqlite' },
    scenario_counter: { next_id: 40 }, decision_counter: { next_id: 1 },
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', bootstrap: 'normal', product_type: 'cli' }],
    scenarios: [{ id: 'S39', name: '按触达目标形成规格闭包', module: 'core' }],
    resource_index: creates.map(target => ({ path: targetPath(target.delta_path), desc: `${target.category} smoke fixture` })),
  }, null, 2)}\n`);
  const manifest = {
    schema: 'openlogos/baseline-merge-apply@1', slug, prepared_targets: preparedTargets,
    metadata_targets: [{
      target_path: 'logos/logos-project.yaml', mode: 'MODIFY', before_sha256: sha(readFileSync(projectPath)),
      content_base64: metadata.toString('base64'), sha256: sha(metadata),
    }],
  };
  const manifestRel = `logos/changes/${slug}/MERGE_APPLY_MANIFEST.json`;
  writeFileSync(join(root, manifestRel), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestRel;
}

function runCase(id, fn) {
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
  if (merge.status !== 0 || !existsSync(join(dir, 'MERGE_PROMPT.md'))) throw new Error(`真实 merge 未生成受控 prompt：${merge.stderr}`);
  const manifest = writeApplyManifest(root, dir, 'full-create', targets);
  const applied = runCli(root, ['merge-apply', 'full-create', '--manifest', manifest]);
  if (applied.status !== 0) throw new Error(`真实 merge-apply 失败：${applied.stdout}${applied.stderr}`);
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
  const manifest = writeApplyManifest(root, dir, 'fail-closed', targets);
  const rolledBack = runCli(root, ['merge-apply', 'fail-closed', '--manifest', manifest], {
    NODE_ENV: 'test', OPENLOGOS_TEST_MERGE_APPLY_FAIL_AFTER: 'logos/logos-project.yaml',
  });
  if (rolledBack.status === 0 || !`${rolledBack.stderr}`.includes('rolled_back=true')) throw new Error('真实入口故障注入未触发整批回滚');
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

process.exit(failed ? 1 : 0);
