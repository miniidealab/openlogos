/**
 * S23 watch（实时观测派生研发状态）—— 切片 C。
 *
 * 用例 ID 与 logos/resources/test/core-S23-test-cases.md 严格对齐（UT-S23-01~10 / ST-S23-01~05 / ST-S23-EX-2.1）。
 * 核心契约（spec/cli-json-output.md §10）：启动先出初始快照（seq=0, snapshot）；之后仅 data 变化时输出
 * （change, seq 递增）；变化判定=相邻两次 data 深比较；每条含 seq/timestamp；data.status 与 status 同构；
 * 继承 --module；只读无副作用；SIGINT 优雅退出；未初始化报 PROJECT_NOT_INITIALIZED 非零退出。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { watch, WatchStream, type WatchPayload } from '../src/commands/watch.js';
import { collectStatusData, type StatusData } from '../src/commands/status.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function launchedProject(modules: Array<{ id: string; name: string }> = [{ id: 'core', name: 'Core' }]): { root: string } {
  const { root, cleanup } = makeTempRoot();
  scaffoldProject(root);
  writeFileSync(
    join(root, 'logos', 'logos-project.yaml'),
    stringifyYaml({ modules: modules.map(m => ({ ...m, lifecycle: 'launched' })) }, { lineWidth: 0 }),
  );
  cleanups.push(cleanup);
  return { root };
}

/** 收集 WatchStream 输出的 envelope.data（json 模式）。 */
function streamCollector(module: string | null) {
  const out: WatchPayload[] = [];
  const stream = new WatchStream(module, 'json', line => out.push(JSON.parse(line).data));
  return { stream, out };
}

// ── 一、WatchStream 流式契约 UT ──
describe('S23 WatchStream 流式契约', () => {
  it('UT-S23-01: 启动先输出一次初始快照（seq=0, event="snapshot"）', () => {
    const { root } = launchedProject();
    const { stream, out } = streamCollector(null);
    stream.tick(collectStatusData(root));
    expect(out).toHaveLength(1);
    expect(out[0].seq).toBe(0);
    expect(out[0].event).toBe('snapshot');
  });

  it('UT-S23-02: 仅在派生 data 变化时输出（相同 data 不重复）', () => {
    const { root } = launchedProject();
    const { stream, out } = streamCollector(null);
    const data = collectStatusData(root);
    stream.tick(data);
    stream.tick(collectStatusData(root)); // 同一派生 → 深比较相等 → 不输出
    expect(out).toHaveLength(1);
  });

  it('UT-S23-03: data 变化 → event="change"、seq 递增', () => {
    const { root } = launchedProject();
    const { stream, out } = streamCollector(null);
    stream.tick(collectStatusData(root));
    // 制造派生变化：新增一个模块
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [
        { id: 'core', name: 'Core', lifecycle: 'launched' },
        { id: 'extra', name: 'Extra', lifecycle: 'launched' },
      ] }, { lineWidth: 0 }),
    );
    stream.tick(collectStatusData(root));
    expect(out).toHaveLength(2);
    expect(out[1].event).toBe('change');
    expect(out[1].seq).toBe(1);
  });

  it('UT-S23-04: 每条输出含递增 seq 与 timestamp（envelope 层）', () => {
    const { root } = launchedProject();
    const lines: string[] = [];
    const stream = new WatchStream(null, 'json', l => lines.push(l));
    stream.tick(collectStatusData(root));
    writeFileSync(join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }, { id: 'x', name: 'X', lifecycle: 'launched' }] }, { lineWidth: 0 }));
    stream.tick(collectStatusData(root));
    const envs = lines.map(l => JSON.parse(l));
    expect(envs.map(e => e.data.seq)).toEqual([0, 1]);
    for (const e of envs) {
      expect(e.command).toBe('watch');
      expect(typeof e.timestamp).toBe('string');
    }
  });

  it('UT-S23-05: --format json 的 data.status 与 status 的 data 同构', () => {
    const { root } = launchedProject();
    const { stream, out } = streamCollector(null);
    const statusData: StatusData = collectStatusData(root);
    stream.tick(statusData);
    expect(Object.keys(out[0].status).sort()).toEqual(Object.keys(statusData).sort());
    expect(out[0].status).toEqual(statusData);
  });

  it('UT-S23-07: 继承 --module 过滤——派生与 status --module 一致', () => {
    const { root } = launchedProject([{ id: 'core', name: 'Core' }, { id: 'extra', name: 'Extra' }]);
    const { stream, out } = streamCollector('core');
    stream.tick(collectStatusData(root, 'core'));
    expect(out[0].module).toBe('core');
    expect(out[0].status).toEqual(collectStatusData(root, 'core'));
  });
});

