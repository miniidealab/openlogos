/**
 * merge 直接合并（功能规格 §2.69）——取代合并事务外壳。
 *
 * 一次调用完成：解析 [delta] 目标集 → 逐 canonical target 经合并引擎合成最终字节
 * → 交 applyBaselineClosureBatch 一次性原子落盘 → 末步写含 test_change_set 的 SPEC_MERGED。
 *
 * 边界（承 lite-cut1a 的教训：删外壳，不删引擎与结构化事实源）：
 * - 合并引擎 `composeOpenLogosMarkdown`（含 verifyAgentMaterialOutcome 物质结果复验）原地复用；
 * - 原子落盘原语 `applyBaselineClosureBatch`（temp+fsync+rename，失败整批回滚）原地复用；
 * - `test_change_set` 是**结构化事实源**（被 verify / change-lint / test-slice-manifest 三处消费），
 *   由本模块直接构建并写入 SPEC_MERGED，schema 与字段口径与事务时代逐字段一致。
 *
 * 删除的是：content slot 与 staging、逐 slot 提交与重读校验、seal/seal_sha256、事务相位机与
 * allowed_actions 准入矩阵、receipt、target_set_sha256，以及随之而来的三向终态死锁面。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDocument } from 'yaml';
import { applyBaselineClosureBatch, type BaselineClosureApplyInput } from './baseline-apply.js';
import { canonicalTargetFromDeltaPath, classifyCanonicalTargetCategory, classifyDeltaRoute } from './canonical-target.js';
import { classifyProposalDeltas, DeltaScanUnreadableError } from './delta-classify.js';
import { composeOpenLogosMarkdown } from './markdown-section-authority.js';
import { validateAndStripNonMarkdownDelta } from './non-markdown-delta.js';
import { firstLineOf } from './whole-file-marker.js';
import { SPEC_MERGED_MARKER } from './proposal-markers.js';
import { buildTestChangeSet, forwardMergeTestChangeSets, type TestChangeSetV1 } from './test-change-set.js';

export type MergeDirectErrorCode =
  | 'MERGE_NO_ACTIVE_CHANGE'
  | 'MERGE_DELTA_INVALID'
  | 'MERGE_TARGET_MISMATCH'
  | 'MERGE_ALREADY_COMPLETE'
  | 'MERGE_APPLY_FAILED'
  | 'MERGE_PROTOTYPE_COMMIT_UNCONFIRMED';

/** §2.69.1 失败语义：git 工作区就是回滚点，故每条错误都自带回滚提示，不依赖命令层补。 */
const ROLLBACK_HINT = '回滚点：git checkout logos/resources/';

/**
 * merge 失败的**阶段事实**（§2.84.3 状态分档的唯一判据源）。只由控制流位置与落盘原语的结构化
 * 返回派生，**禁止**从错误 message 文本反推（对齐 §2.69.2「流程判断使用结构化数据」）。
 *
 * - `prepare`：失败发生在调用落盘原语**之前**（目标集解析、合成、buildTestChangeSet 等）→ 档 A
 * - `apply-rolled-back`：原语返回 `ok:false` 且 `rolled_back === true` → 档 B
 * - `apply-unconfirmed`：原语返回 `ok:false` 且 `rolled_back !== true`，或错误自原语内部直接
 *   逃出（含 `phase='committed'` 之后清理失败经恢复路径二次抛出）→ 档 C
 * - `prototype-unconfirmed`：原型事务在**阶段一与阶段二之间**提交且回滚不完整或抛错
 *   （`commitVerifiedPrototypes` 返回 `rolledBack:false` 或直接抛出，`spec/proposal-ui-ux-first.md`
 *   §12.3.2 档 P2）→ 档 C，但事实与 `apply-unconfirmed` 不同：markdown 主文档**未进入落盘阶段**、
 *   `SPEC_MERGED` 未写，不可确认的只有原型资产；状态声明另走一条专用文案，绝不套用
 *   「主文档可能已是合并后字节」。
 * - `apply-rolled-back-prototype-unconfirmed`（code-r1 F2）：规格侧**已确认整批回滚**，但原型侧的
 *   补偿回滚不完整/不可确认 → 档 C。此档存在的唯一理由是：此时若按 `apply-rolled-back` 取档 B，
 *   输出会宣称「logos/resources/ 保持合并前字节……已整批回滚」——那对原型侧是与磁盘相反的断言。
 */
