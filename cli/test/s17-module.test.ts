import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { moduleList, moduleAdd, moduleRename, moduleRemove } from '../src/commands/module.js';

const readlineState = vi.hoisted(() => ({ answers: [] as string[] }));

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: (_prompt: string, cb: (answer: string) => void) => {
      cb(readlineState.answers.shift() ?? '');
    },
    close: vi.fn(),
  })),
}));

function writeProjectYaml(root: string, data: Record<string, unknown>) {
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml(data, { lineWidth: 0 }));
}

function writeGuard(root: string, activeChange = 'test-change') {
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange }));
}

import { parse as parseYaml } from 'yaml';
function readYaml(root: string) {
  return parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8')) ?? {};
}

describe('S17 Unit Tests — module commands', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
    restoreCwd = mockCwd(root);
    readlineState.answers = [];
  });

  afterEach(() => {
    restoreCwd();
    cleanup();
  });

  /* ---- moduleList ---- */

  it('UT-S17-01: moduleList shows empty message when no modules', () => {
    const { logs, restore } = captureConsole();
    moduleList();
    restore();
    expect(logs.some(l => l.includes('No modules registered'))).toBe(true);
  });

  it('UT-S17-02: moduleList displays registered modules', () => {
    writeProjectYaml(root, {
      modules: [
        { id: 'core', name: '核心功能', status: 'stable', loop_phase: null },
        { id: 'payment', name: '支付', status: 'in-progress', loop_phase: 'api-design' },
      ],
    });
    const { logs, restore } = captureConsole();
    moduleList();
    restore();
    const out = logs.join('\n');
    expect(out).toContain('core');
    expect(out).toContain('payment');
  });

  it('UT-S17-03: moduleList sorts initial modules first', () => {
    writeProjectYaml(root, {
      modules: [
        { id: 'core', name: '核心功能', lifecycle: 'launched' },
        { id: 'payment', name: '支付', lifecycle: 'initial' },
      ],
    });
    const { logs, restore } = captureConsole();
    moduleList();
    restore();
    const out = logs.join('\n');
    const paymentIdx = out.indexOf('payment');
    const coreIdx = out.indexOf('core');
    expect(paymentIdx).toBeLessThan(coreIdx);
  });

  /* ---- moduleAdd ---- */

  it('UT-S17-04: moduleAdd works without a guard file', () => {
    // No guard file — should succeed without error
    const { logs, restore } = captureConsole();
    moduleAdd('newmod');
    restore();
    const yaml = readYaml(root);
    expect(yaml.modules.find((m: { id: string }) => m.id === 'newmod')).toBeDefined();
    expect(logs.some(l => l.includes('added'))).toBe(true);
  });

  it('UT-S17-04b: moduleAdd works with a guard file (no warning expected)', () => {
    writeGuard(root);
    const { logs, restore } = captureConsole();
    moduleAdd('newmod');
    restore();
    const yaml = readYaml(root);
    expect(yaml.modules.find((m: { id: string }) => m.id === 'newmod')).toBeDefined();
    // add does not warn about active change
    expect(logs.join('\n')).not.toContain('Warning');
  });

  it('UT-S17-05: moduleAdd appends module to yaml', () => {
    const { restore } = captureConsole();
    moduleAdd('payment');
    restore();
    const yaml = readYaml(root);
    expect(Array.isArray(yaml.modules)).toBe(true);
    const mod = yaml.modules.find((m: { id: string }) => m.id === 'payment');
    expect(mod).toBeDefined();
    expect(mod.lifecycle).toBe('initial');
  });

  it('UT-S17-06: moduleAdd rejects invalid name', () => {
    const exitSpy = mockProcessExit();
    const { errors, restore } = captureConsole();
    expect(() => moduleAdd('Invalid_Name')).toThrow();
    restore();
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('invalid'))).toBe(true);
  });

  it('UT-S17-07: moduleAdd rejects duplicate name', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: '核心功能', status: 'stable', loop_phase: null }],
    });
    const exitSpy = mockProcessExit();
    const { errors, restore } = captureConsole();
    expect(() => moduleAdd('core')).toThrow();
    restore();
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('already exists'))).toBe(true);
  });

  it('UT-S17-08: moduleAdd requires name argument', () => {
    const exitSpy = mockProcessExit();
    const { errors, restore } = captureConsole();
    expect(() => moduleAdd(undefined)).toThrow();
    restore();
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('Usage'))).toBe(true);
  });

  /* ---- moduleRename ---- */

  it('UT-S17-09: moduleRename updates id in yaml', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'oldname', name: '旧名', status: 'in-progress', loop_phase: 'requirements' }],
    });
    const { restore } = captureConsole();
    moduleRename('oldname', 'newname');
    restore();
    const yaml = readYaml(root);
    expect(yaml.modules.find((m: { id: string }) => m.id === 'newname')).toBeDefined();
    expect(yaml.modules.find((m: { id: string }) => m.id === 'oldname')).toBeUndefined();
  });

  it('UT-S17-09b: moduleRename warns when active change proposal exists', () => {
    writeGuard(root);
    writeProjectYaml(root, {
      modules: [{ id: 'oldname', name: '旧名', lifecycle: 'initial' }],
    });
    const { logs, restore } = captureConsole();
    moduleRename('oldname', 'newname');
    restore();
    // rename still succeeds
    const yaml = readYaml(root);
    expect(yaml.modules.find((m: { id: string }) => m.id === 'newname')).toBeDefined();
    // and emits a warning
    expect(logs.join('\n')).toContain('Warning');
    expect(logs.join('\n')).toContain('test-change');
  });

  it('UT-S17-10: moduleRename renames matching files in resources/', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'oldname', name: '旧名', status: 'in-progress', loop_phase: 'requirements' }],
    });
    const resDir = join(root, 'logos', 'resources', 'prd', '1-product-requirements');
    mkdirSync(resDir, { recursive: true });
    writeFileSync(join(resDir, 'oldname-01-requirements.md'), 'content');

    const { restore } = captureConsole();
    moduleRename('oldname', 'newname');
    restore();

    expect(existsSync(join(resDir, 'newname-01-requirements.md'))).toBe(true);
    expect(existsSync(join(resDir, 'oldname-01-requirements.md'))).toBe(false);
  });

  it('UT-S17-10b: moduleRename updates cross-references inside files', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'oldname', name: '旧名', status: 'in-progress', loop_phase: 'requirements' }],
    });
    // A doc that references oldname- prefix
    const specDir = join(root, 'spec');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'overview.md'), 'See oldname-S01-init.md and oldname-01-requirements.md');

    const { restore } = captureConsole();
    moduleRename('oldname', 'newname');
    restore();

    const content = readFileSync(join(specDir, 'overview.md'), 'utf-8');
    expect(content).toContain('newname-S01-init.md');
    expect(content).toContain('newname-01-requirements.md');
    expect(content).not.toContain('oldname-');
  });

  it('UT-S17-11: moduleRename rejects non-existent module', () => {
    writeProjectYaml(root, { modules: [] });
    const exitSpy = mockProcessExit();
    const { errors, restore } = captureConsole();
    expect(() => moduleRename('ghost', 'newname')).toThrow();
    restore();
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('not found'))).toBe(true);
  });

  it('UT-S17-12: moduleRename rejects invalid new name', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: '核心', status: 'stable', loop_phase: null }],
    });
    const exitSpy = mockProcessExit();
    const { errors, restore } = captureConsole();
    expect(() => moduleRename('core', 'Bad_Name')).toThrow();
    restore();
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('invalid'))).toBe(true);
  });

  /* ---- moduleRemove ---- */

  it('UT-S17-13: moduleRemove protects core module', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: '核心', status: 'stable', loop_phase: null }],
    });
    const exitSpy = mockProcessExit();
    const { errors, restore } = captureConsole();
    expect(() => moduleRemove('core')).toThrow();
    restore();
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('protected'))).toBe(true);
  });

  it('UT-S17-14: moduleRemove rejects non-existent module', () => {
    writeProjectYaml(root, { modules: [] });
    const exitSpy = mockProcessExit();
    const { errors, restore } = captureConsole();
    expect(() => moduleRemove('ghost')).toThrow();
    restore();
    exitSpy.mockRestore();
    expect(errors.some(e => e.includes('not found'))).toBe(true);
  });

  it('UT-S17-14b: moduleRemove warns when active change proposal exists', () => {
    writeGuard(root);
    writeProjectYaml(root, {
      modules: [{ id: 'payment', name: '支付', lifecycle: 'initial' }],
    });
    // Mock readline to auto-confirm
    const { logs, restore } = captureConsole();
    // moduleRemove uses readline — we just verify the warning fires before the prompt
    // by checking that warnIfActiveChange ran (it logs to console.warn → captured in logs)
    // We don't need to complete the readline interaction for this assertion
    try {
      moduleRemove('payment');
    } catch { /* readline may throw in test env */ }
    restore();
    expect(logs.join('\n')).toContain('Warning');
    expect(logs.join('\n')).toContain('test-change');
  });

  /* ---- moduleList --format json ---- */

  it('UT-S17-15: moduleList json outputs valid envelope with modules array', () => {
    writeProjectYaml(root, {
      modules: [
        { id: 'core', name: '核心功能', lifecycle: 'initial' },
        { id: 'payment', name: '支付模块', lifecycle: 'launched' },
      ],
    });
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => { stdoutChunks.push(String(chunk)); return true; };
    moduleList('json');
    process.stdout.write = origWrite;

    const output = stdoutChunks.join('');
    const parsed = JSON.parse(output);
    expect(parsed.command).toBe('module list');
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(parsed.data.modules)).toBe(true);
    expect(parsed.data.modules).toHaveLength(2);
    expect(parsed.data.modules[0]).toEqual({ id: 'core', name: '核心功能', lifecycle: 'initial' });
    expect(parsed.data.modules[1]).toEqual({ id: 'payment', name: '支付模块', lifecycle: 'launched' });
  });

  it('UT-S17-16: moduleList json outputs empty array when no modules', () => {
    writeProjectYaml(root, { modules: [] });
    const stdoutChunks: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: unknown) => { stdoutChunks.push(String(chunk)); return true; };
    moduleList('json');
    process.stdout.write = origWrite;

    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.data.modules).toEqual([]);
  });

  it('UT-S17-17: moduleList json outputs error envelope when project not initialized', () => {
    // Use an empty root without logos.config.json
    const emptyRoot = makeTempRoot();
    const restoreEmpty = mockCwd(emptyRoot.root);
    const stderrChunks: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk: unknown) => { stderrChunks.push(String(chunk)); return true; };
    const exitSpy = mockProcessExit();
    try {
      expect(() => moduleList('json')).toThrow('process.exit(1)');
      process.stderr.write = origWrite;
      const errOutput = stderrChunks.join('');
      const parsed = JSON.parse(errOutput);
      expect(parsed.error.code).toBe('PROJECT_NOT_INITIALIZED');
    } finally {
      process.stderr.write = origWrite;
      exitSpy.mockRestore();
      restoreEmpty();
      emptyRoot.cleanup();
    }
  });
});

