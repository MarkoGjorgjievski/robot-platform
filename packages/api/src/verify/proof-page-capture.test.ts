import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures, jevReadings } from '@robot/db';

// The capture's success path starts a Jev reading (verify/jev-reading.ts) with the
// real TypeSafe client. Never a real request from a test: the client is a fake here.
const { jevAsk } = vi.hoisted(() => ({
  jevAsk: vi.fn(async (req: { questions: Array<{ key: string }> }) => ({
    model: 'jev-1.14.0', inputTokens: 100,
    answers: Object.fromEntries(req.questions.map((q) => [q.key, { choice: 'c1', probabilities: { c1: 0.9 } }])),
  })),
}));
vi.mock('./jev-client.js', () => ({ typesafeJevClient: () => ({ ask: jevAsk }) }));
import { TILE_HEIGHT, CaptureError, BROWSER_UNAVAILABLE, type IBrowser, type PageCapture } from '@robot/browser';
import { backoffAnswer, reportVerdict, _resetBackoffForTests } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { startProofPageCapture, runProofPageCapture, loadProofPageCaptures, PROOF_PAGE_STALL_MS, type ProofPageMeta } from './proof-page-capture.js';
import { readCaptureFile } from './capture-store.js';
import { signedInCaller } from '../test-helpers/identity.js';

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('proof-page-capture');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });
let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'captures-')); process.env.CAPTURES_DIR = dir; });
afterAll(async () => { delete process.env.CAPTURES_DIR; await rm(dir, { recursive: true, force: true }); });
// A refused fake capture backs its host off; the next test on that host must not inherit it.
afterEach(() => { _resetBackoffForTests(); });

const box = { xpaths: ['//*[@id="main"]/h1'], text: 'Widget', rect: { x: 0, y: 0, w: 10, h: 10 }, tag: 'h1', kind: 'text' as const };
/** Below the two tiles (2 × TILE_HEIGHT = 3072 px): nothing there was photographed. */
const deepBox = { ...box, rect: { x: 0, y: 5000, w: 10, h: 10 } };
const fakeCapture = (url: string): PageCapture => ({
  url, html: '<html><body><div id="main"><h1>Widget</h1>' + 'text '.repeat(200) + '</div></body></html>', markdown: '', title: 'Widget', timestamp: 0,
  screenshot: Buffer.from('png1'), screenshotTiles: [Buffer.from('png1'), Buffer.from('png2')], verdict: { kind: 'ok', status: 200 }, pageHeight: 4000,
  structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} }, interceptedRequests: [], annotation: [box, deepBox],
});
const sessionWith = (capture: (url: string) => Promise<PageCapture>) => async <T>(fn: (b: IBrowser) => Promise<T>) =>
  fn({ launch: async () => {}, close: async () => {}, capture: (u: string) => capture(u) } as unknown as IBrowser);