export type MergeFailureStage = 'prepare' | 'apply-rolled-back' | 'apply-unconfirmed'
  | 'prototype-unconfirmed' | 'apply-rolled-back-prototype-unconfirmed';

/**
 * 阶段戳以 Symbol 附着在**原错误对象**上，不包装、不替换错误类——`code`、`targetPaths`、原始
 * message 与错误类名全部原样保留（§2.84.3「错误码位不降级」「不吞诊断」）。
 */
export const MERGE_FAILURE_STAGE = Symbol.for('openlogos.mergeFailureStage');

/** 给逃出者打阶段戳并原样返回（已有戳则不覆盖：内层更接近事实）。 */
export function stampMergeFailureStage<T>(error: T, stage: MergeFailureStage): T {
  if (error !== null && typeof error === 'object'
    && (error as Record<symbol, unknown>)[MERGE_FAILURE_STAGE] === undefined) {
    try {
      Object.defineProperty(error, MERGE_FAILURE_STAGE, { value: stage, enumerable: false, configurable: true });
    } catch { /* 冻结对象不可标注：命令层按「阶段未知」走 fail-safe 档 C */ }
  }
  return error;
}

/** 读阶段戳；无戳返回 null（命令层改由磁盘事实派生，仍不读 message 文本）。 */
export function readMergeFailureStage(error: unknown): MergeFailureStage | null {
  if (error === null || typeof error !== 'object') return null;
  const stage = (error as Record<symbol, unknown>)[MERGE_FAILURE_STAGE];
  return stage === 'prepare' || stage === 'apply-rolled-back' || stage === 'apply-unconfirmed'
    || stage === 'prototype-unconfirmed' || stage === 'apply-rolled-back-prototype-unconfirmed'
    ? stage : null;
}

export class MergeDirectError extends Error {
  readonly stage: MergeFailureStage;

  /**
   * `stage` 默认 `prepare`——既有抛点全部位于准备阶段，默认值使既有消息与行为逐字不变。
   * 回滚点提示只在**字节确实停留在合并前态**的两档（A / B）拼接：档 C 下「回滚点」是错误
   * 指引（该重跑前先核对状态），不得随消息一起发出（§2.84.3 状态档表）。
   */
  constructor(readonly code: MergeDirectErrorCode, message: string, stage: MergeFailureStage = 'prepare') {
    super((stage === 'apply-unconfirmed' || stage === 'prototype-unconfirmed'
      || stage === 'apply-rolled-back-prototype-unconfirmed')
      ? message : `${message}（${ROLLBACK_HINT}）`);
    this.name = 'MergeDirectError';
    this.stage = stage;
    stampMergeFailureStage(this, stage);
  }
}

export interface MergeDirectResult {
  slug: string;
  target_count: number;
  targets: string[];
  spec_merged_path: string;
  test_change_set: TestChangeSetV1;
}

interface PlannedTarget {
  deltaPath: string;
  targetPath: string;
  mode: 'CREATE' | 'MODIFY';
  category: string;
}

function moduleFromGuard(root: string, slug: string): string {
  try {
    const guard = JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf8')) as Record<string, unknown>;
    if (guard.activeChange === slug && typeof guard.module === 'string' && guard.module.trim()) return guard.module.trim();
  } catch { /* 回退默认 */ }
  return 'core';
}

/**
 * 目标集 = `deltas/` 的**无逻辑投影**（功能规格 §2.71）。
 *
 * 每个可 merge delta 经 `canonicalTargetFromDeltaPath` 映射为唯一 canonical target，
 * 模式按磁盘事实即时判定：目标存在为 MODIFY、缺失为 CREATE。
 *
 * 本函数**不读取 proposal 的任何 YAML 声明**——计划与事实曾是两份数据，
 * 其不一致正是手工枚举带来的；现在只有一份。
 */
