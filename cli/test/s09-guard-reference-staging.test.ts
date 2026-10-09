/**
 * fix-guard-reference-baseline-staging-whitelist 单切片：
 * guard-check 资料目录（R-REF）与基线 run 私有 staging（R-STAGING）默认路径豁免（S09）。
 *
 * 覆盖 UT-S09-365～UT-S09-372、ST-S09-147～ST-S09-148（与 logos/resources/test/core-S09-test-cases.md 对齐）。
 * - 完整 hook 用例以 stdin JSON + cwd 调用分发源 `plugin/bin/guard-check`，一律在 python3 或 node 可用环境运行
 *   （hook 读入与 lifecycle 解析依赖二者之一，既有行为）。
 * - UT-S09-372 在函数层验证：从分发源按函数边界加载真实的 `WHITELIST_PREFIXES` / `is_default_exempt_path` /
 *   `is_whitelisted_path`，受控 PATH 下直接调用，不另写规则副本、不调用完整 hook。
 * - guard-versioned-content-scope（UT-S09-372 MODIFIED）：reference / staging 豁免改由 `guard.exempt` 字段缺省时的
 *   内置默认提供（不再硬编码）；显式 `guard.exempt: []` 后三环境均不再命中。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { isNotGitWorkTree } from './s09-guard-vcs-fixtures.js';
import { candidateKey } from '../src/lib/baseline-provenance.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const GUARD_SRC = join(REPO_ROOT, 'plugin', 'bin', 'guard-check');
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const ASSET_MANIFEST = join(REPO_ROOT, 'cli', 'asset-manifest.json');
const TIMEOUT = 60_000;

const RUNS = 'logos/resources/verify/baseline-seed-runs';
const RUN_ID = 'seed-core-0001';
const STAGING = `${RUNS}/${RUN_ID}/staging`;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const which = (tool: string) => spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf-8' }).stdout.trim();

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return root;
}

function launchedProject(root: string, yaml?: string): string {
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), yaml
    ?? 'project:\n  name: "g"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'logos/resources/reference'), { recursive: true });
  return root;
}

interface GuardRun { exitCode: number; stdout: string; stderr: string }

function runGuard(
  guard: string, root: string, toolName: string, toolInput: Record<string, unknown>, pathEnv?: string,
): GuardRun {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root };
  if (pathEnv !== undefined) env.PATH = pathEnv;
  const r = spawnSync('bash', [guard], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    cwd: root, encoding: 'utf-8', timeout: 10_000, env,
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Write 相对与绝对两种形态各判一次，两者须同判。 */
function writeVerdict(guard: string, root: string, rel: string): number {
  const relRun = runGuard(guard, root, 'Write', { file_path: rel, content: 'x' });
  const absRun = runGuard(guard, root, 'Write', { file_path: join(root, rel), content: 'x' });
  expect(absRun.exitCode, `${rel} 绝对/相对形态判定不一致`).toBe(relRun.exitCode);
  return relRun.exitCode;
}

function expectAllowed(guard: string, root: string, rels: string[]): void {
  for (const rel of rels) expect(writeVerdict(guard, root, rel), `应放行：${rel}`).toBe(0);
}

function expectBlocked(guard: string, root: string, rels: string[]): void {
  for (const rel of rels) {
    const r = runGuard(guard, root, 'Write', { file_path: rel, content: 'x' });
    expect(r.exitCode, `应阻断：${rel}`).toBe(2);
    expect(r.stdout, `${rel} stdout 拦截 JSON`).toContain('变更管理拦截');
    expect(r.stderr, `${rel} stderr 可读指引`).toContain('openlogos change');
    expect(runGuard(guard, root, 'Write', { file_path: join(root, rel), content: 'x' }).exitCode, `应阻断（绝对）：${rel}`).toBe(2);
  }
}

function bashVerdict(guard: string, root: string, command: string): number {
  return runGuard(guard, root, 'Bash', { command }).exitCode;
}

/** 完整 hook 用例前提：python3 或 node 至少一个可用（否则 hook 于路径判定前早退，负向断言失真）。 */
function assertHookRuntime(): void {
  expect(Boolean(which('python3') || which('node')), 'python3 / node 均不可用，完整 hook 用例无效').toBe(true);
}

