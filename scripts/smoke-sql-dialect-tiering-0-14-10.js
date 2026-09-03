#!/usr/bin/env node
/**
 * SMOKE-core-174 — 0.14.10 SQL 分层校验与能力缺失降级（安装态）。
 *
 * 只接受冻结本地 tarball；全部断言在一次性临时项目中构造，
 * **不触碰本仓或用户其它项目的活跃提案、guard 与 marker**，
 * **不手工创建任何 marker**，**不连接任何真实数据库实例**。
 *
 * 两条并列红线：④「PG delta 可交付」与 ⑤「PG 语法错仍被拒」。
 * 任一失败即整体 FAIL——解除阻断与仍拦得住真错误必须同时成立。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

export const SQL_DIALECT_TIERING_SMOKE_IDS = ['SMOKE-core-174'];
const EXPECTED_VERSION = '0.14.10';
const ROLLBACK_VERSION = '0.14.9';
const ENVIRONMENT = 'local-global-temp-project';
const root = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const resultPath = resolve(root, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({
    ids: SQL_DIALECT_TIERING_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version: EXPECTED_VERSION,
    rollback_version: ROLLBACK_VERSION,
    required_source_env: ['OPENLOGOS_SQL_TIER_TARBALL', 'OPENLOGOS_SQL_TIER_ROLLBACK_TARBALL'],
    routed_env: ['OPENLOGOS_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
    public_release_commands: [],
  }));
  process.exit(0);
}

requireEnvOrSkip(SQL_DIALECT_TIERING_SMOKE_IDS, [
  ['OPENLOGOS_SQL_TIER_TARBALL', 'OPENLOGOS_TARBALL'],
  ['OPENLOGOS_SQL_TIER_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL'],
], {
  reason: 'SQL 分层校验 smoke 需要 0.14.10 候选与 0.14.9 回滚制品',
  environment: 'sql-dialect-tiering',
});

const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const run = (cmd, args, cwd = root, env = process.env) =>
  spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 600_000 });

function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result.stdout.trim();
}

function requiredFile(primary, routed) {
  const raw = process.env[primary] || process.env[routed];
  if (!raw) throw new Error(`缺少 ${primary}`);
  const path = realpathSync(resolve(raw));
  if (!existsSync(path)) throw new Error(`${primary} 不存在：${path}`);
  return { path, sha256: sha256(readFileSync(path)) };
}

function commandLookup() {
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-lc', 'command -v openlogos']);
  return realpathSync(checked(r, '定位全局 openlogos').split(/\r?\n/)[0]);
}

const cliBin = e => (e.endsWith('.js') ? process.execPath : e);
const cliArgs = (e, a) => (e.endsWith('.js') ? [e, ...a] : a);
const cli = (e, cwd, a) => checked(run(cliBin(e), cliArgs(e, a), cwd), `openlogos ${a.join(' ')}`);
const cliRaw = (e, cwd, a) => run(cliBin(e), cliArgs(e, a), cwd);
const installGlobal = (tb, v) => checked(run(npmCommand, ['install', '--global', tb]), `全局安装 ${v}`);

function assertInstalledIdentity(expected) {
  const entry = commandLookup();
  const version = cli(entry, root, ['--version']).trim();
  if (!version.includes(expected)) throw new Error(`全局 openlogos 版本不符：期望 ${expected}，实际 ${version}`);
  return { entry, version };
}

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

const TARGET = 'logos/resources/database/core-x.sql';

/** 结构五项齐备的基底。cols/extra 用于替换出方言特性或注入语法错误。 */
const sqlBody = ({ cols = 'id BIGSERIAL PRIMARY KEY, a TEXT NOT NULL, CONSTRAINT c UNIQUE (a)', extra = '', index = 'CREATE INDEX i ON t (a);', migration = true } = {}) =>
  ['-- 迁移 migration', `CREATE TABLE t (${cols});`, extra, index, migration ? '-- rollback 回滚' : '']
    .filter(Boolean).join('\n');

