import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import {
  buildLinksNearScript,
  buildXPathHrefsScript,
  certifyVariantLinks,
  isLikelyVariantHref,
  normalizeVariantLink,
  normalizeVariantLinks,
} from './variant-collector.js';
import type { CaptureLike } from './certify.js';
import type { VariantAnswer } from './types.js';

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch(); }, 30_000);
afterAll(async () => { await browser?.close(); }, 30_000);

const page = (swatches: string[]) => `<html><body>
  <nav><a href="/c/shoes">Shoes</a><a href="/c/boots">Boots</a></nav>
  <main class="pdp">${swatches.length ? `<div class="product-swatches" aria-label="Colour">${swatches.map((s) => `<a href="/p/shoe-${s.toLowerCase()}" class="swatch">${s}</a>`).join('')}</div>` : ''}
  <section class="related"><a href="/p/other-1">Other</a><a href="/p/other-2">Other 2</a></section></main></body></html>`;
const U = ['https://s.example/p/shoe-black', 'https://s.example/p/boot-black', 'https://s.example/p/sock'];
const cap = (url: string, html: string): CaptureLike => ({ url, html, interceptedRequests: [], structuredData: { ldJson: [], nextData: null, initialState: null, meta: {} } });
const abs = (xs: string[]) => xs.map((s) => `https://s.example/p/shoe-${s.toLowerCase()}`);
const evalScript = <T,>(html: string, script: string) => browser.setContentEvaluate<T>(html, script);

describe('certifyVariantLinks', () => {
  const captures = () => ({ [U[0]!]: cap(U[0]!, page(['Black', 'Red'])), [U[1]!]: cap(U[1]!, page(['Black', 'Red', 'White'])), [U[2]!]: cap(U[2]!, page([])) });
  const answers = (): Record<string, VariantAnswer> => ({
    [U[0]!]: { count: 2, labels: ['Black', 'Red'], links: abs(['Black', 'Red']) },
    [U[1]!]: { count: 3, labels: ['Black', 'Red', 'White'], links: abs(['Black', 'Red', 'White']) },
    [U[2]!]: { count: 0, labels: [] },
  });
  it('certifies one collector over the swatches, not the navigation or related products', async () => {
    const r = await certifyVariantLinks({ urls: U, captures: captures(), answers: answers(), noun: 'colours' }, { evalScript });
    expect(r.passed).toBe(true);
    expect(r.collector).toBe("//*[contains(concat(' ', normalize-space(@class), ' '), ' product-swatches ')]//a/@href");
    expect(r.pages[U[2]!]).toEqual({ status: 'none' });
  });
  it('reports a product whose links do not match', async () => {
    const a = answers(); a[U[1]!] = { count: 4, labels: ['Black', 'Red', 'White', 'Blue'], links: abs(['Black', 'Red', 'White', 'Blue']) };
    const r = await certifyVariantLinks({ urls: U, captures: captures(), answers: a, noun: 'colours' }, { evalScript });
    expect(r.passed).toBe(false);
    expect(r.pages[U[1]!]).toEqual({ status: 'fail', message: 'found 3 of 4 colours on product 2' });
  });
  it('certifies swatches whose hrefs carry a fragment, whether the answer stored it or not', async () => {
    const fragPage = (swatches: string[]) => page(swatches).replace(/href="(\/p\/shoe-[a-z]+)"/g, 'href="$1#main"');
    const c = { [U[0]!]: cap(U[0]!, fragPage(['Black', 'Red'])), [U[1]!]: cap(U[1]!, fragPage(['Black', 'Red', 'White'])), [U[2]!]: cap(U[2]!, page([])) };
    // Product 1's answer was stored before detection stripped fragments; product 2's is in the normal form.
    const a = answers();
    a[U[0]!] = { ...a[U[0]!]!, links: abs(['Black', 'Red']).map((h) => `${h}#main`) };
    const r = await certifyVariantLinks({ urls: U, captures: c, answers: a, noun: 'colours' }, { evalScript });
    expect(r.pages[U[0]!]).toEqual({ status: 'pass', count: 2 });
    expect(r.pages[U[1]!]).toEqual({ status: 'pass', count: 3 });
    expect(r.passed).toBe(true);
  });
  it('counts only the confirmed links found when the count matches but the links differ', async () => {
    const a = answers();
    a[U[0]!] = { count: 2, labels: ['Black', 'Blue'], links: abs(['Black', 'Blue']) };
    const r = await certifyVariantLinks({ urls: U, captures: captures(), answers: a, noun: 'colours' }, { evalScript });
    expect(r.pages[U[0]!]).toEqual({ status: 'fail', message: 'found 1 of 2 colours on product 1' });
  });
  it('a page whose confirmed links all fail the path rule fails, never reads as none (fix round 1 #1)', async () => {
    const a = answers();
    a[U[2]!] = {
      count: 4,
      labels: ['A', 'B', 'C', 'D'],
      links: ['https://s.example/other/a', 'https://s.example/other/b', 'https://s.example/other/c', 'https://s.example/other/d'],
    };
    const r = await certifyVariantLinks({ urls: U, captures: captures(), answers: a, noun: 'colours' }, { evalScript });
    expect(r.passed).toBe(false);
    expect(r.pages[U[2]!]).toEqual({ status: 'fail', message: 'found no colours on product 3' });
  });
});

