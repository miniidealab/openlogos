#!/usr/bin/env node
/**
 * SMOKE-core-309～SMOKE-core-311 — 0.16.14 提案分支同步主分支的**安装态**取证（来源提案 branch-sync-generated-files，
 * 场景 S44，规范 spec/branch-sync.md；发布提案 release-0-16-14）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.14 提案分支同步安装态 smoke（SMOKE-core-309～311）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.14 本机测试环境发布（release-0-16-14）」。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *
 *   - SMOKE-core-309：安装态版本与制品身份（payloadHash 自洽，包内含 branch 命令与同步实现、根规范与 schema 的 branch_sync）。
 *   - SMOKE-core-310：全局 CLI 的 branch status 与 branch sync 主链路（验收产物取主分支版本、登记表条目合并、合并提交、标记失效）。
 *   - SMOKE-core-311：仍有冲突时退出码 2 并保留现场；合并进行期间再次同步被拒绝；未入库文件占用时零改动拒绝。
 *
 * 临时项目一律经被测 CLI `init` 建立后写入夹具，再初始化为一次性 git 仓库（不配置远端、不联网）；全局 CLI 以入口绝对路径
 * 经子进程调用；全部写入只在一次性目录内，结束即删除；对全局安装态只读，不读写本仓 logos/resources/（结果账本除外），
 * 不触碰本仓的 git 分支与工作区。
 *
 * **窗口**：活跃变更为 release-0-16-14，或 OPENLOGOS_R01614_SMOKE=1；窗口外为全部 owned ID 写 skip。
 * **适用性**（缺即显式 skip）：候选版本（local-release-candidate.ts）不早于 0.16.14；部署记录记载候选版本。
 * **自测模式**（须同时满足）：OPENLOGOS_R01614_SMOKE_SELF_TEST=1、OPENLOGOS_R01614_SMOKE_ENTRY（候选入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置与版本下限，结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'release-0-16-14';
const OWNED = ['SMOKE-core-309', 'SMOKE-core-310', 'SMOKE-core-311'];
const MIN_VERSION = '0.16.14';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const REPORT = 'logos/resources/verify/acceptance-report.md';
const LEDGER = 'logos/resources/verify/test-results.jsonl';
const REGISTRY = 'logos/logos-project.yaml';
const REQ = 'logos/resources/prd/1-product-requirements/core-01-requirements.md';
const MARKER = 'logos/changes/b/VERIFY_PASS';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_R01614_SMOKE_SELF_TEST === '1';
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

if (!SELF_TEST && process.env.OPENLOGOS_R01614_SMOKE_ENTRY !== undefined) {
  refuse('设置了 OPENLOGOS_R01614_SMOKE_ENTRY 但未声明自测（OPENLOGOS_R01614_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && !process.env.OPENLOGOS_R01614_SMOKE_ENTRY) refuse('自测模式需要 OPENLOGOS_R01614_SMOKE_ENTRY');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_R01614_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_R01614_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_R01614_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-r01614-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_R01614_')) delete env[key];
    if (key === 'OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS' || key === 'OPENLOGOS_STDIO_TRACE') delete env[key];
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDE_PROJECT_DIR'].includes(key)) delete env[key];
  }
  return { ...env, ...extra };
}
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || r.stdout || '').slice(0, 300)}`);
  return r.stdout.trim();
}
const gitBlob = (root, spec) => {
  const r = spawnSync('git', ['cat-file', 'blob', spec], { cwd: root, env: cleanEnv() });
  if (r.status !== 0) throw new Error(`git cat-file blob ${spec} 失败`);
  return r.stdout;
};
/** 以子进程调用被测 CLI；不因非零退出抛错（用例自己断言退出码）。 */
function cli(entry, root, args) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root, encoding: 'utf8', env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home') }), timeout: 300_000, input: '',
  });
}
function parseJson(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label} 不是合法 JSON：${String(text).slice(0, 200)}`); }
}

const registry = (scenarios, nextId) => [
  'project:', '  name: "r01614"', 'scenario_counter:', `  next_id: ${nextId}`, 'scenarios:',
  ...scenarios.flatMap(([id, name]) => [`  - id: ${id}`, `    name: ${name}`, '    module: core']),
  'resource_index: []', '',
].join('\n');
const report = who => `# Acceptance Report\n\n${who}\n`;
const ledger = who => `{"id":"UT-${who}-01","status":"pass"}\n`;
const requirement = text => `# 需求\n\n## 场景总览\n\n${text}\n\n## 约束\n\n无。\n`;

