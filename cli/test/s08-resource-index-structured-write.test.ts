import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, mockCwd } from './helpers.js';
import { syncResourceIndex } from '../src/lib/sync-resource-index.js';

/**
 * S08 resource_index 结构化补录（fix-sync-yaml-and-overlay-version 切片1）
 *
 * 验收判据一律是「产物可被 CLI 捆绑的 yaml 解析器无异常解析」，不是「产物包含某段字符串」——
 * 后者正是既有回归放过本缺陷的原因（见 core-S08-test-cases.md 该节前言）。
 */

/** 受控写盘故障开关：仅对 logos-project.yaml 生效，供 ST-S08-31 注入 */
const writeFault = vi.hoisted(() => ({ active: false }));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: actual,
    writeFileSync: (path: Parameters<typeof actual.writeFileSync>[0], ...rest: unknown[]) => {
      if (writeFault.active && String(path).endsWith('logos-project.yaml')) {
        throw new Error('injected write failure');
      }
      return (actual.writeFileSync as (...a: unknown[]) => void)(path, ...rest);
    },
  };
});

/** `openlogos init` 真实模板的关键形态：resource_index 是空 flow sequence，其后跟 conventions 块 */
const INIT_TEMPLATE_YAML = `project:
  name: "repro-proj"
  description: ""
  methodology: "OpenLogos"

scenario_counter:
  next_id: 1

modules:
  - id: core
    name: 核心功能
    lifecycle: initial

resource_index: []

conventions:
  - "遵循 OpenLogos 三层推进模型（Why → What → How）"
  - "每次变更必须先创建 logos/changes/ 变更提案"
`;

const ARCH_DOC = 'logos/resources/prd/3-technical-plan/1-architecture/core-system-map.md';
const TEST_DOC = 'logos/resources/test/core-S99-test-cases.md';

const yamlPath = (root: string) => join(root, 'logos', 'logos-project.yaml');
const writeProjectYaml = (root: string, content: string) => writeFileSync(yamlPath(root), content);
const readProjectYaml = (root: string) => readFileSync(yamlPath(root), 'utf-8');

/** 放一份可被 desc 规则识别的文档，制造「未收录条目」 */
function placeDoc(root: string, rel: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, '# 文档\n\n复现用文档。\n');
}

/** 后置判据：产物可被解析，并返回解析结果供结构断言 */
function expectParsable(content: string): Record<string, unknown> {
  let parsed: unknown;
  expect(() => { parsed = parseYaml(content); }).not.toThrow();
  return parsed as Record<string, unknown>;
}

describe('S08 Unit Tests — resource_index 结构化补录', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    restoreCwd = mockCwd(root);
  });

  afterEach(() => {
    writeFault.active = false;
    restoreCwd();
    cleanup();
  });

  it('UT-S08-43: 空 flow sequence 形态首次补录后可解析', () => {
    writeProjectYaml(root, INIT_TEMPLATE_YAML);
    placeDoc(root, ARCH_DOC);

    expect(syncResourceIndex(root, 'zh').added).toBe(1);

    const content = readProjectYaml(root);
    const parsed = expectParsable(content);

    const index = parsed.resource_index as Array<{ path: string; desc: string }>;
    expect(Array.isArray(index)).toBe(true);
    expect(index).toHaveLength(1);
    expect(index[0].path).toBe(ARCH_DOC);
    expect(index[0].desc).toContain('系统架构概要');

    // 形态归一：不得再留下 `resource_index: []` 后跟 block 条目的非法结构
    expect(content).not.toMatch(/resource_index:\s*\[\]/);
    // 其它顶层键守恒
    expect(parsed.conventions).toHaveLength(2);
    expect(parsed.modules as unknown[]).toHaveLength(1);
  });

  it('UT-S08-44: 空 block 形态补录且既有条目守恒', () => {
    writeProjectYaml(root, INIT_TEMPLATE_YAML.replace(
      'resource_index: []',
      'resource_index:\n  - path: spec/existing.md\n    desc: 既有条目，必须逐字保留。',
    ));
    placeDoc(root, ARCH_DOC);

    expect(syncResourceIndex(root, 'zh').added).toBe(1);

    const parsed = expectParsable(readProjectYaml(root));
    const index = parsed.resource_index as Array<{ path: string; desc: string }>;
    expect(index).toHaveLength(2);
    // 既有条目在前且逐字不变，新条目追加其后
    expect(index[0]).toEqual({ path: 'spec/existing.md', desc: '既有条目，必须逐字保留。' });
    expect(index[1].path).toBe(ARCH_DOC);
  });

  it('UT-S08-45: 键缺失时创建键并追加，其它顶层键不受影响', () => {
    writeProjectYaml(root, INIT_TEMPLATE_YAML.replace('resource_index: []\n\n', ''));
    placeDoc(root, ARCH_DOC);

    expect(syncResourceIndex(root, 'zh').added).toBe(1);

    const content = readProjectYaml(root);
    const parsed = expectParsable(content);
    expect((parsed.resource_index as Array<{ path: string }>)[0].path).toBe(ARCH_DOC);

    // 其它顶层键仍在；新建键插在 conventions 之前，保持既有文档形状
    expect(parsed.conventions).toHaveLength(2);
    expect(parsed.scenario_counter).toEqual({ next_id: 1 });
    expect(content.indexOf('resource_index:')).toBeLessThan(content.indexOf('conventions:'));
  });

  it('UT-S08-46: 补录幂等且无键序/注释漂移', () => {
    writeProjectYaml(root, INIT_TEMPLATE_YAML);
    placeDoc(root, ARCH_DOC);
    placeDoc(root, TEST_DOC);

    expect(syncResourceIndex(root, 'zh').added).toBe(2);
    const afterFirst = readProjectYaml(root);

    // 第二、三次为 no-op，且文件逐字节不变
    expect(syncResourceIndex(root, 'zh').added).toBe(0);
    expect(syncResourceIndex(root, 'zh').added).toBe(0);
    expect(readProjectYaml(root)).toBe(afterFirst);

    const index = expectParsable(afterFirst).resource_index as Array<{ path: string }>;
    expect(index.map(e => e.path).sort()).toEqual([ARCH_DOC, TEST_DOC].sort());
  });
});

