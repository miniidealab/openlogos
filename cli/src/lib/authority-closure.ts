import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { DELTA_TO_RESOURCE, classifyProposalDeltas } from './delta-classify.js';
import { extractStructuredTestIds, parseReuseDeclaration } from './proposal-lifecycle.js';
import { HISTORICAL_MARKERS } from './proposal-markers.js';

export const AUTHORITY_IMPACT_SCHEMA = 'openlogos/authority-impact@1' as const;
export const AUTHORITY_CLOSURE_SCHEMA = 'openlogos/authority-closure-evaluation@1' as const;

export const AUTHORITY_CLOSURE_ISSUE_CODES = [
  'authority_impact_declaration_missing',
  'authority_impact_malformed',
  'authority_fact_reference_missing',
  'authority_closure_incomplete',
  'authority_cutover_unclosed',
] as const;

export type AuthorityClosureIssueCode = typeof AUTHORITY_CLOSURE_ISSUE_CODES[number];

/**
 * 校验阶段（架构 §四十一.1～.2）。`tests` 的「必须存在于 effective test view」只在产物本该存在的阶段校验：
 * plan 阶段该条按定义不可能为真（flow-spec §12.4 定义此刻尚未产出任何 delta），强判即构成死锁。
 * 结构与 ID 格式校验两阶段同等严格；spec 阶段（change-lint 全量门 / merge preflight）追加存在性，fail-closed。
 */
export type AuthorityClosureStage = 'plan' | 'spec';

export interface AuthorityClosureIssue {
  code: AuthorityClosureIssueCode;
  path: string;
  message: string;
  fix_hint: string;
}

export interface AuthorityClosureSummary {
  schema: typeof AUTHORITY_CLOSURE_SCHEMA;
  applicability: 'required' | 'not_applicable';
  facts_total: number;
  facts_closed: number;
  projections: number;
  retired_shadow_sources: number;
  unresolved: number;
  pass: boolean;
}

export interface AuthorityClosureEvaluation extends AuthorityClosureSummary {
  issues: AuthorityClosureIssue[];
}

interface LocatedIssue extends AuthorityClosureIssue {
  factIndex: number;
}

interface AuthorityFact {
  fact_id?: unknown;
  change?: unknown;
  authority_ref?: unknown;
  authority_owner?: unknown;
  canonical_state?: unknown;
  sole_writer?: unknown;
  mutation_entry?: unknown;
  decision_api?: unknown;
  projections?: unknown;
  freshness_proof?: unknown;
  rebuild_rule?: unknown;
  recovery_source?: unknown;
  retired_shadow_sources?: unknown;
  forbidden_fallbacks?: unknown;
  cutover?: unknown;
  tests?: unknown;
  [key: string]: unknown;
}

const IMPACT_KEYS = new Set(['schema', 'applicability', 'trigger_reasons', 'facts', 'unresolved', 'evidence']);
const FACT_KEYS = new Set([
  'fact_id', 'change', 'authority_ref', 'authority_owner', 'canonical_state', 'sole_writer',
  'mutation_entry', 'decision_api', 'projections', 'freshness_proof', 'rebuild_rule',
  'recovery_source', 'retired_shadow_sources', 'forbidden_fallbacks', 'cutover', 'tests',
]);
const CUTOVER_KEYS = new Set(['old_writer_stop', 'new_writer_start', 'rollback_boundary', 'exit_evidence']);
const FACT_ID_RE = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const TEST_ID_RE = /^(?:UT|ST|SMOKE)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*)*$/;


function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
}

function projectRelative(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, '/');
}

function yamlFences(content: string): string[] {
  return [...content.matchAll(/(?:^|\n) {0,3}```ya?ml[ \t]*\r?\n([\s\S]*?)\r?\n {0,3}```(?=\n|$)/gi)]
    .map(match => match[1]);
}

function walkMarkdown(dir: string, output: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walkMarkdown(path, output);
    else if (stat.isFile() && name.endsWith('.md')) output.push(path);
  }
}

/**
 * effective test view 的唯一结构化 ID 读取，三个来源（功能规格 §2.50.3）：
 * ① 已合并测试规格；② 当前提案 mergeable + valid 的 test delta；③ proposal.md 的「## 复用测试 ID」小节。
 * 来源 ③ 不放宽真实性——`parseReuseDeclaration` 只回 `validIds`，即已在来源 ① 中真实存在的 ID。
 */
