import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  parseJsonl,
  extractDefinedIds,
  extractChecklist,
  extractAcTrace,
  generateReport,
  verify,
  type TestResult,
  type ChecklistItem,
  type AcTraceEntry,
} from '../src/commands/verify.js';

/* ========== Unit Tests ========== */

describe('S13 Unit Tests — parseJsonl', () => {
  it('UT-S13-01: parse normal multi-line JSONL', () => {
    const input = '{"id":"UT-S01-01","status":"pass"}\n{"id":"ST-S01-01","status":"fail","error":"timeout"}';
    const results = parseJsonl(input);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('pass');
    expect(results[1].status).toBe('fail');
    expect(results[1].error).toBe('timeout');
  });

  it('UT-S13-02: skip malformed lines without throwing', () => {
    const input = '{"id":"UT-S01-01","status":"pass"}\nnot-json\n{"id":"ST-S01-01","status":"pass"}';
    const results = parseJsonl(input);
    expect(results).toHaveLength(2);
  });

  it('UT-S13-03: last occurrence wins for duplicate IDs', () => {
    const input = '{"id":"UT-S01-01","status":"fail"}\n{"id":"UT-S01-01","status":"pass"}';
    const results = parseJsonl(input);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pass');
  });

  it('UT-S13-04: ignore empty and whitespace-only lines', () => {
    const input = '\n  \n{"id":"UT-S01-01","status":"pass"}\n\n';
    const results = parseJsonl(input);
    expect(results).toHaveLength(1);
  });
});

describe('S13 Unit Tests — extractDefinedIds', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S13-05: extract UT/ST IDs from test-cases.md', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      '| UT-S01-01 | desc |\n| ST-S01-01 | desc |',
    );
    const { ids } = extractDefinedIds(root);
    expect(ids).toContain('UT-S01-01');
    expect(ids).toContain('ST-S01-01');
  });

  it('UT-S13-06: deduplicate and sort IDs', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      'ST-S01-01 appears here\nST-S01-01 and again\nUT-S01-02 also\n',
    );
    const { ids } = extractDefinedIds(root);
    expect(ids.filter(id => id === 'ST-S01-01')).toHaveLength(1);
    expect(ids).toEqual([...ids].sort());
  });

  it('UT-S13-07: count UT and ST separately', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      'UT-S01-01 UT-S01-02 UT-S01-03 ST-S01-01 ST-S01-02',
    );
    const { utCount, stCount } = extractDefinedIds(root);
    expect(utCount).toBe(3);
    expect(stCount).toBe(2);
  });

  it('UT-S13-08: return empty when test dir does not exist', () => {
    const result = extractDefinedIds(root);
    expect(result).toEqual({ ids: [], utCount: 0, stCount: 0 });
  });
});

describe('S13 Unit Tests — extractChecklist', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S13-09: parse checked and unchecked items', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      '## 三、覆盖度校验\n\n- [x] 条件A\n- [ ] 条件B\n\n## 四、验收条件追溯\n',
    );
    const items = extractChecklist(root);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ checked: true, text: '条件A' });
    expect(items[1]).toMatchObject({ checked: false, text: '条件B' });
  });

  it('UT-S13-10: only parse checklist within section 三', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      '## 一、单元测试用例\n\n- [ ] not this one\n\n## 三、覆盖度校验\n\n- [x] only this\n',
    );
    const items = extractChecklist(root);
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('only this');
  });
});

describe('S13 Unit Tests — extractAcTrace', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S13-11: parse AC traceability table row', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      '## 四、验收条件追溯\n\n| AC ID | 验收条件 | 覆盖用例 |\n|-------|---------|--------|\n| S01-AC-01 | 条件描述 | ST-S01-01 |\n',
    );
    const entries = extractAcTrace(root);
    expect(entries).toHaveLength(1);
    expect(entries[0].acId).toBe('S01-AC-01');
    expect(entries[0].description).toBe('条件描述');
    expect(entries[0].linkedCaseIds).toEqual(['ST-S01-01']);
  });

  it('UT-S13-12: split multiple linked case IDs', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      '## 四、验收条件追溯\n\n| AC ID | 验收条件 | 覆盖用例 |\n|-------|---------|--------|\n| S01-AC-03 | 异常处理 | ST-S01-03, UT-S01-05 |\n',
    );
    const entries = extractAcTrace(root);
    expect(entries[0].linkedCaseIds).toEqual(['ST-S01-03', 'UT-S01-05']);
  });

  it('UT-S13-13: return empty when section 四 does not exist', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      '## 三、覆盖度校验\n\n- [x] done\n',
    );
    const entries = extractAcTrace(root);
    expect(entries).toEqual([]);
  });
});

