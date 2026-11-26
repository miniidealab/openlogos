/**
 * fix-smoke-runner-discovery-overflow：smoke runner 发现遍历（S19）。
 *
 * 覆盖 UT-S19-113～UT-S19-121、ST-S19-38～ST-S19-39（与 logos/resources/test/core-S19-test-cases.md
 * 「S19 smoke runner 发现遍历测试」对齐；规则见场景 core-S19-smoke-gate.md「runner 发现的遍历规则」「Gate 判定补充」、EX-19.25）。
 * 夹具 RD：一次性项目 P、项目外目录 X（含哨兵 runner）与 Y；目录链接 build → X、环形链接 loop → P。
 * 合成目录项只在内存中构造（可注入的目录读取），不在磁盘创建数十万个文件。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 *
 * fix-smoke-runner-discovery-review-gaps：UT-S19-122～UT-S19-126（「S19 安装态 runner 证据判定测试」）以模块方式导入
 * scripts/smoke-runner-discovery.js 的判定函数（导入时不执行主流程）；夹具 RG 只用 mktemp 临时目录，仓库替身 R 不是本仓。
 * ST-S19-38～39 对 stdout.trim() 整体 JSON.parse，与 UT-S19-122 同一规则。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as nodeFs from 'node:fs';
import {
  chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync,
  statSync, symlinkSync, unlinkSync, writeFileSync,
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
import { buildAssetManifest, validateAssetManifest, type AssetManifest } from '../src/lib/asset-manifest.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const DISPATCHER = join(REPO_ROOT, 'scripts', 'run-smoke.js');
const EVIDENCE_RUNNER = join(REPO_ROOT, 'scripts', 'smoke-runner-discovery.js');
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
/**
 * stdout 整体解析为 JSON 信封，并核对命令身份：直接复用 runner 导出的 parseEnvelope（与 UT-S19-122 同一规则），
 * 混入非 JSON 文本、command 缺失或不符、缺 version / timestamp / data 均失败。
 */
