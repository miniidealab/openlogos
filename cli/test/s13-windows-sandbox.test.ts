/**
 * S13 — 沙箱默认根三入口与清理跨平台（fix-windows-platform-compat，切片 3）。
 * 覆盖 UT-S13-76～UT-S13-80、ST-S13-22（与 logos/resources/test/core-S13-test-cases.md 严格对齐）。
 *
 * 依据架构 §五十二 52.3 / 52.6：默认根在**读取时**按平台解析（darwin 为 /private/tmp，其余为
 * os.tmpdir()），init 与 sync 补默认值不再把绝对 sandbox_root 固化进跨机配置；历史默认值
 * /private/tmp 在非 darwin 视为未显式配置；递归删除统一经 Node 内置 maxRetries；收尾清理失败降级告警。
 *
 * 对 `node:fs` 仅包装 rmSync 做调用记录与故障注入，其余透传。ST-S13-22 属 Windows 回归集。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

const rmState = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; options: Record<string, unknown> | undefined }>,
  fault: null as null | ((path: string) => Error | null),
  reset() { rmState.calls = []; rmState.fault = null; },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const wrapped = {
    ...actual,
    rmSync: (path: import('node:fs').PathLike, options?: import('node:fs').RmOptions) => {
      rmState.calls.push({ path: String(path), options: options as Record<string, unknown> | undefined });
      const injected = rmState.fault?.(String(path));
      if (injected) throw injected;
      return actual.rmSync(path, options);
    },
  };
  return { ...wrapped, default: wrapped };
});

const { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } = await import('node:fs');
const { spawnSync } = await import('node:child_process');
const { tmpdir } = await import('node:os');
const { basename, dirname, join, resolve } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const {
  normalizeSandboxConfig, resolveDefaultSandboxRoot, runSandboxedCommand, LEGACY_DEFAULT_SANDBOX_ROOT,
} = await import('../src/lib/sandbox.js');
const { REMOVE_TREE_MAX_RETRIES, REMOVE_TREE_RETRY_DELAY_MS } = await import('../src/lib/fs-remove.js');
const { verify } = await import('../src/commands/verify.js');
const { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } = await import('./helpers.js');

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..');
const CLI_ENTRY = join(CLI_ROOT, 'dist', 'index.js');

const cleanups: Array<() => void> = [];
afterEach(() => {
  rmState.reset();
  while (cleanups.length) cleanups.pop()!();
});

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function cli(cwd: string, args: string[]) {
  const r = spawnSync(process.execPath, [CLI_ENTRY, ...args], { cwd, encoding: 'utf-8' });
  return { status: r.status, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

function readConfig(root: string): Record<string, Record<string, unknown>> {
  return JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
}

describe('S13 沙箱默认根三入口与清理跨平台', () => {
  it('UT-S13-76: 真实 init 生成的配置不含绝对 sandbox_root', () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);
    const root = tempDir('openlogos-s13-init-');
    const r = cli(root, ['init', '--name', 't', '--locale', 'zh']);
    expect(r.status, r.out).toBe(0);
    const config = readConfig(root);
    for (const section of ['verify', 'smoke']) {
      expect(config[section], section).toBeDefined();
      expect('sandbox_root' in config[section], section).toBe(false);
      expect(config[section].sandbox_mode, section).toBe('auto');
      expect(config[section].sandbox_deny_workspace_write, section).toBe(true);
    }
    // 读取后按平台解析
    expect(normalizeSandboxConfig(config.verify).root).toBe(resolveDefaultSandboxRoot());
  });

  it('UT-S13-77: 读取入口按平台解析默认根', () => {
    const raw = { sandbox_mode: 'auto' };
    expect(normalizeSandboxConfig(raw, 'darwin').root).toBe('/private/tmp');
    expect(normalizeSandboxConfig(raw, 'linux').root).toBe(tmpdir());
    expect(normalizeSandboxConfig(raw, 'win32').root).toBe(tmpdir());
    expect(resolveDefaultSandboxRoot('darwin')).toBe(LEGACY_DEFAULT_SANDBOX_ROOT);
  });

  it('UT-S13-78: 历史默认值与显式配置区分（含真实 sync）', () => {
    const legacy = { sandbox_mode: 'auto', sandbox_root: '/private/tmp' };
    expect(normalizeSandboxConfig(legacy, 'linux').root).toBe(tmpdir());
    expect(normalizeSandboxConfig(legacy, 'win32').root).toBe(tmpdir());
    expect(normalizeSandboxConfig(legacy, 'darwin').root).toBe('/private/tmp');
    const explicit = { sandbox_mode: 'auto', sandbox_root: '/data/sbx' };
    for (const p of ['linux', 'win32', 'darwin'] as NodeJS.Platform[]) {
      expect(normalizeSandboxConfig(explicit, p).root, p).toBe('/data/sbx');
    }

    // 真实 sync：旧配置含历史默认值 / 缺该键 / 用户显式值——sync 不补入、不改写 sandbox_root
    const root = tempDir('openlogos-s13-sync-');
    expect(cli(root, ['init', '--name', 't', '--locale', 'zh']).status).toBe(0);
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = readConfig(root);
    config.verify = { ...config.verify, sandbox_root: '/private/tmp' };
    delete config.smoke.sandbox_root;
    delete config.smoke.sandbox_mode;
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    const r = cli(root, ['sync']);
    expect(r.status, r.out).toBe(0);
    const after = readConfig(root);
    expect(after.verify.sandbox_root).toBe('/private/tmp');       // 已有值不改写
    expect('sandbox_root' in after.smoke).toBe(false);             // 不补入
    expect(after.smoke.sandbox_mode).toBe('auto');                 // 其它默认值照常补
    // 读取时历史值在非 darwin 解析为 os.tmpdir()
    expect(normalizeSandboxConfig(after.verify, 'win32').root).toBe(tmpdir());

    after.verify.sandbox_root = '/data/sbx';
    writeFileSync(configPath, JSON.stringify(after, null, 2));
    expect(cli(root, ['sync']).status).toBe(0);
    expect(readConfig(root).verify.sandbox_root).toBe('/data/sbx');
  });

  it('UT-S13-79: 递归清理传入内置重试参数', () => {
    const origin = tempDir('openlogos-s13-origin-');
    const base = tempDir('openlogos-s13-base-');
    writeFileSync(join(origin, 'ok.js'), 'process.exit(0);\n');
    rmState.calls = [];
    const res = runSandboxedCommand({
      root: origin, command: 'node ok.js', format: 'json',
      sandbox: { mode: 'auto', root: base, denyWorkspaceWrite: false }, allowedWritePaths: [],
    });
    expect(res.command.status).toBe('pass');
    const recursive = rmState.calls.filter(c => c.options?.recursive === true && c.path.startsWith(base));
    expect(recursive.length).toBeGreaterThan(0);
    for (const c of recursive) {
      expect(c.options?.maxRetries, c.path).toBe(REMOVE_TREE_MAX_RETRIES);
      expect(c.options?.retryDelay, c.path).toBe(REMOVE_TREE_RETRY_DELAY_MS);
    }
    expect(REMOVE_TREE_MAX_RETRIES).toBeGreaterThan(0);

    // 静态：cli/src 中全部递归 rmSync 调用点经同一薄封装，不存在自建删除重试循环
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts') || basename(p) === 'fs-remove.ts') continue;
        const src = readFileSync(p, 'utf-8');
        if (/rmSync\([^)]*recursive:\s*true/.test(src)) offenders.push(p.slice(CLI_ROOT.length + 1));
      }
    };
    walk(join(CLI_ROOT, 'src'));
    expect(offenders).toEqual([]);
  });

  it('UT-S13-80: 收尾清理失败降级告警、不覆盖测试结果', () => {
    const origin = tempDir('openlogos-s13-origin-');
    const base = tempDir('openlogos-s13-base-');
    writeFileSync(join(origin, 'ok.js'), 'process.exit(0);\n');
    rmState.fault = path => (basename(path).startsWith('openlogos-cli-sandbox-')
      ? Object.assign(new Error('EBUSY: resource busy or locked (mocked), rmdir'), { code: 'EBUSY' })
      : null);
    let res: ReturnType<typeof runSandboxedCommand> | undefined;
    expect(() => {
      res = runSandboxedCommand({
        root: origin, command: 'node ok.js', format: 'json',
        sandbox: { mode: 'auto', root: base, denyWorkspaceWrite: false }, allowedWritePaths: [],
      });
    }).not.toThrow();
    expect(res!.command.status).toBe('pass');
    expect(res!.command.exit_code).toBe(0);
    const leftover = readdirSync(base).find(n => n.startsWith('openlogos-cli-sandbox-'))!;
    expect(leftover).toBeDefined();
    const diag = res!.sandbox.diagnostics.join('\n');
    expect(diag).toContain('沙箱目录清理失败');
    expect(diag).toContain(leftover);
    expect(res!.sandbox.status).not.toBe('fail');
  });

  it('ST-S13-22: 真实 verify 沙箱运行（Windows 回归集）', () => {
    for (const variant of ['legacy', 'absent'] as const) {
      const { root, cleanup } = makeTempRoot();
      cleanups.push(cleanup);
      scaffoldProject(root, { locale: 'en' });
      writeFileSync(join(root, 'logos/resources/test', 'S99-test-cases.md'), '| UT-S99-01 | d |\n');
      writeFileSync(join(root, 'prerun.js'), [
        "const fs=require('fs');",
        "fs.mkdirSync('logos/resources/verify',{recursive:true});",
        "fs.writeFileSync('logos/resources/verify/test-results.jsonl','{\"id\":\"UT-S99-01\",\"status\":\"pass\"}\\n');",
      ].join('\n'));
      const configPath = join(root, 'logos', 'logos.config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      config.verify = { ...config.verify, sandbox_mode: 'auto', sandbox_deny_workspace_write: false, pre_run_command: 'node prerun.js' };
      if (variant === 'legacy') config.verify.sandbox_root = '/private/tmp';
      else delete config.verify.sandbox_root;
      writeFileSync(configPath, JSON.stringify(config, null, 2));

      const expectedBase = resolveDefaultSandboxRoot();
      const before = existsSync(expectedBase)
        ? new Set(readdirSync(expectedBase).filter(n => n.startsWith('openlogos-cli-sandbox-')))
        : new Set<string>();
      const restoreCwd = mockCwd(root);
      const con = captureConsole();
      const exitSpy = mockProcessExit();
      try { verify('json'); } catch { /* process.exit mocked */ } finally { con.restore(); exitSpy.mockRestore(); restoreCwd(); }
      const parsed = JSON.parse(con.logs[0]);
      // verify 输出的 sandbox.root 为本次沙箱目录，其父目录即解析出的默认根
      const sandboxBase = dirname(parsed.data.sandbox.root);
      expect(sandboxBase, variant).toBe(expectedBase);
      if (process.platform === 'win32') {
        expect(sandboxBase, variant).toBe(tmpdir());
        expect(sandboxBase.toLowerCase(), variant).not.toContain('\\private\\tmp');
      }
      expect(parsed.data.gate.result, variant).toBe('PASS');
      // 沙箱目录已清理（或清理失败时仅有告警、验收结论不变）
      const leftovers = readdirSync(expectedBase)
        .filter(n => n.startsWith('openlogos-cli-sandbox-') && !before.has(n));
      if (leftovers.length > 0) {
        expect(parsed.data.sandbox.diagnostics.join('\n'), variant).toContain('沙箱目录清理失败');
      }
    }
  });
});