describe('proof-page capture job', () => {
  it('records a captured page: tiles, boxes, capture file', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-ok', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      const row0 = await db.query.captures.findFirst({ where: eq(captures.id, captureId) });
      expect((row0!.metadata as ProofPageMeta).status).toBe('capturing');
      await runProofPageCapture(captureId, sessionWith(async (u) => fakeCapture(u)));
      const row = await db.query.captures.findFirst({ where: eq(captures.id, captureId) });
      const meta = row!.metadata as ProofPageMeta;
      expect(meta.status).toBe('captured');
      if (meta.status !== 'captured') return;
      expect(meta.tiles).toHaveLength(2);
      expect(meta.boxes).toEqual([box]); // the box at y 5000 is below the strip and is dropped
      expect(meta.pageHeight).toBe(4000);
      expect(meta.capturedHeight).toBe(Math.min(4000, 2 * TILE_HEIGHT));
      expect(meta.contentHeight).toBe(10);
      expect(meta.title).toBe('Widget'); // the page's own <title>, for a card still titled by its address
      expect(row!.screenshotPath).toBe(meta.tiles[0]);
      expect((await readCaptureFile(captureId))?.html).toContain('Widget');
      const loaded = await loadProofPageCaptures(f.sourceId, f.urls);
      expect(Object.keys(loaded)).toEqual([f.urls[0]]);
      expect(loaded[f.urls[0]!]!.ref.captureId).toBe(captureId);
    } finally { await f.cleanup(); }
  });
  it('records a failure and never throws, but never shows the raw exception text (campaign 2, 2026-10-11)', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-fail', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      // A throw that never became a CaptureError/CaptureProblemError — the
      // shape of an orphaned api-server's Chromium failing to launch at all.
      await runProofPageCapture(captureId, sessionWith(async () => { throw new Error('browserType.launch: failed. Call log: …'); }));
      const meta = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'failed', error: BROWSER_UNAVAILABLE });
      expect(meta).not.toHaveProperty('verdict');
      expect(await loadProofPageCaptures(f.sourceId, f.urls)).toEqual({});
    } finally { await f.cleanup(); }
  });
  it('a redirect is a failure with the capture problem as its reason', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-redir', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      await runProofPageCapture(captureId, sessionWith(async () => fakeCapture('https://elsewhere.example/cat')));
      const meta = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'failed', error: 'redirected to https://elsewhere.example/cat' });
      expect(meta).not.toHaveProperty('verdict'); // a path-level problem, not the browser's verdict
    } finally { await f.cleanup(); }
  });
  it('a refused page is a failure that keeps the browser verdict', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-refused', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      const verdict = { kind: 'refused' as const, status: 403, vendor: 'cloudflare' as const };
      await runProofPageCapture(captureId, sessionWith(async (u) => ({ ...fakeCapture(u), verdict })));
      const meta = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'failed', verdict });
      if (meta.status === 'failed') expect(meta.error).toContain('refused the browser (HTTP 403, Cloudflare)');
    } finally { await f.cleanup(); }
  });
  it('no document at all keeps the CaptureError kind as its verdict', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-timeout', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      await runProofPageCapture(captureId, sessionWith(async (u) => { throw new CaptureError('timeout', u, 'Timeout 60000ms exceeded'); }));
      const meta = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'failed', verdict: { kind: 'timeout' } });
      // The card reads the one sentence, not Playwright's text (review I3).
      if (meta.status === 'failed') expect(meta.error).toBe(`${new URL(f.urls[0]!).hostname.replace(/^www\./, '')} did not answer in time.`);
    } finally { await f.cleanup(); }
  });
  it('a host still backing off is answered from the backoff: failed with its verdict and the wait, no browser (review I4)', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-backoff', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const verdict = { kind: 'refused' as const, status: 403, vendor: 'cloudflare' as const };
      reportVerdict(new URL(url).hostname, verdict);
      const { captureId } = await startProofPageCapture(f.sourceId, url, { fire: false });
      let opened = 0;
      await runProofPageCapture(captureId, sessionWith(async (u) => { opened++; return fakeCapture(u); }));
      const meta = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      expect(opened).toBe(0);
      expect(meta).toMatchObject({ status: 'failed', verdict, error: backoffAnswer(url)!.message });
      if (meta.status === 'failed') expect(meta.error).toMatch(/refused the browser \(HTTP 403, Cloudflare\)\. .* Waiting \d+ min before trying again\.$/);
    } finally { await f.cleanup(); }
  });
});

describe('a capturing row the api-server never finished', () => {
  const seed = async (sourceId: string, url: string, ageMs: number) => {
    const startedAt = new Date(Date.now() - ageMs).toISOString();
    const [row] = await db.insert(captures).values({ sourceId, url, metadata: { kind: 'proof-page', status: 'capturing', url, startedAt } }).returning({ id: captures.id });
    return row!.id;
  };
  it('is reported as failed / stalled, and the row says so', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-stall', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const captureId = await seed(f.sourceId, f.urls[0]!, PROOF_PAGE_STALL_MS + 1000);
      expect(await caller.sources.proofPageCapture({ captureId })).toMatchObject({ status: 'failed', error: 'stalled' });
      expect((await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata).toMatchObject({ status: 'failed', error: 'stalled' });
    } finally { await f.cleanup(); }
  });
  it('leaves a capture still within the deadline alone', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-live', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const captureId = await seed(f.sourceId, f.urls[0]!, 5_000);
      expect(await caller.sources.proofPageCapture({ captureId })).toMatchObject({ status: 'capturing' });
      expect((await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata).toMatchObject({ status: 'capturing' });
    } finally { await f.cleanup(); }
  });
});

