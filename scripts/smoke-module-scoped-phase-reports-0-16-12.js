#!/usr/bin/env node
/**
 * SMOKE-core-298～SMOKE-core-302 — 0.16.12 多模块项目按模块阶段报告的**安装态**取证（来源提案 module-scoped-phase-reports，
 * 决策 C01、proposal-r1 F1～F3、delta-r1 F1～F2，功能规格 §2.99）。
 * 规格：logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.12 多模块按模块阶段报告安装态 smoke（SMOKE-core-298～302）」；
 * 部署：core-01-deployment-plan.md「OpenLogos 0.16.12 本机测试环境发布（module-scoped-phase-reports）」。
 *
 *   - SMOKE-core-298：安装态版本、制品身份与本仓 sync 同源（包内 flow-spec §9 含模块报告解析、environments.md 含 §14.9）。
 *   - SMOKE-core-299：initial 模块凭本模块验收报告离开 3-6；共用报告不计入；预跑失败时模块报告改判 FAIL、回到 3-6。
 *   - SMOKE-core-300：部署失败不写模块部署报告；版本通道成功写并推进 3-7；core 提案目录与共用部署报告字节不变。
 *   - SMOKE-core-301：只有共用报告时 launch 拒绝；team smoke PASS 后写模块冒烟报告、全部阶段完成并可 launch。
 *   - SMOKE-core-302：单模块项目 verify / deploy-done / smoke / status 与 0.16.11 基线一致，且不产生任何模块报告。
 *
 * 临时项目一律经被测 CLI `init` 建立；全局 CLI 以入口绝对路径经子进程调用；全部写入只在一次性目录内，结束即删除；
 * 对全局安装态只读，对本仓只做 SMOKE-core-298 ④ 的只读比对。
 *
 * **窗口**：活跃变更为 module-scoped-phase-reports，或 OPENLOGOS_MSPR_SMOKE=1；窗口外为全部 owned ID 写 skip。
 * **适用性**（缺即显式 skip，不标 platform-unavailable）：候选版本（local-release-candidate.ts）不早于 0.16.12；部署记录记载候选版本；
 * 本机留存制品中有回滚版本常量（升版前版本）的 tarball；本仓已 sync（logos/spec/flow-spec.md 存在）。
 * **自测模式**（须同时满足）：OPENLOGOS_MSPR_SMOKE_SELF_TEST=1、OPENLOGOS_MSPR_SMOKE_ENTRY（候选入口）、OPENLOGOS_MSPR_SMOKE_BASELINE_ENTRY（基线入口），
 * 且 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；跳过环境前置与本仓比对（④），结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';
import { rollbackVersionConst, selectBaselineArtifact } from './lib/local-install-baseline.mjs';

const SLUG = 'module-scoped-phase-reports';
const OWNED = ['SMOKE-core-298', 'SMOKE-core-299', 'SMOKE-core-300', 'SMOKE-core-301', 'SMOKE-core-302'];
const MIN_VERSION = '0.16.12';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const DEPLOYMENT_RECORD = 'logos/resources/verify/deployment-report.md';
const REPO_SYNCED_FILES = [
  ['logos/spec/flow-spec.md', 'spec/flow-spec.md'],
  ['logos/spec/test-results.md', 'spec/test-results.md'],
  ['logos/spec/environments.md', 'spec/environments.md'],
  ['logos/spec/directory-convention.md', 'spec/directory-convention.md'],
  ['logos/skills/deployment-executor/SKILL.md', 'skills/deployment-executor/SKILL.md'],
];
const VERIFY = 'logos/resources/verify';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const SELF_TEST = process.env.OPENLOGOS_MSPR_SMOKE_SELF_TEST === '1';
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

if (!SELF_TEST && (process.env.OPENLOGOS_MSPR_SMOKE_ENTRY !== undefined || process.env.OPENLOGOS_MSPR_SMOKE_BASELINE_ENTRY !== undefined)) {
  refuse('设置了 OPENLOGOS_MSPR_SMOKE_ENTRY / _BASELINE_ENTRY 但未声明自测（OPENLOGOS_MSPR_SMOKE_SELF_TEST=1）');
}
if (SELF_TEST && (!process.env.OPENLOGOS_MSPR_SMOKE_ENTRY || !process.env.OPENLOGOS_MSPR_SMOKE_BASELINE_ENTRY)) {
  refuse('自测模式需要 OPENLOGOS_MSPR_SMOKE_ENTRY 与 OPENLOGOS_MSPR_SMOKE_BASELINE_ENTRY');
}
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_MSPR_SMOKE !== '1') {
  exitNotApplicable(OWNED, {
    reason: `非本案安装态验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_MSPR_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_MSPR_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const scopes = [];
const tempDir = tag => { const d = mkdtempSync(join(tmpdir(), `openlogos-smoke-mspr-${tag}-`)); scopes.push(d); return d; };

function put(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV' || key === 'OPENLOGOS_SMOKE_MODULE' || key.startsWith('OPENLOGOS_MSPR_')) delete env[key];
    if (key === 'OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS' || key === 'OPENLOGOS_VERIFY_MODULES') delete env[key];
    if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CLAUDE_PROJECT_DIR'].includes(key)) delete env[key];
  }
  return { ...env, ...extra };
}
function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: cleanEnv() });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 300)}`);
  return r.stdout.trim();
}
/** 被测 CLI 调用；返回退出码与输出（不因非零退出抛错，由用例判定）。 */
function cli(entry, root, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd: root, encoding: 'utf8', env: cleanEnv({ OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home'), ...extraEnv }), timeout: 300_000, input: '',
  });
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}
function cliOk(entry, root, args, extraEnv = {}) {
  const r = cli(entry, root, args, extraEnv);
  if (r.status !== 0) throw new Error(`openlogos ${args.join(' ')} 失败：exit ${r.status} ${(r.stderr || r.stdout).slice(0, 400)}`);
  return r;
}
const json = text => { try { return JSON.parse(text); } catch { return null; } };
const errorCode = r => json(r.stderr)?.error?.code ?? null;
function snapshot(root, rel) {
  const out = {};
  const walk = (abs, key) => {
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const name of readdirSync(abs).sort()) walk(join(abs, name), key ? `${key}/${name}` : name);
    else out[key] = sha256(readFileSync(abs));
  };
  walk(join(root, rel), '');
  return JSON.stringify(out);
}
/** 只读 `## Summary` 表中首列为 label 的行的值（去掉 `**`）。 */
function summaryValue(file, label) {
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  const lines = readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex(l => /^##\s+Summary\s*$/.test(l.trim()));
  if (start === -1) return null;
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break;
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim().replace(/^\*\*(.*)\*\*$/, '$1'));
    if (cells[1] === label) return cells[2];
  }
  return null;
}

