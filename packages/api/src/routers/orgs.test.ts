import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, users, orgs, memberships, projects } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

function callerWith(session: Awaited<ReturnType<typeof loadSession>> = null) {
  const cookies: Record<string, string | null> = {};
  const caller = createCallerFactory(appRouter)({ db, session, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: (n) => { cookies[n] = null; } });
  return { caller, cookies };
}

async function signIn(email: string) {
  const { caller, cookies } = callerWith();
  const r = await caller.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  return { ...r, session };
}

describe('orgs', () => {
  it('governs a shared org by role, and cascades on delete', async () => {
    const tag = Date.now();
    const a = await signIn(`orgs-a-${tag}@example.com`);
    const b = await signIn(`orgs-b-${tag}@example.com`);
    let teamId: string | undefined;
    try {
      // A creates a team org and is switched into it.
      const team = await callerWith(a.session).caller.orgs.create({ name: `Team ${tag}` });
      teamId = team.id;
      expect(team.role).toBe('owner');
      expect(team.personal).toBe(false);
      let aSession = (await loadSession(db, a.session.token))!;
      expect((await callerWith(aSession).caller.auth.me()).currentOrg.id).toBe(team.id);

      // B joins the team (no invite flow yet — a direct membership row) and
      // switches their session onto it.
      await db.insert(memberships).values({ userId: b.user.id, orgId: team.id, role: 'member' });
      await callerWith(b.session).caller.auth.switchOrg({ orgId: team.id });
      let bSession = (await loadSession(db, b.session.token))!;
      expect(bSession.role).toBe('member');

      await expect(callerWith(bSession).caller.orgs.rename({ name: 'Nope' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerWith(bSession).caller.orgs.delete()).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(callerWith(bSession).caller.orgs.members.setRole({ userId: a.user.id, role: 'member' })).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // A promotes B to admin: enough to rename, still not enough to delete.
      await callerWith(aSession).caller.orgs.members.setRole({ userId: b.user.id, role: 'admin' });
      bSession = (await loadSession(db, b.session.token))!;
      expect(bSession.role).toBe('admin');
      const renamed = await callerWith(bSession).caller.orgs.rename({ name: 'Renamed by B' });
      expect(renamed.name).toBe('Renamed by B');
      await expect(callerWith(bSession).caller.orgs.delete()).rejects.toMatchObject({ code: 'FORBIDDEN' });

      // A project living in the team org disappears when A deletes the org.
      const project = await callerWith(aSession).caller.projects.create({ name: `Proj ${tag}` });
      await callerWith(aSession).caller.orgs.delete();
      teamId = undefined; // gone — nothing left to clean up for it
      expect(await db.query.orgs.findFirst({ where: eq(orgs.id, team.id) })).toBeUndefined();
      expect(await db.query.projects.findFirst({ where: eq(projects.id, project.id) })).toBeUndefined();

      // Deleting the team org moved A's session to their personal org first
      // (orgs.ts); signing in again just proves a fresh session lands there too.
      const again = callerWith();
      await again.caller.auth.signIn({ email: a.user.email, password: 'x' });
      const aPersonal = (await loadSession(db, again.cookies['robot_session']!))!;
      expect(aPersonal.org.id).toBe(a.org.id);
      expect(aPersonal.org.personal).toBe(true);
      await expect(callerWith(aPersonal).caller.orgs.delete()).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    } finally {
      if (teamId) await deleteOwnOrg(teamId);
      for (const r of [a, b]) {
        await deleteOwnOrg(r.org.id);
        await db.delete(users).where(eq(users.id, r.user.id));
      }
    }
  });

  it('members.setRole and members.remove guard the owner and the caller', async () => {
    const tag = Date.now();
    const a = await signIn(`orgs-owner-${tag}@example.com`);
    const b = await signIn(`orgs-member-${tag}@example.com`);
    let teamId: string | undefined;
    try {
      const team = await callerWith(a.session).caller.orgs.create({ name: `Guarded ${tag}` });
      teamId = team.id;
      const aSession = (await loadSession(db, a.session.token))!;
      await db.insert(memberships).values({ userId: b.user.id, orgId: team.id, role: 'member' });

      const list = await callerWith(aSession).caller.orgs.members.list();
      expect(list.map((m) => m.userId).sort()).toEqual([a.user.id, b.user.id].sort());

      await expect(callerWith(aSession).caller.orgs.members.setRole({ userId: a.user.id, role: 'member' }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' }); // the owner's own role cannot be changed
      await expect(callerWith(aSession).caller.orgs.members.remove({ userId: a.user.id }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' }); // cannot remove yourself

      await callerWith(aSession).caller.orgs.members.remove({ userId: b.user.id });
      expect(await db.query.memberships.findFirst({ where: and(eq(memberships.userId, b.user.id), eq(memberships.orgId, team.id)) })).toBeUndefined();
    } finally {
      if (teamId) await deleteOwnOrg(teamId);
      for (const r of [a, b]) {
        await deleteOwnOrg(r.org.id);
        await db.delete(users).where(eq(users.id, r.user.id));
      }
    }
  });

  // `orgs.ts:53`: an admin may set every role but `owner` — granting a
  // co-owner is the owner's alone. It is the one role rule with no test.
  it('an admin cannot grant owner; the owner can', async () => {
    const tag = Date.now();
    const a = await signIn(`orgs-grant-owner-${tag}@example.com`);
    const b = await signIn(`orgs-grant-admin-${tag}@example.com`);
    const c = await signIn(`orgs-grant-member-${tag}@example.com`);
    let teamId: string | undefined;
    try {
      const team = await callerWith(a.session).caller.orgs.create({ name: `Grants ${tag}` });
      teamId = team.id;
      const aSession = (await loadSession(db, a.session.token))!;
      await db.insert(memberships).values([
        { userId: b.user.id, orgId: team.id, role: 'admin' },
        { userId: c.user.id, orgId: team.id, role: 'member' },
      ]);
      await callerWith(b.session).caller.auth.switchOrg({ orgId: team.id });
      const bSession = (await loadSession(db, b.session.token))!;
      expect(bSession.role).toBe('admin');

      await expect(callerWith(bSession).caller.orgs.members.setRole({ userId: c.user.id, role: 'owner' }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await db.query.memberships.findFirst({ where: and(eq(memberships.userId, c.user.id), eq(memberships.orgId, team.id)) }))?.role).toBe('member');

      // The same call from the owner goes through — the refusal is about who
      // asked, not about the role being ungrantable.
      await callerWith(aSession).caller.orgs.members.setRole({ userId: c.user.id, role: 'owner' });
      expect((await db.query.memberships.findFirst({ where: and(eq(memberships.userId, c.user.id), eq(memberships.orgId, team.id)) }))?.role).toBe('owner');
    } finally {
      if (teamId) await deleteOwnOrg(teamId);
      for (const r of [a, b, c]) {
        await deleteOwnOrg(r.org.id);
        await db.delete(users).where(eq(users.id, r.user.id));
      }
    }
  });
});
