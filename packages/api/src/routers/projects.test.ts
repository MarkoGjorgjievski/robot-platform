import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, datasets, runs } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { signIn, signedInCaller } from '../test-helpers/identity.js';

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('projects');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });
const created: string[] = [];

/** Everything this file created for a throwaway identity. Never touches org `default`. */
const dropIdentity = (r: { cleanup: () => Promise<void> }) => r.cleanup();

afterEach(async () => {
  for (const id of created.splice(0)) await db.delete(projects).where(eq(projects.id, id)); // datasets cascade
});

describe('projects.create', () => {
  it('creates the project in the session org with one dataset named after it', async () => {
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
  it('deletes a project of the session org', async () => {
    const p = await caller.projects.create({ name: `SmokeCleanup ${Date.now()}` });
    try {
      const r = await caller.projects.delete({ projectId: p.id });
      expect(r.deleted).toBe(true);
      expect(await db.query.projects.findFirst({ where: eq(projects.id, p.id) })).toBeUndefined();
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });
});

// Cut-over: the old dashboard's `orgSlug` shim and its `'default'` fallback
// are gone. A session-less caller is UNAUTHORIZED on every procedure, whatever
// it sends — never the seeded `default` org's data, nor any other org's
// (Review Focus 4; final review C1).
describe('no session, no projects (Review Focus 4)', () => {
  it('a session-less call is UNAUTHORIZED for list/get/output/create/rename/delete, even naming an org that exists', async () => {
    const bare = createCallerFactory(appRouter)({ db, session: null });
    const p = await caller.projects.create({ name: `Guarded ${Date.now()}` });
    created.push(p.id);
    const unauth = { code: 'UNAUTHORIZED' };
    // No input takes an `orgSlug` any more; one sent over HTTP is stripped by zod, never honoured.
    const named = { orgSlug: me.session.org.slug };
    await expect(bare.projects.list()).rejects.toMatchObject(unauth);
    await expect(bare.projects.list(named as never)).rejects.toMatchObject(unauth);
    await expect(bare.projects.get({ projectSlug: p.slug, ...named } as never)).rejects.toMatchObject(unauth);
    await expect(bare.projects.output({ projectSlug: p.slug })).rejects.toMatchObject(unauth);
    await expect(bare.projects.create({ name: 'No session', ...named } as never)).rejects.toMatchObject(unauth);
    await expect(bare.projects.rename({ projectId: p.id, name: 'X' })).rejects.toMatchObject(unauth);
    await expect(bare.projects.delete({ projectId: p.id })).rejects.toMatchObject(unauth);
    expect((await db.query.projects.findFirst({ where: eq(projects.id, p.id) }))?.name).toBe(p.name);
  });
});

describe('projects live in the session organisation', () => {
  it('a project is invisible outside its org: list, get, output and delete', async () => {
    const tag = Date.now();
    const a = await signIn(`proj-a-${tag}@example.com`);
    const b = await signIn(`proj-b-${tag}@example.com`);
    try {
      const callerA = createCallerFactory(appRouter)({ db, session: a.session });
      const callerB = createCallerFactory(appRouter)({ db, session: b.session });
      const p = await callerA.projects.create({ name: `Isolated ${tag}` });

      const bList = await callerB.projects.list();
      expect(bList.some((row) => row.id === p.id)).toBe(false);
      expect((await callerA.projects.list()).some((row) => row.id === p.id)).toBe(true);

      await expect(callerB.projects.get({ projectSlug: p.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(callerB.projects.output({ projectSlug: p.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(callerB.projects.delete({ projectId: p.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(await db.query.projects.findFirst({ where: eq(projects.id, p.id) })).toBeDefined();
    } finally {
      for (const r of [a, b]) await dropIdentity(r);
    }
  });

  // `rename` is the other write in the set, and until this branch it took a
  // bare `projectId` and updated it with no org check in either direction.
  it('a project in another org is NOT_FOUND on rename, and keeps its name', async () => {
    const tag = Date.now();
    const a = await signIn(`rename-a-${tag}@example.com`);
    const b = await signIn(`rename-b-${tag}@example.com`);
    try {
      const callerA = createCallerFactory(appRouter)({ db, session: a.session });
      const callerB = createCallerFactory(appRouter)({ db, session: b.session });
      const p = await callerA.projects.create({ name: `Not Yours ${tag}` });

      await expect(callerB.projects.rename({ projectId: p.id, name: 'Mine now' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect((await db.query.projects.findFirst({ where: eq(projects.id, p.id) }))?.name).toBe(`Not Yours ${tag}`);

      // The owner still renames it, so the guard has not simply closed the door.
      expect((await callerA.projects.rename({ projectId: p.id, name: `Renamed ${tag}` })).name).toBe(`Renamed ${tag}`);
    } finally {
      for (const r of [a, b]) await dropIdentity(r);
    }
  });
});
