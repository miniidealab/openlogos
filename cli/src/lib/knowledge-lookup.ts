/**
 * knowledge-direct-intake — 设计时检索：`openlogos knowledge list / show / refs` 与 status / next 的知识提示
 * （功能规格 §2.103.8、§2.103.9、§2.103.13）。
 *
 * 三个命令都在 `knowledge-apply.lock` 读锁区间内完成全部知识读取（§2.103.4「事务」第 6 条）：区间内发现未完成事务，
 * 或退避预算内取不到锁，一律以 `knowledge_apply_incomplete` 拒绝、不输出视图数据。
 * 有效知识视图 = 落盘条目叠加活跃提案 `deltas/knowledge/`（与 change-lint L10 同一阶段判定与合成器）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProposalKnowledgeUnreadableError, computeProposalKnowledgeState } from './change-lint.js';
import {
  KNOWLEDGE_DIR,
  KNOWLEDGE_TAGS_FILE,
  KNOWLEDGE_TAGS_MARKER,
  applyTagCriterion,
  buildKnowledgeView,
  entryTags,
  extractConstraintRows,
  normalizeTag,
  parseKnowledgeEntry,
  parseRuleRows,
  parseTagTable,
  readKnowledgeDir,
  readScenarioDir,
  readTagStateFacts,
  resolveKnowledgeReference,
  resolveTagState,
  type KnowledgeEntry,
  type KnowledgeView,
  type TagState,
  type TagTable,
} from './knowledge-view.js';
import { KNOWLEDGE_TXN_DIR, incompleteMessage, knowledgeTxnIncomplete, testReadBarrier, withKnowledgeReadLock } from './knowledge-lock.js';
import { runKnowledgeCheckUnlocked, type KnowledgeIssue } from './knowledge-apply.js';

interface EffectiveKnowledge {
  tagState: TagState;
  table: TagTable | null;
  contents: Map<string, string>;
  entries: KnowledgeEntry[];
  /** 结构 + 标签判据叠加后的视图。 */
  view: KnowledgeView;
  origin: Map<string, 'resources' | 'delta'>;
  deltaPath: Map<string, string>;
  scenarios: Map<string, { content: string; origin: 'resources' | 'delta' }>;
}

function readActiveChange(root: string): string | null {
  try {
    const g = JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf-8')) as { activeChange?: unknown };
    return typeof g.activeChange === 'string' && g.activeChange.trim() !== '' ? g.activeChange.trim() : null;
  } catch { return null; }
}

function loadEffective(root: string): EffectiveKnowledge {
  const facts = readTagStateFacts(root);
  const tagState = resolveTagState(facts);
  const table = tagState === 'enabled' && facts.tags !== null ? parseTagTable(facts.tags) : null;
  const live = readKnowledgeDir(root);
  const slug = readActiveChange(root);
  const proposal = slug ? computeProposalKnowledgeState(root, slug) : null;
  const active = proposal !== null && proposal.replay;
  const contents = active ? new Map(proposal!.candidate) : live;
  const origin = new Map<string, 'resources' | 'delta'>();
  const deltaPath = new Map<string, string>();
  for (const p of contents.keys()) {
    const fromDelta = active && proposal!.touchedKnowledge.has(p);
    origin.set(p, fromDelta ? 'delta' : 'resources');
    if (fromDelta && proposal!.deltaRelByTarget.has(p)) deltaPath.set(p, proposal!.deltaRelByTarget.get(p)!);
  }
  const entries = [...contents].map(([p, c]) => parseKnowledgeEntry(p, c, { root }));
  const structural = buildKnowledgeView(entries);
  const view = table && table.problems.length === 0 ? applyTagCriterion(structural, tagState, table) : structural;
  const scenarios = new Map<string, { content: string; origin: 'resources' | 'delta' }>();
  for (const [p, c] of readScenarioDir(root)) scenarios.set(p, { content: c, origin: 'resources' });
  if (active) {
    for (const sc of proposal!.scenarios) scenarios.set(sc.target, { content: sc.content, origin: 'delta' });
    for (const t of proposal!.removedScenarioTargets) scenarios.delete(t);
  }
  testReadBarrier();
  return { tagState, table, contents, entries, view, origin, deltaPath, scenarios };
}

