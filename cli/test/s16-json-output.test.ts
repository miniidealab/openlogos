import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { collectDetectData, detect } from '../src/commands/detect.js';
import { collectStatusData, status } from '../src/commands/status.js';
import { verify } from '../src/commands/verify.js';
import { VERSION, parseFormat, makeEnvelope, makeErrorEnvelope } from '../src/lib/json-output.js';

/* ========== Unit Tests — json-output helpers ========== */

describe('JSON output — parseFormat', () => {
  it('UT-JSON-01: returns "json" when --format json is present', () => {
    expect(parseFormat(['status', '--format', 'json'])).toBe('json');
  });

  it('UT-JSON-02: returns "text" when --format is absent', () => {
    expect(parseFormat(['status'])).toBe('text');
  });

  it('UT-JSON-03: returns "text" when --format has non-json value', () => {
    expect(parseFormat(['status', '--format', 'xml'])).toBe('text');
  });

  it('UT-JSON-04: returns "text" when --format is the last arg without value', () => {
    expect(parseFormat(['status', '--format'])).toBe('text');
  });
});

describe('JSON output — makeEnvelope', () => {
  it('UT-JSON-05: creates envelope with correct structure', () => {
    const envelope = makeEnvelope('status', { test: true });
    expect(envelope.command).toBe('status');
    expect(envelope.version).toBe(VERSION);
    expect(envelope.timestamp).toBeDefined();
    expect(envelope.data).toEqual({ test: true });
    expect(envelope.error).toBeUndefined();
  });
});

describe('JSON output — makeErrorEnvelope', () => {
  it('UT-JSON-06: creates error envelope with correct structure', () => {
    const envelope = makeErrorEnvelope('verify', 'NO_TEST_RESULTS', 'Not found');
    expect(envelope.command).toBe('verify');
    expect(envelope.version).toBe(VERSION);
    expect(envelope.error).toEqual({ code: 'NO_TEST_RESULTS', message: 'Not found' });
    expect(envelope.data).toBeUndefined();
  });
});

/* ========== Unit Tests — collectDetectData ========== */

describe('JSON output — collectDetectData', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-JSON-07: returns project info when config exists', () => {
    scaffoldProject(root, { name: 'my-app', locale: 'zh' });
    const data = collectDetectData(root);
    expect(data.cli.version).toBe(VERSION);
    expect(data.cli.node_version).toBe(process.version);
    expect(data.project).not.toBeNull();
    expect(data.project!.name).toBe('my-app');
    expect(data.project!.locale).toBe('zh');
    expect(data.project!.source_roots).toBeNull();
  });

  it('UT-JSON-07b: returns source_roots when config has sourceRoots', () => {
    scaffoldProject(root, { name: 'my-app', locale: 'en' });
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.sourceRoots = { src: ['src', 'lib'], test: ['tests'] };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const data = collectDetectData(root);
    expect(data.project!.source_roots).toEqual({ src: ['src', 'lib'], test: ['tests'] });
  });

  it('UT-JSON-08: returns null project when no config', () => {
    const data = collectDetectData(root);
    expect(data.project).toBeNull();
    expect(data.cli.version).toBe(VERSION);
  });
});

/* ========== Scenario Tests — detect command ========== */

describe('JSON output — detect command', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    restoreCwd = mockCwd(root);
    con = captureConsole();
  });

  afterEach(() => {
    con.restore();
    restoreCwd();
    cleanup();
  });

  it('ST-JSON-01: detect --format json outputs valid JSON envelope', () => {
    scaffoldProject(root);
    detect('json');
    expect(con.logs).toHaveLength(1);
    const output = JSON.parse(con.logs[0]);
    expect(output.command).toBe('detect');
    expect(output.version).toBe(VERSION);
    expect(output.data.cli.version).toBe(VERSION);
    expect(output.data.project).not.toBeNull();
    expect(output.data.project.name).toBe('test-project');
  });

  it('ST-JSON-02: detect --format json with no project returns null project', () => {
    detect('json');
    const output = JSON.parse(con.logs[0]);
    expect(output.data.project).toBeNull();
  });

  it('ST-JSON-03: detect text mode outputs human-readable', () => {
    scaffoldProject(root);
    detect('text');
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('OpenLogos CLI v');
    expect(allLogs).toContain('Project detected');
  });
});

/* ========== Scenario Tests — status --format json ========== */

