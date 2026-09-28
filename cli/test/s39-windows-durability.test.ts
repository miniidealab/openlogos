/**
 * S39 — 事务落盘跨平台持久化句柄与 rename 重试（fix-windows-platform-compat，切片 1）。
 * 覆盖 UT-S39-88～UT-S39-93、ST-S39-34～ST-S39-35（与 logos/resources/test/core-S39-test-cases.md 严格对齐）。
 *
 * 缺陷来源：Windows 用户 `openlogos merge` 报 `EPERM: operation not permitted, fsync`——
 * `fsyncFile` 以只读句柄 fsync，Windows 的 FlushFileBuffers 要求写权限（架构 §五十二 52.2）。
 *
 * 对 `node:fs` 只做**包装记录**（openSync flags、fsyncSync 的 fd 来源、renameSync 调用），
 * 真实文件系统行为全部透传；「模拟 Windows 语义」只在 fsync 包装层对只读 fd 抛 EPERM。
 * ST 用例跑真实 `openlogos merge` 子进程；属 Windows 回归集，在 CI windows-latest 上以真实 NTFS 运行。
 *
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const state = vi.hoisted(() => ({
  fdInfo: new Map<number, { path: string; flags: string }>(),
  fsyncs: [] as Array<{ path: string; flags: string; bytesStable: boolean }>,
  renames: [] as Array<{ from: string; to: string }>,
  /** 必红对照：把 fsyncFile 的 'r+' 改回修复前的 'r'。 */
  forceReadOnly: false,
  /** 模拟 Windows：只读 fd 上的 fsync 抛 EPERM。 */
  windowsReadOnlyFsync: false,
  fsyncFault: null as null | ((info: { path: string; flags: string }) => Error | null),
  renameFault: null as null | ((from: string, to: string) => Error | null),
  reset() {
    state.fdInfo.clear();
    state.fsyncs = [];
    state.renames = [];
    state.forceReadOnly = false;
    state.windowsReadOnlyFsync = false;
    state.fsyncFault = null;
    state.renameFault = null;
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped = {
    ...actual,
    openSync: (path: import('node:fs').PathLike, flags?: import('node:fs').OpenMode, mode?: import('node:fs').Mode) => {
      const f = state.forceReadOnly && flags === 'r+' ? 'r' : flags;
      const fd = actual.openSync(path, f, mode);
      state.fdInfo.set(fd, { path: String(path), flags: String(f) });
      return fd;
    },
    closeSync: (fd: number) => {
      state.fdInfo.delete(fd);
      return actual.closeSync(fd);
    },
    fsyncSync: (fd: number) => {
      const info = state.fdInfo.get(fd) ?? { path: '<unknown>', flags: '<unknown>' };
      if (state.windowsReadOnlyFsync && info.flags === 'r') {
        throw errno('EPERM', 'fsync');
      }
      const injected = state.fsyncFault?.(info);
      if (injected) throw injected;
      const before = info.path !== '<unknown>' ? actual.readFileSync(info.path) : null;
      actual.fsyncSync(fd);
      const after = info.path !== '<unknown>' ? actual.readFileSync(info.path) : null;
      state.fsyncs.push({ ...info, bytesStable: before !== null && after !== null && before.equals(after) });
    },
    renameSync: (from: import('node:fs').PathLike, to: import('node:fs').PathLike) => {
      state.renames.push({ from: String(from), to: String(to) });
      const injected = state.renameFault?.(String(from), String(to));
      if (injected) throw injected;
      return actual.renameSync(from, to);
    },
  };
  return { ...wrapped, default: wrapped };

  function errno(code: string, syscall: string): NodeJS.ErrnoException {
    const e = new Error(`${code}: operation not permitted (mocked), ${syscall}`) as NodeJS.ErrnoException;
    e.code = code;
    e.syscall = syscall;
    return e;
  }
});

