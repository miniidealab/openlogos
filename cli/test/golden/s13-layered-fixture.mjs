/**
 * layered-verification 夹具（logos/resources/test/core-S13-test-cases.md「S13 分层验收测试」的夹具 LV 及其变体）。
 *
 * 夹具 LV：一次性 git 项目，单模块 core（launched）。已合并测试规格
 *   core-S01（UT-S01-01～03）、core-S02（UT-S02-01、02）、core-S03（UT-S03-01、02，主链路小节列 UT-S03-01）、
 *   core-S04（UT-S04-01 [manual]、UT-S04-02）。
 * 初始提交之后建立活跃提案 lv-demo（guard 带 baseRef）：deltas/test/core-S01-test-cases.md 新增 UT-S01-04 并写入
 * SPEC_MERGED（本提案用例 C = {UT-S01-04}，delta 触及场景 S01）；proposal.md 的「受影响场景」段缺省为
 * assessed / shared_change: false / scenarios: [S02]。verify.layered.enabled: true。
 * 缺省 P = {UT-S01-01～04、UT-S02-01、02、UT-S03-01}；UT-S03-02、UT-S04-02 在 P 之外。
 *
 * 变体 LV-mod（opts.mod）：多模块 core / backend / web（各自声明 paths，verify.modules 各有命令组），测试规格
 *   core-S01、core-S03（主链路 UT-S03-01）、backend-S05（提案新增 UT-S05-03）、backend-S06、web-S07；提案属于 backend，只改动 backend/**。
 *
 * 记录型入口 tools/lv-runner.mjs <名称>：
 *   - 每次被执行时向项目外的 LV_LOG 追加一行调用记录（该入口的第几次调用、收到的 ELIGIBLE / SLICE_SCOPE / MODULES / RERUN、
 *     实际执行的用例 ID、工作目录）；
 *   - 负责的用例取自项目内测试规格（名称为 project 时全部文档，否则 `<名称>-` 前缀的文档），不含 [manual]；
 *   - 剧本在项目外的 LV_SCRIPT：mode 为 narrow（收到清单时只执行、只上报清单内的用例）、wide（忽略清单，执行并上报全部）、
 *     quiet（执行全部，只上报清单内的用例）；cases 决定每条用例第 n 次调用时写 pass / fail / skip / none（缺省 pass）；
 *     有 fail 时非零退出，exit 可覆盖某次调用的退出码；invalidLine 让某次调用多写一行非法 JSON；
 *     extra 列出清单之外额外执行并上报的用例（模拟入口只多报了个别用例）；状态 skip-bare 写不带原因的 skip；
 *     during 让某次调用在执行期间新建一个空提交（commit）、留下一个未跟踪的源码文件（untracked），
 *     暂存一处改动后把工作区改回原样（staged），或改写一个已跟踪的源码文件而不暂存、不提交（modified）；foreign 让指定入口额外上报不归它负责的用例；
 *     writeShared 让入口在当前工作目录（沙箱开启时即副本）生成一份共用验收报告。
 *
 * 变体 LV-rel（opts.rel）：去掉活跃提案，全部内容已提交、工作区干净，用于发布级验收。
 * opts.commitAll：保留活跃提案，但把提案内容全部提交（工作区干净）。
 *   - 每次调用向 stdout 输出一行 `LV-RUNNER-OUTPUT …`，用于断言验收报告不写命令输出。
 * 剧本与调用记录都放在项目外，避免计入提案的改动文件。
 *
 * 本模块同时被测试与 golden 生成器使用：
 *   node test/golden/s13-layered-fixture.mjs <引入前构建的 dist/index.js> <out.json>
 * 生成器以引入前构建的 CLI 运行 observeDisabledFixture，供 UT-S13-218 比对（新增的 level 字段除外）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeDefaultSandboxRoot } from './normalize-default-sandbox-root.mjs';
import { isolatedProcessEnv } from './s13-module-scope-fixture.mjs';

export const GIT_ENV = {
  GIT_AUTHOR_NAME: 'lv', GIT_AUTHOR_EMAIL: 'lv@example.invalid',
  GIT_COMMITTER_NAME: 'lv', GIT_COMMITTER_EMAIL: 'lv@example.invalid',
  GIT_AUTHOR_DATE: '2026-11-27T00:00:00Z', GIT_COMMITTER_DATE: '2026-11-27T00:00:00Z',
};
export const SLUG = 'lv-demo';
export const RESULTS = 'logos/resources/verify/test-results.jsonl';
export const P_DEFAULT = ['UT-S01-01', 'UT-S01-02', 'UT-S01-03', 'UT-S01-04', 'UT-S02-01', 'UT-S02-02', 'UT-S03-01'];
export const ALL_DEFAULT = [...P_DEFAULT, 'UT-S03-02', 'UT-S04-02'].sort();

export function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...isolatedProcessEnv(), ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

export function put(root, rel, content) {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

export const table = ids => `${['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | fixture |`)].join('\n')}\n`;
export const mainPathSection = ids => `\n## 主链路用例\n\n${ids.map(id => `- ${id}`).join('\n')}\n`;

const RUNNER = `import fs from 'node:fs';
import path from 'node:path';
const name = process.argv[2] || 'project';
const script = process.env.LV_SCRIPT && fs.existsSync(process.env.LV_SCRIPT) ? JSON.parse(fs.readFileSync(process.env.LV_SCRIPT, 'utf8')) : {};
const mode = script.mode || 'narrow';
const dir = 'logos/resources/test';
const own = [];
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('-test-cases.md')).sort()) {
  if (name !== 'project' && !file.startsWith(name + '-')) continue;
  for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\\n')) {
    const m = /^\\|\\s*((?:UT|ST)-[A-Za-z0-9]+-[0-9]+)\\s*(\\[manual[^\\]]*\\])?\\s*\\|/.exec(line);
    if (m && !m[2] && !own.includes(m[1])) own.push(m[1]);
  }
}
let eligible = null;
if (process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS) {
  try { const v = JSON.parse(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS); if (Array.isArray(v)) eligible = v; } catch {}
}
const log = process.env.LV_LOG;
const prior = log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const n = prior.filter(c => c.runner === name).length + 1;
const inList = id => !eligible || eligible.includes(id);
const executed = mode === 'narrow' ? own.filter(id => inList(id) || (script.extra || []).includes(id)) : own;
const extra = script.extra || [];
const reported = mode === 'wide' ? own : own.filter(id => inList(id) || extra.includes(id));
if (log) {
  fs.appendFileSync(log, JSON.stringify({
    call: n, runner: name, eligible,
    slice_scope: process.env.OPENLOGOS_VERIFY_SLICE_SCOPE ?? null,
    modules: process.env.OPENLOGOS_VERIFY_MODULES ?? null,
    rerun: process.env.OPENLOGOS_VERIFY_RERUN ?? null,
    executed, cwd: process.cwd(),
  }) + '\\n');
}
const out = '${RESULTS}';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, '');
const pick = plan => Array.isArray(plan) ? plan[Math.min(n, plan.length) - 1] : plan;
const lines = [];
let anyFail = false;
for (const id of executed) {
  const status = pick((script.cases || {})[id]) || 'pass';
  if (status === 'fail') anyFail = true;
  if (status === 'none' || !reported.includes(id)) continue;
  const rec = { id, status, scenario: id.split('-')[1], timestamp: new Date().toISOString() };
  if (status === 'fail') rec.error = 'LV ' + id + ' failed on call ' + n;
  if (status === 'skip') { rec.reason_code = 'platform-unavailable'; rec.detail = 'LV platform skip'; }
  if (status === 'skip-bare') rec.status = 'skip';
  lines.push(JSON.stringify(rec));
}
// 执行期间的副作用（发布级收尾复核用）：commit = 新建一个空提交；untracked = 留下一个未跟踪的源码文件
const during = (script.during || {})[String(n)];
if (during === 'commit') {
  const { spawnSync } = await import('node:child_process');
  spawnSync('git', ['commit', '-q', '--allow-empty', '-m', 'during-run'], { stdio: 'ignore' });
}
if (during === 'staged') {
  // 暂存一处改动后把工作区内容改回原样：HEAD 与工作区没有净差异，但暂存区有改动
  const { spawnSync } = await import('node:child_process');
  const original = fs.readFileSync('src/core.ts', 'utf8');
  fs.writeFileSync('src/core.ts', original + '// staged' + String.fromCharCode(10));
  spawnSync('git', ['add', 'src/core.ts'], { stdio: 'ignore' });
  fs.writeFileSync('src/core.ts', original);
}
if (during === 'untracked') fs.writeFileSync('src/left-behind.ts', 'export const left = 1;' + String.fromCharCode(10));
// modified：改写一个已跟踪的源码文件而不暂存、不提交（HEAD 不变，工作区有改动）
if (during === 'modified') fs.appendFileSync('src/core.ts', '// modified during run' + String.fromCharCode(10));
// foreign：某个入口额外上报不归它负责的用例（模拟跨模块上报）；writeShared：在当前工作目录生成一份共用验收报告
for (const id of ((script.foreign || {})[name] || [])) lines.push(JSON.stringify({ id, status: 'pass', scenario: id.split('-')[1], timestamp: new Date().toISOString() }));
if (script.writeShared) fs.writeFileSync('logos/resources/verify/acceptance-report.md', '# Acceptance Report' + String.fromCharCode(10) + 'written by the test entry' + String.fromCharCode(10));
if ((script.invalidLine || []).includes(n)) lines.push('{not json');
fs.writeFileSync(out, lines.length ? lines.join('\\n') + '\\n' : '');
console.log('LV-RUNNER-OUTPUT ' + name + ' call ' + n);
const override = (script.exit || {})[String(n)];
process.exit(override !== undefined ? override : (anyFail ? 1 : 0));
`;

export function declarationSection(body) {
  return `## 受影响场景\n\n\`\`\`yaml\n${body}\n\`\`\`\n`;
}
export function declarationYaml({ assessment = 'assessed', shared = 'false', scenarios = ['S02'] } = {}) {
  const items = scenarios.length === 0 ? ' []' : `\n${scenarios.map(id => `  - id: ${id}\n    reason: 夹具声明 ${id} 受波及`).join('\n')}`;
  return `schema: openlogos/affected-scenarios@1\nassessment: ${assessment}\nshared_change: ${shared}\nscenarios:${items}`;
}

function proposalText(declaration) {
  return [
    `# 变更提案：${SLUG}`, '', '## 变更原因', '分层验收夹具。', '', '## 变更类型', '代码级', '', '## 变更范围', '- CLI', '',
    '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无', '- 是否涉及数据迁移：否',
    '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '',
    '## 验收标准', '- 自动验收环境要求：无', '- 平台限定用例：无', '- 需要人参与的验收：无', '',
    ...(declaration === null ? [] : [declarationSection(declaration)]),
    '## 变更概述', '夹具。', '',
  ].join('\n');
}

/**
 * 建夹具。opts：
 *   mod            LV-mod 变体
 *   layered        verify.layered 的取值；undefined → { enabled: true }；null → 不写该字段
 *   verify         合并进 verify 配置的其他字段（初始提交内）
 *   docs           覆盖缺省的测试规格 { 文件名: 文档内容 }（初始提交内）
 *   declaration    「受影响场景」段的 YAML 正文；null → 不写该段；undefined → 缺省声明
 *   merged         是否已合并（写 SPEC_MERGED 并把新增用例写入已合并规格），缺省 true
 *   guard          'ok'（缺省）| 'no-base' | 'bad-base' | 'none'（不建提案）
 *   git            false → 建完后删除 .git
 *   changes        建提案之后写入的文件 { 路径: 内容 }（计入改动文件）
 *   mode           入口模式 narrow / wide / quiet
 *   script         入口剧本的其余字段 { cases, exit, invalidLine }
 *   change         本提案的测试变更 { target: 测试规格文件名（可以是新文件）, added: 新增用例 ID 数组 }；缺省新增一条
 *   owner          提案所属模块（guard.module 与测试变更集的 module）；缺省 LV 为 core、LV-mod 为 backend
 *   tasks          tasks.md 全文（缺省为单任务，不进入切片验收）
 *   buildTestChangeSet  测试变更集构造器（merged 时必填）
 */
