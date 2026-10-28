import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures, jevReadings, jobs, sources } from '@robot/db';

// The capture's success path starts a Jev reading (verify/jev-reading.ts) with the
// real TypeSafe client. Never a real request from a test: the client is a fake here.
const { jevAsk } = vi.hoisted(() => ({
  jevAsk: vi.fn(async (req: { questions: Array<{ key: string }> }) => ({
    model: 'jev-1.14.0', inputTokens: 100,
    answers: Object.fromEntries(req.questions.map((q) => [q.key, { choice: 'c1', probabilities: { c1: 0.9 } }])),
  })),
}));
vi.mock('./jev-client.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./jev-client.js')>()), typesafeJevClient: () => ({ ask: jevAsk }) }));
import { TILE_HEIGHT, CaptureError, BROWSER_UNAVAILABLE, type IBrowser, type PageCapture } from '@robot/browser';
import { backoffAnswer, backoffRemainingMs, reportVerdict, _resetBackoffForTests } from '@robot/scraper';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { startProofPageCapture, runProofPageCapture, loadProofPageCaptures, latestProofPageCaptures, resolveStalledProofPage, nextTry, spacedRetry, LADDER_TRIES, LADDER_WAITS, PROOF_PAGE_STALL_MS, type ProofPageMeta } from './proof-page-capture.js';
import { jobsOf, jobContext } from '../test-helpers/jobs.js';
import { runInJob } from '../jobs/context.js';
import { enqueueJob } from '../jobs/queue.js';
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
/** One try as the worker runs it: inside the row's current job (the start write is fenced on it), the ladder on. */
const ladderTry = async (captureId: string, session: Parameters<typeof runProofPageCapture>[1], opts: { jobId?: string } = {}) => {
  const jobId = opts.jobId ?? (await db.query.captures.findFirst({ where: eq(captures.id, captureId), columns: { jobId: true } }))?.jobId ?? undefined;
  return runInJob(jobContext('proof-page-capture', new AbortController(), { jobId }), () => runProofPageCapture(captureId, session, { ladder: true, jev: false }));
};

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