const fs = await import('node:fs');
const { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, statSync } = fs;
const {
  applyBaselineClosureBatch, recoverBaselineClosureApply, BASELINE_CLOSURE_APPLY_JOURNAL, APPLY_TXN_DIR,
} = await import('../src/lib/baseline-apply.js');
type ApplyInput = import('../src/lib/baseline-apply.js').BaselineClosureApplyInput;
const { isTransientWindowsFsError, WINDOWS_RENAME_RETRY_DELAYS_MS } = await import('../src/lib/fs-retry.js');
const { isWindowsArchiveBusyError } = await import('../src/lib/archive-watch.js');
const { makeTempRoot, scaffoldProject, registerCoreModule, mergeAdmissibleProposal } = await import('./helpers.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = join(resolve(HERE, '..'), 'dist', 'index.js');
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

function errno(code: string, syscall = 'rename'): NodeJS.ErrnoException {
  const e = new Error(`${code}: mocked failure, ${syscall}`) as NodeJS.ErrnoException;
  e.code = code;
  e.syscall = syscall;
  return e;
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  state.reset();
});

/** 在指定 process.platform 下执行（重试 helper 在调用时读取平台）。 */
function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value: platform });
  try { return fn(); } finally { Object.defineProperty(process, 'platform', original); }
}

const MODIFY_MD = 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md';
const CREATE_MD = 'logos/resources/test/core-S99-test-cases.md';
const CREATE_HTML = 'logos/resources/prd/2-product-design/2-page-design/core-88-demo.html';
const OLD_MD = '# 功能规格\n\n## 一、既有\n\n旧内容\n';

/** 一次性隔离项目 + 三目标批次：MODIFY Markdown、CREATE Markdown、CREATE non-Markdown（HTML）。 */
function batchFixture() {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-s39-win-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const proposalDir = join(root, 'logos', 'changes', 'win-fixture');
  mkdirSync(proposalDir, { recursive: true });
  mkdirSync(dirname(join(root, MODIFY_MD)), { recursive: true });
  writeFileSync(join(root, MODIFY_MD), OLD_MD);
  const inputs: ApplyInput[] = [
    { kind: 'prepared', targetPath: MODIFY_MD, mode: 'MODIFY', bytes: '# 功能规格\n\n## 一、既有\n\n新内容\n' },
    { kind: 'prepared', targetPath: CREATE_MD, mode: 'CREATE', bytes: '# core-S99\n\n| ID | 用例 |\n|---|---|\n| UT-S99-01 | 新 |\n' },
    { kind: 'prepared', targetPath: CREATE_HTML, mode: 'CREATE', bytes: '<h1>demo</h1>\n' },
  ];
  const abs = (rel: string) => join(root, ...rel.split('/'));
  const expectAllOld = () => {
    expect(readFileSync(abs(MODIFY_MD), 'utf-8')).toBe(OLD_MD);
    expect(existsSync(abs(CREATE_MD))).toBe(false);
    expect(existsSync(abs(CREATE_HTML))).toBe(false);
  };
  const expectAllNew = () => {
    for (const input of inputs) {
      if (input.kind !== 'prepared') continue;
      expect(readFileSync(abs(input.targetPath), 'utf-8')).toBe(String(input.bytes));
    }
  };
  const materials = () => ({
    journal: existsSync(join(proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL)),
    txn: existsSync(join(proposalDir, APPLY_TXN_DIR)),
    backup: existsSync(join(proposalDir, APPLY_TXN_DIR, 'backup', '0.old')),
  });
  return { root, proposalDir, inputs, abs, expectAllOld, expectAllNew, materials };
}

/** fsync 路径 → 五条路径分类。 */
function classify(path: string, proposalDir: string, targets: string[]): string {
  if (path.includes('.baseline-rollback-')) return 'restore';
  if (path.includes(`${sep}staging${sep}`)) return 'staging';
  if (path.includes(`${sep}backup${sep}`)) return 'backup';
  if (path.startsWith(join(proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL))) return 'journal';
  if (targets.includes(path)) return 'target';
  return 'other';
}

