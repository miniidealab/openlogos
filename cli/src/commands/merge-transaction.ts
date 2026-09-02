import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { OutputFormat } from '../lib/json-output.js';
import { makeEnvelope, VERSION } from '../lib/json-output.js';
import {
  abortMergeTransaction, applyMergeTransaction, createMergeTransaction, MergeTransactionError,
  MERGE_TRANSACTION_ACTION_COMMANDS, readMergeTransaction, recoverMergeTransaction,
  sealMergeTransaction, submitMergeContent,
  type MergeTransactionProjection,
} from '../lib/merge-transaction.js';

type TransactionCommand = 'status' | 'submit-content' | 'seal' | 'apply' | 'recover' | 'abort';

/** status 之外的动作都会写事务、receipt 或 marker；归档提案只放行只读动作。 */
const READ_ONLY_TRANSACTION_COMMANDS = new Set<TransactionCommand>(['status']);

/**
 * 归档目录按 `<时间戳>-<slug>` 后缀匹配（`openlogos archive` 的命名规则）。
 * 恰好一个命中才算解析成功——多命中是歧义，fail-closed 要求显式消歧，绝不取第一个
 * （与本仓章节锚解析的既有 fail-closed 原则一致）。
 */
function findArchivedProposalDirs(root: string, slug: string): string[] {
  const archiveRoot = join(root, 'logos', 'changes', 'archive');
  if (!existsSync(archiveRoot)) return [];
  try {
    return readdirSync(archiveRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.endsWith(`-${slug}`))
      .map(entry => join(archiveRoot, entry.name))
      .sort();
  } catch {
    return [];
  }
}

/**
 * 提案目录查找的**单点实现**（架构 §三十九.1）。
 *
 * 解析顺序固定、命中即止：
 *   1. `logos/changes/<slug>`                      → 读写皆可（既有行为，零回归）
 *   2. `logos/changes/archive/<时间戳>-<slug>`      → 仅只读动作
 *
 * `archive` 只**移动**事务字节的位置、不销毁它们，因此可寻址性也不应随之消失；
 * 但可读 ≠ 可写：归档的语义是「该变更已终结」，恢复可读是为了审计与重放判据，
 * 不是让终结的东西重新可改写。消费方一律调用本函数，禁止自建第二套目录拼接规则。
 */
function resolveIdentity(
  root: string,
  explicitSlug?: string,
): { slug: string; proposalDir: string; archived: boolean } {
  let slug = explicitSlug;
  if (!slug) {
    try {
      const guard = JSON.parse(readFileSync(join(root, 'logos', '.openlogos-guard'), 'utf8')) as Record<string, unknown>;
      slug = typeof guard.activeChange === 'string' ? guard.activeChange : undefined;
    } catch { /* 统一在下一行报错 */ }
  }
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('缺少或非法的提案 slug');

  const activeDir = join(root, 'logos', 'changes', slug);
  if (existsSync(activeDir)) return { slug, proposalDir: activeDir, archived: false };

  const archived = findArchivedProposalDirs(root, slug);
  if (archived.length === 1) return { slug, proposalDir: archived[0], archived: true };
  if (archived.length > 1) {
    throw new MergeTransactionError(
      'target_set_mismatch',
      `提案 ${slug} 命中多个归档目录，需显式消歧：${archived.map(dir => basename(dir)).join('、')}`,
      false,
    );
  }
  throw new Error(`提案不存在：${slug}`);
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
  const supported = ['status', ...Object.values(MERGE_TRANSACTION_ACTION_COMMANDS)];
  if (!supported.includes(subcommand ?? '')) {
    emitError(format, new Error(`用法：openlogos merge transaction ${supported.join('|')} [--slug <slug>]`));
  }
  const command = subcommand as TransactionCommand;
  const slugIndex = args.indexOf('--slug');
  const explicitSlug = slugIndex >= 0 ? args[slugIndex + 1] : undefined;
  try {
    const { slug, proposalDir, archived } = resolveIdentity(root, explicitSlug);
    // 归档提案「可读不可写」（架构 §三十九.1）：拦截发生在任何动作执行之前，
    // 因此拒绝路径零副作用——事务文件、receipt 与 marker 均不被触碰。
    if (archived && !READ_ONLY_TRANSACTION_COMMANDS.has(command)) {
      // 复用既有 classification：spec 规定「未知 classification 必须 fail-closed」，
      // 故不为此新增枚举值——归档态拒绝写动作正是 action_not_allowed 的语义。
      throw new MergeTransactionError(
        'action_not_allowed',
        `提案 ${slug} 已归档：只放行只读动作，${command} 被拒绝（归档后事务可读不可写）`,
        false,
      );
    }
    let result: MergeTransactionProjection;
    if (command === 'status') result = readMergeTransaction(proposalDir);
    else if (command === 'seal') result = sealMergeTransaction(root, proposalDir);
    else if (command === 'apply') result = applyMergeTransaction(root, proposalDir);
    else if (command === 'recover') result = recoverMergeTransaction(root, proposalDir);
    else if (command === 'abort') result = abortMergeTransaction(proposalDir);
    else {
      const slotIndex = args.indexOf('--slot');
      const fileIndex = args.indexOf('--file');
      const slot = slotIndex >= 0 ? args[slotIndex + 1] : undefined;
      const fileArg = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
      if (!slot || !fileArg) throw new MergeTransactionError('slot_identity_mismatch', 'submit-content 需要 --slot 与 --file', true);
      const file = isAbsolute(fileArg) ? fileArg : resolve(root, fileArg);
      if (!existsSync(file)) throw new MergeTransactionError('slot_identity_mismatch', `content 文件不存在：${fileArg}`, true);
      result = submitMergeContent(proposalDir, slot, file);
    }
    if (result.slug !== slug) throw new MergeTransactionError('target_set_mismatch', 'transaction slug 漂移', false, result);
    emit(format, result);
  } catch (error) { emitError(format, error); }
}

export function beginMergeTransaction(root: string, proposalDir: string, slug: string): MergeTransactionProjection {
  return createMergeTransaction(root, proposalDir, slug);
}
