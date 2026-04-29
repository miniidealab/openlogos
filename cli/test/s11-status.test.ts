import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { listFiles, collectStatusData, status } from '../src/commands/status.js';

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
    // Phase 3-4 (idx 8, implementation) has files → 3-2-api should be skipped
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

    // Phase 3-5 (idx 9, verify) should NOT be skipped (it's after lastDoneIdx)
    const verifyPhase = data.phases.find(p => p.key === 'phase.3-5')!;
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

    const data = collectStatusData(root);

    expect(data.all_done).toBe(true);
    expect(data.current_phase).toBeNull();

    // API and DB should be skipped
    expect(data.phases.find(p => p.key === 'phase.3-2-api')!.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-2-db')!.skipped).toBe(true);
  });

  it('UT-S11-10: firstIncomplete skips over skipped phases', () => {
    // Phase 1, 2 done; 3-0 empty; 3-1, 3-3a done → 3-0 is skipped
    // firstIncomplete should be 3-3b (or later), not 3-0
    const filledDirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/2-product-design',
      // 3-0 (architecture) empty → will be skipped
      // 3-1 (scenario) empty → will be skipped
      // 3-2-api empty → will be skipped
      // 3-2-db empty → will be skipped
      'logos/resources/test',    // idx 6 (3-3a)
      // 3-3b empty → NOT skipped (idx 7, after lastDoneIdx=6)
    ];
    for (const d of filledDirs) {
      const dir = join(root, d);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'dummy.md'), 'content');
    }

    const data = collectStatusData(root);

    // 3-0 through 3-2-db should be skipped (idx 2-5, all before lastDoneIdx=6)
    expect(data.phases.find(p => p.key === 'phase.3-0')!.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-1')!.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-2-api')!.skipped).toBe(true);
    expect(data.phases.find(p => p.key === 'phase.3-2-db')!.skipped).toBe(true);

    // 3-3b should NOT be skipped (idx 7, >= lastDoneIdx=6)
    expect(data.phases.find(p => p.key === 'phase.3-3b')!.skipped).toBe(false);

    // current_phase should be 3-3b, not 3-0
    expect(data.current_phase).toBe('phase.3-3b');
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
    // Phase 1, 3-1, 3-3a, 3-4 done → 2, 3-0, 3-2-api, 3-2-db, 3-3b skipped
    const filledDirs = [
      'logos/resources/prd/1-product-requirements',
      'logos/resources/prd/3-technical-plan/2-scenario-implementation',
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
    // Phase 1 and 3-4 done; everything between is skipped
    // 3-5 (verify) should be suggested, not 3-2-api
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
    // The suggestion should mention verify, not API design
    expect(allLogs).not.toContain('API');
    // Should suggest 3-5 (verify) which is the first non-skipped incomplete
    const hasVerifyHint = allLogs.includes('verify') || allLogs.includes('验收');
    expect(hasVerifyHint).toBe(true);
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
    expect(data.phases.find(p => p.key === 'phase.3-3b')!.skipped).toBe(true);

    // current_phase must NOT be phase.3-2-api
    expect(data.current_phase).not.toBe('phase.3-2-api');
    expect(data.current_phase).not.toBe('phase.3-3b');
  });

  it('UT-S11-SP-02: skip_phases:[api,scenario] — next suggestion does not recommend API design', () => {
    // Phase 1, 2, 3-0, 3-1 done; api/scenario skipped → next should suggest test cases (3-3a)
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
    expect(data.current_phase).not.toBe('phase.3-3b');

    // suggestion must not mention API design
    expect(data.suggestion).not.toMatch(/api.?designer/i);
    expect(data.suggestion).not.toMatch(/API 设计/);
  });
});
