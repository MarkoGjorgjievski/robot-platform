// The request-time browser procedures' bodies, as the worker runs them (spec 2026-10-23 §4.4).
// Moved here from sources-extract.test.ts with the bodies: the browser is stubbed, so nothing
// launches Chromium or reaches the network. The routers' tests keep one case each through the queue.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { reportVerdict, _resetBackoffForTests } from '@robot/scraper';
import { CaptureError, BROWSER_UNAVAILABLE } from '@robot/browser';
import { listingCheckNow, reachabilityNow, transferMarksNow, detectVariantsNow, variantLinksNearNow } from './interactive.js';

const { withBrowserSessionMock } = vi.hoisted(() => ({ withBrowserSessionMock: vi.fn() }));
vi.mock('../../browser-session.js', () => ({ withBrowserSession: withBrowserSessionMock }));

afterEach(() => {
  withBrowserSessionMock.mockReset();
  _resetBackoffForTests();
});

const NOWHERE = '00000000-0000-0000-0000-000000000000';

describe('listingCheckNow', () => {
  it('captures the listing page (no AI, loading more, the links read in the page) and reports product count, sample, and pagerSeen', async () => {
    const html = '<html><head><link rel="next" href="?page=2"></head><body></body></html>';
    const anchors = Array.from({ length: 12 }, (_, i) => ({ href: `/p/air-${i}-123456789012`, text: `Air ${i}`, levels: [{ d: 1, img: true, price: true, len: 30 }] }));
    const captureMock = vi.fn().mockResolvedValue({ html, verdict: { kind: 'ok', status: 200 }, annotation: { anchors, itemList: [] } });
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) => fn({ capture: captureMock }));

    const result = await listingCheckNow('https://test-check-listing.example.com/c/shoes');

    expect(result.productLinks).toBe(12);
    expect(result.pagerSeen).toBe(true);
    expect(result.sample).toHaveLength(10);
    expect(result.verdict).toEqual({ kind: 'ok', status: 200 });
    expect(result.message).toBeNull();
    expect(withBrowserSessionMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith('https://test-check-listing.example.com/c/shoes', expect.objectContaining({
      interceptNetworkRequests: false, timeout: 20_000, annotate: expect.any(String),
      loadMore: expect.objectContaining({ rounds: 3, enough: 60 }),
    }));
  });

  it('a page with no product cards counts no products', async () => {
    const anchors = [{ href: '/pages/terms', text: 'Terms' }, { href: '/collections/sofas', text: 'Sofas', levels: [{ d: 1, img: true, price: false, len: 5 }] }];
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: vi.fn().mockResolvedValue({ html: '<html></html>', verdict: { kind: 'ok', status: 200 }, annotation: { anchors, itemList: [] } }) }),
    );
    const result = await listingCheckNow('https://test-check-listing-none.example.com/c/x');
    expect(result).toMatchObject({ productLinks: 0, sample: [], products: [], message: null });
  });

  it('reports pagerSeen false when the captured page has no pagination markup', async () => {
    const anchors = [
      { href: '/p/air-1-123456789012', text: 'Air 1', levels: [{ d: 1, img: true, price: true, len: 30 }] },
      { href: '/p/air-2-123456789013', text: 'Air 2', levels: [{ d: 1, img: true, price: true, len: 30 }] },
    ];
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: vi.fn().mockResolvedValue({ html: '<html><body>no pager</body></html>', verdict: { kind: 'ok', status: 200 }, annotation: { anchors, itemList: [] } }) }),
    );
    const result = await listingCheckNow('https://test-check-listing-nopager.example.com/c/shoes');
    expect(result.productLinks).toBe(2);
    expect(result.pagerSeen).toBe(false);
  });

  it('a challenge page counts no links and says why', async () => {
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: vi.fn().mockResolvedValue({ html: '<html>captcha</html>', verdict: { kind: 'challenge', status: 403, vendor: 'datadome' }, annotation: { anchors: [{ href: '/p/1-2', text: 'x', levels: [{ d: 1, img: true, price: true, len: 3 }] }], itemList: [] } }) }),
    );
    const result = await listingCheckNow('https://test-check-listing-wall.example.com/c/shoes');
    expect(result.productLinks).toBe(0);
    expect(result.verdict.kind).toBe('challenge');
    expect(result.message).toBe("test-check-listing-wall.example.com asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check.");
  });

  it('no document at all (a CaptureError) is an answer, not a thrown error', async () => {
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: vi.fn().mockRejectedValue(new CaptureError('unreachable', 'https://test-check-listing-down.example.com/c/shoes', 'net::ERR_NAME_NOT_RESOLVED')) }),
    );
    const result = await listingCheckNow('https://test-check-listing-down.example.com/c/shoes');
    expect(result).toEqual({ verdict: { kind: 'unreachable' }, message: 'test-check-listing-down.example.com could not be reached (no response).', productLinks: 0, pagerSeen: false, sample: [], products: [] });
  });

  it('a host still backing off is answered from the backoff: no browser, the wall sentence and the wait (review I4)', async () => {
    reportVerdict('test-check-listing-backoff.example.com', { kind: 'refused', status: 403, vendor: 'cloudflare' });
    const result = await listingCheckNow('https://test-check-listing-backoff.example.com/c/shoes');
    expect(withBrowserSessionMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      verdict: { kind: 'refused', status: 403, vendor: 'cloudflare' },
      message: "test-check-listing-backoff.example.com refused the browser (HTTP 403, Cloudflare). We can't read this website from here yet. Waiting 2 min before trying again.",
      productLinks: 0, pagerSeen: false, sample: [], products: [],
    });
  });

  it('a wall it meets starts the backoff in the process that met it (the worker), so the next check opens no browser', async () => {
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: vi.fn().mockResolvedValue({ html: '<html>captcha</html>', verdict: { kind: 'challenge', status: 403, vendor: 'datadome' }, annotation: { anchors: [], itemList: [] } }) }),
    );
    await listingCheckNow('https://test-check-listing-walled.example.com/c/a');
    withBrowserSessionMock.mockClear();
    const again = await listingCheckNow('https://test-check-listing-walled.example.com/c/b');
    expect(withBrowserSessionMock).not.toHaveBeenCalled();
    expect(again.message).toMatch(/Waiting 2 min before trying again\.$/);
  });

  it('a browser that cannot launch at all is one sentence, not the raw Playwright exception (campaign 2, 2026-10-11)', async () => {
    withBrowserSessionMock.mockImplementation(async () => { throw new Error('browserType.launch: failed to launch. Call log: … hundreds of words …'); });
    const result = await listingCheckNow('https://test-check-listing-crash.example.com/c/shoes');
    expect(result).toEqual({ verdict: { kind: 'crashed' }, message: BROWSER_UNAVAILABLE, productLinks: 0, pagerSeen: false, sample: [], products: [] });
  });
});

