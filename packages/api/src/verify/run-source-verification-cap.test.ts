// Verify at the organisation's monthly limit (spec 2026-10-24 metering §2.3): `runSourceVerification` builds no model at
// the limit and wraps it below the limit, at the per-field estimate. No browser and no model: the walk
// (`runVerification`) and `SchemaAgent` are mocked, and the mocked walk calls the agent it was handed.
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { PageCapture } from '@robot/browser';
import { capLedgerOf, cappedAgent, isCapReached, resetCapLedgers, type ProposePathsAgent } from '@robot/agent';
import { db, orgs, runs, sourceVerifications } from '@robot/db';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { signedInCaller } from '../test-helpers/identity.js';

const { runVerificationMock, built, propose, hooks } = vi.hoisted(() => ({
  runVerificationMock: vi.fn(),
  built: vi.fn(),
  propose: vi.fn(async () => [] as unknown[]),
  /** Runs right after the remainder is read from the database, before the read's answer is used. */
  hooks: { afterRead: null as null | (() => void) },
}));
// Review I1: a sibling job may record its cost and close while this job's remainder is being read.
vi.mock('../metering/cap-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../metering/cap-state.js')>();
  return {
    ...actual,
    orgCapState: vi.fn(async (...a: Parameters<typeof actual.orgCapState>) => { const s = await actual.orgCapState(...a); hooks.afterRead?.(); return s; }),
    capStateForSource: vi.fn(async (...a: Parameters<typeof actual.capStateForSource>) => { const s = await actual.capStateForSource(...a); hooks.afterRead?.(); return s; }),
  };
});
vi.mock('@robot/scraper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robot/scraper')>()),
  runVerification: runVerificationMock,
  saveVerifiedPaths: vi.fn(async () => undefined),
}));
vi.mock('@robot/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/agent')>();
  class FakeSchemaAgent { constructor() { built(); } proposePaths = propose; }
  return { ...actual, SchemaAgent: FakeSchemaAgent };
});
vi.mock('../browser-session.js', () => ({ withBrowserSession: vi.fn(async (fn: (b: unknown) => Promise<unknown>) => fn({})) }));
process.env.CAPTURES_DIR = mkdtempSync(join(tmpdir(), 'robot-verify-cap-'));
const { runSourceVerification } = await import('./run-source-verification.js');

const me = await signedInCaller('verify-cap');
const savedKey = process.env.ANTHROPIC_API_KEY;
const savedCap = process.env.ORG_AI_CAP_USD;
afterEach(async () => {
  runVerificationMock.mockReset(); built.mockClear(); propose.mockClear();
  hooks.afterRead = null;
  resetCapLedgers();
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
  if (savedCap === undefined) delete process.env.ORG_AI_CAP_USD; else process.env.ORG_AI_CAP_USD = savedCap;
  await db.update(orgs).set({ aiCapUsd: null }).where(eq(orgs.id, me.org.id));
});
afterAll(async () => { await me.cleanup(); });

const capture = (url: string): PageCapture => ({
  url, html: '<html></html>', markdown: '', screenshot: Buffer.from('x'), screenshotTiles: [], verdict: { kind: 'ok', status: 200 },
  title: '', timestamp: Date.now(), structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [],
});

async function site(tag: string) {
  const urls = [1, 2, 3].map((n) => `https://test-verify-cap-${tag}.example.com/p/${n}`);
  const f = await createProjectWithSource(me.caller, {
    tag: `verify-cap-${tag}`, urls, fields: [{ name: 'Price', type: 'money', description: 'x' }],
    expected: { Price: { [urls[0]!]: '1.00', [urls[1]!]: '2.00', [urls[2]!]: '3.00' } },
  });
  const [row] = await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'cap', completedAt: null }).returning({ id: sourceVerifications.id });
  return { ...f, urls, verificationId: row!.id };
}

/** What the mocked walk returns: the one field failed `ai_unavailable`, every page captured. */
const outcome = (urls: string[]) => ({
  outcome: { fields: { price: { key: 'price', cells: {}, certified: [], weakEvidence: false, aiCalled: false, incomplete: false, failReason: 'ai_unavailable' } }, allPassed: false, aiCalls: 0 },
  captures: Object.fromEntries(urls.map((u) => [u, capture(u)])),
  captureErrors: {},
});
const startCoverage = vi.fn(async () => ({ checkId: 'none', status: 'started' as const }));
const startCheck = vi.fn(async () => undefined);

