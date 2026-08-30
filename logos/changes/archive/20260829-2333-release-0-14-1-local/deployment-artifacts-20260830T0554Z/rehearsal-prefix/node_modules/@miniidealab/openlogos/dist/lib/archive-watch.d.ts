export declare const ARCHIVE_WATCH_PROTOCOL = "openlogos.archive-watch/v1";
export declare const ARCHIVE_WATCH_ENV = "OPENLOGOS_ARCHIVE_WATCH_PREPARED";
export declare const DEFAULT_ARCHIVE_WATCH_TIMEOUT_MS = 5000;
export declare const DEFAULT_ARCHIVE_WATCH_POLL_MS = 50;
export declare const DEFAULT_ARCHIVE_WATCH_TTL_MS: number;
export declare const ARCHIVE_WATCH_ERROR_CODES: {
    readonly prepare: "ARCHIVE_WATCH_PREPARE_FAILED";
    readonly timeout: "ARCHIVE_WATCH_ACK_TIMEOUT";
    readonly instance: "ARCHIVE_WATCH_INSTANCE_FAILED";
    readonly inconsistent: "ARCHIVE_WATCH_STATE_INCONSISTENT";
};
export type ArchiveWatchErrorCode = typeof ARCHIVE_WATCH_ERROR_CODES[keyof typeof ARCHIVE_WATCH_ERROR_CODES];
export type ArchiveWatchFailureKind = keyof typeof ARCHIVE_WATCH_ERROR_CODES;
export interface ArchiveWatchFileSystem {
    exists(path: string): boolean;
    mkdir(path: string): void;
    readText(path: string): string;
    writeText(path: string, data: string, exclusive?: boolean): void;
    rename(from: string, to: string): void;
    unlink(path: string): void;
    removeTree(path: string): void;
    list(path: string): string[];
    isSymlink(path: string): boolean;
    realpath(path: string): string;
}
export declare const nodeArchiveWatchFs: ArchiveWatchFileSystem;
export interface ArchiveWatchPaths {
    projectRoot: string;
    runtimeRoot: string;
    instancesDir: string;
    requestsDir: string;
    requestDir?: string;
    preparePath?: string;
    acksDir?: string;
    ackPath?: string;
    resultPath?: string;
}
export interface ArchiveWatchLease {
    protocol: string;
    instanceId: string;
    pid?: number;
    projectId: string;
    startedAt?: string;
    heartbeatAt?: string;
    expiresAt: string;
    capabilities: string[];
}
export interface ArchiveWatchSnapshot {
    active: ArchiveWatchLease[];
    incompatible: Array<{
        instanceId: string;
        reason: string;
    }>;
}
export interface ArchiveWatchPrepare {
    protocol: typeof ARCHIVE_WATCH_PROTOCOL;
    requestId: string;
    projectId: string;
    slug: string;
    cliPid: number;
    createdAt: string;
    deadlineAt: string;
    expectedInstances: string[];
    mode: 'external';
    archivePathHint?: string;
}
export interface ArchiveWatchResult {
    protocol: typeof ARCHIVE_WATCH_PROTOCOL;
    requestId: string;
    status: 'archived' | 'not-archived' | 'inconsistent' | 'cancelled';
    archivePathHint?: string;
    exitCode: number;
    finishedAt: string;
    reason?: string;
    reconciledFromDisk?: boolean;
}
export interface PreparedArchiveWatchToken {
    protocol: typeof ARCHIVE_WATCH_PROTOCOL;
    requestId: string;
    projectId: string;
    slug: string;
    expiresAt: string;
}
export interface ArchiveWatchRuntime {
    fs?: ArchiveWatchFileSystem;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    sleep?: (milliseconds: number) => void;
    randomId?: () => string;
    pid?: number;
    timeoutMs?: number;
    pollMs?: number;
    ttlMs?: number;
    archivePathHint?: string;
}
export interface ArchiveWatchSession {
    mode: 'non-windows' | 'fast-path' | 'host-prepared' | 'coordinated';
    projectId?: string;
    requestId?: string;
    expectedInstances: string[];
    paths?: ArchiveWatchPaths;
}
export interface RecoverableArchiveWatchSession {
    session: ArchiveWatchSession;
    createdAt: string;
    archivePathHint: string;
}
export declare class ArchiveWatchError extends Error {
    readonly code: ArchiveWatchErrorCode;
    readonly reason: string;
    readonly details: string[];
    constructor(code: ArchiveWatchErrorCode, reason: string, details?: string[]);
}
export declare function archiveWatchErrorCodeFor(kind: ArchiveWatchFailureKind): ArchiveWatchErrorCode;
export declare function normalizeProjectPath(path: string, platform: NodeJS.Platform): string;
export declare function hashCanonicalProjectPath(canonicalPath: string): string;
export declare function projectIdForRoot(projectRoot: string, platform: NodeJS.Platform, fs?: ArchiveWatchFileSystem): string;
export declare function assertArchiveSlug(slug: string): void;
export declare function resolveArchiveWatchPaths(projectRoot: string, requestId?: string, instanceId?: string, fs?: ArchiveWatchFileSystem): ArchiveWatchPaths;
export declare function assertArchiveWatchPathSafe(paths: ArchiveWatchPaths, fs?: ArchiveWatchFileSystem): void;
export declare function atomicWriteArchiveWatchJson(paths: ArchiveWatchPaths, targetPath: string, value: unknown, runtime?: Pick<ArchiveWatchRuntime, 'fs' | 'randomId' | 'pid'>): void;
export declare function snapshotArchiveWatchInstances(projectRoot: string, projectId: string, runtime?: Pick<ArchiveWatchRuntime, 'fs' | 'now'>): ArchiveWatchSnapshot;
export declare function cleanupArchiveWatchRuntime(projectRoot: string, runtime?: Pick<ArchiveWatchRuntime, 'fs' | 'now' | 'ttlMs'>): void;
export declare function findRecoverableArchiveWatchSession(projectRoot: string, slug: string, runtime?: Pick<ArchiveWatchRuntime, 'fs' | 'now' | 'platform' | 'ttlMs'>): RecoverableArchiveWatchSession | null;
export declare function createArchiveWatchPrepare(projectRoot: string, prepare: ArchiveWatchPrepare, runtime?: Pick<ArchiveWatchRuntime, 'fs' | 'randomId' | 'pid'>): ArchiveWatchPaths;
export type ArchiveWatchPollResult = {
    status: 'released';
} | {
    status: 'failed';
    instanceId: string;
    reason: string;
} | {
    status: 'timeout';
    pending: string[];
};
export declare function pollArchiveWatchAcks(projectRoot: string, requestId: string, expectedInstances: string[], deadlineAt: string, runtime?: Pick<ArchiveWatchRuntime, 'fs' | 'now' | 'sleep' | 'pollMs'>): ArchiveWatchPollResult;
export declare function encodePreparedArchiveWatchToken(payload: PreparedArchiveWatchToken): string;
export declare function validatePreparedArchiveWatchToken(token: string | undefined, expected: {
    projectId: string;
    slug: string;
    now: Date;
}): boolean;
export declare function writeArchiveWatchResultBestEffort(session: ArchiveWatchSession, result: Omit<ArchiveWatchResult, 'protocol' | 'requestId'>, runtime?: Pick<ArchiveWatchRuntime, 'fs' | 'randomId' | 'pid'>): boolean;
export declare function coordinateArchiveWatch(projectRoot: string, slug: string, runtime?: ArchiveWatchRuntime): ArchiveWatchSession;
export interface ArchiveDiskState {
    status: 'archived' | 'live' | 'inconsistent';
    liveExists: boolean;
    archiveExists: boolean;
    guardActiveChange: string | null;
    reconciledFromDisk: boolean;
}
export declare function reconcileArchiveDiskState(livePath: string, archivePath: string, guardPath: string, fs?: ArchiveWatchFileSystem, slug?: string): ArchiveDiskState;
export declare function isWindowsArchiveBusyError(error: unknown): boolean;
//# sourceMappingURL=archive-watch.d.ts.map