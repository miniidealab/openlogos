/**
 * brownfield-adopter 切片2：`openlogos baseline-seed` 的两阶段 staging + commit journal 事务 +
 * 模块级事务锁 + 恢复门（F7/F10）。详见架构 core-06-provenance-data-model §4.4。
 *
 * 设计要点：
 * - CLI 是 `baseline_seed_state` 与目标文件的**唯一写入者**；producer 只写 run 私有 staging。
 * - 多文件提交（多目标文档 + 派生索引/状态所在的 logos-project.yaml）经 journal `prepared→committing→committed`
 *   在模块级锁下进行；**状态最后写**；journal 阶段/进度自身以临时文件 + rename 原子写。
 * - 所有机器读取入口经**恢复门**：取锁 + 检测未终结 journal → 先恢复（按每目标 on-disk hash 与 journal old/new
 *   逐目标重判态），否则返回 `baseline_commit_in_progress`、不把半新集合当权威。
 */
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync,
  readdirSync, copyFileSync, statSync, lstatSync, realpathSync, linkSync,
} from 'node:fs';
import { join, dirname, isAbsolute, normalize, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { BaselineSeedState, BaselineIndexEntry } from './baseline-provenance.js';
import { parseProvenanceSection, scanModuleCandidates, computeCoverage } from './baseline-provenance.js';

export const REQUIRED_KINDS = ['system-map', 'scenario-candidates'] as const;
export const KIND_ENUM = ['system-map', 'scenario-candidates', 'dependency-map', 'entry-points'] as const;

export type SeedErrorCode =
  | 'missing_required_kind' | 'path_escape' | 'invalid_manifest'
  | 'unknown_run' | 'stale_run' | 'run_locked'
  | 'candidate_key_mismatch' | 'candidate_key_conflict' | 'invalid_provenance'
  | 'provenance_doc_uncovered'
  | 'baseline_commit_in_progress';

export interface ExpectedItem { kind: string; target_path: string; candidate_keys: string[]; }
export interface RunRecord {
  run_id: string;
  module: string;
  status: 'open' | 'superseded' | 'committed';
  expected: ExpectedItem[];
  created_at: string;
  /** F2：begin 签发时生成的随机 nonce——与 CLI 受控签发账本（.issued-runs.json）双向核对，
   *  作为「本 run 确经 begin 签发」的证据（非手工放入的自洽目录）。 */
  issued_nonce?: string;
}
export interface JournalTarget { target_path: string; old_sha256: string | null; new_sha256: string; applied: boolean; }
export interface CommitJournal {
  phase: 'prepared' | 'committing' | 'committed';
  run_id: string;
  module: string;
  targets: JournalTarget[];
  index: { yaml_backup_path: string; old_yaml_sha256: string | null };
  state_transition: { from: BaselineSeedState | null; to: BaselineSeedState };
  /** F9：提交的候选 keys，随 journal 持久化——使 register 审计事件在恢复窗口内可（幂等）补记。 */
  keys: string[];
}

export function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
export function sha256File(path: string): string | null {
  if (!existsSync(path)) return null;
  return sha256(readFileSync(path, 'utf-8'));
}

export function runsRoot(root: string): string {
  return join(root, 'logos', 'resources', 'verify', 'baseline-seed-runs');
}
export function runDir(root: string, runId: string): string { return join(runsRoot(root), runId); }
export function stagingDir(root: string, runId: string): string { return join(runDir(root, runId), 'staging'); }
/** F4：resolved 区——commit 把「对账后最终内容」持久化于此，供事务提交与崩溃恢复（roll-forward）复现全新集合；staging 保持纯净。 */
export function resolvedDir(root: string, runId: string): string { return join(runDir(root, runId), 'resolved'); }
export function backupDir(root: string, runId: string): string { return join(runDir(root, runId), 'backup'); }
export function journalPath(root: string, runId: string): string { return join(runDir(root, runId), 'commit-journal.json'); }
export function runRecordPath(root: string, runId: string): string { return join(runDir(root, runId), 'run.json'); }
export function lockPath(root: string, moduleId: string): string { return join(runsRoot(root), `${moduleId}.commit.lock`); }
export function eventsPath(root: string): string { return join(root, 'logos', 'resources', 'verify', 'baseline-events.jsonl'); }

/** 临时文件 + rename 原子写入（journal / 目标 / yaml 均用此）。 */
export function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}
export function atomicWriteJson(path: string, obj: unknown): void {
  atomicWrite(path, JSON.stringify(obj, null, 2));
}

function yamlPath(root: string): string { return join(root, 'logos', 'logos-project.yaml'); }

