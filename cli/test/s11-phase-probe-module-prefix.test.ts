/**
 * S11 — SessionStart phase 探测的模块前缀命名兼容与模式字面量化
 * （fix-merge-prototype-commit-and-phase-module-prefix，切片 2）。
 * 覆盖 UT-S11-82～UT-S11-85、ST-S11-47（与 logos/resources/test/core-S11-test-cases.md 严格对齐）。
 *
 * 被测对象是**源模板** `plugin/bin/openlogos-phase` 的 `check_scenarios_complete()`，
 * 不测 `.claude/openlogos/bin/` 的 sync 部署副本。两个叠加缺陷：
 *  ① `for pat in $ext_pattern` 的未加引用展开同时触发**文件名展开** —— 脚本在项目根执行时
 *     `*.md` 先变成 README.md / AGENTS.md / CLAUDE.md，拼出 `-name S01-README.md`；
 *  ② 拼出的 glob 漏模块前缀 —— `S01-*.md` 命中不了规范命名的 `core-S01-….md`。
 * 缺一不可修：不做 ①，再正确的前缀 glob 也不会被执行到。
 *
 * 跨实现一致性**只在恒等域上断言**（D1：同口径的独立实现，不是调用唯一实现）——
 * 目标目录内全部为 `<module>-SXX-*` 规范命名、单模块，且仅限 CLI 侧确有 per-scenario 判定的
 * `phase.3-1` 与 `phase.3-4a`。无前缀历史命名、其它模块同号文件、`-test-cases` 后缀宽严差异、
 * API 调用点（CLI 侧 `SCENARIO_PHASES` 无对应判定）均为场景 S11「已知差异清单」中的具名差异。
 *
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHASE_HOOK = join(REPO_ROOT, 'plugin', 'bin', 'openlogos-phase');
const CLI_ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const SCENARIOS = ['S01', 'S02', 'S03', 'S04'] as const;

type Naming = 'prefixed' | 'bare';

interface ProjectOpts {
  /** 命名形态：`core-SXX-*`（规范）或 `SXX-*`（无前缀历史）。 */
  naming?: Naming;
  /** 各调用点要**故意缺失**的场景 ID。 */
  missing?: { scenario?: string[]; api?: string[]; test?: string[] };
  /** 是否在项目根放置 README.md / AGENTS.md / CLAUDE.md 与根级 *.yaml（真实项目常态噪声）。 */
  rootNoise?: boolean;
  /** 额外投放到场景目录的干扰文件（相对该目录的文件名）。 */
  scenarioExtras?: string[];
}

/** 一次性隔离项目：initial 模块 + 四个已声明场景 + 三个调用点目录全覆盖（可按需挖空）。 */
function project(opts: ProjectOpts = {}) {
  const naming: Naming = opts.naming ?? 'prefixed';
  const missing = opts.missing ?? {};
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });

  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:',
    '  name: "phase-probe"',
    '  description: ""',
    'modules:',
    '  - id: core',
    '    name: core',
    '    lifecycle: initial',
    'scenarios:',
    ...SCENARIOS.flatMap(id => [`  - id: ${id}`, `    name: 场景 ${id}`, '    module: core']),
    '',
  ].join('\n'));

  // 前序 phase 必须有文件，探测链才能走到 3-1 / 3-2 / 3-3a 三个调用点
  const seed = (rel: string, name: string, body = 'x\n') => {
    mkdirSync(join(root, rel), { recursive: true });
    writeFileSync(join(root, rel, name), body);
  };
  seed('logos/resources/prd/1-product-requirements', 'core-01-requirements.md');
  seed('logos/resources/prd/2-product-design', 'core-02-design.md');
  seed('logos/resources/prd/3-technical-plan/1-architecture', 'core-03-architecture.md');
  seed('logos/resources/database', 'core-schema.sql');

  const pre = naming === 'prefixed' ? 'core-' : '';
  for (const id of SCENARIOS) {
    if (!(missing.scenario ?? []).includes(id)) {
      seed('logos/resources/prd/3-technical-plan/2-scenario-implementation', `${pre}${id}-flow.md`);
    }
    if (!(missing.api ?? []).includes(id)) {
      seed('logos/resources/api', `${pre}${id}-api.yaml`);
    }
    if (!(missing.test ?? []).includes(id)) {
      seed('logos/resources/test', `${pre}${id}-test-cases.md`);
    }
  }
  for (const extra of opts.scenarioExtras ?? []) {
    seed('logos/resources/prd/3-technical-plan/2-scenario-implementation', extra);
  }

  if (opts.rootNoise !== false) {
    // 真实项目常态：根目录有 Markdown 与 YAML —— 未加引用的 `*.md` / `*.yaml *.yml` 展开即命中它们
    for (const f of ['README.md', 'AGENTS.md', 'CLAUDE.md']) writeFileSync(join(root, f), '# noise\n');
    writeFileSync(join(root, 'noise.yaml'), 'a: 1\n');
    writeFileSync(join(root, 'noise.yml'), 'a: 1\n');
  }
  return { root };
}

