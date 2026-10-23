// Spec 2026-10-23 §7.1–7.2: the api-server process never launches Chromium, and every procedure that
// used to load a page (or run a script in a browser) now goes through a job. A fake worker answers the
// jobs here, so nothing real runs; the launch guard is on, so a launch anywhere would throw.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, jobs, projects, datasets, sources, runs, runItems } from '@robot/db';
import { signedInCaller } from '@robot/api/test-helpers/identity';
import { createProjectWithSource } from '@robot/api/test-helpers/customer-source';
import { startJobRunner, jobQueueName, JOB_POLICIES, type Registry, type JobRunner } from '@robot/api/jobs';
import { PlaywrightBrowser } from '@robot/browser';
import { configureApiProcess } from './process.js';

configureApiProcess();

const me = await signedInCaller('no-browser');
const canned: Record<string, (p: any) => unknown> = {
  reachability: (p) => ({ url: p.url, ok: true, message: null }),
  'listing-check': () => ({ groupSize: 0, sample: [], pager: false, message: null }),
  'transfer-marks': () => ({}),
  'detect-variants': () => ({ pages: [], suggested: 'none' }),
  'variant-links-near': () => null,
  plan: (p) => ({ runId: p.runId, status: 'planned', itemCount: 0, listingPages: 0, warnings: [], errors: [], inputs: [], cacheWarm: false }),
};
const fake: Registry = Object.fromEntries(Object.entries(JOB_POLICIES).map(([type, policy]) => [type, {
  policy, run: async (p: unknown) => canned[type]?.(p) ?? null,
}]));
let worker: JobRunner;
beforeAll(() => { worker = startJobRunner({ queue: jobQueueName(), registry: fake, lanes: { interactive: 3, background: 2, runs: 1 }, pollMs: 25, log: () => {} }); });
afterAll(async () => { await worker.stop(2000); await me.cleanup(); });

/** A scratch website (no customer schema, so no certification gate) with one planned run and one detail item: `crawl.execute` accepts it. */
async function seedPlannedRun(): Promise<{ runId: string; cleanup(): Promise<void> }> {
  const slug = `test-no-browser-${Date.now()}`;
  const [project] = await db.insert(projects).values({ orgId: me.session.org!.id, name: slug, slug }).returning();
  const [dataset] = await db.insert(datasets).values({ projectId: project!.id, name: slug, slug, schema: [] }).returning();
  const [source] = await db.insert(sources).values({ datasetId: dataset!.id, name: slug, slug, country: 'US' }).returning();
  const [run] = await db.insert(runs).values({ sourceId: source!.id, status: 'planned' }).returning();
  await db.insert(runItems).values({ runId: run!.id, kind: 'detail', url: 'https://shop.test/p/9', inputIndex: 0, status: 'pending' });
  return { runId: run!.id, cleanup: async () => { await db.delete(projects).where(eq(projects.id, project!.id)); } };
}

describe('the api-server starts no browser', () => {
  it('Chromium cannot launch in this process', async () => {
    await expect(new PlaywrightBrowser().launch({ headless: true })).rejects.toThrow(/never starts a browser/);
  });

  it('every procedure that loaded a page goes through a job', async () => {
    const urls = ['https://shop.test/p/1', 'https://shop.test/p/2', 'https://shop.test/p/3'];
    const f = await createProjectWithSource(me.caller, {
      tag: 'no-browser', fields: [{ name: 'Title', type: 'text' }], urls, listingUrl: 'https://shop.test/list',
      expected: { Title: Object.fromEntries(urls.map((u, i) => [u, `Widget ${i + 1}`])) },
    });
    const scratch = await seedPlannedRun();
    try {
      const c = me.caller;
      const url = urls[0]!;
      await c.sources.reachability({ url });
      await c.sources.checkListingPage({ listingUrl: 'https://shop.test/list' });
      await c.sources.captureProofPage({ sourceId: f.sourceId, url });
      await c.sources.transferMarks({ sourceId: f.sourceId, fromUrl: url, toUrls: [urls[1]!] });
      await c.sources.detectVariants({ sourceId: f.sourceId });
      await c.sources.variantLinksNear({ sourceId: f.sourceId, url, xpath: '//a' });
      await c.sources.checkDrift({ sourceId: f.sourceId });
      await c.crawl.plan({ sourceId: f.sourceId, probe: true });
      await c.crawl.execute({ runId: scratch.runId });
      await c.sources.verify({ sourceId: f.sourceId });
      const types = new Set((await db.query.jobs.findMany({ where: eq(jobs.queue, jobQueueName()) })).map((j) => j.type));
      for (const t of ['reachability', 'listing-check', 'proof-page-capture', 'transfer-marks', 'detect-variants', 'variant-links-near', 'drift-check', 'plan', 'run', 'verify']) {
        expect(types, `no ${t} job`).toContain(t);
      }
    } finally {
      await scratch.cleanup();
      await f.cleanup();
    }
  });
});