// ── 二、watch() 命令编排（启动/间隔/SIGINT/只读/错误） ──
describe('S23 watch 命令编排', () => {
  function runWatch(root: string, format: 'text' | 'json', moduleId?: string, interval?: number) {
    const restoreCwd = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    const ctrl = watch(format, moduleId, interval);
    cleanups.push(() => { ctrl && 'stop' in ctrl && ctrl.stop(); con.restore(); exitSpy.mockRestore(); restoreCwd(); });
    return { ctrl, con, exitSpy };
  }

  it('UT-S23-01/ST-S23-01: 启动同步输出初始快照（seq=0 snapshot）', () => {
    const { root } = launchedProject();
    const { con } = runWatch(root, 'json');
    const env = JSON.parse(con.logs[0]);
    expect(env.command).toBe('watch');
    expect(env.data.seq).toBe(0);
    expect(env.data.event).toBe('snapshot');
  });

  it('UT-S23-06: --interval 控制轮询间隔（默认 2s）', () => {
    const { root } = launchedProject();
    const def = runWatch(root, 'json');
    expect(def.ctrl && 'intervalMs' in def.ctrl && def.ctrl.intervalMs).toBe(2000);
    const five = runWatch(root, 'json', undefined, 5);
    expect(five.ctrl && 'intervalMs' in five.ctrl && five.ctrl.intervalMs).toBe(5000);
  });

  it('ST-S23-04: --interval 5 → 周期约 5s（轮询不在间隔内重复）', () => {
    vi.useFakeTimers();
    try {
      const { root } = launchedProject();
      const { con } = runWatch(root, 'json', undefined, 5);
      expect(con.logs).toHaveLength(1); // 仅初始快照
      vi.advanceTimersByTime(4000); // 未到 5s
      expect(con.logs).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('UT-S23-08/ST-S23-05: 只读无副作用——运行期间不写任何文件', () => {
    const { root } = launchedProject();
    const before = readdirSync(join(root, 'logos')).sort();
    const { ctrl } = runWatch(root, 'json');
    ctrl && 'stop' in ctrl && ctrl.stop();
    const after = readdirSync(join(root, 'logos')).sort();
    expect(after).toEqual(before);
  });

  it('UT-S23-09: SIGINT 优雅退出（清理轮询并以 0 码退出）', () => {
    const { root } = launchedProject();
    const { ctrl, exitSpy } = runWatch(root, 'json');
    if (!ctrl || !('sigint' in ctrl)) throw new Error('no controller');
    expect(() => ctrl.sigint()).toThrow('process.exit(0)');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('UT-S23-10/ST-S23-EX-2.1: 未初始化 → PROJECT_NOT_INITIALIZED 非零退出，不进入轮询', () => {
    const { root, cleanup } = makeTempRoot();
    cleanups.push(cleanup);
    const restoreCwd = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    cleanups.push(() => { con.restore(); exitSpy.mockRestore(); restoreCwd(); });
    expect(() => watch('json')).toThrow('process.exit(1)');
    const errEnv = JSON.parse(con.errors[con.errors.length - 1]);
    expect(errEnv.error.code).toBe('PROJECT_NOT_INITIALIZED');
  });

  it('ST-S23-02: --format json 输出行分隔 JSON 流（每行一个 watch envelope）', () => {
    const { root } = launchedProject();
    const { con } = runWatch(root, 'json');
    for (const line of con.logs) {
      const env = JSON.parse(line); // 每行独立合法 JSON
      expect(env.command).toBe('watch');
      expect(env.data).toHaveProperty('seq');
      expect(env.data).toHaveProperty('status');
    }
  });

  it('ST-S23-03: --module 过滤的 data.status 与 status --module 一致', () => {
    const { root } = launchedProject([{ id: 'core', name: 'Core' }, { id: 'extra', name: 'Extra' }]);
    const { con } = runWatch(root, 'json', 'core');
    const env = JSON.parse(con.logs[0]);
    expect(env.data.module).toBe('core');
    expect(env.data.status).toEqual(collectStatusData(root, 'core'));
  });
});
