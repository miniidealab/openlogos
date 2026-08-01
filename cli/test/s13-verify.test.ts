import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync, existsSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit } from './helpers.js';
import {
  parseJsonl,
  parseJsonlWithDiagnostics,
  buildVerifyCountMismatches,
  extractDefinedIds,
  extractChecklist,
  extractAcTrace,
  generateReport,
  collectVerifyData,
  buildInitialPreRunData,
  runVerifyPreRun,
  verify,
  type TestResult,
  type ChecklistItem,
  type AcTraceEntry,
} from '../src/commands/verify.js';
import { readVerifyConfig } from '../src/lib/verify-config.js';
import {
  runSandboxedCommand,
  isDependencyExemptPath,
  detectRuntimeWriteProtection,
  DEPENDENCY_DIR_EXEMPT_INFO,
} from '../src/lib/sandbox.js';
import { checkSmokeCoverage, extractChangedSmokeIds } from '../src/lib/smoke-coverage.js';
import { deriveAutomationDiagnostic } from '../src/lib/automation-diagnostic.js';
import { next } from '../src/commands/next.js';
import * as childProcess from 'node:child_process';

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

  it('internal-S13-parse-malformed: skip malformed lines without throwing', () => {
    const input = '{"id":"UT-S01-01","status":"pass"}\nnot-json\n{"id":"ST-S01-01","status":"pass"}';
    const results = parseJsonl(input);
    expect(results).toHaveLength(2);
  });

  it('internal-S13-parse-duplicate-last-wins: last occurrence wins for duplicate IDs', () => {
    const input = '{"id":"UT-S01-01","status":"fail"}\n{"id":"UT-S01-01","status":"pass"}';
    const results = parseJsonl(input);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('pass');
  });

  it('internal-S13-parse-empty-lines: ignore empty and whitespace-only lines', () => {
    const input = '\n  \n{"id":"UT-S01-01","status":"pass"}\n\n';
    const results = parseJsonl(input);
    expect(results).toHaveLength(1);
  });

  it('UT-S13-35: 非法 status 不得被判 PASS', () => {
    const input = [
      '{"id":"UT-S13-35","status":"pass"}',
      '{"id":"UT-S13-BAD","status":"unknown"}',
    ].join('\n');
    const parsed = parseJsonlWithDiagnostics(input);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.invalidResults).toEqual([
      { line: 2, id: 'UT-S13-BAD', status: 'unknown', reason: 'invalid_status' },
    ]);
  });
});

describe('S13 — 自动流程证据分层诊断', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
  });
  afterEach(() => cleanup());

  function setupLaunchedSlice(tasksLine: string): string {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
      'project:',
      '  name: t',
      'modules:',
      '  - id: core',
      '    name: Core',
      '    lifecycle: launched',
    ].join('\n'));
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    const dir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), [
      '# 变更提案：feat',
      '',
      '## 变更原因',
      '需要代码。',
      '',
      '## 变更类型',
      '代码级',
      '',
      '## 变更范围',
      '- CLI',
      '',
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：无',
      '- 影响环境：无',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '实现自动流程诊断。',
    ].join('\n'));
    writeFileSync(join(dir, 'tasks.md'), [
      '# 任务',
      '',
      '## [delta] 规格变更',
      '- [x] d',
      '',
      '## [code] 代码实现',
      tasksLine,
    ].join('\n'));
    writeFileSync(join(dir, 'SPEC_MERGED'), '');
    writeFileSync(join(dir, 'SLICES_APPROVED'), '');
    return dir;
  }

  function setupReadyToMergeWithStaleVerify(): string {
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
      'project:',
      '  name: t',
      'modules:',
      '  - id: core',
      '    name: Core',
      '    lifecycle: launched',
    ].join('\n'));
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'feat', module: 'core' }));
    const dir = join(root, 'logos', 'changes', 'feat');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), [
      '# 变更提案：feat',
      '',
      '## 变更原因',
      '需要代码。',
      '',
      '## 变更类型',
      '设计级',
      '',
      '## 变更范围',
      '- CLI',
      '',
      '## 部署影响',
      '- 是否需要部署：否',
      '- 部署原因：无',
      '- 影响环境：无',
      '- 是否涉及数据迁移：否',
      '- 是否需要回滚预案：否',
      '- 是否需要 smoke：否',
      '',
      '## 变更概述',
      '实现自动流程诊断。',
    ].join('\n'));
    writeFileSync(join(dir, 'tasks.md'), '# 任务\n\n## [delta] 规格变更\n- [x] d\n');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S13-32","status":"pass"}',
      '{"id":"UT-S13-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');
    return dir;
  }

  it('UT-S13-32: verify JSON 保留本次失败诊断', () => {
    const dir = setupLaunchedSlice('- [x] 切片：覆盖 UT-S13-32');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S13-32","status":"pass"}',
      '{"id":"UT-S13-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    const data = collectVerifyData(root);

    expect(dir).toContain('feat');
    expect(data.automation_diagnostic).toMatchObject({
      reason: 'global-verify-failed',
      completion_state: 'slice_done_global_verify_failed',
      human_action_required: false,
      suggested_next_node: 'code',
    });
    expect(data.automation_diagnostic?.failed_tests).toContain('UT-S13-REG');
  });

  it('UT-S13-33 / ST-S13-10: verify 诊断不在 plan/spec 前沿自动传播为 repair', async () => {
    setupReadyToMergeWithStaleVerify();
    const restore = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    try {
      await next('json', undefined, true);
    } finally {
      con.restore();
      exitSpy.mockRestore();
      restore();
    }
    const data = JSON.parse(con.logs[con.logs.length - 1]).data;

    expect(data.proposal_step).toBe('ready-to-merge');
    expect(data.command).toBe('openlogos merge feat');
    expect(data.modules[0].automation_diagnostic).toBeUndefined();
    expect(data.modules[0].next_node).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('suggested_next_node');
  });

  it('UT-S13-34: 只有当前实现/验证前沿消费 global verify failed', async () => {
    const dir = setupLaunchedSlice('- [x] 切片：覆盖 UT-S13-34');
    writeFileSync(join(dir, 'LOOP_ITERS'),
      JSON.stringify({ iter: 1, node: 'verify', result: 'fail', module: 'core', timestamp: 't', slice: '切片：覆盖 UT-S13-34' }) + '\n');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S13-34","status":"pass"}',
      '{"id":"UT-S13-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    const restore = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    try {
      await next('json', undefined, true);
    } finally {
      con.restore();
      exitSpy.mockRestore();
      restore();
    }
    const data = JSON.parse(con.logs[con.logs.length - 1]).data;

    expect(data.modules[0].automation_diagnostic).toMatchObject({
      reason: 'global-verify-failed',
      suggested_next_node: 'code',
    });
    expect(data.modules[0].next_node.id).toBe('code');
  });

  it('UT-S13-30: focused reporter pass + global verify failed 输出可恢复诊断', () => {
    const dir = setupLaunchedSlice('- [x] 切片：覆盖 UT-S13-30、ST-S13-09');
    mkdirSync(join(root, 'cli/src/lib'), { recursive: true });
    mkdirSync(join(root, 'cli/test'), { recursive: true });
    writeFileSync(join(root, 'cli/src/lib/changed.ts'), 'export const changed = true;\n');
    writeFileSync(join(root, 'cli/test/changed.test.ts'), 'it("UT-S13-30",()=>{});\n');
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/core-S13-test-cases.md'), [
      '| ID | 描述 |',
      '|----|------|',
      '| UT-S13-30 | focused pass |',
      '| ST-S13-09 | repair |',
      '| UT-S13-REG | regression |',
    ].join('\n'));
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S13-30","status":"pass"}',
      '{"id":"ST-S13-09","status":"pass"}',
      '{"id":"UT-S13-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    const data = collectVerifyData(root);
    expect(data.automation_diagnostic).toMatchObject({
      reason: 'global-verify-failed',
      completion_state: 'slice_done_global_verify_failed',
      human_action_required: false,
      suggested_next_node: 'code',
    });
    expect(data.automation_diagnostic?.failed_tests).toContain('UT-S13-REG');

    const direct = deriveAutomationDiagnostic(root, {
      proposalDir: dir,
      requiredTestIds: ['UT-S13-30', 'ST-S13-09'],
      declaredArtifacts: ['cli/src/lib/changed.ts', 'cli/test/changed.test.ts'],
      verifyGate: 'FAIL',
      failedTests: ['UT-S13-REG'],
    });
    expect(direct?.validated_artifacts).toEqual(['cli/src/lib/changed.ts', 'cli/test/changed.test.ts']);
    expect(direct?.reason).toBe('global-verify-failed');
  });

  it('UT-S13-31: reporter 缺失本片 test ID 不等价全量失败', () => {
    const dir = setupLaunchedSlice('- [ ] 切片：覆盖 UT-S13-31');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), '{"id":"UT-OTHER-01","status":"pass"}\n');

    const diagnostic = deriveAutomationDiagnostic(root, {
      proposalDir: dir,
      requiredTestIds: ['UT-S13-31'],
      declaredArtifacts: [],
    });

    expect(diagnostic).toMatchObject({
      reason: 'focused-tests-missing',
      completion_state: 'slice_incomplete',
    });
    expect(diagnostic?.required_test_ids).toEqual(['UT-S13-31']);
  });

  it('ST-S13-09: verify 失败列表可驱动 next --auto repair', async () => {
    const dir = setupLaunchedSlice('- [x] 切片：覆盖 ST-S13-09');
    writeFileSync(join(dir, 'LOOP_ITERS'),
      JSON.stringify({ iter: 1, node: 'verify', result: 'fail', module: 'core', timestamp: 't', slice: '切片：覆盖 ST-S13-09' }) + '\n');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"ST-S13-09","status":"pass"}',
      '{"id":"UT-S13-REG","status":"fail","error":"regression"}',
    ].join('\n') + '\n');

    const restore = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    try {
      await next('json', undefined, true);
    } finally {
      con.restore();
      exitSpy.mockRestore();
      restore();
    }
    const data = JSON.parse(con.logs[con.logs.length - 1]).data;
    expect(data.modules[0].automation_diagnostic).toMatchObject({
      reason: 'global-verify-failed',
      completion_state: 'slice_done_global_verify_failed',
      suggested_next_node: 'code',
    });
    expect(data.modules[0].next_node.id).toBe('code');
    expect(data.modules[0].automation_diagnostic.failed_tests).toContain('UT-S13-REG');
    expect(JSON.stringify(data)).not.toContain('retry-exhausted');
  });
});

