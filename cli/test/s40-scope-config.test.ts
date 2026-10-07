/**
 * guard-versioned-content-scope [code] 切片 2：版本管理范围配置（S40）。
 *
 * 覆盖 UT-S40-01～UT-S40-28、ST-S40-01～ST-S40-15（与 logos/resources/test/core-S40-test-cases.md 对齐）。
 * - UT 直接调用命令核心 `runScopeCommand`（文件写入口与进程调用层注入哨兵），或以函数层 / stdin JSON 调用分发源 guard-check；
 * - ST 走真实 CLI 入口（cli/dist/index.js）与真实 hook 脚本（plugin/bin/guard-check），隔离临时项目，执行前后做全项目 SHA-256 快照。
 * - 事后检查引擎（切片 3，PostToolUse `check`）相关断言以分发源引擎真实执行；Cursor 分层能力（切片 5）的断言不在本文件伪造。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeTempRoot } from './helpers.js';
import { GUARD_SRC, REPO_ROOT, buildProject, callIsProtected, cleanEnv, git, loadGuardRegion } from './s09-guard-vcs-fixtures.js';
import { chain, postToolUse } from './s09-guard-post-check-helpers.js';
import { defaultScopeIo, runScopeCommand, type ScopeExecResult, type ScopeIo } from '../src/commands/scope.js';
import {
  exemptEntryInvalidReason, exemptEntryMatches, parseExemptEntry,
} from '../src/lib/guard-scope-config.js';
import { MANAGED_END, MANAGED_NOTE, MANAGED_START } from '../src/lib/gitignore-managed-block.js';

const TIMEOUT = 120_000;
const CLI = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(() => { spawnSync('chmod', ['-R', 'u+rwx', root]); cleanup(); });
  return root;
}

/* ─────────────────────────── 夹具与工具 ─────────────────────────── */

function put(root: string, rel: string, content: string | Buffer): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

/** 最小项目：logos.config.json（可带 guard 字段）+ 可选 .gitignore；不 git init。 */
function project(opts: { guard?: unknown; gitignore?: string | Buffer | null; locale?: 'en' | 'zh' } = {}): string {
  const root = tempRoot();
  const cfg: Record<string, unknown> = { name: 'p', locale: opts.locale ?? 'en', description: '', documents: {} };
  if (opts.guard !== undefined) cfg.guard = opts.guard;
  put(root, 'logos/logos.config.json', `${JSON.stringify(cfg, null, 2)}\n`);
  if (opts.gitignore !== undefined && opts.gitignore !== null) put(root, '.gitignore', opts.gitignore);
  return root;
}

function gitInit(root: string): void {
  for (const args of [['init', '-q'], ['config', 'user.name', 'openlogos-test'], ['config', 'user.email', 'openlogos-test@example.invalid'],
    ['config', 'commit.gpgsign', 'false']]) {
    expect(git(root, args).status, `git ${args.join(' ')}`).toBe(0);
  }
}

function commitAll(root: string, msg = 'init'): void {
  expect(git(root, ['add', '-A']).status).toBe(0);
  expect(git(root, ['commit', '-qm', msg]).status).toBe(0);
}

function readCfg(root: string): Record<string, any> {
  return JSON.parse(readFileSync(join(root, 'logos/logos.config.json'), 'utf-8')) as Record<string, any>;
}

function sha(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** 全项目快照（不含 .git/）：相对路径 → SHA-256。 */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    const abs = join(root, rel);
    for (const name of readdirSync(abs)) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === '.git') continue;
      const st = statSync(join(root, r));
      if (st.isDirectory()) { out[`${r}/`] = 'dir'; walk(r); } else out[r] = sha(readFileSync(join(root, r)));
    }
  };
  walk('');
  return out;
}

function fileState(root: string, rel: string): { hash: string; mtime: number } | null {
  const p = join(root, rel);
  if (!existsSync(p)) return null;
  return { hash: sha(readFileSync(p)), mtime: statSync(p).mtimeMs };
}

interface Sentinel { io: Partial<ScopeIo>; writes: string[]; calls: string[][] }

/** 写入口与进程调用层哨兵：记录全部写盘目标与进程调用参数（进程调用仍真实执行，除非给 execStub）。 */
function sentinel(execStub?: (args: string[]) => ScopeExecResult | null): Sentinel {
  const writes: string[] = [];
  const calls: string[][] = [];
  const io: Partial<ScopeIo> = {
    write: {
      writeFileSync: (p, d) => { writes.push(p); defaultScopeIo.write.writeFileSync(p, d); },
      renameSync: (a, b) => { writes.push(b); defaultScopeIo.write.renameSync(a, b); },
      unlinkSync: p => defaultScopeIo.write.unlinkSync(p),
    },
    exec: (cmd, args, cwd) => {
      calls.push([cmd, ...args]);
      const stubbed = execStub?.(args);
      return stubbed ?? defaultScopeIo.exec(cmd, args, cwd);
    },
  };
  return { io, writes, calls };
}

