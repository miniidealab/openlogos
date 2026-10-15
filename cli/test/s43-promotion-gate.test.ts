/**
 * environment-promotion-approval 切片 3：晋级门、--force-promote 留痕越过、回滚与 dry-run 计划、agent 携带晋级身份（S43）。
 *
 * 覆盖 UT-S43-01、UT-S43-02、UT-S43-03、UT-S43-09、UT-S43-10、ST-S43-01、ST-S43-02（logos/resources/test/core-S43-test-cases.md）。
 * 规范源：spec/environments.md §12.3～§12.5；spec/cli-json-output.md「deploy / deploy-done / env / status 晋级与审批增量」，
 * 决策 C01、C03、C04、C07。一次性 git 项目：staging 与 prod 配置 deploy（脚本只向一次性发布目录写文件），prod 配置
 * promote_from: staging 与 require_approval: true。UT 中上游 smoke 记录直接写入账本构造；ST 以真实
 * `openlogos smoke --env staging`（runner 写 target_environment）产生。全部走真实 CLI 入口 cli/dist/index.js。
 * 结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot } from './helpers.js';
import { DEPLOY_LEDGER_REL, DEPLOY_PENDING_REL, ENV_REGISTRY_REL } from '../src/lib/environments.js';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');

/** 部署脚本：记录一次启动（环境与 deploy_id）。 */
const SCRIPT = `#!/bin/sh
mkdir -p "$PUBLISH_DIR"
echo "start $OPENLOGOS_DEPLOY_ENV $OPENLOGOS_DEPLOY_REF" >> "$PUBLISH_DIR/starts.txt"
`;
/** smoke runner：按 OPENLOGOS_SMOKE_ENV 写 target_environment。 */
const RUNNER = `
const fs = require('fs'); const path = require('path');
const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;
const out = 'logos/resources/verify/smoke-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
const rows = ['SMOKE-core-01', 'SMOKE-core-02'].map(id => ({ id, status: 'pass', timestamp: new Date().toISOString(), target_environment: env }));
fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\\n') + '\\n');
`;
const SCRIPT_CFG = { mode: 'script', script: 'deploy/run.sh' };
const AGENT_CFG = { mode: 'agent', plan_section: '生产部署' };

let root: string;
let cleanup: () => void;
let work: string;
let X: string;
let Y: string;

const publish = () => join(work, 'publish');
const starts = (): string[] => (existsSync(join(publish(), 'starts.txt')) ? readFileSync(join(publish(), 'starts.txt'), 'utf-8').trim().split('\n') : []);

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function registry(prodDeploy: Record<string, unknown> = SCRIPT_CFG): void {
  put(ENV_REGISTRY_REL, stringifyYaml({
    schema_version: 1,
    environments: [
      { id: 'test', name: 'Test', tier: 'test' },
      { id: 'staging', name: 'Staging', tier: 'staging', deploy: SCRIPT_CFG },
      { id: 'prod', name: 'Production', tier: 'prod', deploy: prodDeploy, promote_from: 'staging', require_approval: true },
    ],
  }, { lineWidth: 0 }));
}

