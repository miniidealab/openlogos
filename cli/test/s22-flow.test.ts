import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  loadBuiltinFlow,
  loadFlow,
  applyOverlay,
  validateFlow,
  parseExtends,
  inferLifecycle,
  FlowError,
  BUILTIN_VERSIONS,
} from '../src/lib/flow.js';
import type { Flow } from '../src/lib/flow.js';
import { flowShow } from '../src/commands/flow.js';
import { status } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';

/** 在临时项目写入 overlay 文件 logos/flow/<lifecycle>.yaml。 */
function writeOverlay(root: string, lifecycle: string, yaml: string) {
  mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
  writeFileSync(join(root, 'logos', 'flow', `${lifecycle}.yaml`), yaml);
}

/** 写入带指定模块生命周期的 logos-project.yaml。 */
function writeProjectModules(root: string, lifecycle: 'initial' | 'launched') {
  const yaml = `project:\n  name: "t"\nmodules:\n  - id: core\n    name: core\n    lifecycle: ${lifecycle}\n`;
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), yaml);
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function tempProject(): string {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  cleanups.push(cleanup);
  return root;
}

describe('S22 flow loader', () => {
  it('UT-S22-01: 从包内加载内置 initial 模板', () => {
    const flow = loadBuiltinFlow('initial');
    expect(flow.flow).toBe('initial');
    expect(flow.subflows.length).toBeGreaterThan(0);
    expect(flow.subflows.flatMap(s => s.nodes).some(n => n.id === 'prd')).toBe(true);
  });

  it('UT-S22-02: 从包内加载内置 launched 模板', () => {
    const flow = loadBuiltinFlow('launched');
    expect(flow.flow).toBe('launched');
    expect(flow.subflows.flatMap(s => s.nodes).some(n => n.id === 'apply-merge')).toBe(true);
  });

  it('UT-S22-03: 内置模板路径从包内 spec/flow 解析（不依赖新增 assets）', () => {
    // loadBuiltinFlow 基于 import.meta.url 解析，不依赖 cwd / 临时项目
    expect(() => loadBuiltinFlow('initial')).not.toThrow();
  });

  it('UT-S22-04: 内置模板缺失返回 FLOW_NOT_FOUND', () => {
    expect(() => loadBuiltinFlow('bogus' as never)).toThrowError(
      expect.objectContaining({ code: 'FLOW_NOT_FOUND' }),
    );
  });

  it('UT-S22-05: 基础 schema 校验拦截缺失必填字段', () => {
    expect(() => validateFlow({ flow: 'x', version: 1, subflows: [{ id: 's', nodes: [{ name: '无 id' }] }] }))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
    expect(() => validateFlow({ version: 1, subflows: [] }))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S22-06: overlay extends 解析出基线与 @vN', () => {
    expect(parseExtends('builtin:initial@v1')).toEqual({ baseline: 'initial', version: 'v1' });
    expect(parseExtends('builtin:launched')).toEqual({ baseline: 'launched', version: null });
    expect(() => parseExtends('bad')).toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S22-07: overlay skip 按 node id 标记 skipped（保留不删除）', () => {
    const builtin = loadBuiltinFlow('initial');
    const before = builtin.subflows.flatMap(s => s.nodes).length;
    const { flow } = applyOverlay(builtin, { overlay: [{ op: 'skip', target: 'orchestration-test' }] }, 'initial');
    const nodes = flow.subflows.flatMap(s => s.nodes);
    expect(nodes.length).toBe(before); // 未删除
    const ot = nodes.find(n => n.id === 'orchestration-test')!;
    expect(ot.skipped).toBe(true);
    expect(ot.overlay_op).toBe('skip');
  });

  it('UT-S22-08: overlay add 在 after 处插入节点', () => {
    const builtin = loadBuiltinFlow('initial');
    const { flow } = applyOverlay(
      builtin,
      { overlay: [{ op: 'add', after: 'code', node: { id: 'lint', name: '静态检查' } }] },
      'initial',
    );
    const implNodes = flow.subflows.find(s => s.nodes.some(n => n.id === 'code'))!.nodes.map(n => n.id);
    expect(implNodes[implNodes.indexOf('code') + 1]).toBe('lint');
    expect(flow.subflows.flatMap(s => s.nodes).find(n => n.id === 'lint')!.overlay_op).toBe('add');
  });

  it('UT-S22-09: overlay modify 深合并目标节点字段', () => {
    const builtin = loadBuiltinFlow('initial');
    const { flow } = applyOverlay(
      builtin,
      { overlay: [{ op: 'modify', target: 'code', set: { review_agent: 'my-reviewer' } }] },
      'initial',
    );
    const code = flow.subflows.flatMap(s => s.nodes).find(n => n.id === 'code')!;
    expect(code.review_agent).toBe('my-reviewer');
    expect(code.skill).toBe('code-implementor'); // 其余字段保留
    expect(code.overlay_op).toBe('modify');
  });

  it('UT-S22-10: overlay reorder 调整节点顺序', () => {
    const builtin = loadBuiltinFlow('initial');
    const { flow } = applyOverlay(
      builtin,
      { overlay: [{ op: 'reorder', target: 'smoke', after: 'deploy' }] },
      'initial',
    );
    const deliver = flow.subflows.find(s => s.nodes.some(n => n.id === 'deploy'))!.nodes.map(n => n.id);
    expect(deliver.indexOf('smoke')).toBe(deliver.indexOf('deploy') + 1);
  });

  it('UT-S22-11: overlay target node id 不存在时报错', () => {
    const builtin = loadBuiltinFlow('initial');
    expect(() => applyOverlay(builtin, { overlay: [{ op: 'modify', target: 'not-exist', set: {} }] }, 'initial'))
      .toThrowError(expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' }));
  });

  it('UT-S22-12: 各类非法 overlay 收口为 FLOW_SCHEMA_INVALID（未知 op / 缺 set / 非串 extends / null 元素 / 非数组 / baseline 错配）', () => {
    const builtin = loadBuiltinFlow('initial');
    const invalid = expect.objectContaining({ code: 'FLOW_SCHEMA_INVALID' });
    // 未知 op
    expect(() => applyOverlay(builtin, { overlay: [{ op: 'rename', target: 'code' }] }, 'initial')).toThrowError(invalid);
    // modify 缺 set
    expect(() => applyOverlay(builtin, { overlay: [{ op: 'modify', target: 'code' }] }, 'initial')).toThrowError(invalid);
    // extends 非字符串
    expect(() => applyOverlay(builtin, { extends: 123 as never, overlay: [] }, 'initial')).toThrowError(invalid);
    // overlay 元素为 null
    expect(() => applyOverlay(builtin, { overlay: [null as never] }, 'initial')).toThrowError(invalid);
    // overlay 非数组
    expect(() => applyOverlay(builtin, { overlay: {} as never }, 'initial')).toThrowError(invalid);
    // extends baseline 与 lifecycle 错配
    expect(() => applyOverlay(builtin, { extends: 'builtin:launched@v1', overlay: [] }, 'initial')).toThrowError(invalid);
    // add 缺 name
    expect(() => applyOverlay(builtin, { overlay: [{ op: 'add', after: 'code', node: { id: 'x' } }] }, 'initial')).toThrowError(invalid);
    // add 重复 id
    expect(() => applyOverlay(builtin, { overlay: [{ op: 'add', after: 'code', node: { id: 'code', name: 'dup' } }] }, 'initial')).toThrowError(invalid);
  });

  it('UT-S22-13: @vN 与内置内容版本不一致时产生告警', () => {
    const builtin = loadBuiltinFlow('initial');
    const { warnings } = applyOverlay(builtin, { extends: 'builtin:initial@v2', overlay: [] }, 'initial');
    expect(warnings.some(w => w.code === 'FLOW_VERSION_MISMATCH')).toBe(true);
  });

  it('UT-S22-14: @vN 匹配时无版本告警', () => {
    const builtin = loadBuiltinFlow('initial');
    const { warnings } = applyOverlay(builtin, { extends: `builtin:initial@${BUILTIN_VERSIONS.initial}`, overlay: [] }, 'initial');
    expect(warnings.some(w => w.code === 'FLOW_VERSION_MISMATCH')).toBe(false);
  });

  it('UT-S22-15: overlay_applied 反映是否实际应用 overlay', () => {
    const root = tempProject();
    // 无 overlay 文件 → overlay_applied=false
    expect(loadFlow(root, { lifecycle: 'initial', resolved: true }).overlay_applied).toBe(false);
    // 有 overlay 文件 → overlay_applied=true
    writeOverlay(root, 'initial', 'extends: builtin:initial@v1\noverlay: []\n');
    expect(loadFlow(root, { lifecycle: 'initial', resolved: true }).overlay_applied).toBe(true);
  });
});

describe('S22 flow show command', () => {
  it('UT-S22-16 / ST-S22-03: flow show --format json envelope 字段完整', () => {
    const root = tempProject();
    const restoreCwd = mockCwd(root);
    const cap = captureConsole();
    try {
      flowShow('json', { lifecycle: 'initial' });
    } finally {
      cap.restore();
      restoreCwd();
    }
    const env = JSON.parse(cap.logs[0]);
    expect(env.command).toBe('flow show');
    for (const k of ['lifecycle', 'resolved', 'flow', 'overlay_applied', 'builtin_version', 'warnings']) {
      expect(env.data).toHaveProperty(k);
    }
  });

  it('ST-S22-01: flow show 默认展示内置 raw flow（未应用 overlay）', () => {
    const root = tempProject();
    const restoreCwd = mockCwd(root);
    const cap = captureConsole();
    try {
      flowShow('json', { lifecycle: 'initial' });
    } finally {
      cap.restore();
      restoreCwd();
    }
    const env = JSON.parse(cap.logs[0]);
    expect(env.data.resolved).toBe(false);
    expect(env.data.overlay_applied).toBe(false);
  });

  it('ST-S22-02: flow show --resolved 应用 overlay 四操作（skip/add/modify/reorder）', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', [
      'extends: builtin:initial@v1',
      'overlay:',
      '  - op: skip',
      '    target: orchestration-test',
      '  - op: modify',
      '    target: code',
      '    set: { review_agent: r }',
      '  - op: add',
      '    after: code',
      '    node: { id: lint, name: 静态检查 }',
      '  - op: reorder',
      '    target: smoke',
      '    after: deploy',
    ].join('\n') + '\n');
    const restoreCwd = mockCwd(root);
    const cap = captureConsole();
    try {
      flowShow('json', { lifecycle: 'initial', resolved: true });
    } finally {
      cap.restore();
      restoreCwd();
    }
    const env = JSON.parse(cap.logs[0]);
    const subflows = env.data.flow.subflows as Array<{ nodes: Array<{ id: string; review_agent?: string; skipped?: boolean; overlay_op?: string }> }>;
    const nodes = subflows.flatMap(s => s.nodes);
    // skip：保留并标记
    expect(nodes.find(n => n.id === 'orchestration-test')!.skipped).toBe(true);
    // modify：字段覆盖
    expect(nodes.find(n => n.id === 'code')!.review_agent).toBe('r');
    // add：新节点出现在 code 之后、overlay_op=add
    const implIds = subflows.find(s => s.nodes.some(n => n.id === 'code'))!.nodes.map(n => n.id);
    expect(implIds[implIds.indexOf('code') + 1]).toBe('lint');
    expect(nodes.find(n => n.id === 'lint')!.overlay_op).toBe('add');
    // reorder：smoke 移动到 deploy 之后
    const deliverIds = subflows.find(s => s.nodes.some(n => n.id === 'deploy'))!.nodes.map(n => n.id);
    expect(deliverIds.indexOf('smoke')).toBe(deliverIds.indexOf('deploy') + 1);
  });

  it('ST-S22-04: flow show --resolved --format json 暴露 overlay_applied', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', 'extends: builtin:initial@v1\noverlay: []\n');
    const restoreCwd = mockCwd(root);
    const cap = captureConsole();
    try {
      flowShow('json', { lifecycle: 'initial', resolved: true });
    } finally {
      cap.restore();
      restoreCwd();
    }
    const env = JSON.parse(cap.logs[0]);
    expect(env.data.resolved).toBe(true);
    expect(env.data.overlay_applied).toBe(true);
  });

  it('ST-S22-05: flow show --lifecycle launched 查看 launched flow', () => {
    const root = tempProject();
    const restoreCwd = mockCwd(root);
    const cap = captureConsole();
    try {
      flowShow('json', { lifecycle: 'launched' });
    } finally {
      cap.restore();
      restoreCwd();
    }
    const env = JSON.parse(cap.logs[0]);
    expect(env.data.lifecycle).toBe('launched');
    expect(env.data.flow.subflows.flatMap((s: { nodes: { id: string }[] }) => s.nodes).some((n: { id: string }) => n.id === 'archive')).toBe(true);
  });

  it('ST-S22-07: 默认 lifecycle 推断：initial 项目 → initial flow', () => {
    const root = tempProject();
    writeProjectModules(root, 'initial');
    expect(inferLifecycle(root)).toBe('initial');
  });

  it('ST-S22-08: 默认 lifecycle 推断：launched 项目 → launched flow', () => {
    const root = tempProject();
    writeProjectModules(root, 'launched');
    expect(inferLifecycle(root)).toBe('launched');
  });

  it('ST-S22-06: 零行为变更 — flow show 不改变 status/next 输出', () => {
    const root = tempProject();
    const snapData = (fn: () => void): unknown => {
      const restoreCwd = mockCwd(root);
      const cap = captureConsole();
      try { fn(); } finally { cap.restore(); restoreCwd(); }
      return JSON.parse(cap.logs[0]).data;
    };
    const statusBefore = snapData(() => status('json'));
    const nextBefore = snapData(() => next('json'));
    // flow show 为只读命令，不应改变任何状态
    snapData(() => flowShow('json', { lifecycle: 'initial' }));
    snapData(() => flowShow('json', { lifecycle: 'initial', resolved: true }));
    expect(snapData(() => status('json'))).toEqual(statusBefore);
    expect(snapData(() => next('json'))).toEqual(nextBefore);
  });

  it('ST-S22-EX-2.1: 项目未初始化输出 PROJECT_NOT_INITIALIZED', () => {
    const { root, cleanup } = makeTempRoot();
    cleanups.push(cleanup);
    const restoreCwd = mockCwd(root);
    const exitSpy = mockProcessExit();
    const cap = captureConsole();
    try {
      expect(() => flowShow('json')).toThrow(/process.exit\(1\)/);
    } finally {
      cap.restore();
      exitSpy.mockRestore();
      restoreCwd();
    }
    expect(JSON.parse(cap.errors[0]).error.code).toBe('PROJECT_NOT_INITIALIZED');
  });

  it('ST-S22-EX-4.1: 内置模板或 lifecycle 缺失输出 FLOW_NOT_FOUND', () => {
    const root = tempProject();
    const restoreCwd = mockCwd(root);
    const exitSpy = mockProcessExit();
    const cap = captureConsole();
    try {
      expect(() => flowShow('json', { lifecycle: 'bogus' })).toThrow(/process.exit\(1\)/);
    } finally {
      cap.restore();
      exitSpy.mockRestore();
      restoreCwd();
    }
    expect(JSON.parse(cap.errors[0]).error.code).toBe('FLOW_NOT_FOUND');
  });

  it('ST-S22-EX-5.1: overlay schema 非法输出 FLOW_SCHEMA_INVALID', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', 'overlay:\n  - op: skip\n    target: not-exist\n');
    const restoreCwd = mockCwd(root);
    const exitSpy = mockProcessExit();
    const cap = captureConsole();
    try {
      expect(() => flowShow('json', { lifecycle: 'initial', resolved: true })).toThrow(/process.exit\(1\)/);
    } finally {
      cap.restore();
      exitSpy.mockRestore();
      restoreCwd();
    }
    expect(JSON.parse(cap.errors[0]).error.code).toBe('FLOW_SCHEMA_INVALID');
  });

  it('ST-S22-EX-5.2: @vN 版本不匹配仅告警，仍返回 resolved flow', () => {
    const root = tempProject();
    writeOverlay(root, 'initial', 'extends: builtin:initial@v2\noverlay: []\n');
    const restoreCwd = mockCwd(root);
    const cap = captureConsole();
    try {
      flowShow('json', { lifecycle: 'initial', resolved: true });
    } finally {
      cap.restore();
      restoreCwd();
    }
    const env = JSON.parse(cap.logs[0]);
    expect(env.data.warnings.some((w: { code: string }) => w.code === 'FLOW_VERSION_MISMATCH')).toBe(true);
    expect(env.data.flow.subflows.length).toBeGreaterThan(0);
  });
});

