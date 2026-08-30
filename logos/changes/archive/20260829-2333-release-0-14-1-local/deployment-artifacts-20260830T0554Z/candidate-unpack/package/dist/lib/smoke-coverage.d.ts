export type SmokeCoverageDiagnosticCode = 'smoke_runner_missing' | 'smoke_reporter_missing' | 'smoke_cases_uncovered';
export interface SmokeCoverageDiagnostic {
    code: SmokeCoverageDiagnosticCode;
    message: string;
    case_ids?: string[];
    command?: string | null;
    result_path?: string;
    runner_paths?: string[];
}
export interface SmokeCoverageCheck {
    result: 'PASS' | 'FAIL';
    changed_case_ids: string[];
    executed_case_ids: string[];
    uncovered_case_ids: string[];
    diagnostics: SmokeCoverageDiagnostic[];
    runners: string[];
    command: string | null;
    result_path: string;
}
export interface SmokeCoverageOptions {
    slug?: string;
    command?: string | null;
    resultPath?: string;
}
/**
 * 统一 smoke dispatcher 是项目级约定入口；显式配置优先，未配置但入口文件在场时
 * 使用确定性默认值。这样本地 config 未纳入版本控制时，verify/smoke 仍能识别已交付 runner。
 */
export declare function resolveSmokeCommand(root: string, configured?: string | null): string | null;
export declare function extractSmokeIdsFromContent(content: string): string[];
export declare function extractChangedSmokeIds(root: string, slug?: string): string[];
export declare function discoverSmokeRunners(root: string): string[];
export declare function checkSmokeCoverage(root: string, options?: SmokeCoverageOptions): SmokeCoverageCheck;
//# sourceMappingURL=smoke-coverage.d.ts.map