describe('JSON output — status --format json', () => {
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

  it('ST-JSON-04: status --format json outputs valid envelope', () => {
    status('json');
    expect(con.logs).toHaveLength(1);
    const output = JSON.parse(con.logs[0]);
    expect(output.command).toBe('status');
    expect(output.data.phases).toHaveLength(10);
    expect(output.data.all_done).toBe(false);
    expect(output.data.current_phase).toBe('phase.1');
  });

  it('ST-JSON-05: status --format json with Phase 1 complete shows correct current_phase', () => {
    const reqDir = join(root, 'logos/resources/prd/1-product-requirements');
    mkdirSync(reqDir, { recursive: true });
    writeFileSync(join(reqDir, '01-requirements.md'), '# Requirements');

    status('json');
    const output = JSON.parse(con.logs[0]);
    expect(output.data.phases[0].done).toBe(true);
    expect(output.data.current_phase).toBe('phase.2');
  });

  it('ST-JSON-06: status --format json with all phases done', () => {
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

    status('json');
    const output = JSON.parse(con.logs[0]);
    expect(output.data.all_done).toBe(true);
    expect(output.data.current_phase).toBeNull();
  });

  it('ST-JSON-07: status --format json shows active proposals', () => {
    const changePath = join(root, 'logos', 'changes', 'add-feature');
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, 'proposal.md'), '# Proposal');
    writeFileSync(join(changePath, 'tasks.md'), '# Tasks');

    status('json');
    const output = JSON.parse(con.logs[0]);
    const proposal = output.data.active_proposals.find((p: { name: string }) => p.name === 'add-feature');
    expect(proposal).toBeDefined();
    expect(proposal.has_proposal).toBe(true);
    expect(proposal.has_tasks).toBe(true);
  });

  it('ST-JSON-08: status --format json error for uninitialized project', () => {
    con.restore();
    restoreCwd();
    const { root: emptyRoot, cleanup: clean2 } = makeTempRoot();
    const restore2 = mockCwd(emptyRoot);
    con = captureConsole();

    try {
      expect(() => status('json')).toThrow('process.exit(1)');
      const errorOutput = JSON.parse(con.errors[0]);
      expect(errorOutput.error.code).toBe('PROJECT_NOT_INITIALIZED');
    } finally {
      con.restore();
      restore2();
      clean2();
    }
  });
});

/* ========== Scenario Tests — verify --format json ========== */

describe('JSON output — verify --format json', () => {
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'en' });
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

  function writeTestCases(content: string) {
    const dir = join(root, 'logos/resources/test');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'S01-test-cases.md'), content);
  }

  function writeResults(lines: string[]) {
    const dir = join(root, 'logos/resources/verify');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'test-results.jsonl'), lines.join('\n') + '\n');
  }

  const CASES_ALL_PASS = `# Test Cases
| UT-S01-01 | desc |
| ST-S01-01 | desc |

## 三、覆盖度校验

- [x] Condition A
- [x] Condition B

## 四、验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------||
| S01-AC-01 | normal init | ST-S01-01 |
| S01-AC-02 | unit check | UT-S01-01 |
`;

  it('ST-JSON-09: verify --format json all pass → PASS gate', () => {
    writeTestCases(CASES_ALL_PASS);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"pass"}',
    ]);

    verify('json');

    expect(con.logs).toHaveLength(1);
    const output = JSON.parse(con.logs[0]);
    expect(output.command).toBe('verify');
    expect(output.data.gate.result).toBe('PASS');
    expect(output.data.gate.reason).toBeNull();
    expect(output.data.summary.coverage_pct).toBe(100);
    expect(output.data.summary.pass_rate_pct).toBe(100);
  });

  it('ST-JSON-10: verify --format json failed test → FAIL with reason', () => {
    writeTestCases(CASES_ALL_PASS);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"fail","error":"timeout"}',
    ]);

    expect(() => verify('json')).toThrow('process.exit(1)');

    const output = JSON.parse(con.logs[0]);
    expect(output.data.gate.result).toBe('FAIL');
    expect(output.data.gate.reason).toBe('failed_cases');
    expect(output.data.failed_cases).toHaveLength(1);
    expect(output.data.failed_cases[0].id).toBe('ST-S01-01');
  });

  it('ST-JSON-11: verify --format json uncovered → FAIL with incomplete_coverage', () => {
    const cases = `# Test Cases\n| UT-S01-01 | d |\n| ST-S01-01 | d |\n| UT-S01-02 | d |\n\n## 三、覆盖度校验\n\n- [x] ok\n`;
    writeTestCases(cases);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"pass"}',
    ]);

    expect(() => verify('json')).toThrow('process.exit(1)');

    const output = JSON.parse(con.logs[0]);
    expect(output.data.gate.result).toBe('FAIL');
    expect(output.data.gate.reason).toBe('incomplete_coverage');
    expect(output.data.uncovered_cases).toContain('UT-S01-02');
  });

  it('ST-JSON-12: verify --format json error for uninitialized project', () => {
    con.restore();
    restoreCwd();
    const { root: emptyRoot, cleanup: clean2 } = makeTempRoot();
    const restore2 = mockCwd(emptyRoot);
    con = captureConsole();

    try {
      expect(() => verify('json')).toThrow('process.exit(1)');
      const errorOutput = JSON.parse(con.errors[0]);
      expect(errorOutput.error.code).toBe('PROJECT_NOT_INITIALIZED');
    } finally {
      con.restore();
      restore2();
      clean2();
    }
  });

  it('ST-JSON-13: verify --format json error for missing results file', () => {
    writeTestCases('| UT-S01-01 | d |');

    expect(() => verify('json')).toThrow('process.exit(1)');
    const errorOutput = JSON.parse(con.errors[0]);
    expect(errorOutput.error.code).toBe('NO_TEST_RESULTS');
  });

  it('ST-JSON-14: verify --format json error for missing test cases', () => {
    writeResults(['{"id":"UT-S01-01","status":"pass"}']);

    expect(() => verify('json')).toThrow('process.exit(1)');
    const errorOutput = JSON.parse(con.errors[0]);
    expect(errorOutput.error.code).toBe('NO_TEST_CASES');
  });
});

