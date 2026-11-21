#!/usr/bin/env node
/**
 * SMOKE-core-318～SMOKE-core-320 — 0.16.17 企业知识能力的**安装态**取证（提案 enterprise-knowledge-base）：
 * 场景 S45「S45：企业知识沉淀与场景引用」，功能规格 §2.102.2、§2.102.10、§2.102.11。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.17 企业知识安装态 smoke（SMOKE-core-318～320）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.17 本机测试环境发布（enterprise-knowledge-base）」。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *
 *   - SMOKE-core-318：安装态版本与制品身份（payloadHash 自洽；包内 delta-classify 注册 knowledge、knowledge-view 可加载；
 *     包内 Skill 与规范为新口径；全局 init 创建 knowledge/ 与 reference/knowledge/）。
 *   - SMOKE-core-319：全局 CLI 把预定编号的知识条目与场景同批合并并登记 resource_index。
 *   - SMOKE-core-320：全局 CLI 的 change-lint 对不存在 / 退役 / 重号 / 退役改写分别给出诊断，且零写入。
 *
 * 临时项目一律经被测 CLI `init` 建立后写入夹具，再初始化为一次性 git 仓库（不配置远端、不联网）；全局 CLI 以入口绝对路径
 * 经子进程调用（时限 120 秒，超时判失败、不重试）。全部写入只在一次性目录内，结束即删除；对全局安装态只读，
 * 不读写本仓 logos/resources/（结果账本除外），不触碰本仓运行态目录与其他仓库。
 *
 * **窗口**：活跃变更为 enterprise-knowledge-base，或 OPENLOGOS_EKB_SMOKE=1；窗口外为全部 owned ID 写 skip（不声明 target_environment）。
 * **适用性**（缺即显式 skip）：候选版本（local-release-candidate.ts）不早于 0.16.17；部署记录记载候选版本。
 * **自测模式**（须同时满足）：OPENLOGOS_EKB_SMOKE_SELF_TEST=1、OPENLOGOS_EKB_SMOKE_ENTRY（候选入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置与版本下限，结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'enterprise-knowledge-base';
const OWNED = ['SMOKE-core-318', 'SMOKE-core-319', 'SMOKE-core-320'];
const MIN_VERSION = '0.16.17';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const CLI_TIMEOUT_MS = 120_000;

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_EKB_SMOKE_SELF_TEST === '1';
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

if (!SELF_TEST && process.env.OPENLOGOS_EKB_SMOKE_ENTRY !== undefined) {
  refuse('设置了 OPENLOGOS_EKB_SMOKE_ENTRY 但未声明自测（OPENLOGOS_EKB_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && !process.env.OPENLOGOS_EKB_SMOKE_ENTRY) refuse('自测模式需要 OPENLOGOS_EKB_SMOKE_ENTRY');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_EKB_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_EKB_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_EKB_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-ekb-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_EKB_')) delete env[key];
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
const SRC = 'logos/resources/reference/knowledge/refund-policy.md';
const SCEN = 'logos/resources/prd/3-technical-plan/2-scenario-implementation';
const CHANGE = 'ekb-smoke';
const REGISTRY = 'project:\n  name: "ekb-smoke"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 46\nresource_index: []\n';
const CLARIFICATION = '## 决策澄清\n\n```yaml\nschema: openlogos/clarification@1\nmode: adaptive\nstatus: complete\nimpacts:\n  data: {status: none, reason: smoke}\n  compatibility: {status: none, reason: smoke}\n  security_privacy: {status: none, reason: smoke}\n  public_release: {status: none, reason: smoke}\n  external_commitment: {status: none, reason: smoke}\ndecisions: []\nunresolved: []\ndefaults: []\n```\n';
const PROPOSAL = '# 变更提案：ekb smoke\n\n## 变更原因\n安装态 smoke 夹具。\n\n## 变更类型\n需求级\n\n## 变更范围\n- 影响的功能规格：smoke\n\n## 部署影响\n- 是否需要部署：否\n- 部署原因：无\n- 影响环境：无\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：否\n- 是否需要 smoke：否\n\n## 变更概述\n概述。\n\n' + CLARIFICATION;
const BASE_DOCS = {
  'logos/resources/prd/1-product-requirements/core-01-requirements.md': ['# 需求\n\n## 一、判据\n\n旧正文。\n', '## MODIFIED — 一、判据\n\n新正文。\n'],
  'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md': ['# 规格\n\n## 一、判据\n\n旧正文。\n', '## MODIFIED — 一、判据\n\n新正文。\n'],
  'logos/resources/test/core-S01-test-cases.md': ['# 用例\n\n## 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |\n', '## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 新定义 |\n'],
};

function entry(id, name, { type = 'rule', status = 'active', rules } = {}) {
  const meta = [`type: "${type}"`, 'scope: "module"', 'module: "core"', 'tags: ["退款"]', `status: "${status}"`, `source: [{"path": "${SRC}", "version": "v3"}]`].join('\n');
  const lines = [`# ${id}：${name}`, '', '## 元数据', '', '```yaml', meta, '```', ''];
  const rs = rules ?? (type === 'rule' ? [[`${id}-R1`, '单笔退款大于 5000 元需财务二审', 'active']] : []);
  if (rs.length > 0) {
    lines.push('## 规则', '', '| ID | 规则 | 状态 | 例外 |', '|---|---|---|---|');
    for (const [rid, text, st] of rs) lines.push(`| ${rid} | ${text} | ${st} | 无 |`);
    lines.push('');
  }
  lines.push('## 说明', '', `${name}的背景说明。`, '');
  return lines.join('\n');
}
const wholeFile = (target, body) => `## ADDED — ${target}（新文件，整文件）\n${body}`;
function scenarioDoc(refs) {
  return ['# S50：退款', '', '## 场景目标', '', '完成退款。', '', '## 时序图', '', 'Step 1：提交退款。', '',
    '## 适用业务约束', '', '| 引用 | 作用位置 | 说明 | 例外 |', '|---|---|---|---|',
    ...refs.map(r => `| ${r} | Step 1 | 约束 | 无 |`), '', '## 异常与边界', '', '无。', ''].join('\n');
}
const K01 = `${KDIR}/core-K01-refund.md`;
const K01_DISK = entry('K01', '退款', { rules: [['K01-R1', '单笔退款大于 5000 元需财务二审', 'active'], ['K01-R2', '退款原路返回', 'deprecated']] });

/** 经被测 CLI init 建立的一次性项目 + ready-to-merge 提案；`deltas` 为本提案的知识 / 场景 delta。 */
function knowledgeProject(entryPath, tag, deltas) {
  const root = realpathSync(tempDir(tag));
  const init = cli(entryPath, root, ['init', 'ekb-smoke', '--locale', 'zh', '--ai-tool', 'other']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || init.stdout || '').slice(0, 400)}`);
  put(root, 'logos/logos-project.yaml', REGISTRY);
  put(root, SRC, '# 退款制度 v3\n\n单笔退款大于 5000 元需财务二审。\n');
  put(root, K01, K01_DISK);
  const all = {};
  for (const [target, [before, delta]] of Object.entries(BASE_DOCS)) {
    put(root, target, before);
    all[`deltas/${target.replace(/^logos\/resources\//, '')}`] = delta;
  }
  Object.assign(all, deltas);
  const dir = `logos/changes/${CHANGE}`;
  for (const [rel, content] of Object.entries(all)) put(root, `${dir}/${rel}`, content);
  const items = Object.keys(all).sort().map(rel => {
    const target = `logos/resources/${rel.replace(/^deltas\//, '')}`;
    return `- [x] [${existsSync(join(root, target)) ? 'MODIFY' : 'CREATE'}] \`${rel}\`：smoke`;
  });
  put(root, `${dir}/proposal.md`, PROPOSAL);
  put(root, `${dir}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n${items.join('\n')}\n\n## [code] 代码实现\n`);
  put(root, `${dir}/PLAN_APPROVED`, '{}');
  put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: CHANGE, module: 'core' }));
  gitInit(root);
  commitAll(root, 'fixture');
  return { root, dir: join(root, dir) };
}
const scenarioDelta = refs => ({ [`deltas/prd/3-technical-plan/2-scenario-implementation/core-S50-refund.md`]: wholeFile(`${SCEN}/core-S50-refund.md`, scenarioDoc(refs)) });
const knowledgeDelta = (file, body) => ({ [`deltas/knowledge/${file}`]: wholeFile(`${KDIR}/${file}`, body) });

