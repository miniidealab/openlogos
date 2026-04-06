import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  readConfigName,
  detectProjectName,
  createLogosConfig,
  createLogosProject,
  createAgentsMd,
  findSkillsSource,
  deploySkills,
  SKILL_NAMES,
  init,
} from '../src/commands/init.js';
import { readLocale, t } from '../src/i18n.js';

/* ---------- Readline mock setup ---------- */
let readlineAnswers: string[] = [];
vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn((_prompt: string, cb: (answer: string) => void) => {
      cb(readlineAnswers.shift() ?? '');
    }),
    close: vi.fn(),
  })),
}));

/* ---------- Unit Tests ---------- */
describe('S01 Unit Tests — readConfigName / detectProjectName', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S01-01: should read project name from package.json', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'my-app' }));
    const result = readConfigName(root);
    expect(result).toEqual({ name: 'my-app', source: 'package.json' });
  });

  it('UT-S01-02: should strip @scope/ prefix from package.json name', () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@org/my-app' }));
    const result = readConfigName(root);
    expect(result).toEqual({ name: 'my-app', source: 'package.json' });
  });

  it('UT-S01-03: should read project name from Cargo.toml', () => {
    writeFileSync(join(root, 'Cargo.toml'), '[package]\nname = "rust-app"\nversion = "0.1.0"\n');
    const result = readConfigName(root);
    expect(result).toEqual({ name: 'rust-app', source: 'Cargo.toml' });
  });

  it('UT-S01-04: should read project name from pyproject.toml', () => {
    writeFileSync(join(root, 'pyproject.toml'), '[project]\nname = "py-app"\n');
    const result = readConfigName(root);
    expect(result).toEqual({ name: 'py-app', source: 'pyproject.toml' });
  });

  it('UT-S01-05: should return null when no config files exist', () => {
    const result = readConfigName(root);
    expect(result).toBeNull();
  });

  it('UT-S01-06: should fall back to directory name', () => {
    const result = detectProjectName(root);
    expect(result).toEqual({ name: basename(root), source: 'directory' });
  });
});

describe('S01 Unit Tests — createLogosConfig / createLogosProject / createAgentsMd', () => {
  it('UT-S01-07: createLogosConfig generates valid JSON with required fields', () => {
    const output = createLogosConfig('test', 'en');
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('test');
    expect(parsed.locale).toBe('en');
    expect(parsed.aiTool).toBe('cursor');
    expect(parsed.documents.prd).toBeDefined();
    expect(parsed.verify.result_path).toBeDefined();
  });

  it('UT-S01-07b: createLogosConfig includes aiTool when provided', () => {
    const output = createLogosConfig('test', 'en', 'claude-code');
    const parsed = JSON.parse(output);
    expect(parsed.aiTool).toBe('claude-code');
  });

  it('UT-S01-08: createLogosProject includes project name and zh conventions', () => {
    const output = createLogosProject('test', 'zh');
    expect(output).toContain('name: "test"');
    expect(output).toContain('遵循 OpenLogos');
  });

  it('UT-S01-09: createAgentsMd includes Phase detection logic', () => {
    const output = createAgentsMd('en');
    expect(output).toContain('Phase detection logic:');
    expect(output).toContain('prd-writer');
    expect(output).toContain('product-designer');
  });

  it('UT-S01-10: createAgentsMd switches conventions by locale', () => {
    const en = createAgentsMd('en');
    const zh = createAgentsMd('zh');
    expect(en).toContain('Follow the OpenLogos');
    expect(zh).toContain('遵循 OpenLogos');
  });
});

describe('S01 Unit Tests — createAgentsMd Active Skills', () => {
  it('UT-S01-15: cursor → AGENTS.md includes Active Skills', () => {
    const output = createAgentsMd('en', 'cursor', 'agents');
    expect(output).toContain('## Active Skills');
    expect(output).toContain('skills/prd-writer/');
  });

  it('UT-S01-16: cursor → CLAUDE.md does NOT include Active Skills', () => {
    const output = createAgentsMd('en', 'cursor', 'claude');
    expect(output).not.toContain('## Active Skills');
  });

  it('UT-S01-17: claude-code → CLAUDE.md includes Active Skills', () => {
    const output = createAgentsMd('en', 'claude-code', 'claude');
    expect(output).toContain('## Active Skills');
  });

  it('UT-S01-18: claude-code → AGENTS.md does NOT include Active Skills', () => {
    const output = createAgentsMd('en', 'claude-code', 'agents');
    expect(output).not.toContain('## Active Skills');
  });

  it('UT-S01-19: other → both include Active Skills', () => {
    const agents = createAgentsMd('en', 'other', 'agents');
    const claude = createAgentsMd('en', 'other', 'claude');
    expect(agents).toContain('## Active Skills');
    expect(claude).toContain('## Active Skills');
  });

  it('UT-S01-20: Active Skills section lists all 12 skills', () => {
    const output = createAgentsMd('en', 'cursor', 'agents');
    for (const name of SKILL_NAMES) {
      expect(output).toContain(`skills/${name}/`);
    }
  });

  it('UT-S01-21: Active Skills zh locale uses Chinese descriptions', () => {
    const output = createAgentsMd('zh', 'cursor', 'agents');
    expect(output).toContain('需求文档编写');
    expect(output).toContain('产品设计与原型');
  });
});

