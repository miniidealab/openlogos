/**
 * S25 — overlay 驱动 status/next/watch 派生（M2 切片 1a）。
 * 复用 S22 临时项目 overlay 模式（makeTempRoot + scaffoldProject + 写 logos/flow/<lifecycle>.yaml）。
 * 不改 spec/flow/*.yaml、真实 logos/flow/、golden-baseline fixture。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { deriveOverlayView } from '../src/lib/flow-overlay-derive.js';
import { applyOverlay, loadBuiltinFlow } from '../src/lib/flow.js';
import { status } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import { watch } from '../src/commands/watch.js';
import { flowShow } from '../src/commands/flow.js';
import { detectProposalStepViaFlow } from '../src/lib/flow-derive.js';
import type { ModuleInfo } from '../src/commands/status.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempProject(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  cleanups.push(cleanup);
  return root;
}
function writeOverlay(root: string, lifecycle: string, yaml: string) {
  mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
  writeFileSync(join(root, 'logos', 'flow', `${lifecycle}.yaml`), yaml);
}
function setLaunchedModule(root: string) {
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    'project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n',
  );
}
function setInitialModule(root: string) {
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    'project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: initial\n',
  );
}
function fillProposal(root: string, slug = 'feat') {
  mkdirSync(join(root, 'logos', 'changes', slug), { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响：core-01', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯文档',
    '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '概述。'].join('\n');
  writeFileSync(join(root, 'logos', 'changes', slug, 'proposal.md'), proposal);
  writeFileSync(join(root, 'logos', 'changes', slug, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [ ] 产出 delta\n');
}
function runJson(root: string, fn: () => void): any {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  try { fn(); } finally { cap.restore(); restoreCwd(); }
  return JSON.parse(cap.logs[0]).data;
}
function runJsonErr(root: string, fn: () => void): { code: string; envelope: any } {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  const exitSpy = mockProcessExit();
  try { fn(); } catch { /* process.exit throws */ } finally { cap.restore(); restoreCwd(); exitSpy.mockRestore(); }
  const envelope = JSON.parse(cap.errors[0]);
  return { code: envelope.error?.code, envelope };
}

const coreInitial: ModuleInfo = { id: 'core', name: 'core', lifecycle: 'initial' };
const coreLaunched: ModuleInfo = { id: 'core', name: 'core', lifecycle: 'launched' };

const ADD_KICKOFF_BEFORE_PRD = [
  'extends: builtin:initial@v1', 'overlay:',
  '  - op: add', '    before: prd',
  '    node: { id: kickoff, name: 启动门, done_when: "file:logos/resources/KICKOFF" }',
].join('\n');

