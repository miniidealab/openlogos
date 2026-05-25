import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  readConfigName,
  detectProjectName,
  createLogosConfig,
  createLogosProject,
  createAgentsMd,
  findSkillsSource,
  deploySkills,
  deployClaudeCodePlugin,
  findClaudePluginTemplateSource,
  generatePolicyMdc,
  createCodexSkillContent,
  mergeAiToolConfig,
  resolveDocsAiToolForTarget,
  SKILL_NAMES,
  init,
} from '../src/commands/init.js';
import { readLocale, t } from '../src/i18n.js';

/* ---------- Readline mock setup ---------- */
let readlineAnswers: string[] = [];
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
    expect(parsed.lifecycle).toBeUndefined();
    expect(parsed.documents.prd).toBeDefined();
    expect(parsed.documents.changes).toBeDefined();
    expect(parsed.documents.changes.path).toBe('./changes');
    expect(parsed.verify.result_path).toBeDefined();
    expect(parsed.sourceRoots).toBeDefined();
    expect(parsed.sourceRoots.src).toEqual(['src']);
    expect(parsed.sourceRoots.test).toEqual(['test']);
  });

  it('UT-S01-07b: createLogosConfig includes aiTool when provided', () => {
    const output = createLogosConfig('test', 'en', 'claude-code');
    const parsed = JSON.parse(output);
    expect(parsed.aiTool).toBe('claude-code');
  });

  it('UT-S01-07c: createLogosConfig includes codex in all mode', () => {
    const output = createLogosConfig('test', 'en', 'all');
    const parsed = JSON.parse(output);
    expect(parsed.aiTool).toContain('codex');
  });

  it('UT-S01-08: createLogosProject includes project name and zh conventions', () => {
    const output = createLogosProject('test', 'zh');
    expect(output).toContain('name: "test"');
    expect(output).toContain('遵循 OpenLogos');
  });

  it('UT-S01-09: createAgentsMd includes Phase detection logic', () => {
    const output = createAgentsMd('en');
    expect(output).toContain('Phase detection logic');
    expect(output).toContain('prd-writer');
    expect(output).toContain('product-designer');
  });

  it('UT-S01-09b: createAgentsMd includes Step 5 batch execution rules in English', () => {
    const output = createAgentsMd('en');
    expect(output).toContain('Step 5 execution rules (large tasks)');
    expect(output).toContain('UT/ST case IDs');
    expect(output).toContain('test-results.jsonl');
  });

  it('UT-S01-09c: createAgentsMd includes Step 5 batch execution rules in Chinese', () => {
    const output = createAgentsMd('zh');
    expect(output).toContain('Step 5 执行规则（大任务）');
    expect(output).toContain('UT/ST 用例 ID');
    expect(output).toContain('test-results.jsonl');
  });

  it('UT-S01-09d: createAgentsMd includes document post-edit verification (zh + en)', () => {
    const zh = createAgentsMd('zh');
    expect(zh).toContain('文档修改后的验证（强制）');
    expect(zh).toContain('从磁盘重新读取');
    const en = createAgentsMd('en');
    expect(en).toContain('Document Edit Verification (Required)');
    expect(en).toContain('re-read the affected span');
  });

  it('UT-S01-10: createAgentsMd switches conventions by locale', () => {
    const en = createAgentsMd('en');
    const zh = createAgentsMd('zh');
    expect(en).toContain('Follow the OpenLogos');
    expect(zh).toContain('遵循 OpenLogos');
  });

  it('UT-S01-10b: createAgentsMd uses .agents skill paths for codex agents target', () => {
    const output = createAgentsMd('en', 'codex', 'agents');
    expect(output).toContain('.agents/skills/prd-writer/SKILL.md');
    expect(output).not.toContain('logos/skills/prd-writer/SKILL.md');
  });

  it('UT-S01-10c: resolveDocsAiToolForTarget keeps cursor+codex AGENTS.md on Codex skill paths', () => {
    expect(resolveDocsAiToolForTarget(['cursor', 'codex'], 'agents')).toBe('codex');
    expect(resolveDocsAiToolForTarget(['cursor', 'codex'], 'claude')).toBe('cursor');
  });
});

