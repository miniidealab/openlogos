/**
 * S28 — next 暴露 next_node 编排提示。
 * 复用 S22/S26/S27 临时项目 overlay 模式（makeTempRoot + scaffoldProject + 写 logos/flow/<lifecycle>.yaml）。
 * 含 OpenLogos reporter（用例名带 UT-S28 / ST-S28 编号）。golden 由 golden-baseline.test.ts 另行 re-baseline。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd } from './helpers.js';
import { next } from '../src/commands/next.js';
import { status } from '../src/commands/status.js';
import { resolveNextNode } from '../src/lib/flow-overlay-derive.js';
import { loadFlow } from '../src/lib/flow.js';
import type { ModuleInfo } from '../src/commands/status.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempProject(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  cleanups.push(cleanup);
  return root;
}
function writeOverlay(root: string, lifecycle: string, yaml: string) {
  mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
  writeFileSync(join(root, 'logos', 'flow', `${lifecycle}.yaml`), yaml);
}
function setLoop(lifecycle: string, maxIters: number, extraSet = ''): string {
  return [`extends: builtin:${lifecycle}@v1`, 'overlay:', '  - op: set-loop', '    subflow: implement',
    `    set: { max_iters: ${maxIters}${extraSet} }`].join('\n');
}
type Row = { iter: number; node: string; result: 'pass' | 'fail'; module: string; timestamp: string };
function writeLedger(path: string, rows: Row[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
function row(iter: number, result: 'pass' | 'fail'): Row {
  return { iter, node: 'verify', result, module: 'core', timestamp: '2026-06-21T00:00:00Z' };
}
function setSingleModule(root: string, lifecycle: 'initial' | 'launched') {
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    `project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: ${lifecycle}\n`);
}
const PROPOSAL = (kind = '代码级') => ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', kind, '',
  '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯代码',
  '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
  '## 变更概述', '概述。'].join('\n');
/** launched ready-to-verify（current builtin = verify）。 */
function setupLaunchedVerify(root: string, slug = 'feat'): string {
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  writeFileSync(join(dir, 'proposal.md'), PROPOSAL());
  writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] 实现 x\n');
  return dir;
}
/** launched coding（current builtin = code）：SPEC_MERGED + [code] 未勾。 */
function setupLaunchedCoding(root: string, slug = 'feat'): string {
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  writeFileSync(join(dir, 'proposal.md'), PROPOSAL('设计级'));
  writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n\n## [code] 代码实现\n- [ ] 实现 x\n');
  writeFileSync(join(dir, 'SPEC_MERGED'), '');
  return dir;
}
async function runNextJson(root: string, auto = false): Promise<any> {
  const restore = mockCwd(root); const cap = captureConsole();
  try { await next('json', undefined, auto); } finally { cap.restore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}
function runStatusJson(root: string): any {
  const restore = mockCwd(root); const cap = captureConsole();
  try { status('json'); } finally { cap.restore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}

// ── 一、builtin / overlay 当前节点 + 字段 + 挂载 ──
describe('S28 — builtin/overlay 当前节点 + 字段 + 挂载', () => {
  it('UT-S28-01 / UT-S28-25 / ST-S28-01: initial phase→builtin（PHASE_KEY_TO_NODE_ID）→ 输出 skill', async () => {
    const root = tempProject(); // 全新 initial → phase.1 → prd
    const d = await runNextJson(root);
    expect(d.next_node).toMatchObject({ id: 'prd', subflow_id: 'why', skill: 'prd-writer' });
    // 5 hint 字段固定存在
    for (const k of ['skill', 'working_agent', 'review_agent', 'pre_script', 'post_script']) expect(k in d.next_node).toBe(true);
  });

  it('UT-S28-02: launched step→builtin（STEP_TO_CURRENT_BUILTIN）→ 节点 hints', async () => {
    const root = tempProject(); setSingleModule(root, 'launched'); setupLaunchedCoding(root); // coding → code
    const d = await runNextJson(root);
    expect(d.modules[0].next_node).toMatchObject({ id: 'code', subflow_id: 'implement', skill: 'code-implementor' });
  });

  it('UT-S28-03: overlay-add 当前节点 → 输出其 hints', async () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: add', '    before: prd',
      '    node: { id: lint, name: 静态检查, skill: linter, working_agent: my-linter, done_when: "file:logos/resources/NOPE" }'].join('\n'));
    const d = await runNextJson(root);
    expect(d.next_node).toMatchObject({ id: 'lint', skill: 'linter', working_agent: 'my-linter' });
  });

  it('UT-S28-04 / UT-S28-05 / UT-S28-06 / ST-S28-02: overlay modify 重绑 agent + script 透出', async () => {
    const root = tempProject(); setSingleModule(root, 'launched'); setupLaunchedCoding(root);
    writeOverlay(root, 'launched', ['extends: builtin:launched@v1', 'overlay:', '  - op: modify', '    target: code',
      '    set: { review_agent: "my-reviewer", working_agent: "my-coder", pre_script: "./pre.sh", post_script: "./post.sh" }'].join('\n'));
    const d = await runNextJson(root);
    expect(d.modules[0].next_node).toMatchObject({
      id: 'code', review_agent: 'my-reviewer', working_agent: 'my-coder', pre_script: './pre.sh', post_script: './post.sh',
    });
  });

  it('UT-S28-07 / UT-S28-08: 字段类型 + verify skill=null（5 字段固定存在）', async () => {
    const root = tempProject(); setSingleModule(root, 'launched'); setupLaunchedVerify(root); // ready-to-verify → verify
    const d = await runNextJson(root);
    const nn = d.modules[0].next_node;
    expect(nn).toMatchObject({ id: 'verify', subflow_id: 'implement', skill: null });
    expect(typeof nn.id).toBe('string'); expect(typeof nn.name).toBe('string'); expect(typeof nn.subflow_id).toBe('string');
    for (const k of ['working_agent', 'review_agent', 'pre_script', 'post_script']) expect(k in nn).toBe(true);
  });

  it('UT-S28-09 / UT-S28-10 / ST-S28-03: 挂载同构（modules[].next_node / legacy 顶层）', async () => {
    const mods = tempProject(); setSingleModule(mods, 'launched'); setupLaunchedCoding(mods);
    const dm = await runNextJson(mods);
    expect(dm.modules[0].next_node?.id).toBe('code');
    expect(dm.next_node).toBeUndefined(); // 有 modules[] → 顶层不挂

    const legacy = tempProject(); // 无 modules[]
    const dl = await runNextJson(legacy);
    expect(dl.next_node?.id).toBe('prd');
    expect(dl.modules).toBeUndefined();
  });
});

