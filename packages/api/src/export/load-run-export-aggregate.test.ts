// Phase 2 writes ONE extraction per URL. Reading only the latest one would show
// a 500-item crawl as a single row — and the CSV export would deliver one.
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, runs, sources, orgs, projects, datasets, captures, extractions } from '@robot/db';
import { loadRunExport } from './load-run-export.js';

const SLUG = 'test-export-aggregate';
let orgId: string | null = null;

async function seedRunWithExtractions(rows: Array<Record<string, unknown>>) {
  const [org] = await db.insert(orgs).values({ name: SLUG, slug: SLUG }).returning();
  orgId = org!.id;
  const [project] = await db.insert(projects).values({ orgId: org!.id, name: SLUG, slug: SLUG }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: SLUG, slug: SLUG, schema: [] }).returning();
  const [source] = await db.insert(sources).values({
    datasetId: dataset!.id, name: SLUG, slug: SLUG, country: 'US',
    selectorsJson: { fields: [{ name: 'title', type: 'string' }] },
  }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'completed' }).returning();

  for (const row of rows) {
    const [capture] = await db.insert(captures).values({
      sourceId: source!.id, runId: run!.id, url: String(row._url ?? 'https://example.com/p/x'),
    }).returning({ id: captures.id });
    await db.insert(extractions).values({
      sourceId: source!.id, captureId: capture!.id, runId: run!.id, data: [row], rowCount: 1,
    });
  }
  return run!.id;
}

afterEach(async () => {
  if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId));
  orgId = null;
});

describe('loadRunExport across many extractions', () => {
  it('returns every row of the run, not just the last one', async () => {
    const runId = await seedRunWithExtractions([
      { title: 'One', _url: 'https://example.com/p/1' },
      { title: 'Two', _url: 'https://example.com/p/2' },
      { title: 'Three', _url: 'https://example.com/p/3' },
    ]);

    const result = await loadRunExport(db, runId);
    expect(result?.rows).toHaveLength(3);
    expect(result?.rows.map((r) => r.title)).toEqual(['One', 'Two', 'Three']);
    expect(result?.run.rowCount).toBe(3);
  });

  it('keeps the system column so a row can be traced to its page', async () => {
    const runId = await seedRunWithExtractions([{ title: 'One', _url: 'https://example.com/p/1' }]);
    const result = await loadRunExport(db, runId);
    expect(result?.fields).toContain('_url');
  });

  it('still reads a single-extraction run exactly as before', async () => {
    const runId = await seedRunWithExtractions([{ title: 'Only', _url: 'https://example.com/p/1' }]);
    const result = await loadRunExport(db, runId);
    expect(result?.rows).toEqual([{ title: 'Only', _url: 'https://example.com/p/1' }]);
  });
});
