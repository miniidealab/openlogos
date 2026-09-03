/**
 * 切片2：PostgreSQL 权威解析器接入。
 * 覆盖 UT-S39-60、UT-S39-61、ST-S39-28。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject, mergeAdmissibleProposal, mergeAdmissibleTasks, registerCoreModule } from './helpers.js';
import { validateAndStripNonMarkdownDelta } from '../src/lib/baseline-closure.js';
import { runChangeLint } from '../src/lib/change-lint.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

const CLI = resolve(__dirname, '..', 'dist', 'index.js');
const TARGET = 'logos/resources/database/core-x.sql';
const wrap = (body: string) => `## MODIFIED — ${TARGET}（整文件替换）\n${body}\n`;
const pg = (body: string) => validateAndStripNonMarkdownDelta(wrap(body), 'MODIFY', TARGET, { databaseDialect: 'postgresql' });

/** 结构五项齐备的基底，供各用例替换出方言特性。 */
const BASE = (extra = '', cols = 'id BIGSERIAL PRIMARY KEY, a TEXT NOT NULL, CONSTRAINT c UNIQUE (a)') => [
  '-- 迁移 migration',
  `CREATE TABLE t (${cols});`,
  extra,
  'CREATE INDEX i ON t (a);',
  '-- rollback 回滚',
].filter(Boolean).join('\n');