function runCli(root: string, args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const r = spawnSync('node', [CLI, ...args], { cwd: root, encoding: 'utf-8', timeout: 60_000, env: cleanEnv() });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

interface HookRun { exitCode: number; stdout: string; stderr: string }

/** 以 Claude Code Bash PreToolUse 真实形态调用分发源 guard-check；mode 为 undefined 时不带 permission_mode 字段。 */
function preToolUse(root: string, command: string, mode: string | undefined, opts: { pathEnv?: string; tool?: string } = {}): HookRun {
  const input: Record<string, unknown> = {
    session_id: 's40-session', transcript_path: join(root, 'transcript.jsonl'), cwd: root,
    hook_event_name: 'PreToolUse', tool_name: opts.tool ?? 'Bash', tool_input: { command, description: 'x' },
    tool_use_id: `toolu_${Math.random().toString(36).slice(2)}`,
  };
  if (mode !== undefined) input.permission_mode = mode;
  const r = spawnSync('bash', [GUARD_SRC], {
    input: JSON.stringify(input), cwd: root, encoding: 'utf-8', timeout: 30_000,
    env: cleanEnv({ CLAUDE_PROJECT_DIR: root, ...(opts.pathEnv ? { PATH: opts.pathEnv } : {}) }),
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const ASK_REASON = (cmd: string) => `该命令会改变 guard 的保护范围（${cmd}），需要您确认后执行`;

function expectAsk(r: HookRun, cmd: string, label = cmd): void {
  expect(r.exitCode, `${label} exit`).toBe(0);
  const parsed = JSON.parse(r.stdout.trim()) as unknown;
  expect(parsed, label).toEqual({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: ASK_REASON(cmd) },
  });
}

function expectModeBlocked(r: HookRun, cmd: string, modeLabel: string): void {
  expect(r.exitCode, `${modeLabel} exit`).toBe(2);
  expect(r.stdout).not.toContain('permissionDecision');
  const reason = (JSON.parse(r.stdout) as { reason: string }).reason;
  for (const ch of [reason, r.stderr]) {
    expect(ch).toContain(`当前权限模式（${modeLabel}`);
    expect(ch).toContain(`! ${cmd}`);
    expect(ch).toContain('切换到默认权限模式后重试');
    expect(ch).toContain('不要用对话中的口头同意替代');
  }
}

function expectCompoundBlocked(r: HookRun, label: string): void {
  expect(r.exitCode, label).toBe(2);
  expect(r.stdout, label).not.toContain('permissionDecision');
  expect(r.stderr, label).toContain('保护范围变更命令必须单独执行');
}

/** launched、git、无提案的 G-repo 夹具（复用切片 1 夹具口径）。 */
function gRepo(): string {
  return buildProject(tempRoot(), 'G-repo');
}

function managedBlock(lines: string[], eol = '\n'): string {
  return [MANAGED_START, MANAGED_NOTE, 'logos/.openlogos-runtime/', ...lines, MANAGED_END].join(eol);
}

function noTempFiles(root: string): void {
  const all = Object.keys(snapshot(root));
  expect(all.filter(f => f.includes('openlogos-tmp')), '不应留下临时文件').toEqual([]);
}

/* ─────────────────────────── UT 1.1 清单语法、增删查与配置读写 ─────────────────────────── */

describe('S40 清单语法与增删查 — 单元', () => {
  it('UT-S40-01: exempt 合法路径语法（目录 / 文件 / * 单段）', () => {
    for (const e of ['docs/handbook/', 'docs/a.md', 'runs/*/staging/', 'a/b-1.x_y/']) {
      expect(exemptEntryInvalidReason(e), e).toBeNull();
    }
    expect(parseExemptEntry('docs/handbook/')?.kind).toBe('dir');
    expect(parseExemptEntry('a/b-1.x_y/')?.kind).toBe('dir');
    expect(parseExemptEntry('docs/a.md')?.kind).toBe('file');
    // 目录：完整段匹配本身及后代；文件：只匹配自身
    expect(exemptEntryMatches('docs/handbook/', 'docs/handbook/x/y.md')).toBe(true);
    expect(exemptEntryMatches('docs/handbook/', 'docs/handbook-old/a.md')).toBe(false);
    expect(exemptEntryMatches('docs/a.md', 'docs/a.md')).toBe(true);
    expect(exemptEntryMatches('docs/a.md', 'docs/a.md.bak')).toBe(false);
    // * 只匹配一个路径段，且段须以字母或数字开头
    expect(exemptEntryMatches('runs/*/staging/', 'runs/r-01/staging/x.md')).toBe(true);
    expect(exemptEntryMatches('runs/*/staging/', 'runs/a/b/staging/x.md')).toBe(false);
    expect(exemptEntryMatches('runs/*/staging/', 'runs/.hidden/staging/x.md')).toBe(false);
  });

  it('UT-S40-02: exempt 非法路径拒绝矩阵（点名条目与原因，零写入）', () => {
    const root = project({ gitignore: 'x\n' });
    const before = [fileState(root, 'logos/logos.config.json')!.hash, fileState(root, '.gitignore')!.hash];
    for (const bad of ['/abs/x', '../x', 'a/../b', './a', 'a//b', 'a\\b', '', '/', '*', 'a/*x*/', 'a/.hidden*/',
      'logos/.openlogos-runtime/x', '.gitignore', 'src/.gitignore', '.git/info/exclude', '.git/', '.git/hooks/pre-commit']) {
      const s = sentinel();
      const r = runScopeCommand('exempt', ['add', bad], root, s.io);
      expect(r.exitCode, JSON.stringify(bad)).toBe(1);
      expect(r.stderr, JSON.stringify(bad)).toContain(`Invalid exempt path "${bad}": `);
      expect(r.stderr.split(': ').length, '含原因').toBeGreaterThan(2);
      expect(s.writes, JSON.stringify(bad)).toEqual([]);
    }
    expect([fileState(root, 'logos/logos.config.json')!.hash, fileState(root, '.gitignore')!.hash]).toEqual(before);
  });

  it('UT-S40-03: ignore 非法模式拒绝矩阵（点名原因，零写入）', () => {
    const root = project({ gitignore: 'x\n' });
    const before = snapshot(root);
    const cases: Array<[string, string]> = [['', 'must not be empty'], ['a\nb', 'single line'], ['#dist', "must not start with '#' or '!'"],
      ['!dist/', "must not start with '#' or '!'"], ['a/../b', "'..'"]];
    for (const [bad, why] of cases) {
      const s = sentinel();
      const r = runScopeCommand('ignore', ['add', bad], root, s.io);
      expect(r.exitCode, JSON.stringify(bad)).toBe(1);
      expect(r.stderr).toContain(`Invalid ignore pattern "${bad}"`);
      expect(r.stderr).toContain(why);
      expect(s.writes).toEqual([]);
    }
    expect(snapshot(root)).toEqual(before);
  });

  it('UT-S40-04: 混合合法与非法条目整体拒绝，不发生部分写入', () => {
    const root = project({ gitignore: 'x\n' });
    const before = snapshot(root);
    const s = sentinel();
    const a = runScopeCommand('ignore', ['add', 'dist/', '!keep'], root, s.io);
    const b = runScopeCommand('exempt', ['add', 'docs/', '../x'], root, s.io);
    expect([a.exitCode, b.exitCode]).toEqual([1, 1]);
    expect(a.stderr).toContain('"!keep"');
    expect(b.stderr).toContain('"../x"');
    expect(s.writes).toEqual([]);
    expect(snapshot(root)).toEqual(before);
    expect(readCfg(root).guard).toBeUndefined();
  });

  it('UT-S40-05: add 去重、保持插入顺序；已存在时不写盘', () => {
    const root = project({ guard: { unversioned: ['node_modules/'] } });
    const r1 = runScopeCommand('ignore', ['add', 'dist/', 'dist/', 'build/'], root);
    expect(r1.exitCode).toBe(0);
    expect(readCfg(root).guard.unversioned).toEqual(['node_modules/', 'dist/', 'build/']);
    const cfgBefore = fileState(root, 'logos/logos.config.json');
    const giBefore = fileState(root, '.gitignore');
    const s = sentinel();
    const r2 = runScopeCommand('ignore', ['add', 'dist/'], root, s.io);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain('Already present: dist/');
    expect(r2.stdout).toContain('No changes; no files were written.');
    expect(s.writes).toEqual([]);
    expect(fileState(root, 'logos/logos.config.json')).toEqual(cfgBefore);
    expect(fileState(root, '.gitignore')).toEqual(giBefore);
  });

  it('UT-S40-06: remove 不存在条目提示「不存在」、零写入', () => {
    const root = project({ guard: { unversioned: ['dist/'] }, locale: 'zh' });
    const before = snapshot(root);
    const s = sentinel();
    const a = runScopeCommand('ignore', ['remove', 'build/'], root, s.io);
    const b = runScopeCommand('exempt', ['remove', 'docs/'], root, s.io);
    expect([a.exitCode, b.exitCode]).toEqual([0, 0]);
    expect(a.stdout).toContain('不存在：build/');
    expect(b.stdout).toContain('不存在：docs/');
    expect(s.writes).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });

  it('UT-S40-07: exempt 缺省时 add 物化内置默认；再 add 默认项提示已存在不写盘', () => {
    const root = project();
    const r = runScopeCommand('exempt', ['add', 'docs/handbook/'], root);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Built-in defaults written to guard.exempt');
    expect(readCfg(root).guard.exempt).toEqual([
      'logos/resources/reference/', 'logos/resources/verify/baseline-seed-runs/*/staging/', 'docs/handbook/',
    ]);
    const s = sentinel();
    const again = runScopeCommand('exempt', ['add', 'logos/resources/reference/'], root, s.io);
    expect(again.exitCode).toBe(0);
    expect(again.stdout).toContain('Already present: logos/resources/reference/');
    expect(s.writes).toEqual([]);
  });

  it('UT-S40-08: 删除内置默认项与清空为显式 []（不回落内置默认）', () => {
    const root = project();
    expect(runScopeCommand('exempt', ['remove', 'logos/resources/reference/'], root).exitCode).toBe(0);
    expect(readCfg(root).guard.exempt).toEqual(['logos/resources/verify/baseline-seed-runs/*/staging/']);
    const r = runScopeCommand('exempt', ['remove', 'logos/resources/verify/baseline-seed-runs/*/staging/'], root);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('guard.exempt is now empty; built-in defaults no longer apply');
    expect(readCfg(root).guard.exempt).toEqual([]);
    const list = JSON.parse(runScopeCommand('exempt', ['list', '--format', 'json'], root).stdout) as { data: { entries: unknown[] } };
    expect(list.data.entries).toEqual([]);
  });

  it('UT-S40-09: list 文本与 JSON 输出（envelope、source、不写盘、不调用 git）', () => {
    const a = project({ guard: { unversioned: ['dist/'] } });
    const s = sentinel();
    const exA = runScopeCommand('exempt', ['list', '--format', 'json'], a, s.io);
    const igA = runScopeCommand('ignore', ['list', '--format', 'json'], a, s.io);
    const exAJ = JSON.parse(exA.stdout) as Record<string, any>;
    expect(exAJ.command).toBe('exempt list');
    expect(exAJ.data.entries).toEqual([
      { value: 'logos/resources/reference/', source: 'default' },
      { value: 'logos/resources/verify/baseline-seed-runs/*/staging/', source: 'default' },
    ]);
    const igAJ = JSON.parse(igA.stdout) as Record<string, any>;
    expect(Object.keys(igAJ).sort()).toEqual(['command', 'data', 'timestamp', 'version']);
    expect(igAJ.command).toBe('ignore list');
    expect(igAJ.data).toEqual({ entries: [{ value: 'dist/', source: 'config' }] });
    const exText = runScopeCommand('exempt', ['list'], a, s.io).stdout;
    expect(exText).toMatch(/Exempt from change proposals \(guard\.exempt\):\n {2}logos\/resources\/reference\/ +\(default\)\n/);
    expect(runScopeCommand('ignore', ['list'], a, s.io).stdout).toBe('Ignored by openlogos (guard.unversioned):\n  dist/\n');
    const b = project({ guard: { exempt: ['docs/'] } });
    const exB = JSON.parse(runScopeCommand('exempt', ['list', '--format', 'json'], b, s.io).stdout) as Record<string, any>;
    expect(exB.data.entries).toEqual([{ value: 'docs/', source: 'config' }]);
    expect(s.writes).toEqual([]);
    expect(s.calls).toEqual([]);
  });

  it('UT-S40-10: 配置不可解析或字段类型错误 → exit 1、点名位置、零写入、list 不输出清单', () => {
    const variants: Array<[string, (root: string) => void, string]> = [
      ['非法 JSON', root => writeFileSync(join(root, 'logos/logos.config.json'), '{ "name": "p", '), 'logos/logos.config.json is not valid JSON'],
      ['exempt 为字符串', root => writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 'p', guard: { exempt: 'docs/' } })), 'guard.exempt'],
      ['unversioned 含数字', root => writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 'p', guard: { unversioned: ['dist/', 3] } })), 'guard.unversioned'],
    ];
    for (const [label, mutate, needle] of variants) {
      const root = project({ gitignore: 'x\n' });
      mutate(root);
      const before = snapshot(root);
      for (const kind of ['ignore', 'exempt'] as const) {
        for (const argv of [['add', 'a/'], ['remove', 'a/'], ['list'], ['list', '--format', 'json']]) {
          const s = sentinel();
          const r = runScopeCommand(kind, argv, root, s.io);
          expect(r.exitCode, `${label} ${kind} ${argv.join(' ')}`).toBe(1);
          expect(r.stdout, `${label} ${kind} ${argv.join(' ')} 不输出猜测清单`).toBe('');
          expect(r.stderr).toContain(needle);
          if (argv.includes('--format')) {
            const env = JSON.parse(r.stderr) as { error: { code: string } };
            expect(['CONFIG_INVALID', 'GUARD_ENTRY_INVALID']).toContain(env.error.code);
          }
          expect(s.writes).toEqual([]);
        }
      }
      expect(snapshot(root), label).toEqual(before);
    }
  });

  it('UT-S40-11: 固定运行时条目不可增删', () => {
    const root = project({ gitignore: `${managedBlock([])}\n` });
    const before = snapshot(root);
    const s = sentinel();
    const add = runScopeCommand('ignore', ['add', 'logos/.openlogos-runtime/'], root, s.io);
    expect(add.exitCode).toBe(0);
    expect(add.stdout).toContain('logos/.openlogos-runtime/ is always ignored by the managed block');
    const rm = runScopeCommand('ignore', ['remove', 'logos/.openlogos-runtime/'], root, s.io);
    expect(rm.exitCode).toBe(1);
    expect(rm.stderr).toContain('is a fixed entry of the managed block and cannot be removed');
    expect(s.writes).toEqual([]);
    expect(snapshot(root)).toEqual(before);
  });
});

