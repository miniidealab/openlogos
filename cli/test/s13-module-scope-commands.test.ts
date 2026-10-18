/**
 * module-scoped-verify 切片3：模块级测试命令的选择、去重、两阶段优先与失败归因（S13）。
 *
 * 覆盖 UT-S13-105、109、110、116、117、120 与 ST-S13-27、28、29、31、32
 * （logos/resources/test/core-S13-test-cases.md「S13 按模块限定 verify 范围测试」）。
 * 规范源：功能规格 §2.96.1「模块测试命令」、§2.96.4、§2.96.5；spec/test-results.md「按模块限定 verify 范围的运行约定
 * （module-scoped-verify）」中「执行哪些命令」「注入的环境变量」「结果收集与合并」。
 * CLI 用例以真实 dist 入口子进程执行（global-setup 已构建）；记录型运行器把每次调用的参数与 OPENLOGOS_VERIFY_MODULES
 * 写入调用日志，供断言执行了哪些命令组。结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSchema, validate } from '@hyperjump/json-schema/draft-07';
// @ts-expect-error 夹具为 ESM .mjs（与基线生成脚本共用），无类型声明
import { addProposal, createScopeProject, git, put, runVerify } from './golden/s13-module-scope-fixture.mjs';

vi.setConfig({ testTimeout: 60_000 });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../dist/index.js');
const REPO = resolve(HERE, '../..');
const RESULTS = 'logos/resources/verify/test-results.jsonl';

const roots: string[] = [];
afterEach(() => { while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true }); });
const project = (opts?: Record<string, unknown>): string => { const r = createScopeProject(opts) as string; roots.push(r); return r; };
type Run = { status: number; data: any; calls: Array<{ label: string; modules: string | null; eligible: string[] | null }>; report: string | null };
const verifyJson = (root: string, opts?: { args?: string[]; env?: Record<string, string> }) => runVerify(CLI, root, opts) as Run;
const labels = (run: Run) => run.calls.map(c => c.label);

/** 在建提案之前改写 logos.config.json 并提交，使之不计入本提案的改动文件。 */
function commitConfig(root: string, mutate: (cfg: any) => void): void {
  const path = join(root, 'logos/logos.config.json');
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  mutate(cfg);
  writeFileSync(path, JSON.stringify(cfg, null, 2));
  git(root, ['commit', '-qam', 'config']);
}
const STALE_ROW = `${JSON.stringify({ id: 'UT-S01-01', status: 'fail', timestamp: '2026-01-01T00:00:00.000Z', error: '上一轮遗留' })}\n`;

