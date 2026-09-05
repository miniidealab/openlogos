#!/usr/bin/env node
'use strict';

// OpenLogos Cursor Hook Runtime — 部分强度门禁接线（capability honesty：cursor-agent CLI 无 preToolUse）。
// 模式：
//   session — sessionStart：阶段上下文注入（输出不构成授权）
//   shell   — beforeShellExecution：shell 写入硬拦（deny 退出码 2）
//   edit    — afterFileEdit：越界编辑事后检测报告（不能阻断，如实声明）
// fail-closed：shell 路径任何异常一律 deny；edit 路径任何异常一律产出「无法安全判断」报告。

const fs = require('node:fs');
const path = require('node:path');

class HookInputError extends Error {}

// 与 plugin/bin/guard-check 的 BASH_SAFE_PATTERNS 语义对齐（含 openlogos *、git push、只读命令族）。
const SHELL_SAFE_PATTERNS = [
  /^openlogos(\s|$)/,
  /^git (status|log|diff|show|branch|fetch|pull|stash list|tag$|describe|rev-parse|ls-files|shortlog|blame|remote)/,
  /^git (add|commit|push|tag )/,
  /^npm (test|run test|run build|run dev|run generate|run check|run lint|run typecheck|run start|pack)/,
  /^npx (vitest|jest|mocha|ts-node|tsc)/,
  /^vitest/, /^node --test/,
  /^ls(\s|$)/, /^cat /, /^find /, /^grep /, /^rg /, /^head /, /^tail /, /^wc /,
  /^echo /, /^printf /, /^pwd$/, /^cd /, /^which /, /^type /, /^env$/, /^printenv/,
  /^python3 -c/, /^node -e/, /^node -p/, /^curl /, /^wget /, /^jq /, /^sort /, /^uniq /,
  /^awk /, /^sed [^-]/, /^tr /, /^cut /, /^diff /, /^test /, /^\[ /, /^true$/, /^false$/,
  /^sleep /, /^date(\s|$)/, /^uname/, /^sw_vers/, /^nvm /, /^node --version/, /^npm --version/, /^gh /,
];

// 与 guard-check 的 BASH_WRITE_PATTERNS 对齐：命中即视为潜在仓库写入。
const SHELL_WRITE_PATTERNS = [
  /sed -i/, / > /, / >> /, /\| tee /, /^tee /, /^mv /, /^cp /, /^rm /, /^mkdir/, /^touch /,
  /^chmod /, /^chown /, /^npm install/, /^npm uninstall/, /^npm ci/,
  /^git reset/, /^git checkout /, /^git restore/, /^git rm/, /^git stash pop/, /^git stash drop/,
  /^git merge/, /^git rebase/, /^git cherry-pick/, /writeFileSync/, /mkdirSync/,
];

// 与 guard-check 的 WHITELIST_PREFIXES 对齐（guard 缺失时也允许写入的路径前缀）。
// 注意：logos/changes/ 不入通用白名单——提案目录写入必须先过 proposal_step 收敛判定。
const PATH_WHITELIST_PREFIXES = [
  'logos/.openlogos-guard', 'logos/logos-project.yaml',
  '.claude/', '.opencode/', '.codex-plugin/', '.cursor/',
  'logos/skills/', 'logos/spec/', '.gitignore', 'README', 'CLAUDE.md', 'AGENTS.md',
  'opencode.json', '.openlogos',
];

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

function normalizeCursorEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HookInputError('Hook 输入必须是 JSON 对象');
  }
  const workspaceRoots = alias(input, 'workspaceRoots', 'workspace_roots');
  const event = {
    hookEventName: alias(input, 'hookEventName', 'hook_event_name'),
    conversationId: alias(input, 'conversationId', 'conversation_id'),
    command: input.command,
    filePath: alias(input, 'filePath', 'file_path'),
    workspaceRoots,
    cwd: input.cwd,
  };
  if (event.command !== undefined && typeof event.command !== 'string') {
    throw new HookInputError('command 必须是字符串');
  }
  if (event.filePath !== undefined && typeof event.filePath !== 'string') {
    throw new HookInputError('file_path 必须是字符串');
  }
  if (event.cwd !== undefined && typeof event.cwd !== 'string') {
    throw new HookInputError('cwd 必须是字符串');
  }
  if (workspaceRoots !== undefined && !Array.isArray(workspaceRoots)) {
    throw new HookInputError('workspace_roots 必须是数组');
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

function isLaunched(root) {
  const projectFile = path.join(root, 'logos', 'logos-project.yaml');
  if (!fs.existsSync(projectFile)) return false;
  return /\blifecycle\s*:\s*["']?launched\b/.test(fs.readFileSync(projectFile, 'utf8'));
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
  const guard = JSON.parse(fs.readFileSync(guardFile, 'utf8'));
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

const GUARD_STRENGTH_LINE =
  'guard 强度：cursor-agent CLI 为部分强度（beforeShellExecution 硬拦 shell 写入 + afterFileEdit 编辑事后检测，CLI 无 preToolUse）；Cursor IDE 经同一 .cursor/hooks.json 获得完整 preToolUse 硬拦';

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
    GUARD_STRENGTH_LINE,
    '禁止动作：未经明确授权不得 merge、verify、deploy、smoke、archive 或 git push',
    `下一确认点：${nextGate}`,
  ].join('\n');
}

function resolveCandidate(root, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '' || rawPath.includes('\0')) {
    throw new HookInputError('目标路径缺失或非法');
  }
  const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(root, rawPath);
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
    throw new HookInputError('目标越出项目根目录');
  }
  return relative.split(path.sep).join('/');
}