/** 跑源模板（--plain），返回文本。`extraPath` 为空则 PATH 中不含 openlogos。 */
function runProbe(root: string, opts: { path?: string } = {}): string {
  return execFileSync('bash', [PHASE_HOOK, '--plain'], {
    cwd: root,
    env: { ...process.env, PATH: opts.path ?? '/usr/bin:/bin:/usr/sbin:/sbin' },
    encoding: 'utf-8',
  });
}

/** 从 phase 文本中解析 missing 集合（无 `missing` 字样 ⇒ 空集）。 */
function probeMissing(text: string): string[] {
  const m = text.match(/incomplete: missing([^)]*)\)/);
  return m ? m[1].trim().split(/\s+/).filter(Boolean) : [];
}

/** 直接 source 源模板并单独调用 `check_scenarios_complete`，逐调用点取 missing 与实际 find 参数。 */
function callCheck(root: string, dir: string, extPattern: string, opts: { trace?: boolean } = {}) {
  const script = [
    'set +e',
    // 只 source 函数定义段：源模板从 `CONFIG=` 起是顶层执行体（会自行输出并 exit），
    // 故截取 `get_scenario_ids()` 到 `CONFIG=` 之前（其间恰为两个待测函数定义）。
    `eval "$(awk '/^get_scenario_ids\\(\\)/{f=1} /^CONFIG=/{f=0} f' ${JSON.stringify(PHASE_HOOK)})"`,
    opts.trace ? 'set -x' : '',
    `out=$(check_scenarios_complete ${JSON.stringify(dir)} ${JSON.stringify(extPattern)})`,
    opts.trace ? 'set +x' : '',
    'echo "MISSING:[$out]"',
  ].filter(Boolean).join('\n');
  const r = spawnSync('bash', ['-c', script], {
    cwd: root, encoding: 'utf-8',
    env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  const m = stdout.match(/MISSING:\[(.*)\]/);
  if (!m) throw new Error(`check_scenarios_complete 未产出结果：${stdout}\n${stderr}`);
  // 防假绿：函数未被 source 成功时 bash 会报 command not found 并给出空结果
  if (/command not found/.test(stderr)) throw new Error(`函数未被 source：${stderr}`);
  const raw = m[1].trim();
  return { missing: raw ? raw.split(/\s+/).filter(Boolean) : [], stdout, stderr };
}

const SCEN_DIR = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
const API_DIR = 'logos/resources/api';
const TEST_DIR = 'logos/resources/test';

/** 三个调用点各自的 missing 集合（直接调函数，避免被 phase 链的短路顺序遮蔽）。 */
function missingAtAllCallSites(root: string) {
  return {
    scenario: callCheck(root, SCEN_DIR, '*.md').missing,
    api: callCheck(root, API_DIR, '*.yaml *.yml').missing,
    test: callCheck(root, TEST_DIR, '*.md').missing,
  };
}

/** 目录全树逐文件 SHA-256（只读性证明）。 */
function treeHashes(dir: string, base = dir, out = new Map<string, string>()): Map<string, string> {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) treeHashes(abs, base, out);
    else out.set(abs.slice(base.length + 1), createHash('sha256').update(readFileSync(abs)).digest('hex'));
  }
  return out;
}