const REF_ALLOWED = [
  'logos/resources/reference/notes.md',
  'logos/resources/reference/a/b/c/snippet.ts',
  'logos/resources/reference/temp/seed-manifest.json',
];
const STAGING_ALLOWED = [
  `${STAGING}/system-map.md`,
  `${STAGING}/scenarios/core-S01.md`,
];
const NEAR_MISS = [
  'logos/resources/reference-evil/x.md',
  'logos/resources/references/x.md',
  `${RUNS}/${RUN_ID}/staging-backup/x.md`,
  `${RUNS}/${RUN_ID}/staging.old/x.md`,
];
const BAD_RUN = [
  `${RUNS}/staging/x.md`,
  `${RUNS}/a/b/staging/x.md`,
  `${RUNS}/-bad/staging/x.md`,
  `${RUNS}/.hidden/staging/x.md`,
];
const PROTECTED = [
  `${RUNS}/${RUN_ID}/run.json`,
  `${RUNS}/${RUN_ID}/commit-journal.json`,
  `${RUNS}/${RUN_ID}/resolved/x.md`,
  `${RUNS}/${RUN_ID}/backup/x.md`,
  `${RUNS}/core.commit.lock`,
  'logos/resources/verify/test-results.jsonl',
  'logos/resources/verify/baseline-events.jsonl',
  'logos/resources/prd/1-product-requirements/core-01-requirements.md',
  'logos/resources/test/core-S01-test-cases.md',
  'src/index.ts',
];

/** 仅含 guard-check 所需外部命令且**无 python3** 的 PATH → 完整 hook 走 node 读入与 node 归一化分支。 */
function nodeOnlyHookPath(dir: string): string {
  const stub = join(dir, 'stub-node-only');
  mkdirSync(stub, { recursive: true });
  for (const tool of ['bash', 'cat', 'grep', 'sed', 'head', 'node']) symlinkSync(which(tool), join(stub, tool));
  return stub;
}

/** reference / staging 下指向项目内受保护文件的**悬空**文件链接（目标尚不存在）。 */
function danglingLinks(root: string): string[] {
  mkdirSync(join(root, STAGING), { recursive: true });
  symlinkSync('../../../src/new.ts', join(root, 'logos/resources/reference/new.ts'));
  symlinkSync('../run.json', join(root, STAGING, 'run-link.json'));
  symlinkSync('../../../../../../src/deep.ts', join(root, STAGING, 'deep.ts'));
  return ['logos/resources/reference/new.ts', `${STAGING}/run-link.json`, `${STAGING}/deep.ts`];
}

