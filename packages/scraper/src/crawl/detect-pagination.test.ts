import { describe, it, expect } from 'vitest';
import type { PageCapture } from '@robot/browser';
import { detectPagination, type PaginationAgent } from './detect-pagination.js';

const capture = (html: string, url = 'https://shop.example.com/s?q=x') =>
  ({ url, html } as unknown as PageCapture);

const PAGINATED = '<html><body><a rel="next" href="/s/more">Next</a></body></html>';
const PLAIN = '<html><body><div class="results"><p>one</p></div></body></html>';

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
