/**
 * UT-S09-407 夹具：qoder / workbuddy / zcode 三宿主 hook 入口的重放输入集与执行器。
 *
 * 输入集覆盖 UT-S09-190～201 起始的既有矩阵（SessionStart 上下文、delta-writing allowlist、ready-to-merge 收紧、
 * 缺 guard 阻断、路径逃逸、损坏 JSON、输出映射），并追加 `npm ci` 与 `openlogos exempt add src/`。
 * 基准由修改前实现（生成器 fixtures/gen-s09-other-hosts-baseline.ts）对同一输入集实测生成并入库，测试内不复述期望。
 * 本模块不得 import vitest，供基准生成器复用。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, buildProject, cleanEnv } from './s09-guard-vcs-fixtures.js';

export const OTHER_HOST_BASELINE_FILE = join(REPO_ROOT, 'cli', 'test', 'fixtures', 's09-other-hosts-baseline.json');

/** 三宿主 hook 入口（仓库内分发源）；guard 模式为 PreToolUse，session 模式为 SessionStart。 */
export const OTHER_HOSTS: Record<'qoder' | 'workbuddy' | 'zcode', string> = {
  qoder: 'plugin-qoder/hooks/runtime.cjs',
  workbuddy: 'plugin-workbuddy/hooks/runtime.cjs',
  zcode: 'plugin-zcode/runtime/hook-runtime.js',
};

export type HostState = 'no-guard' | 'delta-writing' | 'ready-to-merge';
export const HOST_STATES: HostState[] = ['no-guard', 'delta-writing', 'ready-to-merge'];

export interface HostInput { key: string; mode: 'session' | 'guard'; input: unknown }

const pre = (toolName: string, toolInput: Record<string, unknown>) =>
  ({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput, cwd: '<ROOT>' });

export const HOST_INPUTS: HostInput[] = [
  { key: 'SessionStart', mode: 'session', input: { session_id: 's', hook_event_name: 'SessionStart', cwd: '<ROOT>', source: 'startup' } },
  { key: 'Write delta', mode: 'guard', input: pre('Write', { file_path: 'logos/changes/demo/deltas/spec/x.md', content: 'x' }) },
  { key: 'Edit tasks.md', mode: 'guard', input: pre('Edit', { file_path: 'logos/changes/demo/tasks.md', old_string: 'a', new_string: 'b' }) },
  { key: 'Write src/a.js', mode: 'guard', input: pre('Write', { file_path: 'src/a.js', content: 'x' }) },
  { key: 'Write other proposal', mode: 'guard', input: pre('Write', { file_path: 'logos/changes/other/tasks.md', content: 'x' }) },
  { key: 'Write escape', mode: 'guard', input: pre('Write', { file_path: '../outside.txt', content: 'x' }) },
  { key: 'Write .gitignore', mode: 'guard', input: pre('Write', { file_path: '.gitignore', content: 'x' }) },
  { key: 'Write reference', mode: 'guard', input: pre('Write', { file_path: 'logos/resources/reference/a.md', content: 'x' }) },
  { key: 'Bash npm ci', mode: 'guard', input: pre('Bash', { command: 'npm ci' }) },
  { key: 'Bash openlogos exempt add src/', mode: 'guard', input: pre('Bash', { command: 'openlogos exempt add src/' }) },
  { key: 'Bash git status', mode: 'guard', input: pre('Bash', { command: 'git status' }) },
  { key: 'Bash echo > src/a.js', mode: 'guard', input: pre('Bash', { command: 'echo x > src/a.js' }) },
  { key: 'Bash rm -rf src', mode: 'guard', input: pre('Bash', { command: 'rm -rf src' }) },
  { key: 'broken JSON', mode: 'guard', input: '{ not json' },
  { key: 'empty input', mode: 'guard', input: '' },
];

/** G-repo 夹具 + 提案状态（guard 文件与提案目录不入库）。 */
export function buildHostProject(root: string, state: HostState): string {
  buildProject(root, 'G-repo');
  if (state === 'no-guard') return root;
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'demo' }));
  const dir = join(root, 'logos', 'changes', 'demo');
  mkdirSync(join(dir, 'deltas'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '# p\n');
  writeFileSync(join(dir, 'tasks.md'),
    `# 实现任务\n\n## [delta] 规格变更\n- [${state === 'ready-to-merge' ? 'x' : ' '}] 产出 delta\n\n## [code] 代码实现\n- [ ] 单切片\n`);
  writeFileSync(join(dir, 'PLAN_APPROVED'), '{}');
  return root;
}

export interface HostRun { exit: number; stdout: string }

/** 以宿主 hook 入口重放一条输入：stdout 中的项目根替换为 `<ROOT>`，便于跨临时目录比较。 */
export function runHost(entry: string, root: string, item: HostInput): HostRun {
  const raw = typeof item.input === 'string' ? item.input : JSON.stringify(item.input).split('<ROOT>').join(root);
  const r = spawnSync(process.execPath, [entry, item.mode], {
    cwd: root, input: raw, encoding: 'utf-8', timeout: 20_000, env: cleanEnv(),
  });
  const stdout = (r.stdout ?? '').split(root).join('<ROOT>').trim();
  return { exit: r.status ?? 1, stdout };
}
