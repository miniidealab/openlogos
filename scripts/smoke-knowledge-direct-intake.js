#!/usr/bin/env node
/**
 * SMOKE-core-321～SMOKE-core-323 — 0.16.18 企业知识直接录入的**安装态**取证（提案 knowledge-direct-intake）：
 * 场景 S45「S45：企业知识沉淀与场景引用」Step 12～19，功能规格 §2.103。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.18 企业知识直接录入安装态 smoke（SMOKE-core-321～323）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.18 本机测试环境发布（knowledge-direct-intake）」。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *
 *   - SMOKE-core-321：安装态版本与制品身份（payloadHash 自洽；--help 列出 knowledge 六个子命令；包内 Skill 与规范为新口径；
 *     全局 init + change 生成的提案骨架含 deltas/knowledge/）。
 *   - SMOKE-core-322：显式 guard.exempt: [] 的无提案项目中，全局 CLI 从项目外候选目录录入成功；不合规批次零写入。
 *   - SMOKE-core-323：全局 CLI 的 knowledge list / show / refs / index / check、词表丢失三态与 L10 引用。
 *
 * 临时项目一律经被测 CLI `init` 建立后写入夹具，候选目录另建在项目根之外；全局 CLI 以入口绝对路径经子进程调用（时限 120 秒，
 * 超时判失败、不重试）。全部写入只在一次性目录内，结束即删除；对全局安装态只读，不读写本仓 logos/resources/（结果账本除外）。
 *
 * **窗口**：活跃变更为 knowledge-direct-intake，或 OPENLOGOS_KDI_SMOKE=1；窗口外为全部 owned ID 写 skip（不声明 target_environment）。
 * **适用性**（缺即显式 skip）：候选版本（local-release-candidate.ts）不早于 0.16.18；部署记录记载候选版本。
 * **自测模式**（须同时满足）：OPENLOGOS_KDI_SMOKE_SELF_TEST=1、OPENLOGOS_KDI_SMOKE_ENTRY（候选入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置与版本下限，结果以 environment=self-test-injected-entry 写入；
 * 入口位于开发布局（cli/dist）时，包内 Skill 与规范取仓库根的 skills/、spec/。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'knowledge-direct-intake';
const OWNED = ['SMOKE-core-321', 'SMOKE-core-322', 'SMOKE-core-323'];
const MIN_VERSION = '0.16.18';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const CLI_TIMEOUT_MS = 120_000;

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_KDI_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, args, cwd = repoRoot, extra = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, ...extra });
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

function refuse(reason) {
  console.error(`smoke runner 拒绝运行（未写入任何结果）：${reason}`);
  process.exit(2);
}
function formalResultPath() {
  let configured = null;
  try { configured = JSON.parse(readFileSync(join(repoRoot, 'logos/logos.config.json'), 'utf8')).smoke?.result_path ?? null; } catch { /* 缺省 */ }
  return resolve(repoRoot, configured || 'logos/resources/verify/smoke-results.jsonl');
}
function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}
function candidateVersion() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
  return /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null;
}
function versionAtLeast(version, min) {
  const parse = v => (/^(\d+)\.(\d+)\.(\d+)/.exec(v ?? '') ?? []).slice(1).map(Number);
  const a = parse(version); const b = parse(min);
  if (a.length !== 3) return false;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}
function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

