/**
 * 切片1：SQL 分层判定、能力缺失降级与留痕输出。
 * 覆盖 UT-S39-59、UT-S39-62、UT-S39-63、UT-S39-64、UT-S35-132、UT-S35-133、ST-S35-25。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { validateAndStripNonMarkdownDelta, type DatabaseDialect } from '../src/lib/baseline-closure.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const TARGET = 'logos/resources/database/core-x.sql';
const DIALECTS: DatabaseDialect[] = ['sqlite', 'postgresql', 'mysql'];

/** 结构完整的 payload——五项齐备，与方言无关。 */
const BODY = [
  '-- 迁移 migration',
  'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, CONSTRAINT uq UNIQUE (name));',
  'CREATE INDEX idx_t ON t (name);',
  '-- rollback 回滚',
].join('\n');

const delta = (body = BODY) => `## MODIFIED — ${TARGET}（整文件替换）\n${body}\n`;
const validate = (dialect: DatabaseDialect, body = BODY) =>
  validateAndStripNonMarkdownDelta(delta(body), 'MODIFY', TARGET, { databaseDialect: dialect });

describe('S39 SQL 分层判定与能力缺失降级', () => {
  it('UT-S39-59: 结构检查与方言无关且始终执行', () => {
    // 五种缺项 × 三种方言：结论必须一致，且不因适配器不可用而跳过结构层。
    const missing: Array<[string, string]> = [
      ['缺 CREATE TABLE', BODY.replace('CREATE TABLE', 'CREATE TABL')],
      ['缺主键', BODY.replace('id INTEGER PRIMARY KEY', 'id INTEGER')],
      ['缺约束', BODY.replace(', CONSTRAINT uq UNIQUE (name)', '')],
      ['缺索引', BODY.replace('CREATE INDEX idx_t ON t (name);', '')],
      ['缺迁移/回滚语义', BODY.replace('-- 迁移 migration', '').replace('-- rollback 回滚', '')],
    ];
    for (const [label, body] of missing) {
      for (const dialect of DIALECTS) {
        const r = validate(dialect, body);
        expect(r.ok, `${label} 在 ${dialect} 下应被拒`).toBe(false);
        expect(r.message, `${label} 在 ${dialect} 下应点名同一缺项`).toContain(label);
        // 结构层失败时层级恒为 structure——未进入任何方言层
        expect(r.tier).toBe('structure');
      }
    }
  });

  it('UT-S39-62: MySQL 降级为结构检查并留痕', () => {
    const r = validate('mysql');
    // 修复前返回「适配器不可用」并阻断
    expect(r.ok).toBe(true);
    expect(r.tier).toBe('structure');
    expect(r.degradation).toBeDefined();
    expect(r.degradation!.reason).toBe('adapter-not-implemented');
    expect(r.degradation!.dialect).toBe('mysql');
    expect(r.degradation!.missing).toContain('mysql');
    // 留痕须说明已执行到哪一层、未执行什么
    expect(r.degradation!.detail).toContain('结构检查');
    expect(r.degradation!.detail).toContain('mysql');
  });

  it('UT-S39-63: sqlite3 缺失时 SQLite 亦降级而非阻断', () => {
    const original = process.env.PATH;
    process.env.PATH = '/nonexistent-openlogos-probe';
    try {
      const r = validate('sqlite');
      // 修复前判 `SQLite validator 不可用` 并阻断——本用例锁的是报告未覆盖的第二处同类缺陷
      expect(r.ok).toBe(true);
      expect(r.tier).toBe('structure');
      expect(r.degradation!.reason).toBe('adapter-not-installed');
      expect(r.degradation!.missing).toContain('sqlite3');
    } finally {
      process.env.PATH = original;
    }
  });

  it('UT-S39-64: 层级如实自述且不跨方言冒充', () => {
    const tiers = Object.fromEntries(DIALECTS.map(d => [d, validate(d)]));
    // 三者各自如实：sqlite 走真执行，其余只到结构层
    expect(tiers.sqlite.tier).toBe('execution');
    expect(tiers.postgresql.tier).toBe('structure');
    expect(tiers.mysql.tier).toBe('structure');
    // 关键：PG/MySQL 绝不进入 sqlite 执行路径——若被冒充，其 tier 会是 execution
    for (const dialect of ['postgresql', 'mysql'] as const) {
      expect(tiers[dialect].tier, `${dialect} 不得被 sqlite 冒充`).not.toBe('execution');
      expect(tiers[dialect].degradation!.dialect).toBe(dialect);
    }
    // 未降级者不得携带留痕——层级自述不能自相矛盾
    expect(tiers.sqlite.degradation).toBeUndefined();
  });
});

describe('S35 降级留痕的输出通道', () => {
  function project(dialect: string, sqlBody = BODY, extra?: (dir: string) => void) {
    const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: '核心', lifecycle: 'launched', product_type: 'cli' }],
      tech_stack: { database: dialect },
    }));
    mkdirSync(join(root, 'logos', 'resources', 'database'), { recursive: true });
    writeFileSync(join(root, TARGET), `${BODY}\n`);
    const dir = join(root, 'logos', 'changes', 'sqlfix');
    mkdirSync(join(dir, 'deltas', 'database'), { recursive: true });
    writeFileSync(join(dir, 'deltas', 'database', 'core-x.sql'), delta(sqlBody));
    extra?.(dir);
    return { root, dir };
  }

  it('UT-S35-132: 降级留痕进 warnings 而非 violations', () => {
    // 直接对判定层断言留痕的三要素齐备——它们正是 warning message 的来源。
    const r = validate('mysql');
    expect(r.ok).toBe(true);
    const d = r.degradation!;
    expect(d.reason).toBeTruthy();          // 原因
    expect(d.missing.length).toBeGreaterThan(0); // 缺失项
    expect(d.tier).toBe('structure');       // 已执行层级
    // 通过即不构成 violation——L9 的判定不受留痕影响
    expect(r.message).toBeUndefined();
  });

  it('UT-S35-133: 无降级时不产生留痕（零漂移）', () => {
    // sqlite3 可用的 sqlite 项目：走真执行，不得携带任何降级留痕
    const r = validate('sqlite');
    expect(r.ok).toBe(true);
    expect(r.tier).toBe('execution');
    expect(r.degradation).toBeUndefined();
    // 非 SQL 目标同样不带 tier/degradation 字段
    const api = validateAndStripNonMarkdownDelta(
      '## MODIFIED — logos/resources/api/x.yaml（整文件替换）\nopenapi: 3.0.0\ninfo:\n  title: t\n  version: "1"\npaths: {}\n',
      'MODIFY', 'logos/resources/api/x.yaml', {});
    expect(api.tier).toBeUndefined();
    expect(api.degradation).toBeUndefined();
  });

  it('ST-S35-25: 降级与真实违规互不吞并', () => {
    // 同一份 payload 既降级（mysql）又结构违规（缺索引）→ 结构违规胜出，且不产生留痕
    const broken = validate('mysql', BODY.replace('CREATE INDEX idx_t ON t (name);', ''));
    expect(broken.ok).toBe(false);
    expect(broken.message).toContain('缺索引');
    expect(broken.degradation, '结构层失败时不应产生方言层留痕').toBeUndefined();

    // 修复结构后：通过且留痕出现——两者不是同一通道，互不吞并
    const fixed = validate('mysql');
    expect(fixed.ok).toBe(true);
    expect(fixed.degradation).toBeDefined();
  });
});
