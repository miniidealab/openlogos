#!/usr/bin/env node
/**
 * SMOKE-core-254～SMOKE-core-257 — 0.16.4 环境部署执行的**安装态**取证（来源提案 environment-deploy，功能规格 §2.94）。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *   - SMOKE-core-254：安装态版本、制品身份与本仓 sync 同源（版本取 cli/src/lib/local-release-candidate.ts，不写死字面量）。
 *   - SMOKE-core-255：安装态 script 版本通道、隔离工作树与回滚。
 *   - SMOKE-core-256：安装态提案通道首次部署（无旧部署报告）与 smoke 部署身份核对（SMOKE_DEPLOY_SUPERSEDED）。
 *   - SMOKE-core-257：安装态 dry-run、失败记录、密钥遮盖与并发锁。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目与一次性「发布目录」内，结束即删除（含运行态账本、部署日志、锁、
 * 隔离工作树）；只读本机全局安装态（不安装 / 卸载），不触碰本仓活跃提案、本仓 logos/resources/、本仓运行态目录与
 * 用户其他仓库（包括 runlogos）；唯一读取本仓的是 SMOKE-core-254 ④ 对本仓托管 Skill 副本的只读比对。
 * 不触发真实 CI、不访问远程服务；命令图中不出现任何公网发布命令（夹具项目内为构造用例创建的本地 tag 除外）。
 * 判据用行为断言（`--format json` 结构化字段、退出码与命令实际输出），版本号相等只证明装了新包、不证明行为生效。
 *
 * 环境不具备时写显式 skip（不标 platform-unavailable，均为可补齐的环境缺口；有 skip 时不得写 SMOKE_PASS）：
 *   - 缺候选 tarball：来源依次为 OPENLOGOS_ENVDEPLOY_TARBALL / OPENLOGOS_TARBALL 与本仓冻结的唯一候选制品
 *     cli/miniidealab-openlogos-<候选版本>.tgz——自动流程运行 `openlogos smoke` 时不设置环境变量，适用性判定不得只靠环境变量；
 *     候选版本早于 0.16.4 时本提案的候选制品尚未产出，同样按缺候选制品处理；
 *   - 部署记录（logos/resources/verify/deployment-report.md）未记载候选版本与 tarball SHA-256；
 *   - 本仓未执行 sync（不存在托管副本 logos/skills/deployment-designer|deployment-executor/SKILL.md）。
 * 托管副本存在但与全局包字节不一致属 SMOKE-core-254 ④ 的 fail，不是 skip。
 *
 * **正式安装态模式**（缺省）：只认 PATH 中 `openlogos` 且 realpath 位于 `npm prefix -g` 的全局包目录内。
 * **自测模式**（仅供 runner 自身验证，须同时满足）：OPENLOGOS_ENVDEPLOY_SMOKE_SELF_TEST=1、OPENLOGOS_ENVDEPLOY_SMOKE_ENTRY
 * 注入入口、OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过上述环境前置，结果以 environment=self-test-injected-entry 写入。
 */