const stagingSource = (i: number) => `${sep}${join(APPLY_TXN_DIR, 'staging', `${i}.new`)}`;

describe('S39 事务落盘跨平台持久化句柄与 rename 重试', () => {
  it('UT-S39-88: 五条路径的 fsync 句柄均可写且不截断', () => {
    // ① 成功批
    const a = batchFixture();
    const ok = applyBaselineClosureBatch(a.root, a.proposalDir, a.inputs);
    expect(ok.ok).toBe(true);
    const successSyncs = [...state.fsyncs];
    // ② 第 1 个目标写入后注入 fault → 回滚（MODIFY 目标经 restoreBackup 恢复）
    state.fsyncs = [];
    const b = batchFixture();
    const failed = applyBaselineClosureBatch(b.root, b.proposalDir, b.inputs, {
      afterWrite(_p, i) { if (i === 0) throw new Error('fault after first target'); },
    });
    expect(failed).toMatchObject({ ok: false, rolled_back: true });
    b.expectAllOld();
    const rollbackSyncs = [...state.fsyncs];

    const all = [...successSyncs, ...rollbackSyncs];
    expect(all.length).toBeGreaterThan(0);
    // 每一次 fsync 的 fd 均来自 'r+'（修复前为 'r'）
    expect(all.filter(s => s.flags !== 'r+')).toEqual([]);
    // 被 fsync 的文件字节在 fsync 前后不变（'r+' 不截断、不写入）
    expect(all.every(s => s.bytesStable)).toBe(true);
    // 五条路径各至少被观测到一次
    const kinds = new Set([
      ...successSyncs.map(s => classify(s.path, a.proposalDir, a.inputs.map(i => a.abs((i as { targetPath: string }).targetPath)))),
      ...rollbackSyncs.map(s => classify(s.path, b.proposalDir, b.inputs.map(i => b.abs((i as { targetPath: string }).targetPath)))),
    ]);
    for (const k of ['staging', 'backup', 'journal', 'target', 'restore']) expect(kinds.has(k)).toBe(true);
  });

  it('UT-S39-89: 模拟 Windows「只读句柄拒绝 fsync」语义下成功批与回滚批', () => {
    state.windowsReadOnlyFsync = true;
    // ① 成功批
    const a = batchFixture();
    expect(applyBaselineClosureBatch(a.root, a.proposalDir, a.inputs).ok).toBe(true);
    a.expectAllNew();
    expect(a.materials()).toEqual({ journal: false, txn: false, backup: false });
    // ② 回滚批
    const b = batchFixture();
    const failed = applyBaselineClosureBatch(b.root, b.proposalDir, b.inputs, {
      afterWrite(_p, i) { if (i === 1) throw new Error('fault after second target'); },
    });
    expect(failed).toMatchObject({ ok: false, rolled_back: true });
    b.expectAllOld();
    expect(b.materials()).toEqual({ journal: false, txn: false, backup: false });
    // 必红对照：修复前实现（只读句柄）在同一语义下于 staging 阶段即失败
    state.forceReadOnly = true;
    const c = batchFixture();
    const legacy = applyBaselineClosureBatch(c.root, c.proposalDir, c.inputs);
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) {
      expect(legacy.error).toContain('无法准备私有 staging/backup');
      expect(legacy.error).toContain('EPERM');
    }
    c.expectAllOld();
  });

  it('UT-S39-90: 非权限类 fsync 失败不被吞、整批回滚', () => {
    const points: Array<[string, (info: { path: string }, fx: ReturnType<typeof batchFixture>) => boolean]> = [
      ['staging', info => info.path.includes(`${sep}staging${sep}`)],
      // commit 阶段内的 journal 刷新：首个目标已提交之后标记 applied 时写 journal
      ['journal', (info, fx) => info.path.startsWith(join(fx.proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL))
        && state.renames.some(r => r.from.endsWith(stagingSource(0)))],
      ['target', (info, fx) => info.path === fx.abs(MODIFY_MD)],
    ];
    for (const [name, match] of points) {
      state.reset();
      const fx = batchFixture();
      let fired = false;
      state.fsyncFault = info => {
        if (fired || !match(info, fx)) return null;
        fired = true;
        return errno('EIO', 'fsync');
      };
      const result = applyBaselineClosureBatch(fx.root, fx.proposalDir, fx.inputs);
      expect(fired, name).toBe(true);
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.error, name).toContain('EIO');
        // staging 阶段：正式目标零写入；commit 阶段（journal / 目标 rename 后）：rolled_back=true
        if (name === 'staging') expect(state.renames.filter(r => r.from.includes(`${sep}staging${sep}`)), name).toEqual([]);
        else expect(result.rolled_back, name).toBe(true);
      }
      fx.expectAllOld();
      expect(fx.materials(), name).toEqual({ journal: false, txn: false, backup: false });
      // 异常后未继续执行下一个目标的提交 rename
      const committedLater = state.renames.filter(r => r.from.endsWith(stagingSource(1)));
      expect(committedLater, name).toEqual([]);
    }
  });

  it('UT-S39-91: rename 瞬时锁有界重试后成功', () => {
    expect(isTransientWindowsFsError).toBe(isWindowsArchiveBusyError);
    expect(WINDOWS_RENAME_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);
    for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
      state.reset();
      const fx = batchFixture();
      let failures = 0;
      state.renameFault = from => {
        if (!from.endsWith(stagingSource(0)) || failures >= 2) return null;
        failures++;
        return errno(code);
      };
      const started = Date.now();
      const result = withPlatform('win32', () => applyBaselineClosureBatch(fx.root, fx.proposalDir, fx.inputs));
      const elapsed = Date.now() - started;
      expect(result.ok, code).toBe(true);
      fx.expectAllNew();
      const attempts = state.renames.filter(r => r.from.endsWith(stagingSource(0))).length;
      expect(attempts - 1, code).toBe(2);
      expect(elapsed, code).toBeLessThan(1000);
    }
  });

  it('UT-S39-92: rename 重试用尽（仅提交 rename 受阻）/ 非瞬时错误 / 非 win32 不重试', () => {
    const arms: Array<[string, NodeJS.Platform, string, number]> = [
      ['win32-EBUSY-persistent', 'win32', 'EBUSY', 1 + WINDOWS_RENAME_RETRY_DELAYS_MS.length],
      ['win32-ENOENT', 'win32', 'ENOENT', 1],
      ['darwin-EBUSY', 'darwin', 'EBUSY', 1],
    ];
    for (const [name, platform, code, expectedAttempts] of arms) {
      state.reset();
      const fx = batchFixture();
      // 故障只注入第 1 个目标的 staged → target 提交 rename，持续到本次调用返回；其余 rename 透传。
      state.renameFault = from => (from.endsWith(stagingSource(0)) ? errno(code) : null);
      const result = withPlatform(platform, () => applyBaselineClosureBatch(fx.root, fx.proposalDir, fx.inputs));
      state.renameFault = null;
      expect(result.ok, name).toBe(false);
      if (!result.ok) {
        expect(result.error, name).toContain(code);
        expect(result.rolled_back, name).toBe(true);
      }
      const attempts = state.renames.filter(r => r.from.endsWith(stagingSource(0))).length;
      expect(attempts, name).toBe(expectedAttempts);
      fx.expectAllOld();
      expect(fx.materials(), name).toEqual({ journal: false, txn: false, backup: false });
    }
  });

  it('UT-S39-93: 故障覆盖恢复阶段：如实报告、保留恢复材料、解除后可恢复与重试', () => {
    const fx = batchFixture();
    let armed = false;
    let lifted = false;
    // 故障从第 1 个目标的提交 rename 开始，作用于其后全部 rename（含 journal 写入与恢复），直到显式解除。
    state.renameFault = from => {
      if (lifted) return null;
      if (from.endsWith(stagingSource(0))) armed = true;
      return armed ? errno('EBUSY') : null;
    };
    const result = withPlatform('win32', () => applyBaselineClosureBatch(fx.root, fx.proposalDir, fx.inputs));
    expect(armed).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rolled_back).toBe(false);
      expect(result.error).toContain('回滚失败');
      expect(result.error).toContain('EBUSY');
    }
    // 恢复材料保留，未为「无残留」而删除
    expect(fx.materials()).toEqual({ journal: true, txn: true, backup: true });
    fx.expectAllOld();

    lifted = true;
    const recovered = withPlatform('win32', () => recoverBaselineClosureApply(fx.root, fx.proposalDir));
    expect(recovered).toEqual({ ok: true, recovered: 'rolled_back' });
    fx.expectAllOld();
    expect(fx.materials()).toEqual({ journal: false, txn: false, backup: false });

    const retried = withPlatform('win32', () => applyBaselineClosureBatch(fx.root, fx.proposalDir, fx.inputs));
    expect(retried.ok).toBe(true);
    fx.expectAllNew();
  });
});