export function planDirectTargets(root: string, proposalDir: string): PlannedTarget[] {
  const entries = classifyProposalDeltas(proposalDir);
  // 错误态先于投影：产物不可读绝不被过滤成空目标集（否则会经 no-delta 早退写成假成功）。
  const broken = entries.find(e => e.ioError);
  if (broken) throw new DeltaScanUnreadableError(broken);

  const byTarget = new Map<string, PlannedTarget>();
  for (const entry of entries) {
    if (entry.mergeDisposition !== 'mergeable') continue;
    // 原型资产（2-page-design 下的 .html）不是章节文档，由 commitVerifiedPrototypes 整份落盘，
    // 不进 merge 的 canonical target 集合。（此前由闭包计划天然排除；改 delta 派生后需显式排除。）
    //
    // ⚠️ 成对约定（§12.3.1「约定一致性核对」）：本处排除的**前提**是落盘方在安装态真实可执行。
    // 落盘方 = `cli/src/commands/merge.ts` 正常 `ui_impact` 分支经 `MergeDirectHooks.afterPrepare`
    // 调用的 `commitVerifiedPrototypes()`——**不在** `legacyMergeTestMode()` 等测试专用开关内
    // （2026-09-14 事故：调用曾被圈进 legacy 门，本处排除随之指向死路径，安装态静默丢弃全部原型）。
    // 改动任一侧必须同步核对另一侧，不得只改一侧。
    if (entry.relativePath.replace(/\\/g, '/').includes('/2-product-design/2-page-design/')
      && entry.relativePath.endsWith('.html')) continue;
    const targetPath = canonicalTargetFromDeltaPath(entry.relativePath);
    if (targetPath === null) {
      throw new MergeDirectError('MERGE_DELTA_INVALID',
        `delta 路径无法映射为 canonical target（越界、上跳或未知类别目录）：${entry.relativePath}`);
    }
    const existing = byTarget.get(targetPath);
    if (existing) {
      throw new MergeDirectError('MERGE_TARGET_MISMATCH',
        `两个 delta 映射到同一 canonical target ${targetPath}：${existing.deltaPath}、${entry.relativePath}`
        + '——顺序应用下后写会覆盖前写');
    }
    byTarget.set(targetPath, {
      deltaPath: entry.relativePath,
      targetPath,
      mode: existsSync(join(root, ...targetPath.split('/'))) ? 'MODIFY' : 'CREATE',
      category: classifyCanonicalTargetCategory(targetPath) ?? 'unknown',
    });
  }
  return [...byTarget.values()].sort((a, b) => a.targetPath < b.targetPath ? -1 : a.targetPath > b.targetPath ? 1 : 0);
}

/** CREATE 目标须登记进 resource_index；无 CREATE 时返回 null（不触碰 metadata）。 */
function metadataBytes(root: string, slug: string, targets: PlannedTarget[]): Buffer | null {
  const created = targets.filter(t => t.mode === 'CREATE');
  if (created.length === 0) return null;
  const path = join(root, 'logos', 'logos-project.yaml');
  const doc = parseDocument(readFileSync(path, 'utf8'), { uniqueKeys: true, strict: true });
  const data = doc.toJS() as Record<string, unknown>;
  const index = Array.isArray(data.resource_index) ? data.resource_index as Array<Record<string, unknown>> : [];
  let changed = false;
  for (const target of created) {
    if (!index.some(item => item.path === target.targetPath)) {
      index.push({ path: target.targetPath, desc: `${slug} 创建的 ${target.category} 基线` });
      changed = true;
    }
  }
  if (!changed) return null;
  data.resource_index = index;
  doc.contents = doc.createNode(data) as never;
  return Buffer.from(doc.toString({ lineWidth: 0 }), 'utf8');
}

