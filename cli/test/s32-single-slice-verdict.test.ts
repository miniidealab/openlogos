/**
 * 切片1：终态守门三分支判据与文案（fix-apply-verdict-not-applicable-vs-invalid）。
 * 覆盖 UT-S32-61～UT-S32-64、ST-S32-21。
 *
 * 缺陷背景：0.14.12 的守门判据 `verdict.status !== 'valid'` 把「判定器给出负面结论」与
 * 「判定器按设计不适用」（单切片计划下 shouldUseSliceVerification 恒假、返回 null）合并成
 * 同一失败分支——所有单切片提案的 apply 必然整体回滚，错误信息「判为 unknown，已整体回滚：
 * 0 条违规」。0 条违规正是判定器根本没运行的特征。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import {
  TestSliceTransactionError, applyTestSliceTransaction, createTestSliceTransaction,
  ensureManifestRecoveryTransaction, readTestSliceTransactionIfPresent,
  sealTestSliceTransaction, submitTestSliceContent,
} from '../src/lib/test-slice-transaction.js';
import { deriveSliceVerificationState } from '../src/lib/test-slice-manifest.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'stx-single';
const SPEC_REL = 'logos/resources/test/core-S01-test-cases.md';
const OTHER_DOC = 'logos/resources/prd/3-technical-plan/core-01-architecture.md';

const SINGLE_CODE_BODY = '- [ ] 单切片：完整任务文本（覆盖 UT-S01-01、UT-S01-02）';
const SINGLE_SLICES = [
  { slice_id: 'slice-01-single', task_text: '单切片：完整任务文本（覆盖 UT-S01-01、UT-S01-02）', owned_test_ids: ['UT-S01-01', 'UT-S01-02'], runner_selectors: ['UT-S01-01', 'UT-S01-02'], spec_targets: [SPEC_REL] },
];
const DOUBLE_CODE_BODY = '- [ ] 切片1：第一片完整任务文本（覆盖 UT-S01-01）\n- [ ] 切片2：第二片完整任务文本（覆盖 UT-S01-02）';
const DOUBLE_VALID = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片完整任务文本（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [SPEC_REL] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片完整任务文本（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [SPEC_REL] },
];
const DOUBLE_INVALID = DOUBLE_VALID.map(s => ({ ...s, task_text: `${s.slice_id} 简称`, spec_targets: [OTHER_DOC] }));
const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', '- [ ] 实现代码变更', '',
  '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
].join('\n');

function setup() {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
  }));
  mkdirSync(join(root, 'logos', 'resources', 'test'), { recursive: true });
  mkdirSync(join(root, 'logos', 'resources', 'prd', '3-technical-plan'), { recursive: true });
  const before = Buffer.from(['| ID | 描述 |', '|---|---|', ''].join('\n'), 'utf8');
  const after = Buffer.from(['| ID | 描述 |', '|---|---|', '| UT-S01-01 | a |', '| UT-S01-02 | b |', ''].join('\n'), 'utf8');
  writeFileSync(join(root, SPEC_REL), after);
  writeFileSync(join(root, OTHER_DOC), '# 架构\n\n这不是测试规格文档。\n');
  const dir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
    type: 'merge_transaction_complete', transaction_id: 'mtx_fixture', seal_sha256: null,
    receipt_sha256: null, completed_at: new Date().toISOString(),
    test_change_set: buildTestChangeSet({
      change: SLUG, module: 'core',
      targets: [{ targetPath: SPEC_REL, beforeBytes: before, afterBytes: after }],
    }),
  }));
  writeFileSync(join(dir, 'tasks.md'), TASKS);
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  const write = (name: string, value: unknown) => {
    const p = join(root, name);
    writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
    return p;
  };
  return {
    root, dir,
    singleCode: write('code-single.txt', SINGLE_CODE_BODY),
    singleSlices: write('slices-single.json', SINGLE_SLICES),
    doubleCode: write('code-double.txt', DOUBLE_CODE_BODY),
    doubleValid: write('slices-double-valid.json', DOUBLE_VALID),
    doubleInvalid: write('slices-double-invalid.json', DOUBLE_INVALID),
    tasksPath: join(dir, 'tasks.md'),
    manifestPath: join(dir, 'TEST_SLICE_MANIFEST.json'),
    txPath: join(dir, 'TEST_SLICE_TRANSACTION.json'),
  };
}

function driveTo(fx: ReturnType<typeof setup>, codeFile: string, slicesFile: string) {
  if (!readTestSliceTransactionIfPresent(fx.dir)) createTestSliceTransaction(fx.root, fx.dir, SLUG);
  submitTestSliceContent(fx.dir, 'slot_codesection', codeFile);
  submitTestSliceContent(fx.dir, 'slot_slices', slicesFile);
  sealTestSliceTransaction(fx.dir);
}

describe('S32 终态守门三分支与单切片解阻断', () => {
  it('UT-S32-61: 单切片计划 apply 达 completed，[code] 正确写出、manifest 惰性落盘', () => {
    const fx = setup();
    driveTo(fx, fx.singleCode, fx.singleSlices);
    const tasksBefore = readFileSync(fx.tasksPath, 'utf-8');

    const done = applyTestSliceTransaction(fx.root, fx.dir);
    expect(done.phase, '单切片 apply 必须 completed——回滚即被修复的缺陷').toBe('completed');
    expect(done.receipt).not.toBeNull();
    expect(done.violations).toEqual([]);

    const tasksAfter = readFileSync(fx.tasksPath, 'utf-8');
    expect(tasksAfter).toContain('单切片：完整任务文本（覆盖 UT-S01-01、UT-S01-02）');
    // [delta] / [deploy] 段字节恒等（整节守恒）
    expect(tasksAfter.split('## [code]')[0]).toBe(tasksBefore.split('## [code]')[0]);
    expect(tasksAfter.split('## [deploy]')[1]).toBe(tasksBefore.split('## [deploy]')[1]);
    expect(existsSync(fx.manifestPath), 'manifest 作为惰性产物应落盘').toBe(true);
    // 单切片下判定器按设计不适用——惰性 manifest 不改变消费者行为
    expect(deriveSliceVerificationState(fx.root, fx.dir)).toBeNull();
  });

  it('UT-S32-62: 三种判定结果去向矩阵（null/valid 放行，负面结论整体回滚）', () => {
    // ① 单切片（判定器不适用 → null）→ completed
    const a = setup();
    driveTo(a, a.singleCode, a.singleSlices);
    expect(applyTestSliceTransaction(a.root, a.dir).phase).toBe('completed');

    // ② 两切片全部合法（valid）→ completed
    const b = setup();
    driveTo(b, b.doubleCode, b.doubleValid);
    expect(applyTestSliceTransaction(b.root, b.dir).phase).toBe('completed');
    expect(deriveSliceVerificationState(b.root, b.dir)?.manifest_status).toBe('valid');

    // ③ 两切片但业务非法（invalid）→ 整体回滚 failed + recovery_required，violations 保真
    const c = setup();
    driveTo(c, c.doubleCode, c.doubleInvalid);
    const tasksBefore = readFileSync(c.tasksPath, 'utf-8');
    let caught: TestSliceTransactionError | null = null;
    try { applyTestSliceTransaction(c.root, c.dir); } catch (e) { caught = e as TestSliceTransactionError; }
    expect(caught, '业务非法 slot 必须仍被拦下——放宽不得越界').not.toBeNull();
    expect(caught!.code).toBe('apply_verification_failed');
    expect(readFileSync(c.tasksPath, 'utf-8')).toBe(tasksBefore);
    expect(existsSync(c.manifestPath)).toBe(false);
    const tx = readTestSliceTransactionIfPresent(c.dir)!;
    expect(tx.phase).toBe('failed');
    expect(tx.classification).toBe('recovery_required');
    for (const v of caught!.violations) {
      expect(v).toHaveProperty('code'); expect(v).toHaveProperty('path');
      expect(v).toHaveProperty('message'); expect(v).toHaveProperty('fix_hint');
    }
  });

  it('UT-S32-63: 失败文案不出现 unknown，失败终态必伴随非零违规', () => {
    const fx = setup();
    driveTo(fx, fx.doubleCode, fx.doubleInvalid);
    let caught: TestSliceTransactionError | null = null;
    try { applyTestSliceTransaction(fx.root, fx.dir); } catch (e) { caught = e as TestSliceTransactionError; }
    expect(caught).not.toBeNull();
    expect(caught!.message, '文案不得渲染 unknown').not.toContain('unknown');
    expect(caught!.message).toContain('invalid');
    expect(caught!.violations.length, '失败终态必伴随非零违规——0 条违规意味着判定器没运行').toBeGreaterThan(0);
    // 证伪门：守门若改回 status !== 'valid'，单切片放行断言（UT-S32-61/62①）必同时变红，
    // 且此处「unknown + 0 条违规」组合将复现——源级锚定三分支实现在场。
    const src = readFileSync(resolve(__dirname, '..', 'src/lib/test-slice-transaction.ts'), 'utf-8');
    expect(src).toContain("verdict.status === null");
    expect(src).not.toContain("verdict.status ?? 'unknown'");
  });

  it('UT-S32-64: 恢复语义按适用性分流——多切片终态不堵恢复不回归；单切片无恢复需求即不产生恢复事务', () => {
    // 多切片：completed 后 manifest 失效 → 仍可创建 manifest-recovery（0.14.12 能力不回退）
    const b = setup();
    driveTo(b, b.doubleCode, b.doubleValid);
    expect(applyTestSliceTransaction(b.root, b.dir).phase).toBe('completed');
    const frozen = readFileSync(b.tasksPath, 'utf-8');
    rmSync(b.manifestPath, { force: true });
    expect(existsSync(b.txPath), '事务文件必须仍在场').toBe(true);
    const recovery = ensureManifestRecoveryTransaction(b.root, b.dir, SLUG);
    expect(recovery).not.toBeNull();
    expect(recovery!.origin).toBe('manifest-recovery');
    expect(recovery!.content_slots.required).toBe(1);
    expect(readFileSync(b.tasksPath, 'utf-8'), '[code] 段冻结').toBe(frozen);

    // 单切片：判定器按设计不适用（derive 恒 null）→ manifest 惰性，删除后无恢复需求，
    // canonical 判定不产生恢复事务——这不是堵塞，而是「无需恢复」的正确形态。
    const a = setup();
    driveTo(a, a.singleCode, a.singleSlices);
    expect(applyTestSliceTransaction(a.root, a.dir).phase).toBe('completed');
    rmSync(a.manifestPath, { force: true });
    expect(deriveSliceVerificationState(a.root, a.dir)).toBeNull();
    const none = ensureManifestRecoveryTransaction(a.root, a.dir, SLUG);
    expect(none, '单切片下不产生恢复事务（无恢复理由）').toBeNull();
  });

  it('ST-S32-21: 真实 CLI 单切片全链达 completed，多切片健康与业务非法行为零回归', () => {
    const run = (fx: ReturnType<typeof setup>, args: string[]) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: fx.root, encoding: 'utf8', timeout: 60000,
    });
    const chain = (fx: ReturnType<typeof setup>, code: string, slices: string) => {
      run(fx, ['slice', 'transaction', 'submit-content', '--slot', 'slot_codesection', '--file', code]);
      run(fx, ['slice', 'transaction', 'submit-content', '--slot', 'slot_slices', '--file', slices]);
      run(fx, ['slice', 'transaction', 'seal']);
      return run(fx, ['slice', 'transaction', 'apply', '--format', 'json']);
    };

    // A：单切片全链（真实 CLI）→ completed，[code] 正确写出，输出不含 unknown
    const a = setup();
    const appliedA = chain(a, a.singleCode, a.singleSlices);
    expect(appliedA.status, `单切片 apply 必须零退出：${appliedA.stderr.slice(0, 300)}`).toBe(0);
    expect(`${appliedA.stdout}${appliedA.stderr}`).not.toContain('unknown');
    expect(readFileSync(a.tasksPath, 'utf-8')).toContain('单切片：完整任务文本');
    expect(existsSync(a.manifestPath)).toBe(true);
    const statusA = run(a, ['slice', 'transaction', 'status', '--format', 'json']);
    expect(JSON.parse(statusA.stdout).data?.phase ?? JSON.parse(statusA.stdout).data?.transaction?.phase).toBe('completed');

    // B：多切片健康全链 → completed（零回归）
    const b = setup();
    const appliedB = chain(b, b.doubleCode, b.doubleValid);
    expect(appliedB.status).toBe(0);

    // B2：业务非法 slot 仍整体回滚且 violations 保真（零回归）
    const c = setup();
    const appliedC = chain(c, c.doubleCode, c.doubleInvalid);
    expect(appliedC.status).not.toBe(0);
    const envelope = JSON.parse(appliedC.stderr.trim()) as {
      error: { details: { classification: string; violations: Array<Record<string, string>> } };
    };
    expect(envelope.error.details.classification).toBe('apply_verification_failed');
    expect(envelope.error.details.violations.length).toBeGreaterThan(0);
    // 守门文案不渲染 unknown（violations 里的诊断码 test-slice-test-id-unknown 是合法 ID 语法，不在此列）
    expect((envelope as { error: { message: string } }).error.message).not.toContain('unknown');
    expect((envelope as { error: { message: string } }).error.message).toContain('invalid');
    expect(existsSync(c.manifestPath)).toBe(false);
  });
});
