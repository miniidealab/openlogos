#!/usr/bin/env node
/**
 * SMOKE-core-226～SMOKE-core-230 — 0.15.20 行为的**安装态**取证（verify-smoke-guard-fixes-0-15-20）。
 * 用例按切片逐个补入下方 CASES 表：本 runner 认领的 ID 集合 = CASES 的键，覆盖预检据此发现缺口，
 * 不存在「声明了却没实现」的 ID。当前已实现：
 *   - SMOKE-core-227：安装态 verify 预跑失败判 `pre_run_failed`（功能规格 §2.7、§2.75.1）。
 *   - SMOKE-core-228：安装态 smoke 平台不可执行例外（功能规格 §2.48.5）。
 *   - SMOKE-core-229：安装态 guard 非 git 回落逐段判定（根规范 spec/pretooluse-guard.md）。
 *   - SMOKE-core-230：安装态 merge 增量修正（merged → already-merged → amended）与修正被拒文案（功能规格 §2.69.4、§2.84.3）。
 *   - SMOKE-core-226：安装态版本与制品身份（版本取 cli/src/lib/local-release-candidate.ts，不写死字面量；包内含四项行为）。
 *
 * 执行边界：全部读写只在 `mktemp -d` 的一次性项目内，结束即删除；只读本机全局安装态（不安装 / 卸载），
 * 不触碰本仓活跃提案、本仓 logos/resources/ 与用户其他仓库（包括 runlogos）；命令图中不出现任何公网发布命令。
 * 判据用行为断言（`--format json` 结构化字段与退出码），版本号相等只证明装了新包、不证明行为生效。
 *
 * 判据分两档（沿既有 runner 形态）：
 * - **本案安装验收窗口**（活跃提案为本 slug，或 OPENLOGOS_VSG_SMOKE=1）：全局入口缺失、入口不在全局包目录内
 *   或行为不符，一律写 **fail** 并非零退出。
 * - **窗口之外**：本 runner 不适用，按既有留痕机制为全部 owned ID 写 skip。
 *
 * **正式安装态模式**（缺省）：只认 PATH 中 `openlogos` 且 realpath 位于 `npm prefix -g` 的全局包目录内。
 * **自测模式**（仅供 runner 自身验证，须同时满足）：OPENLOGOS_VSG_SMOKE_SELF_TEST=1、OPENLOGOS_VSG_SMOKE_ENTRY
 * 注入入口、OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本；结果以 environment=self-test-injected-entry 写入。
 */
import { spawnSync } from 'node:child_process';
import {
  appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exitNotApplicable } from './lib/smoke-not-applicable.mjs';

const SLUG = 'verify-smoke-guard-fixes-0-15-20';
const FORMAL_ENVIRONMENT = 'local-global-temp-project';
const SELF_TEST_ENVIRONMENT = 'self-test-injected-entry';
const SENTINEL = 'SENTINEL-VSG-0-15-20';

const repoRoot = process.cwd();
const resultPath = resolve(repoRoot, process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl');
const INJECTED_ENTRY = process.env.OPENLOGOS_VSG_SMOKE_ENTRY;
const SELF_TEST = process.env.OPENLOGOS_VSG_SMOKE_SELF_TEST === '1';
const ENVIRONMENT = SELF_TEST ? SELF_TEST_ENVIRONMENT : FORMAL_ENVIRONMENT;

const run = (cmd, args, cwd = repoRoot) =>
  spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: process.env });
const cliBin = entry => (entry.endsWith('.js') ? process.execPath : entry);
const cliArgs = (entry, args) => (entry.endsWith('.js') ? [entry, ...args] : args);
/**
 * 在一次性项目里调用 CLI 时剥离外层 smoke 的账本与本 runner 的控制变量：否则夹具项目的 smoke runner 会把记录
 * 写进外层账本（`openlogos smoke` 以 OPENLOGOS_SMOKE_RESULT_PATH 启动本 runner），污染正式证据。
 */
function isolatedEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key.startsWith('OPENLOGOS_VSG_')) delete env[key];
  }
  return env;
}
const cliRaw = (entry, cwd, args) =>
  spawnSync(cliBin(entry), cliArgs(entry, args), { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024, env: isolatedEnv() });

const scopes = [];
function newTempDir(tag) {
  const dir = mkdtempSync(join(tmpdir(), `openlogos-smoke-vsg-${tag}-`));
  scopes.push(dir);
  return dir;
}

function put(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

/** 一次性项目：经全局入口 init，再声明两条 UT 用例。 */
function initProject(entry, tag) {
  const dir = newTempDir(tag);
  const init = cliRaw(entry, dir, ['init', '--locale', 'en', '--ai-tool', 'claude-code']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${(init.stderr || '').slice(0, 300)}`);
  put(dir, 'logos/resources/test/core-S01-test-cases.md',
    '# S01\n\n| ID | 描述 |\n|---|---|\n| UT-S01-01 | a |\n| UT-S01-02 | b |\n');
  return dir;
}

function setVerify(dir, verify) {
  const path = join(dir, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  cfg.verify = { ...(cfg.verify || {}), result_path: 'logos/resources/verify/test-results.jsonl', ...verify };
  writeFileSync(path, JSON.stringify(cfg, null, 2));
}

const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

/** 安装包根：入口向上找同时含 package.json 与 asset-manifest.json 的目录。 */
function packageRoot(entry) {
  let dir = dirname(entry);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'asset-manifest.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

const PASS_LEDGER = ['UT-S01-01', 'UT-S01-02']
  .map(id => JSON.stringify({ id, status: 'pass', timestamp: '2026-10-09T00:00:00.000Z' })).join('\n') + '\n';

/**
 * 每个用例：(entry) => { detail, evidence }，失败抛错。后续切片按同一形态补入 SMOKE-core-226 / 228～230。
 */
const CASES = {
  'SMOKE-core-227': (entry) => {
    const dir = initProject(entry, 'verify');
    const result = 'logos/resources/verify/test-results.jsonl';
    put(dir, 'tools/backup.jsonl', PASS_LEDGER);
    put(dir, 'tools/rollback-runner.js', [
      "const fs = require('fs');",
      `console.error('${SENTINEL} runner crashed');`,
      `fs.mkdirSync('logos/resources/verify', { recursive: true });`,
      `fs.writeFileSync('${result}', '{"id":"UT-S01-01","status":"pass"}\\n');`,
      `fs.writeFileSync('${result}', fs.readFileSync('tools/backup.jsonl'));`,
      'process.exit(1);',
    ].join('\n'));
    put(dir, 'tools/ok-runner.js', [
      "const fs = require('fs');",
      `fs.mkdirSync('logos/resources/verify', { recursive: true });`,
      `fs.writeFileSync('${result}', fs.readFileSync('tools/backup.jsonl'));`,
    ].join('\n'));
    const problems = [];
    // ① 回滚型运行器失败：旧完好账本全部通过，修改前直接 PASS
    setVerify(dir, { pre_run_command: 'node tools/rollback-runner.js' });
    const first = cliRaw(entry, dir, ['verify', '--format', 'json']);
    let d1 = null;
    try { d1 = JSON.parse(first.stdout).data; } catch { problems.push(`① 输出不是 JSON：${(first.stdout || '').slice(0, 200)}`); }
    if (d1) {
      if (first.status === 0) problems.push('① 退出码应非零');
      if (d1.gate?.result !== 'FAIL' || d1.gate?.reason !== 'pre_run_failed') {
        problems.push(`① gate 应为 FAIL/pre_run_failed，实际 ${JSON.stringify(d1.gate)}`);
      }
      if (!String(d1.pre_run?.commands?.[0]?.stderr_tail ?? '').includes(SENTINEL)) problems.push('① stderr_tail 不含哨兵');
    }
    // ② 报告不落命令输出
    const reportPath = join(dir, 'logos/resources/verify/acceptance-report.md');
    if (existsSync(reportPath) && readFileSync(reportPath, 'utf8').includes(SENTINEL)) problems.push('② acceptance-report.md 含命令输出');
    // ③ 运行器正常退出后 PASS
    setVerify(dir, { pre_run_command: 'node tools/ok-runner.js' });
    const third = cliRaw(entry, dir, ['verify', '--format', 'json']);
    let d3 = null;
    try { d3 = JSON.parse(third.stdout).data; } catch { problems.push('③ 输出不是 JSON'); }
    if (d3 && d3.gate?.result !== 'PASS') problems.push(`③ 应为 PASS，实际 ${JSON.stringify(d3.gate)}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: '安装态 verify：回滚型运行器失败时 gate=FAIL/pre_run_failed 且 stderr_tail 含哨兵，报告不落输出；运行器正常后 PASS',
      evidence: [`project=${dir}`, `first_exit=${first.status}`, `third_exit=${third.status}`],
    };
  },
  'SMOKE-core-228': (entry) => {
    const dir = initProject(entry, 'smoke');
    const slug = 'smoke-platform-fixture';
    const changed = 'SMOKE-core-902';
    // 已合并 smoke 规格含本提案新增用例；提案 deltas 声明其为新增（即 changed_cases）。
    put(dir, 'logos/resources/test/smoke/core-smoke-test-cases.md', `| ID | 描述 |\n|---|---|\n| ${changed} | 夹具 |\n`);
    put(dir, `logos/changes/${slug}/deltas/test/smoke/core-smoke-test-cases.md`,
      `## ADDED — 夹具 smoke\n\n| ID | 描述 |\n|---|---|\n| ${changed} | 夹具 |\n`);
    put(dir, 'logos/.openlogos-guard', JSON.stringify({ activeChange: slug, module: 'core' }));
    put(dir, `logos/changes/${slug}/proposal.md`, [
      '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：本地',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
    ].join('\n'));
    put(dir, `logos/changes/${slug}/tasks.md`, '# 实现任务\n\n## [deploy] 发布\n- [x] 本机全局安装\n');
    put(dir, `logos/changes/${slug}/VERIFY_PASS`, '');
    put(dir, `logos/changes/${slug}/DEPLOY_DONE`, '');
    const writeRunner = (withReason) => put(dir, 'scripts/smoke-fixture.mjs', [
      "import { appendFileSync, mkdirSync } from 'node:fs';",
      "import { dirname } from 'node:path';",
      "const p = process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl';",
      'mkdirSync(dirname(p), { recursive: true });',
      `appendFileSync(p, JSON.stringify({ id: '${changed}', status: 'skip', detail: 'requires win32'${withReason ? ", reason_code: 'platform-unavailable'" : ''}, timestamp: new Date().toISOString() }) + '\\n');`,
    ].join('\n'));
    const cfgPath = join(dir, 'logos/logos.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.smoke = { ...(cfg.smoke || {}), result_path: 'logos/resources/verify/smoke-results.jsonl', command: 'node scripts/smoke-fixture.mjs', sandbox_mode: 'off' };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const ledgerPath = join(dir, 'logos/resources/verify/smoke-results.jsonl');
    const smokeJson = () => {
      if (existsSync(ledgerPath)) writeFileSync(ledgerPath, '');
      const r = cliRaw(entry, dir, ['smoke', '--format', 'json']);
      try { return { status: r.status, data: JSON.parse(r.stdout).data }; } catch { return { status: r.status, data: null, raw: r.stdout }; }
    };
    const problems = [];
    // ① 平台不可执行声明完整 → PASS 且单独列出
    writeRunner(true);
    const first = smokeJson();
    if (!first.data || first.data.gate?.result !== 'PASS') problems.push(`① 应为 PASS，实际 ${JSON.stringify(first.data?.gate ?? first.raw)}`);
    else if (!(first.data.platform_skipped_cases || []).some(c => c.id === changed)) problems.push('① platform_skipped_cases 未列出该用例');
    // ② 缺 reason_code → FAIL required_cases_skipped
    writeRunner(false);
    const second = smokeJson();
    if (!second.data || second.data.gate?.reason !== 'required_cases_skipped') problems.push(`② 应为 required_cases_skipped，实际 ${JSON.stringify(second.data?.gate ?? second.raw)}`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: '安装态 smoke：本提案用例以 platform-unavailable + 非空 detail skip 时 PASS 并列入 platform_skipped_cases；缺原因码时 FAIL required_cases_skipped',
      evidence: [`project=${dir}`, `first_exit=${first.status}`, `second_exit=${second.status}`],
    };
  },
  'SMOKE-core-229': (entry) => {
    const dir = initProject(entry, 'guard');
    const yamlPath = join(dir, 'logos/logos-project.yaml');
    writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*initial/g, 'lifecycle: launched'));
    const sync = cliRaw(entry, dir, ['sync']);
    if (sync.status !== 0) throw new Error(`openlogos sync 失败：exit ${sync.status}`);
    const guard = join(dir, '.claude/openlogos/bin/guard-check');
    if (!existsSync(guard)) throw new Error('sync 后缺少托管 guard-check');
    const probe = run('git', ['rev-parse', '--is-inside-work-tree'], dir);
    if (probe.status === 0 && probe.stdout.trim() === 'true') throw new Error('临时项目意外位于 git 工作树内，无法验证非 git 回落');
    put(dir, 'src/a.ts', 'a\n');
    put(dir, 'src/x', 'x\n');
    const before = fileSha(join(dir, 'src/a.ts'));
    const env = { ...process.env, CLAUDE_PROJECT_DIR: dir };
    delete env.GIT_DIR; delete env.GIT_WORK_TREE;
    const verdict = command => spawnSync('bash', [guard], {
      cwd: dir, encoding: 'utf8', timeout: 60_000, env,
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, permission_mode: 'default' }),
    }).status;
    const problems = [];
    for (const c of ['ls && rm -rf src', 'true; rm src/x', 'cd src && rm ../src/a.ts', 'cd "$D" && rm a.ts', 'cd /dev/null && true; rm src/a.ts',
      // code review r1 F1：命中白名单前缀的重定向写入、不确定目录后的重定向写入
      'ls && echo 内容 > src/a.ts', 'cd "$D" && echo 内容 > src/a.ts',
      // code review r2 F1：目录切换段自身的重定向
      'cd src > src/a.ts && pwd', 'cd "$D" > src/a.ts && pwd']) {
      const code = verdict(c);
      if (code !== 2) problems.push(`应阻断（exit 2）：${c}，实际 exit ${code}`);
    }
    for (const c of ['ls && cat src/x', 'cd src && cat a.ts', "echo '$(rm src/a.ts)'", 'ls 2>/dev/null && cat src/x', 'cd src >/dev/null && cat a.ts']) {
      const code = verdict(c);
      if (code !== 0) problems.push(`应放行（exit 0）：${c}，实际 exit ${code}`);
    }
    if (fileSha(join(dir, 'src/a.ts')) !== before) problems.push('src/a.ts 字节被改动');
    // 托管副本与安装包随包 guard 模板逐字节一致（自测模式下以仓内分发源为准）
    const pkg = packageRoot(entry);
    const template = pkg && existsSync(join(pkg, 'claude-plugin-template/bin/guard-check'))
      ? join(pkg, 'claude-plugin-template/bin/guard-check')
      : (SELF_TEST ? join(repoRoot, 'plugin/bin/guard-check') : null);
    if (!template) problems.push('安装包内找不到随包 guard 模板 claude-plugin-template/bin/guard-check');
    else if (fileSha(template) !== fileSha(guard)) problems.push(`托管 guard-check 与随包模板 ${template} SHA-256 不一致`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: '安装态 guard：非 git 项目中复合写入（含 cd 后相对写入与条件链被结束后的写入）阻断，只读复合命令放行；托管副本与随包模板一致',
      evidence: [`project=${dir}`, `guard_sha256=${fileSha(guard)}`, `template=${template}`],
    };
  },
  'SMOKE-core-230': (entry) => {
    const dir = initProject(entry, 'merge');
    const slug = 'smoke-merge-amend';
    const yamlPath = join(dir, 'logos/logos-project.yaml');
    writeFileSync(yamlPath, readFileSync(yamlPath, 'utf8').replace(/lifecycle:\s*initial/g, 'lifecycle: launched'));
    const target = 'logos/resources/test/core-S01-test-cases.md';
    put(dir, target, '# 文档\n\n## 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | 旧定义 |\n');
    const writeDelta = text => put(dir, `logos/changes/${slug}/deltas/test/core-S01-test-cases.md`,
      `## MODIFIED — 一、判据\n\n| 用例ID | 验证目标 |\n|---|---|\n| UT-S01-01 | ${text} |\n`);
    const created = cliRaw(entry, dir, ['change', slug]);
    if (created.status !== 0) throw new Error(`openlogos change ${slug} 失败：${(created.stderr || created.stdout || '').slice(0, 300)}`);
    writeDelta('新定义');
    put(dir, `logos/changes/${slug}/proposal.md`, [
      '# 变更提案：smoke merge amend', '', '## 变更原因', '真实原因。', '', '## 变更类型', '需求级', '',
      '## 变更范围', '- 影响的测试规格：夹具', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：无', '- 影响环境：无',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '概述。', '',
      '## 决策澄清', '', '```yaml', 'schema: openlogos/clarification@1', 'mode: adaptive', 'status: complete', 'impacts:',
      '  data: {status: none, reason: fixture}', '  compatibility: {status: none, reason: fixture}',
      '  security_privacy: {status: none, reason: fixture}', '  public_release: {status: none, reason: fixture}',
      '  external_commitment: {status: none, reason: fixture}', 'decisions: []', 'unresolved: []', 'defaults: []', '```', '',
    ].join('\n'));
    put(dir, `logos/changes/${slug}/tasks.md`,
      '# 任务\n\n## [delta] 规格变更\n- [x] [MODIFY] `deltas/test/core-S01-test-cases.md`：夹具\n\n## [code] 代码实现\n');
    put(dir, `logos/changes/${slug}/PLAN_APPROVED`, '{}');
    const gitRun = args => run('git', args, dir);
    for (const args of [['init', '-q'], ['config', 'user.email', 'smoke@example.invalid'], ['config', 'user.name', 'smoke'],
      ['config', 'commit.gpgsign', 'false'], ['add', '-A'], ['commit', '-qm', 'init']]) {
      const r = gitRun(args);
      if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${(r.stderr || '').slice(0, 200)}`);
    }
    const mergeJson = () => {
      const r = cliRaw(entry, dir, ['merge', slug, '--format', 'json']);
      let data = null; let error = null;
      if (r.status === 0) { try { data = JSON.parse(r.stdout).data; } catch { /* 下方报错 */ } }
      else { try { error = JSON.parse((r.stderr || '').trim().split('\n').pop() || '').error; } catch { /* 下方报错 */ } }
      return { status: r.status, data, error, stderr: r.stderr || '' };
    };
    const problems = [];
    const first = mergeJson();
    if (first.data?.result !== 'merged') problems.push(`① 应为 merged，实际 ${JSON.stringify(first.data ?? first.error)}`);
    gitRun(['add', '-A']); gitRun(['commit', '-qm', 'merge']);
    const second = mergeJson();
    if (second.data?.result !== 'already-merged') problems.push(`② 应为 already-merged，实际 ${JSON.stringify(second.data ?? second.error)}`);
    writeDelta('修正后的定义');
    const st = cliRaw(entry, dir, ['status', '--format', 'json']);
    let pending = null;
    try { pending = JSON.parse(st.stdout).data.modules[0].active_change.spec_amend?.pending ?? null; } catch { pending = null; }
    if (pending !== true) problems.push(`③ status spec_amend.pending 应为 true，实际 ${JSON.stringify(pending)}`);
    const third = mergeJson();
    if (third.data?.result !== 'amended') problems.push(`③ 应为 amended，实际 ${JSON.stringify(third.data ?? third.error)}`);
    gitRun(['add', '-A']); gitRun(['commit', '-qm', 'amend']);
    writeDelta('第三版定义');
    writeFileSync(join(dir, target), `${readFileSync(join(dir, target), 'utf8')}手工改动。\n`);
    const fourth = mergeJson();
    if (fourth.status === 0 || fourth.error?.code !== 'MERGE_AMEND_DRIFT') problems.push(`④ 应以 MERGE_AMEND_DRIFT 拒绝，实际 ${JSON.stringify(fourth.error ?? fourth.data)}`);
    if (!fourth.stderr.includes('未进入修正写入')) problems.push('④ stderr 缺少修正路径档 A 文案「未进入修正写入」');
    for (const [label, text] of [['stderr', fourth.stderr], ['JSON message', fourth.error?.message ?? '']]) {
      if (text.includes('git checkout logos/resources/')) problems.push(`④ ${label} 含 git checkout logos/resources/ 回滚建议`);
    }
    const specMerged = join(dir, `logos/changes/${slug}/SPEC_MERGED`);
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: '安装态 merge：merged → already-merged → amended（status spec_amend.pending 先为 true）；漂移被拒为档 A 修正文案且 stderr 与 JSON 均无 git checkout 建议',
      evidence: [
        `project=${dir}`, `codes=${[first.status, second.status, third.status, fourth.status].join(',')}`,
        `results=${[first.data?.result, second.data?.result, third.data?.result, fourth.error?.code].join(',')}`,
        `spec_merged_sha256=${existsSync(specMerged) ? fileSha(specMerged) : 'missing'}`,
      ],
    };
  },
  'SMOKE-core-226': async (entry) => {
    const problems = [];
    const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
    const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
    const candidate = /LOCAL_RELEASE_CANDIDATE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null;
    if (!candidate) throw new Error(`无法读取候选版本（${src} 缺失或无 LOCAL_RELEASE_CANDIDATE_VERSION）`);
    const version = (cliRaw(entry, repoRoot, ['--version']).stdout || '').trim();
    if (version !== candidate) problems.push(`--version 为 ${version}，部署记录候选版本为 ${candidate}`);
    const pkg = packageRoot(entry);
    if (!pkg) throw new Error(`无法从 ${entry} 定位安装包根`);
    const manifest = JSON.parse(readFileSync(join(pkg, 'asset-manifest.json'), 'utf8'));
    if (manifest.version !== version) problems.push(`asset-manifest version ${manifest.version} 与 --version ${version} 不一致`);
    // 重算 payloadHash 并逐条核对资产（仓内开发布局由 validateAssetManifest 自身的开发回落解析）
    const assetLib = await import(pathToFileURL(join(pkg, 'dist/lib/asset-manifest.js')).href);
    try { assetLib.validateAssetManifest(manifest, pkg); } catch (e) { problems.push(`asset-manifest 不自洽：${e instanceof Error ? e.message : String(e)}`); }
    const must = [
      ['dist/lib/merge-amend.js', null], ['dist/lib/merge-baseline.js', null],
      ['dist/commands/verify.js', 'pre_run_failed'], ['dist/lib/sandbox.js', 'stdout_tail'],
      ['dist/commands/smoke.js', 'platform-unavailable'], ['dist/lib/merge-failure-report.js', '未进入修正写入'],
    ];
    for (const [rel, needle] of must) {
      const abs = join(pkg, rel);
      if (!existsSync(abs)) { problems.push(`包内缺少 ${rel}`); continue; }
      if (needle && !readFileSync(abs, 'utf8').includes(needle)) problems.push(`包内 ${rel} 不含 ${needle}`);
    }
    const guardEntry = ['skills', 'templates', 'schemas', 'plugins'].flatMap(k => manifest[k] ?? [])
      .find(a => a.path === 'claude-plugin-template/bin/guard-check');
    const guardFile = existsSync(join(pkg, 'claude-plugin-template/bin/guard-check'))
      ? join(pkg, 'claude-plugin-template/bin/guard-check')
      : (SELF_TEST ? join(repoRoot, 'plugin/bin/guard-check') : null);
    if (!guardEntry || !guardFile) problems.push('asset-manifest 或安装包缺少随包 guard 模板条目');
    else if (guardEntry.sha256 !== fileSha(guardFile)) problems.push('随包 guard 模板 SHA-256 与 asset-manifest 条目不一致');
    if (problems.length > 0) throw new Error(problems.join('；'));
    return {
      detail: `安装态身份同源（${version}）：manifest 自洽，包内含 verify 预跑门禁、smoke 平台例外、guard 逐段判定与 merge 增量修正及失败文案`,
      evidence: [`package_root=${pkg}`, `version=${version}`, `payload_hash=${manifest.payloadHash}`],
    };
  },
};
export const VSG_SMOKE_IDS = Object.keys(CASES);

if (process.argv.some(arg => arg.endsWith('self-test'))) {
  console.log(JSON.stringify({
    ids: VSG_SMOKE_IDS,
    environment: FORMAL_ENVIRONMENT,
    self_test_environment: SELF_TEST_ENVIRONMENT,
    applies_when: [`active change == ${SLUG}`, 'OPENLOGOS_VSG_SMOKE=1'],
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

if (INJECTED_ENTRY !== undefined && !SELF_TEST) refuse('设置了 OPENLOGOS_VSG_SMOKE_ENTRY 但未声明自测（OPENLOGOS_VSG_SMOKE_SELF_TEST=1）');
if (SELF_TEST && INJECTED_ENTRY === undefined) refuse('自测模式需要 OPENLOGOS_VSG_SMOKE_ENTRY 指定注入入口');
if (SELF_TEST && resultPath === formalResultPath()) refuse('自测结果不得写入项目正式 smoke 账本；请用 OPENLOGOS_SMOKE_RESULT_PATH 指向独立账本');

function activeChange() {
  const guardFile = join(repoRoot, 'logos', '.openlogos-guard');
  if (!existsSync(guardFile)) return null;
  try { return JSON.parse(readFileSync(guardFile, 'utf8')).activeChange || null; } catch { return null; }
}

if (!SELF_TEST && activeChange() !== SLUG && process.env.OPENLOGOS_VSG_SMOKE !== '1') {
  exitNotApplicable(VSG_SMOKE_IDS, {
    reason: `非本案安装验收窗口：需活跃变更 ${SLUG} 或 OPENLOGOS_VSG_SMOKE=1`,
    missing: ['active-change', 'OPENLOGOS_VSG_SMOKE'], environment: ENVIRONMENT, repoRoot,
  });
}

const results = new Map();
function flush() {
  mkdirSync(dirname(resultPath), { recursive: true });
  const timestamp = new Date().toISOString();
  for (const id of VSG_SMOKE_IDS) {
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
    for (const id of VSG_SMOKE_IDS) results.set(id, { status: 'fail', detail: problem, evidence: [], duration_ms: 0 });
  } else {
    for (const id of VSG_SMOKE_IDS) {
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

const failed = VSG_SMOKE_IDS.filter(id => results.get(id)?.status !== 'pass');
if (failed.length > 0) {
  exitCode = 1;
  console.error(`smoke 失败：${failed.join(', ')}`);
  for (const id of failed) console.error(`  ${id}: ${results.get(id)?.detail ?? '未执行'}`);
} else {
  console.log(`smoke 通过：${VSG_SMOKE_IDS.join(', ')}`);
}
process.exit(exitCode);
