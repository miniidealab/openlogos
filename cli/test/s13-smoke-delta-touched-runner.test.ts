/**
 * fix-delta-touched-by-case-change：安装态 smoke runner（scripts/smoke-delta-touched-by-case-change.js）的失败证据判据，不落真实全局环境。
 * 规格：core-smoke-test-cases.md「OpenLogos 0.16.29 测试用例文档按用例变化判断触及安装态 smoke」SMOKE-core-368～374 的失败处置——
 * 「保留信封、SPEC_MERGED 与调用记录」。本文件的用例是 runner 自身的判据测试，不对应、也不写入任何 SMOKE 用例结果。
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_VERSION, IDENTITY_CASE, OWNED, approvedVersionProblem, cleanupScopes, dispatchCases, fixtureD, verifyRun,
  // @ts-expect-error smoke runner 为 ESM .js 脚本，无类型声明；以模块方式导入时不执行主流程
} from '../../scripts/smoke-delta-touched-by-case-change.js';

vi.setConfig({ testTimeout: 180_000 });

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'dist', 'index.js');
type Row = { status: string; detail: string; evidence: string[] };
type Case = (entry: string) => Promise<{ detail: string; evidence: string[] }>;

/** 不遵循清单的测试入口：记录收到的清单，但执行并上报全部用例。 */
const WIDE_RUNNER = `import fs from 'node:fs';
import path from 'node:path';
const dir = 'logos/resources/test';
const own = [];
for (const file of fs.readdirSync(dir).filter(f => f.endsWith('-test-cases.md')).sort()) {
  for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\\n')) {
    const m = /^\\|\\s*((?:UT|ST)-[A-Za-z0-9]+-[0-9]+)\\s*\\|/.exec(line);
    if (m && !own.includes(m[1])) own.push(m[1]);
  }
}
let eligible = null;
try { const v = JSON.parse(process.env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS || 'null'); if (Array.isArray(v)) eligible = v; } catch {}
fs.appendFileSync(process.env.OPENLOGOS_DTC_LOG, JSON.stringify({ eligible, executed: own }) + '\\n');
const out = 'logos/resources/verify/test-results.jsonl';
fs.mkdirSync('logos/resources/verify', { recursive: true });
const now = new Date().toISOString();
fs.writeFileSync(out, own.map(id => JSON.stringify({ id, status: 'pass', scenario: id.split('-')[1], timestamp: now })).join('\\n') + '\\n');
`;

