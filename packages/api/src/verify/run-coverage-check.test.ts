// packages/api/src/verify/run-coverage-check.test.ts
// The coverage check job (spec 2026-10-10 §A; properties 1, 3, 7): DB-backed,
// with the listing, the per-page extraction and the proof pages' shapes all
// injected — no browser is launched in this file and no page is loaded.
// Never a model call, never a write outside coverage_checks.
import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { eq, count, inArray } from 'drizzle-orm';
import { db, captures, coverageChecks, domainIntelligence, sources, sourceVerifications } from '@robot/db';
import { _resetBackoffForTests, fieldHash, reportVerdict, type CertifiedPath, type SchemaDefinitionField, type Shape, type VerificationSet, type VerifiedField } from '@robot/scraper';
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

const {
  startCoverageCheck, runCoverageCheck, latestCoverageCheck, answerFromBackoff,
  COVERAGE_CHECK_STALL_MS, COVERAGE_WALL_BREAKER, COVERAGE_ERROR_BREAKER, PAGE_UNREADABLE,
} = await import('./run-coverage-check.js');

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

describe('answerFromBackoff', () => {
  afterEach(() => _resetBackoffForTests());
  it('null for a host with no backoff; after a refusal, the backoff sentence as a wall — no browser needed', () => {
    const url = 'https://test-cov-backoff.example.com/p/1';
    expect(answerFromBackoff(url)).toBeNull();
    reportVerdict('test-cov-backoff.example.com', { kind: 'refused', status: 403 });
    const a = answerFromBackoff(url)!;
    expect(a.wall).toBe(true);
    expect(a.unread).toMatch(/^test-cov-backoff\.example\.com refused/);
    expect(a.unread).toMatch(/Waiting \d+ min before trying again\.$/);
    // Another host is not affected.
    expect(answerFromBackoff('https://test-cov-other.example.com/p/1')).toBeNull();
    // An ok clears it.
    reportVerdict('test-cov-backoff.example.com', { kind: 'ok', status: 200 });
    expect(answerFromBackoff(url)).toBeNull();
  });
});

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
      expect(latest.stage).toBe('Checked 3 more products from the listing: none could be read.');
    } finally { await f.cleanup(); }
  });

  it('only walls in a row stop it: a read page or a non-wall failure in between resets the count', async () => {
    const f = await certifiedWebsite('cov-unread');
    try {
      // Pages 1..20 in order (20 listed, so all of them, unspread). Up to page 12: wall, wall, then a non-wall failure — were the non-wall
      // failure not a reset, page 4 would be the third wall. From page 13: wall, wall, then a read page.
      const n = (url: string) => Number(url.split('/').pop());
      const extract = vi.fn(async (url: string) => (n(url) % 3 !== 0
        ? { unread: 'Refused.', wall: true }
        : n(url) <= 12 ? { unread: 'The page did not load.', wall: false } : { data: { [f.keyOf.price]: '1.00', [f.keyOf.title]: 'x' }, shape: single }));
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await runCoverageCheck(checkId, { listing: listing(20), extract, proofShapes });
      const row = await checkRow(checkId);
      expect(row.status).toBe('done');
      const results = row.results as CoverageResults;
      expect(results.sampled).toHaveLength(20);
      expect(results.sampled.filter((p) => 'unread' in p)).toHaveLength(18);
      expect(results.sampled.filter((p) => 'shape' in p).map((p) => p.url)).toEqual([LISTED(20)[14], LISTED(20)[17]]);
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

  it('a throw around the loop (the listing, the proof shapes) leaves the row failed with its error (never rejects)', async () => {
    const f = await certifiedWebsite('cov-throw');
    try {
      const a = await startCoverageCheck(f.sourceId, null, { fire: false });
      await expect(runCoverageCheck(a.checkId, { listing: async () => { throw new Error('browser died'); }, extract: extractWith(f.keyOf, () => false), proofShapes })).resolves.toBeUndefined();
      expect(await checkRow(a.checkId)).toMatchObject({ status: 'failed', error: 'browser died' });

      const b = await startCoverageCheck(f.sourceId, null, { fire: false });
      await expect(runCoverageCheck(b.checkId, { listing: listing(5), extract: extractWith(f.keyOf, () => false), proofShapes: async () => { throw new Error('no captures'); } })).resolves.toBeUndefined();
      expect(await checkRow(b.checkId)).toMatchObject({ status: 'failed', error: 'no captures' });
    } finally { await f.cleanup(); }
  });

  it('one page whose read throws is that page unread (not a wall); the others are read and the check is done', async () => {
    const f = await certifiedWebsite('cov-page-throw');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const read = extractWith(f.keyOf, () => false);
      const extract = vi.fn(async (url: string, fields: VerifiedField[]) => {
        if (url.endsWith('/p/2')) throw new Error('page crashed');
        return read(url, fields);
      });
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await runCoverageCheck(checkId, { listing: listing(5), extract, proofShapes });
      const row = await checkRow(checkId);
      expect(row.status).toBe('done');
      const sampled = (row.results as CoverageResults).sampled;
      expect(sampled).toHaveLength(5);
      expect(sampled[1]).toEqual({ url: LISTED(5)[1], unread: PAGE_UNREADABLE });
      expect(sampled.filter((p) => 'shape' in p)).toHaveLength(4);
    } finally { errSpy.mockRestore(); await f.cleanup(); }
  });

  it('three page reads in a row throwing stop the loop, done with what it has; a read in between resets the count', async () => {
    const f = await certifiedWebsite('cov-page-throws');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const read = extractWith(f.keyOf, () => false);
      // Pages 1, 2 throw, 3 is read, then 4, 5, 6 throw: the stop comes at page 6, not page 4.
      const extract = vi.fn(async (url: string, fields: VerifiedField[]) => {
        if (url.endsWith('/p/3')) return read(url, fields);
        throw new Error("Executable doesn't exist");
      });
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      await runCoverageCheck(checkId, { listing: listing(20), extract, proofShapes });
      const row = await checkRow(checkId);
      expect(row.status).toBe('done');
      const sampled = (row.results as CoverageResults).sampled;
      expect(extract).toHaveBeenCalledTimes(3 + COVERAGE_ERROR_BREAKER);
      expect(sampled.map((p) => p.url)).toEqual(LISTED(6));
      expect(sampled.filter((p) => 'unread' in p).every((p) => 'unread' in p && p.unread === PAGE_UNREADABLE)).toBe(true);
    } finally { errSpy.mockRestore(); await f.cleanup(); }
  });

  it('a superseded coverage check stops reading: the loop sees the row closed mid-run and stops calling extract', async () => {
    const f = await certifiedWebsite('cov-supersede-mid');
    try {
      const read = extractWith(f.keyOf, () => false);
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      const extract = vi.fn(async (url: string, fields: VerifiedField[]) => {
        if (extract.mock.calls.length === 2) {
          await db.update(coverageChecks).set({ status: 'failed', error: 'superseded', completedAt: new Date() }).where(eq(coverageChecks.id, checkId));
        }
        return read(url, fields);
      });
      await runCoverageCheck(checkId, { listing: listing(20), extract, proofShapes });

      expect(extract).toHaveBeenCalledTimes(2);
      const row = await checkRow(checkId);
      expect(row).toMatchObject({ status: 'failed', error: 'superseded' });
      // The planned-size write from before the loop started stands; the loop's own findings never overwrote it.
      expect(row.results).toMatchObject({ sampled: [] });
    } finally { await f.cleanup(); }
  });

  it('a transient DB error re-reading the row status is logged and the loop keeps going', async () => {
    const f = await certifiedWebsite('cov-status-transient');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const original = db.query.coverageChecks.findFirst.bind(db.query.coverageChecks);
    let calls = 0;
    try {
      const extract = extractWith(f.keyOf, () => false);
      const { checkId } = await startCoverageCheck(f.sourceId, null, { fire: false });
      // The first findFirst is runCoverageCheck's own row load; the second is the loop's status
      // re-read for page 1 — that is the one made to throw, once.
      (db.query.coverageChecks as unknown as { findFirst: typeof original }).findFirst = ((...args: Parameters<typeof original>) => {
        calls++;
        if (calls === 2) return Promise.reject(new Error('connection reset'));
        return original(...args);
      }) as typeof original;

      await runCoverageCheck(checkId, { listing: listing(5), extract, proofShapes });

      const row = await checkRow(checkId);
      expect(row.status).toBe('done');
      expect(extract).toHaveBeenCalledTimes(5);
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('status re-read failed'))).toBe(true);
    } finally {
      (db.query.coverageChecks as unknown as { findFirst: typeof original }).findFirst = original;
      errSpy.mockRestore();
      await f.cleanup();
    }
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

  it('a new Verify supersedes a running check: the old row is closed failed/superseded, its own finish lands nowhere, and the tab shows the new one', async () => {
    const f = await certifiedWebsite('cov-supersede');
    try {
      const newVerification = async () => (await db.insert(sourceVerifications)
        .values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results: {} })
        .returning({ id: sourceVerifications.id }))[0]!.id;
      const v1 = await newVerification();
      const v2 = await newVerification();

      // No verification on the running row: a call that carries one supersedes it.
      const orphan = await startCoverageCheck(f.sourceId, null, { fire: false });
      const first = await startCoverageCheck(f.sourceId, v1, { fire: false });
      expect(first.status).toBe('started');
      expect(await checkRow(orphan.checkId)).toMatchObject({ status: 'failed', error: 'superseded' });

      // The same Verify (or a call with none) finds it in progress.
      expect(await startCoverageCheck(f.sourceId, v1, { fire: false })).toEqual({ checkId: first.checkId, status: 'in-progress' });
      expect(await startCoverageCheck(f.sourceId, null, { fire: false })).toEqual({ checkId: first.checkId, status: 'in-progress' });

      // A newer Verify closes it and starts its own.
      const second = await startCoverageCheck(f.sourceId, v2, { fire: false });
      expect(second.status).toBe('started');
      expect(second.checkId).not.toBe(first.checkId);
      const old = await checkRow(first.checkId);
      expect(old).toMatchObject({ status: 'failed', error: 'superseded' });
      expect(old.completedAt).not.toBeNull();

      // The old runner finishing afterwards writes nothing over its closed row.
      await runCoverageCheck(first.checkId, { listing: listing(30), extract: extractWith(f.keyOf, emptyOn), proofShapes });
      expect(await checkRow(first.checkId)).toMatchObject({ status: 'failed', error: 'superseded', results: null });
      expect(await latestCoverageCheck(f.sourceId)).toMatchObject({ id: second.checkId, status: 'running', stage: null });
    } finally { await f.cleanup(); }
  });

  it('latestCoverageCheck summarises the newest row: per-field empties, the explanation and the stage line', async () => {
    const f = await certifiedWebsite('cov-latest');
    try {
      expect(await latestCoverageCheck(f.sourceId)).toBeNull();
      const { checkId, status } = await startCoverageCheck(f.sourceId, null, { fire: false });
      expect(status).toBe('started');
      expect(await latestCoverageCheck(f.sourceId)).toMatchObject({ id: checkId, status: 'running', fields: [], stage: null });

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
