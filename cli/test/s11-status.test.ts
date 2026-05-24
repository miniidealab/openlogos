import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  listFiles,
  collectStatusData,
  status,
  parseProposalDeploymentDecision,
  resolveProposalDeploymentDecision,
  resolveDeploymentDocument,
  resolveDeploymentProgress,
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

  it('ST-S11-06c: SPEC_MERGED advances proposal to coding', () => {
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

    expect(core.active_change!.proposal_step).toBe('coding');
    expect(core.suggestion).toMatch(/实现代码|Implement code/);
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

  it('ST-S11-06e: no [delta] section + [code] not done → coding (skips merge)', () => {
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
      '- [ ] 修复 src/xxx 中的问题',
    ].join('\n'));

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    expect(core.active_change!.proposal_step).toBe('coding');
  });

  it('ST-S11-06f: no [delta] section + [code] all done → ready-to-verify (skips merge)', () => {
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
      '- [x] 修复 src/xxx 中的问题',
    ].join('\n'));

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;
    expect(core.active_change!.proposal_step).toBe('ready-to-verify');
  });

  it('ST-S11-08: no-deploy proposal shows archive after verify PASS', () => {
    const proposalDir = setupLaunchedProposal('docs-only', NO_DEPLOY_PROPOSAL);
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

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

    const data = collectStatusData(root);
    const core = data.modules!.find(m => m.id === 'core')!;

    expect(core.active_change!.proposal_step).toBe('ready-to-deploy');
    expect(core.active_change!.deployment_required).toBe(true);
    expect(core.active_change!.deploy_tasks).toEqual([{ checked: false, text: '发布 npm 包' }]);

    status();
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('发布 npm 包');
  });

  it('ST-S11-10: status JSON exposes proposal-level deployment decision', () => {
    const proposalDir = setupLaunchedProposal('docs-only', NO_DEPLOY_PROPOSAL);
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

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

  it('ST-S11-11: status JSON exposes conflict reason when proposal/tasks disagree', () => {
    const proposalDir = setupLaunchedProposal('conflict', NO_DEPLOY_PROPOSAL, [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

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

    status('json');
    const output = JSON.parse(con.logs[0]);
    const active = output.data.modules[0].active_change;

    expect(active.proposal_step).toBe('ready-to-deploy');
    expect(active.deployment_required).toBe(true);
    expect(active.deployment_decision_source).toBe('tasks');
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
