/**
 * module-lifecycle-guard 共用夹具（S09-H）：混合生命周期项目、写入输入矩阵与五宿主执行器。
 *
 * 口径见 logos/resources/test/core-S09-test-cases.md「S09 guard 按模块生命周期判定测试」夹具口径。
 * 本模块不得 import vitest，供零回归基准生成器（fixtures/gen-s09-module-lifecycle-baseline.ts）复用。
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, cleanEnv, git } from './s09-guard-vcs-fixtures.js';

export const MLG_BASELINE_FILE = join(REPO_ROOT, 'cli', 'test', 'fixtures', 's09-module-lifecycle-baseline.json');
export const MLG_VECTOR_FILE = join(REPO_ROOT, 'plugin', 'test-vectors', 'guard-module-lifecycle.json');

export type MlgKind =
  | 'M-repo' | 'M-shared' | 'M-nopaths' | 'M-prefix' | 'M-nogit'
  | 'M-gitignore-team' | 'M-ignored-spec' | 'M-build' | 'M-badyaml'
  | 'M-lc-missing' | 'M-lc-Initial' | 'M-lc-draft'
  | 'M-variant-quoted' | 'M-variant-crlf' | 'M-variant-block' | 'M-invalid-paths'
  | 'M-alias' | 'M-escape' | 'M-escape-ok' | 'M-nonstring' | 'M-scalar-paths' | 'M-block-id'
  | 'A-initial' | 'A-launched';

export type MlgState = 'none' | 'plan' | 'delta-writing' | 'ready-to-merge';

interface ModuleSpec { id: string; lifecycle?: string; paths?: string[] }

const SCENARIOS = '  - id: S01\n    name: Login\n    module: core\n  - id: S44\n    name: Seats\n    module: team\n  - id: S45\n    name: Misc\n';

function flow(paths: string[]): string {
  return `[${paths.map(p => JSON.stringify(p)).join(', ')}]`;
}

function moduleYaml(mods: ModuleSpec[]): string {
  let out = 'modules:\n';
  for (const m of mods) {
    out += `  - id: ${m.id}\n    name: ${m.id}\n`;
    if (m.lifecycle !== undefined) out += `    lifecycle: ${m.lifecycle}\n`;
    if (m.paths) out += `    paths: ${flow(m.paths)}\n`;
  }
  return out;
}

/** 各夹具的 logos-project.yaml 原文。 */
export function projectYaml(kind: MlgKind): string {
  const head = 'project:\n  name: "m"\n';
  const core: ModuleSpec = { id: 'core', lifecycle: 'launched', paths: ['src/**'] };
  const team: ModuleSpec = { id: 'team', lifecycle: 'initial', paths: ['team/**'] };
  const std = (mods: ModuleSpec[]) => `${head}${moduleYaml(mods)}scenarios:\n${SCENARIOS}`;
  switch (kind) {
    case 'M-shared':
      return std([{ ...core, paths: ['src/**', 'shared/**'] }, { ...team, paths: ['team/**', 'shared/**'] }]);
    case 'M-nopaths':
      return std([core, { id: 'team', lifecycle: 'initial' }]);
    case 'M-prefix':
      return std([core, team, { id: 'core-api', lifecycle: 'initial' }]);
    case 'M-badyaml':
      // team 的 paths 流式数组未闭合：子集解析器判为不可解析，整份不做按文件判定
      return `${head}modules:\n  - id: core\n    name: core\n    lifecycle: launched\n    paths: ["src/**"]\n  - id: team\n    name: team\n    lifecycle: initial\n    paths: ["team/**"\nscenarios:\n${SCENARIOS}`;
    case 'M-lc-missing':
      return std([core, { id: 'team', paths: ['team/**'] }]);
    case 'M-lc-Initial':
      return std([core, { ...team, lifecycle: 'Initial' }]);
    case 'M-lc-draft':
      return std([core, { ...team, lifecycle: 'draft' }]);
    case 'M-variant-quoted':
      return `${head}modules:\n  - id: "core"\n    name: core\n    lifecycle: 'launched'\n    paths: ['src/**']  # 代码目录\n  - id: 'team'\n    name: team\n    lifecycle: "initial"   # 尚未上线\n    paths: ["team/**"]\nscenarios:\n  - id: "S44"\n    name: Seats\n    module: 'team'\n`;
    case 'M-variant-crlf':
      return std([core, team]).replace(/\n/g, '\r\n');
    case 'M-variant-block':
      return `${head}modules:\n- id: core\n  name: core\n  lifecycle: launched\n  paths:\n  - "src/**"\n- id: team\n  name: team\n  lifecycle: initial\n  paths:\n    - team/**\n    - 'tools/team/**'\nscenarios:\n- id: S44\n  name: Seats\n  module: team\n`;
    case 'M-invalid-paths':
      return std([core, { ...team, paths: ['/abs', '../x', '', 'team/**'] }]);
    // code-r1 F1：解析成功却丢失 launched 路径 / 未解码转义 / 非字符串条目的反例
    case 'M-alias':
      return `${head}shared_paths: &shared ["shared/**"]\nmodules:\n  - id: core\n    lifecycle: launched\n    paths: *shared\n  - id: team\n    lifecycle: initial\n    paths: ["shared/**"]\n`;
    case 'M-escape':
      return `${head}modules:\n  - id: core\n    lifecycle: launched\n    paths: ["shared/\\u002a\\u002a"]\n  - id: team\n    lifecycle: initial\n    paths: ["shared/**"]\n`;
    case 'M-escape-ok':
      return `${head}modules:\n  - id: core\n    lifecycle: launched\n    paths: ["src/**"]\n  - id: team\n    lifecycle: initial\n    paths: ["team/**", "a\\\\b/**", "q\\"x/**"]\n`;
    case 'M-nonstring':
      return `${head}modules:\n  - id: core\n    lifecycle: launched\n    paths: ["src/**"]\n  - id: team\n    lifecycle: initial\n    paths: [123, true, "team/**"]\n  - id: 7\n    lifecycle: initial\n    paths: ["seven/**"]\n`;
    case 'M-scalar-paths':
      return `${head}modules:\n  - id: core\n    lifecycle: launched\n    paths: ["src/**"]\n  - id: team\n    lifecycle: initial\n    paths: team/**\n`;
    case 'M-block-id':
      return `${head}modules:\n  - id: core\n    lifecycle: launched\n    paths: ["src/**"]\n  - id: |\n      team\n    lifecycle: initial\n    paths: ["team/**"]\n`;
    case 'A-initial':
      return std([{ ...core, lifecycle: 'initial' }, team]);
    case 'A-launched':
      return std([core, { ...team, lifecycle: 'launched' }]);
    default:
      return std([core, team]);
  }
}

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function mustGit(root: string, args: string[]): void {
  const r = git(root, args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
}

/** 构造夹具项目（mkdtemp 目录由调用方提供）；M-nogit 不 git init，其余完成一次初始提交。 */
export function buildMlgProject(root: string, kind: MlgKind): string {
  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ name: 'm', locale: 'zh', description: '', documents: {} }, null, 2));
  for (const d of ['logos/resources/test', 'logos/resources/verify', 'logos/changes/archive']) mkdirSync(join(root, d), { recursive: true });
  put(root, 'logos/logos-project.yaml', projectYaml(kind));
  let ignore = 'node_modules/\ndist/\nlogos/.openlogos-runtime/\n';
  if (kind === 'M-ignored-spec') ignore += 'logos/resources/prd/1-product-requirements/core-02-private.md\n';
  if (kind === 'M-build') ignore += 'team/build/\n';
  put(root, '.gitignore', ignore);
  put(root, 'README.md', '# m\n');
  put(root, 'src/main.ts', 'export const main = 1;\n');
  put(root, 'team/app.ts', 'export const app = 1;\n');
  put(root, 'team/src/a.ts', 'export const a = 1;\n');
  put(root, 'scripts/release.sh', 'echo release\n');
  put(root, 'shared/protocol.ts', 'export const p = 1;\n');
  put(root, 'logos/resources/prd/1-product-requirements/core-01-requirements.md', '# core\n');
  put(root, 'logos/resources/prd/1-product-requirements/team-01-requirements.md', '# team\n');
  put(root, 'logos/resources/api/S44-seats.yaml', 'openapi: 3.0.0\n');
  put(root, 'logos/resources/api/S01-login.yaml', 'openapi: 3.0.0\n');
  if (kind === 'M-gitignore-team') put(root, 'team/.gitignore', '*.log\n');
  if (kind !== 'M-nogit') {
    mustGit(root, ['init', '-q']);
    mustGit(root, ['config', 'user.name', 'openlogos-test']);
    mustGit(root, ['config', 'user.email', 'openlogos-test@example.invalid']);
    mustGit(root, ['config', 'commit.gpgsign', 'false']);
    mustGit(root, ['add', '-A']);
    mustGit(root, ['commit', '-qm', 'init']);
  }
  if (kind === 'M-ignored-spec') put(root, 'logos/resources/prd/1-product-requirements/core-02-private.md', '# private\n');
  if (kind === 'M-build') put(root, 'team/build/out.bin', 'bin\n');
  return root;
}

