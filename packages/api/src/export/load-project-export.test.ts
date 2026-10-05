import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, runs, captures, extractions } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { loadProjectExport, projectExportFilename } from './load-project-export.js';

const caller = createCallerFactory(appRouter)({ db, session: null });

/** One run with one extraction holding `rows`, dated `createdAt`. */
async function seedRun(sourceId: string, rows: Record<string, unknown>[], createdAt: Date, status = 'completed') {
  const [r] = await db.insert(runs).values({ sourceId, status, createdAt, startedAt: createdAt, completedAt: status === 'completed' ? createdAt : null, resultCount: rows.length }).returning({ id: runs.id });
  const [c] = await db.insert(captures).values({ sourceId, runId: r!.id, url: 'https://x.example.com/', html: '<html></html>' }).returning({ id: captures.id });
  await db.insert(extractions).values({ sourceId, captureId: c!.id, runId: r!.id, data: rows, rowCount: rows.length });
  return r!.id;
}

describe('loadProjectExport', () => {
  it('returns null for an unknown project', async () => {
    expect(await loadProjectExport(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('merges the latest completed run of every website under a Website column, in contract order', async () => {
    const p = await caller.projects.create({ name: `Export ${Date.now()}` });
    try {
      await caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' });
      const price = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      const title = (await caller.datasets.getContract({ datasetId: p.datasetId })).find((f) => f.name === 'Title')!;
      const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha', url: 'https://alpha.example.com/' });
      const b = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Beta', url: 'https://beta.example.com/' });

      const old = new Date('2026-09-01T00:00:00Z');
      const newer = new Date('2026-09-02T00:00:00Z');
      await seedRun(a.sourceId, [{ [title.key]: 'Old', [price.key]: '1' }], old);
      const latestA = await seedRun(a.sourceId, [{ [title.key]: 'Chair', [price.key]: '10', _url: 'https://alpha.example.com/chair' }], newer);
      await seedRun(b.sourceId, [{ [title.key]: 'Never', [price.key]: '0' }], newer, 'failed'); // not completed: ignored
      const latestB = await seedRun(b.sourceId, [{ [title.key]: 'Table', [price.key]: '20' }], old);

      const x = (await loadProjectExport(db, p.id))!;
      expect(x.project.slug).toBe(p.slug);
      expect(x.fields).toEqual(['Website', 'Title', 'Price', '_url']);
      expect(x.rows).toEqual([
        { Website: 'Alpha', Title: 'Chair', Price: '10', _url: 'https://alpha.example.com/chair' },
        { Website: 'Beta', Title: 'Table', Price: '20' },
      ]);
      expect(x.rowCount).toBe(2);
      expect(x.websites).toEqual([
        { id: a.sourceId, name: 'Alpha', slug: a.sourceSlug, runId: latestA, completedAt: newer.toISOString(), rowCount: 1 },
        { id: b.sourceId, name: 'Beta', slug: b.sourceSlug, runId: latestB, completedAt: old.toISOString(), rowCount: 1 },
      ]);
      expect(projectExportFilename(x, 'csv')).toBe(`${p.slug}-${x.generatedAt.slice(0, 10)}.csv`);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });

  it('exports a customer column named "Website" as "Website (field)" so the merged column wins', async () => {
    const p = await caller.projects.create({ name: `Export collide ${Date.now()}` });
    try {
      const website = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Website', type: 'text' });
      const price = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha', url: 'https://alpha.example.com/' });
      await seedRun(a.sourceId, [{ [website.key]: 'acme.example.com', [price.key]: '9' }], new Date('2026-09-01T00:00:00Z'));

      const x = (await loadProjectExport(db, p.id))!;
      expect(x.fields).toEqual(['Website', 'Website (field)', 'Price']);
      expect(x.rows).toEqual([{ Website: 'Alpha', 'Website (field)': 'acme.example.com', Price: '9' }]);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });

  it('renames a raw extra key named "Website" too, listing it once', async () => {
    // No contract yet when the website is created, so its rows are exported raw:
    // "Website" arrives as an extra column rather than a contract one.
    const p = await caller.projects.create({ name: `Export extra ${Date.now()}` });
    try {
      const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha', url: 'https://alpha.example.com/' });
      await seedRun(a.sourceId, [{ Website: 'acme.example.com', Title: 'Chair' }], new Date('2026-09-01T00:00:00Z'));

      const x = (await loadProjectExport(db, p.id))!;
      // Extras keep the order the run export derived them in, which for raw rows
      // is jsonb's own key order (shorter key first) — the point here is that the
      // renamed column appears exactly once, after the synthetic one.
      expect(x.fields).toEqual(['Website', 'Title', 'Website (field)']);
      expect(x.rows).toEqual([{ Website: 'Alpha', 'Website (field)': 'acme.example.com', Title: 'Chair' }]);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });

  it('shapes a variants project (row_per_variant): product fields, axes, variant fields, then product_key/variant_key', async () => {
    const p = await caller.projects.create({ name: `Export variants ${Date.now()}` });
    try {
      const title = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text', concept: 'product_name' });
      const price = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money', concept: 'price' });
      const axis = await caller.datasets.addAxis({ datasetId: p.datasetId, name: 'Colour' });
      await caller.datasets.setVariantMode({ datasetId: p.datasetId, mode: 'row_per_variant' });
      const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha', url: 'https://alpha.example.com/' });

      await seedRun(a.sourceId, [
        { [title.key]: 'Chair', [axis.key]: 'Red', [price.key]: 10, _product_key: 'p1', _variant_key: 'v1' },
        { [title.key]: 'Chair', [axis.key]: 'Blue', [price.key]: 12, _product_key: 'p1', _variant_key: 'v2' },
      ], new Date('2026-09-01T00:00:00Z'));

      const x = (await loadProjectExport(db, p.id))!;
      expect(x.fields).toEqual(['Website', 'Title', 'Colour', 'Price', 'product_key', 'variant_key']);
      expect(x.rows).toEqual([
        { Website: 'Alpha', Title: 'Chair', Colour: 'Red', Price: 10, product_key: 'p1', variant_key: 'v1' },
        { Website: 'Alpha', Title: 'Chair', Colour: 'Blue', Price: 12, product_key: 'p1', variant_key: 'v2' },
      ]);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });

  it('keeps raw contract storage order for an `ignore` project even when a field defaults to variant level', async () => {
    // `price` is a VARIANT_CONCEPTS field, so it would default to `variant`
    // level under effectiveLevel — but this project never turned variants on,
    // so reordering by level here must not happen (today's byte-identical
    // column order for a flat project).
    const p = await caller.projects.create({ name: `Export flat order ${Date.now()}` });
    try {
      const price = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money', concept: 'price' });
      const title = await caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text', concept: 'product_name' });
      const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha', url: 'https://alpha.example.com/' });
      await seedRun(a.sourceId, [{ [price.key]: 10, [title.key]: 'Chair' }], new Date('2026-09-01T00:00:00Z'));

      const x = (await loadProjectExport(db, p.id))!;
      expect(x.fields).toEqual(['Website', 'Price', 'Title']);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });

  it('lists a website with no completed run with a null run and no rows', async () => {
    const p = await caller.projects.create({ name: `Export empty ${Date.now()}` });
    try {
      const a = await caller.sources.createInProject({ projectSlug: p.slug, name: 'Alpha', url: 'https://alpha.example.com/' });
      const x = (await loadProjectExport(db, p.id))!;
      expect(x.fields).toEqual(['Website']);
      expect(x.rows).toEqual([]);
      expect(x.websites).toEqual([{ id: a.sourceId, name: 'Alpha', slug: a.sourceSlug, runId: null, completedAt: null, rowCount: 0 }]);
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });
});
