'use strict';
/**
 * SMOKE-core-273 ④⑤ / SMOKE-core-274 的环境能力检查（release-0-16-7），供 scripts/smoke-public-release-0-16-7.js 在宿主机与
 * docker node:20 一次性容器内（SMOKE-core-275）共用同一份判据。CommonJS、只依赖 node 内置模块与 git / sh，不依赖本仓。
 *
 * 用法：node env-capability-check-0-16-7.cjs '<{"command":…,"args":[…]} 的 JSON>' <registry|deploy>
 *   - 第一个参数是已安装 CLI 的真实入口（绝对路径命令 + 前置参数），不得经 PATH 解析到本机全局；
 *   - registry：SMOKE-core-273 ④⑤（登记表校验、proposal_default_env 输出与标注、deploy-done → smoke → 已验证，SMOKE-core-252 / 264 口径）；
 *   - deploy：SMOKE-core-274（script 版本通道、dry-run、回滚、晋级拦截、审批拦截 / 幂等 / 使用，SMOKE-core-255 / 259 / 260 口径）。
 * 结果只以一行 `ENVCHECK_RESULT=<json>` 打印到 stdout：`problems` 为真实失败，`gaps` 为可补齐的环境缺口（如缺 git）。
 * 全部读写只在 os.tmpdir() 下的一次性目录内，结束即删除。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [entryJson, scenario] = process.argv.slice(2);
const out = { scenario, problems: [], gaps: [], evidence: [] };
const scopes = [];
const finish = () => {
  for (const s of scopes) { try { fs.rmSync(s, { recursive: true, force: true }); } catch { /* 尽力清理 */ } }
  process.stdout.write(`\nENVCHECK_RESULT=${JSON.stringify(out)}\n`);
  process.exit(0);
};

let entry;
try { entry = JSON.parse(entryJson); } catch { out.problems.push('入口参数不是 JSON'); finish(); }

const LEDGER_REL = 'logos/.openlogos-runtime/deployments.jsonl';
const FIXTURE_RESULT = 'logos/resources/verify/smoke-results.jsonl';
const FIXTURE_SLUG = 'pr167-env-fixture';