/** 活跃提案（归属 core 的 core-x）：plan = 无 PLAN_APPROVED；delta-writing / ready-to-merge = 有 PLAN_APPROVED。 */
export function withProposal(root: string, state: MlgState): string {
  if (state === 'none') return root;
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'core-x' }));
  const dir = join(root, 'logos', 'changes', 'core-x');
  mkdirSync(join(dir, 'deltas'), { recursive: true });
  writeFileSync(join(dir, 'proposal.md'), '# 变更提案：core-x\n\n> module: core\n');
  writeFileSync(join(dir, 'tasks.md'),
    `# 实现任务\n\n## [delta] 规格变更\n- [${state === 'ready-to-merge' ? 'x' : ' '}] 产出 delta\n\n## [code] 代码实现\n- [ ] 单切片\n`);
  if (state !== 'plan') writeFileSync(join(dir, 'PLAN_APPROVED'), '{}');
  return root;
}

export interface MlgInput { key: string; tool: string; input: Record<string, unknown> }

const W = (key: string, tool: string, file: string): MlgInput =>
  ({ key, tool, input: tool === 'NotebookEdit' ? { notebook_path: file, new_source: 'x' } : tool === 'Edit' ? { file_path: file, old_string: 'a', new_string: 'b' } : tool === 'MultiEdit' ? { file_path: file, edits: [] } : { file_path: file, content: 'x' } });
