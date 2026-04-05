import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { syncLogosProjectName, sync } from '../src/commands/sync.js';

/* ========== Unit Tests ========== */

describe('S08 Unit Tests — syncLogosProjectName', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
  });
  afterEach(() => cleanup());

  it('UT-S08-01: update name in logos-project.yaml', () => {
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    const before = readFileSync(yamlPath, 'utf-8');
    expect(before).toContain('name: "test-project"');

    const updated = syncLogosProjectName(root, 'new-name');
    expect(updated).toBe(true);

    const after = readFileSync(yamlPath, 'utf-8');
    expect(after).toContain('name: "new-name"');
  });

  it('UT-S08-02: return false when name is already consistent', () => {
    const updated = syncLogosProjectName(root, 'test-project');
    expect(updated).toBe(false);
  });

  it('UT-S08-03: return false when yaml file does not exist', () => {
    const { root: emptyRoot, cleanup: clean2 } = makeTempRoot();
    try {
      const updated = syncLogosProjectName(emptyRoot, 'any');
      expect(updated).toBe(false);
    } finally {
      clean2();
    }
  });
});

/* ========== Scenario Tests ========== */

describe('S08 Scenario Tests — sync command', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
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

  it('ST-S08-01: sync regenerates AGENTS.md and CLAUDE.md', () => {
    scaffoldProject(root, { locale: 'en' });

    sync();

    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('Phase detection logic');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('AGENTS.md updated');
    expect(allLogs).toContain('Sync complete');
  });

  it('ST-S08-02: sync updates yaml name when mismatched', () => {
    scaffoldProject(root, { name: 'new-name' });
    // Manually set yaml to old name to create mismatch
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    writeFileSync(yamlPath, 'project:\n  name: "old-name"\n  description: ""\n');

    sync();

    const yaml = readFileSync(yamlPath, 'utf-8');
    expect(yaml).toContain('name: "new-name"');
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('name synced');
  });

  it('ST-S08-03: uninitialized project → error exit', () => {
    // no scaffolding — empty directory
    expect(() => sync()).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('logos.config.json not found');
  });
});
