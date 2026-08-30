/**
 * status/next 机器契约版本（语义化，独立于 CLI 版本；升级规则见 spec/cli-json-output.md §1.2）。
 *
 * add-feature-model（S34，delta-F1=B）**条件版本**：`data.contract.version` 采条件发射——
 * 响应含 `modules[].features` 时为 `1.1.0`，否则保持 `1.0.0`（纯 pre-feature 响应逐字节含版本零漂移）。
 * `CONTRACT_VERSION` 保留为 1.0.0 基线常量；发射端一律经 `contractVersion(hasFeatures)` 选择，
 * 不各自硬编码。两版契约各自自洽（features ⟺ 1.1.0，1.0.0 响应永不含 features）。
 */
export const CONTRACT_VERSION = '1.0.0';
/** add-feature-model（S34）：含 feature 分组时的契约版本。 */
export const CONTRACT_VERSION_WITH_FEATURES = '1.1.0';
export const CONTRACT_VERSION_WITH_CLARIFICATION = '1.2.0';
export const CONTRACT_VERSION_WITH_PLAN_PACKAGE = '1.3.0';
export const CONTRACT_VERSION_WITH_MERGE_TRANSACTION = '1.4.0';
/**
 * add-feature-model（S34，delta-F1=B）：条件版本选择器——status/next 发射 `contract.version` 的唯一入口。
 * @param hasFeatures 本次响应是否含任一 `modules[].features` 字段。
 */
export function contractVersion(hasFeatures, hasClarification = false, hasSliceVerification = false, hasPlanPackage = false, hasMergeTransaction = false) {
    if (hasMergeTransaction)
        return CONTRACT_VERSION_WITH_MERGE_TRANSACTION;
    if (hasPlanPackage)
        return CONTRACT_VERSION_WITH_PLAN_PACKAGE;
    if (hasClarification)
        return CONTRACT_VERSION_WITH_CLARIFICATION;
    return hasFeatures || hasSliceVerification ? CONTRACT_VERSION_WITH_FEATURES : CONTRACT_VERSION;
}
/**
 * 全量注册表（proposal_step → phase/kind，与 spec/cli-json-output.md §3.3 表一一对应）。
 * Record 穷尽性：ProposalStep 枚举任何新增值若缺注册表条目 → tsc 编译失败（第一道防漂移门）。
 */
export const STEP_REGISTRY = {
    'writing': { phase: 'pre-implement', kind: 'produce' },
    'ready-to-delta': { phase: 'pre-implement', kind: 'gate' },
    'delta-writing': { phase: 'pre-implement', kind: 'produce' },
    'ready-to-merge': { phase: 'pre-implement', kind: 'gate' },
    'merge-generated': { phase: 'pre-implement', kind: 'command-required' },
    'spec-complete-required': { phase: 'pre-implement', kind: 'command-required' },
    'test-id-required': { phase: 'pre-implement', kind: 'residency' },
    'ready-to-implement': { phase: 'pre-implement', kind: 'residency' },
    'coding': { phase: 'implement', kind: 'produce' },
    'ready-to-verify': { phase: 'implement', kind: 'command-required' },
    'verify-failed': { phase: 'implement', kind: 'residency' },
    'verify-passed': { phase: 'post-implement', kind: 'residency' },
    'ready-to-deploy': { phase: 'post-implement', kind: 'gate' },
    'deploy-done': { phase: 'post-implement', kind: 'residency' },
    'ready-to-smoke': { phase: 'post-implement', kind: 'command-required' },
    'smoke-passed': { phase: 'post-implement', kind: 'residency' },
    'smoke-failed': { phase: 'post-implement', kind: 'residency' },
    // 旧兼容值（spec/cli-json-output.md §3.3：implementing / in-progress 为旧版本兼容值）
    'implementing': { phase: 'implement', kind: 'produce' },
    'in-progress': { phase: 'implement', kind: 'produce' },
};
/** 注册表键集（lint 与 schema 同步测试用）。 */
export const REGISTERED_STEPS = Object.keys(STEP_REGISTRY);
/** 经注册表取 step_meta——status/next 输出与全部 proposal_step 覆盖点的唯一取值入口。 */
export function stepMetaFor(step) {
    return STEP_REGISTRY[step];
}
export function isRegisteredStep(step) {
    return Object.prototype.hasOwnProperty.call(STEP_REGISTRY, step);
}
/**
 * **唯一铸造 API**（code review F5）：status/next 等覆盖点改写 proposal_step 时必须经此取得
 * `{proposal_step, step_meta}` 成对结果——步骤与元数据在铸造点绑定，无法各自漂移。
 * 未注册步骤（含运行时注入而未同步注册表的值）→ fail loud。
 * 配套 lint（UT-S11-55）：commands 层禁止出现 `proposal_step = '<字面量>'` 直接赋值。
 */
export function mintStep(step) {
    const meta = STEP_REGISTRY[step];
    if (!meta) {
        throw new Error(`step-registry: 未注册的 proposal_step \`${step}\`（新步骤必须先进注册表）`);
    }
    return { proposal_step: step, step_meta: { ...meta } };
}
//# sourceMappingURL=step-registry.js.map