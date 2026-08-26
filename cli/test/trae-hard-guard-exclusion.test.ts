import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { aiToolAdapterRegistry, parseRegisteredAiTool } from '../src/lib/ai-tool-adapter.js';
import { makeTempRoot } from './helpers.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workBuddyRuntimePath = join(repoRoot, 'plugin-workbuddy', 'hooks', 'runtime.cjs');
const require = createRequire(import.meta.url);
const runtime = require(workBuddyRuntimePath) as {
  decideGuard(root: string, event: Record<string, unknown>): { decision: string; reason: string };
  normalizeHookEvent(input: Record<string, unknown>): Record<string, unknown>;
  sessionContext(root: string): string;
};

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function writeProject(root: string, phase: 'writing' | 'delta-writing' | 'ready-to-merge' = 'delta-writing'): void {
  const proposal = join(root, 'logos', 'changes', 'demo');
  mkdirSync(join(proposal, 'deltas', 'spec'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ name: 'demo', locale: 'zh' }));
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), 'modules:\n  - id: core\n    lifecycle: launched\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'demo', module: 'core' }));
  writeFileSync(join(root, 'src', 'index.ts'), 'export const value = 1;\n');
  writeFileSync(join(proposal, 'proposal.md'), '# 提案\n');
  writeFileSync(join(proposal, 'tasks.md'), [
    '# 实现任务',
    '## [delta] 规格变更',
    `- [${phase === 'ready-to-merge' ? 'x' : ' '}] [MODIFY] deltas/spec/demo.md`,
    '## [code] 代码实现',
    '- [ ] 实现功能',
    '',
  ].join('\n'));
  if (phase === 'writing') {
    const marker = join(proposal, 'PLAN_APPROVED');
    rmSync(marker, { force: true });
    rmSync(join(proposal, 'tasks.md'), { force: true });
  } else {
    writeFileSync(join(proposal, 'PLAN_APPROVED'), '');
  }
}

function writeTraeAssets(root: string): Map<string, string> {
  const values = new Map<string, Buffer>([
    ['.trae/hooks.json', Buffer.from('{"hooks":{"PreToolUse":[{"command":"node .trae/wrapper.cjs"}]}}\n')],
    ['.trae/rules/project.md', Buffer.from('# 用户规则\n')],
    ['.trae/skills/local/SKILL.md', Buffer.from('# 用户技能\n')],
    ['.trae/agents/reviewer.md', Buffer.from('# 用户 Agent\n')],
    ['.trae/mcp.json', Buffer.from('{"servers":{}}\n')],
    ['.trae/settings.json', Buffer.from('{"account":"user"}\n')],
    ['.trae/enabled_folders', Buffer.from('/user/workspace\n')],
    ['.trae/native-memory.bin', Buffer.from([0, 255, 8, 4])],
  ]);
  for (const [relative, bytes] of values) {
    const target = join(root, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return assetHashes(root);
}

function assetHashes(root: string): Map<string, string> {
  const hashes = new Map<string, string>();
  const base = join(root, '.trae');
  function walk(dir: string, prefix = '') {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relative);
      else hashes.set(relative, sha256(readFileSync(full)));
    }
  }
  walk(base);
  return hashes;
}

function event(toolName: string, toolInput: Record<string, unknown>, root: string) {
  return { hookEventName: 'PreToolUse', toolName, toolInput, cwd: root };
}

function wireEvent(toolName: string, toolInput: Record<string, unknown>, root: string) {
  return { hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, cwd: root };
}

function invokeWorkBuddy(root: string, input: unknown) {
  return spawnSync(process.execPath, [workBuddyRuntimePath, 'guard'], {
    cwd: root,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
  });
}

