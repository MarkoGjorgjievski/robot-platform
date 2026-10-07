// Every per-website and per-run procedure takes its org from the session
// (spec 2026-09-21 §6): a website or run in another org is NOT_FOUND, the same
// word as one that does not exist. A caller with no session is UNAUTHORIZED
// on every one of them (cut-over; final review C1), exercised at the bottom.
import { describe, it, expect, vi } from 'vitest';
import { db, runs } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { signIn } from '../test-helpers/identity.js';

// `captureProofPage` fires a real browser un-awaited; stub the job so this file never launches one.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../verify/proof-page-capture.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/proof-page-capture.js')>();
  return { ...real, runProofPageCapture: runMock, startProofPageCapture: (s: string, u: string) => real.startProofPageCapture(s, u, { fire: false }) };
});

const tag = `site-scope-${Date.now()}`;
const HOST = 'https://a.example.com';
const PROOF = [`${HOST}/p/1`, `${HOST}/p/2`, `${HOST}/p/3`];

const createCaller = createCallerFactory(appRouter);
type Caller = ReturnType<typeof createCaller>;

/** Every per-website and per-run procedure, aimed at one website's ids. */
function scopedCalls(bc: Caller, ids: { projectSlug: string; sourceSlug: string; sourceId: string; runId: string; captureId: string }): Array<[string, () => Promise<unknown>]> {
  const { sourceId, runId, captureId } = ids;
  const p = { slug: ids.projectSlug };
  const w = { sourceSlug: ids.sourceSlug };
  return [
      ['sources.get', () => bc.sources.get({ projectSlug: p.slug, sourceSlug: w.sourceSlug })],
      ['sources.rename', () => bc.sources.rename({ sourceId, name: 'X' })],
      ['sources.update', () => bc.sources.update({ id: sourceId, isActive: false })],
      ['sources.setListingPages', () => bc.sources.setListingPages({ sourceId, urls: [`${HOST}/l`] })],
      ['sources.setProductUrls', () => bc.sources.setProductUrls({ sourceId, urls: [`${HOST}/p`] })],
      ['sources.updateBinding', () => bc.sources.updateBinding({ sourceId, urls: PROOF, descriptions: {}, expected: {} })],
      ['sources.inputRows', () => bc.sources.inputRows({ sourceId })],
      ['sources.verifyEstimate', () => bc.sources.verifyEstimate({ sourceId })],
      ['sources.verificationStatus', () => bc.sources.verificationStatus({ sourceId })],
      ['sources.verify', () => bc.sources.verify({ sourceId })],
      ['sources.confirm', () => bc.sources.confirm({ sourceId })],
      ['sources.delete', () => bc.sources.delete({ sourceId })],
      ['sources.captureProofPage', () => bc.sources.captureProofPage({ sourceId, url: `${HOST}/` })],
      ['sources.proofPageCapture', () => bc.sources.proofPageCapture({ captureId })],
      ['sources.suggestMarks', () => bc.sources.suggestMarks({ captureId })],
      ['sources.proofPageCaptures', () => bc.sources.proofPageCaptures({ sourceId, urls: [`${HOST}/p/1`] })],
      ['sources.transferMarks', () => bc.sources.transferMarks({ sourceId, fromUrl: PROOF[0]!, toUrls: [PROOF[1]!] })],
      ['runs.getWithDetails', () => bc.runs.getWithDetails({ id: runId })],
      ['runs.listBySource', () => bc.runs.listBySource({ sourceId })],
      ['crawl.plan', () => bc.crawl.plan({ sourceId, probe: true })],
      ['crawl.probeAndSample', () => bc.crawl.probeAndSample({ sourceId })],
      ['crawl.items', () => bc.crawl.items({ runId })],
      ['crawl.status', () => bc.crawl.status({ runId })],
      ['crawl.cancel', () => bc.crawl.cancel({ runId })],
      ['crawl.execute', () => bc.crawl.execute({ runId, dryRun: true })],
      ['crawl.coverage', () => bc.crawl.coverage({ runId })],
      ['crawl.misses', () => bc.crawl.misses({ runId })],
      ['crawl.backfillPreview', () => bc.crawl.backfillPreview({ runId })],
      ['crawl.backfill', () => bc.crawl.backfill({ runId })],
  ];
}

const dropIdentity = (r: { cleanup: () => Promise<void> }) => r.cleanup();

