/**
 * 切片2：终态事务不堵恢复与投影订正。
 * 覆盖 UT-S28-47、UT-S28-48、ST-S28-15。
 *
 * 缺陷背景：`ensureManifestRecoveryTransaction()` 与 `createTestSliceTransaction()` 的
 * 「已存在」判定都不过滤终态，`completed` / `failed` 一并算作活跃事务。于是 completed 的
 * initial-plan 事务占住名额——它 allowed_actions=[]，既不能提交也不能中止，而恢复事务
 * 又永远创建不出来，提案被永久锁死在 plan-slices（spec/test-slice-manifest.md §2.3.1）。
 *
 * 夹具口径（强制）：全部断言在**终态事务在场**的前提下进行。禁止预先删除或改名
 * `TEST_SLICE_TRANSACTION.json`——那是消费方去改 OpenLogos 拥有的文件，正是缺陷报告
 * 所指的人工绕过；把它写进前提，本组约束在测试中就天然不可见。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import {
  applyTestSliceTransaction, createTestSliceTransaction, ensureManifestRecoveryTransaction,
  isActiveTestSliceTransaction, readTestSliceTransactionIfPresent, sealTestSliceTransaction,
  submitTestSliceContent,
} from '../src/lib/test-slice-transaction.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const SLUG = 'stx-terminal';
const SPEC_REL = 'logos/resources/test/core-S01-test-cases.md';
const CODE_BODY = '- [ ] 切片1：第一片（覆盖 UT-S01-01）\n- [ ] 切片2：第二片（覆盖 UT-S01-02）';
const SLICES = [
  { slice_id: 'slice-01-a', task_text: '切片1：第一片（覆盖 UT-S01-01）', owned_test_ids: ['UT-S01-01'], runner_selectors: ['UT-S01-01'], spec_targets: [SPEC_REL] },
  { slice_id: 'slice-02-b', task_text: '切片2：第二片（覆盖 UT-S01-02）', owned_test_ids: ['UT-S01-02'], runner_selectors: ['UT-S01-02'], spec_targets: [SPEC_REL] },
];
const TASKS = [
  '# 实现任务', '', '## [delta] 规格变更', '', '- [x] 已完成的 delta 任务。', '',
  '## [code] 代码实现', '', CODE_BODY, '',
  '## [deploy] 部署任务', '', '- [ ] 部署项。', '',
].join('\n');

/** 走完一次**健康**的 apply（manifest 判 valid），事务停在 completed 且文件保留在场。 */
function setupCompleted() {
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
  const codeFile = join(root, 'code.txt');
  const slicesFile = join(root, 'slices.json');
  writeFileSync(codeFile, CODE_BODY);
  writeFileSync(slicesFile, JSON.stringify(SLICES));

  createTestSliceTransaction(root, dir, SLUG);
  submitTestSliceContent(dir, 'slot_codesection', codeFile);
  submitTestSliceContent(dir, 'slot_slices', slicesFile);
  sealTestSliceTransaction(dir);
  const completed = applyTestSliceTransaction(root, dir);
  expect(completed.phase, '前置：必须先有一次健康的 completed').toBe('completed');
  expect(existsSync(join(dir, 'TEST_SLICE_TRANSACTION.json')), '前置：事务文件必须在场').toBe(true);
  return { root, dir, codeFile, slicesFile, manifestPath: join(dir, 'TEST_SLICE_MANIFEST.json'), completed };
}

