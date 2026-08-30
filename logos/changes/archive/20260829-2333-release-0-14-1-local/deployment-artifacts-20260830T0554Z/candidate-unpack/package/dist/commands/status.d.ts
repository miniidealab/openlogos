import { type CmdGateEval } from '../lib/flow-derive.js';
import type { OverlayNode, CurrentNode, OverlayView, CmdEval } from '../lib/flow-overlay-derive.js';
import type { LoopState, SliceState } from '../lib/flow-loop-derive.js';
import { listFiles } from '../lib/list-files.js';
import type { OutputFormat } from '../lib/json-output.js';
import type { BootstrapMode, YamlDiagnostics } from '../lib/project-yaml.js';
import type { FeatureGroupItem } from '../lib/feature-grouping.js';
import type { BaselineSeedState, BaselineCoverage } from '../lib/baseline-provenance.js';
import { type SliceVerificationState } from '../lib/test-slice-manifest.js';
import { type MergeTransactionProjection } from '../lib/merge-transaction.js';
import { type AutomationDiagnostic } from '../lib/automation-diagnostic.js';
import { parseTaskSections, extractTaskSectionItems, readTaskSectionItems, getDeployTasks, parseProposalDeploymentDecision, resolveDeploymentProgress, resolveDeploymentDocument, resolveProposalDeploymentDecision, detectProposalStep } from '../lib/proposal-lifecycle.js';
import type { StepMeta } from '../lib/step-registry.js';
import type { ProposalFacts, ProposalStep, ProposalBlockReason, PlanState, CodePlanningDiagnostic, DeploymentDecisionSource, ProposalDeploymentDecision, DeploymentProgressStatus, DeploymentProgress, DeploymentDocument, TaskItem } from '../lib/proposal-lifecycle.js';
export { parseTaskSections, extractTaskSectionItems, readTaskSectionItems, getDeployTasks, parseProposalDeploymentDecision, resolveDeploymentProgress, resolveDeploymentDocument, resolveProposalDeploymentDecision, detectProposalStep, };
export type { ProposalStep, ProposalBlockReason, PlanState, DeploymentDecisionSource, ProposalDeploymentDecision, DeploymentProgressStatus, DeploymentProgress, DeploymentDocument, TaskItem, };
export interface ModuleInfo {
    id: string;
    name: string;
    lifecycle: 'initial' | 'launched';
    bootstrap?: BootstrapMode;
    skip_phases?: string[];
    deployment_required?: boolean;
    smoke_required?: boolean;
    /** brownfield-adopter（S33）：模块级现状基线种子状态枚举（含旧布尔兼容映射）。 */
    baseline_seed_state?: BaselineSeedState;
}
interface ScenarioCoverage {
    total: number;
    covered: number;
    missing: string[];
}
export interface PhaseProgressItem {
    done: boolean;
    skipped: boolean;
    skip_reason?: string;
    scenario_coverage?: ScenarioCoverage;
}
export interface ModuleStatusItem {
    id: string;
    name: string;
    lifecycle: 'initial' | 'launched';
    bootstrap?: BootstrapMode;
    current_phase: string | null;
    current_phase_label: string | null;
    phase_progress: Record<string, PhaseProgressItem> | null;
    active_change: {
        slug: string;
        proposal_step: ProposalStep;
        proposal_step_label: string;
        step_meta: StepMeta;
        reason?: ProposalBlockReason;
        has_proposal: boolean;
        has_tasks: boolean;
        tasks_checked: number;
        tasks_total: number;
        delta_count: number;
        code_required: boolean;
        facts: ProposalFacts;
        deployment_required: boolean | null;
        smoke_required: boolean | null;
        deployment_reason: string | null;
        deployment_decision_source: DeploymentDecisionSource;
        deployment_decision_conflict: boolean;
        deployment_decision_conflict_reason: string | null;
        deployment_progress: DeploymentProgress;
        deployment_document: DeploymentDocument;
        deployment_warnings?: string[];
        deploy_tasks?: TaskItem[];
        plan_state?: PlanState;
        code_planning_diagnostic?: CodePlanningDiagnostic;
    } | null;
    suggestion: string;
    overlay_nodes?: OverlayNode[];
    current_node?: CurrentNode;
    loop_state?: LoopState;
    slice_state?: SliceState;
    slice_verification_state?: SliceVerificationState;
    cmd_gate?: CmdGate;
    automation_diagnostic?: AutomationDiagnostic;
    baseline_seed_state?: BaselineSeedState;
    baseline_coverage?: BaselineCoverage;
    features?: FeatureGroupItem[];
}
/**
 * proposal-ui-ux-first 切片1：缺 product_type 字段的 launched 模块诊断（warning，不阻断）。
 * 契约见 spec/cli-json-output.md「## product_type 迁移相关 JSON 契约」(1)。
 * 仅当存在 ≥1 个缺字段 launched 模块时出现，否则整段省略（golden 零漂移）。
 */
