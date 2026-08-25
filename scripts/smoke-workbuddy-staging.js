#!/usr/bin/env node
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
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

const SMOKE_IDS = Array.from({ length: 8 }, (_, index) => `SMOKE-core-${116 + index}`);
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/workbuddy-staging-smoke@1',
    ids: SMOKE_IDS,
    required_env: [
      'OPENLOGOS_WORKBUDDY_STAGING=1',
      'OPENLOGOS_WORKBUDDY_APP',
      'OPENLOGOS_WORKBUDDY_AUTH_HOME',
      'OPENLOGOS_WORKBUDDY_BIN',
      'OPENLOGOS_WORKBUDDY_DRIVER',
      'OPENLOGOS_TARBALL',
      'OPENLOGOS_PREVIOUS_TARBALL',
    ],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'workbuddy-adapter-foundation' && process.env.OPENLOGOS_WORKBUDDY_STAGING !== '1') process.exit(0);

const evidenceRoot = resolve(repoRoot, process.env.OPENLOGOS_WORKBUDDY_EVIDENCE_DIR
  || `logos/resources/verify/evidence/workbuddy-${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(evidenceRoot, { recursive: true });

function sanitize(value) {
  return String(value)
    .replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>')
    .replace(/(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,}]+/gi, '$1=<redacted>')
    .slice(0, 4000);
}

let artifactFacts = { workbuddy_version: null, tarball_sha256: null };

function writeResult(id, status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id,
    status,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    environment: 'staging',
    ...artifactFacts,
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
    timeout: options.timeout || 300000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败（exit=${result.status}）：${sanitize(result.stderr || result.stdout)}`);
  return result;
}

function requireFile(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}`);
  const absolute = realpathSync(resolve(value));
  if (!statSync(absolute).isFile()) throw new Error(`${name} 不是文件：${absolute}`);
  return absolute;
}

function requireDirectory(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少 ${name}`);
  const absolute = realpathSync(resolve(value));
  if (!statSync(absolute).isDirectory()) throw new Error(`${name} 不是目录：${absolute}`);
  return absolute;
}

function isolatedEnv(profile) {
  const configRoot = join(profile, '.config');
  const cacheRoot = join(profile, '.cache');
  const codexRoot = join(profile, '.codex');
  for (const directory of [profile, configRoot, cacheRoot, codexRoot]) mkdirSync(directory, { recursive: true });
  return {
    ...process.env,
    HOME: profile,
    USERPROFILE: profile,
    XDG_CONFIG_HOME: configRoot,
    XDG_CACHE_HOME: cacheRoot,
    CODEX_HOME: codexRoot,
    OPENLOGOS_CODEX_PERSONAL_HOME: profile,
    CODEBUDDY_CONFIG_DIR: join(profile, '.codebuddy'),
  };
}

function probeWorkBuddyApplication(workBuddyApp) {
  if (process.platform !== 'darwin') throw new Error('当前真实 WorkBuddy app metadata 探测仅支持 macOS staging');
  const infoPlist = join(workBuddyApp, 'Contents', 'Info.plist');
  if (!existsSync(infoPlist)) throw new Error(`WorkBuddy app 缺少 Info.plist：${infoPlist}`);
  const result = checked('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', infoPlist]);
  const version = result.stdout.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) throw new Error(`无法识别 WorkBuddy app 版本：${sanitize(version)}`);
  return version;
}

function hashPathState(target) {
  if (!existsSync(target)) return 'absent';
  const hash = createHash('sha256');
  function walk(current, relativePath = '.') {
    const stat = lstatSync(current);
    hash.update(`${relativePath}\0${stat.isDirectory() ? 'directory' : stat.isSymbolicLink() ? 'symlink' : 'file'}\0`);
    if (stat.isSymbolicLink()) {
      hash.update(readlinkSync(current));
      return;
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(current).sort()) walk(join(current, name), relativePath === '.' ? name : `${relativePath}/${name}`);
      return;
    }
    hash.update(readFileSync(current));
  }
  walk(target);
  return hash.digest('hex');
}

