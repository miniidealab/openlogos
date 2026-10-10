/**
 * S09 guard 模式表的 ERE 解释与跨平台同判（fix-guard-tee-pattern-linux，切片 slice-01-guard-tee-literal）。
 *
 * 覆盖 UT-S09-459、UT-S09-460，对应根规范 `spec/pretooluse-guard.md`「Bash 模式表的 ERE 解释与跨平台同判（规范性）」。
 * 修改前 `BASH_WRITE_PATTERNS` 的 `"| tee "` 以未转义的 `|` 开头，在 `grep -E` 下是空分支：GNU grep（Linux / CI）
 * 匹配任意输入，BSD grep（macOS）什么都不匹配。UT-S09-459 是与平台无关的静态守卫（macOS 上也能拦住此类写法）；
 * UT-S09-460 的行为矩阵在 Linux 上对旧实现必红，跨平台证据来自 Linux 干净克隆 / CI 上的同一用例。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GUARD_SRC, REPO_ROOT, cleanEnv } from './s09-guard-vcs-fixtures.js';

const OLD_GUARD_FIXTURE = join(REPO_ROOT, 'cli', 'test', 'fixtures', 's09-guard-pre-segmented.sh');
const TIMEOUT = 120_000;
const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

function temp(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `openlogos-tee-${tag}-`));
  roots.push(d);
  return d;
}

/** 解析 guard-check 源码中 `NAME=( "…" … )` 数组的条目，按 bash 双引号规则还原为传给 grep -E 的正则。 */
function patternArray(source: string, name: string): string[] {
  const start = source.indexOf(`${name}=(`);
  if (start === -1) throw new Error(`guard-check 中找不到 ${name}`);
  const end = source.indexOf('\n)', start);
  const body = source.slice(start, end);
  const entries: string[] = [];
  for (const m of body.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*$/gm)) {
    entries.push(m[1].replace(/\\(["\\$`])/g, '$1'));
  }
  return entries;
}

/**
 * ERE 空分支检查：未转义、且不在方括号表达式内的 `|` 不得位于开头或结尾，不得与另一个 `|` 相邻，
 * 也不得紧邻 `(` 之后或 `)` 之前。返回违规说明（空即合规）。
 */
function emptyAlternativeProblems(pattern: string): string[] {
  const bars: number[] = [];
  const opens = new Set<number>();
  const closes = new Set<number>();
  let inBracket = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { i++; continue; }
    if (inBracket) { if (c === ']') inBracket = false; continue; }
    if (c === '[') { inBracket = true; if (pattern[i + 1] === ']') i++; continue; }
    if (c === '|') bars.push(i);
    else if (c === '(') opens.add(i);
    else if (c === ')') closes.add(i);
  }
  const problems: string[] = [];
  const barSet = new Set(bars);
  for (const i of bars) {
    if (i === 0) problems.push('以未转义 | 开头');
    if (i === pattern.length - 1) problems.push('以未转义 | 结尾');
    if (barSet.has(i + 1)) problems.push('相邻的未转义 ||');
    if (opens.has(i - 1)) problems.push('( 之后紧跟 |');
    if (closes.has(i + 1)) problems.push('| 之后紧跟 )');
  }
  return problems;
}

function violations(source: string): Array<{ table: string; pattern: string; problems: string[] }> {
  const out: Array<{ table: string; pattern: string; problems: string[] }> = [];
  for (const table of ['BASH_SAFE_PATTERNS', 'BASH_WRITE_PATTERNS']) {
    for (const pattern of patternArray(source, table)) {
      const problems = emptyAlternativeProblems(pattern);
      if (problems.length > 0) out.push({ table, pattern, problems });
    }
  }
  return out;
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

function runGuard(root: string, command: string) {
  const r = spawnSync('bash', [GUARD_SRC], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, permission_mode: 'default' }),
    cwd: root, encoding: 'utf-8', timeout: 30_000, env: cleanEnv({ CLAUDE_PROJECT_DIR: root }),
  });
  return { exitCode: r.status ?? 1, stderr: r.stderr ?? '' };
}

describe('S09 guard 模式表的 ERE 解释与跨平台同判 — 单元测试', () => {
  it('UT-S09-459: 模式表无空分支（与平台无关的静态守卫）', () => {
    const current = readFileSync(GUARD_SRC, 'utf8');
    const safe = patternArray(current, 'BASH_SAFE_PATTERNS');
    const write = patternArray(current, 'BASH_WRITE_PATTERNS');
    expect(safe.length, 'BASH_SAFE_PATTERNS 解析为空').toBeGreaterThan(10);
    expect(write.length, 'BASH_WRITE_PATTERNS 解析为空').toBeGreaterThan(10);
    expect(violations(current)).toEqual([]);
    // 字面量「管道接 tee」条目在场（传给 grep -E 的正则为 `\| tee `）
    expect(write).toContain('\\| tee ');
    // 有意的交替两侧非空，不计为违规
    expect(safe).toContain('^ls |^ls$');
    expect(emptyAlternativeProblems('^ls |^ls$')).toEqual([]);
    // 守卫自身的判别力
    expect(emptyAlternativeProblems('a||b')).toContain('相邻的未转义 ||');
    expect(emptyAlternativeProblems('(|x)')).toContain('( 之后紧跟 |');
    expect(emptyAlternativeProblems('x|')).toContain('以未转义 | 结尾');
    expect(emptyAlternativeProblems('[|] tee ')).toEqual([]);
    // 旧实现必红：检出 "| tee " 一条违规
    const old = violations(readFileSync(OLD_GUARD_FIXTURE, 'utf8'));
    expect(old.map(v => [v.table, v.pattern])).toEqual([['BASH_WRITE_PATTERNS', '| tee ']]);
    expect(old[0].problems).toContain('以未转义 | 开头');
  });

  it('UT-S09-460: 非 git 回落的跨平台同判行为矩阵', () => {
    const root = nonGitProject();
    const outside = join(temp('outside'), 'f');
    const allowed = [
      // ① 未知单条命令：修改前在 GNU grep 上被空分支判为写入
      'make build', 'npm run release:local', 'python3 tools/x.py',
      // ② 只读复合命令
      'git status | head', 'ls | head',
    ];
    for (const c of allowed) expect(runGuard(root, c).exitCode, c).toBe(0);
    // ③ 管道写入受保护源码
    for (const c of ['cat src/x | tee src/a.ts', 'echo x | tee src/x']) {
      const r = runGuard(root, c);
      expect(r.exitCode, c).toBe(2);
      expect(r.stderr, c).toContain('变更管理拦截');
    }
    // ④ 管道写到项目外：测试规格写的是 exit 0，但 guard 对 `tee` 不做路径提取、沿用「解析不出即阻断」
    // （UT-S09-371：未命中安全白名单的 `tee` 维持无条件阻断；根规范本节不变量：路径提取与逐路径管辖判定不变），
    // 本修复不扩大放行范围，此处断言既有行为 exit 2。规格与 UT-S09-371 的矛盾待经增量修正统一（见交付说明）。
    expect(runGuard(root, `ls | tee ${outside}`).exitCode, 'ls | tee <项目外>').toBe(2);
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('a\n');
  }, TIMEOUT);
});
