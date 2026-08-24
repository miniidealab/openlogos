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
const runtimePath = join(repoRoot, 'plugin-zcode', 'runtime', 'hook-runtime.js');
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
  return { toolName, toolInput, cwd: root };
}

function invoke(root: string, mode: 'session' | 'guard', input: unknown) {
  return spawnSync(process.execPath, [runtimePath, mode], {
    cwd: root,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, OPENLOGOS_ZCODE_HOOK_DEBUG: '1' },
  });
}

describe('ZCode Hook runtime — S09', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openlogos-zcode-guard-'));
    writeProject(root);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('UT-S09-188: camelCase 与 snake_case 归一化为同一事件', () => {
    const camel = runtime.normalizeHookEvent({ sessionId: 's', hookEventName: 'PreToolUse', toolName: 'Write', toolInput: { file_path: 'a' } });
    const snake = runtime.normalizeHookEvent({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: 'a' } });
    expect(camel).toEqual(snake);
  });

  it('UT-S09-189: 冲突别名 fail-closed', () => {
    expect(() => runtime.normalizeHookEvent({ toolName: 'Write', tool_name: 'Edit' })).toThrow(/别名冲突/);
    const result = invoke(root, 'guard', { toolName: 'Write', tool_name: 'Edit' });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('UT-S09-190: SessionStart 输出当前 slug、阶段、范围、禁止动作与下一确认点', () => {
    const context = runtime.sessionContext(root);
    expect(context).toContain('active change: demo');
    expect(context).toContain('proposal_step: delta-writing');
    expect(context).toContain('允许范围');
    expect(context).toContain('禁止动作');
    expect(context).toContain('下一确认点');
    rmSync(join(root, 'logos', '.openlogos-guard'));
    expect(runtime.sessionContext(root)).toContain('active change: none');
  });

  it('UT-S09-191: delta-writing 仅放行当前 deltas 与 tasks.md', () => {
    expect(runtime.decideGuard(root, event('Write', { file_path: 'logos/changes/demo/deltas/spec/demo.md' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('Edit', { file_path: 'logos/changes/demo/tasks.md' }, root)).decision).toBe('allow');
    expect(runtime.decideGuard(root, event('Write', { file_path: 'src/index.ts' }, root)).decision).toBe('deny');
  });

  it('UT-S09-192: ready-to-merge 拒绝继续写 delta', () => {
    writeProject(root, { deltaChecked: true });
    const decision = runtime.decideGuard(root, event('Write', { file_path: 'logos/changes/demo/deltas/spec/demo.md' }, root));
    expect(decision).toMatchObject({ decision: 'deny' });
    expect(decision.reason).toContain('merge');
  });

  it('UT-S09-193: launched 项目缺 guard 时拒绝源码写入', () => {
    rmSync(join(root, 'logos', '.openlogos-guard'));
    const decision = runtime.decideGuard(root, event('Write', { file_path: 'src/index.ts' }, root));
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('openlogos change');
  });

  it('UT-S09-194: 路径与符号链接逃逸被拒绝', () => {
    const outside = mkdtempSync(join(tmpdir(), 'openlogos-zcode-outside-'));
    try {
      symlinkSync(outside, join(root, 'escape'));
      expect(() => runtime.resolveCandidate(root, 'escape/secret.txt')).toThrow(/越出项目根目录/);
      expect(existsSync(join(outside, 'secret.txt'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('UT-S09-195: 损坏 JSON 与字段类型错误输出合法 deny 并 exit 2', () => {
    for (const input of ['', '{bad', JSON.stringify({ toolName: 7, toolInput: [] })]) {
      const result = invoke(root, 'guard', input);
      expect(result.status).toBe(2);
      expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
      expect(result.stderr).toContain('OpenLogos ZCode Hook');
    }
  });

  it('UT-S09-196: 共享 allow/deny 决策映射为 ZCode permissionDecision', () => {
    expect(runtime.guardOutput({ decision: 'allow', reason: 'ok' })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'allow' },
    });
    expect(runtime.guardOutput({ decision: 'deny', reason: 'blocked' })).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'blocked' },
    });
  });

  it('UT-S09-197: stdout 只含单条协议 JSON，诊断只进入 stderr', () => {
    const result = invoke(root, 'guard', '{bad');
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(result.stdout).not.toContain('OpenLogos ZCode Hook:');
    expect(result.stderr).toContain('OpenLogos ZCode Hook:');
  });

  it('ST-S09-73: 新会话注入与磁盘 proposal_step 一致的 additionalContext', () => {
    const result = invoke(root, 'session', { sessionId: 's1', hookEventName: 'SessionStart', cwd: root });
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.hookSpecificOutput.additionalContext).toContain('proposal_step: delta-writing');
  });

  it('ST-S09-74: delta 写入允许而源码写入由 exit 2 阻断', () => {
    const source = join(root, 'src', 'index.ts');
    const before = readFileSync(source, 'utf8');
    const allowed = invoke(root, 'guard', event('Write', { file_path: 'logos/changes/demo/deltas/spec/demo.md' }, root));
    const blocked = invoke(root, 'guard', event('Write', { file_path: source }, root));
    expect(allowed.status).toBe(0);
    expect(blocked.status).toBe(2);
    expect(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(readFileSync(source, 'utf8')).toBe(before);
  });

  it('ST-S09-75: 同一 session 内阶段变化立即收紧且新上下文更新', () => {
    const target = 'logos/changes/demo/deltas/spec/demo.md';
    expect(runtime.decideGuard(root, event('Write', { file_path: target }, root)).decision).toBe('allow');
    writeProject(root, { deltaChecked: true });
    expect(runtime.decideGuard(root, event('Write', { file_path: target }, root)).decision).toBe('deny');
    expect(runtime.sessionContext(root)).toContain('proposal_step: ready-to-merge');
  });

  it('ST-S09-76: 运行时状态损坏时 fail-closed 且不执行写工具', () => {
    const source = join(root, 'src', 'index.ts');
    const before = readFileSync(source, 'utf8');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), '{bad');
    const result = invoke(root, 'guard', event('Write', { file_path: source }, root));
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(readFileSync(source, 'utf8')).toBe(before);
    expect(JSON.parse(readFileSync(join(repoRoot, 'plugin-zcode', 'hooks', 'hooks.json'), 'utf8'))).toBeTruthy();
  });
});
