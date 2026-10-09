/**
 * S13 预跑命令失败纳入门禁与输出尾部（verify-smoke-guard-fixes-0-15-20，切片 slice-01-verify-pre-run-gate）。
 *
 * 覆盖 UT-S13-81～UT-S13-88、ST-S13-23、ST-S13-24，对应功能规格 §2.7「预跑命令失败进入门禁」「预跑命令输出尾部」、
 * §2.75.1 四项判据与按预跑是否失败分两支的 gate.reason 优先级；场景 S13 步骤 9 与 EX-9.1～EX-9.6。
 * 夹具为 mktemp 一次性项目；「回滚型运行器」是真实脚本：写半份结果后把结果文件回滚为旧备份并非零退出
 * （复刻 RunLogos scripts/run-vitest.js）。全部经真实 `openlogos verify` 子进程执行。
 * 结果由 OpenLogos reporter 依 it 标题中的 ID 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cli, cleanupFixtureRoots, fixtureRoots, put } from './frontier-fixture.js';
import { scaffoldProject } from './helpers.js';
import { boundedOutputTail, OUTPUT_TAIL_MAX_BYTES, OUTPUT_TAIL_MAX_LINES } from '../src/lib/sandbox.js';

afterAll(cleanupFixtureRoots);

const RESULT = 'logos/resources/verify/test-results.jsonl';
const IDS = ['UT-S01-01', 'UT-S01-02'];
const SENTINEL = 'SENTINEL-PRE-RUN-7f3a';

function ledger(rows: Array<{ id: string; status: string; error?: string }>): string {
  const ts = '2026-10-09T00:00:00.000Z';
  return rows.map(r => JSON.stringify({ ...r, timestamp: ts })).join('\n') + '\n';
}
const ALL_PASS = ledger(IDS.map(id => ({ id, status: 'pass' })));
const WITH_FAIL = ledger([{ id: 'UT-S01-01', status: 'fail', error: 'boom' }, { id: 'UT-S01-02', status: 'pass' }]);
const INCONSISTENT = ledger([...IDS.map(id => ({ id, status: 'pass' })), { id: 'UT-S01-99', status: 'pass' }]);
const FAIL_AND_INCONSISTENT = ledger([{ id: 'UT-S01-01', status: 'fail', error: 'boom' }, { id: 'UT-S01-02', status: 'pass' }, { id: 'UT-S01-99', status: 'pass' }]);
const UNCOVERED = ledger([{ id: 'UT-S01-01', status: 'pass' }]);

interface VerifyConfig { pre_run_command?: string; regression_command?: string; incremental_command?: string;
  regression_result_path?: string; incremental_result_path?: string; sandbox_mode?: 'off' | 'auto' }

function project(verify: VerifyConfig = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-s13-prerun-'));
  fixtureRoots.push(root);
  scaffoldProject(root, { locale: 'en' });
  const cfgPath = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { ...cfg.verify, sandbox_mode: verify.sandbox_mode ?? 'off', ...verify };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  put(root, 'logos/resources/test/core-S01-test-cases.md',
    `# S01\n\n| ID | 描述 |\n|---|---|\n${IDS.map(id => `| ${id} | ${id} 用例 |`).join('\n')}\n`);
  return root;
}

/** 回滚型运行器：stderr 打哨兵、写半份结果，再把结果文件回滚为 backup 内容并以 exitCode 退出。 */
function rollbackRunner(root: string, backup: string, exitCode = 1, target = RESULT, beforeExit = ''): string {
  put(root, 'tools/backup.jsonl', backup);
  put(root, 'tools/rollback-runner.js', `
const fs = require('fs');
console.log('running tests ...');
console.error('${SENTINEL} runner crashed while executing batch 3');
fs.mkdirSync(require('path').dirname('${target}'), { recursive: true });
fs.writeFileSync('${target}', '{"id":"UT-S01-01","status":"pass"}\\n');
fs.writeFileSync('${target}', fs.readFileSync('tools/backup.jsonl'));
${beforeExit}
process.exit(${exitCode});
`);
  return 'node tools/rollback-runner.js';
}

/** 普通运行器：写入给定账本并以 exitCode 退出。 */
function writerRunner(root: string, name: string, content: string, exitCode = 0, target = RESULT): string {
  put(root, `tools/${name}.data`, content);
  put(root, `tools/${name}.js`, `
const fs = require('fs');
fs.mkdirSync(require('path').dirname('${target}'), { recursive: true });
fs.writeFileSync('${target}', fs.readFileSync('tools/${name}.data'));
process.exit(${exitCode});
`);
  return `node tools/${name}.js`;
}

function setVerify(root: string, verify: VerifyConfig): void {
  const cfgPath = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { ...cfg.verify, ...verify };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
}

