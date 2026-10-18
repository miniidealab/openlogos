#!/usr/bin/env node
/**
 * SMOKE-core-280～SMOKE-core-284 — 0.16.8 按模块限定 verify 范围的**安装态**取证（来源提案 module-scoped-verify，功能规格 §2.96）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.8 按模块限定 verify 范围安装态 smoke（SMOKE-core-280～284）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.8 本机测试环境发布（module-scoped-verify）」。
 *
 *   - SMOKE-core-280：安装态版本、制品身份与本仓 sync 同源（包内含范围计算实现、`verify --all`、guard baseRef 写入）。
 *   - SMOKE-core-281：多模块夹具只改一个模块 → 只执行该模块命令、scope.mode=module，本轮输出的范围外行被忽略、遗留行不被采信。
 *   - SMOKE-core-282：改动归不到模块 → fallback-full 全量执行。
 *   - SMOKE-core-283：`--all` → mode=all 全量；本轮 core 失败才阻断。
 *   - SMOKE-core-284：零回归——单模块项目、无任何 paths 的多模块项目上纯规格提案，与 0.16.7 回滚制品的输出一致、无 scope。
 *
 * 夹具与记录型运行器复用 cli/test/golden/s13-module-scope-fixture.mjs（仓库内 S13 用例同一份定义）；全局 CLI 以入口绝对路径
 * 经子进程调用（不经 PATH、不经 AI 宿主）。全部读写只在一次性目录内，结束即删除；对全局安装态只读，对本仓只做 SMOKE-core-280 ④ 的只读比对。
 *
 * **窗口**：活跃变更为 module-scoped-verify，或 OPENLOGOS_MSV_SMOKE=1；窗口外为全部 owned ID 写 skip。
 * **适用性**（缺即显式 skip，不标 platform-unavailable）：候选版本（local-release-candidate.ts）不早于 0.16.8；部署记录记载候选版本；
 * 本机部署回执（logos/.openlogos-runtime/local-install/last-deploy.json）有回滚制品且其版本为部署前版本；本仓已 sync（托管 guard-check 存在）。
 * **自测模式**（须同时满足）：OPENLOGOS_MSV_SMOKE_SELF_TEST=1、OPENLOGOS_MSV_SMOKE_ENTRY（候选入口）、OPENLOGOS_MSV_SMOKE_BASELINE_ENTRY（基线入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置，结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';
import {
  addProposal, createScopeProject, normalizer, put, runVerify,
} from '../cli/test/golden/s13-module-scope-fixture.mjs';

const SLUG = 'module-scoped-verify';
const OWNED = ['SMOKE-core-280', 'SMOKE-core-281', 'SMOKE-core-282', 'SMOKE-core-283', 'SMOKE-core-284'];
const MIN_VERSION = '0.16.8';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const REPO_GUARD_COPY = '.claude/openlogos/bin/guard-check';
const RESULTS_REL = 'logos/resources/verify/test-results.jsonl';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_MSV_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const run = (cmd, args, cwd = repoRoot) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });

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

if (!SELF_TEST && (process.env.OPENLOGOS_MSV_SMOKE_ENTRY !== undefined || process.env.OPENLOGOS_MSV_SMOKE_BASELINE_ENTRY !== undefined)) {
  refuse('设置了 OPENLOGOS_MSV_SMOKE_ENTRY / _BASELINE_ENTRY 但未声明自测（OPENLOGOS_MSV_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && (!process.env.OPENLOGOS_MSV_SMOKE_ENTRY || !process.env.OPENLOGOS_MSV_SMOKE_BASELINE_ENTRY)) {
  refuse('自测模式需要 OPENLOGOS_MSV_SMOKE_ENTRY 与 OPENLOGOS_MSV_SMOKE_BASELINE_ENTRY');
}
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_MSV_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_MSV_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_MSV_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-msv-${tag}-`)); scopes.push(d); return d; };
const project = opts => { const r = createScopeProject(opts); scopes.push(r); return r; };

/** 以入口绝对路径在临时项目里执行 change（子进程环境剥离外层 smoke 变量）。 */
function cliChange(entry, root, slug, module) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key.startsWith('OPENLOGOS_MSV_')) delete env[key];
  return spawnSync(process.execPath, [entry, 'change', slug, '--module', module], { cwd: root, encoding: 'utf8', env, timeout: 120_000 });
}
const verifyIn = (entry, root, opts = {}) => runVerify(entry, root, {
  ...opts, env: { OPENLOGOS_SMOKE_RESULT_PATH: '', OPENLOGOS_SMOKE_ENV: '', ...(opts.env ?? {}) },
});
const labels = r => r.calls.map(c => c.label);
const STALE_ROW = `${JSON.stringify({ id: 'UT-S01-01', status: 'fail', timestamp: '2026-01-01T00:00:00.000Z', error: '上一轮遗留' })}\n`;
const scopeRow = report => (report ?? '').split('\n').find(l => l.startsWith('| Scope |')) ?? null;