describe('proof-page captures go through the queue (spec 2026-10-23 §4.4)', () => {
  it('a start inserts the row and its job together; the row names the job', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-q-start', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, 'https://shop.test/p/1');
      const job = (await jobsOf('proof-page-capture')).find((j) => j.key === `capture:${captureId}`);
      expect(job).toMatchObject({ status: 'queued', key: `capture:${captureId}`, payload: { captureId }, maxAttempts: 2 });
      const row = await db.query.captures.findFirst({ where: eq(captures.id, captureId) });
      expect(row!.jobId).toBe(job!.id);
      expect((row!.metadata as ProofPageMeta).status).toBe('capturing');
    } finally { await f.cleanup(); }
  });

  it('the stepper reads a capture waiting in the queue past the stall window as capturing (via the procedure too)', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-q-wait', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!);
      const old = new Date(Date.now() - PROOF_PAGE_STALL_MS - 60_000).toISOString();
      await db.update(captures).set({ metadata: { kind: 'proof-page', status: 'capturing', url: f.urls[0]!, startedAt: old } }).where(eq(captures.id, captureId));
      expect(await caller.sources.proofPageCapture({ captureId })).toMatchObject({ status: 'capturing' });
      expect(await caller.sources.proofPageCaptures({ sourceId: f.sourceId, urls: [f.urls[0]!] })).toMatchObject({ [f.urls[0]!]: { captureId, status: 'capturing' } });
    } finally { await f.cleanup(); }
  });

  it('a capturing row older than the stall window stays capturing while its job is live; with none it stalls', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-q-live', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const old = new Date(Date.now() - PROOF_PAGE_STALL_MS - 60_000).toISOString();
      const meta: ProofPageMeta = { kind: 'proof-page', status: 'capturing', url: 'https://shop.test/p/2', startedAt: old };
      const { id: jobId } = await enqueueJob(db, { type: 'proof-page-capture', payload: {} });
      const [queued] = await db.insert(captures).values({ sourceId: f.sourceId, url: meta.url, metadata: meta, jobId }).returning();
      expect((await resolveStalledProofPage(queued!.id, meta, jobId)).status).toBe('capturing');
      expect((await db.query.captures.findFirst({ where: eq(captures.id, queued!.id) }))!.metadata).toMatchObject({ status: 'capturing' });
      const [orphan] = await db.insert(captures).values({ sourceId: f.sourceId, url: meta.url, metadata: meta }).returning();
      expect(await resolveStalledProofPage(orphan!.id, meta, null)).toMatchObject({ status: 'failed', error: 'stalled' });
      expect((await db.query.captures.findFirst({ where: eq(captures.id, orphan!.id) }))!.metadata).toMatchObject({ status: 'failed', error: 'stalled' });
    } finally { await f.cleanup(); }
  });

  it('its clock starts when the work starts, not at the insert', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-q-clock', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      const old = new Date(Date.now() - PROOF_PAGE_STALL_MS - 1000).toISOString();
      await db.update(captures).set({ metadata: { kind: 'proof-page', status: 'capturing', url: f.urls[0]!, startedAt: old } }).where(eq(captures.id, captureId));
      const began = Date.now();
      await runProofPageCapture(captureId, sessionWith(async (u) => fakeCapture(u)), { jev: false });
      const done = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      expect(done.status).toBe('captured');
      expect(Date.parse(done.startedAt)).toBeGreaterThanOrEqual(began - 1000);
    } finally { await f.cleanup(); }
  });

  it('a capture closed meanwhile is not overwritten when its late attempt finishes', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-q-fence', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const { captureId } = await startProofPageCapture(f.sourceId, url, { fire: false });
      const closed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url, startedAt: new Date().toISOString(), error: 'stalled' };
      // The session closes the row first — as the runner does when it stops a stuck attempt — then the capture "finishes".
      const session = async <T,>(fn: (b: IBrowser) => Promise<T>) => {
        await db.update(captures).set({ metadata: closed }).where(eq(captures.id, captureId));
        return sessionWith(async (u) => fakeCapture(u))(fn);
      };
      await runProofPageCapture(captureId, session as never, { jev: false });
      const row = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!;
      expect(row.metadata).toEqual(closed);
      expect(row.html).toBeNull();
    } finally { await f.cleanup(); }
  });

  it('a late failure does not overwrite a closed row either', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-q-fence-fail', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const { captureId } = await startProofPageCapture(f.sourceId, url, { fire: false });
      const closed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url, startedAt: new Date().toISOString(), error: 'stalled' };
      const session = async () => {
        await db.update(captures).set({ metadata: closed }).where(eq(captures.id, captureId));
        throw new Error('browser gone');
      };
      await runProofPageCapture(captureId, session as never, { jev: false });
      expect((await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata).toEqual(closed);
    } finally { await f.cleanup(); }
  });

  it('a row already closed is not taken again (a retry after the row was closed)', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-q-closed', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const { captureId } = await startProofPageCapture(f.sourceId, url, { fire: false });
      const closed: ProofPageMeta = { kind: 'proof-page', status: 'failed', url, startedAt: new Date().toISOString(), error: 'stalled' };
      await db.update(captures).set({ metadata: closed }).where(eq(captures.id, captureId));
      let opened = 0;
      await runProofPageCapture(captureId, sessionWith(async (u) => { opened++; return fakeCapture(u); }), { jev: false });
      expect(opened).toBe(0);
      expect((await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata).toEqual(closed);
    } finally { await f.cleanup(); }
  });
});

