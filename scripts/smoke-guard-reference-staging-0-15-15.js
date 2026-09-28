#!/usr/bin/env node
/**
 * SMOKE-core-209 / SMOKE-core-210 — guard 资料目录（R-REF）与基线 run 私有 staging（R-STAGING）
 * 默认豁免的**安装态**取证（fix-guard-reference-baseline-staging-whitelist）。
 *
 * guard 是托管资产：仓内源码修好、全局 CLI 或项目托管副本未更新，用户现场的误拦截照旧。
 * 判据用行为断言：版本号相等只证明装了新包，不证明规则生效。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目内，结束即删除；只读本机全局安装态（不安装 / 卸载），
 * 不触碰本仓活跃提案与用户其他仓库。命令图中不出现任何公网发布命令。
 *
 * 判据分两档（code-r1 F2）：
 * - **本案安装验收窗口**（活跃提案为本 slug，或 OPENLOGOS_GUARD_EXEMPT_SMOKE=1）：全局入口缺失、随包 guard
 *   缺默认豁免能力、安装身份与本次冻结候选不符，一律写 **fail** 并非零退出——不得以 skip 充当安装验收证据。
 *   候选身份在运行时读取：`cli/src/lib/local-release-candidate.ts` 的 LOCAL_RELEASE_CANDIDATE_VERSION
 *   （升版脚本写入）与仓内分发源 `plugin/bin/guard-check` 字节；不写死版本字面量。
 * - **窗口之外**（后续其它提案跑全量 smoke）：本 runner 不适用，按既有留痕机制写 skip，避免已归档
 *   提案的历史候选身份永久拉黑后续提案。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

export const GUARD_EXEMPTION_SMOKE_IDS = ['SMOKE-core-209', 'SMOKE-core-210'];
const ENVIRONMENT = 'local-global-temp-project';
const PACKAGED_GUARD = 'claude-plugin-template/bin/guard-check';
const RUNS = 'logos/resources/verify/baseline-seed-runs';
const RUN_ID = 'seed-core-0001';
const STAGING = `${RUNS}/${RUN_ID}/staging`;

const SLUG = 'fix-guard-reference-baseline-staging-whitelist';
const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH
  || 'logos/resources/verify/smoke-results.jsonl');

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: GUARD_EXEMPTION_SMOKE_IDS,
    environment: ENVIRONMENT,
    applies_when: [`active change == ${SLUG}`, 'OPENLOGOS_GUARD_EXEMPT_SMOKE=1'],
    candidate_version_source: 'cli/src/lib/local-release-candidate.ts',
    candidate_guard_source: 'plugin/bin/guard-check',
    capability_probe: `${PACKAGED_GUARD} defines is_default_exempt_path`,
    public_release_commands: [],
  }));
  process.exit(0);
}

const results = new Map();
const record = (id, status, detail, evidence = []) => results.set(id, { status, detail, evidence });

function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of GUARD_EXEMPTION_SMOKE_IDS) {
    const row = results.get(id) ?? { status: 'fail', detail: '用例未执行到（前序步骤已失败）', evidence: [] };
    appendFileSync(resultPath, `${JSON.stringify({
      id, status: row.status, timestamp, duration_ms: 0,
      environment: ENVIRONMENT, detail: row.detail, evidence: row.evidence,
    })}\n`);
  }
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (cmd, args, cwd = repoRoot, input) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, input, env: { ...process.env } });
function checked(result, label) {
  if (result.error || result.status !== 0) {
    throw new Error(`${label}：${result.error?.message ?? `exit ${result.status}`} ${(result.stdout || '') + (result.stderr || '')}`.trim().slice(0, 400));
  }
  return result.stdout;
}
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
const cli = (entry, cwd, args) => checked(run(cliBin(entry), cliArgs(entry, args), cwd), `openlogos ${args.join(' ')}`);

/** 仅供 runner 自身测试注入全局入口（不落真实全局环境）；生产运行不设置。 */
function commandLookup() {
  if (process.env.OPENLOGOS_GUARD_EXEMPT_SMOKE_ENTRY !== undefined) {
    const injected = process.env.OPENLOGOS_GUARD_EXEMPT_SMOKE_ENTRY;
    return injected && existsSync(injected) ? realpathSync(injected) : null;
  }
  const r = process.platform === 'win32'
    ? run('where', ['openlogos'])
    : run('/bin/sh', ['-lc', 'command -v openlogos']);
  if (r.status !== 0) return null;
  const first = r.stdout.split(/\r?\n/).find(line => line.trim());
  return first ? realpathSync(first.trim()) : null;
}

