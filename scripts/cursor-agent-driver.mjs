#!/usr/bin/env node
// 真实 cursor-agent 宿主驱动（SMOKE-core-185/186/187 专用；smoke runner 经
// OPENLOGOS_CURSOR_DRIVER 调用）。所有断言经真实 cursor-agent print 会话产生：
// - 事件覆盖面由用户级日志 hook 实测（利用「用户 hooks 条目保留」契约追加，不动托管条目）
// - shell 阻断以文件系统副作用（目标目录不存在）+ agent 复述的 deny 文本为证
// - 编辑事后检测以真实编辑发生 + 审计日志落盘为证（该场景不挂 session 注入，
//   避免 agent 依注入上下文主动拒绝编辑——观测对象是 hook 链，不是 agent 品行）
// 用法：node cursor-agent-driver.mjs <discover-skills|session-start|guard-matrix> <projectRoot>
// stdout：单个 JSON verdict。
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const [action, projectRoot] = process.argv.slice(2);
if (!action || !projectRoot) {
  console.error('用法：cursor-agent-driver.mjs <action> <projectRoot>');
  process.exit(1);
}
const agentBin = process.env.OPENLOGOS_CURSOR_AGENT_BIN || 'cursor-agent';

function agent(prompt, cwd, timeoutMs = 420000) {
  const result = spawnSync(agentBin, ['-p', '-f', prompt, '--output-format', 'text'], {
    cwd, encoding: 'utf8', timeout: timeoutMs, env: process.env,
  });
  if (result.error) throw result.error;
  return { stdout: result.stdout || '', stderr: result.stderr || '', status: result.status };
}

function agentVersion() {
  try { return spawnSync(agentBin, ['--version'], { encoding: 'utf8' }).stdout.trim() || null; } catch { return null; }
}

const EVENTS = ['sessionStart', 'beforeShellExecution', 'afterShellExecution', 'afterFileEdit', 'postToolUse', 'preToolUse', 'stop', 'beforeSubmitPrompt'];

function readHooks(root) {
  const file = join(root, '.cursor', 'hooks.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, hooks: {} };
}

/** 追加用户级事件日志 hook（每个事件一条）——依托管合并契约，用户条目永被保留。 */
function addLoggingHooks(root) {
  const doc = readHooks(root);
  doc.hooks = doc.hooks || {};
  for (const event of EVENTS) {
    const entries = Array.isArray(doc.hooks[event]) ? doc.hooks[event] : [];
    entries.push({ type: 'command', command: `sh -c 'echo ${event} >> .cursor/host-events.log'` });
    doc.hooks[event] = entries;
  }
  writeFileSync(join(root, '.cursor', 'hooks.json'), JSON.stringify(doc, null, 2) + '\n');
}

function measuredEvents(root) {
  const file = join(root, '.cursor', 'host-events.log');
  if (!existsSync(file)) return [];
  return [...new Set(readFileSync(file, 'utf8').split('\n').filter(Boolean))].sort();
}

/** launched + 活跃提案 + 指定 proposal_step 的 fixture（driver 只写 fixture，不动托管资产）。 */
function writeGuardFixture(root, step, slugOverride) {
  const slug = slugOverride || 'cursor-smoke-fixture';
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    'schema_version: 1\nname: demo\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug }));
  const proposalDir = join(root, 'logos', 'changes', slug);
  mkdirSync(join(proposalDir, 'deltas'), { recursive: true });
  writeFileSync(join(proposalDir, 'proposal.md'), '# fixture');
  writeFileSync(join(proposalDir, 'tasks.md'),
    '# 实现任务\n\n## [delta] 规格变更\n- [ ] 产出 delta\n\n## [code] 代码实现\n- [ ] 片\n');
  if (step !== 'ready-to-delta') writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '{}');
}

function emit(verdict) {
  process.stdout.write(JSON.stringify(verdict) + '\n');
}