describe('S01 Unit Tests — aiTool config merge', () => {
  it('UT-S01-43: mergeAiToolConfig appends requested tool without duplicates', () => {
    expect(mergeAiToolConfig('cursor', 'codex')).toEqual(['cursor', 'codex']);
    expect(mergeAiToolConfig(['cursor', 'codex'], 'codex')).toEqual(['cursor', 'codex']);
  });

  it('UT-S01-44: mergeAiToolConfig expands all to every deployable target', () => {
    expect(mergeAiToolConfig('cursor', 'all')).toEqual(['claude-code', 'opencode', 'codex', 'cursor']);
  });
});

describe('S01 Unit Tests — packaging and usage text', () => {
  it('UT-S01-11: cli package.json includes codex plugin template in publish artifacts', async () => {
    const pkgText = readFileSync(join(rootDir, 'cli', 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgText);

    expect(pkg.files).toContain('codex-plugin-template');
    expect(pkg.scripts.prepack).toContain("../plugin-codex");
    expect(pkg.scripts.postpack).toContain("./codex-plugin-template");
  });

  it('UT-S01-12: help text and non-interactive usage include codex', async () => {
    const indexText = readFileSync(join(rootDir, 'cli', 'src', 'index.ts'), 'utf-8');
    const initText = readFileSync(join(rootDir, 'cli', 'src', 'commands', 'init.ts'), 'utf-8');

    expect(indexText).toContain('--ai-tool <claude-code|opencode|codex|cursor|other|all>');
    expect(indexText).toContain('--aitool <claude-code|opencode|codex|cursor|other|all>');
    expect(initText).toContain('--ai-tool <claude-code|opencode|codex|cursor|other|all>');
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

  it('UT-S01-17b: opencode → AGENTS.md includes Active Skills', () => {
    const output = createAgentsMd('en', 'opencode', 'agents');
    expect(output).toContain('## Active Skills');
  });

  it('UT-S01-18b: opencode → CLAUDE.md does NOT include Active Skills', () => {
    const output = createAgentsMd('en', 'opencode', 'claude');
    expect(output).not.toContain('## Active Skills');
  });

  it('UT-S01-19: other → both include Active Skills', () => {
    const agents = createAgentsMd('en', 'other', 'agents');
    const claude = createAgentsMd('en', 'other', 'claude');
    expect(agents).toContain('## Active Skills');
    expect(claude).toContain('## Active Skills');
  });

  it('UT-S01-20: Active Skills section lists all 16 skills', () => {
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
  it('UT-S01-27: en locale includes English language policy with highest priority', () => {
    const output = createAgentsMd('en', 'cursor', 'agents');
    expect(output).toContain('Language Policy (Highest Priority)');
    expect(output).toContain('MUST be in English');
    expect(output).toContain('"en"');
  });

  it('UT-S01-28: zh locale includes Chinese language policy with highest priority', () => {
    const output = createAgentsMd('zh', 'cursor', 'agents');
    expect(output).toContain('语言策略（最高优先级）');
    expect(output).toContain('必须使用中文');
    expect(output).toContain('"zh"');
  });

  it('UT-S01-29: en locale active lifecycle includes enforced Change Management with guard', () => {
    const output = createAgentsMd('en', 'cursor', 'agents', true);
    expect(output).toContain('Change Management (Enforced)');
    expect(output).toContain('.openlogos-guard');
    expect(output).toContain('openlogos change');
    expect(output).toContain('Behavioral Constraints');
    expect(output).toContain('do NOT modify code directly');
  });

  it('UT-S01-30: zh locale active lifecycle includes enforced Change Management with guard', () => {
    const output = createAgentsMd('zh', 'cursor', 'agents', true);
    expect(output).toContain('变更管理（强制执行）');
    expect(output).toContain('.openlogos-guard');
    expect(output).toContain('openlogos change');
    expect(output).toContain('行为约束');
    expect(output).toContain('禁止直接修改代码');
  });

  it('UT-S01-31: initial lifecycle shows soft Change Management in AGENTS.md', () => {
    const output = createAgentsMd('en', 'cursor', 'agents', false);
    expect(output).toContain('Auto-detect');
    expect(output).toContain('openlogos launch');
    expect(output).not.toContain('Enforced');
  });

  it('UT-S01-32: zh initial lifecycle shows soft Change Management', () => {
    const output = createAgentsMd('zh', 'cursor', 'agents', false);
    expect(output).toContain('自动判断');
    expect(output).toContain('openlogos launch');
    expect(output).not.toContain('必须遵守');
  });
});

describe('S01 Unit Tests — generatePolicyMdc lifecycle', () => {
  it('UT-S01-33: initial lifecycle policy has soft change management', () => {
    const content = generatePolicyMdc('en', false);
    expect(content).toContain('alwaysApply: true');
    expect(content).toContain('Language Policy (Highest Priority)');
    expect(content).toContain('Auto-detect');
    expect(content).toContain('openlogos launch');
    expect(content).not.toContain('stop coding immediately');
  });

  it('UT-S01-34: active lifecycle policy has enforced change management with guard', () => {
    const content = generatePolicyMdc('en', true);
    expect(content).toContain('Language Policy (Highest Priority)');
    expect(content).toContain('Change Management (Enforced)');
    expect(content).toContain('.openlogos-guard');
  });

  it('UT-S01-35: zh initial lifecycle policy', () => {
    const content = generatePolicyMdc('zh', false);
    expect(content).toContain('语言策略（最高优先级）');
    expect(content).toContain('自动判断');
    expect(content).not.toContain('立即停止编码');
  });

  it('UT-S01-36: zh active lifecycle policy with guard', () => {
    const content = generatePolicyMdc('zh', true);
    expect(content).toContain('语言策略（最高优先级）');
    expect(content).toContain('变更管理（强制执行）');
    expect(content).toContain('.openlogos-guard');
  });
});

describe('S01 Unit Tests — Claude Code Skill Binding', () => {
  it('UT-S01-37: claude-code CLAUDE.md has Skill paths in Phase detection', () => {
    const output = createAgentsMd('en', 'claude-code', 'claude');
    expect(output).toContain('logos/skills/prd-writer/SKILL.md');
    expect(output).toContain('logos/skills/scenario-architect/SKILL.md');
    expect(output).toContain('read');
    expect(output).toContain('follow');
  });

  it('UT-S01-38: claude-code CLAUDE.md has auto-load instruction in Active Skills', () => {
    const output = createAgentsMd('en', 'claude-code', 'claude');
    expect(output).toContain('MUST first read the corresponding Skill file');
  });

  it('UT-S01-39: cursor AGENTS.md has Skill paths in Phase detection', () => {
    const output = createAgentsMd('en', 'cursor', 'agents');
    expect(output).toContain('logos/skills/prd-writer/SKILL.md');
    expect(output).toContain('follow its steps');
  });

  it('UT-S01-40: cursor CLAUDE.md does NOT have Skill paths (plain detection)', () => {
    const output = createAgentsMd('en', 'cursor', 'claude');
    expect(output).not.toContain('logos/skills/prd-writer/SKILL.md');
    expect(output).toContain('Phase detection logic:');
  });

  it('UT-S01-41: zh locale claude-code has Chinese Skill binding', () => {
    const output = createAgentsMd('zh', 'claude-code', 'claude');
    expect(output).toContain('logos/skills/prd-writer/SKILL.md');
    expect(output).toContain('必须先读取');
  });

  it('UT-S01-42: no aiTool defaults to plain Phase detection', () => {
    const output = createAgentsMd('en');
    expect(output).toContain('Phase detection logic:');
    expect(output).not.toContain('logos/skills/prd-writer/SKILL.md');
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
      expect(result!.count).toBe(16);
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

  it('UT-S01-23d: deploySkills cursor deploys openlogos-policy.mdc (initial lifecycle)', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      deploySkills(root, 'cursor', 'en');
      const policyPath = join(root, '.cursor', 'rules', 'openlogos-policy.mdc');
      expect(existsSync(policyPath)).toBe(true);
      const content = readFileSync(policyPath, 'utf-8');
      expect(content).toContain('alwaysApply: true');
      expect(content).toContain('Language Policy (Highest Priority)');
      expect(content).toContain('Auto-detect');
    } finally {
      cleanup();
    }
  });

  it('UT-S01-23d2: deploySkills cursor active lifecycle has enforced policy with guard', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      deploySkills(root, 'cursor', 'en', 'active');
      const content = readFileSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'), 'utf-8');
      expect(content).toContain('Change Management (Enforced)');
      expect(content).toContain('.openlogos-guard');
      expect(content).not.toContain('Initial Development');
    } finally {
      cleanup();
    }
  });

  it('UT-S01-23e: deploySkills cursor zh initial lifecycle policy', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      deploySkills(root, 'cursor', 'zh');
      const content = readFileSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'), 'utf-8');
      expect(content).toContain('语言策略（最高优先级）');
      expect(content).toContain('必须使用中文');
      expect(content).toContain('自动判断');
    } finally {
      cleanup();
    }
  });

  it('UT-S01-23f: createCodexSkillContent adds required YAML frontmatter', () => {
    const content = createCodexSkillContent('prd-writer', '# Skill: PRD Writer\n\nBody');

    expect(content).toMatch(/^---\nname: "prd-writer"\ndescription: "Requirements document authoring"\n---\n\n# Skill: PRD Writer/);
  });

  it('UT-S01-23g: createCodexSkillContent preserves existing YAML frontmatter', () => {
    const original = '---\nname: "custom"\ndescription: "custom desc"\n---\n\n# Body';

    expect(createCodexSkillContent('prd-writer', original)).toBe(original);
  });

  it('UT-S01-24: deploySkills claude-code deploys SKILL.md files', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const result = deploySkills(root, 'claude-code', 'en');
      expect(result).not.toBeNull();
      expect(result!.target).toBe('logos/skills/');
      expect(result!.count).toBe(16);
      expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('UT-S01-24b: deploySkills codex writes Codex-compatible SKILL.md frontmatter', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const result = deploySkills(root, 'codex', 'en');
      expect(result).not.toBeNull();
      expect(result!.target).toBe('.agents/skills/');
      expect(result!.count).toBe(16);

      const content = readFileSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'), 'utf-8');
      expect(content).toMatch(/^---\nname: "prd-writer"\ndescription: "Requirements document authoring"\n---\n\n# Skill: PRD Writer/);
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
      expect(result!.count).toBe(16);
    } finally {
      cleanup();
    }
  });

  it('UT-S01-26: deploySkills returns null when source missing', () => {
    const { root, cleanup } = makeTempRoot();
    try {
      const result = deploySkills(root, 'cursor', 'en', 'initial', '/nonexistent/path');
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

  it('ST-S01-01: full init with explicit project name (Claude Code default)', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1', '4']; // English, Cursor (option 4)

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
    expect(mdcFiles.length).toBe(17);
    expect(existsSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'))).toBe(true);

    const policyContent = readFileSync(join(root, '.cursor', 'rules', 'openlogos-policy.mdc'), 'utf-8');
    expect(policyContent).toContain('alwaysApply: true');
    expect(policyContent).toContain('Language Policy');

    expect(existsSync(join(root, 'logos', 'spec', 'test-results.md'))).toBe(true);
    expect(existsSync(join(root, 'logos', 'spec', 'sql-comment-convention.md'))).toBe(true);

    const agents2 = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents2).toContain('logos/spec/test-results.md');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('✓');
    expect(allLogs).toContain('specs deployed');
    expect(allLogs).toContain('Next steps');
    expect(allLogs).toContain('16 skills deployed to .cursor/rules/');
  });

  it('ST-S01-02: auto-detect project name from directory', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1', '4']; // English, Cursor (option 4)

    await init();

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.name).toBe(basename(root));
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain(basename(root));
  });

  it('ST-S01-03: choose Chinese locale', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['2', '4']; // Chinese, Cursor (option 4)

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
    expect(allErrors).toContain('init --ai-tool <tool>');
  });

  it('ST-S01-05: non-TTY without --locale exits with error', async () => {
    process.stdin.isTTY = undefined as unknown as boolean;

    await expect(init('ci-project')).rejects.toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('--locale is required');
  });

  it('ST-S01-05b: non-TTY with --locale and --ai-tool succeeds', async () => {
    process.stdin.isTTY = undefined as unknown as boolean;

    await init('ci-project', { locale: 'en', aiTool: 'cursor' });

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.locale).toBe('en');
    expect(config.name).toBe('ci-project');
    expect(config.aiTool).toBe('cursor');

    expect(existsSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'))).toBe(true);
  });

  it('ST-S01-05d: invalid explicit --ai-tool exits with error', async () => {
    process.stdin.isTTY = undefined as unknown as boolean;

    await expect(init('ci-project', { locale: 'en', aiTool: 'ghost' })).rejects.toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('unsupported AI tool "ghost"');
  });

  it('ST-S01-05c: non-TTY with --locale zh auto-detects claude-code from env', async () => {
    process.stdin.isTTY = undefined as unknown as boolean;
    process.env.CLAUDE_CODE = '1';

    await init('ci-project', { locale: 'zh' });

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.locale).toBe('zh');
    expect(config.aiTool).toBe('claude-code');

    delete process.env.CLAUDE_CODE;
  });

  it('ST-S01-06: name conflict — user selects package.json name', async () => {
    process.stdin.isTTY = true;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'old-name' }));
    readlineAnswers = ['1', '4', '2']; // English, Cursor (option 4), choose package.json name

    await init('new-name');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.name).toBe('old-name');
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('old-name');
  });

  it('ST-S01-07: choose Claude Code → deploys to logos/skills/ and .claude/ plugin assets', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1', '1']; // English, Claude Code (option 1, default)

    await init('cc-project');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.aiTool).toBe('claude-code');

    expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    const skillDirs = readdirSync(join(root, 'logos', 'skills'));
    expect(skillDirs.length).toBe(16);

    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('## Active Skills');
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).not.toContain('## Active Skills');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('16 skills deployed to logos/skills/');

    // Claude Code plugin assets
    expect(existsSync(join(root, '.claude', 'commands', 'openlogos'))).toBe(true);
    const commandFiles = readdirSync(join(root, '.claude', 'commands', 'openlogos')).filter(f => f.endsWith('.md'));
    expect(commandFiles.length).toBeGreaterThan(0);
    expect(existsSync(join(root, '.claude', 'agents'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'openlogos', 'bin', 'openlogos-phase'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true);
    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks?.SessionStart).toBeDefined();
  });

  it('ST-S01-07b: choose OpenCode → deploys to logos/skills/, Active Skills in AGENTS.md', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1', '2']; // English, OpenCode (option 2)

    await init('oc-project');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.aiTool).toBe('opencode');

    expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    const skillDirs = readdirSync(join(root, 'logos', 'skills'));
    expect(skillDirs.length).toBe(16);

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('## Active Skills');
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).not.toContain('## Active Skills');

    expect(existsSync(join(root, '.opencode', 'plugins', 'openlogos.js'))).toBe(true);
    expect(existsSync(join(root, '.opencode', 'commands', 'openlogos-status.md'))).toBe(true);
    const opencodeConfig = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf-8'));
    expect(opencodeConfig.permission.bash).toBe('ask');
    expect(opencodeConfig.permission.skill).toBe('allow');

    const allLogsOc = con.logs.join('\n');
    expect(allLogsOc).toContain('slash commands');
  });

  it('ST-S01-08: choose Other → both files include Active Skills', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1', '5']; // English, Other (option 5)

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
    readlineAnswers = ['2', '1']; // Chinese, Claude Code (option 1, default)

    await init('zh-cc');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.locale).toBe('zh');
    expect(config.aiTool).toBe('claude-code');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('个 Skills 已部署到 logos/skills/');

    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('需求文档编写');
  });

  it('ST-S01-10: init with codex deploys native plugin assets and binds AGENTS.md to .agents skills', async () => {
    await init('codex-project', { locale: 'en', aiTool: 'codex' });

    expect(existsSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'hooks', 'session-start.sh'))).toBe(true);
    expect(existsSync(join(root, '.codex', 'config.toml'))).toBe(true);

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('.agents/skills/prd-writer/SKILL.md');
    expect(agents).not.toContain('logos/skills/prd-writer/SKILL.md');

    const codexConfig = readFileSync(join(root, '.codex', 'config.toml'), 'utf-8');
    expect(codexConfig).toContain('[plugins.openlogos]');
    expect(codexConfig).toContain('command = ".codex-plugin/hooks/session-start.sh"');

    const skill = readFileSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'), 'utf-8');
    expect(skill).toMatch(/^---\nname: "prd-writer"\ndescription: "Requirements document authoring"\n---/);
  });

  it('ST-S01-11: init with all includes codex assets and keeps shared logos skills for compatibility', async () => {
    await init('all-project', { locale: 'en', aiTool: 'all' });

    expect(existsSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);

    const codexSkill = readFileSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'), 'utf-8');
    expect(codexSkill).toMatch(/^---\nname: "prd-writer"\ndescription: "Requirements document authoring"\n---/);

    const sharedSkill = readFileSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'), 'utf-8');
    expect(sharedSkill).not.toMatch(/^---\nname: "prd-writer"/);

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('logos/skills/prd-writer/SKILL.md');
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('logos/skills/prd-writer/SKILL.md');
  });

  it('ST-S01-12: existing cursor project can add codex target without rebuilding resources', async () => {
    scaffoldProject(root, { locale: 'en' });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    mkdirSync(join(root, '.cursor', 'rules'), { recursive: true });
    writeFileSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'), '# existing cursor skill');
    const resourcePath = join(root, 'logos', 'resources', 'prd', '1-product-requirements', 'core-01-existing.md');
    writeFileSync(resourcePath, '# existing requirements');
    const yamlPath = join(root, 'logos', 'logos-project.yaml');
    writeFileSync(yamlPath, 'project:\n  name: "test-project"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\ncustom: keep-me\n');

    await init(undefined, { aiTool: 'codex' });

    const updatedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updatedConfig.aiTool).toEqual(['cursor', 'codex']);
    expect(existsSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.codex', 'config.toml'))).toBe(true);
    expect(readFileSync(resourcePath, 'utf-8')).toBe('# existing requirements');
    expect(readFileSync(yamlPath, 'utf-8')).toContain('custom: keep-me');

    const skill = readFileSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'), 'utf-8');
    expect(skill).toMatch(/^---\nname: "prd-writer"\ndescription: "Requirements document authoring"\n---/);

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('.agents/skills/prd-writer/SKILL.md');
    expect(agents).not.toContain('logos/skills/prd-writer/SKILL.md');
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).not.toContain('## Active Skills');

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('Adding AI tool target(s)');
    expect(allLogs).toContain('16 skills synced to .agents/skills/');
    expect(allLogs).toContain('Codex plugin synced');
  });

  it('ST-S01-13: existing project can add all targets and writes stable aiTool array', async () => {
    scaffoldProject(root, { locale: 'en' });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    await init(undefined, { aiTool: 'all' });

    const updatedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updatedConfig.aiTool).toEqual(['claude-code', 'opencode', 'codex', 'cursor']);
    expect(existsSync(join(root, '.cursor', 'rules', 'prd-writer.mdc'))).toBe(true);
    expect(existsSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, 'logos', 'skills', 'prd-writer', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(root, '.opencode', 'plugins', 'openlogos.js'))).toBe(true);
    expect(existsSync(join(root, '.codex-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(root, '.claude', 'commands', 'openlogos'))).toBe(true);

    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('logos/skills/prd-writer/SKILL.md');
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(claude).toContain('logos/skills/prd-writer/SKILL.md');
  });

  it('ST-S01-14: adding codex twice is idempotent', async () => {
    scaffoldProject(root, { locale: 'en' });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.aiTool = 'cursor';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    await init(undefined, { aiTool: 'codex' });
    await init(undefined, { aiTool: 'codex' });

    const updatedConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updatedConfig.aiTool).toEqual(['cursor', 'codex']);

    const codexConfig = readFileSync(join(root, '.codex', 'config.toml'), 'utf-8');
    const hookMatches = codexConfig.match(/command = "\.codex-plugin\/hooks\/session-start\.sh"/g) ?? [];
    expect(hookMatches).toHaveLength(1);

    const skill = readFileSync(join(root, '.agents', 'skills', 'prd-writer', 'SKILL.md'), 'utf-8');
    const frontmatterMatches = skill.match(/^---$/gm) ?? [];
    expect(frontmatterMatches).toHaveLength(2);
  });
});

