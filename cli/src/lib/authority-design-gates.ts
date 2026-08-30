/** Authority Closure 设计产物的共享可证伪判据；不解析 proposal，也不复制 Plan Package evaluator。 */
import { TEST_ID_ANCHORED_RE } from './proposal-lifecycle.js';

export const AUTHORITY_TEST_DIMENSIONS = [
  'happy', 'stale', 'conflict', 'legacy_writer', 'restart', 'rebuild', 'rollback', 'reverse_inference',
] as const;

export type AuthorityTestDimension = typeof AUTHORITY_TEST_DIMENSIONS[number];

export interface AuthorityProjection {
  id: string;
  consumer: string;
  freshness_proof: string;
  rebuild_rule: string;
  writable: false;
}

export interface AuthorityRegistryRow {
  fact_id: string;
  semantic_scope: string;
  authority_owner: string;
  canonical_state: string;
  sole_writer: string;
  mutation_entry: string;
  decision_api: string;
  projections: AuthorityProjection[];
  recovery_source: string;
  forbidden_shadow_sources: string[];
  cutover_exit: string;
}

export interface AuthorityGateIssue {
  severity: 'Critical';
  fact_id: string;
  location: string;
  ac: `AC-0${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
  message: string;
  fix_action: string;
  test_id: string;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function critical(factId: string, location: string, ac: AuthorityGateIssue['ac'], message: string,
  fixAction: string, testId: string): AuthorityGateIssue {
  return { severity: 'Critical', fact_id: factId, location, ac, message, fix_action: fixAction, test_id: testId };
}

/** architecture-designer 的 Authority Registry 交付门。 */
export function validateAuthorityRegistry(rows: AuthorityRegistryRow[]): AuthorityGateIssue[] {
  const issues: AuthorityGateIssue[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const id = text(row.fact_id) ? row.fact_id : `row-${index}`;
    const location = `authority-registry[${index}]`;
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(id) || /[\\/]/.test(id) || seen.has(id)) {
      issues.push(critical(id, location, 'AC-01', 'fact_id 不是唯一业务语义身份。', '使用稳定、唯一且非路径/类名的 fact_id。', 'UT-S12-05'));
    }
    seen.add(id);
    if (![row.semantic_scope, row.authority_owner, row.canonical_state].every(text)
      || /(?:\band\b|与|、|\+)/i.test(row.authority_owner)) {
      issues.push(critical(id, location, 'AC-01', 'authority owner/canonical state 未闭合或声明共同 owner。',
        '拆分 fact 或选择一个 authority owner 与 canonical state。', 'UT-S12-03'));
    }
    if (![row.sole_writer, row.mutation_entry].every(text) || /(?:\band\b|与|、|\+)/i.test(row.sole_writer)) {
      issues.push(critical(id, location, 'AC-02', 'sole writer/mutation entry 不唯一。',
        '保留一个 sole writer，所有写入仅经 mutation entry。', 'UT-S12-03'));
    }
    if (!text(row.decision_api)) issues.push(critical(id, location, 'AC-05', '缺少共享 decision API。',
      '声明消费者共同调用的 decision API/evaluator。', 'UT-S12-01'));
    if (!Array.isArray(row.projections)) {
      issues.push(critical(id, location, 'AC-03', 'projection 列表缺失。', '声明可重建只读 projection。', 'UT-S12-04'));
    } else {
      for (const projection of row.projections) {
        if (![projection.id, projection.consumer].every(text) || projection.writable !== false) {
          issues.push(critical(id, `${location}.projections`, 'AC-03', 'projection 缺血缘或仍可写。',
            '补 projection/consumer 并固定 writable:false。', 'UT-S12-04'));
        }
        if (!text(projection.freshness_proof) || !text(projection.rebuild_rule)) {
          issues.push(critical(id, `${location}.projections`, 'AC-04', 'projection 缺 freshness/rebuild。',
            '绑定 generation/version/hash/receipt，并声明 authority 重建规则。', 'UT-S12-04'));
        }
      }
    }
    if (!text(row.recovery_source)) issues.push(critical(id, location, 'AC-06', '缺少 authority/receipt recovery source。',
      '恢复仅查询 authority transaction/receipt。', 'UT-S12-01'));
    if (!Array.isArray(row.forbidden_shadow_sources) || row.forbidden_shadow_sources.length === 0) {
      issues.push(critical(id, location, 'AC-05', '未声明 forbidden shadow sources。', '列出旧 parser/writer/fallback。', 'UT-S12-01'));
    }
    if (!text(row.cutover_exit) || /permanent|永久|forever/i.test(row.cutover_exit)) {
      issues.push(critical(id, location, 'AC-07', 'cutover 缺有限 exit evidence。', '声明旧 writer 关闭与可验证退出证据。', 'UT-S12-06'));
    }
  }
  return issues.sort((a, b) => a.fact_id.localeCompare(b.fact_id) || a.ac.localeCompare(b.ac) || a.location.localeCompare(b.location));
}

export interface AuthoritySequenceMessage {
  phase: 'command' | 'write' | 'refresh' | 'decision' | 'recovery';
  actor: string;
  target: string;
  fact_id: string;
  access: 'command' | 'write' | 'refresh' | 'read' | 'recover';
  freshness?: string;
}

/** scenario-architect 从 Registry row 投影时序，不产生第二份 owner 表。 */
export function buildAuthoritySequence(row: AuthorityRegistryRow): AuthoritySequenceMessage[] {
  return [
    { phase: 'command', actor: 'command', target: row.mutation_entry, fact_id: row.fact_id, access: 'command' },
    { phase: 'write', actor: row.sole_writer, target: row.canonical_state, fact_id: row.fact_id, access: 'write' },
    ...row.projections.map(p => ({ phase: 'refresh' as const, actor: row.authority_owner, target: p.id,
      fact_id: row.fact_id, access: 'refresh' as const, freshness: p.freshness_proof })),
    { phase: 'decision', actor: 'consumer', target: row.decision_api, fact_id: row.fact_id, access: 'read' },
    { phase: 'recovery', actor: 'restarted-consumer', target: row.recovery_source, fact_id: row.fact_id, access: 'recover' },
  ];
}

export function validateAuthoritySequence(messages: AuthoritySequenceMessage[]): AuthorityGateIssue[] {
  const issues: AuthorityGateIssue[] = [];
  for (const factId of [...new Set(messages.map(m => m.fact_id))].sort()) {
    const same = messages.filter(m => m.fact_id === factId);
    const writers = new Set(same.filter(m => m.access === 'write').map(m => m.actor));
    if (writers.size !== 1) issues.push(critical(factId, 'sequence.write', 'AC-02', '时序存在零个或多个直接 writer。',
      '回到 architecture-designer 选择唯一 writer；禁止 last-write-wins。', 'UT-S04-03'));
    for (const message of same.filter(m => m.phase === 'refresh')) {
      if (!text(message.freshness)) issues.push(critical(factId, 'sequence.refresh', 'AC-04', 'projection refresh 缺 freshness identity。',
        '消息携带 generation/version/hash/receipt。', 'UT-S04-02'));
    }
    const recovery = same.filter(m => m.phase === 'recovery');
    if (recovery.length === 0 || recovery.some(m => /marker|mtime|directory|scan/i.test(m.target))) {
      issues.push(critical(factId, 'sequence.recovery', 'AC-06', '恢复从 projection/扫描反向推断。',
        'response lost + restart 只查询 authority transaction/receipt。', 'UT-S04-04'));
    }
    for (const phase of ['command', 'write', 'decision', 'recovery'] as const) {
      if (!same.some(m => m.phase === phase)) issues.push(critical(factId, `sequence.${phase}`, 'AC-05', `时序缺少 ${phase} 阶段。`,
        '补齐 command/write/refresh/decision/recovery 主链。', 'ST-S04-01'));
    }
  }
  return issues;
}

export interface AuthorityMatrixCase {
  fact_id: string;
  dimension: AuthorityTestDimension;
  test_id: string;
  assertion: string;
  fixture: Record<string, unknown>;
  authority_ref?: string;
  rationale?: string;
  skip?: boolean;
}

export function buildAuthorityTestMatrix(factId: string, ids: string[]): AuthorityMatrixCase[] {
  return AUTHORITY_TEST_DIMENSIONS.map((dimension, index) => ({
    fact_id: factId,
    dimension,
    test_id: ids[index] ?? '',
    assertion: `${dimension} 必须 fail closed 或验证 authority happy path`,
    fixture: dimension === 'stale' ? { authority_identity: 'v2', projection_identity: 'v1' }
      : dimension === 'restart' ? { new_process: true, old_residual: true }
        : { inject: dimension },
  }));
}

/** test-writer 八维矩阵闭包；返回所有缺口，不首错短路。 */
export function validateAuthorityTestMatrix(factId: string, cases: AuthorityMatrixCase[]): AuthorityGateIssue[] {
  const issues: AuthorityGateIssue[] = [];
  for (const dimension of AUTHORITY_TEST_DIMENSIONS) {
    const row = cases.find(item => item.fact_id === factId && item.dimension === dimension);
    if (!row) {
      issues.push(critical(factId, `test-matrix.${dimension}`, 'AC-08', `缺少 ${dimension} 维度。`,
        `新增真实 UT/ST/SMOKE ID 的 ${dimension} 故障用例。`, 'UT-S06-05'));
      continue;
    }
    if (row.skip) {
      if (!text(row.authority_ref) || !text(row.rationale)) issues.push(critical(factId, `test-matrix.${dimension}`, 'AC-08',
        `${dimension} 的 SKIP 缺 authority_ref/rationale。`, '补齐架构不变量证据，否则实现真实故障夹具。', 'UT-S06-06'));
      continue;
    }
    if (!TEST_ID_ANCHORED_RE.test(row.test_id) || !text(row.assertion)) issues.push(critical(factId, `test-matrix.${dimension}`, 'AC-08',
      `${dimension} 缺真实 ID 或精确断言。`, '分配唯一真实 ID 并写明可证伪断言。', 'UT-S06-02'));
    if (dimension === 'stale' && row.fixture.authority_identity === row.fixture.projection_identity) {
      issues.push(critical(factId, 'test-matrix.stale', 'AC-04', 'stale 夹具的 authority/projection identity 相同。',
        '使用显式不同的值或 generation/hash。', 'UT-S06-03'));
    }
    if (dimension === 'restart' && (row.fixture.new_process !== true || row.fixture.old_residual !== true)) {
      issues.push(critical(factId, 'test-matrix.restart', 'AC-06', 'restart 夹具复用当前进程或未保留旧残留。',
        '启动新进程并保留冲突旧副本。', 'UT-S06-04'));
    }
  }
  const ids = cases.filter(row => !row.skip).map(row => row.test_id).filter(text);
  for (const id of ids.filter((value, index) => ids.indexOf(value) !== index)) {
    issues.push(critical(factId, 'test-matrix.ids', 'AC-08', `测试 ID 重复：${id}`, '为每个矩阵用例分配唯一 ID。', 'UT-S06-02'));
  }
  return issues.sort((a, b) => a.location.localeCompare(b.location) || a.message.localeCompare(b.message));
}

export interface AuthoritySourceFixture { path: string; content: string }

/** code-reviewer 的 Shadow Authority 负向扫描；每条 Critical 固定携带 fact/location/AC/fix/test。 */
export function reviewShadowAuthority(factId: string, sources: AuthoritySourceFixture[]): AuthorityGateIssue[] {
  const issues: AuthorityGateIssue[] = [];
  for (const source of [...sources].sort((a, b) => a.path.localeCompare(b.path))) {
    if (/directCanonicalWrite|writeFileSync\s*\(\s*canonical/i.test(source.content)) issues.push(critical(factId, source.path,
      'AC-02', '发现 consumer 旁路写 canonical state。', '删除旁路，改走唯一 mutation entry。', 'UT-S07-03'));
    if (/localCompletionPredicate|markerExists\s*&&\s*phase/i.test(source.content)) issues.push(critical(factId, source.path,
      'AC-05', '发现消费者复制完成谓词。', '删除本地 parser，调用共享 decision evaluator。', 'UT-S07-04'));
    if (/catch[\s\S]{0,160}(?:scanDirectory|mtime|readdir)/i.test(source.content)) issues.push(critical(factId, source.path,
      'AC-06', '发现 catch 后 heuristic recovery。', '改查 authority transaction/receipt。', 'UT-S07-05'));
    if (/(?:legacyWriter|oldWriter)[\s\S]{0,120}(?:newWriter|authorityWriter)[\s\S]{0,120}(?:success|enabled|write)/i.test(source.content)) {
      issues.push(critical(factId, source.path, 'AC-07', '旧/新 writer 可长期同时成功。',
        '建立有限 cutover，退出后旧入口必须拒绝。', 'UT-S07-06'));
    }
  }
  return issues;
}
