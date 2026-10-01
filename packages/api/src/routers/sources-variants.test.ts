import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures, datasets, projects, sources, users } from '@robot/db';
import { PlaywrightBrowser } from '@robot/browser';
import type { PageCapture } from '@robot/browser';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { buildBoxMapScript, boxesFromAnnotation } from '@robot/scraper';
import { writeCaptureFile } from '../verify/capture-store.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';

// `startProofPageCapture` fires a real browser un-awaited; stub the job so this file never launches one for the mutation.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../verify/proof-page-capture.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/proof-page-capture.js')>();
  return { ...real, runProofPageCapture: runMock, startProofPageCapture: (s: string, u: string) => real.startProofPageCapture(s, u, { fire: false }) };
});

const caller = createCallerFactory(appRouter)({ db, session: null });

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

async function signIn(email: string) {
  const cookies: Record<string, string | null> = {};
  const c = createCallerFactory(appRouter)({ db, session: null, setCookie: (n, v) => { cookies[n] = v; }, clearCookie: () => {} });
  const r = await c.auth.signIn({ email, password: 'x' });
  const session = (await loadSession(db, cookies['robot_session']!))!;
  return { ...r, session, caller: createCallerFactory(appRouter)({ db, session }) };
}

async function dropIdentity(r: { org: { id: string }; user: { id: string } }) {
  await db.delete(projects).where(eq(projects.orgId, r.org.id));
  await deleteOwnOrg(r.org.id);
  await db.delete(users).where(eq(users.id, r.user.id));
}

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