describe('S13 Unit Tests — generateReport', () => {
  const makeResults = (specs: Array<{ id: string; status: 'pass' | 'fail' | 'skip'; error?: string }>): TestResult[] =>
    specs.map(s => ({ id: s.id, status: s.status, error: s.error }));

  it('UT-S13-14: generate Markdown with Summary table and PASS gate', () => {
    const defined = ['UT-S01-01', 'ST-S01-01'];
    const results = makeResults([
      { id: 'UT-S01-01', status: 'pass' },
      { id: 'ST-S01-01', status: 'pass' },
    ]);
    const report = generateReport(
      defined, results, results, [], [], [],
      '100', '100', 'PASS', [], [], new Set(['UT-S01-01', 'ST-S01-01']),
    );
    expect(report).toContain('# Acceptance Report');
    expect(report).toContain('Defined cases | 2');
    expect(report).toContain('**PASS**');
  });

  it('UT-S13-15: show Failed Cases section for failed results', () => {
    const defined = ['UT-S01-01'];
    const failResult = makeResults([{ id: 'UT-S01-01', status: 'fail', error: 'assert failed' }]);
    const report = generateReport(
      defined, failResult, [], failResult, [], [],
      '100', '0', 'FAIL', [], [], new Set(['UT-S01-01']),
    );
    expect(report).toContain('## Failed Cases');
    expect(report).toContain('UT-S01-01');
    expect(report).toContain('assert failed');
  });

  it('UT-S13-16: show Design-time Coverage with checklist items', () => {
    const checklist: ChecklistItem[] = [
      { checked: true, text: 'cond A', file: 'S01-test-cases.md' },
      { checked: true, text: 'cond B', file: 'S01-test-cases.md' },
      { checked: false, text: 'cond C', file: 'S01-test-cases.md' },
    ];
    const report = generateReport(
      [], [], [], [], [], [], '0', '0', 'FAIL',
      checklist, [], new Set(),
    );
    expect(report).toContain('## Design-time Coverage (Layer 1)');
    expect(report).toContain('✅');
    expect(report).toContain('❌');
    expect(report).toContain('2/3');
  });

  it('UT-S13-17: show AC Traceability with runtime status', () => {
    const results = makeResults([{ id: 'ST-S01-01', status: 'pass' }]);
    const acTrace: AcTraceEntry[] = [{
      acId: 'S01-AC-01',
      description: '正常初始化',
      linkedCaseIds: ['ST-S01-01'],
      file: 'S01-test-cases.md',
    }];
    const report = generateReport(
      ['ST-S01-01'], results, results, [], [], [],
      '100', '100', 'PASS', [], acTrace, new Set(['ST-S01-01']),
    );
    expect(report).toContain('## Acceptance Criteria Traceability (Layer 3)');
    expect(report).toContain('✅ PASS');
    expect(report).toContain('S01-AC-01');
  });
});

/* ========== Scenario Tests ========== */

describe('S13 Scenario Tests — verify command', () => {
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
|-------|---------|---------|
| S01-AC-01 | normal init | ST-S01-01 |
| S01-AC-02 | unit check | UT-S01-01 |
`;

  it('ST-S13-01: all pass + 100% coverage + checklist OK + AC pass → Gate PASS', () => {
    writeTestCases(CASES_ALL_PASS);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"pass"}',
    ]);

    verify();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('100%');
    expect(allLogs).toContain('PASS');
    expect(exitSpy).not.toHaveBeenCalled();
    expect(existsSync(join(root, 'logos/resources/verify/acceptance-report.md'))).toBe(true);
  });

  it('ST-S13-02: failed test → Gate FAIL', () => {
    writeTestCases(CASES_ALL_PASS);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"fail","error":"timeout"}',
    ]);

    expect(() => verify()).toThrow('process.exit(1)');
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('ST-S01-01');
    expect(allLogs).toContain('FAIL');
  });

  it('ST-S13-03: uncovered cases → Gate FAIL', () => {
    const cases = `# Test Cases\n| UT-S01-01 | d |\n| ST-S01-01 | d |\n| UT-S01-02 | d |\n\n## 三、覆盖度校验\n\n- [x] ok\n`;
    writeTestCases(cases);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"pass"}',
    ]);

    expect(() => verify()).toThrow('process.exit(1)');
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('67%');
    expect(allLogs).toContain('UT-S01-02');
  });

  it('ST-S13-04: unchecked checklist item → Gate FAIL', () => {
    const cases = `# Test Cases\n| UT-S01-01 | d |\n\n## 三、覆盖度校验\n\n- [x] ok\n- [ ] not ok\n`;
    writeTestCases(cases);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
    ]);

    expect(() => verify()).toThrow('process.exit(1)');
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('not ok');
    expect(allLogs).toContain('FAIL');
  });

  it('ST-S13-05: missing results file → error exit', () => {
    writeTestCases('| UT-S01-01 | d |');
    // no results file

    expect(() => verify()).toThrow('process.exit(1)');
    const allErrors = con.errors.join('\n');
    expect(allErrors).toContain('No test results found');
  });

  it('ST-S13-06: uninitialized project → error exit', () => {
    con.restore();
    restoreCwd();
    const { root: emptyRoot, cleanup: clean2 } = makeTempRoot();
    const restore2 = mockCwd(emptyRoot);
    con = captureConsole();

    try {
      expect(() => verify()).toThrow('process.exit(1)');
      const allErrors = con.errors.join('\n');
      expect(allErrors).toContain('logos.config.json not found');
    } finally {
      con.restore();
      restore2();
      clean2();
    }
  });
});
