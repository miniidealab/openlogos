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
import { parseBaselineClosurePlan, type BaselineClosureTarget } from './baseline-closure.js';
import { composeOpenLogosMarkdown } from './markdown-section-authority.js';
import { SPEC_MERGED_MARKER } from './proposal-markers.js';
import { buildTestChangeSet, forwardMergeTestChangeSets, type TestChangeSetV1 } from './test-change-set.js';

export type MergeDirectErrorCode =
  | 'MERGE_NO_ACTIVE_CHANGE'
  | 'MERGE_DELTA_INVALID'
  | 'MERGE_TARGET_MISMATCH'
  | 'MERGE_ALREADY_COMPLETE'
  | 'MERGE_APPLY_FAILED';

/** §2.69.1 失败语义：git 工作区就是回滚点，故每条错误都自带回滚提示，不依赖命令层补。 */
const ROLLBACK_HINT = '回滚点：git checkout logos/resources/';

export class MergeDirectError extends Error {
  constructor(readonly code: MergeDirectErrorCode, message: string) {
    super(`${message}（${ROLLBACK_HINT}）`);
    this.name = 'MergeDirectError';
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

/** 从 proposal 的 baseline_closure 解析可合并目标集；计划非法即 fail-closed。 */
export function planDirectTargets(root: string, proposalDir: string): PlannedTarget[] {
  const proposalPath = join(proposalDir, 'proposal.md');
  const parsed = parseBaselineClosurePlan(root, proposalDir, readFileSync(proposalPath, 'utf8'), relative(root, proposalPath));
  if (!parsed.plan && parsed.violations.length === 0) return [];
  if (!parsed.plan || parsed.violations.length > 0) {
    throw new MergeDirectError('MERGE_TARGET_MISMATCH',
      `baseline closure 计划无效：${parsed.violations[0]?.message ?? '缺少计划'}`);
  }
  return parsed.plan.targets
    .filter((t): t is BaselineClosureTarget & { deltaPath: string; targetPath: string; mode: 'CREATE' | 'MODIFY' } =>
      t.deltaPath !== null && t.targetPath !== null && (t.mode === 'CREATE' || t.mode === 'MODIFY'))
    .map(t => ({ deltaPath: t.deltaPath, targetPath: t.targetPath, mode: t.mode, category: t.category }))
    .sort((a, b) => a.targetPath < b.targetPath ? -1 : a.targetPath > b.targetPath ? 1 : 0);
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

/**
 * 执行直接合并。**校验全部前置于写入**：任一目标合成失败即在写入任何文件前抛错，
 * `logos/resources/` 零改动；落盘阶段失败由 applyBaselineClosureBatch 整批回滚。
 */
export function mergeDirect(root: string, proposalDir: string, slug: string): MergeDirectResult {
  if (!existsSync(proposalDir)) {
    throw new MergeDirectError('MERGE_NO_ACTIVE_CHANGE', `变更提案不存在：${slug}`);
  }
  if (existsSync(join(proposalDir, SPEC_MERGED_MARKER))) {
    throw new MergeDirectError('MERGE_ALREADY_COMPLETE',
      `${SPEC_MERGED_MARKER} 已存在；重新合并请先回滚主文档并删除该 marker`);
  }

  const targets = planDirectTargets(root, proposalDir);
  const inputs: BaselineClosureApplyInput[] = [];
  const tests: Array<{ targetPath: string; beforeBytes: Buffer | null; afterBytes: Buffer }> = [];

  // —— 阶段一：全部目标在内存中合成并复验，任一失败即整体中止（零写入）——
  for (const target of targets) {
    const deltaAbs = join(proposalDir, ...target.deltaPath.split('/'));
    const targetAbs = join(root, ...target.targetPath.split('/'));
    const exists = existsSync(targetAbs);
    if (target.mode === 'CREATE' && exists) {
      throw new MergeDirectError('MERGE_TARGET_MISMATCH', `CREATE 但目标已存在：${target.targetPath}`);
    }
    if (target.mode === 'MODIFY' && !exists) {
      throw new MergeDirectError('MERGE_TARGET_MISMATCH', `MODIFY 但目标缺失：${target.targetPath}`);
    }
    // API / DB canonical target 不是 Markdown 章节文档：其 delta 首行为控制标记、正文即最终字节，
    // 交 baseline-apply 的 non-markdown 入口做标记校验与剥离（与 0.13.x apply 同一判据）。
    if (target.category === 'api' || target.category === 'database') {
      inputs.push({ kind: 'non-markdown', deltaPath: target.deltaPath, mode: target.mode, deltaBytes: readFileSync(deltaAbs) });
      continue;
    }
    const before = exists ? readFileSync(targetAbs, 'utf8') : '';
    let finalText: string;
    try {
      // 引擎内部完成锚唯一定位、标题层级 rebase 与 verifyAgentMaterialOutcome 物质结果复验
      finalText = composeOpenLogosMarkdown(before, readFileSync(deltaAbs, 'utf8'), target.mode);
    } catch (error) {
      throw new MergeDirectError('MERGE_DELTA_INVALID',
        `${target.targetPath}：${error instanceof Error ? error.message : String(error)}`);
    }
    const bytes = Buffer.from(finalText, 'utf8');
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

  // —— 阶段二：一次性原子落盘，失败整批回滚 ——
  // 故障注入仅在 NODE_ENV=test 下生效（与被删除的事务实现同一形态），用于验收「末段故障整批回滚」。
  const failAfter = process.env.NODE_ENV === 'test' ? process.env.OPENLOGOS_TEST_MERGE_FAIL_AFTER : undefined;
  const result = applyBaselineClosureBatch(root, proposalDir, inputs, {
    afterWrite(path) { if (failAfter === path) throw new Error(`test fault after ${path}`); },
  });
  if (!result.ok) {
    throw new MergeDirectError('MERGE_APPLY_FAILED', `${result.error}；主文档已回滚至合并前字节`);
  }

  return {
    slug,
    target_count: targets.length,
    targets: targets.map(t => t.targetPath),
    spec_merged_path: markerPath,
    test_change_set: testChangeSet,
  };
}
