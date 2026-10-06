#!/usr/bin/env node
/**
 * SMOKE-core-213 / SMOKE-core-214 — 目标既有测试欠债继承口径（功能规格 §2.86）的**安装态**取证
 * （release-0-15-17-local；上游 fix-inherited-test-debt-merge-block）。
 *
 * 判据只在安装态对宿主生效：仓内源码修好、全局 CLI 未更新，RunLogos 驱动的宿主项目仍会因目标文件既有欠债
 * 在 merge 合成期硬停于 `test-change-set-ambiguous-table` / `test-change-set-duplicate-id`。判据用行为断言：
 * 版本号相等只证明装了新包，不证明判据生效。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目内，结束即删除；只读本机全局安装态（不安装 / 卸载），
 * 不触碰本仓活跃提案与用户其他仓库；命令图中不出现任何公网发布命令。
 *
 * 判据分两档（沿 SMOKE-core-211/212 runner 的既有形态）：
 * - **本案安装验收窗口**（活跃提案为本 slug，或 OPENLOGOS_INHERITED_DEBT_SMOKE=1）：全局入口缺失、安装态包不含
 *   新判据、安装身份与本次冻结候选不符，一律写 **fail** 并非零退出——不得以 skip 充当安装验收证据。
 *   候选版本在运行时读取 `cli/src/lib/local-release-candidate.ts` 的 LOCAL_RELEASE_CANDIDATE_VERSION（升版脚本
 *   写入），不写死版本字面量。
 * - **窗口之外**（后续其它提案跑全量 smoke）：本 runner 不适用，按既有留痕机制写 skip。
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const INHERITED_DEBT_SMOKE_IDS = ['SMOKE-core-213', 'SMOKE-core-214'];
const ENVIRONMENT = 'local-global-temp-project';
const PROBE = 'inheritedAmbiguousRowKeys';
const COL = 'delta_test_table_column_mismatch';
const SLUG = 'release-0-15-17-local';
const PROPOSAL = 'smoke-inherited-debt';
const S68 = 'logos/resources/test/core-S68-test-cases.md';
const S37 = 'logos/resources/test/core-S37-test-cases.md';
const S68_DELTA = 'deltas/test/core-S68-test-cases.md';
const S37_DELTA = 'deltas/test/core-S37-test-cases.md';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH
  || 'logos/resources/verify/smoke-results.jsonl');
/** 仅供 runner 自身测试注入入口（指向仓内 dist 或隔离 prefix）；生产运行不设置。 */
const INJECTED_ENTRY = process.env.OPENLOGOS_INHERITED_DEBT_SMOKE_ENTRY;

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: INHERITED_DEBT_SMOKE_IDS,
    environment: ENVIRONMENT,
    applies_when: [`active change == ${SLUG}`, 'OPENLOGOS_INHERITED_DEBT_SMOKE=1'],
    candidate_version_source: 'cli/src/lib/local-release-candidate.ts',
    capability_probe: `installed dist/lib/test-change-set.js exports ${PROBE}`,
    public_release_commands: [],
  }));
  process.exit(0);
}

const results = new Map();
const record = (id, status, detail, evidence = []) => results.set(id, { status, detail, evidence });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of INHERITED_DEBT_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到（前序步骤已失败）', evidence: [] };
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: 0,
      environment: ENVIRONMENT, detail: row.detail, evidence: row.evidence,
    })}\n`);
  }
}

const run = (cmd, args, cwd = repoRoot, extraEnv = {}) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, env: { ...process.env, ...extraEnv } });
function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${(result.stdout || '') + (result.stderr || '')}`.trim().slice(0, 400));
  }
  return result.stdout;
}
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cli = (entry, cwd, args) => checked(run(cliBin(entry), cliArgs(entry, args), cwd), `openlogos ${args.join(' ')}`);
const cliRaw = (entry, cwd, args, extraEnv = {}) => run(cliBin(entry), cliArgs(entry, args), cwd, extraEnv);

