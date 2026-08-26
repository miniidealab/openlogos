import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSET_MANIFEST_SCHEMA = 'openlogos/asset-manifest@1' as const;

export interface ManagedAssetEntry { path: string; sha256: string }
export interface AssetManifest {
  schema: typeof ASSET_MANIFEST_SCHEMA;
  version: string;
  planContractVersion: string;
  skills: ManagedAssetEntry[];
  templates: ManagedAssetEntry[];
  schemas: ManagedAssetEntry[];
  plugins: ManagedAssetEntry[];
  payloadHash: string;
}

export interface SyncStamp {
  cliVersion: string;
  syncedAt: string;
  planContractVersion: string;
  managedAssetsHash: string;
}

export interface ManagedAssetsDiagnostic {
  status: 'current' | 'missing' | 'stale' | 'invalid';
  expected_hash: string;
  actual_hash: string | null;
  reason: 'current' | 'sync-required' | 'same-version-asset-drift' | 'stamp-invalid';
  action: string | null;
  requires_session_restart: boolean;
}

type AssetGroup = 'skills' | 'templates' | 'schemas' | 'plugins';
export interface AssetSource { group: AssetGroup; path: string; sourcePath: string }
export interface ManagedAssetWrite { sourcePath: string; targetPath: string; sha256: string }

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalPayload(value: Omit<AssetManifest, 'payloadHash'>): string {
  const sorted = { ...value };
  for (const group of ['skills', 'templates', 'schemas', 'plugins'] as const) {
    sorted[group] = [...value[group]].sort((a, b) => a.path.localeCompare(b.path));
  }
  return JSON.stringify(sorted);
}

export function buildAssetManifest(version: string, planContractVersion: string, sources: AssetSource[]): AssetManifest {
  const groups: Record<AssetGroup, ManagedAssetEntry[]> = { skills: [], templates: [], schemas: [], plugins: [] };
  for (const source of sources) {
    groups[source.group].push({ path: source.path, sha256: sha256(readFileSync(source.sourcePath)) });
  }
  const payload = { schema: ASSET_MANIFEST_SCHEMA, version, planContractVersion, ...groups };
  return { ...payload, payloadHash: sha256(canonicalPayload(payload)) };
}

export function validateAssetManifest(manifest: AssetManifest, packageRoot: string): void {
  if (manifest.schema !== ASSET_MANIFEST_SCHEMA || !manifest.version || !manifest.planContractVersion) {
    throw new Error('asset manifest schema 或版本字段非法');
  }
  const { payloadHash, ...payload } = manifest;
  const canonicalHash = sha256(canonicalPayload(payload));
  if (!/^[a-f0-9]{64}$/.test(payloadHash) || canonicalHash !== payloadHash) {
    throw new Error(`asset manifest payload hash 不匹配：expected=${payloadHash} actual=${canonicalHash}`);
  }
  for (const group of ['skills', 'templates', 'schemas', 'plugins'] as const) {
    for (const entry of manifest[group]) {
      if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) throw new Error(`asset path 非法：${entry.path}`);
      let path = resolve(packageRoot, entry.path);
      if (!existsSync(path)) {
        const developmentFallbacks: Record<string, string> = {
          'skills/': '../skills/', 'spec/': '../spec/', 'claude-plugin-template/': '../plugin/',
        };
        const prefix = Object.keys(developmentFallbacks).find(item => entry.path.startsWith(item));
        if (prefix) path = resolve(packageRoot, developmentFallbacks[prefix], entry.path.slice(prefix.length));
      }
      const actual = existsSync(path) ? sha256(readFileSync(path)) : 'missing';
      if (actual !== entry.sha256) throw new Error(`asset hash 不匹配：${entry.path} expected=${entry.sha256} actual=${actual}`);
    }
  }
}

export function bundledManifestPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../asset-manifest.json');
}

export function readBundledAssetManifest(path = bundledManifestPath()): AssetManifest {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as AssetManifest;
  if (parsed.schema !== ASSET_MANIFEST_SCHEMA) throw new Error(`不支持 asset manifest schema：${String(parsed.schema)}`);
  return parsed;
}

