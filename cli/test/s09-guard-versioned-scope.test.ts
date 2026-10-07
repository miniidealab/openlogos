/**
 * guard-versioned-content-scope [code] 切片 1：受保护判定与 Edit/Write 事前判定（S09-F）。
 *
 * 覆盖 UT-S09-372（见 s09-guard-reference-staging.test.ts，MODIFIED）、UT-S09-385～389、UT-S09-392、UT-S09-409、
 * UT-S09-412、ST-S09-153、ST-S09-155、ST-S09-172、ST-S09-173、ST-S09-181、ST-S09-182
 * （与 logos/resources/test/core-S09-test-cases.md 对齐）。
 * - UT 以函数层调用分发源 `plugin/bin/guard-check` 中真实的 is_protected / guard.exempt 读取（按函数边界加载，不另写规则副本）。
 * - ST 以 stdin JSON + cwd + CLAUDE_PROJECT_DIR 驱动分发源，Edit/Write 类按「放行才落盘」模拟宿主。
 * - 事后检查引擎（切片 3）落地后补齐：Bash 解析不出形态事前放行、事后不报告（ST-S09-153）/ 事后 exit 2
 *   （ST-S09-172、ST-S09-181、ST-S09-182 ④），非 git 回落下 PostToolUse 一律 exit 0 且不生成执行记录（ST-S09-173 ④）；
 *   受限命令 permission_mode 审批（ask / exit 2）由切片 2 补入 UT-S09-412 与 ST-S09-173。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeTempRoot } from './helpers.js';
import {
  BASELINE_FILE, BASELINE_INPUTS, ENGINE_SRC, GUARD_SRC, VECTOR_FILE, buildProject, callIsProtected, cleanEnv, git,
  loadGuardRegion, materialize, noGitPath, runGuard, type FixtureKind,
} from './s09-guard-vcs-fixtures.js';
import { chain, sedExec } from './s09-guard-post-check-helpers.js';

const TIMEOUT = 120_000;
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return root;
}

/** 夹具口径断言：G-* 须在 git 工作树内且无 guard 文件；N-repo 须不在工作树内；N-nogit 的 PATH 中须无 git。 */
function fixture(kind: FixtureKind): { root: string; pathEnv?: string } {
  const root = buildProject(tempRoot(), kind);
  expect(existsSync(join(root, 'logos/.openlogos-guard')), `${kind} 不应有活跃提案`).toBe(false);
  if (kind === 'N-repo') {
    expect(git(root, ['rev-parse', '--is-inside-work-tree']).status, 'N-repo 不应在 git 工作树内').not.toBe(0);
    return { root };
  }
  expect(git(root, ['rev-parse', '--is-inside-work-tree']).stdout.trim(), `${kind} 应在 git 工作树内`).toBe('true');
  if (kind === 'N-nogit') {
    const pathEnv = noGitPath(tempRoot());
    const probe = spawnSync('bash', ['-c', 'command -v git'], { encoding: 'utf-8', env: { PATH: pathEnv } });
    expect(probe.status, 'N-nogit 受控 PATH 中不应有 git').not.toBe(0);
    return { root, pathEnv };
  }
  return { root };
}

/** 受限命令在非 git 回落下的宿主原生审批：default → ask（exit 0）；bypassPermissions → exit 2；配置不变。 */
function expectScopeApproval(root: string, kind: string, pathEnv?: string): void {
  const cmd = 'openlogos exempt add src/';
  const cfg = readFileSync(join(root, 'logos/logos.config.json'));
  const ask = runGuard(GUARD_SRC, root, 'Bash', { command: cmd }, { pathEnv, extra: { permission_mode: 'default' } });
  expect(ask.exitCode, `${kind} 受限命令 default`).toBe(0);
  expect(JSON.parse(ask.stdout.trim()), `${kind} ask`).toEqual({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'ask',
    permissionDecisionReason: `该命令会改变 guard 的保护范围（${cmd}），需要您确认后执行`,
  } });
  const blocked = runGuard(GUARD_SRC, root, 'Bash', { command: cmd }, { pathEnv, extra: { permission_mode: 'bypassPermissions' } });
  expect(blocked.exitCode, `${kind} 受限命令 bypassPermissions`).toBe(2);
  expect(blocked.stderr).toContain(`! ${cmd}`);
  expect(readFileSync(join(root, 'logos/logos.config.json')).equals(cfg), `${kind} 配置不变`).toBe(true);
}

/** 修改 logos.config.json 的 guard 字段：undefined = 删除字段；'CORRUPT' = 写成不可解析 JSON。 */
function setGuardConfig(root: string, guard: unknown): void {
  const file = join(root, 'logos/logos.config.json');
  if (guard === 'CORRUPT') { writeFileSync(file, '{ "name": "g", "guard": { "exempt": [ }'); return; }
  let cfg: Record<string, unknown>;
  try { cfg = JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>; } catch { cfg = { name: 'g', locale: 'zh' }; }
  if (guard === undefined) delete cfg.guard;
  else cfg.guard = guard;
  writeFileSync(file, JSON.stringify(cfg, null, 2));
}

