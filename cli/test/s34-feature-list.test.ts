/**
 * S34 — 管理 feature 分组（add-feature-model）。切片2：`openlogos feature list` 只读命令。
 *
 * 规范源：logos/resources/test/core-S34-test-cases.md、spec/cli-json-output.md §1.4。
 * 覆盖：UT-S34-08 + ST-S34-01 + ST-S34-EX-01 + ST-S34-EX-02。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { featureList } from '../src/commands/feature.js';
import { collectStatusData } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import { UNGROUPED_FEATURE_ID } from '../src/lib/feature-grouping.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function projectRoot(yamlObj: Record<string, unknown>): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  cleanups.push(cleanup);
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml(yamlObj, { lineWidth: 0 }));
  return root;
}

/** 捕获 featureList 的 stdout/stderr（JSON 走 process.stdout/stderr.write）+ process.exit。 */
function runFeatureList(root: string, format: 'text' | 'json', moduleArg?: string): { stdout: string; stderr: string; threw: boolean } {
  const restoreCwd = mockCwd(root);
  const exitSpy = mockProcessExit();
  const outChunks: string[] = [];
  const errChunks: string[] = [];
  const oW = process.stdout.write.bind(process.stdout);
  const eW = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: unknown) => { outChunks.push(String(c)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((c: unknown) => { errChunks.push(String(c)); return true; }) as typeof process.stderr.write;
  let threw = false;
  try {
    featureList(format, moduleArg);
  } catch {
    threw = true;
  } finally {
    process.stdout.write = oW;
    process.stderr.write = eW;
    exitSpy.mockRestore();
    restoreCwd();
  }
  return { stdout: outChunks.join(''), stderr: errChunks.join(''), threw };
}

function nextJson(root: string): any {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  try { next('json'); } finally { cap.restore(); restoreCwd(); }
  return JSON.parse(cap.logs[0]).data;
}

describe('S34 — feature list 命令', () => {
  it('UT-S34-08: 已登记空成员 feature 仍展示（status/next/feature list 一致，均含 F01 且 scenarios:[]）', () => {
    const root = projectRoot({
      project: { name: 't' },
      features: [
        { id: 'F01', name: 'A', module: 'core' },
        { id: 'F02', name: 'B', module: 'core' },
      ],
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
      scenarios: [{ id: 'S01', name: '场景 S01', module: 'core', feature: 'F02' }], // 全部归属 → 无 __ungrouped__
    });
    // status
    const sCore = collectStatusData(root).modules!.find((m) => m.id === 'core')!;
    // next（透传）
    const nCore = nextJson(root).modules.find((m: any) => m.id === 'core');
    // feature list
    const fCore = JSON.parse(runFeatureList(root, 'json').stdout).data.modules.find((m: any) => m.id === 'core');

    for (const feats of [sCore.features, nCore.features, fCore.features]) {
      expect(feats.map((f: any) => f.id)).toEqual(['F01', 'F02']); // 空 feature F01 保留、无 __ungrouped__
      const f01 = feats.find((f: any) => f.id === 'F01');
      expect(f01.scenarios).toEqual([]);
    }
  });

  it('ST-S34-01: feature list --format json 输出分组（注册 feature + 空成员 + __ungrouped__）', () => {
    const root = projectRoot({
      project: { name: 't' },
      features: [
        { id: 'F01', name: 'A', module: 'core', spec: 'core-01' },
        { id: 'F02', name: 'B', module: 'core' },
      ],
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
      scenarios: [
        { id: 'S01', name: '场景 S01', module: 'core', feature: 'F01' },
        { id: 'S02', name: '场景 S02', module: 'core' }, // 未归属 → __ungrouped__
      ],
    });
    const res = runFeatureList(root, 'json');
    expect(res.threw).toBe(false);
    const env = JSON.parse(res.stdout);
    expect(env.command).toBe('feature list');
    const core = env.data.modules.find((m: any) => m.id === 'core');
    expect(core.features.map((f: any) => f.id)).toEqual(['F01', 'F02', UNGROUPED_FEATURE_ID]);
    expect(core.features[0]).toEqual({ id: 'F01', name: 'A', spec: 'core-01', scenarios: [{ id: 'S01', name: '场景 S01' }] });
    expect(core.features[1].scenarios).toEqual([]); // F02 空成员保留
    const ung = core.features.find((f: any) => f.id === UNGROUPED_FEATURE_ID);
    expect(ung.scenarios.map((s: any) => s.id)).toEqual(['S02']);
  });

  it('ST-S34-EX-01: feature list --module 未注册 → MODULE_NOT_FOUND、非零退出', () => {
    const root = projectRoot({
      project: { name: 't' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
      scenarios: [{ id: 'S01', name: 'x', module: 'core' }],
    });
    const res = runFeatureList(root, 'json', 'ghost');
    expect(res.threw).toBe(true); // process.exit(1) 抛出
    const env = JSON.parse(res.stderr);
    expect(env.error.code).toBe('MODULE_NOT_FOUND');
  });

  it('ST-S34-EX-02: 真正空 module 返回 [] / 有场景无注册 feature 返回 [{__ungrouped__}]', () => {
    const root = projectRoot({
      project: { name: 't' },
      modules: [
        { id: 'core', name: 'Core', lifecycle: 'initial' },
        { id: 'empty', name: 'Empty', lifecycle: 'initial' },
      ],
      scenarios: [{ id: 'S01', name: '场景 S01', module: 'core' }], // core 有场景、无注册 feature
    });
    const env = JSON.parse(runFeatureList(root, 'json').stdout);
    const core = env.data.modules.find((m: any) => m.id === 'core');
    const empty = env.data.modules.find((m: any) => m.id === 'empty');
    // ② 有场景无注册 → [{__ungrouped__}]
    expect(core.features.map((f: any) => f.id)).toEqual([UNGROUPED_FEATURE_ID]);
    expect(core.features[0].scenarios.map((s: any) => s.id)).toEqual(['S01']);
    // ① 真正空 module（无注册 feature 且无场景）→ []
    expect(empty.features).toEqual([]);
  });
});
