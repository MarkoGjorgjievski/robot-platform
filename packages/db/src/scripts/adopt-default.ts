// Adopts an existing org (by slug, `default` unless given) as a user's
// personal org: sets `personal = true`, `ownerUserId`, the org's name, and
// makes sure that user has an `owner` membership there. Explicit and by hand
// only — spec 2026-09-21 §2 (amended): sign-in never does this itself any
// more, after an ad-hoc adoption + cleanup once cascaded every project in the
// dev database. Idempotent: safe to run again.
import { and, eq, ne } from 'drizzle-orm';
import { db, orgs, users, memberships, projects, sessions, extractors } from '../index.js';
import type { Database } from '../index.js';

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export type AdoptOrgOptions = { email: string; slug?: string; name?: string };
export type AdoptOrgResult = {
  orgId: string;
  slug: string;
  name: string;
  userId: string;
  email: string;
  membershipAction: 'created' | 'upgraded' | 'unchanged';
  /** Sessions of this user repointed at the adopted org, so an open browser lands on the projects. */
  sessionsMoved: number;
  /** The empty personal org `signIn` had auto-created, if it was safe to drop. */
  droppedOrgSlug: string | null;
  /** Every other personal org of this user that was left alone, and why. */
  keptOrgs: { slug: string; reason: string }[];
};

/**
 * Why another org this user owns must not be deleted after adoption, or null
 * when nothing stands in the way. Deliberately conservative: an org is dropped
 * only when it is provably the empty personal shell `signIn` minted seconds
 * ago, because an org delete cascades to everything under it. (Ownership by
 * this user is the caller's query, so it is not re-checked here.)
 */
async function reasonToKeep(
  database: Database,
  org: { id: string; slug: string; personal: boolean },
  userId: string,
): Promise<string | null> {
  if (org.slug === 'default') return 'its slug is "default"';
  if (!org.personal) return 'it is a shared organisation, not a personal one';

  const project = await database.query.projects.findFirst({ where: eq(projects.orgId, org.id), columns: { id: true } });
  if (project) return 'it holds at least one project';

  // `extractors` is org-scoped, not project-scoped, and cascades on an org
  // delete: an org with no project can still own the domain-intelligence cache,
  // which is the expensive thing in this database.
  const extractor = await database.query.extractors.findFirst({ where: eq(extractors.orgId, org.id), columns: { id: true } });
  if (extractor) return 'it holds cached extractors';

  const otherMember = await database.query.memberships.findFirst({
    where: and(eq(memberships.orgId, org.id), ne(memberships.userId, userId)),
    columns: { id: true },
  });
  if (otherMember) return 'someone else is a member of it';

  return null;
}

export async function adoptOrg(database: Database, opts: AdoptOrgOptions): Promise<AdoptOrgResult> {
  const email = opts.email.trim().toLowerCase();
  const user = await database.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error(`No user with email ${email}. Sign in once first, then run this.`);

  const slug = opts.slug ?? 'default';
  const org = await database.query.orgs.findFirst({ where: eq(orgs.slug, slug) });
  if (!org) throw new Error(`No org with slug "${slug}".`);

  const name = opts.name ?? nameFromEmail(email);
  await database.update(orgs).set({ personal: true, ownerUserId: user.id, name, updatedAt: new Date() }).where(eq(orgs.id, org.id));

  const membership = await database.query.memberships.findFirst({ where: and(eq(memberships.userId, user.id), eq(memberships.orgId, org.id)) });
  let membershipAction: AdoptOrgResult['membershipAction'];
  if (!membership) {
    await database.insert(memberships).values({ userId: user.id, orgId: org.id, role: 'owner' });
    membershipAction = 'created';
  } else if (membership.role !== 'owner') {
    await database.update(memberships).set({ role: 'owner' }).where(eq(memberships.id, membership.id));
    membershipAction = 'upgraded';
  } else {
    membershipAction = 'unchanged';
  }

  // Sessions first, drop second: an org delete cascades to the sessions that
  // point at it, so moving them afterwards would move nothing. With them moved,
  // a browser tab that is already signed in lands on the adopted org's projects
  // instead of on the empty org it was minted against.
  const moved = await database
    .update(sessions)
    .set({ orgId: org.id })
    .where(and(eq(sessions.userId, user.id), ne(sessions.orgId, org.id)))
    .returning({ token: sessions.token });

  // The personal org `signIn` auto-created seconds earlier is now a duplicate:
  // two same-named personal orgs in the switcher, one of them empty. Drop it,
  // but only when it is provably empty and nobody else's.
  const candidates = await database.query.orgs.findMany({
    where: and(eq(orgs.ownerUserId, user.id), ne(orgs.id, org.id)),
    columns: { id: true, slug: true, personal: true },
  });
  let droppedOrgSlug: string | null = null;
  const keptOrgs: { slug: string; reason: string }[] = [];
  for (const candidate of candidates) {
    const reason = await reasonToKeep(database, candidate, user.id);
    if (reason) {
      keptOrgs.push({ slug: candidate.slug, reason });
      continue;
    }
    await database.delete(orgs).where(eq(orgs.id, candidate.id));
    droppedOrgSlug = candidate.slug;
  }

  return { orgId: org.id, slug, name, userId: user.id, email, membershipAction, sessionsMoved: moved.length, droppedOrgSlug, keptOrgs };
}

function parseArgs(argv: string[]): { email?: string; slug?: string; name?: string } {
  const out: { email?: string; slug?: string; name?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email') out.email = argv[++i];
    else if (a === '--slug') out.slug = argv[++i];
    else if (a === '--name') out.name = argv[++i];
  }
  return out;
}

const isMain = process.argv[1]?.replace(/\\/g, '/').endsWith('/adopt-default.ts');
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.error('Usage: tsx src/scripts/adopt-default.ts --email <email> [--slug <slug>] [--name <name>]');
    process.exit(1);
  }
  adoptOrg(db, { email: args.email, slug: args.slug, name: args.name })
    .then((r) => {
      console.log(`org "${r.slug}" (${r.orgId}) is now personal, owned by ${r.email} (${r.userId}), named "${r.name}"`);
      console.log(`membership: ${r.membershipAction}`);
      console.log(`sessions moved to this org: ${r.sessionsMoved}`);
      console.log(r.droppedOrgSlug ? `dropped the empty personal org "${r.droppedOrgSlug}"` : 'dropped no other org');
      for (const kept of r.keptOrgs) console.log(`kept "${kept.slug}": ${kept.reason}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
