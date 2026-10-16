/**
 * 安装态 smoke 回滚基线的离线组装隔离断言（proposal-default-environment code-r1 F1）。
 *
 * scripts/lib/offline-baseline.mjs 为 SMOKE-core-267 组装回滚制品基线：不调用 npm、不联网、不写用户 npm cache / 日志，
 * 全部写入落在一次性目录内。本文件以夹具 tarball 与夹具「候选安装」验证这些边界，并静态核对 runner 已不再以
 * `npm install --prefer-offline` 安装基线。全部在一次性目录中执行，不读取本机全局安装与用户 npm 缓存。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error 运行时脚本为 ESM .mjs，无类型声明
import { assembleOfflineBaseline, isWithin } from '../../scripts/lib/offline-baseline.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const RUNNER = join(REPO, 'scripts/smoke-proposal-default-environment-0-16-6.js');
const DEPS = { yaml: '^2.8.3', 'pg-query-emscripten': '5.1.0' };

const dirs: string[] = [];
const temp = (tag: string) => { const d = mkdtempSync(join(tmpdir(), `ol-offline-baseline-${tag}-`)); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function put(root: string, rel: string, content: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}

/** 夹具：回滚制品 tarball（入口 require 依赖 fixture-dep）与候选安装（package.json + node_modules/fixture-dep）。 */
function fixture(baselineDeps: Record<string, string> = DEPS) {
  const src = temp('src');
  put(src, 'package/package.json', JSON.stringify({ name: '@miniidealab/openlogos', version: '0.16.5', dependencies: baselineDeps }));
  put(src, 'package/dist/index.js', "const dep = require('fixture-dep'); console.log('baseline ' + dep.tag);\n");
  const tarball = join(temp('tarball'), 'miniidealab-openlogos-0.16.5.tgz');
  expect(spawnSync('tar', ['-czf', tarball, '-C', src, 'package']).status).toBe(0);
  const candidateRoot = temp('candidate');
  put(candidateRoot, 'package.json', JSON.stringify({ name: '@miniidealab/openlogos', version: '0.16.6', dependencies: DEPS }));
  put(candidateRoot, 'node_modules/fixture-dep/index.js', "module.exports = { tag: 'from-candidate' };\n");
  return { tarball, candidateRoot };
}

/** 记录全部子进程调用的 spawn 替身（真实执行，便于核对没有 npm）。 */
function recordingSpawn() {
  const calls: string[][] = [];
  const spawn = (cmd: string, args: string[], opts: object) => { calls.push([cmd, ...args]); return spawnSync(cmd, args, opts); };
  return { calls, spawn };
}

describe('smoke 回滚基线离线组装（code-r1 F1）', () => {
  it('组装结果全部位于一次性目录、只调用 tar、可直接运行', () => {
    const { tarball, candidateRoot } = fixture();
    const scopeDir = temp('scope');
    const { calls, spawn } = recordingSpawn();
    const r = assembleOfflineBaseline({ tarball, candidateRoot, scopeDir, spawn });

    expect(calls.map(c => c[0])).toEqual(['tar']);
    expect(calls.flat().some(t => /npm|--prefer-offline|registry/.test(t))).toBe(false);
    for (const p of [r.entry, r.packageDir, join(r.packageDir, 'node_modules')]) expect(isWithin(scopeDir, p)).toBe(true);
    expect(r.evidence).toContain('npm_invocations=0');
    expect(r.evidence).toContain('baseline_mode=offline-assembled');
    // 依赖来自候选安装的只读复制；入口可运行
    const out = spawnSync(process.execPath, [r.entry], { encoding: 'utf8' });
    expect(out.status).toBe(0);
    expect(out.stdout.trim()).toBe('baseline from-candidate');
    // 候选安装未被改动（只读）
    expect(readdirSync(candidateRoot).sort()).toEqual(['node_modules', 'package.json']);
  });

  it('两版声明的 dependencies 不一致时如实失败，不回落为联网安装', () => {
    const { tarball, candidateRoot } = fixture({ ...DEPS, extra: '1.0.0' });
    const scopeDir = temp('scope');
    const { calls, spawn } = recordingSpawn();
    expect(() => assembleOfflineBaseline({ tarball, candidateRoot, scopeDir, spawn })).toThrow(/dependencies 不一致.*不回落为联网安装/);
    expect(calls.map(c => c[0])).toEqual(['tar']);
  });

  it('runner 不再以 npm install 安装基线，只读 npm 查询不写日志', () => {
    const src = readFileSync(RUNNER, 'utf8');
    expect(src).not.toMatch(/'install'/);
    expect(src).not.toContain('--prefer-offline');
    expect(src).toContain('assembleOfflineBaseline(');
    expect(src).toContain("run(npm, ['prefix', '-g', '--logs-max=0'])");
    const meta = JSON.parse(spawnSync(process.execPath, [RUNNER, '--self-test'], { cwd: REPO, encoding: 'utf8' }).stdout);
    expect(meta.baseline_mode).toBe('offline-assembled');
    expect(meta.baseline_npm_invocations).toBe(0);
  });
});
