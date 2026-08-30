import type { MergeTransactionProjection, MergeTransactionReceipt } from './merge-transaction.js';
export declare const MERGE_TRANSACTION_SEMANTIC_SCHEMA: "openlogos/merge-transaction-semantic@1";
export interface MergeTransactionSemanticViolation {
    code: string;
    path: string;
    message: string;
}
export interface MergeTransactionSemanticResult {
    schema: typeof MERGE_TRANSACTION_SEMANTIC_SCHEMA;
    ok: boolean;
    violations: MergeTransactionSemanticViolation[];
}
export declare function canonicalMergeJson(value: unknown): string;
export declare function mergeSha256(bytes: string | Buffer): string;
export declare function computeMergeReceiptSha256(receipt: Omit<MergeTransactionReceipt, 'receipt_sha256'> | MergeTransactionReceipt): string;
export declare function validateMergeTransactionSemantics(tx: MergeTransactionProjection): MergeTransactionSemanticResult;
export declare function assertMergeTransactionSemantics(tx: MergeTransactionProjection): void;
//# sourceMappingURL=merge-transaction-semantic.d.ts.map