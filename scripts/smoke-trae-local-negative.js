#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const TRAE_LOCAL_SMOKE_IDS = Array.from({ length: 6 }, (_, index) => `SMOKE-core-${124 + index}`);
export const DEPLOYABLE_AI_TOOLS = ['claude-code', 'opencode', 'codex', 'cursor', 'zcode', 'qoder', 'workbuddy'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');
const commandAudit = [];

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

export function assertWithinRoot(root, target, label = '路径') {
  const rootReal = realpathSync(root);
  const targetReal = realpathSync(target);
  if (targetReal !== rootReal && !targetReal.startsWith(`${rootReal}${sep}`)) {
    throw new Error(`${label} 逃逸一次性根目录：${targetReal}`);
  }
  return targetReal;
}

export function snapshotTree(root) {
  const output = {};
  if (!existsSync(root)) return output;
  function walk(current, prefix = '') {
    for (const name of readdirSync(current).sort()) {
      const absolute = join(current, name);
      const item = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        output[item] = `symlink:${readlinkSync(absolute)}`;
      } else if (stat.isDirectory()) {
        output[`${item}/`] = 'directory';
        walk(absolute, item);
      } else {
        output[item] = `${stat.size}:${sha256File(absolute)}`;
      }
    }
  }
  walk(root);
  return output;
}

export function assertPackageMetadata(pkg, expectedVersion, label = 'tarball') {
  if (!pkg || pkg.name !== '@miniidealab/openlogos') throw new Error(`${label} 包名不是 @miniidealab/openlogos`);
  if (pkg.version !== expectedVersion) throw new Error(`${label} 版本应为 ${expectedVersion}，实际为 ${pkg.version || '<missing>'}`);
  return { name: pkg.name, version: pkg.version };
}

export function validateSmokeRecords(records, candidateSha, rollbackSha) {
  const byId = new Map();
  for (const record of records) {
    if (!TRAE_LOCAL_SMOKE_IDS.includes(record?.id)) continue;
    if (byId.has(record.id)) throw new Error(`smoke 结果重复：${record.id}`);
    byId.set(record.id, record);
  }
  for (const id of TRAE_LOCAL_SMOKE_IDS) {
    const record = byId.get(id);
    if (!record) throw new Error(`smoke 结果缺失：${id}`);
    if (record.status !== 'pass') throw new Error(`smoke 未通过：${id}=${record.status || '<missing>'}`);
    if (record.environment !== 'local-isolated') throw new Error(`smoke 环境不匹配：${id}`);
    if (record.candidate_tarball_sha256 !== candidateSha || record.rollback_tarball_sha256 !== rollbackSha) {
      throw new Error(`smoke 制品 SHA 不匹配：${id}`);
    }
    if (!Array.isArray(record.evidence) || record.evidence.length === 0) throw new Error(`smoke 证据缺失：${id}`);
  }
  return true;
}

function sanitize(value, localRoot = '') {
  let text = String(value);
  if (localRoot) text = text.replaceAll(localRoot, '<LOCAL_ROOT>');
  if (process.env.HOME) text = text.replaceAll(process.env.HOME, '<HOME>');
  return text
    .replace(/(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,}]+/gi, '$1=<redacted>')
    .slice(0, 4000);
}

function checked(command, args, options = {}) {
  commandAudit.push({ command, args: [...args], cwd: options.cwd || repoRoot });
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeout || 300000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} 失败（exit=${result.status}）：${sanitize(result.stderr || result.stdout, options.localRoot)}`);
  }
  return result;
}

function requireFile(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}`);
  const absolute = realpathSync(resolve(value));
  if (!statSync(absolute).isFile()) throw new Error(`${name} 不是文件`);
  return absolute;
}

function readTarballMetadata(tarball, expectedVersion, label) {
  const result = checked('tar', ['-xOf', tarball, 'package/package.json']);
  const pkg = JSON.parse(result.stdout);
  assertPackageMetadata(pkg, expectedVersion, label);
  return { path: tarball, size: statSync(tarball).size, sha256: sha256File(tarball), package: pkg };
}

