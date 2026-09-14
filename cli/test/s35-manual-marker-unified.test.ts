/**
 * S35 — 表格首列 manual 标记统一读法与首格可提取性前移（fix-table-test-id-manual-marker）。
 * 覆盖 UT-S35-142～UT-S35-147、ST-S35-28（与 logos/resources/test/core-S35-test-cases.md 严格对齐）。
 *
 * 除 UT-S35-146 的真实语料臂（必须递归读取实际 logos/resources/test/**，含 smoke/）外，
 * 其余夹具在一次性隔离项目内构造。测试结果由全局 OpenLogos reporter 写入 test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit, withCompleteClarification,
} from './helpers.js';
import { matchTableTestIdRow, stripFirstCellManualMarker, isTestId } from '../src/lib/test-id.js';
import { scanTestDefinitions, buildTestChangeSet } from '../src/lib/test-change-set.js';
import {
  extractDefinedVerificationIds, deriveSliceVerificationState, appendSliceCheckpoint,
  computeSpecFingerprint, computeTaskFingerprint, writeTestSliceManifestAtomic,
  collectSliceManifestViolations, TEST_SLICE_MANIFEST, type TestSliceManifestV1,
} from '../src/lib/test-slice-manifest.js';
import { TEST_ID_HEADER_RE } from '../src/lib/proposal-lifecycle.js';
import { authorityScan, isTableDelimiterRow, tableRowCells } from '../src/lib/markdown-scan.js';
import { lintSpecsIn } from '../src/commands/lint-specs.js';
import { runChangeLint, findUnextractableTestTableRows } from '../src/lib/change-lint.js';
import { changeLint } from '../src/commands/change-lint.js';
import { extractDefinedIds, collectVerifyData } from '../src/commands/verify.js';
import { merge } from '../src/commands/merge.js';
import { planSlices, SlicePlanError } from '../src/commands/slice.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tempProject(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
    'project:', '  name: t', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched',
  ].join('\n'));
  return root;
}

function idTable(rows: string[], header = 'ID'): string {
  return [`| ${header} | 用例 |`, '|---|---|', ...rows.map(cell => `| ${cell} | 说明 |`), ''].join('\n');
}

/**
 * 行级枚举（UT-S35-146 断言实现）：先按结构化 ID 表（表头 ID/用例 ID/用例ID + delimiter）定位
 * **全部数据行**，再交表格首列读法判定——枚举独立于「ID 是否提取成功」，静默跳过即失败。
 */
function enumerateIdTableRows(content: string): Array<{ line: number; firstCell: string }> {
  const lines = content.split(/\r?\n/);
  const scan = authorityScan(lines);
  const rows: Array<{ line: number; firstCell: string }> = [];
  // 表格块 = 连续含 `|` 的未掩码行（对齐 extractStructuredTestIds 的合法表格外形口径，
  // 含无首尾管道形态——以「行首是否为管道」定行会复制生产侧曾有的漏检条件，code-r1 F1）。
  let i = 0;
  while (i < lines.length) {
    if (scan.masked[i] || !scan.text[i].includes('|')) { i++; continue; }
    let j = i;
    while (j < lines.length && !scan.masked[j] && scan.text[j].includes('|')) j++;
    const block = scan.text.slice(i, j);
    if (block.length >= 3 && isTableDelimiterRow(block[1])) {
      const headers = tableRowCells(block[0]).map(cell => cell.trim());
      const delimiters = tableRowCells(block[1]);
      if (headers.length > 0 && headers.length === delimiters.length && TEST_ID_HEADER_RE.test(headers[0] ?? '')) {
        for (let k = 2; k < block.length; k++) {
          rows.push({ line: i + k + 1, firstCell: (tableRowCells(block[k])[0] ?? '').trim() });
        }
      }
    }
    i = j;
  }
  return rows;
}

function walkMd(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkMd(path, out);
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
}

