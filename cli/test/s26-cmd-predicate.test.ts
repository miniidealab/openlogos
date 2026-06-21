/**
 * S26 — cmd: 谓词在 next 求值（M2 切片 1b）。
 * 复用 S22/S25 临时项目 overlay 模式（makeTempRoot + scaffoldProject + 写 logos/flow/<lifecycle>.yaml）。
 * 不改 spec/flow/*.yaml、真实 logos/flow/、golden-baseline fixture。含 OpenLogos reporter（全局，按测试名提取 ID）。
 *
 * - cmd 执行走真实 shell（posix：true/false/exit N/sleep/head）；status/watch 不执行（观察 pending）。
 * - spawn 失败：UT-S26-12 经 opts.shell 注入不可执行 shell（runFlowCmd 直测）；ST-S26-EX-2 mock spawn 'error'。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';

// ESM 下无法 spyOn node:child_process 的命名导出；改用 vi.mock 委托工厂 + 开关，
// 默认转发真实 spawn（真实 shell 测试不受影响），置位 __FORCE_SPAWN_ERROR__ 时模拟 'error' 事件。
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: any[]) => {
      if ((globalThis as any).__FORCE_SPAWN_ERROR__) {
        const handlers: Record<string, (arg?: unknown) => void> = {};
        const noop = { on: () => {} };
        const child: any = {
          stdout: noop, stderr: noop, pid: undefined,
          on: (ev: string, cb: (arg?: unknown) => void) => { handlers[ev] = cb; return child; },
        };
        setTimeout(() => handlers['error']?.(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })), 0);
        return child;
      }
      return (actual.spawn as (...a: any[]) => unknown)(...args);
    },
  };
});
import { next } from '../src/commands/next.js';
import { status, collectStatusData, deriveActiveOverlay } from '../src/commands/status.js';
import { deriveOverlayView } from '../src/lib/flow-overlay-derive.js';
import { runFlowCmd, CmdSpawnError } from '../src/lib/flow-cmd.js';
import type { ModuleInfo } from '../src/commands/status.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); vi.restoreAllMocks(); });

const coreInitial: ModuleInfo = { id: 'core', name: 'core', lifecycle: 'initial' };

function tempProject(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  cleanups.push(cleanup);
  return root;
}
function writeOverlay(root: string, yaml: string) {
  mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
  writeFileSync(join(root, 'logos', 'flow', 'initial.yaml'), yaml);
}
/** initial overlay：在 prd 前插入一个 cmd 节点（done_when 或自定义谓词）。 */
function cmdOverlay(nodeYaml: string): string {
  return ['extends: builtin:initial@v1', 'overlay:', '  - op: add', '    before: prd', `    node: ${nodeYaml}`].join('\n');
}
function setProjectCmdTimeout(root: string, seconds: number) {
  const path = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(path, 'utf-8'));
  cfg.flow = { cmd_timeout_seconds: seconds };
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

/** next --format json（异步：cmd 执行在 await 之后 console.log）。 */
async function runNextJson(root: string, auto = false): Promise<any> {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  try { await next('json', undefined, auto); } finally { cap.restore(); restoreCwd(); }
  return { data: JSON.parse(cap.logs[0]).data, logs: cap.logs };
}
async function runNextJsonErr(root: string): Promise<{ code: string; envelope: any }> {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  const exitSpy = mockProcessExit();
  try { await next('json'); } catch { /* process.exit throws */ } finally { cap.restore(); restoreCwd(); exitSpy.mockRestore(); }
  const envelope = JSON.parse(cap.errors[0]);
  return { code: envelope.error?.code, envelope };
}
function runStatusJson(root: string): any {
  const restoreCwd = mockCwd(root);
  const cap = captureConsole();
  try { status('json'); } finally { cap.restore(); restoreCwd(); }
  return JSON.parse(cap.logs[0]).data;
}

