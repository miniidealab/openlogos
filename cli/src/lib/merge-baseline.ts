/**
 * 合并基线与 delta 摘要（功能规格 §2.69.2、§2.69.4.1，merge-amend-merged-change）。
 *
 * 增量修正的**唯一可信 before 来源**：首次合并时逐目标记录合并前实际字节的证据，
 * 修正时按证据读回并以 sha256 复核。本模块是叶子事实模块——只依赖 node 内置、
 * `proposal-markers` 与 `canonical-target`，merge-direct / merge-amend / change-lint 三方共用，
 * 不制造循环依赖。
 *
 * 不从 git 历史推断任何东西：父提交既可能已含合并结果，也可能早于脏工作区的真实 before
 * （proposal r1 F1）。git 只作内容寻址对象库使用（`hash-object -w` 写、`cat-file blob` 读）。
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { hasSpecCompleteMarker, SPEC_MERGED_MARKER, VERIFY_PASS_MARKER } from './proposal-markers.js';
import { classifyProposalDeltas, DeltaScanUnreadableError } from './delta-classify.js';

export const MERGE_BASELINE_SCHEMA = 'openlogos/merge-baseline@1';

/**
 * 增量修正时失效的验收 / 交付标记（§2.69.4.5）：复用 verify 失败时的既有清除集合
 * （`commands/verify.ts` 的 VERIFY_PASS / DEPLOY_DONE / SMOKE_PASS / SMOKE_FAIL），另加 VERIFY_FAIL。
 * 升序排列，JSON 输出 `invalidated_markers` 直接取该序。
 */
export const AMEND_INVALIDATED_MARKERS = ['DEPLOY_DONE', 'SMOKE_FAIL', 'SMOKE_PASS', 'VERIFY_FAIL', VERIFY_PASS_MARKER] as const;

export interface MergeBaselineBefore {
  sha256: string;
  git_blob: string | null;
}

export interface MergeBaselineTarget {
  path: string;
  /** 该目标被本提案**首次**触及时的模式，此后修正不改写。 */
  mode: 'CREATE' | 'MODIFY';
  /** CREATE 为 null（合并前不存在）。 */
  before: MergeBaselineBefore | null;
  after_sha256: string;
}

/** 原型资产 delta 的身份（逻辑路径 + 内容 sha256，按路径升序）。 */
export interface PrototypeIdentity {
  path: string;
  sha256: string;
}

export interface MergeBaseline {
  schema: typeof MERGE_BASELINE_SCHEMA;
  delta_digest: string;
  targets: MergeBaselineTarget[];
  /**
   * 最后一次成功合并 / 修正时的原型资产 delta 身份集合（code-r1 F2）：拒绝边界 ⑤ 以「前后集合与字节
   * 身份」比较，删除、新增、修改都算变化。随既有合并记录保存，不另设标记。缺失（本字段之前写入的
   * 基线）按空集合处理——任何当前原型都视为变化，fail-closed。
   */
  prototypes?: PrototypeIdentity[];
}

const PROTOTYPE_DELTA_PREFIX = 'deltas/prd/2-product-design/2-page-design/';

/**
 * 当前原型资产 delta 的身份集合：枚举取共享分类器（与摘要同源，含合法 symlink），只取
 * `2-page-design/*.html`；不可安全读取的条目以 `unresolved:` 身份计入。
 */
export function collectPrototypeIdentities(proposalDir: string): PrototypeIdentity[] {
  const entries = classifyProposalDeltas(proposalDir);
  const broken = entries.find(e => e.ioError);
  if (broken) throw new DeltaScanUnreadableError(broken);
  const out: PrototypeIdentity[] = [];
  for (const entry of entries) {
    if (!entry.relativePath.startsWith(PROTOTYPE_DELTA_PREFIX) || !entry.relativePath.endsWith('.html')) continue;
    const abs = join(proposalDir, ...entry.relativePath.split('/'));
    out.push({
      path: entry.relativePath,
      sha256: entry.contentProbeEligible ? sha256Hex(readFileSync(abs)) : 'unresolved',
    });
  }
  return out.sort((a, b) => byCodeUnit(a.path, b.path));
}

