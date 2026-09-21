import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, runs, captures, extractions } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { loadProjectExport, projectExportFilename } from './load-project-export.js';

const caller = createCallerFactory(appRouter)({ db, session: null });

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

      async function run(sourceId: string, rows: Record<string, unknown>[], createdAt: Date, status = 'completed') {
        const [r] = await db.insert(runs).values({ sourceId, status, createdAt, startedAt: createdAt, completedAt: status === 'completed' ? createdAt : null, resultCount: rows.length }).returning({ id: runs.id });
        const [c] = await db.insert(captures).values({ sourceId, runId: r!.id, url: 'https://x.example.com/', html: '<html></html>' }).returning({ id: captures.id });
        await db.insert(extractions).values({ sourceId, captureId: c!.id, runId: r!.id, data: rows, rowCount: rows.length });
        return r!.id;
      }
      const old = new Date('2026-09-01T00:00:00Z');
      const newer = new Date('2026-09-02T00:00:00Z');
      await run(a.sourceId, [{ [title.key]: 'Old', [price.key]: '1' }], old);
      const latestA = await run(a.sourceId, [{ [title.key]: 'Chair', [price.key]: '10', _url: 'https://alpha.example.com/chair' }], newer);
      await run(b.sourceId, [{ [title.key]: 'Never', [price.key]: '0' }], newer, 'failed'); // not completed: ignored
      const latestB = await run(b.sourceId, [{ [title.key]: 'Table', [price.key]: '20' }], old);

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
