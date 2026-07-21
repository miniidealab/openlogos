/**
 * ui-provenance — proposal-ui-ux-first 切片2 共享库：落盘完整性防漂移。
 *
 * F3/F4/F1（freshness）契约：
 * - `PLAN_APPROVED` = 存在性 marker + 可选 JSON body 的向后兼容超集（空 marker 仍合法）；
 * - provenance 绑定 pages + 逐文件内容 hash，防批准后漂移；
 * - 严格性以**持久化 `PLAN_APPROVED` provenance 为键**（F4 R7），不读会话 capability；
 * - `check-ui-hash-match` / merge 命令级 gate / `commitVerifiedPrototypes()` 三处一致三分支：
 *     full（含 UI provenance）→ 匹配 exit0 / 失配·损坏 fail closed；
 *     legacy（旧空 marker 无曾渲染证据）→ 记 advisory exit0；
 *     partial（有 ui_prototype_rendered 无 hashes）→ fail closed。
 * - 原型资产落盘唯一入口 `commitVerifiedPrototypes()`：三段事务（校验 staged 字节→原子 rename→失败零残留）
 *   + commit journal 崩溃前滚/回滚 + 落盘后复核。
 */
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync,
  renameSync, copyFileSync, statSync,
} from 'node:fs';
import { join, basename, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { isValidPrototypeBasename, readUiUxDeclaration } from './ui-first.js';

export const PLAN_APPROVED = 'PLAN_APPROVED';
export const COMMIT_JOURNAL = 'UI_COMMIT_JOURNAL.json';
const STAGING_DIR = '.ui-commit-staging';
const BACKUP_DIR = '.ui-commit-backup';

/** 原型资产在提案 delta 下的相对路径（源）与 resources 落盘目标（相对项目根）。 */
export const PROTOTYPE_DELTA_SUBPATH = join('deltas', 'prd', '2-product-design', '2-page-design');
export const PROTOTYPE_RESOURCE_SUBPATH = join('logos', 'resources', 'prd', '2-product-design', '2-page-design');

export interface PlanApprovedProvenance {
  present: boolean;              // PLAN_APPROVED marker 是否存在
  empty: boolean;               // 存在但 body 为空（合法空 marker）
  ui_prototype_rendered?: boolean;
  pages?: string[];
  hashes?: Record<string, string>;
  /**
   * F3（code-r2）：原始记录**损坏**标志——pages/hashes/rendered 存在非法成员或类型不符
   * （非字符串 page、非字符串/非 64-hex hash value、rendered 非布尔等）。**不静默过滤**：
   * 一旦置真，classifyProvenance 对「rendered:true」记录一律判 partial（fail closed），
   * 杜绝「过滤掉非法成员后把损坏记录重新解释为 full」。
   */
  malformed?: boolean;
  raw?: unknown;
}

export type ProvenanceClass = 'full' | 'legacy' | 'partial';

const SHA256_RE = /^[0-9a-f]{64}$/i;

/** 读 PLAN_APPROVED marker 及其可选 JSON body（向后兼容：空 marker 合法）。 */
export function readPlanApproved(proposalDir: string): PlanApprovedProvenance {
  const p = join(proposalDir, PLAN_APPROVED);
  if (!existsSync(p)) return { present: false, empty: true };
  const content = readFileSync(p, 'utf-8');
  if (content.trim() === '') return { present: true, empty: true };
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    // 非 JSON body：按空 marker 语义兼容（不宣称 UI 已确认）
    return { present: true, empty: true, raw: content };
  }
  const rec = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const prov: PlanApprovedProvenance = { present: true, empty: false, raw };

  // ui_prototype_rendered：布尔才采信；存在但非布尔 → malformed
  if (typeof rec.ui_prototype_rendered === 'boolean') prov.ui_prototype_rendered = rec.ui_prototype_rendered;
  else if (rec.ui_prototype_rendered !== undefined) prov.malformed = true;

  // pages：必须是纯字符串数组；存在任一非字符串成员或非数组 → malformed（保留可解析部分供诊断，但不据此判 full）
  if (rec.pages !== undefined) {
    if (!Array.isArray(rec.pages) || rec.pages.some(x => typeof x !== 'string')) prov.malformed = true;
    prov.pages = Array.isArray(rec.pages) ? rec.pages.filter((x): x is string => typeof x === 'string') : [];
  }

  // hashes：必须是 {basename: 64-hex sha256}；非对象、非字符串 value、或非法 hash 格式 → malformed
  if (rec.hashes !== undefined) {
    if (!rec.hashes || typeof rec.hashes !== 'object' || Array.isArray(rec.hashes)) {
      prov.malformed = true;
    } else {
      const h: Record<string, string> = {};
      for (const [k, v] of Object.entries(rec.hashes as Record<string, unknown>)) {
        if (typeof v !== 'string' || !SHA256_RE.test(v)) { prov.malformed = true; continue; }
        h[k] = v;
      }
      prov.hashes = h;
    }
  }
  return prov;
}

