// packages/scraper/src/verify/verification-ready.test.ts
// Verification waits for the customer's expected values, not for the page to go quiet.
//
// A proof-page capture used to wait for networkidle, which a site that holds a
// connection open never reaches: Ikea paid the full 60 s timeout on every proof
// page (four pages, 346 s, 2026-09-17). Verification does not know any paths
// yet, but it knows what it is looking for: the values the customer typed. The
// page is ready once every one of them can be found, by the same two searches
// verification runs afterwards: the DOM search (already a page script) and the
// structured search over JSON-LD, meta tags and API responses.

import { describe, it, expect } from 'vitest';
import type { PageCapture, ReadySnapshot } from '@robot/browser';
import { buildVerificationReadyCheck, VERIFY_GRACE_QUIET_MS, VERIFY_GRACE_MAX_MS } from './verification-ready.js';
import type { SchemaDefinitionField } from './types.js';

const URL = 'https://shop.example/p/1';
const fields: SchemaDefinitionField[] = [
  { key: 'price', name: 'Price', type: 'money', description: 'green number', concept: 'price' },
  { key: 'title', name: 'Title', type: 'text', description: 'heading', concept: 'product_name' },
  { key: 'rating', name: 'Rating', type: 'number', description: 'stars', concept: 'rating' },
];
const expected = { price: '129.99', title: 'Widget A', rating: '4.5' };

const EMPTY = { ldJson: [], nextData: null, initialState: null, meta: {} };
const snap = (over: Partial<ReadySnapshot> = {}): ReadySnapshot => ({ probe: [], structuredData: EMPTY, interceptedRequests: [], ...over });
const domHit = (key: string) => ({ key, xpath: `//*[@id="${key}"]`, raw: 'x' });
function apiRequest(body: unknown): PageCapture['interceptedRequests'][number] {
  return {
    url: 'https://shop.example/api/p/1', method: 'GET', resourceType: 'fetch', responseStatus: 200, responseHeaders: {},
    responseBody: '{}', contentType: 'application/json', bodySize: 2, isJson: true, parsedJson: body, timestamp: 0,
  };
}

describe('buildVerificationReadyCheck', () => {
  it('polls after the expand round and takes a short grace once ready', () => {
    const check = buildVerificationReadyCheck(fields, expected, URL);
    expect(check.when).toBe('after-expand');
    expect(check.graceQuietMs).toBe(VERIFY_GRACE_QUIET_MS);
    expect(check.graceMaxMs).toBe(VERIFY_GRACE_MAX_MS);
  });

  it('its probe is the DOM search for exactly the values typed on this page', () => {
    const check = buildVerificationReadyCheck(fields, { price: '129.99', title: 'Widget A', rating: '  ' }, URL);
    expect(check.script).toContain('"expected":"129.99"');
    expect(check.script).toContain('"expected":"Widget A"');
    // A blank cell (pages four to six) is "not checked here": nothing to wait for.
    expect(check.script).not.toContain('"key":"rating"');
  });

  it('is not ready while any typed value is still nowhere to be found', () => {
    const check = buildVerificationReadyCheck(fields, expected, URL);
    expect(check.isReady(snap({ probe: [domHit('price'), domHit('title')] }))).toBe(false);
  });

  it('a value counts as found in the page OR in the data', () => {
    const check = buildVerificationReadyCheck(fields, expected, URL);
    const ready = snap({
      probe: [domHit('title')],                                                   // title: visible in the page
      structuredData: { ...EMPTY, ldJson: [{ offers: { price: '129.99' } }] },     // price: in JSON-LD
      interceptedRequests: [apiRequest({ item: { rating: 4.5 } })],               // rating: in an API response
    });
    expect(check.isReady(ready)).toBe(true);
  });

  it('a value in the data with the wrong content does not count', () => {
    const check = buildVerificationReadyCheck(fields, expected, URL);
    const wrong = snap({
      probe: [domHit('title'), domHit('rating')],
      structuredData: { ...EMPTY, ldJson: [{ offers: { price: '999.00' } }] },
    });
    expect(check.isReady(wrong)).toBe(false);
  });

  it('remembers what it has found: a value seen on one poll still counts on the next', () => {
    // The structured search walks every API body; once a field is found there is no need to look again,
    // and a node that scrolls out of a virtualised list must not un-ready the page.
    const check = buildVerificationReadyCheck(fields, expected, URL);
    expect(check.isReady(snap({ probe: [domHit('price'), domHit('title')] }))).toBe(false);
    expect(check.isReady(snap({ probe: [domHit('rating')] }))).toBe(true);
  });

  it('with nothing typed on this page there is nothing to wait for', () => {
    expect(buildVerificationReadyCheck(fields, {}, URL).isReady(snap())).toBe(true);
  });

  it('a probe that failed in the page (null) is simply no hits', () => {
    const check = buildVerificationReadyCheck(fields, expected, URL);
    expect(check.isReady(snap({ probe: null }))).toBe(false);
  });
});
