#!/usr/bin/env node
/**
 * SMOKE-core-223～SMOKE-core-225 — 0.15.19 两项行为的**安装态**取证（deploy-plan-gate-release-0-15-19）：
 * change-lint L5 部署方案覆盖判定（功能规格 §2.90），以及 `init` / `sync` 按 `locale` 写入项目
 * `.claude/settings.json` 的 `language`（功能规格 §2.89）。两项都只有装进全局 CLI 才对用户生效。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目与隔离 prefix 内，结束即删除；只读本机全局安装态（不安装 /
 * 卸载），不触碰本仓活跃提案、本仓 logos/resources/、用户其他仓库（包括 runlogos）与用户级 ~/.claude/settings.json；
 * 命令图中不出现任何公网发布命令。判据用行为断言：版本号相等只证明装了新包，不证明行为生效。
 *
 * 判据分两档（沿既有 runner 形态）：
 * - **本案安装验收窗口**（活跃提案为本 slug，或 OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE=1）：全局入口缺失、安装态包不含
 *   新行为、版本与本次冻结候选不符，一律写 **fail** 并非零退出。候选 / 回滚版本运行时读取
 *   `cli/src/lib/local-release-candidate.ts`（升版脚本写入），不写死版本字面量。
 * - **窗口之外**：本 runner 不适用，按既有留痕机制写 skip。
 * SMOKE-core-225 需要回滚制品构造旧版存量项目；制品缺失时该用例写显式 skip 并携带缺失项（skip 不计为通过）。
 *
 * **正式安装态模式**（缺省）：只认真实全局入口——按当前 PATH 查找 `openlogos`，其 realpath 必须落在
 * `npm prefix -g` 的全局包目录（`<prefix>/lib/node_modules/@miniidealab/openlogos/`）内；指向工作区（npm link）
 * 或一次性隔离 prefix 的入口一律判三条 fail，不得以仓内或隔离候选的运行结果冒充安装态证据（code 评审 F2）。
 *
 * **自测模式**（仅供 runner 自身验证，须同时满足）：
 *   OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_SELF_TEST=1  显式声明自测
 *   OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ENTRY        注入 CLI 入口（指向仓内 dist 或隔离 prefix）
 *   OPENLOGOS_SMOKE_RESULT_PATH                   独立结果账本，不得是项目正式 smoke 账本
 * 自测结果以 environment=self-test-injected-entry 写入独立账本；任一条件不满足即拒绝运行、零写入。
 * 其它：OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ROLLBACK 回滚制品路径（缺省 cli/rollback/miniidealab-openlogos-<回滚版本>.tgz）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const DEPLOY_PLAN_GATE_SMOKE_IDS = ['SMOKE-core-223', 'SMOKE-core-224', 'SMOKE-core-225'];
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const SLUG = 'deploy-plan-gate-release-0-15-19';
const PROPOSAL = 'smoke-deploy-plan';
const PLAN_DIR = 'logos/resources/prd/3-technical-plan/3-deployment';
const UNIQUE_TITLE = 'OpenLogos 9.9.1 发布方案（夹具）';
const PLAN_TASK = '- [ ] 产出 delta 文件到 `deltas/prd/3-technical-plan/3-deployment/core-01-deployment-plan.md` — 新增本次发布章节';
const CUSTOM_HINT = 'language 为自定义值';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const INJECTED_ENTRY = process.env.OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ENTRY;
const SELF_TEST = process.env.OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;

/** 项目正式 smoke 账本（logos.config.json 的 smoke.result_path，缺省 logos/resources/verify/smoke-results.jsonl）。 */
function formalResultPath() {
  let configured = null;
  try {
    configured = JSON.parse(readFileSync(join(repoRoot, 'logos/logos.config.json'), 'utf8')).smoke?.result_path ?? null;
  } catch { /* 用缺省 */ }
  return resolve(repoRoot, configured || 'logos/resources/verify/smoke-results.jsonl');
}

function refuse(reason) {
  console.error(`smoke runner 拒绝运行（未写入任何结果）：${reason}`);
  process.exit(2);
}

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: DEPLOY_PLAN_GATE_SMOKE_IDS,
    environment: FORMAL_ENVIRONMENT,
    self_test_environment: SELF_TEST_ENVIRONMENT,
    formal_entry: 'PATH 中的 openlogos，realpath 须在 npm prefix -g 的全局包目录内',
    applies_when: [`active change == ${SLUG}`, 'OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE=1'],
    candidate_version_source: 'cli/src/lib/local-release-candidate.ts',
    public_release_commands: [],
  }));
  process.exit(0);
}

