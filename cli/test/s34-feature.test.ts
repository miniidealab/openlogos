/**
 * S34 — 管理 feature 分组（add-feature-model）。切片1：status/next 按 feature 分组 + 条件版本发射。
 *
 * 规范源：logos/resources/test/core-S34-test-cases.md、spec/cli-json-output.md §1.4、
 * logos/resources/prd/3-technical-plan/1-architecture §二十。
 *
 * 本文件覆盖切片1 的用例：UT-S34-01/02/03/06/07/09/10/12/13/14 + ST-S34-02。
 * （feature list = 切片2 / feature-backfill = 切片3，不在本文件。）
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd } from './helpers.js';
import { readProjectYaml } from '../src/lib/project-yaml.js';
import type { ProjectYamlFeature, ProjectYamlScenario } from '../src/lib/project-yaml.js';
import { buildModuleFeatures, UNGROUPED_FEATURE_ID } from '../src/lib/feature-grouping.js';
import { collectStatusData, status } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import { CONTRACT_VERSION, CONTRACT_VERSION_WITH_FEATURES } from '../src/lib/step-registry.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

/** 运行一个命令（status 同步 / next 异步），捕获其完整 stdout（console.log 逐行拼接）。 */
async function runCmd(root: string, fn: () => void | Promise<void>): Promise<string> {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  try {
    await fn();
  } finally {
    cap.restore();
    restoreCwd();
  }
  return cap.logs.join('\n');
}

function projectRoot(yamlObj: Record<string, unknown>): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  cleanups.push(cleanup);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml(yamlObj, { lineWidth: 0 }));
  return root;
}

const CORE_MOD = { id: 'core', name: 'Core', lifecycle: 'initial' };
const ADMIN_MOD = { id: 'admin', name: 'Admin', lifecycle: 'initial' };

function sc(id: string, module: string, extra: Partial<ProjectYamlScenario> = {}): Record<string, unknown> {
  return { id, name: `场景 ${id}`, module, ...extra };
}

describe('S34 — project-yaml 解析（features / feature_counter / scenario.feature）', () => {
  it('UT-S34-01: 解析 features[] 与 feature_counter 与 scenario.feature', () => {
    const root = projectRoot({
      project: { name: 't' },
      feature_counter: { next_id: 4 },
      features: [{ id: 'F01', name: '项目生命周期', module: 'core', spec: 'core-01' }],
      modules: [CORE_MOD],
      scenarios: [sc('S01', 'core', { feature: 'F01' })],
    });
    const data = readProjectYaml(root).data!;
    expect(data.feature_counter).toEqual({ next_id: 4 });
    expect(data.features).toEqual([{ id: 'F01', name: '项目生命周期', module: 'core', spec: 'core-01' }]);
    const s01 = data.scenarios!.find((s) => s.id === 'S01')!;
    expect(s01.feature).toBe('F01');
    expect(s01.name).toBe('场景 S01');
  });

  it('UT-S34-02: 旧 yaml 无 feature 字段向后兼容（字段 undefined、不报错）', () => {
    const root = projectRoot({
      project: { name: 't' },
      modules: [CORE_MOD],
      scenarios: [{ id: 'S01', name: 'x', module: 'core' }],
    });
    const data = readProjectYaml(root).data!;
    expect(data.features).toBeUndefined();
    expect(data.feature_counter).toBeUndefined();
    expect(data.scenarios![0].feature).toBeUndefined();
  });
});