/* ─────────────────────────── UT 1.2 托管区块渲染、幂等与原子性 ─────────────────────────── */

describe('S40 托管区块渲染 — 单元', () => {
  it('UT-S40-12: 无区块与无文件时的写入位置', () => {
    const block = `${managedBlock(['dist/'])}\n`;
    const a = project({ gitignore: '*.log\n' });
    const b = project({ gitignore: '*.log' });
    const c = project();
    for (const root of [a, b, c]) expect(runScopeCommand('ignore', ['add', 'dist/'], root).exitCode).toBe(0);
    expect(readFileSync(join(a, '.gitignore'), 'utf-8')).toBe(`*.log\n\n${block}`);
    expect(readFileSync(join(b, '.gitignore'), 'utf-8')).toBe(`*.log\n\n${block}`);
    expect(readFileSync(join(c, '.gitignore'), 'utf-8')).toBe(block);
    const created = runScopeCommand('ignore', ['add', 'x/'], project()).stdout;
    expect(created).toContain('.gitignore created with openlogos managed block');
  });

  it('UT-S40-13: 只改写标记之间，区块外逐字节不变', () => {
    const pre = Buffer.from('# 用户注释\n\nnode_modules/\n日志/*.log\n\n', 'utf-8');
    const post = Buffer.from('\n# 区块后注释\n尾部条目', 'utf-8');
    const root = project({ guard: { unversioned: ['a/'] }, gitignore: Buffer.concat([pre, Buffer.from(managedBlock(['a/'])), post]) });
    const check = (entries: string[]) => {
      const now = readFileSync(join(root, '.gitignore'));
      expect(now.subarray(0, pre.length).equals(pre), '区块前字节').toBe(true);
      expect(now.subarray(now.length - post.length).equals(post), '区块后字节').toBe(true);
      expect(now.subarray(pre.length, now.length - post.length).toString('utf-8')).toBe(managedBlock(entries));
    };
    expect(runScopeCommand('ignore', ['add', 'build/'], root).exitCode).toBe(0);
    check(['a/', 'build/']);
    expect(runScopeCommand('ignore', ['remove', 'build/'], root).exitCode).toBe(0);
    check(['a/']);
  });

  it('UT-S40-14: CRLF 行尾沿用，区块外 CRLF / LF 字节不被改写', () => {
    const original = Buffer.from('a\r\nb\nc\r\n', 'latin1');
    const root = project({ gitignore: original });
    expect(runScopeCommand('ignore', ['add', 'dist/'], root).exitCode).toBe(0);
    const now = readFileSync(join(root, '.gitignore'));
    expect(now.subarray(0, original.length).equals(original)).toBe(true);
    const rest = now.subarray(original.length).toString('latin1');
    expect(rest).toBe(`\r\n${Buffer.from(managedBlock(['dist/'], '\r\n'), 'utf-8').toString('latin1')}\r\n`);
  });

  it('UT-S40-15: 重复执行幂等（写入口哨兵调用次数为 0）', () => {
    const root = project({ gitignore: '*.log\n' });
    expect(runScopeCommand('ignore', ['add', 'dist/'], root).exitCode).toBe(0);
    const cfg = fileState(root, 'logos/logos.config.json');
    const gi = fileState(root, '.gitignore');
    const s = sentinel();
    expect(runScopeCommand('ignore', ['add', 'dist/'], root, s.io).exitCode).toBe(0);
    expect(runScopeCommand('ignore', ['remove', 'nope/'], root, s.io).exitCode).toBe(0);
    expect(s.writes.length).toBe(0);
    expect(fileState(root, 'logos/logos.config.json')).toEqual(cfg);
    expect(fileState(root, '.gitignore')).toEqual(gi);
  });

  it('UT-S40-16: 托管区块损坏 fail loud（输出行号、区块检查先于写配置）', () => {
    const variants: Array<[string, string, RegExp]> = [
      ['两个起始标记', `x\n${MANAGED_START}\n${MANAGED_START}\n${MANAGED_END}\n`, /lines 2, 3/],
      ['只有起始标记', `x\ny\n${MANAGED_START}\ndist/\n`, /line 3/],
      ['结束先于起始', `${MANAGED_END}\nx\n${MANAGED_START}\n`, /line 1 .*line 3/],
    ];
    for (const [label, content, lineRe] of variants) {
      const root = project({ guard: { unversioned: ['dist/'] }, gitignore: content });
      const before = snapshot(root);
      for (const argv of [['add', 'dist2/'], ['remove', 'dist/']]) {
        const s = sentinel();
        const r = runScopeCommand('ignore', argv, root, s.io);
        expect(r.exitCode, label).toBe(1);
        expect(r.stderr, label).toContain('The openlogos managed block in .gitignore is corrupted');
        expect(r.stderr, label).toMatch(lineRe);
        expect(r.stderr).toContain('Fix it manually; no files were changed.');
        expect(s.writes, label).toEqual([]);
      }
      expect(snapshot(root), label).toEqual(before);
    }
  });

  it('UT-S40-17: 区块写入失败回滚配置（权限错误、目标为目录），不留临时文件', () => {
    // ① 写入口注入失败：.gitignore 的 rename 抛 EACCES
    const a = project({ gitignore: 'x\n' });
    const cfgBefore = readFileSync(join(a, 'logos/logos.config.json'));
    const r = runScopeCommand('ignore', ['add', 'dist/'], a, {
      write: {
        ...defaultScopeIo.write,
        renameSync: (from, to) => {
          if (to.endsWith('.gitignore')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
          defaultScopeIo.write.renameSync(from, to);
        },
      },
    });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Failed to write .gitignore');
    expect(r.stderr).toContain('Changes were rolled back.');
    expect(readFileSync(join(a, 'logos/logos.config.json')).equals(cfgBefore)).toBe(true);
    expect(readFileSync(join(a, '.gitignore'), 'utf-8')).toBe('x\n');
    noTempFiles(a);
    // ② 真实权限错误：项目根只读（logos/ 可写，配置先写成功、区块写失败后回滚）
    const b = project({ gitignore: 'x\n' });
    const cfgB = readFileSync(join(b, 'logos/logos.config.json'));
    chmodSync(b, 0o555);
    try {
      const rb = runScopeCommand('ignore', ['add', 'dist/'], b);
      expect(rb.exitCode).toBe(1);
      expect(rb.stderr).toContain('Failed to write .gitignore');
    } finally { chmodSync(b, 0o755); }
    expect(readFileSync(join(b, 'logos/logos.config.json')).equals(cfgB)).toBe(true);
    expect(readFileSync(join(b, '.gitignore'), 'utf-8')).toBe('x\n');
    noTempFiles(b);
    // ③ 目标为目录
    const c = project();
    mkdirSync(join(c, '.gitignore'));
    const cfgC = readFileSync(join(c, 'logos/logos.config.json'));
    const rc = runScopeCommand('ignore', ['add', 'dist/'], c);
    expect(rc.exitCode).toBe(1);
    expect(readFileSync(join(c, 'logos/logos.config.json')).equals(cfgC)).toBe(true);
    expect(statSync(join(c, '.gitignore')).isDirectory()).toBe(true);
    noTempFiles(c);
  });
});

/* ─────────────────────────── UT 1.3 已跟踪文件提示与 git 环境 ─────────────────────────── */

function trackedRepo(files: Record<string, string>, gitignore = 'node_modules/\n'): string {
  const root = project({ gitignore });
  for (const [rel, content] of Object.entries(files)) put(root, rel, content);
  gitInit(root);
  commitAll(root);
  return root;
}

function lsFilesZ(root: string): string[] {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: root, env: cleanEnv() });
  return (r.stdout as Buffer).toString('utf-8').split('\0').filter(Boolean).sort();
}

