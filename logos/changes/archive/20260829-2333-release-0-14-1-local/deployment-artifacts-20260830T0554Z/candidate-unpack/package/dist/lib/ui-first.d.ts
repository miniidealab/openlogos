import { type ProjectYamlData, type ProjectYamlModule } from './project-yaml.js';
/** product_type 合法枚举（spec/logos-project.md）；固定顺序契约：扩展只允许尾部追加。 */
export declare const PRODUCT_TYPE_ENUM: readonly ["web", "desktop", "mobile", "cli", "api", "library", "skills", "service"];
/** GUI 产品类型集合 = {web,desktop,mobile}。 */
export declare const GUI_PRODUCT_TYPES: Set<string>;
/** 方法论 GUI overlay 注入的两个节点 id（按此识别以幂等注入/移除、保留用户 ops）。 */
export declare const GUI_OVERLAY_NODE_IDS: readonly ["write-ui-prototype", "verify-ui-provenance"];
export declare function isValidProductType(pt: unknown): pt is string;
/** GUI 判定：product_type ∈ {web,desktop,mobile}；缺失/非法一律非 GUI（安全默认）。 */
export declare function isGuiProductType(pt: unknown): boolean;
/** 取某 module 的 product_type（缺失返回 undefined）。 */
export declare function moduleProductType(mod: ProjectYamlModule | undefined | null): string | undefined;
/** 项目是否含 ≥1 个 GUI 模块（overlay 项目实例级注入判据）。 */
export declare function projectHasGuiModule(data: ProjectYamlData | null | undefined): boolean;
/**
 * 列出缺 `product_type` 字段的 launched 模块 id（用于 PRODUCT_TYPE_CONFIRMATION_REQUIRED 诊断）。
 * 仅对 lifecycle==='launched' 的模块检测；缺字段 = 需人工确认回填。按 modules[] 顺序返回（确定性）。
 */
export declare function modulesMissingProductType(data: ProjectYamlData | null | undefined): string[];
/** 从项目根读 logos-project.yaml 并返回缺字段 launched 模块 id 列表。 */
export declare function readModulesMissingProductType(root: string): string[];
export interface UiUxDeclarationPage {
    id: string;
    prototype: string;
    description: string;
}
export interface UiUxDeclaration {
    ui_impact: boolean;
    design_system_mode?: 'generated' | 'fallback';
    design_system_fallback_reason?: string;
    pages: UiUxDeclarationPage[];
    /** 声明段是否存在。 */
    present: boolean;
}
/**
 * 解析 proposal.md 的「UI/UX 变更声明」段。用 YAML fenced block 承载机器可读字段，
 * 不打断 markdown 结构。段格式（模板注入，见 change.ts / cli-experience）：
 *
 * ## UI/UX 变更声明
 * ```yaml
 * ui_impact: true
 * design_system_mode: generated   # generated | fallback
 * design_system_fallback_reason: ""
 * pages:
 *   - id: home
 *     prototype: core-01-home.html
 *     description: 首页
 * ```
 *
 * 缺段/无法解析 → present:false, ui_impact:false（安全默认）。
 */
/**
 * 权威声明段唯一定位器（code-r2 F11）：结构检查与 legacy 解析消费**同一解析结果**，避免两套 parser 分叉。
 * 标题只认权威掩码外（围栏/缩进代码/HTML 注释之外）的**真实 heading 行**（无 `includes` 宽松分支——
 * 普通正文提及「## UI/UX 变更声明」不构成声明）；YAML fence 按 ```/~~~ 同字符配对。
 */
export declare function locateUiDeclarationYaml(proposalMd: string): {
    found: false;
} | {
    found: true;
    yamlText: string | null;
};
export declare function parseUiUxDeclaration(proposalMd: string): UiUxDeclaration;
/** 读提案目录的 proposal.md 并解析声明段。 */
export declare function readUiUxDeclaration(proposalDir: string): UiUxDeclaration;
export type UiDeclarationStructure = {
    ok: true;
    ui_impact: boolean;
} | {
    ok: false;
    problem: 'ui_declaration_missing' | 'ui_declaration_unparsable' | 'ui_impact_not_boolean';
    detail: string;
};
/**
 * GUI 项目下声明段的结构化判定（与 parseUiUxDeclaration 的「安全默认」正交）：
 * 缺段 → ui_declaration_missing；无 fenced YAML / YAML 损坏 / 非对象 → ui_declaration_unparsable；
 * `ui_impact` 非布尔 → ui_impact_not_boolean；结构合法 → 返回 ui_impact 布尔值。
 */
