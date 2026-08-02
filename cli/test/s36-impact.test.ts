/**
 * S36 — 生命周期变更影响分类（ci-change-impact-contract）。
 * 用例 ID 与 logos/resources/test/core-S36-test-cases.md 严格对齐（UT-S36-01..18 / ST-S36-01..10）。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts，vitest.config.ts 注册）
 * 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, lstatSync, chmodSync,
  renameSync, rmSync, mkdtempSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
  PATH_CLASSES_V1, IMPACT_SCHEMA_VERSION, classifyImpact, classifyRootRelativePath,
  classifyInputPath, stripProjectPrefix, isRevArgLexicallyValid,
  isValidGitTopLevelPath, isValidPrefixArg,
} from '../src/lib/impact-classify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..');

// ── 真实 CLI 入口（r4 F12：dist 由 globalSetup 串行构建一次，此处只读既有 dist）──
function realCliEntry(): string {
  return join(CLI_ROOT, 'dist', 'index.js');
}

interface SpawnResult { status: number | null; stdout: string; stderr: string }

function spawnCli(
  cwd: string,
  args: string[],
  opts: { input?: string; env?: Record<string, string | undefined> } = {},
): SpawnResult {
  const r = spawnSync(process.execPath, [realCliEntry(), ...args], {
    cwd,
    encoding: 'utf-8',
    input: opts.input ?? '',
    env: { ...process.env, ...opts.env },
    maxBuffer: 256 * 1024 * 1024, // 大变更集 envelope 超过 spawnSync 默认缓冲（约 1 MiB）
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// ── git fixture 工具（HOME/GIT_CONFIG 隔离：全局 diff.renames=false 等用户配置不得影响夹具）──
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function makeTmpDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-s36-${label}-`));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function gitEnv(homeDir: string): Record<string, string> {
  return {
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, '.config'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
  };
}

function git(cwd: string, homeDir: string, args: string[]): string {
  const r = spawnSync('git', args, {
    cwd, encoding: 'utf-8', env: { ...process.env, ...gitEnv(homeDir) },
    maxBuffer: 256 * 1024 * 1024, // 取 >1 MiB name-status 流做对照，需超过默认缓冲
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout ?? '';
}

/** 项目根即 git top-level 的 archive 夹具：c1 基线 → c2 纯 archive 提交 → c3 混入业务代码修改。 */
function buildArchiveFixture(root: string): { c1: string; c2: string; c3: string } {
  git(root, root, ['init']);
  git(root, root, ['config', 'commit.gpgsign', 'false']);
  mkdirSync(join(root, 'logos', 'changes', 'x'), { recursive: true });
  mkdirSync(join(root, 'cli', 'src'), { recursive: true });
  writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ name: 'fixture', locale: 'en' }));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
  writeFileSync(join(root, 'logos', 'changes', 'x', 'proposal.md'), '# proposal of x\n内容足够独特 A\n');
  writeFileSync(join(root, 'logos', 'changes', 'x', 'tasks.md'), '# tasks of x\n内容足够独特 B\n');
  writeFileSync(join(root, 'logos', 'changes', 'x', 'VERIFY_PASS'), 'verify pass at t0\n');
  writeFileSync(join(root, 'cli', 'src', 'x.ts'), 'export const x = 1;\n');
  git(root, root, ['add', '-A']);
  git(root, root, ['commit', '-m', 'c1 baseline']);
  const c1 = git(root, root, ['rev-parse', 'HEAD']).trim();

  mkdirSync(join(root, 'logos', 'changes', 'archive'), { recursive: true });
  renameSync(join(root, 'logos', 'changes', 'x'), join(root, 'logos', 'changes', 'archive', '20260801-1819-x'));
  rmSync(join(root, 'logos', '.openlogos-guard'));
  git(root, root, ['add', '-A']);
  git(root, root, ['commit', '-m', 'c2 pure archive']);
  const c2 = git(root, root, ['rev-parse', 'HEAD']).trim();

  writeFileSync(join(root, 'cli', 'src', 'x.ts'), 'export const x = 2;\n');
  git(root, root, ['add', '-A']);
  git(root, root, ['commit', '-m', 'c3 code change']);
  const c3 = git(root, root, ['rev-parse', 'HEAD']).trim();
  return { c1, c2, c3 };
}

/** monorepo 夹具：OpenLogos 项目布在 packages/app/。 */
function buildMonorepoFixture(root: string): { c1: string; c2: string; c3: string; c4: string; appDir: string } {
  git(root, root, ['init']);
  git(root, root, ['config', 'commit.gpgsign', 'false']);
  const appDir = join(root, 'packages', 'app');
  mkdirSync(join(appDir, 'logos', 'changes', 'x'), { recursive: true });
  mkdirSync(join(appDir, 'cli', 'src'), { recursive: true });
  mkdirSync(join(root, 'packages', 'other'), { recursive: true });
  writeFileSync(join(appDir, 'logos', 'logos.config.json'), JSON.stringify({ name: 'app', locale: 'en' }));
  writeFileSync(join(appDir, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'x', module: 'core' }));
  writeFileSync(join(appDir, 'logos', 'changes', 'x', 'proposal.md'), '# proposal of x (mono)\n');
  writeFileSync(join(appDir, 'logos', 'changes', 'x', 'VERIFY_PASS'), 'verify pass mono\n');
  writeFileSync(join(appDir, 'cli', 'src', 'x.ts'), 'export const x = 1;\n');
  writeFileSync(join(root, 'packages', 'other', 'y.ts'), 'export const y = 1;\n');
  git(root, root, ['add', '-A']);
  git(root, root, ['commit', '-m', 'c1 baseline']);
  const c1 = git(root, root, ['rev-parse', 'HEAD']).trim();

  mkdirSync(join(appDir, 'logos', 'changes', 'archive'), { recursive: true });
  renameSync(join(appDir, 'logos', 'changes', 'x'), join(appDir, 'logos', 'changes', 'archive', '20260801-1819-x'));
  rmSync(join(appDir, 'logos', '.openlogos-guard'));
  git(root, root, ['add', '-A']);
  git(root, root, ['commit', '-m', 'c2 pure archive']);
  const c2 = git(root, root, ['rev-parse', 'HEAD']).trim();

  writeFileSync(join(appDir, 'cli', 'src', 'x.ts'), 'export const x = 2;\n');
  git(root, root, ['add', '-A']);
  git(root, root, ['commit', '-m', 'c3 in-prefix code change']);
  const c3 = git(root, root, ['rev-parse', 'HEAD']).trim();

  writeFileSync(join(root, 'packages', 'other', 'y.ts'), 'export const y = 2;\n');
  git(root, root, ['add', '-A']);
  git(root, root, ['commit', '-m', 'c4 out-of-prefix change']);
  const c4 = git(root, root, ['rev-parse', 'HEAD']).trim();
  return { c1, c2, c3, c4, appDir };
}