function snapshotHostBoundary() {
  const hostHome = process.env.HOME;
  if (!hostHome) throw new Error('无法确定真实用户 Home，不能证明 staging 隔离');
  const boundaries = [
    '.agents/plugins/marketplace.json',
    '.codex/plugins/cache/personal/openlogos',
    '.codex/config.toml',
    '.codebuddy',
    '.workbuddy/memory',
    '.workbuddy/settings.json',
    '.workbuddy/plugins',
    '.workbuddy/user-state.json',
  ];
  return Object.fromEntries(boundaries.map(item => [item, hashPathState(join(hostHome, item))]));
}

function runDriver(phase, payload) {
  const driver = requireFile('OPENLOGOS_WORKBUDDY_DRIVER');
  const result = checked(process.execPath, [driver, phase], {
    cwd: payload.workspace || repoRoot,
    input: JSON.stringify(payload) + '\n',
    env: { ...process.env, OPENLOGOS_WORKBUDDY_STAGING: '1' },
  });
  const line = result.stdout.trim().split('\n').reverse().find(item => item.trim().startsWith('{'));
  if (!line) throw new Error(`WorkBuddy driver ${phase} 未输出 JSON`);
  const parsed = JSON.parse(line);
  if (parsed.ok !== true) throw new Error(`WorkBuddy driver ${phase} 返回失败：${sanitize(line)}`);
  const evidence = join(evidenceRoot, `${phase}.json`);
  writeFileSync(evidence, JSON.stringify(parsed, null, 2) + '\n');
  return { data: parsed, evidence };
}

function runCli(entry, cwd, args, profile) {
  if (!profile) throw new Error('OpenLogos CLI 调用缺少隔离 profile');
  return checked(process.execPath, [entry, ...args], { cwd, env: isolatedEnv(profile) });
}

function writeDeltaState(workspace) {
  const proposal = join(workspace, 'logos', 'changes', 'workbuddy-smoke');
  mkdirSync(join(proposal, 'deltas', 'spec'), { recursive: true });
  writeFileSync(join(workspace, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'workbuddy-smoke', module: 'core' }));
  writeFileSync(join(proposal, 'proposal.md'), '# WorkBuddy smoke\n');
  writeFileSync(join(proposal, 'PLAN_APPROVED'), '');
  writeFileSync(join(proposal, 'tasks.md'), [
    '# 实现任务',
    '## [delta] 规格变更',
    '- [ ] [MODIFY] deltas/spec/demo.md',
    '## [code] 代码实现',
    '- [ ] smoke fixture',
    '',
  ].join('\n'));
}

let failed = false;
let staging = null;
let context = null;
let hostBoundaryBefore = null;

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