export interface ProductTypeConfirmation {
    signal: 'PRODUCT_TYPE_CONFIRMATION_REQUIRED';
    level: 'warning';
    missing_module_ids: string[];
    next_action: {
        command: 'openlogos module set-product-type';
        enum: string[];
        gui_enum: string[];
        hint: string;
    };
}
/**
 * 从缺字段 launched module id 列表构造 product_type_confirmation 诊断对象。
 * 空列表返回 null（调用方据此省略整段，保持 golden 零漂移）。
 */
export declare function buildProductTypeConfirmation(missingIds: string[]): ProductTypeConfirmation | null;
/** S30：builtin cmd gate 的机器契约（observe-pending）。 */
export interface CmdGate {
    node_id: string;
    field: 'done_when' | 'fail_when';
    command: string;
    timeout_seconds: number;
}
export interface StatusData {
    contract: {
        version: string;
    };
    phases: Array<{
        key: string;
        label: string;
        done: boolean;
        skipped: boolean;
        files: string[];
    }>;
    modules?: ModuleStatusItem[];
    active_proposals: Array<{
        name: string;
        has_proposal: boolean;
        has_tasks: boolean;
        delta_count: number;
    }>;
    current_phase: string | null;
    suggestion: string;
    all_done: boolean;
    lifecycle: string;
    locale: string;
    source_roots: {
        src: string[];
        test: string[];
    } | null;
    active_change: string | null;
    proposal_step: ProposalStep | null;
    reason?: ProposalBlockReason;
    yaml_diagnostics: YamlDiagnostics | null;
    overlay_nodes?: OverlayNode[];
    current_node?: CurrentNode;
    loop_state?: LoopState;
    slice_state?: SliceState;
    slice_verification_state?: SliceVerificationState;
    cmd_gate?: CmdGate;
    automation_diagnostic?: AutomationDiagnostic;
    plan_state?: PlanState;
    product_type_confirmation?: ProductTypeConfirmation;
    capabilities?: {
        ui_prototype_render: true;
    };
    merge_transaction?: MergeTransactionProjection;
}
export { listFiles };
export declare function deriveModulePhaseProgress(root: string, mod: ModuleInfo, scenarios: Array<{
    id: string;
}>, isMultiModule?: boolean): {
    progress: Record<string, PhaseProgressItem>;
    currentPhase: string | null;
};
/**
 * 为「当前活跃模块」重新派生 overlay 视图（next 的 cmd 求值路径专用）。
 *
 * 复用 collectStatusData 的模块/场景/proposalDir 解析，但允许传入 cmdEval：
 * - 不传 cmdEval（观察）→ 用于取 `pending_cmd`（待执行 cmd 节点）；
 * - 传 cmdEval（求值）→ next 执行命令后回灌结果，得到该节点 done/failed/active 的续推视图。
 *
 * 返回 null 表示无 overlay（golden 零漂移）或无法定位活跃模块。
 */
export declare function deriveActiveOverlay(root: string, filterModuleId?: string, cmdEval?: CmdEval): OverlayView | null;
/**
 * S39 统一读取硬门：锁住全部模块、恢复 journal 后，在同一临界区完成 resources/index/coverage 的真实读取。
 * 无法恢复时抛稳定 baseline_commit_in_progress，绝不返回“成功 + partial”半新视图。
 */
export declare function collectStatusData(root: string, filterModuleId?: string, cmdEval?: CmdEval, cmdGateEval?: CmdGateEval): StatusData;
export declare function status(format?: OutputFormat, moduleId?: string): void;
//# sourceMappingURL=status.d.ts.map