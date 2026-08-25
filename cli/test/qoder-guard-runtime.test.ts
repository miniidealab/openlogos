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
const runtimePath = join(repoRoot, 'plugin-qoder', 'hooks', 'runtime.cjs');
const require = createRequire(import.meta.url);
const runtime = require(runtimePath) as {
  decideGuard(root: string, event: Record<string, unknown>): { decision: string; reason: string };
  guardOutput(result: { decision: string; reason: string }): Record<string, unknown>;
  normalizeHookEvent(input: Record<string, unknown>): Record<string, unknown>;
  resolveCandidate(root: string, target: string): string;
  sessionContext(root: string): string;
};

function writeProject(root: string, options: { guard?: boolean; deltaChecked?: boolean } = {}) {
  mkdirSync(join(root, 'logos', 'changes', 'demo', 'deltas'), { recursive: true });
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
    env: { ...process.env, OPENLOGOS_QODER_HOOK_DEBUG: '1' },
  });
}

describe('Qoder Hook runtime — S09', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openlogos-qoder-guard-'));
    writeProject(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('UT-S09-198: Qoder 官方 snake_case 公共字段归一化为宿主无关事件', () => {
    const normalized = runtime.normalizeHookEvent({
      session_id: 's', transcript_path: '/tmp/transcript', hook_event_name: 'SessionStart', cwd: root, source: 'startup',
    });
    expect(normalized).toMatchObject({ sessionId: 's', transcriptPath: '/tmp/transcript', hookEventName: 'SessionStart', cwd: root, source: 'startup' });
  });

  it('UT-S09-199: PreToolUse 的工具、输入与关联 id 正确映射', () => {
    expect(runtime.normalizeHookEvent({
      hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'a' }, tool_use_id: 'tool-1', cwd: root,
    })).toMatchObject({ hookEventName: 'PreToolUse', toolName: 'Write', toolInput: { file_path: 'a' }, toolUseId: 'tool-1' });
  });

  it('UT-S09-200: 空、非法、尾随、缺字段与类型错误均 fail-closed', () => {
    for (const input of ['', '{bad', '{}{}', JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 7, tool_input: [] })]) {
      const result = invoke(root, 'guard', input);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout).hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' });
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecisionReason).toBeTruthy();
      expect(result.stderr).toContain('OpenLogos Qoder Hook');
    }
  });

  it('UT-S09-201: SessionStart 输出当前 slug、阶段、范围与确认点', () => {
    const result = invoke(root, 'session', { session_id: 's', hook_event_name: 'SessionStart', cwd: root, source: 'startup' });
    expect(result.status).toBe(0);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    expect(context).toContain('active change: demo');
    expect(context).toContain('proposal_step: delta-writing');
    expect(context).toContain('允许范围');
    expect(context).toContain('下一确认点');
  });

  it('UT-S09-202: delta-writing 仅放行当前 deltas 与 tasks.md', () => {
    expect(runtime.decideGuard(root, event('Write', { file_path: 'logos/changes/demo/deltas/spec/demo.md' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('Edit', { file_path: 'logos/changes/demo/tasks.md' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('Write', { file_path: 'src/index.ts' }, root)).decision).toBe('deny');
  });

  it('UT-S09-203: 同一 session 下 ready-to-merge 重读并拒绝继续写 delta', () => {
    writeProject(root, { deltaChecked: true });
    const decision = runtime.decideGuard(root, event('Write', { file_path: 'logos/changes/demo/deltas/spec/demo.md' }, root));
    expect(decision).toMatchObject({ decision: 'deny' });
    expect(decision.reason).toContain('merge');
  });

  it('UT-S09-204: 源码、提案外、穿越、绝对路径与符号链接逃逸均被拒绝', () => {
    const outside = mkdtempSync(join(tmpdir(), 'openlogos-qoder-outside-'));
    try {
      symlinkSync(outside, join(root, 'escape'));
      expect(runtime.decideGuard(root, event('Write', { file_path: 'src/index.ts' }, root)).decision).toBe('deny');
      expect(runtime.decideGuard(root, event('Write', { file_path: 'logos/changes/other/tasks.md' }, root)).decision).toBe('deny');
      expect(() => runtime.resolveCandidate(root, '../outside.txt')).toThrow();
      expect(() => runtime.resolveCandidate(root, join(root, 'logos/changes/demo/tasks.md'))).toThrow();
      expect(() => runtime.resolveCandidate(root, 'escape/secret.txt')).toThrow(/越出项目根目录/);
      expect(existsSync(join(outside, 'secret.txt'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('UT-S09-205: 未知、间接写工具与可疑 Bash 无法证明只读时拒绝', () => {
    expect(runtime.decideGuard(root, event('UnknownMcpWrite', {}, root)).decision).toBe('deny');
    expect(runtime.decideGuard(root, event('Bash', { command: 'rm -f src/index.ts' }, root)).decision).toBe('deny');
    expect(runtime.decideGuard(root, event('Bash', { command: 'printf x > src/index.ts' }, root)).decision).toBe('deny');
    expect(runtime.decideGuard(root, event('Bash', { command: 'pwd; rm -f src/index.ts' }, root)).decision).toBe('deny');
    expect(runtime.decideGuard(root, event('Read', { file_path: 'src/index.ts' }, root)).decision).toBe('allow');
  });

  it('UT-S09-206: allow exit 0，deny 与异常均映射 reason 并 exit 2', () => {
    expect(runtime.guardOutput({ decision: 'allow', reason: 'ok' })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'allow' },
    });
    expect(runtime.guardOutput({ decision: 'deny', reason: 'blocked' })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'blocked' },
    });
    expect(invoke(root, 'guard', wireEvent('Read', { file_path: 'src/index.ts' }, root)).status).toBe(0);
    expect(invoke(root, 'guard', wireEvent('Write', { file_path: 'src/index.ts' }, root)).status).toBe(2);
    expect(invoke(root, 'guard', '{bad').status).toBe(2);
  });

  it('UT-S09-207: stdout 只含单条协议 JSON，诊断只进入 stderr', () => {
    const result = invoke(root, 'guard', '{bad');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout).not.toContain('OpenLogos Qoder Hook:');
    expect(result.stderr).toContain('OpenLogos Qoder Hook:');
  });

  it('ST-S09-77: 新会话注入与磁盘 proposal_step 一致的 additionalContext', () => {
    const result = invoke(root, 'session', { session_id: 's1', hook_event_name: 'SessionStart', cwd: root, source: 'startup' });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.additionalContext).toContain('proposal_step: delta-writing');
  });

  it('ST-S09-78: delta 写入允许而源码写入由 exit 2 阻断', () => {
    const source = join(root, 'src', 'index.ts');
    const before = readFileSync(source, 'utf8');
    const allowed = invoke(root, 'guard', wireEvent('Write', { file_path: 'logos/changes/demo/deltas/spec/demo.md' }, root));
    const blocked = invoke(root, 'guard', wireEvent('Write', { file_path: 'src/index.ts' }, root));
    expect(allowed.status).toBe(0);
    expect(blocked.status).toBe(2);
    expect(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(readFileSync(source, 'utf8')).toBe(before);
  });

  it('ST-S09-79: 同一 session 内阶段变化立即收紧且新上下文更新', () => {
    const target = 'logos/changes/demo/deltas/spec/demo.md';
    expect(runtime.decideGuard(root, event('Write', { file_path: target }, root)).decision).toBe('allow');
    writeProject(root, { deltaChecked: true });
    expect(runtime.decideGuard(root, event('Write', { file_path: target }, root)).decision).toBe('deny');
    expect(runtime.sessionContext(root)).toContain('proposal_step: ready-to-merge');
  });

  it('ST-S09-80: 运行时状态损坏时 fail-closed 且不执行写工具', () => {
    const source = join(root, 'src', 'index.ts');
    const before = readFileSync(source, 'utf8');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), '{bad');
    const result = invoke(root, 'guard', wireEvent('Write', { file_path: 'src/index.ts' }, root));
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(readFileSync(source, 'utf8')).toBe(before);
    expect(JSON.parse(readFileSync(join(repoRoot, 'plugin-qoder', 'hooks', 'hooks.json'), 'utf8'))).toBeTruthy();
  });
});
