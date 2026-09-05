#!/usr/bin/env node
// SMOKE-core-182～189：Cursor 三件套补齐（0.14.18）安装态冒烟。
// 真实宿主红线（185/186/187）必须经真实 cursor-agent 驱动（OPENLOGOS_CURSOR_DRIVER），
// mock 或直接调用 runtime 不计入闭环证据；环境缺失写显式 skip，禁止静默零记录退出。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SMOKE_IDS = Array.from({ length: 8 }, (_, index) => `SMOKE-core-${182 + index}`);
const EXPECTED_VERSION = '0.14.18';
const ROLLBACK_VERSION = '0.14.17';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/cursor-staging-smoke@1',
    ids: SMOKE_IDS,
    required_env: [
      'OPENLOGOS_CURSOR_STAGING=1',
      'OPENLOGOS_CURSOR_TARBALL',
      'OPENLOGOS_CURSOR_PREVIOUS_TARBALL',
      'OPENLOGOS_CURSOR_AGENT_BIN',
      'OPENLOGOS_CURSOR_DRIVER',
    ],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'cursor-adapter-parity' && process.env.OPENLOGOS_CURSOR_STAGING !== '1') {
  exitNotApplicable(SMOKE_IDS, {
    reason: 'Cursor staging 宿主未就绪：需活跃变更 cursor-adapter-parity 或 OPENLOGOS_CURSOR_STAGING=1',
    missing: ['OPENLOGOS_CURSOR_STAGING', 'OPENLOGOS_CURSOR_TARBALL', 'OPENLOGOS_CURSOR_AGENT_BIN'],
    environment: 'cursor-staging',
  });
}

function sanitize(value) {
  return String(value)
    .replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>')
    .replace(/(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,}]+/gi, '$1=<redacted>')
    .slice(0, 4000);
}

let artifactFacts = { cursor_agent_version: null, tarball_sha256: null };

function writeResult(id, status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id,
    status,
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    environment: 'cursor-staging',
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
    env: { ...process.env, ...(options.env || {}) },
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeout || 300000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} 失败：exit ${result.status}\n${result.stderr}`);
  }
  return result;
}

/** 真实宿主驱动：OPENLOGOS_CURSOR_DRIVER 是外部脚本，输入子命令与项目根，输出 JSON 判定。 */
function hostDriver(action, projectRoot) {
  const driver = process.env.OPENLOGOS_CURSOR_DRIVER;
  if (!driver) throw new Error('missing OPENLOGOS_CURSOR_DRIVER（真实宿主断言必须经驱动，禁止 mock）');
  const result = checked(process.execPath, [driver, action, projectRoot], { timeout: 600000 });
  return JSON.parse(result.stdout);
}

const tarball = process.env.OPENLOGOS_CURSOR_TARBALL;
const previousTarball = process.env.OPENLOGOS_CURSOR_PREVIOUS_TARBALL;
const cursorAgentBin = process.env.OPENLOGOS_CURSOR_AGENT_BIN;

function runCase(id, fn) {
  const startedAt = Date.now();
  try {
    const evidence = fn();
    writeResult(id, 'pass', startedAt, null, evidence || []);
    console.log(`✓ ${id}`);
  } catch (error) {
    if (error && error.__skip) {
      writeResult(id, 'skip', startedAt, error.message, []);
      console.log(`- ${id} skip: ${error.message}`);
      return;
    }
    writeResult(id, 'fail', startedAt, error instanceof Error ? error.message : String(error), []);
    console.error(`✗ ${id}: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}

function skip(message) {
  const error = new Error(message);
  error.__skip = true;
  throw error;
}

function requireEnv(name, value) {
  if (!value) skip(`环境缺失：${name}`);
  return value;
}

const work = mkdtempSync(join(tmpdir(), 'openlogos-cursor-smoke-'));
const prefix = join(work, 'prefix');
mkdirSync(prefix, { recursive: true });
let entry = null;

