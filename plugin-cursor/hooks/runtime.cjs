#!/usr/bin/env node
'use strict';

// OpenLogos Cursor Hook Runtime — 部分强度门禁接线（capability honesty：OpenLogos 未接入 Cursor preToolUse，
// IDE 与 cursor-agent CLI 的文件编辑均只有 afterFileEdit 事后报告；spec/pretooluse-guard.md「Cursor hooks 部分强度
// 门禁适配合同」、spec/cursor-plugin.md §7/§8）。
// 模式：
//   session     — sessionStart：阶段上下文注入（输出不构成授权），并经事后检查引擎接管未关闭执行记录、注入待报告项
//   shell       — beforeShellExecution：保护范围变更受限命令 permission ask；git 判据生效时事前轻判（可确定的
//                 受保护目标 deny，其余 allow 并调用引擎 snapshot）；非 git 回落沿用既有 shell 判定
//   shell-after — afterShellExecution：调用引擎 check 对比执行前后的受保护内容（事后报告，observe-only）
//   edit        — afterFileEdit：越界编辑事后检测报告（不能阻断，如实声明）
// 事后检查引擎与 Claude Code 共用同一份字节：部署副本 .cursor/hooks/openlogos-guard-post.cjs（源 plugin/bin/guard-post-check.cjs）。
// fail-closed：shell 路径任何异常一律 deny；shell-after / edit 路径任何异常一律产出「无法安全判断」报告。

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

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

// 与 guard-check 的 WHITELIST_PREFIXES 对齐（guard 缺失时也允许写入的路径前缀；已去掉 .gitignore——
// 忽略规则来源属不可豁免项，两种模式下都受保护）。
// 注意：logos/changes/ 不入通用白名单——提案目录写入必须先过 proposal_step 收敛判定。
const PATH_WHITELIST_PREFIXES = [
  'logos/.openlogos-guard', 'logos/logos-project.yaml',
  '.claude/', '.opencode/', '.codex-plugin/', '.cursor/',
  'logos/skills/', 'logos/spec/', 'README', 'CLAUDE.md', 'AGENTS.md',
  'opencode.json', '.openlogos',
];

const RUNTIME_REL = 'logos/.openlogos-runtime';
const CONFIG_REL = 'logos/logos.config.json';
const BUILTIN_EXEMPT = ['logos/resources/reference/', 'logos/resources/verify/baseline-seed-runs/*/staging/'];
/** 事后检查引擎的 Cursor 部署副本（与 plugin/bin/guard-post-check.cjs 字节一致）。 */
const ENGINE_REL = '.cursor/hooks/openlogos-guard-post.cjs';
const ENGINE_FILE = 'openlogos-guard-post.cjs';

/**
 * 受限命令的宿主审批实测结论（spec/cursor-plugin.md §8）：实测能保证弹出审批 → 'ask'；不支持 ask 或实测不能保证
 * 弹出 → 'deny'。当前取值为规范写明的默认 'ask'，真实宿主逐模式实测（SMOKE-core-222）后按结论更新本常量。
 * 环境变量 OPENLOGOS_CURSOR_ASK_POLICY=deny 可把实测结论「不能保证弹出」注入为 deny（只能收紧，不能放宽）。
 */
const CURSOR_ASK_POLICY = 'ask';

/**
 * 单次 shell 调用的可靠关联标识字段（camel / snake）。宿主提供其一时以它关联 before / after 的执行记录。
 * 字段名以真实宿主实测为准（记入 spec/cursor-plugin.md 与 smoke 报告）。
 */
const CALL_ID_FIELDS = [['toolUseId', 'tool_use_id'], ['toolCallId', 'tool_call_id']];
/**
 * generation_id + 命令文本 SHA-256 作为关联键的前提是实测证明同一 generation 内不会并发执行字面相同的命令；
 * 实测证明之前为 false：只有 generation_id 时按匿名记录处理，不按「最近一次」猜测关联。
 */
const GENERATION_KEY_VERIFIED = false;

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
  let callId;
  for (const [camel, snake] of CALL_ID_FIELDS) {
    const value = alias(input, camel, snake);
    if (value !== undefined && callId === undefined) callId = value;
  }
  const event = {
    hookEventName: alias(input, 'hookEventName', 'hook_event_name'),
    conversationId: alias(input, 'conversationId', 'conversation_id'),
    generationId: alias(input, 'generationId', 'generation_id'),
    callId,
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
  for (const [name, value] of [['generation_id', event.generationId], ['调用标识', event.callId]]) {
    if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') {
      throw new HookInputError(`${name} 必须是字符串`);
    }
  }
  return event;
}

/**
 * 执行记录关联键（spec/cursor-plugin.md §8「快照关联」）：可靠的单次调用标识优先；仅有 generation_id 时，
 * 只在实测证明可用（GENERATION_KEY_VERIFIED）后以 generation_id + 命令文本 SHA-256 关联；否则返回 null（匿名记录）。
 */