/** 多模块夹具 + 经被测入口 change 创建归属 portal-web 的提案（guard 由安装态写入 baseRef）。 */
function changedProject(entry, evidence) {
  const root = project();
  const c = cliChange(entry, root, 'msv-smoke', 'portal-web');
  if (c.status !== 0) throw new Error(`openlogos change 失败：exit ${c.status} ${(c.stderr || '').slice(0, 300)}`);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const guard = JSON.parse(readFileSync(join(root, 'logos/.openlogos-guard'), 'utf8'));
  evidence.push(`project=${root}`, `guard.baseRef=${guard.baseRef ?? null}`, `HEAD=${head}`);
  return { root, guard, head };
}

const CASES = {
  'SMOKE-core-280': async (entry) => {
    const problems = [];
    const evidence = [`entry_realpath=${entry}`];
    const version = (run(process.execPath, [entry, '--version']).stdout || '').trim();
    const candidate = SELF_TEST ? version : candidateVersion();
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (version !== candidate) problems.push(`① --version 为 ${version}，部署记录候选版本为 ${candidate}`);
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`package_root=${pkg}`, `payload_hash=${manifest.payloadHash}`);
    try {
      const lib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
      lib.validateAssetManifest(manifest, pkg);
    } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    const read = rel => (existsSync(join(pkg, rel)) ? readFileSync(join(pkg, rel), 'utf8') : '');
    if (!read('dist/lib/verify-scope.js').includes('resolveVerifyScope')) problems.push('③ 包内缺少范围计算实现 dist/lib/verify-scope.js');
    if (!read('dist/index.js').includes("args.includes('--all')")) problems.push('③ dist/index.js 未注册 verify --all');
    if (!read('dist/commands/change.js').includes('baseRef')) problems.push('③ dist/commands/change.js 未写入 baseRef');
    if (!SELF_TEST) {
      const repoCopy = join(repoRoot, REPO_GUARD_COPY);
      const pkgGuard = join(pkg, 'claude-plugin-template/bin/guard-check');
      const a = existsSync(repoCopy) ? sha256(readFileSync(repoCopy)) : null;
      const b = existsSync(pkgGuard) ? sha256(readFileSync(pkgGuard)) : null;
      evidence.push(`repo_guard_sha256=${a}`, `package_guard_sha256=${b}`);
      if (!a || !b || a !== b) problems.push('④ 本仓托管 guard-check 与全局包内模板字节不一致（需重新执行本仓 openlogos sync 后复核）');
    }
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: `安装态身份同源（${version}）：manifest 自洽，包内含范围计算、verify --all 与 guard baseRef 写入`, evidence };
  },

  'SMOKE-core-281': async (entry) => {
    const evidence = [];
    const { root, guard, head } = changedProject(entry, evidence);
    const problems = [];
    if (guard.baseRef !== head) problems.push(`① guard.baseRef=${guard.baseRef}，应为创建提案时的 HEAD ${head}`);
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    put(root, RESULTS_REL, STALE_ROW);
    const r = verifyIn(entry, root, { env: { MSV_EMIT_FOREIGN: '1' } });
    evidence.push(`② exit=${r.status} scope=${JSON.stringify(r.data?.scope ?? null).slice(0, 400)} calls=${JSON.stringify(r.calls)}`);
    if (r.status !== 0 || r.data?.gate?.result !== 'PASS') problems.push(`② 应退出码 0 且 PASS，实际 exit=${r.status} gate=${JSON.stringify(r.data?.gate)}`);
    if (r.data?.scope?.mode !== 'module' || JSON.stringify(r.data?.scope?.modules) !== '["portal-web"]') problems.push('② scope 应为 module / ["portal-web"]');
    if (!(r.data?.scope?.reasons ?? []).some(x => x.source === 'proposal')) problems.push('② scope.reasons 应含 source:"proposal"');
    if (r.data?.summary?.defined_count !== 3) problems.push(`② defined_count 应为 3，实际 ${r.data?.summary?.defined_count}`);
    if (r.data?.scope?.out_of_scope_result_count !== 1) problems.push(`② out_of_scope_result_count 应为 1，实际 ${r.data?.scope?.out_of_scope_result_count}`);
    if ((r.data?.failed_cases ?? []).length !== 0) problems.push('② 预置遗留行与范围外行不应进入 failed_cases');
    if (JSON.stringify(r.calls.map(c => [c.label, c.modules])) !== '[["portal-web","portal-web"]]') problems.push('③ 调用日志应只有 portal-web 命令一次且 OPENLOGOS_VERIFY_MODULES=portal-web');
    if (!scopeRow(r.report)) problems.push('③ 报告 Summary 缺「Scope」行');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '安装态只改 portal-web：只执行 portal-web 命令、scope=module，本轮范围外行被忽略、遗留行不被采信，报告有范围行', evidence };
  },

  'SMOKE-core-282': async (entry) => {
    const evidence = [];
    const { root } = changedProject(entry, evidence);
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    put(root, 'scripts/release.sh', 'echo\n');
    const r = verifyIn(entry, root);
    evidence.push(`exit=${r.status} scope=${JSON.stringify(r.data?.scope ?? null).slice(0, 400)} calls=${JSON.stringify(labels(r))}`);
    const problems = [];
    if (r.data?.scope?.mode !== 'fallback-full' || r.data?.scope?.fallback_reason?.code !== 'unmapped_file') problems.push('scope 应为 fallback-full / unmapped_file');
    if (!String(r.data?.scope?.fallback_reason?.detail ?? '').includes('scripts/release.sh')) problems.push('fallback_reason.detail 应含 scripts/release.sh');
    if (JSON.stringify(labels(r)) !== '["core","portal-web"]') problems.push(`应执行 core、portal-web 命令各一次，实际 ${JSON.stringify(labels(r))}`);
    if (r.data?.summary?.defined_count !== 5) problems.push(`defined_count 应为 5，实际 ${r.data?.summary?.defined_count}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '安装态改动归不到模块时回落全量：两个模块命令各执行一次、核对全部用例', evidence };
  },

  'SMOKE-core-283': async (entry) => {
    const evidence = [];
    const { root } = changedProject(entry, evidence);
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    put(root, RESULTS_REL, STALE_ROW);
    const pass = verifyIn(entry, root, { args: ['--all'] });
    const fail = verifyIn(entry, root, { args: ['--all'], env: { MSV_CORE_FAIL: '1' } });
    evidence.push(`① exit=${pass.status} scope=${JSON.stringify(pass.data?.scope ?? null)} calls=${JSON.stringify(labels(pass))}`, `② gate=${JSON.stringify(fail.data?.gate)} failed=${JSON.stringify(fail.data?.failed_cases)}`);
    const problems = [];
    const s = pass.data?.scope;
    if (s?.mode !== 'all' || JSON.stringify(s?.modules) !== '["core","portal-web"]' || s?.fallback_reason !== null) problems.push('① scope 应为 all / ["core","portal-web"] / fallback_reason null');
    if (JSON.stringify(labels(pass)) !== '["core","portal-web"]') problems.push('① 两个模块命令应各执行一次');
    if (pass.data?.gate?.result !== 'PASS') problems.push('① 遗留行不应被采信，gate 应 PASS');
    if (JSON.stringify((fail.data?.failed_cases ?? []).map(f => f.id)) !== '["UT-S01-01"]' || fail.data?.gate?.reason !== 'failed_cases') problems.push('② 本轮 core 失败应进入 failed_cases 并以 failed_cases 阻断');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return { detail: '安装态 --all：mode=all、两个模块命令各执行一次，遗留行不被采信；本轮 core 失败才阻断', evidence };
  },

  'SMOKE-core-284': async (entry, ctx) => {
    const evidence = [`baseline_entry=${ctx.baselineEntry}`];
    const problems = [];
    const arms = {
      'A-single-module': { modules: [{ id: 'core', paths: ['src/**'] }], owner: 'core' },
      'B-no-paths': { modules: [{ id: 'core' }, { id: 'portal-web' }], owner: 'portal-web' },
    };
    for (const [name, arm] of Object.entries(arms)) {
      const root = project({ modules: arm.modules });
      const c = cliChange(entry, root, 'msv-zero', arm.owner);
      if (c.status !== 0) throw new Error(`${name}: openlogos change 失败：${(c.stderr || '').slice(0, 300)}`);
      put(root, `logos/changes/msv-zero/deltas/test/${arm.owner}-S50-test-cases.md`, '## MODIFIED — 测试\n\n| ID | 描述 |\n|---|---|\n| UT-S50-01 | 改 |\n');
      const norm = normalizer(root);
      const pick = r => {
        const env = r.envelope ? { ...r.envelope } : null;
        if (env) { delete env.version; delete env.timestamp; }
        return { status: r.status, envelope: env ? JSON.parse(norm(JSON.stringify(env))) : null, calls: r.calls, report: r.report === null ? null : norm(r.report) };
      };
      const cur = verifyIn(entry, root);
      const base = verifyIn(ctx.baselineEntry, root);
      const a = pick(cur); const b = pick(base);
      evidence.push(`${name}: project=${root} exit=${cur.status}/${base.status} calls=${JSON.stringify(labels(cur))}`);
      if ('scope' in (cur.data ?? {})) problems.push(`${name}: 不应输出 scope`);
      if ((cur.data?.pre_run?.commands ?? []).some(x => 'modules' in x)) problems.push(`${name}: pre_run.commands 不应含 modules`);
      if (scopeRow(cur.report)) problems.push(`${name}: 报告不应有范围行`);
      if (cur.data?.summary?.defined_count !== 5) problems.push(`${name}: defined 应为全部 5 条`);
      if (JSON.stringify(labels(cur)) !== '["project"]') problems.push(`${name}: 应只执行项目级命令`);
      if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${name}: 与 0.16.7 基线输出不一致`);
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '单模块与无 paths 多模块项目上的纯规格提案：无 scope、只执行项目级命令，输出与 0.16.7 回滚制品逐字一致', evidence };
  },
};