// ── 一、求值结果矩阵 ──
describe('S26 — cmd: 谓词求值矩阵（next）', () => {
  it('UT-S26-01 / ST-S26-01: done_when:cmd exit 0 → 节点 done、next 续推', async () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:true" }'));
    const { data } = await runNextJson(root);
    expect(data.cmd_node_id).toBe('chk');
    expect(data.cmd_predicate_field).toBe('done_when');
    expect(data.cmd_exit_code).toBe(0);
    expect(data.cmd_satisfied).toBe(true);
    // done 续推：当前节点不再是 cmd 节点（chk）
    expect(data.current_node?.id).not.toBe('chk');
  });

  it('UT-S26-02 / ST-S26-02: done_when:cmd 非 0 → 保持 active + success envelope', async () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:exit 3" }'));
    const { data } = await runNextJson(root);
    expect(data.cmd_exit_code).toBe(3);
    expect(data.cmd_satisfied).toBe(false);
    expect(data.cmd_timed_out).toBe(false);
    expect(data.current_node).toMatchObject({ id: 'chk', state: 'active' });
  });

  it('UT-S26-03: done_when:cmd 超时 → 未 done、不崩溃、进程被杀', async () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:sleep 5", cmd_timeout_seconds: 1 }'));
    const { data } = await runNextJson(root);
    expect(data.cmd_timed_out).toBe(true);
    expect(data.cmd_satisfied).toBe(false);
    expect(data.cmd_exit_code).toBeNull();
    expect(data.current_node).toMatchObject({ id: 'chk', state: 'active' });
  }, 10000);

  it('UT-S26-04: fail_when:cmd exit 0 → 节点 failed', async () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "file:logos/resources/NEVER", fail_when: "cmd:true" }'));
    const { data } = await runNextJson(root);
    expect(data.cmd_predicate_field).toBe('fail_when');
    expect(data.cmd_satisfied).toBe(true);
    expect(data.current_node).toMatchObject({ id: 'chk', state: 'failed' });
  });

  it('UT-S26-05: fail_when:cmd 未命中 → 继续评 done_when', async () => {
    const root = tempProject();
    mkdirSync(join(root, 'logos', 'resources'), { recursive: true });
    writeFileSync(join(root, 'logos', 'resources', 'MARK'), 'x');
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "file:logos/resources/MARK", fail_when: "cmd:false" }'));
    const { data } = await runNextJson(root);
    expect(data.cmd_predicate_field).toBe('fail_when');
    expect(data.cmd_satisfied).toBe(false);
    // fail 未命中 + done_when(file) 命中 → done 续推，非 failed
    expect(data.current_node?.id).not.toBe('chk');
  });
});

// ── 二、观察派生（status/watch 不执行）──
describe('S26 — 观察派生 pending、无副作用', () => {
  it('UT-S26-06 / ST-S26-03: status 遇 cmd 节点 → pending、不执行命令', () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:touch SENTINEL" }'));
    const data = runStatusJson(root);
    const cur = data.current_node ?? data.overlay_nodes?.find((n: any) => n.id === 'chk');
    expect(cur?.state).toBe('pending');
    expect(existsSync(join(root, 'SENTINEL'))).toBe(false); // 命令未执行 → 无副作用
  });

  it('UT-S26-07: watch 派生源（collectStatusData）遇 cmd 节点 → pending、不执行', () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:touch SENTINEL" }'));
    const restoreCwd = mockCwd(root);
    try {
      const data = collectStatusData(root); // watch 每 tick 的同一派生源
      expect(data.current_node?.state).toBe('pending');
    } finally { restoreCwd(); }
    expect(existsSync(join(root, 'SENTINEL'))).toBe(false);
  });
});

// ── 三、瞬态 + budget=1 ──
describe('S26 — 瞬态求值 + budget=1', () => {
  it('UT-S26-08: next exit 0 后不写 marker、status 仍 pending、可重复执行', async () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:touch SENTINEL" }'));
    const { data } = await runNextJson(root);
    expect(data.cmd_satisfied).toBe(true);
    expect(existsSync(join(root, 'SENTINEL'))).toBe(true); // 命令确实执行（副作用）
    // 瞬态：磁盘无 done marker 文件被 OpenLogos 写入；status 再看仍 pending
    const after = runStatusJson(root);
    const cur = after.current_node ?? after.overlay_nodes?.find((n: any) => n.id === 'chk');
    expect(cur?.state).toBe('pending');
  });

  it('UT-S26-09 / ST-S26-05: 两相邻 cmd 节点，单次 next 只执行第一个（budget=1）', async () => {
    const root = tempProject();
    writeOverlay(root, [
      'extends: builtin:initial@v1', 'overlay:',
      '  - op: add', '    before: prd', '    node: { id: c1, name: 一, done_when: "cmd:touch S1" }',
      '  - op: add', '    after: c1', '    node: { id: c2, name: 二, done_when: "cmd:touch S2" }',
    ].join('\n'));
    const { data } = await runNextJson(root);
    expect(data.cmd_node_id).toBe('c1');
    expect(existsSync(join(root, 'S1'))).toBe(true);  // 第一个执行
    expect(existsSync(join(root, 'S2'))).toBe(false); // 第二个未执行
    expect(data.current_node?.id).toBe('c2');         // 续推到第二个，pending
    expect(data.current_node?.state).toBe('pending');
  });
});