describe('S01 Unit Tests — createAgentsMd Language Policy', () => {
  it('UT-S01-27: en locale includes English language policy', () => {
    const output = createAgentsMd('en', 'cursor', 'agents');
    expect(output).toContain('## Language Policy');
    expect(output).toContain('MUST be in **English**');
    expect(output).toContain('"en"');
  });

  it('UT-S01-28: zh locale includes Chinese language policy', () => {
    const output = createAgentsMd('zh', 'cursor', 'agents');
    expect(output).toContain('## Language Policy');
    expect(output).toContain('必须使用中文');
    expect(output).toContain('"zh"');
  });

  it('UT-S01-29: en locale includes Change Management section', () => {
    const output = createAgentsMd('en', 'cursor', 'agents');
    expect(output).toContain('Change Management (Must Follow)');
    expect(output).toContain('openlogos change');
  });

  it('UT-S01-30: zh locale includes Chinese Change Management section', () => {
    const output = createAgentsMd('zh', 'cursor', 'agents');
    expect(output).toContain('变更管理（必须遵守）');
    expect(output).toContain('openlogos change');
  });
});

describe('S01 Unit Tests — findSkillsSource / deploySkills', () => {
  it('UT-S01-22: findSkillsSource finds skills directory', () => {
    const source = findSkillsSource();
    expect(source).not.toBeNull();
    expect(existsSync(join(source!, 'prd-writer', 'SKILL.md'))).toBe(true);
  });

  it('UT-S01-23: deploySkills cursor deploys .mdc files (default en)', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const result = deploySkills(root, 'cursor', 'en');
      expect(result).not.toBeNull();
      expect(result!.target).toBe('.cursor/rules/');
      expect(result!.count).toBe(12);
      expect(existsSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'))).toBe(true);

      const content = readFileSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'), 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('alwaysApply: false');
    } finally {
      cleanup();
    }
  });

  it('UT-S01-23b: deploySkills cursor en uses SKILL.en.md content', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      deploySkills(root, 'cursor', 'en');
      const content = readFileSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'), 'utf-8');
      expect(content).toContain('Trigger Conditions');
      expect(content).not.toContain('触发条件');
    } finally {
      cleanup();
    }
  });

  it('UT-S01-23c: deploySkills cursor zh uses SKILL.md (Chinese)', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      deploySkills(root, 'cursor', 'zh');
      const content = readFileSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'), 'utf-8');
      expect(content).toContain('触发条件');
    } finally {
      cleanup();
    }
  });

  it('UT-S01-23d: deploySkills cursor deploys openlogos-policy.mdc with alwaysApply', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      deploySkills(root, 'cursor', 'en');
      const policyPath = join(root, '.cursor', 'rules', 'openlogos-policy.mdc');
      expect(existsSync(policyPath)).toBe(true);
      const content = readFileSync(policyPath, 'utf-8');
      expect(content).toContain('alwaysApply: true');
      expect(content).toContain('Language Policy (Highest Priority)');
      expect(content).toContain('MUST be in English');
      expect(content).toContain('Change Management (Must Follow)');
    } finally {
      cleanup();
    }
  });

  it('UT-S01-23e: deploySkills cursor zh deploys Chinese policy', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      deploySkills(root, 'cursor', 'zh');
      const content = readFileSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'), 'utf-8');
      expect(content).toContain('语言策略（最高优先级）');
      expect(content).toContain('必须使用中文');
      expect(content).toContain('变更管理（必须遵守）');
    } finally {
      cleanup();
    }
  });

  it('UT-S01-24: deploySkills claude-code deploys SKILL.md files', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const result = deploySkills(root, 'claude-code', 'en');
      expect(result).not.toBeNull();
      expect(result!.target).toBe('logos/skills/');
      expect(result!.count).toBe(12);
      expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('UT-S01-25: deploySkills other deploys to logos/skills/', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const result = deploySkills(root, 'other', 'en');
      expect(result).not.toBeNull();
      expect(result!.target).toBe('logos/skills/');
      expect(result!.count).toBe(12);
    } finally {
      cleanup();
    }
  });

  it('UT-S01-26: deploySkills returns null when source missing', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const result = deploySkills(root, 'cursor', 'en', '/nonexistent/path');
      expect(result).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('S01 Unit Tests — i18n readLocale / t', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S01-11: readLocale returns zh when config has locale zh', () => {
    mkdirSync(join(root, 'logos'), { recursive: true });
    writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({ locale: 'zh' }));
    expect(readLocale(root)).toBe('zh');
  });

  it('UT-S01-12: readLocale defaults to en when config is missing', () => {
    expect(readLocale(root)).toBe('en');
  });

  it('UT-S01-13: t() replaces template variables', () => {
    const result = t('en', 'verify.coverage', { pct: '80', covered: '8', total: '10' });
    expect(result).toBe('Coverage:  80%  (8/10)');
  });

  it('UT-S01-14: t() returns key itself when message not found', () => {
    expect(t('zh', '不存在的key')).toBe('不存在的key');
  });
});

