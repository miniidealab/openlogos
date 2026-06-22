import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { checkTaskSection, deployDone, readActiveProposalGuard } from '../src/commands/deploy-done.js';
import { detectProposalStep } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';

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

const NO_SMOKE_PROPOSAL = DEPLOY_PROPOSAL.replace('- 是否需要 smoke：是', '- 是否需要 smoke：否');

const NO_DEPLOY_PROPOSAL = [
  '# 变更提案：docs-only',
  '',
  '## 部署影响',
  '- 是否需要部署：否',
  '- 部署原因：仅更新文档，不需要发布运行产物',
  '- 影响环境：无',
  '- 是否涉及数据迁移：否',
  '- 是否需要回滚预案：否',
  '- 是否需要 smoke：否',
  '',
  '## 变更概述',
  '补充文档。',
].join('\n');

const DEPLOY_TASKS = [
  '# 实现任务',
  '',
  '## [code] 代码实现',
  '- [x] 修改运行时代码',
  '',
  '## [deploy] 部署任务',
  '- [ ] 发布 npm 包',
  '- [ ] 同步官网',
].join('\n');

describe('S21 Unit Tests — deploy-done command helpers', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
  });

  afterEach(() => cleanup());

  it('UT-S21-01: 解析 guard 定位活跃提案', async () => {
    const proposalDir = join(root, 'logos', 'changes', 'deploy-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({
      activeChange: 'deploy-feature',
      module: 'core',
    }));

    expect(readActiveProposalGuard(root)).toEqual({
      slug: 'deploy-feature',
      proposalDir,
      moduleId: 'core',
    });
  });

  it('UT-S21-07: 成功时勾选 [deploy] 并写入 DEPLOY_DONE 的 section 勾选逻辑', async () => {
    const result = checkTaskSection(DEPLOY_TASKS, 'deploy');

    expect(result.checked).toBe(2);
    expect(result.total).toBe(2);
    expect(result.content).toContain('- [x] 发布 npm 包');
    expect(result.content).toContain('- [x] 同步官网');
    expect(result.content).toContain('- [x] 修改运行时代码');
  });
});

