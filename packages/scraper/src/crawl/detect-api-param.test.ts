import { describe, it, expect } from 'vitest';
import type { IBrowser, InterceptedRequest, PageCapture } from '@robot/browser';
import { detectApiParam } from './detect-api-param.js';

const PAGE1 = Array.from({ length: 10 }, (_, i) => `https://x.example/p/10000${i}`);
const PAGE2 = Array.from({ length: 10 }, (_, i) => `https://x.example/p/20000${i}`);
const PAGE3 = Array.from({ length: 10 }, (_, i) => `https://x.example/p/30000${i}`);

const endpoint = 'https://x.example/api/search?kn=py&offset=0&ds=1';

function capture(requests: InterceptedRequest[]): PageCapture {
  return { url: 'https://x.example/list', html: '', interceptedRequests: requests } as unknown as PageCapture;
}

function apiRequest(urls: string[], url = endpoint): InterceptedRequest {
  const json = { results: urls.map((u) => ({ link: u })) };
  return {
    url, method: 'GET', resourceType: 'xhr', responseStatus: 200,
    responseHeaders: {}, responseBody: JSON.stringify(json), contentType: 'application/json',
    bodySize: 100, isJson: true, parsedJson: json, timestamp: 0,
  };
}

/** Per-URL override of a probe response — anything omitted defaults sensibly. */
type ProbeOverride = { urls?: string[]; status?: number; error?: string | null };

/**
 * A browser whose in-page fetch answers from a fixed map of url → item URLs, or
 * (for Fix 4's guards) a full override of status/error/urls per probe URL.
 *
 * The override intentionally does NOT mirror `api-param-fetch.ts`'s real
 * invariant that `error !== null` implies `json === null` — it lets a test set
 * both independently, so the `error !== null` guard and the `json === null`
 * guard in `detect-api-param.ts` can each be proven load-bearing on their own,
 * rather than one masking the other.
 */
function fakeBrowser(byUrl: Record<string, string[] | ProbeOverride>): IBrowser {
  return {
    evaluate: async (_pageUrl: string, script: string) => {
      const urls: string[] = JSON.parse(script.match(/const urls = (\[.*?\]);/s)![1]!);
      return urls.map((url) => {
        const entry = byUrl[url];
        if (entry === undefined) return { url, status: 200, json: { results: [] }, error: null };
        if (Array.isArray(entry)) {
          return { url, status: 200, json: { results: entry.map((u) => ({ link: u })) }, error: null };
        }
        const { status = 200, error = null, urls: itemUrls } = entry;
        return { url, status, error, json: itemUrls ? { results: itemUrls.map((u) => ({ link: u })) } : null };
      });
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

  it('answers null rather than throwing when the matched endpoint URL is relative', async () => {
    // findListingApi never validates that a matched request's URL is absolute —
    // it matches on the JSON body's identifiers, which don't depend on the
    // endpoint's own URL shape. `rankCandidates` calls `new URL(endpointUrl)`
    // with no base, which throws on a relative URL. That must never escape
    // detection: it is an optimisation, and its contract is to fall through to
    // the HTML strategies, not to crash the caller.
    const relative = apiRequest(PAGE1, '/api/search?kn=py&offset=0&ds=1');
    const result = await detectApiParam(capture([relative]), PAGE1, fakeBrowser({}));
    expect(result).toBeNull();
  });

  it('prefers the name-implied step when more than one candidate would verify', async () => {
    // offset+10 (the page size — name-implied for an offset-style parameter) and
    // offset+1 both return genuinely different, non-overlapping pages here.
    // Nothing about the returned identifiers distinguishes a right answer from
    // a wrong one — only rank order says the first-ranked candidate wins.
    const browser = fakeBrowser({
      'https://x.example/api/search?kn=py&offset=10&ds=1': PAGE2,
      'https://x.example/api/search?kn=py&offset=1&ds=1': PAGE3,
    });

    const result = await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser);

    expect(result?.config.paramName).toBe('offset');
    expect(result?.config.step).toBe(10);
  });

  it('rejects a probe that comes back with a non-2xx status', async () => {
    // Would otherwise verify (a genuinely different, non-overlapping page) if
    // the status guard didn't reject it first.
    const browser = fakeBrowser({
      'https://x.example/api/search?kn=py&offset=10&ds=1': { status: 404, urls: PAGE2 },
    });

    expect(await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser)).toBeNull();
  });

  it('rejects a probe whose fetch resolved with an error', async () => {
    // Would otherwise verify (a genuinely different, non-overlapping page) if
    // the error guard didn't reject it first — status alone is fine here.
    const browser = fakeBrowser({
      'https://x.example/api/search?kn=py&offset=10&ds=1': { error: 'not json', urls: PAGE2 },
    });

    expect(await detectApiParam(capture([apiRequest(PAGE1)]), PAGE1, browser)).toBeNull();
  });
});
