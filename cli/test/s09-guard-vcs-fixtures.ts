/**
 * guard-versioned-content-scope 共用夹具（S09-F）：G-repo / G-ignored-spec / G-forced / N-repo / N-nogit。
 *
 * 口径见 logos/resources/test/core-S09-test-cases.md「S09 guard 按版本控制内容判定测试」夹具口径。
 * 临时 git 仓库只在仓库级设置 user.name / user.email，不改全局 git 配置；夹具一律位于 mkdtemp 隔离目录。
 */
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GUARD_SRC = join(REPO_ROOT, 'plugin', 'bin', 'guard-check');
export const ENGINE_SRC = join(REPO_ROOT, 'plugin', 'bin', 'guard-post-check.cjs');
export const VECTOR_FILE = join(REPO_ROOT, 'plugin', 'test-vectors', 'guard-protected.json');
export const BASELINE_FILE = join(REPO_ROOT, 'cli', 'test', 'fixtures', 's09-guard-fallback-baseline.json');

export type FixtureKind = 'G-repo' | 'G-ignored-spec' | 'G-forced' | 'N-repo' | 'N-nogit';

/** 剥离会影响 git 定位的会话环境变量，防夹具中的 git 指向本仓。 */
export function cleanEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_CEILING_DIRECTORIES', 'CLAUDE_PROJECT_DIR']) delete env[k];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

/**
 * N-repo 口径断言（core-S09「取代说明」：仅 git 判据下被取代的旧 ID 须在非 git 回落夹具下继续断言原结论）：
 * 项目根不在 git 工作树内时返回 true。
 */
export function isNotGitWorkTree(root: string): boolean {
  const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf-8', env: cleanEnv() });
  return r.status !== 0 || r.stdout.trim() !== 'true';
}

export function git(root: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8', env: cleanEnv() });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function mustGit(root: string, args: string[]): void {
  const r = git(root, args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
}

/** 最小 OpenLogos 项目骨架（与 helpers.scaffoldProject 同形；本模块不得 import vitest，供基准生成器复用）。 */
function scaffold(root: string): void {
  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ name: 'g', locale: 'zh', description: '', documents: {} }, null, 2));
  for (const d of ['logos/resources/prd', 'logos/resources/test', 'logos/resources/verify', 'logos/changes/archive']) {
    mkdirSync(join(root, d), { recursive: true });
  }
}

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

/**
 * 构造夹具项目：G-repo 布局（launched、无 guard 文件、.gitignore 含 node_modules/ dist/ 运行时目录、
 * 已跟踪 src/a.js src/b.js package.json lockfile 与 logos/resources/prd/x.md）。
 * N-repo 不 git init；N-nogit 为 G-repo（调用方以无 git 的 PATH 运行）。
 */
