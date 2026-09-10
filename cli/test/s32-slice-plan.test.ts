/**
 * lite-cut1a-remove-slice-transaction 单切片：
 * `openlogos slice plan` 单条受控写入口（功能规格 §2.68）——一次调用完成落盘与指纹自算、
 * 结构化校验失败零副作用、重规划幂等，以及 slice-checkpoint 增量验收能力零回归。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
    // 判据单点化后 parseSlicesInput 只做纯输入形状检查，不再接收已定义 ID 集合（§2.78.1）。
    const parsed = parseSlicesInput(readFileSync(join(root, 'slices.json'), 'utf-8'));
    expect(parsed[0].owned_test_ids).toEqual(['UT-S99-01', 'ST-S99-01']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fix-slice-assets-drift-after-transaction-removal 单切片：
// `slice plan` 重跑时的 checkbox 逐 slice_id 保留（功能规格 §2.68.5、根规范 §2.3/§2.4）。
// ─────────────────────────────────────────────────────────────────────────────

/** `[code]` 段中的 checkbox 条目行（按文档序），用于逐字对照勾选状态。 */
function codeSectionOf(tasks: string): string[] {
  const lines = tasks.split('\n');
  const start = lines.findIndex(line => /^## \[code\]/.test(line));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(line => /^## /.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).filter(line => /^- \[[ xX]\]/.test(line));
}

function readTasks(): string { return readFileSync(join(proposalDir(), 'tasks.md'), 'utf-8'); }

/** 把 `[code]` 中第 index 条（0 基，按文档序数全部 checkbox 条目）标记为已勾选——模拟 code-implementor 完成该切片。 */
function checkCodeEntry(index: number): void {
  const lines = readTasks().split('\n');
  const start = lines.findIndex(line => /^## \[code\]/.test(line));
  let seen = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^## /.test(lines[i])) break;
    if (!/^- \[[ xX]\] /.test(lines[i])) continue;
    seen += 1;
    if (seen === index) { lines[i] = lines[i].replace(/^- \[[ xX]\] /, '- [x] '); break; }
  }
  writeFileSync(join(proposalDir(), 'tasks.md'), lines.join('\n'));
}

function writeS99Spec(ids: string[]): void {
  writeFileSync(join(root, 'logos/resources/test/core-S99-test-cases.md'), [
    '# S99 测试用例', '', '| ID | 测试点 | 关键断言 |', '|---|---|---|',
    ...ids.map(id => `| ${id} | fixture | 断言 |`),
  ].join('\n'));
}

function slice(id: string, text: string, owned: string[]) {
  return {
    slice_id: id, task_text: text, owned_test_ids: owned, runner_selectors: owned,
    spec_targets: ['logos/resources/test/core-S99-test-cases.md'],
  };
}

describe('slice plan 恢复重跑与 checkbox 保留', () => {
  it('UT-S32-92: 初次规划零回归——无旧条目与旧 manifest 时全部写为未勾选', () => {
    expect(existsSync(join(proposalDir(), TEST_SLICE_MANIFEST))).toBe(false);

    const result = planSlices(root, writeInput(slicesInput()));
    const tasks = readTasks();

    // 逐字对照：本能力上线前的渲染就是「每条 `- [ ] <task_text>`，按输入顺序」
    expect(codeSectionOf(tasks)).toEqual([
      '- [ ] 切片1：实现 alpha 并覆盖 UT-S99-01',
      '- [ ] 切片2：实现 beta 并覆盖 ST-S99-01',
    ]);
    expect(tasks).not.toContain('- [x] 切片');
    // 其它段与其勾选状态字节恒等
    expect(tasks).toContain('- [x] 产出 delta');
    expect(tasks).toContain('- [ ] 部署到 staging');
    // 输出字段口径不变
    expect(result.slice_count).toBe(2);
    expect(result.slice_ids).toEqual(['slice-01-alpha', 'slice-02-beta']);
    expect(result.manifest_path).toBe(`logos/changes/${SLUG}/${TEST_SLICE_MANIFEST}`);
  });

  it('UT-S32-93: task_text 逐字未变则保留勾选，变更则重置为未勾选', () => {
    planSlices(root, writeInput(slicesInput()));
    checkCodeEntry(0);
    expect(codeSectionOf(readTasks())[0]).toBe('- [x] 切片1：实现 alpha 并覆盖 UT-S99-01');

    // ① 逐字相同的输入重跑 → 勾选保留
    planSlices(root, writeInput(slicesInput()));
    expect(codeSectionOf(readTasks())).toEqual([
      '- [x] 切片1：实现 alpha 并覆盖 UT-S99-01',
      '- [ ] 切片2：实现 beta 并覆盖 ST-S99-01',
    ]);
    // 其它段与其勾选状态字节恒等
    expect(readTasks()).toContain('- [x] 产出 delta');
    expect(readTasks()).toContain('- [ ] 部署到 staging');

    // ② 仅改一个字符 → 该条目重置为未勾选
    planSlices(root, writeInput([
      slice('slice-01-alpha', '切片1：实现 alpha 并覆盖 UT-S99-01。', ['UT-S99-01']),
      slice('slice-02-beta', '切片2：实现 beta 并覆盖 ST-S99-01', ['ST-S99-01']),
    ]));
    expect(codeSectionOf(readTasks())).toEqual([
      '- [ ] 切片1：实现 alpha 并覆盖 UT-S99-01。',
      '- [ ] 切片2：实现 beta 并覆盖 ST-S99-01',
    ]);
  });

  it('UT-S32-94: 混合场景逐条目独立判定，不因同批存在改写切片而牵连', () => {
    writeS99Spec(['UT-S99-01', 'UT-S99-02', 'UT-S99-03', 'UT-S99-04']);
    const base = [
      slice('slice-01-keep', '切片1：保持不变', ['UT-S99-01']),
      slice('slice-02-rewrite', '切片2：将被改写', ['UT-S99-02']),
      slice('slice-03-idle', '切片3：未勾也未变', ['UT-S99-03']),
    ];
    planSlices(root, writeInput(base));
    checkCodeEntry(0); // slice-01 已完成
    checkCodeEntry(1); // slice-02 已完成
    expect(codeSectionOf(readTasks()).map(l => l.slice(0, 5)))
      .toEqual(['- [x]', '- [x]', '- [ ]']);

    planSlices(root, writeInput([
      base[0],                                                      // 未变且已勾 → 保留
      slice('slice-02-rewrite', '切片2：改写后的新文本', ['UT-S99-02']), // 已勾但改写 → 重置
      base[2],                                                      // 未变且未勾 → 未勾
      slice('slice-04-new', '切片4：本轮新增', ['UT-S99-04']),          // 新增 → 未勾
    ]));

    expect(codeSectionOf(readTasks())).toEqual([
      '- [x] 切片1：保持不变',
      '- [ ] 切片2：改写后的新文本',
      '- [ ] 切片3：未勾也未变',
      '- [ ] 切片4：本轮新增',
    ]);
  });

  it('UT-S32-95: 旧 manifest 缺失时退化为按 [code] 同文本条目匹配', () => {
    planSlices(root, writeInput(slicesInput()));
    checkCodeEntry(0);

    // manifest missing 的恢复形态：产物被删，[code] 是唯一残留的旧事实
    rmSync(join(proposalDir(), TEST_SLICE_MANIFEST));
    expect(existsSync(join(proposalDir(), TEST_SLICE_MANIFEST))).toBe(false);

    planSlices(root, writeInput(slicesInput()));

    expect(codeSectionOf(readTasks())).toEqual([
      '- [x] 切片1：实现 alpha 并覆盖 UT-S99-01',
      '- [ ] 切片2：实现 beta 并覆盖 ST-S99-01',
    ]);
    // manifest 重建，且指纹依刚写出的 tasks.md 重算（含保留下来的 `- [x]` 字节）
    const manifest = JSON.parse(readFileSync(join(proposalDir(), TEST_SLICE_MANIFEST), 'utf-8'));
    expect(manifest.slices.map((s: { slice_id: string }) => s.slice_id))
      .toEqual(['slice-01-alpha', 'slice-02-beta']);
    expect(manifest.task_fingerprint).toBe(computeTaskFingerprint(readTasks()));
  });
});