/** F2：模块 id 标识符校验——只允许 `[a-z0-9-]`（防路径分隔符/`..`/隐藏字符注入锁路径与目标路径）。 */
export function isSafeModuleId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id);
}

/** F2：runId 标识符校验——单段、无分隔符/`..`（防 --run-id 注入逃逸 runDir/staging/journal 路径）。 */
export function isSafeRunId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes('..');
}

/**
 * target_path 路径安全（F2 强化）：项目根相对、位于 `logos/resources/`、`.md`、每段标识符受限、
 * **逐段（含所有中间层）拒绝符号链接** + 最深已存在祖先 realpath 必须仍在 base 内、拒绝 `..`/绝对/重复。
 */
export function validateTargetPaths(root: string, expected: ExpectedItem[]): { ok: true } | { ok: false; error: SeedErrorCode } {
  const base = join(root, 'logos', 'resources');
  const seen = new Set<string>();
  for (const item of expected) {
    const p = item.target_path;
    if (typeof p !== 'string' || p === '' || isAbsolute(p)) return { ok: false, error: 'path_escape' };
    const norm = normalize(p).replace(/\\/g, '/');
    if (!norm.startsWith('logos/resources/') || !norm.endsWith('.md')) return { ok: false, error: 'path_escape' };
    // 每段标识符校验：拒绝空段/`.`/`..`/非受限字符（含未校验标识符与隐藏分隔符）。
    const segs = norm.split('/');
    for (const seg of segs) {
      if (seg === '' || seg === '.' || seg === '..' || !/^[A-Za-z0-9._-]+$/.test(seg)) return { ok: false, error: 'path_escape' };
    }
    if (seen.has(norm)) return { ok: false, error: 'path_escape' };
    seen.add(norm);
    const abs = join(root, norm);
    try {
      // 逐段（含所有中间层）符号链接检测——防嵌套 symlink 逃逸。
      let cur = root;
      for (const seg of segs) {
        cur = join(cur, seg);
        if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) return { ok: false, error: 'path_escape' };
      }
      // 最深已存在祖先的 realpath 必须仍在 base 内（防已存在 symlink 目录逃逸）。
      let ancestor = dirname(abs);
      while (ancestor !== root && !existsSync(ancestor)) ancestor = dirname(ancestor);
      if (existsSync(ancestor) && existsSync(base)) {
        const real = realpathSync(ancestor);
        const realBase = realpathSync(base);
        if (real !== realBase && !real.startsWith(realBase + sep)) return { ok: false, error: 'path_escape' };
      }
    } catch {
      return { ok: false, error: 'path_escape' }; // 保守：解析出错按逃逸拒绝
    }
  }
  return { ok: true };
}

/** manifest 校验：必需 kind 齐、kind 受控枚举、路径安全。 */
export function validateManifest(root: string, manifest: unknown): { ok: true; expected: ExpectedItem[] } | { ok: false; error: SeedErrorCode } {
  if (!manifest || typeof manifest !== 'object') return { ok: false, error: 'invalid_manifest' };
  const rawExpected = (manifest as { expected?: unknown }).expected;
  if (!Array.isArray(rawExpected) || rawExpected.length === 0) return { ok: false, error: 'invalid_manifest' };
  const expected: ExpectedItem[] = [];
  for (const raw of rawExpected) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_manifest' };
    const r = raw as Record<string, unknown>;
    if (typeof r.kind !== 'string' || typeof r.target_path !== 'string') return { ok: false, error: 'invalid_manifest' };
    if (!KIND_ENUM.includes(r.kind as (typeof KIND_ENUM)[number])) return { ok: false, error: 'invalid_manifest' };
    // F10：candidate_keys 若出现，必须为**字符串数组**——拒绝非数组/含非字符串元素（不再静默过滤为空数组，
    // 否则空/畸形键集会关闭下游 staged↔manifest 集合一致性校验、错误提交 seeded）。缺省视为 []（空集，
    // 仍在 classifyStaged 中要求 staged 候选亦为空——集合相等无条件生效）。
    if ('candidate_keys' in r && r.candidate_keys !== undefined) {
      if (!Array.isArray(r.candidate_keys) || r.candidate_keys.some(k => typeof k !== 'string')) {
        return { ok: false, error: 'invalid_manifest' };
      }
    }
    const keys = Array.isArray(r.candidate_keys) ? (r.candidate_keys as string[]) : [];
    expected.push({ kind: r.kind, target_path: r.target_path, candidate_keys: keys });
  }
  const kinds = new Set(expected.map(e => e.kind));
  for (const req of REQUIRED_KINDS) {
    if (!kinds.has(req)) return { ok: false, error: 'missing_required_kind' };
  }
  // F5：同一稳定 candidate key **不得**分布在多个目标文档（跨目标复制权威候选 → 读侧立即判冲突/unknown）。
  const seenKeys = new Set<string>();
  for (const e of expected) {
    for (const k of e.candidate_keys) {
      if (seenKeys.has(k)) return { ok: false, error: 'candidate_key_conflict' };
      seenKeys.add(k);
    }
  }
  const pathCheck = validateTargetPaths(root, expected);
  if (!pathCheck.ok) return pathCheck;
  return { ok: true, expected };
}