const wrap = body => `## MODIFIED — ${TARGET}（整文件替换）\n${body}\n`;

const CLOSURE = [
  '## 基线闭包计划', '', '```yaml',
  'baseline_closure:', '  policy: on-touch-v1', '  schema_version: 1',
  '  unit: canonical-merge-target-path',
  '  delta_cardinality: exactly-one-per-non-skip-target',
  '  effective_view: merged-resources-plus-current-change-deltas',
  '  ambiguity: block-before-existing-plan-exit',
  '  standalone_baseline_required: false', '  jit_confirmation: disabled',
  '  touched_scenario_ids: [S99]', '  targets:',
  '    - category: database', '      scenario_ids: [S99]', '      mode: MODIFY',
  '      delta_path: "deltas/database/core-x.sql"', '      reason: "安装态夹具"',
  `      evidence: ["target_exists: ${TARGET}"]`, '      missing_evidence: []',
  '```', '',
].join('\n');

const PROPOSAL = `# 变更提案：sql-tier

> module: core

## 变更原因
安装态验证 SQL 分层校验。

## 变更类型
需求级变更。

## 变更范围
- 临时夹具。

## 部署影响
- 是否需要部署：否
- 部署原因：仅临时项目
- 影响环境：无
- 是否涉及数据迁移：否
- 是否需要回滚预案：否
- 是否需要 smoke：否

## UI/UX 变更声明

\`\`\`yaml
ui_impact: false
design_system_mode: generated
design_system_fallback_reason: ""
pages: []
\`\`\`

## Authority Impact

\`\`\`yaml
authority_impact:
  schema: openlogos/authority-impact@1
  applicability: not_applicable
  evidence: [纯安装态夹具，不改变事实归属]
\`\`\`

${CLOSURE}## 决策澄清

\`\`\`yaml
schema: openlogos/clarification@1
mode: provided
status: complete
impacts:
  data: {status: none, reason: 无数据影响}
  compatibility: {status: none, reason: 无兼容选择}
  security_privacy: {status: none, reason: 无安全隐私影响}
  public_release: {status: none, reason: 无公开发布}
  external_commitment: {status: none, reason: 无外部承诺}
decisions: []
unresolved: []
defaults: []
\`\`\`

## 变更概述
安装态夹具。
`;

const TASKS = '# 实现任务\n\n## [delta] 规格变更\n\n- [ ] [MODIFY] `deltas/database/core-x.sql`：更新表定义。\n';

