#!/usr/bin/env node
/**
 * SMOKE-core-258～SMOKE-core-262 — 0.16.5 环境晋级与审批的**安装态**取证（来源提案 environment-promotion-approval，功能规格 §2.95）。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *   - SMOKE-core-258：安装态版本、制品身份与本仓 sync 同源（版本取 cli/src/lib/local-release-candidate.ts，不写死字面量）。
 *   - SMOKE-core-259：安装态晋级拦截与 --force-promote 留痕越过。
 *   - SMOKE-core-260：安装态审批拦截、写入、幂等与使用。
 *   - SMOKE-core-261：安装态 dry-run、回滚审批与 deploy-done 受门拒绝。
 *   - SMOKE-core-262：安装态未配置门禁零回归。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目与一次性「发布目录」内，结束即删除（含运行态账本、部署日志、锁、
 * 隔离工作树）；只读本机全局安装态（不安装 / 卸载），不触碰本仓活跃提案、本仓 logos/resources/、本仓运行态目录与
 * 用户其他仓库（包括 runlogos）；唯一读取本仓的是 SMOKE-core-258 ④ 对本仓托管副本的只读比对。
 * runner 以子进程直接调用 CLI（不经 AI 宿主，因此不经过 guard）；guard 的受限命令与登记表保护由源码测试覆盖，
 * 安装态只核对 guard-check 同源。不触发真实 CI、不访问远程服务；命令图中不出现任何公网发布命令（夹具项目内为构造用例
 * 创建的本地 tag 除外）。判据用行为断言（`--format json` 结构化字段、退出码与命令实际输出）。
 *
 * 环境不具备时写显式 skip（不标 platform-unavailable，均为可补齐的环境缺口；有 skip 时不得写 SMOKE_PASS）：
 *   - 缺候选 tarball：来源依次为 OPENLOGOS_PROMOTION_TARBALL / OPENLOGOS_TARBALL 与本仓冻结的唯一候选制品
 *     cli/miniidealab-openlogos-<候选版本>.tgz——自动流程运行 `openlogos smoke` 时不设置环境变量，适用性判定不得只靠环境变量；
 *     候选版本早于 0.16.5 时本提案的候选制品尚未产出，同样按缺候选制品处理；
 *   - 部署记录（logos/resources/verify/deployment-report.md）未记载候选版本与 tarball SHA-256；
 *   - 本仓未执行 sync（不存在托管副本 .claude/openlogos/bin/guard-check 或 logos/skills/deployment-*\/SKILL.md）。
 * 托管副本存在但与全局包字节不一致属 SMOKE-core-258 ④ 的 fail，不是 skip。
 *
 * **正式安装态模式**（缺省）：只认 PATH 中 `openlogos` 且 realpath 位于 `npm prefix -g` 的全局包目录内。
 * **自测模式**（仅供 runner 自身验证，须同时满足）：OPENLOGOS_PROMOTION_SMOKE_SELF_TEST=1、OPENLOGOS_PROMOTION_SMOKE_ENTRY
 * 注入入口、OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过上述环境前置，结果以 environment=self-test-injected-entry 写入。
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

const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const TARBALL_ENV = ['OPENLOGOS_PROMOTION_TARBALL', 'OPENLOGOS_TARBALL'];
const MIN_VERSION = '0.16.5';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
/** SMOKE-core-258 ④ 比对的本仓托管副本与全局包内同名文件。 */
const SYNC_COPIES = [
  { repo: '.claude/openlogos/bin/guard-check', pkg: 'claude-plugin-template/bin/guard-check' },
  { repo: 'logos/skills/deployment-designer/SKILL.md', pkg: 'skills/deployment-designer/SKILL.md' },
  { repo: 'logos/skills/deployment-executor/SKILL.md', pkg: 'skills/deployment-executor/SKILL.md' },
];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const INJECTED_ENTRY = process.env.OPENLOGOS_PROMOTION_SMOKE_ENTRY;
const SELF_TEST = process.env.OPENLOGOS_PROMOTION_SMOKE_SELF_TEST === '1';
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
      || key.startsWith('OPENLOGOS_PROMOTION_') || key.startsWith('OPENLOGOS_DEPLOY_')) delete env[key];
  }
  return { ...env, ...extra };
}
const cliRaw = (entry, cwd, args, extra = {}) =>
  spawnSync(cliBin(entry), cliArgs(entry, args), { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: isolatedEnv(extra) });
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-promotion-${tag}-`));
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

/** 安装包根：入口向上找同时含 package.json 与 asset-manifest.json 的目录。 */
function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

function candidateVersion() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
  return /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null;
}

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
const FIXTURE_SLUG = 'promotion-smoke-fixture';
const FIXTURE_RESULT = 'logos/resources/verify/smoke-results.jsonl';
const GATE_RECORD_FIELDS = ['approval_id', 'promoted_from', 'promotion_override_reason'];
const GATE_VIEW_FIELDS = ['promote_from', 'require_approval', 'open_approvals', 'promotion'];
/** 夹具部署脚本：把注入的环境、版本与脚本标识追加写入一次性发布目录。 */
const deployScript = label => [
  '#!/bin/sh',
  'mkdir -p "$PUBLISH_DIR"',
  `echo "$OPENLOGOS_DEPLOY_ENV ${label} $OPENLOGOS_DEPLOY_REF" >> "$PUBLISH_DIR/deploys.txt"`,
  '',
].join('\n');
/** 夹具 smoke runner：读取注入的 OPENLOGOS_SMOKE_ENV，写入结果行 target_environment。 */
const FIXTURE_RUNNER = [
  "import { mkdirSync, writeFileSync } from 'node:fs';",
  "import { dirname } from 'node:path';",
  `const p = ${JSON.stringify(FIXTURE_RESULT)};`,
  'const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;',
  'mkdirSync(dirname(p), { recursive: true });',
  "writeFileSync(p, JSON.stringify({ id: 'SMOKE-core-901', status: 'pass', timestamp: new Date().toISOString(), target_environment: env }) + '\\n');",
].join('\n');

function git(dir, args) {
  const r = run('git', args, dir);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 300)}`);
  return r.stdout.trim();
}

