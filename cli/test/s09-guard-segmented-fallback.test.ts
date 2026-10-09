/**
 * S09 guard 非 git 回落的复合命令逐段判定（verify-smoke-guard-fixes-0-15-20，切片 slice-03-guard-segmented-fallback）。
 *
 * 覆盖 UT-S09-448～UT-S09-454、ST-S09-202，对应根规范 `spec/pretooluse-guard.md`「Bash 非 git 回落的复合命令逐段判定
 * （规范性）」（拆段、逐段判定、有效工作目录及其条件链作用域）与场景 S09-F EX-9F.1、EX-9F.32～EX-9F.38。
 * 夹具：mkdtemp 下的非 git 项目（launched、无活跃提案，含 src/a.ts、src/x）；以真实 guard-check 脚本喂 PreToolUse
 * hook JSON，按退出码判定（0 放行、2 阻断）。旧实现对照取 `git show HEAD:plugin/bin/guard-check`。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENGINE_SRC, GUARD_SRC, REPO_ROOT, buildProject, cleanEnv, git } from './s09-guard-vcs-fixtures.js';

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const TIMEOUT = 120_000;

function temp(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `openlogos-seg-${tag}-`));
  roots.push(d);
  return d;
}

/** 非 git 夹具：launched、无活跃提案。 */
function nonGitProject(): string {
  const root = temp('proj');
  mkdirSync(join(root, 'logos'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'logos/logos-project.yaml'), 'project:\n  name: "t"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\n');
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', documents: {} }));
  writeFileSync(join(root, 'src/a.ts'), 'a\n');
  writeFileSync(join(root, 'src/x'), 'x\n');
  expect(spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf-8', env: cleanEnv() }).status, '夹具不应在 git 工作树内').not.toBe(0);
  return root;
}

function runGuard(guard: string, root: string, command: string) {
  const r = spawnSync('bash', [guard], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, permission_mode: 'default' }),
    cwd: root, encoding: 'utf-8', timeout: 30_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: root }),
  });
  return { exitCode: r.status ?? 1, stderr: r.stderr ?? '' };
}

/** 修改前的 guard-check（HEAD 版本），与引擎放在同一目录，保证 git 判据路径可用。 */
function oldGuard(): string {
  const dir = temp('old');
  const r = spawnSync('git', ['show', 'HEAD:plugin/bin/guard-check'], { cwd: REPO_ROOT, encoding: 'utf-8', env: cleanEnv() });
  expect(r.status, r.stderr).toBe(0);
  writeFileSync(join(dir, 'guard-check'), r.stdout);
  copyFileSync(ENGINE_SRC, join(dir, 'guard-post-check.cjs'));
  return join(dir, 'guard-check');
}

function expectExit(guard: string, root: string, commands: string[], exitCode: number): void {
  for (const c of commands) expect(runGuard(guard, root, c).exitCode, c).toBe(exitCode);
}

const sha = (path: string) => spawnSync('shasum', ['-a', '256', path], { encoding: 'utf-8' }).stdout.split(' ')[0];

