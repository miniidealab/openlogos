#!/usr/bin/env node
/**
 * SMOKE-core-263～SMOKE-core-267 — 0.16.6 提案默认部署环境的**安装态**取证（来源提案 proposal-default-environment，
 * 功能规格 §2.93.1、§2.93.6，spec/environments.md §13）。本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *   - SMOKE-core-263：安装态版本、制品身份与本仓 sync 同源（版本取 cli/src/lib/local-release-candidate.ts，不写死字面量）。
 *   - SMOKE-core-264：安装态合法默认环境的校验与输出（env check / env list JSON 与文本 / env show / status）。
 *   - SMOKE-core-265：安装态非法默认环境 fail-closed（env check、deploy-done、smoke 零副作用拒绝）。
 *   - SMOKE-core-266：安装态默认环境可指向受门环境，部署仍受门；env show 输出实际部署引用。
 *   - SMOKE-core-267：安装态未配置零回归（与回滚制品 0.16.5 在同一夹具上的输出比较）。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目、一次性「发布目录」与一次性基线 prefix 内，结束即删除；
 * 只读本机全局安装态（不安装 / 卸载全局），不触碰本仓活跃提案、本仓 logos/resources/、本仓运行态目录与用户其他仓库
 * （包括 runlogos）；唯一读取本仓的是 SMOKE-core-263 ④ 对本仓托管副本的只读比对。runner 以子进程直接调用 CLI（不经 AI
 * 宿主）。不触发真实 CI、不访问远程服务；SMOKE-core-267 的基线不调用 npm：回滚 tarball 解包到一次性目录，依赖从候选全局
 * 安装只读复制（scripts/lib/offline-baseline.mjs，code-r1 F1），不写用户 npm cache / 日志。命令图中不出现任何
 * 公网发布命令（夹具项目内为构造用例创建的本地 tag 除外）。判据用行为断言（`--format json` 结构化字段、退出码与命令
 * 实际输出；SMOKE-core-264 ③ 的文本标注本身就是被测输出）。
 *
 * 环境不具备时写显式 skip（不标 platform-unavailable，均为可补齐的环境缺口；有 skip 时不得写 SMOKE_PASS）：
 *   - 缺候选 tarball：来源依次为 OPENLOGOS_DEFAULT_ENV_TARBALL / OPENLOGOS_TARBALL 与本仓冻结的唯一候选制品
 *     cli/miniidealab-openlogos-<候选版本>.tgz——自动流程运行 `openlogos smoke` 时不设置环境变量，适用性判定不得只靠环境变量；
 *     候选版本早于 0.16.6 时本提案的候选制品尚未产出，同样按缺候选制品处理；
 *   - 部署记录（logos/resources/verify/deployment-report.md）未记载候选版本与 tarball SHA-256；
 *   - 缺回滚制品 cli/rollback/miniidealab-openlogos-<回滚版本>.tgz（SMOKE-core-267 的基线来源）；
 *   - 本仓未执行 sync（不存在托管副本 logos/skills/change-writer/SKILL.md 或 logos/skills/deployment-designer/SKILL.md）。
 * 托管副本存在但与全局包字节不一致属 SMOKE-core-263 ④ 的 fail，不是 skip。
 *
 * **正式安装态模式**（缺省）：只认 PATH 中 `openlogos` 且 realpath 位于 `npm prefix -g` 的全局包目录内。
 * **自测模式**（仅供 runner 自身验证，须同时满足）：OPENLOGOS_DEFAULT_ENV_SMOKE_SELF_TEST=1、OPENLOGOS_DEFAULT_ENV_SMOKE_ENTRY
 * 注入入口、OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过上述环境前置（SMOKE-core-267 的基线入口另由
 * OPENLOGOS_DEFAULT_ENV_SMOKE_BASELINE_ENTRY 注入），结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync,
  statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';
import { assembleOfflineBaseline } from './lib/offline-baseline.mjs';

const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const TARBALL_ENV = ['OPENLOGOS_DEFAULT_ENV_TARBALL', 'OPENLOGOS_TARBALL'];
const MIN_VERSION = '0.16.6';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const FIELD = 'proposal_default_env';
/** SMOKE-core-263 ④ 比对的本仓托管副本与全局包内同名文件。 */
const SYNC_COPIES = [
  { repo: 'logos/skills/change-writer/SKILL.md', pkg: 'skills/change-writer/SKILL.md' },
  { repo: 'logos/skills/deployment-designer/SKILL.md', pkg: 'skills/deployment-designer/SKILL.md' },
];
/** SMOKE-core-263 ③：包内 change-writer 必须含的默认环境规则与四种必须提问的负例。 */
const CHANGE_WRITER_RULES = [
  '`proposal_default_env`', '`source: policy`', 'openlogos env show <id> --format json',
  'agent 方式的 `environment.deploy.plan_section` 在已合并部署方案中没有同名章节',
  '配置了 `deploy` 但 `current_ref` 为 null 且没有首次部署失败处置',
  '**未配置 `deploy`（即使 `current_ref` 非 null）且已合并方案没有该环境的回滚步骤**',
  '两者都没有（smoke 只会汇总已有结果，不产生本次新结果）',
];
const DEPLOYMENT_DESIGNER_RULES = ['**只在用户明确指定时写入**', '`proposal_default_env: <环境 id>`'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const INJECTED_ENTRY = process.env.OPENLOGOS_DEFAULT_ENV_SMOKE_ENTRY;
const INJECTED_BASELINE = process.env.OPENLOGOS_DEFAULT_ENV_SMOKE_BASELINE_ENTRY;
const SELF_TEST = process.env.OPENLOGOS_DEFAULT_ENV_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;

const run = (cmd, args, cwd = repoRoot) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: process.env });
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
/**
 * 在一次性项目里调用 CLI 时剥离外层 smoke 的账本、外层注入的目标环境与本 runner 的控制变量，
 * 否则夹具项目的 smoke runner 会把记录写进外层账本、读到外层的 OPENLOGOS_SMOKE_ENV，污染正式证据。
 */
function isolatedEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV'
      || key.startsWith('OPENLOGOS_DEFAULT_ENV_') || key.startsWith('OPENLOGOS_DEPLOY_')) delete env[key];
  }
  return { ...env, NO_COLOR: '1', ...extra };
}
const cliRaw = (entry, cwd, args, extra = {}) =>
  spawnSync(cliBin(entry), cliArgs(entry, args), { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: isolatedEnv(extra) });
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-default-env-${tag}-`));
  scopes.push(dir);
  return dir;
}

function put(root, rel, content, mode) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  if (mode !== undefined) chmodSync(abs, mode);
}

/** 解析 CLI 的 JSON 输出：成功 envelope 在 stdout，错误 envelope 在 stderr。 */
function cliJson(entry, dir, args, extra = {}) {
  const r = cliRaw(entry, dir, [...args, '--format', 'json'], extra);
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data ?? null; } catch { /* 错误路径无 stdout envelope */ }
  try { error = JSON.parse((r.stderr || '').trim()).error ?? null; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, error, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const brief = r => `exit=${r.status} ${r.error ? `error=${JSON.stringify(r.error).slice(0, 400)}` : `data=${JSON.stringify(r.data ?? null).slice(0, 400)}`}`;
const hasKey = (obj, key) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);

/** 安装包根：入口向上找同时含 package.json 与 asset-manifest.json 的目录。 */
function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

function releaseVersions() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
  return {
    candidate: /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null,
    rollback: /LOCAL_RELEASE_ROLLBACK_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null,
  };
}
const rollbackTarball = version => join(repoRoot, `cli/rollback/miniidealab-openlogos-${version}.tgz`);

/** 语义化版本比较（只看 major.minor.patch）。 */
function versionAtLeast(version, min) {
  const parse = v => (/^(\d+)\.(\d+)\.(\d+)/.exec(v ?? '') ?? []).slice(1).map(Number);
  const a = parse(version);
  const b = parse(min);
  if (a.length !== 3) return false;
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

const LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
const FIXTURE_SLUG = 'default-env-smoke-fixture';
const FIXTURE_RESULT = 'logos/resources/verify/smoke-results.jsonl';
/** 夹具部署脚本：把注入的环境与版本追加写入一次性发布目录。 */
const DEPLOY_SCRIPT = ['#!/bin/sh', 'mkdir -p "$PUBLISH_DIR"', 'echo "$OPENLOGOS_DEPLOY_ENV $OPENLOGOS_DEPLOY_REF" >> "$PUBLISH_DIR/deploys.txt"', ''].join('\n');
/** 夹具 smoke runner：被运行时留下标记文件（用于断言「未运行 smoke.command」）。 */
const FIXTURE_RUNNER = [
  "import { mkdirSync, writeFileSync } from 'node:fs';",
  "import { dirname } from 'node:path';",
  "writeFileSync('RUNNER_RAN', '1');",
  `const p = ${JSON.stringify(FIXTURE_RESULT)};`,
  'mkdirSync(dirname(p), { recursive: true });',
  "writeFileSync(p, JSON.stringify({ id: 'SMOKE-core-901', status: 'pass', timestamp: new Date().toISOString(), target_environment: process.env.OPENLOGOS_SMOKE_ENV ?? null }) + '\\n');",
].join('\n');

function git(dir, args) {
  const r = run('git', args, dir);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 300)}`);
  return r.stdout.trim();
}