describe('a stopped job writes no outcome (final review I1)', () => {
  it('stopped mid-capture, the row stays capturing — failure or late success alike — and the next claim captures it', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-abort', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      const status = async () => ((await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta).status;
      // Shutdown: the runner aborts the job and the gate closes its browser, so the capture throws.
      const first = new AbortController();
      await runInJob(jobContext('proof-page-capture', first), () => runProofPageCapture(captureId,
        sessionWith(async () => { first.abort('shutdown'); throw new Error('Target page, context or browser has been closed'); }), { jev: false }));
      expect(await status()).toBe('capturing');
      // Stopped, but the page came back anyway: not written either.
      const second = new AbortController();
      await runInJob(jobContext('proof-page-capture', second), () => runProofPageCapture(captureId,
        sessionWith(async (u) => { second.abort('lease lost'); return fakeCapture(u); }), { jev: false }));
      expect(await status()).toBe('capturing');
      // The job claimed again: its attempt runs to the end.
      await runInJob(jobContext('proof-page-capture', new AbortController(), { retry: true }), () => runProofPageCapture(captureId, sessionWith(async (u) => fakeCapture(u)), { jev: false }));
      expect(await status()).toBe('captured');
    } finally { await f.cleanup(); }
  });
});describe('the Jev reading after a capture (spec 2026-10-16 §3)', () => {
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

  it('with JEV_SHADOW off (vitest.config.ts sets it to ""), a successful capture leaves no jev_readings row and sends nothing', async () => {
    expect(process.env.JEV_SHADOW).toBe('');
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

const MIN = 60_000;

describe('the ladder, pure (spec 2026-10-28 §3.2)', () => {
  const none = { direct: 0, fallback: 0 };
  it('four tries: 2 min, then 4, then 8 on the same route', () => {
    expect(LADDER_TRIES).toBe(4);
    expect(nextTry({ attempt: 1, route: 'direct', fallback: false, backoffMs: none, scale: 1 })).toEqual({ attempt: 2, via: 'direct', waitMs: 2 * MIN });
    expect(nextTry({ attempt: 2, route: 'direct', fallback: false, backoffMs: none, scale: 1 })).toEqual({ attempt: 3, via: 'direct', waitMs: 4 * MIN });
    expect(nextTry({ attempt: 3, route: 'direct', fallback: false, backoffMs: none, scale: 1 })).toEqual({ attempt: 4, via: 'direct', waitMs: 8 * MIN });
    expect(nextTry({ attempt: 4, route: 'direct', fallback: false, backoffMs: none, scale: 1 })).toBe('give-up');
  });
  it('with a fallback: try 2 stays on the route, try 3 by the fallback at once, try 4 after 4 min', () => {
    expect(nextTry({ attempt: 1, route: 'direct', fallback: true, backoffMs: none, scale: 1 })).toEqual({ attempt: 2, via: 'direct', waitMs: 2 * MIN });
    expect(nextTry({ attempt: 2, route: 'direct', fallback: true, backoffMs: none, scale: 1 })).toEqual({ attempt: 3, via: 'fallback', waitMs: 0 });
    expect(nextTry({ attempt: 3, route: 'fallback', fallback: false, backoffMs: none, scale: 1 })).toEqual({ attempt: 4, via: 'fallback', waitMs: 4 * MIN });
    expect(nextTry({ attempt: 4, route: 'fallback', fallback: false, backoffMs: none, scale: 1 })).toBe('give-up');
  });
  it('a website already on the fallback climbs it like any route: 2, 4, then 4 (try 3 was by the fallback)', () => {
    expect(nextTry({ attempt: 1, route: 'fallback', fallback: false, backoffMs: none, scale: 1 })).toEqual({ attempt: 2, via: 'fallback', waitMs: 2 * MIN });
    expect(nextTry({ attempt: 2, route: 'fallback', fallback: false, backoffMs: none, scale: 1 })).toEqual({ attempt: 3, via: 'fallback', waitMs: 4 * MIN });
    expect(nextTry({ attempt: 3, route: 'fallback', fallback: false, backoffMs: none, scale: 1 })).toEqual({ attempt: 4, via: 'fallback', waitMs: 4 * MIN });
  });
  it("never before the next route's backoff ends; the other route's backoff does not hold it", () => {
    expect(nextTry({ attempt: 1, route: 'direct', fallback: false, backoffMs: { direct: 7 * MIN, fallback: 0 }, scale: 1 })).toEqual({ attempt: 2, via: 'direct', waitMs: 7 * MIN });
    expect(nextTry({ attempt: 2, route: 'direct', fallback: true, backoffMs: { direct: 8 * MIN, fallback: 0 }, scale: 1 })).toEqual({ attempt: 3, via: 'fallback', waitMs: 0 });
    expect(nextTry({ attempt: 2, route: 'direct', fallback: true, backoffMs: { direct: 0, fallback: 3 * MIN }, scale: 1 })).toEqual({ attempt: 3, via: 'fallback', waitMs: 3 * MIN });
  });
  it('PROOF_LADDER_WAIT_SCALE scales the waits (the live check), not the backoff', () => {
    expect(LADDER_WAITS.second).toBe(2 * MIN);
    expect(nextTry({ attempt: 1, route: 'direct', fallback: false, backoffMs: none, scale: 0.01 })).toEqual({ attempt: 2, via: 'direct', waitMs: 1200 });
    expect(nextTry({ attempt: 1, route: 'direct', fallback: false, backoffMs: { direct: 5 * MIN, fallback: 0 }, scale: 0.01 })).toEqual({ attempt: 2, via: 'direct', waitMs: 5 * MIN });
    const saved = process.env.PROOF_LADDER_WAIT_SCALE;
    process.env.PROOF_LADDER_WAIT_SCALE = '0.5';
    try { expect(nextTry({ attempt: 3, route: 'direct', fallback: false, backoffMs: none })).toEqual({ attempt: 4, via: 'direct', waitMs: 4 * MIN }); }
    finally { if (saved === undefined) delete process.env.PROOF_LADDER_WAIT_SCALE; else process.env.PROOF_LADDER_WAIT_SCALE = saved; }
  });
});

describe('the ladder in the capture job (spec 2026-10-28 §3.2)', () => {
  const refused = { kind: 'refused' as const, status: 403, vendor: 'cloudflare' as const };
  const walled = sessionWith(async (u) => ({ ...fakeCapture(u), verdict: refused }));
  const metaOf = async (id: string) => (await db.query.captures.findFirst({ where: eq(captures.id, id) }))!;
  const jobById = async (id: string | null) => (id ? (await db.query.jobs.findFirst({ where: eq(jobs.id, id) })) ?? null : null);
  const saved = { fallback: process.env.FALLBACK_PROXY_URL, def: process.env.DEFAULT_PROXY_URL };
  afterEach(() => {
    for (const [k, v] of [['FALLBACK_PROXY_URL', saved.fallback], ['DEFAULT_PROXY_URL', saved.def]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  const noFallback = () => { delete process.env.FALLBACK_PROXY_URL; delete process.env.DEFAULT_PROXY_URL; };
  const jobsOfCapture = async (captureId: string) => (await jobsOf('proof-page-capture')).filter((j) => (j.payload as { captureId?: string }).captureId === captureId);

  it('a wall waits and comes back: try 2 after 2 min, 3 after 4, 4 after 8, then gives up; every next try is a queued job the row names', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      const first = (await metaOf(captureId)).jobId;
      const waits = [2 * MIN, 4 * MIN, 8 * MIN];
      let firstStartedAt: string | undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        _resetBackoffForTests(); // the backoff a wall starts is as long as the wait: time passes between tries
        const before = Date.now();
        await ladderTry(captureId, walled);
        const row = await metaOf(captureId);
        const meta = row.metadata as ProofPageMeta;
        expect(meta).toMatchObject({ status: 'waiting', url, attempt: attempt + 1, via: 'direct', verdict: refused });
        if (meta.status !== 'waiting') return;
        expect(meta.error).toContain('refused the browser (HTTP 403, Cloudflare)');
        firstStartedAt ??= meta.firstStartedAt;
        expect(meta.firstStartedAt).toBe(firstStartedAt);
        const retryAt = Date.parse(meta.retryAt);
        expect(retryAt).toBeGreaterThanOrEqual(before + waits[attempt - 1]! - 1000);
        expect(retryAt).toBeLessThanOrEqual(Date.now() + waits[attempt - 1]! + 1000);
        const job = await jobById(row.jobId);
        expect(row.jobId).not.toBe(first);
        expect(job).toMatchObject({ type: 'proof-page-capture', status: 'queued', key: `capture:${captureId}:${attempt + 1}`, payload: { captureId } });
        expect(Math.abs(job!.runAfter.getTime() - retryAt)).toBeLessThan(1000);
        // Its start window starts at the retry, not now.
        expect(job!.expiresAt!.getTime()).toBeGreaterThan(retryAt);
      }
      _resetBackoffForTests();
      const lastJob = (await metaOf(captureId)).jobId;
      await ladderTry(captureId, walled);
      const row = await metaOf(captureId);
      expect(row.metadata).toMatchObject({ status: 'failed', gaveUp: true, attempts: 4, firstStartedAt, verdict: refused });
      expect(row.jobId).toBe(lastJob); // no fifth try
      expect(await jobsOfCapture(captureId)).toHaveLength(4);
      const state = (await latestProofPageCaptures(f.sourceId, [url]))[url];
      expect(state).toMatchObject({ captureId, status: 'failed', gaveUp: true, attempts: 4, firstStartedAt });
    } finally { await f.cleanup(); }
  });

  it('the waiting row reads as waiting, through both procedures, with the try that comes next and when', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-read', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      await ladderTry(captureId, walled);
      const meta = (await metaOf(captureId)).metadata as Extract<ProofPageMeta, { status: 'waiting' }>;
      const one = await caller.sources.proofPageCapture({ captureId });
      expect(one).toMatchObject({ status: 'waiting', retryAt: meta.retryAt, attempt: 2, of: 4, via: 'direct', firstStartedAt: meta.firstStartedAt, verdict: refused, tiles: [] });
      expect(JSON.stringify(one)).not.toMatch(/proxy/i);
      const many = await caller.sources.proofPageCaptures({ sourceId: f.sourceId, urls: [url] });
      expect(many[url]).toMatchObject({ captureId, status: 'waiting', retryAt: meta.retryAt, attempt: 2, of: 4, via: 'direct' });
    } finally { await f.cleanup(); }
  });

  it("a capturing row tells its start (the card's timer)", async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-start', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      const meta = (await metaOf(captureId)).metadata as ProofPageMeta;
      expect(await caller.sources.proofPageCapture({ captureId })).toMatchObject({ status: 'capturing', startedAt: meta.startedAt });
      expect((await caller.sources.proofPageCaptures({ sourceId: f.sourceId, urls: [url] }))[url]).toMatchObject({ status: 'capturing', startedAt: meta.startedAt });
    } finally { await f.cleanup(); }
  });

  it('a wall then a page: the row is captured with the try it took', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-ok', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!);
      await ladderTry(captureId, walled);
      _resetBackoffForTests();
      await ladderTry(captureId, sessionWith(async (u) => fakeCapture(u)));
      expect((await metaOf(captureId)).metadata).toMatchObject({ status: 'captured', attempt: 2 });
    } finally { await f.cleanup(); }
  });

  it("a wall that walls harder: the next try waits out the route's whole backoff", async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-bo', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const host = new URL(url).hostname;
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      // Two other products walled during this try: the third strike backs the host off 8 minutes.
      const session = sessionWith(async (u) => { reportVerdict(host, refused); reportVerdict(host, refused); return { ...fakeCapture(u), verdict: refused }; });
      await ladderTry(captureId, session);
      const meta = (await metaOf(captureId)).metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'waiting', attempt: 2 });
      if (meta.status === 'waiting') expect(Date.parse(meta.retryAt)).toBeGreaterThan(Date.now() + 7 * MIN);
    } finally { await f.cleanup(); }
  });

  it('a try answered from the backoff does not count: still the same try, due when the backoff ends, no browser', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-defer', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      reportVerdict(new URL(url).hostname, refused); // 2 min
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      let opened = 0;
      const counting = sessionWith(async (u) => { opened++; return fakeCapture(u); });
      await ladderTry(captureId, counting);
      expect(opened).toBe(0);
      const row = await metaOf(captureId);
      const meta = row.metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'waiting', attempt: 1, via: 'direct', verdict: refused });
      if (meta.status !== 'waiting') return;
      const remaining = backoffRemainingMs(new URL(url).hostname);
      expect(Math.abs(Date.parse(meta.retryAt) - (Date.now() + remaining))).toBeLessThan(2000);
      expect(await jobById(row.jobId)).toMatchObject({ status: 'queued' });
      // Deferred again: its own job.
      await ladderTry(captureId, counting);
      const again = await metaOf(captureId);
      expect(again.metadata).toMatchObject({ status: 'waiting', attempt: 1 });
      expect(again.jobId).not.toBe(row.jobId);
      // The backoff over, try 1 runs.
      _resetBackoffForTests();
      await ladderTry(captureId, counting);
      expect(opened).toBe(1);
      expect((await metaOf(captureId)).metadata).toMatchObject({ status: 'captured', attempt: 1 });
    } finally { await f.cleanup(); }
  });

  it('only a wall climbs the ladder: a timeout fails at once', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-timeout', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!);
      const job = (await metaOf(captureId)).jobId;
      await ladderTry(captureId, sessionWith(async (u) => { throw new CaptureError('timeout', u, 'Timeout'); }));
      const row = await metaOf(captureId);
      expect(row.metadata).toMatchObject({ status: 'failed', verdict: { kind: 'timeout' } });
      expect(row.metadata).not.toHaveProperty('gaveUp');
      expect(row.jobId).toBe(job);
    } finally { await f.cleanup(); }
  });

  it('without the ladder (the drift check, scripts: fire false) a wall fails at once, as before', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-off', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      await runProofPageCapture(captureId, walled, { jev: false });
      const row = await metaOf(captureId);
      expect(row.metadata).toMatchObject({ status: 'failed', verdict: refused });
      expect(row.jobId).toBeNull();
      expect(await jobsOfCapture(captureId)).toHaveLength(0);
    } finally { await f.cleanup(); }
  });

  it('the worker runs the job with the ladder on: a start answered from the backoff waits, it does not fail', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-handler', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      reportVerdict(new URL(url).hostname, refused); // no browser opens: the backoff answers
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      const jobId = (await metaOf(captureId)).jobId!;
      const { jobRegistry } = await import('../jobs/handlers.js');
      const ctx = jobContext('proof-page-capture', new AbortController(), { jobId });
      await runInJob(ctx, () => jobRegistry()['proof-page-capture']!.run({ captureId }, ctx) as Promise<unknown>);
      expect((await metaOf(captureId)).metadata).toMatchObject({ status: 'waiting', attempt: 1 });
    } finally { await f.cleanup(); }
  });

  it('a job that is not the row\'s current one takes nothing (an earlier try\'s job claimed again)', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-oldjob', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!);
      const firstJob = (await metaOf(captureId)).jobId!;
      await ladderTry(captureId, walled);
      const waitingRow = await metaOf(captureId);
      expect(waitingRow.metadata).toMatchObject({ status: 'waiting', attempt: 2 });
      _resetBackoffForTests();
      let opened = 0;
      await ladderTry(captureId, sessionWith(async (u) => { opened++; return fakeCapture(u); }), { jobId: firstJob });
      expect(opened).toBe(0);
      expect((await metaOf(captureId)).metadata).toEqual(waitingRow.metadata);
    } finally { await f.cleanup(); }
  });

  it('retries of one website are spaced: two and three products walled together never come back in the same 30 s', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-stagger', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const ids: string[] = [];
      for (const url of f.urls) ids.push((await startProofPageCapture(f.sourceId, url)).captureId);
      const retryAts: number[] = [];
      for (const id of ids) {
        _resetBackoffForTests(); // every wall alone would ask for the same 2 min
        await ladderTry(id, walled);
        const meta = (await metaOf(id)).metadata as ProofPageMeta;
        expect(meta).toMatchObject({ status: 'waiting', attempt: 2 });
        if (meta.status === 'waiting') retryAts.push(Date.parse(meta.retryAt));
      }
      expect(retryAts[1]! - retryAts[0]!).toBeGreaterThanOrEqual(30_000);
      expect(retryAts[2]! - retryAts[1]!).toBeGreaterThanOrEqual(30_000);
      // Each row's job is due at its own retryAt.
      for (const [i, id] of ids.entries()) {
        const job = await jobById((await metaOf(id)).jobId);
        expect(Math.abs(job!.runAfter.getTime() - retryAts[i]!)).toBeLessThan(1000);
      }
    } finally { await f.cleanup(); }
  });

  it('deferrals of one website are spaced too: two starts answered by one backoff do not both wake at its end', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-stagger-bo', fields: [{ name: 'Title', type: 'text' }] });
    try {
      reportVerdict(new URL(f.urls[0]!).hostname, refused);
      const a = (await startProofPageCapture(f.sourceId, f.urls[0]!)).captureId;
      const b = (await startProofPageCapture(f.sourceId, f.urls[1]!)).captureId;
      await ladderTry(a, walled);
      await ladderTry(b, walled);
      const ra = (await metaOf(a)).metadata as Extract<ProofPageMeta, { status: 'waiting' }>;
      const rb = (await metaOf(b)).metadata as Extract<ProofPageMeta, { status: 'waiting' }>;
      expect(ra).toMatchObject({ status: 'waiting', attempt: 1 });
      expect(rb).toMatchObject({ status: 'waiting', attempt: 1 });
      expect(Date.parse(rb.retryAt) - Date.parse(ra.retryAt)).toBeGreaterThanOrEqual(30_000);
    } finally { await f.cleanup(); }
  });

  it('deferrals stop after 30 min from the first try: the row gives up with the tries it made', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-cap', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      const firstStartedAt = new Date(Date.now() - 31 * MIN).toISOString();
      const old: ProofPageMeta = {
        kind: 'proof-page', status: 'waiting', url, startedAt: new Date(Date.now() - 2 * MIN).toISOString(), firstStartedAt,
        error: 'x refused the browser.', verdict: refused, retryAt: new Date().toISOString(), attempt: 3, via: 'direct',
      };
      await db.update(captures).set({ metadata: old }).where(eq(captures.id, captureId));
      reportVerdict(new URL(url).hostname, refused);
      const job = (await metaOf(captureId)).jobId;
      await ladderTry(captureId, walled);
      const row = await metaOf(captureId);
      expect(row.metadata).toMatchObject({ status: 'failed', gaveUp: true, attempts: 2, firstStartedAt, verdict: refused });
      expect(row.jobId).toBe(job); // nothing queued
    } finally { await f.cleanup(); }
  });

  it('try 3 goes by the fallback at once when the website has one; a page read there keeps the fallback for the website', async () => {
    delete process.env.DEFAULT_PROXY_URL;
    process.env.FALLBACK_PROXY_URL = 'http://fallback.invalid:8080';
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-fb', fields: [{ name: 'Title', type: 'text' }], urls: ['https://shop.ppc-ladder-fb.example.de/p/1', 'https://shop.ppc-ladder-fb.example.de/p/2', 'https://shop.ppc-ladder-fb.example.de/p/3'] });
    try {
      // A website with no country: the try guesses it from the address (.de), and keeping the route saves it.
      await db.update(sources).set({ country: null }).where(eq(sources.id, f.sourceId));
      const url = f.urls[0]!;
      const proxies: Array<string | null> = [];
      const recording = (inner: ReturnType<typeof sessionWith>) => (async <T,>(fn: (b: IBrowser) => Promise<T>, o?: { profile?: { proxy?: { server: string } } }) => {
        proxies.push(o?.profile?.proxy?.server ?? null);
        return inner(fn);
      }) as never;
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      await ladderTry(captureId, recording(walled));
      _resetBackoffForTests();
      await ladderTry(captureId, recording(walled));
      const meta = (await metaOf(captureId)).metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'waiting', attempt: 3, via: 'fallback' });
      // The direct route is backing off; the fallback's is not, so try 3 is due at once.
      if (meta.status === 'waiting') expect(Date.parse(meta.retryAt)).toBeLessThanOrEqual(Date.now() + 1000);
      expect(backoffRemainingMs(new URL(url).hostname)).toBeGreaterThan(0);
      await ladderTry(captureId, recording(sessionWith(async (u) => fakeCapture(u))));
      expect(proxies).toEqual([null, null, expect.stringContaining('fallback.invalid')]);
      expect((await metaOf(captureId)).metadata).toMatchObject({ status: 'captured', attempt: 3, via: 'fallback' });
      const src = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(src!.fallbackProxyAt).toBeInstanceOf(Date);
      expect(src!.country).toBe('de');
    } finally { await f.cleanup(); }
  });

  it('a wall by the fallback backs off the fallback route; try 4 stays on it after 4 min, then gives up', async () => {
    delete process.env.DEFAULT_PROXY_URL;
    process.env.FALLBACK_PROXY_URL = 'http://fallback.invalid:8080';
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-fbwall', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const host = new URL(url).hostname;
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      await ladderTry(captureId, walled);
      _resetBackoffForTests();
      await ladderTry(captureId, walled);
      _resetBackoffForTests();
      const before = Date.now();
      await ladderTry(captureId, walled); // try 3, by the fallback
      expect(backoffRemainingMs(host, Date.now, 'fallback')).toBeGreaterThan(0);
      expect(backoffRemainingMs(host)).toBe(0);
      const meta = (await metaOf(captureId)).metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'waiting', attempt: 4, via: 'fallback' });
      if (meta.status === 'waiting') expect(Date.parse(meta.retryAt)).toBeGreaterThanOrEqual(before + 4 * MIN - 1000);
      _resetBackoffForTests();
      await ladderTry(captureId, walled);
      expect((await metaOf(captureId)).metadata).toMatchObject({ status: 'failed', gaveUp: true, attempts: 4 });
      expect((await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) }))!.fallbackProxyAt).toBeNull();
    } finally { await f.cleanup(); }
  });

  it('with DEFAULT_PROXY_URL set no fallback is tried', async () => {
    process.env.DEFAULT_PROXY_URL = 'http://default.invalid:8080';
    process.env.FALLBACK_PROXY_URL = 'http://fallback.invalid:8080';
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-def', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!);
      await ladderTry(captureId, walled);
      _resetBackoffForTests();
      await ladderTry(captureId, walled);
      expect((await metaOf(captureId)).metadata).toMatchObject({ status: 'waiting', attempt: 3, via: 'direct' });
    } finally { await f.cleanup(); }
  });

  it('a new capture of the page supersedes a waiting one: its queued job is cancelled and the old try never runs', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-sup', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const { captureId: old } = await startProofPageCapture(f.sourceId, url);
      await ladderTry(old, walled);
      const waitingRow = await metaOf(old);
      await new Promise((r) => setTimeout(r, 5));
      const { captureId: fresh } = await startProofPageCapture(f.sourceId, url);
      expect(fresh).not.toBe(old);
      expect(await jobById(waitingRow.jobId)).toMatchObject({ status: 'failed' });
      // The old job ran anyway (claimed just before the cancel): it opens nothing and writes nothing.
      _resetBackoffForTests();
      let opened = 0;
      await ladderTry(old, sessionWith(async (u) => { opened++; return fakeCapture(u); }));
      expect(opened).toBe(0);
      expect((await metaOf(old)).metadata).toEqual(waitingRow.metadata);
      expect((await latestProofPageCaptures(f.sourceId, [url]))[url]).toMatchObject({ captureId: fresh, status: 'capturing' });
    } finally { await f.cleanup(); }
  });

  it('a try that walls after a newer capture started writes the wall and queues nothing', async () => {
    noFallback();
    const f = await createProjectWithSource(caller, { tag: 'ppc-ladder-sup2', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const url = f.urls[0]!;
      const { captureId: old } = await startProofPageCapture(f.sourceId, url);
      const oldJob = (await metaOf(old)).jobId;
      const session = sessionWith(async (u) => { await startProofPageCapture(f.sourceId, url); return { ...fakeCapture(u), verdict: refused }; });
      await ladderTry(old, session);
      const row = await metaOf(old);
      expect(row.metadata).toMatchObject({ status: 'failed', verdict: refused });
      expect(row.jobId).toBe(oldJob);
      expect(await jobsOfCapture(old)).toHaveLength(1);
    } finally { await f.cleanup(); }
  });
});

