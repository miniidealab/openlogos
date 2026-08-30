import { type DeltaEntryClassification } from './delta-classify.js';
export declare const BASELINE_CLOSURE_POLICY: "on-touch-v1";
export declare const BASELINE_CLOSURE_MODES: readonly ["MODIFY", "CREATE", "SKIP", "AMBIGUOUS"];
export type BaselineClosureMode = typeof BASELINE_CLOSURE_MODES[number];
export declare const BASELINE_CLOSURE_CATEGORIES: readonly ["requirement", "feature", "architecture", "scenario", "api", "database", "test", "orchestration", "deployment", "smoke", "spec", "skill", "decision"];
export type BaselineClosureCategory = typeof BASELINE_CLOSURE_CATEGORIES[number];
export declare const BASELINE_CLOSURE_VIOLATION_CODES: readonly ["baseline_closure_declaration_missing", "baseline_closure_malformed", "baseline_closure_target_missing", "delta_target_duplicate", "delta_target_mode_mismatch", "baseline_closure_ambiguous", "delta_target_unplanned", "create_target_incomplete", "non_markdown_delta_invalid"];
export type BaselineClosureViolationCode = typeof BASELINE_CLOSURE_VIOLATION_CODES[number];
export interface BaselineClosureViolation {
    code: BaselineClosureViolationCode;
    /** 项目根相对路径。 */
    path: string;
    message: string;
    fix_hint: string;
}
export interface BaselineClosureTarget {
    scenarioIds: string[];
    category: BaselineClosureCategory;
    deltaPath: string | null;
    targetPath: string | null;
    canonicalTargetPath: string | null;
    mode: BaselineClosureMode;
    reason: string;
    applicabilityEvidence: string[];
    missingEvidence: string[];
}
export interface BaselineClosurePlan {
    policy: typeof BASELINE_CLOSURE_POLICY;
    schemaVersion: 1;
    touchedScenarioIds: string[];
    targets: BaselineClosureTarget[];
}
export interface BaselineClosureSummary {
    policy: typeof BASELINE_CLOSURE_POLICY;
    stage: 'plan' | 'spec';
    touched_scenarios: number;
    targets_declared: number;
    targets_total: number;
    modify: number;
    create: number;
    skip: number;
    ambiguous: number;
    planned_delta_targets: number;
    actual_delta_targets: number;
}
export interface BaselineClosureEvaluation {
    active: boolean;
    plan?: BaselineClosurePlan;
    summary?: BaselineClosureSummary;
    violations: BaselineClosureViolation[];
}
export interface CanonicalTargetResolution {
    deltaPath: string;
    targetPath: string;
    canonicalTargetPath: string;
    category: string;
    semanticCategory: BaselineClosureCategory | null;
}
/**
 * canonical target 的语义类别分类器。所有 plan/L9/apply 调用点必须消费本函数，
 * 禁止相信 proposal 中可伪造的 category 字段或仅相信 deltas 一级目录。
 */
export declare function classifyCanonicalTargetCategory(targetPath: string): BaselineClosureCategory | null;
/**
 * delta 路径 → canonical merge target。统一分隔符/安全 `.`，拒绝绝对路径、`..`、未知类别及 symlink escape。
 */
export declare function resolveCanonicalMergeTarget(root: string, proposalDir: string, rawDeltaPath: string): CanonicalTargetResolution | null;
/** 兼容既有调用名；无法做 containment 时仍只返回经映射且词法安全的项目路径。 */
export declare function canonicalTargetFromDeltaPath(rawDeltaPath: string): string | null;
/**
 * L9 激活判据的唯一入口：历史提案（无声明且 tasks 无模式）必须保持 legacy 零漂移；
 * 声明或 `[MODIFY]/[CREATE]` 任一在场则进入 fail-closed on-touch 校验。
 */
export declare function hasBaselineClosureSignal(proposalContent: string, tasksContent: string): boolean;
interface ParsedPlanResult {
    plan?: BaselineClosurePlan;
    violations: BaselineClosureViolation[];
}
export declare function parseBaselineClosurePlan(root: string, proposalDir: string, proposalContent: string, proposalRelPath: string): ParsedPlanResult;
export interface ParsedTaskTarget {
    checked: boolean;
    mode: 'MODIFY' | 'CREATE';
    deltaPath: string;
    targetPath: string;
    canonicalTargetPath: string;
}
export declare function parseBaselineClosureTaskTargets(root: string, proposalDir: string, tasksContent: string): {
    hasModeSyntax: boolean;
    targets: ParsedTaskTarget[];
    invalid: string[];
};
export interface NonMarkdownDeltaResult {
    ok: boolean;
    payload?: string;
    message?: string;
}
export type DatabaseDialect = 'sqlite' | 'postgresql' | 'mysql';
/** 从合并后的项目 tech_stack 解析 SQL 方言；缺失、冲突或未知时一律 fail-closed。 */
export declare function resolveProjectDatabaseDialect(root: string): {
    dialect?: DatabaseDialect;
    error?: string;
};
/**
 * 校验并剥离 API/DB non-Markdown delta 首行。返回的 payload 不含 marker，调用方不得把 marker 写入目标。
 */
export declare function validateAndStripNonMarkdownDelta(content: string, mode: 'MODIFY' | 'CREATE', canonicalTargetPath: string, options?: {
    root?: string;
    databaseDialect?: DatabaseDialect;
}): NonMarkdownDeltaResult;
export interface EvaluateBaselineClosureOptions {
    root: string;
    proposalDir: string;
    slug: string;
    proposalContent: string;
    tasksContent: string;
    deltaEntries: DeltaEntryClassification[];
    deltaContents: Map<string, string>;
}
/** 共享 ClosureEvaluator：legacy 返回 active=false；on-touch-v1 对 plan/spec 执行完整闭包。 */
export declare function evaluateBaselineClosure(options: EvaluateBaselineClosureOptions): BaselineClosureEvaluation;
/** Effective view：目标不存在视为空；当前 change 同目标必须唯一，否则不定义 last-wins。 */
export declare function effectiveTargetView(root: string, target: BaselineClosureTarget, deltaContents: Map<string, string>): {
    ok: true;
    mergedBytes: string | null;
    deltaBytes: string | null;
} | {
    ok: false;
    reason: string;
};
/** EvidenceScanner 只采信已合并 resources；显式排除 baseline-seed run staging/resolved/backup。 */
export declare function scanCommittedEvidenceFiles(root: string, paths: string[]): string[];
/** 供测试/诊断显示 root 相对位置。 */
export declare function projectRelativePath(root: string, path: string): string;
export {};
//# sourceMappingURL=baseline-closure.d.ts.map