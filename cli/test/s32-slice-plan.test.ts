/**
 * lite-cut1a-remove-slice-transaction 单切片：
 * `openlogos slice plan` 单条受控写入口（功能规格 §2.68）——一次调用完成落盘与指纹自算、
 * 结构化校验失败零副作用、重规划幂等，以及 slice-checkpoint 增量验收能力零回归。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { planSlices, parseSlicesInput, SlicePlanError } from '../src/commands/slice.js';
import { computeTaskFingerprint, TEST_SLICE_MANIFEST } from '../src/lib/test-slice-manifest.js';

let root: string;
let cleanup: () => void;
const SLUG = 'demo-change';

const TASKS = [
  '# 实现任务', '',
  '## [delta] 规格变更', '- [x] 产出 delta', '',
  '## [code] 代码实现',
  '（本段在 plan 段留空。）', '',
  '## [deploy] 部署任务', '- [ ] 部署到 staging', '',
].join('\n');

function slicesInput(overrides: Record<string, unknown>[] = []) {
  return overrides.length > 0 ? overrides : [
    {
      slice_id: 'slice-01-alpha', task_text: '切片1：实现 alpha 并覆盖 UT-S99-01',
      owned_test_ids: ['UT-S99-01'], runner_selectors: ['UT-S99-01'],
      spec_targets: ['logos/resources/test/core-S99-test-cases.md'],
    },
    {
      slice_id: 'slice-02-beta', task_text: '切片2：实现 beta 并覆盖 ST-S99-01',
      owned_test_ids: ['ST-S99-01'], runner_selectors: ['ST-S99-01'],
      spec_targets: ['logos/resources/test/core-S99-test-cases.md'],
    },
  ];
}

function writeInput(rows: unknown): string {
  const path = join(root, 'slices.json');
  writeFileSync(path, JSON.stringify(rows, null, 2));
  return path;
}

function proposalDir(): string { return join(root, 'logos', 'changes', SLUG); }

function snapshot(): Array<[string, number, number]> {
  return ['tasks.md', TEST_SLICE_MANIFEST]
    .filter(name => existsSync(join(proposalDir(), name)))
    .map(name => {
      const s = statSync(join(proposalDir(), name));
      return [name, s.size, s.mtimeMs] as [string, number, number];
    });
}

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  scaffoldProject(root, { locale: 'zh' });
  mkdirSync(proposalDir(), { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: SLUG, module: 'core' }));
  writeFileSync(join(proposalDir(), 'tasks.md'), TASKS);
  // 已合并测试规格：owned_test_ids 必须在此真实存在
  writeFileSync(join(root, 'logos/resources/test/core-S99-test-cases.md'), [
    '# S99 测试用例', '',
    '| ID | 测试点 | 关键断言 |', '|---|---|---|',
    '| UT-S99-01 | alpha | 断言 |', '| ST-S99-01 | beta | 断言 |',
  ].join('\n'));
});

afterEach(() => cleanup());

describe('S32 切片规划单条受控写入口', () => {
  it('UT-S32-90: 一次调用完成落盘且指纹依刚写出的 tasks.md 自算', () => {
    const result = planSlices(root, writeInput(slicesInput()));

    // [code] 段按切片顺序写入
    const tasks = readFileSync(join(proposalDir(), 'tasks.md'), 'utf-8');
    expect(tasks).toContain('- [ ] 切片1：实现 alpha 并覆盖 UT-S99-01');
    expect(tasks).toContain('- [ ] 切片2：实现 beta 并覆盖 ST-S99-01');
    // [delta] / [deploy] 段与勾选状态字节恒等
    expect(tasks).toContain('- [x] 产出 delta');
    expect(tasks).toContain('- [ ] 部署到 staging');

    // manifest 与输入逐字段一致
    const manifest = JSON.parse(readFileSync(join(proposalDir(), TEST_SLICE_MANIFEST), 'utf-8'));
    expect(manifest.slices.map((s: { slice_id: string }) => s.slice_id))
      .toEqual(['slice-01-alpha', 'slice-02-beta']);
    expect(manifest.slices[0].owned_test_ids).toEqual(['UT-S99-01']);

    // 指纹等于依刚写出的 tasks.md 重算之值（写入者与计算者同一方同一时刻）
    expect(manifest.task_fingerprint).toBe(computeTaskFingerprint(tasks));
    expect(result.task_fingerprint).toBe(manifest.task_fingerprint);
    expect(result.slice_count).toBe(2);

    // 无 slot / staging / seal / receipt 产物
    for (const stale of ['TEST_SLICE_TRANSACTION.json', 'merge-staging', 'slot_codesection', 'slot_slices']) {
      expect(existsSync(join(proposalDir(), stale)), stale).toBe(false);
    }
  });

  it('UT-S32-91: 结构化校验失败零副作用且报稳定错误码', () => {
    // 先建立一次成功基线，再逐个构造非法输入验证「不被修改」
    planSlices(root, writeInput(slicesInput()));
    const before = snapshot();

    const cases: Array<[unknown, string]> = [
      ['{ not json', 'SLICE_PLAN_INPUT_INVALID'],
      [[], 'SLICE_PLAN_INPUT_INVALID'],
      [[{ slice_id: 'slice-01-alpha', task_text: 't', runner_selectors: ['x'], spec_targets: ['y'] }],
        'SLICE_PLAN_INPUT_INVALID'],
      [[
        { slice_id: 'dup', task_text: 't', owned_test_ids: ['UT-S99-01'], runner_selectors: ['a'], spec_targets: ['b'] },
        { slice_id: 'dup', task_text: 't', owned_test_ids: ['ST-S99-01'], runner_selectors: ['a'], spec_targets: ['b'] },
      ], 'SLICE_PLAN_DUPLICATE_SLICE_ID'],
      [[{ slice_id: 'slice-x', task_text: 't', owned_test_ids: ['UT-S99-99'], runner_selectors: ['a'], spec_targets: ['b'] }],
        'SLICE_PLAN_UNKNOWN_TEST_ID'],
    ];

    for (const [payload, code] of cases) {
      const path = join(root, 'bad.json');
      writeFileSync(path, typeof payload === 'string' ? payload : JSON.stringify(payload));
      let thrown: unknown;
      try { planSlices(root, path); } catch (error) { thrown = error; }
      expect(thrown, `${code} 应抛错`).toBeInstanceOf(SlicePlanError);
      expect((thrown as SlicePlanError).code, JSON.stringify(payload).slice(0, 60)).toBe(code);
      expect(snapshot(), `${code} 后产物不得变化`).toEqual(before);
    }

    // 无活跃提案
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'no-such' }));
    let noActive: unknown;
    try { planSlices(root, writeInput(slicesInput())); } catch (error) { noActive = error; }
    expect((noActive as SlicePlanError).code).toBe('SLICE_PLAN_NO_ACTIVE_CHANGE');
  });

  it('ST-S32-40: 规划 → 重规划幂等 → 结构化事实源为 eligible 唯一来源', () => {
    // ① 首次规划
    planSlices(root, writeInput(slicesInput()));
    const firstTasks = readFileSync(join(proposalDir(), 'tasks.md'), 'utf-8');
    const firstManifest = readFileSync(join(proposalDir(), TEST_SLICE_MANIFEST), 'utf-8');

    // ② 同一输入重跑：幂等覆盖，无终态相位、无需重开通道
    planSlices(root, writeInput(slicesInput()));
    expect(readFileSync(join(proposalDir(), 'tasks.md'), 'utf-8')).toBe(firstTasks);
    const second = JSON.parse(readFileSync(join(proposalDir(), TEST_SLICE_MANIFEST), 'utf-8'));
    const first = JSON.parse(firstManifest);
    expect(second.slices).toEqual(first.slices);
    expect(second.task_fingerprint).toBe(first.task_fingerprint);

    // ③ 调整切片后重跑：直接覆盖，不需要 reopen
    planSlices(root, writeInput([{
      slice_id: 'slice-01-merged', task_text: '合并为单切片，覆盖 UT-S99-01 与 ST-S99-01',
      owned_test_ids: ['UT-S99-01', 'ST-S99-01'], runner_selectors: ['UT-S99-01', 'ST-S99-01'],
      spec_targets: ['logos/resources/test/core-S99-test-cases.md'],
    }]));
    const replanned = JSON.parse(readFileSync(join(proposalDir(), TEST_SLICE_MANIFEST), 'utf-8'));
    expect(replanned.slices).toHaveLength(1);
    expect(replanned.slices[0].owned_test_ids).toEqual(['UT-S99-01', 'ST-S99-01']);

    // ④ 结构化事实源不变量：owned_test_ids 只来自 manifest，不得由 [code] 散文反解析。
    //    task_text 里「提及」了两个 ID，但某切片是否拥有它们只以 manifest 为准。
    const tasksProse = readFileSync(join(proposalDir(), 'tasks.md'), 'utf-8');
    expect(tasksProse).toContain('UT-S99-01');
    const parsed = parseSlicesInput(readFileSync(join(root, 'slices.json'), 'utf-8'),
      new Set(['UT-S99-01', 'ST-S99-01']));
    expect(parsed[0].owned_test_ids).toEqual(['UT-S99-01', 'ST-S99-01']);
  });
});
