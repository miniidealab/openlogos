import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  readConfigName,
  detectProjectName,
  createLogosConfig,
  createLogosProject,
  createAgentsMd,
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
    expect(parsed.documents.prd).toBeDefined();
    expect(parsed.verify.result_path).toBeDefined();
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

  it('ST-S01-01: full init with explicit project name', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1']; // choose English

    await init('my-project');

    expect(existsSync(join(root, 'logos', 'logos.config.json'))).toBe(true);
    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.name).toBe('my-project');
    expect(config.locale).toBe('en');

    expect(existsSync(join(root, 'logos', 'logos-project.yaml'))).toBe(true);
    const yaml = readFileSync(join(root, 'logos', 'logos-project.yaml'), 'utf-8');
    expect(yaml).toContain('name: "my-project"');

    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    const agents = readFileSync(join(root, 'AGENTS.md'), 'utf-8');
    const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf-8');
    expect(agents).toBe(claude);

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('✓');
    expect(allLogs).toContain('Next steps');
  });

  it('ST-S01-02: auto-detect project name from directory', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['1'];

    await init();

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.name).toBe(basename(root));
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain(basename(root));
  });

  it('ST-S01-03: choose Chinese locale', async () => {
    process.stdin.isTTY = true;
    readlineAnswers = ['2']; // choose Chinese

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

  it('ST-S01-05: non-TTY environment skips language selection', async () => {
    process.stdin.isTTY = undefined as unknown as boolean;

    await init('ci-project');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.locale).toBe('en');
    expect(config.name).toBe('ci-project');
  });

  it('ST-S01-06: name conflict — user selects package.json name', async () => {
    process.stdin.isTTY = true;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'old-name' }));
    readlineAnswers = ['1', '2']; // 1=English, 2=choose package.json name

    await init('new-name');

    const config = JSON.parse(readFileSync(join(root, 'logos', 'logos.config.json'), 'utf-8'));
    expect(config.name).toBe('old-name');
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('old-name');
  });
});
