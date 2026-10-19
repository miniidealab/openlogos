/**
 * module-scoped-env-smoke 切片2：deploy-done 按模块的环境校验（spec/environments.md §14.2、§14.4）。
 *
 * 用例 ID 与 logos/resources/test/core-S21-test-cases.md「按模块的环境校验」对齐（UT-S21-20～22）。
 * 夹具 MM 见 test/s19-module-env-fixtures.ts。结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LEDGER_REL, PROPOSAL_REL, buildEnvProject, callsLogPath, dataOf, errorOf, runCli, snapshot, type EnvFixtureOptions,
} from './s19-module-env-fixtures.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function mm(opts: EnvFixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mes21-'));
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(callsLogPath(root), { force: true });
  });
  return buildEnvProject(root, 'MM', opts);
}

const marker = (root: string) => JSON.parse(readFileSync(join(root, PROPOSAL_REL, 'DEPLOY_DONE'), 'utf-8')) as { environment: string | null };
const tasks = (root: string) => readFileSync(join(root, PROPOSAL_REL, 'tasks.md'), 'utf-8');

describe('S21 deploy-done 按模块的环境校验（module-scoped-env-smoke 切片2）', () => {
  it('UT-S21-20: 未声明环境的模块按无登记表落标；冒用他模块环境 ENV_MODULE_MISMATCH 零写入', () => {
    const root = mm();
    // ③ --env team-prod（team 已声明）→ ENV_MODULE_MISMATCH，零写入
    const before = snapshot(root, PROPOSAL_REL);
    const bad = runCli(root, ['deploy-done', '--env', 'team-prod', '--format', 'json']);
    expect(bad.status).toBe(1);
    expect(errorOf(bad)).toMatchObject({
      code: 'ENV_MODULE_MISMATCH', details: { module: 'core', environment: 'team-prod', module_environments: [] },
    });
    expect(snapshot(root, PROPOSAL_REL)).toEqual(before);

    // ① 不传 --env：成功，environment 为 null，[deploy] 勾选，不写部署账本
    const plain = runCli(root, ['deploy-done', '--format', 'json']);
    expect(plain.status, plain.stderr).toBe(0);
    expect(dataOf<{ environment: string | null; deployment?: unknown }>(plain)).toMatchObject({ environment: null });
    expect(dataOf(plain)).not.toHaveProperty('deployment');
    expect(marker(root).environment).toBeNull();
    expect(tasks(root)).toContain('- [x] 发布');
    expect(existsSync(join(root, LEDGER_REL))).toBe(false);

    // ② --env local-macos（未登记）：原始标签写入 DEPLOY_DONE.environment，不写部署账本
    const label = runCli(root, ['deploy-done', '--env', 'local-macos', '--format', 'json']);
    expect(label.status, label.stderr).toBe(0);
    expect(dataOf<{ environment: string | null }>(label).environment).toBe('local-macos');
    expect(marker(root).environment).toBe('local-macos');
    expect(existsSync(join(root, LEDGER_REL))).toBe(false);
  }, 120_000);

  it('UT-S21-21: 声明了环境的模块只能用自己的环境', () => {
    const root = mm({ proposalModule: 'team' });
    const before = snapshot(root, PROPOSAL_REL);
    // ① --env prod → ENV_MODULE_MISMATCH，列出 ["team-prod"]
    const prod = runCli(root, ['deploy-done', '--env', 'prod', '--format', 'json']);
    expect(prod.status).toBe(1);
    expect(errorOf(prod)).toMatchObject({
      code: 'ENV_MODULE_MISMATCH', details: { module: 'team', environment: 'prod', module_environments: ['team-prod'] },
    });
    expect(errorOf(prod).message).toContain('team-prod');
    // ② 不传 --env → ENV_REQUIRED
    const none = runCli(root, ['deploy-done', '--format', 'json']);
    expect(none.status).toBe(1);
    expect(errorOf(none).code).toBe('ENV_REQUIRED');
    expect(snapshot(root, PROPOSAL_REL)).toEqual(before);
    expect(existsSync(join(root, LEDGER_REL))).toBe(false);

    // ③ --env Team-Production（别名）→ 既有流程：DEPLOY_DONE.environment="team-prod" 并追加账本
    const ok = runCli(root, ['deploy-done', '--env', 'Team-Production', '--format', 'json']);
    expect(ok.status, ok.stderr).toBe(0);
    expect(dataOf<{ environment: string; deployment: { ledger_written: boolean } }>(ok)).toMatchObject({
      environment: 'team-prod', deployment: { ledger_written: true },
    });
    expect(marker(root).environment).toBe('team-prod');
    const rows = readFileSync(join(root, LEDGER_REL), 'utf-8').trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'deploy', environment: 'team-prod', slug: 'ship-it', result: 'done' });
  }, 120_000);

  it('UT-S21-22: 引用失效先于受门环境与写入拒绝；core 不受 team 失效引用影响', () => {
    const broken: EnvFixtureOptions = { teamEnvironments: ['Team-Production'], teamProdAliases: [], teamProdRequireApproval: true };
    const team = mm({ ...broken, proposalModule: 'team' });
    const before = snapshot(team, PROPOSAL_REL);
    const r = runCli(team, ['deploy-done', '--env', 'team-prod', '--format', 'json']);
    expect(r.status).toBe(1);
    expect(errorOf(r)).toMatchObject({
      code: 'ENV_GATE_REFERENCE_UNKNOWN', details: { module: 'team', invalid_references: ['Team-Production'] },
    });
    expect(snapshot(team, PROPOSAL_REL)).toEqual(before);
    expect(existsSync(join(team, LEDGER_REL))).toBe(false);
    // 失效引用修好之后才轮到受门环境检查：证明前一条拒绝不是 DEPLOY_DONE_GATED_ENV
    const fixed = mm({ teamProdRequireApproval: true, proposalModule: 'team' });
    expect(errorOf(runCli(fixed, ['deploy-done', '--env', 'team-prod', '--format', 'json'])).code).toBe('DEPLOY_DONE_GATED_ENV');

    const core = mm(broken);
    const done = runCli(core, ['deploy-done', '--format', 'json']);
    expect(done.status, done.stderr).toBe(0);
    expect(marker(core).environment).toBeNull();
  }, 120_000);
});
