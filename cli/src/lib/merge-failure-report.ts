/**
 * merge 失败出口的**稳定形态构建**（§2.84.3 / §2.84.4，fix-merge-preflight-parity-and-bare-throw）。
 *
 * 本模块只负责「已经发生的失败该如何如实描述」，不参与任何流程判定、不改落盘原语行为。
 *
 * 两条铁律：
 *  1. **状态声明由结构化事实派生**——阶段戳（控制流位置）优先，其次磁盘结构化事实（apply journal
 *     与 SPEC_MERGED 是否在场）；**绝不**从错误 message 文本反推状态（§2.69.2「流程判断使用结构化
 *     数据」）。无法确定即取档 C（fail-safe）：兜底的是错误的**可读性**，不是对磁盘的乐观假设。
 *  2. **诊断不降级**——错误自带的 `code`、`targetPaths`、原始 message 原样进入输出；无 `code` 的
 *     未知错误类才用稳定兜底码，并附错误类名。CLI 的 stderr 是下游自动化唯一可得的病灶来源。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_CLOSURE_APPLY_JOURNAL, APPLY_TXN_DIR } from './baseline-apply.js';
import { readMergeFailureStage, type MergeFailureStage } from './merge-direct.js';
import { SPEC_MERGED_MARKER } from './proposal-markers.js';
import { COMMIT_JOURNAL } from './ui-provenance.js';
import { classifyProposalDeltas } from './delta-classify.js';
import { deltaTargetProjectPath } from './change-lint.js';
import {
  enumerateTestDefinitionTables, findDuplicateHeaderCells, rowColumnsMatchHeader, testDefinitionRowId,
} from './test-table-shape.js';

/** §2.84.3 状态三档。A 未提交 / B 已回滚 / C 已提交或不可确认。 */
export type MergeFailureTier = 'A' | 'B' | 'C';

/** 无 `code` 字段的未知内部错误类使用的稳定兜底码。 */
export const MERGE_FALLBACK_ERROR_CODE = 'MERGE_INTERNAL_ERROR';

export interface MergeFailureDiskFacts {
  /** 磁盘事实是否可读；不可读 → fail-safe 档 C。 */
  readable: boolean;
  /** apply journal 在场 ⇒ 事务进行中或已提交未清理。 */
  journalPresent: boolean;
  /** SPEC_MERGED 在场 ⇒ marker 已随同一原子批落盘。 */
  markerPresent: boolean;
  /** 私有事务目录残留。 */
  txnDirPresent: boolean;
}

export function readMergeFailureDiskFacts(proposalDir: string): MergeFailureDiskFacts {
  try {
    return {
      readable: true,
      journalPresent: existsSync(join(proposalDir, BASELINE_CLOSURE_APPLY_JOURNAL)),
      markerPresent: existsSync(join(proposalDir, SPEC_MERGED_MARKER)),
      txnDirPresent: existsSync(join(proposalDir, APPLY_TXN_DIR)),
    };
  } catch {
    return { readable: false, journalPresent: false, markerPresent: false, txnDirPresent: false };
  }
}

/**
 * 状态档判定。优先取阶段戳（控制流位置事实）；无戳时退到磁盘结构化事实。
 *
 * 无戳且磁盘干净（无 journal、无 marker）判 A 而非 C，是一次**积极判定**而非默认值：两项俱无
 * 意味着既没有进行中的事务，也没有任何已提交的 marker，字节必停留在合并前态。磁盘不可读或任一
 * 项在场即取 C——此时无法断言零残留。
 */
export function classifyMergeFailureTier(error: unknown, facts: MergeFailureDiskFacts): MergeFailureTier {
  const stage = readMergeFailureStage(error);
  if (stage === 'prepare') return 'A';
  if (stage === 'apply-rolled-back') return 'B';
  if (stage === 'apply-unconfirmed') return 'C';
  // §12.3.2 档 P2：原型事务回滚不完整/抛错。仍是「不可确认」档 C，但不可确认的只有原型资产
  // （markdown 主文档未进入落盘阶段），故文案另走 tierLines 的专用分支。
  if (stage === 'prototype-unconfirmed') return 'C';
  // code-r1 F2：规格侧已确认整批回滚、但原型侧补偿不可确认 ⇒ 整体仍是档 C
  //（取档 B 会宣称「logos/resources/ 保持合并前字节」，对原型侧与磁盘相反）。
  if (stage === 'apply-rolled-back-prototype-unconfirmed') return 'C';
  if (!facts.readable) return 'C';
  return (facts.journalPresent || facts.markerPresent) ? 'C' : 'A';
}