/** 记录型 verify runner：为全部用例写 pass；tools/vexit 存在时以其中的退出码结束。 */
const VERIFY_RUNNER = `
const fs = require('fs'); const path = require('path');
const out = 'logos/resources/verify/test-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
const ids = ['UT-S01-01', 'UT-S60-01'];
fs.appendFileSync(out, ids.map(id => JSON.stringify({ id, status: 'pass', timestamp: new Date().toISOString() })).join('\\n') + '\\n');
const code = fs.existsSync('tools/vexit') ? Number(fs.readFileSync('tools/vexit', 'utf8').trim()) : 0;
process.exit(code);
`;
/** 记录型 smoke runner：按用例写 pass，并标注本次环境。 */
const SMOKE_RUNNER = ids => `
const fs = require('fs'); const path = require('path');
const out = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';
fs.mkdirSync(path.dirname(out), { recursive: true });
const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;
const rows = ${JSON.stringify(ids)}.map(id => ({ id, status: 'pass', timestamp: new Date().toISOString(), ...(env ? { target_environment: env } : {}) }));
fs.writeFileSync(out, rows.map(r => JSON.stringify(r)).join('\\n') + '\\n');
`;
const REGISTRY = [
  'schema_version: 1',
  'environments:',
  '  - {id: test, name: Test, tier: test}',
  '  - id: team-prod',
  '    name: Team Production',
  '    tier: prod',
  '    deploy:',
  '      mode: script',
  '      script: scripts/deploy-team.sh',
  '      args: ["{env}", "{ref}"]',
  '',
].join('\n');
const PROPOSAL = module => [
  `# 变更提案：${module}-x`, '', `> module: ${module} | created: 2026-10-25`, '', '## 变更原因', '发布。', '', '## 变更类型', '代码级修复', '',
  '## 部署影响', '- 是否需要部署：是', '- 部署原因：发布', '- 影响环境：test',
  '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '发布。',
].join('\n');
const TASKS = ['# 实现任务', '', '## [code] 代码实现', '- [x] 改代码', '', '## [deploy] 部署任务', '- [ ] 发布'].join('\n');
const table = ids => `| ID | 描述 |\n|---|---|\n${ids.map(id => `| ${id} | case |`).join('\n')}\n`;
/** team 的 phase.3-0～3-5 产物（文件名带 team- 前缀；场景 S60）。 */
const TEAM_ARTIFACTS = [
  'logos/resources/prd/1-product-requirements/team-01-requirements.md',
  'logos/resources/prd/2-product-design/1-feature-specs/team-01-feature-specs.md',
  'logos/resources/prd/3-technical-plan/1-architecture/team-01-architecture.md',
  'logos/resources/prd/3-technical-plan/2-scenario-implementation/team-S60-x.md',
  'logos/resources/api/team-api.yaml',
  'logos/resources/database/team-schema.sql',
  'logos/resources/prd/3-technical-plan/3-deployment/team-01-deployment-plan.md',
  'logos/resources/scenario/team-x.json',
  'logos/resources/implementation/team-implementation-manifest.md',
];

