/**
 * timestamp — 严格 RFC 3339 / ISO 8601 绝对时刻解析（contract-self-description C6/D7）。
 *
 * 契约（spec/test-results.md「归一化规则」第 5 条）：严格解析、含时区偏移归一为绝对时刻、
 * 非法一律按「缺失」处理。两条硬约束（code review F1）：
 * 1. **必须携带时区**（`Z` 或 `±HH:MM` 数字偏移）——无时区的本地时间在不同机器上会解出不同绝对时刻，
 *    违反「同一账本跨机器同一结论」；
 * 2. **拒绝日历溢出**（如 2026-02-30）——Date.parse 会静默滚动进位，此处逐字段回验拒绝。
 * 解析用手工纪元运算，结论与运行机器时区（TZ）无关。
 */
/** 全精度绝对时刻：epoch 毫秒 + 亚毫秒纳秒余量（code review r2-F1：比较不得降精度）。 */
export interface StrictTimestampParts {
    ms: number;
    subMsNanos: number;
}
/**
 * 全精度严格解析。首尾空白也是非法输入（code review r2-F6：读取端与发布 schema 的
 * `date-time` 格式必须一致，不做 trim 宽容）。
 */
export declare function parseStrictTimestampParts(ts: unknown): StrictTimestampParts | null;
/** 毫秒粒度视图（marker 合法性判定等场景）；全序比较请用 parseStrictTimestampParts。 */
export declare function parseStrictTimestampMs(ts: unknown): number | null;
/** 全精度比较：a 晚于 b → 正数；同一绝对时刻 → 0（由调用方按行序裁决）。 */
export declare function compareStrictTimestamps(a: StrictTimestampParts, b: StrictTimestampParts): number;
//# sourceMappingURL=timestamp.d.ts.map