describe('S13 按模块限定 verify 范围 — 命令选择（module-scoped-verify 切片3）', () => {
  it('UT-S13-105: --all 优先于一切', () => {
    const arms: Array<{ name: string; opts?: Record<string, unknown>; proposal: Record<string, unknown>; expectModules: string[]; expectLabels: string[] }> = [
      { name: '单模块', opts: { modules: [{ id: 'core', paths: ['src/**'] }] }, proposal: { module: 'core' }, expectModules: ['core'], expectLabels: ['core'] },
      { name: '无 paths 多模块', opts: { modules: [{ id: 'core' }, { id: 'portal-web' }] }, proposal: {}, expectModules: ['core', 'portal-web'], expectLabels: ['core', 'portal-web'] },
      { name: '缺省夹具', proposal: {}, expectModules: ['core', 'portal-web'], expectLabels: ['core', 'portal-web'] },
      { name: '缺省夹具无 baseRef', proposal: { baseRef: null }, expectModules: ['core', 'portal-web'], expectLabels: ['core', 'portal-web'] },
    ];
    for (const arm of arms) {
      const root = project(arm.opts);
      addProposal(root, arm.proposal);
      put(root, 'portal-web/app.ts', 'export const app = 2;\n');
      const run = verifyJson(root, { args: ['--all'] });
      expect(run.data.scope, arm.name).toEqual({ mode: 'all', modules: arm.expectModules, reasons: [], fallback_reason: null, out_of_scope_result_count: 0 });
      expect(run.data.summary.defined_count, arm.name).toBe(5);
      expect(labels(run), arm.name).toEqual(arm.expectLabels);
      // 单模块臂只执行 core 的模块命令，其余（在该项目中为全局）用例无人输出 → 未覆盖；规格对此不作门禁要求
      if (arm.expectModules.length > 1) expect(run.data.gate.result, arm.name).toBe('PASS');
    }
  });

  it('UT-S13-116: 命令选择、去重、顺序与注入；两阶段优先（review F4）', () => {
    const three = [{ id: 'core', paths: ['src/**'] }, { id: 'portal-web', paths: ['portal-web/**'] }, { id: 'portal-server', paths: ['portal-server/**'] }];
    // 主臂：core 与 portal-web 配置完全相同的命令组 A，portal-server 回落项目级命令组 P
    const root = project({ modules: three });
    commitConfig(root, cfg => {
      cfg.verify.pre_run_command = 'node tools/rec.cjs modules@P';
      cfg.verify.modules = { core: { pre_run_command: 'node tools/rec.cjs modules@A' }, 'portal-web': { pre_run_command: 'node tools/rec.cjs modules@A' } };
    });
    addProposal(root, {});
    for (const f of ['src/x.ts', 'portal-web/x.ts', 'portal-server/x.ts']) put(root, f, 'x\n');
    const run = verifyJson(root);
    expect(run.data.scope.modules).toEqual(['core', 'portal-web', 'portal-server']);
    expect(run.calls.map(c => [c.label, c.modules])).toEqual([['modules@A', 'core,portal-web'], ['modules@P', 'portal-server']]);
    expect(run.data.pre_run.commands.map((c: any) => [c.command, c.modules])).toEqual([
      ['node tools/rec.cjs modules@A', ['core', 'portal-web']],
      ['node tools/rec.cjs modules@P', ['portal-server']],
    ]);
    expect(run.data.gate.result).toBe('PASS');
    expect(run.data.summary.defined_count).toBe(5);

    // 两阶段优先臂：(a) core 三字段齐备；(b) portal-server 回落的项目级命令组三字段齐备
    const tp = project({ modules: three });
    commitConfig(tp, cfg => {
      cfg.verify.pre_run_command = 'node tools/rec.cjs modules@ppre';
      cfg.verify.regression_command = 'node tools/rec.cjs modules@preg';
      cfg.verify.incremental_command = 'node tools/rec.cjs modules@pinc';
      cfg.verify.modules = {
        core: { pre_run_command: 'node tools/rec.cjs core@pre', regression_command: 'node tools/rec.cjs core@reg', incremental_command: 'node tools/rec.cjs core@inc' },
        'portal-web': { pre_run_command: 'node tools/rec.cjs portal-web' },
      };
    });
    addProposal(tp, {});
    for (const f of ['src/x.ts', 'portal-web/x.ts', 'portal-server/x.ts']) put(tp, f, 'x\n');
    const t2 = verifyJson(tp);
    expect(labels(t2)).toEqual(['core@reg', 'core@inc', 'portal-web', 'modules@preg', 'modules@pinc']);
    expect(labels(t2)).not.toContain('core@pre');
    expect(labels(t2)).not.toContain('modules@ppre');
    const skipped = t2.data.pre_run.commands.filter((c: any) => c.status === 'skipped');
    expect(skipped.map((c: any) => [c.stage, c.command, c.modules])).toEqual([
      ['pre_run', 'node tools/rec.cjs core@pre', ['core']],
      ['pre_run', 'node tools/rec.cjs modules@ppre', ['portal-server']],
    ]);
    expect(t2.data.pre_run.diagnostics.some((d: string) => d.includes('pre_run_command'))).toBe(true);
    expect(t2.data.pre_run.commands.filter((c: any) => c.status !== 'skipped').map((c: any) => c.stage))
      .toEqual(['regression', 'incremental', 'pre_run', 'regression', 'incremental']);
    expect(t2.data.gate.result).toBe('PASS');
  });

  it('UT-S13-117: 模块命令失败——点名模块，其余命令组照常执行', () => {
    const root = project();
    addProposal(root, {});
    put(root, 'src/protocol.ts', 'export const v = 2;\n');
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    const run = verifyJson(root, { env: { MSV_CORE_EXIT: '3' } });
    expect(labels(run)).toEqual(['core', 'portal-web']);
    expect(run.data.gate).toEqual({ result: 'FAIL', reason: 'pre_run_failed' });
    const [core, portal] = run.data.pre_run.commands;
    expect(core).toMatchObject({ status: 'fail', exit_code: 3, modules: ['core'] });
    expect(portal).toMatchObject({ status: 'pass', modules: ['portal-web'] });
    expect(run.data.pre_run.diagnostics.some((d: string) => d.includes('core'))).toBe(true);
    expect(run.status).toBe(1);
  });

  it('UT-S13-120: verify.modules 含未登记模块 id → 警告并忽略；根 logos.config.schema.json 含 verify.modules', async () => {
    const runWith = (extra: boolean) => {
      const root = project();
      if (extra) commitConfig(root, cfg => { cfg.verify.modules.mobile = { pre_run_command: 'node tools/rec.cjs mobile' }; });
      addProposal(root, {});
      put(root, 'portal-web/app.ts', 'export const app = 2;\n');
      return { root, run: verifyJson(root) };
    };
    const withMobile = runWith(true);
    const without = runWith(false);
    const warn = withMobile.run.data.pre_run.diagnostics.find((d: string) => d.includes('verify_module_unknown'));
    expect(warn).toContain('mobile');
    expect(labels(withMobile.run)).not.toContain('mobile');
    expect(withMobile.run.data.gate).toEqual(without.run.data.gate);
    expect(withMobile.run.data.scope).toEqual(without.run.data.scope);
    // 根 schema：可严格解析、verify 节含可选 modules，夹具配置能通过校验
    const schema = JSON.parse(readFileSync(join(REPO, 'spec/logos.config.schema.json'), 'utf8'));
    const modulesSchema = schema.properties.verify.properties.modules;
    expect(modulesSchema.type).toBe('object');
    expect(Object.keys(modulesSchema.additionalProperties.properties).sort()).toEqual(['incremental_command', 'pre_run_command', 'regression_command']);
    expect(modulesSchema.additionalProperties.additionalProperties).toBe(false);
    try { registerSchema(schema); } catch { /* 同一 worker 内已注册 */ }
    const cfg = JSON.parse(readFileSync(join(withMobile.root, 'logos/logos.config.json'), 'utf8'));
    const output = await validate(schema.$id, cfg);
    expect(output.valid, JSON.stringify(output).slice(0, 400)).toBe(true);
  });
});