describe('S34 — feature 分组派生（buildModuleFeatures）', () => {
  it('UT-S34-03: 重复 feature id 取 YAML 首现（同 module 内 + 项目全局；不抛错、CLI 不改写 yaml）', () => {
    // ① 同 module 重复：取首现
    const sameModule: ProjectYamlFeature[] = [
      { id: 'F01', name: '首现', module: 'core' },
      { id: 'F01', name: '重复应忽略', module: 'core' },
    ];
    const g1 = buildModuleFeatures('core', [sc('S01', 'core', { feature: 'F01' }) as ProjectYamlScenario], sameModule)!;
    expect(g1.filter((g) => g.id === 'F01')).toHaveLength(1);
    expect(g1.find((g) => g.id === 'F01')!.name).toBe('首现');

    // ② 首现去重是**项目全局**（delta-F3）：F01 全局首现属 admin，core 再声明 F01/core 应忽略。
    //    core 场景引用 F01 → 权威属 admin → 跨 module 降级到未分组；admin 视角正常归组。
    const crossModule: ProjectYamlFeature[] = [
      { id: 'F01', name: 'admin 首现', module: 'admin' },
      { id: 'F01', name: 'core 重复应忽略', module: 'core' },
    ];
    const coreGroups = buildModuleFeatures('core', [sc('S02', 'core', { feature: 'F01' }) as ProjectYamlScenario], crossModule)!;
    expect(coreGroups.map((g) => g.id)).toEqual([UNGROUPED_FEATURE_ID]);
    expect(coreGroups[0].scenarios.map((s) => s.id)).toEqual(['S02']);
    const adminGroups = buildModuleFeatures('admin', [sc('S03', 'admin', { feature: 'F01' }) as ProjectYamlScenario], crossModule)!;
    expect(adminGroups.find((g) => g.id === 'F01')!.name).toBe('admin 首现');
    expect(adminGroups.find((g) => g.id === 'F01')!.scenarios.map((s) => s.id)).toEqual(['S03']);
  });

  it('UT-S34-06: 有注册 feature 时三态降级（缺失/未知/跨 module）入未分组桶', () => {
    const features: ProjectYamlFeature[] = [
      { id: 'F01', name: 'A', module: 'core' },
      { id: 'F02', name: 'B', module: 'admin' }, // 跨 module（属 admin）
    ];
    const scenarios = [
      sc('S01', 'core', { feature: 'F01' }),   // 归 F01
      sc('S02', 'core'),                        // 缺失 → 未分组
      sc('S03', 'core', { feature: 'F99' }),    // 未知 → 未分组
      sc('S04', 'core', { feature: 'F02' }),    // 跨 module → 未分组
    ] as ProjectYamlScenario[];
    const groups = buildModuleFeatures('core', scenarios, features)!;
    const f01 = groups.find((g) => g.id === 'F01')!;
    const ung = groups.find((g) => g.id === UNGROUPED_FEATURE_ID)!;
    expect(f01.scenarios.map((s) => s.id)).toEqual(['S01']);
    expect(ung.scenarios.map((s) => s.id)).toEqual(['S02', 'S03', 'S04']);
  });

  it('UT-S34-07: features 按 YAML 声明顺序 + 成员按场景顺序 + __ungrouped__ 恒末位', () => {
    const features: ProjectYamlFeature[] = [
      { id: 'F02', name: 'B', module: 'core' },
      { id: 'F01', name: 'A', module: 'core' },
    ];
    const scenarios = [
      sc('S01', 'core', { feature: 'F01' }),
      sc('S02', 'core', { feature: 'F02' }),
      sc('S03', 'core'), // 未分组
    ] as ProjectYamlScenario[];
    const groups = buildModuleFeatures('core', scenarios, features)!;
    expect(groups.map((g) => g.id)).toEqual(['F02', 'F01', UNGROUPED_FEATURE_ID]);
    // 空成员保留 + 成员按 scenarios[] 顺序
    expect(groups[0].scenarios.map((s) => s.id)).toEqual(['S02']);
    expect(groups[1].scenarios.map((s) => s.id)).toEqual(['S01']);
    expect(groups[2].scenarios.map((s) => s) ).toEqual([{ id: 'S03', name: '场景 S03' }]);
  });

  it('UT-S34-12: 无注册 feature + 未知引用仍输出降级桶（不省略）', () => {
    const scenarios = [
      sc('S01', 'core', { feature: 'F99' }), // 未知
      sc('S02', 'core'),
    ] as ProjectYamlScenario[];
    const groups = buildModuleFeatures('core', scenarios, []); // 无注册 feature
    expect(groups).toBeDefined();
    expect(groups!.map((g) => g.id)).toEqual([UNGROUPED_FEATURE_ID]);
    expect(groups![0].scenarios.map((s) => s.id)).toEqual(['S01', 'S02']);
  });

  it('UT-S34-13: 无注册 feature + 跨 module 引用仍输出降级桶', () => {
    const features: ProjectYamlFeature[] = [{ id: 'F01', name: 'A', module: 'admin' }];
    const scenarios = [sc('S01', 'core', { feature: 'F01' })] as ProjectYamlScenario[];
    const groups = buildModuleFeatures('core', scenarios, features); // core 无注册 feature，F01 属 admin
    expect(groups).toBeDefined();
    expect(groups!.map((g) => g.id)).toEqual([UNGROUPED_FEATURE_ID]);
    expect(groups![0].scenarios.map((s) => s.id)).toEqual(['S01']);
  });

  it('纯 pre-feature module：省略（undefined）', () => {
    const groups = buildModuleFeatures('core', [sc('S01', 'core') as ProjectYamlScenario], undefined);
    expect(groups).toBeUndefined();
  });
});

