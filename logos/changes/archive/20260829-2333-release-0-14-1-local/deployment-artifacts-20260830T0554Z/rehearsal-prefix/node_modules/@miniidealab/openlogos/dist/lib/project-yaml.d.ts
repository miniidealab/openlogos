import type { BaselineSeedState, BaselineIndexEntry } from './baseline-provenance.js';
export type YamlParseStatus = 'recovered' | 'error';
export type BootstrapMode = 'normal' | 'adopted';
export interface YamlDiagnostics {
    parse_status: YamlParseStatus;
    messages: string[];
}
export interface ProjectYamlModule {
    id: string;
    name: string;
    lifecycle?: string;
    bootstrap?: BootstrapMode;
    skip_phases?: string[];
    deployment_required?: boolean;
    smoke_required?: boolean;
    /**
     * proposal-ui-ux-first（F1）：模块级 UI 产品类型，overlay 注入与 `ui_impact` 派生的唯一数据源。
     * 枚举 `web|desktop|mobile|cli|api|library|skills|service`，GUI 集合 = {web,desktop,mobile}。
     * 字段缺失一律按非 GUI 处理（安全默认），保「非 GUI 零改动」不变量。
     */
    product_type?: string;
    /**
     * brownfield-adopter（S33）：模块级现状基线种子状态，枚举 `required|partial|seeded`（唯一状态字段，非布尔）。
     * 读取兼容历史布尔 `baseline_seed_required: true` → 映射为 `required`；`false`/缺失不推断。
     */
    baseline_seed_state?: BaselineSeedState;
}
export interface ProjectYamlScenario {
    id: string;
    /** add-feature-model（S34）：场景名称（供 feature 分组成员列表 `scenarios:[{id,name}]`；缺失回退为 id）。 */
    name?: string;
    module?: string;
    /**
     * add-feature-model（S34）：可选 feature 归属（`F0X`）。缺失 / 指向未知 feature / 跨 module 一律
     * 降级为所属 module 的"未分组"桶（不报错、不阻断）。不改动 `module` 现状语义。
     */
    feature?: string;
}
/**
 * add-feature-model（S34）：feature 功能分组注册表元素。feature 是 module 的子分组（不跨 module），
 * 由 AI 维护（比照 scenario_counter，CLI 不取号），仅读取侧解析。
 */
export interface ProjectYamlFeature {
    id: string;
    name: string;
    module: string;
    /** 可选：feature-specs 文档序号（如 `core-01`，无 `.md`/无锚点），目标缺失视为未链接。 */
    spec?: string;
}
/** add-feature-model（S34）：全局 feature 编号计数器，AI 维护（仿 scenario_counter）。 */
export interface ProjectYamlFeatureCounter {
    next_id?: number;
}
/**
 * decision-record-capability（S38）：全局决策记录（DXX）编号计数器。
 * 由 AI / merge-executor 维护（比照 scenario_counter / feature_counter，CLI **不取号**、仅读取侧解析）——
 * 取号由 merge-executor 在 apply 时按闭合公式执行，本模块不新增取号 / 写 helper（不引入第二套计数逻辑）。
 */
export interface ProjectYamlDecisionCounter {
    next_id?: number;
}
export interface ProjectYamlDeploymentGate {
    deployment_required?: boolean;
    smoke_required?: boolean;
    environments?: string[];
}
export interface ProjectYamlData {
    modules?: ProjectYamlModule[];
    scenarios?: ProjectYamlScenario[];
    /** add-feature-model（S34）：可选 feature 分组注册表。 */
    features?: ProjectYamlFeature[];
    /** add-feature-model（S34）：可选全局 feature 计数器（AI 维护）。 */
    feature_counter?: ProjectYamlFeatureCounter;
    /** decision-record-capability（S38）：可选全局决策记录计数器（AI / merge-executor 维护，CLI 只读）。 */
    decision_counter?: ProjectYamlDecisionCounter;
    deployment_gates?: Record<string, ProjectYamlDeploymentGate>;
    /** brownfield-adopter（S33）：provenance/覆盖率的派生索引（非权威），按 module 携 source_hash 供新鲜度对账。 */
    baseline_index?: Record<string, BaselineIndexEntry>;
}
export interface ProjectYamlReadResult {
    exists: boolean;
    data: ProjectYamlData | null;
    yaml_diagnostics: YamlDiagnostics | null;
}
export declare function normalizeBootstrap(value: unknown): BootstrapMode;
export declare function isAdoptedBootstrap(value: unknown): boolean;
/**
 * 读取 baseline_seed_state 枚举，兼容历史布尔 baseline_seed_required：
 * 枚举合法值优先；否则布尔 true → 'required'；false/缺失 → undefined（不推断）。
 */
export declare function normalizeBaselineSeedState(enumValue: unknown, legacyBoolean?: unknown): BaselineSeedState | undefined;
export declare function readProjectYaml(root: string): ProjectYamlReadResult;
//# sourceMappingURL=project-yaml.d.ts.map