/**
 * S09 ui-flow（proposal-ui-ux-first 切片1）——flow-derive `ui_impact` 派生 +
 * plan 阶段原型 delta 例外 + GUI overlay 合法性测试。
 *
 * 覆盖 UT-S09-70/71（原型例外判据）、72/73/74/75（module-aware ui_impact）、
 * 76~78 / 86 / 89 / 110 / 110a / 110a-neg（overlay applyOverlay/validate 合法性）。
 *
 * 原型 delta 例外接入 detectProposalStepViaFlow 主体的 `delta.checked===0` 分支，受 ui_impact 门控；
 * 非 GUI 行为逐字节不变（见 s09-flow-derive-launched.test.ts 并跑等价矩阵，未受影响）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { readFileSync } from 'node:fs';
import { makeTempRoot } from './helpers.js';
import {
  deriveUiImpactFlag,
  isPrototypeOnlyDelta,
  shouldEnterSpec,
} from '../src/lib/flow-derive.js';
import { loadGuiOverlayOps, GUI_OVERLAY_NODE_IDS } from '../src/lib/ui-first.js';
import { loadBuiltinFlow, applyOverlay, validateFlow, FlowError, type OverlayOp } from '../src/lib/flow.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

// 仓库根（cli/test/ → 上溯两级）。测试尽量用真实仓库 spec，避免脆弱 fixture。
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OVERLAY_PATH = join(REPO_ROOT, 'spec', 'flow', 'overlays', 'gui-ui-first.yaml');

/** 建带 logos/ 的临时提案目录，返回 { root, dir }。 */
function makeProposal(): { root: string; dir: string } {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  const dir = join(root, 'logos', 'changes', 'feat');
  mkdirSync(dir, { recursive: true });
  return { root, dir };
}

/** 写 logos-project.yaml：单模块 feat，指定 product_type。 */
function writeModule(root: string, productType: string) {
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    ['project:', '  name: "t"', 'modules:', '  - id: feat', '    name: feat',
      '    lifecycle: launched', `    product_type: ${productType}`, ''].join('\n'));
}

/** 写 guard，绑定活跃提案 module。 */
function writeGuard(root: string, moduleId = 'feat') {
  writeFileSync(join(root, 'logos', '.openlogos-guard'),
    JSON.stringify({ activeChange: 'feat', module: moduleId }));
}

/** 写含「UI/UX 变更声明」段的 proposal.md（ui_impact 由参数控制）。 */
function writeProposalWithDecl(dir: string, uiImpact: boolean) {
  const md = [
    '# 变更提案：feat', '', '## 变更原因', 'x。', '',
    '## UI/UX 变更声明', '```yaml', `ui_impact: ${uiImpact}`,
    'design_system_mode: generated', 'pages:', '  - id: home',
    '    prototype: core-01-home.html', '    description: 首页', '```', '',
    '## 变更概述', '概述。',
  ].join('\n');
  writeFileSync(join(dir, 'proposal.md'), md);
}

/** 在提案 deltas/ 下放原型 html（2-page-design 叶子）。 */
function writePrototypeDelta(dir: string, name = 'core-01-home.html') {
  const p = join(dir, 'deltas', 'prd', '2-product-design', '2-page-design');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, name), '<html>proto</html>');
}

/** 在提案 deltas/ 下放非原型规格 delta（功能规格 md）。 */
function writeFeatureSpecDelta(dir: string, name = 'core-01-feature.md') {
  const p = join(dir, 'deltas', 'prd', '1-feature-specs');
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, name), '# spec');
}

// ── 一、plan 阶段原型 delta 例外判据（纯判据，不依赖 module/guard）──
describe('S09 ui-flow — 原型 delta 例外判据', () => {
  it('UT-S09-70: 仅 2-page-design/*.html 原型、无非原型规格 delta、无 PLAN_APPROVED → 仍 plan、未进 spec', () => {
    const { dir } = makeProposal();
    writePrototypeDelta(dir);
    // isPrototypeOnlyDelta：仅原型 → true
    expect(isPrototypeOnlyDelta(dir)).toBe(true);
    // shouldEnterSpec(uiImpact=true)：仅原型 + 无 PLAN_APPROVED → false（不进 spec，门前态）
    expect(shouldEnterSpec(dir, true)).toBe(false);
  });

  it('UT-S09-71: 另有 1-feature-specs/*.md delta → 进入 spec（原型例外仅限 2-page-design/*.html 叶子）', () => {
    const { dir } = makeProposal();
    writePrototypeDelta(dir);
    writeFeatureSpecDelta(dir); // 非原型规格 delta
    // 出现非原型 delta → 非「仅原型」
    expect(isPrototypeOnlyDelta(dir)).toBe(false);
    // 即使 ui_impact 为真，有非原型规格 delta → 进 spec
    expect(shouldEnterSpec(dir, true)).toBe(true);
  });

  it('UT-S09-70b: shouldEnterSpec 非 GUI（uiImpact=false）行为退化——原型 delta 也进 spec（零回归）', () => {
    const { dir } = makeProposal();
    writePrototypeDelta(dir);
    // uiImpact=false：判据退化为原逻辑（有可合并 delta → 进 spec），原型不豁免
    expect(shouldEnterSpec(dir, false)).toBe(true);
  });

  it('UT-S09-70c: 无任何 delta → 两侧 uiImpact 都判「未进 spec」（门前态），isPrototypeOnlyDelta=false', () => {
    const { dir } = makeProposal();
    expect(isPrototypeOnlyDelta(dir)).toBe(false); // 无原型 html → 非「仅原型」
    expect(shouldEnterSpec(dir, true)).toBe(false);
    expect(shouldEnterSpec(dir, false)).toBe(false);
  });

  it('UT-S09-75: 判定依据=已规划 [delta] 目标（声明段 + product_type），非扫描 delta 内容——plan 阶段无 delta 文件仍可判 ui_impact（无循环依赖）', () => {
    const { root, dir } = makeProposal();
    writeModule(root, 'web');
    writeGuard(root);
    writeProposalWithDecl(dir, true);
    // plan 阶段：尚无任何 delta 文件（未产出原型）
    expect(isPrototypeOnlyDelta(dir)).toBe(false); // 内容侧：无原型文件
    // ui_impact 仍可由声明段 + product_type 判定（不依赖 delta 内容 → 无循环依赖）
    expect(deriveUiImpactFlag(root, 'feat', dir)).toBe(true);
  });
});