/** 读锁区间内载入有效视图；活跃提案产物不可读时以可定位错误拒绝（code-r1 F3）。 */
function loadLocked(root: string): { ok: true; value: EffectiveKnowledge } | LookupFailure {
  let unreadable: string | null = null;
  const locked = withKnowledgeReadLock(root, () => {
    try { return loadEffective(root); } catch (e) {
      if (e instanceof ProposalKnowledgeUnreadableError) { unreadable = e.message; return null; }
      throw e;
    }
  });
  if (!locked.ok) return { ok: false, exitCode: 1, errors: [incompleteIssue(locked.reason)] };
  if (locked.value === null) {
    return { ok: false, exitCode: 1, errors: [{ code: 'knowledge_apply_conflict', path: null, message: unreadable ?? '活跃提案产物不可读', fix_hint: '修复活跃提案产物的可读性后重跑' }] };
  }
  return { ok: true, value: locked.value };
}

function incompleteIssue(reason: 'busy' | 'incomplete'): KnowledgeIssue {
  return {
    code: 'knowledge_apply_incomplete', path: `${KNOWLEDGE_TXN_DIR}/`,
    message: `企业知识录入事务未完成：${incompleteMessage(reason)}`,
    fix_hint: reason === 'busy' ? '等待另一个录入完成后重跑' : '运行 openlogos knowledge apply --recover',
  };
}

export type LookupFailure = { ok: false; exitCode: 1 | 2; errors: KnowledgeIssue[] };

// ———————————————————————————————— list（§2.103.8） ————————————————————————————————

export interface KnowledgeListItem {
  id: string | null; title: string | null; path: string; origin: 'resources' | 'delta'; delta_path?: string;
  type: unknown; scope: unknown; module: unknown; tags: string[]; status: unknown;
  rules_active: number; rules_total: number; valid: boolean; problems: string[];
}

export function runKnowledgeList(root: string, filters: { module: string | null; tag: string | null }):
  { ok: true; data: { tag_state: TagState; filters: { module: string | null; tag: string | null }; entries: KnowledgeListItem[] } } | LookupFailure {
  const locked = loadLocked(root);
  if (!locked.ok) return locked;
  const eff = locked.value;
  const byPath = new Map(eff.view.entries.map(e => [e.path, e]));
  const tagLabel = (t: string): string => eff.table?.lookup.get(normalizeTag(t)) ?? `literal:${normalizeTag(t)}`;
  const wanted = filters.tag ? tagLabel(filters.tag) : null;
  const num = (id: string | null) => (id ? Number(id.slice(1)) : Number.MAX_SAFE_INTEGER);
  const items: KnowledgeListItem[] = eff.entries
    .map(raw => {
      const e = byPath.get(raw.path) ?? raw;
      const meta = e.meta ?? {};
      const item: KnowledgeListItem = {
        id: e.id, title: e.title, path: e.path, origin: eff.origin.get(e.path) ?? 'resources',
        type: meta.type ?? null, scope: meta.scope ?? null, module: meta.module ?? null, tags: entryTags(e), status: meta.status ?? null,
        rules_active: e.rules.filter(r => r.status === 'active').length, rules_total: e.rules.length, valid: e.valid, problems: e.problems,
      };
      const dp = eff.deltaPath.get(e.path);
      if (dp) item.delta_path = dp;
      return item;
    })
    .filter(it => !filters.module || it.scope === 'global' || it.module === filters.module)
    .filter(it => !wanted || it.tags.some(t => tagLabel(t) === wanted))
    .sort((a, b) => num(a.id) - num(b.id) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ok: true, data: { tag_state: eff.tagState, filters, entries: items } };
}

// ———————————————————————————————— show（§2.103.8） ————————————————————————————————

export interface KnowledgeShowData {
  id: string; path: string; origin: 'resources' | 'delta'; delta_path?: string; content: string;
  rules: Array<{ id: string; rule: string; status: string; exception: string }>; valid: boolean; problems: string[];
}

export function runKnowledgeShow(root: string, id: string): { ok: true; data: KnowledgeShowData } | LookupFailure {
  if (!/^K\d+$/.test(id)) {
    return { ok: false, exitCode: 2, errors: [{ code: 'knowledge_reference_unknown', path: null, message: `参数「${id}」不是条目编号（KXX）`, fix_hint: '用法：openlogos knowledge show <KXX>' }] };
  }
  const locked = loadLocked(root);
  if (!locked.ok) return locked;
  const eff = locked.value;
  const list = eff.view.byId.get(id) ?? [];
  if (list.length === 0) {
    return { ok: false, exitCode: 1, errors: [{ code: 'knowledge_reference_unknown', path: null, message: `${id} 在有效知识视图中不存在`, fix_hint: '用 openlogos knowledge list 查看现有条目' }] };
  }
  if (list.length > 1) {
    return { ok: false, exitCode: 1, errors: [{ code: 'knowledge_id_duplicate', path: list[0].path, message: `知识编号 ${id} 重复：${list.map(e => e.path).join('、')}`, fix_hint: '先修复重号' }] };
  }
  const e = list[0];
  const content = eff.contents.get(e.path) ?? '';
  const data: KnowledgeShowData = {
    id, path: e.path, origin: eff.origin.get(e.path) ?? 'resources', content, rules: parseRuleRows(content), valid: e.valid, problems: e.problems,
  };
  const dp = eff.deltaPath.get(e.path);
  if (dp) data.delta_path = dp;
  return { ok: true, data };
}

