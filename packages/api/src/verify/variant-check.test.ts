// packages/api/src/verify/variant-check.test.ts
// The variant part of a Verify run on the seeded VARIANT_SHOP: the list
// method over stored captures, the links method's collector and its
// spot-check of one variant page per product (real Chromium for the
// in-page scripts), and the hash that decides currency.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, captures, sources } from '@robot/db';
import { PlaywrightBrowser } from '@robot/browser';
import type { FieldVerification, SchemaDefinitionField, VariantAnswer, VerificationSet } from '@robot/scraper';
import { createCallerFactory } from '../trpc.js';
import { appRouter } from '../routers/index.js';
import { createProjectWithSource } from '../test-helpers/customer-source.js';
import { VARIANT_SHOP, VARIANT_SHOP_URLS, VARIANT_SHOP_SPOT_URL } from '../test-helpers/variant-shop.js';
import { writeCaptureFile } from './capture-store.js';
import { runVariantCheck, currentVariantHash, variantsRequired } from './variant-check.js';
import { entryFieldsFor } from './variant-fields.js';
import type { VariantSetup } from '../contract.js';

const caller = createCallerFactory(appRouter)({ db, session: null });
const URLS = VARIANT_SHOP_URLS;
const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let browser: PlaywrightBrowser;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'captures-variant-check-'));
  process.env.CAPTURES_DIR = dir;
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
});
afterAll(async () => {
  await browser.close();
  delete process.env.CAPTURES_DIR;
  await rm(dir, { recursive: true, force: true });
});

/** A proof-page capture row for `url` from a VARIANT_SHOP page; `ageMs` backdates it, `failed` writes a failed capture instead. */
async function seedProofPage(sourceId: string, url: string, page: 'p1' | 'p2' | 'p3', opts: { ageMs?: number; failed?: boolean } = {}) {
  const fixture = { ...VARIANT_SHOP[page], url };
  const at = new Date(Date.now() - (opts.ageMs ?? 0)).toISOString();
  const metadata = opts.failed
    ? { kind: 'proof-page', status: 'failed', url, startedAt: at, error: 'blocked' }
    : { kind: 'proof-page', status: 'captured', url, startedAt: at, capturedAt: at, tiles: ['/captures/x.png'], boxes: [], pageHeight: 900, capturedHeight: 900, contentHeight: 900 };
  const [row] = await db.insert(captures).values({ sourceId, url, html: fixture.html, metadata }).returning({ id: captures.id });
  if (!opts.failed) await writeCaptureFile(row!.id, fixture);
}

async function website(tag: string, fields: Array<{ name: string; type: 'text' | 'money' }>, expected: Record<string, Record<string, string>>) {
  const f = await createProjectWithSource(caller, { tag, fields, urls: URLS, expected });
  await caller.datasets.setVariantMode({ datasetId: f.datasetId, mode: 'row_per_variant' });
  for (const [i, p] of (['p1', 'p2', 'p3'] as const).entries()) await seedProofPage(f.sourceId, URLS[i]!, p);
  return f;
}

async function load(sourceId: string) {
  const s = await db.query.sources.findFirst({
    where: eq(sources.id, sourceId),
    columns: { schemaDefinition: true, verificationSet: true, variantSetup: true },
    with: { dataset: { columns: { schema: true } } },
  });
  return {
    set: s!.verificationSet as VerificationSet,
    setup: s!.variantSetup as VariantSetup,
    datasetSchema: s!.dataset!.schema,
    fields: s!.schemaDefinition as SchemaDefinitionField[],
  };
}

const answer = (sourceId: string, url: string, a: VariantAnswer) => caller.sources.saveVariantAnswer({ sourceId, url, answer: a });

/** Writes an answer straight into the row, past saveVariantAnswer's checks: an answer stored before those checks existed. */
async function storeAnswer(sourceId: string, url: string, a: VariantAnswer) {
  const s = await db.query.sources.findFirst({ where: eq(sources.id, sourceId), columns: { verificationSet: true } });
  const set = s!.verificationSet as VerificationSet;
  await db.update(sources).set({ verificationSet: { ...set, variants: { ...(set.variants ?? {}), [url]: a } } }).where(eq(sources.id, sourceId));
}