// ── ST：真实 `openlogos merge` 子进程（Windows 回归集）──────────────────────────────

const ST_SPEC_REL = 'logos/resources/test/core-S99-test-cases.md';
const ST_FEATURE_REL = 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md';
const PROTO_REL = 'logos/resources/prd/2-product-design/2-page-design/core-88-demo.html';
const PROTO_BODY = '<h1>demo</h1>\n';
const FEATURE_BASE = '# 功能规格\n\n## 一、既有能力\n\n旧描述。\n';

/** 报告中的三目标形态：MODIFY 功能规格 Markdown + CREATE 测试规格 Markdown + UI 原型 HTML。 */
function mergeFixture(slug: string) {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  registerCoreModule(root);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    'project:\n  name: t\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n    product_type: web\n');
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: slug, module: 'core', createdAt: '2026-09-28T00:00:00.000Z' }));
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  const uiBlock = '\n## UI/UX 变更声明\n\n```yaml\nui_impact: true\ndesign_system_mode: generated\npages:\n'
    + '  - id: demo\n    prototype: core-88-demo.html\n    description: demo\n```\n';
  writeFileSync(join(dir, 'proposal.md'),
    mergeAdmissibleProposal(slug, 'core').replace(/\n## 决策澄清/, `${uiBlock}\n## 决策澄清`));
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '',
    '## [delta] 规格变更', '',
    '- [x] 产出 delta 文件到 `deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md` — 修改功能规格',
    '- [x] 产出 delta 文件到 `deltas/test/core-S99-test-cases.md` — 新增测试规格',
    '- [x] 产出 delta 文件到 `deltas/prd/2-product-design/2-page-design/core-88-demo.html` — 新增原型', '',
    '## [code] 代码实现', '',
  ].join('\n'));
  writeFileSync(join(dir, 'design-system.json'), JSON.stringify({ tokens: { color: { primary: '#000' } } }));
  writeFileSync(join(dir, 'PLAN_APPROVED'), `${JSON.stringify({
    ui_prototype_rendered: true, pages: ['core-88-demo.html'], hashes: { 'core-88-demo.html': sha(PROTO_BODY) },
  }, null, 2)}\n`);

  mkdirSync(join(root, dirname(ST_FEATURE_REL)), { recursive: true });
  writeFileSync(join(root, ST_FEATURE_REL), FEATURE_BASE);
  const deltas = join(dir, 'deltas');
  mkdirSync(join(deltas, 'prd', '2-product-design', '1-feature-specs'), { recursive: true });
  mkdirSync(join(deltas, 'prd', '2-product-design', '2-page-design'), { recursive: true });
  mkdirSync(join(deltas, 'test'), { recursive: true });
  writeFileSync(join(deltas, 'prd', '2-product-design', '1-feature-specs', 'core-01-feature-specs.md'),
    '## MODIFIED — 一、既有能力\n\n新描述。\n');
  writeFileSync(join(deltas, 'test', 'core-S99-test-cases.md'), [
    `## ADDED — ${ST_SPEC_REL}（新文件，整文件）`,
    '# core-S99 测试用例',
    '',
    '## 一、新增用例',
    '',
    '| ID | 用例 |',
    '|---|---|',
    '| UT-S99-01 | 新增 |',
    '',
  ].join('\n'));
  writeFileSync(join(deltas, 'prd', '2-product-design', '2-page-design', 'core-88-demo.html'), PROTO_BODY);
  return { root, dir, slug };
}

