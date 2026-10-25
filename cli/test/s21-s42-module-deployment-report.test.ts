/**
 * S21 / S42 initial 模块的模块部署报告（module-scoped-phase-reports，功能规格 §2.99.2、§2.99.7，
 * spec/environments.md §14.9）。
 *
 * 夹具 MP（runlogos 形态）：一次性 git 项目，core（launched，环境 [prod]）、team（initial，环境
 * [team-prod, team-ci, team-agent, team-manual]）；登记表另有不属于任何模块的 shared-env。
 * team-prod / prod / shared-env 为 script 方式（tools/deploy.sh 以 $DEPLOY_EXIT 退出），team-ci 为 provider: script 的 ci 方式
 * （ci/status.sh 读 $CI_STATE：running → in_progress，否则 completed/success），team-agent 为 agent 方式，team-manual 未配置 deploy。
 * team 的 phase.3-0～3-5 产物齐全，并有 Gate PASS 的模块验收报告，便于用 status / launch 观察 phase.3-7。
 * CLI 用例走真实 dist 入口（global-setup 已构建）；需注入失败的用例在进程内调用 deploy / deployDone 并传测试钩子。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as stringifyYaml } from 'yaml';
import { captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { deploy } from '../src/commands/deploy.js';
import { deployDone } from '../src/commands/deploy-done.js';
import { collectStatusData } from '../src/commands/status.js';
import { buildInitialPhasePlan } from '../src/lib/flow-derive.js';

vi.setConfig({ testTimeout: 120_000 });

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.js');
const VERIFY = 'logos/resources/verify';
const TEAM_REPORT = `${VERIFY}/team-deployment-report.md`;
const SLUG = 'ship-it';
const PROPOSAL_REL = `logos/changes/${SLUG}`;
const LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
const SECTION = '团队部署';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function put(root: string, rel: string, content: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function git(root: string, args: string[]): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

interface Opts { proposalModule?: 'core' | 'team' | null; singleModule?: boolean }

function build(opts: Opts = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mdr-'));
  roots.push(root);
  const proposalModule = opts.proposalModule === undefined ? 'core' : opts.proposalModule;
  put(root, 'logos/logos.config.json', `${JSON.stringify({ name: 'mdr', locale: 'en', description: '', documents: {} }, null, 2)}\n`);
  const project = opts.singleModule
    ? { project: { name: 'mdr' }, modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }] }
    : {
      project: { name: 'mdr' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }, { id: 'team', name: 'Team', lifecycle: 'initial' }],
      deployment_gates: { core: { environments: ['prod'] }, team: { environments: ['team-prod', 'team-ci', 'team-agent', 'team-manual'] } },
      scenarios: [{ id: 'S60', name: 't', module: 'team' }],
    };
  put(root, 'logos/logos-project.yaml', stringifyYaml(project, { lineWidth: 0 }));
  const script = { mode: 'script', script: 'tools/deploy.sh', args: ['{env}', '{ref}'] };
  put(root, 'logos/environments.yaml', stringifyYaml({
    schema_version: 1,
    environments: [
      { id: 'prod', name: 'Prod', tier: 'prod', deploy: script },
      { id: 'team-prod', name: 'Team Prod', tier: 'prod', deploy: script },
      { id: 'team-ci', name: 'Team CI', tier: 'test', deploy: { mode: 'ci', provider: 'script', trigger_script: 'ci/trigger.sh', status_script: 'ci/status.sh', poll_interval_sec: 1, timeout_sec: 2 } },
      { id: 'team-agent', name: 'Team Agent', tier: 'test', deploy: { mode: 'agent', plan_section: SECTION } },
      { id: 'team-manual', name: 'Team Manual', tier: 'test' },
      { id: 'shared-env', name: 'Shared', tier: 'test', deploy: script },
      { id: 'test', name: 'Test', tier: 'test' },
    ],
  }));
  put(root, 'tools/deploy.sh', '#!/bin/sh\nexit ${DEPLOY_EXIT:-0}\n');
  put(root, 'ci/trigger.sh', '#!/bin/sh\necho \'{"run_id":"77","url":"https://ci.example/77"}\'\n');
  put(root, 'ci/status.sh', '#!/bin/sh\ns=$(cat "$CI_STATE" 2>/dev/null || echo success)\nif [ "$s" = running ]; then echo \'{"status":"in_progress"}\'; else echo "{\\"status\\":\\"completed\\",\\"conclusion\\":\\"success\\",\\"deployed_ref\\":\\"$OPENLOGOS_DEPLOY_REF\\"}"; fi\n');
  for (const f of ['tools/deploy.sh', 'ci/trigger.sh', 'ci/status.sh']) chmodSync(join(root, f), 0o755);
  put(root, 'logos/resources/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md', `# 部署方案\n\n## ${SECTION}\n\n1. 部署 team\n`);
  if (!opts.singleModule) {
    for (const item of buildInitialPhasePlan()) {
      if (['phase.3-6', 'phase.3-7-deploy', 'phase.3-8-smoke'].includes(item.phaseKey)) continue;
      if (item.phaseKey === 'phase.3-1') put(root, `${item.subpath}/team-S60-x.md`, 'x');
      else if (item.phaseKey === 'phase.3-4a') put(root, `${item.subpath}/team-S60-test-cases.md`, '| ID | d |\n|---|---|\n| UT-S60-01 | x |\n');
      else put(root, `${item.subpath}/team-x.md`, 'x');
    }
    put(root, `${VERIFY}/team-acceptance-report.md`, '# Acceptance Report\n\n## Summary\n\n| Metric | Value |\n|--------|-------|\n| Module | team |\n| **Gate 3.5** | **PASS** |\n');
  }
  put(root, `${VERIFY}/deployment-report.md`, '# Deployment Report\n\nok\n');
  if (proposalModule !== null) {
    put(root, `${PROPOSAL_REL}/proposal.md`, [
      `# 变更提案：${SLUG}`, '', `> module: ${proposalModule} | created: 2026-10-25`, '', '## 变更原因', '发布。', '', '## 变更类型', '代码级修复', '',
      '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：test', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '',
      '## 变更概述', '发布。',
    ].join('\n'));
    put(root, `${PROPOSAL_REL}/tasks.md`, ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n'));
    put(root, `${PROPOSAL_REL}/VERIFY_PASS`, '');
    put(root, `${PROPOSAL_REL}/LOOP_ITERS`, `${JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module: proposalModule, timestamp: '2026-10-25T00:00:00.000Z' })}\n`);
    put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: SLUG, module: proposalModule, createdAt: '2026-10-25T00:00:00.000Z' }));
  }
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 't']);
  git(root, ['config', 'user.email', 't@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}

interface Run { status: number; stdout: string; stderr: string }
function cli(root: string, args: string[], env: Record<string, string> = {}): Run {
  const base = { ...process.env };
  for (const k of ['CLAUDE_PROJECT_DIR', 'OPENLOGOS_SMOKE_ENV', 'OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS']) delete base[k];
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf-8', env: { ...base, ...env }, timeout: 120_000 });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const data = (r: Run) => JSON.parse(r.stdout).data;
const error = (r: Run) => JSON.parse(r.stderr).error as { code: string; details?: Record<string, unknown> };
const head = (root: string) => git(root, ['rev-parse', 'HEAD']);
const teamReport = (root: string) => existsSync(join(root, TEAM_REPORT)) && statSync(join(root, TEAM_REPORT)).isFile()
  ? readFileSync(join(root, TEAM_REPORT), 'utf-8') : null;
const sections = (root: string) => (teamReport(root)?.match(/^## Deployment /gm) ?? []).length;
const teamPhase = (root: string) => collectStatusData(root).modules!.find(m => m.id === 'team')!;
function snapshotDir(root: string, rel: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (abs: string, key: string) => {
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const n of readdirSync(abs).sort()) walk(join(abs, n), key ? `${key}/${n}` : n);
    else out[key] = readFileSync(abs, 'utf-8');
  };
  walk(join(root, rel), '');
  return out;
}
const tmpLeftovers = (root: string) => (existsSync(join(root, VERIFY)) ? readdirSync(join(root, VERIFY)) : []).filter(n => n.includes('.tmp-'));
const ledger = (root: string) => readFileSync(join(root, LEDGER_REL), 'utf-8').trim().split('\n').map(l => JSON.parse(l));

/** 进程内执行，返回 JSON 错误或成功信封。 */
async function inProcess(root: string, fn: () => Promise<void>): Promise<{ ok: boolean; body: any }> {
  const restore = mockCwd(root);
  const con = captureConsole();
  const exit = mockProcessExit();
  try {
    await fn();
    return { ok: true, body: JSON.parse(con.logs.at(-1) ?? '{}') };
  } catch (e) {
    if (!/process\.exit/.test(String(e))) throw e;
    return { ok: false, body: JSON.parse(con.errors.at(-1) ?? '{}') };
  } finally {
    exit.mockRestore(); con.restore(); restore();
  }
}
const midwayFailure = (tmp: string, content: string) => { writeFileSync(tmp, content.slice(0, 10)); throw new Error('injected: disk full'); };

