import type { OutputFormat } from '../lib/json-output.js';
import { type SandboxData } from '../lib/sandbox.js';
import { type SmokeCoverageCheck, type SmokeCoverageDiagnostic } from '../lib/smoke-coverage.js';
export interface SmokeData {
    environment: string | null;
    summary: {
        defined_count: number;
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
    changed_cases: string[];
    diagnostics: SmokeCoverageDiagnostic[];
    runners: string[];
    failed_cases: Array<{
        id: string;
        error: string;
    }>;
    uncovered_cases: string[];
    skipped_cases: string[];
    sandbox: SandboxData;
    report_path: string;
    result_path: string;
}
export declare function extractSmokeDefinedIds(root: string): string[];
export declare function collectSmokeData(root: string, environment?: string, sandbox?: SandboxData, coverageCheck?: SmokeCoverageCheck): SmokeData;
export declare function smoke(format?: OutputFormat, environment?: string): void;
//# sourceMappingURL=smoke.d.ts.map