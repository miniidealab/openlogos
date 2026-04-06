import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { launch } from '../src/commands/launch.js';

describe('S14 Scenario Tests — launch command', () => {
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

  it('ST-S14-01: launch switches lifecycle from initial to active', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'initial';
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updated.lifecycle).toBe('active');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('activated');
  });

  it('ST-S14-02: launch regenerates AGENTS.md with enforced change management', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'initial';
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('Change Management (Must Follow)');
    expect(agents).not.toContain('Initial Development');
  });

  it('ST-S14-03: launch updates openlogos-policy.mdc for cursor projects', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'initial';
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    const policyPath = join(root, '.cursor', 'rules', 'openlogos-policy.mdc');
    expect(existsSync(policyPath)).toBe(true);
    const policy = readFileSync(policyPath, 'utf-8');
    expect(policy).toContain('Must Follow');
    expect(policy).not.toContain('Initial Development');
  });

  it('ST-S14-04: launch on already active project is a no-op', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'active';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('already active');
  });

  it('ST-S14-05: launch on uninitialized project → error exit', () => {
    expect(() => launch()).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('logos.config.json not found');
  });

  it('ST-S14-06: launch with zh locale outputs Chinese messages', () => {
    scaffoldProject(root, { locale: 'zh' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'initial';
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    launch();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('已激活');
  });
});
