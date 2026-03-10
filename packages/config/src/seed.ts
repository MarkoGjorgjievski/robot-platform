import { resolve, join } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { db } from '@robot/db';
import { orgs, domains, extractors, extractorInputs, credentials, robotOverrides } from '@robot/db/schema';
import { eq, and } from 'drizzle-orm';
import { parseOrgsDirectory, parseDomainFiles } from './parser';

const ROBOT_LIBRARY_PATH = process.env.ROBOT_LIBRARY_PATH ?? resolve(import.meta.dirname, '../../../../robot-library');
const ORGS_PATH = resolve(ROBOT_LIBRARY_PATH, 'src/orgs');
const DOMAINS_PATH = resolve(ROBOT_LIBRARY_PATH, 'src/library/robots/san-antonio/domains');

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

async function safeReaddir(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path);
    return entries.filter((e) => !e.startsWith('.'));
  } catch {
    return [];
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function seedDomainOverrides() {
  console.log(`\nSeeding domain overrides from: ${DOMAINS_PATH}`);
  let created = 0;
  let updated = 0;
  let errors = 0;

  const letterDirs = await safeReaddir(DOMAINS_PATH);
  for (const letter of letterDirs) {
    const letterPath = join(DOMAINS_PATH, letter);
    if (!(await isDirectory(letterPath))) continue;

    const domainDirs = await safeReaddir(letterPath);
    for (const domainName of domainDirs) {
      const domainPath = join(letterPath, domainName);
      if (!(await isDirectory(domainPath))) continue;

      const countryDirs = await safeReaddir(domainPath);
      for (const country of countryDirs) {
        const countryPath = join(domainPath, country);
        if (!(await isDirectory(countryPath))) continue;

        try {
          const domainId = await getOrCreateDomain(domainName);
          const parsed = await parseDomainFiles(countryPath);

          // Check if override already exists
          const existing = await db.query.robotOverrides.findFirst({
            where: and(
              eq(robotOverrides.domainId, domainId),
              eq(robotOverrides.country, country),
            ),
          });

          if (existing) {
            await db.update(robotOverrides)
              .set({
                schemas: parsed.schemas,
                jsOverrides: parsed.jsOverrides,
                parameterOverrides: parsed.parameterOverrides,
                hasGoto2: parsed.hasGoto2,
                hasBeforeExtract: parsed.hasBeforeExtract,
                hasExtract: parsed.hasExtract,
                hasTransform: parsed.hasTransform,
                updatedAt: new Date(),
              })
              .where(eq(robotOverrides.id, existing.id));
            updated++;
          } else {
            await db.insert(robotOverrides).values({
              domainId,
              country,
              schemas: parsed.schemas,
              jsOverrides: parsed.jsOverrides,
              parameterOverrides: parsed.parameterOverrides,
              hasGoto2: parsed.hasGoto2,
              hasBeforeExtract: parsed.hasBeforeExtract,
              hasExtract: parsed.hasExtract,
              hasTransform: parsed.hasTransform,
            });
            created++;
          }
        } catch (err) {
          errors++;
          console.error(`Error seeding override ${domainName}/${country}:`, err);
        }
      }
    }
  }

  console.log(`Domain overrides:`);
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Errors: ${errors}`);
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

  console.log(`\nExtractors seed complete:`);
  console.log(`  Created: ${created}`);
  console.log(`  Skipped (existing): ${skipped}`);
  console.log(`  Errors: ${errors}`);

  // Seed domain overrides (schemas + JS files)
  await seedDomainOverrides();

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
