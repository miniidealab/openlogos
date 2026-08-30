import type { BaselineSeedState } from './baseline-provenance.js';
/** `effectiveBaselineSeedState` 的返回：有效状态 + 是否为 legacy 派生值（yaml 未落盘）。 */
export interface EffectiveBaselineSeedState {
    state: BaselineSeedState;
    /** true = 派生值（yaml 缺省，尚未经 sync 迁移落盘），供 legacy 迁移提示与 sync 迁移使用。 */
    legacy: boolean;
}
/**
 * baseline-seed-legacy-default-unify：`baseline_seed_state` 缺省语义的**唯一事实源**（架构 core-06 §4.1）。
 * `next` / `status` / `baseline-seed` 状态机三入口只准经本 helper 取有效状态，禁止本地 `?? 'required'` 一类私有缺省规则。
 *
 * 派生规则：explicit 显式值优先（含 project-yaml/readSeedState 已把旧布尔归一为 required）；缺省（legacy）时——
 *   有候选 ∧ 有 open run → `partial`（与状态机「扫描中断」语义对齐）；
 *   有候选 ∧ 无 open run → `seeded`（候选在场 = 基线事实上建立过）；
 *   无候选 → `required`（引导逆向建立现状基线）。
 * **无 `unknown` 第三态**。
 *
 * 锁纪律（继承 F7 恢复门）：派生读权威文档与 run 记录，必须在模块读锁区间内——缺省派生时本函数自取读锁；
 * 调用方已持锁（如 status 的 withBaselineReadLock 区间、baseline-seed 的写锁区间）则传 `assumeLocked: true` 复用。
 * 锁被占用（提交进行中）→ 不做锁外扫描并硬报 `baseline_commit_in_progress`；禁止把半新视图降级成正常 `partial`。
 */
export declare function effectiveBaselineSeedState(root: string, moduleId: string, explicit?: BaselineSeedState | null, opts?: {
    assumeLocked?: boolean;
}): EffectiveBaselineSeedState;
//# sourceMappingURL=baseline-jit.d.ts.map