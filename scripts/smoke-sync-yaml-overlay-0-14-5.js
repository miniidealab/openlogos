#!/usr/bin/env node
/**
 * SMOKE-core-169 — 0.14.5 资源索引结构化写入、降级可见与 overlay 版本单一权威。
 *
 * 只接受冻结本地 tarball；全部操作在一次性临时项目与临时 npm prefix 中进行，
 * 不触碰本仓或用户其它项目的 logos-project.yaml / logos/flow/*.yaml；
 * 不包含任何公开发布、远程仓库或官网写操作。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const SYNC_YAML_OVERLAY_SMOKE_IDS = ['SMOKE-core-169'];
const EXPECTED_VERSION = '0.14.5';
const ROLLBACK_VERSION = '0.14.4';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: SYNC_YAML_OVERLAY_SMOKE_IDS,
    environment: 'local-global-temp-project',
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_SYNC_YAML_TARBALL', 'OPENLOGOS_SYNC_YAML_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

// 环境不具备（缺候选/回滚制品）必须留痕：沿用不适用契约，禁止硬失败或静默零记录退出
requireEnvOrSkip(SYNC_YAML_OVERLAY_SMOKE_IDS, [
  ['OPENLOGOS_SYNC_YAML_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_SYNC_YAML_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: 'sync/overlay smoke 需要 0.14.5 候选与 0.14.4 回滚制品',
  environment: 'sync-yaml-overlay',
});

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function run(command, args, cwd = root, env = process.env) {
  return spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 600_000 });
}

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result.stdout.trim();
}

function requiredFile(primary, routed) {
  const raw = process.env[primary] || process.env[routed];
  if (!raw) throw new Error(`缺少 ${primary}`);
  const path = realpathSync(resolve(raw));
  if (!existsSync(path)) throw new Error(`${primary} 不存在：${path}`);
  return { path, sha256: sha256(readFileSync(path)) };
}

function commandLookup() {
  const result = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-lc', 'command -v openlogos']);
  return realpathSync(checked(result, '定位全局 openlogos').split(/\r?\n/)[0]);
}

function cli(entry, cwd, args) {
  const command = entry.endsWith('.js') ? process.execPath : entry;
  const commandArgs = entry.endsWith('.js') ? [entry, ...args] : args;
  return checked(run(command, commandArgs, cwd), `openlogos ${args.join(' ')}`);
}

/** 只读探测：允许非零退出，用于观察告警文本 */
function cliRaw(entry, cwd, args) {
  const command = entry.endsWith('.js') ? process.execPath : entry;
  const commandArgs = entry.endsWith('.js') ? [entry, ...args] : args;
  const result = run(command, commandArgs, cwd);
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function installGlobal(tarball, expectedVersion) {
  checked(run(npmCommand, ['install', '--global', tarball]), `全局安装 ${expectedVersion}`);
}

function assertInstalledIdentity(expectedVersion) {
  const entry = commandLookup();
  const version = cli(entry, root, ['--version']).trim();
  if (!version.includes(expectedVersion)) {
    throw new Error(`全局 openlogos 版本不符：期望 ${expectedVersion}，实际 ${version}`);
  }
  return { entry, version };
}

/**
 * 判据用的解析器必须是**安装态 CLI 自己捆绑的 yaml**——不是 runner 宿主的依赖。
 * 从全局入口的 realpath 解析，等价于「CLI 读这份文件时用的解析器」。
 */
function bundledYamlParse(entry) {
  const requireFromCli = createRequire(entry);
  return requireFromCli('yaml').parse;
}

function tempProject(prefix) {
  return mkdtempSync(join(tmpdir(), `openlogos-smoke-169-${prefix}-`));
}

/**
 * 步骤 ②③④：上游 Bug 报告的三步复现路径 + 幂等。
 * init 真实模板 → 放入可识别文档 → sync → 读回必须可解析。
 */
function exerciseResourceIndex(entry) {
  const parseYaml = bundledYamlParse(entry);
  const base = tempProject('index');
  try {
    cli(entry, base, ['init', 'repro-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
    const yamlPath = join(base, 'logos', 'logos-project.yaml');
    const template = readFileSync(yamlPath, 'utf8');
    if (!/resource_index:\s*\[\]/.test(template)) {
      throw new Error('init 模板未产出 resource_index: []，复现前提不成立');
    }

    const doc = join(base, 'logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md');
    mkdirSync(dirname(doc), { recursive: true });
    writeFileSync(doc, '# 架构\n\n复现用文档。\n');

    cli(entry, base, ['sync']);
    const afterSync = readFileSync(yamlPath, 'utf8');
    // 后置判据 = 可解析性
    const parsed = parseYaml(afterSync);
    const index = Array.isArray(parsed.resource_index) ? parsed.resource_index : [];
    const entryPath = 'logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md';
    if (!index.some(item => item && item.path === entryPath)) {
      throw new Error('sync 后 resource_index 未收录新文档');
    }

    // 幂等：再 sync 两次，字节稳定
    cli(entry, base, ['sync']);
    const second = readFileSync(yamlPath, 'utf8');
    cli(entry, base, ['sync']);
    const third = readFileSync(yamlPath, 'utf8');
    if (second !== third) throw new Error('重复 sync 产生字节漂移，幂等不成立');

    return {
      template_had_flow_sequence: true,
      parsed_ok: true,
      index_entries: index.length,
      after_sync_sha256: sha256(Buffer.from(afterSync, 'utf8')),
      idempotent_sha256: sha256(Buffer.from(third, 'utf8')),
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * 步骤 ⑦：降级两态下 status / next 必须可见告警，且命令前后文件字节不变。
 */
function exerciseDegradedVisibility(entry) {
  const base = tempProject('degraded');
  try {
    cli(entry, base, ['init', 'degraded-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
    const yamlPath = join(base, 'logos', 'logos-project.yaml');

    const samples = {
      recovered: [
        'project:', '  name: degraded-app', 'modules:', '  - id: core',
        '    name: 核心功能', '    lifecycle: launched', 'resource_index:',
        '  - path: spec/a.md', '    desc: 条目', '  - spec/b.md',
        '    desc: 隐式 map key 错误', '',
      ].join('\n'),
      // error 态样本必须携带 resource_index 键，否则「点名未恢复字段」无从判定
      error: [
        'project:', '  name: broken', 'resource_index:',
        '  - path: spec/a.md', '    desc: 条目', '\tbad_indent: x', '',
      ].join('\n'),
    };

    const observed = {};
    for (const [state, content] of Object.entries(samples)) {
      writeFileSync(yamlPath, content);
      const before = sha256(readFileSync(yamlPath));
      const statusText = cliRaw(entry, base, ['status']);
      const nextText = cliRaw(entry, base, ['next']);
      const after = sha256(readFileSync(yamlPath));
      if (before !== after) throw new Error(`${state} 态下 CLI 改写了 logos-project.yaml（处置权归人被破坏）`);
      for (const [name, text] of [['status', statusText], ['next', nextText]]) {
        if (!text.includes('已降级')) throw new Error(`${state} 态下 ${name} 未打印降级告警`);
      }
      if (!statusText.includes('resource_index') || !nextText.includes('resource_index')) {
        throw new Error(`${state} 态下未点名未恢复字段 resource_index`);
      }
      observed[state] = { sha256_stable: true, status_warned: true, next_warned: true };
    }
    return observed;
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/**
 * 步骤 ⑤⑥：GUI 项目 sync 后 flow show --resolved 无假告警；存量迁移正反例。
 */
function exerciseOverlayVersion(entry) {
  const parseYaml = bundledYamlParse(entry);
  const base = tempProject('overlay');
  try {
    cli(entry, base, ['init', 'gui-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
    const yamlPath = join(base, 'logos', 'logos-project.yaml');
    const project = readFileSync(yamlPath, 'utf8')
      .replace(/(\n\s+lifecycle: )initial/, '$1launched')
      .replace(/(\n\s+lifecycle: launched)/, '$1\n    product_type: web');
    writeFileSync(yamlPath, project);

    cli(entry, base, ['sync']);
    const resolved = cliRaw(entry, base, ['flow', 'show', '--resolved', '--lifecycle', 'launched']);
    if (resolved.includes('FLOW_VERSION_MISMATCH')) {
      throw new Error('CLI 刚写出的 overlay 立即触发自身 FLOW_VERSION_MISMATCH 告警');
    }

    const flowPath = join(base, 'logos', 'flow', 'launched.yaml');
    const injected = readFileSync(flowPath, 'utf8');
    const versions = [...injected.matchAll(/builtin:launched@(\S+)/g)].map(m => m[1].trim());
    if (versions.length === 0) throw new Error('注入产物缺少 extends');

    // 正例：把 extends 降级为落后版本、引用全部仍可解析 → sync 应自动提升
    writeFileSync(flowPath, injected.replace(/builtin:launched@\S+/, 'builtin:launched@v0'));
    cli(entry, base, ['sync']);
    const migrated = readFileSync(flowPath, 'utf8');
    if (/builtin:launched@v0/.test(migrated)) throw new Error('落后且引用全部可解析的 overlay 未被自动提升');
    const afterMigrate = cliRaw(entry, base, ['flow', 'show', '--resolved', '--lifecycle', 'launched']);
    if (afterMigrate.includes('FLOW_VERSION_MISMATCH')) throw new Error('迁移后仍有版本告警');

    // 反例：落后且引用失效 node id → 必须保持原值
    const broken = parseYaml(migrated);
    broken.extends = 'builtin:launched@v0';
    broken.overlay = [...(broken.overlay ?? []), { op: 'modify', target: 'node-that-does-not-exist', set: { name: 'x' } }];
    writeFileSync(flowPath, `${JSON.stringify(broken, null, 2)}\n`);
    cliRaw(entry, base, ['sync']);
    const kept = parseYaml(readFileSync(flowPath, 'utf8'));
    if (kept.extends !== 'builtin:launched@v0') {
      throw new Error('引用失效 node id 的 overlay 被错误提升，真告警被消音');
    }

    return {
      injected_versions: versions,
      no_false_warning: true,
      migrated_forward: true,
      kept_on_invalid_reference: true,
    };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

async function smoke(id, operation) {
  const started = Date.now();
  let record;
  try {
    const evidence = await operation();
    record = {
      id, status: 'pass', timestamp: new Date().toISOString(), duration_ms: Date.now() - started,
      environment: 'local-global-temp-project', evidence,
    };
  } catch (error) {
    record = {
      id, status: 'fail', timestamp: new Date().toISOString(), duration_ms: Date.now() - started,
      environment: 'local-global-temp-project', evidence: [], error: error instanceof Error ? error.message : String(error),
    };
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  if (record.status !== 'pass') throw new Error(record.error);
  return record;
}

await smoke('SMOKE-core-169', async () => {
  const candidate = requiredFile('OPENLOGOS_SYNC_YAML_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_SYNC_YAML_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');

  const initial = assertInstalledIdentity(EXPECTED_VERSION);
  const resourceIndex = exerciseResourceIndex(initial.entry);
  const degraded = exerciseDegradedVisibility(initial.entry);
  const overlay = exerciseOverlayVersion(initial.entry);

  // 步骤 ⑧：0.14.4 ↔ 0.14.5 往返，复核每阶段 identity
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const resourceIndexAfterRestore = exerciseResourceIndex(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    resource_index: resourceIndex,
    resource_index_after_restore: resourceIndexAfterRestore,
    degraded_visibility: degraded,
    overlay_version: overlay,
  }];
});
