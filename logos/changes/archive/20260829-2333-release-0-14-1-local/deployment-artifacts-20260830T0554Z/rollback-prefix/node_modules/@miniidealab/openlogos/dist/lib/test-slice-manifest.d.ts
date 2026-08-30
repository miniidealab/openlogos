export declare const TEST_SLICE_MANIFEST = "TEST_SLICE_MANIFEST.json";
export declare const SLICE_CHECKPOINTS = "SLICE_CHECKPOINTS.jsonl";
export declare const TEST_SLICE_SCHEMA = "openlogos/test-slice-manifest@1";
export declare const SLICE_CHECKPOINT_SCHEMA = "openlogos/slice-checkpoint@1";
export interface TestSliceManifestSlice {
    slice_id: string;
    task_text: string;
    owned_test_ids: string[];
    runner_selectors: string[];
    spec_targets: string[];
    [key: string]: unknown;
}
export interface TestSliceManifestV1 {
    schema: typeof TEST_SLICE_SCHEMA;
    change: string;
    module: string;
    task_fingerprint: string;
    spec_fingerprint: string;
    generated_at: string;
    slices: TestSliceManifestSlice[];
    [key: string]: unknown;
}
export type TestSliceManifestStatus = 'valid' | 'missing' | 'invalid' | 'stale' | 'unsupported';
export type SliceVerifyMode = 'slice-checkpoint' | 'final';
export interface TestSliceViolation {
    code: string;
    path: string;
    message: string;
    fix_hint: string;
}
export interface SliceManifestSummary {
    status: TestSliceManifestStatus;
    path: string;
    schema: string | null;
    task_fingerprint: string | null;
    spec_fingerprint: string | null;
    sha256: string | null;
}
export interface SliceCheckpointSummary {
    final: boolean;
    result: 'PASS' | 'FAIL' | null;
    confirmed_slice_ids: string[];
}
export interface SliceVerificationState {
    manifest_status: TestSliceManifestStatus;
    verify_mode: SliceVerifyMode | null;
    attempted_slice_id: string | null;
    confirmed_slice_ids: string[];
    eligible_test_ids: string[];
    pending_test_ids: string[];
    reason?: string;
    human_action_required?: boolean;
    violations?: TestSliceViolation[];
    test_change_set?: {
        status: 'valid' | 'invalid';
        schema: string | null;
        sha256: string | null;
        changed_test_ids: string[];
        removed_test_ids: string[];
    };
    manifest: SliceManifestSummary;
    checkpoint: SliceCheckpointSummary;
    manifest_data?: TestSliceManifestV1;
}
export declare function computeTaskFingerprint(tasksContent: string): string;
export declare function computeSpecFingerprint(root: string, targets: string[]): string;
export declare function extractDefinedVerificationIds(root: string): string[];
export declare function extractChangedTestIds(proposalDir: string): string[];
export declare function shouldUseSliceVerification(proposalDir: string): boolean;
export declare function deriveSliceVerificationState(root: string, proposalDir: string, expected?: {
    change?: string;
    module?: string;
}): SliceVerificationState | null;
export declare function eligibleIdsFingerprint(ids: string[]): string;
export declare function appendSliceCheckpoint(proposalDir: string, state: SliceVerificationState, result: 'PASS' | 'FAIL', timestamp?: string): boolean;
export declare function writeTestSliceManifestAtomic(path: string, manifest: TestSliceManifestV1): void;
//# sourceMappingURL=test-slice-manifest.d.ts.map