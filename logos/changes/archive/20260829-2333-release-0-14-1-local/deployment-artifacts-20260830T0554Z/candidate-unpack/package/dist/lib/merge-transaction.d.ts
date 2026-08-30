export declare const MERGE_TRANSACTION_SCHEMA: "openlogos/merge-transaction@1";
export declare const MERGE_TRANSACTION_FILE = "MERGE_TRANSACTION.json";
export declare const MERGE_TRANSACTION_SCHEMA_PATH = "spec/schema/merge-transaction.schema.json";
export type MergeTransactionPhase = 'collecting' | 'ready' | 'sealed' | 'applying' | 'completed' | 'failed';
export type MergeTransactionAction = 'submit_content' | 'seal' | 'apply' | 'recover' | 'abort';
export type MergeTransactionClassification = 'invalid_phase' | 'action_not_allowed' | 'content_slot_missing' | 'slot_identity_mismatch' | 'source_hash_mismatch' | 'before_hash_mismatch' | 'target_set_mismatch' | 'seal_mismatch' | 'apply_conflict' | 'receipt_mismatch' | 'legacy_manifest_rejected' | 'unsupported_contract' | 'recovery_required' | 'internal_failure' | 'aborted';
export declare const MERGE_TRANSACTION_ACTION_COMMANDS: Readonly<Record<MergeTransactionAction, string>>;
export declare function mergeTransactionCommandForAction(action: string): string | null;
interface StoredTarget {
    slot_id: string;
    delta_path: string;
    target_path: string;
    mode: 'CREATE' | 'MODIFY';
    category: string;
    producer: 'agent' | 'openlogos';
    source_sha256: string;
    before_sha256: string | null;
    content_sha256: string | null;
    sealed_sha256: string | null;
}
export interface MergeTransactionPathHash {
    path: string;
    sha256: string;
}
export interface MergeContentSlotDescriptor {
    slot_id: string;
    target_ref: string;
    staging_path: string;
    required: true;
    content_encoding: 'utf8-raw';
    max_bytes: number;
    write_protocol: 'atomic-rename';
    submitted_sha256: string | null;
}
export interface MergeTransactionReceipt {
    transaction_id: string;
    seal_sha256: string;
    target_set_sha256: string;
    closure_sha256: string;
    target_count: number;
    plan_sha256: string;
    change: string;
    module: string;
    changed_paths: string[];
    created_paths: string[];
    final_hashes: MergeTransactionPathHash[];
    metadata_summaries: Array<Record<string, unknown>>;
    test_change_set: Record<string, unknown> | null;
    spec_merged: {
        path: string;
    };
    commit_paths: string[];
    receipt_sha256: string;
    completed_at: string;
}
interface StoredTransaction {
    schema: typeof MERGE_TRANSACTION_SCHEMA;
    transaction_id: string;
    slug: string;
    module: string;
    phase: MergeTransactionPhase;
    classification: MergeTransactionClassification | null;
    plan_sha256: string;
    target_set_sha256: string;
    schema_sha256: string;
    contract_sha256: string;
    seal_sha256: string | null;
    targets: StoredTarget[];
    receipt: MergeTransactionReceipt | null;
    artifact_hashes?: MergeTransactionPathHash[];
    aborted_at?: string | null;
    created_at: string;
    updated_at: string;
}
export interface MergeTransactionProjection {
    schema: typeof MERGE_TRANSACTION_SCHEMA;
    transaction_id: string;
    slug: string;
    phase: MergeTransactionPhase;
    classification: MergeTransactionClassification | null;
    allowed_actions: MergeTransactionAction[];
    next_action: MergeTransactionAction | null;
    target_set_sha256: string;
    seal_sha256: string | null;
    schema_sha256: string;
    contract_sha256: string;
    content_slots: {
        required: number;
        submitted: number;
        missing_slot_ids: string[];
        items: MergeContentSlotDescriptor[];
    };
    receipt: MergeTransactionReceipt | null;
    artifact_hashes: MergeTransactionPathHash[];
    aborted_at: string | null;
}
export interface MergeTransactionPlanTarget {
    slot_id: string;
    target_ref: string;
    delta_path: string;
    target_path: string;
    mode: 'CREATE' | 'MODIFY';
    producer: 'agent' | 'openlogos';
    staging_path: string | null;
}
export declare class MergeTransactionError extends Error {
    readonly classification: MergeTransactionClassification;
    readonly retryable: boolean;
    readonly transaction?: MergeTransactionProjection | undefined;
    constructor(classification: MergeTransactionClassification, message: string, retryable: boolean, transaction?: MergeTransactionProjection | undefined);
}
export declare function projectMergeTransaction(tx: StoredTransaction, proposalDir: string): MergeTransactionProjection;
export declare function listMergeTransactionPlanTargets(proposalDir: string): MergeTransactionPlanTarget[];
export declare function createMergeTransaction(root: string, proposalDir: string, slug: string): MergeTransactionProjection;
export declare function readMergeTransaction(proposalDir: string): MergeTransactionProjection;
export declare function readMergeTransactionIfPresent(proposalDir: string): MergeTransactionProjection | null;
export declare function submitMergeContent(proposalDir: string, slotId: string, submittedFilePath: string): MergeTransactionProjection;
export declare function sealMergeTransaction(root: string, proposalDir: string): MergeTransactionProjection;
export declare function abortMergeTransaction(proposalDir: string): MergeTransactionProjection;
export declare function applyMergeTransaction(root: string, proposalDir: string): MergeTransactionProjection;
export declare function recoverMergeTransaction(root: string, proposalDir: string): MergeTransactionProjection;
export declare function removeSubmittedContent(proposalDir: string, slotId: string): void;
export {};
//# sourceMappingURL=merge-transaction.d.ts.map