describe('S13 Unit Tests — extractDefinedIds', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
  });
  afterEach(() => cleanup());

  it('internal-S13-extract-defined-ids: extract UT/ST IDs from test-cases.md', () => {
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
      [
        '| ST-S01-01 | appears here |',
        '| ST-S01-01 | and again |',
        '| UT-S01-02 | also |',
      ].join('\n'),
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
      [
        '| UT-S01-01 | a |',
        '| UT-S01-02 | b |',
        '| UT-S01-03 | c |',
        '| ST-S01-01 | d |',
        '| ST-S01-02 | e |',
      ].join('\n'),
    );
    const { utCount, stCount } = extractDefinedIds(root);
    expect(utCount).toBe(3);
    expect(stCount).toBe(2);
  });

  it('UT-S13-08: return empty when test dir does not exist', () => {
    const result = extractDefinedIds(root);
    expect(result).toEqual({ ids: [], utCount: 0, stCount: 0, manualCount: 0 });
  });

  it('UT-S13-18: [manual] marked cases are excluded from defined ids', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      '| UT-S01-01 | desc |\n| ST-S01-05 [manual] | manual desc |',
    );
    const { ids, manualCount } = extractDefinedIds(root);
    expect(ids).toContain('UT-S01-01');
    expect(ids).not.toContain('ST-S01-05');
    expect(manualCount).toBe(1);
  });

  it('UT-S13-19: multiple [manual] cases counted correctly', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      '| UT-S01-01 | desc |\n| UT-S01-02 | desc |\n| UT-S01-03 | desc |\n| ST-S01-04 [manual] | manual |\n| ST-S01-05 [manual] | manual |',
    );
    const { ids, manualCount } = extractDefinedIds(root);
    expect(ids).toHaveLength(3);
    expect(manualCount).toBe(2);
  });

  it('UT-S13-22: table first-column IDs support lowercase suffix and dots', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      [
        '| UT-S14-bootstrap-01 | desc |',
        '| ST-S01-EX-adopt | desc |',
        '| ST-S09-EX-5.1 | desc |',
      ].join('\n'),
    );
    const { ids, utCount, stCount } = extractDefinedIds(root);
    expect(ids).toContain('UT-S14-bootstrap-01');
    expect(ids).toContain('ST-S01-EX-adopt');
    expect(ids).toContain('ST-S09-EX-5.1');
    expect(utCount).toBe(1);
    expect(stCount).toBe(2);
  });

  it('UT-S13-23: [manual] in first column is excluded and counted', () => {
    const testDir = join(root, 'logos/resources/test');
    mkdirSync(testDir, { recursive: true });
    writeFileSync(
      join(testDir, 'S01-test-cases.md'),
      [
        '| UT-S01-01 | desc |',
        '| ST-S01-EX-adopt [manual] | manual desc |',
      ].join('\n'),
    );
    const { ids, manualCount } = extractDefinedIds(root);
    expect(ids).toContain('UT-S01-01');
    expect(ids).not.toContain('ST-S01-EX-adopt');
    expect(manualCount).toBe(1);
  });
});

describe('S13 Unit Tests — smoke coverage precheck', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'en' });
  });
  afterEach(() => cleanup());

  function writeSmokeDelta(slug: string, id: string) {
    const proposalDir = join(root, 'logos', 'changes', slug);
    mkdirSync(join(proposalDir, 'deltas/test/smoke'), { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
    writeFileSync(join(proposalDir, 'deltas/test/smoke/core-smoke-test-cases.md'), [
      '| ID | 描述 |',
      '|----|------|',
      `| ${id} | 新增 smoke |`,
    ].join('\n'));
  }

  it('UT-S13-SMOKE-01: 提取当前提案新增 smoke case ID', () => {
    mkdirSync(join(root, 'logos/resources/test/smoke'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/smoke/core-smoke-test-cases.md'), '| SMOKE-OLD-01 | old |');
    writeSmokeDelta('add-smoke', 'SMOKE-NEW-01');
    mkdirSync(join(root, 'logos/changes/add-smoke/deltas/test'), { recursive: true });
    writeFileSync(join(root, 'logos/changes/add-smoke/deltas/test/core-S13-test-cases.md'), '| UT-S13-X | 输入示例 SMOKE-EXAMPLE-01 |');

    expect(extractChangedSmokeIds(root)).toEqual(['SMOKE-NEW-01']);
  });

  it('UT-S13-SMOKE-02: verify/code gate 发现新增 smoke case uncovered', () => {
    writeSmokeDelta('add-smoke', 'SMOKE-NEW-02');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/smoke-results.jsonl'), '{"id":"SMOKE-OLD-01","status":"pass"}\n');

    const check = checkSmokeCoverage(root, { command: 'node scripts/run-smoke.js' });

    expect(check.result).toBe('FAIL');
    expect(check.uncovered_case_ids).toEqual(['SMOKE-NEW-02']);
    expect(check.diagnostics.map(d => d.code)).toContain('smoke_cases_uncovered');
  });
});

describe('S13 Unit Tests — verify result consistency', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
  });
  afterEach(() => cleanup());

  function writeCases(content: string) {
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/core-S13-test-cases.md'), content);
  }

  function writeVerifyResults(lines: string[]) {
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), lines.join('\n') + '\n');
  }

  it('UT-S13-36: 未定义结果 ID 不得污染 PASS', () => {
    writeCases('| UT-S13-36 | defined |\n');
    writeVerifyResults([
      '{"id":"UT-S13-36","status":"pass"}',
      '{"id":"UT-S13-GHOST","status":"pass"}',
    ]);

    const data = collectVerifyData(root);

    expect(data.gate.result).toBe('FAIL');
    expect(data.gate.reason).toBe('result_ledger_inconsistent');
    expect(data.consistency.ok).toBe(false);
    expect(data.consistency.reasons).toContain('unknown_test_result_id');
    expect(data.consistency.unknown_result_ids).toEqual(['UT-S13-GHOST']);
    expect(data.consistency.count_mismatches).toContain('executed_exceeds_defined');
  });

  it('UT-S13-37: 统计守恒不成立时 FAIL', () => {
    const mismatches = buildVerifyCountMismatches({
      defined_count: 1,
      executed_count: 2,
      passed_count: 1,
      failed_count: 0,
      skipped_count: 0,
      uncovered_count: 0,
      coverage_pct: 100,
      pass_rate_pct: 50,
    });

    expect(mismatches).toContain('executed_exceeds_defined');
    expect(mismatches).toContain('effective_passed_ne_executed_without_fail');
    expect(mismatches).toContain('pass_rate_below_100_without_fail');
  });

  it('UT-S13-38: 合法重复 ID 保持 last-write-wins', () => {
    writeCases('| UT-S13-38 | defined |\n');
    writeVerifyResults([
      '{"id":"UT-S13-38","status":"fail","error":"old"}',
      '{"id":"UT-S13-38","status":"pass"}',
    ]);

    const data = collectVerifyData(root);

    expect(data.gate.result).toBe('PASS');
    expect(data.consistency.ok).toBe(true);
    expect(data.summary.executed_count).toBe(1);
    expect(data.summary.passed_count).toBe(1);
  });

  it('UT-S13-39: 合法 skip 不阻塞 verify Gate', () => {
    writeCases(`# Test Cases
| UT-S13-39 | pass case |
| ST-S13-12 | environment skip |

## 三、覆盖度校验

- [x] skip counted as effective pass

## 四、验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S13-AC-012 | skip is valid | UT-S13-39, ST-S13-12 |
`);
    writeVerifyResults([
      '{"id":"UT-S13-39","status":"pass"}',
      '{"id":"ST-S13-12","status":"skip"}',
    ]);

    const data = collectVerifyData(root);

    expect(data.gate.result).toBe('PASS');
    expect(data.gate.reason).toBeNull();
    expect(data.summary.pass_rate_pct).toBe(100);
    expect(data.summary.skipped_count).toBe(1);
    expect(data.skipped_cases).toEqual(['ST-S13-12']);
    expect(data.ac_trace.passed).toBe(1);
    expect(data.ac_trace.failed_criteria).toEqual([]);
  });

  it('UT-S13-40: skip 计入有效通过率但保留审计列表', () => {
    writeCases('| UT-S13-40 | environment skip |\n');
    writeVerifyResults([
      '{"id":"UT-S13-40","status":"skip"}',
    ]);

    const data = collectVerifyData(root);
    const report = readFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'utf-8');

    expect(data.gate.result).toBe('PASS');
    expect(data.summary.passed_count + data.summary.skipped_count).toBe(data.summary.executed_count);
    expect(data.summary.pass_rate_pct).toBe(100);
    expect(report).toContain('| Pass rate | 100% |');
    expect(report).toContain('## Skipped Cases');
    expect(report).toContain('UT-S13-40');
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
      '100', '100', 'PASS', [], [], new Set(['UT-S01-01', 'ST-S01-01']), 0,
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
      '100', '0', 'FAIL', [], [], new Set(['UT-S01-01']), 0,
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
      checklist, [], new Set(), 0,
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
      '100', '100', 'PASS', [], acTrace, new Set(['ST-S01-01']), 0,
    );
    expect(report).toContain('## Acceptance Criteria Traceability (Layer 3)');
    expect(report).toContain('✅ PASS');
    expect(report).toContain('S01-AC-01');
  });

  it('UT-S13-20: Summary table contains manual_count row', () => {
    const report = generateReport(
      [], [], [], [], [], [], '0', '0', 'PASS',
      [], [], new Set(), 2,
    );
    expect(report).toContain('Manual cases (excluded) | 2');
  });

  it('UT-S13-21: AC with all-manual linked cases shows MANUAL status', () => {
    // ST-S01-05 is a [manual] case — not in results
    const results: TestResult[] = [];
    const acTrace: AcTraceEntry[] = [{
      acId: 'S01-AC-05',
      description: '人工验证渲染',
      linkedCaseIds: ['ST-S01-05'],
      file: 'S01-test-cases.md',
    }];
    const report = generateReport(
      [], results, [], [], [], [],
      '100', '100', 'PASS', [], acTrace, new Set(), 1,
    );
    expect(report).toContain('🔵 MANUAL');
    expect(report).toContain('S01-AC-05');
  });
});