/** 原型资产相对基线记录的变化（新增 / 删除 / 修改），返回涉及的 delta 路径（升序）。 */
export function changedPrototypeIdentities(recorded: PrototypeIdentity[] | undefined, current: PrototypeIdentity[]): string[] {
  const before = new Map((recorded ?? []).map(p => [p.path, p.sha256]));
  const after = new Map(current.map(p => [p.path, p.sha256]));
  const changed = new Set<string>();
  for (const [path, digest] of before) if (after.get(path) !== digest) changed.add(path);
  for (const [path, digest] of after) if (before.get(path) !== digest) changed.add(path);
  return [...changed].sort(byCodeUnit);
}

export interface MergeAmendmentRecord {
  amended_at: string;
  previous_delta_digest: string;
  delta_digest: string;
  targets_recomposed: string[];
  targets_added: string[];
  targets_restored: string[];
  invalidated_markers: string[];
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * delta 摘要（§2.69.4.1，OpenLogos 唯一定义）：`deltas/` 下全部条目（递归，排除 `.gitkeep`），取相对
 * `deltas/` 的**逻辑** POSIX 路径按 UTF-16 码元升序；逐个拼接 `<路径>\0<内容 sha256>\n` 后求 sha256。
 * 目录缺失或为空即空字节串的摘要。
 *
 * **枚举取共享分类器 `classifyProposalDeltas`**（code-r1 F1）：merge 实际消费的合法文件 symlink、
 * 落在提案目录内的目录 symlink 与普通文件一视同仁，内容取**实际消费字节**（分类器已校验 containment
 * 才标 `contentProbeEligible`，此处不另行跟随 symlink）。此前自写的 lstat 遍历只认普通文件，合法
 * symlink delta 被排除在摘要之外——其内容变化后摘要不变，merge 误判 `already-merged`。
 *
 * 不可安全读取的条目（逃逸 / 断链 symlink、非常规文件）以 `<路径>\0unresolved:<链接目标>\n` 计入：
 * 其变化同样使摘要改变，merge 进入修正路径后由准入（L6 `delta_path_invalid`）拒绝，绝不被误报为已应用。
 * 分类器报 IO 错误时抛 `DeltaScanUnreadableError`，不把「不可读」降级为空集。
 */
export function computeDeltaDigest(proposalDir: string): string {
  const entries = classifyProposalDeltas(proposalDir);
  const broken = entries.find(e => e.ioError);
  if (broken) throw new DeltaScanUnreadableError(broken);
  const lines: Array<[string, string]> = [];
  for (const entry of entries) {
    const rel = entry.relativePath.replace(/^deltas\//, '');
    if (rel.split('/').pop() === '.gitkeep') continue;
    const abs = join(proposalDir, ...entry.relativePath.split('/'));
    if (entry.contentProbeEligible) {
      lines.push([rel, sha256Hex(readFileSync(abs))]);
      continue;
    }
    let link = '';
    try { link = lstatSync(abs).isSymbolicLink() ? readlinkSync(abs) : ''; } catch { link = ''; }
    lines.push([rel, `unresolved:${link}`]);
  }
  lines.sort((x, y) => byCodeUnit(x[0], y[0]));
  const hash = createHash('sha256');
  for (const [rel, identity] of lines) hash.update(`${rel}\0${identity}\n`);
  return `sha256:${hash.digest('hex')}`;
}

function isHex(value: unknown, lengths: number[]): value is string {
  return typeof value === 'string' && lengths.includes(value.length) && /^[0-9a-f]+$/.test(value);
}

function parseBaseline(raw: unknown): MergeBaseline | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (b.schema !== MERGE_BASELINE_SCHEMA || typeof b.delta_digest !== 'string' || !Array.isArray(b.targets)) return null;
  const targets: MergeBaselineTarget[] = [];
  for (const item of b.targets) {
    if (!item || typeof item !== 'object') return null;
    const t = item as Record<string, unknown>;
    if (typeof t.path !== 'string' || (t.mode !== 'CREATE' && t.mode !== 'MODIFY') || !isHex(t.after_sha256, [64])) return null;
    let before: MergeBaselineBefore | null = null;
    if (t.mode === 'MODIFY') {
      const raw = t.before as Record<string, unknown> | null;
      if (!raw || typeof raw !== 'object' || !isHex(raw.sha256, [64])) return null;
      const blob = raw.git_blob;
      if (blob !== null && !isHex(blob, [40, 64])) return null;
      before = { sha256: raw.sha256 as string, git_blob: blob as string | null };
    } else if (t.before !== null) {
      return null;
    }
    targets.push({ path: t.path, mode: t.mode, before, after_sha256: t.after_sha256 as string });
  }
  let prototypes: PrototypeIdentity[] | undefined;
  if (b.prototypes !== undefined) {
    if (!Array.isArray(b.prototypes)) return null;
    prototypes = [];
    for (const item of b.prototypes) {
      const p = item as Record<string, unknown> | null;
      if (!p || typeof p.path !== 'string' || typeof p.sha256 !== 'string') return null;
      prototypes.push({ path: p.path, sha256: p.sha256 });
    }
  }
  return { schema: MERGE_BASELINE_SCHEMA, delta_digest: b.delta_digest, targets, ...(prototypes ? { prototypes } : {}) };
}

export interface SpecMergedRecord {
  /** 解析成功的 marker 对象；缺失、legacy `MERGED` 或非法 JSON 为 null。 */
  record: Record<string, unknown> | null;
  /** 合法的合并基线；旧标记（无字段）或结构非法为 null。 */
  baseline: MergeBaseline | null;
  amendments: MergeAmendmentRecord[];
}

export function readSpecMergedRecord(proposalDir: string): SpecMergedRecord {
  const path = join(proposalDir, SPEC_MERGED_MARKER);
  if (!existsSync(path)) return { record: null, baseline: null, amendments: [] };
  let record: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed as Record<string, unknown>;
  } catch { record = null; }
  if (!record) return { record: null, baseline: null, amendments: [] };
  const amendments = Array.isArray(record.amendments) ? record.amendments as MergeAmendmentRecord[] : [];
  return { record, baseline: parseBaseline(record.merge_baseline), amendments };
}