/** 构造一次性 launched 夹具项目；绝不手工写 marker、不连数据库。 */
function scaffold(entry, dialect, body) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-174-'));
  cli(entry, base, ['init', 'sql-proj', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos', 'logos-project.yaml');
  const yaml = readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched');
  writeFileSync(yamlPath, `${yaml}\ntech_stack:\n  database: ${dialect}\n`);
  mkdirSync(join(base, 'logos', 'resources', 'database'), { recursive: true });
  writeFileSync(join(base, TARGET), `${sqlBody()}\n`);
  cli(entry, base, ['change', 'sql-tier']);
  const dir = join(base, 'logos', 'changes', 'sql-tier');
  writeFileSync(join(dir, 'proposal.md'), PROPOSAL);
  writeFileSync(join(dir, 'tasks.md'), TASKS);
  mkdirSync(join(dir, 'deltas', 'database'), { recursive: true });
  writeFileSync(join(dir, 'deltas', 'database', 'core-x.sql'), wrap(body));
  return { base, dir };
}

const lintJson = (entry, base) => {
  const r = cliRaw(entry, base, ['change-lint', '--format', 'json']);
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch { /* 非 JSON 由调用方按原文判定 */ }
  return { status: r.status, text: `${r.stdout}${r.stderr}`, data: parsed?.data ?? parsed?.error ?? null };
};
const sqlViolations = d => (d?.violations ?? []).filter(v => v.code === 'non_markdown_delta_invalid');

/** 步骤 ②③：解析器随包可加载、无安装脚本。 */
function assertBundledParser(entry) {
  const pkg = packageRoot(entry);
  const req = createRequire(join(pkg, 'package.json'));
  let resolved;
  try { resolved = req.resolve('pg-query-emscripten'); }
  catch (error) { throw new Error(`解析器未随包分发：${error instanceof Error ? error.message : String(error)}`); }
  if (!resolved.startsWith(pkg)) throw new Error(`解析器不在包内（疑似借用 workspace 依赖）：${resolved}`);

  const manifest = JSON.parse(readFileSync(join(dirname(resolved), '..', 'package.json'), 'utf8'));
  const scripts = manifest.scripts ?? {};
  const installScripts = ['preinstall', 'install', 'postinstall'].filter(k => scripts[k]);
  if (installScripts.length > 0) throw new Error(`解析器含安装脚本（供应链风险）：${installScripts.join('、')}`);

  // 真加载一次并解析已知 DDL——证明可用，而非仅文件存在
  const probe = spawnSync(process.execPath, ['-e',
    "const m=require(process.argv[1]);const f=typeof m==='function'?m:m.default;"
    + "Promise.resolve(f()).then(i=>{const r=i.parse('CREATE TABLE t (id INT PRIMARY KEY);');"
    + "process.stdout.write(JSON.stringify({ok:!r.error,nodes:JSON.stringify(r.parse_tree??r).length}));});",
    resolved], { encoding: 'utf8', timeout: 60_000 });
  const verdict = JSON.parse((probe.stdout || '{}').trim() || '{}');
  if (!verdict.ok) throw new Error(`解析器加载后无法解析已知 DDL：${probe.stderr?.slice(0, 200)}`);
  return { resolved_in_package: true, version: manifest.version, install_scripts: [], ast_bytes: verdict.nodes };
}

/** 步骤 ④～⑧。 */
function exerciseTiering(entry) {
  const scopes = [];
  const track = f => { scopes.push(f.base); return f; };
  try {
    // ④ PG delta 可交付 —— 红线
    const ok = track(scaffold(entry, 'postgresql', sqlBody({ extra: "CREATE INDEX ip ON t (a) WHERE a IS NOT NULL;" })));
    const okLint = lintJson(entry, ok.base);
    if (sqlViolations(okLint.data).length > 0) {
      throw new Error(`【阻断未解除】合法 PG delta 仍被拒：${JSON.stringify(sqlViolations(okLint.data))}`);
    }
    if (okLint.text.includes('适配器不可用')) throw new Error('仍出现「适配器不可用」——修复未随包生效');

    // ⑤ PG 语法错仍被拒 —— 红线
    const bad = track(scaffold(entry, 'postgresql', sqlBody({ cols: 'id BIGSERIAL PRIMARY KEY, a TEXT NOT NULL,, CONSTRAINT c UNIQUE (a)' })));
    const badLint = lintJson(entry, bad.base);
    const badViolations = sqlViolations(badLint.data);
    if (badViolations.length === 0) throw new Error('【解析器形同虚设】PG 语法错被放行');
    if (!badViolations.map(v => v.message).join('\n').includes('syntax error')) {
      throw new Error('语法错诊断未含解析器给出的错误位置');
    }

    // ⑥ MySQL 降级而非阻断
    const my = track(scaffold(entry, 'mysql', sqlBody()));
    const myLint = lintJson(entry, my.base);
    if (sqlViolations(myLint.data).length > 0) throw new Error('MySQL delta 被阻断——降级未生效');
    const warned = (myLint.data?.warnings ?? []).filter(w => w.code === 'sql_dialect_precheck_skipped');
    if (warned.length !== 1) throw new Error(`MySQL 降级留痕数量异常：${warned.length}`);
    if (!warned[0].message.includes('mysql') || !warned[0].message.includes('structure')) {
      throw new Error(`降级留痕未点名方言与已执行层级：${warned[0].message}`);
    }

    // ⑦ 结构检查不放宽：5 缺项 × 3 方言 = 15 组
    const missing = [
      ['缺 CREATE TABLE', sqlBody().replace('CREATE TABLE', 'CREATE TABL')],
      ['缺主键', sqlBody({ cols: 'id BIGSERIAL, a TEXT NOT NULL, CONSTRAINT c UNIQUE (a)' })],
      ['缺约束', sqlBody({ cols: 'id BIGSERIAL PRIMARY KEY, a TEXT NOT NULL' })],
      ['缺索引', sqlBody({ index: '' })],
      ['缺迁移/回滚语义', sqlBody({ migration: false }).replace('-- 迁移 migration', '')],
    ];
    const structural = [];
    for (const [label, body] of missing) {
      for (const dialect of ['sqlite', 'postgresql', 'mysql']) {
        const f = track(scaffold(entry, dialect, body));
        const lint = lintJson(entry, f.base);
        if (sqlViolations(lint.data).length === 0) {
          throw new Error(`【结构层被放宽】${label} 在 ${dialect} 下未被拒`);
        }
        structural.push({ label, dialect, rejected: true });
      }
    }

    // ⑧ 不跨方言冒充：PG/MySQL 路径不得出现 sqlite 相关诊断
    for (const [label, lint] of [['postgresql', okLint], ['mysql', myLint]]) {
      if (/SQLite|sqlite3/i.test(lint.text)) throw new Error(`${label} 路径出现 sqlite 诊断——疑似跨方言冒充`);
    }

    return {
      pg_deliverable: true,
      pg_syntax_error_rejected: badViolations.length,
      mysql_degraded_not_blocked: true,
      mysql_warning: warned[0].message,
      structural_checks: structural.length,
      no_cross_dialect_impersonation: true,
    };
  } finally {
    for (const base of scopes) rmSync(base, { recursive: true, force: true });
  }
}

async function smoke(id, operation) {
  const started = Date.now();
  let record;
  try {
    const evidence = await operation();
    record = { id, status: 'pass', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: ENVIRONMENT, evidence };
  } catch (error) {
    record = { id, status: 'fail', timestamp: new Date().toISOString(), duration_ms: Date.now() - started, environment: ENVIRONMENT, evidence: [], error: error instanceof Error ? error.message : String(error) };
  }
  mkdirSync(dirname(resultPath), { recursive: true });
  appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  if (record.status !== 'pass') throw new Error(record.error);
  return record;
}

await smoke('SMOKE-core-174', async () => {
  // ① 固定制品与全局身份
  const candidate = requiredFile('OPENLOGOS_SQL_TIER_TARBALL', 'OPENLOGOS_TARBALL');
  const rollback = requiredFile('OPENLOGOS_SQL_TIER_ROLLBACK_TARBALL', 'OPENLOGOS_PREVIOUS_TARBALL');
  const initial = assertInstalledIdentity(EXPECTED_VERSION);

  // ②③ 解析器随包可加载、无安装脚本
  const parser = assertBundledParser(initial.entry);
  // ④～⑧
  const tiering = exerciseTiering(initial.entry);

  // ⑨ 0.14.9→0.14.10→0.14.9→0.14.10 往返，每阶段复核 identity 与结论
  installGlobal(rollback.path, ROLLBACK_VERSION);
  const rolledBack = assertInstalledIdentity(ROLLBACK_VERSION);
  installGlobal(candidate.path, EXPECTED_VERSION);
  const restored = assertInstalledIdentity(EXPECTED_VERSION);
  const parserAfterRestore = assertBundledParser(restored.entry);
  const tieringAfterRestore = exerciseTiering(restored.entry);

  return [{
    candidate, rollback, initial, rolled_back: rolledBack, restored,
    parser, tiering, parser_after_restore: parserAfterRestore, tiering_after_restore: tieringAfterRestore,
  }];
});
