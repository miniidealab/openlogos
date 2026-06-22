/**
 * S30 — cmd: 放开到 launched verify/deploy/smoke gate（modify-cmd-on-builtin / M2 最后一项）。
 * 复用 S22/S26/S27 临时项目 overlay 模式（makeTempRoot + scaffoldProject + 写 logos/flow/launched.yaml）。
 * cmd 用真实 shell 命令（`true` exit 0 / `exit 3` 非 0）控制；含 OpenLogos reporter（用例名带 UT/ST-S30-*）。
 * builtin 仍 marker: → golden 零漂移（见 golden-baseline.test.ts，本文件不改基线）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { next } from '../src/commands/next.js';
import { status } from '../src/commands/status.js';
import { deployDone } from '../src/commands/deploy-done.js';
import { loadFlow, FlowError } from '../src/lib/flow.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempProject(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root, { locale: 'zh' });
  cleanups.push(cleanup);
  return root;
}
function writeOverlay(root: string, yaml: string) {
  mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
  writeFileSync(join(root, 'logos', 'flow', 'launched.yaml'), yaml);
}
function modifyOverlay(target: string, setInline: string): string {
  return ['extends: builtin:launched@v1', 'overlay:', '  - op: modify', `    target: ${target}`, `    set: ${setInline}`].join('\n');
}
function setModules(root: string, n = 1) {
  const mods = Array.from({ length: n }, (_, i) => `  - id: ${i === 0 ? 'core' : 'm' + i}\n    name: ${i === 0 ? 'core' : 'm' + i}\n    lifecycle: launched`).join('\n');
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), `project:\n  name: "t"\nmodules:\n${mods}\n`);
}
function setLegacy(root: string) {
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), `project:\n  name: "t"\n`);
}
/** launched 提案到 verify 前沿（code 已勾、无部署）→ ready-to-verify。 */
function setupProposal(root: string, opts: { deploy?: boolean; smoke?: boolean } = {}): string {
  const slug = 'feat';
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  const deployLine = opts.deploy ? '是' : '否';
  const smokeLine = opts.smoke ? '是' : '否';
  writeFileSync(join(dir, 'proposal.md'), ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- 影响：core', '', '## 部署影响', `- 是否需要部署：${deployLine}`, '- 部署原因：x',
    '- 影响环境：生产', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', `- 是否需要 smoke：${smokeLine}`, '',
    '## 变更概述', '概述。'].join('\n'));
  const tasks = opts.deploy
    ? '# 实现任务\n\n## [code] 代码实现\n- [x] 实现 x\n\n## [deploy] 部署任务\n- [ ] 发布\n'
    : '# 实现任务\n\n## [code] 代码实现\n- [x] 实现 x\n';
  writeFileSync(join(dir, 'tasks.md'), tasks);
  return dir;
}
function runStatusJson(root: string): any {
  const restore = mockCwd(root); const cap = captureConsole();
  try { status('json'); } finally { cap.restore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}
async function runNextJson(root: string): Promise<any> {
  const restore = mockCwd(root); const cap = captureConsole();
  try { await next('json'); } finally { cap.restore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}
async function runDeployDone(root: string, format: 'json' | 'text' = 'json'): Promise<{ exited: boolean; logs: string[]; errors: string[] }> {
  const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
  let exited = false;
  try { await deployDone(format, 'staging'); } catch { exited = true; } finally { cap.restore(); restore(); ex.mockRestore(); }
  return { exited, logs: cap.logs, errors: cap.errors };
}
async function runNextJsonModule(root: string, mod: string): Promise<any> {
  const restore = mockCwd(root); const cap = captureConsole();
  try { await next('json', mod); } finally { cap.restore(); restore(); }
  return JSON.parse(cap.logs[0]).data;
}
function resolved(root: string) { return loadFlow(root, { lifecycle: 'launched', resolved: true }).flow; }
function expectInvalid(root: string) {
  try { resolved(root); expect.fail('应抛 FLOW_SCHEMA_INVALID'); }
  catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
}
function findCmdGate(data: any): any {
  return data.modules?.[0]?.cmd_gate ?? data.cmd_gate ?? null;
}

// ── 一、白名单（合法/非法） ──
describe('S30 — (节点,字段) cmd: 白名单', () => {
  it('UT-S30-01: verify.done_when→cmd: 合法', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }')); expect(resolved(r)).toBeTruthy(); });
  it('UT-S30-02: verify.fail_when→cmd: 合法', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('verify', '{ fail_when: "cmd:true" }')); expect(resolved(r)).toBeTruthy(); });
  it('UT-S30-03: smoke.done_when→cmd: 合法', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('smoke', '{ done_when: "cmd:true" }')); expect(resolved(r)).toBeTruthy(); });
  it('UT-S30-04: smoke.fail_when→cmd: 合法', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('smoke', '{ fail_when: "cmd:true" }')); expect(resolved(r)).toBeTruthy(); });
  it('UT-S30-05: deploy.done_when→cmd: 合法', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('deploy', '{ done_when: "cmd:true" }')); expect(resolved(r)).toBeTruthy(); });
  it('UT-S30-06: deploy.fail_when→cmd: → fail loud（deploy 无 fail_when）', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('deploy', '{ fail_when: "cmd:true" }')); expectInvalid(r); });
  it('UT-S30-07: code.done_when→cmd: → fail loud（内部状态节点）', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('code', '{ done_when: "cmd:true" }')); expectInvalid(r); });
  it('UT-S30-08: archive.done_when→cmd: → fail loud', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('archive', '{ done_when: "cmd:true" }')); expectInvalid(r); });
  it('UT-S30-09: write-proposal.done_when→cmd: → fail loud', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('write-proposal', '{ done_when: "cmd:true" }')); expectInvalid(r); });
  it('UT-S30-10: verify done_when+fail_when 均 cmd: → fail loud（决策 B）', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true", fail_when: "cmd:false" }')); expectInvalid(r); });
  it('UT-S30-11: smoke done_when+fail_when 均 cmd: → fail loud（决策 B）', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('smoke', '{ done_when: "cmd:true", fail_when: "cmd:false" }')); expectInvalid(r); });
  it('UT-S30-12: 空命令 cmd: → fail loud', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:" }')); expectInvalid(r); });
  it('UT-S30-13: 仅空白命令 cmd: → fail loud', () => { const r = tempProject(); writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:   " }')); expectInvalid(r); });
  it('UT-S30-40: initial 的 verify.done_when→cmd: → fail loud（cmd: 仅 launched gate）', () => {
    const r = tempProject();
    mkdirSync(join(r, 'logos', 'flow'), { recursive: true });
    writeFileSync(join(r, 'logos', 'flow', 'initial.yaml'),
      'extends: builtin:initial@v1\noverlay:\n  - op: modify\n    target: verify\n    set: { done_when: "cmd:true" }\n');
    try { loadFlow(r, { lifecycle: 'initial', resolved: true }); expect.fail('initial cmd gate 应 fail loud'); }
    catch (e) { expect((e as FlowError).code).toBe('FLOW_SCHEMA_INVALID'); }
  });
});

// ── 二、per-field / frontier（B3） ──
describe('S30 — per-field / frontier', () => {
  it('UT-S30-14: done_when:cmd + fail_when:marker:VERIFY_FAIL，VERIFY_FAIL 存在 → verify-failed', () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }')); // fail_when 仍 builtin marker:VERIFY_FAIL
    writeFileSync(join(dir, 'VERIFY_FAIL'), '');
    expect(runStatusJson(r).modules[0].active_change.proposal_step).toBe('verify-failed');
  });
  it('UT-S30-15: done_when:cmd + 无 VERIFY_FAIL → status pending、停门前', () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    expect(runStatusJson(r).modules[0].active_change.proposal_step).toBe('ready-to-verify');
  });
  it('UT-S30-16: done_when:marker:VERIFY_PASS + fail_when:cmd，VERIFY_PASS 存在 → status done（不跑 cmd）', () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ fail_when: "cmd:true" }')); // done_when 仍 builtin marker:VERIFY_PASS
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    // VERIFY_PASS 存在 → 非 cmd done_when 解析为 done → 越过 verify（status 不跑 fail_when:cmd）
    expect(runStatusJson(r).modules[0].active_change.proposal_step).not.toBe('ready-to-verify');
  });
  it('UT-S30-17: done_when:marker + fail_when:cmd，VERIFY_PASS 不存在 → pending', () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ fail_when: "cmd:true" }'));
    expect(runStatusJson(r).modules[0].active_change.proposal_step).toBe('ready-to-verify');
  });
  it('UT-S30-41: done_when:cmd + fail_when:marker:VERIFY_FAIL，VERIFY_FAIL 存在 → 无 cmd_gate、next 不执行 done cmd', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:exit 99" }')); // 若被误执行则 exit 99
    writeFileSync(join(dir, 'VERIFY_FAIL'), '');
    const s = runStatusJson(r);
    expect(s.modules[0].active_change.proposal_step).toBe('verify-failed');
    expect('cmd_gate' in s.modules[0]).toBe(false); // 已 failed，非 pending 前沿 → 不挂 cmd_gate
    const n = await runNextJson(r);
    expect(n.cmd_node_id).not.toBe('verify'); // done cmd 绝不执行
    expect(n.proposal_step).toBe('verify-failed');
  });
});

