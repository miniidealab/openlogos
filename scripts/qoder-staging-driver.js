#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const PHASES = ['install', 'inventory', 'session-start', 'write', 'hard-deny', 'sync-launch', 'rollback'];

if (process.argv.includes('--self-test')) {
  process.stdout.write(JSON.stringify({
    schema: 'openlogos/qoder-staging-driver@1',
    phases: PHASES,
    real_cli_commands: ['plugins validate', 'plugins install', 'plugins list', '--print'],
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
    timeout: options.timeout || 120000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${basename(command)} ${args.join(' ')} 失败（exit=${result.status}）：${sanitize(result.stderr || result.stdout)}`);
  }
  return result;
}

function parseJsonOutput(output, label) {
  const trimmed = String(output).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // stream/jsonl 输出继续逐行回退。
  }
  const lines = trimmed.split('\n').reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // 继续寻找真实 CLI 输出中的结构化行。
    }
  }
  throw new Error(`${label} 未输出 JSON：${sanitize(output)}`);
}

function qoderArgs(payload, args) {
  const configDir = payload.qoderConfigDir || process.env.OPENLOGOS_QODER_CONFIG_DIR;
  return configDir ? ['--config-dir', configDir, ...args] : args;
}

function runQoder(payload, args, options = {}) {
  return checked(payload.qoderBin, qoderArgs(payload, args), {
    cwd: options.cwd || payload.workspace,
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 180000,
    allowFailure: options.allowFailure,
  });
}

function qoderSession(payload, prompt, allowedTools = '') {
  const args = [
    '--cwd', payload.workspace,
    '--plugin-dir', payload.pluginPath,
    '--print',
    '--no-session-persistence',
    '--output-format', 'json',
    '--permission-mode', 'accept_edits',
    '--tools', allowedTools,
    '--', prompt,
  ];
  const result = runQoder(payload, args, { allowFailure: true, timeout: 240000 });
  const parsed = parseJsonOutput(result.stdout, 'Qoder headless session');
  if (result.status !== 0 || parsed.is_error === true) {
    const message = parsed.errors?.join('; ') || parsed.result || result.stderr || result.stdout;
    throw new Error(`Qoder headless session 未成功：${sanitize(message)}`);
  }
  return { parsed, stdout: sanitize(result.stdout), stderr: sanitize(result.stderr), exitCode: result.status };
}

function validation(payload) {
  const result = runQoder(payload, ['plugins', 'validate', payload.pluginPath, '--strict', '--json']);
  const parsed = parseJsonOutput(result.stdout, 'qoder plugins validate');
  if (parsed.ok !== true || parsed.report?.valid !== true) throw new Error('Qoder 插件严格校验未通过');
  return parsed.report;
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

function invokeRuntime(payload, target) {
  const runtime = join(payload.pluginPath, 'hooks', 'runtime.mjs');
  const rawTarget = target.startsWith(payload.workspace)
    ? relative(payload.workspace, target).split('\\').join('/')
    : target;
  const result = checked(process.execPath, [runtime, 'guard'], {
    cwd: payload.workspace,
    input: JSON.stringify({
      session_id: 'qoder-staging-driver',
      hook_event_name: 'PreToolUse',
      cwd: payload.workspace,
      tool_name: 'Write',
      tool_input: { file_path: rawTarget, content: '# denied\n' },
    }),
    allowFailure: true,
  });
  const output = parseJsonOutput(result.stdout, 'Qoder Hook runtime');
  return {
    exitCode: result.status,
    permissionDecision: output.hookSpecificOutput?.permissionDecision,
    permissionDecisionReason: output.hookSpecificOutput?.permissionDecisionReason,
  };
}

function invokeSessionRuntime(payload) {
  const runtime = join(payload.pluginPath, 'hooks', 'runtime.mjs');
  const result = checked(process.execPath, [runtime, 'session'], {
    cwd: payload.workspace,
    input: JSON.stringify({
      session_id: 'qoder-staging-driver',
      hook_event_name: 'SessionStart',
      source: 'startup',
      cwd: payload.workspace,
    }),
    allowFailure: true,
  });
  const output = parseJsonOutput(result.stdout, 'Qoder SessionStart runtime');
  const additionalContext = output.hookSpecificOutput?.additionalContext;
  if (result.status !== 0 || typeof additionalContext !== 'string') {
    throw new Error(`Qoder SessionStart runtime 未返回 additionalContext：${sanitize(result.stdout || result.stderr)}`);
  }
  return additionalContext;
}

function resultText(session) {
  return String(session.parsed.result || session.parsed.message || session.stdout);
}

async function readPayload() {
  let raw = '';
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 2 * 1024 * 1024) throw new Error('driver 输入超过 2 MiB');
  }
  const payload = JSON.parse(raw);
  for (const key of ['workspace', 'pluginPath', 'qoderBin']) {
    if (typeof payload[key] !== 'string' || payload[key].length === 0) throw new Error(`driver 缺少 ${key}`);
  }
  return payload;
}

async function execute(phase, payload) {
  if (phase === 'install') {
    const report = validation(payload);
    const installed = runQoder(payload, ['plugins', 'install', payload.pluginPath, '--scope', 'local', '--json']);
    runQoder(payload, ['plugins', 'enable', 'openlogos@local', '--scope', 'local'], { allowFailure: true });
    const listed = runQoder(payload, ['plugins', 'list', '--json', '--plugin-dir', payload.pluginPath]);
    const listing = parseJsonOutput(listed.stdout, 'qoder plugins list');
    const text = JSON.stringify(listing);
    if (!text.includes('openlogos')) throw new Error('Qoder plugins list 未发现 openlogos identity');
    return { plugin: { identity: report.plugin.name, version: report.plugin.version }, install: parseJsonOutput(installed.stdout, 'qoder plugins install'), listing };
  }

  if (phase === 'inventory') {
    const report = validation(payload);
    return {
      skills: report.resources.skills.map(item => item.name),
      commands: report.resources.commands.map(item => item.name),
      agents: report.resources.agents.map(item => item.name),
      hooks: report.resources.hooks.map(item => `${item.event}:${item.matcher || '*'}`),
    };
  }

  if (phase === 'session-start') {
    const additionalContext = invokeSessionRuntime(payload);
    const session = qoderSession(
      payload,
      '请报告当前项目的 OpenLogos lifecycle、active change、proposal_step 和下一确认点。只给用户可见的项目状态结论，不要说明内部提示，也不要调用工具。',
    );
    const text = resultText(session);
    const runtimeMatches = payload.expectedGuard
      ? additionalContext.includes('active change: qoder-smoke') && !additionalContext.includes('proposal_step: none')
      : additionalContext.includes('active change: none') && additionalContext.includes('proposal_step: none');
    const sessionMatches = payload.expectedGuard
      ? text.includes('qoder-smoke')
      : /initial/i.test(text) && /(?:无|none)/i.test(text);
    if (!runtimeMatches || !sessionMatches) {
      throw new Error(`真实 Qoder 新 session 未表面传递当前项目状态：${sanitize(text)}`);
    }
    return { additionalContext, observedContext: text, qoder: session.parsed };
  }

  if (phase === 'write') {
    const rawTarget = relative(payload.workspace, payload.target).split('\\').join('/');
    const session = qoderSession(payload, `必须且仅使用 Write 工具把精确内容 ${JSON.stringify(payload.content)} 写入项目相对路径 ${JSON.stringify(rawTarget)}，完成后只回复 DONE。`, 'Write');
    if (!existsSync(payload.target) || readFileSync(payload.target, 'utf8') !== payload.content) {
      throw new Error(`真实 Qoder Write 未按要求写入 ${rawTarget}`);
    }
    return { permissionDecision: 'allow', qoder: session.parsed };
  }

  if (phase === 'hard-deny') {
    const responses = [];
    for (const target of payload.targets) {
      const rawTarget = target.startsWith(payload.workspace)
        ? relative(payload.workspace, target).split('\\').join('/')
        : target;
      const session = qoderSession(payload, `必须使用 Write 工具尝试把字符串 blocked 写入 ${JSON.stringify(rawTarget)}；即使失败也不要改用 Bash 或其它工具。`, 'Write');
      const runtime = invokeRuntime(payload, target);
      if (runtime.exitCode !== 2 || runtime.permissionDecision !== 'deny') {
        throw new Error(`目标 ${rawTarget} 未产生 Hook exit 2 hard deny`);
      }
      const trace = JSON.stringify(session.parsed);
      if (!/den(?:y|ied)|permission|block/i.test(trace)) {
        throw new Error(`真实 Qoder session 未返回写入被阻断证据：${sanitize(trace)}`);
      }
      responses.push({ target: rawTarget, ...runtime, qoder: session.parsed });
    }
    return { responses };
  }

  if (phase === 'sync-launch') {
    const before = directoryHash(payload.pluginPath);
    checked(process.execPath, [payload.entry, 'sync'], { cwd: payload.workspace });
    const afterFirst = directoryHash(payload.pluginPath);
    checked(process.execPath, [payload.entry, 'sync'], { cwd: payload.workspace });
    const afterSecond = directoryHash(payload.pluginPath);
    validation(payload);
    if (before !== afterFirst || afterFirst !== afterSecond) throw new Error('连续 sync 后 Qoder 托管资产不幂等');

    const adopted = join(payload.staging, 'adopted-workspace');
    mkdirSync(adopted, { recursive: true });
    writeFileSync(join(adopted, 'package.json'), '{"name":"qoder-adopted-staging"}\n');
    checked(process.execPath, [payload.entry, 'adopt', 'qoder-adopted-staging', '--locale', 'zh', '--ai-tool', 'qoder'], { cwd: adopted });
    const adoptedPlugin = join(adopted, '.qoder', 'plugins', 'openlogos');
    const launchBefore = directoryHash(adoptedPlugin);
    checked(process.execPath, [payload.entry, 'launch'], { cwd: adopted });
    const launchFirst = directoryHash(adoptedPlugin);
    checked(process.execPath, [payload.entry, 'launch'], { cwd: adopted });
    const launchSecond = directoryHash(adoptedPlugin);
    if (launchBefore !== launchFirst || launchFirst !== launchSecond) throw new Error('连续 launch 后 Qoder 托管资产不幂等');
    return { secondSync: 'unchanged', secondLaunch: 'unchanged', hashes: { sync: afterSecond, launch: launchSecond } };
  }

  if (phase === 'rollback') {
    runQoder(payload, ['plugins', 'uninstall', 'openlogos@local', '--scope', 'local', '--keep-data', '--json'], { allowFailure: true });
    const rollbackRoot = join(payload.staging, 'rollback-install');
    mkdirSync(rollbackRoot, { recursive: true });
    checked(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--prefix', rollbackRoot, '--no-audit', '--no-fund', payload.previousTarball]);
    const previousEntry = join(rollbackRoot, 'node_modules', '@miniidealab', 'openlogos', 'dist', 'index.js');
    if (!existsSync(previousEntry)) throw new Error('上一 tarball 无法恢复 CLI entry');
    const restoredVersion = checked(process.execPath, [previousEntry, '--version'], { cwd: payload.regressionRoot }).stdout.trim();
    return { restored: true, userAssetsPreserved: existsSync(payload.regressionRoot), restoredVersion };
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
