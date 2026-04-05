import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { scanDeltas } from '../src/commands/merge.js';
import { change } from '../src/commands/change.js';
import { merge } from '../src/commands/merge.js';
import { archive } from '../src/commands/archive.js';
import { proposalTemplate, tasksTemplate, mergePromptTemplate } from '../src/i18n.js';

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

  it('UT-S09-02: ignore unknown category directories', () => {
    const deltasDir = join(root, 'deltas');
    mkdirSync(join(deltasDir, 'unknown'), { recursive: true });
    writeFileSync(join(deltasDir, 'unknown', 'file.txt'), 'data');

    const results = scanDeltas(deltasDir);
    expect(results).toEqual([]);
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

  it('UT-S09-05: tasksTemplate generates English template with phases', () => {
    const output = tasksTemplate('en');
    expect(output).toContain('# Implementation Tasks');
    expect(output).toContain('Phase 1: Document Changes');
    expect(output).toContain('Phase 2: Design Changes');
    expect(output).toContain('Phase 3: Orchestration & Code');
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

  it('ST-S09-01: create a change proposal with all expected files', () => {
    change('add-feature');

    const changePath = join(root, 'logos', 'changes', 'add-feature');
    expect(existsSync(join(changePath, 'proposal.md'))).toBe(true);
    expect(existsSync(join(changePath, 'tasks.md'))).toBe(true);
    expect(existsSync(join(changePath, 'deltas', 'prd'))).toBe(true);
    expect(existsSync(join(changePath, 'deltas', 'api'))).toBe(true);
    expect(existsSync(join(changePath, 'deltas', 'database'))).toBe(true);
    expect(existsSync(join(changePath, 'deltas', 'scenario'))).toBe(true);

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('proposal.md');
    expect(allLogs).toContain('tasks.md');
  });

  it('ST-S09-02: reject when proposal already exists', () => {
    const changePath = join(root, 'logos', 'changes', 'add-feature');
    mkdirSync(changePath, { recursive: true });

    expect(() => change('add-feature')).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('already exists');
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
    const prompt = readFileSync(join(changePath, 'MERGE_PROMPT.md'), 'utf-8');
    expect(prompt).toContain('Fix Bug Proposal');
    expect(prompt).toContain('deltas/prd/update.md');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('MERGE_PROMPT.md');
  });

  it('ST-S09-06: error when proposal does not exist', () => {
    expect(() => merge('nonexist')).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('not found');
  });

  it('ST-S09-07: error when no delta files', () => {
    const changePath = join(root, 'logos', 'changes', 'empty');
    mkdirSync(join(changePath, 'deltas', 'prd'), { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Empty');

    expect(() => merge('empty')).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('No delta files found');
    expect(existsSync(join(changePath, 'MERGE_PROMPT.md'))).toBe(false);
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

  it('ST-S09-08: archive moves proposal to archive directory', () => {
    const changePath = join(root, 'logos', 'changes', 'done-feature');
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Done');

    archive('done-feature');

    expect(existsSync(changePath)).toBe(false);
    const archivedPath = join(root, 'logos', 'changes', 'archive', 'done-feature');
    expect(existsSync(archivedPath)).toBe(true);
    expect(existsSync(join(archivedPath, 'proposal.md'))).toBe(true);
  });

  it('ST-S09-09: error when proposal does not exist', () => {
    expect(() => archive('nonexist')).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('not found');
  });

  it('ST-S09-10: error when archive already exists', () => {
    const changePath = join(root, 'logos', 'changes', 'dup');
    mkdirSync(changePath, { recursive: true });
    const archivePath = join(root, 'logos', 'changes', 'archive', 'dup');
    mkdirSync(archivePath, { recursive: true });

    expect(() => archive('dup')).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('already exists');
  });
});
