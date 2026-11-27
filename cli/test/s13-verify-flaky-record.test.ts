/**
 * verify-flaky-rerun 切片 3：偶发清单的验收报告小节、文本输出与验收历史。
 * 用例 ID 与 logos/resources/test/core-S13-test-cases.md「S13 失败用例复跑与偶发判定测试」严格对齐：
 * UT-S13-205～209、ST-S13-44、ST-S13-45。
 * 测试结果由全局 OpenLogos reporter（vitest.config.ts 注册）写入 logos/resources/verify/test-results.jsonl。
 *
 * 夹具 RR：单模块 core（launched），UT-S01-01～03；记录型 runner tools/rr-runner.mjs 按剧本决定第 n 次调用写 pass / fail，
 * 每次在 stdout 打印标记 RR-STDOUT-MARKER（用于断言报告不写命令输出）；调用次数只读项目外调用记录。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempRoot, scaffoldProject, withCompleteClarification } from './helpers.js';

vi.setConfig({ testTimeout: 120_000 });

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'index.js');
const RESULTS = 'logos/resources/verify/test-results.jsonl';
const REPORT = 'logos/resources/verify/acceptance-report.md';
const HISTORY_DIR = 'logos/resources/verify/history';
const MARKER = 'RR-STDOUT-MARKER';

const RUNNER = `import fs from 'node:fs';
const script = JSON.parse(fs.readFileSync('tools/rr-script.json', 'utf8'));
const log = process.env.RR_LOG;
const n = (log && fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\\n').filter(Boolean).length : 0) + 1;
if (log) fs.appendFileSync(log, JSON.stringify({ call: n, eligible: process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS ?? null, cwd: process.cwd() }) + '\\n');
console.log('${MARKER} call ' + n);
fs.mkdirSync('logos/resources/verify', { recursive: true });
const out = 'logos/resources/verify/test-results.jsonl';
fs.writeFileSync(out, '');
let eligible = null;
try { const v = JSON.parse(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS || 'null'); if (Array.isArray(v)) eligible = new Set(v); } catch {}
const lines = [];
let anyFail = false;
for (const [id, plan] of Object.entries(script.cases)) {
  if (eligible && !eligible.has(id)) continue;
  const status = Array.isArray(plan) ? plan[Math.min(n, plan.length) - 1] : plan;
  if (!status || status === 'none') continue;
  const rec = { id, status, scenario: 'S01', call: n, timestamp: new Date().toISOString() };
  if (status === 'fail') { rec.error = 'RR ' + id + ' failed on call ' + n; anyFail = true; }
  lines.push(JSON.stringify(rec));
}
fs.writeFileSync(out, lines.length ? lines.join('\\n') + '\\n' : '');
process.exit(anyFail ? 1 : 0);
`;

type Plan = string | string[];
interface Rr { root: string; log: string; proposalDir: string | null }

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tmpRoot(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  return realpathSync(root);
}

function rr(cases: Record<string, Plan>, opts: { verify?: Record<string, unknown>; proposal?: boolean; locale?: 'zh' | 'en' } = {}): Rr {
  const root = tmpRoot();
  scaffoldProject(root, { locale: opts.locale ?? 'zh' });
  writeFileSync(join(root, 'logos', 'logos-project.yaml'),
    ['project:', '  name: rr', 'modules:', '  - id: core', '    name: Core', '    lifecycle: launched', ''].join('\n'));
  mkdirSync(join(root, 'logos/resources/test'), { recursive: true });
  writeFileSync(join(root, 'logos/resources/test/core-S01-test-cases.md'),
    ['| ID | 描述 |', '|---|---|', ...['UT-S01-01', 'UT-S01-02', 'UT-S01-03'].map(id => `| ${id} | ${id} fixture |`)].join('\n') + '\n');
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(join(root, 'tools', 'rr-runner.mjs'), RUNNER);
  writeFileSync(join(root, 'tools', 'rr-script.json'), JSON.stringify({ cases }));
  const cfgPath = join(root, 'logos', 'logos.config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.verify = { result_path: RESULTS, sandbox_mode: 'off', pre_run_command: 'node tools/rr-runner.mjs', ...(opts.verify ?? {}) };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  let proposalDir: string | null = null;
  if (opts.proposal) {
    const slug = 'rr-demo';
    proposalDir = join(root, 'logos', 'changes', slug);
    mkdirSync(proposalDir, { recursive: true });
    writeFileSync(join(proposalDir, 'proposal.md'), withCompleteClarification([
      `# 变更提案：${slug}`, '', '## 变更原因', '偶发夹具。', '', '## 变更类型', '代码级', '',
      '## 变更范围', '- CLI', '', '## 部署影响', '- 是否需要部署：否', '- 部署原因：测试夹具', '- 影响环境：无',
      '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：否', '', '## 变更概述', '夹具。',
    ].join('\n')));
    writeFileSync(join(proposalDir, 'tasks.md'), ['# 实现任务', '', '## [code] 代码实现', '- [x] 实现', ''].join('\n'));
    writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: slug, module: 'core' }));
  }
  return { root, log: join(tmpRoot(), 'calls.jsonl'), proposalDir };
}

function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1' };
  for (const k of Object.keys(env)) {
    if (k.startsWith('OPENLOGOS_VERIFY_') || k.startsWith('OPENLOGOS_TEST_') || k.startsWith('RR_')) delete env[k];
  }
  return { ...env, ...extra } as NodeJS.ProcessEnv;
}

function cli(f: Rr, args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: f.root, encoding: 'utf8', env: cleanEnv({ RR_LOG: f.log }), timeout: 120_000 });
  const line = (r.stdout ?? '').split('\n').reverse().find(l => l.trim().startsWith('{'));
  let data: any = null;
  try { data = line ? JSON.parse(line).data : null; } catch { data = null; }
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', data };
}

const verifyJson = (f: Rr) => cli(f, ['verify', '--format', 'json']);
const calls = (f: Rr) => existsSync(f.log) ? readFileSync(f.log, 'utf8').split('\n').filter(Boolean) : [];
const report = (f: Rr) => readFileSync(join(f.root, REPORT), 'utf8');
const FLAKY = { 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' };

function flakySection(md: string): string | null {
  const start = md.indexOf('## 偶发用例 / Flaky Cases');
  if (start < 0) return null;
  const next = md.indexOf('\n## ', start + 1);
  return md.slice(start, next < 0 ? undefined : next);
}

describe('S13 偶发清单的报告、文本与历史（verify-flaky-rerun 切片 3）', () => {
  it('UT-S13-205: 验收报告的偶发用例小节', () => {
    const f = rr(FLAKY);
    const r = verifyJson(f);
    expect(r.data.gate.result).toBe('PASS');
    const md = report(f);
    const section = flakySection(md);
    expect(section).not.toBeNull();
    expect(section).toContain('| UT-S01-01 | core | RR UT-S01-01 failed on call 1 |');
    expect(section).toContain('首跑失败、同一沙箱内复跑通过；请确认不是首次运行改变了环境');
    expect(md).not.toContain(MARKER);
    // 无偶发时不出现该小节
    const g = rr({ 'UT-S01-01': 'pass', 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' });
    verifyJson(g);
    expect(flakySection(report(g))).toBeNull();
  });

  it('UT-S13-206: 验收历史记录偶发', () => {
    const f = rr(FLAKY);
    const r = verifyJson(f);
    const runId = r.data.history.run_id;
    const shown = cli(f, ['history', 'show', runId, '--format', 'json']);
    expect(shown.status, shown.stderr).toBe(0);
    expect(shown.data.run.flaky_ids).toEqual(['UT-S01-01']);
    expect(shown.data.run.failed_ids).toEqual([]);
    expect(shown.data.run.counts).toMatchObject({ failed: 0, passed: 3 });
    // 没有偶发的运行该数组为空
    const g = rr({ 'UT-S01-01': 'pass', 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' });
    const rg = verifyJson(g);
    const index = JSON.parse(readFileSync(join(g.root, HISTORY_DIR, `${rg.data.history.run_id}.json`), 'utf8'));
    expect(index.flaky_ids).toEqual([]);
  });

  it('UT-S13-207: 历史读取兼容', () => {
    const f = rr({ 'UT-S01-01': 'pass', 'UT-S01-02': 'pass', 'UT-S01-03': 'pass' });
    const r = verifyJson(f);
    const dir = join(f.root, HISTORY_DIR);
    const base = JSON.parse(readFileSync(join(dir, `${r.data.history.run_id}.json`), 'utf8'));
    // 历史目录只保留下面三份预置记录（以本次真实写出的记录为模板）
    for (const name of readdirSync(dir)) if (name.endsWith('.json')) rmSync(join(dir, name));
    const write = (runId: string, patch: (rec: Record<string, any>) => void) => {
      const rec = { ...base, run_id: runId };
      patch(rec);
      writeFileSync(join(dir, `${runId}.json`), JSON.stringify(rec, null, 2));
    };
    const missing = '20261101T000000001Z-verify-aaaaa1';
    const empty = '20261101T000000002Z-verify-aaaaa2';
    const bad = '20261101T000000003Z-verify-aaaaa3';
    write(missing, rec => { delete rec.flaky_ids; });
    write(empty, rec => { rec.flaky_ids = []; });
    write(bad, rec => { rec.flaky_ids = 'x'; });
    const listed = cli(f, ['history', 'list', '--format', 'json']);
    expect(listed.status, listed.stderr).toBe(0);
    const ids = listed.data.runs.map((run: any) => run.run_id).sort();
    expect(ids).toEqual([missing, empty]);
    for (const run of listed.data.runs) expect(run.flaky_ids).toEqual([]);
    expect(listed.data.warnings).toEqual([expect.objectContaining({ code: 'verification_history_corrupt', path: `${HISTORY_DIR}/${bad}.json` })]);
  });

  it('UT-S13-208: 文本模式输出偶发清单', () => {
    for (const locale of ['zh', 'en'] as const) {
      const f = rr(FLAKY, { locale });
      const r = cli(f, ['verify']);
      expect(r.status, `${locale}: ${r.stderr}`).toBe(0);
      const out = r.stdout;
      const title = locale === 'zh' ? '偶发用例（1 条）：首跑失败、同一沙箱内复跑通过' : 'Flaky cases (1): failed on the first run, passed on a rerun in the same sandbox';
      const hint = locale === 'zh' ? '请确认不是首次运行改变了环境' : 'Make sure the first run did not change the environment';
      expect(out, locale).toContain(title);
      expect(out, locale).toContain(hint);
      expect(out, locale).toMatch(/UT-S01-01\s+core\s+RR UT-S01-01 failed on call 1/);
      const gateLine = out.search(/✅ .*(Gate|门禁|PASS)/);
      expect(gateLine, locale).toBeGreaterThanOrEqual(0);
      expect(out.indexOf(title), locale).toBeGreaterThan(gateLine);
    }
  });

  it('UT-S13-209: VERIFY_PASS 照常写入', () => {
    const f = rr(FLAKY, { proposal: true });
    const r = verifyJson(f);
    expect(r.data.gate).toEqual({ result: 'PASS', reason: null });
    expect(existsSync(join(f.proposalDir!, 'VERIFY_PASS'))).toBe(true);
    expect(existsSync(join(f.proposalDir!, 'VERIFY_FAIL'))).toBe(false);
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(flakySection(report(f))).toContain('UT-S01-01');
  });
});

describe('S13 偶发清单场景测试（verify-flaky-rerun 切片 3）', () => {
  it('ST-S13-44: 偶发失败不再打断验收', () => {
    const sandboxRoot = tmpRoot();
    const f = rr(FLAKY, { verify: { sandbox_mode: 'always', sandbox_root: sandboxRoot, sandbox_deny_workspace_write: false } });
    // ① verify
    const r = verifyJson(f);
    expect(r.status, r.stderr).toBe(0);
    expect(calls(f)).toHaveLength(2);
    expect(r.data.gate.result).toBe('PASS');
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    expect(r.data.warnings.map((w: any) => w.code)).toContain('flaky_cases_present');
    // ② result_path 三条最终记录，报告含偶发小节
    const rows = readFileSync(join(f.root, RESULTS), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(rows.map(row => row.id).sort()).toEqual(['UT-S01-01', 'UT-S01-02', 'UT-S01-03']);
    expect(rows.every(row => row.status === 'pass')).toBe(true);
    expect(flakySection(report(f))).toContain('UT-S01-01');
    // ③ 历史最新记录带 flaky_ids
    const listed = cli(f, ['history', 'list', '--format', 'json']);
    expect(listed.data.runs[0].flaky_ids).toEqual(['UT-S01-01']);
  });

  it('ST-S13-45: 真失败不被复跑放过', () => {
    const f = rr({ 'UT-S01-01': ['fail', 'pass'], 'UT-S01-02': 'fail', 'UT-S01-03': 'pass' });
    const r = verifyJson(f);
    expect(r.status).not.toBe(0);
    expect(r.data.gate).toEqual({ result: 'FAIL', reason: 'failed_cases' });
    expect(r.data.failed_cases.map((c: any) => c.id)).toEqual(['UT-S01-02']);
    expect(r.data.flaky_cases.map((c: any) => c.id)).toEqual(['UT-S01-01']);
    const md = report(f);
    expect(md).toContain('## Failed Cases');
    expect(md).toMatch(/\| UT-S01-02 \| RR UT-S01-02 failed on call 2 \|/);
    expect(flakySection(md)).toContain('UT-S01-01');
  });
});
