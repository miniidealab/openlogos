import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { sync } from '../src/commands/sync.js';
import { collectStatusData } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import {
  syncGuiOverlay,
  instanceGuiOverlayNodeIds,
  projectHasGuiModule,
  readModulesMissingProductType,
  GUI_OVERLAY_NODE_IDS,
} from '../src/lib/ui-first.js';
import { readProjectYaml } from '../src/lib/project-yaml.js';

// 仓库真实 overlay 源（随 CLI 分发的 spec 唯一源）。
const REPO_OVERLAY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'spec', 'flow', 'overlays', 'gui-ui-first.yaml',
);

interface Mod { id: string; name?: string; lifecycle?: string; product_type?: string }

/** 在 temp root 下写 logos-project.yaml（含 modules[]），并把真实 overlay 源复制进 <temp>/spec。 */
function setupProject(root: string, modules: Mod[]): void {
  const yamlPath = join(root, 'logos', 'logos-project.yaml');
  const mods = modules.map(m => ({
    id: m.id,
    name: m.name ?? m.id,
    ...(m.lifecycle ? { lifecycle: m.lifecycle } : {}),
    ...(m.product_type ? { product_type: m.product_type } : {}),
  }));
  writeFileSync(yamlPath, stringifyYaml({ project: { name: 'test', description: '' }, modules: mods }, { lineWidth: 0 }));

  // 复制真实 overlay 源到 <temp>/spec/flow/overlays/（resolveSpecRoot 回退命中 <root>/spec）。
  const overlayDst = join(root, 'spec', 'flow', 'overlays', 'gui-ui-first.yaml');
  mkdirSync(dirname(overlayDst), { recursive: true });
  writeFileSync(overlayDst, readFileSync(REPO_OVERLAY, 'utf-8'));
}

/** 直接改 yaml 回填/切换某模块的 product_type（模拟 set-product-type）。 */
function setProductType(root: string, moduleId: string, pt: string | undefined): void {
  const data = readProjectYaml(root).data!;
  const mod = data.modules!.find(m => m.id === moduleId)!;
  if (pt === undefined) delete (mod as Record<string, unknown>).product_type;
  else mod.product_type = pt;
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml(data, { lineWidth: 0 }));
}