describe('S09 guard 资料目录与基线 staging 默认豁免 — 完整 hook', () => {
  it('UT-S09-365: reference 正向——Edit/Write 根文件与多级目录放行且不产生提案', () => {
    assertHookRuntime();
    const root = launchedProject(tempRoot());
    expectAllowed(GUARD_SRC, root, REF_ALLOWED);
    const edit = runGuard(GUARD_SRC, root, 'Edit', { file_path: 'logos/resources/reference/a/b/c/snippet.ts', old_string: 'a', new_string: 'b' });
    expect(edit.exitCode).toBe(0);
    expect(edit.stdout).toBe('');
    expect(edit.stderr).toBe('');
    expect(readdirSync(join(root, 'logos/changes')).filter(n => n !== 'archive')).toEqual([]);
    expect(existsSync(join(root, 'logos/.openlogos-guard'))).toBe(false);
  }, TIMEOUT);

  it('UT-S09-366: staging 正向——单层 run_id 的 staging 及嵌套产物放行', () => {
    assertHookRuntime();
    const root = launchedProject(tempRoot());
    expectAllowed(GUARD_SRC, root, [...STAGING_ALLOWED, STAGING]);
  }, TIMEOUT);

  it('UT-S09-367: 近似名称负向——完整段匹配，reference-evil / staging-backup 等不命中', () => {
    assertHookRuntime();
    expectBlocked(GUARD_SRC, launchedProject(tempRoot()), NEAR_MISS);
  }, TIMEOUT);

  it('UT-S09-368: 缺 run_id / 多层伪 run / 非法 run_id 负向', () => {
    assertHookRuntime();
    expectBlocked(GUARD_SRC, launchedProject(tempRoot()), BAD_RUN);
  }, TIMEOUT);

  it('UT-S09-369: 相邻受保护路径负向 + 既有白名单与活跃提案零回归', () => {
    assertHookRuntime();
    const root = launchedProject(tempRoot());
    expectBlocked(GUARD_SRC, root, PROTECTED);
    expectAllowed(GUARD_SRC, root, ['logos/changes/x/proposal.md', 'CLAUDE.md']);
    const { root: outside, cleanup } = makeTempRoot();
    cleanups.push(cleanup);
    expect(runGuard(GUARD_SRC, root, 'Write', { file_path: join(outside, 'x.md'), content: 'x' }).exitCode).toBe(0);
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
    expect(runGuard(GUARD_SRC, root, 'Write', { file_path: 'src/index.ts', content: 'x' }).exitCode).toBe(0);
  }, TIMEOUT);

  it('UT-S09-370: 点段逃逸与符号链接不放宽', () => {
    assertHookRuntime();
    const root = launchedProject(tempRoot());
    symlinkSync(join(root, 'src'), join(root, 'logos/resources/reference/link'));
    for (const rel of [
      'logos/resources/reference/../../../src/a.ts',
      `${STAGING}/../run.json`,
      'logos/resources/reference/link/a.ts',
    ]) {
      expect(runGuard(GUARD_SRC, root, 'Write', { file_path: rel, content: 'x' }).exitCode, rel).toBe(2);
    }
    // 对照：归一化后仍位于 reference 内 → 放行（python3/node 分支）
    expect(runGuard(GUARD_SRC, root, 'Write', { file_path: 'logos/resources/reference/a/../b.md', content: 'x' }).exitCode).toBe(0);

    // 悬空文件链接（目标尚不存在）：归一化只解析已存在祖先，链接本身须令豁免不命中——python3 与 node 两分支、
    // 文件工具与 touch 均阻断，且不得经链接创建出受保护文件
    const links = danglingLinks(root);
    const nodeOnly = nodeOnlyHookPath(tempRoot());
    for (const pathEnv of [undefined, nodeOnly]) {
      const branch = pathEnv ? 'node' : 'python3';
      for (const rel of links) {
        expect(runGuard(GUARD_SRC, root, 'Write', { file_path: rel, content: 'x' }, pathEnv).exitCode, `${branch} Write ${rel}`).toBe(2);
        expect(runGuard(GUARD_SRC, root, 'Write', { file_path: join(root, rel), content: 'x' }, pathEnv).exitCode, `${branch} Write abs ${rel}`).toBe(2);
        expect(runGuard(GUARD_SRC, root, 'Bash', { command: `touch ${rel}` }, pathEnv).exitCode, `${branch} touch ${rel}`).toBe(2);
      }
      // 普通新文件（非链接）仍放行：正向不回退
      expect(runGuard(GUARD_SRC, root, 'Write', { file_path: 'logos/resources/reference/fresh.md', content: 'x' }, pathEnv).exitCode, `${branch} fresh`).toBe(0);
      expect(runGuard(GUARD_SRC, root, 'Write', { file_path: `${STAGING}/fresh.md`, content: 'x' }, pathEnv).exitCode, `${branch} staging fresh`).toBe(0);
    }
    expect(existsSync(join(root, 'src/new.ts'))).toBe(false);
    expect(existsSync(join(root, 'src/deep.ts'))).toBe(false);
  }, TIMEOUT);

  it('UT-S09-371: Bash 写入复用新规则、安全白名单优先级与解析能力不变', () => {
    assertHookRuntime();
    const root = launchedProject(tempRoot());
    expect(isNotGitWorkTree(root), 'N-repo 口径：非 git 回落回归锚（git 判据下的新结论见 UT-S09-391 / ST-S09-156 等）').toBe(true);
    const allowed = [
      'mkdir -p logos/resources/reference/temp',
      'touch logos/resources/reference/todo.md',
      'echo x > logos/resources/reference/n.md',
      `mkdir -p ${STAGING}/scenarios`,
      `touch ${STAGING}/a.md`,
    ];
    const blocked = [
      'cp logos/resources/reference/a.md src/a.md',
      `mv ${STAGING}/x logos/resources/prd/x`,
      `touch ${RUNS}/${RUN_ID}/run.json`,
      "sed -i 's/a/b/' logos/resources/reference/a.md",
      'tee logos/resources/reference/a.md',
      'touch $D/a.md',
      'mkdir x && touch logos/resources/reference/a.md',
      // verify-smoke-guard-fixes-0-15-20（决策 C04）：复合命令不再凭首段安全白名单整条放行；
      // `tee` 段不在路径提取范围内，按解析不出阻断
      'echo x | tee logos/resources/reference/a.md',
    ];
    const safe = [
      'openlogos baseline-seed begin --module core --manifest logos/resources/reference/temp/m.json',
    ];
    for (const c of allowed) expect(bashVerdict(GUARD_SRC, root, c), `应放行：${c}`).toBe(0);
    for (const c of blocked) expect(bashVerdict(GUARD_SRC, root, c), `应阻断：${c}`).toBe(2);
    for (const c of safe) expect(bashVerdict(GUARD_SRC, root, c), `安全白名单先判：${c}`).toBe(0);
  }, TIMEOUT);
});