/**
 * 经被测 CLI init 建立的一次性 git 项目。kind：multi（runlogos 形态：core launched、team initial 声明 [team-prod]，team 前序阶段齐全，
 * 并放入 core 历史留下的共用报告与 core-deployment-report.md）或 single（单模块 core initial，带登记表 test）。
 */
function makeProject(entry, kind) {
  const root = realpathSync(tempDir(kind));
  cliOk(entry, root, ['init', 'mspr', '--locale', 'zh', '--ai-tool', 'other']);
  const cfgPath = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { result_path: 'logos/resources/verify/test-results.jsonl', pre_run_command: 'node tools/vrec.cjs', sandbox_mode: 'off' };
  cfg.smoke = {
    command: 'node scripts/smoke-project.js', result_path: 'logos/resources/verify/smoke-results.jsonl', sandbox_mode: 'off',
    ...(kind === 'multi' ? { modules: { team: { command: 'node scripts/smoke-team.js' } } } : {}),
  };
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  if (kind === 'multi') {
    put(root, 'logos/logos-project.yaml', [
      'project:', '  name: "mspr"', 'modules:',
      '  - id: core', '    name: core', '    lifecycle: launched',
      '  - id: team', '    name: team', '    lifecycle: initial',
      'deployment_gates:', '  team:', '    environments: [team-prod]',
      'scenarios:', '  - id: S60', '    name: team', '    module: team', '',
    ].join('\n'));
    for (const rel of TEAM_ARTIFACTS) put(root, rel, 'x\n');
    put(root, 'logos/resources/test/core-S01-test-cases.md', table(['UT-S01-01']));
    put(root, 'logos/resources/test/team-S60-test-cases.md', table(['UT-S60-01']));
    put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', table(['SMOKE-core-01']));
    put(root, 'logos/resources/test/smoke/team-smoke-test-cases.md', table(['SMOKE-team-01']));
    const pass = (title, gate) => `# ${title}\n\n## Summary\n\n| Metric | Value |\n|--------|-------|\n| **${gate}** | **PASS** |\n`;
    put(root, `${VERIFY}/acceptance-report.md`, pass('Acceptance Report', 'Gate 3.5'));
    put(root, `${VERIFY}/smoke-report.md`, pass('Smoke Report', 'Gate 3.8'));
    put(root, `${VERIFY}/deployment-report.md`, '# Deployment Report\n\n## Deployment core 1.0.3\n\n- deploy_id: core-1\n');
    put(root, `${VERIFY}/core-deployment-report.md`, '# Deployment Report\n\n## Deployment core 1.0.3\n\n- deploy_id: core-1\n');
  } else {
    put(root, 'logos/logos-project.yaml', 'project:\n  name: "mspr"\nmodules:\n  - id: core\n    name: core\n    lifecycle: initial\n');
    put(root, 'logos/resources/test/core-S01-test-cases.md', table(['UT-S01-01', 'UT-S60-01']));
    put(root, 'logos/resources/test/smoke/core-smoke-test-cases.md', table(['SMOKE-core-01']));
    put(root, `${VERIFY}/deployment-report.md`, '# Deployment Report\n\nok\n');
  }
  put(root, 'logos/environments.yaml', REGISTRY);
  put(root, 'tools/vrec.cjs', VERIFY_RUNNER);
  put(root, 'scripts/smoke-project.js', SMOKE_RUNNER(kind === 'multi' ? ['SMOKE-core-01', 'SMOKE-team-01'] : ['SMOKE-core-01']));
  put(root, 'scripts/smoke-team.js', SMOKE_RUNNER(['SMOKE-team-01']));
  put(root, 'scripts/deploy-team.sh', '#!/bin/sh\nexit ${MSPR_DEPLOY_EXIT:-0}\n');
  chmodSync(join(root, 'scripts/deploy-team.sh'), 0o755);
  put(root, '.gitignore', 'logos/.openlogos-runtime/\n');
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'openlogos-smoke']);
  git(root, ['config', 'user.email', 'openlogos-smoke@example.invalid']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return root;
}
/** 以被测 CLI `change` 创建归属 module 的提案，并补齐部署前置。返回提案相对路径。 */
function proposal(entry, root, module) {
  const slug = `${module}-x`;
  cliOk(entry, root, ['change', slug, '--module', module]);
  const rel = `logos/changes/${slug}`;
  put(root, `${rel}/proposal.md`, PROPOSAL(module));
  put(root, `${rel}/tasks.md`, TASKS);
  put(root, `${rel}/VERIFY_PASS`, '');
  put(root, `${rel}/LOOP_ITERS`, `${JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module, timestamp: '2026-10-25T00:00:00.000Z' })}\n`);
  return rel;
}
const teamStatus = (entry, root) => (json(cliOk(entry, root, ['status', '--format', 'json']).stdout)?.data?.modules ?? []).find(m => m.id === 'team') ?? {};
function deployTeam(entry, root, extraEnv = {}) {
  const head = git(root, ['rev-parse', 'HEAD']);
  return cli(entry, root, ['deploy', '--env', 'team-prod', '--ref', head, '--format', 'json'], extraEnv);
}
function moduleReportsIn(root) {
  const dir = join(root, VERIFY);
  return existsSync(dir) ? readdirSync(dir).filter(n => /^.+-(acceptance|deployment|smoke)-report\.md$/.test(n)) : [];
}
/** 剔除易变字段：项目根、时间戳、UUID、40 / 64 位哈希、耗时、CLI 版本号。 */
function normalize(text, root) {
  return text.split(root).join('<ROOT>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<TS>')
    .replace(/\d{4}-\d{2}-\d{2}/g, '<DATE>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<UUID>')
    .replace(/\b[0-9a-f]{64}\b/g, '<HASH>')
    .replace(/\b[0-9a-f]{40}\b/g, '<SHA>')
    .replace(/"(duration_ms|elapsed_ms)":\s*\d+/g, '"$1":0')
    .replace(/"version":\s*"\d+\.\d+\.\d+"/g, '"version":"<V>"')
    .replace(/v\d+\.\d+\.\d+/g, 'v<V>');
}

