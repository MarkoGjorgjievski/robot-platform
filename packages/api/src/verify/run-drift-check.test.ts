// packages/api/src/verify/run-drift-check.test.ts
// The drift check job (drift repair Task 2): DB-backed, captures injected, a
// real browser only for the offline XPath probe / DOM search over the
// injected HTML. Never a model call, never a write outside drift_checks and
// the proof-page captures.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, count } from 'drizzle-orm';
import { db, captures, driftChecks, fieldHolds, jevReadings, sources, sourceVerifications, valueRefreshes } from '@robot/db';
import { CaptureError, BROWSER_UNAVAILABLE, PlaywrightBrowser, type IBrowser, type PageCapture } from '@robot/browser';
import {
  buildBoxMapScript, fieldHash,
  type Box, type CertifiedPath, type DriftCheckResults, type SchemaDefinitionField, type VerificationSet,
} from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { SHOP_EXAMPLE } from '../test-helpers/shop-example.js';
import { writeCaptureFile } from './capture-store.js';
import type { CheckedPage } from './run-drift-check.js';
import { startProofPageCapture, runProofPageCaptureInSlot, type ProofPageCaptureRecord } from './proof-page-capture.js';
import { signedInCaller } from '../test-helpers/identity.js';

// The Jev test turns the switch on with this fake client: never a real TypeSafe request.
const { jevAsk } = vi.hoisted(() => ({
  jevAsk: vi.fn(async (req: { questions: Array<{ key: string }> }) => ({
    model: 'jev-1.14.0', inputTokens: 100,
    answers: Object.fromEntries(req.questions.map((q) => [q.key, { choice: 'c1', probabilities: { c1: 0.9 } }])),
  })),
}));
vi.mock('./jev-client.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./jev-client.js')>()), typesafeJevClient: () => ({ ask: jevAsk }) }));

// No agent, ever (Global Constraints): both ways a model could be reached are spied on.
const { agentCtor, proposeSpy } = vi.hoisted(() => ({ agentCtor: vi.fn(), proposeSpy: vi.fn() }));
vi.mock('@robot/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robot/agent')>();
  class SpySchemaAgent { constructor() { agentCtor(); } }
  return { ...actual, SchemaAgent: SpySchemaAgent };
});
vi.mock('../../../scraper/src/verify/ai-fallback.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, proposeWithAi: proposeSpy };
});

const scraper = await import('@robot/scraper');
const { startDriftCheck, runDriftCheck, captureProofPagesWith, outcomeOfFailedCapture, storedCaptures, DRIFT_CHECK_STALL_MS } = await import('./run-drift-check.js');

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('run-drift-check');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });
const U = [SHOP_EXAMPLE.p1.url, SHOP_EXAMPLE.p2.url, SHOP_EXAMPLE.p3.url];
const PAGES: Record<string, PageCapture> = { [U[0]!]: SHOP_EXAMPLE.p1, [U[1]!]: SHOP_EXAMPLE.p2, [U[2]!]: SHOP_EXAMPLE.p3 };

let dir: string;
let browser: PlaywrightBrowser;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'captures-drift-'));
  process.env.CAPTURES_DIR = dir;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
}, 60_000);
afterAll(async () => {
  await browser.close();
  delete process.env.CAPTURES_DIR;
  await rm(dir, { recursive: true, force: true });
});

const clone = (c: PageCapture): PageCapture => ({ ...structuredClone({ ...c, screenshot: undefined, screenshotTiles: undefined }), screenshot: c.screenshot, screenshotTiles: c.screenshotTiles }) as PageCapture;

/** A captured proof-page record over `capture`, with its box map, the way loadProofPageCaptures returns one. */
async function record(capture: PageCapture): Promise<ProofPageCaptureRecord> {
  const boxes = await browser.setContentEvaluate<Box[]>(capture.html, buildBoxMapScript());
  const now = new Date().toISOString();
  return {
    ref: { captureId: '00000000-0000-0000-0000-000000000000', capturedAt: now },
    capture,
    meta: { kind: 'proof-page', status: 'captured', url: capture.url, startedAt: now, capturedAt: now, tiles: [], boxes, pageHeight: 0, capturedHeight: 0, contentHeight: 0 },
  };
}

/** price moved to a new DOM element (every structured source gone); the name changed on page 2; stock gone everywhere. */
function driftedPages(): Record<string, PageCapture> {
  const out: Record<string, PageCapture> = {};
  for (const u of U) {
    const c = clone(PAGES[u]!);
    for (const block of c.structuredData.ldJson as Array<{ offers: Record<string, unknown> }>) delete block.offers.price;
    delete c.structuredData.meta['product:price:amount'];
    for (const r of c.interceptedRequests) delete (r.parsedJson as { item: Record<string, unknown> }).item.priceCents;
    const now = c.html.match(/<span class="now">(\$[\d.]+)<\/span>/)!;
    c.html = c.html.replace(now[0]!, '').replace(/<p class="stock">[^<]*<\/p>/, `<div class="sale-price">${now[1]!}</div>`);
    out[u] = c;
  }
  const p2 = out[U[1]!]!;
  const renamed = JSON.parse(JSON.stringify({ ...p2, screenshot: undefined, screenshotTiles: undefined }).replaceAll('Widget B', 'Widget Z')) as PageCapture;
  out[U[1]!] = { ...renamed, screenshot: p2.screenshot, screenshotTiles: p2.screenshotTiles };
  return out;
}