describe('S13 Unit Tests — verify pre-run helpers', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'en' });
  });
  afterEach(() => cleanup());

  it('buildInitialPreRunData preserves single-stage mode', () => {
    const data = buildInitialPreRunData({
      resultPath: 'logos/resources/verify/test-results.jsonl',
      preRunCommand: 'npm test',
      mergeStrategy: 'last-write-wins',
    });
    expect(data.mode).toBe('pre_run_command');
    expect(data.result_paths.final).toBe('logos/resources/verify/test-results.jsonl');
  });

  it('buildInitialPreRunData preserves two-phase mode', () => {
    const data = buildInitialPreRunData({
      resultPath: 'logos/resources/verify/test-results.jsonl',
      regressionCommand: 'npm test',
      incrementalCommand: 'npm run test:changed',
      mergeStrategy: 'last-write-wins',
    });
    expect(data.mode).toBe('two_phase');
    expect(data.merge_strategy).toBe('last-write-wins');
    expect(data.result_paths.regression).toBeNull();
  });

  it('runVerifyPreRun returns none when no command exists', () => {
    const data = runVerifyPreRun(root, readVerifyConfig(root), 'text');
    expect(data.mode).toBe('none');
    expect(data.commands).toHaveLength(0);
  });

  it('readVerifyConfig falls back to legacy test_command for single-stage verify', () => {
    writeFileSync(join(root, 'logos', 'logos.config.json'), JSON.stringify({
      name: 'test-project',
      locale: 'en',
      documents: {},
      verify: {
        result_path: 'logos/resources/verify/test-results.jsonl',
        test_command: 'npm test',
      },
    }, null, 2));

    const config = readVerifyConfig(root);
    expect(config.preRunCommand).toBe('npm test');
    expect(buildInitialPreRunData(config).mode).toBe('pre_run_command');
  });

  it('UT-S13-02: runVerifyPreRun executes pre_run_command before results are read', () => {
    const command = `node -e "require('fs').mkdirSync('logos/resources/verify',{recursive:true});require('fs').writeFileSync('logos/resources/verify/test-results.jsonl','{\\\"id\\\":\\\"UT-S01-01\\\",\\\"status\\\":\\\"pass\\\"}\\n')"`;
    const data = runVerifyPreRun(root, {
      resultPath: 'logos/resources/verify/test-results.jsonl',
      preRunCommand: command,
      mergeStrategy: 'last-write-wins',
    }, 'json');

    expect(data.mode).toBe('pre_run_command');
    expect(data.commands).toHaveLength(1);
    expect(data.commands[0]).toMatchObject({ stage: 'pre_run', status: 'pass', exit_code: 0 });
    expect(readFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), 'utf-8')).toContain('UT-S01-01');
  });

  it('UT-S13-03: runVerifyPreRun executes regression then incremental and merges last-write-wins', () => {
    const regressionPath = 'logos/resources/verify/test-results.regression.jsonl';
    const incrementalPath = 'logos/resources/verify/test-results.incremental.jsonl';
    const regressionCommand = `node -e "require('fs').mkdirSync('logos/resources/verify',{recursive:true});require('fs').writeFileSync('${regressionPath}','{\\\"id\\\":\\\"UT-S01-01\\\",\\\"status\\\":\\\"fail\\\",\\\"error\\\":\\\"old\\\"}\\n{\\\"id\\\":\\\"ST-S01-01\\\",\\\"status\\\":\\\"pass\\\"}\\n')"`;
    const incrementalCommand = `node -e "require('fs').mkdirSync('logos/resources/verify',{recursive:true});require('fs').writeFileSync('${incrementalPath}','{\\\"id\\\":\\\"UT-S01-01\\\",\\\"status\\\":\\\"pass\\\"}\\n')"`;

    const data = runVerifyPreRun(root, {
      resultPath: 'logos/resources/verify/test-results.jsonl',
      regressionCommand,
      incrementalCommand,
      regressionResultPath: regressionPath,
      incrementalResultPath: incrementalPath,
      mergeStrategy: 'last-write-wins',
    }, 'json');

    expect(data.mode).toBe('two_phase');
    expect(data.commands.map(cmd => cmd.stage)).toEqual(['regression', 'incremental']);
    expect(data.commands.every(cmd => cmd.status === 'pass')).toBe(true);

    const merged = parseJsonl(readFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), 'utf-8'));
    expect(merged.find(result => result.id === 'UT-S01-01')?.status).toBe('pass');
    expect(merged.find(result => result.id === 'ST-S01-01')?.status).toBe('pass');
  });

  it('UT-S13-04: collectVerifyData adds diagnostics when coverage is incomplete without pre-run config', () => {
    const testDir = join(root, 'logos/resources/test');
    const verifyDir = join(root, 'logos/resources/verify');
    mkdirSync(testDir, { recursive: true });
    mkdirSync(verifyDir, { recursive: true });
    writeFileSync(join(testDir, 'S01-test-cases.md'), '| UT-S01-01 | d |\n| ST-S01-01 | d |\n');
    writeFileSync(join(verifyDir, 'test-results.jsonl'), '{"id":"UT-S01-01","status":"pass"}\n');

    const data = collectVerifyData(root);
    expect(data.gate.reason).toBe('incomplete_coverage');
    expect(data.pre_run.mode).toBe('none');
    expect(data.pre_run.diagnostics.join('\n')).toContain('partial test set');
    expect(data.pre_run.suggestions.join('\n')).toContain('verify.pre_run_command');
  });

  it('UT-S13-05: collectVerifyData exposes pre_run state in JSON output data', () => {
    writeFileSync(join(root, 'logos/resources/test', 'S01-test-cases.md'), '| UT-S01-01 | desc |\n');
    writeFileSync(join(root, 'logos/resources/verify', 'test-results.jsonl'), '{"id":"UT-S01-01","status":"pass"}\n');

    const preRun = buildInitialPreRunData({
      resultPath: 'logos/resources/verify/test-results.jsonl',
      preRunCommand: 'npm test',
      mergeStrategy: 'last-write-wins',
    });
    const data = collectVerifyData(root, preRun);

    expect(data.pre_run.mode).toBe('pre_run_command');
    expect(data.pre_run.result_paths.final).toBe('logos/resources/verify/test-results.jsonl');
    expect(data.sandbox.mode).toBe('auto');
    expect(data.sandbox.status).toBe('skipped');
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

  function updateVerifyConfig(values: Record<string, unknown>) {
    const configPath = join(root, 'logos/logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.verify = { ...(config.verify ?? {}), ...values };
    writeFileSync(configPath, JSON.stringify(config, null, 2));
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

  it('ST-S13-05: failed test → Gate FAIL', () => {
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

  it('ST-S13-02: single-stage pre_run_command generates complete results before verify', () => {
    writeTestCases(CASES_ALL_PASS);
    updateVerifyConfig({
      pre_run_command: `node -e "require('fs').mkdirSync('logos/resources/verify',{recursive:true});require('fs').writeFileSync('logos/resources/verify/test-results.jsonl','{\\\"id\\\":\\\"UT-S01-01\\\",\\\"status\\\":\\\"pass\\\"}\\n{\\\"id\\\":\\\"ST-S01-01\\\",\\\"status\\\":\\\"pass\\\"}\\n')"`,
    });

    verify();

    const report = readFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'utf-8');
    expect(report).toContain('PASS');
    const out = con.logs.join('\n');
    expect(out).toContain('verify pre-run mode: single-stage');
  });

  it('ST-S13-03: two-phase verify merges regression and incremental results', () => {
    writeTestCases(CASES_ALL_PASS);
    updateVerifyConfig({
      regression_command: `node -e "require('fs').mkdirSync('logos/resources/verify',{recursive:true});require('fs').writeFileSync('logos/resources/verify/test-results.regression.jsonl','{\\\"id\\\":\\\"UT-S01-01\\\",\\\"status\\\":\\\"fail\\\",\\\"error\\\":\\\"old\\\"}\\n')"` ,
      incremental_command: `node -e "require('fs').mkdirSync('logos/resources/verify',{recursive:true});require('fs').writeFileSync('logos/resources/verify/test-results.incremental.jsonl','{\\\"id\\\":\\\"UT-S01-01\\\",\\\"status\\\":\\\"pass\\\"}\\n{\\\"id\\\":\\\"ST-S01-01\\\",\\\"status\\\":\\\"pass\\\"}\\n')"` ,
      regression_result_path: 'logos/resources/verify/test-results.regression.jsonl',
      incremental_result_path: 'logos/resources/verify/test-results.incremental.jsonl',
    });

    verify();

    const report = readFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'utf-8');
    expect(report).toContain('PASS');
    const results = readFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), 'utf-8');
    expect(results).toContain('"id":"UT-S01-01","status":"pass"');
    const out = con.logs.join('\n');
    expect(out).toContain('verify pre-run mode: two-phase');
  });

  it('ST-S13-04: uncovered cases without pre-run config → Gate FAIL', () => {
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

  it('ST-S13-06: unchecked checklist item → Gate FAIL', () => {
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

  it('ST-S13-11: 不自洽 verify 账本阻断全自动归档', () => {
    writeTestCases(CASES_ALL_PASS);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"pass"}',
      '{"id":"UT-S13-GHOST","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos/changes/verify-result-consistency-gate');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({
      activeChange: 'verify-result-consistency-gate',
      module: 'core',
    }));

    expect(() => verify('json')).toThrow('process.exit(1)');

    const output = JSON.parse(con.logs[0]);
    expect(output.data.gate.result).toBe('FAIL');
    expect(output.data.gate.reason).toBe('result_ledger_inconsistent');
    expect(output.data.consistency.ok).toBe(false);
    expect(output.data.consistency.unknown_result_ids).toContain('UT-S13-GHOST');
    expect(existsSync(join(proposalDir, 'VERIFY_PASS'))).toBe(false);
    expect(existsSync(join(proposalDir, 'VERIFY_FAIL'))).toBe(true);
  });

  it('ST-S13-12: verify 含环境性 skip 时仍允许流程通过', () => {
    const cases = `# Test Cases
| UT-S13-39 | pass case |
| ST-S13-12 | environment skip |

## 三、覆盖度校验

- [x] skip counted as effective pass

## 四、验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S13-AC-012 | skip is valid | UT-S13-39, ST-S13-12 |
`;
    writeTestCases(cases);
    writeResults([
      '{"id":"UT-S13-39","status":"pass"}',
      '{"id":"ST-S13-12","status":"skip"}',
    ]);
    const proposalDir = join(root, 'logos/changes/verify-skip-counts-as-pass');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({
      activeChange: 'verify-skip-counts-as-pass',
      module: 'core',
    }));
    writeFileSync(join(proposalDir, 'VERIFY_FAIL'), '');

    verify('json');

    const output = JSON.parse(con.logs[0]);
    expect(output.data.gate.result).toBe('PASS');
    expect(output.data.gate.reason).toBeNull();
    expect(output.data.summary.pass_rate_pct).toBe(100);
    expect(output.data.skipped_cases).toEqual(['ST-S13-12']);
    expect(existsSync(join(proposalDir, 'VERIFY_PASS'))).toBe(true);
    expect(existsSync(join(proposalDir, 'VERIFY_FAIL'))).toBe(false);
    expect(exitSpy).not.toHaveBeenCalled();
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

  it('ST-S13-07: [manual] cases excluded from coverage, Gate still PASS', () => {
    const cases = `# Test Cases
| UT-S01-01 | desc |
| ST-S01-01 | desc |
| ST-S01-05 [manual] | manual desc |

## 三、覆盖度校验

- [x] Condition A

## 四、验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S01-AC-01 | normal | ST-S01-01 |
| S01-AC-02 | unit | UT-S01-01 |
`;
    writeTestCases(cases);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"pass"}',
    ]);

    verify();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('Manual');
    expect(allLogs).toContain('100%');
    expect(allLogs).toContain('PASS');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('ST-S13-08: AC with all-manual linked cases → MANUAL_PENDING, Gate PASS', () => {
    const cases = `# Test Cases
| UT-S01-01 | desc |
| ST-S01-05 [manual] | manual desc |

## 三、覆盖度校验

- [x] Condition A

## 四、验收条件追溯

| AC ID | 验收条件 | 覆盖用例 |
|-------|---------|---------|
| S01-AC-01 | unit check | UT-S01-01 |
| S01-AC-02 | manual verify | ST-S01-05 |
`;
    writeTestCases(cases);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
    ]);

    verify();

    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('PASS');
    expect(exitSpy).not.toHaveBeenCalled();

    const report = readFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'utf-8');
    expect(report).toContain('🔵 MANUAL');
  });

  it('ST-S13-09: Gate PASS writes VERIFY_PASS, clears VERIFY_FAIL, and prints deploy tasks', () => {
    writeTestCases(CASES_ALL_PASS);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'deploy-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'deploy-feature', module: 'core' }));
    writeFileSync(join(proposalDir, 'VERIFY_FAIL'), '');
    writeFileSync(join(proposalDir, 'tasks.md'), [
      '# 实现任务',
      '',
      '## [deploy] 部署任务',
      '- [ ] 执行 staging 部署',
    ].join('\n'));

    verify();

    expect(existsSync(join(proposalDir, 'VERIFY_PASS'))).toBe(true);
    expect(existsSync(join(proposalDir, 'VERIFY_FAIL'))).toBe(false);
    const allLogs = con.logs.join('\n');
    expect(allLogs).toContain('执行 staging 部署');
    expect(allLogs).toMatch(/human|人类|Deployment is a human/i);
  });

  it('ST-S13-10: Gate FAIL clears stale deploy and smoke markers', () => {
    writeTestCases(CASES_ALL_PASS);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"fail","error":"timeout"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'deploy-feature');
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'deploy-feature', module: 'core' }));
    for (const marker of ['VERIFY_PASS', 'DEPLOY_DONE', 'SMOKE_PASS', 'SMOKE_FAIL']) {
      writeFileSync(join(proposalDir, marker), '');
    }

    expect(() => verify()).toThrow('process.exit(1)');

    expect(existsSync(join(proposalDir, 'VERIFY_FAIL'))).toBe(true);
    expect(existsSync(join(proposalDir, 'VERIFY_PASS'))).toBe(false);
    expect(existsSync(join(proposalDir, 'DEPLOY_DONE'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SMOKE_PASS'))).toBe(false);
    expect(existsSync(join(proposalDir, 'SMOKE_FAIL'))).toBe(false);
  });

  it('ST-S13-SMOKE-01: code 完成前阻断遗漏 smoke runner 的提案', () => {
    writeTestCases(CASES_ALL_PASS);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'add-smoke');
    mkdirSync(join(proposalDir, 'deltas/test/smoke'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'add-smoke', module: 'core' }));
    writeFileSync(join(proposalDir, 'deltas/test/smoke/core-smoke-test-cases.md'), '| SMOKE-NEW-03 | temp |');
    writeFileSync(join(root, 'scripts/smoke-new.sh'), '#!/usr/bin/env bash\nexit 0\n');

    expect(() => verify('json')).toThrow('process.exit(1)');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('FAIL');
    expect(parsed.data.smoke_precheck.changed_case_ids).toEqual(['SMOKE-NEW-03']);
    expect(parsed.data.pre_run.diagnostics.join('\n')).toContain('smoke_runner_missing');
    expect(parsed.data.pre_run.diagnostics.join('\n')).toContain('smoke_reporter_missing');
    expect(existsSync(join(proposalDir, 'VERIFY_PASS'))).toBe(false);
    expect(existsSync(join(proposalDir, 'VERIFY_FAIL'))).toBe(true);
  });

  it('ST-S13-SMOKE-02: verify 不因部署后 smoke 尚未执行而失败', () => {
    writeTestCases(CASES_ALL_PASS);
    writeResults([
      '{"id":"UT-S01-01","status":"pass"}',
      '{"id":"ST-S01-01","status":"pass"}',
    ]);
    const proposalDir = join(root, 'logos', 'changes', 'add-smoke');
    mkdirSync(join(proposalDir, 'deltas/test/smoke'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'add-smoke', module: 'core' }));
    writeFileSync(join(proposalDir, 'deltas/test/smoke/core-smoke-test-cases.md'), '| SMOKE-NEW-04 | temp |');
    writeFileSync(join(root, 'scripts/smoke-new.sh'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(root, 'logos/resources/verify/smoke-results.jsonl'), '{"id":"SMOKE-OLD-01","status":"pass"}\n');
    const configPath = join(root, 'logos/logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.smoke = { ...(config.smoke ?? {}), command: 'bash scripts/smoke-new.sh' };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    verify('json');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('PASS');
    expect(parsed.data.smoke_precheck.uncovered_case_ids).toEqual(['SMOKE-NEW-04']);
    expect(parsed.data.smoke_precheck.diagnostics.map((d: { code: string }) => d.code)).toContain('smoke_cases_uncovered');
    expect(parsed.data.pre_run.diagnostics.join('\n')).not.toContain('smoke_cases_uncovered');
  });
});

