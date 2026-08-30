import { DELTA_TO_RESOURCE, classifyProposalDeltas, DeltaScanUnreadableError, type DeltaEntryClassification, type MergeDisposition, type LintValidity } from './delta-classify.js';
import { type BaselineClosureSummary } from './baseline-closure.js';
import { type TestChangeSetReadResult } from './test-change-set.js';
import { type PlanPackageEvaluation } from './plan-package-contract.js';
export { DELTA_TO_RESOURCE, classifyProposalDeltas, DeltaScanUnreadableError };
export type { DeltaEntryClassification, MergeDisposition, LintValidity };
export declare const CHANGE_LINT_VIOLATION_CODES: readonly ["proposal_required_section_missing", "proposal_required_section_duplicate", "proposal_required_section_empty", "proposal_placeholder_remaining", "proposal_change_type_invalid", "proposal_deployment_fields_invalid", "proposal_clarification_invalid", "tasks_template_remaining", "tasks_code_entry_before_spec_complete", "tasks_code_section_missing", "tasks_deployment_conflict", "tasks_sections_unparsable", "tasks_code_header_missing", "code_change_requires_real_test_ids", "delta_missing_section_marker", "delta_template_skeleton", "deployment_decision_conflict", "delta_path_invalid", "design_system_mode_invalid", "no_pages_declared", "prototype_path_traversal", "prototype_basename_invalid", "prototype_basename_duplicate", "prototype_missing", "prototype_extra", "prototype_empty", "design_system_missing", "design_system_invalid", "design_system_empty", "fallback_reason_missing", "fallback_token_forged", "ui_declaration_missing", "ui_declaration_unparsable", "ui_impact_not_boolean", "delta_implicit_id_removal", "delta_removed_unknown_id", "delta_section_anchor_unresolvable", "baseline_closure_declaration_missing", "baseline_closure_malformed", "baseline_closure_target_missing", "delta_target_duplicate", "delta_target_mode_mismatch", "baseline_closure_ambiguous", "delta_target_unplanned", "create_target_incomplete", "non_markdown_delta_invalid", "clarification_contract_invalid"];
export type ChangeLintViolationCode = typeof CHANGE_LINT_VIOLATION_CODES[number];
export interface ChangeLintViolation {
    code: ChangeLintViolationCode;
    /** 相对项目根路径。 */
    path: string;
    message: string;
    fix_hint: string;
    flow_reason?: string;
}
/**
 * change-lint 警告（decision-record-capability S38，delta-r1 F4）——与 `violations[]` **正交**：
 * warning 是**提醒**、不影响 `pass` / exit code，走独立通道、不进 `ChangeLintViolationCode` 闭合枚举。
 * 契约（出现/省略、item 闭合字段、稳定排序）以 `spec/cli-json-output.md` §3.15 为唯一事实源；
 * `warnings` 仅在**非空时出现**、否则整个字段省略（零漂移）。item 恰含 code/message/fix_hint（不含 path）。
 */
export type ChangeLintWarningCode = 'decision_record_section_without_delta';
export interface ChangeLintWarning {
    code: ChangeLintWarningCode;
    message: string;
    fix_hint: string;
}
export declare const SECTION_MARKER_RE: RegExp;
export interface MarkdownDeltaValidation {
    missingSectionMarker: boolean;
    templateSkeleton: boolean;
    /** 命中的占位行/占位标题（供 message 定位）。 */
    skeletonHits: string[];
}
/**
 * `.md` delta 结构校验（结构规则而非全文词表，**同一份 fence-aware 扫描**同时判两结论——F4）：
 * - missingSectionMarker：围栏外无任何 ADDED/MODIFIED/REMOVED **物质变更**段标记（围栏内示例不算权威标记）。
 *   S37：`REMOVED-ITEMS` 是合法段标记但**纯声明性**（无物质变更载体）——仅含 REMOVED-ITEMS 的 delta 仍判缺物质标记；
 * - templateSkeleton：围栏外 (a) marker 标题本身是占位标题，或 (b) 存在任一独占一行的权威模板
 *   占位符行——不要求正文全部由占位构成，真实内容与残留占位行混合的部分模板同样命中；
 *   行内代码、代码围栏中的引用不得命中。
 */
