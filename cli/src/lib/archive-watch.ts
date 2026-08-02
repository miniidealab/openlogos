import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';

export const ARCHIVE_WATCH_PROTOCOL = 'openlogos.archive-watch/v1';
export const ARCHIVE_WATCH_ENV = 'OPENLOGOS_ARCHIVE_WATCH_PREPARED';
export const DEFAULT_ARCHIVE_WATCH_TIMEOUT_MS = 5_000;
export const DEFAULT_ARCHIVE_WATCH_POLL_MS = 50;
export const DEFAULT_ARCHIVE_WATCH_TTL_MS = 5 * 60_000;

export const ARCHIVE_WATCH_ERROR_CODES = {
  prepare: 'ARCHIVE_WATCH_PREPARE_FAILED',
  timeout: 'ARCHIVE_WATCH_ACK_TIMEOUT',
  instance: 'ARCHIVE_WATCH_INSTANCE_FAILED',
  inconsistent: 'ARCHIVE_WATCH_STATE_INCONSISTENT',
} as const;

export type ArchiveWatchErrorCode = typeof ARCHIVE_WATCH_ERROR_CODES[keyof typeof ARCHIVE_WATCH_ERROR_CODES];
export type ArchiveWatchFailureKind = keyof typeof ARCHIVE_WATCH_ERROR_CODES;

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

export const nodeArchiveWatchFs: ArchiveWatchFileSystem = {
  exists: existsSync,
  mkdir: (path) => { mkdirSync(path, { recursive: true, mode: 0o700 }); },
  readText: (path) => readFileSync(path, 'utf8'),
  writeText: (path, data, exclusive = false) => {
    writeFileSync(path, data, { encoding: 'utf8', flag: exclusive ? 'wx' : 'w', mode: 0o600 });
  },
  rename: renameSync,
  unlink: unlinkSync,
  removeTree: (path) => rmSync(path, { recursive: true, force: true }),
  list: (path) => readdirSync(path),
  isSymlink: (path) => lstatSync(path).isSymbolicLink(),
  realpath: (path) => realpathSync.native(path),
};

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
  incompatible: Array<{ instanceId: string; reason: string }>;
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

export class ArchiveWatchError extends Error {
  constructor(
    public readonly code: ArchiveWatchErrorCode,
    public readonly reason: string,
    public readonly details: string[] = [],
  ) {
    super(`${code}: ${reason}`);
    this.name = 'ArchiveWatchError';
  }
}

export function archiveWatchErrorCodeFor(kind: ArchiveWatchFailureKind): ArchiveWatchErrorCode {
  return ARCHIVE_WATCH_ERROR_CODES[kind];
}

export function normalizeProjectPath(path: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return win32.resolve(path).replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  }
  return resolve(path).replaceAll('\\', '/').replace(/\/$/, '');
}

export function hashCanonicalProjectPath(canonicalPath: string): string {
  return createHash('sha256')
    .update(`${ARCHIVE_WATCH_PROTOCOL}\0${canonicalPath}`, 'utf8')
    .digest('hex');
}

export function projectIdForRoot(
  projectRoot: string,
  platform: NodeJS.Platform,
  fs: ArchiveWatchFileSystem = nodeArchiveWatchFs,
): string {
  return hashCanonicalProjectPath(normalizeProjectPath(fs.realpath(projectRoot), platform));
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value) || value === '.' || value === '..') {
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, `invalid-${label}`);
  }
}

export function assertArchiveSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'invalid-slug');
  }
}

function isArchivePathHint(value: unknown, slug: string): value is string {
  return typeof value === 'string'
    && /^\d{8}-\d{4}-/.test(value)
    && value.endsWith(`-${slug}`)
    && basename(value) === value;
}

