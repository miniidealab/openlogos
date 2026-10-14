/**
 * environment-registry 切片 2：status 环境视图（S11）。
 *
 * 覆盖 UT-S11-96～UT-S11-100、ST-S11-52（logos/resources/test/core-S11-test-cases.md「S11 status 环境视图测试」）。
 * 规范源：spec/environments.md §5.4、§7.3；spec/cli-json-output.md「deploy-done / smoke / status 环境字段」。
 * 全部在一次性临时项目中构造；UT 进程内调用 status，ST 走真实 CLI 入口 cli/dist/index.js。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd } from './helpers.js';
import { status } from '../src/commands/status.js';
import { DEPLOY_LEDGER_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const R0 = '0'.repeat(40);
const R1 = '1'.repeat(40);
const R2 = '2'.repeat(40);

let root: string;
let cleanup: () => void;

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  scaffoldProject(root);
});
afterEach(() => cleanup());

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

const REGISTRY = 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test}\n  - {id: prod, name: Production, tier: prod}\n';

function deploy(env: string, ref: string | null, id: string): Record<string, unknown> {
  return {
    kind: 'deploy', environment: env, slug: 'chg', recorded_at: `2026-10-14T00:00:00.000Z`, observed_head: R0,
    observed_dirty: false, deploy_id: id, ref, ref_source: ref === null ? 'unknown' : 'explicit', result: 'done',
  };
}

function smoke(env: string, ref: string | null, id: string, verified: boolean): Record<string, unknown> {
  return {
    kind: 'smoke', environment: env, slug: 'chg', recorded_at: '2026-10-14T00:05:00.000Z', observed_head: R0,
    observed_dirty: false, deploy_id: id, ref, result: 'pass', env_evidence: 'declared', fresh_results: true,
    deploy_env_confirmed: true, verified,
  };
}

function ledger(lines: Array<Record<string, unknown> | string>): void {
  put(DEPLOY_LEDGER_REL, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

function statusOutput(format: 'json' | 'text'): string {
  const restoreCwd = mockCwd(root);
  const con = captureConsole();
  try {
    status(format);
  } finally {
    con.restore();
    restoreCwd();
  }
  return con.logs.join('\n');
}

function statusJson(): Record<string, any> {
  return JSON.parse(statusOutput('json'));
}

/** 去掉易变的 envelope 时间戳后比较。 */
const stable = (out: string) => out.replace(/"timestamp":"[^"]+"/g, '"timestamp":"<ts>"');

