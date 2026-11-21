/**
 * knowledge-direct-intake — `openlogos knowledge apply / index / check` 的判定与写入（功能规格 §2.103.3～§2.103.10，
 * 架构 57.6）。
 *
 * - apply：在项目级排他锁内「恢复 → 读取前态 → 校验 → 提交」。候选批次（项目外临时目录）与已接受内容（磁盘）合成
 *   候选后态，执行判据 1～9；任一不通过整批拒绝、零写入。写入复用 baseline-on-touch 的批次提交与恢复原语，
 *   事务存储在 `logos/.openlogos-runtime/knowledge-apply/`。
 * - index：在同一把锁内重新生成 `INDEX.md`（`missing` 状态拒绝）。
 * - check：在读锁区间内只读诊断全部落盘条目与全部场景，另以 git HEAD 为辅助基准。
 */
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { APPLY_TXN_DIR, applyBaselineClosureBatch, recoverBaselineClosureApply, type PreparedApplyInput } from './baseline-apply.js';
import { computeProposalKnowledgeState, type KnowledgeCandidateState } from './change-lint.js';
import { VERSION } from './json-output.js';
import {
  KNOWLEDGE_DIR,
  KNOWLEDGE_INDEX_FILE,
  KNOWLEDGE_SOURCE_DIR,
  KNOWLEDGE_TAGS_FILE,
  KNOWLEDGE_TAGS_MARKER,
  applyTagCriterion,
  buildKnowledgeView,
  entryTags,
  extractConstraintReferences,
  findDuplicateIds,
  gitHeadKnowledgeEntries,
  parseKnowledgeEntry,
  parseTagTable,
  readKnowledgeDir,
  readScenarioDir,
  readTagStateFacts,
  renderKnowledgeIndex,
  renderTagTable,
  resolveKnowledgeReference,
  resolveTagState,
  tagsOutsideTable,
  type KnowledgeEntry,
  type KnowledgeView,
  type TagState,
  type TagTable,
} from './knowledge-view.js';
import { KNOWLEDGE_TXN_DIR, incompleteMessage, knowledgeTxnDirAbs, testReadBarrier, withKnowledgeReadLock, withKnowledgeWriteLock } from './knowledge-lock.js';

export interface KnowledgeIssue {
  code: string;
  path: string | null;
  message: string;
  fix_hint: string;
}

export interface KnowledgeApplyReport {
  result: 'applied' | 'rejected' | 'unchanged' | 'write_failed' | 'recovered';
  rolled_back?: boolean;
  candidate_dir: string | null;
  tag_state_before: TagState;
  tag_state_after: TagState;
  written: string[];
  errors: KnowledgeIssue[];
  warnings: KnowledgeIssue[];
  exitCode: 0 | 1 | 2;
}

export interface KnowledgeApplyOptions {
  candidateDir?: string | null;
  initTags?: boolean;
  recover?: boolean;
}

const CANONICAL_ENTRY_NAME = /^[a-z][a-z0-9-]*-K\d+-[^/\\]+\.md$/;

const issue = (code: string, path: string | null, message: string, fix_hint: string): KnowledgeIssue => ({ code, path, message, fix_hint });

