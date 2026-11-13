#!/usr/bin/env node
/**
 * SMOKE-core-312～SMOKE-core-314 — 0.16.15 两项修复的**安装态**取证（发布提案 release-0-16-15）：
 * guard 后台执行记录的关闭（来源提案 fix-guard-background-record-never-closed，场景 S09-F，规范 spec/pretooluse-guard.md
 * 「执行记录生命周期（C12）」关闭条件 4、5）与 openlogos merge 的合并基线写入不再经标准输入
 * （来源提案 fix-merge-hang-on-baseline-blob-stdin，场景 S09 EX-9.46）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.15 guard 后台记录收敛与 merge 基线写入安装态 smoke（SMOKE-core-312～314）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.15 本机测试环境发布（release-0-16-15）」。
 * 本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口：
 *
 *   - SMOKE-core-312：安装态版本与制品身份（payloadHash 自洽；包内 merge 基线写法带 --no-filters、不带 --stdin；
 *     包内 guard 引擎导出新的关闭判定；SessionStart 入口把宿主输入转交引擎）。
 *   - SMOKE-core-313：全局 CLI 的 merge 首次合并 CRLF 目标，基线逐字节读回、不留临时文件，随后的增量修正成功。
 *   - SMOKE-core-314：一次性项目内由全局 CLI 部署的 guard 托管脚本——后台记录在 Stop 时按任务清单关闭；
 *     超过 7 天的其他会话记录经 SessionStart 入口关闭，当前会话记录保留，缺少会话标识时不关闭。
 *
 * 临时项目一律经被测 CLI `init` 建立后写入夹具，再初始化为一次性 git 仓库（不配置远端、不联网）；全局 CLI 以入口绝对路径
 * 经子进程调用；SMOKE-core-314 驱动的是该一次性项目 `.claude/openlogos/bin/` 下由被测 CLI 部署的托管脚本，不调用本仓
 * plugin/bin/ 分发源，也不调用本仓 .claude/openlogos/bin/ 副本。全部写入只在一次性目录内，结束即删除；对全局安装态只读，
 * 不读写本仓 logos/resources/（结果账本除外），不触碰本仓运行态目录与执行记录。
 *
 * **窗口**：活跃变更为 release-0-16-15，或 OPENLOGOS_R01615_SMOKE=1；窗口外为全部 owned ID 写 skip（不声明 target_environment）。
 * **适用性**（缺即显式 skip）：候选版本（local-release-candidate.ts）不早于 0.16.15；部署记录记载候选版本。
 * **自测模式**（须同时满足）：OPENLOGOS_R01615_SMOKE_SELF_TEST=1、OPENLOGOS_R01615_SMOKE_ENTRY（候选入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置与版本下限，结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'release-0-16-15';
const OWNED = ['SMOKE-core-312', 'SMOKE-core-313', 'SMOKE-core-314'];
const MIN_VERSION = '0.16.15';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const REGISTRY = 'logos/logos-project.yaml';
const REQ = 'logos/resources/prd/1-product-requirements/core-01-requirements.md';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_R01615_SMOKE_SELF_TEST === '1';
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

if (!SELF_TEST && process.env.OPENLOGOS_R01615_SMOKE_ENTRY !== undefined) {
  refuse('设置了 OPENLOGOS_R01615_SMOKE_ENTRY 但未声明自测（OPENLOGOS_R01615_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && !process.env.OPENLOGOS_R01615_SMOKE_ENTRY) refuse('自测模式需要 OPENLOGOS_R01615_SMOKE_ENTRY');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_R01615_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_R01615_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_R01615_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-r01615-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_R01615_')) delete env[key];
    if (key === 'OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS' || key === 'OPENLOGOS_STDIO_TRACE') delete env[key];
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
const gitBlob = (root, spec) => {
  const r = spawnSync('git', ['cat-file', 'blob', spec], { cwd: root, env: cleanEnv() });
  if (r.status !== 0) throw new Error(`git cat-file blob ${spec} 失败`);
  return r.stdout;
};
/** 以子进程调用被测 CLI；不因非零退出抛错（用例自己断言退出码）。 */
function cli(entry, root, args, extraEnv = {}, timeout = 300_000) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root, encoding: 'utf8', env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home'), ...extraEnv }), timeout, input: '',
  });
}
function parseJson(text, label) {
  try { return JSON.parse(text); } catch { throw new Error(`${label} 不是合法 JSON：${String(text).slice(0, 200)}`); }
}

