import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, mockCwd, captureConsole } from './helpers.js';
import { formatYamlDegradedLines, readProjectYaml } from '../src/lib/project-yaml.js';
import { status } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';

/**
 * S11 YAML 降级告警可见性（fix-sync-yaml-and-overlay-version 切片2）
 *
 * 恢复器只抢救 modules / scenarios / deployment_gates，`resource_index` 等字段随降级丢失。
 * 恢复是为了让 CLI 在部分损坏下仍可用，**不是**为了让损坏不可见——最坏失败模式正是
 * 「能跑但数据已丢」（架构 §三十八.3）。
 */

const yamlPath = (root: string) => join(root, 'logos', 'logos-project.yaml');
const readYaml = (root: string) => readFileSync(yamlPath(root), 'utf-8');
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** 可恢复态：modules 完整，resource_index 处构造隐式 map key 错误 */
function writeRecoverableYaml(root: string): void {
  writeFileSync(yamlPath(root), [
    'project:',
    '  name: degraded-app',
    'modules:',
    '  - id: core',
    '    name: 核心功能',
    '    lifecycle: launched',
    'resource_index:',
    '  - path: logos/resources/test/core-S11-test-cases.md',
    '    desc: 测试用例',
    '  - logos/resources/test/core-S16-test-cases.md',
    '    desc: 隐式 map key 错误，模拟真实坏 YAML',
    '',
  ].join('\n'));
}

/** 不可恢复态：整体损坏，无任何模块可恢复 */
function writeUnrecoverableYaml(root: string): void {
  writeFileSync(yamlPath(root), [
    'project:',
    '  name: broken-app',
    '\tmodules: [',
    '  - id: core',
    ' bad: : :',
    '',
  ].join('\n'));
}

describe('S11 Unit Tests — YAML 降级告警可见性', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    restoreCwd = mockCwd(root);
  });

  afterEach(() => {
    restoreCwd();
    cleanup();
  });

  it('UT-S11-75: recovered 态渲染告警并点名未恢复字段与重建入口', () => {
    writeRecoverableYaml(root);
    const read = readProjectYaml(root);
    expect(read.yaml_diagnostics?.parse_status).toBe('recovered');

    const text = formatYamlDegradedLines(read.yaml_diagnostics, 'zh').join('\n');
    expect(text).toContain('已降级');
    expect(text).toContain('recovered');
    // 点名未被恢复的字段：resource_index 不在恢复范围内
    expect(text).toContain('未恢复（已丢失）');
    expect(text).toContain('resource_index');
    // 指向重建入口
    expect(text).toContain('openlogos index');
  });

  it('UT-S11-76: error 态同样可见，不呈现为正常', () => {
    writeUnrecoverableYaml(root);
    const read = readProjectYaml(root);
    expect(read.yaml_diagnostics?.parse_status).toBe('error');

    const lines = formatYamlDegradedLines(read.yaml_diagnostics, 'zh');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).toContain('error');
  });

  it('UT-S11-77: 健康项目零新增输出（golden 零漂移）', () => {
    // scaffoldProject 写出的是可正常解析的 yaml
    const read = readProjectYaml(root);
    expect(read.yaml_diagnostics).toBeNull();
    expect(formatYamlDegradedLines(read.yaml_diagnostics, 'zh')).toEqual([]);

    // 渲染入口对健康项目返回空数组 → status/next 文本输出不新增任何行
    const capture = captureConsole();
    try {
      status('text');
    } finally {
      capture.restore();
    }
    expect(capture.logs.some(line => line.includes('已降级'))).toBe(false);
  });
});

describe('S11 Scenario Tests — YAML 降级告警可见性', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    restoreCwd = mockCwd(root);
  });

  afterEach(() => {
    restoreCwd();
    cleanup();
  });

  it('ST-S11-44: 降级态下 status 与 next 同源告警且全程只读', async () => {
    writeRecoverableYaml(root);
    const before = sha(readYaml(root));

    const statusCapture = captureConsole();
    try {
      status('text');
    } finally {
      statusCapture.restore();
    }
    const statusText = statusCapture.logs.join('\n');

    const nextCapture = captureConsole();
    try {
      await next('text');
    } finally {
      nextCapture.restore();
    }
    const nextText = nextCapture.logs.join('\n');

    // 两条命令都必须可见告警，且点名 resource_index（两通道对同一状态判断一致）
    for (const text of [statusText, nextText]) {
      expect(text).toContain('已降级');
      expect(text).toContain('resource_index');
    }

    // 全程只读：CLI 不代用户改写降级文件（决策 C01，处置权归人）
    expect(sha(readYaml(root))).toBe(before);
  });
});