function verifyJson(root: string, env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, [cli, 'verify', '--format', 'json'], {
    cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env },
  });
  const data = JSON.parse(r.stdout).data;
  return { status: r.status, data, stderr: r.stderr };
}

/**
 * 执行期间的落盘观测（S13 EX-9.4「输出全文不落盘」）：verify 以独立 TMPDIR 运行；预跑命令输出完毕、退出前
 * 递归扫描该目录，把内容含 `needle` 的文件与 ≥1 MiB 的文件写入 found。needle 在运行时拼接，脚本源码
 * 本身（含 sandbox 副本）不会命中。返回 { env, snippet, found() }。
 */
function spillObserver(needle: [string, string]) {
  const obs = mkdtempSync(join(tmpdir(), 'openlogos-s13-obs-'));
  fixtureRoots.push(obs);
  const out = join(mkdtempSync(join(tmpdir(), 'openlogos-s13-found-')), 'found.json');
  fixtureRoots.push(join(out, '..'));
  const snippet = `
{
  const fsx = require('fs'); const px = require('path');
  const needle = ${JSON.stringify(needle[0])} + ${JSON.stringify(needle[1])};
  const hits = [];
  const walk = d => { let es = []; try { es = fsx.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = px.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { try { const st = fsx.statSync(p);
        if (st.size >= 1024 * 1024 || fsx.readFileSync(p).includes(needle)) hits.push(p); } catch {} } } };
  walk(${JSON.stringify(obs)});
  fsx.writeFileSync(${JSON.stringify(out)}, JSON.stringify(hits));
}
`;
  return {
    env: { TMPDIR: obs, TMP: obs, TEMP: obs },
    snippet,
    found: (): string[] => JSON.parse(readFileSync(out, 'utf8')),
  };
}

const report = (root: string) => readFileSync(join(root, 'logos/resources/verify/acceptance-report.md'), 'utf8');

