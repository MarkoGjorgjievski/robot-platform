import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures, datasets, projects, sources } from '@robot/db';
import { PlaywrightBrowser } from '@robot/browser';
import type { PageCapture } from '@robot/browser';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { buildBoxMapScript, boxesFromAnnotation } from '@robot/scraper';
import { writeCaptureFile } from '../verify/capture-store.js';
import { signedInCaller, signIn } from '../test-helpers/identity.js';

// `startProofPageCapture` fires a real browser un-awaited; stub the job so this file never launches one for the mutation.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../verify/proof-page-capture.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/proof-page-capture.js')>();
  return { ...real, runProofPageCapture: runMock, startProofPageCapture: (s: string, u: string) => real.startProofPageCapture(s, u, { fire: false }) };
});

// A pass-through spy on `withBrowserSession` (fix round 1, item 4): lets a test assert
// `detectVariants` skipped opening a browser entirely, without changing what it does.
const { withBrowserSessionMock } = vi.hoisted(() => ({ withBrowserSessionMock: vi.fn() }));
vi.mock('../browser-session.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../browser-session.js')>();
  withBrowserSessionMock.mockImplementation(real.withBrowserSession);
  return { ...real, withBrowserSession: withBrowserSessionMock };
});

// A throwaway signed-in identity: every customer procedure needs a session
// and works in its org only, so nothing here touches the seeded `default` org.
const me = await signedInCaller('sources-variants');
const caller = me.caller;
afterAll(async () => { await me.cleanup(); });

/** A product-page fixture: `withVariants` puts a two-entry `hasVariant` list (color axis) in the
 * JSON-LD, so `detectVariantLists` reports a `list`; without it, a single plain `Product` block. */
function variantFixture(url: string, label: string, withVariants: boolean): PageCapture {
  return {
    url,
    html: `<html><body><h1>${label}</h1></body></html>`,
    markdown: '',
    title: label,
    timestamp: 0,
    screenshot: Buffer.alloc(0),
    screenshotTiles: [],
    structuredData: {
      ldJson: withVariants
        ? [{
            '@context': 'https://schema.org',
            '@type': 'ProductGroup',
            name: label,
            hasVariant: [
              { '@type': 'Product', sku: `${label}-RED`, color: 'Red', offers: { price: '19.99' } },
              { '@type': 'Product', sku: `${label}-BLUE`, color: 'Blue', offers: { price: '19.99' } },
            ],
          }]
        : [{ '@context': 'https://schema.org', '@type': 'Product', name: label, offers: { '@type': 'Offer', price: '19.99' } }],
      nextData: null,
      initialState: null,
      meta: {},
    },
    interceptedRequests: [],
  };
}

let dir: string;
let browser: PlaywrightBrowser;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'captures-variants-'));
  process.env.CAPTURES_DIR = dir;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  delete process.env.CAPTURES_DIR;
  await rm(dir, { recursive: true, force: true });
});

/** A captured proof page for `url`, with or without a variant list in its JSON-LD. */
async function seedProofPage(sourceId: string, url: string, label: string, withVariants: boolean) {
  const fixture = variantFixture(url, label, withVariants);
  const boxes = boxesFromAnnotation(await browser.setContentEvaluate<unknown>(fixture.html, buildBoxMapScript()));
  const now = new Date().toISOString();
  const [row] = await db
    .insert(captures)
    .values({ sourceId, url, html: fixture.html, metadata: { kind: 'proof-page', status: 'captured', url, startedAt: now, capturedAt: now, tiles: ['/captures/x.png'], boxes, pageHeight: 900, capturedHeight: 900, contentHeight: 900 } })
    .returning({ id: captures.id });
  await writeCaptureFile(row!.id, fixture);
  return row!.id;
}

async function project(name: string) {
  return caller.projects.create({ name });
}

const dropIdentity = (r: { cleanup: () => Promise<void> }) => r.cleanup();

