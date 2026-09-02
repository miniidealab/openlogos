#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SMOKE_IDS = Array.from({ length: 8 }, (_, index) => `SMOKE-core-${100 + index}`);
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try {
    return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null;
  } catch {
    return null;
  }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/zcode-staging-smoke@1',
    ids: SMOKE_IDS,
    required_env: [
      'OPENLOGOS_ZCODE_STAGING=1',
      'OPENLOGOS_ZCODE_BIN',
      'OPENLOGOS_ZCODE_DRIVER',
      'OPENLOGOS_TARBALL',
      'OPENLOGOS_PREVIOUS_TARBALL',
    ],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'zcode-adapter-foundation' && process.env.OPENLOGOS_ZCODE_STAGING !== '1') {
  // 环境不具备必须留痕：静默零记录退出会让「不适用」与「该跑没跑」在账本上同形
  exitNotApplicable(SMOKE_IDS, {
    reason: 'ZCode staging 宿主未就绪：需活跃变更 zcode-adapter-foundation 或 OPENLOGOS_ZCODE_STAGING=1',
    missing: ['OPENLOGOS_ZCODE_STAGING', 'OPENLOGOS_ZCODE_BIN', 'OPENLOGOS_ZCODE_DRIVER'],
    environment: 'zcode-staging',
  });
}

const evidenceRoot = resolve(
  repoRoot,
  process.env.OPENLOGOS_ZCODE_EVIDENCE_DIR
    || `logos/resources/verify/evidence/zcode-${new Date().toISOString().replace(/[:.]/g, '-')}`,
);
mkdirSync(evidenceRoot, { recursive: true });

function sanitize(value) {
  return String(value)
    .replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>')
    .replace(/(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,}]+/gi, '$1=<redacted>')
    .slice(0, 4000);
}

function writeResult(id, status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id,
    status,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    environment: 'staging',
    evidence,
  };
  if (error) record.error = sanitize(error);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    input: options.input,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} 失败（exit=${result.status}）：${sanitize(result.stderr || result.stdout)}`);
  }
  return result;
}

function requireFile(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}`);
  const absolute = realpathSync(resolve(value));
  if (!statSync(absolute).isFile()) throw new Error(`${name} 不是文件：${absolute}`);
  return absolute;
}

function runDriver(phase, payload) {
  const driver = requireFile('OPENLOGOS_ZCODE_DRIVER');
  const result = checked(driver, [phase], {
    cwd: payload.workspace || repoRoot,
    input: JSON.stringify(payload) + '\n',
    env: {
      ...process.env,
      OPENLOGOS_ZCODE_STAGING: '1',
    },
  });
  const line = result.stdout.trim().split('\n').find(item => item.trim().startsWith('{'));
  if (!line) throw new Error(`ZCode driver ${phase} 未输出 JSON`);
  const parsed = JSON.parse(line);
  if (parsed.ok !== true) throw new Error(`ZCode driver ${phase} 返回失败：${sanitize(line)}`);
  const evidence = join(evidenceRoot, `${phase}.json`);
  writeFileSync(evidence, JSON.stringify(parsed, null, 2) + '\n');
  return { data: parsed, evidence };
}

function runCli(entry, cwd, args) {
  return checked(process.execPath, [entry, ...args], { cwd });
}

function writeDeltaState(workspace) {
  const proposal = join(workspace, 'logos', 'changes', 'zcode-smoke');
  mkdirSync(join(proposal, 'deltas', 'spec'), { recursive: true });
  writeFileSync(join(workspace, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'zcode-smoke', module: 'core' }));
  writeFileSync(join(proposal, 'proposal.md'), '# ZCode smoke\n');
  writeFileSync(join(proposal, 'PLAN_APPROVED'), '');
  writeFileSync(join(proposal, 'tasks.md'), [
    '# 实现任务',
    '## [delta] 规格变更',
    '- [ ] [MODIFY] deltas/spec/demo.md',
    '## [code] 代码实现',
    '- [ ] smoke fixture',
    '',
  ].join('\n'));
  return proposal;
}