export function writeSyncStamp(path: string, manifest: AssetManifest, syncedAt = new Date().toISOString()): SyncStamp {
  if (existsSync(path)) {
    try {
      const current = JSON.parse(readFileSync(path, 'utf8')) as SyncStamp;
      if (current.cliVersion === manifest.version
        && current.planContractVersion === manifest.planContractVersion
        && current.managedAssetsHash === manifest.payloadHash
        && typeof current.syncedAt === 'string') return current;
    } catch { /* 非法旧 stamp 由本次原子写替换 */ }
  }
  const stamp: SyncStamp = {
    cliVersion: manifest.version,
    syncedAt,
    planContractVersion: manifest.planContractVersion,
    managedAssetsHash: manifest.payloadHash,
  };
  const temp = join(dirname(path), `.${path.split('/').pop()}.tmp-${process.pid}`);
  writeFileSync(temp, JSON.stringify(stamp, null, 2) + '\n');
  renameSync(temp, path);
  return stamp;
}

export function assetCacheKey(manifest: AssetManifest): string {
  return `${manifest.version}-${manifest.payloadHash}`;
}

export function deriveManagedAssetsDiagnostic(root: string, manifest: AssetManifest): ManagedAssetsDiagnostic {
  const path = join(root, 'logos', '.openlogos-sync.json');
  if (!existsSync(path)) return {
    status: 'missing', expected_hash: manifest.payloadHash, actual_hash: null,
    reason: 'sync-required', action: '运行 openlogos sync，并重开 Agent session。', requires_session_restart: true,
  };
  try {
    const stamp = JSON.parse(readFileSync(path, 'utf8')) as Partial<SyncStamp>;
    if (typeof stamp.managedAssetsHash !== 'string' || typeof stamp.planContractVersion !== 'string') throw new Error('字段缺失');
    const current = stamp.managedAssetsHash === manifest.payloadHash && stamp.planContractVersion === manifest.planContractVersion;
    if (current) return {
      status: 'current', expected_hash: manifest.payloadHash, actual_hash: stamp.managedAssetsHash,
      reason: 'current', action: null, requires_session_restart: false,
    };
    return {
      status: 'stale', expected_hash: manifest.payloadHash, actual_hash: stamp.managedAssetsHash,
      reason: stamp.cliVersion === manifest.version ? 'same-version-asset-drift' : 'sync-required',
      action: '运行 openlogos sync，并重开 Agent session。', requires_session_restart: true,
    };
  } catch {
    return {
      status: 'invalid', expected_hash: manifest.payloadHash, actual_hash: null,
      reason: 'stamp-invalid', action: '修复或重新运行 openlogos sync，并重开 Agent session。', requires_session_restart: true,
    };
  }
}

/** 只提交调用方显式列出的 OpenLogos 托管文件；任一步失败即恢复提交前字节。 */
export function applyManagedAssetsTransaction(writes: ManagedAssetWrite[], failAfter = -1): void {
  const backups = writes.map(write => ({
    targetPath: write.targetPath,
    existed: existsSync(write.targetPath),
    bytes: existsSync(write.targetPath) ? readFileSync(write.targetPath) : null,
  }));
  const temps: string[] = [];
  try {
    for (let index = 0; index < writes.length; index++) {
      const write = writes[index];
      const actual = sha256(readFileSync(write.sourcePath));
      if (actual !== write.sha256) throw new Error(`managed asset source hash 不匹配：${write.sourcePath}`);
      mkdirSync(dirname(write.targetPath), { recursive: true });
      const temp = `${write.targetPath}.openlogos-tmp-${process.pid}-${index}`;
      copyFileSync(write.sourcePath, temp); temps.push(temp);
      if (sha256(readFileSync(temp)) !== write.sha256) throw new Error(`managed asset staged hash 不匹配：${write.targetPath}`);
    }
    for (let index = 0; index < writes.length; index++) {
      renameSync(temps[index], writes[index].targetPath);
      if (index === failAfter) throw new Error(`managed asset fault injection: ${index}`);
    }
  } catch (error) {
    for (const backup of backups) {
      if (backup.existed) writeFileSync(backup.targetPath, backup.bytes!);
      else rmSync(backup.targetPath, { force: true });
    }
    for (const temp of temps) rmSync(temp, { force: true });
    throw error;
  }
}
