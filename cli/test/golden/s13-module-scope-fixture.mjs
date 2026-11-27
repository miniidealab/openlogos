/**
 * module-scoped-verify 夹具（S13「S13 按模块限定 verify 范围测试」夹具口径）。
 *
 * 一次性 git 项目：logos-project.yaml 登记模块（缺省 core: src/**、portal-web: portal-web/**），测试规格
 * core-S01（UT-S01-01/02）、portal-web-S50（UT-S50-01/02）与全局 shared-S90（UT-S90-01）；logos.config.json 的
 * 项目级 pre_run_command 与 verify.modules.<id>.pre_run_command 都调用同一个「记录型运行器」tools/rec.cjs，
 * 参数分别为 project / core / portal-web。运行器把自身参数、OPENLOGOS_VERIFY_MODULES 与
 * OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS 追加到项目外调用日志（MSV_LOG），并写本轮结果行：
 *   - 结果行只含该参数负责的用例（project = 全部）；注入了 eligible 时只写 eligible 内的用例（真实 runner 口径）；
 *   - MSV_CORE_FAIL=1：负责 core 用例的那次把 UT-S01-01 写为 fail；
 *   - MSV_EMIT_FOREIGN=1：参数为 portal-web 的那次额外输出 core 用例 UT-S01-01 的 fail 行；
 *   - MSV_EXTRA_ROWS=<JSON 数组>：负责 portal-web 用例的那次（portal-web / project）追加这些行；
 *   - MSV_CORE_EXIT=<n>：负责 core 用例的那次写完结果后以退出码 n 结束。
 * 参数也可写成 `modules`（按 OPENLOGOS_VERIFY_MODULES 决定负责的模块）或 `<base>@<stage>`（区分两阶段调用）。
 * 本模块同时被测试与 golden 生成器使用（node test/golden/s13-module-scope-fixture.mjs <dist/index.js> <out.json>），
 * 生成器以改动前构建的 CLI 运行 observeDisabledFixtures，供 UT-S13-104 / ST-S13-30 逐字比对。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { normalizeDefaultSandboxRoot } from './normalize-default-sandbox-root.mjs';

export const GIT_ENV = {
  GIT_AUTHOR_NAME: 'msv', GIT_AUTHOR_EMAIL: 'msv@example.invalid',
  GIT_COMMITTER_NAME: 'msv', GIT_COMMITTER_EMAIL: 'msv@example.invalid',
  GIT_AUTHOR_DATE: '2026-10-18T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-18T00:00:00Z',
};

export const DEFAULT_TESTS = {
  'core-S01-test-cases.md': ['UT-S01-01', 'UT-S01-02'],
  'portal-web-S50-test-cases.md': ['UT-S50-01', 'UT-S50-02'],
  'shared-S90-test-cases.md': ['UT-S90-01'],
};

const RECORDER = `'use strict';
const fs = require('fs'); const path = require('path');
const label = process.argv[2] || 'project';
const OWN = {
  core: ['UT-S01-01', 'UT-S01-02'],
  'portal-web': ['UT-S50-01', 'UT-S50-02', 'UT-S90-01'],
};
// 参数形如 <base> 或 <base>@<stage>；base 为 project（全部模块）、modules（取 OPENLOGOS_VERIFY_MODULES）或模块 id
const base = label.split('@')[0];
const parts = base === 'project' ? Object.keys(OWN)
  : base === 'modules' ? String(process.env.OPENLOGOS_VERIFY_MODULES || '').split(',').filter(Boolean)
  : [base];
const ownIds = parts.flatMap(p => OWN[p] || []);
const eligibleRaw = process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
const eligible = eligibleRaw ? new Set(JSON.parse(eligibleRaw)) : null;
if (process.env.MSV_LOG) {
  fs.appendFileSync(process.env.MSV_LOG, JSON.stringify({
    label, modules: process.env.OPENLOGOS_VERIFY_MODULES ?? null, eligible: eligibleRaw ? JSON.parse(eligibleRaw) : null,
  }) + '\\n');
}
const now = new Date().toISOString();
const coversCore = parts.includes('core');
const coversPortal = parts.includes('portal-web');
const rows = ownIds.filter(id => !eligible || eligible.has(id)).map(id => {
  const fail = id === 'UT-S01-01' && coversCore && process.env.MSV_CORE_FAIL === '1';
  return fail ? { id, status: 'fail', timestamp: now, error: 'msv fixture failure' } : { id, status: 'pass', timestamp: now };
});
if (base === 'portal-web' && process.env.MSV_EMIT_FOREIGN === '1') rows.push({ id: 'UT-S01-01', status: 'fail', timestamp: now, error: 'foreign row' });
if (coversPortal && process.env.MSV_EXTRA_ROWS) for (const row of JSON.parse(process.env.MSV_EXTRA_ROWS)) rows.push({ timestamp: now, ...row });
const out = path.join(process.cwd(), 'logos/resources/verify/test-results.jsonl');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.appendFileSync(out, rows.map(r => JSON.stringify(r)).join('\\n') + (rows.length ? '\\n' : ''));
if (coversCore && process.env.MSV_CORE_EXIT) process.exit(Number(process.env.MSV_CORE_EXIT));
`;

export function put(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

export function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout.trim();
}

const table = ids => ['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具用例 |`)].join('\n') + '\n';

/**
 * 构造多模块项目并完成初始提交。
 * @param {object} opts
 * @param {Array<{id:string, paths?:unknown}>} [opts.modules]
 * @param {Record<string,string[]>} [opts.tests]
 * @param {boolean} [opts.moduleCommands] 是否配置 verify.modules（缺省 true）
 * @param {boolean} [opts.git] 是否 git init 并提交（缺省 true）
 */