describe('ST-JSON modules field contract', () => {
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

  it('ST-JSON-15: status --format json omits modules when yaml has no modules[]', () => {
    // scaffoldProject writes a yaml without modules[] key
    const con = captureConsole();
    status('json');
    con.restore();
    const out = JSON.parse(con.logs[0]);
    expect('modules' in out.data).toBe(false);
  });

  it('ST-JSON-16: status --format json includes modules when yaml has modules[]', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: '核心', status: 'stable', loop_phase: null }] }),
    );
    const con = captureConsole();
    status('json');
    con.restore();
    const out = JSON.parse(con.logs[0]);
    expect(Array.isArray(out.data.modules)).toBe(true);
    expect(out.data.modules[0].id).toBe('core');
  });

  it('ST-JSON-17: status --format json lifecycle is "initial" when all modules initial', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }] }),
    );
    const con = captureConsole();
    status('json');
    con.restore();
    const out = JSON.parse(con.logs[0]);
    expect(out.data.lifecycle).toBe('initial');
    expect(out.data.lifecycle).not.toBe('active');
  });

  it('ST-JSON-18: status --format json lifecycle is "launched" when a module is launched', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }),
    );
    const con = captureConsole();
    status('json');
    con.restore();
    const out = JSON.parse(con.logs[0]);
    expect(out.data.lifecycle).toBe('launched');
    expect(out.data.lifecycle).not.toBe('active');
  });

  it('ST-JSON-19: detect --format json lifecycle is derived from modules, not config', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }] }),
    );
    // Even if config has old lifecycle field, detect should derive from modules
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.lifecycle = 'active';
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const con = captureConsole();
    detect('json');
    con.restore();
    const out = JSON.parse(con.logs[0]);
    expect(out.data.project.lifecycle).toBe('launched');
    expect(out.data.project.lifecycle).not.toBe('active');
  });

  it('ST-JSON-20: status --format json modules[] items have correct ModuleStatusItem fields', () => {
    writeFileSync(
      join(root, 'logos', 'logos-project.yaml'),
      stringifyYaml({ modules: [{ id: 'core', name: 'Core', lifecycle: 'initial' }] }),
    );
    const con = captureConsole();
    status('json');
    con.restore();
    const out = JSON.parse(con.logs[0]);
    const mod = out.data.modules[0];
    // Required fields per ModuleStatusItem spec
    expect(mod).toHaveProperty('id');
    expect(mod).toHaveProperty('name');
    expect(mod).toHaveProperty('lifecycle');
    expect(mod).toHaveProperty('current_phase');
    expect(mod).toHaveProperty('current_phase_label');
    expect(mod).toHaveProperty('phase_progress');
    expect(mod).toHaveProperty('active_change');
    expect(mod).toHaveProperty('suggestion');
    // Old fields must not exist
    expect(mod).not.toHaveProperty('status');
    expect(mod).not.toHaveProperty('loop_phase');
  });
});