/**
 * 写 PLAN_APPROVED（向后兼容超集）：
 * - 无 provenance → 空写（仅当文件不存在时写空，保持存在性语义、不覆盖已有 body）；
 * - 有 provenance → 写 JSON body（`{ui_prototype_rendered, pages, hashes}`）。
 */
export function writePlanApprovedMarker(
  proposalDir: string,
  provenance?: { ui_prototype_rendered: boolean; pages: string[]; hashes: Record<string, string> } | null,
): void {
  const p = join(proposalDir, PLAN_APPROVED);
  if (!provenance) {
    if (!existsSync(p)) writeFileSync(p, '');
    return;
  }
  writeFileSync(p, JSON.stringify(provenance, null, 2) + '\n');
}

/**
 * 分类持久化批准记录：
 * - full   = ui_prototype_rendered:true 且 hashes 非空（曾渲染确认）；
 * - partial= ui_prototype_rendered:true 但缺/空 hashes（部分 provenance，不得误判 legacy）；
 * - legacy = 无「曾渲染」证据（空 marker / 无 ui_prototype_rendered / 缺 marker）。
 */
export function classifyProvenance(prov: PlanApprovedProvenance): ProvenanceClass {
  const rendered = prov.ui_prototype_rendered === true;
  if (!rendered) return 'legacy';
  // F3：损坏原始记录（存在非法成员）一律 partial（fail closed），不得过滤后重判 full。
  if (prov.malformed) return 'partial';
  // rendered:true → 只有 pages + hashes 结构均合法且互为同一 basename 集合才判 full；否则 partial（fail closed）。
  return isFullProvenanceValid(prov) ? 'full' : 'partial';
}

/**
 * full provenance 的结构完整性（F3）：rendered:true 之外还要求——
 * hashes 非空、pages 非空、pages/hashes 键均为合法 basename 且无重复、pages 集合 == hashes 键集合。
 * 任一不满足 ⇒ 非 full（归 partial，fail closed），杜绝「有 hashes 无 pages / pages 与 hashes 脱钩」的损坏批准记录被放行。
 */
export function isFullProvenanceValid(prov: PlanApprovedProvenance): boolean {
  const hashes = prov.hashes ?? {};
  const pages = prov.pages ?? [];
  const hashKeys = Object.keys(hashes);
  if (hashKeys.length === 0) return false;
  if (pages.length === 0) return false;
  const pageSet = new Set<string>();
  for (const p of pages) {
    if (!isValidPrototypeBasename(p)) return false;   // 非法/路径穿越 basename
    if (pageSet.has(p)) return false;                  // 重复
    pageSet.add(p);
  }
  for (const k of hashKeys) {
    if (!isValidPrototypeBasename(k)) return false;
  }
  // pages 集合 == hashes 键集合
  const a = [...pageSet].sort();
  const b = [...hashKeys].sort();
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) return false;
  return true;
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** 计算目录下所有 .html 原型的 {basename: sha256}。 */
export function computePrototypeHashes(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.html')) continue;
    const full = join(dir, entry);
    try {
      if (statSync(full).isFile()) out[entry] = sha256(full);
    } catch { /* ignore */ }
  }
  return out;
}