function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`无法从 ${entry} 定位安装态包根`);
}

/** 能力探针：安装态随包 guard 是否定义了默认豁免函数（未部署前以 skip 留痕，而非 fail）。 */
function candidateCapable(pkgRoot) {
  const guard = join(pkgRoot, PACKAGED_GUARD);
  return existsSync(guard) && /^is_default_exempt_path\(\) \{/m.test(readFileSync(guard, 'utf8'));
}

/** 以 stdin JSON + CLAUDE_PROJECT_DIR 调用项目托管 guard，取退出码与双通道输出。 */
function hook(project, toolName, toolInput) {
  const r = spawnSync('bash', [join(project, '.claude/openlogos/bin/guard-check')], {
    cwd: project, encoding: 'utf8', timeout: 20_000,
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
  });
  return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function newLaunchedProject(entry, name, scopes) {
  const base = mkdtempSync(join(tmpdir(), 'openlogos-smoke-guard-exempt-'));
  scopes.push(base);
  cli(entry, base, ['init', name, '--locale', 'zh', '--ai-tool', 'claude-code']);
  const yamlPath = join(base, 'logos/logos-project.yaml');
  writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*\S+/, 'lifecycle: launched'));
  mkdirSync(join(base, 'src'), { recursive: true });
  mkdirSync(join(base, 'logos/resources/reference'), { recursive: true });
  if (existsSync(join(base, 'logos/.openlogos-guard'))) throw new Error('临时项目意外存在活跃提案 guard 文件');
  return base;
}

const ALLOW_WRITES = [
  'logos/resources/reference/notes.md',
  'logos/resources/reference/a/b/c.md',
  `${STAGING}/system-map.md`,
  `${STAGING}/scenarios/s.md`,
];
const ALLOW_BASH = ['mkdir -p logos/resources/reference/temp', `touch ${STAGING}/a.md`];
const BLOCK_WRITES = [
  'logos/resources/reference-evil/x.md',
  `${RUNS}/${RUN_ID}/staging-backup/x.md`,
  `${RUNS}/a/b/staging/x.md`,
  `${RUNS}/${RUN_ID}/run.json`,
  `${RUNS}/${RUN_ID}/commit-journal.json`,
  `${RUNS}/${RUN_ID}/resolved/x.md`,
  `${RUNS}/${RUN_ID}/backup/x.md`,
  'logos/resources/verify/test-results.jsonl',
  'logos/resources/prd/1-product-requirements/core-01-requirements.md',
  'src/index.ts',
];
const BLOCK_BASH = ['cp logos/resources/reference/a.md src/a.md'];