const B = (key: string, command: string): MlgInput => ({ key, tool: 'Bash', input: { command } });

/** UT-S09-469～475 的写入输入矩阵（键名稳定，基准按键比对）。 */
export const MLG_INPUTS: MlgInput[] = [
  W('Write team spec', 'Write', 'logos/resources/prd/1-product-requirements/team-01-requirements.md'),
  W('Edit team/app.ts', 'Edit', 'team/app.ts'),
  W('MultiEdit S44 api', 'MultiEdit', 'logos/resources/api/S44-seats.yaml'),
  W('NotebookEdit team/n.ipynb', 'NotebookEdit', 'team/n.ipynb'),
  W('Write src/main.ts', 'Write', 'src/main.ts'),
  W('Write core spec', 'Write', 'logos/resources/prd/1-product-requirements/core-01-requirements.md'),
  W('Write scripts/release.sh', 'Write', 'scripts/release.sh'),
  W('Write shared/protocol.ts', 'Write', 'shared/protocol.ts'),
  W('Write team/.gitignore', 'Write', 'team/.gitignore'),
  W('Write runtime state', 'Write', 'logos/.openlogos-runtime/x'),
  W('Write logos.config.json', 'Write', 'logos/logos.config.json'),
  W('Write core-x delta', 'Write', 'logos/changes/core-x/deltas/prd/1-product-requirements/core-01-requirements.md'),
  B('Bash echo > team/app.ts', 'echo x > team/app.ts'),
  B('Bash rm team/app.ts', 'rm team/app.ts'),
  B('Bash cp README team spec', 'cp README.md logos/resources/prd/1-product-requirements/team-02-x.md'),
  B('Bash team && src', 'echo x > team/c.ts && echo y > src/main.ts'),
  B('Bash echo > src/main.ts', 'echo x > src/main.ts'),
  B('Bash node -e team/b.ts', "node -e \"require('fs').writeFileSync('team/b.ts','x')\""),
  B('Bash rm $VAR', 'rm $VAR'),
  B('Bash rm -rf team/src', 'rm -rf team/src'),
  B('Bash rm -rf team', 'rm -rf team'),
  B('Bash rm -rf logos/resources/prd', 'rm -rf logos/resources/prd'),
  B('Bash rm -rf 1-product-requirements', 'rm -rf logos/resources/prd/1-product-requirements'),
  B('Bash rm -rf team/build', 'rm -rf team/build'),
  B('Bash openlogos exempt add team/', 'openlogos exempt add team/'),
  B('Bash openlogos approve', 'openlogos approve --env prod --ref v1'),
];

export const MLG_HOSTS = ['claude', 'cursor', 'qoder', 'workbuddy', 'zcode'] as const;
export type MlgHost = typeof MLG_HOSTS[number];