export function collectEffectiveTestIds(root: string, proposalDir: string, proposalContent?: string): Set<string> {
  const mergedPaths: string[] = [];
  walkMarkdown(join(root, 'logos', 'resources', 'test'), mergedPaths);
  const paths = [...mergedPaths];
  for (const entry of classifyProposalDeltas(proposalDir)) {
    if (entry.category === 'test' && entry.mergeDisposition === 'mergeable' && entry.lintValidity === 'valid'
      && entry.relativePath.endsWith('.md')) paths.push(join(proposalDir, entry.relativePath));
  }
  const ids = new Set<string>();
  for (const path of paths) {
    for (const id of extractStructuredTestIds(readFileSync(path, 'utf8'))) ids.add(id);
  }
  const proposalPath = join(proposalDir, 'proposal.md');
  const content = proposalContent ?? (existsSync(proposalPath) ? readFileSync(proposalPath, 'utf8') : '');
  if (content) {
    const mergedIds = new Set<string>();
    for (const path of mergedPaths) {
      for (const id of extractStructuredTestIds(readFileSync(path, 'utf8'))) mergedIds.add(id);
    }
    for (const id of parseReuseDeclaration(content, mergedIds).validIds) ids.add(id);
  }
  return ids;
}

/** plan 阶段 Delta 尚未产出时，只采信合法 baseline_closure 中明确 mode=CREATE + target_absent 的 canonical 映射。 */
export function collectPlannedAuthorityCreateTargets(content: string): Set<string> {
  const sources = yamlFences(content).filter(source => /^\s*baseline_closure\s*:/m.test(source));
  if (sources.length !== 1) return new Set();
  const counts = new Map<string, number>();
  for (const source of sources) {
    const doc = parseDocument(source, { uniqueKeys: true, strict: true, prettyErrors: false });
    if (doc.errors.length > 0 || doc.warnings.length > 0) continue;
    const root = doc.toJS() as unknown;
    const closure = isRecord(root) && Object.keys(root).length === 1 && isRecord(root.baseline_closure) ? root.baseline_closure : null;
    if (!closure || closure.policy !== 'on-touch-v1' || closure.schema_version !== 1 || !Array.isArray(closure.targets)) continue;
    for (const target of closure.targets) {
      if (!isRecord(target) || target.mode !== 'CREATE' || !nonEmpty(target.delta_path) || !Array.isArray(target.evidence)) continue;
      const match = /^deltas\/([^/]+)\/(.+)$/.exec(target.delta_path);
      if (!match) continue;
      const base = DELTA_TO_RESOURCE[match[1]];
      if (!base || match[2].split('/').includes('..')) continue;
      const canonical = `${base}/${match[2]}`;
      if (!(target.evidence as unknown[]).some(value => nonEmpty(value) && value.trim() === `target_absent: ${canonical}`)) continue;
      counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    }
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([target]) => target));
}

function issue(code: AuthorityClosureIssueCode, path: string, message: string, fixHint: string, factIndex = -1): LocatedIssue {
  return { code, path, message, fix_hint: fixHint, factIndex };
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every(key => allowed.has(key));
}

function extractDeclaration(content: string): { kind: 'missing' | 'malformed' | 'found'; value?: Record<string, unknown> } {
  const candidates: Array<{ source: string; value?: Record<string, unknown>; malformed: boolean }> = [];
  for (const source of yamlFences(content)) {
    if (!/^\s*authority_impact\s*:/m.test(source)) continue;
    const doc = parseDocument(source, { uniqueKeys: true, strict: true, prettyErrors: false });
    if (doc.errors.length > 0 || doc.warnings.length > 0) {
      candidates.push({ source, malformed: true });
      continue;
    }
    const root = doc.toJS() as unknown;
    const value = isRecord(root) && isRecord(root.authority_impact) ? root.authority_impact : undefined;
    candidates.push({ source, value, malformed: !value || Object.keys(root as Record<string, unknown>).length !== 1 });
  }
  if (candidates.length === 0) return { kind: 'missing' };
  if (candidates.length !== 1 || candidates[0].malformed || !candidates[0].value) return { kind: 'malformed' };
  return { kind: 'found', value: candidates[0].value };
}

function summary(applicability: AuthorityClosureSummary['applicability'], facts: number, closed: number,
  projections: number, retired: number, unresolved: number, issues: LocatedIssue[]): AuthorityClosureEvaluation {
  const ordered = [...issues].sort((a, b) => a.path.localeCompare(b.path)
    || a.factIndex - b.factIndex
    || AUTHORITY_CLOSURE_ISSUE_CODES.indexOf(a.code) - AUTHORITY_CLOSURE_ISSUE_CODES.indexOf(b.code)
    || a.message.localeCompare(b.message));
  return {
    schema: AUTHORITY_CLOSURE_SCHEMA,
    applicability,
    facts_total: facts,
    facts_closed: closed,
    projections,
    retired_shadow_sources: retired,
    unresolved,
    pass: ordered.length === 0,
    issues: ordered.map(({ factIndex: _factIndex, ...item }) => item),
  };
}