export interface HashMatchResult {
  ok: boolean;
  advisory: boolean;
  cls: ProvenanceClass;
  code: string; // machine reason
  detail?: string;
}

/**
 * check-ui-hash-match 三分支（与 merge/落盘一致，键=持久化 PLAN_APPROVED）：
 * - full  : 重算 sourceDir 现值 hash 与 prov.hashes 逐一比对 → 全匹配 ok；缺失/损坏/失配 fail closed。
 * - legacy: 记 advisory 后 ok（不要求 hashes、不阻断）。
 * - partial: fail closed（曾宣称渲染却缺 hashes 无法追溯）。
 * sourceDir 默认 = proposalDir/deltas/.../2-page-design（merge 前的原型 delta 源）。
 */
export function checkUiHashMatch(proposalDir: string, sourceDir?: string): HashMatchResult {
  const prov = readPlanApproved(proposalDir);
  const cls = classifyProvenance(prov);
  if (cls === 'legacy') {
    return { ok: true, advisory: true, cls, code: 'legacy_advisory' };
  }
  if (cls === 'partial') {
    return { ok: false, advisory: false, cls, code: 'partial_provenance_fail_closed', detail: 'ui_prototype_rendered:true 但缺 hashes' };
  }
  // full（F3）：批准页清单必须与 proposal 声明页集合一致（basename 集合），杜绝「确认清单 A、提交内容 B」脱钩。
  const decl = readUiUxDeclaration(proposalDir);
  if (decl.present && decl.ui_impact) {
    const declSet = [...new Set(decl.pages.map(p => p.prototype))].sort();
    const provSet = [...new Set(prov.pages ?? [])].sort();
    if (declSet.length !== provSet.length || declSet.some((x, i) => x !== provSet[i])) {
      return { ok: false, advisory: false, cls, code: 'pages_declaration_mismatch', detail: `declared [${declSet}] approved [${provSet}]` };
    }
  }
  // full：逐文件重算比对（现值 hash 与固化 hashes；键集合已由 classifyProvenance 保证 == pages 集合）
  const dir = sourceDir ?? join(proposalDir, PROTOTYPE_DELTA_SUBPATH);
  const current = computePrototypeHashes(dir);
  const expected = prov.hashes ?? {};
  const expKeys = Object.keys(expected).sort();
  const curKeys = Object.keys(current).sort();
  if (expKeys.length !== curKeys.length || expKeys.some((k, i) => k !== curKeys[i])) {
    return { ok: false, advisory: false, cls, code: 'hash_set_mismatch', detail: `expected [${expKeys}] got [${curKeys}]` };
  }
  for (const k of expKeys) {
    if (current[k] !== expected[k]) {
      return { ok: false, advisory: false, cls, code: 'hash_content_mismatch', detail: `drift on ${k}` };
    }
  }
  return { ok: true, advisory: false, cls, code: 'match' };
}

// ── 事务性原子落盘：commitVerifiedPrototypes ──

export interface CommitResult {
  ok: boolean;
  advisory: boolean;
  cls: ProvenanceClass;
  committed: string[];     // 已落盘 basename
  reason?: string;
  rolledBack?: boolean;
}

interface JournalEntry { basename: string; staged: string; target: string; backup: string | null; done: boolean; }
/**
 * F1（code-r5）：journal 增顶层 `intent`（commit / abort）——单个 `done` 布尔无法区分「正向提交中」与「回滚中」，
 * 且 rename 与 done 落盘之间存在崩溃窗口（target 已替换、staged 已消失、磁盘仍 done:false）。
 * 恢复据 `intent` 决定方向、并**据文件系统真实状态**（staged 是否还在 = rename 是否已发生）判定每项，绝不忽略已替换 target。
 */
interface Journal { intent: 'commit' | 'abort'; targets: JournalEntry[]; }

function ensureDir(d: string): void { mkdirSync(d, { recursive: true }); }

