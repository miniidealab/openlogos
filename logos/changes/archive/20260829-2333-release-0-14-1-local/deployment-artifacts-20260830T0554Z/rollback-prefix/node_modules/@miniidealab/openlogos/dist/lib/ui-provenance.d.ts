export declare const PLAN_APPROVED = "PLAN_APPROVED";
export declare const COMMIT_JOURNAL = "UI_COMMIT_JOURNAL.json";
/** 原型资产在提案 delta 下的相对路径（源）与 resources 落盘目标（相对项目根）。 */
export declare const PROTOTYPE_DELTA_SUBPATH: string;
export declare const PROTOTYPE_RESOURCE_SUBPATH: string;
export interface PlanApprovedProvenance {
    present: boolean;
    empty: boolean;
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
/** 读 PLAN_APPROVED marker 及其可选 JSON body（向后兼容：空 marker 合法）。 */
export declare function readPlanApproved(proposalDir: string): PlanApprovedProvenance;
/**
 * 写 PLAN_APPROVED（向后兼容超集）：
 * - 无 provenance → 空写（仅当文件不存在时写空，保持存在性语义、不覆盖已有 body）；
 * - 有 provenance → 写 JSON body（`{ui_prototype_rendered, pages, hashes}`）。
 */
export declare function writePlanApprovedMarker(proposalDir: string, provenance?: {
    ui_prototype_rendered: boolean;
    pages: string[];
    hashes: Record<string, string>;
} | null): void;
/**
 * 分类持久化批准记录：
 * - full   = ui_prototype_rendered:true 且 hashes 非空（曾渲染确认）；
 * - partial= ui_prototype_rendered:true 但缺/空 hashes（部分 provenance，不得误判 legacy）；
 * - legacy = 无「曾渲染」证据（空 marker / 无 ui_prototype_rendered / 缺 marker）。
 */
export declare function classifyProvenance(prov: PlanApprovedProvenance): ProvenanceClass;
/**
 * full provenance 的结构完整性（F3）：rendered:true 之外还要求——
 * hashes 非空、pages 非空、pages/hashes 键均为合法 basename 且无重复、pages 集合 == hashes 键集合。
 * 任一不满足 ⇒ 非 full（归 partial，fail closed），杜绝「有 hashes 无 pages / pages 与 hashes 脱钩」的损坏批准记录被放行。
 */
export declare function isFullProvenanceValid(prov: PlanApprovedProvenance): boolean;
/** 计算目录下所有 .html 原型的 {basename: sha256}。 */
export declare function computePrototypeHashes(dir: string): Record<string, string>;
export interface HashMatchResult {
    ok: boolean;
    advisory: boolean;
    cls: ProvenanceClass;
    code: string;
    detail?: string;
}
/**
 * check-ui-hash-match 三分支（与 merge/落盘一致，键=持久化 PLAN_APPROVED）：
 * - full  : 重算 sourceDir 现值 hash 与 prov.hashes 逐一比对 → 全匹配 ok；缺失/损坏/失配 fail closed。
 * - legacy: 记 advisory 后 ok（不要求 hashes、不阻断）。
 * - partial: fail closed（曾宣称渲染却缺 hashes 无法追溯）。
 * sourceDir 默认 = proposalDir/deltas/.../2-page-design（merge 前的原型 delta 源）。
 */
export declare function checkUiHashMatch(proposalDir: string, sourceDir?: string): HashMatchResult;
export interface CommitResult {
    ok: boolean;
    advisory: boolean;
    cls: ProvenanceClass;
    committed: string[];
    reason?: string;
    rolledBack?: boolean;
}
/**
 * 原型资产落盘的**唯一命名入口**。三段事务：
 * ① 全量校验 staged 字节（先把源拷入私有 staging，对 staged 副本算 hash 比对 PLAN_APPROVED.hashes，
 *    任一不符即在写入任何 target 前 abort，消除 verify-to-stage 竞态）；
 * ② 写 commit journal；③ 逐条原子 rename 提交（失败回滚，恢复 backup、删 staging）。
 * 落盘后复核 target hash。全有或全无、失败零残留。
 * mode 由持久化 provenance 决定：full 严格 hash 校验；legacy advisory（同一入口、不做严格校验）；partial 直接 abort。
 */
export declare function commitVerifiedPrototypes(proposalDir: string, root: string): CommitResult;
/**
 * 崩溃恢复：检测残留 commit journal → 前滚（补完未完成 rename）或回滚（还原 backup），
 * 到达一致的全有或全无态，恢复后清 journal。
 * 返回 'rolled_forward' | 'rolled_back' | 'none' | 'failed'。
 * **fail closed（F1，code-r2）**：JSON 损坏/截断、schema 非法（targets 非数组）、任一 entry 路径越界/类型不符、
 * 或恢复 I/O 失败 ⇒ 返回 'failed' 且**不删除 journal/staging/backup、不改动任何文件**（保留诊断材料）；
 * 由调用方（merge）非零退出，绝不把部分提交态当正常推进。
 */
export declare function recoverCommitJournal(proposalDir: string): 'rolled_forward' | 'rolled_back' | 'none' | 'failed';
//# sourceMappingURL=ui-provenance.d.ts.map