export function createScopeProject(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-msv-'));
  const modules = opts.modules ?? [{ id: 'core', paths: ['src/**'] }, { id: 'portal-web', paths: ['portal-web/**'] }];
  const tests = opts.tests ?? DEFAULT_TESTS;
  const verifyModules = {};
  for (const m of modules) verifyModules[m.id] = { pre_run_command: `node tools/rec.cjs ${m.id}` };
  put(root, 'logos/logos.config.json', JSON.stringify({
    name: 'msv', locale: 'en', description: '', documents: {},
    verify: {
      result_path: 'logos/resources/verify/test-results.jsonl',
      pre_run_command: 'node tools/rec.cjs project',
      sandbox_mode: 'off',
      ...(opts.moduleCommands === false ? {} : { modules: verifyModules }),
    },
  }, null, 2));
  const yaml = ['project:', '  name: msv', 'modules:'];
  for (const m of modules) {
    yaml.push(`  - id: ${m.id}`, `    name: ${m.id}`, '    lifecycle: launched');
    if (m.paths !== undefined) yaml.push(`    paths: ${JSON.stringify(m.paths)}`);
  }
  put(root, 'logos/logos-project.yaml', `${yaml.join('\n')}\n`);
  for (const [file, ids] of Object.entries(tests)) put(root, `logos/resources/test/${file}`, table(ids));
  put(root, 'tools/rec.cjs', RECORDER);
  put(root, 'src/protocol.ts', 'export const v = 1;\n');
  put(root, 'portal-web/app.ts', 'export const app = 1;\n');
  put(root, '.gitignore', 'logos/.runtime/\nportal-web/dist/\n');
  if (opts.git !== false) {
    git(root, ['init', '-q']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'init']);
  }
  return root;
}

/** 写活跃提案（guard + proposal.md + tasks.md + deltas）。baseRef 为 undefined 时取当前 HEAD（无 git 时不写）。 */
export function addProposal(root, { slug = 'msv-demo', module = 'portal-web', deltas = {}, baseRef, tasks } = {}) {
  const dir = join(root, 'logos/changes', slug);
  put(root, `logos/changes/${slug}/proposal.md`, `# 变更提案：${slug}\n\n> module: ${module} | created: 2026-10-18\n\n## 变更原因\n夹具。\n`);
  put(root, `logos/changes/${slug}/tasks.md`, tasks ?? '# 实现任务\n\n## [code] 代码实现\n- [x] 改代码\n');
  for (const [rel, content] of Object.entries(deltas)) put(root, `logos/changes/${slug}/deltas/${rel}`, content);
  let ref = baseRef;
  if (ref === undefined) {
    const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root, encoding: 'utf8' });
    ref = r.status === 0 ? r.stdout.trim() : null;
  }
  put(root, 'logos/.openlogos-guard', JSON.stringify({
    activeChange: slug, module, createdAt: '2026-10-18T00:00:00.000Z', ...(ref ? { baseRef: ref } : {}),
  }, null, 2));
  return dir;
}

/** 以真实 CLI 子进程执行 verify --format json；返回 envelope、调用日志、报告与退出码。 */
export function runVerify(cliEntry, root, { args = [], env = {} } = {}) {
  const logDir = mkdtempSync(join(tmpdir(), 'openlogos-msv-log-'));
  const log = join(logDir, 'calls.jsonl');
  try {
    const r = spawnSync(process.execPath, [resolve(cliEntry), 'verify', '--format', 'json', ...args], {
      cwd: root, encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, ...GIT_ENV, OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS: '', NO_COLOR: '1', MSV_LOG: log, ...env },
    });
    let envelope = null;
    try { envelope = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop() ?? ''); } catch { /* 下方报告 */ }
    const reportPath = join(root, 'logos/resources/verify/acceptance-report.md');
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      envelope,
      data: envelope?.data ?? null,
      calls: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [],
      report: existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : null,
    };
  } finally {
    rmSync(logDir, { recursive: true, force: true });
  }
}

