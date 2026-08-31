/** SMOKE-core-168 runner/dispatcher/reporter 合同；Vitest reporter 同步记录该真实 ID。 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { checkSmokeCoverage } from '../src/lib/smoke-coverage.js';

const repoRoot = resolve(import.meta.dirname, '../..');
const runner = join(repoRoot, 'scripts/smoke-nested-section-anchor-0-14-4.js');
const roots: string[] = [];

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('0.14.4 嵌套章节锚 smoke 合同', () => {
  it('SMOKE-core-168: runner 自描述、显式 dispatcher 与 JSONL reporter 可被覆盖预检证明', () => {
    const selfTest = spawnSync(process.execPath, [runner, '--self-test'], { cwd: repoRoot, encoding: 'utf8' });
    expect(selfTest.status).toBe(0);
    expect(JSON.parse(selfTest.stdout)).toMatchObject({
      ids: ['SMOKE-core-168'],
      candidate_version: '0.14.4',
      rollback_version: '0.14.3',
      transaction_id: 'mtx_e7f7b924499d49f96aaf8a2f',
      public_release_commands: [],
    });
    const source = readFileSync(runner, 'utf8');
    expect(source.match(/await smoke\('SMOKE-core-168'/g)).toHaveLength(1);
    expect(source).toContain('appendFileSync(resultPath');
    expect(source).toContain('OPENLOGOS_RUNLOGOS_MERGE_AUTHORIZED');
    expect(source).toContain("status.phase === 'completed'");
    expect(source).toContain('replayed_completed: true');
    expect(source).toContain('fsyncSync(handle)');
    expect(source).not.toMatch(/npm\s+publish|git\s+push|git\s+tag|gh\s+release/);
    const dispatcher = readFileSync(join(repoRoot, 'scripts/run-smoke.js'), 'utf8');
    expect(dispatcher).toContain("'scripts/smoke-nested-section-anchor-0-14-4.js'");
    expect(dispatcher).toContain('OPENLOGOS_NESTED_ANCHOR_TARBALL');

    const temporary = mkdtempSync(join(tmpdir(), 'openlogos-smoke-coverage-'));
    roots.push(temporary);
    const slug = 'fix-merge-transaction-nested-section-anchor';
    const delta = join(temporary, 'logos/changes', slug, 'deltas/test/smoke/core-smoke-test-cases.md');
    mkdirSync(dirname(delta), { recursive: true });
    writeFileSync(join(temporary, 'logos/.openlogos-guard'), `${JSON.stringify({ activeChange: slug, module: 'core' })}\n`);
    writeFileSync(delta, '| ID | 描述 |\n|---|---|\n| SMOKE-core-168 | 嵌套章节锚 |\n');
    mkdirSync(join(temporary, 'scripts'), { recursive: true });
    cpSync(runner, join(temporary, 'scripts/smoke-nested-section-anchor-0-14-4.js'));
    cpSync(join(repoRoot, 'scripts/run-smoke.js'), join(temporary, 'scripts/run-smoke.js'));
    const result = join(temporary, 'logos/resources/verify/smoke-results.jsonl');
    mkdirSync(dirname(result), { recursive: true });
    writeFileSync(result, '{"id":"SMOKE-core-168","status":"pass"}\n');
    expect(checkSmokeCoverage(temporary, {
      slug,
      command: 'node scripts/run-smoke.js',
      resultPath: 'logos/resources/verify/smoke-results.jsonl',
    })).toMatchObject({
      result: 'PASS', changed_case_ids: ['SMOKE-core-168'],
      executed_case_ids: ['SMOKE-core-168'], uncovered_case_ids: [], diagnostics: [],
    });
  });
});