export declare function analyzeUiDeclarationStructure(proposalMd: string): UiDeclarationStructure;
/**
 * module-aware `ui_impact` 派生（仿 delta_required）：
 *   = (活跃提案所属 module 的 product_type ∈ GUI) && proposal.md 声明段 ui_impact:true。
 * 非 GUI 模块（含缺字段）恒 false；声明 ui_impact:false 亦 false。
 */
export declare function deriveUiImpact(root: string, moduleId: string | undefined, proposalDir: string): boolean;
/**
 * 校验声明 `prototype` 为合法纯 basename：
 * - 无路径分隔（`/`、`\`）、无 `..` 段（防路径穿越）；
 * - 命名符合 `core-NN-<slug>.html`，slug 仅小写字母数字与连字符。
 */
export declare function isValidPrototypeBasename(s: unknown): s is string;
/** 定位随 CLI 分发的 spec 根（dev：仓库根 spec/；打包：cli/spec/）。 */
export declare function resolveSpecRoot(root: string): string;
export interface OverlayAddOp {
    op: 'add' | 'skip' | 'modify' | 'reorder';
    after?: string;
    before?: string;
    target?: string;
    node?: Record<string, unknown>;
    [k: string]: unknown;
}
/** runlogos → openlogos 的会话能力输入文件（gitignore、私有会话态）。 */
export declare const SESSION_CAPABILITIES_FILE: string;
export interface SessionCapabilities {
    ui_prototype_render?: boolean;
}
/**
 * 读 `logos/.session-capabilities.json`（runlogos 会话建立时写）。文件缺失/不可解析 → null（= 降级模式）。
 * **注意（F4 R7）**：capability 仅用于 plan-exit *之前*的模式选择；plan-exit *之后*的强制语义一律以持久化
 * `PLAN_APPROVED` provenance 为准，绝不因 capability 缺失降级。此处仅做「surface 输入」，不做强制判定。
 */
export declare function readSessionCapabilities(root: string): SessionCapabilities | null;
/**
 * 构造 status/next JSON 与会话上下文的 `capabilities` 段：
 * 仅当能力文件存在且 `ui_prototype_render:true` 时返回 `{ui_prototype_render:true}`；否则 undefined（省略=降级、golden 零漂移）。
 */
export declare function buildCapabilities(root: string): {
    ui_prototype_render: true;
} | undefined;
/** runlogos 关联件的具名依赖 slug。 */
export declare const UI_UX_PANEL_DEPENDENCY = "ui-ux-first-panel";
export type ReleaseStatus = 'contract-ready' | 'feature-enabled';
/**
 * 双阶段发布状态机器判定（契约侧）：
 * - feature-enabled **当且仅当** 具名关联 change `ui-ux-first-panel` 已部署 **且** 跨仓端到端 smoke 全绿；
 * - 否则一律 contract-ready（capability-disabled）——只交付契约、默认降级、不得 claim「UI/UX 确认已前移」已启用。
 * 由验收结果机器判定，非人工声称。
 */
export declare function evaluateReleaseStatus(input: {
    panelDelivered: boolean;
    crossRepoSmokePassed: boolean;
}): ReleaseStatus;
/** 读方法论 GUI overlay 唯一源（spec/flow/overlays/gui-ui-first.yaml）的 op 列表。 */
export declare function loadGuiOverlayOps(root: string): OverlayAddOp[];
/**
 * 幂等注入 GUI overlay 到项目实例 logos/flow/launched.yaml：
 * - 当项目含 ≥1 GUI 模块时调用；
 * - 把 gui-ui-first.yaml 的两个 op:add 并入实例 `overlay:` 列表；
 * - 按 node id 去重（重复 sync 不重复注入）；
 * - 保留实例中已有的用户自定义 overlay ops。
 * 返回是否发生写入变更。
 */
export declare function injectGuiOverlay(root: string): boolean;
/**
 * 幂等移除 GUI overlay ops（反向：项目不再含 GUI 模块时）：
 * - 按 node id 移除 write-ui-prototype / verify-ui-provenance；
 * - 用户自定义 overlay ops 一律保留。
 * 返回是否发生写入变更。
 */
export declare function removeGuiOverlay(root: string): boolean;
/** 项目实例 launched.yaml 当前含哪些 GUI overlay 节点 id（用于测试/幂等判定）。 */
export declare function instanceGuiOverlayNodeIds(root: string): string[];
/**
 * sync 时按 product_type 幂等对齐 overlay：项目含 ≥1 GUI 模块 → 注入；否则移除。
 * 返回 'injected' | 'removed' | 'unchanged'。
 */
export declare function syncGuiOverlay(root: string): 'injected' | 'removed' | 'unchanged';
//# sourceMappingURL=ui-first.d.ts.map