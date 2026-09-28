/**
 * fix-json-output-flush-before-exit：verify / smoke `--format json` 非零退出时 envelope 经管道完整输出。
 *
 * 覆盖 UT-S16-42～UT-S16-45、ST-S16-05（场景 S16 EX-2.6）。
 * 一律以 `child_process.spawn` 启动真实 CLI（dist/index.js），stdout 为管道，读到 `close` 后再解析；
 * 夹具把 envelope 撑到 > 64KB 并先断言字节数，防夹具不够大导致用例空过。
 * 全局 OpenLogos reporter 按用例名中的 ID 写入 test-results.jsonl。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempRoot, scaffoldProject, captureConsole, mockCwd, mockProcessExit, takeExitCode } from './helpers.js';
import { buildTestChangeSet } from '../src/lib/test-change-set.js';
import { verify } from '../src/commands/verify.js';

const CLI = join(__dirname, '..', 'dist', 'index.js');
const PIPE_BUFFER = 65536;
const TIMEOUT = 60_000;

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

interface PipedRun { code: number | null; stdout: Buffer; stderr: string }

/** 以管道方式运行子进程并收集 stdout 全部 chunk 直至 close。 */
function runPiped(args: string[], cwd: string): Promise<PipedRun> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.OPENLOGOS_VERIFY_ELIGIBLE_TEST_IDS;
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8') }));
  });
}

const runCli = (cwd: string, args: string[]) => runPiped([CLI, ...args], cwd);

function newProject(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'en' });
  return root;
}

