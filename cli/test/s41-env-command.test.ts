/**
 * environment-registry 切片 1：env 命令真实 CLI 合同与登记表 guard 内置默认豁免（S41 场景测试）。
 *
 * 覆盖 ST-S41-01、ST-S41-03（logos/resources/test/core-S41-test-cases.md）。规范源：spec/environments.md、
 * spec/cli-json-output.md「`openlogos env list|show|check --format json`」、spec/pretooluse-guard.md「guard.exempt 与内置默认」。
 * - ST-S41-01 走真实 CLI 入口 cli/dist/index.js，一次性临时项目。
 * - ST-S41-03 走真实 hook 脚本 plugin/bin/guard-check 与事后检查引擎 plugin/bin/guard-post-check.cjs。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeTempRoot } from './helpers.js';
import { GUARD_SRC, buildProject, cleanEnv, git, runGuard } from './s09-guard-vcs-fixtures.js';
import { chain } from './s09-guard-post-check-helpers.js';
import { DEPLOY_LEDGER_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const TIMEOUT = 120_000;
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return root;
}

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function cli(root: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf-8', env: cleanEnv(), timeout: 60_000 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const R1 = 'a'.repeat(40);
const R2 = 'b'.repeat(40);

function deployLine(env: string, ref: string | null, id: string, at: string): string {
  return JSON.stringify({
    kind: 'deploy', environment: env, slug: 'chg', recorded_at: at, observed_head: R1, observed_dirty: false,
    deploy_id: id, ref, ref_source: ref === null ? 'unknown' : 'explicit', result: 'done',
  });
}

function smokeLine(env: string, ref: string, id: string, at: string): string {
  return JSON.stringify({
    kind: 'smoke', environment: env, slug: 'chg', recorded_at: at, observed_head: R2, observed_dirty: false,
    deploy_id: id, ref, result: 'pass', env_evidence: 'declared', fresh_results: true, deploy_env_confirmed: true, verified: true,
  });
}

const isStrOrNull = (v: unknown) => v === null || typeof v === 'string';

describe('S41 env 命令 — 场景', () => {
  it('ST-S41-01: env 命令 JSON 合同与无登记表行为', () => {
    const root = tempRoot();
    put(root, 'logos/logos.config.json', JSON.stringify({ name: 't', locale: 'en' }));

    // ① 无登记表
    const list0 = cli(root, ['env', 'list', '--format', 'json']);
    expect(list0.status).toBe(0);
    const l0 = JSON.parse(list0.stdout);
    expect(l0.command).toBe('env list');
    expect(l0.data).toMatchObject({ registry_path: ENV_REGISTRY_REL, registry_present: false, environments: [], warnings: [] });
    expect(l0.data.ledger).toEqual({ path: DEPLOY_LEDGER_REL, corrupt_lines: 0 });
    for (const sub of [['show', 'prod'], ['check']]) {
      const r = cli(root, ['env', ...sub, '--format', 'json']);
      expect(r.status, sub.join(' ')).toBe(1);
      expect(JSON.parse(r.stderr).error.code, sub.join(' ')).toBe('ENV_REGISTRY_NOT_FOUND');
    }

    // ② 合法登记表 + 账本（含 25 条 test 记录与 1 条损坏行）
    put(root, ENV_REGISTRY_REL, `schema_version: 1
environments:
  - id: test
    name: Test
    tier: test
    aliases: [测试]
  - id: prod
    name: Production
    tier: prod
    health: https://prod.example.com/healthz
`);
    const lines = [deployLine('prod', R1, 'p1', '2026-10-14T01:00:00.000Z'), smokeLine('prod', R1, 'p1', '2026-10-14T01:05:00.000Z'), '{broken'];
    for (let i = 0; i < 25; i += 1) lines.push(deployLine('test', i === 24 ? null : R2, `t${i}`, `2026-10-14T02:${String(i).padStart(2, '0')}:00.000Z`));
    put(root, DEPLOY_LEDGER_REL, `${lines.join('\n')}\n`);

    const list = JSON.parse(cli(root, ['env', 'list', '--format', 'json']).stdout).data;
    expect(list.registry_present).toBe(true);
    expect(list.ledger).toEqual({ path: DEPLOY_LEDGER_REL, corrupt_lines: 1 });
    expect(list.environments.map((e: any) => e.id)).toEqual(['test', 'prod']);
    for (const e of list.environments) {
      expect(Object.keys(e).sort()).toEqual(['aliases', 'current_ref', 'id', 'last_deploy', 'last_smoke', 'name', 'tier']);
      expect(isStrOrNull(e.current_ref)).toBe(true);
    }
    const prod = list.environments.find((e: any) => e.id === 'prod');
    expect(prod.current_ref).toBe(R1);
    expect(Object.keys(prod.last_deploy).sort()).toEqual(['deploy_id', 'observed_dirty', 'observed_head', 'recorded_at', 'ref', 'ref_source', 'slug']);
    expect(Object.keys(prod.last_smoke).sort()).toEqual([
      'deploy_env_confirmed', 'deploy_id', 'env_evidence', 'fresh_results', 'observed_head', 'recorded_at', 'ref', 'result', 'slug', 'verified',
    ]);
    expect(prod.last_smoke.verified).toBe(true);
    const test = list.environments.find((e: any) => e.id === 'test');
    expect(test.current_ref, '最近一次部署版本未知').toBeNull();
    expect(test.last_deploy.deploy_id).toBe('t24');
    expect(test.last_smoke).toBeNull();

    const show = cli(root, ['env', 'show', '测试', '--format', 'json']);
    expect(show.status).toBe(0);
    const s = JSON.parse(show.stdout).data;
    expect(s.environment).toEqual({ id: 'test', name: 'Test', tier: 'test', aliases: ['测试'], description: null, health: null, version: null, secrets: [] });
    expect(s.history).toHaveLength(20);
    expect(s.history[0]).toMatchObject({ kind: 'deploy', deploy_id: 't24' });
    expect(s.history[19]).toMatchObject({ kind: 'deploy', deploy_id: 't5' });
    expect(s.ledger.corrupt_lines).toBe(1);

    const unknown = cli(root, ['env', 'show', 'staging', '--format', 'json']);
    expect(unknown.status).toBe(1);
    expect(JSON.parse(unknown.stderr).error.code).toBe('ENV_UNKNOWN');

    const check = cli(root, ['env', 'check', '--format', 'json']);
    expect(check.status).toBe(0);
    const c = JSON.parse(check.stdout).data;
    expect(c).toEqual({ scope: null, ok: true, errors: [], warnings: [], secrets: [], probes: [] });

    // 文本模式可用
    const text = cli(root, ['env', 'list']);
    expect(text.status).toBe(0);
    expect(text.stdout).toContain('prod');
  }, TIMEOUT);

  it('ST-S41-03: 登记表的 guard 内置默认豁免', () => {
    // A：guard.exempt 缺省——Write 与 Bash 写登记表均放行，事后检查不报警
    const a = buildProject(tempRoot(), 'G-repo');
    expect(existsSync(join(a, 'logos/.openlogos-guard')), '无活跃提案').toBe(false);
    const cfgA = JSON.parse(readFileSync(join(a, 'logos/logos.config.json'), 'utf-8'));
    expect(cfgA.guard?.exempt, '缺省 guard.exempt').toBeUndefined();
    const yaml = 'schema_version: 1\nenvironments:\n  - {id: test, name: T, tier: test}\n';
    const write = runGuard(GUARD_SRC, a, 'Write', { file_path: join(a, ENV_REGISTRY_REL), content: yaml });
    expect(write.exitCode, `Write 放行：${write.stderr}`).toBe(0);
    put(a, ENV_REGISTRY_REL, yaml);
    expect(git(a, ['add', ENV_REGISTRY_REL]).status).toBe(0);
    expect(git(a, ['commit', '-qm', 'registry']).status).toBe(0);
    const edit = runGuard(GUARD_SRC, a, 'Edit', { file_path: join(a, ENV_REGISTRY_REL), old_string: 'T', new_string: 'Test' });
    expect(edit.exitCode, 'Edit 放行').toBe(0);
    const bashWrite = chain(a, `printf 'schema_version: 1\\nenvironments: []\\n' > ${ENV_REGISTRY_REL}`);
    expect(bashWrite.pre.exitCode, 'Bash 事前放行').toBe(0);
    expect(bashWrite.post?.exitCode, `事后检查不报警：${bashWrite.post?.stderr}`).toBe(0);
    expect(bashWrite.post?.stderr ?? '').not.toContain(ENV_REGISTRY_REL);
    // 对照：同目录下的相邻文件仍受保护（只匹配该单个文件）
    const sibling = runGuard(GUARD_SRC, a, 'Write', { file_path: join(a, 'logos/environments.yml'), content: 'x' });
    expect(sibling.exitCode, 'logos/environments.yml 不命中豁免').toBe(2);

    // B：显式 guard.exempt 不含该路径——受保护；经保护范围命令添加后与 A 相同
    const b = buildProject(tempRoot(), 'G-repo');
    const cfgPath = join(b, 'logos/logos.config.json');
    const cfgB = JSON.parse(readFileSync(cfgPath, 'utf-8'));
    cfgB.guard = { exempt: ['logos/resources/reference/'] };
    writeFileSync(cfgPath, JSON.stringify(cfgB, null, 2));
    const blocked = runGuard(GUARD_SRC, b, 'Write', { file_path: join(b, ENV_REGISTRY_REL), content: yaml });
    expect(blocked.exitCode, '显式 exempt 不含时受保护').toBe(2);
    const add = cli(b, ['exempt', 'add', ENV_REGISTRY_REL]);
    expect(add.status, add.stderr).toBe(0);
    expect(JSON.parse(readFileSync(cfgPath, 'utf-8')).guard.exempt).toEqual(['logos/resources/reference/', ENV_REGISTRY_REL]);
    const allowed = runGuard(GUARD_SRC, b, 'Write', { file_path: join(b, ENV_REGISTRY_REL), content: yaml });
    expect(allowed.exitCode, '添加后放行').toBe(0);
  }, TIMEOUT);
});