/* ─────────── 函数层：从分发源加载真实函数，受控 PATH 三分支同判 ─────────── */

/**
 * 按函数边界从分发源提取：WHITELIST_PREFIXES 数组起，至 is_whitelisted_path 函数结束的 `}` 止。
 * 函数体内嵌的 node 脚本含列首 `}`，故取下一段顶层定义（BASH_SAFE_PATTERNS）之前最后一个列首 `}`。
 */
function loadRealFunctions(dir: string): { file: string; body: string } {
  const lines = readFileSync(GUARD_SRC, 'utf-8').split('\n');
  const start = lines.findIndex(l => l.startsWith('WHITELIST_PREFIXES=('));
  const fnStart = lines.findIndex(l => l.startsWith('is_whitelisted_path() {'));
  const next = lines.findIndex(l => l.startsWith('BASH_SAFE_PATTERNS=('));
  expect(next).toBeGreaterThan(fnStart);
  let end = -1;
  for (let i = next - 1; i > fnStart; i -= 1) if (lines[i] === '}') { end = i; break; }
  expect(start).toBeGreaterThanOrEqual(0);
  expect(fnStart).toBeGreaterThan(start);
  expect(end).toBeGreaterThan(fnStart);
  const body = lines.slice(start, end + 1).join('\n');
  expect(body).toContain('is_default_exempt_path() {');
  const file = join(dir, 'guard-functions.sh');
  writeFileSync(file, `${body}\n`);
  return { file, body };
}

type Runtime = 'python3' | 'node-only' | 'bash-only';

function runtimePath(dir: string, runtime: Runtime): string | undefined {
  if (runtime === 'python3') return process.env.PATH;
  const stub = join(dir, `path-${runtime}`);
  mkdirSync(stub, { recursive: true });
  if (runtime === 'node-only') symlinkSync(which('node'), join(stub, 'node'));
  return stub;
}

function fnVerdict(bash: string, fnFile: string, root: string, pathEnv: string | undefined, input: string): number {
  const r = spawnSync(bash, ['-c', 'source "$1"; is_whitelisted_path "$2"; echo "rc=$?"', 'fn', fnFile, input], {
    cwd: root, encoding: 'utf-8', timeout: 10_000, env: { PATH: pathEnv ?? '', HOME: process.env.HOME ?? '' },
  });
  const m = /rc=(\d+)/.exec(r.stdout ?? '');
  expect(m, `函数调用无返回：${input} ${r.stderr}`).not.toBeNull();
  return Number(m![1]);
}

