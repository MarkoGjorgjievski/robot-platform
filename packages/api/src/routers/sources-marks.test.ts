import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, captures } from '@robot/db';
import { PlaywrightBrowser } from '@robot/browser';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { buildBoxMapScript, boxesFromAnnotation } from '@robot/scraper';
import { writeCaptureFile } from '../verify/capture-store.js';
import { SHOP_EXAMPLE } from '../test-helpers/shop-example.js';

// `startProofPageCapture` fires a real browser un-awaited; stub the job so this file never launches one for the mutation.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../verify/proof-page-capture.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/proof-page-capture.js')>();
  return { ...real, runProofPageCapture: runMock, startProofPageCapture: (s: string, u: string) => real.startProofPageCapture(s, u, { fire: false }) };
});

const caller = createCallerFactory(appRouter)({ db });
let dir: string;
let browser: PlaywrightBrowser;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'captures-')); process.env.CAPTURES_DIR = dir;
  browser = new PlaywrightBrowser(); await browser.launch({ headless: true });
});
afterAll(async () => { await browser.close(); delete process.env.CAPTURES_DIR; await rm(dir, { recursive: true, force: true }); });

/** A captured proof page for `url`: fixture html + structured data, box map built by real Chromium. */
async function seedProofPage(sourceId: string, url: string, page: 'p1' | 'p2' | 'p3') {
  const fixture = { ...SHOP_EXAMPLE[page], url };
  const boxes = boxesFromAnnotation(await browser.setContentEvaluate<unknown>(fixture.html, buildBoxMapScript()));
  const now = new Date().toISOString();
  const [row] = await db.insert(captures).values({ sourceId, url, html: fixture.html, metadata: { kind: 'proof-page', status: 'captured', url, startedAt: now, capturedAt: now, tiles: ['/captures/x.png'], boxes, pageHeight: 900, capturedHeight: 900, contentHeight: 900 } }).returning({ id: captures.id });
  await writeCaptureFile(row!.id, fixture);
  return row!.id;
}

describe('sources.captureProofPage / proofPageCapture', () => {
  it('creates a capturing row and reports it', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-cap', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const { captureId } = await caller.sources.captureProofPage({ sourceId: f.sourceId, url: f.urls[0]! });
      const s = await caller.sources.proofPageCapture({ captureId });
      expect(s).toMatchObject({ status: 'capturing', url: f.urls[0], tiles: [], boxes: [] });
    } finally { await f.cleanup(); }
  });
  it('NOT_FOUND for an unknown capture', async () => {
    await expect(caller.sources.proofPageCapture({ captureId: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('sources.suggestMarks', () => {
  it('suggests price and title from the page data with their boxes', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-sug', fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }] });
    try {
      const id = await seedProofPage(f.sourceId, f.urls[0]!, 'p1');
      const r = await caller.sources.suggestMarks({ captureId: id });
      expect(r.captureId).toBe(id); // the box map these indices point into
      expect(r.fields[f.keys.Price!]).toMatchObject({ value: '129.99', via: { source: 'json-ld', path: 'offers.price' } });
      expect(r.fields[f.keys.Price!]!.boxes).toHaveLength(1);
      expect(r.fields[f.keys.Title!]).toMatchObject({ value: 'Widget A' });
    } finally { await f.cleanup(); }
  });
});

describe('sources.transferMarks', () => {
  it('carries page 1 to pages 2 and 3', async () => {
    // `bindingProblems` needs a value on each of pages 1 to 3, so the binding is saved as it will be
    // once the stepper has confirmed every page; transferMarks only reads page 1's value.
    const f = await createProjectWithSource(caller, { tag: 'marks-tr', fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { 'https://test-marks-tr.example.com/p/1': '129.99', 'https://test-marks-tr.example.com/p/2': '219.99', 'https://test-marks-tr.example.com/p/3': '149.00' } } });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'p1'); const id2 = await seedProofPage(f.sourceId, f.urls[1]!, 'p2'); await seedProofPage(f.sourceId, f.urls[2]!, 'p3');
      const r = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!, f.urls[2]!] });
      expect(r[f.urls[1]!]!.captureId).toBe(id2);
      expect(r[f.urls[1]!]!.fields[f.keys.Price!]!.value).toMatch(/219\.99/);
      expect(r[f.urls[1]!]!.fields[f.keys.Price!]!.boxes).toHaveLength(1);
      expect(r[f.urls[2]!]!.fields[f.keys.Price!]!.value).toMatch(/149/);
    } finally { await f.cleanup(); }
  });
  it('a target with no fresh capture is null, and the other target still resolves', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-tr2', fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { 'https://test-marks-tr2.example.com/p/1': '129.99', 'https://test-marks-tr2.example.com/p/2': '219.99', 'https://test-marks-tr2.example.com/p/3': '149.00' } } });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'p1'); await seedProofPage(f.sourceId, f.urls[1]!, 'p2');
      const r = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!, f.urls[2]!] });
      expect(r[f.urls[2]!]).toBeNull();
      expect(r[f.urls[1]!]!.fields[f.keys.Price!]!.value).toMatch(/219\.99/);
    } finally { await f.cleanup(); }
  });
  it('PRECONDITION_FAILED when page 1 has no capture', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-tr0', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await expect(caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!] })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    } finally { await f.cleanup(); }
  });
});