import { spawn, spawnSync } from 'node:child_process';
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
const TARBALL_ENV = ['OPENLOGOS_ENVDEPLOY_TARBALL', 'OPENLOGOS_TARBALL'];
const MIN_VERSION = '0.16.4';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const SKILLS = ['deployment-designer', 'deployment-executor'];
const REPO_SKILL_COPY = skill => `logos/skills/${skill}/SKILL.md`;
const PACKAGE_CARRIERS = ['dist/commands/deploy.js', 'dist/lib/deploy-runner.js', 'dist/lib/deploy-ci.js'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const INJECTED_ENTRY = process.env.OPENLOGOS_ENVDEPLOY_SMOKE_ENTRY;
const SELF_TEST = process.env.OPENLOGOS_ENVDEPLOY_SMOKE_SELF_TEST === '1';
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
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'SMOKE_DEPLOY_TOKEN'
      || key.startsWith('OPENLOGOS_ENVDEPLOY_') || key.startsWith('OPENLOGOS_DEPLOY_')) delete env[key];
  }
  return { ...env, ...extra };
}
const cliRaw = (entry, cwd, args, extra = {}) =>
  spawnSync(cliBin(entry), cliArgs(entry, args), { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: isolatedEnv(extra) });
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-envdeploy-${tag}-`));
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
  return parseResult(r);
}
function parseResult(r) {
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
const FIXTURE_SLUG = 'envdeploy-smoke-fixture';
const FIXTURE_RESULT = 'logos/resources/verify/smoke-results.jsonl';
const REPORT_REL = 'logos/resources/verify/deployment-report.md';
const TOKEN_VALUE = 'smoke-secret-value-9f3a';
/**
 * 夹具部署脚本：把注入的 OPENLOGOS_DEPLOY_REF、工作目录 HEAD、脚本版本与 payload 写入一次性发布目录；
 * behavior=fail 时打印密钥值后以 3 退出，behavior=sleep 时先休眠数秒（用于并发占用）。
 */
const deployScript = (label, behavior = 'ok') => [
  '#!/bin/sh',
  'mkdir -p "$PUBLISH_DIR"',
  'echo "start $OPENLOGOS_DEPLOY_ID" >> "$PUBLISH_DIR/starts.txt"',
  `echo "deploying ${label} token=$SMOKE_DEPLOY_TOKEN"`,
  behavior === 'fail' ? 'exit 3' : '',
  behavior === 'sleep' ? 'sleep 4' : '',
  '{',
  '  echo "ref=$OPENLOGOS_DEPLOY_REF"',
  '  echo "head=$(git rev-parse HEAD)"',
  `  echo "script=${label}"`,
  '  echo "payload=$(cat payload.txt)"',
  '} > "$PUBLISH_DIR/last.txt"',
  '',
].filter(line => line !== '').join('\n') + '\n';
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
 * 一次性 git 项目：经全局入口 init，登记 staging（script 方式），按标签提交各版本部署脚本。
 * versions: [{ tag, label, behavior }]，按顺序提交并打本地 tag；最后一版之后另有一次提交作为 HEAD。
 */
function initDeployProject(entry, { versions, secrets = [], proposal = false }) {
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
    ...(secrets.length > 0 ? [`    secrets: [${secrets.join(', ')}]`] : []),
    '    deploy: {mode: script, script: deploy/run.sh, args: ["{env}", "{ref_short}"]}',
    '',
  ].join('\n'));
  put(dir, 'logos/resources/test/smoke/core-smoke-test-cases.md', '| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  put(dir, 'scripts/smoke-envdeploy-fixture.mjs', FIXTURE_RUNNER);
  const cfgPath = join(dir, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.smoke = { ...(cfg.smoke || {}), result_path: FIXTURE_RESULT, command: 'node scripts/smoke-envdeploy-fixture.mjs', sandbox_mode: 'off' };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  let proposalDir = null;
  if (proposal) {
    const rel = `logos/changes/${FIXTURE_SLUG}`;
    proposalDir = join(dir, rel);
    put(dir, `${rel}/deltas/test/smoke/core-smoke-test-cases.md`, '## ADDED — 夹具 smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
    put(dir, `${rel}/proposal.md`, [
      '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：预发',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
    ].join('\n'));
    put(dir, `${rel}/tasks.md`, '# 实现任务\n\n## [deploy] 发布\n- [ ] 发布到预发\n- [ ] 复核\n');
    put(dir, `${rel}/VERIFY_PASS`, '');
    // launched 模块的 verify 同时写一行 pass 的 LOOP_ITERS（切片循环收敛），否则提案步骤停在 ready-to-verify
    put(dir, `${rel}/LOOP_ITERS`, `${JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module: 'core', timestamp: new Date().toISOString() })}\n`);
    put(dir, 'logos/.openlogos-guard', JSON.stringify({ activeChange: FIXTURE_SLUG, module: 'core' }));
  }
  const gitignore = join(dir, '.gitignore');
  writeFileSync(gitignore, `${existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : ''}\nlogos/.openlogos-runtime/\nlogos/environments.yaml\n`);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'smoke']);
  git(dir, ['config', 'user.email', 'smoke@example.invalid']);
  const commits = {};
  for (const v of versions) {
    put(dir, 'deploy/run.sh', deployScript(v.label, v.behavior), 0o755);
    put(dir, 'payload.txt', `${v.label}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', v.label]);
    git(dir, ['tag', v.tag]);
    commits[v.tag] = git(dir, ['rev-parse', 'HEAD']);
  }
  put(dir, 'deploy/run.sh', deployScript('head'), 0o755);
  put(dir, 'payload.txt', 'head\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head']);
  commits.HEAD = git(dir, ['rev-parse', 'HEAD']);
  return { dir, publish, proposalDir, commits };
}