function installEnv(extra: Record<string, string> = {}): Record<string, string> {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('OPENLOGOS_INTERNAL_') || k === 'NODE_ENV' || k === 'OPENLOGOS_TEST_MERGE_FAIL_AFTER') continue;
    if (typeof v === 'string') e[k] = v;
  }
  return { ...e, NODE_ENV: 'production', ...extra };
}

function runCli(cwd: string, args: string[], env: Record<string, string>) {
  const r = spawnSync(process.execPath, [CLI_ENTRY, ...args], { cwd, encoding: 'utf-8', env });
  return { status: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

/** logos/resources 与 logos-project.yaml 的逐文件 hash 快照。 */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[p.slice(root.length + 1).split(sep).join('/')] = sha(readFileSync(p));
    }
  };
  walk(join(root, 'logos', 'resources'));
  out['logos/logos-project.yaml'] = sha(readFileSync(join(root, 'logos', 'logos-project.yaml')));
  return out;
}

function assertMerged(root: string, dir: string, out: string): void {
  expect(out).not.toContain('EPERM');
  expect(readFileSync(join(root, ST_FEATURE_REL), 'utf-8')).toContain('新描述。');
  expect(readFileSync(join(root, ST_SPEC_REL), 'utf-8')).toContain('| UT-S99-01 | 新增 |');
  expect(readFileSync(join(root, PROTO_REL), 'utf-8')).toBe(PROTO_BODY);
  expect(existsSync(join(dir, 'SPEC_MERGED'))).toBe(true);
  expect(existsSync(join(dir, BASELINE_CLOSURE_APPLY_JOURNAL))).toBe(false);
  expect(existsSync(join(dir, APPLY_TXN_DIR))).toBe(false);
}

