import { describe, it, expect, afterEach, vi, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { db, sources, sourceVerifications, captures } from '@robot/db';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { runSourceVerification, writeStage } from './run-source-verification.js';
import { writeCaptureFile } from './capture-store.js';
import { loadVariantCurrency } from './current-certification.js';
import { VARIANT_SHOP } from '../test-helpers/variant-shop.js';
import { signedInCaller } from '../test-helpers/identity.js';

// `runSourceVerification` never launches a real browser or calls
// `@robot/scraper`'s `runVerification` for real — both are stubbed here, the
// same `vi.hoisted` + `importOriginal` pattern `sources.test.ts` uses for
// `@robot/scraper`'s `runAnalysis`. `saveVerifiedPaths` is stubbed too so
// this file never writes into `domain_intelligence`.
const { runVerificationMock, saveVerifiedPathsMock, withBrowserSessionMock } = vi.hoisted(() => ({
  runVerificationMock: vi.fn(),
  saveVerifiedPathsMock: vi.fn().mockResolvedValue(undefined),
  withBrowserSessionMock: vi.fn(async (fn: (browser: unknown) => Promise<unknown>) => fn({})),
}));

vi.mock('@robot/scraper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/scraper')>();
  return { ...actual, runVerification: runVerificationMock, saveVerifiedPaths: saveVerifiedPathsMock };
});

vi.mock('../browser-session.js', () => ({ withBrowserSession: withBrowserSessionMock }));

// Real files get written (persist-screenshot.ts + the .capture.json sidecar)
// — CAPTURES_DIR points them at a throwaway temp dir instead of the repo.
process.env.CAPTURES_DIR = mkdtempSync(join(tmpdir(), 'robot-verify-captures-'));

afterEach(() => {
  runVerificationMock.mockReset();
  saveVerifiedPathsMock.mockClear();
  withBrowserSessionMock.mockClear();
});

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('run-source-verification');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });

function fakeCapture(url: string, html: string): PageCapture {
  return {
    url,
    html,
    markdown: '',
    screenshot: Buffer.from('x'),
    screenshotTiles: [],
    title: '',
    timestamp: Date.now(),
    structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} },
    interceptedRequests: [],
  };
}