// ── contract-self-description 切片4（C6/D7）：同 ID timestamp 去重全序 ──
describe('S13 — timestamp 去重全序（contract-self-description）', () => {
  let root: string;
  let cleanup: () => void;
  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/core-S13-test-cases.md'), '| UT-S13-90 | d |\n| UT-S13-91 | d |\n');
  });
  afterEach(() => cleanup());
  function writeVerifyResults(lines: string[]) {
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), lines.join('\n') + '\n');
  }
  /** 读回结果账本并按全序去重后取某 ID 的生效记录。 */
  function effective(id: string): TestResult {
    const content = readFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), 'utf-8');
    return parseJsonlWithDiagnostics(content).results.find(r => r.id === id)!;
  }

  it('UT-S13-41: 全合法乱序追加 → 绝对时刻最新优先（后写入的旧 fail 不翻盘）', () => {
    writeVerifyResults([
      '{"id":"UT-S13-90","status":"pass","timestamp":"2026-07-17T10:00:00Z"}',
      '{"id":"UT-S13-90","status":"fail","error":"stale","timestamp":"2026-07-17T08:00:00Z"}', // 文件末行但时刻更旧
      '{"id":"UT-S13-91","status":"pass","timestamp":"2026-07-17T09:00:00Z"}',
    ]);
    expect(effective('UT-S13-90').status).toBe('pass'); // 不因旧 fail 在文件末尾而翻盘
    const data = collectVerifyData(root);
    expect(data.gate.result).toBe('PASS');
  });

  it('UT-S13-42: 缺失+合法混排 → 该 ID 整组退回文件行序 last-wins', () => {
    writeVerifyResults([
      '{"id":"UT-S13-90","status":"fail","error":"x","timestamp":"2026-07-17T10:00:00Z"}', // 合法且最新
      '{"id":"UT-S13-90","status":"pass"}',                                                  // 缺 timestamp、行序最后
      '{"id":"UT-S13-91","status":"pass","timestamp":"2026-07-17T09:00:00Z"}',
    ]);
    // 组内存在缺失 → 不做时间猜测，整组退回行序 last-wins（取 pass）；91 组全合法不受影响
    expect(effective('UT-S13-90').status).toBe('pass');
    expect(effective('UT-S13-91').status).toBe('pass');
  });

  it('UT-S13-43: 非法格式（"yesterday"、"2026/07/17"）按缺失处理 → 整组退回行序', () => {
    writeVerifyResults([
      '{"id":"UT-S13-90","status":"fail","error":"x","timestamp":"2026-07-17T10:00:00Z"}',
      '{"id":"UT-S13-90","status":"pass","timestamp":"yesterday"}',
      '{"id":"UT-S13-91","status":"fail","error":"y","timestamp":"2026/07/17 10:00:00"}',
      '{"id":"UT-S13-91","status":"pass","timestamp":"2026-07-17T09:00:00Z"}',
    ]);
    expect(effective('UT-S13-90').status).toBe('pass'); // 非法按缺失 → 行序后者
    expect(effective('UT-S13-91').status).toBe('pass'); // 同上（非法在前，仍整组行序 last-wins → 末行 pass）
  });

  it('UT-S13-44: 异时区同刻（+08:00 与 Z）→ 文件行序后者优先', () => {
    writeVerifyResults([
      '{"id":"UT-S13-90","status":"fail","error":"x","timestamp":"2026-07-17T18:00:00+08:00"}', // == 10:00Z
      '{"id":"UT-S13-90","status":"pass","timestamp":"2026-07-17T10:00:00Z"}',                   // 同刻、行序后者
      '{"id":"UT-S13-91","status":"pass","timestamp":"2026-07-17T09:00:00Z"}',
    ]);
    expect(effective('UT-S13-90').status).toBe('pass');
  });

  it('UT-S13-45: 同一批记录重复追加幂等重放 → 去重结论与 Gate 结果不变', () => {
    const batch = [
      '{"id":"UT-S13-90","status":"pass","timestamp":"2026-07-17T10:00:00Z"}',
      '{"id":"UT-S13-90","status":"fail","error":"stale","timestamp":"2026-07-17T08:00:00Z"}',
      '{"id":"UT-S13-91","status":"pass"}',
    ];
    writeVerifyResults(batch);
    const first = collectVerifyData(root);
    writeVerifyResults([...batch, ...batch]); // 原样整体重复追加
    const second = collectVerifyData(root);
    expect(second.gate.result).toBe(first.gate.result);
    expect(second.summary.executed_count).toBe(first.summary.executed_count);
    expect(effective('UT-S13-90').status).toBe('pass');
  });

  it('UT-S13-46: 两阶段合并（regression+incremental）沿用同一 timestamp 全序（merge_results 语义升级）', () => {
    const restoreCwd = mockCwd(root); const con = captureConsole(); const exitSpy = mockProcessExit();
    try {
      const configPath = join(root, 'logos/logos.config.json');
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      // 场景 A：两条均带合法 timestamp——回归(晚) fail 在合并文件前段、增量(早) pass 在后段 → 取最新的 fail
      config.verify = {
        ...(config.verify ?? {}),
        regression_command: `node -e "require('fs').mkdirSync('logos/resources/verify',{recursive:true});require('fs').writeFileSync('logos/resources/verify/test-results.regression.jsonl','{\\"id\\":\\"UT-S13-90\\",\\"status\\":\\"fail\\",\\"error\\":\\"real\\",\\"timestamp\\":\\"2026-07-17T10:00:00Z\\"}\\n{\\"id\\":\\"UT-S13-91\\",\\"status\\":\\"pass\\",\\"timestamp\\":\\"2026-07-17T10:00:00Z\\"}\\n')"`,
        incremental_command: `node -e "require('fs').mkdirSync('logos/resources/verify',{recursive:true});require('fs').writeFileSync('logos/resources/verify/test-results.incremental.jsonl','{\\"id\\":\\"UT-S13-90\\",\\"status\\":\\"pass\\",\\"timestamp\\":\\"2026-07-17T08:00:00Z\\"}\\n')"`,
        regression_result_path: 'logos/resources/verify/test-results.regression.jsonl',
        incremental_result_path: 'logos/resources/verify/test-results.incremental.jsonl',
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      expect(() => verify()).toThrow('process.exit(1)'); // fail 是最新证据 → Gate FAIL（不因合并文件末行 pass 翻盘）
      const merged = readFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), 'utf-8');
      // 合并文件保持 regression→incremental 行序；去重与单文件同一实现（parseJsonlWithDiagnostics）
      expect(merged.trim().split('\n')).toHaveLength(3);
      expect(effective('UT-S13-90').status).toBe('fail');
    } finally { con.restore(); exitSpy.mockRestore(); restoreCwd(); }
  });

  it('ST-S13-13: 端到端——verify 结论跟随最新 timestamp，consistency 契约在去重后照常生效', () => {
    // 第一次：fail 时刻最新（虽然 pass 行在后）→ FAIL
    writeVerifyResults([
      '{"id":"UT-S13-90","status":"pass","timestamp":"2026-07-17T08:00:00Z"}',
      '{"id":"UT-S13-90","status":"fail","error":"regress","timestamp":"2026-07-17T10:00:00Z"}',
      '{"id":"UT-S13-91","status":"pass","timestamp":"2026-07-17T09:00:00Z"}',
    ]);
    const first = collectVerifyData(root);
    expect(first.gate.result).toBe('FAIL');
    // 追加更新时刻的 pass → PASS；守恒不变量在去重后计算（executed==2）
    const content = readFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), 'utf-8');
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'),
      content + '{"id":"UT-S13-90","status":"pass","timestamp":"2026-07-17T11:00:00Z"}\n');
    const second = collectVerifyData(root);
    expect(second.gate.result).toBe('PASS');
    expect(second.summary.executed_count).toBe(2);
    expect(second.consistency.ok).toBe(true);
    // 含无 timestamp 记录的其它 ID 保持行序 last-wins：另起无 timestamp 组
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S13-90","status":"pass","timestamp":"2026-07-17T11:00:00Z"}',
      '{"id":"UT-S13-91","status":"fail","error":"x"}',
      '{"id":"UT-S13-91","status":"pass"}',
    ].join('\n') + '\n');
    const third = collectVerifyData(root);
    expect(third.gate.result).toBe('PASS'); // 91 组无 timestamp → 行序 last-wins = pass
  });
});

