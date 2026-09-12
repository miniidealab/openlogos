/**
 * S13 · 人工用例判据的声明位与一致性判据的输入
 * （fix-verify-manual-marker-criterion-single-source，切片 slice-01-verify-manual-criterion-and-count-inputs）
 *
 * 覆盖 UT-S13-69～75、ST-S13-20～21。
 * 测试结果由全局 OpenLogos reporter（cli/test/openlogos-reporter.ts）写入
 * logos/resources/verify/test-results.jsonl。
 *
 * 夹具一律用一次性隔离项目构造规格与账本，**不依赖本仓自身规格内容**（否则夹具随本仓规格漂移）。
 * 规格里那个「描述列含裸标记字面量」的夹具行由 MANUAL_LITERAL 拼出——**不在本文件源码里直写该字面量**，
 * 免得本文件自己再次触发同族误判（这正是被测缺陷的形态）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import {
  buildVerifyCountMismatches,
  buildCountMismatchDetails,
  isManualDeclaration,
  extractDefinedIds,
  collectVerifyData,
  type VerifyCountSummary,
} from '../src/commands/verify.js';

/** 裸标记字面量：拼接而成，避免本文件自身被同族整行判据误判。 */
const MANUAL_LITERAL = `[${'manual'}]`;
const MANUAL_PLATFORM_LITERAL = `[${'manual'}/windows]`;

/** 收敛前的旧判据（整行匹配）——用于「旧判据必红」的对照。 */
const legacyIsManual = (firstCell: string, line: string) =>
  /\[manual\]/i.test(firstCell) || /\[manual\]/i.test(line);

const summaryOf = (over: Partial<VerifyCountSummary> = {}): VerifyCountSummary => ({
  defined_count: 10,
  executed_count: 10,
  passed_count: 10,
  failed_count: 0,
  skipped_count: 0,
  uncovered_count: 0,
  coverage_pct: 100,
  pass_rate_pct: 100,
  ...over,
});