function isContained(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function resolveArchiveWatchPaths(
  projectRoot: string,
  requestId?: string,
  instanceId?: string,
  fs: ArchiveWatchFileSystem = nodeArchiveWatchFs,
): ArchiveWatchPaths {
  if (requestId !== undefined) assertIdentifier(requestId, 'request-id');
  if (instanceId !== undefined) assertIdentifier(instanceId, 'instance-id');

  const canonicalRoot = fs.exists(projectRoot) ? fs.realpath(projectRoot) : resolve(projectRoot);
  const runtimeRoot = join(canonicalRoot, 'logos', '.runtime', 'archive-watch', 'v1');
  const instancesDir = join(runtimeRoot, 'instances');
  const requestsDir = join(runtimeRoot, 'requests');
  const requestDir = requestId ? join(requestsDir, requestId) : undefined;
  const acksDir = requestDir ? join(requestDir, 'acks') : undefined;
  const paths: ArchiveWatchPaths = {
    projectRoot: canonicalRoot,
    runtimeRoot,
    instancesDir,
    requestsDir,
    requestDir,
    preparePath: requestDir ? join(requestDir, 'prepare.json') : undefined,
    acksDir,
    ackPath: acksDir && instanceId ? join(acksDir, `${instanceId}.json`) : undefined,
    resultPath: requestDir ? join(requestDir, 'result.json') : undefined,
  };

  for (const path of Object.values(paths)) {
    if (typeof path === 'string' && !isContained(canonicalRoot, path)) {
      throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'protocol-path-escape');
    }
  }
  return paths;
}

export function assertArchiveWatchPathSafe(
  paths: ArchiveWatchPaths,
  fs: ArchiveWatchFileSystem = nodeArchiveWatchFs,
): void {
  if (!isContained(paths.projectRoot, paths.runtimeRoot)) {
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'protocol-path-escape');
  }
  for (const target of new Set(Object.values(paths).filter((path): path is string => typeof path === 'string'))) {
    if (!isContained(paths.projectRoot, target)) {
      throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'protocol-path-escape');
    }
    const rel = relative(paths.projectRoot, target);
    let cursor = paths.projectRoot;
    for (const segment of rel.split(/[\\/]+/).filter(Boolean)) {
      cursor = join(cursor, segment);
      if (fs.exists(cursor) && fs.isSymlink(cursor)) {
        throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'protocol-symlink-refused');
      }
    }
  }
}

function ensureRuntimeDirectories(paths: ArchiveWatchPaths, fs: ArchiveWatchFileSystem): void {
  assertArchiveWatchPathSafe(paths, fs);
  fs.mkdir(paths.instancesDir);
  fs.mkdir(paths.requestsDir);
  if (paths.requestDir) fs.mkdir(paths.requestDir);
  if (paths.acksDir) fs.mkdir(paths.acksDir);
  assertArchiveWatchPathSafe(paths, fs);
}

function readJson(path: string, fs: ArchiveWatchFileSystem): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(fs.readText(path));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function atomicWriteArchiveWatchJson(
  paths: ArchiveWatchPaths,
  targetPath: string,
  value: unknown,
  runtime: Pick<ArchiveWatchRuntime, 'fs' | 'randomId' | 'pid'> = {},
): void {
  const fs = runtime.fs ?? nodeArchiveWatchFs;
  if (!isContained(paths.runtimeRoot, targetPath)) {
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'protocol-path-escape');
  }
  ensureRuntimeDirectories(paths, fs);
  fs.mkdir(dirname(targetPath));
  const suffix = (runtime.randomId ?? randomUUID)().replace(/[^A-Za-z0-9._-]/g, '-');
  const tempPath = join(dirname(targetPath), `.${basename(targetPath)}.tmp-${runtime.pid ?? process.pid}-${suffix}`);
  try {
    fs.writeText(tempPath, `${JSON.stringify(value)}\n`, true);
    fs.rename(tempPath, targetPath);
  } catch (error) {
    try { if (fs.exists(tempPath)) fs.unlink(tempPath); } catch { /* 尽力清理临时文件 */ }
    throw error;
  }
}

