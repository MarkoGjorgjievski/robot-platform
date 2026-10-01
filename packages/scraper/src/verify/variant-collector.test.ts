import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildLinksNearScript, certifyVariantLinks, normalizeVariantLink, normalizeVariantLinks } from './variant-collector.js';
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