// ── code review F1：严格时间戳的无时区 / 日历溢出 / 非法 offset 负例与跨 TZ 确定性 ──
describe('S13 — parseStrictTimestampMs 严格性（code review F1）', () => {
  it('internal-S13-strict-ts: 无时区/不存在日期/非法 offset 一律按缺失，解析结论与运行机器 TZ 无关', async () => {
    const { parseStrictTimestampMs } = await import('../src/lib/timestamp.js');
    // 必须携带时区：无时区的本地时间在不同机器解出不同绝对时刻 → 拒绝
    expect(parseStrictTimestampMs('2026-07-17T10:00:00')).toBeNull();
    expect(parseStrictTimestampMs('2026-07-17 10:00:00Z')).toBeNull();   // 空格分隔非约定形态
    expect(parseStrictTimestampMs('2026-07-17t10:00:00z')).toBeNull();   // 非约定大小写
    // 日历溢出：Date.parse 会滚进 3 月，这里必须拒绝
    expect(parseStrictTimestampMs('2026-02-30T10:00:00Z')).toBeNull();
    expect(parseStrictTimestampMs('2026-13-01T10:00:00Z')).toBeNull();
    expect(parseStrictTimestampMs('2026-04-31T00:00:00Z')).toBeNull();
    // 非法 offset
    expect(parseStrictTimestampMs('2026-07-17T10:00:00+25:00')).toBeNull();
    expect(parseStrictTimestampMs('2026-07-17T10:00:00+08:60')).toBeNull();
    expect(parseStrictTimestampMs('2026-07-17T10:00:00+0800')).toBeNull(); // 无冒号 offset 非约定形态
    // 合法：Z 与数字 offset 归一同一绝对时刻（手工纪元运算，TZ 无关）
    const z = parseStrictTimestampMs('2026-07-17T10:00:00Z');
    const off = parseStrictTimestampMs('2026-07-17T18:00:00+08:00');
    expect(z).not.toBeNull();
    expect(off).toBe(z);
    expect(z).toBe(Date.UTC(2026, 6, 17, 10, 0, 0)); // 与纪元常量比对：不经 Date.parse、不受 TZ 影响
    expect(parseStrictTimestampMs('2026-07-17T10:00:00.5Z')).toBe(z! + 500);
    // 闰年合法反例：2028-02-29 合法、2026-02-29 非法
    expect(parseStrictTimestampMs('2028-02-29T00:00:00Z')).not.toBeNull();
    expect(parseStrictTimestampMs('2026-02-29T00:00:00Z')).toBeNull();
    // r2-F6：首尾空白是非法输入（与发布 schema 的 date-time 一致，不做 trim 宽容）
    expect(parseStrictTimestampMs(' 2026-07-17T10:00:00Z')).toBeNull();
    expect(parseStrictTimestampMs('2026-07-17T10:00:00Z ')).toBeNull();
  });

  it('internal-S13-strict-ts-subms: 亚毫秒全序不截断——.0009Z 严格晚于 .0001Z（逆行序仍取最新）', async () => {
    const { parseStrictTimestampParts, compareStrictTimestamps } = await import('../src/lib/timestamp.js');
    const a = parseStrictTimestampParts('2026-07-17T10:00:00.0001Z')!;
    const b = parseStrictTimestampParts('2026-07-17T10:00:00.0009Z')!;
    expect(a.ms).toBe(b.ms); // 毫秒粒度相同——r2-F1 指出的降精度陷阱
    expect(compareStrictTimestamps(b, a)).toBeGreaterThan(0); // 全精度下 b 严格晚于 a
    // 端到端：较新 .0009 的 pass 在前、较旧 .0001 的 fail 在后 → 仍取 pass（不被行序翻盘）
    const { root, cleanup } = makeTempRoot();
    scaffoldProject(root, { locale: 'zh' });
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/core-S13-test-cases.md'), '| UT-S13-90 | d |\n');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S13-90","status":"pass","timestamp":"2026-07-17T10:00:00.0009Z"}',
      '{"id":"UT-S13-90","status":"fail","error":"stale","timestamp":"2026-07-17T10:00:00.0001Z"}',
    ].join('\n') + '\n');
    expect(collectVerifyData(root).gate.result).toBe('PASS');
    // 异 offset 同一绝对时刻（含亚毫秒）→ compare==0 → 行序后者优先
    const z = parseStrictTimestampParts('2026-07-17T10:00:00.5Z')!;
    const off = parseStrictTimestampParts('2026-07-17T18:00:00.500+08:00')!;
    expect(compareStrictTimestamps(z, off)).toBe(0);
    cleanup();
  });

  it('internal-S13-strict-ts-group: 无时区记录使该 ID 整组退回行序 last-wins（不再进入时间比较）', () => {
    const { root, cleanup } = makeTempRoot();
    scaffoldProject(root, { locale: 'zh' });
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/core-S13-test-cases.md'), '| UT-S13-90 | d |\n');
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), [
      '{"id":"UT-S13-90","status":"fail","error":"x","timestamp":"2026-07-17T10:00:00Z"}',
      '{"id":"UT-S13-90","status":"pass","timestamp":"2026-07-17T23:00:00"}', // 无时区 → 组内含缺失
    ].join('\n') + '\n');
    const data = collectVerifyData(root);
    expect(data.gate.result).toBe('PASS'); // 整组退回行序 last-wins → 末行 pass 生效（不做时区猜测）
    cleanup();
  });
});