function parseDate(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function leaseFromRecord(record: Record<string, unknown>): ArchiveWatchLease | null {
  if (
    typeof record.protocol !== 'string'
    || typeof record.instanceId !== 'string'
    || typeof record.projectId !== 'string'
    || typeof record.expiresAt !== 'string'
    || !Array.isArray(record.capabilities)
  ) return null;
  return {
    protocol: record.protocol,
    instanceId: record.instanceId,
    pid: typeof record.pid === 'number' ? record.pid : undefined,
    projectId: record.projectId,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
    heartbeatAt: typeof record.heartbeatAt === 'string' ? record.heartbeatAt : undefined,
    expiresAt: record.expiresAt,
    capabilities: record.capabilities.filter((item): item is string => typeof item === 'string'),
  };
}

export function snapshotArchiveWatchInstances(
  projectRoot: string,
  projectId: string,
  runtime: Pick<ArchiveWatchRuntime, 'fs' | 'now'> = {},
): ArchiveWatchSnapshot {
  const fs = runtime.fs ?? nodeArchiveWatchFs;
  const nowMs = (runtime.now ?? (() => new Date()))().getTime();
  const paths = resolveArchiveWatchPaths(projectRoot, undefined, undefined, fs);
  if (!fs.exists(paths.instancesDir)) return { active: [], incompatible: [] };
  assertArchiveWatchPathSafe(paths, fs);

  const active: ArchiveWatchLease[] = [];
  const incompatible: Array<{ instanceId: string; reason: string }> = [];
  for (const filename of fs.list(paths.instancesDir).filter(name => name.endsWith('.json')).sort()) {
    const instanceId = filename.slice(0, -5);
    if (!IDENTIFIER_PATTERN.test(instanceId)) continue;
    const path = join(paths.instancesDir, filename);
    if (fs.isSymlink(path)) {
      incompatible.push({ instanceId, reason: 'lease-symlink-refused' });
      continue;
    }
    const record = readJson(path, fs);
    const lease = record ? leaseFromRecord(record) : null;
    if (!lease || lease.instanceId !== instanceId || lease.projectId !== projectId) continue;
    const expiresAt = parseDate(lease.expiresAt);
    if (expiresAt === null || expiresAt <= nowMs) continue;
    if (lease.protocol !== ARCHIVE_WATCH_PROTOCOL) {
      incompatible.push({ instanceId, reason: 'unsupported-protocol-major' });
      continue;
    }
    if (!lease.capabilities.includes('prepare')) {
      incompatible.push({ instanceId, reason: 'prepare-capability-missing' });
      continue;
    }
    active.push(lease);
  }
  return {
    active: active.sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
    incompatible: incompatible.sort((a, b) => a.instanceId.localeCompare(b.instanceId)),
  };
}

export function cleanupArchiveWatchRuntime(
  projectRoot: string,
  runtime: Pick<ArchiveWatchRuntime, 'fs' | 'now' | 'ttlMs'> = {},
): void {
  const fs = runtime.fs ?? nodeArchiveWatchFs;
  const nowMs = (runtime.now ?? (() => new Date()))().getTime();
  const ttlMs = runtime.ttlMs ?? DEFAULT_ARCHIVE_WATCH_TTL_MS;
  const paths = resolveArchiveWatchPaths(projectRoot, undefined, undefined, fs);
  if (!fs.exists(paths.runtimeRoot)) return;
  assertArchiveWatchPathSafe(paths, fs);

  if (fs.exists(paths.instancesDir)) {
    for (const filename of fs.list(paths.instancesDir).filter(name => name.endsWith('.json'))) {
      const path = join(paths.instancesDir, filename);
      if (fs.isSymlink(path)) continue;
      const record = readJson(path, fs);
      const expiresAt = record ? parseDate(record.expiresAt) : null;
      if (expiresAt !== null && expiresAt <= nowMs) {
        try { fs.unlink(path); } catch { /* 幂等清理失败不阻断归档 */ }
      }
    }
  }

  if (fs.exists(paths.requestsDir)) {
    for (const requestId of fs.list(paths.requestsDir)) {
      if (!IDENTIFIER_PATTERN.test(requestId)) continue;
      const requestPaths = resolveArchiveWatchPaths(projectRoot, requestId, undefined, fs);
      if (!requestPaths.requestDir || fs.isSymlink(requestPaths.requestDir)) continue;
      const prepare = requestPaths.preparePath && fs.exists(requestPaths.preparePath)
        ? readJson(requestPaths.preparePath, fs)
        : null;
      const result = requestPaths.resultPath && fs.exists(requestPaths.resultPath)
        ? readJson(requestPaths.resultPath, fs)
        : null;
      const baseTime = result ? parseDate(result.finishedAt) : prepare ? parseDate(prepare.deadlineAt) : null;
      if (baseTime !== null && baseTime + ttlMs <= nowMs) {
        try { fs.removeTree(requestPaths.requestDir); } catch { /* 幂等清理失败不阻断归档 */ }
      }
    }
  }
}

function findInFlightRequest(
  projectRoot: string,
  projectId: string,
  slug: string,
  fs: ArchiveWatchFileSystem,
  nowMs: number,
): string | null {
  const paths = resolveArchiveWatchPaths(projectRoot, undefined, undefined, fs);
  if (!fs.exists(paths.requestsDir)) return null;
  assertArchiveWatchPathSafe(paths, fs);
  for (const requestId of fs.list(paths.requestsDir).sort()) {
    if (!IDENTIFIER_PATTERN.test(requestId)) continue;
    const requestPaths = resolveArchiveWatchPaths(projectRoot, requestId, undefined, fs);
    assertArchiveWatchPathSafe(requestPaths, fs);
    if (!requestPaths.preparePath || !fs.exists(requestPaths.preparePath)) continue;
    if (requestPaths.resultPath && fs.exists(requestPaths.resultPath)) continue;
    const prepare = readJson(requestPaths.preparePath, fs);
    if (!prepare) continue;
    const deadline = parseDate(prepare.deadlineAt);
    if (
      prepare.protocol === ARCHIVE_WATCH_PROTOCOL
      && prepare.projectId === projectId
      && prepare.slug === slug
      && deadline !== null
      && deadline > nowMs
    ) return requestId;
  }
  return null;
}

export function findRecoverableArchiveWatchSession(
  projectRoot: string,
  slug: string,
  runtime: Pick<ArchiveWatchRuntime, 'fs' | 'now' | 'platform' | 'ttlMs'> = {},
): RecoverableArchiveWatchSession | null {
  assertArchiveSlug(slug);
  const fs = runtime.fs ?? nodeArchiveWatchFs;
  const platform = runtime.platform ?? process.platform;
  const nowMs = (runtime.now ?? (() => new Date()))().getTime();
  const ttlMs = runtime.ttlMs ?? DEFAULT_ARCHIVE_WATCH_TTL_MS;
  const projectId = projectIdForRoot(projectRoot, platform, fs);
  const basePaths = resolveArchiveWatchPaths(projectRoot, undefined, undefined, fs);
  if (!fs.exists(basePaths.requestsDir)) return null;
  assertArchiveWatchPathSafe(basePaths, fs);

  const candidates: RecoverableArchiveWatchSession[] = [];
  for (const requestId of fs.list(basePaths.requestsDir).sort()) {
    if (!IDENTIFIER_PATTERN.test(requestId)) continue;
    const paths = resolveArchiveWatchPaths(projectRoot, requestId, undefined, fs);
    assertArchiveWatchPathSafe(paths, fs);
    if (
      !paths.preparePath
      || !fs.exists(paths.preparePath)
      || (paths.resultPath !== undefined && fs.exists(paths.resultPath))
    ) continue;
    const prepare = readJson(paths.preparePath, fs);
    if (!prepare) continue;
    const deadlineAt = parseDate(prepare.deadlineAt);
    if (
      prepare.protocol !== ARCHIVE_WATCH_PROTOCOL
      || prepare.requestId !== requestId
      || prepare.projectId !== projectId
      || prepare.slug !== slug
      || typeof prepare.createdAt !== 'string'
      || !isArchivePathHint(prepare.archivePathHint, slug)
      || deadlineAt === null
      || deadlineAt + ttlMs <= nowMs
      || !Array.isArray(prepare.expectedInstances)
      || !prepare.expectedInstances.every(item => typeof item === 'string' && IDENTIFIER_PATTERN.test(item))
    ) continue;
    candidates.push({
      createdAt: prepare.createdAt,
      archivePathHint: prepare.archivePathHint,
      session: {
        mode: 'coordinated',
        projectId,
        requestId,
        expectedInstances: [...new Set(prepare.expectedInstances as string[])].sort(),
        paths,
      },
    });
  }

  if (candidates.length > 1) {
    throw new ArchiveWatchError(
      ARCHIVE_WATCH_ERROR_CODES.inconsistent,
      'multiple-recovery-requests',
      candidates.map(candidate => candidate.session.requestId ?? '').filter(Boolean),
    );
  }
  return candidates[0] ?? null;
}

export function createArchiveWatchPrepare(
  projectRoot: string,
  prepare: ArchiveWatchPrepare,
  runtime: Pick<ArchiveWatchRuntime, 'fs' | 'randomId' | 'pid'> = {},
): ArchiveWatchPaths {
  assertArchiveSlug(prepare.slug);
  const fs = runtime.fs ?? nodeArchiveWatchFs;
  const paths = resolveArchiveWatchPaths(projectRoot, prepare.requestId, undefined, fs);
  if (!paths.preparePath) throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'prepare-path-missing');
  atomicWriteArchiveWatchJson(paths, paths.preparePath, prepare, runtime);
  return paths;
}