/** 经被测 CLI init 建立的一次性项目，初始化为 git 仓库并在 main 上提交共同起点。 */
function initRepo(entry, tag, seed = () => undefined) {
  const root = realpathSync(tempDir(tag));
  const init = cli(entry, root, ['init', 'r01614', '--locale', 'zh', '--ai-tool', 'other']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || init.stdout || '').slice(0, 400)}`);
  put(root, REGISTRY, registry([['S01', '初始化']], 50));
  put(root, REPORT, report('O'));
  put(root, LEDGER, ledger('O'));
  put(root, REQ, requirement('共 1 个场景。'));
  seed(root);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'openlogos-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'O']);
  return root;
}
function commitAll(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

/**
 * 两个提案并行的构造：main 完成提案甲（新增 S50，重写验收产物，计数器 51），proposal/a 完成提案乙
 * （新增 S51，重写验收产物，计数器 51，提案目录下有 VERIFY_PASS）。withSpecClash 时两边还改了同一份需求文档的同一段。
 */
function parallelRepo(entry, tag, withSpecClash) {
  const root = initRepo(entry, tag);
  const base = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', '-b', 'proposal/a']);
  put(root, REGISTRY, registry([['S01', '初始化'], ['S51', '导入']], 51));
  put(root, REPORT, report('proposal-b'));
  put(root, LEDGER, ledger('B'));
  put(root, 'logos/changes/b/proposal.md', '# 提案乙\n');
  if (withSpecClash) put(root, REQ, requirement('共 2 个场景（新增导入）。'));
  const prop = commitAll(root, 'proposal b');
  git(root, ['checkout', '-q', 'main']);
  put(root, REGISTRY, registry([['S01', '初始化'], ['S50', '导出']], 51));
  put(root, REPORT, report('proposal-a'));
  put(root, LEDGER, ledger('A'));
  if (withSpecClash) put(root, REQ, requirement('共 2 个场景（新增导出）。'));
  const main = commitAll(root, 'proposal a');
  git(root, ['checkout', '-q', 'proposal/a']);
  put(root, MARKER, '');
  return { root, base, prop, main };
}

/** 一次性仓库的全部文件（不含 .git）、索引与 HEAD 的 SHA-256。 */
function repoState(root) {
  const files = {};
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      if (rel === '' && name === '.git') continue;
      const abs = join(dir, name);
      const r = rel === '' ? name : `${rel}/${name}`;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else files[r] = sha256(readFileSync(abs));
    }
  };
  walk(root, '');
  return sha256(JSON.stringify({ files, index: git(root, ['ls-files', '-s']), head: git(root, ['rev-parse', 'HEAD']) }));
}
const merging = root => existsSync(join(root, '.git', 'MERGE_HEAD'));
const SYNC = ['branch', 'sync', '--base', 'main', '--format', 'json'];

const CASES = {
  'SMOKE-core-309': async (entry) => {
    const problems = [];
    const evidence = [`entry_realpath=${entry}`];
    const version = (run(process.execPath, [entry, '--version']).stdout || '').trim();
    const candidate = SELF_TEST ? version : candidateVersion();
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (version !== candidate) problems.push(`① --version 为 ${version}，部署记录候选版本为 ${candidate}`);
    if (!SELF_TEST && !versionAtLeast(version, MIN_VERSION)) problems.push(`① --version ${version} 早于 ${MIN_VERSION}`);
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`package_root=${pkg}`, `payload_hash=${manifest.payloadHash}`);
    try {
      const lib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
      lib.validateAssetManifest(manifest, pkg);
    } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    for (const rel of ['dist/commands/branch.js', 'dist/lib/branch-sync.js', 'dist/lib/registry-merge.js', 'spec/branch-sync.md']) {
      if (!existsSync(join(pkg, rel))) problems.push(`③ 包内缺少 ${rel}`);
      else evidence.push(`${rel}_sha256=${sha256(readFileSync(join(pkg, rel)))}`);
    }
    try {
      const schema = JSON.parse(readFileSync(join(pkg, 'spec/logos.config.schema.json'), 'utf8'));
      const props = schema.properties?.branch_sync?.properties ?? {};
      if (!('base_branch' in props) || !('replace_paths' in props)) problems.push('③ 包内 schema 的 branch_sync 缺少 base_branch 或 replace_paths');
    } catch (e) { problems.push(`③ 包内 spec/logos.config.schema.json 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`); }
    const help = run(process.execPath, [entry, '--help']).stdout || '';
    if (!/^\s*branch <sync\|status>/m.test(help)) problems.push('④ 帮助中没有 branch <sync|status> 一行');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装态版本等于候选、payloadHash 自洽、包内含 branch 命令与同步实现、根规范与 schema 的 branch_sync，帮助已列出 branch 命令', evidence };
  },

  'SMOKE-core-310': async (entry) => {
    const problems = [];
    const { root, base, prop, main } = parallelRepo(entry, 'sync', false);
    // ① branch status
    const status = cli(entry, root, ['branch', 'status', '--base', 'main', '--format', 'json']);
    const evidence = [`status_exit=${status.status}`];
    if (status.status !== 0) problems.push(`① branch status 退出码为 ${status.status}：${(status.stderr || '').slice(0, 200)}`);
    else {
      const s = parseJson(status.stdout, 'branch status 输出').data;
      evidence.push(`behind=${s.behind}`, `ahead=${s.ahead}`);
      if (s.behind !== 1 || s.ahead !== 1) problems.push(`① behind/ahead 为 ${s.behind}/${s.ahead}，应为 1/1`);
      if (s.merge_base !== base || s.merge_base !== git(root, ['merge-base', 'HEAD', 'main'])) problems.push('① merge_base 与 git merge-base 的结果不一致');
    }
    // ② branch sync
    const sync = cli(entry, root, SYNC);
    evidence.push(`sync_exit=${sync.status}`);
    if (sync.status !== 0) throw Object.assign(new Error(`② branch sync 退出码为 ${sync.status}：${(sync.stderr || sync.stdout || '').slice(0, 300)}`), { evidence });
    const d = parseJson(sync.stdout, 'branch sync 输出').data;
    evidence.push(`result=${d.result}`, `registry=${d.registry?.status}`, `head_after=${d.head_after}`);
    if (d.result !== 'synced') problems.push(`② result 为 ${d.result}，应为 synced`);
    const replaced = (d.replaced ?? []).map(r => `${r.path}:${r.action}`);
    for (const p of [REPORT, LEDGER]) if (!replaced.includes(`${p}:took-base`)) problems.push(`② replaced 未含 ${p}（took-base）`);
    if (d.registry?.status !== 'merged') problems.push(`② registry.status 为 ${d.registry?.status}，应为 merged`);
    const counter = (d.registry?.counters ?? []).find(c => c.name === 'scenario_counter');
    if (!counter || counter.merged !== 51 || counter.both_advanced !== true) problems.push('② 计数器未报告 merged=51 且 both_advanced=true');
    if (!(d.invalidated_markers ?? []).some(m => m.slug === 'b' && m.markers.includes('VERIFY_PASS'))) problems.push('② invalidated_markers 未列出提案 b 的 VERIFY_PASS');
    // ③ 文件、登记表与标记
    for (const p of [REPORT, LEDGER]) {
      if (!readFileSync(join(root, p)).equals(gitBlob(root, `${main}:${p}`))) problems.push(`③ ${p} 的字节不等于主分支提交中的 blob`);
    }
    const reg = readFileSync(join(root, REGISTRY), 'utf8');
    if (!/id: S50/.test(reg) || !/id: S51/.test(reg)) problems.push('③ 登记表未同时含 S50 与 S51');
    if (!/next_id: 51/.test(reg)) problems.push('③ 登记表计数器不是 51');
    if (existsSync(join(root, MARKER))) problems.push('③ VERIFY_PASS 仍然存在');
    // ④ 工作区与提交
    const porcelain = git(root, ['status', '--porcelain']);
    if (porcelain !== '') problems.push(`④ 工作区不干净：${porcelain.slice(0, 200)}`);
    const parents = git(root, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1);
    if (parents.length !== 2 || parents[0] !== prop || parents[1] !== main) problems.push('④ HEAD 不是以同步前提交与 main 为两个父提交的合并提交');
    if (d.head_after !== git(root, ['rev-parse', 'HEAD'])) problems.push('④ head_after 不等于 HEAD');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: 'branch status 计数正确；branch sync 把验收产物取为主分支版本、逐条合并登记表、完成合并提交并清除 VERIFY_PASS', evidence };
  },

  'SMOKE-core-311': async (entry) => {
    const problems = [];
    const evidence = [];
    // ① ② 甲：仍有规格冲突
    const a = parallelRepo(entry, 'clash', true);
    const first = cli(entry, a.root, SYNC);
    evidence.push(`conflict_exit=${first.status}`);
    if (first.status !== 2) problems.push(`① 退出码为 ${first.status}，应为 2：${(first.stderr || '').slice(0, 200)}`);
    else {
      const d = parseJson(first.stdout, 'branch sync 输出').data;
      const remaining = d.remaining_conflicts ?? [];
      evidence.push(`result=${d.result}`, `remaining=${remaining.map(c => `${c.path}:${c.category}:${c.reason}`).join(',')}`);
      if (d.result !== 'conflicts') problems.push(`① result 为 ${d.result}，应为 conflicts`);
      if (remaining.length !== 1 || remaining[0].path !== REQ || remaining[0].category !== 'spec' || remaining[0].reason !== 'git-conflict') {
        problems.push('① remaining_conflicts 不是只有该需求文档（spec / git-conflict）');
      }
      if (!merging(a.root)) problems.push('① 合并现场未保留（MERGE_HEAD 不存在）');
      if (!readFileSync(join(a.root, REPORT)).equals(gitBlob(a.root, `${a.main}:${REPORT}`))) problems.push('① 验收报告未取主分支版本');
    }
    const second = cli(entry, a.root, SYNC);
    evidence.push(`resync_exit=${second.status}`);
    const secondCode = second.status === 1 ? parseJson(second.stderr, '错误输出').error?.code : null;
    if (second.status !== 1 || secondCode !== 'BRANCH_OPERATION_IN_PROGRESS') problems.push(`② 合并进行期间再次同步：退出码 ${second.status}、错误码 ${secondCode}，应为 1 / BRANCH_OPERATION_IN_PROGRESS`);

    // ③ 乙：被忽略的本地文件占用了主分支新增的路径
    const root = initRepo(entry, 'collision', r => {
      const ignore = join(r, '.gitignore');
      writeFileSync(ignore, `${existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''}\nnotes.md\n`);
    });
    git(root, ['checkout', '-q', '-b', 'proposal/a']);
    put(root, 'prop.txt', 'p\n');
    commitAll(root, 'proposal');
    git(root, ['checkout', '-q', 'main']);
    put(root, 'notes.md', 'main notes\n');
    git(root, ['add', '-f', 'notes.md']);
    git(root, ['commit', '-qm', 'main adds notes']);
    git(root, ['checkout', '-q', 'proposal/a']);
    put(root, 'notes.md', 'LOCAL NOTES\n');
    if (git(root, ['status', '--porcelain']) !== '') problems.push('③ 夹具不成立：被忽略的本地文件使工作区不干净');
    const before = repoState(root);
    const third = cli(entry, root, SYNC);
    evidence.push(`collision_exit=${third.status}`);
    const err = third.status === 1 ? parseJson(third.stderr, '错误输出').error : null;
    if (third.status !== 1 || err?.code !== 'BRANCH_UNTRACKED_COLLISION') problems.push(`③ 退出码 ${third.status}、错误码 ${err?.code}，应为 1 / BRANCH_UNTRACKED_COLLISION`);
    else if (JSON.stringify(err.details?.paths) !== JSON.stringify(['notes.md'])) problems.push(`③ details.paths 为 ${JSON.stringify(err.details?.paths)}，应为 ["notes.md"]`);
    if (merging(root)) problems.push('③ 发起了合并（MERGE_HEAD 存在）');
    if (repoState(root) !== before) problems.push('③ 文件、索引或 HEAD 在拒绝后发生了变化');
    if (readFileSync(join(root, 'notes.md'), 'utf8') !== 'LOCAL NOTES\n') problems.push('③ 本地 notes.md 被改写');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '仍有冲突时退出码 2 并保留现场、合并进行期间再次同步被拒绝；未入库文件占用时在发起合并前零改动拒绝', evidence };
  },
};

export const RELEASE_0_16_14_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of RELEASE_0_16_14_SMOKE_IDS) {
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
  const inside = (dir, path) => { const rel = relative(dir, path); return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel); };
  if (!existsSync(pkgDir)) return `全局 npm prefix 下没有安装包目录 ${pkgDir}`;
  if (lstatSync(pkgDir).isSymbolicLink()) return `全局包目录 ${pkgDir} 是链接（workspace link 不构成安装态证据）`;
  if (!inside(realpathSync(pkgDir), entry)) return `入口 ${entry} 不在全局 npm prefix 的包目录 ${pkgDir} 内`;
  if (inside(repoRoot, entry)) return `入口 ${entry} 位于工作区 ${repoRoot} 内`;
  return null;
}

let exitCode = 0;
try {
  let entry = null;
  if (SELF_TEST) {
    entry = realpathSync(resolve(process.env.OPENLOGOS_R01614_SMOKE_ENTRY));
  } else {
    const skip = (reason, missing) => exitNotApplicable(OWNED, { reason, missing, environment: ENVIRONMENT, repoRoot });
    const version = candidateVersion();
    if (!versionAtLeast(version, MIN_VERSION)) skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-version']);
    const record = existsSync(join(repoRoot, DEPLOYMENT_RECORD)) ? readFileSync(join(repoRoot, DEPLOYMENT_RECORD), 'utf8') : '';
    if (!record.includes(version)) skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version}`, ['deployment-record']);
    entry = globalEntry();
    const problem = !entry ? '找不到 openlogos 入口' : globalInstallProblem(entry);
    if (problem) {
      for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
      entry = null;
    }
  }
  if (entry) {
    for (const id of RELEASE_0_16_14_SMOKE_IDS) {
      const started = Date.now();
      try {
        const out = await CASES[id](entry);
        results.set(id, { status: 'pass', detail: out.detail, evidence: [`entry=${entry}`, ...out.evidence], duration_ms: Date.now() - started });
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

const failed = RELEASE_0_16_14_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${RELEASE_0_16_14_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