let failed = false;
let staging = null;
let context = null;

async function smoke(id, fn) {
  const startedAt = Date.now();
  try {
    const evidence = await fn();
    writeResult(id, 'pass', startedAt, null, evidence || []);
  } catch (error) {
    failed = true;
    writeResult(id, 'fail', startedAt, error instanceof Error ? error.message : error, []);
  }
}

await smoke('SMOKE-core-100', () => {
  if (process.env.OPENLOGOS_ZCODE_STAGING !== '1') throw new Error('OPENLOGOS_ZCODE_STAGING 必须显式为 1');
  const tarball = requireFile('OPENLOGOS_TARBALL');
  const zcodeBin = requireFile('OPENLOGOS_ZCODE_BIN');
  requireFile('OPENLOGOS_ZCODE_DRIVER');
  staging = mkdtempSync(join(tmpdir(), 'openlogos-zcode-staging-'));
  const installRoot = join(staging, 'install');
  mkdirSync(installRoot, { recursive: true });
  checked(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', installRoot, '--no-audit', '--no-fund', tarball]);
  const entry = join(installRoot, 'node_modules', '@miniidealab', 'openlogos', 'dist', 'index.js');
  if (!existsSync(entry)) throw new Error('真实 tarball 安装后缺少 CLI dist/index.js');
  const packageRoot = join(installRoot, 'node_modules', '@miniidealab', 'openlogos');
  const listing = checked('tar', ['-tzf', tarball]).stdout;
  for (const required of [
    'package/zcode-plugin-template/.zcode-plugin/plugin.json',
    'package/zcode-plugin-template/hooks/hooks.json',
    'package/zcode-plugin-template/runtime/hook-runtime.js',
    'package/zcode-plugin-template/skills/',
    'package/zcode-plugin-template/commands/',
    'package/zcode-plugin-template/agents/',
  ]) {
    if (!listing.includes(required)) throw new Error(`tarball 缺少 ${required}`);
  }
  const cliVersion = runCli(entry, staging, ['--version']).stdout.trim();
  const zcodeVersion = checked(zcodeBin, ['--version']).stdout.trim();
  const artifact = {
    tarball,
    size: statSync(tarball).size,
    sha256: sha256(tarball),
    cli_entry: entry,
    cli_version: cliVersion,
    zcode_bin: zcodeBin,
    zcode_version: zcodeVersion,
    package_root: packageRoot,
  };
  const evidence = join(evidenceRoot, 'tarball.json');
  writeFileSync(evidence, JSON.stringify(artifact, null, 2) + '\n');
  context = { ...artifact, entry, packageRoot, zcodeBin, staging };
  return [evidence];
});

await smoke('SMOKE-core-101', () => {
  if (!context) throw new Error('tarball 前置失败');
  const workspace = join(context.staging, 'workspace');
  mkdirSync(workspace, { recursive: true });
  runCli(context.entry, workspace, ['init', 'zcode-smoke', '--locale', 'zh', '--ai-tool', 'zcode']);
  const pluginPath = join(workspace, '.zcode', 'plugins', 'openlogos');
  const installed = runDriver('install', { workspace, pluginPath, zcodeBin: context.zcodeBin, evidenceRoot });
  if (installed.data.plugin?.identity !== 'openlogos') throw new Error('ZCode 未发现唯一 openlogos identity');
  context.workspace = workspace;
  context.pluginPath = pluginPath;
  return [installed.evidence];
});

await smoke('SMOKE-core-102', () => {
  if (!context?.workspace) throw new Error('plugin 安装前置失败');
  const inventory = runDriver('inventory', context);
  for (const key of ['skills', 'commands', 'agents', 'hooks']) {
    if (!Array.isArray(inventory.data[key]) || inventory.data[key].length === 0) throw new Error(`ZCode inventory 缺少 ${key}`);
  }
  return [inventory.evidence];
});

await smoke('SMOKE-core-103', () => {
  if (!context?.workspace) throw new Error('workspace 前置失败');
  const noGuard = runDriver('session-start', { ...context, expectedGuard: false });
  writeDeltaState(context.workspace);
  const withGuard = runDriver('session-start', { ...context, expectedGuard: true });
  for (const item of [noGuard.data, withGuard.data]) {
    const text = item.additionalContext;
    if (typeof text !== 'string' || !text.includes('proposal_step:') || !text.includes('下一确认点')) {
      throw new Error('SessionStart additionalContext 与磁盘状态不一致');
    }
  }
  return [noGuard.evidence, withGuard.evidence];
});

await smoke('SMOKE-core-104', () => {
  if (!context?.workspace) throw new Error('workspace 前置失败');
  const target = join(context.workspace, 'logos', 'changes', 'zcode-smoke', 'deltas', 'spec', 'demo.md');
  const allow = runDriver('write', { ...context, target, content: '# allowed\n', expectedDecision: 'allow' });
  if (!existsSync(target) || readFileSync(target, 'utf8') !== '# allowed\n') throw new Error('允许路径未实际写入');
  return [allow.evidence];
});

await smoke('SMOKE-core-105', () => {
  if (!context?.workspace) throw new Error('workspace 前置失败');
  const source = join(context.workspace, 'src.txt');
  writeFileSync(source, 'stable\n');
  const outside = join(context.staging, 'outside.txt');
  writeFileSync(outside, 'outside\n');
  const outsideDir = join(context.staging, 'outside-dir');
  mkdirSync(outsideDir, { recursive: true });
  const link = join(context.workspace, 'escape');
  symlinkSync(outsideDir, link);
  const targets = [source, outside, join(link, 'escaped.txt')];
  const before = targets.slice(0, 2).map(sha256);
  const denied = runDriver('hard-deny', { ...context, targets, expectedDecision: 'deny', expectedExitCode: 2 });
  const after = targets.slice(0, 2).map(sha256);
  if (JSON.stringify(before) !== JSON.stringify(after) || existsSync(targets[2])) throw new Error('deny 后目标发生变化');
  if (!Array.isArray(denied.data.responses) || denied.data.responses.some(item => item.exitCode !== 2 || item.permissionDecision !== 'deny')) {
    throw new Error('未观察到全部 exit 2 hard deny');
  }
  return [denied.evidence];
});

await smoke('SMOKE-core-106', () => {
  if (!context?.workspace) throw new Error('workspace 前置失败');
  runCli(context.entry, context.workspace, ['sync']);
  runCli(context.entry, context.workspace, ['sync']);
  const lifecycle = runDriver('sync-launch', context);
  if (lifecycle.data.secondSync !== 'unchanged' || lifecycle.data.secondLaunch !== 'unchanged') {
    throw new Error('sync/launch 第二次不是 unchanged');
  }
  return [lifecycle.evidence];
});

await smoke('SMOKE-core-107', () => {
  if (!context?.entry) throw new Error('tarball 前置失败');
  const previousTarball = requireFile('OPENLOGOS_PREVIOUS_TARBALL');
  const regressionRoot = join(context.staging, 'existing-hosts');
  mkdirSync(regressionRoot, { recursive: true });
  runCli(context.entry, regressionRoot, ['init', 'host-regression', '--locale', 'en', '--ai-tool', 'all']);
  for (const required of [
    '.claude/commands/openlogos/status.md',
    '.opencode/plugins/openlogos.js',
    '.agents/plugins/openlogos/.codex-plugin/plugin.json',
    '.cursor/rules/openlogos-policy.mdc',
  ]) {
    if (!existsSync(join(regressionRoot, required))) throw new Error(`既有宿主回归缺少 ${required}`);
  }
  const rollback = runDriver('rollback', { ...context, previousTarball, regressionRoot });
  if (rollback.data.restored !== true || rollback.data.userAssetsPreserved !== true) throw new Error('真实回滚证据不完整');
  return [rollback.evidence];
});

if (staging && process.env.OPENLOGOS_KEEP_ZCODE_STAGING !== '1') rmSync(staging, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
