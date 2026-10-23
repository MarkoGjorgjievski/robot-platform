// packages/api/src/verify/refresh-values.test.ts
// Websites change (spec 2026-10-21 §3.2): applying a check's refreshes and starting their free re-verify.
// DB-backed; the re-verify is a queued `verify` job no test here runs, so no page load and no model call.
import { describe, it, expect, afterAll } from 'vitest';
import { jobsOf } from '../test-helpers/jobs.js';
import { eq } from 'drizzle-orm';
import { db, driftChecks, fieldHolds, sources, sourceVerifications, valueRefreshes } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { applyRefreshes, startRefreshVerify } from './refresh-values.js';
import { loadCurrentCertification } from './current-certification.js';
import { holdSourceLock, stillPending } from '../test-helpers/row-lock.js';

const me = await signedInCaller('refresh-values');
afterAll(async () => { await me.cleanup(); });
/** This website's `verify` jobs, oldest first (the file's queue holds every test's). */
const verifyJobsOf = async (sourceId: string) => (await jobsOf('verify')).filter((j) => (j.payload as { sourceId?: string }).sourceId === sourceId);
const LD: CertifiedPath ={ source: 'json-ld', path: 'offers.price', transform: 'identity' };

async function currentPrice(tag: string) {
  const host = `test-refresh-${tag}.example.com`;
  const urls = [`https://${host}/p/1`, `https://${host}/p/2`, `https://${host}/p/3`];
  const f = await createProjectWithSource(me.caller, {
    tag: `refresh-${tag}`, urls, fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '615.00', [urls[1]!]: '435.00', [urls[2]!]: '3250.00' } },
  });
  expect(f.keys.Price).toBe('price');
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const field = (src.schemaDefinition as SchemaDefinitionField[])[0]!;
  const set = src.verificationSet as VerificationSet;
  const hash = fieldHash(field, set);
  const cells = Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: 'x', path: LD }]));
  await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results: { price: { key: 'price', cells, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash } } });
  return { ...f, urls, hash, field };
}

const pages = (urls: string[]) => ({ [urls[0]!]: { was: '615.00', now: '625.00', path: LD } });

describe('applyRefreshes (spec 2026-10-21 §3.2)', () => {
  it('writes the new value, keeps the field certified through the change with both hashes, and logs it', async () => {
    const s = await currentPrice('apply');
    try {
      const out = await applyRefreshes(s.sourceId, null, [{ key: 'price', pages: pages(s.urls), basisHash: s.hash }]);
      expect(out).toEqual({ applied: ['price'], skipped: {} });
      const src = (await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId) }))!;
      const set = src.verificationSet as VerificationSet;
      expect(set.expected.price![s.urls[0]!]).toBe('625.00');
      expect(set.expected.price![s.urls[1]!]).toBe('435.00');
      const toHash = fieldHash(s.field, set);
      const hold = (await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) }))!;
      expect(hold.fieldHashes).toEqual([s.hash, toHash]);
      expect(hold.failedVerificationId).toBeNull();
      const log = (await db.query.valueRefreshes.findFirst({ where: eq(valueRefreshes.sourceId, s.sourceId) }))!;
      expect(log).toMatchObject({ fieldKey: 'price', fromHash: s.hash, toHash, pages: pages(s.urls) });
      expect(await loadCurrentCertification(db, s.sourceId)).not.toBeNull();
    } finally { await s.cleanup(); }
  });

  it('Review Focus 1: a stale autosave writing the old value back keeps the hold', async () => {
    const s = await currentPrice('stale-autosave');
    try {
      await applyRefreshes(s.sourceId, null, [{ key: 'price', pages: pages(s.urls), basisHash: s.hash }]);
      await me.caller.sources.updateBinding({ sourceId: s.sourceId, urls: s.urls, descriptions: { price: 'x' }, expected: { price: { [s.urls[0]!]: '615.00', [s.urls[1]!]: '435.00', [s.urls[2]!]: '3250.00' } } });
      expect(await loadCurrentCertification(db, s.sourceId)).not.toBeNull();
    } finally { await s.cleanup(); }
  });

  it('changes nothing when the stored value moved since the check read it', async () => {
    const s = await currentPrice('moved');
    try {
      await me.caller.sources.updateBinding({ sourceId: s.sourceId, urls: s.urls, descriptions: { price: 'x' }, expected: { price: { [s.urls[0]!]: '600.00', [s.urls[1]!]: '435.00', [s.urls[2]!]: '3250.00' } } });
      const out = await applyRefreshes(s.sourceId, null, [{ key: 'price', pages: pages(s.urls), basisHash: s.hash }]);
      expect(out).toEqual({ applied: [], skipped: { price: 'moved' } });
      expect(await db.query.valueRefreshes.findFirst({ where: eq(valueRefreshes.sourceId, s.sourceId) })).toBeUndefined();
    } finally { await s.cleanup(); }
  });

  it('Review Focus 3: skips while a Verify is in flight', async () => {
    const s = await currentPrice('busy');
    try {
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x' });
      const out = await applyRefreshes(s.sourceId, null, [{ key: 'price', pages: pages(s.urls), basisHash: s.hash }]);
      expect(out).toEqual({ applied: [], skipped: { price: 'busy' } });
    } finally { await s.cleanup(); }
  });
});

