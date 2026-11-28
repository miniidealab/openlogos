/**
 * verify-scope-fields-and-slice-module 切片 2：共享验收配置按字段判断（openlogos #4，功能规格 §2.96.3、§2.96.3.1、§2.109.2、§2.109.7）。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 共享验收配置按字段判断测试」严格对齐：UT-S13-275～293、ST-S13-52～54。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 夹具 MS：多模块（core、portal-web，各自声明 paths 且各有命令组，分层关闭），见 golden/s13-module-scope-fixture.mjs。
 * 夹具 LV / LV-mod：见 golden/s13-layered-fixture.mjs。`detail` 一律精确字符串比较；「是否读取了起点文件内容」经 git 调用接缝断言。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { readProjectYaml } from '../src/lib/project-yaml.js';
import { defaultGitRunner, resolveVerifyScope, sameParsedValue, type GitRunner } from '../src/lib/verify-scope.js';
// @ts-expect-error 夹具为 ESM .mjs（与基线生成脚本共用），无类型声明
import { GIT_ENV, addProposal, createScopeProject, git, put, runVerify as runMsVerify } from './golden/s13-module-scope-fixture.mjs';
import {
  ALL_DEFAULT, P_DEFAULT, SLUG, commitAll, createLv, destroyLv, runVerify as runLvVerify,
} from './golden/s13-layered-fixture.mjs';
import {
  CONFIG, MS_IDS, YAML, appendYaml, corruptConfig, editConfig, msProposal, observeNotEntered, readConfig, readYaml,
  seedResults, writeConfig, writeYaml,
} from './golden/s13-shared-config-fixture.mjs';

vi.setConfig({ testTimeout: 180_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const NOT_ENTERED_GOLDEN = JSON.parse(readFileSync(join(HERE, 'golden/s13-shared-config-not-entered-baseline.json'), 'utf8'));

// ── 夹具 MS ──
const roots: string[] = [];
type MsRun = { status: number; stdout: string; stderr: string; data: any; calls: Array<{ label: string }> };
const ms = (opts?: Record<string, unknown>): string => { const r = createScopeProject(opts) as string; roots.push(r); return r; };
const msVerify = (root: string, env?: Record<string, string>) => runMsVerify(CLI, root, env ? { env } : undefined) as MsRun;
const labels = (run: MsRun) => run.calls.map(c => c.label);
const commit = (root: string, message = 'prep') => { git(root, ['add', '-A']); git(root, ['commit', '-qm', message]); };
/** 建提案之前提交一次配置改动，使之成为提案起点的内容。 */
const baseConfig = (root: string, mutate: (cfg: any) => void) => { editConfig(root, mutate); commit(root, 'config'); };

// ── 夹具 LV ──
type Lv = ReturnType<typeof createLv>;
const made: Lv[] = [];
const lv = (opts: Record<string, unknown> = {}): Lv => { const f = createLv({ buildTestChangeSet, ...opts }); made.push(f); return f; };
const lvVerify = (f: Lv) => runLvVerify(CLI, f);
const executedOf = (run: { calls: any[] }): string[] => Array.from(new Set(run.calls.flatMap(c => c.executed as string[]))).sort();
const expansionReason = (data: any, code: string) => data.layers.expansion.reasons.find((r: any) => r.code === code);
const reasonCodes = (data: any): string[] => data.layers.expansion.reasons.map((r: any) => r.code);
/** 把当前工作区提交为新的提案起点（用于构造「提案起点中的内容」）。 */
function rebase(f: Lv): void {
  const head = commitAll(f, 'base');
  const path = join(f.root, 'logos/.openlogos-guard');
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), baseRef: head }, null, 2));
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  while (made.length) destroyLv(made.pop()!);
});

const DUP_KEY = 'resource_index: []\nresource_index: []\n';
/** 未列出的顶层字段 graph：锚点与别名构成回指（映射成员与数组元素各一处）。 */
const CYCLIC_YAML = 'graph: &g\n  weight: 1\n  self: *g\n  list:\n    - *g\n';
const fallbackOf = (run: MsRun) => run.data.scope.fallback_reason;

