#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildWorkBuddyWriteDenySandboxProfile } from './lib/workbuddy-host-boundary.mjs';

const PHASES = ['capability', 'inventory', 'session-start', 'write', 'hard-deny', 'sync-launch', 'rollback'];

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/workbuddy-staging-driver@1',
    minimum_app_version: '5.3.5',
    phases: PHASES,
    real_cli_commands: ['--version', 'plugin validate', '--plugin-dir', '--print', '--tools Read,Glob', '--agent'],
    host_write_boundary: 'darwin-sandbox-exec',
    public_release_commands: [],
  }) + '\n');
  process.exit(0);
}

function sanitize(value) {
  return String(value)
    .replaceAll(process.env.HOME || '__NO_HOME__', '<HOME>')
    .replace(/(?:api[_-]?key|token|secret|password)\s*[=:]\s*[^\s,}]+/gi, '$1=<redacted>')
    .slice(0, 12000);
}

function checked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    input: options.input,
    encoding: 'utf8',
    timeout: options.timeout || 180000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${basename(command)} ${args.join(' ')} 失败（exit=${result.status}）：${sanitize(result.stderr || result.stdout)}`);
  }
  return result;
}

function parseJsonOutput(output, label) {
  const text = String(output).trim();
  try { return JSON.parse(text); } catch { /* 尝试 JSONL 最后一行 */ }
  for (const line of text.split('\n').reverse()) {
    try { return JSON.parse(line); } catch { /* 继续 */ }
  }
  throw new Error(`${label} 未输出 JSON：${sanitize(text)}`);
}

function openLogosEnv(payload) {
  return {
    ...process.env,
    HOME: payload.profile,
    USERPROFILE: payload.profile,
    XDG_CONFIG_HOME: join(payload.profile, '.config'),
    XDG_CACHE_HOME: join(payload.profile, '.cache'),
    CODEX_HOME: join(payload.profile, '.codex'),
    OPENLOGOS_CODEX_PERSONAL_HOME: payload.profile,
    CODEBUDDY_CONFIG_DIR: join(payload.profile, '.codebuddy'),
  };
}

function workBuddyEnv(payload) {
  return {
    ...openLogosEnv(payload),
    HOME: payload.workBuddyHostHome,
    USERPROFILE: payload.workBuddyHostHome,
    CODEBUDDY_CONFIG_DIR: join(payload.workBuddyAuthHome, '.codebuddy'),
    CODEBUDDY_DISABLE_AUTO_MEMORY: '1',
    CODEBUDDY_MEMORY_ENABLED: '0',
    CODEBUDDY_MEMORY_EXTRACTION_DISABLED: '1',
    CODEBUDDY_MEMORY_EXTRACTION_ENABLED: '0',
    CODEBUDDY_MEMORY_RELEVANCE_DISABLED: '1',
    CODEBUDDY_MEMORY_RELEVANCE_ENABLED: '0',
    CODEBUDDY_DISABLE_MEMORY_CLEANUP: '1',
    CODEBUDDY_TEAM_MEMORY_ENABLED: '0',
    CODEBUDDY_TYPED_MEMORY_ENABLED: '0',
  };
}

function runWorkBuddy(payload, args, options = {}) {
  const sandboxed = process.platform === 'darwin';
  const command = sandboxed ? '/usr/bin/sandbox-exec' : payload.workBuddyBin;
  const commandArgs = sandboxed
    ? ['-p', buildWorkBuddyWriteDenySandboxProfile(payload.workBuddyHostHome), payload.workBuddyBin, ...args]
    : args;
  return checked(command, commandArgs, {
    cwd: options.cwd || payload.workspace,
    env: workBuddyEnv(payload),
    timeout: options.timeout || 600000,
    allowFailure: options.allowFailure,
  });
}

function workBuddySession(payload, prompt, options = {}) {
  const args = [
    '--plugin-dir', payload.pluginPath,
    '--print',
    '--no-session-persistence',
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--tools', options.tools || '',
    '--max-turns', '4',
  ];
  if (options.agent) args.push('--agent', options.agent);
  args.push(prompt);
  const maxAttempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : 1;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = runWorkBuddy(payload, args, { allowFailure: true });
      if (result.status !== 0 && !String(result.stdout).trim()) {
        throw new Error(`WorkBuddy headless session 失败（exit=${result.status}）：${sanitize(result.stderr)}`);
      }
      const output = parseJsonOutput(result.stdout, 'WorkBuddy headless session');
      const parsed = Array.isArray(output)
        ? [...output].reverse().find(item => item && item.type === 'result')
        : output;
      if (!parsed || typeof parsed !== 'object') throw new Error('WorkBuddy headless session 缺少最终 result 事件');
      if (result.status !== 0 || parsed.is_error === true) {
        throw new Error(`WorkBuddy headless session 未成功：${sanitize(result.stderr || result.stdout)}`);
      }
      return {
        parsed,
        stdout: sanitize(result.stdout),
        stderr: sanitize(result.stderr),
        exitCode: result.status,
        attempt,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function versionTuple(raw) {
  const match = String(raw).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`无法识别 WorkBuddy 版本：${sanitize(raw)}`);
  return { text: match[0], parts: match.slice(1).map(Number) };
}

function atLeast(actual, minimum) {
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== minimum[index]) return actual[index] > minimum[index];
  }
  return true;
}

function directoryHash(root) {
  const hash = createHash('sha256');
  function walk(dir, prefix = '') {
    for (const name of readdirSync(dir).sort()) {
      const absolute = join(dir, name);
      const item = prefix ? `${prefix}/${name}` : name;
      const stat = statSync(absolute);
      if (stat.isDirectory()) walk(absolute, item);
      else {
        hash.update(item);
        hash.update('\0');
        hash.update(readFileSync(absolute));
      }
    }
  }
  walk(root);
  return hash.digest('hex');
}

function validatePlugin(payload) {
  const result = runWorkBuddy(payload, ['plugin', 'validate', payload.pluginPath], { allowFailure: true });
  if (result.status !== 0) throw new Error(`WorkBuddy plugin validate 失败：${sanitize(result.stderr || result.stdout)}`);
  const manifest = JSON.parse(readFileSync(join(payload.pluginPath, '.workbuddy-plugin', 'plugin.json'), 'utf8'));
  if (manifest.name !== 'openlogos') throw new Error('WorkBuddy 插件 identity 不是 openlogos');
  return { manifest, validation: sanitize(result.stdout || result.stderr) };
}

function invokeRuntime(payload, mode, event) {
  const result = checked(process.execPath, [join(payload.pluginPath, 'hooks', 'runtime.mjs'), mode], {
    cwd: payload.workspace,
    env: openLogosEnv(payload),
    input: JSON.stringify(event),
    allowFailure: true,
  });
  return { exitCode: result.status, output: parseJsonOutput(result.stdout, `WorkBuddy ${mode} runtime`), stderr: sanitize(result.stderr) };
}

function sessionText(session) {
  return String(session.parsed.result || session.parsed.message || session.stdout);
}

function parseEmbeddedJson(value, label) {
  if (value && typeof value === 'object') return value;
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { /* 继续尝试提取对象 */ }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* 由统一错误收口 */ }
  }
  throw new Error(`${label} 未返回结构化 JSON：${sanitize(text)}`);
}

async function readPayload() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 2 * 1024 * 1024) throw new Error('driver 输入超过 2 MiB');
  }
  const payload = JSON.parse(raw);
  for (const key of ['workspace', 'pluginPath', 'workBuddyBin', 'workBuddyVersion', 'workBuddyAuthHome', 'workBuddyHostHome', 'profile']) {
    if (typeof payload[key] !== 'string' || payload[key].length === 0) throw new Error(`driver 缺少 ${key}`);
  }
  mkdirSync(payload.profile, { recursive: true });
  return payload;
}

async function execute(phase, payload) {
  if (phase === 'capability') {
    const appVersion = versionTuple(payload.workBuddyVersion);
    if (!atLeast(appVersion.parts, [5, 3, 5])) throw new Error(`WorkBuddy app ${appVersion.text} 低于 5.3.5`);
    const engineVersionResult = runWorkBuddy(payload, ['--version']);
    const engineVersion = versionTuple(engineVersionResult.stdout || engineVersionResult.stderr);
    const plugin = validatePlugin(payload);
    const probe = workBuddySession(payload, '只回复 OPENLOGOS_PLUGIN_READY，不调用工具。');
    if (!sessionText(probe).includes('OPENLOGOS_PLUGIN_READY')) throw new Error('真实 WorkBuddy --plugin-dir 新会话探测失败');
    const hooks = JSON.parse(readFileSync(join(payload.pluginPath, 'hooks', 'hooks.json'), 'utf8'));
    if (!hooks.hooks?.SessionStart || !hooks.hooks?.PreToolUse) throw new Error('WorkBuddy 缺少扩展 Hook capability');
    return {
      appVersion: appVersion.text,
      engineVersion: engineVersion.text,
      plugin: plugin.manifest,
      validation: plugin.validation,
      session: probe.parsed,
    };
  }

  if (phase === 'inventory') {
    validatePlugin(payload);
    const expectedComponents = [
      ['skills', 'change-writer'],
      ['commands', 'status'],
      ['agents', 'change-reviewer'],
    ];
    let session;
    let inventory;
    let missing = [];
    for (let semanticAttempt = 1; semanticAttempt <= 3; semanticAttempt += 1) {
      session = workBuddySession(
        payload,
        `必须使用 Glob 和 Read 检查当前已加载插件目录 ${JSON.stringify(payload.pluginPath)} 的 skills、commands、agents；最后只回复一行紧凑 JSON，精确键为 skills、commands、agents，值为各目录实际文件名去扩展名后的字符串数组。`,
        { tools: 'Read,Glob', attempts: 2 },
      );
      inventory = parseEmbeddedJson(sessionText(session), 'WorkBuddy component inventory');
      missing = expectedComponents.filter(([kind, expected]) => {
        const names = Array.isArray(inventory[kind]) ? inventory[kind].map(item => String(item).toLowerCase()) : [];
        return !names.some(name => name.includes(expected));
      });
      if (missing.length === 0) break;
    }
    if (missing.length > 0) throw new Error(`WorkBuddy inventory 未发现 ${missing.map(item => item.join('/')).join(', ')}`);
    const agentProbe = workBuddySession(
      payload,
      '只回复 OPENLOGOS_AGENT_READY，不调用工具。',
      { agent: 'change-reviewer', attempts: 2 },
    );
    if (!sessionText(agentProbe).includes('OPENLOGOS_AGENT_READY')) throw new Error('WorkBuddy 无法调用 change-reviewer agent');
    return {
      observedInventory: inventory,
      discoveryAttempts: session.attempt,
      agentInvocationAttempts: agentProbe.attempt,
      agentInvocation: agentProbe.parsed,
    };
  }

  if (phase === 'session-start') {
    const runtime = invokeRuntime(payload, 'session', {
      session_id: 'workbuddy-staging-driver', hook_event_name: 'SessionStart', source: 'startup', cwd: payload.workspace,
    });
    const context = runtime.output.hookSpecificOutput?.additionalContext;
    if (runtime.exitCode !== 0 || typeof context !== 'string') throw new Error('SessionStart runtime 未产生上下文');
    const session = workBuddySession(payload, '报告当前 OpenLogos lifecycle、active change、proposal_step 与下一确认点；只回复可见状态，不调用工具。');
    const observed = sessionText(session);
    const expected = payload.expectedGuard ? 'workbuddy-smoke' : 'none';
    if (!context.includes(`active change: ${expected}`)) throw new Error('SessionStart 磁盘上下文与期望不一致');
    if (payload.expectedGuard && !observed.includes('workbuddy-smoke')) throw new Error('真实 WorkBuddy 新会话未观察到活跃提案');
    return { additionalContext: context, observedContext: observed, workbuddy: session.parsed };
  }

  if (phase === 'write') {
    const rawTarget = relative(payload.workspace, payload.target).split('\\').join('/');
    const session = workBuddySession(payload, `必须且仅使用 Write 工具把精确内容 ${JSON.stringify(payload.content)} 写入项目相对路径 ${JSON.stringify(rawTarget)}，完成后只回复 DONE。`, { tools: 'Write' });
    if (!existsSync(payload.target) || readFileSync(payload.target, 'utf8') !== payload.content) throw new Error('真实 WorkBuddy allow 后未执行写入');
    return { permissionDecision: 'allow', exitCode: 0, workbuddy: session.parsed };
  }

  if (phase === 'hard-deny') {
    const responses = [];
    for (const target of payload.targets) {
      const rawTarget = target.startsWith(payload.workspace) ? relative(payload.workspace, target).split('\\').join('/') : target;
      const session = workBuddySession(payload, `必须使用 Write 工具尝试把 blocked 写入 ${JSON.stringify(rawTarget)}；失败后不要改用其它工具。`, { tools: 'Write' });
      const runtime = invokeRuntime(payload, 'guard', {
        session_id: 'workbuddy-staging-driver', hook_event_name: 'PreToolUse', cwd: payload.workspace,
        tool_name: 'Write', tool_input: { file_path: rawTarget, content: 'blocked' },
      });
      const hook = runtime.output.hookSpecificOutput;
      if (runtime.exitCode !== 2 || hook?.permissionDecision !== 'deny' || !hook?.permissionDecisionReason) throw new Error(`目标 ${rawTarget} 未产生 exit 2 hard deny`);
      if (!/den(?:y|ied)|permission|block|阻断|拒绝/i.test(JSON.stringify(session.parsed))) throw new Error('真实 WorkBuddy session 未返回阻断证据');
      responses.push({ target: rawTarget, exitCode: runtime.exitCode, continue: runtime.output.continue, ...hook, workbuddy: session.parsed });
    }
    return { responses };
  }

  if (phase === 'sync-launch') {
    const before = directoryHash(payload.pluginPath);
    checked(process.execPath, [payload.entry, 'sync'], { cwd: payload.workspace, env: openLogosEnv(payload) });
    const first = directoryHash(payload.pluginPath);
    checked(process.execPath, [payload.entry, 'sync'], { cwd: payload.workspace, env: openLogosEnv(payload) });
    const second = directoryHash(payload.pluginPath);
    checked(process.execPath, [payload.entry, 'launch'], { cwd: payload.workspace, env: openLogosEnv(payload) });
    const launchFirst = directoryHash(payload.pluginPath);
    checked(process.execPath, [payload.entry, 'launch'], { cwd: payload.workspace, env: openLogosEnv(payload) });
    const launchSecond = directoryHash(payload.pluginPath);
    if (before !== first || first !== second || second !== launchFirst || launchFirst !== launchSecond) throw new Error('WorkBuddy sync/launch 托管资产不幂等');
    validatePlugin(payload);
    return { secondSync: 'unchanged', secondLaunch: 'unchanged', hash: launchSecond };
  }

  if (phase === 'rollback') {
    const rollbackRoot = join(payload.staging, 'rollback-install');
    mkdirSync(rollbackRoot, { recursive: true });
    checked(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', rollbackRoot, '--no-audit', '--no-fund', payload.previousTarball]);
    const previousEntry = join(rollbackRoot, 'node_modules', '@miniidealab', 'openlogos', 'dist', 'index.js');
    if (!existsSync(previousEntry)) throw new Error('0.13.27 tarball 无法恢复 CLI entry');
    const restoredVersion = checked(process.execPath, [previousEntry, '--version'], {
      cwd: payload.regressionRoot,
      env: openLogosEnv(payload),
    }).stdout.trim();
    return { restored: restoredVersion === '0.13.27', restoredVersion, userAssetsPreserved: existsSync(payload.regressionRoot) };
  }

  throw new Error(`未知 driver phase：${phase}`);
}

const phase = process.argv[2];
try {
  if (!PHASES.includes(phase)) throw new Error(`phase 必须是 ${PHASES.join(', ')}`);
  const payload = await readPayload();
  const data = await execute(phase, payload);
  process.stdout.write(JSON.stringify({ ok: true, phase, ...data }) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, phase, error: sanitize(error instanceof Error ? error.message : error) }) + '\n');
  process.exitCode = 1;
}
