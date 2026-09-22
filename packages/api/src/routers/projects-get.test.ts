import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, users, runs } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

const tag = `get-${Date.now()}`;

async function signIn(email: string) {
  const cookies: Record<string, string | null> = {};
  const c = createCallerFactory(appRouter)({ db, session: null, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: () => {} });
  const r = await c.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  return { ...r, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

async function dropIdentity(r: { org: { id: string }; user: { id: string } }) {
  await db.delete(projects).where(eq(projects.orgId, r.org.id));
  await deleteOwnOrg(r.org.id);
  await db.delete(users).where(eq(users.id, r.user.id));
}

describe('projects.get', () => {
  it('returns the project, its fields and its websites with verified counts and last run, in the session org', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-a@example.com`);
      const p = await a.caller.projects.create({ name: 'Acme prices' });
      await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Zed shop', url: 'https://zed.example.com/x' });
      await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha shop', url: 'https://alpha.example.com/x' });
      await db.insert(runs).values({ sourceId: w.sourceId, status: 'completed', completedAt: new Date(), resultCount: 3 });

      const got = await a.caller.projects.get({ projectSlug: p.slug });
      expect(got.id).toBe(p.id);
      expect(got.datasetId).toBe(p.datasetId);
      expect(got.fields.map((f) => f.name)).toEqual(['Price', 'Title']);
      expect(got.websites.map((s) => s.name)).toEqual(['Alpha shop', 'Zed shop']);
      const zed = got.websites.find((s) => s.id === w.sourceId)!;
      expect(zed.url).toBe('https://zed.example.com/x');
      expect(zed.verifiedFields).toBe(0);
      expect(zed.lastRun?.status).toBe('completed');
      expect(zed.lastRun?.resultCount).toBe(3);
      expect(got.websites.find((s) => s.name === 'Alpha shop')!.lastRun).toBeNull();
    } finally {
      if (a) await dropIdentity(a);
    }
  });

  it('is NOT_FOUND for a project in another org, even with the right slug', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-b1@example.com`);
      b = await signIn(`${tag}-b2@example.com`);
      const p = await a.caller.projects.create({ name: 'Private' });
      await expect(b.caller.projects.get({ projectSlug: p.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(b.caller.projects.getWithStats({ projectSlug: p.slug })).resolves.toBeNull();
      await expect(b.caller.sources.listByProject({ projectSlug: p.slug })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(b.caller.sources.createInProject({ projectSlug: p.slug, name: 'X', url: 'https://x.example.com/' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('still answers a session-less caller that names the org, the way the old dashboard does', async () => {
    const bare = createCallerFactory(appRouter)({ db, session: null });
    const p = await bare.projects.create({ name: `Shim ${tag}` });
    try {
      const got = await bare.projects.get({ projectSlug: p.slug, orgSlug: 'default' });
      expect(got.id).toBe(p.id);
      const stats = await bare.projects.getWithStats({ orgSlug: 'default', projectSlug: p.slug });
      expect(stats?.project.id).toBe(p.id);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });
});