describe('S13 预跑命令失败纳入门禁 — 单元测试', () => {
  it('UT-S13-81: 单阶段预跑失败且账本被回滚为旧的完整结果', () => {
    const root = project();
    setVerify(root, { pre_run_command: rollbackRunner(root, INCONSISTENT) });
    const { status, data } = verifyJson(root);
    expect(status).not.toBe(0);
    expect(data.gate.result).toBe('FAIL');
    expect(data.gate.reason, '修改前实现报 result_ledger_inconsistent').toBe('pre_run_failed');
    expect(data.pre_run.commands[0].status).toBe('fail');
    expect(data.pre_run.commands[0].exit_code).toBe(1);
    expect(data.consistency.ok, '账本一致性诊断照常输出').toBe(false);
  });

  it('UT-S13-82: 预跑失败但账本完整且全部通过', () => {
    const root = project();
    const guardDir = join(root, 'logos', 'changes', 'p');
    mkdirSync(guardDir, { recursive: true });
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'p', module: 'core' }));
    setVerify(root, { pre_run_command: rollbackRunner(root, ALL_PASS) });
    const { data } = verifyJson(root);
    expect(data.gate.result, '修改前实现直接 PASS').toBe('FAIL');
    expect(data.gate.reason).toBe('pre_run_failed');
    expect(data.consistency.ok).toBe(true);
    expect(data.uncovered_cases).toEqual([]);
    expect(existsSync(join(guardDir, 'VERIFY_PASS')), '不写 VERIFY_PASS').toBe(false);
  });

  it('UT-S13-83: 预跑失败时失败用例优先于 pre_run_failed', () => {
    for (const [label, backup, consistent] of [['① 自洽账本', WITH_FAIL, true], ['② 不自洽账本', FAIL_AND_INCONSISTENT, false]] as const) {
      const root = project();
      setVerify(root, { pre_run_command: rollbackRunner(root, backup) });
      const { data } = verifyJson(root);
      expect(data.gate.reason, label).toBe('failed_cases');
      expect(data.failed_cases.map((c: { id: string }) => c.id), label).toEqual(['UT-S01-01']);
      expect(data.pre_run.commands[0].status, label).toBe('fail');
      expect(data.consistency.ok, `${label}：consistency 照常输出`).toBe(consistent);
    }
  });

  it('UT-S13-84: 两阶段任一段失败即 FAIL', () => {
    for (const failing of ['regression', 'incremental'] as const) {
      const root = project();
      const regPath = 'logos/resources/verify/regression.jsonl';
      const incPath = 'logos/resources/verify/incremental.jsonl';
      setVerify(root, {
        regression_command: writerRunner(root, 'reg', ledger([{ id: 'UT-S01-01', status: 'pass' }]), failing === 'regression' ? 2 : 0, regPath),
        incremental_command: writerRunner(root, 'inc', ledger([{ id: 'UT-S01-02', status: 'pass' }]), failing === 'incremental' ? 2 : 0, incPath),
        regression_result_path: regPath,
        incremental_result_path: incPath,
      });
      const { data } = verifyJson(root);
      expect(data.gate.result, failing).toBe('FAIL');
      expect(data.gate.reason, failing).toBe('pre_run_failed');
      const byStage = Object.fromEntries(data.pre_run.commands.map((c: { stage: string; status: string }) => [c.stage, c.status]));
      expect(byStage[failing], failing).toBe('fail');
      expect(byStage[failing === 'regression' ? 'incremental' : 'regression'], failing).toBe('pass');
      expect(readFileSync(join(root, RESULT), 'utf8'), `${failing}：两段结果照常合并`).toContain('UT-S01-02');
    }
  });

  it('UT-S13-85: 预跑成功或未配置时判定与输出逐字不变', () => {
    // 既有优先级：result_ledger_inconsistent → failed_cases → incomplete_coverage（新优先级只在预跑失败时生效）
    const arms: Array<[string, string, string, string | null]> = [
      ['全部 pass', ALL_PASS, 'PASS', null],
      ['含失败用例', WITH_FAIL, 'FAIL', 'failed_cases'],
      ['存在未覆盖', UNCOVERED, 'FAIL', 'incomplete_coverage'],
      ['含失败用例且账本不自洽', FAIL_AND_INCONSISTENT, 'FAIL', 'result_ledger_inconsistent'],
    ];
    for (const [label, content, result, reason] of arms) {
      const root = project();
      setVerify(root, { pre_run_command: writerRunner(root, 'ok', content, 0) });
      const { data } = verifyJson(root);
      expect(data.gate.result, label).toBe(result);
      expect(data.gate.reason, label).toBe(reason);
      expect(data.pre_run.commands[0].status, label).toBe('pass');
      expect(report(root), `${label}：无预跑失败时报告不出现新小节`).not.toContain('Pre-run Command Failures');
    }
    // 未配置任何预跑命令的旧项目重复第四臂
    const legacy = project();
    put(legacy, RESULT, FAIL_AND_INCONSISTENT);
    const { data } = verifyJson(legacy);
    expect(data.pre_run.mode).toBe('none');
    expect(data.gate.reason, '全局采用新优先级的实现在此取 failed_cases').toBe('result_ledger_inconsistent');
  });

  it('UT-S13-86: 输出尾部有界且去除 ANSI', () => {
    // 纯函数：先按行再按字节截断，字节截断落在完整 UTF-8 字符边界
    const many = Array.from({ length: 300 }, (_, i) => `\u001b[31m第${i}行 红色输出\u001b[0m`).join('\n') + '\n';
    const tail = boundedOutputTail(Buffer.from(many));
    expect(tail.split('\n').length).toBeLessThanOrEqual(OUTPUT_TAIL_MAX_LINES);
    expect(tail).not.toContain('\u001b[');
    expect(tail.endsWith('第299行 红色输出')).toBe(true);
    const wide = '汉'.repeat(5000);
    const cut = boundedOutputTail(Buffer.from(wide));
    expect(Buffer.byteLength(cut)).toBeLessThanOrEqual(OUTPUT_TAIL_MAX_BYTES);
    expect(cut).toMatch(/^汉+$/);
    // 命令级：stdout 300 行含 ANSI 与中文，stderr 20 行
    const root = project();
    const spill = spillObserver(['输出', '行 299']);
    put(root, 'tools/noisy.js', `
for (let i = 0; i < 300; i++) require('fs').writeSync(1, '\\u001b[32m输出行 ' + i + '\\u001b[0m\\n');
for (let i = 0; i < 20; i++) require('fs').writeSync(2, '错误行 ' + i + '\\n');
require('fs').writeFileSync('${RESULT}', require('fs').readFileSync('tools/ok.data'));
${spill.snippet}
`);
    put(root, 'tools/ok.data', ALL_PASS);
    setVerify(root, { pre_run_command: 'node tools/noisy.js' });
    const { data } = verifyJson(root, spill.env);
    expect(spill.found(), '截获期间临时目录中不得出现输出全文制品').toEqual([]);
    const cmd = data.pre_run.commands[0];
    const outLines = cmd.stdout_tail.split('\n');
    expect(outLines.length).toBe(80);
    expect(outLines[79]).toBe('输出行 299');
    expect(Buffer.byteLength(cmd.stdout_tail)).toBeLessThanOrEqual(8192);
    expect(cmd.stdout_tail).not.toContain('\u001b[');
    expect(cmd.stderr_tail.split('\n')).toEqual(Array.from({ length: 20 }, (_, i) => `错误行 ${i}`));
    // 文本模式：输出实时打到终端，不截获
    const text = spawnSync(process.execPath, [cli, 'verify'], { cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024 });
    expect(text.stdout).toContain('输出行 299');
    expect(text.stdout).not.toContain('stdout_tail');
  });

  it('UT-S13-87: 大输出不中断子进程、退出码如实', () => {
    for (const mode of ['off', 'auto'] as const) {
      const root = project({ sandbox_mode: mode });
      const marker = join(mkdtempSync(join(tmpdir(), 'openlogos-s13-marker-')), 'done');
      fixtureRoots.push(join(marker, '..'));
      put(root, 'tools/ok.data', ALL_PASS);
      const spill = spillObserver(['HUGE-HEAD-', 'MARK-5e1']);
      put(root, 'tools/huge.js', `
const fs = require('fs');
fs.writeSync(1, 'HUGE-HEAD-' + 'MARK-5e1\\n');
const chunk = 'x'.repeat(1023) + '\\n';
const block = chunk.repeat(1024);
for (let i = 0; i < 50; i++) fs.writeSync(1, block);
fs.writeSync(1, 'LAST-LINE-OF-OUTPUT\\n');
fs.writeFileSync('${RESULT}', fs.readFileSync('tools/ok.data'));
fs.writeFileSync(${JSON.stringify(marker)}, 'ok');
${spill.snippet}
process.exit(3);
`);
      setVerify(root, { pre_run_command: 'node tools/huge.js' });
      const { data } = verifyJson(root, spill.env);
      expect(spill.found(), `${mode}：50 MiB 输出期间临时目录中不得出现全文 / 大体量输出制品`).toEqual([]);
      const cmd = data.pre_run.commands[0];
      expect(existsSync(marker), `${mode}：子进程完整运行至结束`).toBe(true);
      expect(cmd.exit_code, mode).toBe(3);
      expect(cmd.stdout_tail.split('\n').pop(), mode).toBe('LAST-LINE-OF-OUTPUT');
      expect(Buffer.byteLength(cmd.stdout_tail), mode).toBeLessThanOrEqual(8192);
      expect(data.gate.reason, mode).toBe('pre_run_failed');
    }
  });

  it('UT-S13-88: 验收报告不落命令输出', () => {
    const root = project();
    const spill = spillObserver(['running ', 'tests ...']);
    setVerify(root, { pre_run_command: rollbackRunner(root, INCONSISTENT, 1, RESULT, spill.snippet) });
    const { data } = verifyJson(root, spill.env);
    expect(data.pre_run.commands[0].stderr_tail).toContain(SENTINEL);
    expect(spill.found(), '截获期间临时目录中不得出现输出全文制品').toEqual([]);
    const md = report(root);
    expect(md).toContain('## Pre-run Command Failures');
    expect(md).toContain('| pre_run | 1 |');
    expect(md).not.toContain(SENTINEL);
    expect(md).not.toContain('running tests');
  });
});

