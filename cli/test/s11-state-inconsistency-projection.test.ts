/**
 * fix-deploy-done-leak-failclosed-selfheal 切片3：
 * `state_inconsistency` 只读对账投影（§2.67.3）+ next 对账引导 + S21 唯一 writer 跨命令回归。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { collectStatusData } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';
import { smoke } from '../src/commands/smoke.js';
import { archive } from '../src/commands/archive.js';
import { deployDone } from '../src/commands/deploy-done.js';

const DEPLOY_PROPOSAL = [
  '# 变更提案：runtime-change',
  '',
  '## 部署影响',
  '- 是否需要部署：是',
  '- 部署原因：修改 CLI 运行时代码，需要发布新包',
  '- 影响环境：生产',
  '- 是否涉及数据迁移：否',
  '- 是否需要回滚预案：是',
  '- 是否需要 smoke：是',
  '',
  '## 变更概述',
  '修改运行时代码。',
].join('\n');

const DEPLOY_TASKS = [
  '# 实现任务', '', '## [code] 代码实现', '- [x] 修改运行时代码', '',
  '## [deploy] 部署任务', '- [ ] 发布 npm 包',
].join('\n');

const DEPLOY_TASKS_DONE = DEPLOY_TASKS.replace('- [ ] 发布 npm 包', '- [x] 发布 npm 包');

let root: string;
let cleanup: () => void;
let restoreCwd: () => void;
let con: ReturnType<typeof captureConsole>;
let exitSpy: ReturnType<typeof mockProcessExit>;

beforeEach(() => {
  ({ root, cleanup } = makeTempRoot());
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
    modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    deployment_gates: { core: { deployment_required: true, smoke_required: true } },
  }, { lineWidth: 0 }));
  restoreCwd = mockCwd(root);
  con = captureConsole();
  exitSpy = mockProcessExit();
});

afterEach(() => {
  con.restore();
  exitSpy.mockRestore();
  restoreCwd();
  cleanup();
});

let proposalSeq = 0;

function setupProposal(opts: { tasks?: string; markers?: string[] } = {}) {
  // 每次构造独立 slug，避免同一用例内多场景复用目录导致旧 marker 残留污染断言。
  const slug = `deploy-feature-${++proposalSeq}`;
  const proposalDir = join(root, 'logos', 'changes', slug);
  mkdirSync(proposalDir, { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({
    activeChange: slug, module: 'core', createdAt: new Date().toISOString(),
  }));
  writeFileSync(join(proposalDir, 'proposal.md'), DEPLOY_PROPOSAL);
  writeFileSync(join(proposalDir, 'tasks.md'), opts.tasks ?? DEPLOY_TASKS);
  writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
  for (const m of opts.markers ?? []) writeFileSync(join(proposalDir, m), '');
  return { slug, proposalDir };
}

function activeChangeOf(): Record<string, unknown> {
  const data = collectStatusData(root);
  const mod = (data.modules ?? []).find(m => m.active_change);
  return (mod?.active_change ?? {}) as unknown as Record<string, unknown>;
}

function dirSnapshot(dir: string): Array<[string, number]> {
  return readdirSync(dir).sort().map(name => [name, statSync(join(dir, name)).mtimeMs] as [string, number]);
}

describe('S11 state_inconsistency 只读对账投影', () => {
  it('UT-S11-80: 矛盾事实下投影挂载与字段完整', () => {
    setupProposal({ tasks: DEPLOY_TASKS_DONE, markers: ['SMOKE_PASS'] });

    const ac = activeChangeOf();
    expect(ac.proposal_step, '投影不改派生').toBe('ready-to-deploy');
    expect(ac.state_inconsistency).toEqual({
      kind: 'deploy_done_missing_with_downstream_evidence',
      evidence: ['smoke_pass_marker_present', 'deploy_tasks_all_checked'],
      remediation: 'openlogos deploy-done',
    });
  });

  it('UT-S11-81: 一致状态零漂移且投影只读', () => {
    // 场景 A：DEPLOY_DONE 缺失且无任何矛盾证据（[deploy] 未全勾、无 smoke marker）
    const { proposalDir } = setupProposal();
    const before = dirSnapshot(proposalDir);
    const acA = activeChangeOf();
    expect(acA.proposal_step).toBe('ready-to-deploy');
    expect('state_inconsistency' in acA, '一致状态下该键不出现（不是 null）').toBe(false);
    expect(dirSnapshot(proposalDir), '只读：调用前后文件清单与 mtime 不变').toEqual(before);

    // 场景 B：DEPLOY_DONE 已在场
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    const afterWrite = dirSnapshot(proposalDir);
    const acB = activeChangeOf();
    expect('state_inconsistency' in acB).toBe(false);
    expect(dirSnapshot(proposalDir)).toEqual(afterWrite);
  });

  it('ST-S11-46: 三类证据分别触发且与既有只读投影并列', () => {
    const { proposalDir } = setupProposal();

    // 仅 SMOKE_PASS
    writeFileSync(join(proposalDir, 'SMOKE_PASS'), '');
    expect((activeChangeOf().state_inconsistency as { evidence: string[] }).evidence)
      .toEqual(['smoke_pass_marker_present']);

    // 仅 SMOKE_FAIL
    const smokeFailOnly = setupProposal({ markers: ['SMOKE_FAIL'] });
    expect((activeChangeOf().state_inconsistency as { evidence: string[] }).evidence)
      .toEqual(['smoke_fail_marker_present']);
    expect(existsSync(join(smokeFailOnly.proposalDir, 'DEPLOY_DONE'))).toBe(false);

    // 仅 [deploy] 全勾
    const deployAllChecked = setupProposal({ tasks: DEPLOY_TASKS_DONE });
    const ac = activeChangeOf();
    expect((ac.state_inconsistency as { evidence: string[] }).evidence).toEqual(['deploy_tasks_all_checked']);
    // 与既有只读投影并列挂载、互不覆盖
    expect(ac.plan_state).toBeDefined();
    expect(ac.deployment_progress).toBeDefined();

    // 补标后投影消失、派生推进
    writeFileSync(join(deployAllChecked.proposalDir, 'DEPLOY_DONE'), '');
    const healed = activeChangeOf();
    expect('state_inconsistency' in healed).toBe(false);
    expect(healed.proposal_step).not.toBe('ready-to-deploy');
  });
});

describe('S05 next 矛盾事实对账建议', () => {
  async function runNext(format: 'text' | 'json' = 'json') {
    con.errors.length = 0; con.logs.length = 0;
    await next(format);
    return con.logs.join('\n');
  }

  it('UT-S05-56: 孤儿 SMOKE_PASS 触发对账投影与补救建议', async () => {
    const { proposalDir } = setupProposal({ tasks: DEPLOY_TASKS_DONE, markers: ['SMOKE_PASS'] });
    const before = dirSnapshot(proposalDir);

    // JSON：投影随 next 输出（next 的 active_change 是 slug 字符串，故按本文件既有约定平铺 module 级）
    const parsed = JSON.parse(await runNext('json'));
    const mod = parsed.data.modules[0];
    expect(mod.proposal_step).toBe('ready-to-deploy');
    expect(mod.state_inconsistency.kind).toBe('deploy_done_missing_with_downstream_evidence');
    expect(mod.state_inconsistency.evidence).toContain('smoke_pass_marker_present');
    expect(mod.state_inconsistency.remediation).toBe('openlogos deploy-done');
    // 人读引导在既有部署授权文案之后追加对账建议行
    expect(mod.detail).toContain('openlogos deploy-done');

    const text = await runNext('text');
    expect(text).toContain('openlogos deploy-done');
    expect(dirSnapshot(proposalDir), 'next 不写盘').toEqual(before);
  });

  it('UT-S05-57: 一致状态零投影零漂移', async () => {
    // 场景 A：无矛盾证据
    const { proposalDir } = setupProposal();
    const a = JSON.parse(await runNext('json')).data.modules[0];
    expect('state_inconsistency' in a).toBe(false);

    // 场景 B：DEPLOY_DONE 在场
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    const b = JSON.parse(await runNext('json')).data.modules[0];
    expect('state_inconsistency' in b).toBe(false);
  });

  it('ST-S05-26: 僵死状态被点名 → 补标 → 投影消失', async () => {
    const { proposalDir } = setupProposal({ tasks: DEPLOY_TASKS_DONE, markers: ['SMOKE_PASS'] });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), '# Deployment Report\n\nok\n');

    // ① 投影在场，证据按固定顺序去重输出
    const first = JSON.parse(await runNext('json')).data.modules[0];
    expect(first.state_inconsistency.evidence)
      .toEqual(['smoke_pass_marker_present', 'deploy_tasks_all_checked']);
    expect(first.detail).toContain('openlogos deploy-done');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE')), 'next 绝不代写 DEPLOY_DONE').toBe(false);

    // ② 按建议补标
    con.errors.length = 0; con.logs.length = 0;
    await deployDone('text');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(true);

    // ③ 投影消失、派生推进离开 ready-to-deploy
    const healed = JSON.parse(await runNext('json')).data.modules[0];
    expect('state_inconsistency' in healed).toBe(false);
    expect(healed.proposal_step).toBe('ready-to-smoke');
  });
});

describe('S21 唯一 writer 与消费侧收口回归', () => {
  it('UT-S21-10: DEPLOY_DONE 唯一 writer——四条消费命令均不写该 marker', async () => {
    const { slug, proposalDir } = setupProposal({ tasks: DEPLOY_TASKS_DONE, markers: ['SMOKE_PASS'] });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), '# Deployment Report\n\nok\n');
    const before = readdirSync(proposalDir).sort();

    // smoke / archive 走 fail-closed 拒绝；status / next 走只读派生
    try { smoke('text'); } catch { /* exit(1) */ }
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
    try { archive(slug); } catch { /* exit(1) */ }
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
    collectStatusData(root);
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
    await next('json');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);

    expect(readdirSync(proposalDir).sort(), '提案目录 marker 集合零变化').toEqual(before);
  });

  it('UT-S21-11: 成功路径 marker 最后写；错误分支三者皆无变化', async () => {
    const { proposalDir } = setupProposal({ tasks: DEPLOY_TASKS, markers: ['SMOKE_PASS'] });
    const reportDir = join(root, 'logos/resources/verify');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'deployment-report.md'), '# Deployment Report\n\nok\n');

    await deployDone('text');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(true);
    expect(existsSync(join(proposalDir, 'SMOKE_PASS')), '旧 SMOKE_PASS 已清理').toBe(false);
    const tasks = readdirSync(proposalDir);
    expect(tasks).toContain('DEPLOY_DONE');

    // 错误分支重放（移除 deployment-report.md）：三者皆无变化，不出现部分状态更新
    const fresh = setupProposal({ tasks: DEPLOY_TASKS, markers: ['SMOKE_PASS'] });
    writeFileSync(join(reportDir, 'deployment-report.md'), '');
    const { rmSync } = await import('node:fs');
    rmSync(join(reportDir, 'deployment-report.md'));
    const before = dirSnapshot(fresh.proposalDir);
    con.errors.length = 0; con.logs.length = 0;
    try { await deployDone('text'); } catch { /* exit(1) */ }
    expect(existsSync(join(fresh.proposalDir, 'DEPLOY_DONE'))).toBe(false);
    expect(existsSync(join(fresh.proposalDir, 'SMOKE_PASS')), '错误分支不得清理旧 smoke 标记').toBe(true);
    expect(dirSnapshot(fresh.proposalDir)).toEqual(before);
  });

  it('ST-S21-04: 漏跑 deploy-done 的缺口不扩散，补标后全链恢复', async () => {
    const { slug, proposalDir } = setupProposal({ tasks: DEPLOY_TASKS_DONE });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), '# Deployment Report\n\nok\n');

    // ① smoke 拒绝且不产生 SMOKE_PASS
    con.errors.length = 0; con.logs.length = 0;
    try { smoke('text'); } catch { /* exit(1) */ }
    expect(con.errors.join('\n')).toContain('SMOKE_DEPLOY_NOT_DONE');
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(false);

    // ② archive 拒绝且目录未移动、guard 未删
    con.errors.length = 0; con.logs.length = 0;
    try { archive(slug); } catch { /* exit(1) */ }
    expect(con.errors.join('\n')).toContain('ARCHIVE_DEPLOY_NOT_DONE');
    expect(existsSync(proposalDir)).toBe(true);
    expect(existsSync(join(root, 'logos', '.openlogos-guard'))).toBe(true);

    // ③ status/next 输出对账投影并给出补救命令
    expect((activeChangeOf().state_inconsistency as { remediation: string }).remediation)
      .toBe('openlogos deploy-done');

    // ④ 补标成功（缺口只能由唯一 writer 补上）
    con.errors.length = 0; con.logs.length = 0;
    await deployDone('text');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(true);

    // ⑤ 重放：投影消失、archive 按 SMOKE_PASS 状态继续判定
    expect('state_inconsistency' in activeChangeOf()).toBe(false);
    con.errors.length = 0; con.logs.length = 0;
    try { archive(slug); } catch { /* exit(1) */ }
    expect(con.errors.join('\n')).toContain('ARCHIVE_SMOKE_NOT_PASSED');
    expect(existsSync(proposalDir), 'smoke 未过时仍不得归档').toBe(true);
  });
});