/**
 * 一次性 git 项目：经全局入口 init，登记 staging（script，无门）；gated=true 时另登记 prod（script，
 * promote_from: staging、require_approval: true）。按标签 v1、v2 提交各版本部署脚本，之后另有一次提交作为 HEAD。
 */
function initProject(entry, { gated = true } = {}) {
  const dir = newTempDir('project');
  const publish = newTempDir('publish');
  const init = cliRaw(entry, dir, ['init', '--locale', 'en', '--ai-tool', 'claude-code']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || '').slice(0, 300)}`);
  put(dir, 'logos/environments.yaml', [
    'schema_version: 1',
    'environments:',
    '  - id: staging',
    '    name: Staging',
    '    tier: staging',
    '    deploy: {mode: script, script: deploy/run.sh}',
    ...(gated ? [
      '  - id: prod',
      '    name: Production',
      '    tier: prod',
      '    deploy: {mode: script, script: deploy/run.sh}',
      '    promote_from: staging',
      '    require_approval: true',
    ] : []),
    '',
  ].join('\n'));
  put(dir, 'logos/resources/test/smoke/core-smoke-test-cases.md', '| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  put(dir, 'scripts/smoke-promotion-fixture.mjs', FIXTURE_RUNNER);
  const cfgPath = join(dir, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.smoke = { ...(cfg.smoke || {}), result_path: FIXTURE_RESULT, command: 'node scripts/smoke-promotion-fixture.mjs', sandbox_mode: 'off' };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const gitignore = join(dir, '.gitignore');
  writeFileSync(gitignore, `${existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : ''}\nlogos/.openlogos-runtime/\nlogos/environments.yaml\n`);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'smoke']);
  git(dir, ['config', 'user.email', 'smoke@example.invalid']);
  const commits = {};
  for (const tag of ['v1', 'v2']) {
    put(dir, 'deploy/run.sh', deployScript(tag), 0o755);
    put(dir, 'payload.txt', `${tag}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', tag]);
    git(dir, ['tag', tag]);
    commits[tag] = git(dir, ['rev-parse', 'HEAD']);
  }
  put(dir, 'deploy/run.sh', deployScript('head'), 0o755);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head']);
  commits.HEAD = git(dir, ['rev-parse', 'HEAD']);
  return { dir, publish, commits, env: { PUBLISH_DIR: publish } };
}

