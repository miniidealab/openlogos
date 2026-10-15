/**
 * environment-registry 切片 1：环境登记表、--env 解析、账本读取与 env check（S41 单元测试）。
 *
 * 覆盖 UT-S41-01～UT-S41-10（logos/resources/test/core-S41-test-cases.md）。规范源：spec/environments.md。
 * 全部在一次性临时项目中构造；env 命令以进程内调用驱动（传入临时根目录），不触碰本仓登记表与账本。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { makeTempRoot, captureConsole, takeExitCode } from './helpers.js';
import {
  DEPLOY_LEDGER_REL, ENV_REGISTRY_REL, buildEnvView, computeVerified, loadEnvironmentRegistry, readDeploymentLedger,
  resolveEnvironment,
} from '../src/lib/environments.js';
import { envCheck } from '../src/commands/env.js';

const R0 = '0'.repeat(40);
const R1 = '1'.repeat(40);
const R2 = '2'.repeat(40);

let root: string;
let cleanup: () => void;

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  mkdirSync(join(root, 'logos'), { recursive: true });
  writeFileSync(join(root, 'logos/logos.config.json'), JSON.stringify({ name: 't', locale: 'en' }));
});
afterEach(() => cleanup());

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function registry(yaml: string): void {
  put(ENV_REGISTRY_REL, yaml);
}

const VALID = `schema_version: 1
environments:
  - id: test
    name: Test
    tier: test
    aliases: [测试, QA]
    description: shared test
    health: https://test.example.com/healthz
    version: https://test.example.com/version
    secrets: [TEST_TOKEN]
  - id: prod
    name: Production
    tier: prod
`;

function deploy(env: string, ref: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'deploy', environment: env, slug: 'chg', recorded_at: '2026-10-14T00:00:00.000Z',
    observed_head: R0, observed_dirty: false, deploy_id: `d-${env}-${ref ?? 'null'}`, ref,
    ref_source: ref === null ? 'unknown' : 'explicit', result: 'done', ...extra,
  };
}

function smokeRec(env: string, ref: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    kind: 'smoke', environment: env, slug: 'chg', recorded_at: '2026-10-14T00:05:00.000Z',
    observed_head: R0, observed_dirty: false, deploy_id: `d-${env}`, ref, result: 'pass',
    env_evidence: 'declared', fresh_results: true, deploy_env_confirmed: true, ...extra,
  } as Record<string, unknown>;
  if (!('verified' in extra)) {
    base.verified = computeVerified(base as unknown as Parameters<typeof computeVerified>[0]);
  }
  return base;
}

function ledger(lines: Array<Record<string, unknown> | string>): void {
  put(DEPLOY_LEDGER_REL, lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n');
}

function loaded() {
  const reg = loadEnvironmentRegistry(root);
  if (reg.state !== 'loaded') throw new Error(`registry not loaded: ${reg.state}`);
  return reg;
}

describe('S41 环境登记表与账本 — 单元测试', () => {
  it('UT-S41-01: 合法登记表解析', () => {
    registry(VALID);
    const reg = loaded();
    expect(reg.errors).toEqual([]);
    expect(reg.warnings).toEqual([]);
    expect(reg.environments).toEqual([
      {
        id: 'test', name: 'Test', tier: 'test', aliases: ['测试', 'QA'], description: 'shared test',
        health: 'https://test.example.com/healthz', version: 'https://test.example.com/version', secrets: ['TEST_TOKEN'],
      },
      { id: 'prod', name: 'Production', tier: 'prod', aliases: [], description: null, health: null, version: null, secrets: [] },
    ]);
  });

  it('UT-S41-02: 字段非法逐条点名', () => {
    const cases: Array<[string, string]> = [
      ['  - id: Test_1\n    name: x\n    tier: test\n', 'id'],
      ['  - id: a\n    tier: test\n', 'name'],
      ['  - id: a\n    name: x\n    tier: qa\n', 'tier'],
      ['  - id: a\n    name: x\n    tier: test\n    health: ftp://example.com/h\n', 'health'],
      ['  - id: a\n    name: x\n    tier: test\n    secrets: [MY-TOKEN]\n', 'secrets'],
    ];
    for (const [item, field] of cases) {
      registry(`schema_version: 1\nenvironments:\n${item}`);
      const reg = loaded();
      expect(reg.errors.map(e => [e.code, e.field]), field).toEqual([['ENV_FIELD_INVALID', field]]);
      expect(reg.errors[0].environment, field).toBeDefined();
    }
    registry('schema_version: 2\nenvironments: []\n');
    const v2 = loadEnvironmentRegistry(root);
    expect(v2.state).toBe('unloadable');
    expect(v2.state === 'unloadable' && v2.error.code).toBe('ENV_REGISTRY_INVALID');
    expect(v2.state === 'unloadable' && v2.error.field).toBe('schema_version');
  });

  it('UT-S41-03: id / alias 不区分大小写冲突', () => {
    registry('schema_version: 1\nenvironments:\n  - {id: prod, name: a, tier: prod}\n  - {id: prod, name: b, tier: prod}\n');
    expect(loaded().errors.map(e => [e.code, e.value])).toEqual([['ENV_DUPLICATE_ID_OR_ALIAS', 'prod']]);
    registry('schema_version: 1\nenvironments:\n  - {id: prod, name: a, tier: prod}\n  - {id: live, name: b, tier: prod, aliases: [Prod]}\n');
    expect(loaded().errors.map(e => [e.code, e.value])).toEqual([['ENV_DUPLICATE_ID_OR_ALIAS', 'Prod']]);
    registry('schema_version: 1\nenvironments:\n  - {id: a, name: a, tier: test, aliases: [测试]}\n  - {id: b, name: b, tier: test, aliases: [测试]}\n');
    expect(loaded().errors.map(e => [e.code, e.value])).toEqual([['ENV_DUPLICATE_ID_OR_ALIAS', '测试']]);
  });

  it('UT-S41-04: 未知字段只警告', () => {
    // promote_from / require_approval 自 environment-promotion-approval 起为受校验字段（UT-S41-16），样例改用 owner_team
    registry('schema_version: 1\nowner: team\nenvironments:\n  - {id: prod, name: P, tier: prod, owner_team: ops}\n');
    const reg = loaded();
    expect(reg.errors).toEqual([]);
    expect(reg.environments.map(e => e.id)).toEqual(['prod']);
    expect(reg.warnings.map(w => [w.code, w.field])).toEqual([['ENV_UNKNOWN_FIELD', 'owner'], ['ENV_UNKNOWN_FIELD', 'owner_team']]);
  });

  it('UT-S41-05: 环境解析顺序与失败', () => {
    registry(VALID);
    const envs = loaded().environments;
    expect(resolveEnvironment(envs, 'TEST')).toEqual({ ok: true, id: 'test' });
    expect(resolveEnvironment(envs, 'qa')).toEqual({ ok: true, id: 'test' });
    expect(resolveEnvironment(envs, '测试')).toEqual({ ok: true, id: 'test' });
    expect(resolveEnvironment(envs, 'staging')).toEqual({ ok: false, available: ['test', 'prod'] });
    // id 优先于 alias：别名与另一环境 id 同名属冲突（UT-S41-03），解析侧以 id 命中为准
    expect(resolveEnvironment(envs, 'prod')).toEqual({ ok: true, id: 'prod' });
  });

  it('UT-S41-06: 账本完整流式扫描与按环境聚合', () => {
    registry(VALID);
    const lines: Array<Record<string, unknown>> = [deploy('prod', R1), smokeRec('prod', R1)];
    for (let i = 0; i < 1001; i += 1) lines.push(deploy('test', i % 2 === 0 ? R2 : R0, { deploy_id: `t-${i}` }));
    for (let i = 0; i < 25; i += 1) lines.push(deploy('staging', R2, { deploy_id: `s-${i}` }));
    ledger(lines);
    const snap = readDeploymentLedger(root);
    expect(snap.corruptLines).toBe(0);
    const prod = snap.byEnvironment.get('prod')!;
    expect(prod.lastDeploy?.deploy_id).toBe(`d-prod-${R1}`);
    expect(prod.lastSmoke?.ref).toBe(R1);
    expect(prod.history.map(h => h.kind)).toEqual(['smoke', 'deploy']);
    const test = snap.byEnvironment.get('test')!;
    expect(test.lastDeploy?.deploy_id).toBe('t-1000');
    expect(test.history).toHaveLength(20);
    expect(test.history[0].kind === 'deploy' && test.history[0].deploy_id).toBe('t-1000');
    expect(test.history[19].kind === 'deploy' && test.history[19].deploy_id).toBe('t-981');
    expect(snap.byEnvironment.get('staging')!.history).toHaveLength(20);
    const view = buildEnvView(loaded().environments.find(e => e.id === 'prod')!, snap);
    expect(view.current_ref).toBe(R1);
    expect(view.last_smoke?.verified).toBe(true);
  });

  it('UT-S41-07: 账本非法行整行跳过且不覆盖有效状态', () => {
    registry(VALID);
    const goodDeploy = deploy('prod', R1);
    const goodSmoke = smokeRec('prod', R1);
    const passing = smokeRec('prod', R1);
    ledger([
      goodDeploy,
      goodSmoke,
      'not json at all',
      '[1,2,3]',
      JSON.stringify({ environment: 'prod', slug: 'x' }),
      JSON.stringify({ ...goodDeploy, kind: 'rollback' }),
      JSON.stringify({ kind: 'deploy', environment: 'prod' }),
      JSON.stringify({ ...goodDeploy, ref: 42 }),
      JSON.stringify({ ...goodDeploy, ref: null, ref_source: 'explicit' }),
      JSON.stringify({ ...goodSmoke, verified: 'yes' }),
      JSON.stringify({ ...passing, verified: false }),
      JSON.stringify((({ fresh_results: _drop, ...rest }) => rest)(goodSmoke)),
      { ...deploy('test', R2), note: 'extra field is kept compatible' },
    ]);
    const snap = readDeploymentLedger(root);
    expect(snap.corruptLines).toBe(10);
    const prod = snap.byEnvironment.get('prod')!;
    expect(prod.lastDeploy).toEqual(goodDeploy);
    expect(prod.lastSmoke).toEqual(goodSmoke);
    expect(prod.history).toEqual([goodSmoke, goodDeploy]);
    const view = buildEnvView(loaded().environments.find(e => e.id === 'prod')!, snap);
    expect(typeof view.current_ref).toBe('string');
    expect(view.current_ref).toBe(R1);
    expect(snap.byEnvironment.get('test')?.lastDeploy?.ref).toBe(R2);
  });

  it('UT-S41-08: verified 判定真值表', () => {
    let trueCount = 0;
    let total = 0;
    for (const result of ['pass', 'fail']) {
      for (const env_evidence of ['declared', 'missing', 'mismatch']) {
        for (const fresh_results of [true, false]) {
          for (const deploy_env_confirmed of [true, false]) {
            for (const ref of [R1, null]) {
              total += 1;
              const v = computeVerified({ result, env_evidence, fresh_results, deploy_env_confirmed, ref });
              const expected = result === 'pass' && env_evidence === 'declared' && fresh_results && deploy_env_confirmed && ref !== null;
              expect(v, JSON.stringify({ result, env_evidence, fresh_results, deploy_env_confirmed, ref })).toBe(expected);
              if (v) trueCount += 1;
            }
          }
        }
      }
    }
    expect(total).toBe(48);
    expect(trueCount).toBe(1);
  });
});

describe('S41 env check — 单元测试', () => {
  const SECRET_VALUE = 's3cr3t-value';
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { TEST_TOKEN: process.env.TEST_TOKEN, PROD_TOKEN: process.env.PROD_TOKEN };
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function runCheck(input?: string, probe = false): Promise<{ out: string; err: string; exit: unknown; data: any }> {
    const con = captureConsole();
    try {
      await envCheck(input, { probe }, 'json', root);
    } finally {
      con.restore();
    }
    const out = con.logs.join('\n');
    const err = con.errors.join('\n');
    const exit = takeExitCode();
    const data = out ? JSON.parse(out).data : null;
    return { out, err, exit, data };
  }

  it('UT-S41-09: env check 引用与密钥检查', async () => {
    registry(`schema_version: 1
environments:
  - {id: test, name: T, tier: test, secrets: [TEST_TOKEN]}
  - {id: prod, name: P, tier: prod, secrets: [PROD_TOKEN]}
`);
    put('logos/logos-project.yaml', 'project:\n  name: t\ndeployment_gates:\n  core:\n    deployment_required: true\n    smoke_required: true\n    environments: [test, staging]\n');
    process.env.TEST_TOKEN = SECRET_VALUE;
    delete process.env.PROD_TOKEN;
    const r = await runCheck();
    expect(r.exit).toBe(1);
    expect(r.data.ok).toBe(false);
    expect(r.data.errors.map((e: any) => [e.code, e.value ?? e.name])).toEqual([
      ['ENV_GATE_REFERENCE_UNKNOWN', 'staging'],
      ['ENV_SECRET_MISSING', 'PROD_TOKEN'],
    ]);
    expect(r.data.secrets).toEqual([
      { environment: 'test', name: 'TEST_TOKEN', present: true },
      { environment: 'prod', name: 'PROD_TOKEN', present: false },
    ]);
    expect(r.data.probes).toEqual([]);
    expect(`${r.out}\n${r.err}`).not.toContain(SECRET_VALUE);
    // 文本输出同样不含密钥值
    const con = captureConsole();
    try { await envCheck(undefined, {}, 'text', root); } finally { con.restore(); }
    takeExitCode();
    expect([...con.logs, ...con.errors].join('\n')).not.toContain(SECRET_VALUE);
  });

  it('UT-S41-10: --probe 仅显式时联网', async () => {
    let requests = 0;
    const server: Server = createServer((req, res) => {
      requests += 1;
      if (req.url === '/slow') {
        setTimeout(() => { res.writeHead(200); res.end('late'); }, 6000);
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(req.url === '/version' ? '  1.4.2\n' : 'ok');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    try {
      registry(`schema_version: 1
environments:
  - {id: test, name: T, tier: test, aliases: [QA], health: "http://127.0.0.1:${port}/healthz", version: "http://127.0.0.1:${port}/version"}
  - {id: prod, name: P, tier: prod, health: "http://127.0.0.1:${port}/slow"}
`);
      const quiet = await runCheck();
      expect(quiet.exit).toBeUndefined();
      expect(quiet.data.ok).toBe(true);
      expect(quiet.data.probes).toEqual([]);
      expect(requests, '不加 --probe 不发起请求').toBe(0);

      const started = Date.now();
      const probed = await runCheck(undefined, true);
      const elapsed = Date.now() - started;
      expect(probed.exit).toBe(1);
      const byUrl = Object.fromEntries(probed.data.probes.map((p: any) => [p.url.split('/').pop(), p]));
      expect(byUrl.healthz).toMatchObject({ environment: 'test', kind: 'health', status: 200, ok: true, error: null });
      expect(byUrl.version).toMatchObject({ environment: 'test', kind: 'version', status: 200, ok: true, body_excerpt: '1.4.2' });
      expect(byUrl.slow).toMatchObject({ environment: 'prod', kind: 'health', status: null, ok: false });
      expect(byUrl.slow.error).toContain('timeout');
      expect(probed.data.errors.map((e: any) => [e.code, e.environment, e.kind])).toEqual([['ENV_PROBE_FAILED', 'prod', 'health']]);
      expect(elapsed, '约 5 秒超时').toBeGreaterThanOrEqual(4500);
      expect(elapsed).toBeLessThan(5900);

      // 限定范围：只探测 test
      const scoped = await runCheck('QA', true);
      expect(scoped.data.scope).toBe('test');
      expect(scoped.data.probes.map((p: any) => p.environment)).toEqual(['test', 'test']);
      expect(scoped.exit).toBeUndefined();
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }, 30_000);
});