describe('S09 guard 默认豁免 — is_whitelisted_path 函数层', () => {
  it('UT-S09-372: python3 / node / bash 兜底三分支同判（豁免来自 guard.exempt 内置默认），含点段输入兜底只可更保守', () => {
    // bash 兜底按 `$(pwd)/` 前缀判管辖、不解析符号链接（既有行为）；macOS 临时目录 /var → /private/var，
    // 故以项目根真实路径构造绝对输入，使三分支比较的只是本案规则本身。
    const root = realpathSync(launchedProject(tempRoot()));
    const scratch = tempRoot();
    const { file, body } = loadRealFunctions(scratch);
    // 加载的函数体来自分发源当前字节
    expect(readFileSync(GUARD_SRC, 'utf-8')).toContain(body);
    const bash = which('bash');
    const envs: Record<Runtime, string | undefined> = {
      'python3': runtimePath(scratch, 'python3'),
      'node-only': runtimePath(scratch, 'node-only'),
      'bash-only': runtimePath(scratch, 'bash-only'),
    };
    // 夹具显式断言三环境的运行时可用性，防兜底分支空过
    const probe = (p: string | undefined, tool: string) =>
      spawnSync(bash, ['-c', `command -v ${tool} >/dev/null && echo yes || echo no`], { encoding: 'utf-8', env: { PATH: p ?? '' } }).stdout.trim();
    expect(probe(envs.python3, 'python3')).toBe('yes');
    expect([probe(envs['node-only'], 'python3'), probe(envs['node-only'], 'node')]).toEqual(['no', 'yes']);
    expect([probe(envs['bash-only'], 'python3'), probe(envs['bash-only'], 'node')]).toEqual(['no', 'no']);

    const allowed = [...REF_ALLOWED, ...STAGING_ALLOWED, STAGING, 'logos/resources/reference', 'logos/changes/x/proposal.md'];
    const blocked = [...NEAR_MISS, ...BAD_RUN, ...PROTECTED];
    for (const runtime of Object.keys(envs) as Runtime[]) {
      for (const rel of allowed) {
        expect(fnVerdict(bash, file, root, envs[runtime], rel), `${runtime} 应命中：${rel}`).toBe(0);
        expect(fnVerdict(bash, file, root, envs[runtime], join(root, rel)), `${runtime} 应命中（绝对）：${rel}`).toBe(0);
      }
      for (const rel of blocked) {
        expect(fnVerdict(bash, file, root, envs[runtime], rel), `${runtime} 不应命中：${rel}`).not.toBe(0);
        expect(fnVerdict(bash, file, root, envs[runtime], join(root, rel)), `${runtime} 不应命中（绝对）：${rel}`).not.toBe(0);
      }
    }
    // 悬空文件链接：三分支均不命中
    const links = danglingLinks(root);
    for (const runtime of Object.keys(envs) as Runtime[]) {
      for (const rel of links) {
        expect(fnVerdict(bash, file, root, envs[runtime], rel), `${runtime} 悬空链接不应命中：${rel}`).not.toBe(0);
        expect(fnVerdict(bash, file, root, envs[runtime], join(root, rel)), `${runtime} 悬空链接不应命中（绝对）：${rel}`).not.toBe(0);
      }
    }
    // 豁免来自配置而非硬编码：显式 guard.exempt: [] 后，reference / staging 正向输入三环境均不命中
    const cfgPath = join(root, 'logos/logos.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8')) as Record<string, unknown>;
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, guard: { exempt: [] } }, null, 2));
    for (const runtime of Object.keys(envs) as Runtime[]) {
      for (const rel of [...REF_ALLOWED, ...STAGING_ALLOWED, STAGING, 'logos/resources/reference']) {
        expect(fnVerdict(bash, file, root, envs[runtime], rel), `${runtime} exempt [] 不应命中：${rel}`).not.toBe(0);
        expect(fnVerdict(bash, file, root, envs[runtime], join(root, rel)), `${runtime} exempt [] 不应命中（绝对）：${rel}`).not.toBe(0);
      }
      // 既有白名单不受 exempt 影响
      expect(fnVerdict(bash, file, root, envs[runtime], 'logos/changes/x/proposal.md'), runtime).toBe(0);
    }
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    // 含点段输入：bash 兜底一律不命中；逃逸输入在任一环境都不得命中
    expect(fnVerdict(bash, file, root, envs['bash-only'], 'logos/resources/reference/a/../b.md')).not.toBe(0);
    for (const runtime of Object.keys(envs) as Runtime[]) {
      expect(fnVerdict(bash, file, root, envs[runtime], 'logos/resources/reference/../../../src/a.ts'), runtime).not.toBe(0);
    }
  }, TIMEOUT);
});

/* ─────────── 场景：真实 CLI + 真实 hook ─────────── */

