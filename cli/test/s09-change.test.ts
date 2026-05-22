import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { scanDeltas } from '../src/commands/merge.js';
import { change } from '../src/commands/change.js';
import { merge } from '../src/commands/merge.js';
import { archive } from '../src/commands/archive.js';
import { proposalTemplate, tasksTemplate, mergePromptTemplate } from '../src/i18n.js';
import { resolveProposalDeploymentDecision } from '../src/commands/status.js';

/* ========== Unit Tests ========== */

describe('S09 Unit Tests — scanDeltas', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S09-01: scan deltas with prd and api categories', () => {
    const deltasDir = join(root, 'deltas');
    mkdirSync(join(deltasDir, 'prd'), { recursive: true });
    mkdirSync(join(deltasDir, 'api'), { recursive: true });
    writeFileSync(join(deltasDir, 'prd', 'update.md'), '# update');
    writeFileSync(join(deltasDir, 'api', 'v2.yaml'), 'openapi: 3.0');

    const results = scanDeltas(deltasDir);
    expect(results).toHaveLength(2);

    const targets = results.map(r => r.targetDir);
    expect(targets).toContain('logos/resources/prd');
    expect(targets).toContain('logos/resources/api');
  });

  it('UT-S09-01b: recursively scan nested prd and test deltas with target subdirectories', () => {
    const deltasDir = join(root, 'deltas');
    mkdirSync(join(deltasDir, 'prd', '1-product-requirements'), { recursive: true });
    mkdirSync(join(deltasDir, 'prd', '2-product-design', '1-feature-specs'), { recursive: true });
    mkdirSync(join(deltasDir, 'test'), { recursive: true });
    writeFileSync(join(deltasDir, 'prd', '1-product-requirements', '01-req.md'), '# req');
    writeFileSync(join(deltasDir, 'prd', '2-product-design', '1-feature-specs', '01-design.md'), '# design');
    writeFileSync(join(deltasDir, 'test', 'S01-test-cases.md'), '# tests');

    const results = scanDeltas(deltasDir);

    expect(results.map(r => r.relativePath)).toEqual([
      'deltas/prd/1-product-requirements/01-req.md',
      'deltas/prd/2-product-design/1-feature-specs/01-design.md',
      'deltas/test/S01-test-cases.md',
    ]);
    expect(results.map(r => r.targetDir)).toEqual([
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design/1-feature-specs',
      'logos/resources/test',
    ]);
  });

  it('UT-S09-02: ignore unknown category directories', () => {
    const deltasDir = join(root, 'deltas');
    mkdirSync(join(deltasDir, 'unknown'), { recursive: true });
    writeFileSync(join(deltasDir, 'unknown', 'file.txt'), 'data');

    const results = scanDeltas(deltasDir);
    expect(results).toEqual([]);
  });

  it('UT-S09-02b: scan methodology spec and skill deltas', () => {
    const deltasDir = join(root, 'deltas');
    mkdirSync(join(deltasDir, 'spec'), { recursive: true });
    mkdirSync(join(deltasDir, 'skills', 'deployment-designer'), { recursive: true });
    writeFileSync(join(deltasDir, 'spec', 'workflow.md'), '# workflow');
    writeFileSync(join(deltasDir, 'skills', 'deployment-designer', 'SKILL.md'), '# skill');

    const results = scanDeltas(deltasDir);

    expect(results.map(r => r.relativePath)).toEqual([
      'deltas/skills/deployment-designer/SKILL.md',
      'deltas/spec/workflow.md',
    ]);
    expect(results.map(r => r.targetDir)).toEqual([
      'skills/deployment-designer',
      'spec',
    ]);
  });

  it('UT-S09-03: empty deltas directory returns empty array', () => {
    const deltasDir = join(root, 'deltas');
    mkdirSync(join(deltasDir, 'prd'), { recursive: true });
    mkdirSync(join(deltasDir, 'api'), { recursive: true });
    // empty sub-dirs

    const results = scanDeltas(deltasDir);
    expect(results).toEqual([]);
  });
});

