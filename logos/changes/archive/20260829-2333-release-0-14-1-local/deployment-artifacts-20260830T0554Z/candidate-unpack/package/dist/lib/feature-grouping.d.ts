/**
 * feature-grouping — add-feature-model（S34）：module → feature → scenario 分组派生（status/next 共享）。
 *
 * 规范源：spec/cli-json-output.md §1.4「modules[].features feature 分组契约」、
 * logos/resources/prd/3-technical-plan/1-architecture §二十。
 *
 * 契约要点（status/next）：
 * - **省略当且仅当**该 module 既无注册 feature（`features[]` 中 `module==本 module`）**且**其下无任何场景带
 *   `feature` 键（纯 pre-feature module）→ 返回 `undefined`（调用侧省略字段）。
 * - 否则输出：按 `features[]` 声明顺序列出每个注册 feature（成员为空 → `scenarios:[]`，保留），
 *   末位 `__ungrouped__`（当且仅当有 ≥1 个未归属/降级场景）。
 * - 归属降级：`scenario.feature` 缺失 / 指向未知 feature / 指向跨 module 的 feature —— 三态一律入
 *   `__ungrouped__`（不报错、不阻断）。因此显式带 `feature` 键即触发输出，绝不因"无注册 feature"丢失降级桶。
 * - 重复 feature id：取 YAML 首现，其余忽略。
 */
import type { ProjectYamlFeature, ProjectYamlScenario } from './project-yaml.js';
/** 固定保留伪 feature id（双下划线包裹，不匹配 `^F\d+` 合法 ID，防冲突），恒排末位。 */
export declare const UNGROUPED_FEATURE_ID = "__ungrouped__";
export declare const UNGROUPED_FEATURE_NAME = "\u672A\u5206\u7EC4";
export interface FeatureScenarioMember {
    id: string;
    name: string;
}
export interface FeatureGroupItem {
    id: string;
    name: string;
    spec: string | null;
    scenarios: FeatureScenarioMember[];
}
/**
 * 为单个 module 构建 feature 分组（**status/next 语义**）。
 * @returns feature 分组数组；`undefined` 表示应省略 `features` 字段（纯 pre-feature module：无注册 feature 且无场景带 feature 键）。
 */
export declare function buildModuleFeatures(moduleId: string, moduleScenarios: readonly ProjectYamlScenario[], allFeatures: readonly ProjectYamlFeature[] | undefined): FeatureGroupItem[] | undefined;
/**
 * 为单个 module 构建 feature 分组（**feature list 语义**，add-feature-model delta-F10）。
 * 专用分组视图，无零漂移约束、**始终返回数组**：
 * - 列出全部注册 feature（空成员 `scenarios:[]`）+ 末位 `__ungrouped__`（当有未归属/降级场景）。
 * - 有场景但无注册 feature → `[{__ungrouped__}]`；`[]` **仅**用于真正空 module（无注册 feature 且无场景成员）。
 */
export declare function buildModuleFeatureList(moduleId: string, moduleScenarios: readonly ProjectYamlScenario[], allFeatures: readonly ProjectYamlFeature[] | undefined): FeatureGroupItem[];
/**
 * status/next 文本模式的 feature 分组渲染（add-feature-model delta-F2，status/next 共用同一 formatter）。
 * @param features module 项的 `features`（可能为 `undefined`）
 * @param indent 每行前缀缩进（与调用方 module 子行对齐）
 * @returns 待逐行打印的字符串数组；`features` 缺失/为空 → **返回 `[]`（零字节，保纯 pre-feature 零漂移）**。
 */
export declare function formatFeaturesText(features: readonly FeatureGroupItem[] | undefined, indent?: string): string[];
//# sourceMappingURL=feature-grouping.d.ts.map