const results = new Map();
const started = new Map();
const record = (id, status, detail, evidence = []) => results.set(id, { status, detail, evidence });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of DEPLOY_PLAN_GATE_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到（前序步骤已失败）', evidence: [] };
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: started.has(id) ? Date.now() - started.get(id) : 0,
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
// 子进程一律非交互：init 的建议忽略确认在无 TTY 时只输出命令、不写入。
const cliRaw = (entry, cwd, args) => run(cliBin(entry), cliArgs(entry, args), cwd);
const cli = (entry, cwd, args) => checked(cliRaw(entry, cwd, args), `openlogos ${args.join(' ')}`);
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

// 注入入口只在显式自测模式下可用，且自测结果不得进入项目正式账本（code 评审 F2）。
if (INJECTED_ENTRY !== undefined && !SELF_TEST) {
  refuse('设置了 OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ENTRY 但未声明自测（OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_SELF_TEST=1）；正式安装态 smoke 只认真实全局入口');
}
if (SELF_TEST && INJECTED_ENTRY === undefined) refuse('自测模式需要 OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ENTRY 指定注入入口');
if (SELF_TEST && resultPath === formalResultPath()) {
  refuse(`自测结果不得写入项目正式 smoke 账本 ${relative(repoRoot, resultPath)}；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本`);
}

function commandLookup() {
  if (SELF_TEST) {
    return INJECTED_ENTRY && existsSync(INJECTED_ENTRY) ? realpathSync(INJECTED_ENTRY) : null;
  }
  // 按调用方当前 PATH 查找（非 login shell）：smoke.command 由 openlogos smoke 以用户环境启动，PATH 即用户实际会用到的入口。
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-c', 'command -v openlogos']);
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

/** 正式模式：入口 realpath 必须在全局 npm prefix 的包目录内（排除 workspace link 与一次性隔离 prefix）。 */
function globalInstallProblem(entryPath) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = run(npm, ['prefix', '-g']);
  if (r.status !== 0 || !r.stdout.trim()) return `无法读取 npm prefix -g：${(r.stderr || '').slice(0, 200)}`;
  const prefix = realpathSync(r.stdout.trim());
  const nodeModules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  const pkgDir = join(nodeModules, '@miniidealab', 'openlogos');
  const within = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  // 可信边界是全局 node_modules 区域本身，而不是包目录解引用后的位置（code 评审 r2 F2）：
  // 包目录本身是链接（npm link 等指向某个工作区）或解引用后离开该区域，都不构成安装态证据。
  if (lstatSync(pkgDir).isSymbolicLink()) {
    return `全局包目录 ${pkgDir} 是指向 ${realpathSync(pkgDir)} 的链接（workspace link 不构成安装态证据）`;
  }
  const realNodeModules = realpathSync(nodeModules);
  const realPkgDir = realpathSync(pkgDir);
  if (!within(realNodeModules, realPkgDir)) {
    return `全局包目录 ${pkgDir} 解引用后为 ${realPkgDir}，已离开全局 node_modules 区域 ${realNodeModules}`;
  }
  if (!within(realPkgDir, entryPath)) {
    return `入口 ${entryPath} 不在全局 npm prefix 的包目录 ${pkgDir} 内（工作区链接或隔离 prefix 不构成安装态证据）`;
  }
  if (within(repoRoot, entryPath)) return `入口 ${entryPath} 位于工作区 ${repoRoot} 内`;
  return null;
}

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (activeChange() !== SLUG && process.env.OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE !== '1') {
  exitNotApplicable(DEPLOY_PLAN_GATE_SMOKE_IDS, {
    reason: `非本案安装验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

function releaseVersions() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
  const cand = /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text);
  const back = /LOCAL_RELEASE_ROLLBACK_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text);
  if (!cand) throw new Error(`无法读取候选版本（${src} 缺失或无 LOCAL_RELEASE_CANDIDATE_VERSION）`);
  return { candidate: cand[1], rollback: back ? back[1] : null };
}

function failAll(reason, evidence = []) {
  for (const id of DEPLOY_PLAN_GATE_SMOKE_IDS) record(id, 'fail', reason, evidence);
  flush();
  console.error(`smoke 失败：${DEPLOY_PLAN_GATE_SMOKE_IDS.join(', ')}：${reason}`);
  process.exit(1);
}

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-deploy-plan-${tag}-`));
  scopes.push(dir);
  return dir;
}

