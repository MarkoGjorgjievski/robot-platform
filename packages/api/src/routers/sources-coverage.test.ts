// packages/api/src/routers/sources-coverage.test.ts
// sources.coverage (spec 2026-10-10 §A5): the website's latest coverage check,
// summarised per field with its stage line, org-scoped. Rows are seeded; the
// job itself is covered in verify/run-coverage-check.test.ts.
import { describe, it, expect, afterAll } from 'vitest';
import { db, coverageChecks } from '@robot/db';
import type { Shape } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import type { CoverageResults } from '../verify/coverage-summary.js';

const a = await signedInCaller('sources-coverage-a');
const b = await signedInCaller('sources-coverage-b');
afterAll(async () => { await a.cleanup(); await b.cleanup(); });

const single: Shape = { jsonLdTypes: ['Product'], offers: 'top-level', rating: true, address: '/p/n' };
const multi: Shape = { jsonLdTypes: ['ProductGroup'], offers: 'in-variants', rating: true, address: '/p/n' };

describe('sources.coverage', () => {
  it('null before any check; a done check comes back with its per-field summary and stage line', async () => {
    const f = await createProjectWithSource(a.caller, { tag: 'cov-router', fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }] });
    try {
      expect(await a.caller.sources.coverage({ sourceId: f.sourceId })).toBeNull();

      const price = f.keys.Price!;
      const page = (i: number, empty: string[], shape: Shape) => ({ url: `https://test-cov-router.example.com/p/${i}`, empty, shape });
      const results: CoverageResults = {
        listingUrl: 'https://test-cov-router.example.com/l',
        sampled: [
          ...Array.from({ length: 11 }, (_, i) => page(10 + i, [price], multi)),
          ...Array.from({ length: 8 }, (_, i) => page(30 + i, [], single)),
          { url: 'https://test-cov-router.example.com/p/40', unread: 'test-cov-router.example.com refused the browser (HTTP 403).' },
        ],
        proofShapes: Object.fromEntries(f.urls.map((u) => [u, single])),
        planned: 20,
      };
      const [row] = await db.insert(coverageChecks).values({ sourceId: f.sourceId, status: 'done', results, completedAt: new Date() }).returning();

      const got = (await a.caller.sources.coverage({ sourceId: f.sourceId }))!;
      expect(got).toMatchObject({ id: row!.id, status: 'done', error: null, results });
      expect(got.fields).toEqual([{
        key: price,
        empty: Array.from({ length: 11 }, (_, i) => `https://test-cov-router.example.com/p/${10 + i}`),
        sampled: 19, unread: 1,
        explanation: 'all 11 list their sizes as variants in the page data',
        representative: 'https://test-cov-router.example.com/p/10',
      }]);
      expect(got.stage).toBe('1 field was empty on some of the 19 sampled products — see the row.');
    } finally { await f.cleanup(); }
  });

  it('a failed check reads its error as the stage', async () => {
    const f = await createProjectWithSource(a.caller, { tag: 'cov-router-failed', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await db.insert(coverageChecks).values({ sourceId: f.sourceId, status: 'failed', error: 'shop.example showed a CAPTCHA.', completedAt: new Date() });
      expect(await a.caller.sources.coverage({ sourceId: f.sourceId })).toMatchObject({ status: 'failed', fields: [], stage: 'shop.example showed a CAPTCHA.' });
    } finally { await f.cleanup(); }
  });

  it('another org gets NOT_FOUND, as from driftCheck', async () => {
    const f = await createProjectWithSource(a.caller, { tag: 'cov-router-org', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await db.insert(coverageChecks).values({ sourceId: f.sourceId, status: 'done', results: { listingUrl: '', sampled: [], proofShapes: {} }, completedAt: new Date() });
      const nf = { code: 'NOT_FOUND' };
      await expect(b.caller.sources.driftCheck({ sourceId: f.sourceId })).rejects.toMatchObject(nf);
      await expect(b.caller.sources.coverage({ sourceId: f.sourceId })).rejects.toMatchObject(nf);
      // Their own org may.
      expect(await a.caller.sources.coverage({ sourceId: f.sourceId })).toMatchObject({ status: 'done', fields: [], stage: null });
    } finally { await f.cleanup(); }
  });
});