const REGISTRY_LAUNCHED = 'project:\n  name: "r01615"\nmodules:\n  - id: core\n    name: Core\n    lifecycle: launched\nscenario_counter:\n  next_id: 40\nresource_index: []\n';
const FEATURE = 'logos/resources/prd/2-product-design/1-feature-specs/core-01-feature-specs.md';
const TARGETS = [
  { target: REQ, delta: 'deltas/prd/1-product-requirements/core-01-requirements.md' },
  { target: FEATURE, delta: 'deltas/prd/2-product-design/1-feature-specs/core-01-feature-specs.md' },
  { target: 'logos/resources/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md', delta: 'deltas/prd/3-technical-plan/2-scenario-implementation/core-S01-flow.md' },
  { target: 'logos/resources/test/core-S01-test-cases.md', delta: 'deltas/test/core-S01-test-cases.md' },
];
const SECTION = '一、判据';
const BASELINE_TMP_PREFIX = 'openlogos-merge-baseline-';
const DAY_MS = 24 * 60 * 60 * 1000;
const MERGE_TIMEOUT_MS = 120_000;

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
/** 经被测 CLI init 建立的一次性项目（launched 模块）。 */
function initProject(entry, tag, aiTool) {
  const root = realpathSync(tempDir(tag));
  const init = cli(entry, root, ['init', 'r01615', '--locale', 'zh', '--ai-tool', aiTool]);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || init.stdout || '').slice(0, 400)}`);
  put(root, REGISTRY, REGISTRY_LAUNCHED);
  return root;
}
/** 安装包内随包分发的 Claude 托管脚本目录（自测模式下入口在工作区，回落到分发源）。 */
function packagedBinDir(pkg) {
  const packed = join(pkg, 'claude-plugin-template', 'bin');
  if (existsSync(packed)) return packed;
  if (SELF_TEST) return join(pkg, '..', 'plugin', 'bin');
  throw new Error(`安装包内没有 ${packed}`);
}

const CASES = {
  'SMOKE-core-312': async (entry) => {
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
    // ③ merge 基线写法与 SessionStart 入口
    const baselineJs = join(pkg, 'dist/lib/merge-baseline.js');
    if (!existsSync(baselineJs)) problems.push('③ 包内缺少 dist/lib/merge-baseline.js');
    else {
      const text = readFileSync(baselineJs, 'utf8');
      evidence.push(`merge-baseline.js_sha256=${sha256(readFileSync(baselineJs))}`);
      const calls = text.match(/\[\s*'hash-object'[^\]]*\]/g) ?? [];
      const writes = calls.filter(c => c.includes("'-w'"));
      if (writes.length !== 1) problems.push(`③ merge-baseline.js 中写入对象库的 hash-object 调用应恰有 1 处，实际 ${writes.length} 处`);
      else {
        evidence.push(`hash_object_args=${writes[0].replace(/\s+/g, ' ')}`);
        if (!writes[0].includes("'--no-filters'")) problems.push('③ hash-object 调用未带 --no-filters');
      }
      if (text.includes("'--stdin'")) problems.push('③ merge-baseline.js 仍含 --stdin');
    }
    const binDir = packagedBinDir(pkg);
    const phase = join(binDir, 'openlogos-phase');
    const engine = join(binDir, 'guard-post-check.cjs');
    if (!existsSync(phase)) problems.push(`③ 包内缺少 ${relative(pkg, phase)}`);
    else {
      const text = readFileSync(phase, 'utf8');
      evidence.push(`openlogos-phase_sha256=${sha256(readFileSync(phase))}`);
      const call = text.split('\n').find(l => l.includes('check --session-start') && l.includes('node ')) ?? '';
      if (!call) problems.push('③ openlogos-phase 中没有调用引擎 check --session-start');
      else {
        if (!/printf '%s' "\$OPENLOGOS_HOOK_INPUT" \|/.test(call)) problems.push('③ openlogos-phase 调用引擎时没有把保存的宿主输入写入其标准输入');
        if (call.includes('</dev/null')) problems.push('③ openlogos-phase 调用引擎时仍固定传入空输入');
      }
      if (!/read\b[^\n]*OPENLOGOS_HOOK_INPUT/.test(text)) problems.push('③ openlogos-phase 没有读取并保存宿主输入');
    }
    // ④ 引擎导出
    if (!existsSync(engine)) problems.push(`④ 包内缺少 ${relative(pkg, engine)}`);
    else {
      evidence.push(`guard-post-check.cjs_sha256=${sha256(readFileSync(engine))}`);
      const mod = createRequire(import.meta.url)(engine);
      for (const name of ['backgroundTasksOf', 'closableByBackgroundTasks', 'recordExpired']) {
        if (typeof mod[name] !== 'function') problems.push(`④ 引擎未导出 ${name}`);
      }
      if (mod.RECORD_EXPIRE_MS !== 7 * DAY_MS) problems.push(`④ RECORD_EXPIRE_MS 为 ${mod.RECORD_EXPIRE_MS}，应为 ${7 * DAY_MS}`);
      evidence.push(`record_expire_ms=${mod.RECORD_EXPIRE_MS}`);
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '安装态版本等于候选、payloadHash 自洽；包内 merge 基线写法带 --no-filters、不带 --stdin；SessionStart 入口把宿主输入转交引擎；引擎导出后台任务现状关闭与超期关闭判定，阈值为 7 天', evidence };
  },

  'SMOKE-core-313': async (entry) => {
    const problems = [];
    const slug = 'baseline-crlf';
    const root = initProject(entry, 'merge', 'other');
    const proposal = `logos/changes/${slug}`;
    put(root, 'logos/.openlogos-guard', `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
    for (const t of TARGETS) {
      const isTest = t.target.includes('/test/');
      const body = isTest ? '| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |' : '旧正文。';
      const next = isTest ? body.replace('旧定义', '新定义') : '新正文。';
      put(root, t.target, `# 文档\n\n## ${SECTION}\n\n${body}\n`);
      put(root, `${proposal}/${t.delta}`, `## MODIFIED — ${SECTION}\n\n${next}\n`);
    }
    put(root, `${proposal}/proposal.md`, [
      '# 变更提案：baseline crlf', '', '## 变更原因', '安装态取证夹具。', '', '## 变更类型', '需求级', '', '## 变更范围', '- 影响的功能规格：夹具', '',
      '## 部署影响', '- 是否需要部署：否', '- 部署原因：无', '- 影响环境：无', '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
      '## 变更概述', '概述。', '', '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete', 'impacts:',
      '  data: {status: none, reason: fixture}', '  compatibility: {status: none, reason: fixture}', '  security_privacy: {status: none, reason: fixture}',
      '  public_release: {status: none, reason: fixture}', '  external_commitment: {status: none, reason: fixture}', 'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
    ].join('\n'));
    const deltaTasks = [...TARGETS].sort((a, b) => a.delta.localeCompare(b.delta)).map(t => `- [x] [MODIFY] \`${t.delta}\`：夹具更新`).join('\n');
    put(root, `${proposal}/tasks.md`, `# 任务\n\n## [delta] 规格变更\n${deltaTasks}\n\n## [code] 代码实现\n`);
    put(root, `${proposal}/PLAN_APPROVED`, '{}');
    gitInit(root);
    git(root, ['config', 'core.autocrlf', 'true']);
    // 功能规格目标在工作区中为 CRLF 换行并已提交（autocrlf 下仓库内为 LF，工作区保持 CRLF）
    const featureAbs = join(root, FEATURE);
    const crlf = Buffer.from(readFileSync(featureAbs, 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
    writeFileSync(featureAbs, crlf);
    commitAll(root, 'O');
    // ① 合并前的工作区字节
    const before = readFileSync(featureAbs);
    const evidence = [`before_sha256=${sha256(before)}`, `before_has_crlf=${before.includes(Buffer.from('\r\n'))}`];
    if (!before.equals(crlf) || !before.includes(Buffer.from('\r\n'))) problems.push('① 夹具未能保持 CRLF 工作区字节');
    const tmp = realpathSync(tempDir('merge-tmp'));
    const leftovers = () => readdirSync(tmp).filter(n => n.startsWith(BASELINE_TMP_PREFIX));
    // ② 全局 CLI 首次合并（受控 TMPDIR，设时限；超时判 fail，不重试）
    const started = Date.now();
    const first = cli(entry, root, ['merge', slug, '--format', 'json'], { TMPDIR: tmp }, MERGE_TIMEOUT_MS);
    evidence.push(`merge_exit=${first.status}`, `merge_ms=${Date.now() - started}`);
    if (first.error?.code === 'ETIMEDOUT' || first.signal) {
      throw Object.assign(new Error(`② merge 在 ${MERGE_TIMEOUT_MS / 1000} 秒内未返回（signal=${first.signal ?? 'none'}），判定为卡死`), { evidence });
    }
    if (first.status !== 0) throw Object.assign(new Error(`② merge 退出码为 ${first.status}：${(first.stderr || first.stdout || '').slice(0, 400)}`), { evidence });
    const d1 = parseJson(first.stdout, 'merge 输出').data;
    evidence.push(`result=${d1.result}`);
    if (d1.result !== 'merged') problems.push(`② result 为 ${d1.result}，应为 merged`);
    // ③ 合并基线读回
    const marker = parseJson(readFileSync(join(root, proposal, 'SPEC_MERGED'), 'utf8'), 'SPEC_MERGED');
    const entryOf = (marker.merge_baseline?.targets ?? []).find(t => t.path === FEATURE);
    const blobId = entryOf?.before?.git_blob ?? null;
    evidence.push(`git_blob=${blobId}`);
    if (!blobId) problems.push('③ 该目标的 before.git_blob 为 null 或缺失');
    else {
      const blob = gitBlob(root, blobId);
      evidence.push(`blob_sha256=${sha256(blob)}`);
      if (!blob.equals(before)) problems.push('③ 基线读回字节与合并前工作区字节不同');
      if (!blob.includes(Buffer.from('\r\n'))) problems.push('③ 基线读回字节不再是 CRLF');
      if (sha256(blob) !== entryOf.before.sha256) problems.push('③ 基线读回字节的 SHA-256 与 before.sha256 不一致');
    }
    // ④ 不留基线临时文件
    if (leftovers().length > 0) problems.push(`④ 首次合并后受控 TMPDIR 残留 ${leftovers().join(', ')}`);
    // ⑤ 提交后修改 delta，增量修正
    commitAll(root, 'merge specs');
    put(root, `${proposal}/${TARGETS[1].delta}`, `## MODIFIED — ${SECTION}\n\n再次修正的正文。\n`);
    const second = cli(entry, root, ['merge', slug, '--format', 'json'], { TMPDIR: tmp }, MERGE_TIMEOUT_MS);
    evidence.push(`amend_exit=${second.status}`);
    if (second.error?.code === 'ETIMEDOUT' || second.signal) problems.push(`⑤ 增量修正在 ${MERGE_TIMEOUT_MS / 1000} 秒内未返回，判定为卡死`);
    else if (second.status !== 0) problems.push(`⑤ 增量修正退出码为 ${second.status}：${(second.stderr || second.stdout || '').slice(0, 300)}`);
    else {
      const d2 = parseJson(second.stdout, '增量修正输出').data;
      evidence.push(`amend_result=${d2.result}`);
      if (d2.result !== 'amended') problems.push(`⑤ result 为 ${d2.result}，应为 amended`);
      if (!readFileSync(featureAbs, 'utf8').includes('再次修正的正文。')) problems.push('⑤ 目标未写入修正后的内容');
    }
    if (leftovers().length > 0) problems.push(`⑤ 增量修正后受控 TMPDIR 残留 ${leftovers().join(', ')}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '全局 CLI 首次合并 CRLF 目标后基线逐字节读回（仍为 CRLF）、摘要一致、不留基线临时文件；随后的增量修正成功', evidence };
  },

  'SMOKE-core-314': async (entry) => {
    const problems = [];
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    const root = initProject(entry, 'guard', 'claude-code');
    put(root, 'src/a.js', 'a\n');
    const ignore = join(root, '.gitignore');
    const ignoreText = existsSync(ignore) ? readFileSync(ignore, 'utf8') : '';
    if (!ignoreText.includes('logos/.openlogos-runtime/')) writeFileSync(ignore, `${ignoreText}${ignoreText.endsWith('\n') || ignoreText === '' ? '' : '\n'}logos/.openlogos-runtime/\n`);
    gitInit(root);
    commitAll(root, 'O');
    // 前置：一次性项目内的托管脚本由被测 CLI 部署，且与包内同名文件逐字节一致
    const managed = join(root, '.claude', 'openlogos', 'bin');
    const packaged = packagedBinDir(pkg);
    const evidence = [`managed_bin=${managed}`];
    for (const name of ['guard-check', 'guard-post-check.cjs', 'openlogos-phase']) {
      if (!existsSync(join(managed, name))) throw Object.assign(new Error(`前置：一次性项目内没有托管脚本 ${name}`), { evidence });
      const a = sha256(readFileSync(join(managed, name)));
      const b = sha256(readFileSync(join(packaged, name)));
      evidence.push(`${name}_sha256=${a}`);
      if (a !== b) problems.push(`前置：托管脚本 ${name} 与包内文件不一致`);
    }
    const guardCheck = join(managed, 'guard-check');
    const engine = join(managed, 'guard-post-check.cjs');
    const phase = join(managed, 'openlogos-phase');
    const recDir = join(root, 'logos', '.openlogos-runtime', 'guard-records');
    const recFile = id => existsSync(join(recDir, `${id}.json`));
    const tomb = id => existsSync(join(recDir, `${id}.closed`));
    const readRec = id => JSON.parse(readFileSync(join(recDir, `${id}.json`), 'utf8'));
    const clock = ms => ({ OPENLOGOS_GUARD_NOW_NS: (BigInt(ms) * 1000000n).toString() });
    const hookEnv = extra => cleanEnv({ CLAUDE_PROJECT_DIR: root, ...extra });
    const baseInput = (session, event) => ({
      session_id: session, transcript_path: join(root, '.transcript.jsonl'), cwd: root, permission_mode: 'default', hook_event_name: event,
    });
    const spawnHook = (cmd, args, input, extra = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', input, env: hookEnv(extra), timeout: 120_000 });
    /** 后台 Bash 调用的 PreToolUse（托管 guard-check）。 */
    const bgPre = (session, id, command, extra = {}) => spawnHook('bash', [guardCheck], JSON.stringify({
      ...baseInput(session, 'PreToolUse'), tool_name: 'Bash', tool_input: { command, run_in_background: true }, tool_use_id: id,
    }), extra);
    /** 后台 Bash 调用的 PostToolUse（托管引擎；tool_response 含后台任务标识）。 */
    const bgPost = (session, id, command, taskId) => spawnHook(process.execPath, [engine, 'check'], JSON.stringify({
      ...baseInput(session, 'PostToolUse'), tool_name: 'Bash', tool_input: { command, run_in_background: true }, tool_use_id: id,
      tool_response: { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: taskId },
    }));
    const stop = (session, tasks) => spawnHook(process.execPath, [engine, 'check', '--stop'], JSON.stringify({
      ...baseInput(session, 'Stop'), stop_hook_active: false, last_assistant_message: 'done',
      background_tasks: tasks.map(t => ({ id: t, type: 'shell', status: 'running', description: `task ${t}`, command: `node ${t}.js` })), session_crons: [],
    }));
    const runPhase = (stdin, ms) => spawnHook('bash', [phase], stdin, clock(ms));

    // ① 会话 s1 两条后台调用
    for (const [id, task] of [['R1', 't1'], ['R2', 't2']]) {
      const pre = bgPre('s1', id, `node bg-${id}.js`);
      if (pre.status !== 0) throw Object.assign(new Error(`① ${id} 的 PreToolUse 退出码为 ${pre.status}：${(pre.stderr || '').slice(0, 300)}`), { evidence });
      const post = bgPost('s1', id, `node bg-${id}.js`, task);
      if (post.status !== 0) problems.push(`① ${id} 的 PostToolUse 退出码为 ${post.status}`);
      if (!recFile(id)) throw Object.assign(new Error(`① ${id} 没有建立执行记录`), { evidence });
      const rec = readRec(id);
      if (rec.background !== true || rec.background_task_id !== task) problems.push(`① ${id} 的记录 background=${rec.background}、background_task_id=${rec.background_task_id}`);
    }
    // ② s1 Stop，现状只含 t2
    const s2 = stop('s1', ['t2']);
    evidence.push(`stop_t2_exit=${s2.status}`);
    if (s2.status !== 0) problems.push(`② Stop 退出码为 ${s2.status}：${(s2.stderr || '').slice(0, 200)}`);
    if (recFile('R1') || !tomb('R1')) problems.push('② R1 未被关闭（记录仍在或没有墓碑）');
    if (!recFile('R2')) problems.push('② R2 被误关');
    // ③ s1 Stop，空数组
    const s3 = stop('s1', []);
    evidence.push(`stop_empty_exit=${s3.status}`);
    if (s3.status !== 0) problems.push(`③ Stop 退出码为 ${s3.status}`);
    if (recFile('R2')) problems.push('③ R2 未被关闭');
    // ④ 时刻 T：s0 建立 R0，s2 建立未回填标识的 Rb；推进 7 天零 1 秒后经托管入口发送 s2 的 SessionStart
    const T = Date.parse('2026-10-01T00:00:00.000Z');
    for (const [session, id] of [['s0', 'R0'], ['s2', 'Rb']]) {
      const pre = bgPre(session, id, `node bg-${id}.js`, clock(T));
      if (pre.status !== 0 || !recFile(id)) throw Object.assign(new Error(`④ ${id} 未能建立（exit ${pre.status}）`), { evidence });
      if (readRec(id).created_at !== new Date(T).toISOString()) problems.push(`④ ${id} 的 created_at 未取可注入时钟`);
    }
    const later = T + 7 * DAY_MS + 1000;
    const start = runPhase(JSON.stringify({ ...baseInput('s2', 'SessionStart'), source: 'startup' }), later);
    evidence.push(`session_start_exit=${start.status}`);
    if (start.status !== 0) problems.push(`④ SessionStart 入口退出码为 ${start.status}：${(start.stderr || '').slice(0, 300)}`);
    else {
      try {
        const out = JSON.parse(start.stdout);
        if (out.hookSpecificOutput?.hookEventName !== 'SessionStart') problems.push('④ 入口输出的 hookEventName 不是 SessionStart');
      } catch { problems.push(`④ 入口标准输出不是合法 JSON：${start.stdout.slice(0, 200)}`); }
    }
    if (recFile('R0') || !tomb('R0')) problems.push('④ 超过 7 天的其他会话记录 R0 未被关闭');
    if (!recFile('Rb')) problems.push('④ 当前会话的记录 Rb 被误关');
    // ⑤ 重建 R0，以空标准输入运行同一入口：缺少会话标识时不做超期关闭
    const again = bgPre('s0', 'R0b', 'node bg-R0b.js', clock(T));
    if (again.status !== 0 || !recFile('R0b')) throw Object.assign(new Error(`⑤ R0b 未能建立（exit ${again.status}）`), { evidence });
    const empty = runPhase('', later);
    evidence.push(`session_start_empty_exit=${empty.status}`);
    if (empty.status !== 0) problems.push(`⑤ 空输入时入口退出码为 ${empty.status}`);
    else { try { JSON.parse(empty.stdout); } catch { problems.push('⑤ 空输入时入口标准输出不是合法 JSON'); } }
    if (!recFile('R0b')) problems.push('⑤ 缺少会话标识时 R0b 仍被关闭');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '托管脚本与包内一致；后台记录在 Stop 现状不含其标识时关闭、仍含时保留；超过 7 天的其他会话记录经 SessionStart 入口关闭，当前会话记录保留，缺少会话标识时不关闭', evidence };
  },
};

export const RELEASE_0_16_15_SMOKE_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of RELEASE_0_16_15_SMOKE_IDS) {
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
    entry = realpathSync(resolve(process.env.OPENLOGOS_R01615_SMOKE_ENTRY));
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
    for (const id of RELEASE_0_16_15_SMOKE_IDS) {
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

const failed = RELEASE_0_16_15_SMOKE_IDS.filter(id => results.get(id)?.status === 'fail');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${RELEASE_0_16_15_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