/* ========== Sandbox dependency-dir exemption & runtime write protection (fix-sandbox-node-modules-write-audit) ========== */

describe('S13 Sandbox — dependency-dir exemption & runtime write protection', () => {
  const wp = detectRuntimeWriteProtection();
  let origin: string;
  let cleanupOrigin: () => void;
  let sandboxBase: string;
  let cleanupSandboxBase: () => void;

  beforeEach(() => {
    ({ root: origin, cleanup: cleanupOrigin } = makeTempRoot());
    ({ root: sandboxBase, cleanup: cleanupSandboxBase } = makeTempRoot());
  });

  afterEach(() => {
    cleanupOrigin();
    cleanupSandboxBase();
  });

  function run(mode: 'auto' | 'always', command: string, allowed: string[] = ['logos/resources/verify/test-results.jsonl']) {
    return runSandboxedCommand({
      root: origin,
      command,
      format: 'json',
      sandbox: { mode, root: sandboxBase, denyWorkspaceWrite: true },
      allowedWritePaths: allowed,
    });
  }

  function writeScript(name: string, body: string): string {
    writeFileSync(join(origin, name), body);
    return `node ${name}`;
  }

  it.skipIf(!wp.available)('UT-S13-47: always 模式下仅写 node_modules 不判非白名单，豁免说明走 infos 通道', () => {
    mkdirSync(join(origin, 'node_modules/.bin'), { recursive: true });
    const command = writeScript('prep.js', [
      "const fs=require('fs');",
      "fs.writeFileSync('node_modules/.bin/fresh-shim','x');",
      "fs.mkdirSync('logos/resources/verify',{recursive:true});",
      "fs.writeFileSync('logos/resources/verify/test-results.jsonl','');",
    ].join('\n'));

    const res = run('always', command);

    expect(res.command.status).toBe('pass');
    expect(res.sandbox.status).toBe('pass');
    expect(res.sandbox.isolated).toBe(true);
    expect(res.sandbox.infos).toContain(DEPENDENCY_DIR_EXEMPT_INFO);
    expect(res.sandbox.diagnostics.join('\n')).not.toContain('非白名单');
    expect(res.sandbox.diagnostics.join('\n')).not.toContain(DEPENDENCY_DIR_EXEMPT_INFO);
    // 白名单结果文件回收；node_modules 写入不回收
    expect(existsSync(join(origin, 'logos/resources/verify/test-results.jsonl'))).toBe(true);
    expect(existsSync(join(origin, 'node_modules/.bin/fresh-shim'))).toBe(false);
  });

  it('UT-S13-48: 精确段匹配边界——近似名称不豁免、分隔符归一、豁免外 auto 仍 warn', () => {
    // 匹配规则单元断言（含 Windows 分隔符归一化）
    expect(isDependencyExemptPath('node_modules/.bin/x')).toBe(true);
    expect(isDependencyExemptPath('packages/a/node_modules/y')).toBe(true);
    expect(isDependencyExemptPath('node_modules\\.bin\\x')).toBe(true);
    expect(isDependencyExemptPath('src\\node_modules-cache\\evil.txt')).toBe(false);
    expect(isDependencyExemptPath('src/node_modules-cache/evil.txt')).toBe(false);
    expect(isDependencyExemptPath('vendor/my-node_modules/data')).toBe(false);
    expect(isDependencyExemptPath('node_modules.txt')).toBe(false);

    mkdirSync(join(origin, 'node_modules'), { recursive: true });
    const command = writeScript('near-miss.js', [
      "const fs=require('fs');",
      "fs.writeFileSync('node_modules/exempt.txt','x');",
      "fs.mkdirSync('src/node_modules-cache',{recursive:true});",
      "fs.writeFileSync('src/node_modules-cache/evil.txt','x');",
      "fs.mkdirSync('vendor/my-node_modules',{recursive:true});",
      "fs.writeFileSync('vendor/my-node_modules/data','x');",
      "fs.writeFileSync('node_modules.txt','x');",
      "fs.writeFileSync('src-evil.txt','x');",
    ].join('\n'));

    const res = run('auto', command);
    expect(res.sandbox.status).toBe('warn');
    const diag = res.sandbox.diagnostics.join('\n');
    expect(diag).toContain('非白名单写入');
    expect(diag).toContain('src/node_modules-cache/evil.txt');
    expect(diag).toContain('vendor/my-node_modules/data');
    expect(diag).toContain('node_modules.txt');
    expect(diag).not.toContain('node_modules/exempt.txt');
    expect(res.sandbox.suggestions.join('\n')).toContain('always');
  });

  it.skipIf(!wp.available)('UT-S13-48: always 模式下近似名称写入仍 FAIL（回归）', () => {
    mkdirSync(join(origin, 'node_modules'), { recursive: true });
    const command = writeScript('near-miss-always.js', [
      "const fs=require('fs');",
      "fs.writeFileSync('node_modules/exempt.txt','x');",
      "fs.mkdirSync('src/node_modules-cache',{recursive:true});",
      "fs.writeFileSync('src/node_modules-cache/evil.txt','x');",
    ].join('\n'));

    const res = run('always', command);
    expect(res.command.status).toBe('fail');
    expect(res.sandbox.status).toBe('fail');
    const diag = res.sandbox.diagnostics.join('\n');
    expect(diag).toContain('src/node_modules-cache/evil.txt');
    expect(diag).not.toContain('node_modules/exempt.txt');
  });

  it.skipIf(!wp.available)('UT-S13-49: monorepo 嵌套 node_modules 同样豁免（完整段相等，非根前缀）', () => {
    mkdirSync(join(origin, 'packages/a/node_modules/.bin'), { recursive: true });
    const command = writeScript('nested.js', [
      "const fs=require('fs');",
      "fs.writeFileSync('packages/a/node_modules/.bin/shim','x');",
    ].join('\n'));

    const res = run('always', command);
    expect(res.command.status).toBe('pass');
    expect(res.sandbox.status).toBe('pass');
    expect(res.sandbox.diagnostics.join('\n')).not.toContain('非白名单');
    // 嵌套形态同样必须产生固定信息级说明，且不进问题诊断（§2.9 可观测性契约）
    expect(res.sandbox.infos).toContain(DEPENDENCY_DIR_EXEMPT_INFO);
    expect(res.sandbox.diagnostics.join('\n')).not.toContain(DEPENDENCY_DIR_EXEMPT_INFO);
  });

  it.skipIf(!wp.available)('UT-S13-50: 内部相对 symlink 保持相对语义，穿透写入不落原 workspace', () => {
    mkdirSync(join(origin, 'packages/pkg'), { recursive: true });
    writeFileSync(join(origin, 'packages/pkg/f.txt'), 'real');
    mkdirSync(join(origin, 'node_modules'), { recursive: true });
    symlinkSync('../packages/pkg', join(origin, 'node_modules/pkg'));
    const command = writeScript('through-link.js', [
      "const fs=require('fs');",
      "fs.writeFileSync('node_modules/pkg/through.txt','x');",
    ].join('\n'));

    const res = run('always', command);
    expect(res.sandbox.isolated).toBe(true);
    // 原 workspace 字节不变：写入只发生在沙箱副本
    expect(existsSync(join(origin, 'packages/pkg/through.txt'))).toBe(false);
    expect(readFileSync(join(origin, 'packages/pkg/f.txt'), 'utf-8')).toBe('real');
    // 链接保持相对语义的直接证据：穿透写入物理落在沙箱副本的 packages/pkg（快照 diff 只扫沙箱），
    // 而非被 cpSync 默认语义改写为原 workspace 绝对路径后写回原目录
    expect(res.sandbox.diagnostics.join('\n')).toContain('packages/pkg/through.txt');
  });

  it('UT-S13-51: 启动前逃逸 symlink 按无法隔离处理，不静默豁免', () => {
    const outside = makeTempRoot();
    try {
      mkdirSync(join(origin, 'node_modules'), { recursive: true });
      symlinkSync(outside.root, join(origin, 'node_modules/escape'));
      const command = writeScript('noop.js', 'process.exit(0);');

      const always = run('always', command);
      expect(always.command.status).toBe('fail');
      expect(always.command.error).toContain('escaping symlinks');
      expect(always.sandbox.status).toBe('fail');
      expect(always.sandbox.diagnostics.join('\n')).toContain('node_modules/escape');

      const auto = run('auto', command);
      expect(auto.sandbox.isolated).toBe(false);
      expect(auto.sandbox.status).toBe('warn');
      expect(auto.sandbox.diagnostics.join('\n')).toContain('逃逸');
    } finally {
      outside.cleanup();
    }
  });

  it.skipIf(!wp.available)('UT-S13-52: 白名单结果文件位于 node_modules 下仍被定点采集回收', () => {
    mkdirSync(join(origin, 'node_modules'), { recursive: true });
    const command = writeScript('nm-result.js', [
      "const fs=require('fs');",
      "fs.mkdirSync('node_modules/.cache/openlogos',{recursive:true});",
      "fs.writeFileSync('node_modules/.cache/openlogos/test-results.jsonl','{\"id\":\"UT-X\",\"status\":\"pass\"}\\n');",
    ].join('\n'));

    const res = run('always', command, ['node_modules/.cache/openlogos/test-results.jsonl']);
    expect(res.command.status).toBe('pass');
    expect(res.sandbox.status).toBe('pass');
    expect(res.sandbox.diagnostics.join('\n')).not.toContain('非白名单');
    // 定点采集：结果文件回收到原 workspace 对应路径
    expect(existsSync(join(origin, 'node_modules/.cache/openlogos/test-results.jsonl'))).toBe(true);
  });

  it.skipIf(!wp.available)('UT-S13-53: 运行期新建绝对逃逸 symlink 后写入被写保护阻断，原 workspace 零改动', () => {
    mkdirSync(join(origin, 'packages/data'), { recursive: true });
    writeFileSync(join(origin, 'packages/data/sentinel.txt'), 'sentinel');
    mkdirSync(join(origin, 'node_modules'), { recursive: true });
    const command = writeScript('runtime-escape.js', [
      "const fs=require('fs');",
      `fs.symlinkSync(${JSON.stringify(origin)},'node_modules/esc');`,
      "fs.writeFileSync('node_modules/esc/evil.txt','x');",
    ].join('\n'));

    const always = run('always', command);
    expect(always.command.status).toBe('fail');
    expect(existsSync(join(origin, 'evil.txt'))).toBe(false);
    expect(readFileSync(join(origin, 'packages/data/sentinel.txt'), 'utf-8')).toBe('sentinel');

    const auto = run('auto', command);
    expect(auto.command.status).toBe('fail');
    expect(existsSync(join(origin, 'evil.txt'))).toBe(false);
    expect(readFileSync(join(origin, 'packages/data/sentinel.txt'), 'utf-8')).toBe('sentinel');
  });

  it.skipIf(!wp.available)('UT-S13-54: 运行期 retarget 内部链接指向原 workspace 后写入被写保护阻断', () => {
    mkdirSync(join(origin, 'packages/pkg'), { recursive: true });
    writeFileSync(join(origin, 'packages/pkg/f.txt'), 'real');
    mkdirSync(join(origin, 'node_modules'), { recursive: true });
    symlinkSync('../packages/pkg', join(origin, 'node_modules/pkg'));
    const command = writeScript('retarget.js', [
      "const fs=require('fs');",
      "fs.rmSync('node_modules/pkg',{force:true});",
      `fs.symlinkSync(${JSON.stringify(origin)},'node_modules/pkg');`,
      "fs.writeFileSync('node_modules/pkg/evil.txt','x');",
    ].join('\n'));

    const res = run('always', command);
    expect(res.command.status).toBe('fail');
    expect(existsSync(join(origin, 'evil.txt'))).toBe(false);
    expect(existsSync(join(origin, 'packages/pkg/evil.txt'))).toBe(false);
    expect(readFileSync(join(origin, 'packages/pkg/f.txt'), 'utf-8')).toBe('real');
  });

  it('UT-S13-55: 运行期写保护不可用时按能力分层处理（always FAIL / auto warn 披露残留风险）', () => {
    const prev = process.env.OPENLOGOS_SANDBOX_WRITE_PROTECTION;
    process.env.OPENLOGOS_SANDBOX_WRITE_PROTECTION = 'off';
    try {
      const command = writeScript('noop-wp.js', 'process.exit(0);');

      const always = run('always', command);
      expect(always.command.status).toBe('fail');
      expect(always.command.error).toContain('runtime write protection');
      expect(always.sandbox.status).toBe('fail');
      expect(always.sandbox.diagnostics.join('\n')).toContain('无法启用运行期写保护');

      const auto = run('auto', command);
      expect(auto.command.status).toBe('pass');
      expect(auto.sandbox.isolated).toBe(true);
      expect(auto.sandbox.status).toBe('warn');
      expect(auto.sandbox.diagnostics.join('\n')).toContain('无法启用运行期写保护');
    } finally {
      if (prev === undefined) delete process.env.OPENLOGOS_SANDBOX_WRITE_PROTECTION;
      else process.env.OPENLOGOS_SANDBOX_WRITE_PROTECTION = prev;
    }
  });
  it.skipIf(!wp.available)('internal-copyback-symlink-result: 白名单路径被做成逃逸 symlink 时拒绝回收', () => {
    mkdirSync(join(origin, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(origin, 'victim.txt'), 'sentinel');
    const command = writeScript('plant-link.js', [
      "const fs=require('fs');",
      "fs.mkdirSync('logos/resources/verify',{recursive:true});",
      `fs.symlinkSync(${JSON.stringify(join(origin, 'victim.txt'))},'logos/resources/verify/test-results.jsonl');`,
    ].join('\n'));

    const res = run('always', command);
    // 回收校验拒绝 symlink 源：always 下判失败，且原 workspace 零污染
    expect(res.sandbox.diagnostics.join('\n')).toContain('白名单回收校验未通过');
    expect(res.sandbox.status).toBe('fail');
    expect(res.command.status).toBe('fail');
    expect(readFileSync(join(origin, 'victim.txt'), 'utf-8')).toBe('sentinel');
    const planted = join(origin, 'logos/resources/verify/test-results.jsonl');
    if (existsSync(planted)) {
      // 若存在必须不是 symlink（未被植入链接）
      expect(lstatSync(planted).isSymbolicLink()).toBe(false);
    }
  });

  it.skipIf(!wp.available)('internal-copyback-traversal: 含 .. 的白名单路径被拒绝，不得穿越到 workspace 之外', () => {
    const escapedTarget = resolve(origin, '..', 'outside-escape-probe', 'result.txt');
    const command = writeScript('traversal.js', [
      "const fs=require('fs');",
      "fs.mkdirSync('../outside-escape-probe',{recursive:true});",
      "fs.writeFileSync('../outside-escape-probe/result.txt','escaped-always');",
    ].join('\n'));

    const res = run('always', command, ['../outside-escape-probe/result.txt']);
    expect(res.sandbox.diagnostics.join('\n')).toContain('白名单回收校验未通过');
    expect(res.sandbox.status).toBe('fail');
    // 真实 workspace 父目录不得出现穿越产物
    expect(existsSync(escapedTarget)).toBe(false);
  });

  it.skipIf(!wp.available)('internal-copyback-parent-symlink: 回收目标父链含 symlink 时拒绝回收', () => {
    mkdirSync(join(origin, 'real'), { recursive: true });
    symlinkSync('real', join(origin, 'linkdir'));
    const command = writeScript('parent-link.js', [
      "const fs=require('fs');",
      "fs.writeFileSync('linkdir/result.txt','x');",
    ].join('\n'));

    const res = run('auto', command, ['linkdir/result.txt']);
    expect(res.sandbox.diagnostics.join('\n')).toContain('回收目标父链含 symlink');
    expect(existsSync(join(origin, 'real/result.txt'))).toBe(false);
    expect(existsSync(join(origin, 'linkdir/result.txt'))).toBe(false);
  });

  it.skipIf(!wp.available)('internal-copyback-zero-change-on-always-fail: 审计 FAIL 时不回收任何对象', () => {
    mkdirSync(join(origin, 'logos/resources/verify'), { recursive: true });
    const command = writeScript('fail-audit.js', [
      "const fs=require('fs');",
      "fs.mkdirSync('src',{recursive:true});",
      "fs.writeFileSync('src/evil.txt','x');",
      "fs.mkdirSync('logos/resources/verify',{recursive:true});",
      "fs.writeFileSync('logos/resources/verify/test-results.jsonl','{\"id\":\"UT-X\",\"status\":\"pass\"}');",
    ].join('\n'));

    const res = run('always', command);
    expect(res.sandbox.status).toBe('fail');
    // always 已判非白名单失败：原 workspace 保持零变化，结果文件不回收
    expect(existsSync(join(origin, 'logos/resources/verify/test-results.jsonl'))).toBe(false);
    expect(existsSync(join(origin, 'src/evil.txt'))).toBe(false);
  });

  it.skipIf(!wp.available)('internal-copyback-tmpleaf-symlink: 预置可预测临时名 symlink 不得改写非白名单文件', () => {
    // 攻击面：旧实现临时名固定为 <dest>.<pid>.olcbtmp 且 copyFileSync 跟随该叶节点 symlink
    writeFileSync(join(origin, 'victim.txt'), 'sentinel');
    symlinkSync('victim.txt', join(origin, `result.txt.${process.pid}.olcbtmp`));
    const command = writeScript('write-result.js', [
      "const fs=require('fs');",
      "fs.writeFileSync('result.txt','fresh-result');",
    ].join('\n'));

    const res = run('always', command, ['result.txt']);
    expect(res.command.status).toBe('pass');
    expect(res.sandbox.status).toBe('pass');
    // 非白名单哨兵字节不变；结果落盘为普通文件而非 symlink
    expect(readFileSync(join(origin, 'victim.txt'), 'utf-8')).toBe('sentinel');
    expect(lstatSync(join(origin, 'result.txt')).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(origin, 'result.txt'), 'utf-8')).toBe('fresh-result');
    // 预置链接本身保持原样（未被跟随写入、未被删除）
    expect(lstatSync(join(origin, `result.txt.${process.pid}.olcbtmp`)).isSymbolicLink()).toBe(true);
  });

  it.skipIf(!wp.available)('internal-copyback-tmp-collision: 同名普通文件不被回收临时文件覆盖', () => {
    writeFileSync(join(origin, `result.txt.${process.pid}.olcbtmp`), 'user-data');
    const command = writeScript('write-result-2.js', [
      "const fs=require('fs');",
      "fs.writeFileSync('result.txt','fresh-result');",
    ].join('\n'));

    const res = run('always', command, ['result.txt']);
    expect(res.command.status).toBe('pass');
    // 用户同名文件不被覆盖或删除；结果正常回收
    expect(readFileSync(join(origin, `result.txt.${process.pid}.olcbtmp`), 'utf-8')).toBe('user-data');
    expect(readFileSync(join(origin, 'result.txt'), 'utf-8')).toBe('fresh-result');
  });

  it.skipIf(!wp.available)('internal-relative-sandbox-root-outside: 相对 sandbox_root（项目根外）解析为绝对路径后正常隔离', () => {
    const command = writeScript('rel-root-ok.js', [
      "const fs=require('fs');",
      "fs.mkdirSync('logos/resources/verify',{recursive:true});",
      "fs.writeFileSync('logos/resources/verify/test-results.jsonl','');",
    ].join('\n'));

    const res = runSandboxedCommand({
      root: origin,
      command,
      format: 'json',
      sandbox: { mode: 'always', root: '../rel-sandbox-base', denyWorkspaceWrite: true },
      allowedWritePaths: ['logos/resources/verify/test-results.jsonl'],
    });
    // 保护器建立不得被误报为用户命令失败：命令 pass、sandbox pass、结果回收
    expect(res.command.status).toBe('pass');
    expect(res.sandbox.status).toBe('pass');
    expect(res.sandbox.isolated).toBe(true);
    expect(existsSync(join(origin, 'logos/resources/verify/test-results.jsonl'))).toBe(true);
    rmSync(resolve(origin, '..', 'rel-sandbox-base'), { recursive: true, force: true });
  });

  it('internal-relative-sandbox-root-inside: sandbox_root 落在 workspace 内时按无法隔离处理而非伪装命令失败', () => {
    const command = writeScript('rel-root-inside.js', 'process.exit(0);');

    const auto = runSandboxedCommand({
      root: origin,
      command,
      format: 'json',
      sandbox: { mode: 'auto', root: 'sandboxes', denyWorkspaceWrite: true },
      allowedWritePaths: [],
    });
    // 自拷贝失败归因于沙箱建立：降级执行 + warn，而不是 sandbox pass + 命令失败
    expect(auto.sandbox.isolated).toBe(false);
    expect(auto.sandbox.status).toBe('warn');
    expect(auto.sandbox.diagnostics.join('\n')).toContain('无法启用沙箱');
    expect(auto.command.status).toBe('pass');

    const always = runSandboxedCommand({
      root: origin,
      command,
      format: 'json',
      sandbox: { mode: 'always', root: 'sandboxes', denyWorkspaceWrite: true },
      allowedWritePaths: [],
    });
    expect(always.command.status).toBe('fail');
    expect(always.command.error).toContain('setup failed');
    expect(always.sandbox.status).toBe('fail');
  });

});

