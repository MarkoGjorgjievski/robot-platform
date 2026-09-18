import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PlaywrightBrowser } from '@robot/browser';
import { buildBoxMapScript, boxesFromAnnotation, type Box } from './box-map.js';
import { buildXPathProbeScript, type XPathProbeResult } from './dom-scripts.js';

const HTML = `<html><body>
<div id="main">
  <h1 class="title">Widget A</h1>
  <div class="price-box"><span class="was">$149.00</span><span class="now">$129.99</span></div>
  <p class="stock">In <b>stock</b></p>
  <img class="hero" src="/img/a.jpg" alt="hero">
  <a class="buy" href="/checkout?p=1">Buy</a>
  <span class="hidden" style="display:none">secret</span>
  <script>var x = 'not text';</script>
</div>
</body></html>`;

let browser: PlaywrightBrowser;
beforeAll(async () => { browser = new PlaywrightBrowser(); await browser.launch({ headless: true }); });
afterAll(async () => { await browser.close(); });

async function boxMap(html: string): Promise<Box[]> {
  return boxesFromAnnotation(await browser.setContentEvaluate<unknown>(html, buildBoxMapScript()));
}

describe('buildBoxMapScript', () => {
  it('records every visible element with its own text, plus images and links', async () => {
    const boxes = await boxMap(HTML);
    const byText = Object.fromEntries(boxes.map((b) => [b.text, b]));
    expect(byText['Widget A']).toMatchObject({ tag: 'h1', kind: 'text' });
    expect(byText['Widget A']!.xpaths[0]).toBe('//*[@id="main"]/h1[@class="title"]');            // nearest anchor first
    expect(byText['Widget A']!.xpaths.at(-1)).toMatch(/^\/\/body\//);                             // body-rooted last
    expect(byText['$129.99']!.xpaths[0]).toBe('//*[@id="main"]/div[@class="price-box"]/span[@class="now"]');
    // Own text only: the <p> holds "In", the <b> holds "stock".
    expect(byText['In']).toMatchObject({ tag: 'p' });
    expect(byText['stock']).toMatchObject({ tag: 'b' });
    expect(boxes.find((b) => b.kind === 'image')).toMatchObject({ tag: 'img', src: expect.stringMatching(/\/img\/a\.jpg$/) });
    expect(boxes.find((b) => b.kind === 'link')).toMatchObject({ tag: 'a', text: 'Buy', href: expect.stringMatching(/\/checkout\?p=1$/) });
    expect(boxes.some((b) => b.text === 'secret')).toBe(false);
    expect(boxes.some((b) => b.text.includes('not text'))).toBe(false);
  });

  it('rects are positive page-pixel boxes', async () => {
    const boxes = await boxMap(HTML);
    for (const b of boxes) {
      expect(b.rect.w).toBeGreaterThan(0);
      expect(b.rect.h).toBeGreaterThan(0);
      expect(b.rect.x).toBeGreaterThanOrEqual(0);
      expect(b.rect.y).toBeGreaterThanOrEqual(0);
    }
    const title = boxes.find((b) => b.text === 'Widget A')!;
    const price = boxes.find((b) => b.text === '$129.99')!;
    expect(price.rect.y).toBeGreaterThan(title.rect.y); // document order top to bottom
  });

  it('every xpath resolves back to an element with the same text', async () => {
    const boxes = await boxMap(HTML);
    const textBoxes = boxes.filter((b) => b.kind === 'text');
    const probe = await browser.setContentEvaluate<XPathProbeResult>(HTML, buildXPathProbeScript(textBoxes.flatMap((b) => b.xpaths)));
    for (const b of textBoxes) for (const xp of b.xpaths) expect(probe[xp]).toContain(b.text);
  });

  it('boxesFromAnnotation rejects anything that is not a box map', () => {
    expect(boxesFromAnnotation(undefined)).toEqual([]);
    expect(boxesFromAnnotation({ price: 1 })).toEqual([]);
    expect(boxesFromAnnotation([{ nope: true }])).toEqual([]);
  });
});