describe('S09 — syncGuiOverlay 幂等注入/移除', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
  });
  afterEach(() => cleanup());

  it('UT-S09-110b: GUI 模块（web）→ 注入两 overlay 节点', () => {
    setupProject(root, [{ id: 'web', lifecycle: 'launched', product_type: 'web' }]);
    expect(syncGuiOverlay(root)).toBe('injected');
    expect(instanceGuiOverlayNodeIds(root).sort()).toEqual([...GUI_OVERLAY_NODE_IDS].sort());
  });

  it('UT-S09-110c: 全非 GUI（cli）→ 不注入', () => {
    setupProject(root, [{ id: 'core', lifecycle: 'launched', product_type: 'cli' }]);
    expect(syncGuiOverlay(root)).toBe('unchanged');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);
    expect(existsSync(join(root, 'logos', 'flow', 'launched.yaml'))).toBe(false);
  });

  it('UT-S09-110d: 缺 product_type 字段 → 非 GUI、不注入（安全默认）', () => {
    setupProject(root, [{ id: 'core', lifecycle: 'launched' }]);
    expect(projectHasGuiModule(readProjectYaml(root).data)).toBe(false);
    expect(syncGuiOverlay(root)).toBe('unchanged');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);
  });

  it('UT-S09-110e: 多模块 web+cli → 项目含 GUI 故注入', () => {
    setupProject(root, [
      { id: 'web', lifecycle: 'launched', product_type: 'web' },
      { id: 'core', lifecycle: 'launched', product_type: 'cli' },
    ]);
    expect(projectHasGuiModule(readProjectYaml(root).data)).toBe(true);
    expect(syncGuiOverlay(root)).toBe('injected');
    expect(instanceGuiOverlayNodeIds(root).sort()).toEqual([...GUI_OVERLAY_NODE_IDS].sort());
  });

  it('UT-S09-119: 回填 web 后注入；再 sync 幂等（仍恰两节点、不重复）', () => {
    setupProject(root, [{ id: 'web', lifecycle: 'launched', product_type: 'web' }]);
    expect(syncGuiOverlay(root)).toBe('injected');
    expect(syncGuiOverlay(root)).toBe('unchanged');
    expect(instanceGuiOverlayNodeIds(root)).toHaveLength(2);
    expect(instanceGuiOverlayNodeIds(root).sort()).toEqual([...GUI_OVERLAY_NODE_IDS].sort());
  });

  it('UT-S09-120: 设 cli → 不注入；已注入则移除', () => {
    setupProject(root, [{ id: 'web', lifecycle: 'launched', product_type: 'web' }]);
    expect(syncGuiOverlay(root)).toBe('injected');
    // 切到 cli → 项目不再含 GUI → 移除
    setProductType(root, 'web', 'cli');
    expect(syncGuiOverlay(root)).toBe('removed');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);
  });

  it('UT-S09-121: 多模块 web+cli 注入成立，instance 含两节点', () => {
    setupProject(root, [
      { id: 'web', lifecycle: 'launched', product_type: 'web' },
      { id: 'core', lifecycle: 'launched', product_type: 'cli' },
    ]);
    expect(syncGuiOverlay(root)).toBe('injected');
    expect(instanceGuiOverlayNodeIds(root)).toHaveLength(2);
  });

  it('UT-S09-122: 唯一 GUI 改 cli + 用户自定义 op → 移除 GUI 节点、保留 custom-user-node、再 sync 幂等', () => {
    setupProject(root, [{ id: 'web', lifecycle: 'launched', product_type: 'web' }]);
    // 预写实例含用户自定义 overlay op
    const flowPath = join(root, 'logos', 'flow', 'launched.yaml');
    mkdirSync(dirname(flowPath), { recursive: true });
    writeFileSync(flowPath, stringifyYaml({
      version: 1,
      flow: 'launched',
      extends: 'builtin:launched@v1',
      overlay: [{ op: 'add', after: 'write-tasks', node: { id: 'custom-user-node', name: '用户节点' } }],
    }, { lineWidth: 0 }));

    // 先注入 GUI 节点（与用户 op 共存）
    expect(syncGuiOverlay(root)).toBe('injected');
    expect(instanceGuiOverlayNodeIds(root)).toHaveLength(2);

    // 切 cli → 移除 GUI 节点，保留 custom-user-node
    setProductType(root, 'web', 'cli');
    expect(syncGuiOverlay(root)).toBe('removed');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);
    const doc = readFileSync(flowPath, 'utf-8');
    expect(doc).toContain('custom-user-node');
    // 再 sync 幂等
    expect(syncGuiOverlay(root)).toBe('unchanged');
    expect(readFileSync(flowPath, 'utf-8')).toContain('custom-user-node');
  });

  it('UT-S09-122a: 删最后一个 GUI 模块 → 移除 GUI 节点、保留用户 op', () => {
    setupProject(root, [
      { id: 'web', lifecycle: 'launched', product_type: 'web' },
      { id: 'core', lifecycle: 'launched', product_type: 'cli' },
    ]);
    const flowPath = join(root, 'logos', 'flow', 'launched.yaml');
    mkdirSync(dirname(flowPath), { recursive: true });
    writeFileSync(flowPath, stringifyYaml({
      version: 1, flow: 'launched', extends: 'builtin:launched@v1',
      overlay: [{ op: 'add', after: 'write-tasks', node: { id: 'custom-user-node', name: '用户节点' } }],
    }, { lineWidth: 0 }));
    expect(syncGuiOverlay(root)).toBe('injected');

    // 删掉唯一 GUI 模块（只留 cli）
    const data = readProjectYaml(root).data!;
    data.modules = data.modules!.filter(m => m.id !== 'web');
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml(data, { lineWidth: 0 }));

    expect(syncGuiOverlay(root)).toBe('removed');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);
    expect(readFileSync(flowPath, 'utf-8')).toContain('custom-user-node');
  });

  it('UT-S09-123: --auto 缺字段不注入、syncGuiOverlay 不注入（安全默认不猜测 GUI）', () => {
    setupProject(root, [{ id: 'core', lifecycle: 'launched' }]);
    // 缺字段 → 非 GUI → 不注入
    expect(syncGuiOverlay(root)).toBe('unchanged');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);
    // 诊断仍暴露
    expect(readModulesMissingProductType(root)).toEqual(['core']);
  });
});

