import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures, projects, sources, users, type Database } from '@robot/db';
import { PlaywrightBrowser } from '@robot/browser';
import type { VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from './index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { buildBoxMapScript, boxesFromAnnotation } from '@robot/scraper';
import { writeCaptureFile } from '../verify/capture-store.js';
import { loadSession } from '../auth/session.js';
import { deleteOwnOrg } from '../test-helpers/identity.js';
import { VARIANT_SHOP, VARIANT_SHOP_URLS } from '../test-helpers/variant-shop.js';

// `startProofPageCapture` fires a real browser un-awaited; stub the job so this file never launches one for the mutation.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../verify/proof-page-capture.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../verify/proof-page-capture.js')>();
  return { ...real, runProofPageCapture: runMock, startProofPageCapture: (s: string, u: string) => real.startProofPageCapture(s, u, { fire: false }) };
});

const caller = createCallerFactory(appRouter)({ db, session: null });
const URLS = VARIANT_SHOP_URLS;

let dir: string;
let browser: PlaywrightBrowser;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'captures-variant-answers-'));
  process.env.CAPTURES_DIR = dir;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  delete process.env.CAPTURES_DIR;
  await rm(dir, { recursive: true, force: true });
});

/** A captured proof page for `url`, from the VARIANT_SHOP fixture. */
async function seedProofPage(sourceId: string, url: string, page: 'p1' | 'p2' | 'p3') {
  const fixture = { ...VARIANT_SHOP[page], url };
  const boxes = boxesFromAnnotation(await browser.setContentEvaluate<unknown>(fixture.html, buildBoxMapScript()));
  const now = new Date().toISOString();
  const [row] = await db
    .insert(captures)
    .values({ sourceId, url, html: fixture.html, metadata: { kind: 'proof-page', status: 'captured', url, startedAt: now, capturedAt: now, tiles: ['/captures/x.png'], boxes, pageHeight: 900, capturedHeight: 900, contentHeight: 900 } })
    .returning({ id: captures.id });
  await writeCaptureFile(row!.id, fixture);
  return row!.id;
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

/** Reads the source row directly (R4: sources.get is slug-keyed) and rebuilds the updateBinding input the app sends, the way its toBindingInput does. */
async function currentBindingInput(_caller: unknown, sourceId: string) {
  const row = await (db as Database).query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { schemaDefinition: true, verificationSet: true } });
  const def = (row!.schemaDefinition ?? []) as Array<{ key: string; description?: string }>;
  const vs = (row!.verificationSet ?? {}) as VerificationSet;
  const descriptions = Object.fromEntries(def.map((f) => [f.key, f.description ?? '']));
  return {
    urls: vs.urls ?? [],
    ...(vs.listing_url ? { listingUrl: vs.listing_url } : {}),
    descriptions,
    expected: vs.expected ?? {},
    ...(vs.marks ? { marks: vs.marks } : {}),
    ...(vs.paths ? { paths: vs.paths } : {}),
    ...(vs.cards ? { cards: vs.cards } : {}),
    draft: true as const,
  };
}

describe('sources.saveVariantAnswer / variantList / variantLinksNear', () => {
  let sourceId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const f = await createProjectWithSource(caller, {
      tag: 'variant-answers',
      fields: [{ name: 'Price', type: 'money' }],
      urls: URLS,
      expected: { Price: { [URLS[0]!]: '10.00', [URLS[1]!]: '20.00', [URLS[2]!]: '15.00' } },
    });
    sourceId = f.sourceId;
    cleanup = f.cleanup;
    await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'row_per_variant' });
    await caller.sources.setVariantSetup({ sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
    await seedProofPage(sourceId, URLS[0]!, 'p1');
    await seedProofPage(sourceId, URLS[1]!, 'p2');
    await seedProofPage(sourceId, URLS[2]!, 'p3');
  });
  afterAll(async () => { await cleanup(); });

  it('saves an answer for a proof page and returns the map', async () => {
    const r = await caller.sources.saveVariantAnswer({ sourceId, url: URLS[0]!, answer: { count: 2, labels: ['Black', 'Red'], list: { source: 'json-ld', path: 'hasVariant' } } });
    expect(r.variants[URLS[0]!]!.count).toBe(2);
  });

  it('refuses a page that is not one of the products', async () => {
    await expect(caller.sources.saveVariantAnswer({ sourceId, url: 'https://variants.example/p/9', answer: null })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('the fields autosave never drops a variant answer, even when they race', async () => {
    const binding = await currentBindingInput(caller, sourceId);
    await Promise.all([
      caller.sources.updateBinding({ sourceId, ...binding }),
      caller.sources.saveVariantAnswer({ sourceId, url: URLS[1]!, answer: { count: 3, labels: ['Black', 'Red', 'White'] } }),
    ]);
    const s = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
    expect((s!.verificationSet as { variants: Record<string, unknown> }).variants[URLS[1]!]).toBeTruthy();
  });

  it('replacing a product drops its variant answer', async () => {
    await caller.sources.saveVariantAnswer({ sourceId, url: URLS[2]!, answer: { count: 0, labels: [] } });
    const binding = await currentBindingInput(caller, sourceId);
    await caller.sources.updateBinding({ sourceId, ...binding, urls: [URLS[0]!, URLS[1]!, 'https://variants.example/p/4'] });
    const s = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
    expect(Object.keys((s!.verificationSet as { variants?: Record<string, unknown> }).variants ?? {})).not.toContain(URLS[2]!);
  });

  it('lists a product\'s variants with a suggestion per variant field', async () => {
    const r = await caller.sources.variantList({ sourceId, url: URLS[1]!, list: { source: 'json-ld', path: 'hasVariant' } });
    expect(r!.count).toBe(3);
    expect(r!.labels).toEqual(['Black', 'Red', 'White']);
    expect(r!.suggestions[0]!.price).toEqual({ value: expect.any(String), path: 'offers.price' });
  });

  it('finds the links near a marked swatch', async () => {
    const r = await caller.sources.variantLinksNear({ sourceId, url: URLS[0]!, xpath: "//div[contains(@class,'product-swatches')]/a[2]" });
    expect(r!.count).toBe(2);
  });

  it('another org gets NOT_FOUND from all three', async () => {
    let a: Awaited<ReturnType<typeof signIn>> | undefined;
    let b: Awaited<ReturnType<typeof signIn>> | undefined;
    try {
      a = await signIn(`variant-answers-a-${Date.now()}@example.com`);
      b = await signIn(`variant-answers-b-${Date.now()}@example.com`);
      const p = await a.caller.projects.create({ name: 'Mine' });
      await a.caller.datasets.addField({ datasetId: p.datasetId, name: 'Price', type: 'money' });
      const s = await a.caller.sources.createInProject({ projectSlug: p.slug, name: 'Site', url: 'https://variant-answers-org.example/p/1' });

      const nf = { code: 'NOT_FOUND' };
      await expect(b!.caller.sources.saveVariantAnswer({ sourceId: s.sourceId, url: 'https://variant-answers-org.example/p/1', answer: null })).rejects.toMatchObject(nf);
      await expect(b!.caller.sources.variantList({ sourceId: s.sourceId, url: 'https://variant-answers-org.example/p/1', list: { source: 'json-ld', path: 'hasVariant' } })).rejects.toMatchObject(nf);
      await expect(b!.caller.sources.variantLinksNear({ sourceId: s.sourceId, url: 'https://variant-answers-org.example/p/1', xpath: '//a' })).rejects.toMatchObject(nf);
    } finally {
      if (a) await dropIdentity(a);
      if (b) await dropIdentity(b);
    }
  });
});