const published = publish => {
  const p = join(publish, 'last.txt');
  if (!existsSync(p)) return {};
  return Object.fromEntries(readFileSync(p, 'utf8').trim().split('\n').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
};
const starts = publish => (existsSync(join(publish, 'starts.txt')) ? readFileSync(join(publish, 'starts.txt'), 'utf8').trim().split('\n').length : 0);
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 每个用例：(entry) => { detail, evidence }，失败抛错。
 */
const CASES = {
  'SMOKE-core-254': async (entry) => {
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
    // ③ 包内部署执行器载体与两个部署 Skill 的登记
    for (const rel of PACKAGE_CARRIERS) if (!existsSync(join(pkg, rel))) problems.push(`③ 包内缺少 ${rel}`);
    const registered = new Set(Object.values(manifest).filter(Array.isArray).flat().map(e => e?.path));
    for (const skill of SKILLS) {
      if (!registered.has(`skills/${skill}/SKILL.md`)) problems.push(`③ asset-manifest 未登记 skills/${skill}/SKILL.md`);
    }
    // ④ 本仓托管 Skill 副本与全局包内同名 Skill 逐字节一致
    for (const skill of SKILLS) {
      const repoCopy = join(repoRoot, REPO_SKILL_COPY(skill));
      const pkgSkill = join(pkg, 'skills', skill, 'SKILL.md');
      if (!existsSync(repoCopy)) { problems.push(`④ 本仓缺少托管副本 ${REPO_SKILL_COPY(skill)}`); continue; }
      if (!existsSync(pkgSkill)) { problems.push(`④ 全局包内缺少 skills/${skill}/SKILL.md`); continue; }
      const a = sha256(readFileSync(repoCopy));
      const b = sha256(readFileSync(pkgSkill));
      evidence.push(`${skill}: repo_sha256=${a} package_sha256=${b}`);
      if (a !== b) problems.push(`④ 本仓 ${REPO_SKILL_COPY(skill)} 与全局包 skills/${skill}/SKILL.md 字节不一致（需重新执行本仓 openlogos sync 后复核）`);
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: `安装态身份同源（${version}）：manifest 自洽，包内含部署执行器与两个部署 Skill，本仓托管副本与全局包一致`, evidence };
  },

  'SMOKE-core-255': (entry) => {
    const problems = [];
    const evidence = [];
    const p = initDeployProject(entry, { versions: [{ tag: 'v1', label: 'v1' }, { tag: 'v2', label: 'v2' }] });
    const { dir, publish, commits } = p;
    evidence.push(`project=${dir}`, `publish=${publish}`);
    writeFileSync(join(dir, 'payload.txt'), 'uncommitted\n'); // 工作区另有一处未提交改动
    const env = { PUBLISH_DIR: publish };
    const check = (label, r, tag) => {
      evidence.push(`${label} deploy --ref ${tag}: ${brief(r)}`);
      if (r.status !== 0) { problems.push(`${label} 应成功，实际 ${brief(r)}`); return; }
      if (r.data?.channel !== 'version' || r.data?.mode !== 'script' || r.data?.ref !== commits[tag]) {
        problems.push(`${label} 应 channel=version、mode=script、ref=${commits[tag]}，实际 ${JSON.stringify(r.data).slice(0, 300)}`);
      }
      const out = published(publish);
      evidence.push(`${label} publish=${JSON.stringify(out)}`);
      if (out.ref !== commits[tag] || out.head !== commits[tag]) problems.push(`${label} 发布目录记录的 ref / HEAD 应为 ${commits[tag]}，实际 ${JSON.stringify(out)}`);
      if (out.script !== tag || out.payload !== tag) problems.push(`${label} 应执行 ${tag} 那一版脚本且不含未提交改动，实际 ${JSON.stringify(out)}`);
    };
    check('①', cliJson(entry, dir, ['deploy', '--env', 'staging', '--ref', 'v1'], env), 'v1');
    check('②', cliJson(entry, dir, ['deploy', '--env', 'staging', '--ref', 'v2'], env), 'v2');
    const show = cliJson(entry, dir, ['env', 'show', 'staging']);
    evidence.push(`③ env show: current_ref=${show.data?.current_ref} previous_ref=${show.data?.previous_ref}`);
    if (show.data?.current_ref !== commits.v2 || show.data?.previous_ref !== commits.v1) {
      problems.push(`③ 应 current_ref=v2、previous_ref=v1，实际 ${show.data?.current_ref} / ${show.data?.previous_ref}`);
    }
    const rb = cliJson(entry, dir, ['deploy', '--env', 'staging', '--rollback'], env);
    evidence.push(`④ rollback: ${brief(rb)}`);
    if (rb.status !== 0 || rb.data?.rollback !== true || rb.data?.rollback_from !== commits.v2 || rb.data?.ref !== commits.v1) {
      problems.push(`④ 应部署 v1、rollback=true、rollback_from=v2，实际 ${brief(rb)}`);
    }
    if (published(publish).script !== 'v1') problems.push(`④ 发布目录应回到 v1 脚本的输出，实际 ${JSON.stringify(published(publish))}`);
    const show2 = cliJson(entry, dir, ['env', 'show', 'staging']);
    evidence.push(`⑤ env show: current_ref=${show2.data?.current_ref}`);
    if (show2.data?.current_ref !== commits.v1) problems.push(`⑤ current_ref 应为 v1，实际 ${show2.data?.current_ref}`);
    if (existsSync(join(dir, 'logos/.openlogos-runtime/deploy-work')) && readdirSync(join(dir, 'logos/.openlogos-runtime/deploy-work')).length > 0) {
      problems.push('隔离工作树未清理');
    }
    if (readFileSync(join(dir, 'payload.txt'), 'utf8') !== 'uncommitted\n') problems.push('当前工作区的未提交改动被改动');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '版本通道在请求 commit 的隔离工作树中执行（不含未提交改动），env show 的 current / previous 正确，回滚到 v1', evidence };
  },

  'SMOKE-core-256': (entry) => {
    const problems = [];
    const evidence = [];
    const p = initDeployProject(entry, { versions: [{ tag: 'v1', label: 'v1' }], proposal: true });
    const { dir, publish, proposalDir, commits } = p;
    evidence.push(`project=${dir}`);
    const env = { PUBLISH_DIR: publish };
    if (existsSync(join(dir, REPORT_REL))) throw new Error(`夹具不应有旧部署报告 ${REPORT_REL}`);
    // ① 提案通道首次部署
    const d = cliJson(entry, dir, ['deploy', '--env', 'staging'], env);
    evidence.push(`① deploy: ${brief(d)}`);
    if (d.status !== 0 || d.data?.channel !== 'proposal') problems.push(`① 应成功且 channel=proposal，实际 ${brief(d)}`);
    const report = existsSync(join(dir, REPORT_REL)) ? readFileSync(join(dir, REPORT_REL), 'utf8') : '';
    if (!d.data?.deploy_id || !report.includes(d.data.deploy_id)) problems.push('① 部署报告应新增本次部署（含 deploy_id）');
    const tasks = readFileSync(join(proposalDir, 'tasks.md'), 'utf8');
    if (/- \[ \]/.test(tasks)) problems.push(`① [deploy] 应全勾，实际 ${JSON.stringify(tasks)}`);
    let marker = null;
    try { marker = JSON.parse(readFileSync(join(proposalDir, 'DEPLOY_DONE'), 'utf8')); } catch { /* 下方报告 */ }
    const deployRows = ledgerRows(dir).filter(r => r.kind === 'deploy');
    evidence.push(`① DEPLOY_DONE=${JSON.stringify(marker)} ledger_deploy_ids=${JSON.stringify(deployRows.map(r => r.deploy_id))}`);
    if (!marker || deployRows.length !== 1 || marker.deploy_id !== deployRows[0].deploy_id) problems.push('① DEPLOY_DONE.deploy_id 应等于账本该次记录的 deploy_id');
    // ② smoke 得到已验证事实
    const sm = cliJson(entry, dir, ['smoke', '--env', 'staging']);
    const ev = sm.data?.environment_evidence;
    evidence.push(`② smoke: exit=${sm.status} gate=${sm.data?.gate?.result} environment_evidence=${JSON.stringify(ev ?? null)}`);
    if (sm.status !== 0 || sm.data?.gate?.result !== 'PASS' || ev?.verified !== true) problems.push(`② 门禁应 PASS 且 verified=true，实际 ${brief(sm)}`);
    // ③ 版本通道部署另一个 tag
    const v = cliJson(entry, dir, ['deploy', '--env', 'staging', '--ref', 'v1', '--channel', 'version'], env);
    evidence.push(`③ deploy --channel version: ${brief(v)}`);
    if (v.status !== 0 || v.data?.ref !== commits.v1) problems.push(`③ 版本通道部署应成功，实际 ${brief(v)}`);
    // ④ smoke 报 SMOKE_DEPLOY_SUPERSEDED，标记与账本字节不变
    const state = () => JSON.stringify(['SMOKE_PASS', 'SMOKE_FAIL', 'DEPLOY_DONE'].map(n => {
      const f = join(proposalDir, n);
      return existsSync(f) ? sha256(readFileSync(f)) : null;
    }).concat(existsSync(join(dir, LEDGER_REL)) ? sha256(readFileSync(join(dir, LEDGER_REL))) : null));
    const before = state();
    const sm2 = cliJson(entry, dir, ['smoke', '--env', 'staging']);
    evidence.push(`④ smoke: ${brief(sm2)}`);
    if (sm2.status !== 1 || sm2.error?.code !== 'SMOKE_DEPLOY_SUPERSEDED') problems.push(`④ 应 SMOKE_DEPLOY_SUPERSEDED 且退出码 1，实际 ${brief(sm2)}`);
    if (state() !== before) problems.push('④ SMOKE_PASS / SMOKE_FAIL、DEPLOY_DONE 或账本字节与执行前不一致');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '提案通道首次部署写出报告并落标、smoke 已验证；之后版本通道部署使 smoke 报 SMOKE_DEPLOY_SUPERSEDED 且零副作用', evidence };
  },

  'SMOKE-core-257': async (entry) => {
    const problems = [];
    const evidence = [];
    const p = initDeployProject(entry, {
      versions: [{ tag: 'ok', label: 'ok' }, { tag: 'bad', label: 'bad', behavior: 'fail' }, { tag: 'slow', label: 'slow', behavior: 'sleep' }],
      secrets: ['SMOKE_DEPLOY_TOKEN'],
    });
    const { dir, publish, commits } = p;
    evidence.push(`project=${dir}`);
    const withToken = { PUBLISH_DIR: publish, SMOKE_DEPLOY_TOKEN: TOKEN_VALUE };
    // ① 不导出密钥
    const r1 = cliJson(entry, dir, ['deploy', '--env', 'staging', '--ref', 'ok'], { PUBLISH_DIR: publish });
    evidence.push(`① ${brief(r1)}`);
    if (r1.status !== 1 || r1.error?.code !== 'DEPLOY_SECRETS_MISSING' || JSON.stringify(r1.error?.details?.missing) !== '["SMOKE_DEPLOY_TOKEN"]') {
      problems.push(`① 应 DEPLOY_SECRETS_MISSING 且 details.missing 只含变量名，实际 ${brief(r1)}`);
    }
    // ② dry-run：零写入
    const before = treeHash(dir);
    const r2 = cliJson(entry, dir, ['deploy', '--env', 'staging', '--ref', 'ok', '--dry-run'], withToken);
    evidence.push(`② ${brief(r2)}`);
    if (r2.status !== 0 || r2.data?.status !== 'dry-run') problems.push(`② 应 status=dry-run，实际 ${brief(r2)}`);
    if (treeHash(dir) !== before) problems.push('② dry-run 前后临时项目文件快照不一致');
    if (starts(publish) !== 0) problems.push('② dry-run 不应执行部署脚本');
    // ③ 失败记录与密钥遮盖（先有一次成功部署确立 current_ref）
    const ok = cliJson(entry, dir, ['deploy', '--env', 'staging', '--ref', 'ok'], withToken);
    if (ok.status !== 0) problems.push(`③ 前置成功部署失败：${brief(ok)}`);
    const r3 = cliJson(entry, dir, ['deploy', '--env', 'staging', '--ref', 'bad'], withToken);
    evidence.push(`③ ${brief(r3)}`);
    if (r3.status !== 1 || r3.error?.code !== 'DEPLOY_FAILED' || r3.error?.details?.failure_reason !== 'exit-code') {
      problems.push(`③ 应 DEPLOY_FAILED、failure_reason=exit-code，实际 ${brief(r3)}`);
    }
    const last = ledgerRows(dir).filter(r => r.kind === 'deploy').pop();
    if (last?.result !== 'failed') problems.push(`③ 账本应追加 result=failed，实际 ${JSON.stringify(last)}`);
    const show = cliJson(entry, dir, ['env', 'show', 'staging']);
    if (show.data?.current_ref !== commits.ok) problems.push(`③ current_ref 应保持 ok 的 commit，实际 ${show.data?.current_ref}`);
    const logPath = r3.error?.details?.log_path ? join(dir, r3.error.details.log_path) : null;
    const log = logPath && existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    const tail = String(r3.error?.details?.output_tail ?? '');
    if (!log) problems.push('③ 部署日志不存在');
    for (const [label, text] of [['log', log], ['output_tail', tail], ['stderr', r3.stderr]]) {
      if (text.includes(TOKEN_VALUE)) problems.push(`③ ${label} 中出现了密钥值`);
    }
    if (!log.includes('***') || !tail.includes('***')) problems.push('③ 日志与 output_tail 中应出现 ***');
    // ④ 并发锁：后台部署运行期间再次部署
    const startsBefore = starts(publish);
    const child = spawn(cliBin(entry), cliArgs(entry, ['deploy', '--env', 'staging', '--ref', 'slow', '--format', 'json']), { cwd: dir, env: isolatedEnv(withToken) });
    let bgOut = '';
    child.stdout.on('data', c => { bgOut += c; });
    const bgDone = new Promise(res => child.on('close', code => res(code)));
    const lockFile = join(dir, 'logos/.openlogos-runtime/deploy-locks/staging.lock');
    const deadline = Date.now() + 15_000;
    while (!(existsSync(lockFile) && starts(publish) > startsBefore) && Date.now() < deadline) await sleep(100);
    const r4 = cliJson(entry, dir, ['deploy', '--env', 'staging', '--ref', 'ok'], withToken);
    evidence.push(`④ 并发：${brief(r4)}`);
    if (r4.status !== 1 || r4.error?.code !== 'DEPLOY_IN_PROGRESS') problems.push(`④ 第二次应 DEPLOY_IN_PROGRESS，实际 ${brief(r4)}`);
    const bgCode = await bgDone;
    evidence.push(`④ 后台部署 exit=${bgCode} ${bgOut.slice(0, 300)}`);
    if (bgCode !== 0) problems.push(`④ 后台部署应照常完成，实际退出码 ${bgCode}`);
    if (starts(publish) !== startsBefore + 1) problems.push('④ 第二次部署不应执行部署脚本');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '缺密钥只报变量名；dry-run 零写入；失败记 exit-code、current_ref 不变且日志遮盖密钥；并发部署被锁拒绝而后台部署完成', evidence };
  },
};