// ── 三、cmd_gate 挂载 ──
describe('S30 — cmd_gate 机器契约', () => {
  it('UT-S30-18: cmd_gate 字段结构完整（node_id/field/command/timeout_seconds）', () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:gh pr checks" }'));
    const cg = runStatusJson(r).modules[0].cmd_gate;
    expect(Object.keys(cg).sort()).toEqual(['command', 'field', 'node_id', 'timeout_seconds']);
    expect(cg.timeout_seconds).toBe(60); // 默认（无节点级/项目级覆盖）
  });
  it('UT-S30-19: 有 modules[] → 只挂 modules[].cmd_gate、顶层不输出', () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:gh pr checks" }'));
    const d = runStatusJson(r);
    expect(d.modules[0].cmd_gate).toMatchObject({ node_id: 'verify', field: 'done_when' });
    expect('cmd_gate' in d).toBe(false);
  });
  it('UT-S30-20: watch 与 status 同构 → 输出 cmd_gate（命令未执行）', () => {
    // watch 复用 status data；此处以 status 代表 observe 语义（不执行命令、命令文本仅声明）
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:gh pr checks" }'));
    expect(findCmdGate(runStatusJson(r)).command).toBe('gh pr checks');
  });
  it('UT-S30-56: legacy 无 modules[] + 活跃提案 + verify.done_when:cmd → 顶层 cmd_gate（§3.8f，High）', () => {
    const r = tempProject(); setLegacy(r); setupProposal(r); // 真 legacy：不调 setModules()
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:gh pr checks" }'));
    const d = runStatusJson(r);
    expect(d.modules).toBeUndefined();    // 走 legacy 顶层派生路径
    expect(d.lifecycle).toBe('launched'); // 活跃提案 → 按 launched 处理（修复前永远 initial）
    expect(d.cmd_gate).toMatchObject({ node_id: 'verify', field: 'done_when', command: 'gh pr checks' }); // 顶层挂载
  });
});