/**
 * 一次性 git 项目：经入口 init（locale zh），按 registryLines 写登记表（null 表示不写），配置夹具 smoke runner，
 * 提交一次并打本地 tag v1。
 */
function initProject(entry, registryLines) {
  const dir = newTempDir('project');
  const publish = newTempDir('publish');
  const init = cliRaw(entry, dir, ['init', '--locale', 'zh', '--ai-tool', 'claude-code']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || '').slice(0, 300)}`);
  if (registryLines) put(dir, 'logos/environments.yaml', [...registryLines, ''].join('\n'));
  put(dir, 'deploy/run.sh', DEPLOY_SCRIPT, 0o755);
  put(dir, 'logos/resources/test/smoke/core-smoke-test-cases.md', '| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  put(dir, 'scripts/smoke-default-env-fixture.mjs', FIXTURE_RUNNER);
  const cfgPath = join(dir, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.smoke = { ...(cfg.smoke || {}), result_path: FIXTURE_RESULT, command: 'node scripts/smoke-default-env-fixture.mjs', sandbox_mode: 'off' };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const gitignore = join(dir, '.gitignore');
  writeFileSync(gitignore, `${existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : ''}\nlogos/.openlogos-runtime/\nlogos/environments.yaml\nRUNNER_RAN\n`);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'smoke']);
  git(dir, ['config', 'user.email', 'smoke@example.invalid']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'v1']);
  git(dir, ['tag', 'v1']);
  return { dir, publish, env: { PUBLISH_DIR: publish } };
}

const REGISTRY_PLAIN = (top = []) => [
  'schema_version: 1', ...top, 'environments:',
  '  - {id: test, name: Test, tier: test, aliases: [测试]}',
  '  - {id: prod, name: Production, tier: prod, aliases: [生产]}',
];
const REGISTRY_GATED = top => [
  'schema_version: 1', ...top, 'environments:',
  '  - {id: staging, name: Staging, tier: staging, deploy: {mode: script, script: deploy/run.sh}}',
  '  - {id: prod, name: Production, tier: prod, deploy: {mode: script, script: deploy/run.sh}, promote_from: staging, require_approval: true}',
];

/** 夹具项目内的活跃提案（ready-to-deploy：VERIFY_PASS + LOOP_ITERS pass）。 */
function addReadyProposal(dir) {
  const rel = `logos/changes/${FIXTURE_SLUG}`;
  put(dir, `${rel}/proposal.md`, [
    '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：test',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
  ].join('\n'));
  put(dir, `${rel}/tasks.md`, '# 实现任务\n\n## [deploy] 发布\n- [ ] 发布到 test\n');
  put(dir, `${rel}/VERIFY_PASS`, '');
  put(dir, `${rel}/LOOP_ITERS`, `${JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module: 'core', timestamp: new Date().toISOString() })}\n`);
  put(dir, 'logos/.openlogos-guard', JSON.stringify({ activeChange: FIXTURE_SLUG, module: 'core' }));
  put(dir, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nfixture\n');
  return rel;
}

const deploys = publish => (existsSync(join(publish, 'deploys.txt')) ? readFileSync(join(publish, 'deploys.txt'), 'utf8').trim().split('\n') : []);
function ledgerRows(dir) {
  const p = join(dir, LEDGER_REL);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}

/** 临时项目全部文件（含运行态目录，不含 .git）的 SHA-256 清单。 */
function treeHash(root) {
  const out = [];
  const walk = d => {
    for (const name of readdirSync(d).sort()) {
      if (name === '.git') continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) { out.push(`D ${relative(root, p)}`); walk(p); }
      else out.push(`F ${relative(root, p)} ${sha256(readFileSync(p))}`);
    }
  };
  walk(root);
  return out.join('\n');
}

/**
 * 一次性基线：离线组装回滚制品（不调用 npm、不联网、不写用户 npm cache / 日志、不触碰全局），返回其入口与证据。
 * 自测模式取注入的基线入口。
 */
function baselineEntry(candidateEntry) {
  if (SELF_TEST) {
    if (!INJECTED_BASELINE || !existsSync(INJECTED_BASELINE)) throw new Error('自测模式下 SMOKE-core-267 需要 OPENLOGOS_DEFAULT_ENV_SMOKE_BASELINE_ENTRY 指定基线入口');
    return { entry: realpathSync(INJECTED_BASELINE), evidence: ['baseline_mode=self-test-injected'] };
  }
  const { rollback } = releaseVersions();
  const candidateRoot = packageRoot(candidateEntry);
  if (!candidateRoot) throw new Error(`无法从 ${candidateEntry} 定位候选安装包根`);
  const { entry, evidence } = assembleOfflineBaseline({ tarball: rollbackTarball(rollback), candidateRoot, scopeDir: newTempDir('baseline') });
  return { entry, evidence };
}

/**
 * 每个用例：(entry) => { detail, evidence }，失败抛错。
 */
const CASES = {
  'SMOKE-core-263': async (entry) => {
    const problems = [];
    const evidence = [`entry_realpath=${entry}`];
    // ① 版本：全局 --version == 部署记录候选版本
    const { candidate } = releaseVersions();
    if (!candidate) throw new Error('无法读取候选版本（cli/src/lib/local-release-candidate.ts 缺失或无 LOCAL_RELEASE_CANDIDATE_VERSION）');
    const version = (cliRaw(entry, repoRoot, ['--version']).stdout || '').trim();
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (!SELF_TEST && version !== candidate) problems.push(`① --version 为 ${version}，部署记录候选版本为 ${candidate}`);
    // ② asset-manifest 自洽
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    evidence.push(`package_root=${pkg}`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`payload_hash=${manifest.payloadHash}`);
    if (manifest.version !== version) problems.push(`② asset-manifest version ${manifest.version} 与 --version ${version} 不一致`);
    const assetLib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
    try { assetLib.validateAssetManifest(manifest, pkg); } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    // ③ 包内 Skill 含默认环境规则与四种必须提问的负例
    // 自测模式的注入入口是工作区 dist，包根下没有打包时复制的 skills/，改读本仓根 skills/（正式模式只认安装包内文件）
    const skillRoot = SELF_TEST && !existsSync(join(pkg, 'skills')) ? repoRoot : pkg;
    const pkgText = rel => (existsSync(join(skillRoot, rel)) ? readFileSync(join(skillRoot, rel), 'utf8') : '');
    const cw = pkgText('skills/change-writer/SKILL.md');
    const dd = pkgText('skills/deployment-designer/SKILL.md');
    for (const rule of CHANGE_WRITER_RULES) if (!cw.includes(rule)) problems.push(`③ 包内 change-writer 缺少：${rule}`);
    for (const rule of DEPLOYMENT_DESIGNER_RULES) if (!dd.includes(rule)) problems.push(`③ 包内 deployment-designer 缺少：${rule}`);
    // ④ 本仓托管副本与全局包同名文件逐字节一致（自测模式下入口不是本仓 sync 的来源，跳过本项）
    if (!SELF_TEST) {
      for (const copy of SYNC_COPIES) {
        const repoFile = join(repoRoot, copy.repo);
        const pkgFile = join(pkg, copy.pkg);
        const same = existsSync(repoFile) && existsSync(pkgFile) && readFileSync(repoFile).equals(readFileSync(pkgFile));
        evidence.push(`④ ${copy.repo} same=${same}`);
        if (!same) problems.push(`④ 本仓 ${copy.repo} 与全局包 ${copy.pkg} 字节不一致`);
      }
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '安装态版本与制品身份自洽，包内 Skill 含默认环境规则，本仓托管副本同源', evidence };
  },

  'SMOKE-core-264': async (entry) => {
    const problems = [];
    const evidence = [];
    const p = initProject(entry, REGISTRY_PLAIN([`${FIELD}: test`]));
    evidence.push(`project=${p.dir}`);
    // ① env check：无 error、无 field=proposal_default_env 的警告
    const check = cliJson(entry, p.dir, ['env', 'check']);
    evidence.push(`① ${brief(check)}`);
    if (check.status !== 0 || (check.data?.errors ?? []).length > 0) problems.push(`① env check 应通过，实际 ${brief(check)}`);
    if ((check.data?.warnings ?? []).some(w => w.field === FIELD)) problems.push('① env check 不应对 proposal_default_env 报警告');
    // ② env list JSON 顶层 proposal_default_env
    const list = cliJson(entry, p.dir, ['env', 'list']);
    evidence.push(`② proposal_default_env=${JSON.stringify(list.data?.[FIELD])}`);
    if (list.status !== 0 || list.data?.[FIELD] !== 'test') problems.push(`② env list 应输出 proposal_default_env=test，实际 ${brief(list)}`);
    // ③ 文本模式：只有 test 行带「（提案默认）」
    const text = cliRaw(entry, p.dir, ['env', 'list']).stdout || '';
    const lines = text.split('\n');
    const testLine = lines.find(l => l.startsWith('  test  ')) ?? '';
    const prodLine = lines.find(l => l.startsWith('  prod  ')) ?? '';
    evidence.push(`③ test_line=${JSON.stringify(testLine)} prod_line=${JSON.stringify(prodLine)}`);
    if (!testLine.endsWith('（提案默认）')) problems.push(`③ test 行应以「（提案默认）」结尾，实际 ${JSON.stringify(testLine)}`);
    if (prodLine.includes('提案默认')) problems.push('③ prod 行不应标注');
    // ④ env show / status 不输出 proposal_default_env
    const show = cliJson(entry, p.dir, ['env', 'show', 'test']);
    const status = cliJson(entry, p.dir, ['status']);
    evidence.push(`④ show ${brief(show)}; status exit=${status.status}`);
    if (show.status !== 0 || hasKey(show.data, FIELD)) problems.push(`④ env show 应成功且不含 proposal_default_env，实际 ${brief(show)}`);
    if (status.status !== 0 || status.stdout.includes(`"${FIELD}"`)) problems.push(`④ status 应成功且不含 proposal_default_env，实际 exit=${status.status}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '合法默认环境通过校验，env list 输出并标注，其他命令不输出该字段', evidence };
  },

  'SMOKE-core-265': async (entry) => {
    const problems = [];
    const evidence = [];
    for (const value of ['stage', '测试']) {
      const p = initProject(entry, REGISTRY_PLAIN([`${FIELD}: ${value}`]));
      const rel = addReadyProposal(p.dir);
      evidence.push(`[${value}] project=${p.dir}`);
      // ① env check 报 ENV_FIELD_INVALID（field=proposal_default_env）
      const check = cliJson(entry, p.dir, ['env', 'check']);
      const fieldErrors = (check.data?.errors ?? []).filter(e => e.field === FIELD);
      evidence.push(`[${value}] ① ${brief(check)}`);
      if (check.status !== 1 || fieldErrors.map(e => e.code).join() !== 'ENV_FIELD_INVALID') {
        problems.push(`[${value}] ① env check 应以 ENV_FIELD_INVALID 退出 1，实际 ${brief(check)}`);
      }
      // ②③ deploy-done / smoke 以 ENV_REGISTRY_INVALID 零副作用拒绝；smoke 的登记表分类在其既有前置之后（§4.2）
      const rejects = (label, args) => {
        const before = treeHash(p.dir);
        const r = cliJson(entry, p.dir, args);
        const after = treeHash(p.dir);
        evidence.push(`[${value}] ${label} ${brief(r)} unchanged=${before === after}`);
        if (r.status !== 1 || r.error?.code !== 'ENV_REGISTRY_INVALID') problems.push(`[${value}] ${label} 应以 ENV_REGISTRY_INVALID 退出 1，实际 ${brief(r)}`);
        if (before !== after) problems.push(`[${value}] ${label} 不应改动任何文件`);
      };
      rejects('② deploy-done', ['deploy-done', '--env', 'test', '--ref', 'HEAD']);
      put(p.dir, `${rel}/tasks.md`, '# 实现任务\n\n## [deploy] 发布\n- [x] 发布到 test\n');
      put(p.dir, `${rel}/DEPLOY_DONE`, '');
      rejects('③ smoke', ['smoke', '--env', 'test']);
      if (existsSync(join(p.dir, 'RUNNER_RAN'))) problems.push(`[${value}] ③ 不应运行 smoke.command`);
      if (ledgerRows(p.dir).length > 0) problems.push(`[${value}] 不应写账本`);
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '非法默认环境使登记表判为非法，deploy-done 与 smoke 零副作用拒绝', evidence };
  },

  'SMOKE-core-266': async (entry) => {
    const problems = [];
    const evidence = [];
    const p = initProject(entry, REGISTRY_GATED([`${FIELD}: prod`]));
    evidence.push(`project=${p.dir}`);
    // ① 默认环境指向配置了晋级与审批门禁的环境是合法配置
    const check = cliJson(entry, p.dir, ['env', 'check']);
    evidence.push(`① ${brief(check)}`);
    if (check.status !== 0 || (check.data?.errors ?? []).some(e => e.field === FIELD)) problems.push(`① env check 应通过，实际 ${brief(check)}`);
    // ② env list
    const list = cliJson(entry, p.dir, ['env', 'list']);
    if (list.data?.[FIELD] !== 'prod') problems.push(`② env list 应输出 proposal_default_env=prod，实际 ${brief(list)}`);
    // ③ 部署仍受门：staging 未验证 v1 → DEPLOY_PROMOTION_UNVERIFIED，零执行、无 deploy 记录
    const approve = cliJson(entry, p.dir, ['approve', '--env', 'prod', '--ref', 'v1']);
    const deploy = cliJson(entry, p.dir, ['deploy', '--env', 'prod', '--ref', 'v1'], p.env);
    evidence.push(`③ approve ${brief(approve)}; deploy ${brief(deploy)}; publish=${JSON.stringify(deploys(p.publish))}`);
    if (approve.status !== 0) problems.push(`③ approve 应成功，实际 ${brief(approve)}`);
    if (deploy.status !== 1 || deploy.error?.code !== 'DEPLOY_PROMOTION_UNVERIFIED') problems.push(`③ deploy 应以 DEPLOY_PROMOTION_UNVERIFIED 拒绝，实际 ${brief(deploy)}`);
    if (deploys(p.publish).length > 0) problems.push('③ 发布目录不应有部署痕迹');
    if (ledgerRows(p.dir).some(r => r.kind === 'deploy')) problems.push('③ 账本不应有 deploy 记录');
    // ④ env show 输出实际部署引用，不含密钥值
    const show = cliJson(entry, p.dir, ['env', 'show', 'prod']);
    const dep = show.data?.environment?.deploy;
    evidence.push(`④ environment.deploy=${JSON.stringify(dep ?? null)}`);
    if (show.status !== 0 || dep?.mode !== 'script' || dep?.script !== 'deploy/run.sh') problems.push(`④ env show 应输出 environment.deploy（script=deploy/run.sh），实际 ${brief(show)}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '默认环境可指向受门环境，部署仍被晋级检查拦截；env show 输出实际部署引用', evidence };
  },

  'SMOKE-core-267': async (entry) => {
    const problems = [];
    const evidence = [];
    const { entry: base, evidence: baselineEvidence } = baselineEntry(entry);
    evidence.push(...baselineEvidence, `baseline_entry=${base}`, `baseline_version=${(cliRaw(base, repoRoot, ['--version']).stdout || '').trim()}`);
    const fixtures = [
      { name: 'A 无登记表', registry: null },
      { name: 'B 未写该字段', registry: ['schema_version: 1', 'environments:', '  - {id: test, name: Test, tier: test}'] },
    ];
    const pick = (cmd, r) => {
      if (r.error) return { exit: r.status, error: r.error.code };
      const d = r.data ?? {};
      if (cmd === 'env list') return { exit: r.status, registry_present: d.registry_present, ids: (d.environments ?? []).map(e => e.id), warnings: d.warnings };
      if (cmd === 'env check') return { exit: r.status, ok: d.ok, errors: d.errors, warnings: d.warnings };
      return { exit: r.status, ids: (d.environments ?? []).map(e => e.id), registry_error: d.environment_registry_error ?? null };
    };
    for (const f of fixtures) {
      const now = initProject(entry, f.registry);
      const old = initProject(base, f.registry);
      for (const cmd of ['env list', 'env check', 'status']) {
        const args = cmd.split(' ');
        const a = cliJson(entry, now.dir, args);
        const b = cliJson(base, old.dir, args);
        const pa = pick(cmd, a);
        const pb = pick(cmd, b);
        evidence.push(`${f.name} ${cmd}: now=${JSON.stringify(pa)} baseline=${JSON.stringify(pb)}`);
        if (JSON.stringify(pa) !== JSON.stringify(pb)) problems.push(`${f.name} ${cmd} 与基线不一致`);
        if (a.stdout.includes(`"${FIELD}"`)) problems.push(`${f.name} ${cmd} 不应输出 proposal_default_env`);
      }
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '未配置该字段的项目 env list / env check / status 与回滚制品基线一致', evidence };
  },
};

export const DEFAULT_ENV_SMOKE_IDS = Object.keys(CASES);

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: DEFAULT_ENV_SMOKE_IDS,
    environment: FORMAL_ENVIRONMENT,
    self_test_environment: SELF_TEST_ENVIRONMENT,
    required_source_env: TARBALL_ENV,
    min_candidate_version: MIN_VERSION,
    deployment_record: DEPLOYMENT_RECORD,
    repo_sync_copies: SYNC_COPIES.map(c => c.repo),
    public_release_commands: [],
    baseline_mode: 'offline-assembled',
    baseline_npm_invocations: 0,
  }));
  process.exit(0);
}

function refuse(reason) {
  console.error(`smoke runner 拒绝运行（未写入任何结果）：${reason}`);
  process.exit(2);
}

function formalResultPath() {
  let configured = null;
  try {
    configured = JSON.parse(readFileSync(join(repoRoot, 'logos/logos.config.json'), 'utf8')).smoke?.result_path ?? null;
  } catch { /* 用缺省 */ }
  return resolve(repoRoot, configured || 'logos/resources/verify/smoke-results.jsonl');
}

if (INJECTED_ENTRY !== undefined && !SELF_TEST) refuse('设置了 OPENLOGOS_DEFAULT_ENV_SMOKE_ENTRY 但未声明自测（OPENLOGOS_DEFAULT_ENV_SMOKE_SELF_TEST=1）');
if (SELF_TEST && INJECTED_ENTRY === undefined) refuse('自测模式需要 OPENLOGOS_DEFAULT_ENV_SMOKE_ENTRY 指定注入入口');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST) {
  // 环境前置（缺失即显式 skip）：候选版本与 tarball → 部署记录 → 回滚制品 → 本仓 sync
  const skip = (reason, missing) => exitNotApplicable(DEFAULT_ENV_SMOKE_IDS, { reason, missing, environment: ENVIRONMENT, repoRoot });
  const { candidate: version, rollback } = releaseVersions();
  if (!versionAtLeast(version, MIN_VERSION)) {
    skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-tarball']);
  }
  if (!TARBALL_ENV.some(name => process.env[name])) {
    const fallback = join(repoRoot, `cli/miniidealab-openlogos-${version}.tgz`);
    if (existsSync(fallback)) process.env.OPENLOGOS_DEFAULT_ENV_TARBALL = fallback;
  }
  if (!TARBALL_ENV.some(name => process.env[name])) {
    skip(`缺少 ${version} 候选 tarball：未设置 ${TARBALL_ENV.join(' / ')}，本仓也没有 cli/miniidealab-openlogos-${version}.tgz（部署窗口外不适用）`, ['candidate-tarball']);
  }
  const tarball = resolve(repoRoot, process.env.OPENLOGOS_DEFAULT_ENV_TARBALL || process.env.OPENLOGOS_TARBALL);
  if (!existsSync(tarball)) skip(`候选 tarball 不存在：${tarball}`, ['candidate-tarball']);
  const tarballSha = sha256(readFileSync(tarball));
  const recordPath = join(repoRoot, DEPLOYMENT_RECORD);
  const record = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : '';
  if (!record.includes(version) || !record.includes(tarballSha)) {
    skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version} 与 tarball SHA-256 ${tarballSha}`, ['deployment-record']);
  }
  if (!rollback || !existsSync(rollbackTarball(rollback))) {
    skip(`缺少回滚制品 cli/rollback/miniidealab-openlogos-${rollback ?? '(未知)'}.tgz（SMOKE-core-267 的基线来源）`, ['rollback-tarball']);
  }
  const missingCopies = SYNC_COPIES.map(c => c.repo).filter(rel => !existsSync(join(repoRoot, rel)));
  if (missingCopies.length > 0) skip(`本仓未执行 openlogos sync（缺少托管副本 ${missingCopies.join('、')}）`, ['repo-sync']);
}

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of DEFAULT_ENV_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到', evidence: [], duration_ms: 0 };
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: row.duration_ms, environment: ENVIRONMENT,
      detail: row.detail, evidence: row.evidence,
    })}\n`);
  }
}

function commandLookup() {
  if (SELF_TEST) return existsSync(INJECTED_ENTRY) ? realpathSync(INJECTED_ENTRY) : null;
  const r = process.platform === 'win32' ? run('where', ['openlogos']) : run('/bin/sh', ['-c', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}

/** 正式模式：入口 realpath 必须在全局 npm prefix 的包目录内（排除 workspace link 与一次性隔离 prefix）。 */
function globalInstallProblem(entryPath) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  // --logs-max=0：只读查询也不在用户 npm 缓存目录写调试日志（code-r1 F1）
  const r = run(npm, ['prefix', '-g', '--logs-max=0']);
  if (r.status !== 0 || !r.stdout.trim()) return `无法读取 npm prefix -g：${(r.stderr || '').slice(0, 200)}`;
  const prefix = realpathSync(r.stdout.trim());
  const nodeModules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  const pkgDir = join(nodeModules, '@miniidealab', 'openlogos');
  const within = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  if (lstatSync(pkgDir).isSymbolicLink()) return `全局包目录 ${pkgDir} 是链接（workspace link 不构成安装态证据）`;
  const realPkgDir = realpathSync(pkgDir);
  if (!within(realpathSync(nodeModules), realPkgDir)) return `全局包目录 ${pkgDir} 解引用后离开全局 node_modules 区域`;
  if (!within(realPkgDir, entryPath)) return `入口 ${entryPath} 不在全局 npm prefix 的包目录 ${pkgDir} 内`;
  if (within(repoRoot, entryPath)) return `入口 ${entryPath} 位于工作区 ${repoRoot} 内`;
  return null;
}

let exitCode = 0;
try {
  const entry = commandLookup();
  const problem = !entry ? '找不到 openlogos 入口' : (SELF_TEST ? null : globalInstallProblem(entry));
  if (problem) {
    for (const id of DEFAULT_ENV_SMOKE_IDS) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
  } else {
    for (const id of DEFAULT_ENV_SMOKE_IDS) {
      const started = Date.now();
      try {
        const { detail, evidence } = await CASES[id](entry);
        results.set(id, { status: 'pass', detail, evidence: [`entry=${entry}`, ...evidence], duration_ms: Date.now() - started });
      } catch (error) {
        results.set(id, {
          status: 'fail', detail: error instanceof Error ? error.message : String(error),
          evidence: [`entry=${entry}`], duration_ms: Date.now() - started,
        });
      }
    }
  }
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = DEFAULT_ENV_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${DEFAULT_ENV_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