const CERTIFIED: Record<string, CertifiedPath[]> = {
  price: [{ source: 'json-ld', path: 'offers.price', transform: 'identity' }],
  name: [{ source: 'json-ld', path: 'name', transform: 'identity' }],
  stock: [{ source: 'xpath', path: "//p[@class='stock']", transform: 'identity' }],
};

/** A website on the shop-example pages with price, name and stock certified (a current verification) and all three flagged as drifted. */
async function certifiedWebsite(tag: string) {
  const f = await createProjectWithSource(caller, {
    tag,
    urls: U,
    fields: [{ name: 'Price', type: 'money' }, { name: 'Name', type: 'text' }, { name: 'Stock', type: 'text' }],
    expected: {
      Price: { [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149.00' },
      Name: { [U[0]!]: 'Widget A', [U[1]!]: 'Widget B', [U[2]!]: 'Widget C' },
      Stock: { [U[0]!]: 'In stock', [U[1]!]: 'In stock', [U[2]!]: 'Out of stock' },
    },
  });
  const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
  const fields = src.schemaDefinition as SchemaDefinitionField[];
  const set = src.verificationSet as VerificationSet;
  const byName = (n: string) => fields.find((x) => x.name === n)!;
  const keyOf = { price: byName('Price').key, name: byName('Name').key, stock: byName('Stock').key };
  const results = Object.fromEntries((['price', 'name', 'stock'] as const).map((k) => {
    const field = byName(k === 'price' ? 'Price' : k === 'name' ? 'Name' : 'Stock');
    const certified = CERTIFIED[k]!;
    const cells = Object.fromEntries(U.map((u) => [u, { status: 'pass', found: 'x', path: certified[0] }]));
    return [field.key, { key: field.key, cells, certified, weakEvidence: false, aiCalled: false, incomplete: false, fieldHash: fieldHash(field, set) }];
  }));
  await db.insert(sourceVerifications).values({ sourceId: f.sourceId, definitionHash: 'x', completedAt: new Date(), allPassed: true, results });
  await db.update(sources).set({ driftedFields: [keyOf.price, keyOf.name, keyOf.stock] }).where(eq(sources.id, f.sourceId));
  return { ...f, keyOf };
}

// `nextCheckAt` is left out: every finished check moves it on (spec 2026-10-21 §3.3) — the one source column a check writes.
const snapshot = async (sourceId: string) => ({
  source: await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { nextCheckAt: false } }),
  verifications: (await db.select({ n: count() }).from(sourceVerifications).where(eq(sourceVerifications.sourceId, sourceId)))[0]!.n,
});

const checkRow = (id: string) => db.query.driftChecks.findFirst({ where: eq(driftChecks.id, id) });