// ── 四、next 求值（瞬态） ──
describe('S30 — next 求值瞬态', () => {
  it('UT-S30-21: done_when:cmd exit 0（需部署）→ 瞬态推进 ready-to-deploy', async () => {
    const r = tempProject(); setModules(r); setupProposal(r, { deploy: true });
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    const d = await runNextJson(r);
    expect(d.cmd_node_id).toBe('verify'); expect(d.cmd_satisfied).toBe(true);
    expect(d.proposal_step).toBe('ready-to-deploy');
  });
  it('UT-S30-22: done_when:cmd 非 0 → 停门前 ready-to-verify', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:exit 3" }'));
    const d = await runNextJson(r);
    expect(d.cmd_exit_code).toBe(3); expect(d.cmd_satisfied).toBe(false);
    expect(d.proposal_step).toBe('ready-to-verify');
    expect(findCmdGate(d)).toBeTruthy();
  });
  it('UT-S30-23: 无部署提案 done_when:cmd exit 0 → verify-passed（按部署决策）', async () => {
    const r = tempProject(); setModules(r); setupProposal(r); // 无部署
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    expect((await runNextJson(r)).proposal_step).toBe('verify-passed');
  });
  it('UT-S30-24: fail_when:cmd exit 0 → 瞬态 verify-failed（非推进）', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ fail_when: "cmd:true" }'));
    const d = await runNextJson(r);
    expect(d.cmd_predicate_field).toBe('fail_when'); expect(d.cmd_satisfied).toBe(true);
    expect(d.proposal_step).toBe('verify-failed');
  });
  it('UT-S30-25: deploy.done_when:cmd exit 0（已 verify-pass、需部署、[deploy] 未勾选）→ 过门推进、不被 deployTasksChecked 拦（High）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true }); // [deploy] 任务 `- [ ]` 未勾选
    writeFileSync(join(dir, 'VERIFY_PASS'), ''); // verify 仍 marker，已过
    writeOverlay(r, modifyOverlay('deploy', '{ done_when: "cmd:true" }'));
    const d = await runNextJson(r);
    expect(d.cmd_node_id).toBe('deploy'); expect(d.cmd_satisfied).toBe(true);
    expect(d.proposal_step).not.toBe('ready-to-deploy'); // cmd 是 deploy 唯一裁判，未勾选 [deploy] 不拦
    expect(findCmdGate(d)).toBeFalsy(); // 前沿越过 deploy → 不再自相矛盾地挂 cmd_gate
  });
  it('UT-S30-26: smoke.done_when:cmd（已 deploy-done）→ next 求值 smoke cmd', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true, smoke: true });
    writeFileSync(join(dir, 'VERIFY_PASS'), ''); writeFileSync(join(dir, 'DEPLOY_DONE'), '');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] 实现 x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('smoke', '{ done_when: "cmd:true" }'));
    const d = await runNextJson(r);
    expect(d.cmd_node_id).toBe('smoke');
  });
  it('UT-S30-54: smoke.fail_when:cmd exit 0 → next smoke-failed（瞬态失败、非推进）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true, smoke: true });
    writeFileSync(join(dir, 'VERIFY_PASS'), ''); writeFileSync(join(dir, 'DEPLOY_DONE'), '');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('smoke', '{ fail_when: "cmd:true" }')); // done_when 仍 marker:SMOKE_PASS(未写)
    const d = await runNextJson(r);
    expect(d.cmd_node_id).toBe('smoke'); expect(d.cmd_predicate_field).toBe('fail_when'); expect(d.cmd_satisfied).toBe(true);
    expect(d.proposal_step).toBe('smoke-failed');
  });
  it('UT-S30-55: done_when:cmd 超时 → 停门前不崩溃（cmd_timed_out）', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:sleep 5", cmd_timeout_seconds: 1 }'));
    const d = await runNextJson(r);
    expect(d.cmd_timed_out).toBe(true); expect(d.cmd_satisfied).toBe(false);
    expect(d.proposal_step).toBe('ready-to-verify');
  });
  it('UT-S30-27: next 瞬态推进后不写 marker（磁盘无 VERIFY_PASS）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    await runNextJson(r);
    expect(existsSync(join(dir, 'VERIFY_PASS'))).toBe(false);
  });
  it('UT-S30-28: next fail_when:cmd 命中后不写 VERIFY_FAIL', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ fail_when: "cmd:true" }'));
    await runNextJson(r);
    expect(existsSync(join(dir, 'VERIFY_FAIL'))).toBe(false);
  });
});

