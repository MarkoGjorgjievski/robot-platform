// packages/api/src/verify/run-coverage-check.test.ts
// The coverage check job (spec 2026-10-10 §A; properties 1, 3, 7): DB-backed,
// with the listing, the per-page extraction and the proof pages' shapes all
// injected — no browser is launched in this file and no page is loaded.
// Never a model call, never a write outside coverage_checks.
import { describe, it, expect, afterAll, vi } from 'vitest';
import { eq, count, inArray } from 'drizzle-orm';
import { db, captures, coverageChecks, domainIntelligence, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type Shape, type VerificationSet, type VerifiedField } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import type { CoverageResults } from './coverage-summary.js';

// No agent, ever: constructing one fails the file.
const { agentCtor } = vi.hoisted(() => ({ agentCtor: vi.fn() }));
vi.mock('@robot/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/agent')>();
  class SpySchemaAgent { constructor() { agentCtor(); } }
  return { ...actual, SchemaAgent: SpySchemaAgent };
});

const { startCoverageCheck, runCoverageCheck, latestCoverageCheck, COVERAGE_CHECK_STALL_MS, COVERAGE_WALL_BREAKER } = await import('./run-coverage-check.js');

// A throwaway signed-in identity: nothing here touches the seeded `default` org.
const me = await signedInCaller('run-coverage-check');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });

const single: Shape = { jsonLdTypes: ['Product'], offers: 'top-level', rating: true, address: '/p/n' };
const multi: Shape = { ...single, jsonLdTypes: ['ProductGroup'], offers: 'in-variants' };
const LISTED = (n: number) => Array.from({ length: n }, (_, i) => `https://test-cov.example.com/p/${i + 1}`);
const listing = (n: number) => vi.fn(async () => ({ productUrls: LISTED(n), verdictMessage: null }));
const proofShapes = vi.fn(async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, single])));

// Scoped to this website and the hosts it could touch: other test files write these tables in parallel.
const capturesOf = async (sourceId: string) => (await db.select({ n: count() }).from(captures).where(eq(captures.sourceId, sourceId)))[0]!.n;
const verificationsOf = async (sourceId: string) => (await db.select({ n: count() }).from(sourceVerifications).where(eq(sourceVerifications.sourceId, sourceId)))[0]!.n;
const domainCacheOf = async (hosts: string[]) => JSON.stringify(await db.select().from(domainIntelligence).where(inArray(domainIntelligence.domain, hosts)));
const setOf = async (sourceId: string) => {
  const s = (await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { verificationSet: true, schemaDefinition: true } }))!;
  return JSON.stringify([s.verificationSet, s.schemaDefinition]);
};
const checkRow = async (id: string) => (await db.query.coverageChecks.findFirst({ where: eq(coverageChecks.id, id) }))!;

const CERTIFIED: Record<'price' | 'title', CertifiedPath[]> = {
  price: [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }],
  title: [{ source: 'json-ld', path: 'name', transform: 'identity' }],
};

/** A website with price and title certified on its three proof pages (a current verification), and — unless `listingUrl: null` — a listing page. */
async function certifiedWebsite(tag: string, opts: { listingUrl?: string | null } = {}) {
  const host = `test-${tag}.example.com`;
  const U = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
  const listingUrl = opts.listingUrl === undefined ? `https://${host}/l` : opts.listingUrl;
  const f = await createProjectWithSource(caller, {
    tag,
    urls: U,
    ...(listingUrl ? { listingUrl } : {}),
    fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
    expected: {
      Price: { [U[0]!]: '1.00', [U[1]!]: '2.00', [U[2]!]: '3.00' },
      Title: { [U[0]!]: 'A', [U[1]!]: 'B', [U[2]!]: 'C' },
    },
  });
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const fields = src.schemaDefinition as SchemaDefinitionField[];
  const set = src.verificationSet as VerificationSet;
  const byName = (n: string) => fields.find((x) => x.name === n)!;
  const keyOf = { price: byName('Price').key, title: byName('Title').key };
  const results = Object.fromEntries((['price', 'title'] as const).map((k) => {
    const field = byName(k === 'price' ? 'Price' : 'Title');
    const certified = CERTIFIED[k];
    const cells = Object.fromEntries(U.map((u) => [u, { status: 'pass', found: 'x', path: certified[0] }]));
    return [field.key, { key: field.key, cells, certified, weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(field, set) }];
  }));
  await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results });
  return { ...f, keyOf, proofUrls: U, listingUrl };
}

/** Every page read; price empty (and the page multi-size) where `emptyOn` says so. */
const extractWith = (keyOf: { price: string; title: string }, emptyOn: (url: string) => boolean) =>
  vi.fn(async (url: string, _fields: VerifiedField[]) => ({
    data: { [keyOf.price]: emptyOn(url) ? null : '1.00', [keyOf.title]: 'x' },
    shape: emptyOn(url) ? multi : single,
  }));
const emptyOn = (u: string) => /\/p\/(1|2|3)\d$/.test(u);

