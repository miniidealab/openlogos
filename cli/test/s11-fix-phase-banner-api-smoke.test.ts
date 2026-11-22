/**
 * fix-phase-banner-api-false-missing：安装态 smoke runner（scripts/smoke-fix-phase-banner-api.js，SMOKE-core-324～325）的判据自测。
 * - 自测模式：以仓内 cli/dist/index.js 为注入入口、独立账本，两条用例全部 pass；
 * - 窗口外：为全部 owned ID 写 skip、不声明 target_environment；
 * - 自测结果指向项目正式账本 → 拒绝运行、不写结果。
 * code-r1 回归：F2 子进程输出正确但非零退出 → 记 fail；F3 模块级正式账本与正式 smoke 上下文拒绝自测；
 * F4 降级 PATH 拟用目录中有 openlogos 时仍被隔离；F5 部署证据按本提案成功部署记录与回执逐字段核验。
 * 本文件不认领 UT/ST 编号（SMOKE-core-324～325 的结果由 runner 自身写入 smoke 账本）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const RUNNER = join(REPO_ROOT, 'scripts', 'smoke-fix-phase-banner-api.js');
const ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const IDS = ['SMOKE-core-324', 'SMOKE-core-325'];

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'openlogos-fpb-smoke-')); roots.push(d); return d; };

interface Row { id: string; status: string; detail: string; target_environment?: string; environment: string; missing_requirements?: string[] }
function runRunner(cwd: string, env: Record<string, string>): { status: number | null; rows: Row[]; stderr: string } {
  const results = env.OPENLOGOS_SMOKE_RESULT_PATH ?? join(tmp(), 'smoke.jsonl');
  const clean: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('OPENLOGOS_FPB_') || k === 'OPENLOGOS_SMOKE_ENV') delete clean[k];
  const r = spawnSync(process.execPath, [RUNNER], {
    cwd, encoding: 'utf8', timeout: 600_000, env: { ...clean, TMPDIR: tmp(), OPENLOGOS_SMOKE_RESULT_PATH: results, ...env },
  });
  const rows = existsSync(results) ? readFileSync(results, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Row) : [];
  return { status: r.status, rows, stderr: r.stderr ?? '' };
}

describe('fix-phase-banner-api-false-missing 安装态 smoke runner 自测', () => {
  it('自测模式：两条用例在注入入口下全部 pass，写入独立账本', () => {
    const r = runRunner(REPO_ROOT, { OPENLOGOS_FPB_SMOKE_SELF_TEST: '1', OPENLOGOS_FPB_SMOKE_ENTRY: ENTRY });
    expect(r.status, r.stderr).toBe(0);
    expect(r.rows.map(x => x.id)).toEqual(IDS);
    for (const row of r.rows) {
      expect(row.status, `${row.id}: ${row.detail}`).toBe('pass');
      expect(row.environment).toBe('self-test-injected-entry');
    }
  }, 600_000);

  it('窗口外：为全部 owned ID 写 skip，不声明 target_environment', () => {
    const repo = tmp();
    mkdirSync(join(repo, 'logos'), { recursive: true });
    writeFileSync(join(repo, 'logos', '.openlogos-guard'), JSON.stringify({ activeChange: 'other-change' }));
    const r = runRunner(repo, { OPENLOGOS_SMOKE_ENV: 'test' });
    const rows = r.rows.filter(x => IDS.includes(x.id));
    expect(rows.map(x => x.id).sort()).toEqual(IDS);
    for (const row of rows) {
      expect(row.status).toBe('skip');
      expect(row.target_environment).toBeUndefined();
    }
  }, 60_000);

  it('自测结果指向项目正式账本 → 拒绝运行且不写结果', () => {
    const repo = tmp();
    mkdirSync(join(repo, 'logos/resources/verify'), { recursive: true });
    const formal = join(repo, 'logos/resources/verify/smoke-results.jsonl');
    const r = runRunner(repo, { OPENLOGOS_FPB_SMOKE_SELF_TEST: '1', OPENLOGOS_FPB_SMOKE_ENTRY: ENTRY, OPENLOGOS_SMOKE_RESULT_PATH: formal });
    expect(r.status).toBe(2);
    expect(existsSync(formal)).toBe(false);
  }, 60_000);

  it('code-r1 F2：status 输出合法 JSON 后非零退出 → SMOKE-core-325 记 fail（不得写 pass）', () => {
    const dir = tmp();
    const fake = join(dir, 'fake-entry.mjs');
    writeFileSync(fake, [
      "import { spawnSync } from 'node:child_process';",
      `const r = spawnSync(process.execPath, [${JSON.stringify(ENTRY)}, ...process.argv.slice(2)], { encoding: 'utf8' });`,
      'process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? "");',
      "process.exit(process.argv[2] === 'status' ? 3 : (r.status ?? 1));",
      '',
    ].join('\n'));
    const r = runRunner(REPO_ROOT, { OPENLOGOS_FPB_SMOKE_SELF_TEST: '1', OPENLOGOS_FPB_SMOKE_ENTRY: fake });
    const row = r.rows.find(x => x.id === 'SMOKE-core-325');
    expect(row?.status).toBe('fail');
    expect(row?.detail).toContain('退出码 3');
    expect(r.status).toBe(1);
  }, 600_000);

  it('code-r1 F3：模块级正式账本与正式 smoke 上下文中拒绝自测且不写结果', () => {
    const repo = tmp();
    mkdirSync(join(repo, 'logos'), { recursive: true });
    writeFileSync(join(repo, 'logos', 'logos.config.json'), JSON.stringify({ smoke: { modules: { core: { result_path: 'logos/resources/verify/core-smoke.jsonl' } } } }));
    const moduleLedger = join(repo, 'logos/resources/verify/core-smoke.jsonl');
    const a = runRunner(repo, { OPENLOGOS_FPB_SMOKE_SELF_TEST: '1', OPENLOGOS_FPB_SMOKE_ENTRY: ENTRY, OPENLOGOS_SMOKE_RESULT_PATH: moduleLedger });
    expect(a.status).toBe(2);
    expect(existsSync(moduleLedger)).toBe(false);
    const outside = join(tmp(), 'self.jsonl');
    const b = runRunner(repo, { OPENLOGOS_FPB_SMOKE_SELF_TEST: '1', OPENLOGOS_FPB_SMOKE_ENTRY: ENTRY, OPENLOGOS_SMOKE_RESULT_PATH: outside, OPENLOGOS_SMOKE_MODULE: 'core' });
    expect(b.status).toBe(2);
    expect(existsSync(outside)).toBe(false);
  }, 60_000);

  it('code-r1 F4：降级 PATH 拟用目录中装有 openlogos 时仍被隔离，③④ 照常通过', () => {
    const cliDir = tmp();
    // 若被 ③ 读到，会把 API 判为已完成、横幅不再报 Step 2
    writeFileSync(join(cliDir, 'openlogos'), '#!/bin/bash\necho \'{"data":{"lifecycle":"launched","modules":[{"id":"team","lifecycle":"initial","phase_progress":{"phase.3-2-api":{"done":true,"skipped":false}}}]}}\'\n', { mode: 0o755 });
    const r = runRunner(REPO_ROOT, {
      OPENLOGOS_FPB_SMOKE_SELF_TEST: '1', OPENLOGOS_FPB_SMOKE_ENTRY: ENTRY,
      OPENLOGOS_FPB_SMOKE_FALLBACK_DIRS: `${cliDir}:/usr/bin:/bin:/usr/sbin:/sbin`,
    });
    const row = r.rows.find(x => x.id === 'SMOKE-core-325');
    expect(row?.status, row?.detail).toBe('pass');
  }, 600_000);

  it('code-r1 F5：部署证据按本提案成功部署记录与回执逐字段核验', () => {
    const repo = tmp();
    const slug = 'fix-phase-banner-api-false-missing';
    mkdirSync(join(repo, 'logos/.openlogos-runtime/local-install'), { recursive: true });
    mkdirSync(join(repo, 'logos/resources/verify'), { recursive: true });
    mkdirSync(join(repo, 'cli/src/lib'), { recursive: true });
    writeFileSync(join(repo, 'logos/.openlogos-guard'), JSON.stringify({ activeChange: slug }));
    writeFileSync(join(repo, 'cli/src/lib/local-release-candidate.ts'), "export const LOCAL_RELEASE_CANDIDATE_VERSION = '0.16.19' as const;\n");
    // 历史报告里出现候选版本字样，不构成本次部署证据
    writeFileSync(join(repo, 'logos/resources/verify/deployment-report.md'), '回滚备注：下一版计划 0.16.19\n');
    const ledger = join(repo, 'logos/resources/verify/smoke-results.jsonl');

    const a = runRunner(repo, { OPENLOGOS_SMOKE_RESULT_PATH: ledger });
    expect(a.rows.map(x => [x.id, x.status])).toEqual([['SMOKE-core-324', 'skip'], ['SMOKE-core-325', 'skip']]);
    expect(a.rows[0].missing_requirements).toEqual(['deployment-record']);

    writeFileSync(join(repo, 'logos/.openlogos-runtime/deployments.jsonl'),
      JSON.stringify({ kind: 'deploy', environment: 'test', slug, deploy_id: 'd-1', result: 'done', rollback: false }) + '\n');
    writeFileSync(join(repo, 'logos/.openlogos-runtime/local-install/last-deploy.json'),
      JSON.stringify({ deploy_id: 'd-1', environment: 'test', candidate_version: '0.16.18', result: 'done' }));
    rmSync(ledger, { force: true });
    const b = runRunner(repo, { OPENLOGOS_SMOKE_RESULT_PATH: ledger });
    expect(b.rows.map(x => x.status)).toEqual(['fail', 'fail']);
    expect(b.rows[0].detail).toContain('candidate_version=0.16.18');
    expect(b.status).toBe(1);
  }, 60_000);

  it('code-r2 F2：子进程忽略 SIGTERM 挂住时按时限强制终止进程组、立即记 fail', () => {
    const dir = tmp();
    // hangOn 指定的子命令：忽略 SIGTERM 并永久挂住（直接 CLI 调用 init，或模板经 PATH 再启动的 status）
    const fakeEntry = (hangOn: string) => {
      const fake = join(dir, `fake-hang-${hangOn}.mjs`);
      writeFileSync(fake, [
        "import { spawnSync } from 'node:child_process';",
        `if (process.argv[2] === ${JSON.stringify(hangOn)}) { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }`,
        'else {',
        `  const r = spawnSync(process.execPath, [${JSON.stringify(ENTRY)}, ...process.argv.slice(2)], { encoding: 'utf8' });`,
        '  process.stdout.write(r.stdout ?? ""); process.stderr.write(r.stderr ?? ""); process.exit(r.status ?? 1);',
        '}',
        '',
      ].join('\n'));
      return fake;
    };
    for (const [hangOn, label] of [['init', '全局 CLI init'], ['status', '插件模板']] as const) {
      const started = Date.now();
      const r = runRunner(REPO_ROOT, {
        OPENLOGOS_FPB_SMOKE_SELF_TEST: '1', OPENLOGOS_FPB_SMOKE_ENTRY: fakeEntry(hangOn),
        OPENLOGOS_FPB_SMOKE_CHILD_TIMEOUT_MS: '1500',
      });
      const elapsed = Date.now() - started;
      const row = r.rows.find(x => x.id === 'SMOKE-core-325');
      expect(row?.status, hangOn).toBe('fail');
      expect(row?.detail, hangOn).toContain(label);
      expect(row?.detail, hangOn).toContain('强制终止');
      expect(r.status, hangOn).toBe(1);
      expect(elapsed, `${hangOn} 用时 ${elapsed}ms`).toBeLessThan(45_000);
    }
  }, 120_000);
});
