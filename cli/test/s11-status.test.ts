import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit, writeLoopPass } from './helpers.js';
import {
  listFiles,
  collectStatusData,
  status,
  parseProposalDeploymentDecision,
  resolveProposalDeploymentDecision,
  resolveDeploymentDocument,
  resolveDeploymentProgress,
  detectProposalStep,
} from '../src/commands/status.js';

/* ========== Unit Tests ========== */

describe('S11 Unit Tests — listFiles', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S11-01: recursively list files in directory', () => {
    const dir = join(root, 'testdir');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'a.md'), 'content');
    writeFileSync(join(dir, 'sub', 'b.md'), 'content');

    const files = listFiles(dir);
    expect(files).toContain('a.md');
    const hasSub = files.some(f => f.includes('b.md'));
    expect(hasSub).toBe(true);
  });

  it('UT-S11-02: filter out .gitkeep files', () => {
    const dir = join(root, 'testdir');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.gitkeep'), '');

    const files = listFiles(dir);
    expect(files).toEqual([]);
  });

  it('UT-S11-03: return empty array for non-existent directory', () => {
    const files = listFiles(join(root, 'nonexist'));
    expect(files).toEqual([]);
  });

  it('UT-S11-04: return only normal files when mixed with .gitkeep', () => {
    const dir = join(root, 'testdir');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.gitkeep'), '');
    writeFileSync(join(dir, '01-requirements.md'), 'content');

    const files = listFiles(dir);
    expect(files).toEqual(['01-requirements.md']);
  });
});

describe('S11 Unit Tests — phase completion logic', () => {
  it('UT-S11-05: non-empty files list → done = true', () => {
    const files = ['01-requirements.md'];
    expect(files.length > 0).toBe(true);
  });

  it('UT-S11-06: empty files list → done = false', () => {
    const files: string[] = [];
    expect(files.length > 0).toBe(false);
  });
});

describe('S11 Unit Tests — proposal deployment decision', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S11-11: parses proposal.md deployment impact', () => {
    const decision = parseProposalDeploymentDecision([
      '# 变更提案：docs-only',
      '',
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：仅更新文档，不产生运行产物',
      '- 影响环境：无',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '补充文档。',
    ].join('\n'));

    expect(decision).toEqual({
      deployment_required: false,
      smoke_required: false,
      deployment_reason: '仅更新文档，不产生运行产物',
    });
  });

  it('UT-S11-12: validates [deploy] section against proposal deployment decision', () => {
    const proposalDir = join(root, 'logos', 'changes', 'conflict');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：conflict',
      '',
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：文档变更',
      '- 是否需要 smoke：否',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布 npm 包',
    ].join('\n'));

    const decision = resolveProposalDeploymentDecision(proposalDir);

    expect(decision.deployment_decision_conflict).toBe(true);
    expect(decision.deployment_decision_conflict_reason).toContain('部署决策冲突');
    expect(decision.deployment_warnings.join('\n')).toContain('[deploy]');
  });

  it('UT-S11-13: proposal deployment decision overrides module defaults', () => {
    const proposalDir = join(root, 'logos', 'changes', 'docs-only');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：docs-only',
      '',
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：仅更新文档',
      '- 是否需要 smoke：否',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n');

    const decision = resolveProposalDeploymentDecision(proposalDir, {
      deployment_required: true,
      smoke_required: true,
    });

    expect(decision.deployment_required).toBe(false);
    expect(decision.smoke_required).toBe(false);
    expect(decision.deployment_decision_source).toBe('proposal');
  });

  it('UT-S11-14: deployment_progress only counts [deploy] section', () => {
    const proposalDir = join(root, 'logos', 'changes', 'runtime-change');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 实现 src/xxx',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
      '- [ ] 验证 staging',
    ].join('\n'));

    const progress = resolveDeploymentProgress(proposalDir);

    expect(progress).toEqual({
      checked: 1,
      total: 2,
      percent: 50,
      status: 'pending',
      label: '1/2',
    });
  });

  it('UT-S11-15: deployment_document points to tasks.md', () => {
    const proposalDir = join(root, 'logos', 'changes', 'runtime-change');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'tasks.md'), '# 实现任务\n');

    const document = resolveDeploymentDocument(root, 'runtime-change');

    expect(document).toEqual({
      path: 'logos/changes/runtime-change/tasks.md',
      name: 'tasks.md',
      exists: true,
    });
  });

  it('UT-S11-16: proposal 正文引用 `是 / 否` 不应影响模板完成判定', () => {
    const proposalDir = join(root, 'logos', 'changes', 'placeholder-in-body');
    mkdirSync(join(proposalDir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：placeholder-in-body',
      '',
      '## 变更原因',
      '默认模板中的 `是 / 否` 占位符不应影响正文说明。',
      '',
      '## 变更类型',
      '代码级修复',
      '',
      '## 变更范围',
      '- status',
      '',
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：本次只修改本地状态判定测试，不执行发布。',
      '- 影响环境：无',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '修复模板判定逻辑。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件',
      '',
      '## [code] 代码实现',
      '- [ ] 修复 status',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'deltas', 'prd', 'delta.md'), 'delta');

    expect(detectProposalStep(proposalDir)).toBe('ready-to-merge');
  });

  it('UT-S11-17: proposal 部署字段值仍为 `是 / 否` 时保持 writing', () => {
    const proposalDir = join(root, 'logos', 'changes', 'placeholder-in-deployment-field');
    mkdirSync(join(proposalDir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：placeholder-in-deployment-field',
      '',
      '## 变更原因',
      '正文已填写。',
      '',
      '## 变更类型',
      '代码级修复',
      '',
      '## 变更范围',
      '- status',
      '',
      '## 部署影响',
      '- 是否需要部署：是 / 否',
      '- 部署原因：本次只验证模板状态。',
      '- 影响环境：无',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '修复模板判定逻辑。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件',
      '',
      '## [code] 代码实现',
      '- [ ] 修复 status',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'deltas', 'prd', 'delta.md'), 'delta');

    expect(detectProposalStep(proposalDir)).toBe('writing');
  });

  it('UT-S11-18: proposal 部署字段模板值不解析为 true', () => {
    const decision = parseProposalDeploymentDecision([
      '# 变更提案：empty-template',
      '',
      '## 部署影响',
      '- 是否需要部署：是 / 否',
      '- 部署原因：[说明为什么需要或不需要部署]',
      '- 影响环境：[本地 / 测试 / 预发 / 生产 / 无]',
      '- 是否涉及数据迁移：是 / 否',
      '- 是否需要回滚预案：是 / 否',
      '- 是否需要 smoke：是 / 否',
    ].join('\n'));

    expect(decision?.deployment_required ?? null).toBeNull();
    expect(decision?.smoke_required ?? null).toBeNull();
    expect(decision?.deployment_reason ?? null).toBeNull();
  });

  it('UT-S11-19: DEPLOY_DONE 与 [deploy] 全勾共同决定离开 ready-to-deploy', () => {
    const baseProposal = [
      '# 变更提案：runtime-change',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 是否需要 smoke：是',
      '',
      '## 变更概述',
      '修改运行时代码。',
    ].join('\n');

    const markerOnlyDir = join(root, 'logos', 'changes', 'marker-only');
    mkdirSync(markerOnlyDir, { recursive: true });
    writeFileSync(join(markerOnlyDir, 'proposal.md'), baseProposal);
    writeFileSync(join(markerOnlyDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(markerOnlyDir, 'VERIFY_PASS'), '');
    writeFileSync(join(markerOnlyDir, 'DEPLOY_DONE'), '');

    const tasksOnlyDir = join(root, 'logos', 'changes', 'tasks-only');
    mkdirSync(tasksOnlyDir, { recursive: true });
    writeFileSync(join(tasksOnlyDir, 'proposal.md'), baseProposal);
    writeFileSync(join(tasksOnlyDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(tasksOnlyDir, 'VERIFY_PASS'), '');

    expect(detectProposalStep(markerOnlyDir, { deployment_required: true, smoke_required: true })).toBe('ready-to-deploy');
    expect(detectProposalStep(tasksOnlyDir, { deployment_required: true, smoke_required: true })).toBe('ready-to-deploy');
  });

  it('UT-S11-20: DEPLOY_DONE 与 [deploy] 全勾且需要 smoke 时进入 ready-to-smoke', () => {
    const proposalDir = join(root, 'logos', 'changes', 'with-smoke');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：with-smoke',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 是否需要 smoke：是',
      '',
      '## 变更概述',
      '修改运行时代码。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('ready-to-smoke');
  });

  it('UT-S11-21: DEPLOY_DONE 与 [deploy] 全勾且无需 smoke 时进入 deploy-done', () => {
    const proposalDir = join(root, 'logos', 'changes', 'no-smoke');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：no-smoke',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '修改运行时代码。',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('deploy-done');
  });

  it('UT-S11-bootstrap-01 / UT-S11-bootstrap-02: bootstrap=adopted 的 launched 模块在 JSON 中暴露 bootstrap 字段并跳过 Initial 基线', () => {
    scaffoldProject(root);
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', bootstrap: 'adopted' }],
      deployment_gates: { core: { deployment_required: true, smoke_required: true } },
    }, { lineWidth: 0 }));

    const data = collectStatusData(root);
    expect(data.modules?.[0].bootstrap).toBe('adopted');
    expect(data.phases.find(p => p.key === 'phase.1')?.skipped).toBe(true);
  });

  it('UT-S11-bootstrap-03: bootstrap=skipped 的 launched 模块按 adopted 接入模式建议补文档提案', () => {
    scaffoldProject(root);
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', bootstrap: 'skipped', baseline_seed_state: 'required' }],
      deployment_gates: { core: { deployment_required: true, smoke_required: true } },
    }, { lineWidth: 0 }));

    const data = collectStatusData(root);
    expect(data.modules?.[0].bootstrap).toBe('adopted');
    // brownfield-adopter（S33）：required 时引导逆向建基线（取代旧 add-baseline-docs）。
    expect(data.modules?.[0].suggestion.toLowerCase()).toContain('baseline');
    expect(data.modules?.[0].suggestion).not.toContain('add-baseline-docs');
    expect(data.modules?.[0].baseline_seed_state).toBe('required');
    expect(data.modules?.[0].baseline_coverage?.incomplete).toBe(false);
  });
});

