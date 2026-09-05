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

export function makeErrorEnvelope(command: string, code: string, message: string): JsonEnvelope {
  return {
    command,
    version: VERSION,
    timestamp: new Date().toISOString(),
    error: { code, message },
  };
}

/**
 * status/next 失败路径的「瞬态类」稳定错误码集合（fix-merge-flow-transaction-contract）。
 * 宿主据此对可自愈失败做有界恢复；集合增删属合同变更，须走 CLI JSON 合同版本并同步回归快照。
 */
export const TRANSIENT_STATUS_ERROR_CODES = Object.freeze(['baseline_commit_in_progress'] as const);
