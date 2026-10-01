// packages/api/src/crawl/require-certification-variants.test.ts
// The Extract gate with variants (spec 2026-10-01, Review Focus 4): a
// website whose fields are current is still blocked while its project wants
// variants and the website's variants are not set up, or not verified as
// they stand now; ignoring variants, or "no variants on this website",
// gates exactly as before.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VariantVerification, type VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { requireCertification } from './require-certification.js';
import { currentVariantHash } from '../verify/variant-check.js';
import { loadVariantCurrency } from '../verify/current-certification.js';
import type { VariantSetup } from '../contract.js';

const caller = createCallerFactory(appRouter)({ db, session: null });

async function makeSource(tag: string) {
  const urls = [`https://test-reqvar-${tag}.example.com/p/1`, `https://test-reqvar-${tag}.example.com/p/2`, `https://test-reqvar-${tag}.example.com/p/3`];
  const f = await createProjectWithSource(caller, {
    tag: `reqvar-${tag}`,
    urls,
    fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  return { ...f, urls };
}

async function state(sourceId: string) {
  const s = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true, variantSetup: true },
    with: { dataset: { columns: { schema: true } } },
  });
  return { fields: s!.schemaDefinition as SchemaDefinitionField[], set: s!.verificationSet as VerificationSet, setup: s!.variantSetup as VariantSetup | null, datasetSchema: s!.dataset!.schema };
}

/** A completed, clean run whose field results pass and are current (hashed as `hashOf` in sources-verify.test.ts does), plus `variantResults`. */
async function insertRun(sourceId: string, variantResults: VariantVerification | null) {
  const { fields, set } = await state(sourceId);
  const certified: CertifiedPath[] = [{ source: 'api', path: 'item.price', transform: 'identity' }];
  const cells = Object.fromEntries(set.urls.map((u) => [u, { status: 'pass', found: '1', path: certified[0] }]));
  const results = Object.fromEntries(fields.map((d) => [d.key, { key: d.key, fieldHash: fieldHash(d, set), cells, certified, weakEvidence: false, aiCalled: false, incomplete: false }]));
  await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results, variantResults });
}

async function verifiedVariants(sourceId: string, passed = true): Promise<VariantVerification> {
  const { set, setup, datasetSchema } = await state(sourceId);
  return { method: 'list', hash: currentVariantHash({ set, setup: setup!, datasetSchema }), passed, pages: {} };
}

const blocked = (message: string) => ({ code: 'PRECONDITION_FAILED', message });

describe('requireCertification with variants', () => {
  it('ignore mode: certification as today', async () => {
    const f = await makeSource('ignore');
    try {
      await insertRun(f.sourceId, null);
      const cert = await requireCertification(db, f.sourceId);
      expect(cert).not.toBeNull();
      expect(cert!.variants).toBeUndefined();
      expect((await loadVariantCurrency(db, f.sourceId)).required).toBe('no');
    } finally { await f.cleanup(); }
  });

  it("variants on, website not set up: Extract is blocked with the setup message", async () => {
    const f = await makeSource('nosetup');
    try {
      await insertRun(f.sourceId, null);
      await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'row_per_variant' });
      await expect(requireCertification(db, f.sourceId)).rejects.toMatchObject(blocked("Set up this website's variants before extracting"));
    } finally { await f.cleanup(); }
  });

  it('fields not verified still say so first', async () => {
    const f = await makeSource('fieldsfirst');
    try {
      await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'row_per_variant' });
      await expect(requireCertification(db, f.sourceId)).rejects.toMatchObject(blocked('Verify the schema before extracting'));
    } finally { await f.cleanup(); }
  });

  it('method none: certification as today', async () => {
    const f = await makeSource('none');
    try {
      await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'row_per_variant' });
      await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'none', axes: [] });
      await insertRun(f.sourceId, null);
      const cert = await requireCertification(db, f.sourceId);
      expect(cert).not.toBeNull();
      expect(cert!.variants).toBeUndefined();
    } finally { await f.cleanup(); }
  });

  it('list, variants not verified: blocked with the variants message', async () => {
    const f = await makeSource('unverified');
    try {
      await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'row_per_variant' });
      await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
      await insertRun(f.sourceId, null);
      await expect(requireCertification(db, f.sourceId)).rejects.toMatchObject(blocked('Verify the variants before extracting'));

      // Current but failed: still blocked.
      await insertRun(f.sourceId, await verifiedVariants(f.sourceId, false));
      await expect(requireCertification(db, f.sourceId)).rejects.toMatchObject(blocked('Verify the variants before extracting'));
      const c = await loadVariantCurrency(db, f.sourceId);
      expect(c).toMatchObject({ required: 'yes', current: true, passed: false });
    } finally { await f.cleanup(); }
  });

  it('list, variants verified and current: cert carries variants', async () => {
    const f = await makeSource('verified');
    try {
      await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'row_per_variant' });
      await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
      await caller.sources.saveVariantAnswer({ sourceId: f.sourceId, url: f.urls[0]!, answer: { count: 2, labels: ['Black', 'Red'] } });
      await insertRun(f.sourceId, await verifiedVariants(f.sourceId));
      const cert = await requireCertification(db, f.sourceId);
      expect(cert!.variants?.passed).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('an answer changed after the run: no longer current', async () => {
    const f = await makeSource('changed');
    try {
      await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'row_per_variant' });
      await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
      await caller.sources.saveVariantAnswer({ sourceId: f.sourceId, url: f.urls[0]!, answer: { count: 2, labels: ['Black', 'Red'] } });
      await insertRun(f.sourceId, await verifiedVariants(f.sourceId));
      expect(await requireCertification(db, f.sourceId)).not.toBeNull();

      await caller.sources.saveVariantAnswer({ sourceId: f.sourceId, url: f.urls[0]!, answer: { count: 3, labels: ['Black', 'Red', 'White'] } });
      await expect(requireCertification(db, f.sourceId)).rejects.toMatchObject(blocked('Verify the variants before extracting'));
      expect((await loadVariantCurrency(db, f.sourceId)).current).toBe(false);
    } finally { await f.cleanup(); }
  });

  it('setting the project back to ignore unlocks without a new run', async () => {
    const f = await makeSource('backtoignore');
    try {
      await insertRun(f.sourceId, null);
      await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'row_per_variant' });
      await expect(requireCertification(db, f.sourceId)).rejects.toMatchObject(blocked("Set up this website's variants before extracting"));
      await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
      await expect(requireCertification(db, f.sourceId)).rejects.toMatchObject(blocked('Verify the variants before extracting'));

      await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'ignore' });
      const cert = await requireCertification(db, f.sourceId);
      expect(cert).not.toBeNull();
      expect(cert!.variants).toBeUndefined();
    } finally { await f.cleanup(); }
  });
});
