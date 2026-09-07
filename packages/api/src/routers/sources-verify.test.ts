import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources, inputSets, sourceVerifications } from '@robot/db';
import { VERIFY_STALL_MS } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';

// `sources.verify` fires `runSourceVerification` (verify/run-source-verification.ts)
// without awaiting it — stubbed here so this file exercises ONLY sources.ts's
// own guards (schema presence, the in-flight/stall rule), never a real
// browser or LLM call. Same `vi.hoisted` pattern `sources.test.ts` uses for
// `planSource`.
const { runSourceVerificationMock } = vi.hoisted(() => ({
  runSourceVerificationMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../verify/run-source-verification.js', () => ({ runSourceVerification: runSourceVerificationMock }));

afterEach(() => {
  runSourceVerificationMock.mockClear();
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

function urlsFor(tag: string): string[] {
  return [
    `https://test-verify-${tag}.example.com/p/1`,
    `https://test-verify-${tag}.example.com/p/2`,
    `https://test-verify-${tag}.example.com/p/3`,
  ];
}

async function makeSchemaSource(tag: string) {
  const urls = urlsFor(tag);
  const created = await caller.sources.createWithSchema({
    urls,
    fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  return { sourceId: created.sourceId, urls };
}

describe('sources.verify', () => {
  it('refuses a Source without a schema definition (PRECONDITION_FAILED)', async () => {
    const created = await caller.sources.quickCreate({ mode: 'detail', urls: ['https://test-verify-noschema.example.com/p/1'] });
    try {
      await expect(caller.sources.verify({ sourceId: created.sourceId })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(runSourceVerificationMock).not.toHaveBeenCalled();
    } finally {
      await cleanupSource(created.sourceId);
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    await expect(
      caller.sources.verify({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a second call while one is in flight returns the same id with status in-progress, and does not start again', async () => {
    const { sourceId } = await makeSchemaSource('inflight');
    try {
      const first = await caller.sources.verify({ sourceId });
      expect(first.status).toBe('started');
      expect(runSourceVerificationMock).toHaveBeenCalledTimes(1);

      const second = await caller.sources.verify({ sourceId });
      expect(second.status).toBe('in-progress');
      expect(second.verificationId).toBe(first.verificationId);
      expect(runSourceVerificationMock).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupSource(sourceId);
    }
  });

  it('closes a stalled in-flight verification (older than VERIFY_STALL_MS) and starts a fresh one', async () => {
    const { sourceId } = await makeSchemaSource('stalled');
    try {
      const [stale] = await db
        .insert(sourceVerifications)
        .values({
          sourceId,
          definitionHash: 'stale-hash',
          startedAt: new Date(Date.now() - VERIFY_STALL_MS - 60_000),
          completedAt: null,
        })
        .returning({ id: sourceVerifications.id });

      const result = await caller.sources.verify({ sourceId });
      expect(result.status).toBe('started');
      expect(result.verificationId).not.toBe(stale!.id);

      const closed = await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, stale!.id) });
      expect(closed!.errorMessage).toBe('stalled');
      expect(closed!.completedAt).not.toBeNull();

      expect(runSourceVerificationMock).toHaveBeenCalledTimes(1);
      expect(runSourceVerificationMock).toHaveBeenCalledWith(sourceId, result.verificationId, expect.anything());
    } finally {
      await cleanupSource(sourceId);
    }
  });
});

describe('sources.verificationStatus', () => {
  it('returns null when no verification has ever run', async () => {
    const { sourceId } = await makeSchemaSource('nostatus');
    try {
      expect(await caller.sources.verificationStatus({ sourceId })).toBeNull();
    } finally {
      await cleanupSource(sourceId);
    }
  });

  it('returns current: false once the schema hash changes underneath a completed row', async () => {
    const { sourceId, urls } = await makeSchemaSource('statushash');
    try {
      const [row] = await db
        .insert(sourceVerifications)
        .values({ sourceId, definitionHash: 'a-hash-that-will-go-stale', completedAt: new Date(), allPassed: true })
        .returning({ id: sourceVerifications.id });

      await caller.sources.updateSchema({
        sourceId,
        urls,
        fields: [{ name: 'Brand', type: 'text', description: 'y' }],
        expected: { Brand: { [urls[0]!]: 'Acme', [urls[1]!]: 'Acme', [urls[2]!]: 'Acme' } },
      });

      const status = await caller.sources.verificationStatus({ sourceId });
      expect(status).not.toBeNull();
      expect(status!.id).toBe(row!.id);
      expect(status!.current).toBe(false);
    } finally {
      await cleanupSource(sourceId);
    }
  });

  it('surfaces the reserved _stage key as `stage` and strips it from `captures`', async () => {
    const { sourceId } = await makeSchemaSource('stage');
    try {
      const [row] = await db
        .insert(sourceVerifications)
        .values({ sourceId, definitionHash: 'irrelevant', completedAt: null, captures: { _stage: 'searching' } })
        .returning({ id: sourceVerifications.id });

      const status = await caller.sources.verificationStatus({ sourceId });
      expect(status!.id).toBe(row!.id);
      expect(status!.stage).toBe('searching');
      expect(status!.captures).toEqual({});
    } finally {
      await cleanupSource(sourceId);
    }
  });
});

describe('sources.verifyEstimate', () => {
  it('returns fields × 0.05 and aiAvailable: false in tests', async () => {
    const urls = urlsFor('estimate');
    const created = await caller.sources.createWithSchema({
      urls,
      fields: [
        { name: 'Price', type: 'money', description: 'x' },
        { name: 'Brand', type: 'text', description: 'y' },
      ],
      expected: {
        Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' },
        Brand: { [urls[0]!]: 'Acme', [urls[1]!]: 'Acme', [urls[2]!]: 'Acme' },
      },
    });
    // The dev `.env` this repo loads on import carries a real
    // ANTHROPIC_API_KEY for live/paid tests elsewhere — unset it just for
    // this assertion (and restore it) so `aiAvailable` reads as it would in
    // a genuinely keyless environment, without this file ever being the one
    // that SETS the key.
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const est = await caller.sources.verifyEstimate({ sourceId: created.sourceId });
      // `stallMs` (C1) rides along on every estimate: the Schema screen needs the
      // server's own stall window to tell a live verification from a crash leftover.
      expect(est).toEqual({ fields: 2, upperBoundUsd: 0.1, aiAvailable: false, stallMs: VERIFY_STALL_MS });
    } finally {
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
      await cleanupSource(created.sourceId);
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    await expect(
      caller.sources.verifyEstimate({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