describe('TRAE hard guard 非适配闭环 — S09', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    writeProject(root);
  });

  afterEach(() => cleanup());

  it('UT-S09-219: 真实 Registry 与 normalizer 映射均不存在 TRAE', () => {
    const hardGuardIds = aiToolAdapterRegistry.list({ deployableOnly: true })
      .filter(item => item.capabilities.preToolUse)
      .map(item => item.id);
    expect(hardGuardIds).toEqual(['qoder', 'workbuddy']);
    expect(parseRegisteredAiTool('trae')).toBeUndefined();
    expect(existsSync(join(repoRoot, 'plugin-trae'))).toBe(false);
    expect(runtime.normalizeHookEvent({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'a' },
      cwd: root,
    })).toMatchObject({ hookEventName: 'PreToolUse', toolName: 'Write' });
  });

  it('UT-S09-220: 仅发现软控制资产不会注册 capability 或调用 guard', () => {
    writeTraeAssets(root);
    const marker = join(root, '.trae', 'wrapper-called');
    writeFileSync(join(root, '.trae', 'wrapper.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'called');\n`);
    expect(aiToolAdapterRegistry.has('trae')).toBe(false);
    expect(runtime.sessionContext(root)).toContain('active change: demo');
    expect(existsSync(marker)).toBe(false);
  });

  it('UT-S09-221: enabled_folders 缺失、存在或冲突都不是授权输入', () => {
    const enabledFolders = join(root, '.trae', 'enabled_folders');
    mkdirSync(dirname(enabledFolders), { recursive: true });
    for (const value of [null, '/workspace/a\n', '/workspace/a\n/workspace/b\n']) {
      if (value === null) {
        if (existsSync(enabledFolders)) writeFileSync(enabledFolders, '');
      } else {
        writeFileSync(enabledFolders, value);
      }
      const before = existsSync(enabledFolders) ? sha256(readFileSync(enabledFolders)) : null;
      expect(aiToolAdapterRegistry.has('trae')).toBe(false);
      expect(runtime.decideGuard(root, event('Read', { file_path: 'src/index.ts' }, root)).decision).toBe('allow');
      expect(existsSync(enabledFolders) ? sha256(readFileSync(enabledFolders)) : null).toBe(before);
    }
  });

  it('UT-S09-222: TRAE Hooks、Rules、Skills、Agents、MCP、settings、账号与记忆零触达', () => {
    const before = writeTraeAssets(root);
    aiToolAdapterRegistry.list({ deployableOnly: true });
    parseRegisteredAiTool('trae');
    runtime.sessionContext(root);
    expect(assetHashes(root)).toEqual(before);
  });

  it('UT-S09-223: 已支持宿主每次重读并保持 fail-closed 合同', () => {
    const target = join(root, 'src', 'index.ts');
    const before = sha256(readFileSync(target));
    const denied = invokeWorkBuddy(root, wireEvent('Write', { file_path: 'src/index.ts' }, root));
    expect(denied.status).toBe(2);
    const output = JSON.parse(denied.stdout).hookSpecificOutput;
    expect(output.permissionDecision).toBe('deny');
    expect(output.permissionDecisionReason).toBeTruthy();
    expect(sha256(readFileSync(target))).toBe(before);

    const delta = 'logos/changes/demo/deltas/spec/demo.md';
    expect(runtime.decideGuard(root, event('Write', { file_path: delta }, root)).decision).toBe('allow');
    writeProject(root, 'ready-to-merge');
    expect(runtime.decideGuard(root, event('Write', { file_path: delta }, root)).decision).toBe('deny');
  });

  it('ST-S09-85: wrapper 直调返回 deny 也不会产生 TRAE capability PASS', () => {
    const wrapper = join(root, '.trae', 'wrapper.cjs');
    mkdirSync(dirname(wrapper), { recursive: true });
    writeFileSync(wrapper, "process.stdout.write(JSON.stringify({decision:'deny',reason:'fixture'})); process.exitCode=2;\n");
    const result = spawnSync(process.execPath, [wrapper], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toEqual({ decision: 'deny', reason: 'fixture' });
    expect(aiToolAdapterRegistry.has('trae')).toBe(false);
    expect(parseRegisteredAiTool('trae')).toBeUndefined();
  });

  it('ST-S09-86: 生命周期跨三阶段时 TRAE 外部资产清单与 SHA-256 始终不变', () => {
    const before = writeTraeAssets(root);
    for (const [phase, expected] of [
      ['writing', 'proposal_step: writing'],
      ['delta-writing', 'proposal_step: delta-writing'],
      ['ready-to-merge', 'proposal_step: ready-to-merge'],
    ] as const) {
      writeProject(root, phase);
      expect(runtime.sessionContext(root)).toContain(expected);
      expect(assetHashes(root)).toEqual(before);
    }
  });

  it('ST-S09-87: 现有宿主允许写与多类拒绝保持协议、退出码和哈希合同', () => {
    const delta = 'logos/changes/demo/deltas/spec/demo.md';
    const allowed = invokeWorkBuddy(root, wireEvent('Write', { file_path: delta }, root));
    expect(allowed.status).toBe(0);
    expect(JSON.parse(allowed.stdout).hookSpecificOutput.permissionDecision).toBe('allow');
    writeFileSync(join(root, delta), '# 已允许的 delta\n');
    expect(readFileSync(join(root, delta), 'utf8')).toBe('# 已允许的 delta\n');

    const source = join(root, 'src', 'index.ts');
    const before = sha256(readFileSync(source));
    for (const input of [
      wireEvent('Write', { file_path: 'src/index.ts' }, root),
      wireEvent('write_to_file', { path: 'logos/changes/other/tasks.md' }, root),
      '{bad',
    ]) {
      const denied = invokeWorkBuddy(root, input);
      expect(denied.status).toBe(2);
      const output = JSON.parse(denied.stdout).hookSpecificOutput;
      expect(output.permissionDecision).toBe('deny');
      expect(output.permissionDecisionReason).toBeTruthy();
      expect(sha256(readFileSync(source))).toBe(before);
    }
  });
});