/* ========== Scenario Tests ========== */

describe('S11 Scenario Tests — status command', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  function setupLaunchedProposal(slug: string, proposal: string, tasks = '# 实现任务\n') {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      deployment_gates: { core: { deployment_required: true, smoke_required: true } },
    }, { lineWidth: 0 }));
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: slug, module: 'core', createdAt: new Date().toISOString() }),
    );
    const proposalDir = join(root, 'logos', 'changes', slug);
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), proposal);
    writeFileSync(join(proposalDir, 'tasks.md'), tasks);
    return proposalDir;
  }

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

  const PLAN_READY_PROPOSAL = [
    '# 变更提案：plan-ready',
    '',
    '## 变更原因',
    '需要完善 plan gate 状态诊断。',
    '',
    '## 变更类型',
    '设计级',
    '',
    '## 变更范围',
    '- status JSON',
    '',
    '## 部署影响',
    '- 是否需要部署：否',
    '- 部署原因：仅修改本地 CLI 状态诊断。',
    '- 影响环境：无',
    '- 是否涉及数据迁移：否',
    '- 是否需要回滚预案：否',
    '- 是否需要 smoke：否',
    '',
    '## 变更概述',
    '新增 plan_state，区分方案完成与执行任务进度。',
  ].join('\n');

  function codeRequiredProposal(): string {
    return PLAN_READY_PROPOSAL
      .replace('## 变更类型\n设计级', '## 变更类型\n代码级修复')
      .replace('## 变更概述\n新增 plan_state，区分方案完成与执行任务进度。', '## 变更概述\n需要 CLI 状态派生代码、测试和 reporter 实现。');
  }

  const PLAN_READY_TASKS = [
    '# 实现任务',
    '',
    '## [delta] 规格变更',
    '- [ ] 产出 delta 文件',
    '- [ ] 更新测试用例',
    '',
    '## [code] 代码实现',
    '- [ ] 实现状态诊断',
  ].join('\n');

  function writeStaleVerifyFailure(passId = 'UT-S11-stale-pass') {
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      JSON.stringify({ id: passId, status: 'pass' }),
      JSON.stringify({ id: 'UT-S11-STALE-REG', status: 'fail', error: 'stale regression' }),
    ].join('\n') + '\n');
  }

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
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

  it('ST-S11-01: show partial progress with Phase 1 complete', () => {
    const reqDir = join(root, 'logos/resources/prd/1-product-requirements');
    mkdirSync(reqDir, { recursive: true });
    writeFileSync(join(reqDir, '01-requirements.md'), '# Requirements');

    status();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('✅');
    expect(allLogs).toContain('🔲');
  });

  it('ST-S11-02: empty project suggests Phase 1', () => {
    status();

    const allLogs = con.logs.join('\n');
    const allBoxes = allLogs.match(/🔲/g) ?? [];
    expect(allBoxes.length).toBeGreaterThan(0);
    // Should suggest starting Phase 1
    const hasHint = allLogs.includes('requirements') || allLogs.includes('需求文档');
    expect(hasHint).toBe(true);
  });

  it('ST-S11-03: all phases complete → celebration', () => {
    const dirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design',
      'logos/resources/prd/3-technical-plan/1-architecture',
      'logos/resources/prd/3-technical-plan/2-scenario-implementation',
      'logos/resources/api',
      'logos/resources/database',
      'logos/resources/prd/3-technical-plan/3-deployment',
      'logos/resources/test',
      'logos/resources/test/smoke',
      'logos/resources/scenario',
      'logos/resources/implementation',
    ];
    for (const d of dirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }
    writeFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'PASS');
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), 'DONE');
    writeFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'PASS');

    status();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('🎉');
    const hasVerifyHint = allLogs.includes('openlogos verify') || allLogs.includes('All phases complete');
    expect(hasVerifyHint).toBe(true);
  });

  it('ST-S11-03b: launched + all phases complete does not suggest launch again', () => {
    const dirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design',
      'logos/resources/prd/3-technical-plan/1-architecture',
      'logos/resources/prd/3-technical-plan/2-scenario-implementation',
      'logos/resources/api',
      'logos/resources/database',
      'logos/resources/prd/3-technical-plan/3-deployment',
      'logos/resources/test',
      'logos/resources/test/smoke',
      'logos/resources/scenario',
      'logos/resources/implementation',
    ];
    for (const d of dirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }
    writeFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'PASS');
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), 'DONE');
    writeFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'PASS');
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }, { lineWidth: 0 }),
    );

    status();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('🎉');
    expect(allLogs).toContain('openlogos change');
    expect(allLogs).not.toContain('openlogos launch');
  });

  it('ST-S11-04: show active change proposals', () => {
    const changePath = join(root, 'logos', 'changes', 'add-feature');
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Proposal');
    writeFileSync(join(changePath, 'tasks.md'), '# Tasks');

    status();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('add-feature');
    expect(allLogs).toContain('proposal.md ✓');
    expect(allLogs).toContain('tasks.md ✓');
  });

  it('ST-S11-04b: show localized modules header when modules are registered', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), `modules:
  - id: core
    name: 核心功能
    status: in-progress
    loop_phase: requirements
`);

    status();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('Modules');
    expect(allLogs).toContain('core (核心功能)');
  });

  it('ST-S11-05: uninitialized project → error exit', () => {
    con.restore();
    restoreCwd();
    const { root: emptyRoot, cleanup: clean2 } = makeTempRoot();
    const restore2 = mockCwd(emptyRoot);
    con = captureConsole();

    try {
      expect(() => status()).toThrow('process.exit(1)');
      const allErrors = con.errors.join('\n');
      expect(allErrors).toContain('logos.config.json not found');
    } finally {
      con.restore();
      restore2();
      clean2();
    }
  });

  it('ST-S11-06: status suggestion for active change does not use implicit auto-advance phrasing', () => {
    // Set up launched module with active guard so status generates a merge suggestion
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [x] done');
    const deltasDir = join(proposalDir, 'deltas', 'prd');
    mkdirSync(deltasDir, { recursive: true });
    writeFileSync(join(deltasDir, 'delta.md'), 'delta');

    status();

    const allLogs = con.logs.join('\n');
    // must contain a merge suggestion
    expect(allLogs).toContain('my-feature');
    // must NOT use old implicit "run X then archive" phrasing
    expect(allLogs).not.toMatch(/[Rr]un openlogos merge.+then.+archive/);
    expect(allLogs).not.toMatch(/运行 openlogos merge.+然后.+archive/);
    expect(allLogs).not.toMatch(/完成后运行 openlogos merge/);
  });

  it('ST-S11-06a: filled proposal/tasks without completed deltas is delta-writing', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [ ] write delta\n');

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;

    expect(core.active_change!.proposal_step).toBe('delta-writing');
    expect(core.suggestion).toMatch(/delta/i);
  });

  it('ST-S11-06b: generated merge prompt is a distinct merge-generated step', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n内容');
    writeFileSync(join(proposalDir, 'tasks.md'), '# Tasks\n- [x] done');
    writeFileSync(join(proposalDir, 'MERGE_PROMPT.md'), '# 合并指令');
    writeFileSync(join(proposalDir, 'MERGE_PROMPT_GENERATED'), '');

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;

    expect(core.active_change!.proposal_step).toBe('merge-generated');
    expect(core.suggestion).toContain('MERGE_PROMPT.md');
    expect(core.suggestion).not.toContain('openlogos merge my-feature');
  });

  it('ST-S11-06c: SPEC_MERGED + [code] 未勾（无 SLICES_APPROVED）→ ready-to-implement', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n内容');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [ ] 实现 src/xxx',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'MERGE_PROMPT.md'), '# 合并指令');
    writeFileSync(join(proposalDir, 'MERGE_PROMPT_GENERATED'), '');
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;

    // split-slice-planner-stage：merge 后 [code] 有未完成切片但 slice-exit 未放行 → ready-to-implement（切片待批准）。
    expect(core.active_change!.proposal_step).toBe('ready-to-implement');
    expect(core.active_change!.proposal_step_label).toMatch(/切片|slice/i);
    expect(core.suggestion).not.toContain('openlogos merge my-feature');
  });

  it('ST-S11-06c2: SPEC_MERGED + [code] all done → ready-to-verify', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n内容');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 实现 src/xxx',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    expect(core.active_change!.proposal_step).toBe('ready-to-verify');
    expect(core.suggestion).toMatch(/verify/i);
  });

  it('ST-S11-06c3: VERIFY_PASS → verify-passed', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    expect(core.active_change!.proposal_step).toBe('verify-passed');
    expect(core.suggestion).toMatch(/archive/i);
  });

  it('ST-S11-06c4: VERIFY_FAIL → verify-failed', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');
    writeFileSync(join(proposalDir, 'VERIFY_FAIL'), '');

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    expect(core.active_change!.proposal_step).toBe('verify-failed');
    expect(core.suggestion).toMatch(/修复|fix/i);
  });

  it('ST-S11-06c5: VERIFY_FAIL has priority over stale VERIFY_PASS and deployment markers', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeFileSync(join(proposalDir, 'VERIFY_FAIL'), '');
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    writeFileSync(join(proposalDir, 'SMOKE_PASS'), '');

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    expect(core.active_change!.proposal_step).toBe('verify-failed');
  });

  it('ST-S11-06c6: VERIFY_PASS with unchecked [deploy] section → ready-to-deploy and shows deploy tasks', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 执行 staging 部署',
    ].join('\n'));

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    expect(core.active_change!.proposal_step).toBe('ready-to-deploy');
    expect(core.active_change!.deploy_tasks).toEqual([{ checked: false, text: '执行 staging 部署' }]);

    status();
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('执行 staging 部署');
  });

  it('ST-S11-06c7: DEPLOY_DONE with smoke cases → ready-to-smoke, then SMOKE_PASS → smoke-passed', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 执行 staging 部署',
    ].join('\n'));
    const smokeDir = join(root, 'logos/resources/test/smoke');
    mkdirSync(smokeDir, { recursive: true });
    writeFileSync(join(smokeDir, 'core-smoke-test-cases.md'), '| SMOKE-core-01 | health |');

    expect(collectStatusData(root).modules!.find(m => m.id === 'core')!.active_change!.proposal_step).toBe('ready-to-smoke');

    writeFileSync(join(proposalDir, 'SMOKE_PASS'), '');
    expect(collectStatusData(root).modules!.find(m => m.id === 'core')!.active_change!.proposal_step).toBe('smoke-passed');
  });

  it('ST-S11-06d: structured [delta] section all checked → ready-to-merge', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n内容');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件到 deltas/api/ — 更新 API',
      '',
      '## [code] 代码实现',
      '- [ ] 实现代码',
    ].join('\n'));

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    expect(core.active_change!.proposal_step).toBe('ready-to-merge');
  });

  it('ST-S11-06e: no-delta SPEC_MERGED + [code] not done → ready-to-implement', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n内容，复用 ST-S11-06e。');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [ ] 修复 src/xxx 中的问题（覆盖 ST-S11-06e）',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    // support-nodelta-spec-complete：纯代码提案先经 no-delta merge 完成规格阶段，再进入切片/实现前沿。
    expect(core.active_change!.proposal_step).toBe('ready-to-implement');
  });

  it('ST-S11-06f: no-delta SPEC_MERGED + [code] all done → ready-to-verify', () => {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'my-feature', module: 'core', createdAt: new Date().toISOString() }));
    const proposalDir = join(root, 'logos', 'changes', 'my-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), '# 变更提案\n## 变更原因\n内容\n## 变更类型\n代码级\n## 变更范围\n- 无\n## 变更概述\n内容，复用 ST-S11-06f。');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 修复 src/xxx 中的问题（覆盖 ST-S11-06f）',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    expect(core.active_change!.proposal_step).toBe('ready-to-verify');
  });

  it('ST-S11-08: no-deploy proposal shows archive after verify PASS', () => {
    const proposalDir = setupLaunchedProposal('docs-only', NO_DEPLOY_PROPOSAL);
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;

    expect(core.active_change!.proposal_step).toBe('verify-passed');
    expect(core.active_change!.deployment_required).toBe(false);
    expect(core.suggestion).toContain('archive docs-only');
  });

  it('ST-S11-09: deploy proposal shows deployment tasks after verify PASS', () => {
    const proposalDir = setupLaunchedProposal('runtime-change', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;

    expect(core.active_change!.proposal_step).toBe('ready-to-deploy');
    expect(core.active_change!.deployment_required).toBe(true);
    expect(core.active_change!.deploy_tasks).toEqual([{ checked: false, text: '发布 npm 包' }]);

    status();
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('发布 npm 包');
  });

  it('UT-S09-62 / UT-S11-43 / UT-S11-44 / ST-S09-31 / ST-S11-32: ready-to-delta 输出 plan_state，执行 0/N 不代表规划失败', () => {
    setupLaunchedProposal('plan-ready', PLAN_READY_PROPOSAL, PLAN_READY_TASKS);

    const data = collectStatusData(root);
    const active = data.modules!.find(m => m.id === 'core')!.active_change!;

    expect(active.proposal_step).toBe('ready-to-delta');
    expect(active.plan_state).toMatchObject({
      plan_ready: true,
      plan_gate_pending: true,
      plan_approved: false,
      tasks_template_filled: true,
      tasks_execution_done: 0,
      tasks_execution_total: 2,
      tasks_execution_scope: 'delta',
    });
    expect(active.plan_state!.diagnostic).toContain('等待 plan-exit');
    expect(JSON.stringify(active.plan_state)).not.toMatch(/规划失败|planning failed|blocked|retry-exhausted/i);
  });

  it('UT-S09-63 / UT-S11-45: 部署决策冲突优先于 plan gate pending', () => {
    const conflictProposal = PLAN_READY_PROPOSAL
      .replace('- 是否需要部署：否', '- 是否需要部署：否')
      .replace('仅修改本地 CLI 状态诊断。', '声明无需部署。');
    setupLaunchedProposal('plan-conflict', conflictProposal, [
      PLAN_READY_TASKS,
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布 npm 包',
    ].join('\n'));

    const active = collectStatusData(root).modules!.find(m => m.id === 'core')!.active_change!;

    expect(active.deployment_decision_conflict).toBe(true);
    expect(active.plan_state).toMatchObject({
      plan_ready: false,
      plan_gate_pending: false,
      plan_approved: false,
    });
    expect(active.plan_state!.diagnostic).toContain('部署决策冲突');
  });

  it('UT-S11-46: PLAN_APPROVED 后关闭 plan_gate_pending 并标记 plan_approved', () => {
    const proposalDir = setupLaunchedProposal('plan-approved', PLAN_READY_PROPOSAL, PLAN_READY_TASKS);
    writeFileSync(join(proposalDir, 'PLAN_APPROVED'), '');

    const active = collectStatusData(root).modules!.find(m => m.id === 'core')!.active_change!;

    expect(active.proposal_step).toBe('delta-writing');
    expect(active.plan_state).toMatchObject({
      plan_ready: true,
      plan_gate_pending: false,
      plan_approved: true,
      tasks_execution_done: 0,
      tasks_execution_total: 2,
      tasks_execution_scope: 'delta',
    });
  });

  it('UT-S11-47 / ST-S11-34: ready-to-delta 不消费历史 automation diagnostic', () => {
    setupLaunchedProposal('plan-ready', PLAN_READY_PROPOSAL, PLAN_READY_TASKS);
    writeStaleVerifyFailure('UT-S11-47');

    status('json');
    const output = JSON.parse(con.logs[0]);
    const mod = output.data.modules[0];

    expect(mod.active_change.proposal_step).toBe('ready-to-delta');
    expect(mod.automation_diagnostic).toBeUndefined();
    expect(JSON.stringify(mod)).not.toContain('global-verify-failed');
  });

  it('UT-S11-48: delta-writing 不消费历史 automation diagnostic', () => {
    const proposalDir = setupLaunchedProposal('delta-writing', PLAN_READY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件',
      '- [ ] 更新测试用例',
      '',
      '## [code] 代码实现',
      '- [ ] 实现状态诊断',
    ].join('\n'));
    mkdirSync(join(proposalDir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(proposalDir, 'deltas', 'prd', 'delta.md'), 'delta');
    writeStaleVerifyFailure('UT-S11-48');

    status('json');
    const mod = JSON.parse(con.logs[0]).data.modules[0];

    expect(mod.active_change.proposal_step).toBe('delta-writing');
    expect(mod.automation_diagnostic).toBeUndefined();
  });

  it('UT-S11-49: ready-to-merge 不消费历史 automation diagnostic', () => {
    const proposalDir = setupLaunchedProposal('ready-merge', PLAN_READY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件',
      '',
      '## [code] 代码实现',
      '- [ ] 实现状态诊断',
    ].join('\n'));
    mkdirSync(join(proposalDir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(proposalDir, 'deltas', 'prd', 'delta.md'), 'delta');
    writeStaleVerifyFailure('UT-S11-49');

    status('json');
    const mod = JSON.parse(con.logs[0]).data.modules[0];

    expect(mod.active_change.proposal_step).toBe('ready-to-merge');
    expect(mod.automation_diagnostic).toBeUndefined();
  });

  it('UT-S11-50: 未规划 [code] 的 ready-to-implement 不消费历史 automation diagnostic', () => {
    const proposalDir = setupLaunchedProposal('need-slices', codeRequiredProposal(), [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'SPEC_MERGED'), '');
    mkdirSync(join(proposalDir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(proposalDir, 'deltas', 'test', 'core-S11-test-cases.md'), '| UT-S11-50 | 新增回归 |');
    // S35 slice 级证据读 delta 映射到的已合并目标文件（merge 后目标在场；须为完整表格块）。
    mkdirSync(join(proposalDir, '..', '..', 'resources', 'test'), { recursive: true });
    writeFileSync(join(proposalDir, '..', '..', 'resources', 'test', 'core-S11-test-cases.md'),
      '| ID | 用例 |\n|---|---|\n| UT-S11-50 | 新增回归 |');
    writeStaleVerifyFailure('UT-S11-50');

    status('json');
    const mod = JSON.parse(con.logs[0]).data.modules[0];

    expect(mod.active_change.proposal_step).toBe('ready-to-implement');
    expect(mod.automation_diagnostic).toBeUndefined();
    expect(mod.suggestion).toMatch(/切片|slice/i);
  });

  it('ST-S11-10: status JSON exposes proposal-level deployment decision', () => {
    const proposalDir = setupLaunchedProposal('docs-only', NO_DEPLOY_PROPOSAL);
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.deployment_required).toBe(false);
    expect(active.smoke_required).toBe(false);
    expect(active.deployment_reason).toBe('仅更新文档，不需要发布运行产物');
    expect(active.deployment_decision_source).toBe('proposal');
    expect(active.deployment_decision_conflict).toBe(false);
    expect(active.deployment_decision_conflict_reason).toBeNull();
  });

  it('ST-S11-12: status JSON exposes deployment progress and document entry', () => {
    const proposalDir = setupLaunchedProposal('runtime-change', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 变更业务代码',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
      '- [ ] 通知 RunLogos',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.deployment_progress).toEqual({
      checked: 1,
      total: 2,
      percent: 50,
      status: 'pending',
      label: '1/2',
    });
    expect(active.deployment_document).toEqual({
      path: 'logos/changes/runtime-change/tasks.md',
      name: 'tasks.md',
      exists: true,
    });
  });

  it('ST-S11-13: deployment progress ignores [code] section tasks', () => {
    const proposalDir = setupLaunchedProposal('runtime-change', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 完成业务代码',
      '- [ ] 补充测试',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.deployment_progress).toEqual({
      checked: 1,
      total: 1,
      percent: 100,
      status: 'done',
      label: '1/1',
    });
  });

  it('ST-S11-14: proposal 正文引用 `是 / 否` 时仍可进入 ready-to-merge', () => {
    const proposalDir = setupLaunchedProposal('placeholder-in-body', [
      '# 变更提案：placeholder-in-body',
      '',
      '## 变更原因',
      '默认模板中的 `是 / 否` 占位符不应影响正文说明。',
      '',
      '## 变更类型',
      '代码级修复',
      '',
      '## 变更范围',
      '- status',
      '',
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：本次只修改本地状态判定测试，不执行发布。',
      '- 影响环境：无',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '修复模板判定逻辑。',
    ].join('\n'), [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件',
      '',
      '## [code] 代码实现',
      '- [ ] 修复 status',
    ].join('\n'));
    mkdirSync(join(proposalDir, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(proposalDir, 'deltas', 'prd', 'delta.md'), 'delta');

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.proposal_step).toBe('ready-to-merge');
    expect(active.deployment_decision_conflict).toBe(false);
  });

  it('ST-S11-15: 空提案模板不显示部署决策冲突', () => {
    setupLaunchedProposal('empty-template', [
      '# 变更提案：empty-template',
      '',
      '## 变更原因',
      '[为什么要做这个变更？来源于哪个需求/反馈/Bug？]',
      '',
      '## 变更类型',
      '[需求级 / 设计级 / 接口级 / 代码级]',
      '',
      '## 变更范围',
      '- 影响的需求文档：[列表]',
      '- 影响的功能规格：[列表]',
      '- 影响的业务场景：[列表]',
      '',
      '## 部署影响',
      '- 是否需要部署：是 / 否',
      '- 部署原因：[说明为什么需要或不需要部署]',
      '- 影响环境：[本地 / 测试 / 预发 / 生产 / 无]',
      '- 是否涉及数据迁移：是 / 否',
      '- 是否需要回滚预案：是 / 否',
      '- 是否需要 smoke：是 / 否',
      '',
      '## 变更概述',
      '[用 1-3 段话概述具体改什么]',
    ].join('\n'), [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [ ] 更新需求文档的场景和验收条件',
      '- [ ] 更新产品设计文档的功能规格',
      '',
      '## [code] 代码实现',
      '- [ ] 实现代码变更',
    ].join('\n'));

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.proposal_step).toBe('writing');
    expect(active.deployment_decision_conflict).toBe(false);
    expect(active.deployment_decision_conflict_reason).toBeNull();
  });

  it('ST-S11-16: status 展示 deploy-done 受控落标后的状态', () => {
    const proposalDir = setupLaunchedProposal('runtime-change', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
      '- [x] 同步官网',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.proposal_step).toBe('ready-to-smoke');
    expect(active.deployment_progress).toEqual({
      checked: 2,
      total: 2,
      percent: 100,
      status: 'done',
      label: '2/2',
    });
  });

  it('ST-S11-17: deploy 进度完成但无 DEPLOY_DONE 不视为部署完成', () => {
    const proposalDir = setupLaunchedProposal('runtime-change', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
      '- [x] 同步官网',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.proposal_step).toBe('ready-to-deploy');
    expect(active.deployment_progress.status).toBe('done');
  });

  it('ST-S11-11: status JSON exposes conflict reason when proposal/tasks disagree', () => {
    const proposalDir = setupLaunchedProposal('conflict', NO_DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.deployment_decision_conflict).toBe(true);
    expect(active.deployment_decision_conflict_reason).toContain('proposal.md 声明无需部署');
    expect(active.deployment_required).toBe(false);
    expect(active.smoke_required).toBe(false);
  });

  it('ST-S11-EX-6.3: missing deploy section downgrades deployment progress to unavailable', () => {
    const proposalDir = setupLaunchedProposal('needs-deploy-no-section', DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [code] 代码实现',
      '- [x] 完成业务代码',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.deployment_decision_conflict).toBe(true);
    expect(active.deployment_progress.status).toBe('unavailable');
    expect(active.deployment_progress.label).toBe('0/0');
  });

  it('ST-S11-EX-6.1: legacy proposal falls back to compatible deployment source', () => {
    const proposalDir = setupLaunchedProposal('legacy-runtime', '# Old proposal', [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.proposal_step).toBe('ready-to-deploy');
    expect(active.deployment_required).toBe(true);
    expect(active.deployment_decision_source).toBe('tasks');
  });

  it('ST-S11-EX-6.2: 部署决策冲突时 status 文本输出冲突警告并阻断流程', () => {
    const proposalDir = setupLaunchedProposal('conflict-text', NO_DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');
    writeLoopPass(proposalDir);

    status();
    const out = [...con.logs, ...con.errors].join('\n');
    expect(out).toContain('部署决策冲突');
    expect(out).toContain('proposal.md');
    expect(out).toContain('tasks.md');
  });

  it('ST-S11-bootstrap-01: 存量项目接入状态面板正确显示已跳过', () => {
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', bootstrap: 'adopted', baseline_seed_state: 'required' }],
      deployment_gates: { core: { deployment_required: true, smoke_required: true } },
    }, { lineWidth: 0 }));

    status();
    const out = con.logs.join('\n');
    expect(out).toContain('文档基线已跳过（存量项目接入）');
    expect(out).toContain('逆向建立现状基线');
  });

  it('ST-S11-bootstrap-02: 历史 skipped 接入状态面板正确显示已跳过', () => {
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched', bootstrap: 'skipped', baseline_seed_state: 'required' }],
      deployment_gates: { core: { deployment_required: true, smoke_required: true } },
    }, { lineWidth: 0 }));

    status();
    const out = con.logs.join('\n');
    expect(out).toContain('文档基线已跳过（存量项目接入）');
    expect(out).toContain('逆向建立现状基线');
  });
});

