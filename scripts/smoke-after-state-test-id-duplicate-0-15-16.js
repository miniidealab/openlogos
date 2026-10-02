#!/usr/bin/env node
/**
 * SMOKE-core-211 / SMOKE-core-212 — 后态测试 ID 重复判据同源前移（功能规格 §2.85）的**安装态**取证
 * （release-0-15-16-local；上游 lint-modified-sibling-section-collision）。
 *
 * 判据只在安装态对宿主生效：仓内源码修好、全局 CLI 未更新，RunLogos 驱动的宿主项目仍会在合成期硬停于
 * `test-change-set-duplicate-id`。判据用行为断言：版本号相等只证明装了新包，不证明判据生效。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目内，结束即删除；只读本机全局安装态（不安装 / 卸载），
 * 不触碰本仓活跃提案与用户其他仓库；命令图中不出现任何公网发布命令。
 *
 * 判据分两档（沿 SMOKE-core-209/210 runner 的既有形态）：
 * - **本案安装验收窗口**（活跃提案为本 slug，或 OPENLOGOS_AFTER_STATE_DUP_SMOKE=1）：全局入口缺失、安装态包不含
 *   新判据、安装身份与本次冻结候选不符，一律写 **fail** 并非零退出——不得以 skip 充当安装验收证据。
 *   候选身份在运行时读取：`cli/src/lib/local-release-candidate.ts` 的 LOCAL_RELEASE_CANDIDATE_VERSION（升版脚本
 *   写入）与仓内分发源 `skills/change-writer/SKILL.md` 字节；不写死版本字面量。
 * - **窗口之外**（后续其它提案跑全量 smoke）：本 runner 不适用，按既有留痕机制写 skip。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const AFTER_STATE_DUP_SMOKE_IDS = ['SMOKE-core-211', 'SMOKE-core-212'];
const ENVIRONMENT = 'local-global-temp-project';
const CODE = 'delta_test_id_duplicate';
const SKILL_REL = 'skills/change-writer/SKILL.md';
const SKILL_BOUNDARY_MARK = '「整节」的边界';
const SLUG = 'release-0-15-16-local';
const PROPOSAL = 'smoke-after-state-dup';
const TEST_TARGET = 'logos/resources/test/core-S09-test-cases.md';
const TEST_DELTA = 'deltas/test/core-S09-test-cases.md';
const WHOLE_FILE_TARGET = 'logos/resources/test/core-S11-test-cases.md';
const WHOLE_FILE_DELTA = 'deltas/test/core-S11-test-cases.md';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH
  || 'logos/resources/verify/smoke-results.jsonl');
/** 仅供 runner 自身测试注入入口（指向仓内 dist 或隔离 prefix）；生产运行不设置。 */
const INJECTED_ENTRY = process.env.OPENLOGOS_AFTER_STATE_DUP_SMOKE_ENTRY;

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: AFTER_STATE_DUP_SMOKE_IDS,
    environment: ENVIRONMENT,
    applies_when: [`active change == ${SLUG}`, 'OPENLOGOS_AFTER_STATE_DUP_SMOKE=1'],
    candidate_version_source: 'cli/src/lib/local-release-candidate.ts',
    candidate_skill_source: SKILL_REL,
    capability_probe: `installed dist/lib/change-lint.js registers ${CODE}`,
    public_release_commands: [],
  }));
  process.exit(0);
}

