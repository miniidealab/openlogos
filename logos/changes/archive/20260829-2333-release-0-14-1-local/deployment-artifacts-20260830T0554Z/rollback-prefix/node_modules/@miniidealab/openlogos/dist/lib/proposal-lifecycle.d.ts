import { type ClarificationOutput } from './clarification.js';
import type { ModuleInfo } from '../commands/status.js';
import type { CompletionIssue, PlanPackageEvaluation } from './plan-package-contract.js';
import { type ManagedAssetsDiagnostic } from './asset-manifest.js';
export type ProposalStep = 'writing' | 'ready-to-delta' | 'delta-writing' | 'ready-to-merge' | 'merge-generated' | 'spec-complete-required' | 'test-id-required' | 'ready-to-implement' | 'coding' | 'ready-to-verify' | 'verify-passed' | 'verify-failed' | 'ready-to-deploy' | 'deploy-done' | 'ready-to-smoke' | 'smoke-passed' | 'smoke-failed' | 'implementing' | 'in-progress';
export type DeploymentDecisionSource = 'proposal' | 'tasks' | 'module-default' | 'legacy-fallback';
export interface ProposalDeploymentDecision {
    deployment_required: boolean | null;
    smoke_required: boolean | null;
    deployment_reason: string | null;
    deployment_decision_source: DeploymentDecisionSource;
    deployment_decision_conflict: boolean;
    deployment_decision_conflict_reason: string | null;
    deployment_warnings: string[];
}
export type DeploymentProgressStatus = 'pending' | 'done' | 'empty' | 'unavailable';
export interface DeploymentProgress {
    checked: number;
    total: number;
    percent: number;
    status: DeploymentProgressStatus;
    label: string;
}
export interface DeploymentDocument {
    path: string;
    name: 'tasks.md';
    exists: boolean;
}
export interface TaskItem {
    checked: boolean;
    text: string;
}
export interface CodePlanningDiagnostic {
    reason: 'tasks-code-section-missing' | 'slices-not-planned';
    tasksPath: string;
    remediation: string;
}
export type ProposalBlockReason = 'no_delta_spec_marker_missing' | 'code_change_requires_real_test_ids' | 'test-slice-manifest-missing' | 'test-slice-manifest-invalid' | 'test-slice-manifest-stale' | 'test-slice-manifest-unsupported' | 'test-slice-assignment-ambiguous' | 'slice-task-state-inconsistent';
export type TasksExecutionScope = 'delta' | 'deploy' | 'code' | 'none';
export interface PlanState {
    plan_ready: boolean;
    plan_gate_pending: boolean;
    plan_approved: boolean;
    tasks_template_filled: boolean;
    tasks_execution_done: number;
    tasks_execution_total: number;
    tasks_execution_scope: TasksExecutionScope;
    plan_package: PlanPackageEvaluation;
    completion_contract_version: string;
    completion_issues: CompletionIssue[];
    proposal_filled: boolean;
    tasks_plan_filled: boolean;
    tasks_code_required: boolean;
    tasks_code_slices_filled: boolean;
    managed_assets: ManagedAssetsDiagnostic;
    diagnostic?: string;
    clarification?: ClarificationOutput;
}
export declare const PLAN_APPROVED_MARKER = "PLAN_APPROVED";
export declare const SLICES_APPROVED_MARKER = "SLICES_APPROVED";
export declare function isDeploymentSectionTemplateFilled(content: string): boolean;
export declare function isProposalTemplateFilled(content: string): boolean;
export declare function isTasksTemplateFilled(content: string): boolean;
export declare function isTasksCodeFilled(content: string): boolean;
export declare function isCodeRequiredForProposal(proposalDir: string, tasksContent?: string, sections?: Record<string, {
    checked: number;
    total: number;
}> | null): boolean;
/**
 * ID 闭合文法兼容基线：现行宽语法的锚定整串版（spec §2.30，与 TEST_CASE_ID_PATTERN 同构、仅改整串锚定）。
 * r4 F20：点号仅允许作段内分隔（如 `01.1`）——候选以 `.` 开头/结尾或含空 dot 段（`xx.`、`a..b`）不构成 ID，
 * 否则 `UT-S99-xx.` 的尾段变成 `xx.`、绕过占位黑名单的整段精确匹配。
 */