function installTarball(file) {
  checked('npm', ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', file]);
  return join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js');
}

function cli(args, options = {}) {
  if (!entry) skip('前置 SMOKE-core-182 未完成安装（环境缺失连锁 skip）');
  return checked(process.execPath, [entry, ...args], options);
}

function scaffoldCursorProject(dir, extraArgs = []) {
  if (!entry) skip('前置 SMOKE-core-182 未完成安装（环境缺失连锁 skip）');
  mkdirSync(dir, { recursive: true });
  checked(process.execPath, [entry, 'init', 'demo', '--locale', 'zh', '--ai-tool', 'cursor', ...extraArgs], { cwd: dir });
}

// ── SMOKE-core-182：candidate identity 与随包 cursor 资产 ──
runCase('SMOKE-core-182', () => {
  requireEnv('OPENLOGOS_CURSOR_TARBALL', tarball);
  artifactFacts.tarball_sha256 = `sha256:${sha256(tarball)}`;
  entry = installTarball(tarball);
  const version = cli(['--version']).stdout.trim();
  if (version !== EXPECTED_VERSION) throw new Error(`candidate 版本漂移：${version} != ${EXPECTED_VERSION}`);
  const packageRoot = join(prefix, 'node_modules/@miniidealab/openlogos');
  for (const required of [
    'cursor-plugin-template/hooks/hooks.json',
    'cursor-plugin-template/hooks/runtime.cjs',
    'cursor-plugin-template/agents/change-reviewer.md',
    'cursor-plugin-template/skills/prd-writer/SKILL.md',
    'cursor-plugin-template/commands/openlogos-next/SKILL.md',
    'spec/cursor-plugin.md',
  ]) {
    if (!existsSync(join(packageRoot, required))) throw new Error(`随包资产缺失：${required}`);
  }
  return [`version=${version}`, `tarball=${artifactFacts.tarball_sha256}`];
});

// ── SMOKE-core-183：init 三件套落盘 + all 展开 ──
runCase('SMOKE-core-183', () => {
  if (!entry) skip('前置 SMOKE-core-182 未完成安装（环境缺失连锁 skip）');
  const project = join(work, 'p183');
  scaffoldCursorProject(project);
  for (const required of [
    '.cursor/skills/prd-writer/SKILL.md',
    '.cursor/skills/openlogos-next/SKILL.md',
    '.cursor/agents/change-reviewer.md',
    '.cursor/hooks.json',
    '.cursor/hooks/openlogos-runtime.cjs',
  ]) {
    if (!existsSync(join(project, required))) throw new Error(`init 资产缺失：${required}`);
  }
  const hooks = JSON.parse(readFileSync(join(project, '.cursor/hooks.json'), 'utf8'));
  const events = Object.keys(hooks.hooks).sort().join(',');
  if (events !== 'afterFileEdit,beforeShellExecution,sessionStart') throw new Error(`hooks 事件不齐：${events}`);
  if (existsSync(join(project, '.cursor/rules'))) throw new Error('init 不应产出 .cursor/rules');
  const allProject = join(work, 'p183-all');
  mkdirSync(allProject, { recursive: true });
  checked(process.execPath, [entry, 'init', 'demo', '--locale', 'zh', '--ai-tool', 'all'], { cwd: allProject });
  const config = JSON.parse(readFileSync(join(allProject, 'logos/logos.config.json'), 'utf8'));
  if (!JSON.stringify(config.aiTool).includes('cursor')) throw new Error('all 展开不含 cursor');
  return ['init 三件套落盘', `all=${JSON.stringify(config.aiTool)}`];
});

// ── SMOKE-core-184：存量 adopt 与托管 .mdc 迁移 ──
runCase('SMOKE-core-184', () => {
  const project = join(work, 'p184');
  mkdirSync(join(project, '.cursor', 'rules'), { recursive: true });
  writeFileSync(join(project, '.cursor/rules/prd-writer.mdc'), 'legacy managed\n');
  writeFileSync(join(project, '.cursor/rules/my-team-style.mdc'), 'user rule keep me\n');
  writeFileSync(join(project, '.cursor/hooks.json'), JSON.stringify({
    version: 1, hooks: { stop: [{ type: 'command', command: './user-stop.sh' }] },
  }, null, 2) + '\n');
  const userHooksBefore = readFileSync(join(project, '.cursor/hooks.json'), 'utf8');
  checked(process.execPath, [entry, 'adopt', 'demo', '--locale', 'zh', '--ai-tool', 'cursor'], { cwd: project });
  if (existsSync(join(project, '.cursor/rules/prd-writer.mdc'))) throw new Error('托管 .mdc 未迁移清理');
  if (readFileSync(join(project, '.cursor/rules/my-team-style.mdc'), 'utf8') !== 'user rule keep me\n') {
    throw new Error('用户 rules 被改动');
  }
  const hooksAfter = JSON.parse(readFileSync(join(project, '.cursor/hooks.json'), 'utf8'));
  if (JSON.stringify(hooksAfter.hooks.stop) !== JSON.stringify([{ type: 'command', command: './user-stop.sh' }])) {
    throw new Error('用户 hooks 条目漂移');
  }
  void userHooksBefore;
  return ['adopt 迁移完成', '用户 rules/hooks 保留'];
});

// ── SMOKE-core-185：真实宿主 Skills 与显式命令发现（红线，必须真实 cursor-agent） ──
runCase('SMOKE-core-185', () => {
  requireEnv('OPENLOGOS_CURSOR_AGENT_BIN', cursorAgentBin);
  requireEnv('OPENLOGOS_CURSOR_DRIVER', process.env.OPENLOGOS_CURSOR_DRIVER);
  const project = join(work, 'p185');
  scaffoldCursorProject(project);
  const verdict = hostDriver('discover-skills', project);
  if (!verdict.skills_discovered) throw new Error('真实宿主未发现 OpenLogos Skills');
  if (!verdict.command_reachable) throw new Error('显式命令 /openlogos-* 不可触达');
  return [`cursor-agent=${verdict.cursor_agent_version || 'unknown'}`];
});

// ── SMOKE-core-186：sessionStart 实测与 hook 事件覆盖面记录（红线） ──
runCase('SMOKE-core-186', () => {
  requireEnv('OPENLOGOS_CURSOR_AGENT_BIN', cursorAgentBin);
  requireEnv('OPENLOGOS_CURSOR_DRIVER', process.env.OPENLOGOS_CURSOR_DRIVER);
  const project = join(work, 'p186');
  scaffoldCursorProject(project);
  const verdict = hostDriver('session-start', project);
  artifactFacts.cursor_agent_version = verdict.cursor_agent_version || null;
  if (!verdict.session_context_injected) throw new Error('sessionStart 实测未触发（能力假设失效，回提案层修订）');
  if (!Array.isArray(verdict.hook_events_measured) || verdict.hook_events_measured.length === 0) {
    throw new Error('缺少 CLI hook 事件覆盖面实测清单');
  }
  return [`hook_events_measured=${verdict.hook_events_measured.join('/')}`];
});

// ── SMOKE-core-187：部分强度门禁实测（红线：deny 四要素 + 编辑报告如实未阻断） ──
runCase('SMOKE-core-187', () => {
  requireEnv('OPENLOGOS_CURSOR_AGENT_BIN', cursorAgentBin);
  requireEnv('OPENLOGOS_CURSOR_DRIVER', process.env.OPENLOGOS_CURSOR_DRIVER);
  const project = join(work, 'p187');
  scaffoldCursorProject(project);
  const verdict = hostDriver('guard-matrix', project);
  if (!verdict.in_scope_shell_allowed) throw new Error('范围内 shell 写入被误拦');
  if (!verdict.out_of_scope_shell_denied) throw new Error('越界 shell 写入未被 deny');
  for (const fact of ['Active change', 'Proposal step', 'Allowed scope', 'Target', 'Next action']) {
    if (!String(verdict.deny_reason || '').includes(fact)) throw new Error(`deny 原因缺要素：${fact}`);
  }
  if (!verdict.edit_report_received) throw new Error('越界编辑未收到事后检测报告');
  if (!String(verdict.edit_report || '').includes('NOT blocked')) throw new Error('编辑报告未如实声明未阻断');
  if (!verdict.edited_file_mutated) throw new Error('编辑报告场景中文件未实际变更（伪装成阻断？）');
  return ['shell deny 四要素齐备', '编辑事后报告如实'];
});

// ── SMOKE-core-188：hooks.json 合并保真与幂等 ──
runCase('SMOKE-core-188', () => {
  const project = join(work, 'p188');
  mkdirSync(join(project, '.cursor'), { recursive: true });
  writeFileSync(join(project, '.cursor/hooks.json'), JSON.stringify({
    version: 1, vendor: { keep: [1, 2] }, hooks: { stop: [{ type: 'command', command: './mine.sh' }] },
  }, null, 2) + '\n');
  scaffoldCursorProject(project);
  const merged = JSON.parse(readFileSync(join(project, '.cursor/hooks.json'), 'utf8'));
  if (JSON.stringify(merged.vendor) !== JSON.stringify({ keep: [1, 2] })) throw new Error('未知字段漂移');
  if (JSON.stringify(merged.hooks.stop) !== JSON.stringify([{ type: 'command', command: './mine.sh' }])) {
    throw new Error('用户条目漂移');
  }
  const bytesBefore = readFileSync(join(project, '.cursor/hooks.json'), 'utf8');
  checked(process.execPath, [entry, 'sync'], { cwd: project });
  if (readFileSync(join(project, '.cursor/hooks.json'), 'utf8') !== bytesBefore) throw new Error('重复 sync 非幂等');
  const broken = join(work, 'p188-broken');
  mkdirSync(join(broken, '.cursor'), { recursive: true });
  writeFileSync(join(broken, '.cursor/hooks.json'), '{ broken');
  const brokenBytes = readFileSync(join(broken, '.cursor/hooks.json'), 'utf8');
  const failed = checked(process.execPath,
    [entry, 'init', 'demo', '--locale', 'zh', '--ai-tool', 'cursor'],
    { cwd: broken, allowFailure: true });
  if (failed.status === 0) throw new Error('损坏 hooks.json 未 fail loud');
  if (readFileSync(join(broken, '.cursor/hooks.json'), 'utf8') !== brokenBytes) throw new Error('损坏路径发生写入');
  return ['合并保真', '幂等', '损坏 fail loud 零写入'];
});

// ── SMOKE-core-189：既有宿主零回归与回滚往返 ──
runCase('SMOKE-core-189', () => {
  requireEnv('OPENLOGOS_CURSOR_PREVIOUS_TARBALL', previousTarball);
  // 既有宿主最小回归：all 项目断言六宿主资产在场
  const project = join(work, 'p189');
  mkdirSync(project, { recursive: true });
  checked(process.execPath, [entry, 'init', 'demo', '--locale', 'zh', '--ai-tool', 'all'], { cwd: project });
  for (const required of [
    '.claude/commands/openlogos/status.md',
    '.opencode/plugins/openlogos.js',
    '.agents/plugins/openlogos/.codex-plugin/plugin.json',
    '.zcode/plugins/openlogos/.zcode-plugin/plugin.json',
    '.qoder/plugins/openlogos/.qoder-plugin/plugin.json',
    '.workbuddy/plugins/openlogos/.workbuddy-plugin/plugin.json',
  ]) {
    if (!existsSync(join(project, required))) throw new Error(`既有宿主资产缺失：${required}`);
  }
  // 回滚往返：0.14.17 → 0.14.18 → 0.14.17 → 0.14.18
  const previousEntry = installTarball(previousTarball);
  const previousVersion = checked(process.execPath, [previousEntry, '--version']).stdout.trim();
  if (previousVersion !== ROLLBACK_VERSION) throw new Error(`回滚版本漂移：${previousVersion}`);
  const rollbackProject = join(work, 'p189-prev');
  mkdirSync(rollbackProject, { recursive: true });
  checked(process.execPath, [previousEntry, 'init', 'demo', '--locale', 'zh', '--ai-tool', 'cursor'], { cwd: rollbackProject });
  // 零回归对照：0.14.17 上 init cursor 仍是降级档（.mdc，无三件套）——矩阵不空转
  if (!existsSync(join(rollbackProject, '.cursor/rules/openlogos-policy.mdc'))) {
    throw new Error('对照空转：回滚版竟不产 .mdc 降级档');
  }
  if (existsSync(join(rollbackProject, '.cursor/skills/prd-writer/SKILL.md'))) {
    throw new Error('对照空转：回滚版竟已有三件套');
  }
  entry = installTarball(tarball);
  const restored = cli(['--version']).stdout.trim();
  if (restored !== EXPECTED_VERSION) throw new Error(`恢复候选失败：${restored}`);
  return [`roundtrip ${ROLLBACK_VERSION}→${EXPECTED_VERSION} 无混装`, '六既有宿主回归通过', '零回归对照有效'];
});

rmSync(work, { recursive: true, force: true });
if (process.exitCode) {
  console.error('cursor staging smoke 存在失败用例');
} else {
  console.log('cursor staging smoke 完成');
}