describe('variantsRequired', () => {
  const setup = (method: VariantSetup['method']): VariantSetup => ({ method, axes: [], confirmedAt: '2026-10-01T00:00:00.000Z' });
  it('follows the project mode and the website setup', () => {
    expect(variantsRequired('ignore', setup('list'))).toBe('no');
    expect(variantsRequired(undefined, setup('list'))).toBe('no');
    expect(variantsRequired('row_per_variant', null)).toBe('setup-missing');
    expect(variantsRequired('nested', setup('none'))).toBe('no');
    expect(variantsRequired('row_per_variant', setup('list'))).toBe('yes');
    expect(variantsRequired('row_per_variant', setup('links'))).toBe('yes');
  });
});

describe('runVariantCheck — list', () => {
  let f: Awaited<ReturnType<typeof website>>;
  let colour: string;
  beforeAll(async () => {
    f = await website('variant-check-list', [{ name: 'Price', type: 'money' }], { Price: { [URLS[0]!]: '10.00', [URLS[1]!]: '20.00', [URLS[2]!]: '15.00' } });
    const setup = await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'list', axes: [{ from: 'color', newAxisName: 'Colour' }] });
    colour = setup.axes[0]!.axisKey;
  });
  afterAll(async () => { await f.cleanup(); });

  it('list: certifies on the seeded shop and fails product 2 when its count is wrong', async () => {
    const price = f.keys.Price!;
    const list = { source: 'json-ld' as const, path: 'hasVariant' };
    await answer(f.sourceId, URLS[0]!, { count: 2, labels: ['Black', 'Red'], list, spot: { index: 0, expected: { [price]: '10.00', [colour]: 'Black' } } });
    await answer(f.sourceId, URLS[1]!, { count: 3, labels: ['Black', 'Red', 'White'], list, spot: { index: 1, expected: { [price]: '21.00', [colour]: 'Red' } } });
    await answer(f.sourceId, URLS[2]!, { count: 0, labels: [] });

    const ok = await runVariantCheck({ sourceId: f.sourceId, ...(await load(f.sourceId)), results: {} }, { browser });
    expect(ok.method).toBe('list');
    expect(ok.passed).toBe(true);
    expect(ok.pages[URLS[0]!]).toEqual({ status: 'pass', count: 2 });
    expect(ok.pages[URLS[2]!]).toEqual({ status: 'none' });
    const l = await load(f.sourceId);
    expect(ok.hash).toBe(currentVariantHash(l));

    await answer(f.sourceId, URLS[1]!, { count: 4, labels: ['Black', 'Red', 'White', 'Blue'], list, spot: { index: 1, expected: { [price]: '21.00', [colour]: 'Red' } } });
    const bad = await runVariantCheck({ sourceId: f.sourceId, ...(await load(f.sourceId)), results: {} }, { browser });
    expect(bad.passed).toBe(false);
    expect(bad.pages[URLS[1]!]).toEqual({ status: 'fail', message: 'found 3 of 4 colours on product 2' });
  });
});

