/**
 * verification-history code-r1 回归（F1 运行锁原子发布与回收仲裁、F3 结果读取失败、F4 smoke 账本收尾失败、F5 白名单值类型）。
 * F2（损坏索引校验）的回归在 UT-S13-154 内。本文件不认领 UT/ST 编号。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';
import { makeTempRoot, scaffoldProject } from './helpers.js';
import { acquireResultPathLocks, ResultPathBusyError, RESULT_LOCK_DIR, resolveRealPath } from '../src/lib/result-path-lock.js';
import { startHistoryRun, writeHistoryRun, splitResultLines } from '../src/lib/verification-history.js';

vi.setConfig({ testTimeout: 120_000 });
const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(CLI_ROOT, 'dist', 'index.js');
const SECRET = 'SECRET-PLACEHOLDER-7f3a';
const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function tmpProject(): string {
  const { root, cleanup } = makeTempRoot();
  cleanups.push(cleanup);
  scaffoldProject(root, { locale: 'zh' });
  return root;
}
const lockFile = (root: string, rel: string) =>
  join(root, RESULT_LOCK_DIR, `${createHash('sha256').update(resolveRealPath(resolve(root, rel))).digest('hex')}.lock`);
function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
}

describe('code-r1 F1：运行锁原子发布与回收仲裁', () => {
  it('发布窗口中的空 / 不可解析锁不被回收，视为冲突', () => {
    const root = tmpProject();
    mkdirSync(join(root, RESULT_LOCK_DIR), { recursive: true });
    writeFileSync(lockFile(root, 'logos/resources/verify/test-results.jsonl'), '');
    expect(() => acquireResultPathLocks(root, ['logos/resources/verify/test-results.jsonl'])).toThrow(ResultPathBusyError);
    expect(existsSync(lockFile(root, 'logos/resources/verify/test-results.jsonl'))).toBe(true);
  });

  it('死进程锁被并发回收时恰好一个进程获胜', async () => {
    const root = tmpProject();
    const rel = 'logos/resources/verify/test-results.jsonl';
    mkdirSync(join(root, RESULT_LOCK_DIR), { recursive: true });
    writeFileSync(lockFile(root, rel), JSON.stringify({ pid: deadPid(), at: Date.now(), token: 'dead-token' }));
    const script = `import { acquireResultPathLocks } from ${JSON.stringify(join(CLI_ROOT, 'dist/lib/result-path-lock.js'))};
const go = Date.now() + 300; while (Date.now() < go) {}
try { acquireResultPathLocks(process.argv[2], [${JSON.stringify(rel)}]); console.log('WON'); setTimeout(() => {}, 800); }
catch (e) { console.log(e.code === 'RESULT_PATH_BUSY' ? 'BUSY' : 'ERR ' + e.message); }`;
    const runner = join(root, 'race.mjs');
    writeFileSync(runner, script);
    const outs = await Promise.all(Array.from({ length: 4 }, () => new Promise<string>(res => {
      const p = spawn(process.execPath, [runner, root]);
      let out = ''; p.stdout.on('data', d => { out += d; }); p.on('close', () => res(out.trim()));
    })));
    expect(outs.filter(o => o === 'WON')).toHaveLength(1);
    expect(outs.filter(o => o === 'BUSY')).toHaveLength(3);
  });

  it('多路径获取中途冲突时释放已获取的锁', () => {
    const root = tmpProject();
    const a = 'logos/resources/verify/a.jsonl';
    const b = 'logos/resources/verify/b.jsonl';
    const held = acquireResultPathLocks(root, [b]);
    try {
      expect(() => acquireResultPathLocks(root, [a, b])).toThrow(ResultPathBusyError);
      expect(existsSync(lockFile(root, a))).toBe(false);
    } finally { held.release(); }
    const again = acquireResultPathLocks(root, [a, b]);
    again.release();
    expect(existsSync(lockFile(root, a))).toBe(false);
    expect(existsSync(lockFile(root, b))).toBe(false);
  });
});

describe('code-r1 F3：结果读取失败不发布空快照', () => {
  it('resultCapture 为读取失败时不写 results.jsonl、报告 write_error，中央索引照写', () => {
    const root = tmpProject();
    mkdirSync(join(root, 'logos/changes/demo'), { recursive: true });
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'demo' }));
    const ctx = startHistoryRun(root, 'verify');
    const meta = writeHistoryRun(ctx, {
      outcome: 'completed', gate: { result: 'FAIL', reason: 'failed_cases' }, errorCode: null,
      moduleScope: null, verifyMode: null, attemptedSliceId: null, counts: { failed: 1 }, failedIds: ['UT-S01-01'],
      resultSource: 'executed', resultPath: 'logos/resources/verify/test-results.jsonl',
      resultCapture: { error: 'EIO: i/o error, read' }, reportBytes: '# Acceptance Report\n',
    });
    expect(meta.write_status).toBe('failed');
    expect(meta.write_error).toMatchObject({ code: 'verification_history_write_failed', layer: 'proposal' });
    expect(existsSync(join(root, meta.index_path))).toBe(true);
    expect(existsSync(join(root, meta.run_dir!, 'results.jsonl'))).toBe(false);
    expect(existsSync(join(root, meta.run_dir!, 'report.md'))).toBe(true);
  });
});

describe('code-r1 F5：白名单字段按值类型投影', () => {
  it('类型不符的结构化字段归入原文层，中央索引只写字符串 ID', () => {
    const split = splitResultLines([
      JSON.stringify({ id: 'UT-S01-01', status: 'fail', scenario: { leak: SECRET }, duration_ms: '3', error: SECRET }),
      JSON.stringify({ id: { leak: SECRET }, status: 'fail' }),
    ].join('\n'));
    expect(split.structured).not.toContain(SECRET);
    expect(split.raw).toContain(SECRET);
    const root = tmpProject();
    const ctx = startHistoryRun(root, 'smoke');
    const meta = writeHistoryRun(ctx, {
      outcome: 'completed', gate: { result: 'FAIL', reason: 'failed_cases' }, errorCode: null,
      moduleScope: null, verifyMode: null, attemptedSliceId: null, counts: {},
      failedIds: ['SMOKE-core-901', { leak: SECRET } as unknown as string, 7 as unknown as string],
      resultSource: 'executed', resultPath: null, reportBytes: null,
    });
    const idx = readFileSync(join(root, meta.index_path), 'utf8');
    expect(idx).not.toContain(SECRET);
    expect(JSON.parse(idx).failed_ids).toEqual(['SMOKE-core-901']);
  });
});

describe('code-r1 F4：smoke 账本收尾失败仍留存历史', () => {
  it('部署账本路径不可写时 SMOKE_LEDGER_WRITE_FAILED 的 details 含 history，中央索引已写', () => {
    const root = tmpProject();
    const cfgPath = join(root, 'logos/logos.config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.smoke = { result_path: 'logos/resources/verify/smoke-results.jsonl', sandbox_mode: 'off', command: 'node tools/runner.js' };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    writeFileSync(join(root, 'logos/logos-project.yaml'), stringifyYaml({
      modules: [{ id: 'core', name: 'Core', lifecycle: 'launched' }],
      deployment_gates: { core: { deployment_required: true, smoke_required: true } },
    }));
    mkdirSync(join(root, 'logos/resources/test/smoke'), { recursive: true });
    writeFileSync(join(root, 'logos/resources/test/smoke/core-smoke-test-cases.md'), '| ID | 描述 |\n|---|---|\n| SMOKE-core-901 | a |\n');
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'tools/runner.js'), `require('fs').writeFileSync(process.env.OPENLOGOS_SMOKE_RESULT_PATH || 'logos/resources/verify/smoke-results.jsonl', JSON.stringify({ id: 'SMOKE-core-901', status: 'pass', target_environment: process.env.OPENLOGOS_SMOKE_ENV }) + '\\n');`);
    writeFileSync(join(root, 'logos/environments.yaml'), 'schema_version: 1\nenvironments:\n  - {id: test, name: Test, tier: test}\n');
    writeFileSync(join(root, 'logos/resources/verify/deployment-report.md'), '# Deployment Report\n');
    const dir = join(root, 'logos/changes/sh-demo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'proposal.md'), '# 变更提案：sh-demo\n\n## 部署影响\n- 是否需要部署：是\n- 部署原因：x\n- 影响环境：test\n- 是否涉及数据迁移：否\n- 是否需要回滚预案：是\n- 是否需要 smoke：是\n');
    writeFileSync(join(dir, 'tasks.md'), '# 实现任务\n\n## [code] 代码实现\n- [x] a\n\n## [deploy] 部署\n- [x] b\n');
    writeFileSync(join(dir, 'VERIFY_PASS'), '');
    writeFileSync(join(root, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: 'sh-demo', module: 'core' }));
    const git = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
    git('init', '-q'); git('config', 'user.name', 't'); git('config', 'user.email', 't@example.invalid');
    writeFileSync(join(root, '.gitignore'), 'logos/.openlogos-runtime/\n');
    git('add', '-A'); git('commit', '-qm', 'init');
    const run = (args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: 'utf8' });
    expect(run(['deploy-done', '--env', 'test', '--ref', 'HEAD']).status).toBe(0);
    const ledger = join(root, 'logos/.openlogos-runtime/deployments.jsonl');
    rmSync(ledger); mkdirSync(ledger);
    const r = run(['smoke', '--env', 'test', '--format', 'json']);
    expect(r.status).toBe(1);
    const err = JSON.parse(r.stderr).error;
    expect(err.code).toBe('SMOKE_LEDGER_WRITE_FAILED');
    expect(err.details).toMatchObject({ stage: 'ledger', gate_result: 'PASS' });
    const idx = JSON.parse(readFileSync(join(root, err.details.history.index_path), 'utf8'));
    expect(idx).toMatchObject({ kind: 'smoke', outcome: 'completed', gate: { result: 'PASS' } });
    expect(existsSync(join(root, err.details.history.run_dir, 'report.md'))).toBe(true);
  });
});
