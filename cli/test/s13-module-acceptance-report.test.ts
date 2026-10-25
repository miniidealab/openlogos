/**
 * S13 多模块项目模块验收报告（module-scoped-phase-reports，功能规格 §2.99.2、§2.99.5、§2.99.9，
 * spec/test-results.md「多模块项目的模块验收报告与模块冒烟报告」）。
 *
 * 夹具 MV：一次性 git 项目，core（launched，src/**）、team（initial，team/**）、portal（initial，portal/**）；
 * 测试规格 core-S01（UT-S01-01/02）、team-S60（UT-S60-01/02）、portal-S70（UT-S70-01）与全局 shared-S90（UT-S90-01）。
 * 记录型运行器 tools/rec.cjs：按 OPENLOGOS_VERIFY_MODULES（缺省全部）写所负责模块用例 + 全局用例的结果；
 * REC_FAIL / REC_OMIT 为逗号分隔的失败 / 不输出 ID；REC_EXIT_<label> 为该标签写完结果后的退出码；
 * REC_EXTRA 为追加的原始 JSONL 行。CLI 用例以真实 dist 入口子进程执行（global-setup 已构建）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyReportAllowPaths, writeModuleAcceptanceReports } from '../src/commands/verify.js';
import { readVerifyConfig } from '../src/lib/verify-config.js';
import { testFileInScope, moduleIdsOf } from '../src/lib/verify-scope.js';
import { isModuleReportComplete, readSummaryRows } from '../src/lib/module-phase-report.js';
import { collectStatusData } from '../src/commands/status.js';
import { buildInitialPhasePlan } from '../src/lib/flow-derive.js';

vi.setConfig({ testTimeout: 60_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const VERIFY = 'logos/resources/verify';
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'mr', GIT_AUTHOR_EMAIL: 'mr@example.invalid', GIT_COMMITTER_NAME: 'mr', GIT_COMMITTER_EMAIL: 'mr@example.invalid',
  GIT_AUTHOR_DATE: '2026-10-25T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-25T00:00:00Z',
};
const TESTS: Record<string, string[]> = {
  'core-S01-test-cases.md': ['UT-S01-01', 'UT-S01-02'],
  'team-S60-test-cases.md': ['UT-S60-01', 'UT-S60-02'],
  'portal-S70-test-cases.md': ['UT-S70-01'],
  'shared-S90-test-cases.md': ['UT-S90-01'],
};
const RECORDER = `'use strict';
const fs = require('fs'); const path = require('path');
const label = process.argv[2] || 'project';
const OWN = { core: ['UT-S01-01', 'UT-S01-02'], team: ['UT-S60-01', 'UT-S60-02'], portal: ['UT-S70-01'] };
const mods = String(process.env.OPENLOGOS_VERIFY_MODULES || '').split(',').filter(Boolean);
const parts = mods.length ? mods : Object.keys(OWN);
const ids = [...parts.flatMap(p => OWN[p] || []), 'UT-S90-01'];
const list = k => String(process.env[k] || '').split(',').filter(Boolean);
const fail = new Set(list('REC_FAIL')); const omit = new Set(list('REC_OMIT'));
const now = new Date().toISOString();
const rows = ids.filter(id => !omit.has(id)).map(id => fail.has(id)
  ? JSON.stringify({ id, status: 'fail', timestamp: now, error: 'fixture failure: expected PASS' })
  : JSON.stringify({ id, status: 'pass', timestamp: now }));
if (process.env.REC_EXTRA && label === 'project') rows.push(...process.env.REC_EXTRA.split('\\n').filter(Boolean));
const out = path.join(process.cwd(), 'logos/resources/verify/test-results.jsonl');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.appendFileSync(out, rows.join('\\n') + (rows.length ? '\\n' : ''));
const code = process.env['REC_EXIT_' + label];
if (code) process.exit(Number(code));
`;

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });

function put(root: string, rel: string, content: string) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
function git(root: string, args: string[]) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
}
const table = (ids: string[]) => ['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} 夹具用例 |`)].join('\n') + '\n';

interface ProjectOpts {
  lifecycles?: Record<string, 'initial' | 'launched'>;
  paths?: boolean;
  teamCommand?: boolean;
  tests?: Record<string, string[]>;
  singleModule?: boolean;
}
function project(opts: ProjectOpts = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-mar-'));
  roots.push(root);
  const life = { core: 'launched', team: 'initial', portal: 'initial', ...(opts.lifecycles ?? {}) };
  const mods = opts.singleModule ? ['core'] : ['core', 'team', 'portal'];
  const pathOf: Record<string, string> = { core: 'src/**', team: 'team/**', portal: 'portal/**' };
  put(root, 'logos/logos.config.json', JSON.stringify({
    name: 'mar', locale: 'en', description: '', documents: {},
    verify: {
      result_path: 'logos/resources/verify/test-results.jsonl',
      pre_run_command: 'node tools/rec.cjs project',
      sandbox_mode: 'off',
      ...(opts.teamCommand ? { modules: { team: { pre_run_command: 'node tools/rec.cjs team' } } } : {}),
    },
  }, null, 2));
  const yaml = ['project:', '  name: mar', 'modules:'];
  for (const m of mods) {
    yaml.push(`  - id: ${m}`, `    name: ${m}`, `    lifecycle: ${opts.singleModule ? 'initial' : life[m as keyof typeof life]}`);
    if (opts.paths !== false) yaml.push(`    paths: ["${pathOf[m]}"]`);
  }
  put(root, 'logos/logos-project.yaml', `${yaml.join('\n')}\n`);
  for (const [file, ids] of Object.entries(opts.tests ?? TESTS)) put(root, `logos/resources/test/${file}`, table(ids));
  put(root, 'tools/rec.cjs', RECORDER);
  put(root, 'src/a.ts', 'a\n'); put(root, 'team/a.ts', 'a\n'); put(root, 'portal/a.ts', 'a\n');
  put(root, '.gitignore', 'logos/.runtime/\n');
  git(root, ['init', '-q']); git(root, ['add', '-A']); git(root, ['commit', '-qm', 'init']);
  return root;
}
function addProposal(root: string, module = 'core', deltas: Record<string, string> = {}) {
  const slug = 'mar-demo';
  put(root, `logos/changes/${slug}/proposal.md`, `# 变更提案：${slug}\n\n> module: ${module} | created: 2026-10-25\n\n## 变更原因\n夹具。\n`);
  put(root, `logos/changes/${slug}/tasks.md`, '# 实现任务\n\n## [code] 代码实现\n- [x] 改代码\n');
  for (const [rel, content] of Object.entries(deltas)) put(root, `logos/changes/${slug}/deltas/${rel}`, content);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  put(root, 'logos/.openlogos-guard', JSON.stringify({ activeChange: slug, module, createdAt: '2026-10-25T00:00:00.000Z', baseRef: head }));
}
function runVerify(root: string, args: string[] = [], env: Record<string, string> = {}) {
  rmSync(join(root, VERIFY, 'test-results.jsonl'), { force: true });
  const r = spawnSync(process.execPath, [CLI, 'verify', '--format', 'json', ...args], {
    cwd: root, encoding: 'utf8', timeout: 120_000,
    env: { ...process.env, ...GIT_ENV, OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS: '', OPENLOGOS_VERIFY_MODULES: '', NO_COLOR: '1', ...env },
  });
  let data: any = null;
  try { data = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop() ?? '').data; } catch { /* 错误路径 */ }
  return { status: r.status, data, stdout: r.stdout, stderr: r.stderr };
}
const reportOf = (root: string, m: string) => {
  const p = join(root, VERIFY, `${m}-acceptance-report.md`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const rows = (root: string, m: string) => readSummaryRows(reportOf(root, m) ?? '');
const gateOf = (root: string, m: string) => rows(root, m).get('Gate 3.5');

describe('S13 多模块项目模块验收报告（module-scoped-phase-reports）', () => {
  it('UT-S13-122: 模块用例子集 U(m) 与 M={m} 同判据', () => {
    const root = project();
    addProposal(root, 'core', {
      'test/core-S01-test-cases.md': `## MODIFIED — 测试\n\n${table(['UT-S01-01', 'UT-S01-02'])}`,
      'test/team-S60-test-cases.md': `## MODIFIED — 测试\n\n${table(['UT-S60-01', 'UT-S60-02'])}`,
    });
    // 文件判据与 M={m} 的 testFileInScope 一致
    const ids = moduleIdsOf(root);
    for (const m of ['team', 'portal']) {
      const scope = { mode: 'module', modules: [m] } as any;
      expect(Object.keys(TESTS).filter(f => testFileInScope(f, scope, ids)).sort())
        .toEqual(Object.keys(TESTS).filter(f => f.startsWith(`${m}-`) || f.startsWith('shared-')).sort());
    }
    // core 前缀规格中的变更用例 UT-S01-02 缺结果，不影响 initial 模块的报告；team 自己缺 UT-S60-02 则未覆盖
    runVerify(root, ['--all'], { REC_OMIT: 'UT-S01-02,UT-S60-02' });
    expect(rows(root, 'team').get('Defined cases')).toBe('3');
    expect(rows(root, 'portal').get('Defined cases')).toBe('2');
    expect(reportOf(root, 'team')).toContain('- UT-S60-02');
    expect(reportOf(root, 'team')).not.toContain('UT-S01-02');
    expect(reportOf(root, 'portal')).not.toContain('UT-S01-02');
    expect(gateOf(root, 'portal')).toBe('PASS');
    expect(gateOf(root, 'team')).toBe('FAIL');
  });

  it('UT-S13-122（code-r1 F2）: 切片 eligible 子集不裁剪 U(m)，未测完不得发布模块 PASS', () => {
    const root = project();
    const write = (ids: string[]) => writeFileSync(join(root, VERIFY, 'test-results.jsonl'),
      ids.map(id => JSON.stringify({ id, status: 'pass', timestamp: '2026-10-25T00:00:00Z' })).join('\n') + '\n');
    mkdirSync(join(root, VERIFY), { recursive: true });
    write(['UT-S60-01']);
    const slice = { manifest_status: 'valid', verify_mode: 'slice-checkpoint', eligible_test_ids: ['UT-S60-01'] } as any;
    const ok = { consistency: { ok: true } } as any;
    const noPreRun = { commands: [] } as any;
    const sandboxPass = { status: 'pass', diagnostics: [] } as any;
    writeModuleAcceptanceReports(root, ok, noPreRun, sandboxPass, { scope: null, inScope: null }, slice);
    expect(rows(root, 'team').get('Defined cases')).toBe('3'); // 完整 U(team) = UT-S60-01、UT-S60-02、UT-S90-01
    expect(rows(root, 'team').get('Uncovered')).toBe('2');
    expect(reportOf(root, 'team')).toMatch(/## Uncovered Cases[\s\S]*- UT-S60-02/);
    expect(gateOf(root, 'team')).toBe('FAIL');
    expect(isModuleReportComplete(root, 'team', 'acceptance')).toBe(false);
    // 完整模块覆盖后才允许通过
    write(['UT-S60-01', 'UT-S60-02', 'UT-S90-01', 'UT-S70-01']);
    writeModuleAcceptanceReports(root, ok, noPreRun, sandboxPass, { scope: null, inScope: null }, slice);
    expect(gateOf(root, 'team')).toBe('PASS');
    expect(isModuleReportComplete(root, 'team', 'acceptance')).toBe(true);
  });

  it('UT-S13-123: 子集为空不写', () => {
    const root = project({ tests: { 'core-S01-test-cases.md': TESTS['core-S01-test-cases.md'], 'team-S60-test-cases.md': TESTS['team-S60-test-cases.md'] } });
    put(root, `${VERIFY}/portal-acceptance-report.md`, 'OLD PORTAL REPORT\n');
    const before = statSync(join(root, VERIFY, 'portal-acceptance-report.md')).mtimeMs;
    runVerify(root, ['--all'], { REC_OMIT: 'UT-S70-01,UT-S90-01' }); // 运行器不输出已删除规格的结果
    expect(reportOf(root, 'portal')).toBe('OLD PORTAL REPORT\n');
    expect(statSync(join(root, VERIFY, 'portal-acceptance-report.md')).mtimeMs).toBe(before);
    expect(gateOf(root, 'team')).toBe('PASS');
  });

  it('UT-S13-124: 覆盖的模块——未启用 / all / fallback-full 写全部 initial 模块，module 模式只写 M', () => {
    const written = (root: string) => ['core', 'team', 'portal'].filter(m => reportOf(root, m) !== null);
    // ① 未启用（无 paths）
    const r1 = project({ paths: false });
    expect(runVerify(r1).data.scope).toBeUndefined();
    expect(written(r1)).toEqual(['team', 'portal']);
    // ② --all
    const r2 = project();
    expect(runVerify(r2, ['--all']).data.scope.mode).toBe('all');
    expect(written(r2)).toEqual(['team', 'portal']);
    // ③ fallback-full：提案改动共享配置
    const r3 = project();
    addProposal(r3, 'core');
    put(r3, 'logos/logos.config.json', readFileSync(join(r3, 'logos/logos.config.json'), 'utf8').replace('"description": ""', '"description": "x"'));
    expect(runVerify(r3).data.scope.mode).toBe('fallback-full');
    expect(written(r3)).toEqual(['team', 'portal']);
    // ④ module：M={core, team}，portal 旧报告不动
    const r4 = project();
    put(r4, `${VERIFY}/portal-acceptance-report.md`, 'OLD\n');
    addProposal(r4, 'core');
    put(r4, 'team/a.ts', 'changed\n');
    const d4 = runVerify(r4).data;
    expect(d4.scope.mode).toBe('module');
    expect(d4.scope.modules).toEqual(['core', 'team']);
    expect(written(r4)).toEqual(['team', 'portal']);
    expect(reportOf(r4, 'portal')).toBe('OLD\n');
    expect(gateOf(r4, 'team')).toBe('PASS');
  });

  it('UT-S13-125: 只写 initial 模块，单模块项目不写', () => {
    const launchedOnly = project({ lifecycles: { team: 'launched', portal: 'launched' } });
    const d = runVerify(launchedOnly, ['--all']).data;
    expect(['core', 'team', 'portal'].map(m => reportOf(launchedOnly, m))).toEqual([null, null, null]);
    expect(d.gate.result).toBe('PASS');
    expect(readFileSync(join(launchedOnly, VERIFY, 'acceptance-report.md'), 'utf8')).not.toContain('| Module |');

    const single = project({ singleModule: true });
    const s = runVerify(single);
    expect(s.data.scope).toBeUndefined();
    expect(reportOf(single, 'core')).toBeNull();
    expect(readFileSync(join(single, VERIFY, 'acceptance-report.md'), 'utf8')).not.toContain('| Module |');
  });

  it('UT-S13-126: 报告格式——「模块」行与按子集统计', () => {
    const root = project();
    const run = runVerify(root, ['--all'], { REC_FAIL: 'UT-S60-02' });
    const team = reportOf(root, 'team')!;
    expect(team.startsWith('# Acceptance Report')).toBe(true);
    expect(rows(root, 'team').get('Module')).toBe('team');
    expect(rows(root, 'team').get('Defined cases')).toBe('3');
    expect(rows(root, 'team').get('Failed')).toBe('1');
    expect(team).toMatch(/## Failed Cases[\s\S]*\| UT-S60-02 \|/);
    expect(team).not.toMatch(/\| UT-S01-0\d \|/);
    expect(gateOf(root, 'team')).toBe('FAIL');
    expect(rows(root, 'portal').get('Defined cases')).toBe('2');
    expect(gateOf(root, 'portal')).toBe('PASS');
    expect(isModuleReportComplete(root, 'portal', 'acceptance')).toBe(true);
    expect(run.data.gate.result).toBe('FAIL');
    // verify JSON 不新增模块报告字段
    expect(JSON.stringify(run.data)).not.toContain('team-acceptance-report');
  });

  it('UT-S13-127: 共享预跑非零退出计入每个模块', () => {
    const root = project({ paths: false });
    const run = runVerify(root, [], { REC_EXIT_project: '1' });
    expect(run.data.gate.result).toBe('FAIL');
    expect(run.data.gate.reason).toBe('pre_run_failed');
    for (const m of ['team', 'portal']) {
      expect(gateOf(root, m)).toBe('FAIL');
      expect(reportOf(root, m)).toMatch(/## Run-level Rejections[\s\S]*not attributable to a module/);
    }
  });

  it('UT-S13-128: 命令组归属——只计入其服务的模块', () => {
    const root = project({ teamCommand: true });
    const run = runVerify(root, ['--all'], { REC_EXIT_project: '1' });
    const projectGroup = run.data.pre_run.commands.find((c: any) => c.modules?.includes('portal'));
    expect(projectGroup.modules).toEqual(['core', 'portal']);
    expect(projectGroup.status).toBe('fail');
    expect(gateOf(root, 'portal')).toBe('FAIL');
    expect(gateOf(root, 'team')).toBe('PASS');
    expect(run.data.gate.result).toBe('FAIL');
  });

  it('UT-S13-129: 沙箱失败、账本不自洽、未定义 ID 计入每个模块；写入在改判之后', () => {
    // ② 账本不自洽（缺 status 的非法行）与 ③ 未定义 ID：真实 CLI
    for (const extra of ['{"id":"UT-S60-01","timestamp":"2026-10-25T00:00:00Z"}', '{"id":"UT-S99-01","status":"pass","timestamp":"2026-10-25T00:00:00Z"}']) {
      const root = project();
      const run = runVerify(root, ['--all'], { REC_EXTRA: extra });
      expect(run.data.consistency.ok).toBe(false);
      for (const m of ['team', 'portal']) {
        expect(gateOf(root, m)).toBe('FAIL');
        expect(reportOf(root, m)).toContain('result_ledger_inconsistent');
      }
    }
    // ① 沙箱失败：子集全部通过，沙箱判定失败 → 所有被覆盖模块 FAIL，且报告只写一次（内容即 FAIL）
    const root = project();
    runVerify(root, ['--all']);
    expect(gateOf(root, 'team')).toBe('PASS');
    const config = readVerifyConfig(root);
    const data = { consistency: { ok: true } } as any;
    const preRun = { commands: [{ stage: 'pre_run', status: 'pass', modules: ['core', 'team', 'portal'] }] } as any;
    const sandbox = { status: 'fail', diagnostics: ['sandbox write outside allowlist'] } as any;
    expect(config.resultPath).toBe('logos/resources/verify/test-results.jsonl');
    const written = writeModuleAcceptanceReports(root, data, preRun, sandbox, { scope: null, inScope: null }, null);
    expect(written).toEqual([`${VERIFY}/team-acceptance-report.md`, `${VERIFY}/portal-acceptance-report.md`]);
    for (const m of ['team', 'portal']) {
      expect(gateOf(root, m)).toBe('FAIL');
      expect(reportOf(root, m)).toContain('sandbox_failed: sandbox write outside allowlist');
    }
    // verify 主流程中写入点位于沙箱改判之后（只写一次、无先 PASS 后改判的中间态）
    const src = readFileSync(resolve(HERE, '../src/commands/verify.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function verify('));
    expect(body.indexOf('writeModuleAcceptanceReports(root, data')).toBeGreaterThan(body.indexOf("if (sandbox.status === 'fail' && data.gate.result === 'PASS')"));
    expect(body.split('writeModuleAcceptanceReports(').length - 1).toBe(1);
    // 原子发布：目录中不残留临时文件
    expect(readdirNames(join(root, VERIFY)).filter(n => n.includes('.tmp-'))).toEqual([]);
  });

  it('UT-S13-130: Gate 判定前中止不写', () => {
    const noCases = project();
    for (const f of Object.keys(TESTS)) rmSync(join(noCases, 'logos/resources/test', f));
    const r1 = runVerify(noCases, ['--all']);
    expect(r1.status).not.toBe(0);
    expect(r1.stderr).toContain('NO_TEST_CASES');
    // 未配置预跑命令且结果文件不存在 → NO_TEST_RESULTS（配置了预跑时 verify 会先建空结果文件、照常算出 Gate）
    const noResults = project({ paths: false });
    put(noResults, 'logos/logos.config.json', readFileSync(join(noResults, 'logos/logos.config.json'), 'utf8').replace('"pre_run_command": "node tools/rec.cjs project",', ''));
    const r2 = runVerify(noResults);
    expect(r2.status).not.toBe(0);
    expect(r2.stderr).toContain('NO_TEST_RESULTS');
    for (const root of [noCases, noResults]) for (const m of ['core', 'team', 'portal']) expect(reportOf(root, m)).toBeNull();
  });

  it('UT-S13-131（code-r1 F3 / code-r3 F3）: verify 结果路径落在模块报告保留路径时不调用按原配置写结果的 runner，保留路径零写入', () => {
    // runner 按约定读取 logos/logos.config.json 中的 verify.result_path（或 regression_result_path）并写入一条 pass，同时记录被调用
    const CFG_RUNNER = `const fs = require('fs'); const path = require('path');
const field = process.argv[2] || 'result_path';
const cfg = JSON.parse(fs.readFileSync('logos/logos.config.json', 'utf8')).verify;
fs.appendFileSync(path.join(path.dirname(process.cwd()), path.basename(process.cwd()) + '.runner-calls'), field + '\\n');
const out = cfg[field] || cfg.result_path;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.appendFileSync(out, JSON.stringify({ id: 'UT-S60-01', status: 'pass', timestamp: new Date().toISOString() }) + '\\n');
`;
    const target = `${VERIFY}/team-deployment-report.md`;
    for (const [key, field] of [['verify.result_path', 'result_path'], ['verify.regression_result_path', 'regression_result_path']] as const) {
      const root = project();
      const calls = join(dirname(root), `${root.split('/').pop()}.runner-calls`);
      roots.push(calls);
      put(root, 'tools/cfg.cjs', CFG_RUNNER);
      const cfgPath = join(root, 'logos/logos.config.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      cfg.verify[field] = target;
      if (field === 'regression_result_path') cfg.verify.regression_command = 'node tools/cfg.cjs regression_result_path';
      else cfg.verify.pre_run_command = 'node tools/cfg.cjs result_path';
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      const r = runVerify(root, ['--all']);
      expect(r.data, key).not.toBeNull(); // 照常输出 verify 信封（既有失败契约），不以新增错误码退出
      expect(existsSync(calls), key).toBe(false); // runner 未被调用
      expect(existsSync(join(root, target)), key).toBe(false); // 整个调用期间保留路径未创建
      expect(r.data.gate, key).toMatchObject({ result: 'FAIL', reason: 'pre_run_failed' });
      expect(r.data.pre_run.commands.length, key).toBeGreaterThan(0);
      for (const c of r.data.pre_run.commands) {
        expect(c.status, key).toBe('fail');
        expect(c.error, key).toContain(target);
        expect(c.exit_code, key).toBeUndefined(); // 未执行
      }
      expect(r.data.pre_run.diagnostics.join('\n'), key).toContain(`${key} points to ${target}`);
      expect(isModuleReportComplete(root, 'team', 'deployment'), key).toBe(false);
      expect(gateOf(root, 'team'), key).toBe('FAIL'); // 无法归属的预跑失败计入每个模块
    }
  });

  it('UT-S13-131: 写入白名单含模块验收报告', () => {
    const root = project();
    const allow = verifyReportAllowPaths(root, readVerifyConfig(root));
    expect(allow.has(`${VERIFY}/team-acceptance-report.md`)).toBe(true);
    expect(allow.has(`${VERIFY}/portal-acceptance-report.md`)).toBe(true);
    expect(allow.has(`${VERIFY}/core-acceptance-report.md`)).toBe(false); // launched 模块不写
    expect(allow.has(`${VERIFY}/acceptance-report.md`)).toBe(true);
    expect(allow.has(`${VERIFY}/smoke-report.md`)).toBe(false); // 未列入路径仍被拒绝
    const single = project({ singleModule: true });
    expect([...verifyReportAllowPaths(single, readVerifyConfig(single))].sort())
      .toEqual([`${VERIFY}/acceptance-report.md`, 'logos/resources/verify/test-results.jsonl'].sort());
  });
});

function readdirNames(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}

function writeTeamArtifacts(root: string, moduleId: string) {
  for (const item of buildInitialPhasePlan()) {
    if (['phase.3-6', 'phase.3-7-deploy', 'phase.3-8-smoke'].includes(item.phaseKey)) continue;
    if (item.phaseKey === 'phase.3-1') put(root, `${item.subpath}/${moduleId}-S60-x.md`, 'x');
    else if (item.phaseKey === 'phase.3-4a') continue; // 测试规格已由夹具提供
    else put(root, `${item.subpath}/${moduleId}-x.md`, 'x');
  }
}

describe('S13 多模块项目模块验收报告端到端（module-scoped-phase-reports）', () => {
  it('ST-S13-33: fallback-full 为每个 initial 模块写报告，可归属的失败互不影响', () => {
    const root = project({ teamCommand: true });
    // 场景覆盖：team / portal 各一个场景，测试规格文件名已含 S60 / S70
    const yaml = readFileSync(join(root, 'logos/logos-project.yaml'), 'utf8')
      + 'scenarios:\n  - id: S60\n    name: t\n    module: team\n  - id: S70\n    name: p\n    module: portal\n';
    put(root, 'logos/logos-project.yaml', yaml);
    writeTeamArtifacts(root, 'team');
    writeTeamArtifacts(root, 'portal');
    put(root, 'logos/resources/prd/3-technical-plan/2-scenario-implementation/portal-S70-x.md', 'x');
    git(root, ['add', '-A']); git(root, ['commit', '-qm', 'artifacts']);
    addProposal(root, 'core');
    put(root, 'logos/logos.config.json', readFileSync(join(root, 'logos/logos.config.json'), 'utf8').replace('"description": ""', '"description": "x"'));
    // ① 两组命令都退出 0，portal 的 UT-S70-01 失败
    const r1 = runVerify(root, [], { REC_FAIL: 'UT-S70-01' });
    expect(r1.data.scope.mode).toBe('fallback-full');
    expect(gateOf(root, 'team')).toBe('PASS');
    expect(gateOf(root, 'portal')).toBe('FAIL');
    expect(r1.data.gate.result).toBe('FAIL');
    // ② 全部通过
    runVerify(root);
    expect(gateOf(root, 'team')).toBe('PASS');
    expect(gateOf(root, 'portal')).toBe('PASS');
    // ③ status：两个 initial 模块的 phase.3-6 均为 done
    const mods = collectStatusData(root).modules!;
    for (const m of ['team', 'portal']) expect(mods.find(x => x.id === m)!.phase_progress!['phase.3-6'].done).toBe(true);
  });

  it('ST-S13-34: 共享 runner 非零退出时所有模块 FAIL', () => {
    const root = project({ paths: false });
    const run = runVerify(root, [], { REC_EXIT_project: '1' });
    expect(run.status).not.toBe(0);
    expect(run.data.gate.reason).toBe('pre_run_failed');
    for (const m of ['team', 'portal']) expect(gateOf(root, m)).toBe('FAIL');
    const mods = collectStatusData(root).modules!;
    for (const m of ['team', 'portal']) expect(mods.find(x => x.id === m)!.phase_progress!['phase.3-6'].done).toBe(false);
  });
});