export type ArchiveWatchPollResult =
  | { status: 'released' }
  | { status: 'failed'; instanceId: string; reason: string }
  | { status: 'timeout'; pending: string[] };

function defaultSleep(milliseconds: number): void {
  if (milliseconds <= 0) return;
  const view = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(view, 0, 0, milliseconds);
}

export function pollArchiveWatchAcks(
  projectRoot: string,
  requestId: string,
  expectedInstances: string[],
  deadlineAt: string,
  runtime: Pick<ArchiveWatchRuntime, 'fs' | 'now' | 'sleep' | 'pollMs'> = {},
): ArchiveWatchPollResult {
  const fs = runtime.fs ?? nodeArchiveWatchFs;
  const now = runtime.now ?? (() => new Date());
  const sleep = runtime.sleep ?? defaultSleep;
  const pollMs = runtime.pollMs ?? DEFAULT_ARCHIVE_WATCH_POLL_MS;
  const deadlineMs = Date.parse(deadlineAt);
  const expected = [...new Set(expectedInstances)].sort();

  while (true) {
    const pending: string[] = [];
    for (const instanceId of expected) {
      const paths = resolveArchiveWatchPaths(projectRoot, requestId, instanceId, fs);
      assertArchiveWatchPathSafe(paths, fs);
      if (!paths.ackPath || !fs.exists(paths.ackPath)) {
        pending.push(instanceId);
        continue;
      }
      if (fs.isSymlink(paths.ackPath)) {
        return { status: 'failed', instanceId, reason: 'ack-symlink-refused' };
      }
      const ack = readJson(paths.ackPath, fs);
      if (
        !ack
        || ack.protocol !== ARCHIVE_WATCH_PROTOCOL
        || ack.requestId !== requestId
        || ack.instanceId !== instanceId
      ) return { status: 'failed', instanceId, reason: 'invalid-ack' };
      if (ack.status === 'failed') {
        return {
          status: 'failed',
          instanceId,
          reason: typeof ack.reason === 'string' ? ack.reason : 'instance-failed',
        };
      }
      if (ack.status !== 'released') pending.push(instanceId);
    }
    if (pending.length === 0) return { status: 'released' };

    const currentMs = now().getTime();
    if (!Number.isFinite(deadlineMs) || currentMs >= deadlineMs) {
      return { status: 'timeout', pending };
    }
    sleep(Math.min(pollMs, Math.max(1, deadlineMs - currentMs)));
  }
}