function isWhitelistedPath(relative) {
  return PATH_WHITELIST_PREFIXES.some(prefix => relative.startsWith(prefix));
}

function denyFacts(state, target) {
  return [
    'OpenLogos guard denied this shell write.',
    `Active change: ${state.slug || 'none'}`,
    `Proposal step: ${state.proposalStep || 'none'}`,
    `Allowed scope: ${state.slug
      ? `logos/changes/${state.slug}/deltas/** and tasks.md (per proposal step)`
      : 'none (no active change proposal)'}`,
    `Target: ${target}`,
    state.slug
      ? 'Next action: finish the current step deliverables, then follow the next confirmation gate.'
      : 'Next action: run `openlogos change <slug>` to open a change proposal first.',
  ].join('\n');
}

/** 判定文件路径写入是否在当前阶段范围内（shell 重定向目标与原生编辑共用）。 */
function decidePathScope(root, state, relative) {
  if (!relative.startsWith('logos/changes/') && isWhitelistedPath(relative)) {
    return { decision: 'allow', reason: '白名单路径' };
  }
  if (!state.slug) {
    return { decision: 'deny', reason: 'launched 项目没有活跃提案；请先运行 openlogos change <slug>' };
  }
  const proposalPrefix = `logos/changes/${state.slug}/`;
  const taskPath = `${proposalPrefix}tasks.md`;
  const proposalPath = `${proposalPrefix}proposal.md`;
  const deltaPrefix = `${proposalPrefix}deltas/`;
  if (relative.startsWith('logos/changes/') && !relative.startsWith(proposalPrefix)) {
    return { decision: 'deny', reason: '目标属于其他提案，超出当前 guard 范围' };
  }
  if (state.proposalStep === 'writing' || state.proposalStep === 'ready-to-delta') {
    return relative === proposalPath || relative === taskPath
      ? { decision: 'allow', reason: 'plan 阶段提案文件' }
      : { decision: 'deny', reason: 'plan 阶段仅允许当前提案 proposal.md 与 tasks.md' };
  }
  if (state.proposalStep === 'delta-writing') {
    return relative === taskPath || relative.startsWith(deltaPrefix)
      ? { decision: 'allow', reason: 'delta-writing 范围内' }
      : { decision: 'deny', reason: 'delta-writing 仅允许当前提案 deltas/** 与 tasks.md' };
  }
  if (state.proposalStep === 'ready-to-merge') {
    return { decision: 'deny', reason: 'delta 已完成；请等待 openlogos merge 人类确认，不得继续写入' };
  }
  return { decision: 'allow', reason: '当前 OpenLogos 阶段允许此操作' };
}

function decideShell(root, command) {
  if (typeof command !== 'string' || command.trim() === '') {
    throw new HookInputError('beforeShellExecution 缺少 command');
  }
  const trimmed = command.trim();
  if (SHELL_SAFE_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return { decision: 'allow', reason: '安全白名单命令' };
  }
  if (!isLaunched(root)) return { decision: 'allow', reason: 'initial 生命周期不启用变更硬门禁' };
  if (!SHELL_WRITE_PATTERNS.some(pattern => pattern.test(trimmed))) {
    return { decision: 'allow', reason: '未命中写入模式，按既有 guard 语义放行' };
  }
  const state = readSessionState(root);
  // 尝试提取重定向目标做路径级判定（与 guard-check 一致）。
  const redirect = / >{1,2} *([^ ]+)/.exec(trimmed);
  if (redirect) {
    try {
      const relative = resolveCandidate(root, redirect[1]);
      const scoped = decidePathScope(root, state, relative);
      if (scoped.decision === 'allow') return scoped;
      return { decision: 'deny', reason: denyFacts(state, relative) };
    } catch {
      return { decision: 'deny', reason: denyFacts(state, redirect[1]) };
    }
  }
  if (!state.slug) {
    return { decision: 'deny', reason: denyFacts(state, trimmed.slice(0, 120)) };
  }
  if (state.proposalStep === 'writing' || state.proposalStep === 'ready-to-delta'
    || state.proposalStep === 'delta-writing' || state.proposalStep === 'ready-to-merge') {
    return { decision: 'deny', reason: denyFacts(state, trimmed.slice(0, 120)) };
  }
  return { decision: 'allow', reason: '当前 OpenLogos 阶段允许此操作' };
}

const EDIT_NOT_BLOCKED_LINE =
  'This edit was NOT blocked (cursor-agent CLI has no preToolUse). Review and revert if unintended.';

function decideEdit(root, filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new HookInputError('afterFileEdit 缺少 file_path');
  }
  if (!isLaunched(root)) return null;
  const state = readSessionState(root);
  const relative = resolveCandidate(root, filePath);
  const scoped = decidePathScope(root, state, relative);
  if (scoped.decision === 'allow') return null;
  return [
    '⚠ OpenLogos guard: file edit outside allowed scope detected (post-check).',
    `Edited: ${relative}`,
    `Reason: ${scoped.reason}`,
    `Active change: ${state.slug || 'none'} | Proposal step: ${state.proposalStep || 'none'}`,
    EDIT_NOT_BLOCKED_LINE,
  ].join('\n');
}

function sessionOutput(context) {
  return {
    hookSpecificOutput: {
      hookEventName: 'sessionStart',
      additionalContext: context,
    },
  };
}

function shellOutput(result) {
  const output = { permission: result.decision };
  if (result.decision === 'deny') {
    output.user_message = result.reason;
    output.agent_message = result.reason;
  }
  return output;
}

function editOutput(report) {
  return report === null ? {} : { agent_message: report };
}

function run(mode, raw, cwd) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024 * 1024) {
    throw new HookInputError('Hook 输入为空或超过 1 MiB 限制');
  }
  const input = JSON.parse(raw);
  const event = normalizeCursorEvent(input);
  const expected = { session: 'sessionStart', shell: 'beforeShellExecution', edit: 'afterFileEdit' }[mode];
  if (event.hookEventName !== expected) {
    throw new HookInputError(`hook_event_name 必须为 ${expected}`);
  }
  const startDir = event.cwd
    || (Array.isArray(event.workspaceRoots) && typeof event.workspaceRoots[0] === 'string' ? event.workspaceRoots[0] : null)
    || cwd;
  const root = findProjectRoot(startDir);
  if (mode === 'session') {
    // CLI/项目不可用时静默降级为空对象，不注入伪状态。
    if (!root) return { output: {}, exitCode: 0 };
    return { output: sessionOutput(sessionContext(root)), exitCode: 0 };
  }
  if (!root) throw new HookInputError('未找到 logos/logos.config.json');
  if (mode === 'shell') {
    const result = decideShell(root, event.command);
    return { output: shellOutput(result), exitCode: result.decision === 'deny' ? 2 : 0 };
  }
  const report = decideEdit(root, event.filePath);
  return { output: editOutput(report), exitCode: 0 };
}

