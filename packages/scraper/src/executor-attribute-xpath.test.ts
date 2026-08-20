// A selector model frequently writes `.//a[@class="x"]/@href` — the XPath already
// selects the attribute node — while ALSO setting attribute: "href". Attribute
// nodes have no getAttribute, so every field returned null, every row was dropped
// as empty, and a live crawl found zero links on a page full of them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildExtractionScript } from './executor.js';

const HTML = `<html><body>
  <div class="item-cell"><a class="item-title" href="/p/one">One</a></div>
  <div class="item-cell is-featured"><a class="item-title" href="/p/two">Two</a></div>
  <div class="item-cell"><a class="item-title" href="/p/three">Three</a></div>
</body></html>`;

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); }, 60_000);
afterAll(async () => { await browser?.close(); });

async function run(xpath: string) {
  const script = buildExtractionScript(
    { row_xpath: '//div[contains(@class,"item-cell")]', fields: [{ name: 'link', xpath, attribute: 'href', transform: 'none' }] },
    { link: 'url' },
  );
  return browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(HTML, script);
}

describe('an xpath that selects the attribute node itself', () => {
  it('reads the value instead of returning null', async () => {
    const result = await run('.//a[@class="item-title"]/@href');
    expect(result.data.map((r) => r.link)).toEqual(['/p/one', '/p/two', '/p/three']);
  }, 60_000);

  it('still works when the xpath selects the element and attribute is set separately', async () => {
    const result = await run('.//a[@class="item-title"]');
    expect(result.data.map((r) => r.link)).toEqual(['/p/one', '/p/two', '/p/three']);
  }, 60_000);
});

describe('relative urls under setContent', () => {
  // Row extraction runs against captured HTML now, where window.location is
  // about:blank. Resolving a relative href against that fails, and the url-type
  // guard then nulls the field — silently dropping every link on any site that
  // writes hrefs relatively.
  it('resolves a relative href against the page the capture came from', async () => {
    const script = buildExtractionScript(
      {
        row_xpath: '//div[contains(@class,"item-cell")]',
        fields: [{ name: 'link', xpath: './/a[@class="item-title"]/@href', attribute: 'href', transform: 'absolute_url' }],
      },
      { link: 'url' },
      'https://shop.example.com/c/widgets?page=2',
    );
    const result = await browser.setContentEvaluate<{ data: Record<string, unknown>[] }>(HTML, script);
    expect(result.data.map((r) => r.link)).toEqual([
      'https://shop.example.com/p/one',
      'https://shop.example.com/p/two',
      'https://shop.example.com/p/three',
    ]);
  }, 60_000);
});