export interface MergeFailureDiagnostics {
  code: string;
  /** 是否使用了兜底码（原错误无 `code` 字段）。 */
  codeIsFallback: boolean;
  message: string;
  errorName: string;
  /** 错误自带的结构化归因（如 TestChangeSetBuildError.targetPaths），顺序原样保留。 */
  targetPaths: string[];
}

export function extractMergeFailureDiagnostics(error: unknown): MergeFailureDiagnostics {
  const record = (error !== null && typeof error === 'object') ? error as Record<string, unknown> : {};
  const rawCode = record.code;
  const code = (typeof rawCode === 'string' && rawCode.length > 0) ? rawCode : MERGE_FALLBACK_ERROR_CODE;
  const message = error instanceof Error ? error.message : String(error);
  const errorName = (typeof record.name === 'string' && record.name.length > 0)
    ? record.name
    : (error instanceof Error ? 'Error' : typeof error);
  const targetPaths = Array.isArray(record.targetPaths)
    ? record.targetPaths.filter((item): item is string => typeof item === 'string')
    : [];
  return { code, codeIsFallback: code === MERGE_FALLBACK_ERROR_CODE, message, errorName, targetPaths };
}

export interface DeltaAttribution {
  targetPath: string;
  /** 提案目录内的 delta 相对路径。 */
  deltaPath: string;
  /** delta 文件内 1 基行号。 */
  line: number;
  detail: string;
}

/**
 * §2.84.4 delta 侧归属：把后态失败回溯到**产生该行的 delta 文件与其 delta 内行号**。
 *
 * 判据与前移检查同源（`test-table-shape` 单点）——在映射到该 canonical target 的 delta 内寻找
 * 形态违规行。**唯一命中才归因**：零命中或多命中一律判为「未能确定」，绝不臆造路径或行号。
 */
export function attributeAfterStateFailure(
  proposalDir: string,
  targetPaths: string[],
): { attributions: DeltaAttribution[]; unattributed: string[] } {
  const attributions: DeltaAttribution[] = [];
  const unattributed: string[] = [];
  let entries;
  try {
    entries = classifyProposalDeltas(proposalDir);
  } catch {
    return { attributions: [], unattributed: [...targetPaths] };
  }
  for (const targetPath of targetPaths) {
    const hits: DeltaAttribution[] = [];
    for (const entry of entries) {
      if (entry.mergeDisposition !== 'mergeable' || !entry.relativePath.endsWith('.md')) continue;
      if (deltaTargetProjectPath(entry.relativePath) !== targetPath) continue;
      let content: string;
      try {
        content = readFileSync(join(proposalDir, ...entry.relativePath.split('/')), 'utf-8');
      } catch { continue; }
      for (const violation of findShapeViolationLines(content)) {
        hits.push({
          targetPath,
          deltaPath: entry.relativePath,
          line: violation.line + 1,
          detail: violation.detail,
        });
      }
    }
    if (hits.length === 1) attributions.push(hits[0]);
    else unattributed.push(targetPath);
  }
  return { attributions, unattributed };
}

/** delta 内的形态违规行（与 change-lint L4 前移检查、后态判据同一枚举与判据单点）。 */
function findShapeViolationLines(content: string): Array<{ line: number; detail: string }> {
  const out: Array<{ line: number; detail: string }> = [];
  const lines = content.split('\n');
  for (const table of enumerateTestDefinitionTables(lines)) {
    const duplicates = findDuplicateHeaderCells(table.headers);
    if (duplicates.length > 0) {
      out.push({ line: table.headerLine, detail: `表头重复：${duplicates.join('、')}` });
    }
    for (const row of table.rows) {
      if (testDefinitionRowId(row.cells) === null) continue;
      if (rowColumnsMatchHeader(table.headers.length, row.cells.length)) continue;
      out.push({
        line: row.line,
        detail: `表头 ${table.headers.length} 列，本行 ${row.cells.length} 列（首格 ${row.cells[0] ?? ''}）`,
      });
    }
  }
  return out;
}