/** 各宿主分发源（相对仓库根）；基准生成器以修改前提交的同名文件按同一布局重建。 */
export const MLG_HOST_FILES: Record<MlgHost, string[]> = {
  claude: ['plugin/bin/guard-check', 'plugin/bin/guard-post-check.cjs'],
  cursor: ['plugin-cursor/hooks/runtime.cjs', 'plugin/bin/guard-post-check.cjs'],
  qoder: ['plugin-qoder/hooks/runtime.cjs'],
  workbuddy: ['plugin-workbuddy/hooks/runtime.cjs'],
  zcode: ['plugin-zcode/runtime/hook-runtime.js'],
};

export interface MlgRun { exit: number; stdout: string }

function normalize(text: string, root: string): string {
  let out = text;
  for (const r of [realpathSync(root), root]) out = out.split(r).join('<ROOT>');
  return out.trim();
}

/** 以 base（仓库根或基准生成器的旧版布局根）下的宿主入口执行一条输入。 */
export function runMlgHost(base: string, host: MlgHost, root: string, item: MlgInput): MlgRun {
  const env = cleanEnv({ CLAUDE_PROJECT_DIR: root });
  let r;
  if (host === 'claude') {
    r = spawnSync('bash', [join(base, 'plugin/bin/guard-check')], {
      input: JSON.stringify({ tool_name: item.tool, tool_input: item.input, permission_mode: 'default', tool_use_id: `t-${item.key}` }),
      cwd: root, encoding: 'utf-8', timeout: 60_000, env,
    });
  } else if (host === 'cursor') {
    const entry = join(base, 'plugin-cursor/hooks/runtime.cjs');
    const isShell = item.tool === 'Bash';
    const event = isShell
      ? { hook_event_name: 'beforeShellExecution', command: item.input.command, cwd: root, conversation_id: 'c' }
      : { hook_event_name: 'afterFileEdit', file_path: (item.input.file_path ?? item.input.notebook_path), cwd: root, conversation_id: 'c' };
    r = spawnSync(process.execPath, [entry, isShell ? 'shell' : 'edit'], { input: JSON.stringify(event), cwd: root, encoding: 'utf-8', timeout: 60_000, env });
  } else {
    const entry = join(base, MLG_HOST_FILES[host][0]);
    r = spawnSync(process.execPath, [entry, 'guard'], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: item.tool, tool_input: item.input, cwd: root }),
      cwd: root, encoding: 'utf-8', timeout: 60_000, env,
    });
  }
  return { exit: r.status ?? 1, stdout: normalize(r.stdout ?? '', root) };
}

/** 零回归基准覆盖的组合：UT-S09-470（三阶段）、471、474、475 ④ 与 477（A-initial / A-launched）。 */
export const MLG_BASELINE_COMBOS: Array<{ kind: MlgKind; state: MlgState }> = [
  { kind: 'M-repo', state: 'none' },
  { kind: 'M-repo', state: 'plan' },
  { kind: 'M-repo', state: 'delta-writing' },
  { kind: 'M-repo', state: 'ready-to-merge' },
  { kind: 'M-nogit', state: 'none' },
  { kind: 'M-badyaml', state: 'none' },
  { kind: 'A-initial', state: 'none' },
  { kind: 'A-initial', state: 'delta-writing' },
  { kind: 'A-launched', state: 'none' },
  { kind: 'A-launched', state: 'delta-writing' },
];

export interface MlgBaselineCase { host: MlgHost; kind: MlgKind; state: MlgState; key: string; exit: number; stdout: string }

export function baselineKey(c: { host: string; kind: string; state: string; key: string }): string {
  return `${c.host}|${c.kind}|${c.state}|${c.key}`;
}

/** 清除单次判定留下的运行态（执行记录、待报告项、Cursor 报告日志），使同一夹具上的各输入互不影响。 */
export function resetRuntime(root: string): void {
  rmSync(join(root, 'logos', '.openlogos-runtime'), { recursive: true, force: true });
  rmSync(join(root, '.cursor', 'openlogos-guard-reports.log'), { force: true });
}

/** 在一个夹具组合上依次执行 inputs（每条之后清运行态），返回逐键结果。 */
export function runCombo(base: string, host: MlgHost, kind: MlgKind, state: MlgState, inputs: MlgInput[] = MLG_INPUTS): Map<string, MlgRun> {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mlg-'));
  const out = new Map<string, MlgRun>();
  try {
    buildMlgProject(root, kind);
    withProposal(root, state);
    for (const item of inputs) {
      out.set(item.key, runMlgHost(base, host, root, item));
      resetRuntime(root);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return out;
}
