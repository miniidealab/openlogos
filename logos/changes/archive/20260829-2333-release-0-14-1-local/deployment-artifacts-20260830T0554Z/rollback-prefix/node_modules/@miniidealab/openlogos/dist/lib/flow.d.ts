export type Lifecycle = 'initial' | 'launched';
export type FlowErrorCode = 'PROJECT_NOT_INITIALIZED' | 'FLOW_NOT_FOUND' | 'FLOW_SCHEMA_INVALID' | 'FLOW_CMD_SPAWN_FAILED';
export declare class FlowError extends Error {
    code: FlowErrorCode;
    constructor(code: FlowErrorCode, message: string);
}
export type OverlayOp = 'skip' | 'add' | 'modify' | 'reorder';
export interface FlowGate {
    type: 'none' | 'human' | 'cmd';
    position?: 'entry' | 'exit';
    skippable?: boolean;
}
/** 节点派发元数据声明（raw 可部分省略；resolved 物化为完整对象，见 materializeResolvedDispatch）。 */
export interface FlowDispatchDecl {
    idempotent?: boolean;
    timeout_seconds?: number | null;
    artifacts_hint?: string[];
}
/** resolved 物化后的完整派发契约（next_node.dispatch 的数据源，恒三字段齐备）。 */
export interface FlowDispatch {
    idempotent: boolean;
    timeout_seconds: number;
    artifacts_hint: string[];
}
export interface FlowNode {
    id: string;
    name: string;
    skill?: string | null;
    working_agent?: string | null;
    review_agent?: string | null;
    when?: string | null;
    for_each?: string | null;
    produces?: string | null;
    done_when?: string | null;
    fail_when?: string | null;
    pre_script?: string | null;
    post_script?: string | null;
    cmd_timeout_seconds?: number | null;
    coverage_threshold?: number | null;
    dispatch?: FlowDispatchDecl | null;
    requires_reviewed?: string[] | null;
    skipped?: boolean;
    overlay_op?: OverlayOp | null;
}
/** subflow 循环（见 spec/flow-spec.md §6）。M2 切片 2：max_iters>1 + until:tests_green 点亮真迭代。 */
export interface FlowLoop {
    until?: string | null;
    max_iters?: number | null;
    exhausted_gate?: {
        skippable?: boolean;
    } | null;
}
export interface FlowSubflow {
    id: string;
    name: string;
    when?: string | null;
    loop?: FlowLoop | null;
    gate?: FlowGate;
    nodes: FlowNode[];
}
export interface Flow {
    flow: string;
    version: number;
    extends?: string | null;
    defaults?: {
        dispatch?: {
            timeout_seconds?: number;
        };
    } | null;
    subflows: FlowSubflow[];
}
/** 兜底默认（内置模板均显式带 defaults:900；此常量仅护住无 defaults 的旧自包含 flow 文件）。 */
export declare const FALLBACK_DISPATCH_TIMEOUT_SECONDS = 900;
export interface FlowWarning {
    code: string;
    message: string;
}
export interface LoadFlowResult {
    lifecycle: Lifecycle;
    resolved: boolean;
    overlay_applied: boolean;
    builtin_version: string;
    warnings: FlowWarning[];
    flow: Flow;
}
/**
 * 内置模板内容版本来源（见 spec/flow-spec.md §10.1）：由 loader 维护映射，
 * 作为 builtin_version 输出与 overlay @vN 比对的唯一依据。内置模板内容破坏性变更时必须 bump。
 * 禁止复用文件 version（schema 版本）。
 */
export declare const BUILTIN_VERSIONS: Record<Lifecycle, string>;
/** 基础 schema 校验（见 spec/flow-spec.md）。不合法抛 FLOW_SCHEMA_INVALID。 */
export declare function validateFlow(flow: unknown, what?: string): asserts flow is Flow;
/** 读取并校验内置模板。lifecycle 对应模板缺失 → FLOW_NOT_FOUND。 */
export declare function loadBuiltinFlow(lifecycle: Lifecycle): Flow;
/** 由 logos-project.yaml 模块状态推断默认 lifecycle（任一 launched → launched）。 */
export declare function inferLifecycle(root: string): Lifecycle;
interface OverlayDoc {
    extends?: string;
    defaults?: {
        dispatch?: {
            timeout_seconds?: number;
        };
    };
    overlay?: Array<Record<string, unknown>>;
}
/** 读取项目 overlay（logos/flow/<lifecycle>.yaml）；不存在返回 null。 */
export declare function readOverlay(root: string, lifecycle: Lifecycle): OverlayDoc | null;
/** 解析 `builtin:initial@v1` → { baseline, version }；无 @vN 时 version 为 null。 */
export declare function parseExtends(value: string): {
    baseline: string;
    version: string | null;
};
/** 把 overlay 应用到内置 flow（深拷贝后修改），返回 resolved flow + 告警。 */
export declare function applyOverlay(builtin: Flow, overlay: OverlayDoc, lifecycle: Lifecycle): {
    flow: Flow;
    warnings: FlowWarning[];
};
/** S30：判定一个谓词字段是否为 cmd:（含 trim 后非空校验在调用处）。 */
export declare function isCmdPred(v: string | null | undefined): boolean;
/**
 * 读取并**校验**项目级 `flow.cmd_timeout_seconds`（基础库，供 overlay-derive / flow-derive / deploy-done 共享）。
 * 缺配置/未设 → null（用内置默认）；**非整数或 < 1 → `FLOW_SCHEMA_INVALID`（fail loud，不静默回退）**。
 */
export declare function readProjectCmdTimeout(root: string): number | null;
/**
 * S29：fan-out 聚合 done 判定（共享，供 flow-derive / flow-overlay-derive 复用）。
 * 缺省阈值（threshold 省略/null）= `all_present`（全覆盖 covered>=total）；
 * 设阈值时 `covered/total >= threshold`；`total<=0` 维持现状（视为未 done）。
 */
export declare function fanoutDone(covered: number, total: number, threshold?: number | null): boolean;
/**
 * 找到被激活（loop.max_iters > 1）的 subflow；无则 null。本切片仅 implement 子流程会带。
 * 激活 = overlay `set-loop` 把 max_iters 设 >1（builtin 恒为 1，故无激活 → golden 零漂移）。
 */
export declare function findActivatedLoop(flow: Flow): {
    subflow_id: string;
    until: string;
    max_iters: number;
} | null;
export interface LoadFlowOptions {
    lifecycle?: Lifecycle;
    resolved?: boolean;
}
/**
 * contract-self-description 切片3（C4）：resolved 物化——每个节点补全为完整 dispatch 对象，
 * 输出层不再有第二处默认。规则（spec/flow-spec.md「派发元数据」）：
 * - timeout_seconds：节点显式值 > flow 顶层 defaults.dispatch.timeout_seconds > 兜底 900；
 * - 未声明 dispatch 的节点（含 overlay-add）→ 完整保守默认 { idempotent:false, timeout:defaults, artifacts_hint:[] }
 *   （artifacts_hint:[] ＝「产物未知」契约语义；宁慢勿错杀）；
 * - 权威数据源 = 节点人工声明，不从 produces/done_when 推导。
 */
export declare function materializeResolvedDispatch(flow: Flow): void;
/**
 * 加载 flow：默认内置 raw flow；resolved=true 时叠加项目 overlay 并物化节点 dispatch。
 * lifecycle 缺省按项目状态推断。
 */
export declare function loadFlow(root: string, opts?: LoadFlowOptions): LoadFlowResult;
export {};
//# sourceMappingURL=flow.d.ts.map