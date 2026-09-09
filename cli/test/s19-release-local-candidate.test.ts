/**
 * S19 — OpenLogos 本地发布候选打包与隔离 prefix 验收。
 *
 * 覆盖 UT-S19-46 / ST-S19-22。候选身份**随 `LOCAL_RELEASE_CANDIDATE_VERSION` 移动**：
 * 本文件不写死任何版本字面量，版本变更只改 `src/lib/local-release-candidate.ts` 一处。
 *
 * 为什么不钉死（fix-slice-assets-drift-after-transaction-removal）：ST-S19-22 步骤⑤原本
 * 断言「本机全局仍为 0.14.25」——那是写下该用例时的机器现值，不是被测性质。0.15.0 全局
 * 安装后它必红，且每次发布都会再红一次。AC-RELEASE-0150-04 要的是「全局未被本用例触碰」，
 * 故只断言执行前后逐字一致，不断言它等于某个具体版本。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { LOCAL_RELEASE_CANDIDATE_VERSION, LOCAL_RELEASE_ROLLBACK_VERSION } from '../src/lib/local-release-candidate.js';

const repoRoot = resolve(import.meta.dirname, '../..');
const cliRoot = join(repoRoot, 'cli');
const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

const readVersion = (p: string): string => (JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version;

describe('S19 — OpenLogos 本地发布候选', () => {
  it('UT-S19-46: 本地发布候选版本身份全源一致', () => {
    // 候选与回滚版本是同一处常量的两个字段；二者必须不同，否则「回滚」无意义。
    expect(LOCAL_RELEASE_CANDIDATE_VERSION).not.toBe(LOCAL_RELEASE_ROLLBACK_VERSION);
    for (const path of [
      'cli/package.json', 'cli/package-lock.json',
      'plugin/.claude-plugin/plugin.json', 'plugin-codex/plugin.json',
      'plugin-zcode/.zcode-plugin/plugin.json', 'plugin-qoder/.qoder-plugin/plugin.json',
      'plugin-workbuddy/.workbuddy-plugin/plugin.json', 'cli/asset-manifest.json',
    ]) {
      expect(readVersion(join(repoRoot, path)), path).toBe(LOCAL_RELEASE_CANDIDATE_VERSION);
    }
    // 全仓不得残留上一版本号作为候选身份
    const pkg = readFileSync(join(cliRoot, 'package.json'), 'utf8');
    expect(pkg).not.toContain(LOCAL_RELEASE_ROLLBACK_VERSION);
  });

  it('ST-S19-22: 隔离 prefix 真实 pack、安装与破坏性契约验收', { timeout: 600_000 }, () => {
    // 部署前冻结本机全局事实
    const globalBefore = spawnSync('openlogos', ['--version'], { encoding: 'utf8' });
    const globalVersionBefore = globalBefore.status === 0 ? globalBefore.stdout.trim() : null;
    const whichBefore = spawnSync('command', ['-v', 'openlogos'], { encoding: 'utf8', shell: true });
    const globalWhichBefore = whichBefore.status === 0 ? whichBefore.stdout.trim() : null;

    const work = mkdtempSync(join(tmpdir(), 'openlogos-0150-'));
    roots.push(work);
    // ① 真实 npm pack 冻结 tarball。
    // 用 `--ignore-scripts`：prepack 会重建随包模板与 asset manifest，那是对**工作区**的写入，
    // 会污染同批其它测试。dist/ 与随包资产由 vitest globalSetup 保证已构建，打包当前磁盘态即可。
    const packed = spawnSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], {
      cwd: cliRoot, encoding: 'utf8', timeout: 300_000,
    });
    expect(packed.status, packed.stderr).toBe(0);
    // prepack 会向 stdout 打印构建日志，故只截取其后的 JSON 数组
    const jsonStart = packed.stdout.indexOf('[');
    expect(jsonStart, 'npm pack --json 应输出 JSON 数组').toBeGreaterThanOrEqual(0);
    const meta = JSON.parse(packed.stdout.slice(jsonStart)) as Array<{ filename: string }>;
    const tarball = join(work, meta[0].filename);
    expect(existsSync(tarball)).toBe(true);
    expect(meta[0].filename).toContain(LOCAL_RELEASE_CANDIDATE_VERSION);

    // ② 一次性隔离 prefix 安装
    const prefix = join(work, 'prefix');
    mkdirSync(prefix, { recursive: true });
    const install = spawnSync('npm', ['install', '--prefix', prefix, '--force', '--ignore-scripts',
      '--no-audit', '--no-fund', tarball], { encoding: 'utf8', timeout: 300_000 });
    expect(install.status, install.stderr).toBe(0);
    const entry = join(prefix, 'node_modules/@miniidealab/openlogos/dist/index.js');
    expect(existsSync(entry)).toBe(true);

    const run = (args: string[], cwd: string) =>
      spawnSync(process.execPath, [entry, ...args], { cwd, encoding: 'utf8', timeout: 120_000 });

    // candidate identity 来自固定 tarball
    expect(run(['--version'], work).stdout.trim()).toBe(LOCAL_RELEASE_CANDIDATE_VERSION);

    // ③ 破坏性命令面：已删除的一律非零退出
    const proj = join(work, 'proj');
    mkdirSync(proj, { recursive: true });
    for (const args of [['merge', 'transaction', 'status'], ['merge-apply', 'x']]) {
      expect(run(args, proj).status, args.join(' ')).not.toBe(0);
    }

    // ④ 新命令可用（在未初始化目录下也应给出结构化错误而非 Unknown command）
    for (const args of [['slice'], ['lint-specs']]) {
      const r = run(args, proj);
      expect(`${r.stdout}${r.stderr}`, args.join(' ')).not.toContain('Unknown command');
    }

    // ⑤ 本机全局零触碰
    const globalAfter = spawnSync('openlogos', ['--version'], { encoding: 'utf8' });
    const globalVersionAfter = globalAfter.status === 0 ? globalAfter.stdout.trim() : null;
    const whichAfter = spawnSync('command', ['-v', 'openlogos'], { encoding: 'utf8', shell: true });
    const globalWhichAfter = whichAfter.status === 0 ? whichAfter.stdout.trim() : null;
    // AC-RELEASE-0150-04：只断言「未被本用例触碰」。全局现值是机器状态、会随历次发布变化，
    // 钉死具体版本会让本条在下一次发布后必红——那是把环境现值误当被测性质。
    expect(globalVersionAfter, '本机全局必须保持不变（执行前后逐字一致）').toBe(globalVersionBefore);
    expect(globalWhichAfter, '本机全局入口路径必须保持不变').toBe(globalWhichBefore);
  });
});