describe('S13 Scenario — pnpm 依赖修复式写入在 always 沙箱下 verify PASS', () => {
  const wp = detectRuntimeWriteProtection();
  let root: string;
  let cleanup: () => void;
  let restoreCwd: () => void;
  let con: ReturnType<typeof captureConsole>;
  let exitSpy: ReturnType<typeof mockProcessExit>;
  let sandboxBase: string;
  let cleanupSandboxBase: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    ({ root: sandboxBase, cleanup: cleanupSandboxBase } = makeTempRoot());
    scaffoldProject(root, { locale: 'en' });
    restoreCwd = mockCwd(root);
    con = captureConsole();
    exitSpy = mockProcessExit();
  });

  afterEach(() => {
    con.restore();
    exitSpy.mockRestore();
    restoreCwd();
    cleanupSandboxBase();
    cleanup();
  });

  it.skipIf(!wp.available)('ST-S13-14: 模拟 pnpm 依赖修复式写入的项目在 always 沙箱下 verify PASS', () => {
    writeFileSync(join(root, 'logos/resources/test', 'S99-test-cases.md'), '| UT-S99-01 | d |\n| ST-S99-01 | d |\n');
    mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
    writeFileSync(join(root, 'node_modules/.bin/tsc'), 'old-shim');
    writeFileSync(join(root, 'prerun.js'), [
      "const fs=require('fs');",
      "fs.writeFileSync('node_modules/.bin/tsc','repaired-shim');",
      "fs.writeFileSync('node_modules/.bin/new-shim','x');",
      "fs.mkdirSync('logos/resources/verify',{recursive:true});",
      "fs.writeFileSync('logos/resources/verify/test-results.jsonl','{\"id\":\"UT-S99-01\",\"status\":\"pass\"}\\n{\"id\":\"ST-S99-01\",\"status\":\"pass\"}\\n');",
    ].join('\n'));
    const configPath = join(root, 'logos', 'logos.config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.verify = {
      ...config.verify,
      sandbox_mode: 'always',
      sandbox_root: sandboxBase,
      pre_run_command: 'node prerun.js',
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    verify('json');

    const parsed = JSON.parse(con.logs[0]);
    expect(parsed.data.gate.result).toBe('PASS');
    expect(parsed.data.sandbox.isolated).toBe(true);
    expect(parsed.data.sandbox.status).toBe('pass');
    expect(parsed.data.sandbox.infos).toContain(DEPENDENCY_DIR_EXEMPT_INFO);
    expect(parsed.data.sandbox.diagnostics.join('\n')).not.toContain('非白名单');
    // 豁免说明不得进入 pre_run.diagnostics
    expect(parsed.data.pre_run.diagnostics.join('\n')).not.toContain(DEPENDENCY_DIR_EXEMPT_INFO);
    // 结果与报告正常生成；node_modules 变更不回收
    expect(existsSync(join(root, 'logos/resources/verify/acceptance-report.md'))).toBe(true);
    expect(readFileSync(join(root, 'node_modules/.bin/tsc'), 'utf-8')).toBe('old-shim');
    expect(existsSync(join(root, 'node_modules/.bin/new-shim'))).toBe(false);

    // 文本输出：豁免说明以 ℹ️ 渲染且全程只出现一次
    con.logs.length = 0;
    verify();
    const infoLines = con.logs.filter(line => typeof line === 'string' && line.includes(DEPENDENCY_DIR_EXEMPT_INFO));
    expect(infoLines).toHaveLength(1);
    expect(infoLines[0]).toContain('ℹ️');
    expect(infoLines[0]).not.toContain('⚠️');
  });
});
