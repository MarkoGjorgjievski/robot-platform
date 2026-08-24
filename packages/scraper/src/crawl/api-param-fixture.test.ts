// Tier 1: does api-param actually work against a real origin?
//
// The unit tests fake the fetch. This one serves a listing page and its JSON API
// over real HTTP and drives real Chromium, so the in-page fetch, the credentials
// and the same-origin behaviour are the real ones.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { serveFixturePages, type ServedSite } from '../__fixtures__/serve.js';
import { detectApiParam } from './detect-api-param.js';

const PAGE1 = ['/p/1000001', '/p/1000002', '/p/1000003', '/p/1000004'];
const PAGE2 = ['/p/2000001', '/p/2000002', '/p/2000003', '/p/2000004'];

const body = (urls: string[]) => JSON.stringify({ results: urls.map((u) => ({ link: u })) });

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages([
    { path: '/list', html: '<html><body>listing</body></html>' },
    { path: '/api?kn=py&offset=0', html: body(PAGE1), contentType: 'application/json' },
    { path: '/api?kn=py&offset=4', html: body(PAGE2), contentType: 'application/json' },
    // The wrong-step probe: offset bumped by 1 re-serves page 1's window.
    { path: '/api?kn=py&offset=1', html: body(PAGE1), contentType: 'application/json' },
  ]);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); } finally { await site?.close(); }
});

describe('api-param against a real origin', () => {
  it('verifies the paging parameter by fetching, in the page, over real HTTP', async () => {
    const capture = {
      url: `${site.baseUrl}/list`,
      html: '',
      interceptedRequests: [{
        url: `${site.baseUrl}/api?kn=py&offset=0`,
        method: 'GET', resourceType: 'xhr', responseStatus: 200, responseHeaders: {},
        responseBody: body(PAGE1), contentType: 'application/json', bodySize: 100,
        isJson: true, parsedJson: JSON.parse(body(PAGE1)), timestamp: 0,
      }],
    } as unknown as Parameters<typeof detectApiParam>[0];

    const result = await detectApiParam(capture, PAGE1, browser);

    expect(result?.config.paramName).toBe('offset');
    expect(result?.config.step).toBe(4);
    expect(result?.config.apiTemplate).toBe(`${site.baseUrl}/api?kn=py&offset={N}`);
    // The probe really was fetched from the page, not from Node.
    expect(site.requests).toContain('/api?kn=py&offset=4');
  }, 60_000);
});