describe('a waiting row whose next try is gone', () => {
  const waitingMeta = (url: string, retryAgoMs: number): ProofPageMeta => ({
    kind: 'proof-page', status: 'waiting', url, startedAt: new Date(Date.now() - retryAgoMs - 2 * MIN).toISOString(),
    firstStartedAt: new Date(Date.now() - retryAgoMs - 4 * MIN).toISOString(), error: 'x refused the browser.', verdict: { kind: 'refused', status: 403 },
    retryAt: new Date(Date.now() - retryAgoMs).toISOString(), attempt: 2, via: 'direct',
  });
  it('is closed stalled once its retry is past the stall window', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-wait-stall', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const meta = waitingMeta(f.urls[0]!, PROOF_PAGE_STALL_MS + 1000);
      const [row] = await db.insert(captures).values({ sourceId: f.sourceId, url: meta.url, metadata: meta }).returning();
      expect(await resolveStalledProofPage(row!.id, meta, null)).toMatchObject({ status: 'failed', error: 'stalled' });
      expect((await db.query.captures.findFirst({ where: eq(captures.id, row!.id) }))!.metadata).toMatchObject({ status: 'failed', error: 'stalled' });
    } finally { await f.cleanup(); }
  });
  it('stays waiting while its job is live, or its retry is recent', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-wait-live', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const old = waitingMeta(f.urls[0]!, PROOF_PAGE_STALL_MS + 1000);
      const { id: jobId } = await enqueueJob(db, { type: 'proof-page-capture', payload: {} });
      const [a] = await db.insert(captures).values({ sourceId: f.sourceId, url: old.url, metadata: old, jobId }).returning();
      expect((await resolveStalledProofPage(a!.id, old, jobId)).status).toBe('waiting');
      const future = waitingMeta(f.urls[0]!, -2 * MIN);
      const [b] = await db.insert(captures).values({ sourceId: f.sourceId, url: future.url, metadata: future }).returning();
      expect((await resolveStalledProofPage(b!.id, future, null)).status).toBe('waiting');
    } finally { await f.cleanup(); }
  });
  it('a job that ends without running (expired, failed) closes its waiting row', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-wait-close', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const meta = waitingMeta(f.urls[0]!, -2 * MIN);
      const { id: jobId } = await enqueueJob(db, { type: 'proof-page-capture', payload: {} });
      const [row] = await db.insert(captures).values({ sourceId: f.sourceId, url: meta.url, metadata: meta, jobId }).returning();
      const { closeJobRows } = await import('../jobs/rows.js');
      await closeJobRows(db, jobId, { runSentence: 'x' });
      expect((await db.query.captures.findFirst({ where: eq(captures.id, row!.id) }))!.metadata).toMatchObject({ status: 'failed', error: 'stalled' });
    } finally { await f.cleanup(); }
  });
});