export function authorityClosureSummary(evaluation: AuthorityClosureEvaluation): AuthorityClosureSummary {
  return {
    schema: evaluation.schema,
    applicability: evaluation.applicability,
    facts_total: evaluation.facts_total,
    facts_closed: evaluation.facts_closed,
    projections: evaluation.projections,
    retired_shadow_sources: evaluation.retired_shadow_sources,
    unresolved: evaluation.unresolved,
    pass: evaluation.pass,
  };
}

/**
 * Authority Impact 的唯一完成判据。函数只读；historical 且从未声明时返回 undefined，避免伪造 not_applicable。
 */
export function evaluateAuthorityClosure(root: string, proposalDir: string, proposalContent?: string, stage: AuthorityClosureStage = 'spec'): AuthorityClosureEvaluation | undefined {
  const proposalPath = join(proposalDir, 'proposal.md');
  const relPath = projectRelative(root, proposalPath);
  const historical = HISTORICAL_MARKERS.some(marker => existsSync(join(proposalDir, marker)));
  const content = proposalContent ?? readFileSync(proposalPath, 'utf8');
  const declaration = extractDeclaration(content);
  if (declaration.kind === 'missing' && historical) return undefined;
  if (declaration.kind === 'missing') {
    return summary('required', 0, 0, 0, 0, 0, [issue(
      'authority_impact_declaration_missing', relPath, 'writing proposal 缺少 authority_impact 声明。',
      '按 openlogos/authority-impact@1 补 required 或有证据的 not_applicable 声明。',
    )]);
  }
  if (declaration.kind === 'malformed' || !declaration.value) {
    return summary('required', 0, 0, 0, 0, 0, [issue(
      'authority_impact_malformed', relPath, 'authority_impact YAML 不唯一、无法严格解析或根结构非法。',
      '仅保留一个 authority_impact YAML 根，并移除重复键、未知根和非法值。',
    )]);
  }

  const impact = declaration.value;
  const rawApplicability = impact.applicability;
  const applicability = rawApplicability === 'not_applicable' ? 'not_applicable' : 'required';
  const malformed: LocatedIssue[] = [];
  if (impact.schema !== AUTHORITY_IMPACT_SCHEMA || (rawApplicability !== 'required' && rawApplicability !== 'not_applicable')
    || !hasOnlyKeys(impact, IMPACT_KEYS)) {
    malformed.push(issue('authority_impact_malformed', relPath, 'authority_impact schema、applicability 或字段集合非法。',
      '使用 openlogos/authority-impact@1 闭合字段集合与 required|not_applicable 分支。'));
  }

  if (applicability === 'not_applicable') {
    if (!nonEmptyStrings(impact.evidence)) {
      malformed.push(issue('authority_closure_incomplete', relPath, 'not_applicable 分支缺少非空 evidence。',
        '提供至少一条可查询证据，说明本次不改变事实归属。'));
    }
    if ('facts' in impact || 'trigger_reasons' in impact || 'unresolved' in impact) {
      malformed.push(issue('authority_impact_malformed', relPath, 'not_applicable 分支夹带 required 分支字段。',
        '移除 facts、trigger_reasons、unresolved 和 cutover 伪数据。'));
    }
    return summary('not_applicable', 0, 0, 0, 0, 0, malformed);
  }

  const facts = Array.isArray(impact.facts) ? impact.facts : [];
  const unresolved = Array.isArray(impact.unresolved) ? impact.unresolved.length : 0;
  if (!nonEmptyStrings(impact.trigger_reasons) || !Array.isArray(impact.facts) || facts.length === 0
    || !Array.isArray(impact.unresolved)) {
    malformed.push(issue('authority_impact_malformed', relPath, 'required 分支必须含非空 trigger_reasons/facts 与 unresolved 数组。',
      '补齐 required 分支 canonical 字段，并确保 facts 非空。'));
  }
  const knownTests = collectEffectiveTestIds(root, proposalDir, content);
  const plannedTargets = collectPlannedAuthorityCreateTargets(content);
  const seenFactIds = new Set<string>();
  let projections = 0;
  let retired = 0;
  let factsClosed = 0;

  for (let index = 0; index < facts.length; index++) {
    const raw = facts[index];
    if (!isRecord(raw)) {
      malformed.push(issue('authority_impact_malformed', relPath, `facts[${index}] 必须是对象。`, '改为合法 fact 对象。', index));
      continue;
    }
    const fact = raw as AuthorityFact;
    const factId = nonEmpty(fact.fact_id) ? fact.fact_id : `facts[${index}]`;
    const before = malformed.length;
    if (!hasOnlyKeys(fact, FACT_KEYS) || !nonEmpty(fact.fact_id) || !FACT_ID_RE.test(fact.fact_id)
      || seenFactIds.has(fact.fact_id)) {
      malformed.push(issue('authority_impact_malformed', relPath, `${factId} 的 fact_id、唯一性或字段集合非法。`,
        '使用稳定非路径 fact_id，保证提案内唯一并移除未知字段。', index));
    } else seenFactIds.add(fact.fact_id);

    const requiredStrings: Array<[keyof AuthorityFact, string]> = [
      ['change', 'change'], ['authority_ref', 'authority_ref'], ['authority_owner', 'authority_owner'],
      ['canonical_state', 'canonical_state'], ['sole_writer', 'sole_writer'], ['mutation_entry', 'mutation_entry'],
      ['decision_api', 'decision_api'], ['freshness_proof', 'freshness_proof'], ['rebuild_rule', 'rebuild_rule'],
      ['recovery_source', 'recovery_source'],
    ];
    for (const [key, label] of requiredStrings) {
      if (!nonEmpty(fact[key])) malformed.push(issue('authority_closure_incomplete', relPath,
        `${factId} 缺少 ${label}。`, `为 ${factId} 补充非空 ${label}。`, index));
    }
    if (!nonEmptyStrings(fact.projections)) malformed.push(issue('authority_closure_incomplete', relPath,
      `${factId} 缺少 projection 声明。`, `为 ${factId} 声明至少一个只读 projection。`, index));
    else projections += fact.projections.length;
    if (!nonEmptyStrings(fact.retired_shadow_sources)) malformed.push(issue('authority_closure_incomplete', relPath,
      `${factId} 缺少 retired shadow source。`, `列出并退休 ${factId} 的旧 parser/writer/fallback。`, index));
    else retired += fact.retired_shadow_sources.length;
    if (!nonEmptyStrings(fact.forbidden_fallbacks)) malformed.push(issue('authority_closure_incomplete', relPath,
      `${factId} 缺少 forbidden_fallbacks。`, `列出 ${factId} 禁止的反向推断与启发式 fallback。`, index));
    // §2.50.2：plan 阶段只判「结构完备 + ID 格式合法」；「已存在于 effective test view」推迟到 spec 阶段与 merge
    // preflight——该条在 plan 阶段按定义不可能为真，强判即构成 §四十一.1 的门禁前置不可满足。
    const testsWellFormed = nonEmptyStrings(fact.tests)
      && (fact.tests as unknown[]).every(id => nonEmpty(id) && TEST_ID_RE.test(id));
    const testsResolved = stage === 'plan'
      || (testsWellFormed && (fact.tests as string[]).every(id => knownTests.has(id)));
    if (!testsWellFormed || !testsResolved) {
      malformed.push(issue('authority_closure_incomplete', relPath,
        !testsWellFormed
          ? `${factId} 引用的 tests 为空或 ID 格式非法。`
          : `${factId} 引用的 tests 不在 effective test view：${(fact.tests as string[]).filter(id => !knownTests.has(id)).join('、')}`,
        !testsWellFormed
          ? `为 ${factId} 补充非空 tests，每项须符合 UT-/ST-/SMOKE- 测试 ID 格式。`
          : `仅引用 logos/resources/test、当前 test delta 表首列或「## 复用测试 ID」小节中真实存在的测试 ID。`, index));
    }

    if (nonEmpty(fact.authority_ref)) {
      const target = fact.authority_ref.split('#', 1)[0].replace(/^\.\//, '');
      if (!target || target.startsWith('/') || target.includes('..')
        || (!existsSync(join(root, target)) && !plannedTargets.has(target))) {
        malformed.push(issue('authority_fact_reference_missing', relPath, `${factId} 的 authority_ref 无法解析：${fact.authority_ref}`,
          '引用已存在 Registry/根规范，或当前唯一 CREATE delta 映射后的 canonical target。', index));
      }
    }

    if (!isRecord(fact.cutover) || !hasOnlyKeys(fact.cutover, CUTOVER_KEYS)) {
      malformed.push(issue('authority_cutover_unclosed', relPath, `${factId} 的 cutover 结构缺失或含未知字段。`,
        '补齐 old_writer_stop/new_writer_start/rollback_boundary/exit_evidence。', index));
    } else {
      for (const key of CUTOVER_KEYS) {
        if (!nonEmpty(fact.cutover[key])) malformed.push(issue('authority_cutover_unclosed', relPath,
          `${factId} 的 cutover.${key} 未闭合。`, `补充可验证的 cutover.${key} 证据。`, index));
      }
    }
    if (malformed.length === before) factsClosed++;
  }
  if (unresolved > 0) malformed.push(issue('authority_cutover_unclosed', relPath,
    `authority_impact 仍有 ${unresolved} 个 unresolved 项。`, '解决全部 authority ownership/cutover 未决项后再通过 plan gate.', facts.length));
  return summary('required', facts.length, factsClosed, projections, retired, unresolved, malformed);
}