describe('安装态 smoke runner 判据：行为用例失败时保留原始证据（不落真实全局环境）', () => {
  it('执行集合不符与未合并两种失败：夹具清理后仍能从报告对照传入清单和实际执行记录', async () => {
    const roots: string[] = [];
    const pass: Case = async () => ({ detail: '通过', evidence: [] });
    const cases: Record<string, Case> = Object.fromEntries((OWNED as string[]).map(id => [id, pass]));
    // 执行集合不符：混合提案合并后，把测试入口换成不遵循清单的版本，再按 SMOKE-core-368 的口径判定
    cases['SMOKE-core-368'] = async entry => {
      const fx = await fixtureD(entry, 'evidence-mixed', { deltas: { 'test/core-S02-test-cases.md': '## ADDED — 主链路用例\n\n- UT-S02-01\n' } });
      roots.push(fx.root);
      writeFileSync(join(fx.root, 'tools/dtc-runner.mjs'), WIDE_RUNNER);
      const run = await verifyRun(entry, fx, null);
      const executed = Array.from(new Set(run.calls.flatMap((c: any) => c.executed as string[]))).sort();
      if (JSON.stringify(executed) !== JSON.stringify(['UT-S02-01', 'UT-S03-01'])) {
        throw Object.assign(new Error('入口应恰好执行 UT-S02-01、UT-S03-01'), { evidence: [`executed=${JSON.stringify(executed)}`] });
      }
      return { detail: '不应到达', evidence: [] };
    };
    // 未合并且未调用测试入口：对应文件缺失须明确记录
    cases['SMOKE-core-372'] = async entry => {
      const fx = await fixtureD(entry, 'evidence-unmerged', { deltas: { 'test/core-S02-test-cases.md': '## ADDED — 主链路用例\n\n- UT-S02-01\n' }, merged: false });
      roots.push(fx.root);
      throw Object.assign(new Error('故意失败：未合并分支'), { evidence: ['probe=unmerged'] });
    };

    const receipt = { deploy_id: 'test-deploy', result: 'done', environment: 'test', candidate_version: APPROVED_VERSION, entry_realpath: CLI };
    const rows = await dispatchCases(CLI, receipt, cases) as Map<string, Row>;
    cleanupScopes();
    expect(roots).toHaveLength(2);
    for (const root of roots) expect(existsSync(root)).toBe(false);

    // —— 执行集合不符 ——
    const mixed = rows.get('SMOKE-core-368')!;
    expect(mixed.status).toBe('fail');
    expect(mixed.evidence.some(e => e.startsWith('executed='))).toBe(true);
    // 逐次调用记录：原样保留入口收到的清单与实际执行的用例，可据此判断是 CLI 选错了用例还是入口没有遵循清单
    const callsLine = mixed.evidence.find(e => e.startsWith('artifact.fixture[evidence-mixed].calls='))!;
    expect(callsLine).toBeDefined();
    const calls = callsLine.slice(callsLine.indexOf('=') + 1).split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(calls).toHaveLength(1);
    expect(calls[0].eligible).toEqual(['UT-S02-01', 'UT-S03-01']);
    expect(calls[0].executed).toEqual(expect.arrayContaining(['UT-S02-01', 'UT-S02-02', 'UT-JSON-90', 'UT-S03-02']));
    // 合并标记全文
    const markerLine = mixed.evidence.find(e => e.startsWith('artifact.fixture[evidence-mixed].spec_merged='))!;
    const marker = JSON.parse(markerLine.slice(markerLine.indexOf('=') + 1));
    expect(marker.test_change_set.changed_test_ids).toEqual([]);
    expect(marker.merge_baseline.targets).toHaveLength(1);
    // 完整命令输出：verify 的信封可整体解析，不是截断后的片段
    const commands = mixed.evidence.filter(e => e.startsWith('artifact.command[')).map(e => JSON.parse(e.slice(e.indexOf('=') + 1)));
    expect(commands.map(c => c.args[0])).toEqual(['change', 'merge', 'verify']);
    const verifyCommand = commands.find(c => c.args[0] === 'verify');
    const envelope = JSON.parse(verifyCommand.stdout.trim());
    expect(envelope.command).toBe('verify');
    expect(envelope.data.layers.total.ids).toEqual(['UT-S02-01', 'UT-S03-01']);
    expect(verifyCommand.stdout.length).toBeGreaterThan(300);

    // —— 未合并、未调用入口：明确记录缺失 ——
    const unmerged = rows.get('SMOKE-core-372')!;
    expect(unmerged.status).toBe('fail');
    expect(unmerged.evidence).toContain('probe=unmerged');
    expect(unmerged.evidence.find(e => e.startsWith('artifact.fixture[evidence-unmerged].spec_merged='))).toContain('缺失');
    expect(unmerged.evidence.find(e => e.startsWith('artifact.fixture[evidence-unmerged].calls='))).toContain('缺失');
    // 轨迹按用例隔离：未合并用例的证据里没有上一条用例的 merge / verify
    const unmergedCommands = unmerged.evidence.filter(e => e.startsWith('artifact.command[')).map(e => JSON.parse(e.slice(e.indexOf('=') + 1)).args[0]);
    expect(unmergedCommands).toEqual(['change']);

    // 通过的用例不附带失败证据
    const passed = rows.get('SMOKE-core-369')!;
    expect(passed.status).toBe('pass');
    expect(passed.evidence.some(e => e.startsWith('artifact.'))).toBe(false);
    expect(rows.get(IDENTITY_CASE)!.status).toBe('pass');
  });

  it('建夹具的 init 失败：超过错误摘要长度的完整输出仍保留在该用例的失败记录中', async () => {
    // 假的被测入口：init 向 stdout / stderr 各写出超过 300 个字符的内容，末尾带可辨识的诊断，然后以 1 退出
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'openlogos-dtc-fake-entry-')));
    const fake = join(dir, 'fake-cli.mjs');
    writeFileSync(fake, [
      "if (process.argv[2] === '--version') { console.log('0.0.0'); process.exit(0); }",
      "process.stdout.write('o'.repeat(600) + ' STDOUT-TAIL-MARKER\\n');",
      "process.stderr.write('e'.repeat(600) + ' STDERR-TAIL-DIAGNOSTIC\\n');",
      'process.exit(1);',
    ].join('\n'));
    try {
      const pass: Case = async () => ({ detail: '通过', evidence: [] });
      const cases: Record<string, Case> = Object.fromEntries((OWNED as string[]).map(id => [id, pass]));
      cases['SMOKE-core-368'] = async entry => {
        await fixtureD(entry, 'evidence-init', { deltas: {} });
        return { detail: '不应到达', evidence: [] };
      };
      const receipt = { deploy_id: 'test-deploy', result: 'done', environment: 'test', candidate_version: APPROVED_VERSION, entry_realpath: fake };
      const rows = await dispatchCases(fake, receipt, cases) as Map<string, Row>;
      cleanupScopes();

      const row = rows.get('SMOKE-core-368')!;
      expect(row.status).toBe('fail');
      // 错误摘要只取前 300 个字符，读不到末尾的诊断
      expect(row.detail).not.toContain('STDERR-TAIL-DIAGNOSTIC');
      // init 失败发生在登记夹具之前：没有夹具条目，但失败的 init 轨迹完整保留
      expect(row.evidence.some(e => e.startsWith('artifact.fixture['))).toBe(false);
      const commands = row.evidence.filter(e => e.startsWith('artifact.command[')).map(e => JSON.parse(e.slice(e.indexOf('=') + 1)));
      expect(commands).toHaveLength(1);
      expect(commands[0].args[0]).toBe('init');
      expect(commands[0].status).toBe(1);
      expect(commands[0].stderr.length).toBeGreaterThan(600);
      expect(commands[0].stderr.trimEnd().endsWith('STDERR-TAIL-DIAGNOSTIC')).toBe(true);
      expect(commands[0].stdout.trimEnd().endsWith('STDOUT-TAIL-MARKER')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('批准版本、全局版本、回执与源码候选版本四者必须相等', () => {
    const receipt = { candidate_version: APPROVED_VERSION };
    expect(approvedVersionProblem(APPROVED_VERSION, receipt, APPROVED_VERSION)).toBeNull();
    // 三者彼此相等但不是批准版本：仍判不符
    const other = '0.16.30';
    const problem = approvedVersionProblem(other, { candidate_version: other }, other);
    expect(problem).toContain(APPROVED_VERSION);
    expect(problem).toContain(other);
    expect(approvedVersionProblem(APPROVED_VERSION, { candidate_version: other }, APPROVED_VERSION)).toContain('candidate_version');
    expect(approvedVersionProblem(APPROVED_VERSION, receipt, null)).toContain('源码候选版本');
  });
});