/** CLI 权威口径：`status --format json` 的 per-scenario scenario_coverage.missing。 */
function cliMissing(root: string): { scenario: string[]; test: string[] } {
  const r = spawnSync(process.execPath, [CLI_ENTRY, 'status', '--format', 'json'], {
    cwd: root, encoding: 'utf-8', env: { ...process.env },
  });
  const parsed = JSON.parse(r.stdout ?? '{}');
  const mod = parsed?.data?.modules?.find((m: { id?: string }) => m?.id === 'core');
  const pp = mod?.phase_progress ?? {};
  return {
    scenario: pp['phase.3-1']?.scenario_coverage?.missing ?? [],
    test: pp['phase.3-4a']?.scenario_coverage?.missing ?? [],
  };
}

describe('S11 phase 探测模块前缀命名兼容（切片 2）', () => {
  it('UT-S11-82: 模块前缀命名项目三个调用点均零 missing（含真实项目根噪声，修复前必红）', () => {
    const { root } = project({ naming: 'prefixed', rootNoise: true });
    // 根噪声确实在场——修复前 `*.md` / `*.yaml *.yml` 正是被它们替换掉
    expect(existsSync(join(root, 'README.md'))).toBe(true);
    expect(existsSync(join(root, 'noise.yaml'))).toBe(true);

    expect(missingAtAllCallSites(root)).toEqual({ scenario: [], api: [], test: [] });
    expect(runProbe(root)).not.toContain('missing');
  });

  it('UT-S11-83: 模式字面量到达 find，结果不随 cwd 文件集合变化', () => {
    // 两态对照：项目根无 .md/.yaml 噪声 vs 仅新增噪声
    const clean = project({ naming: 'prefixed', rootNoise: false });
    const noisy = project({ naming: 'prefixed', rootNoise: true });
    const cleanMissing = missingAtAllCallSites(clean.root);
    const noisyMissing = missingAtAllCallSites(noisy.root);
    expect(cleanMissing).toEqual({ scenario: [], api: [], test: [] });
    expect(noisyMissing).toEqual(cleanMissing);      // INV-SC4：结果不随 cwd 文件集合变化

    // 捕获真实执行的 find 参数：-name 值恒为字面量，不得出现被 cwd 文件名替换后的形态
    const traced = callCheck(noisy.root, SCEN_DIR, '*.md', { trace: true });
    expect(traced.stderr).toContain('S01-*.md');        // -name 值恒为字面量模式
    expect(traced.stderr).toContain('*-S01-*.md');
    expect(traced.stderr).not.toContain('S01-README.md');  // 修复前正是这个形态
    expect(traced.stderr).not.toContain('S01-AGENTS.md');
    expect(traced.stderr).not.toContain('S01-CLAUDE.md');
    const tracedApi = callCheck(noisy.root, API_DIR, '*.yaml *.yml', { trace: true });
    expect(tracedApi.stderr).toContain('*-S01-*.yaml');
    expect(tracedApi.stderr).not.toContain('S01-noise.yaml');
  });

  it('UT-S11-84: 无前缀历史命名向后兼容仍命中（shell 自身断言，不与 CLI 对账）', () => {
    const { root } = project({ naming: 'bare', rootNoise: true });
    expect(missingAtAllCallSites(root)).toEqual({ scenario: [], api: [], test: [] });
    expect(runProbe(root)).not.toContain('missing');
    // 该输入**不在恒等域内**：CLI 按权威口径 `core-SXX` 子串判 missing（已知差异清单第 1 行）。
    // 此处如实见证该差异，不判红、不收紧。
    expect(cliMissing(root).scenario).toEqual([...SCENARIOS]);
  });

  it('UT-S11-85: 真实缺失仍如实报 missing（不漏报）', () => {
    const { root } = project({
      naming: 'prefixed',
      rootNoise: true,
      missing: { scenario: ['S02', 'S04'], api: ['S03'], test: ['S01'] },
      scenarioExtras: ['core-00-scenario-overview.md'],   // 非场景文件，不得被当作任一场景的覆盖
    });
    const at = missingAtAllCallSites(root);
    expect(at.scenario).toEqual(['S02', 'S04']);          // 顺序稳定（按声明顺序）
    expect(at.api).toEqual(['S03']);
    expect(at.test).toEqual(['S01']);

    // 已知差异见证臂：其它模块同号文件被 `*-${sid}-${pat}` 接受 —— 本次放宽的已知代价
    // （已知差异清单第 2 行；shell 不解析模块归属，收紧需另立提案）。如实记录为预期，不判红。
    const other = project({
      naming: 'prefixed', rootNoise: true, missing: { scenario: ['S02'] },
      scenarioExtras: ['web-S02-flow.md'],
    });
    expect(callCheck(other.root, SCEN_DIR, '*.md').missing).toEqual([]);
    expect(cliMissing(other.root).scenario).toEqual(['S02']);
  });

  it('ST-S11-47: 恒等域上 SessionStart 探测与 status 权威口径 missing 集合逐项相等', () => {
    expect(existsSync(CLI_ENTRY)).toBe(true);

    // fixture ①：恒等域 + 全覆盖（根噪声在场）
    const full = project({ naming: 'prefixed', rootNoise: true });
    // fixture ②：恒等域 + 部分缺失
    const partial = project({
      naming: 'prefixed', rootNoise: true,
      missing: { scenario: ['S03'], test: ['S03'] },
    });

    for (const [label, root, expected] of [
      ['①全覆盖', full.root, [] as string[]],
      ['②部分缺失', partial.root, ['S03']],
    ] as const) {
      const shell = missingAtAllCallSites(root);
      const cli = cliMissing(root);
      // 只比对 CLI 侧确有 per-scenario 判定的两个调用点
      expect(shell.scenario, label).toEqual(cli.scenario);
      expect(shell.test, label).toEqual(cli.test);
      expect(shell.scenario, label).toEqual(expected);
      expect(cli.scenario, label).toEqual(expected);
      // API 调用点不参与对账（CLI 侧 SCENARIO_PHASES 不含 API），只断言 shell 自身结果
      expect(shell.api, label).toEqual(expected.length > 0 ? [] : []);
    }

    // 只读：探测全路径不写任何文件
    const before = treeHashes(full.root);
    runProbe(full.root);
    expect(treeHashes(full.root)).toEqual(before);

    // per-scenario 判定不依赖 CLI（D1 零依赖约束）：PATH 中无 openlogos 时结论不变。
    // 注：脚本在 launched 分支另有 `openlogos status` 调用用于 guard 文案，与本判定无关。
    const withoutCli = missingAtAllCallSites(partial.root);
    const withCli = (() => {
      const binDir = join(partial.root, 'fakebin');
      mkdirSync(binDir, { recursive: true });
      writeFileSync(join(binDir, 'openlogos'), '#!/usr/bin/env bash\necho "{}"\n');
      execFileSync('chmod', ['755', join(binDir, 'openlogos')]);
      return probeMissing(runProbe(partial.root, { path: `${binDir}:/usr/bin:/bin` }));
    })();
    expect(withCli).toEqual(withoutCli.scenario);
  }, 60_000);
});