describe('S09 Unit Tests — i18n templates', () => {
  it('UT-S09-04: proposalTemplate generates Chinese template with slug', () => {
    const output = proposalTemplate('zh', 'add-feature');
    expect(output).toContain('# 变更提案：add-feature');
    expect(output).toContain('变更原因');
    expect(output).toContain('变更类型');
    expect(output).toContain('变更范围');
  });

  it('UT-S09-05: tasksTemplate generates structured section template', () => {
    const en = tasksTemplate('en');
    expect(en).toContain('# Implementation Tasks');
    expect(en).toContain('## [delta] Spec Changes');
    expect(en).toContain('## [code] Code Implementation');

    const zh = tasksTemplate('zh');
    expect(zh).toContain('# 实现任务');
    expect(zh).toContain('## [delta] 规格变更');
    expect(zh).toContain('## [code] 代码实现');
  });

  it('UT-S09-06: mergePromptTemplate includes delta file mapping', () => {
    const output = mergePromptTemplate('en', 'fix-bug', 'proposal content', [{
      relativePath: 'deltas/prd/fix.md',
      deltaFullPath: 'logos/changes/fix-bug/deltas/prd/fix.md',
      targetDir: 'logos/resources/prd',
    }]);
    expect(output).toContain('# Merge Instruction');
    expect(output).toContain('deltas/prd/fix.md');
    expect(output).toContain('logos/resources/prd');
    expect(output).toContain('Execution Requirements');
  });

  it('UT-S09-07: mergePromptTemplate (en) contains new flow: commit, verify, then archive', () => {
    const output = mergePromptTemplate('en', 'fix-bug', 'proposal content', []);
    expect(output).toContain('git commit');
    expect(output).toContain('docs(fix-bug): merge spec deltas');
    expect(output).toContain('openlogos verify');
    expect(output).toContain('openlogos archive fix-bug');
    // archive must come after verify, not as the immediate next step
    const verifyPos = output.indexOf('openlogos verify');
    const archivePos = output.indexOf('openlogos archive fix-bug');
    expect(verifyPos).toBeLessThan(archivePos);
  });

  it('UT-S09-08: mergePromptTemplate (zh) contains new flow: commit, verify, then archive', () => {
    const output = mergePromptTemplate('zh', 'fix-bug', 'proposal content', []);
    expect(output).toContain('git commit');
    expect(output).toContain('docs(fix-bug): merge spec deltas');
    expect(output).toContain('openlogos verify');
    expect(output).toContain('openlogos archive fix-bug');
    // archive must come after verify
    const verifyPos = output.indexOf('openlogos verify');
    const archivePos = output.indexOf('openlogos archive fix-bug');
    expect(verifyPos).toBeLessThan(archivePos);
  });

  it('UT-S09-09: proposalTemplate includes structured deployment impact fields', () => {
    const output = proposalTemplate('zh', 'deploy-gate');

    expect(output).toContain('## 部署影响');
    expect(output).toContain('是否需要部署：是 / 否');
    expect(output).toContain('部署原因：');
    expect(output).toContain('影响环境：');
    expect(output).toContain('是否涉及数据迁移：是 / 否');
    expect(output).toContain('是否需要回滚预案：是 / 否');
    expect(output).toContain('是否需要 smoke：是 / 否');
  });

  it('UT-S09-10: scanDeltas ignores reference directories', () => {
    const { root, cleanup } = makeTempRoot();
    const deltasDir = join(root, 'deltas');
    mkdirSync(join(deltasDir, 'reference'), { recursive: true });
    writeFileSync(join(deltasDir, 'reference', 'todo.md'), '# todo');

    try {
      const results = scanDeltas(deltasDir);
      expect(results).toEqual([]);
    } finally {
      cleanup();
    }
  });
});

/* ========== Scenario Tests — change ========== */