/** 夹具项目内的活跃提案（ready-to-deploy：VERIFY_PASS + LOOP_ITERS pass）。 */
function addReadyProposal(dir) {
  const rel = `logos/changes/${FIXTURE_SLUG}`;
  put(dir, `${rel}/proposal.md`, [
    '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：生产',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
  ].join('\n'));
  put(dir, `${rel}/tasks.md`, '# 实现任务\n\n## [deploy] 发布\n- [ ] 发布到生产\n');
  put(dir, `${rel}/VERIFY_PASS`, '');
  put(dir, `${rel}/LOOP_ITERS`, `${JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module: 'core', timestamp: new Date().toISOString() })}\n`);
  put(dir, 'logos/.openlogos-guard', JSON.stringify({ activeChange: FIXTURE_SLUG, module: 'core' }));
  put(dir, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nfixture\n');
  return join(dir, rel);
}

const deploys = publish => (existsSync(join(publish, 'deploys.txt')) ? readFileSync(join(publish, 'deploys.txt'), 'utf8').trim().split('\n') : []);
function ledgerRows(dir) {
  const p = join(dir, LEDGER_REL);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}
const fileSha = p => (existsSync(p) ? sha256(readFileSync(p)) : null);

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

/** staging 部署指定版本后以真实 smoke 验证；返回问题描述（无问题为 null）。 */
function verifyOnStaging(entry, p, tag, evidence) {
  const d = cliJson(entry, p.dir, ['deploy', '--env', 'staging', '--ref', tag], p.env);
  const sm = cliJson(entry, p.dir, ['smoke', '--env', 'staging']);
  const last = ledgerRows(p.dir).filter(r => r.kind === 'smoke').pop();
  evidence.push(`staging ${tag}: deploy ${brief(d)}; smoke exit=${sm.status} ledger_smoke=${JSON.stringify(last ?? null).slice(0, 300)}`);
  if (d.status !== 0) return `staging 部署 ${tag} 失败：${brief(d)}`;
  if (sm.status !== 0 || last?.environment !== 'staging' || last?.ref !== p.commits[tag] || last?.verified !== true) {
    return `staging smoke 应以 verified=true 验证 ${tag}，实际 exit=${sm.status} ${JSON.stringify(last ?? null).slice(0, 300)}`;
  }
  return null;
}

/**
 * 每个用例：(entry) => { detail, evidence }，失败抛错。
 */
const CASES = {
  'SMOKE-core-258': async (entry) => {
    const problems = [];
    const evidence = [`entry_realpath=${entry}`];
    // ① 版本：全局 --version == 部署记录候选版本
    const candidate = candidateVersion();
    if (!candidate) throw new Error('无法读取候选版本（cli/src/lib/local-release-candidate.ts 缺失或无 LOCAL_RELEASE_CANDIDATE_VERSION）');
    const version = (cliRaw(entry, repoRoot, ['--version']).stdout || '').trim();
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (version !== candidate) problems.push(`① --version 为 ${version}，部署记录候选版本为 ${candidate}`);
    // ② asset-manifest 自洽
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    evidence.push(`package_root=${pkg}`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`payload_hash=${manifest.payloadHash}`);
    if (manifest.version !== version) problems.push(`② asset-manifest version ${manifest.version} 与 --version ${version} 不一致`);
    const assetLib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
    try { assetLib.validateAssetManifest(manifest, pkg); } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    // ③ 包内 approve 命令与 guard-check 的受限识别、已配置门禁的登记表判定
    if (!existsSync(join(pkg, 'dist/commands/approve.js'))) problems.push('③ 包内缺少 dist/commands/approve.js');
    const index = existsSync(join(pkg, 'dist/index.js')) ? readFileSync(join(pkg, 'dist/index.js'), 'utf8') : '';
    if (!/case 'approve'/.test(index)) problems.push('③ dist/index.js 未注册 approve');
    const guardPath = join(pkg, 'claude-plugin-template/bin/guard-check');
    const guard = existsSync(guardPath) ? readFileSync(guardPath, 'utf8') : '';
    for (const [label, needle] of [['openlogos approve 受限识别', 'approve'], ['--force-promote 受限识别', '--force-promote'],
      ['已配置门禁的登记表判定', 'registry_has_gates'], ['门禁字段识别', 'require_approval']]) {
      if (!guard.includes(needle)) problems.push(`③ claude-plugin-template/bin/guard-check 缺少${label}（${needle}）`);
    }
    // ④ 本仓托管副本与全局包内同名文件逐字节一致
    for (const copy of SYNC_COPIES) {
      const a = fileSha(join(repoRoot, copy.repo));
      const b = fileSha(join(pkg, copy.pkg));
      evidence.push(`${copy.repo}: repo_sha256=${a} package_sha256=${b}`);
      if (a === null) { problems.push(`④ 本仓缺少托管副本 ${copy.repo}`); continue; }
      if (b === null) { problems.push(`④ 全局包内缺少 ${copy.pkg}`); continue; }
      if (a !== b) problems.push(`④ 本仓 ${copy.repo} 与全局包 ${copy.pkg} 字节不一致（需重新执行本仓 openlogos sync 后复核）`);
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: `安装态身份同源（${version}）：manifest 自洽，包内含 approve 命令与 guard-check 新规则，本仓托管副本与全局包一致`, evidence };
  },

  'SMOKE-core-259': (entry) => {
    const problems = [];
    const evidence = [];
    const p = initProject(entry);
    const { dir, publish, commits } = p;
    evidence.push(`project=${dir}`, `publish=${publish}`);
    // ① 审批 v1
    const a1 = cliJson(entry, dir, ['approve', '--env', 'prod', '--ref', 'v1']);
    evidence.push(`① approve v1: ${brief(a1)}`);
    if (a1.status !== 0 || a1.data?.created !== true || a1.data?.ref !== commits.v1) problems.push(`① 应写入对 v1 的审批，实际 ${brief(a1)}`);
    // ② 上游未验证：DEPLOY_PROMOTION_UNVERIFIED，零执行，账本无 deploy 记录
    const d2 = cliJson(entry, dir, ['deploy', '--env', 'prod', '--ref', 'v1'], p.env);
    evidence.push(`② deploy prod v1: ${brief(d2)}`);
    if (d2.status !== 1 || d2.error?.code !== 'DEPLOY_PROMOTION_UNVERIFIED') problems.push(`② 应 DEPLOY_PROMOTION_UNVERIFIED、退出码 1，实际 ${brief(d2)}`);
    if (deploys(publish).length !== 0) problems.push(`② 发布目录应无痕迹，实际 ${JSON.stringify(deploys(publish))}`);
    if (ledgerRows(dir).some(r => r.kind === 'deploy')) problems.push('② 账本不应有 deploy 记录');
    // ③ staging 部署并验证 v1
    const v = verifyOnStaging(entry, p, 'v1', evidence);
    if (v) problems.push(`③ ${v}`);
    // ④ 晋级通过并使用 ① 的审批
    const d4 = cliJson(entry, dir, ['deploy', '--env', 'prod', '--ref', 'v1'], p.env);
    const r4 = ledgerRows(dir).filter(r => r.kind === 'deploy' && r.environment === 'prod').pop();
    evidence.push(`④ deploy prod v1: ${brief(d4)} record=${JSON.stringify(r4 ?? null).slice(0, 300)}`);
    if (d4.status !== 0 || r4?.result !== 'done' || r4?.promoted_from !== 'staging' || r4?.approval_id !== a1.data?.approval_id) {
      problems.push(`④ 应成功并记录 promoted_from=staging、approval_id=①，实际 ${brief(d4)}`);
    }
    // ⑤ 留痕越过：v2 上游未验证
    const a5 = cliJson(entry, dir, ['approve', '--env', 'prod', '--ref', 'v2']);
    const d5 = cliJson(entry, dir, ['deploy', '--env', 'prod', '--ref', 'v2', '--force-promote', 'smoke 越过'], p.env);
    const r5 = ledgerRows(dir).filter(r => r.kind === 'deploy' && r.environment === 'prod').pop();
    evidence.push(`⑤ approve v2: ${brief(a5)}; deploy --force-promote: ${brief(d5)} record=${JSON.stringify(r5 ?? null).slice(0, 300)}`);
    if (d5.status !== 0 || r5?.ref_requested !== commits.v2 || r5?.promotion_override_reason !== 'smoke 越过' || r5?.promoted_from !== null) {
      problems.push(`⑤ 应成功并记录 promotion_override_reason="smoke 越过"、promoted_from=null，实际 ${brief(d5)}`);
    }
    evidence.push(`publish=${JSON.stringify(deploys(publish))}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '上游未验证时晋级零执行；staging smoke 验证后晋级成功并使用审批；--force-promote 留痕越过', evidence };
  },

  'SMOKE-core-260': (entry) => {
    const problems = [];
    const evidence = [];
    const p = initProject(entry);
    const { dir, publish, commits } = p;
    evidence.push(`project=${dir}`);
    for (const tag of ['v1', 'v2']) {
      const v = verifyOnStaging(entry, p, tag, evidence);
      if (v) throw new Error(`前置：${v}`);
    }
    const prodStarts = () => deploys(publish).filter(l => l.startsWith('prod ')).length;
    // ① 未审批：DEPLOY_APPROVAL_REQUIRED，给出可直接执行的命令，零执行
    const d1 = cliJson(entry, dir, ['deploy', '--env', 'prod', '--ref', 'v1'], p.env);
    evidence.push(`① ${brief(d1)}`);
    if (d1.status !== 1 || d1.error?.code !== 'DEPLOY_APPROVAL_REQUIRED'
      || d1.error?.details?.approve_command !== `openlogos approve --env prod --ref ${commits.v1}`) {
      problems.push(`① 应 DEPLOY_APPROVAL_REQUIRED 且 approve_command 为命令原文，实际 ${brief(d1)}`);
    }
    if (prodStarts() !== 0) problems.push('① 不应执行 prod 部署脚本');
    // ② 连续两次 approve：同一 approval_id，第二次 created=false，账本只多一条
    const before = ledgerRows(dir).filter(r => r.kind === 'approval').length;
    const a = cliJson(entry, dir, ['approve', '--env', 'prod', '--ref', 'v1']);
    const b = cliJson(entry, dir, ['approve', '--env', 'prod', '--ref', 'v1']);
    const after = ledgerRows(dir).filter(r => r.kind === 'approval').length;
    evidence.push(`② first: ${brief(a)}; second: ${brief(b)}; approvals ${before}→${after}`);
    if (a.data?.created !== true || b.data?.created !== false || a.data?.approval_id !== b.data?.approval_id || after !== before + 1) {
      problems.push('② 两次 approve 应返回同一 approval_id、第二次 created=false、账本只多一条');
    }
    // ③ 部署成功并使用审批
    const d3 = cliJson(entry, dir, ['deploy', '--env', 'prod', '--ref', 'v1'], p.env);
    const r3 = ledgerRows(dir).filter(r => r.kind === 'deploy' && r.environment === 'prod').pop();
    evidence.push(`③ ${brief(d3)}`);
    if (d3.status !== 0 || r3?.approval_id !== a.data?.approval_id) problems.push(`③ 应成功且记录 approval_id 等于 ②，实际 ${brief(d3)}`);
    // ④ env show：open_approvals 为空，promotion.candidate_ref 非空
    const show = cliJson(entry, dir, ['env', 'show', 'prod']);
    evidence.push(`④ open_approvals=${JSON.stringify(show.data?.open_approvals)} promotion=${JSON.stringify(show.data?.promotion)}`);
    if (!Array.isArray(show.data?.open_approvals) || show.data.open_approvals.length !== 0 || !show.data?.promotion?.candidate_ref) {
      problems.push('④ open_approvals 应为空、promotion.candidate_ref 应非空');
    }
    // ⑤ 再次部署同一版本重新要求审批
    const d5 = cliJson(entry, dir, ['deploy', '--env', 'prod', '--ref', 'v1'], p.env);
    evidence.push(`⑤ ${brief(d5)}`);
    if (d5.status !== 1 || d5.error?.code !== 'DEPLOY_APPROVAL_REQUIRED') problems.push(`⑤ 应再次 DEPLOY_APPROVAL_REQUIRED，实际 ${brief(d5)}`);
    if (prodStarts() !== 1) problems.push(`prod 部署脚本应只运行一次，实际 ${prodStarts()} 次`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '未审批零执行并给出 approve 命令；approve 幂等；审批后部署成功并使用，再次部署重新要求审批', evidence };
  },

  'SMOKE-core-261': (entry) => {
    const problems = [];
    const evidence = [];
    const p = initProject(entry);
    const { dir, commits } = p;
    evidence.push(`project=${dir}`);
    for (const tag of ['v1', 'v2']) {
      const v = verifyOnStaging(entry, p, tag, evidence);
      if (v) throw new Error(`前置：${v}`);
      cliJson(entry, dir, ['approve', '--env', 'prod', '--ref', tag]);
      const d = cliJson(entry, dir, ['deploy', '--env', 'prod', '--ref', tag], p.env);
      if (d.status !== 0) throw new Error(`前置：prod 部署 ${tag} 失败：${brief(d)}`);
    }
    const proposalDir = addReadyProposal(dir);
    // ① 对 v2 审批后 dry-run：plan.approval_id 为该审批，零写入，审批仍未使用
    const a = cliJson(entry, dir, ['approve', '--env', 'prod', '--ref', 'v2']);
    const before = treeHash(dir);
    const dry = cliJson(entry, dir, ['deploy', '--env', 'prod', '--ref', 'v2', '--channel', 'version', '--dry-run'], p.env);
    const unchanged = treeHash(dir) === before;
    const open = cliJson(entry, dir, ['env', 'show', 'prod']).data?.open_approvals ?? [];
    evidence.push(`① approve: ${brief(a)}; dry-run: ${brief(dry)}; snapshot_unchanged=${unchanged}; open=${JSON.stringify(open.map(o => o.approval_id))}`);
    if (dry.status !== 0 || dry.data?.status !== 'dry-run' || dry.data?.plan?.approval_id !== a.data?.approval_id) {
      problems.push(`① 应 status=dry-run 且 plan.approval_id 为该审批，实际 ${brief(dry)}`);
    }
    if (!unchanged) problems.push('① dry-run 前后临时项目文件快照不一致');
    if (!open.some(o => o.approval_id === a.data?.approval_id)) problems.push('① dry-run 后该审批应仍在 open_approvals');
    // ② 回滚目标 v1 未审批：DEPLOY_APPROVAL_REQUIRED（不报晋级错误）
    const rb = cliJson(entry, dir, ['deploy', '--env', 'prod', '--rollback'], p.env);
    evidence.push(`② rollback: ${brief(rb)}`);
    if (rb.status !== 1 || rb.error?.code !== 'DEPLOY_APPROVAL_REQUIRED' || rb.error?.details?.requested !== commits.v1) {
      problems.push(`② 应 DEPLOY_APPROVAL_REQUIRED（目标 v1），实际 ${brief(rb)}`);
    }
    // ③ deploy-done 对受门环境拒绝，零写入
    const state = () => JSON.stringify([
      fileSha(join(proposalDir, 'tasks.md')), fileSha(join(proposalDir, 'DEPLOY_DONE')), fileSha(join(dir, LEDGER_REL)),
    ]);
    const s0 = state();
    const dd = cliJson(entry, dir, ['deploy-done', '--env', 'prod', '--ref', 'HEAD']);
    evidence.push(`③ deploy-done: ${brief(dd)}`);
    if (dd.status !== 1 || dd.error?.code !== 'DEPLOY_DONE_GATED_ENV') problems.push(`③ 应 DEPLOY_DONE_GATED_ENV、退出码 1，实际 ${brief(dd)}`);
    if (state() !== s0) problems.push('③ tasks.md、DEPLOY_DONE 或账本字节与执行前不一致');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: 'dry-run 给出将用的审批且零写入、不使用审批；回滚仍要求审批；deploy-done 对受门环境零写入拒绝', evidence };
  },

  'SMOKE-core-262': (entry) => {
    const problems = [];
    const evidence = [];
    const p = initProject(entry, { gated: false });
    const { dir } = p;
    evidence.push(`project=${dir}`);
    // ① 未配置门禁的部署：记录不含三个门禁字段
    const d = cliJson(entry, dir, ['deploy', '--env', 'staging', '--ref', 'v1'], p.env);
    const rec = ledgerRows(dir).filter(r => r.kind === 'deploy').pop();
    evidence.push(`① ${brief(d)} record_keys=${JSON.stringify(Object.keys(rec ?? {}))}`);
    if (d.status !== 0 || !rec) problems.push(`① 应成功，实际 ${brief(d)}`);
    for (const k of GATE_RECORD_FIELDS) {
      if (rec && Object.prototype.hasOwnProperty.call(rec, k)) problems.push(`① 记录不应含 ${k}`);
      if (d.data && Object.prototype.hasOwnProperty.call(d.data, k)) problems.push(`① 输出不应含 ${k}`);
    }
    // ②③ 视图不含四个新字段
    const show = cliJson(entry, dir, ['env', 'show', 'staging']);
    const status = cliJson(entry, dir, ['status']);
    const statusView = (status.data?.environments ?? []).find(e => e.id === 'staging');
    evidence.push(`② env show keys=${JSON.stringify(Object.keys(show.data ?? {}))}; ③ status view keys=${JSON.stringify(Object.keys(statusView ?? {}))}`);
    if (show.status !== 0 || status.status !== 0 || !statusView) problems.push(`②③ env show / status 应成功，实际 ${brief(show)} / ${brief(status)}`);
    for (const k of GATE_VIEW_FIELDS) {
      if (show.data && Object.prototype.hasOwnProperty.call(show.data, k)) problems.push(`② env show 不应含 ${k}`);
      if (statusView && Object.prototype.hasOwnProperty.call(statusView, k)) problems.push(`③ status 不应含 ${k}`);
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '未配置门禁的环境部署记录与视图不含晋级与审批字段', evidence };
  },
};

export const PROMOTION_SMOKE_IDS = Object.keys(CASES);

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: PROMOTION_SMOKE_IDS,
    environment: FORMAL_ENVIRONMENT,
    self_test_environment: SELF_TEST_ENVIRONMENT,
    required_source_env: TARBALL_ENV,
    min_candidate_version: MIN_VERSION,
    deployment_record: DEPLOYMENT_RECORD,
    repo_sync_copies: SYNC_COPIES.map(c => c.repo),
    public_release_commands: [],
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

if (INJECTED_ENTRY !== undefined && !SELF_TEST) refuse('设置了 OPENLOGOS_PROMOTION_SMOKE_ENTRY 但未声明自测（OPENLOGOS_PROMOTION_SMOKE_SELF_TEST=1）');
if (SELF_TEST && INJECTED_ENTRY === undefined) refuse('自测模式需要 OPENLOGOS_PROMOTION_SMOKE_ENTRY 指定注入入口');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST) {
  // 环境前置（缺失即显式 skip）：候选版本与 tarball → 部署记录 → 本仓 sync
  const skip = (reason, missing) => exitNotApplicable(PROMOTION_SMOKE_IDS, { reason, missing, environment: ENVIRONMENT, repoRoot });
  const version = candidateVersion();
  if (!versionAtLeast(version, MIN_VERSION)) {
    skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-tarball']);
  }
  if (!TARBALL_ENV.some(name => process.env[name])) {
    const fallback = join(repoRoot, `cli/miniidealab-openlogos-${version}.tgz`);
    if (existsSync(fallback)) process.env.OPENLOGOS_PROMOTION_TARBALL = fallback;
  }
  if (!TARBALL_ENV.some(name => process.env[name])) {
    skip(`缺少 ${version} 候选 tarball：未设置 ${TARBALL_ENV.join(' / ')}，本仓也没有 cli/miniidealab-openlogos-${version}.tgz（部署窗口外不适用）`, ['candidate-tarball']);
  }
  const tarball = resolve(repoRoot, process.env.OPENLOGOS_PROMOTION_TARBALL || process.env.OPENLOGOS_TARBALL);
  if (!existsSync(tarball)) skip(`候选 tarball 不存在：${tarball}`, ['candidate-tarball']);
  const tarballSha = sha256(readFileSync(tarball));
  const recordPath = join(repoRoot, DEPLOYMENT_RECORD);
  const record = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : '';
  if (!record.includes(version) || !record.includes(tarballSha)) {
    skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version} 与 tarball SHA-256 ${tarballSha}`, ['deployment-record']);
  }
  const missingCopies = SYNC_COPIES.map(c => c.repo).filter(rel => !existsSync(join(repoRoot, rel)));
  if (missingCopies.length > 0) skip(`本仓未执行 openlogos sync（缺少托管副本 ${missingCopies.join('、')}）`, ['repo-sync']);
}

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of PROMOTION_SMOKE_IDS) {
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
  const r = run(npm, ['prefix', '-g']);
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
    for (const id of PROMOTION_SMOKE_IDS) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
  } else {
    for (const id of PROMOTION_SMOKE_IDS) {
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

const failed = PROMOTION_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${PROMOTION_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