/** 一次性项目：活跃提案不存在（版本通道）；smoke 配置 runner 与两条 smoke 用例。 */
function setup(prodDeploy: Record<string, unknown> = SCRIPT_CFG): void {
  ({ root, cleanup } = makeTempRoot());
  work = `${root}-work`;
  mkdirSync(work, { recursive: true });
  put('logos/logos.config.json', JSON.stringify({
    name: 'fixture', locale: 'en',
    documents: { test: { label: { en: 'Test' }, path: './resources/test', pattern: '**/*.md' } },
    smoke: { result_path: 'logos/resources/verify/smoke-results.jsonl', sandbox_mode: 'off', command: 'node tools/runner.js' },
  }, null, 2));
  put('logos/logos-project.yaml', [
    'modules:', '  - id: core', '    name: Core', '    lifecycle: launched',
    'deployment_gates:', '  core:', '    deployment_required: true', '    smoke_required: true', '',
  ].join('\n'));
  put('logos/resources/test/smoke/core-smoke-test-cases.md', '# Smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-01 | a |\n| SMOKE-core-02 | b |\n');
  put('tools/runner.js', RUNNER);
  registry(prodDeploy);
  put('.gitignore', `logos/.openlogos-runtime/\n${ENV_REGISTRY_REL}\nlogos/resources/verify/\n`);
  git(['init', '-q']);
  git(['config', 'user.name', 'Alice']);
  git(['config', 'user.email', 'alice@example.invalid']);
  const commit = (label: string) => {
    put('deploy/run.sh', `${SCRIPT}# ${label}\n`);
    chmodSync(join(root, 'deploy/run.sh'), 0o755);
    put('payload.txt', `${label}\n`);
    git(['add', '-A']);
    git(['commit', '-qm', label]);
    return git(['rev-parse', 'HEAD']);
  };
  X = commit('v1'); git(['tag', 'v1']);
  Y = commit('v2'); git(['tag', 'v2']);
  commit('head');
}

function teardown(): void {
  if (!cleanup) return;
  try { chmodSync(join(root, DEPLOY_PENDING_REL), 0o755); } catch { /* 目录不存在 */ }
  cleanup();
  rmSync(work, { recursive: true, force: true });
  cleanup = undefined as unknown as () => void;
}

let seq = 0;
function smokeRecord(env: string, ref: string, verified: boolean): Record<string, unknown> {
  return {
    kind: 'smoke', environment: env, slug: null, recorded_at: `2026-10-15T00:00:${String(++seq % 60).padStart(2, '0')}.000Z`,
    observed_head: ref, observed_dirty: false, deploy_id: `d-${seq}`, ref, result: 'pass',
    env_evidence: verified ? 'declared' : 'missing', fresh_results: true, deploy_env_confirmed: true, verified,
  };
}
function deployRecord(env: string, ref: string): Record<string, unknown> {
  return {
    kind: 'deploy', environment: env, slug: null, recorded_at: '2026-10-15T00:00:00.000Z', observed_head: ref, observed_dirty: false,
    deploy_id: `dep-${++seq}`, ref, ref_source: 'explicit', result: 'done', channel: 'version', mode: 'script', ref_input: 'v',
    ref_requested: ref, rollback: false, rollback_from: null, duration_ms: 1, ci_run_id: null, ci_run_url: null, ci_reported_ref: null,
    failure_reason: null, log_path: null, reconciled: false,
  };
}
const writeLedger = (rows: Array<Record<string, unknown>>) =>
  put(DEPLOY_LEDGER_REL, rows.length === 0 ? '' : `${rows.map(r => JSON.stringify(r)).join('\n')}\n`);

function cli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: root, encoding: 'utf-8', timeout: 120_000, env: { ...process.env, PUBLISH_DIR: publish(), OPENLOGOS_SMOKE_ENV: '' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function json(args: string[]): { status: number | null; data: any; error: any; stderr: string } {
  const r = cli([...args, '--format', 'json']);
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data; } catch { /* 失败路径无 stdout */ }
  try { error = JSON.parse(r.stderr).error; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, error, stderr: r.stderr };
}