describe('S21 Scenario Tests — deploy-done command', () => {
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

  function setupProposal(
    slug = 'deploy-feature',
    proposal = DEPLOY_PROPOSAL,
    tasks = DEPLOY_TASKS,
  ) {
    const proposalDir = join(root, 'logos', 'changes', slug);
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({
      activeChange: slug,
      module: 'core',
      createdAt: new Date().toISOString(),
    }));
    writeFileSync(join(proposalDir, 'proposal.md'), proposal);
    writeFileSync(join(proposalDir, 'tasks.md'), tasks);
    return proposalDir;
  }

  function writeDeployReport() {
    const reportDir = join(root, 'logos/resources/verify');
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'deployment-report.md'), '# Deployment Report\n\nstaging ok\n');
  }

  it('UT-S21-02 / ST-S21-EX-4.1: 缺少 VERIFY_PASS 时拒绝写 DEPLOY_DONE', async () => {
    const proposalDir = setupProposal();
    writeDeployReport();

    await expect(deployDone()).rejects.toThrow('process.exit(1)');

    expect(con.errors.join('\n')).toContain('验收尚未通过');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
  });

  it('UT-S21-03: 存在 VERIFY_FAIL 时拒绝写 DEPLOY_DONE', async () => {
    const proposalDir = setupProposal();
    writeDeployReport();
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeFileSync(join(proposalDir, 'VERIFY_FAIL'), '');

    await expect(deployDone()).rejects.toThrow('process.exit(1)');

    expect(con.errors.join('\n')).toContain('验收尚未通过');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
  });

  it('UT-S21-04 / ST-S21-EX-5.1: 部署决策冲突时拒绝写 DEPLOY_DONE', async () => {
    const proposalDir = setupProposal('conflict', NO_DEPLOY_PROPOSAL, DEPLOY_TASKS);
    writeDeployReport();
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    await expect(deployDone()).rejects.toThrow('process.exit(1)');

    expect(con.errors.join('\n')).toContain('部署决策冲突');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
  });

  it('UT-S21-05: 缺少 [deploy] section 时拒绝写 DEPLOY_DONE', async () => {
    const proposalDir = setupProposal('missing-deploy', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 修改运行时代码',
    ].join('\n'));
    writeDeployReport();
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    await expect(deployDone('json')).rejects.toThrow('process.exit(1)');

    const parsed = JSON.parse(con.errors[0]);
    expect(parsed.error.code).toBe('DEPLOYMENT_DECISION_CONFLICT');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
  });

  it('UT-S21-06 / ST-S21-EX-6.1: 缺少部署报告时拒绝写 DEPLOY_DONE', async () => {
    const proposalDir = setupProposal();
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    rmSync(join(root, 'logos/resources/verify/deployment-report.md'), { force: true });

    await expect(deployDone()).rejects.toThrow('process.exit(1)');

    expect(con.errors.join('\n')).toContain('缺少部署报告');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
  });

  it('UT-S21-07 / ST-S21-01: 成功时写入 DEPLOY_DONE 并进入 ready-to-smoke', async () => {
    const proposalDir = setupProposal();
    writeDeployReport();
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    await deployDone('text', 'staging');

    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(true);
    const tasks = readFileSync(join(proposalDir, 'tasks.md'), 'utf-8');
    expect(tasks).toContain('- [x] 发布 npm 包');
    expect(tasks).toContain('- [x] 同步官网');
    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('ready-to-smoke');
    expect(con.logs.join('\n')).toContain('openlogos smoke --env staging');
  });

  it('UT-S21-08: 成功时清理旧 smoke marker', async () => {
    const proposalDir = setupProposal();
    writeDeployReport();
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeFileSync(join(proposalDir, 'SMOKE_PASS'), '');
    writeFileSync(join(proposalDir, 'SMOKE_FAIL'), '');

    await deployDone('json', 'staging');

    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(false);
    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.cleared_smoke_markers).toEqual(['SMOKE_PASS', 'SMOKE_FAIL']);
  });

  it('UT-S21-09: JSON 输出包含部署完成摘要', async () => {
    const proposalDir = setupProposal();
    writeDeployReport();
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    await deployDone('json', 'production');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.command).toBe('deploy-done');
    expect(parsed.data.slug).toBe('deploy-feature');
    expect(parsed.data.environment).toBe('production');
    expect(parsed.data.marker_path).toBe('logos/changes/deploy-feature/DEPLOY_DONE');
    expect(parsed.data.deployment_report_path).toBe('logos/resources/verify/deployment-report.md');
    expect(parsed.data.deploy_tasks_checked).toBe(2);
    expect(parsed.data.deploy_tasks_total).toBe(2);
    expect(parsed.data.next_step).toBe('ready-to-smoke');
  });

  it('ST-S21-02: 无需 smoke 的提案部署完成后进入 deploy-done', async () => {
    const proposalDir = setupProposal('no-smoke', NO_SMOKE_PROPOSAL);
    writeDeployReport();
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    await deployDone();

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('deploy-done');
    con.logs.length = 0;
    next();
    expect(con.logs.join('\n')).toContain('archive no-smoke');
  });

  it('ST-S21-03: deploy-done 不执行实际部署命令', async () => {
    const proposalDir = setupProposal('no-external-command', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] node -e "require(\'fs\').writeFileSync(\'external-command-ran\',\'yes\')"',
    ].join('\n'));
    writeDeployReport();
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    await deployDone();

    expect(existsSync(join(root, 'external-command-ran'))).toBe(false);
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(true);
  });

  it('ST-S21-EX-2.1: 项目未初始化', async () => {
    rmSync(join(root, 'logos', 'logos.config.json'), { force: true });

    await expect(deployDone('json')).rejects.toThrow('process.exit(1)');

    const parsed = JSON.parse(con.errors[0]);
    expect(parsed.error.code).toBe('PROJECT_NOT_INITIALIZED');
  });

  it('ST-S21-EX-3.1: 缺少活跃提案', async () => {
    rmSync(join(root, 'logos', '.openlogos-guard'), { force: true });

    await expect(deployDone('json')).rejects.toThrow('process.exit(1)');

    const parsed = JSON.parse(con.errors[0]);
    expect(parsed.error.code).toBe('NO_ACTIVE_CHANGE');
  });

  it('ST-S21-EX-5.2: 提案无需部署时不写 marker', async () => {
    const proposalDir = setupProposal('docs-only', NO_DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 更新文档',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeDeployReport();

    await expect(deployDone('json')).rejects.toThrow('process.exit(1)');

    const parsed = JSON.parse(con.errors[0]);
    expect(parsed.error.code).toBe('DEPLOYMENT_NOT_REQUIRED');
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
  });
});
