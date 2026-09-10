/**
 * UT-S32-100..103 / ST-S32-43：`openlogos slice plan` 写入侧 **fail-closed** 与判据单点化。
 *
 * 对应功能规格 §2.78，根规范 `spec/test-slice-manifest.md` §2.2 / §2.2.1 / §10，
 * 场景 S32「切片规划单条受控写入口时序」EX-32.23～EX-32.25。
 * 测试结果由全局 OpenLogos reporter（test/openlogos-reporter.ts）写入
 * logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, withCompleteClarification } from './helpers.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { planSlices, SlicePlanError, slicePlanExitCode } from '../src/commands/slice.js';
import {
  TEST_SLICE_MANIFEST, collectSliceManifestViolations, deriveSliceVerificationState,
} from '../src/lib/test-slice-manifest.js';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLUG = 'slice-failclosed-demo';
const SPEC_TARGET = 'logos/resources/test/core-S99-test-cases.md';
const IDS = ['UT-S99-01', 'UT-S99-02', 'ST-S99-01', 'ST-S99-02'];

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function cli(cwd: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [join(CLI_ROOT, 'dist', 'index.js'), ...args],
    { cwd, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** 合法划分：两片、各自 own 真实 ID、spec_targets 落在已合并测试规格下。 */
function legalSlices() {
  return [
    {
      slice_id: 'slice-01-alpha', task_text: '切片1：实现 alpha（覆盖 UT-S99-01、ST-S99-01）',
      owned_test_ids: ['ST-S99-01', 'UT-S99-01'], runner_selectors: ['ST-S99-01', 'UT-S99-01'],
      spec_targets: [SPEC_TARGET],
    },
    {
      slice_id: 'slice-02-beta', task_text: '切片2：实现 beta（覆盖 UT-S99-02、ST-S99-02）',
      owned_test_ids: ['ST-S99-02', 'UT-S99-02'], runner_selectors: ['ST-S99-02', 'UT-S99-02'],
      spec_targets: [SPEC_TARGET],
    },
  ];
}

/**
 * 事故输入（2026-09-10 实证）：把全部 merge 目标填进 `spec_targets`。
 * 其余各项完全合法——这正是它能骗过订正前那份手抄判据的原因。
 */
function accidentSlices() {
  const rows = legalSlices();
  rows[0].spec_targets = [
    SPEC_TARGET,
    'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md',
  ];
  return rows;
}

