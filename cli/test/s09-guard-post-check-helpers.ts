/**
 * guard-versioned-content-scope [code] 切片 3 共用夹具：以 stdin JSON + cwd + CLAUDE_PROJECT_DIR 驱动分发源
 * `plugin/bin/guard-check`（PreToolUse）与 `plugin/bin/guard-post-check.cjs`（PostToolUse / PostToolUseFailure / Stop），
 * 两次 hook 之间真实执行被测命令。hook 输入按 Claude Code 真实字段构造（session_id、hook_event_name、tool_use_id 等）。
 * 本模块不 import vitest，断言由调用方完成。
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENGINE_SRC, GUARD_SRC, cleanEnv } from './s09-guard-vcs-fixtures.js';

const require = createRequire(import.meta.url);
/** 分发源引擎的真实实现（函数层 UT 直接调用，不另写规则副本）。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const engine: any = require(ENGINE_SRC);

export const RUNTIME = 'logos/.openlogos-runtime';
export const CLAUDE_ENGINE_CMD = 'node "$CLAUDE_PROJECT_DIR/.claude/openlogos/bin/guard-post-check.cjs"';

export interface HookRun { exitCode: number; stdout: string; stderr: string }

let seq = 0;
export function nextId(prefix = 'toolu'): string {
  seq += 1;
  return `${prefix}_${process.pid}_${seq}`;
}

/** 托管引擎副本：.claude/openlogos/bin/guard-post-check.cjs 与分发源同字节（模拟 init / sync 部署），使反馈中的恢复命令可直接执行。 */
export function deployEngine(root: string): void {
  mkdirSync(join(root, '.claude/openlogos/bin'), { recursive: true });
  copyFileSync(ENGINE_SRC, join(root, '.claude/openlogos/bin/guard-post-check.cjs'));
}

function hookInput(root: string, event: string, tool: string | null, toolInput: Record<string, unknown> | null,
  id: string | null, extra: Record<string, unknown> = {}): string {
  const o: Record<string, unknown> = {
    session_id: 's09-post', transcript_path: join(root, '.t.jsonl'), cwd: root, hook_event_name: event,
    permission_mode: 'default',
  };
  if (tool) o.tool_name = tool;
  if (toolInput) o.tool_input = toolInput;
  if (id) o.tool_use_id = id;
  return JSON.stringify({ ...o, ...extra });
}

export function preToolUse(root: string, tool: string, toolInput: Record<string, unknown>, id: string | null,
  extra: Record<string, unknown> = {}, env: Record<string, string | undefined> = {}): HookRun {
  const r = spawnSync('bash', [GUARD_SRC], {
    input: hookInput(root, 'PreToolUse', tool, toolInput, id, extra), cwd: root, encoding: 'utf-8', timeout: 60_000,
    env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...env }),
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function engineCli(root: string, args: string[], input = '', env: Record<string, string | undefined> = {}): HookRun {
  const r = spawnSync('node', [ENGINE_SRC, ...args], {
    input, cwd: root, encoding: 'utf-8', timeout: 120_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...env }),
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function postToolUse(root: string, command: string, id: string | null, failure = false, tool = 'Bash',
  env: Record<string, string | undefined> = {}): HookRun {
  const event = failure ? 'PostToolUseFailure' : 'PostToolUse';
  const extra: Record<string, unknown> = failure ? { error: 'Command failed' } : { tool_response: { stdout: '', stderr: '', interrupted: false } };
  return engineCli(root, ['check'], hookInput(root, event, tool, { command }, id, extra), env);
}

export function stopHook(root: string, active = false): HookRun {
  return engineCli(root, ['check', '--stop'], hookInput(root, 'Stop', null, null, null, { stop_hook_active: active }));
}

export function sessionStart(root: string): HookRun {
  return engineCli(root, ['check', '--session-start'], hookInput(root, 'SessionStart', null, null, null, { source: 'startup' }));
}

/** 直接拍快照（模拟未发送结束事件的调用，如后台调用）。 */
export function snapshot(root: string, command: string, id: string, background = false,
  env: Record<string, string | undefined> = {}): HookRun {
  return engineCli(root, ['snapshot'], hookInput(root, 'PreToolUse', 'Bash',
    { command, ...(background ? { run_in_background: true } : {}) }, id), env);
}

export function bash(root: string, command: string, env: Record<string, string | undefined> = {}): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('bash', ['-c', command], {
    cwd: root, encoding: 'utf-8', timeout: 120_000,
    env: cleanEnv({ CLAUDE_PROJECT_DIR: root, GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no', ...env }),
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export interface ChainRun { id: string; pre: HookRun; exec: { status: number; stdout: string; stderr: string } | null; post: HookRun | null; recordAfterPre: boolean }

/**
 * 完整 hook 链：PreToolUse → （放行时）真实执行 → PostToolUse（命令非零退出时为 PostToolUseFailure）。
 * exec 可替换实际执行的命令文本（如 macOS sed 方言、以 node cli/dist/index.js 代替 openlogos），hook 看到的仍是 command。
 */
export function chain(root: string, command: string, opts: { exec?: string; tool?: string; id?: string } = {}): ChainRun {
  const id = opts.id ?? nextId();
  const tool = opts.tool ?? 'Bash';
  const pre = preToolUse(root, tool, { command }, id);
  const recordAfterPre = existsSync(join(root, RUNTIME, 'guard-records', `${id}.json`));
  if (pre.exitCode !== 0 || pre.stdout.includes('permissionDecision')) return { id, pre, exec: null, post: null, recordAfterPre };
  const exec = bash(root, opts.exec ?? command);
  const post = postToolUse(root, command, id, exec.status !== 0, tool);
  return { id, pre, exec, post, recordAfterPre };
}

/** 反馈中的恢复命令（Claude 宿主形态）。 */
export function restoreCommands(text: string): string[] {
  return text.split('\n').map(l => l.trim()).filter(l => l.startsWith(`${CLAUDE_ENGINE_CMD} restore `));
}

export function restoreFor(text: string, rel: string): string | undefined {
  return restoreCommands(text).find(c => c.endsWith(` -- ${rel}`));
}

export function records(root: string): string[] {
  const d = join(root, RUNTIME, 'guard-records');
  if (!existsSync(d)) return [];
  return readdirSync(d).filter(n => n.endsWith('.json')).sort();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readRecord(root: string, id: string): any {
  return JSON.parse(readFileSync(join(root, RUNTIME, 'guard-records', `${id}.json`), 'utf-8'));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readJsonl(root: string, name: string): any[] {
  const f = join(root, RUNTIME, name);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

export function sha(abs: string): string {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

/** macOS（BSD sed）下 `sed -i` 须带空后缀参数；hook 看到的仍是规格中的 GNU 写法。 */
export function sedExec(expr: string, file: string): string {
  return process.platform === 'darwin' ? `sed -i '' ${expr} ${file}` : `sed -i ${expr} ${file}`;
}

export function writeAt(root: string, rel: string, content: string | Buffer): void {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), content);
}

export function rawOid(root: string, rel: string): string {
  return spawnSync('git', ['hash-object', '--no-filters', '--', rel], { cwd: root, encoding: 'utf-8', env: cleanEnv() }).stdout.trim();
}

export function blobOf(root: string, content: string): string {
  return spawnSync('git', ['hash-object', '--stdin'], { cwd: root, input: content, encoding: 'utf-8', env: cleanEnv() }).stdout.trim();
}