describe('S09 Scenario Tests — change command', () => {
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

  it('ST-S09-01: create a change proposal with all expected files and guard', () => {
    change('add-feature');

    const changePath = join(root, 'logos', 'changes', 'add-feature');
    expect(existsSync(join(changePath, 'proposal.md'))).toBe(true);
    expect(existsSync(join(changePath, 'tasks.md'))).toBe(true);
    expect(existsSync(join(changePath, 'deltas', 'prd'))).toBe(true);
    expect(existsSync(join(changePath, 'deltas', 'api'))).toBe(true);
    expect(existsSync(join(changePath, 'deltas', 'database'))).toBe(true);
    expect(existsSync(join(changePath, 'deltas', 'scenario'))).toBe(true);

    const guardPath = join(root, 'logos', '.openlogos-guard');
    expect(existsSync(guardPath)).toBe(true);
    const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
    expect(guard.activeChange).toBe('add-feature');
    expect(guard.createdAt).toBeTruthy();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('proposal.md');
    expect(allLogs).toContain('tasks.md');
    expect(allLogs).toContain('.openlogos-guard');
  });

  it('ST-S09-12: fill proposal-level deployment decision after change creation', () => {
    change('docs-only');

    const changePath = join(root, 'logos', 'changes', 'docs-only');
    writeFileSync(join(changePath, 'proposal.md'), [
      '# 变更提案：docs-only',
      '',
      '## 变更原因',
      '补充文档。',
      '',
      '## 变更类型',
      '设计级',
      '',
      '## 变更范围',
      '- 影响的需求文档：无',
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
      '记录提案级部署决策。',
    ].join('\n'));
    writeFileSync(join(changePath, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [delta] 规格变更',
      '- [x] 产出 delta 文件到 deltas/prd/ — 更新文档',
    ].join('\n'));

    const decision = resolveProposalDeploymentDecision(changePath);

    expect(decision).toMatchObject({
      deployment_required: false,
      smoke_required: false,
      deployment_reason: '仅更新文档，不需要发布运行产物',
      deployment_decision_source: 'proposal',
      deployment_decision_conflict: false,
    });
  });

  it('ST-S09-13: only merge-supported delta sections produce mergeable deltas', () => {
    const changePath = join(root, 'logos', 'changes', 'delta-only');
    mkdirSync(join(changePath, 'deltas', 'prd'), { recursive: true });
    mkdirSync(join(changePath, 'deltas', 'spec'), { recursive: true });
    mkdirSync(join(changePath, 'deltas', 'reference'), { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Delta Only');
    writeFileSync(join(changePath, 'deltas', 'prd', 'update.md'), '# PRD delta');
    writeFileSync(join(changePath, 'deltas', 'spec', 'workflow.md'), '# Spec delta');
    writeFileSync(join(changePath, 'deltas', 'reference', 'todo.md'), '# Reference note');

    const results = scanDeltas(join(changePath, 'deltas'));

    expect(results.map(r => r.relativePath)).toEqual([
      'deltas/prd/update.md',
      'deltas/spec/workflow.md',
    ]);
    expect(results.map(r => r.targetDir)).toEqual([
      'logos/resources/prd',
      'spec',
    ]);
  });

  it('ST-S09-02: reject when proposal already exists', () => {
    const changePath = join(root, 'logos', 'changes', 'add-feature');
    mkdirSync(changePath, { recursive: true });

    expect(() => change('add-feature')).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('already exists');
  });

  it('ST-S09-04b: reject when another active guard already exists', () => {
    const activeChangePath = join(root, 'logos', 'changes', 'active-feature');
    mkdirSync(activeChangePath, { recursive: true });

    const guardPath = join(root, 'logos', '.openlogos-guard');
    const originalGuard = JSON.stringify({ activeChange: 'active-feature', createdAt: '2026-01-01T00:00:00Z' });
    writeFileSync(guardPath, originalGuard);

    expect(() => change('new-feature')).toThrow('process.exit(1)');

    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('active-feature');
    expect(allErrors).toContain('archive');
    expect(existsSync(join(root, 'logos', 'changes', 'new-feature'))).toBe(false);
    expect(readFileSync(guardPath, 'utf-8')).toBe(originalGuard);
  });

  it('ST-S09-04c: allow creating a new proposal when guard points to a stale change', () => {
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'stale-feature', createdAt: '2026-01-01T00:00:00Z' }));

    change('new-feature');

    expect(existsSync(join(root, 'logos', 'changes', 'new-feature', 'proposal.md'))).toBe(true);
    const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
    expect(guard.activeChange).toBe('new-feature');
  });

  it('ST-S09-03: error when slug is missing', () => {
    expect(() => change()).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('Missing change proposal name');
    expect(allErrors).toContain('Usage:');
  });

  it('ST-S09-04: error when project not initialized', () => {
    con.restore();
    restoreCwd();
    const { root: emptyRoot, cleanup: clean2 } = makeTempRoot();
    const restore2 = mockCwd(emptyRoot);
    con = captureConsole();

    try {
      expect(() => change('test')).toThrow('process.exit(1)');
      const allErrors = con.errors.join('\n');
      expect(allErrors).toContain('logos.config.json not found');
    } finally {
      con.restore();
      restore2();
      clean2();
    }
  });
});

/* ========== Scenario Tests — merge ========== */

