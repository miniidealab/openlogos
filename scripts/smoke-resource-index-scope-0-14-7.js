#!/usr/bin/env node
/**
 * SMOKE-core-171 — 0.14.7 资源索引候选范围、判据锚定与 kind 对齐。
 *
 * 只接受冻结本地 tarball；全部断言在一次性临时项目中构造，
 * **不触碰本仓或用户其它项目的 logos-project.yaml，也不清理任何既有索引条目**；
 * 不包含公开发布、远程仓库或官网写操作。
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

export const RESOURCE_INDEX_SCOPE_SMOKE_IDS = ['SMOKE-core-171'];
const EXPECTED_VERSION = '0.14.7';
const ROLLBACK_VERSION = '0.14.6';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

const ARCH = 'logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md';
const CANDIDATES = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-scenario-candidates.md';
const SEED_STAGING = 'logos/resources/verify/baseline-seed-runs/seed-core-0001/staging';

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: RESOURCE_INDEX_SCOPE_SMOKE_IDS,
    environment: 'local-global-temp-project',
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_RESOURCE_INDEX_TARBALL', 'OPENLOGOS_RESOURCE_INDEX_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

// 环境不具备（缺候选/回滚制品）必须留痕：沿用既有的不适用契约，禁止静默零记录退出
requireEnvOrSkip(RESOURCE_INDEX_SCOPE_SMOKE_IDS, [
  ['OPENLOGOS_RESOURCE_INDEX_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_RESOURCE_INDEX_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: '资源索引范围 smoke 需要 0.14.7 候选与 0.14.6 回滚制品',
  environment: 'resource-index-scope',
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

const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cli = (entry, cwd, args) => checked(run(cliBin(entry), cliArgs(entry, args), cwd), `openlogos ${args.join(' ')}`);

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

/** 判据用的解析器必须是安装态 CLI 自己捆绑的 yaml——判据是「CLI 读这份文件时读到什么」 */
const bundledYamlParse = entry => createRequire(entry)('yaml').parse;

/** 步骤 ②③④⑤⑥：四步复现路径 + 既有条目守恒 + 幂等 */
function exerciseResourceIndex(entry) {
  const parseYaml = bundledYamlParse(entry);
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-171-'));
  try {
    cli(entry, base, ['init', 'idx-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
    const yamlPath = join(base, 'logos', 'logos-project.yaml');
    const write = (rel, body) => {
      const abs = join(base, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    };

    // ② 两份权威文档
    write(ARCH, '# core 现状系统图\n\n权威版本（第 2 版）。\n');
    write(CANDIDATES, '# core 逆向场景候选\n\n权威版本。\n');
    // ③ seed 事务工作区下的同名陈旧快照 + verify 顶层报告
    write(`${SEED_STAGING}/${ARCH}`, '# core 现状系统图\n\n陈旧快照（第 1 版）。\n');
    write(`${SEED_STAGING}/${CANDIDATES}`, '# core 逆向场景候选\n\n陈旧快照。\n');
    write('logos/resources/verify/acceptance-report.md', '# 验收报告\n');

    // ④ sync 后读回
    cli(entry, base, ['sync']);
    const index = parseYaml(readFileSync(yamlPath, 'utf8')).resource_index ?? [];
    const paths = index.map(e => e.path);

    if (paths.some(p => p.includes('baseline-seed-runs'))) {
      throw new Error(`索引含 seed 快照条目：${paths.filter(p => p.includes('baseline-seed-runs')).join('、')}`);
    }
    for (const required of [ARCH, CANDIDATES, 'logos/resources/verify/acceptance-report.md']) {
      if (!paths.includes(required)) throw new Error(`索引缺少应收录条目：${required}`);
    }
    if (index.length !== 3) throw new Error(`索引条目数 ${index.length} ≠ 3（两份权威 + 顶层报告）`);

    const candidatesDesc = index.find(e => e.path === CANDIDATES).desc;
    if (!candidatesDesc.includes('场景实现')) throw new Error(`scenario-candidates 描述非场景语义：${candidatesDesc}`);
    if (candidatesDesc.includes('验收报告')) throw new Error('scenario-candidates 被误描述为验收报告');
    if (new Set(index.map(e => e.desc)).size !== index.length) {
      throw new Error('索引中出现描述完全相同的条目——权威与副本不可区分');
    }

    // ⑤ 预置一条指向 verify/ 子目录的历史条目，再 sync：既有条目必须逐字保留
    const preserved = `${SEED_STAGING}/${ARCH}`;
    writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(
      /^resource_index:$/m,
      `resource_index:\n  - path: ${preserved}\n    desc: 历史快照条目（污染，但不由 CLI 删除）`,
    ));
    const beforePreserve = sha256(readFileSync(yamlPath));
    cli(entry, base, ['sync']);
    const afterIndex = parseYaml(readFileSync(yamlPath, 'utf8')).resource_index ?? [];
    if (!afterIndex.some(e => e.path === preserved)) throw new Error('CLI 删除了既有条目（违反处置权归人）');
    if (afterIndex.filter(e => e.path.includes('baseline-seed-runs')).length !== 1) {
      throw new Error('快照条目被新增收录');
    }

    // ⑥ 幂等
    const afterFirst = readFileSync(yamlPath, 'utf8');
    cli(entry, base, ['sync']);
    if (readFileSync(yamlPath, 'utf8') !== afterFirst) throw new Error('重复 sync 产生字节漂移');

    return {
      index_paths: paths,
      snapshot_entries: 0,
      scenario_candidates_desc_ok: true,
      distinct_desc: true,
      preexisting_entry_preserved: true,
      preexisting_sha256_before: beforePreserve,
      idempotent: true,
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
    record = { id, status: 'pass', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: 'local-global-temp-project', evidence };
  } catch (error) {
    record = { id, status: 'fail', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: 'local-global-temp-project', evidence: [], error: error instanceof Error ? error.message : String(error) };
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  if (record.status !== 'pass') throw new Error(record.error);
  return record;
}

await smoke('SMOKE-core-171', async () => {
  const candidate = requiredFile('OPENLOGOS_RESOURCE_INDEX_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_RESOURCE_INDEX_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');

  const initial = assertInstalledIdentity(EXPECTED_VERSION);
  const first = exerciseResourceIndex(initial.entry);

  // ⑦ 回滚往返
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const afterRestore = exerciseResourceIndex(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    resource_index: first, resource_index_after_restore: afterRestore,
  }];
});