export declare function validateMarkdownDelta(content: string): MarkdownDeltaValidation;
/**
 * ID 模式注册表（S37）：守恒覆盖的 ID 类别唯一事实源——每类含 token 文法 + 结构化抽取位置双要素。
 * 测试 ID 的 token 判形复用 proposal-lifecycle 的权威 parser（结构位置 = 测试表 ID 首列，
 * 由 extractStructuredTestIds 承载）；本注册表只新增场景 ID 与节号两类。严禁在注册表外散落第二份 ID 正则。
 */
export declare const ID_PATTERN_REGISTRY: {
    /**
     * 场景 ID：`## SXX:` / `### SXX` 形态章节标题——SXX 后接冒号、空白或行尾均为合法结构位置
     * （契约 §2.33.3；真实语料含无冒号的 `### S01` 验收摘要标题）；`S999x` 等前缀伪命中仍拒绝。
     */
    readonly scenarioHeading: RegExp;
    /** 场景 ID：场景总览 / 场景地图表行首列单元格（整格恰为 SXX；表结构、表头 schema 与辖属上下文由抽取器把关）。 */
    readonly scenarioRow: RegExp;
    /**
     * 决策记录 ID（S38 decision-record-capability）：`# DXX：` / `## DXX` 形态章节标题——
     * DXX 后接冒号、空白或行尾均为合法结构位置（决策记录文档标题）；`D123x` 等前缀伪命中仍拒绝。
     * 承 §2.33.3 预留「注册表扩展只改一处、判据函数零改动」——DXX 复用同一 flat 守恒机制。
     */
    readonly decisionHeading: RegExp;
    /** 决策记录 ID：决策表行首列单元格（整格恰为 DXX，供多决策索引表结构位置识别）。 */
    readonly decisionRow: RegExp;
    /**
     * 决策表首列表头语义（code-r1 F1）：首列表头须为「编号 / 决策编号」——比照 scenarioTableHeader。
     * 决策表分支与场景表分支正交分流：场景表数据行为 SXX（不命中 decisionRow）、决策表数据行为 DXX
     * （不命中 scenarioRow），故两分支可安全并跑于同一张表而互不污染。
     */
    readonly decisionTableHeader: RegExp;
    /** 场景表首列表头语义（结构化归属，code-r1 F3）：首列表头须为「编号 / 场景编号」。 */
    readonly scenarioTableHeader: RegExp;
    /** 场景表第二列表头 schema（code-r2 F3）：正式场景表第二列恒为「场景名称」——普通编号表（如「编号+说明」）不构成场景 ID 结构位置。 */
    readonly scenarioTableSecondHeader: RegExp;
    /** 场景表辖属语义（code-r2 F3）：表的辖属标题链（块内最近祖先标题 + 章节锚上下文）须含场景总览 / 场景地图语义标题。 */
    readonly scenarioSectionTitle: RegExp;
    /**
     * 节号完整 token 文法（等价 `N(?:\.N)*(?:[A-Za-z]|\.[A-Za-z])?`）：多级数字 + 可选直接单字母后缀
     * 或末级点分单字母；完整 token 即 ID——`2.29.1` ≠ `2.29.2` ≠ `2.29`，`2.2b` ≠ `2.2c`，`2.19.A` ≠ `2.19.B`。
     * 结构位置 = 仅标题行首 token，版本号 / 散文小数天然排除。
     */
    readonly sectionNumber: RegExp;
};
export interface DeltaConservationViolation {
    code: 'delta_implicit_id_removal' | 'delta_removed_unknown_id' | 'delta_section_anchor_unresolvable';
    anchor: string;
    message: string;
    fix_hint: string;
}
/**
 * S37 守恒判据纯函数（事前点数，lint L8 与 merge 消费点共享的唯一实现）：
 * 逐触及章节（MODIFIED / REMOVED / REMOVED-ITEMS 锚定）按结构化归属对账——
 * 锚定章节既有结构化 ID − 同锚 MODIFIED 新内容结构 ID − 同锚 REMOVED-ITEMS 点名 −（整节 REMOVED 全节 ID）
 * 必须为空。目标主文档不存在（targetContent === null，新文件）时无守恒义务。
 * 纯函数、无 IO、不抛未捕获异常（畸形输入产出空块列表，由 L4 先行拦截）。
 */
export declare function evaluateDeltaConservation(deltaContent: string, targetContent: string | null): DeltaConservationViolation[];
/**
 * 提案级跨文件单写者检查辅助（code-r1 F1）：返回本 delta 文件中锚唯一解析成功的 MODIFIED 块
 * 的目标章节键（目标文档内的章节起始行号）。lint 与 merge 用它对同一目标文件跨 delta 文件
 * 检出「同一章节多写者」——与 evaluateDeltaConservation 共享同一解析/锚定实现，严禁第二份判据。
 */