const CASES = {
  'SMOKE-core-318': async (entryPath) => {
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
    // ③ 包内 knowledge 类别与知识视图模块
    try {
      const dc = await import(pathToFileURL(join(pkg, 'dist/lib/delta-classify.js')).href);
      if (dc.DELTA_TO_RESOURCE?.knowledge !== 'logos/resources/knowledge') problems.push(`③ DELTA_TO_RESOURCE.knowledge 为 ${dc.DELTA_TO_RESOURCE?.knowledge}`);
    } catch (e) { problems.push(`③ 无法加载 dist/lib/delta-classify.js：${e instanceof Error ? e.message : String(e)}`); }
    const kvPath = join(pkg, 'dist/lib/knowledge-view.js');
    if (!existsSync(kvPath)) problems.push('③ 包内缺少 dist/lib/knowledge-view.js');
    else {
      evidence.push(`knowledge-view.js_sha256=${sha256(readFileSync(kvPath))}`);
      const kv = await import(pathToFileURL(kvPath).href);
      for (const name of ['parseKnowledgeEntry', 'buildKnowledgeView', 'resolveKnowledgeReference']) {
        if (typeof kv[name] !== 'function') problems.push(`③ knowledge-view 未导出 ${name}`);
      }
    }
    // ④ 包内 Skill 与规范
    const skill = join(pkg, 'skills/scenario-architect/SKILL.md');
    const spec = join(pkg, 'spec/directory-convention.md');
    if (!existsSync(skill) || !readFileSync(skill, 'utf8').includes('适用业务约束')) problems.push('④ 包内 scenario-architect SKILL.md 不含「适用业务约束」');
    if (!existsSync(spec) || !readFileSync(spec, 'utf8').includes('logos/resources/knowledge/')) problems.push('④ 包内 spec/directory-convention.md 不含「logos/resources/knowledge/」');
    // ⑤ 全局 init 创建目录
    const root = realpathSync(tempDir('init'));
    const init = cli(entryPath, root, ['init', 'ekb-init', '--locale', 'zh', '--ai-tool', 'other']);
    if (init.status !== 0) problems.push(`⑤ init 失败：exit ${init.status}`);
    for (const d of ['logos/resources/knowledge', 'logos/resources/reference/knowledge']) {
      if (!existsSync(join(root, d))) problems.push(`⑤ init 未创建 ${d}`);
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装态版本与候选一致、payloadHash 自洽；包内注册 knowledge 类别并带知识视图模块；Skill 与规范为新口径；init 创建两个知识目录', evidence };
  },

  'SMOKE-core-319': async (entryPath) => {
    const problems = [];
    const evidence = [];
    const p = knowledgeProject(entryPath, 'merge', {
      ...knowledgeDelta('core-K02-settle-day.md', entry('K02', '结算日', { type: 'term' })),
      ...scenarioDelta(['K01-R1', 'K02']),
    });
    const lint = lintJson(entryPath, p.root, CHANGE);
    evidence.push(`lint_status=${lint.status}`, `lint_pass=${lint.data?.pass}`);
    const knowledgeCodes = (lint.data?.violations ?? []).map(v => v.code).filter(c => c.startsWith('knowledge_'));
    if (lint.data?.pass !== true || knowledgeCodes.length > 0) problems.push(`① change-lint 未通过：${JSON.stringify(lint.data?.violations ?? [])}`);
    const merge = cli(entryPath, p.root, ['merge', CHANGE]);
    evidence.push(`merge_status=${merge.status}`);
    if (merge.status !== 0) problems.push(`② merge 退出码 ${merge.status}：${(merge.stderr || merge.stdout || '').slice(0, 300)}`);
    const k02 = join(p.root, KDIR, 'core-K02-settle-day.md');
    const scen = join(p.root, SCEN, 'core-S50-refund.md');
    if (!existsSync(k02) || !readFileSync(k02, 'utf8').includes('K02：结算日')) problems.push('③ 知识条目 core-K02-settle-day.md 未落盘');
    if (!existsSync(scen) || !readFileSync(scen, 'utf8').includes('| K01-R1 |')) problems.push('③ 场景 core-S50-refund.md 未落盘');
    const yaml = readFileSync(join(p.root, 'logos/logos-project.yaml'), 'utf8');
    for (const target of [`${KDIR}/core-K02-settle-day.md`, `${SCEN}/core-S50-refund.md`]) {
      if (!yaml.includes(`path: ${target}`)) problems.push(`③ resource_index 缺少 ${target}`);
    }
    if (!existsSync(join(p.dir, 'SPEC_MERGED'))) problems.push('③ 未写 SPEC_MERGED');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '全局 CLI 下预定编号的知识条目与场景同批合并、登记 resource_index 并写 SPEC_MERGED', evidence };
  },

  'SMOKE-core-320': async (entryPath) => {
    const problems = [];
    const evidence = [];
    const RETIRED_REWRITE = `## MODIFIED — 规则\n\n| ID | 规则 | 状态 | 例外 |\n|---|---|---|---|\n| K01-R1 | 单笔退款大于 5000 元需财务二审 | active | 无 |\n| K01-R2 | 客户编号由主数据系统统一下发 | active | 无 |\n`;
    const cases = [
      { tag: 'unknown', deltas: scenarioDelta(['K01-R9']), expect: d => d.violations.some(v => v.code === 'knowledge_reference_unknown'), status: 2 },
      { tag: 'deprecated', deltas: scenarioDelta(['K01-R2']), expect: d => d.pass === true && (d.warnings ?? []).some(w => w.code === 'knowledge_reference_deprecated'), status: 0 },
      {
        tag: 'duplicate', deltas: knowledgeDelta('core-K01-customer-id.md', entry('K01', '客户编号')),
        expect: d => d.violations.some(v => v.code === 'knowledge_id_duplicate' && v.path.endsWith('core-K01-customer-id.md')
          && v.message.includes('core-K01-refund.md') && v.message.includes('core-K01-customer-id.md')),
        status: 2,
      },
      { tag: 'retired', deltas: { 'deltas/knowledge/core-K01-refund.md': RETIRED_REWRITE }, expect: d => d.violations.some(v => v.code === 'knowledge_retired_id_mutated'), status: 2 },
    ];
    for (const c of cases) {
      const p = knowledgeProject(entryPath, c.tag, c.deltas);
      const before = snapshot(p.root);
      const lint = lintJson(entryPath, p.root, CHANGE);
      evidence.push(`${c.tag}:status=${lint.status}`, `${c.tag}:codes=${(lint.data?.violations ?? []).map(v => v.code).join('|')}`);
      if (lint.status !== c.status || !c.expect(lint.data ?? {})) problems.push(`${c.tag}：期望退出码 ${c.status} 与对应诊断，实际 ${lint.status} ${JSON.stringify({ violations: lint.data?.violations, warnings: lint.data?.warnings })}`);
      if (!sameSnapshot(before, snapshot(p.root))) problems.push(`${c.tag}：change-lint 改动了项目文件`);
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '全局 CLI 的 change-lint 对不存在 / 退役 / 重号 / 退役改写分别给出 unknown、deprecated 告警、duplicate、retired_id_mutated，且零写入', evidence };
  },
};

export const ENTERPRISE_KNOWLEDGE_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of ENTERPRISE_KNOWLEDGE_SMOKE_IDS) {
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
    entryPath = realpathSync(resolve(process.env.OPENLOGOS_EKB_SMOKE_ENTRY));
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
    for (const id of ENTERPRISE_KNOWLEDGE_SMOKE_IDS) {
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

const failed = ENTERPRISE_KNOWLEDGE_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${ENTERPRISE_KNOWLEDGE_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