function expectRuntimeBlocked(r: { exitCode: number; stdout: string; stderr: string }, label: string): void {
  expect(r.exitCode, label).toBe(2);
  expect(JSON.parse(r.stdout).reason, label).toContain('guard 自有状态');
  expect(r.stderr, label).toContain('logos/.openlogos-runtime/');
}

function region(): string {
  const { file, body } = loadGuardRegion(tempRoot());
  expect(readFileSync(GUARD_SRC, 'utf-8')).toContain(body);
  return file;
}

function expectBlockedRun(r: { exitCode: number; stdout: string; stderr: string }, label: string): void {
  expect(r.exitCode, label).toBe(2);
  const parsed = JSON.parse(r.stdout) as { reason: string };
  expect(parsed.reason, `${label} stdout reason`).toContain('变更管理拦截');
  expect(r.stderr.trim(), `${label} stderr 非空`).not.toBe('');
  expect(r.stderr, `${label} stderr 指引`).toContain('openlogos change');
}

/** 模拟宿主：先问 hook，放行才落盘；返回退出码并断言阻断时目标字节不变。 */
function hookedWrite(root: string, tool: string, rel: string, content: string, pathEnv?: string): number {
  const abs = rel.startsWith('/') ? rel : join(root, rel);
  const before = existsSync(abs) ? readFileSync(abs) : null;
  const input = tool === 'NotebookEdit' ? { notebook_path: rel, new_source: content } : { file_path: rel, content };
  const r = runGuard(GUARD_SRC, root, tool, input, { pathEnv });
  if (r.exitCode === 0) {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  } else {
    expectBlockedRun(r, `${tool} ${rel}`);
    if (before === null) expect(existsSync(abs), `${rel} 不应被创建`).toBe(false);
    else expect(readFileSync(abs).equals(before), `${rel} 字节应不变`).toBe(true);
  }
  return r.exitCode;
}

interface Vector { fixture: FixtureKind; path: string; protected: boolean; step: number }

/* ─────────────────────────── 函数层 UT ─────────────────────────── */

