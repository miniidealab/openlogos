import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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

  it('ST-S08-01: sync regenerates AGENTS.md, CLAUDE.md and deploys skills (cursor)', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('Phase detection logic');
    expect(agents).toContain('## Active Skills');

    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).not.toContain('## Active Skills');

    expect(existsSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'))).toBe(true);
    const mdcFiles = readdirSync(join(root, '.cursor', 'rules')).filter(f => f.endsWith('.mdc'));
    expect(mdcFiles.length).toBe(14);
    expect(existsSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'))).toBe(true);

    expect(existsSync(join(root, 'logos', 'spec', 'test-results.md'))).toBe(true);

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('AGENTS.md updated');
    expect(allLogs).toContain('Sync complete');
    expect(allLogs).toContain('13 skills synced to .cursor/rules/');
    expect(allLogs).toContain('specs synced');
  });

  it('ST-S08-02: sync updates yaml name when mismatched', () => {
    scaffoldProject(root, { name: 'new-name' });
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    writeFileSync(yamlPath, 'project:\n  name: "old-name"\n  description: ""\n');

    sync();

    const yaml = readFileSync(yamlPath, 'utf-8');
    expect(yaml).toContain('name: "new-name"');
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('name synced');
  });

  it('ST-S08-03: uninitialized project → error exit', () => {
    expect(() => sync()).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('logos.config.json not found');
  });

  it('ST-S08-04: sync with claude-code deploys to logos/skills/', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'claude-code';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    const skillDirs = readdirSync(join(root, 'logos', 'skills'));
    expect(skillDirs.length).toBe(13);

    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('## Active Skills');
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).not.toContain('## Active Skills');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('13 skills synced to logos/skills/');
  });

  it('ST-S08-04b: sync with opencode deploys plugin and merges opencode config', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'opencode';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    writeFileSync(join(root, 'opencode.json'), JSON.stringify({ "$schema": "https://opencode.ai/config.json", permission: { read: 'allow' } }, null, 2));

    sync();

    expect(existsSync(join(root, '.opencode', 'plugins', 'openlogos.js'))).toBe(true);
    expect(existsSync(join(root, '.opencode', 'commands', 'openlogos-status.md'))).toBe(true);
    const opencodeConfig = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf-8'));
    expect(opencodeConfig.permission.read).toBe('allow'); // preserve existing
    expect(opencodeConfig.permission.bash).toBe('ask');   // fill missing defaults
    expect(opencodeConfig.permission.skill).toBe('allow');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('OpenCode plugin synced');
    expect(allLogs).toContain('slash commands');
  });

  it('ST-S08-05: sync defaults to cursor when aiTool not in config', () => {
    scaffoldProject(root, { locale: 'en' });

    sync();

    expect(existsSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'))).toBe(true);
  });

  it('ST-S08-05b: sync generates Language Policy section for en locale', () => {
    scaffoldProject(root, { locale: 'en' });
    sync();
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('Language Policy (Highest Priority)');
    expect(agents).toContain('MUST be in English');
  });

  it('ST-S08-05c: sync generates Language Policy section for zh locale', () => {
    scaffoldProject(root, { locale: 'zh' });
    sync();
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('语言策略（最高优先级）');
    expect(agents).toContain('必须使用中文');
  });

  it('ST-S08-07: sync with claude-code generates Skill binding in CLAUDE.md', () => {
    scaffoldProject(root, { locale: 'en' });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'claude-code';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('logos/skills/prd-writer/SKILL.md');
    expect(claude).toContain('MUST first read the corresponding Skill file');
  });

  it('ST-S08-06: sync with other → both files include Active Skills', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'other';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('## Active Skills');
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('## Active Skills');
  });

  it('ST-S08-08: sync adds missing documents.changes to existing config', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.documents.changes).toBeUndefined();

    sync();

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updated.documents.changes).toBeDefined();
    expect(updated.documents.changes.path).toBe('./changes');
    expect(updated.documents.changes.label.en).toBe('Change Proposals');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('documents.changes added');
  });

  it('ST-S08-09: sync preserves existing documents.changes if already present', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.documents.changes = {
      label: { en: 'My Changes', zh: '我的变更' },
      path: './my-changes',
      pattern: '**/*.md',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updated.documents.changes.path).toBe('./my-changes');
    expect(updated.documents.changes.label.en).toBe('My Changes');

    const allLogs = con.logs.join('\n');
    expect(allLogs).not.toContain('documents.changes added');
  });

  it('ST-S08-10: sync adds sourceRoots when missing from config', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const before = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(before.sourceRoots).toBeUndefined();

    sync();

    const after = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(after.sourceRoots).toBeDefined();
    expect(after.sourceRoots.src).toEqual(['src']);
    expect(after.sourceRoots.test).toEqual(['test']);

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('sourceRoots added');
  });

  it('ST-S08-11: sync preserves existing sourceRoots if already present', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.sourceRoots = { src: ['lib'], test: ['tests', 'spec'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    const after = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(after.sourceRoots.src).toEqual(['lib']);
    expect(after.sourceRoots.test).toEqual(['tests', 'spec']);

    const allLogs = con.logs.join('\n');
    expect(allLogs).not.toContain('sourceRoots added');
  });
});