/**
 * 把合并前实际字节写入 git 对象库（内容寻址，不改工作区、索引与引用）。
 * 非 git 仓库或写入失败返回 null——首次合并照常成功，只是日后无法增量修正（EX-9.46）。
 */
export function gitWriteBlob(root: string, bytes: Buffer): string | null {
  try {
    const r = spawnSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: bytes, encoding: 'buffer' });
    if (r.status !== 0 || !r.stdout) return null;
    const id = r.stdout.toString('utf8').trim();
    return isHex(id, [40, 64]) ? id : null;
  } catch {
    return null;
  }
}

/** 按 blob id 读回字节；不可读返回 null。 */
export function gitReadBlob(root: string, id: string): Buffer | null {
  if (!isHex(id, [40, 64])) return null;
  try {
    const r = spawnSync('git', ['cat-file', 'blob', id], { cwd: root, encoding: 'buffer', maxBuffer: 1024 * 1024 * 512 });
    if (r.status !== 0 || !r.stdout) return null;
    return r.stdout;
  } catch {
    return null;
  }
}

/**
 * 只读探测 blob 是否存在（`git cat-file -e`，不读内容、不写对象）——供 `status` 的 `spec_amend`
 * 投影使用（S11 EX-11.19）；sha256 复核留给 merge 执行时完成。非 git 仓库视为不可读。
 */
