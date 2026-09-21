import { describe, it, expect } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { db, users, orgs, memberships, sessions } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession, mintToken } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

function callerWith(session: Awaited<ReturnType<typeof loadSession>> = null) {
  const cookies: Record<string, string | null> = {};
  const caller = createCallerFactory(appRouter)({ db, session, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: (n) => { cookies[n] = null; } });
  return { caller, cookies };
}

describe('auth', () => {
  it('a new user signs in with any password, gets a personal org and a session cookie', async () => {
    const email = `new-${Date.now()}@example.com`;
    const { caller, cookies } = callerWith();
    const r = await caller.auth.signIn({ email: ` ${email.toUpperCase()} `, password: 'whatever' });
    try {
      expect(r.user.email).toBe(email);
      expect(r.org.personal).toBe(true);
      const token = cookies['robot_session']!;
      const s = await loadSession(db, token);
      expect(s).toMatchObject({ user: { email }, org: { id: r.org.id }, role: 'owner' });
      const me = await callerWith(s).caller.auth.me();
      expect(me.orgs.map((o) => o.id)).toContain(r.org.id);
      expect(me.currentOrg.id).toBe(r.org.id);
      await callerWith(s).caller.auth.setTheme({ theme: 'light' });
      expect((await callerWith(await loadSession(db, token)).caller.auth.me()).user.theme).toBe('light');
      await callerWith(s).caller.auth.signOut();
      expect(await loadSession(db, token)).toBeNull();
    } finally {
      await deleteOwnOrg(r.org.id);
      await db.delete(users).where(eq(users.id, r.user.id));
    }
  });

  it('me and switchOrg refuse without a session; switchOrg refuses a non-member', async () => {
    const { caller } = callerWith();
    await expect(caller.auth.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const a = await callerWith().caller.auth.signIn({ email: `a-${Date.now()}@example.com`, password: 'x' });
    const b = await callerWith().caller.auth.signIn({ email: `b-${Date.now()}@example.com`, password: 'x' });
    try {
      const again = callerWith();
      await again.caller.auth.signIn({ email: a.user.email, password: 'x' });   // an existing user: a new session, no new org
      const sa = await loadSession(db, again.cookies['robot_session']!);
      expect(sa!.org.id).toBe(a.org.id);
      await expect(callerWith(sa).caller.auth.switchOrg({ orgId: b.org.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await db.insert(memberships).values({ userId: a.user.id, orgId: b.org.id, role: 'member' });
      expect((await callerWith(sa).caller.auth.switchOrg({ orgId: b.org.id })).currentOrg.id).toBe(b.org.id);
    } finally {
      for (const r of [a, b]) { await deleteOwnOrg(r.org.id); await db.delete(users).where(eq(users.id, r.user.id)); }
    }
  });

  it('skips the last session org once the membership behind it is gone', async () => {
    const tag = Date.now();
    const a = await callerWith().caller.auth.signIn({ email: `stale-${tag}@example.com`, password: 'x' });
    const [other] = await db.insert(orgs).values({ name: `Other ${tag}`, slug: `other-${tag}` }).returning();
    try {
      // A worked in `other` last, then lost their place in it.
      await db.insert(memberships).values({ userId: a.user.id, orgId: other!.id, role: 'member' });
      await db.insert(sessions).values({ token: mintToken(), userId: a.user.id, orgId: other!.id, expiresAt: new Date(Date.now() + 60_000) });
      await db.delete(memberships).where(and(eq(memberships.userId, a.user.id), eq(memberships.orgId, other!.id)));
      const newest = await db.query.sessions.findFirst({ where: eq(sessions.userId, a.user.id), orderBy: [desc(sessions.createdAt)] });
      expect(newest!.orgId).toBe(other!.id);   // the stale session really is the one sign-in would reach for
      const again = callerWith();
      await again.caller.auth.signIn({ email: a.user.email, password: 'x' });
      const s = await loadSession(db, again.cookies['robot_session']!);
      expect(s!.org.id).toBe(a.org.id);
      expect((await callerWith(s).caller.auth.me()).currentOrg.id).toBe(a.org.id);
    } finally {
      await deleteOwnOrg(other!.id);
      await deleteOwnOrg(a.org.id);
      await db.delete(users).where(eq(users.id, a.user.id));
    }
  });
});
