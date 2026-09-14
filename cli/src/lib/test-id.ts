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

/**
 * 首格 manual 标记的语法权威（S13 不变量 1）：`[manual]` 或 `[manual/<平台>]`。
 * 判定与剥离都从这一处取，避免「判据认一种、剥离认另一种」的分叉。
 * SRC 形态用显式大小写字符类（等价 /i），供不能整体加 /i 的组合正则（ID 部分大小写敏感）复用。
 */
const MANUAL_MARKER_SRC = '\\[[Mm][Aa][Nn][Uu][Aa][Ll](?:\\/[A-Za-z0-9_-]+)?\\]';
export const MANUAL_MARKER_RE = new RegExp(MANUAL_MARKER_SRC);

/**
 * 表格首列读法：`| <裸 ID> |` 或 `| <裸 ID> [manual] |` 形态的结构化提取（§2.51.7 首格唯一语义，
 * fix-table-test-id-manual-marker）：首格 = 裸 ID + 可选 manual 标记；容忍并剥离标记，捕获组 1
 * 恒为**裸 ID**。此前带标记整行不匹配，切片层因此拒绝 verify 层认可的 `SMOKE-core-XX [manual]` 行。
 */
export const TABLE_TEST_ID_RE = new RegExp(`^\\|\\s*(${TEST_ID_CORE})(\\s*${MANUAL_MARKER_SRC})?\\s*\\|`);

/** 表格首列读法的行级结果：裸 ID + 该行首格是否带 manual 标记。 */
export interface TableTestIdRow {
  id: string;
  manual: boolean;
}

/**
 * 表格首列读法的行级判定（单点）：行首格匹配「裸 ID + 可选 manual 标记」则返回裸 ID 与标记在场性，
 * 否则 null。全部表格提取消费方（变更 ID 提取 / 已定义验证 ID 提取 / spec_target 校验 / 一致性锁）
 * 一律经此读法，不得自建第二份首格正则。
 */
export function matchTableTestIdRow(line: string): TableTestIdRow | null {
  const match = TABLE_TEST_ID_RE.exec(line.trim());
  if (!match || !isAcceptedTestId(match[1])) return null;
  return { id: match[1], manual: match[2] !== undefined };
}

/**
 * 首格字符串读法（单点剥离）：候选为「<主体> + 可选 manual 标记」时剥离标记返回主体，否则原样
 * 返回（只去外围空白）。语义变更集定义解析（§2.37.3：裸 ID 为身份、标记属定义语义）与 lint 首格
 * 判定共用——剥离后的主体是否为合法 ID 由调用方以权威文法判定。
 */
export function stripFirstCellManualMarker(cell: string): string {
  const trimmed = cell.trim();
  const match = new RegExp(`^([\\s\\S]*?)\\s*${MANUAL_MARKER_SRC}$`).exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

/** 表格单元格读法：允许首格 manual 标记后缀，用于 verify 的覆盖度清单。 */
export const TABLE_CELL_ID_RE = new RegExp(`^\\s*(?:${VERIFICATION_ID_CORE})(?:\\s*\\[manual(?:\\/[A-Za-z0-9_-]+)?\\])?\\s*$`, 'i');

/** 锚定判定：整串是否为合法测试 ID。 */
export function isTestId(candidate: string): boolean {
  return TEST_ID_ANCHORED_RE.test(candidate);
}

/** 通配/未消费尾部字符：候选含任一即整候选拒绝（前缀不采信）。 */
const TEST_ID_WILDCARD_RE = /[*?[\]]/;
/** 占位尾段黑名单（§2.30 减法拒绝②，大小写不敏感）：xx / XX / NN / TBD / TODO。 */
const TEST_ID_PLACEHOLDER_TAILS = new Set(['xx', 'nn', 'tbd', 'todo']);

/**
 * 完整接纳规则（兼容基线 + 减法拒绝，§2.30 / §2.82.1）：锚定文法之上叠加通配整候选拒绝与
 * 占位尾段黑名单。表格首列行级读法与语义变更集定义解析一律经此判定——占位 ID（含带 manual
 * 标记形态）在全部消费方统一被拒，不得只在个别检查生效（code-r1 F2）。
 * 合法非数字尾段（如 `ST-S01-EX-adopt`、`UT-S05-B01`、`UT-JSON-09`）零收窄。
 */
export function isAcceptedTestId(candidate: string): boolean {
  if (TEST_ID_WILDCARD_RE.test(candidate)) return false;
  if (!TEST_ID_ANCHORED_RE.test(candidate)) return false;
  const tail = candidate.split('-').pop() ?? '';
  return !TEST_ID_PLACEHOLDER_TAILS.has(tail.toLowerCase());
}