describe('startRefreshVerify', () => {
  it('starts a free, refresh-origin re-verify of the refreshed fields on the check’s captures', async () => {
    const s = await currentPrice('reverify');
    try {
      const refs = { [s.urls[0]!]: { captureId: 'c1', capturedAt: new Date().toISOString() } };
      const id = await startRefreshVerify(s.sourceId, ['price'], refs);
      expect(id).not.toBeNull();
      const [job] = await verifyJobsOf(s.sourceId);
      expect(job).toMatchObject({ status: 'queued', key: `verify:${id}` });
      expect(job!.payload).toEqual({ sourceId: s.sourceId, verificationId: id, onlyKeys: ['price'], free: true, origin: 'refresh', captureRefs: refs });
      expect((await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, id!) }))!.jobId).toBe(job!.id);
    } finally { await s.cleanup(); }
  });
  it('review Minor 1: the refresh log names the re-verify before it runs, in the transaction that starts it', async () => {
    const s = await currentPrice('reverify-link');
    try {
      const [check] = await db.insert(driftChecks).values({ sourceId: s.sourceId, status: 'running', trigger: 'schedule', results: { runId: null, fields: {} } }).returning({ id: driftChecks.id });
      await db.insert(valueRefreshes).values({ sourceId: s.sourceId, fieldKey: 'price', driftCheckId: check!.id, pages: {}, fromHash: 'a', toHash: 'b' });
      const id = await startRefreshVerify(s.sourceId, ['price'], {}, { checkId: check!.id });
      expect(id).not.toBeNull();
      // The job is only queued: the link is there before any worker can run it.
      expect((await verifyJobsOf(s.sourceId))[0]).toMatchObject({ status: 'queued', payload: { verificationId: id } });
      expect((await db.query.valueRefreshes.findFirst({ where: eq(valueRefreshes.driftCheckId, check!.id) }))?.verificationId).toBe(id);
    } finally { await s.cleanup(); }
  });
  it('Review Focus 3: starts no re-verify while one is in flight', async () => {
    const s = await currentPrice('reverify-busy');
    try {
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x' });
      expect(await startRefreshVerify(s.sourceId, ['price'], {})).toBeNull();
      expect(await verifyJobsOf(s.sourceId)).toEqual([]);
    } finally { await s.cleanup(); }
  });
});

describe('a refresh and a Verify never interleave (fix wave 1, item 5)', () => {
  it('the refresh re-verify waits for the website row lock, then sees the Verify started under it', async () => {
    const s = await currentPrice('lock-reverify');
    try {
      const lock = await holdSourceLock(s.sourceId);
      const started = startRefreshVerify(s.sourceId, ['price'], {});
      expect(await stillPending(started)).toBe(true);
      await lock.startVerifyInside();
      await lock.release();
      expect(await started).toBeNull();
      expect(await verifyJobsOf(s.sourceId)).toEqual([]);
    } finally { await s.cleanup(); }
  });
  it('applyRefreshes waits for a Verify start holding the lock, then is busy', async () => {
    const s = await currentPrice('lock-apply');
    try {
      const lock = await holdSourceLock(s.sourceId);
      const applying = applyRefreshes(s.sourceId, null, [{ key: 'price', pages: pages(s.urls), basisHash: s.hash }]);
      expect(await stillPending(applying)).toBe(true);
      await lock.startVerifyInside();
      await lock.release();
      expect(await applying).toEqual({ applied: [], skipped: { price: 'busy' } });
      const src = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId), columns: { verificationSet: true } });
      expect((src!.verificationSet as VerificationSet).expected.price![s.urls[0]!]).toBe('615.00');
    } finally { await s.cleanup(); }
  });
  it('a Verify started while a refresh holds the lock waits, and starts after it on the refreshed values', async () => {
    const s = await currentPrice('lock-order');
    try {
      const lock = await holdSourceLock(s.sourceId);
      const started = startRefreshVerify(s.sourceId, ['price'], {});
      expect(await stillPending(started)).toBe(true);
      await lock.release();
      const id = await started;
      expect(id).not.toBeNull();
      expect(await verifyJobsOf(s.sourceId)).toHaveLength(1);
    } finally { await s.cleanup(); }
  });
});
