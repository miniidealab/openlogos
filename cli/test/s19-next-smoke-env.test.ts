/**
 * module-scoped-env-smoke 切片1：next --auto 生成的 smoke 命令带 --env（spec/environments.md §14.7），
 * 以及未启用项目（S1、M0）的零回归（§14.1、§14.8）。
 *
 * 用例 ID 与 logos/resources/test/core-S19-test-cases.md 对齐（UT-S19-81、ST-S19-31）。零回归基准为修改前（0.16.9）
 * CLI 的实测输出，入库于 test/fixtures/s19-module-env-baseline.json（生成器 test/fixtures/gen-s19-module-env-baseline.ts），
 * 不在测试内复述。结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MES_BASELINE_FILE, SLUG, buildEnvProject, callsLogPath, readJson, runCli, zeroRegressionRun,
  type CliRun, type EnvKind,
} from './s19-module-env-fixtures.js';
import { stripDefaultManualAcceptanceFromRun } from './manual-acceptance-golden.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function project(kind: EnvKind): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mes-'));
  cleanups.push(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(callsLogPath(root), { force: true });
  });
  return buildEnvProject(root, kind);
}

function nextData(root: string, auto: boolean): Record<string, unknown> {
  const r = runCli(root, ['next', ...(auto ? ['--auto'] : []), '--format', 'json']);
  expect(r.status, r.stderr).toBe(0);
  return (JSON.parse(r.stdout) as { data: Record<string, unknown> }).data;
}

function shape(data: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v]));
}

describe('S19 next --auto 带 --env（module-scoped-env-smoke 切片1）', () => {
  it('UT-S19-81: ready-to-smoke 时 DEPLOY_DONE 合法且 environment 非空 → openlogos smoke --env <env>；null / 旧空格式 / 不可读 → openlogos smoke', () => {
    const root = project('S1');
    expect(runCli(root, ['deploy-done', '--env', 'test', '--format', 'json']).status).toBe(0);
    const marker = join(root, 'logos', 'changes', SLUG, 'DEPLOY_DONE');
    const valid = JSON.parse(readFileSync(marker, 'utf-8')) as Record<string, unknown>;
    expect(valid.environment).toBe('test');

    const withEnv = nextData(root, true);
    expect(withEnv.proposal_step).toBe('ready-to-smoke');
    expect(withEnv.auto_execute).toBe(true);
    expect(withEnv.command).toBe('openlogos smoke --env test');
    const mod = (withEnv.modules as Array<Record<string, unknown>>).find(m => m.active_change === SLUG)!;
    expect(mod.command).toBe('openlogos smoke --env test');

    const variants: Array<[string, () => void]> = [
      ['environment=null', () => writeFileSync(marker, `${JSON.stringify({ ...valid, environment: null })}\n`)],
      ['0 字节旧格式', () => writeFileSync(marker, '')],
      ['不可读', () => { rmSync(marker); mkdirSync(marker); }],
    ];
    for (const [label, apply] of variants) {
      apply();
      const data = nextData(root, true);
      expect(data.proposal_step, label).toBe('ready-to-smoke');
      expect(data.auto_execute, label).toBe(true);
      expect(data.command, label).toBe('openlogos smoke');
      // 字段集合与类型不变
      expect(shape(data), label).toEqual(shape(withEnv));
    }

    // 不传 --auto 不输出 auto_execute
    rmSync(marker, { recursive: true, force: true });
    writeFileSync(marker, `${JSON.stringify(valid)}\n`);
    const plain = nextData(root, false);
    expect(plain.proposal_step).toBe('ready-to-smoke');
    expect('auto_execute' in plain).toBe(false);
    expect(plain.command).toBeNull();
  }, 120_000);

  it('ST-S19-31: 未启用项目（S1、M0）deploy-done / smoke / next 与零回归基准逐字节相同；next --auto 带 --env 且照此命令执行成功', () => {
    const baseline = readJson(MES_BASELINE_FILE) as { runs: Record<string, Record<string, CliRun>> };
    for (const kind of ['S1', 'M0'] as const) {
      // ① 零回归：除 ready-to-smoke 的 next --auto 命令文本带上 --env 外，逐字节一致
      const runs = zeroRegressionRun(project(kind));
      const expected = baseline.runs[kind];
      expect(Object.keys(runs), kind).toEqual(Object.keys(expected));
      for (const [step, run] of Object.entries(runs)) {
        if (step === 'next-auto-ready-to-smoke') {
          expect(run.stdout, kind).toContain('"command":"openlogos smoke --env test"');
          expect({ ...run, stdout: run.stdout.split('openlogos smoke --env test').join('openlogos smoke') }, `${kind} ${step}`).toEqual(expected[step]);
        } else {
          // smoke-manual-acceptance（§2.107.13）：剥离值为默认的 data.manual_acceptance 后逐字比对
          expect(stripDefaultManualAcceptanceFromRun(run, `${kind} ${step}`), `${kind} ${step}`).toEqual(expected[step]);
        }
      }
      expect(runs.smoke.stdout, kind).not.toContain('"scope"');

      // ② ready-to-smoke 时照 next --auto 给出的命令执行 smoke，成功
      const root = project(kind);
      expect(runCli(root, ['deploy-done', '--env', 'test', '--format', 'json']).status).toBe(0);
      const data = nextData(root, true);
      expect(data.auto_execute).toBe(true);
      expect(data.command).toBe('openlogos smoke --env test');
      const [bin, ...args] = String(data.command).split(' ');
      expect(bin).toBe('openlogos');
      const smoke = runCli(root, [...args, '--format', 'json']);
      expect(smoke.status, smoke.stderr).toBe(0);
      const out = JSON.parse(smoke.stdout) as { data: { environment: string; gate: { result: string } } };
      expect(out.data.environment).toBe('test');
      expect(out.data.gate.result).toBe('PASS');
    }
  }, 300_000);
});