interface DirectMergePreparation {
  targets: PlannedTarget[];
  inputs: BaselineClosureApplyInput[];
  markerPath: string;
  testChangeSet: TestChangeSetV1;
}

/**
 * 准备阶段（§2.69.1 第 1～2 步 + 第 4 步的 test_change_set 构建）：**零写入**。
 *
 * 独立成函数是为了让「失败发生在调用落盘原语之前」成为一个**控制流位置事实**——mergeDirect
 * 对本函数的任何逃出者统一打 `prepare` 戳（档 A），无需从消息文本猜阶段（§2.84.3）。
 */
function prepareDirectMerge(root: string, proposalDir: string, slug: string): DirectMergePreparation {
  const targets = planDirectTargets(root, proposalDir);
  const inputs: BaselineClosureApplyInput[] = [];
  const tests: Array<{ targetPath: string; beforeBytes: Buffer | null; afterBytes: Buffer }> = [];

  // —— 阶段一：全部目标在内存中合成并复验，任一失败即整体中止（零写入）——
  for (const target of targets) {
    const deltaAbs = join(proposalDir, ...target.deltaPath.split('/'));
    const targetAbs = join(root, ...target.targetPath.split('/'));
    // 模式在 planDirectTargets 中按同一磁盘事实判定，此处只需读取当前字节。
    const exists = target.mode === 'MODIFY';
    const rawDelta = readFileSync(deltaAbs);
    // **分流判定取 `classifyDeltaRoute` 单点**（见 canonical-target.ts）——此处**禁止**重写等价条件：
    // change-lint L4 与本处曾各写一份 `'api' || 'database'`，正是 toolstop 事故「lint 全绿而 merge 必炸」的成因。
    // 判定返回三值：`section`（章节合成）/ `whole-file`（整文件）/ `invalid-envelope`（已声明封装但受理
    // 不合法）。**`invalid-envelope` 绝不降级为 `section`**：回退成章节锚正是既有标题残渣的产生机制。
    const route = classifyDeltaRoute({
      firstLine: firstLineOf(rawDelta.toString('utf8')),
      targetPath: target.targetPath,
      semanticCategory: classifyCanonicalTargetCategory(target.targetPath),
      mode: target.mode,
    });
    if (route.kind === 'invalid-envelope') {
      throw new MergeDirectError('MERGE_DELTA_INVALID', `${target.targetPath}：${route.reason}`);
    }
    // API / DB / 编排 canonical target 不是 Markdown 章节文档：其 delta 首行为控制标记、正文即最终字节，
    // 交 baseline-apply 的 non-markdown 入口做标记校验与剥离（与 0.13.x apply 同一判据）。
    if (route.kind === 'whole-file' && route.channel === 'non-markdown') {
      inputs.push({ kind: 'non-markdown', deltaPath: target.deltaPath, mode: target.mode, deltaBytes: rawDelta });
      continue;
    }
    let bytes: Buffer;
    if (route.kind === 'whole-file') {
      // **Markdown 整文件走 prepared 最终字节通道，不进 `non-markdown` 分支**（S39 C04）。
      // 理由是该分支并非「只换一个字节来源」：它在推入 inputs 后立即 `continue`，会跳过下方的
      // 测试目标 before/after 收集，使新建的 `logos/resources/test/*.md` 不进 `buildTestChangeSet`，
      // `SPEC_MERGED.test_change_set` 的 targets 与 changed_test_ids 双双为空；且 apply 侧仍按语义
      // 类别拒绝非 API/DB/编排的 non-markdown 输入，落盘准备阶段即失败。就地校验剥离后以 prepared
      // 入列，既闭合账本、又让 apply 侧的类别闸零改动。
      const decoded = rawDelta.toString('utf8');
      if (!Buffer.from(decoded, 'utf8').equals(rawDelta)) {
        throw new MergeDirectError('MERGE_DELTA_INVALID', `${target.targetPath}：delta 不是合法 UTF-8`);
      }
      const checked = validateAndStripNonMarkdownDelta(decoded, target.mode, target.targetPath, { root });
      if (!checked.ok || checked.payload === undefined) {
        throw new MergeDirectError('MERGE_DELTA_INVALID', `${target.targetPath}：${checked.message}`);
      }
      const newline = rawDelta.indexOf(0x0a);
      if (newline < 0) throw new MergeDirectError('MERGE_DELTA_INVALID', `${target.targetPath}：缺首行行结束符`);
      // validator 只删除首行及唯一换行；直接切原 Buffer，保证 payload 字节零格式化（与 apply 侧同一手法），
      // 并与 validator 返回的 payload 字符串**交叉核对**以确保剥离结果确定。
      bytes = rawDelta.subarray(newline + 1);
      if (checked.payload !== bytes.toString('utf8')) {
        throw new MergeDirectError('MERGE_DELTA_INVALID', `${target.targetPath}：payload 剥离结果不确定`);
      }
    } else {
      const before = exists ? readFileSync(targetAbs, 'utf8') : '';
      let finalText: string;
      try {
        // 引擎内部完成锚唯一定位、标题层级 rebase 与 verifyAgentMaterialOutcome 物质结果复验
        finalText = composeOpenLogosMarkdown(before, rawDelta.toString('utf8'), target.mode);
      } catch (error) {
        throw new MergeDirectError('MERGE_DELTA_INVALID',
          `${target.targetPath}：${error instanceof Error ? error.message : String(error)}`);
      }
      bytes = Buffer.from(finalText, 'utf8');
    }
    inputs.push({ kind: 'prepared', targetPath: target.targetPath, mode: target.mode, bytes });
    if (target.category === 'test' || target.targetPath.startsWith('logos/resources/test/')) {
      tests.push({ targetPath: target.targetPath, beforeBytes: exists ? readFileSync(targetAbs) : null, afterBytes: bytes });
    }
  }

  const metadata = metadataBytes(root, slug, targets);
  if (metadata) {
    inputs.push({ kind: 'prepared', targetPath: 'logos/logos-project.yaml', mode: 'MODIFY', bytes: metadata });
  }

  // test_change_set 是结构化事实源：由本次合并即时构建，随 SPEC_MERGED 落盘供下游消费
  // 无 reopen 通道（§2.69 EX-9.22）故 lineage 恒空；仍走 forwardMergeTestChangeSets 以保持 §2.69.1 第 4 步字面口径。
  const testChangeSet = forwardMergeTestChangeSets(
    buildTestChangeSet({ change: slug, module: moduleFromGuard(root, slug), targets: tests }),
    [],
  );

  const markerPath = relative(root, join(proposalDir, SPEC_MERGED_MARKER)).replace(/\\/g, '/');
  const markerBytes = Buffer.from(`${JSON.stringify({
    type: 'merge_complete',
    completed_at: new Date().toISOString(),
    test_change_set: testChangeSet,
  }, null, 2)}\n`, 'utf8');
  inputs.push({ kind: 'prepared', targetPath: markerPath, mode: 'CREATE', bytes: markerBytes });
  return { targets, inputs, markerPath, testChangeSet };
}

