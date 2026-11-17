#!/usr/bin/env node
/**
 * SMOKE-core-315～SMOKE-core-317 — 0.16.16 切片验收范围的**安装态**取证（发布提案 release-0-16-16）：
 * 来源提案 slice-verify-efficient-mode（场景 S13「S13 切片 checkpoint 的 owned 验收范围」、S32「S32 切片规划冻结验收范围时序」，
 * 根规范 spec/test-slice-manifest.md §2.3.2、§2.4、§7）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.16 切片验收范围冻结与 owned checkpoint 安装态 smoke（SMOKE-core-315～317）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.16 本机测试环境发布（release-0-16-16）」。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *
 *   - SMOKE-core-315：安装态版本与制品身份（payloadHash 自洽；包内 test-slice-manifest 导出验收范围函数，身份只在 owned 时纳入范围；
 *     包内 verify 注入 OPENLOGOS_VERIFY_SLICE_SCOPE；包内 Skill 与规范为新口径）。
 *   - SMOKE-core-316：全局 CLI 的 slice plan 按阈值判定、同一划分沿用、配置变化不改冻结值、真正重划重判、配置非法零副作用拒绝。
 *   - SMOKE-core-317：全局 CLI 的 owned checkpoint 只验收 owned 用例并注入范围变量，manifest 缺失由账本恢复，final 全量且不注入。
 *
 * 临时项目一律经被测 CLI `init` 建立后写入夹具，再初始化为一次性 git 仓库（不配置远端、不联网）；全局 CLI 以入口绝对路径
 * 经子进程调用。一次性项目内的记录型 runner 由被测 CLI 的 verify 以预跑命令调用，不调用本仓任何脚本。全部写入只在一次性
 * 目录内，结束即删除；对全局安装态只读，不读写本仓 logos/resources/（结果账本除外），不触碰本仓运行态目录。
 *
 * **窗口**：活跃变更为 release-0-16-16，或 OPENLOGOS_R01616_SMOKE=1；窗口外为全部 owned ID 写 skip（不声明 target_environment）。
 * **适用性**（缺即显式 skip）：候选版本（local-release-candidate.ts）不早于 0.16.16；部署记录记载候选版本。
 * **自测模式**（须同时满足）：OPENLOGOS_R01616_SMOKE_SELF_TEST=1、OPENLOGOS_R01616_SMOKE_ENTRY（候选入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置与版本下限，结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'release-0-16-16';
const OWNED = ['SMOKE-core-315', 'SMOKE-core-316', 'SMOKE-core-317'];
const MIN_VERSION = '0.16.16';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const CLI_TIMEOUT_MS = 120_000;

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_R01616_SMOKE_SELF_TEST === '1';
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

if (!SELF_TEST && process.env.OPENLOGOS_R01616_SMOKE_ENTRY !== undefined) {
  refuse('设置了 OPENLOGOS_R01616_SMOKE_ENTRY 但未声明自测（OPENLOGOS_R01616_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && !process.env.OPENLOGOS_R01616_SMOKE_ENTRY) refuse('自测模式需要 OPENLOGOS_R01616_SMOKE_ENTRY');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_R01616_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_R01616_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_R01616_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-r01616-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_R01616_')) delete env[key];
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
/** 取子进程输出中最后一行 JSON envelope（成功在 stdout，失败在 stderr）。 */
function envelope(r, label) {
  const lines = [...(r.stdout || '').split('\n'), ...(r.stderr || '').split('\n')].map(l => l.trim()).filter(l => l.startsWith('{'));
  for (const line of lines.reverse()) {
    try { return JSON.parse(line); } catch { /* 继续向前找 */ }
  }
  throw new Error(`${label} 没有输出 JSON envelope（exit ${r.status}）：${(r.stderr || r.stdout || '').slice(0, 300)}`);
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

const CHANGE = 'scope-smoke';
const BASE_TARGET = 'logos/resources/test/core-S01-test-cases.md';
const CHANGE_TARGET = 'logos/resources/test/core-S90-test-cases.md';
const BASELINE = ['ST-S01-01', 'UT-S01-01', 'UT-S01-02', 'UT-S01-03'];
const CHANGED = ['UT-S90-01', 'UT-S90-02', 'UT-S90-03'];
const ALL = [...BASELINE, ...CHANGED].sort();
const REGISTRY_LAUNCHED = 'project:\n  name: "r01616"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 91\nresource_index: []\n';
const RECORDER = `const fs = require('fs');
const raw = process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
const ids = raw ? JSON.parse(raw) : JSON.parse(fs.readFileSync('tools/all-ids.json', 'utf8'));
fs.appendFileSync('tools/rec-calls.jsonl', JSON.stringify({
  has_scope: Object.prototype.hasOwnProperty.call(process.env, 'OPENLOGOS_VERIFY_SLICE_SCOPE'),
  scope: process.env.OPENLOGOS_VERIFY_SLICE_SCOPE ?? null,
  eligible: ids,
}) + '\\n');
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', ids.map(id => JSON.stringify({ id, status: 'pass' })).join('\\n') + '\\n');
`;
const table = ids => ['| ID | 用例 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具用例 |`)].join('\n') + '\n';
function slices(version) {
  const a = version === 1 ? ['UT-S90-01', 'UT-S90-02'] : ['UT-S90-01'];
  const b = version === 1 ? ['UT-S90-03'] : ['UT-S90-02', 'UT-S90-03'];
  return { slices: [
    { slice_id: 'slice-a', task_text: `切片1：能力 a（覆盖 ${a.join('、')}）`, owned_test_ids: a, runner_selectors: a, spec_targets: [CHANGE_TARGET] },
    { slice_id: 'slice-b', task_text: `切片2：能力 b（覆盖 ${b.join('、')}）`, owned_test_ids: b, runner_selectors: b, spec_targets: [CHANGE_TARGET] },
  ] };
}
function setVerify(root, patch) {
  const path = join(root, 'logos', 'logos.config.json');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.verify = { ...(config.verify ?? {}), ...patch };
  writeFileSync(path, JSON.stringify(config, null, 2));
}

/** 经被测 CLI init 建立的一次性多切片项目（夹具见 smoke 规格引言）。change set 由安装包内的生成函数构造。 */
async function scopeProject(entry, pkg, tag, verifyPatch) {
  const root = realpathSync(tempDir(tag));
  const init = cli(entry, root, ['init', 'r01616', '--locale', 'zh', '--ai-tool', 'other']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || init.stdout || '').slice(0, 400)}`);
  put(root, 'logos/logos-project.yaml', REGISTRY_LAUNCHED);
  put(root, BASE_TARGET, table(BASELINE));
  const changeTable = table(CHANGED);
  put(root, CHANGE_TARGET, changeTable);
  put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: CHANGE, module: 'core' }));
  const dir = `logos/changes/${CHANGE}`;
  put(root, `${dir}/proposal.md`, `# 变更提案：${CHANGE}\n\n> module: core | created: 2026-11-17\n\n## 变更原因\n安装态 smoke 夹具。\n`);
  put(root, `${dir}/tasks.md`, '# 实现任务\n\n## [delta] 规格变更\n- [x] 已合并\n\n## [code] 代码实现\n（本段在 plan 段留空。）\n');
  const { buildTestChangeSet } = await import(pathToFileURL(join(pkg, 'dist/lib/test-change-set.js')).href);
  put(root, `${dir}/SPEC_MERGED`, `${JSON.stringify({
    type: 'baseline_closure_spec_complete',
    test_change_set: buildTestChangeSet({
      change: CHANGE, module: 'core',
      targets: [{ targetPath: CHANGE_TARGET, beforeBytes: null, afterBytes: Buffer.from(changeTable) }],
    }),
  }, null, 2)}\n`);
  put(root, `${dir}/SLICES_APPROVED`, '');
  put(root, `${dir}/slices.json`, JSON.stringify(slices(1), null, 2));
  put(root, `${dir}/slices-v2.json`, JSON.stringify(slices(2), null, 2));
  put(root, 'tools/rec.cjs', RECORDER);
  put(root, 'tools/all-ids.json', JSON.stringify(ALL));
  setVerify(root, { sandbox_mode: 'off', ...verifyPatch });
  gitInit(root);
  commitAll(root, 'fixture');
  return { root, dir: join(root, dir), input: v => `${dir}/${v === 1 ? 'slices.json' : 'slices-v2.json'}` };
}
function planOnce(entry, project, version, label) {
  const r = cli(entry, project.root, ['slice', 'plan', '--file', project.input(version), '--format', 'json']);
  return { status: r.status, json: envelope(r, label) };
}
function checkNextSlice(project) {
  const path = join(project.dir, 'tasks.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^- \[ \] (切片)/m, '- [x] $1'));
}
function recorderCalls(project) {
  const path = join(project.root, 'tools', 'rec-calls.jsonl');
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const CASES = {
  'SMOKE-core-315': async (entry) => {
    const problems = [];
    const evidence = [`entry_realpath=${entry}`];
    // ① 版本与入口
    const version = (run(process.execPath, [entry, '--version']).stdout || '').trim();
    const candidate = SELF_TEST ? version : candidateVersion();
    evidence.push(`version=${version}`, `candidate=${candidate}`);
    if (version !== candidate) problems.push(`① --version 为 ${version}，部署记录候选版本为 ${candidate}`);
    if (!SELF_TEST && !versionAtLeast(version, MIN_VERSION)) problems.push(`① --version ${version} 早于 ${MIN_VERSION}`);
    // ② payloadHash 自洽
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    evidence.push(`package_root=${pkg}`, `payload_hash=${manifest.payloadHash}`);
    try {
      const lib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
      lib.validateAssetManifest(manifest, pkg);
    } catch (e) { problems.push(`② asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    // ③ 包内 test-slice-manifest 的导出与身份规则
    const tsmPath = join(pkg, 'dist/lib/test-slice-manifest.js');
    if (!existsSync(tsmPath)) problems.push('③ 包内缺少 dist/lib/test-slice-manifest.js');
    else {
      evidence.push(`test-slice-manifest.js_sha256=${sha256(readFileSync(tsmPath))}`);
      const tsm = await import(pathToFileURL(tsmPath).href);
      for (const name of ['manifestVerifyScope', 'sameSlicePartition', 'recoverVerifyScopeFromLedger', 'computeSliceManifestIdentity']) {
        if (typeof tsm[name] !== 'function') problems.push(`③ 未导出 ${name}`);
      }
      if (typeof tsm.computeSliceManifestIdentity === 'function') {
        const base = {
          schema: 'openlogos/test-slice-manifest@1', change: CHANGE, module: 'core',
          task_fingerprint: `sha256:${'a'.repeat(64)}`, spec_fingerprint: `sha256:${'b'.repeat(64)}`,
          generated_at: '2026-11-17T00:00:00.000Z', slices: slices(1).slices,
        };
        const legacy = tsm.computeSliceManifestIdentity(base);
        const baseline = tsm.computeSliceManifestIdentity({ ...base, verify_scope: 'baseline' });
        const owned = tsm.computeSliceManifestIdentity({ ...base, verify_scope: 'owned' });
        evidence.push(`identity_legacy=${legacy}`, `identity_owned=${owned}`);
        if (legacy !== baseline) problems.push('③ 缺省与 baseline 的身份不相等');
        if (owned === legacy) problems.push('③ owned 的身份与缺省相同（未纳入验收范围）');
      }
    }
    // ④ 包内 verify、Skill 与规范
    const checks = [
      ['dist/commands/verify.js', 'OPENLOGOS_VERIFY_SLICE_SCOPE'],
      ['skills/slice-planner/SKILL.md', '删后续能否独立过本片 checkpoint'],
      ['spec/test-slice-manifest.md', '2.3.2 验收范围的沿用与恢复'],
    ];
    for (const [rel, needle] of checks) {
      // 安装包内 skills/、spec/ 位于包根；自测模式下入口在工作区 cli/，回落到仓库根的分发源。
      const packed = join(pkg, rel);
      const path = existsSync(packed) || !SELF_TEST ? packed : join(pkg, '..', rel);
      if (!existsSync(path)) { problems.push(`④ 包内缺少 ${rel}`); continue; }
      const text = readFileSync(path, 'utf8');
      evidence.push(`${rel}_sha256=${sha256(text)}`);
      if (!text.includes(needle)) problems.push(`④ ${rel} 不含「${needle}」`);
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装态版本等于候选、payloadHash 自洽；包内导出验收范围函数，身份只在 owned 时纳入范围；包内 verify 注入范围变量，Skill 与规范为新口径', evidence };
  },

  'SMOKE-core-316': async (entry) => {
    const problems = [];
    const evidence = [];
    const pkg = packageRoot(entry);
    const project = await scopeProject(entry, pkg, 'plan', { slice_scope_threshold: 3 });
    const manifestPath = join(project.dir, 'TEST_SLICE_MANIFEST.json');
    const expectPlan = (step, version, scope, source) => {
      const out = planOnce(entry, project, version, `${step} slice plan`);
      const data = out.json.data ?? {};
      evidence.push(`${step}_exit=${out.status}`, `${step}_scope=${data.verify_scope}/${data.verify_scope_source}`);
      if (out.status !== 0) problems.push(`${step} slice plan 退出码 ${out.status}：${JSON.stringify(out.json.error ?? {}).slice(0, 200)}`);
      else if (data.verify_scope !== scope || data.verify_scope_source !== source) {
        problems.push(`${step} 期望 ${scope}/${source}，实际 ${data.verify_scope}/${data.verify_scope_source}`);
      }
    };
    // ① 阈值 3、7 个用例 → owned / decided
    expectPlan('①', 1, 'owned', 'decided');
    const frozen = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).verify_scope : null;
    if (frozen !== 'owned') problems.push(`① manifest 的 verify_scope 为 ${frozen}`);
    // ② 同一划分重跑 → retained
    expectPlan('②', 1, 'owned', 'retained');
    // ③ 阈值改为 2000，同一划分 → 仍 owned / retained
    setVerify(project.root, { slice_scope_threshold: 2000 });
    expectPlan('③', 1, 'owned', 'retained');
    // ④ 真正重划 → 按当前配置 baseline / decided
    expectPlan('④', 2, 'baseline', 'decided');
    // ⑤ 配置非法 + 新划分 → 拒绝，两产物零改写
    setVerify(project.root, { slice_scope: 'full' });
    const tasksPath = join(project.dir, 'tasks.md');
    const before = [sha256(readFileSync(tasksPath)), sha256(readFileSync(manifestPath))];
    const rejected = planOnce(entry, project, 1, '⑤ slice plan');
    const code = rejected.json.error?.code ?? null;
    evidence.push(`⑤_exit=${rejected.status}`, `⑤_code=${code}`);
    if (rejected.status !== 1) problems.push(`⑤ 退出码 ${rejected.status}，应为 1`);
    if (code !== 'SLICE_PLAN_VERIFY_SCOPE_CONFIG_INVALID') problems.push(`⑤ 错误码为 ${code}`);
    const after = [sha256(readFileSync(tasksPath)), sha256(readFileSync(manifestPath))];
    if (!same(before, after)) problems.push('⑤ 拒绝后 tasks.md 或 manifest 字节发生变化');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '全局 CLI 的 slice plan 按阈值冻结 owned；同一划分重跑与配置变化后沿用；真正重划按当前配置重判；配置非法时拒绝且两产物零改写', evidence };
  },

  'SMOKE-core-317': async (entry) => {
    const problems = [];
    const evidence = [];
    const pkg = packageRoot(entry);
    const project = await scopeProject(entry, pkg, 'verify', { slice_scope: 'owned', pre_run_command: 'node tools/rec.cjs' });
    const verify = (step, extraEnv = {}) => {
      const r = cli(entry, project.root, ['verify', '--format', 'json'], extraEnv);
      const data = envelope(r, `${step} verify`).data ?? {};
      evidence.push(`${step}_verify_exit=${r.status}`, `${step}_mode=${data.verify_mode}`, `${step}_gate=${data.gate?.result}`);
      return { status: r.status, data };
    };
    // ① 规划冻结 owned，切片一 checkpoint
    const planned = planOnce(entry, project, 1, '① slice plan');
    if (planned.json.data?.verify_scope !== 'owned') problems.push(`① slice plan 冻结为 ${planned.json.data?.verify_scope}`);
    const first = verify('①');
    if (first.data.verify_mode !== 'slice-checkpoint' || first.data.gate?.result !== 'PASS') problems.push(`① 期望 checkpoint PASS，实际 ${first.data.verify_mode}/${first.data.gate?.result}`);
    if (!same(first.data.eligible_test_ids, ['UT-S90-01', 'UT-S90-02'])) problems.push(`① eligible 为 ${JSON.stringify(first.data.eligible_test_ids)}`);
    const call1 = recorderCalls(project).at(-1);
    if (!call1 || call1.scope !== 'owned' || !same(call1.eligible, ['UT-S90-01', 'UT-S90-02'])) problems.push(`① runner 收到 ${JSON.stringify(call1)}`);
    const reportPath = join(project.root, 'logos/resources/verify/acceptance-report.md');
    const report = existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : '';
    if (!report.includes('验收范围 / Verify scope: `owned`')) problems.push('① 验收报告未标明验收范围 owned');
    // ② 删除 manifest、配置改为 baseline，以相同 slices.json 重跑 → 由账本恢复 owned
    rmSync(join(project.dir, 'TEST_SLICE_MANIFEST.json'));
    setVerify(project.root, { slice_scope: 'baseline' });
    const recovered = planOnce(entry, project, 1, '② slice plan');
    evidence.push(`②_scope=${recovered.json.data?.verify_scope}/${recovered.json.data?.verify_scope_source}`);
    if (recovered.json.data?.verify_scope !== 'owned' || recovered.json.data?.verify_scope_source !== 'recovered') {
      problems.push(`② 期望 owned/recovered，实际 ${recovered.json.data?.verify_scope}/${recovered.json.data?.verify_scope_source}`);
    }
    const nextRun = cli(entry, project.root, ['next', '--format', 'json']);
    const state = envelope(nextRun, '② next').data?.modules?.[0]?.slice_verification_state ?? {};
    if (state.verify_scope !== 'owned' || !same(state.confirmed_slice_ids, ['slice-a']) || state.attempted_slice_id !== 'slice-b') {
      problems.push(`② next 的 slice_verification_state 为 ${JSON.stringify({ verify_scope: state.verify_scope, confirmed: state.confirmed_slice_ids, attempted: state.attempted_slice_id })}`);
    }
    // ③ 勾选切片一后切片二 checkpoint
    checkNextSlice(project);
    const second = verify('③');
    if (second.data.gate?.result !== 'PASS') problems.push(`③ checkpoint Gate 为 ${second.data.gate?.result}`);
    const call2 = recorderCalls(project).at(-1);
    if (!call2 || call2.scope !== 'owned' || !same(call2.eligible, CHANGED)) problems.push(`③ runner 收到 ${JSON.stringify(call2)}`);
    // ④ 勾选切片二后 final，父进程预置同名变量
    checkNextSlice(project);
    const final = verify('④', { OPENLOGOS_VERIFY_SLICE_SCOPE: 'owned' });
    if (final.data.verify_mode !== 'final' || final.data.gate?.result !== 'PASS') problems.push(`④ 期望 final PASS，实际 ${final.data.verify_mode}/${final.data.gate?.result}`);
    const call3 = recorderCalls(project).at(-1);
    if (!call3 || call3.has_scope !== false || !same(call3.eligible, ALL)) problems.push(`④ runner 收到 ${JSON.stringify(call3)}`);
    if (!existsSync(join(project.dir, 'VERIFY_PASS'))) problems.push('④ 未写 VERIFY_PASS');
    evidence.push(`recorder_calls=${recorderCalls(project).length}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '全局 CLI 的 owned checkpoint 只验收 owned 用例并注入范围变量、报告标明范围；manifest 缺失由账本恢复 owned；final 全量且不注入、写 VERIFY_PASS', evidence };
  },
};

export const RELEASE_0_16_16_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of RELEASE_0_16_16_SMOKE_IDS) {
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
    entry = realpathSync(resolve(process.env.OPENLOGOS_R01616_SMOKE_ENTRY));
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
    for (const id of RELEASE_0_16_16_SMOKE_IDS) {
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

const failed = RELEASE_0_16_16_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${RELEASE_0_16_16_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