async function makeSchemaSource(tag: string) {
  const urls = [
    `https://test-runverify-${tag}.example.com/p/1`,
    `https://test-runverify-${tag}.example.com/p/2`,
    `https://test-runverify-${tag}.example.com/p/3`,
  ];
  const f = await createProjectWithSource(caller, {
    tag: `runverify-${tag}`,
    urls,
    fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  await db.update(sources).set({ driftedFields: ['price'] }).where(eq(sources.id, f.sourceId));
  return { sourceId: f.sourceId, urls, cleanup: f.cleanup };
}

async function startVerificationRow(sourceId: string, overrides: Partial<{ startedAt: Date }> = {}): Promise<string> {
  const [row] = await db
    .insert(sourceVerifications)
    .values({ sourceId, definitionHash: 'irrelevant-for-this-test', completedAt: null, ...overrides })
    .returning({ id: sourceVerifications.id });
  return row!.id;
}

describe('runSourceVerification', () => {
  it('on success: writes results/allPassed/aiCalls/costUsd, persists captures with screenshots, calls saveVerifiedPaths, and clears driftedFields', async () => {
    const { sourceId, urls, cleanup } = await makeSchemaSource('success');
    try {
      const verificationId = await startVerificationRow(sourceId);

      const certifiedPrice = [{ source: 'api' as const, path: 'item.price', transform: 'identity' as const }];
      runVerificationMock.mockResolvedValue({
        outcome: {
          fields: { price: { key: 'price', cells: {}, certified: certifiedPrice, weakEvidence: false, aiCalled: true, incomplete: false } },
          allPassed: true,
          aiCalls: 1,
        },
        captures: {
          [urls[0]!]: fakeCapture(urls[0]!, '<html>1</html>'),
          [urls[1]!]: fakeCapture(urls[1]!, '<html>2</html>'),
          [urls[2]!]: fakeCapture(urls[2]!, '<html>3</html>'),
        },
        captureErrors: {},
      });

      await runSourceVerification(sourceId, verificationId);

      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      expect(row!.completedAt).not.toBeNull();
      expect(row!.allPassed).toBe(true);
      expect(row!.aiCalls).toBe(1);
      expect(Number(row!.costUsd)).toBeGreaterThanOrEqual(0);
      expect(row!.results).toEqual({
        price: { key: 'price', cells: {}, certified: certifiedPrice, weakEvidence: false, aiCalled: true, incomplete: false },
      });

      const captureRefs = row!.captures as Record<string, { captureId: string; screenshotUrl?: string }>;
      const ref = captureRefs[urls[0]!];
      expect(ref?.captureId).toBeTruthy();

      const capturedRow = await db.query.captures.findFirst({ where: eq(captures.id, ref!.captureId) });
      expect(capturedRow).toBeDefined();
      expect(capturedRow!.screenshotPath).toBeTruthy();
      expect(capturedRow!.html).toBe('<html>1</html>');

      expect(saveVerifiedPathsMock).toHaveBeenCalledWith('test-runverify-success.example.com', 'detail', { price: certifiedPrice }, urls[0]);

      const sourceRow = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
      expect(sourceRow!.driftedFields).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('on failure: writes errorMessage and completedAt (terminal, never stuck)', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('failure');
    try {
      const verificationId = await startVerificationRow(sourceId);
      runVerificationMock.mockRejectedValue(new Error('boom'));

      await runSourceVerification(sourceId, verificationId);

      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      expect(row!.completedAt).not.toBeNull();
      expect(row!.errorMessage).toBe('boom');
      expect(row!.allPassed).toBe(false);

      // Failure must not clear driftedFields — that only happens on allPassed.
      const sourceRow = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
      expect(sourceRow!.driftedFields).toEqual(['price']);
    } finally {
      await cleanup();
    }
  });

  it('on failure: strips ANSI escape codes from a Playwright-style errorMessage before persisting it', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('failure-ansi');
    try {
      const verificationId = await startVerificationRow(sourceId);
      // Shaped like Playwright's real `page.setContent` timeout: the "Call log:"
      // lines are dim/reset-styled with raw ANSI codes (2026-09-07 live pre-check
      // — these rendered as garbled glyphs in the dashboard's error banner).
      const ansiMessage = 'page.setContent: Timeout 30000ms exceeded.\nCall log:\n\\u001b[2m  - setting frame content\\u001b[22m\n\\u001b[2m  - waiting until "load"\\u001b[22m'
        .replace(/\\u001b/g, '');
      runVerificationMock.mockRejectedValue(new Error(ansiMessage));

      await runSourceVerification(sourceId, verificationId);

      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      expect(row!.completedAt).not.toBeNull();
      expect(row!.errorMessage).toBe(
        'page.setContent: Timeout 30000ms exceeded.\nCall log:\n  - setting frame content\n  - waiting until "load"',
      );
      expect(row!.errorMessage).not.toContain('');
    } finally {
      await cleanup();
    }
  });

  it('re-verify (onlyKeys) reuses fresh captures from the previous completed run — skipping a newer failed row — and never creates a new captures row for a reused page', async () => {
    const { sourceId, urls, cleanup } = await makeSchemaSource('reuse');
    try {
      const certifiedPrice = [{ source: 'api' as const, path: 'item.price', transform: 'identity' as const }];
      const cannedRun = {
        outcome: {
          fields: { price: { key: 'price', cells: {}, certified: certifiedPrice, weakEvidence: false, aiCalled: false, incomplete: false } },
          allPassed: true,
          aiCalls: 0,
        },
        captures: {
          [urls[0]!]: fakeCapture(urls[0]!, '<html>1</html>'),
          [urls[1]!]: fakeCapture(urls[1]!, '<html>2</html>'),
          [urls[2]!]: fakeCapture(urls[2]!, '<html>3</html>'),
        },
        captureErrors: {},
      };
      const base = Date.now();

      // First (full) verification — produces a completed row with real
      // on-disk capture files (.capture.json sidecars) to reuse from.
      const firstId = await startVerificationRow(sourceId, { startedAt: new Date(base - 20_000) });
      runVerificationMock.mockResolvedValueOnce(cannedRun);
      await runSourceVerification(sourceId, firstId);
      const firstRow = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, firstId) });
      const firstRefs = firstRow!.captures as Record<string, { captureId: string }>;

      // A newer row that STALLED/FAILED (errorMessage set) sits between the
      // completed run above and the current re-verify below — fix round 1
      // (minor): it carries no real results/captures and must be skipped in
      // favour of the older-but-genuinely-completed row.
      await db.insert(sourceVerifications).values({
        sourceId,
        definitionHash: 'irrelevant-for-this-test',
        startedAt: new Date(base - 10_000),
        completedAt: new Date(base - 10_000),
        errorMessage: 'stalled',
      });

      // Second (re-verify, onlyKeys given) — must reuse the FIRST run's
      // captures, not the failed row's (which has none).
      const secondId = await startVerificationRow(sourceId, { startedAt: new Date(base) });
      runVerificationMock.mockResolvedValueOnce(cannedRun);
      await runSourceVerification(sourceId, secondId, { onlyKeys: ['price'] });

      expect(runVerificationMock).toHaveBeenCalledTimes(2);
      const deps = runVerificationMock.mock.calls[1]![1] as { captures?: Record<string, unknown>; previous?: unknown; onlyKeys?: string[] };
      expect(Object.keys(deps.captures ?? {}).sort()).toEqual([...urls].sort());
      expect(deps.previous).toBeDefined();
      expect(deps.onlyKeys).toEqual(['price']);

      const secondRow = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, secondId) });
      const secondRefs = secondRow!.captures as Record<string, { captureId: string }>;
      // Same captureId as the first run — reused, not recaptured.
      expect(secondRefs[urls[0]!]!.captureId).toBe(firstRefs[urls[0]!]!.captureId);

      const capturesForUrl = await db.query.captures.findMany({ where: eq(captures.url, urls[0]!) });
      expect(capturesForUrl).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it('hands runVerification a fresh proof-page capture as a reused capture and writes its ref, creating no new captures row', async () => {
    const { sourceId, urls, cleanup } = await makeSchemaSource('proofpage');
    try {
      // A proof page captured for marking, as proof-page-capture.ts stores it: a captures row with
      // the state in metadata, and the capture file beside the screenshots.
      const now = new Date().toISOString();
      const [seeded] = await db.insert(captures).values({
        sourceId, url: urls[0]!, html: '<html>seeded</html>',
        metadata: { kind: 'proof-page', status: 'captured', url: urls[0], startedAt: now, capturedAt: now, tiles: ['/captures/seeded.png'], boxes: [], pageHeight: 0, capturedHeight: 0, contentHeight: 0 },
      }).returning({ id: captures.id });
      await writeCaptureFile(seeded!.id, fakeCapture(urls[0]!, '<html>seeded</html>'));

      const verificationId = await startVerificationRow(sourceId);
      runVerificationMock.mockImplementation(async (_req: unknown, deps: { captures?: Record<string, PageCapture> }) => ({
        outcome: { fields: {}, allPassed: false, aiCalls: 0 },
        captures: { [urls[0]!]: deps.captures![urls[0]!]!, [urls[1]!]: fakeCapture(urls[1]!, '<html>2</html>'), [urls[2]!]: fakeCapture(urls[2]!, '<html>3</html>') },
        captureErrors: {},
      }));

      await runSourceVerification(sourceId, verificationId);

      const deps = runVerificationMock.mock.calls[0]![1] as { captures?: Record<string, PageCapture> };
      expect(deps.captures?.[urls[0]!]?.html).toBe('<html>seeded</html>');
      expect(deps.captures?.[urls[1]!]).toBeUndefined();

      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      const refs = row!.captures as Record<string, { captureId: string; screenshotUrl?: string }>;
      expect(refs[urls[0]!]).toMatchObject({ captureId: seeded!.id, screenshotUrl: '/captures/seeded.png' });
      expect(refs[urls[1]!]!.captureId).not.toBe(seeded!.id);
      const rowsForUrl0 = await db.query.captures.findMany({ where: eq(captures.url, urls[0]!) });
      expect(rowsForUrl0).toHaveLength(1); // reused, not stored again
    } finally {
      await cleanup();
    }
  });
});

