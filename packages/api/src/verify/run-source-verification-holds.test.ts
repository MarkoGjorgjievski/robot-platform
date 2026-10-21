// Spec 2026-10-21 §3.1: a Verify that does not pass a certified field keeps
// its last good certification while its paths still extract. runVerification
// and the browser are stubbed the way run-source-verification.test.ts stubs
// them; the captures carry real JSON-LD so the hold rule reads real values.
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { db, fieldHolds, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';
import { writeCaptureFile } from './capture-store.js';

const { runVerificationMock } = vi.hoisted(() => ({ runVerificationMock: vi.fn() }));
vi.mock('@robot/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/scraper')>();
  return { ...actual, runVerification: runVerificationMock, saveVerifiedPaths: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../browser-session.js', () => ({ withBrowserSession: vi.fn(async (fn: (b: unknown) => Promise<unknown>) => fn({ setContentEvaluate: async () => ({}) })) }));
process.env.CAPTURES_DIR = mkdtempSync(join(tmpdir(), 'robot-holds-'));

const { runSourceVerification } = await import('./run-source-verification.js');
const { loadCurrentCertification, loadCertificationState, runnableOf } = await import('./current-certification.js');
const { backfillHolds } = await import('./holds.js');

const me = await signedInCaller('verify-holds');
afterAll(async () => { await me.cleanup(); });
afterEach(() => runVerificationMock.mockReset());

const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
const startCoverage = vi.fn(async () => ({ checkId: 'none', status: 'started' as const }));
const noPageLoad = { setContentEvaluate: async () => ({}) } as never;

function page(url: string, price: string | null): PageCapture {
  return {
    url, html: `<html><body><h1>P</h1><p>$${price ?? ''}</p></body></html>`, markdown: '', screenshot: Buffer.from('x'), screenshotTiles: [],
    verdict: { kind: 'ok', status: 200 }, title: '', timestamp: Date.now(),
    structuredData: { ldJson: price === null ? [] : [{ '@type': 'Product', offers: { price } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  };
}

async function certified(tag: string) {
  const host = `https://test-holds-${tag}.example.com/p`;
  const urls = [`${host}/1`, `${host}/2`, `${host}/3`];
  const f = await createProjectWithSource(me.caller, { tag: `holds-${tag}`, urls, fields: [{ name: 'Price', type: 'money', description: 'x' }], expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } } });
  const fresh = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const field = (fresh.schemaDefinition as SchemaDefinitionField[])[0]!;
  const hash = fieldHash(field, fresh.verificationSet as VerificationSet);
  const cells = Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: '1', path: LD }]));
  const passed = { key: 'price', cells, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash };
  const [good] = await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(Date.now() - 86_400_000), allPassed: true, results: { price: passed } }).returning({ id: sourceVerifications.id });
  return { ...f, urls, hash, passed, goodId: good!.id };
}

const failing = (urls: string[], hash: string) => ({
  key: 'price', certified: [], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash,
  cells: Object.fromEntries(urls.map((u) => [u, { status: 'fail', reason: 'different_value', found: '9' }])),
});

async function verify(sourceId: string, outcome: unknown, captures: Record<string, PageCapture | null>, opts: Record<string, unknown> = {}) {
  const [row] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x' }).returning({ id: sourceVerifications.id });
  runVerificationMock.mockResolvedValue({ outcome: { fields: outcome, allPassed: false, aiCalls: 0 }, captures, captureErrors: {} });
  const startCheck = vi.fn(async () => undefined);
  await runSourceVerification(sourceId, row!.id, { startCoverage, startCheck, ...opts });
  return { id: row!.id, startCheck };
}

