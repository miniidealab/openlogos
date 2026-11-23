import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryCommand, entryIdentityProblems, installedLayout, isIso8601 } from './public-release-checks.mjs';

export const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export class InstallUnavailable extends Error {
  constructor(message, missing) {
    super(message);
    this.missing = missing;
  }
}

export function checked(condition, message) {
  if (!condition) throw new Error(message);
}

export const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

export const networkError = text => /\b(?:ENOTFOUND|EAI_AGAIN|ENETUNREACH|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ERR_SOCKET_TIMEOUT)\b|socket hang up|could not resolve host|failed to connect|connection timed out/i.test(text);

export function execute(command, args, { cwd, env = process.env, timeout = 120_000 } = {}) {
  return spawnSync(command, args, {
    cwd, env, timeout, shell: false, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  });
}

const outputError = r => String(r.stderr || r.stdout || '').trim().slice(-500);

export function requireExit(r, expected, label) {
  checked(!r.error && !r.signal && r.status === expected,
    label + '：预期退出 ' + expected + '，实际 ' + (r.error?.message || r.signal || r.status) + ' ' + outputError(r));
  return r.stdout.trim();
}

function put(root, file, content) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function saveConfig(root, fields) {
  const path = 'logos/logos.config.json';
  put(root, path, JSON.stringify({ ...readJson(join(root, path)), ...fields }, null, 2) + '\n');
}

const registry = (modules, gates = '') =>
  'project:\n  name: release-fixture\nmodules:\n' + modules + '\n' + gates + 'resource_index: []\n';

const core = '  - id: core\n    name: Core\n    lifecycle: launched';
const results = 'logos/resources/verify';
const guard = 'logos/.openlogos-guard';
const codeSlug = 'release-fixture';
const testTable = ids => '| ID | 用例 |\n|---|---|\n' + ids.map(id => '| ' + id + ' | 夹具 |').join('\n') + '\n';

export function isolatedEnv(root) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OPENLOGOS_|GIT_)/.test(key)));
  return {
    ...env,
    OPENLOGOS_CODEX_PERSONAL_HOME: join(root, '.codex-home'),
    OPENLOGOS_SKIP_CODEX_PLUGIN_INSTALL: '1',
    npm_config_cache: join(root, '.npm-cache'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  };
}