function callKey(event) {
  if (event.callId !== undefined && event.callId !== null && String(event.callId) !== '') {
    return `cursor-${event.callId}`;
  }
  if (GENERATION_KEY_VERIFIED && event.generationId && typeof event.command === 'string') {
    const digest = crypto.createHash('sha256').update(event.command).digest('hex').slice(0, 16);
    return `cursor-gen-${event.generationId}-${digest}`;
  }
  return null;
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
  'guard 强度：Cursor（IDE 与 cursor-agent CLI）下写入门禁为部分强度——shell 命令经 beforeShellExecution 事前轻判（保护范围变更命令需宿主审批）并经 afterShellExecution 事后检查；文件编辑经 afterFileEdit 事后报告，不被事前阻断。OpenLogos 未接入 preToolUse，与 claude-code 不等价';

function sessionContext(root, sessionId) {
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
  const lines = [
    `OpenLogos lifecycle: ${state.lifecycle}`,
    `active change: ${state.slug || 'none'}`,
    `proposal_step: ${state.proposalStep || 'none'}`,
    `允许范围：${scope}`,
    GUARD_STRENGTH_LINE,
    '禁止动作：未经明确授权不得 merge、verify、deploy、smoke、archive 或 git push',
    `下一确认点：${nextGate}`,
  ];
  const pending = pendingEditReportNotice(root);
  if (pending) lines.push(pending);
  // 事后检查引擎接管未关闭执行记录（清理墓碑、对比），并把待报告项并入注入上下文；不关闭记录
  const guardMode = detectGuardMode(root);
  if (guardMode.git) {
    const result = runEngine(guardMode, ['check', '--session-start'], { hook_event_name: 'SessionStart', session_id: sessionId || null });
    if (result.status === 0 && result.stdout.trim()) lines.push(result.stdout.trim());
  }
  return lines.join('\n');
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

function allowedScopeText(state) {
  return state.slug
    ? `logos/changes/${state.slug}/deltas/** and tasks.md (per proposal step)`
    : 'none (no active change proposal)';
}

function denyFacts(state, target) {
  return [
    'OpenLogos guard denied this shell write.',
    `Active change: ${state.slug || 'none'}`,
    `Proposal step: ${state.proposalStep || 'none'}`,
    `Allowed scope: ${allowedScopeText(state)}`,
    `Target: ${target}`,
    state.slug
      ? 'Next action: finish the current step deliverables, then follow the next confirmation gate.'
      : 'Next action: run `openlogos change <slug>` to open a change proposal first.',
  ].join('\n');
}

/** 判定文件路径写入是否在当前阶段范围内（shell 重定向目标与原生编辑共用）。 */
function decidePathScope(root, state, relative) {
  // 受保护判定第 2 步：guard 自有状态在任何 lifecycle 与提案状态下都不可写
  if (relative === RUNTIME_REL || relative.startsWith(`${RUNTIME_REL}/`)) {
    return { decision: 'deny', reason: `${RUNTIME_REL}/ 是 guard 自有状态（不可豁免），任何状态下都不允许写入` };
  }
  if (!state.slug) {
    // 无活跃提案（非 git 回落口径）：不可豁免项（第 3、4 步）先于白名单与 guard.exempt
    const hard = nonExemptableVerdict(relative);
    if (hard) return { decision: 'deny', reason: `${hard.reason}（不可豁免）；请先运行 openlogos change <slug>` };
  }
  if (!relative.startsWith('logos/changes/') && isWhitelistedPath(relative)) {
    return { decision: 'allow', reason: '白名单路径' };
  }
  if (!state.slug) {
    if (isDefaultExemptPath(root, relative)) return { decision: 'allow', reason: 'guard.exempt 豁免路径' };
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

// ── Windows shell 输入（win32 下 beforeShellExecution，宿主 shell 为 PowerShell）──────────────
// 规范：spec/pretooluse-guard.md §PowerShell / cmd 写入检测模式、§Windows shell 输入的判定顺序。
// 与 plugin/bin/guard-check 的 PowerShell 分支同判：先识别写入信号，有则安全白名单不适用；
// 非 win32 平台维持既有「安全白名单先判」顺序，逐条不变。
const WS_WRITE_WORD = /^(set-content|add-content|out-file|new-item|remove-item|copy-item|move-item|rename-item|sc|ac|ni|ri|rm|del|erase|rd|rmdir|cp|copy|mv|move|ren)$/i;
const WS_CONTENT_WRITER = /^(set-content|add-content|out-file|sc|ac)$/i;
const WS_DOTNET_WRITE = /\[(system\.)?io\.file\]::write/i;
const WS_PATH_FLAG = /^-(path|filepath|literalpath|destination|newname)$/i;
const WS_VALUE_FLAG = /^-(itemtype|value|encoding|inputobject|type|name)$/i;
const WS_POSIX_PATH_CMD = /^(rm|cp|mv|mkdir|touch|chmod|chown)$/i;
// 逗号为 PowerShell 数组分隔：未实现有界数组解析前按不可解析拒绝，避免白名单首目标掩盖后续受保护目标
const WS_UNPARSEABLE = /[$()`*?@{,]/;

function wsSegmentIsWrite(segment) {
  const word = segment.split(/\s+/)[0] || '';
  return WS_WRITE_WORD.test(word) || WS_DOTNET_WRITE.test(segment)
    || SHELL_WRITE_PATTERNS.some(pattern => pattern.test(segment));
}

/** 写入段的目标路径；无法结构化提取返回 null。 */
function wsSegmentTargets(segment) {
  if (WS_DOTNET_WRITE.test(segment)) return null;
  const tokens = segment.split(/\s+/).filter(Boolean);
  const word = tokens[0] || '';
  const targets = [];
  if (WS_WRITE_WORD.test(word)) {
    let nextIsPath = false;
    let nextIsValue = false;
    let positional = null;
    for (const token of tokens.slice(1)) {
      if (nextIsPath) { targets.push(token); nextIsPath = false; continue; }
      if (nextIsValue) { nextIsValue = false; continue; }
      if (WS_PATH_FLAG.test(token)) { nextIsPath = true; continue; }
      if (WS_VALUE_FLAG.test(token)) { nextIsValue = true; continue; }
      if (token.startsWith('-')) continue;
      if (WS_CONTENT_WRITER.test(word)) { if (positional === null) positional = token; } else targets.push(token);
    }
    if (WS_CONTENT_WRITER.test(word) && targets.length === 0) {
      if (positional === null) return null;
      targets.push(positional);
    }
    return targets;
  }
  if (WS_POSIX_PATH_CMD.test(word)) return tokens.slice(1).filter(token => !token.startsWith('-'));
  return null;
}

/**
 * 不可豁免项（受保护判定第 2–4 步的非 git 回落口径：不调用 git，git 元数据按字面 .git 路径段识别）。
 * 命中返回 { step, reason }，否则 null。git 判据生效时改由事后检查引擎 protectVerdict 判定。
 */
function nonExemptableVerdict(relative) {
  if (relative === RUNTIME_REL || relative.startsWith(`${RUNTIME_REL}/`)) {
    return { step: 2, reason: `guard 自有状态（${RUNTIME_REL}/）` };
  }
  const segments = relative.split('/');
  if (segments[segments.length - 1] === '.gitignore') return { step: 3, reason: '忽略规则来源（.gitignore）' };
  if (relative === CONFIG_REL) return { step: 3, reason: `保护范围来源（${CONFIG_REL}）` };
  if (relative === '.git/info/exclude' || relative.endsWith('/.git/info/exclude')) {
    return { step: 3, reason: '忽略规则来源（info/exclude）' };
  }
  if (segments.includes('.git')) return { step: 4, reason: 'git 元数据' };
  return null;
}

/** guard.exempt 条目合法性（与 guard-check / 引擎 exemptInvalidReason 同口径）：合法返回 true。 */
function exemptEntryValid(entry) {
  if (entry === '' || entry === '/' || entry === '*' || entry.includes('\\')) return false;
  if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return false;
  const body = entry.endsWith('/') ? entry.slice(0, -1) : entry;
  if (!body || body === '*' || `/${body}/`.includes('//')) return false;
  const segments = body.split('/');
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..' || segment === '.gitignore') return false;
    if (segment !== '*' && segment.includes('*')) return false;
  }
  if (segments[0] === '.git') return false;
  if (body === RUNTIME_REL || body.startsWith(`${RUNTIME_REL}/`) || body === CONFIG_REL) return false;
  return true;
}

/** 读取 guard.exempt：缺省 → 内置默认；显式数组按原样（非法条目跳过并警告）；配置损坏 → []（不回落内置默认）。 */
function loadExemptEntries(root) {
  const warn = message => process.stderr.write(`OpenLogos Cursor Hook: ${message}\n`);
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(root, ...CONFIG_REL.split('/')), 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return BUILTIN_EXEMPT.slice();
    warn(`${CONFIG_REL} 配置异常（无法解析），guard.exempt 视为 []`);
    return [];
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  if (!Object.prototype.hasOwnProperty.call(config, 'guard')) return BUILTIN_EXEMPT.slice();
  const guard = config.guard;
  if (!guard || typeof guard !== 'object' || Array.isArray(guard)) {
    warn(`${CONFIG_REL} 配置异常（guard 类型不符），guard.exempt 视为 []`);
    return [];
  }
  if (!Object.prototype.hasOwnProperty.call(guard, 'exempt')) return BUILTIN_EXEMPT.slice();
  if (!Array.isArray(guard.exempt)) {
    warn(`${CONFIG_REL} 配置异常（guard.exempt 类型不符），guard.exempt 视为 []`);
    return [];
  }
  const entries = [];
  for (const entry of guard.exempt) {
    if (typeof entry === 'string' && !/[\n\r\t\0]/.test(entry) && exemptEntryValid(entry)) entries.push(entry);
    else warn(`guard.exempt 非法条目已跳过：${JSON.stringify(entry)}`);
  }
  return entries;
}

/** 完整段匹配；以 / 结尾匹配目录本身及后代；* 恰好匹配一个满足标识符约束的路径段。 */
function exemptMatches(entry, relative) {
  const isDir = entry.endsWith('/');
  const es = (isDir ? entry.slice(0, -1) : entry).split('/');
  const rs = relative.split('/');
  if (isDir ? rs.length < es.length : rs.length !== es.length) return false;
  for (let i = 0; i < es.length; i += 1) {
    if (es[i] === '*') {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rs[i]) || rs[i].includes('..')) return false;
    } else if (es[i] !== rs[i]) return false;
  }
  return true;
}

/** 与 guard-check is_default_exempt_path 同一规则：命中 guard.exempt（缺省为内置默认 reference 与基线 staging）。 */
function isDefaultExemptPath(root, relative) {
  const segments = relative.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) return false;
  let walk = root;
  for (const segment of segments) {
    walk = path.join(walk, segment);
    try { if (fs.lstatSync(walk).isSymbolicLink()) return false; } catch { break; }
  }
  return loadExemptEntries(root).some(entry => exemptMatches(entry, relative));
}

function decideWindowsShell(root, trimmed) {
  const stripped = trimmed.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  const merged = stripped.replace(/[0-9*]?>&[0-9]/g, '');
  const redirectTargets = [];
  for (const match of merged.matchAll(/[0-9*]?>>?\s*([^\s;|&<>]*)/g)) {
    if (/^(\$null|nul)$/i.test(match[1])) continue;
    redirectTargets.push(match[1]);
  }
  const segments = merged.split(/&&|\|\||;|\||&/)
    .map(segment => segment.trim().split('>')[0].trim())
    .filter(Boolean);
  const writeSegments = segments.filter(wsSegmentIsWrite);
  const signal = redirectTargets.length > 0 || (segments.length > 1 && writeSegments.length > 0);
  if (!signal) {
    if (SHELL_SAFE_PATTERNS.some(pattern => pattern.test(trimmed))) {
      return { decision: 'allow', reason: '安全白名单命令' };
    }
    if (writeSegments.length === 0) return { decision: 'allow', reason: '未命中写入模式，按既有 guard 语义放行' };
  }
  if (!isLaunched(root)) return { decision: 'allow', reason: 'initial 生命周期不启用变更硬门禁' };
  const state = readSessionState(root);
  const targets = [...redirectTargets];
  for (const segment of writeSegments) {
    const extracted = wsSegmentTargets(segment);
    if (extracted === null || extracted.length === 0) {
      return { decision: 'deny', reason: denyFacts(state, trimmed.slice(0, 120)) };
    }
    targets.push(...extracted);
  }
  if (targets.length === 0) return { decision: 'deny', reason: denyFacts(state, trimmed.slice(0, 120)) };
  for (const raw of targets) {
    const target = raw.replace(/^["']|["']$/g, '');
    if (target === '' || WS_UNPARSEABLE.test(target)) {
      return { decision: 'deny', reason: denyFacts(state, raw || trimmed.slice(0, 120)) };
    }
    let relative;
    try {
      relative = resolveCandidate(root, target.replace(/\\/g, '/'));
    } catch {
      return { decision: 'deny', reason: denyFacts(state, target) };
    }
    if (!nonExemptableVerdict(relative) && isDefaultExemptPath(root, relative)) continue;
    const scoped = decidePathScope(root, state, relative);
    if (scoped.decision !== 'allow') return { decision: 'deny', reason: denyFacts(state, relative) };
  }
  return { decision: 'allow', reason: '写入目标均在允许范围内' };
}

/** 非 git 回落（及有活跃提案时）的既有 shell 判定：安全白名单先判、写入模式、路径判定、解析不出即阻断。 */
function decideShellLegacy(root, trimmed, platform) {
  if (platform === 'win32') return decideWindowsShell(root, trimmed);
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

// ── 保护范围变更受限命令（spec/pretooluse-guard.md「保护范围变更的宿主原生审批（C14）」）──────────────
// openlogos exempt add|remove、openlogos ignore add|remove（list 不受限）：任何 lifecycle、任何提案状态、两种模式下
// 都先于其他判定识别。独立形态（只允许 `cd <目录> &&` 前缀段）→ permission ask（实测不能保证弹出审批时 deny）；
// 复合形态一律 deny。与 plugin/bin/guard-check classify_scope_command 同一引号感知切分。

/** 返回 'none' | 'standalone' | 'compound'。 */
function classifyScopeCommand(cmd) {
  const segs = [[]];
  const seps = [];
  let forbidden = false;
  let word = null;
  const stack = ['n'];
  const top = () => stack[stack.length - 1];
  const flush = () => { if (word !== null) { segs[segs.length - 1].push(word); word = null; } };
  const brk = (sep) => { flush(); seps.push(sep); segs.push([]); };
  for (let i = 0; i < cmd.length; i += 1) {
    const c = cmd[i];
    const d = cmd[i + 1];
    const m = top();
    if (m === 's') { if (c === "'") stack.pop(); else word += c; continue; }
    if (m === 'd') {
      if (c === '"') { stack.pop(); continue; }
      if (c === '\\' && i + 1 < cmd.length) { word += d; i += 1; continue; }
      if (c === '$' && d === '(') { forbidden = true; stack.push('p'); brk('$('); i += 1; continue; }
      if (c === '`') { forbidden = true; stack.push('b'); brk('`'); continue; }
      word += c;
      continue;
    }
    // 代码上下文：n（顶层）/ p（$( 或 ( 内）/ b（反引号内）
    if (c === "'") { if (word === null) word = ''; stack.push('s'); continue; }
    if (c === '"') { if (word === null) word = ''; stack.push('d'); continue; }
    if (c === '\\' && i + 1 < cmd.length) {
      if (d === '\n') { i += 1; continue; }
      word = (word ?? '') + d;
      i += 1;
      continue;
    }
    if (c === ' ' || c === '\t') { flush(); continue; }
    if (c === '\n') { forbidden = true; brk('\n'); continue; }
    if (c === '&' && d === '&') { brk('&&'); i += 1; continue; }
    if (c === '|' && d === '|') { brk('||'); i += 1; continue; }
    if (c === ';') { brk(';'); continue; }
    if (c === '$' && d === '(') { forbidden = true; stack.push('p'); brk('$('); i += 1; continue; }
    if (c === '`') { forbidden = true; if (m === 'b') stack.pop(); else stack.push('b'); brk('`'); continue; }
    if (c === '(') { forbidden = true; stack.push('p'); brk('('); continue; }
    if (c === ')') { forbidden = true; if (m === 'p') stack.pop(); brk(')'); continue; }
    if (c === '|' || c === '&' || c === '<' || c === '>') { forbidden = true; brk(c); continue; }
    word = (word ?? '') + c;
  }
  flush();
  const isRestricted = (ws) => {
    for (let i = 0; i < ws.length; i += 1) {
      const w = ws[i];
      if (w !== 'openlogos' && !/[\\/]openlogos(\.(c?js|cmd|exe|ps1))?$/i.test(w)) continue;
      const rest = ws.slice(i + 1).filter(x => !x.startsWith('-'));
      if ((rest[0] === 'exempt' || rest[0] === 'ignore') && (rest[1] === 'add' || rest[1] === 'remove')) return true;
    }
    return false;
  };
  const nonEmpty = segs.filter(ws => ws.length > 0);
  const hits = nonEmpty.filter(isRestricted);
  if (hits.length === 0) return 'none';
  const last = nonEmpty[nonEmpty.length - 1];
  const standalone = !forbidden && hits.length === 1 && hits[0] === last && last[0] === 'openlogos'
    && seps.every(sep => sep === '&&') && segs.every(ws => ws.length > 0)
    && nonEmpty.slice(0, -1).every(ws => ws[0] === 'cd' && ws.length <= 2);
  return standalone ? 'standalone' : 'compound';
}

/** 受限命令的审批结论取值：实测结论注入只能收紧为 deny。 */
function cursorAskPolicy(override) {
  if (override === 'deny' || process.env.OPENLOGOS_CURSOR_ASK_POLICY === 'deny') return 'deny';
  return CURSOR_ASK_POLICY;
}

/** 受限命令判定；不是受限命令返回 null。 */
function scopeChangeVerdict(trimmed, askPolicy) {
  if (!trimmed.includes('openlogos')) return null;
  const kind = classifyScopeCommand(trimmed);
  if (kind === 'none') return null;
  if (kind === 'compound') {
    return {
      decision: 'deny',
      reason: `⛔ 保护范围变更命令必须单独执行：一次调用只能包含一条 openlogos exempt / ignore 的 add / remove，只允许 \`cd <目录> &&\` 前缀，不能与其他命令组合。\n\n命令：${trimmed}\n\n请拆成单独的调用后重试。`,
    };
  }
  if (cursorAskPolicy(askPolicy) === 'deny') {
    return {
      decision: 'deny',
      reason: `⛔ 保护范围变更需要用户在宿主界面批准：该命令会修改 guard 的保护范围（exempt / ignore 清单与 .gitignore 托管区块）。\n\n命令：${trimmed}\n\n经真实宿主实测，当前 Cursor 运行模式不能保证对这一次调用弹出审批，无法证明由用户批准。请让用户在终端自行执行该命令；不要用对话中的口头同意替代。`,
    };
  }
  return {
    decision: 'ask',
    userMessage: `该命令会改变 OpenLogos guard 的保护范围（exempt / ignore 清单与 .gitignore 托管区块），需要您确认后执行：${trimmed}`,
    agentMessage: `该命令修改 guard 保护范围，需用户在宿主审批中确认（${trimmed}）；不要用对话中的口头同意替代。`,
  };
}

// ── 事后检查引擎接线（spec/pretooluse-guard.md「Bash / PowerShell 判定顺序（事前轻判 + 事后检查）」）──────
const ENGINE_MISSING = '事后检查引擎缺失';

/** 引擎位置：runtime 同目录部署副本 → 项目内部署路径 → 源码布局（plugin-cursor/hooks → plugin/bin）。 */
function findEnginePath(root) {
  const candidates = [path.join(__dirname, ENGINE_FILE), path.join(root, ...ENGINE_REL.split('/'))];
  if (path.basename(path.dirname(__dirname)) === 'plugin-cursor') {
    candidates.push(path.resolve(__dirname, '..', '..', 'plugin', 'bin', 'guard-post-check.cjs'));
  }
  return candidates.find(candidate => {
    try { return fs.statSync(candidate).isFile(); } catch { return false; }
  }) || null;
}

function insideGitWorkTree(root) {
  const result = cp.spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', timeout: 20000 });
  return !result.error && result.status === 0 && result.stdout.trim() === 'true';
}

/**
 * git 判据（launched 由调用方判断）：项目根在 git 工作树内、git 可执行、事后检查引擎存在且可加载。
 * 生效返回 { git: true, root, enginePath, engine, gctx }；否则 { git: false, why }。
 */
function detectGuardMode(root) {
  if (!insideGitWorkTree(root)) return { git: false, why: '项目根不在 git 工作树内或 git 不可执行' };
  const enginePath = findEnginePath(root);
  if (!enginePath) return { git: false, why: ENGINE_MISSING };
  let engine;
  try {
    engine = require(enginePath);
  } catch {
    return { git: false, why: ENGINE_MISSING };
  }
  if (!engine || typeof engine.protectVerdict !== 'function') return { git: false, why: ENGINE_MISSING };
  const gctx = engine.gitContext(root);
  if (!gctx) return { git: false, why: '项目根不在 git 工作树内或 git 不可执行' };
  return { git: true, root, enginePath, engine, gctx };
}

/** 以 Claude 形态的 hook 输入调用引擎子命令（--host cursor：恢复命令使用 Cursor 引擎路径）。 */
function runEngine(guardMode, args, input) {
  const result = cp.spawnSync(process.execPath, [guardMode.enginePath, ...args, '--host', 'cursor'], {
    cwd: guardMode.root,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: guardMode.root, OPENLOGOS_GUARD_HOST: 'cursor' },
    timeout: 120000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.error ? null : result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

/** Cursor 事件 → 引擎输入（tool_use_id 只在有可靠关联键时给出；缺失时引擎建立匿名记录）。 */
function engineShellInput(hookEventName, command, platform, event = {}) {
  const input = {
    hook_event_name: hookEventName,
    tool_name: platform === 'win32' ? 'PowerShell' : 'Bash',
    tool_input: { command },
    session_id: event.conversationId || null,
  };
  const key = event.key !== undefined ? event.key : callKey({ ...event, command });
  if (key) input.tool_use_id = key;
  return input;
}

function hasOpenRecords(root) {
  try {
    return fs.readdirSync(path.join(root, ...RUNTIME_REL.split('/'), 'guard-records'))
      .some(name => name.endsWith('.json') && !name.includes('.tmp-'));
  } catch {
    return false;
  }
}

/** 受保护判定（is_protected）：git 判据生效时由引擎 protectVerdict 判定（与 Claude 共用同一实现与测试向量）。 */
function protectedVerdictFor(guardMode, rawPath) {
  const relative = guardMode.engine.relOfRoot(guardMode.root, rawPath.replace(/\\/g, '/'));
  const verdict = guardMode.engine.protectVerdict(guardMode.engine.makeProtectCtx(guardMode.gctx), relative);
  return { ...verdict, relative };
}

/**
 * 受保护判定的对外入口（共享测试向量 UT-S09-404 驱动）：git 判据生效时为引擎十步判定；
 * 非 git 回落时为不可豁免项 → 白名单 → guard.exempt → 其余受保护（step 'fallback'）。
 */
function isProtectedPath(root, rawPath) {
  const guardMode = detectGuardMode(root);
  if (guardMode.git) return { mode: 'git', ...protectedVerdictFor(guardMode, rawPath) };
  const relative = resolveCandidate(root, rawPath.replace(/\\/g, '/'));
  const hard = nonExemptableVerdict(relative);
  if (hard) return { mode: 'fallback', protected: true, step: hard.step, reason: hard.reason, relative };
  if (isWhitelistedPath(relative)) return { mode: 'fallback', protected: false, step: 5, reason: '白名单', relative };
  if (isDefaultExemptPath(root, relative)) return { mode: 'fallback', protected: false, step: 6, reason: 'guard.exempt', relative };
  return { mode: 'fallback', protected: true, step: 'fallback', reason: '非 git 回落：不在白名单与 guard.exempt 内', relative };
}

const IGNORE_HINT_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'coverage', '.next', '.nuxt',
  'vendor', '.venv', 'venv', '__pycache__', '.cache', 'tmp']);

function gitDenyFacts(state, verdict, command) {
  const lines = [
    denyFacts(state, verdict.relative),
    `Reason: 命中原因：${verdict.reason}`,
    `Command: ${command.slice(0, 200)}`,
  ];
  if (String(verdict.step) === '10' && IGNORE_HINT_DIRS.has(verdict.relative.split('/')[0])) {
    lines.push('如该目录不应入库，可执行 `openlogos ignore add <pattern>`；该命令会改变保护范围，须经宿主原生审批由用户批准。');
  }
  return lines.join('\n');
}

/** win32（PowerShell）可确定写入目标：重定向与写入段的结构化目标；变量 / 子表达式 / 通配 / 数组目标交给事后检查。 */
function windowsDeterminableTargets(trimmed) {
  const stripped = trimmed.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  const merged = stripped.replace(/[0-9*]?>&[0-9]/g, '');
  const raw = [];
  for (const match of merged.matchAll(/[0-9*]?>>?\s*([^\s;|&<>]*)/g)) {
    if (!/^(\$null|nul)$/i.test(match[1])) raw.push(match[1]);
  }
  const segments = merged.split(/&&|\|\||;|\||&/).map(segment => segment.trim().split('>')[0].trim()).filter(Boolean);
  for (const segment of segments.filter(wsSegmentIsWrite)) {
    const extracted = wsSegmentTargets(segment);
    if (extracted) raw.push(...extracted);
  }
  return raw.map(target => target.replace(/^["']|["']$/g, '')).filter(target => target !== '' && !WS_UNPARSEABLE.test(target));
}

/**
 * git 判据生效、launched、无活跃提案时的事前轻判：独立 git / openlogos 调用放行（有未关闭记录时 snapshot --rebase-only）；
 * 独立形态的引擎 restore 调用放行且不拍快照；可确定写入目标受保护 → deny；只读命令放行不拍快照；其余放行并拍快照。
 * 快照失败（整体状态采集失败）返回 null，由调用方按非 git 回落判定。
 */
function decideShellGit(root, trimmed, platform, guardMode, state, event) {
  const engine = guardMode.engine;
  const input = engineShellInput('PreToolUse', trimmed, platform, event);
  const recheck = () => { if (hasOpenRecords(root)) runEngine(guardMode, ['check', '--pre-tool-use'], input); };
  if (engine.independentCall(trimmed).independent) {
    if (hasOpenRecords(root) && runEngine(guardMode, ['snapshot', '--rebase-only'], input).status !== 0) return null;
    return { decision: 'allow', reason: '独立 git / openlogos 调用' };
  }
  if (engine.restoreCall(trimmed, root, 'cursor')) {
    recheck();
    return { decision: 'allow', reason: '独立形态的引擎 restore 调用' };
  }
  const targets = platform === 'win32'
    ? windowsDeterminableTargets(trimmed)
    : engine.writeTargets(trimmed, root).map(target => target.path);
  for (const target of targets) {
    const verdict = protectedVerdictFor(guardMode, target);
    if (verdict.protected) return { decision: 'deny', reason: gitDenyFacts(state, verdict, trimmed) };
  }
  if (platform !== 'win32' && engine.readOnlyCall(trimmed)) {
    recheck();
    return { decision: 'allow', reason: '只读命令（不拍快照）' };
  }
  if (runEngine(guardMode, ['snapshot'], input).status !== 0) return null;
  return { decision: 'allow', reason: '事前轻判放行，已为事后检查拍快照' };
}

/** guard 自有状态的可确定写入目标（任何 lifecycle 与提案状态都 deny）；命中返回目标路径。 */
function runtimeShellHit(root, trimmed, platform, guardMode) {
  if (!trimmed.includes('logos')) return null;
  if (platform !== 'win32' && guardMode.engine) {
    const hits = guardMode.engine.runtimeHits(root, guardMode.engine.writeTargets(trimmed, root));
    return hits.length ? hits[0] : null;
  }
  // PowerShell 或引擎不可用：按文本保守识别（只会多拦）
  if (trimmed.includes('.openlogos-runtime')
    && /(^|[;&|(`\s])(rm|mv|cp|touch|mkdir|chmod|chown|tee|sed|remove-item|set-content|add-content|out-file|new-item|copy-item|move-item|ri|del|erase|sc|ac|ni)(\s|$)|>/i.test(trimmed)) {
    return `${RUNTIME_REL}/`;
  }
  return null;
}

/**
 * beforeShellExecution 判定（spec/pretooluse-guard.md「Bash / PowerShell 判定顺序」与 Cursor 合同）：
 * ① 保护范围变更受限命令（ask / deny）；② guard 自有状态可确定目标 deny；③ initial 放行；
 * ④ 有活跃提案：沿用既有提案期判定，放行时照常拍快照；⑤ git 判据生效：事前轻判 + 快照；
 * ⑥ 非 git 回落（或快照失败）：既有 shell 判定，引擎缺失时 deny 附带 `openlogos sync` 提示。
 * opts.event：Cursor 事件（关联键来源）；opts.askPolicy：注入受限命令审批实测结论（只能收紧为 deny）。
 */
function decideShell(root, command, platform = process.platform, opts = {}) {
  if (typeof command !== 'string' || command.trim() === '') {
    throw new HookInputError('beforeShellExecution 缺少 command');
  }
  const trimmed = command.trim();
  const scope = scopeChangeVerdict(trimmed, opts.askPolicy);
  if (scope) return scope;
  const launched = isLaunched(root);
  const guardMode = launched || trimmed.includes('.openlogos-runtime') ? detectGuardMode(root) : { git: false, why: 'initial' };
  const runtimeHit = runtimeShellHit(root, trimmed, platform, guardMode);
  if (runtimeHit) {
    const state = readSessionState(root);
    return {
      decision: 'deny',
      reason: `${denyFacts(state, runtimeHit)}\nReason: ${RUNTIME_REL}/ 是 guard 自有状态（执行记录与待报告项），任何状态下都不允许经 shell 直接写入。`,
    };
  }
  if (!launched) return decideShellLegacy(root, trimmed, platform);
  const state = readSessionState(root);
  if (state.slug) {
    const legacy = decideShellLegacy(root, trimmed, platform);
    if (legacy.decision === 'allow' && guardMode.git && (platform === 'win32' || !guardMode.engine.readOnlyCall(trimmed))) {
      runEngine(guardMode, ['snapshot'], engineShellInput('PreToolUse', trimmed, platform, opts.event));
    }
    return legacy;
  }
  if (guardMode.git) {
    const verdict = decideShellGit(root, trimmed, platform, guardMode, state, opts.event);
    if (verdict) return verdict;
  }
  const legacy = decideShellLegacy(root, trimmed, platform);
  if (legacy.decision === 'deny' && guardMode.why === ENGINE_MISSING) {
    legacy.reason += `\n（当前为非 git 回落：${ENGINE_MISSING}；运行 \`openlogos sync\` 补齐事后检查引擎）`;
  }
  return legacy;
}

const EDIT_NOT_BLOCKED_LINE =
  'This edit was NOT blocked. 本次编辑未被阻断（Cursor 文件编辑仅经 afterFileEdit 事后报告，IDE 与 CLI 均无事前阻断；OpenLogos 未接入 Cursor preToolUse），请核查并按需回退。';
const SHELL_NOT_BLOCKED_LINE = '本次 shell 命令已执行，以下改动未被阻断，请核查并按需回滚或先立案。';
const EDIT_REPORT_REL_FILE = '.cursor/openlogos-guard-reports.log';

/**
 * afterFileEdit / afterShellExecution 按 observe-only 声明（输出能否注入 agent 以真实宿主实测为准），
 * 报告的可达通道 = 追加落盘审计日志 + 下一次 sessionStart 注入未处理报告提示。
 */
function appendEditReport(root, report) {
  try {
    const target = path.join(root, ...EDIT_REPORT_REL_FILE.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `[${new Date().toISOString()}]\n${report}\n\n`);
  } catch { /* 审计落盘失败不影响 hook 主流程 */ }
}

function pendingEditReportNotice(root) {
  try {
    const target = path.join(root, ...EDIT_REPORT_REL_FILE.split('/'));
    if (!fs.existsSync(target)) return null;
    const content = fs.readFileSync(target, 'utf8');
    const count = (content.match(/OpenLogos guard/g) || []).length;
    if (count === 0) return null;
    return `⚠ 存在 ${count} 条越界编辑 / shell 事后检测报告未处理，见 ${EDIT_REPORT_REL_FILE}（人工核查并按需回退后可删除该文件）`;
  } catch {
    return null;
  }
}

/** afterFileEdit 的范围判定：git 判据生效且无活跃提案时走受保护判定（与 Claude 保护对象一致），否则走既有路径判定。 */
function editScope(root, state, filePath) {
  if (!state.slug) {
    const guardMode = detectGuardMode(root);
    if (guardMode.git) {
      const verdict = protectedVerdictFor(guardMode, filePath);
      return {
        relative: verdict.relative,
        decision: verdict.protected ? 'deny' : 'allow',
        reason: verdict.protected ? `受保护内容（命中原因：${verdict.reason}）；请先运行 openlogos change <slug>` : verdict.reason,
      };
    }
  }
  const relative = resolveCandidate(root, filePath);
  return { relative, ...decidePathScope(root, state, relative) };
}

function decideEdit(root, filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new HookInputError('afterFileEdit 缺少 file_path');
  }
  if (!isLaunched(root)) return null;
  const state = readSessionState(root);
  const scoped = editScope(root, state, filePath);
  if (scoped.decision === 'allow') return null;
  const report = [
    '⚠ OpenLogos guard: file edit outside allowed scope detected (post-check).',
    `Edited: ${scoped.relative}`,
    `Reason: ${scoped.reason}`,
    `Active change: ${state.slug || 'none'} | Proposal step: ${state.proposalStep || 'none'}`,
    `Allowed scope: ${allowedScopeText(state)}`,
    EDIT_NOT_BLOCKED_LINE,
  ].join('\n');
  appendEditReport(root, report);
  return report;
}

function shellAfterReport(root, body) {
  const report = [
    '⚠ OpenLogos guard（afterShellExecution 事后检查）：',
    body,
    SHELL_NOT_BLOCKED_LINE,
  ].join('\n');
  if (root) appendEditReport(root, report);
  return report;
}

/**
 * afterShellExecution：调用引擎 check 做最终对比（spec「执行记录生命周期」：同一关联键的非后台记录关闭并写墓碑；
 * 无关联键只对比不关闭任何记录；拿不到锁时待报告项写入 pending-spill/）。无变化静默返回 null。
 */
function decideShellAfter(root, event, platform = process.platform) {
  if (typeof event.command !== 'string' || event.command.trim() === '') {
    throw new HookInputError('afterShellExecution 缺少 command');
  }
  const guardMode = detectGuardMode(root);
  if (!guardMode.git) {
    if (guardMode.why === ENGINE_MISSING && isLaunched(root)) {
      return shellAfterReport(root, `事后检查不可用：${ENGINE_MISSING}（${ENGINE_REL}）。请运行 \`openlogos sync\` 补齐事后检查引擎，并人工核查本次命令是否改动了受保护内容。`);
    }
    return null;
  }
  const result = runEngine(guardMode, ['check'], engineShellInput('PostToolUse', event.command.trim(), platform, event));
  if (result.status === 0) return null;
  if (result.status === 2) {
    let body = result.stderr.trim();
    if (!body) {
      try { body = String(JSON.parse(result.stdout).reason || ''); } catch { body = result.stdout.trim(); }
    }
    return shellAfterReport(root, body);
  }
  return shellAfterReport(root, `无法安全判断本次 shell 命令的事后检查结果（引擎退出码 ${result.status === null ? '未知' : result.status}${result.stderr.trim() ? `：${result.stderr.trim().slice(0, 300)}` : ''}），执行记录保持打开，请人工核查。`);
}

function sessionOutput(context) {
  // Cursor sessionStart 消费顶层 additional_context 字段（2026.08.31 真实宿主实测确认；
  // Claude 风格 hookSpecificOutput.additionalContext 不会进入 agent 上下文）。
  return { additional_context: context };
}

/** beforeShellExecution 输出：allow → {permission}；deny → 双消息同为原因；ask → 受限命令的用户 / agent 消息。 */
function shellOutput(result) {
  const output = { permission: result.decision };
  if (result.decision === 'deny') {
    output.user_message = result.reason;
    output.agent_message = result.reason;
  } else if (result.decision === 'ask') {
    output.user_message = result.userMessage;
    output.agent_message = result.agentMessage;
  }
  return output;
}

function editOutput(report) {
  return report === null ? {} : { agent_message: report };
}

const MODE_EVENTS = {
  session: 'sessionStart',
  shell: 'beforeShellExecution',
  'shell-after': 'afterShellExecution',
  edit: 'afterFileEdit',
};

function run(mode, raw, cwd, opts = {}) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024 * 1024) {
    throw new HookInputError('Hook 输入为空或超过 1 MiB 限制');
  }
  const input = JSON.parse(raw);
  const event = normalizeCursorEvent(input);
  const expected = MODE_EVENTS[mode];
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
    return { output: sessionOutput(sessionContext(root, event.conversationId)), exitCode: 0 };
  }
  if (!root) throw new HookInputError('未找到 logos/logos.config.json');
  const platform = opts.platform || process.platform;
  if (mode === 'shell') {
    const result = decideShell(root, event.command, platform, { event, askPolicy: opts.askPolicy });
    return { output: shellOutput(result), exitCode: result.decision === 'deny' ? 2 : 0 };
  }
  if (mode === 'shell-after') {
    return { output: editOutput(decideShellAfter(root, event, platform)), exitCode: 0 };
  }
  const report = decideEdit(root, event.filePath);
  return { output: editOutput(report), exitCode: 0 };
}

function shellFailure(reason) {
  const message = `OpenLogos Cursor Hook fail-closed：${reason}`;
  return { output: shellOutput({ decision: 'deny', reason: message }), exitCode: 2 };
}

function editFailure(reason, root) {
  const report = [
    '⚠ OpenLogos guard: 无法安全判断本次编辑（fail-closed 报告），请人工核查。',
    `原因：${reason}`,
    EDIT_NOT_BLOCKED_LINE,
  ].join('\n');
  if (root) appendEditReport(root, report);
  return { output: editOutput(report), exitCode: 0 };
}

function shellAfterFailure(reason, root) {
  const report = shellAfterReport(root, `无法安全判断本次 shell 命令是否改动了受保护内容（fail-closed 报告）：${reason}`);
  return { output: editOutput(report), exitCode: 0 };
}

async function main() {
  const mode = process.argv[2];
  if (!Object.prototype.hasOwnProperty.call(MODE_EVENTS, mode)) {
    const failure = shellFailure('入口参数必须是 session、shell、shell-after 或 edit');
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
      ? editFailure(message, findProjectRoot(process.cwd()))
      : mode === 'shell-after'
        ? shellAfterFailure(message, findProjectRoot(process.cwd()))
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
  CURSOR_ASK_POLICY,
  GENERATION_KEY_VERIFIED,
  GUARD_STRENGTH_LINE,
  EDIT_NOT_BLOCKED_LINE,
  SHELL_NOT_BLOCKED_LINE,
  EDIT_REPORT_REL_FILE,
  PATH_WHITELIST_PREFIXES,
  callKey,
  classifyScopeCommand,
  decideEdit,
  decidePathScope,
  decideShell,
  decideShellAfter,
  decideWindowsShell,
  deriveProposalStep,
  detectGuardMode,
  editOutput,
  findEnginePath,
  findProjectRoot,
  isProtectedPath,
  normalizeCursorEvent,
  readSessionState,
  resolveCandidate,
  run,
  sessionContext,
  shellOutput,
};

if (require.main === module) void main();