// ── 二、R3 cmd 续推 ──
describe('S28 — R3 cmd 续推', () => {
  it('UT-S28-11 / ST-S28-04: cmd done 续推 → 指向续推后节点（非已 done cmd）', async () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: add', '    before: prd',
      '    node: { id: chk, name: 检查, done_when: "cmd:true" }'].join('\n'));
    const d = await runNextJson(root);
    expect(d.cmd_satisfied).toBe(true);
    expect(d.next_node?.id).not.toBe('chk'); // 已 done 的 cmd 节点不作 next_node
    expect(d.next_node?.id).toBe('prd');     // 续推后落到 prd
  });

  it('UT-S28-12: cmd 失败 → 指向该 cmd 节点', async () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: add', '    before: prd',
      '    node: { id: chk, name: 检查, done_when: "cmd:exit 3" }'].join('\n'));
    const d = await runNextJson(root);
    expect(d.cmd_satisfied).toBe(false);
    expect(d.next_node?.id).toBe('chk'); // 求值后仍是该 cmd 节点
  });

  it('UT-S28-13: cmd 超时 → 指向该 cmd 节点', async () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: add', '    before: prd',
      '    node: { id: chk, name: 检查, done_when: "cmd:sleep 5", cmd_timeout_seconds: 1 }'].join('\n'));
    const d = await runNextJson(root);
    expect(d.cmd_timed_out).toBe(true);
    expect(d.next_node?.id).toBe('chk'); // 超时未通过 → 仍是该 cmd 节点
  }, 10000);

  it('UT-S28-14: budget=1 → 指向第二个 pending cmd 节点', async () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    before: prd', '    node: { id: c1, name: 一, done_when: "cmd:true" }',
      '  - op: add', '    after: c1', '    node: { id: c2, name: 二, done_when: "cmd:true" }'].join('\n'));
    const d = await runNextJson(root);
    expect(d.next_node?.id).toBe('c2'); // 第一个 done 续推到第二个 pending cmd
  });
});