/** 宿主与容器走同一入口、同一组真实 CLI 断言。 */
export function checkInstalledVersion(spec, version) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-pr1621-')));
  const env = isolatedEnv(work);
  const evidence = [];
  try {
    const prefix = join(work, 'prefix');
    const installation = execute(npmBin, ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', spec], { cwd: work, env, timeout: 180_000 });
    if (networkError(outputError(installation))) throw new InstallUnavailable('安装 registry 制品时网络不可达', ['network:npm']);
    requireExit(installation, 0, '隔离安装');
    const layout = installedLayout(prefix);
    const problems = entryIdentityProblems(layout);
    checked(problems.length === 0, problems.join('；'));
    evidence.push('install_exit=0', 'entry=' + realpathSync(layout.entry));

    function cli(cwd, args, expected = 0, command) {
      const entry = entryCommand(layout, args);
      const label = args.slice(0, 2).join(' ');
      const result = execute(entry.command, entry.args, { cwd, env });
      evidence.push(label + ':exit=' + result.status);
      const stdout = requireExit(result, expected, label);
      if (!command) return stdout;
      const envelope = JSON.parse(stdout);
      checked(envelope.command === command && envelope.version === version && isIso8601(envelope.timestamp)
        && envelope.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data) && !('error' in envelope),
      label + ' 返回了不匹配的 JSON 信封');
      return envelope.data;
    }

    function json(root, command, args = [], exit = 0) {
      return cli(root, [...command.split(' '), ...args, '--format', 'json'], exit, command);
    }

    function git(root, ...args) {
      return requireExit(execute('git', args, { cwd: root, env }), 0, 'git ' + args[0]);
    }

    function openProject(name, tool = 'other') {
      const root = join(work, name);
      mkdirSync(root);
      cli(root, ['init', name, '--locale', 'zh', '--ai-tool', tool]);
      git(root, 'init', '-q', '-b', 'main');
      git(root, 'config', 'user.name', 'OpenLogos smoke');
      git(root, 'config', 'user.email', 'fixture@example.invalid');
      git(root, 'config', 'commit.gpgsign', 'false');
      git(root, 'config', 'core.hooksPath', join(work, 'empty-hooks'));
      return root;
    }

    function commit(root, label) {
      git(root, 'add', '-A');
      git(root, 'commit', '-qm', label);
      return git(root, 'rev-parse', 'HEAD');
    }

    checked(cli(work, ['--version']) === version, '隔离入口版本不等于 ' + version);
    const initRoot = openProject('init-fixture', 'all');
    for (const path of ['.claude/settings.json', '.opencode/plugins/openlogos.js', '.agents/plugins/openlogos/.codex-plugin/plugin.json']) {
      checked(existsSync(join(initRoot, path)), 'init all 缺少托管资产 ' + path);
    }
    checked(!cli(initRoot, ['sync']).includes('asset hash 不匹配'), 'sync 后资产散列不匹配');
    json(initRoot, 'status');
    for (const dir of ['requirement', 'todolist', 'code', 'image', 'temp', 'note']) {
      checked(existsSync(join(initRoot, 'logos/resources/reference', dir)), 'init 缺少 reference/' + dir);
    }

    const knowledge = openProject('knowledge-fixture');
    put(knowledge, 'logos/logos-project.yaml', registry(core));
    saveConfig(knowledge, { guard: { exempt: [] } });
    const candidate = join(work, 'knowledge-candidate');
    put(candidate, 'sources/refund-v3.md', '# 退款 v3\n');
    put(candidate, 'core-K01-refund.md', [
      '# K01：退款审批', '', '## 元数据', '', '\x60\x60\x60yaml', 'type: rule', 'scope: module',
      'module: core', 'tags: [退款]', 'status: active',
      'source: [{path: logos/resources/reference/knowledge/refund-v3.md, version: v3}]', '\x60\x60\x60', '',
      '## 规则', '', '| ID | 规则 | 状态 | 例外 |', '|---|---|---|---|', '| K01-R1 | 退款须核对凭证 | active | 无 |', '',
    ].join('\n'));
    const entryPath = 'logos/resources/knowledge/core-K01-refund.md';
    const sourcePath = 'logos/resources/reference/knowledge/refund-v3.md';
    const applied = json(knowledge, 'knowledge apply', [candidate]);
    checked(applied.result === 'applied' && [entryPath, sourcePath].every(file =>
      applied.written.includes(file) && existsSync(join(knowledge, file))), '知识条目或原文未成功落盘');
    const listed = json(knowledge, 'knowledge list', ['--module', 'core']);
    checked(listed.entries.some(entry => entry.id === 'K01' && entry.path === entryPath), 'knowledge list 缺少已录入的 K01');

    const history = openProject('history-fixture');
    put(history, 'logos/logos-project.yaml', registry(core,
      'deployment_gates:\n  core:\n    deployment_required: true\n    smoke_required: true\n'));
    saveConfig(history, {
      verify: { pre_run_command: 'node tools/results.cjs verify', result_path: results + '/test-results.jsonl', sandbox_mode: 'off' },
      smoke: { command: 'node tools/results.cjs smoke', result_path: results + '/smoke-results.jsonl', sandbox_mode: 'off' },
    });
    put(history, 'logos/resources/test/core-S01-test-cases.md', testTable(['UT-S01-01', 'UT-S01-02']));
    put(history, 'logos/resources/test/smoke/core-smoke-test-cases.md', testTable(['SMOKE-core-901']));
    put(history, 'logos/environments.yaml', 'schema_version: 1\nenvironments:\n  - id: test\n    name: Test\n    tier: test\n    deploy:\n      mode: script\n      script: tools/deploy.sh\n');
    put(history, 'tools/deploy.sh', '#!/bin/sh\nexit 0\n');
    chmodSync(join(history, 'tools/deploy.sh'), 0o755);
    put(history, 'tools/results.cjs', [
      "const fs = require('node:fs');",
      "const kind = process.argv[2];",
      "const failed = fs.readFileSync('tools/mode.txt','utf8') === 'fail';",
      "const ids = kind === 'verify' ? ['UT-S01-01','UT-S01-02'] : ['SMOKE-core-901'];",
      "const output = kind === 'verify' ? 'test-results.jsonl' : 'smoke-results.jsonl';",
      "const rows = ids.map((id, i) => ({ id, status: failed && i === 0 ? 'fail' : 'pass', error: 'fixture evidence', target_environment: process.env.OPENLOGOS_SMOKE_ENV }));",
      "fs.writeFileSync('logos/resources/verify/' + output, rows.map(r => JSON.stringify(r)).join('\\n') + '\\n');",
    ].join('\n'));
    const proposal = 'logos/changes/' + codeSlug + '/';
    put(history, proposal + 'proposal.md', [
      '# 变更提案：发布夹具', '', '## 变更原因', '发布自测', '', '## 变更类型', '代码级', '', '## 变更范围', '- 发布自测',
      '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：test',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是', '', '## 变更概述', '隔离夹具', '',
    ].join('\n'));
    put(history, proposal + 'tasks.md', '# 实现任务\n\n## [code] 代码\n- [x] 夹具\n\n## [deploy] 部署\n- [ ] 部署到 test\n');
    put(history, proposal + 'SPEC_MERGED', '{}\n');
    put(history, guard, JSON.stringify({ activeChange: codeSlug, module: 'core' }));
    put(history, 'tools/mode.txt', 'fail');
    commit(history, 'fixture');
    const v1 = json(history, 'verify', [], 1);
    put(history, 'tools/mode.txt', 'pass');
    const v2 = json(history, 'verify');
    commit(history, '部署前冻结');
    const deployment = json(history, 'deploy', ['--env', 'test']);
    checked(typeof deployment.deploy_id === 'string' && deployment.deploy_id.length > 0
      && existsSync(join(history, proposal, 'DEPLOY_DONE')), '隔离部署未返回身份或缺少标记');
    put(history, 'tools/mode.txt', 'fail');
    const s1 = json(history, 'smoke', ['--env', 'test'], 1);
    put(history, 'tools/mode.txt', 'pass');
    const s2 = json(history, 'smoke', ['--env', 'test']);
    const runs = json(history, 'history list', ['--slug', codeSlug]).runs;
    const expected = [s2, s1, v2, v1].map(data => data.history.run_id);
    checked(new Set(expected).size === 4 && JSON.stringify(runs.map(run => run.run_id)) === JSON.stringify(expected)
      && runs.map(run => run.kind + ':' + run.gate.result).join(',') === 'smoke:PASS,smoke:FAIL,verify:PASS,verify:FAIL',
    '历史缺轮次、结论不符或倒序不正确');
    const smokes = json(history, 'history list', ['--kind', 'smoke']).runs;
    checked(smokes.length === 2 && smokes.every((r, index) => r.kind === 'smoke' && r.run_id === expected[index]
      && r.environment === 'test' && r.deploy_id === deployment.deploy_id)
      && smokes[1].failed_ids.includes('SMOKE-core-901'), 'smoke 历史未关联正确的部署与失败证据');
    const first = json(history, 'history show', [v1.history.run_id]);
    function readFixtureArtifact(file) {
      const path = realpathSync(join(history, file));
      const rel = relative(history, path);
      checked(rel && !rel.startsWith('..' + '/') && rel !== '..' && !isAbsolute(rel), '历史证据超出隔离夹具');
      return readFileSync(path, 'utf8');
    }
    checked(first.run.failed_ids.includes('UT-S01-01') && first.full_record?.path === proposal + 'verify-runs/' + v1.history.run_id
      && readFixtureArtifact(first.full_record.results_path).includes('fixture evidence')
      && /\bFAIL\b/.test(readFixtureArtifact(first.full_record.report_path)), '失败轮的完整结果或报告快照不可读');
    evidence.push('history=' + JSON.stringify({ run_ids: expected, deploy_id: deployment.deploy_id, failed_ids: first.run.failed_ids }));

    const branch = openProject('branch-fixture');
    put(branch, 'base.txt', 'base');
    const common = commit(branch, '共同提交');
    git(branch, 'branch', 'inspect');
    put(branch, 'main.txt', 'main');
    const main = commit(branch, '主分支提交');
    git(branch, 'checkout', '-q', 'inspect');
    put(branch, 'inspect.txt', 'inspect');
    const head = commit(branch, '检查分支提交');
    const status = json(branch, 'branch status', ['--base', 'main']);
    checked(status.ahead === 1 && status.behind === 1 && status.up_to_date === false
      && status.head === head && status.base.commit === main && status.merge_base === common, 'branch status 与夹具拓扑不一致');
    evidence.push('branch=' + JSON.stringify({ ahead: status.ahead, behind: status.behind, merge_base: status.merge_base }));

    const scoped = openProject('scope-fixture');
    put(scoped, 'logos/logos-project.yaml', registry(core + '\n    paths: ["src/**"]\n'
      + '  - id: portal-web\n    name: Portal\n    lifecycle: launched\n    paths: ["portal-web/**"]'));
    put(scoped, 'logos/resources/test/core-S01-test-cases.md', testTable(['UT-S01-01']));
    put(scoped, 'logos/resources/test/portal-web-S50-test-cases.md', testTable(['UT-S50-01']));
    put(scoped, 'portal-web/app.txt', 'before');
    const scopeCommand = 'node tools/scope.cjs ';
    saveConfig(scoped, { verify: {
      sandbox_mode: 'off',
      pre_run_command: scopeCommand + 'project',
      modules: { core: { pre_run_command: scopeCommand + 'core' }, 'portal-web': { pre_run_command: scopeCommand + 'portal-web' } },
    } });
    put(scoped, 'tools/scope.cjs', [
      "const fs = require('node:fs'); const moduleName = process.argv[2];",
      "fs.appendFileSync('calls.log', moduleName + '\\n');",
      "fs.writeFileSync('logos/resources/verify/test-results.jsonl', JSON.stringify({id: moduleName === 'core' ? 'UT-S01-01' : 'UT-S50-01',status:'pass'}) + '\\n');",
    ].join('\n'));
    commit(scoped, '模块基线');
    cli(scoped, ['change', 'scope-fixture', '--module', 'portal-web']);
    put(scoped, 'portal-web/app.txt', 'after');
    function checkScope(args, mode, modules) {
      rmSync(join(scoped, 'calls.log'), { force: true });
      const data = json(scoped, 'verify', args);
      const calls = readFileSync(join(scoped, 'calls.log'), 'utf8').trim().split('\n');
      checked(data.gate.result === 'PASS' && data.scope.mode === mode
        && JSON.stringify(data.scope.modules) === JSON.stringify(modules)
        && JSON.stringify(calls) === JSON.stringify(modules), 'verify 模块范围与实际 runner 调用不一致：' + JSON.stringify({ scope: data.scope, calls }));
      evidence.push('verify_scope=' + JSON.stringify({ mode, calls }));
    }
    checkScope([], 'module', ['portal-web']);
    checkScope(['--all'], 'all', ['core', 'portal-web']);
    return evidence;
  } catch (error) {
    error.evidence = evidence;
    throw error;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [spec, version] = process.argv.slice(2);
  try {
    checked(typeof process.getuid === 'function' && process.getuid() !== 0, 'Linux 夹具必须由非 root 用户执行');
    const evidence = checkInstalledVersion(spec, version);
    console.log(JSON.stringify({ uid: process.getuid(), evidence }));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, missing: error.missing, evidence: error.evidence }));
    process.exitCode = error instanceof InstallUnavailable ? 3 : 1;
  }
}
