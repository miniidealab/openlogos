/**
 * lint-specs — 测试规格的只读结构检查（功能规格 §2.70）。
 *
 * 承接 seal preflight 被删除的那部分**结构**能力：重复 ID、表格列数、ID 格式。
 * 它曾发现同一测试 ID 被两个用例共用、导致一个验收结果被长期静默覆盖——这类污染
 * 若无人检查会无声累积，故本命令与合并事务删除同批落地，不留真空窗口。
 *
 * **不参与任何门（强制）**：`merge` / `verify` / `archive` / `change-lint` 均不因本命令结论而阻断
 * （减法方案 §10：任何审计产物都不得出现在流程分支的条件里）。它是用户主动运行的诊断工具，
 * 发现问题时非零退出并逐条列出位置，供人判断。
 *
 * ID 语法不在此重新定义——一律经 `lib/test-id.ts` 这一唯一权威判定（严禁第二份判据）。
 *
 * §2.72.2 重复标题：同一文件内两处文本完全相同的标题，会让该章节的 delta 锚永远解析为
 * ambiguous——**整节永久不可寻址**。这比重复 ID 更严重却更隐蔽，故一并检查。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isTestId, stripFirstCellManualMarker } from '../lib/test-id.js';
import { rowColumnsMatchHeader } from '../lib/test-table-shape.js';
import { parseMarkdownHeadings, type ResolvedSectionAnchor } from '../lib/markdown-section-authority.js';

export type LintSpecsCode = 'duplicate_test_id' | 'table_column_mismatch' | 'invalid_test_id' | 'duplicate_heading';

export interface LintSpecsFinding {
  code: LintSpecsCode;
  path: string;
  line: number;
  message: string;
}

export interface LintSpecsResult {
  ok: boolean;
  scanned_files: number;
  findings: LintSpecsFinding[];
}

/**
 * 把一行 Markdown 表格切成单元格。
 * 两处必须按语料真实约定处理，否则整表沦为噪声：`\|` 是转义的字面管道；反引号代码段内的
 * 管道按本语料约定不分列（`\`.yaml|.yml\`` 是一个单元格，不是两个）。
 */
function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '');
  const out: string[] = [];
  let current = '';
  let inCode = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '\\' && inner[i + 1] === '|') { current += '|'; i += 1; continue; }
    if (ch === '`') { inCode = !inCode; current += ch; continue; }
    if (ch === '|' && !inCode) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|?\s*$/.test(line.trim()) && line.includes('-');
}

/**
 * 扫描单文件的全部 Markdown 表格。
 * 表格定义：连续以 `|` 开头的行，其第二行为分隔行；表头即第一行。
 */
