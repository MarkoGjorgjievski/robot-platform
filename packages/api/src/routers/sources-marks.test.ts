import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures, jevReadings } from '@robot/db';
import { PlaywrightBrowser, pageVariantFrom, type PageVariant } from '@robot/browser';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { buildBoxMapScript, boxesFromAnnotation, pageTextOf } from '@robot/scraper';
import { writeCaptureFile } from '../verify/capture-store.js';
import { SHOP_EXAMPLE } from '../test-helpers/shop-example.js';
import { signedInCaller } from '../test-helpers/identity.js';

// `startProofPageCapture` fires a real browser un-awaited; stub the job so this file never launches one for the mutation.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../verify/proof-page-capture.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/proof-page-capture.js')>();
  return { ...real, runProofPageCapture: runMock, startProofPageCapture: (s: string, u: string) => real.startProofPageCapture(s, u, { fire: false }) };
});

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('sources-marks');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });
let dir: string;
let browser: PlaywrightBrowser;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'captures-')); process.env.CAPTURES_DIR = dir;
  browser = new PlaywrightBrowser(); await browser.launch({ headless: true });
});
afterAll(async () => { await browser.close(); delete process.env.CAPTURES_DIR; await rm(dir, { recursive: true, force: true }); });

/** A captured proof page for `url`: fixture html + structured data, box map built by real Chromium. */
async function seedProofPage(sourceId: string, url: string, page: 'p1' | 'p2' | 'p3', html?: string, pageVariant?: PageVariant) {
  const fixture = { ...SHOP_EXAMPLE[page], url, ...(html ? { html } : {}), ...(pageVariant ? { pageVariant } : {}) };
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

  it('reports the page heading and the whole lower-cased page text', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-sug-head', fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }] });
    try {
      const id = await seedProofPage(f.sourceId, f.urls[0]!, 'p1');
      const r = await caller.sources.suggestMarks({ captureId: id });
      expect(r.headingText).toBe('Widget A'); // the fixture's <h1>
      expect(r.pageText).toBe(r.pageText.toLowerCase());
      expect(r.pageText).toContain('widget a');
      expect(r.pageText).toBe(pageTextOf(SHOP_EXAMPLE.p1.html)); // the whole text, uncapped (I2)
    } finally { await f.cleanup(); }
  });

  it('reads the heading from the HTML: an h1 whose text sits in a span; the page text is never cut (I3, I2)', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-sug-span', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const menu = `<nav class="mega">${'Shop all categories and collections '.repeat(300)}</nav>`;
      const html = SHOP_EXAMPLE.p1.html.replace('<div id="main"><h1>Widget A</h1>', `${menu}<div id="main"><h1><span>Widget A</span></h1>`);
      const id = await seedProofPage(f.sourceId, f.urls[0]!, 'p1', html);
      const r = await caller.sources.suggestMarks({ captureId: id });
      expect(r.headingText).toBe('Widget A');
      expect(r.pageText.length).toBeGreaterThan(8000);
      expect(r.pageText).toContain('$129.99'); // shown after 10k characters of menu
    } finally { await f.cleanup(); }
  });

  it('falls back to the largest heading box only when the HTML has no h1', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-sug-h2', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const html = SHOP_EXAMPLE.p1.html.replace('<h1>Widget A</h1>', '<h2>Widget A</h2>');
      const id = await seedProofPage(f.sourceId, f.urls[0]!, 'p1', html);
      const r = await caller.sources.suggestMarks({ captureId: id });
      expect(r.headingText).toBe('Widget A');
    } finally { await f.cleanup(); }
  });

  it('returns the capture\'s page variant beside headingText and pageText, and null for a capture from before', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-sug-variant', fields: [{ name: 'Title', type: 'text' }] });
    try {
      const pageVariant = pageVariantFrom('https://s.example/p/1?variant=123', null, {});
      const captureId = await seedProofPage(f.sourceId, f.urls[0]!, 'p1', undefined, pageVariant);
      const oldCaptureId = await seedProofPage(f.sourceId, f.urls[1]!, 'p2');
      const out = await caller.sources.suggestMarks({ captureId });
      expect(out.pageVariant).toEqual({ ids: ['123'], pairs: [{ name: 'variant', value: '123' }], labels: [], named: true, selected: false });
      const old = await caller.sources.suggestMarks({ captureId: oldCaptureId });
      expect(old.pageVariant).toBeNull();
    } finally { await f.cleanup(); }
  });
});