/* ========== Unit Tests — deployClaudeCodePlugin ========== */

describe('S01 Unit Tests — deployClaudeCodePlugin', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S01-27: deployClaudeCodePlugin deploys commands, agents, bin and settings.json', () => {
    const source = findClaudePluginTemplateSource();
    if (!source) return; // skip if template not available in this env

    const result = deployClaudeCodePlugin(root, 'en');
    expect(result).not.toBeNull();
    expect(result!.skipped).toBe(false);
    expect(result!.commandCount).toBeGreaterThan(0);
    expect(result!.agentCount).toBeGreaterThan(0);
    expect(result!.hooksUpdated).toBe(true);

    // commands deployed to .claude/commands/openlogos/
    expect(existsSync(join(root, '.claude', 'commands', 'openlogos'))).toBe(true);
    const commandFiles = readdirSync(join(root, '.claude', 'commands', 'openlogos')).filter(f => f.endsWith('.md'));
    expect(commandFiles.length).toBe(result!.commandCount);

    // agents deployed to .claude/agents/
    expect(existsSync(join(root, '.claude', 'agents'))).toBe(true);
    const agentFiles = readdirSync(join(root, '.claude', 'agents')).filter(f => f.endsWith('.md'));
    expect(agentFiles.length).toBe(result!.agentCount);

    // bin deployed to .claude/openlogos/bin/
    expect(existsSync(join(root, '.claude', 'openlogos', 'bin', 'openlogos-phase'))).toBe(true);

    // settings.json written with SessionStart hook
    expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(true);
    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.hooks?.SessionStart).toBeDefined();
    const hooks = settings.hooks.SessionStart as Array<{ hooks: Array<{ command: string }> }>;
    const hasHook = hooks.some(g => g.hooks?.some(h => h.command === '.claude/openlogos/bin/openlogos-phase'));
    expect(hasHook).toBe(true);
  });

  it('UT-S01-28: deployClaudeCodePlugin is idempotent — skips when commands dir already has files', () => {
    const source = findClaudePluginTemplateSource();
    if (!source) return;

    // First deploy
    const first = deployClaudeCodePlugin(root, 'en');
    expect(first).not.toBeNull();
    expect(first!.skipped).toBe(false);

    // Second deploy — should be skipped
    const second = deployClaudeCodePlugin(root, 'en');
    expect(second).not.toBeNull();
    expect(second!.skipped).toBe(true);
    expect(second!.commandCount).toBe(0);
    expect(second!.agentCount).toBe(0);
    expect(second!.hooksUpdated).toBe(false);
  });

  it('UT-S01-29: deployClaudeCodePlugin hooks are idempotent — does not duplicate SessionStart entry', () => {
    const source = findClaudePluginTemplateSource();
    if (!source) return;

    // First deploy writes settings.json
    deployClaudeCodePlugin(root, 'en');
    const settingsAfterFirst = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
    const countAfterFirst = (settingsAfterFirst.hooks?.SessionStart as unknown[])?.length ?? 0;

    // Manually remove commands dir so second deploy is not skipped, but settings already has hook
    const commandsDir = join(root, '.claude', 'commands', 'openlogos');
    rmSync(commandsDir, { recursive: true, force: true });

    // Second deploy — commands re-deployed, but hook should NOT be duplicated
    deployClaudeCodePlugin(root, 'en');
    const settingsAfterSecond = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
    const countAfterSecond = (settingsAfterSecond.hooks?.SessionStart as unknown[])?.length ?? 0;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it('UT-S01-30: deployClaudeCodePlugin merges hook into existing settings.json without overwriting other keys', () => {
    const source = findClaudePluginTemplateSource();
    if (!source) return;

    // Pre-create settings.json with existing content
    mkdirSync(join(root, '.claude'), { recursive: true });
    const existing = { permissions: { allow: ['Bash'] }, someOtherKey: 'value' };
    writeFileSync(join(root, '.claude', 'settings.json'), JSON.stringify(existing, null, 2));

    deployClaudeCodePlugin(root, 'en');

    const settings = JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf-8'));
    // Existing keys preserved
    expect(settings.permissions?.allow).toEqual(['Bash']);
    expect(settings.someOtherKey).toBe('value');
    // Hook added
    expect(settings.hooks?.SessionStart).toBeDefined();
  });
});
