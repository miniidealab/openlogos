export interface MigrateResult {
    migrated: boolean;
    autoMarked?: string;
    warned?: boolean;
}
/**
 * Detects old config.lifecycle === 'active' with no launched modules.
 * Single-module: auto-marks it as launched and returns autoMarked.
 * Multi-module: emits a warning and returns warned=true.
 * Called by both sync and launch before deriving isLaunched.
 */
export declare function migrateProjectLifecycle(root: string): MigrateResult;
export interface BaselineMigrateResult {
    migrated: boolean;
    backupPath?: string;
    changes: string[];
}
/**
 * brownfield-adopter（S33）：老 adopted 项目 provenance 元数据的保守逐产物迁移。
 *
 * 持久化改写两类（baseline-seed-legacy-default-unify 扩展）：
 * 1. 历史布尔 `baseline_seed_required: true` → 枚举 `baseline_seed_state: required`（既有行为不回归）；
 * 2. `bootstrap: adopted`（含历史 `skipped` 兼容读取）且仍无 `baseline_seed_state` 的模块 →
 *    经共享 helper `effectiveBaselineSeedState`（唯一事实源）派生并**写入显式枚举**，changes 记录写明派生依据；
 *    落盘后 legacy 缺省态物理消亡，运行时派生仅作过渡兜底。已有显式值不覆盖。
 * provenance 本身为派生值、不落 YAML：缺 `## 逆向基线来源` 章节的既有文档一律派生 `unknown`/`legacy-unclassified`，
 * **不虚构 candidates[]、不推断 reverse-engineered、无产物不创建任何 provenance**。
 *
 * 不变量：幂等（重复运行不改结果）、写前备份（logos-project.yaml.bak）、旧版 CLI 忽略未知字段。
 * 锁纪律：调用方（sync）已在 `withRecoveredReadLocks` 的**全模块读锁区间**内执行本迁移——
 * 派生一律 `assumeLocked: true` 复用该区间，不自取锁（自取会与已持锁互斥而误判 commit_in_progress）。
 */
export declare function migrateBaselineProvenance(root: string): BaselineMigrateResult;
//# sourceMappingURL=migrate-lifecycle.d.ts.map