import type { LoopState, SliceState } from './flow-loop-derive.js';
export type CompletionState = 'slice_done' | 'slice_done_global_verify_failed' | 'slice_incomplete' | 'invalid_done_claim' | 'no_progress';
export type AutomationDiagnosticReason = 'artifact-missing' | 'artifact-out-of-scope' | 'focused-tests-missing' | 'reporter-missing' | 'global-verify-failed' | 'driver-cannot-validate-artifacts' | 'no-progress';
export interface AutomationDiagnostic {
    reason: AutomationDiagnosticReason;
    completion_state: CompletionState;
    failed_tests: string[];
    required_test_ids: string[];
    validated_artifacts: string[];
    missing_artifacts: string[];
    suggested_next_node: 'code' | 'plan-slices' | 'verify' | 'manual';
    human_action_required: boolean;
    remediation: string;
}
export interface DeriveAutomationDiagnosticOptions {
    proposalDir?: string | null;
    requiredTestIds?: string[];
    declaredArtifacts?: string[];
    allowedArtifactPrefixes?: string[];
    loopState?: LoopState | null;
    sliceState?: SliceState | null;
    verifyGate?: 'PASS' | 'FAIL' | null;
    failedTests?: string[];
}
export declare function canConsumeAutomationDiagnosticAtStep(step: string | null | undefined): boolean;
export declare function deriveAutomationDiagnostic(root: string, opts?: DeriveAutomationDiagnosticOptions): AutomationDiagnostic | null;
//# sourceMappingURL=automation-diagnostic.d.ts.map