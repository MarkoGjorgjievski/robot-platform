// Tier 1: does api-param actually work against a real origin?
//
// The unit tests fake the fetch. This one serves a listing page and its JSON API
// over real HTTP and drives real Chromium, so the in-page fetch, the credentials
// and the same-origin behaviour are the real ones.
//
// The API is COOKIE-GATED, and that is the whole point of the fixture.
// `site.requests` logs every request that reaches the loopback server no matter
// who sent it, so a Node-side `fetch()` to the same address would log
// identically and return identical JSON — this gate would have passed unchanged
// if `fetchInPage` ever regressed to Node's global fetch, and dropping
// `credentials: 'include'` was equally invisible. Serving the session cookie
// from `/list` and demanding it back on `/api` fixes both at once: only a fetch
// issued from the page that was navigated to `/list` has that cookie, so
// verification succeeding is itself the proof that the fetch ran in the page,
// same-origin, with credentials.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { serveFixturePages, type ServedSite } from '../__fixtures__/serve.js';
import { detectApiParam } from './detect-api-param.js';
import { fetchInPage } from './api-param-fetch.js';

const PAGE1 = ['/p/1000001', '/p/1000002', '/p/1000003', '/p/1000004'];
const PAGE2 = ['/p/2000001', '/p/2000002', '/p/2000003', '/p/2000004'];

const body = (urls: string[]) => JSON.stringify({ results: urls.map((u) => ({ link: u })) });

/** Handed out by /list, demanded by /api. Never reachable from Node. */
const SESSION = 'sid=fixture-session';
/** Serve this API page, but only to a caller carrying the session cookie. */
const gated = (path: string, urls: string[]) => ({
  path,
  html: body(urls),
  contentType: 'application/json',
  requireCookie: SESSION,
  // A well-formed but item-less 401, so a cookie-less caller fails on the
  // status/emptiness guards rather than on a parse error — the failure mode a
  // real gated API produces, not a synthetic one.
  deniedStatus: 401,
  deniedBody: JSON.stringify({ results: [] }),
});

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages([
    { path: '/list', html: '<html><body>listing</body></html>', setCookie: `${SESSION}; Path=/` },
    gated('/api?kn=py&offset=0', PAGE1),
    gated('/api?kn=py&offset=4', PAGE2),
    // No decoy at offset=1. It used to sit here described as "the wrong-step
    // probe", but it never played that role: an offset-style parameter implies a
    // step of one page size, so `offset+4` ranks FIRST, verifies, and the loop
    // returns before `offset+1` is ever inspected. Step fallback is covered by
    // detect-api-param.test.ts, "falls back to the other step for the same
    // parameter before discarding it", where the ranking is arranged to reach it.
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
    // The probe really was fetched from the page, not from Node — and this is
    // now load-bearing rather than decorative: /api serves items ONLY to a
    // caller carrying the cookie /list handed out, and nothing outside the
    // browser context has it. Verification above therefore cannot happen from
    // Node, and cannot happen with credentials omitted.
    expect(site.requests).toContain('/api?kn=py&offset=4');

    // Said directly, so a future reader does not have to infer it from a
    // config assertion three lines up.
    const probeIndex = site.requests.indexOf('/api?kn=py&offset=4');
    expect(site.requestHeaders[probeIndex]?.cookie).toContain(SESSION);
  }, 60_000);

  it('a cookie-less caller — i.e. Node — gets nothing from the same endpoint', async () => {
    // The gate above only has teeth if the cookie is genuinely what stands
    // between a caller and the data. Node's fetch reaches the identical URL on
    // the identical origin and is refused, which is exactly what would happen
    // if fetchInPage stopped going through the page.
    const res = await fetch(`${site.baseUrl}/api?kn=py&offset=4`);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ results: [] });
  }, 60_000);
});

/**
 * The same cookie gate, with the API on a SECOND loopback port.
 *
 * Why a second port matters: the same-origin fixture above cannot tell
 * `credentials: 'include'` from `credentials: 'same-origin'` — both attach the
 * cookie when the fetch target is the page's own origin, so mutating the real
 * fetch to `'same-origin'` leaves that gate green. And an API on its own host
 * (`api.<site>` fronting `www.<site>`) is the shape that actually matters on
 * real sites.
 *
 * Two ports on 127.0.0.1 are different ORIGINS — CORS applies, and the API must
 * echo the caller's origin with `Allow-Credentials` — but the same SITE for
 * cookies, which ignore the port. So the cookie is in the jar and only
 * `'include'` will send it.
 */
describe('api-param across origins', () => {
  let api: ServedSite;

  beforeAll(async () => {
    api = await serveFixturePages([{ ...gated('/api?kn=py&offset=4', PAGE2), cors: true }]);
  }, 60_000);

  afterAll(async () => { await api?.close(); });

  it('fetches a cross-origin API with the listing page cookies', async () => {
    const target = `${api.baseUrl}/api?kn=py&offset=4`;

    const bodies = await fetchInPage(browser, `${site.baseUrl}/list`, [target]);

    expect(bodies).toHaveLength(1);
    // A cookie-less caller gets 401 + an empty results array (see `gated`), so
    // these three assertions are exactly the difference `credentials` makes.
    expect(bodies[0]?.error).toBeNull();
    expect(bodies[0]?.status).toBe(200);
    expect((bodies[0]?.json as { results: unknown[] }).results).toHaveLength(PAGE2.length);
    // And the cookie really was what got it in.
    const index = api.requests.indexOf('/api?kn=py&offset=4');
    expect(api.requestHeaders[index]?.cookie).toContain(SESSION);
  }, 60_000);
});
