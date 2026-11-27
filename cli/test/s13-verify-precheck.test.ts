/**
 * verify-self-sufficient-cases 切片 3：verify 环境要求声明、验收标准对账与预检。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 verify 自足：环境预检与跳过分类测试」严格对齐：
 * UT-S13-157～164、UT-S13-169、UT-S13-175～178、ST-S13-40；以及 core-S35-test-cases.md 的 UT-S35-230。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, withCompleteClarification } from './helpers.js';
import { parseAcceptanceCriteria } from '../src/lib/acceptance-criteria.js';
import {
  computeEffectiveRequirements, readAcceptanceEntries, readDeclaredRequirements, readRawVerifyConfig, runVerifyPrecheck,
} from '../src/lib/verify-requirements.js';
import { normalizeSandboxConfig } from '../src/lib/sandbox.js';
import { readVerifyConfig } from '../src/lib/verify-config.js';
import { selectVerifyCommandGroups } from '../src/commands/verify.js';

vi.setConfig({ testTimeout: 120_000 });

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const SECRET = 'VS-SECRET-9c1e';
const HISTORY_DIR = 'logos/resources/verify/history';
const REPORT = 'logos/resources/verify/acceptance-report.md';
const RESULTS = 'logos/resources/verify/test-results.jsonl';

/** 记录型 runner：被执行时写项目外标记 RAN（路径取 VS_RAN），按 tools/ids.json 写全部 pass。 */
const RUNNER = `const fs = require('fs');
if (process.env.VS_RAN) fs.writeFileSync(process.env.VS_RAN, 'ran');
const ids = JSON.parse(fs.readFileSync('tools/ids.json', 'utf8'));
fs.mkdirSync('logos/resources/verify', { recursive: true });
fs.writeFileSync('logos/resources/verify/test-results.jsonl', ids.map(id => JSON.stringify({ id, status: 'pass', scenario: 'S01' })).join('\\n') + '\\n');
`;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tmpRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return realpathSync(root);
}

const testTable = (ids: string[]) => ['| ID | 描述 |', '|---|---|', ...ids.map(id => `| ${id} | ${id} fixture |`)].join('\n') + '\n';

interface VsOptions {
  verify?: Record<string, unknown>;
  preRun?: boolean;
  /** 活跃提案的「验收标准」段：undefined 不建提案；null 建提案但无该段；字符串为「自动验收环境要求」字段值。 */
  acceptance?: string | null;
}

