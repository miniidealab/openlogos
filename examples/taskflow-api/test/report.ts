import { appendFileSync } from 'node:fs';
import { join } from 'node:path';

const RESULT_PATH = join(process.cwd(), 'logos/resources/verify/test-results.jsonl');

export type CaseStatus = 'pass' | 'fail' | 'skip';

export function reportResult(
  id: string,
  status: CaseStatus,
  opts?: { error?: string; duration_ms?: number; scenario?: string },
): void {
  const line =
    JSON.stringify({
      id,
      status,
      duration_ms: opts?.duration_ms ?? 0,
      timestamp: new Date().toISOString(),
      ...(opts?.error ? { error: opts.error } : {}),
      ...(opts?.scenario ? { scenario: opts.scenario } : {}),
    }) + '\n';
  appendFileSync(RESULT_PATH, line, 'utf-8');
}

export async function withReport<T>(
  id: string,
  scenario: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    reportResult(id, 'pass', { duration_ms: Date.now() - t0, scenario });
    return out;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    reportResult(id, 'fail', { error: err, duration_ms: Date.now() - t0, scenario });
    throw e;
  }
}