describe('a capture waiting for a browser slot (final review M4)', () => {
  it('is not reported stalled by its insert time, and its clock starts when it gets a slot', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-queue', fields: [{ name: 'Title', type: 'text' }] });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const blocked = sessionWith(async (u) => { await gate; return fakeCapture(u); });
    try {
      // Three captures hold every slot; the fourth waits in the queue.
      const holders = await Promise.all([0, 1, 2].map(() => startProofPageCapture(f.sourceId, f.urls[1]!, { session: blocked })));
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { session: blocked });
      // It has waited longer than the stall window (a busy server), by its insert time.
      const old = new Date(Date.now() - PROOF_PAGE_STALL_MS - 1000).toISOString();
      await db.update(captures).set({ metadata: { kind: 'proof-page', status: 'capturing', url: f.urls[0]!, startedAt: old } }).where(eq(captures.id, captureId));
      expect(await caller.sources.proofPageCapture({ captureId })).toMatchObject({ status: 'capturing' });

      const freed = Date.now();
      release();
      const meta = async () => (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      for (let i = 0; i < 100 && (await meta()).status === 'capturing'; i++) await new Promise((r) => setTimeout(r, 50));
      const done = await meta();
      expect(done.status).toBe('captured');
      expect(Date.parse(done.startedAt)).toBeGreaterThanOrEqual(freed - 1000);
      for (const h of holders) {
        for (let i = 0; i < 100; i++) {
          const m = (await db.query.captures.findFirst({ where: eq(captures.id, h.captureId) }))!.metadata as ProofPageMeta;
          if (m.status !== 'capturing') break;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    } finally { release(); await f.cleanup(); }
  });
});

describe('the Jev reading after a capture (spec 2026-10-16 §3)', () => {
  // A page whose Price is ambiguous (a sale price and a crossed-out one): with the switch on it is read.
  const pricedCapture = (url: string): PageCapture => ({
    ...fakeCapture(url),
    structuredData: { ldJson: [{ '@type': 'Product', offers: { price: '374.25' } }], nextData: null, initialState: null, meta: {} },
    annotation: [box, { ...box, xpaths: ['//span'], text: '$374.25', tag: 'span', rect: { x: 0, y: 40, w: 10, h: 10 } }, { ...box, xpaths: ['//s'], text: '$499.00', tag: 's', rect: { x: 0, y: 40, w: 10, h: 10 } }],
  });
  const saved = { shadow: process.env.JEV_SHADOW, key: process.env.TYPESAFE_API_KEY };
  afterEach(() => {
    if (saved.shadow === undefined) delete process.env.JEV_SHADOW; else process.env.JEV_SHADOW = saved.shadow;
    if (saved.key === undefined) delete process.env.TYPESAFE_API_KEY; else process.env.TYPESAFE_API_KEY = saved.key;
    jevAsk.mockClear();
  });

  it('with JEV_SHADOW unset, a successful capture leaves no jev_readings row and sends nothing', async () => {
    delete process.env.JEV_SHADOW;
    const f = await createProjectWithSource(caller, { tag: 'ppc-jev-off', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      await runProofPageCapture(captureId, sessionWith(async (u) => pricedCapture(u)));
      expect(((await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta).status).toBe('captured');
      await new Promise((r) => setTimeout(r, 200));
      expect(await db.query.jevReadings.findFirst({ where: eq(jevReadings.captureId, captureId) })).toBeUndefined();
      expect(jevAsk).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });

  it('with the switch on, the capture finishes without waiting and the reading lands in its own row', async () => {
    process.env.JEV_SHADOW = '1';
    process.env.TYPESAFE_API_KEY = 'test-key-never-sent';
    const f = await createProjectWithSource(caller, { tag: 'ppc-jev-on', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      await runProofPageCapture(captureId, sessionWith(async (u) => pricedCapture(u)));
      expect(((await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta).status).toBe('captured');
      await vi.waitFor(async () => {
        expect((await db.query.jevReadings.findFirst({ where: eq(jevReadings.captureId, captureId) }))?.status).toBe('done');
      });
      expect(jevAsk).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  });
});