describe('a Verify keeps the last good certification (spec 2026-10-21 §3.1)', () => {
  it('a failed re-verify whose path still reads keeps the website certified, holds the field and starts the verify check', async () => {
    const s = await certified('keep');
    try {
      const caps = Object.fromEntries(s.urls.map((u, i) => [u, page(u, String(1.5 + i))]));
      const { id, startCheck } = await verify(s.sourceId, { price: failing(s.urls, s.hash) }, caps);
      const hold = await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) });
      expect(hold).toMatchObject({ fieldKey: 'price', verificationId: s.goodId, failedVerificationId: id, fieldHashes: [s.hash] });
      expect((await loadCurrentCertification(db, s.sourceId))!.paths).toEqual({ price: [LD] });
      expect(startCheck).toHaveBeenCalledWith(s.sourceId, ['price'], expect.any(Object));
      const src = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId), columns: { nextCheckAt: true } });
      expect(src!.nextCheckAt!.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    } finally { await s.cleanup(); }
  });

  it('a path that reads nothing on any page leaves the field uncertified and starts no check', async () => {
    const s = await certified('lost');
    try {
      const caps = Object.fromEntries(s.urls.map((u) => [u, page(u, null)]));
      const { startCheck } = await verify(s.sourceId, { price: failing(s.urls, s.hash) }, caps);
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) })).toBeUndefined();
      expect(await loadCurrentCertification(db, s.sourceId)).toBeNull();
      expect(startCheck).not.toHaveBeenCalled();
    } finally { await s.cleanup(); }
  });

  it('a passing Verify ends the hold', async () => {
    const s = await certified('end');
    try {
      await db.insert(fieldHolds).values({ sourceId: s.sourceId, fieldKey: 'price', result: s.passed, verifiedAt: new Date(), fieldHashes: [s.hash] });
      await verify(s.sourceId, { price: s.passed }, Object.fromEntries(s.urls.map((u) => [u, page(u, '1.00')])));
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) })).toBeUndefined();
    } finally { await s.cleanup(); }
  });

  it('Review Focus 5: a refresh-origin Verify that fails keeps the hold and starts no check', async () => {
    const s = await certified('refresh-origin');
    try {
      const caps = Object.fromEntries(s.urls.map((u, i) => [u, page(u, String(1.5 + i))]));
      const { startCheck } = await verify(s.sourceId, { price: failing(s.urls, s.hash) }, caps, { origin: 'refresh', onlyKeys: ['price'], free: true });
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) })).toBeDefined();
      expect(startCheck).not.toHaveBeenCalled();
    } finally { await s.cleanup(); }
  });

  it('captures handed in are used first', async () => {
    const s = await certified('refs');
    try {
      await writeCaptureFile('22222222-2222-2222-2222-222222222222', page(s.urls[0]!, '7.00'));
      const refs = { [s.urls[0]!]: { captureId: '22222222-2222-2222-2222-222222222222', capturedAt: new Date().toISOString() } };
      await verify(s.sourceId, { price: s.passed }, Object.fromEntries(s.urls.map((u) => [u, page(u, '1.00')])), { captureRefs: refs, onlyKeys: ['price'] });
      const deps = runVerificationMock.mock.calls[0]![1] as { captures: Record<string, PageCapture> };
      expect(deps.captures[s.urls[0]!]!.structuredData.ldJson).toEqual([{ '@type': 'Product', offers: { price: '7.00' } }]);
    } finally { await s.cleanup(); }
  });

  it('holds do not cover variants: a variants-required website whose variants failed keeps its field held but is not runnable', async () => {
    const s = await certified('variants');
    try {
      const src = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId), columns: { datasetId: true } });
      await me.caller.datasets.setVariantMode({ datasetId: src!.datasetId!, mode: 'row_per_variant' });
      const setup = await me.caller.sources.setVariantSetup({ sourceId: s.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
      const colour = setup.axes[0]!.axisKey;
      const list = { source: 'json-ld' as const, path: 'hasVariant' };
      await me.caller.sources.saveVariantAnswer({ sourceId: s.sourceId, url: s.urls[0]!, answer: { count: 2, labels: ['Black', 'Red'], list, links: [s.urls[0]!, `${s.urls[0]!}-red`], spot: { index: 0, expected: { price: '1.00', [colour]: 'Black' } } } });
      await me.caller.sources.saveVariantAnswer({ sourceId: s.sourceId, url: s.urls[1]!, answer: { count: 0, labels: [] } });
      await me.caller.sources.saveVariantAnswer({ sourceId: s.sourceId, url: s.urls[2]!, answer: { count: 0, labels: [] } });
      // Setting up variants leaves the price field's hash where it was, so its last pass still stands for it.
      const fresh = (await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId) }))!;
      expect(fieldHash((fresh.schemaDefinition as SchemaDefinitionField[])[0]!, fresh.verificationSet as VerificationSet)).toBe(s.hash);

      // The captures carry no variant list, so the variant check on them fails.
      const caps = Object.fromEntries(s.urls.map((u, i) => [u, page(u, String(1.5 + i))]));
      const { id } = await verify(s.sourceId, { price: failing(s.urls, s.hash) }, caps);
      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, id) });
      expect(row!.errorMessage).toBeNull();
      expect(row!.variantResults).toMatchObject({ method: 'list', passed: false });
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) })).toMatchObject({ fieldKey: 'price' });
      const state = await loadCertificationState(db, s.sourceId);
      expect(state.cert).not.toBeNull();
      expect(state.cert!.variants).toBeUndefined();
      expect(state.variants).toMatchObject({ required: 'yes', current: true, passed: false });
      expect(runnableOf(state)).toBe(false);
    } finally { await s.cleanup(); }
  });
});

describe('backfillHolds (spec 2026-10-21 §8)', () => {
  it('holds what the latest Verify would have kept, from the newest earlier pass, on its stored captures', async () => {
    const s = await certified('backfill');
    try {
      const refs: Record<string, { captureId: string; capturedAt: string }> = {};
      for (const [i, u] of s.urls.entries()) {
        const id = `3333333${i}-3333-3333-3333-333333333333`;
        await writeCaptureFile(id, page(u, String(1.5 + i)));
        refs[u] = { captureId: id, capturedAt: new Date().toISOString() };
      }
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: false, results: { price: failing(s.urls, s.hash) }, captures: refs });
      expect(await loadCurrentCertification(db, s.sourceId)).toBeNull();
      const out = await backfillHolds(db, noPageLoad, s.sourceId, { write: true });
      expect(out.upsert.map((h) => h.fieldKey)).toEqual(['price']);
      expect(out.certifying.price!.verificationId).toBe(s.goodId);
      expect(await loadCurrentCertification(db, s.sourceId)).not.toBeNull();
    } finally { await s.cleanup(); }
  });

  it('without write it writes nothing; with no earlier pass there is nothing to hold', async () => {
    const s = await certified('backfill-dry');
    try {
      await db.insert(sourceVerifications).values({ sourceId: s.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: false, results: { price: failing(s.urls, s.hash) }, captures: {} });
      const dry = await backfillHolds(db, noPageLoad, s.sourceId);
      expect(dry.upsert.map((h) => h.fieldKey)).toEqual(['price']);
      expect(dry.passing).toEqual([]);
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) })).toBeUndefined();
      await db.delete(sourceVerifications).where(eq(sourceVerifications.id, s.goodId));
      const none = await backfillHolds(db, noPageLoad, s.sourceId, { write: true });
      expect(none.upsert).toEqual([]);
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, s.sourceId) })).toBeUndefined();
    } finally { await s.cleanup(); }
  });
});