describe('website and run procedures are scoped to the session org', () => {
  it('answers NOT_FOUND to every one of them when the caller is in another org', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-a@example.com`);
      b = await signIn(`${tag}-b@example.com`);

      const p = await a.caller.projects.create({ name: 'Scoped prices' });
      await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Title', type: 'text' });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'A shop', url: `${HOST}/` });
      const sourceId = w.sourceId;
      await a.caller.sources.setListingPages({ sourceId, urls: [`${HOST}/l`] });
      const [run] = await db.insert(runs).values({ sourceId, status: 'completed', completedAt: new Date(), resultCount: 1 }).returning({ id: runs.id });
      const runId = run!.id;
      const { captureId } = await a.caller.sources.captureProofPage({ sourceId, url: `${HOST}/p/1` });

      const calls = scopedCalls(b.caller, { projectSlug: p.slug, sourceSlug: w.sourceSlug, sourceId, runId, captureId });
      for (const [name, call] of calls) await expect(call(), name).rejects.toMatchObject({ code: 'NOT_FOUND' });

      // The owning org sees the website itself, with its project and the contract.
      const got = await a.caller.sources.get({ projectSlug: p.slug, sourceSlug: w.sourceSlug });
      expect(got.id).toBe(sourceId);
      expect(got.hostname).toBe('a.example.com');
      expect(got.url).toBe(`${HOST}/`);
      expect(got.fields.map((f) => f.name)).toEqual(['Price', 'Title']);
      expect(got.project.slug).toBe(p.slug);
      expect(got.listingMode).toBe('listing_to_detail');
      expect(got.confirmedAt).toBeNull();
      // A website whose Extract tab has saved pages owns its budget, seeded
      // all/all — the non-null branch of the `budgetIsUnchosen` rule.
      expect(got.budget).toEqual({ max_items: 'all', max_pages: 'all', mode: 'all' });

      // A website nobody has set pages on has no budget: the column's `{}`
      // default must not be handed out as a budget object.
      const fresh = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Fresh shop', url: `${HOST}/f` });
      const freshGot = await a.caller.sources.get({ projectSlug: p.slug, sourceSlug: fresh.sourceSlug });
      expect(freshGot.budget).toBeNull();

      // ...but a budget saved through `sources.update` — the Settings tab's
      // budget row, which never touches the input set and so sets no
      // `parameters.inputMode` — is a choice, and comes back even when it is
      // exactly the old flow's automatic 40/3 starter. Without the
      // `parameters.budgetChosen` marker this read `null`, the Settings row
      // reset itself to all/all, and the next Extract wrote all over it.
      const chosen = { max_items: 40, max_pages: 3, mode: 'first_n' as const };
      await a.caller.sources.update({ id: fresh.sourceId, budget: chosen });
      const chosenGot = await a.caller.sources.get({ projectSlug: p.slug, sourceSlug: fresh.sourceSlug });
      expect(chosenGot.budget).toEqual(chosen);
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('answers UNAUTHORIZED to every one of them without a session, and changes nothing', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`${tag}-anon@example.com`);
      const p = await a.caller.projects.create({ name: `Guarded ${tag}` });
      const w = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Guarded shop', url: `${HOST}/` });
      const sourceId = w.sourceId;
      const [run] = await db.insert(runs).values({ sourceId, status: 'completed', completedAt: new Date(), resultCount: 1 }).returning({ id: runs.id });
      const { captureId } = await a.caller.sources.captureProofPage({ sourceId, url: `${HOST}/p/1` });

      const bare = createCaller({ db, session: null });
      const calls: Array<[string, () => Promise<unknown>]> = [
        ...scopedCalls(bare, { projectSlug: p.slug, sourceSlug: w.sourceSlug, sourceId, runId: run!.id, captureId }),
        ['sources.createInProject', () => bare.sources.createInProject({ projectSlug: p.slug, name: 'X', url: `${HOST}/` })],
        // A session-less caller must not be able to point the server's browser anywhere.
        ['sources.checkListingPage', () => bare.sources.checkListingPage({ listingUrl: 'http://127.0.0.1/' })],
      ];
      for (const [name, call] of calls) await expect(call(), name).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

      const got = await a.caller.sources.get({ projectSlug: p.slug, sourceSlug: w.sourceSlug });
      expect(got.name).toBe('Guarded shop');
      expect((await a.caller.projects.get({ projectSlug: p.slug })).websites).toHaveLength(1);
    } finally {
      if (a) await dropIdentity(a);
    }
  });
});