await smoke('SMOKE-core-116', () => {
  if (process.env.OPENLOGOS_WORKBUDDY_STAGING !== '1') throw new Error('OPENLOGOS_WORKBUDDY_STAGING 必须显式为 1');
  const tarball = requireFile('OPENLOGOS_TARBALL');
  const workBuddyApp = requireDirectory('OPENLOGOS_WORKBUDDY_APP');
  const workBuddyAuthHome = requireDirectory('OPENLOGOS_WORKBUDDY_AUTH_HOME');
  const workBuddyBin = requireFile('OPENLOGOS_WORKBUDDY_BIN');
  requireFile('OPENLOGOS_WORKBUDDY_DRIVER');
  const workBuddyVersion = probeWorkBuddyApplication(workBuddyApp);
  staging = mkdtempSync(join(tmpdir(), 'openlogos-workbuddy-staging-'));
  const profile = join(staging, 'profile');
  hostBoundaryBefore = snapshotHostBoundary();
  const installRoot = join(staging, 'install');
  mkdirSync(installRoot, { recursive: true });
  checked(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', installRoot, '--no-audit', '--no-fund', tarball]);
  const packageRoot = join(installRoot, 'node_modules', '@miniidealab', 'openlogos');
  const entry = join(packageRoot, 'dist', 'index.js');
  if (!existsSync(entry)) throw new Error('真实 tarball 安装后缺少 CLI dist/index.js');
  const listing = checked('tar', ['-tzf', tarball]).stdout;
  for (const required of [
    'package/workbuddy-plugin-template/.workbuddy-plugin/plugin.json',
    'package/workbuddy-plugin-template/hooks/hooks.json',
    'package/workbuddy-plugin-template/hooks/runtime.mjs',
    'package/workbuddy-plugin-template/skills/',
    'package/workbuddy-plugin-template/commands/',
    'package/workbuddy-plugin-template/agents/',
  ]) if (!listing.includes(required)) throw new Error(`tarball 缺少 ${required}`);
  const cliVersion = runCli(entry, staging, ['--version'], profile).stdout.trim();
  if (cliVersion !== '0.13.28') throw new Error(`tarball CLI 版本不是 0.13.28：${cliVersion}`);
  const tarballHash = sha256(tarball);
  artifactFacts = { ...artifactFacts, workbuddy_version: workBuddyVersion, tarball_sha256: tarballHash };
  const artifact = {
    tarball,
    size: statSync(tarball).size,
    sha256: tarballHash,
    cli_version: cliVersion,
    workbuddy_app: workBuddyApp,
    workbuddy_version: workBuddyVersion,
    entry,
    package_root: packageRoot,
  };
  const evidence = join(evidenceRoot, 'tarball.json');
  writeFileSync(evidence, JSON.stringify(artifact, null, 2) + '\n');
  context = {
    ...artifact,
    staging,
    entry,
    packageRoot,
    workBuddyApp,
    workBuddyVersion,
    workBuddyBin,
    workBuddyAuthHome,
    profile,
  };
  return [evidence];
});

await smoke('SMOKE-core-117', () => {
  if (!context) throw new Error('tarball 前置失败');
  const workspace = join(context.staging, 'adopted-workspace');
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, 'package.json'), '{"name":"workbuddy-smoke-adopted"}\n');
  runCli(context.entry, workspace, ['adopt', 'workbuddy-smoke', '--locale', 'zh', '--ai-tool', 'workbuddy'], context.profile);
  const pluginPath = join(workspace, '.workbuddy', 'plugins', 'openlogos');
  context = { ...context, workspace, pluginPath };
  const capability = runDriver('capability', context);
  artifactFacts = { ...artifactFacts, workbuddy_version: capability.data.appVersion };
  if (capability.data.plugin?.name !== 'openlogos') throw new Error('真实 WorkBuddy 未发现唯一 openlogos identity');
  return [capability.evidence];
});

await smoke('SMOKE-core-118', () => {
  if (!context?.workspace) throw new Error('capability 前置失败');
  const protectedAssets = new Map([
    [join(context.workspace, '.workbuddy', 'settings.json'), Buffer.from('{"model":"staging"}\n')],
    [join(context.workspace, '.workbuddy', 'native-memory.bin'), Buffer.from([0, 255, 18, 4])],
    [join(context.workspace, '.workbuddy', 'plugins', 'user', 'asset'), Buffer.from('user-plugin')],
  ]);
  for (const [file, bytes] of protectedAssets) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); }
  const inventory = runDriver('inventory', context);
  for (const [file, bytes] of protectedAssets) if (!readFileSync(file).equals(bytes)) throw new Error(`用户边界发生变化：${file}`);
  return [inventory.evidence];
});

await smoke('SMOKE-core-119', () => {
  if (!context?.workspace) throw new Error('workspace 前置失败');
  const noGuard = runDriver('session-start', { ...context, expectedGuard: false });
  writeDeltaState(context.workspace);
  const withGuard = runDriver('session-start', { ...context, expectedGuard: true });
  for (const item of [noGuard.data, withGuard.data]) {
    if (typeof item.additionalContext !== 'string' || !item.additionalContext.includes('proposal_step:') || !item.additionalContext.includes('下一确认点')) {
      throw new Error('SessionStart 上下文与磁盘状态不一致');
    }
  }
  return [noGuard.evidence, withGuard.evidence];
});

