import { join } from 'node:path';
import { readLocale, t, type Locale } from '../i18n.js';
import {
  ARCHIVE_WATCH_ERROR_CODES,
  ArchiveWatchError,
  assertArchiveSlug,
  coordinateArchiveWatch,
  findRecoverableArchiveWatchSession,
  isWindowsArchiveBusyError,
  nodeArchiveWatchFs,
  reconcileArchiveDiskState,
  writeArchiveWatchResultBestEffort,
  type ArchiveWatchFileSystem,
  type ArchiveWatchResult,
  type ArchiveWatchRuntime,
  type ArchiveWatchSession,
} from '../lib/archive-watch.js';

export interface ArchiveCommandOptions extends ArchiveWatchRuntime {
  cwd?: string;
}

export interface ArchiveOutcome {
  archivePath: string;
  archiveDirname: string;
  handshakeMode: ArchiveWatchSession['mode'];
  reconciledFromDisk: boolean;
}

function archiveDirName(slug: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${date}-${time}-${slug}`;
}

function removeMatchingGuard(
  guardPath: string,
  slug: string,
  fs: ArchiveWatchFileSystem,
  log = true,
): void {
  if (!fs.exists(guardPath)) return;
  try {
    const guard = JSON.parse(fs.readText(guardPath));
    if (guard.activeChange === slug) {
      fs.unlink(guardPath);
      if (log) console.log('  ✓ logos/.openlogos-guard removed');
    }
  } catch {
    fs.unlink(guardPath);
  }
}

function exitArchiveWatchError(locale: Locale, error: ArchiveWatchError): never {
  console.error(t(locale, 'archive.watch.failed', { code: error.code, reason: error.reason }));
  if (error.reason === 'incompatible-instance') {
    console.error(t(locale, 'archive.watch.incompatible'));
  }
  if (error.details.length > 0) {
    console.error(t(locale, 'archive.watch.details', { details: error.details.join(', ') }));
  }
  process.exit(1);
}

function exitLegacyWatcherBusy(locale: Locale): never {
  console.error(t(locale, 'archive.watch.legacyBusy'));
  process.exit(1);
}

function findRecoveredArchivedPath(
  archiveDir: string,
  archiveDirname: string,
  fs: ArchiveWatchFileSystem,
): { archivePath: string; archiveDirname: string } | null {
  const archivePath = join(archiveDir, archiveDirname);
  if (!fs.exists(archivePath) || fs.isSymlink(archivePath)) return null;
  return { archivePath, archiveDirname };
}

export function archive(slug?: string, options: ArchiveCommandOptions = {}): ArchiveOutcome | undefined {
  const fs = options.fs ?? nodeArchiveWatchFs;
  const root = options.cwd ?? process.cwd();
  const configPath = join(root, 'logos', 'logos.config.json');

  if (!fs.exists(configPath)) {
    console.error('Error: logos/logos.config.json not found.');
    console.error('Run `openlogos init` first to initialize the project.');
    process.exit(1);
  }

  const locale = readLocale(root);

  if (!slug) {
    console.error('Error: Missing change proposal name.');
    console.error('Usage: openlogos archive <slug>');
    console.error('Example: openlogos archive add-remember-me');
    process.exit(1);
  }

  const now = options.now ?? (() => new Date());
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    try {
      assertArchiveSlug(slug);
    } catch (error) {
      if (error instanceof ArchiveWatchError) exitArchiveWatchError(locale, error);
      throw error;
    }
  }
  const changePath = join(root, 'logos', 'changes', slug);
  const archiveDir = join(root, 'logos', 'changes', 'archive');
  const guardPath = join(root, 'logos', '.openlogos-guard');

  if (!fs.exists(changePath)) {
    if (platform === 'win32') {
      let recovery;
      try {
        recovery = findRecoverableArchiveWatchSession(root, slug, { ...options, fs, platform, now });
      } catch (error) {
        if (error instanceof ArchiveWatchError) exitArchiveWatchError(locale, error);
        throw error;
      }
      const archived = recovery
        ? findRecoveredArchivedPath(archiveDir, recovery.archivePathHint, fs)
        : null;
      if (recovery && archived) {
        let disk = reconcileArchiveDiskState(changePath, archived.archivePath, guardPath, fs, slug);
        if (disk.guardActiveChange === slug) {
          try { removeMatchingGuard(guardPath, slug, fs, false); } catch { /* 由下一次三态裁决处理 */ }
          disk = reconcileArchiveDiskState(changePath, archived.archivePath, guardPath, fs, slug);
        }
        if (disk.status !== 'archived') {
          const error = new ArchiveWatchError(
            ARCHIVE_WATCH_ERROR_CODES.inconsistent,
            'live-archive-guard-state-inconsistent',
          );
          writeArchiveWatchResultBestEffort(recovery.session, {
            status: 'inconsistent',
            archivePathHint: archived.archiveDirname,
            exitCode: 1,
            finishedAt: now().toISOString(),
            reason: error.reason,
          }, { fs, randomId: options.randomId, pid: options.pid });
          exitArchiveWatchError(locale, error);
        }
        writeArchiveWatchResultBestEffort(recovery.session, {
          status: 'archived',
          archivePathHint: archived.archiveDirname,
          exitCode: 0,
          finishedAt: now().toISOString(),
          reconciledFromDisk: true,
        }, { fs, randomId: options.randomId, pid: options.pid });
        console.warn(t(locale, 'archive.watch.reconciled'));
        console.log(`\n${t(locale, 'archive.done', { slug })}`);
        console.log(`${t(locale, 'archive.path', { slug: archived.archiveDirname })}\n`);
        return {
          archivePath: archived.archivePath,
          archiveDirname: archived.archiveDirname,
          handshakeMode: recovery.session.mode,
          reconciledFromDisk: true,
        };
      }
    }
    console.error(`Error: Change proposal '${slug}' not found.`);
    process.exit(1);
  }

  const archiveDirname = archiveDirName(slug, now());
  const archivePath = join(archiveDir, archiveDirname);
  if (fs.exists(archivePath)) {
    console.error(`Error: Archive '${archiveDirname}' already exists in logos/changes/archive/.`);
    process.exit(1);
  }

  let session: ArchiveWatchSession = { mode: 'non-windows', expectedInstances: [] };
  if (platform === 'win32') {
    try {
      session = coordinateArchiveWatch(root, slug, {
        ...options,
        fs,
        platform,
        now,
        archivePathHint: archiveDirname,
      });
    } catch (error) {
      if (error instanceof ArchiveWatchError) exitArchiveWatchError(locale, error);
      throw error;
    }
  }

  let reconciledFromDisk = false;
  let finalResult: Omit<ArchiveWatchResult, 'protocol' | 'requestId'> | undefined;
  let terminalWatchError: ArchiveWatchError | undefined;
  let terminalLegacyBusy = false;

  try {
    fs.mkdir(archiveDir);
    fs.rename(changePath, archivePath);
    removeMatchingGuard(guardPath, slug, fs);
    finalResult = {
      status: 'archived',
      archivePathHint: archiveDirname,
      exitCode: 0,
      finishedAt: now().toISOString(),
    };
  } catch (error) {
    if (platform !== 'win32') throw error;

    let disk = reconcileArchiveDiskState(changePath, archivePath, guardPath, fs, slug);
    if (!disk.liveExists && disk.archiveExists && disk.guardActiveChange === slug) {
      try { removeMatchingGuard(guardPath, slug, fs, false); } catch { /* 由下一次三态裁决处理 */ }
      disk = reconcileArchiveDiskState(changePath, archivePath, guardPath, fs, slug);
    }

    if (disk.status === 'archived') {
      reconciledFromDisk = true;
      finalResult = {
        status: 'archived',
        archivePathHint: archiveDirname,
        exitCode: 0,
        finishedAt: now().toISOString(),
        reconciledFromDisk: true,
      };
    } else if (disk.status === 'inconsistent') {
      finalResult = {
        status: 'inconsistent',
        archivePathHint: archiveDirname,
        exitCode: 1,
        finishedAt: now().toISOString(),
        reason: 'live-archive-guard-state-inconsistent',
      };
      terminalWatchError = new ArchiveWatchError(
        ARCHIVE_WATCH_ERROR_CODES.inconsistent,
        'live-archive-guard-state-inconsistent',
      );
    } else {
      finalResult = {
        status: 'not-archived',
        archivePathHint: archiveDirname,
        exitCode: 1,
        finishedAt: now().toISOString(),
        reason: isWindowsArchiveBusyError(error) ? 'legacy-watcher-busy' : 'archive-rename-failed',
      };
      if (isWindowsArchiveBusyError(error)) terminalLegacyBusy = true;
      else throw error;
    }
  } finally {
    if (finalResult) {
      writeArchiveWatchResultBestEffort(session, finalResult, {
        fs,
        randomId: options.randomId,
        pid: options.pid,
      });
    }
  }

  if (terminalWatchError) exitArchiveWatchError(locale, terminalWatchError);
  if (terminalLegacyBusy) exitLegacyWatcherBusy(locale);
  if (reconciledFromDisk) console.warn(t(locale, 'archive.watch.reconciled'));
  console.log(`\n${t(locale, 'archive.done', { slug })}`);
  console.log(`${t(locale, 'archive.path', { slug: archiveDirname })}\n`);
  return { archivePath, archiveDirname, handshakeMode: session.mode, reconciledFromDisk };
}
