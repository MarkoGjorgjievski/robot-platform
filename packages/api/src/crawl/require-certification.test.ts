// packages/api/src/crawl/require-certification.test.ts
// The gate every extraction-spending procedure calls first: a legacy Source
// (no customer schema) is untouched, a customer Source without a current
// certification is refused outright, and a certified one hands back exactly
// what loadCurrentCertification would.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, sources, inputSets, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { requireCertification } from './require-certification.js';
import { sourceDefinitionHash } from '../verify/current-certification.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

async function cleanupSource(sourceId: string): Promise<void> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { inputSetId: true },
  });
  await db.delete(sources).where(eq(sources.id, sourceId));
  if (source?.inputSetId) {
    await db.delete(inputSets).where(eq(inputSets.id, source.inputSetId));
  }
}

async function makeSchemaSource(tag: string) {
  const urls = [
    `https://test-reqcert-${tag}.example.com/p/1`,
    `https://test-reqcert-${tag}.example.com/p/2`,
    `https://test-reqcert-${tag}.example.com/p/3`,
  ];
  const created = await caller.sources.createWithSchema({
    urls,
    fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  const source = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
  return { sourceId: created.sourceId, source: source! };
}

describe('requireCertification', () => {
  it('returns null for a legacy Source (no schemaDefinition)', async () => {
    const created = await caller.sources.quickCreate({ mode: 'detail', urls: ['https://test-reqcert-legacy.example.com/p/1'] });
    try {
      expect(await requireCertification(db, created.sourceId)).toBeNull();
    } finally {
      await cleanupSource(created.sourceId);
    }
  });

  it('throws PRECONDITION_FAILED for a customer Source with no current certification', async () => {
    const { sourceId } = await makeSchemaSource('uncert');
    try {
      await expect(requireCertification(db, sourceId)).rejects.toMatchObject({
        constructor: TRPCError,
        code: 'PRECONDITION_FAILED',
        message: 'Verify the schema before extracting',
      });
    } finally {
      await cleanupSource(sourceId);
    }
  });

  it('returns the certification for a customer Source with a current one', async () => {
    const { sourceId, source } = await makeSchemaSource('cert');
    try {
      const hash = sourceDefinitionHash(source)!;
      const certified: CertifiedPath[] = [{ source: 'api', path: 'item.price', transform: 'identity' }];
      const fields = source.schemaDefinition as SchemaDefinitionField[];
      const set = source.verificationSet as VerificationSet;
      const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass', found: '1', path: certified[0] }]));
      await db.insert(sourceVerifications).values({
        sourceId,
        definitionHash: hash,
        completedAt: new Date(),
        allPassed: true,
        results: { price: { key: 'price', fieldHash: fieldHash(fields[0]!, set), cells, certified, weakEvidence: false, aiCalled: false, incomplete: false } },
      });

      const cert = await requireCertification(db, sourceId);
      expect(cert).not.toBeNull();
      expect(cert!.paths).toEqual({ price: certified });
    } finally {
      await cleanupSource(sourceId);
    }
  });
});
