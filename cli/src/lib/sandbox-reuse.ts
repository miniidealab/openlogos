/**
 * verify / smoke 沙箱复用（功能规格 §2.91，来源变更 verify-sandbox-reuse-0-16-1）。
 *
 * 一次性沙箱每次 `mkdtemp + cpSync + removeTree`，路径随机、mtime 被重置、构建产物被丢弃，构建工具的
 * 增量编译全部失效。本模块提供每项目一份的持久沙箱：
 *
 * - 项目目录 `<sandbox_root>/openlogos-cli-sandbox-reuse-<项目根 realpath SHA-256 前 16 位>/`，
 *   其下 `lock/` 为世代锁记录、`ws-<世代号>/` 为工作区世代（`workspace/` + `sync-manifest.json`）；
 * - 世代锁（§2.91.6）：先定目标世代、再以 `link()` 原子排他发布 `gen-<N+1>`；已用编号永久占位，
 *   释放只写 `released` / `tainted` 标记，从不删除锁记录；
 * - 镜像同步（§2.91.4）：两侧 stat 指纹 + racy 判定决定能否跳过，否则判定内容；内容同步后原位整定
 *   mode / mtime；缓存路径归沙箱所有；全程不跟随 symlink；
 * - 旧写入者存活检查：进程组探测 + 运行标记扫描，是复用、fresh 删除与释放标记的唯一安全事实。
 *
 * 门禁判定不在本模块：这里只决定命令在哪个目录、以什么输入运行。
 */
import {
  chmodSync, closeSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync,
  readFileSync, readlinkSync, readSync, realpathSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync,
  type BigIntStats,
} from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isAbsolute, join, normalize, sep } from 'node:path';
import { removeTree } from './fs-remove.js';
import { renameWithRetry } from './fs-retry.js';

export type SandboxReuseState = 'created' | 'reused' | 'recovered' | 'fresh' | 'busy-fallback' | 'unsupported' | 'disabled';

/** JSON `sandbox.reuse`（spec/cli-json-output.md「verify / smoke `sandbox.reuse` 沙箱复用字段」）。 */
export interface SandboxReuseData {
  enabled: boolean;
  state: SandboxReuseState;
  dir: string | null;
  generation: string | null;
  copied: number;
  removed: number;
  content_compared: number;
  sync_ms: number;
  abandoned: string[];
}

export const PROJECT_DIR_PREFIX = 'openlogos-cli-sandbox-reuse-';
export const RUN_TAG_ENV = 'OPENLOGOS_SANDBOX_RUN';
export const SYNC_MANIFEST_NAME = 'sync-manifest.json';
export const SYNC_MANIFEST_SCHEMA = 'openlogos/sandbox-sync-manifest@1';
const PROJECT_META_NAME = 'project.json';
const GEN_PAD = 12;
const GEN_RE = /^gen-(\d{12})$/;
/** racy 窗口（§2.91.4）：ctime 距上次清单写入不足 2 秒的文件不得凭指纹跳过。 */
const RACY_WINDOW_NS = 2_000_000_000n;
const COMPARE_CHUNK = 1024 * 1024;

export function emptyReuseData(state: SandboxReuseState, enabled: boolean, dir: string | null = null): SandboxReuseData {
  return { enabled, state, dir, generation: null, copied: 0, removed: 0, content_compared: 0, sync_ms: 0, abandoned: [] };
}