async function envelope(stdout: string, command: 'verify' | 'smoke'): Promise<{ data: Record<string, any> }> {
  const { parseEnvelope } = await import(pathToFileURL(join(REPO_ROOT, 'scripts', 'smoke-runner-discovery.js')).href) as {
    parseEnvelope: (stdout: string, expectedCommand: string) => { data: Record<string, any> };
  };
  return parseEnvelope(stdout, command);
}
function sandboxOff(): void {
  const cfgPath = join(P, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfg.verify = { ...cfg.verify, sandbox_mode: 'off' };
  cfg.smoke = { ...cfg.smoke, sandbox_mode: 'off', command: 'node scripts/run-smoke.js' };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

describe('S19 smoke runner 发现遍历 — 场景测试（真实 CLI）', () => {
  it('ST-S19-38: 含目录链接的项目中 verify 正常输出', { timeout: 120_000 }, async () => {
    scaffoldProject(P, { locale: 'en' });
    sandboxOff();
    rd();
    rdCase();
    put(P, 'logos/resources/test/core-S01-test-cases.md', '| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n');
    put(P, 'logos/resources/verify/test-results.jsonl', `${JSON.stringify({ id: 'UT-S01-01', status: 'pass' })}\n`);
    put(P, 'logos/resources/verify/smoke-results.jsonl', `${JSON.stringify({ id: CASE, status: 'pass' })}\n`);
    const r = runCli(['verify', '--format', 'json'], P);
    const env = await envelope(r.stdout, 'verify');
    const gate = env.data.gate.result as string;
    expect(r.status).toBe(gate === 'PASS' ? 0 : 1);
    const runners = env.data.smoke_precheck.runners as string[];
    expect(runners).toContain('scripts/smoke-a.js');
    expect(runners.some(p => p.startsWith('build/') || p.startsWith('loop/'))).toBe(false);
    expect(r.stderr).not.toContain('RangeError');
  });

  it('ST-S19-39: 默认 dispatcher 下 smoke 端到端', { timeout: 120_000 }, async () => {
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
    const env = await envelope(r.stdout, 'smoke');
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

// ───────────── fix-smoke-runner-discovery-review-gaps：安装态 runner 证据判定（UT-S19-122～126） ─────────────

type FsOps = typeof nodeFs;
interface Ledger { path: string; write: (text: string) => void; close: () => void }
interface EvidenceRunner {
  parseEnvelope: (stdout: string, expectedCommand: string, label?: string) => Record<string, any>;
  receiptEntryProblem: (receipt: Record<string, unknown> | null, entryRealpath: string) => string | null;
  installedVersionProblem: (installedVersion: string, receipt: Record<string, unknown> | null) => string | null;
  candidateVersion: (root?: string) => string | null;
  deployedCandidate: (root?: string, readVersion?: () => string | null) => { missing?: string; problem?: string; receipt?: Record<string, any> };
  writeAll: (fsOps: FsOps, fd: number, text: string) => void;
  openSelfTestLedger: (root: string, ledgerPath: string, formalPath: string, fsOps?: FsOps) => Ledger;
  assetManifestVerdict: (
    validate: (manifest: AssetManifest, pkg: string) => void, manifest: AssetManifest, pkg: string, opts?: { selfTest?: boolean },
  ) => { ok: boolean; detail?: string; problem?: string; evidence: string[] };
}
const loadEvidenceRunner = async (): Promise<EvidenceRunner> =>
  await import(pathToFileURL(EVIDENCE_RUNNER).href) as EvidenceRunner;

const ORIGINAL_SLUG = 'fix-smoke-runner-discovery-overflow';
const FORMAL_LEDGER = 'logos/resources/verify/smoke-results.jsonl';
const MISMATCH = /信封通道 \/ 形态不匹配/;

/** 夹具 RG：仓库替身 R（含已有正式账本）与仓外目录 O，均为 mktemp 临时目录、互不包含；路径取 realpath。 */
function rg(): { R: string; O: string } {
  const R = realpathSync(mkdtempSync(join(tmpdir(), 'rg-r-')));
  const O = realpathSync(mkdtempSync(join(tmpdir(), 'rg-o-')));
  extraDirs.push(R, O);
  put(R, FORMAL_LEDGER, 'existing-formal-ledger-row\n');
  return { R, O };
}
function listTree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      out.push(relative(root, full));
      if (e.isDirectory()) walk(full);
    }
  };
  walk(root);
  return out.sort();
}

describe('S19 安装态 runner 证据判定 — 单元测试（fix-smoke-runner-discovery-review-gaps）', () => {
  it('UT-S19-122: stdout 整体解析为 JSON 信封', async () => {
    const mod = await loadEvidenceRunner();
    const env = { command: 'verify', version: '0.0.1', timestamp: '2026-01-01T00:00:00.000Z', data: { gate: { result: 'PASS' } } };
    const text = JSON.stringify(env);
    // (a) 完整 verify 信封（前后空白）→ 返回信封
    expect(mod.parseEnvelope(`\n  ${text}  \n`, 'verify')).toEqual(env);
    const { command: _omit, ...noCommand } = env;
    const bad: Array<[string, string]> = [
      ['(b) 信封前混入普通文本', `note: running verify\n${text}`],
      ['(c) 信封后混入普通文本', `${text}\ndone.`],
      ['(d) 只有中间一行是信封', `line 1\n${text}\nline 3`],
      ['(e) 空 stdout', ''],
      ['(f) 合法 JSON 但缺 command', JSON.stringify(noCommand)],
      ['(g) 合法 JSON 但 command 不符', JSON.stringify({ ...env, command: 'smoke' })],
    ];
    for (const [label, stdout] of bad) {
      expect(() => mod.parseEnvelope(stdout, 'verify'), label).toThrow(MISMATCH);
    }
  });

  it('UT-S19-123: 回执 entry_realpath 与实际入口 realpath 原值比较', async () => {
    const mod = await loadEvidenceRunner();
    const { O } = rg();
    put(O, 'entry/index.js', '// entry\n');
    put(O, 'other/index.js', '// other\n');
    const E = realpathSync(join(O, 'entry/index.js'));
    const alias = join(O, 'alias', 'index.js');
    link(E, alias);
    expect(alias).not.toBe(E);
    expect(realpathSync(alias)).toBe(E);
    const failing: Array<[string, Record<string, unknown>]> = [
      ['(a) 缺字段', {}],
      ['(b) 空字符串', { entry_realpath: '' }],
      ['(c) 相对路径', { entry_realpath: 'entry/index.js' }],
      ['(d) 另一个文件', { entry_realpath: realpathSync(join(O, 'other/index.js')) }],
      ['(e) 同一文件的绝对别名', { entry_realpath: alias }],
    ];
    for (const [label, receipt] of failing) {
      const problem = mod.receiptEntryProblem(receipt, E);
      expect(problem, label).toBeTruthy();
      expect(problem, label).toContain(E);
      expect(problem, label).toContain(JSON.stringify(receipt.entry_realpath ?? null));
    }
    // (f) 原值恰为实际入口 realpath → 无问题
    expect(mod.receiptEntryProblem({ entry_realpath: E }, E)).toBeNull();
  });

  it('UT-S19-124: 部署前置先查账本，版本按三方关系式判定', async () => {
    const mod = await loadEvidenceRunner();
    const { R } = rg();
    const LEDGER = join(R, 'logos/.openlogos-runtime/deployments.jsonl');
    const RECEIPT = join(R, 'logos/.openlogos-runtime/local-install/last-deploy.json');
    const deploy = (slug: string, id: string) => ({ kind: 'deploy', slug, environment: 'test', result: 'done', deploy_id: id });
    const receiptOf = (id: string, version: string) => ({ deploy_id: id, result: 'done', environment: 'test', candidate_version: version });
    const setSource = (version: string | null) => {
      const src = join(R, 'cli/src/lib/local-release-candidate.ts');
      if (version === null) rmSync(src, { force: true });
      else put(R, 'cli/src/lib/local-release-candidate.ts', `export const LOCAL_RELEASE_CANDIDATE_VERSION = '${version}';\n`);
    };

    // (a) 账本只有其他提案的成功部署与回执 → skip（缺部署记录），不采用其他提案的回执
    put(R, 'logos/.openlogos-runtime/deployments.jsonl', `${JSON.stringify(deploy('fix-smoke-runner-discovery-review-gaps', 'other-1'))}\n`);
    put(R, 'logos/.openlogos-runtime/local-install/last-deploy.json', JSON.stringify(receiptOf('other-1', '0.0.1')));
    setSource(null);
    let reads = 0;
    const a = mod.deployedCandidate(R, () => { reads += 1; throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }); });
    expect(a.missing).toContain(ORIGINAL_SLUG);
    expect(a.problem).toBeUndefined();
    expect(a.receipt).toBeUndefined();
    expect(reads, '无匹配部署时不读取源码版本').toBe(0);
    expect(mod.deployedCandidate(R).missing).toContain(ORIGINAL_SLUG);

    // 以下分支：原提案在 test 的成功部署与回执同一 deploy_id
    writeFileSync(LEDGER, [deploy('fix-smoke-runner-discovery-review-gaps', 'other-1'), deploy(ORIGINAL_SLUG, 'orig-1')].map(r => JSON.stringify(r)).join('\n') + '\n');
    writeFileSync(RECEIPT, JSON.stringify({ ...receiptOf('orig-1', '0.0.1'), entry_realpath: '/abs/entry.js' }));

    // (b) 源码候选版本读不到 → fail：文件缺失（读到空值）与读取抛错（EACCES，保留原因）两种形态
    setSource(null);
    const b = mod.deployedCandidate(R);
    expect(b.missing).toBeUndefined();
    expect(b.problem).toMatch(/源码候选版本不可读/);
    let readsB = 0;
    const bThrow = mod.deployedCandidate(R, () => { readsB += 1; throw Object.assign(new Error('EACCES: permission denied, open local-release-candidate.ts'), { code: 'EACCES' }); });
    expect(readsB).toBe(1);
    expect(bThrow.missing).toBeUndefined();
    expect(bThrow.problem).toMatch(/源码候选版本不可读.*EACCES/);

    // (c) 源码版本回退且与回执不同 → fail
    setSource('0.0.0');
    const c = mod.deployedCandidate(R);
    expect(c.problem).toMatch(/candidate_version=0\.0\.1，源码候选版本=0\.0\.0/);

    // (d) 源码、回执、安装三方都取合成低版本 0.0.1 → 通过（不残留任何固定版本下限）
    setSource('0.0.1');
    const d = mod.deployedCandidate(R);
    expect(d.missing).toBeUndefined();
    expect(d.problem).toBeUndefined();
    expect(d.receipt?.deploy_id).toBe('orig-1');
    expect(mod.installedVersionProblem('0.0.1', d.receipt ?? null)).toBeNull();

    // (e) 源码与回执相等，但安装态 --version 不同 → fail
    expect(mod.installedVersionProblem('0.0.2', d.receipt ?? null)).toMatch(/--version 为 0\.0\.2/);
  });

  it('UT-S19-125: 自测结果只写入仓外独立账本', async () => {
    const mod = await loadEvidenceRunner();
    const { R, O } = rg();
    const formal = join(R, FORMAL_LEDGER);
    const formalBytes = readFileSync(formal);
    const treeBefore = listTree(R);
    const row = (id: string) => `${JSON.stringify({ id, status: 'pass' })}\n`;

    // (a) 仓外新文件 → 接受，经描述符写入
    const a = mod.openSelfTestLedger(R, join(O, 'new.jsonl'), FORMAL_LEDGER);
    a.write(row('SMOKE-core-336'));
    a.close();
    expect(readFileSync(join(O, 'new.jsonl'), 'utf-8')).toBe(row('SMOKE-core-336'));

    // (b) 仓外已有独立文件（预置前缀）→ 接受；同一次打开期间写两条，全部经同一个已检查的描述符
    put(O, 'existing.jsonl', 'prefix-line\n');
    const calls: string[] = [];
    let openedFd = -1;
    const recording = {
      ...nodeFs,
      openSync: ((...args: Parameters<typeof nodeFs.openSync>) => {
        const fd = nodeFs.openSync(...args);
        calls.push(`open:${String(args[0])}`);
        openedFd = fd;
        return fd;
      }) as typeof nodeFs.openSync,
      fstatSync: ((fd: number, ...rest: unknown[]) => { calls.push(`fstat:${fd}`); return (nodeFs.fstatSync as any)(fd, ...rest); }) as typeof nodeFs.fstatSync,
      writeSync: ((fd: number, ...rest: unknown[]) => { calls.push(`write:${fd}`); return (nodeFs.writeSync as any)(fd, ...rest); }) as typeof nodeFs.writeSync,
      appendFileSync: (() => { calls.push('appendFileSync'); throw new Error('不得按路径追加'); }) as typeof nodeFs.appendFileSync,
      writeFileSync: (() => { calls.push('writeFileSync'); throw new Error('不得按路径写入'); }) as typeof nodeFs.writeFileSync,
    } as FsOps;
    const b = mod.openSelfTestLedger(R, join(O, 'existing.jsonl'), FORMAL_LEDGER, recording);
    b.write(row('SMOKE-core-336'));
    b.write(row('SMOKE-core-337'));
    b.close();
    expect(calls.filter(c => c.startsWith('open:'))).toEqual([`open:${join(O, 'existing.jsonl')}`]);
    expect(calls).toEqual([`open:${join(O, 'existing.jsonl')}`, `fstat:${openedFd}`, `write:${openedFd}`, `write:${openedFd}`]);
    expect(readFileSync(join(O, 'existing.jsonl'), 'utf-8')).toBe(`prefix-line\n${row('SMOKE-core-336')}${row('SMOKE-core-337')}`);

    // 短写：首次 writeSync 只写 1 字节，仍经同一描述符按偏移补写完整两行
    put(O, 'short.jsonl', 'prefix-line\n');
    const shortCalls: number[] = [];
    let first = true;
    const shortWrites = {
      ...nodeFs,
      writeSync: ((fd: number, buf: Buffer, offset: number, length: number) => {
        shortCalls.push(fd);
        const n = nodeFs.writeSync(fd, buf, offset, first ? 1 : length);
        first = false;
        return n;
      }) as typeof nodeFs.writeSync,
    } as FsOps;
    const sh = mod.openSelfTestLedger(R, join(O, 'short.jsonl'), FORMAL_LEDGER, shortWrites);
    sh.write(row('SMOKE-core-336'));
    sh.write(row('SMOKE-core-337'));
    sh.close();
    expect(readFileSync(join(O, 'short.jsonl'), 'utf-8')).toBe(`prefix-line\n${row('SMOKE-core-336')}${row('SMOKE-core-337')}`);
    expect(shortCalls.length).toBe(3);
    expect(new Set(shortCalls).size).toBe(1);
    // 写入量为 0 → 报错，不静默留下半行
    const zero = { ...nodeFs, writeSync: (() => 0) as unknown as typeof nodeFs.writeSync } as FsOps;
    const z = mod.openSelfTestLedger(R, join(O, 'zero.jsonl'), FORMAL_LEDGER, zero);
    expect(() => z.write(row('SMOKE-core-336'))).toThrow(/写入量为 0/);
    z.close();

    // 正式账本经目录别名配置、真实位置在仓外：自测指向其真实位置 → 拒绝，原账本字节不变
    put(O, 'shared/smoke-results.jsonl', 'aliased-formal-row\n');
    link(join(O, 'shared'), join(R, 'ext-ledger'));
    const aliasedBytes = readFileSync(join(O, 'shared/smoke-results.jsonl'));
    expect(() => mod.openSelfTestLedger(R, join(O, 'shared/smoke-results.jsonl'), 'ext-ledger/smoke-results.jsonl')).toThrow(/正式 smoke 账本/);
    expect(readFileSync(join(O, 'shared/smoke-results.jsonl')).equals(aliasedBytes)).toBe(true);
    // 仅父目录存在（正式账本文件尚未创建）时同样按真实位置比较
    expect(() => mod.openSelfTestLedger(R, join(O, 'shared/not-yet.jsonl'), 'ext-ledger/not-yet.jsonl')).toThrow(/正式 smoke 账本/);
    expect(existsSync(join(O, 'shared/not-yet.jsonl'))).toBe(false);
    unlinkSync(join(R, 'ext-ledger'));
    links.splice(links.indexOf(join(R, 'ext-ledger')), 1);

    // 正式账本文件名本身是悬空符号链接、其仓外目标尚未创建：创建自测文件前拒绝，目标仍不存在
    const danglingFormal = 'logos/resources/verify/dangling-formal.jsonl';
    link(join(O, 'formal-target.jsonl'), join(R, danglingFormal));
    expect(() => mod.openSelfTestLedger(R, join(O, 'formal-target.jsonl'), danglingFormal)).toThrow(/无法解析的符号链接/);
    expect(existsSync(join(O, 'formal-target.jsonl'))).toBe(false);
    unlinkSync(join(R, danglingFormal));
    links.splice(links.indexOf(join(R, danglingFormal)), 1);
    // 文件身份相同、路径文本不同、链接数为 1（如大小写不敏感卷上的大小写别名）：首次写入前拒绝，正式账本字节不变
    put(O, 'case-formal/smoke-results.jsonl', 'case-formal-row\n');
    link(join(O, 'case-formal'), join(R, 'case-ledger'));
    const caseBytes = readFileSync(join(O, 'case-formal/smoke-results.jsonl'));
    put(O, 'case-alias.jsonl', '');
    const aliasStat = (target: string) => ({
      ...nodeFs,
      // 模拟同一文件的另一种拼写：正式账本的 stat 报告与自测目标相同的 dev/ino
      statSync: ((p: nodeFs.PathLike, ...rest: unknown[]) => {
        if (String(p) === realpathSync(join(O, 'case-formal/smoke-results.jsonl'))) return nodeFs.statSync(target);
        return (nodeFs.statSync as any)(p, ...rest);
      }) as typeof nodeFs.statSync,
    } as FsOps);
    const writesBefore = readFileSync(join(O, 'case-alias.jsonl'));
    expect(() => mod.openSelfTestLedger(R, join(O, 'case-alias.jsonl'), 'case-ledger/smoke-results.jsonl', aliasStat(join(O, 'case-alias.jsonl'))))
      .toThrow(/是同一文件/);
    expect(readFileSync(join(O, 'case-alias.jsonl')).equals(writesBefore)).toBe(true);
    expect(readFileSync(join(O, 'case-formal/smoke-results.jsonl')).equals(caseBytes)).toBe(true);
    // 自测先独占创建目标、随后识别为与正式账本同一文件；正式写入方恰在身份核对时向同一文件追加结果：
    // 拒绝后不删除任何文件（unlink 调用为零），正式路径仍可读到完整的正式结果，自测未写入任何字节
    const newTarget = join(O, 'case-new.jsonl');
    const newUnlinks: string[] = [];
    const formalRow = 'formal-row-appended-during-check\n';
    const appendDuringCheck = {
      ...aliasStat(newTarget),
      statSync: ((p: nodeFs.PathLike, ...rest: unknown[]) => {
        if (String(p) === realpathSync(join(O, 'case-formal/smoke-results.jsonl'))) {
          nodeFs.appendFileSync(newTarget, formalRow);  // 模拟正式进程经同一文件追加
          return nodeFs.statSync(newTarget);
        }
        return (nodeFs.statSync as any)(p, ...rest);
      }) as typeof nodeFs.statSync,
      unlinkSync: ((p: nodeFs.PathLike) => { newUnlinks.push(String(p)); nodeFs.unlinkSync(p); }) as typeof nodeFs.unlinkSync,
    } as FsOps;
    expect(existsSync(newTarget)).toBe(false);
    expect(() => mod.openSelfTestLedger(R, newTarget, 'case-ledger/smoke-results.jsonl', appendDuringCheck)).toThrow(/是同一文件/);
    expect(newUnlinks).toEqual([]);
    expect(readFileSync(newTarget, 'utf-8')).toBe(formalRow);
    // 并发创建：检查时 lstat 报告目标不存在，但打开前已由另一写入方（正式进程）创建并写入结果行 →
    // 独占创建得到 EEXIST、转入已有文件分支；拒绝后不得删除该文件，已写入字节完整
    put(O, 'case-race.jsonl', 'formal-row-written-concurrently\n');
    const raceBytes = readFileSync(join(O, 'case-race.jsonl'));
    const raceTarget = join(O, 'case-race.jsonl');
    const unlinks: string[] = [];
    let lstatCalls = 0;
    const race = {
      ...aliasStat(raceTarget),
      lstatSync: ((p: nodeFs.PathLike, ...rest: unknown[]) => {
        lstatCalls += 1;
        if (String(p) === raceTarget && lstatCalls === 1) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return (nodeFs.lstatSync as any)(p, ...rest);
      }) as typeof nodeFs.lstatSync,
      unlinkSync: ((p: nodeFs.PathLike) => { unlinks.push(String(p)); nodeFs.unlinkSync(p); }) as typeof nodeFs.unlinkSync,
    } as FsOps;
    expect(() => mod.openSelfTestLedger(R, raceTarget, 'case-ledger/smoke-results.jsonl', race)).toThrow(/是同一文件/);
    expect(unlinks).toEqual([]);
    expect(existsSync(raceTarget)).toBe(true);
    expect(readFileSync(raceTarget).equals(raceBytes)).toBe(true);
    // 真实大小写不敏感卷（如 macOS 默认 APFS）上再用真实大小写别名验证一次；大小写敏感卷上该别名不存在，跳过
    const upper = join(O, 'CASE-FORMAL', 'SMOKE-RESULTS.JSONL');
    if (existsSync(upper)) {
      expect(() => mod.openSelfTestLedger(R, upper, 'case-ledger/smoke-results.jsonl')).toThrow(/是同一文件/);
      expect(readFileSync(join(O, 'case-formal/smoke-results.jsonl')).equals(caseBytes)).toBe(true);
    }
    unlinkSync(join(R, 'case-ledger'));
    links.splice(links.indexOf(join(R, 'case-ledger')), 1);

    // 正例保留：正式账本为普通文件时，仓外独立新文件仍被接受
    const fresh = mod.openSelfTestLedger(R, join(O, 'fresh.jsonl'), FORMAL_LEDGER);
    fresh.write(row('SMOKE-core-336'));
    fresh.close();
    expect(readFileSync(join(O, 'fresh.jsonl'), 'utf-8')).toBe(row('SMOKE-core-336'));

    // 拒绝分支：任何写入前拒绝；仓内文件清单与已有账本字节不变
    link(join(R, 'new-target.jsonl'), join(O, 'dangling.jsonl'));
    link(join(O, 'existing.jsonl'), join(O, 'link.jsonl'));
    linkSync(formal, join(O, 'hard.jsonl'));
    const rejected: Array<[string, string, RegExp]> = [
      ['(c) 仓库根下的 ..results.jsonl', join(R, '..results.jsonl'), /位于仓库/],
      ['(d) 指向仓内的悬空符号链接', join(O, 'dangling.jsonl'), /符号链接/],
      ['(e) 指向仓外文件的符号链接', join(O, 'link.jsonl'), /符号链接/],
      ['(f) 与仓内账本共享同一文件的硬链接', join(O, 'hard.jsonl'), /nlink=2/],
      ['(g) 父目录不存在', join(O, 'missing', 'x.jsonl'), /真实父目录/],
    ];
    for (const [label, path, why] of rejected) {
      expect(() => mod.openSelfTestLedger(R, path, FORMAL_LEDGER), label).toThrow(why);
      expect(listTree(R), label).toEqual(treeBefore);
      expect(readFileSync(formal).equals(formalBytes), label).toBe(true);
    }
    expect(existsSync(join(R, 'new-target.jsonl'))).toBe(false);
    expect(existsSync(join(R, '..results.jsonl'))).toBe(false);
    expect(existsSync(join(O, 'missing'))).toBe(false);
  });

  it('UT-S19-126: 制品校验异常一律判 fail', async () => {
    const mod = await loadEvidenceRunner();
    const { O } = rg();
    const pkg = join(O, 'pkg');
    put(pkg, 'templates/a.md', 'alpha\n');
    put(pkg, 'templates/b.md', 'beta\n');
    put(O, 'evil.md', 'outside\n');
    const build = (paths: Array<[string, string]>) => buildAssetManifest('0.0.1', '1', paths.map(([path, src]) => ({ group: 'templates', path, sourcePath: src })));
    const good = build([['templates/a.md', join(pkg, 'templates/a.md')], ['templates/b.md', join(pkg, 'templates/b.md')]]);
    const modes = [true, false];

    // (a) 资源齐全、payloadHash 正确 → 两种模式均通过
    for (const selfTest of modes) {
      const v = mod.assetManifestVerdict(validateAssetManifest, good, pkg, { selfTest });
      expect(v.ok).toBe(true);
      expect(v.detail).toBe('payloadHash 自洽');
    }
    const expectFail = (label: string, manifest: AssetManifest, pattern: RegExp) => {
      for (const selfTest of modes) {
        const v = mod.assetManifestVerdict(validateAssetManifest, manifest, pkg, { selfTest });
        expect(v.ok, `${label} selfTest=${selfTest}`).toBe(false);
        expect(v.problem, `${label} selfTest=${selfTest}`).toMatch(pattern);
        expect(v.problem ?? '', `${label} selfTest=${selfTest}`).not.toContain('payloadHash 自洽');
        expect(v.detail).toBeUndefined();
      }
    };
    // (b) payloadHash 被篡改
    expectFail('(b)', { ...good, payloadHash: '0'.repeat(64) }, /payload hash 不匹配/);
    // (d) 非法路径（payloadHash 自洽，校验走到路径检查）
    expectFail('(d)', build([['../evil.md', join(O, 'evil.md')]]), /asset path 非法/);
    // (e) 只改一个已存在资源的内容，清单与其余资源完整 → 指向该资源
    writeFileSync(join(pkg, 'templates/b.md'), 'beta-tampered\n');
    expectFail('(e)', good, /asset hash 不匹配：templates\/b\.md/);
    // (c) 前一项资源缺失、后一项存在但摘要不同 → 不因「开发布局缺文件」放行
    rmSync(join(pkg, 'templates/a.md'));
    expectFail('(c)', good, /asset hash 不匹配：templates\/a\.md .*actual=missing/);
  });
});