// ———————————————————————————————— refs（§2.103.9） ————————————————————————————————

export interface KnowledgeRefsData {
  query: string;
  target_status: 'active' | 'deprecated' | 'unknown' | 'invalid' | 'duplicate';
  refs: Array<{ scenario_path: string; line: number; ref: string; level: 'rule' | 'entry'; location: string; exception: string; origin: 'resources' | 'delta' }>;
}

export function runKnowledgeRefs(root: string, query: string): { ok: true; data: KnowledgeRefsData } | LookupFailure {
  const m = /^(K\d+)(?:-(R\d+))?$/.exec(query);
  if (!m) {
    return { ok: false, exitCode: 2, errors: [{ code: 'knowledge_reference_unknown', path: null, message: `参数「${query}」不是 KXX 或 KXX-Rn`, fix_hint: '用法：openlogos knowledge refs <KXX|KXX-Rn>' }] };
  }
  const locked = loadLocked(root);
  if (!locked.ok) return locked;
  const eff = locked.value;
  const entryId = m[1];
  const r = resolveKnowledgeReference(eff.view, query);
  const target_status: KnowledgeRefsData['target_status'] = r.kind === 'duplicate' ? 'duplicate'
    : r.kind === 'unknown' ? (r.reason === 'invalid' ? 'invalid' : 'unknown')
      : r.deprecated ? 'deprecated' : 'active';
  const refs: KnowledgeRefsData['refs'] = [];
  for (const [scenarioPath, sc] of [...eff.scenarios].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    for (const row of extractConstraintRows(sc.content)) {
      const isRule = row.ref.includes('-R');
      const hit = m[2]
        ? row.ref === query || row.ref === entryId
        : row.ref === entryId || row.ref.startsWith(`${entryId}-R`);
      if (!hit) continue;
      refs.push({ scenario_path: scenarioPath, line: row.line, ref: row.ref, level: isRule ? 'rule' : 'entry', location: row.location, exception: row.exception, origin: sc.origin });
    }
  }
  refs.sort((a, b) => (a.scenario_path < b.scenario_path ? -1 : a.scenario_path > b.scenario_path ? 1 : a.line - b.line));
  return { ok: true, data: { query, target_status, refs } };
}

// ———————————————————————————————— status / next 文本提示（§2.103.13） ————————————————————————————————

/**
 * 知识健康提示行：存在知识条目、`TAGS.md`、启用标记或未完成事务时计算；有 error、三态为 missing、索引过期或
 * 存在未完成事务时返回一行文本，否则 null。不含 git HEAD 辅助比较；只用于文本输出，JSON 不变。
 */
export function knowledgeStatusHint(root: string): string | null {
  const kdir = join(root, ...KNOWLEDGE_DIR.split('/'));
  const anything = readKnowledgeDir(root).size > 0
    || existsSync(join(root, ...KNOWLEDGE_TAGS_FILE.split('/')))
    || existsSync(join(root, ...KNOWLEDGE_TAGS_MARKER.split('/')))
    || knowledgeTxnIncomplete(root);
  if (!existsSync(kdir) && !anything) return null;
  if (!anything) return null;
  const locked = withKnowledgeReadLock(root, () => runKnowledgeCheckUnlocked(root, { head: false }));
  if (!locked.ok) {
    return locked.reason === 'busy'
      ? '企业知识：另一个录入正在进行，稍后运行 openlogos knowledge check 查看'
      : '企业知识：上一次录入被中断，运行 openlogos knowledge apply --recover 恢复';
  }
  const report = locked.value;
  const parts: string[] = [];
  if (report.errors.length > 0) parts.push(`检查未通过 ${report.errors.length} 项`);
  if (report.tag_state === 'missing' && !report.errors.some(e => e.code === 'knowledge_tags_missing')) parts.push('标签表已启用但词表丢失');
  if (report.warnings.some(w => w.code === 'knowledge_index_stale')) parts.push('INDEX.md 已过期');
  if (parts.length === 0) return null;
  return `企业知识：${report.entries} 条；${parts.join('，')}，运行 openlogos knowledge check 查看`;
}
