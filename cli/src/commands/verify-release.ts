/**
 * layered-verification：发布级全量验收的前置检查、收尾复核，以及发布级结论的查询
 *（功能规格 §2.109.11、§2.109.12；spec/cli-json-output.md「verify 分层验收与发布级验收」）。
 *
 * 发布级验收的执行本体在 verify.ts（与提案级共用环境预检、沙箱、运行锁、失败复跑与门禁判据）；本文件只放
 * 它独有的部分：git 身份与工作区检查、`--release --check` 的只读查询。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeEnvelope, makeErrorEnvelope, type OutputFormat } from '../lib/json-output.js';
import { classifyInputPath } from '../lib/impact-classify.js';
import { currentPlatform, readAllRuns, type VerificationRun } from '../lib/verification-history.js';

export type ReleaseCheckReason = 'latest_failed' | 'other_platform_only' | 'other_commit_only' | 'no_conclusive_run';

/** verify JSON `data.release`。 */
export interface VerifyReleaseData {
  commit: string;
  platform: string;
  commit_unchanged: boolean;
  worktree_clean: boolean;
  head_at_finish: string | null;
}

function git(root: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? '' };
}

/** 当前 HEAD 的完整提交号；不是 git 仓库或 HEAD 无法解析为提交时为 null。 */
export function readHeadCommit(root: string): string | null {
  const inRepo = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (inRepo.status !== 0 || inRepo.stdout.trim() !== 'true') return null;
  const head = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  const sha = head.stdout.trim();
  return head.status === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

/**
 * 工作区中不属于 lifecycle 路径的改动（已跟踪的改动与未跟踪且未忽略的文件），字典序；git 不可用时为 null。
 * lifecycle 路径（提案目录、验收产物、guard）由 verify 自身读写，不算不干净。
 */
export function readDirtyPaths(root: string): string[] | null {
  // 以 `git status --porcelain` 的条目为准（§2.109.11）：暂存区、工作区、未跟踪与重命名都算。
  // 只比较 HEAD 与工作区的净差异会漏掉「暂存了改动、工作区又改回原样」的状态（code-r1 F4）。
  const status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (status.status !== 0) return null;
  // porcelain 输出的是 Git 仓库根相对路径；项目可以位于仓库子目录（spec/change-impact.md §3）——按项目前缀剥离后再分类，
  // 项目前缀之外的路径一律按 external 计入（code-r2 F4）。执行前与收尾复核共用本函数。
  const prefix = git(root, ['rev-parse', '--show-prefix']);
  if (prefix.status !== 0) return null;
  const projectPrefix = prefix.stdout.replace(/\r?\n$/, '');
  return parsePorcelainZ(status.stdout).filter(file => classifyInputPath(file, projectPrefix) !== 'lifecycle').sort();
}

/** `git status --porcelain=v1 -z` 的路径集合：每条 `XY <path>`，重命名 / 复制另跟一条原路径。 */
export function parsePorcelainZ(stdout: string): string[] {
  const parts = stdout.split('\0');
  const files = new Set<string>();
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    files.add(entry.slice(3));
    if (code.includes('R') || code.includes('C')) {
      const original = parts[i + 1];
      if (original) files.add(original);
      i += 1;
    }
  }
  return Array.from(files);
}


export type ReleasePrecondition =
  | { ok: true; commit: string }
  | { ok: false; code: 'RELEASE_VERIFY_NOT_GIT' | 'RELEASE_VERIFY_DIRTY' | 'RELEASE_VERIFY_NO_COMMAND'; message: string; details?: Record<string, unknown> };

/** 发布级验收的前置条件，按序检查；通过时返回执行前固定的完整提交号 R。 */
export function checkReleasePreconditions(root: string, hasCommand: boolean): ReleasePrecondition {
  const commit = readHeadCommit(root);
  if (!commit) {
    return { ok: false, code: 'RELEASE_VERIFY_NOT_GIT', message: 'Release verification requires a git repository whose HEAD resolves to a commit.' };
  }
  const dirty = readDirtyPaths(root);
  if (dirty === null) {
    return { ok: false, code: 'RELEASE_VERIFY_NOT_GIT', message: 'Release verification could not read the git working tree state.' };
  }
  if (dirty.length > 0) {
    return {
      ok: false, code: 'RELEASE_VERIFY_DIRTY',
      message: `Release verification requires a clean working tree (${dirty.length} path(s) changed or untracked).`,
      details: { paths: dirty.slice(0, 20), total: dirty.length },
    };
  }
  // hasCommand 由调用方按「本次发布级实际会执行的命令组」给出——前置检查、环境预检与执行共用同一选择（code-r1 F1）
  if (!hasCommand) {
    return {
      ok: false, code: 'RELEASE_VERIFY_NO_COMMAND',
      message: 'Release verification requires a configured test command; existing result files are not accepted as evidence.',
    };
  }
  return { ok: true, commit };
}

