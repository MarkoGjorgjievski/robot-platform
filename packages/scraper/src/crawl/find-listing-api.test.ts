import { describe, it, expect } from 'vitest';
import type { InterceptedRequest } from '@robot/browser';
import { findListingApi, MAX_ITEMS_SCANNED } from './find-listing-api.js';

const PAGE1 = Array.from({ length: 10 }, (_, i) => `https://x.example/p/10000${i}`);

function req(url: string, json: unknown, over: Partial<InterceptedRequest> = {}): InterceptedRequest {
  return {
    url, method: 'GET', resourceType: 'xhr', responseStatus: 200,
    responseHeaders: {}, responseBody: JSON.stringify(json), contentType: 'application/json',
    bodySize: 100, isJson: true, parsedJson: json, timestamp: 0, ...over,
  };
}

const listingApi = req('https://x.example/api/search?q=py&offset=0', {
  results: PAGE1.map((u) => ({ link: u, title: 'x' })),
});

/** The Nike shape: a real endpoint that legitimately carries a couple of the same ids. */
const recommendations = req('https://x.example/api/recs', {
  items: [{ link: PAGE1[0] }, { link: PAGE1[1] }, { link: 'https://x.example/p/999999' }],
});

describe('findListingApi', () => {
  it('picks the endpoint carrying page 1 URLs and reports where they live', () => {
    const match = findListingApi([recommendations, listingApi], PAGE1);
    expect(match?.request.url).toBe(listingApi.url);
    expect(match?.itemsPath).toBe('results');
    expect(match?.urlPath).toBe('link');
    expect(match?.matched).toBe(10);
  });

  it('does NOT pick a recommendations blob that shares a couple of ids', () => {
    // This is the c606a54 case. Two of ten is a coincidence, not a listing.
    expect(findListingApi([recommendations], PAGE1)).toBeNull();
  });

  it('requires a minimum COUNT, so a tiny listing cannot qualify a widget', () => {
    // 2 of 2 is a 100% share but only two matches — below API_MATCH_MIN_COUNT.
    const twoUrls = PAGE1.slice(0, 2);
    const widget = req('https://x.example/api/w', { items: twoUrls.map((u) => ({ link: u })) });
    expect(findListingApi([widget], twoUrls)).toBeNull();
  });

  it('ignores non-GET, non-JSON and non-2xx responses', () => {
    const posted = req(listingApi.url, { results: PAGE1.map((u) => ({ link: u })) }, { method: 'POST' });
    const failed = req(listingApi.url, { results: PAGE1.map((u) => ({ link: u })) }, { responseStatus: 500 });
    const notJson = req(listingApi.url, null, { isJson: false, parsedJson: null });
    expect(findListingApi([posted, failed, notJson], PAGE1)).toBeNull();
  });

  it('rejects a response flagged non-JSON even when parsedJson is populated', () => {
    // Playwright's capture never produces this combination — it only ever sets
    // isJson: true alongside a populated parsedJson — but findListingApi is a
    // pure function whose contract is GET/JSON/2xx, and it must not rely on
    // caller discipline to hold. A body that carries every page-1 URL must
    // still be rejected on isJson alone.
    const inconsistent = req(
      'https://x.example/api/inconsistent',
      { results: PAGE1.map((u) => ({ link: u })) },
      { isJson: false },
    );
    expect(findListingApi([inconsistent], PAGE1)).toBeNull();
  });

  it('finds items nested under a wrapper object', () => {
    const nested = req('https://x.example/api/s?page=1', {
      data: { products: PAGE1.map((u) => ({ href: u })) },
    });
    const match = findListingApi([nested], PAGE1);
    expect(match?.itemsPath).toBe('data.products');
    expect(match?.urlPath).toBe('href');
  });

  it('prefers the higher-share candidate when two qualify', () => {
    const partial = req('https://x.example/api/a', { results: PAGE1.slice(0, 6).map((u) => ({ link: u })) });
    const full = req('https://x.example/api/b', { results: PAGE1.map((u) => ({ link: u })) });
    expect(findListingApi([partial, full], PAGE1)?.request.url).toBe(full.url);
  });

  it('does not scan past MAX_ITEMS_SCANNED items in a single array', () => {
    // All ten of page 1's identifiers sit just past the cap; the scanned range
    // holds only filler, so the cap is what keeps this from matching. If the
    // cap were silently dropped, this candidate would match 10/10 and win.
    const filler = Array.from({ length: MAX_ITEMS_SCANNED }, (_, i) => ({
      link: `https://x.example/f/filler-item-${i}`,
    }));
    const buried = req('https://x.example/api/huge', {
      results: [...filler, ...PAGE1.map((u) => ({ link: u }))],
    });
    expect(findListingApi([buried], PAGE1)).toBeNull();
  });

  it('rejects a big sidebar that clears the count bar but not the share bar', () => {
    // 4 of 10 is above API_MATCH_MIN_COUNT and below API_MATCH_MIN_SHARE, so
    // this is the ONLY case that isolates the share bar. Without it MIN_SHARE
    // could be deleted and every other test would stay green — and the bar
    // exists for the case the count bar structurally cannot catch: a large
    // listing whose sidebar legitimately carries a few of the same products.
    const sidebar = req('https://x.example/api/side', {
      items: [
        ...PAGE1.slice(0, 4).map((u) => ({ link: u })),
        { link: 'https://x.example/p/888881' },
        { link: 'https://x.example/p/888882' },
      ],
    });
    expect(findListingApi([sidebar], PAGE1)).toBeNull();
  });
});