describe('S13 共享验收配置按字段判断 — 按模块限定范围', () => {
  it('UT-S13-275: 模块范围：只改项目 YAML 的无关字段不回落', () => {
    const root = ms();
    msProposal(root);
    appendYaml(root, [
      'resource_index:', '  - path: logos/resources/verify/a.md', '    desc: a', '  - path: logos/resources/verify/b.md', '    desc: b',
      'scenarios:', '  - id: S50', '    name: demo', 'scenario_counter:', '  next_id: 51', '',
    ].join('\n'));
    const run = msVerify(root);
    expect(run.data.scope.mode).toBe('module');
    expect(run.data.scope.modules).toEqual(['portal-web']);
    expect(run.data.scope.fallback_reason).toBeNull();
    expect(run.data.scope.reasons.some((r: any) => r.ref === YAML)).toBe(false);
    expect(JSON.stringify(run.data.scope)).not.toContain('unmapped_file');
    expect(labels(run)).toEqual(['portal-web']);
  });

  it('UT-S13-276: 模块范围：只改项目配置的无关字段不回落', () => {
    const plain = ms();
    msProposal(plain);
    const root = ms();
    msProposal(root);
    editConfig(root, cfg => { cfg.driver = { review: { enabled: true } }; cfg.description = 'changed'; cfg.branch_sync = { enabled: false }; });
    const run = msVerify(root);
    expect(run.data.scope.mode).toBe('module');
    expect(run.data.scope).toEqual(msVerify(plain).data.scope);
    expect(JSON.stringify(run.data.scope)).not.toContain('shared_config_changed');
    expect(JSON.stringify(run.data.scope)).not.toContain('unmapped_file');
  });

  it('UT-S13-277: 模块范围：相关字段逐个触发回落并点名', () => {
    const arms: Array<[string, (root: string) => void]> = [
      [`${CONFIG}（verify）`, root => editConfig(root, cfg => { cfg.verify.pre_run_command = 'node tools/rec.cjs project@x'; })],
      [`${CONFIG}（smoke）`, root => editConfig(root, cfg => { cfg.smoke = { command: 'node tools/smoke.cjs' }; })],
      [`${CONFIG}（sourceRoots）`, root => editConfig(root, cfg => { cfg.sourceRoots = { src: ['src'] }; })],
      [`${CONFIG}（guard）`, root => editConfig(root, cfg => { cfg.guard = { exempt: ['docs/**'] }; })],
      [`${YAML}（modules）`, root => writeYaml(root, readYaml(root).replace('["portal-web/**"]', '["portal-web/**","extra/**"]'))],
    ];
    for (const [detail, change] of arms) {
      const root = ms();
      msProposal(root);
      const before = readFileSync(join(root, detail.startsWith(CONFIG) ? CONFIG : YAML), 'utf8');
      change(root);
      expect(readFileSync(join(root, detail.startsWith(CONFIG) ? CONFIG : YAML), 'utf8'), detail).not.toBe(before);
      const run = msVerify(root);
      expect(run.data.scope.mode, detail).toBe('fallback-full');
      expect(fallbackOf(run), detail).toEqual({ code: 'shared_config_changed', detail });
    }
  });

  it('UT-S13-278: 多个字段与两个文件同时变化时的 detail', () => {
    const root = ms();
    msProposal(root);
    editConfig(root, cfg => { cfg.verify.pre_run_command = 'node tools/rec.cjs project@x'; cfg.smoke = { command: 'x' }; cfg.description = 'changed'; });
    writeYaml(root, `${readYaml(root).replace('name: core', 'name: Core')}resource_index: []\n`);
    const run = msVerify(root);
    expect(fallbackOf(run)).toEqual({
      code: 'shared_config_changed',
      detail: `${CONFIG}（smoke、verify）、${YAML}（modules）`,
    });
  });

  it('UT-S13-279: 未列出的字段按相关处理', () => {
    const arms: Array<[string, (root: string) => void]> = [
      [`${CONFIG}（documents）`, root => editConfig(root, cfg => { cfg.documents = { prd: { label: 'PRD' } }; })],
      [`${CONFIG}（flow）`, root => editConfig(root, cfg => { cfg.flow = { nodes: [] }; })],
      [`${CONFIG}（x_custom）`, root => editConfig(root, cfg => { cfg.x_custom = 1; })],
      [`${YAML}（custom_block）`, root => appendYaml(root, 'custom_block:\n  a: 1\n')],
    ];
    for (const [detail, change] of arms) {
      const root = ms();
      msProposal(root);
      change(root);
      const run = msVerify(root);
      expect(run.data.scope.mode, detail).toBe('fallback-full');
      expect(fallbackOf(run), detail).toEqual({ code: 'shared_config_changed', detail });
    }
    // 标量按解析后的值、按类型比较（code-r1 F1）：未列出的字段 schedule 的时间戳变了一天。
    // 两个 Date 的可枚举键都为空，按映射比较会被判相同而漏掉这次变化。
    const ts = ms();
    appendYaml(ts, 'schedule: !!timestamp 2025-01-01\n');
    commit(ts, 'timestamp base');
    msProposal(ts);
    writeYaml(ts, readYaml(ts).replace('!!timestamp 2025-01-01', '!!timestamp 2025-01-02'));
    const tsRun = msVerify(ts);
    expect(tsRun.data.scope.mode).toBe('fallback-full');
    expect(fallbackOf(tsRun)).toEqual({ code: 'shared_config_changed', detail: `${YAML}（schedule）` });
    // 带循环引用的未列出字段里改了一个普通标量（code-r2 F5）：仍能检出真正的变化
    const cyc = ms();
    appendYaml(cyc, CYCLIC_YAML);
    commit(cyc, 'cyclic base');
    msProposal(cyc);
    writeYaml(cyc, readYaml(cyc).replace('weight: 1', 'weight: 2'));
    expect(fallbackOf(msVerify(cyc))).toEqual({ code: 'shared_config_changed', detail: `${YAML}（graph）` });
  });

  it('UT-S13-280: 只调整写法不算变化，数组顺序算变化', () => {
    const two = { modules: [{ id: 'core', paths: ['src/**', 'tools/**'] }, { id: 'portal-web', paths: ['portal-web/**'] }] };
    // ① 重排 logos.config.json 顶层键与 verify 内部键的顺序并改变缩进
    const a = ms();
    msProposal(a);
    const cfg = readConfig(a);
    const reordered: Record<string, unknown> = {};
    for (const key of Object.keys(cfg).reverse()) reordered[key] = key === 'verify' ? Object.fromEntries(Object.entries(cfg.verify).reverse()) : cfg[key];
    writeConfig(a, reordered, 4);
    expect(readFileSync(join(a, CONFIG), 'utf8')).not.toBe(JSON.stringify(cfg, null, 2));
    expect(msVerify(a).data.scope.mode).toBe('module');
    // ② modules 段加注释、字符串改为带引号写法、重排模块内的键
    const b = ms();
    msProposal(b);
    writeYaml(b, [
      'project:', '  name: msv', 'modules:', '  # 模块清单', '  - name: "core"', '    id: "core"', "    lifecycle: 'launched'",
      '    paths: ["src/**"]', '  - lifecycle: launched', '    paths:', '      - "portal-web/**"', '    id: portal-web', '    name: portal-web', '',
    ].join('\n'));
    const runB = msVerify(b);
    expect(runB.data.scope.mode).toBe('module');
    expect(runB.data.scope.fallback_reason).toBeNull();
    // ③ 对调 modules 两个模块的先后
    const c = ms();
    msProposal(c);
    writeYaml(c, [
      'project:', '  name: msv', 'modules:', '  - id: portal-web', '    name: portal-web', '    lifecycle: launched', '    paths: ["portal-web/**"]',
      '  - id: core', '    name: core', '    lifecycle: launched', '    paths: ["src/**"]', '',
    ].join('\n'));
    expect(fallbackOf(msVerify(c))).toEqual({ code: 'shared_config_changed', detail: `${YAML}（modules）` });
    // ④ 对调某模块 paths 两个元素的先后
    const d = ms(two);
    msProposal(d);
    writeYaml(d, readYaml(d).replace('["src/**","tools/**"]', '["tools/**","src/**"]'));
    expect(fallbackOf(msVerify(d))).toEqual({ code: 'shared_config_changed', detail: `${YAML}（modules）` });
    // ⑤ 取值为 .nan 的字段只改所在行的注释（code-r1 F1）：NaN !== NaN，按 === 比较会把写法调整误判成变化
    const e = ms();
    appendYaml(e, 'ratio: .nan\nstamp: !!timestamp 2025-01-01\n');
    commit(e, 'nan base');
    msProposal(e);
    writeYaml(e, readYaml(e).replace('ratio: .nan', 'ratio: .nan # 只改注释').replace('stamp: !!timestamp 2025-01-01', 'stamp: !!timestamp 2025-01-01 # 同一天'));
    const runE = msVerify(e);
    expect(runE.data.scope.mode).toBe('module');
    expect(runE.data.scope.fallback_reason).toBeNull();
    // ⑥ 循环引用（code-r2 F5）。先在内存中验证：两个带回指的等值对象图，比较能够结束且判为相同；
    //    改变其中一个普通标量（映射成员、数组元素各一处）后仍判为不同
    const graph = (weight: number, tag: string) => {
      const node: Record<string, unknown> = { weight, tags: ['x', tag] };
      node.self = node;
      (node.tags as unknown[]).push(node);
      const peer: Record<string, unknown> = { back: node };
      node.peer = peer;
      return { node, list: [node, peer] };
    };
    expect(sameParsedValue(graph(1, 'y'), graph(1, 'y'))).toBe(true);
    expect(sameParsedValue(graph(1, 'y'), graph(2, 'y'))).toBe(false);
    expect(sameParsedValue(graph(1, 'y'), graph(1, 'z'))).toBe(false);
    //    再走真实 CLI：未列出的字段含锚点与别名构成的回指，工作区只改注释 → 不回落，也不因递归耗尽调用栈而中断
    const g = ms();
    appendYaml(g, CYCLIC_YAML);
    commit(g, 'cyclic base');
    msProposal(g);
    writeYaml(g, readYaml(g).replace('weight: 1', 'weight: 1 # 只改注释'));
    const runG = msVerify(g);
    expect(runG.stderr).not.toContain('RangeError');
    expect(runG.data.scope.mode).toBe('module');
    expect(runG.data.scope.fallback_reason).toBeNull();
  });

  it('UT-S13-281: 字段在一侧不存在按变化处理', () => {
    const arms: Array<[string | null, (cfg: any) => void]> = [
      [`${CONFIG}（smoke）`, cfg => { delete cfg.smoke; }],
      [null, cfg => { delete cfg.description; }],
      [`${CONFIG}（guard）`, cfg => { cfg.guard = { exempt: [] }; }],
      [null, cfg => { cfg.branch_sync = { enabled: true }; }],
    ];
    for (const [detail, change] of arms) {
      const root = ms();
      baseConfig(root, cfg => { cfg.smoke = { command: 'node tools/smoke.cjs' }; cfg.description = 'base'; });
      msProposal(root);
      editConfig(root, change);
      const run = msVerify(root);
      if (detail === null) {
        expect(run.data.scope.mode).toBe('module');
        expect(run.data.scope.fallback_reason).toBeNull();
      } else {
        expect(fallbackOf(run), detail).toEqual({ code: 'shared_config_changed', detail });
      }
    }
  });

  it('UT-S13-282: 提案起点一侧无法判断时回落', () => {
    const arms: Array<[string, (root: string) => () => void]> = [
      [`${CONFIG}（提案起点中的内容无法解析）`, root => { const good = readFileSync(join(root, CONFIG), 'utf8'); corruptConfig(root); return () => writeFileSync(join(root, CONFIG), good); }],
      [`${YAML}（提案起点中的内容无法解析）`, root => { const good = readYaml(root); appendYaml(root, DUP_KEY); return () => writeYaml(root, good); }],
      [`${CONFIG}（提案起点中的内容顶层不是对象）`, root => { const good = readFileSync(join(root, CONFIG), 'utf8'); writeFileSync(join(root, CONFIG), '[]\n'); return () => writeFileSync(join(root, CONFIG), good); }],
      [`${CONFIG}（提案起点中的内容不存在）`, root => { const good = readFileSync(join(root, CONFIG), 'utf8'); rmSync(join(root, CONFIG)); return () => writeFileSync(join(root, CONFIG), good); }],
    ];
    for (const [detail, breakBase] of arms) {
      const root = ms();
      const restore = breakBase(root);
      commit(root, 'broken base');
      addProposal(root, {});
      restore();
      put(root, 'portal-web/app.ts', 'export const app = 2;\n');
      const run = msVerify(root);
      expect(run.data.scope.mode, detail).toBe('fallback-full');
      expect(fallbackOf(run), detail).toEqual({ code: 'shared_config_changed', detail });
    }
  });

  it('UT-S13-283: 提案起点中的内容读取失败时回落', () => {
    const root = ms();
    msProposal(root);
    editConfig(root, cfg => { cfg.description = 'changed'; });
    const failingShow: GitRunner = (cwd, args) => (args[0] === 'show' ? { status: 128, stdout: '' } : defaultGitRunner(cwd, args));
    const scope = resolveVerifyScope(root, { git: failingShow })!;
    expect(scope.mode).toBe('fallback-full');
    expect(scope.fallback_reason).toEqual({ code: 'shared_config_changed', detail: `${CONFIG}（提案起点中的内容读取失败）` });
    // 对照：读取正常时 description 是无关字段，不回落
    expect(resolveVerifyScope(root)!.mode).toBe('module');
  });

  it('UT-S13-284: 工作区项目 YAML 有语法错误但恢复出模块时回落', () => {
    const root = ms();
    msProposal(root);
    appendYaml(root, DUP_KEY);
    const read = readProjectYaml(root);
    expect(read.yaml_diagnostics?.parse_status).toBe('recovered');
    expect((read.data?.modules ?? []).map(m => m.id)).toEqual(['core', 'portal-web']);
    const run = msVerify(root);
    expect(run.data.scope.mode).toBe('fallback-full');
    expect(fallbackOf(run)).toEqual({ code: 'shared_config_changed', detail: `${YAML}（工作区中的内容无法解析）` });
    expect(run.data.layers).toBeUndefined();
  });

  it('UT-S13-285: 模块范围已启用而工作区项目配置损坏时回落', () => {
    const root = ms();
    msProposal(root);
    seedResults(root, MS_IDS);
    corruptConfig(root);
    const run = msVerify(root);
    expect(run.stderr).not.toContain('NO_TEST_RESULTS');
    expect(run.data).not.toBeNull();
    expect(run.calls).toEqual([]);
    expect(run.data.scope.mode).toBe('fallback-full');
    expect(fallbackOf(run)).toEqual({ code: 'shared_config_changed', detail: `${CONFIG}（工作区中的内容无法解析）` });
    expect(run.data.layers).toBeUndefined();
  });

  it('UT-S13-286: 两个范围机制都未进入比较时没有任何原因', () => {
    const now = observeNotEntered(CLI, buildTestChangeSet);
    // ① 工作区没有 logos.config.json：入口错误不变，没有执行任何命令
    expect(now['no-config'].status).toBe(1);
    expect(now['no-config'].error_code).toBe('PROJECT_NOT_INITIALIZED');
    expect(now['no-config'].envelope).toBeNull();
    // ② 单模块 + 配置损坏：分层按未开启，模块范围未启用
    expect(now['lv-corrupt'].envelope.data.layers).toBeUndefined();
    expect(now['lv-corrupt'].envelope.data.scope).toBeUndefined();
    // ③ 删除项目 YAML：模块范围未启用
    expect(now['no-yaml'].envelope.data.scope).toBeUndefined();
    expect(now['no-yaml'].envelope.data.layers).toBeUndefined();
    for (const arm of Object.values(now) as any[]) {
      expect(JSON.stringify(arm)).not.toContain('shared_config_changed');
      expect(JSON.stringify(arm)).not.toContain('shared_path_changed');
    }
    expect(now).toEqual(NOT_ENTERED_GOLDEN);
  });

  it('UT-S13-287: 项目根在 git 仓库子目录时读取正确的起点内容', () => {
    const build = (): string => {
      const repo = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-vsf-sub-')));
      roots.push(repo);
      const seed = createScopeProject({ git: false }) as string;
      roots.push(seed);
      const root = join(repo, 'apps/main');
      cpSync(seed, root, { recursive: true });
      // 仓库根下的干扰文件：与项目同名、verify 不同
      put(repo, CONFIG, JSON.stringify({ name: 'decoy', verify: { pre_run_command: 'echo decoy' }, description: 'decoy' }, null, 2));
      git(repo, ['init', '-q']);
      commit(repo, 'init');
      msProposal(root);
      return root;
    };
    const a = build();
    editConfig(a, cfg => { cfg.description = 'changed'; });
    const runA = msVerify(a);
    expect(runA.data.scope.mode).toBe('module');
    expect(runA.data.scope.fallback_reason).toBeNull();
    const b = build();
    editConfig(b, cfg => { cfg.verify.pre_run_command = 'node tools/rec.cjs project@x'; });
    expect(fallbackOf(msVerify(b))).toEqual({ code: 'shared_config_changed', detail: `${CONFIG}（verify）` });
  });

  it('UT-S13-293: 更早的回落条件成立时不做字段比较', () => {
    const recorded: string[][] = [];
    const recording: GitRunner = (cwd, args) => { recorded.push(args); return defaultGitRunner(cwd, args); };
    const readsBaseContent = () => recorded.some(args => args[0] === 'show' || args[0] === 'ls-tree');
    // ① guard 没有 baseRef
    const a = ms();
    addProposal(a, { baseRef: null });
    editConfig(a, cfg => { cfg.verify.pre_run_command = 'node tools/rec.cjs project@x'; });
    const sa = resolveVerifyScope(a, { git: recording })!;
    expect(sa.fallback_reason?.code).toBe('base_ref_missing');
    expect(readsBaseContent()).toBe(false);
    // ② 没有活跃提案
    recorded.length = 0;
    const b = ms();
    editConfig(b, cfg => { cfg.verify.pre_run_command = 'node tools/rec.cjs project@x'; });
    const sb = resolveVerifyScope(b, { git: recording })!;
    expect(sb.fallback_reason?.code).toBe('no_active_change');
    expect(readsBaseContent()).toBe(false);
    // ③ 真实 CLI：guard 没有 baseRef 且工作区配置损坏 → 仍是 base_ref_missing
    const c = ms();
    addProposal(c, { baseRef: null });
    seedResults(c, MS_IDS);
    corruptConfig(c);
    const rc = msVerify(c);
    expect(rc.data.scope.mode).toBe('fallback-full');
    expect(rc.data.scope.fallback_reason.code).toBe('base_ref_missing');
    expect(rc.data.layers).toBeUndefined();
    // ④ 分层：guard 没有 baseRef 且工作区项目 YAML 有重复顶层键 → base_ref_unavailable，没有 shared_path_changed
    const f = lv({ guard: 'no-base' });
    appendYaml(f.root, DUP_KEY);
    const rd = lvVerify(f);
    expect(reasonCodes(rd.data)).toContain('base_ref_unavailable');
    expect(reasonCodes(rd.data)).not.toContain('shared_path_changed');
    for (const text of [JSON.stringify(sa), JSON.stringify(sb), JSON.stringify(rc.data.scope), JSON.stringify(rd.data.layers)]) {
      expect(text).not.toContain('shared_config_changed');
    }
  });
});

