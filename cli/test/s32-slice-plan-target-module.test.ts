/**
 * verify-scope-fields-and-slice-module 切片 1：切片规划的目标提案与模块（openlogos #7，功能规格 §2.110、§2.78.3）。
 * 用例 ID 与 logos/resources/test/core-S32-test-cases.md「S32 切片规划的目标提案与模块测试」严格对齐：UT-S32-126～134。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 夹具 SM 见 golden/s32-slice-plan-fixture.mjs：提案登记在 backend 的多模块项目，变更用例 UT-S05-03、04、05；
 * 提案名取 S13 夹具的固定值（SLUG），对应测试规格中的 sm-demo。全部命令以构建后的 CLI 在夹具项目根执行。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { SLUG, destroyLv, runVerify } from './golden/s13-layered-fixture.mjs';
import {
  CORE_TARGET, SM_TARGET, createCore, createSm, manifestPath, normalizePlan, observeCorePlan, readManifest,
  runSlicePlan, sliceInput, tasksPath, writeSlices,
} from './golden/s32-slice-plan-fixture.mjs';

vi.setConfig({ testTimeout: 180_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(resolve(HERE, '..'), 'dist', 'index.js');
const GOLDEN = join(HERE, 'golden', 's32-slice-plan-core-baseline.json');
const PLAN = ['--file', 'slices.json', '--format', 'json'];

type Fx = ReturnType<typeof createSm>;
const made: Fx[] = [];
afterEach(() => { while (made.length) destroyLv(made.pop()!); });
const sm = (opts: Record<string, any> = {}): Fx => { const f = createSm(buildTestChangeSet, opts); made.push(f); return f; };
const core = (opts: Record<string, any> = {}): Fx => { const f = createCore(buildTestChangeSet, opts); made.push(f); return f; };

const sha = (path: string): string | null => (existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null);
const guardPath = (f: Fx) => join(f.root, 'logos/.openlogos-guard');
const readGuard = (f: Fx): Record<string, unknown> => JSON.parse(readFileSync(guardPath(f), 'utf8'));
const writeGuard = (f: Fx, guard: Record<string, unknown>) => writeFileSync(guardPath(f), JSON.stringify(guard, null, 2));
const listDir = (dir: string): string[] => readdirSync(dir).sort();
const checkpoints = (f: Fx): any[] => {
  const path = join(f.proposalDir!, 'SLICE_CHECKPOINTS.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
};
/** 批准切片划分后执行 verify（切片输入文件先删掉，避免它作为未归属文件影响模块范围）。 */
function approveAndVerify(f: Fx) {
  rmSync(join(f.root, 'slices.json'), { force: true });
  rmSync(join(f.root, 'slices-missing.json'), { force: true });
  writeFileSync(join(f.proposalDir!, 'SLICES_APPROVED'), '');
  return runVerify(CLI, f);
}
const violationCodes = (data: any): string[] => JSON.stringify(data ?? {}).match(/test-slice-[a-z-]+/g) ?? [];

