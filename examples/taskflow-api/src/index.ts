import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDb, defaultDbPath } from './db/client.js';

const path = defaultDbPath();
if (!existsSync(dirname(path))) {
  mkdirSync(dirname(path), { recursive: true });
}

const { db, raw } = createDb(path);
const app = createApp(db);

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`TaskFlow API listening on http://localhost:${info.port}`);
});

function shutdown() {
  raw.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