export function encodePreparedArchiveWatchToken(payload: PreparedArchiveWatchToken): string {
  assertIdentifier(payload.requestId, 'request-id');
  assertArchiveSlug(payload.slug);
  if (payload.protocol !== ARCHIVE_WATCH_PROTOCOL || parseDate(payload.expiresAt) === null) {
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'invalid-prepared-token');
  }
  return `v1.${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}`;
}

export function validatePreparedArchiveWatchToken(
  token: string | undefined,
  expected: { projectId: string; slug: string; now: Date },
): boolean {
  if (!token?.startsWith('v1.')) return false;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token.slice(3), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const value = parsed as Record<string, unknown>;
    if (
      value.protocol !== ARCHIVE_WATCH_PROTOCOL
      || typeof value.requestId !== 'string'
      || !IDENTIFIER_PATTERN.test(value.requestId)
      || value.projectId !== expected.projectId
      || value.slug !== expected.slug
    ) return false;
    const expiresAt = parseDate(value.expiresAt);
    return expiresAt !== null && expiresAt > expected.now.getTime();
  } catch {
    return false;
  }
}

export function writeArchiveWatchResultBestEffort(
  session: ArchiveWatchSession,
  result: Omit<ArchiveWatchResult, 'protocol' | 'requestId'>,
  runtime: Pick<ArchiveWatchRuntime, 'fs' | 'randomId' | 'pid'> = {},
): boolean {
  if (session.mode !== 'coordinated' || !session.requestId || !session.paths?.resultPath) return false;
  try {
    atomicWriteArchiveWatchJson(session.paths, session.paths.resultPath, {
      protocol: ARCHIVE_WATCH_PROTOCOL,
      requestId: session.requestId,
      ...result,
    } satisfies ArchiveWatchResult, runtime);
    return true;
  } catch {
    return false;
  }
}

