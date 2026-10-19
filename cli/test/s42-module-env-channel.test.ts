/**
 * module-scoped-env-smoke 切片2：deploy 按环境归属的部署通道（spec/environments.md §11.5、§14.2、§14.4）。
 *
 * 用例 ID 与 logos/resources/test/core-S42-test-cases.md「按环境归属的部署通道」对齐（UT-S42-26～28）。
 * 「提案文件不变」以调用前后提案目录字节快照比对取证。夹具 MM 见 test/s19-module-env-fixtures.ts。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LEDGER_REL, PROPOSAL_REL, buildEnvProject, callsLogPath, dataOf, errorOf, git, runCli, snapshot, type EnvFixtureOptions,
} from './s19-module-env-fixtures.js';

const LOCKS_REL = 'logos/.openlogos-runtime/deploy-locks';
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function mm(opts: EnvFixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mes42-'));
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(callsLogPath(root), { force: true });
  });
  return buildEnvProject(root, 'MM', opts);
}

const ledgerRows = (root: string) => readFileSync(join(root, LEDGER_REL), 'utf-8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
const proposalStep = (root: string) => dataOf<{ active_change: string | null; proposal_step: string | null }>(runCli(root, ['next', '--format', 'json']));

describe('S42 按环境归属的部署通道（module-scoped-env-smoke 切片2）', () => {
  it('UT-S42-26: 默认通道按环境归属——core 提案下部署 team 环境走版本通道且不碰提案；team 提案走提案通道', () => {
    // ① core 活跃提案处于 ready-to-deploy：deploy --env team-prod --ref <commit> → 版本通道
    const core = mm();
    expect(proposalStep(core).proposal_step).toBe('ready-to-deploy');
    const before = snapshot(core, PROPOSAL_REL);
    const head = git(core, ['rev-parse', 'HEAD']);
    const v = runCli(core, ['deploy', '--env', 'team-prod', '--ref', head, '--format', 'json']);
    expect(v.status, v.stderr).toBe(0);
    expect(dataOf<{ channel: string; status: string }>(v)).toMatchObject({ channel: 'version', status: 'done' });
    const rows = ledgerRows(core).filter(r => r.kind === 'deploy');
    expect(rows.at(-1)).toMatchObject({ environment: 'team-prod', slug: null, channel: 'version', result: 'done', ref: head });
    expect(snapshot(core, PROPOSAL_REL)).toEqual(before);
    expect(proposalStep(core)).toMatchObject({ active_change: 'ship-it', proposal_step: 'ready-to-deploy' });
    expect(readFileSync(callsLogPath(core), 'utf-8')).toContain('"deploy":"team-prod"');

    // ② team 活跃提案处于 ready-to-deploy：deploy --env team-prod → 提案通道（写报告、DEPLOY_DONE、勾选）
    const team = mm({ proposalModule: 'team' });
    const p = runCli(team, ['deploy', '--env', 'team-prod', '--format', 'json']);
    expect(p.status, p.stderr).toBe(0);
    expect(dataOf<{ channel: string; status: string }>(p)).toMatchObject({ channel: 'proposal', status: 'done' });
    expect(existsSync(join(team, PROPOSAL_REL, 'DEPLOY_DONE'))).toBe(true);
    expect(readFileSync(join(team, PROPOSAL_REL, 'tasks.md'), 'utf-8')).toContain('- [x] 发布');
    expect(readFileSync(join(team, 'logos/resources/verify/deployment-report.md'), 'utf-8')).not.toBe('# Deployment Report\n\nok\n');
    expect(ledgerRows(team).filter(r => r.kind === 'deploy').at(-1)).toMatchObject({ channel: 'proposal', slug: 'ship-it' });
  }, 180_000);

  it('UT-S42-27: 显式 --channel proposal 而环境不属于提案模块 → ENV_MODULE_MISMATCH，零执行零写入未取锁', () => {
    const core = mm();
    const before = snapshot(core, PROPOSAL_REL);
    for (const env of ['team-prod', 'test']) {
      const r = runCli(core, ['deploy', '--env', env, '--channel', 'proposal', '--format', 'json']);
      expect(r.status, env).toBe(1);
      expect(errorOf(r), env).toMatchObject({
        code: 'ENV_MODULE_MISMATCH', details: { module: 'core', environment: env, module_environments: [] },
      });
    }
    expect(snapshot(core, PROPOSAL_REL)).toEqual(before);
    expect(existsSync(join(core, LEDGER_REL))).toBe(false);
    expect(snapshot(core, LOCKS_REL)).toEqual({});
    expect(existsSync(callsLogPath(core))).toBe(false);
  }, 120_000);

  it('UT-S42-28: 目标模块声明含失效引用时在取锁与执行前拒绝（无活跃提案、core 活跃提案两种）', () => {
    for (const proposalModule of [null, 'core'] as const) {
      const root = mm({ teamEnvironments: ['team-prod', 'team-old'], proposalModule });
      const before = { proposal: snapshot(root, PROPOSAL_REL), ledger: snapshot(root, LEDGER_REL) };
      const head = git(root, ['rev-parse', 'HEAD']);
      const r = runCli(root, ['deploy', '--env', 'team-prod', '--ref', head, '--format', 'json']);
      expect(r.status, String(proposalModule)).toBe(1);
      expect(errorOf(r), String(proposalModule)).toMatchObject({
        code: 'ENV_GATE_REFERENCE_UNKNOWN', details: { module: 'team', invalid_references: ['team-old'] },
      });
      expect(snapshot(root, PROPOSAL_REL)).toEqual(before.proposal);
      expect(snapshot(root, LEDGER_REL)).toEqual(before.ledger);
      expect(snapshot(root, LOCKS_REL)).toEqual({});
      expect(existsSync(callsLogPath(root))).toBe(false); // 部署脚本未运行
    }
  }, 120_000);
});
