/**
 * branch-sync-generated-files 切片 2：登记表的三方条目合并（S44）。
 *
 * 覆盖 UT-S44-05、UT-S44-06、UT-S44-07、UT-S44-08、UT-S44-09、UT-S44-10、UT-S44-11、UT-S44-12、ST-S44-03
 * （logos/resources/test/core-S44-test-cases.md）。规范源：spec/branch-sync.md §5。
 * UT-S44-05～UT-S44-09 直接传入解析后的三个版本、不经过 git；其余经真实 CLI 进程在一次性 git 仓库中执行。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { mergeRegistry, type RegistryRecord } from '../src/lib/registry-merge.js';
import { inferResourceDesc, scanCandidateFiles } from '../src/lib/sync-resource-index.js';
import { cleanupFixtures, Fixture, REGISTRY } from './s44-helpers.js';

afterEach(cleanupFixtures);

const clone = <T>(v: T): T => structuredClone(v);
const ids = (list: unknown): string[] => (list as Array<{ id: string }>).map(e => e.id);

function baseRegistry(): RegistryRecord {
  return {
    project: { name: 'x' },
    tech_stack: { language: 'ts' },
    scenario_counter: { next_id: 44 },
    feature_counter: { next_id: 3 },
    features: [{ id: 'F01', name: '甲', module: 'core' }, { id: 'F02', name: '乙', module: 'core' }],
    scenarios: [{ id: 'S09', name: '九', feature: 'F01' }, { id: 'S10', name: '十', feature: 'F02' }],
    resource_index: [{ path: 'a.md', desc: 'A' }],
    conventions: ['约定一'],
    extra_unknown: { keep: true },
  };
}

describe('S44 登记表条目合并 — 纯函数', () => {
  it('UT-S44-05: 单侧新增与单侧修改都保留，主分支新增的条目追加在末尾', () => {
    const O = baseRegistry();
    const A = clone(O);
    (A.scenarios as any[]).push({ id: 'S50', name: '五十', feature: 'F01' });
    (A.features as any[]).push({ id: 'F03', name: '丙', module: 'core' });
    const B = clone(O);
    (B.scenarios as any[])[1].feature = 'F01';
    (B.scenarios as any[]).push({ id: 'S51', name: '五一', feature: 'F01' });

    const r = mergeRegistry(O, A, B);
    expect(r.conflicts).toEqual([]);
    const m = r.merged!;
    expect(ids(m.scenarios)).toEqual(['S09', 'S10', 'S50', 'S51']);
    expect((m.scenarios as any[])[1]).toEqual({ id: 'S10', name: '十', feature: 'F01' });
    expect(ids(m.features)).toEqual(['F01', 'F02', 'F03']);
    expect((m.features as any[])[0]).toEqual({ id: 'F01', name: '甲', module: 'core' });
    // 输入不被修改
    expect(A.scenarios).toHaveLength(3);
    expect((O.scenarios as any[])[1].feature).toBe('F02');
  });

  it('UT-S44-06: 删除与新增并发时保留删除（两个方向与两边都删除）', () => {
    const O = baseRegistry();
    const withF03 = clone(O);
    (withF03.features as any[]).push({ id: 'F03', name: '丙', module: 'core' });
    const withoutF02 = clone(O);
    withoutF02.features = (withoutF02.features as any[]).filter(f => f.id !== 'F02');

    // ① 主分支删除 F02，本分支未动 F02、新增 F03
    const r1 = mergeRegistry(O, withF03, withoutF02);
    expect(r1.conflicts).toEqual([]);
    expect(ids(r1.merged!.features)).toEqual(['F01', 'F03']);
    // ② 方向相反
    const r2 = mergeRegistry(O, withoutF02, withF03);
    expect(r2.conflicts).toEqual([]);
    expect(ids(r2.merged!.features)).toEqual(['F01', 'F03']);
    // ③ 两边都删除
    const r3 = mergeRegistry(O, withoutF02, clone(withoutF02));
    expect(r3.conflicts).toEqual([]);
    expect(ids(r3.merged!.features)).toEqual(['F01']);
  });

  it('UT-S44-07: 删除与修改并发、两边改成不同内容、两边新增同键不同内容报冲突，且全有或全无', () => {
    const O = baseRegistry();
    const deleted = clone(O);
    deleted.scenarios = (deleted.scenarios as any[]).filter(s => s.id !== 'S10');
    const renamed = clone(O);
    (renamed.scenarios as any[])[1].name = '十（改）';
    const refiled = clone(O);
    (refiled.scenarios as any[])[1].feature = 'F01';

    // ① A 删除、B 修改；② A 修改、B 删除
    expect(mergeRegistry(O, deleted, renamed).conflicts).toEqual([{ field: 'scenarios', key: 'S10', kind: 'delete-modify' }]);
    expect(mergeRegistry(O, renamed, deleted).conflicts).toEqual([{ field: 'scenarios', key: 'S10', kind: 'delete-modify' }]);
    // ③ 两边改成不同内容
    const r3 = mergeRegistry(O, renamed, refiled);
    expect(r3.conflicts).toEqual([{ field: 'scenarios', key: 'S10', kind: 'both-modified' }]);
    expect(r3.merged).toBeNull();
    expect(r3.ops).toEqual([]);
    // ④ 两边新增 S44 而 name 不同
    const a4 = clone(O); (a4.scenarios as any[]).push({ id: 'S44', name: '甲案' });
    const b4 = clone(O); (b4.scenarios as any[]).push({ id: 'S44', name: '乙案' });
    expect(mergeRegistry(O, a4, b4).conflicts).toEqual([{ field: 'scenarios', key: 'S44', kind: 'both-added-different' }]);
    // ⑤ 两边新增内容完全相同的 S44（键顺序不同不算不同）
    const b5 = clone(O); (b5.scenarios as any[]).push({ name: '甲案', id: 'S44' });
    const r5 = mergeRegistry(O, a4, b5);
    expect(r5.conflicts).toEqual([]);
    expect(ids(r5.merged!.scenarios).filter(id => id === 'S44')).toHaveLength(1);

    // 冲突项按 field、key 升序；出现任何冲突都不产出合并结果（即使另有可合并的改动）
    const aMany = clone(renamed);
    (aMany.features as any[])[1].name = '乙（A）';
    (aMany.scenarios as any[]).push({ id: 'S50', name: '五十' });
    const bMany = clone(refiled);
    (bMany.features as any[])[1].name = '乙（B）';
    (bMany.scenarios as any[])[0].name = '九（B）';
    const many = mergeRegistry(O, aMany, bMany);
    expect(many.conflicts).toEqual([
      { field: 'features', key: 'F02', kind: 'both-modified' },
      { field: 'scenarios', key: 'S10', kind: 'both-modified' },
    ]);
    expect(many.merged).toBeNull();
  });

  it('UT-S44-07: ⑥ 真实同步——条目冲突时登记表不写回、列入剩余冲突、HEAD 不前移', () => {
    const O = baseRegistry();
    const fx = new Fixture({ registry: stringifyYaml(O) });
    const { prop } = fx.diverge(
      f => {
        const a = clone(O);
        (a.scenarios as any[])[1].name = '十（A）';
        (a.scenarios as any[]).push({ id: 'S50', name: '五十' });
        f.put(REGISTRY, stringifyYaml(a));
      },
      f => {
        const b = clone(O);
        (b.scenarios as any[])[1].feature = 'F01';
        f.put(REGISTRY, stringifyYaml(b));
      },
    );
    const plain = fx.plainMergeBytes(REGISTRY);
    const r = fx.sync();
    expect(r.status).toBe(2);
    expect(r.data!.result).toBe('conflicts');
    expect(r.data!.registry.status).toBe('conflict');
    expect(r.data!.registry.conflicts).toEqual([{ field: 'scenarios', key: 'S10', kind: 'both-modified' }]);
    expect(r.data!.remaining_conflicts).toContainEqual({ path: REGISTRY, category: 'registry', reason: 'registry-entry-conflict' });
    // CLI 未写回：字节等于同一构造下纯 git merge 的结果，不含只合并了一部分的结果
    expect(fx.read(REGISTRY)).toBe(plain);
    expect(fx.head()).toBe(prop);
    expect(r.data!.head_after).toBe(prop);
    expect(fx.merging()).toBe(true);
  });

  it('UT-S44-08: 计数器取较大者；两边都推进时提示；非整数按整值规则', () => {
    const O = baseRegistry();
    // ① O=44，A=45，B=46
    const a1 = clone(O); (a1.scenario_counter as any).next_id = 45;
    const b1 = clone(O); (b1.scenario_counter as any).next_id = 46;
    const r1 = mergeRegistry(O, a1, b1);
    expect(r1.conflicts).toEqual([]);
    expect((r1.merged!.scenario_counter as any).next_id).toBe(46);
    expect(r1.counters.find(c => c.name === 'scenario_counter')).toEqual(
      { name: 'scenario_counter', base: 44, ours: 45, theirs: 46, merged: 46, both_advanced: true });
    // ② A=46，B=44（B 未动）
    const a2 = clone(O); (a2.scenario_counter as any).next_id = 46;
    const r2 = mergeRegistry(O, a2, clone(O));
    expect((r2.merged!.scenario_counter as any).next_id).toBe(46);
    expect(r2.counters.find(c => c.name === 'scenario_counter')!.both_advanced).toBe(false);
    // ③ O 没有 decision_counter，只有 A 新增为 3
    const a3 = clone(O); a3.decision_counter = { next_id: 3 };
    const r3 = mergeRegistry(O, a3, clone(O));
    expect(r3.conflicts).toEqual([]);
    expect(r3.merged!.decision_counter).toEqual({ next_id: 3 });
    // ④ A 把 feature_counter.next_id 写成字符串：按整值规则处理，不抛异常
    const a4 = clone(O); (a4.feature_counter as any).next_id = '4';
    const b4 = clone(O); (b4.feature_counter as any).next_id = 5;
    const r4 = mergeRegistry(O, a4, b4);
    expect(r4.conflicts).toEqual([{ field: 'feature_counter', key: null, kind: 'both-modified' }]);
    expect(r4.counters.find(c => c.name === 'feature_counter')).toBeUndefined();
    const r4b = mergeRegistry(O, a4, clone(O));
    expect(r4b.conflicts).toEqual([]);
    expect((r4b.merged!.feature_counter as any).next_id).toBe('4');
  });

  it('UT-S44-09: 其余顶层字段按整个值做三方比较', () => {
    const O = baseRegistry();
    // ① 只有 B 改了 conventions
    const b1 = clone(O); b1.conventions = ['约定一', '约定二'];
    expect(mergeRegistry(O, clone(O), b1).merged!.conventions).toEqual(['约定一', '约定二']);
    // ② 只有 A 新增 deployment_gates
    const a2 = clone(O); a2.deployment_gates = { core: { smoke_required: true } };
    const r2 = mergeRegistry(O, a2, b1);
    expect(r2.conflicts).toEqual([]);
    expect(r2.merged!.deployment_gates).toEqual({ core: { smoke_required: true } });
    expect(r2.merged!.conventions).toEqual(['约定一', '约定二']);
    // ③ 两边把 tech_stack 改成相同的值
    const a3 = clone(O); a3.tech_stack = { language: 'ts', runtime: 'node' };
    const b3 = clone(O); b3.tech_stack = { runtime: 'node', language: 'ts' };
    const r3 = mergeRegistry(O, a3, b3);
    expect(r3.conflicts).toEqual([]);
    expect(r3.merged!.tech_stack).toEqual({ language: 'ts', runtime: 'node' });
    // ④ 两边把 tech_stack 改成不同的值
    const b4 = clone(O); b4.tech_stack = { language: 'go' };
    expect(mergeRegistry(O, a3, b4).conflicts).toEqual([{ field: 'tech_stack', key: null, kind: 'both-modified' }]);
    // ⑤ 只有 B 删除了一个 O 中存在的未知顶层字段
    const b5 = clone(O); delete b5.extra_unknown;
    const r5 = mergeRegistry(O, clone(O), b5);
    expect(r5.conflicts).toEqual([]);
    expect(Object.prototype.hasOwnProperty.call(r5.merged!, 'extra_unknown')).toBe(false);
  });
});

/** 把磁盘上已有、命中推断规则而尚未登记的文件全部登记进索引，使后续补录条数只反映用例构造的那一个。 */
function registerExistingCandidates(fx: Fixture, registry: RegistryRecord): void {
  const index = registry.resource_index as Array<{ path: string; desc: string }>;
  for (const rel of scanCandidateFiles(fx.root)) {
    const desc = inferResourceDesc(rel, 'en');
    if (desc && !index.some(e => e.path === rel)) index.push({ path: rel, desc: 'registered by fixture' });
  }
}