const results = new Map();
const record = (id, status, detail, evidence = []) => results.set(id, { status, detail, evidence });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of AFTER_STATE_DUP_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到（前序步骤已失败）', evidence: [] };
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: 0,
      environment: ENVIRONMENT, detail: row.detail, evidence: row.evidence,
    })}\n`);
  }
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
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

/** 能力探针：安装态 change-lint 是否登记了新码（未部署前即以 fail 点名「入口仍指向旧版」）。 */
function candidateCapable(pkgRoot) {
  const lintJs = join(pkgRoot, 'dist/lib/change-lint.js');
  return existsSync(lintJs) && readFileSync(lintJs, 'utf8').includes(`'${CODE}'`);
}

/** 随包 Skill：打包态位于包根 `skills/`；仓内 dist 注入自测时回退到仓根 `skills/`（与 asset-manifest 的开发态回退同口径）。 */
function packagedSkillPath(pkgRoot) {
  const packed = join(pkgRoot, SKILL_REL);
  if (existsSync(packed)) return packed;
  const dev = join(pkgRoot, '..', SKILL_REL);
  if (INJECTED_ENTRY !== undefined && existsSync(dev)) return dev;
  throw new Error(`安装态包内缺少随包 ${SKILL_REL}（${packed}）`);
}

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (activeChange() !== SLUG && process.env.OPENLOGOS_AFTER_STATE_DUP_SMOKE !== '1') {
  exitNotApplicable(AFTER_STATE_DUP_SMOKE_IDS, {
    reason: `非本案安装验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_AFTER_STATE_DUP_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_AFTER_STATE_DUP_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

function candidateIdentity() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const m = existsSync(src)
    ? /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(readFileSync(src, 'utf8'))
    : null;
  if (!m) throw new Error(`无法读取候选版本（${src} 缺失或无 LOCAL_RELEASE_CANDIDATE_VERSION）`);
  const skill = join(repoRoot, SKILL_REL);
  if (!existsSync(skill)) throw new Error(`无法读取候选 Skill 分发源（${skill}）`);
  return { version: m[1], skillSha: sha256(readFileSync(skill)) };
}

function failAll(reason, evidence = []) {
  for (const id of AFTER_STATE_DUP_SMOKE_IDS) record(id, 'fail', reason, evidence);
  flush();
  console.error(`smoke 失败：${AFTER_STATE_DUP_SMOKE_IDS.join(', ')}：${reason}`);
  process.exit(1);
}

// ── 夹具（与 cli/test/s35-after-state-test-id-duplicate-left-shift.test.ts 同构，ID 为临时项目私有）──
const CANON = [
  '# core-S09: 模型导入测试用例', '',
  '## S09: 模型导入 — 测试用例', '', '> 导言。', '', '### 测试替身层级要求', '', '替身说明。', '',
  '## 一、单元测试用例', '', '| ID | 描述 |', '|---|---|', '| UT-S09-01 | 未授权零调用 |', '| UT-S09-02 | 校验失败 |', '',
  '## 二、场景测试用例', '', '| ID | 描述 |', '|---|---|', '| ST-S09-01 | 导入成功 |', '',
  '## 三、覆盖度校验', '', '覆盖说明。', '',
  '## 四、追溯', '', '- 需求：S09', '',
].join('\n');
const ACCIDENT_DELTA = (() => {
  const lines = CANON.split('\n');
  const start = lines.indexOf('## S09: 模型导入 — 测试用例') + 1;
  return `## MODIFIED — S09: 模型导入 — 测试用例\n\n> 合并说明：本块整篇替换。\n${lines.slice(start).join('\n')}`;
})();
const ACCIDENT_UT01_LINE = ACCIDENT_DELTA.split('\n').findIndex(l => l.startsWith('| UT-S09-01 |')) + 1;
const SPLIT_DELTA = (() => {
  const blocks = [];
  let title = null;
  let body = [];
  const flushBlock = () => { if (title !== null) blocks.push(`## MODIFIED — ${title}\n\n${body.join('\n').trim()}\n`); };
  for (const line of CANON.split('\n')) {
    if (line.startsWith('## ')) { flushBlock(); title = line.slice(3); body = []; continue; }
    if (title !== null) body.push(line);
  }
  flushBlock();
  return blocks.join('\n');
})();
const CROSS_PARENT_TARGET = [
  '# 规格', '', '## 模块甲', '', '### 行为', '', '旧正文。', '', '## 模块乙', '', '### 事件与最终态交互', '',
  '| ID | 描述 |', '|---|---|', '| UT-S09-01 | 验证行为 |', '',
].join('\n');
const CROSS_PARENT_DELTA = '## MODIFIED — 模块甲 > 行为\n\n新正文。\n\n### 事件与最终态交互\n\n| ID | 描述 |\n|---|---|\n| UT-S09-02 | 验证行为 |\n';
const SAME_PARENT_TARGET = [
  '# 规格', '', '## 导言', '', '旧导言。', '', '## 单元测试', '', '| ID | 描述 |', '|---|---|', '| UT-S09-01 | 验证行为 |', '',
].join('\n');
const SAME_PARENT_DELTA = '## MODIFIED — 导言\n\n新导言。\n\n## 单元测试\n\n| ID | 描述 |\n|---|---|\n| UT-S09-02 | 验证行为 |\n';
const ROOT_REPEAT_TARGET = '# 规格\n\n## 一、单元测试用例\n\n| ID | 描述 |\n|---|---|\n| UT-S09-01 | 验证行为 |\n';
const ROOT_REPEAT_DELTA = '## MODIFIED — 一、单元测试用例 [1]\n## 一、单元测试用例\n| ID | 描述 |\n|---|---|\n| UT-S09-01 | 验证行为 |\n';
const wholeFileCreate = (target, ids) =>
  `## ADDED — ${target}（新文件，整文件）\n# S11 测试\n\n| ID | 描述 |\n|---|---|\n${ids.map(id => `| ${id} | 行为 |`).join('\n')}\n`;