/** 放行 / 阻断矩阵；返回失败描述（空数组即全部符合）。 */
function matrix(project, { allowWrites, allowBash, blockWrites, blockBash }) {
  const problems = [];
  for (const rel of allowWrites) {
    const r = hook(project, 'Write', { file_path: rel, content: 'x' });
    if (r.code !== 0) problems.push(`应放行 Write ${rel}，实际 exit ${r.code}`);
  }
  for (const command of allowBash) {
    const r = hook(project, 'Bash', { command });
    if (r.code !== 0) problems.push(`应放行 Bash「${command}」，实际 exit ${r.code}`);
  }
  for (const rel of blockWrites) {
    const r = hook(project, 'Write', { file_path: rel, content: 'x' });
    if (r.code !== 2) problems.push(`应阻断 Write ${rel}，实际 exit ${r.code}`);
    else if (!r.stdout.includes('变更管理拦截') || !r.stderr.includes('openlogos change')) {
      problems.push(`阻断 ${rel} 缺少 stdout JSON 或 stderr 指引`);
    }
  }
  for (const command of blockBash) {
    const r = hook(project, 'Bash', { command });
    if (r.code !== 2) problems.push(`应阻断 Bash「${command}」，实际 exit ${r.code}`);
  }
  return problems;
}

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (activeChange() !== SLUG && process.env.OPENLOGOS_GUARD_EXEMPT_SMOKE !== '1') {
  exitNotApplicable(GUARD_EXEMPTION_SMOKE_IDS, {
    reason: `非本案安装验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_GUARD_EXEMPT_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_GUARD_EXEMPT_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

/** 本次冻结候选身份：版本来自升版脚本写入的候选常量，guard 字节来自仓内分发源。 */
function candidateIdentity() {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const m = existsSync(src)
    ? /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(readFileSync(src, 'utf8'))
    : null;
  if (!m) throw new Error(`无法读取候选版本（${src} 缺失或无 LOCAL_RELEASE_CANDIDATE_VERSION）`);
  const guard = join(repoRoot, 'plugin/bin/guard-check');
  if (!existsSync(guard)) throw new Error(`无法读取候选 guard 分发源（${guard}）`);
  return { version: m[1], guardSha: sha256(readFileSync(guard)) };
}

/** 窗口内的任何前置失败都是安装验收失败：两条用例均记 fail 并非零退出。 */
function failAll(reason, evidence = []) {
  for (const id of GUARD_EXEMPTION_SMOKE_IDS) record(id, 'fail', reason, evidence);
  flush();
  console.error(`smoke 失败：${GUARD_EXEMPTION_SMOKE_IDS.join(', ')}：${reason}`);
  process.exit(1);
}

let candidate;
try { candidate = candidateIdentity(); } catch (error) { failAll(error instanceof Error ? error.message : String(error)); }
const entry = commandLookup();
if (!entry) failAll('本机未找到全局 openlogos 入口——本次候选未安装到全局或安装到了错误的 npm prefix', ['global:openlogos']);
let pkgRoot;
let globalVersion;
try {
  pkgRoot = packageRoot(entry);
  globalVersion = cli(entry, repoRoot, ['--version']).trim();
} catch (error) {
  failAll(error instanceof Error ? error.message : String(error), [`entry=${entry}`]);
}
if (!candidateCapable(pkgRoot)) {
  failAll(`全局安装态随包 guard 不含默认豁免（无 is_default_exempt_path，当前 ${globalVersion}）——入口仍指向旧版或安装未生效`,
    [`entry=${entry}`, `version=${globalVersion}`]);
}
if (globalVersion !== candidate.version) {
  failAll(`全局 --version（${globalVersion}）与本次冻结候选版本（${candidate.version}）不符`,
    [`entry=${entry}`, `version=${globalVersion}`, `candidate_version=${candidate.version}`]);
}

const scopes = [];
const packagedGuardBytes = readFileSync(join(pkgRoot, PACKAGED_GUARD));
const packagedGuardSha = sha256(packagedGuardBytes);
const baseEvidence = [`entry=${entry}`, `version=${globalVersion}`, `candidate_version=${candidate.version}`,
  `packaged_guard_sha256=${packagedGuardSha}`, `candidate_guard_sha256=${candidate.guardSha}`];

// ── SMOKE-core-209：安装态身份与托管 guard 放行 / 阻断矩阵 ──
try {
  const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  if (pkg.version !== globalVersion) throw new Error(`--version（${globalVersion}）与包 package.json（${pkg.version}）不一致`);
  if (packagedGuardSha !== candidate.guardSha) {
    throw new Error(`随包 guard（${packagedGuardSha}）与本次候选分发源（${candidate.guardSha}）不一致——安装的不是本次固定制品`);
  }
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'asset-manifest.json'), 'utf8'));
  if (manifest.version !== undefined && manifest.version !== globalVersion) {
    throw new Error(`asset-manifest version（${manifest.version}）与 --version（${globalVersion}）不一致`);
  }
  const registered = (manifest.plugins || []).find(p => p.path === PACKAGED_GUARD)?.sha256;
  if (registered !== packagedGuardSha) throw new Error(`asset-manifest 登记的 guard hash（${registered}）与随包 guard（${packagedGuardSha}）不一致`);

  const project = newLaunchedProject(entry, 'g209', scopes);
  const managedSha = sha256(readFileSync(join(project, '.claude/openlogos/bin/guard-check')));
  if (managedSha !== packagedGuardSha) throw new Error(`init 托管 guard（${managedSha}）与随包 guard 不一致`);

  const problems = matrix(project, {
    allowWrites: ALLOW_WRITES, allowBash: ALLOW_BASH, blockWrites: BLOCK_WRITES, blockBash: BLOCK_BASH,
  });
  if (existsSync(join(project, 'logos/.openlogos-guard'))) problems.push('矩阵执行后出现了活跃提案 guard 文件');
  if (problems.length > 0) throw new Error(problems.join('；'));
  record('SMOKE-core-209', 'pass',
    `安装态身份同源（${globalVersion}，guard hash 与 manifest 一致）；托管 guard 放行 ${ALLOW_WRITES.length + ALLOW_BASH.length} 项、阻断 ${BLOCK_WRITES.length + BLOCK_BASH.length} 项全部符合`,
    [...baseEvidence, `project=${project}`, `managed_guard_sha256=${managedSha}`]);
} catch (error) {
  record('SMOKE-core-209', 'fail', error instanceof Error ? error.message : String(error), baseEvidence);
}

// ── SMOKE-core-210：新建 / 存量项目经全局 CLI 分发获得同一规则 ──
try {
  const core = {
    allowWrites: ['logos/resources/reference/notes.md', `${STAGING}/system-map.md`],
    allowBash: [], blockWrites: [`${RUNS}/${RUN_ID}/run.json`, 'src/index.ts'], blockBash: [],
  };
  const p1 = newLaunchedProject(entry, 'g210a', scopes);
  const p1Sha = sha256(readFileSync(join(p1, '.claude/openlogos/bin/guard-check')));
  if (p1Sha !== packagedGuardSha) throw new Error(`新建项目 init 后托管 guard（${p1Sha}）与随包不一致`);

  const p2 = newLaunchedProject(entry, 'g210b', scopes);
  const managed = join(p2, '.claude/openlogos/bin/guard-check');
  // 存量项目：托管 guard 预置为不含新规则的旧字节（去掉默认豁免调用）
  const oldBytes = packagedGuardBytes.toString('utf8')
    .replace(/\n  if is_default_exempt_path "\$rel_path"; then\n    return 0\n  fi/, '');
  if (oldBytes === packagedGuardBytes.toString('utf8')) throw new Error('无法构造旧版托管 guard 字节（随包 guard 结构已变化）');
  writeFileSync(managed, oldBytes);
  chmodSync(managed, 0o755);
  const beforeSha = sha256(readFileSync(managed));
  const control = hook(p2, 'Write', { file_path: 'logos/resources/reference/notes.md', content: 'x' });
  if (control.code !== 2) throw new Error(`对照失败：旧托管 guard 对 reference 写入应 exit 2，实际 ${control.code}`);
  cli(entry, p2, ['sync']);
  const afterSha = sha256(readFileSync(managed));
  if (afterSha !== packagedGuardSha) throw new Error(`存量项目 sync 后托管 guard（${afterSha}）与随包不一致`);

  const problems = [...matrix(p1, core).map(p => `P1 ${p}`), ...matrix(p2, core).map(p => `P2 ${p}`)];
  if (problems.length > 0) throw new Error(problems.join('；'));
  record('SMOKE-core-210', 'pass',
    'init 新建项目与 sync 存量项目的托管 guard 均与随包字节一致，旧字节对照拦截、sync 后核心矩阵符合',
    [...baseEvidence, `p1=${p1}`, `p2=${p2}`, `p2_before_sha256=${beforeSha}`, `p2_after_sha256=${afterSha}`]);
} catch (error) {
  record('SMOKE-core-210', 'fail', error instanceof Error ? error.message : String(error), baseEvidence);
} finally {
  flush();
  for (const s of scopes) rmSync(s, { recursive: true, force: true });
}

const failed = GUARD_EXEMPTION_SMOKE_IDS.filter(id => (results.get(id)?.status ?? 'fail') !== 'pass');
if (failed.length > 0) {
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
  process.exit(1);
}
console.log(`smoke 通过：${GUARD_EXEMPTION_SMOKE_IDS.join(', ')}`);
