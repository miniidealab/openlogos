/**
 * 已合并提案的增量修正（功能规格 §2.69.4，merge-amend-merged-change）。
 *
 * 同一条 `openlogos merge <slug>` 在 `SPEC_MERGED` 已在场时：delta 摘要未变 → 幂等 `already-merged`；
 * 有变化 → 从合并基线重新合成全部目标、整体重算 `test_change_set`、一次原子落盘、改写 `SPEC_MERGED`，
 * 并使依赖旧规格的验收 / 交付事实失效。
 *
 * 复用而不另写：目标集派生（`planDirectTargets`）、单目标合成（`composeTargetBytes`）、落盘阶段
 * （`applyPreparedInputs` → `applyBaselineClosureBatch`，原语零改动）、`buildTestChangeSet`。
 * 不调用 `resetCodeSection`，不触碰 `[code]`、`SLICES_APPROVED` 与切片清单。
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { BaselineClosureApplyInput } from './baseline-apply.js';
import {
  applyPreparedInputs, composeTargetBytes, isTestTarget, markAmendContext, MergeDirectError, metadataBytes, moduleFromGuard,
  planDirectTargets, readMergeFailureStage, stampMergeFailureStage,
  type ApplyBatchFn, type PlannedTarget,
} from './merge-direct.js';
import {
  AMEND_INVALIDATED_MARKERS, captureBaselineTarget, changedPrototypeIdentities, collectPrototypeIdentities,
  computeDeltaDigest, gitBlobExists, MERGE_BASELINE_SCHEMA,
  readBaselineBefore, readSpecMergedRecord, sha256Hex,
  type MergeAmendmentRecord, type MergeBaseline, type MergeBaselineTarget,
} from './merge-baseline.js';
import { hasSpecCompleteMarker, SPEC_MERGED_MARKER } from './proposal-markers.js';
import { buildTestChangeSet, forwardMergeTestChangeSets, type TestChangeSetV1 } from './test-change-set.js';


/** `status` 投影与 merge 错误码一一对应的受阻原因（§2.69.4.6）。 */
export type AmendBlockedReason = 'baseline-missing' | 'baseline-unreadable' | 'drift' | 'create-withdraw' | 'prototype-changed';

export interface AmendPlan {
  record: Record<string, unknown>;
  baseline: MergeBaseline;
  amendments: MergeAmendmentRecord[];
  currentDigest: string;
  /** 重修 `P ∩ C`：合成起点为基线 before（首次 CREATE 为 null）。 */
  recomposed: Array<{ target: PlannedTarget; recorded: MergeBaselineTarget; beforeBytes: Buffer | null }>;
  /** 新增 `C − P`：合成起点为当前主文档（缺失即 CREATE）。 */
  added: Array<{ target: PlannedTarget; beforeBytes: Buffer | null }>;
  /** 撤回 `P − C`（仅首次 MODIFY）：写回基线 before。 */
  restored: Array<{ recorded: MergeBaselineTarget; beforeBytes: Buffer }>;
}

export type MergedProposalCheck =
  | { kind: 'already-merged'; digest: string; record: Record<string, unknown> }
  | { kind: 'amend'; plan: AmendPlan };

