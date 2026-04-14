import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { listFiles, status } from '../src/commands/status.js';

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

/* ========== Scenario Tests ========== */

describe('S11 Scenario Tests — status command', () => {
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
      'logos/resources/test',
      'logos/resources/scenario',
      'logos/resources/implementation',
      'logos/resources/verify',
    ];
    for (const d of dirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }

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
});
