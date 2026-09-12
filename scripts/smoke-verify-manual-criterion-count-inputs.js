#!/usr/bin/env node
/**
 * SMOKE-core-208 — verify 判据收敛在**安装态**的行为取证。
 *
 * 下游 RunLogos 消费的是全局安装态 CLI：仓内源码修好、安装态未更新，对下游等于没修
 * （阻塞照旧且无人发现，AC-VERIFY-MANUAL-04 / EX-7.9）。
 *
 * 判据是**行为断言**，不是版本号比较——版本号相等只说明装了新包，不说明这两条判据真的收敛了：
 *   ① 描述列含裸标记字面量的自动化用例必须计入 executed，四个计数器自洽（D1 收敛）；
 *   ② 覆盖差 1 条而真实覆盖率舍入为 100% 时，不得产出 coverage_full_with_uncovered（D2 收敛）；
 *   ③ 真实未覆盖仍被点名（强度不放宽）；④ 首格带标记的真人工用例仍被排除。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目内，结束即删除；只读全局安装态，
 * 不触碰本机全局 prefix 与本仓活跃提案；命令图中不出现 npm publish / dist-tag / git tag / gh release。
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const VERIFY_CRITERION_SMOKE_IDS = ['SMOKE-core-208'];
const ENVIRONMENT = 'local-global-temp-project';
/** 裸标记字面量由拼接得到：本 runner 自身不直写它，免得同族判据把本文件也误判。 */
const MANUAL_LITERAL = `[${'manual'}]`;
const TOTAL_CASES = 201;                       // 足够大，使「差 1 条未覆盖」的真实覆盖率 ≥ 99.5%

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH
  || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: VERIFY_CRITERION_SMOKE_IDS,
    environment: ENVIRONMENT,
    assertion_kind: 'behavioural',            // 明示：不以版本号比较充当判据
    public_release_commands: [],
  }));
  process.exit(0);
}

