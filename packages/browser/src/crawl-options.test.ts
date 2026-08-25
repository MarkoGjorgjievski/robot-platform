import { describe, it, expect } from 'vitest';
import type { IBrowser, CrawlOptions, CrawlPage, ScrollOptions } from './types.js';

/** A stand-in proving IBrowser is implementable without Playwright — which is
 *  exactly what the crawler's tests need and what the interface did not allow. */
class FakeBrowser implements IBrowser {
  constructor(private readonly pages: CrawlPage[]) {}
  async launch(): Promise<void> {}
  async capture(): Promise<never> { throw new Error('not used'); }
  async evaluate<T>(): Promise<T> { throw new Error('not used'); }
  async setContentEvaluate<T>(): Promise<T> { throw new Error('not used'); }
  async close(): Promise<void> {}
  async *crawl(_startUrl: string, options: CrawlOptions): AsyncGenerator<CrawlPage> {
    const from = options.startPage ?? 1;
    for (const page of this.pages) {
      if (page.pageNumber < from) continue;
      yield page;
    }
  }

  // eslint-disable-next-line require-yield
  async *scrollPages(_startUrl: string, _options: ScrollOptions): AsyncGenerator<CrawlPage> {
    throw new Error('not used');
  }
}

const PAGES: CrawlPage[] = [
  { url: 'https://example.com/c?page=1', pageNumber: 1, data: [{ detail_url: '/p/1' }], totalRows: 1 },
  { url: 'https://example.com/c?page=2', pageNumber: 2, data: [{ detail_url: '/p/2' }], totalRows: 1 },
];

async function collect(browser: IBrowser, options: CrawlOptions): Promise<number[]> {
  const seen: number[] = [];
  for await (const page of browser.crawl('https://example.com/c', options)) seen.push(page.pageNumber);
  return seen;
}

describe('IBrowser.crawl', () => {
  it('is part of the interface, so a fake can satisfy it', async () => {
    const browser: IBrowser = new FakeBrowser(PAGES);
    expect(await collect(browser, { extractionScript: 'x' })).toEqual([1, 2]);
  });

  it('skips pages before startPage, so a caller that already captured page 1 does not refetch it', async () => {
    const browser: IBrowser = new FakeBrowser(PAGES);
    expect(await collect(browser, { extractionScript: 'x', startPage: 2 })).toEqual([2]);
  });
});