const P1 = 'logos/resources/prd/1-product-requirements/core-01-requirements.md';
const P2 = 'docs/reference/guide.md';
const P3 = 'logos/resources/prd/1-product-requirements/core-02-export.md';
const P4 = 'logos/resources/prd/1-product-requirements/core-03-import.md';
const P5 = 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S50-export.md';
const MANUAL = '需求主文档。涉及导出范围、权限边界与验收口径时必读；改动前先核对第三章的场景总览。';

/** UT-S44-10 的构造：O 含人工描述 P1 与扫描范围外的 P2。 */
function indexFixture(rewriteP1OnProposal: boolean): { fx: Fixture; O: RegistryRecord } {
  const O: RegistryRecord = {
    project: { name: 'x' },
    resource_index: [{ path: P1, desc: MANUAL }, { path: P2, desc: '团队手册（仓库外部流程说明）' }],
    conventions: ['约定'],
  };
  const seeded = new Fixture({ registry: stringifyYaml(O) });
  seeded.put(P1, '# requirements\n');
  seeded.put(P2, '# guide\n');
  registerExistingCandidates(seeded, O);
  seeded.put(REGISTRY, stringifyYaml(O));
  seeded.commit('O with index');
  seeded.diverge(
    f => {
      const a = clone(O);
      const idx = a.resource_index as Array<{ path: string; desc: string }>;
      if (rewriteP1OnProposal) idx[0].desc = `${MANUAL}（本分支补充：新增导出场景）`;
      idx.push({ path: P3, desc: '导出需求（人工描述）' });
      f.put(P3, '# export\n');
      f.put(P5, '# S50\n'); // 命中推断规则，但两边都未登记
      f.put(REGISTRY, stringifyYaml(a));
    },
    f => {
      const b = clone(O);
      (b.resource_index as Array<{ path: string; desc: string }>).push({ path: P4, desc: '导入需求（人工描述）' });
      f.put(P4, '# import\n');
      f.put(REGISTRY, stringifyYaml(b));
    },
  );
  return { fx: seeded, O };
}