function sha16(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export function projectDirName(projectRoot: string): string {
  let real = projectRoot;
  try { real = realpathSync(projectRoot); } catch { /* 保底用原路径 */ }
  return `${PROJECT_DIR_PREFIX}${sha16(real)}`;
}

/** 运行标记：目标世代目录绝对路径的 SHA-256 前 16 位（§2.91.6）。 */
export function runTagFor(wsDir: string): string {
  return sha16(wsDir);
}

function genName(n: number): string {
  return `gen-${String(n).padStart(GEN_PAD, '0')}`;
}

function wsName(n: number): string {
  return `ws-${String(n).padStart(GEN_PAD, '0')}`;
}

function isWithin(root: string, target: string): boolean {
  const t = normalize(target);
  return t === root || t.startsWith(`${root}${sep}`);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// ───────────────────────── 测试接缝（仅由测试经环境变量启用） ─────────────────────────

/** 锁发布前屏障：写 `<dir>/ready-<pid>`，等待 `<dir>/go` 出现（最长 60 秒）。 */
function testBarrierBeforeLink(): void {
  const dir = process.env.OPENLOGOS_SANDBOX_TEST_BEFORE_LINK;
  if (!dir) return;
  try { writeFileSync(join(dir, `ready-${process.pid}`), ''); } catch { return; }
  const deadline = Date.now() + 60_000;
  while (!existsSync(join(dir, 'go')) && Date.now() < deadline) sleepSync(20);
}

function testLinkError(): NodeJS.ErrnoException | null {
  const code = process.env.OPENLOGOS_SANDBOX_TEST_LINK_ERROR;
  if (!code) return null;
  const err = new Error(`${code}: simulated link failure`) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

function testExitAfterPublish(): void {
  if (process.env.OPENLOGOS_SANDBOX_TEST_EXIT_AFTER_PUBLISH === '1') process.kill(process.pid, 'SIGKILL');
}

// ───────────────────────── 旧写入者存活检查 ─────────────────────────

export interface LivenessCapability { available: boolean; reason?: string }

let cachedCapability: LivenessCapability | undefined;

/**
 * 平台能力（§2.91.6「无法复用的环境」）：需要进程组探测与运行标记扫描两项能力。
 * 扫描能力以**实际试跑一次**为准（结果按进程缓存）：macOS 读取进程初始环境依赖 setuid 的 /bin/ps，
 * 而 sandbox-exec 等 Seatbelt 沙箱内禁止执行 setuid 程序（execvp EPERM）。只看文件是否存在会把
 * 嵌套沙箱误判为可复用，导致每轮都无法完成存活检查、写 tainted 并新建世代、被弃用世代不断累积。
 */
export function detectLivenessCapability(): LivenessCapability {
  if (process.env.OPENLOGOS_SANDBOX_TEST_NO_LIVENESS === '1') {
    return { available: false, reason: '测试接缝已模拟当前平台不具备进程组探测与运行标记扫描能力' };
  }
  if (cachedCapability) return cachedCapability;
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    cachedCapability = { available: false, reason: `当前平台（${process.platform}）不具备进程组探测与运行标记扫描能力` };
    return cachedCapability;
  }
  try {
    if (process.platform === 'linux') readFileSync('/proc/self/environ');
    else scanRunTag('capability-probe');
    cachedCapability = { available: true };
  } catch (error) {
    const message = (error as Error).message?.split('\n')[0]?.slice(0, 200) ?? 'unknown';
    cachedCapability = { available: false, reason: `运行标记扫描不可用（${message}），常见于 Seatbelt 等嵌套沙箱内` };
  }
  return cachedCapability;
}

export interface LivenessResult { ok: boolean; reason?: string }

/** `kill(-pgid, 0)`：ESRCH 表示组已空；成功或 EPERM 表示仍有成员；其它错误视为无法确认。 */
function probeProcessGroup(pgid: number): LivenessResult {
  try {
    process.kill(-pgid, 0);
    return { ok: false, reason: `命令进程组 ${pgid} 仍有存活成员` };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return { ok: true };
    if (code === 'EPERM') return { ok: false, reason: `命令进程组 ${pgid} 仍有存活成员（EPERM）` };
    return { ok: false, reason: `进程组探测失败（${code ?? 'unknown'}）` };
  }
}

/** /proc 访问依赖（测试可注入）。 */
export interface ProcFs {
  list: () => string[];
  readEnviron: (pid: string) => string;
  ownerUid: (pid: string) => number;
  currentUid: () => number;
  /** 读取 /proc/<pid>/stat 的状态与启动时刻；读取失败按原错误抛出，无法解析抛普通 Error。 */
  procStat: (pid: string) => ProcStat;
  /** 列出 /proc/<pid>/task 下的线程 id；读取失败按原错误抛出。 */
  listThreads: (pid: string) => string[];
  /** 读取 /proc/<pid>/task/<tid>/stat；读取失败按原错误抛出，无法解析抛普通 Error。 */
  threadStat: (pid: string, tid: string) => ProcStat;
  /** 同步等待（线程组退出确认的复读间隔）。 */
  sleep: (ms: number) => void;
}

export interface ProcStat {
  /** 第 3 字段进程状态（R / S / D / Z / X 等）。 */
  state: string;
  /** 第 9 字段 flags 是否带 PF_EXITING（该 task——线程组 leader——已进入 do_exit）。 */
  exiting: boolean;
  /** 第 20 字段 num_threads：线程组内尚未释放的线程数（leader 退出后其余线程仍可继续运行）。 */
  threads: number;
  /**
   * num_threads 为 0：该 task 已被回收（§2.92.2）。内核只在锁住 sighand 后才填入实际线程数，回收时 sighand 被置空，
   * 读取与回收竞态时得到 0；存活进程与未回收的僵尸至少为 1。
   */
  reaped: boolean;
  /** 第 22 字段启动时刻，换算为系统启动以来的秒。 */
  startSeconds: number;
}

/** Linux 用户态 ABI 固定的时钟滴答频率（/proc/<pid>/stat 第 22 字段的单位）。 */
const USER_HZ = 100;
/** 命令启动时刻的容差（§2.92.2）：覆盖时钟滴答粒度与读取先后。 */
const START_TOLERANCE_SECONDS = 1;

/** 解析 /proc/<pid>/stat：comm 可含空格与括号，从最后一个 ')' 之后计字段（第 3 字段起）。 */
export function parseProcStat(stat: string): ProcStat {
  const close = stat.lastIndexOf(')');
  if (close < 0) throw new Error('stat 格式无法解析');
  const fields = stat.slice(close + 2).trim().split(/\s+/);
  const ticks = Number(fields[22 - 3]);
  const flags = Number(fields[9 - 3]);
  const threads = Number(fields[20 - 3]);
  if (!fields[0] || !Number.isFinite(ticks) || ticks < 0 || !Number.isInteger(flags) || !Number.isInteger(threads) || threads < 0) {
    throw new Error('stat 启动时刻字段无法解析');
  }
  return { state: fields[0], exiting: (flags & PF_EXITING) !== 0, threads, reaped: threads === 0, startSeconds: ticks / USER_HZ };
}

export function parseProcStatStartSeconds(stat: string): number {
  return parseProcStat(stat).startSeconds;
}

/**
 * 整个线程组已退出（§2.92.2 第 4 条）：/proc/<pid>/stat 的状态与 flags 只描述线程组 leader，leader 可
 * pthread_exit 而其余线程继续运行并写文件，故须证明**每个线程**都已实际进入退出——已退出未回收（Z）、正在
 * 销毁（X）或已进入 do_exit（flags 带 PF_EXITING；此时其在途系统调用已返回）。待处理的 SIGKILL 不算：线程
 * 可带着它完成在途的内核写入后才终止。
 * - num_threads 为 1（只剩 leader 自身）且 leader 已退出；或
 * - leader 已退出，逐个读取 /proc/<pid>/task/<tid> 均已退出（读取时已消失的线程忽略），且复读线程清单未出现
 *   首次未见的线程——已退出的线程不能再创建线程，复读覆盖「读取期间被尚未退出的线程新建」的竞态。
 *   整体退出中的多线程进程（如并发测试 / 构建中退出的 node）其余线程会在极短时间内进入退出，故存在未退出线程
 *   时按固定间隔有界复读，直至某一轮全部满足；到期仍有未退出线程则不认定。
 * 线程清单或线程 stat 读取失败（已消失除外）、无法解析，均立即不认定，回到启动时刻判据。
 */
const EXITED_STATES = new Set(['Z', 'X', 'x']);
const PF_EXITING = 0x4;
/** 有界复读（§2.92.2）：最多 EXIT_POLL_ROUNDS 轮，轮间等待 EXIT_POLL_INTERVAL_MS 毫秒（合计约 0.5 秒）。 */
export const EXIT_POLL_ROUNDS = 11;
const EXIT_POLL_INTERVAL_MS = 50;

function taskExited(stat: ProcStat): boolean {
  return stat.reaped || stat.exiting || EXITED_STATES.has(stat.state);
}

type GroupProbe = 'exited' | 'pending' | 'unknown';

function probeThreadGroup(pid: string, fsApi: ProcFs): GroupProbe {
  const gone = (error: unknown) => GONE_CODES.has((error as NodeJS.ErrnoException).code ?? '');
  let first: string[];
  try {
    first = fsApi.listThreads(pid);
  } catch (error) {
    return gone(error) ? 'exited' : 'unknown'; // 线程清单已消失 = 整个进程已消失
  }
  let pending = false;
  for (const tid of first) {
    try {
      if (!taskExited(fsApi.threadStat(pid, tid))) pending = true;
    } catch (error) {
      if (!gone(error)) return 'unknown';
    }
  }
  let again: string[];
  try {
    again = fsApi.listThreads(pid);
  } catch (error) {
    return gone(error) ? 'exited' : 'unknown';
  }
  const seen = new Set(first);
  if (again.some(tid => !seen.has(tid))) pending = true;
  return pending ? 'pending' : 'exited';
}

function threadGroupExited(pid: string, leader: ProcStat, fsApi: ProcFs): boolean {
  if (!taskExited(leader)) return false;
  if (leader.threads <= 1) return true;
  for (let round = 0; round < EXIT_POLL_ROUNDS; round++) {
    if (round > 0) fsApi.sleep(EXIT_POLL_INTERVAL_MS);
    const probe = probeThreadGroup(pid, fsApi);
    if (probe !== 'pending') return probe === 'exited';
  }
  return false;
}

const realProcFs: ProcFs = {
  list: () => readdirSync('/proc'),
  readEnviron: pid => readFileSync(`/proc/${pid}/environ`, 'utf8'),
  ownerUid: pid => lstatSync(`/proc/${pid}`).uid,
  currentUid: () => (typeof process.getuid === 'function' ? process.getuid() : -1),
  procStat: pid => parseProcStat(readFileSync(`/proc/${pid}/stat`, 'utf8')),
  listThreads: pid => readdirSync(`/proc/${pid}/task`),
  threadStat: (pid, tid) => parseProcStat(readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8')),
  sleep: ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
};

/** 测试接缝：注入 /proc 依赖与平台 / uptime（只供测试调用，生产路径不设置）。 */
interface LivenessOverrides { procFs?: ProcFs; platform?: NodeJS.Platform; uptime?: number | null }
let livenessOverrides: LivenessOverrides = {};
export function setLivenessTestOverrides(overrides: LivenessOverrides): void {
  livenessOverrides = { ...overrides };
}

function livenessPlatform(): NodeJS.Platform {
  return livenessOverrides.platform ?? process.platform;
}

/**
 * 命令启动时刻（§2.92.3）：仅 Linux，在启动命令之前读取 /proc/uptime 第一个字段（系统启动以来的秒）；
 * 读取失败或非 Linux 返回 null（无可用的命令启动时刻）。
 */
export function readCommandStartUptime(): number | null {
  if ('uptime' in livenessOverrides) return livenessOverrides.uptime ?? null;
  if (livenessPlatform() !== 'linux') return null;
  try {
    const value = Number(readFileSync('/proc/uptime', 'utf8').trim().split(/\s+/)[0]);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

const GONE_CODES = new Set(['ENOENT', 'ESRCH']);

/**
 * Linux 运行标记扫描。检查范围是**与 CLI 同用户**的进程（只有它们能写入同用户拥有的沙箱世代）：
 * - 读取 environ 时进程已退出（ENOENT / ESRCH）→ 跳过，不构成旧写入者；
 * - 其他用户的进程 → 跳过；
 * - 同用户但 environ 不可读（EACCES / EPERM 等）→ 读取其 stat：报 ENOENT / ESRCH、已被回收（num_threads 为 0），或整个线程组已退出（每个
 *   线程均为 Z / X 或带 PF_EXITING，见 threadGroupExited），视为已退出，跳过；仍存活的（如
 *   Electron 沙箱渲染进程等不可转储进程，或 leader 已退出但仍有其他线程的进程）按 §2.92.2 比较启动时刻：早于「命令启动时刻 − 1 秒」的不可能是本世代命令的后代，跳过；
 *   其余（含无命令启动时刻、stat 读取失败或无法解析）抛出，即「无法完成扫描」，由调用方判 tainted。
 *   不得把无法确认当作不存在而放行复用或 fresh 删除。
 */
export function scanProcEnvironment(tag: string, commandStartedUptime: number | null = null, fsApi: ProcFs = realProcFs): number[] {
  const needle = `${RUN_TAG_ENV}=${tag}`;
  const hits: number[] = [];
  const me = fsApi.currentUid();
  for (const entry of fsApi.list()) {
    if (!/^\d+$/.test(entry)) continue;
    let env: string;
    try {
      env = fsApi.readEnviron(entry);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (GONE_CODES.has(code)) continue;
      let owner: number;
      try {
        owner = fsApi.ownerUid(entry);
      } catch (statError) {
        if (GONE_CODES.has((statError as NodeJS.ErrnoException).code ?? '')) continue;
        throw new Error(`无法确认进程 ${entry} 的属主（${(statError as NodeJS.ErrnoException).code ?? 'unknown'}）`);
      }
      if (owner !== me) continue;
      let stat: ProcStat;
      try {
        stat = fsApi.procStat(entry);
      } catch (startError) {
        const startCode = (startError as NodeJS.ErrnoException).code ?? '';
        if (GONE_CODES.has(startCode)) continue;
        throw new Error(`同用户存活进程 ${entry} 的环境不可读（${code || 'unknown'}），且启动时刻无法确认（${startCode || (startError as Error).message}）`);
      }
      // 读取与回收竞态：stat 可读但已被回收（num_threads 为 0），与 ENOENT / ESRCH 同属已退出
      if (stat.reaped) continue;
      // 早于命令启动：不可能是其后代。先于线程组退出确认判定，免去对早已存在的进程做有界复读
      if (commandStartedUptime !== null && stat.startSeconds < commandStartedUptime - START_TOLERANCE_SECONDS) continue;
      if (threadGroupExited(entry, stat, fsApi)) continue;
      if (commandStartedUptime === null) {
        throw new Error(`同用户存活进程 ${entry} 的环境不可读（${code || 'unknown'}），且无命令启动时刻可供排除`);
      }
      throw new Error(`同用户存活进程 ${entry} 的环境不可读（${code || 'unknown'}），且启动于命令启动之后或容差内`);
    }
    if (env.split('\0').includes(needle)) hits.push(Number(entry));
  }
  return hits;
}

/** 返回初始环境含 `OPENLOGOS_SANDBOX_RUN=<tag>` 的存活进程 pid；扫描无法完成时抛出。 */
export function scanRunTag(tag: string, commandStartedUptime: number | null = null): number[] {
  if (process.env.OPENLOGOS_SANDBOX_TEST_SCAN_ERROR === '1') {
    throw new Error('测试接缝已模拟运行标记扫描无法完成');
  }
  const hits: number[] = [];
  const needle = `${RUN_TAG_ENV}=${tag}`;
  if (livenessPlatform() === 'linux') return scanProcEnvironment(tag, commandStartedUptime, livenessOverrides.procFs ?? realProcFs);
  const out = execFileSync('/bin/ps', ['-E', '-ww', '-A', '-o', 'pid=,command='], {
    encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  for (const line of out.split('\n')) {
    const idx = line.indexOf(needle);
    if (idx < 0) continue;
    const after = line.charAt(idx + needle.length);
    if (after !== '' && after !== ' ') continue; // 只匹配完整片段
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isFinite(pid) && pid !== process.pid) hits.push(pid);
  }
  return hits;
}

/** 某世代的旧写入者存活检查：进程组已空，且扫描不到带该世代运行标记的存活进程。 */
export function checkOldWriters(pgid: number | null, runTag: string, commandStartedUptime: number | null = null): LivenessResult {
  if (pgid !== null && pgid > 0) {
    const group = probeProcessGroup(pgid);
    if (!group.ok) return group;
  }
  let hits: number[];
  try {
    hits = scanRunTag(runTag, commandStartedUptime);
  } catch (error) {
    return { ok: false, reason: `运行标记扫描失败（${(error as Error).message?.slice(0, 200) ?? 'unknown'}）` };
  }
  if (hits.length > 0) return { ok: false, reason: `运行标记扫描命中存活进程：${hits.slice(0, 5).join(', ')}` };
  return { ok: true };
}

// ───────────────────────── 受控目录（no-follow） ─────────────────────────

/**
 * 确保 `path` 是真实目录且不经由 symlink（§2.91.4 第 7 条）：lstat 判定；若是 symlink 或非目录，
 * 只删除该链接 / 文件本身（不跟随、不递归进入其目标），再创建真实目录。调用方须自上而下逐级调用，
 * 保证父路径已是受控真实目录。
 */
export function ensureRealDir(path: string): void {
  let st;
  try { st = lstatSync(path); } catch { st = null; }
  if (st && st.isDirectory()) return;
  if (st) unlinkSync(path);
  mkdirSync(path);
}

// ───────────────────────── 世代锁 ─────────────────────────

interface LockRecord { token: string; pid: number; ws: string }
interface ReleaseRecord {
  token: string; ws: string; pgid: number | null; run_tag: string; reason?: string;
  /** §2.92.4：本世代命令启动时刻（系统启动以来的秒，仅 Linux 写入）。 */
  command_started_uptime?: number;
}

interface LockSnapshot {
  max: number;
  record: LockRecord | null;
  recordRaw: boolean;
  released: ReleaseRecord | null;
  tainted: boolean;
}

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T; } catch { return null; }
}

function readLockSnapshot(lockDir: string): LockSnapshot {
  let max = 0;
  for (const name of readdirSync(lockDir)) {
    const m = GEN_RE.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  if (max === 0) return { max, record: null, recordRaw: false, released: null, tainted: false };
  const base = join(lockDir, genName(max));
  const record = readJson<LockRecord>(base);
  const valid = record && typeof record.ws === 'string' && /^ws-\d{12}$/.test(record.ws) && typeof record.pid === 'number'
    ? record : null;
  return {
    max,
    record: valid,
    recordRaw: existsSync(base),
    released: existsSync(`${base}.released`) ? (readJson<ReleaseRecord>(`${base}.released`) ?? { token: '', ws: valid?.ws ?? '', pgid: null, run_tag: '' }) : null,
    tainted: existsSync(`${base}.tainted`),
  };
}

function pidAlive(pid: number): 'alive' | 'dead' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return 'dead';
    if (code === 'EPERM') return 'alive';
    return 'unknown';
  }
}

const LINK_UNSUPPORTED_CODES = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV', 'EMLINK']);

export type AcquireOutcome =
  | { kind: 'acquired'; lease: SandboxLease }
  | { kind: 'busy'; reason: string }
  | { kind: 'unsupported'; reason: string };

export interface SandboxLease {
  projectDir: string;
  lockDir: string;
  generation: number;
  token: string;
  state: Extract<SandboxReuseState, 'created' | 'reused' | 'recovered' | 'fresh'>;
  wsName: string;
  wsDir: string;
  runTag: string;
  /** 发布成功后须删除的旧世代（仅 fresh 且旧世代 released 并复查通过）。 */
  deleteAfterPublish: string | null;
}

/**
 * 判定分支、先定目标世代、再以 link() 原子发布锁记录（§2.91.6）。
 * 目录操作（新建 / 删除世代）全部在发布成功之后由调用方执行。
 */
export function acquireGeneration(projectDir: string, fresh: boolean): AcquireOutcome {
  const lockDir = join(projectDir, 'lock');
  ensureRealDir(lockDir);
  const snap = readLockSnapshot(lockDir);

  let state: SandboxLease['state'];
  let targetWs: string;
  let deleteAfterPublish: string | null = null;
  const next = snap.max + 1;

  if (snap.max === 0) {
    state = fresh ? 'fresh' : 'created';
    targetWs = wsName(next);
  } else if (!snap.record) {
    return { kind: 'busy', reason: `世代锁记录 ${genName(snap.max)} 不可解析，无法确认持有者` };
  } else if (snap.tainted) {
    state = fresh ? 'fresh' : 'recovered';
    targetWs = wsName(next);
  } else if (snap.released) {
    const oldWs = snap.record.ws;
    const tag = snap.released.run_tag || runTagFor(join(projectDir, oldWs));
    const started = typeof snap.released.command_started_uptime === 'number' ? snap.released.command_started_uptime : null;
    const recheck = checkOldWriters(typeof snap.released.pgid === 'number' ? snap.released.pgid : null, tag, started);
    if (!recheck.ok) {
      state = fresh ? 'fresh' : 'recovered';
      targetWs = wsName(next);
    } else if (fresh) {
      state = 'fresh';
      targetWs = wsName(next);
      deleteAfterPublish = oldWs;
    } else {
      state = 'reused';
      targetWs = oldWs;
    }
  } else {
    const alive = pidAlive(snap.record.pid);
    if (alive !== 'dead') {
      return { kind: 'busy', reason: alive === 'alive'
        ? `持久沙箱正被进程 ${snap.record.pid} 使用`
        : `无法确认持久沙箱持有者 ${snap.record.pid} 是否存活` };
    }
    state = fresh ? 'fresh' : 'recovered';
    targetWs = wsName(next);
  }

  const token = randomBytes(12).toString('hex');
  const record: LockRecord = { token, pid: process.pid, ws: targetWs };
  const tmp = join(lockDir, `.tmp-${token}`);
  writeFileSync(tmp, JSON.stringify(record));
  try {
    testBarrierBeforeLink();
    const injected = testLinkError();
    if (injected) throw injected;
    linkSync(tmp, join(lockDir, genName(next)));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? '';
    if (code === 'EEXIST') return { kind: 'busy', reason: `世代 ${genName(next)} 已被其他进程取得` };
    if (LINK_UNSUPPORTED_CODES.has(code)) {
      return { kind: 'unsupported', reason: `sandbox_root 所在文件系统不支持 link()（${code}），无法复用沙箱` };
    }
    throw error;
  } finally {
    rmSync(tmp, { force: true });
  }
  testExitAfterPublish();

  const wsDir = join(projectDir, targetWs);
  return {
    kind: 'acquired',
    lease: {
      projectDir, lockDir, generation: next, token, state, wsName: targetWs, wsDir,
      runTag: runTagFor(wsDir), deleteAfterPublish,
    },
  };
}

/** 释放：排他创建 `released` 或 `tainted`，二者互斥；从不删除任何锁记录。 */
export function releaseGeneration(
  lease: SandboxLease,
  outcome: { pgid: number | null; liveness: LivenessResult; commandStartedUptime?: number | null },
): void {
  const base = join(lease.lockDir, genName(lease.generation));
  const body: ReleaseRecord = { token: lease.token, ws: lease.wsName, pgid: outcome.pgid, run_tag: lease.runTag };
  if (typeof outcome.commandStartedUptime === 'number') body.command_started_uptime = outcome.commandStartedUptime;
  const target = outcome.liveness.ok ? `${base}.released` : `${base}.tainted`;
  if (!outcome.liveness.ok) body.reason = outcome.liveness.reason ?? 'unknown';
  const fd = openSync(target, 'wx');
  try { writeFileSync(fd, JSON.stringify(body)); } finally { closeSync(fd); }
}

/** 项目目录下除当前世代与即将删除的世代之外的全部工作区世代：均视为被弃用。 */
export function listAbandoned(projectDir: string, current: string, deleting: string | null): string[] {
  let names: string[] = [];
  try { names = readdirSync(projectDir); } catch { return []; }
  return names
    .filter(n => /^ws-\d{12}$/.test(n) && n !== current && n !== deleting)
    .sort()
    .map(n => join(projectDir, n));
}

/** 记录项目目录对应的项目根，供人工排查与测试收尾识别孤儿目录。 */
export function ensureProjectMeta(projectDir: string, projectRoot: string): void {
  const path = join(projectDir, PROJECT_META_NAME);
  if (existsSync(path)) return;
  let real = projectRoot;
  try { real = realpathSync(projectRoot); } catch { /* 保底 */ }
  try {
    // 排他创建：路径已存在（含预置的 symlink）时不跟随、不覆盖
    writeFileSync(path, JSON.stringify({ project_root: real }) + '\n', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
}

// ───────────────────────── 缓存路径 ─────────────────────────

export interface CachePathResolution { valid: string[]; diagnostics: string[] }

function normRel(path: string): string {
  return normalize(path).replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
}

/** §2.91.5：非法项被忽略并给出诊断，按普通镜像路径处理。 */
export function resolveCachePaths(raw: string[], whitelist: string[]): CachePathResolution {
  const valid: string[] = [];
  const diagnostics: string[] = [];
  const allow = whitelist.map(normRel).filter(Boolean);
  for (const item of raw) {
    if (typeof item !== 'string' || item.trim().length === 0) {
      diagnostics.push(`sandbox_cache_paths 含空路径，已忽略：${JSON.stringify(item)}`);
      continue;
    }
    if (isAbsolute(item)) {
      diagnostics.push(`sandbox_cache_paths 不接受绝对路径，已忽略：${item}`);
      continue;
    }
    const rel = normRel(item);
    if (rel.split('/').includes('..')) {
      diagnostics.push(`sandbox_cache_paths 路径含 ..，已忽略：${item}`);
      continue;
    }
    if (rel === '' || rel === '.') {
      diagnostics.push(`sandbox_cache_paths 不得为项目根，已忽略：${item}`);
      continue;
    }
    const clash = allow.find(w => w === rel || w.startsWith(`${rel}/`) || rel.startsWith(`${w}/`));
    if (clash) {
      const relation = clash === rel ? '相同' : clash.startsWith(`${rel}/`) ? '为其祖先' : '为其后代';
      diagnostics.push(`sandbox_cache_paths 与白名单结果路径 ${clash} ${relation}，已忽略：${item}`);
      continue;
    }
    if (!valid.includes(rel)) valid.push(rel);
  }
  return { valid, diagnostics };
}

// ───────────────────────── 镜像同步 ─────────────────────────

type Fingerprint = [string, string, string, string, string, string]; // dev ino size mtimeNs ctimeNs mode
interface ManifestEntry { src: Fingerprint; dst: Fingerprint }
interface SyncManifest { schema: string; written_at_ns: string; files: Record<string, ManifestEntry> }

export interface SyncStats { copied: number; removed: number; content_compared: number; sync_ms: number }

export class SandboxSyncUnsupportedError extends Error {}

function fp(st: BigIntStats): Fingerprint {
  return [String(st.dev), String(st.ino), String(st.size), String(st.mtimeNs), String(st.ctimeNs), String(st.mode)];
}

function fpEqual(a: Fingerprint | undefined, b: Fingerprint): boolean {
  return isFingerprint(a) && a.every((v, i) => v === b[i]);
}

const FP_PART = /^-?\d+$/;

function isFingerprint(value: unknown): value is Fingerprint {
  return Array.isArray(value) && value.length === 6 && value.every(v => typeof v === 'string' && FP_PART.test(v));
}

/**
 * 读取并**完整校验**同步清单（§2.91.4）：schema、写入时刻（纯数字纳秒串）、files 为路径映射、每条两侧指纹均为
 * 六元素数字串数组。任一不合格即整份作废（返回 null），全部文件回到内容判定路径——清单只是增量优化，
 * 其数据形态异常不得升级为沙箱初始化失败，更不得让命令离开沙箱执行。
 */
function loadManifest(wsDir: string): SyncManifest | null {
  const m = readJson<unknown>(join(wsDir, SYNC_MANIFEST_NAME));
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const rec = m as Record<string, unknown>;
  if (rec.schema !== SYNC_MANIFEST_SCHEMA) return null;
  if (typeof rec.written_at_ns !== 'string' || !/^\d+$/.test(rec.written_at_ns)) return null;
  const files = rec.files;
  if (!files || typeof files !== 'object' || Array.isArray(files)) return null;
  for (const [rel, entry] of Object.entries(files as Record<string, unknown>)) {
    if (rel.length === 0 || !entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const e = entry as Record<string, unknown>;
    if (!isFingerprint(e.src) || !isFingerprint(e.dst)) return null;
  }
  return m as SyncManifest;
}

function filesEqual(a: string, b: string): boolean {
  const fa = openSync(a, 'r');
  const fb = openSync(b, 'r');
  try {
    const ba = Buffer.allocUnsafe(COMPARE_CHUNK);
    const bb = Buffer.allocUnsafe(COMPARE_CHUNK);
    for (;;) {
      const ra = readSync(fa, ba, 0, COMPARE_CHUNK, null);
      const rb = readSync(fb, bb, 0, COMPARE_CHUNK, null);
      if (ra !== rb) return false;
      if (ra === 0) return true;
      if (!ba.subarray(0, ra).equals(bb.subarray(0, rb))) return false;
    }
  } finally {
    closeSync(fa);
    closeSync(fb);
  }
}

function lstatBig(path: string): BigIntStats | null {
  try { return lstatSync(path, { bigint: true }); } catch { return null; }
}

function removeEntry(path: string, st: BigIntStats): void {
  if (st.isDirectory()) removeTree(path);
  else unlinkSync(path);
}

function copyAtomically(src: string, dest: string, dir: string): void {
  const tmp = join(dir, `.olsync-${randomBytes(8).toString('hex')}.tmp`);
  try {
    copyFileSync(src, tmp, fsConstants.COPYFILE_EXCL);
    renameWithRetry(tmp, dest);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/**
 * 原位整定 mode / mtime（§2.91.4「元数据整定」）；mtime 按毫秒比较。
 * utimes 经浮点秒转换会损失亚微秒精度（如 .977 写回成 .976999998），按毫秒截断后又判为不一致，
 * 导致每轮重复整定、ctime 不断刷新而永远落在 racy 窗口。故写入「目标毫秒 + 0.5 毫秒」，截断后稳定落在目标毫秒。
 */
function settleMetadata(dest: string, srcSt: BigIntStats): void {
  const dst = lstatSync(dest, { bigint: true });
  if (!dst.isFile()) return;
  const srcMode = Number(srcSt.mode & 0o7777n);
  if (Number(dst.mode & 0o7777n) !== srcMode) chmodSync(dest, srcMode);
  const srcMs = srcSt.mtimeNs / 1_000_000n;
  if (dst.mtimeNs / 1_000_000n !== srcMs) {
    const seconds = (Number(srcMs) + 0.5) / 1000;
    utimesSync(dest, seconds, seconds);
  }
}

interface SyncContext {
  srcRoot: string;
  dstRoot: string;
  cachePaths: string[];
  prev: SyncManifest | null;
  prevAtNs: bigint;
  next: Record<string, ManifestEntry>;
  stats: SyncStats;
}

function isCache(rel: string, cachePaths: string[]): boolean {
  return cachePaths.some(c => rel === c || rel.startsWith(`${c}/`));
}

function isCacheAncestor(rel: string, cachePaths: string[]): boolean {
  return cachePaths.some(c => c.startsWith(`${rel}/`));
}

/** 删除沙箱多余条目；若其为缓存路径的祖先目录，只删除其中非缓存部分（缓存路径不删除）。 */
function removeExtra(ctx: SyncContext, rel: string, path: string, st: BigIntStats): void {
  if (st.isDirectory() && isCacheAncestor(rel, ctx.cachePaths)) {
    for (const name of readdirSync(path)) {
      const childRel = `${rel}/${name}`;
      if (isCache(childRel, ctx.cachePaths)) continue;
      const childPath = join(path, name);
      const childSt = lstatBig(childPath);
      if (childSt) removeExtra(ctx, childRel, childPath, childSt);
    }
    return;
  }
  removeEntry(path, st);
  ctx.stats.removed++;
}

function syncFile(ctx: SyncContext, rel: string, src: string, dest: string, dir: string, srcSt: BigIntStats): void {
  let dstSt = lstatBig(dest);
  if (dstSt && !dstSt.isFile()) {
    removeEntry(dest, dstSt);
    dstSt = null;
  }
  if (!dstSt) {
    copyAtomically(src, dest, dir);
    ctx.stats.copied++;
  } else {
    const entry = ctx.prev?.files[rel];
    const limit = ctx.prevAtNs - RACY_WINDOW_NS;
    const skippable = ctx.prev !== null
      && fpEqual(entry?.src, fp(srcSt))
      && fpEqual(entry?.dst, fp(dstSt))
      && srcSt.ctimeNs < limit
      && dstSt.ctimeNs < limit;
    if (skippable) {
      ctx.next[rel] = entry!;
      return;
    }
    ctx.stats.content_compared++;
    const same = srcSt.size === dstSt.size && filesEqual(src, dest);
    if (!same) {
      copyAtomically(src, dest, dir);
      ctx.stats.copied++;
    }
  }
  settleMetadata(dest, srcSt);
  const finalDst = lstatSync(dest, { bigint: true });
  ctx.next[rel] = { src: fp(srcSt), dst: fp(finalDst) };
}

function syncDir(ctx: SyncContext, rel: string): void {
  const srcDir = rel ? join(ctx.srcRoot, rel) : ctx.srcRoot;
  const dstDir = rel ? join(ctx.dstRoot, rel) : ctx.dstRoot;
  const srcNames = new Set(readdirSync(srcDir));

  for (const name of readdirSync(dstDir)) {
    if (srcNames.has(name)) continue;
    const childRel = rel ? `${rel}/${name}` : name;
    if (isCache(childRel, ctx.cachePaths)) continue;
    const childPath = join(dstDir, name);
    const st = lstatBig(childPath);
    if (st) removeExtra(ctx, childRel, childPath, st);
  }

  for (const name of [...srcNames].sort()) {
    const childRel = rel ? `${rel}/${name}` : name;
    if (isCache(childRel, ctx.cachePaths)) continue;
    const src = join(srcDir, name);
    const dest = join(dstDir, name);
    const srcSt = lstatSync(src, { bigint: true });

    if (srcSt.isSymbolicLink()) {
      const literal = readlinkSync(src);
      const dstSt = lstatBig(dest);
      if (dstSt?.isSymbolicLink() && readlinkSync(dest) === literal) continue;
      if (dstSt) removeEntry(dest, dstSt);
      symlinkSync(literal, dest);
      ctx.stats.copied++;
      continue;
    }

    if (srcSt.isDirectory()) {
      const dstSt = lstatBig(dest);
      if (dstSt && !dstSt.isDirectory()) {
        removeEntry(dest, dstSt);
      }
      if (!dstSt || !dstSt.isDirectory()) mkdirSync(dest);
      // 同步期间保证可写；子项处理完后整定为工作区权限位
      const srcMode = Number(srcSt.mode & 0o7777n);
      chmodSync(dest, srcMode | 0o700);
      syncDir(ctx, childRel);
      if ((srcMode | 0o700) !== srcMode) chmodSync(dest, srcMode);
      continue;
    }

    if (srcSt.isFile()) {
      syncFile(ctx, childRel, src, dest, dstDir, srcSt);
      continue;
    }

    throw new SandboxSyncUnsupportedError(`工作区含特殊文件（socket / FIFO / 设备），无法同步到沙箱：${childRel}`);
  }
}

/**
 * 把工作区镜像同步到 `<wsDir>/workspace/`，完成后原子写入同步清单。
 * 同步中途失败直接抛出；清单只在完成后写入，下次同步对不一致条目自然进入内容判定。
 */
export function syncWorkspace(projectRoot: string, wsDir: string, cachePaths: string[]): SyncStats {
  const start = Date.now();
  const dstRoot = join(wsDir, 'workspace');
  // workspace 根先 no-follow 校验：根若被换成指向沙箱外的链接，readdir / 删除会沿父路径到达外部
  ensureRealDir(wsDir);
  ensureRealDir(dstRoot);
  const prev = loadManifest(wsDir);
  const ctx: SyncContext = {
    srcRoot: projectRoot,
    dstRoot,
    cachePaths,
    prev,
    prevAtNs: prev ? BigInt(prev.written_at_ns) : 0n,
    next: {},
    stats: { copied: 0, removed: 0, content_compared: 0, sync_ms: 0 },
  };
  syncDir(ctx, '');
  const manifest: SyncManifest = {
    schema: SYNC_MANIFEST_SCHEMA,
    written_at_ns: String(BigInt(Date.now()) * 1_000_000n),
    files: ctx.next,
  };
  const tmp = join(wsDir, `.${SYNC_MANIFEST_NAME}.${randomBytes(6).toString('hex')}.tmp`);
  writeFileSync(tmp, JSON.stringify(manifest));
  renameWithRetry(tmp, join(wsDir, SYNC_MANIFEST_NAME));
  ctx.stats.sync_ms = Date.now() - start;
  return ctx.stats;
}

/** 项目目录不得位于项目根内（§2.91.3）：否则镜像会把沙箱复制进自身。 */
export function projectDirInsideRoot(projectDir: string, projectRoot: string): boolean {
  let rootReal = projectRoot;
  let dirReal = projectDir;
  try { rootReal = realpathSync(projectRoot); } catch { /* 保底 */ }
  try { dirReal = realpathSync(projectDir); } catch { /* 保底 */ }
  return isWithin(rootReal, dirReal);
}