function notArchivedResult(
  session: ArchiveWatchSession,
  reason: string,
  now: () => Date,
  runtime: Pick<ArchiveWatchRuntime, 'fs' | 'randomId' | 'pid'>,
): void {
  writeArchiveWatchResultBestEffort(session, {
    status: 'not-archived',
    exitCode: 1,
    finishedAt: now().toISOString(),
    reason,
  }, runtime);
}

export function coordinateArchiveWatch(
  projectRoot: string,
  slug: string,
  runtime: ArchiveWatchRuntime = {},
): ArchiveWatchSession {
  const platform = runtime.platform ?? process.platform;
  if (platform !== 'win32') return { mode: 'non-windows', expectedInstances: [] };

  assertArchiveSlug(slug);
  const fs = runtime.fs ?? nodeArchiveWatchFs;
  const now = runtime.now ?? (() => new Date());
  const randomId = runtime.randomId ?? randomUUID;
  let projectId: string;
  try {
    projectId = projectIdForRoot(projectRoot, platform, fs);
  } catch (error) {
    if (error instanceof ArchiveWatchError) throw error;
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'project-resolution-failed');
  }
  const token = (runtime.env ?? process.env)[ARCHIVE_WATCH_ENV];
  if (validatePreparedArchiveWatchToken(token, { projectId, slug, now: now() })) {
    return { mode: 'host-prepared', projectId, expectedInstances: [] };
  }

  let snapshot: ArchiveWatchSnapshot;
  try {
    cleanupArchiveWatchRuntime(projectRoot, runtime);
    snapshot = snapshotArchiveWatchInstances(projectRoot, projectId, runtime);
  } catch (error) {
    if (error instanceof ArchiveWatchError) throw error;
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'protocol-snapshot-failed');
  }
  if (snapshot.incompatible.length > 0) {
    throw new ArchiveWatchError(
      ARCHIVE_WATCH_ERROR_CODES.prepare,
      'incompatible-instance',
      snapshot.incompatible.map(item => `${item.instanceId}:${item.reason}`),
    );
  }
  if (snapshot.active.length === 0) {
    return { mode: 'fast-path', projectId, expectedInstances: [] };
  }

  const nowValue = now();
  let inFlight: string | null;
  try {
    inFlight = findInFlightRequest(projectRoot, projectId, slug, fs, nowValue.getTime());
  } catch (error) {
    if (error instanceof ArchiveWatchError) throw error;
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'single-flight-check-failed');
  }
  if (inFlight) {
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'archive-in-flight', [inFlight]);
  }

  let requestId: string;
  try {
    requestId = randomId();
  } catch {
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'request-id-generation-failed');
  }
  assertIdentifier(requestId, 'request-id');
  const expectedInstances = snapshot.active.map(item => item.instanceId).sort();
  const deadlineAt = new Date(nowValue.getTime() + (runtime.timeoutMs ?? DEFAULT_ARCHIVE_WATCH_TIMEOUT_MS)).toISOString();
  const prepare: ArchiveWatchPrepare = {
    protocol: ARCHIVE_WATCH_PROTOCOL,
    requestId,
    projectId,
    slug,
    cliPid: runtime.pid ?? process.pid,
    createdAt: nowValue.toISOString(),
    deadlineAt,
    expectedInstances,
    mode: 'external',
    ...(isArchivePathHint(runtime.archivePathHint, slug)
      ? { archivePathHint: runtime.archivePathHint }
      : {}),
  };

  let paths: ArchiveWatchPaths;
  try {
    paths = createArchiveWatchPrepare(projectRoot, prepare, { fs, randomId, pid: runtime.pid });
  } catch (error) {
    if (error instanceof ArchiveWatchError) throw error;
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'prepare-write-failed');
  }
  const session: ArchiveWatchSession = { mode: 'coordinated', projectId, requestId, expectedInstances, paths };
  let poll: ArchiveWatchPollResult;
  try {
    poll = pollArchiveWatchAcks(projectRoot, requestId, expectedInstances, deadlineAt, runtime);
  } catch (error) {
    notArchivedResult(session, 'ack-read-failed', now, { fs, randomId, pid: runtime.pid });
    if (error instanceof ArchiveWatchError) throw error;
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.instance, 'ack-read-failed');
  }
  if (poll.status === 'failed') {
    notArchivedResult(session, `${poll.instanceId}:${poll.reason}`, now, { fs, randomId, pid: runtime.pid });
    throw new ArchiveWatchError(
      ARCHIVE_WATCH_ERROR_CODES.instance,
      poll.reason,
      [poll.instanceId],
    );
  }
  if (poll.status === 'timeout') {
    notArchivedResult(session, `pending:${poll.pending.join(',')}`, now, { fs, randomId, pid: runtime.pid });
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.timeout, 'ack-timeout', poll.pending);
  }

  let finalSnapshot: ArchiveWatchSnapshot;
  try {
    finalSnapshot = snapshotArchiveWatchInstances(projectRoot, projectId, runtime);
  } catch (error) {
    notArchivedResult(session, 'instance-resnapshot-failed', now, { fs, randomId, pid: runtime.pid });
    if (error instanceof ArchiveWatchError) throw error;
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'instance-resnapshot-failed');
  }
  const unexpected = finalSnapshot.active
    .map(item => item.instanceId)
    .filter(instanceId => !expectedInstances.includes(instanceId));
  if (finalSnapshot.incompatible.length > 0 || unexpected.length > 0) {
    const details = [
      ...finalSnapshot.incompatible.map(item => `${item.instanceId}:${item.reason}`),
      ...unexpected.map(instanceId => `${instanceId}:new-instance-race`),
    ];
    notArchivedResult(session, details.join(','), now, { fs, randomId, pid: runtime.pid });
    throw new ArchiveWatchError(ARCHIVE_WATCH_ERROR_CODES.prepare, 'instance-snapshot-changed', details);
  }
  return session;
}

