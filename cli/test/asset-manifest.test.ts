/** Plan 合同托管资产与 sync 身份回归；由全局 OpenLogos reporter 上报。 */
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyManagedAssetsTransaction, buildAssetManifest, deriveManagedAssetsDiagnostic,
  validateAssetManifest, writeSyncStamp, type AssetSource,
} from '../src/lib/asset-manifest.js';
import { makeTempRoot } from './helpers.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

function assetFixture(bytes = 'canonical skill') {
  const made = makeTempRoot(); cleanups.push(made.cleanup);
  const skill = join(made.root, 'skills/change-writer/SKILL.md');
  const template = join(made.root, 'dist/i18n.js');
  mkdirSync(join(made.root, 'skills/change-writer'), { recursive: true });
  mkdirSync(join(made.root, 'dist'), { recursive: true });
  mkdirSync(join(made.root, 'logos'), { recursive: true });
  writeFileSync(skill, bytes); writeFileSync(template, 'template bytes');
  const sources: AssetSource[] = [
    { group: 'skills', path: 'skills/change-writer/SKILL.md', sourcePath: skill },
    { group: 'templates', path: 'dist/i18n.js', sourcePath: template },
  ];
  return { ...made, skill, template, sources, manifest: buildAssetManifest('0.13.31', '1.3.0', sources) };
}

describe('S08 asset manifest 与 sync', () => {
  it('UT-S08-38: asset manifest canonical hash 稳定', () => {
    const a = assetFixture(); const b = assetFixture();
    expect(b.manifest).toEqual(a.manifest);
    expect(a.manifest.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(a.manifest)).not.toContain('syncedAt');
  });

  it('UT-S08-39: Skill/模板改变要求版本或 cachebuster', () => {
    const f = assetFixture();
    writeFileSync(f.skill, 'drift at same semver');
    expect(() => validateAssetManifest(f.manifest, f.root)).toThrow(/SKILL\.md.*expected=.*actual=/);
  });

  it('UT-S08-40: sync stamp 新字段完整', () => {
    const f = assetFixture(); const path = join(f.root, 'logos/.openlogos-sync.json');
    const stamp = writeSyncStamp(path, f.manifest, '2026-08-26T00:00:00.000Z');
    expect(stamp).toEqual({
      cliVersion: '0.13.31', syncedAt: '2026-08-26T00:00:00.000Z',
      planContractVersion: '1.3.0', managedAssetsHash: f.manifest.payloadHash,
    });
  });

  it('UT-S08-41: 过期 stamp 产生 producer 诊断', () => {
    const f = assetFixture();
    writeFileSync(join(f.root, 'logos/.openlogos-sync.json'), JSON.stringify({
      cliVersion: '0.13.31', syncedAt: '2026-08-25T00:00:00.000Z',
      planContractVersion: '1.2.0', managedAssetsHash: '0'.repeat(64),
    }));
    expect(deriveManagedAssetsDiagnostic(f.root, f.manifest)).toMatchObject({
      status: 'stale', reason: 'same-version-asset-drift', requires_session_restart: true,
    });
  });

  it('UT-S08-42: 用户与项目 Skill 所有权不变', () => {
    const f = assetFixture(); const managed = join(f.root, 'project/managed/SKILL.md');
    const user = join(f.root, 'project/user/SKILL.md');
    mkdirSync(join(f.root, 'project/user'), { recursive: true });
    writeFileSync(user, 'user-owned');
    const userBefore = hash(readFileSync(user));
    applyManagedAssetsTransaction([{ sourcePath: f.skill, targetPath: managed, sha256: hash(readFileSync(f.skill)) }]);
    expect(hash(readFileSync(user))).toBe(userBefore);
    expect(readFileSync(managed, 'utf8')).toBe('canonical skill');
  });

  it('ST-S08-28: 候选包到项目 stamp 全链对账', () => {
    const f = assetFixture(); validateAssetManifest(f.manifest, f.root);
    const path = join(f.root, 'logos/.openlogos-sync.json');
    writeSyncStamp(path, f.manifest, '2026-08-26T00:00:00.000Z');
    const first = readFileSync(path);
    writeSyncStamp(path, f.manifest, '2026-08-26T00:00:00.000Z');
    expect(readFileSync(path)).toEqual(first);
    expect(deriveManagedAssetsDiagnostic(f.root, f.manifest).status).toBe('current');
  });

  it('ST-S08-29: 同 semver 旧缓存与中途失败均 fail loud', () => {
    const f = assetFixture(); const one = join(f.root, 'managed/one'); const two = join(f.root, 'managed/two');
    mkdirSync(join(f.root, 'managed'), { recursive: true });
    writeFileSync(one, 'old-one'); writeFileSync(two, 'old-two');
    expect(() => applyManagedAssetsTransaction([
      { sourcePath: f.skill, targetPath: one, sha256: hash(readFileSync(f.skill)) },
      { sourcePath: f.template, targetPath: two, sha256: hash(readFileSync(f.template)) },
    ], 0)).toThrow(/fault injection/);
    expect(readFileSync(one, 'utf8')).toBe('old-one');
    expect(readFileSync(two, 'utf8')).toBe('old-two');
  });
});
