import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Db = BetterSQLite3Database<typeof schema>;

function readSchemaSql(): string {
  const path = join(__dirname, '../../logos/resources/database/schema.sql');
  return readFileSync(path, 'utf-8');
}

/** Open SQLite and apply DDL from logos/resources/database/schema.sql */
export function createDb(databasePath: string): { raw: Database; db: Db } {
  const raw = new Database(databasePath);
  raw.pragma('foreign_keys = ON');
  raw.exec(readSchemaSql());
  const db = drizzle(raw, { schema });
  return { raw, db };
}

export function defaultDbPath(): string {
  return process.env.TASKFLOW_DB_PATH ?? join(process.cwd(), 'data', 'taskflow.db');
}
