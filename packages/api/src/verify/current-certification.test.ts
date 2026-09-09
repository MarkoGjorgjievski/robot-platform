import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources, inputSets, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { loadCurrentCertification, loadFieldCurrency, sourceDefinitionHash } from './current-certification.js';

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

function fieldVerification(certified: CertifiedPath[], extra: { fieldHash?: string; cells?: Record<string, unknown> } = {}) {
  return { key: 'price', cells: {}, certified, weakEvidence: false, aiCalled: false, incomplete: false, ...extra };
}

/** A field is current only when its stored `fieldHash` matches the field as it stands now
 *  AND its cells all read 'pass' (spec 4.4) — build both from the source's own definition. */
function currentPriceVerification(source: { schemaDefinition: unknown; verificationSet: unknown }, urls: string[], certified: CertifiedPath[]) {
  const fields = source.schemaDefinition as SchemaDefinitionField[];
  const set = source.verificationSet as VerificationSet;
  const cells = Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: '1', path: certified[0] }]));
  return fieldVerification(certified, { fieldHash: fieldHash(fields[0]!, set), cells });
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
          results: { price: currentPriceVerification(source, urls, certifiedPrice) },
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

  // Correction round, item 5: `verificationSet` is jsonb — nothing forces
  // `urls[0]` to be a parseable URL — and M3 made `new URL(urls[0])` run on
  // every certification load. An unparseable url must read as "uncertified"
  // (recoverable: `requireCertification` says verify first), never blow up
  // the whole procedure with a TypeError.
  it('returns null when the verification set has an unparseable url', async () => {
    const { sourceId, source, urls } = await makeSchemaSource('badurl');
    try {
      const hash = sourceDefinitionHash(source)!;
      await db.insert(sourceVerifications).values({
        sourceId,
        definitionHash: hash,
        completedAt: new Date(),
        allPassed: true,
        results: { price: currentPriceVerification(source, urls, certifiedPrice) },
      });
      // Sanity: it IS a current certification before the url is corrupted.
      expect(await loadCurrentCertification(db, sourceId)).not.toBeNull();

      // Corrupt urls[0] only — the definition hash still has to match, so the
      // row stays "current" and the url guard is genuinely what refuses it.
      const set = source.verificationSet as { urls: string[] };
      const corrupted = { ...set, urls: ['not a url', ...set.urls.slice(1)] };
      await db.update(sources).set({ verificationSet: corrupted }).where(eq(sources.id, sourceId));
      const refreshed = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
      await db.update(sourceVerifications)
        .set({ definitionHash: sourceDefinitionHash(refreshed!)! })
        .where(eq(sourceVerifications.sourceId, sourceId));

      expect(await loadCurrentCertification(db, sourceId)).toBeNull();
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
        results: { price: currentPriceVerification(source, urls, certifiedPrice) },
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

  it('loadFieldCurrency: a field is current only when the latest clean row holds a passing result with the present fieldHash', async () => {
    // setup: a source with fields price + title (see this file's existing fixture), then one completed row
    // whose results carry a matching fieldHash for price and a stale one for title.
    const urls = [
      'https://test-cert-fieldcurrency.example.com/p/1',
      'https://test-cert-fieldcurrency.example.com/p/2',
      'https://test-cert-fieldcurrency.example.com/p/3',
    ];
    const created = await caller.sources.createWithSchema({
      urls,
      fields: [
        { name: 'Price', type: 'money', description: 'x' },
        { name: 'Title', type: 'text', description: 'y' },
      ],
      expected: {
        Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' },
        Title: { [urls[0]!]: 'A', [urls[1]!]: 'B', [urls[2]!]: 'C' },
      },
    });
    const sourceId = created.sourceId;
    try {
      const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
      const fields = src!.schemaDefinition as SchemaDefinitionField[];
      const set = src!.verificationSet as VerificationSet;
      const pass = (key: string, fh: string) => ({
        key, fieldHash: fh, weakEvidence: false, aiCalled: false, incomplete: false,
        certified: [{ source: 'meta', path: 'x', transform: 'identity' }],
        cells: Object.fromEntries(set.urls.map((u) => [u, { status: 'pass', found: '1', path: { source: 'meta', path: 'x', transform: 'identity' } }])),
      });
      await db.insert(sourceVerifications).values({
        sourceId, definitionHash: 'any', allPassed: false, completedAt: new Date(),
        results: { price: pass('price', fieldHash(fields[0]!, set)), title: pass('title', 'stale') },
      });
      const c = await loadFieldCurrency(db, sourceId);
      expect(c.currentKeys).toEqual(['price']);
      expect(await loadCurrentCertification(db, sourceId)).toBeNull(); // title is not current
    } finally {
      await cleanupSource(sourceId);
    }
  });
});