const CASES = {
  'SMOKE-core-298': async (entry) => {
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
    if (!read('spec/flow-spec.md').includes('多模块 initial 模块的阶段报告')) problems.push('③ 包内 spec/flow-spec.md §9 缺少多模块 initial 模块报告阶段的解析规则');
    if (!read('spec/environments.md').includes('### 14.9')) problems.push('③ 包内 spec/environments.md 缺少 §14.9');
    if (!read('dist/lib/module-phase-report.js').includes('isModuleReportComplete')) problems.push('③ 包内 dist 缺少模块报告判定实现');
    if (!SELF_TEST) {
      for (const [repoRel, pkgRel] of REPO_SYNCED_FILES) {
        const a = existsSync(join(repoRoot, repoRel)) ? sha256(readFileSync(join(repoRoot, repoRel))) : null;
        const b = existsSync(join(pkg, pkgRel)) ? sha256(readFileSync(join(pkg, pkgRel))) : null;
        evidence.push(`${repoRel}=${a}`, `package:${pkgRel}=${b}`);
        if (!a || !b || a !== b) problems.push(`④ 本仓 ${repoRel} 与全局包内 ${pkgRel} 字节不一致（需重新执行本仓 openlogos sync 后复核）`);
      }
    }
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: `安装态身份同源（${version}）：manifest 自洽，包内含模块报告解析规则、§14.9 与判定实现${SELF_TEST ? '' : '，本仓 sync 副本同字节'}`, evidence };
  },

  'SMOKE-core-299': async (entry) => {
    const root = makeProject(entry, 'multi');
    const evidence = [`project=${root}`];
    const problems = [];
    const s1 = teamStatus(entry, root);
    evidence.push(`① current_phase=${s1.current_phase}`);
    if (s1.current_phase !== 'phase.3-6') problems.push(`① 共用报告不应让 team 离开 3-6，实际 ${s1.current_phase}`);
    const v = cli(entry, root, ['verify', '--all', '--format', 'json']);
    const teamReport = join(root, VERIFY, 'team-acceptance-report.md');
    evidence.push(`② verify exit=${v.status} module=${summaryValue(teamReport, 'Module')} gate=${summaryValue(teamReport, 'Gate 3.5')}`);
    if (summaryValue(teamReport, 'Module') !== 'team' || summaryValue(teamReport, 'Gate 3.5') !== 'PASS') problems.push('② 应写出「模块」行为 team、Gate PASS 的 team-acceptance-report.md');
    if (existsSync(join(root, VERIFY, 'core-acceptance-report.md'))) problems.push('② 不应为 launched 模块 core 写模块验收报告');
    const s3 = teamStatus(entry, root);
    evidence.push(`③ current_phase=${s3.current_phase}`);
    if (s3.current_phase !== 'phase.3-7-deploy') problems.push(`③ team 应进入 phase.3-7（共用与 core 的部署报告不让它越过 3-7），实际 ${s3.current_phase}`);
    put(root, 'tools/vexit', '1');
    cli(entry, root, ['verify', '--all', '--format', 'json']);
    const s4 = teamStatus(entry, root);
    evidence.push(`④ gate=${summaryValue(teamReport, 'Gate 3.5')} current_phase=${s4.current_phase}`);
    if (summaryValue(teamReport, 'Gate 3.5') !== 'FAIL') problems.push('④ 预跑非零退出后 team-acceptance-report.md 应改判 FAIL');
    if (s4.current_phase !== 'phase.3-6') problems.push(`④ team 应回到 phase.3-6，实际 ${s4.current_phase}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: 'team 凭本模块验收报告离开 3-6，共用报告不计入；预跑失败时模块报告改判 FAIL、回到 3-6', evidence };
  },

  'SMOKE-core-300': async (entry) => {
    const root = makeProject(entry, 'multi');
    const evidence = [`project=${root}`];
    const problems = [];
    cliOk(entry, root, ['verify', '--all', '--format', 'json']);
    const rel = proposal(entry, root, 'core');
    const proposalBefore = snapshot(root, rel);
    const sharedBefore = sha256(readFileSync(join(root, VERIFY, 'deployment-report.md')));
    const teamReport = join(root, VERIFY, 'team-deployment-report.md');
    const failed = deployTeam(entry, root, { MSPR_DEPLOY_EXIT: '1' });
    evidence.push(`① exit=${failed.status} code=${errorCode(failed)}`);
    if (errorCode(failed) !== 'DEPLOY_FAILED') problems.push(`① 脚本失败应报 DEPLOY_FAILED，实际 ${errorCode(failed)}`);
    if (existsSync(teamReport)) problems.push('① 部署失败不应写 team-deployment-report.md');
    const ok = deployTeam(entry, root);
    const d = json(ok.stdout)?.data;
    evidence.push(`② exit=${ok.status} channel=${d?.channel}`);
    if (ok.status !== 0 || d?.channel !== 'version') problems.push(`② 版本通道部署应成功，实际 exit ${ok.status} channel ${d?.channel}`);
    if (!existsSync(teamReport) || !readFileSync(teamReport, 'utf8').includes(`deploy_id: ${d?.deploy_id}`)) problems.push('② 应写出含本次 deploy_id 的 team-deployment-report.md');
    const s3 = teamStatus(entry, root);
    evidence.push(`③ current_phase=${s3.current_phase}`);
    if (s3.current_phase !== 'phase.3-8-smoke') problems.push(`③ team 应进入 phase.3-8，实际 ${s3.current_phase}`);
    if (snapshot(root, rel) !== proposalBefore) problems.push('④ core 提案目录字节有变化');
    if (sha256(readFileSync(join(root, VERIFY, 'deployment-report.md'))) !== sharedBefore) problems.push('④ 共用 deployment-report.md 不应被版本通道改写');
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '部署失败不写模块部署报告；版本通道成功写并推进到 3-8；core 提案目录与共用部署报告字节不变', evidence };
  },

  'SMOKE-core-301': async (entry) => {
    const evidence = [];
    const problems = [];
    // ① 只有共用报告时 launch 拒绝
    const sharedOnly = makeProject(entry, 'multi');
    const yamlBefore = sha256(readFileSync(join(sharedOnly, 'logos/logos-project.yaml')));
    const rejected = cli(entry, sharedOnly, ['launch', 'team']);
    evidence.push(`① exit=${rejected.status}`);
    if (rejected.status !== 1 || !rejected.stderr.includes('team-acceptance-report.md')) problems.push('① 只有共用报告时 launch 应拒绝并点名 team-acceptance-report.md');
    if (sha256(readFileSync(join(sharedOnly, 'logos/logos-project.yaml'))) !== yamlBefore) problems.push('① 拒绝时 logos-project.yaml 不应变化');
    // ②～④ 模块验收、部署报告就绪后 smoke 并 launch
    const root = makeProject(entry, 'multi');
    cliOk(entry, root, ['verify', '--all', '--format', 'json']);
    const dep = deployTeam(entry, root);
    if (dep.status !== 0) throw new Error(`team-prod 部署失败：${errorCode(dep) ?? dep.stderr.slice(0, 200)}`);
    const sm = cli(entry, root, ['smoke', '--env', 'team-prod', '--format', 'json']);
    const smokeReport = join(root, VERIFY, 'team-smoke-report.md');
    evidence.push(`② exit=${sm.status} module=${summaryValue(smokeReport, 'Module')} gate=${summaryValue(smokeReport, 'Gate 3.8')}`);
    if (sm.status !== 0 || summaryValue(smokeReport, 'Module') !== 'team' || summaryValue(smokeReport, 'Gate 3.8') !== 'PASS') problems.push('② 应写出 Gate PASS 的 team-smoke-report.md');
    const s3 = teamStatus(entry, root);
    const allDone = Object.values(s3.phase_progress ?? {}).every(p => p.done || p.skipped);
    evidence.push(`③ current_phase=${s3.current_phase} all_done=${allDone}`);
    if (s3.current_phase !== null || !allDone) problems.push('③ team 全部阶段应 done 或 skipped');
    const launched = cli(entry, root, ['launch', 'team']);
    const lifecycle = /- id: team\n\s+name: team\n\s+lifecycle: (\w+)/.exec(readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8'))?.[1];
    evidence.push(`④ exit=${launched.status} lifecycle=${lifecycle}`);
    if (launched.status !== 0 || lifecycle !== 'launched') problems.push(`④ launch team 应成功并切为 launched，实际 exit ${launched.status} lifecycle ${lifecycle}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '只有共用报告时 launch 拒绝；team smoke PASS 后写模块冒烟报告、全部阶段完成并可 launch', evidence };
  },

  'SMOKE-core-302': async (entry, { baselineEntry, baselineEvidence = [] }) => {
    const evidence = [`baseline=${baselineEntry}`, ...baselineEvidence];
    const problems = [];
    const observed = {};
    for (const [label, bin] of [['candidate', entry], ['baseline', baselineEntry]]) {
      const root = makeProject(bin, 'single');
      const v = cli(bin, root, ['verify', '--format', 'json']);
      proposal(bin, root, 'core');
      const dd = cli(bin, root, ['deploy-done', '--env', 'test', '--format', 'json']);
      const sm = cli(bin, root, ['smoke', '--env', 'test', '--format', 'json']);
      const st = cli(bin, root, ['status', '--format', 'json']);
      observed[label] = {
        out: JSON.stringify([v, dd, sm, st].map(r => [r.status, normalize(r.stdout, root), normalize(r.stderr, root)])),
        reports: moduleReportsIn(root),
      };
    }
    evidence.push(`candidate_reports=${JSON.stringify(observed.candidate.reports)}`);
    if (observed.candidate.out !== observed.baseline.out) problems.push('①～③ 单模块项目 verify / deploy-done / smoke / status 与基线不一致');
    if (observed.candidate.reports.length > 0) problems.push(`④ 单模块项目不应产生模块报告：${observed.candidate.reports.join(', ')}`);
    if (problems.length > 0) throw Object.assign(new Error(problems.join('；')), { evidence });
    return { detail: '单模块项目 verify / deploy-done / smoke / status 与基线一致，且只有共用报告', evidence };
  },
};