// ── 三、R4 auto / R7 loop / R5 命令级 → 省略 ──
describe('S28 — 省略规则（R4/R7/R5）', () => {
  it('UT-S28-15 / ST-S28-05 / ST-S28-EX-4: --auto gate 放行默认省略，plan-exit 消费/重复 auto 返回 write-delta', async () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    const dir = join(root, 'logos', 'changes', 'feat'); mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    // 设计级 + [delta] 全勾 → ready-to-merge（可跳 gate）
    writeFileSync(join(dir, 'proposal.md'), PROPOSAL('设计级'));
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n');
    const d = await runNextJson(root, true);
    expect(d.gate_auto_passed).toBe(true);
    expect(d.modules[0].next_node).toBeUndefined();

    const planRoot = tempProject(); setSingleModule(planRoot, 'launched');
    const planDir = join(planRoot, 'logos', 'changes', 'feat'); mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planRoot, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    writeFileSync(join(planDir, 'proposal.md'), PROPOSAL('设计级'));
    writeFileSync(join(planDir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [ ] 产出 delta\n');
    const plan = await runNextJson(planRoot, true);
    expect(plan.gate_auto_passed).toBe(true);
    expect(plan.gate_id).toBe('plan-exit');
    expect(plan.proposal_step).toBe('delta-writing');
    expect(plan.modules[0].next_node).toMatchObject({ id: 'write-delta', subflow_id: 'spec', skill: 'change-writer' });
    expect(existsSync(join(planDir, 'PLAN_APPROVED'))).toBe(true);

    const repeated = await runNextJson(planRoot, true);
    expect(repeated.gate_auto_passed).toBe(false);
    expect(repeated.gate_id).toBeNull();
    expect(repeated.proposal_step).toBe('delta-writing');
    expect(repeated.modules[0].next_node).toMatchObject({ id: 'write-delta' });
  });

  it('UT-S28-16 / UT-S28-17 / ST-S28-06: loop 阻塞未达上限 → next_node=code（含重绑 hints）', async () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    const dir = setupLaunchedVerify(root); // ready-to-verify
    writeOverlay(root, 'launched', ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 3 }',
      '  - op: modify', '    target: code', '    set: { working_agent: "fixer" } '].join('\n'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]);
    const d = await runNextJson(root);
    expect(d.modules[0].loop_state).toMatchObject({ converged: false, escalated: false });
    expect(d.modules[0].next_node).toMatchObject({ id: 'code', working_agent: 'fixer' }); // 非 verify、含重绑
  });

  it('UT-S28-20 / UT-S28-20b / ST-S28-07: 达上限 escalated → 普通 next 省略；--auto 出 loop-exhausted gate', async () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    const dir = setupLaunchedVerify(root);
    writeOverlay(root, 'launched', setLoop('launched', 2));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail')]);
    const d = await runNextJson(root);
    expect(d.modules[0].loop_state.escalated).toBe(true);
    expect(d.modules[0].next_node).toBeUndefined();
    expect(d.gate_id).toBeUndefined(); // 普通 next 无 gate 字段
    const da = await runNextJson(root, true);
    expect(da.gate_id).toBe('gate:implement:loop-exhausted');
    expect(da.skippable).toBe(false);
    expect(da.modules[0].next_node).toBeUndefined();
  });

  it('UT-S28-19 / ST-S28-EX-3: initial loop 阻塞 + code 被 overlay skip → 省略（loop_state 仍在）', () => {
    // resolveNextNode 直测：loop 阻塞、code 被 skip → null
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:',
      '  - op: skip', '    target: code',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 3 }'].join('\n'));
    const mod: ModuleInfo = { id: 'core', name: 'core', lifecycle: 'initial' };
    const nn = resolveNextNode(root, mod, { loopBlocking: true, loopEscalated: false });
    expect(nn).toBeNull(); // code 被 skip → 省略
  });

  it('UT-S28-22 / UT-S28-23 / ST-S28-08 / ST-S28-EX-2: 命令级建议（无 active proposal / all_done）→ 省略', async () => {
    // 无 active proposal（launched）→ 建议 change → 省略
    const noProp = tempProject(); setSingleModule(noProp, 'launched');
    const d1 = await runNextJson(noProp);
    expect(d1.modules[0].next_node).toBeUndefined();
    // all_done / 直测 resolveNextNode 无 step/phase → null
    const root = tempProject();
    const mod: ModuleInfo = { id: 'core', name: 'core', lifecycle: 'launched' };
    expect(resolveNextNode(root, mod, { proposalStep: null, currentPhase: null })).toBeNull();
  });

  it('UT-S28-24: initial adopted 补 baseline（命令级，current_phase 非空）→ 所有层级省略 next_node', async () => {
    const root = tempProject();
    writeFileSync(join(root, 'logos', 'logos-project.yaml'),
      'project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: initial\n    bootstrap: adopted\n');
    const d = await runNextJson(root);
    expect(d.command).toBe('openlogos change add-baseline-docs'); // 命令级建议
    expect(d.next_node).toBeUndefined();
    expect(d.modules[0].next_node).toBeUndefined(); // 不得误把 scenario-modeling 当 next_node
  });
});