describe('S35 表格首列 manual 标记统一读法', () => {
  it('UT-S35-142: 表格首列提取容忍并剥离 manual 标记，各消费方分别断言合法输出', () => {
    // ① 读法本体：正例三形态提取出裸 ID；manual 在场性如实上报（大小写不敏感）。
    expect(matchTableTestIdRow('| SMOKE-core-14 [manual] | 人工 |')).toEqual({ id: 'SMOKE-core-14', manual: true });
    expect(matchTableTestIdRow('| UT-S13-70 [manual/windows] | 平台 |')).toEqual({ id: 'UT-S13-70', manual: true });
    expect(matchTableTestIdRow('| UT-S13-70 [MANUAL/Windows] | 大小写 |')).toEqual({ id: 'UT-S13-70', manual: true });
    expect(matchTableTestIdRow('| UT-S09-02 | 裸 ID |')).toEqual({ id: 'UT-S09-02', manual: false });
    // 反例照常不提取——既有被拒形态零放宽。
    expect(matchTableTestIdRow('| 待补 ID | 散文首格 |')).toBeNull();
    expect(matchTableTestIdRow('| [manual] | 只有标记 |')).toBeNull();
    expect(matchTableTestIdRow('| UT-S09-02 [manual] 尾巴 | 标记后有余文 |')).toBeNull();
    // 占位尾段（完整接纳规则黑名单）：裸形态与带标记形态在行级读法统一被拒（code-r1 F2）——
    // 不得只在 change-lint 前移检查生效。
    expect(matchTableTestIdRow('| UT-S99-xx | 裸占位 |')).toBeNull();
    expect(matchTableTestIdRow('| UT-S99-xx [manual] | 带标记占位 |')).toBeNull();
    expect(matchTableTestIdRow('| ST-S99-TBD [manual/windows] | 带平台标记占位 |')).toBeNull();
    // 兼容对照（零收窄）：合法非数字尾段照常接纳，带标记亦然。
    expect(matchTableTestIdRow('| ST-S01-EX-adopt | 兼容 |')).toEqual({ id: 'ST-S01-EX-adopt', manual: false });
    expect(matchTableTestIdRow('| UT-S05-B01 [manual] | 兼容 |')).toEqual({ id: 'UT-S05-B01', manual: true });
    expect(matchTableTestIdRow('| UT-JSON-09 | 兼容 |')).toEqual({ id: 'UT-JSON-09', manual: false });
    // 剥离读法单点：非「主体 + 标记」形态原样返回。
    expect(stripFirstCellManualMarker('SMOKE-core-14 [manual]')).toBe('SMOKE-core-14');
    expect(stripFirstCellManualMarker('UT-S13-70 [manual/windows]')).toBe('UT-S13-70');
    expect(stripFirstCellManualMarker('待补 ID')).toBe('待补 ID');

    // ② 语义变更集定义解析入口（§2.37.3）：manual 行以裸 ID 为身份；标记留在 cell_semantics
    //    （定义语义）——标记增减构成修改而非删除+新增（身份不变）。
    const before = Buffer.from(idTable(['SMOKE-core-14', 'UT-S99-01']));
    const after = Buffer.from(idTable(['SMOKE-core-14 [manual]', 'UT-S99-01']));
    const defsAfter = scanTestDefinitions('logos/resources/test/core-S99-test-cases.md', after);
    expect([...defsAfter.keys()].sort()).toEqual(['SMOKE-core-14', 'UT-S99-01']);
    expect(defsAfter.get('SMOKE-core-14')!.cell_semantics[0]).toContain('[manual]');
    const defsBefore = scanTestDefinitions('logos/resources/test/core-S99-test-cases.md', before);
    expect(JSON.stringify(defsBefore.get('SMOKE-core-14')))
      .not.toBe(JSON.stringify(defsAfter.get('SMOKE-core-14')));
    // 占位 ID（裸 / 带标记 / 带平台标记）在变更集定义解析同被拒绝——与行级读法同一结论；
    // 合法非数字尾段兼容形态照常识别（零收窄）。
    const placeholderDefs = scanTestDefinitions('logos/resources/test/core-S99-test-cases.md',
      Buffer.from(idTable(['UT-S99-xx', 'UT-S99-xx [manual]', 'ST-S99-TBD [manual/windows]', 'ST-S01-EX-adopt', 'UT-JSON-09'])));
    expect([...placeholderDefs.keys()].sort()).toEqual(['ST-S01-EX-adopt', 'UT-JSON-09']);

    // ③ spec_target 定义校验：含 manual 首格的规格被接纳为已定义（bare ID 归属可落盘）。
    const root = tempProject();
    const specRel = 'logos/resources/test/core-S99-test-cases.md';
    writeFileSync(join(root, specRel), idTable(['SMOKE-core-14 [manual]', 'UT-S99-01']));
    const manifestRaw = {
      schema: 'openlogos/test-slice-manifest@1', change: 'feat', module: 'core',
      task_fingerprint: `sha256:${'0'.repeat(64)}`, spec_fingerprint: `sha256:${'0'.repeat(64)}`,
      generated_at: '2026-09-14T00:00:00.000Z',
      slices: [{
        slice_id: 'slice-01-a', task_text: '切片1（覆盖 SMOKE-core-14、UT-S99-01）',
        owned_test_ids: ['SMOKE-core-14', 'UT-S99-01'], runner_selectors: ['SMOKE-core-14', 'UT-S99-01'],
        spec_targets: [specRel],
      }],
    };
    const tasksContent = '# 任务\n\n## [code] 代码实现\n- [ ] 切片1（覆盖 SMOKE-core-14、UT-S99-01）\n';
    const { violations } = collectSliceManifestViolations({
      root, manifestRaw, tasksContent, expected: { change: 'feat', module: 'core' }, changedTestIds: null,
    });
    expect(violations.filter(v => String(v.message).includes('SMOKE-core-14'))).toEqual([]);

    // ④ 验证定义集合：统一提取之上仍按既有资格规则筛选——manual UT/ST 与 SMOKE 不进入。
    //    （不要求各消费方输出同一集合。）
    writeFileSync(join(root, specRel),
      idTable(['UT-S99-01', 'UT-S99-02 [manual]', 'ST-S99-01 [manual/windows]', 'SMOKE-core-14 [manual]', 'UT-S99-xx', 'ST-S99-TBD [manual/windows]']));
    expect(extractDefinedVerificationIds(root)).toEqual(['UT-S99-01']);
  });

  it('UT-S35-143: lint-specs 对合法 manual 行不误报，剥离后按裸 ID 判重', () => {
    const root = tempProject();
    writeFileSync(join(root, 'logos/resources/test/core-S98-test-cases.md'),
      idTable(['SMOKE-core-14 [manual]', 'UT-S98-01 [manual/windows]', 'UT-S98-02']));
    const clean = lintSpecsIn(root);
    expect(clean.findings.filter(f => f.code === 'invalid_test_id')).toEqual([]);
    // 同裸 ID 以裸/带标记两形态出现 → 剥离后仍判重复（剥离不吞掉重复检查）。
    writeFileSync(join(root, 'logos/resources/test/core-S98-test-cases.md'),
      idTable(['UT-S98-01', 'UT-S98-01 [manual]']));
    const dup = lintSpecsIn(root);
    expect(dup.findings.some(f => f.code === 'duplicate_test_id' && f.message.includes('UT-S98-01'))).toBe(true);
    expect(dup.findings.filter(f => f.code === 'invalid_test_id')).toEqual([]);
  });

  it('UT-S35-144: lint-specs 递归扫描 smoke/ 子目录，顶层不丢', () => {
    const root = tempProject();
    // smoke/ 内：重复 ID + 列数不一致；顶层：一处对照错误（非法 ID）。
    mkdirSync(join(root, 'logos/resources/test/smoke'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/smoke/core-smoke-test-cases.md'), [
      '| 用例 ID | 说明 |', '|---|---|',
      '| SMOKE-core-01 | a |', '| SMOKE-core-01 | 重复 |', '| SMOKE-core-02 | b | 多一列 |', '',
    ].join('\n'));
    writeFileSync(join(root, 'logos/resources/test/core-S98-test-cases.md'), idTable(['不是ID']));
    const result = lintSpecsIn(root);
    const smokeFindings = result.findings.filter(f => f.path.includes('smoke/'));
    expect(smokeFindings.some(f => f.code === 'duplicate_test_id' && f.message.includes('SMOKE-core-01'))).toBe(true);
    expect(smokeFindings.some(f => f.code === 'table_column_mismatch')).toBe(true);
    // 递归不丢顶层。
    expect(result.findings.some(f => f.code === 'invalid_test_id' && f.path.endsWith('core-S98-test-cases.md'))).toBe(true);
    expect(result.scanned_files).toBe(2);
  });

  it('UT-S35-145: change-lint 首格可提取性前移（L4 族），表头与表格外形口径均不缩小，文本/JSON 双出口可定位', () => {
    // 无首尾管道的合法表格外形（既有结构化提取兼容形态，code-r1 F1）。
    const bareTable = (rows: string[], header = 'ID') =>
      [`${header} | 用例`, '---|---', ...rows.map(cell => `${cell} | 说明`), ''].join('\n');
    // 纯 evaluator 判据：表头三形态 × 首格形态 × 表格外形（有/无首尾管道等价）。
    for (const header of ['ID', '用例 ID', '用例ID']) {
      for (const [label, table] of [['piped', idTable], ['bare', bareTable]] as const) {
        const good = `## MODIFIED — 某章节\n\n${table(['SMOKE-core-77 [manual]', 'UT-S99-01'], header)}`;
        expect(findUnextractableTestTableRows(good), `表头 ${header}/${label} 合法行误报`).toEqual([]);
        const bad = `## MODIFIED — 某章节\n\n${table(['待补 ID', 'UT-S99-xx'], header)}`;
        expect(findUnextractableTestTableRows(bad).map(h => h.firstCell), `表头 ${header}/${label} 漏检`)
          .toEqual(['待补 ID', 'UT-S99-xx']);
        // 非法行之后仍有合法行：违规集合不因表格外形或行序改变，扫描不提前终止。
        const mixed = `## ADDED — 某章节\n\n${table(['待补 ID', 'UT-S99-01'], header)}`;
        expect(findUnextractableTestTableRows(mixed).map(h => h.firstCell), `表头 ${header}/${label} 混排`)
          .toEqual(['待补 ID']);
      }
    }
    // 非 ID 表 / 围栏内引用不参与（零误报不得靠缩小扫描集合实现——上面矩阵已锚定不缩小）。
    expect(findUnextractableTestTableRows('## ADDED — 说明\n\n| 检查项 | 判据 |\n|---|---|\n| 重复 ID | x |\n')).toEqual([]);
    expect(findUnextractableTestTableRows('## ADDED — 说明\n\n```\n| ID | 用例 |\n|---|---|\n| 待补 ID | 围栏内 |\n```\n')).toEqual([]);

    // 真实提案维度：runChangeLint 报 delta_test_table_id_unextractable（进 violations），点名定位。
    const root = tempProject();
    const slug = 'feat';
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
    const dir = join(root, 'logos', 'changes', slug);
    mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
      '# 变更提案：feat', '', '## 变更原因', '前移检查夹具。', '', '## 变更类型', '代码级', '',
      '## 变更范围', '- CLI', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：夹具', '- 影响环境：无',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '夹具。',
    ].join('\n')));
    writeFileSync(join(dir, 'tasks.md'),
      '# 任务\n\n## [delta] 规格变更\n- [ ] 产出 delta 到 `deltas/test/` — 覆盖 UT-S99-01\n\n## [code] 代码实现\n（占位）\n');
    const deltaPath = join(dir, 'deltas', 'test', 'core-S99-test-cases.md');
    // 无首尾管道外形 + 非法首格：evaluator 与两种命令出口都必须报出（曾以此外形整表漏检）。
    writeFileSync(deltaPath, `## ADDED — 二、新增用例\n\n${bareTable(['SMOKE-core-77 [manual]', '待补 ID', 'UT-S99-xx'], '用例 ID')}`);
    const result = runChangeLint(root, dir, slug);
    if (!result.ok) throw new Error(result.message);
    const hits = result.violations.filter(v => v.code === 'delta_test_table_id_unextractable');
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(hit.path).toBe(`logos/changes/${slug}/deltas/test/core-S99-test-cases.md`);
      expect(hit.message).toMatch(/第 \d+ 行/);
    }
    expect(hits.map(h => /'(.+)'/.exec(h.message)?.[1])).toEqual(['待补 ID', 'UT-S99-xx']);
    // 合法 manual 行放行：不出现在违规里。
    expect(hits.some(h => h.message.includes('SMOKE-core-77'))).toBe(false);

    // 默认文本出口（code-r1 F3）：新码必须归入 L4 详情渲染——exit 2 且输出含检查项、码、
    // 文件、行号与修法；JSON 出口同结论。修复首格后两种出口均转绿。
    const runCmd = (format: 'text' | 'json') => {
      const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
      let code = -1;
      try { changeLint(undefined, format); } catch (e) {
        code = Number(/process\.exit\((\d+)\)/.exec(String(e))?.[1] ?? -1);
      } finally { cap.restore(); ex.mockRestore(); restore(); }
      return { code, out: cap.logs.join('\n') };
    };
    const text = runCmd('text');
    expect(text.code).toBe(2);
    expect(text.out).toContain('✗ L4 [delta_test_table_id_unextractable]');
    expect(text.out).toContain(`logos/changes/${slug}/deltas/test/core-S99-test-cases.md`);
    expect(text.out).toMatch(/第 \d+ 行首格不可提取/);
    expect(text.out).toContain('补成什么样');
    const json = runCmd('json');
    expect(json.code).toBe(2);
    expect(JSON.parse(json.out.split('\n').pop()!).data.violations
      .some((v: any) => v.code === 'delta_test_table_id_unextractable')).toBe(true);
    // 修正首格 → 文本与 JSON 双出口均 exit 0。
    writeFileSync(deltaPath, `## ADDED — 二、新增用例\n\n${bareTable(['SMOKE-core-77 [manual]', 'UT-S99-01'], '用例 ID')}`);
    expect(runCmd('text').code).toBe(0);
    expect(runCmd('json').code).toBe(0);
  });

  it('UT-S35-146: 一致性锁行级扩展——真实语料逐行 + 静默跳过即失败', () => {
    // 真实语料臂：递归读取实际 logos/resources/test/**（含 smoke/）。枚举独立于提取结果，
    // 每一个 ID 表数据行都必须能被表格首列读法提取出被权威语法接纳的裸 ID。
    const failures: string[] = [];
    let total = 0;
    for (const path of walkMd(join(REPO_ROOT, 'logos', 'resources', 'test'))) {
      for (const row of enumerateIdTableRows(readFileSync(path, 'utf8'))) {
        total++;
        const parsed = matchTableTestIdRow(`| ${row.firstCell} |`);
        if (!parsed || !isTestId(parsed.id)) {
          failures.push(`${path.slice(REPO_ROOT.length + 1)}:${row.line} 首格不可提取：'${row.firstCell}'`);
        }
      }
    }
    expect(total).toBeGreaterThan(1500); // 确认扫到了整个语料而非空集
    expect(failures).toEqual([]);

    // 隔离正反例臂：带标记行被提取（不再静默跳过）；不可提取行被点名而非跳过。
    const fixture = idTable(['UT-S77-01 [manual]', 'UT-S77-02', '待补 ID']);
    const rows = enumerateIdTableRows(fixture);
    expect(rows).toHaveLength(3); // 枚举不依赖提取成功——不可提取行也在枚举集合内
    expect(matchTableTestIdRow(`| ${rows[0].firstCell} |`)).toEqual({ id: 'UT-S77-01', manual: true });
    const bad = rows.filter(row => matchTableTestIdRow(`| ${row.firstCell} |`) === null);
    expect(bad.map(row => row.firstCell)).toEqual(['待补 ID']);
    // 无首尾管道外形同样进入枚举集合（枚举口径 = 既有结构化表格规则，不以行首管道定行）。
    const bareFixture = ['ID | 用例', '---|---', 'UT-S77-01 [manual] | a', '待补 ID | b', ''].join('\n');
    const bareRows = enumerateIdTableRows(bareFixture);
    expect(bareRows.map(row => row.firstCell)).toEqual(['UT-S77-01 [manual]', '待补 ID']);
  });

  it('UT-S35-147: verify manual 排除语义不变式（无切片 / slice-checkpoint / final 三臂）', () => {
    // ── 无切片臂：manual 行（两种标记形态）排除出 defined；SMOKE 不进可选集 ──
    const root = tempProject();
    const specRel = 'logos/resources/test/core-S77-test-cases.md';
    writeFileSync(join(root, specRel),
      idTable(['UT-S77-01', 'UT-S77-02 [manual]', 'ST-S77-01 [manual/windows]', 'SMOKE-core-14', 'ST-S77-02']));
    const defined = extractDefinedIds(root);
    expect(defined.ids).toEqual(['ST-S77-02', 'UT-S77-01']);
    expect(defined.manualCount).toBe(2);
    expect(extractDefinedVerificationIds(root)).toEqual(['ST-S77-02', 'UT-S77-01']);

    // ── 切片两臂共用夹具：2 切片、变更集不含 manual 行；manual UT 行只存在于已合并规格 ──
    const slug = 'manual-inv';
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
    const dir = join(root, 'logos', 'changes', slug);
    mkdirSync(dir, { recursive: true });
    const owned = [['UT-S77-01'], ['ST-S77-02']];
    const taskLine = (i: number, checked: boolean) => `- [${checked ? 'x' : ' '}] 切片${i + 1}（覆盖 ${owned[i].join('、')}）`;
    const tasksAt = (checked: boolean[]) => [
      '# 实现任务', '', '## [delta] 规格变更', '- [x] 已合并', '',
      '## [code] 代码实现', taskLine(0, checked[0]), taskLine(1, checked[1]), '',
    ].join('\n');
    writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
      '# 变更提案：manual-inv', '', '## 变更原因', '不变式夹具。', '', '## 变更类型', '代码级', '',
      '## 变更范围', '- CLI', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：夹具', '- 影响环境：无',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '夹具。',
    ].join('\n')));
    writeFileSync(join(dir, 'tasks.md'), tasksAt([false, false]));
    // 变更集经真实构造器生成：before 已含 manual/SMOKE 行（基线不变），after 新增两个自动化 ID → C 恰为两者。
    const beforeSpec = idTable(['UT-S77-02 [manual]', 'ST-S77-01 [manual/windows]', 'SMOKE-core-14']);
    writeFileSync(join(dir, 'SPEC_MERGED'), JSON.stringify({
      type: 'merge_complete',
      test_change_set: buildTestChangeSet({
        change: slug, module: 'core',
        targets: [{
          targetPath: specRel,
          beforeBytes: Buffer.from(beforeSpec),
          afterBytes: readFileSync(join(root, specRel)),
        }],
      }),
    }, null, 2));
    writeFileSync(join(dir, 'SLICES_APPROVED'), '');
    const manifest: TestSliceManifestV1 = {
      schema: 'openlogos/test-slice-manifest@1', change: slug, module: 'core',
      task_fingerprint: computeTaskFingerprint(tasksAt([false, false])),
      spec_fingerprint: computeSpecFingerprint(root, [specRel]),
      generated_at: '2026-09-14T00:00:00.000Z',
      slices: owned.map((ids, i) => ({
        slice_id: `slice-0${i + 1}`, task_text: `切片${i + 1}（覆盖 ${ids.join('、')}）`,
        owned_test_ids: ids, runner_selectors: ids, spec_targets: [specRel],
      })),
    };
    writeTestSliceManifestAtomic(join(dir, TEST_SLICE_MANIFEST), manifest);

    // slice-checkpoint 臂：eligible = B ∪ owned(A)，manual UT/ST 不得经 D 泄入。
    const checkpoint = deriveSliceVerificationState(root, dir)!;
    expect(checkpoint.verify_mode).toBe('slice-checkpoint');
    expect(checkpoint.eligible_test_ids).not.toContain('UT-S77-02');
    expect(checkpoint.eligible_test_ids).not.toContain('ST-S77-01');
    expect(checkpoint.eligible_test_ids).not.toContain('SMOKE-core-14');
    expect(checkpoint.eligible_test_ids).toContain('UT-S77-01');

    // final 臂：两片 checkpoint 全过 + 任务全勾 → final；manual 仍不进 eligible；
    // manual 结果入账仍被拒绝（manual_test_result_id），不得先被 defined 接纳。
    expect(appendSliceCheckpoint(dir, checkpoint, 'PASS')).toBe(true);
    const second = deriveSliceVerificationState(root, dir)!;
    expect(appendSliceCheckpoint(dir, second, 'PASS')).toBe(true);
    writeFileSync(join(dir, 'tasks.md'), tasksAt([true, true]));
    const manifestFinal = { ...manifest, task_fingerprint: computeTaskFingerprint(tasksAt([true, true])) };
    writeTestSliceManifestAtomic(join(dir, TEST_SLICE_MANIFEST), manifestFinal);
    const finalState = deriveSliceVerificationState(root, dir)!;
    expect(finalState.verify_mode).toBe('final');
    expect(finalState.eligible_test_ids).not.toContain('UT-S77-02');
    expect(finalState.eligible_test_ids).not.toContain('ST-S77-01');
    writeFileSync(join(root, 'logos', 'resources', 'verify', 'test-results.jsonl'),
      `${['UT-S77-01', 'ST-S77-02', 'UT-S77-02'].map(id => JSON.stringify({ id, status: 'pass' })).join('\n')}\n`);
    const data = collectVerifyData(root, undefined, finalState);
    expect(data.consistency.reasons).toContain('manual_test_result_id');
    expect(data.consistency.manual_result_ids).toEqual(['UT-S77-02']);
    expect(data.summary.defined_count).toBe(finalState.eligible_test_ids.length);
  });

  it('ST-S35-28: manual 首格规格下 slice plan 端到端转绿（真实 merge 变更集 + 多切片归属对账）', () => {
    const root = tempProject();
    const slug = 'manual-e2e';
    const specRel = 'logos/resources/test/core-S99-test-cases.md';
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
    const dir = join(root, 'logos', 'changes', slug);
    mkdirSync(join(dir, 'deltas', 'test'), { recursive: true });
    // 已合并基线：不含本次新增行。
    writeFileSync(join(root, specRel), `# core-S99 测试用例\n\n## 一、既有用例\n\n${idTable(['UT-S99-01', 'UT-S99-02'])}`);
    writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
      '# 变更提案：manual-e2e', '', '## 变更原因', '复刻下游 SLICE_PLAN_UNKNOWN_TEST_ID 缺陷现场。', '',
      '## 变更类型', '代码级', '', '## 变更范围', '- CLI', '',
      '## 部署影响', '- 是否需要部署：否', '- 部署原因：夹具', '- 影响环境：无',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '端到端转绿。',
    ].join('\n')));
    writeFileSync(join(dir, 'tasks.md'), [
      '# 实现任务', '', '## [delta] 规格变更', '- [x] 产出 delta 到 `deltas/test/` — 新增 manual 组用例', '',
      '## [code] 代码实现', '（本段在 plan 段留空。）', '',
    ].join('\n'));
    // 测试 delta：S13 认可的首格形态 `SMOKE-core-14 [manual]`，规格无需任何改写。
    writeFileSync(join(dir, 'deltas', 'test', 'core-S99-test-cases.md'), [
      '## ADDED — 二、manual 组新增用例', '',
      idTable(['SMOKE-core-14 [manual]', 'UT-S99-10', 'UT-S99-11', 'ST-S99-10']),
    ].join('\n'));

    // ① 真实 merge：生成 SPEC_MERGED.test_change_set——manual ID 以裸 ID 进入真实 changed_test_ids。
    // vitest 全局开启 legacy merge 兼容模式（OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY=1，仅供 0.13.x
    // 回归）；本 ST 要的是安装态真实路径（mergeDirect 一次调用直接落盘），故在用例内关闭。
    const legacyEnv = process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY;
    process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY = '0';
    const restore = mockCwd(root); const cap = captureConsole(); const ex = mockProcessExit();
    try { merge(slug); } finally {
      cap.restore(); ex.mockRestore(); restore();
      process.env.OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY = legacyEnv;
    }
    if (!existsSync(join(dir, 'SPEC_MERGED'))) {
      throw new Error(`merge 未写 SPEC_MERGED：\n${[...cap.logs, ...cap.errors].join('\n')}`);
    }
    const marker = JSON.parse(readFileSync(join(dir, 'SPEC_MERGED'), 'utf8'));
    expect(marker.test_change_set.changed_test_ids).toEqual(['SMOKE-core-14', 'ST-S99-10', 'UT-S99-10', 'UT-S99-11']);
    expect(readFileSync(join(root, specRel), 'utf8')).toContain('SMOKE-core-14 [manual]');

    // ② 启用切片验证的多切片（≥2）：归属对账 O = C 生效，含 manual ID 的 owned 落盘成功。
    const slices = [
      {
        slice_id: 'slice-01-manual-smoke', task_text: '切片1：manual 冒烟组（覆盖 SMOKE-core-14、UT-S99-10）',
        owned_test_ids: ['SMOKE-core-14', 'UT-S99-10'], runner_selectors: ['SMOKE-core-14', 'UT-S99-10'],
        spec_targets: [specRel],
      },
      {
        slice_id: 'slice-02-rest', task_text: '切片2：其余用例（覆盖 UT-S99-11、ST-S99-10）',
        owned_test_ids: ['ST-S99-10', 'UT-S99-11'], runner_selectors: ['ST-S99-10', 'UT-S99-11'],
        spec_targets: [specRel],
      },
    ];
    const input = join(root, 'slices.json');
    writeFileSync(input, JSON.stringify({ slices }, null, 2));
    const result = planSlices(root, input);
    expect(result.slice_count).toBe(2);
    const manifest = JSON.parse(readFileSync(join(dir, TEST_SLICE_MANIFEST), 'utf8'));
    // owned_test_ids 记录裸 ID（无标记）。
    expect(manifest.slices[0].owned_test_ids).toEqual(['SMOKE-core-14', 'UT-S99-10']);
    expect(readFileSync(join(dir, 'tasks.md'), 'utf8')).toContain('切片1：manual 冒烟组');

    // ③ 对照：owned 引用规格中不存在的 ID 仍被构造性拒绝——收紧回归零放宽。
    const badSlices = JSON.parse(JSON.stringify(slices));
    badSlices[1].owned_test_ids = ['ST-S99-10', 'UT-S99-11', 'UT-S99-99'];
    badSlices[1].runner_selectors = badSlices[1].owned_test_ids;
    writeFileSync(input, JSON.stringify({ slices: badSlices }, null, 2));
    let thrown: unknown = null;
    try { planSlices(root, input); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(SlicePlanError);
    expect((thrown as SlicePlanError).code).toBe('SLICE_PLAN_UNKNOWN_TEST_ID');
    // 拒绝零副作用：上一份合法 manifest 未被改写。
    expect(JSON.parse(readFileSync(join(dir, TEST_SLICE_MANIFEST), 'utf8')).slices).toHaveLength(2);
  });
});