describe('reachabilityNow', () => {
  it('one page load, one tile: the verdict, its sentence, the final url', async () => {
    const captureMock = vi.fn().mockResolvedValue({ url: 'https://www.test-reach.example.com/shop', html: '<html></html>', verdict: { kind: 'ok', status: 200 } });
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) => fn({ capture: captureMock }));
    const result = await reachabilityNow('https://www.test-reach.example.com/shop');
    expect(result).toMatchObject({ verdict: { kind: 'ok', status: 200 }, message: 'Reached test-reach.example.com (HTTP 200).', finalUrl: 'https://www.test-reach.example.com/shop' });
    expect(typeof result.ms).toBe('number');
    expect(captureMock).toHaveBeenCalledWith('https://www.test-reach.example.com/shop', expect.objectContaining({ waitUntil: 'load', timeout: 30_000, maxTiles: 1, interceptNetworkRequests: false }));
  });

  it('a CaptureError reads its sentence with no final url', async () => {
    withBrowserSessionMock.mockImplementation(async (fn: (browser: unknown) => Promise<unknown>) =>
      fn({ capture: vi.fn().mockRejectedValue(new CaptureError('timeout', 'https://test-reach-slow.example.com/x', 'Timeout 30000ms exceeded')) }),
    );
    const result = await reachabilityNow('https://test-reach-slow.example.com/x');
    expect(result).toMatchObject({ verdict: { kind: 'timeout' }, message: 'test-reach-slow.example.com did not answer in time.', finalUrl: null });
  });

  it('a host still backing off is answered without opening a browser', async () => {
    reportVerdict('test-reach-wall.example.com', 'challenge');
    const result = await reachabilityNow('https://test-reach-wall.example.com/x');
    expect(result.verdict).toEqual({ kind: 'challenge', status: 0 });
    expect(result.finalUrl).toBeNull();
    expect(result.message).toBe("test-reach-wall.example.com asked for a human check (CAPTCHA). Wait a few minutes and try again; pasting product pages won't help, they are behind the same check. Waiting 2 min before trying again."); // BACKOFF_FIRST_MS is 2 min
    expect(withBrowserSessionMock).not.toHaveBeenCalled();
  });

  it('after a refusal the waiting line reads the refusal, not a made-up human check (review I4)', async () => {
    reportVerdict('test-reach-refused.example.com', { kind: 'refused', status: 403, vendor: 'akamai' });
    const result = await reachabilityNow('https://test-reach-refused.example.com/x');
    expect(result.verdict).toEqual({ kind: 'refused', status: 403, vendor: 'akamai' });
    expect(result.message).toBe("test-reach-refused.example.com refused the browser (HTTP 403, Akamai). We can't read this website from here yet. Waiting 2 min before trying again.");
    expect(withBrowserSessionMock).not.toHaveBeenCalled();
  });

  it('a browser that cannot launch at all is one sentence, not the raw Playwright exception (campaign 2, 2026-10-11)', async () => {
    withBrowserSessionMock.mockImplementation(async () => { throw new Error('browserType.launch: failed to launch. Call log: … hundreds of words …'); });
    const result = await reachabilityNow('https://test-reach-broken.example.com/x');
    expect(result).toMatchObject({ verdict: { kind: 'crashed' }, message: BROWSER_UNAVAILABLE, finalUrl: null });
  });
});

// The website-bound bodies' fixtures (seeded proof-page captures, real Chromium) stay in their router
// files, which run them end to end through the queue; here, only what needs no website.
describe('the website-bound bodies', () => {
  it('a website that is not there is NOT_FOUND, with no browser opened', async () => {
    await expect(transferMarksNow({ sourceId: NOWHERE, fromUrl: 'https://x.test/p/1', toUrls: ['https://x.test/p/2'] })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(detectVariantsNow(NOWHERE)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(variantLinksNearNow({ sourceId: NOWHERE, url: 'https://x.test/p/1', xpath: '//a' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(withBrowserSessionMock).not.toHaveBeenCalled();
  });
});