describe('S13 · manual 判据声明位与一致性判据输入', () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeTempRoot());
    scaffoldProject(root, { locale: 'zh' });
  });
  afterEach(() => cleanup());

  function writeCases(content: string) {
    mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/core-S13-test-cases.md'), content);
  }
  function writeResults(lines: string[]) {
    mkdirSync(join(root, 'logos/resources/verify'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), lines.join('\n') + '\n');
  }

  it('UT-S13-69: 首格干净、描述列含裸标记字面量的用例正常计入', () => {
    // A 行：首格为纯 ID，描述列出现裸标记字面量（「manual 标记排除」元用例的真实形态）
    const line = `| UT-S13-A01 | 排除 ${MANUAL_LITERAL} 与 ${MANUAL_PLATFORM_LITERAL} 两种标记 |`;
    writeCases(`${line}\n| UT-S13-A02 | 普通用例 |\n`);
    writeResults([
      '{"id":"UT-S13-A01","status":"pass"}',
      '{"id":"UT-S13-A02","status":"pass"}',
    ]);

    const defined = extractDefinedIds(root);
    expect(defined.ids).toContain('UT-S13-A01');
    expect(defined.manualCount).toBe(0);

    const data = collectVerifyData(root);
    expect(data.summary.executed_count).toBe(2);
    expect(data.summary.passed_count + data.summary.failed_count + data.summary.skipped_count)
      .toBe(data.summary.executed_count);
    expect(data.consistency.count_mismatches).toEqual([]);

    // 旧判据（整行匹配）喂同一行必红：该 ID 被误判为人工用例
    expect(legacyIsManual('UT-S13-A01', line)).toBe(true);
    expect(isManualDeclaration('UT-S13-A01')).toBe(false);
  });

  it('UT-S13-70: 真人工用例判定逐字不变', () => {
    for (const marker of [MANUAL_LITERAL, MANUAL_PLATFORM_LITERAL]) {
      expect(isManualDeclaration(`UT-S13-B01 ${marker}`), marker).toBe(true);
    }
    writeCases(`| UT-S13-B01 ${MANUAL_LITERAL} | 人工用例 |\n| UT-S13-B02 | 普通用例 |\n`);
    const defined = extractDefinedIds(root);
    expect(defined.ids).toEqual(['UT-S13-B02']);
    expect(defined.manualCount).toBe(1);
  });

  it('UT-S13-71: 只收不放——收敛后的人工集合是收敛前的子集', () => {
    const rows = [
      { first: 'UT-S13-C01', line: `| UT-S13-C01 | 描述含 ${MANUAL_LITERAL} 字面量 |` },
      { first: `UT-S13-C02 ${MANUAL_LITERAL}`, line: `| UT-S13-C02 ${MANUAL_LITERAL} | 真人工 |` },
      { first: 'UT-S13-C03', line: '| UT-S13-C03 | 普通 |' },
    ];
    const legacy = new Set(rows.filter(r => legacyIsManual(r.first, r.line)).map(r => r.first));
    const now = new Set(rows.filter(r => isManualDeclaration(r.first)).map(r => r.first));
    for (const id of now) expect(legacy.has(id), `收敛后 ${id} 必须在收敛前集合内`).toBe(true);
    const dropped = [...legacy].filter(id => !now.has(id));
    expect(dropped).toEqual(['UT-S13-C01']);                    // 差集只含「首格无标记」者
    for (const id of dropped) expect(isManualDeclaration(id)).toBe(false);
  });

  it('UT-S13-72: 判定单一事实源——defined/executed/passed/uncovered 共用同一判据', () => {
    writeCases(`| UT-S13-D01 | 描述含 ${MANUAL_LITERAL} |\n| UT-S13-D02 ${MANUAL_LITERAL} | 真人工 |\n| UT-S13-D03 | 普通 |\n`);
    writeResults([
      '{"id":"UT-S13-D01","status":"pass"}',
      '{"id":"UT-S13-D03","status":"pass"}',
    ]);
    const data = collectVerifyData(root);
    // 同一判据下：D01/D03 计入，D02 排除；四个计数器彼此自洽
    expect(data.summary.defined_count).toBe(2);
    expect(data.summary.manual_count).toBe(1);
    expect(data.summary.executed_count).toBe(2);
    expect(data.summary.passed_count).toBe(2);
    expect(data.summary.uncovered_count).toBe(0);
    expect(data.consistency.count_mismatches).toEqual([]);
    // 判据只有一处：对首格求值即决定归属，不存在第二套读法
    expect(isManualDeclaration('UT-S13-D01')).toBe(false);
    expect(isManualDeclaration(`UT-S13-D02 ${MANUAL_LITERAL}`)).toBe(true);
  });

  it('UT-S13-73: 一致性判据不消费舍入值——差 1 条未覆盖不得判覆盖矛盾', () => {
    const summary = summaryOf({
      defined_count: 6427, executed_count: 6426,
      passed_count: 6394, skipped_count: 32, uncovered_count: 1,
      coverage_pct: 100,               // Math.round(6426/6427*100) === 100
    });
    const mismatches = buildVerifyCountMismatches(summary, { covered_count: 6426, results_count: 6426 });
    expect(mismatches).not.toContain('coverage_full_with_uncovered');
    expect(mismatches).not.toContain('coverage_incomplete_without_uncovered');
    // 旧判据（消费 coverage_pct === 100）喂同一输入必红
    expect(summary.coverage_pct === 100 && summary.uncovered_count !== 0).toBe(true);
  });

  it('UT-S13-74: 展示精度与判定解耦', () => {
    const base = {
      defined_count: 6427, executed_count: 6426,
      passed_count: 6394, failed_count: 0, skipped_count: 32, uncovered_count: 1,
    };
    const exact = { covered_count: 6426, results_count: 6426 };
    const results = [0, 2, 4].map(digits => {
      const factor = 10 ** digits;
      const pct = Math.round((6426 / 6427) * 100 * factor) / factor;
      return buildVerifyCountMismatches({ ...base, coverage_pct: pct, pass_rate_pct: pct }, exact);
    });
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);                     // 展示精度不得影响任何判定
  });

  it('UT-S13-75: 真实矛盾仍被判出（强度不放宽）', () => {
    // ① 结果含未定义 ID
    writeCases('| UT-S13-E01 | 普通 |\n');
    writeResults(['{"id":"UT-S13-E01","status":"pass"}', '{"id":"UT-S13-GHOST","status":"pass"}']);
    const unknown = collectVerifyData(root);
    expect(unknown.consistency.reasons).toContain('unknown_test_result_id');
    // ② 结果含人工 ID
    writeCases(`| UT-S13-E01 | 普通 |\n| UT-S13-E02 ${MANUAL_LITERAL} | 真人工 |\n`);
    writeResults(['{"id":"UT-S13-E01","status":"pass"}', '{"id":"UT-S13-E02","status":"pass"}']);
    const manual = collectVerifyData(root);
    expect(manual.consistency.reasons).toContain('manual_test_result_id');
    // ③ 真实计数不等
    const broken = buildVerifyCountMismatches(summaryOf({ executed_count: 2, passed_count: 1, defined_count: 1 }));
    expect(broken).toContain('passed_failed_skipped_ne_executed');
    expect(broken).toContain('executed_exceeds_defined');
  });

  it('ST-S13-20: 端到端复现下游阻塞形态——两处收敛后不再产出 mismatches', () => {
    // 复刻现场：描述列含裸字面量的元用例 + 零 fail + 覆盖差 1 条（真实覆盖率 ≥ 99.5%）
    const rows = [`| UT-S13-F00 | 排除 ${MANUAL_LITERAL} 标记 |`];
    for (let i = 1; i <= 200; i += 1) rows.push(`| UT-S13-F${String(i).padStart(3, '0')} | 普通 |`);
    writeCases(rows.join('\n') + '\n');
    const lines = ['{"id":"UT-S13-F00","status":"pass"}'];
    for (let i = 1; i <= 199; i += 1) lines.push(`{"id":"UT-S13-F${String(i).padStart(3, '0')}","status":"pass"}`);
    writeResults(lines);                                        // 第 200 条刻意不入账

    const data = collectVerifyData(root);
    expect(data.summary.defined_count).toBe(201);
    expect(data.summary.uncovered_count).toBe(1);               // 判定强度不放宽：仍点名未覆盖
    expect(data.summary.coverage_pct).toBe(100);                // 展示仍舍入为 100%
    expect(data.summary.passed_count + data.summary.failed_count + data.summary.skipped_count)
      .toBe(data.summary.executed_count);
    expect(data.consistency.count_mismatches).not.toContain('coverage_full_with_uncovered');
    expect(data.consistency.count_mismatches).not.toContain('passed_failed_skipped_ne_executed');
    expect(data.consistency.reasons).not.toContain('result_count_mismatch');
    expect(data.uncovered_cases).toEqual(['UT-S13-F200']);
  });

  it('ST-S13-21: 矛盾诊断点名两个相互矛盾的计数器取值与来源', () => {
    const summary = summaryOf({ defined_count: 1, executed_count: 2, passed_count: 1 });
    const mismatches = buildVerifyCountMismatches(summary);
    const details = buildCountMismatchDetails(summary, mismatches);
    expect(details.length).toBe(mismatches.length);
    for (const detail of details) {
      expect(mismatches).toContain(detail.code);
      expect(detail.left).toMatch(/=\d+/);                      // 点名取值
      expect(detail.right).toMatch(/=\d+/);
      expect(detail.left).toContain('来源：');                   // 点名来源
      expect(detail.right).toContain('来源：');
      expect(detail.left).not.toBe(detail.right);               // 两个不同的计数器
    }
    const executedDetail = details.find(d => d.code === 'executed_exceeds_defined');
    expect(executedDetail?.left).toContain('executed_count=2');
    expect(executedDetail?.right).toContain('defined_count=1');
  });
});
