#!/usr/bin/env node
/**
 * SMOKE-core-251～SMOKE-core-253 — 0.16.3 环境登记表与复核修复的**安装态**取证
 * （来源提案 environment-registry 与 fix-environment-registry-review-gaps，决策 C01～C04）。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *   - SMOKE-core-251：安装态版本、制品身份与本仓 sync 同源（版本取 cli/src/lib/local-release-candidate.ts，不写死字面量）。
 *   - SMOKE-core-252：安装态环境登记全链路（env check → deploy-done --env 生产 --ref HEAD → smoke --env prod → env show → status）。
 *   - SMOKE-core-253：安装态复核修复——SMOKE_DEPLOY_MARKER_INVALID 的 error.details、账本锁占用与标记阶段失败的一致性。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目内，结束即删除（含运行态账本与锁文件）；只读本机全局安装态
 * （不安装 / 卸载），不触碰本仓活跃提案、本仓 logos/resources/、本仓运行态目录与用户其他仓库（包括 runlogos）；
 * 唯一读取本仓的是 SMOKE-core-251 ④ 对本仓托管 guard 副本的只读比对。命令图中不出现任何公网发布命令。
 * 判据用行为断言（`--format json` 结构化字段、退出码与命令实际输出），版本号相等只证明装了新包、不证明行为生效。
 *
 * 环境不具备时写显式 skip（不标 platform-unavailable，均为可补齐的环境缺口）：
 *   - 缺候选 tarball → requireEnvOrSkip 留痕。来源依次为 OPENLOGOS_ENVREG_TARBALL（经 run-smoke.js 以 OPENLOGOS_TARBALL
 *     传入）与本仓冻结的唯一候选制品 cli/miniidealab-openlogos-<候选版本>.tgz——自动流程运行 `openlogos smoke` 时
 *     不设置该环境变量，只靠环境变量会让本 runner 在流程内永远 skip；回落取到的制品同样须通过下方部署记录 SHA-256 核对；
 *   - 部署记录（logos/resources/verify/deployment-report.md）未记载候选版本与 tarball SHA-256；
 *   - 本仓未执行 sync（不存在托管副本 .claude/openlogos/bin/guard-check）。
 * 托管副本存在但与全局包字节不一致属 SMOKE-core-251 ④ 的 fail，不是 skip。
 *
 * **正式安装态模式**（缺省）：只认 PATH 中 `openlogos` 且 realpath 位于 `npm prefix -g` 的全局包目录内。
 * **自测模式**（仅供 runner 自身验证，须同时满足）：OPENLOGOS_ENVREG_SMOKE_SELF_TEST=1、OPENLOGOS_ENVREG_SMOKE_ENTRY
 * 注入入口、OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过上述环境前置，结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable, requireEnvOrSkip } from './lib/smoke-not-applicable.mjs';

const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const TARBALL_ENV = ['OPENLOGOS_ENVREG_TARBALL', 'OPENLOGOS_TARBALL'];
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const REPO_GUARD_COPY = '.claude/openlogos/bin/guard-check';
const BUILTIN_EXEMPT = ['logos/resources/reference/', 'logos/resources/verify/baseline-seed-runs/*/staging/', 'logos/environments.yaml'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const INJECTED_ENTRY = process.env.OPENLOGOS_ENVREG_SMOKE_ENTRY;
const SELF_TEST = process.env.OPENLOGOS_ENVREG_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;

const run = (cmd, args, cwd = repoRoot) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: process.env });
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
/**
 * 在一次性项目里调用 CLI 时剥离外层 smoke 的账本、外层注入的目标环境与本 runner 的控制变量：
 * 否则夹具项目的 smoke runner 会把记录写进外层账本、读到外层的 OPENLOGOS_SMOKE_ENV，污染正式证据。
 */
function isolatedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key.startsWith('OPENLOGOS_ENVREG_')) delete env[key];
  }
  return env;
}
const cliRaw = (entry, cwd, args) =>
  spawnSync(cliBin(entry), cliArgs(entry, args), { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: isolatedEnv() });
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-envreg-${tag}-`));
  scopes.push(dir);
  return dir;
}

function put(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** 解析 CLI 的 JSON 输出：成功 envelope 在 stdout，错误 envelope 在 stderr（整个 stderr 只能是一份 JSON）。 */
function cliJson(entry, dir, args) {
  const r = cliRaw(entry, dir, [...args, '--format', 'json']);
  let data = null;
  let error = null;
  let stderrSingleJson = false;
  try { data = JSON.parse(r.stdout).data ?? null; } catch { /* 错误路径无 stdout envelope */ }
  try { error = JSON.parse((r.stderr || '').trim()).error ?? null; stderrSingleJson = true; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, error, stderrSingleJson, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const brief = r => `exit=${r.status} ${r.error ? `error=${JSON.stringify(r.error)}` : `data=${JSON.stringify(r.data ?? null).slice(0, 400)}`}`;

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

const REGISTRY = [
  'schema_version: 1',
  'environments:',
  '  - {id: test, name: Test, tier: test, aliases: [测试]}',
  '  - {id: prod, name: Production, tier: prod, aliases: [生产]}',
  '',
].join('\n');
const FIXTURE_SLUG = 'envreg-smoke-fixture';
const FIXTURE_RESULT = 'logos/resources/verify/smoke-results.jsonl';
const LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
const LOCK_REL = `${LEDGER_REL}.lock`;
/** 夹具 smoke runner：读取注入的 OPENLOGOS_SMOKE_ENV，写入结果行 target_environment 并记录实际读到的值。 */
const FIXTURE_RUNNER = [
  "import { mkdirSync, writeFileSync } from 'node:fs';",
  "import { dirname } from 'node:path';",
  `const p = ${JSON.stringify(FIXTURE_RESULT)};`,
  'const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;',
  'mkdirSync(dirname(p), { recursive: true });',
  "writeFileSync(p, JSON.stringify({ id: 'SMOKE-core-901', status: 'pass', timestamp: new Date().toISOString(), target_environment: env, observed_env: env }) + '\\n');",
].join('\n');

function git(dir, args) {
  const r = run('git', args, dir);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 300)}`);
  return r.stdout.trim();
}

/**
 * 一次性 git 项目：经全局入口 init，按 S19 夹具口径补齐活跃提案、部署决策、[deploy] 全勾、VERIFY_PASS、
 * 登记表（test / prod，prod 带 alias 生产）、smoke 用例与读取 OPENLOGOS_SMOKE_ENV 的 runner。
 */