/** 原子写 commit journal（F1，code-r2）：临时文件 + 原子 rename，避免覆盖写中途崩溃导致 journal 截断。 */
function writeJournalAtomic(path: string, journal: Journal): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(journal, null, 2));
  renameSync(tmp, path);
}
function safeRename(from: string, to: string): void {
  try { renameSync(from, to); }
  catch (e) {
    // 跨设备回退：复制 + 删除
    if ((e as NodeJS.ErrnoException).code === 'EXDEV') { copyFileSync(from, to); rmSync(from, { force: true }); }
    else throw e;
  }
}

/**
 * 原型资产落盘的**唯一命名入口**。三段事务：
 * ① 全量校验 staged 字节（先把源拷入私有 staging，对 staged 副本算 hash 比对 PLAN_APPROVED.hashes，
 *    任一不符即在写入任何 target 前 abort，消除 verify-to-stage 竞态）；
 * ② 写 commit journal；③ 逐条原子 rename 提交（失败回滚，恢复 backup、删 staging）。
 * 落盘后复核 target hash。全有或全无、失败零残留。
 * mode 由持久化 provenance 决定：full 严格 hash 校验；legacy advisory（同一入口、不做严格校验）；partial 直接 abort。
 */
export function commitVerifiedPrototypes(proposalDir: string, root: string): CommitResult {
  const prov = readPlanApproved(proposalDir);
  const cls = classifyProvenance(prov);
  const sourceDir = join(proposalDir, PROTOTYPE_DELTA_SUBPATH);
  const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH);
  const stagingDir = join(proposalDir, STAGING_DIR);
  const backupDir = join(proposalDir, BACKUP_DIR);

  if (cls === 'partial') {
    return { ok: false, advisory: false, cls, committed: [], reason: 'partial_provenance_fail_closed' };
  }

  const sources = existsSync(sourceDir)
    ? readdirSync(sourceDir).filter(f => f.endsWith('.html') && statSync(join(sourceDir, f)).isFile())
    : [];
  if (sources.length === 0) {
    return { ok: true, advisory: cls === 'legacy', cls, committed: [] };
  }

  // 清理任何残留 staging/backup（幂等）
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(backupDir, { recursive: true, force: true });
  ensureDir(stagingDir);

  // ① 全量校验（对 staged 副本）
  const stagedHashes: Record<string, string> = {};
  for (const f of sources) {
    const stagedPath = join(stagingDir, f);
    copyFileSync(join(sourceDir, f), stagedPath);
    stagedHashes[f] = sha256(stagedPath);
  }
  if (cls === 'full') {
    const expected = prov.hashes ?? {};
    const expKeys = Object.keys(expected).sort();
    const stKeys = Object.keys(stagedHashes).sort();
    const setOk = expKeys.length === stKeys.length && expKeys.every((k, i) => k === stKeys[i]);
    const contentOk = setOk && expKeys.every(k => stagedHashes[k] === expected[k]);
    if (!setOk || !contentOk) {
      rmSync(stagingDir, { recursive: true, force: true });
      return { ok: false, advisory: false, cls, committed: [], reason: 'hash_mismatch' };
    }
  }

  // ② commit journal
  ensureDir(targetDir);
  ensureDir(backupDir);
  const journal: Journal = {
    intent: 'commit',
    targets: sources.map(f => ({
      basename: f,
      staged: join(stagingDir, f),
      target: join(targetDir, f),
      backup: existsSync(join(targetDir, f)) ? join(backupDir, f) : null,
      done: false,
    })),
  };
  const journalPath = join(proposalDir, COMMIT_JOURNAL);
  writeJournalAtomic(journalPath, journal);

  // ③ 原子提交
  const committed: string[] = [];
  try {
    for (const e of journal.targets) {
      if (e.backup) copyFileSync(e.target, e.backup);
      safeRename(e.staged, e.target);
      e.done = true;
      committed.push(e.basename);
      writeJournalAtomic(journalPath, journal);
    }
  } catch (err) {
    // 中途失败 → 容错回滚（每步持久化）；仅完整回滚成功才清理材料，否则保留材料 + rolledBack:false（不谎报成功）。
    const rb = abortTransaction(journal, journalPath, stagingDir, backupDir);
    return {
      ok: false, advisory: false, cls, committed: [],
      reason: rb ? `commit_failed:${(err as Error).message}` : `commit_failed_rollback_incomplete:${(err as Error).message}`,
      rolledBack: rb,
    };
  }

  // 落盘后复核（full 模式）
  if (cls === 'full') {
    const landed = computePrototypeHashes(targetDir);
    const expected = prov.hashes ?? {};
    for (const k of Object.keys(expected)) {
      if (landed[k] !== expected[k]) {
        const rb = abortTransaction(journal, journalPath, stagingDir, backupDir);
        return {
          ok: false, advisory: false, cls, committed: [],
          reason: rb ? 'post_commit_hash_mismatch' : 'post_commit_hash_mismatch_rollback_incomplete',
          rolledBack: rb,
        };
      }
    }
  }

  // 成功：清理
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(backupDir, { recursive: true, force: true });
  rmSync(journalPath, { force: true });
  return { ok: true, advisory: cls === 'legacy', cls, committed };
}

