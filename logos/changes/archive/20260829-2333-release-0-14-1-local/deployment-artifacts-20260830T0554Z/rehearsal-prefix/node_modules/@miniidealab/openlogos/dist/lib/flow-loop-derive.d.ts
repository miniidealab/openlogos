import { type Flow } from './flow.js';
import type { ModuleInfo } from '../commands/status.js';
export interface LoopState {
    subflow_id: string;
    until: string;
    max_iters: number;
    iteration: number;
    converged: boolean;
    escalated: boolean;
    activated_at?: string;
    exhausted_skippable?: boolean;
}
export interface LoopIterRow {
    iter?: number;
    node?: string;
    result?: 'pass' | 'fail';
    module?: string;
    timestamp?: string;
    slice?: string;
    verify_mode?: 'slice-checkpoint' | 'final';
    attempted_slice_id?: string | null;
}
/** 账本路径：launched = 提案目录、initial = logos/resources/verify/。 */
export declare function loopLedgerPath(root: string, proposalDir: string | null): string;
/** 读账本并按 module 过滤（顺序保留；坏行跳过）。 */
export declare function readLoopIters(path: string, moduleId: string): LoopIterRow[];
/**
 * 派生 loop_state。无激活 loop / initial 多模块 → null（不新增字段，golden 零漂移）。
 * @param flow 可传入已 resolved 的 flow 复用；缺省自行 loadFlow(resolved)。
 */
export declare function deriveLoopState(root: string, mod: ModuleInfo, proposalDir: string | null, isMultiModule?: boolean, flow?: Flow): LoopState | null;
/** 代码切片循环状态（spec/cli-json-output.md §3.10(2)）。仅切片循环激活时由调用方输出。 */
export interface SliceChild {
    text: string;
    checked: boolean;
}
export interface SliceState {
    total: number;
    done: number;
    current?: string;
    current_children?: SliceChild[];
    current_unchecked_children?: string[];
    remaining: number;
}
/**
 * 派生切片状态：读提案 tasks.md 的 [code] section。
 * - total = 顶层父切片数（缩进 checkbox 不计入）
 * - done  = 已完成父切片数（父切片勾选且其下缩进 checkbox 全勾）
 * - current = 第一个未完成父切片标题文本（全完成时省略）
 * - remaining = total - done
 * 仅在切片循环激活（until=code_slices_green）时由调用方调用并挂载。
 */
export declare function deriveSliceState(proposalDir: string, tasksContent?: string): SliceState;
/**
 * 切片循环激活时派生 slice_state，否则 null（与 deriveLoopState 同构的激活/归属门禁，保 golden）。
 * 激活条件：resolved 有激活 loop（max_iters>1）且 `until==='code_slices_green'`，
 * 且非「initial 多模块」、launched 必须有活跃提案目录。
 */
export declare function deriveSliceStateIfActive(root: string, mod: ModuleInfo, proposalDir: string | null, isMultiModule?: boolean, flow?: Flow): SliceState | null;
/** loop 退出 gate id（达上限 human gate）。 */
export declare function loopExhaustedGateId(subflowId: string): string;
/**
 * loop 是否进入「阻塞 / 续迭代」语义：已激活、未收敛、**至少跑过一轮**（iteration≥1）、
 * 且**前沿已到 verify**。否则（iteration=0 / 前沿在 implement 之前）保持正常流程，
 * 不得抢占 ready-to-merge 等前序停顿点（仅约束 implement/verify 出环）。
 */
export declare function isLoopBlocking(loopState: LoopState | null | undefined, atVerifyFrontier: boolean): boolean;
//# sourceMappingURL=flow-loop-derive.d.ts.map