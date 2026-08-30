/** Candidate 资产身份、有限 cutover 与 rollback；全局 reporter 自动记录 UT/ST ID。 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { makeTempRoot } from './helpers.js';
import { assetCacheKey, buildAssetManifest, readBundledAssetManifest, type AssetSource } from '../src/lib/asset-manifest.js';
import {
  AUTHORITY_CUTOVER_ORDER,
  authorityCandidateAssetPaths,
  validateAuthorityCandidateAssets,
  validateAuthorityCutover,
  validateAuthorityRollback,
  type InstalledIdentity,
} from '../src/lib/authority-candidate.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function assetFixture() {
  const { root, cleanup } = makeTempRoot(); cleanups.push(cleanup);
  const sources: AssetSource[] = authorityCandidateAssetPaths().map((path, index) => {
    const sourcePath = join(root, path); mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, `authority-asset-${index}\n`);
    return { group: path.startsWith('skills/') ? 'skills' : path.startsWith('spec/') ? 'schemas' : 'plugins', path, sourcePath };
  });
  return { root, manifest: buildAssetManifest('0.14.2', '1.4.0', sources) };
}

function identity(version: string, suffix: string): InstalledIdentity {
  return {
    version,
    entry_realpath: `/isolated/${suffix}/dist/index.js`,
    tarball_sha256: `sha256:${suffix}`,
    asset_payload_hash: `payload-${suffix}`,
  };
}

describe('S19 Authority Closure candidate', () => {
  it('UT-S19-26: 根 spec/六 Skill/plugin/manifest 同源，单资产漂移精确定位', () => {
    const fixture = assetFixture();
    expect(validateAuthorityCandidateAssets(fixture.manifest, fixture.root)).toEqual([]);
    const driftPath = authorityCandidateAssetPaths()[3];
    writeFileSync(join(fixture.root, driftPath), 'drift\n');
    expect(validateAuthorityCandidateAssets(fixture.manifest, fixture.root)).toContainEqual(expect.objectContaining({ path: driftPath }));
    expect(assetCacheKey(fixture.manifest)).toContain(fixture.manifest.payloadHash);
  });

  it('UT-S19-27: cutover 只有规范顺序、旧 writer 拒绝和 exit 齐全才通过', () => {
    const canonical = AUTHORITY_CUTOVER_ORDER.map(event => ({ event, success: true }));
    expect(validateAuthorityCutover(canonical)).toMatchObject({ pass: true, missing: [], out_of_order: false, old_writer_rejected: true });
    expect(validateAuthorityCutover(canonical.filter(row => row.event !== 'old_writer_rejected')).pass).toBe(false);
    expect(validateAuthorityCutover([canonical[1], canonical[0], ...canonical.slice(2)]).out_of_order).toBe(true);
  });

  it('UT-S19-28: rollback 恢复冻结旧身份且 candidate 重装幂等', () => {
    const candidate = identity('0.14.2', 'candidate'); const rollback = identity('0.14.1', 'rollback');
    expect(validateAuthorityRollback({ candidate_before: candidate, frozen_rollback: rollback, rollback_actual: { ...rollback }, candidate_after: { ...candidate } })).toEqual({ pass: true, failures: [] });
    expect(validateAuthorityRollback({ candidate_before: candidate, frozen_rollback: rollback, rollback_actual: candidate, candidate_after: rollback }).pass).toBe(false);
  });

  it('ST-S19-17: candidate 资产、writer 切换、回滚与再安装形成单一身份闭环', () => {
    const cliRoot = resolve(import.meta.dirname, '..');
    const manifest = readBundledAssetManifest(join(cliRoot, 'asset-manifest.json'));
    expect(validateAuthorityCandidateAssets(manifest, cliRoot)).toEqual([]);
    expect(validateAuthorityCutover(AUTHORITY_CUTOVER_ORDER.map(event => ({ event, success: true }))).pass).toBe(true);
    const candidate = identity(manifest.version, `candidate-${manifest.payloadHash}`); const rollback = identity('0.14.1', 'rollback');
    expect(validateAuthorityRollback({ candidate_before: candidate, frozen_rollback: rollback, rollback_actual: { ...rollback }, candidate_after: { ...candidate } }).pass).toBe(true);
    const runner = readFileSync(resolve(cliRoot, '..', 'scripts', 'smoke-authority-closure-candidate.js'), 'utf8');
    for (const field of ['candidate_identity', 'entry_realpath', 'tarball_sha256', 'asset_payload_hash']) expect(runner).toContain(field);
  });
});
