// The sweep claims a due website and enqueues its check in one transaction: an enqueue that fails leaves
// the website due, so the next sweep tries it again (whole-branch final list).
import { describe, it, expect, vi, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources, sourceVerifications } from '@robot/db';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { jobsOf } from '../test-helpers/jobs.js';

const { failEnqueue } = vi.hoisted(() => ({ failEnqueue: { on: false } }));
vi.mock('../jobs/enqueue.js', async (orig) => {
  const real = await orig<typeof import('../jobs/enqueue.js')>();
  return { ...real, enqueue: (async (...args: Parameters<typeof real.enqueue>) => {
    if (failEnqueue.on) throw new Error('the database went away');
    return real.enqueue(...args);
  }) as typeof real.enqueue };
});
const { enqueueDueWebsiteChecks } = await import('./website-checks.js');

const me = await signedInCaller('website-checks-sweep');
afterAll(async () => { await me.cleanup(); });

async function dueWebsite(tag: string) {
  const urls = [1, 2, 3].map((n) => `https://test-${tag}.example.com/p/${n}`);
  const f = await createProjectWithSource(me.caller, {
    tag, urls, fields: [{ name: 'Price', type: 'money' }], expected: { Price: Object.fromEntries(urls.map((u, i) => [u, `${i + 1}.00`])) },
  });
  await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results: {} });
  await db.update(sources).set({ nextCheckAt: null }).where(eq(sources.id, f.sourceId));
  return f;
}
const nextCheck = async (id: string) => (await db.query.sources.findFirst({ where: eq(sources.id, id), columns: { nextCheckAt: true } }))!.nextCheckAt;

describe('enqueueDueWebsiteChecks', () => {
  it('an enqueue that fails leaves the website due: its claim is undone with it', async () => {
    const f = await dueWebsite('sweep-fail');
    try {
      failEnqueue.on = true;
      try { await expect(enqueueDueWebsiteChecks({ only: [f.sourceId] })).rejects.toThrow('the database went away'); } finally { failEnqueue.on = false; }
      expect(await nextCheck(f.sourceId)).toBeNull();
      expect(await jobsOf('website-check')).toEqual([]);
      // The next sweep takes it.
      expect(await enqueueDueWebsiteChecks({ only: [f.sourceId] })).toEqual([f.sourceId]);
      expect(await nextCheck(f.sourceId)).not.toBeNull();
      expect((await jobsOf('website-check')).map((j) => j.payload)).toEqual([{ sourceId: f.sourceId }]);
    } finally { await f.cleanup(); }
  });
});