describe('sources.jevReadings (spec 2026-10-16 §6)', () => {
  const answers = { fields: { price: { candidates: [{ id: 'c1', value: '374.25', source: 's' }, { id: 'c2', value: '499.00', source: 's' }], pick: 'c1', p: 0.97 } } };
  const capture = async (sourceId: string, url: string) => (await db.insert(captures).values({ sourceId, url, html: '' }).returning({ id: captures.id }))[0]!.id;

  it('answers a done reading and a running one keyed by capture id; a capture with no reading is absent', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-jev', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const [done, running, none] = [await capture(f.sourceId, f.urls[0]!), await capture(f.sourceId, f.urls[1]!), await capture(f.sourceId, f.urls[2]!)];
      await db.insert(jevReadings).values([
        { sourceId: f.sourceId, captureId: done, url: f.urls[0]!, status: 'done', answers },
        { sourceId: f.sourceId, captureId: running, url: f.urls[1]!, status: 'running' },
      ]);
      const r = await caller.sources.jevReadings({ sourceId: f.sourceId, captureIds: [done, running, none] });
      expect(r).toEqual({ [done]: { status: 'done', answers }, [running]: { status: 'running', answers: null } });
      expect(await caller.sources.jevReadings({ sourceId: f.sourceId, captureIds: [] })).toEqual({});
    } finally { await f.cleanup(); }
  });

  it('NOT_FOUND for a capture of another org, and for another org\'s website', async () => {
    const other = await signedInCaller('sources-marks-other');
    const f = await createProjectWithSource(caller, { tag: 'marks-jev-mine', fields: [{ name: 'Price', type: 'money' }] });
    const g = await createProjectWithSource(other.caller, { tag: 'marks-jev-theirs', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const mine = await capture(f.sourceId, f.urls[0]!);
      const theirs = await capture(g.sourceId, g.urls[0]!);
      await db.insert(jevReadings).values({ sourceId: g.sourceId, captureId: theirs, url: g.urls[0]!, status: 'done', answers });
      await expect(caller.sources.jevReadings({ sourceId: f.sourceId, captureIds: [mine, theirs] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(caller.sources.jevReadings({ sourceId: g.sourceId, captureIds: [theirs] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally { await f.cleanup(); await g.cleanup(); await other.cleanup(); }
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

describe('sources.proofPageCaptures', () => {
  it('answers the newest capture per url and null for one never captured', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-list', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'p1');
      const newer = await seedProofPage(f.sourceId, f.urls[0]!, 'p1');
      const { captureId: capturing } = await caller.sources.captureProofPage({ sourceId: f.sourceId, url: f.urls[1]! });
      const r = await caller.sources.proofPageCaptures({ sourceId: f.sourceId, urls: [f.urls[0]!, f.urls[1]!, f.urls[2]!] });
      expect(r[f.urls[0]!]).toEqual({ captureId: newer, status: 'captured' });
      expect(r[f.urls[1]!]).toEqual({ captureId: capturing, status: 'capturing' });
      expect(r[f.urls[2]!]).toBeNull();
    } finally { await f.cleanup(); }
  });

  it('treats a captured page older than the reuse window as missing', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-old', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const id = await seedProofPage(f.sourceId, f.urls[0]!, 'p1');
      const row = await db.query.captures.findFirst({ where: eq(captures.id, id) });
      const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      await db.update(captures).set({ metadata: { ...(row!.metadata as object), capturedAt: old } }).where(eq(captures.id, id));
      expect((await caller.sources.proofPageCaptures({ sourceId: f.sourceId, urls: [f.urls[0]!] }))[f.urls[0]!]).toBeNull();
    } finally { await f.cleanup(); }
  });
});

describe('sources.transferMarks from the values on screen', () => {
  it('carries the value the client sends, not the saved one, and only the fields asked for', async () => {
    // Page 1's saved price is a value page 1 does not show: only the override can find anything.
    const f = await createProjectWithSource(caller, { tag: 'marks-from', fields: [{ name: 'Price', type: 'money' }, { name: 'Title', type: 'text' }],
      expected: {
        Price: { 'https://test-marks-from.example.com/p/1': '999.00', 'https://test-marks-from.example.com/p/2': '219.99', 'https://test-marks-from.example.com/p/3': '149.00' },
        Title: { 'https://test-marks-from.example.com/p/1': 'Widget A', 'https://test-marks-from.example.com/p/2': 'Widget B', 'https://test-marks-from.example.com/p/3': 'Widget C' },
      } });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'p1'); await seedProofPage(f.sourceId, f.urls[1]!, 'p2'); await seedProofPage(f.sourceId, f.urls[2]!, 'p3');
      const r = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!], from: { [f.keys.Price!]: { value: '129.99' } }, fieldKeys: [f.keys.Price!] });
      expect(r[f.urls[1]!]!.fields[f.keys.Price!]!.value).toMatch(/219\.99/);
      expect(r[f.urls[1]!]!.fields).not.toHaveProperty(f.keys.Title!);
      const saved = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!], fieldKeys: [f.keys.Price!] });
      expect(saved[f.urls[1]!]!.fields[f.keys.Price!]).toBeNull();
    } finally { await f.cleanup(); }
  });
  it('passes the path page 1\'s answer came from through to the carry, which tries it first', async () => {
    const f = await createProjectWithSource(caller, { tag: 'marks-via', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'p1'); await seedProofPage(f.sourceId, f.urls[1]!, 'p2');
      const plain = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!], from: { [f.keys.Price!]: { value: '129.99' } } });
      expect(plain[f.urls[1]!]!.fields[f.keys.Price!]!.via.source).toBe('api'); // item.priceCents: the API ranks first
      const r = await caller.sources.transferMarks({ sourceId: f.sourceId, fromUrl: f.urls[0]!, toUrls: [f.urls[1]!], from: { [f.keys.Price!]: { value: '129.99', via: { source: 'meta', path: 'product:price:amount' } } } });
      expect(r[f.urls[1]!]!.fields[f.keys.Price!]).toMatchObject({ value: expect.stringMatching(/219\.99/), via: { source: 'meta', path: 'product:price:amount' } });
    } finally { await f.cleanup(); }
  });
});