export interface ArchiveDiskState {
  status: 'archived' | 'live' | 'inconsistent';
  liveExists: boolean;
  archiveExists: boolean;
  guardActiveChange: string | null;
  reconciledFromDisk: boolean;
}

function readGuardActiveChange(guardPath: string, fs: ArchiveWatchFileSystem): string | null {
  if (!fs.exists(guardPath)) return null;
  const guard = readJson(guardPath, fs);
  return guard && typeof guard.activeChange === 'string' ? guard.activeChange : null;
}

export function reconcileArchiveDiskState(
  livePath: string,
  archivePath: string,
  guardPath: string,
  fs: ArchiveWatchFileSystem = nodeArchiveWatchFs,
  slug?: string,
): ArchiveDiskState {
  const liveExists = fs.exists(livePath);
  const archiveExists = fs.exists(archivePath);
  const guardActiveChange = readGuardActiveChange(guardPath, fs);
  if (!liveExists && archiveExists && (!slug || guardActiveChange !== slug)) {
    return { status: 'archived', liveExists, archiveExists, guardActiveChange, reconciledFromDisk: true };
  }
  if (liveExists && !archiveExists) {
    return { status: 'live', liveExists, archiveExists, guardActiveChange, reconciledFromDisk: false };
  }
  return { status: 'inconsistent', liveExists, archiveExists, guardActiveChange, reconciledFromDisk: false };
}

export function isWindowsArchiveBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}
