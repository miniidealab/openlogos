/**
 * knowledge-direct-intake：安装态 smoke runner（scripts/smoke-knowledge-direct-intake.js，SMOKE-core-321～323）的判据自测。
 * - 自测模式：以仓内 cli/dist/index.js 为注入入口、独立账本，三条用例全部 pass；
 * - 窗口外：为全部 owned ID 写 skip、不声明 target_environment；
 * - 自测结果指向项目正式账本 → 拒绝运行、不写结果。
 * 本文件不认领 UT/ST 编号（SMOKE-core-321～323 的结果由 runner 自身写入 smoke 账本）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const RUNNER = join(REPO_ROOT, 'scripts', 'smoke-knowledge-direct-intake.js');
const ENTRY = join(REPO_ROOT, 'cli', 'dist', 'index.js');
const IDS = ['SMOKE-core-321', 'SMOKE-core-322', 'SMOKE-core-323'];

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'openlogos-kdi-smoke-')); roots.push(d); return d; };

interface Row { id: string; status: string; detail: string; target_environment?: string; environment: string }
function runRunner(cwd: string, env: Record<string, string>): { status: number | null; rows: Row[]; stderr: string } {
  const results = env.OPENLOGOS_SMOKE_RESULT_PATH ?? join(tmp(), 'smoke.jsonl');
  const clean: NodeJS.ProcessEnv = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith('OPENLOGOS_KDI_') || k === 'OPENLOGOS_SMOKE_ENV') delete clean[k];
  const r = spawnSync(process.execPath, [RUNNER], {
    cwd, encoding: 'utf8', timeout: 600_000, env: { ...clean, TMPDIR: tmp(), OPENLOGOS_SMOKE_RESULT_PATH: results, ...env },
  });
  const rows = existsSync(results) ? readFileSync(results, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Row) : [];
  return { status: r.status, rows, stderr: r.stderr ?? '' };
}

describe('knowledge-direct-intake 安装态 smoke runner 自测', () => {
  it('自测模式：三条用例在注入入口下全部 pass，写入独立账本', () => {
    const r = runRunner(REPO_ROOT, { OPENLOGOS_KDI_SMOKE_SELF_TEST: '1', OPENLOGOS_KDI_SMOKE_ENTRY: ENTRY });
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
    const r = runRunner(repo, { OPENLOGOS_KDI_SMOKE_SELF_TEST: '1', OPENLOGOS_KDI_SMOKE_ENTRY: ENTRY, OPENLOGOS_SMOKE_RESULT_PATH: formal });
    expect(r.status).toBe(2);
    expect(existsSync(formal)).toBe(false);
  }, 60_000);
});
