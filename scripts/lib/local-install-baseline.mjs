/**
 * 安装态 smoke 的行为比较基线选择（smoke-scope-isolated-modules code-r1 F1）。
 *
 * 部署脚本 scripts/deploy-local.mjs 每次部署都把当时的全局包冻结为本次回滚制品，并把其版本写成回执的 previous_version。
 * 首次部署后若修复再部署，最近一次回执的回滚制品就变成修复前的候选版本，不再是验收要求的旧版基线。
 * 因此基线必须按**版本**绑定：在本机留存的回滚制品与候选制品中，选包内 package.json 版本等于指定基线版本的 tarball，
 * 并记录其路径与 SHA-256；最近回滚制品只服务当前部署的回滚，不能自动充当行为比较基线。
 *
 * 只读：只列目录、读 tarball 内的 package/package.json、计算哈希，不写任何文件。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const LOCAL_INSTALL_REL = 'logos/.openlogos-runtime/local-install';

/** 读 npm pack 产物内 package/package.json 的 version；读不到返回 null。 */
export function tarballVersion(file) {
  const r = spawnSync('tar', ['-xOzf', file, 'package/package.json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout).version ?? null; } catch { return null; }
}

/** 从 local-release-candidate.ts 读回滚版本常量（升版脚本把它设为升版前版本，即本次验收的旧版基线）。 */
export function rollbackVersionConst(repoRoot) {
  const src = join(repoRoot, 'cli/src/lib/local-release-candidate.ts');
  const text = existsSync(src) ? readFileSync(src, 'utf8') : '';
  return /LOCAL_RELEASE_ROLLBACK_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text)?.[1] ?? null;
}

/**
 * 在本机留存制品中选出版本等于 baselineVersion 的 tarball。查找顺序：当前回执的回滚制品 → rollback/ → candidates/（各自按文件名排序），
 * 返回第一个版本匹配者 { path, version, sha256 }；都不匹配时返回 { gap, missing }。readVersion 供测试注入。
 */
export function selectBaselineArtifact(repoRoot, baselineVersion, { readVersion = tarballVersion } = {}) {
  if (!baselineVersion) return { gap: '无法确定基线版本（local-release-candidate.ts 缺少回滚版本常量）', missing: ['baseline-version'] };
  const dir = join(repoRoot, LOCAL_INSTALL_REL);
  const ordered = [];
  const receiptPath = join(dir, 'last-deploy.json');
  if (existsSync(receiptPath)) {
    try {
      const p = JSON.parse(readFileSync(receiptPath, 'utf8')).rollback_artifact?.path;
      if (typeof p === 'string' && p) ordered.push(resolve(p));
    } catch { /* 回执不可读：继续按目录查找 */ }
  }
  for (const sub of ['rollback', 'candidates']) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d).filter(n => n.endsWith('.tgz')).sort()) ordered.push(join(d, name));
  }
  const seen = new Set();
  for (const path of ordered) {
    if (seen.has(path) || !existsSync(path)) continue;
    seen.add(path);
    if (readVersion(path) === baselineVersion) {
      return { path, version: baselineVersion, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
    }
  }
  return { gap: `本机留存的回滚 / 候选制品中没有版本 ${baselineVersion} 的 tarball`, missing: ['baseline-artifact'] };
}