describe('S09 — PRODUCT_TYPE_CONFIRMATION_REQUIRED 诊断（sync / status / next）', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'en' });
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });
  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  it('UT-S09-118: 缺字段 → sync/status/next 输出 PRODUCT_TYPE_CONFIRMATION_REQUIRED', async () => {
    setupProject(root, [{ id: 'core', lifecycle: 'launched' }]);

    sync();
    expect(con.logs.join('\n')).toContain('PRODUCT_TYPE_CONFIRMATION_REQUIRED');
    expect(con.warns.join('\n')).toContain('core');

    const statusData = collectStatusData(root);
    expect(statusData.product_type_confirmation).toBeDefined();
    expect(statusData.product_type_confirmation!.signal).toBe('PRODUCT_TYPE_CONFIRMATION_REQUIRED');
    expect(statusData.product_type_confirmation!.level).toBe('warning');
    expect(statusData.product_type_confirmation!.missing_module_ids).toContain('core');
    expect(statusData.product_type_confirmation!.next_action.command).toBe('openlogos module set-product-type');
    expect(statusData.product_type_confirmation!.next_action.gui_enum).toEqual(['web', 'desktop', 'mobile']);

    con.logs.length = 0;
    await next('json');
    const nextEnvelope = JSON.parse(con.logs.join('\n'));
    expect(nextEnvelope.data.product_type_confirmation.missing_module_ids).toContain('core');
  });

  it('UT-S09-118a: 回填 product_type 后不再输出诊断', async () => {
    setupProject(root, [{ id: 'core', lifecycle: 'launched', product_type: 'cli' }]);

    sync();
    expect(con.logs.join('\n')).not.toContain('PRODUCT_TYPE_CONFIRMATION_REQUIRED');

    const statusData = collectStatusData(root);
    expect(statusData.product_type_confirmation).toBeUndefined();

    con.logs.length = 0;
    await next('json');
    const nextEnvelope = JSON.parse(con.logs.join('\n'));
    expect(nextEnvelope.data.product_type_confirmation).toBeUndefined();
  });

  it('UT-S09-123 (auto): --auto 缺字段不注入、仍暴露诊断', async () => {
    setupProject(root, [{ id: 'core', lifecycle: 'launched' }]);

    await next('json', undefined, true);
    const nextEnvelope = JSON.parse(con.logs.join('\n'));
    // 诊断仍出现
    expect(nextEnvelope.data.product_type_confirmation.missing_module_ids).toContain('core');
    // 未因缺字段注入 overlay（安全默认）
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);
  });

  it('ST-S09-41: 缺字段→诊断→回填 web→sync 注入→instance 含两节点（端到端迁移）', () => {
    setupProject(root, [{ id: 'web', lifecycle: 'launched' }]);

    // 缺字段：诊断成立、不注入
    sync();
    expect(con.logs.join('\n')).toContain('PRODUCT_TYPE_CONFIRMATION_REQUIRED');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);

    // 回填 web（模拟 moduleSetProductType）
    setProductType(root, 'web', 'web');

    con.logs.length = 0;
    sync();
    expect(con.logs.join('\n')).not.toContain('PRODUCT_TYPE_CONFIRMATION_REQUIRED');
    expect(con.logs.join('\n')).toContain('overlay injected');
    expect(instanceGuiOverlayNodeIds(root).sort()).toEqual([...GUI_OVERLAY_NODE_IDS].sort());
    expect(collectStatusData(root).product_type_confirmation).toBeUndefined();
  });

  it('ST-S09-42: 反向移除 + 保留用户 op 端到端', () => {
    setupProject(root, [{ id: 'web', lifecycle: 'launched', product_type: 'web' }]);
    // 预写用户自定义 op
    const flowPath = join(root, 'logos', 'flow', 'launched.yaml');
    mkdirSync(dirname(flowPath), { recursive: true });
    writeFileSync(flowPath, stringifyYaml({
      version: 1, flow: 'launched', extends: 'builtin:launched@v1',
      overlay: [{ op: 'add', after: 'write-tasks', node: { id: 'custom-user-node', name: '用户节点' } }],
    }, { lineWidth: 0 }));

    sync();
    expect(con.logs.join('\n')).toContain('overlay injected');
    expect(instanceGuiOverlayNodeIds(root)).toHaveLength(2);

    // 切 cli → 移除 GUI 节点、保留用户 op
    setProductType(root, 'web', 'cli');
    con.logs.length = 0;
    sync();
    expect(con.logs.join('\n')).toContain('overlay removed');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);
    expect(readFileSync(flowPath, 'utf-8')).toContain('custom-user-node');
  });

  it('ST-S09-43: --auto 安全默认不猜测 GUI（缺字段不注入、诊断暴露）', async () => {
    setupProject(root, [{ id: 'core', lifecycle: 'launched' }]);

    // sync（无 --auto 概念，但 overlay 注入依据同一安全默认）
    sync();
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);

    // next --auto 照常暴露诊断、不注入
    con.logs.length = 0;
    await next('json', undefined, true);
    const env = JSON.parse(con.logs.join('\n'));
    expect(env.data.product_type_confirmation.missing_module_ids).toContain('core');
    expect(instanceGuiOverlayNodeIds(root)).toEqual([]);
  });
});