describe('S28 终态事务不堵恢复', () => {
  it('UT-S28-47: 终态事务在场时仍创建恢复事务', () => {
    const fx = setupCompleted();
    const tasksBefore = readFileSync(join(fx.dir, 'tasks.md'), 'utf-8');
    rmSync(fx.manifestPath, { force: true });   // 只让 manifest 失效，事务文件保持在场

    const recovery = ensureManifestRecoveryTransaction(fx.root, fx.dir, SLUG);
    expect(recovery, '终态事务在场时恢复事务必须仍可创建').not.toBeNull();
    expect(recovery!.origin).toBe('manifest-recovery');
    expect(recovery!.transaction_id).not.toBe(fx.completed.transaction_id);
    expect(recovery!.content_slots.required, '恢复事务 slot 必须收窄为 1').toBe(1);

    // 旧终态事务被归档而非静默覆盖——receipt 仍可追溯
    const archived = join(fx.dir, 'slice-transactions', `${fx.completed.transaction_id}.json`);
    expect(existsSync(archived), '终态事务应归档保留').toBe(true);
    expect(JSON.parse(readFileSync(archived, 'utf-8')).receipt).not.toBeNull();

    // 完成恢复，全程未删除任何 OpenLogos 拥有的文件
    submitTestSliceContent(fx.dir, 'slot_slices', fx.slicesFile);
    sealTestSliceTransaction(fx.dir);
    expect(applyTestSliceTransaction(fx.root, fx.dir).phase).toBe('completed');
    expect(readFileSync(join(fx.dir, 'tasks.md'), 'utf-8'), '[code] 段必须字节恒等').toBe(tasksBefore);
  });

  it('UT-S28-48: 「活跃」只含非终态的逐 phase 判定', () => {
    // 逐 phase 断言，不以「至少一个通过」代替
    const expectations: Array<[string, boolean]> = [
      ['collecting', true], ['ready', true], ['sealed', true], ['applying', true],
      ['completed', false], ['failed', false],
    ];
    for (const [phase, active] of expectations) {
      expect(isActiveTestSliceTransaction({ phase: phase as never }), `${phase} 的活跃判定`).toBe(active);
    }
    expect(isActiveTestSliceTransaction(null)).toBe(false);

    // 非终态在场 → 幂等返回同一事务，不新建
    const fx = setupCompleted();
    rmSync(fx.manifestPath, { force: true });
    const first = ensureManifestRecoveryTransaction(fx.root, fx.dir, SLUG)!;
    expect(readTestSliceTransactionIfPresent(fx.dir)!.phase).toBe('collecting');
    const second = ensureManifestRecoveryTransaction(fx.root, fx.dir, SLUG)!;
    expect(second.transaction_id, '活跃事务必须幂等返回').toBe(first.transaction_id);
  });

  it('ST-S28-15: 真实 CLI 下终态死锁不复现且指引与事实一致', () => {
    const fx = setupCompleted();
    rmSync(fx.manifestPath, { force: true });
    const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], {
      cwd: fx.root, encoding: 'utf8', timeout: 60000,
    });

    const next = run(['next', '--format', 'json']);
    expect(next.status).toBe(0);
    const module = (JSON.parse(next.stdout) as {
      data: { modules: Array<{ detail?: string; slice_transaction?: { origin: string; phase: string } }> };
    }).data.modules[0];

    // 返回的必须是恢复事务，而不是那个 completed 的 initial-plan 事务
    expect(module.slice_transaction?.origin).toBe('manifest-recovery');
    expect(module.slice_transaction?.phase).toBe('collecting');

    // 指引与事实一致：不谎称无缺口、不对终态提示提交
    const detail = module.detail ?? '';
    expect(detail).toContain('origin=manifest-recovery');
    expect(detail, '有缺口时不得渲染「（无缺口）」').not.toContain('（无缺口）');
    expect(detail).toContain('slot_slices');

    // 按指引继续，每一步都必须真的被接受
    expect(run(['slice', 'transaction', 'submit-content', '--slot', 'slot_slices', '--file', fx.slicesFile]).status).toBe(0);
    expect(run(['slice', 'transaction', 'seal']).status).toBe(0);
    expect(run(['slice', 'transaction', 'apply']).status).toBe(0);

    // recover 的拒绝文案不得断言未发生的前提
    const recovered = run(['slice', 'transaction', 'recover']);
    expect(recovered.status).not.toBe(0);
    expect(recovered.stderr, 'apply 成功的现场不存在「apply 失败已整体回滚」').not.toContain('apply 失败已整体回滚');
  });
});