describe('runDriftCheck', () => {
  it('records moved / changed / lost per field, changes nothing else, and never reaches a model', async () => {
    const f = await certifiedWebsite('drift-job');
    try {
      const pages = driftedPages();
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(pages[u]!)] as const)));
      const capture = vi.fn(async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null])));
      const before = await snapshot(f.sourceId);

      const { checkId, status } = await startDriftCheck(f.sourceId, null, { capture, fire: false, emptyShare: { [f.keyOf.price]: 0.6 } });
      expect(status).toBe('started');
      await runDriftCheck(checkId, { capture });

      const row = (await checkRow(checkId))!;
      expect(row.status).toBe('done');
      expect(row.error).toBeNull();
      expect(row.completedAt).not.toBeNull();
      const results = row.results as DriftCheckResults;
      expect(results.runId).toBeNull();
      expect(results.fields[f.keyOf.price]).toMatchObject({ result: 'moved', emptyShare: 0.6, path: { source: 'xpath' } });
      expect((results.fields[f.keyOf.price]!.pages[U[0]!] as { mark?: unknown }).mark).toBeDefined();
      expect(results.fields[f.keyOf.name]).toMatchObject({ result: 'changed', path: CERTIFIED.name![0], pages: { [U[1]!]: { status: 'ok', value: 'Widget Z' } } });
      expect(results.fields[f.keyOf.stock]!.result).toBe('lost');
      expect(capture).toHaveBeenCalledWith(f.sourceId, U);

      // The check changes nothing by itself.
      expect(await snapshot(f.sourceId)).toEqual(before);
      expect(agentCtor).not.toHaveBeenCalled();
      expect(proposeSpy).not.toHaveBeenCalled();
      expect(scraper.proposeWithAi).toBe(proposeSpy); // the spy is the one every scraper caller reaches
    } finally { await f.cleanup(); }
  }, 120_000);

  it('a scheduled check reads the fields it is given, records what a run writes, the captures it read and the next check', async () => {
    const f = await certifiedWebsite('drift-schedule');
    try {
      await db.update(sources).set({ driftedFields: null }).where(eq(sources.id, f.sourceId));
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(clone(PAGES[u]!))] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price, f.keyOf.name] });
      await runDriftCheck(checkId, { capture });
      const row = (await checkRow(checkId))!;
      expect(row.trigger).toBe('schedule');
      const results = row.results as DriftCheckResults;
      expect(results.trigger).toBe('schedule');
      expect(results.keys).toEqual([f.keyOf.price, f.keyOf.name]);
      expect(Object.keys(results.fields).sort()).toEqual([f.keyOf.name, f.keyOf.price].sort());
      expect(results.fields[f.keyOf.price]!.result).toBe('other-layout');
      expect(results.fields[f.keyOf.price]!.reads).toEqual({ [U[0]!]: '129.99', [U[1]!]: '219.99', [U[2]!]: '149' });
      expect(Object.keys(results.captures ?? {}).sort()).toEqual([...U].sort());
      const src = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId), columns: { nextCheckAt: true } });
      expect(src!.nextCheckAt!.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86_400_000);
    } finally { await f.cleanup(); }
  }, 120_000);

  it('storedCaptures reads the files a Verify stored and loads no page', async () => {
    await writeCaptureFile('11111111-1111-1111-1111-111111111111', clone(PAGES[U[0]!]!));
    const fn = storedCaptures({
      [U[0]!]: { captureId: '11111111-1111-1111-1111-111111111111', capturedAt: new Date().toISOString() },
      [U[1]!]: { captureId: '', capturedAt: new Date().toISOString(), blockedReason: 'The page could not be read.' },
    });
    const out = await fn('irrelevant', [U[0]!, U[1]!, U[2]!]);
    expect((out[U[0]!] as { capture: PageCapture }).capture.url).toBe(U[0]);
    expect(out[U[1]!]).toEqual({ notChecked: 'The page could not be read.' });
    expect(out[U[2]!]).toEqual({ notChecked: 'The page could not be read.' });
  });

  it('Review Focus 2: a page that no longer captures is page-gone, and the other pages still decide', async () => {
    const f = await certifiedWebsite('drift-gone');
    try {
      const recs = { [U[0]!]: await record(clone(PAGES[U[0]!]!)), [U[1]!]: await record(clone(PAGES[U[1]!]!)) };
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false });
      await runDriftCheck(checkId, { capture });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      const price = results.fields[f.keyOf.price]!;
      expect(price.result).toBe('other-layout');
      expect(price.pages[U[2]!]).toEqual({ status: 'page-gone' });
      expect(price.pages[U[0]!]).toMatchObject({ status: 'ok', value: '129.99' });
    } finally { await f.cleanup(); }
  }, 120_000);

  it('a page the site would not let us read is not-checked with its reason, never page-gone, and the others still decide', async () => {
    const f = await certifiedWebsite('drift-walled');
    try {
      const reason = 'shop.example refused the browser (HTTP 403, Cloudflare). We can\'t read this website from here yet.';
      const recs = { [U[0]!]: await record(clone(PAGES[U[0]!]!)), [U[1]!]: await record(clone(PAGES[U[1]!]!)) };
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? { notChecked: reason }]));
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false });
      await runDriftCheck(checkId, { capture });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      const price = results.fields[f.keyOf.price]!;
      expect(price.result).toBe('other-layout');
      expect(price.pages[U[2]!]).toEqual({ status: 'not-checked', reason });
      expect(price.pages[U[0]!]).toMatchObject({ status: 'ok', value: '129.99' });
    } finally { await f.cleanup(); }
  }, 120_000);

  it('every page walled off → each certified field reads not-checked, not lost', async () => {
    const f = await certifiedWebsite('drift-all-walled');
    try {
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, { notChecked: 'walled' }]));
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false });
      await runDriftCheck(checkId, { capture });
      const row = (await checkRow(checkId))!;
      expect(row.status).toBe('done');
      const results = row.results as DriftCheckResults;
      expect(Object.values(results.fields).map((x) => x.result)).toEqual(['not-checked', 'not-checked', 'not-checked']);
      expect(results.fields[f.keyOf.name]!.pages[U[1]!]).toEqual({ status: 'not-checked', reason: 'walled' });
    } finally { await f.cleanup(); }
  }, 120_000);

  it('a field with no current certified path is lost without capturing anything', async () => {
    const f = await certifiedWebsite('drift-uncert');
    try {
      await db.delete(sourceVerifications).where(eq(sourceVerifications.sourceId, f.sourceId));
      const capture = vi.fn(async () => ({}));
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false });
      await runDriftCheck(checkId, { capture });
      const row = (await checkRow(checkId))!;
      expect(row.status).toBe('done');
      const results = row.results as DriftCheckResults;
      expect(Object.values(results.fields).map((x) => x.result)).toEqual(['lost', 'lost', 'lost']);
      expect(capture).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it('a throw leaves the row failed with its error', async () => {
    const f = await certifiedWebsite('drift-throw');
    try {
      const capture = async () => { throw new Error('browser gone'); };
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false });
      await expect(runDriftCheck(checkId, { capture })).resolves.toBeUndefined();
      expect(await checkRow(checkId)).toMatchObject({ status: 'failed', error: 'browser gone' });
    } finally { await f.cleanup(); }
  });

  /** p2's price moved from 219.99 to 229.99, everywhere the page has it (JSON-LD, meta, API, visible text). */
  function priceMovedOnP2(): Record<string, PageCapture> {
    const out: Record<string, PageCapture> = { [U[0]!]: clone(PAGES[U[0]!]!), [U[2]!]: clone(PAGES[U[2]!]!) };
    const p2 = PAGES[U[1]!]!;
    const moved = JSON.parse(JSON.stringify({ ...p2, screenshot: undefined, screenshotTiles: undefined }).replaceAll('219.99', '229.99').replaceAll('21999', '22999')) as PageCapture;
    out[U[1]!] = { ...moved, screenshot: p2.screenshot, screenshotTiles: p2.screenshotTiles };
    return out;
  }

  it('a by-nature field whose path reads a new value in the same place is refreshed and re-verified, free', async () => {
    const f = await certifiedWebsite('drift-refresh');
    try {
      const pages = priceMovedOnP2();
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(pages[u]!)] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const startRefreshVerify = vi.fn(async () => null);
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price, f.keyOf.name] });
      await runDriftCheck(checkId, { capture, startRefreshVerify });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      expect(results.fields[f.keyOf.price]!.refresh).toEqual({ applied: true });
      const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
      expect((src.verificationSet as VerificationSet).expected[f.keyOf.price]![U[1]!]).toBe('229.99');
      expect(startRefreshVerify).toHaveBeenCalledWith(f.sourceId, [f.keyOf.price], results.captures);
      expect(await db.query.valueRefreshes.findFirst({ where: eq(valueRefreshes.sourceId, f.sourceId) })).toMatchObject({ fieldKey: f.keyOf.price, driftCheckId: checkId });
      expect(agentCtor).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  }, 120_000);

  it('the refresh log names the re-verify it started; a refresh that throws leaves the check done with not-applied', async () => {
    const f = await certifiedWebsite('drift-refresh-log');
    try {
      const pages = priceMovedOnP2();
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(pages[u]!)] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const startRefreshVerify = vi.fn(async (sourceId: string) => {
        // Left in flight, as a just-started re-verify is: a completed row with no results would end the certification.
        const [row] = await db.insert(sourceVerifications).values({ sourceId, definitionHash: 'x' }).returning({ id: sourceVerifications.id });
        return row!.id;
      });
      const first = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price] });
      await runDriftCheck(first.checkId, { capture, startRefreshVerify });
      const id = await startRefreshVerify.mock.results[0]!.value;
      expect(await db.query.valueRefreshes.findFirst({ where: eq(valueRefreshes.driftCheckId, first.checkId) })).toMatchObject({ verificationId: id });

      const second = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price] });
      const failing = vi.fn(async () => { throw new Error('db gone'); });
      // The stored price is 229.99 now; p1 moves too, so there is something to refresh.
      const p1 = clone(PAGES[U[0]!]!);
      const moved = JSON.parse(JSON.stringify({ ...p1, screenshot: undefined, screenshotTiles: undefined }).replaceAll('129.99', '139.99').replaceAll('12999', '13999')) as PageCapture;
      recs[U[0]!] = await record({ ...moved, screenshot: p1.screenshot, screenshotTiles: p1.screenshotTiles });
      await runDriftCheck(second.checkId, { capture, applyRefreshes: failing, startRefreshVerify });
      const row = (await checkRow(second.checkId))!;
      expect(row.status).toBe('done');
      expect((row.results as DriftCheckResults).fields[f.keyOf.price]!.refresh).toEqual({ applied: false, reason: 'not-applied' });
      expect(startRefreshVerify).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  }, 120_000);

  it('fix wave 1, item 7: a check already closed as stalled when its refreshes would be written writes none', async () => {
    const f = await certifiedWebsite('drift-refresh-closed');
    try {
      const pages = priceMovedOnP2();
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(pages[u]!)] as const)));
      let checkId = '';
      // The check is closed as stalled while it reads its pages (as startDriftCheck's stall rule would).
      const capture = async (_s: string, urls: string[]) => {
        await db.update(driftChecks).set({ status: 'failed', error: 'stalled', completedAt: new Date() }).where(eq(driftChecks.id, checkId));
        return Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      };
      const startRefreshVerify = vi.fn(async () => null);
      ({ checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price] }));
      await runDriftCheck(checkId, { capture, startRefreshVerify });
      const row = (await checkRow(checkId))!;
      expect(row.status).toBe('failed');
      expect(row.error).toBe('stalled');
      const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
      expect((src.verificationSet as VerificationSet).expected[f.keyOf.price]![U[1]!]).toBe('219.99');
      expect(await db.query.valueRefreshes.findFirst({ where: eq(valueRefreshes.sourceId, f.sourceId) })).toBeUndefined();
      expect(await db.query.fieldHolds.findFirst({ where: eq(fieldHolds.sourceId, f.sourceId) })).toBeUndefined();
      expect(startRefreshVerify).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  }, 120_000);

  it('fix wave 1, item 7: a check closed as stalled just after its refreshes were written is reopened done, showing them', async () => {
    const f = await certifiedWebsite('drift-refresh-reopen');
    try {
      const pages = priceMovedOnP2();
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(pages[u]!)] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const { applyRefreshes } = await import('./refresh-values.js');
      const applyThenStall: typeof applyRefreshes = async (sourceId, id, requests) => {
        const out = await applyRefreshes(sourceId, id, requests);
        await db.update(driftChecks).set({ status: 'failed', error: 'stalled', completedAt: new Date() }).where(eq(driftChecks.id, id!));
        return out;
      };
      const startRefreshVerify = vi.fn(async () => null);
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price] });
      await runDriftCheck(checkId, { capture, applyRefreshes: applyThenStall, startRefreshVerify });
      const row = (await checkRow(checkId))!;
      expect(row.status).toBe('done');
      expect(row.error).toBeNull();
      expect((row.results as DriftCheckResults).fields[f.keyOf.price]!.refresh).toEqual({ applied: true });
      expect(startRefreshVerify).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  }, 120_000);

  it('a price the page does not show is refused, and nothing is written', async () => {
    const f = await certifiedWebsite('drift-no-refresh');
    try {
      // p2's page data says 229.99, but its visible text no longer shows any price.
      const hidden = priceMovedOnP2()[U[1]!]!;
      hidden.html = hidden.html.replaceAll('229.99', '');
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(u === U[1] ? hidden : clone(PAGES[u]!))] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const startRefreshVerify = vi.fn(async () => null);
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price] });
      await runDriftCheck(checkId, { capture, startRefreshVerify });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      expect(results.fields[f.keyOf.price]!.refresh).toEqual({ applied: false, reason: 'not-shown' });
      expect(startRefreshVerify).not.toHaveBeenCalled();
      const src = (await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!;
      expect((src.verificationSet as VerificationSet).expected[f.keyOf.price]![U[1]!]).toBe('219.99');
    } finally { await f.cleanup(); }
  }, 120_000);

  it('a changed text field records no refresh at all', async () => {
    const f = await certifiedWebsite('drift-name');
    try {
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(driftedPages()[u]!)] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.name] });
      await runDriftCheck(checkId, { capture, startRefreshVerify: vi.fn(async () => null) });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      expect(results.fields[f.keyOf.name]!.result).toBe('changed');
      expect(results.fields[f.keyOf.name]!.refresh).toBeUndefined();
    } finally { await f.cleanup(); }
  }, 120_000);

  it('final review I2: each field reads its own certifying paths — a held field is read and refreshed while another is neither current nor held; that one records nothing, never lost', async () => {
    const f = await certifiedWebsite('drift-per-field');
    try {
      // Price fails in the latest Verify but is held on its last pass; Stock fails and is not held.
      const row = (await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.sourceId, f.sourceId) }))!;
      const results0 = row.results as Record<string, { cells: Record<string, unknown>; certified: unknown[]; fieldHash: string }>;
      const failed = (r: (typeof results0)[string]) => ({ ...r, certified: [], cells: Object.fromEntries(U.map((u) => [u, { status: 'fail', reason: 'different_value', found: '9' }])) });
      const pricePass = results0[f.keyOf.price]!;
      await db.update(sourceVerifications).set({ allPassed: false, results: { ...results0, [f.keyOf.price]: failed(pricePass), [f.keyOf.stock]: failed(results0[f.keyOf.stock]!) } }).where(eq(sourceVerifications.id, row.id));
      await db.insert(fieldHolds).values({ sourceId: f.sourceId, fieldKey: f.keyOf.price, result: pricePass, verificationId: row.id, verifiedAt: new Date(), fieldHashes: [pricePass.fieldHash] });

      const pages = priceMovedOnP2();
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(pages[u]!)] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const startRefreshVerify = vi.fn(async () => null);
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false, trigger: 'schedule', keys: [f.keyOf.price, f.keyOf.stock] });
      await runDriftCheck(checkId, { capture, startRefreshVerify });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      expect(results.fields[f.keyOf.price]!.result).not.toBe('lost');
      expect(results.fields[f.keyOf.price]!.refresh).toEqual({ applied: true });
      expect(results.fields[f.keyOf.stock]).toBeUndefined();
      expect(startRefreshVerify).toHaveBeenCalledWith(f.sourceId, [f.keyOf.price], results.captures);
    } finally { await f.cleanup(); }
  }, 120_000);

  it('final review I2: a run-triggered check still says lost for a field with no certifying path', async () => {
    const f = await certifiedWebsite('drift-per-field-run');
    try {
      const row = (await db.query.sourceVerifications.findFirst({ where: eq(sourceVerifications.sourceId, f.sourceId) }))!;
      const results0 = row.results as Record<string, { certified: unknown[] }>;
      await db.update(sourceVerifications).set({ allPassed: false, results: { ...results0, [f.keyOf.stock]: { ...results0[f.keyOf.stock]!, certified: [], cells: {} } } }).where(eq(sourceVerifications.id, row.id));
      const recs = Object.fromEntries(await Promise.all(U.map(async (u) => [u, await record(clone(PAGES[u]!))] as const)));
      const capture = async (_s: string, urls: string[]) => Object.fromEntries(urls.map((u) => [u, recs[u] ?? null]));
      const { checkId } = await startDriftCheck(f.sourceId, null, { capture, fire: false });
      await runDriftCheck(checkId, { capture, startRefreshVerify: vi.fn(async () => null) });
      const results = (await checkRow(checkId))!.results as DriftCheckResults;
      expect(results.fields[f.keyOf.stock]!.result).toBe('lost');
      expect(results.fields[f.keyOf.price]!.result).not.toBe('lost');
    } finally { await f.cleanup(); }
  }, 120_000);
});