describe('isLikelyVariantHref', () => {
  it('a root-level product page keeps root-level colour links', () => {
    expect(isLikelyVariantHref('https://shop.example/blue-shirt', 'https://shop.example/red-shirt')).toBe(true);
    expect(isLikelyVariantHref('https://www.nike.com/t/a/1', 'https://www.nike.com/help/a')).toBe(false);
  });
  it('a locale-prefixed page compares the locale plus the next segment (fix round 1 #2)', () => {
    expect(isLikelyVariantHref('https://shop.example/en-gb/products/x', 'https://shop.example/en-gb/help/returns')).toBe(false);
    expect(isLikelyVariantHref('https://shop.example/en-gb/products/x', 'https://shop.example/en-gb/products/y')).toBe(true);
    expect(isLikelyVariantHref('https://shop.example/en-gb/products/x', 'https://shop.example/fr-fr/products/y')).toBe(false);
  });
  it('exactly two segments under a locale: any same-host link under the same locale qualifies (fix round 1 #2)', () => {
    expect(isLikelyVariantHref('https://shop.example/en-gb/products', 'https://shop.example/en-gb/help')).toBe(true);
    expect(isLikelyVariantHref('https://shop.example/en-gb/products', 'https://shop.example/fr-fr/products')).toBe(false);
  });
  it('compares segments case-insensitively (fix round 1 #3)', () => {
    expect(isLikelyVariantHref('https://shop.example/T/a/1', 'https://shop.example/t/b/2')).toBe(true);
    expect(isLikelyVariantHref('https://shop.example/en-GB/products/x', 'https://shop.example/EN-gb/Products/y')).toBe(true);
  });
});

describe('buildXPathHrefsScript', () => {
  const nikePage = `<html><body><main>
  <div class="colorway-images" aria-label="Colour">
    <a href="/t/air-force-1-white/CW2288-111">White</a><a href="/t/air-force-1-black/CW2288-001">Black</a>
    <a href="/u/custom-nike-air-force-1-by-you">Design your own Nike By You product</a></div>
  <div class="pdp-help-options"><a href="/help/a/returns">Return policy</a><a href="/help/a/pickup">Pick-up available</a></div>
</main></body></html>`;
  const NIKE_PAGE = 'https://www.nike.com/t/air-force-1-white/CW2288-111';
  const NIKE_XPATH = "//*[contains(concat(' ', normalize-space(@class), ' '), ' colorway-images ')]//a/@href";

  it('a certified collector never yields an off-pattern link', async () => {
    const result = await evalScript<string[][]>(nikePage, buildXPathHrefsScript([NIKE_XPATH], NIKE_PAGE));
    expect(result[0]).toEqual([
      'https://www.nike.com/t/air-force-1-white/CW2288-111',
      'https://www.nike.com/t/air-force-1-black/CW2288-001',
    ]);
  });
});

describe('normalizeVariantLinks', () => {
  it('strips the fragment and de-duplicates, keeping first-seen order', () => {
    expect(normalizeVariantLinks(['https://s.example/p/a#x', 'https://s.example/p/b', 'https://s.example/p/a'])).toEqual(['https://s.example/p/a', 'https://s.example/p/b']);
    expect(normalizeVariantLink(' https://s.example/p/a?c=red#top ')).toBe('https://s.example/p/a?c=red');
  });
});

describe('buildLinksNearScript', () => {
  it('finds the swatch links from a click on one swatch', async () => {
    const got = await browser.setContentEvaluate<{ count: number; links: Array<{ label: string }> } | null>(
      page(['Black', 'Red']), buildLinksNearScript("//a[text()='Red']", U[0]!));
    expect(got?.count).toBe(2);
    expect(got?.links.map((l) => l.label)).toEqual(['Black', 'Red']);
  });
  it('pure-fragment swatch hrefs are not real links — returns null', async () => {
    const html = `<html><body><div class="product-swatches" aria-label="Colour">
      <a href="#black">Black</a><a href="#red">Red</a>
    </div></body></html>`;
    const got = await browser.setContentEvaluate<unknown | null>(html, buildLinksNearScript("//a[text()='Black']", U[0]!));
    expect(got).toBeNull();
  });
  it('two hrefs differing only by fragment are one link, not two', async () => {
    const html = `<html><body><div class="product-swatches" aria-label="Colour">
      <a href="/p/shoe-black">Black</a><a href="/p/shoe-red#top">Red</a><a href="/p/shoe-red">Red again</a>
    </div></body></html>`;
    const got = await browser.setContentEvaluate<{ count: number; links: Array<{ href: string; label: string }> } | null>(
      html, buildLinksNearScript("//a[text()='Black']", U[0]!));
    expect(got?.count).toBe(2);
    expect(got?.links.map((l) => l.href)).toEqual(['https://s.example/p/shoe-black', 'https://s.example/p/shoe-red']);
  });
});
