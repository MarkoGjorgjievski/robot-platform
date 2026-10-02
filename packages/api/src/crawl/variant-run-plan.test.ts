// packages/api/src/crawl/variant-run-plan.test.ts
// loadVariantRunPlan: null unless the certification carries variants,
// otherwise the plan's method/list/entryPaths/fromProduct carried through
// from the certification, plus the contract's fields (with effective level)
// and the setup's mapped axes that still exist on the dataset.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, datasets } from '@robot/db';
import type { VariantVerification } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import type { Certification } from '../verify/current-certification.js';
import { loadVariantRunPlan } from './variant-run-plan.js';

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db, session: null });

function certWithout(): Certification {
  return { verificationId: 'v1', completedAt: new Date(), paths: {}, concepts: {}, hostname: 'example.com' };
}
function certWith(variants: VariantVerification): Certification {
  return { ...certWithout(), variants };
}

describe('loadVariantRunPlan', () => {
  it('returns null unless cert.variants is set', async () => {
    const f = await createProjectWithSource(caller, { tag: 'planplain', fields: [{ name: 'Price', type: 'money' }] });
    try {
      expect(await loadVariantRunPlan(db, f.sourceId, null)).toBeNull();
      expect(await loadVariantRunPlan(db, f.sourceId, certWithout())).toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  it('with a list certification, returns method, list, entry paths and the fields with levels', async () => {
    const f = await createProjectWithSource(caller, { tag: 'planlist', fields: [{ name: 'Title', type: 'text' }, { name: 'Price', type: 'money' }] });
    try {
      const sku = await caller.datasets.addField({ datasetId: f.datasetId, name: 'SKU', type: 'text', concept: 'sku' });
      const setup = await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
      const colourKey = setup.axes[0]!.axisKey;

      const variants: VariantVerification = {
        method: 'list',
        hash: 'h',
        passed: true,
        list: { source: 'json-ld', path: 'hasVariant' },
        entryPaths: {
          [f.keys.Price!]: { kind: 'path', path: 'offers.price' },
          [colourKey]: { kind: 'axis', from: 'color' },
        },
        fromProduct: [f.keys.Title!],
        pages: {},
      };

      const plan = await loadVariantRunPlan(db, f.sourceId, certWith(variants));
      expect(plan).not.toBeNull();
      expect(plan!.method).toBe('list');
      expect(plan!.list).toEqual({ source: 'json-ld', path: 'hasVariant' });
      expect(plan!.entryPaths).toEqual(variants.entryPaths);
      expect(plan!.fromProduct).toEqual([f.keys.Title!]);
      expect(plan!.fields).toEqual([
        { key: f.keys.Title!, name: 'Title', type: 'text', level: 'product' },
        { key: f.keys.Price!, name: 'Price', type: 'money', level: 'variant' },
        { key: sku.key, name: 'SKU', type: 'text', level: 'variant' },
      ]);
      expect(plan!.skuKey).toBe(sku.key);
      expect(plan!.gtinKey).toBeUndefined();
      expect(plan!.axes).toEqual([{ key: colourKey, name: 'Colour' }]);
    } finally {
      await f.cleanup();
    }
  });

  it('drops an axis whose column was deleted', async () => {
    const f = await createProjectWithSource(caller, { tag: 'planaxis', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const setup = await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
      const colourKey = setup.axes[0]!.axisKey;

      // The app's deleteAxis refuses this while a website still maps the axis (datasets.ts) —
      // written directly, past that guard, to exercise the defence loadVariantRunPlan needs
      // regardless of how a setup came to outlive its axis.
      const row = await db.query.datasets.findFirst({ where: eq(datasets.id, f.datasetId) });
      const schema = row!.schema as Array<Record<string, unknown>>;
      await db.update(datasets).set({ schema: schema.filter((e) => e.key !== colourKey) }).where(eq(datasets.id, f.datasetId));

      const variants: VariantVerification = {
        method: 'list',
        hash: 'h',
        passed: true,
        list: { source: 'json-ld', path: 'hasVariant' },
        entryPaths: { [colourKey]: { kind: 'axis', from: 'color' } },
        pages: {},
      };
      const plan = await loadVariantRunPlan(db, f.sourceId, certWith(variants));
      expect(plan!.axes).toEqual([]);
    } finally {
      await f.cleanup();
    }
  });
});
