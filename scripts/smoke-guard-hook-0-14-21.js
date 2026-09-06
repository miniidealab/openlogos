#!/usr/bin/env node
// SMOKE-core-192：0.14.21 guard 修复发布全链（$CLAUDE_PROJECT_DIR 注册 / 子目录 cwd 拦截 / fail-closed /
// 存量项目 sync 补齐）+ 固定 0.14.20 fail-open 与资产缺失对照 + roundtrip。
// guard 行为断言以 stdin JSON + env + cwd 驱动真实随包 guard-check；sync 断言穿过公开 init/sync 命令。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SMOKE_ID = 'SMOKE-core-192';
const EXPECTED_VERSION = '0.14.21';
const ROLLBACK_VERSION = '0.14.20';
const NEW_GUARD_COMMAND = '"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/guard-check';
const NEW_PHASE_COMMAND = '"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/openlogos-phase';
const LEGACY_PHASE_COMMAND = '.claude/openlogos/bin/openlogos-phase';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const guardPath = join(repoRoot, 'logos', '.openlogos-guard');

function activeChange() {
  if (!existsSync(guardPath)) return null;
  try { return JSON.parse(readFileSync(guardPath, 'utf8')).activeChange || null; } catch { return null; }
}

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/guard-hook-smoke@1',
    ids: [SMOKE_ID],
    required_env: ['OPENLOGOS_GUARD_HOOK_TARBALL', 'OPENLOGOS_GUARD_HOOK_ROLLBACK_TARBALL'],
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

if (activeChange() !== 'deploy-0-14-21-guard-hook-release' && process.env.OPENLOGOS_GUARD_HOOK_STAGING !== '1') {
  exitNotApplicable([SMOKE_ID], {
    reason: 'guard hook staging 未就绪：需活跃变更 deploy-0-14-21-guard-hook-release 或 OPENLOGOS_GUARD_HOOK_STAGING=1',
    missing: ['OPENLOGOS_GUARD_HOOK_STAGING', 'OPENLOGOS_GUARD_HOOK_TARBALL'],
    environment: 'guard-hook-staging',
  });
}

const tarball = process.env.OPENLOGOS_GUARD_HOOK_TARBALL;
const rollbackTarball = process.env.OPENLOGOS_GUARD_HOOK_ROLLBACK_TARBALL;

function sanitize(value) {
  return String(value).replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>').slice(0, 4000);
}

