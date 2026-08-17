#!/usr/bin/env node
/**
 * SMOKE-core-59..61 — plan-decision-clarification 发布后冒烟。
 *
 * 默认只调用已部署的全局 openlogos；OPENLOGOS_BIN 仅供开发期显式覆盖。
 */
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const resultPath = resolve(
  repoRoot,
  process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl',
);
const requireFromCli = createRequire(join(repoRoot, 'cli/package.json'));

function writeSmoke(id, status, startedAt, error) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id,
    status,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    scenario: '决策澄清协议发布后冒烟',
  };
  if (error) record.error = String(error instanceof Error ? error.message : error).slice(0, 1000);
  appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
}

function cliCommand() {
  return process.env.OPENLOGOS_BIN || 'openlogos';
}

function run(command, args, cwd = repoRoot) {
  const env = { ...process.env };
  delete env.OPENLOGOS_SMOKE_RESULT_PATH;
  return spawnSync(command, args, { cwd, encoding: 'utf-8', env });
}

function runCli(root, args) {
  return run(cliCommand(), args, root);
}

function assertOk(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label} 失败：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
}

function parseEnvelope(result, label) {
  assertOk(result, label);
  try {
    return JSON.parse(result.stdout.trim()).data;
  } catch (error) {
    throw new Error(`${label} 未返回合法 JSON envelope：${error}`);
  }
}

function npmValue(args) {
  const result = run('npm', args);
  assertOk(result, `npm ${args.join(' ')}`);
  return result.stdout.trim();
}

function smokeInstalledVersion() {
  const localPackage = JSON.parse(readFileSync(join(repoRoot, 'cli/package.json'), 'utf-8'));
  const expected = localPackage.version;
  const localPlugin = JSON.parse(readFileSync(join(repoRoot, 'plugin/.claude-plugin/plugin.json'), 'utf-8'));
  if (localPackage.version !== expected || localPlugin.version !== expected) {
    throw new Error(`仓库版本元数据不一致：cli=${localPackage.version} plugin=${localPlugin.version}`);
  }

  const version = runCli(repoRoot, ['--version']);
  assertOk(version, 'openlogos --version');
  if (version.stdout.trim() !== expected) throw new Error(`已部署 CLI 版本不是 ${expected}：${version.stdout.trim()}`);

  if (process.env.OPENLOGOS_BIN) return;
  const prefix = realpathSync(npmValue(['prefix', '-g']));
  const lookup = run(process.platform === 'win32' ? 'where' : 'which', ['openlogos']);
  assertOk(lookup, '解析全局 openlogos 命令');
  const commandPath = realpathSync(lookup.stdout.trim().split(/\r?\n/)[0]);
  const commandRelative = relative(prefix, commandPath);
  if (commandRelative.startsWith('..') || isAbsolute(commandRelative)) {
    throw new Error(`openlogos 命令 ${commandPath} 不在当前 npm 全局 prefix ${prefix} 下`);
  }

  const packageRoot = join(npmValue(['root', '-g']), '@miniidealab', 'openlogos');
  const installedPackage = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8'));
  const installedPlugin = JSON.parse(readFileSync(join(packageRoot, 'claude-plugin-template/.claude-plugin/plugin.json'), 'utf-8'));
  if (installedPackage.version !== expected || installedPlugin.version !== expected) {
    throw new Error(`全局安装包版本不一致：package=${installedPackage.version} plugin=${installedPlugin.version}`);
  }
  for (const relativePath of ['spec/schema/status.schema.json', 'spec/schema/next.schema.json', 'skills/change-writer/SKILL.md']) {
    if (!existsSync(join(packageRoot, relativePath))) throw new Error(`全局安装包缺少 ${relativePath}`);
  }
}

function clarificationYaml(kind) {
  const impacts = kind === 'compatibility'
    ? ['  compatibility:', '    status: required', '    reason: 需要确认宿主兼容策略']
    : ['  compatibility:', '    status: none', '    reason: 不涉及兼容性变化'];
  const decisions = kind === 'compatibility'
    ? [
      'decisions:',
      '  - id: C01',
      '    category: ownership',
      '    question: 谁负责协议消费？',
      '    answer: RunLogos',
      '    rationale: 跨进程编排属于宿主职责',
      '    source: user',
      '    affects:',
      '      - proposal',
      '    rejected_options: []',
    ]
    : ['decisions: []'];
  const unresolved = kind === 'compatibility'
    ? [
      'unresolved:',
      '  - id: C02',
      '    category: compatibility',
      '    depends_on:',
      '      - C01',
      '    question: 是否保持旧宿主兼容？',
      '    impact: 影响旧版 RunLogos 是否能继续消费',
      '    recommendation: 保持兼容并使用版本握手',
      '    recommendation_reason: 降低升级中断风险',
      '    options:',
      '      - id: compatible',
      '        label: 保持兼容',
      '        tradeoff: 需要维护版本分支',
    ]
    : [
      'unresolved:',
      '  - id: C01',
      '    category: deployment',
      '    depends_on: []',
      '    question: 采用哪种部署方式？',
      '    impact: 影响安装位置与回滚方式',
      '    recommendation: 本地 npm 全局安装',
      '    recommendation_reason: 与当前发布验证链路一致',
      '    options:',
      '      - id: npm-global',
      '        label: npm 全局安装',
      '        tradeoff: 需要保留旧版本回滚包',
    ];
  return [
    'schema: openlogos/clarification@1',
    'mode: adaptive',
    'status: pending',
    'impacts:',
    '  data:',
    '    status: none',
    '    reason: 不涉及数据变化',
    ...impacts,
    '  security_privacy:',
    '    status: none',
    '    reason: 不涉及安全或隐私变化',
    '  public_release:',
    '    status: none',
    '    reason: 本用例不执行公开发布',
    '  external_commitment:',
    '    status: none',
    '    reason: 不涉及外部承诺',
    ...decisions,
    ...unresolved,
    'defaults: []',
  ].join('\n');
}

