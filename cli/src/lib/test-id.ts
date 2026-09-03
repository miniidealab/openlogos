/**
 * 测试 ID 语法及其具名读法的**唯一权威**（架构 §四十一.4 / §四十一.6.1）。
 *
 * 本模块刻意不 import 任何项目内模块——语法是叶子事实，任何消费方都能安全引用而不制造循环依赖。
 *
 * ## 为什么是「一个语法 + 多种具名读法」而不是「一个正则」
 *
 * 读法差异是正当的，各自定义不正当。本模块此前在 7 处各写一份，分三种读法：
 *
 * - 锚定判定（整串必须是 ID）：`authority-closure`、`proposal-lifecycle`、`test-change-set`、`test-slice-manifest`
 * - 散文扫描（在正文中查找 ID 提及）：`proposal-lifecycle`、`automation-diagnostic`、`verify`
 * - 表格提取（首列 / 单元格，后者带可选 `[manual]` 标记）：`test-slice-manifest`、`verify`
 *
 * 其中「扫描时不匹配 SMOKE」是正当差异——SMOKE 不进 verify 可选集，正文提及它不构成用例引用。
 * 因此本模块把差异**具名导出**，而不是强行统一为一种。
 *
 * ## 语法为何放宽
 *
 * 严格读法此前要求 ID 形如 `(?:UT|ST)-S\d{2}-…`，使已合并规格中 11 个 `UT-JSON-*` / `ST-JSON-*`
 * 不被接纳——对这些用例的改动绕过切片归属，也不进入 verify 的 defined 集合。放宽后严格读法与
 * 锚定读法收敛为同一判据。变化只增不减：不存在此前被接纳、此后被拒绝的 ID。
 *
 * 一致性由 UT-S35-131 保障：断言已合并测试规格中每一个表格首列 ID 都被本语法接纳。
 * 原始缺陷不是正则写错了，而是没人检查正则与真实数据是否还对得上。
 */

/** ID 主体语法（不含锚点与边界），三种读法共用同一核心。 */
const TEST_ID_CORE = '(?:UT|ST|SMOKE)-[A-Za-z0-9]+(?:-[A-Za-z0-9]+(?:\\.[A-Za-z0-9]+)*)*';
/** verify 可选集只含 UT/ST——SMOKE 由 Gate 3.8 独立统计。 */
const VERIFICATION_ID_CORE = '(?:UT|ST)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*';

/** 锚定读法：整串必须是合法测试 ID。 */
export const TEST_ID_ANCHORED_RE = new RegExp(`^${TEST_ID_CORE}$`);

/** 散文扫描读法：在正文中查找 ID 提及（含 SMOKE）。调用方每次新建以避免 lastIndex 残留。 */
export const testIdScanRe = (): RegExp => new RegExp(`\\b${TEST_ID_CORE}\\b`, 'g');

/** 验收扫描读法：同上但**不含 SMOKE**——正文提及 SMOKE 不构成 verify 可选用例引用。 */
export const verificationIdScanRe = (): RegExp => new RegExp(`\\b${VERIFICATION_ID_CORE}\\b`, 'g');
/** 验收扫描读法的单次匹配版本。 */
export const VERIFICATION_ID_RE = new RegExp(`\\b${VERIFICATION_ID_CORE}\\b`);

/** 表格首列读法：`| <ID> |` 形态的结构化提取。 */
export const TABLE_TEST_ID_RE = new RegExp(`^\\|\\s*(${TEST_ID_CORE})\\s*\\|`);

/** 表格单元格读法：允许 `[manual]` 后缀，用于 verify 的覆盖度清单。 */
export const TABLE_CELL_ID_RE = new RegExp(`^\\s*(?:${VERIFICATION_ID_CORE})(?:\\s*\\[manual\\])?\\s*$`, 'i');

/** 锚定判定：整串是否为合法测试 ID。 */
export function isTestId(candidate: string): boolean {
  return TEST_ID_ANCHORED_RE.test(candidate);
}