/** 子进程环境：剥离外层 smoke 账本、外层目标环境、部署注入与本 runner 的控制变量。 */
function isolatedEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'OPENLOGOS_SMOKE_RESULT_PATH' || key === 'OPENLOGOS_SMOKE_ENV'
      || key.startsWith('OPENLOGOS_DEPLOY_') || key.startsWith('OPENLOGOS_PR167_')) delete env[key];
  }
  return { ...env, ...extra };
}
const sh = (cmd, args, cwd, extra) => spawnSync(cmd, args, {
  cwd, encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, env: isolatedEnv(extra),
});
const cliRaw = (cwd, args, extra) => sh(entry.command, [...(entry.args || []), ...args], cwd, extra);
function cliJson(cwd, args, extra) {
  const r = cliRaw(cwd, [...args, '--format', 'json'], extra);
  let data = null;
  let error = null;
  try { data = JSON.parse(r.stdout).data ?? null; } catch { /* 错误路径无 stdout envelope */ }
  try { error = JSON.parse(String(r.stderr || '').trim()).error ?? null; } catch { /* 成功路径无 stderr envelope */ }
  return { status: r.status, data, error, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const brief = r => `exit=${r.status} ${r.error ? `error=${JSON.stringify(r.error).slice(0, 300)}` : `data=${JSON.stringify(r.data ?? null).slice(0, 300)}`}`;
function tempDir(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `openlogos-pr167-${tag}-`));
  scopes.push(dir);
  return dir;
}
function put(root, rel, content, mode) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  if (mode !== undefined) fs.chmodSync(abs, mode);
}
function git(dir, args) {
  const r = sh('git', args, dir);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${String(r.stderr || '').slice(0, 300)}`);
  return String(r.stdout).trim();
}
function ledgerRows(dir) {
  const p = path.join(dir, LEDGER_REL);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}

/** 夹具 smoke runner：读取注入的 OPENLOGOS_SMOKE_ENV，写入结果行 target_environment 与 observed_env。 */
const FIXTURE_RUNNER = [
  "const fs = require('fs'); const path = require('path');",
  `const p = ${JSON.stringify(FIXTURE_RESULT)};`,
  'const env = process.env.OPENLOGOS_SMOKE_ENV ?? null;',
  'fs.mkdirSync(path.dirname(p), { recursive: true });',
  "fs.writeFileSync(p, JSON.stringify({ id: 'SMOKE-core-901', status: 'pass', timestamp: new Date().toISOString(), target_environment: env, observed_env: env }) + '\\n');",
].join('\n');

/** 一次性 git 项目：经被测入口 init，写登记表、夹具 smoke 用例与 runner。 */
function initProject(registry) {
  const dir = tempDir('project');
  const init = cliRaw(dir, ['init', '--locale', 'en', '--ai-tool', 'claude-code']);
  if (init.status !== 0) throw new Error(`openlogos init 失败：exit ${init.status} ${String(init.stderr || '').slice(0, 300)}`);
  put(dir, 'logos/environments.yaml', registry);
  put(dir, 'logos/resources/test/smoke/core-smoke-test-cases.md', '| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  put(dir, 'scripts/smoke-pr167-fixture.cjs', FIXTURE_RUNNER);
  const cfgPath = path.join(dir, 'logos/logos.config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  cfg.smoke = { ...(cfg.smoke || {}), result_path: FIXTURE_RESULT, command: 'node scripts/smoke-pr167-fixture.cjs', sandbox_mode: 'off' };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const gitignore = path.join(dir, '.gitignore');
  fs.writeFileSync(gitignore, `${fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : ''}\nlogos/.openlogos-runtime/\nlogos/environments.yaml\n`);
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.name', 'smoke']);
  git(dir, ['config', 'user.email', 'smoke@example.invalid']);
  return dir;
}

/** registry：SMOKE-core-273 ④⑤。 */
function registryScenario() {
  const dir = initProject([
    'schema_version: 1',
    'proposal_default_env: test',
    'environments:',
    '  - id: test',
    '    name: Test',
    '    tier: test',
    '    aliases: [测试]',
    '  - id: staging',
    '    name: Staging',
    '    tier: staging',
    '  - id: prod',
    '    name: Production',
    '    tier: prod',
    '    aliases: [生产]',
    '',
  ].join('\n'));
  out.evidence.push(`project=${dir}`);
  // ④ env check / env list（JSON 与文本）
  const check = cliJson(dir, ['env', 'check']);
  out.evidence.push(`④ env check: ${brief(check)}`);
  if (check.status !== 0 || (check.data?.errors ?? []).length > 0) out.problems.push(`④ env check 应退出码 0 且 errors 为空，实际 ${brief(check)}`);
  const list = cliJson(dir, ['env', 'list']);
  out.evidence.push(`④ env list proposal_default_env=${JSON.stringify(list.data?.proposal_default_env)}`);
  if (list.status !== 0 || list.data?.proposal_default_env !== 'test') out.problems.push(`④ env list 应输出 proposal_default_env=test，实际 ${brief(list)}`);
  const text = String(cliRaw(dir, ['env', 'list']).stdout || '');
  const lineOf = id => text.split('\n').find(l => l.startsWith(`  ${id}  `)) ?? '';
  const marked = l => /（提案默认）\s*$|\(proposal default\)\s*$/.test(l);
  out.evidence.push(`④ text test=${JSON.stringify(lineOf('test'))} staging=${JSON.stringify(lineOf('staging'))} prod=${JSON.stringify(lineOf('prod'))}`);
  if (!marked(lineOf('test'))) out.problems.push(`④ 文本模式 test 行应带「（提案默认）」/「(proposal default)」，实际 ${JSON.stringify(lineOf('test'))}`);
  if (marked(lineOf('staging')) || marked(lineOf('prod'))) out.problems.push('④ 文本模式只有 test 行应带默认标注');
  // ⑤ 活跃提案（VERIFY_PASS、[deploy] 全勾）→ deploy-done --env 生产 --ref HEAD → smoke --env prod → env show prod
  const rel = `logos/changes/${FIXTURE_SLUG}`;
  put(dir, `${rel}/deltas/test/smoke/core-smoke-test-cases.md`, '## ADDED — 夹具 smoke\n\n| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | 安装态 |\n');
  put(dir, `${rel}/proposal.md`, [
    '# 变更提案：fixture', '', '## 部署影响', '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：生产',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：是', '- 是否需要 smoke：是',
  ].join('\n'));
  put(dir, `${rel}/tasks.md`, '# 实现任务\n\n## [deploy] 发布\n- [x] 发布到生产\n');
  put(dir, `${rel}/VERIFY_PASS`, '');
  put(dir, `${rel}/LOOP_ITERS`, `${JSON.stringify({ iter: 1, node: 'verify', result: 'pass', module: 'core', timestamp: new Date().toISOString() })}\n`);
  put(dir, 'logos/.openlogos-guard', JSON.stringify({ activeChange: FIXTURE_SLUG, module: 'core' }));
  put(dir, 'logos/resources/verify/deployment-report.md', '# Deployment Report\n\nfixture\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'fixture']);
  const head = git(dir, ['rev-parse', 'HEAD']);
  const dd = cliJson(dir, ['deploy-done', '--env', '生产', '--ref', 'HEAD']);
  out.evidence.push(`⑤ deploy-done: ${brief(dd)}`);
  if (dd.status !== 0) out.problems.push(`⑤ deploy-done 应成功，实际 ${brief(dd)}`);
  const markerPath = path.join(dir, rel, 'DEPLOY_DONE');
  const markerText = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8') : '';
  let marker = null;
  try { marker = JSON.parse(markerText); } catch { /* 下方报告 */ }
  if (!marker || markerText.trimEnd().includes('\n')) out.problems.push(`⑤ DEPLOY_DONE 应为单行 JSON，实际 ${JSON.stringify(markerText.slice(0, 200))}`);
  else {
    if (marker.environment !== 'prod') out.problems.push(`⑤ DEPLOY_DONE.environment 应为 prod，实际 ${marker.environment}`);
    if (marker.ref !== head) out.problems.push(`⑤ DEPLOY_DONE.ref 应为当时 HEAD ${head}，实际 ${marker.ref}`);
  }
  const sm = cliJson(dir, ['smoke', '--env', 'prod']);
  const ev = sm.data?.environment_evidence;
  out.evidence.push(`⑤ smoke: exit=${sm.status} gate=${sm.data?.gate?.result} environment_evidence=${JSON.stringify(ev ?? null)}`);
  if (sm.status !== 0 || sm.data?.gate?.result !== 'PASS') out.problems.push(`⑤ smoke 门禁应 PASS，实际 ${brief(sm)}`);
  if (ev?.env_evidence !== 'declared' || ev?.verified !== true) out.problems.push(`⑤ environment_evidence 应 declared / verified，实际 ${JSON.stringify(ev ?? null)}`);
  const show = cliJson(dir, ['env', 'show', 'prod']);
  out.evidence.push(`⑤ env show: current_ref=${show.data?.current_ref} last_smoke=${JSON.stringify(show.data?.last_smoke ?? null).slice(0, 300)}`);
  if (show.data?.last_smoke?.verified !== true) out.problems.push(`⑤ env show 的 last_smoke.verified 应为 true，实际 ${JSON.stringify(show.data?.last_smoke ?? null)}`);
  if (!marker || show.data?.current_ref !== marker.ref) out.problems.push(`⑤ current_ref 应等于 DEPLOY_DONE.ref ${marker?.ref}，实际 ${show.data?.current_ref}`);
}

/** 夹具部署脚本：注入的环境 / 版本写入 deploys.txt，工作目录 HEAD、脚本版本与 payload 写入 last.txt。 */
const deployScript = label => [
  '#!/bin/sh',
  'mkdir -p "$PUBLISH_DIR"',
  `echo "$OPENLOGOS_DEPLOY_ENV ${label} $OPENLOGOS_DEPLOY_REF" >> "$PUBLISH_DIR/deploys.txt"`,
  '{',
  '  echo "env=$OPENLOGOS_DEPLOY_ENV"',
  '  echo "ref=$OPENLOGOS_DEPLOY_REF"',
  '  echo "head=$(git rev-parse HEAD)"',
  `  echo "script=${label}"`,
  '  echo "payload=$(cat payload.txt)"',
  '} > "$PUBLISH_DIR/last-$OPENLOGOS_DEPLOY_ENV.txt"',
  '',
].join('\n');

/** deploy：SMOKE-core-274。 */
function deployScenario() {
  const dir = initProject([
    'schema_version: 1',
    'environments:',
    '  - id: staging',
    '    name: Staging',
    '    tier: staging',
    '    deploy: {mode: script, script: deploy/run.sh}',
    '  - id: prod',
    '    name: Production',
    '    tier: prod',
    '    deploy: {mode: script, script: deploy/run.sh}',
    '    promote_from: staging',
    '    require_approval: true',
    '',
  ].join('\n'));
  const publish = tempDir('publish');
  const env = { PUBLISH_DIR: publish };
  out.evidence.push(`project=${dir}`, `publish=${publish}`);
  const commits = {};
  for (const tag of ['v1', 'v2']) {
    put(dir, 'deploy/run.sh', deployScript(tag), 0o755);
    put(dir, 'payload.txt', `${tag}\n`);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', tag]);
    git(dir, ['tag', tag]);
    commits[tag] = git(dir, ['rev-parse', 'HEAD']);
  }
  put(dir, 'deploy/run.sh', deployScript('head'), 0o755);
  put(dir, 'payload.txt', 'head\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head']);
  fs.writeFileSync(path.join(dir, 'payload.txt'), 'uncommitted\n'); // 工作区另有一处未提交改动
  const lines = () => (fs.existsSync(path.join(publish, 'deploys.txt')) ? fs.readFileSync(path.join(publish, 'deploys.txt'), 'utf8').trim().split('\n') : []);
  const last = envId => {
    const p = path.join(publish, `last-${envId}.txt`);
    if (!fs.existsSync(p)) return {};
    return Object.fromEntries(fs.readFileSync(p, 'utf8').trim().split('\n').map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  };
  const prodRuns = () => lines().filter(l => l.startsWith('prod ')).length;
  // ① dry-run：零执行、零写账本
  const rowsBefore = ledgerRows(dir).length;
  const dry = cliJson(dir, ['deploy', '--env', 'staging', '--ref', 'v1', '--dry-run'], env);
  out.evidence.push(`① dry-run: ${brief(dry)}`);
  if (dry.status !== 0 || dry.data?.status !== 'dry-run') out.problems.push(`① dry-run 应退出码 0 且 status=dry-run，实际 ${brief(dry)}`);
  if (lines().length !== 0 || ledgerRows(dir).length !== rowsBefore) out.problems.push('① dry-run 不应执行脚本或写账本');
  // ② staging 版本通道 v1、v2（隔离工作树，不含未提交改动）
  for (const tag of ['v1', 'v2']) {
    const r = cliJson(dir, ['deploy', '--env', 'staging', '--ref', tag], env);
    const rec = last('staging');
    out.evidence.push(`② deploy staging ${tag}: ${brief(r)} publish=${JSON.stringify(rec)}`);
    if (r.status !== 0 || r.data?.channel !== 'version' || r.data?.mode !== 'script' || r.data?.ref !== commits[tag]) {
      out.problems.push(`② staging ${tag} 应成功且 channel=version、mode=script、ref=${commits[tag]}，实际 ${brief(r)}`);
    }
    if (rec.ref !== commits[tag] || rec.head !== commits[tag] || rec.script !== tag || rec.payload !== tag) {
      out.problems.push(`② staging ${tag} 发布目录应记录 ${tag} 的 commit、脚本与 payload，实际 ${JSON.stringify(rec)}`);
    }
  }
  const show = cliJson(dir, ['env', 'show', 'staging']);
  out.evidence.push(`② env show staging: current=${show.data?.current_ref} previous=${show.data?.previous_ref}`);
  if (show.data?.current_ref !== commits.v2 || show.data?.previous_ref !== commits.v1) out.problems.push('② env show staging 应 current_ref=v2、previous_ref=v1');
  // ③ 回滚到 v1
  const rb = cliJson(dir, ['deploy', '--env', 'staging', '--rollback'], env);
  out.evidence.push(`③ rollback: ${brief(rb)}`);
  if (rb.status !== 0 || rb.data?.rollback !== true || rb.data?.rollback_from !== commits.v2 || rb.data?.ref !== commits.v1) {
    out.problems.push(`③ 应部署 v1、rollback=true、rollback_from=v2，实际 ${brief(rb)}`);
  }
  if (last('staging').script !== 'v1') out.problems.push('③ 发布目录应回到 v1 脚本的输出');
  if (fs.readFileSync(path.join(dir, 'payload.txt'), 'utf8') !== 'uncommitted\n') out.problems.push('当前工作区的未提交改动被改动');
  // ④ staging 尚未以 v1 通过 smoke：prod 晋级拦截，零执行
  const d4 = cliJson(dir, ['deploy', '--env', 'prod', '--ref', 'v1'], env);
  out.evidence.push(`④ deploy prod v1: ${brief(d4)}`);
  if (d4.status !== 1 || d4.error?.code !== 'DEPLOY_PROMOTION_UNVERIFIED') out.problems.push(`④ 应 DEPLOY_PROMOTION_UNVERIFIED、退出码 1，实际 ${brief(d4)}`);
  if (prodRuns() !== 0 || ledgerRows(dir).some(r => r.kind === 'deploy' && r.environment === 'prod')) out.problems.push('④ 不应执行 prod 部署或写 prod deploy 记录');
  // ⑤ staging 部署 v1 并以 smoke 验证；prod 未审批：审批拦截，给出命令原文，零执行
  const d5s = cliJson(dir, ['deploy', '--env', 'staging', '--ref', 'v1'], env);
  const sm = cliJson(dir, ['smoke', '--env', 'staging']);
  const lastSmoke = ledgerRows(dir).filter(r => r.kind === 'smoke').pop();
  out.evidence.push(`⑤ staging v1: ${brief(d5s)}; smoke exit=${sm.status} ledger_smoke=${JSON.stringify(lastSmoke ?? null).slice(0, 300)}`);
  if (d5s.status !== 0 || sm.status !== 0 || lastSmoke?.environment !== 'staging' || lastSmoke?.ref !== commits.v1 || lastSmoke?.verified !== true) {
    out.problems.push(`⑤ staging smoke 应以 verified=true 验证 v1，实际 smoke exit=${sm.status} ${JSON.stringify(lastSmoke ?? null).slice(0, 300)}`);
  }
  const d5 = cliJson(dir, ['deploy', '--env', 'prod', '--ref', 'v1'], env);
  out.evidence.push(`⑤ deploy prod v1: ${brief(d5)}`);
  if (d5.status !== 1 || d5.error?.code !== 'DEPLOY_APPROVAL_REQUIRED'
    || d5.error?.details?.approve_command !== `openlogos approve --env prod --ref ${commits.v1}`) {
    out.problems.push(`⑤ 应 DEPLOY_APPROVAL_REQUIRED 且 approve_command 为命令原文，实际 ${brief(d5)}`);
  }
  if (prodRuns() !== 0) out.problems.push('⑤ 不应执行 prod 部署脚本');
  // ⑥ 连续两次审批（幂等）后部署成功并使用审批
  const a = cliJson(dir, ['approve', '--env', 'prod', '--ref', 'v1']);
  const b = cliJson(dir, ['approve', '--env', 'prod', '--ref', 'v1']);
  out.evidence.push(`⑥ approve#1: ${brief(a)}; approve#2: ${brief(b)}`);
  if (a.status !== 0 || a.data?.created !== true || b.data?.created !== false || a.data?.approval_id !== b.data?.approval_id) {
    out.problems.push('⑥ 两次审批应返回同一 approval_id，第一次 created=true、第二次 created=false');
  }
  const d6 = cliJson(dir, ['deploy', '--env', 'prod', '--ref', 'v1'], env);
  const r6 = ledgerRows(dir).filter(r => r.kind === 'deploy' && r.environment === 'prod').pop();
  out.evidence.push(`⑥ deploy prod v1: ${brief(d6)} record=${JSON.stringify(r6 ?? null).slice(0, 300)}`);
  if (d6.status !== 0 || r6?.result !== 'done' || r6?.promoted_from !== 'staging' || r6?.approval_id !== a.data?.approval_id) {
    out.problems.push(`⑥ 应成功并记录 promoted_from=staging、approval_id 等于审批，实际 ${brief(d6)}`);
  }
  if (prodRuns() !== 1 || last('prod').ref !== commits.v1) out.problems.push(`⑥ prod 部署脚本应以 v1 恰运行一次，实际 ${prodRuns()} 次`);
}

try {
  for (const tool of ['git', 'sh']) {
    const probe = spawnSync(tool, tool === 'git' ? ['--version'] : ['-c', 'exit 0'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) out.gaps.push(`tool:${tool}`);
  }
  if (out.gaps.length > 0) finish();
  if (scenario === 'registry') registryScenario();
  else if (scenario === 'deploy') deployScenario();
  else out.problems.push(`未知场景：${scenario}`);
} catch (e) {
  out.problems.push(`环境能力检查异常：${e && e.stack ? String(e.stack).slice(0, 400) : String(e)}`);
}
finish();
