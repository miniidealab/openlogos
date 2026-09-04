/**
 * 切片4：安装态候选 runner 留痕契约元测试。
 * 覆盖 UT-S19-33、ST-S19-19。
 *
 * 缺陷背景：依赖历史制品的 runner 在制品缺失时抛错记 fail，而这些 tarball 只在各自提案的
 * 部署窗口内存在——之后必然缺失，于是**任何后续提案的 Gate 3.8 都被它们永久拉黑**，与被测
 * 能力无关。既有 UT-S19-29~31 / ST-S19-18 只验证留痕原语本身，不验证「每个 runner 都调用了它」。
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');
const RUN_SMOKE = join(REPO_ROOT, 'scripts', 'run-smoke.js');

/** 权威清单是 run-smoke.js 的注册表，不是目录通配——通配会把非候选 runner 也卷进来。 */
function registeredCandidateRunners(): string[] {
  const source = readFileSync(RUN_SMOKE, 'utf8');
  const block = /const globalCandidateRunners = new Map\(\[([\s\S]*?)\]\);/.exec(source);
  expect(block, 'run-smoke.js 中找不到 globalCandidateRunners 注册表').not.toBeNull();
  return [...block![1].matchAll(/\['([^']+)'/g)].map(m => m[1]);
}

/** 三处注册表缺一，runner 就会静默不被分派或不做全局隔离——通配发现无法暴露这一点。 */
function registryMembership(runner: string): Record<string, boolean> {
  const source = readFileSync(RUN_SMOKE, 'utf8');
  const table = (re: RegExp) => re.exec(source)?.[1] ?? '';
  return {
    hostArtifacts: table(/const hostArtifacts[\s\S]*?=\s*\{([\s\S]*?)\n  \};/).includes(`'${runner}'`),
    globalMutatingRunners: table(/const globalMutatingRunners = new Set\(\[([\s\S]*?)\]\);/).includes(`'${runner}'`),
    globalCandidateRunners: table(/const globalCandidateRunners = new Map\(\[([\s\S]*?)\]\);/).includes(`'${runner}'`),
  };
}

describe('S19 候选 runner 留痕契约', () => {
  it('UT-S19-36: 单切片终态判定 runner 在三处注册表均已登记且实现留痕契约', () => {
    const runner = 'scripts/smoke-single-slice-verdict-0-14-14.js';
    expect(registryMembership(runner)).toEqual({
      hostArtifacts: true, globalMutatingRunners: true, globalCandidateRunners: true,
    });
    const source = readFileSync(join(REPO_ROOT, runner), 'utf8');
    expect(/requireEnvOrSkip\s*\(/.test(source), '未调用 requireEnvOrSkip').toBe(true);
    expect(/--self-test/.test(source), '无 --self-test 只读入口').toBe(true);
    // --self-test 自述契约：ids / candidate / rollback / 所需 env
    const selfTest = spawnSync(process.execPath, [join(REPO_ROOT, runner), '--self-test'], { encoding: 'utf8' });
    expect(selfTest.status).toBe(0);
    expect(JSON.parse(selfTest.stdout)).toMatchObject({
      ids: ['SMOKE-core-178'],
      candidate_version: '0.14.14', rollback_version: '0.14.13',
      required_source_env: ['OPENLOGOS_SINGLE_VERDICT_TARBALL', 'OPENLOGOS_SINGLE_VERDICT_ROLLBACK_TARBALL'],
      public_release_commands: [],
    });
    // 夹具口径：runner 自身不得把「删除事务文件」写进任何步骤（删惰性 manifest 属恢复夹具例外）
    expect(/rmSync\([^)]*TEST_SLICE_TRANSACTION/.test(source), 'runner 不得删除事务文件').toBe(false);
  });

  it('UT-S19-35: 终态自校验 runner 在三处注册表均已登记且实现留痕契约', () => {
    const runner = 'scripts/smoke-slice-transaction-terminal-0-14-12.js';
    expect(registryMembership(runner)).toEqual({
      hostArtifacts: true, globalMutatingRunners: true, globalCandidateRunners: true,
    });
    const source = readFileSync(join(REPO_ROOT, runner), 'utf8');
    expect(/requireEnvOrSkip\s*\(/.test(source), '未调用 requireEnvOrSkip').toBe(true);
    expect(/--self-test/.test(source), '无 --self-test 只读入口').toBe(true);
    // 夹具口径：runner 自身不得把「删除事务文件」写进任何步骤
    expect(/rmSync\([^)]*TEST_SLICE_TRANSACTION/.test(source), 'runner 不得删除事务文件').toBe(false);
  });

  it('UT-S19-34: 切片事务 runner 在三处注册表均已登记且实现留痕契约', () => {
    const runner = 'scripts/smoke-slice-transaction-0-14-11.js';
    // 逐表断言而非「至少登记一处」——三张表职责不同，漏登任意一张都是不同的静默失效。
    expect(registryMembership(runner)).toEqual({
      hostArtifacts: true, globalMutatingRunners: true, globalCandidateRunners: true,
    });
    const source = readFileSync(join(REPO_ROOT, runner), 'utf8');
    expect(/requireEnvOrSkip\s*\(/.test(source), '未调用 requireEnvOrSkip').toBe(true);
    expect(/--self-test/.test(source), '无 --self-test 只读入口').toBe(true);
  });

  it('UT-S19-33: 每个已注册候选 runner 都实现留痕契约', () => {
    const runners = registeredCandidateRunners();
    expect(runners.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const rel of runners) {
      const path = join(REPO_ROOT, rel);
      if (!existsSync(path)) { offenders.push(`${rel}（注册项指向的文件不存在）`); continue; }
      const source = readFileSync(path, 'utf8');
      if (!/requireEnvOrSkip\s*\(/.test(source)) offenders.push(`${rel}（未调用 requireEnvOrSkip）`);
      if (!/--self-test/.test(source)) offenders.push(`${rel}（无 --self-test 只读契约入口）`);
    }
    // 失败信息列出违规文件，便于直接定位；新增 runner 遗漏契约即红。
    expect(offenders).toEqual([]);
  });

  it('ST-S19-19: 缺制品时写 skip 而非 fail，且自检不被守卫挡住', () => {
    const runners = registeredCandidateRunners();
    const ledgerDir = mkdtempSync(join(tmpdir(), 'runner-contract-'));
    try {
      for (const rel of runners) {
        const ledger = join(ledgerDir, `${rel.replace(/[^a-z0-9]/gi, '_')}.jsonl`);
        // 清空全部候选/回滚制品环境变量，模拟「历史制品已不在本机」
        const env = { ...process.env, OPENLOGOS_SMOKE_RESULT_PATH: ledger };
        for (const key of Object.keys(env)) {
          if (/^OPENLOGOS_.*(TARBALL|CANDIDATE_BIN)$/.test(key)) delete (env as Record<string, string>)[key];
        }

        // ① 直接运行：必须以成功状态退出，并为 owned ID 各写唯一一条带缺失项的 skip
        const run = spawnSync(process.execPath, [join(REPO_ROOT, rel)], { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 120000 });
        expect(run.status, `${rel} 缺制品时未以成功状态退出：${run.stderr?.slice(0, 300)}`).toBe(0);
        expect(existsSync(ledger), `${rel} 未写任何记录（静默零记录退出）`).toBe(true);
        const rows = readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Record<string, unknown>);
        expect(rows.length, `${rel} 未留痕`).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.status, `${rel} 的 ${String(row.id)} 应为 skip 而非 ${String(row.status)}`).toBe('skip');
          expect(row.not_applicable_reason, `${rel} 的 skip 未带原因`).toBeTruthy();
          expect(Array.isArray(row.missing_requirements) && (row.missing_requirements as unknown[]).length > 0,
            `${rel} 的 skip 未列出缺失项`).toBe(true);
        }
        // 每个 owned ID 恰一条，不得重复矛盾
        const ids = rows.map(r => String(r.id));
        expect(new Set(ids).size, `${rel} 的记录存在重复 ID`).toBe(ids.length);

        // ② 只读自检契约不受制品可用性约束
        const selfTest = spawnSync(process.execPath, [join(REPO_ROOT, rel), '--self-test'], { cwd: REPO_ROOT, env, encoding: 'utf8', timeout: 60000 });
        expect(selfTest.status, `${rel} 的 --self-test 被守卫挡住`).toBe(0);
        expect(() => JSON.parse(selfTest.stdout.trim()), `${rel} 的 --self-test 未输出合法 JSON`).not.toThrow();
      }
    } finally {
      rmSync(ledgerDir, { recursive: true, force: true });
    }
  });
});
