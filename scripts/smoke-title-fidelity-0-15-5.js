#!/usr/bin/env node
/**
 * SMOKE-core-207 — `ADDED` 标题保真的**安装态**取证。
 *
 * 缺陷只在安装态发作：宿主执行 merge 用的是全局安装的 CLI，仓库改完不发版，后续每一个含行内代码
 * 标题的 `ADDED` 块仍会被静默吞字，且**被吞内容无法从落盘文本反推**（架构 §五十一、功能规格 §2.80）。
 *
 * 判定一律读**落盘文本的原始字节**，逐字节比对——检查者与被检查者共用规范化管道时检查恒真，
 * 那正是本缺陷两次静默通过的机制；用 includes 近似同样会放行（吞字的表现恰是「其余都在、只少一段」）。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目内，结束即删除；不触碰本机全局 prefix 与本仓活跃提案。
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const TITLE_FIDELITY_SMOKE_IDS = ['SMOKE-core-207'];
const ENVIRONMENT = 'local-global-temp-project';
const TARGET_REL = 'logos/resources/test/core-S01-test-cases.md';
/** 被测标题：含两段行内代码——吞字会让两个字段名一起消失。 */
const ADDED_TITLE = '3.9 `x_field` 与 `y_field` 投影';
const RENAMED_OLD = '旧机制：Authority Closure 测试用例';
const RENAMED_NEW = 'S01：初始化 OpenLogos 项目 — 测试用例';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH
  || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: TITLE_FIDELITY_SMOKE_IDS,
    environment: ENVIRONMENT,
    candidate_version_source: 'cli/dist/lib/local-release-candidate.js',
    public_release_commands: [],
  }));
  process.exit(0);
}

const results = new Map();
const record = (id, status, detail, evidence = []) => results.set(id, { status, detail, evidence });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of TITLE_FIDELITY_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到（前序步骤已失败）', evidence: [] };
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: 0,
      environment: ENVIRONMENT, detail: row.detail, evidence: row.evidence,
    })}\n`);
  }
}

const run = (cmd, args, cwd = repoRoot) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000 });
function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${(result.stdout || '') + (result.stderr || '')}`.trim().slice(0, 400));
  }
  return result.stdout;
}
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cli = (entry, cwd, args) => checked(run(cliBin(entry), cliArgs(entry, args), cwd), `openlogos ${args.join(' ')}`);
const cliRaw = (entry, cwd, args) => run(cliBin(entry), cliArgs(entry, args), cwd);

