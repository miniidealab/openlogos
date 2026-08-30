/**
 * decision-record-capability（S38）：决策记录 DXX 编号的**闭合分配公式**（纯函数，确定性）
 * 与 merge-executor apply 事务的**受控执行入口**（`applyDecisionRecords`）。
 *
 * delta-r2 F5 修正：**基准只含已落盘记录、绝不纳入本批待落盘 DXX**——否则首条合法记录
 * （资源空、next_id=1、拟号 D01）会被 `max(1, max{D01}+1)=D02` 算成 D02、再因「文件名 D01 ≠ allocated」自拒。
 *
 * 定位：本函数是分配语义的**单一事实源**，供 merge-executor（AI，apply 时取号）与测试共用；
 * 它**不是 CLI 命令自动取号**（无命令在正常流程中调用它落盘）——`decision_counter` 仍由
 * `project-yaml.ts` 只读取侧解析、CLI 不取号（比照 `scenario_counter` / `feature_counter`）。
 *
 * code-r2 F2：`applyDecisionRecords` 是 merge-executor 「决策记录 apply 事务」的**可执行受控入口**，
 * 也是 `allocateDecisionRecordIds` 的**真实生产消费者**——它**自行解析** delta 文件名 / 标题 DXX、
 * **扫描**已落盘 DXX、**读取并保留**现有 YAML、**应用** delta 正文（写主文档）、走**权威 index 路径**
 * 更新索引、**持久化** counter，最后才写 `SPEC_MERGED`；分配失败**写零字节**（不落盘、不消耗号），
 * 重复执行**幂等**（已落盘条目跳过）。它**不是**新增的 `openlogos decision` CLI 命令（提案红线：不新增
 * 该命令），而是 merge-executor apply 步的事务原语——ST-S38-03 只负责准备输入并调用它、断言其产物。
 */
import type { Locale } from '../i18n.js';
export interface DecisionCandidate {
    /** 文件名中的 DXX 数字（`core-D07-slug.md` → 7）。 */
    filenameDxx: number;
    /** 文档标题中的 DXX 数字（`# D07：...` → 7）。 */
    titleDxx: number;
}
export interface DecisionAllocationResult {
    ok: boolean;
    /** 分配基准（只据已落盘 + configured_next_id 计算，不含本批）。 */
    base: number;
    /** 每条候选的 `expected_i = base + i`（仅 ok 时有意义，与 candidates 同序）。 */
    allocations: number[];
    /** 全部落盘后应持久化的 `decision_counter.next_id`（= base + 候选数）。 */
    persistedNextId: number;
    /** 拒绝原因（!ok 时）：文件名/标题与 expected 不一致，或本批内重复。 */
    error?: string;
}
/**
 * 闭合分配公式：
 * - `base = max(configuredNextId ?? 1, max(landedDxx，空集按 0) + 1)`（**只据已落盘**）。
 * - 候选按传入的稳定顺序，第 i 条（0 基）`expected_i = base + i`。
 * - 校验每条「filenameDxx == titleDxx == expected_i」；本批内 filenameDxx 不得重复。
 * - `persistedNextId = base + candidates.length`。
 *
 * @param landedDxx  已落盘决策记录的 DXX 数字集合（`logos/resources/decisions/` 扫描所得）。
 * @param configuredNextId  `decision_counter.next_id`（缺失传 undefined，回落 1）。
 * @param candidates  本提案待落盘候选，**须已按不依赖待分配 DXX 的稳定序（文件名 slug）排列**。
 */
export declare function allocateDecisionRecordIds(landedDxx: number[], configuredNextId: number | undefined, candidates: DecisionCandidate[]): DecisionAllocationResult;
/** 从决策记录文件名（`<module>-D<NN>-<slug>.md` 或 `D<NN>-<slug>.md`）解析 DXX 数字；不匹配 → null。 */
export declare function parseDecisionFilenameDxx(filename: string): number | null;
/** 从决策记录文档标题（`# D07：…` / `# D07 …`）解析 DXX 数字；不匹配 → null。 */
export declare function parseDecisionTitleDxx(body: string): number | null;
export interface DecisionApplyResult {
    ok: boolean;
    /** 本次真实落盘/更新的记录（op：ADDED 新增取号 / MODIFIED 就地更新保号）。 */
    applied: {
        file: string;
        dxx: number;
        op: 'ADDED' | 'MODIFIED';
    }[];
    base?: number;
    persistedNextId?: number;
    /** !ok 时的拒绝/解析原因。 */
    error?: string;
}
/** 决策 apply 事务凭据（code-r5 F2，比照 ui-provenance 的 UI_COMMIT_JOURNAL）：崩溃/中断后据此前滚或回滚。 */
export declare const DECISION_APPLY_JOURNAL = "DECISION_APPLY_JOURNAL.json";
/**
 * merge-executor 决策记录 apply 事务的受控执行入口（code-r2/r3/r4/r5 F2）。按 skills/merge-executor/SKILL.md
 * §「决策记录 apply 事务所有权」与场景 core-S38-decision-record §三（superseded）语义执行，**全部输入均从磁盘解析**：
 * ① 已提交（`SPEC_MERGED` 在场）→ 幂等 no-op；
 * ② 解析并**按段标记分类** ADDED / MODIFIED（MODIFIED = 就地更新既有记录、**保号不取新号**，支撑 superseded）；
 *    MODIFIED 目标须存在；文件名 DXX == 标题 DXX；
 * ③ **持久事务凭据（journal）判身份**（code-r5 F2，替代 r4 的内容摘要）：先原子落一份 `DECISION_APPLY_JOURNAL.json`
 *    （提案身份 = 目标集合 + 正文；含 base / 分配号 / 旧内容）再写任何资源。
 *    - **无匹配 journal（全新）**：同名 ADDED 目标已存在 → 一律**冲突拒绝**（即使正文相同——内容相等不能证明其
 *      由本次失败事务创建）；base 计入**全部已提交落盘 DXX**，`allocateDecisionRecordIds` 取号（重复即拒）。
 *    - **有匹配 journal（崩溃/中断恢复）**：直接沿用 journal 记录的 base/分配号（**绝不据已前移的 counter 重算**，
 *      故 marker 前崩溃可前滚补齐、不会重算成 D(N+1) 自拒）；同名既有目标是本事务残留、按 journal 恢复。
 * ④ **可回滚事务**：备份目标/YAML/marker，写主文档 → syncResourceIndex → 持久化 counter（仅 ADDED 批）→
 *    **写 marker 前重读校验后置条件**（文档集合 / counter / index）→ 写 `SPEC_MERGED` → 删 journal。
 *    任一步抛错 → 回滚已写、恢复旧内容/删除新建；全新事务回滚后删 journal，恢复事务保留 journal 供再次重试。
 * 事后点数由 S37 守恒门（lint L8 / merge 消费点）在 merge 前把关；本入口负责合法批的**原子**落盘、崩溃前滚与回滚。
 */
export declare function applyDecisionRecords(root: string, proposalDir: string, locale?: Locale): DecisionApplyResult;
//# sourceMappingURL=decision-record.d.ts.map