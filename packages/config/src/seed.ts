import { resolve } from 'node:path';
import { db } from '@robot/db';
import { orgs, domains, extractors, extractorInputs, credentials } from '@robot/db/schema';
import { eq } from 'drizzle-orm';
import { parseOrgsDirectory } from './parser';

const ROBOT_LIBRARY_PATH = process.env.ROBOT_LIBRARY_PATH ?? resolve(import.meta.dirname, '../../../../robot-library');
const ORGS_PATH = resolve(ROBOT_LIBRARY_PATH, 'src/orgs');

async function getOrCreateOrg(name: string): Promise<string> {
  const existing = await db.query.orgs.findFirst({
    where: eq(orgs.slug, name),
  });
  if (existing) return existing.id;

  const [org] = await db.insert(orgs).values({
    name,
    slug: name,
  }).returning();
  return org.id;
}

async function getOrCreateDomain(name: string): Promise<string> {
  const existing = await db.query.domains.findFirst({
    where: eq(domains.name, name),
  });
  if (existing) return existing.id;

  const [domain] = await db.insert(domains).values({
    name,
  }).returning();
  return domain.id;
}

async function seed() {
  console.log(`Parsing YAML configs from: ${ORGS_PATH}`);
  const parsed = await parseOrgsDirectory(ORGS_PATH);
  console.log(`Found ${parsed.length} extractor configs`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const config of parsed) {
    try {
      const orgId = await getOrCreateOrg(config.orgName);
      const domainId = await getOrCreateDomain(config.domainName);

      // Check if extractor already exists
      const existing = await db.query.extractors.findFirst({
        where: (t, { and, eq }) =>
          and(
            eq(t.orgId, orgId),
            eq(t.domainId, domainId),
            eq(t.country, config.country),
            eq(t.variant, config.variant),
          ),
      });

      if (existing) {
        skipped++;
        continue;
      }

      const [extractor] = await db.insert(extractors).values({
        orgId,
        domainId,
        country: config.country,
        robotTemplate: config.robotTemplate,
        variant: config.variant,
        parameters: config.parameters,
      }).returning();

      // Insert inputs (batch, max 100 at a time)
      if (config.inputs.length > 0) {
        const inputValues = config.inputs.map((input) => ({
          extractorId: extractor.id,
          label: input.label,
          inputData: input.inputData,
        }));

        for (let i = 0; i < inputValues.length; i += 100) {
          await db.insert(extractorInputs).values(inputValues.slice(i, i + 100));
        }
      }

      // Insert credentials
      for (const cred of config.credentials) {
        await db.insert(credentials).values({
          extractorId: extractor.id,
          environment: cred.environment,
          username: cred.username,
          password: cred.password,
          extraFields: cred.extraFields,
        });
      }

      created++;
    } catch (err) {
      errors++;
      console.error(`Error seeding ${config.orgName}/${config.domainName}/${config.country}/${config.variant}:`, err);
    }
  }

  console.log(`\nSeed complete:`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (existing): ${skipped}`);
  console.log(`  Errors: ${errors}`);

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