describe('S32 切片规划的目标提案与模块', () => {
  it('UT-S32-126: 非 core 模块提案的清单模块等于提案模块', () => {
    const f = sm();
    const run = runSlicePlan(CLI, f, PLAN);
    expect(run.status).toBe(0);
    expect(run.out.data.slice_ids).toEqual(['slice-a', 'slice-b']);
    const manifest = readManifest(f);
    expect(manifest.change).toBe(SLUG);
    expect(manifest.module).toBe('backend');
    const tasks = readFileSync(tasksPath(f), 'utf8');
    expect(tasks).toContain('- [ ] 切片1：能力 a（覆盖 UT-S05-03）');
    expect(tasks).toContain('- [ ] 切片2：能力 b（覆盖 UT-S05-04、UT-S05-05）');
  });

  it('UT-S32-127: 规划后的验收不再判清单无效', () => {
    const f = sm();
    expect(runSlicePlan(CLI, f, PLAN).status).toBe(0);
    const run = approveAndVerify(f);
    expect(violationCodes(run.data)).not.toContain('test-slice-manifest-invalid');
    expect(run.data.verify_mode).toBe('slice-checkpoint');
    expect(run.data.attempted_slice_id).toBe('slice-a');
    expect(run.data.eligible_test_ids).toContain('UT-S05-03');
    expect(run.data.gate.result).toBe('PASS');
    expect(checkpoints(f).map(r => [r.slice_id, r.result])).toEqual([['slice-a', 'PASS']]);
  });

  it('UT-S32-128: 读取测试变更集与校验使用同一个模块', () => {
    const f = sm();
    const before = sha(tasksPath(f));
    // ① 两个合法切片，第三条变更用例 UT-S05-05 无人认领：切片验证启用，写入者读取变更集并做归属对账
    writeSlices(f, 'slices-missing.json', sliceInput(['UT-S05-03'], ['UT-S05-04'], SM_TARGET));
    const missing = runSlicePlan(CLI, f, ['--file', 'slices-missing.json', '--format', 'json']);
    expect(missing.status).toBe(1);
    expect(missing.stdout.trim()).toBe('');
    expect(missing.err.error.code).toBe('SLICE_PLAN_UNKNOWN_TEST_ID');
    const hit = (missing.err.violations as any[]).filter(v => v.code === 'test-slice-test-id-missing');
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain('UT-S05-05');
    expect(sha(tasksPath(f))).toBe(before);
    expect(existsSync(manifestPath(f))).toBe(false);
    // ② 完整输入：成功，没有模块相关违规
    const full = runSlicePlan(CLI, f, PLAN);
    expect(full.status).toBe(0);
    expect(full.stderr).not.toContain('$.module');
    expect(readManifest(f).module).toBe('backend');
  });

  it('UT-S32-129: --slug 指向另一个提案时拒绝且不改文件', () => {
    const f = sm();
    // 第二个提案 other-demo：登记在 backend、已合并、有 tasks.md，并预置一份旧清单；guard 仍指向活跃提案
    const otherDir = join(f.root, 'logos/changes/other-demo');
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, 'tasks.md'), readFileSync(tasksPath(f), 'utf8'));
    writeFileSync(join(otherDir, 'SPEC_MERGED'), readFileSync(join(f.proposalDir!, 'SPEC_MERGED'), 'utf8').split(`"${SLUG}"`).join('"other-demo"'));
    writeFileSync(join(otherDir, 'TEST_SLICE_MANIFEST.json'), '{"schema":"openlogos/test-slice-manifest@1","note":"old"}\n');
    const otherTasks = sha(tasksPath(f, 'other-demo'));
    const otherManifest = sha(manifestPath(f, 'other-demo'));
    const otherFiles = listDir(otherDir);
    const activeTasks = sha(tasksPath(f));
    const activeFiles = listDir(f.proposalDir!);

    const run = runSlicePlan(CLI, f, ['--slug', 'other-demo', ...PLAN]);
    expect(run.status).toBe(1);
    expect(run.stdout.trim()).toBe('');
    expect(run.err.command).toBe('slice plan');
    expect(run.err.error.code).toBe('SLICE_PLAN_NO_ACTIVE_CHANGE');
    expect(run.err.error.message).toContain('other-demo');
    expect(run.err.error.message).toContain(SLUG);
    expect(run.err.violations).toBeUndefined();
    expect(sha(tasksPath(f, 'other-demo'))).toBe(otherTasks);
    expect(sha(manifestPath(f, 'other-demo'))).toBe(otherManifest);
    expect(listDir(otherDir)).toEqual(otherFiles);
    expect(sha(tasksPath(f))).toBe(activeTasks);
    expect(listDir(f.proposalDir!)).toEqual(activeFiles);
    expect(existsSync(manifestPath(f))).toBe(false);
  });

  it('UT-S32-130: 没有 guard 或 guard 无法解析时带 --slug 同样拒绝', () => {
    const arms: Array<(f: Fx) => void> = [
      f => rmSync(guardPath(f)),
      f => writeFileSync(guardPath(f), '{ broken'),
      f => { const g = readGuard(f); delete g.activeChange; writeGuard(f, g); },
    ];
    for (const arrange of arms) {
      const f = sm();
      arrange(f);
      const before = sha(tasksPath(f));
      const run = runSlicePlan(CLI, f, ['--slug', SLUG, ...PLAN]);
      expect(run.status).toBe(1);
      expect(run.err.error.code).toBe('SLICE_PLAN_NO_ACTIVE_CHANGE');
      expect(run.err.error.message).toContain(SLUG);
      expect(run.err.error.message).toContain('没有活跃提案');
      expect(sha(tasksPath(f))).toBe(before);
      expect(existsSync(manifestPath(f))).toBe(false);
    }
  });

  it('UT-S32-131: --slug 等于活跃提案时与不传相同', () => {
    const f = sm();
    const original = readFileSync(tasksPath(f), 'utf8');
    const a = runSlicePlan(CLI, f, PLAN);
    const first = normalizePlan(f, a);
    // 还原到规划前
    writeFileSync(tasksPath(f), original);
    rmSync(manifestPath(f));
    const b = runSlicePlan(CLI, f, ['--slug', SLUG, ...PLAN]);
    const second = normalizePlan(f, b);
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    expect(second.tasks).toBe(first.tasks);
    expect(second.manifest).toEqual(first.manifest);
    expect(second.manifest.module).toBe('backend');
  });

  it('UT-S32-132: guard 缺 module 字段时取 core', () => {
    const f = core();
    const guard = readGuard(f);
    delete guard.module;
    writeGuard(f, guard);
    const run = runSlicePlan(CLI, f, PLAN);
    expect(run.status).toBe(0);
    expect(readManifest(f).module).toBe('core');
    expect(readManifest(f).slices.map((s: any) => s.spec_targets)).toEqual([[CORE_TARGET], [CORE_TARGET]]);
  });

  it('UT-S32-133: core 模块提案的产物与引入前一致', () => {
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
    const now = observeCorePlan(CLI, buildTestChangeSet);
    expect(now.status).toBe(0);
    expect(now.tasks).toBe(golden.tasks);
    expect(now.manifest).toEqual(golden.manifest);
    expect(now.manifest.module).toBe('core');
    expect(now.data).toEqual(golden.data);
  });

  it('UT-S32-134: guard 的 module 带首尾空白时写入与读取一致', () => {
    const f = sm();
    writeGuard(f, { ...readGuard(f), module: ' backend ' });
    // ① 写入侧去掉首尾空白
    expect(runSlicePlan(CLI, f, PLAN).status).toBe(0);
    expect(readManifest(f).module).toBe('backend');
    // ② 读取侧：切片状态派生、范围计算、门禁的严格跳过集合都接受同一份清单与测试变更集
    const run = approveAndVerify(f);
    expect(violationCodes(run.data)).not.toContain('test-slice-manifest-invalid');
    expect(run.data.verify_mode).toBe('slice-checkpoint');
    expect(run.data.attempted_slice_id).toBe('slice-a');
    expect(run.data.eligible_test_ids).toContain('UT-S05-03');
    expect(run.data.pending_test_ids).toEqual(expect.arrayContaining(['UT-S05-04', 'UT-S05-05']));
    expect(run.data.gate.result).toBe('PASS');
    expect(run.data.gate.reason).not.toBe('test_change_set_invalid');
    expect(checkpoints(f).map(r => [r.slice_id, r.result])).toEqual([['slice-a', 'PASS']]);
  });
});