function createIsolationRoot() {
  const requested = process.env.OPENLOGOS_TRAE_LOCAL_ROOT;
  const root = requested ? resolve(requested) : mkdtempSync(join(tmpdir(), 'openlogos-trae-local-'));
  for (const name of ['home', 'prefix', 'cache', 'workspace', 'evidence']) mkdirSync(join(root, name), { recursive: true });
  for (const name of ['home', 'prefix', 'cache', 'workspace', 'evidence']) assertWithinRoot(root, join(root, name), name);
  return { root: realpathSync(root), owned: !requested };
}

function isolatedEnv(root) {
  const home = join(root, 'home');
  const prefix = join(root, 'prefix');
  const cache = join(root, 'cache');
  const userConfig = join(root, 'npmrc');
  const codexHome = join(home, '.codex');
  const xdgConfig = join(home, '.config');
  const xdgCache = join(home, '.cache');
  for (const directory of [home, prefix, cache, codexHome, xdgConfig, xdgCache]) mkdirSync(directory, { recursive: true });
  if (!existsSync(userConfig)) writeFileSync(userConfig, 'audit=false\nfund=false\n');
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
    CODEX_HOME: codexHome,
    OPENLOGOS_CODEX_PERSONAL_HOME: home,
    NPM_CONFIG_PREFIX: prefix,
    npm_config_prefix: prefix,
    NPM_CONFIG_CACHE: cache,
    npm_config_cache: cache,
    NPM_CONFIG_USERCONFIG: userConfig,
    PATH: `${join(prefix, 'bin')}${delimiter}${process.env.PATH || ''}`,
  };
}

function installTarball(context, tarball, expectedVersion) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  checked(npm, ['install', '--prefix', context.prefix, '--no-audit', '--no-fund', '--ignore-scripts', '--force', tarball], {
    cwd: context.root,
    env: context.env,
    localRoot: context.root,
  });
  const packageRoot = join(context.prefix, 'node_modules', '@miniidealab', 'openlogos');
  const packageJson = join(packageRoot, 'package.json');
  const entry = join(packageRoot, 'dist', 'index.js');
  if (!existsSync(packageJson) || !existsSync(entry)) throw new Error(`安装 ${expectedVersion} 后缺少 package.json 或 dist/index.js`);
  assertWithinRoot(context.root, packageRoot, '安装包目录');
  assertWithinRoot(context.root, entry, 'CLI 入口');
  const pkg = JSON.parse(readFileSync(packageJson, 'utf8'));
  assertPackageMetadata(pkg, expectedVersion, '安装包');
  const version = checked(process.execPath, [entry, '--version'], { cwd: context.root, env: context.env, localRoot: context.root }).stdout.trim();
  if (version !== expectedVersion) throw new Error(`CLI 版本应为 ${expectedVersion}，实际为 ${version}`);
  return { packageRoot, entry: realpathSync(entry), version };
}

function runCli(context, cwd, args, allowFailure = false) {
  return checked(process.execPath, [context.entry, ...args], {
    cwd,
    env: context.env,
    allowFailure,
    localRoot: context.root,
  });
}