function commandLookup() {
  const r = process.platform === 'win32'
    ? run('where', ['openlogos'])
    : run('/bin/sh', ['-lc', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

/**
 * 能力探针：安装态包的 `parseDeltaBlocks` 是否**携带** `rawAnchor` 字段。
 *
 * 用**行为**判据而非文本包含——`rawAnchor` 在旧版里是 parser 内部的局部变量名（一直存在），
 * 文本探测会把 0.15.4 误判为「已含能力」并让本条以 fail 而非 skip 收场。
 */
async function candidateCapable(entry) {
  try {
    const pkgRoot = packageRoot(entry);
    const mod = await import(pathToFileURL(join(pkgRoot, 'dist/lib/markdown-section-authority.js')).href);
    const blocks = mod.parseDeltaBlocks('## ADDED — 探针 `x` 标题\n\n正文。\n');
    return typeof blocks?.[0]?.rawAnchor === 'string' && blocks[0].rawAnchor.includes('`x`');
  } catch { return false; }
}

const CLARIFY = ['## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
  'impacts:', '  data: {status: none, reason: fixture}', '  compatibility: {status: none, reason: fixture}',
  '  security_privacy: {status: none, reason: fixture}', '  public_release: {status: none, reason: fixture}',
  '  external_commitment: {status: none, reason: fixture}', 'decisions: []', 'unresolved: []', 'defaults: []', '```', ''].join('\n');

/** 隔离临时项目：launched 模块 + 活跃提案 + 一个 delta（含被测 ADDED 块与 RENAMED 对照）。 */
function scaffold(entry, slug, deltaBody) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-title-'));
  cli(entry, base, ['init', 'tf', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos/logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, dirname(TARGET_REL)), { recursive: true });
  writeFileSync(join(base, TARGET_REL),
    `# ${RENAMED_OLD}\n\n## 一、判据\n\n| ID | 用例 |\n|---|---|\n| UT-S01-01 | 旧定义 |\n`);
  cli(entry, base, ['change', slug]);
  const dir = join(base, 'logos/changes', slug);
  writeFileSync(join(dir, 'proposal.md'), [`# 变更提案：${slug}`, '', '> module: core', '',
    '## 变更原因', '安装态标题保真取证。', '', '## 变更类型', '设计级', '', '## 变更范围', '- fixture', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：无', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 变更概述', '验证 ADDED 标题原样落盘。', '', CLARIFY].join('\n'));
  writeFileSync(join(dir, 'tasks.md'),
    '# 任务\n\n## [delta] 规格变更\n- [x] 产出 delta 文件到 `deltas/test/` — `core-S01-test-cases.md`\n\n## [code] 代码实现\n');
  mkdirSync(join(dir, 'deltas/test'), { recursive: true });
  writeFileSync(join(dir, 'deltas/test/core-S01-test-cases.md'), deltaBody);
  writeFileSync(join(dir, 'PLAN_APPROVED'), '{}');
  return { base, dir, target: join(base, TARGET_REL) };
}

/** 落盘文本中某标题的**原始行**——唯一合法取值来源，不经任何规范化。 */
const rawHeadingLine = (doc, contains) =>
  doc.split('\n').find(l => /^#{1,6} /.test(l) && l.includes(contains));

const entry = commandLookup();
if (!entry) {
  exitNotApplicable(TITLE_FIDELITY_SMOKE_IDS, {
    reason: '本机未安装全局 openlogos——安装态取证不适用',
    missing: ['global:openlogos'], environment: ENVIRONMENT, repoRoot,
  });
}
const globalVersion = cli(entry, repoRoot, ['--version']).trim();
if (!(await candidateCapable(entry))) {
  exitNotApplicable(TITLE_FIDELITY_SMOKE_IDS, {
    reason: `全局安装态尚不含标题保真（markdown-section-authority 无 rawAnchor，当前 ${globalVersion}）——请先完成 [deploy] 全局安装`,
    missing: ['global-candidate-capability:rawAnchor'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
try {
  const slug = 'title-fidelity-probe';
  // ADDED 正文携带真实测试 ID 表格——change-lint L3 要求本提案有可采信的 UT/ST ID 证据。
  const deltaBody = [
    `## ADDED — ${ADDED_TITLE}`, '',
    '| ID | 用例 |', '|---|---|', '| UT-S01-09 | 安装态标题保真取证 |', '',
    `## RENAMED — ${RENAMED_OLD}`, '', RENAMED_NEW, '',
  ].join('\n');
  const fx = scaffold(entry, slug, deltaBody);
  scopes.push(fx.base);
  const evidence = [`entry=${entry}`, `version=${globalVersion}`, `project=${fx.base}`];

  // ① change-lint 接纳
  const lint = cliRaw(entry, fx.base, ['change-lint', '--slug', slug]);
  if (lint.status !== 0) throw new Error(`change-lint 未通过（exit=${lint.status}）：${(lint.stdout || '').slice(0, 300)}`);

  // ② merge 一次调用成功
  const merged = cliRaw(entry, fx.base, ['merge', slug]);
  if (merged.status !== 0) throw new Error(`merge 失败（exit=${merged.status}）：${((merged.stdout || '') + (merged.stderr || '')).slice(0, 400)}`);
  if (!existsSync(join(fx.dir, 'SPEC_MERGED'))) throw new Error('merge 成功但未写 SPEC_MERGED');

  // ③ 逐字节比对落盘标题行（不得用 includes 近似）
  const applied = readFileSync(fx.target, 'utf8');
  const addedLine = rawHeadingLine(applied, '投影');
  const expectedAdded = `## ${ADDED_TITLE}`;
  if (addedLine !== expectedAdded) {
    throw new Error(`ADDED 标题未原样落盘：期望「${expectedAdded}」，实际「${addedLine}」`);
  }

  // ④ RENAMED 零回归对照：H1 更名生效、层级仍为 H1、正文不变
  const h1 = applied.split('\n')[0];
  if (h1 !== `# ${RENAMED_NEW}`) throw new Error(`RENAMED 未正确应用：首行为「${h1}」`);
  if (!applied.includes('| UT-S01-01 | 旧定义 |')) throw new Error('RENAMED 改动了章节正文');

  record('SMOKE-core-207', 'pass',
    `安装态 merge 后 ADDED 标题逐字节保真（${expectedAdded}），RENAMED 零回归（H1 更名且正文不变）`,
    [...evidence, `added_line=${addedLine}`, `h1=${h1}`]);
} catch (error) {
  record('SMOKE-core-207', 'fail', error instanceof Error ? error.message : String(error), [`entry=${entry}`]);
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = TITLE_FIDELITY_SMOKE_IDS.filter(id => (results.get(id)?.status ?? 'fail') !== 'pass');
if (failed.length > 0) {
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
console.log(`smoke 通过：${TITLE_FIDELITY_SMOKE_IDS.join(', ')}`);
