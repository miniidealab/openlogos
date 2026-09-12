/**
 * UT-S19-49 / UT-S19-50：manifest 自洽守卫与升版确定性。
 *
 * 规范源：功能规格 §2.81、部署方案「发布前检查通则」第 4～5 条、
 * `core-S19-test-cases.md`「S19 升版确定性与 manifest 自洽守卫」。
 * 测试结果由全局 OpenLogos reporter 写入 logos/resources/verify/test-results.jsonl。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAssetManifest, type AssetManifest } from '../src/lib/asset-manifest.js';
import { planBump, applyBump, readCurrentVersion, VERSION_CARRIERS } from '../scripts/bump-version.mjs';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(CLI_ROOT, '..');

const scopes: string[] = [];
afterEach(() => { while (scopes.length) rmSync(scopes.pop()!, { recursive: true, force: true }); });

/** 一次性仓库副本——升版是 [deploy] 阶段动作，verify 期用例不得改动本仓字节。 */
function repoCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'openlogos-bump-'));
  scopes.push(root);
  for (const rel of [...VERSION_CARRIERS, 'cli/src/lib/local-release-candidate.ts']) {
    cpSync(join(REPO_ROOT, rel), join(root, rel), { recursive: false, force: true, errorOnExist: false, ...{} } as never);
  }
  return root;
}

describe('S19 — 升版确定性与 manifest 自洽守卫', () => {
  it('UT-S19-49: asset-manifest 的 payloadHash 必须等于 payload 现算值', () => {
    const manifest = JSON.parse(readFileSync(join(CLI_ROOT, 'asset-manifest.json'), 'utf8')) as AssetManifest;
    // 复用**生产实现**的 canonical 序列化与比对，不在测试内复述规则——
    // 守卫与被守对象各算各的，等于没守（功能规格 §2.81.2）。
    expect(() => validateAssetManifest(manifest, CLI_ROOT)).not.toThrow();

    // 反例：仅改 version 不重算 hash（0.15.4 部署实测的中间态）→ 必须被拦下并点名
    const tampered = { ...manifest, version: `${manifest.version}-probe` } as AssetManifest;
    let error: unknown;
    try { validateAssetManifest(tampered, CLI_ROOT); } catch (e) { error = e; }
    expect(error, '手改 version 未重算 hash 必须失败').toBeInstanceOf(Error);
    expect(String((error as Error).message)).toContain('payload hash 不匹配');
  });

  it('UT-S19-50: 升版脚本一次写全载体、派生值重算、非法零改写、重复幂等', () => {
    const root = repoCopy();
    const vA = readCurrentVersion(root);
    const [major, minor, patch] = vA.split('.').map(Number);
    const vB = `${major}.${minor}.${patch + 1}`;

    // ① 非法目标版本 → 拒绝且零改写
    const before = VERSION_CARRIERS.map(rel => readFileSync(join(root, rel), 'utf8'));
    const bad = planBump(root, 'not-a-version');
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(bad.changes).toEqual([]);
    VERSION_CARRIERS.forEach((rel, i) => {
      expect(readFileSync(join(root, rel), 'utf8'), `${rel} 必须零改写`).toBe(before[i]);
    });

    // ② 计划覆盖全部载体 + 候选/回滚两常量
    const plan = planBump(root, vB);
    expect(plan.errors).toEqual([]);
    for (const rel of VERSION_CARRIERS) {
      expect(plan.changes.some(c => c.file === rel), `${rel} 必须在升版计划内`).toBe(true);
    }
    expect(plan.changes.some(c => c.file.endsWith('#CANDIDATE') && c.to === vB)).toBe(true);
    expect(plan.changes.some(c => c.file.endsWith('#ROLLBACK') && c.to === vA)).toBe(true);

    // ③ 应用后：8 处载体全为 vB，常量正确，且无一处残留 vA
    applyBump(root, vB);
    for (const rel of VERSION_CARRIERS) {
      const text = readFileSync(join(root, rel), 'utf8');
      expect(text, `${rel} 必须含新版本`).toContain(`"version": "${vB}"`);
    }
    const consts = readFileSync(join(root, 'cli/src/lib/local-release-candidate.ts'), 'utf8');
    expect(consts).toContain(`LOCAL_RELEASE_CANDIDATE_VERSION = '${vB}'`);
    expect(consts).toContain(`LOCAL_RELEASE_ROLLBACK_VERSION = '${vA}'`);
    expect(readCurrentVersion(root)).toBe(vB);

    // ④ 幂等：对已是目标版本的副本重复执行 → 零改写
    const after = VERSION_CARRIERS.map(rel => readFileSync(join(root, rel), 'utf8'));
    const again = applyBump(root, vB);
    expect(again.changes, '已是目标版本时不得再产生改写').toEqual([]);
    VERSION_CARRIERS.forEach((rel, i) => {
      expect(readFileSync(join(root, rel), 'utf8'), `${rel} 幂等`).toBe(after[i]);
    });
  });
});