export function createLv(opts = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-lv-')));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-lv-out-')));
  const mod = opts.mod === true;
  const layered = opts.layered === undefined ? { enabled: true } : opts.layered;
  const moduleIds = mod ? ['core', 'backend', 'web'] : ['core'];
  const verify = {
    result_path: RESULTS,
    sandbox_mode: 'off',
    pre_run_command: 'node tools/lv-runner.mjs project',
    ...(mod ? { modules: Object.fromEntries(moduleIds.map(id => [id, { pre_run_command: `node tools/lv-runner.mjs ${id}` }])) } : {}),
    ...(layered === null ? {} : { layered }),
  };
  for (const [key, value] of Object.entries(opts.verify ?? {})) {
    if (key === 'modules' && verify.modules) {
      for (const [id, extra] of Object.entries(value)) verify.modules[id] = { ...verify.modules[id], ...extra };
    } else verify[key] = value;
  }
  put(root, 'logos/logos.config.json', JSON.stringify({ name: 'lv', locale: opts.locale ?? 'zh', description: '', documents: {}, verify }, null, 2));
  const yaml = ['project:', '  name: lv', 'modules:'];
  for (const id of moduleIds) {
    yaml.push(`  - id: ${id}`, `    name: ${id}`, '    lifecycle: launched');
    if (mod) yaml.push(`    paths: ${JSON.stringify([id === 'core' ? 'src/**' : `${id}/**`, ...(id === 'core' ? ['tools/**'] : [])])}`);
  }
  // 额外登记一个 initial 模块（如名为 release 的模块，用于发布级报告与模块验收报告互不覆盖的用例）
  if (opts.extraInitialModule) {
    yaml.push(`  - id: ${opts.extraInitialModule}`, `    name: ${opts.extraInitialModule}`, '    lifecycle: initial', `    paths: ${JSON.stringify([`${opts.extraInitialModule}/**`])}`);
  }
  put(root, 'logos/logos-project.yaml', `${yaml.join('\n')}\n`);
  const docs = mod ? {
    'core-S01-test-cases.md': table(['UT-S01-01', 'UT-S01-02']),
    'core-S03-test-cases.md': table(['UT-S03-01', 'UT-S03-02']) + mainPathSection(['UT-S03-01']),
    'backend-S05-test-cases.md': table(['UT-S05-01', 'UT-S05-02']),
    'backend-S06-test-cases.md': table(['UT-S06-01']),
    'web-S07-test-cases.md': table(['UT-S07-01', 'UT-S07-02']),
  } : {
    'core-S01-test-cases.md': table(['UT-S01-01', 'UT-S01-02', 'UT-S01-03']),
    'core-S02-test-cases.md': table(['UT-S02-01', 'UT-S02-02']),
    'core-S03-test-cases.md': table(['UT-S03-01', 'UT-S03-02']) + mainPathSection(['UT-S03-01']),
    'core-S04-test-cases.md': table(['UT-S04-01 [manual]', 'UT-S04-02']),
  };
  Object.assign(docs, opts.docs ?? {});
  for (const [file, content] of Object.entries(docs)) put(root, `logos/resources/test/${file}`, content);
  put(root, 'tools/lv-runner.mjs', RUNNER);
  put(root, 'src/core.ts', 'export const core = 1;\n');
  if (mod) { put(root, 'backend/api.ts', 'export const api = 1;\n'); put(root, 'web/app.ts', 'export const app = 1;\n'); }
  put(root, '.gitignore', 'logos/.runtime/\nlogos/.openlogos-runtime/\n');
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  const head = git(root, ['rev-parse', 'HEAD']);

  const guardMode = opts.rel ? 'none' : (opts.guard ?? 'ok');
  let proposalDir = null;
  if (guardMode !== 'none') {
    proposalDir = join(root, 'logos/changes', SLUG);
    const target = opts.change?.target ?? (mod ? 'backend-S05-test-cases.md' : 'core-S01-test-cases.md');
    const owner = opts.owner ?? (mod ? 'backend' : 'core');
    const added = opts.change?.added ?? [mod ? 'UT-S05-03' : 'UT-S01-04'];
    const declaration = opts.declaration === undefined ? declarationYaml(mod ? { scenarios: [] } : {}) : opts.declaration;
    put(root, `logos/changes/${SLUG}/proposal.md`, proposalText(declaration));
    put(root, `logos/changes/${SLUG}/tasks.md`, opts.tasks ?? '# 实现任务\n\n## [code] 代码实现\n- [x] 实现\n');
    put(root, `logos/changes/${SLUG}/deltas/test/${target}`, `## ADDED — 新增用例\n\n${table(added)}`);
    if (opts.merged !== false) {
      const before = docs[target] ?? null;
      const after = before === null ? table(added) : `${before}\n${table(added)}`;
      put(root, `logos/resources/test/${target}`, after);
      put(root, `logos/changes/${SLUG}/SPEC_MERGED`, `${JSON.stringify({
        type: 'baseline_closure_spec_complete',
        test_change_set: opts.buildTestChangeSet({
          change: SLUG, module: owner,
          targets: [{ targetPath: `logos/resources/test/${target}`, beforeBytes: before === null ? null : Buffer.from(before), afterBytes: Buffer.from(after) }],
        }),
      }, null, 2)}\n`);
    }
    if (mod) put(root, 'backend/api.ts', 'export const api = 2;\n');
    put(root, 'logos/.openlogos-guard', JSON.stringify({
      activeChange: SLUG, module: owner, createdAt: '2026-11-27T00:00:00.000Z',
      ...(guardMode === 'ok' ? { baseRef: head } : guardMode === 'bad-base' ? { baseRef: '0123456789abcdef0123456789abcdef01234567' } : {}),
    }, null, 2));
  }
  for (const [rel, content] of Object.entries(opts.changes ?? {})) put(root, rel, content);
  if (opts.commitAll) { git(root, ['add', '-A']); git(root, ['commit', '-qm', 'proposal']); }
  if (opts.git === false) rmSync(join(root, '.git'), { recursive: true, force: true });
  const fixture = { root, outside, log: join(outside, 'calls.jsonl'), scriptPath: join(outside, 'script.json'), proposalDir, mod };
  setScript(fixture, { mode: opts.mode ?? 'narrow', ...(opts.script ?? {}) });
  return fixture;
}

export function setScript(f, script) {
  writeFileSync(f.scriptPath, JSON.stringify(script));
  rmSync(f.log, { force: true });
}

/** 提交工作区的全部改动，返回新的 HEAD。 */
export function commitAll(f, message = 'change') {
  git(f.root, ['add', '-A']);
  git(f.root, ['commit', '-q', '--allow-empty', '-m', message]);
  return git(f.root, ['rev-parse', 'HEAD']);
}

export function setDeclaration(f, body) {
  put(f.root, `logos/changes/${SLUG}/proposal.md`, proposalText(body));
}

export function readCalls(f) {
  return existsSync(f.log) ? readFileSync(f.log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}

export function destroyLv(f) {
  rmSync(f.root, { recursive: true, force: true });
  rmSync(f.outside, { recursive: true, force: true });
}

/** 子进程环境：去掉父进程的 OPENLOGOS_VERIFY_* / LV_*，注入剧本与调用记录路径。 */
export function lvEnv(f, extra = {}) {
  const env = { ...isolatedProcessEnv(), ...GIT_ENV, NO_COLOR: '1' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('OPENLOGOS_VERIFY_') || key.startsWith('OPENLOGOS_TEST_') || key.startsWith('LV_')) delete env[key];
  }
  Object.assign(env, { LV_LOG: f.log, LV_SCRIPT: f.scriptPath }, extra);
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return env;
}

/** 以真实 CLI 子进程执行 verify；返回退出码、JSON data、调用记录与报告。 */
export function runVerify(cliEntry, f, { args = ['--format', 'json'], env = {} } = {}) {
  rmSync(f.log, { force: true });
  const r = spawnSync(process.execPath, [resolve(cliEntry), 'verify', ...args], {
    cwd: f.root, encoding: 'utf8', timeout: 120_000, env: lvEnv(f, env),
  });
  let envelope = null;
  const line = (r.stdout ?? '').split('\n').reverse().find(l => l.trim().startsWith('{'));
  try { envelope = line ? JSON.parse(line) : null; } catch { /* 文本模式 */ }
  const reportPath = join(f.root, 'logos/resources/verify/acceptance-report.md');
  return {
    status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', envelope, data: envelope?.data ?? null,
    calls: readCalls(f),
    report: existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : null,
  };
}

/** 去掉随调用变化的值（时间、日期、临时路径、耗时、提交号）。 */
export function normalizer(f) {
  return text => {
    let out = text;
    for (const dir of [f.root, f.outside]) out = out.split(dir).join('<DIR>');
    out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TIME>');
    out = out.replace(/on \d{4}-\d{2}-\d{2}/g, 'on <DATE>');
    out = out.replace(/\b[0-9a-f]{40}\b/g, '<COMMIT>');
    out = out.replace(/"(duration_ms|elapsed_ms|durationMs)":\s*\d+/g, '"$1":"<N>"');
    return normalizeDefaultSandboxRoot(out);
  };
}

/** 归一化一次运行，供与引入前 golden 比对：剔除 history（含 run_id）与本提案新增的 level。 */
export function normalizeRun(f, run) {
  const norm = normalizer(f);
  const envelope = run.envelope ? { ...run.envelope } : null;
  if (envelope) { delete envelope.version; delete envelope.timestamp; }
  if (envelope?.data && typeof envelope.data === 'object') {
    envelope.data = { ...envelope.data };
    delete envelope.data.history;
    delete envelope.data.level;
  }
  return {
    status: run.status,
    envelope: envelope ? JSON.parse(norm(JSON.stringify(envelope))) : null,
    calls: JSON.parse(norm(JSON.stringify(run.calls))),
    report: run.report === null ? null : norm(run.report),
  };
}

/**
 * UT-S13-218 的观测：夹具 LV 设 enabled: false（文档仍有主链路小节、提案仍有受影响场景段），其中 UT-S02-01 失败一次。
 * 只依赖 CLI 入口，对引入前、引入后的构建都能运行（引入前的 CLI 忽略 verify.layered）。
 */
export function observeDisabledFixture(cliEntry, buildTestChangeSet) {
  const result = {};
  const arms = {
    'all-pass': {},
    'one-failure': { cases: { 'UT-S02-01': 'fail' } },
  };
  for (const [name, script] of Object.entries(arms)) {
    const f = createLv({ layered: { enabled: false }, buildTestChangeSet, script, verify: { rerun_failed: { enabled: false } } });
    try {
      result[name] = normalizeRun(f, runVerify(cliEntry, f));
    } finally {
      destroyLv(f);
    }
  }
  return result;
}

if (process.argv[1] && process.argv[1].endsWith('s13-layered-fixture.mjs') && process.argv[2] && process.argv[3]) {
  const lib = await import(pathToFileURL(resolve(dirname(process.argv[2]), 'lib/test-change-set.js')).href);
  const out = observeDisabledFixture(process.argv[2], lib.buildTestChangeSet);
  writeFileSync(process.argv[3], `${JSON.stringify(out, null, 2)}\n`);
  console.log(`golden written: ${process.argv[3]}`);
}