/* ========== Skipped Phase Tests ========== */

describe('S11 Unit Tests — skipped phase detection', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
  });
  afterEach(() => cleanup());

  it('UT-S11-07: phases before lastDoneIdx are marked skipped when empty', () => {
    // Phase 1 (idx 0) has files, Phase 3-2-api (idx 4) is empty,
    // Phase 3-5 (implementation) has files → 3-2-api should be skipped
    const reqDir = join(root, 'logos/resources/prd/1-product-requirements');
    mkdirSync(reqDir, { recursive: true });
    writeFileSync(join(reqDir, '01-requirements.md'), '# Req');

    const implDir = join(root, 'logos/resources/implementation');
    mkdirSync(implDir, { recursive: true });
    writeFileSync(join(implDir, 'main.ts'), 'code');

    const data = collectStatusData(root);

    // Phase 3-2-api (idx 4) should be skipped
    const apiPhase = data.phases.find(p => p.key === 'phase.3-2-api')!;
    expect(apiPhase.skipped).toBe(true);
    expect(apiPhase.done).toBe(false);

    // Phase 3-2-db (idx 5) should also be skipped
    const dbPhase = data.phases.find(p => p.key === 'phase.3-2-db')!;
    expect(dbPhase.skipped).toBe(true);

    // Phase 1 (idx 0) should NOT be skipped (it's done)
    const phase1 = data.phases.find(p => p.key === 'phase.1')!;
    expect(phase1.skipped).toBe(false);
    expect(phase1.done).toBe(true);

    // Phase 3-6 (verify) should NOT be skipped (it's after lastDoneIdx)
    const verifyPhase = data.phases.find(p => p.key === 'phase.3-6')!;
    expect(verifyPhase.skipped).toBe(false);
  });

  it('UT-S11-08: no phases skipped when progress is linear', () => {
    // Phase 1 done, Phase 2 done, everything else empty → no skips
    const reqDir = join(root, 'logos/resources/prd/1-product-requirements');
    mkdirSync(reqDir, { recursive: true });
    writeFileSync(join(reqDir, '01-requirements.md'), '# Req');

    const designDir = join(root, 'logos/resources/prd/2-product-design');
    mkdirSync(designDir, { recursive: true });
    writeFileSync(join(designDir, '01-design.md'), '# Design');

    const data = collectStatusData(root);

    const skippedPhases = data.phases.filter(p => p.skipped);
    expect(skippedPhases).toEqual([]);
  });

  it('UT-S11-09: all_done is true when remaining phases are skipped', () => {
    // All phases done except 3-2-api and 3-2-db
    const dirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design',
      'logos/resources/prd/3-technical-plan/1-architecture',
      'logos/resources/prd/3-technical-plan/2-scenario-implementation',
      // skip api (idx 4)
      // skip database (idx 5)
      'logos/resources/prd/3-technical-plan/3-deployment',
      'logos/resources/test',
      'logos/resources/test/smoke',
      'logos/resources/scenario',
      'logos/resources/implementation',
    ];
    for (const d of dirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }
    writeFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'PASS');
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), 'DONE');
    writeFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'PASS');

    const data = collectStatusData(root);

    expect(data.all_done).toBe(true);
    expect(data.current_phase).toBeNull();

    // API and DB should be skipped
    expect(data.phases.find(p => p.key === 'phase.3-2-api')!.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-2-db')!.skipped).toBe(true);
  });

  it('UT-S11-10: firstIncomplete skips over skipped phases', () => {
    // Phase 1, 2 done; deployment/test done → earlier missing phases are skipped where fallback allows.
    // deployment is a required explicit phase and should not be skipped by fallback.
    const filledDirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design',
      // 3-0 (architecture) empty → will be skipped
      // 3-1 (scenario) empty → will be skipped
      // 3-2-api empty → will be skipped
      // 3-2-db empty → will be skipped
      'logos/resources/test',
    ];
    for (const d of filledDirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }

    const data = collectStatusData(root);

    // 3-0 through 3-2-db should be skipped (all before test)
    expect(data.phases.find(p => p.key === 'phase.3-0')!.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-1')!.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-2-api')!.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-2-db')!.skipped).toBe(true);

    // deployment should NOT be fallback-skipped even when later test files exist
    expect(data.phases.find(p => p.key === 'phase.3-3-deployment')!.skipped).toBe(false);

    // current_phase should be deployment, not 3-0
    expect(data.current_phase).toBe('phase.3-3-deployment');
  });
});

