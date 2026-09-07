import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources, inputSets, sourceVerifications } from '@robot/db';
import type { CertifiedPath } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { loadCurrentCertification, sourceDefinitionHash } from './current-certification.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

/** Deletes a Source created by createWithSchema, plus its InputSet — mirrors
 *  sources-schema.test.ts's cleanupSource. `source_verifications` rows
 *  cascade with the Source, so no separate cleanup is needed there. */
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
    `https://test-cert-${tag}.example.com/p/1`,
    `https://test-cert-${tag}.example.com/p/2`,
    `https://test-cert-${tag}.example.com/p/3`,
  ];
  const created = await caller.sources.createWithSchema({
    urls,
    fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  const source = await db.query.sources.findFirst({ where: eq(sources.id, created.sourceId) });
  return { sourceId: created.sourceId, source: source!, urls };
}

const certifiedPrice: CertifiedPath[] = [{ source: 'api', path: 'item.price', transform: 'identity' }];

function fieldVerification(certified: CertifiedPath[]) {
  return { key: 'price', cells: {}, certified, weakEvidence: false, aiCalled: false, incomplete: false };
}

describe('sourceDefinitionHash', () => {
  it('returns null when schemaDefinition is missing or not an array', () => {
    expect(sourceDefinitionHash({ schemaDefinition: null, verificationSet: null })).toBeNull();
    expect(sourceDefinitionHash({ schemaDefinition: [], verificationSet: null })).toBeNull();
  });

  it('returns a stable hash for a real Source', async () => {
    const { sourceId, source } = await makeSchemaSource('hash');
    try {
      const hash = sourceDefinitionHash(source);
      expect(typeof hash).toBe('string');
      expect(hash).toBe(sourceDefinitionHash(source));
    } finally {
      await cleanupSource(sourceId);
    }
  });
});

describe('loadCurrentCertification', () => {
  it('returns the certification for a matching all-passed completed verification', async () => {
    const { sourceId, source, urls } = await makeSchemaSource('match');
    try {
      const hash = sourceDefinitionHash(source)!;
      const [row] = await db
        .insert(sourceVerifications)
        .values({
          sourceId,
          definitionHash: hash,
          completedAt: new Date(),
          allPassed: true,
          results: { price: fieldVerification(certifiedPrice) },
        })
        .returning({ id: sourceVerifications.id });

      const cert = await loadCurrentCertification(db, sourceId);
      expect(cert).not.toBeNull();
      expect(cert!.verificationId).toBe(row!.id);
      expect(cert!.paths).toEqual({ price: certifiedPrice });
      expect(cert!.concepts).toEqual({ price: 'price' });
      // M3: the host the paths were certified against — `verificationSet.urls[0]`'s —
      // is what verified-path stats must be booked under later.
      expect(cert!.hostname).toBe(new URL(urls[0]!).hostname);
    } finally {
      await cleanupSource(sourceId);
    }
  });

  it('returns null once the schema hash no longer matches (updateSchema edited it)', async () => {
    const { sourceId, source, urls } = await makeSchemaSource('hashchange');
    try {
      const hash = sourceDefinitionHash(source)!;
      await db.insert(sourceVerifications).values({
        sourceId,
        definitionHash: hash,
        completedAt: new Date(),
        allPassed: true,
        results: { price: fieldVerification(certifiedPrice) },
      });

      // Certified while the schema had just "Price" — confirm it's found first.
      expect(await loadCurrentCertification(db, sourceId)).not.toBeNull();

      await caller.sources.updateSchema({
        sourceId,
        urls,
        fields: [{ name: 'Brand', type: 'text', description: 'y' }],
        expected: { Brand: { [urls[0]!]: 'Acme', [urls[1]!]: 'Acme', [urls[2]!]: 'Acme' } },
      });

      expect(await loadCurrentCertification(db, sourceId)).toBeNull();
    } finally {
      await cleanupSource(sourceId);
    }
  });

  it('returns null for a completed but not-all-passed row', async () => {
    const { sourceId, source } = await makeSchemaSource('notallpassed');
    try {
      const hash = sourceDefinitionHash(source)!;
      await db.insert(sourceVerifications).values({
        sourceId,
        definitionHash: hash,
        completedAt: new Date(),
        allPassed: false,
        results: { price: fieldVerification([]) },
      });

      expect(await loadCurrentCertification(db, sourceId)).toBeNull();
    } finally {
      await cleanupSource(sourceId);
    }
  });

  it('ignores an in-flight (uncompleted) row even when allPassed would otherwise match', async () => {
    const { sourceId, source } = await makeSchemaSource('inflight');
    try {
      const hash = sourceDefinitionHash(source)!;
      await db.insert(sourceVerifications).values({
        sourceId,
        definitionHash: hash,
        completedAt: null,
        allPassed: true,
        results: { price: fieldVerification(certifiedPrice) },
      });

      expect(await loadCurrentCertification(db, sourceId)).toBeNull();
    } finally {
      await cleanupSource(sourceId);
    }
  });

  it('returns null for a Source with no schema at all', async () => {
    const created = await caller.sources.quickCreate({ mode: 'detail', urls: ['https://test-cert-noschema.example.com/p/1'] });
    try {
      expect(await loadCurrentCertification(db, created.sourceId)).toBeNull();
    } finally {
      await cleanupSource(created.sourceId);
    }
  });
});
