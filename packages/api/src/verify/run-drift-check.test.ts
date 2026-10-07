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
import { db, captures, driftChecks, sources, sourceVerifications } from '@robot/db';
import { PlaywrightBrowser, type IBrowser, type PageCapture } from '@robot/browser';
import {
  buildBoxMapScript, fieldHash,
  type Box, type CertifiedPath, type DriftCheckResults, type SchemaDefinitionField, type VerificationSet,
} from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { SHOP_EXAMPLE } from '../test-helpers/shop-example.js';
import { writeCaptureFile } from './capture-store.js';
import { startProofPageCapture, type ProofPageCaptureRecord } from './proof-page-capture.js';
import { signedInCaller } from '../test-helpers/identity.js';

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
const { startDriftCheck, runDriftCheck, captureProofPagesWith, DRIFT_CHECK_STALL_MS } = await import('./run-drift-check.js');

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

const snapshot = async (sourceId: string) => ({
  source: await db.query.sources.findFirst({ where: eq(sources.id, sourceId) }),
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
    screenshot: Buffer.from('png'), screenshotTiles: [Buffer.from('png')], pageHeight: 800,
    structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [],
    annotation: [{ xpaths: ['//*[@id="main"]/h1'], text: 'Widget', rect: { x: 0, y: 0, w: 10, h: 10 }, tag: 'h1', kind: 'text' }],
  });

  it('re-captures every page; a capture that fails now is null even when an older one succeeded', async () => {
    const f = await createProjectWithSource(caller, { tag: 'drift-capture', fields: [{ name: 'Title', type: 'text' }] });
    try {
      // An older, fresh-enough capture of page 3 that worked.
      const now = new Date(Date.now() - 60_000).toISOString();
      const [old] = await db.insert(captures).values({ sourceId: f.sourceId, url: f.urls[2]!, metadata: { kind: 'proof-page', status: 'captured', url: f.urls[2]!, startedAt: now, capturedAt: now, tiles: [], boxes: [], pageHeight: 0, capturedHeight: 0, contentHeight: 0 } }).returning({ id: captures.id });
      await writeCaptureFile(old!.id, fakeCapture(f.urls[2]!));

      const session = async <T,>(fn: (b: IBrowser) => Promise<T>) => fn({
        launch: async () => {}, close: async () => {},
        capture: async (u: string) => { if (u === f.urls[2]) throw new Error('net::ERR_NAME_NOT_RESOLVED'); return fakeCapture(u); },
      } as unknown as IBrowser);
      const got = await captureProofPagesWith(session)(f.sourceId, f.urls);

      expect(got[f.urls[2]!]).toBeNull();
      for (const u of f.urls.slice(0, 2)) {
        expect(got[u]!.meta.status).toBe('captured');
        expect(got[u]!.meta.boxes.length).toBeGreaterThan(0);
      }
      const fresh = await db.select({ n: count() }).from(captures).where(and(eq(captures.sourceId, f.sourceId)));
      expect(fresh[0]!.n).toBe(4); // three new rows plus the old one
    } finally { await f.cleanup(); }
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
      expect(got[url]!.meta.status).toBe('captured');
      expect(got[url]!.ref.captureId).not.toBe(tabCaptureId);
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
      expect(got[f.urls[1]!]!.meta.status).toBe('captured');
      for (const h of holders) {
        for (let i = 0; i < 100; i++) {
          const m = (await db.query.captures.findFirst({ where: eq(captures.id, h.captureId) }))!.metadata as { status: string };
          if (m.status !== 'capturing') break;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    } finally { release(); await f.cleanup(); }
  });
});
