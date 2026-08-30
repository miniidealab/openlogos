import type { ModuleInfo } from '../commands/status.js';
export type OverlayNodeState = 'done' | 'active' | 'skipped' | 'failed' | 'pending';
export interface OverlayNode {
    id: string;
    name: string;
    state: OverlayNodeState;
    subflow_id: string;
    node_index: number;
    overlay_op: 'add';
}
export interface CurrentNode {
    id: string;
    name: string;
    state: OverlayNodeState;
    subflow_id: string;
    node_index: number;
    phase_key: string | null;
    overlay_op: string | null;
}
/** 当前 pending cmd 节点的求值信息，供 next 执行命令（status/watch 不用）。 */
export interface PendingCmd {
    node_id: string;
    command: string;
    predicate_field: 'done_when' | 'fail_when';
    timeout_seconds: number;
}
export interface OverlayView {
    overlay_nodes: OverlayNode[];
    current_node: CurrentNode | null;
    /** launched：当前节点落在 overlay-added 节点时的 proposal_step 回退值（前序最近 builtin step / writing）。 */
    proposal_step_override: string | null;
    /** 当前节点是未求值的 cmd 节点时填充（仅 next 执行用）；否则 null。 */
    pending_cmd: PendingCmd | null;
}
/** next 执行 cmd 后回传的求值结果，让派生把该节点当 done/failed/active 续推（budget=1）。 */
export interface CmdEval {
    node_id: string;
    satisfied: boolean;
}
/**
 * proposal_step → 当前「正在进行 / 等待」的 builtin launched 节点 id（前沿节点）。
 * 用于 overlay 走查中定位 builtin 前沿，避免重复推导 launched 的 when/done 复杂度（marker 优先级、subflow when、提案级决策）。
 */
export declare const STEP_TO_CURRENT_BUILTIN: Record<string, string>;
/**
 * 派生 overlay 视图。无 overlay 文件 → 返回 null（golden 零漂移）。
 * 抛 FLOW_SCHEMA_INVALID：launched 对 builtin 节点的 skip/reorder、overlay-add 谓词组合非法。
 */
export declare function deriveOverlayView(root: string, mod: ModuleInfo, scenarios: Array<{
    id: string;
}>, proposalDir: string | null, isMultiModule?: boolean, cmdEval?: CmdEval, haltAfterSubflow?: string): OverlayView | null;
/** 标记一个 id 是否为 builtin（用于消费端判断）。 */
export declare function isBuiltinNodeId(id: string): boolean;
/** S28：next 透出的编排提示（取自 resolved flow 的最终建议处理节点）。 */
export interface NextNode {
    id: string;
    name: string;
    subflow_id: string;
    skill: string | null;
    working_agent: string | null;
    review_agent: string | null;
    pre_script: string | null;
    post_script: string | null;
    gate_id?: string;
    slice?: string;
    slice_children?: Array<{
        text: string;
        checked: boolean;
    }>;
    dispatch: {
        idempotent: boolean;
        timeout_seconds: number;
        artifacts_hint: string[];
        completion?: {
            command: string;
            expected: {
                '/data/pass': true;
                '/data/plan_package/ready': true;
            };
            expected_proposal_step: 'ready-to-delta';
        };
    };
    requires_reviewed?: string[];
}
export declare function resolveNextNode(root: string, mod: ModuleInfo, opts: {
    currentNode?: {
        id: string;
    } | null;
    proposalStep?: string | null;
    currentPhase?: string | null;
    loopBlocking?: boolean;
    loopEscalated?: boolean;
    gateAutoPassed?: boolean;
    proposalDir?: string;
}): NextNode | null;
//# sourceMappingURL=flow-overlay-derive.d.ts.map