await smoke('SMOKE-core-120', () => {
  if (!context?.workspace) throw new Error('workspace 前置失败');
  const target = join(context.workspace, 'logos', 'changes', 'workbuddy-smoke', 'deltas', 'spec', 'demo.md');
  const allow = runDriver('write', { ...context, target, content: '# allowed\n' });
  if (allow.data.permissionDecision !== 'allow' || allow.data.exitCode !== 0 || sha256(target) !== createHash('sha256').update('# allowed\n').digest('hex')) {
    throw new Error('真实 WorkBuddy allow 证据不完整');
  }
  return [allow.evidence];
});

await smoke('SMOKE-core-121', () => {
  if (!context?.workspace) throw new Error('workspace 前置失败');
  const source = join(context.workspace, 'src.txt');
  const outside = join(context.staging, 'outside.txt');
  const outsideDir = join(context.staging, 'outside-dir');
  writeFileSync(source, 'stable\n');
  writeFileSync(outside, 'outside\n');
  mkdirSync(outsideDir, { recursive: true });
  const link = join(context.workspace, 'escape');
  symlinkSync(outsideDir, link);
  const targets = [source, outside, join(link, 'escaped.txt')];
  const before = targets.slice(0, 2).map(sha256);
  const denied = runDriver('hard-deny', { ...context, targets });
  if (JSON.stringify(before) !== JSON.stringify(targets.slice(0, 2).map(sha256)) || existsSync(targets[2])) throw new Error('deny 后目标发生变化');
  if (!Array.isArray(denied.data.responses) || denied.data.responses.some(item => item.exitCode !== 2 || item.continue !== false || item.permissionDecision !== 'deny' || !item.permissionDecisionReason)) {
    throw new Error('未观察到全部 exit 2 hard deny');
  }
  return [denied.evidence];
});

await smoke('SMOKE-core-122', () => {
  if (!context?.workspace) throw new Error('workspace 前置失败');
  const memory = join(context.workspace, '.workbuddy', 'native-memory.bin');
  const before = sha256(memory);
  const lifecycle = runDriver('sync-launch', context);
  if (lifecycle.data.secondSync !== 'unchanged' || lifecycle.data.secondLaunch !== 'unchanged' || sha256(memory) !== before) {
    throw new Error('sync/launch 幂等或原生记忆零写入未通过');
  }
  return [lifecycle.evidence];
});

await smoke('SMOKE-core-123', () => {
  if (!context?.entry) throw new Error('tarball 前置失败');
  const previousTarball = requireFile('OPENLOGOS_PREVIOUS_TARBALL');
  const regressionRoot = join(context.staging, 'existing-hosts');
  mkdirSync(regressionRoot, { recursive: true });
  runCli(context.entry, regressionRoot, ['init', 'host-regression', '--locale', 'en', '--ai-tool', 'all'], context.profile);
  for (const required of [
    '.claude/commands/openlogos/status.md',
    '.opencode/plugins/openlogos.js',
    '.agents/plugins/openlogos/.codex-plugin/plugin.json',
    '.cursor/rules/openlogos-policy.mdc',
    '.zcode/plugins/openlogos/.zcode-plugin/plugin.json',
    '.qoder/plugins/openlogos/.qoder-plugin/plugin.json',
  ]) if (!existsSync(join(regressionRoot, required))) throw new Error(`既有六宿主回归缺少 ${required}`);
  const rollback = runDriver('rollback', { ...context, previousTarball, regressionRoot });
  if (rollback.data.restored !== true || rollback.data.restoredVersion !== '0.13.27' || rollback.data.userAssetsPreserved !== true) throw new Error('真实回滚证据不完整');
  const hostBoundaryAfter = snapshotHostBoundary();
  if (JSON.stringify(hostBoundaryBefore) !== JSON.stringify(hostBoundaryAfter)) {
    throw new Error('隔离 staging 修改了真实用户 Home 的 Codex、WorkBuddy 配置、插件或记忆边界');
  }
  const boundaryEvidence = join(evidenceRoot, 'host-home-boundary.json');
  writeFileSync(boundaryEvidence, JSON.stringify({ before: hostBoundaryBefore, after: hostBoundaryAfter, unchanged: true }, null, 2) + '\n');
  return [rollback.evidence, boundaryEvidence];
});

if (staging && process.env.OPENLOGOS_KEEP_WORKBUDDY_STAGING !== '1') rmSync(staging, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
