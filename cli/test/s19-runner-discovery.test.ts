/**
 * fix-smoke-runner-discovery-overflow：smoke runner 发现遍历（S19）。
 *
 * 覆盖 UT-S19-113～UT-S19-121、ST-S19-38～ST-S19-39（与 logos/resources/test/core-S19-test-cases.md
 * 「S19 smoke runner 发现遍历测试」对齐；规则见场景 core-S19-smoke-gate.md「runner 发现的遍历规则」「Gate 判定补充」、EX-19.25）。
 * 夹具 RD：一次性项目 P、项目外目录 X（含哨兵 runner）与 Y；目录链接 build → X、环形链接 loop → P。
 * 合成目录项只在内存中构造（可注入的目录读取），不在磁盘创建数十万个文件。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync,
  unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const counter = vi.hoisted(() => ({ checkSmokeCoverage: 0 }));
vi.mock('../src/lib/smoke-coverage.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/smoke-coverage.js')>();
  return {
    ...mod,
    checkSmokeCoverage: (...args: Parameters<typeof mod.checkSmokeCoverage>) => {
      counter.checkSmokeCoverage += 1;
      return mod.checkSmokeCoverage(...args);
    },
  };
});

import {
  checkSmokeCoverage, discoverSmokeRunners, extractChangedSmokeIds, type RunnerDirEntry, type RunnerWalkDeps,
} from '../src/lib/smoke-coverage.js';
import { collectVerifyData } from '../src/commands/verify.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const DISPATCHER = join(REPO_ROOT, 'scripts', 'run-smoke.js');
const SLUG = 'rd-demo';
const CASE = 'SMOKE-core-950';
const WIDE = 250_000;

let P: string;
let X: string;
let Y: string;
let cleanup: () => void;
const extraDirs: string[] = [];
const links: string[] = [];

beforeEach(() => {
  ({ root: P, cleanup } = makeTempRoot());
  X = mkdtempSync(join(tmpdir(), 'rd-x-'));
  Y = mkdtempSync(join(tmpdir(), 'rd-y-'));
  extraDirs.push(X, Y);
  counter.checkSmokeCoverage = 0;
});
afterEach(() => {
  // 先删链接再删目录，避免顺着链接删除项目外目录
  for (const l of links.splice(0)) { try { unlinkSync(l); } catch { /* 已删除 */ } }
  cleanup();
  for (const d of extraDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function put(root: string, rel: string, content = 'x\n'): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  symlinkSync(target, path);
  links.push(path);
}

/** 夹具 RD：仓内 runner、目录链接、环形链接、被忽略目录里的 runner；X 内放哨兵 runner（被执行时写 X/EXECUTED）。 */
function rd(opts: { inRepoRunner?: boolean } = {}): void {
  if (opts.inRepoRunner !== false) {
    put(P, 'scripts/smoke-a.js', [
      "const fs = require('fs');",
      "const out = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';",
      `fs.appendFileSync(out, JSON.stringify({ id: '${CASE}', status: 'pass', detail: 'in-repo runner' }) + '\\n');`,
      '',
    ].join('\n'));
  }
  put(X, 'scripts/smoke-linked.sh', `#!/usr/bin/env bash\necho executed > ${JSON.stringify(join(X, 'EXECUTED'))}\n`);
  put(X, 'runner.js', '// 项目外的普通文件\n');
  link(X, join(P, 'build'));
  link(P, join(P, 'loop'));
  put(P, 'node_modules/pkg/scripts/smoke-ignored.sh');
}
/** RD-case：活跃提案 rd-demo 在 deltas/test/smoke/ 下新增 SMOKE-core-950。 */
function rdCase(opts: { linked?: boolean; merged?: boolean } = {}): string {
  const dir = join(P, 'logos', 'changes', SLUG);
  mkdirSync(join(dir, 'deltas/test/smoke'), { recursive: true });
  put(P, 'logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: 'core' }));
  const table = `| ID | 描述 |\n|---|---|\n| ${CASE} | 夹具专用 |\n`;
  if (opts.linked) {
    put(Y, 'core-smoke-test-cases.md', table);
    link(Y, join(dir, 'deltas/test/smoke/linked'));
  } else {
    put(dir, 'deltas/test/smoke/core-smoke-test-cases.md', table);
  }
  if (opts.merged) put(P, 'logos/resources/test/smoke/core-smoke-test-cases.md', table);
  return dir;
}

/** 测试内保留的修复前实现（golden）：statSync 跟随链接、递归展开子树结果。 */
function legacyDiscover(root: string): string[] {
  const ignored = new Set(['.git', 'node_modules', 'dist', 'logos']);
  const walk = (dir: string): string[] => {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (!ignored.has(entry)) out.push(...walk(full)); continue; }
      if (st.isFile()) out.push(full);
    }
    return out;
  };
  return Array.from(new Set(walk(root)
    .map(f => relative(root, f).replace(/\\/g, '/'))
    .filter(f => f.split('/').includes('scripts'))
    .filter(f => /^smoke-.+\.(?:sh|js|mjs|cjs|ts)$/.test(f.split('/').pop() ?? '')))).sort();
}