export function buildProject(root: string, kind: FixtureKind): string {
  scaffold(root);
  put(root, 'logos/logos-project.yaml', 'project:\n  name: "g"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
  put(root, '.gitignore', 'node_modules/\ndist/\nlogos/.openlogos-runtime/\n');
  put(root, 'src/a.js', 'a\n');
  put(root, 'src/b.js', 'b\n');
  put(root, 'package.json', `${JSON.stringify({
    name: 'g', version: '1.0.0', private: true,
    scripts: { 'release:local': "node -e \"require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/app.txt','x')\"" },
  }, null, 2)}\n`);
  put(root, 'package-lock.json', `${JSON.stringify({ name: 'g', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'g', version: '1.0.0' } } }, null, 2)}\n`);
  put(root, 'logos/resources/prd/x.md', '# x\n');
  put(root, 'tools/mod.py', "open('src/b.js', 'w').write('mod\\n')\n");
  mkdirSync(join(root, 'logos/resources/reference'), { recursive: true });
  if (kind === 'N-repo') return root;
  mustGit(root, ['init', '-q']);
  mustGit(root, ['config', 'user.name', 'openlogos-test']);
  mustGit(root, ['config', 'user.email', 'openlogos-test@example.invalid']);
  mustGit(root, ['config', 'commit.gpgsign', 'false']);
  mustGit(root, ['add', '-A']);
  mustGit(root, ['commit', '-qm', 'init']);
  if (kind === 'G-ignored-spec') {
    writeFileSync(join(root, '.gitignore'), `${readFileSync(join(root, '.gitignore'), 'utf-8')}/logos/*\n!/logos/logos.config.json\n`);
    put(root, 'logos/resources/test/t.md', '# t\n');
    mustGit(root, ['add', '.gitignore']);
    mustGit(root, ['commit', '-qm', 'ignore spec']);
  }
  if (kind === 'G-forced') {
    put(root, 'dist/app.dmg', 'dmg\n');
    mustGit(root, ['add', '-f', 'dist/app.dmg']);
    mustGit(root, ['commit', '-qm', 'forced']);
  }
  return root;
}

const which = (tool: string) => spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf-8' }).stdout.trim();

/** N-nogit：只含 guard-check 所需外部命令、**不含 git** 的受控 PATH。 */
export function noGitPath(dir: string): string {
  const stub = join(dir, 'stub-nogit');
  mkdirSync(stub, { recursive: true });
  for (const tool of ['bash', 'cat', 'grep', 'sed', 'head', 'node', 'python3', 'tr', 'env', 'mkdir', 'rm', 'ls']) {
    const real = which(tool);
    if (real) symlinkSync(real, join(stub, tool));
  }
  return stub;
}

export interface GuardRun { exitCode: number; stdout: string; stderr: string }

export function runGuard(
  guard: string, root: string, toolName: string, toolInput: Record<string, unknown>,
  opts: { pathEnv?: string; extra?: Record<string, unknown> } = {},
): GuardRun {
  const env = cleanEnv({ CLAUDE_PROJECT_DIR: root, ...(opts.pathEnv !== undefined ? { PATH: opts.pathEnv } : {}) });
  const r = spawnSync('bash', [guard], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput, permission_mode: 'default', ...(opts.extra ?? {}) }),
    cwd: root, encoding: 'utf-8', timeout: 20_000, env,
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 回落基准输入集：UT-S09-389 / UT-S09-412 / ST-S09-173 ①（ST-S09-152、155、156 的全部输入）。`<ROOT>` 由调用方替换。 */
export const BASELINE_INPUTS: Array<{ key: string; tool: string; input: Record<string, unknown> }> = [
  { key: 'Write src/a.js', tool: 'Write', input: { file_path: 'src/a.js', content: 'x' } },
  { key: 'Bash sed -i src/a.js', tool: 'Bash', input: { command: 'sed -i s/a/b/ src/a.js' } },
  { key: 'Bash npm ci', tool: 'Bash', input: { command: 'npm ci' } },
  { key: 'Bash npm run release:local', tool: 'Bash', input: { command: 'npm run release:local' } },
  { key: 'Bash mkdir -p dist/x', tool: 'Bash', input: { command: 'mkdir -p dist/x' } },
  { key: 'Bash node -e > dist/build.log', tool: 'Bash', input: { command: "node -e \"process.stdout.write('log')\" > dist/build.log" } },
  { key: 'Edit dist/a.txt', tool: 'Edit', input: { file_path: 'dist/a.txt', old_string: 'a', new_string: 'b' } },
  { key: 'Edit src/a.js', tool: 'Edit', input: { file_path: 'src/a.js', old_string: 'a', new_string: 'b' } },
  { key: 'Write src/new.js', tool: 'Write', input: { file_path: 'src/new.js', content: 'x' } },
  { key: 'Write newdir/x.txt', tool: 'Write', input: { file_path: 'newdir/x.txt', content: 'x' } },
  { key: 'MultiEdit logos/resources/prd/x.md', tool: 'MultiEdit', input: { file_path: 'logos/resources/prd/x.md', edits: [] } },
  { key: 'Bash cd root && sed -i', tool: 'Bash', input: { command: 'cd <ROOT> && sed -i s/a/X/ src/a.js' } },
  { key: 'Bash node -e writeFileSync', tool: 'Bash', input: { command: "node -e \"require('fs').writeFileSync('src/a.js','y')\"" } },
  { key: 'Bash python3 tools/mod.py', tool: 'Bash', input: { command: 'python3 tools/mod.py' } },
  { key: 'Bash find -delete', tool: 'Bash', input: { command: 'find src -name b.js -delete' } },
  { key: 'Bash T=; echo > $T', tool: 'Bash', input: { command: 'T=src/a.js; echo z > $T' } },
  { key: 'Bash echo > src/a.js', tool: 'Bash', input: { command: 'echo x > src/a.js' } },
  { key: 'Bash rm $VAR', tool: 'Bash', input: { command: 'rm $VAR' } },
];

export function materialize(input: Record<string, unknown>, root: string): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input).split('<ROOT>').join(root)) as Record<string, unknown>;
}

