/**
 * S11 并发只读读取门有界重试（fix-baseline-readlock-reader-contention）。
 * 覆盖：UT-S11-78、UT-S11-79、ST-S11-45。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectStatusData } from '../src/commands/status.js';
import {
  lockPath, runsRoot, setReadLockRetryPolicyForTests,
} from '../src/lib/baseline-seed-txn.js';
import { makeTempRoot, scaffoldProject } from './helpers.js';

const cliRoot = process.cwd();
const cleanups: Array<() => void> = [];
afterEach(() => {
  setReadLockRetryPolicyForTests();
  while (cleanups.length) cleanups.pop()!();
});

function adoptedFixture() {
  const temp = makeTempRoot(); cleanups.push(temp.cleanup);
  scaffoldProject(temp.root, { name: 'readlock-s11', locale: 'zh' });
  writeFileSync(join(temp.root, 'logos/logos-project.yaml'), [
    'project:', '  name: readlock-s11', 'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', '    bootstrap: adopted', '    baseline_seed_state: partial',
    '    product_type: cli', 'scenarios: []',
  ].join('\n'));
  return temp.root;
}

function holdLockAsOtherProcess(root: string) {
  mkdirSync(runsRoot(root), { recursive: true });
  writeFileSync(lockPath(root, 'core'),
    JSON.stringify({ pid: process.ppid, at: Date.now(), token: `other-${process.ppid}` }));
}

/** status 投影的稳定切面（剔除时间戳类字段），供无竞争基线与竞争后输出逐字段对比。 */
function statusProjection(root: string): string {
  const data = collectStatusData(root);
  return JSON.stringify((data.modules ?? []).map(m => ({
    id: m.id, lifecycle: m.lifecycle,
    seed: m.baseline_seed_state, coverage: m.baseline_coverage,
    suggestion: m.suggestion,
  })));
}

describe('S11 并发只读读取门有界重试', () => {
  it('UT-S11-78: status 读锁区间在锁被占时走有界重试，输出与无竞争基线一致', () => {
    const root = adoptedFixture();
    const baseline = statusProjection(root); // 无竞争基线

    let sleeps = 0;
    setReadLockRetryPolicyForTests({
      sleep: () => { sleeps++; rmSync(lockPath(root, 'core'), { force: true }); }, // 预算内 owner 释放
    });
    holdLockAsOtherProcess(root);
    const contended = statusProjection(root);
    expect(sleeps).toBeGreaterThanOrEqual(1);       // 确实经过退避重试而非立即失败
    expect(contended).toBe(baseline);               // 恢复门取到锁后行为与无竞争时逐字段一致
    expect(contended).not.toContain('baseline_commit_in_progress');
  });

  it('UT-S11-79: writer 真持锁超预算仍如实硬报，不输出半新投影', () => {
    const root = adoptedFixture();
    let clock = 0;
    setReadLockRetryPolicyForTests({ now: () => { clock += 700; return clock; }, sleep: () => { /* noop */ } });
    holdLockAsOtherProcess(root);
    // 既有硬门形态：collectStatusData 抛稳定 baseline_commit_in_progress（命令层转 error envelope + 非零退出）。
    expect(() => collectStatusData(root)).toThrow(/baseline_commit_in_progress/);
    expect(() => collectStatusData(root)).toThrow(/core/); // 携带模块诊断
  });

  it('ST-S11-45: 8 路并发只读 status 全零退出且投影一致，无残留锁', async () => {
    const root = adoptedFixture();
    const cli = join(cliRoot, 'dist/index.js');
    const runOnce = () => new Promise<{ code: number; out: string }>(resolvePromise => {
      const child = spawn(process.execPath, [cli, 'status', '--format', 'json'], { cwd: root });
      let out = '';
      child.stdout.on('data', d => { out += String(d); });
      child.stderr.on('data', d => { out += String(d); });
      child.on('close', code => resolvePromise({ code: code ?? -1, out }));
    });

    const results = await Promise.all(Array.from({ length: 8 }, runOnce));
    const projections = new Set<string>();
    for (const r of results) {
      expect(r.code, r.out.slice(0, 400)).toBe(0);
      expect(r.out).not.toContain('baseline_commit_in_progress');
      const env = JSON.parse(r.out) as { data: { modules: Array<Record<string, unknown>> } };
      projections.add(JSON.stringify(env.data.modules.map(m => ({
        id: m.id, seed: m.baseline_seed_state, suggestion: m.suggestion,
      }))));
    }
    expect(projections.size).toBe(1); // 8 路投影一致

    // 与串行基线一致。
    const serial = await runOnce();
    expect(serial.code).toBe(0);
    const serialEnv = JSON.parse(serial.out) as { data: { modules: Array<Record<string, unknown>> } };
    expect(projections.has(JSON.stringify(serialEnv.data.modules.map(m => ({
      id: m.id, seed: m.baseline_seed_state, suggestion: m.suggestion,
    }))))).toBe(true);

    expect(readdirSync(runsRoot(root)).filter(f => f.endsWith('.commit.lock'))).toEqual([]);
  }, 30_000);
});