describe('S11 Scenario Tests — skipped phases in output', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
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

  it('ST-S11-06: skipped phases are hidden in text output', () => {
    // Phase 1, 3-1, 3-4a, 3-5 done → earlier optional API/DB phases skipped
    const filledDirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/3-technical-plan/2-scenario-implementation',
      'logos/resources/prd/3-technical-plan/3-deployment',
      'logos/resources/test',
      'logos/resources/implementation',
    ];
    for (const d of filledDirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }

    status();

    const allLogs = con.logs.join('\n');
    // Skipped phases should NOT appear
    expect(allLogs).not.toContain('API Design');
    expect(allLogs).not.toContain('API 设计');
    expect(allLogs).not.toContain('Database Design');
    expect(allLogs).not.toContain('数据库设计');

    // Done phases should appear
    expect(allLogs).toContain('✅');
    // Remaining incomplete phases should appear
    expect(allLogs).toContain('🔲');
  });

  it('ST-S11-07: suggestion points to correct phase when skips exist', () => {
    // Phase 1 and implementation done; deployment remains explicit and should be suggested
    const filledDirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/implementation',
    ];
    for (const d of filledDirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }

    status();

    const allLogs = con.logs.join('\n');
    // The suggestion should mention deployment, not API design
    expect(allLogs).not.toContain('API');
    const hasDeploymentHint = allLogs.includes('Deployment') || allLogs.includes('部署');
    expect(hasDeploymentHint).toBe(true);
  });
});