/** 从 CLI 输出中取提示的 git rm 命令行。 */
function hintCommand(stdout: string): string {
  const line = stdout.split('\n').find(l => l.trim().startsWith('git --literal-pathspecs rm --cached'));
  expect(line, `输出中应有提示命令：\n${stdout}`).toBeDefined();
  return line!.trim();
}

function runHint(root: string, cmd: string): void {
  const r = spawnSync('sh', ['-c', cmd], { cwd: root, encoding: 'utf-8', env: cleanEnv() });
  expect(r.status, `${cmd}\n${r.stderr}`).toBe(0);
}

describe('S40 已跟踪文件提示 — 单元', () => {
  it('UT-S40-18: 已跟踪文件提示（数量、5 个示例、逐个列出的移出命令）且不代为执行', () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 7; i++) files[`dist/f${i}.js`] = `${i}\n`;
    const root = trackedRepo(files);
    const s = sentinel();
    const r = runScopeCommand('ignore', ['add', 'dist/'], root, s.io);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('⚠ 7 tracked file(s) match "dist/"');
    const examples = r.stdout.split('\n').filter(l => /^ {4}dist\/f\d\.js$/.test(l));
    expect(examples.length).toBe(5);
    expect(r.stdout).toContain('    ... and 2 more');
    const cmd = hintCommand(r.stdout);
    expect(cmd).toBe(`git --literal-pathspecs rm --cached -- ${[1, 2, 3, 4, 5, 6, 7].map(i => `'dist/f${i}.js'`).join(' ')}`);
    expect(cmd).not.toContain("'dist/'");
    expect(s.calls).toContainEqual(['git', 'ls-files', '-z', '-ci', '--exclude=dist/']);
    expect(s.calls.some(c => c.includes('rm'))).toBe(false);
    expect(lsFilesZ(root).filter(f => f.startsWith('dist/')).length, '仍被跟踪').toBe(7);
  });

  it('UT-S40-19: 无已跟踪文件时不提示、不写清单', () => {
    const root = trackedRepo({ 'src/a.js': 'a\n' });
    const r = runScopeCommand('ignore', ['add', 'coverage/'], root);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).not.toContain('tracked file');
    expect(r.stdout).not.toContain('git --literal-pathspecs');
    expect(existsSync(join(root, 'logos/.openlogos-runtime'))).toBe(false);
  });

  it('UT-S40-20: 非 git 仓库提示；统计失败只警告', () => {
    // A：非 git 目录
    const a = project();
    expect(git(a, ['rev-parse', '--is-inside-work-tree']).status).not.toBe(0);
    const sa = sentinel();
    const ra = runScopeCommand('ignore', ['add', 'dist/'], a, sa.io);
    expect(ra.exitCode).toBe(0);
    expect(readCfg(a).guard.unversioned).toEqual(['dist/']);
    expect(readFileSync(join(a, '.gitignore'), 'utf-8')).toContain('dist/');
    expect(ra.stdout).toContain("Not inside a git repository; guard's version-control criterion is not in effect.");
    expect(sa.calls.some(c => c.includes('ls-files'))).toBe(false);
    const za = project({ locale: 'zh' });
    expect(runScopeCommand('ignore', ['add', 'dist/'], za).stdout).toContain('当前目录不在 git 仓库中，guard 新判据不生效');
    // B：git 仓库，ls-files 打桩为非零退出
    const b = trackedRepo({ 'dist/a.js': 'a\n' });
    const sb = sentinel(args => (args[0] === 'ls-files'
      ? { status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from('fatal: stubbed failure\n') } : null));
    const rb = runScopeCommand('ignore', ['add', 'dist/'], b, sb.io);
    expect(rb.exitCode).toBe(0);
    expect(readCfg(b).guard.unversioned).toEqual(['dist/']);
    expect(rb.stdout).toContain('⚠ Could not check tracked files for "dist/": fatal: stubbed failure');
    expect(rb.stdout).not.toContain('git --literal-pathspecs');
  });

  it('UT-S40-25: gitignore 语义匹配与提示命令实际执行（≤20 个）', () => {
    const files = {
      'build/a.js': '1', 'pkg/build/b.js': '2', 'x.pyc': '3', 'lib/y.pyc': '4', 'lib/z.py': '5',
      'build/my file.js': '6', 'build/a*.js': '7', 'build/a1.js': '8', "build/it's.js": '9',
    };
    // ① /build/
    const r1 = trackedRepo(files);
    const base1 = lsFilesZ(r1);
    const s1 = sentinel();
    const out1 = runScopeCommand('ignore', ['add', '/build/'], r1, s1.io);
    expect(out1.exitCode).toBe(0);
    expect(out1.stdout).toContain('5 tracked file(s) match "/build/"');
    const cmd1 = hintCommand(out1.stdout);
    expect(cmd1).toBe("git --literal-pathspecs rm --cached -- 'build/a*.js' 'build/a.js' 'build/a1.js' 'build/it'\\''s.js' 'build/my file.js'");
    const ignored1 = base1.filter(f => git(r1, ['check-ignore', '--no-index', '-q', '--', f]).status === 0);
    runHint(r1, cmd1);
    const removed1 = base1.filter(f => !lsFilesZ(r1).includes(f));
    expect(removed1).toEqual(['build/a*.js', 'build/a.js', 'build/a1.js', "build/it's.js", 'build/my file.js']);
    expect(ignored1, '与 check-ignore --no-index 判定一致').toEqual(removed1);
    for (const f of removed1) expect(existsSync(join(r1, f)), `${f} 工作区仍在`).toBe(true);
    expect(s1.calls.some(c => c.includes('rm'))).toBe(false);
    // ② *.pyc（重置：全新仓库）
    const r2 = trackedRepo(files);
    const base2 = lsFilesZ(r2);
    const s2 = sentinel();
    const out2 = runScopeCommand('ignore', ['add', '*.pyc'], r2, s2.io);
    const cmd2 = hintCommand(out2.stdout);
    const ignored2 = base2.filter(f => git(r2, ['check-ignore', '--no-index', '-q', '--', f]).status === 0);
    runHint(r2, cmd2);
    const removed2 = base2.filter(f => !lsFilesZ(r2).includes(f));
    expect(removed2).toEqual(['lib/y.pyc', 'x.pyc']);
    expect(lsFilesZ(r2)).toContain('lib/z.py');
    expect(ignored2).toEqual(removed2);
    expect(s2.calls.some(c => c.includes('rm'))).toBe(false);
  });

  it('UT-S40-26: 超过 20 个匹配文件时生成 NUL 清单', () => {
    const files: Record<string, string> = { 'src/keep.js': 'k' };
    for (let i = 1; i <= 21; i++) files[`out/f${String(i).padStart(2, '0')}.txt`] = `${i}`;
    files['out/with space.txt'] = 's';
    files['out/star*.txt'] = 's';
    const root = trackedRepo(files);
    const s = sentinel();
    const r = runScopeCommand('ignore', ['add', 'out/'], root, { ...s.io, now: () => new Date('2026-10-07T08:00:00.000Z') });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('23 tracked file(s) match "out/"');
    const rel = 'logos/.openlogos-runtime/untrack-20261007T080000Z.lst';
    expect(r.stdout).toContain(`The full list was written to ${rel}.`);
    const cmd = hintCommand(r.stdout);
    expect(cmd).toBe(`git --literal-pathspecs rm --cached --pathspec-file-nul --pathspec-from-file=${rel}`);
    const listBytes = readFileSync(join(root, rel));
    const expected = spawnSync('git', ['ls-files', '-z', '-ci', '--exclude=out/'], { cwd: root, env: cleanEnv() }).stdout as Buffer;
    expect(listBytes.equals(expected)).toBe(true);
    expect(listBytes.toString('utf-8').split('\0').filter(Boolean).length).toBe(23);
    const before = lsFilesZ(root);
    runHint(root, cmd);
    const after = lsFilesZ(root);
    expect(before.filter(f => !after.includes(f)).length).toBe(23);
    expect(after).toContain('src/keep.js');
    expect(s.calls.some(c => c.includes('rm'))).toBe(false);
  });

  it('UT-S40-27: exempt 父目录不解除保护范围来源', () => {
    const root = gRepo();
    put(root, 'docs/.gitignore', 'tmp/\n');
    put(root, 'docs/guide.md', '# g\n');
    put(root, '.claude/.gitignore', 'x\n');
    commitAll(root, 'docs');
    writeFileSync(join(root, '.gitignore'), `${readFileSync(join(root, '.gitignore'), 'utf-8')}logos/\n`);
    commitAll(root, 'ignore logos');
    expect(git(root, ['check-ignore', '-q', '--no-index', 'logos/x']).status, 'logos/ 被 git 忽略').toBe(0);
    // ①
    expect(runCli(root, ['exempt', 'add', 'docs/']).exitCode).toBe(0);
    expect(runCli(root, ['exempt', 'add', 'logos/']).exitCode).toBe(0);
    expect(readCfg(root).guard.exempt).toEqual(expect.arrayContaining(['docs/', 'logos/']));
    // ②
    const { file } = loadGuardRegion(tempRoot());
    expect(callIsProtected(file, root, 'docs/guide.md').protected, 'docs/guide.md').toBe(false);
    for (const rel of ['docs/.gitignore', 'logos/logos.config.json', '.claude/.gitignore']) {
      expect(callIsProtected(file, root, rel).protected, rel).toBe(true);
      const r = spawnSync('bash', [GUARD_SRC], {
        input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(root, rel), old_string: 'a', new_string: 'b' }, permission_mode: 'default' }),
        cwd: root, encoding: 'utf-8', env: cleanEnv({ CLAUDE_PROJECT_DIR: root }),
      });
      expect(r.status, `Edit ${rel}`).toBe(2);
    }
  }, TIMEOUT);
});