// ── git 探针 shim：PATH 前置后记录任何 git 调用（证明「未调用 git / 注入值未到达 git」）──
const REAL_GIT = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf-8' }).stdout.trim();

function makeGitShim(): { shimDir: string; logPath: string } {
  const dir = makeTmpDir('shim');
  const shimDir = join(dir, 'bin');
  mkdirSync(shimDir, { recursive: true });
  const logPath = join(dir, 'git-invocations.log');
  writeFileSync(join(shimDir, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logPath}"\nexec "${REAL_GIT}" "$@"\n`);
  chmodSync(join(shimDir, 'git'), 0o755);
  return { shimDir, logPath };
}

// ── 只读快照：文件清单 + 逐文件 sha256 ──
function snapshotTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = (readdirSync(dir, { recursive: true }) as string[]).map(String).sort();
  for (const e of entries) {
    const full = join(dir, e);
    const st = lstatSync(full);
    if (st.isFile()) out[e] = createHash('sha256').update(readFileSync(full)).digest('hex');
    else if (st.isDirectory()) out[`${e}/`] = 'dir';
    else out[e] = 'symlink-or-other';
  }
  return out;
}

function parseEnvelope(s: string): { command: string; data?: unknown; error?: { code: string; message: string } } {
  return JSON.parse(s.trim());
}

function collectKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) { for (const x of v) collectKeys(x, out); }
  else if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) { out.add(k); collectKeys(val, out); }
  }
  return out;
}

const NL = '\0';
const rec = (...fields: string[]) => fields.join(NL) + NL;

/* ═══════════ 一、UT — 分类器纯函数 lib/impact-classify.ts ═══════════ */

