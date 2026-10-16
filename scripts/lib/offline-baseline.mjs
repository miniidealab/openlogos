/**
 * 安装态 smoke 的「回滚制品基线」离线组装（proposal-default-environment code-r1 F1）。
 *
 * 规格边界（logos/resources/test/smoke/core-smoke-test-cases.md「OpenLogos 0.16.6 提案默认部署环境安装态 smoke」
 * 二、执行边界）：全部读写只在一次性目录内、不访问任何远程服务、对全局安装态只读。
 *
 * 因此基线**不调用 npm**：`npm install` 即便加 `--prefer-offline` 仍会在缓存缺失时联网，且默认 cache / 日志写在
 * 用户目录。这里改为：把回滚 tarball 解包到一次性目录，再从候选全局安装（只读）复制其已解析的 `node_modules`。
 * 前提是两版 package.json 声明的 `dependencies` 完全一致——不一致时如实失败并说明缺口，绝不回落为联网安装。
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** path 是否严格位于 dir 之内（不等于 dir 本身、不经 .. 离开）。 */
export function isWithin(dir, path) {
  const rel = relative(resolve(dir), resolve(path));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

const sortedDeps = pkg => JSON.stringify(Object.entries(pkg.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)));

/**
 * @param {object}   options
 * @param {string}   options.tarball        回滚制品（只读）
 * @param {string}   options.candidateRoot  候选全局安装包根（只读，提供已解析的 node_modules）
 * @param {string}   options.scopeDir       一次性目录（调用方负责清理）；全部写入落在其内
 * @param {Function} [options.spawn]        子进程实现（测试注入）；只会以 `tar` 调用
 * @returns {{ entry: string, packageDir: string, commands: string[][], evidence: string[] }}
 */
export function assembleOfflineBaseline({ tarball, candidateRoot, scopeDir, spawn = spawnSync }) {
  const commands = [];
  const exec = (cmd, args) => {
    commands.push([cmd, ...args]);
    return spawn(cmd, args, { encoding: 'utf8' });
  };
  if (!existsSync(tarball)) throw new Error(`回滚制品不存在：${tarball}`);
  const candidateModules = join(candidateRoot, 'node_modules');
  if (!existsSync(candidateModules)) throw new Error(`候选安装缺少 node_modules（${candidateModules}），无法离线组装基线`);

  const untar = exec('tar', ['-xzf', tarball, '-C', scopeDir]);
  if (untar.status !== 0) throw new Error(`解包回滚制品失败：${(untar.stderr || '').slice(0, 300)}`);
  const packageDir = join(scopeDir, 'package');
  const entry = join(packageDir, 'dist/index.js');
  if (!existsSync(entry)) throw new Error(`回滚制品中缺少入口 dist/index.js（${tarball}）`);

  const baselinePkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const candidatePkg = JSON.parse(readFileSync(join(candidateRoot, 'package.json'), 'utf8'));
  if (sortedDeps(baselinePkg) !== sortedDeps(candidatePkg)) {
    throw new Error(`回滚制品 ${baselinePkg.version} 与候选 ${candidatePkg.version} 声明的 dependencies 不一致`
      + `（${sortedDeps(baselinePkg)} ≠ ${sortedDeps(candidatePkg)}），无法离线组装基线；不回落为联网安装`);
  }
  const targetModules = join(packageDir, 'node_modules');
  cpSync(candidateModules, targetModules, { recursive: true, verbatimSymlinks: true });

  // 隔离断言：入口与全部写入位置都在一次性目录内；除 tar 外没有任何子进程（尤其没有 npm）
  for (const [label, path] of [['entry', entry], ['package', packageDir], ['node_modules', targetModules]]) {
    if (!isWithin(scopeDir, path)) throw new Error(`基线 ${label} ${path} 不在一次性目录 ${scopeDir} 内`);
  }
  if (commands.some(([cmd]) => cmd !== 'tar')) throw new Error(`基线组装出现非 tar 子进程：${JSON.stringify(commands)}`);
  return {
    entry, packageDir, commands,
    evidence: [`baseline_mode=offline-assembled`, `baseline_version=${baselinePkg.version}`, `baseline_dir=${packageDir}`, 'npm_invocations=0'],
  };
}
