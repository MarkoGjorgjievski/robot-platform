import { db, orgs, projects } from '../index.js';
import { eq, and } from 'drizzle-orm';

const SANDBOX_SLUG = 'scratch';
const SANDBOX_NAME = 'Scratch';
const DEFAULT_ORG_SLUG = 'default';
const DEFAULT_ORG_NAME = 'Default';

async function ensureDefaultOrg(): Promise<{ id: string; created: boolean }> {
  const existing = await db.query.orgs.findFirst({ where: eq(orgs.slug, DEFAULT_ORG_SLUG) });
  if (existing) return { id: existing.id, created: false };

  const [created] = await db
    .insert(orgs)
    .values({ slug: DEFAULT_ORG_SLUG, name: DEFAULT_ORG_NAME })
    .returning();
  return { id: created.id, created: true };
}

async function ensureSandboxForOrg(orgId: string): Promise<{ id: string; created: boolean }> {
  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.orgId, orgId), eq(projects.slug, SANDBOX_SLUG)),
  });
  if (existing) return { id: existing.id, created: false };

  const [created] = await db
    .insert(projects)
    .values({
      orgId,
      slug: SANDBOX_SLUG,
      name: SANDBOX_NAME,
      description: 'Throwaway drafts. Graduate sources from here into named projects.',
    })
    .returning();
  return { id: created.id, created: true };
}

async function main() {
  // Make sure there's at least one Org to attach a Sandbox to.
  const allOrgs = await db.select().from(orgs);

  if (allOrgs.length === 0) {
    const { id, created } = await ensureDefaultOrg();
    console.log(`org default: ${created ? 'created' : 'exists'} (${id})`);
    const sb = await ensureSandboxForOrg(id);
    console.log(`  sandbox: ${sb.created ? 'created' : 'exists'} (${sb.id})`);
    process.exit(0);
  }

  for (const org of allOrgs) {
    const sb = await ensureSandboxForOrg(org.id);
    console.log(`org ${org.slug}: sandbox ${sb.created ? 'created' : 'exists'} (${sb.id})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