export const ENVDEPLOY_SMOKE_IDS = Object.keys(CASES);

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: ENVDEPLOY_SMOKE_IDS,
    environment: FORMAL_ENVIRONMENT,
    self_test_environment: SELF_TEST_ENVIRONMENT,
    required_source_env: TARBALL_ENV,
    min_candidate_version: MIN_VERSION,
    deployment_record: DEPLOYMENT_RECORD,
    repo_sync_copies: SKILLS.map(REPO_SKILL_COPY),
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

if (INJECTED_ENTRY !== undefined && !SELF_TEST) refuse('设置了 OPENLOGOS_ENVDEPLOY_SMOKE_ENTRY 但未声明自测（OPENLOGOS_ENVDEPLOY_SMOKE_SELF_TEST=1）');
if (SELF_TEST && INJECTED_ENTRY === undefined) refuse('自测模式需要 OPENLOGOS_ENVDEPLOY_SMOKE_ENTRY 指定注入入口');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST) {
  // 环境前置（缺失即显式 skip）：候选版本与 tarball → 部署记录 → 本仓 sync
  const skip = (reason, missing) => exitNotApplicable(ENVDEPLOY_SMOKE_IDS, { reason, missing, environment: ENVIRONMENT, repoRoot });
  const version = candidateVersion();
  if (!versionAtLeast(version, MIN_VERSION)) {
    skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-tarball']);
  }
  if (!TARBALL_ENV.some(name => process.env[name])) {
    const fallback = join(repoRoot, `cli/miniidealab-openlogos-${version}.tgz`);
    if (existsSync(fallback)) process.env.OPENLOGOS_ENVDEPLOY_TARBALL = fallback;
  }
  if (!TARBALL_ENV.some(name => process.env[name])) {
    skip(`缺少 ${version} 候选 tarball：未设置 ${TARBALL_ENV.join(' / ')}，本仓也没有 cli/miniidealab-openlogos-${version}.tgz（部署窗口外不适用）`, ['candidate-tarball']);
  }
  const tarball = resolve(repoRoot, process.env.OPENLOGOS_ENVDEPLOY_TARBALL || process.env.OPENLOGOS_TARBALL);
  if (!existsSync(tarball)) skip(`候选 tarball 不存在：${tarball}`, ['candidate-tarball']);
  const tarballSha = sha256(readFileSync(tarball));
  const recordPath = join(repoRoot, DEPLOYMENT_RECORD);
  const record = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : '';
  if (!record.includes(version) || !record.includes(tarballSha)) {
    skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version} 与 tarball SHA-256 ${tarballSha}`, ['deployment-record']);
  }
  const missingCopies = SKILLS.map(REPO_SKILL_COPY).filter(rel => !existsSync(join(repoRoot, rel)));
  if (missingCopies.length > 0) skip(`本仓未执行 openlogos sync（缺少托管副本 ${missingCopies.join('、')}）`, ['repo-sync']);
}

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of ENVDEPLOY_SMOKE_IDS) {
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
    for (const id of ENVDEPLOY_SMOKE_IDS) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
  } else {
    for (const id of ENVDEPLOY_SMOKE_IDS) {
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

const failed = ENVDEPLOY_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${ENVDEPLOY_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