describe('runSourceVerification and the monthly limit (spec 2026-10-24 metering §2.3)', () => {
  it('at the limit no model is built and every call is refused before it is made', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    await db.update(orgs).set({ aiCapUsd: '0.00' }).where(eq(orgs.id, me.org.id));
    const f = await site('at');
    try {
      let refusal: unknown;
      runVerificationMock.mockImplementationOnce(async (_req: unknown, deps: { agent: ProposePathsAgent | null }) => {
        refusal = await deps.agent!.proposePaths('x').catch((e: unknown) => e);
        return outcome(f.urls);
      });
      await runSourceVerification(f.sourceId, f.verificationId, { startCoverage, startCheck });
      expect(isCapReached(refusal)).toBe(true);
      expect(built).not.toHaveBeenCalled();
      expect(propose).not.toHaveBeenCalled();
      const row = (await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.id, f.verificationId) }))!;
      expect(row).toMatchObject({ costUsd: '0.0000', errorMessage: null });
      expect(row.completedAt).not.toBeNull();
    } finally { await f.cleanup(); }
  });

  it('with room for two calls at the per-field estimate ($0.18 on three pages), two go through and the third is refused', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    await db.update(orgs).set({ aiCapUsd: '0.40' }).where(eq(orgs.id, me.org.id));
    const f = await site('room');
    await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed', costUsd: '0.0400' }); // $0.36 left
    try {
      const results: unknown[] = [];
      runVerificationMock.mockImplementationOnce(async (_req: unknown, deps: { agent: ProposePathsAgent | null }) => {
        for (const t of ['a', 'b', 'c']) results.push(await deps.agent!.proposePaths(t).then(() => 'asked', (e: unknown) => e));
        return outcome(f.urls);
      });
      await runSourceVerification(f.sourceId, f.verificationId, { startCoverage, startCheck });
      expect(built).toHaveBeenCalledTimes(1);
      expect(propose).toHaveBeenCalledTimes(2);
      expect(results.slice(0, 2)).toEqual(['asked', 'asked']);
      expect(isCapReached(results[2])).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('RF1 (review I1): a sibling job of the org that records its cost and closes while this Verify reads the remainder still counts', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    await db.update(orgs).set({ aiCapUsd: '0.40' }).where(eq(orgs.id, me.org.id));
    const f = await site('sibling');
    await db.insert(runs).values({ sourceId: f.sourceId, status: 'completed', costUsd: '0.0400' }); // $0.36 left
    try {
      // The sibling started on the same $0.36 and made one $0.18 call; it records and closes during this Verify's read,
      // so the read does not include its cost — the slot this Verify took before reading must.
      const sibling = cappedAgent<ProposePathsAgent>({ proposePaths: async () => [] }, { remainingUsd: 0.36, perCallUsd: 0.18, orgId: me.org.id });
      await sibling.proposePaths('x');
      hooks.afterRead = () => capLedgerOf(sibling)!.close();
      const results: unknown[] = [];
      runVerificationMock.mockImplementationOnce(async (_req: unknown, deps: { agent: ProposePathsAgent | null }) => {
        for (const t of ['a', 'b']) results.push(await deps.agent!.proposePaths(t).then(() => 'asked', (e: unknown) => e));
        return outcome(f.urls);
      });
      await runSourceVerification(f.sourceId, f.verificationId, { startCoverage, startCheck });
      expect(propose).toHaveBeenCalledTimes(1);
      expect(results[0]).toBe('asked');
      expect(isCapReached(results[1])).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('keyless or free, there is no agent at all — as before', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const f = await site('keyless');
    try {
      runVerificationMock.mockImplementation(async (_req: unknown, deps: { agent: unknown }) => { expect(deps.agent).toBeNull(); return outcome(f.urls); });
      await runSourceVerification(f.sourceId, f.verificationId, { startCoverage, startCheck });
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const [again] = await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'cap', completedAt: null }).returning({ id: sourceVerifications.id });
      await runSourceVerification(f.sourceId, again!.id, { free: true, startCoverage, startCheck });
      expect(runVerificationMock).toHaveBeenCalledTimes(2);
      expect(built).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });
});