const WHOLE_FILE_ROW_LINES = [6, 7];

const PROPOSAL_MD = [
  `# 变更提案：${PROPOSAL}`, '', '> module: core', '',
  '## 变更原因', '安装态 smoke 夹具：验证后态测试 ID 重复判据已进入全局 CLI。', '',
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
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-after-state-dup-'));
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
  return { status: r.status, pass: json.data.pass, violations: json.data.violations || [] };
}
const merge = (entry, base) => cliRaw(entry, base, ['merge', PROPOSAL], { OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY: '0' });
const idsOf = text => text.split('\n').map(l => /^\|\s*((?:UT|ST)-S\d{2}-\d+)\s*\|/.exec(l)?.[1]).filter(Boolean);
const headingsOf = text => text.split('\n').filter(l => /^#{1,6} /.test(l));
const readRel = (base, rel) => readFileSync(join(base, ...rel.split('/')), 'utf8');
const lintSummary = v => `${v.code}@${v.path}: ${String(v.message).slice(0, 200)}`;
const PUBLIC_KEYS = ['code', 'path', 'message', 'fix_hint'];

let candidate;
try { candidate = candidateIdentity(); } catch (error) { failAll(error instanceof Error ? error.message : String(error)); }
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
  failAll(`全局安装态 change-lint 未登记 ${CODE}（当前 ${globalVersion}）——入口仍指向旧版或安装未生效`,
    [`entry=${entry}`, `version=${globalVersion}`]);
}
if (globalVersion !== candidate.version) {
  failAll(`全局 --version（${globalVersion}）与本次冻结候选版本（${candidate.version}）不符`,
    [`entry=${entry}`, `version=${globalVersion}`, `candidate_version=${candidate.version}`]);
}

const scopes = [];
const baseEvidence = [`entry=${entry}`, `version=${globalVersion}`, `candidate_version=${candidate.version}`,
  `candidate_skill_sha256=${candidate.skillSha}`, INJECTED_ENTRY !== undefined ? 'mode=injected-self-test' : 'mode=global'];
const versionBefore = { entry, version: globalVersion };
function globalUntouched() {
  const e = commandLookup();
  const v = e ? cli(e, repoRoot, ['--version']).trim() : null;
  if (e !== versionBefore.entry || v !== versionBefore.version) {
    throw new Error(`全局入口或版本在矩阵执行期间发生变化：${versionBefore.entry}@${versionBefore.version} → ${e}@${v}`);
  }
}

