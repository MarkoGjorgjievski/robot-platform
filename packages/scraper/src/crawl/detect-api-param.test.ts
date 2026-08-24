import { describe, it, expect } from 'vitest';
import type { IBrowser, InterceptedRequest, PageCapture } from '@robot/browser';
import { detectApiParam } from './detect-api-param.js';

const PAGE1 = Array.from({ length: 10 }, (_, i) => `https://x.example/p/10000${i}`);
const PAGE2 = Array.from({ length: 10 }, (_, i) => `https://x.example/p/20000${i}`);

const endpoint = 'https://x.example/api/search?kn=py&offset=0&ds=1';

function capture(requests: InterceptedRequest[]): PageCapture {
  return { url: 'https://x.example/list', html: '', interceptedRequests: requests } as unknown as PageCapture;
}

function apiRequest(urls: string[]): InterceptedRequest {
  const json = { results: urls.map((u) => ({ link: u })) };
  return {
    url: endpoint, method: 'GET', resourceType: 'xhr', responseStatus: 200,
    responseHeaders: {}, responseBody: JSON.stringify(json), contentType: 'application/json',
    bodySize: 100, isJson: true, parsedJson: json, timestamp: 0,
  };
}

/** A browser whose in-page fetch answers from a fixed map of url → item URLs. */
function fakeBrowser(byUrl: Record<string, string[]>): IBrowser {
  return {
    evaluate: async (_pageUrl: string, script: string) => {
      const urls: string[] = JSON.parse(script.match(/const urls = (\[.*?\]);/s)![1]!);
      return urls.map((url) => ({
        url,
        status: 200,
        json: byUrl[url] ? { results: byUrl[url]!.map((u) => ({ link: u })) } : { results: [] },
        error: null,
      }));
    },
  } as unknown as IBrowser;
}

describe('detectApiParam', () => {
  it('accepts a parameter whose probe returns a genuinely different page', async () => {
    const browser = fakeBrowser({ 'https://x.example/api/search?kn=py&offset=10&ds=1': PAGE2 });

    const result = await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser);

    expect(result?.config.strategy).toBe('api-param');
    expect(result?.config.paramName).toBe('offset');
    expect(result?.config.step).toBe(10);
    expect(result?.config.apiTemplate).toBe('https://x.example/api/search?kn=py&offset={N}&ds=1');
    expect(result?.config.itemsPath).toBe('results');
    expect(result?.config.urlPath).toBe('link');
  });

  it('REJECTS a parameter whose probe returns page 1 again', async () => {
    // The AbeBooks bug, as a test — and the fixture has to make every probe come
    // back FULL of page 1's items, not empty. An empty probe is rejected earlier,
    // by the `probeIds.length === 0` check, so a fixture that returns nothing
    // would pass this test with the overlap guard deleted. It must be the overlap
    // guard, and only the overlap guard, that says no here.
    const browser = fakeBrowser({
      'https://x.example/api/search?kn=py&offset=10&ds=1': PAGE1,
      'https://x.example/api/search?kn=py&offset=1&ds=1': PAGE1,
    });

    expect(await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser)).toBeNull();
  });

  it('answers null when every probe comes back empty', async () => {
    // The neighbouring guard, kept honest separately: an endpoint that returns no
    // items for the next page tells us nothing, and must not be read as "verified".
    const browser = fakeBrowser({});

    expect(await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser)).toBeNull();
  });

  it('falls back to the other step for the same parameter before discarding it', async () => {
    // offset+10 (the page size) returns page 1 again; offset+1 is what this
    // (unusual) API actually wants. The parameter is right; the step was not.
    const browser = fakeBrowser({
      'https://x.example/api/search?kn=py&offset=10&ds=1': PAGE1,
      'https://x.example/api/search?kn=py&offset=1&ds=1': PAGE2,
    });

    const result = await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser);

    expect(result?.config.paramName).toBe('offset');
    expect(result?.config.step).toBe(1);
  });

  it('answers null when no intercepted response is the listing API', async () => {
    expect(await detectApiParam(capture([]), PAGE1, fakeBrowser({}))).toBeNull();
  });

  it('answers null when the page context fails entirely', async () => {
    const broken = { evaluate: async () => { throw new Error('nav failed'); } } as unknown as IBrowser;
    expect(await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, broken)).toBeNull();
  });
});