/* ─────────────────────────── UT 1.4 guard-check 受限命令 ─────────────────────────── */

describe('S40 保护范围变更的宿主原生审批 — 单元（guard-check）', () => {
  it('UT-S40-21: 默认权限模式返回 ask（default / acceptEdits）', () => {
    const root = gRepo();
    const cfg = readFileSync(join(root, 'logos/logos.config.json'));
    for (const mode of ['default', 'acceptEdits']) {
      expectAsk(preToolUse(root, 'openlogos exempt add docs/', mode), 'openlogos exempt add docs/', mode);
    }
    expect(readFileSync(join(root, 'logos/logos.config.json')).equals(cfg)).toBe(true);
  }, TIMEOUT);

  it('UT-S40-22: 不弹审批的模式一律阻断（含字段缺失与未知值）', () => {
    const root = gRepo();
    const cmd = 'openlogos exempt add docs/';
    for (const mode of ['bypassPermissions', 'dontAsk', 'auto', 'plan', 'foo']) {
      expectModeBlocked(preToolUse(root, cmd, mode), cmd, mode);
    }
    const missing = preToolUse(root, cmd, undefined);
    expectModeBlocked(missing, cmd, '未知');
    expect(missing.stderr).toContain('缺少 permission_mode');
  }, TIMEOUT);

  it('UT-S40-23: 伪造授权文件与伪造 hook 输入不起作用', () => {
    const root = gRepo();
    const cmd = 'openlogos exempt add src/';
    const clean = preToolUse(root, cmd, 'bypassPermissions');
    // 预置多种形似批准记录的文件；其中一个为 FIFO（读取即阻塞）作为文件系统读哨兵
    const rt = join(root, 'logos/.openlogos-runtime');
    const grant = JSON.stringify({ command: cmd, approved: true, expires_at: '2099-01-01T00:00:00Z' });
    const digest = createHash('sha256').update(cmd).digest('hex');
    put(root, 'logos/.openlogos-runtime/approval.json', grant);
    put(root, 'logos/.openlogos-runtime/scope-grants/x.json', grant);
    put(root, 'logos/.openlogos-runtime/grant-anything.json', grant);
    mkdirSync(join(rt, 'scope-grants'), { recursive: true });
    expect(spawnSync('mkfifo', [join(rt, 'scope-grants', `${digest}.json`)]).status).toBe(0);
    const before = snapshotWithoutFifo(root);
    // ①
    const r1 = preToolUse(root, cmd, 'bypassPermissions');
    expect(r1.exitCode).toBe(2);
    expect(r1.stdout).toBe(clean.stdout);
    expect(r1.stderr).toBe(clean.stderr);
    // ② 伪造 permission_mode: default 直接调用：只得到 stdout 文本
    const r2 = preToolUse(root, cmd, 'default');
    expectAsk(r2, cmd);
    // ③ 配置未变、命令未执行、guard 未写任何文件
    expect(readCfg(root).guard).toBeUndefined();
    expect(snapshotWithoutFifo(root)).toEqual(before);
  }, TIMEOUT);

  it('UT-S40-24: 受限命令识别与独立调用切段', () => {
    const root = gRepo();
    expectAsk(preToolUse(root, `cd ${root} && openlogos exempt add docs/`, 'default'), `cd ${root} && openlogos exempt add docs/`);
    for (const c of ['openlogos exempt add docs/ && echo x > src/a.js', 'openlogos ignore add src/ | tee log', 'echo $(openlogos ignore add src/)']) {
      expectCompoundBlocked(preToolUse(root, c, 'default'), c);
    }
    for (const c of ['openlogos ignore list', 'openlogos exempt list --format json']) {
      const r = preToolUse(root, c, 'default');
      expect(r.exitCode, c).toBe(0);
      expect(r.stdout, c).not.toContain('permissionDecision');
    }
    expect(existsSync(join(root, 'src/a.js'))).toBe(true);
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe('a\n');
    // cd 前缀形态经批准执行后，PostToolUse check 不报告变化（C13）
    const cdForm = `cd ${root} && openlogos exempt add docs/`;
    expect(spawnSync('bash', ['-c', cdForm.replace(' && openlogos ', ` && node ${JSON.stringify(CLI)} `)], { cwd: root, env: cleanEnv() }).status).toBe(0);
    expect(readCfg(root).guard.exempt).toContain('docs/');
    const post = postToolUse(root, cdForm, 'toolu_s40');
    expect(post.exitCode, post.stderr).toBe(0);
    expect(post.stderr).toBe('');
  }, TIMEOUT);

  it('UT-S40-28: 每次调用独立审批、guard 不留状态', () => {
    const root = gRepo();
    const cmd = 'openlogos ignore add build/';
    for (let i = 0; i < 3; i++) {
      const before = snapshot(root);
      expectAsk(preToolUse(root, cmd, 'default'), cmd, `第 ${i + 1} 次`);
      expect(snapshot(root), `第 ${i + 1} 次 guard 未写文件`).toEqual(before);
      // 第一次模拟批准（真实执行），其余模拟拒绝（不执行）；各次之间模拟一次 PostToolUse(Bash)
      if (i === 0) expect(runCli(root, cmd.split(' ').slice(1)).exitCode).toBe(0);
      const mid = snapshot(root);
      const post = postToolUse(root, cmd, `toolu_s40_${i}`);
      expect(post.exitCode, post.stderr).toBe(0);
      expect(snapshot(root), `第 ${i + 1} 次 PostToolUse 未写文件`).toEqual(mid);
    }
  }, TIMEOUT);
});

