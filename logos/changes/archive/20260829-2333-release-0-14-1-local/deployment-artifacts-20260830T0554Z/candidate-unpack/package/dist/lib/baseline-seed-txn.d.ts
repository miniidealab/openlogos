import type { BaselineSeedState, BaselineIndexEntry } from './baseline-provenance.js';
export declare const REQUIRED_KINDS: readonly ["system-map", "scenario-candidates"];
export declare const KIND_ENUM: readonly ["system-map", "scenario-candidates", "dependency-map", "entry-points"];
export type SeedErrorCode = 'missing_required_kind' | 'path_escape' | 'invalid_manifest' | 'unknown_run' | 'stale_run' | 'run_locked' | 'candidate_key_mismatch' | 'candidate_key_conflict' | 'invalid_provenance' | 'provenance_doc_uncovered' | 'baseline_commit_in_progress';
/**
 * 未终结 journal 无法在读前确定性恢复时的统一硬错误。读取方必须中止，不能降级为 partial 后继续。
 */
export declare class BaselineCommitInProgressError extends Error {
    readonly code: "baseline_commit_in_progress";
    constructor(message?: string);
}
export interface ExpectedItem {
    kind: string;
    target_path: string;
    candidate_keys: string[];
}
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
export interface JournalTarget {
    target_path: string;
    old_sha256: string | null;
    new_sha256: string;
    applied: boolean;
}
export interface CommitJournal {
    phase: 'prepared' | 'committing' | 'committed';
    run_id: string;
    module: string;
    targets: JournalTarget[];
    index: {
        yaml_backup_path: string;
        old_yaml_sha256: string | null;
    };
    state_transition: {
        from: BaselineSeedState | null;
        to: BaselineSeedState;
    };
    /** F9：提交的候选 keys，随 journal 持久化——使 register 审计事件在恢复窗口内可（幂等）补记。 */
    keys: string[];
}
export declare function sha256(content: string): string;
export declare function sha256File(path: string): string | null;
export declare function runsRoot(root: string): string;
export declare function runDir(root: string, runId: string): string;
export declare function stagingDir(root: string, runId: string): string;
/** F4：resolved 区——commit 把「对账后最终内容」持久化于此，供事务提交与崩溃恢复（roll-forward）复现全新集合；staging 保持纯净。 */
export declare function resolvedDir(root: string, runId: string): string;
export declare function backupDir(root: string, runId: string): string;
export declare function journalPath(root: string, runId: string): string;
export declare function runRecordPath(root: string, runId: string): string;
export declare function lockPath(root: string, moduleId: string): string;
export declare function eventsPath(root: string): string;
/** 临时文件 + rename 原子写入（journal / 目标 / yaml 均用此）。 */
export declare function atomicWrite(path: string, content: string): void;
export declare function atomicWriteJson(path: string, obj: unknown): void;
/** F2：模块 id 标识符校验——只允许 `[a-z0-9-]`（防路径分隔符/`..`/隐藏字符注入锁路径与目标路径）。 */
export declare function isSafeModuleId(id: unknown): id is string;
/** F2：runId 标识符校验——单段、无分隔符/`..`（防 --run-id 注入逃逸 runDir/staging/journal 路径）。 */
export declare function isSafeRunId(id: unknown): id is string;
/**
 * target_path 路径安全（F2 强化）：项目根相对、位于 `logos/resources/`、`.md`、每段标识符受限、
 * **逐段（含所有中间层）拒绝符号链接** + 最深已存在祖先 realpath 必须仍在 base 内、拒绝 `..`/绝对/重复。
 */
export declare function validateTargetPaths(root: string, expected: ExpectedItem[]): {
    ok: true;
} | {
    ok: false;
    error: SeedErrorCode;
};
/** manifest 校验：必需 kind 齐、kind 受控枚举、路径安全。 */
export declare function validateManifest(root: string, manifest: unknown): {
    ok: true;
    expected: ExpectedItem[];
} | {
    ok: false;
    error: SeedErrorCode;
};
export declare function acquireLock(root: string, moduleId: string): boolean;
export declare function releaseLock(root: string, moduleId: string): void;
export declare function newIssuedNonce(): string;
/** begin 签发时登记（调用方须持**本模块锁**——read-modify-write 原子写；每模块独立账本，跨模块无 lost-update）。 */
export declare function recordIssuedRun(root: string, runId: string, moduleId: string, nonce: string): void;
/** commit 核对：run 必须在**本模块**受控账本中登记，且 hash 与 `record.issued_nonce` 一致。 */
export declare function isIssuedRun(root: string, runId: string, moduleId: string, nonce: string | undefined): boolean;
export declare function readRunRecord(root: string, runId: string): RunRecord | null;
export declare function readJournal(root: string, runId: string): CommitJournal | null;
export declare function listRunIds(root: string): string[];
/** 查找模块下未终结（prepared/committing）的 journal（锁保证至多一个在飞行）。 */
export declare function findUnfinalizedJournal(root: string, moduleId: string): {
    runId: string;
    journal: CommitJournal;
} | null;
/** 写入模块 baseline_seed_state（+ 可选派生索引），yaml 单文件、临时+rename 原子写。 */
export declare function writeSeedState(root: string, moduleId: string, state: BaselineSeedState, indexEntry?: BaselineIndexEntry): void;
export declare function readSeedState(root: string, moduleId: string): BaselineSeedState | null;
/** 从（已就位的）目标文档计算模块派生索引条目。 */
export declare function computeIndexEntry(root: string, moduleId: string, at: string): BaselineIndexEntry;
export declare function appendEvent(root: string, event: Record<string, unknown>): void;
/** F9：按 event_id 去重追加——已存在同 event_id 的审计行则跳过（幂等重提交不重复记账）。 */
export declare function appendEventOnce(root: string, event: Record<string, unknown> & {
    event_id: string;
}): void;
/**
 * seeded 事务提交（F4/F9 重构）：目标最终内容由调用方以 `content` 传入（不读 staging——staging 保持纯净、
 * 每次 commit 独立校验，保幂等）。最终内容先持久化到 **resolved** 区（供崩溃恢复 roll-forward 复现全新集合），
 * 再经 journal `prepared→committing→committed` 提交跨目标 + 派生索引/状态；register 审计事件在 committed **之前**
 * 于恢复窗口内（幂等）补记，崩溃后 roll-forward 亦会补记。`at` 为时间戳（调用方传入，便于确定性）。
 */