describe('sources.detectVariants', () => {
  it('suggests list when any proof page has a variant list, reporting an empty list for a page without one', async () => {
    const f = await createProjectWithSource(caller, {
      tag: 'variants-detect',
      fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { 'https://test-variants-detect.example.com/p/1': '19.99', 'https://test-variants-detect.example.com/p/2': '19.99', 'https://test-variants-detect.example.com/p/3': '19.99' } },
    });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'Widget 1', true);
      await seedProofPage(f.sourceId, f.urls[1]!, 'Widget 2', true);
      await seedProofPage(f.sourceId, f.urls[2]!, 'Widget 3', false);

      const r = await caller.sources.detectVariants({ sourceId: f.sourceId });
      expect(r.suggested).toBe('list');
      expect(r.pages).toHaveLength(3);
      expect(r.pages[0]).toMatchObject({ url: f.urls[0], captured: true });
      expect(r.pages[0]!.lists.length).toBeGreaterThan(0);
      expect(r.pages[0]!.lists[0]).toMatchObject({ source: 'json-ld', path: 'hasVariant', count: 2, axes: ['color'] });
      expect(r.pages[1]!.lists.length).toBeGreaterThan(0);
      expect(r.pages[2]).toMatchObject({ url: f.urls[2], captured: true, lists: [] });
    } finally { await f.cleanup(); }
  });

  it('reports a proof page with no fresh capture as not captured', async () => {
    const f = await createProjectWithSource(caller, {
      tag: 'variants-missing',
      fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { 'https://test-variants-missing.example.com/p/1': '19.99', 'https://test-variants-missing.example.com/p/2': '19.99', 'https://test-variants-missing.example.com/p/3': '19.99' } },
    });
    try {
      await seedProofPage(f.sourceId, f.urls[0]!, 'Widget 1', false);
      await seedProofPage(f.sourceId, f.urls[1]!, 'Widget 2', false);
      // page 3 never captured

      const r = await caller.sources.detectVariants({ sourceId: f.sourceId });
      expect(r.suggested).toBe('none');
      expect(r.pages[2]).toEqual({ url: f.urls[2], captured: false, lists: [], links: [], pickers: [] });
      expect(r.pages[0]!.captured).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('with no verification set, answers no pages and "none"', async () => {
    const f = await createProjectWithSource(caller, { tag: 'variants-unverified', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const r = await caller.sources.detectVariants({ sourceId: f.sourceId });
      expect(r).toEqual({ pages: [], suggested: 'none' });
    } finally { await f.cleanup(); }
  });

  it('skips opening a browser when no proof page has a fresh capture', async () => {
    const f = await createProjectWithSource(caller, {
      tag: 'variants-nocaps',
      fields: [{ name: 'Price', type: 'money' }],
      expected: { Price: { 'https://test-variants-nocaps.example.com/p/1': '19.99', 'https://test-variants-nocaps.example.com/p/2': '19.99', 'https://test-variants-nocaps.example.com/p/3': '19.99' } },
    });
    try {
      withBrowserSessionMock.mockClear();
      const r = await caller.sources.detectVariants({ sourceId: f.sourceId });
      expect(r.suggested).toBe('none');
      expect(r.pages).toEqual(f.urls.map((url) => ({ url, captured: false, lists: [], links: [], pickers: [] })));
      expect(withBrowserSessionMock).not.toHaveBeenCalled();
    } finally { await f.cleanup(); }
  });
});

describe('sources.setVariantSetup', () => {
  it('mints a new axis, reuses it on a later call, and clears axes for method none', async () => {
    const f = await createProjectWithSource(caller, { tag: 'variants-setup', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const first = await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
      expect(first.method).toBe('list');
      expect(first.axes).toHaveLength(1);
      expect(first.axes[0]!.from).toBe('color');
      const axisKey = first.axes[0]!.axisKey;
      expect(typeof axisKey).toBe('string');
      expect(typeof first.confirmedAt).toBe('string');

      const ds1 = await db.query.datasets.findFirst({ where: eq(datasets.id, f.datasetId) });
      const schema1 = ds1!.schema as Array<Record<string, unknown>>;
      expect(schema1.filter((e) => e.kind === 'axis' && e.name === 'Colour')).toHaveLength(1);

      const second = await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', axisKey }] });
      expect(second.axes).toEqual([{ from: 'color', axisKey }]);

      const ds2 = await db.query.datasets.findFirst({ where: eq(datasets.id, f.datasetId) });
      const schema2 = ds2!.schema as Array<Record<string, unknown>>;
      expect(schema2.filter((e) => e.kind === 'axis' && e.name === 'Colour')).toHaveLength(1); // reused, not re-minted

      const cleared = await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'none', axes: [] });
      expect(cleared.method).toBe('none');
      expect(cleared.axes).toEqual([]);

      const row = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect(row!.variantSetup).toMatchObject({ method: 'none', axes: [] });
    } finally { await f.cleanup(); }
  });

  it('BAD_REQUEST for an unknown axisKey', async () => {
    const f = await createProjectWithSource(caller, { tag: 'variants-badkey', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await expect(
        caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', axisKey: 'not_a_real_axis' }] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally { await f.cleanup(); }
  });

  it('BAD_REQUEST for an axes entry naming both axisKey and newAxisName, or neither', async () => {
    const f = await createProjectWithSource(caller, { tag: 'variants-badshape', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const axis = await caller.datasets.addAxis({ datasetId: f.datasetId, name: 'Colour' });
      await expect(
        caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', axisKey: axis.key, newAxisName: 'Size' }] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color' }] }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    } finally { await f.cleanup(); }
  });

  it('BAD_REQUEST for the same "from" mapped twice in one call', async () => {
    const f = await createProjectWithSource(caller, { tag: 'variants-dupfrom', fields: [{ name: 'Price', type: 'money' }] });
    try {
      await expect(
        caller.sources.setVariantSetup({
          sourceId: f.sourceId,
          method: 'list',
          axes: [{ from: 'color', newAxisName: 'Colour' }, { from: 'color', newAxisName: 'Hue' }],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      // trimmed before comparing, but still case-sensitive: "Color" is a different mapping from "color"
      await expect(
        caller.sources.setVariantSetup({
          sourceId: f.sourceId,
          method: 'list',
          axes: [{ from: ' color ', newAxisName: 'Colour' }, { from: 'color', newAxisName: 'Hue' }],
        }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      const ok = await caller.sources.setVariantSetup({
        sourceId: f.sourceId,
        method: 'list',
        axes: [{ from: 'color', newAxisName: 'Colour' }, { from: 'Color', newAxisName: 'Hue' }],
      });
      expect(ok.axes).toHaveLength(2);
    } finally { await f.cleanup(); }
  });

  it('stores the trimmed "from"', async () => {
    const f = await createProjectWithSource(caller, { tag: 'variants-trim', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const r = await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: '  size ', newAxisName: 'Size' }] });
      expect(r.axes[0]!.from).toBe('size');
      const row = await db.query.sources.findFirst({ where: eq(sources.id, f.sourceId) });
      expect((row!.variantSetup as { axes: Array<{ from: string }> }).axes[0]!.from).toBe('size');
    } finally { await f.cleanup(); }
  });

  it('two entries naming the same new column (any case) create it once and map both', async () => {
    const f = await createProjectWithSource(caller, { tag: 'variants-samenew', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const r = await caller.sources.setVariantSetup({
        sourceId: f.sourceId,
        method: 'list',
        axes: [{ from: 'color', newAxisName: 'Colour' }, { from: 'colour', newAxisName: 'colour' }],
      });
      expect(r.axes).toHaveLength(2);
      expect(r.axes[0]!.axisKey).toBe(r.axes[1]!.axisKey);
      const ds = await db.query.datasets.findFirst({ where: eq(datasets.id, f.datasetId) });
      const axes = (ds!.schema as Array<Record<string, unknown>>).filter((e) => e.kind === 'axis');
      expect(axes).toHaveLength(1);
      expect(axes[0]).toMatchObject({ name: 'Colour', key: r.axes[0]!.axisKey });
    } finally { await f.cleanup(); }
  });

  it('sources.get returns the stored variantSetup', async () => {
    const f = await createProjectWithSource(caller, { tag: 'variants-get', fields: [{ name: 'Price', type: 'money' }] });
    try {
      const setup = await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
      const got = await caller.sources.get({ projectSlug: f.projectSlug, sourceSlug: f.sourceSlug });
      expect(got.variantSetup).toEqual(setup);
    } finally { await f.cleanup(); }
  });

  it('is invisible from another organisation', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`variants-src-a-${Date.now()}@example.com`);
      b = await signIn(`variants-src-b-${Date.now()}@example.com`);
      const p = await a.caller.projects.create({ name: 'Mine' });
      await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      const s = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Site', url: 'https://variants-src.example/p/1' });

      const nf = { code: 'NOT_FOUND' };
      await expect(b.caller.sources.detectVariants({ sourceId: s.sourceId })).rejects.toMatchObject(nf);
      await expect(b.caller.sources.setVariantSetup({ sourceId: s.sourceId, method: 'none', axes: [] })).rejects.toMatchObject(nf);
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });
});
