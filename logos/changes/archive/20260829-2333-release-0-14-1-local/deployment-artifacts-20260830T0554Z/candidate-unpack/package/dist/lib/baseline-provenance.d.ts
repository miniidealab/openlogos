export type CandidateState = 'active' | 'tombstone' | 'retired';
export type Provenance = 'reverse-engineered' | 'unknown';
export type BaselineSeedState = 'required' | 'partial' | 'seeded';
export interface BaselineCandidate {
    key: string;
    anchor?: string;
    display?: string;
    state: CandidateState;
    verified: boolean;
    aliases: string[];
    superseded_by: string[];
    confirmed_by: string | null;
    evidence: string | null;
    confirmed_at: string | null;
    retired_by: string | null;
    retire_event_id: string | null;
}
export interface ProvenanceSection {
    candidates: BaselineCandidate[];
    /** sha256 覆盖整个 `## 逆向基线来源` 章节文本（含 candidates 全部字段）。 */
    source_hash: string;
    /** F5：章节存在但 fenced YAML 解析失败/结构非法时为 false（不得静默当作空候选、报 fresh）。 */
    parse_ok: boolean;
}
/** F3：规范键格式 `<module>::<12 位十六进制>`。 */
export declare function isCanonicalKey(key: string, moduleId?: string): boolean;
/** 覆盖率新鲜度：fresh=索引与文档一致或直接重算；stale=索引与文档不符；unknown=解析失败。 */
export type CoverageFreshness = 'fresh' | 'stale' | 'unknown';
export interface CoverageResult {
    /** 候选计数 = active ∪ tombstone（retired 不计入）。纯逆向候选计数，无分子/比值。 */
    denominator: number;
    /** tombstone 数（仍计入 denominator，供人读拆分）。 */
    tombstones: number;
}
export interface BaselineRecovery {
    available: true;
    entry: string;
    run_id: string | null;
}
export interface BaselineCoverage {
    state: BaselineSeedState;
    /** 稳定 shape：恒存在为布尔。state==partial → true，否则 false。 */
    incomplete: boolean;
    /** 候选计数 = active ∪ tombstone（纯逆向候选计数，无分子/比值）。 */
    denominator: number;
    tombstones: number;
    source: 'derived-index' | 'documents';
    freshness: CoverageFreshness;
    /** 仅 state==partial 且存在活跃提案时出现：结构化恢复 advisory（不改 proposal_step、不阻断 change）。 */
    recovery?: BaselineRecovery;
    /** 恢复门无法取锁（提交进行中）时置 true：不把当前集合当权威。 */
    commit_in_progress?: boolean;
}
export declare function sha256(content: string): string;
/** anchor 规范化：NFKC + 去首尾空白 + 小写 + 折叠内部空白。 */
export declare function normalizeAnchor(anchor: string): string;
/** 规范键 key = `<module>::<sha256(normalize(anchor))[:12]>`（hash 形式，slug 只进 anchor/display）。 */
export declare function candidateKey(moduleId: string, anchor: string): string;
/**
 * provenance-scan-canonical-recompute：扫描侧候选采信判据（与写侧 baseline-seed 的 validateSeedCandidate 同强度）。
 * 采信一个候选为该 module 的权威候选 ⇔ 其 `key` **可由 anchor 或任一 alias 重算得出**：
 *   `key === candidateKey(module, anchor)` ∨ `∃ a∈aliases[] : key === candidateKey(module, a)`
 * - **alias-aware**：`aliases[]` 语义是旧 anchor、改名后 `key` 稳定（见 §三 身份继承），故必须容许由旧 anchor 重算，
 *   以保留改名继承 / tombstone / superseded 合法候选；单用当前 anchor 会误杀。
 * - 只认 hash 可重算性、**不认前缀**：格式合法但 hash 失配的幽灵/示例 key（文档/教学示例）不被采信，防其毒化基线。
 * 因 `candidateKey(module, …)` 恒产出 `module::` 前缀，本判据天然蕴含模块归属，无需再单独前缀过滤。
 */
export declare function isCandidateKeyRecomputable(c: BaselineCandidate, moduleId: string): boolean;
/** 抽取 `## 逆向基线来源` 章节文本（从该标题到下一个顶层 `## ` 标题或文末）。缺失返回 null。 */
export declare function extractProvenanceSectionText(markdown: string): string | null;
/**
 * F3：抽取 `## 逆向基线来源` 章节的**原始（未规范化）** candidates 条目——供 seed 输入做严格 schema 校验。
 * 缺章节返回 null；有章节但无 fenced YAML / 结构非法返回 `{ ok:false, raw:[] }`。
 */
export declare function extractRawCandidates(markdown: string): {
    ok: boolean;
    raw: unknown[];
} | null;
/**
 * F3：seed 输入候选的**严格** schema 校验（不经宽松规范化）。种子只登记可验证事实，故要求：
 * - `state` **显式**为 `active`（拒绝未知/伪造状态被归一为 active）；
 * - `verified` **显式**为布尔 `false`（拒绝缺失/非布尔被归一为 false）；
 * - `anchor` 为非空字符串（种子必须携带语义锚点）；
 * - `key` 存在且 == `candidateKey(module, anchor)`（重算比对，杜绝 key 与 anchor 脱钩/伪造）。
 * 通过返回 null；否则返回中文原因串。
 */