describe('S39 真实 merge 在 Windows 文件系统上的事务落盘（Windows 回归集）', () => {
  it('ST-S39-34: 真实文件系统上真实 merge 成功', () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);
    const f = mergeFixture('st39-34');
    const lint = runCli(f.root, ['change-lint', '--slug', f.slug], installEnv());
    expect(lint.status, lint.out).toBe(0);
    const merged = runCli(f.root, ['merge', f.slug], installEnv());
    expect(merged.status, merged.out).toBe(0);
    assertMerged(f.root, f.dir, merged.out);
  });

  it('ST-S39-35: 真实文件系统上 fault 回滚并可重试成功', () => {
    const f = mergeFixture('st39-35');
    const before = snapshot(f.root);
    // 经 applyBaselineClosureBatch 的 hook.afterWrite 注入（NODE_ENV=test 专用开关），不替换文件系统。
    const faulted = runCli(f.root, ['merge', f.slug], installEnv({
      NODE_ENV: 'test', OPENLOGOS_TEST_MERGE_FAIL_AFTER: ST_SPEC_REL,
    }));
    expect(faulted.status, faulted.out).not.toBe(0);
    expect(faulted.out).toContain('test fault after');
    expect(faulted.out).not.toContain('EPERM');
    expect(snapshot(f.root)).toEqual(before);
    expect(existsSync(join(f.dir, 'SPEC_MERGED'))).toBe(false);
    expect(existsSync(join(f.dir, BASELINE_CLOSURE_APPLY_JOURNAL))).toBe(false);

    const retried = runCli(f.root, ['merge', f.slug], installEnv());
    expect(retried.status, retried.out).toBe(0);
    assertMerged(f.root, f.dir, retried.out);
  });
});