/** 去掉随调用变化的值（时间、日期、临时路径、耗时、提交号、信封 version/timestamp）。 */
export function normalizer(root) {
  const roots = [root, realpathSync(root)];
  return text => {
    let out = text;
    for (const r of roots) out = out.split(r).join('<ROOT>');
    out = out.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<TIME>');
    out = out.replace(/on \d{4}-\d{2}-\d{2}/g, 'on <DATE>');
    out = out.replace(/\b[0-9a-f]{40}\b/g, '<COMMIT>');
    out = out.replace(/"(duration_ms|elapsed_ms|durationMs)":\s*\d+/g, '"$1":"<N>"');
    return normalizeDefaultSandboxRoot(out);
  };
}

function normalizeRun(root, run) {
  const norm = normalizer(root);
  const env = run.envelope ? { ...run.envelope } : null;
  if (env) { delete env.version; delete env.timestamp; }
  // verification-history（§2.104.11）：verify JSON 除新增 data.history 外与引入前一致；history 含每次不同的 run_id，比较前剔除
  if (env && env.data && typeof env.data === 'object') { env.data = { ...env.data }; delete env.data.history; }
  // verify-flaky-rerun（§2.108.11）：0.16.26 起 data.rerun 恒输出，是引入后新增的字段，比较前剔除
  if (env && env.data && typeof env.data === 'object') delete env.data.rerun;
  return {
    status: run.status,
    envelope: env ? JSON.parse(norm(JSON.stringify(env))) : null,
    calls: run.calls,
    report: run.report === null ? null : norm(run.report),
  };
}

const TEST_DELTA = `## MODIFIED — 测试\n\n${table(['UT-S50-01', 'UT-S50-02'])}`;

/**
 * 未启用模块范围的四个夹具：UT-S13-104 三臂（单模块、无 paths、paths 均为 []）与 ST-S13-30。
 * 只依赖 CLI 入口，因此对改动前、改动后的构建都能运行。
 */
export function observeDisabledFixtures(cliEntry) {
  const arms = {
    'ut104-single-module': { modules: [{ id: 'core', paths: ['src/**'] }], owner: 'core', env: { MSV_CORE_FAIL: '1' } },
    'ut104-no-paths': { modules: [{ id: 'core' }, { id: 'portal-web' }], owner: 'portal-web', env: { MSV_CORE_FAIL: '1' } },
    'ut104-empty-paths': { modules: [{ id: 'core', paths: [] }, { id: 'portal-web', paths: [] }], owner: 'portal-web', env: { MSV_CORE_FAIL: '1' } },
    'st30-no-paths-spec-only': { modules: [{ id: 'core' }, { id: 'portal-web' }], owner: 'portal-web', env: {}, moduleCommands: false, merged: true },
  };
  const result = {};
  for (const [name, arm] of Object.entries(arms)) {
    const root = createScopeProject({ modules: arm.modules, moduleCommands: arm.moduleCommands });
    try {
      // verify-flaky-rerun：本组基线比较的是「模块范围未启用」与引入前一致；失败用例复跑（缺省开启）与模块范围正交，
      // 会让首跑失败的臂多调用一次 runner，故在这里关闭（旧版 CLI 忽略该字段，基线生成不受影响）
      const cfgPath = join(root, 'logos', 'logos.config.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      cfg.verify = { ...(cfg.verify ?? {}), rerun_failed: { enabled: false } };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      addProposal(root, { module: arm.owner, deltas: { 'test/portal-web-S50-test-cases.md': TEST_DELTA } });
      // ST-S13-30：模拟纯规格提案合并后的落盘（只改 portal-web 前缀的测试规格）
      if (arm.merged) put(root, 'logos/resources/test/portal-web-S50-test-cases.md', `${table(['UT-S50-01', 'UT-S50-02'])}\n<!-- merged -->\n`);
      result[name] = normalizeRun(root, runVerify(cliEntry, root, { env: arm.env }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
  return result;
}

if (process.argv[1] && process.argv[1].endsWith('s13-module-scope-fixture.mjs') && process.argv[2] && process.argv[3]) {
  const out = observeDisabledFixtures(process.argv[2]);
  writeFileSync(process.argv[3], `${JSON.stringify(out, null, 2)}\n`);
  console.log(`golden written: ${process.argv[3]}`);
}
