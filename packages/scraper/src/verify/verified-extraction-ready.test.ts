// packages/scraper/src/verify/verified-extraction-ready.test.ts
// A certified run waits for the values it needs, not for the page to go quiet.
//
// runVerifiedExtraction knows every path it will evaluate, so it hands the
// browser a ready check built from them: the capture polls the live page and
// returns as soon as every field with a certified path resolves, instead of
// sitting out a 60 s networkidle timeout on a site that never goes idle
// (Ikea, measured 2026-09-15: 69.8 s → 7.0 s for the same data). It also
// takes the per-domain politeness lock, which the certified path used to
// bypass. No Chromium here: the browser is a fake that records what it was
// asked for.

import { describe, it, expect } from 'vitest';
import type { IBrowser, PageCapture, ReadySnapshot } from '@robot/browser';
import { buildReadyCheck, runVerifiedExtraction, type VerifiedField } from './verified-extraction.js';

const PRICE: VerifiedField = {
  key: 'price', type: 'money', concept: 'price',
  paths: [{ source: 'api', path: 'item.priceCents', transform: 'cents_to_units' }],
};
const NAME: VerifiedField = {
  key: 'product_name', type: 'text', concept: 'product_name',
  paths: [{ source: 'json-ld', path: 'name', transform: 'identity' }],
};
const IMAGE: VerifiedField = {
  key: 'image', type: 'image', concept: 'image_url',
  paths: [{ source: 'xpath', path: '//*[@id="main"]/img/@src', transform: 'identity' }],
};
const UNCERTIFIED: VerifiedField = { key: 'ghost', type: 'text', concept: 'ghost', paths: [] };
const PAGE_URL = 'https://shop.example/p/1';

const EMPTY_STRUCTURED = { ldJson: [], nextData: null, initialState: null, meta: {} };

function snapshot(over: Partial<ReadySnapshot> = {}): ReadySnapshot {
  return { probe: {}, structuredData: EMPTY_STRUCTURED, interceptedRequests: [], ...over };
}

function apiRequest(body: unknown): PageCapture['interceptedRequests'][number] {
  return {
    url: 'https://shop.example/api/p/1', method: 'GET', resourceType: 'fetch', responseStatus: 200, responseHeaders: {},
    responseBody: JSON.stringify(body), contentType: 'application/json', bodySize: 100, isJson: true, parsedJson: body, timestamp: 0,
  };
}

describe('buildReadyCheck', () => {
  it('probes every distinct certified xpath in the live page', () => {
    const check = buildReadyCheck([IMAGE, { ...IMAGE, key: 'image2' }, PRICE], PAGE_URL);
    const escaped = JSON.stringify('//*[@id="main"]/img/@src');
    expect(check.script).toContain(escaped);
    expect(check.script.split(escaped).length - 1).toBe(1);
  });

  it('is not ready while any field with a certified path is still unresolved', () => {
    const check = buildReadyCheck([PRICE, NAME, IMAGE], PAGE_URL);
    // Only the API has arrived: name and image are still missing.
    expect(check.isReady(snapshot({ interceptedRequests: [apiRequest({ item: { priceCents: 12999 } })] }))).toBe(false);
  });

  it('is ready once every field with a certified path resolves to a value', () => {
    const check = buildReadyCheck([PRICE, NAME, IMAGE, UNCERTIFIED], PAGE_URL);
    const ready = snapshot({
      probe: { '//*[@id="main"]/img/@src': 'https://shop.example/img/a.jpg' },
      structuredData: { ...EMPTY_STRUCTURED, ldJson: [{ name: 'Widget A' }] },
      interceptedRequests: [apiRequest({ item: { priceCents: 12999 } })],
    });
    // The field with no certified path cannot block readiness: nothing will ever fill it.
    expect(check.isReady(ready)).toBe(true);
  });

  it('a placeholder that fails the field type does not count as ready', () => {
    const check = buildReadyCheck([PRICE], PAGE_URL);
    // The API answered, but with a value the money type rejects — the page is still hydrating.
    expect(check.isReady(snapshot({ interceptedRequests: [apiRequest({ item: { priceCents: 'loading' } })] }))).toBe(false);
  });

  it('a field with more than one certified path is ready when any one of them resolves', () => {
    const twoPaths: VerifiedField = { ...NAME, paths: [NAME.paths[0]!, { source: 'meta', path: 'og:title', transform: 'identity' }] };
    const check = buildReadyCheck([twoPaths], PAGE_URL);
    expect(check.isReady(snapshot({ structuredData: { ...EMPTY_STRUCTURED, meta: { 'og:title': 'Widget A' } } }))).toBe(true);
  });
});

