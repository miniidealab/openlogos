/**
 * S19 — OpenLogos 0.15.0 打包候选（lite-cut3b）。
 *
 * 覆盖 UT-S19-46 / ST-S19-22。**本轮不做本机全局安装**（减法方案 §13 保险条款），
 * 故只验证版本身份同源与隔离 prefix 行为矩阵，不含全局切换/回滚。
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

describe('S19 — OpenLogos 0.15.0 打包候选', () => {
  it('UT-S19-46: 0.15.0 版本身份全源一致', () => {
    expect(LOCAL_RELEASE_CANDIDATE_VERSION).toBe('0.15.0');
    expect(LOCAL_RELEASE_ROLLBACK_VERSION).toBe('0.14.25');
    for (const path of [
      'cli/package.json', 'cli/package-lock.json',
      'plugin/.claude-plugin/plugin.json', 'plugin-codex/plugin.json',
      'plugin-zcode/.zcode-plugin/plugin.json', 'plugin-qoder/.qoder-plugin/plugin.json',
      'plugin-workbuddy/.workbuddy-plugin/plugin.json', 'cli/asset-manifest.json',
    ]) {
      expect(readVersion(join(repoRoot, path)), path).toBe('0.15.0');
    }
    // 全仓不得残留上一版本号作为候选身份
    const pkg = readFileSync(join(cliRoot, 'package.json'), 'utf8');
    expect(pkg).not.toContain('0.14.25');
  });

  it('ST-S19-22: 隔离 prefix 真实 pack、安装与破坏性契约验收', { timeout: 600_000 }, () => {
    // 部署前冻结本机全局事实
    const globalBefore = spawnSync('openlogos', ['--version'], { encoding: 'utf8' });
    const globalVersionBefore = globalBefore.status === 0 ? globalBefore.stdout.trim() : null;

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
    expect(meta[0].filename).toContain('0.15.0');

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
    expect(run(['--version'], work).stdout.trim()).toBe('0.15.0');

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
    expect(globalVersionAfter, '本机全局必须保持不变').toBe(globalVersionBefore);
    if (globalVersionAfter !== null) {
      expect(globalVersionAfter, '全局应仍为 0.14.25（§13 保险条款）').toBe('0.14.25');
    }
  });
});
