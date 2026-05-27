import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { syncLogosProjectName, sync, syncScenariosModuleField } from '../src/commands/sync.js';

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
    expect(mdcFiles.length).toBe(17);
    expect(existsSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'))).toBe(true);

    expect(existsSync(join(root, 'logos', 'spec', 'test-results.md'))).toBe(true);

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('AGENTS.md updated');
    expect(allLogs).toContain('Sync complete');
    expect(allLogs).toContain('16 skills synced to .cursor/rules/');
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
    expect(skillDirs.length).toBe(16);

    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('## Active Skills');
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).not.toContain('## Active Skills');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('16 skills synced to logos/skills/');
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

  it('ST-S08-04c: sync with codex deploys plugin assets and points AGENTS.md to .agents skills', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'codex';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    expect(existsSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'hooks', 'session-start.sh'))).toBe(true);
    expect(existsSync(join(root, '.codex', 'config.toml'))).toBe(true);

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('.agents/skills/prd-writer/SKILL.md');
    expect(agents).not.toContain('logos/skills/prd-writer/SKILL.md');

    const skill = readFileSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'), 'utf-8');
    expect(skill).toMatch(/^---\nname: "prd-writer"\ndescription: "Requirements document authoring"\n---/);
  });

  it('ST-S08-04c2: sync repairs existing invalid Codex SKILL.md files', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'codex';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const skillDir = join(root, '.agents', 'skills', 'prd-writer');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '# Skill: PRD Writer\n\nOld invalid file');

    sync();

    const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf-8');
    expect(skill).toMatch(/^---\nname: "prd-writer"\ndescription: "Requirements document authoring"\n---/);
    expect(skill).toContain('# Skill: PRD Writer');
  });

  it('ST-S08-04d: sync with codex appends OpenLogos hook when another SessionStart hook already exists', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'codex';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(
      join(root, '.codex', 'config.toml'),
      '[plugins.other]\nenabled = true\n\n[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "./other.sh"\n'
    );

    sync();

    const codexConfig = readFileSync(join(root, '.codex', 'config.toml'), 'utf-8');
    expect(codexConfig).toContain('command = "./other.sh"');
    expect(codexConfig).toContain('command = ".codex-plugin/hooks/session-start.sh"');
  });

  it('ST-S08-04e: sync with codex is idempotent when OpenLogos hook already exists', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'codex';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();
    sync();

    const codexConfig = readFileSync(join(root, '.codex', 'config.toml'), 'utf-8');
    const hookMatches = codexConfig.match(/command = "\.codex-plugin\/hooks\/session-start\.sh"/g) ?? [];
    expect(hookMatches).toHaveLength(1);
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

  it('ST-S08-10: sync with all includes codex assets', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = ['claude-code', 'opencode', 'codex', 'cursor'];
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    expect(existsSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
  });

  it('ST-S08-10b: sync with all keeps skills for all deployable tools and generates shared docs', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = ['claude-code', 'opencode', 'codex', 'cursor'];
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    expect(existsSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'))).toBe(true);
    expect(existsSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('logos/skills/prd-writer/SKILL.md');
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('logos/skills/prd-writer/SKILL.md');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('16 skills synced to .cursor/rules/');
    expect(allLogs).toContain('16 skills synced to logos/skills/');
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

  it('ST-S08-12: sync auto-migrates old config.lifecycle=active with single module', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'active';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }] }, { lineWidth: 0 }),
    );

    sync();

    const yaml = parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8'));
    expect(yaml.modules[0].lifecycle).toBe('launched');
    expect(con.logs.join('\n')).toContain('Migrated');
  });

  it('ST-S08-13: sync warns when old config.lifecycle=active with multiple modules', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'active';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'initial' },
          { id: 'payment', name: 'Payment', lifecycle: 'initial' },
        ],
      }, { lineWidth: 0 }),
    );

    sync();

    const allOutput = [...con.logs, ...con.errors].join('\n');
    expect(allOutput).toContain('Warning');
  });

  it('ST-S08-14: sync with claude-code deploys .claude/ plugin assets', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'claude-code';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    sync();

    // commands deployed
    expect(existsSync(join(root, '.claude', 'commands', 'openlogos'))).toBe(true);
    const commandFiles = readdirSync(join(root, '.claude', 'commands', 'openlogos')).filter(f => f.endsWith('.md'));
    expect(commandFiles.length).toBeGreaterThan(0);

    // agents deployed
    expect(existsSync(join(root, '.claude', 'agents'))).toBe(true);

    // bin deployed
    expect(existsSync(join(root, '.claude', 'openlogos', 'bin', 'openlogos-phase'))).toBe(true);

    // settings.json has SessionStart hook
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true);
    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks?.SessionStart).toBeDefined();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('.claude/');
  });

  it('ST-S08-15: sync with claude-code skips plugin deploy when .claude/commands/openlogos/ already exists', () => {
    scaffoldProject(root, { locale: 'en' });

    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'claude-code';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    // Pre-create commands dir with a file to trigger idempotency skip
    const commandsDir = join(root, '.claude', 'commands', 'openlogos');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, 'status.md'), '# status');

    sync();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('already deployed');
  });

  it('UT-S08-03: sync backfills verify.pre_run_command when test script is recognizable', () => {
    scaffoldProject(root, { locale: 'en' });
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'sync-app',
      scripts: { test: 'vitest run' },
    }));

    sync();

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.verify.pre_run_command).toBe('npm test');
    expect(con.logs.join('\n')).toContain('verify pre-run config detected and written');
  });

  it('UT-S08-04: sync prints TODO when verify pre-run command cannot be inferred', () => {
    scaffoldProject(root, { locale: 'en' });

    sync();

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.verify.pre_run_command).toBeUndefined();
    expect(con.logs.join('\n')).toContain('verify pre-run config could not be inferred');
  });
});

