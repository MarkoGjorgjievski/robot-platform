import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { db, sources, inputSets, sourceVerifications, captures } from '@robot/db';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { runSourceVerification, writeStage } from './run-source-verification.js';

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

const createCaller = createCallerFactory(appRouter);
const caller = createCaller({ db });

async function cleanupSource(sourceId: string): Promise<void> {
  const source = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { inputSetId: true },
  });
  await db.delete(sources).where(eq(sources.id, sourceId));
  if (source?.inputSetId) {
    await db.delete(inputSets).where(eq(inputSets.id, source.inputSetId));
  }
}

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
  const created = await caller.sources.createWithSchema({
    urls,
    fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  await db.update(sources).set({ driftedFields: ['price'] }).where(eq(sources.id, created.sourceId));
  return { sourceId: created.sourceId, urls };
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
    const { sourceId, urls } = await makeSchemaSource('success');
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
      await cleanupSource(sourceId);
    }
  });

  it('on failure: writes errorMessage and completedAt (terminal, never stuck)', async () => {
    const { sourceId } = await makeSchemaSource('failure');
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
      await cleanupSource(sourceId);
    }
  });

  it('on failure: strips ANSI escape codes from a Playwright-style errorMessage before persisting it', async () => {
    const { sourceId } = await makeSchemaSource('failure-ansi');
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
      await cleanupSource(sourceId);
    }
  });

  it('re-verify (onlyKeys) reuses fresh captures from the previous completed run — skipping a newer failed row — and never creates a new captures row for a reused page', async () => {
    const { sourceId, urls } = await makeSchemaSource('reuse');
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
      await cleanupSource(sourceId);
    }
  });
});

describe('writeStage', () => {
  it('is a no-op against an already-completed row — never clobbers its real captures', async () => {
    const { sourceId } = await makeSchemaSource('stage-completed');
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
      await cleanupSource(sourceId);
    }
  });

  it('writes _stage onto an in-flight (uncompleted) row', async () => {
    const { sourceId } = await makeSchemaSource('stage-inflight');
    try {
      const verificationId = await startVerificationRow(sourceId);

      await writeStage(db, verificationId, 'searching');

      const after = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, verificationId) });
      expect(after!.captures).toEqual({ _stage: 'searching' });
    } finally {
      await cleanupSource(sourceId);
    }
  });
});
