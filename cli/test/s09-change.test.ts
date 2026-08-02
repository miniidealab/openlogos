import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { scanDeltas } from '../src/commands/merge.js';
import { change } from '../src/commands/change.js';
import { merge } from '../src/commands/merge.js';
import { archive } from '../src/commands/archive.js';
import { proposalTemplate, tasksTemplate, mergePromptTemplate } from '../src/i18n.js';
import { resolveProposalDeploymentDecision } from '../src/commands/status.js';
import {
  ARCHIVE_WATCH_ENV,
  ARCHIVE_WATCH_ERROR_CODES,
  ARCHIVE_WATCH_PROTOCOL,
  archiveWatchErrorCodeFor,
  assertArchiveWatchPathSafe,
  cleanupArchiveWatchRuntime,
  coordinateArchiveWatch,
  createArchiveWatchPrepare,
  encodePreparedArchiveWatchToken,
  hashCanonicalProjectPath,
  nodeArchiveWatchFs,
  normalizeProjectPath,
  pollArchiveWatchAcks,
  projectIdForRoot,
  reconcileArchiveDiskState,
  resolveArchiveWatchPaths,
  snapshotArchiveWatchInstances,
  validatePreparedArchiveWatchToken,
  type ArchiveWatchFileSystem,
  type ArchiveWatchPrepare,
} from '../src/lib/archive-watch.js';

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

  it('ST-S09-EX-5.1: 部署决策与 tasks 冲突时输出冲突警告', () => {
    const changePath = join(root, 'logos', 'changes', 'conflict');
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), [
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
    writeFileSync(join(changePath, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 发布 npm 包',
    ].join('\n'));

    const decision = resolveProposalDeploymentDecision(changePath);
    expect(decision.deployment_decision_conflict).toBe(true);
    expect(decision.deployment_decision_conflict_reason).toContain('部署决策冲突');
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
    // proposal-ui-ux-first F3：.md delta 须含 ADDED/MODIFIED/REMOVED 段标记（否则 merge 拒绝、防静默覆盖）
    writeFileSync(join(changePath, 'deltas', 'prd', 'update.md'), '## ADDED — PRD update\n\nContent.');

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
    // proposal-ui-ux-first F3：.md delta 须含 ADDED/MODIFIED/REMOVED 段标记
    writeFileSync(join(changePath, 'deltas', 'prd', '1-product-requirements', '01-req.md'), '## ADDED — Req\n\nreq');
    writeFileSync(join(changePath, 'deltas', 'prd', '3-technical-plan', '2-scenario-implementation', 'S01.md'), '## ADDED — Scenario\n\nscenario');
    writeFileSync(join(changePath, 'deltas', 'test', 'S01-test-cases.md'), '## ADDED — Tests\n\ntests');

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

  it('ST-S09-07: no delta files → writes no-delta SPEC_MERGED marker without MERGE_PROMPT', () => {
    const changePath = join(root, 'logos', 'changes', 'empty');
    mkdirSync(join(changePath, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Empty');

    merge('empty');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('no-delta spec-complete');
    expect(existsSync(join(changePath, 'MERGE_PROMPT.md'))).toBe(false);
    expect(existsSync(join(changePath, 'SPEC_MERGED'))).toBe(true);
    const marker = JSON.parse(readFileSync(join(changePath, 'SPEC_MERGED'), 'utf-8'));
    expect(marker).toMatchObject({
      type: 'no_delta_spec_complete',
      reason: 'pure-code proposal has no spec delta',
    });
    expect(marker.completed_at).toBeTruthy();
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

const ARCHIVE_WATCH_TEST_NOW = '2026-08-01T12:00:00.000Z';

function makeArchiveWatchClock(initial = ARCHIVE_WATCH_TEST_NOW) {
  let currentMs = Date.parse(initial);
  return {
    now: () => new Date(currentMs),
    advance: (milliseconds: number) => { currentMs += milliseconds; },
  };
}

function writeArchiveWatchLease(
  root: string,
  instanceId: string,
  projectId: string,
  values: Partial<{
    protocol: string;
    pid: number;
    expiresAt: string;
    capabilities: string[];
  }> = {},
): string {
  const paths = resolveArchiveWatchPaths(root);
  mkdirSync(paths.instancesDir, { recursive: true });
  const path = join(paths.instancesDir, `${instanceId}.json`);
  writeFileSync(path, JSON.stringify({
    protocol: values.protocol ?? ARCHIVE_WATCH_PROTOCOL,
    instanceId,
    pid: values.pid ?? 999_999,
    projectId,
    startedAt: ARCHIVE_WATCH_TEST_NOW,
    heartbeatAt: ARCHIVE_WATCH_TEST_NOW,
    expiresAt: values.expiresAt ?? '2026-08-01T12:05:00.000Z',
    capabilities: values.capabilities ?? ['prepare'],
  }));
  return path;
}

function writeArchiveWatchAck(
  root: string,
  requestId: string,
  instanceId: string,
  status: 'released' | 'failed' | 'ignored',
  reason?: string,
): string {
  const paths = resolveArchiveWatchPaths(root, requestId, instanceId);
  mkdirSync(paths.acksDir!, { recursive: true });
  writeFileSync(paths.ackPath!, JSON.stringify({
    protocol: ARCHIVE_WATCH_PROTOCOL,
    requestId,
    instanceId,
    status,
    ...(reason ? { reason } : {}),
  }));
  return paths.ackPath!;
}

function prepareArchiveChange(root: string, slug: string): { changePath: string; guardPath: string } {
  const changePath = join(root, 'logos', 'changes', slug);
  const guardPath = join(root, 'logos', '.openlogos-guard');
  mkdirSync(changePath, { recursive: true });
  writeFileSync(join(changePath, 'proposal.md'), `# ${slug}`);
  writeFileSync(guardPath, JSON.stringify({ activeChange: slug, createdAt: ARCHIVE_WATCH_TEST_NOW }));
  return { changePath, guardPath };
}

describe('S09 Unit Tests — Windows archive watcher protocol（注入式）', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
  });

  afterEach(() => cleanup());

  it('UT-S09-125: 协议路径解析确定性、固定兼容向量与越界拒绝', () => {
    const canonical = normalizeProjectPath('C:\\Work\\Demo\\', 'win32');
    expect(canonical).toBe('c:/work/demo');
    expect(hashCanonicalProjectPath(canonical)).toBe('fa64beb149de3c235e5b4f7df10221dc683da064ba87277ad371688fa5cb7d04');

    const paths = resolveArchiveWatchPaths(root, 'request-125', 'instance-125');
    expect(paths.runtimeRoot).toBe(join(nodeArchiveWatchFs.realpath(root), 'logos', '.runtime', 'archive-watch', 'v1'));
    expect(paths.instancesDir).toBe(join(paths.runtimeRoot, 'instances'));
    expect(paths.preparePath).toBe(join(paths.runtimeRoot, 'requests', 'request-125', 'prepare.json'));
    expect(paths.ackPath).toBe(join(paths.runtimeRoot, 'requests', 'request-125', 'acks', 'instance-125.json'));
    expect(paths.resultPath).toBe(join(paths.runtimeRoot, 'requests', 'request-125', 'result.json'));
    expect(() => resolveArchiveWatchPaths(root, '..')).toThrow(/invalid-request-id/);

    const symlinkTarget = join(root, 'outside-runtime');
    mkdirSync(symlinkTarget, { recursive: true });
    symlinkSync(symlinkTarget, join(root, 'logos', '.runtime'), 'dir');
    expect(() => assertArchiveWatchPathSafe(resolveArchiveWatchPaths(root), nodeArchiveWatchFs))
      .toThrow(/protocol-symlink-refused/);
  });

  it('UT-S09-126: 租约快照仅纳入未过期、项目匹配且具备 prepare 能力的实例', () => {
    const projectId = projectIdForRoot(root, 'win32');
    writeArchiveWatchLease(root, 'active-dead-pid', projectId, { pid: 2_147_483_647 });
    writeArchiveWatchLease(root, 'expired', projectId, { expiresAt: '2026-08-01T11:59:59.000Z' });
    writeArchiveWatchLease(root, 'other-project', 'another-project');
    writeArchiveWatchLease(root, 'missing-capability', projectId, { capabilities: ['observe'] });

    const snapshot = snapshotArchiveWatchInstances(root, projectId, {
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
    });

    expect(snapshot.active.map(lease => lease.instanceId)).toEqual(['active-dead-pid']);
    expect(snapshot.incompatible).toEqual([
      { instanceId: 'missing-capability', reason: 'prepare-capability-missing' },
    ]);
  });

  it('UT-S09-127: runtime 目录缺失视为空快照', () => {
    const projectId = projectIdForRoot(root, 'win32');
    expect(snapshotArchiveWatchInstances(root, projectId, {
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
    })).toEqual({ active: [], incompatible: [] });
  });

  it('UT-S09-128: prepare 通过同目录临时文件原子落盘并固化 expectedInstances', () => {
    const writes: string[] = [];
    const renames: Array<[string, string]> = [];
    const fs: ArchiveWatchFileSystem = {
      ...nodeArchiveWatchFs,
      writeText(path, data, exclusive) {
        writes.push(path);
        nodeArchiveWatchFs.writeText(path, data, exclusive);
      },
      rename(from, to) {
        renames.push([from, to]);
        nodeArchiveWatchFs.rename(from, to);
      },
    };
    const prepare: ArchiveWatchPrepare = {
      protocol: ARCHIVE_WATCH_PROTOCOL,
      requestId: 'request-128',
      projectId: projectIdForRoot(root, 'win32'),
      slug: 'atomic-prepare',
      cliPid: 128,
      createdAt: ARCHIVE_WATCH_TEST_NOW,
      deadlineAt: '2026-08-01T12:00:05.000Z',
      expectedInstances: ['instance-a', 'instance-b'],
      mode: 'external',
    };

    const paths = createArchiveWatchPrepare(root, prepare, {
      fs,
      pid: 128,
      randomId: () => 'atomic-temp',
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('.prepare.json.tmp-128-atomic-temp');
    expect(renames).toEqual([[writes[0], paths.preparePath!]]);
    expect(JSON.parse(readFileSync(paths.preparePath!, 'utf8'))).toMatchObject({
      deadlineAt: '2026-08-01T12:00:05.000Z',
      expectedInstances: ['instance-a', 'instance-b'],
    });
    expect(readdirSync(paths.requestDir!).some(name => name.includes('.tmp-'))).toBe(false);
  });

  it('UT-S09-129: ACK 屏障仅在全 released 时放行并对 failed 立即返回', () => {
    const clock = makeArchiveWatchClock();
    writeArchiveWatchAck(root, 'request-129', 'instance-a', 'released');
    let sleepCount = 0;
    const released = pollArchiveWatchAcks(
      root,
      'request-129',
      ['instance-a', 'instance-b'],
      '2026-08-01T12:00:01.000Z',
      {
        now: clock.now,
        sleep(milliseconds) {
          sleepCount += 1;
          expect(sleepCount).toBe(1);
          writeArchiveWatchAck(root, 'request-129', 'instance-b', 'released');
          clock.advance(milliseconds);
        },
      },
    );
    expect(sleepCount).toBe(1);
    expect(released).toEqual({ status: 'released' });

    writeArchiveWatchAck(root, 'request-129', 'instance-a', 'failed', 'archive-watcher-release-timeout');
    expect(pollArchiveWatchAcks(
      root,
      'request-129',
      ['instance-a', 'instance-b'],
      '2026-08-01T12:00:01.000Z',
      { now: clock.now, sleep: () => { throw new Error('failed ACK 后不应继续等待'); } },
    )).toEqual({
      status: 'failed',
      instanceId: 'instance-a',
      reason: 'archive-watcher-release-timeout',
    });
  });

  it('UT-S09-130: 去递归 token 严格绑定协议、项目、slug 与有效期', () => {
    const projectId = projectIdForRoot(root, 'win32');
    const payload = {
      protocol: ARCHIVE_WATCH_PROTOCOL,
      requestId: 'request-130',
      projectId,
      slug: 'prepared-host',
      expiresAt: '2026-08-01T12:01:00.000Z',
    } as const;
    const token = encodePreparedArchiveWatchToken(payload);
    const now = new Date(ARCHIVE_WATCH_TEST_NOW);

    expect(validatePreparedArchiveWatchToken(token, { projectId, slug: 'prepared-host', now })).toBe(true);
    expect(validatePreparedArchiveWatchToken(token, { projectId: 'wrong-project', slug: 'prepared-host', now })).toBe(false);
    expect(validatePreparedArchiveWatchToken(token, { projectId, slug: 'wrong-slug', now })).toBe(false);
    expect(validatePreparedArchiveWatchToken(token, {
      projectId,
      slug: 'prepared-host',
      now: new Date('2026-08-01T12:01:00.000Z'),
    })).toBe(false);
    expect(validatePreparedArchiveWatchToken('always-skip', { projectId, slug: 'prepared-host', now })).toBe(false);

    const session = coordinateArchiveWatch(root, 'prepared-host', {
      platform: 'win32',
      env: { [ARCHIVE_WATCH_ENV]: token },
      now: () => now,
      sleep: () => { throw new Error('有效 token 不应等待'); },
    });
    expect(session.mode).toBe('host-prepared');
  });

  it('UT-S09-131: 四类协议失败映射到稳定错误码', () => {
    expect({
      prepare: archiveWatchErrorCodeFor('prepare'),
      timeout: archiveWatchErrorCodeFor('timeout'),
      instance: archiveWatchErrorCodeFor('instance'),
      inconsistent: archiveWatchErrorCodeFor('inconsistent'),
    }).toEqual({
      prepare: 'ARCHIVE_WATCH_PREPARE_FAILED',
      timeout: 'ARCHIVE_WATCH_ACK_TIMEOUT',
      instance: 'ARCHIVE_WATCH_INSTANCE_FAILED',
      inconsistent: 'ARCHIVE_WATCH_STATE_INCONSISTENT',
    });
    expect(new Set(Object.values(ARCHIVE_WATCH_ERROR_CODES)).size).toBe(4);
  });

  it('UT-S09-132: 过期租约与请求清理幂等且清理失败不反转磁盘裁决', () => {
    const projectId = projectIdForRoot(root, 'win32');
    const expiredLease = writeArchiveWatchLease(root, 'expired-cleanup', projectId, {
      expiresAt: '2026-08-01T11:00:00.000Z',
    });
    const liveLease = writeArchiveWatchLease(root, 'live-cleanup', projectId);
    const stalePaths = resolveArchiveWatchPaths(root, 'stale-request');
    mkdirSync(stalePaths.requestDir!, { recursive: true });
    writeFileSync(stalePaths.preparePath!, JSON.stringify({
      protocol: ARCHIVE_WATCH_PROTOCOL,
      requestId: 'stale-request',
      projectId,
      slug: 'stale-change',
      deadlineAt: '2026-08-01T10:00:00.000Z',
    }));

    cleanupArchiveWatchRuntime(root, {
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
      ttlMs: 60_000,
    });
    cleanupArchiveWatchRuntime(root, {
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
      ttlMs: 60_000,
    });
    expect(existsSync(expiredLease)).toBe(false);
    expect(existsSync(liveLease)).toBe(true);
    expect(existsSync(stalePaths.requestDir!)).toBe(false);

    const failedCleanupLease = writeArchiveWatchLease(root, 'cleanup-refused', projectId, {
      expiresAt: '2026-08-01T11:00:00.000Z',
    });
    const refusingFs: ArchiveWatchFileSystem = {
      ...nodeArchiveWatchFs,
      unlink(path) {
        if (path === failedCleanupLease) throw Object.assign(new Error('refused'), { code: 'EPERM' });
        nodeArchiveWatchFs.unlink(path);
      },
    };
    expect(() => cleanupArchiveWatchRuntime(root, {
      fs: refusingFs,
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
    })).not.toThrow();

    const archivePath = join(root, 'logos', 'changes', 'archive', '20260801-1200-cleaned');
    mkdirSync(archivePath, { recursive: true });
    expect(reconcileArchiveDiskState(
      join(root, 'logos', 'changes', 'cleaned'),
      archivePath,
      join(root, 'logos', '.openlogos-guard'),
      refusingFs,
      'cleaned',
    ).status).toBe('archived');
  });

  it('UT-S09-133: 三态裁决区分已归档、仍存活与矛盾状态', () => {
    const guardPath = join(root, 'logos', '.openlogos-guard');
    const archivedLive = join(root, 'logos', 'changes', 'archived-only');
    const archivedTarget = join(root, 'logos', 'changes', 'archive', '20260801-1200-archived-only');
    mkdirSync(archivedTarget, { recursive: true });
    expect(reconcileArchiveDiskState(archivedLive, archivedTarget, guardPath, nodeArchiveWatchFs, 'archived-only'))
      .toMatchObject({ status: 'archived', reconciledFromDisk: true });

    const livePath = join(root, 'logos', 'changes', 'live-only');
    const missingArchive = join(root, 'logos', 'changes', 'archive', '20260801-1200-live-only');
    mkdirSync(livePath, { recursive: true });
    expect(reconcileArchiveDiskState(livePath, missingArchive, guardPath).status).toBe('live');

    const conflictLive = join(root, 'logos', 'changes', 'conflict');
    const conflictArchive = join(root, 'logos', 'changes', 'archive', '20260801-1200-conflict');
    mkdirSync(conflictLive, { recursive: true });
    mkdirSync(conflictArchive, { recursive: true });
    expect(reconcileArchiveDiskState(conflictLive, conflictArchive, guardPath).status).toBe('inconsistent');
  });

  it('UT-S09-134: 未知协议主版本与能力不足租约均标记为不可协调', () => {
    const projectId = projectIdForRoot(root, 'win32');
    writeArchiveWatchLease(root, 'future-protocol', projectId, {
      protocol: 'openlogos.archive-watch/v2',
    });
    writeArchiveWatchLease(root, 'missing-prepare', projectId, {
      capabilities: ['observe'],
    });

    expect(snapshotArchiveWatchInstances(root, projectId, {
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
    })).toEqual({
      active: [],
      incompatible: [
        { instanceId: 'future-protocol', reason: 'unsupported-protocol-major' },
        { instanceId: 'missing-prepare', reason: 'prepare-capability-missing' },
      ],
    });
  });
});

describe('S09 Scenario Tests — Windows archive watcher handshake（macOS 注入验证）', () => {
  let root: string;
  let cleanup: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    cleanup();
  });

  it('ST-S09-44: 单实例 released ACK 到达后才执行 rename', () => {
    const slug = 'single-ack';
    const { changePath, guardPath } = prepareArchiveChange(root, slug);
    const projectId = projectIdForRoot(root, 'win32');
    writeArchiveWatchLease(root, 'instance-one', projectId);
    const clock = makeArchiveWatchClock();
    let released = false;
    let renameCount = 0;
    const fs: ArchiveWatchFileSystem = {
      ...nodeArchiveWatchFs,
      rename(from, to) {
        if (from === changePath) {
          expect(released).toBe(true);
          renameCount += 1;
        }
        nodeArchiveWatchFs.rename(from, to);
      },
    };

    const outcome = archive(slug, {
      cwd: root,
      platform: 'win32',
      fs,
      now: clock.now,
      randomId: () => 'request-st44',
      sleep(milliseconds) {
        expect(renameCount).toBe(0);
        writeArchiveWatchAck(root, 'request-st44', 'instance-one', 'released');
        released = true;
        clock.advance(milliseconds);
      },
    });

    expect(renameCount).toBe(1);
    expect(outcome?.handshakeMode).toBe('coordinated');
    expect(existsSync(changePath)).toBe(false);
    expect(existsSync(guardPath)).toBe(false);
    const resultPath = resolveArchiveWatchPaths(root, 'request-st44').resultPath!;
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
      status: 'archived',
      exitCode: 0,
    });
  });

  it('ST-S09-45: 多实例未收齐 ACK 时超时且绝不 rename', () => {
    const slug = 'multi-ack';
    const { changePath, guardPath } = prepareArchiveChange(root, slug);
    const projectId = projectIdForRoot(root, 'win32');
    writeArchiveWatchLease(root, 'instance-a', projectId);
    writeArchiveWatchLease(root, 'instance-b', projectId);
    const clock = makeArchiveWatchClock();
    let renameCount = 0;
    let wroteFirstAck = false;
    const fs: ArchiveWatchFileSystem = {
      ...nodeArchiveWatchFs,
      rename(from, to) {
        if (from === changePath) renameCount += 1;
        nodeArchiveWatchFs.rename(from, to);
      },
    };

    expect(() => archive(slug, {
      cwd: root,
      platform: 'win32',
      fs,
      now: clock.now,
      timeoutMs: 100,
      pollMs: 50,
      randomId: () => 'request-st45',
      sleep(milliseconds) {
        if (!wroteFirstAck) {
          writeArchiveWatchAck(root, 'request-st45', 'instance-a', 'released');
          wroteFirstAck = true;
        }
        clock.advance(milliseconds);
      },
    })).toThrow('process.exit(1)');

    expect(renameCount).toBe(0);
    expect(existsSync(changePath)).toBe(true);
    expect(existsSync(guardPath)).toBe(true);
    expect(con.errors.join('\n')).toContain('ARCHIVE_WATCH_ACK_TIMEOUT');
    const resultPath = resolveArchiveWatchPaths(root, 'request-st45').resultPath!;
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
      status: 'not-archived',
      exitCode: 1,
      reason: 'pending:instance-b',
    });
  });

  it('ST-S09-46: 空快照走无等待快路径且不创建协议目录', () => {
    const slug = 'empty-snapshot';
    const { changePath, guardPath } = prepareArchiveChange(root, slug);
    let protocolWrites = 0;
    let renameCount = 0;
    const fs: ArchiveWatchFileSystem = {
      ...nodeArchiveWatchFs,
      writeText(path, data, exclusive) {
        if (path.includes(`${join('logos', '.runtime', 'archive-watch')}`)) protocolWrites += 1;
        nodeArchiveWatchFs.writeText(path, data, exclusive);
      },
      rename(from, to) {
        if (from === changePath) renameCount += 1;
        nodeArchiveWatchFs.rename(from, to);
      },
    };

    const outcome = archive(slug, {
      cwd: root,
      platform: 'win32',
      fs,
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
      sleep: () => { throw new Error('空快照不得等待'); },
    });

    expect(outcome?.handshakeMode).toBe('fast-path');
    expect(renameCount).toBe(1);
    expect(protocolWrites).toBe(0);
    expect(existsSync(resolveArchiveWatchPaths(root).runtimeRoot)).toBe(false);
    expect(existsSync(guardPath)).toBe(false);
  });

  it('ST-S09-47: 同 projectId 与 slug 的在途请求保持 single-flight', () => {
    const slug = 'single-flight';
    const { changePath, guardPath } = prepareArchiveChange(root, slug);
    const projectId = projectIdForRoot(root, 'win32');
    writeArchiveWatchLease(root, 'instance-flight', projectId);
    createArchiveWatchPrepare(root, {
      protocol: ARCHIVE_WATCH_PROTOCOL,
      requestId: 'existing-request',
      projectId,
      slug,
      cliPid: 47,
      createdAt: ARCHIVE_WATCH_TEST_NOW,
      deadlineAt: '2026-08-01T12:01:00.000Z',
      expectedInstances: ['instance-flight'],
      mode: 'external',
    }, { randomId: () => 'existing-temp' });
    let renameCount = 0;
    let randomCalls = 0;
    const fs: ArchiveWatchFileSystem = {
      ...nodeArchiveWatchFs,
      rename(from, to) {
        if (from === changePath) renameCount += 1;
        nodeArchiveWatchFs.rename(from, to);
      },
    };

    expect(() => archive(slug, {
      cwd: root,
      platform: 'win32',
      fs,
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
      randomId: () => { randomCalls += 1; return 'second-request'; },
      sleep: () => { throw new Error('single-flight 不得进入 ACK 等待'); },
    })).toThrow('process.exit(1)');

    expect(renameCount).toBe(0);
    expect(randomCalls).toBe(0);
    expect(existsSync(changePath)).toBe(true);
    expect(existsSync(guardPath)).toBe(true);
    expect(readdirSync(resolveArchiveWatchPaths(root).requestsDir)).toEqual(['existing-request']);
    expect(con.errors.join('\n')).toContain('archive-in-flight');
  });

  it('ST-S09-EX-10.1: 旧版 watcher 导致 EPERM 时给出明确诊断且不重试', () => {
    const slug = 'legacy-busy';
    const { changePath, guardPath } = prepareArchiveChange(root, slug);
    let renameCount = 0;
    const fs: ArchiveWatchFileSystem = {
      ...nodeArchiveWatchFs,
      rename(from, to) {
        if (from === changePath) {
          renameCount += 1;
          throw Object.assign(new Error('busy'), { code: 'EPERM' });
        }
        nodeArchiveWatchFs.rename(from, to);
      },
    };

    expect(() => archive(slug, {
      cwd: root,
      platform: 'win32',
      fs,
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
      sleep: () => { throw new Error('空快照不得等待'); },
    })).toThrow('process.exit(1)');

    expect(renameCount).toBe(1);
    expect(existsSync(changePath)).toBe(true);
    expect(existsSync(guardPath)).toBe(true);
    expect(con.errors.join('\n')).toContain('older RunLogos instance or another program');
  });

  it('ST-S09-EX-10.2: 可见但不可协调的实例 fail-closed', () => {
    const slug = 'incompatible-watcher';
    const { changePath, guardPath } = prepareArchiveChange(root, slug);
    const projectId = projectIdForRoot(root, 'win32');
    writeArchiveWatchLease(root, 'future-instance', projectId, {
      protocol: 'openlogos.archive-watch/v2',
    });
    let renameCount = 0;
    const fs: ArchiveWatchFileSystem = {
      ...nodeArchiveWatchFs,
      rename(from, to) {
        if (from === changePath) renameCount += 1;
        nodeArchiveWatchFs.rename(from, to);
      },
    };

    expect(() => archive(slug, {
      cwd: root,
      platform: 'win32',
      fs,
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
    })).toThrow('process.exit(1)');

    expect(renameCount).toBe(0);
    expect(existsSync(changePath)).toBe(true);
    expect(existsSync(guardPath)).toBe(true);
    expect(con.errors.join('\n')).toContain('ARCHIVE_WATCH_PREPARE_FAILED');
    expect(con.errors.join('\n')).toContain('cannot coordinate this protocol');
  });

  it('ST-S09-EX-10.3: result 缺失重跑时依据磁盘三态调和为成功', () => {
    const slug = 'recovered-result';
    const guardPath = join(root, 'logos', '.openlogos-guard');
    writeFileSync(guardPath, JSON.stringify({ activeChange: slug, createdAt: ARCHIVE_WATCH_TEST_NOW }));
    const archiveDirname = '20260801-1200-recovered-result';
    const archivePath = join(root, 'logos', 'changes', 'archive', archiveDirname);
    mkdirSync(archivePath, { recursive: true });
    writeFileSync(join(archivePath, 'proposal.md'), '# recovered');
    const projectId = projectIdForRoot(root, 'win32');
    const paths = createArchiveWatchPrepare(root, {
      protocol: ARCHIVE_WATCH_PROTOCOL,
      requestId: 'request-recovery',
      projectId,
      slug,
      cliPid: 103,
      createdAt: ARCHIVE_WATCH_TEST_NOW,
      deadlineAt: '2026-08-01T12:01:00.000Z',
      expectedInstances: ['instance-recovery'],
      mode: 'external',
      archivePathHint: archiveDirname,
    }, { randomId: () => 'recovery-temp' });
    let liveRenameCount = 0;
    const fs: ArchiveWatchFileSystem = {
      ...nodeArchiveWatchFs,
      rename(from, to) {
        if (from === join(root, 'logos', 'changes', slug)) liveRenameCount += 1;
        nodeArchiveWatchFs.rename(from, to);
      },
    };

    const outcome = archive(slug, {
      cwd: root,
      platform: 'win32',
      fs,
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
      randomId: () => 'result-temp',
    });

    expect(liveRenameCount).toBe(0);
    expect(outcome).toMatchObject({ archivePath, archiveDirname, reconciledFromDisk: true });
    expect(existsSync(guardPath)).toBe(false);
    expect(JSON.parse(readFileSync(paths.resultPath!, 'utf8'))).toMatchObject({
      status: 'archived',
      archivePathHint: archiveDirname,
      reconciledFromDisk: true,
    });
    expect(con.warns.join('\n')).toContain('reconciled from disk state');
  });

  it('ST-S09-EX-10.4: 非 Windows 路径完全不访问协议文件', () => {
    const slug = 'darwin-bypass';
    const { changePath, guardPath } = prepareArchiveChange(root, slug);
    const protocolSegment = join('logos', '.runtime', 'archive-watch');
    let renameCount = 0;
    const refuseProtocol = (path: string) => {
      if (path.includes(protocolSegment)) throw new Error(`非 Windows 误访问协议路径：${path}`);
    };
    const fs: ArchiveWatchFileSystem = {
      exists(path) { refuseProtocol(path); return nodeArchiveWatchFs.exists(path); },
      mkdir(path) { refuseProtocol(path); nodeArchiveWatchFs.mkdir(path); },
      readText(path) { refuseProtocol(path); return nodeArchiveWatchFs.readText(path); },
      writeText(path, data, exclusive) { refuseProtocol(path); nodeArchiveWatchFs.writeText(path, data, exclusive); },
      rename(from, to) {
        refuseProtocol(from);
        refuseProtocol(to);
        if (from === changePath) renameCount += 1;
        nodeArchiveWatchFs.rename(from, to);
      },
      unlink(path) { refuseProtocol(path); nodeArchiveWatchFs.unlink(path); },
      removeTree(path) { refuseProtocol(path); nodeArchiveWatchFs.removeTree(path); },
      list(path) { refuseProtocol(path); return nodeArchiveWatchFs.list(path); },
      isSymlink(path) { refuseProtocol(path); return nodeArchiveWatchFs.isSymlink(path); },
      realpath(path) { refuseProtocol(path); return nodeArchiveWatchFs.realpath(path); },
    };

    const outcome = archive(slug, {
      cwd: root,
      platform: 'darwin',
      fs,
      env: { [ARCHIVE_WATCH_ENV]: 'invalid-but-ignored' },
      now: () => new Date(ARCHIVE_WATCH_TEST_NOW),
      sleep: () => { throw new Error('非 Windows 不得等待'); },
    });

    expect(outcome?.handshakeMode).toBe('non-windows');
    expect(renameCount).toBe(1);
    expect(existsSync(changePath)).toBe(false);
    expect(existsSync(guardPath)).toBe(false);
  });
});
