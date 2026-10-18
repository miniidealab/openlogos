/**
 * module-scoped-verify 切片2：按模块限定 verify 范围的计算与核对（S13）。
 *
 * 覆盖 UT-S13-104、106、107、108、111、112、113、114、115、118、119 与 ST-S13-30
 * （logos/resources/test/core-S13-test-cases.md「S13 按模块限定 verify 范围测试」）。
 * 规范源：功能规格 §2.96；spec/test-results.md「按模块限定 verify 范围的运行约定（module-scoped-verify）」；
 * spec/test-slice-manifest.md §7.1；spec/cli-json-output.md「verify `scope` 按模块限定范围字段」。
 * CLI 用例以真实 dist 入口子进程执行（global-setup 已构建）；纯函数用例直接调用范围计算模块。
 * UT-S13-104 / ST-S13-30 与改动前 CLI 录得的落盘基线逐字比较（生成方式见 test/golden/README.md）。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSchema, validate } from '@hyperjump/json-schema/draft-2020-12';
import { collectChangedFiles, resolveVerifyScope, type GitRunner, type VerifyScopeData } from '../src/lib/verify-scope.js';
import { computeInScopeIds, extractDefinedIds } from '../src/commands/verify.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import {
  computeSpecFingerprint,
  computeTaskFingerprint,
  extractDefinedVerificationIds,
  writeTestSliceManifestAtomic,
  type TestSliceManifestV1,
} from '../src/lib/test-slice-manifest.js';
// @ts-expect-error 夹具为 ESM .mjs（与基线生成脚本共用），无类型声明
import { addProposal, createScopeProject, git, observeDisabledFixtures, put, runVerify } from './golden/s13-module-scope-fixture.mjs';

// 本文件用例串行驱动真实 CLI 子进程与 git，全量负载下单条可达数秒，放宽超时、断言不变。
vi.setConfig({ testTimeout: 60_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const REPO = resolve(HERE, '../..');
const BASELINE = join(HERE, 'golden', 's13-module-scope-disabled-baseline.json');

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });
const project = (opts?: Record<string, unknown>): string => { const r = createScopeProject(opts) as string; roots.push(r); return r; };
const verifyJson = (root: string, opts?: { args?: string[]; env?: Record<string, string> }) => runVerify(CLI, root, opts) as {
  status: number; data: any; calls: Array<{ label: string; modules: string | null; eligible: string[] | null }>; report: string | null; stderr: string;
};
const scopeRow = (report: string | null) => (report ?? '').split('\n').find(line => line.startsWith('| Scope |')) ?? null;
const table = (ids: string[], note = '') => ['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具用例${note} |`)].join('\n') + '\n';

describe('S13 按模块限定 verify 范围 — 启用条件与零回归（module-scoped-verify 切片2）', () => {
  it('UT-S13-104: 单模块或无任何 paths 时未启用（review F1 负向兼容）', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const current = observeDisabledFixtures(CLI);
    for (const arm of ['ut104-single-module', 'ut104-no-paths', 'ut104-empty-paths']) {
      // 与改动前 CLI 的输出（剔除时间、耗时、临时路径后）逐字一致
      expect(current[arm], `${arm} 与引入前基线逐字一致`).toEqual(baseline[arm]);
      const data = current[arm].envelope.data;
      expect(data.scope, arm).toBeUndefined();
      expect(data.pre_run.commands.every((c: any) => !('modules' in c)), arm).toBe(true);
      expect(data.summary.defined_count, arm).toBe(5);
      expect(current[arm].calls, arm).toEqual([{ label: 'project', modules: null, eligible: null }]);
      expect(data.gate.reason, arm).toBe('failed_cases');
      expect(data.failed_cases.map((f: any) => f.id), arm).toEqual(['UT-S01-01']);
      expect(scopeRow(current[arm].report), arm).toBeNull();
    }
  });

  it('ST-S13-30: 无 paths 的多模块项目上纯规格提案走现有全量流程（review F1）', () => {
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
    const current = observeDisabledFixtures(CLI);
    const arm = 'st30-no-paths-spec-only';
    expect(current[arm]).toEqual(baseline[arm]);
    expect(current[arm].envelope.data.scope).toBeUndefined();
    expect(current[arm].envelope.data.summary.defined_count).toBe(5);
    expect(current[arm].calls.map((c: any) => c.label)).toEqual(['project']);
    expect(current[arm].envelope.data.gate.result).toBe('PASS');
  });
});

describe('S13 按模块限定 verify 范围 — 范围计算（module-scoped-verify 切片2）', () => {
  it('UT-S13-106: 范围 M 的三类来源与 reasons', () => {
    const root = project({ modules: [{ id: 'core', paths: ['src/**'] }, { id: 'portal-web', paths: ['portal-web/**'] }, { id: 'portal-server' }] });
    addProposal(root, { slug: 'srv', module: 'portal-server', deltas: { 'test/portal-web-S50-test-cases.md': `## MODIFIED — 测试\n\n${table(['UT-S50-01'])}` } });
    put(root, 'src/protocol.ts', 'export const v = 2;\n');
    const scope = resolveVerifyScope(root)!;
    const expected = {
      mode: 'module', modules: ['core', 'portal-web', 'portal-server'], fallback_reason: null, out_of_scope_result_count: 0,
      reasons: [
        { module: 'core', source: 'path', ref: 'src/protocol.ts' },
        { module: 'portal-web', source: 'delta', ref: 'deltas/test/portal-web-S50-test-cases.md' },
        { module: 'portal-server', source: 'proposal', ref: 'srv' },
      ],
    };
    expect(scope).toEqual(expected);
    const run = verifyJson(root);
    expect(run.data.scope).toEqual(expected);
    // 未声明 paths 的 portal-server 只经提案归属进入范围
    expect(run.data.scope.reasons.filter((r: any) => r.module === 'portal-server').map((r: any) => r.source)).toEqual(['proposal']);
  });

  it('UT-S13-107: 改动文件集合（已提交、未提交、未跟踪、删除、重命名两端；忽略文件不计）', () => {
    const root = project();
    put(root, 'src/a.ts', 'a\n'); put(root, 'src/b.ts', 'b\n'); put(root, 'src/c.ts', 'c\n'); put(root, 'src/d.ts', 'd\n');
    git(root, ['add', '-A']); git(root, ['commit', '-qm', 'files']);
    addProposal(root, {});
    const baseRef = JSON.parse(readFileSync(join(root, 'logos/.openlogos-guard'), 'utf8')).baseRef;
    put(root, 'src/a.ts', 'a2\n'); git(root, ['commit', '-qam', 'a2']);
    put(root, 'src/b.ts', 'b2\n');
    put(root, 'portal-web/new.ts', 'n\n');
    git(root, ['rm', '-q', 'src/c.ts']);
    git(root, ['mv', 'src/d.ts', 'portal-web/d.ts']);
    put(root, 'portal-web/dist/out.js', 'ignored\n');
    const changed = collectChangedFiles(root, baseRef);
    expect(changed.ok).toBe(true);
    const files = (changed as { files: string[] }).files.filter(f => !f.startsWith('logos/'));
    expect(files).toEqual(['portal-web/d.ts', 'portal-web/new.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']);
    expect(resolveVerifyScope(root)!.modules).toEqual(['core', 'portal-web']);
  });

  it('UT-S13-108: 改动文件分类——流程产物豁免、规格按前缀、logos/ 下非规格按 paths（review F2 负向 ②）', () => {
    const modulesWithTools = [{ id: 'core', paths: ['src/**', 'logos/tools/**'] }, { id: 'portal-web', paths: ['portal-web/**'] }];
    const arm = (mutate: (root: string) => void, extraModules: Array<{ id: string; paths?: unknown }> = []) => {
      const root = project({ modules: [...modulesWithTools, ...extraModules] });
      addProposal(root, {});
      mutate(root);
      return resolveVerifyScope(root)!;
    };
    // ① 流程产物不参与判定
    const s1 = arm(root => {
      put(root, 'logos/changes/msv-demo/proposal.md', '# 改了提案\n\n> module: portal-web\n');
      put(root, 'logos/resources/verify/acceptance-report.md', '# r\n');
      put(root, 'logos/.runtime/x.json', '{}');
      const guard = JSON.parse(readFileSync(join(root, 'logos/.openlogos-guard'), 'utf8'));
      writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ ...guard, note: 'touched' }));
    });
    expect(s1.mode).toBe('module');
    expect(s1.modules).toEqual(['portal-web']);
    // ② 带模块前缀的规格文件按前缀归属
    const s2 = arm(root => put(root, 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md', '# f\n'));
    expect(s2.modules).toEqual(['core', 'portal-web']);
    expect(s2.reasons).toContainEqual({ module: 'core', source: 'spec', ref: 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md' });
    // ③ logos/ 下已在 paths 声明归属的非规格文件
    const s3 = arm(root => put(root, 'logos/tools/protocol-check.ts', 'x\n'));
    expect(s3.modules).toEqual(['core', 'portal-web']);
    expect(s3.reasons).toContainEqual({ module: 'core', source: 'path', ref: 'logos/tools/protocol-check.ts' });
    // ④ 前缀最长匹配：portal-web- 不误归 portal
    const s4 = arm(root => put(root, 'logos/resources/test/portal-web-S50-test-cases.md', table(['UT-S50-01', 'UT-S50-02'], '（改）')), [{ id: 'portal' }]);
    expect(s4.modules).toEqual(['portal-web']);
    expect(s4.reasons).toContainEqual({ module: 'portal-web', source: 'spec', ref: 'logos/resources/test/portal-web-S50-test-cases.md' });
  });

  it('UT-S13-111: 提案起点不可用即回落全量', () => {
    const fallbackCode = (r: ReturnType<typeof verifyJson>) => r.data.scope.fallback_reason;
    // ① 旧 guard 无 baseRef
    const r1 = project(); addProposal(r1, { baseRef: null }); put(r1, 'portal-web/app.ts', 'export const app = 2;\n');
    const v1 = verifyJson(r1);
    expect(v1.data.scope.mode).toBe('fallback-full');
    expect(fallbackCode(v1).code).toBe('base_ref_missing');
    expect(fallbackCode(v1).detail).not.toBe('');
    expect(v1.data.summary.defined_count).toBe(5);
    expect(v1.data.gate.result).toBe('PASS');
    // ② 非 git 仓库
    const r2 = project({ git: false }); addProposal(r2, { baseRef: null });
    const v2 = verifyJson(r2);
    expect(fallbackCode(v2).code).toBe('not_git_repository');
    expect(v2.data.summary.defined_count).toBe(5);
    // ③ baseRef 不可达
    const r3 = project(); addProposal(r3, { baseRef: '0123456789abcdef0123456789abcdef01234567' });
    const v3 = verifyJson(r3);
    expect(fallbackCode(v3).code).toBe('base_ref_unreachable');
    expect(v3.data.summary.defined_count).toBe(5);
    // ④ 差异计算失败（测试接缝注入 git 失败）
    const r4 = project(); addProposal(r4, {});
    const failingDiff: GitRunner = (root, args) => {
      if (args[0] === 'diff') return { status: 128, stdout: '' };
      const real = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      return { status: real.status, stdout: real.stdout ?? '' };
    };
    const s4 = resolveVerifyScope(r4, { git: failingDiff })!;
    expect(s4.mode).toBe('fallback-full');
    expect(s4.fallback_reason?.code).toBe('diff_failed');
    expect(s4.fallback_reason?.detail).not.toBe('');
    expect(s4.modules).toEqual(['core', 'portal-web']);
  });

  it('UT-S13-112: paths 非法即回落全量', () => {
    for (const bad of [['/abs/**'], ['../out/**'], [''], [3]]) {
      const root = project({ modules: [{ id: 'core', paths: bad }, { id: 'portal-web', paths: ['portal-web/**'] }] });
      addProposal(root, {});
      put(root, 'portal-web/app.ts', 'export const app = 2;\n');
      const run = verifyJson(root);
      expect(run.data.scope.mode, JSON.stringify(bad)).toBe('fallback-full');
      expect(run.data.scope.fallback_reason.code).toBe('module_paths_invalid');
      expect(run.data.scope.fallback_reason.detail).toContain('core');
      expect(run.data.scope.fallback_reason.detail).toContain(JSON.stringify(bad[0]));
      expect(run.data.gate.result).toBe('PASS');
      expect(run.status).toBe(0);
    }
  });

  it('UT-S13-113: 无活跃提案即回落全量', () => {
    const root = project();
    const run = verifyJson(root);
    expect(run.data.scope.mode).toBe('fallback-full');
    expect(run.data.scope.fallback_reason.code).toBe('no_active_change');
    expect(run.data.summary.defined_count).toBe(5);
  });
});

describe('S13 按模块限定 verify 范围 — 用例与结果核对（module-scoped-verify 切片2）', () => {
  it('UT-S13-114: 用例归属与两套提取器同口径（最长前缀匹配、全局始终计入）', () => {
    const root = project({
      modules: [{ id: 'core', paths: ['src/**'] }, { id: 'portal', paths: ['portal/**'] }, { id: 'portal-web', paths: ['portal-web/**'] }],
      tests: {
        'core-S01-test-cases.md': ['UT-S01-01', 'UT-S01-02'],
        'portal-web-S50-test-cases.md': ['UT-S50-01', 'UT-S50-02'],
        'portal-S60-test-cases.md': ['UT-S60-01'],
        'shared-S90-test-cases.md': ['UT-S90-01'],
      },
    });
    const scope: VerifyScopeData = { mode: 'module', modules: ['portal-web'], reasons: [], fallback_reason: null, out_of_scope_result_count: 0 };
    const inScope = computeInScopeIds(root, scope);
    const verifySide = extractDefinedIds(root).ids.filter(id => inScope.has(id));
    const sliceSide = extractDefinedVerificationIds(root).filter(id => inScope.has(id));
    expect(verifySide).toEqual(['UT-S50-01', 'UT-S50-02', 'UT-S90-01']);
    expect(sliceSide).toEqual(verifySide);
    // 范围为全部模块（all / fallback-full）时不过滤：两者都返回全部用例
    expect(extractDefinedIds(root).ids).toEqual(extractDefinedVerificationIds(root));
    expect(extractDefinedIds(root).ids).toHaveLength(6);
  });

  it('UT-S13-115: 范围外结果忽略（未定义 ID 照旧判定）', () => {
    const root = project();
    addProposal(root, {});
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    // 本轮运行器同一次运行输出 portal-web 与全局用例 pass，另输出 core 1 pass（UT-S01-02）、1 fail（UT-S01-01）与 1 条未定义 ID
    const coreRows = [{ id: 'UT-S01-01', status: 'fail', error: 'core 范围外失败' }, { id: 'UT-S01-02', status: 'pass' }];
    const env = { MSV_EXTRA_ROWS: JSON.stringify([...coreRows, { id: 'UT-S99-99', status: 'pass' }]) };
    const run = verifyJson(root, { env });
    expect(run.data.scope.modules).toEqual(['portal-web']);
    expect(run.data.gate.result).toBe('FAIL');
    expect(run.data.gate.reason).toBe('result_ledger_inconsistent');
    expect(run.data.consistency.unknown_result_ids).toEqual(['UT-S99-99']);
    expect(run.data.failed_cases).toEqual([]);
    expect(run.data.consistency.outside_eligible_result_ids).toEqual([]);
    expect(JSON.stringify(run.data.consistency)).not.toContain('UT-S01-0');
    expect(run.data.scope.out_of_scope_result_count).toBe(2);
    expect(run.data.summary.executed_count).toBe(4);
    // 去掉未定义 ID 后重跑 → PASS（core 的失败行仍被忽略）
    const rerun = verifyJson(root, { env: { MSV_EXTRA_ROWS: JSON.stringify(coreRows) } });
    expect(rerun.data.gate.result).toBe('PASS');
    expect(rerun.data.scope.out_of_scope_result_count).toBe(2);
    expect(rerun.data.summary).toMatchObject({ defined_count: 3, executed_count: 3, failed_count: 0 });

    // review code-r1 F1：范围外已知 ID 的非法行（缺 error / 缺 status / 非法 status）同样忽略并计数，不产生阻断诊断
    const badRows = (id: string) => [{ id, status: 'fail' }, { id }, { id, status: 'broken' }];
    const outOfScopeBad = verifyJson(root, { env: { MSV_EXTRA_ROWS: JSON.stringify(badRows('UT-S01-01')) } });
    expect(outOfScopeBad.data.gate.result).toBe('PASS');
    expect(outOfScopeBad.data.consistency.invalid_results).toEqual([]);
    expect(outOfScopeBad.data.scope.out_of_scope_result_count).toBe(3);
    // 同样的坏行换成范围内 ID、未定义 ID，或传 --all（不做范围裁剪）→ 仍按既有严格门禁失败
    for (const [label, id, args] of [['范围内', 'UT-S50-01', []], ['未定义', 'UT-S99-98', []], ['--all', 'UT-S01-01', ['--all']]] as const) {
      const strict = verifyJson(root, { args: [...args], env: { MSV_EXTRA_ROWS: JSON.stringify(badRows(id)) } });
      expect(strict.data.gate, label).toEqual({ result: 'FAIL', reason: 'result_ledger_inconsistent' });
      expect(strict.data.consistency.invalid_results.map((r: any) => r.reason).sort(), label)
        .toEqual(['invalid_status', 'missing_error', 'missing_status']);
    }
  });
});

describe('S13 按模块限定 verify 范围 — 切片求交（module-scoped-verify 切片2）', () => {
  /** 切片夹具：本提案变更测试与切片按参数构造，SPEC_MERGED.test_change_set 由 buildTestChangeSet 生成。 */
  function sliceFixture(opts: { changes: Record<string, string[]>; slices: string[][] }) {
    const root = project();
    const tasksLines = ['# 实现任务', '', '## [code] 代码实现',
      ...opts.slices.map((owned, i) => `- [ ] 切片 ${i + 1}：能力 ${i + 1}（覆盖 ${owned.join('、')}）`), ''];
    const deltas: Record<string, string> = {};
    for (const file of Object.keys(opts.changes)) deltas[`test/${file}`] = `## MODIFIED — 测试\n\n${table(opts.changes[file], '（改）')}`;
    const dir = addProposal(root, { slug: 'msv-slice', deltas, tasks: tasksLines.join('\n') });
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    const targets = Object.entries(opts.changes).map(([file, changedIds]) => {
      const targetPath = `logos/resources/test/${file}`;
      const beforeBytes = readFileSync(join(root, targetPath));
      const allIds = [...String(beforeBytes).matchAll(/^\| ((?:UT|ST)-S\d+-\d+) \|/gm)].map(m => m[1]);
      const after = ['| ID | 描述 |', '|---|---|', ...allIds.map(id => `| ${id} | ${id} 夹具用例${changedIds.includes(id) ? '（改）' : ''} |`)].join('\n') + '\n';
      put(root, targetPath, after);
      return { targetPath, beforeBytes, afterBytes: Buffer.from(after) };
    });
    const changeSet = buildTestChangeSet({ change: 'msv-slice', module: 'portal-web', targets });
    writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({ type: 'baseline_closure_spec_complete', test_change_set: changeSet }, null, 2)}\n`);
    writeFileSync(join(dir, 'SLICES_APPROVED'), '');
    const specTargets = targets.map(t => t.targetPath);
    const manifest: TestSliceManifestV1 = {
      schema: 'openlogos/test-slice-manifest@1', change: 'msv-slice', module: 'portal-web',
      task_fingerprint: computeTaskFingerprint(readFileSync(join(dir, 'tasks.md'), 'utf8')),
      spec_fingerprint: computeSpecFingerprint(root, specTargets),
      generated_at: '2026-10-18T00:00:00.000Z',
      slices: opts.slices.map((owned, i) => ({
        slice_id: `slice-0${i + 1}`, task_text: `切片 ${i + 1}：能力 ${i + 1}（覆盖 ${owned.join('、')}）`,
        owned_test_ids: [...owned].sort(), runner_selectors: [...owned].sort(), spec_targets: specTargets,
      })),
    };
    writeTestSliceManifestAtomic(join(dir, 'TEST_SLICE_MANIFEST.json'), manifest);
    return { root, dir, changeSet };
  }

  it('UT-S13-118: 切片集合与范围求交（变更测试保留，review F3）', () => {
    // 臂 ①（范围裁剪）：只改 portal-web；两个 portal-web 切片（单切片时切片验证按设计不启用，见 UT-S32-70）
    const a = sliceFixture({ changes: { 'portal-web-S50-test-cases.md': ['UT-S50-01', 'UT-S50-02'] }, slices: [['UT-S50-01'], ['UT-S50-02']] });
    const r1 = verifyJson(a.root);
    expect(r1.data.verify_mode).toBe('slice-checkpoint');
    expect(r1.data.scope.modules).toEqual(['portal-web']);
    expect(r1.data.eligible_test_ids).toEqual(['UT-S50-01', 'UT-S90-01']);
    expect(r1.data.eligible_test_ids).not.toContain('UT-S01-01');
    expect(r1.data.eligible_test_ids).not.toContain('UT-S01-02');
    expect(r1.calls.length).toBeGreaterThan(0);
    for (const call of r1.calls) expect(call.eligible).toEqual(r1.data.eligible_test_ids);
    expect(r1.data.gate.result).toBe('PASS');

    // 臂 ②（跨模块变更测试）：core 经 delta 前缀进入 M；slice-1 当前、slice-2 未来
    const b = sliceFixture({
      changes: { 'portal-web-S50-test-cases.md': ['UT-S50-01'], 'core-S01-test-cases.md': ['UT-S01-01'] },
      slices: [['UT-S50-01'], ['UT-S01-01']],
    });
    expect(b.changeSet.changed_test_ids).toEqual(['UT-S01-01', 'UT-S50-01']);
    const c1 = verifyJson(b.root);
    expect(c1.data.scope.modules).toEqual(['core', 'portal-web']);
    expect(c1.data.scope.reasons).toContainEqual({ module: 'core', source: 'delta', ref: 'deltas/test/core-S01-test-cases.md' });
    expect(c1.data.attempted_slice_id).toBe('slice-01');
    expect(c1.data.eligible_test_ids).toContain('UT-S50-01');
    expect(c1.data.pending_test_ids).toEqual(['UT-S01-01']);
    expect(c1.data.gate.result).toBe('PASS');
    const c2 = verifyJson(b.root);
    expect(c2.data.attempted_slice_id).toBe('slice-02');
    expect(c2.data.eligible_test_ids).toContain('UT-S01-01');
    expect(c2.data.gate.result).toBe('PASS');
    const tasksPath = join(b.dir, 'tasks.md');
    writeFileSync(tasksPath, readFileSync(tasksPath, 'utf8').replace(/- \[ \]/g, '- [x]'));
    const fin = verifyJson(b.root);
    expect(fin.data.verify_mode).toBe('final');
    expect(fin.data.eligible_test_ids).toEqual(['UT-S01-01', 'UT-S01-02', 'UT-S50-01', 'UT-S50-02', 'UT-S90-01']);
    expect(fin.calls.length).toBeGreaterThan(0);
    for (const call of fin.calls) expect(call.eligible).toEqual(fin.data.eligible_test_ids);
    expect(fin.data.gate.result).toBe('PASS');
  });
});

describe('S13 按模块限定 verify 范围 — JSON 与报告（module-scoped-verify 切片2）', () => {
  let schemaId: string;
  beforeAll(() => {
    const schema = JSON.parse(readFileSync(join(REPO, 'spec/schema/verify.schema.json'), 'utf8'));
    expect(schema.properties.scope).toBeDefined();
    schemaId = schema.$id;
    try { registerSchema(schema); } catch { /* 同一 worker 内已注册 */ }
  });

  it('UT-S13-119: JSON scope 结构符合 verify.schema.json；报告「范围」行；未启用时二者都不出现', async () => {
    const keys = ['fallback_reason', 'mode', 'modules', 'out_of_scope_result_count', 'reasons'];
    const check = async (run: ReturnType<typeof verifyJson>, mode: string, row: string) => {
      const output = await validate(schemaId, run.data);
      expect(output.valid, `${mode}: ${JSON.stringify(output).slice(0, 400)}`).toBe(true);
      expect(Object.keys(run.data.scope).sort()).toEqual(keys);
      expect(run.data.scope.mode).toBe(mode);
      expect(scopeRow(run.report)).toBe(row);
    };
    // module（UT-S13-106 夹具）
    const m = project({ modules: [{ id: 'core', paths: ['src/**'] }, { id: 'portal-web', paths: ['portal-web/**'] }, { id: 'portal-server' }] });
    addProposal(m, { slug: 'srv', module: 'portal-server', deltas: { 'test/portal-web-S50-test-cases.md': `## MODIFIED — 测试\n\n${table(['UT-S50-01'])}` } });
    put(m, 'src/protocol.ts', 'export const v = 2;\n');
    await check(verifyJson(m), 'module', '| Scope | module（core, portal-web, portal-server） |');
    // all（缺省夹具，只改 portal-web）
    const a = project(); addProposal(a, {}); put(a, 'portal-web/app.ts', 'export const app = 2;\n');
    await check(verifyJson(a, { args: ['--all'] }), 'all', '| Scope | all |');
    // fallback-full（改动归不到模块）
    const f = project(); addProposal(f, {}); put(f, 'scripts/release.sh', 'echo\n');
    const fr = verifyJson(f);
    await check(fr, 'fallback-full', '| Scope | fallback-full（unmapped_file：scripts/release.sh 等 1 个文件） |');
    expect(fr.data.scope.fallback_reason).toEqual({ code: 'unmapped_file', detail: 'scripts/release.sh 等 1 个文件' });
    // 未启用（无 paths）
    const d = project({ modules: [{ id: 'core' }, { id: 'portal-web' }] }); addProposal(d, {});
    const dr = verifyJson(d);
    expect((await validate(schemaId, dr.data)).valid).toBe(true);
    expect('scope' in dr.data).toBe(false);
    expect(scopeRow(dr.report)).toBeNull();
  });
});
