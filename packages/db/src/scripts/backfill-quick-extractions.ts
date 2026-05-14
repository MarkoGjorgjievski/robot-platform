import { db, orgs, projects } from '../index.js';
import { quickExtractions } from '../quick-extractions.js';
import { quickExtractionsToSandboxRecords } from './backfill-transform.js';
import { eq, and } from 'drizzle-orm';

const SANDBOX_SLUG = 'sandbox';

export async function findFirstSandboxProjectId(): Promise<string> {
  // Pick the first org's Sandbox project. seed-sandbox.ts must have run first.
  const allOrgs = await db.select().from(orgs).orderBy(orgs.createdAt).limit(1);
  if (allOrgs.length === 0) {
    throw new Error('No orgs found. Run `pnpm --filter @robot/db seed:sandbox` first.');
  }
  const org = allOrgs[0];
  const sandbox = await db.query.projects.findFirst({
    where: and(eq(projects.orgId, org.id), eq(projects.slug, SANDBOX_SLUG)),
  });
  if (!sandbox) {
    throw new Error(`No Sandbox project found for org ${org.slug}. Run seed-sandbox first.`);
  }
  return sandbox.id;
}

async function main() {
  const sandboxProjectId = await findFirstSandboxProjectId();
  console.log(`Sandbox project: ${sandboxProjectId}`);

  const rows = await db.select().from(quickExtractions);
  console.log(`Read ${rows.length} quick_extractions rows.`);

  const result = quickExtractionsToSandboxRecords(
    rows.map((r) => ({
      url: r.url,
      domain: r.domain,
      fields: r.fields,
      extractedData: r.extractedData,
    })),
    sandboxProjectId,
  );
  console.log(`Would create ${result.inputSets.length} InputSets and ${result.sources.length} Sources.`);

  throw new Error(
    'Pre-flight: sources.dataset_id is currently NOT NULL. Run Task 8.5 (make dataset_id nullable) and then complete Task 8.6 to enable the real back-fill.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