describe('S34 — status/next 集成（条件版本 + 分组）', () => {
  it('UT-S34-09: 纯 pre-feature 四路命令逐字节 golden + 零漂移（status/next × text/json；含 contract.version）', async () => {
    // 冻结时钟 → envelope.timestamp 确定性，可对完整 envelope 做逐字节 golden（不丢弃字段）
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    try {
      const root = projectRoot({
        project: { name: 't' },
        modules: [CORE_MOD],
        scenarios: [sc('S01', 'core')],
      });
      const norm = (s: string) => s.split(root).join('<ROOT>'); // 临时根路径规范化，仅影响非契约展示字段
      const statusText = norm(await runCmd(root, () => status('text')));
      const statusJson = norm(await runCmd(root, () => status('json')));
      const nextText = norm(await runCmd(root, () => next('text')));
      const nextJson = norm(await runCmd(root, () => next('json')));

      // 四路逐字节 golden 锚（冻结时钟 → 完整输出确定性；未来任何漂移即失败）
      expect(statusText).toMatchSnapshot('status-text');
      expect(statusJson).toMatchSnapshot('status-json');
      expect(nextText).toMatchSnapshot('next-text');
      expect(nextJson).toMatchSnapshot('next-json');

      // 零漂移强断言：文本无 feature 段、JSON contract.version=1.0.0 且 data 无 features 键
      for (const txt of [statusText, nextText]) expect(txt).not.toContain('🗂 features');
      for (const jsonOut of [statusJson, nextJson]) {
        const env = JSON.parse(jsonOut);
        expect(env.data.contract.version).toBe('1.0.0');
        expect(JSON.stringify(env.data)).not.toContain('"features"');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('UT-S34-10: 条件版本发射（含 features → 1.1.0，无 features → 1.0.0）+ schema superset 支持两版', () => {
    const withFeat = projectRoot({
      project: { name: 't' },
      features: [{ id: 'F01', name: 'A', module: 'core' }],
      modules: [CORE_MOD],
      scenarios: [sc('S01', 'core', { feature: 'F01' })],
    });
    const dWith = collectStatusData(withFeat);
    expect(dWith.contract.version).toBe(CONTRACT_VERSION_WITH_FEATURES); // 1.1.0
    expect(dWith.modules![0].features!.map((f) => f.id)).toEqual(['F01']);

    const noFeat = projectRoot({
      project: { name: 't' },
      modules: [CORE_MOD],
      scenarios: [sc('S01', 'core')],
    });
    expect(collectStatusData(noFeat).contract.version).toBe(CONTRACT_VERSION); // 1.0.0

    // 打包 schema 为 superset：x-contract-version = 1.1.0，version enum 含两版
    const repo = join(process.cwd(), '..');
    for (const name of ['status', 'next'] as const) {
      const schema = JSON.parse(readFileSync(join(repo, 'spec', 'schema', `${name}.schema.json`), 'utf-8'));
      expect(schema['x-contract-version']).toBe(CONTRACT_VERSION_WITH_FEATURES);
      expect(schema.$defs.contract.properties.version.enum).toEqual([CONTRACT_VERSION, CONTRACT_VERSION_WITH_FEATURES]);
    }
  });

  it('UT-S34-14: schema allOf 条件约束反例（1.0.0 禁带 features / 1.1.0 可带 / 无 features 两版均可）', async () => {
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const repo = join(process.cwd(), '..');
    const feat = [{ id: 'F01', name: 'A', spec: null, scenarios: [] as unknown[] }];
    for (const name of ['status', 'next'] as const) {
      const schema = JSON.parse(readFileSync(join(repo, 'spec', 'schema', `${name}.schema.json`), 'utf-8'));
      const ajv = new Ajv2020({ strict: false, allowUnionTypes: true });
      addFormats(ajv);
      const validate = ajv.compile(schema);
      // next 的 module 有额外必填字段，用 active_change/proposal_step=null 满足基础必填、不触发其它 allOf
      const modBase = name === 'next'
        ? { id: 'core', active_change: null, proposal_step: null }
        : { id: 'core' };
      const withFeat = { contract: { version: '1.0.0' }, modules: [{ ...modBase, features: feat }] };
      const withFeat11 = { contract: { version: '1.1.0' }, modules: [{ ...modBase, features: feat }] };
      const noFeat10 = { contract: { version: '1.0.0' }, modules: [modBase] };
      expect(validate(withFeat)).toBe(false);   // 1.0.0 禁带 features
      expect(validate(withFeat11)).toBe(true);   // 1.1.0 可带 features
      expect(validate(noFeat10)).toBe(true);     // 1.0.0 无 features 合法

      // feature item 正反例（经**根级组合约束**校验完整 module 响应，delta-F4/F8）：均 version=1.1.0（含 features）
      const resp = (fItem: unknown) => ({ contract: { version: '1.1.0' }, modules: [{ ...modBase, features: [fItem] }] });
      // 合法：F01 / F100 / __ungrouped__，spec 可为 null 或字符串
      expect(validate(resp({ id: 'F01', name: 'x', spec: null, scenarios: [] }))).toBe(true);
      expect(validate(resp({ id: 'F100', name: 'x', spec: 'core-01', scenarios: [] }))).toBe(true);
      expect(validate(resp({ id: '__ungrouped__', name: '未分组', spec: null, scenarios: [] }))).toBe(true);
      // 非法 id：F00 / F001（前导零）/ F0 → 正则拒
      expect(validate(resp({ id: 'F00', name: 'x', spec: null, scenarios: [] }))).toBe(false);
      expect(validate(resp({ id: 'F001', name: 'x', spec: null, scenarios: [] }))).toBe(false);
      expect(validate(resp({ id: 'F0', name: 'x', spec: null, scenarios: [] }))).toBe(false);
      // 缺 spec 键 → required 拒
      expect(validate(resp({ id: 'F01', name: 'x', scenarios: [] }))).toBe(false);
    }
  });

  it('ST-S34-02: 四路命令带 feature 同构呈现（text+json）+ 纯 pre-feature 四路零漂移', async () => {
    // ① 有 feature 项目：status 与 next 的 text 与 json 四路均体现 F01 + __ungrouped__（同构）
    const withFeat = projectRoot({
      project: { name: 't' },
      features: [{ id: 'F01', name: '能力A', module: 'core', spec: 'core-01' }],
      modules: [CORE_MOD, ADMIN_MOD],
      scenarios: [sc('S01', 'core', { feature: 'F01' }), sc('S02', 'core'), sc('S03', 'admin')],
    });
    const sText = await runCmd(withFeat, () => status('text'));
    const sJson = await runCmd(withFeat, () => status('json'));
    const nText = await runCmd(withFeat, () => next('text'));
    const nJson = await runCmd(withFeat, () => next('json'));

    // 文本四路：feature 段 + F01 + 未分组均可见
    for (const txt of [sText, nText]) {
      expect(txt).toContain('🗂 features');
      expect(txt).toContain('F01 能力A');
      expect(txt).toContain('未分组');
    }
    // JSON 四路：contract.version=1.1.0，core.features = [F01, __ungrouped__]
    for (const j of [sJson, nJson]) {
      const d = JSON.parse(j).data;
      expect(d.contract.version).toBe('1.1.0');
      const core = d.modules.find((m: { id: string }) => m.id === 'core');
      expect(core.features.map((f: { id: string }) => f.id)).toEqual(['F01', UNGROUPED_FEATURE_ID]);
    }

    // ② 纯 pre-feature 项目：四路零漂移（无 feature 段/键、contract.version 保持 1.0.0）
    const pre = projectRoot({
      project: { name: 't' },
      modules: [CORE_MOD],
      scenarios: [sc('S01', 'core')],
    });
    expect(await runCmd(pre, () => status('text'))).not.toContain('🗂 features');
    expect(await runCmd(pre, () => next('text'))).not.toContain('🗂 features');
    for (const fn of [() => status('json'), () => next('json')]) {
      const d = JSON.parse(await runCmd(pre, fn)).data;
      expect(d.contract.version).toBe('1.0.0');
      expect(JSON.stringify(d)).not.toContain('"features"');
    }
  });
});