describe('S09 guard 非 git 回落逐段判定 — 单元测试', () => {
  it('UT-S09-448: 以安全命令开头的复合写入被阻断', () => {
    const root = nonGitProject();
    const cmds = ['ls && rm -rf src', 'true; rm src/x', `cd ${root} && sed -i 's/a/b/' src/x`, 'pwd | tee src/x'];
    expectExit(GUARD_SRC, root, cmds, 2);
    // 旧实现前三条放行（本用例对旧实现必红）
    const old = oldGuard();
    for (const c of cmds.slice(0, 3)) expect(runGuard(old, root, c).exitCode, `旧实现 ${c}`).toBe(0);
    expect(runGuard(GUARD_SRC, root, 'ls && rm -rf src').stderr).toContain('变更管理拦截');
    // review r1 F1：仍命中白名单前缀（echo / cat / node -e）的写入段不得凭前缀放行
    expectExit(GUARD_SRC, root, [
      'ls && echo 内容 > src/a.ts', 'ls && echo 内容 >> src/a.ts', 'cat src/x > src/a.ts && ls', 'ls; echo x 2> src/a.ts',
      'ls && echo x >src/a.ts', `ls && node -e "require('fs').writeFileSync('src/a.ts','y')"`, 'ls && find . -exec sed -i s/a/b/ {} +',
    ], 2);
    // review r2 F1：目录切换段自身的重定向同样做目标判定，且按该段执行前的有效目录解析
    // （cd 目的地在项目外，重定向目标仍是原目录下的受保护源码）
    const away = temp('cd-away');
    expectExit(GUARD_SRC, root, [
      'cd src > src/a.ts && pwd', 'pushd src > src/a.ts && pwd', `cd ${away} > src/a.ts && pwd`, `cd ${away} >> src/a.ts; ls`,
    ], 2);
    expectExit(GUARD_SRC, root, ['cd src 2>/dev/null && cat a.ts', `cd ${away} > /dev/null && ls`, 'cd src >/dev/null 2>&1 && ls'], 0);
  }, TIMEOUT);

  it('UT-S09-449: 命令替换类结构中出现写入即阻断', () => {
    const root = nonGitProject();
    expectExit(GUARD_SRC, root, ['echo $(rm src/x)', 'echo `rm src/x`', 'cat <(rm src/x)', 'cat <<EOF > src/x\nhello\nEOF'], 2);
    // review r1 F2：双引号内的命令替换仍会执行 → 阻断；单引号 / 转义中的同形字符只是数据 → 按单条判定放行
    expectExit(GUARD_SRC, root, ['echo "$(rm src/x)"', 'echo "a `rm src/x` b"', "echo 'x' $(rm src/x)"], 2);
    expectExit(GUARD_SRC, root, ["echo '$(rm src/a.ts)'", "echo 'a `rm src/x` b'", "echo 'cat <<EOF > src/x'", 'echo \\$(rm src/x\\)', "echo '<(rm src/x)'"], 0);
  }, TIMEOUT);

  it('UT-S09-450: 只读复合命令与引号内分隔符放行', () => {
    const root = nonGitProject();
    expectExit(GUARD_SRC, root, ['ls && cat src/x', 'git status | head', 'echo "a && rm b"', "echo 'x; rm src/x'", 'ls 2>&1 | head'], 0);
    // review r1 F1：引号内的 > 不是重定向、/dev/null 与描述符复制不是写文件、项目外目标按真实目标放行、git push 等既有豁免保留
    const outside = join(temp('redir-out'), 'f');
    expectExit(GUARD_SRC, root, [
      'ls 2>/dev/null && cat src/x', 'cat src/x >/dev/null 2>&1; ls', 'echo "a > src/a.ts" && ls', 'ls >&2 && cat src/x',
      `ls && echo ok > ${outside}`, 'git add -A && git commit -m "x > y" && git push',
    ], 0);
  }, TIMEOUT);

  it('UT-S09-451: cd 后的相对写入按有效工作目录解析', () => {
    const root = nonGitProject();
    const outside = join(temp('outside'), 'x');
    expect(runGuard(GUARD_SRC, root, 'cd src && rm ../src/a.ts').exitCode, '有效目录推进后目标为受保护源码').toBe(2);
    expectExit(GUARD_SRC, root, ['cd src && cat a.ts', 'cd src && cat a.ts; cat x'], 0);
    expect(runGuard(GUARD_SRC, root, `cd src && rm ${outside}`).exitCode, '绝对目标在项目外').toBe(0);
  }, TIMEOUT);

  it('UT-S09-452: 目录切换不可确定后的写入一律阻断', () => {
    const root = nonGitProject();
    const before = readFileSync(join(root, 'src/a.ts'));
    expectExit(GUARD_SRC, root, [
      'cd src; rm ../src/a.ts', 'cd "$D" && rm a.ts', 'cd - && rm a.ts', 'cd a || cd b && rm x', 'popd && rm x', 'cd && rm x',
      // 条件链被结束的形态
      'cd /dev/null && true; rm src/a.ts', 'cd /dev/null && true\nrm src/a.ts', 'cd src && true || rm ../src/a.ts', 'cd src && ls & rm ../src/a.ts',
      // review r1 F1：不确定目录后的重定向写入（echo 前缀不再整组早退）
      'cd "$D" && echo 内容 > src/a.ts', 'cd src; echo x > ../src/a.ts', 'cd - && cat x > a.ts',
      // review r2 F1：不确定的目录切换段自身带重定向
      'cd "$D" > src/a.ts && pwd', 'popd > src/a.ts && pwd', 'cd - > src/a.ts; ls',
    ], 2);
    expect(readFileSync(join(root, 'src/a.ts')).equals(before), 'guard 只判定不执行').toBe(true);
  }, TIMEOUT);

  it('UT-S09-453: 单条命令判定逐字不变', () => {
    const root = nonGitProject();
    const outside = temp('single-out');
    const old = oldGuard();
    const singles = ['ls', 'cat src/x', 'rm src/x', `rm ${outside}/x`, `mkdir -p ${outside}/d`, 'echo hi > src/x',
      `echo hi > ${outside}/f`, 'openlogos status', 'git push', 'npm test', 'rm $X', "node -e \"require('fs').writeFileSync('src/a.ts','y')\"",
      // review r1 F2：单引号中的替换外形是数据，单条判定须与旧实现一致
      "echo '$(rm src/a.ts)'", "echo 'a `rm src/x` b'", "echo 'cat <<EOF > src/x'"];
    for (const c of singles) {
      const now = runGuard(GUARD_SRC, root, c);
      const was = runGuard(old, root, c);
      expect(now.exitCode, c).toBe(was.exitCode);
      expect(now.stderr, c).toBe(was.stderr);
    }
  }, TIMEOUT);

  it('UT-S09-454: git 判据生效时路径不变', () => {
    const old = oldGuard();
    for (const c of ['ls && rm -rf src', 'cd src && rm ../src/a.js', 'rm src/a.js', 'ls']) {
      const a = buildProject(temp('g-new'), 'G-repo');
      const b = buildProject(temp('g-old'), 'G-repo');
      expect(git(a, ['rev-parse', '--is-inside-work-tree']).stdout.trim()).toBe('true');
      const now = runGuard(GUARD_SRC, a, c);
      const was = runGuard(old, b, c);
      expect(now.exitCode, c).toBe(was.exitCode);
    }
  }, TIMEOUT);
});

