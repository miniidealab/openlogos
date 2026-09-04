/**
 * 单切片：受控重划回边（support-slice-replan-on-completed-plan）。
 * 覆盖 UT-S32-65～UT-S32-68、ST-S32-22、UT-S28-49。
 *
 * 缺口背景：completed 的 allowed_actions 为空数组——终态即永久冻结；manifest 完全有效时
 * manifest-recovery 回边不触发，「规划本身需重做」没有任何合法出口（架构 §四十四.1）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import {
  SLICE_REPLANS_FILE, TestSliceTransactionError, applyTestSliceTransaction,
  createTestSliceTransaction, readTestSliceTransactionIfPresent, reopenTestSliceTransaction,
  sealTestSliceTransaction, submitTestSliceContent,
} from '../src/lib/test-slice-transaction.js';
import { deriveSliceVerificationState } from '../src/lib/test-slice-manifest.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { replanHintFor } from '../src/commands/next.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'stx-replan';
const SPEC_REL = 'logos/resources/test/core-S01-test-cases.md';

const PLAN_A_CODE = '- [ ] 切片1：第一片完整任务文本（覆盖 UT-S01-01）\n- [ ] 切片2：第二片完整任务文本（覆盖 UT-S01-02）';
const PLAN_A = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片完整任务文本（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [SPEC_REL] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片完整任务文本（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [SPEC_REL] },
];
const PLAN_B_CODE = '- [ ] 重划后单切片：合并后的完整任务文本（覆盖 UT-S01-01、UT-S01-02）';
const PLAN_B = [
  { slice_id: 'slice-01-merged', task_text: '重划后单切片：合并后的完整任务文本（覆盖 UT-S01-01、UT-S01-02）', owned_test_ids: ['UT-S01-01', 'UT-S01-02'], runner_selectors: ['UT-S01-01', 'UT-S01-02'], spec_targets: [SPEC_REL] },
];
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
  const before = Buffer.from(['| ID | 描述 |', '|---|---|', ''].join('\n'), 'utf8');
  const after = Buffer.from(['| ID | 描述 |', '|---|---|', '| UT-S01-01 | a |', '| UT-S01-02 | b |', ''].join('\n'), 'utf8');
  writeFileSync(join(root, SPEC_REL), after);
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
    codeA: write('code-a.txt', PLAN_A_CODE), slicesA: write('slices-a.json', PLAN_A),
    codeB: write('code-b.txt', PLAN_B_CODE), slicesB: write('slices-b.json', PLAN_B),
    tasksPath: join(dir, 'tasks.md'),
    manifestPath: join(dir, 'TEST_SLICE_MANIFEST.json'),
    txPath: join(dir, 'TEST_SLICE_TRANSACTION.json'),
    auditPath: join(dir, SLICE_REPLANS_FILE),
    markerPath: join(dir, 'SLICES_APPROVED'),
  };
}

function planTo(fx: ReturnType<typeof setup>, code: string, slices: string) {
  if (!readTestSliceTransactionIfPresent(fx.dir)) createTestSliceTransaction(fx.root, fx.dir, SLUG);
  submitTestSliceContent(fx.dir, 'slot_codesection', code);
  submitTestSliceContent(fx.dir, 'slot_slices', slices);
  sealTestSliceTransaction(fx.dir);
  return applyTestSliceTransaction(fx.root, fx.dir);
}

describe('S32 已完成规划的受控重划', () => {
  it('UT-S32-65: 重开准入矩阵（批准分流；原因非空为前置）', () => {
    // ① 未批准：自由重开
    const a = setup();
    expect(planTo(a, a.codeA, a.slicesA).phase).toBe('completed');
    const reopened = reopenTestSliceTransaction(a.root, a.dir, SLUG, { reason: '规划证伪' });
    expect(reopened.phase).toBe('collecting');
    expect(reopened.origin).toBe('initial-plan');
    expect(reopened.content_slots.required).toBe(2);

    // ② 已批准未确认：拒绝且零副作用
    const b = setup();
    expect(planTo(b, b.codeA, b.slicesA).phase).toBe('completed');
    writeFileSync(b.markerPath, JSON.stringify({ approved: true }));
    let caught: TestSliceTransactionError | null = null;
    try { reopenTestSliceTransaction(b.root, b.dir, SLUG, { reason: '规划证伪' }); }
    catch (e) { caught = e as TestSliceTransactionError; }
    expect(caught!.code).toBe('reopen_confirm_required');
    expect(caught!.message).toContain('--confirm-approved');   // 可执行指引
    expect(existsSync(b.auditPath), '拒绝路径不得留痕').toBe(false);
    expect(existsSync(b.markerPath)).toBe(true);
    expect(readTestSliceTransactionIfPresent(b.dir)!.phase).toBe('completed');

    // ③ 已批准 + 确认：重开成功且批准被作废
    const done = reopenTestSliceTransaction(b.root, b.dir, SLUG, { reason: '规划证伪', confirmApproved: true });
    expect(done.phase).toBe('collecting');
    expect(existsSync(b.markerPath), '确认重开须作废 SLICES_APPROVED').toBe(false);
    const audit = JSON.parse(readFileSync(b.auditPath, 'utf8').trim());
    expect(audit).toMatchObject({ slices_approved_present: true, confirmed: true });

    // 原因缺失/空白一律拒绝
    const c = setup();
    expect(planTo(c, c.codeA, c.slicesA).phase).toBe('completed');
    for (const reason of ['', '   ']) {
      let r: TestSliceTransactionError | null = null;
      try { reopenTestSliceTransaction(c.root, c.dir, SLUG, { reason }); }
      catch (e) { r = e as TestSliceTransactionError; }
      expect(r!.code).toBe('reopen_reason_required');
    }
    expect(existsSync(c.auditPath)).toBe(false);
  });

  it('UT-S32-66: 留痕字段与 append-only', () => {
    const fx = setup();
    expect(planTo(fx, fx.codeA, fx.slicesA).phase).toBe('completed');
    const firstId = readTestSliceTransactionIfPresent(fx.dir)!.transaction_id;
    reopenTestSliceTransaction(fx.root, fx.dir, SLUG, { reason: '第一次证伪' });
    const firstLine = readFileSync(fx.auditPath, 'utf8');
    expect(planTo(fx, fx.codeB, fx.slicesB).phase).toBe('completed');
    const secondId = readTestSliceTransactionIfPresent(fx.dir)!.transaction_id;
    reopenTestSliceTransaction(fx.root, fx.dir, SLUG, { reason: '第二次证伪' });

    const lines = readFileSync(fx.auditPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      schema: 'openlogos/slice-replan@1', old_transaction_id: firstId,
      reason: '第一次证伪', slices_approved_present: false, confirmed: false,
    });
    expect(typeof lines[0].reopened_at).toBe('string');
    expect(lines[1].old_transaction_id).toBe(secondId);
    // append-only：首行在第二次重开后字节不变
    expect(readFileSync(fx.auditPath, 'utf8').startsWith(firstLine)).toBe(true);
  });

  it('UT-S32-67: 产物整体替换与旧证据作废', () => {
    const fx = setup();
    expect(planTo(fx, fx.codeA, fx.slicesA).phase).toBe('completed');
    const oldId = readTestSliceTransactionIfPresent(fx.dir)!.transaction_id;
    const oldManifest = readFileSync(fx.manifestPath, 'utf8');
    // 与旧 manifest 匹配的 PASS checkpoint
    const oldManifestSha = `sha256:${require('node:crypto').createHash('sha256').update(oldManifest).digest('hex')}`;
    writeFileSync(join(fx.dir, 'SLICE_CHECKPOINTS.jsonl'), `${JSON.stringify({
      schema: 'openlogos/slice-checkpoint@1', slice_id: 'slice-01-a',
      manifest_sha256: oldManifestSha, result: 'PASS',
      eligible_test_ids_sha256: 'sha256:x', timestamp: new Date().toISOString(),
    })}\n`);

    reopenTestSliceTransaction(fx.root, fx.dir, SLUG, { reason: '规划证伪' });
    // 重开后、apply 前：两产物保持旧值（无半新半旧窗口）
    expect(readFileSync(fx.tasksPath, 'utf8')).toContain('切片1：第一片完整任务文本');
    expect(readFileSync(fx.manifestPath, 'utf8')).toBe(oldManifest);
    // 旧事务归档且 receipt 可读
    const archivedPath = join(fx.dir, 'slice-transactions', `${oldId}.json`);
    expect(existsSync(archivedPath)).toBe(true);
    expect(JSON.parse(readFileSync(archivedPath, 'utf8')).receipt).not.toBeNull();

    // 新划分 apply：整体替换、无旧残留
    expect(planTo(fx, fx.codeB, fx.slicesB).phase).toBe('completed');
    const tasksAfter = readFileSync(fx.tasksPath, 'utf8');
    expect(tasksAfter).toContain('重划后单切片：合并后的完整任务文本');
    expect(tasksAfter).not.toContain('第一片完整任务文本');
    const newManifest = readFileSync(fx.manifestPath, 'utf8');
    expect(newManifest).not.toBe(oldManifest);
    expect(newManifest).not.toContain('slice-01-a');
    // 旧 checkpoint 因 manifest_sha256 失配不被采信（单切片新划分 derive 为 null 属预期；
    // 采信规则由 sha 对照锚定：旧 checkpoint 的 sha ≠ 新 manifest 的 sha）
    const newSha = `sha256:${require('node:crypto').createHash('sha256').update(newManifest).digest('hex')}`;
    expect(oldManifestSha).not.toBe(newSha);
    expect(deriveSliceVerificationState(fx.root, fx.dir)).toBeNull(); // 新划分为单切片 → 惰性
  });

  it('UT-S32-68: fail-closed 与未重开零回归', () => {
    // ① 事务文件不可读（以目录顶名构造 EISDIR）→ 拒绝且零副作用
    const a = setup();
    mkdirSync(a.txPath, { recursive: true });
    let caught: TestSliceTransactionError | null = null;
    try { reopenTestSliceTransaction(a.root, a.dir, SLUG, { reason: '证伪' }); }
    catch (e) { caught = e as TestSliceTransactionError; }
    expect(caught!.code).toBe('artifact_unreadable');
    expect(existsSync(a.auditPath)).toBe(false);

    // ② 非 completed phase：action_not_allowed，既有出路不变
    const b = setup();
    createTestSliceTransaction(b.root, b.dir, SLUG);
    let r: TestSliceTransactionError | null = null;
    try { reopenTestSliceTransaction(b.root, b.dir, SLUG, { reason: '证伪' }); }
    catch (e) { r = e as TestSliceTransactionError; }
    expect(r!.code).toBe('action_not_allowed');
    expect(existsSync(b.auditPath)).toBe(false);

    // ③ completed 不执行 reopen：submit/abort 仍被拒，reopen 为唯一新增动作
    const c = setup();
    expect(planTo(c, c.codeA, c.slicesA).phase).toBe('completed');
    const tx = readTestSliceTransactionIfPresent(c.dir)!;
    expect(tx.allowed_actions).toEqual(['reopen']);
    for (const act of [() => submitTestSliceContent(c.dir, 'slot_slices', c.slicesB), () => sealTestSliceTransaction(c.dir)]) {
      let e2: TestSliceTransactionError | null = null;
      try { act(); } catch (e) { e2 = e as TestSliceTransactionError; }
      expect(e2!.code).toBe('action_not_allowed');
    }
  });

  it('UT-S28-49: next 重划入口按批准状态分流', () => {
    // ① 已规划未批准 → 提示在场
    const a = setup();
    expect(planTo(a, a.codeA, a.slicesA).phase).toBe('completed');
    const hintA = replanHintFor(a.root, SLUG, 'ready-to-implement', 'zh');
    expect(hintA).toContain('slice transaction reopen --reason');
    // ② 已批准 → 不提示
    writeFileSync(a.markerPath, JSON.stringify({ approved: true }));
    expect(replanHintFor(a.root, SLUG, 'ready-to-implement', 'zh')).toBe('');
    // ③ 事务非 completed → 不提示；且非 ready-to-implement 步不提示
    const b = setup();
    createTestSliceTransaction(b.root, b.dir, SLUG);
    expect(replanHintFor(b.root, SLUG, 'ready-to-implement', 'zh')).toBe('');
    expect(replanHintFor(a.root, SLUG, 'coding', 'zh')).toBe('');
    // 接线断言：next 顶层 detail 组装确实消费该 helper（摘除接线即红）
    const src = readFileSync(resolve(__dirname, '..', 'src/commands/next.ts'), 'utf-8');
    expect(src).toContain('detail += replanHintFor(root, slug, data.proposal_step, locale);');
  });

  it('ST-S32-22: 真实 CLI 重划全链', () => {
    const fx = setup();
    const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: fx.root, encoding: 'utf8', timeout: 60000,
    });
    const chain = (code: string, slices: string) => {
      for (const step of [
        ['slice', 'transaction', 'submit-content', '--slot', 'slot_codesection', '--file', code],
        ['slice', 'transaction', 'submit-content', '--slot', 'slot_slices', '--file', slices],
        ['slice', 'transaction', 'seal'], ['slice', 'transaction', 'apply'],
      ]) {
        const r = run(step);
        expect(r.status, `${step.join(' ')}: ${r.stderr.slice(0, 300)}`).toBe(0);
      }
    };
    chain(fx.codeA, fx.slicesA);                                  // 首次规划（两切片）
    const oldId = readTestSliceTransactionIfPresent(fx.dir)!.transaction_id;

    const reopened = run(['slice', 'transaction', 'reopen', '--reason', '类别①假设被证伪']);
    expect(reopened.status, reopened.stderr.slice(0, 300)).toBe(0);
    const proj = readTestSliceTransactionIfPresent(fx.dir)!;
    expect(proj.phase).toBe('collecting');
    expect(proj.origin).toBe('initial-plan');
    expect(proj.content_slots.required).toBe(2);
    expect(readFileSync(fx.auditPath, 'utf8')).toContain(oldId);
    expect(existsSync(join(fx.dir, 'slice-transactions', `${oldId}.json`))).toBe(true);

    chain(fx.codeB, fx.slicesB);                                  // 重划（单切片，0.14.14 语义）
    const tasksAfter = readFileSync(fx.tasksPath, 'utf8');
    expect(tasksAfter).toContain('重划后单切片');
    expect(tasksAfter).not.toContain('第一片完整任务文本');
    expect(readFileSync(fx.manifestPath, 'utf8')).not.toContain('slice-01-a');

    // manifest-recovery 既有路径不受影响：另夹具健康两切片 → 删 manifest → 恢复投影可达
    const g = setup();
    const runG = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: g.root, encoding: 'utf8', timeout: 60000 });
    for (const step of [
      ['slice', 'transaction', 'submit-content', '--slot', 'slot_codesection', '--file', g.codeA],
      ['slice', 'transaction', 'submit-content', '--slot', 'slot_slices', '--file', g.slicesA],
      ['slice', 'transaction', 'seal'], ['slice', 'transaction', 'apply'],
    ]) expect(runG(step).status).toBe(0);
    spawnSync('rm', [g.manifestPath]);
    const state = deriveSliceVerificationState(g.root, g.dir);
    expect(state?.manifest_status).toBe('missing');
  });
});