describe('S13 预跑命令失败纳入门禁 — 场景测试', () => {
  it('ST-S13-23: 回滚型运行器的事故复刻端到端', () => {
    const root = project({ sandbox_mode: 'auto' });
    setVerify(root, { pre_run_command: rollbackRunner(root, ALL_PASS) });
    const first = verifyJson(root);
    expect(first.data.gate.reason, '修改前为 result_ledger_inconsistent 或 PASS').toBe('pre_run_failed');
    expect(first.data.pre_run.commands[0].stderr_tail).toContain(SENTINEL);
    expect(report(root)).not.toContain(SENTINEL);
    setVerify(root, { pre_run_command: writerRunner(root, 'fixed', ALL_PASS, 0) });
    const second = verifyJson(root);
    expect(second.data.gate.result).toBe('PASS');
    expect(second.data.gate.reason).toBeNull();
  });

  it('ST-S13-24: 两阶段与诊断不被隐藏', () => {
    const root = project();
    const regPath = 'logos/resources/verify/regression.jsonl';
    const incPath = 'logos/resources/verify/incremental.jsonl';
    setVerify(root, {
      regression_command: writerRunner(root, 'reg', ledger([{ id: 'UT-S01-01', status: 'pass' }]), 0, regPath),
      incremental_command: writerRunner(root, 'inc', '', 4, incPath),
      regression_result_path: regPath,
      incremental_result_path: incPath,
    });
    const first = verifyJson(root);
    expect(first.data.gate.reason).toBe('pre_run_failed');
    expect(first.data.uncovered_cases).toEqual(['UT-S01-02']);
    expect(first.data.pre_run.commands.map((c: { status: string }) => c.status)).toEqual(['pass', 'fail']);
    setVerify(root, { incremental_command: writerRunner(root, 'inc2', ledger([{ id: 'UT-S01-02', status: 'fail', error: 'x' }]), 4, incPath) });
    const second = verifyJson(root);
    expect(second.data.gate.reason).toBe('failed_cases');
    rmSync(join(root, 'tools'), { recursive: true, force: true });
  });
});