// ── 五、loop 正交 ──
describe('S30 — F·loop 正交', () => {
  it('UT-S30-29: 激活 loop + verify.done_when:cmd → fail loud', () => {
    const r = tempProject();
    writeOverlay(r, ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 2 }',
      '  - op: modify', '    target: verify', '    set: { done_when: "cmd:true" }'].join('\n'));
    expectInvalid(r);
  });
  it('UT-S30-30: 激活 loop + verify.fail_when:cmd → fail loud', () => {
    const r = tempProject();
    writeOverlay(r, ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 2 }',
      '  - op: modify', '    target: verify', '    set: { fail_when: "cmd:true" }'].join('\n'));
    expectInvalid(r);
  });
  it('UT-S30-31: 未激活 loop（max_iters:1）+ verify cmd → 合法', () => {
    const r = tempProject();
    writeOverlay(r, ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 1 }',
      '  - op: modify', '    target: verify', '    set: { done_when: "cmd:true" }'].join('\n'));
    expect(resolved(r)).toBeTruthy();
  });
  it('UT-S30-32: 激活 loop + deploy.done_when:cmd（deliver 无 loop）→ 合法', () => {
    const r = tempProject();
    writeOverlay(r, ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 2 }',
      '  - op: modify', '    target: deploy', '    set: { done_when: "cmd:true" }'].join('\n'));
    expect(resolved(r)).toBeTruthy();
  });
});