describe('S09 Scenario Tests — merge command', () => {
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

  it('ST-S09-05: generate MERGE_PROMPT.md with delta summary', () => {
    const changePath = join(root, 'logos', 'changes', 'fix-bug');
    mkdirSync(join(changePath, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Fix Bug Proposal\n\nContent here.');
    writeFileSync(join(changePath, 'deltas', 'prd', 'update.md'), '# PRD update');

    merge('fix-bug');

    expect(existsSync(join(changePath, 'MERGE_PROMPT.md'))).toBe(true);
    expect(existsSync(join(changePath, 'MERGE_PROMPT_GENERATED'))).toBe(true);
    expect(existsSync(join(changePath, 'MERGED'))).toBe(false);
    expect(existsSync(join(changePath, 'SPEC_MERGED'))).toBe(false);
    const prompt = readFileSync(join(changePath, 'MERGE_PROMPT.md'), 'utf-8');
    expect(prompt).toContain('Fix Bug Proposal');
    expect(prompt).toContain('deltas/prd/update.md');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('MERGE_PROMPT.md');
  });

  it('ST-S09-05b: merge prompt includes nested prd deltas instead of dropping them', () => {
    const changePath = join(root, 'logos', 'changes', 'fix-flow');
    mkdirSync(join(changePath, 'deltas', 'prd', '1-product-requirements'), { recursive: true });
    mkdirSync(join(changePath, 'deltas', 'prd', '3-technical-plan', '2-scenario-implementation'), { recursive: true });
    mkdirSync(join(changePath, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Fix Flow Proposal');
    writeFileSync(join(changePath, 'deltas', 'prd', '1-product-requirements', '01-req.md'), '# req');
    writeFileSync(join(changePath, 'deltas', 'prd', '3-technical-plan', '2-scenario-implementation', 'S01.md'), '# scenario');
    writeFileSync(join(changePath, 'deltas', 'test', 'S01-test-cases.md'), '# tests');

    merge('fix-flow');

    const prompt = readFileSync(join(changePath, 'MERGE_PROMPT.md'), 'utf-8');
    expect(prompt).toContain('deltas/prd/1-product-requirements/01-req.md');
    expect(prompt).toContain('logos/resources/prd/1-product-requirements');
    expect(prompt).toContain('deltas/prd/3-technical-plan/2-scenario-implementation/S01.md');
    expect(prompt).toContain('logos/resources/prd/3-technical-plan/2-scenario-implementation');
    expect(prompt).toContain('deltas/test/S01-test-cases.md');
    expect(prompt).toContain('logos/resources/test');
  });

  it('ST-S09-06: error when proposal does not exist', () => {
    expect(() => merge('nonexist')).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('not found');
  });

  it('ST-S09-07: no delta files → ok, nothing to merge', () => {
    const changePath = join(root, 'logos', 'changes', 'empty');
    mkdirSync(join(changePath, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Empty');

    merge('empty');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('nothing to merge');
    expect(existsSync(join(changePath, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(changePath, 'SPEC_MERGED'))).toBe(true);
  });
});

/* ========== Scenario Tests — archive ========== */

describe('S09 Scenario Tests — archive command', () => {
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

  it('ST-S09-08: archive moves proposal to timestamped archive directory and removes guard', () => {
    const changePath = join(root, 'logos', 'changes', 'done-feature');
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Done');

    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'done-feature', createdAt: '2026-01-01T00:00:00Z' }));
    expect(existsSync(guardPath)).toBe(true);

    archive('done-feature');

    expect(existsSync(changePath)).toBe(false);

    // Archive dir name should match YYYYMMDD-HHmm-done-feature pattern
    const archiveDir = join(root, 'logos', 'changes', 'archive');
    const entries = readdirSync(archiveDir);
    const archivedEntry = entries.find(e => e.endsWith('-done-feature'));
    expect(archivedEntry).toBeDefined();
    expect(archivedEntry).toMatch(/^\d{8}-\d{4}-done-feature$/);
    expect(existsSync(join(archiveDir, archivedEntry!, 'proposal.md'))).toBe(true);
    expect(existsSync(guardPath)).toBe(false);
  });

  it('ST-S09-11: archive preserves guard file if it belongs to a different change', () => {
    const changePath = join(root, 'logos', 'changes', 'old-feature');
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Old');

    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: 'other-feature', createdAt: '2026-01-01T00:00:00Z' }));

    archive('old-feature');

    // archived dir should have timestamp prefix
    const archiveDir = join(root, 'logos', 'changes', 'archive');
    const entries = readdirSync(archiveDir);
    expect(entries.some(e => e.endsWith('-old-feature'))).toBe(true);

    expect(existsSync(guardPath)).toBe(true);
    const guard = JSON.parse(readFileSync(guardPath, 'utf-8'));
    expect(guard.activeChange).toBe('other-feature');
  });

  it('ST-S09-09: error when proposal does not exist', () => {
    expect(() => archive('nonexist')).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('not found');
  });

  it('ST-S09-10: error when archive already exists with same timestamp', () => {
    const changePath = join(root, 'logos', 'changes', 'dup');
    mkdirSync(changePath, { recursive: true });

    // Compute the expected archive dir name the same way archive.ts does
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
    const expectedDirName = `${date}-${time}-dup`;

    // Pre-create the archive entry with that exact name
    const archiveDir = join(root, 'logos', 'changes', 'archive');
    mkdirSync(join(archiveDir, expectedDirName), { recursive: true });

    expect(() => archive('dup')).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('already exists');
  });
});
