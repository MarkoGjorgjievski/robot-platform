// Adopts an existing org (by slug, `default` unless given) as a user's
// personal org: sets `personal = true`, `ownerUserId`, the org's name, and
// makes sure that user has an `owner` membership there. Explicit and by hand
// only — spec 2026-09-21 §2 (amended): sign-in never does this itself any
// more, after an ad-hoc adoption + cleanup once cascaded every project in the
// dev database. Idempotent: safe to run again.
import { and, eq } from 'drizzle-orm';
import { db, orgs, users, memberships } from '../index.js';
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
};

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

  return { orgId: org.id, slug, name, userId: user.id, email, membershipAction };
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
      process.exit(0);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
