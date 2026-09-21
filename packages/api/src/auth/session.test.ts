import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, users, orgs, memberships, sessions } from '@robot/db';
import { loadSession, mintToken, avatarColourFor, resolveOrg } from './session.js';

describe('session', () => {
  it('mints 64 hex chars and picks a stable avatar colour', () => {
    expect(mintToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(avatarColourFor('a@b.c')).toBe(avatarColourFor('a@b.c'));
    expect(avatarColourFor('a@b.c')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('loads a live session with its user, org and role; null when expired or unknown', async () => {
    const tag = Date.now();
    const [org] = await db.insert(orgs).values({ name: `S ${tag}`, slug: `s-${tag}` }).returning();
    const [user] = await db.insert(users).values({ email: `s-${tag}@example.com`, name: 'S', avatarColour: '#000000' }).returning();
    await db.insert(memberships).values({ userId: user!.id, orgId: org!.id, role: 'admin' });
    const token = mintToken();
    await db.insert(sessions).values({ token, userId: user!.id, orgId: org!.id, expiresAt: new Date(Date.now() + 60_000) });
    const dead = mintToken();
    await db.insert(sessions).values({ token: dead, userId: user!.id, orgId: org!.id, expiresAt: new Date(Date.now() - 1) });
    try {
      const s = await loadSession(db, token);
      expect(s).toMatchObject({ token, user: { id: user!.id, email: `s-${tag}@example.com` }, org: { id: org!.id, slug: `s-${tag}` }, role: 'admin' });
      expect(await loadSession(db, dead)).toBeNull();
      expect(await loadSession(db, 'nope')).toBeNull();
      expect(await resolveOrg({ db, session: s }, 'default')).toMatchObject({ id: org!.id }); // the session wins over orgSlug
      expect(await resolveOrg({ db, session: null }, `s-${tag}`)).toMatchObject({ id: org!.id });
      await expect(resolveOrg({ db, session: null }, 'no-such-org')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
      await db.delete(orgs).where(eq(orgs.id, org!.id));
    }
  });
});