describe('S13 按模块限定 verify 范围 — 回落时的命令执行（module-scoped-verify 切片3）', () => {
  it('UT-S13-109: 共享验收配置被改即回落全量（review F2 负向 ③）', () => {
    for (const file of ['logos/logos.config.json', 'logos/logos-project.yaml']) {
      const root = project();
      addProposal(root, {});
      put(root, 'portal-web/app.ts', 'export const app = 2;\n');
      const path = join(root, file);
      writeFileSync(path, file.endsWith('.json')
        ? JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), description: 'touched' }, null, 2)
        : `${readFileSync(path, 'utf8')}# touched\n`);
      const run = verifyJson(root);
      expect(run.data.scope.mode, file).toBe('fallback-full');
      expect(run.data.scope.modules).toEqual(['core', 'portal-web']);
      expect(run.data.scope.reasons).toEqual([]);
      expect(run.data.scope.fallback_reason.code).toBe('shared_config_changed');
      expect(run.data.scope.fallback_reason.detail).toContain(file);
      expect(run.data.summary.defined_count).toBe(5);
      expect(labels(run)).toEqual(['core', 'portal-web']);
    }
  });

  it('UT-S13-110: 改动文件归不到模块即回落全量', () => {
    const root = project();
    addProposal(root, {});
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    for (const f of ['scripts/build.sh', 'docs/readme.md', 'tools/x.js']) put(root, f, 'x\n');
    const run = verifyJson(root);
    expect(run.data.scope.mode).toBe('fallback-full');
    expect(run.data.scope.fallback_reason.code).toBe('unmapped_file');
    expect(run.data.scope.fallback_reason.detail).toBe('docs/readme.md 等 3 个文件');
    expect(labels(run)).toEqual(['core', 'portal-web']);
  });
});