function scaffold(root, kind) {
  const deploy = kind === 'deployment';
  mkdirSync(join(root, 'logos/changes/feat'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 'clarification-smoke', locale: 'zh' }, null, 2));
  writeFileSync(join(root, 'logos/logos-project.yaml'), [
    'project:', '  name: clarification-smoke', 'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', '    product_type: cli',
  ].join('\n'));
  writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
  writeFileSync(join(root, 'logos/changes/feat/proposal.md'), [
    '# 变更提案：feat', '', '> module: core', '', '## 变更原因', '验证决策澄清协议。', '',
    '## 变更类型', '设计级', '', '## 变更范围', '- status / next', '', '## 部署影响',
    `- 是否需要部署：${deploy ? '是' : '否'}`, '- 部署原因：发布后冒烟', '- 影响环境：本地',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', `- 是否需要 smoke：${deploy ? '是' : '否'}`, '',
    '## 决策澄清', '', '```yaml', clarificationYaml(kind), '```', '', '## 变更概述', '验证机器契约。',
  ].join('\n'));
  writeFileSync(join(root, 'logos/changes/feat/tasks.md'), '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta\n');
}

function withTempProject(kind, fn) {
  const root = mkdtempSync(join(tmpdir(), `openlogos-clarification-${kind}-`));
  try {
    scaffold(root, kind);
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function validators() {
  const Ajv2020 = requireFromCli('ajv/dist/2020.js').default;
  const addFormats = requireFromCli('ajv-formats').default;
  return name => {
    const ajv = new Ajv2020({ strict: false, allowUnionTypes: true });
    addFormats(ajv);
    const schemaRoot = process.env.OPENLOGOS_BIN
      ? join(repoRoot, 'spec')
      : join(npmValue(['root', '-g']), '@miniidealab', 'openlogos', 'spec');
    const schema = JSON.parse(readFileSync(join(schemaRoot, `schema/${name}.schema.json`), 'utf-8'));
    return { ajv, validate: ajv.compile(schema) };
  };
}

function clarificationFrom(data, command) {
  const module = data.modules?.[0];
  return command === 'status'
    ? module?.active_change?.plan_state?.clarification
    : module?.plan_state?.clarification;
}

function smokePendingContract() {
  return withTempProject('compatibility', root => {
    const status = parseEnvelope(runCli(root, ['status', '--format', 'json']), 'status');
    const next = parseEnvelope(runCli(root, ['next', '--format', 'json']), 'next');
    const makeValidator = validators();
    for (const [name, data] of [['status', status], ['next', next]]) {
      const { ajv, validate } = makeValidator(name);
      if (!validate(data)) throw new Error(`${name} schema 校验失败：${ajv.errorsText(validate.errors)}`);
    }
    const statusClarification = clarificationFrom(status, 'status');
    const nextClarification = clarificationFrom(next, 'next');
    if (JSON.stringify(statusClarification) !== JSON.stringify(nextClarification)) throw new Error('status/next clarification 漂移');
    if (statusClarification?.next_decision_id !== 'C02'
      || statusClarification?.next_decision?.id !== 'C02'
      || statusClarification?.reason !== 'compatibility-clarification-required') {
      throw new Error(`pending clarification 不完整：${JSON.stringify(statusClarification)}`);
    }
  });
}

function smokeDeploymentFailClosed() {
  return withTempProject('deployment', root => {
    const proposalPath = join(root, 'logos/changes/feat/proposal.md');
    const before = readFileSync(proposalPath, 'utf-8');
    const status = parseEnvelope(runCli(root, ['status', '--format', 'json']), 'status');
    const next = parseEnvelope(runCli(root, ['next', '--format', 'json']), 'next');
    const auto = parseEnvelope(runCli(root, ['next', '--auto', '--format', 'json']), 'next --auto');
    for (const [name, data] of [['status', status], ['next', next], ['next --auto', auto]]) {
      const module = data.modules?.[0];
      const step = name === 'status' ? module?.active_change?.proposal_step : data.proposal_step;
      const node = name === 'status' ? module?.active_change?.next_node : module?.next_node;
      const clarification = clarificationFrom(data, name === 'status' ? 'status' : 'next');
      const nodeInvalid = name === 'status' ? false : node?.id !== 'write-proposal';
      if (step !== 'writing' || nodeInvalid || clarification?.reason !== 'deployment-clarification-required') {
        throw new Error(`${name} 未 fail-closed：${JSON.stringify({ step, node, clarification })}`);
      }
    }
    if (readFileSync(proposalPath, 'utf-8') !== before) throw new Error('next --auto 改写了 proposal.md');
    for (const marker of ['PLAN_APPROVED', 'GATE_AUTO_PASSED']) {
      if (existsSync(join(root, 'logos/changes/feat', marker))) throw new Error(`next --auto 错写 ${marker}`);
    }
  });
}

const cases = [
  ['SMOKE-core-59', smokeInstalledVersion],
  ['SMOKE-core-60', smokePendingContract],
  ['SMOKE-core-61', smokeDeploymentFailClosed],
];

let failed = false;
for (const [id, fn] of cases) {
  const startedAt = Date.now();
  try {
    fn();
    writeSmoke(id, 'pass', startedAt);
  } catch (error) {
    failed = true;
    writeSmoke(id, 'fail', startedAt, error);
  }
}

process.exit(failed ? 1 : 0);