function fakeBrowser(capture: PageCapture, log: string[]): IBrowser & { captureOptions: unknown[] } {
  const b = {
    captureOptions: [] as unknown[],
    async launch() {},
    async close() {},
    async capture(_url: string, options?: unknown) { log.push('capture'); b.captureOptions.push(options); return capture; },
    async evaluate<T>() { return null as T; },
    async setContentEvaluate<T>() { return {} as T; },
  };
  return b as unknown as IBrowser & { captureOptions: unknown[] };
}

const CAPTURE: PageCapture = {
  url: 'https://shop.example/p/1', html: '<html></html>', markdown: '', screenshot: Buffer.alloc(0), screenshotTiles: [], verdict: { kind: 'ok', status: 200 },
  title: '', timestamp: 0, structuredData: { ...EMPTY_STRUCTURED, ldJson: [{ name: 'Widget A' }] }, interceptedRequests: [],
  timings: { navigateMs: 1200, readyMs: 300, readyState: 'ready', totalMs: 1900 },
};

describe('runVerifiedExtraction — capture options and the politeness lock', () => {
  it('captures with `load` plus a ready check built from the certified paths, never networkidle', async () => {
    const browser = fakeBrowser(CAPTURE, []);
    await runVerifiedExtraction({ url: CAPTURE.url, fields: [NAME] }, { browser, acquireLock: async () => () => {} });
    const [opts] = browser.captureOptions as Array<{ waitUntil: string; ready?: { isReady: (s: ReadySnapshot) => boolean } }>;
    expect(opts.waitUntil).toBe('load');
    expect(opts.ready?.isReady(snapshot({ structuredData: CAPTURE.structuredData }))).toBe(true);
    expect(opts.ready?.isReady(snapshot())).toBe(false);
  });

  it('holds the domain lock around the capture and releases it after', async () => {
    const log: string[] = [];
    const browser = fakeBrowser(CAPTURE, log);
    const acquireLock = async (domain: string) => { log.push(`lock ${domain}`); return () => { log.push('release'); }; };
    await runVerifiedExtraction({ url: CAPTURE.url, fields: [NAME] }, { browser, acquireLock });
    expect(log).toEqual(['lock shop.example', 'capture', 'release']);
  });

  it('releases the lock even when the capture throws', async () => {
    const log: string[] = [];
    const browser = fakeBrowser(CAPTURE, log);
    browser.capture = async () => { throw new Error('blocked'); };
    const acquireLock = async () => { log.push('lock'); return () => { log.push('release'); }; };
    await expect(runVerifiedExtraction({ url: CAPTURE.url, fields: [NAME] }, { browser, acquireLock })).rejects.toThrow('blocked');
    expect(log).toEqual(['lock', 'release']);
  });

  it('an injected capture skips both the lock and the browser: nothing touches the network', async () => {
    const log: string[] = [];
    const browser = fakeBrowser(CAPTURE, log);
    const acquireLock = async () => { log.push('lock'); return () => { log.push('release'); }; };
    const result = await runVerifiedExtraction({ url: CAPTURE.url, fields: [NAME] }, { browser, capture: CAPTURE, acquireLock });
    expect(log).toEqual([]);
    expect(result.data.product_name).toBe('Widget A');
  });

  it('reports the capture timings so the run can record them per product', async () => {
    const browser = fakeBrowser(CAPTURE, []);
    const result = await runVerifiedExtraction({ url: CAPTURE.url, fields: [NAME] }, { browser, acquireLock: async () => () => {} });
    expect(result.timings).toEqual(CAPTURE.timings);
  });
});