describe('S13 按模块限定 verify 范围 — 端到端（module-scoped-verify 切片3）', () => {
  it('ST-S13-27: 只改一个模块的端到端', () => {
    const root = project();
    addProposal(root, {});
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    put(root, RESULTS, STALE_ROW);
    const run = verifyJson(root, { env: { MSV_EMIT_FOREIGN: '1' } });
    expect(run.data.gate.result).toBe('PASS');
    expect(run.data.scope.mode).toBe('module');
    expect(run.data.scope.modules).toEqual(['portal-web']);
    expect(run.data.summary.defined_count).toBe(3);
    expect(run.data.scope.out_of_scope_result_count).toBe(1);
    expect(run.data.failed_cases).toEqual([]);
    expect(readFileSync(join(root, RESULTS), 'utf8')).not.toContain('上一轮遗留');
    expect(run.calls.map(c => [c.label, c.modules])).toEqual([['portal-web', 'portal-web']]);
    expect(run.report).toContain('| Scope | module（portal-web） |');
  });

  it('ST-S13-28: 跨模块提案', () => {
    const root = project();
    addProposal(root, {});
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    put(root, 'src/protocol.ts', 'export const v = 2;\n');
    const run = verifyJson(root);
    expect(run.data.scope.modules).toEqual(['core', 'portal-web']);
    expect(run.data.scope.reasons).toContainEqual({ module: 'core', source: 'path', ref: 'src/protocol.ts' });
    expect(labels(run)).toEqual(['core', 'portal-web']);
    expect(run.data.summary.defined_count).toBe(5);
    expect(run.data.gate.result).toBe('PASS');
  });

  it('ST-S13-29: 改动归不到模块时回落全量', () => {
    const root = project();
    addProposal(root, {});
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    put(root, 'scripts/release.sh', 'echo\n');
    const run = verifyJson(root);
    expect(run.data.scope.mode).toBe('fallback-full');
    expect(run.data.scope.fallback_reason.code).toBe('unmapped_file');
    expect(labels(run)).toEqual(['core', 'portal-web']);
    expect(run.data.summary.defined_count).toBe(5);
  });

  it('ST-S13-31: --all 端到端（遗留行不被采信，本轮失败才阻断）', () => {
    const root = project();
    addProposal(root, {});
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    put(root, RESULTS, STALE_ROW);
    const pass = verifyJson(root, { args: ['--all'] });
    expect(pass.data.scope.mode).toBe('all');
    expect(labels(pass)).toEqual(['core', 'portal-web']);
    expect(pass.data.summary.defined_count).toBe(5);
    expect(pass.data.gate.result).toBe('PASS');
    const fail = verifyJson(root, { args: ['--all'], env: { MSV_CORE_FAIL: '1' } });
    expect(fail.data.failed_cases.map((f: any) => f.id)).toEqual(['UT-S01-01']);
    expect(fail.data.gate.reason).toBe('failed_cases');
  });

  it('ST-S13-32: logos/ 下已归属文件与共享验收配置（review F2）', () => {
    const root = project({ modules: [{ id: 'core', paths: ['src/**', 'logos/tools/**'] }, { id: 'portal-web', paths: ['portal-web/**'] }] });
    addProposal(root, {});
    put(root, 'portal-web/app.ts', 'export const app = 2;\n');
    put(root, 'logos/tools/protocol-check.ts', 'x\n');
    const first = verifyJson(root);
    expect(first.data.scope.mode).toBe('module');
    expect(first.data.scope.modules).toEqual(['core', 'portal-web']);
    expect(labels(first)).toEqual(['core', 'portal-web']);
    const cfgPath = join(root, 'logos/logos.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.verify.pre_run_command = 'node tools/rec.cjs project --changed';
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const second = verifyJson(root);
    expect(second.data.scope.mode).toBe('fallback-full');
    expect(second.data.scope.fallback_reason.code).toBe('shared_config_changed');
  });
});

