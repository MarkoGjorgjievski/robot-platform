// Fix wave 1, item 4 (spec 2026-10-21 §3.1): the verification row, the hold writes and `next_check_at` are one
// transaction. A hold write that fails rolls the result back: the row ends as a failure (errorMessage, so
// latestCleanRun skips it), and the earlier certification and holds stand as they were.
import { describe, it, expect, vi, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { db, fieldHolds, sources, sourceVerifications } from '@robot/db';
import { fieldHash, type CertifiedPath, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';

const { runVerificationMock, writeHoldsMock } = vi.hoisted(() => ({
  runVerificationMock: vi.fn(),
  writeHoldsMock: vi.fn(async () => { throw new Error('hold write failed'); }),
}));
vi.mock('@robot/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/scraper')>();
  return { ...actual, runVerification: runVerificationMock, saveVerifiedPaths: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('./holds.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./holds.js')>();
  return { ...actual, writeHolds: writeHoldsMock };
});
vi.mock('../browser-session.js', () => ({ withBrowserSession: vi.fn(async (fn: (b: unknown) => Promise<unknown>) => fn({ setContentEvaluate: async () => ({}) })) }));
process.env.CAPTURES_DIR = mkdtempSync(join(tmpdir(), 'robot-hold-rollback-'));

const { runSourceVerification } = await import('./run-source-verification.js');
const { loadCurrentCertification, loadFieldCurrency } = await import('./current-certification.js');

const me = await signedInCaller('verify-hold-rollback');
afterAll(async () => { await me.cleanup(); });

const LD: CertifiedPath = { source: 'json-ld', path: 'offers.price', transform: 'identity' };

function page(url: string, price: string): PageCapture {
  return {
    url, html: `<html><body><h1>P</h1><p>$${price}</p></body></html>`, markdown: '', screenshot: Buffer.from('x'), screenshotTiles: [],
    verdict: { kind: 'ok', status: 200 }, title: '', timestamp: Date.now(),
    structuredData: { ldJson: [{ '@type': 'Product', offers: { price } }], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  };
}

describe('a failing hold write rolls the Verify result back (fix wave 1, item 4)', () => {
  it('the row ends as a failure, excluded from the latest clean run; the earlier certification and holds are unchanged', async () => {
    const host = 'https://test-hold-rollback.example.com/p';
    const urls = [`${host}/1`, `${host}/2`, `${host}/3`];
    const f = await createProjectWithSource(me.caller, { tag: 'hold-rollback', urls, fields: [{ name: 'Price', type: 'money', description: 'x' }], expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } } });
    try {
      const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
      const field = (src.schemaDefinition as SchemaDefinitionField[])[0]!;
      const hash = fieldHash(field, src.verificationSet as VerificationSet);
      const cells = Object.fromEntries(urls.map((u) => [u, { status: 'pass', found: '1', path: LD }]));
      const passed = { key: 'price', cells, certified: [LD], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash };
      const [good] = await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(Date.now() - 86_400_000), allPassed: true, results: { price: passed } }).returning({ id: sourceVerifications.id });
      // A hold of the same lineage already stands (as after a refresh), with a hash of its own.
      await db.insert(fieldHolds).values({ sourceId: f.sourceId, fieldKey: 'price', result: passed, verificationId: good!.id, verifiedAt: new Date('2026-10-12T00:00:00Z'), fieldHashes: [hash, 'refreshed'] });
      const holdBefore = await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, f.sourceId) });
      const nextBefore = src.nextCheckAt;

      const [row] = await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x' }).returning({ id: sourceVerifications.id });
      const failing = { key: 'price', certified: [], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: hash, cells: Object.fromEntries(urls.map((u) => [u, { status: 'fail', reason: 'different_value', found: '9' }])) };
      runVerificationMock.mockResolvedValue({ outcome: { fields: { price: failing }, allPassed: false, aiCalls: 0 }, captures: Object.fromEntries(urls.map((u, i) => [u, page(u, String(1.5 + i))])), captureErrors: {} });
      const startCheck = vi.fn(async () => undefined);
      await runSourceVerification(f.sourceId, row!.id, { startCoverage: vi.fn(async () => ({ checkId: 'none', status: 'started' as const })), startCheck });

      expect(writeHoldsMock).toHaveBeenCalled();
      const after = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, row!.id) });
      expect(after!.errorMessage).toContain('hold write failed');
      expect(after!.completedAt).not.toBeNull();
      expect(after!.results ?? {}).not.toHaveProperty('price');
      const currency = await loadFieldCurrency(db, f.sourceId);
      expect(currency.latest!.id).toBe(good!.id);
      expect(currency.currentKeys).toEqual(['price']);
      expect((await loadCurrentCertification(db, f.sourceId))!.paths).toEqual({ price: [LD] });
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, f.sourceId) })).toEqual(holdBefore);
      const srcAfter = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), columns: { nextCheckAt: true } });
      expect(srcAfter!.nextCheckAt).toEqual(nextBefore);
      expect(startCheck).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });
});