function commandLookup() {
  if (INJECTED_ENTRY !== undefined) {
    return INJECTED_ENTRY && existsSync(INJECTED_ENTRY) ? realpathSync(INJECTED_ENTRY) : null;
  }
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
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

/** 能力探针：安装态 test-change-set 是否导出继承判定（未部署前即以 fail 点名「入口仍指向旧版」）。 */
function candidateCapable(pkgRoot) {
  const js = join(pkgRoot, 'dist/lib/test-change-set.js');
  return existsSync(js) && new RegExp(`export function ${PROBE}\\b`).test(readFileSync(js, 'utf8'));
}

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (activeChange() !== SLUG && process.env.OPENLOGOS_INHERITED_DEBT_SMOKE !== '1') {
  exitNotApplicable(INHERITED_DEBT_SMOKE_IDS, {
    reason: `非本案安装验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_INHERITED_DEBT_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_INHERITED_DEBT_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

function candidateVersion() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const m = existsSync(src)
    ? /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(readFileSync(src, 'utf8'))
    : null;
  if (!m) throw new Error(`无法读取候选版本（${src} 缺失或无 LOCAL_RELEASE_CANDIDATE_VERSION）`);
  return m[1];
}

function failAll(reason, evidence = []) {
  for (const id of INHERITED_DEBT_SMOKE_IDS) record(id, 'fail', reason, evidence);
  flush();
  console.error(`smoke 失败：${INHERITED_DEBT_SMOKE_IDS.join(', ')}：${reason}`);
  process.exit(1);
}

// ── 夹具（与 cli/test/s35-inherited-test-debt.test.ts、s09-inherited-test-debt-merge.test.ts 同构，ID 为临时项目私有）──
const DEBT_05 = '| ST-S68-05 | 欠债 | 一 | 二 | 三 |';
const DEBT_06 = '| ST-S68-06 | 欠债二 | 一 | 二 | 三 |';
const HEADER_4 = '| ID | 场景 | 步骤 | 断言 |\n|---|---|---|---|';
const S68_CANON = ['# core-S68 测试用例', '', '## S68 场景测试', '', HEADER_4,
  '| ST-S68-01 | 正常 | 一 | 通过 |', DEBT_05, DEBT_06, ''].join('\n');
const S37_DUP_A = '| UT-S37-01 | 定义甲 |';
const S37_DUP_B = '| UT-S37-01 | 定义乙 |';
const S37_CANON = ['# core-S37 测试用例', '', '## S37 单元测试', '', '| ID | 描述 |', '|---|---|', S37_DUP_A, S37_DUP_B, ''].join('\n');
const S68_ADDED = '## ADDED — S68 补充用例\n\n| ID | 描述 |\n|---|---|\n| UT-S68-20 | 新增 |\n';
const S37_ADDED = '## ADDED — S37 补充用例\n\n| ID | 描述 |\n|---|---|\n| UT-S37-30 | 新增 |\n';
const s68Modified = rows => `## MODIFIED — S68 场景测试\n\n${HEADER_4}\n${rows.join('\n')}\n`;
const CARRY_ROWS = ['| ST-S68-01 | 正常 | 一 | 通过（新） |', DEBT_05, DEBT_06];

const PROPOSAL_MD = [
  `# 变更提案：${PROPOSAL}`, '', '> module: core', '',
  '## 变更原因', '安装态 smoke 夹具：验证目标既有测试欠债继承口径已进入全局 CLI。', '',
  '## 变更类型', '代码级', '',
  '## 变更范围', '- 影响的测试规格：临时项目私有测试用例文档。', '',
  '## 部署影响', '- 是否需要部署：否', '- 部署原因：smoke 夹具不产生部署影响', '- 影响环境：无',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
  '## UI/UX 变更声明', '', '```yaml', 'ui_impact: false', 'design_system_mode: generated',
  'design_system_fallback_reason: ""', 'pages: []', '```', '',
  '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
  'impacts:', '  data:', '    status: none', '    reason: smoke 夹具不涉及数据影响',
  '  compatibility:', '    status: none', '    reason: smoke 夹具不涉及兼容性影响',
  '  security_privacy:', '    status: none', '    reason: smoke 夹具不涉及安全或隐私影响',
  '  public_release:', '    status: none', '    reason: smoke 夹具不涉及公开发布',
  '  external_commitment:', '    status: none', '    reason: smoke 夹具不涉及外部承诺',
  'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
  '## 变更概述', 'smoke 夹具保持既有行为。', '',
].join('\n');
const tasksMd = deltas => ['# 实现任务', '', '## [delta] 规格变更', '',
  ...deltas.map(p => `- [ ] 产出 delta 到 \`${p}\`。`), '', '## [code] 代码实现', ''].join('\n');

function writeRel(base, rel, content) {
  const abs = join(base, ...rel.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** 经全局 CLI 建立 launched 临时项目与可合并最小提案；返回项目根。 */
function newProposalProject(entry, name, scopes, deltas, seeds) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-inherited-debt-'));
  scopes.push(base);
  cli(entry, base, ['init', name, '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos/logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  cli(entry, base, ['change', PROPOSAL]);
  const proposalDir = join(base, 'logos/changes', PROPOSAL);
  if (!existsSync(join(base, 'logos/.openlogos-guard'))) throw new Error('openlogos change 未写出 guard 文件');
  writeFileSync(join(proposalDir, 'proposal.md'), PROPOSAL_MD);
  writeFileSync(join(proposalDir, 'tasks.md'), tasksMd(Object.keys(deltas)));
  for (const [rel, content] of Object.entries(deltas)) writeRel(proposalDir, rel, content);
  for (const [rel, content] of Object.entries(seeds)) writeRel(base, rel, content);
  return base;
}

function lintJson(entry, base) {
  const r = cliRaw(entry, base, ['change-lint', '--slug', PROPOSAL, '--format', 'json']);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* 下方按 null 处理 */ }
  if (!json || !json.data) throw new Error(`change-lint --format json 输出不可解析（exit ${r.status}）：${(r.stderr || r.stdout || '').slice(0, 200)}`);
  return { status: r.status, pass: json.data.pass, violations: json.data.violations || [], stderr: r.stderr || '' };
}
const merge = (entry, base) => cliRaw(entry, base, ['merge', PROPOSAL], { OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' });
const readRel = (base, rel) => readFileSync(join(base, ...rel.split('/')), 'utf8');
const markerPath = base => join(base, 'logos/changes', PROPOSAL, 'SPEC_MERGED');
const lintSummary = v => `${v.code}@${v.path}: ${String(v.message).slice(0, 200)}`;

let candidate;
try { candidate = candidateVersion(); } catch (error) { failAll(error instanceof Error ? error.message : String(error)); }
const entry = commandLookup();
if (!entry) failAll('本机未找到全局 openlogos 入口——本次候选未安装到全局或安装到了错误的 npm prefix', ['global:openlogos']);
let pkgRoot;
let globalVersion;
try {
  pkgRoot = packageRoot(entry);
  globalVersion = cli(entry, repoRoot, ['--version']).trim();
} catch (error) {
  failAll(error instanceof Error ? error.message : String(error), [`entry=${entry}`]);
}
if (!candidateCapable(pkgRoot)) {
  failAll(`全局安装态 test-change-set 未导出 ${PROBE}（当前 ${globalVersion}）——入口仍指向旧版或安装未生效`,
    [`entry=${entry}`, `version=${globalVersion}`]);
}
if (globalVersion !== candidate) {
  failAll(`全局 --version（${globalVersion}）与本次冻结候选版本（${candidate}）不符`,
    [`entry=${entry}`, `version=${globalVersion}`, `candidate_version=${candidate}`]);
}

const scopes = [];
const baseEvidence = [`entry=${entry}`, `version=${globalVersion}`, `candidate_version=${candidate}`,
  INJECTED_ENTRY !== undefined ? 'mode=injected-self-test' : 'mode=global'];
const versionBefore = { entry, version: globalVersion };
function globalUntouched() {
  const e = commandLookup();
  const v = e ? cli(e, repoRoot, ['--version']).trim() : null;
  if (e !== versionBefore.entry || v !== versionBefore.version) {
    throw new Error(`全局入口或版本在矩阵执行期间发生变化：${versionBefore.entry}@${versionBefore.version} → ${e}@${v}`);
  }
}

// ── SMOKE-core-213：安装态身份与事故形态放行 ──
try {
  const problems = [];
  // ① 身份
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  if (pkg.version !== globalVersion) problems.push(`--version（${globalVersion}）与包 package.json（${pkg.version}）不一致`);
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'asset-manifest.json'), 'utf8'));
  if (manifest.version !== globalVersion) problems.push(`asset-manifest version（${manifest.version}）与 --version（${globalVersion}）不一致`);
  const assetLib = await import(pathToFileURL(join(pkgRoot, 'dist/lib/asset-manifest.js')).href);
  try { assetLib.validateAssetManifest(manifest, pkgRoot); } catch (e) { problems.push(`asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
  if (problems.length > 0) throw new Error(problems.join('；'));

  // ② ③ 两目标各纯 ADDED → lint PASS、真实 merge 成功
  const p = newProposalProject(entry, 's213', scopes,
    { [S68_DELTA]: S68_ADDED, [S37_DELTA]: S37_ADDED }, { [S68]: S68_CANON, [S37]: S37_CANON });
  const lint = lintJson(entry, p);
  if (lint.status !== 0 || lint.pass !== true) problems.push(`纯 ADDED change-lint 应 exit 0 / PASS，实际 exit ${lint.status}：${lint.violations.map(lintSummary).join(' | ')}`);
  const m = merge(entry, p);
  const mergeErr = String(m.stderr);
  if (m.status !== 0) problems.push(`纯 ADDED merge 应退出 0，实际 ${m.status}：${mergeErr.slice(0, 300)}`);
  for (const code of ['test-change-set-ambiguous-table', 'test-change-set-duplicate-id']) {
    if (mergeErr.includes(`merge 失败（${code}）`)) problems.push(`merge 仍因目标既有欠债以 ${code} 失败（继承口径未生效）`);
  }
  // ④ SPEC_MERGED 与欠债保留
  let changed = null;
  if (!existsSync(markerPath(p))) problems.push('纯 ADDED merge 未写出 SPEC_MERGED');
  else {
    changed = JSON.parse(readFileSync(markerPath(p), 'utf8')).test_change_set?.changed_test_ids ?? null;
    if (JSON.stringify(changed) !== JSON.stringify(['UT-S37-30', 'UT-S68-20'])) problems.push(`changed_test_ids 应恰为新增 ID，实际 ${JSON.stringify(changed)}`);
  }
  if (m.status === 0) {
    const s68After = readRel(p, S68);
    const s37After = readRel(p, S37);
    if (!s68After.includes(DEBT_05) || !s68After.includes(DEBT_06)) problems.push('合并后 S68 欠债行未逐字节保留');
    if (!s37After.includes(S37_DUP_A) || !s37After.includes(S37_DUP_B)) problems.push('合并后 S37 重复记录未逐字节保留');
  }
  globalUntouched();
  if (problems.length > 0) throw new Error(problems.join('；'));
  record('SMOKE-core-213', 'pass',
    `安装态身份同源（${globalVersion}，manifest 自洽，判据 ${PROBE} 在场）；目标含既有列数欠债与同文件重复 ID 时纯 ADDED 提案 lint PASS、真实 merge 成功，changed_test_ids 恰为新增 ID，欠债逐字节保留`,
    [...baseEvidence, `project=${p}`, `changed_test_ids=${JSON.stringify(changed)}`, `merge_exit=${m.status}`]);
} catch (error) {
  record('SMOKE-core-213', 'fail', error instanceof Error ? error.message : String(error), baseEvidence);
}

// ── SMOKE-core-214：原样携带放行、合并后不重放、新增欠债仍拒 ──
try {
  const problems = [];
  // ① P1：MODIFIED 原样携带 + ADDED → lint 0 → merge 0 → 再次 lint 0
  const p1 = newProposalProject(entry, 'p1', scopes, { [S68_DELTA]: `${s68Modified(CARRY_ROWS)}\n${S68_ADDED}` }, { [S68]: S68_CANON });
  const l1 = lintJson(entry, p1);
  if (l1.status !== 0 || l1.pass !== true) problems.push(`P1 首次 change-lint 应 PASS，实际 exit ${l1.status}：${l1.violations.map(lintSummary).join(' | ')}`);
  const m1 = merge(entry, p1);
  if (m1.status !== 0) problems.push(`P1 merge 应退出 0，实际 ${m1.status}：${String(m1.stderr).slice(0, 300)}`);
  if (!existsSync(markerPath(p1))) problems.push('P1 merge 未写出 SPEC_MERGED');
  const l1b = lintJson(entry, p1);
  if (l1b.status !== 0) problems.push(`P1 合并后再次 change-lint 应 exit 0，实际 ${l1b.status}：${l1b.violations.map(lintSummary).join(' | ')}`);
  if (l1b.violations.some(v => v.code === COL)) problems.push(`P1 合并后再次 lint 仍报 ${COL}（阶段边界未生效）`);
  if (l1b.stderr.includes('ADDED 章节已存在或不唯一')) problems.push('P1 合并后再次 lint 出现「ADDED 章节已存在或不唯一」（发生了重合成）');
  // ② P2：再追加一条与 ST-S68-05 逐字节相同的行 → lint exit 2、merge 预检拒绝
  const p2 = newProposalProject(entry, 'p2', scopes, { [S68_DELTA]: s68Modified([...CARRY_ROWS, DEBT_05]) }, { [S68]: S68_CANON });
  const targetBefore = readRel(p2, S68);
  const l2 = lintJson(entry, p2);
  if (l2.status !== 2) problems.push(`P2 change-lint 应 exit 2，实际 ${l2.status}`);
  if (!l2.violations.some(v => v.code === COL)) problems.push(`P2 violations 不含 ${COL}：${l2.violations.map(lintSummary).join(' | ') || '（空）'}`);
  const m2 = merge(entry, p2);
  if (m2.status === 0) problems.push('P2 merge 应非零退出，实际 0（宽容外溢到本提案引入的欠债）');
  if (!String(m2.stderr).includes('change-lint 未通过')) problems.push(`P2 merge stderr 缺「change-lint 未通过」：${String(m2.stderr).slice(0, 200)}`);
  if (existsSync(markerPath(p2))) problems.push('P2 merge 后出现 SPEC_MERGED');
  if (readRel(p2, S68) !== targetBefore) problems.push('P2 merge 后目标字节发生变化');
  // ③ 全局零触碰
  globalUntouched();
  if (problems.length > 0) throw new Error(problems.join('；'));
  record('SMOKE-core-214', 'pass',
    `MODIFIED 原样携带欠债 + ADDED 经全局 CLI lint PASS、merge 成功、合并后再次 lint 仍 PASS 且无 ${COL}；追加同字节副本时 lint exit 2 报 ${COL}、merge 于预检出口拒绝且目标不变；全局入口与版本前后一致`,
    [...baseEvidence, `p1=${p1}`, `p2=${p2}`, `p2_lint=${l2.violations.map(lintSummary).join(' | ')}`,
      `p2_merge_stderr=${String(m2.stderr).split('\n')[0]}`]);
} catch (error) {
  record('SMOKE-core-214', 'fail', error instanceof Error ? error.message : String(error), baseEvidence);
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = INHERITED_DEBT_SMOKE_IDS.filter(id => (results.get(id)?.status ?? 'fail') !== 'pass');
if (failed.length > 0) {
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
console.log(`smoke 通过：${INHERITED_DEBT_SMOKE_IDS.join(', ')}`);
