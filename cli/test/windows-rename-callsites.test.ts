/**
 * 范围内其余 rename 落盘入口接入 Windows 瞬时错误有界重试（fix-windows-platform-compat，code 评审 F4 处置）。
 * 与 UT-S39-91 / UT-S39-92 同一判据（架构 §五十二 52.3：共享 helper、仅 win32 且 EPERM/EACCES/EBUSY 重试、
 * 用尽原样抛出、非 win32 不重试），覆盖提案点名的清单原子提交、baseline-seed 原子写、沙箱结果回收与
 * ui-provenance 原型提交。对 `node:fs` 只包装 renameSync 做记录与故障注入，其余透传。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
  renames: [] as Array<{ from: string; to: string }>,
  renameFault: null as null | ((from: string, to: string) => Error | null),
  reset() { state.renames = []; state.renameFault = null; },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped = {
    ...actual,
    renameSync: (from: import('node:fs').PathLike, to: import('node:fs').PathLike) => {
      state.renames.push({ from: String(from), to: String(to) });
      const injected = state.renameFault?.(String(from), String(to));
      if (injected) throw injected;
      return actual.renameSync(from, to);
    },
  };
  return { ...wrapped, default: wrapped };
});

const { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { dirname, join, resolve } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { WINDOWS_RENAME_RETRY_DELAYS_MS } = await import('../src/lib/fs-retry.js');
const { commitStagedFile } = await import('../src/lib/test-slice-manifest.js');
const { atomicWrite } = await import('../src/lib/baseline-seed-txn.js');
const { runSandboxedCommand } = await import('../src/lib/sandbox.js');
const { commitVerifiedPrototypes, PROTOTYPE_DELTA_SUBPATH, PROTOTYPE_RESOURCE_SUBPATH } = await import('../src/lib/ui-provenance.js');

const SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src', 'lib');
const MAX_ATTEMPTS = WINDOWS_RENAME_RETRY_DELAYS_MS.length + 1;

const cleanups: Array<() => void> = [];
afterEach(() => {
  state.reset();
  while (cleanups.length) cleanups.pop()!();
});

function tempDir(prefix: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: mocked failure, rename`), { code, syscall: 'rename' });
}

const ORIGINAL_PLATFORM = Object.getOwnPropertyDescriptor(process, 'platform')!;
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { ...ORIGINAL_PLATFORM, value: platform });
}
afterEach(() => { Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM); });

/**
 * 对 rename 到 target 的调用注入：前 failFirst 次抛 code（Infinity = 持续）。平台注入延迟到首次命中该 rename
 * 时才生效——入口在此之前的其它平台分支（如沙箱在 win32 下改用 cmd.exe 启动命令）保持本机真实行为。
 */
function injectOn(target: string, code: string, failFirst: number, platform: NodeJS.Platform): () => number {
  let attempts = 0;
  state.renameFault = (_from, to) => {
    if (to !== target) return null;
    setPlatform(platform);
    attempts++;
    return attempts <= failFirst ? errno(code) : null;
  };
  return () => attempts;
}

function runOnce(fx: { run: () => unknown }): unknown {
  try {
    fx.run();
    return null;
  } catch (error) {
    return error;
  } finally {
    Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM);
    state.renameFault = null;
  }
}

interface CallSite {
  name: string;
  /** 准备夹具，返回：执行入口、受注入的目标路径、成功判定、失败时目标应保持的字节（null = 不存在）。 */
  setup: () => { run: () => unknown; target: string; ok: () => boolean; before: Buffer | null };
}