// ── 六、可达性 + budget + golden + deploy-done(G) ──
describe('S30 — 可达性 / budget / golden / deploy-done', () => {
  it('UT-S30-33: 无需部署提案 → deploy cmd 绝不执行（next 不跑 deploy cmd）', async () => {
    const r = tempProject(); setModules(r); setupProposal(r); // 无部署 → deploy 节点不可达
    writeOverlay(r, modifyOverlay('deploy', '{ done_when: "cmd:exit 99" }'));
    const d = await runNextJson(r); // 前沿在 verify(marker)，不会跑 deploy cmd
    expect(d.cmd_node_id).not.toBe('deploy');
  });
  it('UT-S30-34: 无需 smoke 提案 → smoke cmd 绝不执行', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true, smoke: false });
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    writeOverlay(r, modifyOverlay('smoke', '{ done_when: "cmd:exit 99" }'));
    const d = await runNextJson(r);
    expect(d.cmd_node_id).not.toBe('smoke');
  });
  it('UT-S30-35: budget=1 — 前 overlay-add cmd + 后 verify cmd gate，仅执行前者', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, ['extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    before: verify', '    node: { id: chk, name: 检查, done_when: "cmd:exit 7" }',
      '  - op: modify', '    target: verify', '    set: { done_when: "cmd:true" }'].join('\n'));
    const d = await runNextJson(r);
    expect(d.cmd_node_id).toBe('chk'); expect(d.cmd_exit_code).toBe(7); // 先执行 overlay-add cmd
  });
  it('UT-S30-36: golden 零漂移 — 无 overlay（builtin marker:）→ 不输出 cmd_gate', () => {
    const r = tempProject(); setModules(r); setupProposal(r); // 无 overlay
    const d = runStatusJson(r);
    expect('cmd_gate' in (d.modules[0])).toBe(false);
    expect('cmd_gate' in d).toBe(false);
  });
  it('UT-S30-37: 决策 G — deploy-done 承认 cmd-gate verify（done_when:cmd exit 0，无 VERIFY_PASS）→ 放行', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeFileSync(join(join(r, 'logos/resources/verify'), 'deployment-report.md'), '# rpt\n');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    const res = await runDeployDone(r);
    expect(res.exited).toBe(false); // 未因 VERIFY_NOT_PASSED 退出
    expect(existsSync(join(dir, 'DEPLOY_DONE'))).toBe(true);
  });
  it('UT-S30-38: 决策 G — deploy-done cmd-gate verify done_when:cmd 非 0 → 拒（VERIFY_NOT_PASSED）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:exit 4" }'));
    const res = await runDeployDone(r);
    expect(res.exited).toBe(true);
    expect(existsSync(join(dir, 'DEPLOY_DONE'))).toBe(false);
  });
  it('UT-S30-39: 决策 G 回归 — marker verify（无 overlay）deploy-done 行为不变', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeFileSync(join(join(r, 'logos/resources/verify'), 'deployment-report.md'), '# rpt\n');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    const res = await runDeployDone(r);
    expect(res.exited).toBe(false);
    expect(existsSync(join(dir, 'DEPLOY_DONE'))).toBe(true);
  });
  it('UT-S30-46: next --module <非活跃模块> → 顶层 active_change/proposal_step 与过滤模块收敛（不泄漏）', async () => {
    const r = tempProject(); setModules(r, 2); setupProposal(r); // 活跃提案在 core
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    const d = await runNextJsonModule(r, 'm1');
    expect(d.modules[0].id).toBe('m1');
    expect(d.active_change).not.toBe('feat'); // 顶层不泄漏 core 的活跃提案
    expect(d.proposal_step).not.toBe('ready-to-verify');
  });
  it('UT-S30-47: deploy-done text 模式错误输出人类文本（非 JSON envelope）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeFileSync(join(join(r, 'logos/resources/verify'), 'deployment-report.md'), '# rpt\n');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:exit 4" }'));
    const res = await runDeployDone(r, 'text');
    expect(res.exited).toBe(true);
    const err = res.errors.join('\n');
    expect(err).toContain('Error:');
    expect(err.trim().startsWith('{')).toBe(false); // 不是 JSON
    expect(err).toContain('exit 4'); // 仍带 cmd 上下文
  });
  it('UT-S30-48: next --module <非活跃模块> --auto → 不给其它模块写 GATE_AUTO_PASSED（High）', async () => {
    const r = tempProject(); setModules(r, 2); const dir = setupProposal(r); // 活跃提案在 core
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [delta] 规格变更\n- [x] 产出 delta\n'); // core → ready-to-merge（可跳 gate）
    const restore = mockCwd(r); const cap = captureConsole();
    let d: any;
    try { await next('json', 'm1', true); d = JSON.parse(cap.logs[0]).data; } finally { cap.restore(); restore(); }
    expect(d.gate_auto_passed).not.toBe(true);
    expect(existsSync(join(dir, 'GATE_AUTO_PASSED'))).toBe(false); // 绝不给 core 的活跃提案写审计
  });
  it('UT-S30-49: builtin cmd gate 路径 flow 错误 text 模式 → 人类文本（非 JSON）', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 2 }',
      '  - op: modify', '    target: verify', '    set: { done_when: "cmd:true" }'].join('\n')); // loop + verify cmd → FLOW_SCHEMA_INVALID
    const restore = mockCwd(r); const cap = captureConsole(); const ex = mockProcessExit();
    let threw = false;
    try { await next('text'); } catch { threw = true; } finally { cap.restore(); restore(); ex.mockRestore(); }
    expect(threw).toBe(true);
    const err = cap.errors.join('\n');
    expect(err).toContain('FLOW_SCHEMA_INVALID');
    expect(err.trim().startsWith('{')).toBe(false); // 文本而非 JSON envelope
  });
  it('UT-S30-43: next --module <其它模块> → 不执行活跃提案模块的 cmd gate（High）', async () => {
    const r = tempProject(); setModules(r, 2); setupProposal(r); // 活跃提案在 core
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:touch SENTINEL_S30_43" }'));
    const restore = mockCwd(r); const cap = captureConsole();
    try { await next('json', 'm1'); } catch { /* m1 无活跃提案，输出即可 */ } finally { cap.restore(); restore(); }
    expect(existsSync(join(r, 'SENTINEL_S30_43'))).toBe(false); // core 的 verify cmd 绝不在 --module m1 下执行
  });
  it('UT-S30-44: deploy-done + 非法 flow.cmd_timeout_seconds + verify cmd → FLOW_SCHEMA_INVALID（不写 DEPLOY_DONE）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeFileSync(join(r, 'logos', 'logos.config.json'), JSON.stringify({ name: 't', locale: 'zh', flow: { cmd_timeout_seconds: 0 } }));
    writeFileSync(join(join(r, 'logos/resources/verify'), 'deployment-report.md'), '# rpt\n');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    const res = await runDeployDone(r);
    expect(res.exited).toBe(true);
    expect(res.errors.join(' ')).toContain('FLOW_SCHEMA_INVALID');
    expect(existsSync(join(dir, 'DEPLOY_DONE'))).toBe(false);
  });
  it('UT-S30-45: deploy-done cmd verify 失败 → 错误 message 带 cmd 上下文（field/command/exit）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeFileSync(join(join(r, 'logos/resources/verify'), 'deployment-report.md'), '# rpt\n');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:exit 4" }'));
    const res = await runDeployDone(r);
    expect(res.exited).toBe(true);
    const err = res.errors.join(' ');
    expect(err).toContain('verify.done_when'); expect(err).toContain('exit 4');
    expect(existsSync(join(dir, 'DEPLOY_DONE'))).toBe(false);
  });
  it('UT-S30-50: deploy + smoke + verify cmd 通过 → deploy-done next_step=ready-to-smoke（cmdEval 回灌，High）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true, smoke: true });
    writeFileSync(join(join(r, 'logos/resources/verify'), 'deployment-report.md'), '# rpt\n');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    const res = await runDeployDone(r);
    expect(res.exited).toBe(false);
    expect(existsSync(join(dir, 'DEPLOY_DONE'))).toBe(true);
    expect(JSON.parse(res.logs[0]).data.next_step).toBe('ready-to-smoke'); // 不再误报 deploy-done/可归档
  });
  it('UT-S30-51: 无需部署 + verify cmd → DEPLOYMENT_NOT_REQUIRED、且 cmd 不执行（纯读前置先于 cmd）', async () => {
    const r = tempProject(); setModules(r); setupProposal(r); // 无部署 → deployment_required false
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:touch SENTINEL_S30_51" }'));
    const res = await runDeployDone(r);
    expect(res.exited).toBe(true);
    expect(res.errors.join(' ')).toContain('DEPLOYMENT_NOT_REQUIRED');
    expect(existsSync(join(r, 'SENTINEL_S30_51'))).toBe(false); // 前置失败前不跑 verify cmd（无副作用）
  });
  it('UT-S30-52: 缺部署报告 + verify cmd → DEPLOYMENT_REPORT_MISSING、且 cmd 不执行', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:touch SENTINEL_S30_52" }')); // 不写部署报告
    const res = await runDeployDone(r);
    expect(res.exited).toBe(true);
    expect(res.errors.join(' ')).toContain('DEPLOYMENT_REPORT_MISSING');
    expect(existsSync(join(r, 'SENTINEL_S30_52'))).toBe(false);
  });
  it('UT-S30-53: marker verify（无 overlay）缺 VERIFY_PASS + 缺部署报告 → VERIFY_NOT_PASSED（保 S21 旧顺序，Medium）', async () => {
    const r = tempProject(); setModules(r); setupProposal(r, { deploy: true });
    // verify 仍 marker（无 overlay）、不写 VERIFY_PASS、不写部署报告
    const res = await runDeployDone(r);
    expect(res.exited).toBe(true);
    const err = res.errors.join(' ');
    expect(err).toContain('VERIFY_NOT_PASSED');       // marker verify 先于部署报告校验（逐字节等价 S21）
    expect(err).not.toContain('DEPLOYMENT_REPORT_MISSING');
  });
  it('UT-S30-57: deploy-done 按 resolved verify 自定义 marker 名判定（S25）→ CUSTOM_VERIFY 命中即过 verify（High）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "marker:CUSTOM_VERIFY" }'));
    writeFileSync(join(dir, 'CUSTOM_VERIFY'), ''); // 自定义 done marker 命中（磁盘无 VERIFY_PASS）
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    mkdirSync(join(r, 'logos', 'resources', 'verify'), { recursive: true });
    writeFileSync(join(r, 'logos', 'resources', 'verify', 'deployment-report.md'), '# 部署报告\n');
    const res = await runDeployDone(r);
    expect(res.exited).toBe(false); // 不再误报 VERIFY_NOT_PASSED
    expect(JSON.parse(res.logs[0]).data.marker_path).toContain('DEPLOY_DONE');
  });
  it('UT-S30-58: deploy-done 自定义 marker verify 未命中（仅旧 VERIFY_PASS 在）→ VERIFY_NOT_PASSED（不再认硬编码名）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "marker:CUSTOM_VERIFY" }'));
    writeFileSync(join(dir, 'VERIFY_PASS'), ''); // 旧硬编码名在，但 resolved done marker 是 CUSTOM_VERIFY → 不算过
    const res = await runDeployDone(r);
    expect(res.exited).toBe(true);
    expect(res.errors.join(' ')).toContain('VERIFY_NOT_PASSED');
  });
  it('UT-S30-42: deploy-done 遇非法 overlay → FLOW_SCHEMA_INVALID（不吞错、不写 DEPLOY_DONE）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeFileSync(join(join(r, 'logos/resources/verify'), 'deployment-report.md'), '# rpt\n');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeFileSync(join(dir, 'VERIFY_PASS'), ''); // marker 存在——但非法 overlay 必须 fail loud、不得据此放行
    writeOverlay(r, modifyOverlay('code', '{ done_when: "cmd:true" }')); // code 不可 cmd: → 非法
    const res = await runDeployDone(r);
    expect(res.exited).toBe(true);
    expect(res.errors.join(' ')).toContain('FLOW_SCHEMA_INVALID');
    expect(existsSync(join(dir, 'DEPLOY_DONE'))).toBe(false);
  });
  it('UT-S30-59: deploy-done 遇非法 resolved verify 谓词（file:）→ FLOW_SCHEMA_INVALID（与 status 一致、不写 DEPLOY_DONE，Medium）', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "file:logos/X" }')); // 非 cmd:/marker: 谓词
    // status 对同一非法 flow 报 FLOW_SCHEMA_INVALID
    const restore = mockCwd(r); const cap = captureConsole(); const ex = mockProcessExit();
    try { status('json'); } catch { /* exit */ } finally { cap.restore(); restore(); ex.mockRestore(); }
    expect([...cap.logs, ...cap.errors].join(' ')).toContain('FLOW_SCHEMA_INVALID');
    // deploy-done 必须给出相同错误码（而非误报 VERIFY_NOT_PASSED）
    const res = await runDeployDone(r);
    expect(res.exited).toBe(true);
    const err = res.errors.join(' ');
    expect(err).toContain('FLOW_SCHEMA_INVALID');
    expect(err).not.toContain('VERIFY_NOT_PASSED');
    expect(existsSync(join(dir, 'DEPLOY_DONE'))).toBe(false);
  });
});

