import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const _pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf-8'));
export const VERSION: string = _pkg.version;

export type OutputFormat = 'text' | 'json';

export function parseFormat(args: string[]): OutputFormat {
  const idx = args.indexOf('--format');
  if (idx !== -1 && args[idx + 1] === 'json') {
    return 'json';
  }
  return 'text';
}

export interface JsonEnvelope {
  command: string;
  version: string;
  timestamp: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}

export function makeEnvelope(command: string, data: unknown): JsonEnvelope {
  return {
    command,
    version: VERSION,
    timestamp: new Date().toISOString(),
    data,
  };
}

/**
 * 通用错误 envelope（spec/cli-json-output.md §6）。`extra` 为个别错误码在 `error` 对象中额外携带的
 * 结构化字段（如 smoke 的 `details`），只做新增、不得覆盖 `code` 与 `message`；不传时输出逐字不变。
 */
export function makeErrorEnvelope(
  command: string, code: string, message: string, extra?: Record<string, unknown>,
): JsonEnvelope {
  return {
    command,
    version: VERSION,
    timestamp: new Date().toISOString(),
    error: { code, message, ...withoutCodeMessage(extra) },
  };
}

function withoutCodeMessage(extra: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!extra) return {};
  return Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'code' && key !== 'message'));
}

/**
 * status/next 失败路径的「瞬态类」稳定错误码集合（fix-merge-flow-transaction-contract）。
 * 宿主据此对可自愈失败做有界恢复；集合增删属合同变更，须走 CLI JSON 合同版本并同步回归快照。
 */
export const TRANSIENT_STATUS_ERROR_CODES = Object.freeze(['baseline_commit_in_progress'] as const);