describe('S21 initial 模块的模块部署报告（module-scoped-phase-reports）', () => {
  it('UT-S21-23: 落标成功后追加模块部署报告', () => {
    const root = build({ proposalModule: 'team' });
    const r = cli(root, ['deploy-done', '--env', 'team-manual', '--ref', head(root), '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    const marker = JSON.parse(readFileSync(join(root, PROPOSAL_REL, 'DEPLOY_DONE'), 'utf-8'));
    expect(readFileSync(join(root, PROPOSAL_REL, 'tasks.md'), 'utf-8')).toContain('- [x] 发布');
    expect(ledger(root).at(-1)).toMatchObject({ kind: 'deploy', environment: 'team-manual', deploy_id: marker.deploy_id });
    const report = teamReport(root)!;
    expect(report.startsWith('# Deployment Report\n')).toBe(true);
    expect(report).toContain(`- deploy_id: ${marker.deploy_id}`);
    expect(report).toContain('team-manual');
    expect(report).toContain('proposal / deploy-done');
    expect(report).toContain('- Result: done');
    expect(sections(root)).toBe(1);
    // 再次落标追加第二段，不覆盖第一段
    const r2 = cli(root, ['deploy-done', '--env', 'team-manual', '--ref', head(root), '--format', 'json']);
    expect(r2.status, r2.stderr).toBe(0);
    expect(sections(root)).toBe(2);
    expect(teamReport(root)!).toContain(`- deploy_id: ${marker.deploy_id}`);
  });

  it('UT-S21-24: 拒绝路径不写', () => {
    const variants: Array<[string, (root: string) => void, string[]]> = [
      ['VERIFY_PASS 缺失', root => rmSync(join(root, PROPOSAL_REL, 'VERIFY_PASS')), ['--env', 'team-manual']],
      ['共用部署报告缺失', root => rmSync(join(root, VERIFY, 'deployment-report.md')), ['--env', 'team-manual']],
      ['环境不属于 team', () => {}, ['--env', 'prod']],
    ];
    const codes: string[] = [];
    for (const [label, mutate, args] of variants) {
      const root = build({ proposalModule: 'team' });
      mutate(root);
      const r = cli(root, ['deploy-done', ...args, '--ref', head(root), '--format', 'json']);
      expect(r.status, label).toBe(1);
      codes.push(error(r).code);
      expect(teamReport(root), label).toBeNull();
    }
    expect(codes).toContain('DEPLOYMENT_REPORT_MISSING');
    expect(codes).toContain('ENV_MODULE_MISMATCH');
  });

  it('UT-S21-25: 落标或账本写入失败不写', () => {
    // ① DEPLOY_DONE 写入失败：提案目录只读
    const r1 = build({ proposalModule: 'team' });
    chmodSync(join(r1, PROPOSAL_REL), 0o555);
    try {
      const out = cli(r1, ['deploy-done', '--env', 'team-manual', '--ref', head(r1), '--format', 'json']);
      expect(out.status).toBe(1);
      expect(error(out).code).toBe('DEPLOY_DONE_WRITE_FAILED');
    } finally { chmodSync(join(r1, PROPOSAL_REL), 0o755); }
    expect(teamReport(r1)).toBeNull();
    expect(teamPhase(r1).phase_progress!['phase.3-7-deploy'].done).toBe(false);
    // ② 账本追加失败：账本路径被同名目录占用
    const r2 = build({ proposalModule: 'team' });
    mkdirSync(join(r2, LEDGER_REL), { recursive: true });
    const out2 = cli(r2, ['deploy-done', '--env', 'team-manual', '--ref', head(r2), '--format', 'json']);
    expect(out2.status).toBe(1);
    expect(existsSync(join(r2, PROPOSAL_REL, 'DEPLOY_DONE'))).toBe(false);
    expect(teamReport(r2)).toBeNull();
  });

  it('UT-S21-26: 模块报告写入失败以 DEPLOY_RECORD_FAILED 退出，且不被判为已部署（delta-r1 F2）', () => {
    const root = build({ proposalModule: 'team' });
    mkdirSync(join(root, TEAM_REPORT), { recursive: true });
    const r = cli(root, ['deploy-done', '--env', 'team-manual', '--ref', head(root), '--format', 'json']);
    expect(r.status).toBe(1);
    expect(error(r)).toMatchObject({ code: 'DEPLOY_RECORD_FAILED', details: { module_report_path: TEAM_REPORT, deployed: true } });
    expect(existsSync(join(root, PROPOSAL_REL, 'DEPLOY_DONE'))).toBe(true);
    expect(ledger(root).at(-1)).toMatchObject({ environment: 'team-manual' });
    expect(teamPhase(root).phase_progress!['phase.3-7-deploy'].done).toBe(false);
    const launch = cli(root, ['launch', 'team']);
    expect(launch.status).toBe(1);
    expect(launch.stderr).toContain(TEAM_REPORT);
  });

  it('UT-S21-28: 发布中断不留残留；已有成功报告时追加失败保留旧凭据（delta-r1 F2）', async () => {
    // ① 首次发布中断
    const r1 = build({ proposalModule: 'team' });
    const out1 = await inProcess(r1, () => deployDone('json', 'team-manual', head(r1), { moduleReportWrite: midwayFailure }));
    expect(out1.ok).toBe(false);
    expect(out1.body.error.code).toBe('DEPLOY_RECORD_FAILED');
    expect(existsSync(join(r1, TEAM_REPORT))).toBe(false);
    expect(tmpLeftovers(r1)).toEqual([]);
    expect(teamPhase(r1).phase_progress!['phase.3-7-deploy'].done).toBe(false);
    // ② 已有一段成功记录后追加中断
    const r2 = build({ proposalModule: 'team' });
    expect(cli(r2, ['deploy-done', '--env', 'team-manual', '--ref', head(r2), '--format', 'json']).status).toBe(0);
    const before = readFileSync(join(r2, TEAM_REPORT), 'utf-8');
    const out2 = await inProcess(r2, () => deployDone('json', 'team-manual', head(r2), { moduleReportWrite: midwayFailure }));
    expect(out2.body.error.code).toBe('DEPLOY_RECORD_FAILED');
    expect(readFileSync(join(r2, TEAM_REPORT), 'utf-8')).toBe(before);
    expect(tmpLeftovers(r2)).toEqual([]);
    expect(teamPhase(r2).phase_progress!['phase.3-7-deploy'].done).toBe(true);
  });

  it('UT-S21-27: launched 提案模块与单模块项目不写', () => {
    const core = build({ proposalModule: 'core' });
    rmSync(join(core, 'logos/logos-project.yaml'));
    put(core, 'logos/logos-project.yaml', stringifyYaml({
      project: { name: 'mdr' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }, { id: 'team', name: 'Team', lifecycle: 'initial' }],
      deployment_gates: { team: { environments: ['team-prod'] } }, // core 未声明环境：按无登记表落标
    }, { lineWidth: 0 }));
    const r = cli(core, ['deploy-done', '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(join(core, VERIFY)).filter(n => /-deployment-report\.md$/.test(n))).toEqual([]);

    const single = build({ singleModule: true });
    const s = cli(single, ['deploy-done', '--env', 'test', '--ref', head(single), '--format', 'json']);
    expect(s.status, s.stderr).toBe(0);
    expect(readdirSync(join(single, VERIFY)).filter(n => /-deployment-report\.md$/.test(n))).toEqual([]);
  });
});

describe('S42 initial 模块的模块部署报告（module-scoped-phase-reports）', () => {
  it('UT-S42-29: 版本通道成功写模块部署报告（proposal-r1 F2）', () => {
    for (const proposalModule of [null, 'core'] as const) {
      const root = build({ proposalModule });
      const proposalBefore = snapshotDir(root, PROPOSAL_REL);
      const sharedBefore = readFileSync(join(root, VERIFY, 'deployment-report.md'), 'utf-8');
      const r = cli(root, ['deploy', '--env', 'team-prod', '--ref', head(root), '--format', 'json']);
      expect(r.status, r.stderr).toBe(0);
      expect(data(r)).toMatchObject({ channel: 'version', status: 'done' });
      const report = teamReport(root)!;
      expect(report.startsWith('# Deployment Report\n')).toBe(true);
      expect(report).toContain(`- deploy_id: ${data(r).deploy_id}`);
      expect(report).toContain('- Result: done');
      expect(report).toContain('- log_path:');
      expect(readFileSync(join(root, VERIFY, 'deployment-report.md'), 'utf-8')).toBe(sharedBefore);
      expect(snapshotDir(root, PROPOSAL_REL)).toEqual(proposalBefore);
      expect(JSON.stringify(data(r))).not.toContain('team-deployment-report');
    }
  });

  it('UT-S42-30: 失败、结果未知、进行中、dry-run、agent failed 不写（proposal-r1 F1）', () => {
    const root = build({ proposalModule: null });
    const ciState = join(root, '..', `${root.split('/').pop()}.ci-state`);
    roots.push(ciState);
    const f1 = cli(root, ['deploy', '--env', 'team-prod', '--ref', head(root), '--format', 'json'], { DEPLOY_EXIT: '1' });
    expect(error(f1).code).toBe('DEPLOY_FAILED');
    writeFileSync(ciState, 'running');
    const f2 = cli(root, ['deploy', '--env', 'team-ci', '--ref', head(root), '--format', 'json'], { CI_STATE: ciState });
    expect(error(f2).code).toBe('DEPLOY_RESULT_UNKNOWN');
    const f3 = cli(root, ['deploy', '--env', 'team-ci', '--reconcile', '--format', 'json'], { CI_STATE: ciState });
    expect(data(f3).status).toBe('still-running');
    const pendingId = data(f3).deploy_id;
    expect(cli(root, ['deploy', '--env', 'team-ci', '--abandon', pendingId, '--format', 'json']).status).toBe(0);
    const f4 = cli(root, ['deploy', '--env', 'team-prod', '--ref', head(root), '--dry-run', '--format', 'json']);
    expect(f4.status, f4.stderr).toBe(0);
    const a = cli(root, ['deploy', '--env', 'team-agent', '--ref', head(root), '--format', 'json']);
    expect(data(a).status).toBe('awaiting-agent');
    const f5 = cli(root, ['deploy', '--env', 'team-agent', '--complete', data(a).deploy_id, '--result', 'failed', '--format', 'json']);
    expect(f5.status).toBe(1);
    expect(error(f5).code).toBe('DEPLOY_FAILED'); // agent 报告失败按既有规则以 DEPLOY_FAILED 退出
    expect(teamReport(root)).toBeNull();
    expect(teamPhase(root).phase_progress!['phase.3-7-deploy'].done).toBe(false);
  });

  it('UT-S42-31: 部署成功但记录提交失败不写（proposal-r1 F1）', async () => {
    const version = build({ proposalModule: null });
    const v = await inProcess(version, () => deploy('json', { env: 'team-prod', ref: head(version) }, { appendLedger: () => { throw new Error('ledger down'); } }));
    expect(v.body.error.code).toBe('DEPLOY_RECORD_FAILED');
    expect(teamReport(version)).toBeNull();

    const proposal = build({ proposalModule: 'team' });
    const sharedBefore = readFileSync(join(proposal, VERIFY, 'deployment-report.md'), 'utf-8');
    const p = await inProcess(proposal, () => deploy('json', { env: 'team-prod' }, {
      completion: () => ({ ok: false, stage: 'write', reason: 'marker write failed', rollbackProblems: [] }),
    }));
    expect(p.body.error.code).toBe('DEPLOY_RECORD_FAILED');
    expect(teamReport(proposal)).toBeNull();
    expect(readFileSync(join(proposal, VERIFY, 'deployment-report.md'), 'utf-8').length).toBeGreaterThan(sharedBefore.length); // 共用报告照旧追加
  });

  it('UT-S42-32: 补记、回滚、agent 完成在成功边界写', () => {
    // ① CI 先结果未知，再 --reconcile 得 done
    const ci = build({ proposalModule: null });
    const ciState = join(ci, '..', `${ci.split('/').pop()}.ci-state`);
    roots.push(ciState);
    writeFileSync(ciState, 'running');
    expect(error(cli(ci, ['deploy', '--env', 'team-ci', '--ref', head(ci), '--format', 'json'], { CI_STATE: ciState })).code).toBe('DEPLOY_RESULT_UNKNOWN');
    expect(teamReport(ci)).toBeNull();
    writeFileSync(ciState, 'success');
    const rc = cli(ci, ['deploy', '--env', 'team-ci', '--reconcile', '--format', 'json'], { CI_STATE: ciState });
    expect(data(rc).status).toBe('reconciled');
    expect(sections(ci)).toBe(1);
    expect(teamReport(ci)!).toContain('- run: 77');

    // ② 两次成功部署后 --rollback
    const rb = build({ proposalModule: null });
    const first = head(rb);
    expect(cli(rb, ['deploy', '--env', 'team-prod', '--ref', first, '--format', 'json']).status).toBe(0);
    put(rb, 'payload.txt', 'v2\n'); git(rb, ['add', '-A']); git(rb, ['commit', '-qm', 'v2']);
    expect(cli(rb, ['deploy', '--env', 'team-prod', '--ref', head(rb), '--format', 'json']).status).toBe(0);
    const back = cli(rb, ['deploy', '--env', 'team-prod', '--rollback', '--format', 'json']);
    expect(back.status, back.stderr).toBe(0);
    expect(data(back).rollback).toBe(true);
    expect(sections(rb)).toBe(3);

    // ③ agent 两段式完成
    const ag = build({ proposalModule: null });
    const a = cli(ag, ['deploy', '--env', 'team-agent', '--ref', head(ag), '--format', 'json']);
    const done = cli(ag, ['deploy', '--env', 'team-agent', '--complete', data(a).deploy_id, '--result', 'done', '--format', 'json']);
    expect(done.status, done.stderr).toBe(0);
    const report = teamReport(ag)!;
    expect(report).toContain(`- deploy_id: ${data(a).deploy_id}`);
    expect(report).toContain('version / agent');
    expect(report).toContain('- Result: done');
    expect(report).toContain('- recorded_at:');
  });

  it('UT-S42-33: 提案通道成功同时写共用报告与模块报告', () => {
    const root = build({ proposalModule: 'team' });
    const sharedBefore = readFileSync(join(root, VERIFY, 'deployment-report.md'), 'utf-8');
    const r = cli(root, ['deploy', '--env', 'team-prod', '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    expect(data(r)).toMatchObject({ channel: 'proposal', status: 'done' });
    const shared = readFileSync(join(root, VERIFY, 'deployment-report.md'), 'utf-8');
    const appended = shared.slice(sharedBefore.length).trim();
    expect(existsSync(join(root, PROPOSAL_REL, 'DEPLOY_DONE'))).toBe(true);
    expect(readFileSync(join(root, PROPOSAL_REL, 'tasks.md'), 'utf-8')).toContain('- [x] 发布');
    expect(teamReport(root)!.trim().endsWith(appended)).toBe(true); // 同一段落
  });

  it('UT-S42-34: 模块报告写入失败以 DEPLOY_RECORD_FAILED 退出，且不被判为已部署（delta-r1 F2）', () => {
    const root = build({ proposalModule: null });
    mkdirSync(join(root, TEAM_REPORT), { recursive: true });
    const r = cli(root, ['deploy', '--env', 'team-prod', '--ref', head(root), '--format', 'json']);
    expect(r.status).toBe(1);
    expect(error(r)).toMatchObject({ code: 'DEPLOY_RECORD_FAILED', details: { module_report_path: TEAM_REPORT, deployed: true } });
    expect(ledger(root).at(-1)).toMatchObject({ environment: 'team-prod', result: 'done' });
    expect(teamPhase(root).phase_progress!['phase.3-7-deploy'].done).toBe(false);
    expect(cli(root, ['launch', 'team']).status).toBe(1);
  });

  it('UT-S42-36: 发布中断不留残留；已有成功报告时追加失败保留旧凭据（delta-r1 F2）', async () => {
    const r1 = build({ proposalModule: null });
    const out1 = await inProcess(r1, () => deploy('json', { env: 'team-prod', ref: head(r1) }, { moduleReportWrite: midwayFailure }));
    expect(out1.body.error.code).toBe('DEPLOY_RECORD_FAILED');
    expect(existsSync(join(r1, TEAM_REPORT))).toBe(false);
    expect(tmpLeftovers(r1)).toEqual([]);
    expect(teamPhase(r1).phase_progress!['phase.3-7-deploy'].done).toBe(false);

    const r2 = build({ proposalModule: null });
    expect(cli(r2, ['deploy', '--env', 'team-prod', '--ref', head(r2), '--format', 'json']).status).toBe(0);
    const before = readFileSync(join(r2, TEAM_REPORT), 'utf-8');
    const out2 = await inProcess(r2, () => deploy('json', { env: 'team-prod', ref: head(r2) }, { moduleReportWrite: midwayFailure }));
    expect(out2.body.error.code).toBe('DEPLOY_RECORD_FAILED');
    expect(readFileSync(join(r2, TEAM_REPORT), 'utf-8')).toBe(before);
    expect(tmpLeftovers(r2)).toEqual([]);
    expect(teamPhase(r2).phase_progress!['phase.3-7-deploy'].done).toBe(true);
  });

  it('UT-S42-35: launched 目标模块与不限定模块不写', () => {
    const root = build({ proposalModule: null });
    expect(cli(root, ['deploy', '--env', 'prod', '--ref', head(root), '--format', 'json']).status).toBe(0);
    expect(cli(root, ['deploy', '--env', 'shared-env', '--ref', head(root), '--format', 'json']).status).toBe(0);
    expect(readdirSync(join(root, VERIFY)).filter(n => /-deployment-report\.md$/.test(n))).toEqual([]);
  });
});

describe('S42 未启用模块环境范围的多模块项目（code-r1 F1）', () => {
  /** 去掉全部 deployment_gates（无 smoke.modules）：多模块但未启用按模块区分。 */
  function unscoped(opts: Opts, lifecycleTeam: 'initial' | 'launched' = 'initial'): string {
    const root = build(opts);
    put(root, 'logos/logos-project.yaml', stringifyYaml({
      project: { name: 'mdr' },
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }, { id: 'team', name: 'Team', lifecycle: lifecycleTeam }],
    }, { lineWidth: 0 }));
    git(root, ['add', '-A']); git(root, ['commit', '-qm', 'unscoped']);
    return root;
  }

  it('UT-S42-35（code-r1 F1）: 未启用、无活跃提案——部署成功收尾，不写模块报告', () => {
    const root = unscoped({ proposalModule: null });
    const r = cli(root, ['deploy', '--env', 'team-prod', '--ref', head(root), '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    expect(data(r)).toMatchObject({ channel: 'version', status: 'done' });
    expect(readdirSync(join(root, VERIFY)).filter(n => /-deployment-report\.md$/.test(n))).toEqual([]);
  });

  it('UT-S42-29（code-r1 F1）: 未启用、活跃提案属于 initial 模块——按提案模块回落写模块报告', () => {
    const root = unscoped({ proposalModule: 'team' });
    const r = cli(root, ['deploy', '--env', 'team-prod', '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    expect(data(r)).toMatchObject({ channel: 'proposal', status: 'done' });
    expect(sections(root)).toBe(1);
    expect(teamReport(root)!).toContain(`- deploy_id: ${data(r).deploy_id}`);
  });

  it('UT-S42-35（code-r1 F1）: 未启用、全部 launched——部署成功收尾，不写模块报告', () => {
    const root = unscoped({ proposalModule: 'core' }, 'launched');
    const r = cli(root, ['deploy', '--env', 'prod', '--ref', head(root), '--format', 'json']);
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(join(root, VERIFY)).filter(n => /-deployment-report\.md$/.test(n))).toEqual([]);
  });
});

describe('S42 initial 模块的模块部署报告端到端（module-scoped-phase-reports）', () => {
  it('ST-S42-09: 首次失败不推进，成功后推进 3-7，且不改动其他模块提案', () => {
    const root = build({ proposalModule: 'core' });
    const proposalBefore = snapshotDir(root, PROPOSAL_REL);
    const sharedBefore = readFileSync(join(root, VERIFY, 'deployment-report.md'), 'utf-8');
    const stepBefore = data(cli(root, ['next', '--format', 'json'])).proposal_step;
    const f = cli(root, ['deploy', '--env', 'team-prod', '--ref', head(root), '--format', 'json'], { DEPLOY_EXIT: '1' });
    expect(error(f).code).toBe('DEPLOY_FAILED');
    expect(teamReport(root)).toBeNull();
    expect(teamPhase(root).current_phase).toBe('phase.3-7-deploy');
    const ok = cli(root, ['deploy', '--env', 'team-prod', '--ref', head(root), '--format', 'json']);
    expect(ok.status, ok.stderr).toBe(0);
    expect(sections(root)).toBe(1);
    expect(teamPhase(root).current_phase).toBe('phase.3-8-smoke');
    expect(snapshotDir(root, PROPOSAL_REL)).toEqual(proposalBefore);
    expect(readFileSync(join(root, VERIFY, 'deployment-report.md'), 'utf-8')).toBe(sharedBefore);
    expect(data(cli(root, ['next', '--format', 'json'])).proposal_step).toBe(stepBefore);
  });
});
