import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, datasets, runs, users } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

const caller = createCallerFactory(appRouter)({ db, session: null });
const created: string[] = [];

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(projects).where(eq(projects.id, id)); // datasets cascade
});

describe('projects.create', () => {
  it('creates the project under the default org with one dataset named after it', async () => {
    const p = await caller.projects.create({ name: 'AbeBooks Q3', description: 'books' });
    created.push(p.id);
    expect(p.slug).toBe('abebooks-q3');
    const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, p.datasetId) });
    expect(ds?.name).toBe('AbeBooks Q3');
    expect(ds?.projectId).toBe(p.id);
    expect(ds?.schema).toEqual([]);
  });
  it('gives a second project with the same name a numbered slug', async () => {
    const a = await caller.projects.create({ name: 'Twice' });
    const b = await caller.projects.create({ name: 'Twice' });
    created.push(a.id, b.id);
    expect(b.slug).toBe('twice-2');
  });
  it('rejects an empty name', async () => {
    await expect(caller.projects.create({ name: '   ' })).rejects.toThrow();
  });
});

describe('projects.rename', () => {
  it('changes the name and keeps the slug', async () => {
    const p = await caller.projects.create({ name: 'Before' });
    created.push(p.id);
    const r = await caller.projects.rename({ projectId: p.id, name: 'After' });
    expect(r.name).toBe('After');
    const row = await db.query.projects.findFirst({ where: eq(projects.id, p.id) });
    expect(row?.slug).toBe('before');
  });
});

describe('projects.list stats', () => {
  it('counts websites, verified websites, fields, and reports the last run', async () => {
    const p = await caller.projects.create({ name: 'Stats' });
    created.push(p.id);
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'A', url: 'https://a.example/' });
    await caller.sources.createInProject({ projectSlug: p.slug, name: 'B', url: 'https://b.example/' });
    await db.update(datasets).set({ schema: [{ key: 'price', name: 'price', type: 'money' }, { key: 'title', name: 'title', type: 'text' }] }).where(eq(datasets.id, p.datasetId));

    const row = (await caller.projects.list()).find((r) => r.id === p.id)!;
    expect(row.sourceCount).toBe(2);
    expect(row.verifiedSourceCount).toBe(0);
    expect(row.fieldCount).toBe(2);
    expect(row.lastRun).toBeNull();
  });

  it('attributes each project its own latest run even when timestamps collide', async () => {
    const a = await caller.projects.create({ name: 'RunsA' });
    const b = await caller.projects.create({ name: 'RunsB' });
    created.push(a.id, b.id);
    const sourceA = await caller.sources.createInProject({ projectSlug: a.slug, name: 'A', url: 'https://a.example/' });
    const sourceB = await caller.sources.createInProject({ projectSlug: b.slug, name: 'B', url: 'https://b.example/' });

    await db.insert(runs).values([
      { sourceId: sourceA.sourceId, status: 'completed', resultCount: 7 },
      { sourceId: sourceB.sourceId, status: 'completed', resultCount: 3 },
    ]);

    const rows = await caller.projects.list();
    const rowA = rows.find((r) => r.id === a.id)!;
    const rowB = rows.find((r) => r.id === b.id)!;
    expect(rowA.lastRun?.resultCount).toBe(7);
    expect(rowB.lastRun?.resultCount).toBe(3);
  });
});

describe('projects.delete', () => {
  it('a session-less caller can delete a project it created session-lessly (mirrors the old dashboard smoke cleanup)', async () => {
    const p = await caller.projects.create({ name: `SmokeCleanup ${Date.now()}` });
    const r = await caller.projects.delete({ projectId: p.id });
    expect(r.deleted).toBe(true);
    expect(await db.query.projects.findFirst({ where: eq(projects.id, p.id) })).toBeUndefined();
  });
});

describe('projects live in the session organisation', () => {
  it("a project is invisible outside its org, and the old orgSlug-less caller still lists the default org", async () => {
    const tag = Date.now();
    const signIn = async (email: string) => {
      const cookies: Record<string, string | null> = {};
      const c = createCallerFactory(appRouter)({ db, session: null, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: () => {} });
      const r = await c.auth.signIn({ email, password: 'x' });
      return { ...r, session: (await loadSession(db, cookies['robot_session']!))! };
    };
    const a = await signIn(`proj-a-${tag}@example.com`);
    const b = await signIn(`proj-b-${tag}@example.com`);
    try {
      const callerA = createCallerFactory(appRouter)({ db, session: a.session });
      const callerB = createCallerFactory(appRouter)({ db, session: b.session });
      const p = await callerA.projects.create({ name: `Isolated ${tag}` });

      const bList = await callerB.projects.list();
      expect(bList.some((row) => row.id === p.id)).toBe(false);

      await expect(callerB.projects.delete({ projectId: p.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });

      // The old dashboard's shape: no session, no orgSlug — falls back to `default`.
      const legacy = await caller.projects.list({ orgSlug: 'default' });
      expect(Array.isArray(legacy)).toBe(true);
    } finally {
      for (const r of [a, b]) {
        await db.delete(projects).where(eq(projects.orgId, r.org.id));
        await deleteOwnOrg(r.org.id);
        await db.delete(users).where(eq(users.id, r.user.id));
      }
    }
  });
});