export declare const TEST_ID_ANCHORED_RE: RegExp;
/**
 * 权威 test-id parser（spec §2.30）：按词法边界切候选（空白/反引号/除 `-` `.` `*` `?` 方括号外的标点），
 * 候选必须整串满足兼容基线文法；含通配字符或占位尾段的候选整体拒绝、前缀不采信。
 */
export declare function parseTestCaseIds(text: string): string[];
/**
 * 从 markdown **真实测试规格表格**的结构化 ID 列（首列）提取已定义测试 ID（code-r1 F5 / r2 强化）：
 * 权威掩码剔除代码围栏、缩进代码块与 HTML 注释；只认「表头行 + delimiter 行 + 数据行」的完整
 * 表格块（兼容无首尾 pipe），且要求 delimiter 与表头列数一致、**首列表头 ∈ {ID, 用例 ID}**——
 * 孤立 pipe 行、散文/覆盖清单、注释/缩进示例中的 token、非 ID 列普通表格均不构成存在性。
 */
export declare function extractStructuredTestIds(content: string): string[];
export type TestEvidenceStage = 'plan' | 'spec-complete' | 'slice';
/**
 * 证据等级阶段分类（spec §2.30 分类函数，输入 = marker × tasks.md 机器事实）。
 * `[delta]` 勾选度计数基**仅含任务文字带 `deltas/` 目标路径的 delta 产出条目**——
 * 非 delta / merge-time checkbox 不参与计数（防延后元数据任务把 delta 完成态压回 plan 级）。
 */
export declare function classifyTestEvidenceStage(proposalDir: string, tasksContent?: string): TestEvidenceStage;
export interface ReuseDeclarationEntry {
    line: string;
    id: string | null;
    problem: 'syntax' | 'not-found' | 'duplicate' | null;
}
export interface ReuseDeclarationResult {
    present: boolean;
    entries: ReuseDeclarationEntry[];
    validIds: string[];
    allValid: boolean;
}
/**
 * 解析 proposal.md 中标题精确为 `## 复用测试 ID` 的复用声明小节（固定语法：每行 `- <ID> — <一句话用途>`）。
 * 逐项判定：语法非法 / ID 不存在于已合并结构化 ID 列 / 重复，各标注 problem；合法项不因此失效但小节整体不判过。
 */
export declare function parseReuseDeclaration(proposalContent: string, mergedIds: Set<string>): ReuseDeclarationResult;
/** 读取已合并 `logos/resources/test/**` 全部结构化 ID 列（仅用于复用声明的存在性校验）。 */
export declare function readMergedStructuredTestIds(proposalDir: string): Set<string>;
export interface TestIdEvidenceResult {
    stage: TestEvidenceStage;
    /** 本提案在当前证据等级下是否解析到可采信证据。 */
    evidenceOk: boolean;
    /** 复用声明逐行问题（存在即为 L3 violation）。 */
    reuse: ReuseDeclarationResult;
    /**
     * L3 唯一总判定（code-r1 F10）：evidenceOk 且复用声明（若存在）零非法项。
     * lint 与 flow-derive 均只消费本字段——不得各自拼装 pass/fail（同判据同结论）。
     */
    pass: boolean;
}
/**
 * 分阶段测试证据模型（spec §2.30，proposal-scoped）：
 * - slice：曾有测试 delta → 只读本提案 deltas/test/** 映射到的已合并目标文件结构化 ID 列；否则只认合法复用清单。
 *   **禁止扫描 logos/resources/test/ 全目录**（全局无关 ID 不构成本提案证据）。
 * - spec-complete：从本提案已产出 deltas/test/ 文件的结构化 ID 列或经校验复用清单解析。
 * - plan（有 [delta]）：任务规划了 deltas/test/ 目标，或合法复用清单。
 * - plan（无 [delta]，纯代码提案）：复用清单或已存在 deltas/test/ 文件。
 */