describe('S11 status 环境视图 — 单元测试', () => {
  it('UT-S11-96: 有登记表时输出环境视图', () => {
    put(ENV_REGISTRY_REL, REGISTRY);
    ledger([deploy('test', R1, 'd1'), smoke('test', R1, 'd1', true)]);
    const env = statusJson();
    expect(env.data.environments).toEqual([
      {
        id: 'test', name: 'Test', tier: 'test', current_ref: R1,
        last_deploy: { deploy_id: 'd1', slug: 'chg', ref: R1, ref_source: 'explicit', observed_head: R0, observed_dirty: false, recorded_at: '2026-10-14T00:00:00.000Z' },
        last_smoke: {
          deploy_id: 'd1', slug: 'chg', ref: R1, result: 'pass', env_evidence: 'declared', fresh_results: true,
          deploy_env_confirmed: true, verified: true, observed_head: R0, recorded_at: '2026-10-14T00:05:00.000Z',
        },
      },
      { id: 'prod', name: 'Production', tier: 'prod', current_ref: null, last_deploy: null, last_smoke: null },
    ]);
    expect(env.data.environment_ledger).toEqual({ path: DEPLOY_LEDGER_REL, corrupt_lines: 0 });
    expect(env.data).not.toHaveProperty('environment_registry_error');
  });

  it('UT-S11-97: 无登记表时输出逐字不变', () => {
    // 基线：同一项目、无登记表、无账本
    const baseJson = stable(statusOutput('json'));
    const baseText = statusOutput('text');
    // 本机账本存在若干记录（但未启用登记表）
    ledger([deploy('test', R1, 'd1'), smoke('test', R1, 'd1', true), deploy('prod', R2, 'd2')]);
    const json = stable(statusOutput('json'));
    const text = statusOutput('text');
    expect(json).toBe(baseJson);
    expect(text).toBe(baseText);
    const data = JSON.parse(json).data;
    for (const key of ['environments', 'environment_ledger', 'environment_registry_error']) {
      expect(data, key).not.toHaveProperty(key);
    }
  });

  it('UT-S11-98: 低频环境不被大量记录隔开', () => {
    put(ENV_REGISTRY_REL, REGISTRY);
    const lines: Array<Record<string, unknown>> = [deploy('prod', R0, 'p0'), smoke('prod', R0, 'p0', true)];
    for (let i = 0; i < 1001; i += 1) lines.push(deploy('test', R2, `t${i}`));
    ledger(lines);
    const prod = statusJson().data.environments.find((e: any) => e.id === 'prod');
    expect(prod.current_ref).toBe(R0);
    expect(prod.last_deploy.deploy_id).toBe('p0');
    expect(prod.last_smoke.deploy_id).toBe('p0');
  });

  it('UT-S11-99: 登记表非法与账本非法行不崩溃、不覆盖有效状态', () => {
    // ① 登记表为非法 YAML：命令正常完成，退出码与无登记表时相同
    put(ENV_REGISTRY_REL, 'schema_version: 1\nenvironments: [\n');
    const prevExit = process.exitCode;
    const bad = statusJson();
    expect(process.exitCode).toBe(prevExit);
    expect(bad.data.environments).toEqual([]);
    expect(bad.data.environment_registry_error.code).toBe('ENV_REGISTRY_INVALID');
    expect(typeof bad.data.environment_registry_error.message).toBe('string');

    // ② 登记表合法，账本为 prod 合法 deploy 后跟 3 条非法行
    put(ENV_REGISTRY_REL, REGISTRY);
    ledger([
      deploy('prod', R1, 'p1'),
      'not json',
      JSON.stringify({ kind: 'deploy', environment: 'prod' }),
      JSON.stringify({ ...smoke('prod', R1, 'p1', true), verified: false }),
    ]);
    const ok = statusJson();
    expect(ok.data).not.toHaveProperty('environment_registry_error');
    expect(ok.data.environment_ledger.corrupt_lines).toBe(3);
    const prod = ok.data.environments.find((e: any) => e.id === 'prod');
    expect(typeof prod.current_ref).toBe('string');
    expect(prod.current_ref).toBe(R1);
    expect(prod.last_deploy.deploy_id).toBe('p1');
    expect(prod.last_smoke).toBeNull();
  });

  it('UT-S11-100: status 不发起网络请求', async () => {
    let requests = 0;
    const server: Server = createServer((_req, res) => { requests += 1; res.end('ok'); });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      put(ENV_REGISTRY_REL, `schema_version: 1
environments:
  - {id: prod, name: P, tier: prod, health: "http://127.0.0.1:${port}/healthz", version: "http://127.0.0.1:${port}/version"}
`);
      const data = statusJson().data;
      expect(data.environments.map((e: any) => e.id)).toEqual(['prod']);
      await new Promise(r => setTimeout(r, 200));
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

describe('S11 status 环境视图 — 场景测试', () => {
  it('ST-S11-52: status 与 env list 同源一致', () => {
    put(ENV_REGISTRY_REL, REGISTRY);
    ledger([
      deploy('test', R1, 't1'), smoke('test', R1, 't1', true),
      deploy('prod', R2, 'p1'), smoke('prod', R2, 'p1', true),
      '{"kind":"deploy"',
    ]);
    const run = (args: string[]) => {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf-8', timeout: 60_000 });
      expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(0);
      return JSON.parse(r.stdout).data;
    };
    const st = run(['status', '--format', 'json']);
    const list = run(['env', 'list', '--format', 'json']);
    expect(st.environments.map((e: any) => e.id)).toEqual(['test', 'prod']);
    for (const env of list.environments) {
      const mine = st.environments.find((e: any) => e.id === env.id);
      expect(mine, env.id).toBeDefined();
      for (const key of ['current_ref', 'last_deploy', 'last_smoke'] as const) {
        expect(mine[key], `${env.id}.${key}`).toEqual(env[key]);
      }
    }
    expect(st.environment_ledger.corrupt_lines).toBe(1);
    expect(st.environment_ledger).toEqual(list.ledger);
    rmSync(join(root, DEPLOY_LEDGER_REL));
  }, 120_000);
});