function ledger(): Array<Record<string, any>> {
  const p = join(root, DEPLOY_LEDGER_REL);
  return existsSync(p) ? readFileSync(p, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}
const lastDeploy = (env = 'prod') => ledger().filter(r => r.kind === 'deploy' && r.environment === env).at(-1)!;

function envShow(env: string): any {
  const r = json(['env', 'show', env]);
  expect(r.status, r.stderr).toBe(0);
  return r.data;
}

function approveOk(ref: string): string {
  const r = json(['approve', '--env', 'prod', '--ref', ref]);
  expect(r.status, r.stderr).toBe(0);
  return r.data.approval_id;
}

function deployOk(args: string[]): any {
  const r = json(['deploy', ...args]);
  expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(0);
  return r.data;
}

/** 项目全部文件（含运行态目录，不含 .git）的 SHA-256 清单。 */
function treeHash(): string {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { out.push(`D ${p.slice(root.length)}`); walk(p); }
      else out.push(`F ${p.slice(root.length)} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
    }
  };
  walk(root);
  return out.join('\n');
}

/** 前置拒绝：给定错误码、零执行（发布目录无痕迹）、零写入（项目全部文件前后一致）。 */
function expectRejected(args: string[], code: string): any {
  const before = treeHash();
  const startsBefore = starts().length;
  const r = json(['deploy', ...args]);
  expect(r.status, `${args.join(' ')}: ${r.stderr}`).toBe(1);
  expect(r.error.code, args.join(' ')).toBe(code);
  expect(starts().length, `${args.join(' ')}：部署脚本未运行`).toBe(startsBefore);
  expect(treeHash(), `${args.join(' ')}：项目全部文件与运行态目录前后一致`).toBe(before);
  return r.error;
}

beforeEach(() => { seq = 0; });
afterEach(() => teardown());

describe('S43 晋级门与 --force-promote — 单元测试（environment-promotion-approval 切片 3）', () => {
  it('UT-S43-01: 晋级未验证零执行零写入', () => {
    setup();
    const cases: Array<[string, Array<Record<string, unknown>>, string | null, string | null]> = [
      ['① staging 对 X 无 smoke', [], null, null],
      ['② staging 只有对 X 的 verified=false', [deployRecord('staging', X), smokeRecord('staging', X, false)], X, null],
      ['③ staging 只有对 Y 的 verified=true', [deployRecord('staging', Y), smokeRecord('staging', Y, true)], Y, Y],
    ];
    for (const [label, rows, current, candidate] of cases) {
      writeLedger(rows);
      approveOk('v1'); // 审批不能替代晋级：晋级检查先于审批检查
      const error = expectRejected(['--env', 'prod', '--ref', 'v1'], 'DEPLOY_PROMOTION_UNVERIFIED');
      expect(error.details, label).toEqual({
        environment: 'prod', promote_from: 'staging', requested: X, upstream_current_ref: current, upstream_candidate_ref: candidate,
      });
    }
  }, 120_000);

  it('UT-S43-02: 上游曾验证即可晋级', () => {
    setup();
    // staging：X 已验证，之后部署并验证 Y（current_ref=Y）
    writeLedger([deployRecord('staging', X), smokeRecord('staging', X, true), deployRecord('staging', Y), smokeRecord('staging', Y, true)]);
    expect(envShow('staging').current_ref).toBe(Y);
    const A = approveOk('v1');
    const d = deployOk(['--env', 'prod', '--ref', 'v1']);
    expect(d).toMatchObject({ status: 'done', approval_id: A, promoted_from: 'staging', promotion_override_reason: null });
    expect(lastDeploy()).toMatchObject({ result: 'done', ref_requested: X, approval_id: A, promoted_from: 'staging', promotion_override_reason: null });
    expect(starts()).toEqual([`start prod ${X}`]);
  }, 120_000);

  it('UT-S43-03: --force-promote 留痕越过与参数冲突', () => {
    setup();
    writeLedger([]);
    const A = approveOk('v1');
    // ① 越过晋级检查并记录理由
    const d = deployOk(['--env', 'prod', '--ref', 'v1', '--force-promote', 'hotfix 已人工验证']);
    expect(d).toMatchObject({ approval_id: A, promoted_from: null, promotion_override_reason: 'hotfix 已人工验证' });
    expect(lastDeploy()).toMatchObject({ result: 'done', approval_id: A, promoted_from: null, promotion_override_reason: 'hotfix 已人工验证' });
    expect(starts().length).toBe(1);
    // ②～⑤ 参数冲突，零执行
    expectRejected(['--env', 'prod', '--ref', 'v1', '--force-promote', ''], 'DEPLOY_ARGS_CONFLICT');
    expectRejected(['--env', 'staging', '--ref', 'v1', '--force-promote', 'r'], 'DEPLOY_ARGS_CONFLICT');
    expectRejected(['--env', 'prod', '--rollback', '--force-promote', 'r'], 'DEPLOY_ARGS_CONFLICT');
    expectRejected(['--env', 'prod', '--reconcile', '--force-promote', 'r'], 'DEPLOY_ARGS_CONFLICT');
    expectRejected(['--env', 'prod', '--ref', 'v1', '--force-promote'], 'DEPLOY_ARGS_CONFLICT');
  }, 120_000);

  it('UT-S43-09: 回滚与 dry-run', () => {
    setup();
    // staging 只验证过 R2（Y）：R1 以 --force-promote 部署、R2 经晋级部署，两次都经审批
    writeLedger([deployRecord('staging', Y), smokeRecord('staging', Y, true)]);
    approveOk('v1');
    deployOk(['--env', 'prod', '--ref', 'v1', '--force-promote', 'R1 首发']);
    approveOk('v2');
    expect(deployOk(['--env', 'prod', '--ref', 'v2']).promoted_from).toBe('staging');
    expect(envShow('prod')).toMatchObject({ current_ref: Y, open_approvals: [] });

    // ① 回滚不做晋级检查（R1 上游未验证），但仍要求审批
    const e = expectRejected(['--env', 'prod', '--rollback'], 'DEPLOY_APPROVAL_REQUIRED');
    expect(e.details).toEqual({ environment: 'prod', requested: X, approve_command: `openlogos approve --env prod --ref ${X}` });
    // ② 对 R1 审批后回滚成功
    const R = approveOk(X);
    const rb = deployOk(['--env', 'prod', '--rollback']);
    expect(rb).toMatchObject({ rollback: true, rollback_from: Y, ref_requested: X, approval_id: R, promoted_from: null, promotion_override_reason: null });
    expect(envShow('prod').current_ref).toBe(X);
    teardown();

    // ③ 未审批时 dry-run：DEPLOY_APPROVAL_REQUIRED、零写入
    setup();
    writeLedger([deployRecord('staging', X), smokeRecord('staging', X, true)]);
    expectRejected(['--env', 'prod', '--ref', 'v1', '--dry-run'], 'DEPLOY_APPROVAL_REQUIRED');
    // ④ 已审批时 dry-run：plan 给出 approval_id 与 promotion，不写任何文件、不使用审批
    const A = approveOk('v1');
    const before = treeHash();
    const dry = json(['deploy', '--env', 'prod', '--ref', 'v1', '--dry-run']);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.data.status).toBe('dry-run');
    expect(dry.data.plan).toMatchObject({ approval_id: A, promotion: { from: 'staging', verified_ref: X } });
    expect(treeHash()).toBe(before);
    expect(starts()).toEqual([]);
    expect(envShow('prod').open_approvals.map((o: any) => o.approval_id)).toEqual([A]);
    // 越过时 plan.promotion 为 override_reason
    writeLedger(ledger().filter(r => r.kind === 'approval'));
    const over = json(['deploy', '--env', 'prod', '--ref', 'v1', '--dry-run', '--force-promote', '人工验证']);
    expect(over.status, over.stderr).toBe(0);
    expect(over.data.plan).toMatchObject({ approval_id: A, promotion: { override_reason: '人工验证' } });
  }, 180_000);

  it('UT-S43-10: agent 方式携带审批身份', () => {
    setup(AGENT_CFG);
    writeLedger([deployRecord('staging', X), smokeRecord('staging', X, true)]);
    const A = approveOk('v1');
    // ① 未审批、上游未验证的 Y：不登记未决记录
    const r1 = json(['deploy', '--env', 'prod', '--ref', 'v2']);
    expect(r1.status).toBe(1);
    expect(['DEPLOY_PROMOTION_UNVERIFIED', 'DEPLOY_APPROVAL_REQUIRED']).toContain(r1.error.code);
    expect(existsSync(join(root, DEPLOY_PENDING_REL, 'prod.json'))).toBe(false);
    // ② awaiting-agent，未决记录携带审批与晋级身份
    const aw = deployOk(['--env', 'prod', '--ref', 'v1']);
    expect(aw).toMatchObject({ status: 'awaiting-agent', approval_id: A, promoted_from: 'staging', promotion_override_reason: null });
    const pending = JSON.parse(readFileSync(join(root, DEPLOY_PENDING_REL, 'prod.json'), 'utf-8'));
    expect(pending).toMatchObject({ deploy_id: aw.deploy_id, approval_id: A, promoted_from: 'staging', promotion_override_reason: null });
    // ③ --complete 不重新检查：期间删除 staging 的 smoke 记录不影响
    writeLedger(ledger().filter(r => !(r.kind === 'smoke' && r.environment === 'staging')));
    const done = deployOk(['--env', 'prod', '--complete', aw.deploy_id, '--result', 'done']);
    expect(done).toMatchObject({ status: 'done', approval_id: A, promoted_from: 'staging' });
    expect(lastDeploy()).toMatchObject({ mode: 'agent', result: 'done', approval_id: A, promoted_from: 'staging', promotion_override_reason: null });
    expect(envShow('prod').open_approvals).toEqual([]);
  }, 120_000);
});

/** ST-S43-01 的操作序列（ST-S43-02 从其结束状态继续）。 */
function runPromotionChain(): void {
  // ① 上游未验证
  const e = json(['deploy', '--env', 'prod', '--ref', 'v1']);
  expect(e.status).toBe(1);
  expect(e.error.code).toBe('DEPLOY_PROMOTION_UNVERIFIED');
  expect(starts()).toEqual([]);
  // ② staging 部署并以真实 smoke 验证 v1
  deployOk(['--env', 'staging', '--ref', 'v1']);
  const sm = json(['smoke', '--env', 'staging']);
  expect(sm.status, sm.stderr).toBe(0);
  expect(ledger().filter(r => r.kind === 'smoke').at(-1)).toMatchObject({ environment: 'staging', ref: X, verified: true });
  // ③ 晋级检查通过但未审批
  const a = json(['deploy', '--env', 'prod', '--ref', 'v1']);
  expect(a.status).toBe(1);
  expect(a.error.code).toBe('DEPLOY_APPROVAL_REQUIRED');
  // ④ 审批；⑤ 部署成功
  const A = approveOk('v1');
  const d = deployOk(['--env', 'prod', '--ref', 'v1']);
  expect(d).toMatchObject({ status: 'done', approval_id: A, promoted_from: 'staging' });
  expect(lastDeploy()).toMatchObject({ approval_id: A, promoted_from: 'staging', ref: X });
  // ⑥ 视图
  expect(envShow('prod')).toMatchObject({ current_ref: X, open_approvals: [], promotion: { from: 'staging', candidate_ref: X } });
}

describe('S43 晋级与审批 — 场景测试（environment-promotion-approval 切片 3）', () => {
  it('ST-S43-01: staging → prod 晋级与审批全链路', () => {
    setup();
    runPromotionChain();
    expect(starts()).toEqual([`start staging ${X}`, `start prod ${X}`]);
  }, 180_000);

  it('ST-S43-02: 上游已前进时补发已验证版本', () => {
    setup();
    runPromotionChain();
    // ① staging 部署并验证 v2
    deployOk(['--env', 'staging', '--ref', 'v2']);
    expect(json(['smoke', '--env', 'staging']).status).toBe(0);
    expect(envShow('staging')).toMatchObject({ current_ref: Y });
    // ② prod 审批并部署 v2
    approveOk('v2');
    expect(deployOk(['--env', 'prod', '--ref', 'v2']).promoted_from).toBe('staging');
    expect(envShow('prod').current_ref).toBe(Y);
    // ③ 补发 v1：staging 曾验证 v1，晋级检查通过（不要求是上游当前版本）
    const A = approveOk('v1');
    const d = deployOk(['--env', 'prod', '--ref', 'v1']);
    expect(d).toMatchObject({ approval_id: A, promoted_from: 'staging', ref_requested: X });
    expect(envShow('prod')).toMatchObject({ current_ref: X, promotion: { from: 'staging', candidate_ref: Y } });
  }, 180_000);
});
