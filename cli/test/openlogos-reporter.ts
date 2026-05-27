/**
 * OpenLogos vitest reporter — writes test results to JSONL
 * following the spec defined in spec/test-results.md.
 *
 * Extracts test case IDs from test names using patterns such as:
 *   "UT-S01-01: description" or "UT-S01-01 / ST-S01-01: description"
 */
import type { Reporter, File as VitestFile, TaskResultPack } from 'vitest';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const RESULT_PATH = resolve(
  process.cwd(),
  '..',
  'logos/resources/verify/test-results.jsonl',
);
const ID_RE = /\b(?:UT|ST)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*\b/g;

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

      const nameForMatch = typeof task.fullName === 'string' ? task.fullName : task.name;
      const ids = [...new Set([...nameForMatch.matchAll(ID_RE)].map(match => match[0]))];
      if (ids.length === 0) continue;

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

      for (const id of ids) {
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
}