function shellFailure(reason) {
  const message = `OpenLogos Cursor Hook fail-closed：${reason}`;
  return { output: shellOutput({ decision: 'deny', reason: message }), exitCode: 2 };
}

function editFailure(reason) {
  const report = [
    '⚠ OpenLogos guard: 无法安全判断本次编辑（fail-closed 报告），请人工核查。',
    `原因：${reason}`,
    EDIT_NOT_BLOCKED_LINE,
  ].join('\n');
  return { output: editOutput(report), exitCode: 0 };
}

async function main() {
  const mode = process.argv[2];
  if (mode !== 'session' && mode !== 'shell' && mode !== 'edit') {
    const failure = shellFailure('入口参数必须是 session、shell 或 edit');
    process.stdout.write(JSON.stringify(failure.output) + '\n');
    process.exitCode = failure.exitCode;
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
    process.stderr.write(`OpenLogos Cursor Hook: ${message}\n`);
    const failure = mode === 'edit'
      ? editFailure(message)
      : mode === 'session'
        ? { output: {}, exitCode: 0 }
        : shellFailure(message);
    process.stdout.write(JSON.stringify(failure.output) + '\n');
    process.exitCode = failure.exitCode;
  }
}

module.exports = {
  main,
  HookInputError,
  GUARD_STRENGTH_LINE,
  EDIT_NOT_BLOCKED_LINE,
  decideEdit,
  decidePathScope,
  decideShell,
  deriveProposalStep,
  editOutput,
  findProjectRoot,
  normalizeCursorEvent,
  readSessionState,
  resolveCandidate,
  run,
  sessionContext,
  shellOutput,
};

if (require.main === module) void main();