// ── 四、R7 overlay 优先 + launched skip 报错 + 范围边界（直测/集成）──
describe('S28 — R7 优先级 / launched skip 报错 / 范围边界', () => {
  it('UT-S28-18: loop 阻塞 + overlay current_node 优先（取真实 overlay-add 节点 hints）', () => {
    // 集成路径下 loopBlocking 与 overlay current_node 难同时成立（overlay-add 当前节点会触发 proposal_step_override、令前沿离开 verify）；
    // 故直测优先级分支，但用**真实 overlay-add 节点**（在 resolved flow 中存在、带 skill），证明 current_node 优先 + 取其真实 hints。
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 3 }',
      '  - op: add', '    after: code', '    node: { id: extra, name: 附加, skill: my-skill, working_agent: a1, done_when: "file:logos/resources/NOPE" }'].join('\n'));
    const mod: ModuleInfo = { id: 'core', name: 'core', lifecycle: 'initial' };
    const nn = resolveNextNode(root, mod, { loopBlocking: true, currentNode: { id: 'extra' } });
    expect(nn).toMatchObject({ id: 'extra', skill: 'my-skill', working_agent: 'a1' }); // current_node 优先于 code，取真实 hints
  });

  it('UT-S28-03b: 集成——overlay-add 当前节点经 next 透传为 next_node（真实 CurrentNode 形态）', async () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: add', '    before: prd',
      '    node: { id: gate0, name: 启动门, skill: kicker, review_agent: rv, done_when: "file:logos/resources/NOPE" }'].join('\n'));
    const d = await runNextJson(root);
    expect(d.current_node?.id).toBe('gate0');                       // 确为 overlay-add 当前节点
    expect(d.next_node).toMatchObject({ id: 'gate0', skill: 'kicker', review_agent: 'rv' }); // next.ts 如实透传真实 current_node
  });

  it('UT-S28-21 / ST-S28-EX-1: launched builtin code skip → FLOW_SCHEMA_INVALID（非省略）', () => {
    const root = tempProject(); setSingleModule(root, 'launched');
    writeOverlay(root, 'launched', 'extends: builtin:launched@v1\noverlay:\n  - op: skip\n    target: code\n');
    expect(() => loadFlow(root, { lifecycle: 'launched', resolved: true }))
      .not.toThrow(); // applyOverlay 结构性宽松；S25 fail-loud 在派生入口
    expect(() => runStatusJson(root)).toThrow(); // 派生（status）→ FLOW_SCHEMA_INVALID（process.exit 抛）
  });

  it('UT-S28-26 / ST-S28-09: status/watch 不输出 next_node（仅 next 暴露）', () => {
    const root = tempProject(); // 全新 initial（next 会有 next_node）
    const s = runStatusJson(root);
    expect(s).not.toHaveProperty('next_node');
    expect(s.modules ?? []).toEqual(expect.any(Array));
  });
});
