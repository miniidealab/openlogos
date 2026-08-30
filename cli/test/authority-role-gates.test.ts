/** 六角色 Authority Closure 设计产物与 Shadow Authority 证伪；全局 reporter 自动记录真实 ID。 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTHORITY_TEST_DIMENSIONS,
  buildAuthoritySequence,
  buildAuthorityTestMatrix,
  reviewShadowAuthority,
  validateAuthorityRegistry,
  validateAuthoritySequence,
  validateAuthorityTestMatrix,
  type AuthorityRegistryRow,
} from '../src/lib/authority-design-gates.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

function registry(projectionCount = 2): AuthorityRegistryRow {
  return {
    fact_id: 'core.plan-readiness',
    semantic_scope: '提案是否完成 Authority Closure 并可离开 plan',
    authority_owner: 'PlanPackageEvaluator',
    canonical_state: 'proposal authority impact',
    sole_writer: 'approved merge transaction',
    mutation_entry: 'openlogos merge',
    decision_api: 'AuthorityClosureEvaluator.evaluate',
    projections: Array.from({ length: projectionCount }, (_, index) => ({
      id: `view-${index + 1}`, consumer: `consumer-${index + 1}`, freshness_proof: `sha256-${index + 1}`,
      rebuild_rule: '由 evaluator 重新投影', writable: false as const,
    })),
    recovery_source: 'merge transaction receipt',
    forbidden_shadow_sources: ['marker scan', 'consumer local parser'],
    cutover_exit: '旧 parser 不可达且四消费者 summary 深相等',
  };
}

const MATRIX_IDS = AUTHORITY_TEST_DIMENSIONS.map((_, index) => `UT-S06-${String(index + 10).padStart(2, '0')}`);

describe('S04 scenario-architect Authority 时序', () => {
  it('UT-S04-01: Registry fact 映射为唯一 authority/mutation/decision 与 freshness 消息', () => {
    const row = registry(); const messages = buildAuthoritySequence(row);
    expect(new Set(messages.map(m => m.fact_id))).toEqual(new Set([row.fact_id]));
    expect(messages.filter(m => m.access === 'write')).toHaveLength(1);
    expect(messages.filter(m => m.phase === 'refresh').every(m => Boolean(m.freshness))).toBe(true);
  });

  it('UT-S04-02: command 仅写 authority，query 验 freshness 后调用 decision API', () => {
    const row = registry(); const messages = buildAuthoritySequence(row);
    expect(messages.find(m => m.phase === 'command')?.target).toBe(row.mutation_entry);
    expect(messages.find(m => m.phase === 'decision')?.target).toBe(row.decision_api);
    expect(validateAuthoritySequence(messages)).toEqual([]);
  });

  it('UT-S04-03: 双 writer 时停止交付且不做 last-write-wins', () => {
    const row = registry(); const messages = buildAuthoritySequence(row);
    messages.push({ ...messages.find(m => m.phase === 'write')!, actor: 'legacy-writer' });
    expect(validateAuthoritySequence(messages)).toContainEqual(expect.objectContaining({ ac: 'AC-02', test_id: 'UT-S04-03' }));
  });

  it('UT-S04-04: projection/mtime 反向恢复被拒绝', () => {
    const messages = buildAuthoritySequence(registry()).map(m => m.phase === 'recovery' ? { ...m, target: 'marker mtime scan' } : m);
    expect(validateAuthoritySequence(messages)).toContainEqual(expect.objectContaining({ ac: 'AC-06', test_id: 'UT-S04-04' }));
  });

  it('ST-S04-01: 完整时序覆盖 command/write/refresh/decision/recovery，双 writer fail closed', () => {
    const messages = buildAuthoritySequence(registry());
    expect(new Set(messages.map(m => m.phase))).toEqual(new Set(['command', 'write', 'refresh', 'decision', 'recovery']));
    expect(validateAuthoritySequence(messages)).toEqual([]);
    expect(validateAuthoritySequence([...messages, { ...messages[1], actor: 'second-writer' }]).map(i => i.ac)).toContain('AC-02');
  });
});

describe('S06 test-writer 八维故障矩阵', () => {
  it('UT-S06-01: 每 fact 生成八维覆盖', () => {
    expect(buildAuthorityTestMatrix(registry().fact_id, MATRIX_IDS).map(row => row.dimension)).toEqual(AUTHORITY_TEST_DIMENSIONS);
  });

  it('UT-S06-02: 真实 ID 唯一并反向关联 fact_id', () => {
    const matrix = buildAuthorityTestMatrix(registry().fact_id, MATRIX_IDS);
    expect(new Set(matrix.map(row => row.test_id)).size).toBe(8);
    expect(matrix.every(row => row.fact_id === registry().fact_id)).toBe(true);
    expect(validateAuthorityTestMatrix(registry().fact_id, matrix)).toEqual([]);
  });

  it('UT-S06-03: stale 值与 identity 相同不是有效反例', () => {
    const matrix = buildAuthorityTestMatrix(registry().fact_id, MATRIX_IDS);
    const stale = matrix.find(row => row.dimension === 'stale')!; stale.fixture.projection_identity = stale.fixture.authority_identity;
    expect(validateAuthorityTestMatrix(registry().fact_id, matrix)).toContainEqual(expect.objectContaining({ test_id: 'UT-S06-03', ac: 'AC-04' }));
  });

  it('UT-S06-04: restart 必须新进程并保留旧残留', () => {
    const matrix = buildAuthorityTestMatrix(registry().fact_id, MATRIX_IDS);
    matrix.find(row => row.dimension === 'restart')!.fixture = { new_process: false, old_residual: false };
    expect(validateAuthorityTestMatrix(registry().fact_id, matrix)).toContainEqual(expect.objectContaining({ test_id: 'UT-S06-04', ac: 'AC-06' }));
  });

  it('UT-S06-05: 漏 legacy writer 时返回 fact_id 与缺失维度', () => {
    const matrix = buildAuthorityTestMatrix(registry().fact_id, MATRIX_IDS).filter(row => row.dimension !== 'legacy_writer');
    expect(validateAuthorityTestMatrix(registry().fact_id, matrix)).toContainEqual(expect.objectContaining({ fact_id: registry().fact_id, location: 'test-matrix.legacy_writer' }));
  });

  it('UT-S06-06: SKIP 只有 authority_ref+rationale 齐全才通过', () => {
    const matrix = buildAuthorityTestMatrix(registry().fact_id, MATRIX_IDS);
    const row = matrix.find(item => item.dimension === 'rollback')!; row.skip = true; row.test_id = '';
    expect(validateAuthorityTestMatrix(registry().fact_id, matrix).map(i => i.test_id)).toContain('UT-S06-06');
    row.authority_ref = 'spec/authority-closure.md#12'; row.rationale = '本 fact 不迁移 writer，架构上无 rollback transition';
    expect(validateAuthorityTestMatrix(registry().fact_id, matrix)).toEqual([]);
  });

  it('ST-S06-01: Registry+时序生成的完整矩阵有 ID、断言、fixture 与 reporter 可识别名称', () => {
    const matrix = buildAuthorityTestMatrix(registry().fact_id, MATRIX_IDS);
    expect(matrix).toHaveLength(8);
    expect(matrix.every(row => /^UT-S06-/.test(row.test_id) && row.assertion && row.fixture)).toBe(true);
    expect(validateAuthorityTestMatrix(registry().fact_id, matrix)).toEqual([]);
  });

  it('ST-S06-02: 同时删除 restart/cutover 两维时聚合两条稳定问题', () => {
    const matrix = buildAuthorityTestMatrix(registry().fact_id, MATRIX_IDS)
      .filter(row => row.dimension !== 'restart' && row.dimension !== 'rollback');
    expect(validateAuthorityTestMatrix(registry().fact_id, matrix).map(i => i.location)).toEqual(['test-matrix.restart', 'test-matrix.rollback']);
  });
});

describe('S07 code-reviewer Shadow Authority', () => {
  it('UT-S07-01: 唯一 mutation entry 无 Critical', () => {
    expect(reviewShadowAuthority(registry().fact_id, [{ path: 'handler.ts', content: 'mutationEntry(command);' }])).toEqual([]);
  });

  it('UT-S07-02: 共享 decision evaluator 无复制谓词', () => {
    expect(reviewShadowAuthority(registry().fact_id, [{ path: 'status.ts', content: 'AuthorityClosureEvaluator.evaluate(input);' }])).toEqual([]);
  });

  it('UT-S07-03: consumer 旁路写 canonical state 为 AC-02 Critical', () => {
    expect(reviewShadowAuthority(registry().fact_id, [{ path: 'consumer.ts:12', content: 'directCanonicalWrite(value);' }]))
      .toContainEqual(expect.objectContaining({ severity: 'Critical', ac: 'AC-02', test_id: 'UT-S07-03' }));
  });

  it('UT-S07-04: status 本地完成谓词为 AC-05 Critical', () => {
    expect(reviewShadowAuthority(registry().fact_id, [{ path: 'status.ts:8', content: 'localCompletionPredicate(markers);' }]))
      .toContainEqual(expect.objectContaining({ ac: 'AC-05', test_id: 'UT-S07-04' }));
  });

  it('UT-S07-05: catch 后目录/mtime recovery 为 AC-06 Critical', () => {
    expect(reviewShadowAuthority(registry().fact_id, [{ path: 'recovery.ts:20', content: 'try { queryReceipt(); } catch { scanDirectory(); }' }]))
      .toContainEqual(expect.objectContaining({ ac: 'AC-06', test_id: 'UT-S07-05' }));
  });

  it('UT-S07-06: 永久双 writer flag 为 AC-07 Critical', () => {
    expect(reviewShadowAuthority(registry().fact_id, [{ path: 'writer.ts:30', content: 'legacyWriter.enabled; newWriter.success = write(value);' }]))
      .toContainEqual(expect.objectContaining({ ac: 'AC-07', test_id: 'UT-S07-06' }));
  });

  it('ST-S07-01: 四类缺陷均返回完整 Critical 诊断', () => {
    const findings = reviewShadowAuthority(registry().fact_id, [
      { path: 'a.ts', content: 'directCanonicalWrite(value); localCompletionPredicate(markers);' },
      { path: 'b.ts', content: 'try { query(); } catch { scanDirectory(); }' },
      { path: 'c.ts', content: 'legacyWriter.enabled; authorityWriter.success = write(value);' },
    ]);
    expect(findings).toHaveLength(4);
    expect(findings.every(f => f.fact_id && f.location && f.ac && f.fix_action && f.test_id)).toBe(true);
  });

  it('ST-S07-02: 删除 shadow 后 Critical 清零且测试矩阵仍含 stale/conflict/restart', () => {
    expect(reviewShadowAuthority(registry().fact_id, [{ path: 'fixed.ts', content: 'mutationEntry(); AuthorityClosureEvaluator.evaluate(); queryReceipt();' }])).toEqual([]);
    const dimensions = buildAuthorityTestMatrix(registry().fact_id, MATRIX_IDS).map(row => row.dimension);
    expect(dimensions).toEqual(expect.arrayContaining(['stale', 'conflict', 'restart']));
  });
});

describe('S12 architecture-designer Authority Registry', () => {
  it('UT-S12-01: 完整 fact row 通过 AC-01～AC-07 结构检查', () => {
    expect(validateAuthorityRegistry([registry()])).toEqual([]);
  });

  it('UT-S12-02: 一个 authority 加三个只读 projection 合法', () => {
    expect(validateAuthorityRegistry([registry(3)])).toEqual([]);
  });

  it('UT-S12-03: 共同 owner/writer 未闭合', () => {
    const row = registry(); row.authority_owner = 'A 与 B'; row.sole_writer = 'writer-a 与 writer-b';
    expect(validateAuthorityRegistry([row]).map(i => i.ac)).toEqual(expect.arrayContaining(['AC-01', 'AC-02']));
  });

  it('UT-S12-04: projection 只有路径、无 freshness/rebuild 时未闭合', () => {
    const row = registry(); row.projections[0].freshness_proof = ''; row.projections[0].rebuild_rule = '';
    expect(validateAuthorityRegistry([row])).toContainEqual(expect.objectContaining({ ac: 'AC-04', test_id: 'UT-S12-04' }));
  });

  it('UT-S12-05: 路径型 fact_id 被拒绝', () => {
    const row = registry(); row.fact_id = 'src/lib/state.ts';
    expect(validateAuthorityRegistry([row])).toContainEqual(expect.objectContaining({ ac: 'AC-01', test_id: 'UT-S12-05' }));
  });

  it('UT-S12-06: 永久 feature flag 且无 cutover exit 被拒绝', () => {
    const row = registry(); row.cutover_exit = 'permanent dual writer feature flag';
    expect(validateAuthorityRegistry([row])).toContainEqual(expect.objectContaining({ ac: 'AC-07', test_id: 'UT-S12-06' }));
  });

  it('ST-S12-01: 双 writer 先阻断，修复后 Registry 唯一且四角色只按 fact_id 交接', () => {
    const broken = registry(); broken.sole_writer = 'old-writer 与 new-writer';
    expect(validateAuthorityRegistry([broken]).some(i => i.ac === 'AC-02')).toBe(true);
    expect(validateAuthorityRegistry([registry()])).toEqual([]);
    for (const skill of ['architecture-designer', 'scenario-architect', 'deployment-designer', 'test-writer', 'code-reviewer']) {
      const content = readFileSync(resolve(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
      expect(content).toContain('fact_id');
      expect(content).toContain('spec/authority-closure.md');
    }
  });
});