function fixture() {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:', '  name: t', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched',
  ].join('\n'));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));

  const dir = join(root, 'logos', 'changes', SLUG);
  mkdirSync(dir, { recursive: true });
  const table = ['| ID | 用例 |', '|---|---|', ...IDS.map(id => `| ${id} | ${id} fixture |`)].join('\n');
  writeFileSync(join(root, SPEC_TARGET), table);
  mkdirSync(join(root, 'logos/resources/prd/2-product-design/1-feature-specs'), { recursive: true });
  writeFileSync(join(root, 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md'),
    '# 功能规格\n\n本文件用于构造「非测试规格路径」的 spec_targets 反例。\n');
  writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
    '# 变更提案：slice-failclosed-demo', '',
    '## 变更原因', '验证写入侧 fail-closed。', '',
    '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '写入口校验前置于任一 rename。',
  ].join('\n')));
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '',
    '## [code] 代码实现', '（本段在 plan 段留空。）', '',
    '## [deploy] 部署执行', '- [ ] 无', '',
  ].join('\n'));
  writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'baseline_closure_spec_complete',
    test_change_set: buildTestChangeSet({
      change: SLUG, module: 'core',
      targets: [{ targetPath: SPEC_TARGET, beforeBytes: null, afterBytes: Buffer.from(table) }],
    }),
  }, null, 2)}\n`);
  return { root, dir };
}

function writeInput(root: string, rows: unknown, name = 'slices.json'): string {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify({ slices: rows }, null, 2));
  return path;
}

/** 两产物的字节指纹 + mtime——「零改写」只认磁盘事实，不认命令自述。 */
function artifactState(dir: string): Record<string, { sha: string; mtimeMs: number; size: number }> {
  const out: Record<string, { sha: string; mtimeMs: number; size: number }> = {};
  for (const name of ['tasks.md', TEST_SLICE_MANIFEST]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const stat = statSync(path);
    out[name] = {
      sha: createHash('sha256').update(readFileSync(path)).digest('hex'),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  }
  return out;
}

function tempLeftovers(dir: string): string[] {
  return readdirSync(dir).filter(name => name.endsWith('.tmp'));
}

function catchPlan(root: string, input: string): SlicePlanError {
  try {
    planSlices(root, input);
  } catch (error) {
    if (error instanceof SlicePlanError) return error;
    throw error;
  }
  throw new Error('期望 planSlices 拒绝该输入，但它成功返回');
}

describe('S32 slice plan 写入侧 fail-closed', () => {
  it('UT-S32-100: 非法 spec_targets 被写入口拒绝并原样输出可定位违规', () => {
    const { root, dir } = fixture();
    planSlices(root, writeInput(root, legalSlices()));           // 先建立一次合法基线
    const error = catchPlan(root, writeInput(root, accidentSlices(), 'bad.json'));

    // 退出码分级：产物非法为 2（§2.78.3）
    expect(slicePlanExitCode(error.code)).toBe(2);
    expect(error.violations.length).toBeGreaterThan(0);

    // 违规逐条完整：code / path / message / fix_hint 一个都不能少，且 path 精确点名字段
    for (const item of error.violations) {
      expect(item.code).toBeTruthy();
      expect(item.path).toBeTruthy();
      expect(item.message).toBeTruthy();
      expect(item.fix_hint).toBeTruthy();
    }
    const specTargetViolation = error.violations.find(v => v.path === '$.slices[].spec_targets');
    expect(specTargetViolation, '必须点名 spec_targets 这一项').toBeTruthy();
    expect(specTargetViolation!.code).toBe('test-slice-manifest-invalid');
    expect(specTargetViolation!.message).toContain('core-01-feature-specs.md');

    // 排序稳定：同一输入两次拒绝得到逐条相同的违规序列
    const again = catchPlan(root, join(root, 'bad.json'));
    expect(again.violations).toEqual(error.violations);
    expect(tempLeftovers(dir)).toEqual([]);
  });

  it('UT-S32-101: 拒绝时两产物零改写且无临时文件残留', () => {
    const { root, dir } = fixture();
    planSlices(root, writeInput(root, legalSlices()));
    const before = artifactState(dir);
    expect(Object.keys(before).sort()).toEqual(['tasks.md', TEST_SLICE_MANIFEST].sort());

    catchPlan(root, writeInput(root, accidentSlices(), 'bad.json'));

    // 关键：tasks.md 不得出现「已被新 [code] 段覆盖」的中间态。
    // 订正前实现先以普通 writeFileSync 提交 tasks.md 再写 manifest，本断言必失败。
    expect(artifactState(dir)).toEqual(before);
    expect(tempLeftovers(dir)).toEqual([]);
    expect(readFileSync(join(dir, 'tasks.md'), 'utf-8')).toContain('切片1：实现 alpha');
  });

  it('UT-S32-102: 判据取自读取侧单点，写入侧不产生也不遗漏任何一条', () => {
    const { root, dir } = fixture();
    const legal = legalSlices();
    const cases: Array<[string, ReturnType<typeof legalSlices>]> = [
      ['spec_targets 越界', accidentSlices()],
      ['owned_test_ids 含未定义 ID', (() => {
        const rows = legalSlices(); rows[1].owned_test_ids = ['UT-S99-99', 'ST-S99-02']; return rows;
      })()],
      ['owned_test_ids 未覆盖变更集合', (() => {
        const rows = legalSlices(); rows[1].owned_test_ids = ['ST-S99-02']; return rows;
      })()],
      ['slice_id 重复', (() => {
        const rows = legalSlices(); rows[1].slice_id = rows[0].slice_id; return rows;
      })()],
      ['slice_id 词法非法', (() => {
        const rows = legalSlices(); rows[0].slice_id = 'Slice_01'; return rows;
      })()],
      ['task_text 为空', (() => {
        const rows = legalSlices(); rows[0].task_text = '   '; return rows;
      })()],
      ['runner_selectors 为空数组', (() => {
        const rows = legalSlices(); rows[0].runner_selectors = []; return rows;
      })()],
    ];

    for (const [label, rows] of cases) {
      planSlices(root, writeInput(root, legal));                 // 每例前重置为合法基线
      const before = artifactState(dir);
      const error = catchPlan(root, writeInput(root, rows, 'bad.json'));

      // 基准值来自**同一个** validator，而不是在测试里复述一份期望违规清单——
      // 复述等于把判据副本从实现搬进测试，正是本轮要消除的形态。
      const expected = collectSliceManifestViolations({
        root,
        manifestRaw: JSON.parse(readFileSync(join(dir, TEST_SLICE_MANIFEST), 'utf-8')),
        tasksContent: readFileSync(join(dir, 'tasks.md'), 'utf-8'),
        expected: { change: SLUG, module: 'core' },
        changedTestIds: null,
      });
      expect(expected.violations, `${label}：在盘产物本身应当合法`).toEqual([]);
      expect(error.violations.length, `${label}：必须给出至少一条违规`).toBeGreaterThan(0);
      expect(artifactState(dir), `${label}：拒绝后两产物零改写`).toEqual(before);
      expect(tempLeftovers(dir), `${label}：无临时文件残留`).toEqual([]);
    }
  });

  it('UT-S32-103: 合法输入零行为变化', () => {
    const { root, dir } = fixture();
    const result = planSlices(root, writeInput(root, legalSlices()));

    expect(result.slice_count).toBe(2);
    expect(result.slice_ids).toEqual(['slice-01-alpha', 'slice-02-beta']);
    expect(result.manifest_path).toBe(`logos/changes/${SLUG}/${TEST_SLICE_MANIFEST}`);

    const tasks = readFileSync(join(dir, 'tasks.md'), 'utf-8');
    expect(tasks).toContain('- [ ] 切片1：实现 alpha（覆盖 UT-S99-01、ST-S99-01）');
    expect(tasks).toContain('- [ ] 切片2：实现 beta（覆盖 UT-S99-02、ST-S99-02）');
    expect(tasks).toContain('- [x] 已合并');          // [delta] 段与其勾选状态字节恒等
    expect(tasks).toContain('- [ ] 无');              // [deploy] 段同上

    const manifest = JSON.parse(readFileSync(join(dir, TEST_SLICE_MANIFEST), 'utf-8'));
    expect(manifest.slices.map((s: { slice_id: string }) => s.slice_id))
      .toEqual(['slice-01-alpha', 'slice-02-beta']);
    expect(manifest.task_fingerprint).toBe(result.task_fingerprint);
    expect(tempLeftovers(dir)).toEqual([]);

    // 合法产出对读取侧同样有效——写入侧收紧未产生新的失败面
    const state = deriveSliceVerificationState(root, dir, { change: SLUG, module: 'core' })!;
    expect(state.manifest_status).toBe('valid');
    expect(state.verify_mode).toBe('slice-checkpoint');
  });

  it('ST-S32-43: 真实 CLI 下非法输入当轮自愈的端到端', () => {
    const { root, dir } = fixture();
    cli(root, 'slice', 'plan', '--file', writeInput(root, legalSlices()));
    const before = artifactState(dir);

    // ① 非法输入：exit 2、两产物零改写、输出含可定位 fix_hint
    const rejected = cli(root, 'slice', 'plan', '--file', writeInput(root, accidentSlices(), 'bad.json'));
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toContain('spec_targets');
    expect(rejected.stderr).toContain('修复：');
    expect(artifactState(dir)).toEqual(before);
    expect(tempLeftovers(dir)).toEqual([]);

    // ② 非法产物根本没落盘，故下游看不到 test-slice-manifest-invalid
    const next = cli(root, 'next', '--format', 'json');
    expect(next.stdout).not.toContain('test-slice-manifest-invalid');

    // ③ 依 fix_hint 改正后重跑：exit 0，两产物落盘且互相一致
    const fixed = cli(root, 'slice', 'plan', '--file', writeInput(root, legalSlices(), 'fixed.json'));
    expect(fixed.status).toBe(0);
    const state = deriveSliceVerificationState(root, dir, { change: SLUG, module: 'core' })!;
    expect(state.manifest_status).toBe('valid');

    // ④ 增量验收能力零回归
    expect(state.verify_mode).toBe('slice-checkpoint');
    expect(state.attempted_slice_id).toBe('slice-01-alpha');
    expect(state.eligible_test_ids).toContain('UT-S99-01');
    expect(state.eligible_test_ids).not.toContain('UT-S99-02');

    // ⑤ JSON 输出通道同样原样携带违规明细
    const rejectedJson = cli(root, 'slice', 'plan', '--file', join(root, 'bad.json'), '--format', 'json');
    expect(rejectedJson.status).toBe(2);
    const envelope = JSON.parse(rejectedJson.stderr) as { violations?: Array<Record<string, string>> };
    expect(envelope.violations?.length).toBeGreaterThan(0);
    expect(envelope.violations!.every(v => v.code && v.path && v.message && v.fix_hint)).toBe(true);
  });
});