// ── 四、G1 stdout 隔离/容量 ──
describe('S26 — stdout 隔离', () => {
  it('UT-S26-10 / ST-S26-05: 大量 stdout（>64KiB）→ 单条合法 envelope、不挂住', async () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:head -c 100000 /dev/zero" }'));
    const { data, logs } = await runNextJson(root);
    expect(logs.length).toBe(1);           // 单条 JSON
    expect(data.cmd_satisfied).toBe(true); // drain 生效，exit 0
  }, 10000);
});

// ── 五、spawn 失败两类分界 ──
describe('S26 — spawn 失败分界', () => {
  it('UT-S26-11 / ST-S26-EX-1: 命令不存在（shell exit 127）→ success envelope、非 spawn 失败', async () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:nonexistent-cmd-xyz-123" }'));
    const { data } = await runNextJson(root);
    expect(data.cmd_satisfied).toBe(false);
    expect(data.cmd_exit_code).not.toBe(0); // 127（或平台等价非 0），但不是 spawn 失败
  });

  it('UT-S26-12: shell 起不来（不可执行 shell）→ runFlowCmd reject CmdSpawnError', async () => {
    const root = tempProject();
    await expect(runFlowCmd('true', root, 5, { shell: '/no/such/shell/xyz' }))
      .rejects.toBeInstanceOf(CmdSpawnError);
  });

  it('ST-S26-EX-2: shell 起不来（spawn error 事件）→ FLOW_CMD_SPAWN_FAILED，message 含节点 id + 命令 + errno', async () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:true" }'));
    (globalThis as any).__FORCE_SPAWN_ERROR__ = true;
    try {
      const { code, envelope } = await runNextJsonErr(root);
      expect(code).toBe('FLOW_CMD_SPAWN_FAILED');
      // 契约：message 须含节点 id、命令名、errno
      expect(envelope.error.message).toContain('chk');
      expect(envelope.error.message).toContain('true');
      expect(envelope.error.message).toContain('ENOENT');
    } finally {
      (globalThis as any).__FORCE_SPAWN_ERROR__ = false;
    }
  });
});

// ── 六、决策 A/B + 谓词/超时校验 ──
describe('S26 — schema 校验（决策 A/B + 谓词/超时）', () => {
  it('UT-S26-13 / ST-S26-EX-3: 决策 A — cmd: 用于 builtin（modify）→ FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    writeOverlay(root, ['extends: builtin:initial@v1', 'overlay:',
      '  - op: modify', '    target: prd', '    set: { done_when: "cmd:true" }'].join('\n'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S26-14 / ST-S26-EX-3: 决策 B — 同节点 done_when + fail_when 双 cmd → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:true", fail_when: "cmd:false" }'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S26-15: cmd: 空命令 → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:   " }'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S26-16 / ST-S26-EX-3: 节点级 cmd_timeout_seconds = 0 → FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:true", cmd_timeout_seconds: 0 }'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  // 项目级 flow.cmd_timeout_seconds 同样「须整数 ≥1」，非法值不得静默落 60s（spec flow-spec.md §9.2）
  for (const bad of [0, -3, 1.5]) {
    it(`UT-S26-16b: 项目级 flow.cmd_timeout_seconds=${bad} → FLOW_SCHEMA_INVALID`, () => {
      const root = tempProject();
      setProjectCmdTimeout(root, bad);
      writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:true" }'));
      expect(() => deriveOverlayView(root, coreInitial, [], null))
        .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
    });
  }

  it('UT-S26-16c: 项目级超时为非整数（字符串）→ FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    const path = join(root, 'logos', 'logos.config.json');
    const cfg = JSON.parse(readFileSync(path, 'utf-8'));
    cfg.flow = { cmd_timeout_seconds: 'abc' };
    writeFileSync(path, JSON.stringify(cfg, null, 2));
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:true" }'));
    expect(() => deriveOverlayView(root, coreInitial, [], null))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S26-16d: 项目级超时缺省（未配置）→ 不抛、落内置 60s', () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:sleep 9" }'));
    const view = deriveOverlayView(root, coreInitial, [], null);
    expect(view?.pending_cmd?.timeout_seconds).toBe(60);
  });
});

