import { isAbsolute } from 'node:path';
import { MERGE_TRANSACTION_SEMANTIC_SCHEMA } from './merge-transaction-semantic.js';
import { LOCAL_RELEASE_CANDIDATE_VERSION } from './local-release-candidate.js';

export const MERGE_TRANSACTION_CANDIDATE_SCHEMA = 'openlogos/merge-transaction-candidate@1' as const;
export const MERGE_TRANSACTION_CANDIDATE_VERSION = LOCAL_RELEASE_CANDIDATE_VERSION;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

export interface MergeTransactionCandidateFacts {
  schema: typeof MERGE_TRANSACTION_CANDIDATE_SCHEMA;
  command_path: string;
  cli_version: typeof MERGE_TRANSACTION_CANDIDATE_VERSION;
  candidate_tarball_sha256: string;
  merge_transaction_schema_sha256: string;
  status_schema_sha256: string;
  next_schema_sha256: string;
  contract_sha256: string;
  merge_executor_skill_sha256: string;
  merge_transaction_golden_sha256: string;
  semantic_validator: typeof MERGE_TRANSACTION_SEMANTIC_SCHEMA;
}

export interface MergeTransactionCandidateCheck {
  install_ok: boolean;
  self_check_ok: boolean;
  contract_match: boolean;
  behavior_ok: boolean;
}

export interface MergeTransactionCandidateDecision {
  action: 'keep-candidate' | 'restore-previous';
  selected: MergeTransactionCandidateFacts;
}

export interface MergeTransactionRollbackCommand {
  command: 'npm';
  args: string[];
}

const FACT_KEYS = [
  'schema', 'command_path', 'cli_version', 'candidate_tarball_sha256',
  'merge_transaction_schema_sha256', 'status_schema_sha256', 'next_schema_sha256',
  'contract_sha256', 'merge_executor_skill_sha256', 'merge_transaction_golden_sha256',
  'semantic_validator',
] as const;

function assertHash(value: string, field: string): void {
  if (!SHA256_PATTERN.test(value)) throw new Error(`candidate_fact_invalid:${field}`);
}

/**
 * 冻结可交给 RunLogos 的最小公共事实；私有事务文件、包根目录和提交集不属于交接面。
 */
export function freezeMergeTransactionCandidateFacts(input: MergeTransactionCandidateFacts): MergeTransactionCandidateFacts {
  const keys = Object.keys(input).sort();
  const expected = [...FACT_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) throw new Error('candidate_fact_invalid:fields');
  if (input.schema !== MERGE_TRANSACTION_CANDIDATE_SCHEMA) throw new Error('candidate_fact_invalid:schema');
  if (!isAbsolute(input.command_path)) throw new Error('candidate_fact_invalid:command_path');
  if (input.cli_version !== MERGE_TRANSACTION_CANDIDATE_VERSION) throw new Error('candidate_fact_invalid:cli_version');
  if (input.semantic_validator !== MERGE_TRANSACTION_SEMANTIC_SCHEMA) throw new Error('candidate_fact_invalid:semantic_validator');
  for (const field of [
    'candidate_tarball_sha256', 'merge_transaction_schema_sha256', 'status_schema_sha256',
    'next_schema_sha256', 'contract_sha256', 'merge_executor_skill_sha256',
    'merge_transaction_golden_sha256',
  ] as const) assertHash(input[field], field);
  return Object.freeze({ ...input });
}

/** 部署记录与跨仓 handoff 共用的 fail-closed 对账入口。 */
export function assertMergeTransactionCandidateMatch(
  expected: MergeTransactionCandidateFacts,
  actual: MergeTransactionCandidateFacts,
  invalidatedHashes: readonly string[] = [],
): void {
  const frozenExpected = freezeMergeTransactionCandidateFacts(expected);
  const frozenActual = freezeMergeTransactionCandidateFacts(actual);
  const invalidated = new Set(invalidatedHashes);
  for (const field of [
    'candidate_tarball_sha256', 'merge_transaction_schema_sha256', 'status_schema_sha256',
    'next_schema_sha256', 'contract_sha256', 'merge_executor_skill_sha256',
    'merge_transaction_golden_sha256',
  ] as const) {
    if (invalidated.has(frozenActual[field])) throw new Error(`candidate_hash_invalidated:${field}`);
  }
  for (const field of FACT_KEYS) {
    if (frozenExpected[field] !== frozenActual[field]) throw new Error(`candidate_fact_mismatch:${field}`);
  }
}

/** 任一安装、自检或合同对账失败，选择结果只能完整回到部署前事实。 */
export function decideMergeTransactionCandidate(
  previous: MergeTransactionCandidateFacts,
  candidate: MergeTransactionCandidateFacts,
  check: MergeTransactionCandidateCheck,
): MergeTransactionCandidateDecision {
  const frozenPrevious = freezeMergeTransactionCandidateFacts(previous);
  const frozenCandidate = freezeMergeTransactionCandidateFacts(candidate);
  if (check.install_ok && check.self_check_ok && check.contract_match && check.behavior_ok) {
    return { action: 'keep-candidate', selected: frozenCandidate };
  }
  return { action: 'restore-previous', selected: frozenPrevious };
}

/**
 * 同版本 tarball 直接覆盖会保留新版独有文件；回滚必须先卸载整个包目录，再安装冻结制品。
 */
export function buildMergeTransactionRollbackCommands(prefix: string, rollbackTarball: string): MergeTransactionRollbackCommand[] {
  if (!isAbsolute(prefix)) throw new Error('candidate_rollback_invalid:prefix');
  if (!isAbsolute(rollbackTarball)) throw new Error('candidate_rollback_invalid:tarball');
  return [
    { command: 'npm', args: ['uninstall', '--prefix', prefix, '--ignore-scripts', '@miniidealab/openlogos'] },
    { command: 'npm', args: ['install', '--prefix', prefix, '--force', '--ignore-scripts', '--no-audit', '--no-fund', rollbackTarball] },
  ];
}

/** 回滚后逐字段核对，防止旧入口与新资产混装。 */
export function assertMergeTransactionCandidateRestored(
  previous: MergeTransactionCandidateFacts,
  observed: MergeTransactionCandidateFacts,
): void {
  try {
    assertMergeTransactionCandidateMatch(previous, observed);
  } catch {
    throw new Error('candidate_rollback_mixed_assets');
  }
}
