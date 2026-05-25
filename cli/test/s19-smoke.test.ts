import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { extractSmokeDefinedIds, smoke } from '../src/commands/smoke.js';
import { detectProposalStep } from '../src/commands/status.js';
import { next } from '../src/commands/next.js';

describe('S19 Unit Tests — smoke cases', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S19-01: extract SMOKE IDs from smoke test case specs', () => {
    const dir = join(root, 'logos/resources/test/smoke');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'core-smoke-test-cases.md'), 'SMOKE-core-02\nSMOKE-core-01\nSMOKE-core-01');

    expect(extractSmokeDefinedIds(root)).toEqual(['SMOKE-core-01', 'SMOKE-core-02']);
  });

  it('UT-S19-04: proposal smoke_required controls smoke gate step', () => {
    const proposalDir = join(root, 'logos', 'changes', 'runtime-change');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：runtime-change',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 是否需要 smoke：是',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: false })).toBe('ready-to-deploy');

    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: false })).toBe('ready-to-smoke');
  });
});

describe('S19 Scenario Tests — smoke command', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'en' });
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

  function writeSmokeCases() {
    const dir = join(root, 'logos/resources/test/smoke');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'core-smoke-test-cases.md'), '| SMOKE-core-01 | health |\n| SMOKE-core-02 | main flow |');
  }

  function writeSmokeResults(lines: string[]) {
    const dir = join(root, 'logos/resources/verify');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'smoke-results.jsonl'), lines.join('\n') + '\n');
  }

  function writeLaunchedModule() {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
        deployment_gates: { core: { deployment_required: true, smoke_required: true } },
      }, { lineWidth: 0 }),
    );
  }

  it('ST-S19-01: all smoke cases pass → Gate PASS and SMOKE_PASS marker', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'deploy-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'deploy-feature', module: 'core' }));
    writeFileSync(join(proposalDir, 'SMOKE_FAIL'), '');

    smoke('text', 'staging');

    const out = con.logs.join('\n');
    expect(out).toContain('Gate 3.8: PASS');
    expect(out).toContain('staging');
    expect(existsSync(join(root, 'logos/resources/verify/smoke-report.md'))).toBe(true);
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(true);
    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(false);
  });

  it('ST-S19-02: uncovered smoke case → Gate FAIL and SMOKE_FAIL marker', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'deploy-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'deploy-feature', module: 'core' }));

    expect(() => smoke()).toThrow('process.exit(1)');

    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(true);
    const report = readFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'utf-8');
    expect(report).toContain('SMOKE-core-02');
  });

  it('ST-S19-03: json output has smoke envelope', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"pass"}',
    ]);

    smoke('json', 'production');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.command).toBe('smoke');
    expect(parsed.data.environment).toBe('production');
    expect(parsed.data.gate.result).toBe('PASS');
  });

  it('ST-S19-04: deploy done with smoke_required=false allows archive', () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'runtime-change');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'runtime-change', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：runtime-change',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 影响环境：生产',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：是',
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
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');
    writeSmokeCases();

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('deploy-done');

    next();
    const out = con.logs.join('\n');
    expect(out).toMatch(/archive/i);
    expect(out).not.toContain('openlogos smoke');
  });

  it('ST-S19-05: deployment decision conflict blocks smoke transition', () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'conflict');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'conflict', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：conflict',
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
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    const step = detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true });
    expect(step).toBe('verify-passed');

    next();
    const out = con.logs.join('\n');
    expect(out).toContain('部署决策冲突');
    expect(out).not.toContain('openlogos smoke');
    expect(out).not.toMatch(/archive/i);
  });

  it('ST-S19-EX-2.1: smoke_required=false 时不进入 ready-to-smoke（提示可归档）', () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'no-smoke');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'no-smoke', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：no-smoke',
      '',
      '## 部署影响',
      '- 是否需要部署：是',
      '- 部署原因：修改 CLI 运行时代码，需要发布新包',
      '- 影响环境：生产',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：是',
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
    writeFileSync(join(proposalDir, 'DEPLOY_DONE'), '');

    expect(detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true })).toBe('deploy-done');
    next();
    const out = con.logs.join('\n');
    expect(out).toMatch(/archive/i);
    expect(out).not.toContain('openlogos smoke');
  });

  it('ST-S19-EX-2.2: 部署决策冲突时 smoke 门禁被阻断并提示冲突', () => {
    writeLaunchedModule();
    const proposalDir = join(root, 'logos', 'changes', 'smoke-conflict');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(
      join(root, 'logos', '.openlogos-guard'),
      JSON.stringify({ activeChange: 'smoke-conflict', module: 'core', createdAt: new Date().toISOString() }),
    );
    writeFileSync(join(proposalDir, 'proposal.md'), [
      '# 变更提案：smoke-conflict',
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
    ].join('\n'));
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [x] 发布 npm 包',
    ].join('\n'));
    writeFileSync(join(proposalDir, 'VERIFY_PASS'), '');

    const step = detectProposalStep(proposalDir, { deployment_required: true, smoke_required: true });
    expect(step).toBe('verify-passed');

    next();
    const out = con.logs.join('\n');
    expect(out).toContain('部署决策冲突');
    expect(out).not.toContain('openlogos smoke');
  });
});