/**
 * 执行直接合并。**校验全部前置于写入**：任一目标合成失败即在写入任何文件前抛错，
 * `logos/resources/` 零改动；落盘阶段失败由 applyBaselineClosureBatch 整批回滚。
 */
/**
 * 阶段钩子（`spec/proposal-ui-ux-first.md` §12.3.3「写入阶段前置」的承载点）。
 *
 * 唯一目的：让**原型事务**挂在「全部 canonical target 解析/合成/物质结果复验完成」之后、
 * 「任何写入动作」之前，并让其恢复材料的生命周期跟随整次 merge 的成败——而不是把原型提交
 * 提到合成之前（那会让合成失败时的档 A 零改动声明与磁盘相反）。
 *
 * 本类型不改变 merge 自身的任何判定：钩子不参与目标集计算、不影响 `test_change_set`、
 * 未传钩子时行为与调用序列逐字不变。
 */
export interface MergeDirectHooks {
  /**
   * 阶段一（零写入的准备/合成/复验）完成、阶段二第一次写入之前调用。
   * 返回 `{ abort: true, reason }` ⇒ 以 `MERGE_PROTOTYPE_COMMIT_UNCONFIRMED` + `prototype-unconfirmed`
   * 阶段戳中止合并：不进入落盘、不写 `SPEC_MERGED`。
   */
  afterPrepare?(): { abort: boolean; reason?: string } | void;
  /** 阶段二**全部成功**（规格 canonical target 原子落盘 + `SPEC_MERGED` 写入）之后调用。 */
  afterCommit?(): void;
  /**
   * 阶段二失败之后、抛出之前调用；`rolledBack` 取自落盘原语的结构化返回
   * （`true` = 规格侧已确认整批回滚；`false` = 规格侧已提交或状态不可确认）。
   *
   * 返回值（code-r1 F2）：补偿动作的**结构化结果**必须回传给合并协调层——只有规格与原型
   * **双方都确认回到旧态**才允许整体取档 B。钩子只打印告警、不回传状态，会让最终报告
   * 无条件宣称「已整批回滚」，与原型侧磁盘事实相反。
   */
  onApplyFailure?(info: { rolledBack: boolean }): PrototypeCompensation | void;
}