/* ---------- Scenario Tests ---------- */
describe('S01 Scenario Tests — init command', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
    originalIsTTY = process.stdin.isTTY;
    readlineAnswers = [];
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanup();
  });

  it('ST-S01-01: full init with explicit project name (Cursor default)', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1', '1']; // English, Cursor

    await init('my-project');

    expect(existsSync(join(root, 'logos', 'logos.config.json'))).toBe(true);
    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.name).toBe('my-project');
    expect(config.locale).toBe('en');
    expect(config.aiTool).toBe('cursor');

    expect(existsSync(join(root, 'logos', 'logos-project.yaml'))).toBe(true);
    const yaml = readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8');
    expect(yaml).toContain('name: "my-project"');

    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('## Active Skills');
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).not.toContain('## Active Skills');

    expect(existsSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'))).toBe(true);
    const mdcFiles = readdirSync(join(root, '.cursor', 'rules')).filter(f => f.endsWith('.mdc'));
    expect(mdcFiles.length).toBe(13);
    expect(existsSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'))).toBe(true);

    const policyContent = readFileSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'), 'utf-8');
    expect(policyContent).toContain('alwaysApply: true');
    expect(policyContent).toContain('Language Policy');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('✓');
    expect(allLogs).toContain('Next steps');
    expect(allLogs).toContain('12 skills deployed to .cursor/rules/');
  });

  it('ST-S01-02: auto-detect project name from directory', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1', '1']; // English, Cursor

    await init();

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.name).toBe(basename(root));
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain(basename(root));
  });

  it('ST-S01-03: choose Chinese locale', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['2', '1']; // Chinese, Cursor

    await init('zh-test');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.locale).toBe('zh');

    const yaml = readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8');
    expect(yaml).toContain('遵循 OpenLogos');
  });

  it('ST-S01-04: reject init when project already initialized', async () => {
    mkdirSync(join(root, 'logos'), { recursive: true });
    writeFileSync(join(root, 'logos', 'logos.config.json'), '{}');

    await expect(init()).rejects.toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('already exists');
  });

  it('ST-S01-05: non-TTY environment skips language and aiTool selection', async () => {
    process.stdin.isTTY = undefined as unknown as boolean;

    await init('ci-project');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.locale).toBe('en');
    expect(config.name).toBe('ci-project');
    expect(config.aiTool).toBe('cursor');

    expect(existsSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'))).toBe(true);
  });

  it('ST-S01-06: name conflict — user selects package.json name', async () => {
    process.stdin.isTTY = true;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'old-name' }));
    readlineAnswers = ['1', '1', '2']; // English, Cursor, choose package.json name

    await init('new-name');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.name).toBe('old-name');
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('old-name');
  });

  it('ST-S01-07: choose Claude Code → deploys to logos/skills/', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1', '2']; // English, Claude Code

    await init('cc-project');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.aiTool).toBe('claude-code');

    expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    const skillDirs = readdirSync(join(root, 'logos', 'skills'));
    expect(skillDirs.length).toBe(12);

    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('## Active Skills');
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).not.toContain('## Active Skills');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('12 skills deployed to logos/skills/');
  });

  it('ST-S01-08: choose Other → both files include Active Skills', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1', '3']; // English, Other

    await init('other-project');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.aiTool).toBe('other');

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('## Active Skills');
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('## Active Skills');

    expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
  });

  it('ST-S01-09: Chinese locale with Claude Code', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['2', '2']; // Chinese, Claude Code

    await init('zh-cc');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.locale).toBe('zh');
    expect(config.aiTool).toBe('claude-code');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('个 Skills 已部署到 logos/skills/');

    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('需求文档编写');
  });
});