describe('S36 impact — 路径语义契约 v1 分类（UT）', () => {
  it('UT-S36-01: lifecycle 集合正例（guard 精确文件 / changes 含 archive / resources-verify / .runtime）', () => {
    const paths = [
      'logos/.openlogos-guard',
      'logos/changes/x/proposal.md',
      'logos/changes/archive/20260801-1819-x/tasks.md',
      'logos/resources/verify/test-results.jsonl',
      'logos/.runtime/archive-watch/v1/instances/a.json',
    ];
    for (const p of paths) {
      expect(classifyRootRelativePath(p), p).toBe('lifecycle');
      expect(classifyInputPath(p, ''), p).toBe('lifecycle');
    }
    expect(PATH_CLASSES_V1.version).toBe('v1');
  });

  it('UT-S36-02: project 集合 — logos/** 内非 lifecycle 一律 project、不背书', () => {
    const paths = [
      'logos/resources/database/core-db.sql',
      'logos/logos.config.json',
      'logos/logos-project.yaml',
      'logos/resources/prd/1-product-requirements/core-01-requirements.md',
    ];
    for (const p of paths) expect(classifyRootRelativePath(p), p).toBe('project');
  });

  it('UT-S36-03: external 集合 — 项目内 logos/ 之外的一切', () => {
    for (const p of ['cli/src/index.ts', 'README.md', '.github/workflows/ci.yml']) {
      expect(classifyRootRelativePath(p), p).toBe('external');
    }
  });

  it('UT-S36-04: 前缀段边界 — 伪命中路径均不入 lifecycle（project class）', () => {
    const paths = [
      'logos/changes-evil/x.md',
      'logos/changesfoo',
      'logos/.openlogos-guard.bak',
      'logos/resources/verifyx/a.md',
    ];
    for (const p of paths) expect(classifyRootRelativePath(p), p).toBe('project');
    // 对照：精确文件与段边界命中
    expect(classifyRootRelativePath('logos/.openlogos-guard')).toBe('lifecycle');
    expect(classifyRootRelativePath('logos/changes/sub/dir/deep.md')).toBe('lifecycle');

    // 点段穿透（r1 F3）：非规范 git 路径（点段/空段/绝对路径）不得进入分类，必须在语法层拒绝
    for (const bad of [
      'logos/changes/../logos.config.json', 'logos/changes/./x.md', '/logos/changes/x.md',
      'logos//changes/x.md', 'logos/changes/x/', '.', '..', '',
    ]) {
      expect(isValidGitTopLevelPath(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isValidGitTopLevelPath('logos/changes/x.md')).toBe(true);
    expect(isValidGitTopLevelPath('logos/.openlogos-guard')).toBe(true);
    // --prefix 同段级不变量（尾 / 为 show-prefix 原生形态，合法）
    expect(isValidPrefixArg('')).toBe(true);
    expect(isValidPrefixArg('packages/app/')).toBe(true);
    expect(isValidPrefixArg('packages/app')).toBe(true);
    for (const bad of ['../p/', 'p/../q/', '/abs/', 'p//q/', './']) {
      expect(isValidPrefixArg(bad), bad).toBe(false);
    }
  });

  it('UT-S36-05: A/M/D 全 lifecycle → lifecycle_only true、non_lifecycle_paths 空', () => {
    const stream =
      rec('A', 'logos/changes/x/proposal.md') +
      rec('M', 'logos/resources/verify/test-results.jsonl') +
      rec('D', 'logos/.runtime/archive-watch/v1/instances/a.json');
    const r = classifyImpact(stream, '');
    expect(r.lifecycle_only).toBe(true);
    expect(r.non_lifecycle_paths).toEqual([]);
    expect(r.files.map(f => f.status)).toEqual(['A', 'M', 'D']);
    expect(r.files.every(f => f.class === 'lifecycle')).toBe(true);
  });

  it('UT-S36-06: R 双侧规则 — 双侧 lifecycle 才算；越界侧进 non_lifecycle_paths、class 取更不安全一侧', () => {
    const both = classifyImpact(
      rec('R100', 'logos/changes/x/a.md', 'logos/changes/archive/20260801-x/a.md'), '');
    expect(both.files[0].class).toBe('lifecycle');
    expect(both.lifecycle_only).toBe(true);

    const newOut = classifyImpact(rec('R100', 'logos/changes/x/a.md', 'cli/src/a.md'), '');
    expect(newOut.lifecycle_only).toBe(false);
    expect(newOut.files[0].class).toBe('external');
    expect(newOut.non_lifecycle_paths).toEqual(['cli/src/a.md']);

    const oldOut = classifyImpact(rec('R100', 'cli/src/a.md', 'logos/changes/x/a.md'), '');
    expect(oldOut.lifecycle_only).toBe(false);
    expect(oldOut.files[0].class).toBe('external');
    expect(oldOut.non_lifecycle_paths).toEqual(['cli/src/a.md']);
  });

  it('UT-S36-07: C 状态与 R 同规则（copy 与 rename 同判定）', () => {
    const both = classifyImpact(
      rec('C75', 'logos/changes/x/a.md', 'logos/changes/archive/20260801-x/a.md'), '');
    expect(both.files[0].class).toBe('lifecycle');
    expect(both.lifecycle_only).toBe(true);

    const out = classifyImpact(rec('C75', 'logos/changes/x/a.md', 'cli/src/a.md'), '');
    expect(out.lifecycle_only).toBe(false);
    expect(out.files[0].class).toBe('external');
    expect(out.non_lifecycle_paths).toEqual(['cli/src/a.md']);
  });

  it('UT-S36-08: 相似度后缀解析 — R100/R087/C75 规范化为单字母，数字不影响分类', () => {
    const stream =
      rec('R100', 'logos/changes/x/a.md', 'logos/changes/archive/1-x/a.md') +
      rec('R087', 'logos/changes/x/b.md', 'logos/changes/archive/1-x/b.md') +
      rec('C75', 'logos/changes/x/c.md', 'logos/changes/archive/1-x/c.md');
    const r = classifyImpact(stream, '');
    expect(r.files.map(f => f.status)).toEqual(['R', 'R', 'C']);
    expect(r.lifecycle_only).toBe(true);
  });

  it('UT-S36-09: 未知状态字母（T/U/X）→ fail-closed，reasons 含未知状态说明', () => {
    for (const s of ['T', 'U', 'X']) {
      const r = classifyImpact(rec('M', 'logos/changes/x/a.md') + rec(s, 'some/path.ts'), '');
      expect(r.lifecycle_only, s).toBe(false);
      expect(r.reasons.some(x => x.includes('unknown status') && x.includes(s)), s).toBe(true);
    }
  });

  it('UT-S36-10: 空输入 / 空 diff / 仅分隔符 → fail-closed + 原因', () => {
    for (const stream of ['', '\0', '\0\0\0']) {
      const r = classifyImpact(stream, '');
      expect(r.lifecycle_only, JSON.stringify(stream)).toBe(false);
      expect(r.reasons.some(x => x.includes('empty input')), JSON.stringify(stream)).toBe(true);
      expect(r.files).toEqual([]);
    }
  });

  it('UT-S36-11: 解析失败（截断 R 记录 / 畸形状态）→ fail-closed，不抛未捕获异常', () => {
    const truncated = classifyImpact(rec('R100', 'logos/changes/x/a.md'), '');
    expect(truncated.lifecycle_only).toBe(false);
    expect(truncated.reasons.some(x => x.includes('parse failure'))).toBe(true);

    const malformed = classifyImpact(rec('not-a-status', 'logos/changes/x/a.md'), '');
    expect(malformed.lifecycle_only).toBe(false);
    expect(malformed.reasons.some(x => x.includes('parse failure'))).toBe(true);

    const truncatedSingle = classifyImpact('M\0', '');
    expect(truncatedSingle.lifecycle_only).toBe(false);

    // 状态族闭合文法（r1 F2）：A/M/D 不吞相似度后缀；R/C 分值缺失或越界均判解析失败
    for (const bad of ['A100', 'M1', 'D000', 'R', 'C', 'R101', 'C999', 'R1000']) {
      const r = classifyImpact(rec(bad, 'logos/changes/x/a.md', 'logos/changes/x/b.md'), '');
      expect(r.lifecycle_only, bad).toBe(false);
      expect(r.reasons.some(x => x.includes('parse failure')), bad).toBe(true);
    }
    // 对照：合法分值边界仍解析成功
    expect(classifyImpact(rec('R0', 'logos/changes/x/a.md', 'logos/changes/x/b.md'), '').lifecycle_only).toBe(true);

    // 非规范 git 路径毒化整批（r1 F3）：A/M/D 单侧与 R/C 新旧任一侧异常都不能得 true
    const dotAmd = classifyImpact(rec('M', 'logos/changes/../logos.config.json'), '');
    expect(dotAmd.lifecycle_only).toBe(false);
    expect(dotAmd.reasons.some(x => x.includes('invalid git path'))).toBe(true);
    const dotRcNew = classifyImpact(
      rec('R100', 'logos/changes/x/a.md', 'logos/changes/../logos.config.json'), '');
    expect(dotRcNew.lifecycle_only).toBe(false);
    expect(dotRcNew.reasons.some(x => x.includes('invalid git path'))).toBe(true);
    const dotRcOld = classifyImpact(rec('R100', 'logos/changes/../a.md', 'logos/changes/x/a.md'), '');
    expect(dotRcOld.lifecycle_only).toBe(false);
    // 非法前缀同段级不变量：直接毒化整批
    const badPrefix = classifyImpact(rec('M', 'p/logos/changes/x.md'), '../p/');
    expect(badPrefix.lifecycle_only).toBe(false);
    expect(badPrefix.reasons.some(x => x.includes('invalid project prefix'))).toBe(true);
  });

  it('UT-S36-12: 空 marker 乱配对不影响结论 — 只按路径前缀判定，不依赖配对语义', () => {
    const r = classifyImpact(
      rec('R100', 'logos/changes/x/VERIFY_PASS', 'logos/changes/archive/20260801-x/SMOKE_PASS'), '');
    expect(r.files[0].class).toBe('lifecycle');
    expect(r.lifecycle_only).toBe(true);
  });

  it('UT-S36-13: 辅助字段推断 — 纯 archive 形态推 operations/changes；混合形态可空，判定不依赖两者', () => {
    const pure =
      rec('D', 'logos/.openlogos-guard') +
      rec('R100', 'logos/changes/x/proposal.md', 'logos/changes/archive/20260801-1819-x/proposal.md') +
      rec('R100', 'logos/changes/x/VERIFY_PASS', 'logos/changes/archive/20260801-1819-x/VERIFY_PASS');
    const p = classifyImpact(pure, '');
    expect(p.lifecycle_only).toBe(true);
    expect(p.operations).toContain('archive');
    expect(p.changes).toContain('x');

    // 混合 lifecycle 形态（额外 verify 写入）→ 不可推断，两字段空数组，lifecycle_only 判定不受影响
    const mixed = pure + rec('M', 'logos/resources/verify/test-results.jsonl');
    const m = classifyImpact(mixed, '');
    expect(m.lifecycle_only).toBe(true);
    expect(m.operations).toEqual([]);
    expect(m.changes).toEqual([]);
  });

  it('UT-S36-14: 混合变更集 → false，non_lifecycle_paths 恰含越界路径（确定性排序）', () => {
    const stream =
      rec('D', 'logos/.openlogos-guard') +
      rec('M', 'cli/src/x.ts') +
      rec('M', 'logos/changes/x/proposal.md');
    const r = classifyImpact(stream, '');
    expect(r.lifecycle_only).toBe(false);
    expect(r.non_lifecycle_paths).toEqual(['cli/src/x.ts']);
    expect(r.reasons).toContain('non-lifecycle path: cli/src/x.ts');
  });

  it('UT-S36-15: 双输入同源一致 — 同一（字节流, 前缀）经同一纯函数逐字段一致（无第二份判据）', () => {
    const stream =
      rec('D', 'logos/.openlogos-guard') +
      rec('R100', 'logos/changes/x/proposal.md', 'logos/changes/archive/1-x/proposal.md') +
      rec('M', 'cli/src/x.ts');
    // --base/--head 内部取流路径与 --stdin 路径最终都喂入 classifyImpact（impact.ts 无第二实现）
    const viaGitMode = classifyImpact(stream, '');
    const viaStdinMode = classifyImpact(stream, '');
    expect(viaStdinMode).toEqual(viaGitMode);
    const cmdSource = readFileSync(join(CLI_ROOT, 'src', 'commands', 'impact.ts'), 'utf-8');
    expect(cmdSource).toContain("from '../lib/impact-classify.js'"); // 判据只来自纯函数库
    expect((cmdSource.match(/classifyImpact\(/g) ?? []).length).toBe(1); // 两模式共用的唯一调用点
  });

  it('UT-S36-16: 项目前缀剥除（monorepo）— 前缀内剥后分类、前缀外不静默丢弃、输出保留原始路径', () => {
    const prefix = 'packages/app/';
    const stream =
      rec('M', 'packages/app/logos/changes/x/proposal.md') +
      rec('M', 'packages/app/logos/.openlogos-guard') +
      rec('M', 'packages/app/cli/src/x.ts') +
      rec('M', 'packages/other/y.ts');
    const r = classifyImpact(stream, prefix);
    expect(r.files.map(f => f.class)).toEqual(['lifecycle', 'lifecycle', 'external', 'external']);
    expect(r.files.map(f => f.path)).toEqual([
      'packages/app/logos/changes/x/proposal.md',
      'packages/app/logos/.openlogos-guard',
      'packages/app/cli/src/x.ts',
      'packages/other/y.ts',
    ]);
    expect(r.non_lifecycle_paths).toEqual(['packages/app/cli/src/x.ts', 'packages/other/y.ts']);
    expect(r.lifecycle_only).toBe(false);
  });

  it('UT-S36-17: 前缀段边界（伪前缀）— 不做裸字符串前缀匹配', () => {
    expect(classifyInputPath('packages/app-evil/logos/changes/x', 'packages/app/')).toBe('external');
    expect(classifyInputPath('packages/appx/logos/.openlogos-guard', 'packages/app/')).toBe('external');
    expect(stripProjectPrefix('packages/app-evil/logos/changes/x', 'packages/app/')).toBeNull();
    // 对照：真前缀命中
    expect(classifyInputPath('packages/app/logos/.openlogos-guard', 'packages/app/')).toBe('lifecycle');
    // 无尾斜杠前缀等价规范化
    expect(classifyInputPath('packages/app/logos/.openlogos-guard', 'packages/app')).toBe('lifecycle');
    expect(classifyInputPath('packages/app-evil/logos/changes/x', 'packages/app')).toBe('external');
  });

  it('UT-S36-18: 修订词法拒绝 — option-like / 空串全拒；合法修订值通过词法层', () => {
    for (const bad of ['--output=/tmp/x', '-O/tmp/f', '--help', '', undefined]) {
      expect(isRevArgLexicallyValid(bad as string | undefined), String(bad)).toBe(false);
    }
    for (const ok of ['a'.repeat(40), 'deadbeef', 'main', 'HEAD~1', 'feature/x', 'v1.2.3']) {
      expect(isRevArgLexicallyValid(ok), ok).toBe(true);
    }
  });
});

/* ═══════════ 二、ST — 真实 CLI 入口（dist 子进程） ═══════════ */

const IMPACT_DATA_KEYS = new Set([
  'schema_version', 'lifecycle_only', 'files', 'non_lifecycle_paths',
  'operations', 'changes', 'reasons', 'status', 'path', 'old_path', 'class',
]);

describe('S36 impact — CLI 端到端（ST）', () => {
  it('ST-S36-01: 命令注册与可发现 — --help 含 impact、supported 列表含 impact、命令可执行', () => {
    const help = spawnCli(makeTmpDir('help'), ['--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('impact');
    expect(help.stdout).toMatch(/--format <json>.*impact/);
    const indexSource = readFileSync(join(CLI_ROOT, 'src', 'index.ts'), 'utf-8');
    expect(indexSource).toMatch(/supported:.*impact/);
    expect(indexSource).toContain("case 'impact'");
    // 命令可执行（stdin 模式，无 git 依赖）
    const run = spawnCli(makeTmpDir('exec'), ['impact', '--stdin'], { input: rec('M', 'logos/changes/x/a.md') });
    expect(run.status).toBe(0);
  });

  it('ST-S36-02: --base/--head 纯 archive 提交端到端 + 完整 envelope 契约与命名回归', () => {
    const root = makeTmpDir('st02');
    const { c1, c2 } = buildArchiveFixture(root);
    const r = spawnCli(root, ['impact', '--base', c1, '--head', c2, '--format', 'json']);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    const env = parseEnvelope(r.stdout);
    expect(env.command).toBe('impact');
    expect(env.error).toBeUndefined();
    const data = env.data as Record<string, unknown>;
    expect(data.schema_version).toBe('openlogos-change-impact.v1');
    expect(data.schema_version).toBe(IMPACT_SCHEMA_VERSION);
    expect(data.lifecycle_only).toBe(true);
    // 全字段在场
    for (const k of ['files', 'non_lifecycle_paths', 'operations', 'changes', 'reasons']) {
      expect(data, k).toHaveProperty(k);
    }
    expect((data.files as unknown[]).length).toBeGreaterThan(0);
    expect(data.non_lifecycle_paths).toEqual([]);
    expect(data.operations).toEqual(['archive']);
    expect(data.changes).toEqual(['x']);
    // 命名回归红线（r1 F5：双向完整性）：data 递归键集合 === 契约声明键全集，缺任一必填键即红
    const keys = collectKeys(data);
    expect([...keys].sort()).toEqual([...IMPACT_DATA_KEYS].sort());
    // 顶层与 files[] 元素逐项精确键集合（防「并集在场但个别元素缺键」逃逸）
    expect(Object.keys(data).sort()).toEqual(
      ['changes', 'files', 'lifecycle_only', 'non_lifecycle_paths', 'operations', 'reasons', 'schema_version'],
    );
    const FILE_KEYS = ['class', 'old_path', 'path', 'status'];
    for (const f of data.files as Record<string, unknown>[]) {
      expect(Object.keys(f).sort()).toEqual(FILE_KEYS);
    }
    // 负向自证：刻意删除必填嵌套键后，上述两类断言必须能察觉（证明测试会红）
    const mutilated = (JSON.parse(r.stdout) as { data: { files: Record<string, unknown>[] } }).data;
    delete mutilated.files[0].class;
    expect(Object.keys(mutilated.files[0]).sort()).not.toEqual(FILE_KEYS);
    for (const f of mutilated.files) delete f.old_path;
    expect([...collectKeys(mutilated)].sort()).not.toEqual([...IMPACT_DATA_KEYS].sort());
    for (const leaked of ['schemaVersion', 'lifecycleOnly', 'oldPath', 'nonLifecyclePaths']) {
      expect(keys.has(leaked), leaked).toBe(false);
      expect(r.stdout).not.toContain(`"${leaked}"`);
    }
  });

  it('ST-S36-03: --stdin 端到端（非 git 目录）— 与 git 模式逐字段一致、全程未调用 git', () => {
    const root = makeTmpDir('st03-repo');
    const { c1, c2 } = buildArchiveFixture(root);
    const gitResult = spawnCli(root, ['impact', '--base', c1, '--head', c2, '--format', 'json']);
    expect(gitResult.status).toBe(0);
    const stream = git(root, root, ['diff', '--no-relative', '--name-status', '-z', c1, c2]);

    const { shimDir, logPath } = makeGitShim();
    const nonGitDir = makeTmpDir('st03-nongit');
    const stdinResult = spawnCli(nonGitDir, ['impact', '--stdin', '--format', 'json'], {
      input: stream,
      env: { PATH: shimDir },
    });
    expect(stdinResult.status).toBe(0);
    expect(parseEnvelope(stdinResult.stdout).data).toEqual(parseEnvelope(gitResult.stdout).data);
    // 探针：stdin 模式全程未调用 git
    expect(existsSync(logPath)).toBe(false);

    // r1 F4：>1 MiB 的合法 name-status 流不得被 execFileSync 默认缓冲上限（约 1 MiB）杀死
    const bigRoot = makeTmpDir('st03-big');
    git(bigRoot, bigRoot, ['init']);
    git(bigRoot, bigRoot, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(bigRoot, 'seed.txt'), 'seed');
    git(bigRoot, bigRoot, ['add', '-A']);
    git(bigRoot, bigRoot, ['commit', '-m', 'c1 seed']);
    const c1big = git(bigRoot, bigRoot, ['rev-parse', 'HEAD']).trim();
    const bulkDir = join(bigRoot, 'logos', 'changes', 'x', 'd'.repeat(200));
    mkdirSync(bulkDir, { recursive: true });
    for (let n = 0; n < 4000; n++) {
      writeFileSync(join(bulkDir, `f${String(n).padStart(4, '0')}${'f'.repeat(180)}.md`), 'x');
    }
    git(bigRoot, bigRoot, ['add', '-A']);
    git(bigRoot, bigRoot, ['commit', '-m', 'c2 bulk lifecycle']);
    const c2big = git(bigRoot, bigRoot, ['rev-parse', 'HEAD']).trim();
    const bigStream = git(bigRoot, bigRoot, ['diff', '--no-relative', '--name-status', '-z', c1big, c2big]);
    expect(bigStream.length).toBeGreaterThan(1_100_000); // 确认确实超过默认缓冲上限
    const bigGit = spawnCli(bigRoot, ['impact', '--base', c1big, '--head', c2big, '--format', 'json']);
    expect(bigGit.status).toBe(0);
    expect(bigGit.stderr).toBe('');
    const bigData = parseEnvelope(bigGit.stdout).data as Record<string, any>;
    expect(bigData.lifecycle_only).toBe(true);
    expect((bigData.files as unknown[]).length).toBe(4000);
    // 同字节流走 --stdin 与 git 模式逐字段一致（缓冲上限不得造成双模式分叉）
    const bigStdin = spawnCli(makeTmpDir('st03-big-nongit'), ['impact', '--stdin', '--format', 'json'], { input: bigStream });
    expect(bigStdin.status).toBe(0);
    expect(parseEnvelope(bigStdin.stdout).data).toEqual(bigData);
  });

  it('ST-S36-04: 混合提交端到端 — false、代码文件进 non_lifecycle_paths、exit 0（判定完成非错误）', () => {
    const root = makeTmpDir('st04');
    const { c1, c3 } = buildArchiveFixture(root);
    const r = spawnCli(root, ['impact', '--base', c1, '--head', c3, '--format', 'json']);
    expect(r.status).toBe(0);
    const data = parseEnvelope(r.stdout).data as Record<string, unknown>;
    expect(data.lifecycle_only).toBe(false);
    expect(data.non_lifecycle_paths).toContain('cli/src/x.ts');
  });

  it('ST-S36-05: git diff 失败 — 非 git 目录 / 不存在修订 → IMPACT_GIT_DIFF_FAILED、非零退出、stderr error envelope', () => {
    const nonGit = makeTmpDir('st05-nongit');
    const a = spawnCli(nonGit, ['impact', '--base', 'HEAD~1', '--head', 'HEAD', '--format', 'json']);
    expect(a.status).not.toBe(0);
    expect(a.stdout.trim()).toBe('');
    const envA = parseEnvelope(a.stderr);
    expect(envA.error?.code).toBe('IMPACT_GIT_DIFF_FAILED');
    expect(envA.data).toBeUndefined();

    const root = makeTmpDir('st05-repo');
    const { c1 } = buildArchiveFixture(root);
    const b = spawnCli(root, ['impact', '--base', c1, '--head', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '--format', 'json']);
    expect(b.status).not.toBe(0);
    expect(b.stdout.trim()).toBe('');
    expect(parseEnvelope(b.stderr).error?.code).toBe('IMPACT_GIT_DIFF_FAILED');
  });

  it('ST-S36-06: 参数组合非法 + Git 选项注入哨兵 → IMPACT_INPUT_INVALID、零写入、注入值不达 git', () => {
    const root = makeTmpDir('st06');
    const { c1, c2 } = buildArchiveFixture(root);

    const combos: string[][] = [
      ['impact', '--stdin', '--base', c1, '--head', c2, '--format', 'json'], // 并存
      ['impact', '--format', 'json'],                                        // 两组皆缺
      ['impact', '--base', c1, '--format', 'json'],                          // 只给 --base
      ['impact', '--prefix', 'packages/app/', '--base', c1, '--head', c2, '--format', 'json'], // --prefix 越模式
      ['impact', '--stdin', '--prefix', '../evil/', '--format', 'json'],                       // --prefix 段级不变量（r1 F3）
      ['impact', '--stdin', '--prefix', '/abs/', '--format', 'json'],
    ];
    for (const args of combos) {
      const r = spawnCli(root, args, { input: '' });
      expect(r.status, args.join(' ')).not.toBe(0);
      expect(r.stdout.trim(), args.join(' ')).toBe('');
      expect(parseEnvelope(r.stderr).error?.code, args.join(' ')).toBe('IMPACT_INPUT_INVALID');
    }

    // ② 注入哨兵：--output 指向项目内 / 项目外路径，各自独立跑
    const outsideDir = makeTmpDir('st06-outside');
    const sentinelIn = join(root, 'sentinel-in.txt');
    const sentinelOut = join(outsideDir, 'sentinel-out.txt');
    writeFileSync(sentinelIn, 'sentinel-in original');
    writeFileSync(sentinelOut, 'sentinel-out original');
    const createdIn = join(root, 'injected-created.txt');
    const createdOut = join(outsideDir, 'injected-created.txt');

    const { shimDir, logPath } = makeGitShim();
    const shimEnv = { PATH: `${shimDir}:${process.env.PATH ?? ''}` };

    const inj1 = spawnCli(root, ['impact', '--base', `--output=${sentinelIn}`, '--head', c2, '--format', 'json'], { env: shimEnv });
    expect(inj1.status).not.toBe(0);
    expect(inj1.stdout.trim()).toBe('');
    expect(parseEnvelope(inj1.stderr).error?.code).toBe('IMPACT_INPUT_INVALID');

    const inj2 = spawnCli(root, ['impact', '--base', c1, '--head', `--output=${sentinelOut}`, '--format', 'json'], { env: shimEnv });
    expect(inj2.status).not.toBe(0);
    expect(inj2.stdout.trim()).toBe('');
    expect(parseEnvelope(inj2.stderr).error?.code).toBe('IMPACT_INPUT_INVALID');

    const inj3 = spawnCli(root, ['impact', '--base', `--output=${createdIn}`, '--head', `--output=${createdOut}`, '--format', 'json'], { env: shimEnv });
    expect(inj3.status).not.toBe(0);

    // r1 F1：--help/-h/--version/-v 落在修订值位置不得触发全局分派——必须穿过真实 argv
    // 进入词法拒绝（IMPACT_INPUT_INVALID、非零退出、stdout 无 success envelope、零 git 调用）
    for (const [b, h] of [['--help', c2], [c1, '--version'], ['-h', c2], [c1, '-v']] as const) {
      const r = spawnCli(root, ['impact', '--base', b, '--head', h, '--format', 'json'], { env: shimEnv });
      expect(r.status, `${b} ${h}`).not.toBe(0);
      expect(r.stdout.trim(), `${b} ${h}`).toBe('');
      expect(parseEnvelope(r.stderr).error?.code, `${b} ${h}`).toBe('IMPACT_INPUT_INVALID');
    }
    // 对照：位置正确的命令级 --help 仍走全局帮助（exit 0）
    const helpOk = spawnCli(root, ['impact', '--help']);
    expect(helpOk.status).toBe(0);
    expect(helpOk.stdout).toContain('impact');

    // 哨兵字节不变 / 目标不被创建
    expect(readFileSync(sentinelIn, 'utf-8')).toBe('sentinel-in original');
    expect(readFileSync(sentinelOut, 'utf-8')).toBe('sentinel-out original');
    expect(existsSync(createdIn)).toBe(false);
    expect(existsSync(createdOut)).toBe(false);
    // 探针：词法拒绝在任何 git 调用之前——option-like 值未到达任何 git 子进程
    expect(existsSync(logPath)).toBe(false);
  });

  it('ST-S36-07: 默认文本输出 — 判定路径 stdout 人读摘要无 JSON；操作错误 stderr Error [<code>] 形态', () => {
    const dir = makeTmpDir('st07');
    const ok = spawnCli(dir, ['impact', '--stdin'], { input: rec('M', 'logos/changes/x/a.md') });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('lifecycle_only = true');
    expect(() => JSON.parse(ok.stdout.trim())).toThrow(); // stdout 无 JSON

    const err = spawnCli(dir, ['impact']);
    expect(err.status).not.toBe(0);
    expect(err.stdout.trim()).toBe('');
    expect(err.stderr).toMatch(/Error \[IMPACT_INPUT_INVALID\]: /);
  });

  it('ST-S36-08: 退出码不编码结论 — 真/假形态皆 exit 0，仅操作错误非零', () => {
    const dir = makeTmpDir('st08');
    const trueForm = spawnCli(dir, ['impact', '--stdin', '--format', 'json'], { input: rec('M', 'logos/changes/x/a.md') });
    expect(trueForm.status).toBe(0);
    expect((parseEnvelope(trueForm.stdout).data as Record<string, unknown>).lifecycle_only).toBe(true);

    const falseForm = spawnCli(dir, ['impact', '--stdin', '--format', 'json'], { input: rec('M', 'cli/src/x.ts') });
    expect(falseForm.status).toBe(0);
    expect((parseEnvelope(falseForm.stdout).data as Record<string, unknown>).lifecycle_only).toBe(false);

    const opErr = spawnCli(dir, ['impact', '--stdin', '--base', 'a', '--head', 'b'], { input: '' });
    expect(opErr.status).not.toBe(0);

    // r1 F2/F3 真实入口反例：畸形状态（A100）与点段路径均 fail-closed——判定完成 exit 0、结论 false
    const a100 = spawnCli(dir, ['impact', '--stdin', '--format', 'json'], { input: rec('A100', 'logos/changes/x/proposal.md') });
    expect(a100.status).toBe(0);
    const a100data = parseEnvelope(a100.stdout).data as Record<string, unknown>;
    expect(a100data.lifecycle_only).toBe(false);
    expect((a100data.reasons as string[]).some(x => x.includes('parse failure'))).toBe(true);

    const dotSeg = spawnCli(dir, ['impact', '--stdin', '--format', 'json'], { input: rec('M', 'logos/changes/../logos.config.json') });
    expect(dotSeg.status).toBe(0);
    const dotData = parseEnvelope(dotSeg.stdout).data as Record<string, unknown>;
    expect(dotData.lifecycle_only).toBe(false);
    expect((dotData.reasons as string[]).some(x => x.includes('invalid git path'))).toBe(true);
  });

  it('ST-S36-09: 只读性 — 项目根全量哈希快照 + 项目外哨兵，覆盖真/假/两类操作错误路径均零变化', () => {
    const root = makeTmpDir('st09');
    const { c1, c2, c3 } = buildArchiveFixture(root);
    const outsideDir = makeTmpDir('st09-outside');
    writeFileSync(join(outsideDir, 'sentinel.txt'), 'outside sentinel');

    const beforeRoot = snapshotTree(root);
    const beforeOutside = snapshotTree(outsideDir);

    expect(spawnCli(root, ['impact', '--base', c1, '--head', c2, '--format', 'json']).status).toBe(0);          // true 形态
    expect(spawnCli(root, ['impact', '--base', c1, '--head', c3, '--format', 'json']).status).toBe(0);          // false 形态
    expect(spawnCli(root, ['impact', '--base', c1, '--head', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef']).status).not.toBe(0); // GIT_DIFF_FAILED
    expect(spawnCli(root, ['impact', '--base', `--output=${join(root, 'x.txt')}`, '--head', c2]).status).not.toBe(0);          // INPUT_INVALID 注入形态
    expect(spawnCli(root, ['impact', '--stdin', '--prefix', 'p/', '--base', c1, '--head', c2]).status).not.toBe(0);            // INPUT_INVALID 组合形态

    expect(snapshotTree(root)).toEqual(beforeRoot);
    expect(snapshotTree(outsideDir)).toEqual(beforeOutside);
  });

  it('ST-S36-10: monorepo 端到端 — 自动前缀 / 前缀外不丢弃 / 双模式一致 / diff.relative 对抗配置', () => {
    const root = makeTmpDir('st10');
    const { c1, c2, c3, c4, appDir } = buildMonorepoFixture(root);

    // ① 纯 archive 提交（自动前缀经 rev-parse --show-prefix 生效）
    const r1 = spawnCli(appDir, ['impact', '--base', c1, '--head', c2, '--format', 'json']);
    expect(r1.status).toBe(0);
    const d1 = parseEnvelope(r1.stdout).data as Record<string, any>;
    expect(d1.lifecycle_only).toBe(true);
    expect(d1.operations).toEqual(['archive']);
    for (const f of d1.files) expect(String(f.path).startsWith('packages/app/'), f.path).toBe(true);

    // ② 同区间混入项目前缀内业务代码
    const r2 = spawnCli(appDir, ['impact', '--base', c1, '--head', c3, '--format', 'json']);
    const d2 = parseEnvelope(r2.stdout).data as Record<string, any>;
    expect(d2.lifecycle_only).toBe(false);
    expect(d2.non_lifecycle_paths).toContain('packages/app/cli/src/x.ts');

    // ③ 混入项目前缀外变更（不静默丢弃）
    const r3 = spawnCli(appDir, ['impact', '--base', c1, '--head', c4, '--format', 'json']);
    const d3 = parseEnvelope(r3.stdout).data as Record<string, any>;
    expect(d3.lifecycle_only).toBe(false);
    expect(d3.non_lifecycle_paths).toContain('packages/other/y.ts');
    expect(d3.files.some((f: any) => f.path === 'packages/other/y.ts')).toBe(true);

    // ④ 同字节流经 --stdin --prefix packages/app/ 在非 git 目录复跑 ①③ → 逐字段一致
    const nonGit = makeTmpDir('st10-nongit');
    const stream1 = git(root, root, ['diff', '--no-relative', '--name-status', '-z', c1, c2]);
    const stream3 = git(root, root, ['diff', '--no-relative', '--name-status', '-z', c1, c4]);
    const s1 = spawnCli(nonGit, ['impact', '--stdin', '--prefix', 'packages/app/', '--format', 'json'], { input: stream1 });
    const s3 = spawnCli(nonGit, ['impact', '--stdin', '--prefix', 'packages/app/', '--format', 'json'], { input: stream3 });
    expect(parseEnvelope(s1.stdout).data).toEqual(d1);
    expect(parseEnvelope(s3.stdout).data).toEqual(d3);

    // ⑤ 对抗配置档：diff.relative=true 后复跑 ①②③ → 与默认配置逐字段一致（--no-relative 中和）
    git(root, root, ['config', 'diff.relative', 'true']);
    const a1 = parseEnvelope(spawnCli(appDir, ['impact', '--base', c1, '--head', c2, '--format', 'json']).stdout).data as Record<string, any>;
    const a2 = parseEnvelope(spawnCli(appDir, ['impact', '--base', c1, '--head', c3, '--format', 'json']).stdout).data as Record<string, any>;
    const a3 = parseEnvelope(spawnCli(appDir, ['impact', '--base', c1, '--head', c4, '--format', 'json']).stdout).data as Record<string, any>;
    expect(a1).toEqual(d1);
    expect(a2).toEqual(d2);
    expect(a3).toEqual(d3);
    // 对照断言：有效 relative 模式未生效——files[].path 保留 top-level 坐标、前缀外路径未被裁剪
    for (const f of a1.files) expect(String(f.path).startsWith('packages/app/'), f.path).toBe(true);
    expect(a3.files.some((f: any) => f.path === 'packages/other/y.ts')).toBe(true);
    expect(a3.non_lifecycle_paths).toContain('packages/other/y.ts');
    expect(a3).toEqual(parseEnvelope(s3.stdout).data); // 与 --stdin 完整字节流结论逐字段一致
  });
});