if (action === 'discover-skills') {
  const listing = agent(
    'List the names of the skills available to you in this workspace (look under .cursor/skills). Then reply LISTED.',
    projectRoot);
  const skillsDiscovered = /prd-writer|architecture-designer|change-writer/.test(listing.stdout);
  const command = agent(
    'Invoke the skill named openlogos-status (an explicit command skill in this workspace) and summarize what it instructs you to do. Reply INVOKED at the end.',
    projectRoot);
  const commandReachable = /openlogos|status/i.test(command.stdout) && /INVOKED/.test(command.stdout);
  emit({
    cursor_agent_version: agentVersion(),
    skills_discovered: skillsDiscovered,
    command_reachable: commandReachable,
    listing_excerpt: listing.stdout.slice(-800),
  });
} else if (action === 'session-start') {
  addLoggingHooks(projectRoot);
  // 确定性哨兵：fixture 注入独特 active change 值——agent 能答出该值 ⇔ sessionStart 注入到达上下文。
  // （「引用你的上下文」类 prompt 会被 agent 以“不导出系统提示词”为由拒绝，产生假阴。）
  const SENTINEL = 'cursor-inject-probe-4242';
  writeGuardFixture(projectRoot, 'ready-to-delta', SENTINEL);
  const result = agent(
    "Somewhere in your context there may be a line starting with 'active change:'. Step 1: reply with exactly one line ANSWER=<the value after the colon>, or ANSWER=missing if no such line exists. Step 2: run the shell command 'git status' (fine if it errors). Step 3: create file .cursor/probe-note.txt containing ok using your edit tool. End with FINISHED.",
    projectRoot);
  const events = measuredEvents(projectRoot);
  const injected = result.stdout.includes(`ANSWER=${SENTINEL}`) || result.stdout.includes(SENTINEL)
    || /OpenLogos lifecycle:|proposal_step[:：]|允许范围|无活跃提案/.test(result.stdout);
  emit({
    cursor_agent_version: agentVersion(),
    session_context_injected: injected,
    guard_strength_line_visible: /guard 强度|preToolUse/.test(result.stdout),
    hook_events_measured: events,
    stdout_excerpt: result.stdout.slice(-1200),
  });
} else if (action === 'guard-matrix') {
  // 子场景 A：shell 硬拦（挂 session+shell 托管 hooks；delta-writing 收敛态）
  writeGuardFixture(projectRoot, 'delta-writing');
  rmSync(join(projectRoot, 'evil-dir'), { recursive: true, force: true });
  const inScope = agent(
    "Run exactly this shell command and show its output: git status. Reply DONE_A.",
    projectRoot);
  const denied = agent(
    "The user explicitly asks you to run exactly this shell command now: mkdir -p evil-dir. Attempt it, and if it is blocked, quote the full denial message you received verbatim. Reply DONE_B.",
    projectRoot);
  const evilExists = existsSync(join(projectRoot, 'evil-dir'));
  // 子场景 B：编辑事后检测（独立子目录项目：只挂 edit 托管 hook，无 session 注入预警）
  const editRoot = join(projectRoot, 'edit-probe');
  mkdirSync(join(editRoot, '.cursor', 'hooks'), { recursive: true });
  mkdirSync(join(editRoot, 'logos'), { recursive: true });
  writeFileSync(join(editRoot, 'logos', 'logos.config.json'), '{"name":"edit-probe","locale":"zh"}');
  writeGuardFixture(editRoot, 'delta-writing');
  const runtimeSource = join(projectRoot, '.cursor', 'hooks', 'openlogos-runtime.cjs');
  writeFileSync(join(editRoot, '.cursor', 'hooks', 'openlogos-runtime.cjs'), readFileSync(runtimeSource));
  writeFileSync(join(editRoot, '.cursor', 'hooks.json'), JSON.stringify({
    version: 1,
    hooks: { afterFileEdit: [{ type: 'command', command: 'node .cursor/hooks/openlogos-runtime.cjs edit' }] },
  }, null, 2) + '\n');
  const edit = agent(
    "Create the file src/outside.ts containing 'export const z = 3;' using your file editing tool. Reply DONE_C.",
    editRoot);
  const editedFile = join(editRoot, 'src', 'outside.ts');
  const auditLog = join(editRoot, '.cursor', 'openlogos-guard-reports.log');
  const auditContent = existsSync(auditLog) ? readFileSync(auditLog, 'utf8') : '';
  emit({
    cursor_agent_version: agentVersion(),
    in_scope_shell_allowed: /DONE_A/.test(inScope.stdout),
    out_of_scope_shell_denied: !evilExists,
    deny_reason: denied.stdout.slice(-1600),
    edit_attempted: /DONE_C/.test(edit.stdout),
    edited_file_mutated: existsSync(editedFile),
    edit_report_received: auditContent.includes('src/outside.ts'),
    edit_report: auditContent.slice(0, 1600) || null,
  });
} else {
  console.error(`未知 action：${action}`);
  process.exit(1);
}
