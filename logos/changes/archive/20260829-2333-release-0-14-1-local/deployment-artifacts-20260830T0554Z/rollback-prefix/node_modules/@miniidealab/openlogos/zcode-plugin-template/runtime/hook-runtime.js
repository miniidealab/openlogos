#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash']);
const SAFE_BASH = /^(?:pwd|ls(?:\s|$)|cat\s|sed\s|rg\s|git\s+(?:status|log|diff|show|branch|rev-parse|ls-files)(?:\s|$)|openlogos\s+(?:status|next|flow)(?:\s|$))/;

class HookInputError extends Error {}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function alias(record, camel, snake) {
  const hasCamel = Object.prototype.hasOwnProperty.call(record, camel);
  const hasSnake = Object.prototype.hasOwnProperty.call(record, snake);
  if (hasCamel && hasSnake && !sameValue(record[camel], record[snake])) {
    throw new HookInputError(`字段别名冲突：${camel}/${snake}`);
  }
  return hasCamel ? record[camel] : record[snake];
}

function normalizeHookEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HookInputError('Hook 输入必须是 JSON 对象');
  }
  const event = {
    sessionId: alias(input, 'sessionId', 'session_id'),
    hookEventName: alias(input, 'hookEventName', 'hook_event_name'),
    toolName: alias(input, 'toolName', 'tool_name'),
    toolInput: alias(input, 'toolInput', 'tool_input'),
    cwd: input.cwd,
  };
  if (event.toolInput !== undefined && (!event.toolInput || typeof event.toolInput !== 'object' || Array.isArray(event.toolInput))) {
    throw new HookInputError('toolInput/tool_input 必须是对象');
  }
  if (event.toolName !== undefined && typeof event.toolName !== 'string') {
    throw new HookInputError('toolName/tool_name 必须是字符串');
  }
  if (event.cwd !== undefined && typeof event.cwd !== 'string') {
    throw new HookInputError('cwd 必须是字符串');
  }
  return event;
}

function findProjectRoot(start) {
  let current = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(current, 'logos', 'logos.config.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isLaunched(root) {
  const projectFile = path.join(root, 'logos', 'logos-project.yaml');
  if (!fs.existsSync(projectFile)) return false;
  return /\blifecycle\s*:\s*[\"']?launched\b/.test(fs.readFileSync(projectFile, 'utf8'));
}

function codeTasks(content, section) {
  let active = false;
  const items = [];
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^## \[([a-z][a-z0-9-]*)\]/i.exec(line);
    if (heading) {
      active = heading[1].toLowerCase() === section;
      continue;
    }
    if (!active) continue;
    const item = /^- \[([ x])\]\s+(.+)$/i.exec(line);
    if (item) items.push({ checked: item[1].toLowerCase() === 'x', text: item[2] });
  }
  return items;
}

function deriveProposalStep(proposalDir) {
  if (fs.existsSync(path.join(proposalDir, 'SMOKE_PASS'))) return 'smoke-passed';
  if (fs.existsSync(path.join(proposalDir, 'DEPLOY_DONE'))) return 'ready-to-smoke';
  if (fs.existsSync(path.join(proposalDir, 'VERIFY_PASS'))) return 'ready-to-deploy';
  if (fs.existsSync(path.join(proposalDir, 'SPEC_MERGED'))) {
    const tasks = fs.readFileSync(path.join(proposalDir, 'tasks.md'), 'utf8');
    return codeTasks(tasks, 'code').every(item => item.checked) ? 'ready-to-verify' : 'coding';
  }
  const tasksFile = path.join(proposalDir, 'tasks.md');
  const tasks = fs.existsSync(tasksFile) ? fs.readFileSync(tasksFile, 'utf8') : '';
  const deltas = codeTasks(tasks, 'delta');
  if (fs.existsSync(path.join(proposalDir, 'PLAN_APPROVED'))) {
    return deltas.length > 0 && deltas.every(item => item.checked) ? 'ready-to-merge' : 'delta-writing';
  }
  return fs.existsSync(path.join(proposalDir, 'proposal.md')) && fs.existsSync(tasksFile)
    ? 'ready-to-delta'
    : 'writing';
}

function readSessionState(root) {
  const launched = isLaunched(root);
  const guardFile = path.join(root, 'logos', '.openlogos-guard');
  if (!fs.existsSync(guardFile)) {
    return { lifecycle: launched ? 'launched' : 'initial', slug: null, proposalStep: null, proposalDir: null };
  }
  const guard = readJson(guardFile);
  const slug = guard.activeChange;
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new HookInputError('guard.activeChange 非法');
  }
  const proposalDir = path.join(root, 'logos', 'changes', slug);
  return {
    lifecycle: launched ? 'launched' : 'initial',
    slug,
    proposalStep: deriveProposalStep(proposalDir),
    proposalDir,
  };
}