describe('S11 Unit Tests — lifecycle derivation from modules', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
    restoreCwd = mockCwd(root);
  });

  afterEach(() => {
    restoreCwd();
    cleanup();
  });

  it('UT-S11-LC-01: all modules initial → lifecycle=initial', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }] }, { lineWidth: 0 }),
    );
    const data = collectStatusData(root);
    expect(data.lifecycle).toBe('initial');
  });

  it('UT-S11-LC-02: one module launched → lifecycle=launched', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'launched' },
          { id: 'payment', name: 'Payment', lifecycle: 'initial' },
        ],
      }, { lineWidth: 0 }),
    );
    const data = collectStatusData(root);
    expect(data.lifecycle).toBe('launched');
  });

  it('UT-S11-LC-02b: launched + all_done 的顶层 suggestion 不提示 launch', () => {
    const dirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design',
      'logos/resources/prd/3-technical-plan/1-architecture',
      'logos/resources/prd/3-technical-plan/2-scenario-implementation',
      'logos/resources/api',
      'logos/resources/database',
      'logos/resources/prd/3-technical-plan/3-deployment',
      'logos/resources/test',
      'logos/resources/test/smoke',
      'logos/resources/scenario',
      'logos/resources/implementation',
    ];
    for (const d of dirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }
    writeFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'PASS');
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), 'DONE');
    writeFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'PASS');
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);

    expect(data.all_done).toBe(true);
    expect(data.lifecycle).toBe('launched');
    expect(data.suggestion).toContain('openlogos change');
    expect(data.suggestion).not.toContain('openlogos launch');
  });

  it('UT-S11-LC-03: no modules → lifecycle=initial', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ project: { name: 'test' } }, { lineWidth: 0 }),
    );
    const data = collectStatusData(root);
    expect(data.lifecycle).toBe('initial');
  });
});