let versions;
try { versions = releaseVersions(); } catch (error) { failAll(error instanceof Error ? error.message : String(error)); }
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
const baseEvidence = [`entry=${entry}`, `version=${globalVersion}`, `candidate_version=${versions.candidate}`,
  SELF_TEST ? 'mode=injected-self-test' : 'mode=global'];
if (!SELF_TEST) {
  const problem = globalInstallProblem(entry);
  if (problem) failAll(problem, baseEvidence);
}
const versionBefore = { entry, version: globalVersion };
function globalUntouched() {
  const e = commandLookup();
  const v = e ? cli(e, repoRoot, ['--version']).trim() : null;
  if (e !== versionBefore.entry || v !== versionBefore.version) {
    throw new Error(`全局入口或版本在执行期间发生变化：${versionBefore.entry}@${versionBefore.version} → ${e}@${v}`);
  }
}

// ── 临时项目夹具 ──
const PLAN_FIXTURE = [
  '# core-01-deployment-plan', '',
  '## OpenLogos 9.9.0 发布方案（夹具旧版本）', '', '### 本机全局部署', '旧版本步骤。', '',
  `## ${UNIQUE_TITLE}`, '', '### 本机全局部署', '本版本步骤。', '',
].join('\n');

function proposalMd({ deploy = '是', reference = null } = {}) {
  return [
    `# 变更提案：${PROPOSAL}`, '', '> module: core', '',
    '## 变更原因', '安装态 smoke 夹具：验证 L5 部署方案覆盖判定已进入全局 CLI。', '',
    '## 变更类型', '设计级', '',
    '## 变更范围', '- 影响的功能规格：core-01', '',
    '## 部署影响', `- 是否需要部署：${deploy}`, '- 部署原因：smoke 夹具', '- 影响环境：本地',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否',
    ...(reference ? [`- 部署方案依据：${reference}`] : []), '',
    '## UI/UX 变更声明', '', '```yaml', 'ui_impact: false', 'design_system_mode: generated',
    'design_system_fallback_reason: ""', 'pages: []', '```', '',
    '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete',
    'impacts:', '  data:', '    status: none', '    reason: smoke 夹具不涉及数据影响',
    '  compatibility:', '    status: none', '    reason: smoke 夹具不涉及兼容性影响',
    '  security_privacy:', '    status: none', '    reason: smoke 夹具不涉及安全或隐私影响',
    '  public_release:', '    status: none', '    reason: smoke 夹具不涉及公开发布',
    '  external_commitment:', '    status: none', '    reason: smoke 夹具不涉及外部承诺',
    'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
    '## 变更概述', '纯文档更新，无需代码。', '',
  ].join('\n');
}

function tasksMd({ planTask = false, deploySection = true } = {}) {
  return ['# 实现任务', '', '## [delta] 规格变更', '- [ ] 产出 delta 到 `deltas/test/core-S99-test-cases.md` — 新增用例',
    ...(planTask ? [PLAN_TASK] : []), '', '## [code] 代码实现', '',
    ...(deploySection ? ['## [deploy] 发布', '- [ ] 按部署方案发布', ''] : [])].join('\n');
}

function newLaunchedProject(entryPath, tag, locale = 'zh') {
  const base = newTempDir(tag);
  cli(entryPath, base, ['init', tag, '--locale', locale, '--ai-tool', 'claude-code']);
  return base;
}

function lintJson(entryPath, base) {
  const r = cliRaw(entryPath, base, ['change-lint', '--slug', PROPOSAL, '--format', 'json']);
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* 下方按 null 处理 */ }
  if (!json || !json.data) throw new Error(`change-lint --format json 输出不可解析（exit ${r.status}）：${(r.stderr || r.stdout || '').slice(0, 200)}`);
  return { status: r.status, codes: (json.data.violations || []).map(v => v.code) };
}

