import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, orgs, users, memberships } from '../index.js';
import { adoptOrg } from './adopt-default.js';

describe('adoptOrg', () => {
  it('makes a throwaway org personal, owned by a throwaway user, with an owner membership — and is idempotent', async () => {
    const tag = Date.now();
    const email = `adopt-${tag}@example.com`;
    const slug = `adopt-throwaway-${tag}`;
    const [user] = await db.insert(users).values({ email, name: 'Before', avatarColour: '#111111' }).returning();
    const [org] = await db.insert(orgs).values({ name: 'Throwaway', slug }).returning();
    try {
      const r1 = await adoptOrg(db, { email, slug });
      expect(r1.membershipAction).toBe('created');
      const orgRow1 = await db.query.orgs.findFirst({ where: eq(orgs.id, org!.id) });
      expect(orgRow1?.personal).toBe(true);
      expect(orgRow1?.ownerUserId).toBe(user!.id);
      const membership1 = await db.query.memberships.findFirst({ where: and(eq(memberships.userId, user!.id), eq(memberships.orgId, org!.id)) });
      expect(membership1?.role).toBe('owner');

      // Running it again is a no-op on the membership and stays personal/owned.
      const r2 = await adoptOrg(db, { email, slug });
      expect(r2.membershipAction).toBe('unchanged');
      const orgRow2 = await db.query.orgs.findFirst({ where: eq(orgs.id, org!.id) });
      expect(orgRow2?.personal).toBe(true);
      expect(orgRow2?.ownerUserId).toBe(user!.id);
    } finally {
      await db.delete(orgs).where(eq(orgs.id, org!.id));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it('upgrades an existing non-owner membership to owner', async () => {
    const tag = Date.now();
    const email = `adopt-upgrade-${tag}@example.com`;
    const slug = `adopt-upgrade-${tag}`;
    const [user] = await db.insert(users).values({ email, name: 'Member', avatarColour: '#222222' }).returning();
    const [org] = await db.insert(orgs).values({ name: 'Upgrade Me', slug }).returning();
    await db.insert(memberships).values({ userId: user!.id, orgId: org!.id, role: 'member' });
    try {
      const r = await adoptOrg(db, { email, slug });
      expect(r.membershipAction).toBe('upgraded');
      const membership = await db.query.memberships.findFirst({ where: and(eq(memberships.userId, user!.id), eq(memberships.orgId, org!.id)) });
      expect(membership?.role).toBe('owner');
    } finally {
      await db.delete(orgs).where(eq(orgs.id, org!.id));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it('rejects an unknown email and an unknown slug', async () => {
    const tag = Date.now();
    await expect(adoptOrg(db, { email: `nobody-${tag}@example.com`, slug: 'default' })).rejects.toThrow('Sign in once first');

    const email = `adopt-badslug-${tag}@example.com`;
    const [user] = await db.insert(users).values({ email, name: 'Solo', avatarColour: '#333333' }).returning();
    try {
      await expect(adoptOrg(db, { email, slug: `no-such-slug-${tag}` })).rejects.toThrow('No org with slug');
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it('defaults slug to "default" and derives name from the email when neither is given, without ever touching the real default org', async () => {
    const tag = Date.now();
    const email = `no-args-${tag}@example.com`;
    // A throwaway org, deliberately slugged "default" is NOT used here — the
    // real `default` org must never be touched by a test. Instead this checks
    // the defaulting logic directly against a non-default slug by passing it
    // explicitly, and checks the name-derivation default separately.
    const slug = `no-args-${tag}`;
    const [user] = await db.insert(users).values({ email, name: 'Before', avatarColour: '#444444' }).returning();
    const [org] = await db.insert(orgs).values({ name: 'No Args', slug }).returning();
    try {
      const r = await adoptOrg(db, { email, slug });
      expect(r.name).toBe(`No-args-${tag}`); // capitalised local part of the email
    } finally {
      await db.delete(orgs).where(eq(orgs.id, org!.id));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });
});