describe('runVariantCheck — links', () => {
  const certifiedResults = (fields: SchemaDefinitionField[], keys: Record<string, string>, opts: { withoutPrice?: boolean } = {}): Record<string, FieldVerification> => {
    const paths: Record<string, FieldVerification['certified']> = {
      [keys.Title!]: [{ source: 'json-ld', path: 'name', transform: 'identity' }],
      [keys.Price!]: opts.withoutPrice ? [] : [{ source: 'json-ld', path: 'hasVariant[0].offers.price', transform: 'identity' }],
    };
    return Object.fromEntries(fields.map((d) => [d.key, { key: d.key, cells: {}, certified: paths[d.key] ?? [], weakEvidence: false, aiCalled: false, incomplete: false } as unknown as FieldVerification]));
  };

  const P2_SPOT = 'https://variants.example/p/2-white';
  const P2_LINKS = ['https://variants.example/p/2-black', 'https://variants.example/p/2-red', P2_SPOT];

  /** p1 checks its Red page, p2 its White page; no spot capture is seeded — each test seeds what it needs. */
  async function linksWebsite(tag: string) {
    const f = await website(tag, [{ name: 'Title', type: 'text' }, { name: 'Price', type: 'money' }], {
      Title: { [URLS[0]!]: 'Shoe', [URLS[1]!]: 'Hat', [URLS[2]!]: 'Belt' },
      Price: { [URLS[0]!]: '10.00', [URLS[1]!]: '20.00', [URLS[2]!]: '15.00' },
    });
    await caller.sources.setVariantSetup({ sourceId: f.sourceId, method: 'links', axes: [] });
    await answer(f.sourceId, URLS[0]!, { count: 2, labels: ['Black', 'Red'], links: [URLS[0]!, VARIANT_SHOP_SPOT_URL], spot: { index: 0, url: VARIANT_SHOP_SPOT_URL, expected: {} } });
    await answer(f.sourceId, URLS[1]!, { count: 3, labels: ['Black', 'Red', 'White'], links: P2_LINKS, spot: { index: 0, url: P2_SPOT, expected: {} } });
    await answer(f.sourceId, URLS[2]!, { count: 0, labels: [] });
    return f;
  }

  const check = async (f: { sourceId: string; keys: Record<string, string> }, opts: { withoutPrice?: boolean; edit?: (set: VerificationSet) => void } = {}) => {
    const l = await load(f.sourceId);
    opts.edit?.(l.set);
    return runVariantCheck({ sourceId: f.sourceId, ...l, results: certifiedResults(l.fields, f.keys, opts) }, { browser });
  };

  it('links: certifies the swatch collector and spot-checks the first variant page against the certified fields', async () => {
    const f = await linksWebsite('variant-check-links');
    try {
      await seedProofPage(f.sourceId, VARIANT_SHOP_SPOT_URL, 'p1');
      await seedProofPage(f.sourceId, P2_SPOT, 'p2');
      const r = await check(f);
      expect(r.method).toBe('links');
      expect(r.collector).toBeTruthy();
      expect(r.pages[URLS[0]!]).toEqual({ status: 'pass', count: 2 });
      expect(r.pages[URLS[1]!]).toEqual({ status: 'pass', count: 3 });
      expect(r.pages[URLS[2]!]).toEqual({ status: 'none' });
      expect(r.passed).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('links: a missing spot capture asks for the screenshot again', async () => {
    const f = await linksWebsite('variant-check-nospot');
    try {
      await seedProofPage(f.sourceId, P2_SPOT, 'p2');
      const r = await check(f);
      expect(r.pages[URLS[0]!]).toEqual({ status: 'fail', message: "Take the Red page's screenshot again" });
      expect(r.pages[URLS[1]!]).toEqual({ status: 'pass', count: 3 });
      expect(r.passed).toBe(false);
    } finally { await f.cleanup(); }
  });

  it('links: a failed spot capture asks for the screenshot again, never a pass', async () => {
    const f = await linksWebsite('variant-check-failedspot');
    try {
      await seedProofPage(f.sourceId, VARIANT_SHOP_SPOT_URL, 'p1', { failed: true });
      await seedProofPage(f.sourceId, P2_SPOT, 'p2');
      const r = await check(f);
      expect(r.pages[URLS[0]!]).toEqual({ status: 'fail', message: "Take the Red page's screenshot again" });
      expect(r.passed).toBe(false);
    } finally { await f.cleanup(); }
  });

  it('links: a day-old spot capture asks for the screenshot again, never a pass', async () => {
    const f = await linksWebsite('variant-check-stalespot');
    try {
      await seedProofPage(f.sourceId, VARIANT_SHOP_SPOT_URL, 'p1', { ageMs: DAY + 60_000 });
      await seedProofPage(f.sourceId, P2_SPOT, 'p2');
      const r = await check(f);
      expect(r.pages[URLS[0]!]).toEqual({ status: 'fail', message: "Take the Red page's screenshot again" });
      expect(r.passed).toBe(false);
    } finally { await f.cleanup(); }
  });

  it('links: a product with variants but no checked variant page fails closed', async () => {
    const f = await linksWebsite('variant-check-nospoturl');
    try {
      await seedProofPage(f.sourceId, VARIANT_SHOP_SPOT_URL, 'p1');
      await answer(f.sourceId, URLS[1]!, { count: 3, labels: ['Black', 'Red', 'White'], links: P2_LINKS });
      const r = await check(f);
      expect(r.pages[URLS[0]!]).toEqual({ status: 'pass', count: 2 });
      expect(r.pages[URLS[1]!]).toEqual({ status: 'fail', message: "Take the Black page's screenshot again" });
      expect(r.passed).toBe(false);

      // No labels at all: the generic word.
      await answer(f.sourceId, URLS[1]!, { count: 3, labels: [], links: P2_LINKS });
      expect((await check(f)).pages[URLS[1]!]).toEqual({ status: 'fail', message: "Take the variant page's screenshot again" });
    } finally { await f.cleanup(); }
  });

  it('links: a checked page that is not one of the links is labelled with the first variant', async () => {
    const f = await linksWebsite('variant-check-spotoutside');
    try {
      await seedProofPage(f.sourceId, P2_SPOT, 'p2');
      await storeAnswer(f.sourceId, URLS[0]!, { count: 2, labels: ['Black', 'Red'], links: [URLS[0]!, VARIANT_SHOP_SPOT_URL], spot: { index: 0, url: 'https://variants.example/p/1-elsewhere', expected: {} } });
      const r = await check(f);
      expect(r.pages[URLS[0]!]).toEqual({ status: 'fail', message: "Take the Black page's screenshot again" });
    } finally { await f.cleanup(); }
  });

  it('links: a field the variant page does not carry fails that product', async () => {
    const f = await linksWebsite('variant-check-spotmiss');
    try {
      // The Red page is the Belt page: no hasVariant, so the certified price path reads nothing there.
      await seedProofPage(f.sourceId, VARIANT_SHOP_SPOT_URL, 'p3');
      await seedProofPage(f.sourceId, P2_SPOT, 'p2');
      const r = await check(f);
      expect(r.pages[URLS[0]!]).toEqual({ status: 'fail', message: 'Price missing on the Red page of product 1' });
      expect(r.passed).toBe(false);
    } finally { await f.cleanup(); }
  });

  it('links: a field blank on the product is not required on its variant page', async () => {
    const f = await linksWebsite('variant-check-spotblank');
    try {
      await seedProofPage(f.sourceId, VARIANT_SHOP_SPOT_URL, 'p3');
      await seedProofPage(f.sourceId, P2_SPOT, 'p2');
      const r = await check(f, { edit: (set) => { set.expected[f.keys.Price!]![URLS[0]!] = ''; } });
      expect(r.pages[URLS[0]!]).toEqual({ status: 'pass', count: 2 });
      expect(r.passed).toBe(true);
    } finally { await f.cleanup(); }
  });

  it('links: a field without a certified path fails every product with variants', async () => {
    const f = await linksWebsite('variant-check-uncert');
    try {
      await seedProofPage(f.sourceId, VARIANT_SHOP_SPOT_URL, 'p1');
      await seedProofPage(f.sourceId, P2_SPOT, 'p2');
      const r = await check(f, { withoutPrice: true });
      expect(r.pages[URLS[0]!]).toEqual({ status: 'fail', message: 'Verify every field first' });
      expect(r.pages[URLS[1]!]).toEqual({ status: 'fail', message: 'Verify every field first' });
      expect(r.pages[URLS[2]!]).toEqual({ status: 'none' });
      expect(r.passed).toBe(false);
    } finally { await f.cleanup(); }
  });
});

describe('currentVariantHash', () => {
  it('the hash moves when an answer changes and ignores answers for removed pages', () => {
    const datasetSchema = [
      { key: 'price', name: 'Price', type: 'money', concept: 'price' },
      { key: 'colour', name: 'Colour', kind: 'axis', concept: 'axis' },
    ];
    const setup: VariantSetup = { method: 'list', axes: [{ from: 'color', axisKey: 'colour' }], confirmedAt: '2026-10-01T00:00:00.000Z' };
    const variants: Record<string, VariantAnswer> = {
      [URLS[0]!]: { count: 2, labels: ['Black', 'Red'] },
      [URLS[1]!]: { count: 3, labels: ['Black', 'Red', 'White'] },
      [URLS[2]!]: { count: 0, labels: [] },
    };
    const set: VerificationSet = { urls: URLS, expected: {}, variants };
    const base = currentVariantHash({ set, setup, datasetSchema });

    const changed = { ...set, variants: { ...variants, [URLS[1]!]: { count: 4, labels: ['Black', 'Red', 'White', 'Blue'] } } };
    expect(currentVariantHash({ set: changed, setup, datasetSchema })).not.toBe(base);

    const orphan = { ...set, variants: { ...variants, 'https://variants.example/p/9': { count: 2, labels: ['a', 'b'] } } };
    expect(currentVariantHash({ set: orphan, setup, datasetSchema })).toBe(base);

    // A product replaced: its old answer no longer counts, so the hash moves.
    const replaced = { ...set, urls: [URLS[0]!, URLS[1]!, 'https://variants.example/p/4'] };
    expect(currentVariantHash({ set: replaced, setup, datasetSchema })).not.toBe(base);

    // Renaming a field or a column is free.
    const renamed = datasetSchema.map((e) => ({ ...e, name: `${e.name} (renamed)` }));
    expect(currentVariantHash({ set, setup, datasetSchema: renamed })).toBe(base);

    // The method.
    expect(currentVariantHash({ set, setup: { ...setup, method: 'links' }, datasetSchema })).not.toBe(base);
    // The axis mapping.
    expect(currentVariantHash({ set, setup: { ...setup, axes: [{ from: 'colour', axisKey: 'colour' }] }, datasetSchema })).not.toBe(base);
    // A field's level: price moved to the product drops its entry field; a product field moved to the variant adds one.
    const priceOnProduct = datasetSchema.map((e) => (e.key === 'price' ? { ...e, level: 'product' } : e));
    expect(currentVariantHash({ set, setup, datasetSchema: priceOnProduct })).not.toBe(base);
    const titleOnVariant = [...datasetSchema, { key: 'title', name: 'Title', type: 'text', concept: 'title', level: 'variant' }];
    expect(currentVariantHash({ set, setup, datasetSchema: titleOnVariant })).not.toBe(base);
    // A field that is not an entry field (product level) leaves it alone.
    const titleOnProduct = [...datasetSchema, { key: 'title', name: 'Title', type: 'text', concept: 'title' }];
    expect(currentVariantHash({ set, setup, datasetSchema: titleOnProduct })).toBe(base);
    // A retype.
    const retyped = datasetSchema.map((e) => (e.key === 'price' ? { ...e, type: 'text' } : e));
    expect(currentVariantHash({ set, setup, datasetSchema: retyped })).not.toBe(base);
  });
});

describe('entryFieldsFor', () => {
  it('gives one entry field per column, reading every detected name mapped to it in order', () => {
    const datasetSchema = [
      { key: 'price', name: 'Price', type: 'money', concept: 'price' },
      { key: 'colour', name: 'Colour', kind: 'axis', concept: 'axis' },
      { key: 'size', name: 'Size', kind: 'axis', concept: 'axis' },
    ];
    const setup: VariantSetup = {
      method: 'list',
      axes: [{ from: 'color', axisKey: 'colour' }, { from: 'size', axisKey: 'size' }, { from: 'colour', axisKey: 'colour' }],
      confirmedAt: '2026-10-01T00:00:00.000Z',
    };
    const fields = entryFieldsFor(datasetSchema, setup);
    expect(fields.map((f) => f.key)).toEqual(['price', 'colour', 'size']);
    expect(fields.find((f) => f.key === 'colour')!.axisFrom).toEqual(['color', 'colour']);
    expect(fields.find((f) => f.key === 'size')!.axisFrom).toBe('size');
  });
});