function writeTraeFixture(workspace) {
  const fixtures = new Map([
    ['.trae/rules/project.md', '# 用户规则\n'],
    ['.trae/skills/local/SKILL.md', '# 用户技能\n'],
    ['.trae/agents/reviewer.md', '# 用户 Agent\n'],
    ['.trae/hooks.json', '{"hooks":{"PreToolUse":[]}}\n'],
    ['.trae/mcp.json', '{"servers":{}}\n'],
    ['.trae/settings.json', '{"model":"user-owned"}\n'],
    ['.trae/account.json', '{"account":"opaque"}\n'],
    ['.trae/enabled_folders', '/synthetic/workspace\n'],
    ['.trae/native-memory.bin', Buffer.from([0, 255, 8, 4])],
    ['.trae/unknown.user', 'opaque\n'],
  ]);
  for (const [relativePath, content] of fixtures) {
    const target = join(workspace, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return snapshotTree(join(workspace, '.trae'));
}

function assertSameSnapshot(before, after, label) {
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`${label} 文件清单或 SHA-256 发生变化`);
}

function initRejectsTrae(context, name) {
  const workspace = join(context.workspaceRoot, name);
  mkdirSync(workspace, { recursive: true });
  const traeBefore = writeTraeFixture(workspace);
  const workspaceBefore = snapshotTree(workspace);
  const result = runCli(context, workspace, ['init', name, '--locale', 'zh', '--ai-tool', 'trae'], true);
  if (result.status === 0) throw new Error('init --ai-tool trae 意外成功');
  assertSameSnapshot(workspaceBefore, snapshotTree(workspace), '显式 TRAE 拒绝后的 workspace');
  assertSameSnapshot(traeBefore, snapshotTree(join(workspace, '.trae')), '显式 TRAE 拒绝后的 TRAE fixture');
  const output = `${result.stderr}\n${result.stdout}`;
  for (const id of DEPLOYABLE_AI_TOOLS) if (!output.includes(id)) throw new Error(`不支持错误缺少真实宿主 ${id}`);
  return { workspace, exitCode: result.status, output: sanitize(output, context.root), traeSnapshot: traeBefore };
}

function initAndSyncAll(context) {
  const workspace = join(context.workspaceRoot, 'all-seven-hosts');
  mkdirSync(workspace, { recursive: true });
  const traeBefore = writeTraeFixture(workspace);
  runCli(context, workspace, ['init', 'all-seven-hosts', '--locale', 'zh', '--ai-tool', 'all']);
  const config = JSON.parse(readFileSync(join(workspace, 'logos', 'logos.config.json'), 'utf8'));
  if (JSON.stringify(config.aiTool) !== JSON.stringify(DEPLOYABLE_AI_TOOLS)) throw new Error('all 未稳定展开为既有七宿主');
  assertSameSnapshot(traeBefore, snapshotTree(join(workspace, '.trae')), 'all init 后 TRAE fixture');
  runCli(context, workspace, ['sync']);
  assertSameSnapshot(traeBefore, snapshotTree(join(workspace, '.trae')), 'all sync 后 TRAE fixture');

  const invalidWorkspace = join(context.workspaceRoot, 'invalid-trae-config');
  mkdirSync(invalidWorkspace, { recursive: true });
  runCli(context, invalidWorkspace, ['init', 'invalid-trae-config', '--locale', 'zh', '--ai-tool', 'cursor']);
  const invalidConfigPath = join(invalidWorkspace, 'logos', 'logos.config.json');
  const invalidConfig = JSON.parse(readFileSync(invalidConfigPath, 'utf8'));
  invalidConfig.aiTool = ['cursor', 'trae'];
  writeFileSync(invalidConfigPath, `${JSON.stringify(invalidConfig, null, 2)}\n`);
  const invalidBefore = snapshotTree(invalidWorkspace);
  const invalidResult = runCli(context, invalidWorkspace, ['sync'], true);
  if (invalidResult.status === 0) throw new Error('含 trae 的 sync 配置意外成功');
  assertSameSnapshot(invalidBefore, snapshotTree(invalidWorkspace), '非法 sync 配置失败后的 workspace');
  return { workspace, invalidWorkspace, traeSnapshot: traeBefore, invalidExitCode: invalidResult.status };
}

function writeEvidence(context, name, data) {
  const file = join(context.evidenceRoot, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return relative(repoRoot, file).replaceAll('\\', '/');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    process.stdout.write(`${JSON.stringify({
      schema: 'openlogos/trae-local-negative-smoke@1',
      ids: TRAE_LOCAL_SMOKE_IDS,
      environment: 'local-isolated',
      required_source_env: ['OPENLOGOS_TRAE_LOCAL_TARBALL', 'OPENLOGOS_TRAE_ROLLBACK_TARBALL'],
      routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
      deployable_ai_tools: DEPLOYABLE_AI_TOOLS,
      capability_status: 'BLOCKED',
      launches_trae: false,
      public_release_commands: [],
    })}\n`);
    return;
  }

  if (activeChange() !== 'trae-local-negative-smoke' && process.env.OPENLOGOS_TRAE_LOCAL_NEGATIVE !== '1') return;

  const isolation = createIsolationRoot();
  const evidenceRoot = resolve(repoRoot, process.env.OPENLOGOS_TRAE_LOCAL_EVIDENCE_DIR
    || `logos/resources/verify/evidence/trae-local-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(evidenceRoot, { recursive: true });
  const context = {
    root: isolation.root,
    ownedRoot: isolation.owned,
    home: join(isolation.root, 'home'),
    prefix: join(isolation.root, 'prefix'),
    cache: join(isolation.root, 'cache'),
    workspaceRoot: join(isolation.root, 'workspace'),
    evidenceRoot,
    env: isolatedEnv(isolation.root),
    candidate: null,
    rollback: null,
    entry: null,
    initEvidence: null,
    syncEvidence: null,
  };
  let failed = false;
  const produced = [];

  function report(id, status, startedAt, error, evidence = []) {
    mkdirSync(dirname(resultPath), { recursive: true });
    const record = {
      id,
      status,
      timestamp: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      environment: 'local-isolated',
      candidate_tarball_sha256: context.candidate?.sha256 || null,
      rollback_tarball_sha256: context.rollback?.sha256 || null,
      capability_status: 'BLOCKED',
      evidence,
    };
    if (error) record.error = sanitize(error, context.root);
    appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
    produced.push(record);
  }

  async function smoke(id, fn) {
    const startedAt = Date.now();
    try {
      const evidence = await fn();
      report(id, 'pass', startedAt, null, evidence || []);
    } catch (error) {
      failed = true;
      report(id, 'fail', startedAt, error instanceof Error ? error.message : error, []);
    }
  }

  await smoke('SMOKE-core-124', () => {
    const candidateTarball = requireFile('OPENLOGOS_TARBALL');
    const rollbackTarball = requireFile('OPENLOGOS_PREVIOUS_TARBALL');
    context.candidate = readTarballMetadata(candidateTarball, '0.13.29', '候选 tarball');
    context.rollback = readTarballMetadata(rollbackTarball, '0.13.28', '回滚 tarball');
    const listing = checked('tar', ['-tzf', candidateTarball]).stdout;
    for (const required of ['package/package.json', 'package/dist/index.js']) {
      if (!listing.includes(required)) throw new Error(`候选 tarball 清单缺少 ${required}`);
    }
    const installed = installTarball(context, candidateTarball, '0.13.29');
    context.entry = installed.entry;
    return [writeEvidence(context, 'artifact-identity', {
      candidate: { size: context.candidate.size, sha256: context.candidate.sha256, version: '0.13.29' },
      rollback: { size: context.rollback.size, sha256: context.rollback.sha256, version: '0.13.28' },
      cli_entry: sanitize(installed.entry, context.root),
      cli_version: installed.version,
    })];
  });

  await smoke('SMOKE-core-125', () => {
    if (!context.entry) throw new Error('候选安装前置失败');
    for (const [label, path] of Object.entries({ home: context.home, prefix: context.prefix, cache: context.cache, workspace: context.workspaceRoot })) {
      assertWithinRoot(context.root, path, label);
    }
    for (const variable of ['HOME', 'USERPROFILE', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'CODEX_HOME', 'NPM_CONFIG_PREFIX', 'NPM_CONFIG_CACHE', 'NPM_CONFIG_USERCONFIG']) {
      assertWithinRoot(context.root, context.env[variable], variable);
    }
    if (commandAudit.some(item => /(?:^|\s)(?:publish|dist-tag|tag|release|push)(?:\s|$)/i.test([item.command, ...item.args].join(' ')))) {
      throw new Error('命令审计发现公开发布动作');
    }
    return [writeEvidence(context, 'isolation', {
      root: '<LOCAL_ROOT>',
      writable_roots: ['home', 'prefix', 'cache', 'workspace', 'evidence'],
      real_user_home_read: false,
      global_npm_write: false,
      public_release_commands: [],
    })];
  });

  await smoke('SMOKE-core-126', () => {
    if (!context.entry) throw new Error('候选安装前置失败');
    context.initEvidence = initRejectsTrae(context, 'explicit-trae-rejected');
    return [writeEvidence(context, 'explicit-trae-rejection', {
      exit_code: context.initEvidence.exitCode,
      first_write_observed: false,
      workspace: sanitize(context.initEvidence.workspace, context.root),
      trae_snapshot: context.initEvidence.traeSnapshot,
    })];
  });

  await smoke('SMOKE-core-127', () => {
    if (!context.entry) throw new Error('候选安装前置失败');
    context.syncEvidence = initAndSyncAll(context);
    return [writeEvidence(context, 'all-sync-exclusion', {
      deployable_ai_tools: DEPLOYABLE_AI_TOOLS,
      all_workspace: sanitize(context.syncEvidence.workspace, context.root),
      invalid_workspace: sanitize(context.syncEvidence.invalidWorkspace, context.root),
      invalid_exit_code: context.syncEvidence.invalidExitCode,
      trae_snapshot: context.syncEvidence.traeSnapshot,
    })];
  });

  await smoke('SMOKE-core-128', () => {
    if (!context.initEvidence || !context.syncEvidence) throw new Error('init/sync 边界前置失败');
    assertSameSnapshot(context.initEvidence.traeSnapshot, snapshotTree(join(context.initEvidence.workspace, '.trae')), '显式拒绝 fixture');
    assertSameSnapshot(context.syncEvidence.traeSnapshot, snapshotTree(join(context.syncEvidence.workspace, '.trae')), 'all/sync fixture');
    if (commandAudit.some(item => /(?:Trae\.app|Trae CN\.app|\.trae\/wrapper|trae.*(?:agent|hook|mcp))/i.test([item.command, ...item.args].join(' ')))) {
      throw new Error('runner 尝试启动 TRAE 或调用软控制 wrapper');
    }
    return [writeEvidence(context, 'ownership-and-capability', {
      capability_status: 'BLOCKED',
      launches_trae: false,
      reads_native_memory_content: false,
      soft_controls_count_as_pass: false,
      fixture_hashes_unchanged: true,
    })];
  });

  await smoke('SMOKE-core-129', () => {
    if (!context.candidate || !context.rollback || !context.entry) throw new Error('双 tarball 前置失败');
    const rollbackInstalled = installTarball(context, context.rollback.path, '0.13.28');
    const restored = installTarball(context, context.candidate.path, '0.13.29');
    context.entry = restored.entry;
    const finalNegative = initRejectsTrae(context, 'post-rollback-trae-rejected');
    if (rollbackInstalled.version !== '0.13.28' || restored.version !== '0.13.29') throw new Error('回滚恢复版本不完整');
    return [writeEvidence(context, 'rollback-restore', {
      sequence: ['0.13.29', rollbackInstalled.version, restored.version],
      final_negative_exit_code: finalNegative.exitCode,
      user_boundary_unchanged: true,
    })];
  });

  if (!failed) validateSmokeRecords(produced, context.candidate.sha256, context.rollback.sha256);
  if (context.ownedRoot && process.env.OPENLOGOS_KEEP_TRAE_LOCAL_ROOT !== '1') rmSync(context.root, { recursive: true, force: true });
  if (failed) process.exitCode = 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main();
