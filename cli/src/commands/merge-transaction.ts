import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import type { OutputFormat } from '../lib/json-output.js';
import { makeEnvelope, VERSION } from '../lib/json-output.js';
import {
  applyMergeTransaction, createMergeTransaction, MergeTransactionError,
  readMergeTransaction, recoverMergeTransaction, sealMergeTransaction, submitMergeContent,
  type MergeTransactionProjection,
} from '../lib/merge-transaction.js';

type TransactionCommand = 'status' | 'submit-content' | 'seal' | 'apply' | 'recover';

function resolveIdentity(root: string, explicitSlug?: string): { slug: string; proposalDir: string } {
  let slug = explicitSlug;
  if (!slug) {
    try {
      const guard = JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf8')) as Record<string, unknown>;
      slug = typeof guard.activeChange === 'string' ? guard.activeChange : undefined;
    } catch { /* 统一在下一行报错 */ }
  }
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('缺少或非法的提案 slug');
  const proposalDir = join(root, 'logos', 'changes', slug);
  if (!existsSync(proposalDir)) throw new Error(`提案不存在：${slug}`);
  return { slug, proposalDir };
}

function emit(format: OutputFormat, projection: MergeTransactionProjection): void {
  if (format === 'json') console.log(JSON.stringify(makeEnvelope('merge transaction', { merge_transaction: projection })));
  else {
    console.log(`✓ merge transaction ${projection.transaction_id}`);
    console.log(`  phase: ${projection.phase}`);
    console.log(`  next_action: ${projection.next_action ?? '<none>'}`);
    console.log(`  content: ${projection.content_slots.submitted}/${projection.content_slots.required}`);
  }
}

function emitError(format: OutputFormat, error: unknown): never {
  const txError = error instanceof MergeTransactionError ? error : null;
  const message = error instanceof Error ? error.message : String(error);
  if (format === 'json') {
    console.error(JSON.stringify({
      command: 'merge transaction', version: VERSION, timestamp: new Date().toISOString(),
      error: {
        code: txError?.classification ?? 'internal_failure', message,
        details: {
          transaction_id: txError?.transaction?.transaction_id ?? null,
          phase: txError?.transaction?.phase ?? null,
          classification: txError?.classification ?? 'internal_failure',
          allowed_actions: txError?.transaction?.allowed_actions ?? [],
          next_action: txError?.transaction?.next_action ?? null,
          retryable: txError?.retryable ?? false,
        },
      },
    }));
  } else console.error(`Error: merge transaction 失败（${txError?.classification ?? 'internal_failure'}）：${message}`);
  process.exit(1);
  throw new Error('unreachable');
}

export function mergeTransactionCommand(
  subcommand: string | undefined,
  args: string[],
  format: OutputFormat,
): void {
  const root = process.cwd();
  if (!existsSync(join(root, 'logos', 'logos.config.json'))) emitError(format, new Error('logos/logos.config.json 不存在'));
  if (!['status', 'submit-content', 'seal', 'apply', 'recover'].includes(subcommand ?? '')) {
    emitError(format, new Error('用法：openlogos merge transaction status|submit-content|seal|apply|recover [--slug <slug>]'));
  }
  const command = subcommand as TransactionCommand;
  const slugIndex = args.indexOf('--slug');
  const explicitSlug = slugIndex >= 0 ? args[slugIndex + 1] : undefined;
  try {
    const { slug, proposalDir } = resolveIdentity(root, explicitSlug);
    let result: MergeTransactionProjection;
    if (command === 'status') result = readMergeTransaction(proposalDir);
    else if (command === 'seal') result = sealMergeTransaction(root, proposalDir);
    else if (command === 'apply') result = applyMergeTransaction(root, proposalDir);
    else if (command === 'recover') result = recoverMergeTransaction(root, proposalDir);
    else {
      const slotIndex = args.indexOf('--slot');
      const fileIndex = args.indexOf('--file');
      const slot = slotIndex >= 0 ? args[slotIndex + 1] : undefined;
      const fileArg = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
      if (!slot || !fileArg) throw new MergeTransactionError('slot_identity_mismatch', 'submit-content 需要 --slot 与 --file', true);
      const file = isAbsolute(fileArg) ? fileArg : resolve(root, fileArg);
      if (!existsSync(file)) throw new MergeTransactionError('slot_identity_mismatch', `content 文件不存在：${fileArg}`, true);
      result = submitMergeContent(proposalDir, slot, readFileSync(file));
    }
    if (result.slug !== slug) throw new MergeTransactionError('target_set_mismatch', 'transaction slug 漂移', false, result);
    emit(format, result);
  } catch (error) { emitError(format, error); }
}

export function beginMergeTransaction(root: string, proposalDir: string, slug: string): MergeTransactionProjection {
  return createMergeTransaction(root, proposalDir, slug);
}
