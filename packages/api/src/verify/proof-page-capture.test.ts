import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures } from '@robot/db';
import { TILE_HEIGHT, type IBrowser, type PageCapture } from '@robot/browser';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { startProofPageCapture, runProofPageCapture, loadProofPageCaptures, PROOF_PAGE_STALL_MS, type ProofPageMeta } from './proof-page-capture.js';
import { readCaptureFile } from './capture-store.js';

const caller = createCallerFactory(appRouter)({ db, session: null });
let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'captures-')); process.env.CAPTURES_DIR = dir; });
afterAll(async () => { delete process.env.CAPTURES_DIR; await rm(dir, { recursive: true, force: true }); });

const box = { xpaths: ['//*[@id="main"]/h1'], text: 'Widget', rect: { x: 0, y: 0, w: 10, h: 10 }, tag: 'h1', kind: 'text' as const };
/** Below the two tiles (2 × TILE_HEIGHT = 3072 px): nothing there was photographed. */
const deepBox = { ...box, rect: { x: 0, y: 5000, w: 10, h: 10 } };
const fakeCapture = (url: string): PageCapture => ({
  url, html: '<html><body><div id="main"><h1>Widget</h1>' + 'text '.repeat(200) + '</div></body></html>', markdown: '', title: 'Widget', timestamp: 0,
  screenshot: Buffer.from('png1'), screenshotTiles: [Buffer.from('png1'), Buffer.from('png2')], pageHeight: 4000,
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
      expect(row!.screenshotPath).toBe(meta.tiles[0]);
      expect((await readCaptureFile(captureId))?.html).toContain('Widget');
      const loaded = await loadProofPageCaptures(f.sourceId, f.urls);
      expect(Object.keys(loaded)).toEqual([f.urls[0]]);
      expect(loaded[f.urls[0]!]!.ref.captureId).toBe(captureId);
    } finally { await f.cleanup(); }
  });
  it('records a failure with its reason and never throws', async () => {
    const f = await createProjectWithSource(caller, { tag: 'ppc-fail', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const { captureId } = await startProofPageCapture(f.sourceId, f.urls[0]!, { fire: false });
      await runProofPageCapture(captureId, sessionWith(async () => { throw new Error('net::ERR_FAILED'); }));
      const meta = (await db.query.captures.findFirst({ where: eq(captures.id, captureId) }))!.metadata as ProofPageMeta;
      expect(meta).toMatchObject({ status: 'failed', error: 'net::ERR_FAILED' });
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
