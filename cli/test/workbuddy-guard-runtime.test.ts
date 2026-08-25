import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const runtimePath = join(repoRoot, 'plugin-workbuddy', 'hooks', 'runtime.cjs');
const require = createRequire(import.meta.url);
const runtime = require(runtimePath) as {
  decideGuard(root: string, event: Record<string, unknown>): { decision: string; reason: string };
  guardOutput(result: { decision: string; reason: string }): Record<string, unknown>;
  normalizeHookEvent(input: Record<string, unknown>): Record<string, unknown>;
  resolveCandidate(root: string, target: string): string;
  sessionContext(root: string): string;
};

function writeProject(root: string, options: { guard?: boolean; deltaChecked?: boolean } = {}) {
  mkdirSync(join(root, 'logos', 'changes', 'demo', 'deltas', 'spec'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ name: 'demo', locale: 'zh' }));
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), 'modules:\n  - id: core\n    lifecycle: launched\n');
  writeFileSync(join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  writeFileSync(join(root, 'logos', 'changes', 'demo', 'proposal.md'), '# 提案\n');
  writeFileSync(join(root, 'logos', 'changes', 'demo', 'PLAN_APPROVED'), '');
  writeFileSync(join(root, 'logos', 'changes', 'demo', 'tasks.md'), [
    '# 实现任务',
    '## [delta] 规格变更',
    `- [${options.deltaChecked ? 'x' : ' '}] [MODIFY] deltas/spec/demo.md`,
    '## [code] 代码实现',
    '- [ ] 实现功能',
    '',
  ].join('\n'));
  if (options.guard !== false) {
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'demo', module: 'core' }));
  }
}

function event(toolName: string, toolInput: Record<string, unknown>, root: string) {
  return { hookEventName: 'PreToolUse', toolName, toolInput, cwd: root };
}

function wireEvent(toolName: string, toolInput: Record<string, unknown>, root: string) {
  return { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, cwd: root };
}

function invoke(root: string, mode: 'session' | 'guard', input: unknown) {
  return spawnSync(process.execPath, [runtimePath, mode], {
    cwd: root,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, OPENLOGOS_WORKBUDDY_HOOK_DEBUG: '1' },
  });
}