describe('S13 共享验收配置按字段判断 — 分层验收', () => {
  it('UT-S13-288: 分层：只改无关字段时保持收窄', () => {
    const arms: Array<(f: Lv) => void> = [
      f => editConfig(f.root, cfg => { cfg.description = 'changed after baseRef'; }),
      f => appendYaml(f.root, 'resource_index:\n  - path: logos/resources/verify/a.md\n    desc: a\n'),
    ];
    for (const change of arms) {
      const f = lv();
      change(f);
      const run = lvVerify(f);
      expect(run.data.layers.expansion).toEqual({ level: 'none', reasons: [] });
      expect(run.calls[0].eligible).toEqual(P_DEFAULT);
      expect(executedOf(run)).toEqual(P_DEFAULT);
    }
  });

  it('UT-S13-289: 分层：相关字段与未列出的字段扩大到全量', () => {
    const arms: Array<[string, (f: Lv) => void]> = [
      [`${CONFIG}（smoke）`, f => editConfig(f.root, cfg => { cfg.smoke = { command: 'node tools/smoke.cjs' }; })],
      [`${CONFIG}（x_custom）`, f => editConfig(f.root, cfg => { cfg.x_custom = true; })],
      [`${YAML}（modules）`, f => writeYaml(f.root, readYaml(f.root).replace('name: core', 'name: Core'))],
    ];
    for (const [detail, change] of arms) {
      const f = lv();
      change(f);
      const run = lvVerify(f);
      expect(run.data.layers.expansion.level, detail).toBe('full');
      expect(expansionReason(run.data, 'shared_path_changed'), detail).toEqual({ code: 'shared_path_changed', detail });
      expect(executedOf(run), detail).toEqual(ALL_DEFAULT);
    }
    // 两份配置都有相关变化，另有一个路径夹在两者之间的共享文件（code-r1 F3）：
    // 同一条 shared_path_changed 明细含三项，先按规定顺序列两份配置（JSON 在 YAML 之前），再列其余共享文件
    const f = lv();
    editConfig(f.root, cfg => { cfg.smoke = { command: 'node tools/smoke.cjs' }; });
    writeYaml(f.root, readYaml(f.root).replace('name: core', 'name: Core'));
    put(f.root, 'logos/logos-shared/package-lock.json', '{}\n');
    const mixed = lvVerify(f);
    expect(mixed.data.layers.expansion.reasons.filter((r: any) => r.code === 'shared_path_changed')).toEqual([{
      code: 'shared_path_changed',
      detail: `${CONFIG}（smoke）、${YAML}（modules）、logos/logos-shared/package-lock.json`,
    }]);
  });

  it('UT-S13-290: 分层：进入比较后无法判断时扩大；配置文件未被比较时不掩盖其他原因', () => {
    // ① 提案起点中的 logos.config.json 是损坏的 JSON，工作区有效且分层开启
    const a = lv();
    const good = readFileSync(join(a.root, CONFIG), 'utf8');
    corruptConfig(a.root);
    rebase(a);
    writeFileSync(join(a.root, CONFIG), good);
    // ② 工作区 logos-project.yaml 有重复顶层键
    const b = lv();
    appendYaml(b.root, DUP_KEY);
    // ③ 删除工作区 logos-project.yaml
    const c = lv();
    rmSync(join(c.root, YAML));
    const expected = [
      `${CONFIG}（提案起点中的内容无法解析）`, `${YAML}（工作区中的内容无法解析）`, `${YAML}（工作区中的内容不存在）`,
    ];
    [a, b, c].forEach((f, index) => {
      const run = lvVerify(f);
      expect(run.data.scope, expected[index]).toBeUndefined();
      expect(run.data.layers.expansion.level, expected[index]).toBe('full');
      expect(expansionReason(run.data, 'shared_path_changed'), expected[index]).toEqual({ code: 'shared_path_changed', detail: expected[index] });
    });
    // ④ 两侧都没有 logos-project.yaml，logos.config.json 两侧相同，只改 package-lock.json
    const d = lv();
    rmSync(join(d.root, YAML));
    rebase(d);
    put(d.root, 'package-lock.json', '{}\n');
    const run = lvVerify(d);
    expect(run.data.scope).toBeUndefined();
    expect(run.data.layers.expansion.level).toBe('full');
    const reason = expansionReason(run.data, 'shared_path_changed');
    expect(reason.detail).toBe('package-lock.json');
    expect(reason.detail).not.toContain(YAML);
    expect(reason.detail).not.toContain(CONFIG);
    expect(executedOf(run)).toEqual(ALL_DEFAULT);
  });

  it('UT-S13-291: shared_paths 显式列出共享验收配置文件时按路径命中', () => {
    const layered = { enabled: true, shared_paths: [CONFIG] };
    // ① 夹具 LV
    const a = lv({ layered });
    editConfig(a.root, cfg => { cfg.description = 'changed'; });
    const runA = lvVerify(a);
    expect(runA.data.layers.expansion.level).toBe('full');
    expect(expansionReason(runA.data, 'shared_path_changed')).toEqual({ code: 'shared_path_changed', detail: CONFIG });
    // ② 夹具 LV-mod：模块范围不读取 shared_paths，description 是无关字段
    const b = lv({ mod: true, layered });
    editConfig(b.root, cfg => { cfg.description = 'changed'; });
    const runB = lvVerify(b);
    expect(runB.data.layers.expansion.level).toBe('full');
    expect(expansionReason(runB.data, 'shared_path_changed')).toEqual({ code: 'shared_path_changed', detail: CONFIG });
    expect(runB.data.scope.mode).toBe('module');
    expect(runB.data.scope.fallback_reason).toBeNull();
  });

  it('UT-S13-292: 两个范围机制对同一改动结论一致', () => {
    // ① 相关字段：两处都点名，detail 相同
    const a = lv({ mod: true });
    editConfig(a.root, cfg => { cfg.verify.modules.backend.pre_run_command = 'node tools/lv-runner.mjs backend extra'; });
    const runA = lvVerify(a);
    const detail = `${CONFIG}（verify）`;
    expect(runA.data.scope.fallback_reason).toEqual({ code: 'shared_config_changed', detail });
    expect(expansionReason(runA.data, 'shared_path_changed')).toEqual({ code: 'shared_path_changed', detail });
    // ② 无关字段：两处都不因该文件回落或扩大
    const b = lv({ mod: true });
    editConfig(b.root, cfg => { cfg.driver = { review: { enabled: true } }; });
    const runB = lvVerify(b);
    expect(runB.data.scope.mode).toBe('module');
    expect(runB.data.scope.fallback_reason).toBeNull();
    expect(reasonCodes(runB.data)).not.toContain('shared_path_changed');
  });
});