/** 该项的 target 是否**已被替换**（据文件系统真实状态，而非仅 done 标志）：done:true，或 staged 已消失（rename 已发生）。 */
function targetReplaced(e: JournalEntry): boolean {
  return e.done || !existsSync(e.staged);
}

/**
 * 强制回滚到**全旧一致态**（F1，code-r5）——commit catch、post-commit 复核失败、启动恢复三处**共用**：
 * 逐条**据文件系统真实状态**还原（不再只看 done）——凡 target 已被替换（done 或 staged 消失，含 rename→done 落盘间的崩溃窗口），
 * 有 backup 则 backup→target、无 backup 则删除 target；未替换项（staged 仍在）跳过。
 * **每步原子持久化 journal + 容错**：任一还原抛出 ⇒ 持久化进度并返回 false，调用方保留全部材料（fail closed）。
 * 幂等：backup=旧内容覆盖旧内容、删不存在的 target 均安全，可重放至一致。
 */
function rollbackAllToOld(journal: Journal, journalPath: string): boolean {
  for (const e of journal.targets) {
    try {
      if (e.backup && existsSync(e.backup)) copyFileSync(e.backup, e.target);
      else if (targetReplaced(e)) rmSync(e.target, { force: true });
      e.done = false;
      writeJournalAtomic(journalPath, journal);
    } catch {
      try { writeJournalAtomic(journalPath, journal); } catch { /* best-effort 持久化进度 */ }
      return false;
    }
  }
  return true;
}

/**
 * 中止事务：先把 intent 落盘为 'abort'（**在破坏性还原之前**，使恢复据此判方向），再容错回滚到全旧一致态；
 * **仅完整回滚成功才清理 staging/backup/journal**，否则保留全部材料、返回 false（fail closed）。
 */
function abortTransaction(journal: Journal, journalPath: string, stagingDir: string, backupDir: string): boolean {
  journal.intent = 'abort';
  writeJournalAtomic(journalPath, journal);   // 先持久化 abort intent，崩溃后恢复才会继续回滚而非误前滚
  if (!rollbackAllToOld(journal, journalPath)) return false;
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(backupDir, { recursive: true, force: true });
  rmSync(journalPath, { force: true });
  return true;
}

/** path 是否 canonical 位于 parent 之内（含 parent 本身），防路径穿越。 */
function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * F1（code-r2）：校验单条 journal entry 的 schema 与路径 canonical containment——
 * basename 合法；staged 只能位于本提案 staging、backup 只能位于本提案 backup、
 * target 只能位于 page-design resources；且各路径 basename 与 entry.basename 一致。
 * 任一不符 ⇒ 视为损坏/伪造 journal，调用方 fail closed（不动任何文件、保留诊断材料）。
 */