// ── SMOKE-core-211：安装态身份与事故形态在 write-delta 节点闭环 ──
try {
  const problems = [];
  // ① 身份
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  if (pkg.version !== globalVersion) problems.push(`--version（${globalVersion}）与包 package.json（${pkg.version}）不一致`);
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'asset-manifest.json'), 'utf8'));
  if (manifest.version !== globalVersion) problems.push(`asset-manifest version（${manifest.version}）与 --version（${globalVersion}）不一致`);
  const assetLib = await import(pathToFileURL(join(pkgRoot, 'dist/lib/asset-manifest.js')).href);
  try { assetLib.validateAssetManifest(manifest, pkgRoot); } catch (e) { problems.push(`asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
  const packagedSkill = packagedSkillPath(pkgRoot);
  const packagedSkillBytes = readFileSync(packagedSkill);
  const packagedSkillSha = sha256(packagedSkillBytes);
  if (packagedSkillSha !== candidate.skillSha) problems.push(`随包 Skill（${packagedSkillSha}）与本次候选分发源（${candidate.skillSha}）不一致——安装的不是本次固定制品`);
  if (!packagedSkillBytes.toString('utf8').includes(SKILL_BOUNDARY_MARK)) problems.push(`随包 Skill 不含${SKILL_BOUNDARY_MARK}说明`);
  const localCopy = join(repoRoot, 'logos', SKILL_REL);
  const localCopySha = existsSync(localCopy) ? sha256(readFileSync(localCopy)) : 'missing';
  if (localCopySha !== packagedSkillSha) {
    const msg = `本仓 logos/${SKILL_REL}（${localCopySha}）与随包 Skill（${packagedSkillSha}）不一致——部署后须以新全局 CLI 执行 openlogos sync`;
    // 注入式自测（仓内 dist 尚未全局安装、本仓未 sync）只记录、不判失败；全局模式按规格硬断言。
    if (INJECTED_ENTRY === undefined) problems.push(msg); else baseEvidence.push(`injected_note=${msg}`);
  }
  if (problems.length > 0) throw new Error(problems.join('；'));

  // ② 事故形态 → lint 前移
  const p = newProposalProject(entry, 's211', scopes, { [TEST_DELTA]: ACCIDENT_DELTA }, { [TEST_TARGET]: CANON });
  const targetBefore = readRel(p, TEST_TARGET);
  const lint1 = lintJson(entry, p);
  const hit = lint1.violations.find(v => v.code === CODE);
  if (lint1.status !== 2 || lint1.pass !== false) problems.push(`事故形态 change-lint 应 exit 2 / pass=false，实际 exit ${lint1.status} / pass=${lint1.pass}`);
  if (!hit) problems.push(`事故形态 violations 不含 ${CODE}：${lint1.violations.map(lintSummary).join(' | ') || '（空）'}`);
  else {
    if (hit.path !== `logos/changes/${PROPOSAL}/${TEST_DELTA}`) problems.push(`path 应指向 delta，实际 ${hit.path}`);
    const msg = String(hit.message);
    if (!msg.includes('（合并后态行号）')) problems.push('message 缺「合并后态行号」标注');
    if (!msg.includes(`本 delta 第 ${ACCIDENT_UT01_LINE} 行`)) problems.push(`message 缺 delta 内行号（期望第 ${ACCIDENT_UT01_LINE} 行）：${msg.slice(0, 200)}`);
    if (!msg.includes('疑似整篇改写吞并兄弟章节')) problems.push('message 缺「疑似整篇改写吞并兄弟章节」提示');
    if (!String(hit.fix_hint).includes('## MODIFIED — <章节标题>')) problems.push('fix_hint 缺逐章节拆块指引');
    const keys = Object.keys(hit);
    if (keys.length !== PUBLIC_KEYS.length || PUBLIC_KEYS.some(k => !keys.includes(k))) problems.push(`公开键集合应为 ${PUBLIC_KEYS.join('/')}，实际 ${keys.join('/')}`);
  }
  // ③ 真实 merge 于预检出口拒绝
  const m1 = merge(entry, p);
  if (m1.status === 0) problems.push('事故形态 merge 应非零退出，实际 0');
  if (!String(m1.stderr).includes('change-lint 未通过')) problems.push(`merge stderr 缺「change-lint 未通过」：${String(m1.stderr).slice(0, 200)}`);
  if (!String(m1.stderr).includes(CODE)) problems.push(`merge stderr 缺 ${CODE}`);
  if (String(m1.stderr).includes('merge 失败（test-change-set-duplicate-id）')) problems.push('merge 仍在合成期以 test-change-set-duplicate-id 失败（前移未生效）');
  if (existsSync(join(p, 'logos/changes', PROPOSAL, 'SPEC_MERGED'))) problems.push('事故形态 merge 后出现 SPEC_MERGED');
  if (readRel(p, TEST_TARGET) !== targetBefore) problems.push('事故形态 merge 后目标字节发生变化');
  // ④ 拆块闭环
  writeRel(join(p, 'logos/changes', PROPOSAL), TEST_DELTA, SPLIT_DELTA);
  const lint2 = lintJson(entry, p);
  if (lint2.status !== 0 || lint2.pass !== true) problems.push(`拆块后 change-lint 应 PASS，实际 exit ${lint2.status}：${lint2.violations.map(lintSummary).join(' | ')}`);
  const m2 = merge(entry, p);
  if (m2.status !== 0) problems.push(`拆块后 merge 应退出 0，实际 ${m2.status}：${String(m2.stderr).slice(0, 200)}`);
  if (!existsSync(join(p, 'logos/changes', PROPOSAL, 'SPEC_MERGED'))) problems.push('拆块后 merge 未写出 SPEC_MERGED');
  const idsAfter = idsOf(readRel(p, TEST_TARGET));
  const idsBefore = idsOf(targetBefore);
  if (JSON.stringify(idsAfter) !== JSON.stringify(idsBefore)) problems.push(`拆块合并后 ID 集合变化：${idsBefore.join(',')} → ${idsAfter.join(',')}`);
  globalUntouched();
  if (problems.length > 0) throw new Error(problems.join('；'));
  record('SMOKE-core-211', 'pass',
    `安装态身份同源（${globalVersion}，manifest 自洽，随包 Skill 与候选分发源一致）；事故形态 lint exit 2 报 ${CODE} 且 merge 于预检出口拒绝；拆块后 lint PASS、merge 成功、ID 集合不变`,
    [...baseEvidence, `project=${p}`, `packaged_skill_sha256=${packagedSkillSha}`, `local_copy_sha256=${localCopySha}`,
      `accident_lint=${lint1.violations.map(lintSummary).join(' | ')}`, `accident_merge_stderr=${String(m1.stderr).split('\n')[0]}`]);
} catch (error) {
  record('SMOKE-core-211', 'fail', error instanceof Error ? error.message : String(error), baseEvidence);
}

// ── SMOKE-core-212：合法下沉写法不受影响、整文件纳入 ID 检查 ──
try {
  const problems = [];
  const legal = [
    ['P1 跨父链同名 H3', CROSS_PARENT_TARGET, CROSS_PARENT_DELTA, (after) => {
      const hs = headingsOf(after);
      if (!hs.includes('#### 事件与最终态交互')) return '合并后缺 H4「事件与最终态交互」';
      if (hs.filter(h => h === '### 事件与最终态交互').length !== 1) return '模块乙原 H3 未原样保留';
      if (idsOf(after).sort().join(',') !== 'UT-S09-01,UT-S09-02') return `ID 集合异常：${idsOf(after).join(',')}`;
      return null;
    }],
    ['P2 同父链同名不同 ID', SAME_PARENT_TARGET, SAME_PARENT_DELTA, (after) => {
      const hs = headingsOf(after);
      if (!hs.includes('### 单元测试') || !hs.includes('## 单元测试')) return '合并后应同时含 H3 与原 H2「单元测试」';
      if (idsOf(after).sort().join(',') !== 'UT-S09-01,UT-S09-02') return `ID 集合异常：${idsOf(after).join(',')}`;
      return null;
    }],
    ['P3 序数锚下正文重复根标题', ROOT_REPEAT_TARGET, ROOT_REPEAT_DELTA, (after) => {
      const hs = headingsOf(after);
      if (JSON.stringify(hs) !== JSON.stringify(['# 规格', '## 一、单元测试用例', '### 一、单元测试用例'])) return `标题层级异常：${hs.join(' / ')}`;
      if (idsOf(after).join(',') !== 'UT-S09-01') return `ID 集合异常：${idsOf(after).join(',')}`;
      return null;
    }],
  ];
  for (const [name, target, delta, check] of legal) {
    const p = newProposalProject(entry, name.slice(0, 2).toLowerCase(), scopes, { [TEST_DELTA]: delta }, { [TEST_TARGET]: target });
    const l = lintJson(entry, p);
    if (l.violations.some(v => v.code === CODE)) problems.push(`${name}：合法写法被判 ${CODE}（行为回归）`);
    if (l.status !== 0 || l.pass !== true) problems.push(`${name}：change-lint 应 PASS，实际 exit ${l.status}：${l.violations.map(lintSummary).join(' | ')}`);
    const m = merge(entry, p);
    if (m.status !== 0) { problems.push(`${name}：merge 应退出 0，实际 ${m.status}：${String(m.stderr).slice(0, 200)}`); continue; }
    const issue = check(readRel(p, TEST_TARGET));
    if (issue) problems.push(`${name}：${issue}`);
  }
  // P4 ② 合法整文件 CREATE payload 内重复 → 本码必报
  const p4 = newProposalProject(entry, 'p4', scopes, { [WHOLE_FILE_DELTA]: wholeFileCreate(WHOLE_FILE_TARGET, ['UT-S09-08', 'UT-S09-08']) }, {});
  const l4 = lintJson(entry, p4);
  const h4 = l4.violations.filter(v => v.code === CODE);
  if (h4.length !== 1) problems.push(`整文件 CREATE 内重复应恰报一条 ${CODE}，实际 ${h4.length}：${l4.violations.map(lintSummary).join(' | ')}`);
  else {
    if (h4[0].path !== `logos/changes/${PROPOSAL}/${WHOLE_FILE_DELTA}`) problems.push(`整文件 path 应指向该 delta，实际 ${h4[0].path}`);
    if (!String(h4[0].message).includes(`本 delta 第 ${WHOLE_FILE_ROW_LINES.join('、')} 行`)) problems.push(`整文件 message 应列两处 delta 内行号：${String(h4[0].message).slice(0, 200)}`);
    if (String(h4[0].message).includes('疑似整篇改写')) problems.push('整文件 delta 不应出现「疑似整篇改写」提示');
  }
  // P4 ③ 封装不合法 → 只报 non_markdown_delta_invalid
  writeRel(join(p4, 'logos/changes', PROPOSAL), WHOLE_FILE_DELTA, wholeFileCreate('logos/resources/test/other.md', ['UT-S09-08', 'UT-S09-08']));
  const l4b = lintJson(entry, p4);
  if (!l4b.violations.some(v => v.code === 'non_markdown_delta_invalid')) problems.push(`封装不合法应报 non_markdown_delta_invalid：${l4b.violations.map(lintSummary).join(' | ')}`);
  if (l4b.violations.some(v => v.code === CODE)) problems.push(`封装不合法的整文件不应报 ${CODE}`);
  // ④ 全局零触碰
  globalUntouched();
  if (problems.length > 0) throw new Error(problems.join('；'));
  record('SMOKE-core-212', 'pass',
    '跨父链同名 / 同父链同名不同 ID / 序数锚重复根标题三种合法下沉经全局 CLI lint PASS 且 merge 成功；整文件 CREATE 内重复报本码、封装不合法只报其自有码；全局入口与版本前后一致',
    [...baseEvidence, `p4=${p4}`, `whole_file_lint=${l4.violations.map(lintSummary).join(' | ')}`]);
} catch (error) {
  record('SMOKE-core-212', 'fail', error instanceof Error ? error.message : String(error), baseEvidence);
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = AFTER_STATE_DUP_SMOKE_IDS.filter(id => (results.get(id)?.status ?? 'fail') !== 'pass');
if (failed.length > 0) {
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
console.log(`smoke 通过：${AFTER_STATE_DUP_SMOKE_IDS.join(', ')}`);
