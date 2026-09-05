import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const runtimePath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin-cursor', 'hooks', 'runtime.cjs');
const runtime = require(runtimePath) as typeof import('../../plugin-cursor/hooks/runtime.cjs');

type Step = 'writing' | 'ready-to-delta' | 'delta-writing' | 'ready-to-merge' | 'coding';

function spawnHook(mode: string, input: unknown, cwd: string) {
  const result = spawnSync(process.execPath, [runtimePath, mode], {
    cwd,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr };
}

describe('Cursor hooks runtime — S09 sessionStart 与部分强度门禁', () => {
  let root: string;

  function buildProject(step: Step | 'no-guard', slug = 'cursor-adapter-parity') {
    mkdirSync(join(root, 'logos'), { recursive: true });
    writeFileSync(join(root, 'logos', 'logos.config.json'), '{"name":"demo","locale":"zh"}');
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), 'modules:\n  - id: core\n    lifecycle: launched\n');
    if (step === 'no-guard') return;
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug }));
    const proposalDir = join(root, 'logos', 'changes', slug);
    mkdirSync(join(proposalDir, 'deltas'), { recursive: true });
    if (step === 'writing') return; // 无 proposal.md/tasks.md → writing
    writeFileSync(join(proposalDir, 'proposal.md'), '# p');
    const deltaChecked = step === 'ready-to-merge' ? 'x' : ' ';
    writeFileSync(join(proposalDir, 'tasks.md'),
      `# 实现任务\n\n## [delta] 规格变更\n- [${deltaChecked}] 产出 delta\n\n## [code] 代码实现\n- [ ] 单切片\n`);
    if (step === 'ready-to-delta') return;
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '{}');
    if (step === 'delta-writing' || step === 'ready-to-merge') return;
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '{"type":"merge_transaction_complete"}');
  }

  function shellEvent(command: string) {
    return { hook_event_name: 'beforeShellExecution', command, cwd: root };
  }

  function editEvent(filePath: string) {
    return { hook_event_name: 'afterFileEdit', file_path: filePath, cwd: root };
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cursor-runtime-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('UT-S09-293: sessionStart 输出 module/active change/proposal_step/可写范围/下一确认点，仅来源于磁盘事实', () => {
    buildProject('delta-writing');
    const { output, exitCode } = runtime.run('session', JSON.stringify({ hook_event_name: 'sessionStart', cwd: root }), root);
    expect(exitCode).toBe(0);
    const context = output.hookSpecificOutput.additionalContext as string;
    expect(context).toContain('lifecycle: launched');
    expect(context).toContain('active change: cursor-adapter-parity');
    expect(context).toContain('proposal_step: delta-writing');
    expect(context).toContain('允许范围');
    expect(context).toContain('下一确认点');
    expect(context).toContain(runtime.GUARD_STRENGTH_LINE);
  });

  it('UT-S09-294: CLI 不可用或项目未初始化时输出空对象，不报错、不注入伪状态', () => {
    const outside = mkdtempSync(join(tmpdir(), 'cursor-outside-'));
    try {
      const { output, exitCode } = runtime.run('session', JSON.stringify({ hook_event_name: 'sessionStart', cwd: outside }), outside);
      expect(exitCode).toBe(0);
      expect(output).toEqual({});
      const spawned = spawnHook('session', { hook_event_name: 'sessionStart', cwd: outside }, outside);
      expect(spawned.status).toBe(0);
      expect(JSON.parse(spawned.stdout)).toEqual({});
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('UT-S09-295: 提案范围内 shell 写入 allow；安全白名单（含 git push）语义与既有 guard 一致', () => {
    buildProject('coding');
    for (const command of ['npm test', 'git push', 'openlogos status', 'git status', 'npx vitest run']) {
      const { output, exitCode } = runtime.run('shell', JSON.stringify(shellEvent(command)), root);
      expect(exitCode, command).toBe(0);
      expect(output.permission, command).toBe('allow');
    }
    // coding 阶段命中写入模式的命令按步进范围放行
    const write = runtime.run('shell', JSON.stringify(shellEvent('mkdir -p src/new-module')), root);
    expect(write.output.permission).toBe('allow');
  });

  it('UT-S09-296: 越界 shell 写入 deny，原因含事实四要素与恢复动作，退出码 2', () => {
    buildProject('delta-writing');
    const { output, exitCode } = runtime.run('shell', JSON.stringify(shellEvent('rm -rf cli/src')), root);
    expect(exitCode).toBe(2);
    expect(output.permission).toBe('deny');
    for (const fact of ['Active change: cursor-adapter-parity', 'Proposal step: delta-writing', 'Allowed scope:', 'Target:', 'Next action:']) {
      expect(output.user_message).toContain(fact);
    }
    expect(output.agent_message).toBe(output.user_message);
  });

  it('UT-S09-297: afterFileEdit 越界产出含固定「未被阻断」声明的报告；范围内编辑静默', () => {
    buildProject('delta-writing');
    const outside = runtime.run('edit', JSON.stringify(editEvent('cli/src/lib/ai-tool-adapter.ts')), root);
    expect(outside.exitCode).toBe(0);
    expect(outside.output.agent_message).toContain('outside allowed scope');
    expect(outside.output.agent_message).toContain('cli/src/lib/ai-tool-adapter.ts');
    expect(outside.output.agent_message).toContain(runtime.EDIT_NOT_BLOCKED_LINE);
    const inside = runtime.run('edit', JSON.stringify(editEvent('logos/changes/cursor-adapter-parity/deltas/spec/x.md')), root);
    expect(inside.output).toEqual({});
  });

  it('UT-S09-298: 每次调用重读磁盘状态——proposal_step 变化后判定立即反映，无缓存', () => {
    buildProject('delta-writing');
    const denied = runtime.run('shell', JSON.stringify(shellEvent('mkdir -p src/x')), root);
    expect(denied.output.permission).toBe('deny');
    writeFileSync(join(root, 'logos/changes/cursor-adapter-parity/SPEC_MERGED'), '{}');
    const allowed = runtime.run('shell', JSON.stringify(shellEvent('mkdir -p src/x')), root);
    expect(allowed.output.permission).toBe('allow');
  });

  it('UT-S09-299: stdin 解析失败 fail-closed——shell deny 退出码 2，edit 产出「无法安全判断」报告', () => {
    buildProject('coding');
    const shell = spawnHook('shell', '{ not json', root);
    expect(shell.status).toBe(2);
    expect(JSON.parse(shell.stdout).permission).toBe('deny');
    const edit = spawnHook('edit', '{ not json', root);
    expect(edit.status).toBe(0);
    expect(JSON.parse(edit.stdout).agent_message).toContain('无法安全判断');
    expect(JSON.parse(edit.stdout).agent_message).toContain(runtime.EDIT_NOT_BLOCKED_LINE);
  });

  it('UT-S09-300: guard 缺失时 shell 写入 deny，提示先运行 openlogos change', () => {
    buildProject('no-guard');
    const { output, exitCode } = runtime.run('shell', JSON.stringify(shellEvent('rm -rf src')), root);
    expect(exitCode).toBe(2);
    expect(output.permission).toBe('deny');
    expect(output.user_message).toContain('openlogos change');
  });

  it('UT-S09-301: 决策状态损坏（guard 非法 JSON）fail-closed——shell deny、edit 报告，退出码不伪装成功', () => {
    buildProject('coding');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), '{ broken');
    const shell = spawnHook('shell', shellEvent('mkdir -p src/x'), root);
    expect(shell.status).toBe(2);
    expect(JSON.parse(shell.stdout).permission).toBe('deny');
    const edit = spawnHook('edit', editEvent('src/x.ts'), root);
    expect(edit.status).toBe(0);
    expect(JSON.parse(edit.stdout).agent_message).toContain('无法安全判断');
  });

  it('UT-S09-302: cursor 协议字段转换——permission 输出契约、事件名核验、snake/camel 别名冲突拒绝', () => {
    buildProject('coding');
    expect(runtime.shellOutput({ decision: 'allow', reason: 'x' })).toEqual({ permission: 'allow' });
    const deny = runtime.shellOutput({ decision: 'deny', reason: 'because' });
    expect(deny).toEqual({ permission: 'deny', user_message: 'because', agent_message: 'because' });
    expect(() => runtime.run('shell', JSON.stringify({ hook_event_name: 'sessionStart', command: 'ls', cwd: root }), root))
      .toThrow(/hook_event_name 必须为 beforeShellExecution/);
    expect(() => runtime.normalizeCursorEvent({ hook_event_name: 'afterFileEdit', file_path: 'a', filePath: 'b' }))
      .toThrow(/别名冲突/);
    // 三接线共用同一路径判定：shell 重定向目标与原生编辑同源
    rmSync(join(root, 'logos'), { recursive: true, force: true });
    buildProject('delta-writing');
    const state = runtime.readSessionState(root);
    const scopeShell = runtime.decidePathScope(root, state, 'cli/src/index.ts');
    const scopeEdit = runtime.decidePathScope(root, state, 'cli/src/index.ts');
    expect(scopeShell).toEqual(scopeEdit);
    expect(scopeShell.decision).toBe('deny');
  });

  it('ST-S09-112: 端到端——新 session 注入后越界 shell 写入被阻断且原因完整', () => {
    buildProject('delta-writing');
    const session = spawnHook('session', { hook_event_name: 'sessionStart', cwd: root }, root);
    expect(session.status).toBe(0);
    expect(JSON.parse(session.stdout).hookSpecificOutput.additionalContext).toContain('proposal_step: delta-writing');
    const denied = spawnHook('shell', shellEvent('rm -rf cli/src'), root);
    expect(denied.status).toBe(2);
    const output = JSON.parse(denied.stdout);
    expect(output.permission).toBe('deny');
    expect(output.user_message).toContain('Next action:');
  });

  it('ST-S09-113: 越界编辑事后检测——文件确已修改（未阻断）且报告如实声明', () => {
    buildProject('delta-writing');
    // 模拟宿主原生编辑已发生：afterFileEdit 是事后事件
    mkdirSync(join(root, 'cli', 'src'), { recursive: true });
    writeFileSync(join(root, 'cli', 'src', 'edited.ts'), 'mutated by host\n');
    const report = spawnHook('edit', editEvent('cli/src/edited.ts'), root);
    expect(report.status).toBe(0);
    const output = JSON.parse(report.stdout);
    expect(output.agent_message).toContain('cli/src/edited.ts');
    expect(output.agent_message).toContain('NOT blocked');
    expect(existsSync(join(root, 'cli', 'src', 'edited.ts'))).toBe(true);
  });

  it('ST-S09-114: proposal_step 收敛链路——writing/delta-writing/ready-to-merge/coding 下三接线判定一致收敛', () => {
    const slug = 'cursor-adapter-parity';
    const expectScope = (step: Step, path: string, decision: 'allow' | 'deny') => {
      buildProject(step);
      const state = runtime.readSessionState(root);
      expect(runtime.decidePathScope(root, state, path).decision, `${step}:${path}`).toBe(decision);
      rmSync(join(root, 'logos'), { recursive: true, force: true });
    };
    expectScope('ready-to-delta', `logos/changes/${slug}/proposal.md`, 'allow');
    expectScope('ready-to-delta', `logos/changes/${slug}/deltas/spec/x.md`, 'deny');
    expectScope('delta-writing', `logos/changes/${slug}/deltas/spec/x.md`, 'allow');
    expectScope('delta-writing', 'cli/src/index.ts', 'deny');
    expectScope('ready-to-merge', `logos/changes/${slug}/deltas/spec/x.md`, 'deny');
    expectScope('coding', 'cli/src/index.ts', 'allow');
    expectScope('delta-writing', `logos/changes/other-proposal/deltas/x.md`, 'deny');
  });

  it('ST-S09-115: 异常态全链 fail-closed——guard 不可读时 shell 全拒、编辑全报告，无静默放行', () => {
    buildProject('coding');
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'INVALID SLUG!!' }));
    const shell = spawnHook('shell', shellEvent('mkdir -p src/x'), root);
    expect(shell.status).toBe(2);
    expect(JSON.parse(shell.stdout).permission).toBe('deny');
    const edit = spawnHook('edit', editEvent('src/x.ts'), root);
    expect(edit.status).toBe(0);
    expect(JSON.parse(edit.stdout).agent_message).toContain('无法安全判断');
  });
});
