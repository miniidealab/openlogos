/**
 * OpenLogos vitest reporter — writes test results to JSONL
 * following the spec defined in spec/test-results.md.
 *
 * Extracts test case IDs from test names using the pattern:
 *   "UT-S01-01: description" or "ST-S01-01: description"
 */
import type { Reporter, File as VitestFile, TaskResultPack } from 'vitest';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const RESULT_PATH = resolve(
  process.cwd(),
  '..',
  'logos/resources/verify/test-results.jsonl',
);
const ID_RE = /\b(UT|ST)-S\d{2}-\d{2,3}[a-z]?\b/;

export default class OpenLogosReporter implements Reporter {
  onInit() {
    mkdirSync(dirname(RESULT_PATH), { recursive: true });
    writeFileSync(RESULT_PATH, '');
  }

  onTaskUpdate(packs: TaskResultPack[]) {
    for (const [, result, meta] of packs) {
      if (!result || !meta) continue;
    }
  }

  onFinished(files?: VitestFile[]) {
    if (!files) return;
    for (const file of files) {
      this.walkTasks(file.tasks);
    }
  }

  private walkTasks(tasks: readonly any[]) {
    for (const task of tasks) {
      if (task.type === 'suite' && task.tasks) {
        this.walkTasks(task.tasks);
        continue;
      }
      if (task.type !== 'test') continue;

      const match = ID_RE.exec(task.name);
      if (!match) continue;

      const id = match[0];
      const r = task.result;
      let status: 'pass' | 'fail' | 'skip' = 'skip';
      let error: string | undefined;
      let durationMs: number | undefined;

      if (!r || r.state === 'skip') {
        status = 'skip';
      } else if (r.state === 'pass') {
        status = 'pass';
        durationMs = r.duration;
      } else if (r.state === 'fail') {
        status = 'fail';
        durationMs = r.duration;
        if (r.errors?.[0]) {
          error = r.errors[0].message ?? String(r.errors[0]);
        }
      }

      const record: Record<string, unknown> = {
        id,
        status,
        timestamp: new Date().toISOString(),
      };
      if (durationMs !== undefined) record.duration_ms = Math.round(durationMs);
      if (error) record.error = error.slice(0, 500);

      appendFileSync(RESULT_PATH, JSON.stringify(record) + '\n');
    }
  }
}