function sessionContext(root) {
  const state = readSessionState(root);
  const scope = state.slug
    ? `仅限活跃提案 ${state.slug} 与当前阶段允许的文件范围`
    : '无活跃提案，不允许修改源码';
  const nextGate = {
    writing: '完成提案后等待 plan-exit 确认',
    'ready-to-delta': '等待 plan-exit 确认',
    'delta-writing': '完成 delta 后等待 openlogos merge 人类确认',
    'ready-to-merge': '等待 openlogos merge 人类确认',
    coding: '完成代码与测试后等待 openlogos verify 人类确认',
    'ready-to-verify': '等待 openlogos verify 人类确认',
  }[state.proposalStep] || '创建变更提案后再修改源码';
  return [
    `OpenLogos lifecycle: ${state.lifecycle}`,
    `active change: ${state.slug || 'none'}`,
    `proposal_step: ${state.proposalStep || 'none'}`,
    `允许范围：${scope}`,
    '禁止动作：未经明确授权不得 merge、verify、deploy、smoke、archive 或 git push',
    `下一确认点：${nextGate}`,
  ].join('\n');
}

function resolveCandidate(root, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '' || rawPath.includes('\0')) {
    throw new HookInputError('写入目标路径缺失或非法');
  }
  const absolute = path.resolve(root, rawPath);
  let ancestor = absolute;
  const tail = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    tail.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = fs.realpathSync(ancestor);
  const resolved = path.join(realAncestor, ...tail);
  const realRoot = fs.realpathSync(root);
  const relative = path.relative(realRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new HookInputError('写入目标越出项目根目录');
  }
  return relative.split(path.sep).join('/');
}

function targetFromEvent(event) {
  const input = event.toolInput || {};
  if (event.toolName === 'Bash') {
    const command = input.command;
    if (typeof command !== 'string' || !SAFE_BASH.test(command.trim())) return null;
    return { safeBash: true };
  }
  const raw = input.filePath ?? input.file_path ?? input.path ?? input.notebook_path;
  return { path: raw };
}

function deny(reason) {
  return { decision: 'deny', reason };
}

function allow(reason = '当前 OpenLogos 阶段允许此操作') {
  return { decision: 'allow', reason };
}

function decideGuard(root, event) {
  if (!WRITE_TOOLS.has(event.toolName)) return allow('非写入工具');
  if (!isLaunched(root)) return allow('initial 生命周期不启用变更硬门禁');
  const target = targetFromEvent(event);
  if (target && target.safeBash) return allow('只读命令');
  if (event.toolName === 'Bash') return deny('无法可靠证明 Bash 命令只读，按 fail-closed 阻断');

  const state = readSessionState(root);
  if (!state.slug) return deny('launched 项目没有 guard；请先运行 openlogos change <slug>');
  const relative = resolveCandidate(root, target && target.path);
  const proposalPrefix = `logos/changes/${state.slug}/`;
  const taskPath = `${proposalPrefix}tasks.md`;
  const proposalPath = `${proposalPrefix}proposal.md`;
  const deltaPrefix = `${proposalPrefix}deltas/`;

  if (relative.startsWith('logos/changes/') && !relative.startsWith(proposalPrefix)) {
    return deny('目标属于其他提案，超出当前 guard 范围');
  }
  if (state.proposalStep === 'writing' || state.proposalStep === 'ready-to-delta') {
    return relative === proposalPath || relative === taskPath
      ? allow()
      : deny('plan 阶段仅允许当前提案 proposal.md 与 tasks.md');
  }
  if (state.proposalStep === 'delta-writing') {
    return relative === taskPath || relative.startsWith(deltaPrefix)
      ? allow()
      : deny('delta-writing 仅允许当前提案 deltas/** 与 tasks.md');
  }
  if (state.proposalStep === 'ready-to-merge') {
    return deny('delta 已完成；请等待 openlogos merge 人类确认，不得继续写入');
  }
  return allow();
}

function sessionOutput(context) {
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  };
}

function guardOutput(result) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: result.decision,
    },
  };
  if (result.reason) output.hookSpecificOutput.permissionDecisionReason = result.reason;
  return output;
}

function protocolFailure(reason) {
  return guardOutput(deny(`OpenLogos Hook fail-closed：${reason}`));
}

function run(mode, raw, cwd) {
  const input = JSON.parse(raw);
  const event = normalizeHookEvent(input);
  const root = findProjectRoot(event.cwd || cwd);
  if (!root) throw new HookInputError('未找到 logos/logos.config.json');
  return mode === 'session'
    ? { output: sessionOutput(sessionContext(root)), exitCode: 0 }
    : (() => {
        const result = decideGuard(root, event);
        return { output: guardOutput(result), exitCode: result.decision === 'deny' ? 2 : 0 };
      })();
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'session' && mode !== 'guard') {
    process.stdout.write(JSON.stringify(protocolFailure('入口参数必须是 session 或 guard')) + '\n');
    process.exitCode = 2;
    return;
  }
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try {
    const result = run(mode, raw, process.cwd());
    process.stdout.write(JSON.stringify(result.output) + '\n');
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知运行时错误';
    process.stderr.write(`OpenLogos ZCode Hook: ${message}\n`);
    process.stdout.write(JSON.stringify(protocolFailure(message)) + '\n');
    process.exitCode = 2;
  }
}

module.exports = {
  HookInputError,
  decideGuard,
  deriveProposalStep,
  findProjectRoot,
  guardOutput,
  normalizeHookEvent,
  readSessionState,
  resolveCandidate,
  run,
  sessionContext,
};

if (require.main === module) void main();