// ── 七、超时优先级 + 结果字段归属 ──
describe('S26 — 超时优先级 + 结果字段', () => {
  it('UT-S26-17: 两级超时优先级 节点级 > 项目级 > 60s', () => {
    const root = tempProject();
    setProjectCmdTimeout(root, 5); // 项目级 5
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:sleep 9", cmd_timeout_seconds: 2 }'));
    const restoreCwd = mockCwd(root);
    try {
      const view = deriveActiveOverlay(root); // 观察派生 → pending_cmd
      expect(view?.pending_cmd?.timeout_seconds).toBe(2); // 节点级 2 胜出
    } finally { restoreCwd(); }
  });

  it('UT-S26-17b: 无节点级 → 取项目级 flow.cmd_timeout_seconds', () => {
    const root = tempProject();
    setProjectCmdTimeout(root, 7);
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:sleep 9" }'));
    const restoreCwd = mockCwd(root);
    try {
      const view = deriveActiveOverlay(root);
      expect(view?.pending_cmd?.timeout_seconds).toBe(7);
    } finally { restoreCwd(); }
  });

  it('UT-S26-17c: 无节点级、无项目级 → 内置 60s', () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:sleep 9" }'));
    const restoreCwd = mockCwd(root);
    try {
      const view = deriveActiveOverlay(root);
      expect(view?.pending_cmd?.timeout_seconds).toBe(60);
    } finally { restoreCwd(); }
  });

  it('UT-S26-18: 结果字段归属 — done 续推后 cmd_node_id 仍指被求值节点', async () => {
    const root = tempProject();
    writeOverlay(root, cmdOverlay('{ id: chk, name: 检查, done_when: "cmd:true" }'));
    const { data } = await runNextJson(root);
    expect(data.cmd_node_id).toBe('chk');     // 仍指被求值的 cmd 节点
    expect(data.current_node?.id).not.toBe('chk'); // 但当前已续推
  });
});

// ── 七b、launched 部署/冒烟区域 cmd overlay 的派生同源（next 预派生 == status）──
describe('S26 — launched smoke/deploy 区域 cmd overlay 同源派生', () => {
  it('UT-S26-19: launched 模块级 smoke_required 默认值影响 cmd 节点可达性，next 预派生与 status 同源', () => {
    const root = tempProject();
    // 模块级默认：deployment_required:false + smoke_required:true（提案省略「部署影响」section → 走模块默认门禁）
    writeFileSync(join(root, 'logos', 'logos-project.yaml'),
      ['project:', '  name: "t"', 'modules:', '  - id: core', '    name: core', '    lifecycle: launched',
        '    deployment_required: false', '    smoke_required: true', ''].join('\n'));
    const proposalDir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    // 代码级提案、无「部署影响」section → 部署决策回退模块默认；[code] 全勾 + VERIFY_PASS → 进入交付区
    const proposal = ['# 变更提案：feat', '', '## 变更原因', 'x。', '', '## 变更类型', '代码级', '',
      '## 变更范围', '- 影响：core', '', '## 变更概述', '概述。'].join('\n');
    writeFileSync(join(proposalDir, 'proposal.md'), proposal);
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] 实现 x\n');
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), 'x');
    // overlay：在 smoke 前插入 cmd 节点——其可达性取决于 smoke_required（= 取决于 deriveActiveOverlay 是否带上模块级默认值）
    mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
    writeFileSync(join(root, 'logos', 'flow', 'launched.yaml'),
      ['extends: builtin:launched@v1', 'overlay:', '  - op: add', '    before: smoke',
        '    node: { id: smoke-check, name: 冒烟前检查, done_when: "cmd:true" }', ''].join('\n'));

    const restoreCwd = mockCwd(root);
    try {
      const fromStatus = collectStatusData(root).modules?.[0].current_node?.id;
      const fromNext = deriveActiveOverlay(root)?.pending_cmd?.node_id;
      expect(fromStatus).toBe('smoke-check');           // status 看到 cmd 节点 pending
      expect(fromNext).toBe('smoke-check');             // next 预派生同源（修复前为 undefined → 命令不执行/停顿点漂移）
    } finally { restoreCwd(); }
  });
});

// ── 八、golden 零漂移 ──
describe('S26 — golden 零漂移', () => {
  it('ST-S26-04: 无 cmd 项目 → next/status 不新增 cmd_* 字段', async () => {
    const root = tempProject(); // 无 overlay
    const restoreCwd = mockCwd(root);
    try {
      expect(deriveActiveOverlay(root)).toBeNull(); // 无 overlay → null（零漂移）
    } finally { restoreCwd(); }
    const { data } = await runNextJson(root);
    expect(data).not.toHaveProperty('cmd_node_id');
    expect(data).not.toHaveProperty('cmd_satisfied');
    const s = runStatusJson(root);
    expect(s).not.toHaveProperty('pending_cmd');
  });
});