describe('S08 Scenario Tests — resource_index 结构化补录', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    restoreCwd = mockCwd(root);
  });

  afterEach(() => {
    writeFault.active = false;
    restoreCwd();
    cleanup();
  });

  it('ST-S08-30: Bug 复现路径三步闭环——init 模板 → 放文档 → sync → 仍可解析', () => {
    // ① init 真实模板形态
    writeProjectYaml(root, INIT_TEMPLATE_YAML);
    expect(readProjectYaml(root)).toContain('resource_index: []');

    // ② 放入一份可识别文档
    placeDoc(root, ARCH_DOC);

    // ③ 补录
    const result = syncResourceIndex(root, 'zh');
    expect(result.added).toBe(1);
    expect(result.degraded).toBeUndefined();

    // 读回：上游 Bug 报告此处为 "parse FAILED: A block sequence may not be used as an
    // implicit map key"；修复后必须无异常解析
    const parsed = expectParsable(readProjectYaml(root));
    const index = parsed.resource_index as Array<{ path: string; desc: string }>;
    expect(index).toHaveLength(1);
    expect(index[0].path).toBe(ARCH_DOC);
    expect(index[0].desc).toContain('系统架构概要');
  });

  it('ST-S08-31: 写盘环节故障与目标已降级时均零副作用', () => {
    // —— 分支 A：写盘环节注入故障（EX-S08-IDX-2 的落盘边界）——
    writeProjectYaml(root, INIT_TEMPLATE_YAML);
    placeDoc(root, ARCH_DOC);
    const beforeFault = readProjectYaml(root);

    writeFault.active = true;
    expect(() => syncResourceIndex(root, 'zh')).toThrow(/injected write failure/);
    writeFault.active = false;
    // 目标字节与执行前逐字节相同，不留半成品
    expect(readProjectYaml(root)).toBe(beforeFault);

    // —— 分支 B：目标已被历史缺陷写坏（EX-S08-IDX-1）——
    // 不进入补录、不代用户改写（决策 C01：处置权归人）
    writeProjectYaml(root, INIT_TEMPLATE_YAML.replace(
      'resource_index: []',
      `resource_index: []\n\n  - path: ${ARCH_DOC}\n    desc: 历史缺陷写入的非法条目。`,
    ));
    const beforeDegraded = readProjectYaml(root);
    expect(() => parseYaml(beforeDegraded)).toThrow(); // 前提：该样本确实不可解析

    placeDoc(root, TEST_DOC);
    const result = syncResourceIndex(root, 'zh');
    expect(result.degraded).toBe(true);
    expect(result.added).toBe(0);
    expect(readProjectYaml(root)).toBe(beforeDegraded);
  });
});
