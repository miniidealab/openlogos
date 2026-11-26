/**
 * fix-claude-hook-windows-powershell-fallback 切片 3：SessionStart 阶段注入的项目根收敛（S09）。
 *
 * 覆盖 UT-S09-489、ST-S09-220（与 logos/resources/test/core-S09-test-cases.md 对齐；规则见功能规格 §2.105.6）。
 * UT 直接执行分发源 plugin/bin/openlogos-phase；ST 取 sync 实际生成的 settings.json 中的 SessionStart 命令，
 * 在真实 bash 中分别从项目根与 src/ 子目录执行。断言具体的项目名称与活跃提案 slug，不只检查退出码。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { init } from '../src/commands/init.js';
import { sync } from '../src/commands/sync.js';
import { captureConsole, makeTempRoot, mockCwd } from './helpers.js';

const PHASE_SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin', 'bin', 'openlogos-phase');
const PROJECT = 'phase-root-demo';
const SLUG = 'fix-phase-root';
const HOOK_INPUT = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's-1', source: 'startup' });

let root: string;
let cleanup: () => void;
beforeEach(() => { ({ root, cleanup } = makeTempRoot()); });
afterEach(() => { cleanup(); });

/** launched 项目 + 活跃提案 + src/ 子目录。 */
async function launchedProjectWithProposal(base: string): Promise<void> {
  const restore = mockCwd(base); const cap = captureConsole();
  try { await init(PROJECT, { locale: 'zh', aiTool: 'claude-code' }); } finally { cap.restore(); restore(); }
  const yaml = join(base, 'logos', 'logos-project.yaml');
  writeFileSync(yaml, readFileSync(yaml, 'utf-8').replace(/lifecycle: initial/g, 'lifecycle: launched'));
  mkdirSync(join(base, 'logos', 'changes', SLUG), { recursive: true });
  writeFileSync(join(base, 'logos', 'changes', SLUG, 'proposal.md'), `# 变更提案：${SLUG}\n`);
  writeFileSync(join(base, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  mkdirSync(join(base, 'src'), { recursive: true });
}

function runBash(args: string[], cwd: string, projectDir: string | null): { exit: number; stdout: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  if (projectDir !== null) env.CLAUDE_PROJECT_DIR = projectDir;
  const r = spawnSync('bash', args, { cwd, env, input: HOOK_INPUT, encoding: 'utf-8', timeout: 30_000 });
  return { exit: r.status ?? -1, stdout: r.stdout ?? '' };
}

describe('S09 SessionStart 阶段注入的项目根收敛', () => {
  it('UT-S09-489: openlogos-phase 项目根收敛', async () => {
    await launchedProjectWithProposal(root);
    const sub = join(root, 'src');
    // ① 项目根、不设变量（基准）
    const atRoot = runBash([PHASE_SRC], root, null);
    expect(atRoot.exit).toBe(0);
    expect(atRoot.stdout).toContain(PROJECT);
    expect(atRoot.stdout).toContain(SLUG);
    // ② 子目录 + 变量指向项目根 → 与 ① 逐字节相同
    const fromSub = runBash([PHASE_SRC], sub, root);
    expect(fromSub.exit).toBe(0);
    expect(fromSub.stdout).toBe(atRoot.stdout);
    // ③ 变量指向不存在的目录 → 说明并 exit 0（EX-HB-S09-4）
    const bad = runBash([PHASE_SRC], root, join(root, 'no-such-dir'));
    expect(bad.exit).toBe(0);
    expect(JSON.parse(bad.stdout)).toEqual({ systemMessage: 'OpenLogos: cannot enter CLAUDE_PROJECT_DIR; phase context not injected' });
    // ④ 子目录、不设变量 → 维持既有行为（EX-HB-S09-5）
    const noVar = runBash([PHASE_SRC], sub, null);
    expect(noVar.exit).toBe(0);
    expect(JSON.parse(noVar.stdout)).toEqual({ systemMessage: 'Not an OpenLogos project' });
    // ⑤ --plain：子目录 + 变量 与项目根输出相同；无法进入时输出等价文本
    const plainRoot = runBash([PHASE_SRC, '--plain'], root, null);
    expect(runBash([PHASE_SRC, '--plain'], sub, root).stdout).toBe(plainRoot.stdout);
    expect(plainRoot.stdout).toContain(PROJECT);
    const plainBad = runBash([PHASE_SRC, '--plain'], root, join(root, 'no-such-dir'));
    expect(plainBad.exit).toBe(0);
    expect(plainBad.stdout).toContain('cannot enter CLAUDE_PROJECT_DIR; phase context not injected');
  });

  it('ST-S09-220: 子目录会话的阶段注入', async () => {
    await launchedProjectWithProposal(root);
    const restore = mockCwd(root); const cap = captureConsole();
    try { sync(); } finally { cap.restore(); restore(); }
    const hooks = (JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8')) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    }).hooks;
    const command = hooks.SessionStart.flatMap(g => g.hooks.map(h => h.command))
      .find(c => c.includes('.claude/openlogos/bin/openlogos-phase'))!;
    expect(command).toBe('"$CLAUDE_PROJECT_DIR"/.claude/openlogos/bin/openlogos-phase');
    const atRoot = runBash(['-c', command], root, root);
    const fromSub = runBash(['-c', command], join(root, 'src'), root);
    expect(atRoot.exit).toBe(0);
    expect(fromSub.exit).toBe(0);
    expect(fromSub.stdout).toBe(atRoot.stdout);
    expect(fromSub.stdout).toContain(PROJECT);
    expect(fromSub.stdout).toContain(SLUG);
    expect(fromSub.stdout).not.toContain('Not an OpenLogos project');
  });
});