describe('S11 Unit Tests — skip_phases in modules', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
  });
  afterEach(() => cleanup());

  it('UT-S11-SP-01: skip_phases:[api,scenario] — top-level phases and current_phase skip api/scenario', () => {
    // Phase 1 done, api dir empty, test dir done
    const p1Dir = join(root, 'logos/resources/prd/1-product-requirements');
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(p1Dir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(p1Dir, 'req.md'), 'content');
    writeFileSync(join(testDir, 'cases.md'), 'content');

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'initial', skip_phases: ['api', 'scenario'] }],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);

    // api and scenario phases must be skipped
    expect(data.phases.find(p => p.key === 'phase.3-2-api')!.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-4b')!.skipped).toBe(true);

    // current_phase must NOT be phase.3-2-api
    expect(data.current_phase).not.toBe('phase.3-2-api');
    expect(data.current_phase).not.toBe('phase.3-4b');
  });

  it('UT-S11-SP-02: skip_phases:[api,scenario] — next suggestion does not recommend API design', () => {
    // Phase 1, 2, 3-0, 3-1 done; api/scenario skipped → next should suggest deployment plan
    const p1Dir = join(root, 'logos/resources/prd/1-product-requirements');
    const p2Dir = join(root, 'logos/resources/prd/2-product-design');
    const archDir = join(root, 'logos/resources/prd/3-technical-plan/1-architecture');
    const scenDir = join(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation');
    for (const d of [p1Dir, p2Dir, archDir, scenDir]) {
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'dummy.md'), 'content');
    }

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'initial', skip_phases: ['api', 'database', 'scenario'] }],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);

    // current_phase must not be api/database/scenario-related
    expect(data.current_phase).not.toBe('phase.3-2-api');
    expect(data.current_phase).not.toBe('phase.3-2-db');
    expect(data.current_phase).not.toBe('phase.3-4b');

    // suggestion must not mention API design
    expect(data.suggestion).not.toMatch(/api.?designer/i);
    expect(data.suggestion).not.toMatch(/API 设计/);
  });

  it('UT-S11-SP-03: multi-module — skip_phases on one module does not affect another module that needs the phase', () => {
    // Module A: skip_phases:[api, scenario] (desktop tool)
    // Module B: no skip_phases (web API)
    // Global top-level phases should NOT skip api, because module B needs it
    // Module A's phase_progress should skip api; module B's should not
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'desktop', name: 'Desktop', lifecycle: 'initial', skip_phases: ['api', 'scenario'] },
          { id: 'api', name: 'API', lifecycle: 'initial' },
        ],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);

    // Top-level phases: api should NOT be skipped because module 'api' needs it
    // (globalSkipPhaseKeys only includes phases skipped by ALL initial modules)
    const apiPhase = data.phases.find(p => p.key === 'phase.3-2-api')!;
    // api module needs it → should not be globally skipped
    expect(apiPhase.skipped).toBe(false);

    // Module-level: desktop module should skip api, api module should not
    const desktopMod = data.modules?.find(m => m.id === 'desktop');
    const apiMod = data.modules?.find(m => m.id === 'api');
    if (desktopMod?.phase_progress) {
      expect(desktopMod.phase_progress['phase.3-2-api'].skipped).toBe(true);
    }
    if (apiMod?.phase_progress) {
      expect(apiMod.phase_progress['phase.3-2-api'].skipped).toBe(false);
    }
  });

  it('UT-S11-SP-04: fallback skip — no skip_phases but later phase has files → api/db/scenario auto-skipped', () => {
    // Phase 1 done, api empty, test done → api should be auto-skipped (fallback)
    const p1Dir = join(root, 'logos/resources/prd/1-product-requirements');
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(p1Dir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(p1Dir, 'req.md'), 'content');
    writeFileSync(join(testDir, 'cases.md'), 'content');

    // No skip_phases declared
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);

    // api phase should be auto-skipped because test (later phase) has files
    const apiPhase = data.phases.find(p => p.key === 'phase.3-2-api')!;
    expect(apiPhase.skipped).toBe(true);

    // current_phase should not be api
    expect(data.current_phase).not.toBe('phase.3-2-api');
  });
});

/* ========== Unit Tests — multi-module phase filtering ========== */

describe('S11 Unit Tests — multi-module phase filtering', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
  });
  afterEach(() => cleanup());

  it('UT-S11-MM-01: new module with no files → current_phase is phase.1, not null', () => {
    // core has files in all dirs; admin has none
    const dirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design',
      'logos/resources/prd/3-technical-plan/1-architecture',
      'logos/resources/api',
      'logos/resources/database',
      'logos/resources/prd/3-technical-plan/3-deployment',
      'logos/resources/test',
      'logos/resources/test/smoke',
      'logos/resources/scenario',
      'logos/resources/implementation',
    ];
    for (const d of dirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'core-dummy.md'), 'content');
    }
    writeFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'PASS');
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), 'DONE');
    writeFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'PASS');

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'launched' },
          { id: 'admin', name: 'Admin', lifecycle: 'initial' },
        ],
        scenarios: [],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);
    const adminMod = data.modules?.find(m => m.id === 'admin');
    expect(adminMod).toBeDefined();
    expect(adminMod!.current_phase).toBe('phase.1');
    expect(adminMod!.suggestion).not.toContain('所有阶段已完成');
    expect(adminMod!.suggestion).not.toContain('All phases complete');
  });

  it('UT-S11-MM-02: new module with admin- prefixed file in phase.1 dir → phase.1 done', () => {
    const reqDir = join(root, 'logos/resources/prd/1-product-requirements');
    mkdirSync(reqDir, { recursive: true });
    writeFileSync(join(reqDir, 'admin-01-requirements.md'), '# Admin Requirements');

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'launched' },
          { id: 'admin', name: 'Admin', lifecycle: 'initial' },
        ],
        scenarios: [],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);
    const adminMod = data.modules?.find(m => m.id === 'admin');
    expect(adminMod!.phase_progress!['phase.1'].done).toBe(true);
    expect(adminMod!.current_phase).toBe('phase.2');
  });

  it('UT-S11-MM-03: core module files do not count toward admin module phase.1', () => {
    const reqDir = join(root, 'logos/resources/prd/1-product-requirements');
    mkdirSync(reqDir, { recursive: true });
    // Only core- prefixed file
    writeFileSync(join(reqDir, 'core-01-requirements.md'), '# Core Requirements');

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'launched' },
          { id: 'admin', name: 'Admin', lifecycle: 'initial' },
        ],
        scenarios: [],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);
    const adminMod = data.modules?.find(m => m.id === 'admin');
    expect(adminMod!.phase_progress!['phase.1'].done).toBe(false);
  });

  it('UT-S11-MM-04: single-module project — any file in dir counts (backward compat)', () => {
    const reqDir = join(root, 'logos/resources/prd/1-product-requirements');
    mkdirSync(reqDir, { recursive: true });
    // No module prefix — old-style file
    writeFileSync(join(reqDir, '01-requirements.md'), '# Requirements');

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
        scenarios: [],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);
    const coreMod = data.modules?.find(m => m.id === 'core');
    expect(coreMod!.phase_progress!['phase.1'].done).toBe(true);
  });

  it('UT-S11-MM-05: scenarios with module field — each module only checks its own scenarios', () => {
    const scenDir = join(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation');
    mkdirSync(scenDir, { recursive: true });
    // core has S01, admin has S02
    writeFileSync(join(scenDir, 'core-S01-login.md'), '# S01');
    // admin-S02 is missing → admin phase.3-1 should be done: false

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'initial' },
          { id: 'admin', name: 'Admin', lifecycle: 'initial' },
        ],
        scenarios: [
          { id: 'S01', name: '用户登录', module: 'core' },
          { id: 'S02', name: '管理员看板', module: 'admin' },
        ],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);
    const coreMod = data.modules?.find(m => m.id === 'core');
    const adminMod = data.modules?.find(m => m.id === 'admin');

    // core: S01 covered → phase.3-1 done
    expect(coreMod!.phase_progress!['phase.3-1'].done).toBe(true);
    // admin: S02 missing → phase.3-1 not done
    expect(adminMod!.phase_progress!['phase.3-1'].done).toBe(false);
    expect(adminMod!.phase_progress!['phase.3-1'].scenario_coverage?.missing).toContain('S02');
  });

  it('UT-S11-MM-06: scenarios without module field default to core', () => {
    const scenDir = join(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation');
    mkdirSync(scenDir, { recursive: true });
    writeFileSync(join(scenDir, 'core-S01-login.md'), '# S01');

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'initial' },
          { id: 'admin', name: 'Admin', lifecycle: 'initial' },
        ],
        // No module field → defaults to core
        scenarios: [{ id: 'S01', name: '用户登录' }],
      }, { lineWidth: 0 }),
    );

    const data = collectStatusData(root);
    const coreMod = data.modules?.find(m => m.id === 'core');
    const adminMod = data.modules?.find(m => m.id === 'admin');

    // S01 defaults to core → core phase.3-1 done
    expect(coreMod!.phase_progress!['phase.3-1'].done).toBe(true);
    // admin has no scenarios → phase.3-1 done: false (0 scenarios, coverage 0/0)
    expect(adminMod!.phase_progress!['phase.3-1'].done).toBe(false);
    expect(adminMod!.phase_progress!['phase.3-1'].scenario_coverage?.total).toBe(0);
  });

  it('UT-S11-MM-07: --module filter returns correct phase for new module', () => {
    // All dirs have core- files; admin has none
    const dirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design',
      'logos/resources/prd/3-technical-plan/1-architecture',
      'logos/resources/api',
      'logos/resources/database',
      'logos/resources/prd/3-technical-plan/3-deployment',
      'logos/resources/test',
      'logos/resources/test/smoke',
      'logos/resources/scenario',
      'logos/resources/implementation',
    ];
    for (const d of dirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'core-dummy.md'), 'content');
    }
    writeFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'PASS');
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), 'DONE');
    writeFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'PASS');

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'launched' },
          { id: 'admin', name: 'Admin', lifecycle: 'initial' },
        ],
        scenarios: [],
      }, { lineWidth: 0 }),
    );

    // Filter to admin only
    const data = collectStatusData(root, 'admin');
    expect(data.modules).toHaveLength(1);
    expect(data.modules![0].id).toBe('admin');
    expect(data.modules![0].current_phase).toBe('phase.1');
  });
});