describe('S09-F 受保护判定 is_protected — 函数层', () => {
  it('UT-S09-385: is_protected 判定顺序（共享测试向量 plugin/test-vectors/guard-protected.json）', () => {
    const file = region();
    const vectors = (JSON.parse(readFileSync(VECTOR_FILE, 'utf-8')) as { vectors: Vector[] }).vectors;
    expect(vectors.map(v => v.step)).toEqual([1, 2, 3, 3, 3, 4, 5, 5, 6, 6, 7, 8, 8, 9, 9, 10, 10]);
    const roots = new Map<FixtureKind, string>();
    const outside = tempRoot();
    for (const v of vectors) {
      if (!roots.has(v.fixture)) roots.set(v.fixture, fixture(v.fixture).root);
      const root = roots.get(v.fixture)!;
      const p = v.path.replace('<OUTSIDE>', outside);
      const got = callIsProtected(file, root, p);
      expect([got.protected, got.step], `${v.fixture} ${v.path}（${got.reason}）`).toEqual([v.protected, String(v.step)]);
      // 绝对路径形态同判
      if (!p.startsWith('/')) {
        const abs = callIsProtected(file, root, join(root, p));
        expect([abs.protected, abs.step], `${v.fixture} 绝对 ${v.path}`).toEqual([v.protected, String(v.step)]);
      }
    }
    // 先命中先返回：被忽略的 logos.config.json 仍命中序 3（不落到序 9）；被忽略目录下已跟踪文件命中序 8（不落到序 9）
    const ignored = roots.get('G-ignored-spec')!;
    expect(git(ignored, ['check-ignore', '-q', 'logos/resources/test/t.md']).status).toBe(0);
    expect(git(roots.get('G-forced')!, ['check-ignore', '-q', '--no-index', 'dist/app.dmg']).status).toBe(0);
  }, TIMEOUT);

  it('UT-S09-386: 不可豁免项先于白名单与 exempt（含项目内 / 项目外 core.excludesFile）', () => {
    const file = region();
    for (const kind of ['G-repo', 'G-ignored-spec'] as FixtureKind[]) {
      const { root } = fixture(kind);
      mkdirSync(join(root, '.config'), { recursive: true });
      writeFileSync(join(root, '.config/ignore'), '*.tmp\n');
      expect(git(root, ['config', 'core.excludesFile', join(root, '.config/ignore')]).status).toBe(0);
      // ① exempt docs/ 时 docs/.gitignore
      setGuardConfig(root, { exempt: ['docs/'] });
      const d1 = callIsProtected(file, root, 'docs/.gitignore');
      expect([d1.protected, d1.step], `${kind} ①`).toEqual([true, '3']);
      const docsCtl = callIsProtected(file, root, 'docs/a.md');
      expect([docsCtl.protected, docsCtl.step], `${kind} 对照 docs/a.md`).toEqual([false, '6']);
      // ② exempt logos/ 时 logos/logos.config.json；⑤ 同配置下运行时目录
      setGuardConfig(root, { exempt: ['logos/'] });
      const d2 = callIsProtected(file, root, 'logos/logos.config.json');
      expect([d2.protected, d2.step], `${kind} ②`).toEqual([true, '3']);
      const d5 = callIsProtected(file, root, 'logos/.openlogos-runtime/pending-reports.jsonl');
      expect([d5.protected, d5.step], `${kind} ⑤`).toEqual([true, '2']);
      const prdCtl = callIsProtected(file, root, 'logos/resources/prd/x.md');
      expect([prdCtl.protected, prdCtl.step], `${kind} 对照 prd（exempt logos/）`).toEqual([false, '6']);
      // ③ 白名单 .claude/ 下的 .gitignore；④ 多级 .gitignore、info/exclude、项目内 excludesFile、git hooks
      setGuardConfig(root, undefined);
      for (const [p, step] of [['.claude/.gitignore', '3'], ['a/b/.gitignore', '3'], ['.git/info/exclude', '3'],
        ['.config/ignore', '3'], ['.git/hooks/pre-commit', '4']] as const) {
        const got = callIsProtected(file, root, p);
        expect([got.protected, got.step], `${kind} ${p}`).toEqual([true, step]);
      }
      // ⑦ excludesFile 指向项目外：序 1 先命中，不保护；项目内 .config/ignore 不再是保护范围来源
      const outsideIgnore = join(tempRoot(), 'global-ignore');
      writeFileSync(outsideIgnore, '*.log\n');
      expect(git(root, ['config', 'core.excludesFile', outsideIgnore]).status).toBe(0);
      const d7 = callIsProtected(file, root, outsideIgnore);
      expect([d7.protected, d7.step], `${kind} ⑦`).toEqual([false, '1']);
      expect(callIsProtected(file, root, '.config/ignore').step, `${kind} 外部 excludesFile 时 .config/ignore`).not.toBe('3');
    }
    // ⑥ 分发源 WHITELIST_PREFIXES 不含 .gitignore
    const src = readFileSync(GUARD_SRC, 'utf-8');
    const table = /\nWHITELIST_PREFIXES=\(\n([\s\S]*?)\n\)/.exec(src)![1];
    expect(table.split('\n').map(l => l.trim())).not.toContain('".gitignore"');
    expect(table).not.toContain('.gitignore');
  }, TIMEOUT);

  it('UT-S09-387: 被忽略规格仍保护、被忽略目录下已跟踪文件仍保护', () => {
    const file = region();
    const { root } = fixture('G-ignored-spec');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist/app.dmg'), 'dmg\n');
    expect(git(root, ['add', '-f', 'dist/app.dmg']).status).toBe(0);
    expect(git(root, ['commit', '-qm', 'forced']).status).toBe(0);
    writeFileSync(join(root, 'logos/resources/prd/new.md'), '# new\n');
    expect(git(root, ['check-ignore', '-q', 'logos/resources/prd/new.md']).status, 'prd/new.md 应被忽略').toBe(0);
    // 命中序号以 spec/pretooluse-guard.md 十步表为准（测试规格本行沿用旧编号，见切片汇报）
    const cases: Array<[string, boolean, string]> = [
      ['logos/resources/test/t.md', true, '7'],
      ['logos/resources/prd/new.md', true, '7'],
      ['logos/resources/reference/r.md', false, '6'],
      ['dist/app.dmg', true, '8'],
      ['dist/other.txt', false, '9'],
    ];
    for (const [p, prot, step] of cases) {
      const got = callIsProtected(file, root, p);
      expect([got.protected, got.step], `${p}（${got.reason}）`).toEqual([prot, step]);
    }
  }, TIMEOUT);

  it('UT-S09-388: guard.exempt 缺省 / 显式 / 空数组 / 语法拒绝', () => {
    const file = region();
    const { root } = fixture('G-repo');
    const staging = 'logos/resources/verify/baseline-seed-runs/r1/staging/a.md';
    const verdicts = () => ['logos/resources/reference/a.md', 'docs/notes/a.md', staging]
      .map(p => callIsProtected(file, root, p).protected);
    setGuardConfig(root, undefined);
    expect(verdicts(), '缺省').toEqual([false, true, false]);
    setGuardConfig(root, { exempt: ['docs/notes/'] });
    expect(verdicts(), '显式 docs/notes/').toEqual([true, false, true]);
    setGuardConfig(root, { exempt: [] });
    expect(verdicts(), '[] 不回落内置默认').toEqual([true, true, true]);
    setGuardConfig(root, { exempt: ['src/'] });
    const src = callIsProtected(file, root, 'src/a.js');
    expect([src.protected, src.step], 'src/ 合法').toEqual([false, '6']);
    expect(src.stderr).not.toContain('非法条目');

    // 保护范围来源、logos.config.json 与 .git/ 条目被校验拒绝：跳过并警告，目标仍受保护
    const rejected: Array<[string, string]> = [
      ['.gitignore', '.gitignore'], ['.git/info/exclude', '.git/info/exclude'], ['a/.gitignore', 'a/.gitignore'],
      ['logos/logos.config.json', 'logos/logos.config.json'], ['.git/', '.git/config'],
    ];
    for (const [entry, target] of rejected) {
      setGuardConfig(root, { exempt: [entry] });
      const got = callIsProtected(file, root, target);
      expect(got.protected, `${entry} 不得豁免 ${target}`).toBe(true);
      // 不可豁免项在第 2–4 步即返回、不读取 exempt；经第 6 步的普通路径触发读取，非法条目跳过并警告
      const probe = callIsProtected(file, root, 'docs/x.md');
      expect(probe.stderr, `${entry} 应警告`).toContain(`guard.exempt 非法条目已跳过：${entry}`);
    }
    // 校验函数直接判定（真实实现）：上述条目与其余语法非法形态均拒绝，合法形态通过
    const check = (entry: string) => spawnSync('bash', ['-c', 'source "$1"; exempt_entry_invalid_reason "$2" >/dev/null', 'fn', file, entry],
      { cwd: root, encoding: 'utf-8', env: cleanEnv() }).status;
    for (const bad of [...rejected.map(r => r[0]), '/abs/x', 'C:/x', 'a\\b', '', '/', '*', '*/', 'a/../b', './a', 'a//b',
      'a/b*/', 'logos/.openlogos-runtime/', 'logos/.openlogos-runtime/x', '.git']) {
      expect(check(bad), `应拒绝：${JSON.stringify(bad)}`).toBe(0);
    }
    for (const good of ['src/', 'docs/notes/', 'logos/', 'a/*/b/', 'logos/resources/reference/', 'notes.md']) {
      expect(check(good), `应接受：${good}`).toBe(1);
    }
  }, TIMEOUT);

  it('UT-S09-389: 前提不满足时新判据不启用（N-repo / N-nogit / 活跃提案 / initial）', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as { cases: Array<{ fixture: string; key: string; exit: number }> };
    const inputs = BASELINE_INPUTS.filter(i => i.key === 'Write src/a.js' || i.key === 'Bash sed -i src/a.js');
    for (const kind of ['N-repo', 'N-nogit'] as FixtureKind[]) {
      const { root, pathEnv } = fixture(kind);
      const file = region();
      expect(callIsProtected(file, root, 'src/a.js', pathEnv).step, `${kind} 应走回落`).toBe('fallback');
      for (const item of inputs) {
        const want = baseline.cases.find(c => c.fixture === kind && c.key === item.key)!;
        expect(want, `${kind} ${item.key} 基准缺失`).toBeDefined();
        const r = runGuard(GUARD_SRC, root, item.tool, materialize(item.input, root), { pathEnv });
        expect(r.exitCode, `${kind} ${item.key}`).toBe(want.exit);
      }
    }
    // 活跃提案：plan 阶段 delta 收窄不变，非 delta 写入放行
    const { root: active } = fixture('G-repo');
    writeFileSync(join(active, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
    mkdirSync(join(active, 'logos/changes/x'), { recursive: true });
    expect(runGuard(GUARD_SRC, active, 'Write', { file_path: 'src/a.js', content: 'x' }).exitCode).toBe(0);
    expect(runGuard(GUARD_SRC, active, 'Bash', { command: 'sed -i s/a/b/ src/a.js' }).exitCode).toBe(0);
    expect(runGuard(GUARD_SRC, active, 'Write', { file_path: 'logos/changes/x/deltas/api/a.yaml', content: 'x' }).exitCode).toBe(2);
    expect(runGuard(GUARD_SRC, active, 'Write', { file_path: 'logos/changes/x/deltas/prd/2-product-design/2-page-design/p.html', content: 'x' }).exitCode).toBe(0);
    writeFileSync(join(active, 'logos/changes/x/PLAN_APPROVED'), '');
    expect(runGuard(GUARD_SRC, active, 'Write', { file_path: 'logos/changes/x/deltas/api/a.yaml', content: 'x' }).exitCode).toBe(0);
    // initial：放行
    const { root: initial } = fixture('G-repo');
    writeFileSync(join(initial, 'logos/logos-project.yaml'), 'project:\n  name: "g"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: initial\n');
    expect(runGuard(GUARD_SRC, initial, 'Write', { file_path: 'src/a.js', content: 'x' }).exitCode).toBe(0);
    expect(runGuard(GUARD_SRC, initial, 'Bash', { command: 'sed -i s/a/b/ src/a.js' }).exitCode).toBe(0);
  }, TIMEOUT);

  it('UT-S09-392: Edit / Write / MultiEdit / NotebookEdit 事前判定', () => {
    const { root } = fixture('G-repo');
    const blocked: Array<[string, Record<string, unknown>, string]> = [
      ['Write', { file_path: 'src/new.js', content: 'x' }, '未被忽略的新文件'],
      ['Edit', { file_path: 'src/a.js', old_string: 'a', new_string: 'b' }, '已跟踪'],
      ['MultiEdit', { file_path: 'logos/resources/prd/x.md', edits: [] }, '规格目录'],
      ['Edit', { file_path: '.gitignore', old_string: 'a', new_string: 'b' }, '忽略规则来源'],
    ];
    for (const [tool, input, why] of blocked) {
      const r = runGuard(GUARD_SRC, root, tool, input);
      expectBlockedRun(r, `${tool} ${String(input.file_path)}`);
      expect(r.stderr, `${tool} 命中原因`).toContain(`命中原因：${why}`);
    }
    expect(runGuard(GUARD_SRC, root, 'NotebookEdit', { notebook_path: 'dist/n.ipynb', new_source: 'x' }).exitCode).toBe(0);
    expect(runGuard(GUARD_SRC, root, 'Write', { file_path: 'dist/a.txt', content: 'x' }).exitCode).toBe(0);
    // 依赖 / 构建产物目录的未忽略新文件：附 openlogos ignore add 提示
    const build = runGuard(GUARD_SRC, root, 'Write', { file_path: 'build/out.js', content: 'x' });
    expect(build.exitCode).toBe(2);
    expect(build.stderr).toContain('openlogos ignore add');
    // 活跃提案（delta-writing）：按提案期判定放行，与修改前一致
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
    mkdirSync(join(root, 'logos/changes/x'), { recursive: true });
    writeFileSync(join(root, 'logos/changes/x/PLAN_APPROVED'), '');
    expect(runGuard(GUARD_SRC, root, 'Write', { file_path: 'src/a.js', content: 'x' }).exitCode).toBe(0);
    // guard 自有状态：任何提案状态与 lifecycle 下文件工具写入恒阻断
    expect(runGuard(GUARD_SRC, root, 'Write', { file_path: 'logos/.openlogos-runtime/x.json', content: 'x' }).exitCode).toBe(2);
    writeFileSync(join(root, 'logos/logos-project.yaml'), 'project:\n  name: "g"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: initial\n');
    expect(runGuard(GUARD_SRC, root, 'Edit', { file_path: 'logos/.openlogos-runtime/x.json', old_string: 'a', new_string: 'b' }).exitCode).toBe(2);
    expect(runGuard(GUARD_SRC, root, 'Write', { file_path: 'src/a.js', content: 'x' }).exitCode).toBe(0);
  }, TIMEOUT);

  it('UT-S09-409: 配置异常保守处理（G-repo 与 N-repo）', () => {
    const file = region();
    for (const kind of ['G-repo', 'N-repo'] as FixtureKind[]) {
      const { root } = fixture(kind);
      const ref = 'logos/resources/reference/x.md';
      const cases: Array<[string, unknown, boolean, boolean]> = [
        ['无 guard 字段', undefined, false, false],
        ['guard: {}', {}, false, false],
        ['guard.exempt: []', { exempt: [] }, true, false],
        ['guard: "x"', 'x', true, true],
        ['guard.exempt: "docs/"', { exempt: 'docs/' }, true, true],
      ];
      for (const [label, guard, prot, warn] of cases) {
        setGuardConfig(root, guard);
        const got = callIsProtected(file, root, ref);
        expect(got.protected, `${kind} ${label}`).toBe(prot);
        if (warn) expect(got.stderr, `${kind} ${label} 警告`).toContain('配置异常');
        else expect(got.stderr, `${kind} ${label} 不应警告`).not.toContain('警告');
      }
      // 先显式 [] 再损坏：视为 []，不回落内置默认
      setGuardConfig(root, { exempt: [] });
      setGuardConfig(root, 'CORRUPT');
      const corrupt = callIsProtected(file, root, ref);
      expect(corrupt.protected, `${kind} 损坏`).toBe(true);
      expect(corrupt.stderr).toContain('配置异常（无法解析）');
      // 非法条目跳过并警告，其余生效
      setGuardConfig(root, { exempt: ['../x', 'docs/'] });
      const mixed = callIsProtected(file, root, ref);
      expect(mixed.protected, `${kind} 含非法条目时 reference`).toBe(true);
      expect(mixed.stderr).toContain('guard.exempt 非法条目已跳过：../x');
      const docs = callIsProtected(file, root, 'docs/a.md');
      expect([docs.protected, docs.step], `${kind} docs/ 生效`).toEqual([false, '6']);
    }
  }, TIMEOUT);

  it('UT-S09-412: 非 git 回落的四处保守修改（N-repo / N-nogit）', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as { cases: Array<{ fixture: string; key: string; exit: number }> };
    for (const kind of ['N-repo', 'N-nogit'] as FixtureKind[]) {
      const { root, pathEnv } = fixture(kind);
      const blocked: Array<[string, Record<string, unknown>]> = [
        ['Edit', { file_path: '.gitignore', old_string: 'a', new_string: 'b' }],
        ['Write', { file_path: '.claude/.gitignore', content: 'x' }],
        ['Write', { file_path: 'logos/logos.config.json', content: '{}' }],
        ['Write', { file_path: 'logos/.openlogos-runtime/x', content: 'x' }],
      ];
      if (kind === 'N-nogit') blocked.push(['Write', { file_path: '.git/config', content: 'x' }]);
      for (const [tool, input] of blocked) expectBlockedRun(runGuard(GUARD_SRC, root, tool, input, { pathEnv }), `${kind} ${tool} ${String(input.file_path)}`);
      // reference：缺省 exit 0 / 显式 [] exit 2 / 配置损坏 exit 2
      const ref = { file_path: 'logos/resources/reference/a.md', content: 'x' };
      setGuardConfig(root, undefined);
      expect(runGuard(GUARD_SRC, root, 'Write', ref, { pathEnv }).exitCode, `${kind} 缺省`).toBe(0);
      setGuardConfig(root, { exempt: [] });
      expect(runGuard(GUARD_SRC, root, 'Write', ref, { pathEnv }).exitCode, `${kind} []`).toBe(2);
      setGuardConfig(root, 'CORRUPT');
      const corrupt = runGuard(GUARD_SRC, root, 'Write', ref, { pathEnv });
      expect(corrupt.exitCode, `${kind} 损坏`).toBe(2);
      expect(corrupt.stderr).toContain('配置异常');
      setGuardConfig(root, undefined);
      // sed -i 与 npm ci：与修改前分发源实测基准相同（安全白名单先判、解析不出即阻断）
      for (const key of ['Bash sed -i src/a.js', 'Bash npm ci']) {
        const item = BASELINE_INPUTS.find(i => i.key === key)!;
        const want = baseline.cases.find(c => c.fixture === kind && c.key === key)!.exit;
        expect(runGuard(GUARD_SRC, root, item.tool, item.input, { pathEnv }).exitCode, `${kind} ${key}`).toBe(want);
      }
      // 受限命令（切片 2，C14）：default → ask；bypassPermissions → exit 2（回落模式同样生效）
      expectScopeApproval(root, kind, pathEnv);
      // 不生成执行记录（回落不拍快照、不调用引擎）
      expect(existsSync(join(root, 'logos/.openlogos-runtime/guard-records')), `${kind} guard-records`).toBe(false);
    }
  }, TIMEOUT);
});