/** 能通过 merge 前置检查的最小提案（登记在 portal-web）。 */
const MERGE_PROPOSAL = [
  '# 变更提案：msv-demo', '', '> module: portal-web', '',
  '## 变更原因', '测试夹具：多模块提案合并规格后验收。', '',
  '## 变更类型', '代码级', '',
  '## 变更范围', '- 影响的测试规格：夹具项目的测试用例文档。', '',
  '## 部署影响', '- 是否需要部署：否', '- 部署原因：夹具不产生部署影响', '- 影响环境：无',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
  '## UI/UX 变更声明', '', '```yaml', 'ui_impact: false', 'design_system_mode: generated',
  'design_system_fallback_reason: ""', 'pages: []', '```', '',
  '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
  'impacts:', '  data:', '    status: none', '    reason: 夹具不涉及数据影响',
  '  compatibility:', '    status: none', '    reason: 夹具不涉及兼容性影响',
  '  security_privacy:', '    status: none', '    reason: 夹具不涉及安全或隐私影响',
  '  public_release:', '    status: none', '    reason: 夹具不涉及公开发布',
  '  external_commitment:', '    status: none', '    reason: 夹具不涉及外部承诺',
  'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
  '## 验收标准', '- 自动验收环境要求：无', '- 平台限定用例：无', '- 需要人参与的验收：无', '',
  '## 受影响场景', '', '```yaml', 'schema: openlogos/affected-scenarios@1', 'assessment: assessed', 'shared_change: false', 'scenarios: []', '```', '',
  '## 变更概述', '夹具：新增一条 portal-web 用例。', '',
].join('\n');