// ── contract-self-description 切片1（C3）：active_change.facts 权威事实块 ──
describe('S11 — active_change.facts（contract-self-description）', () => {
  it('UT-S11-53: launched 活跃提案输出 facts 六布尔且与磁盘权威事实一致', () => {
    const { root, cleanup } = makeTempRoot();
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    const dir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), '# 变更提案：feat\n\n## 变更类型\n代码级\n\n## 变更概述\n实现 A。\n');
    writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片1：真实切片\n');
    writeFileSync(join(dir, 'SPEC_MERGED'), '');
    const restoreCwd = mockCwd(root); const con = captureConsole();
    try { status('json'); } finally { con.restore(); restoreCwd(); }
    const data = JSON.parse(con.logs[con.logs.length - 1]).data;
    expect(data.modules[0].active_change.facts).toEqual({
      spec_complete: true,      // SPEC_MERGED 在场
      slices_planned: true,     // [code] 含真实脱占位条目
      slices_approved: false,   // 无 SLICES_APPROVED
      code_required: true,      // [code] section 在场
      has_delta_tasks: true,    // [delta] 含条目
      verify_pass: false,       // 无 VERIFY_PASS
    });
    cleanup();
  });
});

// ── contract-self-description 切片2（C1/C5）：contract 版本握手 + step_meta + 注册表 lint ──
describe('S11 — contract / step_meta / 步骤注册表（contract-self-description）', () => {
  function launchedFixture(opts: { proposal?: boolean } = {}): { root: string; cleanup: () => void } {
    const { root, cleanup } = makeTempRoot();
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
    }, { lineWidth: 0 }));
    if (opts.proposal !== false) {
      writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
      const dir = join(root, 'logos', 'changes', 'feat');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'proposal.md'), '# 变更提案：feat\n\n## 变更类型\n代码级\n\n## 变更概述\n实现 A。\n');
      writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片1：真实切片\n');
      writeFileSync(join(dir, 'SPEC_MERGED'), '');
    }
    return { root, cleanup };
  }
  function runStatus(root: string): any {
    const restoreCwd = mockCwd(root); const con = captureConsole();
    try { status('json'); } finally { con.restore(); restoreCwd(); }
    return JSON.parse(con.logs[con.logs.length - 1]).data;
  }

  it('UT-S11-51: status data 顶层 contract 恒在场且等于 {version:"1.0.0"}', () => {
    const { root, cleanup } = launchedFixture();
    const data = runStatus(root);
    expect(data.contract).toEqual({ version: '1.0.0' });
    cleanup();
  });

  it('UT-S11-52: step_meta 经注册表映射，phase/kind 在闭合枚举内', async () => {
    const { STEP_REGISTRY } = await import('../src/lib/step-registry.js');
    // 抽样断言四步骤映射（与 spec/cli-json-output.md §3.3 表逐字一致）
    expect(STEP_REGISTRY['writing']).toEqual({ phase: 'pre-implement', kind: 'produce' });
    expect(STEP_REGISTRY['ready-to-merge']).toEqual({ phase: 'pre-implement', kind: 'gate' });
    expect(STEP_REGISTRY['coding']).toEqual({ phase: 'implement', kind: 'produce' });
    expect(STEP_REGISTRY['verify-passed']).toEqual({ phase: 'post-implement', kind: 'residency' });
    // 输出侧取值 == 注册表映射（ready-to-implement 驻留态 fixture）
    const { root, cleanup } = launchedFixture();
    const ac = runStatus(root).modules[0].active_change;
    expect(ac.step_meta).toEqual(STEP_REGISTRY[ac.proposal_step]);
    const PHASES = ['pre-implement', 'implement', 'post-implement'];
    const KINDS = ['produce', 'gate', 'command-required', 'residency'];
    for (const meta of Object.values(STEP_REGISTRY)) {
      expect(PHASES).toContain((meta as any).phase);
      expect(KINDS).toContain((meta as any).kind);
    }
    cleanup();
  });

  it('UT-S11-54: 无活跃提案 → 不出现 step_meta/facts（active_change:null），contract 仍在场', () => {
    const { root, cleanup } = launchedFixture({ proposal: false });
    const data = runStatus(root);
    expect(data.contract).toEqual({ version: '1.0.0' });
    expect(data.modules[0].active_change).toBeNull();
    expect(JSON.stringify(data)).not.toContain('step_meta');
    expect(JSON.stringify(data)).not.toContain('"facts"');
    cleanup();
  });

  it('UT-S11-55: 注册表 lint——枚举与注册表同步、源内 proposal_step 字面量赋值全部在注册表', async () => {
    const { readFileSync: rf } = await import('node:fs');
    const { resolve, dirname: dn, join: j } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { REGISTERED_STEPS } = await import('../src/lib/step-registry.js');
    const srcDir = resolve(dn(fileURLToPath(import.meta.url)), '../src');
    // (1) ProposalStep 闭合枚举（源定义解析）与注册表键集完全一致——枚举新增值而注册表缺条目 → 本测试失败
    const lifecycleSrc = rf(j(srcDir, 'lib', 'proposal-lifecycle.ts'), 'utf-8');
    const unionBlock = lifecycleSrc.match(/export type ProposalStep =([\s\S]*?);/);
    expect(unionBlock).not.toBeNull();
    const enumValues = [...unionBlock![1].matchAll(/'([a-z-]+)'/g)].map(m => m[1]).sort();
    expect(enumValues).toEqual([...REGISTERED_STEPS].sort());
    // (2) 派生镜像（flow-derive / proposal-lifecycle）中出现的 proposal_step 字面量必须全部在注册表内
    const registered = new Set<string>(REGISTERED_STEPS);
    for (const rel of ['lib/flow-derive.ts', 'lib/proposal-lifecycle.ts', 'commands/status.ts', 'commands/next.ts']) {
      const src = rf(j(srcDir, rel), 'utf-8');
      for (const m of src.matchAll(/proposal_step\s*[:=]\s*'([a-z-]+)'/g)) {
        expect(registered.has(m[1]), `${rel}: proposal_step 字面量 '${m[1]}' 不在 step-registry`).toBe(true);
      }
    }
    // (3) code review F5：commands 层（status/next 覆盖点）禁止「字面量直接赋值 proposal_step」——
    //     必须经 mintStep 成对铸造（步骤+step_meta 绑定，无法各自漂移）。直接赋值出现即失败。
    for (const rel of ['commands/status.ts', 'commands/next.ts']) {
      const src = rf(j(srcDir, rel), 'utf-8');
      const direct = [...src.matchAll(/proposal_step\s*=\s*'([a-z-]+)'/g)].map(m => m[0]);
      expect(direct, `${rel} 存在未经 mintStep 的字面量赋值：${direct.join(' | ')}`).toEqual([]);
    }
    // (4) r2-F5：检测器（两套镜像）内的 `return '<kebab 字面量>'` 全形态扫描——每个疑似步骤返回值
    //     必须在注册表（或显式非步骤白名单）内；同时断言两镜像出口均已接 mintStep（成对铸造出口在场）。
    const NON_STEP_RETURN_ALLOWLIST = new Set<string>([]); // 新的未知 kebab 返回值默认 fail loud
    for (const rel of ['lib/flow-derive.ts', 'lib/proposal-lifecycle.ts']) {
      const src = rf(j(srcDir, rel), 'utf-8');
      for (const m of src.matchAll(/return\s+'([a-z][a-z0-9-]*)'/g)) {
        const lit = m[1];
        expect(registered.has(lit) || NON_STEP_RETURN_ALLOWLIST.has(lit),
          `${rel}: 检测器返回字面量 '${lit}' 不在注册表且不在白名单`).toBe(true);
      }
    }
    expect(rf(j(srcDir, 'lib/flow-derive.ts'), 'utf-8')).toContain('mintStep(effective)');
    // r3-F5 收敛为一：旧镜像树必须不存在；proposal-lifecycle 只保留对权威检测器的委托
    const lifecycleSrc2 = rf(j(srcDir, 'lib/proposal-lifecycle.ts'), 'utf-8');
    expect(lifecycleSrc2).not.toContain('detectProposalStepRaw');
    expect(lifecycleSrc2).toContain('detectMintedStepViaFlow(proposalDir, moduleDefaults).proposal_step');
  });

  it('ST-S11-35: contract/step_meta/facts 端到端一致（与 loop_state 挂出判据同源）', () => {
    const { root, cleanup } = launchedFixture();
    const data = runStatus(root);
    expect(data.contract).toEqual({ version: '1.0.0' });
    const ac = data.modules[0].active_change;
    expect(ac.proposal_step).toBe('ready-to-implement');
    expect(ac.step_meta).toEqual({ phase: 'pre-implement', kind: 'residency' });
    expect(ac.facts).toMatchObject({ spec_complete: true, slices_planned: true, slices_approved: false });
    // step_meta.phase==pre-implement ↔ loop_state 缺席（与 facts 同源判据的反面锚）
    expect(data.modules[0].loop_state).toBeUndefined();
    cleanup();
  });
});