describe('S17 Scenario Tests — module registry workflow', () => {
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
    readlineState.answers = [];
  });

  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  it('ST-S17-01: 管理模块注册表', () => {
    writeProjectYaml(root, {
      modules: [{ id: 'core', name: '核心功能', lifecycle: 'initial' }],
    });

    const specDir = join(root, 'spec');
    mkdirSync(specDir, { recursive: true });
    writeFileSync(join(specDir, 'overview.md'), 'See payment-S01-test-cases.md for cross references.');

    const resourceDir = join(root, 'logos', 'resources', 'test');
    mkdirSync(resourceDir, { recursive: true });
    writeFileSync(join(resourceDir, 'payment-S01-test-cases.md'), 'payment reference');

    moduleAdd('payment');
    moduleRename('payment', 'billing');

    readlineState.answers = ['yes'];
    moduleRemove('billing');

    const yaml = readYaml(root);
    expect(yaml.modules.map((m: { id: string }) => m.id)).toEqual(['core']);
    expect(existsSync(join(resourceDir, 'billing-S01-test-cases.md'))).toBe(true);
    expect(existsSync(join(resourceDir, 'payment-S01-test-cases.md'))).toBe(false);
    expect(readFileSync(join(specDir, 'overview.md'), 'utf-8')).toContain('billing-S01-test-cases.md');
    expect(con.logs.join('\n')).toContain('added');
    expect(con.logs.join('\n')).toContain('Updated logos-project.yaml');
    expect(con.logs.join('\n')).toContain('removed');
  });
});
