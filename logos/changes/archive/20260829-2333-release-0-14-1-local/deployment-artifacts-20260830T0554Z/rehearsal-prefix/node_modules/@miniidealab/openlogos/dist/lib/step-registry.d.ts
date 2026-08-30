/**
 * step-registry — proposal_step 的**唯一铸造点**与契约自描述元数据（contract-self-description C1/C5）。
 *
 * 规范源：spec/flow-spec.md「步骤注册表与 step_meta」、spec/cli-json-output.md §3.3。
 * - 任何代码路径产生 / 覆盖 `proposal_step` 必须经本注册表取得 `step_meta`（status/next 覆盖点统一走
 *   `stepMetaFor`）；`Record<ProposalStep, StepMeta>` 的穷尽性保证「枚举新增值而注册表缺条目」直接编译失败。
 * - 配套 CI lint（cli/test/s11-status.test.ts UT-S11-55）：扫描源文件中赋给 proposal_step 的字符串
 *   字面量，任一不在注册表 → 测试失败。
 * - **不新增 `proposal_step` 枚举值**；phase/kind 是小闭合枚举，消费方遇未知值必须走保守分支
 *   （规范性约定见 spec/cli-json-output.md §1.2，消费方行为验收归 runlogos R5）。
 */
import type { ProposalStep } from './proposal-lifecycle.js';
/**
 * status/next 机器契约版本（语义化，独立于 CLI 版本；升级规则见 spec/cli-json-output.md §1.2）。
 *
 * add-feature-model（S34，delta-F1=B）**条件版本**：`data.contract.version` 采条件发射——
 * 响应含 `modules[].features` 时为 `1.1.0`，否则保持 `1.0.0`（纯 pre-feature 响应逐字节含版本零漂移）。
 * `CONTRACT_VERSION` 保留为 1.0.0 基线常量；发射端一律经 `contractVersion(hasFeatures)` 选择，
 * 不各自硬编码。两版契约各自自洽（features ⟺ 1.1.0，1.0.0 响应永不含 features）。
 */
export declare const CONTRACT_VERSION = "1.0.0";
/** add-feature-model（S34）：含 feature 分组时的契约版本。 */
export declare const CONTRACT_VERSION_WITH_FEATURES = "1.1.0";
export declare const CONTRACT_VERSION_WITH_CLARIFICATION = "1.2.0";
export declare const CONTRACT_VERSION_WITH_PLAN_PACKAGE = "1.3.0";
export declare const CONTRACT_VERSION_WITH_MERGE_TRANSACTION = "1.4.0";
/**
 * add-feature-model（S34，delta-F1=B）：条件版本选择器——status/next 发射 `contract.version` 的唯一入口。
 * @param hasFeatures 本次响应是否含任一 `modules[].features` 字段。
 */
export declare function contractVersion(hasFeatures: boolean, hasClarification?: boolean, hasSliceVerification?: boolean, hasPlanPackage?: boolean, hasMergeTransaction?: boolean): string;
export type StepPhase = 'pre-implement' | 'implement' | 'post-implement';
export type StepKind = 'produce' | 'gate' | 'command-required' | 'residency';
export interface StepMeta {
    phase: StepPhase;
    kind: StepKind;
}
/**
 * 全量注册表（proposal_step → phase/kind，与 spec/cli-json-output.md §3.3 表一一对应）。
 * Record 穷尽性：ProposalStep 枚举任何新增值若缺注册表条目 → tsc 编译失败（第一道防漂移门）。
 */
export declare const STEP_REGISTRY: Record<ProposalStep, StepMeta>;
/** 注册表键集（lint 与 schema 同步测试用）。 */
export declare const REGISTERED_STEPS: ProposalStep[];
/** 经注册表取 step_meta——status/next 输出与全部 proposal_step 覆盖点的唯一取值入口。 */
export declare function stepMetaFor(step: ProposalStep): StepMeta;
export declare function isRegisteredStep(step: string): step is ProposalStep;
export interface MintedStep {
    proposal_step: ProposalStep;
    step_meta: StepMeta;
}
/**
 * **唯一铸造 API**（code review F5）：status/next 等覆盖点改写 proposal_step 时必须经此取得
 * `{proposal_step, step_meta}` 成对结果——步骤与元数据在铸造点绑定，无法各自漂移。
 * 未注册步骤（含运行时注入而未同步注册表的值）→ fail loud。
 * 配套 lint（UT-S11-55）：commands 层禁止出现 `proposal_step = '<字面量>'` 直接赋值。
 */
export declare function mintStep(step: ProposalStep): MintedStep;
//# sourceMappingURL=step-registry.d.ts.map