function initRegistryProject(entry) {
  const dir = newTempDir('project');
  const init = cliRaw(entry, dir, ['init', '--locale', 'en', '--ai-tool', 'claude-code']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || '').slice(0, 300)}`);
  const proposal = `logos/changes/${FIXTURE_SLUG}`;
  put(dir, 'logos/environments.yaml', REGISTRY);
  put(dir, 'logos/resources/test/smoke/core-smoke-test-cases.md', '| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  put(dir, `${proposal}/deltas/test/smoke/core-smoke-test-cases.md`, '## ADDED — 夹具 smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  put(dir, `${proposal}/proposal.md`, [
    '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：生产',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
  ].join('\n'));
  put(dir, `${proposal}/tasks.md`, '# 实现任务\n\n## [deploy] 发布\n- [x] 发布到生产\n');
  put(dir, `${proposal}/VERIFY_PASS`, '');
  put(dir, 'logos/.openlogos-guard', JSON.stringify({ activeChange: FIXTURE_SLUG, module: 'core' }));
  put(dir, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nfixture\n');
  put(dir, 'scripts/smoke-envreg-fixture.mjs', FIXTURE_RUNNER);
  const cfgPath = join(dir, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.smoke = { ...(cfg.smoke || {}), result_path: FIXTURE_RESULT, command: 'node scripts/smoke-envreg-fixture.mjs', sandbox_mode: 'off' };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const gitignore = join(dir, '.gitignore');
  writeFileSync(gitignore, `${existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : ''}\nlogos/.openlogos-runtime/\n`);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'smoke']);
  git(dir, ['config', 'user.email', 'smoke@example.invalid']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'fixture']);
  return { dir, proposalDir: join(dir, proposal) };
}

function ledgerRows(dir) {
  const p = join(dir, LEDGER_REL);
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}

/** 两种 smoke 标记的存在性与原始字节、账本字节。 */
function markerLedgerState(project) {
  const read = p => (existsSync(p) ? readFileSync(p).toString('base64') : null);
  return JSON.stringify({
    SMOKE_PASS: read(join(project.proposalDir, 'SMOKE_PASS')),
    SMOKE_FAIL: read(join(project.proposalDir, 'SMOKE_FAIL')),
    ledger: read(join(project.dir, LEDGER_REL)),
  });
}

/** SMOKE-core-252 建立、SMOKE-core-253 沿用的临时项目（252 未建成时 253 自行建立并完成一次合法 prod 部署）。 */
let sharedProject = null;
function deployedProject(entry) {
  if (sharedProject) return sharedProject;
  const project = initRegistryProject(entry);
  const d = cliJson(entry, project.dir, ['deploy-done', '--env', 'prod', '--ref', 'HEAD']);
  if (d.status !== 0) throw new Error(`夹具 deploy-done 失败：${brief(d)}`);
  sharedProject = project;
  return project;
}

/**
 * 每个用例：(entry) => { detail, evidence }，失败抛错。
 */
const CASES = {
  'SMOKE-core-251': async (entry) => {
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
    // ③ 包内行为载体
    for (const rel of ['dist/commands/env.js', 'dist/lib/deployment-ledger.js']) {
      if (!existsSync(join(pkg, rel))) problems.push(`③ 包内缺少 ${rel}`);
    }
    const pkgGuard = join(pkg, 'claude-plugin-template/bin/guard-check');
    if (!existsSync(pkgGuard)) problems.push('③ 包内缺少 claude-plugin-template/bin/guard-check');
    else if (!readFileSync(pkgGuard, 'utf8').includes('logos/environments.yaml')) problems.push('③ 包内 guard-check 的内置默认豁免不含 logos/environments.yaml');
    const schemaPath = join(pkg, 'spec/logos.config.schema.json');
    if (!existsSync(schemaPath)) problems.push('③ 包内缺少 spec/logos.config.schema.json');
    else {
      try {
        const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
        const def = schema?.properties?.guard?.properties?.exempt?.default;
        evidence.push(`schema_exempt_default=${JSON.stringify(def)}`);
        if (JSON.stringify(def) !== JSON.stringify(BUILTIN_EXEMPT)) problems.push(`③ 包内 schema guard.exempt.default 应为 3 条内置默认，实际 ${JSON.stringify(def)}`);
      } catch (e) {
        problems.push(`③ 包内 spec/logos.config.schema.json 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // ④ 本仓托管 guard 副本与全局包内模板逐字节一致
    const repoCopy = join(repoRoot, REPO_GUARD_COPY);
    if (!existsSync(repoCopy)) problems.push(`④ 本仓缺少托管副本 ${REPO_GUARD_COPY}`);
    else if (existsSync(pkgGuard)) {
      const a = sha256(readFileSync(repoCopy));
      const b = sha256(readFileSync(pkgGuard));
      evidence.push(`repo_guard_sha256=${a}`, `package_guard_sha256=${b}`);
      if (a !== b) problems.push(`④ 本仓 ${REPO_GUARD_COPY} 与全局包 claude-plugin-template/bin/guard-check 字节不一致（需重新执行本仓 openlogos sync 后复核）`);
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: `安装态身份同源（${version}）：manifest 自洽，包内含 env / 部署账本实现、guard 默认豁免与 schema 为 3 条，本仓托管 guard 与全局包一致`, evidence };
  },

  'SMOKE-core-252': (entry) => {
    const problems = [];
    const evidence = [];
    const project = initRegistryProject(entry);
    const { dir, proposalDir } = project;
    evidence.push(`project=${dir}`);
    // ① env check
    const check = cliJson(entry, dir, ['env', 'check']);
    evidence.push(`① env check: ${brief(check)}`);
    if (check.status !== 0 || check.data?.ok !== true) problems.push(`① env check 应通过，实际 ${brief(check)}`);
    // ② deploy-done --env 生产 --ref HEAD
    const head = git(dir, ['rev-parse', 'HEAD']);
    const deploy = cliJson(entry, dir, ['deploy-done', '--env', '生产', '--ref', 'HEAD']);
    evidence.push(`② deploy-done: ${brief(deploy)}`);
    if (deploy.status !== 0) problems.push(`② deploy-done 应成功，实际 ${brief(deploy)}`);
    const markerText = existsSync(join(proposalDir, 'DEPLOY_DONE')) ? readFileSync(join(proposalDir, 'DEPLOY_DONE'), 'utf8') : '';
    let marker = null;
    try { marker = JSON.parse(markerText); } catch { /* 下方报告 */ }
    if (!marker || markerText.trimEnd().includes('\n')) problems.push(`② DEPLOY_DONE 应为单行 JSON，实际 ${JSON.stringify(markerText.slice(0, 200))}`);
    else {
      if (marker.environment !== 'prod') problems.push(`② DEPLOY_DONE.environment 应为 prod，实际 ${marker.environment}`);
      if (marker.ref !== head) problems.push(`② DEPLOY_DONE.ref 应为当时 HEAD ${head}，实际 ${marker.ref}`);
    }
    const deployRows = ledgerRows(dir).filter(row => row.kind === 'deploy');
    if (deployRows.length !== 1) problems.push(`② 账本应新增 1 行 deploy 记录，实际 ${deployRows.length}`);
    // ③ smoke --env prod
    const sm = cliJson(entry, dir, ['smoke', '--env', 'prod']);
    const ev = sm.data?.environment_evidence;
    evidence.push(`③ smoke: exit=${sm.status} gate=${sm.data?.gate?.result} environment_evidence=${JSON.stringify(ev ?? null)}`);
    if (sm.status !== 0 || sm.data?.gate?.result !== 'PASS') problems.push(`③ smoke 门禁应 PASS，实际 ${brief(sm)}`);
    if (ev?.env_evidence !== 'declared' || ev?.verified !== true || ev?.ledger_written !== true) {
      problems.push(`③ environment_evidence 应 declared / verified / ledger_written，实际 ${JSON.stringify(ev ?? null)}`);
    }
    const observed = existsSync(join(dir, FIXTURE_RESULT))
      ? readFileSync(join(dir, FIXTURE_RESULT), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).observed_env)
      : [];
    evidence.push(`③ runner observed_env=${JSON.stringify(observed)}`);
    if (observed.length === 0 || observed.some(v => v !== 'prod')) problems.push(`③ runner 应读到 OPENLOGOS_SMOKE_ENV=prod，实际 ${JSON.stringify(observed)}`);
    // ④ env show prod
    const show = cliJson(entry, dir, ['env', 'show', 'prod']);
    evidence.push(`④ env show: current_ref=${show.data?.current_ref} last_smoke=${JSON.stringify(show.data?.last_smoke ?? null)}`);
    if (show.data?.last_smoke?.verified !== true) problems.push(`④ last_smoke.verified 应为 true，实际 ${JSON.stringify(show.data?.last_smoke ?? null)}`);
    if (!marker || show.data?.current_ref !== marker.ref) problems.push(`④ current_ref 应等于 ② 的 ref ${marker?.ref}，实际 ${show.data?.current_ref}`);
    // ⑤ status 的 environments 中 prod 与 ④ 一致
    const st = cliJson(entry, dir, ['status']);
    const prod = (st.data?.environments ?? []).find(e => e?.id === 'prod') ?? null;
    evidence.push(`⑤ status: exit=${st.status} prod=${JSON.stringify(prod)}`);
    const view = v => JSON.stringify({ current_ref: v?.current_ref ?? null, last_deploy: v?.last_deploy ?? null, last_smoke: v?.last_smoke ?? null });
    if (!prod || view(prod) !== view(show.data)) problems.push(`⑤ status environments 中 prod 应与 ④ 一致，实际 ${JSON.stringify(prod)}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    sharedProject = project;
    return { detail: '登记 → 部署（alias 生产解析为 prod、ref 为当时 HEAD）→ smoke 已验证 → env show / status 一致', evidence };
  },

  'SMOKE-core-253': (entry) => {
    const problems = [];
    const evidence = [];
    const project = deployedProject(entry);
    const { dir, proposalDir } = project;
    evidence.push(`project=${dir}`);
    const markerPath = join(proposalDir, 'DEPLOY_DONE');
    const resultFile = join(dir, FIXTURE_RESULT);

    // ① DEPLOY_DONE 截断为前 10 字节 → SMOKE_DEPLOY_MARKER_INVALID，error.details.problems 非空，命令未运行
    writeFileSync(markerPath, readFileSync(markerPath).subarray(0, 10));
    const sentinel = '{"id":"SENTINEL","status":"pass"}\n';
    put(dir, FIXTURE_RESULT, sentinel);
    const r1 = cliJson(entry, dir, ['smoke', '--env', 'prod']);
    evidence.push(`① smoke: ${brief(r1)}`);
    if (r1.status !== 1 || r1.error?.code !== 'SMOKE_DEPLOY_MARKER_INVALID') problems.push(`① 应 SMOKE_DEPLOY_MARKER_INVALID 且退出码 1，实际 ${brief(r1)}`);
    if (!Array.isArray(r1.error?.details?.problems) || r1.error.details.problems.length === 0) {
      problems.push(`① error.details.problems 应为非空数组，实际 ${JSON.stringify(r1.error?.details ?? null)}`);
    }
    if (readFileSync(resultFile, 'utf8') !== sentinel) problems.push('① smoke.command 不应运行（结果文件哨兵被改写）');
    const redeploy = cliJson(entry, dir, ['deploy-done', '--env', 'prod', '--ref', 'HEAD']);
    evidence.push(`① 重新 deploy-done: ${brief(redeploy)}`);
    if (redeploy.status !== 0) throw new Error(`${problems.join('；')}；① 重新 deploy-done 失败：${brief(redeploy)}`);

    // ② 新鲜账本锁文件 → SMOKE_LEDGER_WRITE_FAILED（stage=ledger），两种标记与账本字节不变
    const lockPath = join(dir, LOCK_REL);
    put(dir, LOCK_REL, '99999');
    const before2 = markerLedgerState(project);
    let r2;
    try {
      r2 = cliJson(entry, dir, ['smoke', '--env', 'prod']);
    } finally {
      rmSync(lockPath, { force: true });
    }
    evidence.push(`② smoke（锁占用）: ${brief(r2)}`);
    if (r2.status !== 1 || r2.error?.code !== 'SMOKE_LEDGER_WRITE_FAILED' || r2.error?.details?.stage !== 'ledger') {
      problems.push(`② 应 SMOKE_LEDGER_WRITE_FAILED（stage=ledger）且退出码 1，实际 ${brief(r2)}`);
    }
    if (!r2.stderrSingleJson) problems.push(`② stderr 应只有一份 JSON envelope，实际 ${JSON.stringify(r2.stderr.slice(0, 300))}`);
    if (markerLedgerState(project) !== before2) problems.push('② 两种 smoke 标记或账本字节与执行前不一致');

    // ③ 旧 SMOKE_FAIL、提案目录只读、runner 全部通过 → stage=marker、rollback=complete，现场恢复
    if (isRoot) {
      if (problems.length > 0) throw new Error(problems.join('；'));
      throw new RootSkip('③ 以 root 运行时目录权限不生效，无法构造只读提案目录；①② 已通过');
    }
    rmSync(join(proposalDir, 'SMOKE_PASS'), { force: true });
    writeFileSync(join(proposalDir, 'SMOKE_FAIL'), 'old-fail\n');
    const before3 = markerLedgerState(project);
    const smokeRowsBefore = ledgerRows(dir).filter(row => row.kind === 'smoke').length;
    chmodSync(proposalDir, 0o555);
    let r3;
    try {
      r3 = cliJson(entry, dir, ['smoke', '--env', 'prod']);
    } finally {
      chmodSync(proposalDir, 0o755);
    }
    evidence.push(`③ smoke（提案目录只读）: ${brief(r3)}`);
    if (r3.status !== 1 || r3.error?.code !== 'SMOKE_LEDGER_WRITE_FAILED' || r3.error?.details?.stage !== 'marker'
      || r3.error?.details?.rollback !== 'complete') {
      problems.push(`③ 应 SMOKE_LEDGER_WRITE_FAILED（stage=marker、rollback=complete），实际 ${brief(r3)}`);
    }
    if (readFileSync(join(proposalDir, 'SMOKE_FAIL'), 'utf8') !== 'old-fail\n') problems.push('③ 旧 SMOKE_FAIL 未保留原内容');
    if (existsSync(join(proposalDir, 'SMOKE_PASS'))) problems.push('③ 不应存在 SMOKE_PASS');
    if (ledgerRows(dir).filter(row => row.kind === 'smoke').length !== smokeRowsBefore) problems.push('③ 账本不应留有本次 smoke 行');
    if (markerLedgerState(project) !== before3) problems.push('③ 两种 smoke 标记或账本字节与执行前不一致');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '截断 DEPLOY_DONE 带 details.problems；账本锁占用与标记阶段失败均以 SMOKE_LEDGER_WRITE_FAILED 结束且现场一致', evidence };
  },
};

/** root 下无法构造只读目录：按既有口径写 skip 并说明原因（不标 platform-unavailable，有 skip 时不得写 SMOKE_PASS）。 */
class RootSkip extends Error {}

export const ENVREG_SMOKE_IDS = Object.keys(CASES);

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: ENVREG_SMOKE_IDS,
    environment: FORMAL_ENVIRONMENT,
    self_test_environment: SELF_TEST_ENVIRONMENT,
    required_source_env: TARBALL_ENV,
    deployment_record: DEPLOYMENT_RECORD,
    repo_sync_copy: REPO_GUARD_COPY,
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

if (INJECTED_ENTRY !== undefined && !SELF_TEST) refuse('设置了 OPENLOGOS_ENVREG_SMOKE_ENTRY 但未声明自测（OPENLOGOS_ENVREG_SMOKE_SELF_TEST=1）');
if (SELF_TEST && INJECTED_ENTRY === undefined) refuse('自测模式需要 OPENLOGOS_ENVREG_SMOKE_ENTRY 指定注入入口');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST) {
  // 环境前置（缺失即显式 skip）：候选 tarball → 部署记录 → 本仓 sync
  if (!TARBALL_ENV.some(name => process.env[name])) {
    const fallbackVersion = candidateVersion();
    const fallback = fallbackVersion ? join(repoRoot, `cli/miniidealab-openlogos-${fallbackVersion}.tgz`) : null;
    if (fallback && existsSync(fallback)) process.env.OPENLOGOS_ENVREG_TARBALL = fallback;
  }
  requireEnvOrSkip(ENVREG_SMOKE_IDS, [TARBALL_ENV], {
    reason: '缺少 0.16.3 候选 tarball（部署窗口外不适用）', environment: ENVIRONMENT,
  });
  const tarball = resolve(repoRoot, process.env.OPENLOGOS_ENVREG_TARBALL || process.env.OPENLOGOS_TARBALL);
  const skip = (reason, missing) => exitNotApplicable(ENVREG_SMOKE_IDS, { reason, missing, environment: ENVIRONMENT, repoRoot });
  if (!existsSync(tarball)) skip(`候选 tarball 不存在：${tarball}`, ['candidate-tarball']);
  const version = candidateVersion();
  const tarballSha = sha256(readFileSync(tarball));
  const recordPath = join(repoRoot, DEPLOYMENT_RECORD);
  const record = existsSync(recordPath) ? readFileSync(recordPath, 'utf8') : '';
  if (!version || !record.includes(version) || !record.includes(tarballSha)) {
    skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version ?? '(未知)'} 与 tarball SHA-256 ${tarballSha}`, ['deployment-record']);
  }
  if (!existsSync(join(repoRoot, REPO_GUARD_COPY))) skip(`本仓未执行 openlogos sync（缺少托管副本 ${REPO_GUARD_COPY}）`, ['repo-sync']);
}

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of ENVREG_SMOKE_IDS) {
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
    for (const id of ENVREG_SMOKE_IDS) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
  } else {
    for (const id of ENVREG_SMOKE_IDS) {
      const started = Date.now();
      try {
        const { detail, evidence } = await CASES[id](entry);
        results.set(id, { status: 'pass', detail, evidence: [`entry=${entry}`, ...evidence], duration_ms: Date.now() - started });
      } catch (error) {
        results.set(id, {
          status: error instanceof RootSkip ? 'skip' : 'fail',
          detail: error instanceof Error ? error.message : String(error),
          evidence: [`entry=${entry}`], duration_ms: Date.now() - started,
        });
      }
    }
  }
} finally {
  flush();
  for (const s of scopes) {
    try { chmodSync(s, 0o755); } catch { /* 已删除 */ }
    rmSync(s, { recursive: true, force: true });
  }
}

const failed = ENVREG_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass' && results.get(id)?.status !== 'skip');
for (const id of ENVREG_SMOKE_IDS.filter(i => results.get(i)?.status === 'skip')) console.log(`smoke skip：${id}：${results.get(id)?.detail}`);
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${ENVREG_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