export const MODULE_SCOPED_VERIFY_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of MODULE_SCOPED_VERIFY_SMOKE_IDS) {
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
function globalInstallProblem(entry) {
  const r = run(npmBin, ['prefix', '-g']);
  if (r.status !== 0 || !r.stdout.trim()) return `无法读取 npm prefix -g：${(r.stderr || '').slice(0, 200)}`;
  const prefix = realpathSync(r.stdout.trim());
  const nodeModules = process.platform === 'win32' ? join(prefix, 'node_modules') : join(prefix, 'lib', 'node_modules');
  const pkgDir = join(nodeModules, '@miniidealab', 'openlogos');
  const within = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  if (lstatSync(pkgDir).isSymbolicLink()) return `全局包目录 ${pkgDir} 是链接（workspace link 不构成安装态证据）`;
  if (!within(realpathSync(pkgDir), entry)) return `入口 ${entry} 不在全局 npm prefix 的包目录 ${pkgDir} 内`;
  if (within(repoRoot, entry)) return `入口 ${entry} 位于工作区 ${repoRoot} 内`;
  return null;
}

/** 正式模式：从本机部署回执的回滚制品（部署前版本）在一次性 prefix 中安装基线入口。 */
function installBaseline() {
  const receiptPath = join(repoRoot, RECEIPT);
  if (!existsSync(receiptPath)) return { gap: `缺少本机部署回执 ${RECEIPT}`, missing: ['deploy-receipt'] };
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  const artifact = receipt.rollback_artifact?.path;
  if (!artifact || !existsSync(artifact)) return { gap: '部署回执未记载可用的回滚制品', missing: ['rollback-artifact'] };
  const prefix = tempDir('baseline');
  const inst = run(npmBin, ['install', '-g', '--prefix', prefix, artifact]);
  if (inst.status !== 0) throw new Error(`安装回滚制品失败：${(inst.stderr || '').slice(0, 300)}`);
  const entry = join(prefix, 'lib', 'node_modules', '@miniidealab', 'openlogos', 'dist', 'index.js');
  const version = (run(process.execPath, [entry, '--version']).stdout || '').trim();
  if (version !== receipt.previous_version) throw new Error(`回滚制品版本 ${version} 与回执 previous_version ${receipt.previous_version} 不一致`);
  return { entry, version };
}

let exitCode = 0;
try {
  let entry = null;
  let baselineEntry = null;
  if (SELF_TEST) {
    entry = realpathSync(resolve(process.env.OPENLOGOS_MSV_SMOKE_ENTRY));
    baselineEntry = realpathSync(resolve(process.env.OPENLOGOS_MSV_SMOKE_BASELINE_ENTRY));
  } else {
    const skip = (reason, missing) => exitNotApplicable(OWNED, { reason, missing, environment: ENVIRONMENT, repoRoot });
    const version = candidateVersion();
    if (!versionAtLeast(version, MIN_VERSION)) skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-version']);
    const record = existsSync(join(repoRoot, DEPLOYMENT_RECORD)) ? readFileSync(join(repoRoot, DEPLOYMENT_RECORD), 'utf8') : '';
    if (!record.includes(version)) skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version}`, ['deployment-record']);
    if (!existsSync(join(repoRoot, REPO_GUARD_COPY))) skip(`本仓未执行 openlogos sync（缺少托管副本 ${REPO_GUARD_COPY}）`, ['repo-sync']);
    const baseline = installBaseline();
    if (baseline.gap) skip(baseline.gap, baseline.missing);
    baselineEntry = baseline.entry;
    entry = globalEntry();
    const problem = !entry ? '找不到 openlogos 入口' : globalInstallProblem(entry);
    if (problem) {
      for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
      entry = null;
    }
  }
  if (entry) {
    for (const id of MODULE_SCOPED_VERIFY_SMOKE_IDS) {
      const started = Date.now();
      try {
        const { detail, evidence } = await CASES[id](entry, { baselineEntry });
        results.set(id, { status: 'pass', detail, evidence: [`entry=${entry}`, ...evidence], duration_ms: Date.now() - started });
      } catch (error) {
        results.set(id, {
          status: 'fail', detail: error instanceof Error ? error.message : String(error),
          evidence: [`entry=${entry}`, ...(error?.evidence ?? [])], duration_ms: Date.now() - started,
        });
      }
    }
  }
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = MODULE_SCOPED_VERIFY_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${MODULE_SCOPED_VERIFY_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
