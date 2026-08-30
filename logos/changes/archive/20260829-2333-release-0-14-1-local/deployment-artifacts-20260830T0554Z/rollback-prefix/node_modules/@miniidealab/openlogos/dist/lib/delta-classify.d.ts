export declare const DELTA_TO_RESOURCE: Record<string, string>;
export type MergeDisposition = 'mergeable' | 'ignored';
export type LintValidity = 'valid' | 'explicitly_ignored' | 'invalid';
export interface DeltaEntryClassification {
    /** 相对提案目录，如 `deltas/prd/x.md`（POSIX 分隔）。 */
    relativePath: string;
    /** deltas 下的一级类别；根条目为 ''。 */
    category: string;
    mergeDisposition: MergeDisposition;
    lintValidity: LintValidity;
    invalidReason?: string;
    /** 枚举/元数据读取失败：命令层立即映射 artifact_unreadable（fail loud，不吞）。 */
    ioError?: string;
    /**
     * r5 F7：提案边界内、可安全做内容可读性探测的条目——本地普通文件，或解析后落在提案目录内
     * 且目标为普通文件的 symlink。与 mergeDisposition/lintValidity **正交**：reference/隐藏/unknown/
     * 根下直放等被 L6 忽略或判非法的**本地**文件同样必须探测（「delta 任一不可读 → artifact_unreadable」
     * 是操作级红线，不因消费集合排除而豁免）；逃逸/断链 symlink、目录与非常规文件恒不解引用（F3 边界保持）。
     */
    contentProbeEligible?: boolean;
}
/**
 * r4 F7：消费边界的错误态显式化——分类结果含 ioError 条目时，投影型消费方（merge `scanDeltas`）
 * 抛本错误而非把错误条目过滤成空清单（否则「产物不可读」会被 no-delta 早退写成 SPEC_MERGED 假成功）。
 */
export declare class DeltaScanUnreadableError extends Error {
    readonly entry: DeltaEntryClassification;
    constructor(entry: DeltaEntryClassification);
}
export declare function classifyProposalDeltas(proposalDir: string): DeltaEntryClassification[];
/** L3 证据清单的唯一来源（F6）：本提案 deltas/test/** 中实际可合并且路径合法的条目（相对 deltas/test/ 的路径）。 */
export declare function listEvidenceTestDeltaFiles(proposalDir: string): string[];
//# sourceMappingURL=delta-classify.d.ts.map