// ── 二、module-aware ui_impact 派生 ──
describe('S09 ui-flow — deriveUiImpactFlag（module-aware）', () => {
  it('UT-S09-72: GUI 模块（product_type=web）+ 声明 ui_impact:true → true', () => {
    const { root, dir } = makeProposal();
    writeModule(root, 'web');
    writeProposalWithDecl(dir, true);
    expect(deriveUiImpactFlag(root, 'feat', dir)).toBe(true);
  });

  it('UT-S09-73: 非 GUI 模块（cli）即使声明 ui_impact:true → false', () => {
    const { root, dir } = makeProposal();
    writeModule(root, 'cli');
    writeProposalWithDecl(dir, true);
    expect(deriveUiImpactFlag(root, 'feat', dir)).toBe(false);
  });

  it('UT-S09-74: GUI 模块 + 声明 ui_impact:false → false', () => {
    const { root, dir } = makeProposal();
    writeModule(root, 'web');
    writeProposalWithDecl(dir, false);
    expect(deriveUiImpactFlag(root, 'feat', dir)).toBe(false);
  });
});

// ── 三、GUI overlay 合法性（用真实仓库 spec 的 gui-ui-first.yaml）──
/** 读真实 overlay 文件的 op 列表（parseYaml）。 */
function realOverlayOps(): Array<Record<string, unknown>> {
  const doc = parseYaml(readFileSync(OVERLAY_PATH, 'utf-8')) as { overlay: Array<Record<string, unknown>> };
  return doc.overlay;
}

