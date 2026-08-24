import { describe, it, expect } from 'vitest';
import type { IBrowser, InterceptedRequest, PageCapture } from '@robot/browser';
import { detectPagination, type PaginationAgent } from './detect-pagination.js';

const capture = (html: string, url = 'https://shop.example.com/s?q=x') =>
  ({ url, html } as unknown as PageCapture);

const PAGINATED = '<html><body><a rel="next" href="/s/more">Next</a></body></html>';
const PLAIN = '<html><body><div class="results"><p>one</p></div></body></html>';

// Fixture for the api-param rung — the 4th, optional parameter. Mirrors
// detect-api-param.test.ts's fixtures, kept local so this file's existing
// tests (which pass no 4th argument at all) are left completely undisturbed.
const API_PAGE1 = Array.from({ length: 10 }, (_, i) => `https://api-shop.example/p/10000${i}`);
const API_PAGE2 = Array.from({ length: 10 }, (_, i) => `https://api-shop.example/p/20000${i}`);
const API_ENDPOINT = 'https://api-shop.example/api/search?offset=0';

function apiCapture(): PageCapture {
  const json = { results: API_PAGE1.map((u) => ({ link: u })) };
  const request: InterceptedRequest = {
    url: API_ENDPOINT, method: 'GET', resourceType: 'xhr', responseStatus: 200,
    responseHeaders: {}, responseBody: JSON.stringify(json), contentType: 'application/json',
    bodySize: 100, isJson: true, parsedJson: json, timestamp: 0,
  } as InterceptedRequest;
  // No mechanical pagination markup and no agent below — anything other than
  // 'none'/'api-param' would mean a different tier answered first.
  return { url: 'https://api-shop.example/list', html: PLAIN, interceptedRequests: [request] } as unknown as PageCapture;
}

function apiFakeBrowser(): IBrowser {
  return {
    evaluate: async (_pageUrl: string, script: string) => {
      const urls: string[] = JSON.parse(script.match(/const urls = (\[.*?\]);/s)![1]!);
      return urls.map((url) => ({
        url,
        status: 200,
        json: url.includes('offset=10') ? { results: API_PAGE2.map((u) => ({ link: u })) } : { results: [] },
        error: null,
      }));
    },
  } as unknown as IBrowser;
}

const aiAgent = (result: Awaited<ReturnType<PaginationAgent['detectPagination']>>): PaginationAgent => ({
  async detectPagination() { return result; },
});

describe('detectPagination', () => {
  it('prefers a cached config over any detection', async () => {
    const cached = { strategy: 'url-pattern' as const, urlTemplate: 'https://x/p={N}' };
    const result = await detectPagination(capture(PAGINATED), null, cached);
    expect(result).toEqual({ config: cached, source: 'cache' });
  });

  it('uses mechanical detection when the markup declares pagination', async () => {
    const result = await detectPagination(capture(PAGINATED), null);
    expect(result.source).toBe('mechanical');
    expect(result.config?.strategy).toBe('next-button');
  });

  it('falls back to the AI when the markup declares nothing', async () => {
    const result = await detectPagination(
      capture(PLAIN),
      aiAgent({ has_pagination: true, strategy: 'url-pattern', url_template: 'https://shop.example.com/s?q=x&page={N}' }),
    );
    expect(result.source).toBe('ai');
    expect(result.config?.urlTemplate).toContain('{N}');
  });

  it('reports no pagination when the AI says there is none', async () => {
    const result = await detectPagination(capture(PLAIN), aiAgent({ has_pagination: false, strategy: 'none' }));
    expect(result).toEqual({ config: null, source: 'none' });
  });

  it('rejects an AI strategy that carries no way to act on it', async () => {
    const result = await detectPagination(capture(PLAIN), aiAgent({ has_pagination: true, strategy: 'next-button' }));
    expect(result.config).toBeNull();
  });

  it('treats a failing AI call as no pagination rather than losing the run', async () => {
    const failing: PaginationAgent = { async detectPagination() { throw new Error('rate limited'); } };
    const result = await detectPagination(capture(PLAIN), failing);
    expect(result).toEqual({ config: null, source: 'none' });
  });

  it('reports none when there is no markup and no agent', async () => {
    expect(await detectPagination(capture(PLAIN), null)).toEqual({ config: null, source: 'none' });
  });

  it('uses api-param as the first rung when a 4th argument supplies a browser and page 1 URLs', async () => {
    const result = await detectPagination(apiCapture(), null, null, {
      browser: apiFakeBrowser(),
      page1Urls: API_PAGE1,
    });
    expect(result.source).toBe('api-param');
    expect(result.config?.strategy).toBe('api-param');
    expect(result.config?.paramName).toBe('offset');
  });

  it('skips api-param entirely when the 4th argument is absent, even against a fixture that would verify', async () => {
    // Same capture that verifies api-param above — proving this isn't "the
    // fixture happens not to match", but that omitting the 4th argument truly
    // is inert, exactly as existing callers (that don't pass one) require.
    const result = await detectPagination(apiCapture(), null);
    expect(result.source).not.toBe('api-param');
    expect(result).toEqual({ config: null, source: 'none' });
  });
});

describe('what detection saves', () => {
  it('is a page load: crawl() used to re-navigate page 1 just to inspect markup we already had', async () => {
    // Detection reads the capture. A page with no pagination therefore costs
    // nothing to rule out — previously crawl() was entered, navigated page 1 a
    // second time, found nothing, and returned.
    const result = await detectPagination(capture(PLAIN), null);
    expect(result.config).toBeNull();
  });
});
