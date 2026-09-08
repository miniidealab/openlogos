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
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isTestId } from '../lib/test-id.js';

export type LintSpecsCode = 'duplicate_test_id' | 'table_column_mismatch' | 'invalid_test_id';

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
      || rows.some(r => isTestId(r.cells[0] ?? ''));
    for (const r of rows) {
      if (r.cells.length !== headerCells.length) {
        findings.push({
          code: 'table_column_mismatch', path: relPath, line: r.line + 1,
          message: `表格列数不一致：表头 ${headerCells.length} 列，本行 ${r.cells.length} 列（表头行 ${index + 1}）`,
        });
      }
      if (!idTable) continue;
      const id = r.cells[0] ?? '';
      if (!isTestId(id)) {
        findings.push({
          code: 'invalid_test_id', path: relPath, line: r.line + 1,
          message: `ID 列首格不是合法测试 ID：'${id}'`,
        });
      } else {
        seenIds.set(id, [...(seenIds.get(id) ?? []), `${relPath}:${r.line + 1}`]);
      }
    }
    index = row;
  }
  return findings;
}

/** 纯函数入口，供测试直接断言（不触碰 process.exit / stdout）。 */
export function lintSpecsIn(root: string): LintSpecsResult {
  const dir = join(root, 'logos', 'resources', 'test');
  if (!existsSync(dir)) return { ok: true, scanned_files: 0, findings: [] };
  const files = readdirSync(dir).filter(name => name.endsWith('.md')).sort();
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
      console.log('  ✓ 未发现结构问题（重复 ID / 表格列数 / ID 格式）');
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
