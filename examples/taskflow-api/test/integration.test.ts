import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { Database } from 'better-sqlite3';
import { createApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { withReport } from './report.js';

describe('TaskFlow API', () => {
  let raw: Database;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    const { raw: sqlite, db } = createDb(':memory:');
    raw = sqlite;
    app = createApp(db);
  });

  afterEach(() => {
    raw.exec('DELETE FROM tasks; DELETE FROM users;');
  });

  describe('S01 auth', () => {
    it('UT-S01-01 register returns 201 with token', async () => {
      await withReport('UT-S01-01', 'S01', async () => {
        const res = await app.request('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'u1@example.com', password: 'password12' }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as { user: { id: number; email: string }; token: string };
        expect(body.user.email).toBe('u1@example.com');
        expect(body.token.length).toBeGreaterThan(10);
      });
    });

    it('UT-S01-02 duplicate email returns 409', async () => {
      await withReport('UT-S01-02', 'S01', async () => {
        await app.request('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'dup@example.com', password: 'password12' }),
        });
        const res = await app.request('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'dup@example.com', password: 'password12' }),
        });
        expect(res.status).toBe(409);
      });
    });

    it('UT-S01-03 login success', async () => {
      await withReport('UT-S01-03', 'S01', async () => {
        await app.request('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'login@example.com', password: 'password12' }),
        });
        const res = await app.request('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'login@example.com', password: 'password12' }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { token: string };
        expect(body.token).toBeDefined();
      });
    });

    it('UT-S01-04 login wrong password returns 401', async () => {
      await withReport('UT-S01-04', 'S01', async () => {
        await app.request('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'bad@example.com', password: 'password12' }),
        });
        const res = await app.request('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'bad@example.com', password: 'wrongpass' }),
        });
        expect(res.status).toBe(401);
      });
    });

    it('ST-S01-01 register then login', async () => {
      await withReport('ST-S01-01', 'S01', async () => {
        const r1 = await app.request('/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'flow@example.com', password: 'password12' }),
        });
        expect(r1.status).toBe(201);
        const r2 = await app.request('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'flow@example.com', password: 'password12' }),
        });
        expect(r2.status).toBe(200);
      });
    });
  });

  describe('S02 tasks', () => {
    async function tokenFor(email: string): Promise<string> {
      const r = await app.request('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password12' }),
      });
      const body = (await r.json()) as { token: string };
      return body.token;
    }

    it('UT-S02-02 list tasks empty for new user', async () => {
      await withReport('UT-S02-02', 'S02', async () => {
        const token = await tokenFor('empty@example.com');
        const res = await app.request('/tasks', {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { tasks: unknown[] };
        expect(body.tasks).toEqual([]);
      });
    });

    it('UT-S02-01 create task', async () => {
      await withReport('UT-S02-01', 'S02', async () => {
        const token = await tokenFor('t1@example.com');
        const res = await app.request('/tasks', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'First task' }),
        });
        expect(res.status).toBe(201);
        const body = (await res.json()) as { title: string; status: string };
        expect(body.title).toBe('First task');
        expect(body.status).toBe('pending');
      });
    });

    it('UT-S02-03 get task by id', async () => {
      await withReport('UT-S02-03', 'S02', async () => {
        const token = await tokenFor('t3@example.com');
        const c = await app.request('/tasks', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Get me' }),
        });
        const created = (await c.json()) as { id: number };
        const res = await app.request(`/tasks/${created.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { id: number; title: string };
        expect(body.title).toBe('Get me');
      });
    });

    it('UT-S02-04 patch task', async () => {
      await withReport('UT-S02-04', 'S02', async () => {
        const token = await tokenFor('t4@example.com');
        const c = await app.request('/tasks', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Patch me' }),
        });
        const created = (await c.json()) as { id: number };
        const res = await app.request(`/tasks/${created.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: 'done', title: 'Done task' }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string; title: string };
        expect(body.status).toBe('done');
        expect(body.title).toBe('Done task');
      });
    });

    it('UT-S02-05 delete task', async () => {
      await withReport('UT-S02-05', 'S02', async () => {
        const token = await tokenFor('t5@example.com');
        const c = await app.request('/tasks', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Delete me' }),
        });
        const created = (await c.json()) as { id: number };
        const res = await app.request(`/tasks/${created.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(204);
        const g = await app.request(`/tasks/${created.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(g.status).toBe(404);
      });
    });

    it('ST-S02-01 full CRUD flow', async () => {
      await withReport('ST-S02-01', 'S02', async () => {
        const token = await tokenFor('crud@example.com');
        const c1 = await app.request('/tasks', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'CRUD' }),
        });
        expect(c1.status).toBe(201);
        const task = (await c1.json()) as { id: number };
        const list = await app.request('/tasks', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const { tasks } = (await list.json()) as { tasks: { id: number }[] };
        expect(tasks.some((t) => t.id === task.id)).toBe(true);
        const del = await app.request(`/tasks/${task.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(del.status).toBe(204);
      });
    });
  });
});
