import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const RESULT_PATH = resolve(process.cwd(), '../logos/resources/verify/test-results.jsonl');

export function reportResult(id, status, error, durationMs) {
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  const record = {
    id,
    status,
    timestamp: new Date().toISOString(),
  };
  if (durationMs !== undefined) record.duration_ms = durationMs;
  if (error) record.error = String(error).slice(0, 500);
  appendFileSync(RESULT_PATH, `${JSON.stringify(record)}\n`);
}

export async function runReported(id, fn) {
  const start = Date.now();
  try {
    await fn();
    reportResult(id, 'pass', undefined, Date.now() - start);
  } catch (error) {
    reportResult(id, 'fail', error instanceof Error ? error.message : String(error), Date.now() - start);
    throw error;
  }
}