describe('S13 共享验收配置按字段判断 — 场景测试', () => {
  it('ST-S13-52: 现场回放：合并规格后多模块提案的验收不再回落全量', () => {
    const root = ms();
    const target = 'logos/resources/test/portal-web-S50-test-cases.md';
    const dir = addProposal(root, {}) as string;
    // 可合并的最小提案（登记在 portal-web）：新增一条 portal-web 用例
    writeFileSync(join(dir, 'proposal.md'), MERGE_PROPOSAL);
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n\n- [x] 产出 delta 到 `deltas/test/portal-web-S50-test-cases.md`。\n\n## [code] 代码实现\n');
    put(root, 'logos/changes/msv-demo/deltas/test/portal-web-S50-test-cases.md', '## ADDED — 新增用例（msv-demo）\n\n| ID | 描述 |\n|---|---|\n| UT-S50-03 | UT-S50-03 夹具用例 |\n');
    // 经构建后的 CLI 执行正式合并（code-r1 F4）：目标规格、SPEC_MERGED 与其中的模块、变更用例都由 merge 写出
    const merged = spawnSync(process.execPath, [CLI, 'merge', 'msv-demo'], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, ...GIT_ENV, NO_COLOR: '1', OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' },
    });
    expect(merged.status, `${merged.stdout}\n${merged.stderr}`).toBe(0);
    const marker = JSON.parse(readFileSync(join(dir, 'SPEC_MERGED'), 'utf8'));
    expect(marker.test_change_set.change).toBe('msv-demo');
    expect(marker.test_change_set.module).toBe('portal-web');
    expect(marker.test_change_set.changed_test_ids).toEqual(['UT-S50-03']);
    expect(readFileSync(join(root, target), 'utf8')).toContain('UT-S50-03');
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    // 合并规格后资源索引新增两条并提交（相对提案起点的差异仍在）
    appendYaml(root, 'resource_index:\n  - path: logos/resources/verify/a.md\n    desc: a\n  - path: logos/resources/verify/b.md\n    desc: b\n');
    commit(root, 'merge specs');
    const run = msVerify(root, { MSV_EXTRA_ROWS: JSON.stringify([{ id: 'UT-S50-03', status: 'pass' }]) });
    expect(run.status).toBe(0);
    expect(run.data.scope.mode).toBe('module');
    expect(run.data.scope.modules).toEqual(['portal-web']);
    expect(run.data.scope.fallback_reason).toBeNull();
    expect(run.data.gate.result).toBe('PASS');
    expect(labels(run)).toEqual(['portal-web']);
  });

  it('ST-S13-53: 现场回放：宿主写回运行偏好不回落，随后改测试命令才回落', () => {
    const root = ms();
    msProposal(root);
    editConfig(root, cfg => { cfg.driver = { review: { enabled: true, max_rounds: 3 } }; });
    const first = msVerify(root);
    expect(first.data.scope.mode).toBe('module');
    expect(labels(first)).toEqual(['portal-web']);
    editConfig(root, cfg => { cfg.verify.modules.core.pre_run_command = 'node tools/rec.cjs core@x'; });
    const second = msVerify(root);
    expect(second.data.scope.mode).toBe('fallback-full');
    expect(fallbackOf(second)).toEqual({ code: 'shared_config_changed', detail: `${CONFIG}（verify）` });
    expect(labels(second)).toEqual(['core@x', 'portal-web']);
  });

  it('ST-S13-54: 分层项目：索引变化不再让提案级验收扩大到全量', () => {
    const f = lv({ script: { cases: { 'UT-S03-02': 'fail' } }, verify: { rerun_failed: { enabled: false } } });
    appendYaml(f.root, 'resource_index:\n  - path: logos/resources/verify/a.md\n    desc: a\nscenarios:\n  - id: S01\n    name: demo\n');
    const first = lvVerify(f);
    expect(first.data.gate.result).toBe('PASS');
    expect(first.data.layers.expansion.level).toBe('none');
    expect(executedOf(first)).toEqual(P_DEFAULT);
    expect(executedOf(first)).not.toContain('UT-S03-02');
    editConfig(f.root, cfg => { cfg.smoke = { command: 'node tools/other-smoke.cjs' }; });
    const second = lvVerify(f);
    expect(second.data.layers.expansion.level).toBe('full');
    expect(expansionReason(second.data, 'shared_path_changed')).toEqual({ code: 'shared_path_changed', detail: `${CONFIG}（smoke）` });
    expect(executedOf(second)).toContain('UT-S03-02');
    expect(second.data.gate.result).toBe('FAIL');
    expect(second.data.gate.reason).toBe('failed_cases');
    expect(existsSync(join(f.root, 'logos/changes', SLUG))).toBe(true);
  });
});