// ── SMOKE-core-223：安装态版本与制品身份 ──
started.set('SMOKE-core-223', Date.now());
try {
  const problems = [];
  if (globalVersion !== versions.candidate) problems.push(`全局 --version（${globalVersion}）与本次冻结候选版本（${versions.candidate}）不符`);
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'asset-manifest.json'), 'utf8'));
  const assetLib = await import(pathToFileURL(join(pkgRoot, 'dist/lib/asset-manifest.js')).href);
  try { assetLib.validateAssetManifest(manifest, pkgRoot); } catch (e) { problems.push(`asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
  // manifest 按分组（skills / templates / schemas / plugins）登记资产。
  const i18nEntry = ['skills', 'templates', 'schemas', 'plugins'].flatMap(g => manifest[g] || []).find(a => a.path === 'dist/i18n.js');
  const i18nPath = join(pkgRoot, 'dist/i18n.js');
  if (!i18nEntry) problems.push('asset-manifest 无 dist/i18n.js 条目');
  else if (i18nEntry.sha256 !== sha(i18nPath)) problems.push('dist/i18n.js 的 SHA-256 与 manifest 条目不一致');
  const init = await import(pathToFileURL(join(pkgRoot, 'dist/commands/init.js')).href);
  if (typeof init.mergeClaudeLanguageSetting !== 'function') problems.push('dist/commands/init.js 未导出 mergeClaudeLanguageSetting');
  if (JSON.stringify(init.CLAUDE_LANGUAGE_BY_LOCALE) !== JSON.stringify({ zh: 'chinese', en: 'english' })) {
    problems.push(`CLAUDE_LANGUAGE_BY_LOCALE 不符：${JSON.stringify(init.CLAUDE_LANGUAGE_BY_LOCALE)}`);
  }
  const lifecycle = await import(pathToFileURL(join(pkgRoot, 'dist/lib/proposal-lifecycle.js')).href);
  if (typeof lifecycle.evaluateDeploymentPlanCoverage !== 'function') problems.push('dist/lib/proposal-lifecycle.js 未导出 evaluateDeploymentPlanCoverage');
  if (!readFileSync(i18nPath, 'utf8').includes('init.claudeLanguageCustom')) problems.push('dist/i18n.js 缺 init.claudeLanguageCustom 文案');
  if (problems.length > 0) throw new Error(problems.join('；'));
  record('SMOKE-core-223', 'pass', `安装态身份同源（${globalVersion}，manifest 自洽，language 写入与部署方案覆盖判定均在包内）`,
    [...baseEvidence, `pkg_root=${pkgRoot}`, `i18n_sha256=${sha(i18nPath)}`]);
} catch (error) {
  record('SMOKE-core-223', 'fail', error instanceof Error ? error.message : String(error), baseEvidence);
}

// ── SMOKE-core-224：安装态 change-lint L5 部署方案覆盖 ──
started.set('SMOKE-core-224', Date.now());
try {
  const problems = [];
  const base = newLaunchedProject(entry, 's224');
  const yamlPath = join(base, 'logos/logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  cli(entry, base, ['change', PROPOSAL]);
  const dir = join(base, 'logos/changes', PROPOSAL);
  mkdirSync(join(base, PLAN_DIR), { recursive: true });
  writeFileSync(join(base, PLAN_DIR, 'core-01-deployment-plan.md'), PLAN_FIXTURE);
  const step = (label, proposal, tasks, expectStatus, expectCode) => {
    writeFileSync(join(dir, 'proposal.md'), proposal);
    writeFileSync(join(dir, 'tasks.md'), tasks);
    const r = lintJson(entry, base);
    if (r.status !== expectStatus) problems.push(`${label} 应 exit ${expectStatus}，实际 ${r.status}（${r.codes.join(',') || '无违规'}）`);
    if (expectCode && !r.codes.includes(expectCode)) problems.push(`${label} violations 不含 ${expectCode}（${r.codes.join(',') || '空'}）`);
    return r;
  };
  step('① 缺部署方案', proposalMd(), tasksMd(), 2, 'deployment_plan_missing');
  step('② [delta] 部署方案任务', proposalMd(), tasksMd({ planTask: true }), 0, null);
  step('③ 唯一章节引用', proposalMd({ reference: UNIQUE_TITLE }), tasksMd(), 0, null);
  step('④ 多处命中的引用', proposalMd({ reference: '本机全局部署' }), tasksMd(), 2, 'deployment_plan_reference_unresolved');
  const r5 = step('⑤ 无需部署', proposalMd({ deploy: '否' }), tasksMd({ deploySection: false }), 0, null);
  if (r5.codes.some(c => /deploy/.test(c))) problems.push(`⑤ 仍有部署相关违规：${r5.codes.join(',')}`);
  writeFileSync(join(dir, 'proposal.md'), proposalMd());
  writeFileSync(join(dir, 'tasks.md'), tasksMd());
  const next = cliRaw(entry, base, ['next', '--format', 'json']);
  const step6 = JSON.parse(next.stdout || '{}').data?.proposal_step ?? null;
  if (step6 === 'ready-to-delta') problems.push('⑥ 缺部署方案时 next 仍给出 ready-to-delta');
  globalUntouched();
  if (problems.length > 0) throw new Error(problems.join('；'));
  record('SMOKE-core-224', 'pass', '安装态 L5：缺部署方案报 deployment_plan_missing；[delta] 任务与唯一章节引用均通过；多处命中报 deployment_plan_reference_unresolved；无需部署不受影响；next 不给出 ready-to-delta；全局入口与版本不变',
    [...baseEvidence, `project=${base}`, `next_proposal_step=${step6}`]);
} catch (error) {
  record('SMOKE-core-224', 'fail', error instanceof Error ? error.message : String(error), baseEvidence);
}

// ── SMOKE-core-225：安装态 init / sync 写入 language ──
started.set('SMOKE-core-225', Date.now());
function installRollback(tarball) {
  const prefix = newTempDir('rollback-prefix');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  checked(run(npm, ['install', '-g', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--prefer-offline', tarball], prefix),
    `隔离 prefix 安装回滚制品 ${tarball}`);
  const bin = process.platform === 'win32' ? join(prefix, 'openlogos.cmd') : join(prefix, 'bin', 'openlogos');
  if (!existsSync(bin)) throw new Error(`隔离 prefix 中未找到 openlogos 入口：${bin}`);
  return realpathSync(bin);
}
const settingsOf = base => join(base, '.claude/settings.json');
const readSettings = base => JSON.parse(readFileSync(settingsOf(base), 'utf8'));
const writeSettings = (base, obj) => writeFileSync(settingsOf(base), JSON.stringify(obj, null, 2));
const withoutLanguage = s => { const { language: _l, ...rest } = s; return rest; };
try {
  const rollbackTarball = process.env.OPENLOGOS_DEPLOY_PLAN_GATE_SMOKE_ROLLBACK
    || (versions.rollback ? join(repoRoot, 'cli/rollback', `miniidealab-openlogos-${versions.rollback}.tgz`) : null);
  if (!rollbackTarball || !existsSync(rollbackTarball)) {
    const missing = rollbackTarball ? relative(repoRoot, rollbackTarball).replace(/\\/g, '/') : 'LOCAL_RELEASE_ROLLBACK_VERSION';
    record('SMOKE-core-225', 'skip', `缺回滚制品，无法构造旧版存量项目 P3：${missing}`, [...baseEvidence, `missing=${missing}`]);
  } else {
    const problems = [];
    const ev = [...baseEvidence, `rollback_tarball=${rollbackTarball}`, `rollback_sha256=${sha(rollbackTarball)}`];
    // ① ② 新建项目
    const p1 = newLaunchedProject(entry, 'p1', 'zh');
    if (readSettings(p1).language !== 'chinese') problems.push(`① zh init 后 language 应为 chinese，实际 ${JSON.stringify(readSettings(p1).language)}`);
    const p2 = newLaunchedProject(entry, 'p2', 'en');
    if (readSettings(p2).language !== 'english') problems.push(`② en init 后 language 应为 english，实际 ${JSON.stringify(readSettings(p2).language)}`);
    // P3：回滚制品 init 的旧版存量项目 + 用户条目 + settings.local.json
    const oldEntry = installRollback(rollbackTarball);
    const p3 = newTempDir('p3');
    cli(oldEntry, p3, ['init', 'p3', '--locale', 'zh', '--ai-tool', 'claude-code']);
    const old = readSettings(p3);
    if ('language' in old) problems.push('P3 旧版 init 已含 language——回滚制品不是发布前内容，矩阵空转');
    const userEntry = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-pre' }] };
    old.hooks.PreToolUse = [userEntry, ...(old.hooks.PreToolUse || [])];
    const preset = { permissions: { allow: ['Bash(npm test:*)'], deny: [] }, ...old };
    writeSettings(p3, preset);
    const localPath = join(p3, '.claude/settings.local.json');
    writeFileSync(localPath, JSON.stringify({ language: 'japanese' }, null, 2));
    const localSha = sha(localPath);
    // ③ sync 写入
    const s3 = cliRaw(entry, p3, ['sync']);
    const after3 = readSettings(p3);
    if (s3.status !== 0) problems.push(`③ sync 退出码 ${s3.status}`);
    if (after3.language !== 'chinese') problems.push(`③ sync 后 language 应为 chinese，实际 ${JSON.stringify(after3.language)}`);
    if (JSON.stringify(withoutLanguage(after3).permissions) !== JSON.stringify(preset.permissions)) problems.push('③ permissions 被改动');
    if (JSON.stringify(after3.hooks.PreToolUse[0]) !== JSON.stringify(userEntry)) problems.push('③ 用户自有 PreToolUse 条目位置或内容被改动');
    // ④ 幂等
    const bytes3 = sha(settingsOf(p3));
    cliRaw(entry, p3, ['sync']);
    if (sha(settingsOf(p3)) !== bytes3) problems.push('④ 连续第二次 sync 改动了 .claude/settings.json');
    // ⑤ 自定义值保留并提示
    writeSettings(p3, { ...readSettings(p3), language: 'japanese' });
    const s5 = cliRaw(entry, p3, ['sync']);
    if (readSettings(p3).language !== 'japanese') problems.push('⑤ 自定义值 japanese 被覆盖');
    const hints = (s5.stdout || '').split('\n').filter(l => l.includes(CUSTOM_HINT));
    if (hints.length !== 1) problems.push(`⑤ 自定义值提示应恰 1 行，实际 ${hints.length}`);
    if (s5.status !== 0) problems.push(`⑤ sync 退出码 ${s5.status}`);
    // ⑥ locale 切换后托管值跟随
    const cfgPath = join(p3, 'logos/logos.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    writeFileSync(cfgPath, JSON.stringify({ ...cfg, locale: 'en' }, null, 2));
    writeSettings(p3, { ...readSettings(p3), language: 'chinese' });
    cliRaw(entry, p3, ['sync']);
    if (readSettings(p3).language !== 'english') problems.push(`⑥ locale 改为 en 后 language 应为 english，实际 ${JSON.stringify(readSettings(p3).language)}`);
    // ⑦ 非法 JSON 原样保留
    writeFileSync(settingsOf(p3), '{ "hooks": ');
    const brokenSha = sha(settingsOf(p3));
    const s7 = cliRaw(entry, p3, ['sync']);
    if (sha(settingsOf(p3)) !== brokenSha) problems.push('⑦ 非法 JSON 的 .claude/settings.json 被改写');
    if (s7.status !== 0) problems.push(`⑦ sync 退出码 ${s7.status}`);
    if (sha(localPath) !== localSha) problems.push('.claude/settings.local.json 被改动');
    globalUntouched();
    if (problems.length > 0) throw new Error(problems.join('；'));
    record('SMOKE-core-225', 'pass', '安装态 language：zh / en init 写入对应值；旧版存量项目 sync 补写且其它字段与用户条目不变；二次 sync 字节不变；自定义值保留并提示一行；locale 切换后跟随；非法 JSON 与 settings.local.json 原样保留',
      [...ev, `p1=${p1}`, `p2=${p2}`, `p3=${p3}`, `rollback_entry=${oldEntry}`]);
  }
} catch (error) {
  record('SMOKE-core-225', 'fail', error instanceof Error ? error.message : String(error), baseEvidence);
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = DEPLOY_PLAN_GATE_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail' || !results.has(id));
if (failed.length > 0) {
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
const skipped = DEPLOY_PLAN_GATE_SMOKE_IDS.filter(id => results.get(id)?.status === 'skip');
console.log(`smoke 通过：${DEPLOY_PLAN_GATE_SMOKE_IDS.filter(id => !skipped.includes(id)).join(', ')}${skipped.length ? `；skip：${skipped.join(', ')}` : ''}`);