// ── 七、场景测试（ST，端到端） ──
describe('S30 — 端到端场景', () => {
  it('ST-S30-01: verify cmd gate：status 停门前 + cmd_gate', () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:gh pr checks" }'));
    const d = runStatusJson(r);
    expect(d.modules[0].active_change.proposal_step).toBe('ready-to-verify');
    expect(d.modules[0].cmd_gate.command).toBe('gh pr checks');
    // S30·#4：cmd gate 时建议改为「门禁已接外部命令，运行 openlogos next 触发求值」（不再提示 openlogos verify）
    expect(d.modules[0].suggestion).toContain('openlogos next');
    expect(d.modules[0].suggestion).not.toContain('openlogos verify');
  });
  it('ST-S30-02: verify cmd 通过（需部署）→ next 瞬态 ready-to-deploy、不写 marker', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    const d = await runNextJson(r);
    expect(d.proposal_step).toBe('ready-to-deploy'); expect(existsSync(join(dir, 'VERIFY_PASS'))).toBe(false);
  });
  it('ST-S30-03: verify cmd 非 0 → next 停门前', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:exit 2" }'));
    expect((await runNextJson(r)).proposal_step).toBe('ready-to-verify');
  });
  it('ST-S30-04: verify fail_when:cmd 命中 → next verify-failed', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('verify', '{ fail_when: "cmd:true" }'));
    expect((await runNextJson(r)).proposal_step).toBe('verify-failed');
  });
  it('ST-S30-05: next/status 有意不一致：next 瞬态 ready-to-deploy 后 status 回 ready-to-verify', async () => {
    const r = tempProject(); setModules(r); setupProposal(r, { deploy: true });
    writeOverlay(r, modifyOverlay('verify', '{ done_when: "cmd:true" }'));
    expect((await runNextJson(r)).proposal_step).toBe('ready-to-deploy');
    expect(runStatusJson(r).modules[0].active_change.proposal_step).toBe('ready-to-verify'); // status 不跑 cmd → 回门前
  });
  it('ST-S30-06: deploy gate 接 cmd：status 停门前 ready-to-deploy + cmd_gate', () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('deploy', '{ done_when: "cmd:deploy-check" }'));
    const d = runStatusJson(r);
    expect(d.modules[0].active_change.proposal_step).toBe('ready-to-deploy');
    expect(d.modules[0].cmd_gate).toMatchObject({ node_id: 'deploy', field: 'done_when' });
  });
  it('ST-S30-07: deploy cmd 通过 → next 推进', async () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true });
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('deploy', '{ done_when: "cmd:true" }'));
    expect((await runNextJson(r)).cmd_satisfied).toBe(true);
  });
  it('ST-S30-08: smoke gate cmd：status cmd_gate', () => {
    const r = tempProject(); setModules(r); const dir = setupProposal(r, { deploy: true, smoke: true });
    writeFileSync(join(dir, 'VERIFY_PASS'), ''); writeFileSync(join(dir, 'DEPLOY_DONE'), '');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] x\n\n## [deploy] 部署任务\n- [x] 发布\n');
    writeOverlay(r, modifyOverlay('smoke', '{ done_when: "cmd:smoke-check" }'));
    expect(runStatusJson(r).modules[0].cmd_gate).toMatchObject({ node_id: 'smoke' });
  });
  it('ST-S30-09: budget=1 端到端 — overlay-add cmd 先于 verify gate', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, ['extends: builtin:launched@v1', 'overlay:',
      '  - op: add', '    before: verify', '    node: { id: chk, name: 检查, done_when: "cmd:true" }',
      '  - op: modify', '    target: verify', '    set: { done_when: "cmd:exit 5" }'].join('\n'));
    const d = await runNextJson(r);
    expect(d.cmd_node_id).toBe('chk'); // 先执行 overlay-add，verify cmd 未跑
  });
  it('ST-S30-10: 无需部署 → deploy cmd 不可达、绝不执行', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, modifyOverlay('deploy', '{ done_when: "cmd:exit 88" }'));
    expect((await runNextJson(r)).cmd_node_id).not.toBe('deploy');
  });
  it('ST-S30-11: 激活 loop + verify cmd gate → 端到端 fail loud', () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    writeOverlay(r, ['extends: builtin:launched@v1', 'overlay:',
      '  - op: set-loop', '    subflow: implement', '    set: { max_iters: 2 }',
      '  - op: modify', '    target: verify', '    set: { done_when: "cmd:true" }'].join('\n'));
    const restore = mockCwd(r); const cap = captureConsole(); const ex = mockProcessExit();
    let threw = false;
    try { status('json'); } catch { threw = true; } finally { cap.restore(); restore(); ex.mockRestore(); }
    expect(threw).toBe(true);
    expect(cap.errors.join(' ')).toContain('FLOW_SCHEMA_INVALID');
  });
  it('ST-S30-12: golden 零漂移 — 无 overlay → status/next 无 cmd_gate', async () => {
    const r = tempProject(); setModules(r); setupProposal(r);
    expect('cmd_gate' in runStatusJson(r).modules[0]).toBe(false);
    expect('cmd_gate' in (await runNextJson(r))).toBe(false);
  });
});
