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

const STRICT_RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

/** 全精度绝对时刻：epoch 毫秒 + 亚毫秒纳秒余量（code review r2-F1：比较不得降精度）。 */
export interface StrictTimestampParts {
  ms: number;
  subMsNanos: number;
}

/**
 * 全精度严格解析。首尾空白也是非法输入（code review r2-F6：读取端与发布 schema 的
 * `date-time` 格式必须一致，不做 trim 宽容）。
 */
export function parseStrictTimestampParts(ts: unknown): StrictTimestampParts | null {
  if (typeof ts !== 'string') return null;
  const m = STRICT_RFC3339.exec(ts); // 不 trim：带首尾空白 → 非法
  if (!m) return null;
  const [, ys, mos, ds, hs, mis, ss, frac, off] = m;
  const y = Number(ys), mo = Number(mos), d = Number(ds);
  const hh = Number(hs), mi = Number(mis), sec = Number(ss);
  if (mo < 1 || mo > 12 || d < 1 || hh > 23 || mi > 59 || sec > 59) return null;
  // 日历溢出回验：Date.UTC 会滚动进位（2026-02-30 → 03-02），逐字段比对拒绝
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  let offsetMin = 0;
  if (off !== 'Z') {
    const sign = off.startsWith('-') ? -1 : 1;
    const oh = Number(off.slice(1, 3));
    const om = Number(off.slice(4, 6));
    if (oh > 23 || om > 59) return null;
    offsetMin = sign * (oh * 60 + om);
  }
  // 小数秒补齐 9 位：前 3 位并入毫秒，后 6 位保留为亚毫秒纳秒余量参与全序比较（不截断、不丢精度）
  const frac9 = (frac ?? '').padEnd(9, '0');
  const fracMs = frac ? Number(frac9.slice(0, 3)) : 0;
  const subMsNanos = frac ? Number(frac9.slice(3)) : 0;
  return { ms: Date.UTC(y, mo - 1, d, hh, mi, sec) + fracMs - offsetMin * 60_000, subMsNanos };
}

/** 毫秒粒度视图（marker 合法性判定等场景）；全序比较请用 parseStrictTimestampParts。 */
export function parseStrictTimestampMs(ts: unknown): number | null {
  const parts = parseStrictTimestampParts(ts);
  return parts ? parts.ms : null;
}

/** 全精度比较：a 晚于 b → 正数；同一绝对时刻 → 0（由调用方按行序裁决）。 */
export function compareStrictTimestamps(a: StrictTimestampParts, b: StrictTimestampParts): number {
  if (a.ms !== b.ms) return a.ms - b.ms;
  return a.subMsNanos - b.subMsNanos;
}