export declare function resolveModifiedSectionKeys(deltaContent: string, targetContent: string | null): number[];
/** delta 相对路径（`deltas/<category>/<rest>`）→ 项目根相对目标路径；无法映射（unknown 类别 / 根级直放）→ null。 */
export declare function deltaTargetProjectPath(relativePath: string): string | null;
/**
 * 自 merge.ts 私有 readProposalModule 提取：读 proposal.md 头部 `> module: <id>`（持久事实源）。
 * F11：只认**围栏外**的头行——围栏内示例不构成权威 module 声明。
 */
export declare function readProposalModuleHeader(proposalDir: string): string | undefined;
export type ProposalModuleResolution = {
    ok: true;
    moduleId: string;
    productType?: string;
    isGui: boolean;
} | {
    ok: false;
    detail: string;
};
/**
 * 模块归属解析（module-aware 判据的唯一权威，含 L7 与 merge 的 UI 门——F1）：
 * ① proposal.md 头 `> module:` 优先（持久事实源）；② 头缺失且 guard.activeChange==slug 才回退 guard.module；
 * ③ 冲突以头为准；④ 无法解析或模块不在 logos-project.yaml → fail-closed（module_unresolved，不得静默按非 GUI 跳过）。
 */
export declare function resolveProposalModuleContext(root: string, proposalDir: string, slug: string): ProposalModuleResolution;
export type ChangeLintOpErrorCode = 'not_initialized' | 'no_active_proposal' | 'slug_not_found' | 'slug_invalid' | 'module_unresolved' | 'artifact_unreadable' | 'baseline_commit_in_progress';
export type ChangeLintRunResult = {
    ok: true;
    slug: string;
    violations: ChangeLintViolation[];
    warnings: ChangeLintWarning[];
    checks: {
        id: number;
        label: string;
        violations: number;
    }[];
    plan_package: PlanPackageEvaluation;
    baseline_closure?: BaselineClosureSummary;
    test_change_set?: TestChangeSetReadResult;
} | {
    ok: false;
    errorCode: ChangeLintOpErrorCode;
    message: string;
};
/**
 * 决策记录 warning 判据（S38，delta-r1 F4；code-r1/r2 F3 修正范围）：proposal 含「已确定的设计决策」
 * **章节标题**（fence/注释外的真实标题，不采信围栏内示例）、但 `[delta]` 段无任何 `deltas/decisions/`
 * 产出（`[delta]` 段**结构化任务项**规划或实际 mergeable decisions delta 条目均无）→ 提醒补决策记录 delta。
 * code-r1 F3：① 决策章节判定改走 fence-aware 标题扫描（authorityScan + scanHeadings）——围栏内的
 * `## 已确定的设计决策` 示例不再误触发。
 * code-r2 F3：② `deltas/decisions/` 扫描收敛到 `[delta]` 段的**结构化任务项**（复用 proposal-lifecycle
 * 的 extractTaskSectionItems，仅匹配 `- [ ]` / `- [x]` 项正文）——段内的普通说明、HTML 注释、围栏示例
 * （如「本案不要创建 `deltas/decisions/`」）不再冒充权威任务、不再误抑制 warning。
 * 纯结构判定、复用既有 proposal / tasks 分节解析，无第二份 proposal 解析。
 */
export declare function computeDecisionRecordWarnings(proposalContent: string, tasksContent: string, hasDecisionsDeltaEntry: boolean): ChangeLintWarning[];
/** 严格 slug 词法（spec §2.30；r2 F18）：不匹配者仅当历史目录实际存在时走只读兼容，否则 slug_invalid。 */
export declare const SLUG_STRICT_RE: RegExp;
/** slug 词法硬拒绝：空值、路径分隔符、`.`、`..`、绝对路径（F8：显式 flag 缺值同拒）。 */
export declare function isDangerousSlug(slug: string): boolean;
/**
 * 对提案目录运行 L1–L7 全部检查并按全序稳定排序返回。
 * 读取顺序（操作错误即终止红线由调用方 change-lint 命令实现）：
 * proposal.md（含 module resolver）→ tasks.md → deltas/**（含全量可读性探测——F7）。
 */
export declare function runChangeLint(root: string, proposalDir: string, slug: string): ChangeLintRunResult;
//# sourceMappingURL=change-lint.d.ts.map