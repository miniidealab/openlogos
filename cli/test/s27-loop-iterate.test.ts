/**
 * S27 — implement(code/verify) loop 真迭代派生（M2 切片 2）。
 * 复用 S22/S25/S26 临时项目 overlay 模式（makeTempRoot + scaffoldProject + 写 logos/flow/<lifecycle>.yaml）。
 * 通过 overlay set-loop(max_iters>1) 激活 loop；LOOP_ITERS 账本预写或真实跑 verify 构造各轮状态。
 * 不改 spec/flow/*.yaml、真实 logos/flow/、golden-baseline fixture。含 OpenLogos reporter（用例名带 UT/ST-S27-*）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { next } from '../src/commands/next.js';
import { status, collectStatusData } from '../src/commands/status.js';
import { verify } from '../src/commands/verify.js';
import { loadFlow } from '../src/lib/flow.js';

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
function setLoop(lifecycle: string, maxIters: number | string, extraSet = ''): string {
  return [`extends: builtin:${lifecycle}@v1`, 'overlay:', '  - op: set-loop', '    subflow: implement',
    `    set: { max_iters: ${maxIters}${extraSet} }`].join('\n');
}
type Row = { iter: number; node: string; result: 'pass' | 'fail'; module: string; timestamp: string };
function row(iter: number, result: 'pass' | 'fail', module = 'core'): Row {
  return { iter, node: 'verify', result, module, timestamp: '2026-06-20T00:00:00Z' };
}
function writeLedger(path: string, rows: Row[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}
function initialLedger(root: string): string { return join(root, 'logos', 'resources', 'verify', 'LOOP_ITERS'); }
function setSingleModule(root: string, lifecycle: 'initial' | 'launched', id = 'core') {
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    `project:\n  name: "t"\nmodules:\n  - id: ${id}\n    name: ${id}\n    lifecycle: ${lifecycle}\n`);
}
function setMultiInitial(root: string) {
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    'project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: initial\n  - id: auth\n    name: auth\n    lifecycle: initial\n');
}
function setupLaunchedProposal(root: string, slug = 'feat'): string {
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯代码',
    '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '概述。'].join('\n');
  writeFileSync(join(dir, 'proposal.md'), proposal);
  writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] 实现 x\n');
  return dir;
}

function runStatusJson(root: string): any {
  const restore = mockCwd(root); const cap = captureConsole();
  try { status('json'); } finally { cap.restore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}
async function runNextJson(root: string, auto = false): Promise<any> {
  const restore = mockCwd(root); const cap = captureConsole();
  try { await next('json', undefined, auto); } finally { cap.restore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}
// verify fixture：写一份最小用例规格 + 结果，控制 gate PASS/FAIL；无结果/无用例 → 早退
function writeVerifyFixture(root: string, opts: { spec?: boolean; result?: 'pass' | 'fail' }) {
  if (opts.spec !== false) {
    writeFileSync(join(root, 'logos', 'resources', 'test', 'core-S99-test-cases.md'),
      '# S99\n\n| ID | 描述 |\n|----|----|\n| UT-S99-01 | demo |\n');
  }
  if (opts.result) {
    writeFileSync(join(root, 'logos', 'resources', 'verify', 'test-results.jsonl'),
      JSON.stringify({ id: 'UT-S99-01', status: opts.result }) + '\n');
  }
}
function runVerify(root: string): { exited: boolean; errors: string[] } {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  let exited = false;
  try { verify('json'); } catch { exited = true; } finally { cap.restore(); restore(); ex.mockRestore(); }
  return { exited, errors: cap.errors };
}

// ── 一、派生：未绿 / 达上限 / 收敛 ──
describe('S27 — loop 派生（next/status）', () => {
  it('UT-S27-01 / ST-S27-01: 未绿 & iteration<max（前沿已到 verify）→ 续迭代措辞 + loop_state 正确', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = setupLaunchedProposal(root); // code 已勾、无 VERIFY_PASS → 前沿 ready-to-verify
    writeOverlay(root, 'launched', setLoop('launched', 3));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]);
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state).toMatchObject({ subflow_id: 'implement', max_iters: 3, iteration: 1, converged: false, escalated: false });
    expect(data.action).toContain('第 1/3 轮');
  });

  it('UT-S27-02 / ST-S27-02: 达上限（前沿已到 verify）→ escalated:true + 升级措辞', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = setupLaunchedProposal(root);
    writeOverlay(root, 'launched', setLoop('launched', 2));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail')]);
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state).toMatchObject({ iteration: 2, converged: false, escalated: true });
    expect(data.action).toContain('升级人类确认');
  });

  it('UT-S27-01b / F1: loop 激活但前沿在 verify 之前（ready-to-merge）→ 不抢占、不显示 loop 措辞', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    // 设计级提案 + [delta] 全勾 → ready-to-merge（前沿远未到 verify）
    writeFileSync(join(dir, 'proposal.md'), ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '设计级', '',
      '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯文档',
      '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '概述。'].join('\n'));
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n');
    writeOverlay(root, 'launched', setLoop('launched', 3));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]); // 即便有账本，前沿未到 verify → 不阻塞
    const data = await runNextJson(root);
    expect(data.proposal_step).toBe('ready-to-merge');
    expect(data.action).not.toContain('轮未绿');
    expect(data.action).not.toContain('升级人类确认');
  });

  it('UT-S27-01c / F1: ready-to-merge + loop 激活 + --auto → gate 仍可 auto-pass（不被 loop 拦）', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    writeFileSync(join(dir, 'proposal.md'), ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '设计级', '',
      '## 变更范围', '- 影响：core', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：纯文档',
      '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '概述。'].join('\n'));
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n');
    writeOverlay(root, 'launched', setLoop('launched', 3));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]);
    const data = await runNextJson(root, true);
    expect(data.gate_id).toBe('propose-exit');
    expect(data.skippable).toBe(true);
    expect(data.gate_auto_passed).toBe(true); // 未被 blockedByLoop 拦截
  });

  it('UT-S27-03 / ST-S27-02: escalated + --auto 仍阻塞、不写 GATE_AUTO_PASSED', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = setupLaunchedProposal(root);
    writeOverlay(root, 'launched', setLoop('launched', 2));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail')]);
    const data = await runNextJson(root, true);
    expect(data.gate_id).toBe('gate:implement:loop-exhausted');
    expect(data.skippable).toBe(false);
    expect(data.gate_auto_passed).toBe(false);
    expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(false);
  });

  it('UT-S27-04 / ST-S27-03: 末轮 pass → converged:true 出环', async () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 3));
    writeLedger(initialLedger(root), [row(1, 'fail'), row(2, 'pass')]);
    const data = await runNextJson(root);
    expect(data.loop_state).toMatchObject({ converged: true });
    // 收敛 → 不再输出 loop 续迭代措辞
    expect(data.action).not.toContain('未绿');
  });
});

// ── 二、R2 出环覆盖 done_when（initial）──
describe('S27 — R2 initial 出环 = converged', () => {
  it('UT-S27-05 / ST-S27-04: initial 激活 verify FAIL（report 已写）仍不推进', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 2));
    // code done（implementation 非空）+ acceptance-report.md 存在（verify done_when 满足）
    mkdirSync(join(root, 'logos', 'resources', 'implementation'), { recursive: true });
    writeFileSync(join(root, 'logos', 'resources', 'implementation', 'x.md'), 'x');
    writeFileSync(join(root, 'logos', 'resources', 'verify', 'acceptance-report.md'), 'report');
    writeLedger(initialLedger(root), [row(1, 'fail')]);
    const data = runStatusJson(root);
    // 未收敛 → 即便 acceptance-report.md 存在，verify(phase.3-6) 也不得判 done（converged 覆盖 done_when）
    expect(data.loop_state?.converged).toBe(false);
    const verifyPhase = data.phases.find((p: any) => p.key === 'phase.3-6');
    expect(verifyPhase.done).toBe(false);
  });
});

// ── 三、verify 写账本（R3/R11/R4）──
describe('S27 — verify 写 LOOP_ITERS 账本', () => {
  it('UT-S27-06: 激活 + 算出 gate(FAIL) → 写账本、result=最终 gate.result', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 3));
    writeVerifyFixture(root, { result: 'fail' });
    runVerify(root);
    const lines = readFileSync(initialLedger(root), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0])).toMatchObject({ iter: 1, node: 'verify', result: 'fail', module: 'core' });
  });

  it('UT-S27-07 / ST-S27-08: 未激活（builtin max_iters:1）→ verify 不写账本', () => {
    const root = tempProject();
    writeVerifyFixture(root, { result: 'pass' });
    runVerify(root);
    expect(existsSync(initialLedger(root))).toBe(false);
  });

  it('UT-S27-08 / ST-S27-EX-1: 配置类早退（NO_TEST_RESULTS）→ 不写账本', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 3));
    writeVerifyFixture(root, { spec: true }); // 有用例、无结果 → NO_TEST_RESULTS
    const r = runVerify(root);
    expect(r.exited).toBe(true);
    expect(r.errors.join('')).toContain('NO_TEST_RESULTS');
    expect(existsSync(initialLedger(root))).toBe(false);
  });

  it('UT-S27-09 / R11: iter = 同 module 已有行数+1（按 module 过滤、不串号）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 3));
    // 预存：其他 module 2 行 + 本 module 1 行 → 本 module 下一 iter 应为 2
    writeLedger(initialLedger(root), [row(1, 'fail', 'auth'), row(2, 'fail', 'auth'), row(1, 'fail', 'core')]);
    writeVerifyFixture(root, { result: 'fail' });
    runVerify(root);
    const lines = readFileSync(initialLedger(root), 'utf-8').trim().split('\n').map(l => JSON.parse(l));
    const coreRows = lines.filter((r: any) => r.module === 'core');
    expect(coreRows[coreRows.length - 1].iter).toBe(2); // 非整文件总行数(4)
  });

  it('UT-S27-10 / ST-S27-05: 收敛后再 FAIL → converged 转 false、implement 重开', async () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 3));
    writeLedger(initialLedger(root), [row(1, 'pass')]);
    expect((await runNextJson(root)).loop_state.converged).toBe(true);
    // 再跑一次 verify(FAIL) → 续写 fail 行
    writeVerifyFixture(root, { result: 'fail' });
    runVerify(root);
    const data = await runNextJson(root);
    expect(data.loop_state.converged).toBe(false);
    expect(data.loop_state.iteration).toBe(2);
  });
});

// ── 四、module 过滤 / 多模块 / 挂载 / proposal_step ──
describe('S27 — module 过滤 / 多模块 / 挂载', () => {
  it('UT-S27-11 / R5: initial 账本按 module 过滤', () => {
    const root = tempProject();
    setSingleModule(root, 'initial', 'core');
    writeOverlay(root, 'initial', setLoop('initial', 3));
    writeLedger(initialLedger(root), [row(1, 'fail', 'core'), row(1, 'fail', 'auth'), row(2, 'fail', 'auth')]);
    const data = runStatusJson(root);
    const mod = data.modules.find((m: any) => m.id === 'core');
    expect(mod.loop_state.iteration).toBe(1); // 仅计 core 行
  });

  it('UT-S27-12 / ST-S27-EX-3: initial 多模块 set-loop → 不激活（无 loop_state、verify 不写账本）', async () => {
    const root = tempProject();
    setMultiInitial(root);
    writeOverlay(root, 'initial', setLoop('initial', 3));
    const data = runStatusJson(root);
    for (const m of data.modules) expect(m.loop_state).toBeUndefined();
    writeVerifyFixture(root, { result: 'fail' });
    runVerify(root);
    expect(existsSync(initialLedger(root))).toBe(false);
  });

  it('UT-S27-13 / R10: escalated 时 proposal_step 仍既有枚举、不新增 loop-exhausted', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = setupLaunchedProposal(root);
    writeOverlay(root, 'launched', setLoop('launched', 2));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail'), row(2, 'fail')]);
    const data = await runNextJson(root);
    const VALID = ['writing', 'delta-writing', 'ready-to-merge', 'merge-generated', 'coding',
      'ready-to-verify', 'verify-passed', 'verify-failed', 'ready-to-deploy', 'deploy-done',
      'ready-to-smoke', 'smoke-passed', 'smoke-failed'];
    expect(VALID).toContain(data.proposal_step);
    expect(data.proposal_step).not.toBe('loop-exhausted');
  });

  it('UT-S27-18 / R6: loop_state 挂 modules[].loop_state（next 同步）', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = setupLaunchedProposal(root);
    writeOverlay(root, 'launched', setLoop('launched', 3));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]);
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state).toMatchObject({ iteration: 1, max_iters: 3 });
    expect(data.loop_state).toBeUndefined(); // 有 modules[] → 顶层不重复挂
  });
});

// ── 五、set-loop schema 校验（R9）──
describe('S27 — set-loop schema 校验', () => {
  const bad = (root: string) => () => loadFlow(root, { lifecycle: 'initial', resolved: true });
  it('UT-S27-14 / ST-S27-EX-2: set 含未知 key → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 3, ', exhausted_gate: true'));
    expect(bad(root)).toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });
  it('UT-S27-15 / ST-S27-EX-2: max_iters < 1 / 非整数 → FLOW_SCHEMA_INVALID', () => {
    const r0 = tempProject(); writeOverlay(r0, 'initial', setLoop('initial', 0));
    expect(bad(r0)).toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
    const r1 = tempProject(); writeOverlay(r1, 'initial', setLoop('initial', 0.5));
    expect(bad(r1)).toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });
  it('UT-S27-16 / ST-S27-EX-2: until 非 tests_green → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: set-loop',
      '    subflow: implement', '    set: { max_iters: 3, until: "review_ok" }'].join('\n'));
    expect(bad(root)).toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });
  it('UT-S27-17 / ST-S27-EX-2: 非法 subflow / 缺 set → FLOW_SCHEMA_INVALID', () => {
    const r0 = tempProject();
    writeOverlay(r0, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: set-loop',
      '    subflow: nope', '    set: { max_iters: 3 }'].join('\n'));
    expect(bad(r0)).toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
    const r1 = tempProject();
    writeOverlay(r1, 'initial', 'extends: builtin:initial@v1\noverlay:\n  - op: set-loop\n    subflow: implement\n');
    expect(bad(r1)).toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('F4: set-loop 真迭代(max_iters>1) 用于非 implement 子流程 → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:', '  - op: set-loop',
      '    subflow: deliver', '    set: { max_iters: 3 }'].join('\n'));
    expect(bad(root)).toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });
});

// ── 七、F2/F3 回归 ──
describe('S27 — F2/F3 回归', () => {
  it('F2: launched 无活跃提案 → 不读 initial 账本、不输出 loop_state', () => {
    const root = tempProject();
    setSingleModule(root, 'launched'); // launched 模块、但无 guard/活跃提案
    writeOverlay(root, 'launched', setLoop('launched', 3));
    writeLedger(initialLedger(root), [row(1, 'fail'), row(2, 'fail')]); // initial 账本脏数据
    const data = runStatusJson(root);
    expect(data.modules[0].loop_state).toBeUndefined();
  });

  it('F1a: initial 旧 acceptance-report + loop 激活 + 无账本(iteration=0) → verify(phase.3-6) 仍不得 done（converged 裁决）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 2));
    writeFileSync(join(root, 'logos', 'resources', 'verify', 'acceptance-report.md'), 'old'); // 旧报告
    // 无 LOOP_ITERS → iteration=0、converged=false → 出环不得放行
    const data = runStatusJson(root);
    expect(data.loop_state.converged).toBe(false);
    expect(data.phases.find((p: any) => p.key === 'phase.3-6').done).toBe(false);
  });

  it('F1b: launched 旧 VERIFY_PASS + loop 激活 + 无账本 → step 拉回 ready-to-verify、不建议归档', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = setupLaunchedProposal(root);
    writeFileSync(join(dir, 'VERIFY_PASS'), ''); // 旧 marker（原本判 verify-passed → 归档）
    writeOverlay(root, 'launched', setLoop('launched', 3));
    // 无 LOOP_ITERS → converged=false → 不得出环
    // status 侧 suggestion 也必须按回拉后的 step 计算，不得残留「验收通过 / archive」
    const sdata = runStatusJson(root);
    expect(sdata.modules[0].active_change.proposal_step).toBe('ready-to-verify');
    expect(sdata.modules[0].suggestion).not.toContain('archive');
    expect(sdata.modules[0].suggestion).not.toContain('验收通过');
    const data = await runNextJson(root);
    expect(data.proposal_step).toBe('ready-to-verify');
    expect(data.modules[0].proposal_step).toBe('ready-to-verify');
    expect(data.action).not.toContain('archive');
    expect(data.modules[0].detail ?? '').not.toContain('archive');
    expect(data.modules[0].detail ?? '').not.toContain('验收通过');
  });

  it('F2(initial): after:verify overlay 节点不得越过未收敛 loop 成为 current_node', () => {
    const root = tempProject();
    setSingleModule(root, 'initial');
    mkdirSync(join(root, 'logos', 'resources', 'implementation'), { recursive: true });
    writeFileSync(join(root, 'logos', 'resources', 'implementation', 'x.md'), 'x');
    writeFileSync(join(root, 'logos', 'resources', 'verify', 'acceptance-report.md'), 'r');
    // skip 掉 code 之前的全部 builtin，确保走查抵达 implement（code 已 done / verify 报告已写）
    const pre = ['prd', 'product-design', 'architecture', 'scenario-modeling', 'api-design', 'db-design',
      'deployment-design', 'test-cases', 'orchestration-test'];
    writeOverlay(root, 'initial', ['extends: builtin:initial@v1', 'overlay:',
      ...pre.flatMap(t => [`  - op: skip`, `    target: ${t}`]),
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 3 }',
      '  - op: add', '    after: verify', '    node: { id: post-verify, name: 验证后, done_when: "file:logos/resources/NOPE" }'].join('\n'));
    writeLedger(initialLedger(root), [row(1, 'fail')]);
    const data = runStatusJson(root);
    // 未收敛 → halt 到 verify（builtin），after:verify 的 post-verify 不得成为 current_node
    expect(data.modules[0].current_node?.id).not.toBe('post-verify');
  });

  it('F-launched-no-guard: launched 项目无 guard + 历史 initial overlay 激活 → verify 不写 initial 账本', () => {
    const root = tempProject();
    setSingleModule(root, 'launched'); // launched 项目，但无活跃提案/guard
    writeOverlay(root, 'initial', setLoop('initial', 3)); // 历史 logos/flow/initial.yaml 含 set-loop
    writeVerifyFixture(root, { result: 'fail' });
    runVerify(root);
    // launched 账本只在提案目录；无提案 → 不得写 initial 账本（initial 账本 launch 后仅历史产物）
    expect(existsSync(initialLedger(root))).toBe(false);
  });

  it('F-verify-loud: 非法 set-loop → verify fail loud FLOW_SCHEMA_INVALID，不写报告/marker/账本', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 3, ', exhausted_gate: true')); // 非法 set key
    writeVerifyFixture(root, { result: 'fail' });
    const r = runVerify(root);
    expect(r.exited).toBe(true);
    expect(r.errors.join('')).toContain('FLOW_SCHEMA_INVALID');
    expect(existsSync(initialLedger(root))).toBe(false);
    expect(existsSync(join(root, 'logos', 'resources', 'verify', 'acceptance-report.md'))).toBe(false);
  });

  it('F-cmd-detail: cmd done_when 通过续推到未收敛 loop → 顶层 detail 指向 loop（非 cmd），机器字段保留', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = setupLaunchedProposal(root); // ready-to-verify
    writeOverlay(root, 'launched', ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 3 }',
      '  - op: add', '    before: verify', '    node: { id: precheck, name: 预检, done_when: "cmd:true" }'].join('\n'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]); // loop 未收敛
    const data = await runNextJson(root);
    expect(data.cmd_satisfied).toBe(true);           // 机器字段保留 cmd 结果
    expect(data.detail).not.toContain('命令通过');    // detail 不被 cmd 覆盖
    expect(data.action).toContain('第');             // 顶层指向 loop（第 N/3 轮）
  });

  it('F3: loop 未收敛时 after:verify 的 overlay-added 节点不得变 current_node', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = setupLaunchedProposal(root);
    writeOverlay(root, 'launched', ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 3 }',
      '  - op: add', '    after: verify', '    node: { id: post-verify, name: 验证后, done_when: "marker:POST" }'].join('\n'));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]);
    const data = await runNextJson(root);
    // 走查在 implement 处 halt → 不越过 verify → post-verify 不应成为 current_node
    expect(data.modules[0].current_node?.id).not.toBe('post-verify');
    // 顶层 action 指向 loop（而非被 after:verify overlay 节点抢占）
    expect(data.action).toContain('第 1/3 轮');
  });
});

// ── 六、只读 / 统一引擎 / golden 零漂移 ──
describe('S27 — 只读 / 统一引擎 / golden', () => {
  it('UT-S27-19: status 读账本展示 loop_state、不写文件无副作用', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 3));
    writeLedger(initialLedger(root), [row(1, 'fail')]);
    const before = readFileSync(initialLedger(root), 'utf-8');
    const data = runStatusJson(root);
    expect(data.loop_state.iteration).toBe(1);
    expect(readFileSync(initialLedger(root), 'utf-8')).toBe(before); // 未改账本
  });

  it('ST-S27-06: 统一引擎 — initial implement 激活，账本写 resources/verify', async () => {
    const root = tempProject();
    writeOverlay(root, 'initial', setLoop('initial', 3));
    writeLedger(initialLedger(root), [row(1, 'fail'), row(2, 'fail')]);
    const data = await runNextJson(root);
    expect(data.loop_state).toMatchObject({ subflow_id: 'implement', iteration: 2 });
  });

  it('ST-S27-07: 统一引擎 — launched implement 激活，账本写提案目录、不读 initial 账本', async () => {
    const root = tempProject();
    setSingleModule(root, 'launched');
    const dir = setupLaunchedProposal(root);
    writeOverlay(root, 'launched', setLoop('launched', 3));
    writeLedger(join(dir, 'LOOP_ITERS'), [row(1, 'fail')]);
    // initial 账本写脏数据，launched 不应读它
    writeLedger(initialLedger(root), [row(1, 'pass'), row(2, 'pass'), row(3, 'pass')]);
    const data = await runNextJson(root);
    expect(data.modules[0].loop_state.iteration).toBe(1); // 来自提案目录、非 initial 账本
  });

  it('UT-S27-20 / ST-S27-08: 未激活项目 → status/next 不含 loop_state（golden 零漂移前置）', async () => {
    const root = tempProject();
    const s = runStatusJson(root);
    expect(s).not.toHaveProperty('loop_state');
    const n = await runNextJson(root);
    expect(n).not.toHaveProperty('loop_state');
  });
});
