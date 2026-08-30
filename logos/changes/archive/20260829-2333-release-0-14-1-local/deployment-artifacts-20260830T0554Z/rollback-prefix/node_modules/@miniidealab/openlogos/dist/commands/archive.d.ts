import { type ArchiveWatchRuntime, type ArchiveWatchSession } from '../lib/archive-watch.js';
export interface ArchiveCommandOptions extends ArchiveWatchRuntime {
    cwd?: string;
}
export interface ArchiveOutcome {
    archivePath: string;
    archiveDirname: string;
    handshakeMode: ArchiveWatchSession['mode'];
    reconciledFromDisk: boolean;
}
export declare function archive(slug?: string, options?: ArchiveCommandOptions): ArchiveOutcome | undefined;
//# sourceMappingURL=archive.d.ts.map