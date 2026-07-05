/**
 * OpenLogos vitest reporter — writes test results to JSONL
 * following the spec defined in spec/test-results.md.
 *
 * Extracts test case IDs from test names using patterns such as:
 *   "UT-S01-01: description" or "UT-S01-01 / ST-S01-01: description"
 */
import type { Reporter, File as VitestFile, TaskResultPack } from 'vitest';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const RESULT_PATH = resolve(
  process.cwd(),
  '..',
  'logos/resources/verify/test-results.jsonl',
);
const TEST_CASES_DIR = resolve(process.cwd(), '..', 'logos/resources/test');
const ID_RE = /\b(?:UT|ST)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*\b/g;
const MANUAL_SUFFIX = /\[manual\]/i;
const TABLE_CELL_ID_PATTERN = /^\s*(?:UT|ST)-[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)*(?:\s*\[manual\])?\s*$/i;

function loadDefinedIds(): Set<string> {
  const ids = new Set<string>();
  const manualIds = new Set<string>();
  if (!existsSync(TEST_CASES_DIR)) return ids;

  const files = readdirSync(TEST_CASES_DIR, { recursive: true })
    .map(file => String(file))
    .filter(file => file.endsWith('-test-cases.md'));

  for (const file of files) {
    const content = readFileSync(join(TEST_CASES_DIR, file), 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim().startsWith('|')) continue;

      const cells = line.split('|').map(cell => cell.trim());
      const firstCell = cells[1] ?? '';
      if (!TABLE_CELL_ID_PATTERN.test(firstCell)) continue;

      const id = firstCell.replace(MANUAL_SUFFIX, '').replace(/\s+/g, ' ').trim();
      const isManual = MANUAL_SUFFIX.test(firstCell) || MANUAL_SUFFIX.test(line);
      if (isManual) {
        manualIds.add(id);
        ids.delete(id);
        continue;
      }

      if (!manualIds.has(id)) ids.add(id);
    }
  }

  return ids;
}

export default class OpenLogosReporter implements Reporter {
  private definedIds = new Set<string>();

  onInit() {
    this.definedIds = loadDefinedIds();
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
      const ids = [...new Set([...nameForMatch.matchAll(ID_RE)].map(match => match[0]))]
        .filter(id => this.definedIds.has(id));
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
