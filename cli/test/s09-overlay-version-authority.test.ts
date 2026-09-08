import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, mockCwd } from './helpers.js';
import { syncGuiOverlay } from '../src/lib/ui-first.js';
import {
  BUILTIN_VERSIONS,
  applyOverlay,
  loadBuiltinFlow,
  readOverlay,
} from '../src/lib/flow.js';

/**
 * S09 overlay extends 版本单一权威与存量有条件迁移
 * （fix-sync-yaml-and-overlay-version 切片3）
 *
 * 断言纪律：期望值一律引用 BUILTIN_VERSIONS，禁止在 fixture 或期望值中固化具体版本号——
 * 既有 s09-ui-sync.test.ts 的三处 `builtin:launched@v1` fixture 正是把错误形态固化成了
 * 断言，使写入端与 loader 映射失同步长期不可见。
 */

const REPO_OVERLAY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'spec', 'flow', 'overlays', 'gui-ui-first.yaml',
);

const flowPath = (root: string) => join(root, 'logos', 'flow', 'launched.yaml');

/** 写含一个 GUI 模块的项目，并把真实 overlay 唯一源复制进 <temp>/spec */
function setupGuiProject(root: string): void {
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    stringifyYaml({
      project: { name: 'gui-app', description: '' },
      modules: [{ id: 'web', name: 'web', lifecycle: 'launched', product_type: 'web' }],
    }, { lineWidth: 0 }),
  );
  const dst = join(root, 'spec', 'flow', 'overlays', 'gui-ui-first.yaml');
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, readFileSync(REPO_OVERLAY, 'utf-8'));
}

function writeInstanceOverlay(root: string, doc: Record<string, unknown>): void {
  mkdirSync(dirname(flowPath(root)), { recursive: true });
  writeFileSync(flowPath(root), stringifyYaml(doc, { lineWidth: 0 }));
}

function readInstance(root: string): Record<string, unknown> {
  return parseYaml(readFileSync(flowPath(root), 'utf-8')) as Record<string, unknown>;
}

/** 落后版本号：取一个必然不等于当前映射值的历史值 */
const STALE_VERSION = 'v0';

describe('S09 Unit Tests — overlay extends 版本单一权威', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    restoreCwd = mockCwd(root);
    setupGuiProject(root);
  });

  afterEach(() => {
    restoreCwd();
    cleanup();
  });

  it('UT-S09-275: 注入器写出的 extends 取自 loader 映射，产物无字面量版本号', () => {
    expect(syncGuiOverlay(root)).toBe('injected');

    const doc = readInstance(root);
    expect(doc.extends).toBe(`builtin:launched@${BUILTIN_VERSIONS.launched}`);

    // 负向：产物中不得出现「不等于当前映射值」的硬编码版本号
    const raw = readFileSync(flowPath(root), 'utf-8');
    const versions = [...raw.matchAll(/builtin:launched@(\S+)/g)].map(m => m[1].trim());
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.every(v => v === BUILTIN_VERSIONS.launched)).toBe(true);
  });

  it('UT-S09-276: 写出的 overlay 自解析后不含 FLOW_VERSION_MISMATCH', () => {
    expect(syncGuiOverlay(root)).toBe('injected');

    const overlay = readOverlay(root, 'launched');
    expect(overlay).not.toBeNull();

    const { warnings } = applyOverlay(loadBuiltinFlow('launched'), overlay!, 'launched');
    // 写者产出立即触发本进程告警 = 不变量被破坏
    expect(warnings.map(w => w.code)).not.toContain('FLOW_VERSION_MISMATCH');
  });

  it('UT-S09-277: 存量落后且引用全部可解析 → 自动提升并保留用户自定义 ops', () => {
    // 存量：版本落后，且带一个引用 builtin 真实锚点的用户自定义 op
    const userOp = { op: 'add', after: 'write-tasks', node: { id: 'custom-user-node', name: '用户节点' } };
    writeInstanceOverlay(root, {
      version: 1,
      flow: 'launched',
      extends: `builtin:launched@${STALE_VERSION}`,
      overlay: [userOp],
    });

    expect(syncGuiOverlay(root)).toBe('injected');

    const doc = readInstance(root);
    // 只改 extends 一个字段
    expect(doc.extends).toBe(`builtin:launched@${BUILTIN_VERSIONS.launched}`);
    // 用户自定义 op 逐字保留且仍在首位（顺序不变）
    const ops = doc.overlay as Array<Record<string, unknown>>;
    expect(ops[0]).toEqual(userOp);

    // 迁移后不再有版本告警
    const { warnings } = applyOverlay(loadBuiltinFlow('launched'), readOverlay(root, 'launched')!, 'launched');
    expect(warnings.map(w => w.code)).not.toContain('FLOW_VERSION_MISMATCH');

    // 幂等：再 sync 一次为 no-op，字节不变
    const after = readFileSync(flowPath(root), 'utf-8');
    expect(syncGuiOverlay(root)).toBe('unchanged');
    expect(readFileSync(flowPath(root), 'utf-8')).toBe(after);
  });

  it('UT-S09-278: 存量落后但引用了失效 node id → 保持原值并继续告警（负向）', () => {
    // 存量：版本落后，且引用一个在新版本内置模板中不存在的锚点
    writeInstanceOverlay(root, {
      version: 1,
      flow: 'launched',
      extends: `builtin:launched@${STALE_VERSION}`,
      overlay: [{ op: 'modify', target: 'node-removed-in-newer-builtin', set: { name: 'x' } }],
    });

    // 命令不因此中断
    expect(() => syncGuiOverlay(root)).not.toThrow();

    const doc = readInstance(root);
    // extends 保持原值——不得为消音告警而无条件 bump
    expect(doc.extends).toBe(`builtin:launched@${STALE_VERSION}`);

    // 版本告警仍在，继续指向真正需要人工复核的 overlay
    // （该 overlay 的 target 失效，applyOverlay 直接 fail-closed）
    expect(() => applyOverlay(loadBuiltinFlow('launched'), readOverlay(root, 'launched')!, 'launched'))
      .toThrow(/FLOW_SCHEMA_INVALID|target/);
  });
});

describe('S09 Scenario Tests — overlay 版本端到端', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    restoreCwd = mockCwd(root);
    setupGuiProject(root);
  });

  afterEach(() => {
    restoreCwd();
    cleanup();
  });

  it('ST-S09-108: GUI 项目 sync 后紧接着解析 resolved flow，无假告警', () => {
    // 上游 Bug 报告的「前后两条命令」复现路径：sync → flow show --resolved
    expect(syncGuiOverlay(root)).toBe('injected');

    const overlay = readOverlay(root, 'launched')!;
    const { warnings, flow } = applyOverlay(loadBuiltinFlow('launched'), overlay, 'launched');

    expect(warnings.map(w => w.code)).not.toContain('FLOW_VERSION_MISMATCH');
    // 注入确实生效：GUI 原型节点可解析（§2.74.2 后 overlay 仅此一个节点）
    const ids = JSON.stringify(flow);
    expect(ids).toContain('write-ui-prototype');
    expect(ids).not.toContain('verify-ui-provenance');
  });
});
