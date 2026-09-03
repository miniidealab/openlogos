/**
 * `openlogos slice transaction` 命令面。
 *
 * 与 merge 事务同构：复用其 `resolveIdentity()` 目录解析与「归档只读」判据，不新建第二套。
 * Agent 只能 `submit-content`；`tasks.md` 的 `[code]` 段、`TEST_SLICE_MANIFEST.json`、
 * receipt 与 marker 一律由 OpenLogos 写入（根规范 `spec/test-slice-manifest.md` §2.1）。
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { OutputFormat } from '../lib/json-output.js';
import { makeEnvelope, VERSION } from '../lib/json-output.js';
import { resolveIdentity } from './merge-transaction.js';
import {
  TestSliceTransactionError, abortTestSliceTransaction, applyTestSliceTransaction,
  createTestSliceTransaction, readTestSliceTransactionIfPresent, sealTestSliceTransaction,
  submitTestSliceContent, type TestSliceTransactionProjection,
} from '../lib/test-slice-transaction.js';

type SliceTransactionCommand = 'status' | 'submit-content' | 'seal' | 'apply' | 'recover' | 'abort';

/** 只读动作白名单——归档提案仅放行这些（架构 §三十九.1）。 */
const READ_ONLY_COMMANDS = new Set<SliceTransactionCommand>(['status']);
const SUPPORTED: SliceTransactionCommand[] = ['status', 'submit-content', 'seal', 'apply', 'recover', 'abort'];

function emitError(format: OutputFormat, error: unknown): never {
  const txError = error instanceof TestSliceTransactionError ? error : null;
  const message = error instanceof Error ? error.message : String(error);
  const violations = txError?.violations ?? [];
  if (format === 'json') {
    console.error(JSON.stringify({
      command: 'slice transaction', version: VERSION, timestamp: new Date().toISOString(),
      error: {
        code: 'SLICE_TRANSACTION_FAILED',
        message,
        // violations 原样带出（code/path/message/fix_hint 四项俱全），不压缩为摘要——
        // 消费方要靠它定位是哪个 spec_targets 或哪个 task_text 不合格。
        details: { classification: txError?.code ?? 'internal_failure', violations },
      },
    }));
  } else {
    console.error(`Error: slice transaction 失败（${txError?.code ?? 'internal_failure'}）：${message}`);
    for (const v of violations) {
      console.error(`  - [${v.code}] ${v.path}：${v.message}`);
      console.error(`      修复：${v.fix_hint}`);
    }
  }
  process.exit(1);
  throw new Error('unreachable');
}

function emit(format: OutputFormat, projection: TestSliceTransactionProjection | null): void {
  if (format === 'json') {
    console.log(JSON.stringify(makeEnvelope('slice transaction', projection ?? { transaction: null })));
    return;
  }
  if (!projection) { console.log('当前提案没有切片事务。'); return; }
  console.log(`✓ slice transaction ${projection.transaction_id}`);
  console.log(`  phase: ${projection.phase}`);
  console.log(`  origin: ${projection.origin}`);
  console.log(`  next_action: ${projection.next_action ?? '<none>'}`);
  console.log(`  content: ${projection.content_slots.submitted}/${projection.content_slots.required}`);
  if (projection.content_slots.missing_slot_ids.length > 0) {
    console.log(`  missing: ${projection.content_slots.missing_slot_ids.join('、')}`);
  }
}

export function sliceTransactionCommand(
  subcommand: string | undefined, args: string[], format: OutputFormat,
): void {
  const root = process.cwd();
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) {
    emitError(format, new Error('logos/logos.config.json 不存在'));
  }
  if (!SUPPORTED.includes((subcommand ?? '') as SliceTransactionCommand)) {
    emitError(format, new Error(`用法：openlogos slice transaction ${SUPPORTED.join('|')} [--slug <slug>]`));
  }
  const command = subcommand as SliceTransactionCommand;
  const slugIndex = args.indexOf('--slug');
  const explicitSlug = slugIndex >= 0 ? args[slugIndex + 1] : undefined;

  try {
    const { slug, proposalDir, archived } = resolveIdentity(root, explicitSlug);
    // 归档提案「可读不可写」：拦截在任何动作执行之前，故拒绝路径零副作用。
    if (archived && !READ_ONLY_COMMANDS.has(command)) {
      throw new TestSliceTransactionError('action_not_allowed',
        `提案 ${slug} 已归档：只放行只读动作，${command} 被拒绝（归档后事务可读不可写）`);
    }

    let result: TestSliceTransactionProjection | null;
    if (command === 'status') {
      result = readTestSliceTransactionIfPresent(proposalDir);
    } else if (command === 'submit-content') {
      const slotIndex = args.indexOf('--slot');
      const fileIndex = args.indexOf('--file');
      if (slotIndex < 0 || fileIndex < 0) {
        throw new TestSliceTransactionError('action_not_allowed',
          'submit-content 需要 --slot <id> 与 --file <path>');
      }
      const file = args[fileIndex + 1];
      const contentPath = isAbsolute(file) ? file : resolve(root, file);
      // 首次提交时按需创建 initial-plan 事务，保持与 merge 事务一致的「用即建」体验。
      if (!readTestSliceTransactionIfPresent(proposalDir)) createTestSliceTransaction(root, proposalDir, slug);
      result = submitTestSliceContent(proposalDir, args[slotIndex + 1], contentPath);
    } else if (command === 'seal') {
      result = sealTestSliceTransaction(proposalDir);
    } else if (command === 'apply') {
      result = applyTestSliceTransaction(root, proposalDir);
    } else if (command === 'abort') {
      result = abortTestSliceTransaction(proposalDir);
    } else {
      // recover：failed 且 classification=recovery_required 时把事务退回 sealed 以便重试 apply。
      throw new TestSliceTransactionError('action_not_allowed',
        'recover 暂未开放：apply 失败已整体回滚，请修正 slot 内容后重新提交');
    }
    emit(format, result);
  } catch (error) {
    emitError(format, error);
  }
}