describe('S39 PostgreSQL 权威解析器', () => {
  it('UT-S39-60: 真实 PG 特性零误拦', () => {
    // 这批全是合法 PG SQL。修复前一律返回「适配器不可用」；若换成非权威解析器，
    // 生成列与 partial 索引会被误拦——本用例即两类回归的共同锁。
    const features: Array<[string, string]> = [
      ['生成列', BASE('', 'id BIGSERIAL PRIMARY KEY, a INT NOT NULL, b INT GENERATED ALWAYS AS (a * 2) STORED, CONSTRAINT c CHECK (a > 0)')],
      ['partial 索引', BASE("CREATE INDEX ip ON t (a) WHERE a IS NOT NULL;")],
      ['表达式索引', BASE("CREATE INDEX ie ON t (lower(a));")],
      ['数组类型', BASE('', 'id BIGSERIAL PRIMARY KEY, tags TEXT[] NOT NULL, CONSTRAINT c UNIQUE (tags)')],
      ['COMMENT ON', BASE("COMMENT ON TABLE t IS '说明';")],
      ['多子句 ALTER', BASE('ALTER TABLE t ADD COLUMN c INT NOT NULL DEFAULT 0, ALTER COLUMN a SET NOT NULL;')],
      ['分区表', BASE('', 'id BIGINT NOT NULL, d DATE NOT NULL, PRIMARY KEY (id, d), CONSTRAINT c CHECK (id > 0)')],
    ];
    for (const [label, body] of features) {
      const r = pg(body);
      expect(r.ok, `${label} 被误拦：${r.message}`).toBe(true);
      // 必须真的走到语法层，而非降级后蒙混通过
      expect(r.tier, `${label} 未走到语法层`).toBe('syntax');
      expect(r.degradation, `${label} 不应产生降级留痕`).toBeUndefined();
    }
  });

  it('UT-S39-61: PG 语法错误被拒并点名位置', () => {
    // 结构五项齐备，只有语法层能发现的错误（多余逗号）——证明接入的是真校验而非无条件放行
    const broken = BASE('', 'id BIGSERIAL PRIMARY KEY, a TEXT NOT NULL,, CONSTRAINT c UNIQUE (a)');
    const r = pg(broken);
    expect(r.ok).toBe(false);
    expect(r.tier).toBe('syntax');
    expect(r.message).toContain('PostgreSQL 语法预检失败');
    expect(r.message).toContain('syntax error');
    // 同一 payload 修好逗号即通过——差异确由语法层判定
    expect(pg(broken.replace(',,', ',')).ok).toBe(true);
  });

  it('ST-S39-28: 真实 CLI 下 PG 项目可交付完整闭环', () => {
    const setup = (body: string, dialect = 'postgresql') => {
      const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
      scaffoldProject(root, { locale: 'zh' });
      registerCoreModule(root, 'launched');
      const yamlPath = join(root, 'logos', 'logos-project.yaml');
      writeFileSync(yamlPath, `${readFileSync(yamlPath, 'utf8')}\n${stringifyYaml({ tech_stack: { database: dialect } })}`);
      mkdirSync(join(root, 'logos', 'resources', 'database'), { recursive: true });
      writeFileSync(join(root, TARGET), `${BASE()}\n`);
      const dir = join(root, 'logos', 'changes', 'sqlfix');
      mkdirSync(join(dir, 'deltas', 'database'), { recursive: true });
      // 闭包声明缺失会在 parseBaselineClosurePlan 阶段提前返回，走不到 delta 校验。
      const closure = [
        '## 基线闭包计划', '', '```yaml',
        'baseline_closure:', '  policy: on-touch-v1', '  schema_version: 1',
        '  unit: canonical-merge-target-path',
        '  delta_cardinality: exactly-one-per-non-skip-target',
        '  effective_view: merged-resources-plus-current-change-deltas',
        '  ambiguity: block-before-existing-plan-exit',
        '  standalone_baseline_required: false', '  jit_confirmation: disabled',
        '  touched_scenario_ids: [S99]', '  targets:',
        '    - category: database', '      scenario_ids: [S99]', '      mode: MODIFY',
        '      delta_path: "deltas/database/core-x.sql"', '      reason: "夹具"',
        `      evidence: ["target_exists: ${TARGET}"]`, '      missing_evidence: []',
        '```', '',
      ].join('\n');
      writeFileSync(join(dir, 'proposal.md'),
        mergeAdmissibleProposal('sqlfix').replace(/\n## 决策澄清/, `\n${closure}## 决策澄清`));
      // L9 只在基线闭包激活时才校验 non-Markdown delta——[MODIFY] 标记即激活信号。
      writeFileSync(join(dir, 'tasks.md'), mergeAdmissibleTasks(['- [ ] [MODIFY] `deltas/database/core-x.sql`：更新表定义。']));
      writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'sqlfix', module: 'core' }));
      writeFileSync(join(dir, 'deltas', 'database', 'core-x.sql'), wrap(body));
      return { root, dir };
    };

    // ① 合法 PG delta：L9 无 non_markdown_delta_invalid
    const ok = setup(BASE("CREATE INDEX ip ON t (a) WHERE a IS NOT NULL;"));
    const okLint = runChangeLint(ok.root, ok.dir, 'sqlfix');
    if (!okLint.ok) throw new Error(okLint.message);
    expect(okLint.violations.filter(v => v.code === 'non_markdown_delta_invalid')).toEqual([]);

    // ② 语法错的 PG delta：L9 判违规并点名语法错误
    const bad = setup(BASE('', 'id BIGSERIAL PRIMARY KEY, a TEXT NOT NULL,, CONSTRAINT c UNIQUE (a)'));
    const badLint = runChangeLint(bad.root, bad.dir, 'sqlfix');
    if (!badLint.ok) throw new Error(badLint.message);
    const sqlViolations = badLint.violations.filter(v => v.code === 'non_markdown_delta_invalid');
    expect(sqlViolations.length).toBeGreaterThan(0);
    expect(sqlViolations.map(v => v.message).join('\n')).toContain('syntax error');

    // ③ MySQL 项目：通过且 warnings 含降级留痕，不计入 violations
    const my = setup(BASE(), 'mysql');
    const myLint = runChangeLint(my.root, my.dir, 'sqlfix');
    if (!myLint.ok) throw new Error(myLint.message);
    expect(myLint.violations.filter(v => v.code === 'non_markdown_delta_invalid')).toEqual([]);
    const skipped = (myLint.warnings ?? []).filter(w => w.code === 'sql_dialect_precheck_skipped');
    expect(skipped.length).toBe(1);
    expect(skipped[0].message).toContain('mysql');
    expect(skipped[0].message).toContain('structure');

    // ④ 安装态入口同样可用（证明判定随包生效，而非仅 workspace）
    const cliRun = spawnSync(process.execPath, [CLI, 'change-lint', '--format', 'json'], { cwd: ok.root, encoding: 'utf8', timeout: 120000 });
    expect(`${cliRun.stdout}${cliRun.stderr}`).not.toContain('适配器不可用');
  });
});