// ── contract-self-description 切片3（C4）：flow 节点 dispatch / requires_reviewed / defaults 加载 ──
describe('S22 — dispatch 元数据加载与校验（contract-self-description）', () => {
  it('UT-S22-17: 内置模板 raw 仅特例节点显式 timeout，resolved 后每节点物化完整 dispatch', async () => {
    const { loadFlow: lf, loadBuiltinFlow: lbf } = await import('../src/lib/flow.js');
    for (const lc of ['initial', 'launched'] as const) {
      const raw = lbf(lc);
      const nodes = raw.subflows.flatMap(s => s.nodes);
      for (const n of nodes) {
        expect(n.dispatch, `${lc}:${n.id} 应声明 dispatch`).toBeTruthy();
        expect(typeof n.dispatch!.idempotent).toBe('boolean');
        expect(Array.isArray(n.dispatch!.artifacts_hint)).toBe(true);
      }
      // raw：timeout 仅特例节点显式（code 3600 / deploy 1800），其余省略（由 defaults 物化）
      const explicit = nodes.filter(n => n.dispatch!.timeout_seconds != null).map(n => `${n.id}:${n.dispatch!.timeout_seconds}`).sort();
      expect(explicit).toEqual(['code:3600', 'deploy:1800']);
      expect(raw.defaults?.dispatch?.timeout_seconds).toBe(900);
      // 声明基准抽样：产出/评审与 verify/smoke 类 idempotent:true；一次性落盘/执行类 false
      const byId = new Map(nodes.map(n => [n.id, n.dispatch!]));
      if (lc === 'launched') {
        expect(byId.get('write-proposal')!.idempotent).toBe(true);
        expect(byId.get('apply-merge')!.idempotent).toBe(false);
        expect(byId.get('archive')!.idempotent).toBe(false);
        expect(byId.get('verify')!.idempotent).toBe(true);
      } else {
        expect(byId.get('deploy')!.idempotent).toBe(false);
        expect(byId.get('smoke')!.idempotent).toBe(true);
      }
      // resolved：全节点物化完整对象，未显式节点 timeout == defaults(900)
      const { root, cleanup } = makeTempRoot();
      scaffoldProject(root);
      const resolved = lf(root, { lifecycle: lc, resolved: true }).flow;
      for (const n of resolved.subflows.flatMap(s => s.nodes)) {
        expect(n.dispatch).toMatchObject({
          idempotent: expect.any(Boolean),
          timeout_seconds: expect.any(Number),
          artifacts_hint: expect.any(Array),
        });
        if (!['code', 'deploy'].includes(n.id)) expect(n.dispatch!.timeout_seconds).toBe(900);
      }
      cleanup();
    }
  });

  it('UT-S22-18: apply-merge requires_reviewed==["proposal","delta"] 加载，未声明节点不注入默认', async () => {
    const { loadBuiltinFlow: lbf } = await import('../src/lib/flow.js');
    const flow = lbf('launched');
    const nodes = flow.subflows.flatMap(s => s.nodes);
    const applyMerge = nodes.find(n => n.id === 'apply-merge')!;
    expect(applyMerge.requires_reviewed).toEqual(['proposal', 'delta']);
    for (const n of nodes.filter(n => n.id !== 'apply-merge')) {
      expect(n.requires_reviewed == null, `${n.id} 不应有 requires_reviewed`).toBe(true);
    }
  });

  it('UT-S22-19: dispatch/requires_reviewed/defaults 类型非法 → FLOW_SCHEMA_INVALID；schema version 保持 1', async () => {
    const { validateFlow: vf, loadBuiltinFlow: lbf, FlowError: FE } = await import('../src/lib/flow.js');
    const base = () => JSON.parse(JSON.stringify(lbf('launched')));
    expect(base().version).toBe(1); // 向后兼容扩展，schema version 不变
    const bad1 = base(); bad1.subflows[0].nodes[0].dispatch = { idempotent: 'yes' };
    expect(() => vf(bad1)).toThrowError(/dispatch\.idempotent/);
    const bad2 = base(); bad2.subflows[0].nodes[0].dispatch = { timeout_seconds: 0 };
    expect(() => vf(bad2)).toThrowError(/timeout_seconds/);
    const bad3 = base(); bad3.subflows[0].nodes[0].dispatch = { artifacts_hint: [1] };
    expect(() => vf(bad3)).toThrowError(/artifacts_hint/);
    const bad4 = base(); bad4.subflows[0].nodes[0].requires_reviewed = 'proposal';
    expect(() => vf(bad4)).toThrowError(/requires_reviewed/);
    const bad5 = base(); bad5.defaults = { dispatch: 'fast' };
    expect(() => vf(bad5)).toThrowError(/defaults\.dispatch/);
    try { vf(bad5); } catch (e) { expect((e as InstanceType<typeof FE>).code).toBe('FLOW_SCHEMA_INVALID'); }
  });

  it('UT-S22-20: defaults.dispatch.timeout_seconds 顶层加载与 overlay 覆盖后物化进未显式节点（唯一默认值源）', async () => {
    const { loadFlow: lf } = await import('../src/lib/flow.js');
    const { root, cleanup } = makeTempRoot();
    scaffoldProject(root);
    mkdirSync(join(root, 'logos', 'flow'), { recursive: true });
    writeFileSync(join(root, 'logos', 'flow', 'launched.yaml'),
      'extends: builtin:launched@v3\ndefaults:\n  dispatch:\n    timeout_seconds: 600\n');
    const raw = lf(root, { lifecycle: 'launched' }).flow;
    expect(raw.defaults?.dispatch?.timeout_seconds).toBe(900); // raw = builtin 声明
    const resolved = lf(root, { lifecycle: 'launched', resolved: true }).flow;
    expect(resolved.defaults?.dispatch?.timeout_seconds).toBe(600); // overlay defaults 覆盖 builtin defaults
    const byId = new Map(resolved.subflows.flatMap(s => s.nodes).map(n => [n.id, n.dispatch!]));
    expect(byId.get('write-proposal')!.timeout_seconds).toBe(600); // 未显式节点 → 物化覆盖值
    expect(byId.get('code')!.timeout_seconds).toBe(3600);          // 节点显式特例优先于 defaults
    expect(byId.get('deploy')!.timeout_seconds).toBe(1800);
    cleanup();
  });

  it('ST-S22-09: flow show raw/resolved JSON 端到端暴露 defaults 与逐节点 dispatch/requires_reviewed', async () => {
    const { root, cleanup } = makeTempRoot();
    scaffoldProject(root);
    const run = (opts: Record<string, unknown>) => {
      const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
      try { flowShow('json', opts); } finally { cap.restore(); ex.mockRestore(); restore(); }
      return JSON.parse(cap.logs[cap.logs.length - 1]).data;
    };
    const raw = run({ lifecycle: 'launched' });
    expect(raw.flow.defaults.dispatch.timeout_seconds).toBe(900);
    const resolved = run({ lifecycle: 'launched', resolved: true });
    for (const sub of resolved.flow.subflows) {
      for (const n of sub.nodes) {
        expect(n.dispatch).toMatchObject({ idempotent: expect.any(Boolean), timeout_seconds: expect.any(Number), artifacts_hint: expect.any(Array) });
      }
    }
    const applyMerge = resolved.flow.subflows.flatMap((s: any) => s.nodes).find((n: any) => n.id === 'apply-merge');
    expect(applyMerge.requires_reviewed).toEqual(['proposal', 'delta']);
    cleanup();
  });
});