export const MODULE_PHASE_REPORT_IDS = Object.keys(CASES);

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of MODULE_PHASE_REPORT_IDS) {
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

/** 正式模式的比较基线：local-release-candidate.ts 的回滚版本常量（升版前版本 0.16.11），在本机留存制品中按包内版本选取。 */
function installBaseline() {
  const baselineVersion = rollbackVersionConst(repoRoot);
  const artifact = selectBaselineArtifact(repoRoot, baselineVersion);
  if (artifact.gap) return artifact;
  const prefix = tempDir('baseline');
  const inst = run(npmBin, ['install', '-g', '--prefix', prefix, artifact.path]);
  if (inst.status !== 0) throw new Error(`安装基线制品失败：${(inst.stderr || '').slice(0, 300)}`);
  const entry = join(prefix, 'lib', 'node_modules', '@miniidealab', 'openlogos', 'dist', 'index.js');
  const version = (run(process.execPath, [entry, '--version']).stdout || '').trim();
  if (version !== baselineVersion) throw new Error(`基线制品 ${artifact.path} 安装后版本 ${version} 不等于基线版本 ${baselineVersion}`);
  return { entry, version, artifact };
}

let exitCode = 0;
try {
  let entry = null;
  let baselineEntry = null;
  let baselineEvidence = [];
  if (SELF_TEST) {
    entry = realpathSync(resolve(process.env.OPENLOGOS_MSPR_SMOKE_ENTRY));
    baselineEntry = realpathSync(resolve(process.env.OPENLOGOS_MSPR_SMOKE_BASELINE_ENTRY));
  } else {
    const skip = (reason, missing) => exitNotApplicable(OWNED, { reason, missing, environment: ENVIRONMENT, repoRoot });
    const version = candidateVersion();
    if (!versionAtLeast(version, MIN_VERSION)) skip(`候选版本 ${version ?? '(未知)'} 早于 ${MIN_VERSION}，本提案的候选制品尚未产出（部署窗口外不适用）`, ['candidate-version']);
    const record = existsSync(join(repoRoot, DEPLOYMENT_RECORD)) ? readFileSync(join(repoRoot, DEPLOYMENT_RECORD), 'utf8') : '';
    if (!record.includes(version)) skip(`部署记录 ${DEPLOYMENT_RECORD} 未记载候选版本 ${version}`, ['deployment-record']);
    if (!existsSync(join(repoRoot, REPO_SYNCED_FILES[0][0]))) skip(`本仓未执行 openlogos sync（缺少托管副本 ${REPO_SYNCED_FILES[0][0]}）`, ['repo-sync']);
    const baseline = installBaseline();
    if (baseline.gap) skip(baseline.gap, baseline.missing);
    baselineEntry = baseline.entry;
    baselineEvidence = [`baseline_version=${baseline.version}`, `baseline_artifact=${baseline.artifact.path}`, `baseline_sha256=${baseline.artifact.sha256}`];
    entry = globalEntry();
    const problem = !entry ? '找不到 openlogos 入口' : globalInstallProblem(entry);
    if (problem) {
      for (const id of OWNED) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
      entry = null;
    }
  }
  if (entry) {
    for (const id of MODULE_PHASE_REPORT_IDS) {
      const started = Date.now();
      try {
        const { detail, evidence } = await CASES[id](entry, { baselineEntry, baselineEvidence });
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

const failed = MODULE_PHASE_REPORT_IDS.filter(id => results.get(id)?.status !== 'pass');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${MODULE_PHASE_REPORT_IDS.join(', ')}`);
}
process.exit(exitCode);
