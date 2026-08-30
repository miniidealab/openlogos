interface DeltaFile {
    deltaPath: string;
    targetDir: string;
    relativePath: string;
}
/**
 * S35 code-r1 F2：merge 的 delta 消费集合 = 共享分类器的**无逻辑投影**
 * （`classifyProposalDeltas(...).filter(mergeDisposition === 'mergeable')`）。
 * 路径枚举、隐藏规则、symlink containment 与 IO 错误只在 delta-classify.ts 实现一次——
 * 判据改一处，消费点（merge）与检查点（lint L6）同时生效。
 */
export declare function scanDeltas(deltasDir: string): DeltaFile[];
export declare function merge(slug?: string): void;
export {};
//# sourceMappingURL=merge.d.ts.map