describe('writeStage', () => {
  it('is a no-op against an already-completed row — never clobbers its real captures', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('stage-completed');
    try {
      const realRefs = { [`https://test-runverify-stage-completed.example.com/p/1`]: { captureId: 'abc123', capturedAt: new Date().toISOString() } };
      const [row] = await db
        .insert(sourceVerifications)
        .values({ sourceId, definitionHash: 'irrelevant-for-this-test', completedAt: new Date(), captures: realRefs })
        .returning({ id: sourceVerifications.id });

      await writeStage(db, row!.id, 'searching');

      const after = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, row!.id) });
      expect(after!.captures).toEqual(realRefs);
    } finally {
      await cleanup();
    }
  });

  it('writes _stage onto an in-flight (uncompleted) row', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('stage-inflight');
    try {
      const verificationId = await startVerificationRow(sourceId);

      await writeStage(db, verificationId, 'searching');

      const after = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      expect(after!.captures).toEqual({ _stage: 'searching' });
    } finally {
      await cleanup();
    }
  });
});

describe('runSourceVerification — variants', () => {
  const certifiedPrice = [{ source: 'api' as const, path: 'item.price', transform: 'identity' as const }];
  const passingRun = (urls: string[], pages: Array<'p1' | 'p2' | 'p3'>) => ({
    outcome: { fields: { price: { key: 'price', cells: {}, certified: certifiedPrice, weakEvidence: false, aiCalled: false, incomplete: false } }, allPassed: true, aiCalls: 0 },
    captures: Object.fromEntries(urls.map((u, i) => [u, { ...VARIANT_SHOP[pages[i]!], url: u, screenshot: Buffer.from('x') }])),
    captureErrors: {},
  });

  async function variantSource(tag: string, method: 'list' | 'links') {
    const s = await makeSchemaSource(tag);
    const src = await db.query.sources.findFirst({ where: eq(sources.id, s.sourceId), columns: { datasetId: true } });
    await caller.datasets.setVariantMode({ datasetId: src!.datasetId!, mode: 'row_per_variant' });
    const setup = await caller.sources.setVariantSetup({ sourceId: s.sourceId, method, axes: [{ from: 'color', newAxisName: 'Colour' }] });
    const colour = setup.axes[0]!.axisKey;
    const list = { source: 'json-ld' as const, path: 'hasVariant' };
    await caller.sources.saveVariantAnswer({ sourceId: s.sourceId, url: s.urls[0]!, answer: { count: 2, labels: ['Black', 'Red'], list, links: [s.urls[0]!, `${s.urls[0]!}-red`], spot: { index: 0, expected: { price: '10.00', [colour]: 'Black' } } } });
    await caller.sources.saveVariantAnswer({ sourceId: s.sourceId, url: s.urls[1]!, answer: { count: 3, labels: ['Black', 'Red', 'White'], list, links: ['black', 'red', 'white'].map((c) => `${s.urls[1]!}-${c}`), spot: { index: 0, expected: { price: '20.00', [colour]: 'Black' } } } });
    await caller.sources.saveVariantAnswer({ sourceId: s.sourceId, url: s.urls[2]!, answer: { count: 0, labels: [] } });
    return s;
  }

  it('ignore mode: writes variantResults null', async () => {
    const { sourceId, urls, cleanup } = await makeSchemaSource('variants-ignore');
    try {
      const verificationId = await startVerificationRow(sourceId);
      runVerificationMock.mockResolvedValue(passingRun(urls, ['p1', 'p2', 'p3']));
      await runSourceVerification(sourceId, verificationId);
      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      expect(row!.completedAt).not.toBeNull();
      expect(row!.variantResults).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('variants required: checks them on the run\'s own captures and writes them with the field results', async () => {
    const { sourceId, urls, cleanup } = await variantSource('variants-list', 'list');
    try {
      const verificationId = await startVerificationRow(sourceId);
      runVerificationMock.mockResolvedValue(passingRun(urls, ['p1', 'p2', 'p3']));
      await runSourceVerification(sourceId, verificationId);
      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      expect(row!.allPassed).toBe(true);
      expect(row!.variantResults).toMatchObject({ method: 'list', passed: true, pages: { [urls[0]!]: { status: 'pass', count: 2 }, [urls[2]!]: { status: 'none' } } });
      expect((await loadVariantCurrency(db, sourceId))).toMatchObject({ required: 'yes', current: true, passed: true });
    } finally {
      await cleanup();
    }
  });

  it('a throw inside the variant check is a failed variant result, never a failed field run', async () => {
    // The stubbed browser has no setContentEvaluate, so the links method throws.
    const { sourceId, urls, cleanup } = await variantSource('variants-throw', 'links');
    try {
      const verificationId = await startVerificationRow(sourceId);
      runVerificationMock.mockResolvedValue(passingRun(urls, ['p1', 'p2', 'p3']));
      await runSourceVerification(sourceId, verificationId);
      const row = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      expect(row!.errorMessage).toBeNull();
      expect(row!.allPassed).toBe(true);
      expect(row!.results).toMatchObject({ price: { certified: certifiedPrice } });
      expect(row!.variantResults).toMatchObject({ method: 'links', passed: false, problem: 'The variant check failed — try Verify again', pages: {} });
      expect(saveVerifiedPathsMock).toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
