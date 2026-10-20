// Spec 2026-10-20 §6: one served page per mechanism, read the way the finder and the coverage
// check read a listing (`readListingPage`: the live page, the bounded loading, the link harvest),
// then grouped by the one rule. Real Chromium, no network beyond 127.0.0.1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { serveFixturePages, type ServedSite } from '../__fixtures__/serve.js';
import { LISTING_FIXTURES, productCard } from './__fixtures__/listing-pages.js';
import { readListingPage } from './read-listing.js';
import { asListingLinks, findProductGroup, LISTING_LINKS_SCRIPT } from './product-link-group.js';

let browser: PlaywrightBrowser;
let site: ServedSite;

beforeAll(async () => {
  browser = new PlaywrightBrowser();
  await browser.launch({ headless: true });
  site = await serveFixturePages(LISTING_FIXTURES);
}, 60_000);

afterAll(async () => {
  try { await browser?.close(); } finally { await site?.close(); }
});

async function find(path: string, load = false) {
  const url = `${site.baseUrl}${path}`;
  const { capture, links } = await readListingPage(browser, url, { load });
  return { capture, links, group: findProductGroup(links, url) };
}
const paths = (urls: string[]) => urls.map((u) => { const x = new URL(u); return x.pathname + x.search; });

describe('the finder on served listings (spec 2026-10-20 §6)', () => {
  it('a menu of div links beside a priced grid: the twelve products, no category', async () => {
    const { group } = await find('/menu');
    expect(group?.shape).toBe('127.0.0.1/products/*');
    expect(paths(group!.urls)).toEqual(Array.from({ length: 12 }, (_, i) => `/products/oak-chair-${i + 1}`));
  }, 60_000);

  it('a handful of category tiles with images and no prices: no products', async () => {
    const { group, links } = await find('/tiles');
    expect(links.anchors.length).toBe(4);
    expect(group).toBeNull();
  }, 60_000);

  it('a listing that shows no prices: its eight image cards are the products (§5.2)', async () => {
    const { group } = await find('/image-cards');
    expect(group?.shape).toBe('127.0.0.1/products/*');
    expect(paths(group!.urls)).toEqual(Array.from({ length: 8 }, (_, i) => `/products/linen-throw-${i + 1}`));
  }, 60_000);

  it('image tiles inside navigation are never products, however many', async () => {
    const { group, links } = await find('/nav-tiles');
    expect(links.anchors.length).toBe(12);
    expect(links.anchors.every((a) => a.chrome)).toBe(true);
    expect(group).toBeNull();
  }, 60_000);

  it('slug-fragmented products are one group', async () => {
    const { group } = await find('/slugs');
    expect(group!.urls).toHaveLength(6);
  }, 60_000);

  it('colour copies by query are one product each, the first address kept', async () => {
    const { group } = await find('/colours');
    expect(paths(group!.urls)).toEqual(['a', 'b', 'c', 'd'].map((p) => `/polo-shirts/polo-${p}?color=red`));
  }, 60_000);

  it('swatch links and "+2" are not products; a card whose wrapper names swatches still is', async () => {
    const { group, links } = await find('/swatches');
    expect(paths(group!.urls)).toEqual(['sierra', 'sundara', 'cyrus', 'impasto', 'kamran'].map((r) => `/products/${r}-rug`));
    const main = links.anchors.find((a) => a.href === '/products/sierra-rug' && a.text.includes('rug'))!;
    expect(main.swatch).toBeUndefined();
    expect(links.anchors.filter((a) => a.swatch).length).toBe(15); // 2 colours + "+2", five cards
  }, 60_000);

  it('seller-segment shapes are one group', async () => {
    const { group } = await find('/sellers');
    expect(group?.shape).toBe('127.0.0.1/*/product/*');
    expect(group!.urls).toHaveLength(12);
  }, 60_000);

  it('products that are not links: the page data\'s ItemList is the group, with names', async () => {
    const { group, links } = await find('/itemlist');
    expect(group?.shape).toBeNull();
    expect(paths(group!.urls)).toEqual([1, 2, 3, 4, 5].map((i) => `/p/widget-${i}`));
    expect(links.itemList[0]).toMatchObject({ url: '/p/widget-1', name: 'Widget 1' });
  }, 60_000);

  it('a page with no grid has no products — no policy page, language link or blog post', async () => {
    expect((await find('/policies')).group).toBeNull();
  }, 60_000);

  it('a lazy grid: 6 without loading, all 24 with it', async () => {
    expect((await find('/lazy')).group!.urls).toHaveLength(6);
    const loaded = await find('/lazy', true);
    expect(loaded.group!.urls).toHaveLength(24);
    expect(loaded.capture.html).toContain('/products/oak-chair-24');
  }, 90_000);

  it('a "Load more" button: all 18 with loading', async () => {
    expect((await find('/more', true)).group!.urls).toHaveLength(18);
  }, 90_000);

  it('link text collapses whitespace and keeps every letter', async () => {
    const { links } = await find('/text');
    expect(links.anchors.find((a) => a.href === '/products/tree-runner-1')?.text).toBe("Men's Tree Runner Shoes");
  }, 60_000);

  it('products named by a query id on a script named like a slug: twelve products, and the page counts them as twelve link paths (final review I1)', async () => {
    const { group, links } = await find('/query-ids');
    expect(group?.shape).toBe('127.0.0.1/*.php');
    expect(paths(group!.urls)).toEqual(Array.from({ length: 12 }, (_, i) => `/product_info.php?products_id=${i + 1}`));
    // The grid holding all twelve is not one card: the page script keys the links as the rule does.
    const first = links.anchors.find((a) => a.href === '/product_info.php?products_id=1')!;
    expect(first.levels!.some((l) => l.d > 3)).toBe(true);
  }, 60_000);

  it('2,000 cards in a wrapper whose class names swatches read in under 3 s, swatches still found (final review I2)', async () => {
    // Each card: its product link, then two colour links in a swatch list; the grid's own class says "has-swatches".
    const cards = Array.from({ length: 2000 }, (_, i) => productCard(`/products/oak-chair-${i + 1}`, `Oak chair ${i + 1}`, `$${100 + i}.00`,
      `<ul class="swatch-list"><li><a href="/products/oak-chair-${i + 1}-blue">blue</a></li><li><a href="/products/oak-chair-${i + 1}-green">green</a></li></ul>`));
    const html = `<!doctype html><html><body><ul class="grid has-swatches">${cards.join('')}</ul></body></html>`;
    const timed = `(() => { const t = performance.now(); const r = ${LISTING_LINKS_SCRIPT}; return { ms: performance.now() - t, r }; })()`;
    const runs: Array<{ ms: number; r: unknown }> = [];
    for (let i = 0; i < 2; i++) runs.push(await browser.setContentEvaluate<{ ms: number; r: unknown }>(html, timed));
    const fastest = Math.min(...runs.map((x) => x.ms));
    expect(fastest).toBeLessThan(3000);
    const links = asListingLinks(runs[0]!.r);
    expect(links.anchors).toHaveLength(6000);
    expect(links.anchors.filter((a) => a.swatch)).toHaveLength(4000);
    expect(links.anchors.filter((a) => !a.swatch).every((a) => /^\/products\/oak-chair-\d+$/.test(a.href))).toBe(true);
  }, 120_000);
});