export declare function evaluateTestIdEvidence(proposalDir: string, tasksContent?: string): TestIdEvidenceResult;
export declare function hasRealTestIdsForProposal(proposalDir: string, tasksContent?: string): boolean;
export declare function getProposalStepReason(proposalDir: string, step?: ProposalStep, tasksContent?: string): ProposalBlockReason | null;
export declare function getCodePlanningDiagnostic(proposalDir: string, tasksContent?: string): CodePlanningDiagnostic | null;
export declare function isCodeRequiredButUnplanned(proposalDir: string, tasksContent?: string): boolean;
/**
 * enforce-slice-stage-ordering：auto-reset 提前填充的 `[code]` section（§12.7）。
 * 仅当 `[code]` 已 `tasks_code_filled`（提前填充）时，重置为纯代码模板占位并把旧内容备份到提案目录 `CODE_AUTORESET`。
 * 幂等：`[code]` 已占位（未 `tasks_code_filled`）时不清理、不备份，返回 false。
 * ⚠️ 只在有副作用命令（`openlogos merge`）中调用；**绝不**在 `status`/`flow-derive` 被动派生路径调用（A 被动派生只读）。
 */
export declare function resetCodeSection(proposalDir: string, trigger: string, locale?: string): boolean;
export declare function countMergeableDeltaFiles(proposalDir: string): number;
export declare function hasSpecCompleteMarker(proposalDir: string): boolean;
export interface ProposalFacts {
    spec_complete: boolean;
    slices_planned: boolean;
    slices_approved: boolean;
    code_required: boolean;
    has_delta_tasks: boolean;
    verify_pass: boolean;
}
/**
 * CLI 权威计算的确定性事实块（spec/cli-json-output.md §3.3「facts 权威事实块」）。
 * loop_state 激活判据（flow-loop-derive）与本函数是**同一份计算**——单一事实源，禁止第二处实现。
 */
export declare function deriveProposalFacts(proposalDir: string, tasksContent?: string): ProposalFacts;
/**
 * 结构化 SLICES_APPROVED marker（spec/flow-spec.md §12.5(3)）：消费 slice-exit 时原子写入一次
 * JSON 单行 `{"schema":"openlogos/slices-approved@1","approved_at":"<ISO 8601>"}`；
 * 已存在**不重写**（重复 `next --auto` 不刷新 approved_at）。
 */
export declare function writeSlicesApprovedMarker(proposalDir: string): void;
/**
 * 读结构化 SLICES_APPROVED 的 approved_at（loop_state.activated_at 的持久时间源）。
 * 旧格式空文件 / 非法 JSON → null（存在性仍表示「切片门已消费」，仅时间戳缺失）。
 */
export declare function readSlicesApprovedAt(proposalDir: string): string | null;
export declare function countTasks(content: string): {
    checked: number;
    total: number;
};
export declare function allTasksChecked(content: string): boolean;
/**
 * 解析 tasks.md 中的结构化 section。
 * 识别 `## [tag] ...` 格式的 section 标题，返回每个 tag 对应的 checked/total。
 * 若文件中没有任何 `## [tag]` 标记，返回 null（表示旧格式，降级为全局判断）。
 */
export declare function parseTaskSections(content: string): Record<string, {
    checked: number;
    total: number;
}> | null;
export declare function extractTaskSectionItems(content: string, tag: string): TaskItem[];
export declare function readTaskSectionItems(proposalDir: string, tag: string): TaskItem[];
export declare function derivePlanState(proposalDir: string, step: ProposalStep, deploymentDecision: Pick<ProposalDeploymentDecision, 'deployment_decision_conflict' | 'deployment_decision_conflict_reason'>, tasksContent?: string): PlanState;
export declare function getDeployTasks(proposalDir: string): TaskItem[];
export declare function parseProposalDeploymentDecision(content: string): Pick<ProposalDeploymentDecision, 'deployment_required' | 'smoke_required' | 'deployment_reason'> | null;
export declare function getDeploySectionSummary(tasksContent: string): {
    checked: number;
    total: number;
} | null;
export declare function resolveDeploymentProgress(proposalDir: string): DeploymentProgress;
export declare function resolveDeploymentDocument(root: string, proposalSlug: string): DeploymentDocument;
export declare function resolveProposalDeploymentDecision(proposalDir: string, moduleDefaults?: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'>): ProposalDeploymentDecision;
export declare function hasSmokeCasesForProposal(proposalDir: string): boolean;
export declare function detectProposalStep(proposalDir: string, moduleDefaults?: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'>): ProposalStep;
//# sourceMappingURL=proposal-lifecycle.d.ts.map