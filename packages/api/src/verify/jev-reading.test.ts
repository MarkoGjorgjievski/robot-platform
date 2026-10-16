import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, captures, jevReadings, sources, sourceVerifications } from '@robot/db';
import type { Box } from '@robot/scraper';

// The real TypeSafe client must never be built in a test: every reading here gets
// an injected fake, and this spy fails the file if anything reaches for the real one.
const { realClient } = vi.hoisted(() => ({ realClient: vi.fn(() => { throw new Error('the real TypeSafe client was built in a test'); }) }));
vi.mock('./jev-client.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('./jev-client.js')>()), typesafeJevClient: realClient }));

import { answersFrom, buildJevRequest, jevDailyBudget, jevEnabled, runJevReading, startJevReading, tileFor, VARIANT_KEY, type JevClient } from './jev-reading.js';
import { createTestSource, deleteTestSource } from '../test-helpers/source.js';

const ON = { JEV_SHADOW: '1', TYPESAFE_API_KEY: 'k' } as NodeJS.ProcessEnv;
const box = (text: string, tag = 'span', y = 100): Box => ({ xpaths: [`//${tag}`], text, rect: { x: 100, y, w: 200, h: 20 }, tag, kind: 'text' });
const fields = [
  { key: 'price', name: 'Price', type: 'money' as const, concept: 'price', description: 'the price a buyer pays' },
  { key: 'stock', name: 'In stock', type: 'boolean' as const, concept: 'availability' },
];
const capture = {
  url: 'https://s.example/p/1', structuredData: { ldJson: [{ '@type': 'Product', offers: { price: '374.25' } }], nextData: null, initialState: null, meta: {} },
  interceptedRequests: [], screenshotTiles: [Buffer.from('tile1'), Buffer.from('tile2')], pageHeight: 3000, verdict: { kind: 'ok', status: 200 },
} as never;
const boxes = [box('Sierra Rug', 'h1', 80), box('$374.25', 'span', 200), box('$499.00', 's', 200)];

function fakeClient(answer?: (q: string[]) => Record<string, { choice: string; probabilities: Record<string, number> }>, fail = 0): JevClient & { calls: Array<{ image: Buffer; state: unknown; questions: unknown[] }> } {
  const calls: Array<{ image: Buffer; state: unknown; questions: unknown[] }> = [];
  let failures = fail;
  return {
    calls,
    async ask(req) {
      calls.push(req as never);
      if (failures-- > 0) throw new Error('boom');
      const keys = req.questions.map((q) => q.key);
      return { model: 'jev-1.14.0', inputTokens: 5000, answers: answer ? answer(keys) : Object.fromEntries(keys.map((k) => [k, { choice: 'c1', probabilities: { c1: 0.98, c2: 0.02 } }])) };
    },
  };
}

afterEach(() => { expect(realClient).not.toHaveBeenCalled(); });

describe('the switch and the budget', () => {
  it('is off without JEV_SHADOW or without a key', () => {
    expect(jevEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(jevEnabled({ JEV_SHADOW: '1' } as NodeJS.ProcessEnv)).toBe(false);
    expect(jevEnabled({ TYPESAFE_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(false);
    expect(jevEnabled(ON)).toBe(true);
  });
  it('is off in the test environment: vitest.config.ts sets JEV_SHADOW to "", which beats a JEV_SHADOW=1 in the repo .env', () => {
    expect(process.env.JEV_SHADOW).toBe('');
    expect(jevEnabled()).toBe(false);
  });
  it('reads JEV_DAILY_READINGS, default 2000', () => {
    expect(jevDailyBudget({} as NodeJS.ProcessEnv)).toBe(2000);
    expect(jevDailyBudget({ JEV_DAILY_READINGS: '50' } as NodeJS.ProcessEnv)).toBe(50);
    expect(jevDailyBudget({ JEV_DAILY_READINGS: '0' } as NodeJS.ProcessEnv)).toBe(0);
    expect(jevDailyBudget({ JEV_DAILY_READINGS: 'x' } as NodeJS.ProcessEnv)).toBe(2000);
    expect(jevDailyBudget({ JEV_DAILY_READINGS: '-3' } as NodeJS.ProcessEnv)).toBe(2000);
  });
});

describe('buildJevRequest', () => {
  it('asks the ambiguous price, never the boolean; state holds only the title and verbatim candidates', () => {
    const b = buildJevRequest({ title: 'Sierra Rug', fields, capture, boxes, tileHeights: [1536, 1464] })!;
    expect(b.request.questions.map((q) => q.key)).toEqual(['price']);
    expect(Object.keys(b.request.state).sort()).toEqual(['candidates', 'page_title']);
    expect(b.request.state.candidates.price!.map((c) => c.value)).toEqual(['374.25', '$499.00']);
    expect(b.request.questions[0]!.instructions).toContain('the price a buyer pays now for the selected variant');
    expect(JSON.stringify(b.request)).not.toContain('Sierra Rug</');
  });
  it('nothing ambiguous and no variant list → null', () => {
    expect(buildJevRequest({ title: 't', fields: [fields[1]!], capture, boxes, tileHeights: [1536] })).toBeNull();
  });
  it('a variant list → a variant question whose options sit in state as verbatim labels, [page] match kept', () => {
    const hasVariant = Array.from({ length: 3 }, (_, i) => ({ '@type': 'Product', sku: `R-${i}`, size: `${i + 2}'x${i + 3}'`, offers: { price: String(100 + i), url: `/p?variant=${1000 + i}` } }));
    const vcap = {
      structuredData: { ldJson: [{ '@type': 'ProductGroup', variesBy: ['https://schema.org/size'], hasVariant }], nextData: null, initialState: null, meta: {} },
      interceptedRequests: [],
      pageVariant: { ids: [], pairs: [{ name: 'size', value: "3'x4'" }], labels: ["3'x4'"], named: true, selected: false },
    } as never;
    const b = buildJevRequest({ title: 't', fields: [fields[1]!], capture: vcap, boxes: [], tileHeights: [1536] })!;
    expect(b.request.questions.map((q) => [q.key, q.kind])).toEqual([[VARIANT_KEY, 'variant']]);
    expect(b.request.state.candidates[VARIANT_KEY]!.map((c) => c.value)).toEqual(["2'x3'", "3'x4'", "4'x5'"]);
    expect(b.variant!.pageMatch).toBe('e2');
    const a = answersFrom(b, { [VARIANT_KEY]: { choice: 'e2', probabilities: { e2: 0.973 } } });
    expect(a.variant).toMatchObject({ pick: 'e2', p: 0.97, pageMatch: 'e2' });
    expect(a.variant!.entries).toHaveLength(3);
  });
});

describe('tileFor', () => {
  it('picks the tile holding the topmost candidate', () => {
    expect(tileFor([Buffer.from('a'), Buffer.from('b')], [1536, 1536], [1700, 2000])).toBe(1);
  });
  it('never picks a tile shorter than 400 px', () => {
    expect(tileFor([Buffer.from('a'), Buffer.from('b')], [1536, 200], [1600])).toBe(0);
  });
  it('no candidate box → tile 0', () => {
    expect(tileFor([Buffer.from('a')], [1536], [])).toBe(0);
  });
});

describe('answersFrom', () => {
  it('answers outside the asked ids are dropped', () => {
    const b = buildJevRequest({ title: 'x', fields, capture, boxes, tileHeights: [1536] })!;
    const a = answersFrom(b, { price: { choice: 'c9', probabilities: { c9: 1 } }, bogus: { choice: 'c1', probabilities: { c1: 1 } } });
    expect(a.fields).toEqual({});
  });
  it('keeps a pick and its probability, none included', () => {
    const b = buildJevRequest({ title: 'x', fields, capture, boxes, tileHeights: [1536] })!;
    expect(answersFrom(b, { price: { choice: 'c1', probabilities: { c1: 0.98, c2: 0.02 } } }).fields.price).toMatchObject({ pick: 'c1', p: 0.98 });
    expect(answersFrom(b, { price: { choice: 'none', probabilities: { none: 0.71 } } }).fields.price).toMatchObject({ pick: 'none', p: 0.71 });
  });
});

describe('startJevReading / runJevReading', () => {
  let sourceId: string;
  let captureId: string;
  beforeEach(async () => {
    sourceId = await createTestSource({ schema: [{ key: 'price', name: 'Price', type: 'money', concept: 'price', description: 'the price a buyer pays' }] });
    const [c] = await db.insert(captures).values({ sourceId, url: 'https://s.example/p/1' }).returning({ id: captures.id });
    captureId = c!.id;
  });
  afterEach(async () => { await deleteTestSource(sourceId); });

  it('off → no row, no request', async () => {
    const client = fakeClient();
    const r = await startJevReading({ sourceId, captureId, url: 'https://s.example/p/1', title: 'x', capture, boxes }, { client, env: {} as NodeJS.ProcessEnv });
    expect(r).toEqual({ readingId: null, reason: 'off' });
    expect(client.calls).toHaveLength(0);
    expect(await db.query.jevReadings.findFirst({ where: eq(jevReadings.captureId, captureId) })).toBeUndefined();
  });

  it('off by default in the test environment, even with no client injected and a key present', async () => {
    expect(process.env.JEV_SHADOW).toBe('');
    const r = await startJevReading({ sourceId, captureId, url: 'https://s.example/p/1', title: 'x', capture, boxes }, { env: { ...process.env, TYPESAFE_API_KEY: 'k' } });
    expect(r).toEqual({ readingId: null, reason: 'off' });
    expect(await startJevReading({ sourceId, captureId, url: 'https://s.example/p/1', title: 'x', capture, boxes })).toEqual({ readingId: null, reason: 'off' });
    expect(await db.query.jevReadings.findFirst({ where: eq(jevReadings.captureId, captureId) })).toBeUndefined();
  });

  it('a database error storing the answers never sends a second request', async () => {
    // model is varchar(40): a longer one makes the `done` write fail.
    const client: JevClient & { calls: number } = { calls: 0, async ask(req) { this.calls++; return { model: 'm'.repeat(60), inputTokens: 10, answers: Object.fromEntries(req.questions.map((q) => [q.key, { choice: 'c1', probabilities: { c1: 1 } }])) }; } };
    const r = await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client, env: ON, fire: false });
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }], capture, boxes, tileHeights: [1536] })!;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { await runJevReading(r.readingId!, built, Buffer.from('t'), client); } finally { quiet.mockRestore(); }
    expect(client.calls).toBe(1);
    expect((await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, r.readingId!) }))!.status).toBe('failed');
  });

  it('a timed-out attempt is aborted before the retry starts', async () => {
    const signals: AbortSignal[] = [];
    const slow: JevClient = { ask: (req) => { signals.push(req.signal!); return new Promise(() => {}); } };
    const r = await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client: slow, env: ON, fire: false });
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }], capture, boxes, tileHeights: [1536] })!;
    let abortedBeforeSecond: boolean | null = null;
    const watch: JevClient = { ask: (req) => { if (signals.length === 1) abortedBeforeSecond = signals[0]!.aborted; return slow.ask(req); } };
    await runJevReading(r.readingId!, built, Buffer.from('t'), watch, { timeoutMs: 20 });
    expect(signals).toHaveLength(2);
    expect(abortedBeforeSecond).toBe(true);
    expect(signals.every((s) => s.aborted)).toBe(true);
  });

  it('at the budget, startJevReading inserts nothing and sends nothing', async () => {
    const client = fakeClient();
    const r = await startJevReading({ sourceId, captureId, url: 'https://s.example/p/1', title: 'x', capture, boxes }, { client, env: { ...ON, JEV_DAILY_READINGS: '0' } });
    expect(r.reason).toBe('budget');
    expect(client.calls).toHaveLength(0);
    expect(await db.query.jevReadings.findFirst({ where: eq(jevReadings.captureId, captureId) })).toBeUndefined();
  });

  it('a done reading stores its answers, tokens and cost; the image is sent once, the questions never name it', async () => {
    const client = fakeClient();
    const r = await startJevReading({ sourceId, captureId, url: 'https://s.example/p/1', title: 'x', capture, boxes }, { client, env: ON, fire: false });
    expect(r.readingId).not.toBeNull();
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price', description: 'the price a buyer pays' }], capture, boxes, tileHeights: [1536, 1464] })!;
    await runJevReading(r.readingId!, built, Buffer.from('tile1'), client);
    const row = await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, r.readingId!) });
    expect(row).toMatchObject({ status: 'done', inputTokens: 5000, model: 'jev-1.14.0' });
    expect(Number(row!.costUsd)).toBeCloseTo(0.00021, 5);
    expect((row!.answers as { fields: Record<string, { pick: string }> }).fields.price!.pick).toBe('c1');
    expect(client.calls).toHaveLength(1);
    expect(JSON.stringify(client.calls[0]!.questions)).not.toMatch(/screenshot-ref|<screenshot>/);
  });

  it('fired: the injected client gets one request with the topmost candidate tile, and the row ends done', async () => {
    const client = fakeClient();
    const r = await startJevReading({ sourceId, captureId, url: 'https://s.example/p/1', title: 'x', capture, boxes }, { client, env: ON });
    expect(r.readingId).not.toBeNull();
    await vi.waitFor(async () => {
      expect((await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, r.readingId!) }))!.status).toBe('done');
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.image.toString()).toBe('tile1');
  });

  it('a second start for the same capture is "exists"', async () => {
    const client = fakeClient();
    await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client, env: ON, fire: false });
    expect((await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client, env: ON, fire: false })).reason).toBe('exists');
  });

  it('one retry, then failed with the error; nothing else written', async () => {
    const client = fakeClient(undefined, 2);
    const r = await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client, env: ON, fire: false });
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }], capture, boxes, tileHeights: [1536] })!;
    await runJevReading(r.readingId!, built, Buffer.from('t'), client);
    expect(client.calls).toHaveLength(2);
    const row = await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, r.readingId!) });
    expect(row).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('a timeout is a failure', async () => {
    const slow: JevClient = { ask: () => new Promise(() => {}) };
    const r = await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client: slow, env: ON, fire: false });
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }], capture, boxes, tileHeights: [1536] })!;
    await runJevReading(r.readingId!, built, Buffer.from('t'), slow, { timeoutMs: 20 });
    const row = await db.query.jevReadings.findFirst({ where: eq(jevReadings.id, r.readingId!) });
    expect(row).toMatchObject({ status: 'failed', error: 'timed out after 20 ms' });
  });

  it('runJevReading writes only its own row', async () => {
    const before = await db.query.sourceVerifications.findMany({ where: eq(sourceVerifications.sourceId, sourceId) });
    const src = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });
    const cap = await db.query.captures.findFirst({ where: eq(captures.id, captureId) });
    const r = await startJevReading({ sourceId, captureId, url: 'u', title: 'x', capture, boxes }, { client: fakeClient(), env: ON, fire: false });
    const built = buildJevRequest({ title: 'x', fields: [{ key: 'price', name: 'Price', type: 'money', concept: 'price' }], capture, boxes, tileHeights: [1536] })!;
    await runJevReading(r.readingId!, built, Buffer.from('t'), fakeClient());
    expect(await db.query.sourceVerifications.findMany({ where: eq(sourceVerifications.sourceId, sourceId) })).toEqual(before);
    expect(await db.query.sources.findFirst({ where: eq(sources.id, sourceId) })).toEqual(src);
    expect(await db.query.captures.findFirst({ where: eq(captures.id, captureId) })).toEqual(cap);
  });
});
