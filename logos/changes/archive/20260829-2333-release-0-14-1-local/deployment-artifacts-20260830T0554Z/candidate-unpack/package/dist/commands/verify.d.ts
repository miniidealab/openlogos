import type { OutputFormat } from '../lib/json-output.js';
import { type NormalizedVerifyConfig } from '../lib/verify-config.js';
import { type SandboxData } from '../lib/sandbox.js';
import { type SmokeCoverageCheck } from '../lib/smoke-coverage.js';
import { type AutomationDiagnostic } from '../lib/automation-diagnostic.js';
import { type SliceVerificationState } from '../lib/test-slice-manifest.js';
export interface TestResult {
    id: string;
    status: 'pass' | 'fail' | 'skip';
    duration_ms?: number;
    timestamp?: string;
    error?: string;
    scenario?: string;
}
export interface VerifyInvalidResult {
    line: number;
    id?: string;
    status?: string;
    reason: string;
}
export interface VerifyConsistencyData {
    ok: boolean;
    reasons: string[];
    unknown_result_ids: string[];
    manual_result_ids: string[];
    outside_eligible_result_ids: string[];
    invalid_results: VerifyInvalidResult[];
    count_mismatches: string[];
}
export interface ChecklistItem {
    checked: boolean;
    text: string;
    file: string;
}
export interface AcTraceEntry {
    acId: string;
    description: string;
    linkedCaseIds: string[];
    file: string;
}
export type VerifyPreRunMode = 'none' | 'pre_run_command' | 'two_phase';
export type VerifyPreRunStage = 'pre_run' | 'regression' | 'incremental';
export interface VerifyPreRunCommandResult {
    stage: VerifyPreRunStage;
    command: string;
    status: 'pass' | 'fail' | 'skipped';
    exit_code?: number;
    duration_ms?: number;
    error?: string;
}
export interface VerifyPreRunData {
    mode: VerifyPreRunMode;
    commands: Array<VerifyPreRunCommandResult & {
        sandbox?: SandboxData;
    }>;
    result_paths: {
        final: string;
        regression: string | null;
        incremental: string | null;
    };
    merge_strategy: 'last-write-wins' | null;
    diagnostics: string[];
    suggestions: string[];
}
export interface VerifyData {
    contract: {
        version: string;
    };
    summary: {
        defined_count: number;
        ut_count: number;
        st_count: number;
        manual_count: number;
        executed_count: number;
        passed_count: number;
        failed_count: number;
        skipped_count: number;
        uncovered_count: number;
        coverage_pct: number;
        pass_rate_pct: number;
    };
    gate: {
        result: 'PASS' | 'FAIL';
        reason: string | null;
    };
    failed_cases: Array<{
        id: string;
        error: string;
    }>;
    uncovered_cases: string[];
    skipped_cases: string[];
    consistency: VerifyConsistencyData;
    checklist: {
        total: number;
        checked: number;
        unchecked_items: Array<{
            text: string;
            file: string;
        }>;
    };
    ac_trace: {
        total: number;
        passed: number;
        failed_criteria: Array<{
            ac_id: string;
            description: string;
            linked_case_ids: string[];
            status: string;
        }>;
    };
    pre_run: VerifyPreRunData;
    smoke_precheck: SmokeCoverageCheck;
    sandbox: SandboxData;
    report_path: string;
    verify_mode?: 'slice-checkpoint' | 'final';
    attempted_slice_id?: string | null;
    eligible_test_ids?: string[];
    pending_test_ids?: string[];
    manifest?: SliceVerificationState['manifest'];
    checkpoint?: SliceVerificationState['checkpoint'];
    test_change_set?: SliceVerificationState['test_change_set'];
    automation_diagnostic?: AutomationDiagnostic;
}
export declare function buildInitialPreRunData(config: NormalizedVerifyConfig): VerifyPreRunData;
export interface RunVerifyPreRunResult {
    preRun: VerifyPreRunData;
    sandbox: SandboxData;
}
export declare function runVerifyPreRunWithSandbox(root: string, config: NormalizedVerifyConfig, format: OutputFormat): RunVerifyPreRunResult;
export declare function runVerifyPreRun(root: string, config: NormalizedVerifyConfig, format: OutputFormat): VerifyPreRunData;
import { parseStrictTimestampMs } from '../lib/timestamp.js';
export { parseStrictTimestampMs };
/**
 * 同 ID 去重全序（spec/test-results.md「归一化规则」第 5 条，单文件与两阶段合并共用同一实现）：
 * 1. 该 ID 全部记录时间戳均合法 → 绝对时刻最新优先；同刻（含异时区同刻）→ 文件行序后者优先；
 * 2. 存在任一缺失/非法时间戳 → 该 ID 整组退回文件行序 last-wins（等价旧行为，不对不完整证据做时间猜测）。
 * rows 按文件行序传入；按 ID 分组独立进行。
 */
export declare function selectEffectiveResult<T extends {
    timestamp?: string;
}>(rows: T[]): T;
export declare function parseJsonl(content: string): TestResult[];
export declare function parseJsonlWithDiagnostics(content: string): {
    results: TestResult[];
    invalidResults: VerifyInvalidResult[];
};
export declare function extractDefinedIds(root: string): {
    ids: string[];
    utCount: number;
    stCount: number;
    manualCount: number;
};
export declare function extractChecklist(root: string): ChecklistItem[];
export declare function extractAcTrace(root: string): AcTraceEntry[];
export declare function generateReport(defined: string[], results: TestResult[], passed: TestResult[], failed: TestResult[], skipped: TestResult[], uncovered: string[], coveragePct: string, passRatePct: string, gateResult: 'PASS' | 'FAIL', checklist: ChecklistItem[], acTrace: AcTraceEntry[], _resultIds: Set<string>, manualCount: number, sliceVerification?: SliceVerificationState | null): string;
export interface VerifyCountSummary {
    defined_count: number;
    executed_count: number;
    passed_count: number;
    failed_count: number;
    skipped_count: number;
    uncovered_count: number;
    coverage_pct: number;
    pass_rate_pct: number;
}
export declare function buildVerifyCountMismatches(summary: VerifyCountSummary): string[];
export declare function collectVerifyData(root: string, preRun?: VerifyPreRunData, sliceVerification?: SliceVerificationState | null): VerifyData;
export declare function verify(format?: OutputFormat): void;
//# sourceMappingURL=verify.d.ts.map