describe('S09 guard 非 git 回落逐段判定 — 场景测试', () => {
  it('ST-S09-202: 非 git 回落逐段判定的端到端矩阵', () => {
    // 托管副本（openlogos sync 部署到 .claude/openlogos/bin/）与源模板逐字节一致
    const deployed = join(REPO_ROOT, '.claude/openlogos/bin/guard-check');
    expect(sha(deployed)).toBe(sha(GUARD_SRC));
    const root = nonGitProject();
    const outside = join(temp('st-out'), 'x');
    const blocked = [
      'ls && rm -rf src', 'true; rm src/x', `cd ${root} && sed -i 's/a/b/' src/x`, 'echo $(rm src/x)',
      'cd src && rm ../src/a.ts',
      'cd src; rm ../src/a.ts', 'cd "$D" && rm a.ts', 'cd - && rm a.ts', 'cd a || cd b && rm x',
      'cd /dev/null && true; rm src/a.ts', 'cd /dev/null && true\nrm src/a.ts', 'cd src && true || rm ../src/a.ts', 'cd src && ls & rm ../src/a.ts',
      // review r1 F1
      'ls && echo 内容 > src/a.ts', 'cd "$D" && echo 内容 > src/a.ts',
      // review r2 F1：目录切换段自身的重定向
      'cd src > src/a.ts && pwd', 'cd "$D" > src/a.ts && pwd', 'pushd src > src/a.ts && pwd',
    ];
    const allowed = ['ls && cat x', 'git status | head', 'echo "a && rm b"', 'cd src && cat a.ts', 'cd src && cat a.ts; cat b', `cd src && rm ${outside}`,
      // review r1 F2 / F1
      "echo '$(rm src/a.ts)'", 'ls 2>/dev/null && cat src/x', 'cd src >/dev/null && cat a.ts'];
    const before = { a: readFileSync(join(root, 'src/a.ts')), x: readFileSync(join(root, 'src/x')) };
    expectExit(deployed, root, blocked, 2);
    expectExit(deployed, root, allowed, 0);
    expect(readFileSync(join(root, 'src/a.ts')).equals(before.a)).toBe(true);
    expect(readFileSync(join(root, 'src/x')).equals(before.x)).toBe(true);
    // 旧实现在三条事故形态上放行（必红对照）
    const old = oldGuard();
    for (const c of ['ls && rm -rf src', 'true; rm src/x', 'cd src && rm ../src/a.ts']) expect(runGuard(old, root, c).exitCode, `旧实现 ${c}`).toBe(0);
  }, TIMEOUT);
});