describe('startDriftCheck (Review Focus 1)', () => {
  it('a second start while one is running returns the running one', async () => {
    const f = await certifiedWebsite('drift-twice');
    try {
      const a = await startDriftCheck(f.sourceId, null, { fire: false });
      const b = await startDriftCheck(f.sourceId, null, { fire: false });
      expect(a.status).toBe('started');
      expect(b).toEqual({ checkId: a.checkId, status: 'in-progress' });
      expect((await db.select({ n: count() }).from(driftChecks).where(eq(driftChecks.sourceId, f.sourceId)))[0]!.n).toBe(1);
    } finally { await f.cleanup(); }
  });

  it('a running check older than 10 minutes is closed as stalled and a new one starts', async () => {
    const f = await certifiedWebsite('drift-stall');
    try {
      const [old] = await db.insert(driftChecks).values({ sourceId: f.sourceId, status: 'running', createdAt: new Date(Date.now() - DRIFT_CHECK_STALL_MS - 1000) }).returning();
      const next = await startDriftCheck(f.sourceId, null, { fire: false });
      expect(next.status).toBe('started');
      expect(next.checkId).not.toBe(old!.id);
      expect(await checkRow(old!.id)).toMatchObject({ status: 'failed', error: 'stalled' });
      expect((await checkRow(old!.id))!.completedAt).not.toBeNull();
    } finally { await f.cleanup(); }
  });
});

