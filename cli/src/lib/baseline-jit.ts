/**
 * brownfield-adopter：`baseline_seed_state` 缺省语义的派生 helper（effectiveBaselineSeedState）。
 *
 * 只读已合并主文档（`logos/resources/`）派生模块级有效状态；覆盖率同理（见 baseline-provenance.scanModuleCandidates，只扫 resources）。
 */
import { scanModuleCandidates } from './baseline-provenance.js';
import type { BaselineSeedState } from './baseline-provenance.js';
import { withBaselineReadLock, listRunIds, readRunRecord } from './baseline-seed-txn.js';

/** `effectiveBaselineSeedState` 的返回：有效状态 + 是否为 legacy 派生值（yaml 未落盘）。 */
export interface EffectiveBaselineSeedState {
  state: BaselineSeedState;
  /** true = 派生值（yaml 缺省，尚未经 sync 迁移落盘），供 legacy 迁移提示与 sync 迁移使用。 */
  legacy: boolean;
  /** true = 派生时模块锁被占用（提交进行中），state 为保守兜底 `partial`（不据半提交集合扫描）。 */
  commit_in_progress?: boolean;
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
 * 锁被占用（提交进行中）→ 不做锁外扫描，返回保守兜底 `partial` + `commit_in_progress: true`（契约恒输出仍成立）。
 */
export function effectiveBaselineSeedState(
  root: string,
  moduleId: string,
  explicit?: BaselineSeedState | null,
  opts?: { assumeLocked?: boolean },
): EffectiveBaselineSeedState {
  if (explicit) return { state: explicit, legacy: false };
  const derive = (): BaselineSeedState => {
    const hasCandidates = scanModuleCandidates(root, moduleId).candidates.length > 0;
    if (!hasCandidates) return 'required';
    const hasOpenRun = listRunIds(root)
      .map(id => readRunRecord(root, id))
      .some(r => r !== null && r.module === moduleId && r.status === 'open');
    return hasOpenRun ? 'partial' : 'seeded';
  };
  if (opts?.assumeLocked) return { state: derive(), legacy: true };
  const res = withBaselineReadLock(root, moduleId, new Date().toISOString(), derive);
  if (!res.ok) return { state: 'partial', legacy: true, commit_in_progress: true };
  return { state: res.value, legacy: true };
}