function lintFile(relPath: string, content: string, seenIds: Map<string, string[]>): LintSpecsFinding[] {
  const findings: LintSpecsFinding[] = [];
  const lines = content.split('\n');
  let index = 0;
  while (index < lines.length) {
    const header = lines[index];
    if (!header.trim().startsWith('|') || index + 1 >= lines.length || !isSeparatorRow(lines[index + 1])) {
      index += 1;
      continue;
    }
    const headerCells = cells(header);
    const rows: Array<{ line: number; cells: string[] }> = [];
    let row = index + 2;
    while (row < lines.length && lines[row].trim().startsWith('|')) {
      rows.push({ line: row, cells: cells(lines[row]) });
      row += 1;
    }
    // ID 表按**结构**识别而非表头措辞：语料中既有 `| ID |` 也有 `| 用例ID |`，
    // 只认字面表头会让整类表静默逃过检查（此前正是这样漏掉的）。
    const idTable = /^(?:用例\s*)?(?:ID|编号)$/i.test(headerCells[0] ?? '')
      || rows.some(r => isTestId(stripFirstCellManualMarker(r.cells[0] ?? '')));
    for (const r of rows) {
      // §2.84.1：列数判据走共享单点 `rowColumnsMatchHeader`（与 change-lint 前移检查、
      // 后态 buildTestChangeSet 同源）。**本命令的扫描集合逐字不变**——仍覆盖全部表格
      // （不收窄为 ID 表），强度仍为只读诊断、不参与任何门：收敛的是判据，不是范围。
      if (!rowColumnsMatchHeader(headerCells.length, r.cells.length)) {
        findings.push({
          code: 'table_column_mismatch', path: relPath, line: r.line + 1,
          message: `表格列数不一致：表头 ${headerCells.length} 列，本行 ${r.cells.length} 列（表头行 ${index + 1}）`,
        });
      }
      if (!idTable) continue;
      // §2.70.1（fix-table-test-id-manual-marker）：首格 = 裸 ID + 可选 manual 标记；剥离经语法
      // 权威单点后按裸 ID 判格式与判重——合法 manual 行不再误报 invalid_test_id。
      const id = stripFirstCellManualMarker(r.cells[0] ?? '');
      if (!isTestId(id)) {
        findings.push({
          code: 'invalid_test_id', path: relPath, line: r.line + 1,
          message: `ID 列首格不是合法测试 ID：'${r.cells[0] ?? ''}'`,
        });
      } else {
        seenIds.set(id, [...(seenIds.get(id) ?? []), `${relPath}:${r.line + 1}`]);
      }
    }
    index = row;
  }

  // §2.72.2：**路径锚也无法消歧**的重复标题——文本与祖先链都相同，该章节的 delta 锚永久不可寻址。
  // 仅文本相同但祖先不同（如不同父节下的「单元测试」）可用 `父级 > 子节` 路径锚定位，不是缺陷。
  const byPath = new Map<string, ResolvedSectionAnchor[]>();
  for (const heading of parseMarkdownHeadings(content)) {
    const key = heading.path.join(' > ');
    byPath.set(key, [...(byPath.get(key) ?? []), heading]);
  }
  for (const [key, group] of byPath) {
    if (group.length < 2) continue;
    findings.push({
      code: 'duplicate_heading', path: relPath, line: group[0].line + 1,
      message: `标题路径「${key}」在本文件出现 ${group.length} 次（行 ${group.map(h => h.line + 1).join('、')}）`
        + '——文本与祖先链均相同，路径锚无法消歧；该章节此前不可寻址，现可用 `<标题> [n]` 序数锚精确定位',
    });
  }
  return findings;
}

/** 纯函数入口，供测试直接断言（不触碰 process.exit / stdout）。 */
export function lintSpecsIn(root: string): LintSpecsResult {
  const dir = join(root, 'logos', 'resources', 'test');
  if (!existsSync(dir)) return { ok: true, scanned_files: 0, findings: [] };
  // §2.70.1（fix-table-test-id-manual-marker）：递归扫描（含 smoke/ 等子目录）——此前只扫顶层，
  // smoke/ 整体逃过结构检查。读法统一在先（首格容忍 manual 标记），扫 smoke 才不误报。
  const files = (readdirSync(dir, { recursive: true }) as string[])
    .map(name => String(name).split('\\').join('/'))
    .filter(name => name.endsWith('.md'))
    .sort();
  const seenIds = new Map<string, string[]>();
  const findings: LintSpecsFinding[] = [];
  for (const name of files) {
    const relPath = `logos/resources/test/${name}`;
    findings.push(...lintFile(relPath, readFileSync(join(dir, name), 'utf8'), seenIds));
  }
  // 重复 ID 跨文件成立：同一 ID 出现在两处即一处验收结果会被静默覆盖。
  for (const [id, locations] of [...seenIds.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (locations.length < 2) continue;
    const [first] = locations;
    findings.push({
      code: 'duplicate_test_id', path: first.split(':')[0], line: Number(first.split(':')[1]),
      message: `测试 ID '${id}' 在 ${locations.length} 处定义：${locations.join('、')}`,
    });
  }
  return { ok: findings.length === 0, scanned_files: files.length, findings };
}

export function lintSpecs(format: 'text' | 'json' = 'text'): void {
  const root = process.cwd();
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    console.error('Error: logos/logos.config.json not found.');
    process.exit(1);
  }
  const result = lintSpecsIn(root);
  if (format === 'json') {
    console.log(JSON.stringify({ ok: result.ok, data: result }, null, 2));
  } else {
    console.log(`\n🔍 lint-specs：扫描 ${result.scanned_files} 个测试规格文件`);
    if (result.ok) {
      console.log('  ✓ 未发现结构问题（重复 ID / 表格列数 / ID 格式 / 重复标题）');
    } else {
      console.log(`  ✗ ${result.findings.length} 项：`);
      for (const f of result.findings) {
        console.log(`  - [${f.code}] ${f.path}:${f.line}：${f.message}`);
      }
    }
    console.log('\n  ℹ️  本命令为只读诊断，不参与 merge / verify / archive / change-lint 的任何门。\n');
  }
  if (!result.ok) process.exit(1);
}