function snapshotWithoutFifo(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      if (r === '.git') continue;
      const st = statSync(join(root, r));
      if (st.isFIFO()) { out[r] = 'fifo'; continue; }
      if (st.isDirectory()) { out[`${r}/`] = 'dir'; walk(r); } else out[r] = sha(readFileSync(join(root, r)));
    }
  };
  walk('');
  return out;
}

/* ─────────────────────────── ST 场景 ─────────────────────────── */

describe('S40 ignore / exempt 与宿主审批 — 场景', () => {
  it('ST-S40-01: ignore add 正常路径含已跟踪提示', () => {
    const userGi = '# 用户注释\nnode_modules/\n*.log\n';
    const root = trackedRepo({ 'dist/a.js': 'a', 'dist/b.js': 'b', 'dist/c.js': 'c', 'src/x.js': 'x' }, userGi);
    const r = runCli(root, ['ignore', 'add', 'dist/', 'coverage/']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('3 tracked file(s) match "dist/"');
    expect(r.stdout.split('\n').filter(l => /^ {4}dist\/[abc]\.js$/.test(l)).length).toBe(3);
    expect(hintCommand(r.stdout)).toBe("git --literal-pathspecs rm --cached -- 'dist/a.js' 'dist/b.js' 'dist/c.js'");
    expect(readCfg(root).guard.unversioned).toEqual(['dist/', 'coverage/']);
    const gi = readFileSync(join(root, '.gitignore'), 'utf-8');
    expect(gi.startsWith(userGi)).toBe(true);
    expect(gi).toBe(`${userGi}\n${managedBlock(['dist/', 'coverage/'])}\n`);
    expect(lsFilesZ(root).filter(f => f.startsWith('dist/')).length).toBe(3);
  }, TIMEOUT);

  it('ST-S40-02: ignore remove 与幂等', () => {
    const userGi = '# 用户\n*.log\n';
    const root = trackedRepo({ 'dist/a.js': 'a' }, userGi);
    expect(runCli(root, ['ignore', 'add', 'dist/', 'coverage/']).exitCode).toBe(0);
    const r1 = runCli(root, ['ignore', 'remove', 'coverage/']);
    expect(r1.exitCode).toBe(0);
    expect(readCfg(root).guard.unversioned).toEqual(['dist/']);
    expect(readFileSync(join(root, '.gitignore'), 'utf-8')).toBe(`${userGi}\n${managedBlock(['dist/'])}\n`);
    const snap = snapshot(root);
    const r2 = runCli(root, ['ignore', 'remove', 'coverage/']);
    expect(r2.exitCode).toBe(0);
    expect(r2.stdout).toContain('Not found: coverage/');
    expect(snapshot(root)).toEqual(snap);
    const r3 = runCli(root, ['ignore', 'add', 'dist/']);
    expect(r3.exitCode).toBe(0);
    expect(r3.stdout).toContain('Already present: dist/');
    expect(snapshot(root)).toEqual(snap);
  }, TIMEOUT);

  it('ST-S40-03: exempt add / remove / list 端到端', () => {
    const root = trackedRepo({ 'src/a.js': 'a' }, 'node_modules/\n');
    const gi = fileState(root, '.gitignore');
    const l1 = JSON.parse(runCli(root, ['exempt', 'list', '--format', 'json']).stdout) as Record<string, any>;
    expect(l1.data.entries.map((e: { source: string }) => e.source)).toEqual(['default', 'default']);
    expect(runCli(root, ['exempt', 'add', 'docs/handbook/']).exitCode).toBe(0);
    expect(readCfg(root).guard.exempt).toEqual(['logos/resources/reference/', 'logos/resources/verify/baseline-seed-runs/*/staging/', 'docs/handbook/']);
    expect(runCli(root, ['exempt', 'remove', 'logos/resources/reference/']).exitCode).toBe(0);
    const l2 = JSON.parse(runCli(root, ['exempt', 'list', '--format', 'json']).stdout) as Record<string, any>;
    expect(l2.data.entries).toEqual([
      { value: 'logos/resources/verify/baseline-seed-runs/*/staging/', source: 'config' },
      { value: 'docs/handbook/', source: 'config' },
    ]);
    const l3 = JSON.parse(runCli(root, ['ignore', 'list', '--format', 'json']).stdout) as Record<string, any>;
    expect(l3.command).toBe('ignore list');
    expect(fileState(root, '.gitignore')).toEqual(gi);
  }, TIMEOUT);

  it('ST-S40-04: 非法路径拒绝零写入', () => {
    const root = trackedRepo({ 'src/a.js': 'a' });
    const snap = snapshot(root);
    for (const argv of [['exempt', 'add', '../outside/'], ['exempt', 'add', '/abs/'], ['exempt', 'add', 'logos/.openlogos-runtime/x'],
      ['exempt', 'add', '.gitignore'], ['exempt', 'add', '.git/info/exclude'], ['ignore', 'add', '!dist/']]) {
      const r = runCli(root, argv);
      expect(r.exitCode, argv.join(' ')).toBe(1);
      expect(r.stderr, argv.join(' ')).toContain(`"${argv[2]}"`);
    }
    expect(snapshot(root)).toEqual(snap);
  }, TIMEOUT);

  it('ST-S40-05: 托管区块损坏 fail loud，修复后可正常渲染', () => {
    const root = trackedRepo({ 'src/a.js': 'a' }, `node_modules/\n${MANAGED_START}\nlogos/.openlogos-runtime/\n`);
    const snap = snapshot(root);
    const r1 = runCli(root, ['ignore', 'add', '.venv/']);
    expect(r1.exitCode).toBe(1);
    expect(r1.stderr).toContain('line 2');
    expect(r1.stderr).toContain('Fix it manually');
    expect(snapshot(root)).toEqual(snap);
    writeFileSync(join(root, '.gitignore'), `node_modules/\n${MANAGED_START}\nlogos/.openlogos-runtime/\n${MANAGED_END}\n`);
    const r2 = runCli(root, ['ignore', 'add', '.venv/']);
    expect(r2.exitCode).toBe(0);
    expect(readFileSync(join(root, '.gitignore'), 'utf-8')).toBe(`node_modules/\n${managedBlock(['.venv/'])}\n`);
  }, TIMEOUT);

  it('ST-S40-06: 非 git 仓库提示', () => {
    const root = project({ locale: 'zh' });
    expect(git(root, ['rev-parse', '--is-inside-work-tree']).status).not.toBe(0);
    const r1 = runCli(root, ['ignore', 'add', 'dist/']);
    expect(r1.exitCode).toBe(0);
    expect(r1.stdout).toContain('当前目录不在 git 仓库中，guard 新判据不生效');
    expect(readCfg(root).guard.unversioned).toEqual(['dist/']);
    expect(readFileSync(join(root, '.gitignore'), 'utf-8')).toContain(`${MANAGED_START}`);
    const r2 = runCli(root, ['exempt', 'add', 'docs/']);
    expect(r2.exitCode).toBe(0);
    expect(readCfg(root).guard.exempt).toContain('docs/');
  }, TIMEOUT);

  it('ST-S40-07: CRLF 与区块外逐字节不变', () => {
    const pre = Buffer.from('# 前\r\nnode_modules/\r\n\r\n', 'utf-8');
    const post = Buffer.from('\r\n# 后\r\n末行无换行', 'utf-8');
    const root = project({ gitignore: Buffer.concat([pre, Buffer.from(managedBlock([], '\r\n')), post]) });
    const check = (entries: string[]) => {
      const now = readFileSync(join(root, '.gitignore'));
      expect(now.subarray(0, pre.length).equals(pre)).toBe(true);
      expect(now.subarray(now.length - post.length).equals(post)).toBe(true);
      expect(now.subarray(pre.length, now.length - post.length).toString('utf-8')).toBe(managedBlock(entries, '\r\n'));
    };
    expect(runCli(root, ['ignore', 'add', 'dist/']).exitCode).toBe(0);
    check(['dist/']);
    expect(runCli(root, ['ignore', 'remove', 'dist/']).exitCode).toBe(0);
    check([]);
  }, TIMEOUT);

  it('ST-S40-08: 默认模式下 AI 发起受限命令触发宿主审批（批准前配置与 .gitignore 不变）', () => {
    const root = gRepo();
    const snap = snapshot(root);
    for (const cmd of ['openlogos exempt add src/', 'openlogos ignore add src/']) expectAsk(preToolUse(root, cmd, 'default'), cmd);
    expect(snapshot(root)).toEqual(snap);
  }, TIMEOUT);

  it('ST-S40-09: 用户批准则执行、拒绝则不执行；再次调用仍需审批', () => {
    const root = gRepo();
    const cmd = 'openlogos ignore add build/';
    // ① ask → ② 批准分支：真实执行
    expectAsk(preToolUse(root, cmd, 'default'), cmd);
    const run = runCli(root, ['ignore', 'add', 'build/']);
    expect(run.exitCode).toBe(0);
    expect(readCfg(root).guard.unversioned).toEqual(['build/']);
    expect(readFileSync(join(root, '.gitignore'), 'utf-8')).toContain(managedBlock(['build/']));
    const post = postToolUse(root, cmd, 'toolu_s40_09');
    expect(post.exitCode, post.stderr).toBe(0);
    expect(post.stderr).toBe('');
    // ③ 再次 PreToolUse 仍为 ask → ④ 拒绝分支不执行
    const snap = snapshot(root);
    expectAsk(preToolUse(root, cmd, 'default'), cmd);
    expect(snapshot(root)).toEqual(snap);
  }, TIMEOUT);

  it('ST-S40-10: 不弹审批的模式阻断并提示 ! 自行执行；用户自行执行直接生效', () => {
    const root = gRepo();
    const cmd = 'openlogos exempt add docs/';
    for (const mode of ['bypassPermissions', 'dontAsk', 'auto', 'plan', undefined]) {
      expectModeBlocked(preToolUse(root, cmd, mode), cmd, mode ?? '未知');
      expect(readCfg(root).guard).toBeUndefined();
    }
    const self = runCli(root, ['exempt', 'add', 'docs/']);
    expect(self.exitCode).toBe(0);
    expect(readCfg(root).guard.exempt).toContain('docs/');
  }, TIMEOUT);

  it('ST-S40-11: 复合命令阻断；cd 前缀形态经批准执行（间接调用的事后发现属切片 3）', () => {
    const root = gRepo();
    // ① 复合形态：阻断且不执行
    const c1 = 'openlogos exempt add src/ && echo x > src/a.js';
    expectCompoundBlocked(preToolUse(root, c1, 'default'), c1);
    expect(readFileSync(join(root, 'src/a.js'), 'utf-8')).toBe('a\n');
    // ② cd 前缀：ask，批准后执行
    const c2 = `cd ${root} && openlogos exempt add docs/`;
    expectAsk(preToolUse(root, c2, 'default'), c2);
    const r = spawnSync('bash', ['-c', c2.replace(' && openlogos ', ` && node ${JSON.stringify(CLI)} `)], { cwd: root, encoding: 'utf-8', env: cleanEnv() });
    expect(r.status).toBe(0);
    expect(readCfg(root).guard.exempt).toContain('docs/');
    // ③ node -e 间接调用：不被识别为受限命令（不返回 ask）；PostToolUse 事后检查以 exit 2 报告 logos.config.json 变化，
    //    不按独立 openlogos 调用豁免（实际执行以 node cli/dist/index.js 代替全局 openlogos）
    const c3 = "node -e \"require('child_process').execSync('openlogos exempt add src/')\"";
    const run3 = chain(root, c3, { exec: `node -e "require('child_process').execSync('node ${CLI} exempt add src/')"` });
    expect(run3.pre.exitCode).toBe(0);
    expect(run3.pre.stdout).not.toContain('permissionDecision');
    expect(run3.exec!.status, run3.exec!.stderr).toBe(0);
    expect(readCfg(root).guard.exempt).toContain('src/');
    expect(run3.post!.exitCode).toBe(2);
    expect(JSON.parse(run3.post!.stdout).reason).toContain('logos/logos.config.json');
  }, TIMEOUT);

  it('ST-S40-12: --auto 阻断、有活跃提案仍需审批、list 不受限', () => {
    // A：--auto 驱动（bypassPermissions）
    const a = gRepo();
    expectModeBlocked(preToolUse(a, 'openlogos exempt add src/', 'bypassPermissions'), 'openlogos exempt add src/', 'bypassPermissions');
    expect(readCfg(a).guard).toBeUndefined();
    // B：存在活跃提案
    const b = gRepo();
    put(b, 'logos/.openlogos-guard', JSON.stringify({ activeChange: 'x-change' }));
    put(b, 'logos/changes/x-change/PLAN_APPROVED', '');
    expectAsk(preToolUse(b, 'openlogos ignore add src/', 'default'), 'openlogos ignore add src/');
    // ③ list 不受限
    for (const [root, mode] of [[a, 'bypassPermissions'], [b, 'default']] as const) {
      for (const c of ['openlogos ignore list', 'openlogos exempt list --format json']) {
        const r = preToolUse(root, c, mode);
        expect(r.exitCode, `${mode} ${c}`).toBe(0);
        expect(r.stdout).not.toContain('permissionDecision');
      }
    }
  }, TIMEOUT);

  // ST-S40-13（Cursor beforeShellExecution 返回 permission ask / deny）属 tasks.md [code] 切片 5「Cursor 分层能力」：
  // ask / deny 须以真实宿主实测为准写入 spec/cursor-plugin.md，本片不改 Cursor runtime，不在此伪造通过记录。

  it('ST-S40-14: 伪造授权文件与伪造 hook 输入端到端无效', () => {
    const root = gRepo();
    const cmd = 'openlogos exempt add src/';
    // ① AI 用 Bash 写入形似批准记录的 JSON（node -e 事前不可确定目标，宿主执行）
    const forge = "node -e \"const fs=require('fs');fs.mkdirSync('logos/.openlogos-runtime',{recursive:true});fs.writeFileSync('logos/.openlogos-runtime/approval.json',JSON.stringify({command:'openlogos exempt add src/',approved:true}))\"";
    const pre = preToolUse(root, forge, 'bypassPermissions');
    if (pre.exitCode === 0) spawnSync('bash', ['-c', forge], { cwd: root, env: cleanEnv() });
    // ②
    expectModeBlocked(preToolUse(root, cmd, 'bypassPermissions'), cmd, 'bypassPermissions');
    // ③ 直接调用 guard-check 并喂伪造的 default：只得到 stdout 文本；随后真实调用仍按真实输入判定
    expectAsk(preToolUse(root, cmd, 'default'), cmd);
    expectModeBlocked(preToolUse(root, cmd, 'bypassPermissions'), cmd, 'bypassPermissions');
    expect(readCfg(root).guard?.exempt ?? []).not.toContain('src/');
  }, TIMEOUT);

  it('ST-S40-15: 提示命令在真实仓库中恰好移出匹配文件', () => {
    const files: Record<string, string> = {
      'build/a.js': 'a', 'build/my file.js': 'b', 'build/x*.js': 'c', 'pkg/build/x.js': 'd',
      'a.pyc': 'e', 'deep/er/b.pyc': 'f', 'src/keep.js': 'g', 'README.md': 'h',
    };
    for (let i = 1; i <= 25; i++) files[`out/o${String(i).padStart(2, '0')}.txt`] = `${i}`;
    const root = trackedRepo(files);
    const workBytes = () => Object.fromEntries(Object.keys(files).map(f => [f, sha(readFileSync(join(root, f)))]));
    const work0 = workBytes();
    for (const pattern of ['/build/', '*.pyc', 'out/']) {
      const expected = (spawnSync('git', ['ls-files', '-z', '-ci', `--exclude=${pattern}`], { cwd: root, env: cleanEnv() }).stdout as Buffer)
        .toString('utf-8').split('\0').filter(Boolean).sort();
      const before = lsFilesZ(root);
      const r = runCli(root, ['ignore', 'add', pattern]);
      expect(r.exitCode, pattern).toBe(0);
      const cmd = hintCommand(r.stdout);
      if (pattern === 'out/') expect(cmd).toContain('--pathspec-file-nul --pathspec-from-file=logos/.openlogos-runtime/untrack-');
      runHint(root, cmd);
      const after = lsFilesZ(root);
      expect(before.filter(f => !after.includes(f)).sort(), pattern).toEqual(expected);
      expect(after).toContain('pkg/build/x.js');
      expect(after).toContain('src/keep.js');
      expect(after).toContain('README.md');
    }
    expect(workBytes()).toEqual(work0);
  }, TIMEOUT);
});