const fileEntry = (name: string): RunnerDirEntry => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false });
const dirEntry = (name: string): RunnerDirEntry => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false });

/** 合成目录项：项目根只含真实子目录 scripts/，其枚举返回 249999 个不匹配的普通文件名加一个 smoke-wide.sh。 */
function wideDeps(root: string): RunnerWalkDeps {
  const scripts = join(root, 'scripts');
  const wide = Array.from({ length: WIDE - 1 }, (_, i) => fileEntry(`file-${i}.txt`));
  wide.push(fileEntry('smoke-wide.sh'));
  return {
    readDir: dir => (dir === root ? [dirEntry('scripts')] : dir === scripts ? wide : []),
    statTarget: () => { throw new Error('no links in synthetic tree'); },
  };
}
/** 用修复前的展开写法遍历同一组合成目录项。 */
function legacyWalkWithDeps(dir: string, deps: RunnerWalkDeps): string[] {
  const out: string[] = [];
  for (const entry of deps.readDir(dir)) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { out.push(...legacyWalkWithDeps(full, deps)); continue; }
    if (entry.isFile()) out.push(full);
  }
  return out;
}

describe('S19 smoke runner 发现遍历 — 单元测试', () => {
  it('UT-S19-113: 目录链接不进入', () => {
    rd();
    expect(discoverSmokeRunners(P)).toEqual(['scripts/smoke-a.js']);
  });

  it('UT-S19-114: 指向文件的 runner 链接照常发现', () => {
    rd();
    link(join(X, 'runner.js'), join(P, 'scripts/smoke-c.js'));
    link(join(X, 'missing-target.js'), join(P, 'scripts/smoke-d.js'));
    expect(discoverSmokeRunners(P)).toEqual(['scripts/smoke-a.js', 'scripts/smoke-c.js']);
  });

  it('UT-S19-115: 单个目录下文件数超过参数上限', () => {
    const deps = wideDeps(P);
    expect(discoverSmokeRunners(P, deps)).toEqual(['scripts/smoke-wide.sh']);
    // 对照：修复前的展开写法在把 scripts/ 子树并入父目录结果时溢出
    expect(() => legacyWalkWithDeps(P, deps)).toThrow(RangeError);
  });

  it('UT-S19-116: 读不了的子目录跳过', () => {
    rd();
    put(P, 'locked/scripts/smoke-hidden.sh');
    // 注入方式：locked/ 的枚举抛出 EACCES
    const real: RunnerWalkDeps = {
      readDir: dir => readdirSync(dir, { withFileTypes: true }),
      statTarget: p => statSync(p),
    };
    const injected: RunnerWalkDeps = {
      ...real,
      readDir: dir => {
        if (dir === join(P, 'locked')) throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        return real.readDir(dir);
      },
    };
    expect(discoverSmokeRunners(P, injected)).toEqual(['scripts/smoke-a.js']);
    // 真实权限方式（root 用户下权限不生效，只跑注入方式）
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (!isRoot) {
      chmodSync(join(P, 'locked'), 0o000);
      try {
        expect(discoverSmokeRunners(P)).toEqual(['scripts/smoke-a.js']);
        const check = checkSmokeCoverage(P, { command: 'node scripts/smoke-a.js' });
        expect(check.runners).toEqual(['scripts/smoke-a.js']);
        expect(check.diagnostics).toEqual([]);
      } finally {
        chmodSync(join(P, 'locked'), 0o755);
      }
    }
  });

  it('UT-S19-117: 不含链接的项目零回归', () => {
    put(P, 'scripts/smoke-a.js');
    put(P, 'apps/x/scripts/smoke-b.ts');
    put(P, 'node_modules/pkg/scripts/smoke-ignored.sh');
    put(P, 'dist/scripts/smoke-built.sh');
    put(P, 'tools/smoke-not-in-scripts.sh');
    const now = discoverSmokeRunners(P);
    expect(now).toEqual(['apps/x/scripts/smoke-b.ts', 'scripts/smoke-a.js']);
    expect(now).toEqual(legacyDiscover(P));
  });

  it('UT-S19-118: 提案用例读取保持既有行为', () => {
    rd();
    rdCase({ linked: true });
    expect(extractChangedSmokeIds(P, SLUG)).toContain(CASE);
    expect(discoverSmokeRunners(P)).not.toContain('build/scripts/smoke-linked.sh');
    expect(discoverSmokeRunners(P)).toEqual(['scripts/smoke-a.js']);
  });

  it('UT-S19-119: 默认 dispatcher 下零 runner 报 smoke_runner_missing', () => {
    rd({ inRepoRunner: false });
    const dir = rdCase();
    const dispatcher = { command: 'node scripts/run-smoke.js' };
    const main = checkSmokeCoverage(P, dispatcher);
    expect(main.runners).toEqual([]);
    expect(main.result).toBe('FAIL');
    const missing = main.diagnostics.find(d => d.code === 'smoke_runner_missing');
    expect(missing).toBeDefined();
    expect(missing?.case_ids).toEqual([CASE]);
    expect(missing?.runner_paths).toEqual([]);
    // 对照 ①：无新增用例 → PASS、无诊断
    rmSync(join(dir, 'deltas'), { recursive: true, force: true });
    const noCase = checkSmokeCoverage(P, dispatcher);
    expect(noCase.result).toBe('PASS');
    expect(noCase.diagnostics).toEqual([]);
    // 对照 ②：恢复新增用例、仓内有 runner、无结果文件 → 不报 runner_missing，按既有规则报 reporter_missing
    rdCase();
    put(P, 'scripts/smoke-a.js');
    const withRunner = checkSmokeCoverage(P, dispatcher);
    const codes = withRunner.diagnostics.map(d => d.code);
    expect(codes).not.toContain('smoke_runner_missing');
    expect(codes).toContain('smoke_reporter_missing');
  });

  it('UT-S19-120: 一次 verify 只扫描一次项目根', () => {
    scaffoldProject(P, { locale: 'en' });
    rd();
    rdCase();
    put(P, 'logos/resources/test/core-S01-test-cases.md', '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n');
    put(P, 'logos/resources/verify/test-results.jsonl', `${JSON.stringify({ id: 'UT-S01-01', status: 'pass' })}\n`);
    put(P, 'logos/resources/verify/smoke-results.jsonl', `${JSON.stringify({ id: CASE, status: 'pass' })}\n`);
    const cfgPath = join(P, 'logos/logos.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    cfg.smoke = { ...cfg.smoke, command: 'node scripts/smoke-a.js' };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    counter.checkSmokeCoverage = 0;
    const data = collectVerifyData(P, undefined, null, undefined, { deferReport: true });
    expect(counter.checkSmokeCoverage).toBe(1);
    const direct = checkSmokeCoverage(P, { command: 'node scripts/smoke-a.js', resultPath: 'logos/resources/verify/smoke-results.jsonl' });
    expect(data.smoke_precheck.runners).toEqual(direct.runners);
    expect(data.smoke_precheck.diagnostics).toEqual(direct.diagnostics);
    expect(data.smoke_precheck.result).toBe(direct.result);
    expect(data.smoke_precheck.runners).toEqual(['scripts/smoke-a.js']);

    // 变体：切片 checkpoint，SMOKE-core-950 属于 pending 切片且无结果文件 → 预检 FAIL，但 gate 不因 smoke 预检阻断
    rmSync(join(P, 'logos/resources/verify/smoke-results.jsonl'));
    const slice = (pending: string[]) => ({
      manifest_status: 'valid', verify_mode: 'slice-checkpoint', attempted_slice_id: 'slice-01',
      eligible_test_ids: ['UT-S01-01'], pending_test_ids: pending, manifest: null, checkpoint: null, test_change_set: null,
    }) as never;
    counter.checkSmokeCoverage = 0;
    const pendingData = collectVerifyData(P, undefined, slice([CASE]), undefined, { deferReport: true });
    expect(counter.checkSmokeCoverage).toBe(1);
    expect(pendingData.smoke_precheck.result).toBe('FAIL');
    expect(pendingData.gate.result).toBe('PASS');
    // 改为非 pending → gate FAIL，reason 为首个阻断诊断码
    counter.checkSmokeCoverage = 0;
    const blocked = collectVerifyData(P, undefined, slice([]), undefined, { deferReport: true });
    expect(counter.checkSmokeCoverage).toBe(1);
    expect(blocked.gate.result).toBe('FAIL');
    const firstBlocking = blocked.smoke_precheck.diagnostics.find(d => d.code !== 'smoke_cases_uncovered')?.code;
    expect(firstBlocking).toBeDefined();
    expect(blocked.gate.reason).toBe(firstBlocking);
  });

  it('UT-S19-121: dispatcher 遍历规则', async () => {
    rd();
    put(P, 'apps/x/scripts/smoke-b.ts');
    copyFileSync(DISPATCHER, join(P, 'scripts/run-smoke.js'));
    // 以模块方式导入：导入时不执行主流程（不会运行任何 runner）
    const mod = await import(pathToFileURL(DISPATCHER).href) as {
      discoverRunners: (root: string, deps?: RunnerWalkDeps) => string[];
    };
    expect(mod.discoverRunners(P)).toEqual(['scripts/smoke-a.js']);
    expect(existsSync(join(X, 'EXECUTED'))).toBe(false);
    // 宽目录臂：合成目录项下正常返回
    const wideRoot = join(P, 'wide-root');
    expect(mod.discoverRunners(wideRoot, wideDeps(wideRoot))).toEqual(['scripts/smoke-wide.sh']);
  });
});

/** 真实 CLI 子进程：独立环境，去掉宿主注入的 OpenLogos 变量。 */
function runCli(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('OPENLOGOS_SMOKE_') || key.startsWith('OPENLOGOS_VERIFY_')) delete env[key];
  }
  const r = spawnSync(process.execPath, [CLI_ENTRY, ...args], { cwd, env, encoding: 'utf-8', timeout: 120_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
function envelope(stdout: string): { data: Record<string, any> } {
  const line = stdout.split('\n').reverse().find(l => l.trim().startsWith('{'));
  expect(line, `stdout 应含 JSON 信封：${stdout.slice(0, 300)}`).toBeDefined();
  return JSON.parse(line as string);
}
function sandboxOff(): void {
  const cfgPath = join(P, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfg.verify = { ...cfg.verify, sandbox_mode: 'off' };
  cfg.smoke = { ...cfg.smoke, sandbox_mode: 'off', command: 'node scripts/run-smoke.js' };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

describe('S19 smoke runner 发现遍历 — 场景测试（真实 CLI）', () => {
  it('ST-S19-38: 含目录链接的项目中 verify 正常输出', { timeout: 120_000 }, () => {
    scaffoldProject(P, { locale: 'en' });
    sandboxOff();
    rd();
    rdCase();
    put(P, 'logos/resources/test/core-S01-test-cases.md', '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n');
    put(P, 'logos/resources/verify/test-results.jsonl', `${JSON.stringify({ id: 'UT-S01-01', status: 'pass' })}\n`);
    put(P, 'logos/resources/verify/smoke-results.jsonl', `${JSON.stringify({ id: CASE, status: 'pass' })}\n`);
    const r = runCli(['verify', '--format', 'json'], P);
    const env = envelope(r.stdout);
    const gate = env.data.gate.result as string;
    expect(r.status).toBe(gate === 'PASS' ? 0 : 1);
    const runners = env.data.smoke_precheck.runners as string[];
    expect(runners).toContain('scripts/smoke-a.js');
    expect(runners.some(p => p.startsWith('build/') || p.startsWith('loop/'))).toBe(false);
    expect(r.stderr).not.toContain('RangeError');
  });

  it('ST-S19-39: 默认 dispatcher 下 smoke 端到端', { timeout: 120_000 }, () => {
    scaffoldProject(P, { locale: 'en' });
    sandboxOff();
    rd();
    const dir = rdCase({ merged: true });
    copyFileSync(DISPATCHER, join(P, 'scripts/run-smoke.js'));
    writeFileSync(join(P, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      deployment_gates: { core: { deployment_required: true, smoke_required: true } },
    }, { lineWidth: 0 }));
    // smoke 前置：VERIFY_PASS、DEPLOY_DONE、[deploy] 全勾，声明需部署与 smoke
    writeFileSync(join(dir, 'proposal.md'), [
      '# 变更提案：fixture', '', '## 部署影响',
      '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：staging',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：是',
    ].join('\n'));
    writeFileSync(join(dir, 'tasks.md'), ['# 实现任务', '', '## [deploy] 部署任务', '- [x] 部署到 staging'].join('\n'));
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    writeFileSync(join(dir, 'DEPLOY_DONE'), '');

    const r = runCli(['smoke', '--format', 'json'], P);
    const env = envelope(r.stdout);
    expect(r.status, r.stderr.slice(0, 500)).toBe(0);
    expect(env.data.gate.result).toBe('PASS');
    const runners = env.data.runners as string[];
    expect(runners).toContain('scripts/smoke-a.js');
    expect(runners.some(p => p.startsWith('build/') || p.startsWith('loop/'))).toBe(false);
    const rows = readFileSync(join(P, 'logos/resources/verify/smoke-results.jsonl'), 'utf-8')
      .split('\n').filter(Boolean).map(l => JSON.parse(l) as { id: string; status: string; detail?: string });
    expect(rows.some(row => row.id === CASE && row.status === 'pass' && row.detail === 'in-repo runner')).toBe(true);
    expect(existsSync(join(X, 'EXECUTED'))).toBe(false);
  });
});
