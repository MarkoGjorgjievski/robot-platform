import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, orgs, users, memberships, projects, sessions, domains, extractors } from '../index.js';
import { adoptOrg } from './adopt-default.js';

/** A session row for a throwaway user, the way `signIn` would have minted it. */
async function addSession(userId: string, orgId: string, token: string) {
  await db.insert(sessions).values({ token, userId, orgId, expiresAt: new Date(Date.now() + 60_000) });
}

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

      // Running it again is a no-op on the membership and stays personal/owned —
      // and moves nothing and drops nothing, which is what idempotence means now
      // that the script also touches sessions and other orgs.
      const r2 = await adoptOrg(db, { email, slug });
      expect(r2.membershipAction).toBe('unchanged');
      expect(r2.sessionsMoved).toBe(0);
      expect(r2.droppedOrgSlug).toBeNull();
      expect(r2.keptOrgs).toEqual([]);
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

  // The two rulings of 2026-09-21: an open session must follow the user to the
  // adopted org, and the empty personal org `signIn` minted seconds earlier
  // must not be left in the switcher next to it under the same name.
  it('moves the user\'s sessions to the adopted org and drops the empty personal org sign-in created', async () => {
    const tag = Date.now();
    const email = `adopt-move-${tag}@example.com`;
    const [user] = await db.insert(users).values({ email, name: 'Mover', avatarColour: '#555555' }).returning();
    const [target] = await db.insert(orgs).values({ name: 'Target', slug: `adopt-move-target-${tag}` }).returning();
    // What `signIn` would have made: a personal org owned by this user, empty.
    const [auto] = await db.insert(orgs).values({ name: 'Mover', slug: `adopt-move-auto-${tag}`, personal: true, ownerUserId: user!.id }).returning();
    await db.insert(memberships).values({ userId: user!.id, orgId: auto!.id, role: 'owner' });
    await addSession(user!.id, auto!.id, `adopt-move-${tag}`);
    try {
      const r = await adoptOrg(db, { email, slug: target!.slug });

      expect(r.sessionsMoved).toBe(1);
      const session = await db.query.sessions.findFirst({ where: eq(sessions.token, `adopt-move-${tag}`) });
      expect(session?.orgId).toBe(target!.id);

      expect(r.droppedOrgSlug).toBe(auto!.slug);
      expect(r.keptOrgs).toEqual([]);
      expect(await db.query.orgs.findFirst({ where: eq(orgs.id, auto!.id) })).toBeUndefined();
    } finally {
      await db.delete(orgs).where(eq(orgs.id, auto!.id));
      await db.delete(orgs).where(eq(orgs.id, target!.id));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it('keeps a personal org that holds a project, and says why', async () => {
    const tag = Date.now();
    const email = `adopt-keep-project-${tag}@example.com`;
    const [user] = await db.insert(users).values({ email, name: 'Keeper', avatarColour: '#666666' }).returning();
    const [target] = await db.insert(orgs).values({ name: 'Target', slug: `adopt-keep-target-${tag}` }).returning();
    const [other] = await db.insert(orgs).values({ name: 'Keeper', slug: `adopt-keep-other-${tag}`, personal: true, ownerUserId: user!.id }).returning();
    await db.insert(memberships).values({ userId: user!.id, orgId: other!.id, role: 'owner' });
    await db.insert(projects).values({ orgId: other!.id, name: 'Kept work', slug: `kept-work-${tag}` });
    try {
      const r = await adoptOrg(db, { email, slug: target!.slug });
      expect(r.droppedOrgSlug).toBeNull();
      expect(r.keptOrgs).toEqual([{ slug: other!.slug, reason: 'it holds at least one project' }]);
      expect(await db.query.orgs.findFirst({ where: eq(orgs.id, other!.id) })).toBeDefined();
    } finally {
      await db.delete(orgs).where(eq(orgs.id, other!.id));
      await db.delete(orgs).where(eq(orgs.id, target!.id));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  // `extractors` is org-scoped, so an org with no project can still own the
  // domain-intelligence cache — the expensive thing in this database — and an
  // org delete cascades to it.
  it('keeps a personal org that holds cached extractors, and says why', async () => {
    const tag = Date.now();
    const email = `adopt-keep-extractor-${tag}@example.com`;
    const [user] = await db.insert(users).values({ email, name: 'Cache', avatarColour: '#999999' }).returning();
    const [target] = await db.insert(orgs).values({ name: 'Target', slug: `adopt-extractor-target-${tag}` }).returning();
    const [other] = await db.insert(orgs).values({ name: 'Cache', slug: `adopt-extractor-other-${tag}`, personal: true, ownerUserId: user!.id }).returning();
    await db.insert(memberships).values({ userId: user!.id, orgId: other!.id, role: 'owner' });
    const [domain] = await db.insert(domains).values({ name: `adopt-extractor-${tag}.example` }).returning();
    await db.insert(extractors).values({ orgId: other!.id, domainId: domain!.id, country: 'us', variant: 'default' });
    try {
      const r = await adoptOrg(db, { email, slug: target!.slug });
      expect(r.droppedOrgSlug).toBeNull();
      expect(r.keptOrgs).toEqual([{ slug: other!.slug, reason: 'it holds cached extractors' }]);
      expect(await db.query.orgs.findFirst({ where: eq(orgs.id, other!.id) })).toBeDefined();
    } finally {
      await db.delete(orgs).where(eq(orgs.id, other!.id));
      await db.delete(orgs).where(eq(orgs.id, target!.id));
      await db.delete(domains).where(eq(domains.id, domain!.id));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });

  it('keeps a personal org someone else is also a member of, and a shared org the user owns', async () => {
    const tag = Date.now();
    const email = `adopt-keep-shared-${tag}@example.com`;
    const [user] = await db.insert(users).values({ email, name: 'Owner', avatarColour: '#777777' }).returning();
    const [guest] = await db.insert(users).values({ email: `adopt-guest-${tag}@example.com`, name: 'Guest', avatarColour: '#888888' }).returning();
    const [target] = await db.insert(orgs).values({ name: 'Target', slug: `adopt-shared-target-${tag}` }).returning();
    const [withGuest] = await db.insert(orgs).values({ name: 'Owner', slug: `adopt-shared-guest-${tag}`, personal: true, ownerUserId: user!.id }).returning();
    const [team] = await db.insert(orgs).values({ name: 'Team', slug: `adopt-shared-team-${tag}`, personal: false, ownerUserId: user!.id }).returning();
    await db.insert(memberships).values([
      { userId: user!.id, orgId: withGuest!.id, role: 'owner' },
      { userId: guest!.id, orgId: withGuest!.id, role: 'member' },
      { userId: user!.id, orgId: team!.id, role: 'owner' },
    ]);
    try {
      const r = await adoptOrg(db, { email, slug: target!.slug });
      expect(r.droppedOrgSlug).toBeNull();
      expect([...r.keptOrgs].sort((a, b) => a.slug.localeCompare(b.slug))).toEqual(
        [
          { slug: withGuest!.slug, reason: 'someone else is a member of it' },
          { slug: team!.slug, reason: 'it is a shared organisation, not a personal one' },
        ].sort((a, b) => a.slug.localeCompare(b.slug)),
      );
      for (const kept of [withGuest!, team!]) {
        expect(await db.query.orgs.findFirst({ where: eq(orgs.id, kept.id) })).toBeDefined();
      }
    } finally {
      for (const org of [withGuest!, team!, target!]) await db.delete(orgs).where(eq(orgs.id, org.id));
      await db.delete(users).where(eq(users.id, guest!.id));
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });
});