function sortPaths(paths: string[]): string[] {
  return [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * 原型资产的变化判据（code-r1 F2）：当前原型 delta 身份集合与基线记录比较——删除、新增、修改都算变化。
 * 此前只枚举当前仍在的文件、再与已落盘同名资产比较，删除一份或整个原型目录都会漏过拒绝边界 ⑤。
 */
function changedPrototypes(proposalDir: string, baseline: MergeBaseline): string[] {
  return changedPrototypeIdentities(baseline.prototypes, collectPrototypeIdentities(proposalDir));
}

function amendError(code: ConstructorParameters<typeof MergeDirectError>[0], message: string, guidance: string): MergeDirectError {
  return new MergeDirectError(code, `${message}。${guidance}`);
}

/**
 * 已合并提案的只读判定（§2.69.4.3 第 1～4 步）：幂等 / 拒绝边界 / 增量修正计划。
 *
 * **零写入**：拒绝边界按 ① → ④ → ⑤ → ③ → ② 检查，命中即抛 `MERGE_AMEND_*`（准备阶段、档 A）。
 * 不读 git 历史，只按基线证据读回 blob。
 */
export function checkMergedProposal(root: string, proposalDir: string): MergedProposalCheck {
  // 修正路径的一切逃出者都带「本次是增量修正」事实（§2.84.3 增量修正路径的状态声明）。
  try { return checkMergedProposalInner(root, proposalDir); } catch (error) { throw markAmendContext(error); }
}

function checkMergedProposalInner(root: string, proposalDir: string): MergedProposalCheck {
  const { record, baseline, amendments } = readSpecMergedRecord(proposalDir);
  // ① 旧标记（含 legacy MERGED、非法 JSON）：无基线即无从判定，一律拒绝，不从 git 历史回推。
  if (!record || !baseline) {
    throw amendError('MERGE_AMEND_BASELINE_MISSING',
      '提案已完成规格阶段，但 SPEC_MERGED 没有合并基线记录（本版之前合并的旧标记或 legacy MERGED），无法判定 delta 是否已应用，也不从 git 历史回推合并前字节',
      '若 delta 未修改，无需重跑 merge；如需修正规格，请保持本提案现状并另立新提案承载修正');
  }
  const currentDigest = computeDeltaDigest(proposalDir);
  if (currentDigest === baseline.delta_digest) return { kind: 'already-merged', digest: currentDigest, record };

  const current = planDirectTargets(root, proposalDir);
  const currentByPath = new Map(current.map(t => [t.targetPath, t]));
  const recordedByPath = new Map(baseline.targets.map(t => [t.path, t]));

  // ④ 撤回首次 CREATE 的目标：恢复需删除文件与 resource_index 条目，超出落盘原语能力。
  const withdrawnCreate = baseline.targets.filter(t => !currentByPath.has(t.path) && t.mode === 'CREATE').map(t => t.path);
  if (withdrawnCreate.length > 0) {
    throw amendError('MERGE_AMEND_CREATE_WITHDRAW',
      `当前 delta 不再涉及首次以 CREATE 新建的目标：${withdrawnCreate.join('、')}——恢复需删除文件与其 resource_index 条目，超出落盘原语能力`,
      '恢复本提案对应 delta 以通过修正，或另立新提案删除该文件及其 resource_index 条目');
  }
  // ⑤ 原型资产变化：原型落盘走 commitVerifiedPrototypes 与 provenance 校验，不在增量修正能力内。
  const prototypes = changedPrototypes(proposalDir, baseline);
  if (prototypes.length > 0) {
    throw amendError('MERGE_AMEND_PROTOTYPE_UNSUPPORTED',
      `原型资产相对上次合并有变化：${prototypes.join('、')}`,
      '原型落盘走 commitVerifiedPrototypes 与 provenance 校验，请另立新提案');
  }
  // ③ 主文档漂移：上次已应用目标的当前字节必须等于记录的合并后 sha256。
  const drifted = baseline.targets.filter((t) => {
    const abs = join(root, ...t.path.split('/'));
    return !existsSync(abs) || sha256Hex(readFileSync(abs)) !== t.after_sha256;
  }).map(t => t.path);
  if (drifted.length > 0) {
    throw amendError('MERGE_AMEND_DRIFT',
      `上次合并后主文档已被修改（与记录的合并后 sha256 不符）：${drifted.join('、')}`,
      '不做三方合并；请人工核对漂移文件后另立新提案');
  }
  // ② 基线读回：首次 MODIFY 目标按 blob id 读回并以 sha256 复核。
  const beforeOf = new Map<string, Buffer>();
  const unreadable: string[] = [];
  for (const t of baseline.targets) {
    if (t.mode !== 'MODIFY' || !t.before) continue;
    const bytes = readBaselineBefore(root, t.before);
    if (bytes) beforeOf.set(t.path, bytes);
    else unreadable.push(`${t.path}（${t.before.git_blob === null ? 'git_blob 为 null' : `blob ${t.before.git_blob} 不可读或 sha256 不匹配`}）`);
  }
  if (unreadable.length > 0) {
    throw amendError('MERGE_AMEND_BASELINE_UNREADABLE',
      `合并基线不可读或不匹配：${unreadable.join('、')}`,
      '请另立新提案承载修正');
  }

  const plan: AmendPlan = { record, baseline, amendments, currentDigest, recomposed: [], added: [], restored: [] };
  for (const target of current) {
    const recorded = recordedByPath.get(target.targetPath);
    if (recorded) {
      plan.recomposed.push({ target, recorded, beforeBytes: recorded.mode === 'MODIFY' ? beforeOf.get(recorded.path)! : null });
    } else {
      const abs = join(root, ...target.targetPath.split('/'));
      plan.added.push({ target, beforeBytes: target.mode === 'MODIFY' ? readFileSync(abs) : null });
    }
  }
  for (const recorded of baseline.targets) {
    if (!currentByPath.has(recorded.path)) plan.restored.push({ recorded, beforeBytes: beforeOf.get(recorded.path)! });
  }
  return { kind: 'amend', plan };
}

export interface AmendResult {
  slug: string;
  result: 'amended';
  delta_digest: string;
  target_count: number;
  targets: string[];
  spec_merged_path: string;
  test_change_set: TestChangeSetV1;
  invalidated_markers: string[];
  amend: { targets_recomposed: string[]; targets_added: string[]; targets_restored: string[] };
}

/** 仅测试注入：落盘原语、标记删除与恢复写入的故障点。生产恒为真实实现。 */
export interface AmendDeps {
  apply?: ApplyBatchFn;
  removeMarker?: (abs: string) => void;
  restoreMarker?: (abs: string, bytes: Buffer) => void;
}

/**
 * 执行增量修正（§2.69.4.3 第 5～9 步）。调用前须已通过 `checkMergedProposal` 与准入。
 *
 * 顺序「先清后写」：全部合成与测试变更集成功之后才清除验收标记，然后原子落盘。
 * **恢复的唯一条件是「已确认旧规格」**：标记清除阶段自身失败（尚未写规格），或落盘原语返回
 * `rolled_back === true`（阶段戳 `apply-rolled-back`）。其余失败（档 C）保持标记缺失——
 * 原语 `ok:false` 不等于已回滚（delta r1 F1）。
 */
export function executeAmend(root: string, proposalDir: string, slug: string, plan: AmendPlan, deps: AmendDeps = {}): AmendResult {
  try { return executeAmendInner(root, proposalDir, slug, plan, deps); } catch (error) { throw markAmendContext(error); }
}

function executeAmendInner(root: string, proposalDir: string, slug: string, plan: AmendPlan, deps: AmendDeps): AmendResult {
  const inputs: BaselineClosureApplyInput[] = [];
  const tests: Array<{ targetPath: string; beforeBytes: Buffer | null; afterBytes: Buffer }> = [];
  const nextTargets: MergeBaselineTarget[] = [];
  let testChangeSet: TestChangeSetV1;
  let markerBytes: Buffer;
  const markerPath = relative(root, join(proposalDir, SPEC_MERGED_MARKER)).replace(/\\/g, '/');
  const presentMarkers = AMEND_INVALIDATED_MARKERS.filter(name => existsSync(join(proposalDir, name)));

  // —— 准备（零写入，除对象库的内容寻址 blob 外）：任何逃出者带 `prepare` 戳（档 A）——
  try {
    for (const item of plan.recomposed) {
      const composed = composeTargetBytes(root, proposalDir, item.target, item.recorded.mode, item.beforeBytes, true);
      inputs.push({ kind: 'prepared', targetPath: item.target.targetPath, mode: 'MODIFY', bytes: composed.afterBytes });
      if (isTestTarget(item.target)) tests.push({ targetPath: item.target.targetPath, beforeBytes: item.beforeBytes, afterBytes: composed.afterBytes });
      nextTargets.push({ ...item.recorded, after_sha256: sha256Hex(composed.afterBytes) });
    }
    for (const item of plan.added) {
      const composed = composeTargetBytes(root, proposalDir, item.target, item.target.mode, item.beforeBytes, true);
      inputs.push({ kind: 'prepared', targetPath: item.target.targetPath, mode: item.target.mode, bytes: composed.afterBytes });
      if (isTestTarget(item.target)) tests.push({ targetPath: item.target.targetPath, beforeBytes: item.beforeBytes, afterBytes: composed.afterBytes });
      nextTargets.push(captureBaselineTarget(root, item.target.targetPath, item.target.mode, item.beforeBytes, composed.afterBytes));
    }
    for (const item of plan.restored) {
      inputs.push({ kind: 'prepared', targetPath: item.recorded.path, mode: 'MODIFY', bytes: item.beforeBytes });
      if (item.recorded.path.startsWith('logos/resources/test/')) {
        tests.push({ targetPath: item.recorded.path, beforeBytes: item.beforeBytes, afterBytes: item.beforeBytes });
      }
    }
    const metadata = metadataBytes(root, slug, plan.added.map(a => a.target));
    if (metadata) inputs.push({ kind: 'prepared', targetPath: 'logos/logos-project.yaml', mode: 'MODIFY', bytes: metadata });

    // 整体重算：基线 before → 修正后，各轮改动天然包含在整体 diff 中，不需要祖先前滚。
    testChangeSet = forwardMergeTestChangeSets(
      buildTestChangeSet({ change: slug, module: moduleFromGuard(root, slug), targets: tests }), []);

    const amendment: MergeAmendmentRecord = {
      amended_at: new Date().toISOString(),
      previous_delta_digest: plan.baseline.delta_digest,
      delta_digest: plan.currentDigest,
      targets_recomposed: sortPaths(plan.recomposed.map(r => r.target.targetPath)),
      targets_added: sortPaths(plan.added.map(a => a.target.targetPath)),
      targets_restored: sortPaths(plan.restored.map(r => r.recorded.path)),
      invalidated_markers: [...presentMarkers],
    };
    const nextBaseline: MergeBaseline = {
      schema: MERGE_BASELINE_SCHEMA,
      delta_digest: plan.currentDigest,
      // 走到此处说明拒绝边界 ⑤ 未命中，当前原型身份与记录一致，原样登记。
      prototypes: collectPrototypeIdentities(proposalDir),
      targets: nextTargets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    };
    markerBytes = Buffer.from(`${JSON.stringify({
      ...plan.record,
      test_change_set: testChangeSet,
      merge_baseline: nextBaseline,
      amendments: [...plan.amendments, amendment],
    }, null, 2)}\n`, 'utf8');
    inputs.push({ kind: 'prepared', targetPath: markerPath, mode: 'MODIFY', bytes: markerBytes });
  } catch (error) {
    throw stampMergeFailureStage(error, 'prepare');
  }

  // —— 验收事实失效（先清后写）——
  const removeMarker = deps.removeMarker ?? ((abs: string) => unlinkSync(abs));
  const restoreMarker = deps.restoreMarker ?? ((abs: string, bytes: Buffer) => writeFileSync(abs, bytes));
  const backups = new Map<string, Buffer>();
  for (const name of presentMarkers) backups.set(name, readFileSync(join(proposalDir, name)));
  const removed: string[] = [];
  const restoreAll = (): string[] => {
    const failed: string[] = [];
    for (const name of removed) {
      try { restoreMarker(join(proposalDir, name), backups.get(name)!); } catch { failed.push(name); }
    }
    return failed;
  };
  try {
    for (const name of presentMarkers) {
      removeMarker(join(proposalDir, name));
      removed.push(name);
    }
  } catch (error) {
    // 规格尚未写入 ⇒ 已确认旧规格：恢复已清除的标记，按档 A 退出。
    const failed = restoreAll();
    const err = error instanceof Error ? error : new Error(String(error));
    err.message = `清除验收/交付标记失败（${err.message}），规格尚未写入；已清除的标记${failed.length > 0 ? `恢复失败：${failed.join('、')}，提案须重新 verify` : '已按备份恢复'}`;
    throw stampMergeFailureStage(err, 'prepare');
  }

  try {
    applyPreparedInputs(root, proposalDir, inputs, {}, deps.apply);
  } catch (error) {
    const stage = readMergeFailureStage(error);
    const err = error instanceof Error ? error : new Error(String(error));
    if (removed.length > 0) {
      if (stage === 'apply-rolled-back') {
        const failed = restoreAll();
        if (failed.length > 0) err.message += `；被清除的验收/交付标记恢复失败：${failed.join('、')}（规格已确认回到修正前字节），提案须重新 verify`;
        else err.message += `；被清除的验收/交付标记已按备份恢复：${removed.join('、')}`;
      } else {
        // 档 C：规格可能已是修正后字节或半新半旧——禁止恢复旧通过事实。
        err.message += `；被清除的验收/交付标记未恢复：${removed.join('、')}（规格状态不可确认，可能已是修正后字节），提案须重新 verify`;
      }
    }
    throw err;
  }

  const amend = {
    targets_recomposed: sortPaths(plan.recomposed.map(r => r.target.targetPath)),
    targets_added: sortPaths(plan.added.map(a => a.target.targetPath)),
    targets_restored: sortPaths(plan.restored.map(r => r.recorded.path)),
  };
  const targets = sortPaths([...amend.targets_recomposed, ...amend.targets_added, ...amend.targets_restored]);
  return {
    slug,
    result: 'amended',
    delta_digest: plan.currentDigest,
    target_count: targets.length,
    targets,
    spec_merged_path: markerPath,
    test_change_set: testChangeSet,
    invalidated_markers: [...presentMarkers],
    amend,
  };
}

/** `status` 的 `modules[].active_change.spec_amend` 只读投影（S11「已合并提案的增量修正只读投影」）。 */
export interface SpecAmendProjection {
  merged_delta_digest: string | null;
  current_delta_digest: string;
  /** 有修正待应用；无基线时为 null（不可判定，宿主不得当作 false）。 */
  pending: boolean | null;
  blocked_reason: AmendBlockedReason | null;
  amend_count: number;
}

/**
 * 派生 `spec_amend` 投影：未完成规格阶段返回 null（不挂键）。
 *
 * **全程只读**：摘要与 merge 同一实现（`computeDeltaDigest`）；`pending === true` 时按 merge 同一顺序
 * ④ → ⑤ → ③ → ② 只读检查拒绝边界（① 无基线另行输出），基线 blob 仅以 `git cat-file -e` 探测。
 * 不写文件、不写 git 对象、不改 `proposal_step` 派生。
 */
export function deriveSpecAmend(root: string, proposalDir: string): SpecAmendProjection | null {
  if (!hasSpecCompleteMarker(proposalDir)) return null;
  let current: string;
  try { current = computeDeltaDigest(proposalDir); } catch { return null; }
  const { record, baseline, amendments } = readSpecMergedRecord(proposalDir);
  if (!record || !baseline) {
    return { merged_delta_digest: null, current_delta_digest: current, pending: null, blocked_reason: 'baseline-missing', amend_count: 0 };
  }
  const pending = current !== baseline.delta_digest;
  return {
    merged_delta_digest: baseline.delta_digest,
    current_delta_digest: current,
    pending,
    blocked_reason: pending ? firstAmendBlocker(root, proposalDir, baseline) : null,
    amend_count: amendments.length,
  };
}

/** 拒绝边界的只读判定（与 `checkMergedProposal` 同序：④ → ⑤ → ③ → ②），首个命中即返回。 */
function firstAmendBlocker(root: string, proposalDir: string, baseline: MergeBaseline): AmendBlockedReason | null {
  let currentPaths: Set<string> | null = null;
  try {
    currentPaths = new Set(planDirectTargets(root, proposalDir).map(t => t.targetPath));
  } catch {
    // delta 路径非法等由 change-lint / merge 的既有判据报出，不属本投影的受阻原因。
    currentPaths = null;
  }
  if (currentPaths && baseline.targets.some(t => t.mode === 'CREATE' && !currentPaths!.has(t.path))) return 'create-withdraw';
  if (changedPrototypes(proposalDir, baseline).length > 0) return 'prototype-changed';
  for (const t of baseline.targets) {
    const abs = join(root, ...t.path.split('/'));
    if (!existsSync(abs) || sha256Hex(readFileSync(abs)) !== t.after_sha256) return 'drift';
  }
  for (const t of baseline.targets) {
    if (t.mode !== 'MODIFY' || !t.before) continue;
    if (t.before.git_blob === null || !gitBlobExists(root, t.before.git_blob)) return 'baseline-unreadable';
  }
  return null;
}