/* ========== Unit Tests — syncScenariosModuleField ========== */

describe('S08 Unit Tests — syncScenariosModuleField', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root);
  });
  afterEach(() => cleanup());

  it('UT-S08-SM-01: backfills module field for scenarios without one, infers from file system', () => {
    // core-S01-xxx.md exists → S01 should get module: core
    const scenDir = join(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation');
    mkdirSync(scenDir, { recursive: true });
    writeFileSync(join(scenDir, 'core-S01-user-register.md'), '# S01');

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
        scenarios: [{ id: 'S01', name: '用户注册' }],
      }, { lineWidth: 0 }),
    );

    const updated = syncScenariosModuleField(root);
    expect(updated).toBe(1);

    const yaml = parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8'));
    expect(yaml.scenarios[0].module).toBe('core');
  });

  it('UT-S08-SM-02: falls back to core when no matching file found', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'initial' },
          { id: 'admin', name: 'Admin', lifecycle: 'initial' },
        ],
        scenarios: [{ id: 'S01', name: '用户注册' }],
      }, { lineWidth: 0 }),
    );

    const updated = syncScenariosModuleField(root);
    expect(updated).toBe(1);

    const yaml = parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8'));
    expect(yaml.scenarios[0].module).toBe('core');
  });

  it('UT-S08-SM-03: does not overwrite existing module field (idempotent)', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
        scenarios: [{ id: 'S01', name: '用户注册', module: 'admin' }],
      }, { lineWidth: 0 }),
    );

    const updated = syncScenariosModuleField(root);
    expect(updated).toBe(0);

    const yaml = parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8'));
    expect(yaml.scenarios[0].module).toBe('admin'); // unchanged
  });

  it('UT-S08-SM-04: infers correct module for multi-module project', () => {
    const scenDir = join(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation');
    mkdirSync(scenDir, { recursive: true });
    writeFileSync(join(scenDir, 'core-S01-login.md'), '# S01');
    writeFileSync(join(scenDir, 'admin-S02-dashboard.md'), '# S02');

    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        modules: [
          { id: 'core', name: 'Core', lifecycle: 'initial' },
          { id: 'admin', name: 'Admin', lifecycle: 'initial' },
        ],
        scenarios: [
          { id: 'S01', name: '用户登录' },
          { id: 'S02', name: '管理员看板' },
        ],
      }, { lineWidth: 0 }),
    );

    const updated = syncScenariosModuleField(root);
    expect(updated).toBe(2);

    const yaml = parseYaml(readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8'));
    expect(yaml.scenarios[0].module).toBe('core');
    expect(yaml.scenarios[1].module).toBe('admin');
  });

  it('UT-S08-SM-05: returns 0 when no scenarios in yaml', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }] }, { lineWidth: 0 }),
    );

    const updated = syncScenariosModuleField(root);
    expect(updated).toBe(0);
  });

  it('ST-S08-SM-06: sync command logs when scenarios module fields are backfilled', () => {
    const scenDir = join(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation');
    mkdirSync(scenDir, { recursive: true });
    writeFileSync(join(scenDir, 'core-S01-login.md'), '# S01');

    scaffoldProject(root, { locale: 'en' });
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({
        project: { name: 'test', description: '' },
        modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }],
        scenarios: [{ id: 'S01', name: 'Login' }],
      }, { lineWidth: 0 }),
    );

    const restoreCwd = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    try {
      sync();
      expect(con.logs.join('\n')).toContain('scenario');
    } finally {
      con.restore();
      exitSpy.mockRestore();
      restoreCwd();
    }
  });
});