/** 夹具 VS / VS-prop / VS-req：单模块 core（launched），已合并规格 UT-S01-01、UT-S01-02、ST-S01-01。 */
function vs(opts: VsOptions = {}) {
  const root = tmpRoot();
  scaffoldProject(root, { locale: 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    ['project:', '  name: vs', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', ''].join('\n'));
  const ids = ['ST-S01-01', 'UT-S01-01', 'UT-S01-02'];
  writeFileSync(join(root, 'logos/resources/test/core-S01-test-cases.md'), testTable(ids));
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(join(root, 'tools', 'run.cjs'), RUNNER);
  writeFileSync(join(root, 'tools', 'ids.json'), JSON.stringify(ids));
  const cfgPath = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { ...cfg.verify, sandbox_mode: 'off', ...(opts.preRun === false ? {} : { pre_run_command: 'node tools/run.cjs' }), ...(opts.verify ?? {}) };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  if (opts.acceptance !== undefined) writeProposal(root, opts.acceptance);
  const ran = join(dirname(root), `${root.split('/').pop()}.RAN`);
  cleanups.push(() => { try { require('node:fs').rmSync(ran, { force: true }); } catch { /* ignore */ } });
  return { root, ran };
}

function writeProposal(root: string, acceptance: string | null) {
  const slug = 'vs-demo';
  const dir = join(root, 'logos', 'changes', slug);
  mkdirSync(dir, { recursive: true });
  const section = acceptance === null ? [] : [
    '## 验收标准', `- 自动验收环境要求：${acceptance}`, '- 平台限定用例：无', '- 需要人参与的验收：无', '',
  ];
  writeFileSync(join(dir, 'proposal.md'), withCompleteClarification([
    `# 变更提案：${slug}`, '', '## 变更原因', '预检夹具。', '', '## 变更类型', '代码级', '',
    '## 变更范围', '- CLI', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', ...section, '## 变更概述', '夹具。',
  ].join('\n')));
  writeFileSync(join(dir, 'tasks.md'), ['# 实现任务', '', '## [code] 代码实现', '- [ ] 实现', ''].join('\n'));
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  return dir;
}

function cleanEnv(extra: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', ...extra };
  for (const k of Object.keys(env)) if (k.startsWith('OPENLOGOS_VERIFY_') && !(k in extra)) delete env[k];
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  return env as NodeJS.ProcessEnv;
}

function parseLast(text: string): any {
  const line = text.split('\n').reverse().find(l => l.trim().startsWith('{'));
  return line ? JSON.parse(line) : null;
}

function verify(f: { root: string; ran: string }, env: Record<string, string | undefined> = {}, args: string[] = []) {
  const r = spawnSync(process.execPath, [CLI, 'verify', '--format', 'json', ...args], {
    cwd: f.root, encoding: 'utf8', env: cleanEnv({ VS_RAN: f.ran, ...env }), timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', data: parseLast(r.stdout ?? '')?.data };
}

function lastHistory(root: string): any {
  const dir = join(root, HISTORY_DIR);
  const files = readdirSync(dir).filter(n => n.endsWith('.json')).sort();
  return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'));
}

function setConfig(root: string, patch: (verify: Record<string, any>) => void) {
  const p = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  patch(cfg.verify);
  writeFileSync(p, JSON.stringify(cfg, null, 2));
}

/** 临时 bin 目录，内含可执行的假命令。 */
function fakeBin(name: string): string {
  const dir = tmpRoot();
  const file = join(dir, name);
  writeFileSync(file, '#!/bin/sh\nexit 0\n');
  chmodSync(file, 0o755);
  return dir;
}

const withPath = (dir: string) => ({ PATH: `${dir}:${process.env.PATH}` });

/** 递归列出源工作区文件（排除 verify 的预期输出：结果、报告、历史与运行态目录）。 */
function workspaceSnapshot(root: string): Record<string, number> {
  const out: Record<string, number> = {};
  const skip = (rel: string) => rel.startsWith('logos/resources/verify') || rel.startsWith('logos/.openlogos-runtime') || rel.startsWith('logos/changes');
  const walk = (rel: string) => {
    for (const name of readdirSync(join(root, rel))) {
      const r = rel ? `${rel}/${name}` : name;
      if (skip(r)) continue;
      const st = statSync(join(root, r));
      if (st.isDirectory()) walk(r); else out[r] = st.size;
    }
  };
  walk('');
  return out;
}

describe('S13 verify 自足：环境要求声明、对账与预检', () => {
  it('UT-S13-157: 环境要求结构非法', () => {
    const variants: Array<[string, unknown]> = [
      ['env 不是数组', { env: 'X' }],
      ['check name 重复', { checks: [{ name: 'dup', command: 'node -e 0' }, { name: 'dup', command: 'node -e 0' }] }],
      ['check name 含空格', { checks: [{ name: 'bad name', command: 'node -e 0' }] }],
    ];
    for (const [label, requirements] of variants) {
      const f = vs({ verify: { requirements } });
      const r = verify(f);
      expect(r.status, label).toBe(1);
      expect(r.data.gate, label).toEqual({ result: 'FAIL', reason: 'verify_requirements_invalid' });
      expect(r.data.requirements.invalid.length, label).toBeGreaterThan(0);
      expect(existsSync(f.ran), label).toBe(false);
    }
  });

  it('UT-S13-158: 验收标准条目未写入配置', () => {
    const f = vs({ acceptance: '`command:vs-fake-tool` `check:vs-ready`', verify: { requirements: { commands: ['vs-fake-tool'] } } });
    const r = verify(f, withPath(fakeBin('vs-fake-tool')));
    expect(r.status).toBe(1);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'acceptance_requirement_undeclared' });
    expect(r.data.requirements.missing_declarations).toEqual(['check:vs-ready']);
    expect(existsSync(f.ran)).toBe(false);
    expect(readFileSync(join(f.root, REPORT), 'utf8')).toContain('`check:vs-ready`');
  });

  it('UT-S13-159: 不适用时不对账', () => {
    const cases: Array<[string, VsOptions]> = [
      ['无活跃提案', { verify: { requirements: { commands: ['node'] } } }],
      ['字段为「无」', { acceptance: '无' }],
      ['缺「验收标准」段', { acceptance: null }],
      ['条目全部已声明', { acceptance: '`command:node`', verify: { requirements: { commands: ['node'] } } }],
    ];
    for (const [label, opts] of cases) {
      const f = vs(opts);
      const r = verify(f);
      expect(r.data.gate.reason, label).not.toBe('acceptance_requirement_undeclared');
      expect(existsSync(f.ran), label).toBe(true);
    }
  });

  it('UT-S13-160: 环境变量缺失或为空', () => {
    const bin = fakeBin('vs-fake-tool');
    const req = { env: ['VS_TOKEN'], commands: ['vs-fake-tool'], checks: [{ name: 'vs-ready', command: 'node -e 0' }] };
    for (const [label, value] of [['未设置', undefined], ['空串', '']] as const) {
      const f = vs({ verify: { requirements: req } });
      const r = verify(f, { ...withPath(bin), VS_TOKEN: value });
      expect(r.data.gate, label).toEqual({ result: 'FAIL', reason: 'verify_env_not_ready' });
      expect(r.data.requirements.missing_environment, label).toEqual([{ kind: 'env', name: 'VS_TOKEN' }]);
      expect(existsSync(f.ran), label).toBe(false);
    }
    const ok = vs({ verify: { requirements: req } });
    const r = verify(ok, { ...withPath(bin), VS_TOKEN: SECRET });
    expect(existsSync(ok.ran)).toBe(true);
    const texts = [r.stdout, r.stderr, readFileSync(join(ok.root, REPORT), 'utf8'),
      ...readdirSync(join(ok.root, HISTORY_DIR)).map(n => readFileSync(join(ok.root, HISTORY_DIR, n), 'utf8'))];
    for (const text of texts) expect(text).not.toContain(SECRET);
  });

  it('UT-S13-161: 命令不在 PATH', () => {
    const f = vs({ verify: { requirements: { commands: ['vs-fake-tool'] } } });
    const r = verify(f);
    expect(r.data.gate.reason).toBe('verify_env_not_ready');
    expect(r.data.requirements.missing_environment).toEqual([{ kind: 'command', name: 'vs-fake-tool' }]);
    expect(existsSync(f.ran)).toBe(false);
    const r2 = verify(f, withPath(fakeBin('vs-fake-tool')));
    expect(r2.data.gate.reason).not.toBe('verify_env_not_ready');
    expect(existsSync(f.ran)).toBe(true);
  });

  it('UT-S13-162: 检查命令非零退出或超时', () => {
    const f = vs();
    writeFileSync(join(f.root, 'tools', 'check-exit.cjs'), `console.log('${SECRET}'); process.exit(3);\n`);
    writeFileSync(join(f.root, 'tools', 'check-hang.cjs'),
      `require('fs').writeFileSync(process.env.VS_PID_FILE, String(process.pid)); setInterval(() => {}, 1000);\n`);
    setConfig(f.root, v => { v.requirements = { checks: [{ name: 'vs-ready', command: 'node tools/check-exit.cjs' }] }; });
    const r1 = verify(f);
    expect(r1.data.gate.reason).toBe('verify_env_not_ready');
    expect(r1.data.requirements.missing_environment).toEqual([{ kind: 'check', name: 'vs-ready', detail: 'exit 3' }]);
    expect(r1.stdout).not.toContain(SECRET);
    expect(readFileSync(join(f.root, REPORT), 'utf8')).not.toContain(SECRET);
    expect(existsSync(f.ran)).toBe(false);

    const pidFile = join(dirname(f.root), `${f.root.split('/').pop()}.pid`);
    setConfig(f.root, v => { v.requirements = { checks: [{ name: 'vs-ready', command: 'node tools/check-hang.cjs' }] }; });
    const started = Date.now();
    const r2 = verify(f, { OPENLOGOS_VERIFY_CHECK_TIMEOUT_MS: '1000', VS_PID_FILE: pidFile });
    expect(Date.now() - started).toBeLessThan(60_000);
    expect(r2.data.requirements.missing_environment).toEqual([{ kind: 'check', name: 'vs-ready', detail: 'timeout' }]);
    expect(existsSync(f.ran)).toBe(false);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    expect(alive, '超时的检查进程须已被终止').toBe(false);
  });

  it('code-r1 F3：shell 先退出、后代仍持有输出管道——同一截止时间内判超时，预跑不启动', () => {
    const f = vs();
    const pidFile = join(dirname(f.root), `${f.root.split('/').pop()}.bgpid`);
    cleanups.push(() => { try { require('node:fs').rmSync(pidFile, { force: true }); } catch { /* ignore */ } });
    // 后台后代继承 stdout/stderr 并长时间存活，直接 shell 立即以 0 退出
    writeFileSync(join(f.root, 'tools', 'check-bg.cjs'),
      `require('fs').writeFileSync(process.env.VS_PID_FILE, String(process.pid)); setTimeout(() => {}, 30000);\n`);
    setConfig(f.root, v => { v.requirements = { checks: [{ name: 'vs-bg', command: 'node tools/check-bg.cjs & exit 0' }] }; });
    const started = Date.now();
    const r = verify(f, { OPENLOGOS_VERIFY_CHECK_TIMEOUT_MS: '1500', VS_PID_FILE: pidFile });
    expect(Date.now() - started, '须在截止时间附近返回，不等后代结束').toBeLessThan(20_000);
    expect(r.data.gate.reason).toBe('verify_env_not_ready');
    expect(r.data.requirements.missing_environment).toEqual([{ kind: 'check', name: 'vs-bg', detail: 'timeout' }]);
    expect(existsSync(f.ran)).toBe(false);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    let alive = true;
    try { process.kill(pid, 0); } catch { alive = false; }
    expect(alive, '持有管道的后代须已被终止').toBe(false);
  });

  it('code-r1 F2：预检失败不读取 smoke 账本——账本必定读失败时仍交付 verify_env_not_ready 与 none 历史', () => {
    const f = vs({ verify: { requirements: { env: ['VS_TOKEN'] } } });
    // smoke 结果路径是目录：任何读取都会抛 EISDIR
    mkdirSync(join(f.root, 'logos/resources/verify/smoke-results.jsonl'), { recursive: true });
    const r = verify(f, { VS_TOKEN: undefined });
    expect(r.status, r.stderr).toBe(1);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'verify_env_not_ready' });
    expect(r.data.smoke_precheck).toMatchObject({ executed_case_ids: [], changed_case_ids: [], diagnostics: [] });
    expect(readFileSync(join(f.root, REPORT), 'utf8')).toContain('verify_env_not_ready');
    expect(lastHistory(f.root)).toMatchObject({ result_source: 'none', gate: { result: 'FAIL', reason: 'verify_env_not_ready' } });
  });

  it('UT-S13-163: 按模块确定生效要求——模块级同名 check 只替换本模块', () => {
    const raw = {
      requirements: { checks: [{ name: 'dup', command: 'node -e "process.exit(1)"' }] },
      modules: { backend: { requirements: { checks: [{ name: 'dup', command: 'node -e 0' }], commands: ['vs-backend-only'] } } },
    };
    const declared = readDeclaredRequirements(raw);
    expect(declared.errors).toEqual([]);
    const core = computeEffectiveRequirements(declared, ['core']);
    expect(core.checks).toEqual([{ name: 'dup', command: 'node -e "process.exit(1)"', modules: ['core'] }]);
    expect(core.commands).toEqual([]);
    const backend = computeEffectiveRequirements(declared, ['backend']);
    expect(backend.checks).toEqual([{ name: 'dup', command: 'node -e 0', modules: ['backend'] }]);
    expect(backend.commands).toEqual(['vs-backend-only']);

    const root = vs().root;
    const sandbox = normalizeSandboxConfig({ sandbox_mode: 'off' });
    const pre = (served: string[], env: Record<string, string> = {}) => {
      const saved = process.env.PATH;
      if (env.PATH) process.env.PATH = env.PATH;
      try { return runVerifyPrecheck({ root, format: 'json', sandbox, rawVerify: raw, servedModules: served }); } finally { process.env.PATH = saved; }
    };
    const o1 = pre(['core']);
    expect(o1.reason).toBe('verify_env_not_ready');
    expect(o1.data!.missing_environment).toEqual([{ kind: 'check', name: 'dup', detail: 'exit 1', modules: ['core'] }]);
    const o2 = pre(['backend']);
    expect(o2.data!.missing_environment).toEqual([{ kind: 'command', name: 'vs-backend-only' }]);
    const o3 = pre(['backend'], withPath(fakeBin('vs-backend-only')));
    expect(o3.ok).toBe(true);
  });

  it('UT-S13-164: 预检全部通过后照常执行', () => {
    const req = { env: ['VS_TOKEN'], commands: ['vs-fake-tool'], checks: [{ name: 'vs-ready', command: 'node -e 0' }] };
    const f = vs({ verify: { requirements: req } });
    const r = verify(f, { ...withPath(fakeBin('vs-fake-tool')), VS_TOKEN: 'x' });
    expect(existsSync(f.ran)).toBe(true);
    expect(r.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(r.data.requirements.declared).toEqual({ env: ['VS_TOKEN'], commands: ['vs-fake-tool'], checks: [{ name: 'vs-ready' }] });
    expect(r.data.requirements.missing_declarations).toEqual([]);
    expect(r.data.requirements.missing_environment).toEqual([]);
  });

  it('UT-S13-169: 未声明任何要求的零变化', () => {
    for (const [label, opts] of [['VS 无要求无提案', {}], ['VS-prop 验收标准为「无」', { acceptance: '无' }]] as Array<[string, VsOptions]>) {
      const f = vs(opts);
      const r = verify(f);
      expect(r.status, label).toBe(0);
      expect(r.data.gate, label).toEqual({ result: 'PASS', reason: null });
      expect('requirements' in r.data, label).toBe(false);
      expect(r.data.summary, label).toMatchObject({ defined_count: 3, executed_count: 3, passed_count: 3, failed_count: 0, uncovered_count: 0 });
      expect(lastHistory(f.root).result_source, label).toBe('executed');
      expect(readFileSync(join(f.root, REPORT), 'utf8'), label).not.toContain('Verify Precheck');
    }
  });

  it('UT-S13-175: 检查命令经沙箱执行器在测试同一环境执行；无隔离时只读并如实标注', () => {
    // 检查命令以「当前目录是否就是宿主工作区」判定所处环境：隔离时在沙箱工作副本中执行（cwd ≠ 宿主），
    // 写入探针 check-wrote.txt 只落在工作副本；无隔离时在宿主工作区执行，只读检查不写任何文件。
    const isolatedCheck = `const fs = require('fs'); fs.writeFileSync('check-wrote.txt', 'x');
process.exit(fs.realpathSync(process.cwd()) === process.env.VS_HOST ? 0 : 3);\n`;
    const readOnlyCheck = `process.exit(require('fs').realpathSync(process.cwd()) === process.env.VS_HOST ? 0 : 3);\n`;

    // ① 隔离可用
    const f1 = vs();
    writeFileSync(join(f1.root, 'tools', 'check.cjs'), isolatedCheck);
    setConfig(f1.root, v => {
      v.sandbox_mode = 'always'; v.sandbox_root = join(dirname(f1.root), `${f1.root.split('/').pop()}-sbx`);
      v.requirements = { checks: [{ name: 'vs-ready', command: 'node tools/check.cjs' }] };
    });
    const before1 = workspaceSnapshot(f1.root);
    const r1 = verify(f1, { VS_HOST: f1.root });
    if (r1.data.requirements?.isolation === 'sandboxed') {
      expect(r1.data.gate.reason).toBe('verify_env_not_ready');
      expect(r1.data.requirements.missing_environment).toEqual([{ kind: 'check', name: 'vs-ready', detail: 'exit 3' }]);
      expect(readFileSync(join(f1.root, REPORT), 'utf8')).toContain('verify_env_not_ready');
    } else {
      // 当前平台无法隔离（always 下按既有规则判失败），同样不得执行预跑
      expect(r1.data.gate.reason).toBe('verify_env_not_ready');
    }
    expect(existsSync(join(f1.root, 'check-wrote.txt'))).toBe(false);
    expect(workspaceSnapshot(f1.root)).toEqual(before1);
    expect(existsSync(f1.ran)).toBe(false);

    // ② 隔离不可用 + always：以沙箱诊断判失败，检查与预跑都未执行
    const blocker = join(dirname(f1.root), `${f1.root.split('/').pop()}-blocker`);
    writeFileSync(blocker, 'not a directory');
    cleanups.push(() => require('node:fs').rmSync(blocker, { force: true }));
    const f2 = vs();
    writeFileSync(join(f2.root, 'tools', 'check.cjs'), isolatedCheck);
    setConfig(f2.root, v => { v.sandbox_mode = 'always'; v.sandbox_root = join(blocker, 'sub'); v.requirements = { checks: [{ name: 'vs-ready', command: 'node tools/check.cjs' }] }; });
    const r2 = verify(f2, { VS_HOST: f2.root });
    expect(r2.data.gate.reason).toBe('verify_env_not_ready');
    expect(r2.data.requirements.missing_environment).toEqual([{ kind: 'check', name: 'vs-ready', detail: 'sandbox-isolation-failed' }]);
    expect(r2.data.sandbox.status).toBe('fail');
    expect(r2.data.sandbox.diagnostics.join('\n')).toContain('无法启用沙箱');
    expect(existsSync(join(f2.root, 'check-wrote.txt'))).toBe(false);
    expect(existsSync(f2.ran)).toBe(false);

    // ③ 隔离不可用 + auto：按既有规则降级，在宿主工作区执行只读检查并如实标注未隔离
    const f3 = vs();
    writeFileSync(join(f3.root, 'tools', 'check.cjs'), readOnlyCheck);
    setConfig(f3.root, v => { v.sandbox_mode = 'auto'; v.sandbox_root = join(blocker, 'sub'); v.requirements = { checks: [{ name: 'vs-ready', command: 'node tools/check.cjs' }] }; });
    const before3 = workspaceSnapshot(f3.root);
    const r3 = verify(f3, { VS_HOST: f3.root });
    expect(r3.data.requirements.missing_environment).toEqual([]);
    expect(r3.data.requirements.isolation).toBe('unisolated');
    expect(existsSync(f3.ran)).toBe(true);
    expect(readFileSync(join(f3.root, RESULTS), 'utf8')).toContain('UT-S01-01');
    const after3 = workspaceSnapshot(f3.root);
    delete (after3 as Record<string, number>)['check-wrote.txt'];
    expect(after3).toEqual(before3);
  });

  it('UT-S13-176: 多模块合并——同名同命令合并、同名异命令分别执行', () => {
    const root = vs().root;
    const counter = join(dirname(root), `${root.split('/').pop()}.count`);
    cleanups.push(() => require('node:fs').rmSync(counter, { force: true }));
    const countCmd = `node -e "require('fs').appendFileSync(process.env.VS_COUNT, (process.env.OPENLOGOS_VERIFY_MODULES || '') + '\\\\n')"`;
    const sandbox = normalizeSandboxConfig({ sandbox_mode: 'off' });
    process.env.VS_COUNT = counter;
    try {
      // ① 同名同命令：只执行一次，归属模块 a,b
      const same = { modules: { a: { requirements: { checks: [{ name: 'db-ready', command: countCmd }] } }, b: { requirements: { checks: [{ name: 'db-ready', command: countCmd }] } } } };
      const o1 = runVerifyPrecheck({ root, format: 'json', sandbox, rawVerify: same, servedModules: ['a', 'b'] });
      expect(o1.ok).toBe(true);
      expect(readFileSync(counter, 'utf8').trim().split('\n')).toEqual(['a,b']);
      expect(o1.data!.declared.checks).toEqual([{ name: 'db-ready', modules: ['a', 'b'] }]);
      // ② 同名异命令：各执行一次，a 的数据库不可用
      require('node:fs').rmSync(counter, { force: true });
      const failA = `node -e "require('fs').appendFileSync(process.env.VS_COUNT, 'a-check\\\\n'); process.exit(2)"`;
      const okB = `node -e "require('fs').appendFileSync(process.env.VS_COUNT, 'b-check\\\\n')"`;
      const diff = { modules: { a: { requirements: { checks: [{ name: 'db-ready', command: failA }] } }, b: { requirements: { checks: [{ name: 'db-ready', command: okB }] } } } };
      const o2 = runVerifyPrecheck({ root, format: 'json', sandbox, rawVerify: diff, servedModules: ['a', 'b'] });
      expect(o2.reason).toBe('verify_env_not_ready');
      expect(o2.data!.missing_environment).toEqual([{ kind: 'check', name: 'db-ready', detail: 'exit 2', modules: ['a'] }]);
      expect(readFileSync(counter, 'utf8').trim().split('\n').sort()).toEqual(['a-check', 'b-check']);
    } finally {
      delete process.env.VS_COUNT;
    }
  });

  it('UT-S13-177: 预检失败的验收历史 result_source none 与快照落点', () => {
    // ① 无活跃提案，先留下 PASS 账本，再取消 VS_TOKEN
    const f1 = vs({ verify: { requirements: { env: ['VS_TOKEN'] } } });
    expect(verify(f1, { VS_TOKEN: 'x' }).data.gate.result).toBe('PASS');
    const ledgerBefore = readFileSync(join(f1.root, RESULTS), 'utf8');
    const r1 = verify(f1, { VS_TOKEN: undefined });
    expect(r1.data.gate.reason).toBe('verify_env_not_ready');
    const h1 = lastHistory(f1.root);
    expect(h1).toMatchObject({ outcome: 'completed', result_source: 'none', gate: { result: 'FAIL', reason: 'verify_env_not_ready' }, raw_location: 'none', proposal: null });
    expect(Object.values(h1.counts).every(v => v === null)).toBe(true);
    expect([h1.failed_ids, h1.skipped_ids, h1.uncovered_ids]).toEqual([[], [], []]);
    expect(readFileSync(join(f1.root, RESULTS), 'utf8')).toBe(ledgerBefore);
    const show1 = spawnSync(process.execPath, [CLI, 'history', 'show', h1.run_id, '--format', 'json'], { cwd: f1.root, encoding: 'utf8' });
    expect(show1.status, show1.stderr).toBe(0);

    // ② 有活跃提案、默认留存：提案完整记录只有 record.json 与 report.md
    const f2 = vs({ acceptance: '`command:vs-fake-tool`' });
    const r2 = verify(f2);
    expect(r2.data.gate.reason).toBe('acceptance_requirement_undeclared');
    const h2 = lastHistory(f2.root);
    expect(h2).toMatchObject({ result_source: 'none', raw_location: 'proposal' });
    const runDir2 = join(f2.root, 'logos/changes/vs-demo', h2.proposal.run_dir);
    expect(readdirSync(runDir2).sort()).toEqual(['record.json', 'report.md']);
    expect(readFileSync(join(runDir2, 'report.md'), 'utf8')).toContain('acceptance_requirement_undeclared');

    // ③ raw_in_proposal: false：提案目录只有结构化 record.json，快照在本机原文目录
    const f3 = vs({ acceptance: '`command:vs-fake-tool`', verify: { history: { raw_in_proposal: false } } });
    verify(f3);
    const h3 = lastHistory(f3.root);
    expect(h3).toMatchObject({ result_source: 'none', raw_location: 'local' });
    expect(readdirSync(join(f3.root, 'logos/changes/vs-demo', h3.proposal.run_dir))).toEqual(['record.json']);
    const local = join(f3.root, 'logos/.openlogos-runtime/verify-runs', h3.run_id);
    expect(readdirSync(local)).toEqual(['report.md']);
    const list = spawnSync(process.execPath, [CLI, 'history', 'list', '--format', 'json'], { cwd: f3.root, encoding: 'utf8' });
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toContain(h3.run_id);
  });

  it('UT-S13-178: 实际执行的命令组只用于选择模块级要求；无预跑命令时项目级要求仍预检', () => {
    // ① 多模块：a 有命令组，b 只有模块级 command:b-tool（本机没有）
    const root = tmpRoot();
    scaffoldProject(root, { locale: 'zh' });
    writeFileSync(join(root, 'logos', 'logos-project.yaml'), [
      'project:', '  name: vs-mod', 'modules:',
      '  - id: a', '    name: A', '    lifecycle: launched', '    paths: ["a/**"]',
      '  - id: b', '    name: B', '    lifecycle: launched', '    paths: ["b/**"]', '',
    ].join('\n'));
    writeFileSync(join(root, 'logos/resources/test/a-S01-test-cases.md'), testTable(['UT-S01-01']));
    writeFileSync(join(root, 'logos/resources/test/b-S02-test-cases.md'), testTable(['UT-S02-01']));
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools', 'run.cjs'), RUNNER);
    writeFileSync(join(root, 'tools', 'ids.json'), JSON.stringify(['UT-S01-01']));
    setConfig(root, v => {
      v.sandbox_mode = 'off';
      v.modules = { a: { pre_run_command: 'node tools/run.cjs' }, b: { requirements: { commands: ['b-tool'] } } };
    });
    const groups = selectVerifyCommandGroups(readVerifyConfig(root), ['a', 'b']);
    expect(groups.map(g => g.modules)).toEqual([['a']]);
    const ran = join(dirname(root), `${root.split('/').pop()}.RAN`);
    cleanups.push(() => require('node:fs').rmSync(ran, { force: true }));
    const r1 = verify({ root, ran }, {}, ['--all']);
    expect(r1.data.gate.reason).not.toBe('verify_env_not_ready');
    expect(existsSync(ran)).toBe(true);

    // ② 单模块、无预跑命令、已有 PASS 账本、显式声明的项目级 DB_URL 缺失
    const f = vs({ preRun: false, verify: { requirements: { env: ['DB_URL'], commands: ['vs-fake-tool'], checks: [{ name: 'db-ready', command: 'node -e 0' }] } } });
    writeFileSync(join(f.root, RESULTS), ['ST-S01-01', 'UT-S01-01', 'UT-S01-02'].map(id => JSON.stringify({ id, status: 'pass' })).join('\n') + '\n');
    const r2 = verify(f, { ...withPath(fakeBin('vs-fake-tool')), DB_URL: undefined });
    expect(r2.data.gate).toEqual({ result: 'FAIL', reason: 'verify_env_not_ready' });
    expect(r2.data.requirements.missing_environment).toEqual([{ kind: 'env', name: 'DB_URL' }]);
    const h = lastHistory(f.root);
    expect(h.result_source).toBe('none');
    expect(h.counts.defined).toBeNull();
  });

  it('ST-S13-40: 此前未声明要求的项目新增依赖后从正常入口生效', () => {
    const f = vs({ acceptance: '`command:vs-fake-tool`' });
    const r1 = verify(f);
    expect(r1.status).toBe(1);
    expect(r1.data.gate.reason).toBe('acceptance_requirement_undeclared');
    expect(existsSync(f.ran)).toBe(false);
    // 按提案把要求写入配置（[code] 任务在活跃提案内写入 verify.requirements）
    setConfig(f.root, v => { v.requirements = { commands: ['vs-fake-tool'] }; });
    const r2 = verify(f, { PATH: process.env.PATH });
    expect(r2.status).toBe(1);
    expect(r2.data.gate.reason).toBe('verify_env_not_ready');
    expect(r2.data.requirements.missing_environment).toEqual([{ kind: 'command', name: 'vs-fake-tool' }]);
    expect(existsSync(f.ran)).toBe(false);
    const r3 = verify(f, withPath(fakeBin('vs-fake-tool')));
    expect(r3.status).toBe(0);
    expect(r3.data.gate.result).toBe('PASS');
    expect(existsSync(f.ran)).toBe(true);
  });

  it('UT-S35-230: 解析与 verify 对账同源', () => {
    const value = '`env:DB_URL` `command:docker` `check:db-ready` — 数据库连接、容器与就绪检查';
    const f = vs({ acceptance: value });
    const proposal = readFileSync(join(f.root, 'logos/changes/vs-demo/proposal.md'), 'utf8');
    const lintEntries = parseAcceptanceCriteria(proposal).entries.map(e => e.raw);
    const verifyEntries = readAcceptanceEntries(f.root).map(e => e.raw);
    expect(lintEntries).toEqual(['env:DB_URL', 'command:docker', 'check:db-ready']);
    expect(verifyEntries).toEqual(lintEntries);
    // verify 侧不另写解析：对账读取经 acceptance-criteria 模块的同一函数
    const src = readFileSync(join(CLI_ROOT, 'src/lib/verify-requirements.ts'), 'utf8');
    expect(src).toContain("from './acceptance-criteria.js'");
    expect(src).not.toMatch(/\(env\|command\|check\)/);
    expect(readDeclaredRequirements(readRawVerifyConfig(f.root)).errors).toEqual([]);
  });
});
