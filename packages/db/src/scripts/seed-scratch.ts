// Seeds the Scratch project — the one always-present, ordinary project that
// declared-mode sources land in until a human moves them elsewhere. Formerly
// named seed-sandbox.ts / seed:sandbox back when Scratch was a fenced-off
// "sandbox" world with its own routes; that world was deleted in
// mvp-simplification task 11. Renamed to match (file + package.json script).
import { db, orgs, projects } from '../index.js';
import { eq, and } from 'drizzle-orm';

const SCRATCH_SLUG = 'scratch';
const SCRATCH_NAME = 'Scratch';
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

async function ensureScratchForOrg(orgId: string): Promise<{ id: string; created: boolean }> {
  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.orgId, orgId), eq(projects.slug, SCRATCH_SLUG)),
  });
  if (existing) return { id: existing.id, created: false };

  const [created] = await db
    .insert(projects)
    .values({
      orgId,
      slug: SCRATCH_SLUG,
      name: SCRATCH_NAME,
      description: 'Default landing project for quick-created sources.',
    })
    .returning();
  return { id: created.id, created: true };
}

async function main() {
  // Make sure there's at least one Org to attach a Scratch project to.
  const allOrgs = await db.select().from(orgs);

  if (allOrgs.length === 0) {
    const { id, created } = await ensureDefaultOrg();
    console.log(`org default: ${created ? 'created' : 'exists'} (${id})`);
    const sb = await ensureScratchForOrg(id);
    console.log(`  scratch: ${sb.created ? 'created' : 'exists'} (${sb.id})`);
    process.exit(0);
  }

  for (const org of allOrgs) {
    const sb = await ensureScratchForOrg(org.id);
    console.log(`org ${org.slug}: scratch ${sb.created ? 'created' : 'exists'} (${sb.id})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
