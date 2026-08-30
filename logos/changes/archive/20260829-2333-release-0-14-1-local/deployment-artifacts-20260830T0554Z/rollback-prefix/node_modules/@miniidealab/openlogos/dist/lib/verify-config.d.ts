import { type NormalizedSandboxConfig } from './sandbox.js';
export declare const DEFAULT_VERIFY_RESULT_PATH = "logos/resources/verify/test-results.jsonl";
export declare const DEFAULT_VERIFY_MERGE_STRATEGY = "last-write-wins";
export declare const DEFAULT_SANDBOX_MODE = "auto";
export declare const DEFAULT_SANDBOX_ROOT = "/private/tmp";
export declare const DEFAULT_SANDBOX_DENY_WORKSPACE_WRITE = true;
export interface VerifyConfig {
    result_path?: string;
    pre_run_command?: string;
    test_command?: string;
    regression_command?: string;
    incremental_command?: string;
    regression_result_path?: string;
    incremental_result_path?: string;
    merge_results?: string;
    sandbox_mode?: 'off' | 'auto' | 'always';
    sandbox_root?: string;
    sandbox_deny_workspace_write?: boolean;
}
export interface NormalizedVerifyConfig {
    resultPath: string;
    preRunCommand?: string;
    regressionCommand?: string;
    incrementalCommand?: string;
    regressionResultPath?: string;
    incrementalResultPath?: string;
    mergeStrategy: 'last-write-wins';
    sandbox: NormalizedSandboxConfig;
}
export interface VerifyPreRunBackfillResult {
    status: 'exists' | 'added' | 'todo';
    command?: string;
    mutated: boolean;
}
export declare function inferVerifyPreRunCommand(root: string): string | null;
export declare function normalizeVerifyConfig(rawVerify: unknown): NormalizedVerifyConfig;
export declare function readVerifyConfig(root: string): NormalizedVerifyConfig;
export declare function hasVerifyPreRunConfig(rawVerify: unknown): boolean;
export declare function backfillVerifyPreRunConfig(root: string, config: Record<string, unknown>): VerifyPreRunBackfillResult;
//# sourceMappingURL=verify-config.d.ts.map