function sortIssues(list: KnowledgeIssue[]): KnowledgeIssue[] {
  const seen = new Set<string>();
  const out: KnowledgeIssue[] = [];
  for (const i of list) {
    const k = `${i.code}|${i.path}|${i.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(i);
  }
  return out.sort((a, b) => {
    if (a.path !== b.path) {
      if (a.path === null) return 1;
      if (b.path === null) return -1;
      return a.path < b.path ? -1 : 1;
    }
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

function containedPath(candidate: string, base: string): boolean {
  return candidate === base || candidate.startsWith(base.endsWith(sep) ? base : `${base}${sep}`);
}

// ———————————————————————————————— 候选目录（§2.103.3） ————————————————————————————————

interface CandidateBatch {
  dir: string | null;
  entries: Map<string, string>;   // 文件名 → 内容
  tags: string | null;
  sources: Map<string, Buffer>;   // 文件名 → 字节
}

function readCandidate(root: string, rawDir: string | null, initTags: boolean): { batch: CandidateBatch } | { issues: KnowledgeIssue[] } {
  const batch: CandidateBatch = { dir: null, entries: new Map(), tags: null, sources: new Map() };
  if (rawDir === null) {
    if (initTags) return { batch };
    return { issues: [issue('knowledge_apply_input_invalid', null, '缺少候选目录参数', '用法：openlogos knowledge apply <候选目录> [--init-tags]，或 openlogos knowledge apply --init-tags / --recover')] };
  }
  const issues: KnowledgeIssue[] = [];
  const fix = '候选目录只能包含 <module>-KXX-<slug>.md 条目文件、可选的 TAGS.md 与 sources/ 下的原文普通文件';
  let dir: string;
  try {
    dir = realpathSync(rawDir);
    if (!statSync(dir).isDirectory()) throw new Error('not dir');
  } catch {
    return { issues: [issue('knowledge_apply_input_invalid', null, `候选目录不存在或不是目录：${rawDir}`, fix)] };
  }
  batch.dir = dir;
  try {
    const kdir = realpathSync(join(root, ...KNOWLEDGE_DIR.split('/')));
    if (containedPath(dir, kdir)) {
      return { issues: [issue('knowledge_apply_input_invalid', null, `候选目录不能位于 ${KNOWLEDGE_DIR}/ 之内：${rawDir}`, '在项目根之外新建一次性临时目录（如 mktemp -d）作为候选目录')] };
    }
  } catch { /* 知识目录尚不存在 */ }
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const st = lstatSync(abs);
    const cpath = `candidate:${name}`;
    if (st.isSymbolicLink()) { issues.push(issue('knowledge_apply_input_invalid', cpath, `候选目录中不允许 symlink：${name}`, fix)); continue; }
    if (name === 'sources') {
      if (!st.isDirectory()) { issues.push(issue('knowledge_apply_input_invalid', cpath, 'sources 必须是目录', fix)); continue; }
      for (const s of readdirSync(abs).sort()) {
        const sabs = join(abs, s);
        const sst = lstatSync(sabs);
        if (!sst.isFile() || sst.isSymbolicLink()) {
          issues.push(issue('knowledge_apply_input_invalid', `candidate:sources/${s}`, `sources/ 下只允许普通文件：${s}`, fix));
          continue;
        }
        batch.sources.set(s, readFileSync(sabs));
      }
      continue;
    }
    if (!st.isFile()) { issues.push(issue('knowledge_apply_input_invalid', cpath, `候选目录中不允许子目录：${name}`, fix)); continue; }
    if (name === 'TAGS.md') { batch.tags = readFileSync(abs, 'utf-8'); continue; }
    if (name === 'INDEX.md' || name === '.tags-enabled') {
      issues.push(issue('knowledge_apply_input_invalid', cpath, `${name} 由 openlogos 生成，不能出现在候选目录`, fix));
      continue;
    }
    if (CANONICAL_ENTRY_NAME.test(name)) { batch.entries.set(name, readFileSync(abs, 'utf-8')); continue; }
    issues.push(issue('knowledge_apply_input_invalid', cpath, `候选目录中不允许的文件：${name}`, fix));
  }
  if (issues.length === 0 && batch.entries.size === 0 && batch.tags === null && batch.sources.size === 0 && !initTags) {
    issues.push(issue('knowledge_apply_input_invalid', null, `候选目录为空：${rawDir}`, fix));
  }
  return issues.length > 0 ? { issues } : { batch };
}

function readActiveChange(root: string): string | null {
  try {
    const g = JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf-8')) as { activeChange?: unknown };
    return typeof g.activeChange === 'string' && g.activeChange.trim() !== '' ? g.activeChange.trim() : null;
  } catch { return null; }
}

// ———————————————————————————————— 共用比较 ————————————————————————————————

function parseMap(root: string, contents: Map<string, string>, extraSources?: ReadonlySet<string>): KnowledgeEntry[] {
  return [...contents].map(([p, c]) => parseKnowledgeEntry(p, c, { root, extraSources }));
}

/** 禁止删除与退役冻结（§2.102.5）：before → after 同一路径的条目。 */
function retireIssues(before: KnowledgeEntry, beforeContent: string, after: KnowledgeEntry, afterContent: string, path: string, baseLabel: string): KnowledgeIssue[] {
  const out: KnowledgeIssue[] = [];
  if (!before.id) return out;
  const gone = before.rules.filter(r => !after.rules.some(a => a.id === r.id)).map(r => r.id);
  if (after.id !== before.id) {
    out.push(issue('knowledge_removal_forbidden', path, `${before.id}：编号由 ${before.id} 变为 ${after.id ?? '（无）'}（基准：${baseLabel}）`, '已录入的条目与规则不允许删除：退役请把状态改为 deprecated，文件名与编号原样保留'));
  }
  if (gone.length > 0) {
    out.push(issue('knowledge_removal_forbidden', path, `已录入规则 ${[...new Set(gone)].join('、')} 消失（基准：${baseLabel}）`, '已录入的条目与规则不允许删除：退役请把规则行「状态」改为 deprecated'));
  }
  if (before.status === 'deprecated') {
    if (afterContent.replace(/\s+$/, '') !== beforeContent.replace(/\s+$/, '')) {
      out.push(issue('knowledge_retired_id_mutated', path, `已退役条目 ${before.id} 被重新激活或改写（基准：${baseLabel}）`, '恢复退役条目的全部内容；新的业务规则使用新 ID（最大 KXX + 1）'));
    }
    return out;
  }
  for (const rule of before.rules) {
    if (rule.status !== 'deprecated') continue;
    const now = after.rules.find(r => r.id === rule.id);
    if (!now || now.rowText.trim() === rule.rowText.trim()) continue;
    out.push(issue('knowledge_retired_id_mutated', path, `已退役规则 ${rule.id} 被重新激活或改写（基准：${baseLabel}）`, '恢复退役规则行的规则、状态与例外；新的业务规则使用新 ID（该条目最大 Rn + 1）'));
  }
  return out;
}

function resolutionOk(view: KnowledgeView, ref: string): boolean {
  return resolveKnowledgeReference(view, ref).kind === 'ok';
}

function refFailureMessage(view: KnowledgeView, structural: KnowledgeView, ref: string): string {
  const r = resolveKnowledgeReference(view, ref);
  if (r.kind === 'duplicate') return `${ref} 编号重复（${[...new Set(r.paths)].join('、')}）`;
  if (r.kind === 'unknown' && r.reason === 'invalid') {
    const s = resolveKnowledgeReference(structural, ref);
    return s.kind === 'ok' ? `${ref} 目标条目标签不在标签表（${r.entryPath}）` : `${ref} 目标条目结构无效（${r.entryPath}）`;
  }
  return `${ref} 不存在`;
}

// ———————————————————————————————— apply（§2.103.4） ————————————————————————————————

function emptyReport(state: TagState): KnowledgeApplyReport {
  return { result: 'rejected', candidate_dir: null, tag_state_before: state, tag_state_after: state, written: [], errors: [], warnings: [], exitCode: 1 };
}

function testHook(root: string): { afterWrite?(targetPath: string, index: number): void } {
  if (process.env.NODE_ENV !== 'test') return {};
  const failAfter = Number(process.env.OPENLOGOS_TEST_KNOWLEDGE_APPLY_FAIL_AFTER ?? '');
  const barrier = process.env.OPENLOGOS_TEST_KNOWLEDGE_APPLY_BARRIER ?? '';
  const barrierAfter = Number(process.env.OPENLOGOS_TEST_KNOWLEDGE_APPLY_BARRIER_AFTER ?? '');
  if (!Number.isFinite(failAfter) && barrier === '') return {};
  return {
    afterWrite(_targetPath: string, index: number) {
      const n = index + 1;
      if (barrier !== '' && Number.isFinite(barrierAfter) && n === barrierAfter) {
        // 测试屏障：通知已停在第 n 个目标之后，等待放行（UT-S45-41 / UT-S45-38）。
        writeFileSync(`${barrier}.reached`, String(process.pid));
        const deadline = Date.now() + 120_000;
        while (!existsSync(`${barrier}.release`) && Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
      }
      if (Number.isFinite(failAfter) && failAfter > 0 && n === failAfter) {
        if (process.env.OPENLOGOS_TEST_KNOWLEDGE_APPLY_CORRUPT_BACKUP === '1') {
          // 回滚失败路径（UT-S45-38 ③）：删除 backup 使整批回滚无法完成
          rmSync(join(knowledgeTxnDirAbs(root), APPLY_TXN_DIR, 'backup'), { recursive: true, force: true });
        }
        throw new Error(`test fault: 第 ${n} 个目标写入后注入失败`);
      }
    },
  };
}

export function runKnowledgeApply(root: string, opts: KnowledgeApplyOptions): KnowledgeApplyReport {
  const outcome = withKnowledgeWriteLock(root, () => applyLocked(root, opts));
  if (outcome.ok) return outcome.value;
  const state = resolveTagState(readTagStateFacts(root));
  const report = emptyReport(state);
  report.exitCode = 2;
  report.errors = [issue('knowledge_apply_busy', `${KNOWLEDGE_TXN_DIR}/`, '另一个录入正在进行，等待排他锁超时；未做任何恢复或写入', '稍后重跑；不要删除 logos/.openlogos-runtime/ 下的锁或事务文件')];
  return report;
}

function applyLocked(root: string, opts: KnowledgeApplyOptions): KnowledgeApplyReport {
  const txnAbs = knowledgeTxnDirAbs(root);
  mkdirSync(txnAbs, { recursive: true });
  const recovered = recoverBaselineClosureApply(root, txnAbs);
  const factsNow = () => readTagStateFacts(root);
  if (!recovered.ok) {
    const report = emptyReport(resolveTagState(factsNow()));
    report.exitCode = 2;
    report.errors = [issue('knowledge_apply_recover_failed', `${KNOWLEDGE_TXN_DIR}/`, `上一次录入事务无法恢复：${recovered.error}`, '保留事务目录供诊断，把输出交给用户处理')];
    return report;
  }
  if (opts.recover) {
    const state = resolveTagState(factsNow());
    return {
      result: recovered.recovered === 'none' ? 'unchanged' : 'recovered',
      candidate_dir: null, tag_state_before: state, tag_state_after: state, written: [], errors: [], warnings: [], exitCode: 0,
    };
  }

  const read = readCandidate(root, opts.candidateDir ?? null, opts.initTags === true);
  const facts = factsNow();
  const stateBefore = resolveTagState(facts);
  const report = emptyReport(stateBefore);
  if ('issues' in read) {
    report.errors = sortIssues(read.issues);
    return report;
  }
  const batch = read.batch;
  report.candidate_dir = batch.dir;
  const errors: KnowledgeIssue[] = [];
  const warnings: KnowledgeIssue[] = [];

  // —— 前态（已接受内容）——
  const live = readKnowledgeDir(root);
  const beforeEntries = parseMap(root, live);
  const beforeTable: TagTable | null = facts.tags !== null ? parseTagTable(facts.tags) : null;

  // —— 原文（after_sources）——
  const sourceWrites: Array<{ target: string; bytes: Buffer }> = [];
  const extraSources = new Set<string>();
  for (const [name, bytes] of batch.sources) {
    const target = `${KNOWLEDGE_SOURCE_DIR}/${name}`;
    const abs = join(root, ...target.split('/'));
    if (existsSync(abs)) {
      let same = false;
      try { same = lstatSync(abs).isFile() && readFileSync(abs).equals(bytes); } catch { same = false; }
      if (!same) {
        errors.push(issue('knowledge_apply_input_invalid', `candidate:sources/${name}`, `原文 ${target} 已存在且内容不同`, '新版原文使用新文件名（如 -v4），旧版原文继续被旧条目的 source 指向'));
      }
      continue;
    }
    extraSources.add(target);
    sourceWrites.push({ target, bytes });
  }

  // —— 活跃提案视图（proposal_view）——
  const slug = readActiveChange(root);
  let proposal: KnowledgeCandidateState | null = null;
  if (slug) {
    try {
      proposal = computeProposalKnowledgeState(root, slug);
    } catch (e) {
      // code-r1 F3：活跃提案存在但视图不可计算 → 写入前拒绝，不按「无提案」放行
      report.errors = sortIssues([...errors, issue('knowledge_apply_conflict', `logos/changes/${slug}/`,
        e instanceof Error ? e.message : String(e), '修复活跃提案产物的可读性（权限 / IO）后重跑；在此之前无法确认本批与提案知识是否冲突')]);
      return report;
    }
  }
  const proposalActive = proposal !== null && proposal.replay;
  const candidateTargets = new Map<string, string>(); // target → 文件名
  for (const name of batch.entries.keys()) candidateTargets.set(`${KNOWLEDGE_DIR}/${name}`, name);
  if (proposalActive) {
    for (const [target, name] of candidateTargets) {
      if (proposal!.touchedKnowledge.has(target)) {
        errors.push(issue('knowledge_apply_conflict', `candidate:${name}`, `活跃提案 ${slug} 的知识 delta 已修改同名条目 ${target}`, '改在提案内修改该条目，或等提案合并后再录入'));
      }
    }
  }

  // —— 后态 ——
  const afterContent = new Map(live);
  for (const [target, name] of candidateTargets) afterContent.set(target, batch.entries.get(name)!);
  const afterEntries = parseMap(root, afterContent, extraSources);
  const afterByPath = new Map(afterEntries.map(e => [e.path, e]));
  const pvBeforeContent = proposalActive ? new Map(proposal!.candidate) : new Map(live);
  const pvAfterContent = new Map(pvBeforeContent);
  for (const [target, name] of candidateTargets) {
    if (proposalActive && proposal!.touchedKnowledge.has(target)) continue;
    pvAfterContent.set(target, batch.entries.get(name)!);
  }
  const pvAfterEntries = parseMap(root, pvAfterContent, extraSources);
  const pvDeltaEntries = proposalActive ? pvAfterEntries.filter(e => proposal!.touchedKnowledge.has(e.path)) : [];

  const sourcesOnly = batch.entries.size === 0 && batch.tags === null && opts.initTags !== true;

  // 判据 2：词表可用
  if (stateBefore === 'missing' && batch.tags === null && opts.initTags !== true) {
    errors.push(issue('knowledge_tags_missing', KNOWLEDGE_TAGS_FILE, `标签表已启用但 ${KNOWLEDGE_TAGS_FILE} 丢失`, '从 git 恢复 TAGS.md，或在候选目录放入完整 TAGS.md，或运行 openlogos knowledge apply --init-tags'));
  }

  // —— after_tags（§2.103.4 / §2.103.6）——
  const tagSourceEntries = [...afterEntries, ...pvDeltaEntries].filter(e => e.valid);
  const allTags = tagSourceEntries.flatMap(entryTags);
  let afterTagsText: string | null = facts.tags;
  let stateAfter: TagState = stateBefore;
  let reinitTags: string[] = [];
  if (sourcesOnly) {
    // 只含 sources/ 的批次不触发启用、不改写标签表与索引（§2.103.5）
  } else if (batch.tags !== null) {
    if (stateBefore === 'never') {
      const base = parseTagTable(batch.tags);
      afterTagsText = base.problems.length > 0 ? batch.tags : renderTagTable(allTags, base);
    } else {
      afterTagsText = batch.tags;
    }
    stateAfter = 'enabled';
  } else if (stateBefore === 'enabled') {
    afterTagsText = facts.tags;
  } else if (stateBefore === 'never' || opts.initTags === true) {
    afterTagsText = renderTagTable(allTags, null);
    stateAfter = 'enabled';
    if (stateBefore === 'missing') reinitTags = [...new Set(allTags)].sort();
  }
  const afterTable: TagTable | null = afterTagsText !== null ? parseTagTable(afterTagsText) : null;
  // 判据 4：对实际生效的 after_tags 执行格式判据（code-r1 F2）——候选词表与沿用的落盘词表一视同仁，诊断区分来源
  if (afterTable && afterTable.problems.length > 0) {
    const fromCandidate = batch.tags !== null;
    for (const p of afterTable.problems) {
      errors.push(issue('knowledge_tags_invalid', fromCandidate ? 'candidate:TAGS.md' : KNOWLEDGE_TAGS_FILE,
        fromCandidate ? p : `落盘标签表格式错误：${p}`,
        fromCandidate
          ? '标签表首个表格表头为「标签 | 别名 | 说明」；标签不能为空或重复；别名不能与其他行的标签或别名相同'
          : '在候选目录放入修正后的完整 TAGS.md 一并录入（或从 git 恢复 TAGS.md）'));
    }
  }
  const tableUsable = afterTable !== null && afterTable.problems.length === 0;

  // 判据 3：结构有效
  for (const [target, name] of candidateTargets) {
    const e = afterByPath.get(target)!;
    if (!e.valid) {
      errors.push(issue('knowledge_entry_invalid', `candidate:${name}`, `知识条目 ${name} 结构无效：${e.problems.join('；')}`,
        `按条目模板补齐：H1 以 KXX 开头；「元数据」YAML 含合法 type / scope / status、非空 tags、source（path 指向 ${KNOWLEDGE_SOURCE_DIR}/ 内原文或本批 sources/、version 非空）`));
    }
  }

  // 判据 5：标签判据
  if (stateAfter === 'enabled' && tableUsable) {
    for (const [target, name] of candidateTargets) {
      const e = afterByPath.get(target)!;
      if (!e.meta) continue; // 元数据不可解析时只报结构问题；结构有其他缺项时标签仍一并检查，便于一次修正
      const outside = tagsOutsideTable(e, afterTable!);
      if (outside.length > 0) {
        errors.push(issue('knowledge_tag_unknown', `candidate:${name}`, `知识条目 ${e.id} 的标签不在标签表：${outside.join('、')}`, '改用标签表中的标签或别名，或在同批 TAGS.md 中加入该标签'));
      }
    }
    if (afterTagsText !== facts.tags) {
      const keepers = [...afterEntries.filter(e => !candidateTargets.has(e.path)), ...pvDeltaEntries];
      for (const e of keepers) {
        if (!e.valid) continue;
        const shouldKeep = stateBefore === 'enabled' ? (beforeTable !== null && beforeTable.problems.length === 0 && tagsOutsideTable(e, beforeTable).length === 0) : true;
        if (!shouldKeep) continue;
        const outside = tagsOutsideTable(e, afterTable!);
        if (outside.length === 0) continue;
        const path = proposalActive && proposal!.deltaRelByTarget.has(e.path) ? proposal!.deltaRelByTarget.get(e.path)! : e.path;
        errors.push(issue('knowledge_tag_unknown', path, `条目 ${e.id} 的标签 ${outside.join('、')} 不在新的标签表中`, '新的 TAGS.md 必须保留仍被条目使用的标签（含活跃提案知识 delta 中的条目）'));
      }
    }
  }

  // 判据 6：编号唯一——在 after_entries 全集与 proposal_view 全集上检查（code-r1 F5）。磁盘既有重号同样阻断本批，
  // 诊断指向涉及的候选（若有）或磁盘来源；只由活跃提案 delta 引起的重号报 knowledge_apply_conflict。
  const candidatePathSet = new Set(candidateTargets.keys());
  const pathLabel = (p: string) => (candidatePathSet.has(p) ? `candidate:${candidateTargets.get(p)}` : p);
  const afterDups = findDuplicateIds(buildKnowledgeView(afterEntries));
  const afterDupIds = new Set(afterDups.map(d => d.id));
  for (const d of afterDups) {
    const paths = [...new Set(d.paths)];
    const anchor = paths.find(p => candidatePathSet.has(p)) ?? paths[0];
    errors.push(issue('knowledge_id_duplicate', pathLabel(anchor),
      paths.length > 1 ? `知识编号 ${d.id} 重复：${paths.join('、')}` : `知识规则编号 ${d.id} 在 ${anchor} 内重复出现`,
      candidatePathSet.has(anchor) ? '改用当前最大 KXX + 1（条目内新规则取最大 Rn + 1）' : '已录入条目存在重号：先修复重号（knowledge check 可定位）后再录入'));
  }
  if (proposalActive) {
    const pvDups = findDuplicateIds(buildKnowledgeView(pvAfterEntries)).filter(d => !afterDupIds.has(d.id));
    for (const d of pvDups) {
      const paths = [...new Set(d.paths)];
      const anchor = paths.find(p => candidatePathSet.has(p)) ?? paths[0];
      errors.push(issue('knowledge_apply_conflict', pathLabel(anchor), `编号 ${d.id} 在活跃提案 ${slug} 的有效知识视图中重复：${paths.join('、')}`, '改用其他编号，或改在提案内修改，或等提案合并后再录入'));
    }
  }

  // 判据 7、8：禁止删除与退役冻结（基准 = 本次 apply 前已接受的内容）
  for (const [target, name] of candidateTargets) {
    const beforeContent = live.get(target);
    if (beforeContent === undefined) continue;
    const before = beforeEntries.find(e => e.path === target)!;
    errors.push(...retireIssues(before, beforeContent, afterByPath.get(target)!, batch.entries.get(name)!, `candidate:${name}`, '本次录入前已接受的内容'));
  }

  // 判据 9：受影响引用（配对视图）
  const viewFor = (entries: KnowledgeEntry[], state: TagState, table: TagTable | null): KnowledgeView => {
    const v = buildKnowledgeView(entries);
    return state === 'enabled' && table && table.problems.length === 0 ? applyTagCriterion(v, state, table) : v;
  };
  const beforeView = viewFor(beforeEntries, stateBefore === 'missing' ? 'never' : stateBefore, beforeTable);
  const afterStructural = buildKnowledgeView(afterEntries);
  const afterView = viewFor(afterEntries, stateAfter, afterTable);
  for (const [scPath, content] of readScenarioDir(root)) {
    for (const ref of extractConstraintReferences(content)) {
      if (!resolutionOk(beforeView, ref.ref) || resolutionOk(afterView, ref.ref)) continue;
      errors.push(issue('knowledge_reference_unknown', scPath, `${scPath}:${ref.line} 引用的 ${refFailureMessage(afterView, afterStructural, ref.ref)}（本批录入后）`, '本批不得删除、退役改写或使仍被引用的条目失效；补齐标签表或恢复条目内容'));
    }
  }
  if (proposalActive) {
    const pvBeforeEntries = parseMap(root, pvBeforeContent);
    const pvBeforeView = viewFor(pvBeforeEntries, stateBefore === 'missing' ? 'never' : stateBefore, beforeTable);
    const pvAfterStructural = buildKnowledgeView(pvAfterEntries);
    const pvAfterView = viewFor(pvAfterEntries, stateAfter, afterTable);
    for (const sc of proposal!.scenarios) {
      for (const ref of extractConstraintReferences(sc.content)) {
        if (!resolutionOk(pvBeforeView, ref.ref) || resolutionOk(pvAfterView, ref.ref)) continue;
        errors.push(issue('knowledge_reference_unknown', sc.deltaRel, `${sc.target}:${ref.line} 引用的 ${refFailureMessage(pvAfterView, pvAfterStructural, ref.ref)}（本批录入后，活跃提案 ${slug}）`, '本批不得使活跃提案仍在引用的条目失效；补齐标签表或恢复条目内容'));
      }
    }
  }

  // warnings
  if (afterTable && (batch.tags !== null || afterTagsText !== facts.tags)) {
    for (const syn of afterTable.synonyms) warnings.push(issue('knowledge_tag_synonym', KNOWLEDGE_TAGS_FILE, `疑似同义标签：${syn}`, '由标签表负责人决定是否合并为一行（另一个写作别名）；openlogos 不自动合并'));
  }
  if (reinitTags.length > 0) {
    warnings.push(issue('knowledge_tag_synonym', KNOWLEDGE_TAGS_FILE, `标签表由现存条目重新初始化，以下标签由条目反推进表，请负责人复核：${reinitTags.join('、')}`, '复核 TAGS.md；不需要的标签可在后续录入中调整'));
  }

  report.warnings = sortIssues(warnings);
  report.tag_state_after = stateAfter;
  if (errors.length > 0) {
    report.errors = sortIssues(errors);
    report.tag_state_after = stateBefore;
    return report;
  }

  // —— 写入集合 ——
  const inputs: PreparedApplyInput[] = [];
  const exists = (rel: string) => existsSync(join(root, ...rel.split('/')));
  for (const s of sourceWrites) inputs.push({ kind: 'prepared', targetPath: s.target, mode: 'CREATE', bytes: s.bytes });
  for (const [target, name] of [...candidateTargets].sort()) {
    const content = batch.entries.get(name)!;
    if (live.get(target) === content) continue;
    inputs.push({ kind: 'prepared', targetPath: target, mode: live.has(target) ? 'MODIFY' : 'CREATE', bytes: content });
  }
  if (!sourcesOnly) {
    if (afterTagsText !== null && afterTagsText !== facts.tags) {
      inputs.push({ kind: 'prepared', targetPath: KNOWLEDGE_TAGS_FILE, mode: exists(KNOWLEDGE_TAGS_FILE) ? 'MODIFY' : 'CREATE', bytes: afterTagsText });
    }
    if (stateAfter === 'enabled' && !facts.marker) {
      inputs.push({
        kind: 'prepared', targetPath: KNOWLEDGE_TAGS_MARKER, mode: 'CREATE',
        bytes: `${JSON.stringify({ schema: 'openlogos/knowledge-tags-enabled@1', enabled_at: new Date().toISOString(), cli_version: VERSION })}\n`,
      });
    }
    const index = renderKnowledgeIndex(afterEntries, stateAfter);
    let currentIndex: string | null = null;
    try { currentIndex = readFileSync(join(root, ...KNOWLEDGE_INDEX_FILE.split('/')), 'utf-8'); } catch { currentIndex = null; }
    if (currentIndex !== index) inputs.push({ kind: 'prepared', targetPath: KNOWLEDGE_INDEX_FILE, mode: currentIndex === null ? 'CREATE' : 'MODIFY', bytes: index });
  }
  if (inputs.length === 0) {
    report.result = 'unchanged';
    report.exitCode = 0;
    return report;
  }
  const committed = applyBaselineClosureBatch(root, txnAbs, inputs, testHook(root));
  if (committed.ok) {
    report.result = 'applied';
    report.exitCode = 0;
    report.written = committed.applied.map(a => a.target_path);
    return report;
  }
  report.result = 'write_failed';
  report.rolled_back = committed.rolled_back;
  report.exitCode = 2;
  report.tag_state_after = stateBefore;
  const errs = [issue('knowledge_apply_write_failed', `${KNOWLEDGE_TXN_DIR}/`, `写入失败：${committed.error}${committed.rolled_back ? '；已整批回滚，项目文件与执行前一致' : ''}`, '排查磁盘与权限后重跑')];
  if (!committed.rolled_back) {
    errs.push(issue('knowledge_apply_recover_failed', `${KNOWLEDGE_TXN_DIR}/`, '整批回滚未完成，事务日志已保留', '运行 openlogos knowledge apply --recover；仍失败时把输出交给用户处理'));
  }
  report.errors = sortIssues(errs);
  return report;
}

// ———————————————————————————————— index（§2.103.7） ————————————————————————————————

export interface KnowledgeIndexReport {
  result: 'written' | 'unchanged' | 'rejected';
  path: string;
  entries: number;
  tag_state: TagState;
  errors: KnowledgeIssue[];
  exitCode: 0 | 1 | 2;
}

export function runKnowledgeIndex(root: string): KnowledgeIndexReport {
  const outcome = withKnowledgeWriteLock(root, (): KnowledgeIndexReport => {
    const txnAbs = knowledgeTxnDirAbs(root);
    mkdirSync(txnAbs, { recursive: true });
    const recovered = recoverBaselineClosureApply(root, txnAbs);
    const state = resolveTagState(readTagStateFacts(root));
    const base = { path: KNOWLEDGE_INDEX_FILE, tag_state: state };
    if (!recovered.ok) {
      return { ...base, result: 'rejected', entries: 0, exitCode: 2, errors: [issue('knowledge_apply_recover_failed', `${KNOWLEDGE_TXN_DIR}/`, `上一次录入事务无法恢复：${recovered.error}`, '保留事务目录供诊断，把输出交给用户处理')] };
    }
    const live = readKnowledgeDir(root);
    if (state === 'missing') {
      return { ...base, result: 'rejected', entries: live.size, exitCode: 1, errors: [issue('knowledge_tags_missing', KNOWLEDGE_TAGS_FILE, `标签表已启用但 ${KNOWLEDGE_TAGS_FILE} 丢失，拒绝重新生成索引`, '先从 git 恢复 TAGS.md，或经 openlogos knowledge apply 提交完整 TAGS.md / 运行 --init-tags')] };
    }
    const index = renderKnowledgeIndex(parseMap(root, live), state);
    let current: string | null = null;
    try { current = readFileSync(join(root, ...KNOWLEDGE_INDEX_FILE.split('/')), 'utf-8'); } catch { current = null; }
    if (current === index) return { ...base, result: 'unchanged', entries: live.size, exitCode: 0, errors: [] };
    const committed = applyBaselineClosureBatch(root, txnAbs, [{ kind: 'prepared', targetPath: KNOWLEDGE_INDEX_FILE, mode: current === null ? 'CREATE' : 'MODIFY', bytes: index }]);
    if (!committed.ok) {
      return { ...base, result: 'rejected', entries: live.size, exitCode: 2, errors: [issue('knowledge_apply_write_failed', `${KNOWLEDGE_TXN_DIR}/`, `写入 INDEX.md 失败：${committed.error}`, '排查磁盘与权限后重跑')] };
    }
    return { ...base, result: 'written', entries: live.size, exitCode: 0, errors: [] };
  });
  if (outcome.ok) return outcome.value;
  return {
    result: 'rejected', path: KNOWLEDGE_INDEX_FILE, entries: 0, tag_state: resolveTagState(readTagStateFacts(root)), exitCode: 2,
    errors: [issue('knowledge_apply_busy', `${KNOWLEDGE_TXN_DIR}/`, '另一个录入正在进行，等待排他锁超时；未做任何恢复或写入', '稍后重跑')],
  };
}

// ———————————————————————————————— check（§2.103.10） ————————————————————————————————

export interface KnowledgeCheckReport {
  tag_state: TagState;
  entries: number;
  head_compare: 'ok' | 'unavailable';
  errors: KnowledgeIssue[];
  warnings: KnowledgeIssue[];
  exitCode: 0 | 1;
}

/** 全库诊断（不取锁；调用方负责读锁区间）。`head: false` 时跳过 git HEAD 辅助比较（status / next 提示）。 */
export function runKnowledgeCheckUnlocked(root: string, opts: { head?: boolean } = {}): KnowledgeCheckReport {
  const errors: KnowledgeIssue[] = [];
  const warnings: KnowledgeIssue[] = [];
  const facts = readTagStateFacts(root);
  const state = resolveTagState(facts);
  const table = state === 'enabled' && facts.tags !== null ? parseTagTable(facts.tags) : null;
  const live = readKnowledgeDir(root);
  const entries = parseMap(root, live);

  for (const e of entries) {
    if (!e.valid) errors.push(issue('knowledge_entry_invalid', e.path, `知识条目结构无效：${e.problems.join('；')}`, '经 openlogos knowledge apply 提交修正后的完整条目'));
  }
  for (const d of findDuplicateIds(buildKnowledgeView(entries))) {
    const paths = [...new Set(d.paths)];
    errors.push(issue('knowledge_id_duplicate', paths[0], paths.length > 1 ? `知识编号 ${d.id} 重复：${paths.join('、')}` : `知识规则编号 ${d.id} 在 ${paths[0]} 内重复出现`, '把后录入的条目重编号为当前最大 KXX + 1，并同步改写引用'));
  }
  if (state === 'missing') {
    errors.push(issue('knowledge_tags_missing', KNOWLEDGE_TAGS_FILE, `标签表已启用但 ${KNOWLEDGE_TAGS_FILE} 丢失`, '从 git 恢复 TAGS.md，或经 openlogos knowledge apply 提交完整 TAGS.md，或运行 openlogos knowledge apply --init-tags'));
  }
  if (table) {
    for (const p of table.problems) errors.push(issue('knowledge_tags_invalid', KNOWLEDGE_TAGS_FILE, p, '经 openlogos knowledge apply 提交修正后的完整 TAGS.md'));
    if (table.problems.length === 0) {
      for (const e of entries) {
        if (!e.valid) continue;
        const outside = tagsOutsideTable(e, table);
        if (outside.length > 0) errors.push(issue('knowledge_tag_unknown', e.path, `条目 ${e.id} 的标签不在标签表：${outside.join('、')}`, '改用标签表中的标签或别名，或经 apply 把标签加入 TAGS.md'));
      }
    }
    for (const syn of table.synonyms) warnings.push(issue('knowledge_tag_synonym', KNOWLEDGE_TAGS_FILE, `疑似同义标签：${syn}`, '由标签表负责人决定是否合并'));
  }

  const structural = buildKnowledgeView(entries);
  const view = table && table.problems.length === 0 ? applyTagCriterion(structural, state, table) : structural;
  for (const [scPath, content] of readScenarioDir(root)) {
    for (const ref of extractConstraintReferences(content)) {
      const r = resolveKnowledgeReference(view, ref.ref);
      if (r.kind === 'duplicate') continue; // 已按重号报告
      if (r.kind === 'unknown') {
        errors.push(issue('knowledge_reference_unknown', scPath, `${scPath}:${ref.line} 引用的 ${refFailureMessage(view, structural, ref.ref)}`, '核对引用；目标条目无效时经 apply 修正'));
      } else if (r.deprecated) {
        warnings.push(issue('knowledge_reference_deprecated', scPath, `${scPath}:${ref.line} 引用的 ${ref.ref} 已退役（deprecated）`, '确认是否仍应遵守已退役的知识；需要新规则时引用新 ID'));
      }
    }
  }

  // git HEAD 辅助基准：人工编辑绕过 apply 造成的删除与退役改写
  const head = opts.head === false ? null : gitHeadKnowledgeEntries(root);
  if (head !== null) {
    for (const [p, headContent] of head) {
      const before = parseKnowledgeEntry(p, headContent);
      const nowContent = live.get(p);
      if (nowContent === undefined) {
        if (before.id) errors.push(issue('knowledge_removal_forbidden', p, `${before.id} 在 git HEAD 中存在，磁盘上已被删除（基准：HEAD）`, '从 git 恢复该条目；退役请改状态为 deprecated'));
        continue;
      }
      const now = entries.find(e => e.path === p)!;
      errors.push(...retireIssues(before, headContent, now, nowContent, p, 'git HEAD'));
    }
  }

  // 索引过期（warning，不拦截）
  let currentIndex: string | null = null;
  try { currentIndex = readFileSync(join(root, ...KNOWLEDGE_INDEX_FILE.split('/')), 'utf-8'); } catch { currentIndex = null; }
  if (live.size > 0 || currentIndex !== null) {
    if (currentIndex !== renderKnowledgeIndex(entries, state)) {
      warnings.push(issue('knowledge_index_stale', KNOWLEDGE_INDEX_FILE, currentIndex === null ? 'INDEX.md 缺失' : 'INDEX.md 与条目不一致', '运行 openlogos knowledge index 刷新'));
    }
  }

  const sortedErrors = sortIssues(errors);
  return {
    tag_state: state, entries: live.size, head_compare: head === null ? 'unavailable' : 'ok',
    errors: sortedErrors, warnings: sortIssues(warnings), exitCode: sortedErrors.length > 0 ? 1 : 0,
  };
}

export interface KnowledgeCheckBusy { busy: true; errors: KnowledgeIssue[]; exitCode: 1 }

export function runKnowledgeCheck(root: string): KnowledgeCheckReport | KnowledgeCheckBusy {
  // 全部诊断读取都在同一读锁区间内完成（code-r1 F4）：发现未完成事务时仍在锁内诊断并追加该错误
  const outcome = withKnowledgeReadLock(root, () => { testReadBarrier(); return runKnowledgeCheckUnlocked(root); }, { runWhenIncomplete: true });
  if (!outcome.ok) {
    // 取锁超时：只输出错误，不在锁外读取任何知识文件
    return { busy: true, exitCode: 1, errors: [issue('knowledge_apply_incomplete', `${KNOWLEDGE_TXN_DIR}/`, `企业知识录入事务未完成：${incompleteMessage(outcome.reason)}`, '等待另一个录入完成后重跑')] };
  }
  const report = outcome.value;
  if (outcome.incomplete) {
    report.errors = sortIssues([...report.errors, issue('knowledge_apply_incomplete', `${KNOWLEDGE_TXN_DIR}/`, `企业知识录入事务未完成：${incompleteMessage('incomplete')}`, '运行 openlogos knowledge apply --recover')]);
    report.exitCode = 1;
  }
  return report;
}
