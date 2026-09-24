import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, users, runs, captures, sourceVerifications, memberships } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

const tag = `orgscr-${Date.now()}`;

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

/** A fresh caller on the same token, after something changed the session row. */
async function reload(r: Awaited<ReturnType<typeof signIn>>) {
  const session = (await loadSession(db, r.session.token))!;
  return { session, caller: createCallerFactory(appRouter)({ db, session }) };
}

const AUG = new Date('2026-08-15T12:00:00Z');
const SEP = new Date('2026-09-10T12:00:00Z');

describe('runs.listByOrg', () => {
  it('lists every run in the session org newest first, with its project and website, and nothing from another org', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-r1@example.com`);
      b = await signIn(`${tag}-r2@example.com`);
      const p = await a.caller.projects.create({ name: 'Prices' });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: 'https://shop.example.com/x' });
      const q = await b.caller.projects.create({ name: 'Elsewhere' });
      const v = await b.caller.sources.createInProject({ projectSlug: q.slug, name: 'Other', url: 'https://other.example.com/x' });
      await db.insert(runs).values([
        { sourceId: w.sourceId, status: 'completed', startedAt: AUG, completedAt: AUG, resultCount: 3, createdAt: AUG, costUsd: '0.0200' },
        { sourceId: w.sourceId, status: 'extracting', startedAt: SEP, createdAt: SEP },
        { sourceId: v.sourceId, status: 'completed', completedAt: SEP, createdAt: SEP },
      ]);

      const got = await a.caller.runs.listByOrg();
      expect(got.map((r) => r.status)).toEqual(['extracting', 'completed']);
      expect(got[1]).toMatchObject({ resultCount: 3, costUsd: 0.02, project: { name: 'Prices', slug: p.slug }, website: { name: 'Shop', slug: w.sourceSlug } });
      expect(got.every((r) => r.website.slug === w.sourceSlug)).toBe(true);
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('refuses without a session', async () => {
    const anon = createCallerFactory(appRouter)({ db, session: null });
    await expect(anon.runs.listByOrg()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

describe('usage.byProject', () => {
  it('adds verification and run spend and counts pages captured, per project, for the month asked', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-u1@example.com`);
      const p = await a.caller.projects.create({ name: 'Busy' });
      const quiet = await a.caller.projects.create({ name: 'Quiet' });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Shop', url: 'https://shop.example.com/x' });
      await db.insert(sourceVerifications).values([
        { sourceId: w.sourceId, definitionHash: 'h'.repeat(64), startedAt: SEP, completedAt: SEP, costUsd: '0.0300' },
        { sourceId: w.sourceId, definitionHash: 'h'.repeat(64), startedAt: AUG, completedAt: AUG, costUsd: '1.0000' },
      ]);
      await db.insert(runs).values([
        { sourceId: w.sourceId, status: 'completed', completedAt: SEP, createdAt: SEP, costUsd: '0.0200' },
        { sourceId: w.sourceId, status: 'failed', completedAt: AUG, createdAt: AUG, costUsd: '2.0000' },
      ]);
      await db.insert(captures).values([
        { sourceId: w.sourceId, url: 'https://shop.example.com/1', createdAt: SEP },
        { sourceId: w.sourceId, url: 'https://shop.example.com/2', createdAt: SEP },
        { sourceId: w.sourceId, url: 'https://shop.example.com/3', createdAt: AUG },
      ]);

      const sep = await a.caller.usage.byProject({ month: '2026-09' });
      expect(sep.month).toBe('2026-09');
      expect(sep.projects.map((r) => [r.name, r.spendUsd, r.pagesCaptured])).toEqual([['Busy', 0.05, 2], ['Quiet', 0, 0]]);
      expect(sep.total).toEqual({ spendUsd: 0.05, pagesCaptured: 2 });

      const aug = await a.caller.usage.byProject({ month: '2026-08' });
      expect(aug.total).toEqual({ spendUsd: 3, pagesCaptured: 1 });

      const empty = await a.caller.usage.byProject({ month: '2026-07' });
      expect(empty.projects.map((r) => r.spendUsd)).toEqual([0, 0]);
      expect(empty.total).toEqual({ spendUsd: 0, pagesCaptured: 0 });
    } finally {
      if (a) await dropIdentity(a);
    }
  });

  it('rejects a month that is not YYYY-MM', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-u2@example.com`);
      await expect(a.caller.usage.byProject({ month: '2026-9' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});

describe('auth.updateName', () => {
  it('renames the signed-in user and me() says so', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-n1@example.com`);
      expect(await a.caller.auth.updateName({ name: '  Ada Lovelace ' })).toEqual({ name: 'Ada Lovelace' });
      const { caller } = await reload(a);
      expect((await caller.auth.me()).user.name).toBe('Ada Lovelace');
      await expect(a.caller.auth.updateName({ name: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});

describe('orgs.delete', () => {
  it("moves the caller's session to their personal organisation before the team goes", async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-d1@example.com`);
      const team = await a.caller.orgs.create({ name: `Team ${tag}` });
      const onTeam = await reload(a);
      expect(onTeam.session.org.id).toBe(team.id);

      const res = await onTeam.caller.orgs.delete();
      expect(res).toMatchObject({ ok: true, nextOrg: { id: a.org.id, slug: a.org.slug } });
      const after = await reload(a);
      expect(after.session.org.id).toBe(a.org.id);
      expect((await after.caller.auth.me()).orgs.map((o) => o.id)).toEqual([a.org.id]);
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});