export function gitBlobExists(root: string, id: string): boolean {
  if (!isHex(id, [40, 64])) return false;
  try {
    return spawnSync('git', ['cat-file', '-e', id], { cwd: root, encoding: 'buffer' }).status === 0;
  } catch {
    return false;
  }
}

/** 读回并以 sha256 复核基线 before；读不到或不匹配返回 null。 */
export function readBaselineBefore(root: string, before: MergeBaselineBefore): Buffer | null {
  if (before.git_blob === null) return null;
  const bytes = gitReadBlob(root, before.git_blob);
  if (!bytes || sha256Hex(bytes) !== before.sha256) return null;
  return bytes;
}

/** 为一个目标采集基线条目：MODIFY 写 blob，CREATE 记 null。 */
export function captureBaselineTarget(
  root: string, path: string, mode: 'CREATE' | 'MODIFY', beforeBytes: Buffer | null, afterBytes: Buffer,
): MergeBaselineTarget {
  return {
    path,
    mode,
    before: mode === 'MODIFY' && beforeBytes
      ? { sha256: sha256Hex(beforeBytes), git_blob: gitWriteBlob(root, beforeBytes) }
      : null,
    after_sha256: sha256Hex(afterBytes),
  };
}

/**
 * change-lint 的「待应用修正」上下文（§2.69.4.4）。
 *
 * 判定条件：已完成规格阶段、`SPEC_MERGED` 含合法 `merge_baseline`、当前 delta 摘要 ≠ 已合并摘要。
 * 不满足时返回 null——调用方保持既有「合并完成后不重放」语义逐字不变。
 *
 * `beforeOf(targetPath)` 返回该目标的可信 before（即增量修正的合成起点）：
 * - 已应用目标：首次 CREATE → `{ mode:'CREATE', content:null }`；首次 MODIFY → 读回并复核的基线字节；
 * - 新增目标：按磁盘事实（存在即 MODIFY + 当前字节，缺失即 CREATE）；
 * - 基线不可读：`'unknown'`——依赖前态的检查对该目标跳过（merge 会以 `MERGE_AMEND_BASELINE_UNREADABLE` 拒绝）。
 */
export interface AmendBeforeState {
  mode: 'CREATE' | 'MODIFY';
  content: string | null;
}

export interface PendingAmendContext {
  baseline: MergeBaseline;
  currentDigest: string;
  beforeOf(targetPath: string): AmendBeforeState | 'unknown';
}

export function resolvePendingAmendContext(root: string, proposalDir: string): PendingAmendContext | null {
  if (!hasSpecCompleteMarker(proposalDir)) return null;
  const { baseline } = readSpecMergedRecord(proposalDir);
  if (!baseline) return null;
  let currentDigest: string;
  try { currentDigest = computeDeltaDigest(proposalDir); } catch { return null; }
  if (currentDigest === baseline.delta_digest) return null;
  const byPath = new Map(baseline.targets.map(t => [t.path, t]));
  const cache = new Map<string, AmendBeforeState | 'unknown'>();
  return {
    baseline,
    currentDigest,
    beforeOf(targetPath: string) {
      const hit = cache.get(targetPath);
      if (hit) return hit;
      let state: AmendBeforeState | 'unknown';
      const recorded = byPath.get(targetPath);
      if (recorded) {
        if (recorded.mode === 'CREATE') state = { mode: 'CREATE', content: null };
        else {
          const bytes = recorded.before ? readBaselineBefore(root, recorded.before) : null;
          state = bytes ? { mode: 'MODIFY', content: bytes.toString('utf8') } : 'unknown';
        }
      } else {
        const abs = join(root, ...targetPath.split('/'));
        try {
          state = existsSync(abs) ? { mode: 'MODIFY', content: readFileSync(abs, 'utf8') } : { mode: 'CREATE', content: null };
        } catch { state = 'unknown'; }
      }
      cache.set(targetPath, state);
      return state;
    },
  };
}