/** 原型侧补偿动作的结构化结果（`MergeDirectHooks.onApplyFailure` 的返回值）。 */
export interface PrototypeCompensation {
  /** 原型侧是否**已确认**回到 merge 前一致态。 */
  consistent: boolean;
  /** 原型侧是否处于不可确认态（禁止任何零残留声明，恢复材料须保留）。 */
  unconfirmed: boolean;
  reason?: string;
}

export function mergeDirect(
  root: string,
  proposalDir: string,
  slug: string,
  hooks: MergeDirectHooks = {},
): MergeDirectResult {
  if (!existsSync(proposalDir)) {
    throw new MergeDirectError('MERGE_NO_ACTIVE_CHANGE', `变更提案不存在：${slug}`);
  }
  if (existsSync(join(proposalDir, SPEC_MERGED_MARKER))) {
    throw new MergeDirectError('MERGE_ALREADY_COMPLETE',
      `${SPEC_MERGED_MARKER} 已存在；重新合并请先回滚主文档并删除该 marker`);
  }

  // —— 阶段一：准备（零写入）——任何逃出者都带 `prepare` 戳，命令层据此取档 A。
  let prepared: DirectMergePreparation;
  try {
    prepared = prepareDirectMerge(root, proposalDir, slug);
  } catch (error) {
    throw stampMergeFailureStage(error, 'prepare');
  }
  const { targets, inputs, markerPath, testChangeSet } = prepared;

  // —— 阶段一与阶段二之间：写入阶段前置钩子（§12.3.3）——此处之前**零写入**，
  // 故合成失败时原型根本不会进入提交，既有 EX-9.20/EX-9.23 的档 A 零改动声明与磁盘一致。
  // code-r1 F3：钩子内的真实写入路径（`commitVerifiedPrototypes`）可能**直接抛出**而非返回
  // `CommitResult`（如 rename 之后 journal 持久化失败、abortTransaction 二次抛出）。未加边界时
  // 该错误会带着「无阶段戳」进入通用报告，而报告的磁盘回退判据只看规格 apply journal 与
  // SPEC_MERGED、不看原型 journal ⇒ 被误判为档 A 并宣称「保持合并前字节」。故在此设边界：
  // 逃出者一律打 `prototype-unconfirmed` 戳（fail-safe 取档 C），保留恢复材料、保留原始错误。
  let prepareDecision: { abort: boolean; reason?: string } | void;
  try {
    prepareDecision = hooks.afterPrepare?.();
  } catch (error) {
    throw stampMergeFailureStage(error, 'prototype-unconfirmed');
  }
  if (prepareDecision && prepareDecision.abort) {
    throw new MergeDirectError(
      'MERGE_PROTOTYPE_COMMIT_UNCONFIRMED',
      prepareDecision.reason ?? '原型事务状态不可确认，已中止合并',
      'prototype-unconfirmed',
    );
  }

  // —— 阶段二：一次性原子落盘，失败整批回滚 ——
  // 故障注入仅在 NODE_ENV=test 下生效（与被删除的事务实现同一形态），用于验收「末段故障整批回滚」。
  const failAfter = process.env.NODE_ENV === 'test' ? process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER : undefined;
  let result;
  try {
    result = applyBaselineClosureBatch(root, proposalDir, inputs, {
      afterWrite(path) { if (failAfter === path) throw new Error(`test fault after ${path}`); },
    });
  } catch (error) {
    // 错误自原语**内部**逃出（如 `phase='committed'` 之后 removePrivateArtifacts 失败、其恢复
    // 路径二次抛出）：此刻主文档可能已是新字节、SPEC_MERGED 可能已在场 → 档 C，绝不声明零残留。
    // 规格侧状态不可确认 ⇒ 钩子据此**不得单独回滚原型**（code-r1 F1）；整体已是档 C。
    // code-r2 F2：钩子逃出的异常不得取代原始 apply 错误（诊断不降级），也不得改变已成立的档 C。
    try { hooks.onApplyFailure?.({ rolledBack: false }); }
    catch { /* 补偿阶段异常：档位已是不可确认，保留原始 apply 错误为主诊断 */ }
    throw stampMergeFailureStage(error, 'apply-unconfirmed');
  }
  if (!result.ok) {
    // §2.84.3 同批订正：旧实现无条件拼接「主文档已回滚至合并前字节」，在 rolled_back === false
    // 时是与磁盘相反的断言。改为按原语的结构化返回派生，不保留第二处硬编码结论。
    const rolledBack = result.rolled_back === true;
    // code-r2 F2：补偿调用必须在**整体阶段戳生成之前**就被异常边界收住——否则抛出的补偿错误会
    // 带着无阶段戳直接逃出，而 `classifyMergeFailureTier` 的磁盘回退判据只看规格 journal 与
    // SPEC_MERGED（此刻规格已回滚且已清理）⇒ 判档 A 并宣称「保持合并前字节」，与原型侧相反。
    let compensation: PrototypeCompensation | void = undefined;
    let compensationError: Error | null = null;
    try {
      compensation = hooks.onApplyFailure?.({ rolledBack });
    } catch (err) {
      // 抛出 = 补偿结果不可知 ⇒ fail-safe 按「原型不可确认」处理，恢复材料按约定保留。
      compensationError = err as Error;
    }
    // code-r1 F2：整体档位 = 规格侧结论 ∧ 原型侧补偿结论。原型补偿不可确认时不得取档 B。
    const protoUnconfirmed = compensation?.unconfirmed === true || compensationError !== null;
    const stage: MergeFailureStage = protoUnconfirmed
      ? (rolledBack ? 'apply-rolled-back-prototype-unconfirmed' : 'apply-unconfirmed')
      : (rolledBack ? 'apply-rolled-back' : 'apply-unconfirmed');
    // 原始规格失败原因始终保留；补偿阶段的结构化 reason 与逃出异常并列附加，三者都不丢
    //（诊断不降级——补偿失败的归因必须进入失败报告，不能只落在一行 console 告警里）。
    const base = (rolledBack && !protoUnconfirmed)
      ? `${result.error}；主文档已回滚至合并前字节`
      : result.error;
    const parts = [base];
    if (compensation?.reason) parts.push(`原型补偿：${compensation.reason}`);
    if (compensationError) parts.push(`原型补偿阶段抛出：${compensationError.message}`);
    throw new MergeDirectError('MERGE_APPLY_FAILED', parts.join('；'), stage);
  }

  hooks.afterCommit?.();

  return {
    slug,
    target_count: targets.length,
    targets: targets.map(t => t.targetPath),
    spec_merged_path: markerPath,
    test_change_set: testChangeSet,
  };
}
