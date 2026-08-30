import type { ProposalStep } from './proposal-lifecycle.js';
import { type MintedStep } from './step-registry.js';
import type { ModuleInfo, PhaseProgressItem } from '../commands/status.js';
/** node id → 原 PHASE_KEYS（13 个 1:1）。维护在 code 侧以保持 spec/flow/*.yaml 纯净。 */
export declare const NODE_TO_PHASE_KEY: Record<string, string>;
/**
 * S28：phase key → builtin node id 的**显式正向映射**（next_node 解析 initial 当前节点用）。
 * 故意独立成表而非反查 `NODE_TO_PHASE_KEY`，避免实现误用反向查找。
 */
export declare const PHASE_KEY_TO_NODE_ID: Record<string, string>;
export interface FlowPhasePlanItem {
    phaseKey: string;
    subpath: string;
    isScenario: boolean;
    whenExpr: string | null;
    nodeId: string;
    overlaySkipped?: boolean;
    coverageThreshold?: number;
}
/**
 * 构建有序 phase plan（顺序 == 原 PHASE_KEYS）。
 * 默认读 builtin；传入 root 时读 **resolved flow（含 overlay）**——使 initial 的 overlay
 * skip/modify/reorder 真正驱动派生（无 overlay 时 resolved==builtin，逐字节不变）。
 */
export declare function buildInitialPhasePlan(root?: string): FlowPhasePlanItem[];
/** 求值单个节点的 `when`：无 when 视为参与；用于 overlay 节点走查（flow-overlay-derive）。 */
export declare function evalNodeWhen(when: string | null | undefined, mod: ModuleInfo): boolean;
/**
 * 复现 deriveExplicitSkipPhaseKeys：返回因显式 `when`（非 bootstrap）为假而跳过的 phase key 集合。
 * 用于多模块全局 skip 交集。
 */
export declare function flowExplicitSkipPhaseKeys(mod: ModuleInfo, plan?: FlowPhasePlanItem[]): Set<string>;
/**
 * 复现 deriveModulePhaseProgress：per-module 派生（场景阶段 all-present 覆盖度）。
 * 与 status.ts 原算法 1:1（仅数据来源改为 builtin flow plan）。
 */
export declare function deriveModulePhaseProgressViaFlow(root: string, mod: ModuleInfo, scenarios: Array<{
    id: string;
}>, isMultiModule?: boolean, plan?: FlowPhasePlanItem[]): {
    progress: Record<string, PhaseProgressItem>;
    currentPhase: string | null;
};
/** 与 status.ts NON_FALLBACK_SKIP_PHASES 对齐（免于 fallback-skip 的 phase）。 */
export declare const NON_FALLBACK_SKIP_PHASE_KEYS: Set<string>;
/** S30：cmd gate 描述符（供 next 求值 + cmd_gate 字段输出）。 */
export interface CmdGateDesc {
    node_id: string;
    field: 'done_when' | 'fail_when';
    command: string;
}
/** S30：next 求值某 builtin gate cmd 后回灌 detect 的结果（budget=1，至多一个）。 */
export interface CmdGateEval {
    node_id: string;
    field: 'done_when' | 'fail_when';
    satisfied: boolean;
}
/**
 * launched flow 的可派生 when-flag `ui_impact`（module-aware）。
 * = 活跃提案所属 module 的 product_type ∈ GUI（web/desktop/mobile）
 *   && proposal.md「UI/UX 变更声明」段 ui_impact:true。
 * 直接转调 ui-first 的 deriveUiImpact（唯一数据源 = logos-project.yaml + proposal.md 声明段）。
 * 非 GUI 模块（含缺字段）恒 false；声明 ui_impact:false 亦 false。
 */
export declare function deriveUiImpactFlag(root: string, moduleId: string | undefined, proposalDir: string): boolean;
/**
 * 判据：提案的可合并 delta **仅**为 `deltas/prd/2-product-design/2-page-design/*.html` 原型文件
 * （至少一个原型 html，且无任何其它规格 delta）。
 * - 无任何原型 html（含无 delta）→ false（非「仅原型」）。
 * - 存在任何 **非** 2-page-design/*.html 的可合并 delta（如 1-feature-specs/*.md、api/*.yaml）→ false。
 * - 仅原型且全为 .html → true。
 * 纯判据、无副作用；用于 plan 阶段「原型 delta 例外」（原型不应误判进入 spec/delta-writing）。
 */
export declare function isPrototypeOnlyDelta(proposalDir: string): boolean;
/**
 * 判据：plan 阶段是否应「进入 spec」（离开 ready-to-delta 门前态）。
 * ui_impact 为真时启用「原型 delta 例外」：
 *   - 仅 2-page-design/*.html 原型 delta（无非原型规格 delta）且未 PLAN_APPROVED → **不进 spec**（仍 plan）；
 *   - 出现任何非原型规格 delta，或 plan-exit 已放行（PLAN_APPROVED）→ 进入 spec。
 * ui_impact 为假（含非 GUI）→ 恢复原逻辑：有任意可合并 delta 或 PLAN_APPROVED 即进 spec。
 * 该判据仅描述「delta 尚未勾选（checked===0）」这一支的门前语义，供 detect 主体最小接入。
 */
export declare function shouldEnterSpec(proposalDir: string, uiImpact: boolean): boolean;
/**
 * 复现 detectProposalStep：launched 模块 ProposalStep 改由 builtin launched flow 派生。
 * marker/section 名来自 launched.yaml；分支优先级（VERIFY_FAIL 全局最先、SMOKE 仅在 deploy 完成子块内）
 * 与提案级部署决策（resolveProposalDeploymentDecision）为引擎规则，1:1 镜像旧逻辑。
 */
declare let stepDetectorOverrideForTest: ((proposalDir: string, raw: ProposalStep) => ProposalStep) | null;
export declare function __setStepDetectorOverrideForTest(fn: typeof stepDetectorOverrideForTest): void;
/** 检测器成对铸造出口：status/next 消费 {proposal_step, step_meta} 成对结果（C1 唯一铸造点）。 */
export declare function detectMintedStepViaFlow(proposalDir: string, moduleDefaults?: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'>, cmdEval?: CmdGateEval | null): MintedStep;
/** 兼容出口（既有测试/调用面）：同样经注册表铸造校验后返回步骤值。 */
export declare function detectProposalStepViaFlow(proposalDir: string, moduleDefaults?: Pick<ModuleInfo, 'deployment_required' | 'smoke_required'>, cmdEval?: CmdGateEval | null): ProposalStep;
/**
 * S30：派生当前前沿 builtin gate 的 cmd_gate 描述符（含生效超时）；非 cmd-gate / 非相关 step → null。
 * fail_when 优先于 done_when（前沿 next 先评 fail）。供 status/watch/next 输出 cmd_gate + next 求值取命令。
 */
export declare function deriveLaunchedCmdGate(root: string, proposalStep: string): (CmdGateDesc & {
    timeout_seconds: number;
}) | null;
export interface GateInfo {
    /** gate_id 派生值 = `<subflow.id>-<gate.position>`（见 spec/cli-json-output.md）。 */
    gate_id: string;
    /** 该人类 gate 是否允许 auto 跳过。 */
    skippable: boolean;
}
/**
 * 取某 proposal_step 对应 launched gate 的 `{gate_id, skippable}`；无对应 human gate 时返回 null。
 * gate_id 与 skippable 均从 builtin launched flow 派生（flow 漂移由 S24 守卫测试兜底）。
 */
export declare function gateForProposalStep(step: string): GateInfo | null;
export {};
//# sourceMappingURL=flow-derive.d.ts.map