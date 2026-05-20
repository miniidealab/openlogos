import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import { extractSmokeDefinedIds, smoke } from '../src/commands/smoke.js';

describe('S19 Unit Tests — smoke cases', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('UT-S19-01: extract SMOKE IDs from smoke test case specs', () => {
    const dir = join(root, 'logos/resources/test/smoke');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'core-smoke-test-cases.md'), 'SMOKE-core-02\nSMOKE-core-01\nSMOKE-core-01');

    expect(extractSmokeDefinedIds(root)).toEqual(['SMOKE-core-01', 'SMOKE-core-02']);
  });
});

describe('S19 Scenario Tests — smoke command', () => {
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

  function writeSmokeCases() {
    const dir = join(root, 'logos/resources/test/smoke');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'core-smoke-test-cases.md'), '| SMOKE-core-01 | health |\n| SMOKE-core-02 | main flow |');
  }

  function writeSmokeResults(lines: string[]) {
    const dir = join(root, 'logos/resources/verify');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'smoke-results.jsonl'), lines.join('\n') + '\n');
  }

  it('ST-S19-01: all smoke cases pass → Gate PASS and SMOKE_PASS marker', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'deploy-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'deploy-feature', module: 'core' }));
    writeFileSync(join(proposalDir, 'SMOKE_FAIL'), '');

    smoke('text', 'staging');

    const out = con.logs.join('\n');
    expect(out).toContain('Gate 3.8: PASS');
    expect(out).toContain('staging');
    expect(existsSync(join(root, 'logos/resources/verify/smoke-report.md'))).toBe(true);
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(true);
    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(false);
  });

  it('ST-S19-02: uncovered smoke case → Gate FAIL and SMOKE_FAIL marker', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'deploy-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'deploy-feature', module: 'core' }));

    expect(() => smoke()).toThrow('process.exit(1)');

    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(true);
    const report = readFileSync(join(root, 'logos/resources/verify/smoke-report.md'), 'utf-8');
    expect(report).toContain('SMOKE-core-02');
  });

  it('ST-S19-03: json output has smoke envelope', () => {
    writeSmokeCases();
    writeSmokeResults([
      '{"id":"SMOKE-core-01","status":"pass"}',
      '{"id":"SMOKE-core-02","status":"pass"}',
    ]);

    smoke('json', 'production');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.command).toBe('smoke');
    expect(parsed.data.environment).toBe('production');
    expect(parsed.data.gate.result).toBe('PASS');
  });
});
