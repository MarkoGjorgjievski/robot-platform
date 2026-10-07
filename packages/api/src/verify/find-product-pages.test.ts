import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { describeListingPage, listingProducts, LISTING_ANCHORS_SCRIPT, type ListingAnchor } from './find-product-pages.js';

describe('describeListingPage', () => {
  const listingUrl = 'https://shop.example/c/shoes';

  // 12 links sharing the /p/{id} template (the largest group) plus 2 links
  // sharing a smaller /c/{cat} template — the count must reflect the full
  // group.
  const bigGroup = Array.from({ length: 12 }, (_, i) => ({ href: `/p/air-${i}-123456789012`, text: `Air ${i}` }));
  const smallGroup = [
    { href: '/c/running-123456789012', text: 'Running' },
    { href: '/c/casual-123456789012', text: 'Casual' },
  ];
  const anchors = [...bigGroup, ...smallGroup];

  it('reports the full largest-group size, a 10-item sample, and pagerSeen true when a pager is present', () => {
    const html = '<html><head><link rel="next" href="?page=2"></head><body></body></html>';
    const result = describeListingPage(anchors, listingUrl, html);
    expect(result.productLinks).toBe(12);
    expect(result.pagerSeen).toBe(true);
    expect(result.sample).toHaveLength(10);
    expect(result.sample).toEqual(bigGroup.slice(0, 10).map((a) => new URL(a.href, listingUrl).href));
  });

  it('reports pagerSeen false when the html has no pagination markup', () => {
    const html = '<html><body><p>no pager here</p></body></html>';
    const result = describeListingPage(anchors, listingUrl, html);
    expect(result.productLinks).toBe(12);
    expect(result.pagerSeen).toBe(false);
  });
});

const L = 'https://shop.example/c/chairs';

describe('listingProducts', () => {
  it('merges the several links to one product: the longest text wins, the first image wins', () => {
    const anchors: ListingAnchor[] = [
      { href: '/p/1', text: '', image: '/img/1.jpg' },
      { href: '/p/1', text: 'Chair' },
      { href: 'https://shop.example/p/1', text: 'Oak chair, natural' },
    ];
    expect(listingProducts(anchors, L, ['https://shop.example/p/1'])).toEqual([{ url: 'https://shop.example/p/1', title: 'Oak chair, natural', image: 'https://shop.example/img/1.jpg' }]);
  });
  it('falls back to the title attribute, then to the path, and leaves out a missing image', () => {
    expect(listingProducts([{ href: '/p/2', text: '', title: 'Pine stool' }], L, ['https://shop.example/p/2'])).toEqual([{ url: 'https://shop.example/p/2', title: 'Pine stool' }]);
    expect(listingProducts([{ href: '/p/3', text: '  ' }], L, ['https://shop.example/p/3'])).toEqual([{ url: 'https://shop.example/p/3', title: '/p/3' }]);
  });
  it('drops an image that is not http(s) and keeps the order of the urls asked for', () => {
    const anchors: ListingAnchor[] = [{ href: '/p/b', text: 'B', image: 'data:image/png;base64,xx' }, { href: '/p/a', text: 'A' }];
    expect(listingProducts(anchors, L, ['https://shop.example/p/a', 'https://shop.example/p/b']).map((p) => [p.title, p.image])).toEqual([['A', undefined], ['B', undefined]]);
  });
});

describe('LISTING_ANCHORS_SCRIPT in Chromium', () => {
  let browser: PlaywrightBrowser;
  beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
  afterAll(async () => { await browser.close(); });

  it('reads an image inside the link, a lazy one, and one beside the link in the same card', async () => {
    const html = `<html><body>
      <a href="/p/1"><img src="/i/1.jpg"><span>Oak chair</span></a>
      <a href="/p/2" aria-label="Pine stool"><img data-src="/i/2.jpg"></a>
      <div class="card"><img src="/i/3.jpg"><a href="/p/3">Birch table</a></div>
    </body></html>`;
    const anchors = await browser.setContentEvaluate<ListingAnchor[]>(html, LISTING_ANCHORS_SCRIPT);
    const byHref = Object.fromEntries(anchors.map((a) => [a.href, a]));
    expect(byHref['/p/1']).toMatchObject({ text: 'Oak chair', image: '/i/1.jpg' });
    expect(byHref['/p/2']).toMatchObject({ title: 'Pine stool', image: '/i/2.jpg' });
    expect(byHref['/p/3']).toMatchObject({ text: 'Birch table', image: '/i/3.jpg' });
  });
});