export declare function commitSeededTransaction(root: string, moduleId: string, runId: string, targets: Array<{
    target_path: string;
    content: string;
}>, fromState: BaselineSeedState | null, at: string, keys?: string[]): void;
export interface RecoverResult {
    recovered: boolean;
    outcome: 'none' | 'rolled-forward' | 'rolled-back';
}
/**
 * 恢复单个未终结 journal（按每目标 on-disk hash 与 journal old/new 逐目标重判态，不只依 applied）：
 * - prepared：回滚（丢弃 journal，目标全旧、状态不变）。
 * - committing + resolved 完好：前滚（从 resolved 补齐 + 索引 + 状态 seeded + 补记 register 事件，标 committed）。
 * - committing + resolved 缺失：回滚（按 backup + old_sha256 还原目标与 yaml，状态保持 from）。
 */
export declare function recoverJournal(root: string, runId: string, at: string): RecoverResult;
/**
 * 恢复门：机器读取入口在读目标/算覆盖率前调用。
 * 取模块锁 + 检测未终结 journal → 先恢复；无法取锁则返回 baseline_commit_in_progress、不把当前集合当权威。
 * 传入 lockAlreadyHeld=true 表示调用方已持锁（begin/commit 内部复用），此时不再取锁。
 */
export declare function readGate(root: string, moduleId: string, at: string, opts?: {
    lockAlreadyHeld?: boolean;
}): {
    ok: true;
} | {
    ok: false;
    error: 'baseline_commit_in_progress';
};
/**
 * F7：任意机器读取入口在读取目标/算覆盖率前调用——恢复**所有**模块的未终结提交，
 * 使所有读取者永不把半提交集合当权威。返回仍在提交中（锁被占用、无法恢复）的模块列表。
 */
export declare function recoverPendingForRead(root: string, at: string): {
    inProgress: string[];
};
/**
 * F7：单模块**读锁区间**——把「取锁 → 检查/恢复未终结 journal → 读取目标」合并到**同一锁区间**，
 * 杜绝旧 `readGate`「恢复后释放锁再返回、真实扫描发生在锁外」的 TOCTOU（writer 可在门检查完成与目标读取
 * 之间启动提交，消费者仍读到半集合）。**始终取锁**（即便当前无 pending）以形成互斥区间；无法取锁（提交进行中）
 * 则返回 baseline_commit_in_progress，不执行 fn。fn 在持锁期间完成全部目标读取。
 */
export declare function withBaselineReadLock<T>(root: string, moduleId: string, at: string, fn: () => T): {
    ok: true;
    value: T;
} | {
    ok: false;
    error: 'baseline_commit_in_progress';
};
/** 读 logos-project.yaml 的模块 id 列表（供多模块读锁区间；yaml 不可读则空）。 */
export declare function listProjectModuleIds(root: string): string[];
/** 只有 adopted/历史 skipped 模块允许 baseline-seed 写 resources；普通模块无需创建读锁目录。 */
export declare function listBaselineSeedModuleIds(root: string): string[];
/**
 * F7：多模块**读锁区间**——index/sync 等在读取/扫描 logos/resources（可能含多模块权威 provenance 文档）**之前**
 * 调用：按确定顺序（排序，防死锁）取**所有相关模块**锁，恢复各自未终结 journal，再把这些锁**持有到 fn 完成**，
 * 从而「取锁—检查/恢复—读取」为同一区间。任一模块锁被占用（writer 在飞行）→ 回滚已取锁、返回 inProgress，
 * 调用方据此非零退出、**不做任何扫描/迁移/写副作用**。
 */
export declare function withRecoveredReadLocks<T>(root: string, at: string, moduleIds: string[], fn: () => T): {
    ok: true;
    value: T;
} | {
    ok: false;
    inProgress: string[];
};
//# sourceMappingURL=baseline-seed-txn.d.ts.map