const results = new Map();
const record = (id, status, detail, evidence = []) => results.set(id, { status, detail, evidence });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of VERIFY_CRITERION_SMOKE_IDS) {
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
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${result.stderr ?? ''}`.trim());
  }
  return result.stdout;
}
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cli = (entry, cwd, args) => checked(run(cliBin(entry), cliArgs(entry, args), cwd), `openlogos ${args.join(' ')}`);

function commandLookup() {
  const r = process.platform === 'win32'
    ? run('where', ['openlogos'])
    : run('/bin/sh', ['-lc', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}

/** A 行：首格干净、描述列含裸标记字面量；B 行：首格带标记的真人工用例；其余为普通用例。 */
function buildSpec() {
  const rows = [
    '| ID | 描述 |',
    '|---|---|',
    `| UT-S13-Z000 | 排除 ${MANUAL_LITERAL} 标记的元用例 |`,
    `| UT-S13-Z999 ${MANUAL_LITERAL} | 真人工用例 |`,
  ];
  for (let i = 1; i < TOTAL_CASES; i += 1) rows.push(`| UT-S13-Z${String(i).padStart(3, '0')} | 普通用例 |`);
  return rows.join('\n') + '\n';
}

/** 账本：A 行与普通用例全 pass，真人工用例无记录，最后一条普通用例刻意不入账。 */
function buildLedger() {
  const lines = [`{"id":"UT-S13-Z000","status":"pass"}`];
  for (let i = 1; i < TOTAL_CASES - 1; i += 1) {
    lines.push(`{"id":"UT-S13-Z${String(i).padStart(3, '0')}","status":"pass"}`);
  }
  return lines.join('\n') + '\n';
}

const entry = commandLookup();
if (!entry) {
  exitNotApplicable(VERIFY_CRITERION_SMOKE_IDS, {
    reason: '本机未安装全局 openlogos——安装态取证不适用',
    missing: ['global:openlogos'],
    environment: ENVIRONMENT,
    repoRoot,
  });
}

const scopes = [];
try {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-verify-criterion-'));
  scopes.push(base);
  cli(entry, base, ['init', 'vcrit', '--locale', 'zh', '--ai-tool', 'claude-code']);
  const project = base;            // init 在当前目录就地初始化（项目名不产生子目录）
  mkdirSync(join(project, 'logos/resources/test'), { recursive: true });
  mkdirSync(join(project, 'logos/resources/verify'), { recursive: true });
  writeFileSync(join(project, 'logos/resources/test/core-S13-test-cases.md'), buildSpec(), 'utf8');
  writeFileSync(join(project, 'logos/resources/verify/test-results.jsonl'), buildLedger(), 'utf8');

  // 本夹具刻意留 1 条未覆盖 → Gate 必然 FAIL(incomplete_coverage)、进程非零退出。
  //   本条要验的是**计数器自洽**，不是 Gate 放行，故按退出码不为 0 也解析 envelope。
  const verifyRun = run(cliBin(entry), cliArgs(entry, ['verify', '--format', 'json']), project);
  if (verifyRun.error || !verifyRun.stdout) {
    throw new Error(`verify 未产出 envelope：${verifyRun.error?.message ?? `exit ${verifyRun.status}`} ${verifyRun.stderr ?? ''}`.trim());
  }
  const envelope = JSON.parse(verifyRun.stdout);
  const data = envelope.data ?? {};
  const s = data.summary ?? {};
  const consistency = data.consistency ?? {};
  const mismatches = consistency.count_mismatches ?? [];
  const lastId = `UT-S13-Z${String(TOTAL_CASES - 1).padStart(3, '0')}`;
  const evidence = [
    `entry=${entry}`,
    `defined=${s.defined_count}`, `executed=${s.executed_count}`,
    `passed=${s.passed_count}`, `failed=${s.failed_count}`, `skipped=${s.skipped_count}`,
    `uncovered=${s.uncovered_count}`, `coverage_pct=${s.coverage_pct}`,
    `manual=${s.manual_count}`, `mismatches=${mismatches.join('|') || 'none'}`,
  ];

  // ① D1 收敛：A 行计入，四个计数器自洽
  if (s.passed_count + s.failed_count + s.skipped_count !== s.executed_count) {
    throw new Error(`计数不自洽：passed+failed+skipped=${s.passed_count + s.failed_count + s.skipped_count} 而 executed=${s.executed_count}（安装态仍是旧判据）`);
  }
  if (s.executed_count !== TOTAL_CASES - 1) {
    throw new Error(`executed 应为 ${TOTAL_CASES - 1}（A 行必须计入），实际 ${s.executed_count}`);
  }
  // ② D2 收敛：舍入不得触发覆盖矛盾
  if (mismatches.includes('coverage_full_with_uncovered') || mismatches.includes('passed_failed_skipped_ne_executed')) {
    throw new Error(`安装态仍以舍入值/整行判据判定：mismatches=${mismatches.join(', ')}`);
  }
  if (s.coverage_pct !== 100) {
    throw new Error(`展示覆盖率应仍为舍入后的 100（证明判定不再消费它），实际 ${s.coverage_pct}`);
  }
  // ③ 强度不放宽：真实未覆盖仍被点名
  if (s.uncovered_count !== 1 || !(data.uncovered_cases ?? []).includes(lastId)) {
    throw new Error(`真实未覆盖必须被点名：uncovered=${s.uncovered_count}，清单=${(data.uncovered_cases ?? []).join(',')}`);
  }
  // ④ 真人工用例仍被排除
  if (s.manual_count !== 1 || s.defined_count !== TOTAL_CASES) {
    throw new Error(`真人工用例必须仍被排除：manual=${s.manual_count}、defined=${s.defined_count}（期望 1 / ${TOTAL_CASES}）`);
  }
  // ⑤ 强度不放宽：Gate 仍因未覆盖判 FAIL（不得因判据收敛而放行）
  if ((data.gate ?? {}).result !== 'FAIL' || (data.gate ?? {}).reason !== 'incomplete_coverage') {
    throw new Error(`Gate 必须仍因未覆盖判 FAIL：result=${(data.gate ?? {}).result} reason=${(data.gate ?? {}).reason}`);
  }
  // ⑥ 报告与 envelope 的 Executed 取值一致（事故里控制台 6426、报告 6427）
  const report = readFileSync(join(project, 'logos/resources/verify/acceptance-report.md'), 'utf8');
  const reported = /\|\s*Executed cases\s*\|\s*(\d+)\s*\|/.exec(report);
  if (!reported || Number(reported[1]) !== Number(s.executed_count)) {
    throw new Error(`报告 Executed=${reported?.[1]} 与 envelope executed=${s.executed_count} 不一致`);
  }

  record('SMOKE-core-208', 'pass',
    `安装态判据已收敛：A 行计入（executed=${s.executed_count}）、四计数器自洽、`
    + `舍入覆盖率仍为 ${s.coverage_pct}% 但不再判矛盾、真实未覆盖 ${lastId} 仍被点名、真人工用例仍排除`,
    evidence);
} catch (error) {
  record('SMOKE-core-208', 'fail', error instanceof Error ? error.message : String(error), [`entry=${entry}`]);
} finally {
  flush();
  for (const scope of scopes) rmSync(scope, { recursive: true, force: true });
}

const failed = VERIFY_CRITERION_SMOKE_IDS.filter(id => (results.get(id)?.status ?? 'fail') !== 'pass');
if (failed.length > 0) {
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
console.log(`smoke 通过：${VERIFY_CRITERION_SMOKE_IDS.join(', ')}`);