/**
 * 从分发源按函数边界加载真实判定入口：探测函数 + WHITELIST_PREFIXES 起至 BASH_SAFE_PATTERNS 前最后一个列首 `}`
 * （含 rel_of_cwd、guard.exempt 读取、is_whitelisted_path、is_protected）。不改变 hook 行为、不另写规则副本。
 */
export function loadGuardRegion(dir: string): { file: string; body: string } {
  const source = readFileSync(GUARD_SRC, 'utf-8');
  const lines = source.split('\n');
  const slice = (header: string) => {
    const s = lines.findIndex(l => l.startsWith(header));
    const e = lines.findIndex((l, i) => i > s && l === '}');
    if (s < 0 || e < 0) throw new Error(`分发源缺少函数 ${header}`);
    return lines.slice(s, e + 1).join('\n');
  };
  const probe = ['detect_python() {', 'has_python() {', 'run_python() {'].map(slice).join('\n\n');
  const start = lines.findIndex(l => l.startsWith('WHITELIST_PREFIXES=('));
  const next = lines.findIndex(l => l.startsWith('BASH_SAFE_PATTERNS=('));
  let end = -1;
  for (let i = next - 1; i > start; i -= 1) if (lines[i] === '}') { end = i; break; }
  if (start < 0 || end < 0) throw new Error('分发源函数区边界缺失');
  const region = lines.slice(start, end + 1).join('\n');
  // 函数区按分发源同目录解析引擎路径（GUARD_ENGINE 在 cd 前由脚本头计算）；这里显式指向分发源引擎
  const body = `GUARD_ENGINE=${JSON.stringify(ENGINE_SRC)}\n${probe}\n\n${region}\n`;
  const file = join(dir, 'guard-region.sh');
  writeFileSync(file, body);
  return { file, body: region };
}

export interface ProtectVerdict { protected: boolean; step: string; reason: string; stderr: string }

/** 在 root 下调用真实 is_protected（每次新进程，guard.exempt 与模式探测各自重读）。 */
export function callIsProtected(regionFile: string, root: string, path: string, pathEnv?: string, environment: Record<string, string | undefined> = {}): ProtectVerdict {
  const r = spawnSync('bash', ['-c',
    'set -u; source "$1"; detect_python; if is_protected "$2"; then rc=0; else rc=1; fi; printf "rc=%s\\nstep=%s\\nreason=%s\\nmode=%s\\n" "$rc" "$PROTECT_STEP" "$PROTECT_REASON" "$GUARD_MODE"',
    'fn', regionFile, path], {
    cwd: root, encoding: 'utf-8', timeout: 20_000, env: cleanEnv({ ...environment, ...(pathEnv !== undefined ? { PATH: pathEnv } : {}) }),
  });
  const out = r.stdout ?? '';
  const m = /rc=(\d)\nstep=([^\n]*)\nreason=([^\n]*)\n/.exec(out);
  if (!m) throw new Error(`is_protected 调用无结果：${path}\n${out}\n${r.stderr}`);
  return { protected: m[1] === '0', step: m[2], reason: m[3], stderr: r.stderr ?? '' };
}