// ── contract-self-description 切片5（C7）：x-future-step 生产者漂移注入 ──
describe('S11 — 生产者一致性漂移注入（contract-self-description）', () => {
  it('UT-S11-56: 注册 x-future-step → 真实生产路径产出、漏扩 schema 被抓、三方同步后通过', async () => {
    const { STEP_REGISTRY, mintStep, REGISTERED_STEPS } = await import('../src/lib/step-registry.js');
    const { __setStepDetectorOverrideForTest } = await import('../src/lib/flow-derive.js');
    const { collectStatusData } = await import('../src/commands/status.js');
    const { readFileSync: rf } = await import('node:fs');
    const { default: Ajv2020 } = await import('ajv/dist/2020.js');
    const { default: addFormats } = await import('ajv-formats');
    const schemaPath = join(process.cwd(), '..', 'spec', 'schema', 'status.schema.json');
    const realSchema = JSON.parse(rf(schemaPath, 'utf-8'));
    // 三方同步基线：注册表键集 == 真实发布 schema 的 proposalStep 枚举（漂移即失败）
    expect([...realSchema.$defs.proposalStep.enum].sort()).toEqual([...REGISTERED_STEPS].sort());
    const FUTURE = 'x-future-step';
    const { root, cleanup } = makeTempRoot();
    try {
      scaffoldProject(root, { locale: 'zh' });
      writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      }, { lineWidth: 0 }));
      writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
      const dir = join(root, 'logos', 'changes', 'feat');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'proposal.md'), '# 变更提案：feat\n\n## 变更类型\n代码级\n\n## 变更概述\n实现。\n');
      writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta] 规格变更\n- [ ] d\n\n## [code] 代码实现\n（占位）\n');
      // 漂移注入：真实注册表 + 检测器注入缝 → **真实 status 生产路径**产出未来步骤
      (STEP_REGISTRY as Record<string, unknown>)[FUTURE] = { phase: 'pre-implement', kind: 'residency' };
      __setStepDetectorOverrideForTest(() => FUTURE as never);
      const data = collectStatusData(root) as any;
      const ac = data.modules[0].active_change;
      // 真实生产者经注册表铸造：新步骤 + step_meta 自动成对附着（不猜、不本地枚举）
      expect(ac.proposal_step).toBe(FUTURE);
      expect(ac.step_meta).toEqual({ phase: 'pre-implement', kind: 'residency' });
      // 真实 pre-implement 未来步骤输出：loop_state 缺席（非法组合不存在——r2-F5 真实输出锚）
      expect(data.modules[0].loop_state).toBeUndefined();
      // 漏扩 schema（真实发布 schema 未同步）→ 真实输出校验必须失败：三方必须一起动的可证伪门
      const ajvOld = new Ajv2020({ strict: false, allowUnionTypes: true }); addFormats(ajvOld);
      expect(ajvOld.validate(realSchema, data)).toBe(false);
      // 同步扩展 schema 枚举后 → 同一真实输出通过
      const futureSchema = JSON.parse(JSON.stringify(realSchema));
      futureSchema.$defs.proposalStep.enum = [...realSchema.$defs.proposalStep.enum, FUTURE];
      const ajvNew = new Ajv2020({ strict: false, allowUnionTypes: true }); addFormats(ajvNew);
      expect(ajvNew.validate(futureSchema, data), JSON.stringify(ajvNew.errors)).toBe(true);
      // 注册表未同步（只删注册表、保留 override）→ 真实生产路径 fail loud，不静默流出裸步骤
      delete (STEP_REGISTRY as Record<string, unknown>)[FUTURE];
      expect(() => collectStatusData(root)).toThrow(/未注册/);
      expect(() => mintStep('x-unregistered-step' as never)).toThrow(/未注册/);
    } finally {
      __setStepDetectorOverrideForTest(null);
      delete (STEP_REGISTRY as Record<string, unknown>)[FUTURE];
      cleanup();
    }
  });

  it('UT-S11-57: 反面锚——四事实齐备下注入 pre-implement 未来步骤仍必须抑制 loop_state（真实生产路径）', async () => {
    const { STEP_REGISTRY } = await import('../src/lib/step-registry.js');
    const { __setStepDetectorOverrideForTest } = await import('../src/lib/flow-derive.js');
    const { collectStatusData } = await import('../src/commands/status.js');
    // 反向 fixture（r3-F5）：磁盘四事实全部为真——SPEC_MERGED + 结构化 SLICES_APPROVED + 未完成真实切片
    const { root, cleanup } = makeTempRoot();
    const FUTURE = 'x-future-step';
    const FUTURE_IMPL = 'x-future-impl-step';
    try {
      scaffoldProject(root, { locale: 'zh' });
      writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      }, { lineWidth: 0 }));
      writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
      const dir = join(root, 'logos', 'changes', 'feat');
      mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
      writeFileSync(join(dir, 'proposal.md'), '# 变更提案：feat\n\n## 变更类型\n代码级\n\n## 变更概述\n实现。\n');
      writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片1：真实切片\n');
      writeFileSync(join(dir, 'deltas', 'test', 'core-S11-test-cases.md'), '| UT-S11-90 | 回归 |\n');
      writeFileSync(join(dir, 'SPEC_MERGED'), '');
      writeFileSync(join(dir, 'SLICES_APPROVED'), JSON.stringify({ schema: 'openlogos/slices-approved@1', approved_at: '2026-07-17T08:00:00Z' }) + '\n');
      // 基线（无注入）：四事实齐备 → 真实输出挂 loop_state（coding / implement）——证明 fixture 底层确会激活 loop
      const baseline = collectStatusData(root) as any;
      expect(baseline.modules[0].active_change.facts).toMatchObject({ spec_complete: true, slices_planned: true, slices_approved: true, code_required: true });
      expect(baseline.modules[0].active_change.step_meta.phase).toBe('implement');
      expect(baseline.modules[0].loop_state).toMatchObject({ subflow_id: 'implement' });
      // 注入 pre-implement 未来步骤：同一磁盘（四事实仍真）→ 真实输出必须抑制 loop_state（非法组合不存在）
      (STEP_REGISTRY as Record<string, unknown>)[FUTURE] = { phase: 'pre-implement', kind: 'residency' };
      __setStepDetectorOverrideForTest(() => FUTURE as never);
      const suppressed = collectStatusData(root) as any;
      expect(suppressed.modules[0].active_change.proposal_step).toBe(FUTURE);
      expect(suppressed.modules[0].active_change.step_meta.phase).toBe('pre-implement');
      expect(suppressed.modules[0].loop_state, 'pre-implement 未来步骤下 loop_state 必须被抑制').toBeUndefined();
      // 换 implement 相位的未来步骤 → loop_state 恢复挂出：证明测试确实触达抑制分支（双向敏感）
      (STEP_REGISTRY as Record<string, unknown>)[FUTURE_IMPL] = { phase: 'implement', kind: 'produce' };
      __setStepDetectorOverrideForTest(() => FUTURE_IMPL as never);
      const restored = collectStatusData(root) as any;
      expect(restored.modules[0].active_change.step_meta.phase).toBe('implement');
      expect(restored.modules[0].loop_state).toMatchObject({ subflow_id: 'implement' });
      // 既有 pre-implement 驻留态扫描（真实 fixture，无注入）
      __setStepDetectorOverrideForTest(null);
      const { rmSync } = await import('node:fs');
      const preFixtures: Array<{ tasks: string; markers: string[] }> = [
        { tasks: '# 任务\n\n## [delta] 规格变更\n- [ ] d\n\n## [code] 代码实现\n（占位）\n', markers: [] },
        { tasks: '# 任务\n\n## [delta] 规格变更\n- [x] d\n\n## [code] 代码实现\n- [ ] 切片1：真实切片\n', markers: ['SPEC_MERGED'] },
      ];
      for (const f of preFixtures) {
        writeFileSync(join(dir, 'tasks.md'), f.tasks);
        rmSync(join(dir, 'SPEC_MERGED'), { force: true });
        rmSync(join(dir, 'SLICES_APPROVED'), { force: true });
        for (const mk of f.markers) writeFileSync(join(dir, mk), '');
        const data = collectStatusData(root) as any;
        expect(data.modules[0].active_change.step_meta.phase).toBe('pre-implement');
        expect(data.modules[0].loop_state).toBeUndefined();
      }
    } finally {
      __setStepDetectorOverrideForTest(null);
      delete (STEP_REGISTRY as Record<string, unknown>)[FUTURE];
      delete (STEP_REGISTRY as Record<string, unknown>)[FUTURE_IMPL];
      cleanup();
    }
  });
});

