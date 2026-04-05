import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { eq, and } from 'drizzle-orm';
import type { Db } from './db/client.js';
import * as schema from './db/schema.js';
import { hashPassword, verifyPassword } from './lib/password.js';
import { signToken, verifyToken } from './lib/jwt.js';

export type AppVariables = { userId: number };

export function createApp(db: Db) {
  const app = new Hono<{ Variables: AppVariables }>();

  app.use('/*', cors());

  app.post('/auth/register', async (c) => {
    let body: { email?: string; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!email || !password) {
      return c.json({ error: 'email and password are required' }, 400);
    }
    if (password.length < 8) {
      return c.json({ error: 'password must be at least 8 characters' }, 400);
    }

    const passwordHash = await hashPassword(password);
    const createdAt = new Date();
    try {
      const [row] = await db
        .insert(schema.users)
        .values({ email, passwordHash, createdAt })
        .returning({ id: schema.users.id, email: schema.users.email });
      const token = await signToken(row.id, row.email);
      return c.json({ user: { id: row.id, email: row.email }, token }, 201);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/unique|UNIQUE constraint/i.test(msg)) {
        return c.json({ error: 'email already registered' }, 409);
      }
      throw e;
    }
  });

  app.post('/auth/login', async (c) => {
    let body: { email?: string; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!email || !password) {
      return c.json({ error: 'email and password are required' }, 400);
    }

    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!user) {
      return c.json({ error: 'invalid credentials' }, 401);
    }
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return c.json({ error: 'invalid credentials' }, 401);
    }
    const token = await signToken(user.id, user.email);
    return c.json({ user: { id: user.id, email: user.email }, token });
  });

  const tasks = new Hono<{ Variables: AppVariables }>();

  tasks.use('/*', async (c, next) => {
    const h = c.req.header('Authorization');
    if (!h?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    try {
      const payload = await verifyToken(h.slice(7));
      c.set('userId', Number(payload.sub));
      await next();
    } catch {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  });

  tasks.post('/', async (c) => {
    let body: { title?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    const title = body.title?.trim();
    if (!title) {
      return c.json({ error: 'title is required' }, 400);
    }
    const userId = c.get('userId');
    const createdAt = new Date();
    const [row] = await db
      .insert(schema.tasks)
      .values({ userId, title, status: 'pending', createdAt })
      .returning();
    return c.json(taskDto(row), 201);
  });

  tasks.get('/', async (c) => {
    const userId = c.get('userId');
    const rows = await db.select().from(schema.tasks).where(eq(schema.tasks.userId, userId));
    return c.json({ tasks: rows.map(taskDto) });
  });

  tasks.get('/:id', async (c) => {
    const userId = c.get('userId');
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const [row] = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .limit(1);
    if (!row) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.json(taskDto(row));
  });

  tasks.patch('/:id', async (c) => {
    const userId = c.get('userId');
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: 'invalid id' }, 400);
    }
    let body: { title?: string; status?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400);
    }
    const updates: Partial<{ title: string; status: 'pending' | 'done' }> = {};
    if (body.title !== undefined) {
      const t = body.title.trim();
      if (!t) return c.json({ error: 'title cannot be empty' }, 400);
      updates.title = t;
    }
    if (body.status !== undefined) {
      if (body.status !== 'pending' && body.status !== 'done') {
        return c.json({ error: 'status must be pending or done' }, 400);
      }
      updates.status = body.status;
    }
    if (Object.keys(updates).length === 0) {
      return c.json({ error: 'no valid fields to update' }, 400);
    }

    const [existing] = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: 'Not found' }, 404);
    }

    const [row] = await db
      .update(schema.tasks)
      .set(updates)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .returning();
    return c.json(taskDto(row!));
  });

  tasks.delete('/:id', async (c) => {
    const userId = c.get('userId');
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const result = await db
      .delete(schema.tasks)
      .where(and(eq(schema.tasks.id, id), eq(schema.tasks.userId, userId)))
      .returning({ id: schema.tasks.id });
    if (result.length === 0) {
      return c.json({ error: 'Not found' }, 404);
    }
    return c.body(null, 204);
  });

  app.route('/tasks', tasks);

  return app;
}

function taskDto(row: typeof schema.tasks.$inferSelect) {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}
