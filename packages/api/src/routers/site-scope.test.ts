// Every per-website and per-run procedure takes its org from the session
// (spec 2026-09-21 §6): a website or run in another org is NOT_FOUND, the same
// word as one that does not exist. The session-less shim the old dashboard
// still uses is exercised at the bottom.
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, projects, users, runs } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

const tag = `site-scope-${Date.now()}`;
const HOST = 'https://a.example.com';
const PROOF = [`${HOST}/p/1`, `${HOST}/p/2`, `${HOST}/p/3`];

async function signIn(email: string) {
  const cookies: Record<string, string | null> = {};
  const c = createCallerFactory(appRouter)({ db, session: null, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: () => {} });
  const r = await c.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  return { ...r, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

async function dropIdentity(r: { org: { id: string }; user: { id: string } }) {
  await db.delete(projects).where(eq(projects.orgId, r.org.id));
  await deleteOwnOrg(r.org.id);
  await db.delete(users).where(eq(users.id, r.user.id));
}

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

      const bc = b.caller;
      const calls: Array<[string, () => Promise<unknown>]> = [
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
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });

  it('still answers a session-less caller the way the old dashboard calls it', async () => {
    const bare = createCallerFactory(appRouter)({ db, session: null });
    const p = await bare.projects.create({ name: `Shim ${tag}` });
    try {
      const w = await bare.sources.createInProject({ projectSlug: p.slug, name: 'Shim shop', url: 'https://shim.example.com/' });
      const got = await bare.sources.get({ projectSlug: p.slug, sourceSlug: w.sourceSlug, orgSlug: 'default' });
      expect(got.id).toBe(w.sourceId);
      expect(got.hostname).toBe('shim.example.com');
      const renamed = await bare.sources.rename({ sourceId: w.sourceId, name: 'Shim shop 2' });
      expect(renamed.name).toBe('Shim shop 2');
    } finally {
      await db.delete(projects).where(eq(projects.id, p.id));
    }
  });
});