function isValidJournalEntry(e: unknown, proposalDir: string, root: string): e is JournalEntry {
  if (!e || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  if (typeof r.basename !== 'string' || !isValidPrototypeBasename(r.basename)) return false;
  if (typeof r.staged !== 'string' || typeof r.target !== 'string') return false;
  if (r.backup !== null && typeof r.backup !== 'string') return false;
  if (typeof r.done !== 'boolean') return false;
  const stagingDir = join(proposalDir, STAGING_DIR);
  const backupDir = join(proposalDir, BACKUP_DIR);
  const targetDir = join(root, PROTOTYPE_RESOURCE_SUBPATH);
  if (!isWithin(stagingDir, r.staged) || basename(r.staged) !== r.basename) return false;
  if (!isWithin(targetDir, r.target) || basename(r.target) !== r.basename) return false;
  if (r.backup !== null && (!isWithin(backupDir, r.backup as string) || basename(r.backup as string) !== r.basename)) return false;
  return true;
}

/**
 * 崩溃恢复：检测残留 commit journal → 前滚（补完未完成 rename）或回滚（还原 backup），
 * 到达一致的全有或全无态，恢复后清 journal。
 * 返回 'rolled_forward' | 'rolled_back' | 'none' | 'failed'。
 * **fail closed（F1，code-r2）**：JSON 损坏/截断、schema 非法（targets 非数组）、任一 entry 路径越界/类型不符、
 * 或恢复 I/O 失败 ⇒ 返回 'failed' 且**不删除 journal/staging/backup、不改动任何文件**（保留诊断材料）；
 * 由调用方（merge）非零退出，绝不把部分提交态当正常推进。
 */
export function recoverCommitJournal(proposalDir: string): 'rolled_forward' | 'rolled_back' | 'none' | 'failed' {
  const journalPath = join(proposalDir, COMMIT_JOURNAL);
  if (!existsSync(journalPath)) return 'none';
  const root = resolve(proposalDir, '..', '..', '..');

  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(journalPath, 'utf-8')); }
  catch { return 'failed'; }   // 损坏/截断 JSON：保留 journal，fail closed（不删恢复意图）

  const rec = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : null;
  if (!rec || !Array.isArray(rec.targets)) return 'failed';
  if (rec.intent !== 'commit' && rec.intent !== 'abort') return 'failed';   // 缺/非法 intent → fail closed（保留 journal）
  const targets = rec.targets as unknown[];
  for (const e of targets) {
    if (!isValidJournalEntry(e, proposalDir, root)) return 'failed';  // 越界/非法 → 不动文件、fail closed
  }
  const journal: Journal = { intent: rec.intent, targets: targets as JournalEntry[] };

  const stagingDir = join(proposalDir, STAGING_DIR);
  const backupDir = join(proposalDir, BACKUP_DIR);

  // intent='abort'：崩溃发生在回滚过程中 → 继续回滚到全旧（共用 abortTransaction，据文件系统真实状态、幂等）。
  if (journal.intent === 'abort') {
    return abortTransaction(journal, journalPath, stagingDir, backupDir) ? 'rolled_back' : 'failed';
  }

  // intent='commit'：崩溃发生在正向提交中 → 完成前滚到全新。
  // 关键（F1 code-r5）：据文件系统真实状态判定每项——**target 已替换（staged 消失，含 rename→done 落盘间的崩溃窗口）
  // 的条目不再被忽略**，而是补记 done；仅 staged 仍在的项才执行 rename。任一项失败 → 立即切换 abort 回滚。
  try {
    for (const e of journal.targets) {
      if (targetReplaced(e)) {           // 已 rename（含崩溃窗口）→ target 已是新内容，补记 done
        if (!e.done) { e.done = true; writeJournalAtomic(journalPath, journal); }
        continue;
      }
      if (e.backup && existsSync(e.target) && !existsSync(e.backup)) copyFileSync(e.target, e.backup);
      safeRename(e.staged, e.target);
      e.done = true;
      writeJournalAtomic(journalPath, journal);   // 每步 rename 后原子持久化，磁盘与真实进度同步
    }
    rmSync(stagingDir, { recursive: true, force: true });
    rmSync(backupDir, { recursive: true, force: true });
    rmSync(journalPath, { force: true });
    return 'rolled_forward';
  } catch {
    // 前滚中途 I/O 失败：切换到 abort、回滚到全旧一致态；回滚本身也失败 → 保留全部材料、fail closed。
    return abortTransaction(journal, journalPath, stagingDir, backupDir) ? 'rolled_back' : 'failed';
  }
}