/* ─────────────────────────── 场景 ST ─────────────────────────── */

describe('S09-F 受保护判定 — 场景', () => {
  it('ST-S09-153: exempt 与项目外路径放行（Edit/Write 与可提取目标的 Bash）', () => {
    const { root } = fixture('G-repo');
    const outside = tempRoot();
    mkdirSync(join(outside, 'x'), { recursive: true });
    expect(hookedWrite(root, 'Write', 'logos/resources/reference/n.md', 'n\n')).toBe(0);
    const rm = runGuard(GUARD_SRC, root, 'Bash', { command: `rm -rf ${join(outside, 'x')}` });
    expect(rm.exitCode).toBe(0);
    spawnSync('bash', ['-c', `rm -rf ${join(outside, 'x')}`]);
    expect(existsSync(join(outside, 'x'))).toBe(false);
    expect(hookedWrite(root, 'Write', join(outside, 'y.md'), 'y\n')).toBe(0);
    // 可提取目标位于 exempt 内的 Bash 同样放行（staging 默认豁免）
    expect(runGuard(GUARD_SRC, root, 'Bash', { command: 'mkdir -p logos/resources/verify/baseline-seed-runs/r1/staging' }).exitCode).toBe(0);
    expect(runGuard(GUARD_SRC, root, 'Bash', { command: 'touch logos/resources/verify/baseline-seed-runs/r1/staging/a.md' }).exitCode).toBe(0);
    // 解析不出写入目标的形态（切片 3）：事前放行，由事后检查兜底；目标在 exempt 内 → 事后不报告
    const staging = 'logos/resources/verify/baseline-seed-runs/r1/staging';
    for (const [cmd, exec] of [
      ['sed -i s/a/b/ logos/resources/reference/n.md', sedExec('s/a/b/', 'logos/resources/reference/n.md')],
      [`mkdir -p ${staging} && touch ${staging}/a.md`, `mkdir -p ${staging} && touch ${staging}/a.md`],
    ]) {
      const c = chain(root, cmd, { exec });
      expect(c.pre.exitCode, cmd).toBe(0);
      expect(c.exec!.status, cmd).toBe(0);
      expect(c.post!.exitCode, `${cmd}：${c.post!.stderr}`).toBe(0);
    }
    expect(readFileSync(join(root, 'logos/resources/reference/n.md'), 'utf-8')).toBe('n\n');
    expect(existsSync(join(root, staging, 'a.md'))).toBe(true);
  }, TIMEOUT);

  it('ST-S09-155: Edit / Write 阻断矩阵（目标字节不变）', () => {
    const { root } = fixture('G-repo');
    expect(hookedWrite(root, 'Edit', 'src/a.js', 'changed\n')).toBe(2);
    expect(hookedWrite(root, 'Write', 'src/new.js', 'x\n')).toBe(2);
    expect(hookedWrite(root, 'Write', 'newdir/x.txt', 'x\n')).toBe(2);
    expect(hookedWrite(root, 'MultiEdit', 'logos/resources/prd/x.md', 'x\n')).toBe(2);
    expect(hookedWrite(root, 'Edit', '.gitignore', '*\n')).toBe(2);
    expect(git(root, ['status', '--porcelain']).stdout.trim(), '工作树应无变化').toBe('');
  }, TIMEOUT);

  it('ST-S09-172: 被忽略规格与被忽略目录下已跟踪文件仍受保护（Edit/Write 事前）', () => {
    const { root } = fixture('G-ignored-spec');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist/app.dmg'), 'dmg\n');
    expect(git(root, ['add', '-f', 'dist/app.dmg']).status).toBe(0);
    expect(git(root, ['commit', '-qm', 'forced']).status).toBe(0);
    expect(hookedWrite(root, 'Write', 'logos/resources/test/t.md', 'x\n')).toBe(2);
    expect(hookedWrite(root, 'Write', 'logos/resources/prd/new.md', 'x\n')).toBe(2);
    expect(hookedWrite(root, 'Write', 'logos/resources/reference/r.md', 'r\n')).toBe(0);
    expect(hookedWrite(root, 'Write', 'dist/app.dmg', 'evil\n')).toBe(2);
    expect(hookedWrite(root, 'Write', 'dist/other.txt', 'o\n')).toBe(0);
    expect(readFileSync(join(root, 'dist/app.dmg'), 'utf-8')).toBe('dmg\n');
    // Bash node -e（切片 3）：事前放行，事后 exit 2 报告被忽略规格与被忽略目录下已跟踪文件
    for (const rel of ['logos/resources/test/t.md', 'dist/app.dmg']) {
      const c = chain(root, `node -e "require('fs').writeFileSync('${rel}','evil')"`);
      expect(c.pre.exitCode, rel).toBe(0);
      expect(c.post!.exitCode, rel).toBe(2);
      expect(c.post!.stderr, rel).toContain(rel);
      expect(JSON.parse(c.post!.stdout).reason, rel).toContain(rel);
    }
  }, TIMEOUT);

  it('ST-S09-173: 非 git 回落——重放输入与修改前基准逐条相同，四处保守修改生效，不生成执行记录', () => {
    const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf-8')) as { generated_from: string; cases: Array<{ fixture: string; key: string; exit: number }> };
    expect(baseline.generated_from).toMatch(/^plugin\/bin\/guard-check@/);
    for (const kind of ['N-repo', 'N-nogit'] as FixtureKind[]) {
      // ① 每条输入用全新夹具重放：经 PreToolUse，放行的 Bash 真实执行
      for (const item of BASELINE_INPUTS) {
        const { root, pathEnv } = fixture(kind);
        const input = materialize(item.input, root);
        const r = runGuard(GUARD_SRC, root, item.tool, input, { pathEnv });
        const want = baseline.cases.find(c => c.fixture === kind && c.key === item.key);
        expect(want, `${kind} ${item.key} 基准缺失`).toBeDefined();
        expect(r.exitCode, `${kind} ${item.key}`).toBe(want!.exit);
        if (r.exitCode === 2) expectBlockedRun(r, `${kind} ${item.key}`);
        if (r.exitCode === 0 && item.tool === 'Bash') {
          spawnSync('bash', ['-c', String(input.command)], { cwd: root, encoding: 'utf-8', timeout: 60_000, env: cleanEnv() });
        }
        // ④ 每条均补发 PostToolUse（分发源引擎）：非 git 回落下一律 exit 0、不报告
        const post = spawnSync('node', [ENGINE_SRC, 'check'], {
          input: JSON.stringify({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: item.tool, tool_input: input, tool_use_id: `t-${item.key}`, cwd: root }),
          cwd: root, encoding: 'utf-8', timeout: 60_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...(pathEnv !== undefined ? { PATH: pathEnv } : {}) }),
        });
        expect(post.status, `${kind} ${item.key} PostToolUse`).toBe(0);
        expect(post.stderr, `${kind} ${item.key} PostToolUse`).toBe('');
        expect(existsSync(join(root, 'logos/.openlogos-runtime/guard-records')), `${kind} ${item.key} guard-records`).toBe(false);
      }
      // ② 四处保守修改中的路径类
      const { root, pathEnv } = fixture(kind);
      for (const [tool, rel] of [['Edit', '.gitignore'], ['Write', '.claude/.gitignore'], ['Write', 'logos/logos.config.json'],
        ['Write', 'logos/.openlogos-runtime/x']] as const) {
        expect(hookedWrite(root, tool, rel, 'x\n', pathEnv), `${kind} ${tool} ${rel}`).toBe(2);
      }
      // ③ 受限命令（切片 2，C14）：default → ask / bypassPermissions → exit 2（④ 见上方逐条补发的 PostToolUse）
      expectScopeApproval(root, kind, pathEnv);
      expect(existsSync(join(root, 'logos/.openlogos-runtime/guard-records'))).toBe(false);
    }
  }, 300_000);

  it('ST-S09-181: 不可豁免项在白名单与 exempt 目录内仍受保护', () => {
    const { root } = fixture('G-repo');
    mkdirSync(join(root, 'logos/.openlogos-runtime'), { recursive: true });
    writeFileSync(join(root, 'logos/.openlogos-runtime/pending-reports.jsonl'), '{}\n');
    setGuardConfig(root, { exempt: ['docs/'] });
    expect(git(root, ['commit', '-qam', 'exempt docs']).status).toBe(0);
    expect(hookedWrite(root, 'Write', 'docs/.gitignore', '*\n')).toBe(2);
    expect(hookedWrite(root, 'Write', 'docs/a.md', 'a\n'), '对照：exempt docs/ 下普通文件').toBe(0);
    setGuardConfig(root, { exempt: ['logos/'] });
    expect(git(root, ['commit', '-qam', 'exempt logos']).status).toBe(0);
    const cfgBefore = readFileSync(join(root, 'logos/logos.config.json'), 'utf-8');
    expect(hookedWrite(root, 'Edit', 'logos/logos.config.json', '{}')).toBe(2);
    expect(readFileSync(join(root, 'logos/logos.config.json'), 'utf-8')).toBe(cfgBefore);
    expect(hookedWrite(root, 'Write', '.claude/.gitignore', '*\n')).toBe(2);
    expect(hookedWrite(root, 'Write', 'logos/.openlogos-runtime/guard-records/x.json', '{}')).toBe(2);
    const rm = runGuard(GUARD_SRC, root, 'Bash', { command: 'rm logos/.openlogos-runtime/pending-reports.jsonl' });
    expectBlockedRun(rm, 'Bash rm 运行时目录');
    expect(existsSync(join(root, 'logos/.openlogos-runtime/pending-reports.jsonl'))).toBe(true);
    // node -e 写 docs/.gitignore（exempt docs/ 之下的不可豁免项）：事前放行、事后 exit 2（切片 3）
    setGuardConfig(root, { exempt: ['docs/'] });
    expect(git(root, ['commit', '-qam', 'exempt docs again']).status).toBe(0);
    const c = chain(root, "node -e \"require('fs').writeFileSync('docs/.gitignore','*\\n')\"");
    expect(c.pre.exitCode).toBe(0);
    expect(c.post!.exitCode).toBe(2);
    expect(c.post!.stderr).toContain('docs/.gitignore');
    // 被忽略目录（dist/）之内的 .gitignore：exempt dist/ 也不可豁免；可确定目标事前 exit 2（第 3 步先于「被忽略」），
    // node -e 间接改写事前放行、事后 exit 2（快照独立收集任意层级的 .gitignore）
    setGuardConfig(root, { exempt: ['docs/', 'dist/'] });
    expect(git(root, ['commit', '-qam', 'exempt dist']).status).toBe(0);
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist/.gitignore'), 'keep\n');
    expect(git(root, ['check-ignore', '-q', 'dist/.gitignore']).status).toBe(0);
    expect(hookedWrite(root, 'Write', 'dist/.gitignore', '*\n'), 'Write dist/.gitignore').toBe(2);
    expectBlockedRun(runGuard(GUARD_SRC, root, 'Bash', { command: 'echo x >> dist/.gitignore' }), 'Bash echo >> dist/.gitignore');
    expect(readFileSync(join(root, 'dist/.gitignore'), 'utf-8')).toBe('keep\n');
    const d = chain(root, "node -e \"require('fs').writeFileSync('dist/.gitignore','*\\n')\"");
    expect(d.pre.exitCode).toBe(0);
    expect(d.post!.exitCode).toBe(2);
    expect(d.post!.stderr).toContain('dist/.gitignore（内容变化）');
    expect(hookedWrite(root, 'Write', 'dist/a.txt', 'a\n'), '对照：被忽略目录下普通文件').toBe(0);
    // guard 自有状态：Bash 可确定目标的写入在 initial 与有活跃提案时同样恒阻断
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
    expectRuntimeBlocked(runGuard(GUARD_SRC, root, 'Bash', { command: 'rm logos/.openlogos-runtime/pending-reports.jsonl' }), '有提案');
    rmSync(join(root, 'logos/.openlogos-guard'));
    writeFileSync(join(root, 'logos/logos-project.yaml'), 'project:\n  name: "g"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: initial\n');
    expectRuntimeBlocked(runGuard(GUARD_SRC, root, 'Bash', { command: 'echo x > logos/.openlogos-runtime/reported.jsonl' }), 'initial');
    expectRuntimeBlocked(runGuard(GUARD_SRC, root, 'PowerShell', { command: 'Remove-Item logos\\.openlogos-runtime\\x' }), 'initial PowerShell');
    expect(runGuard(GUARD_SRC, root, 'Bash', { command: 'cat logos/.openlogos-runtime/pending-reports.jsonl' }).exitCode, '只读不阻断').toBe(0);
    expect(existsSync(join(root, 'logos/.openlogos-runtime/pending-reports.jsonl'))).toBe(true);
  }, TIMEOUT);

  it('ST-S09-182: 显式 exempt [] 后配置损坏，reference 仍受保护（G-repo 与 N-repo 同判）', () => {
    const verdicts: number[] = [];
    for (const kind of ['G-repo', 'N-repo'] as FixtureKind[]) {
      const { root } = fixture(kind);
      setGuardConfig(root, { exempt: [] });
      setGuardConfig(root, 'CORRUPT');
      const r = runGuard(GUARD_SRC, root, 'Write', { file_path: 'logos/resources/reference/x.md', content: 'x' });
      expectBlockedRun(r, `${kind} reference`);
      expect(r.stderr, `${kind} 配置警告`).toContain('配置异常');
      expect(existsSync(join(root, 'logos/resources/reference/x.md'))).toBe(false);
      verdicts.push(r.exitCode);
      if (kind === 'G-repo') {
        // ④ Bash node -e 写 reference/y.md：事前放行、PostToolUse exit 2 报告 y.md（切片 3）
        const c = chain(root, "node -e \"require('fs').writeFileSync('logos/resources/reference/y.md','y')\"");
        expect(c.pre.exitCode).toBe(0);
        expect(c.post!.exitCode).toBe(2);
        expect(c.post!.stderr).toContain('logos/resources/reference/y.md');
      }
    }
    expect(verdicts).toEqual([2, 2]);
  }, TIMEOUT);
});