const CALL_SITES: CallSite[] = [
  {
    name: 'test-slice-manifest commitStagedFile',
    setup: () => {
      const dir = tempDir('olw-manifest-');
      const target = join(dir, 'TEST_SLICE_MANIFEST.json');
      writeFileSync(target, '{"old":true}\n');
      const temp = join(dir, '.manifest.tmp');
      writeFileSync(temp, '{"new":true}\n');
      return {
        run: () => commitStagedFile(temp, target), target, before: readFileSync(target),
        ok: () => readFileSync(target, 'utf8') === '{"new":true}\n',
      };
    },
  },
  {
    name: 'baseline-seed-txn atomicWrite',
    setup: () => {
      const dir = tempDir('olw-seed-');
      const target = join(dir, 'commit-journal.json');
      writeFileSync(target, 'old');
      return { run: () => atomicWrite(target, 'new'), target, before: readFileSync(target), ok: () => readFileSync(target, 'utf8') === 'new' };
    },
  },
  {
    name: 'ui-provenance 原型提交（safeRename / journal）',
    setup: () => {
      const root = tempDir('olw-proto-');
      const proposalDir = join(root, 'logos', 'changes', 'demo');
      mkdirSync(join(proposalDir, PROTOTYPE_DELTA_SUBPATH), { recursive: true });
      writeFileSync(join(proposalDir, PROTOTYPE_DELTA_SUBPATH, 'core-01-home.html'), '<html>new</html>\n');
      const target = join(root, PROTOTYPE_RESOURCE_SUBPATH, 'core-01-home.html');
      return {
        run: () => {
          const r = commitVerifiedPrototypes(proposalDir, root);
          if (!r.ok) throw new Error(`commit failed: ${r.reason}`);
          return r;
        },
        target, before: null,
        ok: () => existsSync(target) && readFileSync(target, 'utf8') === '<html>new</html>\n',
      };
    },
  },
  {
    name: 'sandbox 白名单结果回收',
    setup: () => {
      const origin = tempDir('olw-sbx-origin-');
      const base = tempDir('olw-sbx-base-');
      writeFileSync(join(origin, 'w.js'),
        "require('fs').mkdirSync('out',{recursive:true});require('fs').writeFileSync('out/r.txt','sandbox result');\n");
      const target = join(origin, 'out', 'r.txt');
      let violations: string[] = [];
      return {
        run: () => {
          const res = runSandboxedCommand({
            root: origin, command: 'node w.js', format: 'json',
            sandbox: { mode: 'auto', root: base, denyWorkspaceWrite: false }, allowedWritePaths: ['out/r.txt'],
          });
          violations = (res as { violations?: string[] }).violations ?? [];
          const recovered = existsSync(target);
          if (!recovered) throw new Error(`回收失败：${JSON.stringify(res)}`);
          return res;
        },
        target, before: null,
        ok: () => existsSync(target) && readFileSync(target, 'utf8') === 'sandbox result' && violations.length === 0,
      };
    },
  },
];

describe('范围内 rename 落盘入口接入 Windows 瞬时错误有界重试', () => {
  it('UT-S39-91: 清单 / baseline-seed / ui-provenance / 沙箱回收的 rename 瞬时锁有界重试后成功', () => {
    for (const site of CALL_SITES) {
      for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
        state.reset();
        const fx = site.setup();
        const attempts = injectOn(fx.target, code, 2, 'win32');
        const error = runOnce(fx);
        expect(error, `${site.name} ${code}`).toBeNull();
        expect(fx.ok(), `${site.name} ${code}`).toBe(true);
        expect(attempts() - 1, `${site.name} ${code} 重试次数`).toBe(2);
      }
    }
    // 静态：点名入口不再直接调用 renameSync
    const direct: Array<[string, RegExp]> = [
      ['test-slice-manifest.ts', /export function commitStagedFile[^}]*renameSync/],
      ['baseline-seed-txn.ts', /export function atomicWrite[^}]*renameSync/],
      ['ui-provenance.ts', /renameSync\(/],
      ['sandbox.ts', /renameSync\(/],
    ];
    for (const [file, pattern] of direct) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).not.toMatch(pattern);
    }
  }, 60_000);

  it('UT-S39-92: 清单 / baseline-seed / ui-provenance / 沙箱回收的 rename 重试用尽如实失败、非 win32 不重试', () => {
    const arms: Array<[string, NodeJS.Platform, string, number]> = [
      ['win32-EPERM-persistent', 'win32', 'EPERM', MAX_ATTEMPTS],
      ['win32-ENOENT', 'win32', 'ENOENT', 1],
      ['darwin-EBUSY', 'darwin', 'EBUSY', 1],
    ];
    for (const site of CALL_SITES) {
      for (const [arm, platform, code, expected] of arms) {
        state.reset();
        const fx = site.setup();
        const attempts = injectOn(fx.target, code, Infinity, platform);
        const thrown = runOnce(fx);
        expect(thrown, `${site.name} ${arm} 如实失败`).toBeTruthy();
        expect(attempts(), `${site.name} ${arm} 尝试次数`).toBe(expected);
        // 目标保持调用前状态（既有回滚 / 不写入语义不变）
        if (fx.before === null) expect(existsSync(fx.target), `${site.name} ${arm}`).toBe(false);
        else expect(readFileSync(fx.target).equals(fx.before), `${site.name} ${arm}`).toBe(true);
      }
    }
  }, 120_000);
});