// ---- 模块级事务锁：**原子发布完整 owner**（临时文件 + `link`）+ **仲裁式**回收「进程确证已死」的锁（F1）----
// lockPath 为一个**文件**，内容 {pid,at,token}。获取协议：先把**完整 owner** 写入 run 私有临时文件，
// 再 `linkSync(tmp, lock)` 原子发布——link 对目标要么「不存在→带完整内容创建」、要么「存在→EEXIST」，
// **绝不存在文件已建但内容未写的空窗口**（这是 O_EXCL 裸 open 的固有窗口）。因此本协议下锁文件恒为完整可解析内容。
//
// 陈旧回收（F1：**同时保证互斥安全 + 无永久锁死**）。核心原则：**绝不基于陈旧读结果移动/覆盖 path 上的锁**——
// 仲裁只在**独立的 marker 文件**上进行，path 的唯一写操作是「已确认仍为同一死锁」后的原子替换：
//   1) 快路径：`linkSync(tmp, path)` 原子发布进空槽（O_EXCL：不存在→带完整内容创建、存在→EEXIST，无空窗口）。
//   2) 槽被占且 owner 进程**确证已死** → 在**确定名** marker `path.reclaim-<hash(deadKey)>` 上以 `linkSync(rcTmp, marker)`
//      做**单赢仲裁**（O_EXCL，至多一个回收者赢）；marker 承载**回收者身份**（{pid,token}），供孤儿检测。
//   3) 赢得 marker 者：**紧邻重读 path**，仅当 path 仍为刚判死的**同一死锁**（pid+token 一致且死）时才
//      `renameSync(tmp, path)` 原子替换。因 path 只能由 marker 持有者替换、同一时刻至多一个**存活** marker 持有者，
//      「重读==死锁」与「替换」之间 path 不会被他人改成活锁 → **绝不把他人刚发布的活锁误当死锁移走/覆盖**
//      （评审 F1 的三方 barrier 交错：A 判死→B 抢先回收发布活锁 B→A 若移走 path 就会误删活锁 B，本协议下 A 在重读时
//       发现 path 已非原死锁而中止、不触碰 path，故安全）。若重读发现 path 已被替换/清空 → 本方**不触碰 path**、退避。
//   4) 孤儿回收（无永久锁死）：若 marker 被占且其**回收者进程已死**（回收者恰在「建 marker、替换 path」之间崩溃）→
//      以唯一命名 `renameSync(marker, marker.evict-<token>)` 原子移走该孤儿 marker（**只动 marker、不动 path**）后重试；
//      移走孤儿不破坏安全（即便误移他人刚建的活 marker，对方仍会独立完成「重读 path==死锁→替换」，本方重试后要么重赢
//      marker、要么重读发现 path 已非死锁而中止）。marker 承载回收者身份使孤儿可被检测清除，故确定名 marker 不再永久锁死。
// **不可解析/空锁一律视为活锁不回收**（可能来自协议外持有者的发布窗口/活锁）。
function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

// 进程内持有的 owner token（不可复用）——release 只清理本进程本次获取的锁，防误删被他人回收后重建的新锁。
const heldLockTokens = new Map<string, string>();
let lockTokenSeq = 0;

interface LockOwner { pid?: number; at?: number; token?: string }
/** 读锁 owner；空/不可解析返回 'unparseable'（协议外/发布窗口 → 一律不回收）。 */
function readLockOwner(path: string): LockOwner | 'unparseable' {
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); } catch { return 'unparseable'; }
  try {
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== 'object') return 'unparseable';
    return o as LockOwner;
  } catch { return 'unparseable'; }
}