/** 收尾复核：HEAD 是否仍是 R、工作区是否仍然干净。 */
export function recheckRelease(root: string, commit: string): VerifyReleaseData {
  const head = readHeadCommit(root);
  const dirty = readDirtyPaths(root);
  return {
    commit,
    platform: currentPlatform(),
    commit_unchanged: head === commit,
    worktree_clean: dirty !== null && dirty.length === 0,
    head_at_finish: head,
  };
}

/** 有结论的发布级运行：completed 且实际执行过命令。 */
function isConclusiveRelease(run: VerificationRun): boolean {
  return run.kind === 'verify' && run.level === 'release' && run.outcome === 'completed' && run.result_source === 'executed';
}

export interface ReleaseCheckData {
  level: 'release';
  commit: string;
  platform: string;
  valid: boolean;
  reason: ReleaseCheckReason | null;
  latest: VerificationRun | null;
}

/** 判定目标提交在给定平台上是否有有效的发布级结论（runs 按 started_at 倒序、同刻按 run_id 倒序）。 */
export function evaluateReleaseCheck(runs: VerificationRun[], commit: string, platform: string): ReleaseCheckData {
  const conclusive = runs.filter(isConclusiveRelease);
  const sameCommit = conclusive.filter(run => run.commit.head === commit);
  const latest = sameCommit.find(run => run.platform === platform) ?? null;
  const base = { level: 'release' as const, commit, platform };
  if (latest) {
    return latest.gate.result === 'PASS'
      ? { ...base, valid: true, reason: null, latest }
      : { ...base, valid: false, reason: 'latest_failed', latest };
  }
  if (sameCommit.length > 0) return { ...base, valid: false, reason: 'other_platform_only', latest: null };
  if (conclusive.length > 0) return { ...base, valid: false, reason: 'other_commit_only', latest: null };
  return { ...base, valid: false, reason: 'no_conclusive_run', latest: null };
}

/** `openlogos verify --release --check [--commit <sha>]`：只读，不执行命令、不获取运行锁、不写任何文件。 */
export function verifyReleaseCheck(format: OutputFormat, commitArg: string | undefined): void {
  const root = process.cwd();
  const json = format === 'json';
  const reject = (code: string, message: string): never => {
    if (json) console.error(JSON.stringify(makeErrorEnvelope('verify', code, message)));
    else console.error(`Error: ${message}`);
    process.exit(code === 'PROJECT_NOT_INITIALIZED' ? 1 : 2);
  };
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) reject('PROJECT_NOT_INITIALIZED', 'logos/logos.config.json not found.');
  const head = readHeadCommit(root);
  let commit: string;
  if (commitArg !== undefined) {
    // 词法校验：空值或以 `-` 开头的值不传给 git
    const lexical = commitArg.length > 0 && !commitArg.startsWith('-');
    const inRepo = git(root, ['rev-parse', '--is-inside-work-tree']);
    if (inRepo.status !== 0 || inRepo.stdout.trim() !== 'true') reject('RELEASE_VERIFY_NOT_GIT', 'Release check requires a git repository.');
    const resolved = lexical ? git(root, ['rev-parse', '--verify', '--quiet', `${commitArg}^{commit}`]) : { status: 1, stdout: '' };
    const sha = resolved.stdout.trim();
    if (resolved.status !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) reject('RELEASE_CHECK_COMMIT_INVALID', `Cannot resolve commit: ${commitArg}`);
    commit = sha;
  } else {
    if (!head) reject('RELEASE_VERIFY_NOT_GIT', 'Release check requires a git repository whose HEAD resolves to a commit.');
    commit = head!;
  }
  const data = evaluateReleaseCheck(readAllRuns(root).runs, commit, currentPlatform());
  if (json) {
    console.log(JSON.stringify(makeEnvelope('verify', data)));
  } else {
    console.log(`Level: release`);
    console.log(`Commit: ${data.commit}`);
    console.log(`Platform: ${data.platform}`);
    console.log(data.valid ? '✅ valid release-level conclusion' : `❌ no valid release-level conclusion (${data.reason})`);
    if (data.latest) console.log(`Latest run: ${data.latest.run_id}  ${data.latest.gate.result}${data.latest.gate.reason ? ` (${data.latest.gate.reason})` : ''}`);
  }
  if (!data.valid) process.exitCode = 1;
}
