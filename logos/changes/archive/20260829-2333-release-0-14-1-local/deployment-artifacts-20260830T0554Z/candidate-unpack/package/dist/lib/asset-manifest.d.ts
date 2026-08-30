export declare const ASSET_MANIFEST_SCHEMA: "openlogos/asset-manifest@1";
export interface ManagedAssetEntry {
    path: string;
    sha256: string;
}
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
export interface AssetSource {
    group: AssetGroup;
    path: string;
    sourcePath: string;
}
export interface ManagedAssetWrite {
    sourcePath: string;
    targetPath: string;
    sha256: string;
}
export declare function buildAssetManifest(version: string, planContractVersion: string, sources: AssetSource[]): AssetManifest;
export declare function validateAssetManifest(manifest: AssetManifest, packageRoot: string): void;
export declare function bundledManifestPath(): string;
export declare function readBundledAssetManifest(path?: string): AssetManifest;
export declare function writeSyncStamp(path: string, manifest: AssetManifest, syncedAt?: string): SyncStamp;
export declare function assetCacheKey(manifest: AssetManifest): string;
export declare function deriveManagedAssetsDiagnostic(root: string, manifest: AssetManifest): ManagedAssetsDiagnostic;
/** 只提交调用方显式列出的 OpenLogos 托管文件；任一步失败即恢复提交前字节。 */
export declare function applyManagedAssetsTransaction(writes: ManagedAssetWrite[], failAfter?: number): void;
export {};
//# sourceMappingURL=asset-manifest.d.ts.map