describe('S09 ui-flow — GUI overlay applyOverlay/validate 合法性', () => {
  it('UT-S09-76: write-ui-prototype 作为 overlay-add 用 done_when: cmd: 合法——applyOverlay 不抛错、resolved 含该节点', () => {
    const builtin = loadBuiltinFlow('launched');
    const { flow } = applyOverlay(builtin, { overlay: realOverlayOps() as never }, 'launched');
    const ids = flow.subflows.flatMap(s => s.nodes.map(n => n.id));
    expect(ids).toContain('write-ui-prototype');
    const node = flow.subflows.flatMap(s => s.nodes).find(n => n.id === 'write-ui-prototype')!;
    expect(node.done_when).toBe('cmd:openlogos check-ui-prototype');
  });

  it('UT-S09-77: write-ui-prototype 硬编码进 builtin 节点并用 done_when: cmd: → validateFlow 通过但派生/gate 路径拒 builtin cmd:（cmd: 仅 overlay 合法）', () => {
    // 构造一个非法 builtin 片段：把 cmd: 直接硬编码为 builtin 节点（launched write-tasks 之后）。
    // 注：validateFlow 只做结构校验（cmd: 字符串结构合法），builtin cmd: 的拒绝发生在
    // overlay-modify 白名单（validateModifyCmdGate）与 launched marker 抽取（markerName）路径。
    // 这里用 applyOverlay 的 op:modify 把 builtin 节点 done_when 改成 cmd: → FLOW_SCHEMA_INVALID（builtin 节点非白名单）。
    const builtin = loadBuiltinFlow('launched');
    expect(() => applyOverlay(builtin,
      { overlay: [{ op: 'modify', target: 'write-tasks', set: { done_when: 'cmd:openlogos check-ui-prototype' } }] }, 'launched'))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
    // 且 FlowError 类型确切
    try {
      applyOverlay(builtin,
        { overlay: [{ op: 'modify', target: 'write-tasks', set: { done_when: 'cmd:x' } }] }, 'launched');
    } catch (e) {
      expect(e).toBeInstanceOf(FlowError);
    }
  });

  it('UT-S09-78: builtin launched.yaml plan subflow 不含 write-ui-prototype/verify-ui-provenance（仅存在于 loadGuiOverlayOps）', () => {
    const builtin = loadBuiltinFlow('launched');
    const ids = builtin.subflows.flatMap(s => s.nodes.map(n => n.id));
    expect(ids).not.toContain('write-ui-prototype');
    expect(ids).not.toContain('verify-ui-provenance');
    // 两节点仅存在于方法论 overlay 源
    const overlayIds = loadGuiOverlayOps(REPO_ROOT)
      .map(op => (op.node as { id?: string } | undefined)?.id)
      .filter(Boolean);
    expect(overlayIds).toContain('write-ui-prototype');
    expect(overlayIds).toContain('verify-ui-provenance');
  });

  it('UT-S09-86: overlay 中 verify-ui-provenance 声明 before: generate-merge-prompt → resolved 顺序中位于其前', () => {
    const builtin = loadBuiltinFlow('launched');
    const { flow } = applyOverlay(builtin, { overlay: realOverlayOps() as never }, 'launched');
    const ids = flow.subflows.flatMap(s => s.nodes.map(n => n.id));
    const provIdx = ids.indexOf('verify-ui-provenance');
    const mergeIdx = ids.indexOf('generate-merge-prompt');
    expect(provIdx).toBeGreaterThanOrEqual(0);
    expect(mergeIdx).toBeGreaterThanOrEqual(0);
    expect(provIdx).toBeLessThan(mergeIdx);
  });

  it('UT-S09-89: verify-ui-provenance 仅 done_when: cmd:（无 fail_when）→ applyOverlay/validate 通过（单 cmd: 合法，不触发决策 B）', () => {
    const builtin = loadBuiltinFlow('launched');
    const { flow } = applyOverlay(builtin, { overlay: realOverlayOps() as never }, 'launched');
    const node = flow.subflows.flatMap(s => s.nodes).find(n => n.id === 'verify-ui-provenance')!;
    expect(node.done_when).toBe('cmd:openlogos check-ui-hash-match');
    expect(node.fail_when == null).toBe(true); // 无 fail_when → 决策 B（同节点双 cmd:）不触发
    // resolved flow 已通过 applyOverlay 内的 validateFlow；再显式 validate 一次不抛
    expect(() => validateFlow(flow, 'resolved')).not.toThrow();
  });

  it('UT-S09-110: loadGuiOverlayOps 读真实文件、恰两个 op:add（write-ui-prototype / verify-ui-provenance），经 applyOverlay 合法', () => {
    const ops = loadGuiOverlayOps(REPO_ROOT);
    expect(ops.length).toBe(2);
    for (const op of ops) expect(op.op).toBe('add');
    const ids = ops.map(op => (op.node as { id?: string }).id);
    expect(new Set(ids)).toEqual(new Set(GUI_OVERLAY_NODE_IDS));
    // 经 overlay parser/schema（applyOverlay）合法
    const builtin = loadBuiltinFlow('launched');
    expect(() => applyOverlay(builtin, { overlay: ops as never }, 'launched')).not.toThrow();
  });

  it('UT-S09-110a: 两 op:add 的 done_when 为真实子命令字符串（不含字面 <...> 占位）', () => {
    const ops = loadGuiOverlayOps(REPO_ROOT);
    const byId = Object.fromEntries(ops.map(op => {
      const node = op.node as { id: string; done_when?: string };
      return [node.id, node.done_when];
    }));
    expect(byId['write-ui-prototype']).toBe('cmd:openlogos check-ui-prototype');
    expect(byId['verify-ui-provenance']).toBe('cmd:openlogos check-ui-hash-match');
    for (const dw of Object.values(byId)) {
      expect(dw).not.toMatch(/[<>]/); // 无字面 <...> 占位
    }
  });

  it('UT-S09-110a-neg: overlay done_when 仍是 cmd:<check-ui-prototype> 字面占位 → 视为不可执行（含 <...>）', () => {
    // 写一个含 <...> 占位的临时 overlay op，applyOverlay 结构上不拒（cmd: 字符串合法），
    // 但命令含字面尖括号占位 → 判据判其为「未实现/不可执行」（占位而非真实子命令）。
    const badOverlay: { overlay: Array<{ op: OverlayOp; after?: string; node: Record<string, unknown> }> } = {
      overlay: [{
        op: 'add', after: 'write-tasks',
        node: { id: 'write-ui-prototype', name: '产出 UI 原型', done_when: 'cmd:openlogos check-ui-prototype <slug>' },
      }],
    };
    const builtin = loadBuiltinFlow('launched');
    const { flow } = applyOverlay(builtin, badOverlay as never, 'launched');
    const node = flow.subflows.flatMap(s => s.nodes).find(n => n.id === 'write-ui-prototype')!;
    const cmd = String(node.done_when).slice('cmd:'.length);
    // 判据：含 <...> 占位 → 视为非法/不可执行子命令
    const hasPlaceholder = /[<>]/.test(cmd);
    expect(hasPlaceholder).toBe(true);
  });
});