/** 状态声明与后续动作指引：四要素中的第二、三项，按档派生（§2.84.3 状态档表）。 */
function tierLines(
  tier: MergeFailureTier,
  slug: string,
  facts: MergeFailureDiskFacts,
  stage: MergeFailureStage | null = null,
): string[] {
  // §12.3.2 档 P2 专用文案：原型事务提交后回滚不完整。禁止任何零残留措辞；同时**不得**套用
  // 通用档 C 的「主文档可能已是合并后字节」——此刻规格 delta 根本没进入落盘阶段。
  // code-r1 F2：规格侧已确认回滚、原型侧不可确认。两侧结论必须分别如实陈述，
  // 绝不合并成一句「logos/resources/ 已整批回滚」。
  if (stage === 'apply-rolled-back-prototype-unconfirmed') {
    return [
      '  规格 delta 已整批回滚至合并前字节，未写 ' + SPEC_MERGED_MARKER + '。',
      '  但原型事务回滚不完整：部分原型可能仍是新字节，恢复材料已保留'
        + `（logos/changes/${slug}/${COMMIT_JOURNAL} 与 .ui-commit-staging / .ui-commit-backup）；`
        + '整体不可宣称 logos/resources/ 已回到合并前态。',
      '  请先核对实际状态：git status；git diff logos/resources/prd/2-product-design/2-page-design/。'
        + '下次 `openlogos merge ' + slug + '` 会依 journal 前滚或回滚；核对前不要手工删除恢复材料。',
    ];
  }
  if (stage === 'prototype-unconfirmed') {
    return [
      '  原型事务状态不可确认：部分原型可能已落盘，回滚未完整完成，恢复材料已保留'
        + `（logos/changes/${slug}/${COMMIT_JOURNAL} 与 .ui-commit-staging / .ui-commit-backup）。`,
      '  规格 delta 未进入落盘阶段：logos/resources/ 下的 markdown 主文档保持合并前字节，未写 '
        + SPEC_MERGED_MARKER + '。',
      '  请先核对实际状态：git status；git diff logos/resources/prd/2-product-design/2-page-design/。'
        + '下次 `openlogos merge ' + slug + '` 会依 journal 前滚或回滚；核对前不要手工删除恢复材料。',
    ];
  }
  if (tier === 'A') {
    return [
      '  logos/resources/ 保持合并前字节，未写 SPEC_MERGED。',
      '  回滚点：git checkout logos/resources/；修正 delta 后重跑 `openlogos merge ' + slug + '`。',
    ];
  }
  if (tier === 'B') {
    return [
      '  logos/resources/ 保持合并前字节，未写 SPEC_MERGED（落盘中途失败，已整批回滚）。',
      '  回滚点：git checkout logos/resources/；修正 delta 后重跑 `openlogos merge ' + slug + '`。',
    ];
  }
  return [
    '  状态不可确认：主文档可能已是合并后字节，SPEC_MERGED 可能已写入，提案目录下可能残留私有事务材料。',
    '  请先核对实际状态：git status；git diff logos/resources/；'
      + `并检查 logos/changes/${slug}/${SPEC_MERGED_MARKER} 是否在场`
      + (facts.txnDirPresent || facts.journalPresent ? `，清理残留的 ${APPLY_TXN_DIR} / ${BASELINE_CLOSURE_APPLY_JOURNAL}` : '')
      + '。核对前不要直接重跑 merge。',
  ];
}

export interface MergeFailureReport {
  tier: MergeFailureTier;
  diagnostics: MergeFailureDiagnostics;
  lines: string[];
}

/**
 * 构建稳定失败形态（四要素之三——第四项「非零退出」由调用方执行）。
 *
 * 归因优先级（§2.84.4）：有 delta 侧归属时以其为**主诊断**（那是可自修的实体），后态行号作为
 * 佐证并列；无归属则显式说明未能归因，不静默省略、不伪造。
 */
export function describeMergeFailure(
  proposalDir: string,
  slug: string,
  error: unknown,
): MergeFailureReport {
  const facts = readMergeFailureDiskFacts(proposalDir);
  const tier = classifyMergeFailureTier(error, facts);
  const diagnostics = extractMergeFailureDiagnostics(error);
  const lines = [`Error: merge 失败（${diagnostics.code}）：${diagnostics.message}`];
  if (diagnostics.codeIsFallback) {
    lines.push(`  错误类：${diagnostics.errorName}（该错误类未登记稳定错误码，已按兜底码归类；原始消息见上）`);
  }
  if (diagnostics.targetPaths.length > 0) {
    const { attributions, unattributed } = attributeAfterStateFailure(proposalDir, diagnostics.targetPaths);
    for (const item of attributions) {
      lines.push(`  delta 侧归属（主诊断，可直接修改）：${item.deltaPath}:${item.line} — ${item.detail}`);
    }
    for (const targetPath of unattributed) {
      lines.push(`  delta 侧归属：未能确定（${targetPath}）——不臆造行号；请按上述合并后态行号在对应 delta 中人工比对`);
    }
    lines.push(`  涉及 canonical target：${diagnostics.targetPaths.join('、')}`);
  }
  lines.push(...tierLines(tier, slug, facts, readMergeFailureStage(error)));
  return { tier, diagnostics, lines };
}
