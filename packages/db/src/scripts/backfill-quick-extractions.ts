import { db, orgs, projects, sources, inputSets } from '../index.js';
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

  if (result.sources.length === 0) {
    console.log('Nothing to back-fill.');
    process.exit(0);
  }

  // Insert InputSets first to get their ids, then Sources referencing them.
  const insertedInputSets = await db
    .insert(inputSets)
    .values(result.inputSets)
    .returning({ id: inputSets.id });

  const sourceValues = result.sources.map((s, i) => ({
    name: s.name,
    slug: s.slug,
    country: 'us',                  // required NOT NULL on sources; arbitrary for sandbox
    sourceType: 'sandbox',
    isSandbox: true,
    inputStrategy: s.inputStrategy,
    urlTemplate: s.urlTemplate,
    listingMode: s.listingMode,
    selectorsJson: s.selectorsJson,
    inputSetId: insertedInputSets[result.sourceToInputSetIndex[i]].id,
    datasetId: null,
  }));

  await db.insert(sources).values(sourceValues);
  console.log(`Inserted ${sourceValues.length} sandbox sources.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