function writeResult(status, startedAt, error, evidence = []) {
  mkdirSync(dirname(resultPath), { recursive: true });
  const record = {
    id: SMOKE_ID, status, timestamp: new Date().toISOString(),
    duration_ms: Date.now() - startedAt, environment: 'guard-hook-staging', evidence,
  };
  if (error) record.error = sanitize(error);
  appendFileSync(resultPath, JSON.stringify(record) + '\n');
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot, env: { ...process.env, ...(options.env || {}) },
    encoding: 'utf8', timeout: options.timeout || 300000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} 失败：exit ${result.status}\n${result.stderr}`);
  }
  return result;
}

const work = mkdtempSync(join(tmpdir(), 'openlogos-guard-smoke-'));

function installPrefix(file, name) {
  const prefix = join(work, `prefix-${name}`);
  mkdirSync(prefix, { recursive: true });
  checked('npm', ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', file]);
  return {
    entry: join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js'),
    pkgRoot: join(prefix, 'node_modules/@miniidealab/openlogos'),
  };
}

/** 以 stdin JSON + env + cwd 驱动项目内随包 guard-check（真实脚本、真实字节）。 */
function runGuard(projDir, cwd, toolName, toolInput, projectDirEnv) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDirEnv) env.CLAUDE_PROJECT_DIR = projectDirEnv;
  const script = join(projDir, '.claude', 'openlogos', 'bin', 'guard-check');
  const result = spawnSync('bash', [script], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    cwd, encoding: 'utf8', timeout: 10000, env,
  });
  return { exitCode: result.status ?? 1, stdout: result.stdout ?? '' };
}

function initClaudeProject(entry, dir) {
  mkdirSync(dir, { recursive: true });
  checked(process.execPath, [entry, 'init', 'demo', '--locale', 'zh', '--ai-tool', 'claude-code'], { cwd: dir });
  // 置 launched（guard 硬闸只在 launched 生效）
  writeFileSync(join(dir, 'logos', 'logos-project.yaml'),
    'project:\n  name: "demo"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
  mkdirSync(join(dir, 'src'), { recursive: true });
  return dir;
}

function settingsCommands(dir, event) {
  const json = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8'));
  return (json.hooks?.[event] ?? []).flatMap(group => (group.hooks ?? []).map(h => h.command ?? ''));
}

const startedAt = Date.now();
try {
  if (!tarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_GUARD_HOOK_TARBALL'), { __skip: true });
  if (!rollbackTarball) throw Object.assign(new Error('环境缺失：OPENLOGOS_GUARD_HOOK_ROLLBACK_TARBALL'), { __skip: true });
  const evidence = [];

  // ① candidate identity（含随包 guard-check 新字节与 manifest 条目）
  const candidate = installPrefix(tarball, 'candidate');
  const version = checked(process.execPath, [candidate.entry, '--version']).stdout.trim();
  if (version !== EXPECTED_VERSION) throw new Error(`candidate 版本漂移：${version}`);
  const bundledGuard = readFileSync(join(candidate.pkgRoot, 'claude-plugin-template', 'bin', 'guard-check'), 'utf8');
  if (!bundledGuard.includes('CLAUDE_PROJECT_DIR')) throw new Error('随包 guard-check 缺工作目录收敛（旧字节）');
  const manifest = JSON.parse(readFileSync(join(candidate.pkgRoot, 'asset-manifest.json'), 'utf8'));
  const guardEntry = (manifest.plugins ?? []).find(item => item.path === 'claude-plugin-template/bin/guard-check');
  if (!guardEntry) throw new Error('asset-manifest 缺 guard-check 托管条目');
  evidence.push(`candidate=${EXPECTED_VERSION} sha256:${sha256(tarball)}`);

  // ② guard 全链：init 新项目 → 新形态注册 → 子目录 cwd 拦截/放行
  const proj = initClaudeProject(candidate.entry, join(work, 'p-guard'));
  const guardCmds = settingsCommands(proj, 'PreToolUse');
  const phaseCmds = settingsCommands(proj, 'SessionStart');
  if (!guardCmds.includes(NEW_GUARD_COMMAND)) throw new Error(`PreToolUse 未按新形态注册：${JSON.stringify(guardCmds)}`);
  if (!phaseCmds.includes(NEW_PHASE_COMMAND)) throw new Error(`SessionStart 未按新形态注册：${JSON.stringify(phaseCmds)}`);
  const sub = join(proj, 'src');
  const blocked = runGuard(proj, sub, 'Edit', { file_path: join(proj, 'src', 'app.ts') }, proj);
  if (blocked.exitCode !== 2 || !blocked.stdout.includes('reason')) throw new Error(`子目录 cwd 无提案 Edit 未被拦：exit ${blocked.exitCode}`);
  writeFileSync(join(proj, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
  const allowed = runGuard(proj, sub, 'Edit', { file_path: join(proj, 'src', 'app.ts') }, proj);
  if (allowed.exitCode !== 0) throw new Error(`有提案仍被拦：exit ${allowed.exitCode}`);
  rmSync(join(proj, 'logos', '.openlogos-guard'));
  evidence.push('guard 全链（新形态注册 + 子目录 cwd 拦截/放行）通过');

  // ③ fail-closed：变量缺失+子目录 cwd / 变量坏目录
  const noVar = runGuard(proj, sub, 'Edit', { file_path: join(proj, 'src', 'app.ts') }, null);
  if (noVar.exitCode !== 2) throw new Error(`变量缺失+子目录 cwd 未 fail-closed：exit ${noVar.exitCode}`);
  const badVar = runGuard(proj, sub, 'Edit', { file_path: join(proj, 'src', 'app.ts') }, join(work, 'no-such-dir'));
  if (badVar.exitCode !== 2) throw new Error(`变量坏目录未 fail-closed：exit ${badVar.exitCode}`);
  evidence.push('fail-closed（变量缺失非根 / 坏目录）通过');

  // ④ 存量项目 sync 补齐：删 guard-check、settings 仅旧相对 SessionStart → sync 齐备且迁移；二跑幂等
  const legacy = initClaudeProject(candidate.entry, join(work, 'p-legacy'));
  rmSync(join(legacy, '.claude', 'openlogos', 'bin', 'guard-check'));
  writeFileSync(join(legacy, '.claude', 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: LEGACY_PHASE_COMMAND }] }] },
  }, null, 2));
  checked(process.execPath, [candidate.entry, 'sync'], { cwd: legacy });
  const restored = join(legacy, '.claude', 'openlogos', 'bin', 'guard-check');
  if (!existsSync(restored)) throw new Error('存量项目 sync 未补齐 guard-check');
  if (readFileSync(restored, 'utf8') !== bundledGuard) throw new Error('补齐的 guard-check 与随包字节不一致');
  if (!settingsCommands(legacy, 'PreToolUse').includes(NEW_GUARD_COMMAND)) throw new Error('sync 未补齐 PreToolUse 新形态注册');
  if (!settingsCommands(legacy, 'SessionStart').includes(NEW_PHASE_COMMAND)) throw new Error('sync 未迁移旧 SessionStart 条目');
  const settingsBefore = readFileSync(join(legacy, '.claude', 'settings.json'), 'utf8');
  checked(process.execPath, [candidate.entry, 'sync'], { cwd: legacy });
  if (readFileSync(join(legacy, '.claude', 'settings.json'), 'utf8') !== settingsBefore) throw new Error('重复 sync settings 漂移（不幂等）');
  evidence.push('存量项目 sync 补齐与幂等通过');

  // ⑤ 0.14.20 对照：fail-open 与资产缺失必须复现（防断言空转）
  const rollback = installPrefix(rollbackTarball, 'rollback');
  const rollbackVersion = checked(process.execPath, [rollback.entry, '--version']).stdout.trim();
  if (rollbackVersion !== ROLLBACK_VERSION) throw new Error(`回滚版本漂移：${rollbackVersion}`);
  const contrast = initClaudeProject(rollback.entry, join(work, 'p-contrast'));
  const contrastSub = join(contrast, 'src');
  const oldOpen = runGuard(contrast, contrastSub, 'Edit', { file_path: join(contrast, 'src', 'app.ts') }, null);
  if (oldOpen.exitCode !== 0) throw new Error(`对照空转：0.14.20 子目录 cwd 未静默放行（exit ${oldOpen.exitCode}），矩阵必须重写`);
  rmSync(join(contrast, '.claude', 'openlogos', 'bin', 'guard-check'));
  writeFileSync(join(contrast, '.claude', 'settings.json'), JSON.stringify({
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: LEGACY_PHASE_COMMAND }] }] },
  }, null, 2));
  checked(process.execPath, [rollback.entry, 'sync'], { cwd: contrast });
  if (existsSync(join(contrast, '.claude', 'openlogos', 'bin', 'guard-check'))) {
    throw new Error('对照空转：0.14.20 sync 也补齐了 guard-check，矩阵必须重写');
  }
  evidence.push('0.14.20 fail-open 与 sync 资产缺失对照有效');

  // ⑥ roundtrip identity
  const restoredEntry = installPrefix(tarball, 'restore').entry;
  const restoredVersion = checked(process.execPath, [restoredEntry, '--version']).stdout.trim();
  if (restoredVersion !== EXPECTED_VERSION) throw new Error('roundtrip 恢复失败');
  evidence.push(`roundtrip ${ROLLBACK_VERSION}→${EXPECTED_VERSION} 无混装`);

  writeResult('pass', startedAt, null, evidence);
  console.log(`✓ ${SMOKE_ID}`);
} catch (error) {
  if (error && error.__skip) {
    writeResult('skip', startedAt, error.message, []);
    console.log(`- ${SMOKE_ID} skip: ${error.message}`);
  } else {
    writeResult('fail', startedAt, error instanceof Error ? error.message : String(error), []);
    console.error(`✗ ${SMOKE_ID}: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
