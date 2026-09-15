/**
 * 测试定义表的**形态判据与枚举口径单点**（§2.84.1，fix-merge-preflight-parity-and-bare-throw）。
 *
 * 唯一语义：
 *  - 「数据行列数 == 表头列数」
 *  - 「表头单元格无重复」
 * 二者合起来正是后态 `test-change-set-ambiguous-table` 的**全部**触发形态。
 *
 * 为什么单点必须覆盖「判据 + 枚举」而不只是最后那次整数比较（delta-r1 F1）：把比较抽成共享
 * 纯函数、却让上下游各自决定「哪些表、哪些行进入比较」，等于把分裂从判据挪到集合——未进入
 * 比较的行照样在后态被拒，前移承诺落空。故本模块同时导出：
 *  - `enumerateTestDefinitionTables`：表格与数据行的**唯一**枚举实现（后态 `scanTestDefinitionCandidates`
 *    与 change-lint L4 前移检查共用，口径逐项一致）；
 *  - `findDuplicateHeaderCells` / `rowColumnsMatchHeader`：两条纯判据（无 IO、无路径语义）。
 *
 * 枚举口径（以后态既有行为为基准，不得单方收紧或放宽）：
 *  - 表格识别：未掩码的「表头行 + 分隔行」；表头列数 == 分隔列数、列数 ≥ 2、无空表头格；
 *    **不限表头措辞**（`TEST_ID_HEADER_RE` 只服务 §2.82.2 首格检查的既有适用集合，与此处无关）。
 *  - 数据行边界：自分隔行下一行起，至**空行或掩码行**为止——不以「是否含管道符」定界。
 *  - 行身份：首格剥离 manual 标记后为合法测试 ID 的行（`testDefinitionRowId`）。
 */
import { authorityScan, isTableDelimiterRow, tableRowCells, type AuthorityScan } from './markdown-scan.js';
import { isAcceptedTestId, stripFirstCellManualMarker } from './test-id.js';

/** 只移除外围空白；内部空白、转义与 inline-code 内容均属语义。 */
export function canonicalCell(cell: string): string {
  return cell.trim();
}

export interface TestDefinitionTableRow {
  /** 0 基行号（相对传入的 `lines`）。 */
  line: number;
  cells: string[];
}

export interface TestDefinitionTable {
  /** 表头行 0 基行号（相对传入的 `lines`）。 */
  headerLine: number;
  headers: string[];
  rows: TestDefinitionTableRow[];
  /** 表尾之后的第一行 0 基行号（exclusive）。 */
  endLine: number;
}

/**
 * 枚举给定行集合中的全部测试定义表。调用方可传入既有 `AuthorityScan` 复用掩码结果。
 *
 * 行为与后态 `scanTestDefinitionCandidates` 的原地遍历逐项等价（含「消费完表格数据行后
 * 从表尾继续扫描」的推进方式），是两侧共享的唯一遍历实现。
 */
export function enumerateTestDefinitionTables(lines: string[], scan?: AuthorityScan): TestDefinitionTable[] {
  const s = scan ?? authorityScan(lines);
  const tables: TestDefinitionTable[] = [];
  for (let index = 0; index + 1 < lines.length; index++) {
    if (s.masked[index] || s.masked[index + 1] || !isTableDelimiterRow(s.text[index + 1])) continue;
    const headers = tableRowCells(s.text[index]).map(canonicalCell);
    const delimiters = tableRowCells(s.text[index + 1]);
    if (headers.length < 2 || headers.length !== delimiters.length || headers.some(item => item === '')) continue;

    const rows: TestDefinitionTableRow[] = [];
    let row = index + 2;
    while (row < lines.length && !s.masked[row] && s.text[row].trim() !== '') {
      rows.push({ line: row, cells: tableRowCells(s.text[row]).map(canonicalCell) });
      row++;
    }
    tables.push({ headerLine: index, headers, rows, endLine: row });
    index = row - 1;
  }
  return tables;
}

/** 表头重复判据：返回重复出现的表头文本（去重后按首次出现序）；无重复返回空数组。 */
export function findDuplicateHeaderCells(headers: string[]): string[] {
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const header of headers) {
    if (seen.has(header)) {
      if (!dup.includes(header)) dup.push(header);
      continue;
    }
    seen.add(header);
  }
  return dup;
}

/** 行级列数判据（纯函数）：数据行单元格数须等于表头单元格数。 */
export function rowColumnsMatchHeader(headerCount: number, rowCellCount: number): boolean {
  return rowCellCount === headerCount;
}

/**
 * 行身份：首格剥离 manual 标记后为合法测试 ID 则返回该裸 ID，否则返回 null。
 * 与 §2.82.1 首格唯一语义同源（占位尾段等既有被拒形态零放宽）。
 */
export function testDefinitionRowId(cells: string[]): string | null {
  const candidate = stripFirstCellManualMarker(cells[0] ?? '');
  return isAcceptedTestId(candidate) ? candidate : null;
}
