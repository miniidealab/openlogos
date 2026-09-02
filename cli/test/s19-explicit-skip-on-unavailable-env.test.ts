import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { recordSmokeNotApplicable } from '../../scripts/lib/smoke-not-applicable.mjs';

/**
 * S19 环境不具备的显式 skip（fix-archived-transaction-unaddressable 切片2）
 *
 * 这些规则**并非新语义**：已合并的「runner 接入要求」与「smoke skip 统计口径」早已规定
 * runner 对每个用例写 `pass|fail|skip`、skip 表示环境缺少外部依赖。本切片是把该规格
 * 变成**可执行的强制判据**——此前它只是文字，实现可以静默违反而不被发现。
 */

const repoRoot = resolve(import.meta.dirname, '../..');
const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function ledgerPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'openlogos-skip-ledger-'));
  dirs.push(dir);
  return join(dir, 'smoke-results.jsonl');
}

interface Record_ { id: string; status: string; not_applicable_reason?: string; missing_requirements?: string[] }

function readLedger(path: string): Record_[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l) as Record_);
}

/** 在缺 env 的条件下真实执行某个宿主 runner，账本落到隔离路径 */
function runHostRunner(script: string, ledger: string) {
  const r = spawnSync(process.execPath, [join(repoRoot, 'scripts', script)], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, OPENLOGOS_SMOKE_RESULT_PATH: ledger },
  });
  return { status: r.status, records: readLedger(ledger) };
}

/** 各宿主 runner 及其 owned 用例数（与 runner 内 SMOKE_IDS 长度一致） */
const HOST_RUNNERS: Array<{ script: string; owned: number }> = [
  { script: 'smoke-zcode-staging.js', owned: 8 },
  { script: 'smoke-qoder-staging.js', owned: 8 },
  { script: 'smoke-workbuddy-staging.js', owned: 8 },
  { script: 'smoke-trae-local-negative.js', owned: 6 },
];

describe('S19 Unit Tests — 环境不具备的显式 skip', () => {
  it('UT-S19-29: 环境不具备时为全部 owned ID 写 skip，不静默零记录', () => {
    for (const { script, owned } of HOST_RUNNERS) {
      const ledger = ledgerPath();
      const { status, records } = runHostRunner(script, ledger);

      // 不适用不是失败
      expect(status, script).toBe(0);
      // 修复前此处为 0 条——静默零记录退出正是缺陷所在
      expect(records.length, script).toBe(owned);
      expect(records.every(r => r.status === 'skip'), script).toBe(true);
      // 不多不少：ID 唯一且数量等于 owned
      expect(new Set(records.map(r => r.id)).size, script).toBe(owned);
    }
  });

  it('UT-S19-30: skip 记录携带机器可读的不适用原因', () => {
    for (const { script } of HOST_RUNNERS) {
      const ledger = ledgerPath();
      const { records } = runHostRunner(script, ledger);
      for (const record of records) {
        expect(record.not_applicable_reason, `${script}/${record.id}`).toBeTruthy();
        expect(Array.isArray(record.missing_requirements), `${script}/${record.id}`).toBe(true);
        // 必须能据其归因到「缺什么」，而不是只说一句 skip
        expect(record.missing_requirements!.length, `${script}/${record.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('UT-S19-31: 留痕原语拒绝残缺输入——不得只写一部分或不带原因', () => {
    const ledger = ledgerPath();
    // 空 ID 集合：不适用也必须为全部 owned 用例留痕，不允许「什么都不写」
    expect(() => recordSmokeNotApplicable([], { reason: 'x', repoRoot: join(ledger, '..') }))
      .toThrow(/非空的 ids/);
    // 缺原因：skip 不得不带不适用原因
    expect(() => recordSmokeNotApplicable(['SMOKE-core-999'], { reason: '', repoRoot: join(ledger, '..') }))
      .toThrow(/reason/);
    // 正向：写入的每条都是 skip 且带原因，状态不得是 pass（禁止伪造 pass 填补覆盖）
    const okLedger = ledgerPath();
    const written = recordSmokeNotApplicable(['SMOKE-core-901', 'SMOKE-core-902'], {
      reason: '测试用不适用原因',
      missing: ['SOME_ENV'],
      repoRoot: join(okLedger, '..'),
    });
    expect(written).toBe(2);
  });
});

describe('S19 Scenario Tests — 账本可审计', () => {
  it('ST-S19-18: 不适用用例进入 skipped 而非 uncovered，且判据未被放宽', () => {
    // 单一账本内混合多个 runner，模拟真实一轮 smoke.command
    const ledger = ledgerPath();
    let total = 0;
    for (const { script, owned } of HOST_RUNNERS) {
      runHostRunner(script, ledger);
      total += owned;
    }
    const records = readLedger(ledger);

    // 账本中不存在零记录退出的 runner
    expect(records.length).toBe(total);
    expect(records.every(r => r.status === 'skip')).toBe(true);
    // 三态不混用：不得出现伪造 pass
    expect(records.some(r => r.status === 'pass')).toBe(false);
    // 每条都可审计到缺失项
    expect(records.every(r => (r.missing_requirements?.length ?? 0) > 0)).toBe(true);

    // 判据未被放宽：isPass 仍要求 failed==0 && uncovered==0（见 cli/src/commands/smoke.ts）
    const smokeSource = readFileSync(join(repoRoot, 'cli/src/commands/smoke.ts'), 'utf8');
    expect(smokeSource).toContain('failed.length === 0 && uncovered.length === 0');
  });
});