export declare function validateSeedCandidate(raw: unknown, moduleId: string): string | null;
/** 解析文档内 `## 逆向基线来源` 章节的 candidates[] 与 source_hash。缺章节返回 null。 */
export declare function parseProvenanceSection(markdown: string): ProvenanceSection | null;
/**
 * provenance 为派生值（单一可信来源），由 `state` 派生（不再读 `verified`——确认概念已删除，无 human-verified 值）：
 * state∈{active,tombstone} ⇒ reverse-engineered；否则（retired / 章节缺失）⇒ unknown。
 */
export declare function deriveProvenance(candidate: BaselineCandidate): Provenance;
/** 缺 `## 逆向基线来源` 章节的既有文档 provenance 派生（保守迁移用）。 */
export declare function classifyDocProvenance(markdown: string): 'reverse-engineered' | 'unknown';
/**
 * tombstone 分母法（纯逆向候选计数）：denominator = active ∪ tombstone（retired 不计入）；
 * 无分子、无 coverage 比值。删除候选转 tombstone 仍计入 denominator ⇒ 计数不因删除而缩小、不虚增。
 */
export declare function computeCoverage(candidates: BaselineCandidate[]): CoverageResult;
export interface ScanResult {
    candidates: BaselineCandidate[];
    /** 各含章节文档的 source_hash，按文档路径排序拼接后的聚合 hash（供新鲜度对账）。 */
    aggregate_hash: string;
    doc_count: number;
    /** F5：任一含 `## 逆向基线来源` 章节的文档解析失败/结构非法。 */
    parse_failed: boolean;
}
/** 扫描 logos/resources 下所有含 `## 逆向基线来源` 章节的文档，聚合某模块的候选（只读已合并主文档）。 */
export declare function scanModuleCandidates(root: string, moduleId: string): ScanResult;
/**
 * F4：列出**当前持有**某模块权威候选（key 以 `<module>::` 前缀）的所有资源文档，返回**相对项目根**的 posix 路径
 * （形如 `logos/resources/...`）。commit/begin 用它强制「manifest 目标必须覆盖所有已持有候选的文档」——
 * 否则目标改名/换址后旧文档不进对账、旧候选残留 → 跨文档重复 key → 扫描 parse_failed。
 */
export declare function listModuleProvenanceDocs(root: string, moduleId: string): string[];
/** 派生索引条目（可选）：logos-project.yaml 的 baseline_index[moduleId]。 */
export interface BaselineIndexEntry {
    source_hash?: string;
    denominator?: number;
    generated_at?: string;
}
/**
 * 构造 next/status 输出的 baseline_coverage 对象。覆盖率只读已合并主文档；
 * 若派生索引 source_hash 与实时聚合 hash 不符 ⇒ freshness=stale（不输出可信精确百分比）。
 */
export declare function buildBaselineCoverage(root: string, moduleId: string, state: BaselineSeedState, indexEntry?: BaselineIndexEntry | null): BaselineCoverage;
/** F4：把候选注册表序列化为 `## 逆向基线来源` 章节文本（确定性、供 commit 落盘）。 */
export declare function serializeProvenanceSection(candidates: BaselineCandidate[]): string;
/** F4：用给定候选替换文档内 `## 逆向基线来源` 章节（缺则追加）；其余正文保持不变。 */
export declare function replaceProvenanceSection(markdown: string, candidates: BaselineCandidate[]): string;
/**
 * F4：重扫候选继承 + tombstone 对账。以 prior（已合并主文档候选）为基准合并 staged：
 * - 匹配（同 key 或 alias 命中）：继承身份与 alias，但把历史确认残留冻结为 false/null，不写回 confirmed_*。
 * - prior 中在 staged 消失的候选：转 `tombstone` 并同样清除确认残留；`retired` 保持生命周期但不保留确认值。
 * 结果按 key 排序（确定性、幂等）。
 */
export declare function reconcileCandidates(prior: BaselineCandidate[], staged: BaselineCandidate[]): BaselineCandidate[];
/**
 * F4：**模块级全局**重扫继承 + tombstone 对账（取代逐目标文档独立对账，杜绝跨文档移动产生的重复候选）。
 *
 * 以模块下**所有目标文档**的 prior 候选为全局注册表，按 key、**anchor（含 normalize）**、aliases 三路匹配 staged：
 * - `aliases[]` 权威语义是**旧 anchor**（非旧 key）——故 prior 同时按其 `anchor` 与 `aliases` 建索引，staged 的
 *   `aliases`（旧 anchor）既直接匹配 prior anchor，也经 `candidateKey(module, alias)` 匹配 prior key，保证真实
 *   anchor 重命名可继承身份。
 * - 匹配成功：继承候选身份与 alias（含 prior 旧 anchor），但历史确认残留统一冻结为 false/null，
 *   身份分配到 staged 的**新目标文档**（支持跨文档移动，不在旧文档留 tombstone、不产生跨文档重复 key）。
 * - prior 中在 staged 消失且未被继承的候选：在其**原文档**转 tombstone（retired 原样保留）。
 * 返回 `Map<target_path, 候选[]>`（每文档内按 key 排序，确定性、幂等）。
 */
export declare function reconcileModuleCandidates(moduleId: string, priorByDoc: Map<string, BaselineCandidate[]>, stagedByDoc: Map<string, BaselineCandidate[]>): Map<string, BaselineCandidate[]>;
//# sourceMappingURL=baseline-provenance.d.ts.map