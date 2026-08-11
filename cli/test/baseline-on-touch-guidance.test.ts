/** S05/S09/S11/S20/S33 与 S39 direct-change / journal gate 的交叉回归。 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adopt } from '../src/commands/adopt.js';
import { change } from '../src/commands/change.js';
import { next } from '../src/commands/next.js';
import { collectStatusData } from '../src/commands/status.js';
import { runsRoot } from '../src/lib/baseline-seed-txn.js';
import { captureConsole, makeTempRoot, mockProcessExit, scaffoldProject } from './helpers.js';

const cleanups: Array<() => void> = [];
const originalCwd = process.cwd();
afterEach(() => {
  process.chdir(originalCwd);
  while (cleanups.length) cleanups.pop()!();
});

function adoptedFixture(state: 'required' | 'partial' | 'seeded') {
  const temp = makeTempRoot(); cleanups.push(temp.cleanup);
  scaffoldProject(temp.root, { name: 'touch-guidance', locale: 'zh' });
  writeFileSync(join(temp.root, 'logos/logos-project.yaml'), [
    'project:', '  name: touch-guidance', 'modules:', '  - id: core', '    name: Core',
    '    lifecycle: launched', '    bootstrap: adopted', `    baseline_seed_state: ${state}`,
    '    product_type: cli', 'scenarios: []',
  ].join('\n'));
  return temp.root;
}

describe('baseline-on-touch 跨场景引导与恢复门', () => {
  it('UT-S09-149: launched flow 仍只有既有 plan-exit，未插入 baseline node/gate/marker', () => {
    const launched = readFileSync(join(originalCwd, '..', 'spec/flow/launched.yaml'), 'utf-8');
    expect((launched.match(/^\s*-\s+id:\s*plan\s*$/gm) ?? [])).toHaveLength(1);
    expect((launched.match(/gate:\s*\{\s*type:\s*human/g) ?? []).length).toBeGreaterThan(0);
    expect(launched).not.toMatch(/add-baseline-docs|baseline[_-](?:gate|marker|section)/i);
  });

  it('UT-S11-B01 / ST-S11-B01 / UT-S20-16 / ST-S20-13: 安全 partial 排除 staging，status/next 仍成功 direct-change', async () => {
    const root = adoptedFixture('partial');
    const runDir = join(runsRoot(root), 'seed-core-safe-partial');
    mkdirSync(join(runDir, 'staging/logos/resources/prd/3-technical-plan/2-scenario-implementation'), { recursive: true });
    writeFileSync(join(runDir, 'run.json'), JSON.stringify({
      run_id: 'seed-core-safe-partial', module: 'core', status: 'open', expected: [], created_at: '2026-08-10T00:00:00Z',
    }));
    writeFileSync(join(runDir, 'staging/logos/resources/prd/3-technical-plan/2-scenario-implementation/fake.md'), '# staging only');

    const status = collectStatusData(root);
    const mod = status.modules![0];
    expect(mod.baseline_seed_state).toBe('partial');
    expect(mod.baseline_coverage?.denominator).toBe(0);
    expect(mod.suggestion).toContain('openlogos change <slug>');

    process.chdir(root);
    const con = captureConsole();
    try {
      await next('json');
      const env = JSON.parse(con.logs.find(line => line.startsWith('{'))!);
      expect(env.data.command).toBe('openlogos change <slug>');
      expect(JSON.stringify(env.data)).not.toContain('staging only');
    } finally { con.restore(); }

    change('safe-partial');
    expect(existsSync(join(root, 'logos/changes/safe-partial/proposal.md'))).toBe(true);
    expect(existsSync(join(root, 'logos/changes/safe-partial/tasks.md'))).toBe(true);
  });

  it('UT-S20-19: 不可恢复 journal 在 change 写 proposal/tasks/guard 前统一硬阻断', () => {
    const root = adoptedFixture('required');
    const broken = join(runsRoot(root), 'broken-change');
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, 'commit-journal.json'), '{broken');
    process.chdir(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    try {
      expect(() => change('must-not-exist')).toThrow('process.exit(1)');
      expect(con.errors.join('\n')).toContain('baseline_commit_in_progress');
      expect(existsSync(join(root, 'logos/changes/must-not-exist'))).toBe(false);
      expect(existsSync(join(root, 'logos/.openlogos-guard'))).toBe(false);
    } finally {
      exitSpy.mockRestore();
      con.restore();
    }
  });

  it('UT-S33-53: required/安全 partial/seeded 三态的无提案 next 主命令完全相同', async () => {
    for (const state of ['required', 'partial', 'seeded'] as const) {
      const root = adoptedFixture(state); process.chdir(root);
      const con = captureConsole();
      try {
        await next('json');
        const env = JSON.parse(con.logs.find(line => line.startsWith('{'))!);
        expect(env.data.command, state).toBe('openlogos change <slug>');
        expect(env.data.modules[0].command, state).toBe('openlogos change <slug>');
      } finally { con.restore(); }
    }
  });

  it('ST-S20-10: adopt 后无需 baseline-seed 即可创建首个 change 提案', async () => {
    const temp = makeTempRoot(); cleanups.push(temp.cleanup); process.chdir(temp.root);
    writeFileSync(join(temp.root, 'package.json'), JSON.stringify({ name: 'existing-touch-app' }));
    const con = captureConsole();
    try {
      await adopt(undefined, { locale: 'zh', aiTool: 'cursor' });
      change('first-touch');
      expect(existsSync(join(temp.root, 'logos/changes/first-touch/proposal.md'))).toBe(true);
      expect(existsSync(join(temp.root, 'logos/changes/first-touch/tasks.md'))).toBe(true);
      const output = con.logs.join('\n');
      expect(output).toContain('openlogos change <slug>');
      expect(output).not.toContain('必须先运行 openlogos baseline-seed');
    } finally { con.restore(); }
  });
});