describe('S25 — overlay 驱动派生（unit: deriveOverlayView）', () => {
  it('UT-S25-02: 无 overlay 文件 → 返回 null（不新增字段，golden 安全）', () => {
    const root = tempProject();
    expect(deriveOverlayView(root, coreInitial, [], null)).toBeNull();
  });

  it('UT-S25-01 / UT-S25-06 / UT-S25-07: initial add 节点 → overlay_nodes + current_node（active）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ADD_KICKOFF_BEFORE_PRD);
    const view = deriveOverlayView(root, coreInitial, [], null)!;
    expect(view).not.toBeNull();
    expect(view.overlay_nodes.map(n => n.id)).toEqual(['kickoff']);
    expect(view.overlay_nodes[0]).toMatchObject({ id: 'kickoff', state: 'active', overlay_op: 'add', node_index: 0 });
    expect(view.current_node).toMatchObject({ id: 'kickoff', state: 'active', phase_key: null, overlay_op: 'add' });
  });

  it('UT-S25-17: overlay-add 用 file: 谓词（自含）→ 合法可求值', () => {
    const root = tempProject();
    writeFileSync(join(root, 'logos', 'resources', 'KICKOFF'), 'x');
    writeOverlay(root, 'initial', ADD_KICKOFF_BEFORE_PRD);
    const view = deriveOverlayView(root, coreInitial, [], null)!;
    // KICKOFF 存在 → kickoff done；current 落到 builtin prd（非 overlay-added）→ current_node 省略
    expect(view.overlay_nodes[0]).toMatchObject({ id: 'kickoff', state: 'done' });
    expect(view.current_node).toBeNull();
  });

  it('UT-S25-19b: add 节点在未来（未到达）→ overlay_nodes 省略（不输出空数组语义=空列表）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', [
      'extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    after: code',
      '    node: { id: lint, name: 静态检查, done_when: "file:logos/resources/LINT" }',
    ].join('\n'));
    const view = deriveOverlayView(root, coreInitial, [], null)!;
    // 当前是 prd（builtin，未 done）→ lint 在 code 之后未到达
    expect(view.overlay_nodes).toEqual([]);
    expect(view.current_node).toBeNull();
  });

  it('UT-S25-16 / ST-S25-EX-2.1: initial overlay-add 用 marker: 谓词 → FLOW_SCHEMA_INVALID（仅 launched）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', [
      'extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    before: prd',
      '    node: { id: bad, name: 坏节点, done_when: "marker:X" }',
    ].join('\n'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S25-15: overlay-add 用 dir_nonempty 但缺 produces → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', [
      'extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    before: prd',
      '    node: { id: bad, name: 坏节点, done_when: "dir_nonempty" }',
    ].join('\n'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S25-23: overlay-add 用 cmd: 谓词（M2 预留）→ FLOW_SCHEMA_INVALID（F1 白名单）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', [
      'extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    before: prd',
      '    node: { id: bad, name: 坏节点, done_when: "cmd:npm test" }',
    ].join('\n'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S25-24: overlay-add 用未知/拼错谓词 → FLOW_SCHEMA_INVALID（F1 白名单）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', [
      'extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    before: prd',
      '    node: { id: bad, name: 坏节点, done_when: "dir_nonemty" }',
    ].join('\n'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S25-25: overlay-add fail_when 用 cmd: → FLOW_SCHEMA_INVALID（F1 校验 fail_when）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', [
      'extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    before: prd',
      '    node: { id: bad, name: 坏节点, done_when: "file:x", fail_when: "cmd:false" }',
    ].join('\n'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S25-26: 纯代码提案（无 [delta]）→ merge subflow 内的 add 节点 = skipped、不阻塞（F2）', () => {
    const root = tempProject();
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(proposalDir, { recursive: true });
    // 纯代码提案：proposal 填实 + tasks 仅 [code] section（无 [delta]）
    const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '代码级', '',
      '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯代码',
      '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
      '## 变更概述', '概述。'].join('\n');
    writeFileSync(join(proposalDir, 'proposal.md'), proposal);
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [ ] 实现 x\n');
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    after: generate-merge-prompt',
      '    node: { id: mid, name: 合并中节点, done_when: "marker:MID_DONE" }',
    ].join('\n'));
    const view = deriveOverlayView(root, coreLaunched, [], proposalDir)!;
    const mid = view.overlay_nodes.find(n => n.id === 'mid');
    expect(mid?.state).toBe('skipped'); // merge subflow when:delta_required=false → skipped
    expect(view.current_node).toBeNull(); // 不卡在该 add 节点（current 落 builtin code）
  });

  it('UT-S25-28: 纯代码提案（无 [delta]）+ add after write-delta → 锚点继承 skipped、不阻塞 coding（锚点 when）', () => {
    const root = tempProject();
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(proposalDir, { recursive: true });
    const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '代码级', '',
      '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯代码',
      '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
      '## 变更概述', '概述。'].join('\n');
    writeFileSync(join(proposalDir, 'proposal.md'), proposal);
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [ ] 实现 x\n');
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    after: write-delta',
      '    node: { id: review-gate, name: 评审门, done_when: "marker:REVIEW_DONE" }',
    ].join('\n'));
    const view = deriveOverlayView(root, coreLaunched, [], proposalDir)!;
    const rg = view.overlay_nodes.find(n => n.id === 'review-gate');
    expect(rg?.state).toBe('skipped'); // write-delta when:delta_required=false → review-gate 锚点继承 skipped
    expect(view.current_node).toBeNull(); // 不阻塞，流程进入 coding（builtin code 前沿）
  });

  it('UT-S25-29: 纯代码提案 + add BEFORE write-delta → 锚点继承 skipped、不阻塞（区分 after write-proposal）', () => {
    const root = tempProject();
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(proposalDir, { recursive: true });
    const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '代码级', '',
      '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯代码',
      '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
      '## 变更概述', '概述。'].join('\n');
    writeFileSync(join(proposalDir, 'proposal.md'), proposal);
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [ ] 实现 x\n');
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    before: write-delta',
      '    node: { id: review-gate, name: 评审门, done_when: "marker:REVIEW_DONE" }',
    ].join('\n'));
    const view = deriveOverlayView(root, coreLaunched, [], proposalDir)!;
    const rg = view.overlay_nodes.find(n => n.id === 'review-gate');
    expect(rg?.state).toBe('skipped'); // 锚点 write-delta when:delta_required=false → skipped
    expect(view.current_node).toBeNull(); // 不阻塞，进入 coding
  });

  it('UT-S25-30: 纯代码提案 + add AFTER write-proposal（同位置但锚点不同）→ 仍 active（不误跳）', () => {
    const root = tempProject();
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(proposalDir, { recursive: true });
    const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '代码级', '',
      '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯代码',
      '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
      '## 变更概述', '概述。'].join('\n');
    writeFileSync(join(proposalDir, 'proposal.md'), proposal);
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [ ] 实现 x\n');
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    after: write-proposal',
      '    node: { id: kickoff, name: 启动, done_when: "marker:KICK_DONE" }',
    ].join('\n'));
    const view = deriveOverlayView(root, coreLaunched, [], proposalDir)!;
    // 锚点 write-proposal（无 when）→ 不跳过 → kickoff active 阻塞（与 before write-delta 同位置但语义不同）
    expect(view.current_node).toMatchObject({ id: 'kickoff', state: 'active' });
  });

  it('UT-S25-27: launched add 带 fail_when 命中 → state failed（F2）', () => {
    const root = tempProject();
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'FAILED_MARK'), 'x');
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    before: write-proposal',
      '    node: { id: gate, name: 闸门, done_when: "marker:OK", fail_when: "marker:FAILED_MARK" }',
    ].join('\n'));
    const view = deriveOverlayView(root, coreLaunched, [], proposalDir)!;
    expect(view.current_node).toMatchObject({ id: 'gate', state: 'failed' });
  });

  it('UT-S25-12 / ST-S25-EX-2.2: launched builtin skip → FLOW_SCHEMA_INVALID（fail loud）', () => {
    const root = tempProject();
    writeOverlay(root, 'launched', 'extends: builtin:launched@v1\noverlay:\n  - op: skip\n    target: verify\n');
    expect(() => deriveOverlayView(root, coreLaunched, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S25-13: launched builtin reorder → FLOW_SCHEMA_INVALID（fail loud）', () => {
    const root = tempProject();
    writeOverlay(root, 'launched', 'extends: builtin:launched@v1\noverlay:\n  - op: reorder\n    target: smoke\n    after: verify\n');
    expect(() => deriveOverlayView(root, coreLaunched, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S25-11: launched add 到首个 builtin 之前 → proposal_step 回退 = writing', () => {
    const root = tempProject();
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    before: write-proposal',
      '    node: { id: intake, name: 接单, done_when: "marker:INTAKE_DONE" }',
    ].join('\n'));
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(proposalDir, { recursive: true });
    const view = deriveOverlayView(root, coreLaunched, [], proposalDir)!;
    expect(view.current_node).toMatchObject({ id: 'intake', overlay_op: 'add' });
    expect(view.proposal_step_override).toBe('writing');
  });
});