describe('S44 登记表条目合并 — 真实同步', () => {
  it('UT-S44-10: 资源索引的人工描述与扫描范围外的登记项保留，合并后只补录遗漏', () => {
    const { fx } = indexFixture(true);
    const r = fx.sync();
    expect(r.status).toBe(0);
    expect(r.data!.registry.status).toBe('merged');
    expect(r.data!.registry.index_backfilled).toBe(1);
    const index = (parseYaml(fx.read(REGISTRY)) as RegistryRecord).resource_index as Array<{ path: string; desc: string }>;
    const desc = (p: string): string | undefined => index.find(e => e.path === p)?.desc;
    expect(desc(P1)).toBe(`${MANUAL}（本分支补充：新增导出场景）`);
    expect(desc(P2)).toBe('团队手册（仓库外部流程说明）');
    expect(desc(P3)).toBe('导出需求（人工描述）');
    expect(desc(P4)).toBe('导入需求（人工描述）');
    // P5 被补录一条；P1～P4 没有任何一条被替换为推断出的通用描述
    expect(desc(P5)).toBe(inferResourceDesc(P5, 'en'));
    for (const p of [P1, P3, P4]) expect(desc(p)).not.toBe(inferResourceDesc(p, 'en'));
    expect(index.filter(e => e.path === P1)).toHaveLength(1);
    expect(fx.git(['status', '--porcelain'])).toBe('');

    // 另一用例：两边都没改 P1 时 P1 逐字不变
    const other = indexFixture(false).fx;
    expect(other.sync().data!.registry.status).toBe('merged');
    const otherIndex = (parseYaml(other.read(REGISTRY)) as RegistryRecord).resource_index as Array<{ path: string; desc: string }>;
    expect(otherIndex.find(e => e.path === P1)!.desc).toBe(MANUAL);
  }, 30_000);

  it('UT-S44-11: 条目合并的适用条件——not-needed 与 skipped 的三种原因', () => {
    const O = baseRegistry();
    const changed = (mutate: (r: RegistryRecord) => void): string => { const v = clone(O); mutate(v); return stringifyYaml(v); };
    const addS50 = (r: RegistryRecord): void => { (r.scenarios as any[]).push({ id: 'S50', name: '五十' }); };
    const addS51 = (r: RegistryRecord): void => { (r.scenarios as any[]).push({ id: 'S51', name: '五一' }); };

    // ① 只有 A 改过；② 只有 B 改过
    const f1 = new Fixture({ registry: stringifyYaml(O) });
    f1.diverge(f => f.put(REGISTRY, changed(addS50)), f => f.put('main.txt', 'm\n'));
    const r1 = f1.sync();
    expect(r1.data!.registry).toMatchObject({ status: 'not-needed', reason: null });
    expect(f1.read(REGISTRY)).toBe(changed(addS50));
    const f2 = new Fixture({ registry: stringifyYaml(O) });
    f2.diverge(f => f.put('prop.txt', 'p\n'), f => f.put(REGISTRY, changed(addS51)));
    const r2 = f2.sync();
    expect(r2.data!.registry).toMatchObject({ status: 'not-needed', reason: null });
    expect(f2.read(REGISTRY)).toBe(changed(addS51));

    /** skipped 的共同断言：CLI 未写回（字节等于纯 git merge 的结果）；git 报冲突时列入剩余冲突。 */
    const expectSkipped = (fx: Fixture, reason: string): void => {
      const plain = fx.plainMergeBytes(REGISTRY);
      const r = fx.sync();
      expect(r.data!.registry).toMatchObject({ status: 'skipped', reason, counters: [], conflicts: [], index_backfilled: 0 });
      expect(fx.exists(REGISTRY) ? fx.read(REGISTRY) : null).toBe(plain);
      const unmerged = fx.git(['diff', '--name-only', '--diff-filter=U']).split('\n').includes(REGISTRY);
      const listed = (r.data!.remaining_conflicts as any[]).find(c => c.path === REGISTRY);
      if (unmerged) expect(listed).toEqual({ path: REGISTRY, category: 'registry', reason: 'git-conflict' });
      else expect(listed).toBeUndefined();
    };

    // ③ O 中不存在登记表，两边各自新增
    const f3 = new Fixture();
    f3.remove(REGISTRY);
    f3.commit('O without registry');
    f3.diverge(f => f.put(REGISTRY, changed(addS50)), f => f.put(REGISTRY, changed(addS51)));
    expectSkipped(f3, 'missing');
    // ④ B 的登记表不是合法 YAML
    const f4 = new Fixture({ registry: stringifyYaml(O) });
    f4.diverge(f => f.put(REGISTRY, changed(addS50)), f => f.put(REGISTRY, 'project: [unclosed\n  - : :\n'));
    expectSkipped(f4, 'unparsable');
    // ⑤ A 的 scenarios 中有两条 id 相同的条目
    const f5 = new Fixture({ registry: stringifyYaml(O) });
    f5.diverge(
      f => f.put(REGISTRY, changed(r => { (r.scenarios as any[]).push({ id: 'S10', name: '重复' }); })),
      f => f.put(REGISTRY, changed(addS51)),
    );
    expectSkipped(f5, 'shape-unsupported');
    // ⑥ A 的 features 不是数组
    const f6 = new Fixture({ registry: stringifyYaml(O) });
    f6.diverge(f => f.put(REGISTRY, changed(r => { r.features = { F01: '甲' }; })), f => f.put(REGISTRY, changed(addS51)));
    expectSkipped(f6, 'shape-unsupported');
  }, 60_000);

  it('UT-S44-12: 写回保真——注释与原有顺序保留，键顺序不同不算修改，主分支新增追加在末尾', () => {
    const base = [
      'project:',
      '  name: "x"',
      '',
      '# 场景编号全局唯一',
      'scenario_counter:',
      '  next_id: 50',
      '',
      'scenarios:',
      '  # 初始化',
      '  - id: S01',
      '    name: 初始化',
      '    feature: F01',
      '  - id: S09',
      '    name: 变更',
      '    feature: F04',
      '',
      'resource_index: []',
      '',
      'conventions:',
      '  - "约定"',
      '',
    ].join('\n');
    const fx = new Fixture({ registry: base });
    fx.diverge(
      f => f.put(REGISTRY, base.replace('    feature: F04\n', '    feature: F04\n  - id: S50\n    name: 导出\n')),
      // B 只调整了 S09 条目内键的书写顺序（值不变），并新增 S51
      f => f.put(REGISTRY, base.replace(
        '  - id: S09\n    name: 变更\n    feature: F04\n',
        '  - feature: F04\n    name: 变更\n    id: S09\n  - id: S51\n    name: 导入\n',
      )),
    );
    const r = fx.sync();
    expect(r.status).toBe(0);
    expect(r.data!.registry).toMatchObject({ status: 'merged', conflicts: [] });
    const text = fx.read(REGISTRY);
    const parsed = parseYaml(text) as RegistryRecord;
    expect(ids(parsed.scenarios)).toEqual(['S01', 'S09', 'S50', 'S51']);
    expect(text).toContain('# 场景编号全局唯一');
    expect(text).toContain('  # 初始化');
    // 键顺序不同的条目不被判为修改：S09 保持本分支的书写
    expect(text).toContain('  - id: S09\n    name: 变更\n    feature: F04\n');
    expect(text.indexOf('id: S50')).toBeLessThan(text.indexOf('id: S51'));
    expect(text.indexOf('id: S51')).toBeLessThan(text.indexOf('conventions:'));
  });

  it('ST-S44-03: 登记表的删除、新增与人工索引描述在同步中保留；删除与修改并发时报冲突且不写回', () => {
    const O: RegistryRecord = {
      project: { name: 'x' },
      feature_counter: { next_id: 3 },
      features: [{ id: 'F01', name: '初始化', module: 'core' }, { id: 'F02', name: '观测', module: 'core' }],
      scenarios: [{ id: 'S01', name: '初始化', feature: 'F01' }, { id: 'S11', name: '查看进度', feature: 'F02' }],
      resource_index: [{ path: P1, desc: MANUAL }],
      conventions: ['约定'],
    };
    const build = (alsoRenameF02: boolean): { fx: Fixture; prop: string } => {
      const fx = new Fixture({ registry: stringifyYaml(O) });
      fx.put(P1, '# requirements\n');
      registerExistingCandidates(fx, O);
      fx.put(REGISTRY, stringifyYaml(O));
      fx.commit('O');
      const { prop } = fx.diverge(
        f => {
          const a = clone(O);
          (a.features as any[]).push({ id: 'F03', name: '导出', module: 'core' });
          (a.scenarios as any[]).push({ id: 'S50', name: '导出', feature: 'F03' });
          (a.resource_index as any[]).push({ path: P2, desc: '团队手册（仓库外部流程说明）' });
          if (alsoRenameF02) (a.features as any[])[1].name = '观测与诊断';
          f.put(P2, '# guide\n');
          f.put(REGISTRY, stringifyYaml(a));
        },
        f => {
          // main 删除 F02，并把原属 F02 的场景改归 F01
          const b = clone(O);
          b.features = (b.features as any[]).filter(x => x.id !== 'F02');
          (b.scenarios as any[])[1].feature = 'F01';
          f.put(REGISTRY, stringifyYaml(b));
        },
      );
      return { fx, prop };
    };

    // ① 第一个仓库：无冲突
    const first = build(false);
    const r1 = first.fx.sync();
    expect(r1.status).toBe(0);
    expect(r1.data!.result).toBe('synced');
    const merged = parseYaml(first.fx.read(REGISTRY)) as RegistryRecord;
    expect(ids(merged.features)).toEqual(['F01', 'F03']);
    expect((merged.scenarios as any[]).find(s => s.id === 'S11').feature).toBe('F01');
    expect(ids(merged.scenarios)).toContain('S50');
    const index = merged.resource_index as Array<{ path: string; desc: string }>;
    expect(index.find(e => e.path === P1)!.desc).toBe(MANUAL);
    expect(index.find(e => e.path === P2)!.desc).toBe('团队手册（仓库外部流程说明）');

    // ② 第二个仓库：proposal/a 也修改了 F02 的名称
    const second = build(true);
    const plain = second.fx.plainMergeBytes(REGISTRY);
    const r2 = second.fx.sync();
    expect(r2.status).toBe(2);
    expect(r2.data!.result).toBe('conflicts');
    expect(r2.data!.registry.conflicts).toContainEqual({ field: 'features', key: 'F02', kind: 'delete-modify' });
    expect(second.fx.read(REGISTRY)).toBe(plain);
    expect(second.fx.head()).toBe(second.prop);
  }, 30_000);
});
