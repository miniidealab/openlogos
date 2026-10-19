#!/usr/bin/env node
/**
 * SMOKE-core-285～SMOKE-core-288 — 0.16.9 guard 按模块生命周期判定的**安装态**取证（来源提案 module-lifecycle-guard，功能规格 §2.97）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.9 guard 按模块生命周期判定安装态 smoke（SMOKE-core-285～288）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.9 本机测试环境发布（module-lifecycle-guard）」。
 *
 *   - SMOKE-core-285：安装态版本、制品身份与两仓 sync 同源（包内含共享向量与按模块归属判定；本仓、runlogos 托管 guard 同字节；
 *     runlogos 托管段对 team 给出免提案条款、无覆盖 team 的全局禁令）。
 *   - SMOKE-core-286：混合生命周期临时项目上 initial 模块免提案写入，launched / 共享 / 未归属 / 不可豁免项仍被拦，事后检查不报告。
 *   - SMOKE-core-287：sync 后托管段读回；core 有活跃提案（plan 阶段）时 team 文件放行、launched 目标结论不变。
 *   - SMOKE-core-288：零回归——全 initial、全 launched 项目的托管段与 guard 判定与 0.16.8 回滚制品一致。
 *
 * 临时项目一律经被测 CLI `init`（claude-code）+ `sync` 建立，guard 判定以项目内 sync 后的托管副本为被测对象（stdin 喂 hook JSON）。
 * 全局 CLI 以入口绝对路径经子进程调用；全部写入只在一次性目录内，结束即删除；对全局安装态只读，
 * 对本仓与 runlogos 仓库只做 SMOKE-core-285 ④⑤ 的只读比对与读回。
 *
 * **窗口**：活跃变更为 module-lifecycle-guard，或 OPENLOGOS_MLG_SMOKE=1；窗口外为全部 owned ID 写 skip。
 * **适用性**（缺即显式 skip，不标 platform-unavailable）：候选版本（local-release-candidate.ts）不早于 0.16.9；部署记录记载候选版本
 * 与 runlogos 项目根；本机部署回执有回滚制品；本仓已 sync（托管 guard-check 存在）。
 * **自测模式**（须同时满足）：OPENLOGOS_MLG_SMOKE_SELF_TEST=1、OPENLOGOS_MLG_SMOKE_ENTRY（候选入口）、OPENLOGOS_MLG_SMOKE_BASELINE_ENTRY（基线入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置与两仓比对（④⑤），结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'module-lifecycle-guard';
const OWNED = ['SMOKE-core-285', 'SMOKE-core-286', 'SMOKE-core-287', 'SMOKE-core-288'];
const MIN_VERSION = '0.16.9';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const RECEIPT = 'logos/.openlogos-runtime/local-install/last-deploy.json';
const REPO_GUARD_COPY = '.claude/openlogos/bin/guard-check';
const GLOBAL_BANS = ['禁止修改任何源代码', '存在任何 launched 模块 → 必须先创建变更提案'];

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_MLG_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;
const TARGET_ENV = process.env.OPENLOGOS_SMOKE_ENV || null;
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sha256 = buf => createHash('sha256').update(buf).digest('hex');
const run = (cmd, args, cwd = repoRoot, extra = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, ...extra });

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
/** 部署记录中 0.16.9 段记载的 runlogos 项目根（反引号包裹、以 /runlogos 结尾的绝对路径）。 */
function runlogosRootFromRecord(record) {
  const at = record.lastIndexOf(MIN_VERSION);
  const tail = at >= 0 ? record.slice(at) : record;
  const m = /`(\/[^`\s]*\/runlogos)`/.exec(tail);
  return m ? m[1] : null;
}

if (!SELF_TEST && (process.env.OPENLOGOS_MLG_SMOKE_ENTRY !== undefined || process.env.OPENLOGOS_MLG_SMOKE_BASELINE_ENTRY !== undefined)) {
  refuse('设置了 OPENLOGOS_MLG_SMOKE_ENTRY / _BASELINE_ENTRY 但未声明自测（OPENLOGOS_MLG_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && (!process.env.OPENLOGOS_MLG_SMOKE_ENTRY || !process.env.OPENLOGOS_MLG_SMOKE_BASELINE_ENTRY)) {
  refuse('自测模式需要 OPENLOGOS_MLG_SMOKE_ENTRY 与 OPENLOGOS_MLG_SMOKE_BASELINE_ENTRY');
}
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_MLG_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_MLG_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_MLG_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-mlg-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 300)}`);
  return r.stdout;
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key.startsWith('OPENLOGOS_MLG_')) delete env[key];
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDE_PROJECT_DIR'].includes(key)) delete env[key];
  }
  return { ...env, ...extra };
}
function cli(entry, root, args) {
  const r = spawnSync(process.execPath, [entry, ...args], { cwd: root, encoding: 'utf8', env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home') }), timeout: 300_000, input: '' });
  if (r.status !== 0) throw new Error(`openlogos ${args.join(' ')} 失败：exit ${r.status} ${(r.stderr || r.stdout || '').slice(0, 400)}`);
  return r;
}

const SCENARIOS = '  - id: S01\n    name: Login\n    module: core\n  - id: S44\n    name: Seats\n    module: team\n';
const YAML = {
  mixed: `project:\n  name: "mlg"\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n    paths: ["src/**"]\n  - id: team\n    name: team\n    lifecycle: initial\n    paths: ["team/**"]\nscenarios:\n${SCENARIOS}`,
  'all-initial': `project:\n  name: "mlg"\nmodules:\n  - id: core\n    name: core\n    lifecycle: initial\n    paths: ["src/**"]\n  - id: team\n    name: team\n    lifecycle: initial\n    paths: ["team/**"]\nscenarios:\n${SCENARIOS}`,
  'all-launched': `project:\n  name: "mlg"\nmodules:\n  - id: core\n    name: core\n    lifecycle: launched\n    paths: ["src/**"]\n  - id: team\n    name: team\n    lifecycle: launched\n    paths: ["team/**"]\nscenarios:\n${SCENARIOS}`,
};

/** 经被测 CLI init + sync 建立的一次性 git 项目（混合 / 全 initial / 全 launched）。 */
function makeProject(entry, kind) {
  const root = realpathSync(tempDir(kind));
  cli(entry, root, ['init', 'mlg', '--locale', 'zh', '--ai-tool', 'claude-code']);
  put(root, 'logos/logos-project.yaml', YAML[kind]);
  put(root, 'src/main.ts', 'export const main = 1;\n');
  put(root, 'team/app.ts', 'export const app = 1;\n');
  put(root, 'scripts/release.sh', 'echo release\n');
  put(root, 'logos/resources/prd/1-product-requirements/team-01-requirements.md', '# team\n');
  put(root, 'logos/resources/api/S44-seats.yaml', 'openapi: 3.0.0\n');
  cli(entry, root, ['sync']);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'openlogos-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}

function hook(root, script, input) {
  const r = spawnSync(script.endsWith('.cjs') ? process.execPath : 'bash', [join(root, '.claude/openlogos/bin', script), ...(script.endsWith('.cjs') ? ['check'] : [])], {
    cwd: root, encoding: 'utf8', timeout: 120_000, input: JSON.stringify(input), env: cleanEnv({ CLAUDE_PROJECT_DIR: root }),
  });
  return { exit: r.status ?? 1, stdout: (r.stdout || '').split(root).join('<ROOT>'), stderr: (r.stderr || '').split(root).join('<ROOT>') };
}
const pre = (root, tool, toolInput, id = `smoke-${Date.now()}-${Math.random().toString(16).slice(2)}`) => hook(root, 'guard-check', {
  session_id: 'smoke-mlg', cwd: root, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput, tool_use_id: id, permission_mode: 'default',
});
const post = (root, command, id) => hook(root, 'guard-post-check.cjs', {
  session_id: 'smoke-mlg', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: id,
  permission_mode: 'default', tool_response: { stdout: '', stderr: '', interrupted: false },
});
const write = file => ['Write', { file_path: file, content: 'x' }];
const WRITES = [
  ['team spec', ...write('logos/resources/prd/1-product-requirements/team-01-requirements.md')],
  ['team code', ...write('team/app.ts')],
  ['team api', ...write('logos/resources/api/S44-seats.yaml')],
  ['core code', ...write('src/main.ts')],
  ['unattributed', ...write('scripts/release.sh')],
  ['config', ...write('logos/logos.config.json')],
  ['team gitignore', ...write('team/.gitignore')],
  ['mixed bash', 'Bash', { command: 'echo x > team/c.ts && echo y > src/main.ts' }],
];
function managed(root, file) {
  const text = existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : '';
  const s = text.indexOf('<!-- OPENLOGOS:BEGIN -->');
  const e = text.indexOf('<!-- OPENLOGOS:END -->');
  return s >= 0 && e > s ? text.slice(s, e) : '';
}
function exemptionProblems(block, label, moduleId = 'team') {
  const problems = [];
  if (!block) return [`${label} 缺少 OpenLogos 托管段`];
  if (!block.includes('按模块生命周期豁免')) problems.push(`${label} 缺少「按模块生命周期豁免」小节`);
  if (!block.includes(`\`${moduleId}\``) || !block.includes(`\`${moduleId}-\``)) problems.push(`${label} 未列出 ${moduleId} 与其前缀规格`);
  for (const ban of GLOBAL_BANS) if (block.includes(ban)) problems.push(`${label} 仍含全局禁令「${ban}」`);
  return problems;
}

const CASES = {
  'SMOKE-core-285': async (entry) => {
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
    if (!existsSync(join(pkg, 'claude-plugin-template/test-vectors/guard-module-lifecycle.json'))) problems.push('③ 包内缺少共享向量 guard-module-lifecycle.json');
    if (!read('claude-plugin-template/bin/guard-check').includes('mlg_target_initial_owned')) problems.push('③ 包内 guard-check 缺少按模块归属判定');
    if (!read('claude-plugin-template/bin/guard-post-check.cjs').includes('function mlgInitialOwned')) problems.push('③ 包内事后检查引擎缺少按模块归属判定');
    if (!read('dist/lib/lifecycle-view.js').includes('readLifecycleView')) problems.push('③ 包内缺少生命周期视图实现 dist/lib/lifecycle-view.js');
    if (!SELF_TEST) {
      const pkgGuard = join(pkg, 'claude-plugin-template/bin/guard-check');
      const b = existsSync(pkgGuard) ? sha256(readFileSync(pkgGuard)) : null;
      const repoCopy = join(repoRoot, REPO_GUARD_COPY);
      const a = existsSync(repoCopy) ? sha256(readFileSync(repoCopy)) : null;
      evidence.push(`package_guard_sha256=${b}`, `repo_guard_sha256=${a}`);
      if (!a || !b || a !== b) problems.push('④ 本仓托管 guard-check 与全局包内模板字节不一致（需重新执行本仓 openlogos sync 后复核）');
      const record = readFileSync(join(repoRoot, DEPLOYMENT_RECORD), 'utf8');
      const rl = runlogosRootFromRecord(record);
      evidence.push(`runlogos_root=${rl}`);
      const rlCopy = rl ? join(rl, REPO_GUARD_COPY) : null;
      const c = rlCopy && existsSync(rlCopy) ? sha256(readFileSync(rlCopy)) : null;
      evidence.push(`runlogos_guard_sha256=${c}`);
      if (!c || c !== b) problems.push('⑤ runlogos 托管 guard-check 与全局包内模板字节不一致');
      const blocks = ['AGENTS.md', 'CLAUDE.md'].map(f => [f, rl ? managed(rl, f) : '']).filter(([, block]) => block);
      if (blocks.length === 0) problems.push('⑤ runlogos 没有可读回的 AGENTS.md / CLAUDE.md 托管段');
      for (const [f, block] of blocks) problems.push(...exemptionProblems(block, `⑤ runlogos ${f}`));
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: `安装态身份同源（${version}）：manifest 自洽，包内含共享向量、按模块归属判定与生命周期视图${SELF_TEST ? '' : '，两仓托管 guard 同字节、runlogos 托管段按模块限定'}`, evidence };
  },

  'SMOKE-core-286': async (entry) => {
    const root = makeProject(entry, 'mixed');
    const evidence = [`project=${root}`];
    const got = Object.fromEntries(WRITES.map(([key, tool, input]) => [key, pre(root, tool, input)]));
    evidence.push(...Object.entries(got).map(([k, r]) => `${k}=exit ${r.exit}`));
    const problems = [];
    for (const k of ['team spec', 'team code', 'team api']) if (got[k].exit !== 0) problems.push(`${k} 应放行，实际 exit ${got[k].exit}`);
    for (const k of ['core code', 'unattributed', 'config', 'team gitignore', 'mixed bash']) if (got[k].exit === 0) problems.push(`${k} 应被拦，实际放行`);
    if (!got['mixed bash'].stdout.includes('检测到写入目标：src/main.ts') || got['mixed bash'].stdout.includes('检测到写入目标：team/c.ts')) {
      problems.push('mixed bash 的 reason 应只列 src/main.ts');
    }
    const id = `smoke-post-${Date.now()}`;
    const cmd = "node -e \"require('fs').writeFileSync('team/b.ts','x')\"";
    const p1 = pre(root, 'Bash', { command: cmd }, id);
    spawnSync(process.execPath, ['-e', "require('fs').writeFileSync('team/b.ts','x')"], { cwd: root });
    const p2 = post(root, cmd, id);
    const pending = join(root, 'logos/.openlogos-runtime/pending-reports.jsonl');
    const pendingText = existsSync(pending) ? readFileSync(pending, 'utf8').trim() : '';
    evidence.push(`post: pre=${p1.exit} post=${p2.exit} pending=${pendingText.length}`);
    if (p1.exit !== 0 || p2.exit !== 0 || pendingText) problems.push(`node -e 写 team/b.ts：PreToolUse ${p1.exit}、PostToolUse ${p2.exit}、待报告项 ${pendingText ? '非空' : '空'}（应 0 / 0 / 空）`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: 'team 前缀规格、API 规格与 paths 内代码免提案写入；core、未归属、共享配置与 team/.gitignore 仍被拦；事后检查不报告 team 变化', evidence };
  },

  'SMOKE-core-287': async (entry) => {
    const root = makeProject(entry, 'mixed');
    const evidence = [`project=${root}`];
    const problems = [];
    for (const f of ['AGENTS.md', 'CLAUDE.md']) {
      const block = managed(root, f);
      problems.push(...exemptionProblems(block, `① ${f}`));
      if (!block.includes('`team/**`')) problems.push(`① ${f} 未列出 team 的 paths`);
    }
    cli(entry, root, ['change', 'core-x', '--module', 'core']);
    cli(entry, root, ['sync']);
    for (const f of ['AGENTS.md', 'CLAUDE.md']) {
      const block = managed(root, f);
      if (!block.includes('其他模块有活跃提案时，也不受该提案范围限制')) problems.push(`② ${f} 未写明其他模块有活跃提案时不受限`);
      for (const ban of GLOBAL_BANS) if (block.includes(ban)) problems.push(`② ${f} 仍含全局禁令「${ban}」`);
    }
    const team = pre(root, ...write('team/app.ts'));
    const core = pre(root, ...write('src/main.ts'));
    const delta = pre(root, ...write('logos/changes/core-x/deltas/prd/1-product-requirements/core-01-requirements.md'));
    evidence.push(`plan: team=${team.exit} core=${core.exit} delta=${delta.exit}`);
    if (team.exit !== 0) problems.push(`③ team/app.ts 应放行，实际 exit ${team.exit}`);
    if (core.exit !== 0) problems.push(`③ src/main.ts 应与 0.16.8 相同放行（Claude 提案期不收窄非 delta 路径），实际 exit ${core.exit}`);
    if (delta.exit !== 2) problems.push(`③ plan 阶段非原型 delta 应被拦，实际 exit ${delta.exit}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: 'sync 后托管段按模块限定禁令并列出 team 豁免范围；core 提案期 team 文件放行、src/main.ts 与 plan 收窄结论不变', evidence };
  },

  'SMOKE-core-288': async (entry, { baselineEntry }) => {
    const evidence = [`baseline=${baselineEntry}`];
    const problems = [];
    for (const kind of ['all-initial', 'all-launched']) {
      const now = makeProject(entry, kind);
      const old = makeProject(baselineEntry, kind);
      for (const f of ['AGENTS.md', 'CLAUDE.md']) {
        if (managed(now, f) !== managed(old, f)) problems.push(`${kind} ${f} 托管段与基线不一致`);
      }
      for (const [key, tool, input] of WRITES) {
        const a = pre(now, tool, input);
        const b = pre(old, tool, input);
        if (a.exit !== b.exit || a.stdout !== b.stdout) problems.push(`${kind} ${key}：当前 exit ${a.exit}，基线 exit ${b.exit}${a.stdout !== b.stdout ? '（reason 不同）' : ''}`);
      }
      evidence.push(`${kind}: compared`);
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '全 initial、全 launched 项目的托管段与 guard 判定与基线逐字节一致', evidence };
  },
};

export const MODULE_LIFECYCLE_GUARD_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of MODULE_LIFECYCLE_GUARD_SMOKE_IDS) {
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
    entry = realpathSync(resolve(process.env.OPENLOGOS_MLG_SMOKE_ENTRY));
    baselineEntry = realpathSync(resolve(process.env.OPENLOGOS_MLG_SMOKE_BASELINE_ENTRY));
  } else {
    const skip = (reason, missing) => exitNotApplicable(OWNED, { reason, missing, environment: ENVIRONMENT, repoRoot });
    const version = candidateVersion();
    if (!versionAtLeast(version, MIN_VERSION)) skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-version']);
    const record = existsSync(join(repoRoot, DEPLOYMENT_RECORD)) ? readFileSync(join(repoRoot, DEPLOYMENT_RECORD), 'utf8') : '';
    if (!record.includes(version)) skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version}`, ['deployment-record']);
    if (!runlogosRootFromRecord(record)) skip('部署记录未记载 runlogos 项目根（runlogos 仓库 sync 未完成）', ['runlogos-sync']);
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
    for (const id of MODULE_LIFECYCLE_GUARD_SMOKE_IDS) {
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

const failed = MODULE_LIFECYCLE_GUARD_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${MODULE_LIFECYCLE_GUARD_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