function cli(cwd: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env = { ...process.env };
  delete env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY;
  const r = spawnSync(process.execPath, [CLI_ENTRY, ...args], { cwd, encoding: 'utf-8', timeout: 120_000, env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 模拟 AI：先问 hook，放行才落盘。 */
function hookedWrite(root: string, rel: string, content: string): number {
  const code = runGuard(GUARD_SRC, root, 'Write', { file_path: rel, content });
  if (code.exitCode === 0) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return code.exitCode;
}

function stagedDoc(key: string, anchor: string): string {
  return `# doc\n\n## 逆向基线来源\n\`\`\`yaml\ncandidates:\n  - key: "${key}"\n    anchor: "${anchor}"\n    state: active\n    verified: false\n\`\`\`\n`;
}

describe('S09 guard 默认豁免 — 场景', () => {
  it('ST-S09-147: 无提案 begin → staging → commit 端到端，不创建临时提案', () => {
    assertHookRuntime();
    const root = launchedProject(tempRoot(),
      'project:\n  name: "g"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n    bootstrap: adopted\n    baseline_seed_state: required\n');
    const configBefore = readFileSync(join(root, 'logos/logos.config.json'), 'utf-8');
    const SYSTEM_MAP = 'logos/resources/prd/core-system-map.md';
    const SCENARIOS = 'logos/resources/prd/core-scenario-candidates.md';
    const [A1, A2] = ['cli:one', 'cli:two'];
    const [K1, K2] = [candidateKey('core', A1), candidateKey('core', A2)];
    const manifestRel = 'logos/resources/reference/temp/seed-manifest.json';

    // ① 逻辑计划 manifest 经 hook 写入 reference/temp
    expect(hookedWrite(root, manifestRel, JSON.stringify({ module: 'core', expected: [
      { kind: 'system-map', target_path: SYSTEM_MAP, candidate_keys: [K1] },
      { kind: 'scenario-candidates', target_path: SCENARIOS, candidate_keys: [K2] },
    ] }))).toBe(0);

    // ② 真实 begin（Bash 安全白名单）
    expect(bashVerdict(GUARD_SRC, root, `openlogos baseline-seed begin --module core --manifest ${manifestRel} --format json`)).toBe(0);
    const begin = cli(root, ['baseline-seed', 'begin', '--module', 'core', '--manifest', manifestRel, '--format', 'json']);
    expect(begin.status, begin.stderr).toBe(0);
    const data = JSON.parse(begin.stdout).data as { run_id: string; staging: string };
    expect(data.staging).toMatch(/^logos\/resources\/verify\/baseline-seed-runs\/[A-Za-z0-9][A-Za-z0-9._-]*\/staging\/$/);

    // ③ 按返回路径经 hook 写入 staging（含一次经 hook 的 mkdir -p）
    const staging = data.staging.replace(/\/$/, '');
    expect(bashVerdict(GUARD_SRC, root, `mkdir -p ${staging}/logos/resources/prd`)).toBe(0);
    expect(hookedWrite(root, `${staging}/${SYSTEM_MAP}`, stagedDoc(K1, A1))).toBe(0);
    expect(hookedWrite(root, `${staging}/${SCENARIOS}`, stagedDoc(K2, A2))).toBe(0);

    // ④ 真实 commit
    const commit = cli(root, ['baseline-seed', 'commit', '--module', 'core', '--run-id', data.run_id, '--format', 'json']);
    expect(commit.status, commit.stderr).toBe(0);
    expect(JSON.parse(commit.stdout).data.baseline_seed_state).toBe('seeded');
    expect(existsSync(join(root, SYSTEM_MAP))).toBe(true);
    expect(existsSync(join(root, SCENARIOS))).toBe(true);

    // ⑤ run 状态与正式目标仍受保护
    for (const rel of [`${RUNS}/${data.run_id}/run.json`, `${RUNS}/${data.run_id}/commit-journal.json`, SYSTEM_MAP]) {
      expect(runGuard(GUARD_SRC, root, 'Write', { file_path: rel, content: 'x' }).exitCode, rel).toBe(2);
    }
    expect(readdirSync(join(root, 'logos/changes')).filter(n => n !== 'archive')).toEqual([]);
    expect(existsSync(join(root, 'logos/.openlogos-guard'))).toBe(false);
    expect(readFileSync(join(root, 'logos/logos.config.json'), 'utf-8')).toBe(configBefore);
  }, 180_000);

  it('ST-S09-148: init / sync 分发的托管 guard 获得同一规则', () => {
    assertHookRuntime();
    const srcBytes = readFileSync(GUARD_SRC);
    const manifest = JSON.parse(readFileSync(ASSET_MANIFEST, 'utf-8')) as { plugins: Array<{ path: string; sha256: string }> };
    const registered = manifest.plugins.find(p => p.path === 'claude-plugin-template/bin/guard-check')!.sha256;
    expect(registered).toBe(sha256(srcBytes));

    const launch = (root: string) => {
      const yamlPath = join(root, 'logos/logos-project.yaml');
      writeFileSync(yamlPath, readFileSync(yamlPath, 'utf-8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
      mkdirSync(join(root, 'src'), { recursive: true });
    };
    const managed = (root: string) => join(root, '.claude', 'openlogos', 'bin', 'guard-check');

    // ① 新建项目 P1：真实 init
    const p1 = tempRoot();
    const init1 = cli(p1, ['init', 'p1', '--locale', 'zh', '--ai-tool', 'claude-code']);
    expect(init1.status, init1.stderr).toBe(0);
    launch(p1);
    expect(sha256(readFileSync(managed(p1)))).toBe(sha256(srcBytes));

    // ② 存量项目 P2：托管 guard 预置为不含新规则的旧字节，再真实 sync
    const p2 = tempRoot();
    expect(cli(p2, ['init', 'p2', '--locale', 'zh', '--ai-tool', 'claude-code']).status).toBe(0);
    launch(p2);
    const oldBytes = srcBytes.toString('utf-8').replace(
      /\n  if is_default_exempt_path "\$rel_path"; then\n    return 0\n  fi/, '');
    expect(oldBytes).not.toBe(srcBytes.toString('utf-8'));
    writeFileSync(managed(p2), oldBytes, { mode: 0o755 });
    // 修复前必红对照：旧字节拦截 reference 正向输入
    expect(runGuard(managed(p2), p2, 'Write', { file_path: 'logos/resources/reference/notes.md', content: 'x' }).exitCode).toBe(2);
    const sync = cli(p2, ['sync']);
    expect(sync.status, sync.stderr).toBe(0);
    expect(sha256(readFileSync(managed(p2)))).toBe(sha256(srcBytes));

    // ③ 两份托管 guard 的核心矩阵与分发源逐条相同
    for (const root of [p1, p2]) {
      mkdirSync(join(root, 'logos/resources/reference'), { recursive: true });
      const inputs = [...REF_ALLOWED, ...STAGING_ALLOWED, ...NEAR_MISS, `${RUNS}/${RUN_ID}/run.json`, 'src/index.ts'];
      for (const rel of inputs) {
        const want = runGuard(GUARD_SRC, root, 'Write', { file_path: rel, content: 'x' }).exitCode;
        expect(runGuard(managed(root), root, 'Write', { file_path: rel, content: 'x' }).exitCode, rel).toBe(want);
      }
      for (const c of ['cp logos/resources/reference/a.md src/a.md', `touch ${STAGING}/a.md`]) {
        expect(bashVerdict(managed(root), root, c), c).toBe(bashVerdict(GUARD_SRC, root, c));
      }
    }
  }, 180_000);
});

/* ─────────── 安装态 smoke runner 判据（code-r1 F2）：不落真实全局环境 ─────────── */

const SMOKE_RUNNER = join(REPO_ROOT, 'scripts', 'smoke-guard-reference-staging-0-15-15.js');
const SLUG = 'fix-guard-reference-baseline-staging-whitelist';
const CANDIDATE = '0.15.99';

interface FakeInstall { version: string; guard: string; manifestSha?: string }

/** 伪造仓库（runner 的 cwd）：活跃提案、候选版本常量、候选 guard 分发源。 */
function fakeRepo(activeSlug: string | null): string {
  const repo = tempRoot();
  mkdirSync(join(repo, 'logos'), { recursive: true });
  if (activeSlug) writeFileSync(join(repo, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: activeSlug, module: 'core' }));
  mkdirSync(join(repo, 'cli/src/lib'), { recursive: true });
  writeFileSync(join(repo, 'cli/src/lib/local-release-candidate.ts'),
    `export const LOCAL_RELEASE_CANDIDATE_VERSION = '${CANDIDATE}' as const;\n`);
  mkdirSync(join(repo, 'plugin/bin'), { recursive: true });
  writeFileSync(join(repo, 'plugin/bin/guard-check'), readFileSync(GUARD_SRC));
  return repo;
}

/** 伪造全局安装包：--version 返回指定版本，其余子命令委托真实 CLI（init / sync 走真实分发）。 */
function fakeInstall(spec: FakeInstall): string {
  const pkg = tempRoot();
  mkdirSync(join(pkg, 'dist'), { recursive: true });
  mkdirSync(join(pkg, 'claude-plugin-template/bin'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@miniidealab/openlogos', version: spec.version }));
  writeFileSync(join(pkg, 'claude-plugin-template/bin/guard-check'), spec.guard);
  writeFileSync(join(pkg, 'asset-manifest.json'), JSON.stringify({
    version: spec.version,
    plugins: [{ path: 'claude-plugin-template/bin/guard-check', sha256: spec.manifestSha ?? sha256(spec.guard) }],
  }));
  const entry = join(pkg, 'dist/index.js');
  writeFileSync(entry, [
    "const { spawnSync } = require('node:child_process');",
    "const args = process.argv.slice(2);",
    `if (args[0] === '--version') { console.log(${JSON.stringify(spec.version)}); process.exit(0); }`,
    `const r = spawnSync(process.execPath, [${JSON.stringify(CLI_ENTRY)}, ...args], { stdio: 'inherit' });`,
    'process.exit(r.status ?? 1);',
  ].join('\n'));
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@miniidealab/openlogos', version: spec.version, type: 'commonjs' }));
  return entry;
}

function runSmokeRunner(repo: string, entry: string | null, extraEnv: Record<string, string> = {}) {
  const results = join(tempRoot(), 'smoke-results.jsonl');
  const env: NodeJS.ProcessEnv = { ...process.env, OPENLOGOS_SMOKE_RESULT_PATH: results, ...extraEnv };
  delete env.OPENLOGOS_GUARD_EXEMPT_SMOKE;
  env.OPENLOGOS_GUARD_EXEMPT_SMOKE_ENTRY = entry ?? join(repo, 'no-such-openlogos');
  const r = spawnSync(process.execPath, [SMOKE_RUNNER], { cwd: repo, env, encoding: 'utf-8', timeout: 240_000 });
  const rows = existsSync(results)
    ? readFileSync(results, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as { id: string; status: string; detail?: string })
    : [];
  return { status: r.status, rows, stderr: r.stderr ?? '' };
}

const GUARD_TEXT = () => readFileSync(GUARD_SRC, 'utf-8');
const OLD_GUARD = () => GUARD_TEXT()
  .replace(/\n# Built-in default exemptions[\s\S]*?\n}\n\nis_whitelisted_path\(\) \{/, '\n\nis_whitelisted_path() {')
  .replace(/\n  if is_default_exempt_path "\$rel_path"; then\n    return 0\n  fi/, '');

function expectNoPassEvidence(run: ReturnType<typeof runSmokeRunner>, why: string): void {
  expect(run.status, why).not.toBe(0);
  expect(run.rows.map(r => r.id).sort(), why).toEqual(['SMOKE-core-209', 'SMOKE-core-210']);
  expect(run.rows.every(r => r.status === 'fail'), `${why}：${JSON.stringify(run.rows)}`).toBe(true);
}

describe('SMOKE-core-209/210 安装态 runner 判据（不落真实全局环境）', () => {
  it('本案窗口内全局入口缺失 → 两条 fail 且非零退出（不得 skip）', () => {
    expectNoPassEvidence(runSmokeRunner(fakeRepo(SLUG), null), '入口缺失');
  }, TIMEOUT);

  it('本案窗口内随包 guard 为旧版（无默认豁免）→ fail', () => {
    const old = OLD_GUARD();
    expect(old).not.toContain('is_default_exempt_path');
    expectNoPassEvidence(runSmokeRunner(fakeRepo(SLUG), fakeInstall({ version: CANDIDATE, guard: old })), '旧版 guard');
  }, TIMEOUT);

  it('自洽但版本与本次冻结候选不符的安装包 → fail', () => {
    expectNoPassEvidence(runSmokeRunner(fakeRepo(SLUG), fakeInstall({ version: '9.9.9', guard: GUARD_TEXT() })), '版本不符');
  }, TIMEOUT);

  it('自洽但随包 guard 与候选分发源字节不同的安装包 → fail', () => {
    const drifted = `${GUARD_TEXT()}\n# drifted build\n`;
    expectNoPassEvidence(runSmokeRunner(fakeRepo(SLUG), fakeInstall({ version: CANDIDATE, guard: drifted })), 'guard 身份不符');
  }, TIMEOUT);

  it('正确候选 → 执行行为矩阵并两条 pass', () => {
    const run = runSmokeRunner(fakeRepo(SLUG), fakeInstall({ version: CANDIDATE, guard: GUARD_TEXT() }));
    expect(run.status, run.stderr).toBe(0);
    expect(run.rows.map(r => [r.id, r.status])).toEqual([['SMOKE-core-209', 'pass'], ['SMOKE-core-210', 'pass']]);
    expect(run.rows[0].detail).toContain('阻断');
  }, 240_000);

  it('本案窗口之外 → 按既有留痕机制 skip（不拉黑后续提案）', () => {
    const run = runSmokeRunner(fakeRepo('some-later-change'), null);
    expect(run.status).toBe(0);
    expect(run.rows.map(r => r.status)).toEqual(['skip', 'skip']);
  }, TIMEOUT);
});