if (!SELF_TEST && process.env.OPENLOGOS_KDI_SMOKE_ENTRY !== undefined) {
  refuse('设置了 OPENLOGOS_KDI_SMOKE_ENTRY 但未声明自测（OPENLOGOS_KDI_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && !process.env.OPENLOGOS_KDI_SMOKE_ENTRY) refuse('自测模式需要 OPENLOGOS_KDI_SMOKE_ENTRY');
/** 比较账本路径前先解析真实路径（tmpdir 等常位于 symlink 之后，如 macOS /var → /private/var）。 */
function realOrSelf(p) {
  try { return join(realpathSync(dirname(p)), basename(p)); } catch { return p; }
}
if (SELF_TEST && realOrSelf(resultPath) === realOrSelf(formalResultPath())) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_KDI_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_KDI_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_KDI_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-kdi-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_KDI_')) delete env[key];
    if (key.startsWith('OPENLOGOS_VERIFY_') || key === 'OPENLOGOS_STDIO_TRACE') delete env[key];
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDE_PROJECT_DIR'].includes(key)) delete env[key];
    if (key === 'OPENLOGOS_INTERNAL_LEGACY_MERGE_APPLY' || key.startsWith('OPENLOGOS_GUARD_')) delete env[key];
  }
  return { ...env, ...extra };
}
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return r.stdout.trim();
}
/** 以子进程调用被测 CLI，时限 120 秒；超时直接判失败（不重试）。不因非零退出抛错（用例自己断言退出码）。 */
function cli(entry, root, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd: root, encoding: 'utf8', env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home'), ...extraEnv }),
    timeout: CLI_TIMEOUT_MS, input: '', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error?.code === 'ETIMEDOUT' || r.signal) {
    throw new Error(`全局 CLI ${args.join(' ')} 超过 ${CLI_TIMEOUT_MS / 1000} 秒未返回（signal=${r.signal ?? 'none'}），判失败、不重试`);
  }
  return r;
}
function lintJson(entry, root, slug) {
  const r = cli(entry, root, ['change-lint', '--slug', slug, '--format', 'json']);
  const line = (r.stdout || '').split('\n').map(l => l.trim()).filter(l => l.startsWith('{')).pop();
  if (!line) throw new Error(`change-lint 没有输出 JSON envelope（exit ${r.status}）：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return { status: r.status, data: JSON.parse(line).data };
}
function gitInit(root) {
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'openlogos-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
}
function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
}
/** 项目全部文件（不含 .git）的字节快照，用于零写入取证。 */
function snapshot(root) {
  const out = new Map();
  const walk = d => {
    for (const name of readdirSync(d)) {
      if (name === '.git') continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs); else out.set(relative(root, abs), sha256(readFileSync(abs)));
    }
  };
  walk(root);
  return out;
}
const sameSnapshot = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

// ── 夹具 ──────────────────────────────────────────────────────────────────────
const KDIR = 'logos/resources/knowledge';
const SRCDIR = 'logos/resources/reference/knowledge';
const SCEN = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
const CHANGE = 'kdi-smoke';
const REGISTRY = 'project:\n  name: "kdi-smoke"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 46\nresource_index: []\n';
const CLARIFICATION = '## 决策澄清\n\n```yaml\nschema: openlogos/clarification@1\nmode: adaptive\nstatus: complete\nimpacts:\n  data: {status: none, reason: smoke}\n  compatibility: {status: none, reason: smoke}\n  security_privacy: {status: none, reason: smoke}\n  public_release: {status: none, reason: smoke}\n  external_commitment: {status: none, reason: smoke}\ndecisions: []\nunresolved: []\ndefaults: []\n```\n';
const PROPOSAL = '# 变更提案：kdi smoke\n\n## 变更原因\n安装态 smoke 夹具。\n\n## 变更类型\n需求级\n\n## 变更范围\n- 影响的功能规格：smoke\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 变更概述\n概述。\n\n' + CLARIFICATION;
const BASE_DOCS = {
  'logos/resources/prd/1-product-requirements/core-01-requirements.md': ['# 需求\n\n## 一、判据\n\n旧正文。\n', '## MODIFIED — 一、判据\n\n新正文。\n'],
  'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md': ['# 规格\n\n## 一、判据\n\n旧正文。\n', '## MODIFIED — 一、判据\n\n新正文。\n'],
  'logos/resources/test/core-S01-test-cases.md': ['# 用例\n\n## 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |\n', '## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |\n'],
};

function entry(id, name, { tags = ['退款'], source = 'refund-v3.md', rules } = {}) {
  const meta = ['type: "rule"', 'scope: "module"', 'module: "core"', `tags: ${JSON.stringify(tags)}`, 'status: "active"'];
  if (source) meta.push(`source: [{"path": "${SRCDIR}/${source}", "version": "v3"}]`);
  const lines = [`# ${id}：${name}`, '', '## 元数据', '', '```yaml', ...meta, '```', ''];
  const rs = rules ?? [[`${id}-R1`, '单笔退款大于 5000 元需财务二审', 'active']];
  lines.push('## 规则', '', '| ID | 规则 | 状态 | 例外 |', '|---|---|---|---|');
  for (const [rid, text, st] of rs) lines.push(`| ${rid} | ${text} | ${st} | 无 |`);
  lines.push('', '## 说明', '', `${name}的背景说明。`, '');
  return lines.join('\n');
}
const wholeFile = (target, body) => `## ADDED — ${target}（新文件，整文件）\n${body}`;
function scenarioDoc(id, refs) {
  return [`# ${id}：退款`, '', '## 场景目标', '', '完成退款。', '', '## 时序图', '', 'Step 1：提交退款。', '',
    '## 适用业务约束', '', '| 引用 | 作用位置 | 说明 | 例外 |', '|---|---|---|---|',
    ...refs.map(r => `| ${r} | Step 1 | 约束 | 无 |`), '', '## 异常与边界', '', '无。', ''].join('\n');
}
function knowledgeJson(entryPath, root, args) {
  const r = cli(entryPath, root, ['knowledge', ...args, '--format', 'json']);
  const line = (r.stdout || '').split('\n').map(l => l.trim()).filter(l => l.startsWith('{')).pop();
  if (!line) throw new Error(`knowledge ${args.join(' ')} 没有输出 JSON envelope（exit ${r.status}）：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return { status: r.status, data: JSON.parse(line).data };
}
/** 项目根之外的一次性候选目录。 */
function candidateDir(tag, files) {
  const d = realpathSync(tempDir(`cand-${tag}`));
  for (const [rel, content] of Object.entries(files)) put(d, rel, content);
  return d;
}
/** 经被测 CLI init 建立的 launched 项目：显式 guard.exempt: []、无活跃提案、一份已落盘场景引用 K01-R1。 */
function intakeProject(entryPath, tag) {
  const root = realpathSync(tempDir(tag));
  const init = cli(entryPath, root, ['init', 'kdi-smoke', '--locale', 'zh', '--ai-tool', 'other']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || init.stdout || '').slice(0, 400)}`);
  put(root, 'logos/logos-project.yaml', REGISTRY);
  const configPath = join(root, 'logos/logos.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.guard = { ...(config.guard ?? {}), exempt: [] };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  put(root, `${SCEN}/core-S50-refund.md`, scenarioDoc('S50', ['K01-R1']));
  rmSync(join(root, 'logos/.openlogos-guard'), { force: true });
  gitInit(root);
  commitAll(root, 'fixture');
  return root;
}
function seedK01(entryPath, root) {
  const cand = candidateDir('seed', { 'core-K01-refund.md': entry('K01', '退款审批规则'), 'sources/refund-v3.md': '# 退款制度 v3\n' });
  return knowledgeJson(entryPath, root, ['apply', cand]);
}

const CASES = {
  'SMOKE-core-321': async (entryPath) => {
    const problems = [];
    const evidence = [`entry_realpath=${entryPath}`];
    // ① 版本与入口
    const version = (run(process.execPath, [entryPath, '--version']).stdout || '').trim();
    const candidate = SELF_TEST ? version : candidateVersion();
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (version !== candidate) problems.push(`① --version 为 ${version}，部署记录候选版本为 ${candidate}`);
    if (!SELF_TEST && !versionAtLeast(version, MIN_VERSION)) problems.push(`① --version ${version} 早于 ${MIN_VERSION}`);
    // ② payloadHash 自洽
    const pkg = packageRoot(entryPath);
    if (!pkg) throw new Error(`无法从 ${entryPath} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`package_root=${pkg}`, `payload_hash=${manifest.payloadHash}`);
    try {
      const lib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
      lib.validateAssetManifest(manifest, pkg);
    } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    // ③ knowledge 子命令
    const help = run(process.execPath, [entryPath, 'knowledge', '--help']).stdout || '';
    const helpLine = help.split('\n').filter(l => /knowledge|apply|refs/.test(l)).join(' ');
    for (const sub of ['apply', 'index', 'check', 'list', 'show', 'refs']) {
      if (!new RegExp(`\\b${sub}\\b`).test(helpLine)) problems.push(`③ --help 未列出 knowledge ${sub}`);
    }
    // ④ 包内 Skill 与规范（开发布局自测时取仓库根）
    const assetsRoot = existsSync(join(pkg, 'skills')) ? pkg : (SELF_TEST ? repoRoot : pkg);
    const skill = join(assetsRoot, 'skills/change-writer/SKILL.md');
    const spec = join(assetsRoot, 'spec/directory-convention.md');
    if (!existsSync(skill) || !readFileSync(skill, 'utf8').includes('knowledge apply')) problems.push('④ 包内 change-writer SKILL.md 不含「knowledge apply」');
    const specText = existsSync(spec) ? readFileSync(spec, 'utf8') : '';
    if (!specText.includes('TAGS.md') || !specText.includes('INDEX.md')) problems.push('④ 包内 spec/directory-convention.md 不含 TAGS.md / INDEX.md');
    // ⑤ init + change 骨架
    const root = realpathSync(tempDir('init'));
    const init = cli(entryPath, root, ['init', 'kdi-init', '--locale', 'zh', '--ai-tool', 'other']);
    if (init.status !== 0) problems.push(`⑤ init 失败：exit ${init.status}`);
    put(root, 'logos/logos-project.yaml', REGISTRY);
    const change = cli(entryPath, root, ['change', 'demo']);
    evidence.push(`change_status=${change.status}`);
    if (!existsSync(join(root, 'logos/changes/demo/deltas/knowledge'))) problems.push(`⑤ 提案骨架缺 deltas/knowledge/（change exit ${change.status}）`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装态版本与候选一致、payloadHash 自洽；--help 列出 knowledge 六个子命令；包内 Skill 与规范为新口径；提案骨架含 deltas/knowledge/', evidence };
  },

  'SMOKE-core-322': async (entryPath) => {
    const problems = [];
    const evidence = [];
    const root = intakeProject(entryPath, 'intake');
    const configBefore = readFileSync(join(root, 'logos/logos.config.json'), 'utf8');
    const a = seedK01(entryPath, root);
    evidence.push(`apply_a_status=${a.status}`, `written=${(a.data?.written ?? []).join('|')}`);
    const expected = [`${SRCDIR}/refund-v3.md`, `${KDIR}/core-K01-refund.md`, `${KDIR}/TAGS.md`, `${KDIR}/.tags-enabled`, `${KDIR}/INDEX.md`];
    if (a.status !== 0) problems.push(`① apply 退出码 ${a.status}：${JSON.stringify(a.data?.errors ?? [])}`);
    for (const p of expected) if (!(a.data?.written ?? []).includes(p)) problems.push(`① written 缺 ${p}`);
    if (existsSync(join(root, 'logos/.openlogos-guard'))) problems.push('① 项目中出现了 logos/.openlogos-guard（不应立案）');
    const before = snapshot(root);
    const candB = candidateDir('bad', { 'core-K02-settle.md': entry('K02', '结算规则', { tags: ['售后'], source: null }) });
    const b = knowledgeJson(entryPath, root, ['apply', candB]);
    const codes = (b.data?.errors ?? []).map(e => e.code);
    evidence.push(`apply_b_status=${b.status}`, `apply_b_codes=${codes.join('|')}`);
    if (b.status !== 1) problems.push(`② 不合规批次退出码 ${b.status}，期望 1`);
    for (const c of ['knowledge_entry_invalid', 'knowledge_tag_unknown']) if (!codes.includes(c)) problems.push(`② errors 缺 ${c}`);
    if (!sameSnapshot(before, snapshot(root))) problems.push('③ 不合规批次改动了项目文件');
    if (readFileSync(join(root, 'logos/logos.config.json'), 'utf8') !== configBefore) problems.push('④ logos.config.json 被改动');
    if (!/"exempt":\s*\[\]/.test(configBefore)) problems.push('④ 夹具未显式 guard.exempt: []');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '显式 guard.exempt: [] 的无提案项目中，全局 CLI 从项目外候选目录录入成功并同批写入原文、条目、标签表、启用标记与索引；不合规批次退出码 1、零写入', evidence };
  },

  'SMOKE-core-323': async (entryPath) => {
    const problems = [];
    const evidence = [];
    const root = intakeProject(entryPath, 'lookup');
    const seeded = seedK01(entryPath, root);
    if (seeded.status !== 0) throw new Error(`录入 K01 失败：${JSON.stringify(seeded.data?.errors ?? [])}`);
    commitAll(root, 'seed K01');
    // ① list / show
    const list = knowledgeJson(entryPath, root, ['list', '--module', 'core']);
    const show = knowledgeJson(entryPath, root, ['show', 'K01']);
    evidence.push(`list_ids=${(list.data?.entries ?? []).map(e => e.id).join('|')}`, `show_status=${show.status}`);
    if (!(list.data?.entries ?? []).some(e => e.id === 'K01')) problems.push('① list 未包含 K01');
    if (show.status !== 0 || !String(show.data?.content ?? '').includes('K01-R1')) problems.push('① show K01 的全文不含 K01-R1');
    // ② refs
    const refs = knowledgeJson(entryPath, root, ['refs', 'K01-R1']);
    const ref = (refs.data?.refs ?? []).find(r => r.scenario_path === `${SCEN}/core-S50-refund.md`);
    evidence.push(`refs=${JSON.stringify(refs.data?.refs ?? [])}`);
    if (!ref || typeof ref.line !== 'number') problems.push('② refs 未返回已落盘场景的引用行');
    // ③ index + check
    const ix = knowledgeJson(entryPath, root, ['index']);
    const ck = knowledgeJson(entryPath, root, ['check']);
    evidence.push(`index=${ix.data?.result}`, `check_status=${ck.status}`);
    if (ix.status !== 0) problems.push(`③ index 退出码 ${ix.status}`);
    if (ck.status !== 0 || (ck.data?.errors ?? []).length > 0) problems.push(`③ check 未通过：${JSON.stringify(ck.data?.errors ?? [])}`);
    // ④ 词表丢失
    rmSync(join(root, KDIR, 'TAGS.md'));
    const ix2 = knowledgeJson(entryPath, root, ['index']);
    const ck2 = knowledgeJson(entryPath, root, ['check']);
    evidence.push(`missing_index_status=${ix2.status}`, `missing_check_codes=${(ck2.data?.errors ?? []).map(e => e.code).join('|')}`);
    if (ix2.status !== 1) problems.push(`④ 词表丢失时 index 退出码 ${ix2.status}，期望 1`);
    if (!(ck2.data?.errors ?? []).some(e => e.code === 'knowledge_tags_missing')) problems.push('④ check 未报 knowledge_tags_missing');
    // ⑤ 恢复后提案引用 K01-R1 通过 change-lint
    git(root, ['checkout', '--', `${KDIR}/TAGS.md`]);
    const dir = `logos/changes/${CHANGE}`;
    const deltas = {};
    for (const [target, [before, delta]] of Object.entries(BASE_DOCS)) {
      put(root, target, before);
      deltas[`deltas/${target.replace(/^logos\/resources\//, '')}`] = delta;
    }
    deltas['deltas/prd/3-technical-plan/2-scenario-implementation/core-S51-refund.md'] = wholeFile(`${SCEN}/core-S51-refund.md`, scenarioDoc('S51', ['K01-R1']));
    for (const [rel, content] of Object.entries(deltas)) put(root, `${dir}/${rel}`, content);
    const items = Object.keys(deltas).sort().map(rel => {
      const target = `logos/resources/${rel.replace(/^deltas\//, '')}`;
      return `- [x] [${existsSync(join(root, target)) ? 'MODIFY' : 'CREATE'}] \`${rel}\`：smoke`;
    });
    put(root, `${dir}/proposal.md`, PROPOSAL);
    put(root, `${dir}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n${items.join('\n')}\n\n## [code] 代码实现\n`);
    put(root, `${dir}/PLAN_APPROVED`, '{}');
    put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: CHANGE, module: 'core' }));
    const lint = lintJson(entryPath, root, CHANGE);
    evidence.push(`lint_status=${lint.status}`, `lint_pass=${lint.data?.pass}`);
    if (lint.data?.pass !== true) problems.push(`⑤ change-lint 未通过：${JSON.stringify(lint.data?.violations ?? [])}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '全局 CLI 的 list / show / refs / index / check 按规则输出；词表丢失时 index 拒绝、check 报 knowledge_tags_missing；恢复后提案引用通过 change-lint', evidence };
  },
};

export const KNOWLEDGE_DIRECT_INTAKE_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of KNOWLEDGE_DIRECT_INTAKE_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
    const record = { id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT };
    if (row.status !== 'skip' && TARGET_ENV) record.target_environment = TARGET_ENV;
    record.detail = row.detail;
    record.evidence = row.evidence;
    if (row.status === 'skip') { record.not_applicable_reason = row.detail; record.missing_requirements = row.missing ?? []; }
    appendFileSync(resultPath, `${JSON.stringify(record)}\n`);
  }
}

function globalEntry() {
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-c', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}
function globalInstallProblem(entryPath) {
  const r = run(npmBin, ['prefix', '-g']);
  if (r.status !== 0 || !r.stdout.trim()) return `无法读取 npm prefix -g：${(r.stderr || '').slice(0, 200)}`;
  const prefix = realpathSync(r.stdout.trim());
  const nodeModules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  const pkgDir = join(nodeModules, '@miniidealab', 'openlogos');
  const inside = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  if (lstatSync(pkgDir).isSymbolicLink()) return `全局包目录 ${pkgDir} 是链接（workspace link 不构成安装态证据）`;
  if (!inside(realpathSync(pkgDir), entryPath)) return `入口 ${entryPath} 不在全局 npm prefix 的包目录 ${pkgDir} 内`;
  if (inside(repoRoot, entryPath)) return `入口 ${entryPath} 位于工作区 ${repoRoot} 内`;
  return null;
}

let exitCode = 0;
try {
  let entryPath = null;
  if (SELF_TEST) {
    entryPath = realpathSync(resolve(process.env.OPENLOGOS_KDI_SMOKE_ENTRY));
  } else {
    const skip = (reason, missing) => exitNotApplicable(OWNED, { reason, missing, environment: ENVIRONMENT, repoRoot });
    const version = candidateVersion();
    if (!versionAtLeast(version, MIN_VERSION)) skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-version']);
    const record = existsSync(join(repoRoot, DEPLOYMENT_RECORD)) ? readFileSync(join(repoRoot, DEPLOYMENT_RECORD), 'utf8') : '';
    if (!record.includes(version)) skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version}`, ['deployment-record']);
    entryPath = globalEntry();
    const problem = !entryPath ? '找不到 openlogos 入口' : globalInstallProblem(entryPath);
    if (problem) {
      for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
      entryPath = null;
    }
  }
  if (entryPath) {
    for (const id of KNOWLEDGE_DIRECT_INTAKE_SMOKE_IDS) {
      const started = Date.now();
      try {
        const out = await CASES[id](entryPath);
        results.set(id, { status: 'pass', detail: out.detail, evidence: [`entry=${entryPath}`, ...out.evidence], duration_ms: Date.now() - started });
      } catch (error) {
        results.set(id, {
          status: 'fail', detail: error instanceof Error ? error.message : String(error),
          evidence: [`entry=${entryPath}`, ...(error?.evidence ?? [])], duration_ms: Date.now() - started,
        });
      }
    }
  }
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = KNOWLEDGE_DIRECT_INTAKE_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${KNOWLEDGE_DIRECT_INTAKE_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