describe('the default capture function', () => {
  const fakeCapture = (url: string): PageCapture => ({
    url, html: '<html><body><div id="main"><h1>Widget</h1>' + 'text '.repeat(200) + '</div></body></html>', markdown: '', title: 'Widget', timestamp: 0,
    screenshot: Buffer.from('png'), screenshotTiles: [Buffer.from('png')], verdict: { kind: 'ok', status: 200 }, pageHeight: 800,
    structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [],
    annotation: [{ xpaths: ['//*[@id="main"]/h1'], text: 'Widget', rect: { x: 0, y: 0, w: 10, h: 10 }, tag: 'h1', kind: 'text' }],
  });

  /** The captured record, or a failure naming what came back instead. */
  const captured = (x: CheckedPage | { notChecked: string } | null | undefined): ProofPageCaptureRecord => {
    if (!x || 'notChecked' in x) throw new Error(`expected a captured record, got ${JSON.stringify(x)}`);
    return x as ProofPageCaptureRecord;
  };

  it('re-captures every page; a page gone now (404) is null even when an older capture succeeded', async () => {
    const f = await createProjectWithSource(caller, { tag: 'drift-capture', fields: [{ name: 'Title', type: 'text' }] });
    try {
      // An older, fresh-enough capture of page 3 that worked.
      const now = new Date(Date.now() - 60_000).toISOString();
      const [old] = await db.insert(captures).values({ sourceId: f.sourceId, url: f.urls[2]!, metadata: { kind: 'proof-page', status: 'captured', url: f.urls[2]!, startedAt: now, capturedAt: now, tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0, contentHeight: 0 } }).returning({ id: captures.id });
      await writeCaptureFile(old!.id, fakeCapture(f.urls[2]!));

      const session = async <T,>(fn: (b: IBrowser) => Promise<T>) => fn({
        launch: async () => {}, close: async () => {},
        capture: async (u: string) => (u === f.urls[2] ? { ...fakeCapture(u), verdict: { kind: 'not-found', status: 404 } } : fakeCapture(u)),
      } as unknown as IBrowser);
      const got = await captureProofPagesWith(session)(f.sourceId, f.urls);

      expect(got[f.urls[2]!]).toBeNull();
      for (const u of f.urls.slice(0, 2)) {
        expect(captured(got[u]).meta.status).toBe('captured');
        expect(captured(got[u]).meta.boxes.length).toBeGreaterThan(0);
      }
      const fresh = await db.select({ n: count() }).from(captures).where(and(eq(captures.sourceId, f.sourceId)));
      expect(fresh[0]!.n).toBe(4); // three new rows plus the old one
    } finally { await f.cleanup(); }
  });

  it('a page that could not be read now (a timeout, an unexpected throw) is not checked, with its stored error as the reason', async () => {
    const f = await createProjectWithSource(caller, { tag: 'drift-capture-unread', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const timeout = new CaptureError('timeout', f.urls[1]!, 'page.goto: Timeout 30000ms exceeded');
      const session = async <T,>(fn: (b: IBrowser) => Promise<T>) => fn({
        launch: async () => {}, close: async () => {},
        capture: async (u: string) => {
          if (u === f.urls[1]) throw timeout;
          // An unexpected throw never classified by the browser layer — the
          // raw text must not reach the customer (campaign 2, 2026-10-11).
          if (u === f.urls[2]) throw new Error('disk full');
          return fakeCapture(u);
        },
      } as unknown as IBrowser);
      const got = await captureProofPagesWith(session)(f.sourceId, f.urls);
      expect(captured(got[f.urls[0]!]).meta.status).toBe('captured');
      expect(got[f.urls[1]!]).toEqual({ notChecked: timeout.message });
      expect(got[f.urls[2]!]).toEqual({ notChecked: BROWSER_UNAVAILABLE });
    } finally { await f.cleanup(); }
  });

  it('final review Minor 4: a capture whose failure write itself fails leaves the row capturing, which reads as not-checked, not page-gone', async () => {
    const f = await createProjectWithSource(caller, { tag: 'drift-write-failed', fields: [{ name: 'Title', type: 'text' }] });
    const originalUpdate = db.update.bind(db);
    try {
      const url = f.urls[0]!;
      const session = async <T,>(fn: (b: IBrowser) => Promise<T>) => fn({
        launch: async () => {}, close: async () => {},
        capture: async () => { throw new Error('page crashed'); },
      } as unknown as IBrowser);
      // The capture fails normally; make the write that would record that
      // failure itself fail (a dropped connection on the way out), so the row
      // is left with the `capturing` metadata its earlier, successful write
      // set. `.catch`-swallowed by `runProofPageCapture` itself, same as prod.
      (db as unknown as { update: typeof originalUpdate }).update = ((table: unknown) => {
        const builder = originalUpdate(table as never);
        if (table !== captures) return builder;
        const originalSet = builder.set.bind(builder);
        (builder as unknown as { set: (values: Record<string, unknown>) => unknown }).set = (values: Record<string, unknown>) => {
          const meta = values.metadata as { status?: string } | undefined;
          if (meta?.status === 'failed') return { where: () => Promise.reject(new Error('connection reset')) };
          return originalSet(values);
        };
        return builder;
      }) as typeof db.update;

      const got = await captureProofPagesWith(session)(f.sourceId, [url]);
      expect(got[url]).toEqual({ notChecked: 'The page could not be read.' });
    } finally {
      (db as unknown as { update: typeof originalUpdate }).update = originalUpdate;
      await f.cleanup();
    }
  });

  it('M3: reads back its own capture by id — a later tab capture of the same url does not turn ours into null', async () => {
    const f = await createProjectWithSource(caller, { tag: 'drift-own-capture', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      let tabCaptureId: string | null = null;
      const session = async <T,>(fn: (b: IBrowser) => Promise<T>) => fn({
        launch: async () => {}, close: async () => {},
        capture: async (u: string) => {
          // While ours runs, the Verification tab starts and finishes a capture of the same url: a newer captured row.
          const now = new Date(Date.now() + 5_000);
          const iso = now.toISOString();
          const [tab] = await db.insert(captures).values({ sourceId: f.sourceId, url: u, createdAt: now, metadata: { kind: 'proof-page', status: 'captured', url: u, startedAt: iso, capturedAt: iso, tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0, contentHeight: 0 } }).returning({ id: captures.id });
          await writeCaptureFile(tab!.id, fakeCapture(u));
          tabCaptureId = tab!.id;
          return fakeCapture(u);
        },
      } as unknown as IBrowser);
      const got = await captureProofPagesWith(session)(f.sourceId, [url]);
      expect(got[url]).not.toBeNull();
      expect(captured(got[url]).meta.status).toBe('captured');
      expect(captured(got[url]).ref.captureId).not.toBe(tabCaptureId);
    } finally { await f.cleanup(); }
  });

  it('shares the proof-page browser limit: with the tab\'s three captures running, the check waits for a slot', async () => {
    const f = await createProjectWithSource(caller, { tag: 'drift-slots', fields: [{ name: 'Title', type: 'text' }] });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const sessionOf = (capture: (u: string) => Promise<PageCapture>) => async <T,>(fn: (b: IBrowser) => Promise<T>) =>
      fn({ launch: async () => {}, close: async () => {}, capture } as unknown as IBrowser);
    try {
      // The Verification tab's captures hold every slot.
      const holders = await Promise.all([0, 1, 2].map(() => startProofPageCapture(f.sourceId, f.urls[0]!, { session: sessionOf(async (u) => { await gate; return fakeCapture(u); }) })));
      const driftCalls: string[] = [];
      const pending = captureProofPagesWith(sessionOf(async (u) => { driftCalls.push(u); return fakeCapture(u); }))(f.sourceId, [f.urls[1]!]);
      await new Promise((r) => setTimeout(r, 300));
      expect(driftCalls).toEqual([]); // queued behind the tab's captures, not a fourth browser

      release();
      const got = await pending;
      expect(driftCalls).toEqual([f.urls[1]]);
      expect(captured(got[f.urls[1]!]).meta.status).toBe('captured');
      for (const h of holders) {
        for (let i = 0; i < 100; i++) {
          const m = (await db.query.captures.findFirst({ where: eq(captures.id, h.captureId) }))!.metadata as { status: string };
          if (m.status !== 'capturing') break;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    } finally { release(); await f.cleanup(); }
  });

  it('never starts a Jev reading, even with the switch on; a proof-page capture of the same page still does (whole-branch review I1)', async () => {
    const saved = { shadow: process.env.JEV_SHADOW, key: process.env.TYPESAFE_API_KEY };
    process.env.JEV_SHADOW = '1';
    process.env.TYPESAFE_API_KEY = 'test-key-never-sent';
    jevAsk.mockClear();
    // A page whose Price is ambiguous (a sale price and a crossed-out one): a proof-page capture would ask about it.
    const priced = (u: string): PageCapture => ({
      ...fakeCapture(u),
      structuredData: { ldJson: [{ '@type': 'Product', offers: { price: '374.25' } }], nextData: null, initialState: null, meta: {} },
      annotation: [
        { xpaths: ['//span'], text: '$374.25', rect: { x: 0, y: 40, w: 10, h: 10 }, tag: 'span', kind: 'text' },
        { xpaths: ['//s'], text: '$499.00', rect: { x: 0, y: 40, w: 10, h: 10 }, tag: 's', kind: 'text' },
      ],
    });
    const session = async <T,>(fn: (b: IBrowser) => Promise<T>) => fn({ launch: async () => {}, close: async () => {}, capture: async (u: string) => priced(u) } as unknown as IBrowser);
    const f = await createProjectWithSource(caller, { tag: 'drift-no-jev', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const got = await captureProofPagesWith(session)(f.sourceId, [f.urls[0]!]);
      expect(captured(got[f.urls[0]!]).meta.status).toBe('captured');
      await new Promise((r) => setTimeout(r, 300));
      expect(await db.select({ n: count() }).from(jevReadings).where(eq(jevReadings.sourceId, f.sourceId))).toEqual([{ n: 0 }]);
      expect(jevAsk).not.toHaveBeenCalled();

      // The control: the Verification tab's capture of the same page is read.
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      await runProofPageCaptureInSlot(captureId, session);
      await vi.waitFor(async () => {
        expect((await db.query.jevReadings.findFirst({ where: eq(jevReadings.captureId, captureId) }))?.status).toBe('done');
      });
      expect(jevAsk).toHaveBeenCalledTimes(1);
    } finally {
      if (saved.shadow === undefined) delete process.env.JEV_SHADOW; else process.env.JEV_SHADOW = saved.shadow;
      if (saved.key === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = saved.key;
      await f.cleanup();
    }
  });
});

describe('outcomeOfFailedCapture', () => {
  const error = 'shop.example refused the browser (HTTP 403, Cloudflare). We can\'t read this website from here yet.';

  it('a page that is gone (404, redirected off-site, or landed on another path) is null', () => {
    expect(outcomeOfFailedCapture({ error: 'gone', verdict: { kind: 'not-found' } })).toBeNull();
    expect(outcomeOfFailedCapture({ error: 'gone', verdict: { kind: 'redirected' } })).toBeNull();
    expect(outcomeOfFailedCapture({ error: 'redirected to https://shop.example/c/widgets' })).toBeNull();
  });

  it('refused, challenge, blank, timeout, unreachable and crashed are not checked, with the stored error as the reason', () => {
    for (const kind of ['refused', 'challenge', 'blank', 'timeout', 'unreachable', 'crashed']) {
      expect(outcomeOfFailedCapture({ error, verdict: { kind } })).toEqual({ notChecked: error });
    }
  });

  it('a backoff answer keeps its wait in the reason; a failure with no verdict is not checked', () => {
    const waiting = `${error} Waiting 4 min before trying again.`;
    expect(outcomeOfFailedCapture({ error: waiting, verdict: { kind: 'refused' } })).toEqual({ notChecked: waiting });
    expect(outcomeOfFailedCapture({ error: 'stalled' })).toEqual({ notChecked: 'stalled' });
  });
});