function ids(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(4, '0')}`);
}

/** verify Gate FAIL：大量失败用例，envelope 远超一个管道缓冲。 */
const VERIFY_FAIL_COUNT = 1500;
function verifyGateFailFixture(): string {
  const root = newProject();
  const caseIds = ids('UT-S01', VERIFY_FAIL_COUNT);
  writeFileSync(join(root, 'logos/resources/test/core-S01-test-cases.md'), [
    '# Test Cases', '| ID | desc |', '|---|---|', ...caseIds.map(id => `| ${id} | d |`), '',
  ].join('\n'));
  writeFileSync(join(root, 'logos/resources/verify/test-results.jsonl'), caseIds.map(id => JSON.stringify({
    id, status: 'fail', error: `assertion failed for ${id}: ${'x'.repeat(60)}`,
  })).join('\n') + '\n');
  return root;
}

/** verify 切片 manifest 暂停：可信 change set 含大量变更 ID，manifest 缺失（→ 2）或 schema 不受支持（→ 1）。 */
function manifestPauseFixture(kind: 'missing' | 'unsupported'): string {
  const root = newProject();
  const change = 'pause-fixture';
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: change, module: 'core' }));
  const dir = join(root, 'logos', 'changes', change);
  mkdirSync(dir, { recursive: true });
  const changed = ids('UT-S99', 6000);
  const target = 'logos/resources/test/core-S99-test-cases.md';
  const table = ['| ID | 用例 |', '|---|---|', ...changed.map(id => `| ${id} | fixture |`)].join('\n');
  writeFileSync(join(root, target), table);
  writeFileSync(join(dir, 'tasks.md'), [
    '# 实现任务', '', '## [code] 代码实现',
    '- [ ] 切片 1：能力 1（覆盖 UT-S99-0001）',
    '- [ ] 切片 2：能力 2（覆盖 UT-S99-0002）', '',
  ].join('\n'));
  const testChangeSet = buildTestChangeSet({
    change, module: 'core',
    targets: [{ targetPath: target, beforeBytes: null, afterBytes: Buffer.from(table) }],
  });
  writeFileSync(join(dir, 'SPEC_MERGED'), `${JSON.stringify({
    type: 'baseline_closure_spec_complete', test_change_set: testChangeSet,
  }, null, 2)}\n`);
  if (kind === 'unsupported') {
    writeFileSync(join(dir, 'TEST_SLICE_MANIFEST.json'), JSON.stringify({ schema: 'openlogos/test-slice-manifest@2' }));
  }
  return root;
}

/** smoke：提案需 smoke 且已部署，delta 新增大量 SMOKE 用例；results 缺失（臂 ①）或全部失败（臂 ②）。 */
const SMOKE_COUNT = 3000;
function smokeFixture(arm: 'no-results' | 'gate-fail'): string {
  const root = newProject();
  const change = 'deploy-feature';
  // SMOKE ID 序号最多 3 位（SMOKE_ID_PATTERN），按块分段：SMOKE-c0-001 … SMOKE-c2-999
  const smokeIds = Array.from({ length: SMOKE_COUNT }, (_, i) => `SMOKE-c${Math.floor(i / 999)}-${String((i % 999) + 1).padStart(3, '0')}`);
  const table = smokeIds.map(id => `| ${id} | case |`).join('\n');
  mkdirSync(join(root, 'logos/resources/test/smoke'), { recursive: true });
  writeFileSync(join(root, 'logos/resources/test/smoke/core-smoke-test-cases.md'), table);
  const dir = join(root, 'logos', 'changes', change);
  mkdirSync(join(dir, 'deltas/test/smoke'), { recursive: true });
  writeFileSync(join(root, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: change, module: 'core' }));
  writeFileSync(join(dir, 'deltas/test/smoke/core-smoke-test-cases.md'), table);
  writeFileSync(join(dir, 'proposal.md'), [
    '# 变更提案：fixture', '', '## 部署影响',
    '- 是否需要部署：是', '- 部署原因：夹具', '- 影响环境：staging',
    '- 是否涉及数据迁移：否', '- 是否需要回滚预案：否', '- 是否需要 smoke：是',
  ].join('\n'));
  writeFileSync(join(dir, 'tasks.md'), ['# 实现任务', '', '## [deploy] 部署任务', '- [x] 部署到 staging'].join('\n'));
  writeFileSync(join(dir, 'DEPLOY_DONE'), '');
  if (arm === 'gate-fail') {
    writeFileSync(join(root, 'logos/resources/verify/smoke-results.jsonl'), smokeIds.map(id => JSON.stringify({
      id, status: 'fail', error: `smoke failed for ${id}`,
    })).join('\n') + '\n');
  }
  return root;
}

function parseEnvelope(run: PipedRun): any {
  expect(run.stdout.length).toBeGreaterThan(PIPE_BUFFER);
  return JSON.parse(run.stdout.toString('utf8'));
}

describe('S16 EX-2.6 — 非零退出码下 envelope 经管道完整输出', () => {
  it('UT-S16-42: verify Gate FAIL 管道完整输出', async () => {
    const run = await runCli(verifyGateFailFixture(), ['verify', '--format', 'json']);
    const envelope = parseEnvelope(run);
    expect(envelope.command).toBe('verify');
    expect(envelope.data.gate.result).not.toBe('PASS');
    expect(envelope.data.failed_cases).toHaveLength(VERIFY_FAIL_COUNT);
    expect(run.code).toBe(1);
  }, TIMEOUT);

  it('UT-S16-43: verify 切片 manifest 暂停管道完整输出且退出码语义不变', async () => {
    const missing = await runCli(manifestPauseFixture('missing'), ['verify', '--format', 'json']);
    const envelope = parseEnvelope(missing);
    expect(envelope.command).toBe('verify');
    expect(envelope.data.reason).toBe('test-slice-manifest-missing');
    expect(envelope.data.slice_verification_state).toBeDefined();
    expect(envelope.data.slice_verification_state.test_change_set.changed_test_ids).toHaveLength(6000);
    // 暂停后不再执行后续判定：stdout 只含这一份 envelope
    expect(missing.stdout.toString('utf8').trim().split('\n')).toHaveLength(1);
    expect(missing.code).toBe(2);

    const unsupported = await runCli(manifestPauseFixture('unsupported'), ['verify', '--format', 'json']);
    const envelope2 = parseEnvelope(unsupported);
    expect(envelope2.data.reason).toBe('test-slice-manifest-unsupported');
    expect(unsupported.stdout.toString('utf8').trim().split('\n')).toHaveLength(1);
    expect(unsupported.code).toBe(1);
  }, TIMEOUT);

  it('UT-S16-43: manifest 暂停只改 JSON 分支，text 分支仍立即 process.exit 原退出码', () => {
    const root = manifestPauseFixture('missing');
    const restoreCwd = mockCwd(root);
    const con = captureConsole();
    const exitSpy = mockProcessExit();
    try {
      // text 路径不在本修复范围：保留 stderr 输出与 process.exit(2)，不设 exitCode
      expect(() => verify('text')).toThrow('process.exit(2)');
      expect(takeExitCode()).toBeUndefined();
      expect(con.errors.join('\n')).toContain('test-slice-manifest-missing');
      exitSpy.mockClear();
      // JSON 路径：不调用 process.exit，改设 exitCode=2 后返回
      verify('json');
      expect(exitSpy).not.toHaveBeenCalled();
      expect(takeExitCode()).toBe(2);
    } finally {
      takeExitCode();
      exitSpy.mockRestore();
      con.restore();
      restoreCwd();
    }
  });

  it('UT-S16-44: smoke 两个非零退出点管道完整输出', async () => {
    const noResults = await runCli(smokeFixture('no-results'), ['smoke', '--format', 'json']);
    const envelope = parseEnvelope(noResults);
    expect(envelope.command).toBe('smoke');
    expect(noResults.code).toBe(1);
    // JSON 模式不再落入其后的文本错误输出
    expect(noResults.stderr).not.toContain('No smoke results found');

    const gateFail = await runCli(smokeFixture('gate-fail'), ['smoke', '--format', 'json']);
    const envelope2 = parseEnvelope(gateFail);
    expect(envelope2.command).toBe('smoke');
    expect(envelope2.data.gate.result).not.toBe('PASS');
    expect(gateFail.code).toBe(1);
  }, TIMEOUT);

  it('UT-S16-45: 立即 process.exit 截断必红对照', async () => {
    // stdout 管道写入是否异步取决于平台：darwin 为异步（本修复的根因复现平台），对照臂必须真的截断；
    // 其余平台（如 Windows 管道同步写出）未截断不判为产品失败，只检验完整输出与非零退出码。
    // 载荷有限三档：未截断时加大输出量重试，而非无界增大。
    const requireTruncation = process.platform === 'darwin';
    const overhead = '{"pad":""}\n'.length;
    let truncated: { written: number; received: number; parsed: boolean } | null = null;
    for (const size of [200_000, 2_000_000, 8_000_000]) {
      const script = `const s=JSON.stringify({pad:'x'.repeat(${size})});console.log(s);process.exit(1);`;
      const run = await runPiped(['-e', script], process.cwd());
      const written = size + overhead;
      let parsed = true;
      try { JSON.parse(run.stdout.toString('utf8')); } catch { parsed = false; }
      expect(run.code).toBe(1);
      if (run.stdout.length < written) { truncated = { written, received: run.stdout.length, parsed }; break; }
      // 未截断：输出必然完整可解析
      expect(run.stdout.length).toBe(written);
      expect(parsed).toBe(true);
    }
    if (requireTruncation) expect(truncated).not.toBeNull();
    if (truncated) {
      expect(truncated.received).toBeLessThan(truncated.written);
      expect(truncated.parsed).toBe(false);
    }

    const size = truncated ? truncated.written - overhead : 200_000;
    const fixed = await runPiped(['-e', `const s=JSON.stringify({pad:'x'.repeat(${size})});console.log(s);process.exitCode=1;`], process.cwd());
    expect(fixed.stdout.length).toBe(size + overhead);
    expect(JSON.parse(fixed.stdout.toString('utf8')).pad).toHaveLength(size);
    expect(fixed.code).toBe(1);
  }, TIMEOUT);
});

describe('S16 EX-2.6 — 管道消费方在 FAIL / 暂停时拿到完整 envelope 并分流', () => {
  it('ST-S16-05: 三种非零退出状态均可解析并按 data 与退出码分流', async () => {
    const states = [
      { name: 'verify-gate-fail', root: verifyGateFailFixture(), args: ['verify', '--format', 'json'], code: 1 },
      { name: 'verify-manifest-pause', root: manifestPauseFixture('missing'), args: ['verify', '--format', 'json'], code: 2 },
      { name: 'smoke-gate-fail', root: smokeFixture('gate-fail'), args: ['smoke', '--format', 'json'], code: 1 },
    ];
    const routed: string[] = [];
    for (const state of states) {
      const run = await runCli(state.root, state.args);
      let envelope: any;
      try { envelope = JSON.parse(run.stdout.toString('utf8')); } catch { routed.push(`${state.name}:invalid-json`); continue; }
      expect(run.code).toBe(state.code);
      if (envelope.data.reason) routed.push(`${state.name}:pause:${envelope.data.reason}`);
      else routed.push(`${state.name}:gate:${envelope.data.gate.result}`);
      if (state.name === 'verify-gate-fail') {
        // 尾部未丢：失败明细条数与夹具构造的失败数一致
        expect(envelope.data.failed_cases).toHaveLength(VERIFY_FAIL_COUNT);
        expect(envelope.data.failed_cases.at(-1).id).toBe(`UT-S01-${String(VERIFY_FAIL_COUNT).padStart(4, '0')}`);
      }
    }
    expect(routed).toEqual([
      'verify-gate-fail:gate:FAIL',
      'verify-manifest-pause:pause:test-slice-manifest-missing',
      'smoke-gate-fail:gate:FAIL',
    ]);
  }, TIMEOUT);
});