describe('runCoverageCheck (spec 2026-10-10 §A)', () => {
  it('property 1: samples twenty, reads them with the certified paths, records empties with shapes; writes only its own row', async () => {
    const f = await certifiedWebsite('cov-a');
    try {
      const hosts = ['test-cov.example.com', new URL(f.proofUrls[0]!).hostname];
      const before = { captures: await capturesOf(f.sourceId), domains: await domainCacheOf(hosts), verifications: await verificationsOf(f.sourceId), set: await setOf(f.sourceId) };
      const list = listing(60);
      const extract = extractWith(f.keyOf, emptyOn);
      const { checkId, status } = await startCoverageCheck(f.sourceId, null, { fire: false });
      expect(status).toBe('started');
      expect((await checkRow(checkId)).status).toBe('running');

      await runCoverageCheck(checkId, { listing: list, extract, proofShapes });

      const row = await checkRow(checkId);
      expect(row.status).toBe('done');
      expect(row.completedAt).not.toBeNull();
      expect(list).toHaveBeenCalledWith(f.listingUrl);
      const results = row.results as CoverageResults;
      expect(results.listingUrl).toBe(f.listingUrl);
      expect(results.planned).toBe(20);
      expect(results.sampled).toHaveLength(20);
      // Spread over the listing, never its first twenty.
      expect(results.sampled.map((p) => p.url)).not.toEqual(LISTED(20));
      expect(results.sampled[1]!.url).toBe(LISTED(60)[3]);
      // The certified paths, and only those, are what each page is read with.
      const fields = extract.mock.calls[0]![1];
      expect(Object.fromEntries(fields.map((x) => [x.key, x.paths]))).toEqual({ [f.keyOf.price]: CERTIFIED.price, [f.keyOf.title]: CERTIFIED.title });
      for (const p of results.sampled) {
        expect('shape' in p).toBe(true);
        if (!('shape' in p)) continue;
        expect(p.empty).toEqual(emptyOn(p.url) ? [f.keyOf.price] : []);
        expect(p.shape).toEqual(emptyOn(p.url) ? multi : single);
      }
      expect(results.sampled.filter((p) => 'empty' in p && p.empty.includes(f.keyOf.price)).length).toBeGreaterThan(0);
      expect(proofShapes).toHaveBeenCalledWith(f.sourceId, f.proofUrls);
      expect(results.proofShapes).toEqual(Object.fromEntries(f.proofUrls.map((u) => [u, single])));

      // Spec A4: no captures, no domain cache, no verification, no change to the website's set or contract.
      expect(await capturesOf(f.sourceId)).toBe(before.captures);
      expect(await domainCacheOf(hosts)).toBe(before.domains);
      expect(await verificationsOf(f.sourceId)).toBe(before.verifications);
      expect(await setOf(f.sourceId)).toBe(before.set);
      expect(agentCtor).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it('property 3: a walled page is unread, never empty; three walls in a row stop the check done with what it has', async () => {
    const f = await certifiedWebsite('cov-wall');
    try {
      const extract = vi.fn(async () => ({ unread: 'test-cov.example.com refused the browser (HTTP 403).', wall: true }));
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await runCoverageCheck(checkId, { listing: listing(30), extract, proofShapes });

      const row = await checkRow(checkId);
      expect(row.status).toBe('done');
      const results = row.results as CoverageResults;
      expect(extract).toHaveBeenCalledTimes(COVERAGE_WALL_BREAKER);
      expect(results.sampled).toHaveLength(COVERAGE_WALL_BREAKER);
      for (const p of results.sampled) {
        expect(p).toMatchObject({ unread: 'test-cov.example.com refused the browser (HTTP 403).' });
        expect('empty' in p).toBe(false);
      }
      const latest = (await latestCoverageCheck(f.sourceId))!;
      expect(latest.fields).toEqual([]);
      expect(latest.stage).toBe('Checked 3 more products from the listing: every field was found on all of them. (3 could not be read)');
    } finally { await f.cleanup(); }
  });

  it('only walls in a row stop it: a read page or a non-wall failure in between resets the count', async () => {
    const f = await certifiedWebsite('cov-unread');
    try {
      // Pages 1..20 in order (30 listed, so no spreading). Up to page 12: wall, wall, then a non-wall failure — were the non-wall
      // failure not a reset, page 4 would be the third wall. From page 13: wall, wall, then a read page.
      const n = (url: string) => Number(url.split('/').pop());
      const extract = vi.fn(async (url: string) => (n(url) % 3 !== 0
        ? { unread: 'Refused.', wall: true }
        : n(url) <= 12 ? { unread: 'The page did not load.', wall: false } : { data: { [f.keyOf.price]: '1.00', [f.keyOf.title]: 'x' }, shape: single }));
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await runCoverageCheck(checkId, { listing: listing(30), extract, proofShapes });
      const row = await checkRow(checkId);
      expect(row.status).toBe('done');
      const results = row.results as CoverageResults;
      expect(results.sampled).toHaveLength(20);
      expect(results.sampled.filter((p) => 'unread' in p)).toHaveLength(18);
      expect(results.sampled.filter((p) => 'shape' in p).map((p) => p.url)).toEqual([LISTED(30)[14], LISTED(30)[17]]);
    } finally { await f.cleanup(); }
  });

  it('property 7: a walled listing ends the check failed with the verdict sentence, and no page is read', async () => {
    const f = await certifiedWebsite('cov-listing-wall');
    try {
      const sentence = 'test-cov-listing-wall.example.com showed a CAPTCHA.';
      const extract = vi.fn();
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await runCoverageCheck(checkId, { listing: async () => ({ productUrls: [], verdictMessage: sentence }), extract, proofShapes });

      const row = await checkRow(checkId);
      expect(row).toMatchObject({ status: 'failed', error: sentence });
      expect(row.completedAt).not.toBeNull();
      expect(extract).not.toHaveBeenCalled();
      expect((await latestCoverageCheck(f.sourceId))!).toMatchObject({ status: 'failed', fields: [], stage: sentence });
    } finally { await f.cleanup(); }
  });

  it('a website with no listing url ends done with nothing sampled, without loading anything', async () => {
    const f = await certifiedWebsite('cov-nolisting', { listingUrl: null });
    try {
      const list = vi.fn();
      const extract = vi.fn();
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await runCoverageCheck(checkId, { listing: list, extract, proofShapes });

      const row = await checkRow(checkId);
      expect(row.status).toBe('done');
      expect(row.results).toEqual({ listingUrl: '', sampled: [], proofShapes: {} });
      expect(list).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
      expect((await latestCoverageCheck(f.sourceId))!).toMatchObject({ status: 'done', fields: [], stage: null });
    } finally { await f.cleanup(); }
  });

  it('a throw inside a page read leaves the row failed with its error (never rejects)', async () => {
    const f = await certifiedWebsite('cov-throw');
    try {
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await expect(runCoverageCheck(checkId, { listing: listing(5), extract: async () => { throw new Error('browser died'); }, proofShapes })).resolves.toBeUndefined();
      expect(await checkRow(checkId)).toMatchObject({ status: 'failed', error: 'browser died' });
    } finally { await f.cleanup(); }
  });

  it('one running check per website; a stalled one is closed failed/stalled and a new one may start', async () => {
    const f = await certifiedWebsite('cov-stall');
    try {
      const first = await startCoverageCheck(f.sourceId, null, { fire: false });
      expect(first.status).toBe('started');
      expect(await startCoverageCheck(f.sourceId, null, { fire: false })).toEqual({ checkId: first.checkId, status: 'in-progress' });
      expect(await db.select({ n: count() }).from(coverageChecks).where(eq(coverageChecks.sourceId, f.sourceId))).toEqual([{ n: 1 }]);

      await db.update(coverageChecks).set({ createdAt: new Date(Date.now() - COVERAGE_CHECK_STALL_MS - 1) }).where(eq(coverageChecks.id, first.checkId));
      const second = await startCoverageCheck(f.sourceId, null, { fire: false });
      expect(second.status).toBe('started');
      expect(second.checkId).not.toBe(first.checkId);
      const old = await checkRow(first.checkId);
      expect(old).toMatchObject({ status: 'failed', error: 'stalled' });
      expect(old.completedAt).not.toBeNull();

      // Read on its own, a stalled row is closed on the way and says nothing to the customer.
      await db.update(coverageChecks).set({ createdAt: new Date(Date.now() - COVERAGE_CHECK_STALL_MS - 1) }).where(eq(coverageChecks.id, second.checkId));
      expect(await latestCoverageCheck(f.sourceId)).toMatchObject({ id: second.checkId, status: 'failed', error: 'stalled', stage: null, fields: [] });
      expect(await checkRow(second.checkId)).toMatchObject({ status: 'failed', error: 'stalled' });
    } finally { await f.cleanup(); }
  });

  it('latestCoverageCheck summarises the newest row: per-field empties, the explanation and the stage line', async () => {
    const f = await certifiedWebsite('cov-latest');
    try {
      expect(await latestCoverageCheck(f.sourceId)).toBeNull();
      const { checkId, status } = await startCoverageCheck(f.sourceId, null, { fire: false });
      expect(status).toBe('started');
      expect(await latestCoverageCheck(f.sourceId)).toMatchObject({ id: checkId, status: 'running', fields: [], stage: 'Checking 0 more products from the listing…' });

      await runCoverageCheck(checkId, { listing: listing(60), extract: extractWith(f.keyOf, emptyOn), proofShapes });
      const latest = (await latestCoverageCheck(f.sourceId))!;
      const results = latest.results!;
      const empties = results.sampled.filter((p) => emptyOn(p.url)).map((p) => p.url);
      expect(latest).toMatchObject({ id: checkId, status: 'done', error: null });
      expect(latest.fields).toHaveLength(1);
      expect(latest.fields[0]).toEqual({
        key: f.keyOf.price, empty: empties, sampled: 20, unread: 0,
        explanation: `all ${empties.length} list their sizes as variants in the page data`,
        representative: empties[0],
      });
      expect(latest.stage).toBe('1 field was empty on some of the 20 sampled products — see the row.');
    } finally { await f.cleanup(); }
  });
});
