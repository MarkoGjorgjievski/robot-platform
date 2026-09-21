import { describe, it, expect, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sources, sourceVerifications } from '@robot/db';
import { VERIFY_STALL_MS, fieldHash, type SchemaDefinitionField, type VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';

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
const caller = createCaller({ db, session: null });

function urlsFor(tag: string): string[] {
  return [
    `https://test-verify-${tag}.example.com/p/1`,
    `https://test-verify-${tag}.example.com/p/2`,
    `https://test-verify-${tag}.example.com/p/3`,
  ];
}

/** The current per-field hash of a source's field, as the server computes it. */
async function hashOf(sourceId: string, key: string): Promise<string> {
  const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  const def = (src!.schemaDefinition as SchemaDefinitionField[]).find((d) => d.key === key)!;
  return fieldHash(def, src!.verificationSet as VerificationSet);
}

async function makeSchemaSource(tag: string) {
  const urls = urlsFor(tag);
  const f = await createProjectWithSource(caller, {
    tag: `verify-${tag}`,
    urls,
    fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  return { sourceId: f.sourceId, urls, keys: f.keys, datasetId: f.datasetId, cleanup: f.cleanup };
}

describe('sources.verify', () => {
  it('refuses a Source without a schema definition (PRECONDITION_FAILED)', async () => {
    const f = await createProjectWithSource(caller, { tag: 'verify-noschema', fields: [] });
    try {
      await expect(caller.sources.verify({ sourceId: f.sourceId })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
      expect(runSourceVerificationMock).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    await expect(
      caller.sources.verify({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a second call while one is in flight returns the same id with status in-progress, and does not start again', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('inflight');
    try {
      const first = await caller.sources.verify({ sourceId });
      expect(first.status).toBe('started');
      expect(runSourceVerificationMock).toHaveBeenCalledTimes(1);

      const second = await caller.sources.verify({ sourceId });
      expect(second.status).toBe('in-progress');
      expect(second.verificationId).toBe(first.verificationId);
      expect(runSourceVerificationMock).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it('closes a stalled in-flight verification (older than VERIFY_STALL_MS) and starts a fresh one', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('stalled');
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
      await cleanup();
    }
  });
});

describe('sources.verificationStatus', () => {
  it('returns null when no verification has ever run', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('nostatus');
    try {
      expect(await caller.sources.verificationStatus({ sourceId })).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('returns current: false once the schema hash changes underneath a completed row', async () => {
    const { sourceId, urls, keys, datasetId, cleanup } = await makeSchemaSource('statushash');
    try {
      const [row] = await db
        .insert(sourceVerifications)
        .values({ sourceId, definitionHash: 'a-hash-that-will-go-stale', completedAt: new Date(), allPassed: true })
        .returning({ id: sourceVerifications.id });

      // Change the schema underneath the completed row: add a contract field
      // (datasets.addField) and rebind — same effect `updateSchema` used to
      // have, achieved through the contract + binding split (Task 4/5).
      await caller.datasets.addField({ datasetId, name: 'Brand', type: 'text' });
      await caller.sources.updateBinding({
        sourceId,
        urls,
        descriptions: { [keys.Price!]: 'x', brand: 'y' },
        expected: {
          [keys.Price!]: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' },
          brand: { [urls[0]!]: 'Acme', [urls[1]!]: 'Acme', [urls[2]!]: 'Acme' },
        },
      });

      const status = await caller.sources.verificationStatus({ sourceId });
      expect(status).not.toBeNull();
      expect(status!.id).toBe(row!.id);
      expect(status!.current).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('surfaces the reserved _stage key as `stage` and strips it from `captures`', async () => {
    const { sourceId, cleanup } = await makeSchemaSource('stage');
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
      await cleanup();
    }
  });
});

describe('sources.verifyEstimate', () => {
  it('returns fields, perFieldUsd 0.05, and upperBoundUsd 0 when aiAvailable is false', async () => {
    const urls = urlsFor('estimate');
    const f = await createProjectWithSource(caller, {
      tag: 'verify-estimate',
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
      const est = await caller.sources.verifyEstimate({ sourceId: f.sourceId });
      // `stallMs` (C1) rides along on every estimate: the Schema screen needs the
      // server's own stall window to tell a live verification from a crash leftover.
      // No prior clean run at all, so both fields are un-certified and would
      // reach AI (aiFields === fields) — priced at 0 only because aiAvailable is false.
      expect(est).toEqual({ fields: 2, aiFields: 2, perFieldUsd: 0.05, upperBoundUsd: 0, aiAvailable: false, capturesFresh: false, stallMs: VERIFY_STALL_MS });
    } finally {
      if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
      await f.cleanup();
    }
  });

  it('throws NOT_FOUND for an unknown sourceId', async () => {
    await expect(
      caller.sources.verifyEstimate({ sourceId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('sources.verifyEstimate re-verify pricing', () => {
  it('prices only the keys asked for and reports fresh captures from the latest clean run', async () => {
    const tag = `est-${Date.now()}`;
    const urls = urlsFor(tag);
    const f = await createProjectWithSource(caller, {
      tag,
      urls,
      fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
      expected: {
        Price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' },
        Title: { [urls[0]!]: 'a', [urls[1]!]: 'b', [urls[2]!]: 'c' },
      },
    });
    try {
      const all = await caller.sources.verifyEstimate({ sourceId: f.sourceId });
      expect(all.fields).toBe(2);
      expect(all.capturesFresh).toBe(false);
      expect(all.perFieldUsd).toBeGreaterThan(0);

      const now = new Date().toISOString();
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId,
        definitionHash: 'x',
        completedAt: new Date(),
        results: {},
        captures: Object.fromEntries(f.urls.map((url) => [url, { captureId: 'c', capturedAt: now }])),
      });
      const one = await caller.sources.verifyEstimate({ sourceId: f.sourceId, onlyKeys: [f.keys.Price!] });
      expect(one.fields).toBe(1);
      // No certified path on the latest clean row for Price, so it would
      // still reach AI on a re-verify.
      expect(one.aiFields).toBe(1);
      expect(one.capturesFresh).toBe(true);
      expect(one.upperBoundUsd).toBe(one.aiAvailable ? one.perFieldUsd : 0);
    } finally {
      await f.cleanup();
    }
  });

  it('prices only the keys that would actually reach AI: a certified key replays for free', async () => {
    const tag = `est3-${Date.now()}`;
    const urls = urlsFor(tag);
    const f = await createProjectWithSource(caller, {
      tag,
      urls,
      fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
      expected: {
        Price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' },
        Title: { [urls[0]!]: 'a', [urls[1]!]: 'b', [urls[2]!]: 'c' },
      },
    });
    try {
      const certifiedPath = { source: 'json-ld', path: '$.price', transform: 'identity' };
      const certifiedFv = async (key: string) => ({ key, cells: {}, certified: [certifiedPath], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: await hashOf(f.sourceId, key) });
      const uncertifiedFv = (key: string) => ({ key, cells: {}, certified: [], weakEvidence: false, aiCalled: false, incomplete: false });

      // Both keys certified on the latest clean run: neither would reach AI.
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId,
        definitionHash: 'x',
        completedAt: new Date(),
        results: { [f.keys.Price!]: await certifiedFv(f.keys.Price!), [f.keys.Title!]: await certifiedFv(f.keys.Title!) },
      });
      const bothCertified = await caller.sources.verifyEstimate({ sourceId: f.sourceId, onlyKeys: [f.keys.Price!, f.keys.Title!] });
      expect(bothCertified.fields).toBe(2);
      expect(bothCertified.aiFields).toBe(0);
      expect(bothCertified.upperBoundUsd).toBe(0);

      // A newer clean run where Title lost its certification: only Title
      // would reach AI on a re-verify.
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId,
        definitionHash: 'x',
        completedAt: new Date(),
        results: { [f.keys.Price!]: await certifiedFv(f.keys.Price!), [f.keys.Title!]: uncertifiedFv(f.keys.Title!) },
      });
      const oneUncertified = await caller.sources.verifyEstimate({ sourceId: f.sourceId, onlyKeys: [f.keys.Price!, f.keys.Title!] });
      expect(oneUncertified.fields).toBe(2);
      expect(oneUncertified.aiFields).toBe(1);
      expect(oneUncertified.upperBoundUsd).toBe(oneUncertified.aiAvailable ? oneUncertified.perFieldUsd : 0);
    } finally {
      await f.cleanup();
    }
  });

  it('counts a field whose pages changed as AI-reachable, and only that field', async () => {
    const tag = `est4-${Date.now()}`;
    const urls = urlsFor(tag);
    const f = await createProjectWithSource(caller, {
      tag, urls,
      fields: [{ name: 'Price', type: 'money', description: 'green number' }, { name: 'Title', type: 'text', description: 'heading' }],
      expected: {
        Price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' },
        Title: { [urls[0]!]: 'a', [urls[1]!]: 'b', [urls[2]!]: 'c' },
      },
    });
    try {
      const path = { source: 'json-ld', path: 'offers.price', transform: 'identity' };
      const fv = async (key: string) => ({ key, cells: {}, certified: [path], weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: await hashOf(f.sourceId, key) });
      const price = f.keys.Price!; const title = f.keys.Title!;
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(),
        results: { [price]: await fv(price), [title]: await fv(title) }, captures: {},
      });
      expect((await caller.sources.verifyEstimate({ sourceId: f.sourceId })).aiFields).toBe(0);

      // A fourth proof page, checked for Price only (spec 2026-09-17 §4).
      const page4 = `${new URL(urls[0]!).origin}/p/${tag}-4`;
      await caller.sources.updateBinding({
        sourceId: f.sourceId, urls: [...urls, page4],
        descriptions: { [price]: 'green number', [title]: 'heading' },
        expected: {
          [price]: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3', [page4]: '4' },
          [title]: { [urls[0]!]: 'a', [urls[1]!]: 'b', [urls[2]!]: 'c', [page4]: '' },
        },
      });
      // Price has a certified path from pages 1–3, but page four may need AI: not free.
      expect((await caller.sources.verifyEstimate({ sourceId: f.sourceId, onlyKeys: [price] })).aiFields).toBe(1);
      // Title is not checked on page four: its hash did not move.
      expect((await caller.sources.verifyEstimate({ sourceId: f.sourceId, onlyKeys: [title] })).aiFields).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it('captures are not fresh when one url is missing or blocked', async () => {
    const tag = `est2-${Date.now()}`;
    const urls = urlsFor(tag);
    const f = await createProjectWithSource(caller, {
      tag,
      urls,
      fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { [urls[0]!]: '1', [urls[1]!]: '2', [urls[2]!]: '3' } },
    });
    try {
      const now = new Date().toISOString();
      await db.insert(sourceVerifications).values({
        sourceId: f.sourceId,
        definitionHash: 'x',
        completedAt: new Date(),
        results: {},
        captures: {
          [f.urls[0]!]: { captureId: 'c', capturedAt: now },
          [f.urls[1]!]: { captureId: '', capturedAt: now, blockedReason: 'blocked' },
        },
      });
      expect((await caller.sources.verifyEstimate({ sourceId: f.sourceId })).capturesFresh).toBe(false);
    } finally {
      await f.cleanup();
    }
  });
});