describe('a website that keeps the fallback (spec 2026-10-28 §3.3)', () => {
  const refused = { kind: 'refused' as const, status: 403 };
  const saved = { fallback: process.env.FALLBACK_PROXY_URL, def: process.env.DEFAULT_PROXY_URL };
  afterEach(() => {
    for (const [k, v] of [['FALLBACK_PROXY_URL', saved.fallback], ['DEFAULT_PROXY_URL', saved.def]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  it('loads by it from try 1, and its walls back off the fallback route', async () => {
    delete process.env.DEFAULT_PROXY_URL;
    process.env.FALLBACK_PROXY_URL = 'http://fallback.invalid:8080';
    const f = await createProjectWithSource(caller, { tag: 'ppc-kept', fields: [{ name: 'Title', type: 'text' }] });
    try {
      await db.update(sources).set({ fallbackProxyAt: new Date() }).where(eq(sources.id, f.sourceId));
      const url = f.urls[0]!;
      const proxies: Array<string | null> = [];
      const session = (async <T,>(fn: (b: IBrowser) => Promise<T>, o?: { profile?: { proxy?: { server: string } } }) => {
        proxies.push(o?.profile?.proxy?.server ?? null);
        return sessionWith(async (u) => ({ ...fakeCapture(u), verdict: refused }))(fn);
      }) as never;
      const { captureId } = await startProofPageCapture(f.sourceId, url);
      await ladderTry(captureId, session);
      expect(proxies).toEqual([expect.stringContaining('fallback.invalid')]);
      expect((await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata).toMatchObject({ status: 'waiting', attempt: 2, via: 'fallback' });
      const host = new URL(url).hostname;
      expect(backoffRemainingMs(host, Date.now, 'fallback')).toBeGreaterThan(0);
      expect(backoffRemainingMs(host)).toBe(0);
    } finally { await f.cleanup(); }
  });
});

describe('spacedRetry (review I1)', () => {
  it('keeps a free moment, and moves one too near another to just after it, past every later one too', () => {
    expect(spacedRetry(100_000, [], 30_000)).toBe(100_000);
    expect(spacedRetry(100_000, [20_000, 200_000], 30_000)).toBe(100_000);
    expect(spacedRetry(100_000, [100_000], 30_000)).toBe(130_000);
    expect(spacedRetry(100_000, [125_000, 90_000, 150_000], 30_000)).toBe(180_000);
    expect(spacedRetry(100_000, [80_000], 30_000)).toBe(110_000);
  });
});