describe('S25 — overlay 驱动派生（unit: applyOverlay 校验）', () => {
  it('UT-S25-14 / ST-S25-EX-2.3: op:modify 覆盖 id → FLOW_SCHEMA_INVALID', () => {
    const builtin = loadBuiltinFlow('initial');
    expect(() => applyOverlay(builtin, { overlay: [{ op: 'modify', target: 'code', set: { id: 'renamed' } }] }, 'initial'))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });
  it('UT-S25-14b / UT-S25-04: op:modify 改非 id 字段（review_agent）仍合法（不破坏 S22）', () => {
    const builtin = loadBuiltinFlow('initial');
    expect(() => applyOverlay(builtin, { overlay: [{ op: 'modify', target: 'code', set: { review_agent: 'r' } }] }, 'initial'))
      .not.toThrow();
  });
});

describe('S25 — overlay 驱动派生（command: status / next）', () => {
  it('ST-S25-01 / UT-S25-18: initial overlay add → status JSON 顶层 overlay_nodes + current_node（legacy 回退）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ADD_KICKOFF_BEFORE_PRD);
    const data = runJson(root, () => status('json'));
    expect(data.overlay_nodes.map((n: any) => n.id)).toEqual(['kickoff']);
    expect(data.current_node).toMatchObject({ id: 'kickoff', overlay_op: 'add' });
  });

  it('ST-S25-02 / UT-S25-08: launched overlay add → status JSON modules[].overlay_nodes/current_node', () => {
    const root = tempProject();
    setLaunchedModule(root);
    fillProposal(root);
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    before: write-proposal',
      '    node: { id: intake, name: 接单, done_when: "marker:INTAKE_DONE" }',
    ].join('\n'));
    const data = runJson(root, () => status('json'));
    const mod = data.modules.find((m: any) => m.id === 'core');
    expect(mod.overlay_nodes.map((n: any) => n.id)).toEqual(['intake']);
    expect(mod.current_node).toMatchObject({ id: 'intake', overlay_op: 'add' });
    // proposal_step 回退到合法枚举（writing，无前序 builtin）
    expect(mod.active_change.proposal_step).toBe('writing');
    // F3：suggestion 指向 overlay 节点，不再提示后续 builtin gate/merge
    expect(mod.suggestion).toContain('intake');
    expect(mod.suggestion).not.toMatch(/merge/i);
  });

  it('ST-S25-05: launched 卡在 overlay 节点 → next action 指向该节点（F3）', () => {
    const root = tempProject();
    setLaunchedModule(root);
    fillProposal(root);
    writeFileSync(join(root, 'logos', 'changes', 'feat', 'tasks.md'),
      '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n');
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    after: write-delta',
      '    node: { id: review-gate, name: 评审门, done_when: "marker:REVIEW_DONE" }',
    ].join('\n'));
    const data = runJson(root, () => next('json'));
    const mod = data.modules.find((m: any) => m.id === 'core');
    expect(mod.action).toContain('review-gate');
    expect(mod.command).toBeNull(); // 不提示 openlogos merge
  });

  it('ST-S25-04: 无 overlay → status JSON 不含 overlay_nodes/current_node（golden 零漂移属性）', () => {
    const root = tempProject();
    const data = runJson(root, () => status('json'));
    expect(data).not.toHaveProperty('overlay_nodes');
    expect(data).not.toHaveProperty('current_node');
  });

  it('UT-S25-03: initial overlay skip 内置节点 → phase_progress 标 skipped（resolved 派生生效）', () => {
    const root = tempProject();
    setInitialModule(root);
    writeOverlay(root, 'initial', 'extends: builtin:initial@v1\noverlay:\n  - op: skip\n    target: orchestration-test\n');
    const data = runJson(root, () => status('json'));
    const mod = data.modules.find((m: any) => m.id === 'core');
    // orchestration-test → phase.3-4b
    expect(mod.phase_progress['phase.3-4b']).toMatchObject({ skipped: true });
  });

  it('UT-S25-05: initial overlay reorder 内置节点 → phases[] 顺序随之变化（resolved 派生生效）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', 'extends: builtin:initial@v1\noverlay:\n  - op: reorder\n    target: db-design\n    before: api-design\n');
    const data = runJson(root, () => status('json'));
    const keys = data.phases.map((p: any) => p.key);
    // db-design(phase.3-2-db) 现排在 api-design(phase.3-2-api) 之前
    expect(keys.indexOf('phase.3-2-db')).toBeLessThan(keys.indexOf('phase.3-2-api'));
  });

  it('UT-S25-19: overlay 只做 builtin（无 add）→ 不新增字段', () => {
    const root = tempProject();
    setInitialModule(root);
    writeOverlay(root, 'initial', 'extends: builtin:initial@v1\noverlay:\n  - op: skip\n    target: orchestration-test\n');
    const data = runJson(root, () => status('json'));
    const mod = data.modules.find((m: any) => m.id === 'core');
    expect(mod).not.toHaveProperty('overlay_nodes');
    expect(mod).not.toHaveProperty('current_node');
  });

  it('ST-S25-03/UT-S25-21: launched builtin skip → status 报 FLOW_SCHEMA_INVALID envelope + 非零退出', () => {
    const root = tempProject();
    setLaunchedModule(root);
    fillProposal(root);
    writeOverlay(root, 'launched', 'extends: builtin:launched@v1\noverlay:\n  - op: skip\n    target: verify\n');
    const { code, envelope } = runJsonErr(root, () => status('json'));
    expect(code).toBe('FLOW_SCHEMA_INVALID');
    expect(envelope.command).toBe('status');
  });

  it('UT-S25-10: launched add 在 write-delta 后（[delta] 全勾）→ proposal_step = ready-to-merge（F1 修复）', () => {
    const root = tempProject();
    setLaunchedModule(root);
    fillProposal(root);
    writeFileSync(join(root, 'logos', 'changes', 'feat', 'tasks.md'),
      '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n');
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    after: write-delta',
      '    node: { id: review-gate, name: 评审门, done_when: "marker:REVIEW_DONE" }',
    ].join('\n'));
    const data = runJson(root, () => status('json'));
    const mod = data.modules.find((m: any) => m.id === 'core');
    expect(mod.current_node).toMatchObject({ id: 'review-gate', overlay_op: 'add' });
    expect(mod.active_change.proposal_step).toBe('ready-to-merge');
    // F3：顶层 proposal_step 同步
    expect(data.proposal_step).toBe('ready-to-merge');
  });

  it('UT-S25-22: next 有 modules[] 时 current_node 挂 modules[] 下、顶层不输出（F4 契约）', () => {
    const root = tempProject();
    setLaunchedModule(root);
    fillProposal(root);
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    before: write-proposal',
      '    node: { id: intake, name: 接单, done_when: "marker:INTAKE_DONE" }',
    ].join('\n'));
    const data = runJson(root, () => next('json'));
    expect(data).not.toHaveProperty('current_node'); // 顶层不输出
    const mod = data.modules.find((m: any) => m.id === 'core');
    expect(mod.current_node).toMatchObject({ id: 'intake', overlay_op: 'add' });
  });

  it('UT-S25-37: launched 无活跃提案 + overlay add → 不输出 node 级视图、不覆盖 change 建议（Review）', () => {
    const root = tempProject();
    setLaunchedModule(root); // 无 guard / 无活跃提案
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    before: write-proposal',
      '    node: { id: intake, name: 接单, done_when: "marker:INTAKE_DONE" }',
    ].join('\n'));
    const data = runJson(root, () => status('json'));
    const mod = data.modules.find((m: any) => m.id === 'core');
    expect(mod.active_change).toBeNull();
    expect(mod).not.toHaveProperty('current_node');
    expect(mod).not.toHaveProperty('overlay_nodes');
    expect(mod.suggestion).toContain('change'); // 仍提示 openlogos change <slug>
    expect(mod.suggestion).not.toContain('intake');
  });

  it('UT-S25-38: launched 无活跃提案仍做 flow 配置校验（skip/reorder fail loud）', () => {
    const root = tempProject();
    setLaunchedModule(root);
    writeOverlay(root, 'launched', 'extends: builtin:launched@v1\noverlay:\n  - op: skip\n    target: verify\n');
    const { code } = runJsonErr(root, () => status('json'));
    expect(code).toBe('FLOW_SCHEMA_INVALID');
  });

  it('UT-S25-31: 多模块 dir_nonempty 按 {module}- 前缀过滤（F1）', () => {
    const root = tempProject();
    // 多模块：core + app，均 initial
    writeFileSync(join(root, 'logos', 'logos-project.yaml'),
      'project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: initial\n  - id: app\n    name: app\n    lifecycle: initial\n');
    // 仅 core- 前缀的 prd 文件存在
    writeFileSync(join(root, 'logos/resources/prd/1-product-requirements/core-01-requirements.md'), '# req\n');
    writeOverlay(root, 'initial', [
      'extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    after: prd',
      '    node: { id: gate, name: 门, done_when: "file:logos/resources/GATE" }',
    ].join('\n'));
    const data = runJson(root, () => status('json'));
    const core = data.modules.find((m: any) => m.id === 'core');
    const app = data.modules.find((m: any) => m.id === 'app');
    // core：prd done（core- 文件）→ 卡在 prd 后的 add 节点
    expect(core.current_node).toMatchObject({ id: 'gate' });
    // app：prd 未 done（无 app- 文件，已按前缀过滤）→ 不应到达 add 节点
    expect(app.current_node).toBeUndefined();
    expect(app.phase_progress['phase.1'].done).toBe(false);
  });

  it('UT-S25-32: initial op:skip 内置节点 → 顶层 data.phases[].skipped=true（F2）', () => {
    const root = tempProject(); // legacy 无 modules[]
    writeOverlay(root, 'initial', 'extends: builtin:initial@v1\noverlay:\n  - op: skip\n    target: orchestration-test\n');
    const data = runJson(root, () => status('json'));
    const ph = data.phases.find((p: any) => p.key === 'phase.3-4b');
    expect(ph.skipped).toBe(true);
  });

  it('UT-S25-33: next --auto 被 overlay 节点挡住时 gate_id/skippable 置 null（F3）', () => {
    const root = tempProject();
    setLaunchedModule(root);
    fillProposal(root);
    writeFileSync(join(root, 'logos', 'changes', 'feat', 'tasks.md'),
      '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n');
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    after: write-delta',
      '    node: { id: review-gate, name: 评审门, done_when: "marker:REVIEW_DONE" }',
    ].join('\n'));
    const data = runJson(root, () => next('json', undefined, true));
    expect(data.gate_auto_passed).toBe(false);
    expect(data.gate_id).toBeNull();
    expect(data.skippable).toBeNull();
  });

  it('UT-S25-34 / UT-S25-09: launched modify 内置节点 marker 名 → 经 resolved flow 流入 proposal_step 检测', () => {
    const root = tempProject();
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(proposalDir, { recursive: true });
    // 纯代码提案 + code 全勾 + 自定义 verify marker 命中 → ready-to-verify 之后 verify-passed
    const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '代码级', '',
      '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯代码',
      '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
      '## 变更概述', '概述。'].join('\n');
    writeFileSync(join(proposalDir, 'proposal.md'), proposal);
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] 实现 x\n');
    writeFileSync(join(proposalDir, 'CUSTOM_VERIFY'), 'x'); // 自定义 marker
    writeOverlay(root, 'launched',
      'extends: builtin:launched@v1\noverlay:\n  - op: modify\n    target: verify\n    set: { done_when: "marker:CUSTOM_VERIFY" }\n');
    // detectProposalStepViaFlow 读 resolved flow → 用 CUSTOM_VERIFY 而非 VERIFY_PASS
    expect(detectProposalStepViaFlow(proposalDir, coreLaunched)).toBe('verify-passed');
  });

  it('UT-S25-09b: launched modify write-delta section_complete tag 不承诺生效（仍按固定 delta tag）', () => {
    const root = tempProject();
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(proposalDir, { recursive: true });
    const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '设计级', '',
      '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯文档',
      '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
      '## 变更概述', '概述。'].join('\n');
    writeFileSync(join(proposalDir, 'proposal.md'), proposal);
    // [delta] 全勾 → 固定 tag 逻辑判 ready-to-merge
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n');
    // 试图把 write-delta 的 section tag 改成 custom（本切片不承诺生效）
    writeOverlay(root, 'launched',
      'extends: builtin:launched@v1\noverlay:\n  - op: modify\n    target: write-delta\n    set: { done_when: "section_complete:custom" }\n');
    // 仍按固定 delta tag 判定（[delta] 全勾）→ ready-to-merge，未漂移到 custom（无 [custom] section 时不会误判）
    expect(detectProposalStepViaFlow(proposalDir, coreLaunched)).toBe('ready-to-merge');
  });

  it('UT-S25-35: flow show --resolved 展示 launched skip（不报错），而派生 fail loud（解耦）', () => {
    const root = tempProject();
    setLaunchedModule(root);
    writeOverlay(root, 'launched', 'extends: builtin:launched@v1\noverlay:\n  - op: skip\n    target: verify\n');
    // flow show --resolved：宽松，正常展示已应用（verify 标 skipped）
    const restoreCwd = mockCwd(root);
    const cap = captureConsole();
    try { flowShow('json', { resolved: true, lifecycle: 'launched' }); } finally { cap.restore(); restoreCwd(); }
    const data = JSON.parse(cap.logs[0]).data;
    const verifyNode = data.flow.subflows.flatMap((s: any) => s.nodes).find((n: any) => n.id === 'verify');
    expect(verifyNode.skipped).toBe(true); // flow show 展示已应用，未报错
    // 而派生：fail loud
    const { code } = runJsonErr(root, () => status('json'));
    expect(code).toBe('FLOW_SCHEMA_INVALID');
  });

  it('UT-S25-36: watch 命中派生 FlowError → 输出错误信封 + 非零退出（不进轮询）', () => {
    const root = tempProject();
    setLaunchedModule(root);
    writeOverlay(root, 'launched', 'extends: builtin:launched@v1\noverlay:\n  - op: skip\n    target: verify\n');
    const { code, envelope } = runJsonErr(root, () => watch('json'));
    expect(code).toBe('FLOW_SCHEMA_INVALID');
    expect(envelope.command).toBe('watch');
  });

  it('UT-S25-20: next --auto 在未完成 overlay-added 节点上不放行 gate', () => {
    const root = tempProject();
    setLaunchedModule(root);
    fillProposal(root);
    // 让 tasks 全勾 → ready-to-merge（propose gate 可跳）
    writeFileSync(join(root, 'logos', 'changes', 'feat', 'tasks.md'),
      '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n');
    // overlay 在 write-delta 后插入未完成 active 节点（gate 未真正到达）
    writeOverlay(root, 'launched', [
      'extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    after: write-delta',
      '    node: { id: review-gate, name: 评审门, done_when: "marker:REVIEW_DONE" }',
    ].join('\n'));
    const data = runJson(root, () => next('json', undefined, true));
    // 当前落在 overlay-added review-gate（未完成）→ 不应 gate_auto_passed
    expect(data.gate_auto_passed).toBe(false);
  });
});
