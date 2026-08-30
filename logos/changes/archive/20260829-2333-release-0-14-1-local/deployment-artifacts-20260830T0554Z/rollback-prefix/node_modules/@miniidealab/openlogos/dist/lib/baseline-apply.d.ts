export declare const BASELINE_CLOSURE_APPLY_JOURNAL = "BASELINE_CLOSURE_APPLY_JOURNAL.json";
export interface NonMarkdownApplyInput {
    kind: 'non-markdown';
    deltaPath: string;
    mode: 'CREATE' | 'MODIFY';
    deltaBytes: string | Buffer;
}
/** merge-executor 已在内存中算好的 Markdown/metadata/marker 最终字节。 */
export interface PreparedApplyInput {
    kind: 'prepared';
    targetPath: string;
    mode: 'CREATE' | 'MODIFY';
    bytes: string | Buffer;
}
export type BaselineClosureApplyInput = NonMarkdownApplyInput | PreparedApplyInput;
export interface BaselineClosureApplyHook {
    /** 故障注入/宿主审计钩子；抛错会触发整批回滚。 */
    afterWrite?(targetPath: string, index: number): void;
    /** 全部目标已落盘但 backup/journal 尚未清理时执行；抛错仍可整批回滚。 */
    validateCommitted?(): void;
}
export interface BaselineClosureApplySuccess {
    ok: true;
    applied: Array<{
        target_path: string;
        mode: 'CREATE' | 'MODIFY';
        sha256: string;
    }>;
}
export interface BaselineClosureApplyFailure {
    ok: false;
    error: string;
    rolled_back: boolean;
}
export type BaselineClosureApplyResult = BaselineClosureApplySuccess | BaselineClosureApplyFailure;
/**
 * 恢复上次崩溃事务。prepared/committing 一律回滚全旧；committed 只验证全新后清理私有材料。
 */
export declare function recoverBaselineClosureApply(root: string, proposalDir: string): {
    ok: true;
    recovered: 'none' | 'rolled_back' | 'committed';
} | {
    ok: false;
    error: string;
};
/**
 * 应用一个 baseline-on-touch 批次。所有输入先完成预检；成功才写，失败返回前尝试恢复全旧。
 */
export declare function applyBaselineClosureBatch(root: string, proposalDir: string, inputs: BaselineClosureApplyInput[], hook?: BaselineClosureApplyHook): BaselineClosureApplyResult;
//# sourceMappingURL=baseline-apply.d.ts.map