describe('WorkBuddy Hook runtime — S09', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openlogos-workbuddy-guard-'));
    writeProject(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('UT-S09-208: SessionStart 输出单一合法 JSON、additionalContext 与 exit 0', () => {
    const result = invoke(root, 'session', { session_id: 's', hook_event_name: 'SessionStart', cwd: root, source: 'startup' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(output.hookSpecificOutput.additionalContext).toBeTruthy();
  });

  it('UT-S09-209: SessionStart 只从磁盘事实派生 module/slug/阶段/范围/确认点且不碰原生记忆', () => {
    const memory = Buffer.from([0, 255, 3, 128]);
    mkdirSync(join(root, '.workbuddy'), { recursive: true });
    writeFileSync(join(root, '.workbuddy/native-memory.bin'), memory);
    const context = runtime.sessionContext(root);
    expect(context).toContain('active change: demo');
    expect(context).toContain('proposal_step: delta-writing');
    expect(context).toContain('允许范围');
    expect(context).toContain('下一确认点');
    expect(readFileSync(join(root, '.workbuddy/native-memory.bin')).equals(memory)).toBe(true);
  });

  it('UT-S09-210: CLI Write/Edit/Bash 工具名映射为共享 allow/deny 动作', () => {
    expect(runtime.decideGuard(root, event('Write', { file_path: 'logos/changes/demo/deltas/spec/demo.md' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('Edit', { file_path: 'logos/changes/demo/tasks.md' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('Bash', { command: 'rm -f src/index.ts' }, root)).decision).toBe('deny');
  });

  it('UT-S09-211: 桌面 write_to_file/replace_in_file/execute_command 映射正确', () => {
    expect(runtime.decideGuard(root, event('write_to_file', { path: 'logos/changes/demo/deltas/spec/demo.md' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('replace_in_file', { filePath: 'logos/changes/demo/tasks.md' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('execute_command', { cmd: 'pwd' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('execute_command', { command: 'printf x > src/index.ts' }, root)).decision).toBe('deny');
  });

  it('UT-S09-212: snake_case/camelCase 无冲突时归一为同一事件，冲突时拒绝', () => {
    const camel = runtime.normalizeHookEvent({ hookEventName: 'PreToolUse', toolName: 'Write', toolInput: { path: 'a' }, cwd: root });
    const snake = runtime.normalizeHookEvent({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { path: 'a' }, cwd: root });
    expect(snake).toEqual(camel);
    expect(() => runtime.normalizeHookEvent({ hookEventName: 'PreToolUse', hook_event_name: 'SessionStart' })).toThrow(/别名冲突/);
  });

  it('UT-S09-213: allow 合同返回 permissionDecision=allow、continue=true 与 exit 0', () => {
    expect(runtime.guardOutput({ decision: 'allow', reason: 'ok' })).toMatchObject({
      continue: true,
      hookSpecificOutput: { permissionDecision: 'allow' },
    });
    expect(invoke(root, 'guard', wireEvent('Read', { file_path: 'src/index.ts' }, root)).status).toBe(0);
  });

  it('UT-S09-214: deny 合同返回非空 reason、continue=false 与 exit 2', () => {
    expect(runtime.guardOutput({ decision: 'deny', reason: 'blocked' })).toMatchObject({
      continue: false,
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'blocked' },
    });
    const result = invoke(root, 'guard', wireEvent('Write', { file_path: 'src/index.ts' }, root));
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toBeTruthy();
  });

  it('UT-S09-215: delta-writing 只允许当前 delta/tasks，ready-to-merge 立即收紧', () => {
    const target = 'logos/changes/demo/deltas/spec/demo.md';
    expect(runtime.decideGuard(root, event('Write', { file_path: target }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('Write', { file_path: 'logos/changes/demo/tasks.md' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('Write', { file_path: 'src/index.ts' }, root)).decision).toBe('deny');
    writeProject(root, { deltaChecked: true });
    expect(runtime.decideGuard(root, event('Write', { file_path: target }, root)).reason).toContain('merge');
  });

  it('UT-S09-216: 同一 session 每次调用重读磁盘状态而不使用缓存', () => {
    const target = 'logos/changes/demo/deltas/spec/demo.md';
    expect(runtime.decideGuard(root, event('Write', { file_path: target }, root)).decision).toBe('allow');
    writeProject(root, { deltaChecked: true });
    expect(runtime.decideGuard(root, event('Write', { file_path: target }, root)).decision).toBe('deny');
    expect(runtime.sessionContext(root)).toContain('proposal_step: ready-to-merge');
  });

  it('UT-S09-217: traversal、绝对路径、symlink 逃逸和未知潜在写工具均 fail-closed', () => {
    const outside = mkdtempSync(join(tmpdir(), 'openlogos-workbuddy-outside-'));
    try {
      symlinkSync(outside, join(root, 'escape'));
      expect(() => runtime.resolveCandidate(root, '../outside.txt')).toThrow();
      expect(() => runtime.resolveCandidate(root, join(root, 'logos/changes/demo/tasks.md'))).toThrow();
      expect(() => runtime.resolveCandidate(root, 'escape/secret.txt')).toThrow(/越出项目根目录/);
      expect(runtime.decideGuard(root, event('UnknownMcpWrite', {}, root)).decision).toBe('deny');
      expect(existsSync(join(outside, 'secret.txt'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('UT-S09-218: 空/超限/非法 JSON/缺字段/状态损坏均协议 deny + exit 2', () => {
    for (const input of ['', 'x'.repeat(1024 * 1024 + 1), '{bad', '{}{}', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 7, tool_input: [] })]) {
      const result = invoke(root, 'guard', input);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({ continue: false, hookSpecificOutput: { permissionDecision: 'deny' } });
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toBeTruthy();
    }
    writeFileSync(join(root, 'logos', '.openlogos-guard'), '{bad');
    expect(invoke(root, 'guard', wireEvent('Write', { file_path: 'src/index.ts' }, root)).status).toBe(2);
  });

  it('ST-S09-81: 新 WorkBuddy session 上下文与磁盘阶段一致且原生记忆不变', () => {
    const memory = Buffer.from('opaque-native-memory');
    mkdirSync(join(root, '.workbuddy'), { recursive: true });
    writeFileSync(join(root, '.workbuddy/native-memory.bin'), memory);
    const result = invoke(root, 'session', { session_id: 's1', hook_event_name: 'SessionStart', cwd: root, source: 'startup' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).hookSpecificOutput.additionalContext).toContain('proposal_step: delta-writing');
    expect(readFileSync(join(root, '.workbuddy/native-memory.bin')).equals(memory)).toBe(true);
  });

  it('ST-S09-82: 当前 delta 写入 allow 后由工具执行并可读回', () => {
    const target = 'logos/changes/demo/deltas/spec/demo.md';
    const allowed = invoke(root, 'guard', wireEvent('write_to_file', { path: target }, root));
    expect(allowed.status).toBe(0);
    expect(JSON.parse(allowed.stdout)).toMatchObject({ continue: true, hookSpecificOutput: { permissionDecision: 'allow' } });
    writeFileSync(join(root, target), '# delta\n');
    expect(readFileSync(join(root, target), 'utf8')).toBe('# delta\n');
  });

  it('ST-S09-83: 源码/越界/路径逃逸均阻断、reason 可操作且目标字节不变', () => {
    const source = join(root, 'src', 'index.ts');
    const before = readFileSync(source);
    for (const input of [
      wireEvent('Write', { file_path: 'src/index.ts' }, root),
      wireEvent('write_to_file', { path: 'logos/changes/other/tasks.md' }, root),
      wireEvent('replace_in_file', { path: '../outside.txt' }, root),
    ]) {
      const result = invoke(root, 'guard', input);
      expect(result.status).toBe(2);
      const output = JSON.parse(result.stdout).hookSpecificOutput;
      expect(output.permissionDecision).toBe('deny');
      expect(output.permissionDecisionReason).toBeTruthy();
    }
    expect(readFileSync(source).equals(before)).toBe(true);
  });

  it('ST-S09-84: 同会话阶段跃迁立即收紧且状态异常 fail-closed', () => {
    const target = 'logos/changes/demo/deltas/spec/demo.md';
    expect(invoke(root, 'guard', wireEvent('Write', { file_path: target }, root)).status).toBe(0);
    writeProject(root, { deltaChecked: true });
    expect(invoke(root, 'guard', wireEvent('Write', { file_path: target }, root)).status).toBe(2);
    expect(runtime.sessionContext(root)).toContain('proposal_step: ready-to-merge');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), '{bad');
    const failed = invoke(root, 'guard', wireEvent('Write', { file_path: 'src/index.ts' }, root));
    expect(failed.status).toBe(2);
    expect(JSON.parse(failed.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(JSON.parse(readFileSync(join(repoRoot, 'plugin-workbuddy', 'hooks', 'hooks.json'), 'utf8'))).toBeTruthy();
  });
});