export function acquireLock(root: string, moduleId: string): boolean {
  const path = lockPath(root, moduleId);
  mkdirSync(runsRoot(root), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${lockTokenSeq++}`;
  const payload = JSON.stringify({ pid: process.pid, at: Date.now(), token });
  const tmp = `${path}.acq-${process.pid}-${token}`;      // 持有者身份（发布进 path）
  const rcTmp = `${path}.rc-${process.pid}-${token}`;     // 回收者身份（发布进 marker，供孤儿检测）
  try {
    writeFileSync(tmp, payload); // 完整 owner 写入 run 私有临时文件
    for (let attempt = 0; attempt < 8; attempt++) {
      // 快路径：把完整 owner 原子发布进空槽（不存在→创建、存在→EEXIST，绝无空窗口）。
      try {
        linkSync(tmp, path);
        heldLockTokens.set(moduleId, token);
        return true;
      } catch { /* 槽被占 */ }

      // 槽被占——读当前 owner。空/不可解析锁一律不回收（可能是协议外持有者活锁/发布窗口）。
      const owner = readLockOwner(path);
      if (owner === 'unparseable') return false;
      if (typeof owner.pid !== 'number') return false;
      if (owner.pid === process.pid) return false;   // 本进程已持有 → 非陈旧
      if (isProcessAlive(owner.pid)) return false;    // 活进程 → 不抢

      // 死进程锁回收（**安全性**：绝不基于陈旧读结果移动/覆盖 path 上的锁）。
      // 仲裁只发生在**独立的 marker 文件**上（`linkSync` O_EXCL 单赢），marker 承载**回收者身份**（便于孤儿检测）；
      // path 唯一的写操作是 marker 持有者在**紧邻重读确认 path 仍为同一死锁**后的原子替换——因 path 只能由 marker
      // 持有者替换、且同一时刻至多一个存活 marker 持有者，故「重读==死锁」与「替换」之间 path 不会被他人改成活锁，
      // **杜绝把他人刚发布的活锁误当死锁移走**（评审 F1 三方 barrier 交错）。
      const deadKey = typeof owner.token === 'string' ? owner.token : `pid${owner.pid}`;
      const marker = `${path}.reclaim-${sha256(deadKey).slice(0, 16)}`;
      try { writeFileSync(rcTmp, payload); } catch { return false; }
      let holdMarker = false;
      try { linkSync(rcTmp, marker); holdMarker = true; } catch { holdMarker = false; }
      if (!holdMarker) {
        // marker 被占——读回收者身份。回收者存活 → 让其完成，退避重试；回收者已死 → 孤儿 marker，唯一命名原子移走后重试。
        const rc = readLockOwner(marker);
        if (rc !== 'unparseable' && typeof rc.pid === 'number' && !isProcessAlive(rc.pid)) {
          // 移走 marker **不触碰 path**（安全）：即便误移了他人刚建的活 marker，对方作为 marker 持有者仍会独立完成
          // 「重读 path==死锁 → 替换」；本方重试后要么重新赢得 marker、要么在重读时发现 path 已非死锁而中止。
          const evict = `${marker}.evict-${token}`;
          try { renameSync(marker, evict); } catch { /* 他人已移走 */ }
          try { rmSync(evict, { force: true }); } catch { /* ignore */ }
        }
        continue; // 重试仲裁
      }
      // 赢得 marker（本进程为唯一回收者）——仅在 path 仍为**刚判死的同一死锁**时替换。
      let acquired = false;
      try {
        const cur = readLockOwner(path);
        if (cur !== 'unparseable' && typeof cur.pid === 'number'
          && cur.pid === owner.pid && (cur.token ?? null) === (owner.token ?? null)
          && !isProcessAlive(cur.pid)) {
          renameSync(tmp, path); // path 仍为同一死锁 → 原子替换为完整活 owner（tmp 被消费）
          heldLockTokens.set(moduleId, token);
          acquired = true;
        }
        // 否则：path 已被他人替换/清空 → 本方**不触碰 path**（不覆盖他人活锁）；下一轮由快路径处理空槽/见活锁返回。
      } finally {
        try { rmSync(marker, { force: true }); } catch { /* ignore */ }
      }
      if (acquired) return true;
      continue;
    }
    return false;
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* ignore */ }   // 未被 rename 消费时清理 tmp 名
    try { rmSync(rcTmp, { force: true }); } catch { /* ignore */ }
  }
}
export function releaseLock(root: string, moduleId: string): void {
  const path = lockPath(root, moduleId);
  const myToken = heldLockTokens.get(moduleId);
  // 仅释放**本进程本次获取**（pid + token 双匹配）的锁——若锁已被回收并由他人重建（token/pid 不符），不误删。
  try {
    const owner = JSON.parse(readFileSync(path, 'utf-8')) as { pid?: number; token?: string };
    if (owner.pid !== process.pid || (myToken !== undefined && owner.token !== myToken)) {
      heldLockTokens.delete(moduleId);
      return;
    }
  } catch {
    // 不可解析/缺失：不是本进程以本协议写入的锁 → 不清理（避免误删协议外持有者）。
    heldLockTokens.delete(moduleId);
    return;
  }
  try { rmSync(path, { force: true }); } catch { /* ignore */ }
  heldLockTokens.delete(moduleId);
}

// ---- F2：CLI 受控签发账本（issued-runs ledger）----
// begin 是唯一写入者：签发 run 时把 `sha256(run_id:module:nonce)` 记入账本；commit 双向核对
// `record.issued_nonce` 与账本条目一致方视为「已签发」。这把「签发事实」从「目录内自述 JSON 是否自洽」
// 提升为「CLI 受控账本是否登记」——手工放入一个格式合法且自洽的 run 目录（未经 begin）不会进入账本，commit 即拒。
// 说明（信任边界）：本地文件型模型**无密钥**，完全对抗的本地写者仍可同时伪造 run.json 与账本条目；
// 该残留由规格显式声明为超出本地信任模型范围（详见 core-S33 §签发信任边界）。
// **每模块账本**（`.issued-runs-<module>.json`）——账本 read-modify-write 只由**该模块锁**保护，
// 故账本粒度必须与锁粒度一致：旧全局 `.issued-runs.json` 在**不同模块并发 begin** 时（各持自己的模块锁、
// 互不排斥）会同时读到旧账本再分别覆盖写入，丢失其中一个合法签发记录（跨模块 lost-update）。改为每模块账本后，
// 单一账本的所有写入者恒持同一模块锁，RMW 天然串行；不同模块写不同文件、无共享可竞争（F2 二阶残留修复）。
function issuedLedgerPath(root: string, moduleId: string): string {
  return join(runsRoot(root), `.issued-runs-${moduleId}.json`);
}
function issueHash(runId: string, moduleId: string, nonce: string): string {
  return sha256(`${runId}:${moduleId}:${nonce}`);
}
export function newIssuedNonce(): string { return randomBytes(16).toString('hex'); }

function readIssuedLedger(root: string, moduleId: string): Record<string, string> {
  const p = issuedLedgerPath(root, moduleId);
  if (!existsSync(p)) return {};
  try {
    const o = JSON.parse(readFileSync(p, 'utf-8')) as unknown;
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, string>) : {};
  } catch { return {}; }
}

/** begin 签发时登记（调用方须持**本模块锁**——read-modify-write 原子写；每模块独立账本，跨模块无 lost-update）。 */
export function recordIssuedRun(root: string, runId: string, moduleId: string, nonce: string): void {
  const ledger = readIssuedLedger(root, moduleId);
  ledger[runId] = issueHash(runId, moduleId, nonce);
  atomicWriteJson(issuedLedgerPath(root, moduleId), ledger);
}

/** commit 核对：run 必须在**本模块**受控账本中登记，且 hash 与 `record.issued_nonce` 一致。 */
export function isIssuedRun(root: string, runId: string, moduleId: string, nonce: string | undefined): boolean {
  if (typeof nonce !== 'string' || nonce === '') return false;
  const ledger = readIssuedLedger(root, moduleId);
  return ledger[runId] === issueHash(runId, moduleId, nonce);
}

export function readRunRecord(root: string, runId: string): RunRecord | null {
  const p = runRecordPath(root, runId);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')) as RunRecord; } catch { return null; }
}
export function readJournal(root: string, runId: string): CommitJournal | null {
  const p = journalPath(root, runId);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')) as CommitJournal; } catch { return null; }
}

export function listRunIds(root: string): string[] {
  const base = runsRoot(root);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .filter(name => { try { return statSync(join(base, name)).isDirectory(); } catch { return false; } });
}

/** 查找模块下未终结（prepared/committing）的 journal（锁保证至多一个在飞行）。 */
export function findUnfinalizedJournal(root: string, moduleId: string): { runId: string; journal: CommitJournal } | null {
  for (const runId of listRunIds(root)) {
    const journal = readJournal(root, runId);
    if (journal && journal.module === moduleId && journal.phase !== 'committed') {
      return { runId, journal };
    }
  }
  return null;
}

// ---- 读写 logos-project.yaml 的状态与派生索引 ----
function readYamlDoc(root: string): Record<string, unknown> {
  const p = yamlPath(root);
  if (!existsSync(p)) return {};
  try { return (parseYaml(readFileSync(p, 'utf-8')) as Record<string, unknown>) ?? {}; } catch { return {}; }
}

/** 写入模块 baseline_seed_state（+ 可选派生索引），yaml 单文件、临时+rename 原子写。 */
export function writeSeedState(
  root: string,
  moduleId: string,
  state: BaselineSeedState,
  indexEntry?: BaselineIndexEntry,
): void {
  const doc = readYamlDoc(root);
  const modules = Array.isArray(doc.modules) ? (doc.modules as Array<Record<string, unknown>>) : [];
  const mod = modules.find(m => m.id === moduleId);
  if (mod) {
    mod.baseline_seed_state = state;
    delete mod.baseline_seed_required; // 迁移旧布尔
  }
  if (indexEntry) {
    const idx = (doc.baseline_index && typeof doc.baseline_index === 'object')
      ? (doc.baseline_index as Record<string, unknown>) : {};
    idx[moduleId] = indexEntry;
    doc.baseline_index = idx;
  }
  atomicWrite(yamlPath(root), stringifyYaml(doc, { lineWidth: 0 }));
}

export function readSeedState(root: string, moduleId: string): BaselineSeedState | null {
  const doc = readYamlDoc(root);
  const modules = Array.isArray(doc.modules) ? (doc.modules as Array<Record<string, unknown>>) : [];
  const mod = modules.find(m => m.id === moduleId);
  const v = mod?.baseline_seed_state;
  if (v === 'required' || v === 'partial' || v === 'seeded') return v;
  if (mod?.baseline_seed_required === true) return 'required';
  return null;
}

/** 从（已就位的）目标文档计算模块派生索引条目。 */
export function computeIndexEntry(root: string, moduleId: string, at: string): BaselineIndexEntry {
  const scan = scanModuleCandidates(root, moduleId);
  const cov = computeCoverage(scan.candidates);
  return { source_hash: scan.aggregate_hash, human_verified: cov.human_verified, denominator: cov.denominator, generated_at: at };
}

export function appendEvent(root: string, event: Record<string, unknown>): void {
  const p = eventsPath(root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(event) + '\n', { flag: 'a' });
}

/** F9：按 event_id 去重追加——已存在同 event_id 的审计行则跳过（幂等重提交不重复记账）。 */
export function appendEventOnce(root: string, event: Record<string, unknown> & { event_id: string }): void {
  const p = eventsPath(root);
  if (existsSync(p)) {
    const needle = `"event_id":${JSON.stringify(event.event_id)}`;
    if (readFileSync(p, 'utf-8').split('\n').some(line => line.includes(needle))) return;
  }
  appendEvent(root, event);
}

/**
 * seeded 事务提交（F4/F9 重构）：目标最终内容由调用方以 `content` 传入（不读 staging——staging 保持纯净、
 * 每次 commit 独立校验，保幂等）。最终内容先持久化到 **resolved** 区（供崩溃恢复 roll-forward 复现全新集合），
 * 再经 journal `prepared→committing→committed` 提交跨目标 + 派生索引/状态；register 审计事件在 committed **之前**
 * 于恢复窗口内（幂等）补记，崩溃后 roll-forward 亦会补记。`at` 为时间戳（调用方传入，便于确定性）。
 */
export function commitSeededTransaction(
  root: string,
  moduleId: string,
  runId: string,
  targets: Array<{ target_path: string; content: string }>,
  fromState: BaselineSeedState | null,
  at: string,
  keys: string[] = [],
): void {
  // 持久化最终内容到 resolved（durable，供恢复复现）。
  const rdir = resolvedDir(root, runId);
  for (const t of targets) {
    const rp = join(rdir, t.target_path);
    mkdirSync(dirname(rp), { recursive: true });
    atomicWrite(rp, t.content);
  }
  // prepared：算每目标 old/new hash + 备份 yaml，写 prepared journal（此刻未改任何目标）。
  const yBackup = join(backupDir(root, runId), 'logos-project.yaml.bak');
  mkdirSync(backupDir(root, runId), { recursive: true });
  const yp = yamlPath(root);
  const oldYamlSha = existsSync(yp) ? sha256File(yp) : null;
  if (existsSync(yp)) copyFileSync(yp, yBackup);

  const journalTargets: JournalTarget[] = targets.map(t => ({
    target_path: t.target_path,
    old_sha256: sha256File(join(root, t.target_path)),
    new_sha256: sha256(t.content),
    applied: false,
  }));
  const journal: CommitJournal = {
    phase: 'prepared', run_id: runId, module: moduleId,
    targets: journalTargets,
    index: { yaml_backup_path: yBackup, old_yaml_sha256: oldYamlSha },
    state_transition: { from: fromState, to: 'seeded' },
    keys,
  };
  atomicWriteJson(journalPath(root, runId), journal);

  // committing：逐目标 备份旧 → 从 resolved 写新 → 标 applied（进度原子写）。
  journal.phase = 'committing';
  atomicWriteJson(journalPath(root, runId), journal);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const abs = join(root, t.target_path);
    if (existsSync(abs)) {
      const bak = join(backupDir(root, runId), t.target_path);
      mkdirSync(dirname(bak), { recursive: true });
      copyFileSync(abs, bak);
    }
    atomicWrite(abs, t.content);
    journal.targets[i].applied = true;
    atomicWriteJson(journalPath(root, runId), journal);
  }
  // 全部 applied 后：更新派生索引 + 最后写状态（同 yaml 一次原子写）。
  writeSeedState(root, moduleId, 'seeded', computeIndexEntry(root, moduleId, at));
  // F9：register 事件在标 committed **之前**、恢复窗口内补记（幂等）。
  appendEventOnce(root, { event_id: `${runId}-commit`, type: 'register', module: moduleId, keys, actor: 'baseline-seed', at });

  // committed：标 committed。
  journal.phase = 'committed';
  atomicWriteJson(journalPath(root, runId), journal);
}

export interface RecoverResult { recovered: boolean; outcome: 'none' | 'rolled-forward' | 'rolled-back'; }

/** 判断 resolved 是否完好（所有目标 new_sha256 在 resolved 内可校验）。 */
function resolvedIntact(root: string, runId: string, journal: CommitJournal): boolean {
  for (const t of journal.targets) {
    const rp = join(resolvedDir(root, runId), t.target_path);
    if (!existsSync(rp) || sha256File(rp) !== t.new_sha256) return false;
  }
  return true;
}

/**
 * 恢复单个未终结 journal（按每目标 on-disk hash 与 journal old/new 逐目标重判态，不只依 applied）：
 * - prepared：回滚（丢弃 journal，目标全旧、状态不变）。
 * - committing + resolved 完好：前滚（从 resolved 补齐 + 索引 + 状态 seeded + 补记 register 事件，标 committed）。
 * - committing + resolved 缺失：回滚（按 backup + old_sha256 还原目标与 yaml，状态保持 from）。
 */
export function recoverJournal(root: string, runId: string, at: string): RecoverResult {
  const journal = readJournal(root, runId);
  if (!journal || journal.phase === 'committed') return { recovered: false, outcome: 'none' };

  if (journal.phase === 'prepared') {
    // 无目标已改 → 丢弃 journal，全旧、状态不变。
    rmSync(journalPath(root, runId), { force: true });
    return { recovered: true, outcome: 'rolled-back' };
  }

  // committing
  if (resolvedIntact(root, runId, journal)) {
    // 前滚：逐目标按 on-disk hash 重判，未达 new 的从 resolved 补齐。
    for (const t of journal.targets) {
      const abs = join(root, t.target_path);
      if (sha256File(abs) !== t.new_sha256) {
        atomicWrite(abs, readFileSync(join(resolvedDir(root, runId), t.target_path), 'utf-8'));
      }
    }
    writeSeedState(root, journal.module, 'seeded', computeIndexEntry(root, journal.module, at));
    // F9：崩溃在 event 之前 → roll-forward 幂等补记 register 事件。
    appendEventOnce(root, { event_id: `${runId}-commit`, type: 'register', module: journal.module, keys: journal.keys ?? [], actor: 'baseline-seed', at });
    journal.phase = 'committed';
    journal.targets.forEach(t => { t.applied = true; });
    atomicWriteJson(journalPath(root, runId), journal);
    return { recovered: true, outcome: 'rolled-forward' };
  }

  // resolved 缺失 → 回滚：逐目标按 on-disk hash 重判，非 old 的从 backup 还原（或删除新建文件）。
  for (const t of journal.targets) {
    const abs = join(root, t.target_path);
    if (sha256File(abs) === t.old_sha256) continue; // 已是旧值
    const bak = join(backupDir(root, runId), t.target_path);
    if (t.old_sha256 === null) {
      if (existsSync(abs)) rmSync(abs, { force: true }); // 原本不存在 → 删除新建文件
    } else if (existsSync(bak)) {
      atomicWrite(abs, readFileSync(bak, 'utf-8'));
    }
  }
  // 还原 yaml（索引 + 状态）到旧值。
  if (existsSync(journal.index.yaml_backup_path)) {
    atomicWrite(yamlPath(root), readFileSync(journal.index.yaml_backup_path, 'utf-8'));
  }
  rmSync(journalPath(root, runId), { force: true });
  return { recovered: true, outcome: 'rolled-back' };
}

/**
 * 恢复门：机器读取入口在读目标/算覆盖率前调用。
 * 取模块锁 + 检测未终结 journal → 先恢复；无法取锁则返回 baseline_commit_in_progress、不把当前集合当权威。
 * 传入 lockAlreadyHeld=true 表示调用方已持锁（begin/commit 内部复用），此时不再取锁。
 */
export function readGate(
  root: string,
  moduleId: string,
  at: string,
  opts?: { lockAlreadyHeld?: boolean },
): { ok: true } | { ok: false; error: 'baseline_commit_in_progress' } {
  const pending = findUnfinalizedJournal(root, moduleId);
  if (!pending) return { ok: true };

  const held = opts?.lockAlreadyHeld === true;
  if (!held && !acquireLock(root, moduleId)) {
    // 锁被占用 → 不把可能半新的集合当权威。
    return { ok: false, error: 'baseline_commit_in_progress' };
  }
  try {
    recoverJournal(root, pending.runId, at);
  } finally {
    if (!held) releaseLock(root, moduleId);
  }
  return { ok: true };
}

/**
 * F7：任意机器读取入口在读取目标/算覆盖率前调用——恢复**所有**模块的未终结提交，
 * 使所有读取者永不把半提交集合当权威。返回仍在提交中（锁被占用、无法恢复）的模块列表。
 */
export function recoverPendingForRead(root: string, at: string): { inProgress: string[] } {
  const inProgress: string[] = [];
  const modules = new Set<string>();
  for (const runId of listRunIds(root)) {
    const j = readJournal(root, runId);
    if (j && j.phase !== 'committed') modules.add(j.module);
  }
  for (const moduleId of modules) {
    const gate = readGate(root, moduleId, at);
    if (!gate.ok) inProgress.push(moduleId);
  }
  return { inProgress };
}

/**
 * F7：单模块**读锁区间**——把「取锁 → 检查/恢复未终结 journal → 读取目标」合并到**同一锁区间**，
 * 杜绝旧 `readGate`「恢复后释放锁再返回、真实扫描发生在锁外」的 TOCTOU（writer 可在门检查完成与目标读取
 * 之间启动提交，消费者仍读到半集合）。**始终取锁**（即便当前无 pending）以形成互斥区间；无法取锁（提交进行中）
 * 则返回 baseline_commit_in_progress，不执行 fn。fn 在持锁期间完成全部目标读取。
 */
export function withBaselineReadLock<T>(
  root: string,
  moduleId: string,
  at: string,
  fn: () => T,
): { ok: true; value: T } | { ok: false; error: 'baseline_commit_in_progress' } {
  if (!acquireLock(root, moduleId)) return { ok: false, error: 'baseline_commit_in_progress' };
  try {
    const pending = findUnfinalizedJournal(root, moduleId);
    if (pending) recoverJournal(root, pending.runId, at);
    return { ok: true, value: fn() };
  } finally {
    releaseLock(root, moduleId);
  }
}

/** 读 logos-project.yaml 的模块 id 列表（供多模块读锁区间；yaml 不可读则空）。 */
export function listProjectModuleIds(root: string): string[] {
  const doc = readYamlDoc(root);
  const modules = Array.isArray(doc.modules) ? (doc.modules as Array<Record<string, unknown>>) : [];
  return modules.map(m => (typeof m.id === 'string' ? m.id : null)).filter((x): x is string => x !== null);
}

/**
 * F7：多模块**读锁区间**——index/sync 等在读取/扫描 logos/resources（可能含多模块权威 provenance 文档）**之前**
 * 调用：按确定顺序（排序，防死锁）取**所有相关模块**锁，恢复各自未终结 journal，再把这些锁**持有到 fn 完成**，
 * 从而「取锁—检查/恢复—读取」为同一区间。任一模块锁被占用（writer 在飞行）→ 回滚已取锁、返回 inProgress，
 * 调用方据此非零退出、**不做任何扫描/迁移/写副作用**。
 */
export function withRecoveredReadLocks<T>(
  root: string,
  at: string,
  moduleIds: string[],
  fn: () => T,
): { ok: true; value: T } | { ok: false; inProgress: string[] } {
  const sorted = [...new Set(moduleIds)].sort();
  const held: string[] = [];
  try {
    for (const m of sorted) {
      if (!acquireLock(root, m)) return { ok: false, inProgress: [m] };
      held.push(m);
    }
    for (const m of sorted) {
      const pending = findUnfinalizedJournal(root, m);
      if (pending) recoverJournal(root, pending.runId, at);
    }
    return { ok: true, value: fn() };
  } finally {
    for (const m of held) releaseLock(root, m);
  }
}
