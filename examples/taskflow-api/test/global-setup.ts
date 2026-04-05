import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const RESULT = join(process.cwd(), 'logos/resources/verify/test-results.jsonl');

export default function setup() {
  process.env.TASKFLOW_JWT_SECRET = 'test-secret-taskflow';
  mkdirSync(dirname(RESULT), { recursive: true });
  writeFileSync(RESULT, '', 'utf-8');
}
